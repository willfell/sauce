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

// --- Shared mutable globals for render-based cases (PG/UM groups below). ---
// The loaded class methods reference window.customJS / window.app / document at
// call-time against the closure they were defined in. We therefore inject ONE
// set of stub objects into the loader scope and mutate THOSE same objects from
// the test body so the class sees our fixtures.
const sharedWindow = { moment: undefined, customJS: undefined, app: undefined };
const sharedDocument = {
    createComment(text) { return { nodeType: 8, textContent: String(text) }; },
};

/**
 * Load a CustomJS helper class (no module.exports) into a sandbox that shares
 * the `sharedWindow` / `sharedDocument` stubs declared above, matching the
 * existing loadClass() pattern (new Function + stubbed globals).
 */
function loadHelperClass(fileName, className) {
    const helperPath = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', fileName);
    const src = fs.readFileSync(helperPath, 'utf8');
    const stubs = `
        const Notice = function () {};
        const console = { error: function () {} };
    `;
    // eslint-disable-next-line no-new-func
    const make = new Function('window', 'document', 'app', `${stubs}\n${src}\nreturn ${className};`);
    return make(sharedWindow, sharedDocument, sharedWindow.app);
}

const ToDoDailyProjectGroups = loadHelperClass('todo-daily-project-groups.js', 'ToDoDailyProjectGroups');
const ToDoDailyUnassignedMeetings = loadHelperClass('todo-daily-unassigned-meetings.js', 'ToDoDailyUnassignedMeetings');

// --- Minimal Obsidian-style DOM element stub (createEl / appendChild). ---
// Mirrors the container/flatten approach used by run-helper-cases render cases.
function makeEl(tag) {
    const el = {
        tag: tag || 'div',
        textContent: '',
        children: [],
        style: { cssText: '' },
        onclick: null,
        get lastElementChild() { return this.children[this.children.length - 1] || null; },
        createEl(t, opts) {
            const child = makeEl(t);
            if (opts && typeof opts.text === 'string') child.textContent = opts.text;
            this.children.push(child);
            return child;
        },
        createDiv(opts) { return this.createEl('div', opts); },
        appendChild(node) { this.children.push(node); return node; },
        closest() { return null; },
    };
    return el;
}

function flattenEl(node) {
    if (!node) return '';
    const parts = [];
    if (typeof node.textContent === 'string') parts.push(node.textContent);
    if (Array.isArray(node.children)) for (const c of node.children) parts.push(flattenEl(c));
    return parts.join(' ');
}

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

// --- PG-1: _normalizeProjectName resolves every reference shape (v0.117.x) ---
// Static helper called the same way the source references it.
(() => {
    const N = (v) => ToDoDailyProjectGroups._normalizeProjectName(v);
    ok('PG-1 plain string → Sauce', N('Sauce') === 'Sauce', `got ${JSON.stringify(N('Sauce'))}`);
    ok('PG-1a wikilink string → Sauce', N('[[Sauce]]') === 'Sauce', `got ${JSON.stringify(N('[[Sauce]]'))}`);
    ok('PG-1b piped wikilink → display side Sauce',
        N('[[notes/Sauce|Sauce]]') === 'Sauce', `got ${JSON.stringify(N('[[notes/Sauce|Sauce]]'))}`);
    ok('PG-1c Link-like { path } → Sauce',
        N({ path: 'Sauce' }) === 'Sauce', `got ${JSON.stringify(N({ path: 'Sauce' }))}`);
    ok('PG-1d Link-like { display, path } → Sauce (path wins, basename)',
        N({ display: 'Sauce', path: 'notes/Sauce' }) === 'Sauce',
        `got ${JSON.stringify(N({ display: 'Sauce', path: 'notes/Sauce' }))}`);
    ok('PG-1e array-of-Link → first element Sauce',
        N([{ path: 'Sauce' }]) === 'Sauce', `got ${JSON.stringify(N([{ path: 'Sauce' }]))}`);
    // null / undefined must return falsy/empty without throwing.
    let threw = false;
    let nullOut, undefOut;
    try { nullOut = N(null); undefOut = N(undefined); } catch (_e) { threw = true; }
    ok('PG-1f null/undefined do not throw', !threw);
    ok('PG-1g null → empty string', nullOut === '', `got ${JSON.stringify(nullOut)}`);
    ok('PG-1h undefined → empty string', undefOut === '', `got ${JSON.stringify(undefOut)}`);
})();

// --- PG-2: _collectMeetingTasksForProject is resilient to a throwing meeting ---
// One meeting throws on `project` access; others are well-formed. The v0.117.3
// per-meeting try/catch must keep the good results instead of blanking the array.
(() => {
    const boomMeeting = { file: { path: 'spice/meetings/notes/Boom.md', tasks: [] } };
    Object.defineProperty(boomMeeting, 'project', { get() { throw new Error('boom'); } });
    const goodMeeting = {
        project: '[[Sauce]]',
        file: {
            path: 'spice/meetings/notes/Standup.md',
            tasks: [{ text: 'Ship spec', completed: false }],
        },
    };
    const dv = {
        pages(glob) {
            if (glob !== '"spice/meetings/notes"') return { array() { return []; } };
            return { array() { return [boomMeeting, goodMeeting]; } };
        },
    };
    const inst = new ToDoDailyProjectGroups();
    let threw = false;
    let out;
    try { out = inst._collectMeetingTasksForProject(dv, 'Sauce'); }
    catch (_e) { threw = true; }
    ok('PG-2 collect does not throw on a bad meeting', !threw);
    ok('PG-2a returns the well-formed meeting task',
        Array.isArray(out) && out.length === 1 && out[0].text === 'Ship spec',
        `got ${JSON.stringify(out)}`);
    ok('PG-2b task carries its source path',
        out && out[0] && out[0].source === 'spice/meetings/notes/Standup.md',
        `got ${out && out[0] && out[0].source}`);
})();

// --- UM-1: ToDoDailyUnassignedMeetings.render surfaces only unassigned tasks ---
// One meeting is project-assigned (excluded); one is unassigned (included).
(() => {
    sharedWindow.customJS = undefined; // exercise the muted-div fallback label
    sharedWindow.app = {};
    const assigned = {
        project: '[[Sauce]]',
        file: { path: 'spice/meetings/notes/Assigned.md', tasks: [{ text: 'Assigned task', completed: false }] },
    };
    const unassigned = {
        project: null,
        file: { path: 'spice/meetings/notes/Unassigned.md', tasks: [{ text: 'Loose meeting task', completed: false }] },
    };
    const container = makeEl('div');
    const dv = {
        container,
        current() { return { type: 'to-do' }; },
        pages(glob) {
            if (glob !== '"spice/meetings/notes"') return { where() { return { array() { return []; } }; } };
            return {
                where(fn) {
                    const filtered = [assigned, unassigned].filter(fn);
                    return { array() { return filtered; } };
                },
            };
        },
    };
    const inst = new ToDoDailyUnassignedMeetings();
    let threw = false;
    try {
        const r = inst.render(dv);
        if (r && typeof r.then === 'function') { /* async; resolved synchronously below */ }
    } catch (_e) { threw = true; }
    const dom = flattenEl(container);
    ok('UM-1 render does not throw', !threw);
    ok('UM-1a includes the unassigned task', dom.includes('Loose meeting task'), `dom: ${dom}`);
    ok('UM-1b excludes the project-assigned task', !dom.includes('Assigned task'), `dom: ${dom}`);
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
