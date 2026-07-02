#!/usr/bin/env node
// run-doc-bulk-move-heal.js — Project Doc Updating Wiring PR5 behavioral harness
// for applyDocBulkMoveActionsBackfill + _injectDocBulkMoveActionsBody in
// platform/install.js. Zero-dep; in-memory adapter stub (mirrors
// run-doc-leaf-actions-heal.js). Reverting install.js drops both exports →
// this harness FATALs → red (Gate B Layer 1 mutation signal).
//
// Coverage (DBMH-*):
//   U1  transform injects the DocBulkMoveActions block after the entity-create
//       doc-note block, BEFORE the `---` divider, before ProjectDocsIndex.
//   U2  transform idempotent (already has the block → unchanged).
//   U3  transform returns unchanged with no anchor (no entity-create / nav).
//   U4  transform falls back to after the ProjectNavButtons fence when the
//       entity-create doc-note block is absent.
//   A   heal injects into a type:docs-hub note + writes .sauce-backup + healed history.
//   B   heal idempotent (second pass no-op).
//   C   non-docs-hub (type:doc-note) untouched.
//   D   docs-hub without any anchor → no_anchor_found warning, no write.
//   E   empty spice/projects → no throw.

"use strict";

const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const { applyDocBulkMoveActionsBackfill, _injectDocBulkMoveActionsBody } = install;

for (const [n, f] of [["applyDocBulkMoveActionsBackfill", applyDocBulkMoveActionsBackfill], ["_injectDocBulkMoveActionsBody", _injectDocBulkMoveActionsBody]]) {
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

let pass = 0, fail = 0; const failures = [];
const ok = (label, cond, detail) => { if (cond) { pass++; console.log(`  ok  ${label}`); } else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); } };

// A canonical existing Docs hub (pre-PR3): nav + "+ New Doc" entity-create + `---` + ProjectDocsIndex, NO DocBulkMoveActions.
const HUB = [
  "---", "type: docs-hub", "project: \"[[Demo]]\"", "project_slug: demo", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
  "```dataviewjs", '// entity-create:doc-note — installer-managed; do not delete this comment', 'await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "doc-note" }] });', "```", "",
  "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex" });', "```", "",
].join("\n");

async function run() {
  // ── pure transform ────────────────────────────────────────────────────────
  {
    const out = _injectDocBulkMoveActionsBody(HUB);
    ok("DBMH-U1 transform injects DocBulkMoveActions block", out.includes('class: "DocBulkMoveActions"') && out !== HUB);
    const ecIdx = out.indexOf('instance: "doc-note"');
    const dbmIdx = out.indexOf('class: "DocBulkMoveActions"');
    const divIdx = out.indexOf("\n---", ecIdx);
    const indexIdx = out.indexOf('class: "ProjectDocsIndex"');
    ok("DBMH-U1b block lands after +New Doc, before the divider + ProjectDocsIndex",
      ecIdx < dbmIdx && dbmIdx < divIdx && divIdx < indexIdx);

    ok("DBMH-U2 transform idempotent", _injectDocBulkMoveActionsBody(out) === out);

    const noAnchor = "---\ntype: docs-hub\n---\n\n# Plain hub\n\ntext\n";
    ok("DBMH-U3 no anchor → unchanged", _injectDocBulkMoveActionsBody(noAnchor) === noAnchor);

    const navOnly = [
      "---", "type: docs-hub", "---", "",
      "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
      "---", "", "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex" });', "```", "",
    ].join("\n");
    const fb = _injectDocBulkMoveActionsBody(navOnly);
    ok("DBMH-U4 no entity-create → falls back to after ProjectNavButtons fence",
      fb.includes('class: "DocBulkMoveActions"') &&
      fb.indexOf('class: "DocBulkMoveActions"') > fb.indexOf('class: "ProjectNavButtons"') &&
      fb.indexOf('class: "DocBulkMoveActions"') < fb.indexOf('class: "ProjectDocsIndex"'));
  }

  // ── heal driver ─────────────────────────────────────────────────────────────
  // A
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: HUB });
    const history = [];
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("DBMH-A injected into docs-hub", after.includes('class: "DocBulkMoveActions"'));
    ok("DBMH-A .sauce-backup written", [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + p)));
    ok("DBMH-A healed history", history.some((h) => h.step === "doc_bulk_move_actions_backfill" && h.action === "healed" && h.target === p));
  }
  // B
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: HUB });
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, [], GIT);
    const afterFirst = adapter._files.get(p);
    const h2 = [];
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, h2, GIT);
    ok("DBMH-B idempotent (byte-identical second pass)", adapter._files.get(p) === afterFirst);
    ok("DBMH-B second pass records skipped", h2.some((h) => h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
  }
  // C — non-docs-hub untouched (a doc-note carrying an entity-create anchor would otherwise match)
  {
    const p = "spice/projects/demo/docs/knowledge/Note.md";
    const body = "---\ntype: doc-note\n---\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"ProjectNavButtons\" });\n```\n---\n\n# doc\n";
    const adapter = makeAdapter({ [p]: body });
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("DBMH-C non-docs-hub untouched", adapter._files.get(p) === body);
  }
  // D — docs-hub without anchor → warning, no write
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const body = "---\ntype: docs-hub\n---\n\n# No chrome\n\ntext\n";
    const adapter = makeAdapter({ [p]: body });
    const history = [];
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, history, GIT);
    ok("DBMH-D anchorless docs-hub unchanged", adapter._files.get(p) === body);
    ok("DBMH-D no_anchor_found warning", history.some((h) => h.action === "no_anchor_found" && h.target === p));
  }
  // E — empty spice/projects → no throw
  {
    let threw = false;
    try { await applyDocBulkMoveActionsBackfill(makeTp(makeAdapter({})), {}, {}, [], GIT); } catch (_e) { threw = true; }
    ok("DBMH-E empty vault no throw", !threw);
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`); for (const f of failures) console.log("  - " + f); process.exit(1);
}
run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
