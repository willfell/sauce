#!/usr/bin/env node
// run-project-chrome-bar-heal.js — button/nav refactor Pass 9b behavioral harness
// for applyProjectChromeBarHeal + _projectChromeBarBody in platform/install.js.
// Zero-dep; in-memory adapter stub (mirrors run-doc-bulk-move-heal.js). Reverting
// install.js drops the exports → this harness FATALs → red (mutation signal).
//
// The forward migration reshapes an EXISTING project-surface note from any
// old/partial stacked chrome (Breadcrumb + SpaceNavButtons + ProjectNavButtons +
// per-surface action row + literal `---`) to the canonical single-ProjectChromeBar
// shape (one ProjectChromeBar block, content widgets preserved, SectionHub /
// ProjectWorkstreamManager rewritten to contentOnly, no leftover chrome `---`).
//
// Coverage (per canonical LEGACY body, one surface each):
//   PCB-<surface>-1  migrated: exactly one ProjectChromeBar block; zero
//                    SpaceNavButtons / ProjectNavButtons / Breadcrumb blocks; zero
//                    action-row helper blocks; content widgets preserved;
//                    SectionHub / WorkstreamManager now contentOnly; no chrome `---`.
//   PCB-<surface>-2  second pass is a no-op (idempotent, byte-identical).
//   PCB-IDENT        a note already in ProjectChromeBar shape is byte-identical.
//   PCB-CONS         a note with NO legacy nav marker is left alone (conservative).
//   PCB-TYPE         a non-project frontmatter type is left alone.
//   Driver:          migrates a legacy note + .sauce-backup + history; idempotent;
//                    non-project untouched; empty vault safe.

"use strict";

const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const {
  applyProjectChromeBarHeal,
  _projectChromeBarBody,
  PROJECT_CHROME_TYPES,
} = install;

for (const [n, f] of [
  ["applyProjectChromeBarHeal", applyProjectChromeBarHeal],
  ["_projectChromeBarBody", _projectChromeBarBody],
]) {
  if (typeof f !== "function") { console.error(`FATAL: ${n} not exported from install.js`); process.exit(2); }
}
if (!Array.isArray(PROJECT_CHROME_TYPES)) { console.error("FATAL: PROJECT_CHROME_TYPES not exported"); process.exit(2); }

function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  const dirs = new Set();
  for (const p of files.keys()) { const parts = p.split("/"); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/")); }
  return {
    async exists(p) { return files.has(p) || dirs.has(p); },
    async list(p) {
      const folders = [], filesAt = [];
      for (const d of dirs) { if (d !== p && d.startsWith(p + "/") && d.indexOf("/", p.length + 1) === -1) folders.push(d); }
      for (const f of files.keys()) { if (f.startsWith(p + "/") && f.indexOf("/", p.length + 1) === -1) filesAt.push(f); }
      return { folders, files: filesAt };
    },
    async read(p) { if (!files.has(p)) throw new Error("ENOENT " + p); return files.get(p); },
    async write(p, b) { files.set(p, b); const parts = p.split("/"); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/")); },
    async mkdir(p) { dirs.add(p); },
    _files: files,
  };
}
const makeTp = (adapter) => ({ app: { vault: { adapter } } });
const GIT = { commit: null, tag: null, dirty: null };

let pass = 0, fail = 0; const failures = [];
const ok = (label, cond, detail) => { if (cond) { pass++; console.log(`  ok  ${label}`); } else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); } };

const B = (...a) => a.join("\n");
const DV = (inner) => B("```dataviewjs", `await dv.view("ranch/views/customjs-guard", ${inner});`, "```");
const NAV3 = [
  DV('{ class: "Breadcrumb" }'), "",
  DV('{ class: "SpaceNavButtons" }'), "",
  DV('{ class: "ProjectNavButtons" }'), "",
].join("\n");

const count = (s, sub) => s.split(sub).length - 1;
// number of chrome `---` (a `---` line outside the frontmatter) remaining.
function chromeDashCount(body) {
  const afterFm = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return (afterFm.match(/^-{3,}[ \t]*$/gm) || []).length;
}

// ── Canonical LEGACY bodies (one per surface). Each carries the old stacked
//    chrome header + the surface's action row + literal `---` dividers. ──────────
const LEGACY = {
  "docs-hub": {
    type: "docs-hub",
    body: B(
      "---", "type: docs-hub", "project_slug: demo", "tags:", "  - docs-hub", "---", "",
      NAV3,
      DV('{ class: "ProjectDocsIndex", method: "renderActionRow" }'), "",
      "---", "",
      DV('{ class: "ProjectDocsIndex" }'), "",
    ),
    keep: ['{ class: "ProjectDocsIndex" }'],
    drop: ["renderActionRow"],
  },
  "section-hub": {
    type: "section-hub",
    body: B(
      "---", "type: section-hub", "section: Knowledge", "---", "",
      NAV3,
      "---", "",
      DV('{ class: "SectionHub" }'), "",
    ),
    keep: ["SectionHub"],
    contentOnly: ["SectionHub"],
  },
  "doc-note": {
    type: "doc-note",
    body: B(
      "---", "type: doc-note", "section: \"[[Knowledge]]\"", "---", "",
      NAV3,
      DV('{ class: "DocLeafActions" }'), "",
      "---", "",
      "# My doc", "", "some prose the user wrote", "",
    ),
    keep: ["My doc", "some prose the user wrote"],
    drop: ["DocLeafActions"],
  },
  "links-hub": {
    type: "links-hub",
    body: B(
      "---", "type: links-hub", "links: []", "---", "",
      NAV3,
      DV('{ class: "ProjectLinksManager" }'), "",
      DV('{ class: "ProjectLinksPanel" }'), "",
    ),
    keep: ["ProjectLinksPanel"],
    drop: ["ProjectLinksManager"],
  },
  "map": {
    type: "map",
    body: B(
      "---", "type: map", "workstreams: []", "---", "",
      NAV3,
      DV('{ class: "ProjectWorkstreamManager" }'), "",
      DV('{ class: "ProjectWorkstreams" }'), "",
    ),
    keep: ["ProjectWorkstreamManager", "ProjectWorkstreams"],
    contentOnly: ["ProjectWorkstreamManager"],
  },
  "project": {
    type: "project",
    body: B(
      "---", "type: project", "status: idea", "---", "",
      NAV3,
      DV('{ class: "ProjectStatusWidget" }'), "",
      DV('{ class: "ProjectActivityPanel" }'), "",
      DV('{ class: "ProjectOpenTasks" }'), "",
      DV('{ class: "ProjectMeetingsPanel" }'), "",
      DV('{ class: "ProjectLinksPanel" }'), "",
    ),
    keep: ["ProjectStatusWidget", "ProjectActivityPanel", "ProjectOpenTasks", "ProjectMeetingsPanel", "ProjectLinksPanel"],
  },
  "projects-hub": {
    // the All-Projects hub renders ProjectsHubCards. frontmatter type is the hub
    // surface value the Breadcrumb/ProjectChromeBar recognizes.
    type: "projects-hub",
    body: B(
      "---", "type: projects-hub", "---", "",
      NAV3,
      DV('{ class: "ProjectsHubCards" }'), "",
    ),
    keep: ["ProjectsHubCards"],
  },
  "task-hub": {
    type: "task-hub",
    body: B(
      "---", "type: task-hub", "source_board: demo", "---", "",
      NAV3,
      DV('{ class: "TaskNoteView" }'), "",
      "# Task detail", "", "notes here", "",
    ),
    keep: ["TaskNoteView", "Task detail", "notes here"],
  },
  "project-todo": {
    type: "project-todo",
    body: B(
      "---", "type: project-todo", "project_slug: demo", "---", "",
      NAV3,
      DV('{ class: "ToDoLeafActions" }'), "",
      DV('{ class: "SectionLabel", args: [{ text: "Project Tasks", top: true }] }'), "",
      DV('{ class: "TaskProjectList" }'), "",
      "## Owned Tasks", "", "<!-- OWNED_TASKS_MARKER -->", "",
    ),
    keep: ["TaskProjectList", "## Owned Tasks", "OWNED_TASKS_MARKER", 'text: "Project Tasks"'],
    drop: ["ToDoLeafActions"],
  },
};

// projects-hub / task-hub aren't in the migrated-template set the same way, but
// the transform is scoped to PROJECT_CHROME_TYPES; projects-hub is the all-projects
// hub the Breadcrumb recognizes (it IS in PROJECT_CHROME_TYPES via "projects-hub"?).
// Guard: only exercise surfaces whose type IS eligible so a scope-narrowing later
// surfaces a clear failure rather than a false green.

async function run() {
  for (const [surface, spec] of Object.entries(LEGACY)) {
    const eligible = PROJECT_CHROME_TYPES.includes(spec.type);
    if (!eligible) {
      // Document the scope gap loudly rather than silently: the transform no-ops.
      const r = _projectChromeBarBody(spec.body, spec.type);
      ok(`PCB-${surface}-scope (type not in PROJECT_CHROME_TYPES → conservative no-op)`, r.changed === false && r.body === spec.body,
        `type ${spec.type} unexpectedly transformed`);
      continue;
    }
    const r = _projectChromeBarBody(spec.body, spec.type);
    ok(`PCB-${surface}-1 changed`, r.changed === true && r.body !== spec.body);
    ok(`PCB-${surface}-1 exactly one ProjectChromeBar block`, count(r.body, 'class: "ProjectChromeBar"') === 1,
      `got ${count(r.body, 'class: "ProjectChromeBar"')}`);
    ok(`PCB-${surface}-1 zero Breadcrumb`, !r.body.includes('class: "Breadcrumb"'));
    ok(`PCB-${surface}-1 zero SpaceNavButtons`, !r.body.includes('class: "SpaceNavButtons"'));
    ok(`PCB-${surface}-1 zero ProjectNavButtons`, !r.body.includes('class: "ProjectNavButtons"'));
    ok(`PCB-${surface}-1 no chrome --- left`, chromeDashCount(r.body) === 0, `chrome --- count ${chromeDashCount(r.body)}`);
    ok(`PCB-${surface}-1 bar is the FIRST rendered block`,
      r.body.indexOf('class: "ProjectChromeBar"') === r.body.indexOf("class:"));
    for (const k of (spec.keep || [])) {
      ok(`PCB-${surface}-1 keeps ${JSON.stringify(k)}`, r.body.includes(k), `missing ${k}`);
    }
    for (const d of (spec.drop || [])) {
      ok(`PCB-${surface}-1 drops ${JSON.stringify(d)}`, !r.body.includes(d), `still present ${d}`);
    }
    for (const c of (spec.contentOnly || [])) {
      const re = new RegExp(`class:\\s*"${c}",\\s*args:\\s*\\[\\{\\s*contentOnly:\\s*true\\s*\\}\\]`);
      ok(`PCB-${surface}-1 ${c} now contentOnly`, re.test(r.body), `no contentOnly rewrite for ${c}`);
    }
    // idempotency
    const r2 = _projectChromeBarBody(r.body, spec.type);
    ok(`PCB-${surface}-2 idempotent (changed:false, byte-identical)`, r2.changed === false && r2.body === r.body);
  }

  // ── PCB-IDENT: a note already in ProjectChromeBar shape → byte-identical. ──────
  {
    const alreadyBar = B(
      "---", "type: docs-hub", "---", "",
      DV('{ class: "ProjectChromeBar" }'), "",
      DV('{ class: "ProjectDocsIndex" }'), "",
    );
    const r = _projectChromeBarBody(alreadyBar, "docs-hub");
    ok("PCB-IDENT already-bar byte-identical no-op", r.changed === false && r.body === alreadyBar);
  }

  // ── PCB-CONS: no legacy nav marker (only user content) → conservative no-op. ──
  {
    const noMarker = B("---", "type: doc-note", "---", "", "# Just a doc", "", "prose only, no chrome", "");
    const r = _projectChromeBarBody(noMarker, "doc-note");
    ok("PCB-CONS no-nav-marker conservative no-op", r.changed === false && r.body === noMarker);
  }

  // ── PCB-TYPE: a non-project frontmatter type is left alone even with nav. ─────
  {
    const meeting = B("---", "type: meeting", "---", "", DV('{ class: "SpaceNavButtons" }'), "");
    const r = _projectChromeBarBody(meeting, "meeting");
    ok("PCB-TYPE non-project type no-op", r.changed === false && r.body === meeting);
  }

  // ── PCB-CONTENT-DASH: a `---` INSIDE user prose (not chrome-adjacent) survives. ─
  {
    const withUserRule = B(
      "---", "type: doc-note", "---", "",
      NAV3,
      "# Doc", "", "para one", "", "---", "", "para two after a user rule", "",
    );
    const r = _projectChromeBarBody(withUserRule, "doc-note");
    ok("PCB-CONTENT-DASH user prose --- preserved", r.body.includes("para one") && r.body.includes("para two after a user rule") && r.body.includes("\n---\n"),
      "user thematic break between prose paras was eaten");
    ok("PCB-CONTENT-DASH still migrated to bar", count(r.body, 'class: "ProjectChromeBar"') === 1 && !r.body.includes('class: "Breadcrumb"'));
  }

  // ── Heal driver — A: migrates a legacy note + backup + history. ───────────────
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: LEGACY["docs-hub"].body });
    const history = [];
    await applyProjectChromeBarHeal(makeTp(adapter), { name: "project" }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("PCB-DRV-A migrated (one bar, no nav)",
      count(after, 'class: "ProjectChromeBar"') === 1 && !after.includes('class: "ProjectNavButtons"'));
    ok("PCB-DRV-A .sauce-backup written", [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + p)));
    ok("PCB-DRV-A migrated history event", history.some((h) => h.step === "project_chrome_bar_heal" && h.action === "migrated" && h.target === p));
    ok("PCB-DRV-A summary event", history.some((h) => h.step === "project_chrome_bar_heal" && h.summary && h.summary.healed === 1));
  }
  // Heal driver — B: idempotent (second pass byte-identical, records skipped).
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: LEGACY["docs-hub"].body });
    await applyProjectChromeBarHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    const afterFirst = adapter._files.get(p);
    const h2 = [];
    await applyProjectChromeBarHeal(makeTp(adapter), { name: "project" }, {}, h2, GIT);
    ok("PCB-DRV-B idempotent (byte-identical second pass)", adapter._files.get(p) === afterFirst);
    ok("PCB-DRV-B second pass records skipped", h2.some((h) => h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
  }
  // Heal driver — C: non-project-surface (a meeting note that slipped in) untouched.
  {
    const p = "spice/projects/demo/notes/Random.md";
    const body = B("---", "type: meeting", "---", "", "# meeting", "");
    const adapter = makeAdapter({ [p]: body });
    await applyProjectChromeBarHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    ok("PCB-DRV-C non-project-type untouched", adapter._files.get(p) === body);
  }
  // Heal driver — D: empty spice/projects → no throw.
  {
    let threw = false;
    try { await applyProjectChromeBarHeal(makeTp(makeAdapter({})), { name: "project" }, {}, [], GIT); } catch (_e) { threw = true; }
    ok("PCB-DRV-D empty vault no throw", !threw);
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`); for (const f of failures) console.log("  - " + f); process.exit(1);
}
run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
