#!/usr/bin/env node
// run-doc-leaf-actions-heal.js — Project Doc Updating Wiring PR4 behavioral
// harness for applyDocLeafActionsBackfill + _injectDocLeafActionsBody in
// platform/install.js. Zero-dep; in-memory adapter stub (mirrors
// run-v0127-project-hub-heal.js). Reverting install.js drops both exports →
// this harness FATALs → red (the Gate B Layer 1 mutation signal).
//
// Coverage (DLAH-*):
//   U1  transform injects the DocLeafActions block AFTER the `---` divider.
//   U2  transform is idempotent (body already has the block → unchanged).
//   U3  transform returns body unchanged when there's no ProjectNavButtons anchor.
//   U4  transform falls back to after-fence when no `---` follows.
//   A   heal injects into a type:doc-note note + writes .sauce-backup + healed history.
//   B   heal is idempotent (second pass no-op).
//   C   non-doc-note (type:project) under a project dir is untouched.
//   D   doc-note without a ProjectNavButtons anchor → no_anchor_found warning, no write.
//   E   empty spice/projects → no throw.

"use strict";

const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const { applyDocLeafActionsBackfill, _injectDocLeafActionsBody } = install;

for (const [n, f] of [["applyDocLeafActionsBackfill", applyDocLeafActionsBackfill], ["_injectDocLeafActionsBody", _injectDocLeafActionsBody]]) {
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

// A canonical existing doc note (post-NAV-SEP): nav chrome + `---` + body, NO DocLeafActions.
const DOC = [
  "---", "type: doc-note", "project: \"[[Demo]]\"", "section: Knowledge", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```",
  "---", "", "# My Doc", "", "Some content.", "",
].join("\n");

async function run() {
  // ── pure transform ────────────────────────────────────────────────────────
  {
    const out = _injectDocLeafActionsBody(DOC);
    ok("DLAH-U1 transform injects DocLeafActions block", out.includes('class: "DocLeafActions"') && out !== DOC);
    // block must sit AFTER the ProjectNavButtons `---` divider and BEFORE the doc body.
    const navIdx = out.indexOf('class: "ProjectNavButtons"');
    const divIdx = out.indexOf("\n---", navIdx);
    const dlaIdx = out.indexOf('class: "DocLeafActions"');
    const bodyIdx = out.indexOf("# My Doc");
    ok("DLAH-U1b block lands after the divider, before body", navIdx < divIdx && divIdx < dlaIdx && dlaIdx < bodyIdx);

    ok("DLAH-U2 transform idempotent (already has block)", _injectDocLeafActionsBody(out) === out);

    const noNav = "---\ntype: doc-note\n---\n\n# Plain doc\n\ntext\n";
    ok("DLAH-U3 no ProjectNavButtons anchor → unchanged", _injectDocLeafActionsBody(noNav) === noNav);

    const noDivider = [
      "---", "type: doc-note", "---", "",
      "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
      "# Body no divider", "",
    ].join("\n");
    const fb = _injectDocLeafActionsBody(noDivider);
    ok("DLAH-U4 no divider → falls back to after-fence inject",
      fb.includes('class: "DocLeafActions"') &&
      fb.indexOf('class: "DocLeafActions"') > fb.indexOf('class: "ProjectNavButtons"') &&
      fb.indexOf('class: "DocLeafActions"') < fb.indexOf("# Body no divider"));
  }

  // ── heal driver ─────────────────────────────────────────────────────────────
  // A
  {
    const p = "spice/projects/demo/docs/knowledge/My Doc.md";
    const adapter = makeAdapter({ [p]: DOC });
    const history = [];
    await applyDocLeafActionsBackfill(makeTp(adapter), {}, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("DLAH-A injected into doc-note", after.includes('class: "DocLeafActions"'));
    ok("DLAH-A .sauce-backup written", [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + p)));
    ok("DLAH-A healed history", history.some((h) => h.step === "doc_leaf_actions_backfill" && h.action === "healed" && h.target === p));
  }
  // B — idempotent
  {
    const p = "spice/projects/demo/docs/knowledge/My Doc.md";
    const adapter = makeAdapter({ [p]: DOC });
    await applyDocLeafActionsBackfill(makeTp(adapter), {}, {}, [], GIT);
    const afterFirst = adapter._files.get(p);
    const h2 = [];
    await applyDocLeafActionsBackfill(makeTp(adapter), {}, {}, h2, GIT);
    ok("DLAH-B idempotent (byte-identical second pass)", adapter._files.get(p) === afterFirst);
    ok("DLAH-B second pass records skipped", h2.some((h) => h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
  }
  // C — non-doc-note untouched
  {
    const p = "spice/projects/demo/Demo.md";
    const body = "---\ntype: project\n---\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"ProjectNavButtons\" });\n```\n---\n\nhub body\n";
    const adapter = makeAdapter({ [p]: body });
    await applyDocLeafActionsBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("DLAH-C non-doc-note untouched", adapter._files.get(p) === body);
  }
  // D — doc-note without anchor → warning, no write
  {
    const p = "spice/projects/demo/docs/orphan/Orphan.md";
    const body = "---\ntype: doc-note\n---\n\n# No chrome\n\ntext\n";
    const adapter = makeAdapter({ [p]: body });
    const history = [];
    await applyDocLeafActionsBackfill(makeTp(adapter), {}, {}, history, GIT);
    ok("DLAH-D anchorless doc-note unchanged", adapter._files.get(p) === body);
    ok("DLAH-D no_anchor_found warning", history.some((h) => h.action === "no_anchor_found" && h.target === p));
  }
  // E — empty spice/projects → no throw
  {
    let threw = false;
    try { await applyDocLeafActionsBackfill(makeTp(makeAdapter({})), {}, {}, [], GIT); } catch (_e) { threw = true; }
    ok("DLAH-E empty vault no throw", !threw);
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`); for (const f of failures) console.log("  - " + f); process.exit(1);
}
run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
