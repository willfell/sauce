'use strict';

// run-cowork-render-guards.js — cold-load render coverage for the cowork
// blueprint's 9 dashboard widgets. Autoloop queue item
// cov-blueprint-cowork-widget-render: run-cowork-smoke.js asserts the widgets'
// STRUCTURE (class declared, manifest registers it, Cowork.md embeds it) but
// never executes render(); only CoworkLensShiftCards had a render() test (in
// run-helper-cases.js). This harness drives each widget's render() through the
// cold-load path — Dataview not yet indexed (empty dv.pages) — in BOTH a normal
// container and a `.markdown-embed` context, asserting no throw. 7 of the 9 carry
// the `if (dv.container.closest(".markdown-embed")) return;` embed guard; the two
// that don't (CoworkReadiness, CoworkLatestRuns) render folder-query dashboards
// wrapped in try/catch, so they early-out to empty states rather than throwing.
//
// The host surface (window.customJS/window.moment/app.*) is stubbed minimally:
// on the empty-data path app.* is only reached inside onClick handlers (not
// during render), so a no-op app suffices; window.moment is exercised (unguarded
// in CoworkTimeframeButtons/CoworkDailyActions) via a chainable stub. Zero-dep.
// "N passed, M failed" — exit 0 iff M === 0.

const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
async function guard(name, fn) {
    try { await fn(); console.log('ok ' + name); passes++; }
    catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message ? e.message : e)); fails++; }
}

function loadWidget(relPath, className) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
    return new Function(`${src}; return ${className};`)();
}

// --- minimal DOM element stub (write-mostly; tolerant of arbitrary chaining) ---
function makeStyle() {
    return new Proxy({}, { get: (t, p) => (p in t ? t[p] : ''), set: (t, p, v) => { t[p] = v; return true; } });
}
const EL_NULL_PROPS = new Set(['firstChild', 'lastChild', 'nextSibling', 'previousSibling', 'parentNode', 'parentElement']);
const EL_EMPTY_PROPS = new Set(['childNodes', 'children']);
function makeEl(closestImpl) {
    const store = { style: makeStyle() };
    return new Proxy(function () {}, {
        has() { return true; },
        set(_t, prop, val) { store[prop] = val; return true; },
        get(_t, prop) {
            if (prop === 'style') return store.style;
            if (prop === 'closest') return (sel) => (closestImpl ? closestImpl(sel) : null);
            if (EL_NULL_PROPS.has(prop)) return null;            // terminates `while (container.firstChild)` loops
            if (EL_EMPTY_PROPS.has(prop)) return [];
            if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
            if (prop === 'querySelector') return () => null;
            if (prop === 'querySelectorAll') return () => [];
            if (prop === 'getBoundingClientRect') return () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
            if (typeof prop === 'symbol') return undefined;
            if (Object.prototype.hasOwnProperty.call(store, prop)) return store[prop];
            // every other access is a callable that returns a fresh element (createEl/appendChild/
            // setAttribute/addEventListener/removeChild/…) — no-op but chainable.
            return () => makeEl(closestImpl);
        },
    });
}

// --- chainable empty Dataview DataArray (cold-load: nothing indexed) ---
function emptyData() {
    const a = [];
    a.where = () => emptyData();
    a.sort = () => emptyData();
    a.filter = () => emptyData();
    a.map = () => emptyData();
    a.groupBy = () => emptyData();
    a.limit = () => emptyData();
    a.array = () => [];
    a.find = () => undefined;
    a.first = () => undefined;
    a.values = [];
    return a;
}

// --- chainable moment stub (real moment isn't a dep). format→string, numeric
// accessors→0, predicates→false, everything else→self so chains never throw. ---
function makeMoment() {
    const NUM = new Set(['valueOf', 'unix', 'diff', 'day', 'date', 'month', 'year', 'week', 'isoWeek', 'weekday', 'hour', 'hours', 'minute', 'minutes', 'second', 'daysInMonth']);
    const BOOL = new Set(['isBefore', 'isAfter', 'isSame', 'isSameOrBefore', 'isSameOrAfter', 'isValid', 'isBetween']);
    const m = new Proxy(function () {}, {
        get(_t, prop) {
            if (prop === 'format') return () => '2026-07-02';
            if (prop === 'toDate') return () => new Date(0);
            if (prop === 'toISOString') return () => '2026-07-02T00:00:00.000Z';
            if (NUM.has(prop)) return () => 0;
            if (BOOL.has(prop)) return () => false;
            if (typeof prop === 'symbol') return undefined;
            return () => m; // clone/add/subtract/startOf/endOf/local/utc/… → chainable
        },
    });
    return m;
}
const momentFn = (..._args) => makeMoment();

// --- dv stub ---
function makeDv(embed) {
    const closestImpl = (sel) => (sel === '.markdown-embed' ? (embed ? makeEl() : null) : null);
    const container = makeEl(closestImpl);
    return {
        container,
        el: () => makeEl(closestImpl),
        paragraph: () => makeEl(closestImpl),
        header: () => makeEl(closestImpl),
        span: () => makeEl(closestImpl),
        table: () => {},
        view: async () => {},
        pages: () => emptyData(),
        page: () => undefined,
        current: () => undefined,
        io: { load: async () => '' },
    };
}

// --- host globals: window.customJS / window.moment / app / customJS ---
const RenderSafeClass = loadWidget('platform/mechanisms/render-safe/render-safe.js', 'RenderSafe');
const cjs = {
    BeaconCards: { render: async () => {} },
    SectionLabel: { render: () => {} },
    AccentButton: { render: () => {} },
    RenderSafe: new RenderSafeClass(),
};
global.customJS = Object.assign(global.customJS || {}, cjs);
global.app = {
    workspace: { openLinkText() {}, getActiveFile() { return null; } },
    vault: { getAbstractFileByPath() { return null; }, async createFolder() {}, async create() {}, async read() { return ''; } },
    plugins: { plugins: {} },
    metadataCache: { getFirstLinkpathDest() { return null; } },
};
global.window = Object.assign(global.window || {}, { customJS: global.customJS, moment: momentFn, app: global.app });
global.moment = momentFn;

const widgets = [
    { name: 'CoworkDailyHubCards',   path: 'platform/blueprints/cowork/helpers/cowork-daily-hub-cards.js' },
    { name: 'CoworkWeeklyHubCards',  path: 'platform/blueprints/cowork/helpers/cowork-weekly-hub-cards.js' },
    { name: 'CoworkMonthlyHubCards', path: 'platform/blueprints/cowork/helpers/cowork-monthly-hub-cards.js' },
    { name: 'CoworkTimeframeButtons',path: 'platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js' },
    { name: 'CoworkHubNav',          path: 'platform/blueprints/cowork/helpers/cowork-hub-nav.js' },
    { name: 'CoworkDailyActions',    path: 'platform/blueprints/cowork/helpers/cowork-daily-actions.js' },
    { name: 'CoworkReadiness',       path: 'platform/blueprints/cowork/helpers/cowork-readiness.js' },
    { name: 'CoworkLatestRuns',      path: 'platform/blueprints/cowork/helpers/cowork-latest-runs.js' },
    { name: 'CoworkLensShiftCards',  path: 'platform/blueprints/cowork/helpers/cowork-lens-shift-cards.js' },
];

(async () => {
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { await guard(`COWORKGUARD-load ${w.name}`, () => { throw e; }); continue; }
        for (const variant of [{ label: 'normal container', embed: false }, { label: '.markdown-embed context', embed: true }]) {
            await guard(`COWORKGUARD ${w.name} — ${variant.label} (cold-load, empty pages)`, async () => {
                const inst = new WidgetClass();
                await Promise.resolve(inst.render(makeDv(variant.embed), {}));
            });
        }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
