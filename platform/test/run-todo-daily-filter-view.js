#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_PATH = path.join(ROOT, 'platform/blueprints/to-do/helpers/todo-daily-filter-view.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const TEMPLATE_PATH = path.join(ROOT, 'platform/blueprints/to-do/templates/Today To-Do.md');
const TASK_ENTITY_SRC = fs.readFileSync(
  path.join(ROOT, 'platform/mechanisms/task-entity/task-entity.js'), 'utf8');

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

// customJS stores INSTANCES; the view must work through the same surface.
const TaskEntityClass = new Function(`${TASK_ENTITY_SRC}\nreturn TaskEntity;`)();
const TE = new TaskEntityClass();
const TaskTodayListClass = new Function(`${fs.readFileSync(
  path.join(ROOT, 'platform/mechanisms/task-entity/task-today-list.js'), 'utf8')}\nreturn TaskTodayList;`)();
const TTL_REAL = new TaskTodayListClass();
const TaskDialogClass = new Function(`${fs.readFileSync(
  path.join(ROOT, 'platform/mechanisms/task-entity/task-dialog.js'), 'utf8')}\nreturn TaskDialog;`)();

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
function buttonsOf(root) {
  return descendants(root).filter((node) => node.tagName === 'BUTTON');
}
function findButton(root, label) {
  return buttonsOf(root).find((b) => b.textContent === label);
}
function controlsOf(root) {
  return byClass(root, 'sauce-todo-filter-controls')[0];
}

function dataArray(items) {
  const list = items.slice();
  list.where = (predicate) => dataArray(list.filter(predicate));
  list.array = () => list.slice();
  return list;
}

const TODAY = '2026-11-09';
const page = (title, fields) => ({
  type: 'task', title, status: 'open', file: { path: `spice/tasks/${title}.md` }, ...fields,
});
const PAGES = [
  page('Today low', { due: TODAY, priority: 'low', project: '[[Atlas]]', project_slug: 'atlas', source: 'project' }),
  page('Today high', { due: TODAY, priority: 'high' }),
  page('Overdue mid', { due: '2026-11-05', priority: 'medium' }),
  page('Stale old', { due: '2026-09-01', priority: 'highest' }),
  page('Friday item', { due: '2026-11-13', priority: 'high', project: '[[Atlas]]', project_slug: 'atlas', source: 'project' }),
  page('Next week item', { due: '2026-11-16', priority: 'low' }),
  page('Backlog item', { due: null, priority: 'medium' }),
  page('Owned undated', { due: null, project: '[[Zeta]]', project_slug: 'zeta', source: 'project' }),
  page('Done this morning', {
    status: 'done', due: TODAY, completed_at: `${TODAY}T09:15:00-06:00`,
    file: { path: 'spice/tasks/_done/Done this morning.md' },
  }),
  page('Done last night', {
    status: 'done', due: TODAY, completed_at: `${TODAY}T21:40:00-06:00`,
    file: { path: 'spice/tasks/_done/Done last night.md' },
  }),
  page('Done yesterday', {
    status: 'done', due: '2026-11-08', completed_at: '2026-11-08T09:15:00-06:00',
    file: { path: 'spice/tasks/_done/Done yesterday.md' },
  }),
];
const PARSED = PAGES.map((p) => TE.parseNote(p));
const titles = (list) => list.map((task) => task.title);

function makeRenderHarness(overrides = {}) {
  const storage = makeStorage();
  const rows = [];
  const notices = [];
  const reopened = [];
  const menus = [];
  const calls = { reschedule: [], setFields: [], markDone: [] };
  const clock = { reads: 0 };
  class NoticeStub { constructor(message) { notices.push(message); } }
  const customJS = {
    RenderSafe: { page: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }) },
    TaskEntity: TE,
    TaskTodayList: Object.assign(Object.create(TTL_REAL), {
      renderTaskRow(container, task, TDref, options) {
        const row = container.createEl('div', { cls: 'sauce-task-today-row' });
        row.dataset.sauceTaskPath = String(task.path || '');
        if (options && options.dragHandle) {
          const handle = row.createEl('span', { cls: 'sauce-task-drag' });
          handle.draggable = true;
          handle.setAttribute('aria-label', typeof options.dragHandle === 'string' ? options.dragHandle : 'Drag to reorder');
        }
        row.createEl('span', { cls: 'sauce-task-today-title', text: task.title });
        rows.push({ title: task.title, task, options, row, container });
        return row;
      },
      async reschedule(row, task, newDue, viewedDay, TDref) {
        calls.reschedule.push({ path: task.path, newDue, viewedDay, hasRow: !!row, TD: TDref });
        if (overrides.reschedule) return overrides.reschedule(task.path, newDue);
        if (row && row.parentNode) row.parentNode.removeChild(row);
        return { ok: true, due: newDue };
      },
    }),
    TaskDialog: {
      async reopen(taskPath) {
        reopened.push(taskPath);
        return overrides.reopenResult
          ? overrides.reopenResult(taskPath)
          : { ok: true, path: taskPath.replace('/_done/', '/') };
      },
      async setFields(taskPath, fields) {
        calls.setFields.push({ path: taskPath, fields });
        return overrides.setFields ? overrides.setFields(taskPath, fields) : { ok: true };
      },
      async markDone(taskPath) {
        calls.markDone.push(taskPath);
        return overrides.markDone ? overrides.markDone(taskPath) : { ok: true };
      },
      donePath(taskPath) { return String(taskPath).replace('spice/tasks/', 'spice/tasks/_done/'); },
      _loadProjectList(appRef) {
        calls.projectApp = appRef;
        return [{ name: 'Atlas', slug: 'atlas' }, { name: 'Zeta Works', slug: 'zeta' }];
      },
      _slugify(name) { return TaskDialogClass._slugify(name); },
    },
    SectionLabel: {
      render(dvLike, opts) {
        return dvLike.container.createEl('div', { cls: 'sauce-section-label', text: opts.text });
      },
    },
    MenuPopover: overrides.noMenu ? undefined : {
      open(entries, opts) { menus.push({ entries, anchor: opts && opts.anchor }); return {}; },
    },
  };
  const appStub = { vault: {}, workspace: {} };
  const windowShim = {
    localStorage: storage,
    moment: () => { clock.reads += 1; return { format: () => TODAY }; },
    Notice: NoticeStub,
    app: appStub,
    customJS,
  };
  return { storage, rows, notices, reopened, menus, calls, appStub, windowShim, clock, customJS };
}

async function mount(env, pages = PAGES, ViewClass) {
  const View = ViewClass || loadClass(env.windowShim);
  const root = makeElement();
  await new View().render({
    container: root,
    current: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }),
    pages: () => dataArray(pages),
  });
  return { View, root };
}
const listTitles = (root) => byClass(root, 'sauce-task-today-title')
  .filter((node) => !String(node.parentNode.className).includes('sauce-today-done'))
  .map((node) => node.textContent);

// Fail closed: a test promise that never settles would otherwise let the
// event loop drain and exit 0 before the summary prints.
process.exitCode = 1;

(async () => {
  ok('TV3-LOAD bare class is loader-safe with no trailing statements', () => {
    const View = loadClass({});
    assert.strictEqual(typeof View, 'function');
    assert.strictEqual(SOURCE.trim().endsWith('}'), true);
  });

  ok('RD-DV-TABS each tab selects exactly its own open tasks', () => {
    const View = loadClass({ customJS: { TaskEntity: TE } });
    const tab = (name) => titles(View.selectTab(PARSED, name, TODAY));
    assert.deepStrictEqual(tab('today'), ['Today low', 'Today high']);
    assert.deepStrictEqual(tab('overdue'), ['Overdue mid', 'Stale old'],
      'overdue first, stale after');
    assert.deepStrictEqual(tab('backlog'), ['Backlog item']);
    assert.deepStrictEqual(tab('all'), [
      'Today low', 'Today high', 'Overdue mid', 'Stale old', 'Friday item',
      'Next week item', 'Backlog item', 'Owned undated']);
    assert.deepStrictEqual(tab('nonsense'), ['Today low', 'Today high'],
      'an unknown tab behaves as today');
    assert(!View.selectTab(PARSED, 'all', TODAY).some((t) => t.status === 'done'),
      'done tasks never appear in a tab');
  });

  ok('RD-DV-TABS an overdue tab whose input interleaves stale still lists overdue before stale', () => {
    const View = loadClass({ customJS: { TaskEntity: TE } });
    const mixed = [PARSED[3], PARSED[2]];
    assert.deepStrictEqual(titles(View.selectTab(mixed, 'overdue', TODAY)), ['Overdue mid', 'Stale old']);
  });

  ok('RD-DV-WEEK the week is Monday..Sunday of todayStr, includes today, excludes late tasks', () => {
    const View = loadClass({ customJS: { TaskEntity: TE } });
    const week = (todayStr) => titles(View.selectTab(PARSED, 'week', todayStr));
    assert.deepStrictEqual(week('2026-11-09'), ['Today low', 'Today high', 'Friday item']);
    assert(!week('2026-11-09').includes('Next week item'), 'due 11-16 is next week');
    assert(!week('2026-11-09').includes('Overdue mid'));
    assert(!week('2026-11-09').includes('Stale old'));

    assert.deepStrictEqual(week('2026-11-15'), [],
      'on Sunday the week is still 11-09..11-15, and everything due earlier is already late');
    const sunday = TE.parseNote(page('Sunday item', { due: '2026-11-15' }));
    assert.deepStrictEqual(titles(View.selectTab([sunday, ...PARSED], 'week', TODAY)),
      ['Sunday item', 'Today low', 'Today high', 'Friday item'], 'Sunday closes the week');
    assert.deepStrictEqual(week('2026-11-16'), ['Next week item'],
      'Monday 11-16 begins a new week');
  });

  ok('RD-DV-PREFS written prefs survive any note date; legacy key ignored; corrupt JSON -> defaults', () => {
    const View = loadClass({});
    assert.strictEqual(View.PREFS_KEY, 'sauce-todo-filter:prefs:v2');
    const defaults = { tab: 'today', sort: 'smart', group: 'none' };
    const storage = makeStorage();
    assert.deepStrictEqual(View.readPrefs(storage), defaults);

    const written = View.writePrefs(storage, { tab: 'week', sort: 'due', group: 'project' });
    assert.deepStrictEqual(written, { tab: 'week', sort: 'due', group: 'project' });
    assert.deepStrictEqual(View.readPrefs(storage), written);

    const legacy = makeStorage({
      'sauce-todo-filter:state': JSON.stringify({
        scope: 'all', includeDone: true, sort: 'priority', groupByProject: true, date: TODAY,
      }),
    });
    assert.deepStrictEqual(View.readPrefs(legacy), defaults);
    View.writePrefs(legacy, { tab: 'backlog' });
    assert(legacy.data.has('sauce-todo-filter:state'), 'legacy key is neither migrated nor deleted');
    assert.strictEqual(JSON.parse(legacy.data.get('sauce-todo-filter:state')).scope, 'all');

    storage.data.set(View.PREFS_KEY, '{bad json');
    assert.deepStrictEqual(View.readPrefs(storage), defaults);
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.deepStrictEqual(View.readPrefs(throwing), defaults);
    assert.doesNotThrow(() => View.writePrefs(throwing, { tab: 'all' }));
    assert.deepStrictEqual(View.readPrefs(null), defaults);
  });

  ok('RD-DV-PREFS unknown values fall back per key, and everything other writers produce is accepted', () => {
    const View = loadClass({});
    assert.deepStrictEqual(
      View._normalizePrefs({ tab: 'nonsense', sort: 'touched', group: 'priority' }),
      { tab: 'today', sort: 'touched', group: 'priority' });
    assert.deepStrictEqual(
      View._normalizePrefs({ tab: 'overdue', sort: 'sideways', group: 'project' }),
      { tab: 'overdue', sort: 'smart', group: 'project' });
    assert.deepStrictEqual(
      View._normalizePrefs({ tab: 'backlog', sort: 'oldest', group: 'sideways', extra: 1 }),
      { tab: 'backlog', sort: 'oldest', group: 'none' });
    for (const bad of [null, undefined, 'x', 3, [], true]) {
      assert.deepStrictEqual(View._normalizePrefs(bad), { tab: 'today', sort: 'smart', group: 'none' });
    }
    for (const t of ['today', 'week', 'overdue', 'backlog', 'all']) {
      assert.strictEqual(View._normalizePrefs({ tab: t }).tab, t);
    }
    for (const m of ['smart', 'manual', 'priority', 'due', 'oldest', 'touched']) {
      assert.strictEqual(View._normalizePrefs({ sort: m }).sort, m);
    }

    const storage = makeStorage({
      [View.PREFS_KEY]: JSON.stringify({ tab: 'backlog', sort: 'priority', group: 'due', note: 'kept' }),
    });
    View.writePrefs(storage, { tab: 'week' });
    const raw = JSON.parse(storage.data.get(View.PREFS_KEY));
    assert.deepStrictEqual(
      { tab: raw.tab, sort: raw.sort, group: raw.group }, { tab: 'week', sort: 'priority', group: 'due' });
    assert.strictEqual(raw.note, 'kept', 'keys this view does not own survive a write');
  });

  ok('RD-DV-GROUP project / priority / due groups: exact labels and order', () => {
    const View = loadClass({ customJS: { TaskEntity: TE } });
    const open = View.selectTab(PARSED, 'all', TODAY);

    const byProject = View.groupTasks(open, 'project', TODAY);
    assert.deepStrictEqual(byProject.map((g) => g.label), ['Atlas', 'Zeta', 'No project']);
    assert.deepStrictEqual(titles(byProject[0].tasks), ['Today low', 'Friday item']);
    assert.deepStrictEqual(titles(byProject[1].tasks), ['Owned undated']);
    assert.strictEqual(byProject.flatMap((g) => g.tasks).length, open.length);

    const byPriority = View.groupTasks(open, 'priority', TODAY);
    assert.deepStrictEqual(byPriority.map((g) => g.label), ['Highest', 'High', 'Medium', 'Low', 'None']);
    assert.deepStrictEqual(titles(byPriority[0].tasks), ['Stale old']);
    assert.deepStrictEqual(titles(byPriority[1].tasks), ['Today high', 'Friday item']);
    assert.deepStrictEqual(titles(byPriority[4].tasks), ['Owned undated']);

    const byDue = View.groupTasks(open, 'due', TODAY);
    assert.deepStrictEqual(byDue.map((g) => g.label),
      ['Tue Sep 1', 'Thu Nov 5', 'Mon Nov 9', 'Fri Nov 13', 'Mon Nov 16', 'No date']);
    assert.deepStrictEqual(titles(byDue[2].tasks), ['Today low', 'Today high']);
    assert.deepStrictEqual(titles(byDue[5].tasks), ['Backlog item', 'Owned undated']);

    const none = View.groupTasks(open, 'none', TODAY);
    assert.strictEqual(none.length, 1);
    assert.deepStrictEqual(titles(none[0].tasks), titles(open));
    assert.deepStrictEqual(View.groupTasks([], 'project', TODAY), []);
    assert.deepStrictEqual(View.groupTasks([], 'none', TODAY), []);
  });

  ok('RD-DV-SORT each sort mode orders through TaskEntity.compareBy', () => {
    const modes = [];
    const spy = Object.create(TE);
    spy.compareBy = (mode, todayStr) => { modes.push([mode, todayStr]); return TE.compareBy(mode, todayStr); };
    const View = loadClass({ customJS: { TaskEntity: spy } });
    const open = View.selectTab(PARSED, 'all', TODAY);
    for (const mode of ['smart', 'manual', 'priority', 'due', 'oldest', 'touched']) {
      const sorted = View.sortTasks(open, mode, TODAY);
      const expected = open.slice().sort(TE.compareBy(mode, TODAY));
      assert.deepStrictEqual(titles(sorted), titles(expected), `mode ${mode}`);
      assert.deepStrictEqual(modes[modes.length - 1], [mode, TODAY]);
    }
    assert.deepStrictEqual(titles(View.sortTasks(open, 'priority', TODAY)).slice(0, 2),
      ['Stale old', 'Friday item']);
    assert.deepStrictEqual(titles(View.sortTasks(open, 'due', TODAY)).slice(0, 3),
      ['Stale old', 'Overdue mid', 'Today high']);
    assert.deepStrictEqual(titles(open), titles(View.selectTab(PARSED, 'all', TODAY)),
      'sortTasks does not mutate its input');
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

    const bare = makeElement('div', 'sauce-task-today-row');
    bare.createEl('div', { cls: 'sauce-task-today-titlegroup' });
    assert(String(View.decorateRow(bare, {}).className).includes('is-none'));

    assert.doesNotThrow(() => View.decorateRow(makeElement('div', 'x'), { priority: 'low' }));
    assert.strictEqual(View.decorateRow(null, { priority: 'low' }), null);
  });

  ok('RD-DV-VIEWEDDAY a ToDo-YYYY-MM-DD note views its own date; any other note views today', () => {
    const View = loadClass({});
    assert.strictEqual(View.viewedDay({ file: { name: 'ToDo-2026-11-02' } }, TODAY), '2026-11-02');
    assert.strictEqual(View.viewedDay({ file: { name: 'ToDo-2026-11-02.md' } }, TODAY), '2026-11-02');
    assert.strictEqual(View.viewedDay({ file: { name: 'Some Other Note' } }, TODAY), TODAY);
    assert.strictEqual(View.viewedDay({ file: {} }, TODAY), TODAY);
    assert.strictEqual(View.viewedDay(null, TODAY), TODAY);
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

  await okAsync('RD-DV-RENDER tab bar, counts, hosts, Sort/Group buttons and row options', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);

    assert.strictEqual(env.clock.reads, 1, 'render reads the live clock exactly once');
    assert.strictEqual(byClass(root, 'sauce-todo-above-tabs').length, 1, 'slot above the tabs');
    assert.strictEqual(byClass(root, 'sauce-todo-daily-filter-list-host').length, 1, 'list host');
    assert.strictEqual(byClass(root, 'sauce-todo-filter-done-host').length, 1, 'done host');
    assert.strictEqual(byClass(root, 'sauce-todo-filter-controls').length, 1);

    assert.deepStrictEqual(buttonsOf(controlsOf(root)).map((b) => b.textContent),
      ['Today', 'This week', 'Overdue · 2', 'Backlog · 1', 'All open', 'Sort ▾', 'Group ▾', 'Select']);
    assert(String(findButton(root, 'Today').className).includes('is-active'));
    assert.strictEqual(findButton(root, 'Today').attributes['aria-selected'], 'true');
    assert.strictEqual(findButton(root, 'This week').attributes['aria-selected'], 'false');

    assert.deepStrictEqual(env.rows.map((r) => r.title), ['Today high', 'Today low'],
      'smart sort: priority within today');
    for (const r of env.rows) {
      assert.strictEqual(r.options.viewedDay, TODAY);
      assert.strictEqual(r.options.todayStr, TODAY);
    }

    assert.strictEqual(byClass(root, 'sauce-task-priority-dot').length, 0,
      'the row owns the priority bar; no separate dot');
  });

  await okAsync('RD-DV-RENDER tab labels omit the count when it is zero', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env, PAGES.filter((p) => p.title.startsWith('Today')));
    assert.deepStrictEqual(buttonsOf(controlsOf(root)).slice(0, 5).map((b) => b.textContent),
      ['Today', 'This week', 'Overdue', 'Backlog', 'All open']);
  });

  await okAsync('RD-DV-RENDER a dated ToDo note passes its own date as viewedDay', async () => {
    const env = makeRenderHarness();
    env.customJS.RenderSafe.page = () => ({ type: 'to-do', file: { name: 'ToDo-2026-11-02' } });
    await mount(env);
    assert(env.rows.length > 0);
    for (const r of env.rows) {
      assert.strictEqual(r.options.viewedDay, '2026-11-02');
      assert.strictEqual(r.options.todayStr, TODAY, 'todayStr is the live clock, not the note date');
    }
  });

  await okAsync('RD-DV-RENDER switching tabs repaints and persists across mounts (not keyed by date)', async () => {
    const env = makeRenderHarness();
    const { View, root } = await mount(env);

    await findButton(root, 'This week').fire('click');
    assert.deepStrictEqual(listTitles(root), ['Friday item', 'Today high', 'Today low']);
    assert(String(findButton(root, 'This week').className).includes('is-active'));
    assert(!String(findButton(root, 'Today').className).includes('is-active'));
    assert.deepStrictEqual(View.readPrefs(env.storage), { tab: 'week', sort: 'smart', group: 'none' });

    await findButton(root, 'All open').fire('click');
    assert.strictEqual(listTitles(root).length, 8);

    const nextDay = makeRenderHarness();
    nextDay.windowShim.localStorage = env.storage;
    nextDay.customJS.RenderSafe.page = () => ({ type: 'to-do', file: { name: 'ToDo-2026-11-10' } });
    const second = await mount(nextDay);
    assert(String(findButton(second.root, 'All open').className).includes('is-active'),
      'a different note date restores the same tab');
  });

  await okAsync('RD-DV-RENDER re-clicking the active tab costs no write and no repaint', async () => {
    const env = makeRenderHarness();
    let writes = 0;
    const setItem = env.storage.setItem.bind(env.storage);
    env.storage.setItem = (k, v) => { writes += 1; return setItem(k, v); };
    const { root } = await mount(env);
    await findButton(root, 'Overdue · 2').fire('click');
    const writesAfter = writes;
    const paintedAfter = env.rows.length;
    assert(writesAfter > 0);
    await findButton(root, 'Overdue · 2').fire('click');
    assert.strictEqual(writes, writesAfter);
    assert.strictEqual(env.rows.length, paintedAfter);
    assert(String(findButton(root, 'Overdue · 2').className).includes('is-active'));
  });

  await okAsync('RD-DV-RENDER Overdue tab: overdue rows, a labelled divider, then dimmed stale rows', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    await findButton(root, 'Overdue · 2').fire('click');

    const host = byClass(root, 'sauce-todo-daily-filter-list-host')[0];
    const order = descendants(host).filter((n) =>
      String(n.className).includes('sauce-task-today-row')
      || String(n.className).includes('sauce-todo-stale-divider'));
    assert.deepStrictEqual(
      order.map((n) => (String(n.className).includes('divider') ? `--${n.textContent}--` : n.dataset.sauceTaskPath)),
      ['spice/tasks/Overdue mid.md', '--Stale · overdue 30+ days--', 'spice/tasks/Stale old.md']);
    const staleRow = order[2];
    assert(String(staleRow.className).split(/\s+/).includes('is-stale'));
    assert(!String(order[0].className).split(/\s+/).includes('is-stale'));
  });

  await okAsync('RD-DV-RENDER Backlog and Week tabs paint their own tasks', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    await findButton(root, 'Backlog · 1').fire('click');
    assert.deepStrictEqual(listTitles(root), ['Backlog item']);
    await findButton(root, 'This week').fire('click');
    assert.deepStrictEqual(listTitles(root), ['Friday item', 'Today high', 'Today low']);
  });

  await okAsync('RD-DV-RENDER an empty tab says so', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env, []);
    assert.strictEqual(byClass(root, 'sauce-todo-filter-empty').length, 1);
    assert.strictEqual(env.rows.length, 0);
  });

  await okAsync('RD-DV-RENDER group sections follow the Group setting', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    await findButton(root, 'All open').fire('click');
    env.menus.length = 0;
    await findButton(root, 'Group ▾').fire('click');
    const entries = env.menus[0].entries;
    await entries.find((e) => e.label === 'Priority').onSelect();
    const labels = byClass(root, 'sauce-section-label').map((n) => n.textContent);
    assert.deepStrictEqual(labels, ['Highest', 'High', 'Medium', 'Low', 'None']);
  });

  await okAsync('RD-DV-MENU Sort and Group are MenuPopover menus with the ruled labels and descriptions', async () => {
    const env = makeRenderHarness();
    const { View, root } = await mount(env);
    const sortBtn = findButton(root, 'Sort ▾');
    await sortBtn.fire('click');
    assert.strictEqual(env.menus.length, 1);
    assert.strictEqual(env.menus[0].anchor, sortBtn);
    assert.deepStrictEqual(env.menus[0].entries.map((e) => [e.label, e.sublabel]), [
      ['Smart', 'your order → priority → days late'],
      ['My order', 'drag to arrange'],
      ['Priority', 'highest first'],
      ['Due date', 'soonest first'],
      ['Oldest first', 'by created date'],
      ['Last touched', 'recently edited first'],
    ]);
    assert.deepStrictEqual(env.menus[0].entries.map((e) => !!e.icon), [true, false, false, false, false, false],
      'the current mode is marked');

    await env.menus[0].entries[3].onSelect();
    assert.strictEqual(View.readPrefs(env.storage).sort, 'due');
    await findButton(root, 'Sort ▾').fire('click');
    assert.deepStrictEqual(env.menus[1].entries.map((e) => !!e.icon), [false, false, false, true, false, false]);

    await findButton(root, 'Group ▾').fire('click');
    assert.deepStrictEqual(env.menus[2].entries.map((e) => e.label), ['None', 'Project', 'Priority', 'Due day']);
    await env.menus[2].entries[1].onSelect();
    assert.strictEqual(View.readPrefs(env.storage).group, 'project');
    assert.strictEqual(View.readPrefs(env.storage).sort, 'due', 'sort survives a group change');
  });

  await okAsync('RD-DV-MENU sort changes reorder the list', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    await findButton(root, 'All open').fire('click');
    assert.deepStrictEqual(listTitles(root).slice(0, 2), ['Stale old', 'Friday item']);
    await findButton(root, 'Sort ▾').fire('click');
    await env.menus[0].entries.find((e) => e.label === 'Due date').onSelect();
    assert.deepStrictEqual(listTitles(root).slice(0, 3), ['Stale old', 'Overdue mid', 'Today high']);
  });

  await okAsync('RD-DV-MENU without MenuPopover a click cycles to the next mode', async () => {
    const env = makeRenderHarness({ noMenu: true });
    const { View, root } = await mount(env);
    await findButton(root, 'Sort ▾').fire('click');
    assert.strictEqual(View.readPrefs(env.storage).sort, 'manual');
    await findButton(root, 'Group ▾').fire('click');
    assert.strictEqual(View.readPrefs(env.storage).group, 'project');
    for (let i = 0; i < 6; i += 1) await findButton(root, 'Sort ▾').fire('click');
    assert.strictEqual(View.readPrefs(env.storage).sort, 'manual', 'cycle wraps around');
  });

  await okAsync('RD-DV-DONE Done today section appears only on the Today tab, newest first', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    const doneHost = byClass(root, 'sauce-todo-filter-done-host')[0];
    assert.strictEqual(byClass(doneHost, 'sauce-section-label')[0].textContent, 'Done today · 2');
    const rows = byClass(doneHost, 'sauce-today-done-row');
    assert.deepStrictEqual(rows.map((r) => r.querySelector('.sauce-today-done-title').textContent),
      ['Done last night', 'Done this morning']);
    assert.deepStrictEqual(byClass(doneHost, 'sauce-today-done-time').map((n) => n.textContent),
      ['21:40', '09:15']);
    assert(!rows.some((r) => r.textContent.includes('Done yesterday')));
    const title = rows[0].querySelector('.sauce-today-done-title');
    assert(/line-through/.test(title.style.cssText), 'done titles are struck');

    for (const label of ['This week', 'Overdue · 2', 'Backlog · 1', 'All open']) {
      await findButton(root, label).fire('click');
      assert.strictEqual(byClass(doneHost, 'sauce-today-done-row').length, 0, `no Done today on ${label}`);
      assert.strictEqual(doneHost.children.length, 0);
    }
    await findButton(root, 'Today').fire('click');
    assert.strictEqual(byClass(doneHost, 'sauce-today-done-row').length, 2);
  });

  await okAsync('RD-DV-DONE no completions today means no Done today section', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env, PAGES.filter((p) => p.status === 'open'));
    assert.strictEqual(byClass(root, 'sauce-today-done-row').length, 0);
    assert.strictEqual(byClass(root, 'sauce-todo-filter-done-host')[0].children.length, 0);
  });

  await okAsync('RD-DV-UNDO Undo reopens the task, moves it back to the list and drops the Done row', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    const undo = byClass(root, 'sauce-today-undo').find((b) => b.attributes['aria-label'] === 'Undo: Done this morning');
    assert(undo, 'Undo carries an aria-label naming the task');
    assert.strictEqual(undo.textContent, 'Undo');
    await undo.fire('click');
    assert.deepStrictEqual(env.reopened, ['spice/tasks/_done/Done this morning.md']);
    assert(listTitles(root).includes('Done this morning'), 'reopened task lands back in Today');
    assert.strictEqual(byClass(root, 'sauce-today-done-row').length, 1);
    assert.deepStrictEqual(env.notices, []);
  });

  await okAsync('RD-DV-UNDO silent refusals raise a Notice and keep the row; noticed failures stay quiet', async () => {
    for (const reason of ['in-flight', 'render-safe-unavailable', 'not-done', 'task file not found']) {
      const env = makeRenderHarness({ reopenResult: () => ({ ok: false, reason }) });
      const { root } = await mount(env);
      const undo = byClass(root, 'sauce-today-undo')[0];
      await undo.fire('click');
      assert.deepStrictEqual(env.notices, [`Could not reopen task: ${reason}`], reason);
      assert.strictEqual(byClass(root, 'sauce-today-done-row').length, 2);
      assert.strictEqual(undo.disabled, false, 'Undo is usable again');
    }
    const env = makeRenderHarness({ reopenResult: () => ({ ok: false, reason: 'write failed' }) });
    const { root } = await mount(env);
    await byClass(root, 'sauce-today-undo')[0].fire('click');
    assert.deepStrictEqual(env.notices, [], 'the write rail already told the user');
    assert.strictEqual(byClass(root, 'sauce-today-done-row').length, 2);
  });

  await okAsync('RD-DV-CACHE rescheduling a row repaints counts and list from the new due', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    const hit = env.rows.find((r) => r.title === 'Today low');
    hit.options.onRescheduled({ path: 'spice/tasks/Today low.md' }, '2026-11-10');
    assert(!listTitles(root).includes('Today low'));
    assert(listTitles(root).includes('Today high'));
  });

  await okAsync('RD-DV-INTEROP prefs written by SpaceDailyDashboard are read back with other keys intact', async () => {
    const View = loadClass({});
    const storage = makeStorage({
      [View.PREFS_KEY]: JSON.stringify({ tab: 'week', sort: 'due', group: 'priority', note: 'kept' }),
    });
    const dashboardWindow = { localStorage: storage };
    const Dashboard = new Function('window', 'customJS',
      `${fs.readFileSync(path.join(ROOT, 'platform/blueprints/daily/helpers/space-daily-dashboard.js'), 'utf8')}\nreturn SpaceDailyDashboard;`)(dashboardWindow, undefined);
    assert.strictEqual(Dashboard.writeTodayPrefs({ tab: 'overdue' }, storage), true);
    assert.deepStrictEqual(View.readPrefs(storage), { tab: 'overdue', sort: 'due', group: 'priority' });
    assert.strictEqual(JSON.parse(storage.data.get(View.PREFS_KEY)).note, 'kept');

    assert.strictEqual(Dashboard.writeTodayPrefs({ tab: 'backlog' }, storage), true);
    assert.deepStrictEqual(View.readPrefs(storage), { tab: 'backlog', sort: 'due', group: 'priority' });
    assert.strictEqual(JSON.parse(storage.data.get(View.PREFS_KEY)).note, 'kept');
    assert.deepStrictEqual(Dashboard.readTodayPrefs(storage), { tab: 'backlog', sort: 'due', group: 'priority' });
  });

  const lastRow = (env, title) => env.rows.filter((r) => r.title === title).pop();
  const bulkBar = (root) => byClass(root, 'sauce-todo-bulkbar')[0] || null;
  const bulkButton = (root, label) => findButton(bulkBar(root), label);
  const select = (env, ...names) => {
    for (const name of names) {
      const r = lastRow(env, name);
      r.options.onSelect(r.task, true);
    }
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  ok('RD-DV-RENUMBER renumber is pure, returns only changed ranks, and delegates to TaskEntity', () => {
    const View = loadClass({ customJS: { TaskEntity: TE } });
    assert.deepStrictEqual(View.renumber(['a', 'b', 'c'], { a: 1, c: 2 }),
      [{ path: 'b', rank: 2 }, { path: 'c', rank: 3 }]);
    assert.deepStrictEqual(View.renumber(['a', 'b'], { a: 1, b: 2 }), [], 'nothing changes, nothing written');
    const spy = Object.create(TE);
    const seen = [];
    spy.renumber = (...args) => { seen.push(args); return TE.renumber(...args); };
    loadClass({ customJS: { TaskEntity: spy } }).renumber(['x'], {});
    assert.deepStrictEqual(seen, [[['x'], {}]], 'one implementation: TaskEntity.renumber');
    assert.deepStrictEqual(loadClass({}).renumber(['a'], {}), [], 'cold load renumbers nothing');
  });

  ok('RD-DV-STRIP week strip: all seven days Mon-Sun, counts open tasks, flags today', () => {
    const View = loadClass({ customJS: { TaskEntity: TE } });
    const cells = (list, todayStr) => View.weekStrip(list, todayStr).map((c) => [c.date, c.label, c.count, c.isToday]);
    assert.deepStrictEqual(cells(PARSED, TODAY), [
      ['2026-11-09', 'Mon 9', 2, true],
      ['2026-11-10', 'Tue 10', 0, false],
      ['2026-11-11', 'Wed 11', 0, false],
      ['2026-11-12', 'Thu 12', 0, false],
      ['2026-11-13', 'Fri 13', 1, false],
      ['2026-11-14', 'Sat 14', 0, false],
      ['2026-11-15', 'Sun 15', 0, false],
    ], 'an empty weekend still shows Saturday and Sunday');
    const sunday = TE.parseNote(page('Sunday item', { due: '2026-11-15' }));
    const doneSaturday = TE.parseNote(page('Done Saturday', {
      status: 'done', due: '2026-11-14', file: { path: 'spice/tasks/_done/Done Saturday.md' },
    }));
    const withWeekend = cells([...PARSED, sunday, doneSaturday], TODAY);
    assert.strictEqual(withWeekend.length, 7, 'always seven cells');
    assert.deepStrictEqual(withWeekend[5], ['2026-11-14', 'Sat 14', 0, false], 'a done task does not count');
    assert.deepStrictEqual(withWeekend[6], ['2026-11-15', 'Sun 15', 1, false], 'an open Sunday task counts');
    const midweek = cells(PARSED, '2026-11-11');
    assert.deepStrictEqual(midweek.map((c) => c[3]), [false, false, true, false, false, false, false], 'Wednesday is today');
    assert.strictEqual(midweek[0][2], 2, 'a past day of this week still counts its open tasks');
    const sundayToday = cells(PARSED, '2026-11-15');
    assert.deepStrictEqual(sundayToday.map((c) => c[0])[0], '2026-11-09', 'Sunday belongs to the Monday-started week');
    assert.strictEqual(sundayToday[6][3], true, 'Sunday flagged as today');
    assert.deepStrictEqual(View.weekStrip(PARSED, 'garbage'), []);
    assert.deepStrictEqual(loadClass({}).weekStrip(PARSED, TODAY), [], 'cold load: no strip');
  });

  ok('RD-DV-BULK-WRAP bulk bar CSS wraps and goes full width below 720px', () => {
    const css = loadClass({}).BULKBAR_CSS;
    assert(/\.sauce-todo-bulkbar\s*\{[^}]*flex-wrap:\s*wrap/.test(css), 'flex-wrap: wrap on the bar');
    assert(/@media\s*\(max-width:\s*720px\)\s*\{[^@]*\.sauce-todo-bulkbar\s*\{[^}]*width:\s*100%/.test(css),
      'full width below 720px');
  });

  await okAsync('RD-DV-BULK-WRAP the rendered view carries the bulk bar stylesheet', async () => {
    const env = makeRenderHarness();
    const { View, root } = await mount(env);
    const styles = descendants(root).filter((n) => n.tagName === 'STYLE');
    assert.strictEqual(styles.length, 1);
    assert.strictEqual(styles[0].textContent, View.BULKBAR_CSS);
  });

  await okAsync('RD-DV-SEL Select toggles selection mode; selection survives tab switches; exit clears it', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    assert(!lastRow(env, 'Today high').options.selectable, 'not selectable before Select');
    assert.strictEqual(bulkBar(root), null, 'no bar before anything is selected');
    const selectBtn = findButton(controlsOf(root), 'Select');
    assert(byClass(root, 'sauce-todo-filter-right')[0].children.includes(selectBtn), 'Select lives in the right cluster');
    assert.strictEqual(selectBtn.attributes['aria-pressed'], 'false');

    await selectBtn.fire('click');
    assert.strictEqual(selectBtn.attributes['aria-pressed'], 'true');
    assert(String(selectBtn.className).includes('is-active'));
    assert.strictEqual(lastRow(env, 'Today high').options.selectable, true);
    assert.strictEqual(lastRow(env, 'Today high').options.selected, false);
    assert.strictEqual(bulkBar(root), null, 'bar stays hidden with 0 selected');

    select(env, 'Today high');
    assert.strictEqual(byClass(bulkBar(root), 'sauce-todo-bulk-count')[0].textContent, '1 selected');
    assert.deepStrictEqual(buttonsOf(bulkBar(root)).map((b) => b.textContent),
      ['→ Tomorrow', '→ Next Mon', 'Priority ▾', 'Project ▾', 'Backlog', 'Mark done']);

    await findButton(controlsOf(root), 'All open').fire('click');
    assert.strictEqual(byClass(bulkBar(root), 'sauce-todo-bulk-count')[0].textContent, '1 selected');
    assert.strictEqual(lastRow(env, 'Today high').options.selected, true, 'selected row repaints checked');
    assert.strictEqual(lastRow(env, 'Friday item').options.selected, false);
    assert(!String(env.storage.data.get('sauce-todo-filter:prefs:v2')).includes('spice/tasks'),
      'selection is never persisted');

    const r = lastRow(env, 'Today high');
    r.options.onSelect(r.task, false);
    assert.strictEqual(bulkBar(root), null, 'deselecting the last row hides the bar');

    select(env, 'Friday item', 'Backlog item');
    assert.strictEqual(byClass(bulkBar(root), 'sauce-todo-bulk-count')[0].textContent, '2 selected');
    await selectBtn.fire('click');
    assert.strictEqual(bulkBar(root), null);
    assert(!lastRow(env, 'Friday item').options.selectable, 'leaving Select mode drops the squares');
    await selectBtn.fire('click');
    assert.strictEqual(lastRow(env, 'Friday item').options.selected, false, 'exiting Select cleared the set');
    assert.strictEqual(bulkBar(root), null);
  });

  await okAsync('RD-DV-SEL-BULK 3 selected -> Next Mon: 3 sequential reschedules; the rejected one stays selected', async () => {
    let active = 0;
    let overlapped = false;
    const env = makeRenderHarness({
      async reschedule(taskPath, newDue) {
        active += 1;
        if (active > 1) overlapped = true;
        await flush();
        active -= 1;
        if (taskPath.endsWith('Friday item.md')) throw new Error('disk gone');
        return { ok: true, due: newDue };
      },
    });
    const { root } = await mount(env);
    await findButton(controlsOf(root), 'All open').fire('click');
    await findButton(controlsOf(root), 'Select').fire('click');
    select(env, 'Today low', 'Friday item', 'Backlog item');
    assert.strictEqual(byClass(bulkBar(root), 'sauce-todo-bulk-count')[0].textContent, '3 selected');

    await bulkButton(root, '→ Next Mon').fire('click');
    assert.deepStrictEqual(env.calls.reschedule.map((c) => [c.path, c.newDue, c.viewedDay, c.hasRow]), [
      ['spice/tasks/Today low.md', '2026-11-16', TODAY, true],
      ['spice/tasks/Friday item.md', '2026-11-16', TODAY, true],
      ['spice/tasks/Backlog item.md', '2026-11-16', TODAY, true],
    ]);
    assert(env.calls.reschedule.every((c) => c.TD === env.customJS.TaskDialog), 'TaskDialog passed through');
    assert.strictEqual(overlapped, false, 'one task at a time');
    assert.strictEqual(byClass(bulkBar(root), 'sauce-todo-bulk-count')[0].textContent, '1 selected');
    assert.strictEqual(lastRow(env, 'Friday item').options.selected, true, 'the failed row stays selected');
    assert.strictEqual(lastRow(env, 'Today low').options.selected, false);
    assert.deepStrictEqual(env.notices, ['Could not move 1 task'], 'one summary Notice');
    assert.deepStrictEqual(buttonsOf(controlsOf(root)).slice(0, 4).map((b) => b.textContent),
      ['Today', 'This week', 'Overdue · 2', 'Backlog'], 'counts repaint from the moved due dates');
  });

  await okAsync('RD-DV-SEL-NOTICE runBulk: sequential; only silent failures reach the one summary Notice', async () => {
    const View = loadClass({});
    const results = {
      a: { ok: true, due: '2026-11-10' },
      b: { ok: false, reason: 'write failed' },
      c: { ok: false, no_op: true },
      d: { ok: false, reason: 'task file not found' },
    };
    const order = [];
    const notices = [];
    const okPaths = [];
    const out = await View.runBulk(['a', 'b', 'c', 'd', 'e'], async (p) => {
      order.push(`start ${p}`);
      await flush();
      order.push(`end ${p}`);
      if (p === 'e') throw new Error('boom');
      return results[p];
    }, {
      classify: (res) => TTL_REAL.classifyOutcome(res),
      notice: (m) => notices.push(m),
      onOk: (p) => okPaths.push(p),
      verb: 'move',
    });
    assert.deepStrictEqual(out, { done: ['a'], failed: ['b', 'd', 'e'] }, 'skipped is neither done nor failed');
    assert.deepStrictEqual(order, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c',
      'start d', 'end d', 'start e', 'end e']);
    assert.deepStrictEqual(okPaths, ['a']);
    assert.deepStrictEqual(notices, ['Could not move 2 tasks'], 'noticed failure b already told the user');

    const quiet = [];
    const clean = await View.runBulk(['a', 'c'], async (p) => results[p], {
      classify: (res) => TTL_REAL.classifyOutcome(res), notice: (m) => quiet.push(m), verb: 'move',
    });
    assert.deepStrictEqual(clean, { done: ['a'], failed: [] });
    assert.deepStrictEqual(quiet, [], 'no failures, no Notice');

    const all = [];
    await View.runBulk(['b', 'd'], async (p) => results[p], {
      classify: (res) => TTL_REAL.classifyOutcome(res), notice: (m) => all.push(m), verb: 'complete', noticeAll: true,
    });
    assert.deepStrictEqual(all, ['Could not complete 2 tasks'], 'a rail with no Notice of its own counts every failure');
    assert.deepStrictEqual(await View.runBulk(null, null, null), { done: [], failed: [] });
  });

  await okAsync('RD-DV-SEL-ACTIONS Tomorrow / Backlog reschedule; Priority and Project menus write fields', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    await findButton(controlsOf(root), 'Select').fire('click');
    select(env, 'Today high', 'Today low');
    await bulkButton(root, '→ Tomorrow').fire('click');
    assert.deepStrictEqual(env.calls.reschedule.map((c) => [c.path, c.newDue]), [
      ['spice/tasks/Today high.md', '2026-11-10'], ['spice/tasks/Today low.md', '2026-11-10']]);
    assert.deepStrictEqual(listTitles(root), [], 'both left Today');
    assert.strictEqual(bulkBar(root), null, 'everything succeeded, nothing left selected');

    await findButton(controlsOf(root), 'All open').fire('click');
    select(env, 'Backlog item', 'Friday item');
    env.calls.reschedule.length = 0;
    await bulkButton(root, 'Backlog').fire('click');
    assert.deepStrictEqual(env.calls.reschedule.map((c) => [c.path, c.newDue]), [
      ['spice/tasks/Backlog item.md', ''], ['spice/tasks/Friday item.md', '']]);

    select(env, 'Overdue mid', 'Stale old');
    env.menus.length = 0;
    const prioBtn = bulkButton(root, 'Priority ▾');
    await prioBtn.fire('click');
    assert.strictEqual(env.menus[0].anchor, prioBtn);
    assert.deepStrictEqual(env.menus[0].entries.map((e) => e.label), ['None', 'Low', 'Medium', 'High', 'Highest']);
    await env.menus[0].entries.find((e) => e.label === 'High').onSelect();
    assert.deepStrictEqual(env.calls.setFields, [
      { path: 'spice/tasks/Overdue mid.md', fields: { priority: 'high' } },
      { path: 'spice/tasks/Stale old.md', fields: { priority: 'high' } },
    ]);
    assert.strictEqual(bulkBar(root), null);

    select(env, 'Overdue mid');
    env.calls.setFields.length = 0;
    await bulkButton(root, 'Priority ▾').fire('click');
    await env.menus[env.menus.length - 1].entries.find((e) => e.label === 'None').onSelect();
    assert.deepStrictEqual(env.calls.setFields, [{ path: 'spice/tasks/Overdue mid.md', fields: { priority: '' } }]);
    assert.strictEqual(lastRow(env, 'Overdue mid').task.priority, '', 'the cache repaints the new priority');

    select(env, 'Overdue mid', 'Today high');
    env.calls.setFields.length = 0;
    const projBtn = bulkButton(root, 'Project ▾');
    await projBtn.fire('click');
    const projMenu = env.menus[env.menus.length - 1];
    assert.strictEqual(projMenu.anchor, projBtn);
    assert.strictEqual(env.calls.projectApp, env.appStub, 'project list read through the live app');
    assert.deepStrictEqual(projMenu.entries.map((e) => e.label), ['No project', 'Atlas', 'Zeta Works']);
    await projMenu.entries.find((e) => e.label === 'Zeta Works').onSelect();
    assert.deepStrictEqual(env.calls.setFields, [
      { path: 'spice/tasks/Overdue mid.md', fields: { project: '[[Zeta Works]]', project_slug: 'zeta-works' } },
      { path: 'spice/tasks/Today high.md', fields: { project: '[[Zeta Works]]', project_slug: 'zeta-works' } },
    ]);

    select(env, 'Today low');
    env.calls.setFields.length = 0;
    await bulkButton(root, 'Project ▾').fire('click');
    await env.menus[env.menus.length - 1].entries.find((e) => e.label === 'No project').onSelect();
    assert.deepStrictEqual(env.calls.setFields,
      [{ path: 'spice/tasks/Today low.md', fields: { project: '', project_slug: '' } }]);
  });

  await okAsync('RD-DV-SEL-DONE Mark done completes each through TaskDialog.markDone and lands in Done today', async () => {
    const env = makeRenderHarness({
      markDone: (p) => (p.endsWith('Today low.md') ? { ok: false, reason: 'rename failed' } : { ok: true }),
    });
    const { root } = await mount(env);
    await findButton(controlsOf(root), 'Select').fire('click');
    select(env, 'Today high', 'Today low');
    await bulkButton(root, 'Mark done').fire('click');
    assert.deepStrictEqual(env.calls.markDone, ['spice/tasks/Today high.md', 'spice/tasks/Today low.md']);
    assert.deepStrictEqual(listTitles(root), ['Today low']);
    const doneHost = byClass(root, 'sauce-todo-filter-done-host')[0];
    assert.strictEqual(byClass(doneHost, 'sauce-section-label')[0].textContent, 'Done today · 3');
    assert(byClass(doneHost, 'sauce-today-done-row').some((r) => r.textContent.includes('Today high')));
    assert.strictEqual(byClass(bulkBar(root), 'sauce-todo-bulk-count')[0].textContent, '1 selected');
    assert.deepStrictEqual(env.notices, ['Could not complete 1 task'],
      'markDone has no Notice of its own, so its failures are summarised');
  });

  await okAsync('RD-DV-MOVE manual order: onMove(task, -1) on the second Today row renumbers', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    assert.deepStrictEqual(listTitles(root), ['Today high', 'Today low']);
    for (const name of ['Today high', 'Today low']) {
      assert.strictEqual(lastRow(env, name).options.dragHandle, true, `${name} has a handle`);
      assert.strictEqual(typeof lastRow(env, name).options.onMove, 'function');
    }
    const second = lastRow(env, 'Today low');
    await second.options.onMove(second.task, -1);
    assert.deepStrictEqual(env.calls.setFields, [
      { path: 'spice/tasks/Today low.md', fields: { rank: 1 } },
      { path: 'spice/tasks/Today high.md', fields: { rank: 2 } },
    ]);
    assert.deepStrictEqual(listTitles(root), ['Today low', 'Today high']);

    env.calls.setFields.length = 0;
    const top = lastRow(env, 'Today low');
    await top.options.onMove(top.task, -1);
    assert.deepStrictEqual(env.calls.setFields, [], 'moving the top row up writes nothing');
    const again = lastRow(env, 'Today high');
    await again.options.onMove(again.task, -1);
    assert.deepStrictEqual(env.calls.setFields, [
      { path: 'spice/tasks/Today high.md', fields: { rank: 1 } },
      { path: 'spice/tasks/Today low.md', fields: { rank: 2 } },
    ], 'ranks already 1..n: only the swapped pair is written');
  });

  await okAsync('RD-DV-MOVE manual order only on Today with Smart / My order and no grouping', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    await findButton(root, 'Sort ▾').fire('click');
    await env.menus[env.menus.length - 1].entries.find((e) => e.label === 'My order').onSelect();
    assert.strictEqual(lastRow(env, 'Today high').options.dragHandle, true, 'My order keeps the handle');
    await findButton(root, 'Sort ▾').fire('click');
    await env.menus[env.menus.length - 1].entries.find((e) => e.label === 'Priority').onSelect();
    assert(lastRow(env, 'Today high').options.dragHandle !== true && !lastRow(env, 'Today high').options.onMove,
      'Priority sort: no manual order');
    await findButton(root, 'Sort ▾').fire('click');
    await env.menus[env.menus.length - 1].entries.find((e) => e.label === 'Smart').onSelect();
    await findButton(root, 'Group ▾').fire('click');
    await env.menus[env.menus.length - 1].entries.find((e) => e.label === 'Project').onSelect();
    assert(lastRow(env, 'Today high').options.dragHandle !== true && !lastRow(env, 'Today high').options.onMove,
      'grouped: no manual order');
    await findButton(root, 'Group ▾').fire('click');
    await env.menus[env.menus.length - 1].entries.find((e) => e.label === 'None').onSelect();
    await findButton(controlsOf(root), 'All open').fire('click');
    assert(lastRow(env, 'Friday item').options.dragHandle !== true && !lastRow(env, 'Friday item').options.onMove,
      'other tabs: no manual order');
  });

  await okAsync('RD-DV-MOVE a silently refused rank write restores the order with one Notice', async () => {
    const env = makeRenderHarness({
      setFields: (p) => (p.endsWith('Today high.md') ? { ok: false, reason: 'render-safe-unavailable' } : { ok: true }),
    });
    const { root } = await mount(env);
    const second = lastRow(env, 'Today low');
    await second.options.onMove(second.task, -1);
    assert.strictEqual(env.calls.setFields.length, 2, 'both writes attempted');
    assert.deepStrictEqual(env.notices, ['Could not save the new task order']);
    assert.strictEqual(lastRow(env, 'Today high').task.rank, null, 'failed row keeps its old rank');
    assert.strictEqual(lastRow(env, 'Today low').task.rank, 1, 'saved row keeps its new rank');
    assert.deepStrictEqual(listTitles(root), ['Today low', 'Today high']);
  });

  await okAsync('RD-DV-DRAG dropping a Today row on another renumbers; any row dropped on a strip cell reschedules', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    const dt = { setData() {}, setDragImage() {}, effectAllowed: '', dropEffect: '' };
    const handleOf = (row) => byClass(row, 'sauce-task-drag')[0];
    const lowRow = lastRow(env, 'Today low').row;
    const highRow = lastRow(env, 'Today high').row;
    assert.strictEqual(handleOf(lowRow).draggable, true);
    await handleOf(lowRow).fire('dragstart', { dataTransfer: dt });
    let prevented = false;
    await highRow.fire('dragover', { dataTransfer: dt, preventDefault() { prevented = true; } });
    assert(prevented, 'a Today row accepts the drag');
    await highRow.fire('drop', { dataTransfer: dt });
    await flush();
    assert.deepStrictEqual(env.calls.setFields, [
      { path: 'spice/tasks/Today low.md', fields: { rank: 1 } },
      { path: 'spice/tasks/Today high.md', fields: { rank: 2 } },
    ]);

    await findButton(controlsOf(root), 'All open').fire('click');
    const backlogRow = lastRow(env, 'Backlog item').row;
    assert.strictEqual(handleOf(backlogRow).draggable, true, 'rows on any tab can be dragged to the strip');
    assert.strictEqual(handleOf(backlogRow).attributes['aria-label'], 'Drag to a day', 'a non-reorder handle says what it does');
    assert(!backlogRow._listeners.drop && !backlogRow._listeners.dragover, 'a row outside manual order is no drop target');
    await handleOf(backlogRow).fire('dragstart', { dataTransfer: dt });
    const friday = byClass(root, 'sauce-todo-week-cell').find((c) => c.dataset.date === '2026-11-13');
    prevented = false;
    await friday.fire('dragover', { dataTransfer: dt, preventDefault() { prevented = true; } });
    assert(prevented, 'strip cell accepts the drag');
    await friday.fire('drop', { dataTransfer: dt });
    await flush();
    assert.deepStrictEqual(env.calls.reschedule.map((c) => [c.path, c.newDue, c.viewedDay]),
      [['spice/tasks/Backlog item.md', '2026-11-13', TODAY]]);
    const fridayNow = byClass(root, 'sauce-todo-week-cell').find((c) => c.dataset.date === '2026-11-13');
    assert.strictEqual(byClass(fridayNow, 'sauce-todo-week-count')[0].textContent, '2', 'strip count repaints');

    prevented = false;
    await fridayNow.fire('dragover', { dataTransfer: dt, preventDefault() { prevented = true; } });
    assert(!prevented, 'no drag in progress: the cell refuses');
  });

  await okAsync('RD-DV-STRIP-RENDER strip sits above the tabs; today highlighted; no day selected', async () => {
    const env = makeRenderHarness();
    const { View, root } = await mount(env);
    const host = byClass(root, 'sauce-todo-above-tabs')[0];
    const cells = byClass(host, 'sauce-todo-week-cell');
    assert.deepStrictEqual(cells.map((c) => byClass(c, 'sauce-todo-week-label')[0].textContent),
      ['Mon 9', 'Tue 10', 'Wed 11', 'Thu 12', 'Fri 13', 'Sat 14', 'Sun 15']);
    assert.deepStrictEqual(cells.map((c) => byClass(c, 'sauce-todo-week-count')[0].textContent),
      ['2', '0', '0', '0', '1', '0', '0']);
    assert.deepStrictEqual(cells.map((c) => String(c.className).split(/\s+/).includes('is-today')),
      [true, false, false, false, false, false, false]);
    const strip = byClass(host, 'sauce-todo-week-strip')[0];
    assert(/display:\s*grid/.test(strip.style.cssText) && /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/.test(strip.style.cssText)
      && /width:\s*100%/.test(strip.style.cssText), 'seven equal columns across the full width: ' + strip.style.cssText);
    for (const cell of cells) assert(/width:\s*100%/.test(cell.style.cssText), 'each cell fills its column');
    assert.strictEqual(cells[0].attributes['aria-current'], 'date');
    assert.strictEqual(cells[4].attributes['aria-pressed'], 'false');
  });

  ok('RD-DV-DAY selectDay lists the open tasks due on exactly that date', () => {
    const View = loadClass({ customJS: { TaskEntity: TE } });
    assert.deepStrictEqual(titles(View.selectDay(PARSED, '2026-11-13')), ['Friday item']);
    assert.deepStrictEqual(titles(View.selectDay(PARSED, TODAY)), ['Today low', 'Today high'],
      'done tasks due that day are not listed');
    assert.deepStrictEqual(titles(View.selectDay(PARSED, '2026-11-05')), ['Overdue mid'], 'a past day lists its late tasks');
    assert.deepStrictEqual(View.selectDay(PARSED, '2026-11-10'), []);
    assert.deepStrictEqual(View.selectDay(PARSED, ''), [], 'no date selects nothing (never the undated backlog)');
    assert.deepStrictEqual(View.selectDay(null, TODAY), []);
  });

  await okAsync('RD-DV-DAY clicking a day shows only that day, marks the cell and puts a day pill first in the tabs', async () => {
    const env = makeRenderHarness();
    const { View, root } = await mount(env);
    const cell = () => byClass(root, 'sauce-todo-week-cell').find((c) => c.dataset.date === '2026-11-13');
    await cell().fire('click');
    assert.deepStrictEqual(listTitles(root), ['Friday item']);
    assert(String(cell().className).split(/\s+/).includes('is-selected'));
    assert.strictEqual(cell().attributes['aria-pressed'], 'true');
    assert(/color-mix\(in srgb, var\(--interactive-accent\) 14%, transparent\)/.test(cell().style.cssText),
      'the selected cell takes the active pill tint: ' + cell().style.cssText);

    const tabs = byClass(root, 'sauce-todo-filter-tabs')[0];
    const pill = tabs.children[0];
    assert(String(pill.className).includes('sauce-todo-day-pill') && String(pill.className).includes('is-active'));
    assert.strictEqual(byClass(pill, 'sauce-todo-day-pill-label')[0].textContent, 'Fri Nov 13');
    assert.strictEqual(byClass(pill, 'sauce-todo-day-pill-x')[0].textContent, '×');
    assert.strictEqual(pill.attributes['aria-label'], 'Showing Fri Nov 13. Show all tasks');
    for (const name of ['Today', 'This week', 'All open']) {
      const button = findButton(controlsOf(root), name);
      assert(!String(button.className).includes('is-active'), `${name} is not active while a day is shown`);
      assert.strictEqual(button.attributes['aria-selected'], 'false');
    }
    assert.strictEqual(View.readPrefs(env.storage).tab, 'today', 'a day focus is never persisted as a tab');
    assert.deepStrictEqual(byClass(root, 'sauce-todo-filter-done-host')[0].children, [], 'nothing done on a future day');
  });

  await okAsync('RD-DV-DAY the pill, the same cell or any tab leaves the day view', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    const cell = (date) => byClass(root, 'sauce-todo-week-cell').find((c) => c.dataset.date === date);
    const pill = () => byClass(root, 'sauce-todo-day-pill')[0];

    await cell('2026-11-13').fire('click');
    await pill().fire('click');
    assert.strictEqual(pill(), undefined, 'the pill is gone');
    assert.deepStrictEqual(listTitles(root), ['Today high', 'Today low'], 'back to the tab that was open');
    assert(String(findButton(controlsOf(root), 'Today').className).includes('is-active'));
    assert(!String(cell('2026-11-13').className).includes('is-selected'));

    await cell('2026-11-13').fire('click');
    await cell('2026-11-13').fire('click');
    assert.strictEqual(pill(), undefined, 'clicking the selected day again leaves it');
    assert.deepStrictEqual(listTitles(root), ['Today high', 'Today low']);

    await cell('2026-11-13').fire('click');
    await cell(TODAY).fire('click');
    assert.strictEqual(byClass(pill(), 'sauce-todo-day-pill-label')[0].textContent, 'Mon Nov 9', 'another day switches the focus');

    await findButton(controlsOf(root), 'All open').fire('click');
    assert.strictEqual(pill(), undefined);
    assert.strictEqual(listTitles(root).length, 8);
    assert(String(findButton(controlsOf(root), 'All open').className).includes('is-active'));
  });

  await okAsync('RD-DV-DAY a day view keeps that day\'s done list, empty copy, no reorder, and survives a re-render', async () => {
    const env = makeRenderHarness();
    const { View, root } = await mount(env);
    const cell = (r, date) => byClass(r, 'sauce-todo-week-cell').find((c) => c.dataset.date === date);

    const before = env.rows.length;
    await cell(root, TODAY).fire('click');
    assert.deepStrictEqual(listTitles(root), ['Today high', 'Today low']);
    const doneHost = byClass(root, 'sauce-todo-filter-done-host')[0];
    assert.strictEqual(byClass(doneHost, 'sauce-section-label')[0].textContent, 'Done today · 2');
    const dayRows = env.rows.slice(before).filter((x) => x.title.startsWith('Today'));
    assert.strictEqual(dayRows.length, 2);
    for (const r of dayRows) {
      assert.strictEqual(r.options.onMove, undefined, 'no manual reorder inside a day view');
    }

    await cell(root, '2026-11-10').fire('click');
    const empty = byClass(root, 'sauce-todo-filter-empty')[0];
    assert.strictEqual(empty.textContent, 'Nothing due Tue Nov 10.');

    const again = await mount(env, PAGES, View);
    assert.strictEqual(byClass(byClass(again.root, 'sauce-todo-day-pill')[0], 'sauce-todo-day-pill-label')[0].textContent,
      'Tue Nov 10', 'the day view survives the Dataview re-render a write causes');
    assert(String(cell(again.root, '2026-11-10').className).includes('is-selected'));
  });

  await okAsync('RD-DV-ONDONE a checkbox completion repaints counts and Done today', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    const r = lastRow(env, 'Today low');
    assert.strictEqual(typeof r.options.onDone, 'function');
    r.options.onDone(r.task);
    assert.deepStrictEqual(listTitles(root), ['Today high']);
    const doneHost = byClass(root, 'sauce-todo-filter-done-host')[0];
    assert.strictEqual(byClass(doneHost, 'sauce-section-label')[0].textContent, 'Done today · 3');
    const todayCell = byClass(root, 'sauce-todo-week-cell')[0];
    assert.strictEqual(byClass(todayCell, 'sauce-todo-week-count')[0].textContent, '1');
    const undo = byClass(doneHost, 'sauce-today-undo').find((b) => b.attributes['aria-label'] === 'Undo: Today low');
    assert(undo, 'the completed row is undoable from its _done path');

    const rec = makeRenderHarness();
    const recurring = page('Water plants', { due: TODAY, recurrence: 'every day' });
    const mounted = await mount(rec, [...PAGES, recurring]);
    const rr = lastRow(rec, 'Water plants');
    rr.options.onDone(rr.task);
    assert(!listTitles(mounted.root).includes('Water plants'), 'a rolled recurring task leaves the list');
    const recDone = byClass(mounted.root, 'sauce-todo-filter-done-host')[0];
    assert.strictEqual(byClass(recDone, 'sauce-section-label')[0].textContent, 'Done today · 2',
      'a recurring completion never reaches Done today');
  });

  await okAsync('RD-DV-MOBILE mobile: no drag at all; manual rows keep Move up / down without a handle', async () => {
    const env = makeRenderHarness();
    env.appStub.isMobile = true;
    const { root } = await mount(env);
    for (const name of ['Today high', 'Today low']) {
      const r = lastRow(env, name);
      assert.strictEqual(typeof r.options.onMove, 'function', `${name} keeps onMove`);
      assert(!r.options.dragHandle, `${name} has no drag handle on mobile`);
      assert.notStrictEqual(r.row.draggable, true, 'rows are not draggable');
      for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
        assert(!r.row._listeners[type], `no ${type} listener on a mobile row`);
      }
    }
    const cells = byClass(root, 'sauce-todo-week-cell');
    assert.strictEqual(cells.length, 7);
    for (const cell of cells) {
      assert(!cell._listeners.dragover && !cell._listeners.drop, 'mobile strip cells take no drops');
      assert.strictEqual(typeof cell._listeners.click, 'function', 'strip cells stay clickable');
    }
    const second = lastRow(env, 'Today low');
    await second.options.onMove(second.task, -1);
    assert.deepStrictEqual(env.calls.setFields.map((c) => c.path),
      ['spice/tasks/Today low.md', 'spice/tasks/Today high.md'], 'Move up still renumbers on mobile');

    assert.strictEqual(TTL_REAL._isMobile({ isMobile: true }), true);
    assert.strictEqual(TTL_REAL._isMobile({ isMobile: false }), false);
    assert.strictEqual(TTL_REAL._isMobile(null), false);
    assert.strictEqual(typeof loadClass({})._isMobile, 'undefined', 'the view has no local copy');
    const hadPlatform = Object.prototype.hasOwnProperty.call(global, 'Platform');
    const prevPlatform = global.Platform;
    global.Platform = { isMobile: true };
    try {
      assert.strictEqual(TTL_REAL._isMobile({}), true, 'Platform.isMobile also counts');
    } finally {
      if (hadPlatform) global.Platform = prevPlatform; else delete global.Platform;
    }
  });

  await okAsync('RD-DV-DRAG-FIELD desktop: a drag that starts inside a form field is cancelled', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    const dt = { setData() { throw new Error('drag data must not be set'); }, effectAllowed: '', dropEffect: '' };
    const row = lastRow(env, 'Today low').row;
    const handle = byClass(row, 'sauce-task-drag')[0];
    let cancelled = false;
    const field = { closest: (sel) => (/input/.test(sel) && /textarea/.test(sel) && /select/.test(sel) ? field : null) };
    await handle.fire('dragstart', { target: field, dataTransfer: dt, preventDefault() { cancelled = true; } });
    assert(cancelled, 'dragstart from the date picker is cancelled');
    const friday = byClass(root, 'sauce-todo-week-cell').find((c) => c.dataset.date === '2026-11-13');
    let accepted = false;
    await friday.fire('dragover', { dataTransfer: dt, preventDefault() { accepted = true; } });
    assert(!accepted, 'no drag is in progress after the cancel');
    await friday.fire('drop', { dataTransfer: dt });
    assert.deepStrictEqual(env.calls.reschedule, [], 'nothing rescheduled');

    let started = false;
    const plain = { closest: () => null };
    await handle.fire('dragstart', {
      target: plain,
      dataTransfer: { setData() { started = true; }, effectAllowed: '', dropEffect: '' },
      preventDefault() { throw new Error('a normal handle drag is not cancelled'); },
    });
    assert(started, 'a drag from the handle still starts');
  });

  await okAsync('RD-DV-HANDLE-ONLY desktop: only the handle drags (titles stay selectable); payload uses the custom type', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    let checked = 0;
    for (const tab of ['Today', 'This week', 'Overdue', 'Backlog', 'All open']) {
      await buttonsOf(controlsOf(root)).find((b) => b.textContent === tab || b.textContent.startsWith(`${tab} · `)).fire('click');
      for (const r of env.rows.filter((x) => x.row.parentNode && descendants(root).includes(x.row))) {
        assert.notStrictEqual(r.row.draggable, true, `${tab}: the row itself is not draggable`);
        assert(!r.row._listeners.dragstart, `${tab}: no dragstart on the row`);
        const handle = byClass(r.row, 'sauce-task-drag')[0];
        assert(handle && handle.draggable === true, `${tab}: ${r.title} has a draggable handle`);
        checked += 1;
      }
    }
    assert(checked >= 15, `rows checked across the tabs: ${checked}`);
    await findButton(controlsOf(root), 'Today').fire('click');
    const types = [];
    const dt = { setData(type, value) { types.push([type, value]); }, setDragImage() {}, effectAllowed: '', dropEffect: '' };
    const low = lastRow(env, 'Today low').row;
    await byClass(low, 'sauce-task-drag')[0].fire('dragstart', { dataTransfer: dt });
    assert.deepStrictEqual(types, [['application/x-sauce-task-path', 'spice/tasks/Today low.md']],
      'only the custom type is set, never text/plain');
    const high = lastRow(env, 'Today high').row;
    await high.fire('drop', { dataTransfer: { getData: (type) => (type === 'application/x-sauce-task-path' ? 'spice/tasks/Today low.md' : '') } });
    await flush();
    assert.deepStrictEqual(env.calls.setFields.map((c) => c.path), ['spice/tasks/Today low.md', 'spice/tasks/Today high.md'],
      'the drop reads the custom type');
  });

  await okAsync('RD-DV-BULK-BACKLOG-LABEL bulk Backlog explains that only personal tasks land in Backlog', async () => {
    const env = makeRenderHarness();
    const { root } = await mount(env);
    await findButton(root, 'Select').fire('click');
    await lastRow(env, 'Today low').options.onSelect(lastRow(env, 'Today low').task, true);
    const button = byClass(root, 'sauce-todo-bulk-action').find((b) => b.textContent === 'Backlog');
    assert(button, 'bulk Backlog present');
    assert.strictEqual(button.attributes.title, 'Remove date (personal tasks go to Backlog)');
    assert.strictEqual(button.attributes['aria-label'], 'Remove date (personal tasks go to Backlog)');
  });

  await okAsync('RD-DV-REMOUNT a re-render mid-bulk keeps Select mode, the selection and the lock', async () => {
    const pending = [];
    const env = makeRenderHarness({
      reschedule(taskPath, newDue) {
        return new Promise((resolve) => pending.push({ taskPath, resolve, newDue }));
      },
    });
    const first = await mount(env);
    const View = first.View;
    await findButton(controlsOf(first.root), 'All open').fire('click');
    await findButton(controlsOf(first.root), 'Select').fire('click');
    select(env, 'Today low', 'Friday item');
    const running = bulkButton(first.root, '→ Next Mon').fire('click');
    await flush();
    assert.strictEqual(pending.length, 1, 'first write in flight');

    const second = await mount(env, PAGES, View);
    const selectBtn = findButton(controlsOf(second.root), 'Select');
    assert.strictEqual(selectBtn.attributes['aria-pressed'], 'true', 'Select mode survives the re-render');
    assert.strictEqual(byClass(bulkBar(second.root), 'sauce-todo-bulk-count')[0].textContent, '2 selected');
    assert.strictEqual(lastRow(env, 'Friday item').options.selected, true, 'selection restored on the new rows');
    assert(buttonsOf(bulkBar(second.root)).every((b) => b.disabled === true), 'bulk buttons drawn disabled');
    await bulkButton(second.root, '→ Tomorrow').fire('click');
    await flush();
    assert.strictEqual(env.calls.reschedule.length, 1, 'a second bulk is refused while the first runs');

    pending[0].resolve({ ok: true, due: pending[0].newDue });
    await flush();
    assert.strictEqual(pending.length, 2);
    pending[1].resolve({ ok: false, reason: 'write failed' });
    await running;
    assert.strictEqual(byClass(bulkBar(second.root), 'sauce-todo-bulk-count')[0].textContent, '1 selected',
      'the live render repaints when the bulk ends; the failed task stays selected');
    assert(buttonsOf(bulkBar(second.root)).every((b) => !b.disabled), 'lock released');
    assert.strictEqual(lastRow(env, 'Today low').task.due, '2026-11-16',
      'the live render\'s cache carries the moved due date');
    assert.strictEqual(lastRow(env, 'Today low').container.parentNode.parentNode.parentNode, second.root,
      'that repaint landed in the live render');

    const next = bulkButton(second.root, '→ Tomorrow').fire('click');
    await flush();
    assert.strictEqual(env.calls.reschedule.length, 3, 'a new bulk runs once the lock is released');
    pending[2].resolve({ ok: true, due: pending[2].newDue });
    await next;
    assert.strictEqual(bulkBar(second.root), null, 'everything moved; nothing left selected');
  });

  await okAsync('RD-DV-REMOUNT a reorder lock held by one render refuses a reorder from the next', async () => {
    let release = null;
    const env = makeRenderHarness({
      setFields: () => new Promise((resolve) => { release = release || resolve; if (release !== resolve) resolve({ ok: true }); }),
    });
    const first = await mount(env);
    const r = lastRow(env, 'Today low');
    const moving = r.options.onMove(r.task, -1);
    await flush();
    assert.strictEqual(env.calls.setFields.length, 1);
    await mount(env, PAGES, first.View);
    const again = lastRow(env, 'Today low');
    const refused = await again.options.onMove(again.task, -1);
    assert.strictEqual(refused, null, 'second reorder refused while the first holds the lock');
    release({ ok: true });
    await moving;
    assert.strictEqual(env.calls.setFields.length, 2, 'the first reorder finished its writes');
  });

  await okAsync('RD-DV-GUARD a throwing TaskEntity during paint warns and never throws out of render', async () => {
    const env = makeRenderHarness();
    const broken = Object.create(TE);
    broken.bucketOf = () => { throw new Error('boom'); };
    env.customJS.TaskEntity = broken;
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    try {
      await assert.doesNotReject(() => mount(env));
    } finally { console.warn = realWarn; }
    assert(warnings.length >= 1 && String(warnings[0][0]).includes('[ToDoDailyFilterView] render failed'));
  });

  await okAsync('TV3-COLD missing TaskEntity or TaskTodayList is a no-throw no-op', async () => {
    for (const customJS of [{ TaskTodayList: {} }, { TaskEntity: {} }, {}]) {
      const windowShim = { customJS, moment: () => ({ format: () => TODAY }) };
      const View = loadClass(windowShim);
      const root = makeElement();
      await assert.doesNotReject(() => new View().render({
        container: root,
        current: () => ({ type: 'to-do' }),
        pages: () => dataArray(PAGES),
      }));
      assert.strictEqual(root.children.length, 0);
    }
  });

  console.log(`\nrun-todo-daily-filter-view: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error('run-todo-daily-filter-view threw:', e); process.exitCode = 1; });
