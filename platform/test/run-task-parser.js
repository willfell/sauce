#!/usr/bin/env node
/**
 * run-task-parser — Node-only preflight harness for the TaskParser pure
 * helper extracted from v0.3.3's ToDoMigrateModal.
 *
 *   TM-1: parseTasks extracts only unchecked top-level tasks
 *   TM-2: parseTasks groups indented children with their parent
 *   TM-6: parseTasks finds free-form tasks in v0.4.0 minimal-template body (no `## Tasks` heading)
 *   TM-7: parseTasks correctly skips frontmatter when scanning
 *
 * Loader pattern matches run-recurrence-parser / former run-todo-modal:
 * Function-eval the helper body, return the class. No customjs/Obsidian
 * globals reach the test surface.
 *
 * v0.4.0 cycle dropped TM-3 / TM-4 / TM-5 (applyMigration tomorrow-target
 * paths) along with ToDoMigrateModal. ToDoDailyCarryover owns its own
 * source-strip + dest-insert logic; TaskParser is parse-only.
 */

const fs = require('fs');
const path = require('path');

const HELPER = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'task-parser.js');

function loadClass() {
    const src = fs.readFileSync(HELPER, 'utf8');
    const stubs = `
        const window = { moment: undefined };
        const document = {};
        const app = {};
        const Notice = function () {};
    `;
    // eslint-disable-next-line no-new-func
    const make = new Function(`${stubs}\n${src}\nreturn TaskParser;`);
    return make();
}

const TaskParser = loadClass();

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
    if (cond) {
        console.log(`  ok  ${label}`);
        pass++;
    } else {
        console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
        failures.push(label);
        fail++;
    }
}

console.log('run-task-parser:');

// --- TM-1: parseTasks extracts only unchecked top-level tasks ---
(() => {
    const md = [
        '## Tasks',
        '- [ ] Pay Della back',
        '- [x] Completed task',
        '- [ ] Paycheck',
        '',
        '## Notes',
        '- [ ] Should NOT be parsed (under Notes)',
    ].join('\n');
    const blocks = TaskParser.parseTasks(md);
    ok('TM-1 unchecked count', blocks.length === 2, `got ${blocks.length}`);
    ok('TM-1 first top line', blocks[0] && blocks[0].topLine === '- [ ] Pay Della back', `got ${blocks[0] && blocks[0].topLine}`);
    ok('TM-1 second top line', blocks[1] && blocks[1].topLine === '- [ ] Paycheck', `got ${blocks[1] && blocks[1].topLine}`);
})();

// --- TM-2: parseTasks groups indented children with their parent ---
(() => {
    const md = [
        '## Tasks',
        '- [ ] Share repo link',
        '    - https://github.com/example',
        '    - context: PR #42',
        '- [ ] Other task',
    ].join('\n');
    const blocks = TaskParser.parseTasks(md);
    ok('TM-2 block count', blocks.length === 2, `got ${blocks.length}`);
    ok('TM-2 child count', blocks[0] && blocks[0].childLines.length === 2, `got ${blocks[0] && blocks[0].childLines.length}`);
    ok('TM-2 children order',
        blocks[0] &&
        blocks[0].childLines[0] === '    - https://github.com/example' &&
        blocks[0].childLines[1] === '    - context: PR #42',
        `got ${blocks[0] && JSON.stringify(blocks[0].childLines)}`);
})();

// --- TM-6: parseTasks finds free-form tasks in minimal-template / v0.4.0 body (no ## Tasks heading) ---
(() => {
    const today = [
        '---',
        'type: to-do',
        '---',
        '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
        '```',
        '',
        '- [ ] free-form task',
    ].join('\n');
    const blocks = TaskParser.parseTasks(today);
    ok('TM-6 parser finds task without ## Tasks heading', blocks.length === 1, `got ${blocks.length}`);
    ok('TM-6 task text', blocks[0] && blocks[0].topLine === '- [ ] free-form task');
})();

// --- TM-7: parseTasks finds tasks in a minimal-template source AND correctly skips frontmatter ---
(() => {
    const md = [
        '---',
        'type: to-do',
        'tags:',
        '  - "- [ ] not-a-task-just-frontmatter"',
        '---',
        '',
        '- [ ] real-task-1',
        '- [ ] real-task-2',
        '    - indented child of task-2',
    ].join('\n');
    const blocks = TaskParser.parseTasks(md);
    ok('TM-7 finds exactly 2 free-form tasks', blocks.length === 2, `got ${blocks.length}`);
    ok('TM-7 first task text', blocks[0] && blocks[0].topLine === '- [ ] real-task-1');
    ok('TM-7 second task with child', blocks[1] && blocks[1].childLines.length === 1);
})();

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
process.exit(0);
