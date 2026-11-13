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

// --- DLG-NOTRIP-1: v1 inline trip-link is fully removed ---
// v2 links trips via the real task-note model (TaskDialog + trip_slug), not an
// inline [trip:: [[Name]]] field. serializePayloadToLine must never reference
// a `trip` field, and the helper methods that built the old UI must be gone.
ok('DLG-NOTRIP-1 serializePayloadToLine ignores a payload.trip field (one-shot)',
    ToDoCreateTask.serializePayloadToLine({
        mode: 'one-shot', title: 'Book hotel', destination: 'today', trip: { slug: 'iceland-2026', name: 'Iceland 2026' },
    }) === '- [ ] Book hotel');
ok('DLG-NOTRIP-1a serializePayloadToLine ignores a payload.trip field (recurring)',
    ToDoCreateTask.serializePayloadToLine({
        mode: 'recurring', title: 'Check in', recurrenceGrammar: 'every day', trip: { slug: 'iceland-2026', name: 'Iceland 2026' },
    }) === '- [ ] Check in [recurrence:: every day]');
ok('DLG-NOTRIP-1b static class has no _appendTripField helper',
    typeof ToDoCreateTask._appendTripField === 'undefined');
ok('DLG-NOTRIP-1c instance has no _renderTripSelect helper',
    typeof (new ToDoCreateTask())._renderTripSelect === 'undefined');
ok('DLG-NOTRIP-1d instance has no _loadTripList helper',
    typeof (new ToDoCreateTask())._loadTripList === 'undefined');

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
    ok('DLG-14c registers sauce:new-task + sauce:new-task-from-set + sauce:new-recurring-task',
        registered.includes('sauce:new-task') && registered.includes('sauce:new-task-from-set') && registered.includes('sauce:new-recurring-task'),
        `got ${JSON.stringify(registered)}`);

    // Idempotency: a second invoke() on the same instance does not re-register.
    init2.invoke();
    ok('DLG-14d second invoke() is idempotent', registered.length === 3, `got ${registered.length}`);
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
// DLG-OWNED-MARK: a project-destination task inserts AFTER the OWNED_TASKS_MARKER
// (not after the SectionLabel fence above it) so it lands inside the editable-list
// scope and is not hidden by _hideRawCaptureLines. Regression guard for the
// editable-Owned-Tasks feature (Gate B L2 regression finding).
(() => {
    const inst = new ToDoCreateTask();
    const content = [
        '---','type: project-todo','project: "[[Sauce]]"','---','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });','```','',
        '<!-- OWNED_TASKS_MARKER -->','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList", args: [{ anchor: "ownedTasks" }] });','```','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });','```',
    ].join('\n');
    const payload = { destination: { type: 'project', name: 'Sauce' } };
    const out = inst._insertLineUnderSection(content, '- [ ] proj task [project:: [[Sauce]]]', payload);
    const markIdx = out.indexOf('<!-- OWNED_TASKS_MARKER -->');
    const taskIdx = out.indexOf('- [ ] proj task');
    const rendIdx = out.indexOf('anchor: "ownedTasks"');
    ok('DLG-OWNED-MARK task after marker', markIdx >= 0 && taskIdx > markIdx, `marker@${markIdx} task@${taskIdx}`);
    ok('DLG-OWNED-MARK task above renderer', taskIdx >= 0 && rendIdx > taskIdx, `task@${taskIdx} renderer@${rendIdx}`);
})();
// DLG-OWNED-FALLBACK: an unhealed project note (no marker) still inserts after the
// Owned Tasks SectionLabel fence (pre-heal behavior — visible native checkbox).
(() => {
    const inst = new ToDoCreateTask();
    const content = [
        '---','type: project-todo','---','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks" }] });','```','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });','```',
    ].join('\n');
    const payload = { destination: { type: 'project', name: 'Sauce' } };
    const out = inst._insertLineUnderSection(content, '- [ ] legacy proj', payload);
    const labelIdx = out.indexOf('text: "Owned Tasks"');
    const taskIdx = out.indexOf('- [ ] legacy proj');
    const meetingsIdx = out.indexOf('text: "From Meetings"');
    ok('DLG-OWNED-FALLBACK inserted in Owned Tasks section', labelIdx >= 0 && taskIdx > labelIdx && taskIdx < meetingsIdx);
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
        _listeners: {},
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
        addEventListener(type, fn) {
            (this._listeners[type] || (this._listeners[type] = [])).push(fn);
        },
        dispatchEvent(ev) {
            for (const fn of (this._listeners[ev && ev.type] || [])) fn(ev);
            return true;
        },
        click() { if (typeof this.onclick === 'function') this.onclick(); },
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

// --- DLG-NOTRIP-GATE: no Trip <select> anywhere, even with TripsChromeBar present ---
// v2: trips are linked via TaskDialog + trip_slug, not this dialog. The old
// gated Trip <select> must be gone from BOTH forms regardless of whether
// window.customJS.TripsChromeBar is installed.
(() => {
    const findTripSelect = (overlay) => {
        const selects = findAllDescendants(overlay, (el) => el.tagName === 'select');
        return selects.find((s) => {
            const firstOpt = (s.children || []).find((c) => c.tagName === 'option');
            return firstOpt && firstOpt._text === '— none —';
        }) || null;
    };
    const makeChain = (rows) => ({
        _rows: rows,
        where(fn) { return makeChain(this._rows.filter(fn)); },
        map(fn) { return makeChain(this._rows.map(fn)); },
        array() { return this._rows; },
    });
    const dvApi = { pages: () => makeChain([{ type: 'trip', trip_slug: 'iceland-2026', file: { name: 'Iceland 2026' } }]) };

    // Even WITH TripsChromeBar installed → one-shot form has no Trip select.
    const envOneShot = reloadWithDom();
    envOneShot.sharedWindow.customJS = { TripsChromeBar: {} };
    envOneShot.sharedWindow.app = { plugins: { plugins: { dataview: { api: dvApi } } } };
    new envOneShot.Cls().open({ preselectDestination: 'today' });
    ok('DLG-NOTRIP-GATE one-shot form: no Trip select even with TripsChromeBar installed',
        !findTripSelect(envOneShot.getOverlay()));

    // Even WITH TripsChromeBar installed → recurring form has no Trip select.
    const envRecurring = reloadWithDom();
    envRecurring.sharedWindow.customJS = { TripsChromeBar: {} };
    envRecurring.sharedWindow.app = { plugins: { plugins: { dataview: { api: dvApi } } } };
    new envRecurring.Cls().open({ preselectTab: 'recurring' });
    ok('DLG-NOTRIP-GATE recurring form: no Trip select even with TripsChromeBar installed',
        !findTripSelect(envRecurring.getOverlay()));
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

// --- HC-V01330-DLG-ENTER-*: Enter in the Title field submits the task ---
(() => {
    const env = reloadWithDom();
    const inst = new env.Cls();
    let submitCalled = 0;
    let submittedTitle = null;
    inst._submit = async (payload) => { submitCalled++; submittedTitle = payload && payload.title; };
    inst.open({ preselectDestination: 'today' });
    const titleInput = env.getTitleInput();
    const fireEnter = (el) => (el._listeners.keydown || []).forEach(
        (fn) => fn({ key: 'Enter', isComposing: false, preventDefault() {} }));

    ok('HC-V01330-DLG-ENTER-A keydown handler wired on Title input',
        !!(titleInput && titleInput._listeners.keydown && titleInput._listeners.keydown.length),
        'no keydown listener attached to the title input');

    // Empty title → submit disabled → Enter must NOT create a blank task.
    fireEnter(titleInput);
    ok('HC-V01330-DLG-ENTER-B empty title: Enter does not submit', submitCalled === 0,
        `_submit called ${submitCalled}x with empty title`);

    // Typed title → submit enabled → Enter submits with that title.
    titleInput.value = 'Ship it';
    titleInput.oninput && titleInput.oninput();
    fireEnter(titleInput);
    ok('HC-V01330-DLG-ENTER-C typed title: Enter submits once', submitCalled === 1,
        `_submit called ${submitCalled}x`);
    ok('HC-V01330-DLG-ENTER-D Enter submits the typed title', submittedTitle === 'Ship it',
        `submitted title = ${JSON.stringify(submittedTitle)}`);
})();

// --- TDLG-REOPEN-1: _submitEdit same-file — openFile must NOT be called ---
// When the note being edited is already the active file, the reopen guard
// (L10) must bail out before calling leaf.openFile (avoid scroll-to-top).
(() => {
    const env = reloadWithDom();
    let openFileCalled = false;
    const fakeLeaf = { openFile: async () => { openFileCalled = true; } };
    env.sharedWindow.customJS = {
        TaskInteractions: {
            replaceTaskAt: async () => ({ ok: true }),
        },
        OpenHelpers: { forceLeafPreview: () => {} },
    };
    env.sharedWindow.app = {
        vault: {
            getAbstractFileByPath: (p) => (p === 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' ? { path: p } : null),
        },
        workspace: {
            // Same path as the editExisting.filePath → guard should fire.
            getActiveFile: () => ({ path: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' }),
            getLeaf: () => fakeLeaf,
        },
    };
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md',
            lineIdx: 3,
            parsed: { title: 'Same file task', priority: null, due: null, scheduled: null, project: null },
        },
    });
    const titleInput = env.getTitleInput();
    if (titleInput) { titleInput.value = 'Same file task'; titleInput.oninput && titleInput.oninput(); }
    const submit = env.getSubmitBtn();
    pendingAsync.push(Promise.resolve(submit && submit.onclick && submit.onclick({})).then(() => {
        ok('TDLG-REOPEN-1 same-file edit: openFile NOT called',
            !openFileCalled,
            'openFile was called on the already-open note (scroll-to-top bug)');
    }));
})();

// --- TDLG-REOPEN-2: _submitEdit different-file — openFile MUST be called ---
// When the user is editing a task note that is NOT currently open, normal
// navigation should proceed (openFile must be called).
(() => {
    const env = reloadWithDom();
    let openFileCalled = false;
    const fakeLeaf = { openFile: async () => { openFileCalled = true; } };
    env.sharedWindow.customJS = {
        TaskInteractions: {
            replaceTaskAt: async () => ({ ok: true }),
        },
        OpenHelpers: { forceLeafPreview: () => {} },
    };
    env.sharedWindow.app = {
        vault: {
            getAbstractFileByPath: (p) => (p === 'spice/to-do/2026/06-June/ToDo-2026-06-23.md' ? { path: p } : null),
        },
        workspace: {
            // Different path → guard should NOT fire, openFile should be called.
            getActiveFile: () => ({ path: 'spice/to-do/2026/06-June/ToDo-2026-06-22.md' }),
            getLeaf: () => fakeLeaf,
        },
    };
    const inst = new env.Cls();
    inst.open({
        editExisting: {
            filePath: 'spice/to-do/2026/06-June/ToDo-2026-06-23.md',
            lineIdx: 3,
            parsed: { title: 'Different file task', priority: null, due: null, scheduled: null, project: null },
        },
    });
    const titleInput = env.getTitleInput();
    if (titleInput) { titleInput.value = 'Different file task'; titleInput.oninput && titleInput.oninput(); }
    const submit = env.getSubmitBtn();
    pendingAsync.push(Promise.resolve(submit && submit.onclick && submit.onclick({})).then(() => {
        ok('TDLG-REOPEN-2 different-file edit: openFile WAS called',
            openFileCalled,
            'openFile was NOT called when navigating to a different note');
    }));
})();

// --- RD-DH-*: pure helpers for the redesigned task dialog ---
(function () {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'mechanisms', 'task-entity', 'task-dialog.js'), 'utf8');
    // eslint-disable-next-line no-new-func
    const TD = new Function('window', src + '; return TaskDialog;')({});
    const TDI = new TD();
    const TODAY = '2026-11-09';

    const opts = TD.whenOptions(TODAY);
    ok('RD-DH-WHEN keys',
        JSON.stringify(opts.map(o => o.key)) === JSON.stringify(['today', 'tomorrow', 'nextmon', 'pick', 'none']));
    ok('RD-DH-WHEN labels',
        JSON.stringify(opts.map(o => o.label)) === JSON.stringify(['Today', 'Tomorrow', 'Next Mon', 'Pick date…', 'No date']));
    ok('RD-DH-WHEN dues',
        JSON.stringify(opts.map(o => o.due)) === JSON.stringify(['2026-11-09', '2026-11-10', '2026-11-16', null, '']));
    ok('RD-DH-WHEN instance delegate',
        JSON.stringify(TDI.whenOptions(TODAY)) === JSON.stringify(opts));

    ok('RD-DH-KEY none', TD.whenKeyForDue('', TODAY) === 'none');
    ok('RD-DH-KEY null', TD.whenKeyForDue(null, TODAY) === 'none');
    ok('RD-DH-KEY today', TD.whenKeyForDue('2026-11-09', TODAY) === 'today');
    ok('RD-DH-KEY tomorrow', TD.whenKeyForDue('2026-11-10', TODAY) === 'tomorrow');
    ok('RD-DH-KEY nextmon', TD.whenKeyForDue('2026-11-16', TODAY) === 'nextmon');
    ok('RD-DH-KEY pick', TD.whenKeyForDue('2026-11-20', TODAY) === 'pick');
    ok('RD-DH-KEY instance delegate', TDI.whenKeyForDue('2026-11-20', TODAY) === 'pick');

    ok('RD-DH-CAPTION nextmon', TD.whenCaption('nextmon', '2026-11-16') === 'Due Mon Nov 16');
    ok('RD-DH-CAPTION no zero pad', TD.whenCaption('today', '2026-12-03') === 'Due Thu Dec 3');
    ok('RD-DH-CAPTION tomorrow', TD.whenCaption('tomorrow', '2026-11-10') === 'Due Tue Nov 10');
    ok('RD-DH-CAPTION pick with date', TD.whenCaption('pick', '2026-11-20') === 'Due Fri Nov 20');
    ok('RD-DH-CAPTION none', TD.whenCaption('none', '') === 'No date: goes to the backlog');
    ok('RD-DH-CAPTION none owned', TD.whenCaption('none', '', true) === 'No date');
    ok('RD-DH-CAPTION owned ignored when dated', TD.whenCaption('today', '2026-12-03', true) === 'Due Thu Dec 3');
    ok('RD-DH-CAPTION owned instance delegate', TDI.whenCaption('none', '', true) === 'No date');
    ok('RD-DH-CAPTION owner detection', TD._ownedForCaption({ projectName: 'Alpha' }) === true
        && TD._ownedForCaption({ tripSlug: 'lisbon' }) === true
        && TD._ownedForCaption({ parentTask: '[[P]]' }) === true
        && TD._ownedForCaption({ source: 'meeting' }) === true
        && TD._ownedForCaption({ projectName: '', source: 'manual' }) === false);
    ok('RD-DH-CAPTION pick empty', TD.whenCaption('pick', null) === 'Pick a date');
    ok('RD-DH-CAPTION instance delegate', TDI.whenCaption('nextmon', '2026-11-16') === 'Due Mon Nov 16');

    const mk = (project, created) => ({ project, created_at: created });
    const fixture = [
        mk('[[Alpha]]', '2026-11-08T10:00:00Z'),
        mk('[[Alpha]]', '2026-11-01'),
        mk('[[Beta]]', '2026-11-07'),
        mk('[[Beta]]', '2026-10-20'),
        mk('[[Gamma]]', '2026-11-09'),
        mk('[[Delta|The Delta]]', '2026-11-05'),
        mk('[[Old]]', '2026-09-29'),
        mk('[[Old]]', '2026-09-30'),
        mk('[[Edge]]', '2026-10-11'),
        mk('[[TooOld]]', '2026-10-10'),
        mk(null, '2026-11-08'),
        mk('[[Bad]]', 'not-a-date'),
        mk('[[Missing]]', null),
    ];
    ok('RD-DH-RECENT order and window',
        JSON.stringify(TD.recentProjects(fixture, TODAY)) === JSON.stringify(['Alpha', 'Beta', 'Gamma', 'Delta', 'Edge']),
        JSON.stringify(TD.recentProjects(fixture, TODAY)));
    ok('RD-DH-RECENT limit', JSON.stringify(TD.recentProjects(fixture, TODAY, 2)) === JSON.stringify(['Alpha', 'Beta']));
    ok('RD-DH-RECENT empty', TD.recentProjects([], TODAY).length === 0 && TD.recentProjects(null, TODAY).length === 0);
    ok('RD-DH-RECENT instance delegate',
        JSON.stringify(TDI.recentProjects(fixture, TODAY, 1)) === JSON.stringify(['Alpha']));

    ok('RD-DH-HOME same as daily',
        JSON.stringify(TD.defaultsForSurface({ surface: 'home', today: TODAY }))
        === JSON.stringify({ source: 'daily' })
        && JSON.stringify(TD.defaultsForSurface({ surface: 'home', today: TODAY }))
        === JSON.stringify(TD.defaultsForSurface({ surface: 'daily', today: TODAY })));
})();

// --- RD-D-*: two-column task dialog (TaskDialog._render, create + edit) ---
// Drives the REAL TaskDialog renderer against the REAL SauceModal and the REAL
// TaskEntity, on a small tree DOM stub. Each case gets its own class instance
// (fresh `new Function` load) so window/document/localStorage never leak.
(function () {
    const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
    const tdSrc = read('mechanisms/task-entity/task-dialog.js');
    // eslint-disable-next-line no-new-func
    const SauceModalCls = new Function(read('mechanisms/modal/sauce-modal.js') + '; return SauceModal;')();
    // eslint-disable-next-line no-new-func
    const TaskEntityCls = new Function(read('mechanisms/task-entity/task-entity.js') + '; return TaskEntity;')();
    const TODAY = '2026-11-09';
    const DAY = 86400000;
    const TODAY_MS = Date.UTC(2026, 10, 9);

    function rdNode(tag) {
        const n = {
            tagName: String(tag || 'div').toUpperCase(),
            style: {}, attributes: {}, children: [], parentNode: null, _listeners: {},
            className: '', id: '', type: '', value: '', checked: false, disabled: false, placeholder: '',
            _text: '', _focus: 0,
            get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
            set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
            set innerHTML(v) { this._html = String(v); },
            get innerHTML() { return this._html || ''; },
            createEl(t, o) {
                const c = rdNode(t);
                if (o && o.cls) c.className = String(o.cls);
                if (o && o.text != null) c.textContent = o.text;
                if (o && o.type) c.type = String(o.type);
                return this.appendChild(c);
            },
            createDiv(o) { return this.createEl('div', o); },
            createSpan(o) { return this.createEl('span', o); },
            appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
            insertBefore(c, ref) {
                c.parentNode = this;
                const i = this.children.indexOf(ref);
                if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
                return c;
            },
            removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
            remove() { if (this.parentNode) this.parentNode.removeChild(this); },
            empty() { this.children = []; },
            setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); },
            getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
            addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
            removeEventListener(t, fn) { const l = this._listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
            contains(x) { if (x === this) return true; return this.children.some((c) => c.contains(x)); },
            focus() { this._focus++; },
            querySelector() { return null; },
        };
        n.classList = {
            add(...names) {
                const cur = String(n.className || '').split(/\s+/).filter(Boolean);
                for (const nm of names) if (!cur.includes(nm)) cur.push(nm);
                n.className = cur.join(' ');
            },
            contains(nm) { return String(n.className || '').split(/\s+/).includes(nm); },
        };
        return n;
    }
    function rdDoc() {
        const listeners = [];
        return {
            body: rdNode('body'),
            head: rdNode('head'),
            createElement: (t) => rdNode(t),
            addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
            removeEventListener(type, fn, capture) {
                const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
                if (i >= 0) listeners.splice(i, 1);
            },
            dispatch(type, ev) { for (const l of listeners.slice()) if (l.type === type) l.fn(ev); },
            listenerCount(type) { return listeners.filter((l) => l.type === type).length; },
        };
    }
    const hasCls = (node, cls) => String((node && node.className) || '').split(/\s+/).includes(cls);
    const all = (root, pred, acc) => {
        acc = acc || [];
        for (const c of (root && root.children) || []) { if (pred(c)) acc.push(c); all(c, pred, acc); }
        return acc;
    };
    const byCls = (root, cls) => all(root, (n) => hasCls(n, cls))[0] || null;
    const allByCls = (root, cls) => all(root, (n) => hasCls(n, cls));
    const selected = (n) => !!n && n.getAttribute('aria-pressed') === 'true' && hasCls(n, 'is-selected');
    const tick = () => new Promise((r) => setImmediate(r));
    const click = (el) => el.onclick({ target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} });

    function rdEnv(o) {
        o = o || {};
        const doc = rdDoc();
        const store = Object.assign({}, o.storage || {});
        const localStorage = o.storageThrows ? {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
        } : {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
        };
        const fmByPath = {};
        const files = [];
        const addFile = (p, fm, ctime) => {
            const f = { path: p, basename: p.replace(/^.*\//, '').replace(/\.md$/, ''), stat: { ctime: ctime == null ? TODAY_MS : ctime, mtime: ctime == null ? TODAY_MS : ctime } };
            fmByPath[p] = fm;
            files.push(f);
            return f;
        };
        for (const name of (o.projects || ['Alpha', 'Beta', 'Gamma'])) {
            addFile('spice/projects/' + name.toLowerCase() + '/' + name + '.md', { type: 'project', name });
        }
        for (const t of (o.tasks || [])) addFile(t.path, Object.assign({ type: 'task' }, t.fm), t.ctime);
        const editFile = o.editFm ? addFile('spice/tasks/Edit me.md', Object.assign({ type: 'task' }, o.editFm)) : null;
        const opened = [];
        const fmWrites = [];
        const bodyWrites = [];
        const fileText = o.fileText || '---\n---\n<!-- TASK_NOTES -->\n';
        const app = {
            isMobile: !!o.isMobile,
            vault: {
                getAbstractFileByPath: (p) => files.find((f) => f.path === p) || null,
                getMarkdownFiles: () => files.slice(),
                read: async () => fileText,
                process: async (_f, fn) => { const out = fn(fileText); bodyWrites.push(out); return out; },
            },
            metadataCache: { getFileCache: (f) => (f && fmByPath[f.path] ? { frontmatter: fmByPath[f.path] } : null) },
            workspace: { getLeaf: () => ({ openFile: async (f) => { opened.push(f); } }) },
            fileManager: {
                processFrontMatter: async (f, fn) => {
                    const fm = Object.assign({}, fmByPath[f.path]);
                    fn(fm);
                    fmWrites.push(fm);
                },
            },
        };
        const customJS = {
            SauceModal: new SauceModalCls(),
            TaskEntity: new TaskEntityCls(),
            RecurrenceParser: { describe: o.describe || (() => null) },
        };
        const win = { app, customJS, localStorage, moment: () => ({ format: () => TODAY }) };
        const glob = { app, customJS };
        // eslint-disable-next-line no-new-func
        const TD = new Function('window', 'document', 'globalThis', 'Notice', 'setTimeout', 'navigator',
            tdSrc + '; return TaskDialog;')(win, doc, glob, function () {}, (fn) => { fn(); return 0; }, { platform: 'MacIntel' });
        const dlg = new TD();
        const creates = [];
        dlg._create = async (_app, payload, notes) => {
            creates.push({ payload, notes });
            if (o.createFails) return undefined;
            const p = 'spice/tasks/' + payload.title + '.md';
            return { ok: true, path: p, file: { path: p } };
        };
        const env = {
            TD, dlg, doc, app, store, creates, opened, fmWrites, bodyWrites, fileText, editFile,
            open(opts) { dlg.open(opts); return env; },
            modal: () => byCls(doc.body, 'sauce-modal'),
            body: () => byCls(doc.body, 'sauce-modal-body'),
            footer: () => byCls(doc.body, 'sauce-modal-footer'),
            title: () => byCls(doc.body, 'sauce-task-title'),
            notes: () => byCls(doc.body, 'sauce-task-notes'),
            when: (k) => allByCls(doc.body, 'sauce-task-when').find((b) => b.getAttribute('data-key') === k) || null,
            prio: (v) => allByCls(doc.body, 'sauce-task-prio').find((b) => b.getAttribute('data-prio') === v) || null,
            chip: (name) => allByCls(doc.body, 'sauce-task-project-chip').find((b) => b.textContent === name) || null,
            save: () => byCls(doc.body, 'sauce-task-save'),
            typeTitle(v) { const t = env.title(); t.value = v; t.oninput(); },
            key(ev) { doc.dispatch('keydown', Object.assign({ preventDefault() {}, isComposing: false }, ev)); },
        };
        return env;
    }

    const cases = [];
    const rdCase = (name, fn) => cases.push(async () => {
        try { await fn(); ok(name, true); }
        catch (e) { ok(name, false, e && e.message); }
    });
    const must = (cond, msg) => { if (!cond) throw new Error(msg); };

    rdCase('RD-D-COLS two columns in the body, footer outside the scrolling body', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        const cols = byCls(env.body(), 'sauce-task-dialog-cols');
        must(cols, 'no .sauce-task-dialog-cols');
        must(cols.children.length === 2, 'cols children: ' + cols.children.length);
        must(hasCls(cols.children[0], 'sauce-task-dialog-left') && hasCls(cols.children[1], 'sauce-task-dialog-right'), 'left/right order');
        must(env.title() && cols.children[0].contains(env.title()), 'title in left column');
        must(env.notes() && cols.children[0].contains(env.notes()), 'notes in left column');
        for (const c of ['sauce-task-when', 'sauce-task-prio', 'sauce-task-project-search', 'sauce-task-repeat-toggle']) {
            must(byCls(cols.children[1], c), c + ' in right column');
        }
        must(!byCls(env.body(), 'sauce-task-save') && byCls(env.footer(), 'sauce-task-save'), 'save lives in the footer, not the body');
        must(byCls(env.footer(), 'sauce-task-open-after') && byCls(env.footer(), 'sauce-task-add-another'), 'footer controls');
        must(hasCls(env.modal(), 'sauce-task-dialog'), 'modal tagged sauce-task-dialog');
        const heading = byCls(env.modal(), 'sauce-modal-title');
        must(heading && heading.textContent === 'New task', 'heading: ' + (heading && heading.textContent));
        must(byCls(env.modal(), 'sauce-task-dialog-close'), 'header close button');
        const quiet = all(cols.children[0], (n) => n.tagName === 'BUTTON').map((b) => b.textContent);
        must(quiet.includes('＋ Link note') && quiet.includes('＋ Web link') && quiet.includes('Subtask of…'), 'quiet buttons: ' + JSON.stringify(quiet));
    });

    rdCase('RD-D-WHEN-DEFAULT daily/home select No date; manual-with-today selects Today; project selects No date', async () => {
        for (const opts of [{ surface: 'daily', today: TODAY }, { surface: 'home', today: TODAY }, { surface: 'daily' }]) {
            const env = rdEnv().open(opts);
            must(selected(env.when('none')), opts.surface + ': No date selected');
            must(allByCls(env.doc.body, 'sauce-task-when').filter(selected).length === 1, opts.surface + ': exactly one selected');
            const cap = byCls(env.doc.body, 'sauce-task-when-caption');
            must(cap && cap.textContent === 'No date: goes to the backlog', 'caption: ' + (cap && cap.textContent));
        }
        const manual = rdEnv().open({ surface: 'manual', today: TODAY });
        must(selected(manual.when('today')), 'manual with an explicit today: today selected');
        must(byCls(manual.doc.body, 'sauce-task-when-caption').textContent === 'Due Mon Nov 9', 'manual caption');
        const env = rdEnv().open({ surface: 'project', project: { name: 'Alpha', slug: 'alpha' } });
        must(selected(env.when('none')), 'project: none selected');
        must(byCls(env.doc.body, 'sauce-task-when-caption').textContent === 'No date', 'project task: none caption is just No date');
        must(selected(env.chip('Alpha')), 'project surface seeds the Alpha chip');
    });

    rdCase('RD-D-WHEN-DEFAULT-CREATE a daily/home task created without touching When has no due', async () => {
        for (const surface of ['daily', 'home']) {
            const env = rdEnv().open({ surface, today: TODAY });
            env.typeTitle('Undated');
            await click(env.save());
            await tick();
            must(env.creates.length === 1, surface + ': one create');
            must(!env.creates[0].payload.due, surface + ': payload due empty: ' + JSON.stringify(env.creates[0].payload.due));
        }
    });

    rdCase('RD-D-WHEN-PICK quick dates and Pick date… set the payload due', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        click(env.when('nextmon'));
        must(selected(env.when('nextmon')) && !selected(env.when('today')), 'nextmon selected');
        env.typeTitle('Plan');
        await click(env.save());
        await tick();
        must(env.creates.length === 1 && env.creates[0].payload.due === '2026-11-16', 'due: ' + JSON.stringify(env.creates[0] && env.creates[0].payload.due));

        const env2 = rdEnv().open({ surface: 'daily', today: TODAY });
        const date = byCls(env2.doc.body, 'sauce-task-when-date');
        must(date && date.type === 'date' && date.style.display === 'none', 'date input hidden until Pick');
        click(env2.when('pick'));
        must(date.style.display !== 'none' && selected(env2.when('pick')), 'Pick reveals the inline date input');
        date.value = '2026-11-20';
        date.onchange();
        must(byCls(env2.doc.body, 'sauce-task-when-caption').textContent === 'Due Fri Nov 20', 'pick caption');
        click(env2.when('none'));
        must(date.style.display === 'none', 'leaving Pick hides the date input');
        click(env2.when('pick'));
        date.value = '2026-11-20';
        date.onchange();
        env2.typeTitle('Picked');
        await click(env2.save());
        await tick();
        must(env2.creates[0].payload.due === '2026-11-20', 'picked due: ' + env2.creates[0].payload.due);
    });

    rdCase('RD-D-PRIO-KEY keys 0-4 set priority outside text fields only', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        must(selected(env.prio('none')), 'none selected by default');
        env.key({ key: '3', target: env.body() });
        must(selected(env.prio('high')) && !selected(env.prio('none')), '3 → high');
        env.key({ key: '1', target: env.title() });
        must(selected(env.prio('high')), 'digit typed in the title does not change priority');
        env.key({ key: '2', target: env.notes() });
        must(selected(env.prio('high')), 'digit typed in the notes does not change priority');
        env.key({ key: '4', target: env.prio('low') });
        must(selected(env.prio('highest')), '4 on a focused button → highest');
        env.key({ key: '0', target: env.body() });
        must(selected(env.prio('none')), '0 → none');
        env.key({ key: '3', target: env.body() });
        env.typeTitle('Prio');
        await click(env.save());
        await tick();
        must(env.creates[0].payload.priority === 'high', 'payload priority: ' + env.creates[0].payload.priority);
        must(env.doc.listenerCount('keydown') === 0, 'dialog key listeners detached on close');
    });

    rdCase('RD-D-SHORTCUT title shortcuts fill the right column and are stripped on submit', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        env.typeTitle('X next mon !high #Alpha');
        must(selected(env.when('nextmon')), 'when → nextmon');
        must(selected(env.prio('high')), 'priority → high');
        must(selected(env.chip('Alpha')), 'project chip Alpha selected');
        click(env.prio('low'));
        env.typeTitle('X next mon !high #Alpha ');
        must(selected(env.prio('low')), 'a later click overrides the unchanged shortcut');
        await click(env.save());
        await tick();
        const p = env.creates[0].payload;
        must(p.title === 'X', 'stripped title: ' + JSON.stringify(p.title));
        must(p.due === '2026-11-16' && p.priority === 'low' && p.project && p.project.name === 'Alpha', 'payload: ' + JSON.stringify(p));

        const env2 = rdEnv().open({ surface: 'daily', today: TODAY });
        env2.typeTitle('Y tomorrow');
        must(selected(env2.when('tomorrow')), 'tomorrow token applied');
        env2.typeTitle('Y tomorro');
        must(selected(env2.when('none')), 'removing the token restores the prior When (No date)');
    });

    rdCase('RD-D-ADD-ANOTHER saves, clears title + notes, keeps When/Priority/Project', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        const search = byCls(env.doc.body, 'sauce-task-project-search');
        search.value = 'alp';
        search.oninput();
        must(env.chip('Alpha'), 'search shows Alpha');
        click(env.chip('Alpha'));
        click(env.when('tomorrow'));
        click(env.prio('medium'));
        env.typeTitle('First');
        env.notes().value = 'first notes';
        env.notes().oninput();
        const another = byCls(env.footer(), 'sauce-task-add-another');
        const focusBefore = env.title()._focus;
        await click(another);
        await tick();
        must(env.creates.length === 1 && env.creates[0].payload.title === 'First' && env.creates[0].notes === 'first notes', 'first create');
        must(env.title().value === '' && env.notes().value === '', 'title + notes cleared');
        must(env.title()._focus > focusBefore, 'title refocused');
        must(env.doc.body.children.length === 1, 'dialog stays open');
        must(env.save().disabled && another.disabled, 'buttons disabled until a new title');
        env.typeTitle('Second');
        await click(another);
        await tick();
        const p = env.creates[1] && env.creates[1].payload;
        must(p && p.title === 'Second' && p.project && p.project.name === 'Alpha' && p.due === '2026-11-10' && p.priority === 'medium',
            'second keeps fields: ' + JSON.stringify(p));
        must(env.creates[1].notes === '', 'second notes empty');
        must(env.opened.length === 0, 'add-another never opens the note');
    });

    rdCase('RD-D-OPEN-AFTER preference gates opening the created note', async () => {
        const on = rdEnv().open({ surface: 'daily', today: TODAY });
        const cb = byCls(on.footer(), 'sauce-task-open-after');
        must(cb && cb.type === 'checkbox' && cb.checked === true, 'default on');
        on.typeTitle('Open me');
        await click(on.save());
        await tick();
        must(on.opened.length === 1 && on.opened[0].path === 'spice/tasks/Open me.md', 'opened: ' + JSON.stringify(on.opened));
        must(on.doc.body.children.length === 0, 'dialog closed');

        const off = rdEnv({ storage: { 'sauce-task-dialog:open-after': '0' } }).open({ surface: 'daily', today: TODAY });
        must(byCls(off.footer(), 'sauce-task-open-after').checked === false, 'pref 0 → unchecked');
        off.typeTitle('Stay here');
        await click(off.save());
        await tick();
        must(off.creates.length === 1 && off.opened.length === 0, 'no open call');

        const toggle = rdEnv().open({ surface: 'daily', today: TODAY });
        const tcb = byCls(toggle.footer(), 'sauce-task-open-after');
        tcb.checked = false;
        tcb.onchange();
        must(toggle.store['sauce-task-dialog:open-after'] === '0', 'unchecking persists 0');
        tcb.checked = true;
        tcb.onchange();
        must(toggle.store['sauce-task-dialog:open-after'] === '1', 'checking persists 1');

        const broken = rdEnv({ storageThrows: true }).open({ surface: 'daily', today: TODAY });
        const bcb = byCls(broken.footer(), 'sauce-task-open-after');
        must(bcb && bcb.checked === true, 'throwing storage → on');
        bcb.checked = false;
        bcb.onchange();
    });

    rdCase('RD-D-CMDENTER ⌘↵ / Ctrl↵ submit from anywhere, plain Enter in notes does not', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        env.typeTitle('Cmd');
        env.key({ key: 'Enter', target: env.notes() });
        await tick();
        must(env.creates.length === 0, 'plain Enter in notes does not submit');
        env.key({ key: 'Enter', metaKey: true, target: env.notes() });
        await tick();
        must(env.creates.length === 1 && env.creates[0].payload.title === 'Cmd', '⌘↵ in notes submits');

        const env2 = rdEnv().open({ surface: 'daily', today: TODAY });
        env2.typeTitle('Ctrl');
        env2.key({ key: 'Enter', ctrlKey: true, target: env2.prio('high') });
        await tick();
        must(env2.creates.length === 1, 'Ctrl↵ on a right-column button submits');

        const env3 = rdEnv().open({ surface: 'daily', today: TODAY });
        const kbd = byCls(env3.footer(), 'sauce-task-kbd');
        must(kbd && kbd.textContent === '⌘↵' && env3.save().contains(kbd), 'primary carries the ⌘↵ hint');
        env3.typeTitle('Plain');
        env3.key({ key: 'Enter', target: env3.title() });
        await tick();
        must(env3.creates.length === 1 && env3.creates[0].payload.title === 'Plain', 'plain Enter in the title still submits');
    });

    rdCase('RD-D-EDIT-HYDRATE edit selects Pick with the date, keeps Open/Done/Delete, due change clears rank', async () => {
        const env = rdEnv({ editFm: { title: 'Edit me', due: '2026-11-20', status: 'open', priority: 'high', rank: 3, links: [] } });
        env.open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        must(selected(env.when('pick')), 'pick selected');
        const date = byCls(env.doc.body, 'sauce-task-when-date');
        must(date.value === '2026-11-20' && date.style.display !== 'none', 'date input shows the due');
        must(selected(env.prio('high')), 'priority hydrated');
        must(env.title().value === 'Edit me' && env.title()._focus === 0, 'title hydrated, not focused');
        must(byCls(env.modal(), 'sauce-modal-title').textContent === 'Edit task', 'edit heading');
        const labels = all(env.footer(), (n) => n.tagName === 'BUTTON').map((b) => b.textContent);
        for (const l of ['Open', 'Done', 'Delete']) must(labels.includes(l), 'footer has ' + l + ': ' + JSON.stringify(labels));
        must(!byCls(env.footer(), 'sauce-task-add-another') && !byCls(env.footer(), 'sauce-task-open-after'), 'no create-only controls');
        click(env.when('tomorrow'));
        await click(env.save());
        await tick();
        const fm = env.fmWrites[0];
        must(fm && fm.due === '2026-11-10' && fm.rank === '', 'fm write: ' + JSON.stringify(fm));
        must(env.doc.body.children.length === 0, 'edit save closes');

        const same = rdEnv({ editFm: { title: 'Edit me', due: '2026-11-20', status: 'open', rank: 3, links: [] } });
        same.open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        same.typeTitle('Edit me next mon');
        await click(same.save());
        await tick();
        must(same.fmWrites[0].title === 'Edit me next mon' && same.fmWrites[0].rank === 3, 'edit mode keeps the typed title and rank: ' + JSON.stringify(same.fmWrites[0]));
        must(!Object.prototype.hasOwnProperty.call(same.fmWrites[0], 'parent_task'), 'unchanged empty parent adds no key');
    });

    rdCase('RD-D-REPEAT Repeats collapses to one button; edit with a recurrence starts expanded', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        const toggle = byCls(env.doc.body, 'sauce-task-repeat-toggle');
        must(toggle && toggle.textContent === "Doesn't repeat ▾", 'toggle text: ' + (toggle && toggle.textContent));
        const box = byCls(env.doc.body, 'sauce-task-repeat-box');
        must(box && box.style.display === 'none' && toggle.getAttribute('aria-expanded') === 'false', 'create starts collapsed');
        click(toggle);
        must(box.style.display !== 'none' && toggle.getAttribute('aria-expanded') === 'true', 'expands in place');

        const edit = rdEnv({
            editFm: { title: 'Edit me', due: '', status: 'open', recurrence: 'every day', links: [] },
            describe: (g) => (g === 'every day' ? { kind: 'daily' } : null),
        }).open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        must(byCls(edit.doc.body, 'sauce-task-repeat-box').style.display !== 'none', 'edit with recurrence starts expanded');
        must(/^Every day/.test(byCls(edit.doc.body, 'sauce-task-repeat-toggle').textContent), 'toggle shows the rule');
    });

    rdCase('RD-D-PROJECT recent chips, search filter (max 8), chip toggle', async () => {
        const many = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Area One', 'Area Two', 'Area Three', 'Area Four', 'Area Five', 'Area Six', 'Zed'];
        const env = rdEnv({
            projects: many,
            tasks: [
                { path: 'spice/tasks/a.md', fm: { project: '[[Beta]]', created_at: '2026-11-08T10:00:00Z' } },
                { path: 'spice/tasks/b.md', fm: { project: '[[Beta]]', created_at: '2026-11-07' } },
                { path: 'spice/tasks/_done/c.md', fm: { project: '[[Gamma]]', created_at: '2026-11-06', status: 'done' } },
                { path: 'spice/tasks/old.md', fm: { project: '[[Zed]]', created_at: '2026-11-08' }, ctime: TODAY_MS - 60 * DAY },
                { path: 'spice/other/x.md', fm: { project: '[[Zed]]', created_at: '2026-11-08' } },
            ],
        }).open({ surface: 'daily', today: TODAY });
        const names = () => allByCls(env.doc.body, 'sauce-task-project-chip').map((c) => c.textContent);
        must(JSON.stringify(names()) === JSON.stringify(['Beta', 'Gamma']), 'recent chips: ' + JSON.stringify(names()));
        must(all(env.doc.body, (n) => n.textContent === 'Your most-used projects, most recent first').length > 0, 'recent caption');
        const search = byCls(env.doc.body, 'sauce-task-project-search');
        search.value = 'A';
        search.oninput();
        const hits = names();
        must(hits.length === 8 && hits.every((n) => n.toLowerCase().includes('a')), 'search hits: ' + JSON.stringify(hits));
        search.value = 'zE';
        search.oninput();
        must(JSON.stringify(names()) === JSON.stringify(['Zed']), 'case-insensitive: ' + JSON.stringify(names()));
        click(env.chip('Zed'));
        must(search.value === '' && selected(env.chip('Zed')), 'picking clears search and shows the selected chip');
        click(env.chip('Zed'));
        must(!env.chip('Zed') || !selected(env.chip('Zed')), 'clicking the selected chip clears it');
        env.typeTitle('No project');
        await click(env.save());
        await tick();
        must(env.creates[0].payload.project === undefined, 'cleared project not in payload');
        must(JSON.stringify(env.dlg.projectMatches(['Ab', 'b', 'xAB'], 'ab', 1)) === '["Ab"]'
            && env.dlg.projectMatches(['Ab'], '  ').length === 0, 'projectMatches delegate, limit, blank query');
        must(env.dlg._recentTaskRows(null, TODAY).length === 0 && env.dlg._recentTaskRows(env.app, 'junk').length === 0,
            'recent rows empty on failure');
    });

    rdCase('RD-D-NARROW injected CSS stacks the columns below 720px', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        const css = env.TD._DIALOG_CSS;
        must(typeof css === 'string', 'static _DIALOG_CSS');
        const at = css.indexOf('@media (max-width: 720px)');
        must(at >= 0, 'has the 720px media query');
        const block = css.slice(at, css.indexOf('}\n}', at) + 3);
        // minmax(0, 1fr), not 1fr: a bare 1fr track sizes to its widest
        // child's min-content (a long link chip), pushing the sheet off a phone.
        must(/\.sauce-task-dialog-cols\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/.test(block), 'stacks the columns: ' + block);
        const style = env.doc.head.children.find((c) => c.id === 'sauce-task-dialog-css');
        must(style && style.textContent === css, 'style injected into head');
        must(env.dlg._DIALOG_CSS === css, 'instance getter delegates');
        rdEnv().open({ surface: 'daily', today: TODAY });
        env.dlg.open({ surface: 'daily', today: TODAY });
        must(env.doc.head.children.filter((c) => c.id === 'sauce-task-dialog-css').length === 1, 'injected once per document');
    });

    rdCase('RD-D-SUBTASK Subtask of… picks an open task as parent_task', async () => {
        const env = rdEnv({
            tasks: [
                { path: 'spice/tasks/Parent one.md', fm: { title: 'Parent one', status: 'open' } },
                { path: 'spice/tasks/_done/Finished.md', fm: { title: 'Finished', status: 'done' } },
            ],
        }).open({ surface: 'daily', today: TODAY });
        const btn = all(env.doc.body, (n) => n.tagName === 'BUTTON' && n.textContent === 'Subtask of…')[0];
        click(btn);
        const rows = allByCls(env.doc.body, 'sauce-task-parent-option');
        must(rows.length === 1 && rows[0].textContent === 'Parent one', 'candidates: ' + rows.map((r) => r.textContent));
        rows[0].onclick();
        must(byCls(env.doc.body, 'sauce-task-parent').textContent.includes('Parent one'), 'parent chip shown');
        env.typeTitle('Child');
        await click(env.save());
        await tick();
        must(env.creates[0].payload.parent_task === '[[Parent one]]', 'parent_task: ' + env.creates[0].payload.parent_task);
    });

    rdCase('RD-D-CREATE-FAIL a create that yields nothing keeps the dialog and its contents', async () => {
        for (const which of ['sauce-task-add-another', 'sauce-task-save']) {
            const env = rdEnv({ createFails: true }).open({ surface: 'daily', today: TODAY });
            env.typeTitle('Keep me');
            env.notes().value = 'kept notes';
            env.notes().oninput();
            click(all(env.doc.body, (n) => n.tagName === 'BUTTON' && n.textContent === '＋ Web link')[0]);
            const url = all(env.doc.body, (n) => n.tagName === 'INPUT' && n.placeholder === 'https://…')[0];
            url.value = 'https://example.test/a';
            click(all(env.doc.body, (n) => n.tagName === 'BUTTON' && n.textContent === 'Add link')[0]);
            await click(byCls(env.footer(), which));
            await tick();
            must(env.creates.length === 1, which + ': create attempted');
            must(env.doc.body.children.length === 1, which + ': dialog still open');
            must(env.title().value === 'Keep me' && env.notes().value === 'kept notes', which + ': title + notes intact');
            const chips = allByCls(env.doc.body, 'sauce-task-link-chip').map((c) => c.textContent);
            must(chips.length === 1 && chips[0].includes('<https://example.test/a>'), which + ': links intact ' + JSON.stringify(chips));
            must(env.opened.length === 0, which + ': nothing opened');
            await click(env.save());
            await tick();
            must(env.creates.length === 2 && env.creates[1].payload.links[0] === '<https://example.test/a>', which + ': retry carries the same link');
        }
    });

    rdCase('RD-D-EDIT-ROUNDTRIP saving an unchanged edit writes the frontmatter back unchanged', async () => {
        const input = {
            type: 'task', title: 'Edit me', status: 'open', due: '2026-11-20', recurrence: 'every day',
            priority: 'high', project: '[[Alpha]]', project_slug: 'alpha', trip: '', trip_slug: '',
            source: 'manual', source_note: '', parent_task: '[[P]]', links: ['[[A]]', '[b](https://example.test/b)'],
            rank: 3, created_at: '2026-11-01T09:00:00Z', completed_at: '',
        };
        const fileText = '---\ntitle: Edit me\n---\n\n<!-- TASK_NOTES -->\nSome notes\nline two\n';
        const env = rdEnv({
            editFm: Object.assign({}, input),
            fileText,
            describe: (g) => (g === 'every day' ? { kind: 'daily' } : null),
        }).open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        await tick();
        must(env.notes().value === 'Some notes\nline two', 'notes hydrated: ' + JSON.stringify(env.notes().value));
        must(byCls(env.doc.body, 'sauce-task-parent').textContent.includes('P'), 'parent shown');
        await click(env.save());
        await tick();
        must(JSON.stringify(env.fmWrites[0]) === JSON.stringify(input),
            'fm round-trip:\n  got  ' + JSON.stringify(env.fmWrites[0]) + '\n  want ' + JSON.stringify(input));
        must(env.bodyWrites.length === 1 && env.bodyWrites[0] === fileText, 'body round-trip: ' + JSON.stringify(env.bodyWrites[0]));
    });

    rdCase('RD-D-CAPTION-OWNER the No date caption follows the chosen project live', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        click(env.when('none'));
        const cap = () => byCls(env.doc.body, 'sauce-task-when-caption').textContent;
        must(cap() === 'No date: goes to the backlog', 'personal: ' + cap());
        const search = byCls(env.doc.body, 'sauce-task-project-search');
        search.value = 'Alpha';
        search.oninput();
        click(env.chip('Alpha'));
        must(cap() === 'No date', 'with a project: ' + cap());
        click(env.chip('Alpha'));
        must(cap() === 'No date: goes to the backlog', 'project cleared: ' + cap());
    });

    rdCase('RD-D-NOTES-GUARD an edit saved before the notes read resolves leaves the body untouched', async () => {
        const fileText = '---\ntitle: Edit me\n---\n\n<!-- TASK_NOTES -->\nPrecious notes\n';
        const env = rdEnv({ editFm: { title: 'Edit me', due: '2026-11-20', status: 'open', links: [] }, fileText });
        let release = null;
        env.app.vault.read = () => new Promise((r) => { release = r; });
        env.open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        const notes = env.notes();
        must(notes.disabled === true && notes.placeholder === 'Loading notes\u2026', 'loading state: ' + notes.placeholder);
        notes.value = 'typed over the top';
        notes.oninput();
        env.typeTitle('Edit me renamed');
        await click(env.save());
        await tick();
        must(env.fmWrites.length === 1 && env.fmWrites[0].title === 'Edit me renamed', 'frontmatter still saved');
        must(env.bodyWrites.length === 0, 'no body write before the read resolved: ' + JSON.stringify(env.bodyWrites));
        release(fileText);
        await tick();
        must(env.bodyWrites.length === 0, 'a late read never writes either');

        const failing = rdEnv({ editFm: { title: 'Edit me', due: '', status: 'open', links: [] }, fileText });
        failing.app.vault.read = () => Promise.reject(new Error('EIO'));
        failing.open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        await tick();
        const n2 = failing.notes();
        must(n2.disabled === true && n2.placeholder === 'Notes could not be loaded', 'failed state: ' + n2.placeholder);
        failing.typeTitle('Still saves');
        await click(failing.save());
        await tick();
        must(failing.fmWrites.length === 1 && failing.fmWrites[0].title === 'Still saves', 'frontmatter saves after a failed read');
        must(failing.bodyWrites.length === 0, 'no body write after a failed read');

        const loaded = rdEnv({ editFm: { title: 'Edit me', due: '', status: 'open', links: [] }, fileText });
        loaded.open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        await tick();
        must(loaded.notes().disabled === false && loaded.notes().value === 'Precious notes', 'loaded: ' + loaded.notes().value);
        await click(loaded.save());
        await tick();
        must(loaded.bodyWrites.length === 1 && loaded.bodyWrites[0] === fileText, 'loaded save round-trips the body byte-identical');
    });

    rdCase('RD-D-RECENT-TRASH trashed tasks never feed the recent-project chips', async () => {
        const env = rdEnv({
            tasks: [
                { path: 'spice/tasks/a.md', fm: { project: '[[Beta]]', created_at: '2026-11-08' } },
                { path: 'spice/tasks/_trash/t1.md', fm: { project: '[[Gamma]]', created_at: '2026-11-08', status: 'deleted' } },
                { path: 'spice/tasks/_trash/t2.md', fm: { project: '[[Gamma]]', created_at: '2026-11-07', status: 'deleted' } },
            ],
        });
        const rows = env.dlg._recentTaskRows(env.app, TODAY);
        must(rows.length === 1 && rows[0].project === '[[Beta]]', 'rows: ' + JSON.stringify(rows));
        env.open({ surface: 'daily', today: TODAY });
        const names = allByCls(env.doc.body, 'sauce-task-project-chip').map((c) => c.textContent);
        must(JSON.stringify(names) === '["Beta"]', 'chips: ' + JSON.stringify(names));
    });

    rdCase('RD-D-PARENT-CYCLE editing excludes the task itself and its descendants from Subtask of…', async () => {
        const env = rdEnv({
            editFm: { title: 'Edit me', status: 'open', links: [] },
            tasks: [
                { path: 'spice/tasks/Child.md', fm: { title: 'Child', status: 'open', parent_task: '[[Edit me]]' } },
                { path: 'spice/tasks/Grandchild.md', fm: { title: 'Grandchild', status: 'open', parent_task: '[[spice/tasks/Child|kid]]' } },
                { path: 'spice/tasks/Loop A.md', fm: { title: 'Loop A', status: 'open', parent_task: '[[Loop B]]' } },
                { path: 'spice/tasks/Loop B.md', fm: { title: 'Loop B', status: 'open', parent_task: '[[Loop A]]' } },
                { path: 'spice/tasks/Sibling.md', fm: { title: 'Sibling', status: 'open', parent_task: '[[Other]]' } },
                { path: 'spice/tasks/_done/Done kid.md', fm: { title: 'Done kid', status: 'done', parent_task: '[[Edit me]]' } },
            ],
        });
        const names = env.dlg._parentCandidates(env.app, 'spice/tasks/Edit me.md').sort();
        must(JSON.stringify(names) === JSON.stringify(['Loop A', 'Loop B', 'Sibling']), 'candidates: ' + JSON.stringify(names));
        const createNames = env.dlg._parentCandidates(env.app, null).sort();
        must(JSON.stringify(createNames) === JSON.stringify(['Child', 'Edit me', 'Grandchild', 'Loop A', 'Loop B', 'Sibling']),
            'create mode lists every open task: ' + JSON.stringify(createNames));
        env.open({ edit: 'spice/tasks/Edit me.md', today: TODAY });
        click(all(env.doc.body, (n) => n.tagName === 'BUTTON' && n.textContent === 'Subtask of…')[0]);
        const rows = allByCls(env.doc.body, 'sauce-task-parent-option').map((r) => r.textContent).sort();
        must(JSON.stringify(rows) === JSON.stringify(['Loop A', 'Loop B', 'Sibling']), 'picker rows: ' + JSON.stringify(rows));
    });

    rdCase('RD-D-A11Y labelled title/notes; header close precedes the body', async () => {
        const env = rdEnv().open({ surface: 'daily', today: TODAY });
        must(env.title().getAttribute('aria-label') === 'Task title', 'title aria-label');
        must(env.notes().getAttribute('aria-label') === 'Notes', 'notes aria-label');
        const kids = env.modal().children;
        const closeAt = kids.findIndex((c) => hasCls(c, 'sauce-task-dialog-close'));
        const bodyAt = kids.findIndex((c) => hasCls(c, 'sauce-modal-body'));
        const titleAt = kids.findIndex((c) => hasCls(c, 'sauce-modal-title'));
        must(closeAt >= 0 && titleAt < closeAt && closeAt < bodyAt, 'order title/close/body: ' + [titleAt, closeAt, bodyAt]);
        must(kids[closeAt].getAttribute('aria-label') === 'Close', 'close labelled');
    });

    rdCase('RD-D-MOBILE-KBD no ⌘↵ hint on mobile; ⌘↵ still submits', async () => {
        const env = rdEnv({ isMobile: true }).open({ surface: 'daily', today: TODAY });
        must(!byCls(env.footer(), 'sauce-task-kbd'), 'no kbd hint on mobile');
        must(env.save().textContent === 'Create task', 'primary label: ' + env.save().textContent);
        env.typeTitle('Phone');
        env.key({ key: 'Enter', metaKey: true, target: env.notes() });
        await tick();
        must(env.creates.length === 1, 'hardware ⌘↵ on a tablet still works');
        must(env.dlg._submitKeyHint({ isMobile: true }) === '' && env.dlg._submitKeyHint({}) === '⌘↵', 'hint helper');
    });

    pendingAsync.push(cases.reduce((p, run) => p.then(run), Promise.resolve()));
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
