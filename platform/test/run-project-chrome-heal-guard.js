#!/usr/bin/env node
// run-project-chrome-heal-guard.js — button/nav refactor Pass 9a behavioral
// harness. The project blueprint migrated to a single `ProjectChromeBar` chrome
// block (one dv.view call replaces the old stacked Breadcrumb + SpaceNavButtons +
// ProjectNavButtons + per-surface action row; entity-create markers retired on
// project hubs — ProjectChromeBar owns creation). install.js still ships legacy
// heals that would RE-INJECT breadcrumb / nav / action-row chrome. Each such heal
// now guards on `_hasChromeBar(body)` and NO-OPs on a migrated note.
//
// This harness asserts, for a canonical ProjectChromeBar body of each surface:
//   • the pure transform reports NO change (no re-injected Breadcrumb, no
//     renderActionRow, no second ProjectLinksManager / DocLeafActions, no second
//     ProjectChromeBar);
//   • the heal DRIVER leaves the note byte-identical + writes no .sauce-backup;
// AND that each guarded heal STILL heals a legacy (old-shape) note (the guard
// preserves legacy behavior — Pass 9b adds the forward migration).
//
// Zero-dep; in-memory adapter stub (mirrors run-project-links-manager-heal.js /
// run-doc-bulk-move-heal.js). Reverting the guards in install.js flips the
// ProjectChromeBar assertions red (Gate B Layer 1 mutation signal); dropping the
// exports FATALs the harness.
//
// Coverage (PCHG-*):
//   _hasChromeBar predicate                                         (P1..P3)
//   docs-hub modernize     guarded  + legacy still modernizes       (DH-*)
//   links-hub manager      guarded  + legacy still backfills        (LH-*)
//   board-card breadcrumb  guarded  + legacy still heals            (BC-*)
//   doc-note leaf actions  guarded  + legacy still backfills        (DL-*)
//   chrome-divider strip   no-op on new shape (never injects)       (CD-*)
//   workstream removal     no-op on new shape (never injects)       (WS-*)

"use strict";

const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const {
  _hasChromeBar,
  applyDocsHubModernizeHeal,
  _modernizeDocsHubBody,
  applyProjectLinksManagerBackfill,
  _injectProjectLinksManagerBody,
  applyBoardCardBreadcrumbHeal,
  _injectBoardCardBreadcrumb,
  applyDocLeafActionsBackfill,
  _injectDocLeafActionsBody,
  applyProjectChromeDividerHeal,
  _stripProjectChromeDividers,
  applyProjectHubWorkstreamRemovalHeal,
  _removeWorkstreamManagerBlock,
} = install;

for (const [n, f] of [
  ["_hasChromeBar", _hasChromeBar],
  ["applyDocsHubModernizeHeal", applyDocsHubModernizeHeal],
  ["_modernizeDocsHubBody", _modernizeDocsHubBody],
  ["applyProjectLinksManagerBackfill", applyProjectLinksManagerBackfill],
  ["_injectProjectLinksManagerBody", _injectProjectLinksManagerBody],
  ["applyBoardCardBreadcrumbHeal", applyBoardCardBreadcrumbHeal],
  ["_injectBoardCardBreadcrumb", _injectBoardCardBreadcrumb],
  ["applyDocLeafActionsBackfill", applyDocLeafActionsBackfill],
  ["_injectDocLeafActionsBody", _injectDocLeafActionsBody],
  ["applyProjectChromeDividerHeal", applyProjectChromeDividerHeal],
  ["_stripProjectChromeDividers", _stripProjectChromeDividers],
  ["applyProjectHubWorkstreamRemovalHeal", applyProjectHubWorkstreamRemovalHeal],
  ["_removeWorkstreamManagerBlock", _removeWorkstreamManagerBlock],
]) {
  if (typeof f !== "function") { console.error(`FATAL: ${n} not exported from install.js`); process.exit(2); }
}

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
const hasBackup = (adapter) => [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/"));
const countBar = (body) => (body.match(/class:\s*"ProjectChromeBar"/g) || []).length;
const countBreadcrumb = (body) => (body.match(/class:\s*"Breadcrumb"/g) || []).length;

let pass = 0, fail = 0; const failures = [];
const ok = (label, cond, detail) => { if (cond) { pass++; console.log(`  ok  ${label}`); } else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); } };

// ── Canonical ProjectChromeBar bodies (the migrated shape each template ships) ──
const CB_DOCS_HUB = [
  "---", "type: docs-hub", "project: \"[[Demo]]\"", "project_slug: demo", "project_name: Demo",
  "created_at: \"2026-01-01T00:00:00Z\"", "tags:", "  - docs-hub", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex" });', "```", "",
].join("\n");

const CB_LINKS_HUB = [
  "---", "type: links-hub", "project: \"[[Demo]]\"", "project_slug: demo", "links: []", "tags:", "  - links-hub", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectLinksPanel" });', "```", "",
].join("\n");

// Promoted board-card / task-hub note: type stamped, single ProjectChromeBar, NO Breadcrumb.
const CB_TASK_HUB = [
  "---", "type: task-hub", "created_at: \"2026-01-01T00:00:00Z\"", "tags:", "  - kanban-card", "  - project-card", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', "```", "",
].join("\n");

// Migrated doc-note: single ProjectChromeBar (its `⋯` overflow owns Move).
const CB_DOC_NOTE = [
  "---", "type: doc-note", "project_slug: demo", "section: Knowledge", "tags:", "  - doc-note", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', "```", "",
].join("\n");

// Migrated project hub: single ProjectChromeBar leads the content widgets.
const CB_PROJECT_HUB = [
  "---", "type: project", "created_at: \"2026-01-01T00:00:00Z\"", "tags: []", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });', "```", "",
].join("\n");

// ── Legacy (old-shape) bodies — the guard must NOT stop these heals ────────────
const LEGACY_DOCS_HUB = [
  "---", "type: docs-hub", "project: \"[[Sauce]]\"", "project_slug: sauce", "tags:", "  - docs-hub", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "DocBulkMoveActions" });', "```", "",
  "---", "", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex" });', "```", "",
].join("\n");

const LEGACY_LINKS_HUB = [
  "---", "type: links-hub", "links: []", "tags:", "  - links-hub", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
  "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectLinksPanel" });', "```", "",
].join("\n");

// Legacy promoted board-card: NO type, NO Breadcrumb, only nav chrome.
const LEGACY_TASK_HUB = [
  "---", "tags:", "  - kanban-card", "  - project-card", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
].join("\n");

const LEGACY_DOC_NOTE = [
  "---", "type: doc-note", "section: Knowledge", "tags:", "  - doc-note", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
  "---", "", "# Doc", "",
].join("\n");

async function run() {
  // ── P: _hasChromeBar predicate ─────────────────────────────────────────────
  ok("PCHG-P1 _hasChromeBar true on ProjectChromeBar body", _hasChromeBar(CB_DOCS_HUB) === true);
  ok("PCHG-P2 _hasChromeBar false on legacy body", _hasChromeBar(LEGACY_DOCS_HUB) === false);
  ok("PCHG-P3 _hasChromeBar false on non-string", _hasChromeBar(null) === false && _hasChromeBar(undefined) === false);

  // ── DH: docs-hub modernize heal guarded on ProjectChromeBar ────────────────
  {
    // Pure transform DOES rewrite a ProjectChromeBar body (it predates the bar),
    // which is exactly why the DRIVER must guard — assert the driver no-ops.
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: CB_DOCS_HUB });
    const history = [];
    await applyDocsHubModernizeHeal(makeTp(adapter), { name: "project" }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("PCHG-DH1 driver leaves ProjectChromeBar docs-hub byte-identical", after === CB_DOCS_HUB);
    ok("PCHG-DH1 no second Breadcrumb injected", countBreadcrumb(after) === 0);
    ok("PCHG-DH1 no renderActionRow injected", !/method:\s*"renderActionRow"/.test(after));
    ok("PCHG-DH1 exactly one ProjectChromeBar", countBar(after) === 1);
    ok("PCHG-DH1 no .sauce-backup written", !hasBackup(adapter));
    ok("PCHG-DH1 no modernized history for the chrome-bar note", !history.some((h) => h.action === "modernized" && h.target === p));
    ok("PCHG-DH1 records skipped", history.some((h) => h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
  }
  {
    // Legacy still modernizes (guard preserved legacy behavior).
    const p = "spice/projects/sauce/docs/Docs.md";
    const adapter = makeAdapter({ [p]: LEGACY_DOCS_HUB });
    await applyDocsHubModernizeHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    const after = adapter._files.get(p);
    ok("PCHG-DH2 legacy docs-hub STILL modernizes (renderActionRow + Breadcrumb)",
      after !== LEGACY_DOCS_HUB && /method:\s*"renderActionRow"/.test(after) && /class:\s*"Breadcrumb"/.test(after));
  }

  // ── LH: links-hub manager backfill guarded on ProjectChromeBar ─────────────
  {
    const p = "spice/projects/demo/Links Hub.md";
    const adapter = makeAdapter({ [p]: CB_LINKS_HUB });
    const history = [];
    await applyProjectLinksManagerBackfill(makeTp(adapter), { name: "project" }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("PCHG-LH1 driver leaves ProjectChromeBar links-hub byte-identical", after === CB_LINKS_HUB);
    ok("PCHG-LH1 no ProjectLinksManager injected", !after.includes('class: "ProjectLinksManager"'));
    ok("PCHG-LH1 exactly one ProjectChromeBar", countBar(after) === 1);
    ok("PCHG-LH1 no .sauce-backup written", !hasBackup(adapter));
    ok("PCHG-LH1 no healed history for the chrome-bar note", !history.some((h) => h.action === "healed" && h.target === p));
  }
  {
    const p = "spice/projects/sauce/Links Hub.md";
    const adapter = makeAdapter({ [p]: LEGACY_LINKS_HUB });
    await applyProjectLinksManagerBackfill(makeTp(adapter), { name: "project" }, {}, [], GIT);
    const after = adapter._files.get(p);
    ok("PCHG-LH2 legacy links-hub STILL backfills ProjectLinksManager",
      after !== LEGACY_LINKS_HUB && after.includes('class: "ProjectLinksManager"'));
  }

  // ── BC: promoted board-card / task-hub breadcrumb heal guarded ─────────────
  {
    const p = "spice/projects/demo/tasks/Do Thing/Do Thing.md";
    const adapter = makeAdapter({ [p]: CB_TASK_HUB });
    const history = [];
    await applyBoardCardBreadcrumbHeal(makeTp(adapter), { name: "project" }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("PCHG-BC1 driver leaves ProjectChromeBar task-hub byte-identical", after === CB_TASK_HUB);
    ok("PCHG-BC1 no leading Breadcrumb injected", countBreadcrumb(after) === 0);
    ok("PCHG-BC1 exactly one ProjectChromeBar", countBar(after) === 1);
    ok("PCHG-BC1 no .sauce-backup written", !hasBackup(adapter));
    ok("PCHG-BC1 no healed history for the chrome-bar note", !history.some((h) => h.action === "healed" && h.target === p));
  }
  {
    const p = "spice/projects/sauce/tasks/Old Task/Old Task.md";
    const adapter = makeAdapter({ [p]: LEGACY_TASK_HUB });
    await applyBoardCardBreadcrumbHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    const after = adapter._files.get(p);
    ok("PCHG-BC2 legacy task-hub STILL heals (type + leading Breadcrumb)",
      after !== LEGACY_TASK_HUB && /^type:\s*task-hub/m.test(after) && /class:\s*"Breadcrumb"/.test(after));
  }

  // ── DL: doc-note leaf-actions backfill guarded ─────────────────────────────
  {
    const p = "spice/projects/demo/docs/knowledge/Note.md";
    const adapter = makeAdapter({ [p]: CB_DOC_NOTE });
    const history = [];
    await applyDocLeafActionsBackfill(makeTp(adapter), { name: "project" }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("PCHG-DL1 driver leaves ProjectChromeBar doc-note byte-identical", after === CB_DOC_NOTE);
    ok("PCHG-DL1 no DocLeafActions injected", !after.includes('class: "DocLeafActions"'));
    ok("PCHG-DL1 exactly one ProjectChromeBar", countBar(after) === 1);
    ok("PCHG-DL1 no .sauce-backup written", !hasBackup(adapter));
    ok("PCHG-DL1 no no_anchor_found warning for the chrome-bar note", !history.some((h) => h.action === "no_anchor_found" && h.target === p));
  }
  {
    const p = "spice/projects/sauce/docs/knowledge/Legacy.md";
    const adapter = makeAdapter({ [p]: LEGACY_DOC_NOTE });
    await applyDocLeafActionsBackfill(makeTp(adapter), { name: "project" }, {}, [], GIT);
    const after = adapter._files.get(p);
    ok("PCHG-DL2 legacy doc-note STILL backfills DocLeafActions",
      after !== LEGACY_DOC_NOTE && after.includes('class: "DocLeafActions"'));
  }

  // ── CD: chrome-divider strip is a NO-OP on the new shape (never injects) ────
  {
    const rDocs = _stripProjectChromeDividers(CB_DOCS_HUB);
    const rTask = _stripProjectChromeDividers(CB_TASK_HUB);
    ok("PCHG-CD1 divider strip transform no-op on ProjectChromeBar docs-hub", rDocs.changed === false && rDocs.body === CB_DOCS_HUB);
    ok("PCHG-CD2 divider strip transform no-op on ProjectChromeBar task-hub", rTask.changed === false && rTask.body === CB_TASK_HUB);
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: CB_DOCS_HUB });
    await applyProjectChromeDividerHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    ok("PCHG-CD3 divider strip driver leaves ProjectChromeBar note byte-identical", adapter._files.get(p) === CB_DOCS_HUB && !hasBackup(adapter));
  }

  // ── WS: workstream-manager removal is a NO-OP on the new hub (never injects) ─
  {
    const r = _removeWorkstreamManagerBlock(CB_PROJECT_HUB);
    ok("PCHG-WS1 workstream removal transform no-op on ProjectChromeBar hub", r.changed === false && r.body === CB_PROJECT_HUB);
    const p = "spice/projects/demo/Demo.md";
    const adapter = makeAdapter({ [p]: CB_PROJECT_HUB });
    await applyProjectHubWorkstreamRemovalHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    ok("PCHG-WS2 workstream removal driver leaves ProjectChromeBar hub byte-identical", adapter._files.get(p) === CB_PROJECT_HUB && !hasBackup(adapter));
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`); for (const f of failures) console.log("  - " + f); process.exit(1);
}
run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
