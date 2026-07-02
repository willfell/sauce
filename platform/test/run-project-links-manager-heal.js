#!/usr/bin/env node
// run-project-links-manager-heal.js — Project Links Wiring PR4 behavioral harness
// for applyProjectLinksManagerBackfill + _injectProjectLinksManagerBody in
// platform/install.js. Zero-dep; in-memory adapter stub (mirrors
// run-doc-leaf-actions-heal.js). Reverting install.js drops both exports →
// this harness FATALs → red (Gate B Layer 1 signal).
//
// Coverage (PLMH-*):
//   U1  transform injects the ProjectLinksManager block BEFORE the ProjectLinksPanel block.
//   U2  transform idempotent (already has the block → unchanged).
//   U3  transform returns unchanged with no ProjectLinksPanel anchor.
//   A   heal injects into a type:links-hub note + writes .sauce-backup + healed history.
//   B   heal idempotent (second pass no-op).
//   C   non-links-hub (type:doc-note carrying a ProjectLinksPanel line) untouched.
//   D   links-hub without a ProjectLinksPanel anchor → no_anchor_found warning, no write.
//   E   empty spice/projects → no throw.

"use strict";

const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const { applyProjectLinksManagerBackfill, _injectProjectLinksManagerBody } = install;

for (const [n, f] of [["applyProjectLinksManagerBackfill", applyProjectLinksManagerBackfill], ["_injectProjectLinksManagerBody", _injectProjectLinksManagerBody]]) {
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

// A canonical existing Link Hub backfilled pre-PR2: nav + `---` + ProjectLinksPanel, NO ProjectLinksManager.
const HUB = [
  "---", "type: links-hub", "links: []", "tags:", "  - links-hub", "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });', "```", "",
  "---", "",
  "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "ProjectLinksPanel" });', "```", "",
].join("\n");

async function run() {
  // ── pure transform ────────────────────────────────────────────────────────
  {
    const out = _injectProjectLinksManagerBody(HUB);
    ok("PLMH-U1 transform injects ProjectLinksManager block", out.includes('class: "ProjectLinksManager"') && out !== HUB);
    const mgrIdx = out.indexOf('class: "ProjectLinksManager"');
    const panelIdx = out.indexOf('class: "ProjectLinksPanel"');
    ok("PLMH-U1b manager block lands BEFORE the panel block", mgrIdx > -1 && panelIdx > -1 && mgrIdx < panelIdx);

    ok("PLMH-U2 transform idempotent", _injectProjectLinksManagerBody(out) === out);

    const noPanel = "---\ntype: links-hub\n---\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"ProjectNavButtons\" });\n```\n---\n\n# no panel\n";
    ok("PLMH-U3 no ProjectLinksPanel anchor → unchanged", _injectProjectLinksManagerBody(noPanel) === noPanel);
  }

  // ── heal driver ─────────────────────────────────────────────────────────────
  // A
  {
    const p = "spice/projects/demo/Links Hub.md";
    const adapter = makeAdapter({ [p]: HUB });
    const history = [];
    await applyProjectLinksManagerBackfill(makeTp(adapter), {}, {}, history, GIT);
    const after = adapter._files.get(p);
    ok("PLMH-A injected into links-hub", after.includes('class: "ProjectLinksManager"') && after.indexOf('ProjectLinksManager') < after.indexOf('ProjectLinksPanel'));
    ok("PLMH-A .sauce-backup written", [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + p)));
    ok("PLMH-A healed history", history.some((h) => h.step === "project_links_manager_backfill" && h.action === "healed" && h.target === p));
  }
  // B
  {
    const p = "spice/projects/demo/Links Hub.md";
    const adapter = makeAdapter({ [p]: HUB });
    await applyProjectLinksManagerBackfill(makeTp(adapter), {}, {}, [], GIT);
    const afterFirst = adapter._files.get(p);
    const h2 = [];
    await applyProjectLinksManagerBackfill(makeTp(adapter), {}, {}, h2, GIT);
    ok("PLMH-B idempotent (byte-identical second pass)", adapter._files.get(p) === afterFirst);
    ok("PLMH-B second pass records skipped", h2.some((h) => h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
  }
  // C — non-links-hub carrying a ProjectLinksPanel line is untouched (type filter)
  {
    const p = "spice/projects/demo/docs/Note.md";
    const body = "---\ntype: doc-note\n---\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"ProjectLinksPanel\" });\n```\n";
    const adapter = makeAdapter({ [p]: body });
    await applyProjectLinksManagerBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("PLMH-C non-links-hub untouched", adapter._files.get(p) === body);
  }
  // D — links-hub without ProjectLinksPanel → warning, no write
  {
    const p = "spice/projects/demo/Links Hub.md";
    const body = "---\ntype: links-hub\n---\n\n# no panel\n\ntext\n";
    const adapter = makeAdapter({ [p]: body });
    const history = [];
    await applyProjectLinksManagerBackfill(makeTp(adapter), {}, {}, history, GIT);
    ok("PLMH-D anchorless links-hub unchanged", adapter._files.get(p) === body);
    ok("PLMH-D no_anchor_found warning", history.some((h) => h.action === "no_anchor_found" && h.target === p));
  }
  // E — empty spice/projects → no throw
  {
    let threw = false;
    try { await applyProjectLinksManagerBackfill(makeTp(makeAdapter({})), {}, {}, [], GIT); } catch (_e) { threw = true; }
    ok("PLMH-E empty vault no throw", !threw);
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`); for (const f of failures) console.log("  - " + f); process.exit(1);
}
run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
