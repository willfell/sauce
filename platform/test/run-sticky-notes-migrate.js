'use strict';

// run-sticky-notes-migrate.js — behavioral coverage for the sticky-notes
// day-migration helpers. Autoloop queue item
// cov-blueprint-sticky-notes-customjs-behavioral (5/8, retained after the
// sticky-notes rename): the 3 uncovered methods were StickyDayMigrate.migrate (real
// frontmatter-repair logic), StickyDayMigrateInit.invoke (startup orchestration
// wrapper), and a widget render() (already covered by
// run-sticky-notes-render-guards.js #212). This harness covers the two
// genuinely-behavioral ones:
//
//  * StickyDayMigrate.migrate(file) — recovers a broken/missing `day` frontmatter
//    value from the file path (segment YYYY-MM-DD or filename YYYY-MM-DD*.md).
//    Cases: already-valid → no-op; missing day + path date → repaired; non-string
//    (Date) day + path date → repaired; unrecoverable path → no-op; no
//    app.fileManager → false guard.
//  * StickyDayMigrateInit.invoke() — must not throw (its try/catch swallows).
//
// A synthetic `app.fileManager.processFrontMatter` feeds the callback a fm object.
// Zero-dep. "PASS N/N" exit 0, "FAIL X/N" exit 1.
//
// GA-ML6 adds two more passes:
//  * Pass 2 (SM-INIT-*) — source-shape asserts that keep the sweep off the boot
//    path across future refactors.
//  * Pass 3 (SM-DEFER-*) — a fake-clock harness that owns time, so "no vault
//    write has happened yet" is a decidable assertion rather than a race. It
//    proves the gate ordering (invoke() returns → layout-ready → idle deferral →
//    Dataview-ready → migrateAll), the once-per-day cache hit (counted by
//    migrateAll invocations AND files scanned, not merely by "no write grew"),
//    and re-run safety after an interrupted sweep.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MIGRATE_REL = 'platform/blueprints/sticky-notes/helpers/sticky-day-migrate.js';
const INIT_REL = 'platform/blueprints/sticky-notes/helpers/sticky-day-migrate-init.js';
const MIGRATE_SRC = fs.readFileSync(path.join(REPO_ROOT, MIGRATE_REL), 'utf8');
const INIT_SRC = fs.readFileSync(path.join(REPO_ROOT, INIT_REL), 'utf8');

function load(rel, cls) {
  return new Function(`${fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')}; return ${cls};`)();
}
const StickyDayMigrate = load(MIGRATE_REL, 'StickyDayMigrate');
const StickyDayMigrateInit = load(INIT_REL, 'StickyDayMigrateInit');

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; const m = `${label}${detail ? ' — ' + detail : ''}`; failures.push(m); console.log('  FAIL  ' + m); }
}
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(label, a === e, `expected ${e}, got ${a}`);
}

// ── Fake timer clock (GA-ML6) ─────────────────────────────────────────────
// The startup migration is scheduled behind layout-ready + an idle deferral, so
// the harness has to own time. Every timer the init arms goes through the
// injected _setTimeoutFn/_clearTimeoutFn seams and lands here — nothing below
// waits on real wall-clock time.
function makeFakeClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(cb, ms) {
      const id = ++seq;
      pending.set(id, { cb, at: now + (Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    pendingCount: () => pending.size,
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
}

// Did a promise actually settle? Flushing microtasks and reporting `done` —
// rather than a plain `await` — is what keeps a never-settling sweep (e.g. an
// unbounded Dataview retry chain) a LOUD failure instead of a silent exit-0.
async function settledValue(promise, ticks = 5000) {
  let done = false, rejected = false, value;
  Promise.resolve(promise).then(
    (v) => { done = true; value = v; },
    (e) => { done = true; rejected = true; value = e; });
  for (let i = 0; i < ticks && !done; i++) await Promise.resolve();
  return { done, value, rejected };
}

async function flushSweep(init) {
  if (!init || !init._startupSweepPromise) return { done: true, value: undefined, scheduled: false };
  const settled = await settledValue(init._startupSweepPromise);
  settled.scheduled = true;
  return settled;
}

// Install an app whose processFrontMatter hands the callback `fm` and mutates it.
function installApp(fm) {
  global.app = {
    fileManager: {
      processFrontMatter: async (_file, cb) => { cb(fm); },
    },
  };
}

// ── Pass 3 fixture ────────────────────────────────────────────────────────
// A small sticky-notes vault: 3 files that need repair, 1 already-valid file,
// and 1 out-of-scope file the sweep must ignore. Small enough that "how many
// files did the sweep touch?" is a crisp number.
function defaultFiles() {
  return [
    { path: 'spice/sticky-notes/2026-07-02/a.md', fm: {} },
    { path: 'spice/sticky-notes/2026-07-02/b.md', fm: { day: new Date(0) } },
    { path: 'spice/sticky-notes/2026-07-03/c.md', fm: { day: '2026-07-03' } },
    { path: 'spice/sticky-notes/2026-07-03-morning.md', fm: {} },
    { path: 'spice/daily/2026-07-02.md', fm: {} },
  ];
}
const snap = (fm) => JSON.stringify(fm, (_k, v) => (v instanceof Date ? `Date(${v.toISOString()})` : v));

function migrateFixture(opts = {}) {
  const today = opts.today || '2026-07-17';
  const entries = (opts.files || defaultFiles()).map((f) => ({
    file: { path: f.path, extension: 'md' },
    fm: { ...f.fm },
  }));
  const byPath = Object.fromEntries(entries.map((e) => [e.file.path, e]));
  let pfmCalls = 0;
  let writes = 0;
  const commands = [];
  const dvApi = { pages: () => ({ where: () => ({ array: () => [] }) }) };
  const clock = makeFakeClock();
  const layoutReadyQueue = [];
  const appStub = {
    commands: { addCommand(command) { commands.push(command); } },
    vault: { getMarkdownFiles: () => entries.map((e) => e.file) },
    fileManager: {
      async processFrontMatter(file, update) {
        const entry = byPath[file.path];
        if (!entry) throw new Error(`unexpected frontmatter access: ${file && file.path}`);
        pfmCalls++;
        const before = snap(entry.fm);
        update(entry.fm);
        if (snap(entry.fm) !== before) writes++;
      },
    },
    plugins: { plugins: { dataview: { api: dvApi } } },
    workspace: { onLayoutReady(cb) { layoutReadyQueue.push(cb); } },
  };
  const windowStub = { moment: () => ({ format: () => today }) };
  const Migrate = new Function('app', 'window', `${MIGRATE_SRC}\nreturn StickyDayMigrate;`)(appStub, windowStub);
  const singleton = new Migrate();

  let migrateAllCalls = 0;
  const results = [];
  let impl = (force) => singleton.migrateAll(force);
  const customJSStub = {
    StickyDayMigrate: {
      migrateAll: async (force) => {
        migrateAllCalls++;
        const r = await impl(force);
        results.push(r);
        return r;
      },
    },
  };

  const loadInit = () => {
    const Init = new Function('app', 'customJS', 'Notice', 'window',
      `${INIT_SRC}\nreturn StickyDayMigrateInit;`)(appStub, customJSStub, function Notice() {}, windowStub);
    return new Init();
  };
  // Every init the fixture hands out runs on the fake clock; by default the
  // layout-ready seam is injected too, so a test can prove the gate ordering
  // without depending on app.workspace. { useAppWorkspace: true } exercises the
  // production wiring instead.
  const newInit = (initOpts = {}) => {
    const init = loadInit();
    init._setTimeoutFn = clock.setTimeout;
    init._clearTimeoutFn = clock.clearTimeout;
    if (initOpts.useAppWorkspace !== true) init._onLayoutReadyFn = (cb) => layoutReadyQueue.push(cb);
    return init;
  };
  const fireLayoutReady = () => {
    const queued = layoutReadyQueue.splice(0, layoutReadyQueue.length);
    for (const cb of queued) cb();
  };
  const drive = async (init) => {
    fireLayoutReady();
    await clock.advance(60000);
    return flushSweep(init);
  };
  return {
    entries,
    singleton,
    clock,
    commands,
    newInit,
    drive,
    fireLayoutReady,
    layoutReadyPending: () => layoutReadyQueue.length,
    hideDataview: () => { appStub.plugins.plugins.dataview = null; },
    showDataview: () => { appStub.plugins.plugins.dataview = { api: dvApi }; },
    setMigrateAll: (fn) => { impl = fn; },
    migrateAllCalls: () => migrateAllCalls,
    results: () => results,
    lastResult: () => results[results.length - 1],
    scans: () => pfmCalls,
    writes: () => writes,
    days: () => entries.map((e) => e.fm.day),
  };
}

async function runSourceShapeCases() {
  console.log('\n--- Pass 2: startup migration stays off the boot path (source shape) ---');
  // Source-level because the failure mode they guard is a refactor that quietly
  // re-awaits the sweep inside invoke(): cheap to reintroduce, expensive to
  // notice (a whole-vault frontmatter sweep during mobile boot).
  ok('SM-INIT-1: invoke() never awaits the startup migration',
    !/await\s+this\._runStartupMigration/.test(INIT_SRC)
    && !/await\s+this\._scheduleStartupMigration/.test(INIT_SRC)
    && !/await\s+this\._awaitDataviewThenMigrate/.test(INIT_SRC));
  ok('SM-INIT-2: migration is gated on workspace.onLayoutReady', /onLayoutReady/.test(INIT_SRC));
  ok('SM-INIT-3: migration is additionally gated on an idle deferral with a timeout fallback',
    /_deferIdle/.test(INIT_SRC) && /requestIdleCallback/.test(INIT_SRC));
  ok('SM-INIT-4: no blocking poll loop remains in the init',
    !/\bwhile\s*\(/.test(INIT_SRC) && !/_waitForDataview/.test(INIT_SRC));
  ok('SM-INIT-5: Dataview readiness observed via a scheduled retry (_awaitDataviewThenMigrate)',
    /_awaitDataviewThenMigrate/.test(INIT_SRC));
  ok('SM-INIT-6: the resync command id is preserved',
    /['"]sticky-day-migrate:resync-now['"]/.test(INIT_SRC));
  ok('SM-INIT-7: NO file.mtime usage in init (landmine #23)', !/file\.mtime/.test(INIT_SRC));
}

async function runDeferredStartupCases() {
  console.log('\n--- Pass 3: startup migration deferral (GA-ML6) ---');

  // 3a — the gate ordering itself. No processFrontMatter call may fire before
  // layout-ready AND the idle deferral have both fired.
  {
    const f = migrateFixture();
    const init = f.newInit();
    const t0 = Date.now();
    await init.invoke();
    const elapsed = Date.now() - t0;
    ok('SM-DEFER-1: invoke() returns promptly instead of awaiting the migration',
      elapsed < 1000, `${elapsed}ms elapsed`);
    eq('SM-DEFER-2: zero frontmatter writes at the moment invoke() returns', f.writes(), 0);
    eq('SM-DEFER-2b: zero files even scanned at the moment invoke() returns', f.scans(), 0);
    eq('SM-DEFER-3: invoke() still registers the resync command synchronously',
      f.commands.map((c) => c.id), ['sticky-day-migrate:resync-now']);
    eq('SM-DEFER-4: invoke() registers exactly one layout-ready callback', f.layoutReadyPending(), 1);
    eq('SM-DEFER-5: no timer is armed before layout-ready fires', f.clock.pendingCount(), 0);

    f.fireLayoutReady();
    eq('SM-DEFER-6: zero vault access after layout-ready, before the idle deferral', f.scans(), 0);
    eq('SM-DEFER-7: layout-ready arms exactly one idle deferral', f.clock.pendingCount(), 1);
    eq('SM-DEFER-8: the idle deferral carries a 1000ms timeout fallback', f.clock.nextDelays(), [1000]);

    await f.clock.advance(60000);
    ok('SM-DEFER-8b: the scheduled migration chain settles', (await flushSweep(init)).done);
    eq('SM-DEFER-9: the deferred sweep migrates exactly the repairable sticky files', f.writes(), 3);
    eq('SM-DEFER-10: the deferred sweep produces the same result as the old boot-path sweep',
      f.lastResult(), { scanned: 4, migrated: 3, skipped: false });
    eq('SM-DEFER-10b: every sticky file ends with a quoted YYYY-MM-DD day',
      f.days(), ['2026-07-02', '2026-07-02', '2026-07-03', '2026-07-03', undefined]);
  }

  // 3b — the idle handle is revocable, which is the structural proof that
  // nothing downstream of it can have run yet.
  {
    const f = migrateFixture();
    const init = f.newInit();
    await init.invoke();
    f.fireLayoutReady();
    ok('SM-DEFER-11: the idle deferral exposes a cancel() handle',
      !!(init._startupIdle && typeof init._startupIdle.cancel === 'function'));
    if (init._startupIdle && typeof init._startupIdle.cancel === 'function') init._startupIdle.cancel();
    await f.clock.advance(60000);
    eq('SM-DEFER-12: cancelling the deferral prevents every frontmatter write', f.writes(), 0);
    eq('SM-DEFER-12b: cancelling the deferral prevents every vault scan', f.scans(), 0);
  }

  // 3c — Dataview absent: invoke() must not sit on a 30s poll. Readiness is
  // observed through scheduled callbacks on the injected timer instead.
  {
    const f = migrateFixture();
    f.hideDataview();
    const init = f.newInit();
    const t0 = Date.now();
    await init.invoke();
    const elapsed = Date.now() - t0;
    ok('SM-DEFER-13: invoke() returns promptly with Dataview absent (no 30s serial poll)',
      elapsed < 1000, `${elapsed}ms elapsed`);
    f.fireLayoutReady();
    await f.clock.advance(1000);
    eq('SM-DEFER-14: Dataview-absent readiness check arms a retry on the injected timer',
      f.clock.nextDelays(), [250]);
    eq('SM-DEFER-15: no frontmatter write while waiting for Dataview', f.writes(), 0);
    f.showDataview();
    await f.clock.advance(250);
    ok('SM-DEFER-15b: the retry chain settles once Dataview appears', (await flushSweep(init)).done);
    eq('SM-DEFER-16: the sweep runs on the retry once Dataview appears',
      f.lastResult(), { scanned: 4, migrated: 3, skipped: false });
  }

  // 3d — the retry chain stays bounded (~30s of scheduled waiting) and a
  // Dataview that never arrives never produces a write.
  {
    const f = migrateFixture();
    f.hideDataview();
    const init = f.newInit();
    await init.invoke();
    f.fireLayoutReady();
    await f.clock.advance(120000);
    // The teeth of the bound: an unbounded retry chain leaves this promise
    // forever pending, which would let the whole harness exit silently.
    ok('SM-DEFER-16b: a never-ready Dataview makes the retry chain give up, not spin forever',
      (await flushSweep(init)).done);
    eq('SM-DEFER-17: Dataview retries are bounded — no timer left armed', f.clock.pendingCount(), 0);
    eq('SM-DEFER-18: a Dataview that never arrives never writes frontmatter', f.writes(), 0);
    eq('SM-DEFER-18b: a Dataview that never arrives never calls migrateAll', f.migrateAllCalls(), 0);
  }

  // 3e — the once-per-day guard survives the move off the boot path. Counted by
  // migrateAll invocations AND by files scanned: a forward pass that repeats the
  // whole sweep is idempotent and would leave a write counter flat, so a
  // write-only assertion cannot tell a cache hit from a silent re-scan.
  {
    const f = migrateFixture();
    const first = f.newInit();
    await first.invoke();
    await f.drive(first);
    const writesAfterFirst = f.writes();
    const scansAfterFirst = f.scans();
    ok('SM-DEFER-19: the first deferred sweep does write', writesAfterFirst === 3, `writes=${writesAfterFirst}`);
    eq('SM-DEFER-19b: the first sweep scans every in-scope sticky file', scansAfterFirst, 4);
    eq('SM-DEFER-19c: migrateAll was invoked exactly once', f.migrateAllCalls(), 1);

    const second = f.newInit();
    await second.invoke();
    await f.drive(second);
    eq('SM-DEFER-20: re-initialization still reaches migrateAll', f.migrateAllCalls(), 2);
    eq('SM-DEFER-20b: the second run is a genuine once-per-day cache hit, not a repeat pass',
      f.lastResult(), { scanned: 0, migrated: 0, skipped: true });
    eq('SM-DEFER-20c: the second run re-scans zero files', f.scans(), scansAfterFirst);
    eq('SM-DEFER-20d: the second run writes nothing', f.writes(), writesAfterFirst);
    eq('SM-DEFER-20e: startup migration never passes force=true (which would defeat the guard)',
      f.results().map((r) => r.skipped), [false, true]);
  }

  // 3f — a repeat invoke() on one instance schedules one sweep, not two.
  {
    const f = migrateFixture();
    const init = f.newInit();
    await init.invoke();
    await init.invoke();
    eq('SM-DEFER-21: repeated invoke() on one instance schedules a single layout-ready callback',
      f.layoutReadyPending(), 1);
    await f.drive(init);
    eq('SM-DEFER-21b: repeated invoke() runs the sweep once', f.migrateAllCalls(), 1);
  }

  // 3g — the production wiring (app.workspace.onLayoutReady) with no injected
  // layout-ready seam, so a refactor that drops the app.workspace binding fails.
  {
    const f = migrateFixture();
    const init = f.newInit({ useAppWorkspace: true });
    await init.invoke();
    eq('SM-DEFER-22: production path registers through app.workspace.onLayoutReady',
      f.layoutReadyPending(), 1);
    eq('SM-DEFER-23: no frontmatter write before app.workspace layout-ready fires', f.writes(), 0);
    await f.drive(init);
    eq('SM-DEFER-24: the app.workspace layout-ready path completes the sweep',
      f.lastResult(), { scanned: 4, migrated: 3, skipped: false });
  }

  // 3h — mobile sessions suspend mid-sweep. Two interruption shapes:
  //   (i) partial progress already on disk before the sweep starts;
  //  (ii) a sweep that throws partway, leaving the once-per-day guard uncommitted.
  // Both must re-run safely and must not double-migrate.
  {
    const f = migrateFixture();
    // (i) an earlier, interrupted session already repaired the first two files.
    await f.singleton.migrate(f.entries[0].file);
    await f.singleton.migrate(f.entries[1].file);
    const writesBefore = f.writes();
    eq('SM-DEFER-25: the interrupted session repaired two files before suspending', writesBefore, 2);

    const init = f.newInit();
    await init.invoke();
    const settled = await f.drive(init);
    ok('SM-DEFER-26: the resumed sweep settles', settled.done && !settled.rejected);
    eq('SM-DEFER-27: the resumed sweep completes the remaining file only (no double-migration)',
      f.lastResult(), { scanned: 4, migrated: 1, skipped: false });
    eq('SM-DEFER-28: resuming adds exactly one further write', f.writes(), writesBefore + 1);
    eq('SM-DEFER-29: every sticky file is correct after the resumed sweep',
      f.days(), ['2026-07-02', '2026-07-02', '2026-07-03', '2026-07-03', undefined]);
  }
  {
    const f = migrateFixture();
    // (ii) the sweep itself is cut off mid-flight: two files land, then the
    // session suspends before migrateAll can commit its once-per-day marker.
    let attempt = 0;
    f.setMigrateAll(async (force) => {
      attempt++;
      if (attempt === 1) {
        await f.singleton.migrate(f.entries[0].file);
        await f.singleton.migrate(f.entries[1].file);
        throw new Error('session suspended mid-sweep');
      }
      return f.singleton.migrateAll(force);
    });
    const first = f.newInit();
    await first.invoke();
    const settled = await f.drive(first);
    ok('SM-DEFER-30: an interrupted sweep settles instead of rejecting out of the init',
      settled.done && !settled.rejected, `done=${settled.done} rejected=${settled.rejected}`);
    eq('SM-DEFER-31: the interrupted sweep left two files migrated', f.writes(), 2);

    const second = f.newInit();
    await second.invoke();
    await f.drive(second);
    eq('SM-DEFER-32: the retry after an interruption runs a full pass (the guard was never committed)',
      f.lastResult(), { scanned: 4, migrated: 1, skipped: false });
    eq('SM-DEFER-33: the retry does not re-migrate the files the interrupted sweep finished',
      f.writes(), 3);
    eq('SM-DEFER-34: every sticky file is correct after the retry',
      f.days(), ['2026-07-02', '2026-07-02', '2026-07-03', '2026-07-03', undefined]);
  }
}

async function runHelperCases() {
  const mig = new StickyDayMigrate();

  // Case 1: already a valid quoted YYYY-MM-DD → no-op.
  {
    const fm = { day: '2026-07-02' };
    installApp(fm);
    const changed = await mig.migrate({ path: 'spice/sticky-notes/2026-07-02/note.md' });
    ok('SM-1 valid day → no change (returns false, day untouched)', changed === false && fm.day === '2026-07-02', `changed=${changed} day=${fm.day}`);
  }

  // Case 2: missing day, date recoverable from path SEGMENT.
  {
    const fm = {};
    installApp(fm);
    const changed = await mig.migrate({ path: 'spice/sticky-notes/2026-07-02/note.md' });
    ok('SM-2 missing day + path segment date → repaired (returns true)', changed === true && fm.day === '2026-07-02', `changed=${changed} day=${fm.day}`);
  }

  // Case 3: non-string (Date) day, date recoverable from FILENAME.
  {
    const fm = { day: new Date(0) };
    installApp(fm);
    const changed = await mig.migrate({ path: 'spice/sticky-notes/2026-07-02.md' });
    ok('SM-3 Date day + filename date → repaired to string', changed === true && fm.day === '2026-07-02', `changed=${changed} day=${JSON.stringify(fm.day)}`);
  }

  // Case 3b: filename with suffix (YYYY-MM-DD-morning.md).
  {
    const fm = { day: 12345 };
    installApp(fm);
    const changed = await mig.migrate({ path: 'spice/sticky-notes/2026-07-02-morning.md' });
    ok('SM-4 numeric day + suffixed filename date → repaired', changed === true && fm.day === '2026-07-02', `changed=${changed} day=${fm.day}`);
  }

  // Case 4: missing day, path has NO recoverable date → no-op.
  {
    const fm = {};
    installApp(fm);
    const changed = await mig.migrate({ path: 'spice/sticky-notes/random-note.md' });
    ok('SM-5 unrecoverable path → no change (returns false, day still missing)', changed === false && !('day' in fm && fm.day), `changed=${changed} day=${fm.day}`);
  }

  // Case 5: no app.fileManager → guarded false.
  {
    global.app = {};
    const changed = await mig.migrate({ path: 'spice/sticky-notes/2026-07-02/note.md' });
    ok('SM-6 no app.fileManager → false (guard, no throw)', changed === false, `changed=${changed}`);
  }

  // Direct _migrateFrontmatter edge: null/non-object fm → false.
  ok('SM-7 _migrateFrontmatter(null) → false', mig._migrateFrontmatter(null, { path: 'spice/sticky-notes/2026-07-02.md' }) === false);
  ok('SM-8 _extractDateFromPath(non-string) → null', mig._extractDateFromPath(42) === null);
  ok('SM-9 _extractDateFromPath(no-date path) → null', mig._extractDateFromPath('spice/sticky-notes/foo.md') === null);
  ok('SM-10 _extractDateFromPath(segment) → date', mig._extractDateFromPath('a/2026-07-02/b.md') === '2026-07-02');

  // invoke() — startup orchestration wrapper. Happy path: registers the resync
  // command + runs the startup migration via customJS.migrateAll. GA-ML6: the
  // migration is no longer awaited inside invoke(), so the gates are driven
  // explicitly here; the assertion (invoke() does not throw and the startup
  // migration does run) is unchanged.
  {
    const f = migrateFixture();
    const init = f.newInit();
    let threw = false;
    try { await init.invoke(); } catch (_e) { threw = true; }
    const calledAtReturn = f.migrateAllCalls() > 0;
    await f.drive(init);
    const migrateAllCalled = f.migrateAllCalls() > 0;
    ok('SM-11 invoke() happy path: no throw + runs startup migration', threw === false && migrateAllCalled === true, `threw=${threw} migrateAllCalled=${migrateAllCalled}`);
    ok('SM-11b invoke() has not run the migration by the time it returns', calledAtReturn === false, `calledAtReturn=${calledAtReturn}`);
  }
  {
    // Dataview ready but customJS.StickyDayMigrate absent → "unavailable;
    // skipping" guard branch, still no throw (and returns fast — no 30s wait).
    global.Notice = function () {};
    global.customJS = {};
    global.app = {
      commands: { addCommand() {} },
      plugins: { plugins: { dataview: { api: {} } } },
    };
    const clock = makeFakeClock();
    const init = new StickyDayMigrateInit();
    init._setTimeoutFn = clock.setTimeout;
    init._clearTimeoutFn = clock.clearTimeout;
    let threw = false;
    try { await init.invoke(); await clock.advance(60000); await flushSweep(init); } catch (_e) { threw = true; }
    ok('SM-12 invoke() with migrate helper absent → skips cleanly (no throw)', threw === false);
  }
}

let finished = false;
function finish() {
  finished = true;
  console.log('');
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); return; }
  console.log(`FAIL ${fail}/${pass + fail}`);
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
}

// A hung await (never-settling promise) drains the event loop and exits 0 with
// no result line. Fail loudly instead.
process.on('exit', (code) => {
  if (!finished && code === 0) {
    console.log('\nrun-sticky-notes-migrate.js: ABORTED before finish() — a promise never settled');
    process.exitCode = 1;
  }
});

runHelperCases()
  .catch((err) => ok('SM-0: helper cases complete', false, err && err.stack))
  .then(() => runSourceShapeCases())
  .catch((err) => ok('SM-INIT-0: source shape cases complete', false, err && err.stack))
  .then(() => runDeferredStartupCases())
  .catch((err) => ok('SM-DEFER-0: deferred startup cases complete', false, err && err.stack))
  .finally(finish);
