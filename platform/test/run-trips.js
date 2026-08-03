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
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
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
    ok('TSK-1 all() has the 5 default kinds in order',
        tsk.all().map(k => k.kind).join(',') === 'flights,stay,packing-list,to-do,notes');
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
    ok('TSK-6 links kind is NOT a section kind (links live on the atlas)',
        tsk.all().every(k => k.kind !== 'links') && tsk.labelFor('links') === null
        && tsk.order('links') === 999);

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

    // ---------- _createTrip scaffolds the 5 default sections (Links live on the atlas, not a section) ----------
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
        ok('CREATE-4 _createTrip does NOT scaffold a Links section note (links live on the atlas)',
            !wrote.includes('spice/trips/reunion/Reunion — Links.md'), wrote.join('\n'));
        ok('CREATE-5 _createTrip scaffolds every default section (Flights/Stay/Packing List/To Do/Notes)',
            ['Flights', 'Stay', 'Packing List', 'To Do', 'Notes']
                .every(label => wrote.includes(`spice/trips/reunion/Reunion — ${label}.md`)), wrote.join('\n'));
        global.app.vault = savedVault;
    }

    // ---------- GA-P2 gesture writes: optimistic packing + active poll-refresh ----------
    {
        const TripEntryList = loadWidget('platform/blueprints/trips/helpers/trip-entry-list.js', 'TripEntryList');
        const TripLinks = loadWidget('platform/blueprints/trips/helpers/trip-links.js', 'TripLinks');
        const originalApp = global.app;
        const originalRenderSafe = global.customJS.RenderSafe;
        const originalNotice = global.Notice;
        const notices = [];
        global.Notice = function (message) { notices.push(String(message)); };

        function trackedEl(tag) {
            const classes = new Set();
            const listeners = {};
            const el = {
                tag, children: [], childNodes: [], style: makeStyle(), listeners, classes, dataset: {}, parentNode: null,
                classList: {
                    add(...names) { names.forEach((name) => classes.add(name)); },
                    toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
                    contains(name) { return classes.has(name); },
                },
                createEl(childTag, opts) {
                    const child = trackedEl(childTag);
                    child.textContent = opts && opts.text ? opts.text : '';
                    if (opts && opts.cls) String(opts.cls).split(/\s+/).filter(Boolean).forEach((name) => child.classes.add(name));
                    child.parentNode = this;
                    this.children.push(child);
                    this.childNodes = this.children;
                    return child;
                },
                createDiv(opts) { return this.createEl('div', opts); },
                addEventListener(name, fn) { listeners[name] = fn; },
                appendChild(child) { child.parentNode = this; this.children.push(child); this.childNodes = this.children; return child; },
                insertBefore(child, before) {
                    child.parentNode = this;
                    const index = before ? this.children.indexOf(before) : -1;
                    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
                    this.childNodes = this.children;
                    return child;
                },
                replaceChildren(...nodes) {
                    this.children.forEach((child) => { child.parentNode = null; });
                    this.children = nodes;
                    this.childNodes = this.children;
                    nodes.forEach((child) => { child.parentNode = this; });
                },
                empty() { this.replaceChildren(); },
                querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
                querySelectorAll(selector) {
                    const className = String(selector || '').replace(/^\./, '');
                    const found = [];
                    const visit = (node) => {
                        if (node !== this && node.classes && node.classes.has(className)) found.push(node);
                        (node.children || []).forEach(visit);
                    };
                    visit(this);
                    return found;
                },
                remove() {
                    if (!this.parentNode) return;
                    const index = this.parentNode.children.indexOf(this);
                    if (index >= 0) this.parentNode.children.splice(index, 1);
                    this.parentNode.childNodes = this.parentNode.children;
                    this.parentNode = null;
                },
            };
            return el;
        }

        const pathName = 'spice/trips/demo/Demo — Packing List.md';
        const file = { path: pathName, fm: { packing_items: [{ category: 'Clothes', item: 'Socks', checked: false }] } };
        let page = { file: { path: pathName }, packing_items: file.fm.packing_items };
        let metadataListener = null;
        let cachedFrontmatter = null;
        let refreshes = 0;
        let captures = 0;
        let writeGate = deferred();
        let failWrite = false;
        let indexPage = (target) => Object.assign({ file: { path: pathName } }, target.fm);
        let traceLifecycle = false;
        const lifecycleEvents = [];
        const lifecycleIsOrdered = (events) => JSON.stringify(events) === JSON.stringify(['capture', 'optimistic', 'write']);
        const scheduled = [];
        const scheduleTimer = (fn, delay) => {
            const handle = { fn, delay, cancelled: false };
            scheduled.push(handle);
            return handle;
        };
        const clearTimer = (handle) => { if (handle) handle.cancelled = true; };
        const runNextTimer = async () => {
            let handle = null;
            while (scheduled.length && !handle) {
                const candidate = scheduled.shift();
                if (!candidate.cancelled) handle = candidate;
            }
            if (!handle) return false;
            handle.fn();
            await Promise.resolve();
            return true;
        };
        global.app = {
            workspace: { getActiveFile: () => file },
            vault: { getAbstractFileByPath: (p) => p === pathName ? file : null },
            metadataCache: {
                on(_event, listener) { metadataListener = listener; return { id: 'trip-write' }; },
                offref() {},
                getFileCache() { return cachedFrontmatter ? { frontmatter: cachedFrontmatter } : null; },
            },
            commands: { executeCommandById() { refreshes++; } },
            fileManager: {
                async processFrontMatter(target, mutate) {
                    if (traceLifecycle) lifecycleEvents.push('write');
                    await writeGate.promise;
                    if (failWrite) throw new Error('trip write failed');
                    mutate(target.fm);
                    page = indexPage(target);
                    if (metadataListener) metadataListener(target);
                },
            },
            plugins: { plugins: {} },
            _setTimeout: scheduleTimer,
            _clearTimeout: clearTimer,
        };
        global.window.app = global.app;
        const rs = new RenderSafeClass();
        rs.captureScroll = () => {
            if (traceLifecycle) lifecycleEvents.push('capture');
            captures++;
        };
        let mutationAlwaysCurrent = false;
        let mutationOptimisticBeforeCapture = false;
        const renderSafeFacade = {
            page: (targetDv) => targetDv && typeof targetDv.current === 'function' ? targetDv.current() : null,
            mutate: async (opts) => {
                let next = mutationAlwaysCurrent
                    ? Object.assign({}, opts, { isCurrent: () => true })
                    : opts;
                if (mutationOptimisticBeforeCapture && typeof next.optimistic === 'function') {
                    await next.optimistic();
                    next = Object.assign({}, next, { optimistic: undefined });
                }
                return rs.mutate(next);
            },
            mutateStructure: (opts) => rs.mutateStructure(opts),
        };
        global.customJS.RenderSafe = renderSafeFacade;
        global.window.customJS = global.customJS;
        const dv = { current: () => page, page: () => page };
        const list = new TripEntryList();
        const setCheckedRow = list._setCheckedRow.bind(list);
        list._setCheckedRow = (...args) => {
            if (traceLifecycle) lifecycleEvents.push('optimistic');
            return setCheckedRow(...args);
        };
        const host = trackedEl('div');
        list._row(host, dv, {
            key: 'packing_items', checkbox: true,
            title: (entry) => entry.item, subtitle: () => '',
        }, page.packing_items, page.packing_items[0], 0);
        const row = host.children[0];
        const checkbox = row.children[0];
        checkbox.checked = true; // browser toggles the control before change fires
        lifecycleEvents.length = 0;
        traceLifecycle = true;
        const pendingToggle = checkbox.listeners.change();
        await Promise.resolve();
        ok('GA-P2-PACKING-OPTIMISTIC checkbox + strikethrough apply before the write resolves',
            captures === 1 && checkbox.checked === true
            && row.classList.contains('sauce-trip-entry-checked')
            && row.style.textDecoration === 'line-through');
        ok('GA-P2C-PACKING-LIFECYCLE capture precedes optimistic UI and write invocation',
            lifecycleIsOrdered(lifecycleEvents));
        traceLifecycle = false;
        writeGate.resolve();
        await pendingToggle;
        ok('GA-P2-PACKING-POLL successful active write refreshes after the indexed value is current',
            refreshes === 1 && file.fm.packing_items[0].checked === true);

        // A rejected save must undo the browser's already-toggled checkbox and
        // optimistic row decoration, without forcing a stale refresh.
        page = { file: { path: pathName }, packing_items: [{ category: 'Clothes', item: 'Hat', checked: false }] };
        file.fm.packing_items = page.packing_items;
        writeGate = deferred();
        failWrite = true;
        const failedHost = trackedEl('div');
        list._row(failedHost, dv, {
            key: 'packing_items', checkbox: true,
            title: (entry) => entry.item, subtitle: () => '',
        }, page.packing_items, page.packing_items[0], 0);
        const failedRow = failedHost.children[0];
        const failedCheckbox = failedRow.children[0];
        failedCheckbox.checked = true;
        const failedToggle = failedCheckbox.listeners.change();
        await Promise.resolve();
        writeGate.reject(new Error('trip write failed'));
        await failedToggle;
        ok('GA-P2-PACKING-REVERT failed write restores checkbox + row decoration',
            captures === 2 && failedCheckbox.checked === false
            && !failedRow.classList.contains('sauce-trip-entry-checked')
            && failedRow.style.textDecoration === '' && refreshes === 1);

        // CustomJS can briefly lose RenderSafe during reload. Persistence must
        // fail closed, but the browser-toggled control must still be restored.
        page = { file: { path: pathName }, packing_items: [{ category: 'Clothes', item: 'Coat', checked: false }] };
        file.fm.packing_items = page.packing_items;
        failWrite = false;
        const unavailableHost = trackedEl('div');
        list._row(unavailableHost, dv, {
            key: 'packing_items', checkbox: true,
            title: (entry) => entry.item, subtitle: () => '',
        }, page.packing_items, page.packing_items[0], 0);
        const unavailableRow = unavailableHost.children[0];
        const unavailableCheckbox = unavailableRow.children[0];
        global.customJS.RenderSafe = null;
        unavailableCheckbox.checked = true;
        await unavailableCheckbox.listeners.change();
        ok('GA-P2B-PACKING-RENDERSAFE-UNAVAILABLE restores browser-toggled UI without persistence',
            unavailableCheckbox.checked === false
            && !unavailableRow.classList.contains('sauce-trip-entry-checked')
            && unavailableRow.style.textDecoration === ''
            && file.fm.packing_items[0].checked === false);
        global.customJS.RenderSafe = renderSafeFacade;

        // Mutation control for the lifecycle order: simulate a helper that
        // applies optimistic UI before delegating to RenderSafe. The same event
        // trace must reject that implementation.
        page = { file: { path: pathName }, packing_items: [{ category: 'Clothes', item: 'Gloves', checked: false }] };
        file.fm.packing_items = page.packing_items;
        indexPage = (target) => Object.assign({ file: { path: pathName } }, target.fm);
        writeGate = deferred();
        const orderMutantHost = trackedEl('div');
        list._row(orderMutantHost, dv, {
            key: 'packing_items', checkbox: true,
            title: (entry) => entry.item, subtitle: () => '',
        }, page.packing_items, page.packing_items[0], 0);
        const orderMutantCheckbox = orderMutantHost.children[0].children[0];
        orderMutantCheckbox.checked = true;
        lifecycleEvents.length = 0;
        mutationOptimisticBeforeCapture = true;
        traceLifecycle = true;
        const orderMutantSave = orderMutantCheckbox.listeners.change();
        await new Promise(setImmediate);
        const orderMutantPassed = lifecycleIsOrdered(lifecycleEvents);
        traceLifecycle = false;
        writeGate.resolve();
        await orderMutantSave;
        mutationOptimisticBeforeCapture = false;
        ok('GA-P2C-OPTIMISM-BEFORE-CAPTURE-MUTANT ordered lifecycle assertion turns red', !orderMutantPassed);

        // PERF-4: array inserts/removals are structural. They repaint the exact
        // list block before persistence, never schedule a global refresh, and
        // restore the prior node identities + focus when the write rejects.
        failWrite = false;
        const oldFlights = { [Symbol.iterator]: function* () { yield { flight_no: 'OLD' }; } };
        page = { file: { path: pathName }, flights: oldFlights };
        file.fm.flights = [{ flight_no: 'OLD' }];
        const entryOwner = trackedEl('div');
        entryOwner.dataset.tripEntryOwnerPath = pathName;
        entryOwner.dataset.tripEntryOwnerKey = 'flights';
        entryOwner.classList.add('trip-entry-list-owner');
        const priorA = entryOwner.createEl('div', { text: 'prior-a' });
        const priorB = entryOwner.createEl('div', { text: 'prior-b' });
        const structuralDv = { container: entryOwner, current: () => page };
        const nextFlights = [{ flight_no: 'UA1', depart_date: '2026-08-14' }];
        writeGate = deferred();
        const beforeStructureRefresh = refreshes;
        const pendingStructure = list._write(structuralDv, { key: 'flights', kind: 'flights' }, nextFlights);
        await new Promise(setImmediate);
        ok('PERF-4-ENTRY-OPTIMISTIC iterable DataArray is replaced visibly before persistence settles',
            Array.isArray(page.flights) && page.flights[0].flight_no === 'UA1'
            && entryOwner.children.length > 0
            && !entryOwner.children.includes(priorA)
            && refreshes === beforeStructureRefresh);
        writeGate.resolve();
        const structureSaved = await pendingStructure;
        ok('PERF-4-ENTRY-SUCCESS persists structural list without forced refresh',
            structureSaved && file.fm.flights[0].flight_no === 'UA1'
            && refreshes === beforeStructureRefresh);
        file.stat = { mtime: 10 };

        // PERF-4b: each dv.current() call can return a fresh stale snapshot
        // while the first persistence is unresolved. The exact owner model must
        // remain authoritative and persistence must serialize, so deleting A
        // and then the newly visible B commits [] rather than resurrecting B.
        const originalProcessFrontMatter = global.app.fileManager.processFrontMatter;
        const rapidEntryGates = [deferred(), deferred()];
        let indexedFlights = [{ flight_no: 'A' }, { flight_no: 'B' }];
        file.fm.flights = indexedFlights.slice();
        let rapidEntryWrites = 0;
        let rapidEntryActive = 0;
        let rapidEntryMaxActive = 0;
        global.app.fileManager.processFrontMatter = async (target, mutate) => {
            const gate = rapidEntryGates[rapidEntryWrites++];
            rapidEntryActive++;
            rapidEntryMaxActive = Math.max(rapidEntryMaxActive, rapidEntryActive);
            await gate.promise;
            mutate(target.fm);
            indexedFlights = target.fm.flights.slice();
            rapidEntryActive--;
        };
        const rapidEntryOwner = trackedEl('div');
        rapidEntryOwner.dataset.tripEntryOwnerPath = pathName;
        rapidEntryOwner.dataset.tripEntryOwnerKey = 'flights';
        rapidEntryOwner.classList.add('trip-entry-list-owner');
        const rapidEntryDv = {
            container: rapidEntryOwner,
            current: () => ({ file: { path: pathName, mtime: 1 }, flights: indexedFlights.slice() }),
        };
        const rapidEntrySpec = { key: 'flights', kind: 'flights' };
        await list.render(rapidEntryDv, rapidEntrySpec);
        const rapidEntryFirst = list._write(
            rapidEntryDv, rapidEntrySpec,
            TripEntryList.deleteEntry(list._items(rapidEntryDv, rapidEntrySpec), 0).list,
        );
        await new Promise(setImmediate);
        const rapidEntrySecondBase = list._items(rapidEntryDv, rapidEntrySpec);
        const rapidEntrySecond = list._write(
            rapidEntryDv, rapidEntrySpec,
            TripEntryList.deleteEntry(rapidEntrySecondBase, 0).list,
        );
        await new Promise(setImmediate);
        const rapidEntryQueued = rapidEntryWrites === 1
            && rapidEntrySecondBase.length === 1
            && rapidEntrySecondBase[0].flight_no === 'B';
        rapidEntryGates[0].resolve();
        await rapidEntryFirst;
        await new Promise(setImmediate);
        const rapidEntrySecondStarted = rapidEntryWrites === 2
            && list._items(rapidEntryDv, rapidEntrySpec).length === 0;
        rapidEntryGates[1].resolve();
        const rapidEntrySaved = await rapidEntrySecond;
        ok('PERF4B-RAPID-ENTRY stale fresh snapshots retain both gestures in one serialized owner queue',
            rapidEntryQueued && rapidEntrySecondStarted && rapidEntrySaved
            && rapidEntryMaxActive === 1 && file.fm.flights.length === 0);
        const missingMtimeEntryState = list._entryState(rapidEntryOwner, {
            file: { path: pathName },
            flights: [{ flight_no: 'A' }, { flight_no: 'B' }],
        }, 'flights');
        ok('PERF4C-MISSING-MTIME-AUTHORITY entry snapshots without mtime cannot reclaim post-write authority',
            missingMtimeEntryState.model.length === 0 && !!missingMtimeEntryState.authority);
        file.stat.mtime = 11;
        cachedFrontmatter = { flights: [{ flight_no: 'EXTERNAL' }] };
        const newerEntryState = list._entryState(rapidEntryOwner, {
            file: { path: pathName }, flights: [{ flight_no: 'STALE' }],
        }, 'flights');
        ok('PERF4D-ENTRY-CACHE-CONVERGENCE newer current-file cache releases missing-mtime authority',
            newerEntryState.authority === null && newerEntryState.model[0].flight_no === 'EXTERNAL');
        cachedFrontmatter = null;
        global.app.fileManager.processFrontMatter = originalProcessFrontMatter;

        const failedQueueGate = deferred();
        let failedQueueWrites = 0;
        const failedQueueInitial = [{ flight_no: 'A' }, { flight_no: 'B' }];
        file.fm.flights = failedQueueInitial;
        global.app.fileManager.processFrontMatter = async () => {
            failedQueueWrites++;
            await failedQueueGate.promise;
            throw new Error('first queued trip write failed');
        };
        const failedQueueOwner = trackedEl('div');
        failedQueueOwner.dataset.tripEntryOwnerPath = pathName;
        failedQueueOwner.dataset.tripEntryOwnerKey = 'flights';
        failedQueueOwner.classList.add('trip-entry-list-owner');
        const failedQueueDv = {
            container: failedQueueOwner,
            current: () => ({ file: { path: pathName, mtime: 1 }, flights: failedQueueInitial.slice() }),
        };
        await list.render(failedQueueDv, rapidEntrySpec);
        const failedQueueFirst = list._write(
            failedQueueDv, rapidEntrySpec,
            TripEntryList.deleteEntry(list._items(failedQueueDv, rapidEntrySpec), 0).list,
        );
        await new Promise(setImmediate);
        const failedQueueSecond = list._write(
            failedQueueDv, rapidEntrySpec,
            TripEntryList.deleteEntry(list._items(failedQueueDv, rapidEntrySpec), 0).list,
        );
        failedQueueGate.resolve();
        const failedQueueResults = await Promise.all([failedQueueFirst, failedQueueSecond]);
        ok('PERF4B-QUEUE-FAILURE earlier rejection restores authority and cancels stale queued descendants',
            failedQueueResults[0] === false && failedQueueResults[1] === false
            && failedQueueWrites === 1
            && list._items(failedQueueDv, rapidEntrySpec).length === 2
            && file.fm.flights === failedQueueInitial);
        global.app.fileManager.processFrontMatter = originalProcessFrontMatter;

        const rejectedFlights = [{ flight_no: 'OLD2' }];
        page = { file: { path: pathName }, flights: rejectedFlights };
        file.fm.flights = rejectedFlights;
        entryOwner.replaceChildren(priorA, priorB);
        let entryFocusRestored = 0;
        const entryFocus = { focus() { entryFocusRestored++; } };
        failWrite = true;
        writeGate = deferred();
        const rejectedStructure = list._write(
            structuralDv,
            { key: 'flights', kind: 'flights' },
            [{ flight_no: 'FAIL' }],
            { focusTarget: entryFocus },
        );
        await new Promise(setImmediate);
        const entryChangedBeforeReject = page.flights[0].flight_no === 'FAIL'
            && !entryOwner.children.includes(priorA);
        writeGate.resolve();
        const entryRejected = await rejectedStructure;
        ok('PERF-4-ENTRY-ROLLBACK rejection restores exact nodes, model identity, and focus',
            entryChangedBeforeReject && !entryRejected
            && entryOwner.children[0] === priorA && entryOwner.children[1] === priorB
            && page.flights === rejectedFlights && entryFocusRestored === 1
            && refreshes === beforeStructureRefresh);

        const links = new TripLinks();
        const nextLinks = [{ url: 'https://example.com', text: 'Example' }];
        const priorLinks = [];
        page = { type: 'trip', file: { path: pathName }, links: priorLinks };
        file.fm.links = priorLinks;
        const linksOwner = trackedEl('div');
        linksOwner.dataset.tripLinksOwnerPath = pathName;
        linksOwner.classList.add('trip-links-owner');
        const linksDv = { container: linksOwner, current: () => page };
        failWrite = false;
        writeGate = deferred();
        const pendingLinks = links._write(linksDv, nextLinks);
        await new Promise(setImmediate);
        const optimisticGrid = linksOwner.querySelector('.trip-links-grid');
        ok('PERF-4-LINKS-OPTIMISTIC empty atlas panel inserts the new card before persistence',
            Array.isArray(page.links) && page.links[0].text === 'Example'
            && optimisticGrid && optimisticGrid.children.length === 1
            && refreshes === beforeStructureRefresh);
        writeGate.resolve();
        const linksSaved = await pendingLinks;
        ok('PERF-4-LINKS-SUCCESS persists without metadata polling or global refresh',
            linksSaved && file.fm.links[0].text === 'Example'
            && scheduled.length === 0 && refreshes === beforeStructureRefresh);

        const rapidLinkGates = [deferred(), deferred()];
        let indexedLinks = [
            { url: 'https://a.example', text: 'A' },
            { url: 'https://b.example', text: 'B' },
        ];
        file.fm.links = indexedLinks.slice();
        let rapidLinkWrites = 0;
        let rapidLinkActive = 0;
        let rapidLinkMaxActive = 0;
        global.app.fileManager.processFrontMatter = async (target, mutate) => {
            const gate = rapidLinkGates[rapidLinkWrites++];
            rapidLinkActive++;
            rapidLinkMaxActive = Math.max(rapidLinkMaxActive, rapidLinkActive);
            await gate.promise;
            mutate(target.fm);
            indexedLinks = target.fm.links.slice();
            rapidLinkActive--;
        };
        const rapidLinksOwner = trackedEl('div');
        rapidLinksOwner.dataset.tripLinksOwnerPath = pathName;
        rapidLinksOwner.classList.add('trip-links-owner');
        const rapidLinksDv = {
            container: rapidLinksOwner,
            current: () => ({ type: 'trip', file: { path: pathName, mtime: 1 }, links: indexedLinks.slice() }),
        };
        links.render(rapidLinksDv);
        const rapidLinkFirst = links._write(
            rapidLinksDv, TripLinks.deleteLink(links._currentLinks(rapidLinksDv), 0).links,
        );
        await new Promise(setImmediate);
        const rapidLinkSecondBase = links._currentLinks(rapidLinksDv);
        const rapidLinkSecond = links._write(
            rapidLinksDv, TripLinks.deleteLink(rapidLinkSecondBase, 0).links,
        );
        await new Promise(setImmediate);
        const rapidLinksQueued = rapidLinkWrites === 1
            && rapidLinkSecondBase.length === 1
            && rapidLinkSecondBase[0].text === 'B';
        rapidLinkGates[0].resolve();
        await rapidLinkFirst;
        await new Promise(setImmediate);
        const rapidLinkSecondStarted = rapidLinkWrites === 2
            && links._currentLinks(rapidLinksDv).length === 0;
        rapidLinkGates[1].resolve();
        const rapidLinksSaved = await rapidLinkSecond;
        ok('PERF4B-RAPID-LINK stale fresh snapshots retain both gestures in one serialized owner queue',
            rapidLinksQueued && rapidLinkSecondStarted && rapidLinksSaved
            && rapidLinkMaxActive === 1 && file.fm.links.length === 0);
        const missingMtimeLinksState = links._linksState(rapidLinksOwner, {
            type: 'trip', file: { path: pathName },
            links: [{ url: 'https://a.example', text: 'A' }, { url: 'https://b.example', text: 'B' }],
        });
        ok('PERF4C-MISSING-MTIME-AUTHORITY link snapshots without mtime cannot reclaim post-write authority',
            missingMtimeLinksState.model.length === 0 && !!missingMtimeLinksState.authority);
        file.stat.mtime = 12;
        cachedFrontmatter = { links: [{ url: 'https://external.example', text: 'External' }] };
        const newerLinksState = links._linksState(rapidLinksOwner, {
            type: 'trip', file: { path: pathName },
            links: [{ url: 'https://stale.example', text: 'Stale' }],
        });
        ok('PERF4D-LINKS-CACHE-CONVERGENCE newer current-file cache releases missing-mtime authority',
            newerLinksState.authority === null
            && newerLinksState.model[0].url === 'https://external.example');
        cachedFrontmatter = null;
        global.app.fileManager.processFrontMatter = originalProcessFrontMatter;

        // PERF-4c binding fixture: exercise the actual Manage Links controls,
        // whose DOM rows intentionally remain mounted while persistence is in
        // flight. After deleting A, B's captured row must resolve its URL
        // against the owner-authoritative [B] model instead of reusing index 1.
        const modalLinkGates = [deferred(), deferred()];
        indexedLinks = [
            { url: 'https://a.example', text: 'A' },
            { url: 'https://b.example', text: 'B' },
        ];
        file.fm.links = indexedLinks.slice();
        let modalLinkWrites = 0;
        let modalLinkActive = 0;
        let modalLinkMaxActive = 0;
        global.app.fileManager.processFrontMatter = async (target, mutate) => {
            const gate = modalLinkGates[modalLinkWrites++];
            modalLinkActive++;
            modalLinkMaxActive = Math.max(modalLinkMaxActive, modalLinkActive);
            await gate.promise;
            mutate(target.fm);
            indexedLinks = target.fm.links.slice();
            modalLinkActive--;
        };
        const modalLinksOwner = trackedEl('div');
        modalLinksOwner.dataset.tripLinksOwnerPath = pathName;
        modalLinksOwner.classList.add('trip-links-owner');
        const modalLinksDv = {
            container: modalLinksOwner,
            current: () => ({ type: 'trip', file: { path: pathName, mtime: 1 }, links: indexedLinks.slice() }),
        };
        links.render(modalLinksDv);
        const originalOpenModal = links._openModal;
        let managePanel = null;
        let manageCloses = 0;
        const manageBody = trackedEl('body');
        let manageOverlay = null;
        links._openModal = ({ build }) => {
            manageOverlay = manageBody.createEl('div');
            managePanel = trackedEl('div');
            manageOverlay.appendChild(managePanel);
            build(managePanel, () => { manageCloses++; manageOverlay.remove(); });
        };
        links.openManage(modalLinksDv);
        const manageRows = managePanel.children[0].children;
        const deleteA = manageRows[0].children[2];
        const deleteB = manageRows[1].children[2];
        const modalDeleteA = deleteA.onclick();
        await new Promise(setImmediate);
        const modalDeleteB = deleteB.onclick();
        await new Promise(setImmediate);
        const realModalQueued = modalLinkWrites === 1
            && links._currentLinks(modalLinksDv).length === 1
            && links._currentLinks(modalLinksDv)[0].text === 'B';
        modalLinkGates[0].resolve();
        const modalDeleteASaved = await modalDeleteA;
        await new Promise(setImmediate);
        const manageStayedMounted = manageOverlay.parentNode === manageBody && manageCloses === 0;
        const realModalSecondStarted = modalLinkWrites === 2
            && links._currentLinks(modalLinksDv).length === 0;
        modalLinkGates[1].resolve();
        const modalDeleteBSaved = await modalDeleteB;
        ok('PERF4B-MANAGE-LINK-IDENTITY real modal rapid deletes resolve stable URL identity after index shift',
            realModalQueued && realModalSecondStarted
            && modalDeleteASaved && modalDeleteBSaved
            && modalLinkMaxActive === 1 && file.fm.links.length === 0
            && manageStayedMounted && manageCloses === 1
            && manageOverlay.parentNode === null);
        links._openModal = originalOpenModal;
        global.app.fileManager.processFrontMatter = originalProcessFrontMatter;

        const modalEditGates = [deferred(), deferred()];
        indexedLinks = [
            { url: 'https://a.example', text: 'A' },
            { url: 'https://b.example', text: 'B' },
        ];
        file.fm.links = indexedLinks.slice();
        let modalEditWrites = 0;
        global.app.fileManager.processFrontMatter = async (target, mutate) => {
            const gate = modalEditGates[modalEditWrites++];
            await gate.promise;
            mutate(target.fm);
            indexedLinks = target.fm.links.slice();
        };
        const modalEditOwner = trackedEl('div');
        modalEditOwner.dataset.tripLinksOwnerPath = pathName;
        modalEditOwner.classList.add('trip-links-owner');
        const modalEditDv = {
            container: modalEditOwner,
            current: () => ({ type: 'trip', file: { path: pathName, mtime: 1 }, links: indexedLinks.slice() }),
        };
        links.render(modalEditDv);
        let editPanel = null;
        let editSubmit = null;
        let editManageCloses = 0;
        const originalOpenForm = links._openForm;
        links._openModal = ({ build }) => {
            editPanel = trackedEl('div');
            build(editPanel, () => { editManageCloses++; });
        };
        links._openForm = (_fields, onSubmit) => { editSubmit = onSubmit; };
        links.openManage(modalEditDv);
        const editRows = editPanel.children[0].children;
        const deleteBeforeEdit = editRows[0].children[2].onclick();
        await new Promise(setImmediate);
        const openEditAfterShift = editRows[1].children[1].onclick();
        await new Promise(setImmediate);
        const realEditDeferred = modalEditWrites === 1 && editSubmit === null
            && editManageCloses === 0
            && links._currentLinks(modalEditDv)[0].url === 'https://b.example';
        modalEditGates[0].resolve();
        await deleteBeforeEdit;
        const editOpened = await openEditAfterShift;
        const editAfterShift = editSubmit({ url: 'https://b2.example', text: 'B2' });
        await new Promise(setImmediate);
        const realEditStarted = modalEditWrites === 2
            && links._currentLinks(modalEditDv)[0].url === 'https://b2.example';
        modalEditGates[1].resolve();
        const editAfterShiftSaved = await editAfterShift;
        ok('PERF4B-MANAGE-LINK-EDIT-IDENTITY real modal edit resolves stable URL identity after sibling shift',
            realEditDeferred && editOpened && realEditStarted && editAfterShiftSaved
            && editManageCloses === 1
            && file.fm.links.length === 1
            && file.fm.links[0].url === 'https://b2.example'
            && file.fm.links[0].text === 'B2', JSON.stringify({
                realEditDeferred, editOpened, realEditStarted, editAfterShiftSaved,
                editManageCloses, writes: modalEditWrites, links: file.fm.links,
            }));

        const modalCancelGate = deferred();
        indexedLinks = [
            { url: 'https://a.example', text: 'A' },
            { url: 'https://b.example', text: 'B' },
        ];
        file.fm.links = indexedLinks.slice();
        let modalCancelWrites = 0;
        global.app.fileManager.processFrontMatter = async (target, mutate) => {
            modalCancelWrites++;
            await modalCancelGate.promise;
            mutate(target.fm);
            indexedLinks = target.fm.links.slice();
        };
        const modalCancelOwner = trackedEl('div');
        modalCancelOwner.dataset.tripLinksOwnerPath = pathName;
        modalCancelOwner.classList.add('trip-links-owner');
        const modalCancelDv = {
            container: modalCancelOwner,
            current: () => ({ type: 'trip', file: { path: pathName, mtime: 1 }, links: indexedLinks.slice() }),
        };
        links.render(modalCancelDv);
        let modalCancelPanel = null;
        let modalCancelOpen = true;
        let modalCancelCloses = 0;
        let cancelledFormsOpened = 0;
        links._openModal = ({ build }) => {
            modalCancelPanel = trackedEl('div');
            const close = () => {
                if (!modalCancelOpen) return;
                modalCancelOpen = false;
                modalCancelCloses++;
            };
            close.isOpen = () => modalCancelOpen;
            build(modalCancelPanel, close);
        };
        links._openForm = () => { cancelledFormsOpened++; };
        links.openManage(modalCancelDv);
        const cancelRows = modalCancelPanel.children[0].children;
        const pendingDeleteBeforeCancel = cancelRows[0].children[2].onclick();
        await new Promise(setImmediate);
        const deferredEditBeforeCancel = cancelRows[1].children[1].onclick();
        await new Promise(setImmediate);
        modalCancelPanel.children[1].onclick();
        const cancelledWhilePending = !modalCancelOpen && modalCancelCloses === 1
            && cancelledFormsOpened === 0 && modalCancelWrites === 1;
        modalCancelGate.resolve();
        const cancelledDeleteSaved = await pendingDeleteBeforeCancel;
        const cancelledEditOpened = await deferredEditBeforeCancel;
        ok('PERF4C-MODAL-CANCEL-GENERATION closed Manage generation cannot resurrect deferred Edit',
            cancelledWhilePending && cancelledDeleteSaved && cancelledEditOpened === false
            && cancelledFormsOpened === 0 && modalCancelCloses === 1
            && file.fm.links.length === 1 && file.fm.links[0].url === 'https://b.example');

        const originalDocument = global.document;
        const modalBody = trackedEl('body');
        const modalDocumentListeners = {};
        global.document = {
            body: modalBody,
            activeElement: null,
            querySelector: (selector) => modalBody.querySelector(selector),
            addEventListener: (name, listener) => { modalDocumentListeners[name] = listener; },
            removeEventListener: (name, listener) => {
                if (modalDocumentListeners[name] === listener) delete modalDocumentListeners[name];
            },
        };
        let replacedClose = null;
        originalOpenModal.call(links, { title: 'First', build: (_panel, close) => { replacedClose = close; } });
        const replacedOverlay = modalBody.children[0];
        let escapeClose = null;
        originalOpenModal.call(links, { title: 'Second', build: (_panel, close) => { escapeClose = close; } });
        const replacementInvalidated = replacedClose.isOpen() === false
            && replacedOverlay.parentNode === null && escapeClose.isOpen() === true;
        modalDocumentListeners.keydown({ key: 'Escape' });
        const escapeInvalidated = escapeClose.isOpen() === false && modalBody.children.length === 0;
        let backdropClose = null;
        originalOpenModal.call(links, { title: 'Third', build: (_panel, close) => { backdropClose = close; } });
        const backdropOverlay = modalBody.children[0];
        backdropOverlay.onclick({ target: backdropOverlay });
        ok('PERF4D-MODAL-CLOSE-TOKEN replacement Escape and backdrop share one cancellation token',
            replacementInvalidated && escapeInvalidated
            && backdropClose.isOpen() === false && modalBody.children.length === 0);
        global.document = originalDocument;
        links._openModal = originalOpenModal;
        links._openForm = originalOpenForm;
        global.app.fileManager.processFrontMatter = originalProcessFrontMatter;

        // The modal must remain mounted until every rapid delete settles. A
        // later rejection then restores focus to a live retry control instead
        // of a button detached by an earlier successful handler's close().
        const modalFailureGates = [deferred(), deferred()];
        indexedLinks = [
            { url: 'https://a.example', text: 'A' },
            { url: 'https://b.example', text: 'B' },
        ];
        file.fm.links = indexedLinks.slice();
        let modalFailureWrites = 0;
        global.app.fileManager.processFrontMatter = async (target, mutate) => {
            const write = modalFailureWrites++;
            await modalFailureGates[write].promise;
            if (write === 1) throw new Error('second modal delete failed');
            mutate(target.fm);
            indexedLinks = target.fm.links.slice();
        };
        const modalFailureOwner = trackedEl('div');
        modalFailureOwner.dataset.tripLinksOwnerPath = pathName;
        modalFailureOwner.classList.add('trip-links-owner');
        const modalFailureDv = {
            container: modalFailureOwner,
            current: () => ({ type: 'trip', file: { path: pathName, mtime: 1 }, links: indexedLinks.slice() }),
        };
        links.render(modalFailureDv);
        const failureBody = trackedEl('body');
        let failureOverlay = null;
        let failurePanel = null;
        let failureCloses = 0;
        links._openModal = ({ build }) => {
            failureOverlay = failureBody.createEl('div');
            failurePanel = failureOverlay.createEl('div');
            build(failurePanel, () => { failureCloses++; failureOverlay.remove(); });
        };
        links.openManage(modalFailureDv);
        const failureRows = failurePanel.children[0].children;
        let rejectedFocusAttached = false;
        failureRows[1].children[2].focus = () => {
            rejectedFocusAttached = failureRows[1].children[2].parentNode?.parentNode?.parentNode === failurePanel
                && failureOverlay.parentNode === failureBody;
        };
        const firstModalDelete = failureRows[0].children[2].onclick();
        await new Promise(setImmediate);
        const rejectedModalDelete = failureRows[1].children[2].onclick();
        await new Promise(setImmediate);
        modalFailureGates[0].resolve();
        const firstModalSaved = await firstModalDelete;
        await new Promise(setImmediate);
        const overlayHeldForDescendant = failureOverlay.parentNode === failureBody && failureCloses === 0;
        modalFailureGates[1].resolve();
        const rejectedModalSaved = await rejectedModalDelete;
        ok('PERF4C-MODAL-ROLLBACK-OWNERSHIP queued rejection retains live overlay and retry focus',
            firstModalSaved && !rejectedModalSaved && modalFailureWrites === 2
            && overlayHeldForDescendant && failureOverlay.parentNode === failureBody
            && failureCloses === 0 && rejectedFocusAttached
            && file.fm.links.length === 1 && file.fm.links[0].url === 'https://b.example');

        const firstFailureGate = deferred();
        indexedLinks = [
            { url: 'https://a.example', text: 'A' },
            { url: 'https://b.example', text: 'B' },
        ];
        const firstFailureInitial = indexedLinks.slice();
        file.fm.links = firstFailureInitial;
        let firstFailureWrites = 0;
        global.app.fileManager.processFrontMatter = async () => {
            firstFailureWrites++;
            await firstFailureGate.promise;
            throw new Error('first modal delete failed');
        };
        const firstFailureOwner = trackedEl('div');
        firstFailureOwner.dataset.tripLinksOwnerPath = pathName;
        firstFailureOwner.classList.add('trip-links-owner');
        const firstFailureDv = {
            container: firstFailureOwner,
            current: () => ({ type: 'trip', file: { path: pathName, mtime: 1 }, links: indexedLinks.slice() }),
        };
        links.render(firstFailureDv);
        const firstFailureBody = trackedEl('body');
        let firstFailureOverlay = null;
        let firstFailurePanel = null;
        let firstFailureCloses = 0;
        links._openModal = ({ build }) => {
            firstFailureOverlay = firstFailureBody.createEl('div');
            firstFailurePanel = firstFailureOverlay.createEl('div');
            build(firstFailurePanel, () => { firstFailureCloses++; firstFailureOverlay.remove(); });
        };
        links.openManage(firstFailureDv);
        const firstFailureRows = firstFailurePanel.children[0].children;
        let firstFailureFocusAttached = false;
        let cancelledFocusAttached = false;
        firstFailureRows[0].children[2].focus = () => {
            firstFailureFocusAttached = firstFailureOverlay.parentNode === firstFailureBody;
        };
        firstFailureRows[1].children[2].focus = () => {
            cancelledFocusAttached = firstFailureOverlay.parentNode === firstFailureBody;
        };
        const rejectedFirstDelete = firstFailureRows[0].children[2].onclick();
        await new Promise(setImmediate);
        const cancelledSecondDelete = firstFailureRows[1].children[2].onclick();
        await new Promise(setImmediate);
        firstFailureGate.resolve();
        const firstFailureResults = await Promise.all([rejectedFirstDelete, cancelledSecondDelete]);
        ok('PERF4C-MANAGE-LINK-FAIL-CLOSED first rejection keeps overlay live and cancels queued descendant',
            firstFailureResults[0] === false && firstFailureResults[1] === false
            && firstFailureWrites === 1 && firstFailureCloses === 0
            && firstFailureOverlay.parentNode === firstFailureBody
            && firstFailureFocusAttached && cancelledFocusAttached
            && file.fm.links === firstFailureInitial
            && links._currentLinks(firstFailureDv).length === 2);
        links._openModal = originalOpenModal;
        global.app.fileManager.processFrontMatter = originalProcessFrontMatter;

        page = { type: 'trip', file: { path: pathName }, links: priorLinks };
        file.fm.links = priorLinks;
        linksOwner.replaceChildren();
        let linksFocusRestored = 0;
        const linksFocus = { focus() { linksFocusRestored++; } };
        failWrite = true;
        writeGate = deferred();
        const rejectedLinks = links._write(linksDv, nextLinks, { focusTarget: linksFocus });
        await new Promise(setImmediate);
        const linkChangedBeforeReject = !!linksOwner.querySelector('.trip-links-grid');
        writeGate.resolve();
        const linksRejected = await rejectedLinks;
        ok('PERF-4-LINKS-ROLLBACK rejection removes exact optimistic grid and restores model + focus',
            linkChangedBeforeReject && !linksRejected
            && linksOwner.children.length === 0 && page.links === priorLinks
            && linksFocusRestored === 1 && refreshes === beforeStructureRefresh);

        // Mutation control: drop the opaque receipt before rollback. The same
        // rejection fixture must then leave the optimistic grid behind.
        page = { type: 'trip', file: { path: pathName }, links: priorLinks };
        file.fm.links = priorLinks;
        linksOwner.replaceChildren();
        failWrite = true;
        writeGate = deferred();
        const normalMutateStructure = renderSafeFacade.mutateStructure;
        renderSafeFacade.mutateStructure = (opts) => normalMutateStructure(Object.assign({}, opts, {
            rollback: (_receipt, error) => opts.rollback(undefined, error),
        }));
        const mutantLinks = links._write(linksDv, nextLinks);
        await new Promise(setImmediate);
        writeGate.resolve();
        await mutantLinks;
        const mutantRestored = linksOwner.children.length === 0 && page.links === priorLinks;
        renderSafeFacade.mutateStructure = normalMutateStructure;
        ok('PERF-4-RECEIPT-MUTANT rollback assertion turns red when the receipt is dropped', !mutantRestored);

        page = { type: 'trip', file: { path: pathName }, links: priorLinks };
        file.fm.links = priorLinks;
        failWrite = false;
        writeGate = deferred(); writeGate.resolve();
        const orphanOwner = trackedEl('div');
        const orphanSaved = await links._write({ container: orphanOwner, current: () => page }, nextLinks);
        ok('PERF-4-OWNER-GUARD missing exact rendered owner fails before persistence',
            !orphanSaved && page.links === priorLinks && file.fm.links === priorLinks
            && orphanOwner.children.length === 0);

        const helperSources = [
            'platform/blueprints/trips/helpers/trip-entry-list.js',
            'platform/blueprints/trips/helpers/trip-links.js',
        ].map((rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')).join('\n');
        ok('PERF-4-SOURCE structural Trips writers use mutateStructure and contain no global refresh command',
            (helperSources.match(/mutateStructure\(/g) || []).length >= 2
            && !helperSources.includes('dataview-force-refresh-views'));

        const auditLedger = fs.readFileSync(
            path.join(__dirname, '..', '..', 'Docs', 'agent-guides', 'code-conventions.md'), 'utf8');
        const tripsLedgerRows = auditLedger.split('\n').filter((line) => line.startsWith('| Trips |'));
        const mutableLedgerRows = tripsLedgerRows.filter((line) =>
            line.includes('`TripEntryList`') || line.includes('`TripLinks`'));
        ok('PERF4-LEDGER-TOUCH-ZONE mutable Trips rows bind structural receipts and contain no PERF-4 gap',
            mutableLedgerRows.length === 2
            && mutableLedgerRows.every((line) => line.includes('mutateStructure')
                && line.includes('serialized') && !line.includes('GAP PERF-4')));

        ok('GA-P2-GESTURE-WRITES use RenderSafe failure notice rather than a bare write catch',
            notices.some((message) => message.includes('trip write failed')));
        global.app = originalApp;
        global.window.app = originalApp;
        global.customJS.RenderSafe = originalRenderSafe;
        global.window.customJS = global.customJS;
        global.Notice = originalNotice;
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

    // ---------- Trip Board Card template: chrome + breadcrumb frontmatter ----------
    {
        const cardTpl = fs.readFileSync(
            path.join(__dirname, '..', 'blueprints', 'trips', 'templates', 'Trip Board Card.md'), 'utf8');
        ok('TBC-1 card template mounts TripsChromeBar block',
            cardTpl.includes('class: "TripsChromeBar"'), cardTpl);
        ok('TBC-2 card template frontmatter declares type: trip-board-card',
            /type:\s*trip-board-card/.test(cardTpl), cardTpl);
        ok('TBC-3 card template writes trip + trip_slug frontmatter keys (for breadcrumb ancestors)',
            /^trip:/m.test(cardTpl) && /^trip_slug:/m.test(cardTpl), cardTpl);
    }

    // ---------- manifest registers trip-board-card breadcrumb type ----------
    {
        const man = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'blueprints', 'trips', 'manifest.json'), 'utf8'));
        const t = man.breadcrumb && man.breadcrumb.types && man.breadcrumb.types['trip-board-card'];
        ok('TBC-4 manifest breadcrumb.types["trip-board-card"] exists with 2 ancestors',
            !!t && Array.isArray(t.ancestors) && t.ancestors.length === 2, JSON.stringify(t));
        ok('TBC-5 trip-board-card ancestors resolve via fm:trip / fm:trip_slug',
            !!t && t.ancestors[1] && t.ancestors[1].label === 'fm:trip'
            && /\{fm:trip_slug\}/.test(t.ancestors[1].link) && /\{fm:trip\}/.test(t.ancestors[1].link),
            JSON.stringify(t));
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
