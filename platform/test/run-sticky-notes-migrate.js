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

const fs = require('fs');
const path = require('path');

function load(rel, cls) {
  return new Function(`${fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')}; return ${cls};`)();
}
const StickyDayMigrate = load('platform/blueprints/sticky-notes/helpers/sticky-day-migrate.js', 'StickyDayMigrate');
const StickyDayMigrateInit = load('platform/blueprints/sticky-notes/helpers/sticky-day-migrate-init.js', 'StickyDayMigrateInit');

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; const m = `${label}${detail ? ' — ' + detail : ''}`; failures.push(m); console.log('  FAIL  ' + m); }
}

// Install an app whose processFrontMatter hands the callback `fm` and mutates it.
function installApp(fm) {
  global.app = {
    fileManager: {
      processFrontMatter: async (_file, cb) => { cb(fm); },
    },
  };
}

(async () => {
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

  // invoke() — startup orchestration wrapper. Provide a ready Dataview api so
  // _waitForDataview returns immediately (else it polls for 30s). Happy path:
  // registers the resync command + runs startup migration via customJS.migrateAll.
  {
    global.Notice = function () {};
    let migrateAllCalled = false;
    global.customJS = { StickyDayMigrate: { migrateAll: async () => { migrateAllCalled = true; return { migrated: 0, scanned: 0, skipped: true }; } } };
    global.app = {
      commands: { addCommand() {} },
      plugins: { plugins: { dataview: { api: {} } } },
      vault: { getMarkdownFiles: () => [] },
    };
    let threw = false;
    try { await new StickyDayMigrateInit().invoke(); } catch (_e) { threw = true; }
    ok('SM-11 invoke() happy path: no throw + runs startup migration', threw === false && migrateAllCalled === true, `threw=${threw} migrateAllCalled=${migrateAllCalled}`);
  }
  {
    // Dataview ready but customJS.StickyDayMigrate absent → "unavailable; skipping"
    // guard branch, still no throw (and returns fast — no 30s wait).
    global.Notice = function () {};
    global.customJS = {};
    global.app = {
      commands: { addCommand() {} },
      plugins: { plugins: { dataview: { api: {} } } },
    };
    let threw = false;
    try { await new StickyDayMigrateInit().invoke(); } catch (_e) { threw = true; }
    ok('SM-12 invoke() with migrate helper absent → skips cleanly (no throw)', threw === false);
  }

  console.log('');
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
})();
