// run-sticky-notes-rename-migration.js — v0.9.0 unit harness
// applyScratchToStickyNotesMigration installer step + pure helpers
// (_rewriteScratchToStickyBody, _stickyRenameFor). Zero-dep; uses an
// in-memory VaultAdapter stub implementing the methods the migration calls
// (exists, list, read, write, remove, mkdir, rmdir). Direct require() —
// install.js exports these additively via its module.exports block.
//
// Assert families (plan Task 7 step 1):
//   SNRM-1 (a-l): _rewriteScratchToStickyBody body transforms + idempotency
//   SNRM-2 (a-d): _stickyRenameFor filename renames
//   SNRM-3 (a-…): driver against an in-memory adapter — full fake vault

const installModule = require("../install.js");
const applyScratchToStickyNotesMigration = installModule.applyScratchToStickyNotesMigration;
const _rewriteScratchToStickyBody = installModule._rewriteScratchToStickyBody;
const _stickyRenameFor = installModule._stickyRenameFor;

let passed = 0;
let failed = 0;
function ok(label, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

// ---- In-memory VaultAdapter stub (path-keyed flat store) ----
function makeAdapter(initialFs) {
  const store = new Map(Object.entries(initialFs || {}));
  return {
    async exists(p) {
      return store.has(p) || [...store.keys()].some((k) => k.startsWith(p + "/"));
    },
    async list(p) {
      const files = [];
      const folders = new Set();
      // Root listing: p === "" enumerates top-level entries (mirrors Obsidian's
      // vault adapter.list("")). prefix = "" (no leading slash), else "<p>/".
      const prefix = p === "" ? "" : p + "/";
      for (const k of store.keys()) {
        if (prefix !== "" && !k.startsWith(prefix)) continue;
        const rest = k.substring(prefix.length);
        const slashIdx = rest.indexOf("/");
        if (slashIdx === -1) files.push(k);
        else folders.add(`${prefix}${rest.substring(0, slashIdx)}`);
      }
      return { folders: [...folders], files };
    },
    async read(p) {
      if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
      return store.get(p);
    },
    async write(p, body) { store.set(p, body); },
    async remove(p) { store.delete(p); },
    async mkdir(_p) { /* folders implied by file paths */ },
    async rmdir(_p) { /* no-op */ },
    _store: store,
  };
}

const mockManifest = { name: "sticky-notes" };
const mockVariables = { module_directory: "sticky-notes" };
const mockGit = { commit: "deadbeef", tag: "v0.9.0", dirty: false };

// ============ SNRM-1: _rewriteScratchToStickyBody ============
function suite1RewriteBody() {
  console.log("\n--- SNRM-1: _rewriteScratchToStickyBody ---");

  ok("SNRM-1a type: scratch → sticky-note",
    /^type: sticky-note$/m.test(_rewriteScratchToStickyBody("type: scratch\n")));
  ok("SNRM-1b type: scratch-day → sticky-day",
    /^type: sticky-day$/m.test(_rewriteScratchToStickyBody("type: scratch-day\n")));
  ok("SNRM-1c type: scratch-hub → sticky-hub",
    /^type: sticky-hub$/m.test(_rewriteScratchToStickyBody("type: scratch-hub\n")));
  ok("SNRM-1d quoted type: \"scratch\" → sticky-note",
    /^type: sticky-note$/m.test(_rewriteScratchToStickyBody('type: "scratch"\n')));
  ok("SNRM-1e day_link [[Scratch-Day-…]] → [[Sticky-Day-…]]",
    _rewriteScratchToStickyBody('day_link: "[[Scratch-Day-2026-06-17]]"')
      === 'day_link: "[[Sticky-Day-2026-06-17]]"');

  const cls = _rewriteScratchToStickyBody(
    "customJS.ScratchChromeBar; customJS.ScratchDayList; customJS.ScratchHubCards; customJS.ScratchDayMigrate;");
  ok("SNRM-1f class refs Scratch* → Sticky*",
    cls.includes("StickyChromeBar") && cls.includes("StickyDayList")
      && cls.includes("StickyHubCards") && cls.includes("StickyDayMigrate")
      && !/Scratch(ChromeBar|DayList|HubCards|DayMigrate)/.test(cls));

  ok("SNRM-1g hub path rewritten BEFORE generic",
    _rewriteScratchToStickyBody("spice/scratch/Scratch.md")
      === "spice/sticky-notes/Sticky.md");
  ok("SNRM-1h generic spice/scratch/ → spice/sticky-notes/",
    _rewriteScratchToStickyBody("spice/scratch/2026/06-June")
      === "spice/sticky-notes/2026/06-June");
  ok("SNRM-1i wikilink [[Scratch-<digit> → [[Sticky-",
    _rewriteScratchToStickyBody("[[Scratch-2026-06-17-14-30]]")
      === "[[Sticky-2026-06-17-14-30]]");

  const tags = _rewriteScratchToStickyBody("tags:\n  - scratch-day\n  - scratch\n");
  ok("SNRM-1j tags block scratch-day → sticky-day, scratch → sticky-note",
    tags.includes("sticky-day") && tags.includes("sticky-note")
      && !/\bscratch\b/.test(tags));

  const once = _rewriteScratchToStickyBody(
    'type: scratch\nday_link: "[[Scratch-Day-2026-06-17]]"\ncustomJS.ScratchChromeBar\nspice/scratch/Scratch.md\n[[Scratch-2026-06-17-14-30]]\n');
  const twice = _rewriteScratchToStickyBody(once);
  ok("SNRM-1k idempotent (2nd pass byte-equal)", once === twice);

  const prose = "This is a scratchpad note. I scratched my head.\ntype: scratch\n";
  const proseOut = _rewriteScratchToStickyBody(prose);
  ok("SNRM-1l prose 'scratchpad'/'scratched' untouched; only type-line rewritten",
    proseOut.includes("scratchpad") && proseOut.includes("scratched")
      && /^type: sticky-note$/m.test(proseOut));
}

// ============ SNRM-2: _stickyRenameFor ============
function suite2RenameFor() {
  console.log("\n--- SNRM-2: _stickyRenameFor ---");
  ok("SNRM-2a Scratch.md @root → Sticky.md",
    _stickyRenameFor("Scratch.md", true) === "Sticky.md");
  ok("SNRM-2b Scratch-Day-2026-06-17.md → Sticky-Day-…",
    _stickyRenameFor("Scratch-Day-2026-06-17.md", false) === "Sticky-Day-2026-06-17.md");
  ok("SNRM-2c Scratch-2026-06-17-14-30.md → Sticky-…",
    _stickyRenameFor("Scratch-2026-06-17-14-30.md", false) === "Sticky-2026-06-17-14-30.md");
  ok("SNRM-2d user note 2026-06-14-test-scratch.md unchanged",
    _stickyRenameFor("2026-06-14-test-scratch.md", false) === "2026-06-14-test-scratch.md");
}

// ============ SNRM-3: driver against in-memory adapter ============
function buildFakeVault() {
  return {
    // spice/scratch tree
    "spice/scratch/Scratch.md": 'type: scratch-hub\ncustomJS.ScratchChromeBar\ncustomJS.ScratchHubCards\n# Scratch\n',
    "spice/scratch/2026-06-14-test-scratch.md": '---\ntype: note\ntitle: user note\n---\nA user note that is not a Scratch- file.\n',
    "spice/scratch/2026/06-June/2026-06-17/Scratch-Day-2026-06-17.md":
      'type: scratch-day\nday_link: "[[Scratch]]"\ncustomJS.ScratchChromeBar\ncustomJS.ScratchDayList\n',
    "spice/scratch/2026/06-June/2026-06-17/Scratch-2026-06-17-14-30.md":
      'type: scratch\nday: "2026-06-17"\nday_link: "[[Scratch-Day-2026-06-17]]"\ncustomJS.ScratchChromeBar\n',
    // ranch scripts
    "ranch/scripts/scratch/scratch-chrome-bar.js": "class ScratchChromeBar {}",
    "ranch/scripts/scratch/scratch-day-list.js": "class ScratchDayList {}",
    // ranch templates
    "ranch/templates/Scratch.md": "type: scratch\n",
    "ranch/templates/Scratch Day Hub.md": "type: scratch-day\n",
    // ranch rules
    "ranch/rules/scratch.json": "{}",
    "ranch/rules/scratch-day-hub.json": "{}",
    // .claude command + skill
    ".claude/commands/scratch.md": "# scratch command",
    ".claude/skills/scratch/new-scratch/SKILL.md": "# new scratch",
    // registries
    "ranch/nav-buttons-registry.json": JSON.stringify({
      schema_version: 1,
      contributions: { scratch: [{ id: "scratch" }], project: [{ id: "project" }] },
    }, null, 2),
    "ranch/entity-create-registry.json": JSON.stringify({
      schema_version: 1,
      contributions: { scratch: [{ id: "scratch", blueprint: "scratch" }], meetings: [{ id: "meeting" }] },
      entries: [
        { blueprint: "scratch", id: "scratch" },
        { blueprint: "meetings", id: "meeting" },
      ],
    }, null, 2),
    "ranch/breadcrumb-registry.json": JSON.stringify({
      schema_version: 1,
      contributions: { scratch: { types: {} }, project: { types: {} } },
    }, null, 2),
    "ranch/claude-surface-registry.json": JSON.stringify({
      schema_version: 1,
      generated_at: "x",
      workshop_version: "0.8.0",
      contributions: { scratch: { files: [] }, audit: { files: [] } },
    }, null, 2),
    // plugin data
    ".obsidian/plugins/customjs/data.json": JSON.stringify({
      startupScriptNames: ["ScratchDayMigrateInit", "ToDoCreateTaskInit"],
    }, null, 2),
    ".obsidian/plugins/templater-obsidian/data.json": JSON.stringify({
      folder_templates: [
        { folder: "spice/scratch", template: "ranch/templates/Scratch.md" },
        { folder: "spice/meetings", template: "ranch/templates/Meeting.md" },
      ],
    }, null, 2),
    // installed ledger
    "ranch/platform-installed.json": JSON.stringify({
      mechanisms: [],
      blueprints: [
        { name: "scratch", version: "0.8.0" },
        { name: "meetings", version: "0.12.0" },
      ],
      history: [],
    }, null, 2),
    // outside-tree note linking a leaf
    "spice/daily/2026-06-17.md": 'type: daily\nSee [[Scratch-2026-06-17-14-30]] for notes.\n',
  };
}

async function suite3Driver() {
  console.log("\n--- SNRM-3: driver against in-memory adapter ---");
  const adapter = makeAdapter(buildFakeVault());
  const tp = { app: { vault: { adapter } } };
  const history = [];
  await applyScratchToStickyNotesMigration(tp, mockManifest, mockVariables, history, mockGit);

  ok("SNRM-3a old spice/scratch tree gone",
    !(await adapter.exists("spice/scratch")));
  ok("SNRM-3b hub renamed + typed",
    (await adapter.exists("spice/sticky-notes/Sticky.md"))
      && (await adapter.read("spice/sticky-notes/Sticky.md")).includes("type: sticky-hub"));
  ok("SNRM-3c leaf renamed + typed (nested subpath preserved)",
    (await adapter.exists("spice/sticky-notes/2026/06-June/2026-06-17/Sticky-2026-06-17-14-30.md"))
      && (await adapter.read("spice/sticky-notes/2026/06-June/2026-06-17/Sticky-2026-06-17-14-30.md")).includes("type: sticky-note"));
  ok("SNRM-3d day-hub renamed + typed",
    (await adapter.exists("spice/sticky-notes/2026/06-June/2026-06-17/Sticky-Day-2026-06-17.md"))
      && (await adapter.read("spice/sticky-notes/2026/06-June/2026-06-17/Sticky-Day-2026-06-17.md")).includes("type: sticky-day"));
  ok("SNRM-3e user note moved intact (name unchanged)",
    (await adapter.exists("spice/sticky-notes/2026-06-14-test-scratch.md"))
      && (await adapter.read("spice/sticky-notes/2026-06-14-test-scratch.md")).includes("A user note"));
  ok("SNRM-3f outside-tree cross-ref rewritten",
    (await adapter.read("spice/daily/2026-06-17.md")).includes("[[Sticky-2026-06-17-14-30]]"));

  // artifact prunes
  ok("SNRM-3g ranch/scripts/scratch pruned",
    !(await adapter.exists("ranch/scripts/scratch")));
  ok("SNRM-3h ranch templates pruned",
    !(await adapter.exists("ranch/templates/Scratch.md"))
      && !(await adapter.exists("ranch/templates/Scratch Day Hub.md")));
  ok("SNRM-3i ranch rules pruned",
    !(await adapter.exists("ranch/rules/scratch.json"))
      && !(await adapter.exists("ranch/rules/scratch-day-hub.json")));
  ok("SNRM-3j .claude command + skill pruned",
    !(await adapter.exists(".claude/commands/scratch.md"))
      && !(await adapter.exists(".claude/skills/scratch")));

  const nav = JSON.parse(await adapter.read("ranch/nav-buttons-registry.json"));
  const ec = JSON.parse(await adapter.read("ranch/entity-create-registry.json"));
  const bc = JSON.parse(await adapter.read("ranch/breadcrumb-registry.json"));
  const cs = JSON.parse(await adapter.read("ranch/claude-surface-registry.json"));
  ok("SNRM-3k registries scratch-key gone (nav/entity/breadcrumb/claude-surface)",
    !("scratch" in (nav.contributions || {}))
      && !("scratch" in (ec.contributions || {}))
      && !(ec.entries || []).some((e) => e.blueprint === "scratch")
      && !("scratch" in (bc.contributions || {}))
      && !("scratch" in (cs.contributions || {})));

  const cjs = JSON.parse(await adapter.read(".obsidian/plugins/customjs/data.json"));
  ok("SNRM-3l customjs ScratchDayMigrateInit pruned",
    !cjs.startupScriptNames.includes("ScratchDayMigrateInit"));

  const tpl = JSON.parse(await adapter.read(".obsidian/plugins/templater-obsidian/data.json"));
  ok("SNRM-3m templater spice/scratch folder-template pruned",
    !(tpl.folder_templates || []).some((x) => x.folder === "spice/scratch"));

  const led = JSON.parse(await adapter.read("ranch/platform-installed.json"));
  ok("SNRM-3n platform-installed scratch blueprint entry gone",
    !(led.blueprints || []).some((b) => b.name === "scratch"));

  // .sauce-backup snapshot
  ok("SNRM-3o .sauce-backup snapshot of pre-move tree exists",
    await adapter.exists(".sauce-backup/sticky-notes-rename"));

  // summary event
  ok("SNRM-3p history info summary emitted",
    history.some((e) => e.event === "info" && e.step === "scratch_to_sticky_rename"
      && /moved \d+ notes/.test(e.reason || "")));

  // idempotent second run — zero writes on spice tree (short-circuit; scratch gone)
  const beforeSnapshot = new Map(adapter._store);
  const history2 = [];
  await applyScratchToStickyNotesMigration(tp, mockManifest, mockVariables, history2, mockGit);
  let changed = 0;
  for (const [k, v] of adapter._store) {
    if (!beforeSnapshot.has(k) || beforeSnapshot.get(k) !== v) changed += 1;
  }
  for (const k of beforeSnapshot.keys()) if (!adapter._store.has(k)) changed += 1;
  ok("SNRM-3q second run is a zero-write no-op (idempotent)", changed === 0);
}

(async () => {
  suite1RewriteBody();
  suite2RenameFor();
  await suite3Driver();
  console.log(`\nrun-sticky-notes-rename-migration.js: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
