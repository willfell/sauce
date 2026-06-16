#!/usr/bin/env node
/**
 * run-todo-carryover — Node harness for ToDoDailyCarryover's pure-helper
 * static methods (hasSentinel, findPriorDateInList, eligibleBlocks,
 * stripBlocks, decorateTopLine, insertCarryoverIntoToday, writeSentinel).
 *
 *   CARR-1: findPriorDateInList returns yesterday when present
 *   CARR-2: walks back to N-2 when yesterday absent
 *   CARR-3: returns null after 8 absent days
 *   CARR-4: eligibleBlocks skips [project::]-tagged top-lines
 *   CARR-5: eligibleBlocks skips [recurring_from::]-tagged top-lines
 *   CARR-6: insertCarryoverIntoToday inserts after the ToDoDailyCarryover dataviewjs block
 *   CARR-7: decorateTopLine appends [from:: [[ToDo-YYYY-MM-DD]]]
 *   CARR-8: writeSentinel + hasSentinel round-trip (idempotency basis)
 */

const fs = require('fs');
const path = require('path');

const HELPER = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-daily-carryover.js');

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
    const make = new Function(`${stubs}\n${src}\nreturn ToDoDailyCarryover;`);
    return make();
}

const ToDoDailyCarryover = loadClass();

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok  ${label}`); pass++; }
    else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

console.log('run-todo-carryover:');

// --- CARR-1: findPriorDateInList returns yesterday when present ---
ok('CARR-1 yesterday present',
    ToDoDailyCarryover.findPriorDateInList('2026-06-15', ['2026-06-14', '2026-06-13']) === '2026-06-14');

// --- CARR-2: walks back to N-2 when yesterday absent ---
ok('CARR-2 walks back skipping missing',
    ToDoDailyCarryover.findPriorDateInList('2026-06-15', ['2026-06-13']) === '2026-06-13');

// --- CARR-3: returns null after 8 absent days ---
ok('CARR-3 returns null beyond window',
    ToDoDailyCarryover.findPriorDateInList('2026-06-15', ['2026-06-01']) === null);

ok('CARR-3a returns null when list empty',
    ToDoDailyCarryover.findPriorDateInList('2026-06-15', []) === null);

// --- CARR-4: eligibleBlocks skips [project::] ---
(() => {
    const content = [
        '---',
        'type: to-do',
        '---',
        '',
        '- [ ] regular task',
        '- [ ] project task [project:: [[Sauce]]]',
    ].join('\n');
    const blocks = ToDoDailyCarryover.eligibleBlocks(content);
    ok('CARR-4 skips project-tagged', blocks.length === 1 && blocks[0].topLine === '- [ ] regular task',
        `got ${blocks.length} blocks; first=${blocks[0] && blocks[0].topLine}`);
})();

// --- CARR-5: eligibleBlocks skips [recurring_from::] ---
(() => {
    const content = [
        '---',
        'type: to-do',
        '---',
        '',
        '- [ ] regular task',
        '- [ ] daily standup [recurring_from:: [[Recurring Tasks]]]',
    ].join('\n');
    const blocks = ToDoDailyCarryover.eligibleBlocks(content);
    ok('CARR-5 skips recurring-tagged', blocks.length === 1 && blocks[0].topLine === '- [ ] regular task',
        `got ${blocks.length}`);
})();

// --- CARR-6: insertCarryoverIntoToday inserts after the carryover dataviewjs block ---
(() => {
    const todayContent = [
        '---',
        'type: to-do',
        '---',
        '',
        '## Today\'s Capture',
        '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });',
        '```',
        '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyRecurring" });',
        '```',
        '',
    ].join('\n');
    const decorated = [
        { topLine: '- [ ] migrated task [from:: [[ToDo-2026-06-14]]]', childLines: [] },
    ];
    const out = ToDoDailyCarryover.insertCarryoverIntoToday(todayContent, decorated, '2026-06-14');
    // v0.5.0: SectionLabel dataviewjs block carries the heading text (no raw `## H2`).
    const carryLabelRe = /SectionLabel[\s\S]*?Carryover \(from 2026-06-14\)/;
    const carryDvIdx = out.indexOf('class: "ToDoDailyCarryover"');
    const recDvIdx = out.indexOf('class: "ToDoDailyRecurring"');
    const carryLabelIdx = out.search(carryLabelRe);
    ok('CARR-6 carryover SectionLabel present', carryLabelIdx > -1, `out:\n${out}`);
    ok('CARR-6 SectionLabel after the ToDoDailyCarryover block', carryLabelIdx > carryDvIdx);
    ok('CARR-6 SectionLabel before the recurring block', carryLabelIdx < recDvIdx);
    ok('CARR-6 NO raw ## Carryover heading materialized', !out.includes('## Carryover (from 2026-06-14)'));
    ok('CARR-6 migrated line included', out.includes('- [ ] migrated task [from:: [[ToDo-2026-06-14]]]'));
})();

// --- CARR-7: decorateTopLine appends [from:: [[ToDo-YYYY-MM-DD]]] ---
ok('CARR-7 decorate appends from-link',
    ToDoDailyCarryover.decorateTopLine('- [ ] do the thing', '2026-06-14') === '- [ ] do the thing [from:: [[ToDo-2026-06-14]]]');

ok('CARR-7a decorate is idempotent on already-tagged',
    ToDoDailyCarryover.decorateTopLine('- [ ] do the thing [from:: [[ToDo-2026-06-13]]]', '2026-06-14') ===
    '- [ ] do the thing [from:: [[ToDo-2026-06-13]]]');

// --- CARR-8: writeSentinel + hasSentinel round-trip ---
(() => {
    const original = [
        '---',
        'type: to-do',
        'created_at: "2026-06-15T00:00:00Z"',
        '---',
        '',
        '## Today\'s Capture',
    ].join('\n');
    ok('CARR-8 hasSentinel false on original', !ToDoDailyCarryover.hasSentinel(original));
    const withS = ToDoDailyCarryover.writeSentinel(original, '2026-06-14');
    ok('CARR-8a writeSentinel adds the marker', withS.includes('<!-- carryover-from-2026-06-14 -->'));
    ok('CARR-8b hasSentinel true after write', ToDoDailyCarryover.hasSentinel(withS));
    ok('CARR-8c sentinel inside frontmatter region',
        withS.indexOf('<!-- carryover-from-') < withS.indexOf('\n---\n\n## Today'));
    // Re-write idempotency — second writeSentinel doesn't double-stamp.
    const withS2 = ToDoDailyCarryover.writeSentinel(withS, '2026-06-13');
    const count = (withS2.match(/<!-- carryover-from-/g) || []).length;
    ok('CARR-8d re-write replaces (not stacks) prior sentinel', count === 1, `got ${count}`);
})();

// --- CARR-9: stripBlocks removes block line range ---
(() => {
    const content = [
        '---',
        'type: to-do',
        '---',
        '',
        '- [ ] keep me',
        '- [ ] remove me',
        '    - child of remove',
        '- [ ] keep me too',
    ].join('\n');
    const blocks = ToDoDailyCarryover.eligibleBlocks(content);
    // blocks[1] is "remove me" with 1 child
    const toRemove = [blocks[1]];
    const out = ToDoDailyCarryover.stripBlocks(content, toRemove);
    ok('CARR-9 strip removes target', !out.includes('remove me'));
    ok('CARR-9a strip preserves survivors',
        out.includes('- [ ] keep me') && out.includes('- [ ] keep me too'));
})();

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
process.exit(0);
