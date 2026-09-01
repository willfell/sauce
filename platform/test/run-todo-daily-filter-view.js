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

// The window/customJS surface the view needs in order to render for real.
// Shared so a test can both drive the pills and count what a click actually
// costs (localStorage writes, task rows repainted).
function makeRenderHarness() {
  const storage = makeStorage();
  const rendered = [];
  const clock = { reads: 0 };
  const windowShim = {
    localStorage: storage,
    moment: () => { clock.reads += 1; return { format: () => TODAY }; },
    customJS: {
      RenderSafe: { page: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }) },
      TaskEntity: { parseNote(page) { return { ...page, path: page.file.path }; } },
      TaskTodayList: {
        renderTaskRow(container, task) {
          rendered.push(task.title);
          const row = container.createEl('div', { cls: 'sauce-task-today-row' });
          const group = row.createEl('div', { cls: 'sauce-task-today-titlegroup' });
          group.createEl('div', { cls: 'sauce-task-today-cbwrap' });
          group.createEl('span', { cls: 'sauce-task-today-title', text: task.title });
          return row;
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
          return String(a.due || '9999-99-99').localeCompare(String(b.due || '9999-99-99'));
        },
        compareTasksByPriority(a, b) {
          const rank = { highest: 4, high: 3, medium: 2, low: 1 };
          return (rank[b.priority] || 0) - (rank[a.priority] || 0) || this.compareTasksByDue(a, b);
        },
      },
    },
  };
  return { storage, rendered, windowShim, clock };
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

  ok('SB-SCOPE each single scope selects exactly its own open tasks', () => {
    const View = loadClass({});
    const titles = (scope, includeDone) =>
      View.selectByScope(TASKS, scope, includeDone === true, TODAY).map((task) => task.title);

    assert.deepStrictEqual(titles('today'), ['Today low']);
    assert.deepStrictEqual(titles('overdue'), ['Overdue high']);
    assert.deepStrictEqual(titles('upcoming'), ['Upcoming highest']);
    assert.deepStrictEqual(titles('no-date'), ['No date medium']);
    assert.deepStrictEqual(titles('all'),
      ['Today low', 'Overdue high', 'Upcoming highest', 'No date medium']);

    // An unrecognised scope resolves to today rather than selecting nothing.
    assert.deepStrictEqual(titles('nonsense'), ['Today low']);
  });

  ok('SB-DONE is an independent include, and All + Done reaches older completions', () => {
    const View = loadClass({});
    const titles = (scope, includeDone) =>
      View.selectByScope(TASKS, scope, includeDone === true, TODAY).map((task) => task.title);

    // Off by default on every scope.
    for (const scope of View.SCOPE_KEYS) {
      assert(!titles(scope).some((title) => title.startsWith('Done')),
        `scope ${scope} leaked a done task with includeDone false`);
    }

    // A date scope adds only today's completions.
    assert.deepStrictEqual(titles('today', true), ['Today low', 'Done today']);
    assert(!titles('today', true).includes('Done yesterday'));

    // This is the defect: All + Done must reach a completion older than today.
    assert.deepStrictEqual(titles('all', true),
      ['Today low', 'Overdue high', 'Upcoming highest', 'No date medium', 'Done today', 'Done yesterday']);
  });

  ok('SB-STATE single-select scope round-trips and rejects junk', () => {
    const View = loadClass({});
    const D = '2026-08-11';
    const storage = makeStorage();
    assert.deepStrictEqual(View.SCOPE_KEYS, ['today', 'overdue', 'upcoming', 'no-date', 'all']);
    assert.strictEqual(View.DEFAULT_SCOPE, 'today');
    assert(!View.SCOPE_KEYS.includes('done'), "'done' is no longer a scope");

    assert.deepStrictEqual(View.readState(storage, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });

    const written = View.writeState(storage, {
      scope: 'all', includeDone: true, sort: 'priority', groupByProject: true,
    }, D);
    assert.deepStrictEqual(written,
      { scope: 'all', includeDone: true, sort: 'priority', groupByProject: true, date: D });
    assert.deepStrictEqual(View.readState(storage, D), written);

    // Unrecognised scope falls back to today; non-booleans are false.
    assert.deepStrictEqual(
      View._normalizeState({ scope: 'nonsense', includeDone: 'yes', sort: 'sideways', groupByProject: 1, date: D }, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });

    // Bad JSON and hostile storage both degrade to the default.
    storage.data.set(View.STORAGE_KEY, '{bad json');
    assert.deepStrictEqual(View.readState(storage, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.deepStrictEqual(View.readState(throwing, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });
    assert.doesNotThrow(() => View.writeState(throwing, written, D));
  });

  ok('SB-STATE state is keyed to the note date and legacy blobs are discarded', () => {
    const View = loadClass({});
    const storage = makeStorage();
    View.writeState(storage, { scope: 'all', includeDone: true, sort: 'priority', groupByProject: true }, '2026-08-11');

    // Same note: restored.
    assert.strictEqual(View.readState(storage, '2026-08-11').scope, 'all');
    // Different note: default, and the stored blob is left alone until written.
    assert.deepStrictEqual(View.readState(storage, '2026-08-12'),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: '2026-08-12' });

    // A pre-existing v0.288.0 blob has no `date` key at all and is discarded whole,
    // including its sort and grouping — not partially carried forward.
    storage.data.set(View.STORAGE_KEY,
      JSON.stringify({ scopes: ['upcoming', 'no-date'], sort: 'priority', groupByProject: true }));
    assert.deepStrictEqual(View.readState(storage, '2026-08-11'),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: '2026-08-11' });
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

  ok('SB-NOTEDATE reads the date from the note filename, not the clock', () => {
    const View = loadClass({});
    assert.strictEqual(View.noteDate({ file: { name: 'ToDo-2026-08-31' } }), '2026-08-31');
    assert.strictEqual(View.noteDate({ file: { name: 'ToDo-2026-08-31.md' } }), '2026-08-31');
  });

  // A bare '' fallback put every undated note in one persistence bucket, so
  // mounting the view on two differently-named notes had them overwrite each
  // other's saved filters. The bucket is keyed per note instead.
  ok('SB-NOTEDATE-FALLBACK undated notes get their own bucket, never a shared one', () => {
    const View = loadClass({});
    const a = View.noteDate({ file: { name: 'Some Other Note' } });
    const b = View.noteDate({ file: { name: 'A Different Note' } });
    assert.notStrictEqual(a, '', 'an undated note must not fall back to the empty-string bucket');
    assert.notStrictEqual(a, b, 'two differently-named undated notes must not share a bucket');
    assert.strictEqual(a, View.noteDate({ file: { name: 'Some Other Note' } }),
      'the bucket for a given note is stable across reads');
    // A dated note and an undated one can never collide either, whatever the
    // undated note happens to be called.
    assert.notStrictEqual(View.noteDate({ file: { name: '2026-08-31' } }),
      View.noteDate({ file: { name: 'ToDo-2026-08-31' } }));
    assert.strictEqual(View.noteDate({ file: {} }), View.noteDate(null),
      'a page with no identity at all resolves to one explicit bucket');
  });

  // Saved state must not leak between two undated notes.
  ok('SB-NOTEDATE-FALLBACK state does not leak between two undated notes', () => {
    const View = loadClass({});
    const storage = makeStorage();
    const first = View.noteDate({ file: { name: 'Some Other Note' } });
    const second = View.noteDate({ file: { name: 'A Different Note' } });
    View.writeState(storage, { scope: 'all', includeDone: true, sort: 'priority' }, first);
    const carried = View.readState(storage, second);
    assert.strictEqual(carried.scope, View.DEFAULT_SCOPE,
      'the second note must start from the default scope, not the first note\'s');
    assert.strictEqual(carried.includeDone, false);
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

  await okAsync('SB-RENDER paints four pill groups and persists every interaction', async () => {
    const { storage, rendered, windowShim, clock } = makeRenderHarness();
    const View = loadClass(windowShim);
    const root = makeElement();
    const dv = {
      container: root,
      current: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }),
      pages: () => dataArray(TASKS),
    };
    await new View().render(dv);

    assert.strictEqual(clock.reads, 1, 'render reads the live clock exactly once');
    assert.strictEqual(byClass(root, 'sauce-pill-group').length, 4, 'scopes, done, sort, group');
    assert.strictEqual(byClass(root, 'sauce-todo-filter-sep').length, 2);
    assert.strictEqual(byClass(root, 'sauce-todo-filter-rule').length, 1);
    assert.strictEqual(byClass(root, 'sauce-todo-daily-filter-list').length, 1);

    const buttons = descendants(root).filter((node) => node.tagName === 'BUTTON');
    assert.deepStrictEqual(buttons.map((b) => b.textContent),
      ['Today', 'Overdue', 'Upcoming', 'No date', 'All', 'Done', 'Due', 'Priority', 'By Project']);
    assert(buttons.every((b) => String(b.className).split(/\s+/).includes('sauce-pill-toggle')));

    // Default is Today alone — not Today + Overdue.
    assert.deepStrictEqual(rendered, ['Today low']);
    assert.strictEqual(byClass(root, 'sauce-task-priority-dot').length, 1);

    const find = (label) => buttons.find((b) => b.textContent === label);

    // Scope is single-select: choosing Overdue deselects Today.
    await find('Overdue').fire('click');
    assert(String(find('Overdue').className).includes('is-active'));
    assert(!String(find('Today').className).includes('is-active'));
    assert.strictEqual(rendered[rendered.length - 1], 'Overdue high');

    // Clicking the active scope again keeps it active — it can never empty.
    await find('Overdue').fire('click');
    assert(String(find('Overdue').className).includes('is-active'));
    assert.strictEqual(View.readState(storage, TODAY).scope, 'overdue');

    // Done is independent of scope.
    await find('All').fire('click');
    await find('Done').fire('click');
    assert(String(find('Done').className).includes('is-active'));
    assert(String(find('All').className).includes('is-active'));
    assert.deepStrictEqual(View.readState(storage, TODAY), {
      scope: 'all', includeDone: true, sort: 'due', groupByProject: false, date: TODAY,
    });
    assert(rendered.slice(-6).includes('Done yesterday'), 'All + Done reaches older completions');

    await find('Priority').fire('click');
    assert.strictEqual(View.readState(storage, TODAY).sort, 'priority');

    await find('By Project').fire('click');
    assert(String(find('By Project').className).includes('is-active'));
    assert.strictEqual(byClass(root, 'sauce-todo-filter-project-label').length, 2);
    assert.strictEqual(View.readState(storage, TODAY).groupByProject, true);
  });

  // Re-clicking the ALREADY-ACTIVE scope used to re-run commit() unconditionally:
  // a redundant localStorage write plus a full list rebuild, for a state that did
  // not change. The pill must still read as active afterwards (single-select can
  // never empty), so this guards the cost without weakening the invariant that
  // SB-RENDER asserts.
  await okAsync('SB-SCOPE-IDEMPOTENT re-clicking the active scope stays active and costs nothing', async () => {
    const { storage, rendered, windowShim } = makeRenderHarness();
    let writes = 0;
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { writes += 1; return setItem(key, value); };

    const View = loadClass(windowShim);
    const root = makeElement();
    await new View().render({
      container: root,
      current: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }),
      pages: () => dataArray(TASKS),
    });
    const buttons = descendants(root).filter((node) => node.tagName === 'BUTTON');
    const find = (label) => buttons.find((b) => b.textContent === label);

    // Move off the default so the active scope under test was chosen by a click.
    await find('Overdue').fire('click');
    assert(String(find('Overdue').className).includes('is-active'));
    const writesAfterRealChange = writes;
    const paintedAfterRealChange = rendered.length;
    assert(writesAfterRealChange > 0, 'a real scope change must persist');

    await find('Overdue').fire('click');

    assert.strictEqual(writes, writesAfterRealChange,
      're-clicking the active scope must not write localStorage again');
    assert.strictEqual(rendered.length, paintedAfterRealChange,
      're-clicking the active scope must not rebuild the list');
    // The SB-RENDER invariant: the click is not a deselect.
    assert(String(find('Overdue').className).includes('is-active'),
      'the re-clicked scope stays active — single-select can never empty');
    assert.strictEqual(View.readState(storage, TODAY).scope, 'overdue',
      'persisted scope is unchanged and still overdue');

    // A click that DOES change the scope still commits normally.
    await find('All').fire('click');
    assert.strictEqual(writes, writesAfterRealChange + 1, 'a real change still persists');
    assert(String(find('All').className).includes('is-active'));
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
