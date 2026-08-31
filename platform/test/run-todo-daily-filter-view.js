#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_PATH = path.join(ROOT, 'platform/blueprints/to-do/helpers/todo-daily-filter-view.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const TEMPLATE_PATH = path.join(ROOT, 'platform/blueprints/to-do/templates/Today To-Do.md');

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
    insertBefore(child, ref) {
      const index = ref == null ? this.children.length : this.children.indexOf(ref);
      const at = index < 0 ? this.children.length : index;
      const existing = this.children.indexOf(child);
      if (existing >= 0) this.children.splice(existing, 1);
      child.parentNode = this;
      this.children.splice(at > this.children.length ? this.children.length : at, 0, child);
      return child;
    },
    querySelector(selector) {
      const want = String(selector).replace(/^\./, '');
      return descendants(this).find((node) =>
        String(node.className).split(/\s+/).includes(want)) || null;
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
    get nextSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      return siblings[siblings.indexOf(this) + 1] || null;
    },
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
  { type: 'task', title: 'Today low', status: 'open', due: TODAY, priority: 'low', source: 'daily', file: { path: 'spice/tasks/today-low.md' } },
  { type: 'task', title: 'Overdue high', status: 'open', due: '2026-08-10', priority: 'high', project: '[[Sauce]]', project_slug: 'sauce', source: 'project', file: { path: 'spice/tasks/overdue-high.md' } },
  { type: 'task', title: 'Upcoming highest', status: 'open', due: '2026-08-12', priority: 'highest', project: '[[Sauce]]', project_slug: 'sauce', source: 'meeting', file: { path: 'spice/tasks/upcoming-highest.md' } },
  { type: 'task', title: 'No date medium', status: 'open', due: null, priority: 'medium', trip: 'Seed Trip', trip_slug: 'seed-trip', source: 'trip', file: { path: 'spice/tasks/no-date.md' } },
  { type: 'task', title: 'Done today', status: 'done', due: TODAY, completed_at: `${TODAY}T09:15:00-06:00`, priority: 'highest', file: { path: 'spice/tasks/_done/done.md' } },
  { type: 'task', title: 'Done yesterday', status: 'done', due: '2026-08-10', completed_at: '2026-08-10T09:15:00-06:00', file: { path: 'spice/tasks/_done/done-old.md' } },
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
    assert.deepStrictEqual(View.readState(storage), { scopes: ['today', 'overdue'], sort: 'due', groupByProject: false });
    const written = View.writeState(storage, { scopes: ['upcoming', 'no-date'], sort: 'priority', groupByProject: true });
    assert.deepStrictEqual(written, { scopes: ['upcoming', 'no-date'], sort: 'priority', groupByProject: true });
    assert.deepStrictEqual(View.readState(storage), written);

    storage.data.set(View.STORAGE_KEY, '{bad json');
    assert.deepStrictEqual(View.readState(storage), { scopes: ['today', 'overdue'], sort: 'due', groupByProject: false });
    storage.data.set(View.STORAGE_KEY, JSON.stringify({ scopes: [], sort: 'priority' }));
    assert.deepStrictEqual(View.readState(storage), { scopes: ['today', 'overdue'], sort: 'due', groupByProject: false });
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.deepStrictEqual(View.readState(throwing), { scopes: ['today', 'overdue'], sort: 'due', groupByProject: false });
    assert.doesNotThrow(() => View.writeState(throwing, written));
  });

  ok('TV4-DONE is off by default and includes only tasks completed today when enabled', () => {
    const View = loadClass({});
    assert(!View.DEFAULT_SCOPES.includes('done'));
    assert(!View.selectByScope(TASKS, new Set(View.DEFAULT_SCOPES), TODAY).some((task) => task.status === 'done'));
    assert.deepStrictEqual(
      View.selectByScope(TASKS, new Set(['done']), TODAY).map((task) => task.title),
      ['Done today'],
    );
    assert.deepStrictEqual(
      View.selectByScope(TASKS, new Set(['all', 'done']), TODAY).map((task) => task.title),
      ['Today low', 'Overdue high', 'Upcoming highest', 'No date medium', 'Done today'],
    );
  });

  ok('SB-PRIORITY classifies every level and lands the dot after the checkbox', () => {
    const View = loadClass({});

    assert.strictEqual(View.priorityLevel({ priority: 'highest' }), 'highest');
    assert.strictEqual(View.priorityLevel({ priority: '  High  ' }), 'high');
    assert.strictEqual(View.priorityLevel({ priority: 'MEDIUM' }), 'medium');
    assert.strictEqual(View.priorityLevel({ priority: 'low' }), 'low');
    assert.strictEqual(View.priorityLevel({ priority: '' }), 'none');
    assert.strictEqual(View.priorityLevel({ priority: 'urgent' }), 'none');
    assert.strictEqual(View.priorityLevel({}), 'none');
    assert.strictEqual(View.priorityLevel(null), 'none');

    // Real row shape: row > titlegroup > [cbwrap, title]
    const row = makeElement('div', 'sauce-task-today-row');
    const group = row.createEl('div', { cls: 'sauce-task-today-titlegroup' });
    const cbwrap = group.createEl('div', { cls: 'sauce-task-today-cbwrap' });
    const title = group.createEl('span', { cls: 'sauce-task-today-title', text: 'Retire Atlas' });

    const dot = View.decorateRow(row, { priority: 'high' });
    assert(dot, 'decorateRow returned nothing');
    assert.deepStrictEqual(String(dot.className).split(/\s+/).sort(),
      ['is-high', 'sauce-task-priority-dot']);
    assert.strictEqual(dot.attributes['aria-hidden'], 'true');
    assert.deepStrictEqual(group.children, [cbwrap, dot, title],
      'dot must sit between the checkbox and the title');

    // An unset priority still renders a dot, so every row keeps the same
    // left edge and the column does not ragged out.
    const bare = makeElement('div', 'sauce-task-today-row');
    bare.createEl('div', { cls: 'sauce-task-today-titlegroup' });
    assert(String(View.decorateRow(bare, {}).className).includes('is-none'));

    // A row without the expected structure degrades to no dot, never a throw.
    assert.doesNotThrow(() => View.decorateRow(makeElement('div', 'x'), { priority: 'low' }));
    assert.strictEqual(View.decorateRow(null, { priority: 'low' }), null);
  });

  ok('TV4-GROUP partitions the same sorted rows by project without loss or duplication', () => {
    const View = loadClass({});
    const rows = TASKS.slice(0, 4);
    const groups = View.groupByProject(rows);
    assert.deepStrictEqual(groups.map((group) => group.label), ['No Project', 'Sauce']);
    assert.deepStrictEqual(groups.flatMap((group) => group.tasks).map((task) => task.title),
      ['Today low', 'No date medium', 'Overdue high', 'Upcoming highest']);
    assert.deepStrictEqual(
      [...groups.flatMap((group) => group.tasks)].sort((a, b) => a.title.localeCompare(b.title)).map((task) => task.title),
      [...rows].sort((a, b) => a.title.localeCompare(b.title)).map((task) => task.title),
    );
  });

  ok('TV4-TEMPLATE contains exactly ToDoChromeBar + ToDoDailyFilterView renderer blocks', () => {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const classes = [...template.matchAll(/class:\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepStrictEqual(classes, ['ToDoChromeBar', 'ToDoDailyFilterView']);
    for (const retired of ['SectionLabel', 'TaskTodayList', 'ToDoDailyRecurring', 'ToDoDailyProjectGroups',
      'ToDoDailyTripGroups', 'ToDoDailyUnassignedMeetings', 'TaskDoneTodayList']) {
      assert(!template.includes(`class: "${retired}"`), `retired renderer remains: ${retired}`);
    }
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
        SectionLabel: {
          render(dvLike, opts) {
            return dvLike.container.createEl('div', { cls: 'sauce-section-label', text: opts.text });
          },
        },
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
    assert.strictEqual(buttons.length, 9);
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
      scopes: ['today', 'overdue', 'upcoming'], sort: 'priority', groupByProject: false,
    });

    const groupToggle = buttons.find((button) => button.textContent === 'By Project');
    await groupToggle.fire('click');
    assert(String(groupToggle.className).includes('is-active'));
    assert.strictEqual(byClass(root, 'sauce-todo-filter-project-label').length, 2);
    assert.deepStrictEqual(View.readState(storage), {
      scopes: ['today', 'overdue', 'upcoming'], sort: 'priority', groupByProject: true,
    });

    const done = buttons.find((button) => button.textContent === 'Done');
    await done.fire('click');
    assert(rendered.slice(-4).includes('Done today'));
    assert(!rendered.slice(-4).includes('Done yesterday'));
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
