#!/usr/bin/env node
/**
 * run-todo-all-list.js — the All To-Dos (ToDoAllList) and Recurring
 * (TaskRecurringList) pages draw the shared To-Do view on their own surface.
 * Each wrapper must hand its surface to ToDoDailyFilterView.render, stay quiet
 * before the view class loads, and (through the real view) show the right
 * tasks behind the right pills.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}

const ToDoAllList = loadClass('blueprints/to-do/helpers/todo-all-list.js', 'ToDoAllList');
const TaskRecurringList = loadClass('blueprints/to-do/helpers/task-recurring-list.js', 'TaskRecurringList');

function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, dataset: {}, _text: '', _listeners: {},
    createEl(t, o) { const c = makeEl(t, (o && o.cls) || ''); c.parentNode = this; if (o && o.text != null) c.textContent = o.text; this.children.push(c); return c; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener(t, fn) { this._listeners[t] = fn; },
    async fire(t, e) { return this._listeners[t] && this._listeners[t]({ preventDefault() {}, stopPropagation() {}, ...(e || {}) }); },
    querySelector() { return null; },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
  };
  return el;
}
const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
const byClass = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
const buttons = (root) => all(root).filter((n) => n.tagName === 'BUTTON');

const TODAY = '2026-11-09';
const page = (title, fields) => ({ type: 'task', title, status: 'open', file: { path: `spice/tasks/${title}.md` }, ...fields });
const PAGES = [
  page('Late report', { due: '2026-11-02' }),
  page('Today call', { due: TODAY }),
  page('Friday demo', { due: '2026-11-13', project: '[[Atlas]]' }),
  page('Someday idea', { due: null }),
  page('Water plants', { due: '2026-11-11', recurrence: 'every week on Wednesday' }),
  page('Pay rent', { due: '2026-11-01', recurrence: 'every month on the 1st' }),
  page('Finished', { status: 'done', due: TODAY, completed_at: TODAY }),
];

function env() {
  const TE = new (loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity'))();
  const TTLClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
  const View = loadClass('blueprints/to-do/helpers/todo-daily-filter-view.js', 'ToDoDailyFilterView');
  const rows = [];
  const store = new Map();
  const customJS = {
    TaskEntity: TE,
    TaskTodayList: Object.assign(Object.create(new TTLClass()), {
      renderTaskRow(container, task) {
        const row = container.createEl('div', { cls: 'sauce-task-today-row' });
        row.createEl('span', { cls: 'sauce-task-today-title', text: task.title });
        rows.push(task.title);
        return row;
      },
    }),
    RenderSafe: { page: () => ({ type: 'to-do-hub', file: { name: 'All-ToDos' } }) },
  };
  customJS.ToDoDailyFilterView = new View();
  global.window = {
    customJS,
    moment: () => ({ format: () => TODAY }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    app: {},
  };
  const container = makeEl('div');
  const dv = { container, current: () => ({}), pages: () => { const a = PAGES.slice(); a.where = (fn) => { const b = a.filter(fn); b.where = a.where; b.array = () => b; return b; }; return a.where(() => true); } };
  return { dv, container, rows, store };
}
const titles = (container) => byClass(container, 'sauce-task-today-title').map((n) => n.textContent);

(async () => {
  {
    const calls = [];
    global.window = { customJS: { ToDoDailyFilterView: { render: (dv, opts) => { calls.push([dv, opts]); return 'drawn'; } } } };
    const dv = { container: makeEl('div') };
    const a = await new ToDoAllList().render(dv);
    const r = await new TaskRecurringList().render(dv);
    ok('TAL-DELEGATE each wrapper hands its own surface to the shared view',
      a === 'drawn' && r === 'drawn' && calls[0][0] === dv && calls[0][1].surface === 'all' && calls[1][1].surface === 'recurring');
    global.window = { customJS: {} };
    let threw = false;
    try { await new ToDoAllList().render(dv); await new TaskRecurringList().render(dv); } catch (_e) { threw = true; }
    ok('TAL-COLD both wrappers are quiet before the shared view loads', !threw);
  }

  {
    const e = env();
    await new ToDoAllList().render(e.dv);
    const pills = byClass(e.container, 'sauce-todo-filter-tabs')[0].children.map((b) => b.textContent);
    ok('TAL-ALL-PILLS All To-Dos: All open / Overdue / This week / Backlog with counts, no week strip, no Done list',
      pills.join('|') === 'All open · 6|Overdue · 2|This week|Backlog · 1'
      && !byClass(e.container, 'sauce-todo-week-strip').length && !byClass(e.container, 'sauce-todo-filter-done-host')[0].children.length);
    ok('TAL-ALL-LIST every open task, soonest due first, undated last; done excluded',
      titles(e.container).join('|') === 'Pay rent|Late report|Today call|Water plants|Friday demo|Someday idea');
    const input = byClass(e.container, 'sauce-todo-search-input')[0];
    // Search repaints follow the last keystroke after a short pause.
    const searchSettled = () => new Promise((resolve) => setTimeout(resolve, 180));
    input.value = 'at';
    await input.fire('input');
    input.value = 'atlas';
    await input.fire('input');
    ok('TAL-ALL-SEARCH-COALESCE typing does not repaint per keystroke', titles(e.container).length === 6);
    await searchSettled();
    ok('TAL-ALL-SEARCH search narrows the list and the counts (title or project)',
      titles(e.container).join('|') === 'Friday demo'
      && byClass(e.container, 'sauce-todo-filter-tabs')[0].children[0].textContent === 'All open · 1');
    input.value = 'zzz';
    await input.fire('input');
    await searchSettled();
    ok('TAL-ALL-SEARCH-EMPTY a search with no hits says so', byClass(e.container, 'sauce-todo-filter-empty')[0].textContent === 'No tasks match.');
    const overdue = buttons(e.container).find((b) => b.textContent.startsWith('Overdue'));
    input.value = '';
    await input.fire('input');
    await searchSettled();
    await overdue.fire('click');
    ok('TAL-ALL-PREFS a tab picked on All To-Dos persists under its own key, never the To-Do note\'s',
      JSON.parse(e.store.get('sauce-todo-filter:prefs:all')).tab === 'overdue' && !e.store.has('sauce-todo-filter:prefs:v2'));
  }

  {
    const e = env();
    await new TaskRecurringList().render(e.dv);
    const pills = byClass(e.container, 'sauce-todo-filter-tabs')[0].children.map((b) => b.textContent);
    ok('TRL-PILLS Recurring: All / This week / Overdue', pills.join('|') === 'All · 2|This week|Overdue · 1');
    ok('TRL-LIST only open tasks with a repeat rule, next due first', titles(e.container).join('|') === 'Pay rent|Water plants');
  }

  {
    const e = env();
    PAGES.splice(4, 2);
    await new TaskRecurringList().render(e.dv);
    ok('TRL-EMPTY with no recurring tasks the page explains how to make one',
      byClass(e.container, 'sauce-todo-filter-empty')[0].textContent === 'No recurring tasks yet. Set "Repeats" on a task to see it here.');
  }

  console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
  process.exit(results.every(([, p]) => p) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
