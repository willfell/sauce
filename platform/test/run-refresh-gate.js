'use strict';

// run-refresh-gate.js — a Dataview re-execution must not destroy live UI.
//
// Dataview re-executes a dataviewjs block whenever its index revision moves
// (any note saved, the one being typed in included; the sauce reconciler after
// a background write). DataviewJSRenderer.render() begins with
// `container.innerHTML = ""`, so an ungated widget is torn down and rebuilt
// even when its output is identical: the note flashes and jumps while typing,
// a half-typed input loses text and focus, an open menu closes.
//
// RenderSafe.beginRefresh / settleRefresh (called by customjs-guard) take over
// the renderer's refresh. This harness drives the REAL guard view script and
// the REAL RenderSafe class against a renderer that mirrors
// DataviewJSRenderer (prototype render() that clears, then evaluates the
// block with a fresh `dv` whose `component` is the renderer), over a small DOM
// that serializes outerHTML. Zero-dep. Exit 0 iff all pass.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const results = [];
const ok = (name, cond, detail) => {
    results.push([name, !!cond]);
    console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${!cond && detail ? `\n      ↳ ${detail}` : ''}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------- minimal DOM ----------
const doc = { activeElement: null, createElement: (tag) => new El(tag) };
const VALUE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

class El {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.childNodes = [];
        this.parentNode = null;
        this.className = '';
        this.attrs = {};
        this.style = { cssText: '' };
        this.text = '';
        this.ownerDocument = doc;
        this.listeners = {};
        if (VALUE_TAGS.has(this.tagName)) { this.value = ''; this.selectionStart = 0; this.selectionEnd = 0; }
    }
    get children() { return this.childNodes; }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() {
        if (!this.parentNode) return null;
        const i = this.parentNode.childNodes.indexOf(this);
        return this.parentNode.childNodes[i + 1] || null;
    }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === ROOT_EL; }
    get textContent() { return this.text + this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.text = String(v); }
    // Like the browser: `.value` typed by a user is a property and is NOT part
    // of the serialized markup; only attributes and structure are.
    get outerHTML() {
        const attrs = Object.keys(this.attrs).sort().map((k) => ` ${k}="${this.attrs[k]}"`).join('');
        const cls = this.className ? ` class="${this.className}"` : '';
        const tag = this.tagName.toLowerCase();
        return `<${tag}${cls}${attrs}>${this.text}${this.childNodes.map((c) => c.outerHTML).join('')}</${tag}>`;
    }
    set innerHTML(v) {
        if (v !== '') throw new Error('test DOM only supports clearing innerHTML');
        for (const c of this.childNodes) c.parentNode = null;
        this.childNodes = [];
        if (this.onCleared) this.onCleared();
    }
    get innerHTML() { return this.childNodes.map((c) => c.outerHTML).join(''); }
    _track() { if (this.onChildCount) this.onChildCount(this.childNodes.length); }
    createEl(tag, o) {
        const el = new El(tag); o = o || {};
        if (o.cls) el.className = o.cls;
        if (o.text != null) el.text = String(o.text);
        if (o.type) el.attrs.type = o.type;
        if (o.placeholder) el.attrs.placeholder = o.placeholder;
        return this.appendChild(el);
    }
    appendChild(el) {
        if (el.parentNode) el.parentNode.removeChild(el);
        el.parentNode = this; this.childNodes.push(el); this._track(); return el;
    }
    insertBefore(el, ref) {
        if (el.parentNode) el.parentNode.removeChild(el);
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        el.parentNode = this;
        if (i < 0) this.childNodes.push(el); else this.childNodes.splice(i, 0, el);
        this._track();
        return el;
    }
    removeChild(el) {
        const i = this.childNodes.indexOf(el);
        if (i < 0) throw new Error('removeChild: not a child');
        this.childNodes.splice(i, 1); el.parentNode = null;
        if (doc.activeElement && !doc.activeElement.isConnected) doc.activeElement = null;
        this._track();
        return el;
    }
    replaceChild(next, prev) {
        const i = this.childNodes.indexOf(prev);
        if (i < 0) throw new Error('replaceChild: not a child');
        if (next.parentNode) next.parentNode.removeChild(next);
        this.childNodes.splice(this.childNodes.indexOf(prev), 1, next);
        prev.parentNode = null; next.parentNode = this;
        if (doc.activeElement && !doc.activeElement.isConnected) doc.activeElement = null;
        this._track();
        return prev;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    addEventListener(evt, cb) { (this.listeners[evt] = this.listeners[evt] || []).push(cb); }
    // Capturing listeners on ancestors see the event, as in a browser.
    dispatchInput() {
        for (let n = this; n; n = n.parentNode) for (const cb of (n.listeners.input || [])) cb({ target: this });
    }
    focus() { if (this.isConnected) doc.activeElement = this; }
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; }
    getBoundingClientRect() { return { width: 640, height: 100 }; }
    closest() { return null; }
    _descendants() { const out = []; for (const c of this.childNodes) out.push(c, ...c._descendants()); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
        const all = this._descendants();
        if (sel === 'input, textarea, select') return all.filter((n) => VALUE_TAGS.has(n.tagName));
        const cls = /^\.([\w-]+)$/.exec(sel);
        if (cls) return all.filter((n) => n.className.split(/\s+/).includes(cls[1]));
        return [];
    }
}
const ROOT_EL = new El('body');

// ---------- the real code under test ----------
const RenderSafe = new Function(
    `${fs.readFileSync(path.join(ROOT, 'platform/mechanisms/render-safe/render-safe.js'), 'utf8')}\nreturn RenderSafe;`
)();
const guardSrc = fs.readFileSync(path.join(ROOT, 'platform/mechanisms/customjs-guard/view.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runGuard = new AsyncFunction('dv', 'input', guardSrc);

global.window = global;
global.document = doc;

// Mirrors DataviewJSRenderer: render() is a PROTOTYPE method that clears the
// container and then evaluates the block with a new inline API object whose
// `component` is the renderer and whose `container` is the renderer's.
//
// It also mirrors the trap in DataviewInlineApi.view(): the view file is read
// asynchronously, its body is wrapped as `(async () => { … })()` and that
// promise is NOT returned, so `await dv.view(...)` — and therefore render() —
// resolves once the view has STARTED, long before a widget that awaits
// anything has finished rendering.
class FakeDataviewJSRenderer {
    constructor(container, script) {
        this.container = container;
        this.containerEl = container;
        this.script = script;
        this.clears = 0;
    }
    async render() {
        this.container.innerHTML = '';
        this.clears += 1;
        const dv = { component: this, container: this.container };
        dv.el = (tag, text, o) => dv.container.createEl(tag, Object.assign({ text }, o || {}));
        dv.view = async (_viewPath, input) => {
            await tick();                               // vault.read(viewFile)
            runGuard(dv, input).catch(() => {});        // started, never awaited
        };
        await this.script(dv);
    }
    // What `dataview:refresh-views` does once the revision has moved.
    refresh() { return this.render(); }
}

// Let every started view finish (first renders are not awaited by anything).
const idle = async () => { for (let i = 0; i < 12; i++) await tick(); };

function mountBlock(widgets, opts) {
    const host = ROOT_EL.createEl('div', { cls: 'el-pre' });
    const container = host.createEl('div', { cls: 'block-language-dataviewjs node-insert-event' });
    global.customJS = Object.assign({}, widgets);
    if (!(opts && opts.noRenderSafe)) global.customJS.RenderSafe = new RenderSafe();
    const className = Object.keys(widgets)[0];
    const renderer = new FakeDataviewJSRenderer(container, (dv) => dv.view('ranch/views/customjs-guard', { class: className }));
    return { host, container, renderer };
}

// A task-card-like widget: a head, a list of rows, and a quick-add input.
let rowSequence = 0;
function makeCard(state) {
    return {
        renders: 0,
        dvs: [],
        async render(dv) {
            this.renders += 1;
            this.dvs.push(dv);
            await tick();
            const head = dv.el('div', '', { cls: 'head' });
            head.createEl('span', { cls: 'title', text: state.title });
            const menu = head.createEl('div', { cls: 'menu' });
            menu.createEl('button', { text: 'New' });
            const card = dv.el('div', '', { cls: 'card' });
            for (const row of state.rows) {
                // A process-wide sequence, like TaskTodayList's row order: different on every render.
                card.createEl('div', { cls: 'row', text: row }).setAttribute('data-sauce-task-order', String(++rowSequence));
            }
            const prefilled = card.createEl('input', { type: 'text', placeholder: 'Title' });
            prefilled.value = state.title; // set by the widget, not typed
            card.createEl('input', { type: 'text', placeholder: '+ Add subtask…' });
        },
    };
}

(async () => {
    // ── 1. Unchanged output: nothing on screen is touched ────────────────────
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { host, container, renderer } = mountBlock({ Card: card });
        await renderer.render(); await idle();
        const before = container.childNodes.slice();
        const input = container.querySelectorAll('input, textarea, select')[1];
        const menu = container.querySelector('.menu');
        menu.className = 'menu is-open';                // the user opened the menu
        input.focus(); input.value = 'half-typed'; input.dispatchInput(); input.setSelectionRange(4, 4);

        let minChildren = Infinity;
        container.onChildCount = (n) => { minChildren = Math.min(minChildren, n); };
        let cleared = 0;
        container.onCleared = () => { cleared += 1; };
        await renderer.refresh();

        ok('GATE-1 a refresh still re-runs the widget (so real changes are seen)', card.renders === 2,
            `renders=${card.renders}`);
        ok('GATE-2 unchanged output keeps the very same nodes',
            container.childNodes.length === before.length && container.childNodes.every((n, i) => n === before[i]));
        ok('GATE-3 the real container is never cleared by a refresh', cleared === 0 && minChildren === Infinity,
            `cleared=${cleared} minChildren=${minChildren}`);
        ok('GATE-4 typed text, focus and caret survive', doc.activeElement === input && input.value === 'half-typed'
            && input.selectionStart === 4);
        ok('GATE-5 an open menu stays open', menu.className === 'menu is-open' && menu.isConnected);
        ok('GATE-6 the scratch element is removed afterwards', host.childNodes.length === 1 && host.childNodes[0] === container);
    }

    // ── 2. A real change: swap only what changed, carry what the user typed ──
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { container, renderer } = mountBlock({ Card: card });
        await renderer.render(); await idle();
        const [head, oldCard] = container.childNodes;
        const [prefilled, input] = container.querySelectorAll('input, textarea, select');
        head.querySelector('.menu').className = 'menu is-open';
        input.focus(); input.value = 'next subtask'; input.dispatchInput(); input.setSelectionRange(3, 7);

        let minChildren = Infinity;
        container.onChildCount = (n) => { minChildren = Math.min(minChildren, n); };
        state.rows = ['a', 'b'];                        // the subtask just created is now indexed
        state.title = 'Plan';
        await renderer.refresh();

        const [head2, newCard] = container.childNodes;
        const [prefilled2, input2] = container.querySelectorAll('input, textarea, select');
        ok('GATE-7 the unchanged sibling keeps its node (its open menu survives)',
            head2 === head && head.querySelector('.menu').className === 'menu is-open');
        ok('GATE-8 the changed child is replaced with fresh content',
            newCard !== oldCard && newCard.querySelectorAll('.row').length === 2);
        ok('GATE-9 the container never drops below its two children during the swap', minChildren >= 2,
            `minChildren=${minChildren}`);
        ok('GATE-10 the half-typed text is carried onto the new input', input2 !== input && input2.value === 'next subtask');
        ok('GATE-11 focus and caret are carried onto the new input',
            doc.activeElement === input2 && input2.selectionStart === 3 && input2.selectionEnd === 7);
        ok('GATE-12 a value the widget set itself comes from the fresh render, not the old node',
            prefilled2 !== prefilled && prefilled2.value === 'Plan');

        // The carried field is still "edited": a second change carries it again.
        state.rows = ['a', 'b', 'c'];
        await renderer.refresh();
        const input3 = container.querySelectorAll('input, textarea, select')[1];
        ok('GATE-13 the typed text survives a second changed refresh', input3 !== input2 && input3.value === 'next subtask');

        // A widget-set value that changed in the data is NOT overwritten by the old one.
        state.title = 'Renamed';
        await renderer.refresh();
        ok('GATE-14 fresh data wins over an unedited field', container.querySelectorAll('input, textarea, select')[0].value === 'Renamed'
            && container.querySelector('.title').textContent === 'Renamed');
    }

    // ── 3. Closures from the committed run reach the real container ─────────
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { container, renderer } = mountBlock({ Card: card });
        await renderer.render(); await idle();
        state.rows = ['a', 'b'];
        await renderer.refresh();
        ok('GATE-15 the committed run\'s dv.container is the real container', card.dvs[1].container === container);
        const keptState = { title: 'Plan', rows: ['a', 'b'] };
        Object.assign(state, keptState);
        await renderer.refresh();
        ok('GATE-16 a discarded run\'s dv.container is never pointed at the real container',
            card.dvs[2].container !== container);
    }

    // ── 4. Refreshes that arrive mid-run coalesce; none interleave ──────────
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { container, renderer } = mountBlock({ Card: card });
        await renderer.render(); await idle();
        state.rows = ['a', 'b'];
        const a = renderer.refresh();
        const b = renderer.refresh();
        const c = renderer.refresh();
        await Promise.all([a, b, c]);
        ok('GATE-17 three overlapping refreshes run the widget at most twice more', card.renders <= 3, `renders=${card.renders}`);
        ok('GATE-18 overlapping refreshes leave exactly one head and one card',
            container.querySelectorAll('.head').length === 1 && container.querySelectorAll('.card').length === 1);
    }

    // ── 5. A node the last render does not own: replace everything, once ────
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { container, renderer } = mountBlock({ Card: card });
        await renderer.render(); await idle();
        container.createEl('div', { cls: 'late-foreign', text: 'appended later' });
        let minChildren = Infinity;
        container.onChildCount = (n) => { minChildren = Math.min(minChildren, n); };
        await renderer.refresh();
        ok('GATE-19 a foreign node forces a full replace with one copy of the output',
            container.childNodes.length === 2 && container.querySelectorAll('.late-foreign').length === 0);
        await renderer.refresh();
        ok('GATE-20 the block is gated normally again afterwards', container.childNodes.length === 2 && renderer.clears === 1,
            `clears=${renderer.clears}`);
    }

    // ── 6. Failure and opt-out paths render exactly as Dataview would ───────
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { container, renderer } = mountBlock({ Card: card });
        await renderer.render(); await idle();
        const before = container.childNodes.slice();
        card.render = async () => { throw new Error('widget blew up'); };
        await renderer.refresh();
        ok('GATE-21 a refresh whose widget throws leaves the screen as it was',
            container.childNodes.length === before.length && container.childNodes.every((n, i) => n === before[i]));

        global.window.__sauceRefreshGate = false;
        const card2 = makeCard(state);
        const m2 = mountBlock({ Card: card2 });
        await m2.renderer.render(); await idle();
        const first = m2.container.childNodes.slice();
        await m2.renderer.refresh(); await idle();
        ok('GATE-22 the kill switch restores Dataview\'s clear-and-rebuild',
            m2.renderer.clears === 2 && m2.container.childNodes[0] !== first[0]);
        delete global.window.__sauceRefreshGate;

        const card3 = makeCard(state);
        const m3 = mountBlock({ Card: card3 }, { noRenderSafe: true });
        await m3.renderer.render(); await idle();
        await m3.renderer.refresh(); await idle();
        ok('GATE-23 a vault without RenderSafe renders exactly as before',
            m3.renderer.clears === 2 && m3.container.querySelectorAll('.card').length === 1);
    }

    // ── 7. A refresh that lands before the first render settled ─────────────
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { container, renderer } = mountBlock({ Card: card });
        const first = renderer.render();
        await tick();                                   // guard has begun; widget still rendering
        const second = renderer.refresh();
        await Promise.all([first, second]); await idle();
        await renderer.refresh();
        ok('GATE-24 an early refresh falls back to Dataview and the block still converges gated',
            container.querySelectorAll('.card').length === 1 && renderer.clears === 2,
            `cards=${container.querySelectorAll('.card').length} clears=${renderer.clears} renders=${card.renders}`);
        const stable = container.childNodes.slice();
        await renderer.refresh();
        ok('GATE-25 once settled, further refreshes keep the same nodes',
            container.childNodes.length === stable.length && container.childNodes.every((n, i) => n === stable[i]));
    }

    // ── 8. A slow widget with a nested view: commit only when ALL of it rendered ─
    // The Home shape: a head, then a dashboard mounted through a nested
    // dv.view. Dataview's render() promise resolves while both are still
    // rendering; committing then would swap in a half-built page.
    {
        const state = { rows: ['a'] };
        const Dash = {
            async render(dv) {
                await tick(); await tick(); await tick();
                const d = dv.el('div', '', { cls: 'dash' });
                await tick();
                for (const row of state.rows) d.createEl('div', { cls: 'row', text: row });
            },
        };
        const Home = {
            async render(dv) {
                const head = dv.el('div', '', { cls: 'head' });
                await tick(); await tick();
                head.createEl('button', { cls: 'add', text: '+' });
                await dv.view('ranch/views/customjs-guard', { class: 'Dash' });
            },
        };
        const { container, renderer } = mountBlock({ Home, Dash });
        await renderer.render(); await idle();
        const [head, dash] = container.childNodes;
        ok('GATE-26 first render: head and nested dashboard are both on screen',
            container.childNodes.length === 2 && !!head.querySelector('.add') && dash.querySelectorAll('.row').length === 1);
        head.querySelector('.add').className = 'add is-open';

        let partial = 0;
        container.onChildCount = () => {
            const d = container.querySelector('.dash');
            if (container.childNodes.length !== 2 || !d || !container.querySelector('.add')) partial += 1;
        };
        await renderer.refresh();
        ok('GATE-27 an unchanged slow nested page keeps every node',
            container.childNodes[0] === head && container.childNodes[1] === dash && partial === 0);

        state.rows = ['a', 'b'];
        await renderer.refresh();
        ok('GATE-28 a changed nested dashboard is swapped in complete, never half-built',
            container.childNodes[1] !== dash && container.childNodes[1].querySelectorAll('.row').length === 2 && partial === 0,
            `rows=${container.childNodes[1].querySelectorAll('.row').length} partial=${partial}`);
        ok('GATE-29 the head (and its open control) is kept while the dashboard changes',
            container.childNodes[0] === head && head.querySelector('.add').className === 'add is-open');
    }

    // ── 9. A scratch run that never finishes leaves the screen alone ────────
    {
        const state = { title: 'Plan', rows: ['a'] };
        const card = makeCard(state);
        const { container, renderer } = mountBlock({ Card: card });
        await renderer.render(); await idle();
        const before = container.childNodes.slice();
        global.customJS.RenderSafe._scratchRunTimeoutMs = 20;
        const real = card.render;
        card.render = () => new Promise(() => {});      // hangs forever
        await renderer.refresh();
        ok('GATE-30 a hung refresh times out and keeps what is on screen',
            container.childNodes.every((n, i) => n === before[i]) && container.childNodes.length === before.length);
        card.render = real;
        state.rows = ['a', 'b'];
        await renderer.refresh();
        ok('GATE-31 the next refresh works normally', container.querySelectorAll('.row').length === 2);
    }

    const pass = results.filter(([, c]) => c).length;
    console.log(`\n${pass === results.length ? 'PASS' : 'FAIL'} — refresh-gate (${pass}/${results.length})`);
    process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('run-refresh-gate.js threw:', e); process.exit(1); });
