#!/usr/bin/env node
/**
 * run-todo-modal — Node-only preflight harness for ToDoMigrateModal's pure
 * static helpers (parseTasks + applyMigration). Exercises 5 sub-asserts:
 *
 *   TM-1: parseTasks extracts only unchecked top-level tasks
 *   TM-2: parseTasks groups indented children with their parent
 *   TM-3: applyMigration appends migrated blocks to tomorrow's ## Tasks section
 *   TM-4: applyMigration removes migrated blocks from today, preserves survivors
 *   TM-5: applyMigration handles empty-tomorrow (just placeholder) without dropping it
 *
 * The helper file declares `class ToDoMigrateModal { ... }` and we extract the
 * class by Function-evaluating the file body (no module.exports — customjs
 * helpers are not CJS modules). Same loader pattern other Node harnesses use.
 */

const fs = require('fs');
const path = require('path');

const HELPER = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-migrate-modal.js');

function loadClass() {
    const src = fs.readFileSync(HELPER, 'utf8');
    // Evaluate the class declaration in a sandboxed Function and return the constructor.
    // The helper body is just `class ToDoMigrateModal { ... }` so we append a return.
    // We provide no-op stubs for browser/Obsidian globals so the class definition itself doesn't throw.
    const stubs = `
        const window = { moment: undefined };
        const document = {};
        const app = {};
        const Notice = function () {};
    `;
    // eslint-disable-next-line no-new-func
    const make = new Function(`${stubs}\n${src}\nreturn ToDoMigrateModal;`);
    return make();
}

const ToDoMigrateModal = loadClass();

let failures = 0;
function assert(name, cond, detail) {
    if (cond) {
        console.log(`  ok  ${name}`);
    } else {
        console.log(`  FAIL  ${name}`);
        if (detail) console.log(`        ${detail}`);
        failures++;
    }
}

console.log('run-todo-modal:');

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
    const blocks = ToDoMigrateModal.parseTasks(md);
    assert('TM-1 unchecked count', blocks.length === 2, `got ${blocks.length}`);
    assert('TM-1 first top line', blocks[0] && blocks[0].topLine === '- [ ] Pay Della back', `got ${blocks[0] && blocks[0].topLine}`);
    assert('TM-1 second top line', blocks[1] && blocks[1].topLine === '- [ ] Paycheck', `got ${blocks[1] && blocks[1].topLine}`);
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
    const blocks = ToDoMigrateModal.parseTasks(md);
    assert('TM-2 block count', blocks.length === 2, `got ${blocks.length}`);
    assert('TM-2 child count', blocks[0] && blocks[0].childLines.length === 2, `got ${blocks[0] && blocks[0].childLines.length}`);
    assert('TM-2 children order',
        blocks[0] &&
        blocks[0].childLines[0] === '    - https://github.com/example' &&
        blocks[0].childLines[1] === '    - context: PR #42',
        `got ${blocks[0] && JSON.stringify(blocks[0].childLines)}`);
})();

// --- TM-3: applyMigration appends migrated blocks to tomorrow's ## Tasks section ---
(() => {
    const today = [
        '## Tasks',
        '- [ ] Pay Della back',
        '- [ ] Paycheck',
        '',
        '## Notes',
        '',
    ].join('\n');
    const tomorrow = [
        '## Tasks',
        '- [ ] existing-tomorrow-task',
        '',
        '## Notes',
        '',
    ].join('\n');
    const result = ToDoMigrateModal.applyMigration(today, tomorrow, [0]);
    assert('TM-3 tomorrow contains migrated', result.tomorrow.includes('- [ ] Pay Della back'), 'tomorrow:\n' + result.tomorrow);
    assert('TM-3 tomorrow preserves existing', result.tomorrow.includes('- [ ] existing-tomorrow-task'));
    // Migrated line should appear AFTER the existing task (appended at end of section).
    const idxExisting = result.tomorrow.indexOf('- [ ] existing-tomorrow-task');
    const idxMigrated = result.tomorrow.indexOf('- [ ] Pay Della back');
    assert('TM-3 migrated appended after existing', idxMigrated > idxExisting, `existing=${idxExisting} migrated=${idxMigrated}`);
})();

// --- TM-4: applyMigration removes migrated blocks from today; preserves survivors ---
(() => {
    const today = [
        '## Tasks',
        '- [ ] Pay Della back',
        '- [ ] Paycheck',
        '',
        '## Notes',
        '',
    ].join('\n');
    const tomorrow = '## Tasks\n- [ ]\n';
    const result = ToDoMigrateModal.applyMigration(today, tomorrow, [0]);
    assert('TM-4 today removes migrated', !result.today.includes('Pay Della back'), 'today:\n' + result.today);
    assert('TM-4 today preserves survivor', result.today.includes('- [ ] Paycheck'));
    assert('TM-4 today preserves notes section', result.today.includes('## Notes'));
})();

// --- TM-5: applyMigration against empty-tomorrow (- [ ] placeholder) inserts after placeholder ---
(() => {
    const today = [
        '## Tasks',
        '- [ ] only task',
        '',
        '## Notes',
    ].join('\n');
    const tomorrow = [
        '## Tasks',
        '- [ ]',
        '',
        '## Notes',
    ].join('\n');
    const result = ToDoMigrateModal.applyMigration(today, tomorrow, [0]);
    const placeholderIdx = result.tomorrow.indexOf('- [ ]\n');
    const migratedIdx = result.tomorrow.indexOf('- [ ] only task');
    assert('TM-5 placeholder preserved', placeholderIdx >= 0, 'tomorrow:\n' + result.tomorrow);
    assert('TM-5 migrated appears after placeholder', migratedIdx > placeholderIdx, `placeholder=${placeholderIdx} migrated=${migratedIdx}`);
})();

// --- TM-6: applyMigration against minimal-template tomorrow (no ## Tasks heading)
//     appends at end of body (v0.63.3 minimal template path) ---
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
    const tomorrow = [
        '---',
        'type: to-do',
        '---',
        '',
        '```dataviewjs',
        'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
        '```',
        '',
    ].join('\n');
    const blocks = ToDoMigrateModal.parseTasks(today);
    assert('TM-6 parser finds task without ## Tasks heading', blocks.length === 1, `got ${blocks.length}`);
    const result = ToDoMigrateModal.applyMigration(today, tomorrow, [0]);
    assert('TM-6 today removes migrated', !result.today.includes('free-form task'), 'today:\n' + result.today);
    assert('TM-6 tomorrow appended at end', /- \[ \] free-form task\n?$/.test(result.tomorrow.replace(/\s+$/, '\n')),
        'tomorrow:\n' + result.tomorrow);
    assert('TM-6 tomorrow preserves frontmatter', result.tomorrow.startsWith('---\ntype: to-do'));
    assert('TM-6 tomorrow preserves dataviewjs', result.tomorrow.includes('SpaceNavButtons'));
})();

// --- TM-7: parseTasks finds tasks in a minimal-template source (no ## Tasks heading)
//     AND correctly skips frontmatter when scanning ---
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
    const blocks = ToDoMigrateModal.parseTasks(md);
    assert('TM-7 finds exactly 2 free-form tasks', blocks.length === 2, `got ${blocks.length}`);
    assert('TM-7 first task text', blocks[0] && blocks[0].topLine === '- [ ] real-task-1');
    assert('TM-7 second task with child', blocks[1] && blocks[1].childLines.length === 1);
})();

if (failures) {
    console.log(`run-todo-modal: ${failures} FAILURES`);
    process.exit(1);
}
console.log('run-todo-modal: OK');
