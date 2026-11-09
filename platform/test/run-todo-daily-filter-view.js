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
  const clock = { reads: 0 };
  class NoticeStub { constructor(message) { notices.push(message); } }
  const customJS = {
    RenderSafe: { page: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }) },
    TaskEntity: TE,
    TaskTodayList: {
      renderTaskRow(container, task, TDref, options) {
        const row = container.createEl('div', { cls: 'sauce-task-today-row' });
        row.dataset.sauceTaskPath = String(task.path || '');
        row.createEl('span', { cls: 'sauce-task-today-title', text: task.title });
        rows.push({ title: task.title, options, row, container });
        return row;
      },
    },
    TaskDialog: {
      async reopen(taskPath) {
        reopened.push(taskPath);
        return overrides.reopenResult
          ? overrides.reopenResult(taskPath)
          : { ok: true, path: taskPath.replace('/_done/', '/') };
      },
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
  const windowShim = {
    localStorage: storage,
    moment: () => { clock.reads += 1; return { format: () => TODAY }; },
    Notice: NoticeStub,
    customJS,
  };
  return { storage, rows, notices, reopened, menus, windowShim, clock, customJS };
}

async function mount(env, pages = PAGES) {
  const View = loadClass(env.windowShim);
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
    assert.strictEqual(View.readPrefs.length <= 1, true, 'prefs are not keyed by a note date');

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
    assert.deepStrictEqual(byProject.map((g) => g.label), ['Atlas', 'Zeta', 'No Project']);
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

    assert.deepStrictEqual(buttonsOf(root).slice(0, 7).map((b) => b.textContent),
      ['Today', 'This week', 'Overdue · 2', 'Backlog · 1', 'All open', 'Sort ▾', 'Group ▾']);
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
    assert.deepStrictEqual(buttonsOf(root).slice(0, 5).map((b) => b.textContent),
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
    assert.deepStrictEqual(rows.map((r) => r.querySelector('sauce-today-done-title').textContent),
      ['Done last night', 'Done this morning']);
    assert.deepStrictEqual(byClass(doneHost, 'sauce-today-done-time').map((n) => n.textContent),
      ['21:40', '09:15']);
    assert(!rows.some((r) => r.textContent.includes('Done yesterday')));
    const title = rows[0].querySelector('sauce-today-done-title');
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
})();
