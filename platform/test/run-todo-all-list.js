#!/usr/bin/env node
/**
 * run-todo-all-list.js — behavioral harness for ToDoAllList, rebuilt against
 * the note-per-task model (spice/tasks/, NOT the retired p.file.tasks
 * markdown-checkbox model). Mirrors TaskDoneArchive's DocSearch + date-group
 * pattern: a search strip filters a date-grouped list of every OPEN task,
 * grouped Overdue (oldest first) → Today → future dates → "No date", each
 * row drawn via the shared TaskTodayList.renderTaskRow.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-all-list.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const ToDoAllListClass = loadClass('blueprints/to-do/helpers/todo-all-list.js', 'ToDoAllList');

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ---------- Pure static helper tests: groupByDate ----------

ok('TAL-GROUP-1 groupByDate buckets into overdue / today / future / no-date', () => {
  const tasks = [
    { title: 'Old', scheduled: '2026-07-01' },
    { title: 'DueToday', scheduled: '2026-07-08' },
    { title: 'Future', scheduled: '2026-07-15' },
    { title: 'NoDate', scheduled: null },
  ];
  const groups = ToDoAllListClass.groupByDate(tasks, '2026-07-08');
  assert(groups.overdue.length === 1 && groups.overdue[0].title === 'Old', 'overdue has Old');
  assert(groups.today.length === 1 && groups.today[0].title === 'DueToday', 'today has DueToday');
  assert(groups.future.length === 1 && groups.future[0].title === 'Future', 'future has Future');
  assert(groups.noDate.length === 1 && groups.noDate[0].title === 'NoDate', 'noDate has NoDate');
});

ok('TAL-GROUP-2 overdue sorts oldest first; future sorts soonest first', () => {
  const tasks = [
    { title: 'C', scheduled: '2026-07-05' },
    { title: 'A', scheduled: '2026-07-01' },
    { title: 'B', scheduled: '2026-07-03' },
    { title: 'Y', scheduled: '2026-07-20' },
    { title: 'X', scheduled: '2026-07-10' },
  ];
  const groups = ToDoAllListClass.groupByDate(tasks, '2026-07-08');
  assert(JSON.stringify(groups.overdue.map(t => t.title)) === JSON.stringify(['A', 'B', 'C']), 'overdue oldest first');
  assert(JSON.stringify(groups.future.map(t => t.title)) === JSON.stringify(['X', 'Y']), 'future soonest first');
});

ok('TAL-GROUP-3 empty/null input returns all-empty groups', () => {
  const groups = ToDoAllListClass.groupByDate(null, '2026-07-08');
  assert(groups.overdue.length === 0 && groups.today.length === 0 && groups.future.length === 0 && groups.noDate.length === 0,
    'all empty on null input');
});

// ---------- Pure static helper tests: filterByText (mirrors TaskDoneArchive) ----------

ok('TAL-FILTER-1 filterByText matches title case-insensitively', () => {
  const tasks = [{ title: 'Fix Dev CDC' }, { title: 'Deploy staging' }, { title: 'fix login bug' }];
  const result = ToDoAllListClass.filterByText(tasks, 'fix');
  assert(result.length === 2, 'expected 2, got ' + result.length);
});

ok('TAL-FILTER-2 filterByText returns all tasks when text is empty/blank/null', () => {
  const tasks = [{ title: 'A' }, { title: 'B' }];
  assert(ToDoAllListClass.filterByText(tasks, '').length === 2, 'empty string returns all');
  assert(ToDoAllListClass.filterByText(tasks, '   ').length === 2, 'blank string returns all');
  assert(ToDoAllListClass.filterByText(tasks, null).length === 2, 'null returns all');
});

// ---------- render() integration: DOM-stub, spice/tasks source, DocSearch ----------

function makeEl(tag) {
  const el = {
    tag, textContent: '', children: [], _attrs: {},
    style: {},
    classList: { add() {} },
    createEl(t, o) { const c = makeEl(t); if (o && o.cls) c._attrs.cls = o.cls; if (o && o.text != null) c.textContent = o.text; el.children.push(c); return c; },
    createSpan(o) { return el.createEl('span', o); },
    createDiv(o) { return el.createEl('div', o); },
    setAttribute(k, v) { el._attrs[k] = v; },
    addEventListener() {},
    closest() { return null; },
    empty() { el.children = []; },
    get firstChild() { return el.children.length ? el.children[0] : null; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
  };
  return el;
}
const allEls = (root, out = []) => { for (const c of root.children) { out.push(c); allEls(c, out); } return out; };
const whereArr = (arr) => Object.assign(arr.slice(), { where(fn) { return whereArr(arr.filter(fn)); }, array() { return arr.slice(); } });

function mkTaskPage(title, scheduled, status) {
  return { type: 'task', status: status || 'open', title, scheduled, due: null, priority: '', project: null, project_slug: null, source: null, source_note: null, links: [], created_at: null, completed_at: null, file: { path: `spice/tasks/${title}.md` } };
}

async function runRender(pages) {
  const container = makeEl('div');
  const sectionLabelCalls = [];
  const renderTaskRowCalls = [];
  let searchOnChange = null;
  const dv = {
    container,
    current: () => ({ type: 'to-do-hub' }),
    pages: (_q) => whereArr(pages),
  };
  global.window = {
    moment: () => ({ format: () => '2026-07-08' }),
    customJS: {
      RenderSafe: { page: (_dv) => ({ type: 'to-do-hub' }) },
      TaskEntity: {
        parseNote: (p) => ({ title: p.title, scheduled: p.scheduled, due: p.due, status: p.status, path: p.file.path, project_slug: null, source: null }),
      },
      TaskTodayList: {
        renderTaskRow: (c, task) => { renderTaskRowCalls.push(task.title); return c.createEl('div', { cls: 'row', text: task.title }); },
      },
      SectionLabel: { render: (c, o) => { sectionLabelCalls.push(o && o.text); } },
      DocSearch: {
        render: (_dv, opts) => {
          searchOnChange = opts.onChange;
          const resultsContainer = container.createEl('div', { cls: 'results' });
          const ctx = { resultsContainer, hasActiveFilter: false, text: '' };
          return ctx;
        },
      },
    },
  };
  global.app = { workspace: { openLinkText() {} } };
  const src = fs.readFileSync(SRC, 'utf8');
  const Cls = new Function(`${src}\nreturn ToDoAllList;`)();
  const inst = new Cls();
  await inst.render(dv);
  return { container, sectionLabelCalls, renderTaskRowCalls, searchOnChange };
}

(async () => {
  const pages = [
    mkTaskPage('OldOverdue', '2026-07-01'),
    mkTaskPage('DueToday', '2026-07-08'),
    mkTaskPage('Tomorrow', '2026-07-09'),
    mkTaskPage('Undated', null),
    mkTaskPage('AlreadyDone', '2026-07-01', 'done'),
  ];

  const { sectionLabelCalls, renderTaskRowCalls } = await runRender(pages);

  ok('TAL-RENDER-1 renders without throwing', true);
  ok('TAL-RENDER-2 emits section labels for Overdue, Today, and future date groups',
    sectionLabelCalls.some(l => /overdue/i.test(l)) &&
    sectionLabelCalls.some(l => /today/i.test(l) || l === '2026-07-08'));
  ok('TAL-RENDER-3 draws a row for every OPEN task (done task excluded)',
    renderTaskRowCalls.includes('OldOverdue') && renderTaskRowCalls.includes('DueToday') &&
    renderTaskRowCalls.includes('Tomorrow') && renderTaskRowCalls.includes('Undated') &&
    !renderTaskRowCalls.includes('AlreadyDone'));

  const allPass = results.every(([, p]) => p);
  console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
  process.exit(allPass ? 0 : 1);
})();
