'use strict';

// run-trips-render-guards.js — cold-load render coverage for the trips blueprint's
// render widgets. Autoloop queue item cov-blueprint-trips-widget-render.
//
// run-trips.js unit-tests TripNavButtons.detectContext (the behavioral axis) but
// none of the three render widgets had a render()-execution test. TripNavButtons
// and TripSectionsCards early-return on their `if (!page || !page.file) return`
// cold-load guard; TripsHubCards has no current-note dependency and instead
// queries dv.pages('"spice/trips"') (empty when Dataview is un-indexed) and hands
// the empty set to BeaconCards. This harness drives each widget's render() through
// those paths — dv.current()/RenderSafe.page(dv) undefined/null and dv.pages()
// empty — in a normal container AND a `.markdown-embed` context, asserting no
// throw. Same render-safe net the to-do / cowork / project / scratch / task-entity
// / wiki widgets already have.
//
// Stubs mirror run-wiki-render-guards.js (empty dv.pages chainable, tolerant DOM
// proxy with firstChild→null, chainable window.moment, real RenderSafe instance +
// no-op BeaconCards/chrome classes). Zero-dep. "N passed, M failed" — exit 0 iff
// M === 0.

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
            if (EL_NULL_PROPS.has(prop)) return null;
            if (EL_EMPTY_PROPS.has(prop)) return [];
            if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
            if (prop === 'querySelector') return () => null;
            if (prop === 'querySelectorAll') return () => [];
            if (prop === 'getBoundingClientRect') return () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
            if (typeof prop === 'symbol') return undefined;
            if (Object.prototype.hasOwnProperty.call(store, prop)) return store[prop];
            return () => makeEl(closestImpl);
        },
    });
}

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

function makeMoment() {
    const NUM = new Set(['valueOf', 'unix', 'diff', 'day', 'date', 'month', 'year', 'week', 'isoWeek', 'weekday', 'hour', 'hours', 'minute', 'minutes', 'second', 'daysInMonth']);
    const BOOL = new Set(['isBefore', 'isAfter', 'isSame', 'isSameOrBefore', 'isSameOrAfter', 'isValid', 'isBetween']);
    const m = new Proxy(function () {}, {
        get(_t, prop) {
            if (prop === 'format') return () => '2026-07-03';
            if (prop === 'toDate') return () => new Date(0);
            if (prop === 'toISOString') return () => '2026-07-03T00:00:00.000Z';
            if (prop === 'startOf' || prop === 'endOf') return () => m;
            if (NUM.has(prop)) return () => 0;
            if (BOOL.has(prop)) return () => false;
            if (typeof prop === 'symbol') return undefined;
            return () => m;
        },
    });
    return m;
}
const momentFn = (..._args) => makeMoment();

// dv stub — `currentVal` is what dv.current() returns (cold-load: undefined/null).
function makeDv(embed, currentVal) {
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
        current: () => currentVal,
        io: { load: async () => '' },
    };
}

const RenderSafeClass = loadWidget('platform/mechanisms/render-safe/render-safe.js', 'RenderSafe');
const cjs = {
    SectionLabel: { render: () => {}, divider: () => '' },
    AccentButton: { render: () => makeEl() },
    Breadcrumb: { render: async () => {} },
    // TripsHubCards / TripSectionsCards delegate their (empty) card grid to BeaconCards.
    BeaconCards: { render: async () => {} },
    RenderSafe: new RenderSafeClass(),
};
global.customJS = Object.assign(global.customJS || {}, cjs);
global.app = {
    workspace: { openLinkText() {}, getActiveFile() { return null; } },
    vault: { getAbstractFileByPath() { return null; }, async createFolder() {}, async create() {}, async read() { return ''; } },
    commands: { executeCommandById() {} },
    plugins: { plugins: {} },
    metadataCache: { getFirstLinkpathDest() { return null; } },
};
global.window = Object.assign(global.window || {}, { customJS: global.customJS, moment: momentFn, app: global.app });
global.moment = momentFn;

// TripNavButtons is intentionally absent: it was made headless (creation logic
// only, no render()) — the shared TripsChromeBar renders trip chrome now.
const widgets = [
    { name: 'TripsHubCards',     path: 'platform/blueprints/trips/helpers/trips-hub-cards.js' },
    { name: 'TripSectionsCards', path: 'platform/blueprints/trips/helpers/trip-sections-cards.js' },
    { name: 'TripDashboard',     path: 'platform/blueprints/trips/helpers/trip-dashboard.js' },
    { name: 'TripEntryList',     path: 'platform/blueprints/trips/helpers/trip-entry-list.js' },
    { name: 'TripLinks',         path: 'platform/blueprints/trips/helpers/trip-links.js' },
];

// cold-load variants: Dataview not indexed → dv.current()/RenderSafe.page(dv)
// undefined/null and dv.pages() empty; plus the embed context.
const variants = [
    { label: 'normal container, dv.current()=undefined (cold-load)', embed: false, current: undefined },
    { label: 'normal container, dv.current()=null (cold-load)', embed: false, current: null },
    { label: '.markdown-embed context', embed: true, current: undefined },
];

(async () => {
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { await guard(`TRIPGUARD-load ${w.name}`, () => { throw e; }); continue; }
        for (const v of variants) {
            await guard(`TRIPGUARD ${w.name} — ${v.label}`, async () => {
                const inst = new WidgetClass();
                await Promise.resolve(inst.render(makeDv(v.embed, v.current), {}));
            });
        }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
