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

const HELPER = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-create-task.js');

function loadClass() {
    const src = fs.readFileSync(HELPER, 'utf8');
    const stubs = `
        const window = { moment: undefined, customJS: undefined, app: undefined };
        const document = {};
        const app = {};
        const Notice = function () {};
        const console = { error: function () {} };
    `;
    // eslint-disable-next-line no-new-func
    const make = new Function(`${stubs}\n${src}\nreturn ToDoCreateTask;`);
    return make();
}

const ToDoCreateTask = loadClass();

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

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
process.exit(0);
