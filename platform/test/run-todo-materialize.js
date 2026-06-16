#!/usr/bin/env node
/**
 * run-todo-materialize — Node harness for ToDoDailyRecurring's pure-helper
 * static methods (parseRegistryLine, parseRegistry, materializeLineFromEntry,
 * matchesToday, insertRecurringIntoToday, sentinels, audit-log management).
 *
 *   REC-1..REC-3: parseRegistryLine extracts title/recurrence/project/priority
 *   REC-4..REC-5: materializeLineFromEntry strips recurrence + adds recurring_from + carries project
 *   REC-6: insertRecurringIntoToday inserts after the ToDoDailyRecurring dataviewjs block
 *   REC-7: appendAuditRow appends a row
 *   REC-8: trimAuditTable caps to maxRows
 *   REC-9: sentinel idempotency basis
 *   REC-10: parseRegistry skips lines outside ## Recurring Tasks section
 */

const fs = require('fs');
const path = require('path');

const HELPER = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-daily-recurring.js');

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
    const make = new Function(`${stubs}\n${src}\nreturn ToDoDailyRecurring;`);
    return make();
}

const ToDoDailyRecurring = loadClass();

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok  ${label}`); pass++; }
    else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

console.log('run-todo-materialize:');

// --- REC-1..REC-3: parseRegistryLine extracts fields ---
(() => {
    const line = '- [ ] Take out trash [recurrence:: every Wednesday] [priority:: medium]';
    const e = ToDoDailyRecurring.parseRegistryLine(line);
    ok('REC-1 title extracted', e && e.title === 'Take out trash', `got ${JSON.stringify(e)}`);
    ok('REC-2 recurrence extracted', e && e.recurrence === 'every Wednesday');
    ok('REC-3 priority extracted', e && e.priority === 'medium');
})();

// --- REC-4: parseRegistryLine with project link ---
(() => {
    const line = '- [ ] Standup [recurrence:: every weekday] [project:: [[Headspace]]]';
    const e = ToDoDailyRecurring.parseRegistryLine(line);
    ok('REC-4 title extracted', e && e.title === 'Standup');
    ok('REC-4a project extracted', e && e.project === 'Headspace', `got ${e && e.project}`);
})();

// --- REC-5: materializeLineFromEntry strips recurrence + adds recurring_from + carries project ---
(() => {
    const entry = { title: 'Standup', recurrence: 'every weekday', project: 'Headspace', priority: 'high' };
    const out = ToDoDailyRecurring.materializeLineFromEntry(entry);
    ok('REC-5 materialized contains title', out.includes('Standup'));
    ok('REC-5a strips [recurrence::]', !out.includes('[recurrence::'));
    ok('REC-5b adds [recurring_from::]', out.includes('[recurring_from:: [[Recurring Tasks]]]'));
    ok('REC-5c carries [project::]', out.includes('[project:: [[Headspace]]]'));
    ok('REC-5d carries [priority::]', out.includes('[priority:: high]'));
})();

// --- REC-6: insertRecurringIntoToday inserts after dv block ---
(() => {
    const today = [
        '---', 'type: to-do', '---', '',
        '## Today\'s Capture', '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });',
        '```', '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyRecurring" });',
        '```', '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups" });',
        '```', '',
    ].join('\n');
    const lines = [
        '- [ ] Take out trash [recurring_from:: [[Recurring Tasks]]]',
        '- [ ] Standup [recurring_from:: [[Recurring Tasks]]] [project:: [[Headspace]]]',
    ];
    const out = ToDoDailyRecurring.insertRecurringIntoToday(today, lines);
    // v0.5.0: SectionLabel dataviewjs block carries the heading (no raw `## Recurring Today`).
    const recLabelRe = /SectionLabel[\s\S]*?Recurring Today/;
    const labelIdx = out.search(recLabelRe);
    const recDvIdx = out.indexOf('class: "ToDoDailyRecurring"');
    const projDvIdx = out.indexOf('class: "ToDoDailyProjectGroups"');
    ok('REC-6 SectionLabel block present', labelIdx > -1, `out:\n${out}`);
    ok('REC-6a SectionLabel after ToDoDailyRecurring block', labelIdx > recDvIdx);
    ok('REC-6b SectionLabel before ToDoDailyProjectGroups block', labelIdx < projDvIdx);
    ok('REC-6c NO raw ## Recurring Today heading', !out.includes('## Recurring Today'));
    ok('REC-6d both task lines included', out.includes('Take out trash') && out.includes('Standup'));
})();

// --- REC-7: appendAuditRow appends a row ---
(() => {
    const reg = [
        '---', 'type: to-do-recurring', '---', '',
        '## Recurring Tasks', '',
        '- [ ] Trash [recurrence:: every Wednesday]', '',
        '## Last 7 days of materialization', '',
        '| Date | Title | Routed to |',
        '| --- | --- | --- |',
        '',
    ].join('\n');
    const updated = ToDoDailyRecurring.appendAuditRow(reg, { date: '2026-06-15', title: 'Trash', route: 'ToDo-2026-06-15.md' });
    ok('REC-7 audit row appended', updated.includes('| 2026-06-15 | Trash | ToDo-2026-06-15.md |'),
        'updated:\n' + updated);
})();

// --- REC-8: trimAuditTable caps to maxRows ---
(() => {
    const rows = [];
    for (let i = 1; i <= 60; i++) rows.push(`| 2026-04-${String(i).padStart(2, '0')} | T${i} | ok |`);
    const reg = [
        '---', 'type: to-do-recurring', '---', '',
        '## Recurring Tasks',
        '',
        '## Last 7 days of materialization', '',
        '| Date | Title | Routed to |',
        '| --- | --- | --- |',
        ...rows,
        '',
    ].join('\n');
    const trimmed = ToDoDailyRecurring.trimAuditTable(reg, 50);
    const remainingRows = (trimmed.match(/^\| 2026-/gm) || []).length;
    ok('REC-8 trim caps at 50', remainingRows === 50, `got ${remainingRows} rows`);
})();

// --- REC-9: hasSentinel + writeSentinel round-trip ---
(() => {
    const today = ['---', 'type: to-do', '---', '', '## Today\'s Capture'].join('\n');
    ok('REC-9 hasSentinel false on plain', !ToDoDailyRecurring.hasSentinel(today));
    const w = ToDoDailyRecurring.writeSentinel(today, '2026-06-15');
    ok('REC-9a sentinel present', ToDoDailyRecurring.hasSentinel(w));
    ok('REC-9b sentinel format', w.includes('<!-- recurring-materialized-2026-06-15 -->'));
})();

// --- REC-10: parseRegistry skips lines outside ## Recurring Tasks ---
(() => {
    const reg = [
        '---', 'type: to-do-recurring', '---', '',
        '- [ ] Not in section [recurrence:: every day]',
        '',
        '## Recurring Tasks', '',
        '- [ ] In section [recurrence:: every Monday]',
        '',
        '## Last 7 days of materialization', '',
        '- [ ] Past-section [recurrence:: every Tuesday]',
    ].join('\n');
    const entries = ToDoDailyRecurring.parseRegistry(reg);
    ok('REC-10 only in-section entries', entries.length === 1, `got ${entries.length}`);
    ok('REC-10a correct entry', entries[0] && entries[0].title === 'In section');
})();

// --- REC-11: parseRegistryLine handles missing recurrence as invalid ---
(() => {
    const e = ToDoDailyRecurring.parseRegistryLine('- [ ] No grammar here');
    ok('REC-11 no-recurrence flagged invalid', e && e.invalid === true);
})();

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
process.exit(0);
