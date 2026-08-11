#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_PATH = path.join(ROOT, 'platform/blueprints/to-do/helpers/todo-daily-filter-view.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error && error.message || error}`);
  }
}
async function okAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error && error.message || error}`);
  }
}

function loadClass(windowShim = {}) {
  return new Function('window', `${SOURCE}\nreturn ToDoDailyFilterView;`)(windowShim);
}

function makeStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

function makeElement(tag = 'div', cls = '') {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: cls,
    children: [],
    parentNode: null,
    style: { cssText: '' },
    attributes: {},
    dataset: {},
    _text: '',
    _listeners: {},
    createEl(childTag, opts = {}) {
      const child = makeElement(childTag, opts.cls || '');
      child.parentNode = this;
      if (opts.text != null) child.textContent = opts.text;
      this.children.push(child);
      return child;
    },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, listener) { this._listeners[type] = listener; },
    async fire(type, event = {}) {
      if (!this._listeners[type]) return undefined;
      return this._listeners[type]({
        target: this,
        preventDefault() {},
        stopPropagation() {},
        ...event,
      });
    },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); },
    set textContent(value) { this._text = String(value == null ? '' : value); this.children = []; },
  };
  return el;
}

function descendants(node) {
  return (node.children || []).flatMap((child) => [child, ...descendants(child)]);
}
function byClass(root, cls) {
  return descendants(root).filter((node) => String(node.className).split(/\s+/).includes(cls));
}

function dataArray(items) {
  const list = items.slice();
  list.where = (predicate) => dataArray(list.filter(predicate));
  list.array = () => list.slice();
  return list;
}

const TODAY = '2026-08-11';
const TASKS = [
  { type: 'task', title: 'Today low', status: 'open', due: TODAY, priority: 'low', file: { path: 'spice/tasks/today-low.md' } },
  { type: 'task', title: 'Overdue high', status: 'open', due: '2026-08-10', priority: 'high', file: { path: 'spice/tasks/overdue-high.md' } },
  { type: 'task', title: 'Upcoming highest', status: 'open', due: '2026-08-12', priority: 'highest', file: { path: 'spice/tasks/upcoming-highest.md' } },
  { type: 'task', title: 'No date medium', status: 'open', due: null, priority: 'medium', file: { path: 'spice/tasks/no-date.md' } },
  { type: 'task', title: 'Done', status: 'done', due: TODAY, priority: 'highest', file: { path: 'spice/tasks/_done/done.md' } },
];

(async () => {
  ok('TV3-LOAD bare class is loader-safe with no trailing statements', () => {
    const View = loadClass({});
    assert.strictEqual(typeof View, 'function');
    assert.strictEqual(SOURCE.trim().endsWith('}'), true);
  });

  ok('TV3-SCOPE default Today+Overdue selects exactly the intended open tasks', () => {
    const View = loadClass({});
    assert.deepStrictEqual(View.DEFAULT_SCOPES, ['today', 'overdue']);
    const selected = View.selectByScope(TASKS, new Set(View.DEFAULT_SCOPES), TODAY);
    assert.deepStrictEqual(selected.map((task) => task.title), ['Today low', 'Overdue high']);
  });

  ok('TV3-SCOPE multi-select adds Upcoming and gates No date behind no-date or All', () => {
    const View = loadClass({});
    assert.deepStrictEqual(
      View.selectByScope(TASKS, new Set(['today', 'overdue', 'upcoming']), TODAY).map((task) => task.title),
      ['Today low', 'Overdue high', 'Upcoming highest'],
    );
    assert(!View.selectByScope(TASKS, new Set(['today']), TODAY).some((task) => task.title === 'No date medium'));
    assert.deepStrictEqual(
      View.selectByScope(TASKS, new Set(['no-date']), TODAY).map((task) => task.title),
      ['No date medium'],
    );
    assert.deepStrictEqual(
      View.selectByScope(TASKS, new Set(['all']), TODAY).map((task) => task.title),
      ['Today low', 'Overdue high', 'Upcoming highest', 'No date medium'],
    );
  });

  ok('TV3-STATE guarded storage round-trips canonical client-only state', () => {
    const View = loadClass({});
    const storage = makeStorage();
    assert.deepStrictEqual(View.readState(storage), { scopes: ['today', 'overdue'], sort: 'due' });
    const written = View.writeState(storage, { scopes: ['upcoming', 'no-date'], sort: 'priority' });
    assert.deepStrictEqual(written, { scopes: ['upcoming', 'no-date'], sort: 'priority' });
    assert.deepStrictEqual(View.readState(storage), written);

    storage.data.set(View.STORAGE_KEY, '{bad json');
    assert.deepStrictEqual(View.readState(storage), { scopes: ['today', 'overdue'], sort: 'due' });
    storage.data.set(View.STORAGE_KEY, JSON.stringify({ scopes: [], sort: 'priority' }));
    assert.deepStrictEqual(View.readState(storage), { scopes: ['today', 'overdue'], sort: 'due' });
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.deepStrictEqual(View.readState(throwing), { scopes: ['today', 'overdue'], sort: 'due' });
    assert.doesNotThrow(() => View.writeState(throwing, written));
  });

  ok('TV3-SORT delegates Due and Priority ordering to SpaceDailyDashboard comparators', () => {
    const calls = [];
    const dashboard = {
      compareTasksByDue(a, b) { calls.push('due'); return String(a.due || '9999').localeCompare(String(b.due || '9999')); },
      compareTasksByPriority(a, b) {
        calls.push('priority');
        const rank = { highest: 4, high: 3, medium: 2, low: 1 };
        return (rank[b.priority] || 0) - (rank[a.priority] || 0)
          || dashboard.compareTasksByDue(a, b);
      },
    };
    const View = loadClass({});
    const open = TASKS.slice(0, 4);
    assert.deepStrictEqual(View.sortTasks(open, 'due', dashboard).map((task) => task.title),
      ['Overdue high', 'Today low', 'Upcoming highest', 'No date medium']);
    assert.deepStrictEqual(View.sortTasks(open, 'priority', dashboard).map((task) => task.title),
      ['Upcoming highest', 'Overdue high', 'No date medium', 'Today low']);
    assert(calls.includes('due') && calls.includes('priority'));
    assert.deepStrictEqual(open.map((task) => task.title), TASKS.slice(0, 4).map((task) => task.title));

    class DashboardInstance {
      static compareTasksByDue(a, b) { return dashboard.compareTasksByDue(a, b); }
      static compareTasksByPriority(a, b) { return dashboard.compareTasksByPriority(a, b); }
    }
    assert.deepStrictEqual(
      View.sortTasks(open, 'priority', new DashboardInstance()).map((task) => task.title),
      ['Upcoming highest', 'Overdue high', 'No date medium', 'Today low'],
    );
  });

  await okAsync('TV3-RENDER paints one flat ul, shared pills, live rows, and persisted interactions', async () => {
    const storage = makeStorage();
    const rendered = [];
    let clockReads = 0;
    const windowShim = {
      localStorage: storage,
      moment: () => { clockReads += 1; return { format: () => TODAY }; },
      customJS: {
        RenderSafe: { page: () => ({ type: 'to-do' }) },
        TaskEntity: {
          parseNote(page) { return { ...page, path: page.file.path }; },
        },
        TaskTodayList: {
          renderTaskRow(container, task) {
            rendered.push(task.title);
            return container.createEl('li', { cls: 'sauce-task-today-row', text: task.title });
          },
        },
        TaskDialog: {},
        SpaceDailyDashboard: {
          compareTasksByDue(a, b) {
            const ad = a.due || '9999-99-99';
            const bd = b.due || '9999-99-99';
            return ad.localeCompare(bd);
          },
          compareTasksByPriority(a, b) {
            const rank = { highest: 4, high: 3, medium: 2, low: 1 };
            return (rank[b.priority] || 0) - (rank[a.priority] || 0)
              || this.compareTasksByDue(a, b);
          },
        },
      },
    };
    const View = loadClass(windowShim);
    const root = makeElement();
    const dv = {
      container: root,
      current: () => ({ type: 'to-do' }),
      pages: () => dataArray(TASKS),
    };
    await new View().render(dv);

    assert.strictEqual(clockReads, 1, 'render reads the live clock exactly once');
    assert.strictEqual(byClass(root, 'sauce-todo-daily-filter-list').length, 1);
    assert.strictEqual(byClass(root, 'sauce-section-summary').length, 0, 'flat list has no project headers');
    const groups = byClass(root, 'sauce-pill-group');
    assert.strictEqual(groups.length, 2);
    const buttons = descendants(root).filter((node) => node.tagName === 'BUTTON');
    assert.strictEqual(buttons.length, 7);
    assert(buttons.every((button) => String(button.className).split(/\s+/).includes('sauce-pill-toggle')));
    assert.deepStrictEqual(rendered, ['Overdue high', 'Today low'],
      JSON.stringify({ state: View.readState(storage), nodes: descendants(root).map((node) => [node.tagName, node.className, node.textContent]) }));

    const upcoming = buttons.find((button) => button.textContent === 'Upcoming');
    await upcoming.fire('click');
    assert(String(upcoming.className).includes('is-active'));
    assert(rendered.slice(-3).includes('Upcoming highest'));

    const priority = buttons.find((button) => button.textContent === 'Priority');
    await priority.fire('click');
    assert(String(priority.className).includes('is-active'));
    assert.deepStrictEqual(View.readState(storage), {
      scopes: ['today', 'overdue', 'upcoming'], sort: 'priority',
    });
  });

  await okAsync('TV3-COLD missing TaskEntity or TaskTodayList is a no-throw no-op', async () => {
    for (const customJS of [{ TaskTodayList: {} }, { TaskEntity: {} }, {}]) {
      const windowShim = { customJS, moment: () => ({ format: () => TODAY }) };
      const View = loadClass(windowShim);
      const root = makeElement();
      await assert.doesNotReject(() => new View().render({
        container: root,
        current: () => ({ type: 'to-do' }),
        pages: () => dataArray(TASKS),
      }));
      assert.strictEqual(root.children.length, 0);
    }
  });

  console.log(`\nrun-todo-daily-filter-view: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
