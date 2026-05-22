#!/usr/bin/env node
// run-kanban-status-sync.js — sub-asserts for the v0.72.0 kanban-status-sync mechanism.
// Currently shipped passes:
//   Pass 1 — manifest sanity (KSS-1..3)
//   Pass 3 — runtime asserts for pure static helpers (KSS-P1..P5 parseBoardColumns,
//            KSS-S1..S4 slugifyStatus)
// Pass 2 (source lint KSS-L1..L8) is added by the syncBoard / syncAllBoards task.
// Pass 3c (computeDiff KSS-D1..D5) is added by the computeDiff task.
//
// Mirrors run-activity-feed.js structure.
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
  // KSS-P1: simple 2-column board, 2 cards
  const board1 = [
    "---", "kanban-plugin: board", "---", "",
    "## In Planning", "", "- [[Refactor auth flow]]", "",
    "## In Progress", "", "- [[Write migration plan]]", "",
  ].join("\n");
  assertEq("KSS-P1: parse 2 columns, 2 cards",
    KanbanStatusSync.parseBoardColumns(board1),
    { "Refactor auth flow": "In Planning", "Write migration plan": "In Progress" });

  // KSS-P2: bare wikilinks (not in list items) are NOT cards
  const board2 = "## A\n- [[only-this]]\n[[ignored]]\n";
  assertEq("KSS-P2: bare wikilinks under a heading are not cards",
    KanbanStatusSync.parseBoardColumns(board2),
    { "only-this": "A" });

  // KSS-P3: wikilink with alias — basename only is stored
  const board3 = "## Done\n- [[some/long/path|Alias]]\n";
  assertEq("KSS-P3: wikilink alias stripped, linkpath preserved",
    KanbanStatusSync.parseBoardColumns(board3),
    { "some/long/path": "Done" });

  // KSS-P4: empty board returns {}
  assertEq("KSS-P4: empty board → empty map",
    KanbanStatusSync.parseBoardColumns(""), {});

  // KSS-P5: ignore frontmatter content; only ## headings count
  const board5 = "---\nkanban-plugin: board\nfoo: '## Not A Column'\n---\n## Real\n- [[x]]\n";
  assertEq("KSS-P5: frontmatter content not parsed as headings",
    KanbanStatusSync.parseBoardColumns(board5),
    { "x": "Real" });
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

// ── Pass 3c: KanbanStatusSync.computeDiff ─────────────────────────────────

console.log("\n--- Pass 3c: KanbanStatusSync.computeDiff ---");

if (KanbanStatusSync) {
  // currentMap shape: { [linkpath]: rawColumnLabel }
  // priorMap shape:   { [linkpath]: { status: <slug or 'archived'>, column: <raw> | null } }

  // KSS-D1: pure move
  assertEq("KSS-D1: move detected",
    KanbanStatusSync.computeDiff(
      { "card-a": "In Progress" },
      { "card-a": { status: "in-planning", column: "In Planning" } }),
    { moves: [{ linkpath: "card-a", fromStatus: "in-planning", fromColumn: "In Planning", toStatus: "in-progress", toColumn: "In Progress" }],
      creates: [],
      archives: [] });

  // KSS-D2: pure create (no prior entry)
  assertEq("KSS-D2: create detected (no prior entry)",
    KanbanStatusSync.computeDiff(
      { "card-b": "In Planning" },
      {}),
    { moves: [],
      creates: [{ linkpath: "card-b", toStatus: "in-planning", toColumn: "In Planning" }],
      archives: [] });

  // KSS-D3: pure archive (prior present, current missing)
  assertEq("KSS-D3: archive detected (prior present, current missing)",
    KanbanStatusSync.computeDiff(
      {},
      { "card-c": { status: "in-progress", column: "In Progress" } }),
    { moves: [],
      creates: [],
      archives: [{ linkpath: "card-c", fromStatus: "in-progress", fromColumn: "In Progress" }] });

  // KSS-D4: no-op (same column)
  assertEq("KSS-D4: no diff when status unchanged",
    KanbanStatusSync.computeDiff(
      { "card-d": "Done" },
      { "card-d": { status: "done", column: "Done" } }),
    { moves: [], creates: [], archives: [] });

  // KSS-D5: archived card returning to the board → counted as create
  assertEq("KSS-D5: archived card returning → create",
    KanbanStatusSync.computeDiff(
      { "card-e": "In Progress" },
      { "card-e": { status: "archived", column: null } }),
    { moves: [],
      creates: [{ linkpath: "card-e", toStatus: "in-progress", toColumn: "In Progress" }],
      archives: [] });
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\nrun-kanban-status-sync.js: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\n--- Failures ---");
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
