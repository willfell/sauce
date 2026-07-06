'use strict';

// run-todo-render-guards.js — cold-load render coverage for the to-do blueprint's
// render widgets. Autoloop queue item cov-blueprint-to-do-widget-render.
//
// Most to-do render widgets have FUNCTIONAL render() tests (run-todo-all-list.js,
// run-todo-markdown-render.js, run-v0127-today-capture-editable-list.js,
// run-todo-materialize.js), but two — ToDoHubActions and ToDoLeafActions (the
// hub/leaf AccentButton rows) — are only referenced structurally, never rendered.
// This harness adds the missing dimension for ALL of them: it drives each widget's
// render() through the cold-load path — Dataview not yet indexed, so dv.current()
// is undefined/null and dv.pages() is empty — in a normal container AND a
// `.markdown-embed` context (all 8 carry the embed guard), asserting no throw.
// That is the render-safe net the project + cowork widgets already have.
//
// Stubs mirror run-cowork-render-guards.js (empty dv.pages chainable, tolerant DOM
// proxy with firstChild→null, chainable window.moment, no-op window.customJS.*,
// minimal app touched only inside onClick handlers). Zero-dep. "N passed, M
// failed" — exit 0 iff M === 0.

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
            if (prop === 'format') return () => '2026-07-02';
            if (prop === 'toDate') return () => new Date(0);
            if (prop === 'toISOString') return () => '2026-07-02T00:00:00.000Z';
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
    BeaconCards: { render: async () => {} },
    SectionLabel: { render: () => {} },
    AccentButton: { render: () => {} },
    TaskParser: { parse: () => ({}), parseLine: () => ({}) },
    ToDoCreateTask: { render: () => {} },
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
    { name: 'ToDoHubActions',              path: 'platform/blueprints/to-do/helpers/todo-hub-actions.js' },
    { name: 'ToDoLeafActions',             path: 'platform/blueprints/to-do/helpers/todo-leaf-actions.js' },
    { name: 'ToDoAllList',                 path: 'platform/blueprints/to-do/helpers/todo-all-list.js' },
    { name: 'ToDoDailyCarryover',          path: 'platform/blueprints/to-do/helpers/todo-daily-carryover.js' },
    { name: 'ToDoDailyRecurring',          path: 'platform/blueprints/to-do/helpers/todo-daily-recurring.js' },
    { name: 'ToDoDailyProjectGroups',      path: 'platform/blueprints/to-do/helpers/todo-daily-project-groups.js' },
    { name: 'ToDoDailyUnassignedMeetings', path: 'platform/blueprints/to-do/helpers/todo-daily-unassigned-meetings.js' },
    { name: 'TodayCaptureEditableList',    path: 'platform/blueprints/to-do/helpers/today-capture-editable-list.js' },
];

// cold-load variants: Dataview not indexed → dv.current() undefined/null; plus the
// embed context (all widgets carry the .markdown-embed early-return guard).
const variants = [
    { label: 'normal container, dv.current()=undefined (cold-load)', embed: false, current: undefined },
    { label: 'normal container, dv.current()=null (cold-load)', embed: false, current: null },
    { label: '.markdown-embed context', embed: true, current: undefined },
];

(async () => {
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { await guard(`TODOGUARD-load ${w.name}`, () => { throw e; }); continue; }
        for (const v of variants) {
            await guard(`TODOGUARD ${w.name} — ${v.label}`, async () => {
                const inst = new WidgetClass();
                await Promise.resolve(inst.render(makeDv(v.embed, v.current), {}));
            });
        }
    }
    // TaskDoneArchive — cold-load: dependencies not registered, dv.pages empty
    await guard('TDARCH-RENDER-1 TaskDoneArchive.render() does not throw on cold-load (normal container)', async () => {
        const TaskDoneArchiveClass = loadWidget('platform/blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
        const w = new TaskDoneArchiveClass();
        const dv = makeDv(false, null);
        global.window = { customJS: { RenderSafe: { page: () => null } }, moment: momentFn };
        await w.render(dv);   // must not throw
    });

    await guard('TDARCH-RENDER-2 TaskDoneArchive.render() returns early inside .markdown-embed', async () => {
        const TaskDoneArchiveClass = loadWidget('platform/blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
        const w = new TaskDoneArchiveClass();
        const dv = makeDv(true, undefined);
        global.window = { customJS: {} };
        await w.render(dv);   // must not throw
    });

    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
