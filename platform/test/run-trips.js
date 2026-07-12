'use strict';

// run-trips.js — behavioral + cold-load render coverage for the trips blueprint.
// Autoloop queue item cov-blueprint-trips-customjs-behavioral (0/4): the trips
// blueprint had NO test harness. The 4 uncovered methods are TripNavButtons's
// pure-ish `detectContext(filePath, dv)` path classifier + the render() of its 3
// widgets (TripsHubCards, TripNavButtons, TripSectionsCards).
//
//  * detectContext — unit-tested across the real path branches (non-trip,
//    trips-hub, trip-atlas vs trip-section by frontmatter type, trip-board vs
//    trip-card, folder-style promoted card). This is the genuine behavioral
//    coverage the customjs_behavioral axis wants.
//  * render() — cold-load render guards (dv.current()/dv.pages empty, Dataview not
//    indexed) in normal + .markdown-embed contexts, asserting no throw — the
//    render-safe net the project/cowork/to-do/scratch widgets have.
//
// Zero-dep. "N passed, M failed" — exit 0 iff M === 0.

const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
function ok(label, cond, detail) {
    if (cond) { passes++; console.log('ok ' + label); }
    else { fails++; console.error('FAIL ' + label + (detail ? ' — ' + detail : '')); }
}
async function okNoThrow(label, fn) {
    try { await fn(); passes++; console.log('ok ' + label); }
    catch (e) { fails++; console.error('FAIL ' + label + ': ' + (e && e.message ? e.message : e)); }
}

function loadWidget(relPath, className) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
    return new Function(`${src}; return ${className};`)();
}

// ---------- shared stubs (mirrors the render-guard harnesses) ----------
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
            if (typeof prop === 'symbol') return undefined;
            if (Object.prototype.hasOwnProperty.call(store, prop)) return store[prop];
            return () => makeEl(closestImpl);
        },
    });
}
function emptyData() {
    const a = [];
    a.where = () => emptyData(); a.sort = () => emptyData(); a.filter = () => emptyData();
    a.map = () => emptyData(); a.groupBy = () => emptyData(); a.limit = () => emptyData();
    a.array = () => []; a.find = () => undefined; a.first = () => undefined;
    return a;
}
function makeMoment() {
    const NUM = new Set(['valueOf', 'unix', 'diff', 'day', 'date', 'month', 'year', 'week', 'hour', 'minute']);
    const m = new Proxy(function () {}, { get(_t, p) {
        if (p === 'format') return () => '2026-07-02';
        if (p === 'toDate') return () => new Date(0);
        if (NUM.has(p)) return () => 0;
        if (typeof p === 'symbol') return undefined;
        return () => m;
    } });
    return m;
}
const momentFn = () => makeMoment();

const RenderSafeClass = loadWidget('platform/mechanisms/render-safe/render-safe.js', 'RenderSafe');
const cjs = {
    BeaconCards: { render: async () => {} },
    SectionLabel: { render: () => {} },
    AccentButton: { render: () => {} },
    RenderSafe: new RenderSafeClass(),
    TripSectionKinds: new (loadWidget('platform/blueprints/trips/helpers/trip-section-kinds.js', 'TripSectionKinds'))(),
};
global.customJS = Object.assign(global.customJS || {}, cjs);
global.app = {
    workspace: { openLinkText() {}, getActiveFile() { return null; } },
    vault: { getAbstractFileByPath() { return null; }, async createFolder() {}, async create() {}, async read() { return ''; } },
    metadataCache: { getFileCache() { return null; }, getFirstLinkpathDest() { return null; } },
    plugins: { plugins: {} },
};
global.window = Object.assign(global.window || {}, { customJS: global.customJS, moment: momentFn, app: global.app });
global.moment = momentFn;

function makeDv(embed, currentVal) {
    const closestImpl = (sel) => (sel === '.markdown-embed' ? (embed ? makeEl() : null) : null);
    return {
        container: makeEl(closestImpl),
        el: () => makeEl(closestImpl),
        paragraph: () => makeEl(closestImpl),
        header: () => makeEl(closestImpl),
        span: () => makeEl(closestImpl),
        view: async () => {},
        pages: () => emptyData(),
        page: () => undefined,
        current: () => currentVal,
    };
}

(async () => {
    // TripNavButtons is now HEADLESS — it holds only trip/section creation logic
    // (TripsChromeBar owns rendering + context detection + the launcher). The
    // former detectContext / launcher-partition tests moved to
    // run-trips-chrome-bar.js.
    const TripNavButtons = loadWidget('platform/blueprints/trips/helpers/trip-nav-buttons.js', 'TripNavButtons');

    // ---------- _sectionBody (behavioral): new custom sections carry ONLY a
    //            single TripsChromeBar block, no legacy chrome. ----------
    {
        const body = new TripNavButtons()._sectionBody("Weather", "Destin", "destin", "2026-07-12T10:00:00-06:00");
        ok('SECBODY-1 new section body embeds TripsChromeBar + section_kind custom, no legacy chrome',
            body.includes('class: "TripsChromeBar"')
            && body.includes('section_kind: custom')
            && !body.includes('class: "Breadcrumb"')
            && !body.includes('class: "SpaceNavButtons"')
            && !body.includes('class: "TripNavButtons"'),
            body);
    }

    // ---------- TripSectionKinds registry (behavioral) ----------
    const TripSectionKinds = loadWidget('platform/blueprints/trips/helpers/trip-section-kinds.js', 'TripSectionKinds');
    const tsk = new TripSectionKinds();
    ok('TSK-1 all() has the 6 default kinds in order',
        tsk.all().map(k => k.kind).join(',') === 'flights,stay,packing-list,to-do,notes,links');
    ok('TSK-2 order() ranks defaults, custom last',
        tsk.order('flights') === 0 && tsk.order('notes') === 4 && tsk.order('custom') === 999);
    ok('TSK-3 labelFor maps kind → display',
        tsk.labelFor('packing-list') === 'Packing List' && tsk.labelFor('custom') === null);
    ok('TSK-4 kindFromLegacyBasename maps old names',
        tsk.kindFromLegacyBasename('Trip Flights') === 'flights'
        && tsk.kindFromLegacyBasename('Trip Packing List') === 'packing-list'
        && tsk.kindFromLegacyBasename('Honorees') === 'custom');
    ok('TSK-5 iconFor returns non-empty svg for every default kind + fallback',
        tsk.all().every(k => /<svg/.test(tsk.iconFor(k.kind))) && /<svg/.test(tsk.iconFor('custom')));
    ok('TSK-6 links kind registered at index 5 with label + icon',
        tsk.order('links') === 5 && tsk.labelFor('links') === 'Links'
        && /^<svg/.test(tsk.iconFor('links')));

    // ---------- create-flow naming + frontmatter (behavioral) ----------
    {
        const written = {};
        const created = new Set();
        const savedVault = global.app.vault;
        global.app.vault = {
            getAbstractFileByPath: (p) => (p === 'ranch/templates/Template, Trip Flights.md'
                ? { path: p } : (created.has(p) ? { path: p } : null)),
            async createFolder(p) { created.add(p); },
            async create(p, body) { written[p] = body; created.add(p); },
            async read() { return '---\ntype: trip-section\nsection_kind: flights\nsection: "Flights"\ntrip: "[[{{NAME}}]]"\ntrip_slug: {{SLUG}}\ncreated_at: "{{DATE}}"\n---\n'; },
        };
        const navC = new TripNavButtons();
        const secPath = await navC._createTripSection('spice/trips/daves-wedding', 'Honorees', "Dave's Wedding", 'daves-wedding');
        ok('CREATE-1 custom section filename is trip-prefixed',
            secPath === "spice/trips/daves-wedding/Dave's Wedding — Honorees.md", secPath);
        ok('CREATE-2 custom section frontmatter is canonical',
            /type: trip-section/.test(written[secPath]) && /section_kind: custom/.test(written[secPath])
            && /section: "Honorees"/.test(written[secPath]) && /trip: "\[\[Dave's Wedding\]\]"/.test(written[secPath])
            && /trip_slug: daves-wedding/.test(written[secPath]), written[secPath]);
        ok('CREATE-3 sanitizeFilename strips illegal chars, keeps apostrophe',
            navC._sanitizeFilename('Q1: Kick/off "Trip"') === 'Q1 Kick off Trip'
            && navC._sanitizeFilename("Dave's Wedding") === "Dave's Wedding");
        global.app.vault = savedVault;
    }

    // ---------- _createTrip scaffolds the full default section set incl. Links ----------
    {
        const written = {};
        const created = new Set();
        const savedVault = global.app.vault;
        // Every Template, Trip *.md resolves to an existing template file; the body
        // is echoed verbatim so we can assert which section notes got written.
        global.app.vault = {
            getAbstractFileByPath: (p) => (/^ranch\/templates\/Template, Trip .*\.md$/.test(p)
                ? { path: p } : (created.has(p) ? { path: p } : null)),
            async createFolder(p) { created.add(p); },
            async create(p, body) { written[p] = body; created.add(p); },
            async read(f) { return `TPL:${f.path}`; },
        };
        const navC = new TripNavButtons();
        await navC._createTrip({ name: 'Reunion', slug: 'reunion', start_date: '', end_date: '', location: '' });
        const wrote = Object.keys(written);
        ok('CREATE-4 _createTrip scaffolds a Links section note',
            wrote.includes('spice/trips/reunion/Reunion — Links.md'), wrote.join('\n'));
        ok('CREATE-5 _createTrip scaffolds every default section (Flights/Stay/Packing List/To Do/Notes/Links)',
            ['Flights', 'Stay', 'Packing List', 'To Do', 'Notes', 'Links']
                .every(label => wrote.includes(`spice/trips/reunion/Reunion — ${label}.md`)), wrote.join('\n'));
        global.app.vault = savedVault;
    }

    // ---------- TripSectionsCards frontmatter grouping (behavioral) ----------
    {
        const TripSectionsCards = loadWidget('platform/blueprints/trips/helpers/trip-sections-cards.js', 'TripSectionsCards');
        const sc = new TripSectionsCards();
        const rows = sc._buildRows([
            { basename: "T — Notes",   path: "p/T — Notes.md",   fm: { type: "trip-section", section: "Notes",   section_kind: "notes" } },
            { basename: "T — Flights", path: "p/T — Flights.md", fm: { type: "trip-section", section: "Flights", section_kind: "flights" } },
            { basename: "T — Honorees",path: "p/T — Honorees.md",fm: { type: "trip-section", section: "Honorees",section_kind: "custom" } },
        ], null);
        ok('SECTIONS-1 defaults grouped + ordered by kind, custom in Additional',
            rows.filter(r => r.group === 'Default Sections').map(r => r.title).join('|') === 'Flights|Notes'
            && rows.filter(r => r.group === 'Additional Sections').map(r => r.title).join('|') === 'Honorees',
            JSON.stringify(rows.map(r => [r.group, r.title])));
        const rows2 = sc._buildRows([
            { basename: "T — Flights", path: "p/T — Flights.md", fm: { type: "trip-section", section: "Flights", section_kind: "flights" } },
        ], "p/board/t-board.md");
        ok('SECTIONS-2 board appended last in Default with title "Trip Board"',
            rows2.filter(r => r.group === 'Default Sections').map(r => r.title).join('|') === 'Flights|Trip Board',
            JSON.stringify(rows2.map(r => [r.group, r.title])));
    }

    // ---------- render() cold-load guards ----------
    const widgets = [
        { name: 'TripsHubCards',     path: 'platform/blueprints/trips/helpers/trips-hub-cards.js' },
        { name: 'TripSectionsCards', path: 'platform/blueprints/trips/helpers/trip-sections-cards.js' },
    ];
    const variants = [
        { label: 'normal, dv.current()=undefined (cold-load)', embed: false, current: undefined },
        { label: '.markdown-embed context', embed: true, current: undefined },
    ];
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { ok(`TRIPGUARD-load ${w.name}`, false, e && e.message); continue; }
        for (const v of variants) {
            await okNoThrow(`TRIPGUARD ${w.name} — ${v.label}`, async () => {
                const inst = new WidgetClass();
                await Promise.resolve(inst.render(makeDv(v.embed, v.current), {}));
            });
        }
    }

    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
