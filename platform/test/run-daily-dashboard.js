'use strict';
// run-daily-dashboard.js — behavioral harness for SpaceDailyDashboard perf-critical
// query paths. Currently guards the L5 fusion: _getActivityCount must sweep
// dv.pages() ONCE (was twice) and memoize the per-project/-trip rollup scoped
// query by slug (was once per matching child), while producing byte-identical
// {total, byBlueprint}. Drives the REAL _getActivityCount against a page stub.

const fs = require('fs');
const path = require('path');

const WORKSHOP = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(WORKSHOP, 'platform/blueprints/daily/helpers/space-daily-dashboard.js'), 'utf8');
function loadClass() { return new Function(`${SRC}\n; return SpaceDailyDashboard;`)(); }

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + msg); } }
async function ok(name, fn) { try { await fn(); console.log('ok ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }

// A minimal Dataview `dv` stub. Unscoped dv.pages() returns an iterable of all
// pages (counted); scoped dv.pages('"..."') returns a DataArray-ish with
// .where(fn).array() (counted per distinct query string).
function makeDv(allPages, scopedMap) {
  const state = { noArg: 0, scoped: {} };
  const dv = {
    _state: state,
    pages: (q) => {
      if (q == null || q === '') { state.noArg++; return allPages.slice(); }
      state.scoped[q] = (state.scoped[q] || 0) + 1;
      const arr = (scopedMap[q] || []).slice();
      return {
        where: (fn) => ({ array: () => arr.filter(fn) }),
        array: () => arr,
        [Symbol.iterator]: function* () { yield* arr; },
      };
    },
  };
  return dv;
}

(async () => {
  const SpaceDailyDashboard = loadClass();
  const dash = new SpaceDailyDashboard();

  // Deterministic moment stub: startOf/endOf('day').format() → today±time so the
  // `day:`-frontmatter window check (ts.slice(0,10) between start/end slice(0,10)) works.
  const TODAY = '2026-07-03';
  global.window = { moment: (d) => ({ startOf: () => ({ format: () => d + 'T00:00:00' }), endOf: () => ({ format: () => d + 'T23:59:59' }) }) };

  const pages = [
    { type: 'project', day: TODAY,        file: { path: 'spice/projects/foo/Foo.md', name: 'Foo.md' } }, // direct hit
    { type: 'task',    day: TODAY,        file: { path: 'spice/projects/bar/tasks/t1.md', name: 't1.md' } }, // rollup child of bar
    { type: 'task',    day: TODAY,        file: { path: 'spice/projects/bar/tasks/t2.md', name: 't2.md' } }, // rollup child of bar (same slug)
    { type: 'project', day: '2020-01-01', file: { path: 'spice/projects/bar/Bar.md', name: 'Bar.md' } },  // rollup ROOT (out of window)
    { type: 'note',    day: '2020-01-01', file: { path: 'spice/misc/x.md', name: 'x.md' } },              // ignored
  ];
  const scopedMap = {
    '"spice/projects/bar"': [pages[3]], // the bar hub
    '"spice/projects/foo"': [pages[0]],
  };

  await ok('DASH-L5-1 _getActivityCount sweeps dv.pages() exactly ONCE', async () => {
    const dv = makeDv(pages, scopedMap);
    await dash._getActivityCount(dv, TODAY);
    assert(dv._state.noArg === 1, 'expected 1 unscoped dv.pages() sweep, got ' + dv._state.noArg);
  });

  await ok('DASH-L5-2 rollup scoped query is memoized per slug (once for bar, not once per child)', async () => {
    const dv = makeDv(pages, scopedMap);
    await dash._getActivityCount(dv, TODAY);
    assert(dv._state.scoped['"spice/projects/bar"'] === 1,
      'expected bar scoped query memoized to 1, got ' + dv._state.scoped['"spice/projects/bar"']);
  });

  await ok('DASH-L5-3 total + byBlueprint unchanged (1 direct hit + 1 rolled-up root)', async () => {
    const dv = makeDv(pages, scopedMap);
    const r = await dash._getActivityCount(dv, TODAY);
    assert(r.total === 2, 'expected total 2 (foo direct + bar rollup), got ' + r.total);
    assert(r.byBlueprint && r.byBlueprint.project === 2, 'expected byBlueprint.project === 2, got ' + JSON.stringify(r.byBlueprint));
  });

  console.log(`\nrun-daily-dashboard: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('run-daily-dashboard threw:', e); process.exit(1); });
