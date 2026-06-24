#!/usr/bin/env node
/**
 * run-todo-dialog — Node harness for ToDoCreateTask static helpers.
 *
 *   DLG-1..4: serializePayloadToLine one-shot variants
 *   DLG-5:    project destination adds [project::]
 *   DLG-6..8: recurring grammar composition + serialization
 *   DLG-9:    recurring with project link
 *   DLG-10:   validatePayload empty-title rejection
 *   DLG-11:   validatePayload invalid recurrence rejection
 *   DLG-12:   validatePayload ISO-date validation
 */

const fs = require('fs');
const path = require('path');

// --- Shared mutable globals. ---
// The loaded classes reference window.* (window.app / window.customJS / Notice)
// at call-time against the closure they were defined in, so we inject ONE set of
// stubs and mutate them between cases. This lets DLG-16 inject a live-style
// customJS.RecurrenceParser INSTANCE that validatePayload actually reads.
const sharedWindow = { moment: undefined, customJS: undefined, app: undefined };

function loadHelperClass(fileName, className) {
    const helperPath = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', fileName);
    const src = fs.readFileSync(helperPath, 'utf8');
    const stubs = `
        const document = {};
        const Notice = function () {};
        const console = { error: function () {} };
    `;
    // eslint-disable-next-line no-new-func
    const make = new Function('window', `${stubs}\n${src}\nreturn ${className};`);
    return make(sharedWindow);
}

// Load ToDoCreateTask against the SAME mutable sharedWindow so validatePayload's
// `window.customJS.RecurrenceParser` reads can be exercised from the test (DLG-16).
const ToDoCreateTask = loadHelperClass('todo-create-task.js', 'ToDoCreateTask');
const ToDoCreateTaskInit = loadHelperClass('todo-create-task-init.js', 'ToDoCreateTaskInit');
const RecurrenceParser = loadHelperClass('recurrence-parser.js', 'RecurrenceParser');

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok  ${label}`); pass++; }
    else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

console.log('run-todo-dialog:');

// --- DLG-1: minimal one-shot ---
ok('DLG-1 minimal one-shot',
    ToDoCreateTask.serializePayloadToLine({ mode: 'one-shot', title: 'Pay rent', destination: 'today' }) === '- [ ] Pay rent');

// --- DLG-2: one-shot with priority ---
ok('DLG-2 one-shot with priority',
    ToDoCreateTask.serializePayloadToLine({ mode: 'one-shot', title: 'Ship v0.116', destination: 'today', priority: 'high' })
    === '- [ ] Ship v0.116 [priority:: high]');

// --- DLG-3: one-shot with due ---
ok('DLG-3 one-shot with due',
    ToDoCreateTask.serializePayloadToLine({ mode: 'one-shot', title: 'Review PR', destination: 'today', due: '2026-06-22' })
    === '- [ ] Review PR [due:: 2026-06-22]');

// --- DLG-4: one-shot with scheduled ---
ok('DLG-4 one-shot with scheduled',
    ToDoCreateTask.serializePayloadToLine({ mode: 'one-shot', title: 'Schedule x', destination: 'today', scheduled: '2026-06-20' })
    === '- [ ] Schedule x [scheduled:: 2026-06-20]');

// --- DLG-5: project destination adds [project::] ---
ok('DLG-5 project destination tags project',
    ToDoCreateTask.serializePayloadToLine({
        mode: 'one-shot', title: 'Ship spec', destination: { type: 'project', slug: 'sauce', name: 'Sauce' }, priority: 'high'
    }) === '- [ ] Ship spec [project:: [[Sauce]]] [priority:: high]');

// --- DLG-6: composeRecurrenceGrammar daily ---
ok('DLG-6 grammar daily',
    ToDoCreateTask.composeRecurrenceGrammar({ mode: 'recurring', frequency: 'daily' }) === 'every day');

ok('DLG-6a grammar weekly Wednesday',
    ToDoCreateTask.composeRecurrenceGrammar({ mode: 'recurring', frequency: 'weekday-set', frequencyArg: 'Wednesday' }) === 'every Wednesday');

ok('DLG-6b grammar monthly 15th',
    ToDoCreateTask.composeRecurrenceGrammar({ mode: 'recurring', frequency: 'monthly-day-of', frequencyArg: '15' }) === 'every 15th of month');

ok('DLG-6c grammar every 2 weeks on Monday',
    ToDoCreateTask.composeRecurrenceGrammar({ mode: 'recurring', frequency: 'every-n-weeks-on', frequencyArg: { weeks: 2, day: 'Monday' } }) === 'every 2 weeks on Monday');

// --- DLG-7: serialize recurring strips recurrence into line ---
ok('DLG-7 recurring line has recurrence',
    ToDoCreateTask.serializePayloadToLine({
        mode: 'recurring', title: 'Take out trash', recurrenceGrammar: 'every Wednesday', priority: 'medium',
    }) === '- [ ] Take out trash [recurrence:: every Wednesday] [priority:: medium]');

// --- DLG-8: serialize recurring with day-of-month ---
ok('DLG-8 recurring monthly',
    ToDoCreateTask.serializePayloadToLine({
        mode: 'recurring', title: 'Pay rent', recurrenceGrammar: 'every 1st of month', priority: 'highest',
    }) === '- [ ] Pay rent [recurrence:: every 1st of month] [priority:: highest]');

// --- DLG-9: recurring with project link ---
ok('DLG-9 recurring with project',
    ToDoCreateTask.serializePayloadToLine({
        mode: 'recurring', title: 'Sauce status post', recurrenceGrammar: 'every Friday',
        project: { slug: 'sauce', name: 'Sauce' },
    }) === '- [ ] Sauce status post [recurrence:: every Friday] [project:: [[Sauce]]]');

// --- DLG-10: validatePayload empty-title ---
ok('DLG-10 empty title rejected',
    !ToDoCreateTask.validatePayload({ mode: 'one-shot', title: '', destination: 'today' }).valid);

// --- DLG-11: validatePayload invalid recurrence ---
ok('DLG-11 unsupported grammar rejected',
    !ToDoCreateTask.validatePayload({ mode: 'recurring', title: 'X', frequency: 'unknown', frequencyArg: null }).valid);

// --- DLG-12: validatePayload ISO date check ---
ok('DLG-12 garbage due rejected',
    !ToDoCreateTask.validatePayload({ mode: 'one-shot', title: 'X', destination: 'today', due: 'tomorrow' }).valid);

ok('DLG-12a valid due accepted',
    ToDoCreateTask.validatePayload({ mode: 'one-shot', title: 'X', destination: 'today', due: '2026-06-22' }).valid);

// --- DLG-13: destinationPath project ---
ok('DLG-13 destinationPath project',
    ToDoCreateTask.destinationPath({ mode: 'one-shot', destination: { type: 'project', slug: 'sauce', name: 'Sauce' } }) === 'spice/projects/sauce/Sauce To-Do.md');

ok('DLG-13a destinationPath recurring',
    ToDoCreateTask.destinationPath({ mode: 'recurring' }) === 'spice/to-do/Recurring Tasks.md');

ok('DLG-13b destinationPath today (with stub moment)',
    ToDoCreateTask.destinationPath(
        { mode: 'one-shot', destination: 'today' },
        { format: (fmt) => fmt === 'YYYY-MM-DD' ? '2026-06-15' : '2026/06-June' }
    ) === 'spice/to-do/2026/06-June/ToDo-2026-06-15.md');

// --- DLG-14: ToDoCreateTaskInit constructs + initializes without throwing ---
(() => {
    let ctorThrew = false;
    let init;
    try { init = new ToDoCreateTaskInit(); } catch (_e) { ctorThrew = true; }
    ok('DLG-14 ToDoCreateTaskInit constructs', !ctorThrew && !!init);

    // invoke() with no window.app returns early (command API guard) — no throw.
    sharedWindow.app = undefined;
    let earlyThrew = false;
    try { init.invoke(); } catch (_e) { earlyThrew = true; }
    ok('DLG-14a invoke() no-ops without app.commands', !earlyThrew);

    // With a stub command API, invoke() registers both Sauce commands.
    const registered = [];
    sharedWindow.app = { commands: { addCommand: (cmd) => registered.push(cmd.id) } };
    const init2 = new ToDoCreateTaskInit();
    let invokeThrew = false;
    try { init2.invoke(); } catch (_e) { invokeThrew = true; }
    ok('DLG-14b invoke() registers commands without throwing', !invokeThrew);
    ok('DLG-14c registers sauce:new-task + sauce:new-recurring-task',
        registered.includes('sauce:new-task') && registered.includes('sauce:new-recurring-task'),
        `got ${JSON.stringify(registered)}`);

    // Idempotency: a second invoke() on the same instance does not re-register.
    init2.invoke();
    ok('DLG-14d second invoke() is idempotent', registered.length === 2, `got ${registered.length}`);
    sharedWindow.app = undefined;
})();

// --- DLG-15: _insertLineUnderSection three-tier anchor (v0.117.2) ---
// Default "Today" destination → labelText "Today", legacy heading "## Today".
(() => {
    const inst = new ToDoCreateTask();
    const payload = { mode: 'one-shot', destination: 'today' };
    const line = '- [ ] Pay rent';

    // Tier 1: SectionLabel "Today" dataviewjs block present → insert under it.
    const slBody = [
        '---', 'type: to-do', '---', '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: { text: "Today" } });',
        '```', '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });',
        '```', '',
    ].join('\n');
    const slOut = inst._insertLineUnderSection(slBody, line, payload);
    const slBlockEnd = slOut.indexOf('class: "SectionLabel"');
    const slLineIdx = slOut.indexOf(line);
    const carryoverIdx = slOut.indexOf('class: "ToDoDailyCarryover"');
    ok('DLG-15 tier1 line inserted', slLineIdx > -1, `out:\n${slOut}`);
    ok('DLG-15a tier1 line after SectionLabel block', slLineIdx > slBlockEnd);
    ok('DLG-15b tier1 line before next dv block', slLineIdx < carryoverIdx);
    ok('DLG-15c tier1 creates NO new ## Today heading', !/^## Today/m.test(slOut), `out:\n${slOut}`);
    ok('DLG-15d tier1 creates NO ## Today\'s Capture heading', !slOut.includes("## Today's Capture"));

    // Tier 2: legacy "## Today" H2 only (no SectionLabel) → insert under H2.
    const h2Body = [
        '---', 'type: to-do', '---', '',
        '## Today', '',
        '## Later', '',
    ].join('\n');
    const h2Out = inst._insertLineUnderSection(h2Body, line, payload);
    const h2HeadIdx = h2Out.indexOf('## Today');
    const h2LineIdx = h2Out.indexOf(line);
    const laterIdx = h2Out.indexOf('## Later');
    ok('DLG-15e tier2 line inserted', h2LineIdx > -1, `out:\n${h2Out}`);
    ok('DLG-15f tier2 line under the ## Today H2', h2LineIdx > h2HeadIdx && h2LineIdx < laterIdx);
    ok('DLG-15g tier2 still has exactly one ## Today',
        (h2Out.match(/^## Today$/gm) || []).length === 1);

    // Tier 3: neither anchor → append at EOF, NO new heading.
    const bareBody = [
        '---', 'type: to-do', '---', '',
        'Some freeform note text.',
    ].join('\n');
    const bareOut = inst._insertLineUnderSection(bareBody, line, payload);
    ok('DLG-15h tier3 line appended', bareOut.includes(line), `out:\n${bareOut}`);
    ok('DLG-15i tier3 creates NO new heading', !/^##\s/m.test(bareOut), `out:\n${bareOut}`);
    ok('DLG-15j tier3 appends at EOF',
        bareOut.replace(/\n+$/, '').endsWith(line), `out:\n${bareOut}`);
})();

// DLG-MARK: today task inserts AFTER the TODAY_CAPTURE_MARKER (#3).
(() => {
    const inst = new ToDoCreateTask();
    const content = [
        '---','type: to-do','---','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });','```','',
        '<!-- TODAY_CAPTURE_MARKER -->','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList" });','```',
    ].join('\n');
    const out = inst._insertLineUnderSection(content, '- [ ] new one', { destination: 'today' });
    const markIdx = out.indexOf('<!-- TODAY_CAPTURE_MARKER -->');
    const taskIdx = out.indexOf('- [ ] new one');
    ok('DLG-MARK task after marker', taskIdx > markIdx, `marker@${markIdx} task@${taskIdx}`);
})();
// DLG-SCAFFOLD: _todayBody fallback contains the full chrome (#2).
(() => {
    const body = ToDoCreateTask._todayBody(null, '2026-06-24T09:00:00-06:00');
    ok('DLG-SCAFFOLD has marker', body.includes('<!-- TODAY_CAPTURE_MARKER -->'));
    ok('DLG-SCAFFOLD has editable list', body.includes('TodayCaptureEditableList'));
    ok('DLG-SCAFFOLD has carryover', body.includes('ToDoDailyCarryover'));
    ok('DLG-SCAFFOLD has leaf actions', body.includes('ToDoLeafActions'));
    ok('DLG-SCAFFOLD dividers around buttons', body.split('---').length >= 4);
})();
// DLG-SCAFFOLD-TPL: when given the materialized template, substitutes the date token.
(() => {
    const tpl = '---\ntype: to-do\ncreated_at: "<% tp.file.creation_date(\"YYYY-MM-DDTHH:mm:ssZ\") %>"\ntags:\n  - "accuris"\n---\n<!-- TODAY_CAPTURE_MARKER -->\nTodayCaptureEditableList';
    const body = ToDoCreateTask._todayBody(tpl, '2026-06-24T09:00:00-06:00');
    ok('DLG-SCAFFOLD-TPL token substituted', body.includes('2026-06-24T09:00:00-06:00') && !body.includes('tp.file.creation_date'));
    ok('DLG-SCAFFOLD-TPL keeps vault tag', body.includes('"accuris"'));
})();

// --- DLG-16: LIVE recurring validate with customJS.RecurrenceParser INSTANCE ---
// Reproduces the user-reported "Create button permanently disabled" bug. In live
// Obsidian customJS stores INSTANCES under window.customJS.RecurrenceParser; the
// dialog's validatePayload calls customJS.RecurrenceParser.isSupported(g). If that
// method is static-only, the instance call throws, validatePayload throws, and the
// submit button is never enabled. With the instance delegator + try/catch guard,
// validatePayload must return { valid: true } WITHOUT throwing.
(() => {
    sharedWindow.customJS = { RecurrenceParser: new RecurrenceParser() };
    let threw = false;
    let result;
    try {
        result = ToDoCreateTask.validatePayload({ mode: 'recurring', title: 'X', frequency: 'daily', frequencyArg: null });
    } catch (_e) {
        threw = true;
    }
    ok('DLG-16 recurring validate does NOT throw with instance RecurrenceParser', !threw);
    ok('DLG-16a recurring validate returns valid:true', !threw && result && result.valid === true,
        `got ${JSON.stringify(result)}`);
    sharedWindow.customJS = undefined;
})();

// --- DLG-17: composeMarkdownLink static helper ---
ok('DLG-17 composeMarkdownLink label+url',
    ToDoCreateTask.composeMarkdownLink('spec', 'https://x/y') === '[spec](https://x/y)');

ok('DLG-17a composeMarkdownLink empty label falls back to url',
    ToDoCreateTask.composeMarkdownLink('', 'https://x/y') === '[https://x/y](https://x/y)');

ok('DLG-17b composeMarkdownLink whitespace url → null',
    ToDoCreateTask.composeMarkdownLink('lbl', '   ') === null);

ok('DLG-17c composeMarkdownLink empty url → null',
    ToDoCreateTask.composeMarkdownLink('lbl', '') === null);

// --- DLG-18: serializePayloadToLine preserves embedded markdown verbatim ---
// A title like `Read [spec](https://x) [[Acme]]` must flow through unchanged —
// the dialog's inserters write markdown straight into the title field.
ok('DLG-18 serialize preserves [label](url) + [[wikilink]]',
    ToDoCreateTask.serializePayloadToLine({
        mode: 'one-shot', title: 'Read [spec](https://x) [[Acme]]', destination: 'today',
    }) === '- [ ] Read [spec](https://x) [[Acme]]');

// --- DLG-19: _appendToTitle instance helper ---
// The harness DOM stub (document = {}) cannot render a real form, so we exercise
// the inserter's core mutation directly with a fake titleInput + state. This is
// the documented fallback when a full DOM-render is impractical in the harness.
(() => {
    const inst = new ToDoCreateTask();
    const titleInput = { value: '' };
    const state = { title: '' };

    inst._appendToTitle(state, titleInput, '[[Note]]');
    ok('DLG-19 _appendToTitle sets state.title', state.title === '[[Note]]', `got ${JSON.stringify(state.title)}`);
    ok('DLG-19a _appendToTitle mirrors to titleInput.value', titleInput.value === '[[Note]]', `got ${JSON.stringify(titleInput.value)}`);

    // Second append inserts a single separating space.
    inst._appendToTitle(state, titleInput, '[spec](https://x)');
    ok('DLG-19b second append adds separating space',
        state.title === '[[Note]] [spec](https://x)', `got ${JSON.stringify(state.title)}`);
    ok('DLG-19c second append mirrors to titleInput.value',
        titleInput.value === '[[Note]] [spec](https://x)', `got ${JSON.stringify(titleInput.value)}`);
})();

// --- DLG-20: _loadNoteList defensive fallbacks ---
(() => {
    const inst = new ToDoCreateTask();

    // No vault / missing getMarkdownFiles → [] (no throw).
    sharedWindow.app = undefined;
    ok('DLG-20 _loadNoteList returns [] without app', Array.isArray(inst._loadNoteList()) && inst._loadNoteList().length === 0);

    sharedWindow.app = { vault: {} };
    ok('DLG-20a _loadNoteList returns [] when getMarkdownFiles absent',
        Array.isArray(inst._loadNoteList()) && inst._loadNoteList().length === 0);

    // v0.8.1 PATCH: returns { name, path, mtime } unsorted (filter handles sort).
    // No cap — was .slice(0, 200) which hid every note past "D"-ish in vaults
    // with >200 markdown files (reported on accuris 2026-06-16).
    sharedWindow.app = {
        vault: {
            getMarkdownFiles: () => [
                { basename: 'Zebra', path: 'a/Zebra.md', stat: { mtime: 1000 } },
                { basename: 'Acme', path: 'b/Acme.md', stat: { mtime: 2000 } },
            ],
        },
    };
    const list = inst._loadNoteList();
    ok('DLG-20b _loadNoteList maps full list (2 entries)',
        list.length === 2, `got ${JSON.stringify(list)}`);
    ok('DLG-20c _loadNoteList carries path',
        list.find(n => n.name === 'Acme') && list.find(n => n.name === 'Acme').path === 'b/Acme.md',
        `got ${JSON.stringify(list)}`);
    ok('DLG-20d _loadNoteList carries mtime',
        list.find(n => n.name === 'Acme').mtime === 2000, `got ${JSON.stringify(list)}`);

    // v0.8.1 regression: 300 notes — every entry present (was capped at 200).
    const huge = [];
    for (let i = 0; i < 300; i++) {
        const letter = String.fromCharCode(65 + (i % 26));
        huge.push({ basename: `${letter}-note-${i}`, path: `vault/${letter}/note-${i}.md`, stat: { mtime: 1000 + i } });
    }
    sharedWindow.app = { vault: { getMarkdownFiles: () => huge } };
    const big = inst._loadNoteList();
    ok('DLG-20e _loadNoteList returns ALL 300 notes (no 200 cap)',
        big.length === 300, `got ${big.length}`);
    // Ensure a note alphabetically past "D" survives (the user-reported repro).
    ok('DLG-20f notes past "D" alphabetically still present',
        big.some(n => n.name.startsWith('Z-note-')), `Z-notes missing in: ${big.length} total`);

    sharedWindow.app = undefined;
})();

// Async test queue — HC-V0127-DLG-EDIT-F + G run async work (button click
// handler is async). We collect their promises in pendingAsync and await
// Promise.all before final tally.
const pendingAsync = [];

// ---------------------------------------------------------------------------
// HC-V0127-DLG-EDIT-* — editExisting mode for ToDoCreateTask.open (S8).
//
// The harness loader injects `document = {}` which is too thin to render the
// full overlay tree. For the edit-mode cases we reload ToDoCreateTask against
// a richer sandbox carrying full DOM stubs (createEl / createDiv / event
// handlers, etc.). The state object is a local closure variable so we cannot
// inspect it directly — instead we probe via:
//   - the Save/Create button text (asserts state.editExisting branched the label)
//   - destSelect.disabled (asserts state.editExisting disabled the select)
//   - the titleInput.value (asserts state.title hydrated from parsed.title)
//   - the captured customJS.TaskInteractions.replaceTaskAt args on submit
//     (asserts the edit-path dispatch + the serialized line shape)
// ---------------------------------------------------------------------------

function makeDomEl() {
    const el = {
        tagName: '',
        _text: '',
        _attrs: {},
        style: { cssText: '' },
        classList: { add() {}, remove() {}, contains() { return false; } },
        children: [],
        parentNode: null,
        disabled: false,
        type: '',
        value: '',
        innerHTML: '',
        placeholder: '',
        min: '',
        max: '',
        onclick: null,
        onchange: null,
        oninput: null,
        createEl(tag, opts) {
            const c = makeDomEl();
            c.tagName = tag;
            c.parentNode = this;
            if (opts && opts.text != null) c._text = String(opts.text);
            if (opts && opts.cls) c._attrs.cls = opts.cls;
            if (opts && opts.type) c.type = String(opts.type);
            this.children.push(c);
            return c;
        },
        createDiv(opts) { return this.createEl('div', opts); },
        addEventListener() {},
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        remove() {
            if (this.parentNode && this.parentNode.children) {
                this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
            }
        },
        focus() {},
    };
    Object.defineProperty(el, 'textContent', {
        get() { return this._text; },
        set(v) { this._text = String(v); },
        configurable: true,
    });
    return el;
}

function makeDomDocument() {
    const body = makeDomEl();
    body.tagName = 'body';
    return {
        body,
        querySelector() { return null; },
        addEventListener() {},
        removeEventListener() {},
    };
}

function findDescendant(root, predicate) {
    if (predicate(root)) return root;
    for (const c of root.children || []) {
        const r = findDescendant(c, predicate);
        if (r) return r;
    }
    return null;
}

function findAllDescendants(root, predicate, acc) {
    acc = acc || [];
    if (predicate(root)) acc.push(root);
    for (const c of root.children || []) findAllDescendants(c, predicate, acc);
    return acc;
}

/**
 * Reload ToDoCreateTask with a fresh DOM sandbox. Returns { Cls, document,
 * sharedWindow, getOverlay(), getSubmitBtn(), getTitleInput(), getDestSelect() }.
 */
function reloadWithDom() {
    const fs = require('fs');
    const path = require('path');
    const localWindow = { moment: undefined, customJS: undefined, app: undefined };
    const localDoc = makeDomDocument();
    const helperPath = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-create-task.js');
    const src = fs.readFileSync(helperPath, 'utf8');
    const stubs = `
        const Notice = function () {};
        const console = { error: function () {}, log: function () {} };
        setTimeout = (fn) => 0;
    `;
    // eslint-disable-next-line no-new-func
    const make = new Function('window', 'document', `${stubs}\n${src}\nreturn ToDoCreateTask;`);
    const Cls = make(localWindow, localDoc);
    const getOverlay = () => localDoc.body.children.find((c) => c._attrs && c._attrs.cls === 'sauce-todo-create-overlay');
    const getSubmitBtn = () => {
        const overlay = getOverlay();
        if (!overlay) return null;
        return findDescendant(overlay, (el) => el.tagName === 'button' && (el._text === 'Save' || el._text === 'Create'));
    };
    const getTitleInput = () => {
        const overlay = getOverlay();
        if (!overlay) return null;
        return findDescendant(overlay, (el) => el.tagName === 'input' && el.type === 'text' && !el.placeholder);
    };
    const getDestSelect = () => {
        const overlay = getOverlay();
        if (!overlay) return null;
        // The destination select carries the literal value 'today' on its first
        // option ("Today's daily"). The inserters' note-link select carries
        // value '' on its first option ('(none)'); the recurring form's project
        // select carries '' too. Filter by first-option value === 'today'.
        const selects = findAllDescendants(overlay, (el) => el.tagName === 'select');
        return selects.find((s) => {
            const firstOpt = (s.children || []).find((c) => c.tagName === 'option');
            return firstOpt && firstOpt.value === 'today';
        }) || null;
    };
    return { Cls, document: localDoc, sharedWindow: localWindow, getOverlay, getSubmitBtn, getTitleInput, getDestSelect };
}

// --- HC-V0127-DLG-EDIT-A: title hydrates from parsed.title ---
(() => {
    const env = reloadWithDom();
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md',
            lineIdx: 12,
            parsed: { title: 'Finish slides', priority: '', due: '', scheduled: '', project: null },
        },
    });
    const titleInput = env.getTitleInput();
    ok('HC-V0127-DLG-EDIT-A state.title hydrates from parsed.title',
        !!titleInput && titleInput.value === 'Finish slides',
        `got titleInput.value = ${JSON.stringify(titleInput && titleInput.value)}`);
})();

// --- HC-V0127-DLG-EDIT-B: priority, due, destination hydrate from parsed ---
(() => {
    const env = reloadWithDom();
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md',
            lineIdx: 7,
            parsed: { title: 'Ship cycle', priority: 'high', due: '2026-06-30', scheduled: '', project: 'Sauce' },
        },
    });
    const overlay = env.getOverlay();
    // Probe via the date input and the destSelect value to confirm hydration.
    const dateInputs = findAllDescendants(overlay, (el) => el.tagName === 'input' && el.type === 'date');
    const dueInput = dateInputs[0] || null;
    const destSelect = env.getDestSelect();
    ok('HC-V0127-DLG-EDIT-B due input hydrates from parsed.due',
        !!dueInput && dueInput.value === '2026-06-30',
        `got dueInput.value = ${JSON.stringify(dueInput && dueInput.value)}`);
    // destSelect value is set only if the matching project option exists in
    // _loadProjectList — which returns [] without a Dataview API. We can't
    // assert select.value here. Instead, verify the submit button label is Save
    // (proxy that state.editExisting set correctly and full hydration ran).
    const submit = env.getSubmitBtn();
    ok('HC-V0127-DLG-EDIT-B-2 priority+destination hydration ran (submit is "Save")',
        !!submit && submit._text === 'Save',
        `got submit text = ${JSON.stringify(submit && submit._text)}`);
})();

// --- HC-V0127-DLG-EDIT-C: state.mode forced to one-shot when editExisting ---
(() => {
    // We can't read state.mode directly; instead, assert that the Save button
    // is present (the one-shot form is the only one that renders for edit) and
    // that the recurring form's "Frequency" label is NOT in the overlay.
    const env = reloadWithDom();
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'x.md',
            lineIdx: 0,
            parsed: { title: 'x', priority: null, due: null, scheduled: null, project: null },
        },
    });
    const overlay = env.getOverlay();
    const hasFrequencyLabel = !!findDescendant(overlay, (el) => el._text === 'Frequency');
    const hasDestinationLabel = !!findDescendant(overlay, (el) => el._text === 'Destination');
    ok('HC-V0127-DLG-EDIT-C forced one-shot tab: Destination label present',
        hasDestinationLabel, 'no Destination label found in overlay tree');
    ok('HC-V0127-DLG-EDIT-C-2 forced one-shot tab: no Frequency label rendered',
        !hasFrequencyLabel, 'recurring form Frequency label leaked into edit-mode render');
})();

// --- HC-V0127-DLG-EDIT-D: submit button label is 'Save' when editExisting ---
(() => {
    const env = reloadWithDom();
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'x.md',
            lineIdx: 0,
            parsed: { title: 'Edit me', priority: null, due: null, scheduled: null, project: null },
        },
    });
    const submit = env.getSubmitBtn();
    ok('HC-V0127-DLG-EDIT-D submit text is "Save" in edit mode',
        !!submit && submit._text === 'Save',
        `got submit text = ${JSON.stringify(submit && submit._text)}`);

    // Counter-test: without editExisting, submit text is 'Create'.
    const env2 = reloadWithDom();
    const inst2 = new env2.Cls();
    inst2.open({});
    const submit2 = env2.getSubmitBtn();
    ok('HC-V0127-DLG-EDIT-D-2 submit text is "Create" without editExisting',
        !!submit2 && submit2._text === 'Create',
        `got submit text = ${JSON.stringify(submit2 && submit2._text)}`);
})();

// --- HC-V0127-DLG-EDIT-E: destination select disabled when editExisting ---
(() => {
    const env = reloadWithDom();
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'x.md',
            lineIdx: 0,
            parsed: { title: 'x', priority: null, due: null, scheduled: null, project: null },
        },
    });
    const dest = env.getDestSelect();
    ok('HC-V0127-DLG-EDIT-E destSelect.disabled === true in edit mode',
        !!dest && dest.disabled === true,
        `got dest.disabled = ${JSON.stringify(dest && dest.disabled)}`);

    // Counter-test: in create mode the destSelect remains enabled.
    const env2 = reloadWithDom();
    const inst2 = new env2.Cls();
    inst2.open({});
    const dest2 = env2.getDestSelect();
    ok('HC-V0127-DLG-EDIT-E-2 destSelect.disabled === false in create mode',
        !!dest2 && dest2.disabled === false,
        `got dest.disabled = ${JSON.stringify(dest2 && dest2.disabled)}`);
})();

// --- HC-V0127-DLG-EDIT-F: submit in edit mode invokes replaceTaskAt ---
(() => {
    const env = reloadWithDom();
    let captured = null;
    env.sharedWindow.customJS = {
        TaskInteractions: {
            replaceTaskAt: async (filePath, lineIdx, newLine) => {
                captured = { filePath, lineIdx, newLine };
                return { ok: true };
            },
        },
    };
    env.sharedWindow.app = { vault: { getAbstractFileByPath: () => null } };
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md',
            lineIdx: 9,
            parsed: { title: 'Edit me', priority: 'medium', due: '2026-06-25', scheduled: null, project: null },
        },
    });
    const submit = env.getSubmitBtn();
    ok('HC-V0127-DLG-EDIT-F submit exists', !!submit);
    // Click handler is async; queue + await before final tally.
    pendingAsync.push(Promise.resolve(submit.onclick && submit.onclick({})).then(() => {
        ok('HC-V0127-DLG-EDIT-F-2 replaceTaskAt invoked',
            captured !== null,
            'replaceTaskAt was NOT called on submit click');
        if (captured) {
            ok('HC-V0127-DLG-EDIT-F-3 replaceTaskAt got correct filePath',
                captured.filePath === 'spice/to-do/2026/06-June/ToDo-2026-06-23.md',
                `got ${JSON.stringify(captured.filePath)}`);
            ok('HC-V0127-DLG-EDIT-F-4 replaceTaskAt got correct lineIdx',
                captured.lineIdx === 9, `got ${JSON.stringify(captured.lineIdx)}`);
            ok('HC-V0127-DLG-EDIT-F-5 replaceTaskAt got serialized line with [priority::] + [due::]',
                typeof captured.newLine === 'string'
                    && captured.newLine.includes('Edit me')
                    && captured.newLine.includes('[priority:: medium]')
                    && captured.newLine.includes('[due:: 2026-06-25]'),
                `got ${JSON.stringify(captured.newLine)}`);
        }
    }));
})();

// --- HC-V0127-DLG-EDIT-G: create-path regression check ---
// Without editExisting, the create-path runs against ToDoCreateTask._submit
// (not replaceTaskAt). We stub _submit on the instance to capture the
// invocation, then verify the modal does NOT call replaceTaskAt.
(() => {
    const env = reloadWithDom();
    let createCalled = false;
    let replaceCalled = false;
    env.sharedWindow.customJS = {
        TaskInteractions: {
            replaceTaskAt: async () => { replaceCalled = true; return { ok: true }; },
        },
    };
    env.sharedWindow.app = { vault: { getAbstractFileByPath: () => null } };
    const inst = new env.Cls();
    inst._submit = async () => { createCalled = true; };
    inst.open({ preselectDestination: 'today' });
    // Simulate user typing a title so validatePayload passes.
    const titleInput = env.getTitleInput();
    titleInput.value = 'New task';
    titleInput.oninput && titleInput.oninput();
    const submit = env.getSubmitBtn();
    pendingAsync.push(Promise.resolve(submit.onclick && submit.onclick({})).then(() => {
        ok('HC-V0127-DLG-EDIT-G create-path: _submit was called',
            createCalled, '_submit was NOT called in create mode');
        ok('HC-V0127-DLG-EDIT-G-2 create-path: replaceTaskAt NOT called',
            !replaceCalled, 'replaceTaskAt was called in create mode (regression)');
    }));
})();

// Allow all async EDIT-* cases to settle before final tally.
Promise.all(pendingAsync).then(() => {
    console.log('');
    console.log(`Tests: ${pass}/${pass + fail}`);
    if (fail > 0) {
        console.log('Failures:');
        for (const f of failures) console.log(`  ${f}`);
        process.exit(1);
    }
    process.exit(0);
});
