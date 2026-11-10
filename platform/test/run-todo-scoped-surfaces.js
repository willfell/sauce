#!/usr/bin/env node
/**
 * run-todo-scoped-surfaces.js — the task lists on a Project To-Do note
 * (TaskProjectList), a trip's To Do note (TaskTripList) and a meeting note
 * (TaskMeetingList) draw the shared To-Do view on a scoped surface. Each
 * wrapper must pass its own membership rule, fall back to its flat list when
 * the shared view is missing or too old, and (through the real view) show only
 * that note's tasks behind its pills, with its recently done tasks below.
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

const TaskProjectList = loadClass('mechanisms/task-entity/task-project-list.js', 'TaskProjectList');
const TaskTripList = loadClass('mechanisms/task-entity/task-trip-list.js', 'TaskTripList');
const TaskMeetingList = loadClass('mechanisms/task-entity/task-meeting-list.js', 'TaskMeetingList');
const TTLClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
const ViewClass = loadClass('blueprints/to-do/helpers/todo-daily-filter-view.js', 'ToDoDailyFilterView');

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
const task = (title, fields) => ({ type: 'task', title, status: 'open', file: { path: `spice/tasks/${title}.md` }, ...fields });
const done = (title, day, fields) => task(title, {
  status: 'done', completed_at: `${day}T10:00:00`, file: { path: `spice/tasks/_done/${title}.md` }, ...fields,
});
const ATLAS = { project_slug: 'atlas', project: '[[Atlas]]' };
const PAGES = [
  task('Atlas late spec', { ...ATLAS, due: '2026-11-02' }),
  task('Atlas Friday demo', { ...ATLAS, due: '2026-11-13' }),
  task('Atlas someday', { ...ATLAS, due: null }),
  task('Atlas meeting item', { ...ATLAS, source: 'meeting', source_note: '[[Atlas Sync]]', due: '2026-11-10' }),
  task('Other project', { project_slug: 'beacon', due: TODAY }),
  task('Trip packing', { trip_slug: 'lisbon', due: '2026-11-12' }),
  task('Standup follow-up', { source: 'meeting', source_note: '[[Standup 2026-11-09]]', due: '2026-11-04' }),
  task('Standup note', { source: 'meeting', source_note: '[[Standup 2026-11-09]]', due: null }),
  done('Atlas shipped today', TODAY, ATLAS),
  done('Atlas shipped Tue', '2026-11-03', ATLAS),
  done('Atlas shipped long ago', '2026-09-01', ATLAS),
  done('Standup done', '2026-10-01', { source: 'meeting', source_note: '[[Standup 2026-11-09]]' }),
];

function env(pageFields, extraPages) {
  const TE = new (loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity'))();
  const rows = [];
  const doneRows = [];
  const store = new Map();
  const customJS = {
    TaskEntity: TE,
    TaskTodayList: Object.assign(Object.create(new TTLClass()), {
      renderTaskRow(container, t, _TD, opts) {
        const row = container.createEl('div', { cls: 'sauce-task-today-row' });
        row.createEl('span', { cls: 'sauce-task-today-title', text: t.title });
        rows.push([t.title, opts || {}]);
        return row;
      },
      renderDoneRow(container, t, opts) {
        const row = container.createEl('div', { cls: 'sauce-today-done-row' });
        row.createEl('span', { cls: 'sauce-today-done-title', text: t.title });
        doneRows.push([t.title, opts && opts.stamp != null ? opts.stamp : null]);
        return row;
      },
    }),
    RenderSafe: { page: () => current },
  };
  let current = { file: { name: 'Note' }, ...pageFields };
  customJS.ToDoDailyFilterView = new ViewClass();
  global.window = {
    customJS,
    moment: () => ({ format: () => TODAY }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    app: {},
  };
  const source = PAGES.concat(extraPages || []);
  const container = makeEl('div');
  const dv = {
    container,
    current: () => current,
    pages: () => { const a = source.slice(); a.where = (fn) => { const b = a.filter(fn); b.where = a.where; b.array = () => b; return b; }; return a.where(() => true); },
  };
  return { dv, container, rows, doneRows, store, setPage: (p) => { current = { file: { name: 'Note' }, ...p }; } };
}
const titles = (container) => byClass(container, 'sauce-task-today-title').map((n) => n.textContent);
const pills = (container) => {
  const group = byClass(container, 'sauce-todo-filter-tabs')[0];
  return group ? group.children.map((b) => b.textContent).join('|') : null;
};
const tools = (container) => {
  const right = byClass(container, 'sauce-todo-filter-right')[0];
  return right ? right.children.map((b) => b.textContent).join('|') : null;
};
const doneTitles = (container) => byClass(container, 'sauce-today-done-title').map((n) => n.textContent);

(async () => {
  {
    const calls = [];
    class FakeView {
      static get SURFACES() { return { project: {}, trip: {}, meeting: {} }; }
      render(dv, opts) { calls.push(opts); return 'drawn'; }
    }
    const page = { project_slug: 'atlas', trip_slug: 'lisbon', file: { name: 'Standup 2026-11-09.md' } };
    global.window = { customJS: { ToDoDailyFilterView: new FakeView(), RenderSafe: { page: () => page } } };
    const dv = { container: makeEl('div') };
    const drawn = [
      await new TaskProjectList().render(dv),
      await new TaskTripList().render(dv),
      await new TaskMeetingList().render(dv),
    ];
    const [p, t, m] = calls;
    ok('SCOPE-DELEGATE each wrapper hands its surface and its own id to the shared view',
      drawn.every((d) => d === 'drawn')
      && p.surface === 'project' && p.scope.id === 'atlas'
      && t.surface === 'trip' && t.scope.id === 'lisbon'
      && m.surface === 'meeting' && m.scope.id === 'Standup 2026-11-09');
    ok('SCOPE-MATCH the scope rule is the list\'s own _matches (project and trip leave meeting-sourced tasks to From Meetings)',
      p.scope.match({ project_slug: 'atlas' }) && !p.scope.match({ project_slug: 'atlas', source: 'meeting' })
      && !p.scope.match({ project_slug: 'beacon' })
      && t.scope.match({ trip_slug: 'lisbon' }) && !t.scope.match({ trip_slug: 'lisbon', source: 'meeting' })
      && m.scope.match({ source_note: 'Standup 2026-11-09' }) && !m.scope.match({ source_note: 'Other' }));

    calls.length = 0;
    global.window.customJS.RenderSafe = { page: () => ({ file: { name: '' } }) };
    await new TaskProjectList().render(dv);
    await new TaskTripList().render(dv);
    await new TaskMeetingList().render(dv);
    ok('SCOPE-NOKEY a note with no slug or name draws nothing', calls.length === 0);
  }

  {
    const e = env({ project_slug: 'atlas' });
    class OldView { render() { throw new Error('an older view must not be asked for a surface it lacks'); } }
    global.window.customJS.ToDoDailyFilterView = new OldView();
    let threw = false;
    try { await new TaskProjectList().render(e.dv); } catch (_e) { threw = true; }
    ok('SCOPE-FALLBACK an older shared view without the surface keeps the flat project list',
      !threw && byClass(e.container, 'sauce-task-project').length === 1
      && titles(e.container).join('|') === 'Atlas late spec|Atlas Friday demo|Atlas someday');
    delete global.window.customJS.ToDoDailyFilterView;
    e.container.children = [];
    await new TaskMeetingList().render(e.dv);
    ok('SCOPE-FALLBACK-NOVIEW no shared view at all: the flat list still draws',
      byClass(e.container, 'sauce-task-meeting').length === 1);
  }

  {
    const e = env({ project_slug: 'atlas' });
    await new TaskProjectList().render(e.dv);
    ok('PRJ-PILLS project: All open / Overdue / This week / No date, counted, with Sort / Group / Select',
      pills(e.container) === 'All open · 3|Overdue · 1|This week|No date'
      && tools(e.container) === 'Sort ▾|Group ▾|Select');
    ok('PRJ-LIST only this project\'s open, non-meeting tasks, soonest due first, undated last',
      titles(e.container).join('|') === 'Atlas late spec|Atlas Friday demo|Atlas someday');
    ok('PRJ-NO-STRIP no week strip and no search on a project note',
      !byClass(e.container, 'sauce-todo-week-strip').length && !byClass(e.container, 'sauce-todo-search').length);
    ok('PRJ-ROWS project rows drop the project chip (it would repeat on every row) and the drag handle (no strip to drop on)',
      e.rows.length > 0 && e.rows.every(([, o]) => o.showProject === false && !o.dragHandle));
    ok('PRJ-DONE recently done (last 14 days) below the list, newest first, older days stamped with their date',
      doneTitles(e.container).join('|') === 'Atlas shipped today|Atlas shipped Tue'
      && JSON.stringify(e.doneRows) === JSON.stringify([['Atlas shipped today', null], ['Atlas shipped Tue', 'Tue Nov 3']])
      && byClass(e.container, 'sauce-todo-filter-done-host')[0].textContent.includes('Recently done · 2'));
    const undated = buttons(e.container).find((b) => b.textContent === 'No date');
    await undated.fire('click');
    ok('PRJ-UNDATED No date shows the open tasks with no due date, and hides the done list',
      titles(e.container).slice(-1)[0] === 'Atlas someday'
      && byClass(e.container, 'sauce-todo-filter-done-host')[0].children.length === 0);
    ok('PRJ-PREFS the tab persists under the project surface\'s own key',
      JSON.parse(e.store.get('sauce-todo-filter:prefs:project')).tab === 'undated'
      && !e.store.has('sauce-todo-filter:prefs:v2') && !e.store.has('sauce-todo-filter:prefs:all'));
  }

  {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => done(`Atlas batch ${n}`, '2026-11-0' + n, ATLAS));
    const e = env({ project_slug: 'atlas' }, many);
    await new TaskProjectList().render(e.dv);
    const host = byClass(e.container, 'sauce-todo-filter-done-host')[0];
    const more = byClass(e.container, 'sauce-todo-done-more')[0];
    ok('PRJ-DONE-LIMIT the first five done tasks, then "Show N more"',
      doneTitles(e.container).length === 5 && more && more.textContent === 'Show 4 more'
      && host.textContent.includes('Recently done · 9'));
    await more.fire('click');
    ok('PRJ-DONE-MORE Show more lists every recently done task',
      doneTitles(e.container).length === 9 && !byClass(e.container, 'sauce-todo-done-more').length);
  }

  {
    const e = env({ file: { name: 'Standup 2026-11-09' } });
    await new TaskMeetingList().render(e.dv);
    ok('MTG-PILLS meeting: All open / Overdue, with Select only',
      pills(e.container) === 'All open · 2|Overdue · 1' && tools(e.container) === 'Select');
    ok('MTG-LIST only tasks whose source is this meeting',
      titles(e.container).join('|') === 'Standup follow-up|Standup note');
    ok('MTG-ROWS meeting rows keep the project chip (a meeting spans projects)',
      e.rows.length > 0 && e.rows.every(([, o]) => o.showProject !== false));
    ok('MTG-DONE a meeting lists every task it produced that is done, however old',
      doneTitles(e.container).join('|') === 'Standup done'
      && byClass(e.container, 'sauce-todo-filter-done-host')[0].textContent.includes('Done · 1'));
  }

  {
    const e = env({ trip_slug: 'lisbon' });
    await new TaskTripList().render(e.dv);
    ok('TRP-PILLS trip: the project pills, and only the trip\'s tasks',
      pills(e.container) === 'All open · 1|Overdue|This week|No date' && titles(e.container).join('|') === 'Trip packing');
  }

  {
    const e = env({ project_slug: 'empty-project' });
    await new TaskProjectList().render(e.dv);
    ok('SCOPE-BLANK a note with no tasks at all shows one quiet line and no pills',
      pills(e.container) === null && byClass(e.container, 'sauce-todo-filter-empty')[0].textContent === 'No tasks yet. Use + New Task above.');
  }

  {
    const e = env({ project_slug: 'finished' }, [done('Wrapped up', TODAY, { project_slug: 'finished' })]);
    await new TaskProjectList().render(e.dv);
    ok('SCOPE-ALL-DONE everything done: the surface\'s own empty line over the done list',
      byClass(e.container, 'sauce-todo-filter-empty')[0].textContent === 'Nothing open on this project.'
      && doneTitles(e.container).join('|') === 'Wrapped up');
  }

  {
    const e = env({ project_slug: 'atlas' });
    await new TaskProjectList().render(e.dv);
    const select = buttons(e.container).find((b) => b.textContent === 'Select');
    await select.fire('click');
    const selectingA = select.attributes['aria-pressed'] === 'true';
    e.setPage({ project_slug: 'beacon' });
    e.container.children = [];
    await new TaskProjectList().render(e.dv);
    const selectB = buttons(e.container).find((b) => b.textContent === 'Select');
    ok('SCOPE-STATE Select mode on one project does not follow you into another',
      selectingA && selectB.attributes['aria-pressed'] === 'false');
  }

  {
    const e = env({ project_slug: 'atlas' });
    await global.window.customJS.ToDoDailyFilterView.render(e.dv, { surface: 'project' });
    ok('SCOPE-REQUIRED a scoped surface asked to draw without a scope draws nothing', e.container.children.length === 0);
  }

  {
    const View = ViewClass;
    const TE = new (loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity'))();
    const list = [
      { title: 'a', status: 'done', completed_at: '2026-11-09T08:00:00' },
      { title: 'b', status: 'done', completed_at: '2026-11-09T17:30:00' },
      { title: 'c', status: 'done', completed_at: '2026-10-27T09:00:00' },
      { title: 'd', status: 'done', completed_at: '2026-10-26T09:00:00' },
      { title: 'e', status: 'open' },
      { title: 'f', status: 'done', completed_at: '' },
    ];
    const ttl = { doneTimeLabel: (t) => TTLClass.doneTimeLabel(t) };
    ok('DONE-RECENT a 14-day window keeps the last 14 days inclusive, latest first',
      View.doneRecent(list, TODAY, 14, TE, ttl).map((t) => t.title).join('') === 'bac');
    ok('DONE-RECENT-ALL no window keeps every done task, undated completions last',
      View.doneRecent(list, TODAY, null, TE, ttl).map((t) => t.title).join('') === 'bacdf');
    ok('UNDATED-TAB selectTab undated returns open tasks with no due date only',
      View.selectTab([{ status: 'open', due: null, title: 'x' }, { status: 'open', due: TODAY }, { status: 'done' }], 'undated', TODAY, TE)
        .map((t) => t.title).join('') === 'x');
  }

  {
    const row = (opts) => {
      const c = makeEl('div');
      global.window = { customJS: {} };
      TTLClass.renderDoneRow(c, { title: 'T', path: 'spice/tasks/_done/T.md', completed_at: '2026-11-03T14:05:00' }, opts);
      const stamp = byClass(c, 'sauce-today-done-time')[0];
      return stamp ? stamp.textContent : null;
    };
    ok('DONE-ROW-STAMP renderDoneRow shows a passed stamp in place of the time, and the time otherwise',
      row({ stamp: 'Tue Nov 3' }) === 'Tue Nov 3' && row({}) === '14:05' && row({ stamp: null }) === '14:05');
  }

  const failed = results.filter(([, pass]) => !pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
