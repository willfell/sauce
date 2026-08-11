'use strict';

// run-wiki-render-guards.js — cold-load render coverage for the wiki blueprint's
// render widgets. Autoloop queue item cov-blueprint-wiki-widget-render.
//
// WikiTree / WikiLeafActions / WikiHubActions had no render()-execution test.
// Each has a clean cold-load guard (`if (!cur || !cur.file) return;` + a
// wiki-type check) plus, for the two action rows, a `.markdown-embed` early
// return. This harness drives each widget's render() through those guard paths —
// Dataview not yet indexed, so dv.current() is undefined/null and dv.pages() is
// empty — in a normal container AND a `.markdown-embed` context, asserting no
// throw. Same render-safe net the to-do / cowork / project / scratch / task-entity
// widgets already have.
//
// Stubs mirror run-task-entity-render-guards.js (empty dv.pages chainable,
// tolerant DOM proxy with firstChild→null, chainable window.moment, real
// RenderSafe instance + no-op chrome/customJS classes the widgets reach for after
// the guard). Zero-dep. "N passed, M failed" — exit 0 iff M === 0.

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
        current: () => {
            if (currentVal === THROW_CURRENT) throw new Error('cold current-page index');
            return currentVal;
        },
        io: { load: async () => '' },
    };
}

const RenderSafeClass = loadWidget('platform/mechanisms/render-safe/render-safe.js', 'RenderSafe');
const THROW_CURRENT = Symbol('throw-current');
const cjs = {
    SectionLabel: { render: () => {}, divider: () => '' },
    AccentButton: { render: () => makeEl() },
    Breadcrumb: { render: async () => {} },
    DocSearch: { render: () => ({ query: '', matched: [] }) },
    EntityCreate: { create: async () => {} },
    // WikiTree best-effort delegates to WikiHubActions; keep it inert here.
    WikiHubActions: { render: () => {} },
    ChromeBar: { makeAdapter: (config) => config, render: () => {} },
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

const widgets = [
    { name: 'WikiTree',        path: 'platform/blueprints/wiki/helpers/wiki-tree.js' },
    { name: 'WikiLeafActions', path: 'platform/blueprints/wiki/helpers/wiki-leaf-actions.js' },
    { name: 'WikiHubActions',  path: 'platform/blueprints/wiki/helpers/wiki-hub-actions.js' },
    { name: 'WikiChromeBar',   path: 'platform/blueprints/wiki/helpers/wiki-chrome-bar.js' },
];

// cold-load variants: Dataview not indexed → dv.current() undefined/null; plus the
// embed context (leaf/hub carry the .markdown-embed early-return guard).
const variants = [
    { label: 'normal container, dv.current()=undefined (cold-load)', embed: false, current: undefined },
    { label: 'normal container, dv.current()=null (cold-load)', embed: false, current: null },
    { label: '.markdown-embed context', embed: true, current: undefined },
    { label: 'dv.current() throws during cold load', embed: false, current: THROW_CURRENT },
    { label: 'CustomJS dependencies missing', embed: false, current: undefined, missingCjs: true },
];

(async () => {
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { await guard(`WIKIGUARD-load ${w.name}`, () => { throw e; }); continue; }
        for (const v of variants) {
            await guard(`WIKIGUARD ${w.name} — ${v.label}`, async () => {
                const priorCjs = global.customJS;
                const priorWindowCjs = global.window.customJS;
                try {
                    if (v.missingCjs) {
                        delete global.customJS;
                        delete global.window.customJS;
                    }
                    const inst = new WidgetClass();
                    await Promise.resolve(inst.render(makeDv(v.embed, v.current), {}));
                } finally {
                    global.customJS = priorCjs;
                    global.window.customJS = priorWindowCjs;
                }
            });
        }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
