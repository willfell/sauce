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
const INIT_PATH = path.join(MECH_DIR, "kanban-status-sync-init.js");

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

// ── Fake timer clock ──────────────────────────────────────────────────────
// GA-ML5: the startup sweep is scheduled behind layout-ready + an idle deferral,
// so the harness needs to own time. Every timer the init arms goes through the
// injected _setTimeoutFn/_clearTimeoutFn seams and lands here — nothing in these
// tests waits on real wall-clock time, which is what makes "no write has happened
// yet" a decidable assertion rather than a race.
function makeFakeClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  const clock = {
    setTimeout(cb, ms) {
      const id = ++seq;
      pending.set(id, { cb, at: now + (Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    pendingCount: () => pending.size,
    // Remaining delay of every armed timer, soonest first.
    nextDelays: () => Array.from(pending.values()).map((t) => t.at - now).sort((a, b) => a - b),
    // Run every callback due at or before now+ms, in deadline order, repeatedly —
    // a fired callback may arm the next one (the Dataview retry chain does).
    async advance(ms, maxRounds = 500) {
      const target = now + ms;
      for (let round = 0; round < maxRounds; round++) {
        const due = Array.from(pending.entries())
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        for (const [id, t] of due) {
          if (!pending.has(id)) continue;
          pending.delete(id);
          if (t.at > now) now = t.at;
          t.cb();
          await Promise.resolve();
        }
      }
      if (target > now) now = target;
      await Promise.resolve();
    },
  };
  return clock;
}

// Did a promise actually settle? Flushing microtasks and reporting `done` — rather
// than plain `await` — is what keeps a never-settling sweep (e.g. an unbounded
// Dataview retry chain) a LOUD failure instead of a silent exit-0 with no result
// line printed.
async function settledValue(promise, ticks = 5000) {
  let done = false;
  let value;
  let rejected = false;
  Promise.resolve(promise).then(
    (v) => { done = true; value = v; },
    (e) => { done = true; rejected = true; value = e; });
  for (let i = 0; i < ticks && !done; i++) await Promise.resolve();
  return { done, value, rejected };
}

// Flush an invoked init's sweep promise. Returns { done } so callers can assert
// the chain terminated.
async function flushSweep(init) {
  if (!init || !init._startupSweepPromise) return { done: true, value: undefined, scheduled: false };
  const settled = await settledValue(init._startupSweepPromise);
  settled.scheduled = true;
  return settled;
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
    assertTrue("KSS-INIT-7: dataview readiness observed via a scheduled retry (_awaitDataviewThenSync)",
      /_awaitDataviewThenSync/.test(initSrc));
    assertTrue("KSS-INIT-8: calls customJS.KanbanStatusSync.syncAllBoards",
      /customJS\.KanbanStatusSync\.syncAllBoards/.test(initSrc));
    // Mobile safety / landmine #23: must NOT read file.mtime.
    assertTrue("KSS-INIT-9: NO file.mtime usage in init (landmine #23)",
      !/file\.mtime/.test(initSrc));

    // GA-ML5 shape asserts: the sweep must stay OFF the boot path. These are
    // source-level because the failure mode they guard is a refactor that quietly
    // re-awaits the sweep inside invoke() — cheap to reintroduce, expensive to
    // notice (a 283-card write storm during boot).
    assertTrue("KSS-INIT-10: invoke() never awaits the startup sweep",
      !/await\s+this\._runStartupSync/.test(initSrc)
      && !/await\s+this\._scheduleStartupSync/.test(initSrc)
      && !/await\s+this\._awaitDataviewThenSync/.test(initSrc));
    assertTrue("KSS-INIT-11: sweep is gated on workspace.onLayoutReady",
      /onLayoutReady/.test(initSrc));
    assertTrue("KSS-INIT-12: sweep is additionally gated on an idle deferral with a timeout fallback",
      /_deferIdle/.test(initSrc) && /requestIdleCallback/.test(initSrc));
    assertTrue("KSS-INIT-13: no blocking poll loop remains in the init",
      !/\bwhile\s*\(/.test(initSrc) && !/_waitForDataview/.test(initSrc));
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
  const commands = [];
  const cards = Object.fromEntries(Object.entries(initialCards).map(([linkpath, frontmatter]) => {
    const file = { path: `spice/projects/sauce/tasks/${linkpath}.md`, extension: "md" };
    return [linkpath, { file, frontmatter: { ...frontmatter } }];
  }));
  const byPath = Object.fromEntries(Object.values(cards).map((card) => [card.file.path, card]));
  const appStub = {
    commands: {
      addCommand(command) { commands.push(command); },
    },
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
  const boardsDvStub = {
    pages() {
      const pages = [{ "kanban-plugin": "board", file: { path: boardPath } }];
      return {
        where(predicate) {
          const selected = pages.filter(predicate);
          return { array: () => selected };
        },
      };
    },
  };
  appStub.plugins = { plugins: { dataview: { api: boardsDvStub } } };
  // GA-ML5: layout-ready queue + fake clock. The init schedules its sweep behind
  // app.workspace.onLayoutReady (or the _onLayoutReadyFn seam) and then an idle
  // deferral, so the fixture has to fire both hops explicitly.
  const clock = makeFakeClock();
  const layoutReadyQueue = [];
  appStub.workspace = {
    onLayoutReady(cb) { layoutReadyQueue.push(cb); },
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
  const singleton = new Klass();
  const initSrc = fs.readFileSync(INIT_PATH, "utf8");
  const loadInit = (today) => {
    windowStub.moment = () => ({ format: () => today });
    const Init = new Function("app", "customJS", "Notice", "window", initSrc + "\nreturn KanbanStatusSyncInit;")
      (appStub, { KanbanStatusSync: singleton }, function Notice() {}, windowStub);
    return new Init();
  };
  // Every init the fixture hands out runs on the fake clock; by default the
  // layout-ready seam is injected too, so a test can prove the gate ordering
  // without depending on app.workspace. Pass { useAppWorkspace: true } to exercise
  // the production wiring instead.
  const newInit = (today, opts = {}) => {
    const init = loadInit(today);
    init._setTimeoutFn = clock.setTimeout;
    init._clearTimeoutFn = clock.clearTimeout;
    if (opts.useAppWorkspace !== true) init._onLayoutReadyFn = (cb) => layoutReadyQueue.push(cb);
    return init;
  };
  const fireLayoutReady = () => {
    const queued = layoutReadyQueue.splice(0, layoutReadyQueue.length);
    for (const cb of queued) cb();
  };
  // Drive an invoked init all the way through: layout-ready, then the idle
  // deferral (and any Dataview retries), then the sweep itself.
  const drive = async (init) => {
    fireLayoutReady();
    await clock.advance(60000);
    return flushSweep(init);
  };
  return {
    boardPath,
    cards,
    sync: (today) => new Klass().syncBoard(boardPath, today),
    startup: async (today) => {
      const init = newInit(today);
      await init.invoke();
      await drive(init);
      return singleton._lastSyncResult;
    },
    clock,
    newInit,
    drive,
    fireLayoutReady,
    layoutReadyPending: () => layoutReadyQueue.length,
    lastResult: () => singleton._lastSyncResult,
    hideDataview: () => { appStub.plugins.plugins.dataview = null; },
    showDataview: () => { appStub.plugins.plugins.dataview = { api: boardsDvStub }; },
    commands,
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
    "## In Progress", "", "- [[parked-authority]]", "- [[parked-board-only]]", "- [[parked-column-only]]",
    "- [[ordinary-card]]", "- [[formerly-parked]]", "",
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
    "parked-board-only": {
      status: "parked",
      status_prev: "in-planning",
      status_changed_at: "2026-07-16",
      resume_condition: "Resume after the board-only repair prerequisite.",
      kanban_board: "stale-board.md",
      kanban_column: "In Progress",
    },
    "parked-column-only": {
      status: "parked",
      status_prev: "in-planning",
      status_changed_at: "2026-07-16",
      resume_condition: "Resume after the column-only repair prerequisite.",
      kanban_board: fixtureBoardPath(),
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

  const first = await fixture.startup("2026-07-17");
  assertEq("KSS-IO-1: actual startup path discovers the board, repairs seven cards, and archives one orphan",
    first, { synced: 7, archived: 1, boards: 1 });
  assertEq("KSS-IO-1b: startup invoke registers the manual resync command",
    fixture.commands.map((command) => command.id), ["kanban-status-sync:resync-now"]);
  assertEq("KSS-IO-2: In Progress parked authority preserves lifecycle while repairing board metadata",
    fixture.cards["parked-authority"].frontmatter, {
      status: "parked",
      status_prev: "in-planning",
      status_changed_at: "2026-07-16",
      resume_condition: "Resume only after the prerequisite is deployed.",
      kanban_board: fixture.boardPath,
      kanban_column: "In Progress",
    });
  assertEq("KSS-IO-2b: parked authority repairs a stale board independently",
    fixture.cards["parked-board-only"].frontmatter, {
      status: "parked",
      status_prev: "in-planning",
      status_changed_at: "2026-07-16",
      resume_condition: "Resume after the board-only repair prerequisite.",
      kanban_board: fixture.boardPath,
      kanban_column: "In Progress",
    });
  assertEq("KSS-IO-2c: parked authority repairs a stale column independently",
    fixture.cards["parked-column-only"].frontmatter, {
      status: "parked",
      status_prev: "in-planning",
      status_changed_at: "2026-07-16",
      resume_condition: "Resume after the column-only repair prerequisite.",
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

// ── Pass 5: GA-ML5 — startup sweep is scheduled, never on the boot path ───

// One board, one card that needs exactly one frontmatter write. Small enough that
// "did a write happen yet?" is a crisp signal.
function deferralFixture() {
  const board = [
    "---", "kanban-plugin: board", "---", "",
    "## In Progress", "", "- [[card-one]]", "",
  ].join("\n");
  return syncBoardFixture(board, {
    "card-one": {
      status: "in-planning",
      status_prev: "planning",
      status_changed_at: "2026-07-15",
      kanban_board: fixtureBoardPath(),
      kanban_column: "In Planning",
    },
  });
}

async function runDeferredStartupCases() {
  console.log("\n--- Pass 5: startup sweep deferral (GA-ML5) ---");

  // 5a — the gate ordering itself. Acceptance: no processFrontMatter / vault write
  // can fire before layout-ready AND the idle deferral have both fired.
  {
    const f = deferralFixture();
    const init = f.newInit("2026-07-17");
    const t0 = Date.now();
    await init.invoke();
    const elapsed = Date.now() - t0;
    assertTrue("KSS-DEFER-1: invoke() returns promptly instead of awaiting the sweep",
      elapsed < 1000, `${elapsed}ms elapsed`);
    assertEq("KSS-DEFER-2: zero frontmatter writes at the moment invoke() returns", f.writes(), 0);
    assertEq("KSS-DEFER-3: invoke() still registers the resync command synchronously",
      f.commands.map((c) => c.id), ["kanban-status-sync:resync-now"]);
    assertEq("KSS-DEFER-4: invoke() registers exactly one layout-ready callback", f.layoutReadyPending(), 1);
    assertEq("KSS-DEFER-5: no timer is armed before layout-ready fires", f.clock.pendingCount(), 0);

    f.fireLayoutReady();
    assertEq("KSS-DEFER-6: zero frontmatter writes after layout-ready, before the idle deferral",
      f.writes(), 0);
    assertEq("KSS-DEFER-7: layout-ready arms exactly one idle deferral", f.clock.pendingCount(), 1);
    assertEq("KSS-DEFER-8: the idle deferral carries a 1000ms timeout fallback",
      f.clock.nextDelays(), [1000]);

    await f.clock.advance(60000);
    assertTrue("KSS-DEFER-8b: the scheduled sweep chain settles", (await flushSweep(init)).done);
    assertTrue("KSS-DEFER-9: the sweep runs once layout-ready and the deferral have both fired",
      f.writes() > 0, `writes=${f.writes()}`);
    assertEq("KSS-DEFER-10: the deferred sweep produces the same result as the old boot-path sweep",
      f.lastResult(), { synced: 1, archived: 0, boards: 1 });
  }

  // 5b — the idle handle is revocable, which is the structural proof that nothing
  // downstream of it can have run yet.
  {
    const f = deferralFixture();
    const init = f.newInit("2026-07-17");
    await init.invoke();
    f.fireLayoutReady();
    assertTrue("KSS-DEFER-11: the idle deferral exposes a cancel() handle",
      !!(init._startupIdle && typeof init._startupIdle.cancel === "function"));
    if (init._startupIdle && typeof init._startupIdle.cancel === "function") init._startupIdle.cancel();
    await f.clock.advance(60000);
    assertEq("KSS-DEFER-12: cancelling the deferral prevents every frontmatter write", f.writes(), 0);
  }

  // 5c — Dataview absent: invoke() must not sit on a 30s poll. Readiness is
  // observed through scheduled callbacks on the injected timer instead.
  {
    const f = deferralFixture();
    f.hideDataview();
    const init = f.newInit("2026-07-17");
    const t0 = Date.now();
    await init.invoke();
    const elapsed = Date.now() - t0;
    assertTrue("KSS-DEFER-13: invoke() returns promptly with Dataview absent (no 30s serial poll)",
      elapsed < 1000, `${elapsed}ms elapsed`);
    f.fireLayoutReady();
    await f.clock.advance(1000);
    assertEq("KSS-DEFER-14: Dataview-absent readiness check arms a retry on the injected timer",
      f.clock.nextDelays(), [250]);
    assertEq("KSS-DEFER-15: no frontmatter write while waiting for Dataview", f.writes(), 0);
    f.showDataview();
    await f.clock.advance(250);
    assertTrue("KSS-DEFER-15b: the retry chain settles once Dataview appears", (await flushSweep(init)).done);
    assertEq("KSS-DEFER-16: the sweep runs on the retry once Dataview appears",
      f.lastResult(), { synced: 1, archived: 0, boards: 1 });
  }

  // 5d — the retry chain stays bounded (~30s of scheduled waiting) and a Dataview
  // that never arrives never produces a write.
  {
    const f = deferralFixture();
    f.hideDataview();
    const init = f.newInit("2026-07-17");
    await init.invoke();
    f.fireLayoutReady();
    await f.clock.advance(120000);
    // The teeth of the bound: an unbounded retry chain leaves this promise
    // forever pending, which would otherwise let the whole harness exit silently.
    assertTrue("KSS-DEFER-16b: a never-ready Dataview makes the retry chain give up, not spin forever",
      (await flushSweep(init)).done);
    assertEq("KSS-DEFER-17: Dataview retries are bounded — no timer left armed", f.clock.pendingCount(), 0);
    assertEq("KSS-DEFER-18: a Dataview that never arrives never writes frontmatter", f.writes(), 0);
  }

  // 5e — the once-per-session sweep guard survives the move off the boot path.
  {
    const f = deferralFixture();
    const first = f.newInit("2026-07-17");
    await first.invoke();
    await f.drive(first);
    const afterFirst = f.writes();
    assertTrue("KSS-DEFER-19: the first deferred sweep does write", afterFirst > 0, `writes=${afterFirst}`);
    const second = f.newInit("2026-07-17");
    await second.invoke();
    await f.drive(second);
    assertEq("KSS-DEFER-20: re-initialization does not repeat the sweep", f.writes(), afterFirst);
  }

  // 5f — a repeat invoke() on one instance schedules one sweep, not two.
  {
    const f = deferralFixture();
    const init = f.newInit("2026-07-17");
    await init.invoke();
    await init.invoke();
    assertEq("KSS-DEFER-21: repeated invoke() on one instance schedules a single layout-ready callback",
      f.layoutReadyPending(), 1);
  }

  // 5g — the production wiring (app.workspace.onLayoutReady) with no injected
  // layout-ready seam, so a refactor that drops the app.workspace binding fails.
  {
    const f = deferralFixture();
    const init = f.newInit("2026-07-17", { useAppWorkspace: true });
    await init.invoke();
    assertEq("KSS-DEFER-22: production path registers through app.workspace.onLayoutReady",
      f.layoutReadyPending(), 1);
    assertEq("KSS-DEFER-23: no frontmatter write before app.workspace layout-ready fires", f.writes(), 0);
    await f.drive(init);
    assertEq("KSS-DEFER-24: the app.workspace layout-ready path completes the sweep",
      f.lastResult(), { synced: 1, archived: 0, boards: 1 });
  }
}

let finished = false;

function finish() {
  finished = true;
  console.log(`\nrun-kanban-status-sync.js: ${pass} pass · ${fail} fail`);
  if (fail > 0) {
    console.log("\n--- Failures ---");
    for (const f of failures) console.log(f);
    process.exitCode = 1;
  }
}

// A hung await (never-settling promise) drains the event loop and exits 0 with no
// result line. Fail loudly instead.
process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.log("\nrun-kanban-status-sync.js: ABORTED before finish() — a promise never settled");
    process.exitCode = 1;
  }
});

runStartupSyncFixture()
  .catch((err) => assertTrue("KSS-IO-0: startup sync fixture completes", false, err && err.stack))
  .then(() => runDeferredStartupCases())
  .catch((err) => assertTrue("KSS-DEFER-0: deferred startup cases complete", false, err && err.stack))
  .finally(finish);
