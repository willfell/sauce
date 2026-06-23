#!/usr/bin/env node
// run-v0127-today-capture-editable-list.js — behavioral harness for v0.127.0 §F.
//
// Loads platform/blueprints/to-do/helpers/today-capture-editable-list.js into
// a vm sandbox + asserts the render flow:
//   HC-V0127-TCEL-A: one row per task entry returned by findTaskLines.
//   HC-V0127-TCEL-B: project/priority/due chips appear when parsed has them.
//   HC-V0127-TCEL-C: clicking the pencil invokes ToDoCreateTask.open in
//                    editExisting mode with the correct payload.
//   HC-V0127-TCEL-D: empty entries → "No tasks yet" muted note.
//   HC-V0127-TCEL-E: missing TaskInteractions mechanism → graceful "not
//                    loaded" note; no throw.
//   HC-V0127-TCEL-F: render is a no-op when called inside .markdown-embed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'today-capture-editable-list.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function makeEl() {
    const el = {
        tagName: '',
        _text: '',
        style: { cssText: '', background: '', color: '', opacity: '' },
        _children: [],
        type: '',
        value: '',
        checked: false,
        disabled: false,
        innerHTML: '',
        _listeners: {},
        _closestSelector: null,
        createEl(tag, opts) {
            const c = makeEl();
            c.tagName = tag;
            if (opts && opts.text != null) c._text = String(opts.text);
            this._children.push(c);
            c._parent = this;
            return c;
        },
        createDiv() { return this.createEl('div'); },
        addEventListener(name, fn) {
            (this._listeners[name] = this._listeners[name] || []).push(fn);
        },
        dispatchEvent(name, evt) {
            const arr = this._listeners[name] || [];
            for (const fn of arr) fn(evt || {});
        },
        appendChild(child) {
            child._parent = this;
            this._children.push(child);
            return child;
        },
        closest(selector) {
            if (this._closestSelector === selector) return this;
            return null;
        },
        // Mock removeChild for the "while (firstChild) removeChild" clear loop.
        removeChild(child) {
            this._children = this._children.filter((c) => c !== child);
        },
    };
    Object.defineProperty(el, 'textContent', {
        get() { return this._text; },
        set(v) { this._text = String(v); },
        configurable: true,
    });
    Object.defineProperty(el, 'firstChild', {
        get() { return this._children[0] || null; },
        configurable: true,
    });
    return el;
}

/**
 * Walk all descendants (depth-first) matching predicate.
 */
function findAll(root, predicate, acc) {
    acc = acc || [];
    if (predicate(root)) acc.push(root);
    for (const c of root._children || []) findAll(c, predicate, acc);
    return acc;
}

/**
 * Build a fresh sandbox + load TodayCaptureEditableList against it.
 */
function loadIntoSandbox(overrides) {
    overrides = overrides || {};
    const sandbox = {};
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    sandbox.Notice = function () {};
    sandbox.console = console;
    sandbox.app = overrides.app || {
        vault: {
            getAbstractFileByPath: () => ({ path: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' }),
            read: async () => 'mock content',
        },
    };
    sandbox.customJS = overrides.customJS || {
        TaskInteractions: {
            findTaskLines: () => [],
        },
        ToDoCreateTask: {
            open: () => {},
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(src + '\nthis.TodayCaptureEditableList = TodayCaptureEditableList;', sandbox);
    return sandbox;
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
    if (cond) { pass++; console.log('  ok ' + msg); }
    else { fail++; console.log('  FAIL ' + msg); }
}

(async () => {
    console.log('run-v0127-today-capture-editable-list:');

    // -----------------------------------------------------------------------
    // HC-V0127-TCEL-A: one row per task entry.
    // -----------------------------------------------------------------------
    {
        const entries = [
            {
                idx: 5, line: '- [ ] Task one',
                parsed: { title: 'Task one', priority: null, due: null, scheduled: null, project: null },
            },
            {
                idx: 6, line: '- [ ] Task two',
                parsed: { title: 'Task two', priority: null, due: null, scheduled: null, project: null },
            },
            {
                idx: 7, line: '- [x] Task three',
                parsed: { title: 'Task three', priority: null, due: null, scheduled: null, project: null },
            },
        ];
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: { findTaskLines: () => entries },
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' } }),
        };
        const inst = new sandbox.TodayCaptureEditableList();
        await inst.render(dv);

        // The row list lives at container > div > children (one row per entry).
        const list = container._children[0];
        ok(!!list, 'HC-V0127-TCEL-A: list container created');
        if (list) {
            ok(list._children.length === 3,
                `HC-V0127-TCEL-A-2: 3 rows for 3 entries (got ${list._children.length})`);
            // Each row contains a title span with the parsed.title text.
            const titles = findAll(list, (el) => el.tagName === 'span' && (el._text === 'Task one' || el._text === 'Task two' || el._text === 'Task three'));
            ok(titles.length === 3,
                `HC-V0127-TCEL-A-3: each row carries its title (got ${titles.length})`);
        }
    }

    // -----------------------------------------------------------------------
    // HC-V0127-TCEL-B: project/priority/due chips appear when parsed has them.
    // -----------------------------------------------------------------------
    {
        const entries = [{
            idx: 5,
            line: '- [ ] Ship cycle [project:: [[Sauce]]] [priority:: high] [due:: 2026-06-30]',
            parsed: { title: 'Ship cycle', priority: 'high', due: '2026-06-30', scheduled: null, project: 'Sauce' },
        }];
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: { findTaskLines: () => entries },
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'today.md' } }),
        };
        const inst = new sandbox.TodayCaptureEditableList();
        await inst.render(dv);

        const list = container._children[0];
        const allText = findAll(list, () => true).map((el) => el._text).join('|');
        ok(allText.includes('Sauce'), `HC-V0127-TCEL-B: project chip ('Sauce') rendered (text: ${allText})`);
        ok(allText.includes('high'), 'HC-V0127-TCEL-B-2: priority chip rendered');
        ok(allText.includes('due: 2026-06-30'), 'HC-V0127-TCEL-B-3: due chip rendered');
    }

    // -----------------------------------------------------------------------
    // HC-V0127-TCEL-C: pencil click invokes ToDoCreateTask.open with payload.
    // -----------------------------------------------------------------------
    {
        const entries = [{
            idx: 12,
            line: '- [ ] Click me',
            parsed: { title: 'Click me', priority: 'medium', due: '2026-06-25', scheduled: null, project: null },
        }];
        let captured = null;
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: { findTaskLines: () => entries },
                ToDoCreateTask: {
                    open: (opts) => { captured = opts; },
                },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' } }),
        };
        const inst = new sandbox.TodayCaptureEditableList();
        await inst.render(dv);

        // Locate the pencil edit button — the last span child in each row that
        // carries an SVG (innerHTML starts with '<svg').
        const list = container._children[0];
        const editBtns = findAll(list, (el) => el.tagName === 'span' && typeof el.innerHTML === 'string' && el.innerHTML.startsWith('<svg'));
        ok(editBtns.length === 1, `HC-V0127-TCEL-C: one pencil edit button rendered (got ${editBtns.length})`);
        if (editBtns.length === 1) {
            editBtns[0].dispatchEvent('click');
            ok(captured !== null, 'HC-V0127-TCEL-C-2: ToDoCreateTask.open invoked');
            if (captured) {
                ok(captured.editExisting && captured.editExisting.filePath === 'spice/to-do/2026/06-June/ToDo-2026-06-23.md',
                    `HC-V0127-TCEL-C-3: open got correct filePath (got ${JSON.stringify(captured.editExisting && captured.editExisting.filePath)})`);
                ok(captured.editExisting.lineIdx === 12,
                    `HC-V0127-TCEL-C-4: open got correct lineIdx (got ${captured.editExisting.lineIdx})`);
                ok(captured.editExisting.parsed && captured.editExisting.parsed.title === 'Click me',
                    `HC-V0127-TCEL-C-5: open got parsed payload (got ${JSON.stringify(captured.editExisting.parsed)})`);
            }
        }
    }

    // -----------------------------------------------------------------------
    // HC-V0127-TCEL-D: empty entries → "No tasks yet" message.
    // -----------------------------------------------------------------------
    {
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: { findTaskLines: () => [] },
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'today.md' } }),
        };
        const inst = new sandbox.TodayCaptureEditableList();
        await inst.render(dv);

        const allText = findAll(container, () => true).map((el) => el._text).join('|');
        ok(allText.includes('No tasks yet'),
            `HC-V0127-TCEL-D: empty entries renders "No tasks yet" hint (got: ${allText})`);
    }

    // -----------------------------------------------------------------------
    // HC-V0127-TCEL-E: missing TaskInteractions → graceful note, no throw.
    // -----------------------------------------------------------------------
    {
        const sandbox = loadIntoSandbox({
            customJS: {
                // TaskInteractions deliberately absent.
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'today.md' } }),
        };
        const inst = new sandbox.TodayCaptureEditableList();
        let threw = false;
        try { await inst.render(dv); } catch (_e) { threw = true; }
        ok(!threw, 'HC-V0127-TCEL-E: render does NOT throw when TaskInteractions missing');
        const allText = findAll(container, () => true).map((el) => el._text).join('|');
        ok(allText.includes('task-interactions mechanism not loaded'),
            `HC-V0127-TCEL-E-2: graceful not-loaded notice rendered (got: ${allText})`);
    }

    // -----------------------------------------------------------------------
    // HC-V0127-TCEL-F: render no-ops inside .markdown-embed.
    // -----------------------------------------------------------------------
    {
        let findTaskLinesCalled = false;
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: {
                    findTaskLines: () => { findTaskLinesCalled = true; return []; },
                },
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        container._closestSelector = '.markdown-embed';
        const dv = {
            container,
            current: () => ({ file: { path: 'today.md' } }),
        };
        const inst = new sandbox.TodayCaptureEditableList();
        await inst.render(dv);

        ok(!findTaskLinesCalled,
            'HC-V0127-TCEL-F: render no-ops inside .markdown-embed (findTaskLines never invoked)');
        ok(container._children.length === 0,
            `HC-V0127-TCEL-F-2: no children added in embed (got ${container._children.length})`);
    }

    console.log('');
    if (fail === 0) {
        console.log(`PASS ${pass}/${pass + fail}`);
        process.exit(0);
    } else {
        console.log(`FAIL ${fail}/${pass + fail}`);
        process.exit(1);
    }
})().catch((e) => {
    console.error('UNCAUGHT: ' + (e.stack || e.message || e));
    process.exit(2);
});
