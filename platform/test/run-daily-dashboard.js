'use strict';
// run-daily-dashboard.js — behavioral harness for SpaceDailyDashboard perf-critical
// query paths. Guards the 2→1 sweep reduction: the dashboard no longer runs its
// own _getActivityCount sweep AND ActivityFeed.render's _query sweep. It now
// calls customJS.ActivityFeed.query(dv, opts) ONCE (one dv.pages() sweep,
// folder-union SOURCED since GA-ML3 — never unscoped/vault-wide), uses
// .total for the hasContent gate + count pill, derives the
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
const SDD_MIRROR_SRC = fs.readFileSync(path.join(WORKSHOP, 'ranch/scripts/daily/space-daily-dashboard.js'), 'utf8');
const DAILY_MANIFEST = JSON.parse(fs.readFileSync(path.join(WORKSHOP, 'platform/blueprints/daily/manifest.json'), 'utf8'));
const AF_SRC  = fs.readFileSync(path.join(WORKSHOP, 'platform/mechanisms/activity-feed/activity-feed.js'), 'utf8');
const TTL_SRC = fs.readFileSync(path.join(WORKSHOP, 'platform/mechanisms/task-entity/task-today-list.js'), 'utf8');
const TE_SRC = fs.readFileSync(path.join(WORKSHOP, 'platform/mechanisms/task-entity/task-entity.js'), 'utf8');
const TD_SRC = fs.readFileSync(path.join(WORKSHOP, 'platform/mechanisms/task-entity/task-dialog.js'), 'utf8');
const RS_SRC = fs.readFileSync(path.join(WORKSHOP, 'platform/mechanisms/render-safe/render-safe.js'), 'utf8');

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
    parentNode: null,
    attributes: {},
    createEl(tag, opts) {
      const c = makeDashEl();
      c._tag = tag;
      c.parentNode = this;
      if (opts && opts.cls) c.className = opts.cls;
      if (opts && opts.text != null) c.textContent = opts.text;
      this._children.push(c);
      return c;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    _listeners: null,
    addEventListener(type, fn) { (this._listeners || (this._listeners = {}))[type] = fn; },
    _fire(type, event) { const fn = this._listeners && this._listeners[type]; if (fn) return fn(event || { target: this, stopPropagation() {} }); },
    setAttribute(k, v) { this.attributes[k] = v; },
    remove() {
      if (!this.parentNode) return;
      const i = this.parentNode._children.indexOf(this);
      if (i >= 0) this.parentNode._children.splice(i, 1);
      this.parentNode = null;
    },
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

async function renderDailyTaskFixture(today, options) {
  options = options || {};
  const prevWindow = global.window;
  const prevApp = global.app;
  const prevNotice = global.Notice;
  global.Notice = function () {};

  const TaskEntityClass = new Function(`${TE_SRC}; return TaskEntity;`)();
  const TaskTodayListClass = new Function(`${TTL_SRC}; return TaskTodayList;`)();
  const TE = new TaskEntityClass();
  const TTL = new TaskTodayListClass();
  const openFile = { path: 'spice/tasks/open.md', _fm: { status: 'open', due: today, untouched: 'open' } };
  const overdueFile = { path: 'spice/tasks/late.md', _fm: { status: 'open', due: '2026-07-01', untouched: 'late' } };
  const files = new Map([[openFile.path, openFile], [overdueFile.path, overdueFile]]);
  const writes = { adapter: 0, frontmatter: 0 };
  const app = {
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || null,
      adapter: {
        read: async () => { throw new Error('ENOENT'); },
        write: async () => { writes.adapter++; },
        mkdir: async () => {},
      },
    },
    fileManager: {
      processFrontMatter: async (file, mutate) => { writes.frontmatter++; mutate(file._fm); },
    },
    workspace: {
      openLinkText() {},
      getLeavesOfType() { return []; },
    },
  };
  const windowShim = makeMomentWindow();
  if (Object.prototype.hasOwnProperty.call(options, 'storage')) {
    windowShim.localStorage = options.storage;
  }
  windowShim.app = app;
  const customJS = {
    TaskEntity: TE,
    TaskTodayList: TTL,
    TaskDialog: { open() {} },
    RenderSafe: { captureScroll() {} },
    ActivityFeed: { query: () => ({ total: 0, pages: [] }), render: async () => {} },
    BeaconCards: { render: async () => {} },
  };
  windowShim.customJS = customJS;
  global.window = windowShim;
  global.app = app;

  const taskPages = options.taskPages || [
    { type: 'task', status: 'open', title: 'Open', due: today, file: { path: openFile.path } },
    { type: 'task', status: 'open', title: 'Late', due: '2026-07-01', file: { path: overdueFile.path } },
  ];
  const chain = (items) => {
    const out = items.slice();
    out.array = () => items.slice();
    out.where = (fn) => chain(items.filter(fn));
    out.sort = () => out;
    return out;
  };
  const root = makeDashEl();
  const dv = {
    container: root,
    current: () => ({ file: { name: 'Journal-' + today } }),
    pages: (q) => chain(q === '"spice/tasks"' ? taskPages : []),
    page: () => null,
    el(tag, _text, opts) {
      return root.createEl(tag, opts || {});
    },
  };
  const Dash = loadDashboard(windowShim, customJS);
  await new Dash().render(dv, undefined);

  const allNodes = (node) => {
    const out = [];
    for (const child of (node && node._children) || []) {
      out.push(child, ...allNodes(child));
    }
    return out;
  };
  return {
    root,
    openFile,
    overdueFile,
    taskPages,
    writes,
    allNodes,
    cleanup() {
      if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
      if (prevApp === undefined) delete global.app; else global.app = prevApp;
      global.Notice = prevNotice;
    },
  };
}

// Fail closed: a test promise that never settles would otherwise let the
// event loop drain and exit 0 before the summary prints.
process.exitCode = 1;

(async () => {
  const TODAY = '2026-07-03';

  await ok('TD1B-DAILY-MIRROR-TOUCH-ZONE-TYPO canonical mirror bytes + manifest destination stay exact', async () => {
    assert(SDD_SRC === SDD_MIRROR_SRC,
      'platform helper and ranch/scripts/daily mirror must be byte-identical');
    const entry = DAILY_MANIFEST.files.find((f) => f.source === 'helpers/space-daily-dashboard.js');
    assert(entry && entry.dest === '{{scripts_path}}/daily/space-daily-dashboard.js',
      'daily manifest must deploy the canonical daily mirror: ' + JSON.stringify(entry));
  });

  await ok('TD1B-SORT-PURE Due/Priority comparators are deterministic, stable, null-safe, and non-mutating', async () => {
    const Dash = loadDashboard(makeMomentWindow(), {});
    const tasks = Object.freeze([
      { title: 'low-old', due: '2026-07-01', priority: 'low' },
      { title: 'highest-new', due: '2026-07-03', priority: 'highest' },
      { title: 'high-new-a', due: '2026-07-02', priority: 'high' },
      { title: 'high-new-b', due: '2026-07-02', priority: 'HIGH' },
      { title: 'unset', due: '', priority: '' },
      { title: 'missing' },
    ]);
    const snapshot = JSON.stringify(tasks);
    const due = Dash.sortTasks(tasks, 'due').map((t) => t.title);
    assert(JSON.stringify(due) === JSON.stringify([
      'low-old', 'high-new-a', 'high-new-b', 'highest-new', 'unset', 'missing',
    ]), 'Due ordering is date asc, missing last, stable ties: ' + JSON.stringify(due));
    const priority = Dash.sortTasks(tasks, 'priority').map((t) => t.title);
    assert(JSON.stringify(priority) === JSON.stringify([
      'highest-new', 'high-new-a', 'high-new-b', 'low-old', 'unset', 'missing',
    ]), 'Priority ordering is vocabulary rank then Due then stable ties: ' + JSON.stringify(priority));
    assert(JSON.stringify(tasks) === snapshot, 'sortTasks must not mutate its source array/items');
    assert(Dash.compareTasksByDue(null, undefined) === 0, 'Due comparator null/null is a stable tie');
    assert(Dash.compareTasksByPriority(null, {}) === 0, 'Priority comparator null/unset is a stable tie');
    assert(Dash.sortTasks(null, 'priority').length === 0, 'sortTasks is null-safe');
    assert(Dash.normalizeTaskSortMode('not-a-mode') === 'due', 'unknown mode safely defaults Due');
  });

  await ok('TD1B-NONEXISTENT-UPCOMING-BAND fixed Due order sorts Today/Overdue independently and excludes future tasks', async () => {
    const taskPages = [
      { type: 'task', status: 'open', title: 'Today Low', due: TODAY, priority: 'low', file: { path: 'spice/tasks/today-low.md' } },
      { type: 'task', status: 'open', title: 'Today Highest', due: TODAY, priority: 'highest', file: { path: 'spice/tasks/today-highest.md' } },
      { type: 'task', status: 'open', title: 'Today Unset', due: TODAY, priority: '', file: { path: 'spice/tasks/today-unset.md' } },
      { type: 'task', status: 'open', title: 'Overdue High', due: '2026-07-02', priority: 'high', file: { path: 'spice/tasks/overdue-high.md' } },
      { type: 'task', status: 'open', title: 'Overdue Low', due: '2026-07-01', priority: 'low', file: { path: 'spice/tasks/overdue-low.md' } },
      { type: 'task', status: 'open', title: 'Future Highest', due: '2026-07-04', priority: 'highest', file: { path: 'spice/tasks/future-highest.md' } },
    ];
    const fixture = await renderDailyTaskFixture(TODAY, { taskPages });
    const pathOrder = (list) => fixture.allNodes(list)
      .filter((node) => node._tag === 'li')
      .map((node) => node.dataset.sauceTaskPath);
    const byClass = (cls) => fixture.allNodes(fixture.root)
      .filter((node) => String(node.className || '').split(/\s+/).includes(cls));
    try {
      const todayLists = byClass('sauce-daily-task-today-list');
      const overdueLists = byClass('sauce-section-overdue-list');
      assert(todayLists.length === 1 && overdueLists.length === 1,
        'actual Today and Overdue bands render separately');
      assert(JSON.stringify(pathOrder(todayLists[0])) === JSON.stringify([
        'spice/tasks/today-low.md', 'spice/tasks/today-highest.md', 'spice/tasks/today-unset.md',
      ]), 'Due keeps same-day Today source order: ' + JSON.stringify(pathOrder(todayLists[0])));
      assert(JSON.stringify(pathOrder(overdueLists[0])) === JSON.stringify([
        'spice/tasks/overdue-low.md', 'spice/tasks/overdue-high.md',
      ]), 'Due orders Overdue by date without crossing bands: ' + JSON.stringify(pathOrder(overdueLists[0])));
      assert(!fixture.allNodes(fixture.root).some((node) =>
        node.dataset && node.dataset.sauceTaskPath === 'spice/tasks/future-highest.md'),
      'future task stays excluded by real selectTasks/queryToday');
      assert(byClass('sauce-section-upcoming-list').length === 0,
        'Daily does not invent an Upcoming band');
      assert(fixture.writes.adapter === 0 && fixture.writes.frontmatter === 0,
        'render performs zero vault/frontmatter writes: ' + JSON.stringify(fixture.writes));
    } finally {
      fixture.cleanup();
    }
  });

  await ok('TD1A3-DAILY-BULLET-LIST-REGRESSION real open + overdue li keep markers while child wrappers align contents', async () => {
    const fixture = await renderDailyTaskFixture(TODAY);
    try {
      const rows = fixture.allNodes(fixture.root).filter((n) => n._tag === 'li');
      assert(rows.length === 2, 'open and overdue private rows both rendered');
      for (const row of rows) {
        assert(/(^|;)\s*display\s*:\s*list-item\b/i.test(row.style.cssText),
          'task li must explicitly retain browser list-item display semantics: ' + row.style.cssText);
        assert(row._children.length === 1 && row._children[0]._tag === 'div'
            && row._children[0].className === 'sauce-daily-task-row-content',
          'task li owns one inner content wrapper, got ' + row._children.map((n) => n._tag).join(','));
        const wrapper = row._children[0];
        assert(/(^|;)\s*display\s*:\s*flex\b/i.test(wrapper.style.cssText),
          'inner content wrapper owns flex alignment: ' + wrapper.style.cssText);
      }
    } finally {
      fixture.cleanup();
    }
  });

  await ok('TD1B-REDUNDANT-QUICK-RESCHEDULE-OUTCOME existing open + overdue tomorrow actions remain viewed-day-bound', async () => {
    const fixture = await renderDailyTaskFixture(TODAY);
    const { root, openFile, overdueFile, allNodes } = fixture;
    try {
    const tomorrowButtons = allNodes(root).filter((n) =>
      String(n.className || '').split(/\s+/).includes('sauce-daily-task-tomorrow'));
    assert(tomorrowButtons.length === 2,
      'both open + overdue rows carry their own tomorrow action: ' + tomorrowButtons.length);
    const rowsBefore = allNodes(root).filter((n) => n._tag === 'li');
    assert(rowsBefore.length === 2, 'open and overdue private rows both rendered');

    await tomorrowButtons[0]._fire('click', { target: tomorrowButtons[0], stopPropagation() {} });
    assert(openFile._fm.due === '2026-07-04',
      'open task due advances from viewed day, not wall clock: ' + openFile._fm.due);
    assert(openFile._fm.untouched === 'open', 'open task unrelated frontmatter preserved');
    assert(overdueFile._fm.due === '2026-07-01', 'non-activated overdue task stays byte-identical');
    const rowsAfterOpen = allNodes(root).filter((n) => n._tag === 'li');
    assert(rowsAfterOpen.length === 1, 'only activated private row is optimistically removed');

    await tomorrowButtons[1]._fire('click', { target: tomorrowButtons[1], stopPropagation() {} });
    assert(overdueFile._fm.due === '2026-07-04',
      'overdue task also advances to nextDay(viewedDay): ' + overdueFile._fm.due);
    assert(allNodes(root).filter((n) => n._tag === 'li').length === 0,
      'overdue activation removes its own row');
    } finally {
      fixture.cleanup();
    }
  });

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
  // GA-ML3: the activity-feed sweep is now folder-union SOURCED
  // ('"spice/a" or "spice/b"'). Any source string not pinned in scopedMap is
  // treated as a folder-union and modeled with Dataview folder-source
  // semantics: pages under any listed folder, union de-duped by page
  // identity. Unscoped (no-arg / empty-string) sweeps are still counted in
  // state.noArg so DASH-L5-1 stays revert-sensitive — a regression to an
  // unscoped dv.pages() in activity-feed flips noArg back above 0.
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
        if (Object.prototype.hasOwnProperty.call(scopedMap, q)) return chain(scopedMap[q]);
        const folders = String(q).split(/\s+or\s+/).map((s) => s.trim().replace(/^"|"$/g, ''));
        const seen = new Set();
        const out = [];
        for (const f of folders) {
          for (const p of pages) {
            const pth = (p && p.file && p.file.path) || '';
            if ((pth === f || pth.indexOf(f + '/') === 0) && !seen.has(p)) { seen.add(p); out.push(p); }
          }
        }
        return chain(out);
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

  await ok('DASH-L5-1 dashboard sweeps dv.pages() exactly ONCE for activity, folder-union SOURCED (via ActivityFeed.query)', async () => {
    const { customJS, spy } = makeCustomJS();
    const dv = makeDv();
    const Dash = loadDashboard(windowShim, customJS);
    await new Dash().render(dv, undefined);
    assert(spy.queryCalls === 1, 'expected ActivityFeed.query called once, got ' + spy.queryCalls);
    // GA-ML3: the feed sweep must be SOURCED — zero unscoped/vault-wide
    // sweeps. Revert-sensitive: an activity-feed regression to an unscoped
    // dv.pages() lands in state.noArg and fails here.
    assert(dv._state.noArg === 0, 'expected 0 unscoped dv.pages() sweeps (feed sweep must be sourced), got ' + dv._state.noArg);
    // Exactly ONE folder-union sourced sweep (the feed's), distinct from the
    // dashboard's own single-folder scoped queries pinned in scopedMap.
    const unionSources = Object.keys(dv._state.scoped).filter((s) => / or /.test(s));
    assert(unionSources.length === 1 && dv._state.scoped[unionSources[0]] === 1,
      'expected exactly 1 folder-union sourced sweep, got ' + JSON.stringify(dv._state.scoped));
    assert(unionSources[0].indexOf('"spice/projects"') >= 0 && unionSources[0].indexOf('"spice/cowork"') >= 0,
      'union source must cover the dashboard buckets (spice/projects + spice/cowork at minimum), got ' + unionSources[0]);
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

  await ok('PERF8J-DASH-MOUNT successful render returns its exact root through the caller receipt', async () => {
    const { customJS } = makeCustomJS();
    const dv = makeDv();
    const Dash = loadDashboard(windowShim, customJS);
    const receipt = { ok: false, node: null };
    await new Dash().render(dv, { asOf: TODAY, mountReceipt: receipt });
    assert(receipt.ok === true, 'successful dashboard render must stamp the explicit receipt');
    assert(receipt.node && dv.container._children.includes(receipt.node),
      'receipt must identify the exact live dashboard root, not a broad DOM diff');
  });

  await ok('PERF8K-DASH-MOUNT partial cold child render stays unmounted and warm-retries', async () => {
    const { customJS } = makeCustomJS();
    delete customJS.BeaconCards;
    const dv = makeDv();
    dv.el = (tag, _text, opts) => dv.container.createEl(tag, opts || {});
    const originalPages = dv.pages.bind(dv);
    dv.pages = (query) => query === '"spice/meetings/notes"'
      ? [{ file: { name: `${TODAY} Cold Meeting`, path: `spice/meetings/notes/${TODAY} Cold Meeting.md` } }]
      : originalPages(query);
    const Dash = loadDashboard(windowShim, customJS);
    const failedReceipt = { ok: false, node: null };
    await new Dash().render(dv, { asOf: TODAY, mountReceipt: failedReceipt });
    assert(failedReceipt.ok === false && failedReceipt.node === null,
      'missing async child mechanism must not stamp a successful mount');
    assert(!dv.container._children.some((node) => /space-daily-dashboard/.test(node.className)),
      'failed partial dashboard root must be removed before warm retry');

    customJS.BeaconCards = { render: async () => {} };
    const warmReceipt = { ok: false, node: null };
    await new Dash().render(dv, { asOf: TODAY, mountReceipt: warmReceipt });
    assert(warmReceipt.ok === true && dv.container._children.includes(warmReceipt.node),
      'same-surface warm retry must stamp the completed dashboard root');
  });

  await ok('PERF8L-DASH-MOUNT successful async child settles before the root receipt', async () => {
    const { customJS } = makeCustomJS();
    let releaseChild;
    let reportChildStarted;
    const childReleased = new Promise((resolve) => { releaseChild = resolve; });
    const childStarted = new Promise((resolve) => { reportChildStarted = resolve; });
    customJS.BeaconCards = {
      render: async () => {
        reportChildStarted();
        await childReleased;
      },
    };
    const dv = makeDv();
    dv.el = (tag, _text, opts) => dv.container.createEl(tag, opts || {});
    const originalPages = dv.pages.bind(dv);
    dv.pages = (query) => query === '"spice/meetings/notes"'
      ? [{ file: { name: `${TODAY} Deferred Meeting`, path: `spice/meetings/notes/${TODAY} Deferred Meeting.md` } }]
      : originalPages(query);
    const Dash = loadDashboard(windowShim, customJS);
    const receipt = { ok: false, node: null };
    const pendingRender = new Dash().render(dv, { asOf: TODAY, mountReceipt: receipt });
    await childStarted;
    assert(receipt.ok === false && receipt.node === null,
      'receipt must remain false/null while a successful async child is pending');
    const liveRoot = dv.container._children.find((node) => /space-daily-dashboard/.test(node.className));
    assert(!!liveRoot, 'pending successful child keeps the candidate root live but uncommitted');
    releaseChild();
    await pendingRender;
    assert(receipt.ok === true && receipt.node === liveRoot,
      'receipt stamps the exact live root only after the successful child settles');
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

  // ── GA-ML4: per-slug hub queries collapse to one query per namespace root ──
  // Pre-GA-ML4 the project/trip rollup rules ran `dv.pages('"spice/projects/<slug>"')`
  // INSIDE rootPath(p), which ActivityFeed._query invokes once per windowed child
  // page — so hub resolution issued a fresh Dataview query per edited child, and
  // its cost grew with the vault's project count. These cases pin the collapsed
  // shape: ONE root query per namespace, grouped by a path-derived slug.
  //
  // makeScaledRollupDv(projectCount, tripCount) records every dv.pages() source
  // so a regression to per-slug querying is directly observable, and models
  // Dataview folder-source semantics (a folder source returns everything nested
  // beneath it) for both the root query and the feed's folder-union sweep.
  function makeScaledRollupDv(projectCount, tripCount) {
    const scaledPages = [];
    for (let i = 0; i < projectCount; i++) {
      const slug = 'p' + i;
      scaledPages.push({ type: 'project', day: TODAY, name: 'Project ' + i,
        file: { path: 'spice/projects/' + slug + '/Project.md', name: 'Project.md' } });
      scaledPages.push({ type: 'task', day: TODAY,
        file: { path: 'spice/projects/' + slug + '/tasks/t1.md', name: 't1.md' } });
      scaledPages.push({ type: 'doc-note', day: TODAY,
        file: { path: 'spice/projects/' + slug + '/docs/d1.md', name: 'd1.md' } });
    }
    for (let i = 0; i < tripCount; i++) {
      const slug = 'trip' + i;
      scaledPages.push({ type: 'trip', day: TODAY, name: 'Trip ' + i,
        file: { path: 'spice/trips/' + slug + '/Trip.md', name: 'Trip.md' } });
      scaledPages.push({ type: 'note', day: TODAY,
        file: { path: 'spice/trips/' + slug + '/entries/e1.md', name: 'e1.md' } });
    }
    const calls = [];
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
      _calls: calls,
      pages(q) {
        const src = q == null ? '' : String(q);
        calls.push(src);
        if (src === '') return chain(scaledPages);
        const folders = src.split(/\s+or\s+/).map((s) => s.trim().replace(/^"|"$/g, ''));
        const seen = new Set();
        const out = [];
        for (const f of folders) {
          for (const p of scaledPages) {
            const pth = (p && p.file && p.file.path) || '';
            if ((pth === f || pth.indexOf(f + '/') === 0) && !seen.has(p)) { seen.add(p); out.push(p); }
          }
        }
        return chain(out);
      },
      page(p) { return scaledPages.find((pg) => pg && pg.file && pg.file.path === p) || null; },
      el(tag) { const e = makeDashEl(); e._tag = tag; this.container._children.push(e); return e; },
      current() { return { file: { name: 'Journal-' + TODAY } }; },
      container: makeDashEl(),
    };
    return { dv, scaledPages };
  }

  function scaledRollupQuery(projectCount, tripCount) {
    const { dv } = makeScaledRollupDv(projectCount, tripCount);
    const Dash = loadDashboard(windowShim, makeCustomJS().customJS);
    const dash = new Dash();
    const q = realAF.query(dv, {
      scope: 'today', asOf: TODAY, includeMtime: true, groupBy: 'blueprint', limit: 500,
      blueprints: dash._DEFAULT_DASHBOARD_BLUEPRINTS,
      tsKeys: ['day', 'created_at', 'status_changed_at'],
      rollUpRoots: dash._buildRollupRules(dv),
    });
    return { dv, q };
  }

  const PER_SLUG_SOURCE = /^"spice\/(projects|trips)\/[^"]+"$/;

  await ok('GA-ML4-ROOT-QUERY hub resolution issues one query per namespace root, never one per slug', async () => {
    const { dv, q } = scaledRollupQuery(12, 5);
    assert(q.total === 17, 'fixture sanity: 12 project hubs + 5 trip hubs must survive, got ' + q.total);
    const perSlug = dv._calls.filter((s) => PER_SLUG_SOURCE.test(s));
    assert(perSlug.length === 0,
      'expected 0 per-slug hub queries, got ' + perSlug.length + ' e.g. ' + JSON.stringify(perSlug.slice(0, 3)));
    const projectRoots = dv._calls.filter((s) => s === '"spice/projects"');
    assert(projectRoots.length === 1,
      'expected exactly 1 "spice/projects" root query, got ' + projectRoots.length);
    const tripRoots = dv._calls.filter((s) => s === '"spice/trips"');
    assert(tripRoots.length === 1,
      'expected exactly 1 "spice/trips" root query, got ' + tripRoots.length);
  });

  await ok('GA-ML4-QUERY-BOUND dv.pages() count is a bounded constant, not O(projects)', async () => {
    const small = scaledRollupQuery(3, 2);
    const large = scaledRollupQuery(24, 9);
    assert(small.q.total === 5 && large.q.total === 33,
      'fixture sanity: both scales must roll up fully, got ' + small.q.total + ' and ' + large.q.total);
    assert(small.dv._calls.length === large.dv._calls.length,
      'expected an N-invariant dv.pages() count, got ' + small.dv._calls.length +
      ' for 3 projects/2 trips vs ' + large.dv._calls.length + ' for 24 projects/9 trips');
  });

  await ok('GA-ML4-SLUG-FIDELITY every rolled-up child lands under its OWN slug hub', async () => {
    const { q } = scaledRollupQuery(12, 5);
    let rollups = 0;
    for (const p of q.pages) {
      if (!p._isRollUp) continue;
      rollups++;
      const hub = String(p.file.path);
      const owner = hub.slice(0, hub.lastIndexOf('/') + 1);
      const expected = p.type === 'trip' ? 1 : 2;
      assert(p._rollUpChildren === expected,
        hub + ' expected ' + expected + ' rolled-up children, got ' + p._rollUpChildren);
      for (const child of p._rollUpChildrenPages) {
        assert(String(child.file.path).indexOf(owner) === 0,
          'child ' + child.file.path + ' mis-grouped under ' + hub);
      }
    }
    assert(rollups === 17, 'expected all 17 hubs to carry their own children, got ' + rollups);
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

  await ok('PERF8-DAILY-CREATE optimistic preview precedes persistence and exact rollback removes it/restores focus', async () => {
    const priorApp = global.app;
    const priorMoment = global.moment;
    const priorDocument = global.document;
    const priorCustomJS = global.customJS;
    const events = [];
    let rejectCreate = false;
    let focused = 0;
    let trashed = 0;
    let folderChildren = [];
    let rollbackActiveElement = null;
    const trigger = { focus: () => { focused++; } };
    const files = new Map([['ranch/templates/Today To-Do.md', { path: 'ranch/templates/Today To-Do.md' }]]);
    const app = {
      vault: {
        getAbstractFileByPath: (p) => files.get(p) || null,
        createFolder: async (p) => { events.push('folder'); files.set(p, { path: p, children: folderChildren.slice() }); },
      },
      fileManager: { trashFile: async (f) => { trashed++; files.delete(f.path); } },
      plugins: { plugins: { 'templater-obsidian': { templater: {
        create_new_note_from_template: async () => {
          events.push('write');
          if (rejectCreate) throw new Error('persist failed');
          return { path: 'created' };
        },
      } } } },
      workspace: { openLinkText() {} },
    };
    const renderSafe = {
      mutateStructure: async (opts) => {
        events.push('apply');
        const receipt = await opts.apply();
        try { return { ok: true, value: await opts.write() }; }
        catch (error) {
          events.push('rollback');
          if (rollbackActiveElement) global.document.activeElement = rollbackActiveElement;
          await opts.rollback(receipt, error);
          return { ok: false, error };
        }
      },
    };
    global.app = app;
    global.moment = () => ({ format: (fmt) => fmt === 'YYYY/MM-MMMM' ? '2026/07-July' : '2026-07-13' });
    global.document = { activeElement: trigger };
    global.customJS = { RenderSafe: renderSafe };
    try {
      const Dash = loadDashboard(windowShim, { RenderSafe: renderSafe });
      const dash = new Dash();
      const successHost = makeDashEl();
      const success = await dash._openTodayToDo('2026-07-13', { dv: {}, host: successHost, trigger });
      assert(success && success.ok === true, 'successful create returns ok');
      assert(events.indexOf('apply') < events.indexOf('write'), 'optimistic apply must precede persistence');
      assert(successHost._children.some((n) => /sauce-daily-todo-preview/.test(n.className)), 'optimistic preview is visible immediately');

      files.delete('spice/to-do/2026/07-July');
      rejectCreate = true;
      events.length = 0;
      const retryHost = makeDashEl();
      const failed = await dash._openTodayToDo('2026-07-13', { dv: {}, host: retryHost, trigger });
      assert(failed && failed.ok === false, 'rejected create returns false');
      assert(events.join(',').includes('apply') && events.join(',').endsWith('rollback'), 'rejection runs apply/write/rollback');
      assert(retryHost._children.length === 0, 'rollback removes the exact preview node');
      assert(focused === 1, 'rollback restores triggering focus exactly once');
      assert(trashed === 1, 'rejected note creation compensates its newly-created empty folder');

      files.delete('spice/to-do/2026/07-July');
      folderChildren = [{ path: 'spice/to-do/2026/07-July/concurrent.md' }];
      const newerFocus = { isConnected: true };
      rollbackActiveElement = newerFocus;
      await dash._openTodayToDo('2026-07-13', { dv: {}, host: makeDashEl(), trigger });
      assert(trashed === 1, 'rollback never trashes a newly-created folder after concurrent content arrives');
      assert(focused === 1 && global.document.activeElement === newerFocus,
        'late rollback preserves newer connected focus instead of stealing it');
    } finally {
      global.app = priorApp;
      global.moment = priorMoment;
      global.document = priorDocument;
      global.customJS = priorCustomJS;
    }
  });

  await ok('PERF8-DAILY-COLD render never rejects on missing or throwing Dataview state', async () => {
    const Dash = loadDashboard(windowShim, undefined);
    const dash = new Dash();
    await dash.render(null, {});
    await dash.render({ container: makeDashEl(), el: () => makeDashEl(), pages: () => { throw new Error('cold index'); } }, {});
    assert(true, 'cold render paths resolved');
  });

  await ok('SB-HOME sort control removed, comparators and count pills retained', async () => {
    for (const gone of [
      'sauce-daily-dashboard:task-sort-mode',
      'sauce-daily-task-sort',
      'readTaskSortMode',
      'writeTaskSortMode',
      'taskSortStorage',
      'updateSortButtonState',
    ]) {
      assert(!SDD_SRC.includes(gone),
        `Home must no longer carry its own sort control: found ${gone}`);
    }

    // The to-do note delegates to these through customJS. Removing them with the
    // control would silently drop ToDoDailyFilterView onto its private fallbacks.
    for (const kept of [
      'static compareTasksByDue',
      'static compareTasksByPriority',
      'static normalizeTaskSortMode',
      'static sortTasks',
    ]) {
      assert(SDD_SRC.includes(kept), `ToDoDailyFilterView depends on ${kept}`);
    }

    // The glance affordances stay.
    for (const kept of ['sauce-section-open-pill', 'sauce-section-done-pill']) {
      assert(SDD_SRC.includes(kept), `Home lost its count pill: ${kept}`);
    }
  });

  // ── RD-P-* sectioned Today panel (to-do redesign Task 7) ────────────────────

  // Richer DOM stub for the live panel: multi-listener events, child reordering
  // (appendChild/insertBefore), childNodes and class-only querySelector, so the
  // REAL TaskTodayList.renderTaskRow and the dashboard's drag/drop wiring run.
  function makeRichEl(tag) {
    const el = {
      _tag: tag || 'div',
      _children: [],
      className: '',
      dataset: {},
      style: {},
      attributes: {},
      _text: '',
      _html: '',
      open: false,
      parentNode: null,
      _listeners: {},
      createEl(t, opts) {
        const c = makeRichEl(t);
        if (opts && opts.cls) c.className = opts.cls;
        if (opts && opts.text != null) c.textContent = opts.text;
        if (opts && opts.type) c.type = opts.type;
        this.appendChild(c);
        return c;
      },
      appendChild(c) {
        if (c.parentNode) c.remove();
        c.parentNode = this;
        this._children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.remove();
        const i = ref ? this._children.indexOf(ref) : -1;
        c.parentNode = this;
        if (i < 0) this._children.push(c); else this._children.splice(i, 0, c);
        return c;
      },
      remove() {
        if (!this.parentNode) return;
        const i = this.parentNode._children.indexOf(this);
        if (i >= 0) this.parentNode._children.splice(i, 1);
        this.parentNode = null;
      },
      get childNodes() { return this._children.slice(); },
      get children() { return this._children.slice(); },
      get nextSibling() {
        if (!this.parentNode) return null;
        const sib = this.parentNode._children;
        return sib[sib.indexOf(this) + 1] || null;
      },
      _matches(sel) {
        const classes = String(sel).split('.').filter(Boolean);
        const mine = String(this.className || '').split(/\s+/);
        return classes.length > 0 && classes.every((c) => mine.includes(c));
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => { for (const c of n._children) { if (c._matches(sel)) out.push(c); walk(c); } };
        walk(this);
        return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      contains(n) { let x = n; while (x) { if (x === this) return true; x = x.parentNode; } return false; },
      addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); },
      removeEventListener(type, fn) { const l = this._listeners[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      _fire(type, event) {
        const ev = Object.assign({ target: this, currentTarget: this, stopPropagation() {}, preventDefault() {} }, event || {});
        return Promise.all((this._listeners[type] || []).slice().map((fn) => fn(ev)));
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      focus() {},
      get textContent() { return this._text + this._children.map((c) => c.textContent).join(''); },
      set textContent(v) { this._text = String(v == null ? '' : v); for (const c of this._children) c.parentNode = null; this._children = []; },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v == null ? '' : v); },
    };
    Object.defineProperty(el.style, 'cssText', { value: '', writable: true, configurable: true });
    return el;
  }

  const P_TODAY = '2026-07-03';
  const P_PREFS_KEY = 'sauce-todo-filter:prefs:v2';

  function memoryStorage(seed) {
    const data = Object.assign({}, seed || {});
    return {
      data,
      getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; },
    };
  }

  // Render the REAL dashboard (real TaskEntity + real TaskTodayList) against the
  // rich DOM stub. `viewedDay` is the note's filename date; `asOf` (optional)
  // mimics Home. The wall clock (window.moment()) reads P_TODAY.
  async function renderLivePanel(options) {
    const o = options || {};
    const prev = { window: global.window, app: global.app, Notice: global.Notice, customJS: global.customJS };
    const notices = [];
    global.Notice = function (msg) { notices.push(String(msg)); };
    const TaskEntityClass = new Function(`${TE_SRC}; return TaskEntity;`)();
    const TaskTodayListClass = new Function(`${TTL_SRC}; return TaskTodayList;`)();
    const TE = new TaskEntityClass();
    const TTL = new TaskTodayListClass();
    const calls = { setFields: [], reopen: [], reschedule: [], opened: [], menus: [] };
    const TD = {
      open() {},
      setFields: async (p, f) => {
        calls.setFields.push({ path: p, fields: Object.assign({}, f) });
        if (o.setFieldsResult) return o.setFieldsResult(p, f);
        return { ok: true };
      },
      reopen: async (p) => {
        calls.reopen.push(p);
        if (o.reopenResult) return o.reopenResult(p);
        return { ok: true, path: p.replace('/_done/', '/') };
      },
      markDone: async (p) => {
        (calls.markDone || (calls.markDone = [])).push(p);
        return { ok: true };
      },
      donePath: (p) => String(p).replace('spice/tasks/', 'spice/tasks/_done/'),
    };
    if (o.mutateTTL) o.mutateTTL(TTL);
    let inFlight = 0;
    let maxInFlight = 0;
    TTL.reschedule = async (row, task, newDue, viewedDay, TDref) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      calls.reschedule.push({ row, path: task && task.path, newDue, viewedDay, TDref });
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      if (o.rescheduleResult) return o.rescheduleResult(task, newDue);
      try { row.remove(); } catch (_e) {}
      return { ok: true, due: newDue };
    };
    const storage = memoryStorage(o.prefs ? { [P_PREFS_KEY]: JSON.stringify(o.prefs) } : {});
    const knownPaths = new Set([...(o.taskPages || []), ...(o.donePages || [])].map((p) => p.file.path));
    const app = {
      isMobile: !!o.isMobile,
      vault: {
        getAbstractFileByPath: (p) => (knownPaths.has(p) ? { path: p } : null),
        adapter: { read: async () => { throw new Error('ENOENT'); }, write: async () => {}, mkdir: async () => {} },
      },
      fileManager: {
        processFrontMatter: async () => { calls.writes = (calls.writes || 0) + 1; throw new Error('disk on fire'); },
        renameFile: async () => { throw new Error('rename should not run'); },
      },
      workspace: { openLinkText(p) { calls.opened.push(p); }, getLeavesOfType() { return []; } },
    };
    const windowShim = {
      moment: (d) => ({ format: (fmt) => {
        const day = d == null ? P_TODAY : String(d).slice(0, 10);
        if (fmt === 'YYYY/MM-MMMM') return day.slice(0, 4) + '/' + day.slice(5, 7) + '-July';
        return day;
      } }),
      localStorage: storage,
      app,
    };
    const realTD = o.realTD ? new (new Function(`${TD_SRC}; return TaskDialog;`)())() : null;
    const realRS = o.realTD ? new (new Function(`${RS_SRC}; return RenderSafe;`)())() : null;
    if (realTD) {
      for (const name of ['setFields', 'reopen']) {
        const orig = realTD[name].bind(realTD);
        realTD[name] = async (...args) => {
          (name === 'setFields' ? calls.setFields : calls.reopen).push(name === 'setFields' ? { path: args[0], fields: Object.assign({}, args[1]) } : args[0]);
          return orig(...args);
        };
      }
    }
    const customJS = {
      TaskEntity: TE,
      TaskTodayList: o.noTTL ? null : TTL,
      TaskDialog: realTD || TD,
      RenderSafe: realRS || { captureScroll() {} },
      MenuPopover: { open: (entries, opts) => { calls.menus.push({ entries, opts }); } },
      ActivityFeed: { query: () => ({ total: 0, pages: [] }), render: async () => {} },
      BeaconCards: { render: async () => {} },
    };
    windowShim.customJS = customJS;
    global.window = windowShim;
    global.app = app;
    global.customJS = customJS;
    const pagesByQuery = { '"spice/tasks"': o.taskPages || [], '"spice/tasks/_done"': o.donePages || [] };
    const root = makeRichEl('div');
    const dv = {
      container: root,
      current: () => ({ file: { name: 'Journal-' + (o.viewedDay || P_TODAY) } }),
      pages: (q) => {
        const items = (pagesByQuery[q] || []).slice();
        items.array = () => items.slice();
        items.where = (fn) => items.filter(fn);
        items.sort = () => items;
        return items;
      },
      page: () => null,
      el(t, _text, opts) { return root.createEl(t, opts || {}); },
    };
    const Dash = loadDashboard(windowShim, customJS);
    const dash = new Dash();
    await dash.render(dv, o.asOf ? Object.assign({ asOf: o.asOf, live: true }, o.compact ? { compact: true } : {}) : undefined);
    const sections = () => root.querySelectorAll('.sauce-today-section');
    const section = (name) => sections().find((s) => s.dataset.section === name) || null;
    const labels = () => sections().map((s) => {
      const l = s.querySelector('.sauce-today-section-label');
      return l ? l.textContent : '';
    });
    const rowPaths = (name) => {
      const s = section(name);
      return s ? s.querySelectorAll('.sauce-task-today-row').map((r) => r.dataset.sauceTaskPath) : [];
    };
    const rowFor = (name, p) => {
      const s = section(name);
      return s ? s.querySelectorAll('.sauce-task-today-row').find((r) => r.dataset.sauceTaskPath === p) || null : null;
    };
    return {
      root, dash, Dash, calls, notices, storage, TE, TTL, sections, section, labels, rowPaths, rowFor,
      maxInFlight: () => maxInFlight,
      cleanup() {
        for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete global[k]; else global[k] = prev[k]; }
      },
    };
  }

  const pTask = (slug, title, due, extra) => Object.assign(
    { type: 'task', status: 'open', title, due, file: { path: 'spice/tasks/' + slug + '.md' } }, extra || {});

  const sectionPages = [
    pTask('today-a', 'Today alpha', P_TODAY, { created_at: '2026-07-01T08:00:00' }),
    pTask('today-proj', 'Today project', P_TODAY, { source: 'project', project_slug: 'harbor', project: '[[Harbor]]', created_at: '2026-07-02T08:00:00' }),
    pTask('late-7', 'Late seven', '2026-06-26'),
    pTask('late-3', 'Late three', '2026-06-30'),
    pTask('stale-40', 'Stale forty', '2026-05-24'),
    pTask('future', 'Future one', '2026-07-09'),
    pTask('backlog', 'Someday', ''),
  ];
  const sectionDone = [
    { type: 'task', status: 'done', title: 'Done early', completed_at: '2026-07-03T08:05:00-06:00', file: { path: 'spice/tasks/_done/done-early.md' } },
    { type: 'task', status: 'done', title: 'Done late', completed_at: '2026-07-03T16:40:00-06:00', file: { path: 'spice/tasks/_done/done-late.md' } },
    { type: 'task', status: 'done', title: 'Done yesterday', completed_at: '2026-07-02T23:00:00-06:00', file: { path: 'spice/tasks/_done/done-y.md' } },
  ];

  await ok('RD-P-SELECT selectTasks keeps legacy keys and adds stale/doneToday/backlog', async () => {
    const TaskEntityClass = new Function(`${TE_SRC}; return TaskEntity;`)();
    const TE = new TaskEntityClass();
    const Dash = loadDashboard(makeMomentWindow(), {});
    const fakeDv = { pages: (q) => (q === '"spice/tasks"' ? sectionPages : q === '"spice/tasks/_done"' ? sectionDone : []) };
    const r = Dash.selectTasks(fakeDv, P_TODAY, TE);
    assert(r.open.length === 2, 'open = today tasks: ' + r.open.length);
    assert(JSON.stringify(r.overdue.map((t) => t.title).sort()) === JSON.stringify(['Late seven', 'Late three']),
      'overdue holds only the 1-29 day bucket: ' + r.overdue.map((t) => t.title));
    assert(r.stale.length === 1 && r.stale[0].title === 'Stale forty', 'stale holds >= 30 days late');
    assert(r.done === 2, 'done count unchanged (2 today): ' + r.done);
    assert(JSON.stringify(r.doneToday.map((t) => t.title)) === JSON.stringify(['Done late', 'Done early']),
      'doneToday newest first: ' + r.doneToday.map((t) => t.title));
    assert(r.backlog === 1, 'backlog counts personal undated open tasks: ' + r.backlog);
    const counts = Dash.computeCounts(fakeDv, P_TODAY, TE);
    assert(counts.overdue === 3, 'glance overdue counts overdue + stale (anything late): ' + counts.overdue);
    const cold = Dash.selectTasks(fakeDv, P_TODAY, null);
    assert(Array.isArray(cold.stale) && cold.stale.length === 0 && Array.isArray(cold.doneToday)
      && cold.doneToday.length === 0 && cold.backlog === 0, 'cold load returns empty new keys');
  });

  await ok('RD-P-SELECT-SHARED Home counts and the dashboard share one scan per index revision, with private copies', async () => {
    const TaskEntityClass = new Function(`${TE_SRC}; return TaskEntity;`)();
    const TE = new TaskEntityClass();
    const Dash = loadDashboard(makeMomentWindow(), {});
    const scans = {};
    const index = { revision: 3 };
    const meetingPages = [{ file: { name: P_TODAY + ' Standup', path: 'spice/meetings/notes/' + P_TODAY + ' Standup.md' } }];
    const makeDv = () => ({
      index,
      pages: (q) => {
        scans[q] = (scans[q] || 0) + 1;
        return q === '"spice/tasks"' ? sectionPages : q === '"spice/tasks/_done"' ? sectionDone
          : q === '"spice/meetings/notes"' ? meetingPages : [];
      },
    });
    const total = () => Object.values(scans).reduce((a, b) => a + b, 0);
    // Home's count pass, then the nested dashboard's own selection (its own dv).
    const counts = Dash.computeCounts(makeDv(), P_TODAY, TE);
    assert(total() === 3, 'count pass scans tasks, _done and meetings once each: ' + JSON.stringify(scans));
    const first = Dash.selectTasks(makeDv(), P_TODAY, TE);
    const meetings = Dash.selectMeetings(makeDv(), P_TODAY);
    assert(total() === 3, 'same revision → the dashboard reuses the count pass: ' + JSON.stringify(scans));
    assert(counts.today === first.open.length && counts.meetings === meetings.length && meetings.length === 1,
      'shared selection matches the counts');
    // The Today panel mutates the tasks it is handed; the next caller must not see that.
    first.open[0].title = 'MUTATED';
    first.open.pop();
    meetings.pop();
    const second = Dash.selectTasks(makeDv(), P_TODAY, TE);
    assert(second.open.length === 2 && second.open.every((t) => t.title !== 'MUTATED'),
      'each caller gets its own task copies: ' + second.open.map((t) => t.title));
    assert(Dash.selectMeetings(makeDv(), P_TODAY).length === 1, 'each caller gets its own meetings array');
    // Another day in the same revision is its own selection.
    assert(Dash.selectTasks(makeDv(), '2026-07-09', TE).open.length === 1, 'a different day is selected on its own');
    const before = total();
    index.revision = 4;
    Dash.selectTasks(makeDv(), P_TODAY, TE);
    assert(total() === before + 2, 'index moved → rescanned: ' + JSON.stringify(scans));
    // A reloaded TaskEntity class is not served the old class's parse.
    const again = total();
    Dash.selectTasks(makeDv(), P_TODAY, new TaskEntityClass());
    assert(total() === again + 2, 'new TaskEntity instance → rescanned');
    // No index to key on (cold load, harness stubs) → never shared.
    const bare = { pages: makeDv().pages };
    const cold = total();
    Dash.selectTasks(bare, P_TODAY, TE);
    Dash.selectTasks(bare, P_TODAY, TE);
    assert(total() === cold + 4, 'without dv.index every call scans');
  });

  await ok('RD-P-LIVE-GATE past date keeps the old panel; today and Home asOf render sections', async () => {
    const Dash = loadDashboard(makeMomentWindow(), {});
    assert(Dash.isLivePanel(P_TODAY, P_TODAY) === true, 'equal days are live');
    assert(Dash.isLivePanel('2026-07-02', P_TODAY) === false, 'past day is not live');
    assert(Dash.isLivePanel('2026-07-04', P_TODAY) === false, 'future day is not live');
    assert(Dash.isLivePanel('', '') === false && Dash.isLivePanel(null, undefined) === false, 'blank is not live');

    const past = await renderLivePanel({ viewedDay: '2026-06-01', taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(past.sections().length === 0, 'past daily note renders no sectioned panel');
      assert(past.root.querySelectorAll('.sauce-section-overdue-list').length === 1,
        'past daily note keeps the legacy overdue bullet list');
      assert(past.root.querySelectorAll('.sauce-task-today-row').length === 0, 'past note uses legacy bullet rows');
    } finally { past.cleanup(); }

    const today = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(today.sections().length === 4, 'today renders four sections: ' + today.labels());
      assert(today.root.querySelectorAll('.sauce-daily-task-today-list').length === 0, 'no legacy list when live');
    } finally { today.cleanup(); }

    const home = await renderLivePanel({ viewedDay: 'Home', asOf: P_TODAY, taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(home.sections().length === 4, 'Home with asOf today renders sections');
    } finally { home.cleanup(); }

    const cold = await renderLivePanel({ noTTL: true, taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(cold.sections().length === 0 && cold.root.querySelectorAll('.sauce-daily-task-today-list').length === 1,
        'missing TaskTodayList falls back to the legacy bullet panel');
    } finally { cold.cleanup(); }
  });

  await ok('RD-P-SECTIONS labels, counts, order and per-section sorting', async () => {
    const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(JSON.stringify(f.labels()) === JSON.stringify(['Up next', 'Overdue · 2', 'Stale · 1', 'Done today · 2']),
        'section labels in order: ' + JSON.stringify(f.labels()));
      assert(JSON.stringify(f.rowPaths('overdue')) === JSON.stringify(['spice/tasks/late-7.md', 'spice/tasks/late-3.md']),
        'overdue sorted by days late desc: ' + f.rowPaths('overdue'));
      const staleRow = f.rowFor('stale', 'spice/tasks/stale-40.md');
      assert(staleRow && /\bis-stale\b/.test(staleRow.className), 'stale rows are dimmed with .is-stale');
      assert(staleRow.querySelector('.sauce-today-stale-backlog') && staleRow.querySelector('.sauce-today-stale-pick'),
        'stale rows carry inline Backlog and Pick a date');
      const done = f.section('done');
      const doneRows = done.querySelectorAll('.sauce-today-done-row');
      assert(doneRows.length === 2, 'two done-today rows');
      assert(doneRows[0].querySelector('.sauce-today-done-time').textContent === '16:40'
        && doneRows[1].querySelector('.sauce-today-done-time').textContent === '08:05',
        'done rows newest first with local HH:mm');
      assert(done.querySelector('.sauce-today-done-log'), 'Open done log footer link present');
      assert(!f.rowPaths('upnext').includes('spice/tasks/future.md') && !f.rowPaths('upnext').includes('spice/tasks/backlog.md'),
        'future and backlog tasks are not in Up next');
      assert(f.root.querySelector('.sauce-today-sort') && f.root.querySelector('.sauce-today-group'), 'Sort and Group controls render');
      assert(/Sort: Smart/.test(f.root.querySelector('.sauce-today-sort').textContent), 'default sort label is Smart');

      await f.root.querySelector('.sauce-today-done-log')._fire('click');
      assert(f.calls.opened.includes('spice/to-do/Completed Tasks.md'), 'Open done log opens the Completed Tasks hub');
    } finally { f.cleanup(); }
  });

  await ok('RD-P-COMPACT Home (compact) shows only Up next and Overdue, stale folded in, no Sort / Group', async () => {
    const f = await renderLivePanel({ viewedDay: 'Home', asOf: P_TODAY, compact: true, taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(JSON.stringify(f.labels()) === JSON.stringify(['Up next', 'Overdue · 3']),
        'compact section labels: ' + JSON.stringify(f.labels()));
      assert(JSON.stringify(f.rowPaths('overdue')) === JSON.stringify(['spice/tasks/stale-40.md', 'spice/tasks/late-7.md', 'spice/tasks/late-3.md']),
        'stale folded into Overdue, most late first: ' + f.rowPaths('overdue'));
      assert(!f.section('stale') && !f.section('done'), 'no Stale or Done today section');
      assert(!f.root.querySelector('.sauce-today-sort') && !f.root.querySelector('.sauce-today-group')
        && !f.root.querySelector('.sauce-today-controls'), 'no Sort / Group controls');
      assert(f.root.querySelector('.sauce-today-panel.is-compact'), 'panel carries .is-compact');
      assert(f.section('overdue').querySelector('.sauce-today-moveall'), 'Move all to today stays on Overdue');
    } finally { f.cleanup(); }

    const stored = await renderLivePanel({ viewedDay: 'Home', asOf: P_TODAY, compact: true, prefs: { sort: 'priority', group: 'project' }, taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(!stored.root.querySelector('.sauce-today-group-label'), 'stored To-Do grouping is ignored on Home');
    } finally { stored.cleanup(); }

    const daily = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(daily.labels().length === 4 && daily.root.querySelector('.sauce-today-sort'), 'the daily note keeps all four sections and the controls');
    } finally { daily.cleanup(); }
  });

  await ok('RD-P-ALL-SOURCES a project task due today appears in Up next', async () => {
    const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone });
    try {
      assert(f.rowPaths('upnext').includes('spice/tasks/today-proj.md'), 'project task listed: ' + f.rowPaths('upnext'));
      assert(f.rowPaths('upnext').includes('spice/tasks/today-a.md'), 'personal task listed');
    } finally { f.cleanup(); }
  });

  await ok('RD-P-DONE-UNDO Undo reopens the _done/ path and removes the row', async () => {
    const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone });
    try {
      const undo = f.section('done').querySelectorAll('.sauce-today-undo')[0];
      assert(undo, 'Undo button present');
      await undo._fire('click');
      assert(JSON.stringify(f.calls.reopen) === JSON.stringify(['spice/tasks/_done/done-late.md']),
        'reopen called with the _done/ path: ' + JSON.stringify(f.calls.reopen));
      assert(f.section('done').querySelectorAll('.sauce-today-done-row').length === 1, 'reopened row leaves Done today');
      assert(f.labels().includes('Done today · 1'), 'Done today count updates: ' + f.labels());
    } finally { f.cleanup(); }

    const bad = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, reopenResult: () => ({ ok: false, reason: 'not-done' }) });
    try {
      const undo = bad.section('done').querySelectorAll('.sauce-today-undo')[0];
      assert(undo.getAttribute('aria-label') === 'Undo: Done late', 'Undo aria-label names the task: ' + undo.getAttribute('aria-label'));
      await undo._fire('click');
      assert(bad.section('done').querySelectorAll('.sauce-today-done-row').length === 2, 'failed reopen keeps the row');
      assert(bad.notices.length === 1, 'silent pre-write refusal gets exactly one panel Notice: ' + JSON.stringify(bad.notices));
      assert(undo.disabled === false, 'Undo re-enabled after failure');
    } finally { bad.cleanup(); }

    const noticed = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, reopenResult: () => ({ ok: false, reason: 'disk on fire' }) });
    try {
      await noticed.section('done').querySelectorAll('.sauce-today-undo')[0]._fire('click');
      assert(noticed.notices.length === 0, 'a failed write (already noticed by RenderSafe) adds no panel Notice: ' + JSON.stringify(noticed.notices));
    } finally { noticed.cleanup(); }
  });

  await ok('RD-P-MOVEALL Move all to today reschedules each overdue task sequentially to today', async () => {
    const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone });
    try {
      const btn = f.section('overdue').querySelector('.sauce-today-moveall');
      assert(btn, 'Move all to today button present');
      await btn._fire('click');
      assert(f.calls.reschedule.length === 2, 'two reschedule calls: ' + f.calls.reschedule.length);
      assert(f.calls.reschedule.every((c) => c.newDue === P_TODAY && c.viewedDay === P_TODAY), 'each to todayStr');
      assert(JSON.stringify(f.calls.reschedule.map((c) => c.path)) === JSON.stringify(['spice/tasks/late-7.md', 'spice/tasks/late-3.md']),
        'in overdue order');
      assert(f.calls.reschedule.every((c) => c.row && c.TDref), 'each call carries its row and TaskDialog');
      assert(f.maxInFlight() === 1, 'sequential, never concurrent: ' + f.maxInFlight());
      assert(!f.section('overdue'), 'Overdue section disappears once empty');
      assert(f.rowPaths('upnext').includes('spice/tasks/late-7.md') && f.rowPaths('upnext').includes('spice/tasks/late-3.md'),
        'moved tasks re-render under Up next');
    } finally { f.cleanup(); }
  });

  await ok('RD-P-STALE Backlog/Pick a date inline actions and Triage prefs', async () => {
    const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, prefs: { tab: 'today', sort: 'priority', group: 'none' } });
    try {
      const row = f.rowFor('stale', 'spice/tasks/stale-40.md');
      await row.querySelector('.sauce-today-stale-backlog')._fire('click');
      assert(f.calls.reschedule.length === 1 && f.calls.reschedule[0].newDue === '' && f.calls.reschedule[0].viewedDay === P_TODAY,
        'Backlog reschedules to blank due');
      assert(!f.section('stale'), 'Stale section empties after the move');
    } finally { f.cleanup(); }

    const g = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, prefs: { tab: 'today', sort: 'priority', group: 'none' } });
    try {
      const row = g.rowFor('stale', 'spice/tasks/stale-40.md');
      await row.querySelector('.sauce-today-stale-pick')._fire('click');
      const input = row.querySelector('.sauce-today-stale-date');
      assert(input && input.type === 'date', 'Pick a date opens a native date input');
      input.value = '2026-07-20';
      await input._fire('change');
      assert(g.calls.reschedule.length === 1 && g.calls.reschedule[0].newDue === '2026-07-20', 'picked date reschedules');
    } finally { g.cleanup(); }

    const h = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, prefs: { tab: 'today', sort: 'priority', group: 'project' } });
    try {
      const triage = h.section('stale').querySelector('.sauce-today-triage');
      assert(triage, 'Triage link in the Stale header');
      await triage._fire('click');
      const saved = JSON.parse(h.storage.getItem(P_PREFS_KEY));
      assert(saved.tab === 'overdue' && saved.sort === 'priority' && saved.group === 'project',
        'Triage read-merge-writes tab overdue: ' + JSON.stringify(saved));
    } finally { h.cleanup(); }
  });

  await ok('RD-P-RENUMBER pure renumber returns only changed ranks', async () => {
    const TaskEntityClass = new Function(`${TE_SRC}; return TaskEntity;`)();
    const Dash = loadDashboard(makeMomentWindow(), { TaskEntity: new TaskEntityClass() });
    const out = Dash.renumber(['d', 'a', 'b', 'c', 'e'], { a: 1, b: 2, c: 3, d: 4, e: 5 });
    assert(JSON.stringify(out) === JSON.stringify([
      { path: 'd', rank: 1 }, { path: 'a', rank: 2 }, { path: 'b', rank: 3 }, { path: 'c', rank: 4 },
    ]), 'only moved rows renumbered: ' + JSON.stringify(out));
    const fresh = Dash.renumber(['x', 'y'], {});
    assert(JSON.stringify(fresh) === JSON.stringify([{ path: 'x', rank: 1 }, { path: 'y', rank: 2 }]), 'unranked rows get ranks');
    assert(Dash.renumber(null, null).length === 0, 'null-safe');
    const Cold = loadDashboard(makeMomentWindow(), {});
    assert(Cold.renumber(['x'], {}).length === 0, 'before TaskEntity loads nothing is renumbered');
  });

  const rankedPages = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((s, i) =>
    pTask(s, s[0].toUpperCase() + s.slice(1), P_TODAY, { rank: i + 1 }));

  await ok('RD-P-RANK-DROP drop of row 3 to index 0 writes ranks only for moved rows', async () => {
    const f = await renderLivePanel({ taskPages: rankedPages });
    try {
      const before = f.rowPaths('upnext');
      assert(JSON.stringify(before) === JSON.stringify(rankedPages.map((p) => p.file.path)), 'smart sort honours rank: ' + before);
      const rows = f.section('upnext').querySelectorAll('.sauce-task-today-row');
      assert(rows.every((r) => r.querySelector('.sauce-task-drag')), 'Up next rows carry drag handles');
      const dt = { setData() {}, setDragImage() {}, effectAllowed: '', dropEffect: '' };
      await rows[3].querySelector('.sauce-task-drag')._fire('dragstart', { dataTransfer: dt });
      await rows[0]._fire('dragover', { dataTransfer: dt });
      await rows[0]._fire('drop', { dataTransfer: dt });
      assert(JSON.stringify(f.calls.setFields) === JSON.stringify([
        { path: 'spice/tasks/delta.md', fields: { rank: 1 } },
        { path: 'spice/tasks/alpha.md', fields: { rank: 2 } },
        { path: 'spice/tasks/bravo.md', fields: { rank: 3 } },
        { path: 'spice/tasks/charlie.md', fields: { rank: 4 } },
      ]), 'setFields sequence: ' + JSON.stringify(f.calls.setFields));
      assert(JSON.stringify(f.rowPaths('upnext')) === JSON.stringify([
        'spice/tasks/delta.md', 'spice/tasks/alpha.md', 'spice/tasks/bravo.md', 'spice/tasks/charlie.md', 'spice/tasks/echo.md',
      ]), 'DOM reordered: ' + f.rowPaths('upnext'));
      assert(f.notices.length === 0, 'no notice on success');
    } finally { f.cleanup(); }
  });

  await ok('RD-P-RANK-GONE rows already removed (completed in place) are left out of the renumber', async () => {
    const f = await renderLivePanel({ taskPages: rankedPages });
    try {
      const rows = f.section('upnext').querySelectorAll('.sauce-task-today-row');
      rows[1].remove();
      const dt = { setData() {}, setDragImage() {} };
      await rows[4].querySelector('.sauce-task-drag')._fire('dragstart', { dataTransfer: dt });
      await rows[0]._fire('drop', { dataTransfer: dt });
      assert(!f.calls.setFields.some((c) => c.path === 'spice/tasks/bravo.md'), 'detached row never written');
      assert(JSON.stringify(f.calls.setFields) === JSON.stringify([
        { path: 'spice/tasks/echo.md', fields: { rank: 1 } },
        { path: 'spice/tasks/alpha.md', fields: { rank: 2 } },
      ]), 'visible order [echo, alpha, charlie, delta]: charlie 3 and delta 4 already match: ' + JSON.stringify(f.calls.setFields));
    } finally { f.cleanup(); }
  });

  await ok('RD-P-RANK-FAIL a silently refused rank write re-renders the panel and shows one Notice', async () => {
    const f = await renderLivePanel({
      taskPages: rankedPages,
      setFieldsResult: (p) => (p === 'spice/tasks/alpha.md' ? { ok: false, reason: 'task file not found' } : { ok: true }),
    });
    try {
      const rows = f.section('upnext').querySelectorAll('.sauce-task-today-row');
      const dt = { setData() {}, setDragImage() {} };
      await rows[3].querySelector('.sauce-task-drag')._fire('dragstart', { dataTransfer: dt });
      await rows[0]._fire('drop', { dataTransfer: dt });
      assert(f.notices.length === 1, 'exactly one panel notice for the silent refusal: ' + JSON.stringify(f.notices));
      assert(f.calls.setFields.length === 4, 'remaining writes still attempted sequentially');
      const order = f.rowPaths('upnext');
      assert(JSON.stringify(order) === JSON.stringify([
        'spice/tasks/alpha.md', 'spice/tasks/delta.md', 'spice/tasks/bravo.md', 'spice/tasks/charlie.md', 'spice/tasks/echo.md',
      ]), 'panel re-rendered with the ranks that persisted (alpha kept rank 1): ' + order);
    } finally { f.cleanup(); }
  });

  await ok('RD-P-MOVE-MENU onMove (no-drag fallback) via the row menu renumbers', async () => {
    const f = await renderLivePanel({ taskPages: rankedPages });
    try {
      const row = f.rowFor('upnext', 'spice/tasks/bravo.md');
      await row.querySelector('.sauce-task-action-more')._fire('click');
      const menu = f.calls.menus[f.calls.menus.length - 1];
      const up = menu && menu.entries.find((e) => e.label === 'Move up');
      assert(up, 'Move up offered in the row menu');
      await up.onSelect();
      await new Promise((r) => setTimeout(r, 5));
      assert(JSON.stringify(f.calls.setFields) === JSON.stringify([
        { path: 'spice/tasks/bravo.md', fields: { rank: 1 } },
        { path: 'spice/tasks/alpha.md', fields: { rank: 2 } },
      ]), 'move up swaps two ranks: ' + JSON.stringify(f.calls.setFields));
    } finally { f.cleanup(); }

    const g = await renderLivePanel({ taskPages: rankedPages, prefs: { tab: 'today', sort: 'priority', group: 'none' } });
    try {
      const rows = g.section('upnext').querySelectorAll('.sauce-task-today-row');
      assert(rows.every((r) => !r.querySelector('.sauce-task-drag')), 'no drag handles outside smart/manual sort');
      assert(/Sort: Priority/.test(g.root.querySelector('.sauce-today-sort').textContent), 'sort label reflects prefs');
    } finally { g.cleanup(); }
  });

  await ok('RD-P-REAL-RANK-FAIL real TaskDialog + RenderSafe: one RenderSafe Notice per failed row, none from the panel', async () => {
    const f = await renderLivePanel({ taskPages: rankedPages, realTD: true });
    try {
      const rows = f.section('upnext').querySelectorAll('.sauce-task-today-row');
      const dt = { setData() {}, setDragImage() {} };
      await rows[3].querySelector('.sauce-task-drag')._fire('dragstart', { dataTransfer: dt });
      await rows[0]._fire('drop', { dataTransfer: dt });
      assert(f.calls.setFields.length === 4, 'four rank writes attempted: ' + f.calls.setFields.length);
      assert(f.calls.writes === 4, 'each reached processFrontMatter (which threw): ' + f.calls.writes);
      assert(f.notices.length === 4 && f.notices.every((n) => n === 'Could not update task'),
        'exactly one RenderSafe Notice per failed row and no panel Notice: ' + JSON.stringify(f.notices));
      assert(JSON.stringify(f.rowPaths('upnext')) === JSON.stringify(rankedPages.map((p) => p.file.path)),
        'panel re-rendered back to the persisted order: ' + f.rowPaths('upnext'));
    } finally { f.cleanup(); }
  });

  await ok('RD-P-REAL-UNDO-FAIL real TaskDialog + RenderSafe: failed Undo shows only RenderSafe\'s Notice', async () => {
    const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, realTD: true });
    try {
      await f.section('done').querySelectorAll('.sauce-today-undo')[0]._fire('click');
      assert(JSON.stringify(f.calls.reopen) === JSON.stringify(['spice/tasks/_done/done-late.md']), 'real reopen called');
      assert(f.calls.writes === 1, 'reopen reached processFrontMatter: ' + f.calls.writes);
      assert(JSON.stringify(f.notices) === JSON.stringify(['Could not reopen task']),
        'exactly RenderSafe\'s Notice, nothing on top: ' + JSON.stringify(f.notices));
      assert(f.section('done').querySelectorAll('.sauce-today-done-row').length === 2, 'row kept after failure');
    } finally { f.cleanup(); }
  });

  await ok('RD-P-MOVEALL-POLICY no_op results are skipped silently; a throwing call gets one panel Notice', async () => {
    const f = await renderLivePanel({
      taskPages: sectionPages, donePages: sectionDone,
      rescheduleResult: () => ({ ok: false, no_op: true, in_flight: true }),
    });
    try {
      await f.section('overdue').querySelector('.sauce-today-moveall')._fire('click');
      assert(f.calls.reschedule.length === 2, 'both attempted');
      assert(f.notices.length === 0, 'skipped no_op results add no Notice: ' + JSON.stringify(f.notices));
      assert(f.rowPaths('overdue').length === 2, 'skipped tasks stay in Overdue');
    } finally { f.cleanup(); }

    const g = await renderLivePanel({
      taskPages: sectionPages, donePages: sectionDone,
      rescheduleResult: () => ({ ok: false, reason: 'disk on fire' }),
    });
    try {
      await g.section('overdue').querySelector('.sauce-today-moveall')._fire('click');
      assert(g.notices.length === 0, 'reschedule write failures were already noticed by reschedule: ' + JSON.stringify(g.notices));
    } finally { g.cleanup(); }

    const h = await renderLivePanel({
      taskPages: sectionPages, donePages: sectionDone,
      rescheduleResult: () => { throw new Error('boom'); },
    });
    try {
      await h.section('overdue').querySelector('.sauce-today-moveall')._fire('click');
      assert(h.notices.length === 1 && /Could not move 2 tasks/.test(h.notices[0]),
        'a call that threw past its own guard gets one panel Notice: ' + JSON.stringify(h.notices));
    } finally { h.cleanup(); }
  });

  await ok('RD-P-LOCKS Move all lock survives a re-render and disables the button while running', async () => {
    let release = null;
    const gate = new Promise((r) => { release = r; });
    const f = await renderLivePanel({
      taskPages: sectionPages, donePages: sectionDone,
      rescheduleResult: async () => { await gate; return { ok: true }; },
    });
    try {
      const btn = f.section('overdue').querySelector('.sauce-today-moveall');
      const running = btn._fire('click');
      await new Promise((r) => setTimeout(r, 5));
      assert(btn.disabled === true && /Moving/.test(btn.textContent), 'button disabled while running');
      const host = f.root.querySelector('.sauce-today-panel-host');
      f.dash._renderTodayPanel(host, {
        dv: {}, todayStr: P_TODAY, TTL: f.TTL,
        model: { today: [], overdue: [f.TE.parseNote(sectionPages[2])], stale: [], doneToday: [] },
      });
      const fresh = f.section('overdue').querySelector('.sauce-today-moveall');
      assert(fresh !== btn && fresh.disabled === true, 'a re-rendered panel sees the in-progress Move all');
      const second = fresh._fire('click');
      release();
      await running;
      await second;
      assert(f.calls.reschedule.length === 2, 'the re-rendered button did not start a second run: ' + f.calls.reschedule.length);
      const after = f.root.querySelectorAll('.sauce-today-moveall');
      assert(after.every((b) => b.disabled !== true), 'lock released after the run');
    } finally { f.cleanup(); }
  });

  await ok('RD-P-INSTANCE-DELEGATES computeCounts/selectTasks/selectMeetings reachable on the stored instance', async () => {
    const TaskEntityClass = new Function(`${TE_SRC}; return TaskEntity;`)();
    const TE = new TaskEntityClass();
    const Dash = loadDashboard(makeMomentWindow(), {});
    const inst = new Dash();
    const fakeDv = { pages: (q) => (q === '"spice/tasks"' ? sectionPages : q === '"spice/tasks/_done"' ? sectionDone
      : q === '"spice/meetings/notes"' ? [{ file: { name: 'Standup-' + P_TODAY, path: 'spice/meetings/notes/Standup-' + P_TODAY + '.md' } }] : []) };
    assert(typeof inst.computeCounts === 'function', 'instance computeCounts exists');
    const c = inst.computeCounts(fakeDv, P_TODAY, TE);
    assert(c.today === 2 && c.overdue === 3 && c.stale === 1 && c.done === 2 && c.backlog === 1 && c.meetings === 1,
      'non-zero counts through the instance: ' + JSON.stringify(c));
    assert(inst.selectTasks(fakeDv, P_TODAY, TE).open.length === 2, 'instance selectTasks');
    assert(inst.selectMeetings(fakeDv, P_TODAY).length === 1, 'instance selectMeetings');
    assert(typeof inst._openTodayToDo === 'function', '_openTodayToDo is already an instance method');
  });

  await ok('RD-P-GROUP-SORT controls write prefs and regroup Up next', async () => {
    const pages = [
      pTask('g1', 'Gamma', P_TODAY, { priority: 'low', project_slug: 'harbor', project: '[[Harbor]]', source: 'project' }),
      pTask('g2', 'Beta', P_TODAY, { priority: 'high' }),
      pTask('g3', 'Alpha', P_TODAY, { priority: 'high', project_slug: 'harbor', project: '[[Harbor]]', source: 'project' }),
    ];
    const f = await renderLivePanel({ taskPages: pages, prefs: { tab: 'backlog', sort: 'smart', group: 'project' } });
    try {
      const groups = f.section('upnext').querySelectorAll('.sauce-today-group-label').map((n) => n.textContent);
      assert(JSON.stringify(groups) === JSON.stringify(['Harbor', 'No project']), 'project groups: ' + JSON.stringify(groups));
      await f.root.querySelector('.sauce-today-sort')._fire('click');
      const menu = f.calls.menus[f.calls.menus.length - 1];
      const due = menu && menu.entries.find((e) => e.label === 'Due date');
      assert(due, 'sort menu offers Due date');
      await due.onSelect();
      const saved = JSON.parse(f.storage.getItem(P_PREFS_KEY));
      assert(saved.sort === 'due' && saved.tab === 'backlog' && saved.group === 'project', 'sort read-merge-written: ' + JSON.stringify(saved));
      assert(/Sort: Due/.test(f.root.querySelector('.sauce-today-sort').textContent), 'panel re-rendered with new sort');
    } finally { f.cleanup(); }
  });

  const findInput = (node, type) => {
    for (const c of node.children) {
      if (c._tag === 'input' && c.type === type) return c;
      const hit = findInput(c, type);
      if (hit) return hit;
    }
    return null;
  };

  await ok('RD-P-MOBILE mobile: no drag handle or drag listeners; Move up / down stays in the row menu', async () => {
    const f = await renderLivePanel({ taskPages: rankedPages, isMobile: true });
    try {
      const rows = f.section('upnext').querySelectorAll('.sauce-task-today-row');
      assert(rows.length === 5, 'five rows: ' + rows.length);
      assert(rows.every((r) => !r.querySelector('.sauce-task-drag')), 'no drag handles on mobile');
      for (const r of rows) {
        for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
          assert(!(r._listeners[type] || []).length, 'no ' + type + ' listener on a mobile row');
        }
      }
      const row = f.rowFor('upnext', 'spice/tasks/bravo.md');
      await row.querySelector('.sauce-task-action-more')._fire('click');
      const menu = f.calls.menus[f.calls.menus.length - 1];
      const up = menu && menu.entries.find((e) => e.label === 'Move up');
      assert(up, 'Move up still offered on mobile');
      await up.onSelect();
      await new Promise((r) => setTimeout(r, 5));
      assert(JSON.stringify(f.calls.setFields.map((c) => c.path)) === JSON.stringify(['spice/tasks/bravo.md', 'spice/tasks/alpha.md']),
        'Move up renumbers on mobile: ' + JSON.stringify(f.calls.setFields));
    } finally { f.cleanup(); }
  });

  await ok('RD-P-DRAG-FIELD desktop: a drag from a form field is cancelled; payload is the custom type, never text/plain', async () => {
    const f = await renderLivePanel({ taskPages: rankedPages });
    try {
      const rows = f.section('upnext').querySelectorAll('.sauce-task-today-row');
      assert(rows.every((r) => !(r._listeners.dragstart || []).length), 'the row itself starts no drag');
      const handle = rows[3].querySelector('.sauce-task-drag');
      const field = { closest: (sel) => (/input/.test(sel) && /textarea/.test(sel) && /select/.test(sel) ? field : null) };
      let cancelled = false;
      await handle._fire('dragstart', {
        target: field,
        dataTransfer: { setData() { throw new Error('no drag data from a form field'); } },
        preventDefault() { cancelled = true; },
      });
      assert(cancelled, 'dragstart from a form field is cancelled');
      await rows[0]._fire('drop', { dataTransfer: { getData: () => '' } });
      assert(f.calls.setFields.length === 0, 'nothing reordered after a cancelled drag: ' + JSON.stringify(f.calls.setFields));

      const types = [];
      await handle._fire('dragstart', {
        target: { closest: () => null },
        dataTransfer: { setData(type, value) { types.push([type, value]); }, setDragImage() {} },
      });
      assert(JSON.stringify(types) === JSON.stringify([['application/x-sauce-task-path', 'spice/tasks/delta.md']]),
        'only the custom type is set: ' + JSON.stringify(types));
      await rows[0]._fire('drop', { dataTransfer: { getData: (t) => (t === 'application/x-sauce-task-path' ? 'spice/tasks/delta.md' : '') } });
      assert(f.calls.setFields.length === 4 && f.calls.setFields[0].path === 'spice/tasks/delta.md',
        'the drop reads the custom type: ' + JSON.stringify(f.calls.setFields));
    } finally { f.cleanup(); }
  });

  await ok('RD-P-LIVE-GATE-SKEW an older TaskTodayList missing a live-panel member keeps the legacy panel', async () => {
    const Dash = loadDashboard(makeMomentWindow(), {});
    assert(Array.isArray(Dash.LIVE_PANEL_TTL_METHODS)
      && ['renderDoneRow', 'classifyOutcome', 'manualOrder'].every((m) => Dash.LIVE_PANEL_TTL_METHODS.includes(m)),
      'the gate lists the members the panel calls');
    for (const missing of ['renderDoneRow', 'classifyOutcome', 'manualOrder', '_isMobile', 'clearDateLabel']) {
      const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, mutateTTL: (ttl) => { ttl[missing] = undefined; } });
      try {
        assert(f.sections().length === 0, missing + ' missing: no sectioned panel');
        assert(f.root.querySelectorAll('.sauce-daily-task-today-list').length === 1, missing + ' missing: legacy panel renders');
      } finally { f.cleanup(); }
    }
    const g = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone, mutateTTL: (ttl) => { Object.defineProperty(ttl, 'SORT_OPTIONS', { value: undefined }); } });
    try {
      assert(g.sections().length === 0, 'missing SORT_OPTIONS: legacy panel');
    } finally { g.cleanup(); }
  });

  await ok('RD-P-ONDONE checking an Up next / Overdue / Stale row moves it into Done today at once', async () => {
    for (const [section, p, title] of [
      ['upnext', 'spice/tasks/today-a.md', 'Today alpha'],
      ['overdue', 'spice/tasks/late-7.md', 'Late seven'],
      ['stale', 'spice/tasks/stale-40.md', 'Stale forty'],
    ]) {
      const f = await renderLivePanel({ taskPages: sectionPages, donePages: sectionDone });
      try {
        const row = f.rowFor(section, p);
        const cb = findInput(row, 'checkbox');
        assert(cb, section + ': row checkbox present');
        cb.checked = true;
        await cb._fire('change');
        await new Promise((r) => setTimeout(r, 2));
        assert(JSON.stringify(f.calls.markDone) === JSON.stringify([p]), section + ': markDone called');
        assert(!f.rowPaths(section).includes(p), section + ': row left its section');
        assert(f.labels().includes('Done today · 3'), section + ': Done today count: ' + JSON.stringify(f.labels()));
        const doneRows = f.section('done').querySelectorAll('.sauce-today-done-row');
        assert(doneRows[0].dataset.sauceTaskPath === p.replace('spice/tasks/', 'spice/tasks/_done/'),
          section + ': newest done row is the _done/ path: ' + doneRows[0].dataset.sauceTaskPath);
        assert(doneRows[0].querySelector('.sauce-today-done-title').textContent === title, section + ': title');
      } finally { f.cleanup(); }
    }
    const recurring = [pTask('water', 'Water plants', P_TODAY, { recurrence: 'every day' })];
    const r = await renderLivePanel({ taskPages: recurring });
    try {
      const cb = findInput(r.rowFor('upnext', 'spice/tasks/water.md'), 'checkbox');
      cb.checked = true;
      await cb._fire('change');
      await new Promise((res) => setTimeout(res, 2));
      assert(!r.rowPaths('upnext').includes('spice/tasks/water.md'), 'recurring row leaves Up next');
      assert(!r.section('done'), 'a recurring completion never reaches Done today');
    } finally { r.cleanup(); }
  });

  await ok('RD-P-LABELS Sort / Group use the To-Do view wording; any grouping (incl. Due day) turns reorder off', async () => {
    const f = await renderLivePanel({ taskPages: rankedPages, prefs: { tab: 'today', sort: 'manual', group: 'none' } });
    try {
      assert(/Sort: My order/.test(f.root.querySelector('.sauce-today-sort').textContent), 'manual sort reads My order');
      await f.root.querySelector('.sauce-today-sort')._fire('click');
      const sortMenu = f.calls.menus[f.calls.menus.length - 1];
      assert(JSON.stringify(sortMenu.entries.map((e) => e.label)) === JSON.stringify(f.TTL.SORT_OPTIONS.map((o) => o.label)),
        'sort menu labels are the shared ones: ' + JSON.stringify(sortMenu.entries.map((e) => e.label)));
      assert(sortMenu.entries.find((e) => e.label === 'My order').icon === '✓', 'current sort marked');
      await f.root.querySelector('.sauce-today-group')._fire('click');
      const groupMenu = f.calls.menus[f.calls.menus.length - 1];
      assert(JSON.stringify(groupMenu.entries.map((e) => e.label)) === JSON.stringify(['None', 'Project', 'Priority', 'Due day']),
        'group menu labels: ' + JSON.stringify(groupMenu.entries.map((e) => e.label)));
      await groupMenu.entries.find((e) => e.label === 'Due day').onSelect();
      assert(/Group: Due day/.test(f.root.querySelector('.sauce-today-group').textContent), 'group button reads Due day');
      const rows = f.section('upnext').querySelectorAll('.sauce-task-today-row');
      assert(rows.length === 5 && rows.every((r) => !r.querySelector('.sauce-task-drag')), 'grouped by due: no drag handles');
      assert(rows.every((r) => !(r._listeners.drop || []).length), 'grouped by due: rows are no drop targets');
      const labels = f.section('upnext').querySelectorAll('.sauce-today-group-label').map((n) => n.textContent);
      assert(JSON.stringify(labels) === JSON.stringify(['Fri Jul 3']), 'due-day group label: ' + JSON.stringify(labels));
      await rows[1].querySelector('.sauce-task-action-more')._fire('click');
      const rowMenu = f.calls.menus[f.calls.menus.length - 1];
      assert(!rowMenu.entries.some((e) => e.label === 'Move up'), 'no Move up while grouped');
    } finally { f.cleanup(); }
  });

  await ok('RD-P-CLEAR-DATE-LABEL a project / trip / meeting / subtask row says Remove date, a personal row Move to backlog', async () => {
    const pages = [
      pTask('mine', 'Mine', P_TODAY),
      pTask('proj', 'Proj', P_TODAY, { project_slug: 'harbor', project: '[[Harbor]]', source: 'project' }),
      pTask('trip', 'Trip', P_TODAY, { trip_slug: 'lisbon', trip: '[[Lisbon]]' }),
      pTask('meet', 'Meet', P_TODAY, { source: 'meeting' }),
      pTask('sub', 'Sub', P_TODAY, { parent_task: '[[Mine]]' }),
      pTask('stale-proj', 'Old proj', '2026-05-01', { project_slug: 'harbor', project: '[[Harbor]]', source: 'project' }),
    ];
    const f = await renderLivePanel({ taskPages: pages });
    try {
      const firstLabel = async (p) => {
        const row = f.rowFor('upnext', p);
        await row.querySelector('.sauce-task-action-more')._fire('click');
        return f.calls.menus[f.calls.menus.length - 1].entries[0].label;
      };
      assert(await firstLabel('spice/tasks/mine.md') === 'Move to backlog', 'personal task -> Move to backlog');
      for (const slug of ['proj', 'trip', 'meet', 'sub']) {
        const label = await firstLabel('spice/tasks/' + slug + '.md');
        assert(label === 'Remove date', slug + ' -> Remove date, got ' + label);
      }
      const staleBtn = f.rowFor('stale', 'spice/tasks/stale-proj.md').querySelector('.sauce-today-stale-backlog');
      assert(staleBtn.textContent === 'Remove date', 'stale project row inline button: ' + staleBtn.textContent);
    } finally { f.cleanup(); }
  });

  console.log(`\nrun-daily-dashboard: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
  process.exit(process.exitCode);
})().catch((e) => { console.error('run-daily-dashboard threw:', e); process.exit(1); });
