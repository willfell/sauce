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
const VERSION_SNAPSHOT = require("./fixtures/component-versions.snapshot.json");

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
  assertEq("KSS-1d: manifest.version matches snapshot", manifest.version, VERSION_SNAPSHOT.components["kanban-status-sync"]);
  assertEq("KSS-1e: manifest.kind === 'mechanism'", manifest.kind, "mechanism");

  // KSS-2 expanded in v0.2.0 (sauce v0.73.0) to include KanbanStatusSyncInit.
  assertEq("KSS-2: customjs_classes is ['KanbanStatusSync','KanbanStatusSyncInit']",
    manifest.customjs_classes, ["KanbanStatusSync", "KanbanStatusSyncInit"]);

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

  // KSS-INIT-* (v0.2.0 sauce v0.73.0): NEW startup-script class wiring.
  assertEq("KSS-INIT-1: customjs_startup_scripts === ['KanbanStatusSyncInit']",
    manifest.customjs_startup_scripts, ["KanbanStatusSyncInit"]);
  const hasInitFileEntry = files.some((f) =>
    f && f.source === "kanban-status-sync-init.js" &&
    typeof f.dest === "string" &&
    f.dest.indexOf("kanban-status-sync/kanban-status-sync-init.js") >= 0
  );
  assertTrue("KSS-INIT-2: files[] declares kanban-status-sync-init.js entry", hasInitFileEntry);
}

// ── Pass 1b: KanbanStatusSyncInit source lint ─────────────────────────────

console.log("\n--- Pass 1b: kanban-status-sync-init.js source lint (v0.2.0) ---");

const INIT_PATH = path.join(MECH_DIR, "kanban-status-sync-init.js");
assertTrue("KSS-INIT-3a: kanban-status-sync-init.js exists", fs.existsSync(INIT_PATH));

if (fs.existsSync(INIT_PATH)) {
  let initSrc = "";
  try { initSrc = fs.readFileSync(INIT_PATH, "utf8"); }
  catch (e) { assertTrue("KSS-INIT-3b: readFileSync succeeds", false, e && e.message); }

  if (initSrc.length > 0) {
    let initParseErr = null;
    try {
      new Function("app", "customJS", "Notice", "window", initSrc + "\nreturn KanbanStatusSyncInit;");
    } catch (e) { initParseErr = e; }
    assertTrue("KSS-INIT-3c: init source parses via new Function() without throwing",
      !initParseErr, initParseErr && initParseErr.message);

    // CustomJS file contract — must be a single class expression.
    let cjsErr = null;
    let cjsClass = null;
    try { cjsClass = eval("(" + initSrc + ")"); }
    catch (e) { cjsErr = e; }
    assertTrue("KSS-INIT-3d: file loads under customJS `(${file})` contract",
      !cjsErr, cjsErr && cjsErr.message);
    if (cjsClass) {
      const inst = new cjsClass();
      assertTrue("KSS-INIT-3e: class name === 'KanbanStatusSyncInit'",
        inst.constructor && inst.constructor.name === "KanbanStatusSyncInit");
      assertTrue("KSS-INIT-3f: instance.invoke is a function",
        typeof inst.invoke === "function");
    }

    // Behavior: must register the resync command + retry-with-backoff for dataview.
    assertTrue("KSS-INIT-4: registers app.commands.addCommand call",
      /app\.commands\.addCommand\(/.test(initSrc));
    assertTrue("KSS-INIT-5: command id matches 'kanban-status-sync:resync-now'",
      /['"]kanban-status-sync:resync-now['"]/.test(initSrc));
    assertTrue("KSS-INIT-6: command name surfaces 'Sauce: Re-sync kanban boards'",
      /Sauce: Re-sync kanban boards/.test(initSrc));
    assertTrue("KSS-INIT-7: dataview-readiness retry helper present (_waitForDataview)",
      /_waitForDataview/.test(initSrc));
    assertTrue("KSS-INIT-8: calls customJS.KanbanStatusSync.syncAllBoards",
      /customJS\.KanbanStatusSync\.syncAllBoards/.test(initSrc));
    // Mobile safety / landmine #23: must NOT read file.mtime.
    assertTrue("KSS-INIT-9: NO file.mtime usage in init (landmine #23)",
      !/file\.mtime/.test(initSrc));
  }
}

// ── Pass 2: class source lint ─────────────────────────────────────────────

console.log("\n--- Pass 2: kanban-status-sync.js source lint ---");

let _kssSrc = "";
try { _kssSrc = fs.readFileSync(SOURCE_PATH, "utf8"); }
catch (e) { assertTrue("KSS-L0: readFileSync succeeds", false, e && e.message); }

if (_kssSrc.length > 0) {
  let parseErr = null;
  try {
    new Function("app", "customJS", "Notice", "window", _kssSrc + "\nreturn KanbanStatusSync;");
  } catch (e) { parseErr = e; }
  assertTrue("KSS-L1: source parses via new Function() without throwing",
    !parseErr, parseErr && parseErr.message);

  const classMatches = _kssSrc.match(/class\s+KanbanStatusSync\b/g) || [];
  assertEq("KSS-L2: exactly one 'class KanbanStatusSync' declaration", classMatches.length, 1);

  assertTrue("KSS-L3: syncAllBoards method present", /\bsyncAllBoards\s*\(/.test(_kssSrc));
  assertTrue("KSS-L4: syncBoard method present",     /\bsyncBoard\s*\(/.test(_kssSrc));

  assertTrue("KSS-L5: app.fileManager.processFrontMatter used for FM writes",
    /app\.fileManager\.processFrontMatter/.test(_kssSrc));

  assertTrue("KSS-L6: board discovery queries kanban-plugin frontmatter",
    /['"]kanban-plugin['"]/.test(_kssSrc) && /['"]board['"]/.test(_kssSrc));

  // BANNED: file.mtime — mobile-unreliable per landmine #23.
  assertTrue("KSS-L7: NO file.mtime usage (landmine #23)", !/file\.mtime/.test(_kssSrc));

  // Frontmatter fields the I/O code is expected to write.
  for (const field of ["status", "status_prev", "status_changed_at", "kanban_board", "kanban_column"]) {
    assertTrue(`KSS-L8.${field}: writes frontmatter field '${field}'`,
      new RegExp("\\b" + field + "\\b").test(_kssSrc));
  }
}

// ── Helper: load the KanbanStatusSync class from source via `new Function` with stub
// free vars. Mirrors the loadActivityFeedClass pattern in run-activity-feed.js Pass 3.
// Pure helpers use the defaults; the startup-sync fixture supplies faithful app
// and Dataview I/O stubs for syncBoard.
function loadKSS(appStub = {}, windowStub = null) {
  const src = fs.readFileSync(SOURCE_PATH, "utf8");
  return new Function("app", "customJS", "Notice", "window", src + "\nreturn KanbanStatusSync;")
    (appStub, null, null, windowStub);
}

function syncBoardFixture(initialBoard, initialCards) {
  const boardPath = "spice/projects/sauce/sauce-board.md";
  const boardFile = { path: boardPath, extension: "md" };
  const boardSrc = initialBoard;
  let writes = 0;
  const cards = Object.fromEntries(Object.entries(initialCards).map(([linkpath, frontmatter]) => {
    const file = { path: `spice/projects/sauce/tasks/${linkpath}.md`, extension: "md" };
    return [linkpath, { file, frontmatter: { ...frontmatter } }];
  }));
  const byPath = Object.fromEntries(Object.values(cards).map((card) => [card.file.path, card]));
  const appStub = {
    vault: {
      getAbstractFileByPath(target) {
        if (target === boardPath) return boardFile;
        return byPath[target] ? byPath[target].file : null;
      },
      async read(file) {
        if (file !== boardFile) throw new Error(`unexpected read: ${file && file.path}`);
        return boardSrc;
      },
    },
    metadataCache: {
      getFirstLinkpathDest(linkpath) {
        return cards[linkpath] ? cards[linkpath].file : null;
      },
      getFileCache(file) {
        return byPath[file.path] ? { frontmatter: { ...byPath[file.path].frontmatter } } : null;
      },
    },
    fileManager: {
      async processFrontMatter(file, update) {
        const card = byPath[file.path];
        if (!card) throw new Error(`unexpected frontmatter write: ${file.path}`);
        const next = { ...card.frontmatter };
        update(next);
        card.frontmatter = next;
        writes++;
      },
    },
  };
  const windowStub = {
    app: {
      plugins: {
        plugins: {
          dataview: {
            api: {
              pages() {
                const pages = Object.values(cards).map((card) => ({
                  ...card.frontmatter,
                  file: { path: card.file.path },
                }));
                return {
                  where(predicate) {
                    const selected = pages.filter(predicate);
                    return { array: () => selected };
                  },
                };
              },
            },
          },
        },
      },
    },
  };
  const Klass = loadKSS(appStub, windowStub);
  return {
    boardPath,
    cards,
    sync: (today) => new Klass().syncBoard(boardPath, today),
    writes: () => writes,
  };
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

// ── Pass 4: faithful startup syncBoard I/O fixture ───────────────────────

async function runStartupSyncFixture() {
  console.log("\n--- Pass 4: startup syncBoard parked-authority behavior ---");
  const board = [
    "---", "kanban-plugin: board", "---", "",
    "## In Progress", "", "- [[parked-authority]]", "- [[ordinary-card]]", "- [[formerly-parked]]", "",
    "## Blocked", "", "- [[parked-blocked]]", "",
    "## Completed", "", "- [[parked-completed]]", "",
  ].join("\n");
  const fixture = syncBoardFixture(board, {
    "parked-authority": {
      status: "parked",
      status_prev: "in-planning",
      status_changed_at: "2026-07-16",
      resume_condition: "Resume only after the prerequisite is deployed.",
      kanban_board: "stale-board.md",
      kanban_column: "In Planning",
    },
    "ordinary-card": {
      status: "in-planning",
      status_prev: "planning",
      status_changed_at: "2026-07-15",
      kanban_board: fixtureBoardPath(),
      kanban_column: "In Planning",
    },
    "formerly-parked": {
      status: "parked",
      status_prev: "in-progress",
      status_changed_at: "2026-07-14",
      resume_condition: "   ",
      kanban_board: fixtureBoardPath(),
      kanban_column: "In Progress",
    },
    "parked-blocked": {
      status: "parked",
      status_prev: "in-progress",
      status_changed_at: "2026-07-13",
      resume_condition: "Still blocked on an external prerequisite.",
      kanban_board: fixtureBoardPath(),
      kanban_column: "In Progress",
    },
    "parked-completed": {
      status: "parked",
      status_prev: "in-progress",
      status_changed_at: "2026-07-12",
      resume_condition: "Was parked before completion.",
      kanban_board: fixtureBoardPath(),
      kanban_column: "In Progress",
    },
    "parked-orphan": {
      status: "parked",
      status_prev: "in-progress",
      status_changed_at: "2026-07-11",
      resume_condition: "Was parked before board removal.",
      kanban_board: fixtureBoardPath(),
      kanban_column: "In Progress",
    },
  });

  const first = await fixture.sync("2026-07-17");
  assertEq("KSS-IO-1: first startup sync repairs five board cards and archives one orphan",
    first, { synced: 5, archived: 1 });
  assertEq("KSS-IO-2: In Progress parked authority preserves lifecycle while repairing board metadata",
    fixture.cards["parked-authority"].frontmatter, {
      status: "parked",
      status_prev: "in-planning",
      status_changed_at: "2026-07-16",
      resume_condition: "Resume only after the prerequisite is deployed.",
      kanban_board: fixture.boardPath,
      kanban_column: "In Progress",
    });
  assertEq("KSS-IO-3: ordinary In Progress card follows the lane",
    fixture.cards["ordinary-card"].frontmatter.status, "in-progress");
  assertEq("KSS-IO-4: blank resume_condition restores lane-derived behavior",
    fixture.cards["formerly-parked"].frontmatter.status, "in-progress");
  assertEq("KSS-IO-5: moving a parked card to Blocked follows the lane",
    fixture.cards["parked-blocked"].frontmatter.status, "blocked");
  assertEq("KSS-IO-6: moving a parked card to Completed follows the lane",
    fixture.cards["parked-completed"].frontmatter.status, "completed");
  assertEq("KSS-IO-7: removing a parked card retains archive behavior",
    fixture.cards["parked-orphan"].frontmatter.status, "archived");

  const writesAfterFirst = fixture.writes();
  const second = await fixture.sync("2026-07-17");
  assertEq("KSS-IO-8: repeated startup sync reports a no-op", second, { synced: 0, archived: 0 });
  assertEq("KSS-IO-9: repeated startup sync performs no frontmatter writes",
    fixture.writes(), writesAfterFirst);

  fixture.cards["parked-authority"].frontmatter.status = "parked";
  fixture.cards["parked-authority"].frontmatter.status_prev = "in-planning";
  fixture.cards["parked-authority"].frontmatter.status_changed_at = "2026-07-16";
  delete fixture.cards["parked-authority"].frontmatter.resume_condition;
  const resumed = await fixture.sync("2026-07-18");
  assertEq("KSS-IO-10: removing resume_condition resumes normal In Progress derivation",
    resumed, { synced: 1, archived: 0 });
  assertEq("KSS-IO-11: resumed card receives lane status and lifecycle timestamp",
    {
      status: fixture.cards["parked-authority"].frontmatter.status,
      status_prev: fixture.cards["parked-authority"].frontmatter.status_prev,
      status_changed_at: fixture.cards["parked-authority"].frontmatter.status_changed_at,
    },
    { status: "in-progress", status_prev: "parked", status_changed_at: "2026-07-18" });
}

function fixtureBoardPath() {
  return "spice/projects/sauce/sauce-board.md";
}

function finish() {
  console.log(`\nrun-kanban-status-sync.js: ${pass} pass · ${fail} fail`);
  if (fail > 0) {
    console.log("\n--- Failures ---");
    for (const f of failures) console.log(f);
    process.exitCode = 1;
  }
}

runStartupSyncFixture()
  .catch((err) => assertTrue("KSS-IO-0: startup sync fixture completes", false, err && err.stack))
  .finally(finish);
