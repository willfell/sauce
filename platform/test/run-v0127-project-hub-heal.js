#!/usr/bin/env node
// run-v0127-project-hub-heal.js — v0.127.0 §D behavioral harness for
// applyProjectMeetingsPanelHeal in platform/install.js.
//
// Zero-dep. Requires install.js (gated by `require.main === module` so this
// require is side-effect-safe), pulls applyProjectMeetingsPanelHeal off the
// module.exports surface, exercises it against an in-memory adapter stub.
//
// Coverage (HC-V0127-PHH-*):
//   A — stale hub with ProjectStatusWidget → PMP inserted after status fence.
//   B — stale hub w/o ProjectStatusWidget but with ProjectNavButtons → fallback.
//   C — already-healed hub → second pass is a no-op.
//   D — hub with NO dataviewjs blocks → warning history, no write.
//   E — non-project hub (project-todo) under spice/projects/<x>/ untouched.
//   F — empty spice/projects/ → no error, no writes.
//
// Verdict: "PASS N/N" exit 0, "FAIL X/N" exit 1.

"use strict";

const path = require("path");

const install = require(path.join(__dirname, "..", "install.js"));
const { applyProjectMeetingsPanelHeal } = install;

if (typeof applyProjectMeetingsPanelHeal !== "function") {
  console.error("FATAL: applyProjectMeetingsPanelHeal not exported from install.js");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// In-memory adapter stub mimicking the subset of FileSystemAdapter used by
// applyProjectMeetingsPanelHeal: exists, list, read, write, mkdir.
// ---------------------------------------------------------------------------
function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  const dirs = new Set();
  for (const p of files.keys()) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    async exists(p) { return files.has(p) || dirs.has(p); },
    async list(p) {
      const folders = [];
      const filesAt = [];
      for (const d of dirs) {
        if (d === p) continue;
        if (d.startsWith(p + "/") && d.indexOf("/", p.length + 1) === -1) {
          folders.push(d);
        }
      }
      for (const f of files.keys()) {
        if (f.startsWith(p + "/") && f.indexOf("/", p.length + 1) === -1) {
          filesAt.push(f);
        }
      }
      return { folders, files: filesAt };
    },
    async read(p) {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return files.get(p);
    },
    async write(p, body) {
      files.set(p, body);
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    },
    async mkdir(p) {
      dirs.add(p);
    },
    _files: files,
    _dirs: dirs,
  };
}

function makeTp(adapter) {
  return { app: { vault: { adapter } } };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const STALE_HUB_WITH_STATUS_WIDGET = `---
type: project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
\`\`\`
`;

const STALE_HUB_NO_STATUS_WIDGET = `---
type: project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
\`\`\`
`;

const FRESH_HUB = `---
type: project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectMeetingsPanel" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
\`\`\`
`;

const NO_DATAVIEWJS_HUB = `---
type: project
---

# Plain project hub with no dataviewjs blocks at all.
Some narrative text.
`;

const NON_PROJECT_HUB = `---
type: project-todo
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`
`;

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    const msg = `${label}${detail ? " — " + detail : ""}`;
    failures.push(msg);
    console.log(`  FAIL  ${msg}`);
  }
}

const GIT = { commit: null, tag: null, dirty: null };

async function run() {
  // Case A — stale hub with ProjectStatusWidget → PMP injected after status fence.
  {
    const adapter = makeAdapter({
      "spice/projects/databricks/Databricks.md": STALE_HUB_WITH_STATUS_WIDGET,
    });
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const result = await adapter.read("spice/projects/databricks/Databricks.md");
    ok(
      "HC-V0127-PHH-A.pmp-injected",
      result.includes('class: "ProjectMeetingsPanel"'),
      "PMP block missing after heal"
    );
    const statusIdx = result.indexOf("ProjectStatusWidget");
    const pmpIdx = result.indexOf("ProjectMeetingsPanel");
    const wsmIdx = result.indexOf("ProjectWorkstreamManager");
    ok(
      "HC-V0127-PHH-A.order",
      statusIdx > -1 && pmpIdx > -1 && wsmIdx > -1 && statusIdx < pmpIdx && pmpIdx < wsmIdx,
      `expected Status<PMP<Workstream, got status=${statusIdx} pmp=${pmpIdx} wsm=${wsmIdx}`
    );
    ok(
      "HC-V0127-PHH-A.history-healed",
      history.some(
        (h) => h.action === "healed" && h.target && h.target.includes("Databricks.md")
      ),
      "no healed history entry"
    );
  }

  // Case B — stale hub without ProjectStatusWidget but with ProjectNavButtons.
  {
    const adapter = makeAdapter({
      "spice/projects/oldproj/OldProj.md": STALE_HUB_NO_STATUS_WIDGET,
    });
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const result = await adapter.read("spice/projects/oldproj/OldProj.md");
    ok(
      "HC-V0127-PHH-B.pmp-injected",
      result.includes('class: "ProjectMeetingsPanel"'),
      "PMP block missing after heal"
    );
    const navIdx = result.indexOf("ProjectNavButtons");
    const pmpIdx = result.indexOf("ProjectMeetingsPanel");
    ok(
      "HC-V0127-PHH-B.order",
      navIdx > -1 && pmpIdx > -1 && navIdx < pmpIdx,
      `expected NavButtons<PMP, got nav=${navIdx} pmp=${pmpIdx}`
    );
  }

  // Case C — already-healed hub: second pass is a no-op.
  {
    const adapter = makeAdapter({
      "spice/projects/fresh/Fresh.md": FRESH_HUB,
    });
    const before = await adapter.read("spice/projects/fresh/Fresh.md");
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const after = await adapter.read("spice/projects/fresh/Fresh.md");
    ok(
      "HC-V0127-PHH-C.unchanged",
      before === after,
      "fresh hub was modified by heal"
    );
    ok(
      "HC-V0127-PHH-C.history-skipped",
      history.some((h) => h.action === "skipped_already_healed"),
      "no skipped_already_healed history entry"
    );
  }

  // Case D — no dataviewjs blocks: warning + no write.
  {
    const adapter = makeAdapter({
      "spice/projects/plain/Plain.md": NO_DATAVIEWJS_HUB,
    });
    const before = await adapter.read("spice/projects/plain/Plain.md");
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const after = await adapter.read("spice/projects/plain/Plain.md");
    ok(
      "HC-V0127-PHH-D.unchanged",
      before === after,
      "anchorless hub was modified"
    );
    ok(
      "HC-V0127-PHH-D.history-warning",
      history.some((h) => h.action === "no_anchor_found"),
      "no no_anchor_found warning recorded"
    );
  }

  // Case E — non-project file (type: project-todo) untouched.
  {
    const adapter = makeAdapter({
      "spice/projects/dbk/Databricks To-Do.md": NON_PROJECT_HUB,
    });
    const before = await adapter.read("spice/projects/dbk/Databricks To-Do.md");
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const after = await adapter.read("spice/projects/dbk/Databricks To-Do.md");
    ok(
      "HC-V0127-PHH-E.unchanged",
      before === after,
      "project-todo hub was modified"
    );
    ok(
      "HC-V0127-PHH-E.no-per-target-history",
      !history.some(
        (h) => h.target && h.target.includes("Databricks To-Do.md")
      ),
      "non-project file picked up a per-target history entry"
    );
  }

  // Case F — empty spice/projects/ runs without throwing.
  {
    const adapter = makeAdapter({});
    const history = [];
    let threw = false;
    try {
      await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    } catch (_e) {
      threw = true;
    }
    ok(
      "HC-V0127-PHH-F.no-throw",
      !threw,
      "empty spice/projects/ threw"
    );
  }

  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass}/${pass + fail}`);
    process.exit(0);
  } else {
    console.log(`FAIL ${fail}/${pass + fail}`);
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e)));
  process.exit(2);
});
