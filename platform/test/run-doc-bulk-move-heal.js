#!/usr/bin/env node
// run-doc-bulk-move-heal.js — Project Doc Updating Wiring PR5 behavioral harness
// for applyDocBulkMoveActionsBackfill + _injectDocBulkMoveActionsBody, PLUS the
// docs-hub modernize heal (applyDocsHubModernizeHeal + _modernizeDocsHubBody) in
// platform/install.js. Zero-dep; in-memory adapter stub (mirrors
// run-doc-leaf-actions-heal.js). Reverting install.js drops the exports →
// this harness FATALs → red (Gate B Layer 1 mutation signal).
//
// NOTE (docs-hub modernize cycle): the DocBulkMoveActions backfill was NEUTERED
// for docs-hub notes — "Move docs" now lives inside the renderActionRow block
// (ProjectDocsIndex.renderActionRow), and applyDocsHubModernizeHeal removes the
// standalone block from legacy bodies. The backfill must NOT re-inject it, so the
// old DBMH-A (inject into docs-hub) + DBMH-D (no_anchor_found on docs-hub) assert
// REMOVED behaviour and are replaced with skip-assertions. The PURE
// _injectDocBulkMoveActionsBody transform (U1..U4) is unchanged + still exercised.
//
// Coverage:
//   DBMH-U1..U4  the PURE transform still injects/idempotent/anchors (unchanged).
//   DBMH-A       heal SKIPS a legacy docs-hub note (does NOT re-inject; no write).
//   DBMH-B       heal idempotent (no-op on docs-hub, records skipped).
//   DBMH-C       non-docs-hub (type:doc-note) untouched.
//   DBMH-D       docs-hub is skipped, never warns no_anchor_found.
//   DBMH-E       empty spice/projects → no throw.
//   DHMH-*       docs-hub MODERNIZE heal: pure transform + driver + .sauce-backup
//                + idempotency + non-docs-hub untouched + empty-vault safe.

"use strict";

const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const {
  applyDocBulkMoveActionsBackfill,
  _injectDocBulkMoveActionsBody,
  applyDocsHubModernizeHeal,
  _modernizeDocsHubBody,
} = install;

for (const [n, f] of [
  ["applyDocBulkMoveActionsBackfill", applyDocBulkMoveActionsBackfill],
  ["_injectDocBulkMoveActionsBody", _injectDocBulkMoveActionsBody],
  ["applyDocsHubModernizeHeal", applyDocsHubModernizeHeal],
  ["_modernizeDocsHubBody", _modernizeDocsHubBody],
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

// The LEGACY headspace shape the modernize heal repairs: NO Breadcrumb, a
// standalone DocBulkMoveActions block, DOUBLED literal `---` dividers, and NO
// renderActionRow block.
const LEGACY_DOCSHUB = [
  "---", "type: docs-hub", "project: \"[[Sauce]]\"", "project_slug: sauce", "tags:", "  - docs-hub", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "DocBulkMoveActions" });', "```", "",
  "---", "", "---", "",
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

  // ── heal driver (NEUTERED: docs-hub is skipped, never re-injected) ───────────
  // A — a legacy docs-hub note is SKIPPED by the backfill (no standalone block
  //     added; not written; recorded as skipped). Move docs is renderActionRow now.
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: HUB });
    const history = [];
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("DBMH-A backfill does NOT inject DocBulkMoveActions into docs-hub (neutered)", !after.includes('class: "DocBulkMoveActions"') && after === HUB);
    ok("DBMH-A no write (no .sauce-backup)", ![...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/")));
    ok("DBMH-A no healed history for docs-hub", !history.some((h) => h.step === "doc_bulk_move_actions_backfill" && h.action === "healed" && h.target === p));
    ok("DBMH-A records skipped", history.some((h) => h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
  }
  // B — idempotent no-op on docs-hub across passes.
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const adapter = makeAdapter({ [p]: HUB });
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, [], GIT);
    const afterFirst = adapter._files.get(p);
    const h2 = [];
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, h2, GIT);
    ok("DBMH-B idempotent (byte-identical second pass)", adapter._files.get(p) === afterFirst && afterFirst === HUB);
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
  // D — a docs-hub without any chrome anchor is now simply SKIPPED (neutered) —
  //     the backfill no longer emits no_anchor_found for docs-hub notes at all.
  {
    const p = "spice/projects/demo/docs/Docs.md";
    const body = "---\ntype: docs-hub\n---\n\n# No chrome\n\ntext\n";
    const adapter = makeAdapter({ [p]: body });
    const history = [];
    await applyDocBulkMoveActionsBackfill(makeTp(adapter), {}, {}, history, GIT);
    ok("DBMH-D anchorless docs-hub unchanged", adapter._files.get(p) === body);
    ok("DBMH-D no_anchor_found NOT emitted (docs-hub skipped)", !history.some((h) => h.action === "no_anchor_found" && h.target === p));
  }
  // E — empty spice/projects → no throw
  {
    let threw = false;
    try { await applyDocBulkMoveActionsBackfill(makeTp(makeAdapter({})), {}, {}, [], GIT); } catch (_e) { threw = true; }
    ok("DBMH-E empty vault no throw", !threw);
  }

  // ── docs-hub MODERNIZE heal (applyDocsHubModernizeHeal + _modernizeDocsHubBody) ─
  // Pure transform
  {
    const r1 = _modernizeDocsHubBody(LEGACY_DOCSHUB);
    ok("DHMH-U1 legacy body is changed", r1.changed === true && r1.body !== LEGACY_DOCSHUB);
    ok("DHMH-U1 removes standalone DocBulkMoveActions", !r1.body.includes('class: "DocBulkMoveActions"'));
    ok("DHMH-U1 injects renderActionRow block", /method:\s*"renderActionRow"/.test(r1.body));
    ok("DHMH-U1 renderActionRow keeps entity-create marker", r1.body.includes("entity-create:doc-note"));
    ok("DHMH-U1 injects Breadcrumb as first block", /class:\s*"Breadcrumb"/.test(r1.body) && r1.body.indexOf("Breadcrumb") < r1.body.indexOf("SpaceNavButtons"));
    ok("DHMH-U1 keeps plain ProjectDocsIndex block", /\{\s*class:\s*"ProjectDocsIndex"\s*\}/.test(r1.body));
    const afterFm = r1.body.replace(/^---[\s\S]*?\n---\n/, "");
    ok("DHMH-U1 no doubled --- left in body", !/-{3,}\s*\n\s*-{3,}/.test(afterFm));
    ok("DHMH-U1 renderActionRow lands after ProjectNavButtons", r1.body.indexOf("ProjectNavButtons") < r1.body.indexOf("renderActionRow"));
    // idempotent
    const r2 = _modernizeDocsHubBody(r1.body);
    ok("DHMH-U2 modernize idempotent (changed:false, byte-identical)", r2.changed === false && r2.body === r1.body);
    // already-modern (template) → unchanged
    const MODERN = [
      "---", "type: docs-hub", "---", "",
      "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', "```", "",
      "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
      "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
      "```dataviewjs", "// entity-create:doc-note — installer-managed; do not delete this comment", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex", method: "renderActionRow" });', "```", "",
      "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex" });', "```", "",
    ].join("\n");
    ok("DHMH-U3 already-modern unchanged", _modernizeDocsHubBody(MODERN).changed === false);
    // user content after ProjectDocsIndex preserved
    const withUser = LEGACY_DOCSHUB + "\n\n## My notes\n\nsome prose\n";
    const ru = _modernizeDocsHubBody(withUser);
    ok("DHMH-U4 preserves user content after ProjectDocsIndex", ru.body.includes("## My notes") && ru.body.includes("some prose"));
  }
  // Heal driver — A: modernizes a legacy docs-hub note + backup + history.
  {
    const p = "spice/projects/sauce/docs/Docs.md";
    const adapter = makeAdapter({ [p]: LEGACY_DOCSHUB });
    const history = [];
    await applyDocsHubModernizeHeal(makeTp(adapter), { name: "project" }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("DHMH-A modernized (no DocBulkMoveActions, has renderActionRow + Breadcrumb)",
      !after.includes('class: "DocBulkMoveActions"') && /method:\s*"renderActionRow"/.test(after) && /class:\s*"Breadcrumb"/.test(after));
    ok("DHMH-A .sauce-backup written", [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + p)));
    ok("DHMH-A modernized history", history.some((h) => h.step === "docs_hub_modernize_heal" && h.action === "modernized" && h.target === p));
  }
  // Heal driver — B: idempotent (second pass byte-identical, records skipped).
  {
    const p = "spice/projects/sauce/docs/Docs.md";
    const adapter = makeAdapter({ [p]: LEGACY_DOCSHUB });
    await applyDocsHubModernizeHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    const afterFirst = adapter._files.get(p);
    const h2 = [];
    await applyDocsHubModernizeHeal(makeTp(adapter), { name: "project" }, {}, h2, GIT);
    ok("DHMH-B idempotent (byte-identical second pass)", adapter._files.get(p) === afterFirst);
    ok("DHMH-B second pass records skipped", h2.some((h) => h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
  }
  // Heal driver — C: non-docs-hub untouched.
  {
    const p = "spice/projects/sauce/docs/knowledge/Note.md";
    const body = "---\ntype: doc-note\n---\n\n# doc\n";
    const adapter = makeAdapter({ [p]: body });
    await applyDocsHubModernizeHeal(makeTp(adapter), { name: "project" }, {}, [], GIT);
    ok("DHMH-C non-docs-hub untouched", adapter._files.get(p) === body);
  }
  // Heal driver — E: empty spice/projects → no throw.
  {
    let threw = false;
    try { await applyDocsHubModernizeHeal(makeTp(makeAdapter({})), { name: "project" }, {}, [], GIT); } catch (_e) { threw = true; }
    ok("DHMH-E empty vault no throw", !threw);
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`); for (const f of failures) console.log("  - " + f); process.exit(1);
}
run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
