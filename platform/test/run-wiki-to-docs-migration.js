// run-wiki-to-docs-migration.js — v0.52.0 unit harness for the
// applyWikiToDocsMigration installer step + _rewriteWikiToDocsBody helper.
//
// Zero-dep; uses an in-memory VaultAdapter stub that implements the methods
// applyWikiToDocsMigration calls (exists, list, read, write, remove, mkdir, rmdir).
//
// Export posture: install.js already has a module.exports block (added in
// v0.29.0 S2.5 for applyRuleFragment, extended additively since). v0.52.0 S5
// adds applyWikiToDocsMigration + applyDocsBackfill + _rewriteWikiToDocsBody
// to that block. Direct require() is used here — no vm sandbox needed.

const fs = require("fs");
const path = require("path");

const installModule = require("../install.js");
const applyWikiToDocsMigration = installModule.applyWikiToDocsMigration;
const _rewriteWikiToDocsBody = installModule._rewriteWikiToDocsBody;

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}

// Build a minimal VaultAdapter stub backed by an in-memory fs map.
function makeAdapter(initialFs) {
  const store = new Map(Object.entries(initialFs || {}));
  return {
    async exists(p) { return store.has(p) || [...store.keys()].some((k) => k.startsWith(p + "/")); },
    async list(p) {
      const folders = new Set();
      const files = [];
      for (const k of store.keys()) {
        if (!k.startsWith(p + "/")) continue;
        const rest = k.substring(p.length + 1);
        const slashIdx = rest.indexOf("/");
        if (slashIdx === -1) files.push(k);
        else folders.add(`${p}/${rest.substring(0, slashIdx)}`);
      }
      return { folders: [...folders], files };
    },
    async read(p) { if (!store.has(p)) throw new Error(`ENOENT: ${p}`); return store.get(p); },
    async write(p, body) { store.set(p, body); },
    async remove(p) { store.delete(p); },
    async mkdir(_p) { /* folders implied by file paths */ },
    async rmdir(_p) { /* no-op; removed when no files remain */ },
    _store: store,
  };
}

const mockManifest = { name: "project" };
const mockVariables = { templates_path: "ranch/templates" };
const mockGit = { commit: "deadbeef", tag: "v0.52.0", dirty: false };

async function caseWTDMIG1HappyPath() {
  console.log("\n--- Case WTD-MIG-1: happy-path migration ---");
  const adapter = makeAdapter({
    "spice/projects/test/test.md": '---\ntype: project\nname: "Test"\n---\nbody',
    "spice/projects/test/wiki/Wiki.md": '---\ntype: wiki-hub\ntags:\n  - wiki-hub\n---\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectWikiCards" });\n```\n',
    "spice/projects/test/wiki/Some Thought.md": '---\ntype: wiki-note\ntags:\n  - wiki-note\n---\nbody',
  });
  const tp = { app: { vault: { adapter } } };
  const history = [];
  await applyWikiToDocsMigration(tp, mockManifest, mockVariables, history, mockGit);

  ok("WTD-MIG-1.1 docs/Docs.md exists after migration", await adapter.exists("spice/projects/test/docs/Docs.md"));
  ok("WTD-MIG-1.2 wiki/Wiki.md does not exist", !(await adapter.exists("spice/projects/test/wiki/Wiki.md")));
  ok("WTD-MIG-1.3 docs/Some Thought.md exists", await adapter.exists("spice/projects/test/docs/Some Thought.md"));
  const hubBody = await adapter.read("spice/projects/test/docs/Docs.md");
  ok("WTD-MIG-1.4 hub frontmatter type rewritten to docs-hub", /^type:\s*docs-hub\s*$/m.test(hubBody));
  ok("WTD-MIG-1.5 hub tags rewritten to docs-hub", /docs-hub/.test(hubBody));
  ok("WTD-MIG-1.6 customJS class ref rewritten to ProjectDocsCards", /customJS\.ProjectDocsCards|"ProjectDocsCards"/.test(hubBody));
  const noteBody = await adapter.read("spice/projects/test/docs/Some Thought.md");
  ok("WTD-MIG-1.7 note frontmatter type rewritten to doc-note", /^type:\s*doc-note\s*$/m.test(noteBody));

  // Backup exists (timestamped dir; check parent dir presence)
  const backupParent = ".sauce-backup/test/wiki";
  const backupExists = await adapter.exists(backupParent);
  ok("WTD-MIG-1.8 backup dir exists at .sauce-backup/test/wiki/<ts>/", backupExists);

  // History note recorded
  const migInfo = history.find((e) => e.step === "wiki_to_docs_migration" && /migrated test/.test(e.reason || ""));
  ok("WTD-MIG-1.9 history info entry recorded per-project", !!migInfo);
}

async function caseWTDMIG2Idempotent() {
  console.log("\n--- Case WTD-MIG-2: idempotency on re-run ---");
  const adapter = makeAdapter({
    "spice/projects/test/test.md": '---\ntype: project\nname: "Test"\n---\nbody',
    "spice/projects/test/docs/Docs.md": '---\ntype: docs-hub\n---\nalready migrated',
  });
  const tp = { app: { vault: { adapter } } };
  const history = [];
  await applyWikiToDocsMigration(tp, mockManifest, mockVariables, history, mockGit);

  ok("WTD-MIG-2.1 no backup created on idempotent re-run", !(await adapter.exists(".sauce-backup/test/wiki")));
  const skipNote = history.find((e) => /skipped-already-migrated\s*1/.test(e.reason || ""));
  ok("WTD-MIG-2.2 history summary reports 1 skip-already-migrated", !!skipNote);
}

async function caseWTDMIG3CoExistence() {
  console.log("\n--- Case WTD-MIG-3: co-existence guard (both wiki/ and docs/ present) ---");
  const adapter = makeAdapter({
    "spice/projects/test/test.md": '---\ntype: project\nname: "Test"\n---\nbody',
    "spice/projects/test/wiki/Wiki.md": '---\ntype: wiki-hub\n---\nold',
    "spice/projects/test/docs/Docs.md": '---\ntype: docs-hub\n---\nnew',
  });
  const tp = { app: { vault: { adapter } } };
  const history = [];
  await applyWikiToDocsMigration(tp, mockManifest, mockVariables, history, mockGit);

  ok("WTD-MIG-3.1 wiki/ untouched (still exists)", await adapter.exists("spice/projects/test/wiki/Wiki.md"));
  ok("WTD-MIG-3.2 docs/ untouched (still exists)", await adapter.exists("spice/projects/test/docs/Docs.md"));
  const warnNote = history.find((e) => e.event === "warning" && /co-existence/.test(e.reason || ""));
  ok("WTD-MIG-3.3 history warning recorded for co-existence", !!warnNote);
}

// WTD-MIG-4 — v0.52.1 hot-fix: _rmDirRecursive falls back to Node fs when
// the adapter doesn't expose .rmdir (CLI-mode). The in-memory stub above
// can't model real filesystem behavior, so this case writes to a real
// tmpdir, deletes the stub's rmdir method, and asserts the fallback path
// actually removes the directory on disk.
async function caseWTDMIG4RmdirFallback() {
  console.log("\n--- Case WTD-MIG-4: _rmDirRecursive Node fs fallback when adapter.rmdir absent ---");
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wtd-mig-4-"));

  // Build a real-fs-backed adapter that exposes basePath but NO rmdir.
  // Mirrors the install-time CLI adapter shape (per ranch/templater/platformInstall.js).
  const adapter = {
    basePath: tmpRoot,
    async exists(p) { return fs.existsSync(path.join(tmpRoot, p)); },
    async list(p) {
      const abs = path.join(tmpRoot, p);
      if (!fs.existsSync(abs)) return { folders: [], files: [] };
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      const folders = entries.filter((e) => e.isDirectory()).map((e) => `${p}/${e.name}`);
      const files = entries.filter((e) => e.isFile()).map((e) => `${p}/${e.name}`);
      return { folders, files };
    },
    async read(p) { return fs.readFileSync(path.join(tmpRoot, p), "utf8"); },
    async write(p, body) {
      const abs = path.join(tmpRoot, p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    },
    async remove(p) { fs.unlinkSync(path.join(tmpRoot, p)); },
    async mkdir(p) { fs.mkdirSync(path.join(tmpRoot, p), { recursive: true }); },
    // No rmdir — exercises the fallback path.
  };

  // Seed: spice/projects/test/wiki/ with a hub + a note.
  await adapter.write("spice/projects/test/test.md", '---\ntype: project\nname: "Test"\n---\nbody');
  await adapter.write("spice/projects/test/wiki/Wiki.md", '---\ntype: wiki-hub\ntags:\n  - wiki-hub\n---\nhub');
  await adapter.write("spice/projects/test/wiki/Thought.md", '---\ntype: wiki-note\ntags:\n  - wiki-note\n---\nnote');

  const tp = { app: { vault: { adapter } } };
  const history = [];
  await applyWikiToDocsMigration(tp, mockManifest, mockVariables, history, mockGit);

  const wikiAbs = path.join(tmpRoot, "spice/projects/test/wiki");
  const docsAbs = path.join(tmpRoot, "spice/projects/test/docs");
  ok("WTD-MIG-4.1 wiki/ directory removed via Node fs fallback", !fs.existsSync(wikiAbs));
  ok("WTD-MIG-4.2 docs/Docs.md created at new path", fs.existsSync(path.join(docsAbs, "Docs.md")));
  ok("WTD-MIG-4.3 docs/Thought.md created at new path", fs.existsSync(path.join(docsAbs, "Thought.md")));
  const migInfo = history.find((e) => e.step === "wiki_to_docs_migration" && /migrated test/.test(e.reason || ""));
  ok("WTD-MIG-4.4 migration recorded info entry (no rmdir warning)", !!migInfo);

  // Cleanup tmpdir
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

(async () => {
  await caseWTDMIG1HappyPath();
  await caseWTDMIG2Idempotent();
  await caseWTDMIG3CoExistence();
  await caseWTDMIG4RmdirFallback();
  console.log(`\nrun-wiki-to-docs-migration.js: ${passed} pass · ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
})();
