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

    // With a stub vault, returns { name, path } sorted by name, capped at 200.
    sharedWindow.app = {
        vault: {
            getMarkdownFiles: () => [
                { basename: 'Zebra', path: 'a/Zebra.md' },
                { basename: 'Acme', path: 'b/Acme.md' },
            ],
        },
    };
    const list = inst._loadNoteList();
    ok('DLG-20b _loadNoteList maps + sorts by name',
        list.length === 2 && list[0].name === 'Acme' && list[1].name === 'Zebra', `got ${JSON.stringify(list)}`);
    ok('DLG-20c _loadNoteList carries path', list[0].path === 'b/Acme.md', `got ${JSON.stringify(list[0])}`);
    sharedWindow.app = undefined;
})();

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
process.exit(0);
