#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const VIEW_SRC = read('platform/blueprints/to-do/helpers/todo-daily-filter-view.js');
const NOTE_VIEW_SRC = read('platform/mechanisms/task-entity/task-note-view.js');

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try { fn(); passed += 1; console.log(`ok ${name}`); } catch (error) {
    failed += 1; console.log(`FAIL ${name}: ${error && error.message || error}`);
  }
}
async function okAsync(name, fn) {
  try { await fn(); passed += 1; console.log(`ok ${name}`); } catch (error) {
    failed += 1; console.log(`FAIL ${name}: ${error && error.message || error}`);
  }
}

const TaskEntityClass = new Function(`${read('platform/mechanisms/task-entity/task-entity.js')}\nreturn TaskEntity;`)();
const TE = new TaskEntityClass();
const TaskTodayListClass = new Function(`${read('platform/mechanisms/task-entity/task-today-list.js')}\nreturn TaskTodayList;`)();
const TTL = new TaskTodayListClass();
const loadView = (windowShim = {}) => new Function('window', `${VIEW_SRC}\nreturn ToDoDailyFilterView;`)(windowShim);

function makeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

function makeElement(tag = 'div', cls = '') {
  const el = {
    tagName: String(tag).toUpperCase(), className: cls, children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, dataset: {}, _text: '', _listeners: {},
    classList: { add() {}, remove() {} },
    createEl(childTag, opts = {}) {
      const child = makeElement(childTag, opts.cls || '');
      child.parentNode = this;
      if (opts.text != null) child.textContent = opts.text;
      this.children.push(child);
      return child;
    },
    createSpan(opts = {}) { return this.createEl('span', opts); },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    insertBefore(child, ref) {
      const index = ref == null ? this.children.length : this.children.indexOf(ref);
      child.parentNode = this;
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      return child;
    },
    querySelector(selector) {
      const want = String(selector).replace(/^\./, '');
      return descendants(this).find((n) => String(n.className).split(/\s+/).includes(want)) || null;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, listener) { this._listeners[type] = listener; },
    async fire(type, event = {}) {
      if (!this._listeners[type]) return undefined;
      return this._listeners[type]({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
    },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    get nextSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      return siblings[siblings.indexOf(this) + 1] || null;
    },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(value) { this._text = String(value == null ? '' : value); this.children = []; },
  };
  return el;
}
function descendants(node) { return (node.children || []).flatMap((c) => [c, ...descendants(c)]); }
function byClass(root, cls) {
  return descendants(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
}
function findButton(root, label) {
  return descendants(root).find((n) => n.tagName === 'BUTTON' && n.textContent === label);
}
function dataArray(items) {
  const list = items.slice();
  list.where = (predicate) => dataArray(list.filter(predicate));
  list.array = () => list.slice();
  return list;
}

const TODAY = '2026-11-09';
const THURSDAY = '2026-11-12';
const page = (title, fields, folder) => ({
  type: 'task', title, status: 'open',
  file: { path: folder ? `spice/tasks/${folder}/${title}.md` : `spice/tasks/${title}.md` },
  ...fields,
});
const sub = (title, fields) => page(title, { parent_task: '[[Help Henry]]', ...fields });
const parse = (pages) => pages.map((p) => TE.parseNote(p));
const titles = (list) => list.map((t) => t.title);

const ROOTS = [
  page('Help Henry', { due: null, project: '[[Atlas]]', project_slug: 'atlas', source: 'project' }),
  page('Root today', { due: TODAY }),
  page('Root backlog', { due: null }),
];

function makeEnv() {
  const rows = [];
  const customJS = {
    RenderSafe: { page: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }) },
    TaskEntity: TE,
    TaskTodayList: Object.assign(Object.create(TTL), {
      renderTaskRow(container, task, TDref, options) {
        const row = container.createEl('div', { cls: 'sauce-task-today-row' });
        row.createEl('span', { cls: 'sauce-task-today-title', text: task.title });
        rows.push({ title: task.title, task, options });
        return row;
      },
    }),
    TaskDialog: {},
    SectionLabel: { render: (dvLike, opts) => dvLike.container.createEl('div', { cls: 'sauce-section-label', text: opts.text }) },
  };
  const windowShim = {
    localStorage: makeStorage(),
    moment: () => ({ format: () => TODAY }),
    Notice: class {},
    app: { vault: {}, workspace: {} },
    customJS,
  };
  return { rows, windowShim };
}
async function mount(pages, surface, scope) {
  const env = makeEnv();
  const View = loadView(env.windowShim);
  const root = makeElement();
  await new View().render({
    container: root,
    current: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }),
    pages: () => dataArray(pages),
  }, { surface, scope });
  return { env, root };
}
const listTitles = (root) => byClass(root, 'sauce-task-today-title')
  .filter((n) => !String(n.parentNode.className).includes('sauce-today-done'))
  .map((n) => n.textContent);
const tabLabels = (root) => descendants(byClass(root, 'sauce-todo-filter-controls')[0])
  .filter((n) => n.tagName === 'BUTTON').map((b) => b.textContent);
const stripCounts = (root) => byClass(root, 'sauce-todo-week-cell')
  .map((c) => byClass(c, 'sauce-todo-week-count')[0].textContent);

process.exitCode = 1;

(async () => {
  const View = loadView({ customJS: { TaskEntity: TE } });
  const ALL_TABS = ['today', 'week', 'overdue', 'backlog', 'all', 'undated'];

  ok('ST-HIDDEN-UNDATED an undated subtask is in no tab (flat and folder-nested)', () => {
    const tasks = parse([
      ...ROOTS,
      sub('Flat undated', { due: null }),
      page('Launch', { due: null, project_slug: 'atlas' }, 'Launch'),
      page('Nested undated', { due: null }, 'Launch/Nested undated'),
    ]);
    assert(View.isSubtask(tasks.find((t) => t.title === 'Flat undated')));
    assert(View.isSubtask(tasks.find((t) => t.title === 'Nested undated')));
    assert(!View.isSubtask(tasks.find((t) => t.title === 'Help Henry')));
    for (const tab of ALL_TABS) {
      const got = titles(View.selectTab(tasks, tab, TODAY, TE));
      assert(!got.includes('Flat undated') && !got.includes('Nested undated'), `${tab} listed an undated subtask`);
    }
    assert.deepStrictEqual(titles(View.selectTab(tasks, 'undated', TODAY, TE)), ['Help Henry', 'Root backlog', 'Launch']);
    assert.strictEqual(View.weekStrip(tasks, TODAY, TE).reduce((n, c) => n + c.count, 0), 1);
  });

  ok('ST-HIDDEN-ALL a dated subtask is not in All open, Backlog or No date', () => {
    const tasks = parse([...ROOTS, sub('Dated sub', { due: THURSDAY })]);
    for (const tab of ['all', 'backlog', 'undated']) {
      assert(!titles(View.selectTab(tasks, tab, TODAY, TE)).includes('Dated sub'), `${tab} listed a dated subtask`);
    }
    assert(titles(View.selectTab(tasks, 'all', TODAY, TE)).includes('Root today'));
  });

  ok('ST-TODAY a subtask due today is in Today (and This week)', () => {
    const tasks = parse([...ROOTS, sub('Due today sub', { due: TODAY })]);
    assert(titles(View.selectTab(tasks, 'today', TODAY, TE)).includes('Due today sub'));
    assert(titles(View.selectTab(tasks, 'week', TODAY, TE)).includes('Due today sub'));
  });

  ok('ST-DAY a subtask due Thursday is in the Thursday day and its strip cell, not in Today', () => {
    const tasks = parse([...ROOTS, sub('Thursday sub', { due: THURSDAY })]);
    assert.deepStrictEqual(titles(View.selectDay(tasks, THURSDAY)), ['Thursday sub']);
    assert(!titles(View.selectTab(tasks, 'today', TODAY, TE)).includes('Thursday sub'));
    const cell = View.weekStrip(tasks, TODAY, TE).find((c) => c.date === THURSDAY);
    assert.strictEqual(cell.count, 1);
  });

  ok('ST-OVERDUE a subtask past its due is in Overdue', () => {
    const tasks = parse([...ROOTS, sub('Late sub', { due: '2026-11-05' }), sub('Stale sub', { due: '2026-09-01' })]);
    assert.deepStrictEqual(titles(View.selectTab(tasks, 'overdue', TODAY, TE)), ['Late sub', 'Stale sub']);
    assert.deepStrictEqual(titles(View.splitOverdue(tasks, TODAY, TE).overdue), ['Late sub']);
  });

  ok('ST-REPARENTED a task given a parent drops out of All open', () => {
    const before = parse([...ROOTS, page('Moved', { due: THURSDAY })]);
    assert(titles(View.selectTab(before, 'all', TODAY, TE)).includes('Moved'));
    const after = parse([...ROOTS, page('Moved', { due: THURSDAY, parent_task: '[[Help Henry]]' })]);
    assert(!titles(View.selectTab(after, 'all', TODAY, TE)).includes('Moved'));
    assert(titles(View.selectDay(after, THURSDAY)).includes('Moved'), 'but still lists on its day');
  });

  ok('ST-PROMOTED an open task whose parent is done lists as a root in every undated list', () => {
    const tasks = parse([
      ...ROOTS,
      page('Done Parent', { status: 'done', completed_at: '2026-10-20' }, '_done/2026/10/Done Parent'),
      page('Promoted', { due: null, parent_task: '[[Done Parent]]' }, 'Promoted'),
      page('Flat done parent', { status: 'done', completed_at: '2026-10-21' }, '_done'),
      page('Flat child', { due: null, parent_task: '[[Flat done parent]]' }),
    ]);
    for (const tab of ['all', 'undated']) {
      const got = titles(View.selectTab(tasks, tab, TODAY, TE));
      assert(got.includes('Promoted'), `${tab} dropped a promoted task: ${got}`);
      assert(got.includes('Flat child'), `${tab} dropped the child of a done flat parent: ${got}`);
    }
  });

  ok('ST-DONE-MIDLEVEL an open subtask under a done mid-level parent lists as a root', () => {
    const tasks = parse([
      page('Launch', { due: null }, 'Launch'),
      page('Prep', { due: null, status: 'done', completed_at: '2026-11-01', parent_task: '[[Launch]]' }, 'Launch/Prep'),
      page('Reopened', { due: null, parent_task: '[[Prep]]' }, 'Launch/Prep/Reopened'),
      page('Still nested', { due: null, parent_task: '[[Launch]]' }, 'Launch/Still nested'),
    ]);
    const got = titles(View.selectTab(tasks, 'all', TODAY, TE));
    assert.deepStrictEqual(got, ['Launch', 'Reopened']);
  });

  ok('ST-MISSING-PARENT an open task whose parent is missing or deleted lists as a root', () => {
    const tasks = parse([
      ...ROOTS,
      page('Orphan', { due: null, parent_task: '[[Ghost]]' }),
      page('Nested orphan', { due: null }, 'Gone/Nested orphan'),
    ]);
    for (const tab of ['all', 'undated']) {
      const got = titles(View.selectTab(tasks, tab, TODAY, TE));
      assert(got.includes('Orphan') && got.includes('Nested orphan'), `${tab}: ${got}`);
    }
    assert(View.isListable(tasks.find((t) => t.title === 'Orphan'), View.parentIndex(tasks)));
  });

  ok('ST-OPEN-PARENT a task under an open parent stays hidden; re-parented under an open parent it hides', () => {
    const tasks = parse([...ROOTS, sub('Kid', { due: null }), page('Launch', { due: null }, 'Launch'), page('Nested kid', { due: null }, 'Launch/Nested kid')]);
    const got = titles(View.selectTab(tasks, 'all', TODAY, TE));
    assert(!got.includes('Kid') && !got.includes('Nested kid'), got.join(','));
    const before = parse([...ROOTS, page('Done Parent', { status: 'done' }, '_done'), page('Moved', { due: null, parent_task: '[[Done Parent]]' })]);
    assert(titles(View.selectTab(before, 'all', TODAY, TE)).includes('Moved'));
    const after = parse([...ROOTS, page('Done Parent', { status: 'done' }, '_done'), page('Moved', { due: null, parent_task: '[[Help Henry]]' })]);
    assert(!titles(View.selectTab(after, 'all', TODAY, TE)).includes('Moved'));
  });

  ok('ST-RECURRING subtasks are not recurring-list members', () => {
    const tasks = parse([
      ROOTS[0],
      page('Root weekly', { due: TODAY, recurrence: 'every week' }),
      sub('Sub weekly', { due: TODAY, recurrence: 'every week' }),
    ]);
    assert.deepStrictEqual(titles(View.recurringOnly(tasks)), ['Root weekly']);
  });

  ok('ST-DONE-RECENT subtasks stay out of the recently-done list; a dated one still shows in Done today', () => {
    const done = parse([
      ROOTS[0],
      page('Root done', { status: 'done', due: TODAY, completed_at: `${TODAY}T09:00:00-06:00` }),
      sub('Sub done dated', { status: 'done', due: TODAY, completed_at: `${TODAY}T10:00:00-06:00` }),
      sub('Sub done undated', { status: 'done', due: null, completed_at: `${TODAY}T11:00:00-06:00` }),
    ]);
    assert.deepStrictEqual(titles(View.doneRecent(done, TODAY, null, TE, TTL)), ['Root done']);
    assert.deepStrictEqual(titles(View.doneToday(done, TODAY, TE, TTL)), ['Sub done dated', 'Root done']);
  });

  await okAsync('ST-VIEW-DAILY the daily view lists a root, hides an undated subtask, counts match the tabs and strip', async () => {
    const pages = [...ROOTS,
      sub('Undated sub', { due: null }),
      sub('Thursday sub', { due: THURSDAY }),
      sub('Today sub', { due: TODAY }),
      sub('Late sub', { due: '2026-11-05' })];
    const { root } = await mount(pages, 'daily');
    assert.deepStrictEqual(tabLabels(root).slice(0, 5),
      ['Today', 'This week', 'Overdue · 1', 'Backlog · 1', 'All open']);
    assert.deepStrictEqual(listTitles(root).sort(), ['Root today', 'Today sub']);
    assert.deepStrictEqual(stripCounts(root), ['2', '0', '0', '1', '0', '0', '0']);
    await findButton(root, 'Overdue · 1').fire('click');
    assert.deepStrictEqual(listTitles(root), ['Late sub']);
    await findButton(root, 'All open').fire('click');
    assert.deepStrictEqual(listTitles(root).sort(), ['Help Henry', 'Root backlog', 'Root today']);
    const thursday = byClass(root, 'sauce-todo-week-cell').find((c) => c.dataset.date === THURSDAY);
    await thursday.fire('click');
    assert.deepStrictEqual(listTitles(root), ['Thursday sub']);
  });

  await okAsync('ST-VIEW-SCOPED a project surface keeps subtasks on their parent card, not in its list', async () => {
    const pages = [
      page('Help Henry', { due: null, project: '[[Atlas]]', project_slug: 'atlas', source: 'project' }),
      sub('Project sub', { due: THURSDAY, project: '[[Atlas]]', project_slug: 'atlas', source: 'project' }),
    ];
    const scope = { id: 'atlas', match: (t) => t.project_slug === 'atlas' };
    const { root } = await mount(pages, 'project', scope);
    assert.deepStrictEqual(listTitles(root), ['Help Henry']);
  });

  await okAsync('ST-VIEW-PROMOTED the daily view lists a promoted task under All open, even when scoped to its project', async () => {
    const pages = [...ROOTS,
      page('Done Parent', { status: 'done', completed_at: '2026-10-20', project_slug: 'atlas' }, '_done/2026/10/Done Parent'),
      page('Promoted', { due: null, parent_task: '[[Done Parent]]', project_slug: 'atlas' }, 'Promoted'),
      sub('Hidden kid', { due: null, project_slug: 'atlas' })];
    const { root } = await mount(pages, 'daily');
    await findButton(root, 'All open').fire('click');
    assert.deepStrictEqual(listTitles(root).sort(), ['Help Henry', 'Promoted', 'Root backlog', 'Root today']);
    const scoped = await mount(pages, 'project', { id: 'atlas', match: (t) => t.project_slug === 'atlas' });
    assert(listTitles(scoped.root).includes('Promoted'), listTitles(scoped.root).join(','));
    assert(!listTitles(scoped.root).includes('Hidden kid'), 'a kid of an open parent outside the scope stays on its card');
  });

  await okAsync('ST-VIEW-RECURRING the recurring surface drops a recurring subtask', async () => {
    const pages = [
      ROOTS[0],
      page('Root weekly', { due: TODAY, recurrence: 'every week' }),
      sub('Sub weekly', { due: TODAY, recurrence: 'every week' }),
    ];
    const { root } = await mount(pages, 'recurring');
    assert.deepStrictEqual(listTitles(root), ['Root weekly']);
  });

  const makeEl = (tag) => {
    const el = {
      tag, style: {}, children: [], _attrs: {}, _listeners: {}, dataset: {}, classList: { add() {} },
      createEl(t, o) {
        const c = makeEl(t);
        if (o && o.cls) c._attrs.cls = o.cls;
        if (o && o.text != null) c.textContent = o.text;
        el.children.push(c); c.parentNode = el; return c;
      },
      createSpan(o) { return el.createEl('span', o); },
      addEventListener(name, fn) { el._listeners[name] = fn; },
      setAttribute(k, v) { el._attrs[k] = v; },
      querySelector() { return null; },
    };
    return el;
  };
  const find = (node, cls) => {
    if (String(node._attrs.cls || '').split(/\s+/).includes(cls)) return node;
    for (const c of node.children) { const f = find(c, cls); if (f) return f; }
    return null;
  };
  const opened = [];
  global.window = {
    moment: () => ({ format: () => TODAY }),
    app: { workspace: { openLinkText: (...args) => { opened.push(args); } } },
  };
  const subtask = TE.parseNote(sub('Book flights', { due: THURSDAY }));

  ok('ST-INDICATOR its row shows the parent chip before the title, and a click opens the parent', () => {
    opened.length = 0;
    const row = TTL.renderTaskRow(makeEl('div'), subtask, null, { todayStr: TODAY, viewedDay: TODAY });
    const chip = find(row, 'sauce-task-parent-chip');
    assert(chip, 'chip drawn');
    assert.strictEqual(chip.textContent, '↳ Help Henry');
    assert.strictEqual(chip._attrs.title, 'Help Henry');
    const group = find(row, 'sauce-task-today-titlegroup');
    const kids = group.children.map((c) => String(c._attrs.cls || ''));
    assert(kids.findIndex((c) => c.includes('sauce-task-parent-chip'))
      < kids.findIndex((c) => c.includes('sauce-task-today-title')), 'chip sits before the title');
    let stopped = false;
    chip._listeners.click({ stopPropagation() { stopped = true; }, preventDefault() {} });
    assert(stopped, 'click does not also open the task');
    assert.deepStrictEqual(opened, [['Help Henry', subtask.path, false]]);
  });

  ok('ST-INDICATOR a long parent name ellipsizes at 22 characters and keeps the full name in the title', () => {
    const longName = 'Plan the whole quarter roadmap review';
    const long = TE.parseNote(page('Child', { parent_task: `[[${longName}]]`, due: THURSDAY }));
    const row = TTL.renderTaskRow(makeEl('div'), long, null, { todayStr: TODAY });
    const chip = find(row, 'sauce-task-parent-chip');
    assert.strictEqual(chip.textContent, '↳ ' + longName.slice(0, 21) + '…');
    assert.strictEqual(chip._attrs.title, longName);
  });

  ok('ST-INDICATOR a root task draws no chip', () => {
    const root = TE.parseNote(page('Help Henry', { due: THURSDAY }));
    const row = TTL.renderTaskRow(makeEl('div'), root, null, { todayStr: TODAY });
    assert.strictEqual(find(row, 'sauce-task-parent-chip'), null);
  });

  ok('ST-CARD-NO-INDICATOR showParent:false draws no chip, and the card passes it on every subtask row', () => {
    const row = TTL.renderTaskRow(makeEl('div'), subtask, null, { todayStr: TODAY, showParent: false });
    assert.strictEqual(find(row, 'sauce-task-parent-chip'), null);
    const calls = NOTE_VIEW_SRC.match(/TTL\.renderTaskRow\([^;]*\);/g) || [];
    assert(calls.length >= 2, 'found the card subtask rows');
    for (const call of calls) assert(/showParent: false/.test(call), `missing showParent:false in ${call}`);
  });

  ok('ST-COPY-PATH a card row carries a Copy path button; list rows do not', () => {
    const cardRow = TTL.renderTaskRow(makeEl('div'), subtask, null, { todayStr: TODAY, showParent: false, copyPath: true });
    const btn = find(cardRow, 'sauce-task-action-copypath');
    assert(btn, 'copy button on the card row');
    assert.strictEqual(btn._attrs['aria-label'], 'Copy path');
    const listRow = TTL.renderTaskRow(makeEl('div'), subtask, null, { todayStr: TODAY });
    assert.strictEqual(find(listRow, 'sauce-task-action-copypath'), null);
    const calls = NOTE_VIEW_SRC.match(/TTL\.renderTaskRow\([^;]*\);/g) || [];
    for (const call of calls) assert(/copyPath: true/.test(call), `missing copyPath:true in ${call}`);
  });

  await okAsync('ST-COPY-TEXT writes the vault path through the clipboard API, falls back to Electron, reports failure', async () => {
    const wrote = [];
    assert.strictEqual(await TTL.copyText('spice/tasks/A/B/B.md', { clipboard: { writeText: async (t) => { wrote.push(t); } } }, null), true);
    assert.deepStrictEqual(wrote, ['spice/tasks/A/B/B.md']);
    const viaElectron = [];
    const req = (m) => (m === 'electron' ? { clipboard: { writeText: (t) => viaElectron.push(t) } } : null);
    assert.strictEqual(await TTL.copyText('x.md', { clipboard: { writeText: async () => { throw new Error('denied'); } } }, req), true);
    assert.deepStrictEqual(viaElectron, ['x.md']);
    assert.strictEqual(await TTL.copyText('x.md', null, null), false);
    assert.strictEqual(await TTL.copyText('', null, null), false);
  });
  delete global.window;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
