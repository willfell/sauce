'use strict';

// run-sticky-notes-render-guards.js — cold-load render coverage for the
// sticky-notes and journal blueprints' render widgets. Autoloop queue item
// cov-blueprint-sticky-notes-widget-render (retained after the sticky-notes rename).
//
// The three surviving render widgets — StickyHubCards, StickyDayList, and
// StickyChromeBar — are driven through their render() path via the cold-load
// path (Dataview not indexed: dv.current() undefined/null, empty dv.pages) in a
// normal container AND a `.markdown-embed` context, asserting no throw. Each
// carries a cold-load guard (markdown-embed early-return, customJS.RenderSafe.page,
// or an absent-ChromeBar early-return); this is the render-safe net the
// project/cowork/to-do widgets already have. (The 3 legacy action classes —
// StickyDayActions/StickyLeafActions/StickyHubActions — were dropped in the
// chrome-bar adoption, so they are no longer covered here.)
//
// Stubs mirror run-todo-render-guards.js (empty dv.pages chainable, tolerant DOM
// proxy with firstChild→null, chainable window.moment, real RenderSafe, no-op
// customJS.{AccentButton,BeaconCards,SectionLabel,EntityCreate}, minimal app
// touched only inside onClick). Zero-dep. "N passed, M failed" — exit 0 iff M===0.

const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
const harnessTimeout = setTimeout(() => {
    console.error('FAIL PERF-7-HARNESS: asynchronous fixtures did not finish');
    process.exit(1);
}, 10000);
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
    EntityCreate: { render: () => {}, create: async () => {} },
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
    { name: 'StickyHubCards',  path: 'platform/blueprints/sticky-notes/helpers/sticky-hub-cards.js' },
    { name: 'StickyDayList',   path: 'platform/blueprints/sticky-notes/helpers/sticky-day-list.js' },
    { name: 'StickyChromeBar', path: 'platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js' },
    { name: 'JournalHubCards',  path: 'platform/blueprints/journal/helpers/journal-hub-cards.js' },
    { name: 'JournalDayList',   path: 'platform/blueprints/journal/helpers/journal-day-list.js' },
    { name: 'JournalChromeBar', path: 'platform/blueprints/journal/helpers/journal-chrome-bar.js' },
];

const variants = [
    { label: 'normal container, dv.current()=undefined (cold-load)', embed: false, current: undefined },
    { label: 'normal container, dv.current()=null (cold-load)', embed: false, current: null },
    { label: '.markdown-embed context', embed: true, current: undefined },
];

(async () => {
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { await guard(`STICKYGUARD-load ${w.name}`, () => { throw e; }); continue; }
        for (const v of variants) {
            await guard(`STICKYGUARD ${w.name} — ${v.label}`, async () => {
                const inst = new WidgetClass();
                await Promise.resolve(inst.render(makeDv(v.embed, v.current), {}));
            });
        }
    }
    for (const w of widgets.filter((entry) => /DayList$/.test(entry.name))) {
        const WidgetClass = loadWidget(w.path, w.name);
        await guard(`PERF-7-COLD ${w.name} — absent CustomJS and missing frontmatter never reject`, async () => {
            const saved = global.customJS;
            try {
                delete global.customJS;
                await new WidgetClass().render(makeDv(false, undefined), {});
                await new WidgetClass().render(undefined, {});
            } finally {
                global.customJS = saved;
            }
        });
        await guard(`PERF-7-COLD ${w.name} — throwing RenderSafe page never rejects`, async () => {
            const saved = global.customJS;
            try {
                global.customJS = { RenderSafe: { page() { throw new Error('cold index'); } } };
                await new WidgetClass().render(makeDv(false, undefined), {});
            } finally {
                global.customJS = saved;
            }
        });
        await guard(`PERF-7-GENERATION ${w.name} — stale render rejection cannot contaminate newer output`, async () => {
            const saved = global.customJS;
            let rejectOlder;
            let markOlderStarted;
            const olderStarted = new Promise((resolve) => { markOlderStarted = resolve; });
            let calls = 0;
            const paragraphs = [];
            try {
                global.customJS = {
                    RenderSafe: { page: () => null },
                    BeaconCards: { render: async () => {
                        calls++;
                        if (calls === 1) {
                            markOlderStarted();
                            await new Promise((_resolve, reject) => { rejectOlder = reject; });
                        }
                    } },
                };
                const dv = makeDv(false, undefined);
                dv.paragraph = (message) => { paragraphs.push(message); return makeEl(); };
                const instance = new WidgetClass();
                const older = instance.render(dv, { day: '2026-07-02' });
                await olderStarted;
                await instance.render(dv, { day: '2026-07-02' });
                rejectOlder(new Error('older render failed'));
                await older;
                if (paragraphs.length !== 0) throw new Error(`stale render appended ${paragraphs.length} paragraph(s)`);
            } finally {
                global.customJS = saved;
            }
        });
    }
    for (const spec of [
        { name: 'StickyChromeBar', path: 'platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js' },
        { name: 'JournalChromeBar', path: 'platform/blueprints/journal/helpers/journal-chrome-bar.js' },
    ]) {
        const WidgetClass = loadWidget(spec.path, spec.name);
        await guard(`PERF-7-TITLE ${spec.name} — shared seam preserves optimistic title on success`, async () => {
            const savedCjs = global.customJS;
            const savedApp = global.app;
            const visible = [];
            let mutation = null;
            try {
                global.app = { fileManager: { processFrontMatter: async (_file, update) => update({}) } };
                global.customJS = { RenderSafe: { mutate: async (opts) => {
                    mutation = opts;
                    await opts.optimistic();
                    await opts.write();
                    return { ok: true };
                } } };
                const result = await new WidgetClass()._writeTitle(
                    {}, { path: 'entry.md' }, 'Before', 'After', (value) => visible.push(value));
                if (result !== true || visible.join(',') !== 'After') throw new Error('optimistic title did not survive success');
                if (!mutation || mutation.path !== 'entry.md' || mutation.isCurrent({ title: 'After' }) !== true) {
                    throw new Error('title mutation is not bound to the exact path/value');
                }
            } finally {
                global.customJS = savedCjs;
                global.app = savedApp;
            }
        });
        await guard(`PERF-7-TITLE ${spec.name} — rejected persistence restores exact prior title`, async () => {
            const savedCjs = global.customJS;
            const savedApp = global.app;
            const visible = [];
            try {
                global.app = { fileManager: { processFrontMatter: async () => { throw new Error('write rejected'); } } };
                global.customJS = { RenderSafe: { mutate: async (opts) => {
                    await opts.optimistic();
                    try { await opts.write(); }
                    catch (error) { await opts.revert(error); return { ok: false, error }; }
                    return { ok: true };
                } } };
                const result = await new WidgetClass()._writeTitle(
                    {}, { path: 'entry.md' }, 'Before', 'After', (value) => visible.push(value));
                if (result !== false || visible.join(',') !== 'After,Before') throw new Error('exact title rollback was not preserved');
            } finally {
                global.customJS = savedCjs;
                global.app = savedApp;
            }
        });
    }
    await guard('PERF-7-LEDGER Sticky and Journal rows remain OK and force-refresh-free', async () => {
        const guide = fs.readFileSync(path.join(__dirname, '..', '..', 'Docs/agent-guides/code-conventions.md'), 'utf8');
        const rows = guide.split('\n').filter((line) => /^\| (Sticky notes|Journal) \|/.test(line));
        if (rows.length !== 4 || rows.some((line) => !line.includes('**OK**'))) throw new Error('ledger rows are not all OK');
        const sources = widgets.map((entry) => fs.readFileSync(path.join(__dirname, '..', '..', entry.path), 'utf8')).join('\n');
        if (/dataview:force-refresh-views/.test(sources)) throw new Error('global Dataview refresh remains in audited helpers');
    });
    console.log(`\n${passes} passed, ${fails} failed`);
    clearTimeout(harnessTimeout);
    process.exit(fails === 0 ? 0 : 1);
})();
