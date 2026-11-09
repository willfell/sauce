'use strict';

// run-task-note-rerender.js — a task note must show ONE card after Dataview
// re-executes its blocks while an earlier execution is still in flight.
//
// Dataview's DataviewJSRenderer.render() clears the block container
// (`container.innerHTML = ""`) and then awaits `dv.view(...)`, which reads the
// view file asynchronously before running it. A second render() (index
// revision changed → `dataview:refresh-views`, or the container being inserted
// into the DOM) can start inside that gap. Both executions then run the
// customjs-guard view against the SAME container, and each one appends its
// output. A widget that appends without replacing its own earlier output shows
// twice until the next refresh.
//
// This harness reproduces that interleave with the real guard view script and
// the real TaskNoteView / TaskChromeBar + ChromeBar classes over a small fake
// DOM, for a top-level task and a subtask. Zero-dep. Exit 0 iff all pass.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

function loadClass(rel, name) {
    return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)();
}

// ---------- minimal DOM ----------
class El {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.className = '';
        this.style = { cssText: '' };
        this.textContent = '';
        this.attrs = {};
        this.dataset = {};
        this.classList = {
            add: (...c) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); this.className = [...s].join(' '); },
            remove: (...c) => { this.className = this.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
            contains: (x) => this.className.split(/\s+/).includes(x),
            toggle: () => {},
        };
    }
    set innerHTML(v) { if (v === '') { for (const c of this.children) c.parentNode = null; this.children = []; } }
    get innerHTML() { return ''; }
    get firstChild() { return this.children[0] || null; }
    createEl(tag, o) {
        const el = new El(tag); o = o || {};
        if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
        if (o.text != null) el.textContent = String(o.text);
        if (o.type) el.type = o.type;
        return this.appendChild(el);
    }
    createDiv(o) { return this.createEl('div', o); }
    createSpan(o) { return this.createEl('span', o); }
    appendChild(el) { if (el.parentNode) el.remove(); el.parentNode = this; this.children.push(el); return el; }
    insertBefore(el, ref) {
        if (el.parentNode) el.remove();
        const i = ref ? this.children.indexOf(ref) : -1;
        el.parentNode = this;
        if (i < 0) this.children.push(el); else this.children.splice(i, 0, el);
        return el;
    }
    removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); el.parentNode = null; return el; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    empty() { this.innerHTML = ''; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener() {}
    closest() { return null; }
    _matches(cls) { return this.classList.contains(cls); }
    _descendants() { const out = []; for (const c of this.children) { out.push(c, ...c._descendants()); } return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
        const scoped = /^:scope\s*>\s*\.([\w-]+)$/.exec(sel);
        if (scoped) return this.children.filter((c) => c._matches(scoped[1]));
        const cls = /^\.([\w-]+)$/.exec(sel);
        if (cls) return this._descendants().filter((c) => c._matches(cls[1]));
        return [];
    }
}

const countClass = (root, cls) => root.querySelectorAll('.' + cls).length;

// ---------- globals the widgets read ----------
const TaskNoteView = loadClass('platform/mechanisms/task-entity/task-note-view.js', 'TaskNoteView');
const TaskChromeBar = loadClass('platform/mechanisms/task-entity/task-chrome-bar.js', 'TaskChromeBar');
const ChromeBar = loadClass('platform/mechanisms/chrome-bar/chrome-bar.js', 'ChromeBar');
const guardSrc = fs.readFileSync(path.join(ROOT, 'platform/mechanisms/customjs-guard/view.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runGuard = new AsyncFunction('dv', 'input', guardSrc);

const tick = () => new Promise((r) => setTimeout(r, 0));

function makePage(fm) {
    return Object.assign({ file: { path: fm.path, name: fm.path.split('/').pop().replace(/\.md$/, '') } }, fm);
}

function install(page) {
    const parent = makePage({ path: 'spice/tasks/Parent Task.md', type: 'task', title: 'Parent Task', status: 'open' });
    const allPages = [parent, page];
    const pagesArr = (filter) => {
        const arr = allPages.filter(filter || (() => true));
        arr.where = (fn) => pagesArr((p) => (!filter || filter(p)) && fn(p));
        arr.array = () => arr.slice();
        return arr;
    };
    global.window = global;
    global.moment = () => ({ format: () => '2026-11-09' });
    global.app = {
        workspace: { getActiveFile: () => ({ path: page.file.path }), openLinkText() {} },
        metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
        vault: { getAbstractFileByPath: () => null, adapter: { read: async () => '{}' } },
        commands: { executeCommandById() {} },
    };
    global.Notice = function () {};
    const linkText = (v) => String(v || '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('/').pop().replace(/\.md$/, '');
    global.customJS = {
        RenderSafe: { page: (dv) => dv.current() },
        TaskEntity: {
            _linkText: linkText,
            parseNote: (p) => ({ title: p.title, status: p.status || 'open', due: p.due || '', priority: p.priority || '',
                project: p.project || '', source_note: p.source_note || '', parent_task: p.parent_task || '',
                created_at: p.created_at || '', links: [], path: p.file.path }),
        },
        TaskTodayList: { renderTaskRow: (parentEl, t) => parentEl.createEl('div', { cls: 'sauce-task-today-row', text: t.title }) },
        Breadcrumb: {
            buildSegments: async () => { await tick(); return page.parent_task
                ? [{ label: 'Tasks', link: 'spice/tasks' }, { label: 'Parent Task', link: 'spice/tasks/Parent Task.md' }, { label: page.title }]
                : [{ label: 'Tasks', link: 'spice/tasks' }, { label: page.title }]; },
        },
        TaskNoteView: new TaskNoteView(),
        TaskChromeBar: new TaskChromeBar(),
        ChromeBar: new ChromeBar(),
    };
    return { pages: pagesArr };
}

// Mirrors DataviewJSRenderer.render(): clear synchronously, then await the
// view-file read before the view body runs.
async function dataviewExecute(container, page, env, className, readDelay) {
    container.innerHTML = '';
    for (let i = 0; i < readDelay; i++) await tick();
    const dv = {
        container,
        current: () => page,
        pages: () => env.pages(),
        paragraph: (t) => container.createEl('p', { text: t }),
    };
    await runGuard(dv, { class: className });
}

async function scenario(label, page) {
    const env = install(page);

    const cardBox = new El('div');
    await Promise.all([
        dataviewExecute(cardBox, page, env, 'TaskNoteView', 2),
        (async () => { await tick(); await dataviewExecute(cardBox, page, env, 'TaskNoteView', 2); })(),
    ]);
    ok(`${label}: overlapping Dataview executions leave one task card`, countClass(cardBox, 'sauce-task-note-view') === 1);

    const seqBox = new El('div');
    await dataviewExecute(seqBox, page, env, 'TaskNoteView', 1);
    await dataviewExecute(seqBox, page, env, 'TaskNoteView', 1);
    ok(`${label}: back-to-back executions leave one task card`, countClass(seqBox, 'sauce-task-note-view') === 1);

    const sameBox = new El('div');
    const dvDirect = { container: sameBox, current: () => page, pages: () => env.pages() };
    await customJS.TaskNoteView.render(dvDirect);
    await customJS.TaskNoteView.render(dvDirect);
    ok(`${label}: a re-render into an uncleared container replaces the card`, countClass(sameBox, 'sauce-task-note-view') === 1);

    const barBox = new El('div');
    await Promise.all([
        dataviewExecute(barBox, page, env, 'TaskChromeBar', 2),
        (async () => { await tick(); await dataviewExecute(barBox, page, env, 'TaskChromeBar', 2); })(),
    ]);
    ok(`${label}: overlapping Dataview executions leave one chrome bar`, countClass(barBox, 'task-chrome-root') === 1);
}

(async () => {
    await scenario('task', makePage({ path: 'spice/tasks/Parent Task.md', type: 'task', title: 'Parent Task', status: 'open' }));
    await scenario('subtask', makePage({ path: 'spice/tasks/Child.md', type: 'task', title: 'Child', status: 'open', parent_task: '[[Parent Task]]' }));
    console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
    process.exit(results.every(([, c]) => c) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
