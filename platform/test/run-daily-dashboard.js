'use strict';
// run-daily-dashboard.js — behavioral harness for SpaceDailyDashboard perf-critical
// query paths. Guards the 2→1 sweep reduction: the dashboard no longer runs its
// own _getActivityCount sweep AND ActivityFeed.render's _query sweep. It now
// calls customJS.ActivityFeed.query(dv, opts) ONCE (one unscoped dv.pages()
// sweep), uses .total for the hasContent gate + count pill, derives the
// segmented-accent byBlueprint from query().pages via bucketByBlueprint(), and
// hands the same pages back into ActivityFeed.render via precomputed.
//
// These cases drive the REAL SpaceDailyDashboard.render against DOM/dv/customJS
// stubs, plus the REAL static bucketByBlueprint() over the pages the REAL
// ActivityFeed.query() (loaded from the mechanism source) produces for the same
// fixture — so the count + byBlueprint parity with the old _getActivityCount is
// asserted against the genuine query path, not a hand-rolled replica.

const fs = require('fs');
const path = require('path');

const WORKSHOP = path.resolve(__dirname, '..', '..');
const SDD_SRC = fs.readFileSync(path.join(WORKSHOP, 'platform/blueprints/daily/helpers/space-daily-dashboard.js'), 'utf8');
const AF_SRC  = fs.readFileSync(path.join(WORKSHOP, 'platform/mechanisms/activity-feed/activity-feed.js'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + msg); } }
async function ok(name, fn) { try { await fn(); console.log('ok ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }

// ── Shared stubs ────────────────────────────────────────────────────────────

// Deterministic moment stub: startOf/endOf('day').format() → today±time; also
// supports .clone()/.valueOf() so both the dashboard AND activity-feed's _query
// (which calls window.moment(iso).valueOf()) work.
function makeMomentWindow() {
  const wrap = (raw) => {
    const iso = String(raw);
    const datePart = iso.slice(0, 10);
    return {
      clone() { return wrap(iso); },
      startOf() { return wrap(datePart + 'T00:00:00'); },
      endOf() { return wrap(datePart + 'T23:59:59'); },
      format() { return iso.length > 10 ? iso : datePart + 'T00:00:00'; },
      valueOf() {
        // Order-preserving numeric collapse: strip non-digits from the ISO.
        return Number(iso.replace(/[^0-9]/g, '').padEnd(14, '0'));
      },
    };
  };
  return { moment: (d) => wrap(d) };
}

// Minimal DOM-element shim used by SpaceDailyDashboard.render.
function makeDashEl() {
  const el = {
    _tag: 'div',
    _children: [],
    className: '',
    dataset: {},
    style: {},
    _text: '',
    _html: '',
    open: false,
    createEl(tag, _opts) { const c = makeDashEl(); c._tag = tag; this._children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    _listeners: null,
    addEventListener(type, fn) { (this._listeners || (this._listeners = {}))[type] = fn; },
    _fire(type) { const fn = this._listeners && this._listeners[type]; if (fn) fn(); },
    remove() {},
    get textContent() { return this._text + this._children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this._children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v == null ? '' : v); },
  };
  Object.defineProperty(el.style, 'cssText', { value: '', writable: true, configurable: true });
  return el;
}

// Load SpaceDailyDashboard with window + customJS injected (render/_readSectionState
// guard `typeof app`, so app stays undefined and the shims fire).
function loadDashboard(windowShim, customJS) {
  return new Function('window', 'customJS', `${SDD_SRC}\nreturn SpaceDailyDashboard;`)(windowShim, customJS);
}

// Load the REAL ActivityFeed class from the mechanism source (same eval strategy
// the activity-feed harness uses) so query()/bucketing parity is asserted
// against the genuine query path.
function loadActivityFeed(windowShim) {
  return new Function('app', 'customJS', 'Notice', 'window', `${AF_SRC}\nreturn ActivityFeed;`)(
    {}, { BeaconCards: { render() {} } }, function () {}, windowShim);
}

(async () => {
  const TODAY = '2026-07-03';

  // Fixture (unchanged from the pre-2→1 DASH-L5-3 scenario): one direct project
  // hit (foo) + a project whose two task children roll up into its hub (bar).
  // Expected activity: total 2 (foo direct + bar rollup root), byBlueprint {project:2}.
  const pages = [
    { type: 'project', day: TODAY,        file: { path: 'spice/projects/foo/Foo.md', name: 'Foo.md' }, name: 'Foo' },
    { type: 'task',    day: TODAY,        file: { path: 'spice/projects/bar/tasks/t1.md', name: 't1.md' } },
    { type: 'task',    day: TODAY,        file: { path: 'spice/projects/bar/tasks/t2.md', name: 't2.md' } },
    { type: 'project', day: TODAY,        file: { path: 'spice/projects/bar/Bar.md', name: 'Bar.md' }, name: 'Bar' },
    { type: 'note',    day: '2020-01-01', file: { path: 'spice/misc/x.md', name: 'x.md' } },
  ];
  const scopedMap = {
    '"spice/projects/bar"': [pages[3]],
    '"spice/projects/foo"': [pages[0]],
    '"spice/meetings/notes"': [],
    '"spice/tasks"': [],
    '"spice/tasks/_done"': [],
  };

  // Build a dv that counts unscoped sweeps + memoizable scoped sweeps and returns
  // Dataview-DataArray-ish results (.where/.sort/.array + iterator).
  function makeDv() {
    const state = { noArg: 0, scoped: {} };
    function chain(items) {
      const c = {
        _arr: items.slice(),
        where(fn) { return chain(this._arr.filter(fn)); },
        sort(fn, dir) {
          const s = this._arr.slice();
          try { s.sort((a, b) => { const av = fn(a), bv = fn(b); const r = av > bv ? 1 : av < bv ? -1 : 0; return dir === 'desc' ? -r : r; }); } catch (_) {}
          return chain(s);
        },
        slice(a, b) { return chain(this._arr.slice(a, b)); },
        array() { return this._arr.slice(); },
      };
      c[Symbol.iterator] = function* () { for (const p of c._arr) yield p; };
      Object.defineProperty(c, 'length', { get() { return c._arr.length; } });
      return c;
    }
    const dv = {
      _state: state,
      pages(q) {
        if (q == null || q === '') { state.noArg++; return chain(pages); }
        state.scoped[q] = (state.scoped[q] || 0) + 1;
        return chain(scopedMap[q] || []);
      },
      page(p) { return pages.find(pg => pg && pg.file && pg.file.path === p) || null; },
      el(tag) { const e = makeDashEl(); e._tag = tag; this.container._children.push(e); return e; },
      current() { return { file: { name: 'Journal-' + TODAY } }; },
      container: makeDashEl(),
    };
    return dv;
  }

  const windowShim = makeMomentWindow();
  const RealActivityFeed = loadActivityFeed(windowShim);
  const realAF = new RealActivityFeed();

  // customJS stub whose ActivityFeed.query DELEGATES to the REAL ActivityFeed
  // (so the sweep + rollup + bucketing are the genuine query path), while
  // ActivityFeed.render is a spy that records whether it received precomputed
  // pages. TaskEntity/TaskTodayList absent → tasks zeroed; BeaconCards no-op.
  function makeCustomJS() {
    const spy = { renderCalls: 0, renderPrecomputed: null, renderPages: null, queryCalls: 0 };
    const customJS = {
      TaskEntity: null,
      TaskTodayList: null,
      BeaconCards: { render: async () => {} },
      ActivityFeed: {
        query: (dv, opts) => { spy.queryCalls++; return realAF.query(dv, opts); },
        render: async (_shim, opts) => {
          spy.renderCalls++;
          spy.renderPrecomputed = opts && opts.precomputed ? opts.precomputed : null;
          spy.renderPages = spy.renderPrecomputed && Array.isArray(spy.renderPrecomputed.pages)
            ? spy.renderPrecomputed.pages : null;
        },
      },
    };
    return { customJS, spy };
  }

  await ok('DASH-L5-1 dashboard sweeps dv.pages() exactly ONCE for activity (via ActivityFeed.query)', async () => {
    const { customJS, spy } = makeCustomJS();
    const dv = makeDv();
    const Dash = loadDashboard(windowShim, customJS);
    await new Dash().render(dv, undefined);
    assert(spy.queryCalls === 1, 'expected ActivityFeed.query called once, got ' + spy.queryCalls);
    assert(dv._state.noArg === 1, 'expected exactly 1 unscoped dv.pages() sweep, got ' + dv._state.noArg);
  });

  await ok('DASH-L5-2 dashboard hands the SAME pages back to ActivityFeed.render via precomputed', async () => {
    const { customJS, spy } = makeCustomJS();
    const dv = makeDv();
    const Dash = loadDashboard(windowShim, customJS);
    await new Dash().render(dv, undefined);
    assert(spy.renderCalls === 1, 'expected ActivityFeed.render called once, got ' + spy.renderCalls);
    assert(spy.renderPrecomputed && Array.isArray(spy.renderPages),
      'expected render to receive precomputed.pages array');
    assert(spy.renderPages && spy.renderPages.length === 2,
      'expected 2 precomputed pages (foo direct + bar rollup), got ' + (spy.renderPages && spy.renderPages.length));
  });

  await ok('DASH-L5-3 total + byBlueprint unchanged (1 direct hit + 1 rolled-up root)', async () => {
    // Drive the REAL ActivityFeed.query with the same opts the dashboard passes,
    // then the REAL static bucketByBlueprint over those pages.
    const dv = makeDv();
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    const opts = {
      scope: 'today', asOf: TODAY, includeMtime: true, groupBy: 'blueprint',
      blueprints: dash._DEFAULT_DASHBOARD_BLUEPRINTS,
      tsKeys: ['day', 'created_at', 'status_changed_at'],
      rollUpRoots: dash._buildRollupRules(dv),
    };
    const q = realAF.query(dv, opts);
    assert(q.total === 2, 'expected total 2 (foo direct + bar rollup), got ' + q.total);
    const byBlueprint = Dash.bucketByBlueprint(q.pages);
    assert(byBlueprint && byBlueprint.project === 2,
      'expected byBlueprint.project === 2, got ' + JSON.stringify(byBlueprint));
  });

  await ok('SDD-ALLOWLIST-1 wiki-page, wiki-section, doc-note are in the Activity allowlist', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    const list = dash._DEFAULT_DASHBOARD_BLUEPRINTS;
    assert(list.includes('wiki-page'), 'expected _DEFAULT_DASHBOARD_BLUEPRINTS to include wiki-page');
    assert(list.includes('wiki-section'), 'expected _DEFAULT_DASHBOARD_BLUEPRINTS to include wiki-section');
    assert(list.includes('doc-note'), 'expected _DEFAULT_DASHBOARD_BLUEPRINTS to include doc-note');
  });

  await ok('SDD-ALLOWLIST-2 bucketByBlueprint folds wiki-page + wiki-section into "wiki"', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const testPages = [
      { type: 'wiki-page' }, { type: 'wiki-section' }, { type: 'wiki-page' },
    ];
    const buckets = Dash.bucketByBlueprint(testPages);
    assert(buckets.wiki === 3, 'expected buckets.wiki === 3, got ' + JSON.stringify(buckets));
    assert(!('wiki-page' in buckets), 'expected no raw wiki-page bucket key');
    assert(!('wiki-section' in buckets), 'expected no raw wiki-section bucket key');
  });

  await ok('SDD-ALLOWLIST-3 _BLUEPRINT_COLORS has a wiki accent color', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    assert(typeof dash._BLUEPRINT_COLORS.wiki === 'string' && dash._BLUEPRINT_COLORS.wiki.length > 0,
      'expected _BLUEPRINT_COLORS.wiki to be a non-empty string');
  });

  // ── Upcoming-trips selector (TASK 10) ──────────────────────────────
  // A minimal Dataview-DataArray-ish dv stub scoped to "spice/trips": the
  // .where(...).array() chain mirrors selectMeetings' DataArray path so the
  // real selector exercises its production branch. tripsFor(pages) builds a dv
  // whose pages('"spice/trips"') returns those pages (any other query → []).
  function tripsDv(tripPages) {
    function chain(items) {
      const c = {
        _arr: items.slice(),
        where(fn) { return chain(this._arr.filter(fn)); },
        array() { return this._arr.slice(); },
      };
      c[Symbol.iterator] = function* () { for (const p of c._arr) yield p; };
      Object.defineProperty(c, 'length', { get() { return c._arr.length; } });
      return c;
    }
    return { pages(q) { return chain(q === '"spice/trips"' ? tripPages : []); } };
  }

  await ok('SDD-TRIPS-1 selectUpcomingTrips keeps in-window trips, drops far ones', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    // Fixed today 2026-07-12: +6 → 2026-07-18 (in window), +40 → 2026-08-21 (out).
    const dvStub = tripsDv([
      { type: 'trip', name: 'Denver', start_date: '2026-07-18', file: { name: 'Denver', path: 'spice/trips/Denver/Denver.md' } },
      { type: 'trip', name: 'Tokyo',  start_date: '2026-08-21', file: { name: 'Tokyo',  path: 'spice/trips/Tokyo/Tokyo.md' } },
    ]);
    const rows = Dash.selectUpcomingTrips(dvStub, '2026-07-12', 14);
    assert(rows.length === 1, 'expected 1 in-window trip, got ' + rows.length);
    assert(rows[0].daysAway === 6, 'expected daysAway 6, got ' + rows[0].daysAway);
    assert(typeof rows[0].name === 'string' && rows[0].name === 'Denver', 'expected name "Denver", got ' + rows[0].name);
    assert(typeof rows[0].path === 'string' && rows[0].path === 'spice/trips/Denver/Denver.md', 'expected path, got ' + rows[0].path);
  });

  await ok('SDD-TRIPS-2 empty / no-trips is safe (accuris-ero → [])', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    assert(Dash.selectUpcomingTrips(tripsDv([]), '2026-07-12', 14).length === 0, 'expected [] for no trips');
    // A dv with no trips folder at all (pages() throws) → still []
    const throwDv = { pages() { throw new Error('no such folder'); } };
    assert(Dash.selectUpcomingTrips(throwDv, '2026-07-12', 14).length === 0, 'expected [] when pages() throws');
  });

  await ok('SDD-TRIPS-3 today counts as 0 days (within window), sorted ascending', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dvStub = tripsDv([
      { type: 'trip', name: 'Later', start_date: '2026-07-18', file: { name: 'Later', path: 'spice/trips/Later/Later.md' } },
      { type: 'trip', name: 'Today', start_date: '2026-07-12', file: { name: 'Today', path: 'spice/trips/Today/Today.md' } },
    ]);
    const rows = Dash.selectUpcomingTrips(dvStub, '2026-07-12', 14);
    assert(rows.length === 2, 'expected both in window, got ' + rows.length);
    assert(rows[0].daysAway === 0 && rows[0].name === 'Today', 'expected today (0 days) first, got ' + JSON.stringify(rows[0]));
    assert(rows[1].daysAway === 6, 'expected second daysAway 6, got ' + rows[1].daysAway);
  });

  await ok('SDD-TRIPS-4 selectUpcomingTrips computes per-trip packing progress', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dvStub = tripsDv([
      { type: 'trip', name: 'Destin Florida', start_date: '2026-07-16',
        file: { name: 'Destin Florida', path: 'spice/trips/destin-florida/Destin Florida.md' } },
      { type: 'trip-section', section_kind: 'packing-list', trip_slug: 'destin-florida',
        packing_items: [ { item: 'Socks', checked: true }, { item: 'Underwear', checked: false }, { category: 'Clothing' } ],
        file: { name: 'Destin Florida — Packing', path: 'spice/trips/destin-florida/Destin Florida — Packing.md' } },
      { type: 'trip', name: 'No Pack', start_date: '2026-07-14',
        file: { name: 'No Pack', path: 'spice/trips/no-pack/No Pack.md' } },
    ]);
    const rows = Dash.selectUpcomingTrips(dvStub, '2026-07-12', 14);
    const r = rows.find(x => x.name === 'Destin Florida');
    assert(r, 'expected Destin Florida row');
    assert(r.daysAway === 4, 'expected daysAway 4, got ' + r.daysAway);
    assert(r.packTotal === 2 && r.packed === 1, 'expected packTotal 2/packed 1, got ' + r.packTotal + '/' + r.packed);
    assert(typeof r.slug === 'string' && r.slug === 'destin-florida', 'expected slug destin-florida, got ' + r.slug);
    const np = rows.find(x => x.name === 'No Pack');
    assert(np && np.packTotal === 0, 'expected No Pack packTotal 0, got ' + (np && np.packTotal));
  });

  // ── TASK 6/7: reader-article in Activity ─────────────────────────────
  // DataArray-ish dv scoped to "spice/reader" (mirror tripsDv: .where(fn).array()).
  function readerDv(items) {
    function chain(arr) {
      const c = {
        _arr: arr.slice(),
        where(fn) { return chain(this._arr.filter(fn)); },
        array() { return this._arr.slice(); },
      };
      c[Symbol.iterator] = function* () { for (const p of c._arr) yield p; };
      Object.defineProperty(c, 'length', { get() { return c._arr.length; } });
      return c;
    }
    return { pages(q) { return chain(q === '"spice/reader"' ? items : []); } };
  }

  await ok('SDD-READER-1 selectReadingArticles keeps only reader-article status:reading (ci)', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dvStub = readerDv([
      { type: 'reader-article', status: 'reading', file: { name: 'R1', path: 'spice/reader/R1.md' } },
      { type: 'reader-article', status: 'unread', file: { name: 'U1', path: 'spice/reader/U1.md' } },
      { type: 'reader-article', status: 'archived', file: { name: 'A1', path: 'spice/reader/A1.md' } },
      { type: 'reader-article', status: 'READING', file: { name: 'R2', path: 'spice/reader/R2.md' } },
      { type: 'wiki-page', status: 'reading', file: { name: 'NotReader', path: 'spice/reader/NotReader.md' } },
    ]);
    const rows = Dash.selectReadingArticles(dvStub);
    const names = rows.map(p => p.file.name).sort();
    assert(names.length === 2, 'expected 2 reading, got ' + names.length);
    assert(names[0] === 'R1' && names[1] === 'R2', 'expected [R1,R2], got ' + JSON.stringify(names));
  });

  await ok('SDD-READER-2 selectReadingArticles safe on null / {} → []', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    assert(Dash.selectReadingArticles(null).length === 0, 'expected [] for null');
    assert(Dash.selectReadingArticles({}).length === 0, 'expected [] for {}');
  });

  await ok('SDD-READER-3 reader-article wired into Activity opts + colors', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    assert(dash._DEFAULT_DASHBOARD_BLUEPRINTS.includes('reader-article'),
      'expected _DEFAULT_DASHBOARD_BLUEPRINTS to include reader-article');
    assert(typeof dash._BLUEPRINT_COLORS['reader-article'] === 'string' &&
      dash._BLUEPRINT_COLORS['reader-article'].length > 0,
      'expected _BLUEPRINT_COLORS[reader-article] non-empty string');
    const opts = dash._buildActivityOpts(readerDv([]), '2026-07-13', { square: '', activity: '' });
    assert(Array.isArray(opts.tsKeys) && opts.tsKeys.includes('captured_at'),
      'expected tsKeys to include captured_at, got ' + JSON.stringify(opts.tsKeys));
    assert(opts.groupLabels['reader-article'] === 'Reader',
      'expected groupLabels[reader-article] === Reader, got ' + opts.groupLabels['reader-article']);
  });

  await ok('SDD-READER-4 _renderActivityMeta shows status word for reader-article', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    const metaText = (page) => {
      const el = makeDashEl();
      dash._renderActivityMeta(page, el, '', '');
      return el.textContent;
    };
    assert(metaText({ type: 'reader-article', status: 'reading', file: { mtime: 0 } }).includes('Reading'),
      'expected reading meta to contain Reading');
    assert(metaText({ type: 'reader-article', status: 'archived', file: { mtime: 0 } }).includes('Read'),
      'expected archived meta to contain Read');
    const proj = metaText({ type: 'project', file: { mtime: 0 } });
    assert(!proj.includes('Reading') && !proj.includes('Added'),
      'expected non-reader meta to not inject reader words, got ' + proj);
  });

  // ── SEC-STATE: the section-collapse-state persistence must not feed Dataview's
  //    file-change auto-refresh (root cause of the Home "reload every time" loop).
  await ok('SDD-SECSTATE-1 _writeSectionStateKey idempotent — unchanged value does not rewrite (refresh-loop breaker)', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    const store = {};
    let writes = 0;
    global.app = { vault: { adapter: {
      read: async (p) => { if (!Object.prototype.hasOwnProperty.call(store, p)) throw new Error('ENOENT'); return store[p]; },
      write: async (p, c) => { writes++; store[p] = c; },
      mkdir: async () => {},
      exists: async (p) => Object.prototype.hasOwnProperty.call(store, p),
    } } };
    try {
      await dash._writeSectionStateKey('tasks', true);
      assert(writes === 1, 'first write persists, got ' + writes);
      await dash._writeSectionStateKey('tasks', true);
      assert(writes === 1, 'unchanged value must NOT rewrite the file, got ' + writes);
      await dash._writeSectionStateKey('tasks', false);
      assert(writes === 2, 'a changed value writes, got ' + writes);
    } finally { delete global.app; }
  });

  await ok('SDD-SECSTATE-2 programmatic details.open restore does NOT persist (only genuine user toggle writes)', async () => {
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    let writeCalls = 0;
    dash._writeSectionStateKey = async () => { writeCalls++; };
    const container = makeDashEl();
    dash._renderSection(container, { accent: 'a', iconHtml: '', title: 'T', rightHtml: '', defaultOpen: false, stateKey: 'tasks', sectionState: { tasks: true } });
    const section = container._children[container._children.length - 1];
    const details = section._children.find((c) => c._tag === 'details');
    assert(!!details, 'details element created');
    // The programmatic restore set details.open=true; its async toggle fires now:
    details._fire('toggle');
    assert(writeCalls === 0, 'programmatic open must not write, got ' + writeCalls);
    // A genuine user toggle flips the value → writes.
    details.open = false;
    details._fire('toggle');
    assert(writeCalls === 1, 'a user toggle writes, got ' + writeCalls);
  });

  console.log(`\nrun-daily-dashboard: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('run-daily-dashboard threw:', e); process.exit(1); });
