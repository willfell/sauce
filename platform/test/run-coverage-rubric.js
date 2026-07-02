#!/usr/bin/env node
// run-coverage-rubric.js — regression coverage for scripts/lib/coverage-rubric.js.
//
// Pins scoreWidgetRender's harness-scanning behavior: a render widget is
// "covered" when it is exercised by ANY render-test harness, not just
// run-renderer.js. Cold-load render-guard harnesses (run-project-render-guards.js)
// drive a widget's render() through the embed/null-current guard path — that IS a
// render test. Before this fix the rubric scanned run-renderer.js alone and
// mis-scored guard-tested widgets (ProjectWorkstreams, ProjectWorkstreamManager,
// ProjectNotesCards, ProjectReferencedByCards, ProjectNavButtons) as coverage
// gaps, which the deterministic Scout kept re-proposing as un-actionable items.
//
// Red-without-fix probe: ProjectWorkstreams is referenced in
// run-project-render-guards.js but NOT in run-renderer.js. With the single-file
// scan it scores uncovered → CRUB-1 fails. Zero-dep; runs the REAL rubric against
// the REAL project blueprint surface. "PASS N/N" exit 0, "FAIL X/N" exit 1.

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const rubric = require(path.join(REPO_ROOT, "scripts", "lib", "coverage-rubric.js"));

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); }
}

// Real project blueprint surface + manifest — same shape regen-coverage-matrix.js
// builds when it scores surfaces.
const surface = {
  kind: "blueprint",
  name: "project",
  dir: path.join(REPO_ROOT, "platform", "blueprints", "project"),
};
const manifestPath = path.join(surface.dir, "manifest.json");
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : {};

const res = rubric.scoreWidgetRender(surface, manifest, REPO_ROOT);

// Sanity: the project surface has render() widgets, so the rubric must score it.
ok("CRUB-0 scoreWidgetRender scores the project surface", res && typeof res.score === "number" && Array.isArray(res.widgets),
  res ? `score=${res.score} widgets=${res.widgets && res.widgets.length}` : "null result");

function widget(name) { return (res.widgets || []).find(w => w.widget === name); }

// CRUB-1 — the red-without-fix probe. ProjectWorkstreams is render-guard-tested in
// run-project-render-guards.js but absent from run-renderer.js. Reverting the
// multi-harness scan drops it back to uncovered and fails here.
const pw = widget("ProjectWorkstreams");
ok("CRUB-1 render-guard-only widget (ProjectWorkstreams) is credited as covered",
  !!pw && pw.covered === true,
  pw ? `covered=${pw.covered}` : "ProjectWorkstreams not among scored render widgets");

// CRUB-2 — every project widget that is render-guard-tested (and present as a
// render widget in the manifest) is credited. Only assert on the ones the rubric
// actually scored as widgets (guards against manifest drift).
const GUARD_TESTED = ["ProjectNavButtons", "ProjectWorkstreams", "ProjectWorkstreamManager", "ProjectNotesCards", "ProjectReferencedByCards"];
const scoredGuardTested = GUARD_TESTED.map(widget).filter(Boolean);
ok("CRUB-2 scored render-guard-tested widgets are all covered",
  scoredGuardTested.length > 0 && scoredGuardTested.every(w => w.covered === true),
  `scored=${scoredGuardTested.length} covered=${scoredGuardTested.filter(w => w.covered).length}`);

// CRUB-3 — anti-tautology / negative control. The fix credits render-guard
// harnesses, it does NOT mark everything covered: at least one render widget with
// no harness reference must still report uncovered (else the check is meaningless).
const uncovered = (res.widgets || []).filter(w => w.covered === false);
ok("CRUB-3 widgets absent from every harness stay uncovered (not a blanket pass)",
  res.covered < res.total && uncovered.length > 0,
  `covered=${res.covered}/${res.total} uncovered=${uncovered.length}`);

console.log("");
if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
console.log(`FAIL ${fail}/${pass + fail}`);
for (const f of failures) console.log("  - " + f);
process.exit(1);
