#!/usr/bin/env node
// run-kanban-status-sync.js — sub-asserts for v0.72.0's NEW kanban-status-sync
// mechanism. Three passes: manifest sanity (KSS-1..3) + class runtime
// (KSS-P1..P5 for parseBoardColumns, KSS-S1..S4 for slugifyStatus).
// No Obsidian runtime needed — Node-only.
//
// Usage: node platform/test/run-kanban-status-sync.js
// Exit: 0 = all pass; 1 = any fail.

"use strict";

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const MECH_DIR = path.join(WORKSHOP, "platform/mechanisms/kanban-status-sync");
const MANIFEST_PATH = path.join(MECH_DIR, "manifest.json");
const SOURCE_PATH = path.join(MECH_DIR, "kanban-status-sync.js");

let pass = 0;
let fail = 0;
const failures = [];

function assertEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fail++;
    failures.push(`FAIL: ${label}\n  expected ${e}\n  actual   ${a}`);
    console.log(`  FAIL: ${label}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

function assertTrue(label, cond, hint) {
  if (!cond) {
    fail++;
    failures.push(`FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    console.log(`  FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

// ── Pass 1: manifest sanity ───────────────────────────────────────────────

console.log("\n--- Pass 1: kanban-status-sync/manifest.json sanity ---");

assertTrue("KSS-1a: manifest.json exists", fs.existsSync(MANIFEST_PATH));

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  assertTrue("KSS-1b: manifest.json parses as JSON", false, e && e.message);
}
if (manifest) {
  assertTrue("KSS-1b: manifest.json parses as JSON", true);
  assertEq("KSS-1c: manifest.name === 'kanban-status-sync'", manifest.name, "kanban-status-sync");
  assertEq("KSS-1d: manifest.version === '0.1.0'", manifest.version, "0.1.0");
  assertEq("KSS-1e: manifest.kind === 'mechanism'", manifest.kind, "mechanism");

  assertEq("KSS-2: customjs_classes is ['KanbanStatusSync']", manifest.customjs_classes, ["KanbanStatusSync"]);

  const deps = manifest.depends_on || [];
  const depNames = deps.map((d) => d && d.name).filter(Boolean);
  assertTrue("KSS-3a: depends_on includes customjs-guard", depNames.indexOf("customjs-guard") >= 0);

  const files = manifest.files || [];
  const hasJsEntry = files.some((f) =>
    f && f.source === "kanban-status-sync.js" &&
    typeof f.dest === "string" &&
    f.dest.indexOf("kanban-status-sync/kanban-status-sync.js") >= 0
  );
  assertTrue("KSS-3b: files[] declares kanban-status-sync.js → scripts_path/kanban-status-sync/", hasJsEntry);
}

// ── Helper: load the KanbanStatusSync class from source via `new Function` with stub
// free vars. Mirrors the loadActivityFeedClass pattern in run-activity-feed.js Pass 3.
// Stubs are sufficient for pure static methods (parseBoardColumns, slugifyStatus,
// computeDiff). Instance-method tests would need real(er) stubs for app / customJS.
function loadKSS() {
  const src = fs.readFileSync(SOURCE_PATH, "utf8");
  return new Function("app", "customJS", "Notice", "window", src + "\nreturn KanbanStatusSync;")
    ({}, null, null, null);
}

// ── Pass 3: KanbanStatusSync.parseBoardColumns ────────────────────────────

console.log("\n--- Pass 3: KanbanStatusSync.parseBoardColumns ---");

let KanbanStatusSync = null;
try {
  KanbanStatusSync = loadKSS();
} catch (e) {
  assertTrue("KSS-P0: source loads via new Function", false, e && e.message);
}

if (KanbanStatusSync) {
  const board1 = [
    "## Backlog",
    "- [ ] [[Note A]]",
    "- [ ] [[Note B]]",
    "## In Progress",
    "- [ ] [[Note C]]",
    "## Done",
    "- [x] [[Note D]]",
  ].join("\n");

  const cols1 = KanbanStatusSync.parseBoardColumns(board1);
  assertEq("KSS-P1: parseBoardColumns returns 4 entries for 3-column board",
    cols1.length, 4);
  assertEq("KSS-P2: first entry column is 'Backlog'",
    cols1[0] && cols1[0].column, "Backlog");
  assertEq("KSS-P3: first entry path is 'Note A'",
    cols1[0] && cols1[0].path, "Note A");
  assertEq("KSS-P4: third entry column is 'In Progress'",
    cols1[2] && cols1[2].column, "In Progress");
  assertEq("KSS-P5: parseBoardColumns([]) returns []",
    KanbanStatusSync.parseBoardColumns(""), []);
}

// ── Pass 3b: KanbanStatusSync.slugifyStatus ───────────────────────────────

console.log("\n--- Pass 3b: KanbanStatusSync.slugifyStatus ---");

if (KanbanStatusSync) {
  assertEq("KSS-S1: 'In Progress' → 'in-progress'",
    KanbanStatusSync.slugifyStatus("In Progress"), "in-progress");
  assertEq("KSS-S2: 'Done!' → 'done'",
    KanbanStatusSync.slugifyStatus("Done!"), "done");
  assertEq("KSS-S3: '  TO   DO  ' → 'to-do'",
    KanbanStatusSync.slugifyStatus("  TO   DO  "), "to-do");
  assertEq("KSS-S4: '' → ''",
    KanbanStatusSync.slugifyStatus(""), "");
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\nrun-kanban-status-sync.js: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\n--- Failures ---");
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
