#!/usr/bin/env node
// run-v0128-owned-tasks-editable.js — behavioral harness for v0.128.0 §E.
//
// Two distinct surfaces in one harness:
//
//   Surface 1 — EditableTaskList renderer + dispatch (vm-sandbox load of
//   platform/blueprints/to-do/helpers/editable-task-list.js):
//     HC-V0128-ETL-A: render(dv, { sectionAnchor: "ownedTasks" }) propagates
//                     the "ownedTasks" anchor to findTaskLines.
//     HC-V0128-ETL-B: render(dv) without opts defaults to "todayCapture"
//                     (back-compat with v0.127.x callers).
//     HC-V0128-ETL-C: TodayCaptureEditableList back-compat alias subclass
//                     behaves identically to direct EditableTaskList.
//     HC-V0128-ETL-D: pencil click invokes ToDoCreateTask.open in
//                     editExisting mode with the entry's payload.
//     HC-V0128-ETL-E: empty findTaskLines result → empty-state message.
//
//   Surface 2 — _healNoteChromeBody step 7 (project-todo paired guards) + step 6
//   third guard (TodayCaptureEditableList → EditableTaskList class rewrite):
//     HC-V0128-ETL-HEAL-A: step 7 fresh inject — Owned Tasks SectionLabel with
//                         `top: true`, no marker, no renderer → both injected.
//     HC-V0128-ETL-HEAL-B: step 7 fresh inject — Owned Tasks SectionLabel
//                         WITHOUT `top: true` → still healed (regex-loosen fix).
//     HC-V0128-ETL-HEAL-C: step 7 back-fill — marker present but no renderer →
//                         only renderer added; marker count remains 1.
//     HC-V0128-ETL-HEAL-D: step 7 idempotency — fully-healed body is byte-equal.
//     HC-V0128-ETL-HEAL-E: step 7 no-anchor short-circuit — body without Owned
//                         Tasks SectionLabel is left unchanged; no throw.
//     HC-V0128-ETL-HEAL-F: step 7 type-gating — type:to-do body has an Owned
//                         Tasks SectionLabel but step 7 logic does NOT fire.
//     HC-V0128-ETL-HEAL-G: step 6 third guard — to-do body with
//                         `class: "TodayCaptureEditableList" }` invocation gets
//                         rewritten to the canonical EditableTaskList form with
//                         explicit sectionAnchor: "todayCapture".
//     HC-V0128-ETL-HEAL-H: step 6 third guard idempotency — second pass on the
//                         rewritten body is byte-equal.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'editable-task-list.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

const install = require(path.join(__dirname, '..', 'install.js'));
const { _healNoteChromeBody } = install;

const OWNED_TASKS_MARKER = '<!-- OWNED_TASKS_MARKER -->';
const RENDERER_CLASS = 'class: "EditableTaskList"';
const LEGACY_CLASS = 'class: "TodayCaptureEditableList"';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
    if (cond) { pass++; console.log('  PASS ' + msg); }
    else { fail++; console.log('  FAIL ' + msg); }
}

function countOccurrences(s, needle) {
    let n = 0, i = 0;
    while ((i = s.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
}

// ─── Surface 1 helpers ─────────────────────────────────────────────────────

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

function findAll(root, predicate, acc) {
    acc = acc || [];
    if (predicate(root)) acc.push(root);
    for (const c of root._children || []) findAll(c, predicate, acc);
    return acc;
}

function loadIntoSandbox(overrides) {
    overrides = overrides || {};
    const sandbox = {};
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    sandbox.Notice = function () {};
    sandbox.console = console;
    sandbox.app = overrides.app || {
        vault: {
            getAbstractFileByPath: () => ({ path: overrides.filePath || 'mock.md' }),
            read: async () => overrides.content || 'mock content',
        },
    };
    sandbox.customJS = overrides.customJS || {
        TaskInteractions: { findTaskLines: () => [] },
        ToDoCreateTask: { open: () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(
        src
        + '\nthis.EditableTaskList = EditableTaskList;'
        + '\nthis.TodayCaptureEditableList = TodayCaptureEditableList;',
        sandbox
    );
    return sandbox;
}

// ─── Run ────────────────────────────────────────────────────────────────────

(async () => {
    console.log('run-v0128-owned-tasks-editable:');

    // ────────────────────────────────────────────────────────────────────────
    // Surface 1 — EditableTaskList renderer + dispatch.
    // ────────────────────────────────────────────────────────────────────────

    // HC-V0128-ETL-A — sectionAnchor: "ownedTasks" propagates to findTaskLines.
    {
        const captured = [];
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: {
                    findTaskLines: (content, anchor) => {
                        captured.push({ content, anchor });
                        return [];
                    },
                },
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'spice/projects/Sauce/Sauce To-Do.md' } }),
        };
        const inst = new sandbox.EditableTaskList();
        await inst.render(dv, { sectionAnchor: 'ownedTasks' });

        ok(captured.length === 1,
            `HC-V0128-ETL-A: findTaskLines invoked exactly once (got ${captured.length})`);
        if (captured.length >= 1) {
            ok(captured[0].anchor === 'ownedTasks',
                `HC-V0128-ETL-A-2: anchor arg propagated as "ownedTasks" (got ${JSON.stringify(captured[0].anchor)})`);
        }
    }

    // HC-V0128-ETL-B — render(dv) without opts defaults to "todayCapture".
    {
        const captured = [];
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: {
                    findTaskLines: (content, anchor) => {
                        captured.push({ content, anchor });
                        return [];
                    },
                },
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' } }),
        };
        const inst = new sandbox.EditableTaskList();
        await inst.render(dv); // No opts.

        ok(captured.length === 1,
            `HC-V0128-ETL-B: findTaskLines invoked exactly once (got ${captured.length})`);
        if (captured.length >= 1) {
            ok(captured[0].anchor === 'todayCapture',
                `HC-V0128-ETL-B-2: default anchor is "todayCapture" (got ${JSON.stringify(captured[0].anchor)})`);
        }
    }

    // HC-V0128-ETL-C — TodayCaptureEditableList alias subclass behaves identically.
    {
        const captured = [];
        const sandbox = loadIntoSandbox({
            customJS: {
                TaskInteractions: {
                    findTaskLines: (content, anchor) => {
                        captured.push({ content, anchor });
                        return [];
                    },
                },
                ToDoCreateTask: { open: () => {} },
            },
        });
        const container = makeEl();
        const dv = {
            container,
            current: () => ({ file: { path: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' } }),
        };
        const inst = new sandbox.TodayCaptureEditableList();
        ok(inst instanceof sandbox.EditableTaskList,
            'HC-V0128-ETL-C: TodayCaptureEditableList instance is an EditableTaskList (alias subclass)');
        await inst.render(dv);

        ok(captured.length === 1,
            `HC-V0128-ETL-C-2: alias .render() reaches findTaskLines (got ${captured.length})`);
        if (captured.length >= 1) {
            ok(captured[0].anchor === 'todayCapture',
                `HC-V0128-ETL-C-3: alias defaults to "todayCapture" (got ${JSON.stringify(captured[0].anchor)})`);
        }
    }

    // HC-V0128-ETL-D — pencil click invokes ToDoCreateTask.open with payload.
    {
        const entries = [{
            idx: 17,
            line: '- [ ] Wire up step 7',
            parsed: { title: 'Wire up step 7', priority: null, due: null, scheduled: null, project: 'Sauce' },
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
        const filePath = 'spice/projects/Sauce/Sauce To-Do.md';
        const dv = {
            container,
            current: () => ({ file: { path: filePath } }),
        };
        const inst = new sandbox.EditableTaskList();
        await inst.render(dv, { sectionAnchor: 'ownedTasks' });

        const list = container._children[0];
        ok(!!list, 'HC-V0128-ETL-D: list container created for non-empty entries');
        ok(list && list._children.length === 1,
            `HC-V0128-ETL-D-2: one row rendered per entry (got ${list ? list._children.length : 0})`);

        const editBtns = findAll(container, (el) =>
            el.tagName === 'span' && typeof el.innerHTML === 'string' && el.innerHTML.startsWith('<svg'));
        ok(editBtns.length === 1,
            `HC-V0128-ETL-D-3: one pencil edit button rendered (got ${editBtns.length})`);
        if (editBtns.length === 1) {
            editBtns[0].dispatchEvent('click');
            ok(captured !== null,
                'HC-V0128-ETL-D-4: pencil click invoked ToDoCreateTask.open');
            if (captured) {
                ok(captured.editExisting && captured.editExisting.filePath === filePath,
                    `HC-V0128-ETL-D-5: open got correct filePath (got ${JSON.stringify(captured.editExisting && captured.editExisting.filePath)})`);
                ok(captured.editExisting && captured.editExisting.lineIdx === 17,
                    `HC-V0128-ETL-D-6: open got correct lineIdx (got ${captured.editExisting && captured.editExisting.lineIdx})`);
                ok(captured.editExisting && captured.editExisting.parsed && captured.editExisting.parsed.title === 'Wire up step 7',
                    `HC-V0128-ETL-D-7: open got the parsed payload (got ${JSON.stringify(captured.editExisting && captured.editExisting.parsed)})`);
            }
        }
    }

    // HC-V0128-ETL-E — empty findTaskLines result → empty-state message.
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
            current: () => ({ file: { path: 'spice/projects/Sauce/Sauce To-Do.md' } }),
        };
        const inst = new sandbox.EditableTaskList();
        await inst.render(dv, { sectionAnchor: 'ownedTasks' });

        const allText = findAll(container, () => true).map((el) => el._text).join('|');
        ok(allText.includes('No tasks yet'),
            `HC-V0128-ETL-E: empty entries renders empty-state message (got: ${allText})`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Surface 2 — _healNoteChromeBody step 7 + step 6 third guard.
    // ────────────────────────────────────────────────────────────────────────

    // Project-todo body fixtures.

    const PROJECT_TODO_TOP_TRUE = `---
type: project-todo
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
\`\`\`
`;

    const PROJECT_TODO_NO_TOP = `---
type: project-todo
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks" }] });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
\`\`\`
`;

    const PROJECT_TODO_MARKER_ONLY = `---
type: project-todo
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });
\`\`\`

<!-- OWNED_TASKS_MARKER -->

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
\`\`\`
`;

    const PROJECT_TODO_FULLY_HEALED = `---
type: project-todo
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });
\`\`\`

<!-- OWNED_TASKS_MARKER -->

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "EditableTaskList", args: [{ sectionAnchor: "ownedTasks" }] });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
\`\`\`
`;

    const PROJECT_TODO_NO_ANCHOR = `---
type: project-todo
---

# A project-todo note without an Owned Tasks SectionLabel.
`;

    // Type-gating: same body as PROJECT_TODO_TOP_TRUE shape but with type:to-do.
    const TODO_WITH_OWNED_TASKS_LABEL = `---
type: to-do
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
\`\`\`
`;

    // Step 6 third guard fixture — to-do body with legacy class invocation.
    // Includes a Today SectionLabel block so step 6 doesn't no-op, and uses the
    // legacy customjs-guard form `class: "TodayCaptureEditableList" }`.
    const TODO_LEGACY_CLASS = `---
type: to-do
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
\`\`\`

<!-- TODAY_CAPTURE_MARKER -->

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList" });
\`\`\`
`;

    // HC-V0128-ETL-HEAL-A — fresh inject on `top: true` SectionLabel form.
    {
        const out = _healNoteChromeBody(PROJECT_TODO_TOP_TRUE, 'project-todo');
        ok(out.includes(OWNED_TASKS_MARKER),
            'HC-V0128-ETL-HEAL-A1: marker injected on top:true SectionLabel form');
        ok(out.includes(RENDERER_CLASS),
            'HC-V0128-ETL-HEAL-A2: renderer block injected (EditableTaskList)');
        ok(countOccurrences(out, OWNED_TASKS_MARKER) === 1,
            `HC-V0128-ETL-HEAL-A3: exactly one marker (got ${countOccurrences(out, OWNED_TASKS_MARKER)})`);
        ok(countOccurrences(out, RENDERER_CLASS) === 1,
            `HC-V0128-ETL-HEAL-A4: exactly one renderer (got ${countOccurrences(out, RENDERER_CLASS)})`);
        // Renderer carries the explicit sectionAnchor arg.
        ok(out.includes('sectionAnchor: "ownedTasks"'),
            'HC-V0128-ETL-HEAL-A5: renderer carries sectionAnchor: "ownedTasks"');
    }

    // HC-V0128-ETL-HEAL-B — fresh inject on no-top SectionLabel form (regex loosen).
    {
        const out = _healNoteChromeBody(PROJECT_TODO_NO_TOP, 'project-todo');
        ok(out.includes(OWNED_TASKS_MARKER),
            'HC-V0128-ETL-HEAL-B1: marker injected on no-top SectionLabel form');
        ok(out.includes(RENDERER_CLASS),
            'HC-V0128-ETL-HEAL-B2: renderer block injected on no-top form');
        ok(countOccurrences(out, OWNED_TASKS_MARKER) === 1,
            `HC-V0128-ETL-HEAL-B3: exactly one marker (got ${countOccurrences(out, OWNED_TASKS_MARKER)})`);
        ok(countOccurrences(out, RENDERER_CLASS) === 1,
            `HC-V0128-ETL-HEAL-B4: exactly one renderer (got ${countOccurrences(out, RENDERER_CLASS)})`);
    }

    // HC-V0128-ETL-HEAL-C — back-fill: marker only → renderer gets added.
    {
        const out = _healNoteChromeBody(PROJECT_TODO_MARKER_ONLY, 'project-todo');
        ok(out.includes(RENDERER_CLASS),
            'HC-V0128-ETL-HEAL-C1: renderer injected on marker-only body');
        ok(countOccurrences(out, OWNED_TASKS_MARKER) === 1,
            `HC-V0128-ETL-HEAL-C2: marker count remains 1 (got ${countOccurrences(out, OWNED_TASKS_MARKER)})`);
        ok(countOccurrences(out, RENDERER_CLASS) === 1,
            `HC-V0128-ETL-HEAL-C3: renderer count goes 0 → 1 (got ${countOccurrences(out, RENDERER_CLASS)})`);
    }

    // HC-V0128-ETL-HEAL-D — idempotency: fully-healed body byte-equal.
    {
        const out = _healNoteChromeBody(PROJECT_TODO_FULLY_HEALED, 'project-todo');
        ok(out === PROJECT_TODO_FULLY_HEALED,
            'HC-V0128-ETL-HEAL-D1: fully-healed project-todo body is byte-equal (idempotent)');
    }

    // HC-V0128-ETL-HEAL-E — no Owned Tasks SectionLabel → no-op, no throw.
    {
        let threw = false;
        let out = '';
        try {
            out = _healNoteChromeBody(PROJECT_TODO_NO_ANCHOR, 'project-todo');
        } catch (_e) {
            threw = true;
        }
        ok(!threw, 'HC-V0128-ETL-HEAL-E1: no throw when Owned Tasks SectionLabel absent');
        ok(out === PROJECT_TODO_NO_ANCHOR,
            'HC-V0128-ETL-HEAL-E2: body unchanged when no anchor (byte-equal)');
        ok(!out.includes(OWNED_TASKS_MARKER),
            'HC-V0128-ETL-HEAL-E3: no marker injected');
        ok(!out.includes(RENDERER_CLASS),
            'HC-V0128-ETL-HEAL-E4: no renderer injected');
    }

    // HC-V0128-ETL-HEAL-F — type-gating: type:to-do with Owned Tasks SectionLabel
    // is NOT touched by step 7. Step 6 also no-ops on this body (no Today
    // SectionLabel anchor present), so we can assert byte-equality.
    {
        const out = _healNoteChromeBody(TODO_WITH_OWNED_TASKS_LABEL, 'to-do');
        ok(!out.includes(OWNED_TASKS_MARKER),
            'HC-V0128-ETL-HEAL-F1: step 7 does NOT fire on type:to-do (no Owned Tasks marker)');
        ok(!out.includes(RENDERER_CLASS),
            'HC-V0128-ETL-HEAL-F2: step 7 does NOT inject EditableTaskList renderer on type:to-do');
    }

    // HC-V0128-ETL-HEAL-G — step 6 third guard rewrites legacy class invocation.
    {
        const out = _healNoteChromeBody(TODO_LEGACY_CLASS, 'to-do');
        ok(!out.includes(LEGACY_CLASS),
            `HC-V0128-ETL-HEAL-G1: legacy class invocation rewritten away (no '${LEGACY_CLASS}' in output)`);
        ok(out.includes(RENDERER_CLASS),
            'HC-V0128-ETL-HEAL-G2: canonical EditableTaskList class present');
        ok(out.includes('sectionAnchor: "todayCapture"'),
            'HC-V0128-ETL-HEAL-G3: rewrite carries sectionAnchor: "todayCapture"');
        ok(countOccurrences(out, RENDERER_CLASS) === 1,
            `HC-V0128-ETL-HEAL-G4: exactly one EditableTaskList invocation post-rewrite (got ${countOccurrences(out, RENDERER_CLASS)})`);
    }

    // HC-V0128-ETL-HEAL-H — step 6 third guard idempotency.
    {
        const first = _healNoteChromeBody(TODO_LEGACY_CLASS, 'to-do');
        const second = _healNoteChromeBody(first, 'to-do');
        ok(first === second,
            'HC-V0128-ETL-HEAL-H1: second pass on rewritten body is byte-equal (idempotent)');
    }

    console.log('');
    const total = pass + fail;
    if (fail === 0) {
        console.log(`PASS ${pass}/${total}`);
        process.exit(0);
    } else {
        console.log(`FAIL ${fail}/${total}`);
        process.exit(1);
    }
})().catch((e) => {
    console.error('UNCAUGHT: ' + (e.stack || e.message || e));
    process.exit(2);
});
