#!/usr/bin/env node
/**
 * run-task-folders-read.js — both task layouts are read, and status (not the
 * path) decides done and deleted: parseNote derives the parent from the
 * folder, no surface gates on `/_done/`, the done row and the card actions
 * follow status, and the breadcrumb ancestor links the parent by name.
 * Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const load = (rel, cls) => new Function(read(rel) + '\nreturn ' + cls + ';')();

const TE = load('mechanisms/task-entity/task-entity.js', 'TaskEntity');
const TNV = load('mechanisms/task-entity/task-note-view.js', 'TaskNoteView');
const TTL = load('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');

const a = TE.parseNote({ file: { path: 'spice/tasks/A/B/B.md' }, parent_task: '[[Stale]]' });
ok('TF-READ-PARENT-FOLDER a folder note takes its parent from the folder above',
  a.parent_task === 'A' && a.parent_path === 'spice/tasks/A/A.md');

const deep = TE.parseNote({ file: { path: 'spice/tasks/A/B/C/C.md' }, parent_task: '[[A]]' });
ok('TF-READ-PARENT-DEEP a nested subtask names the folder directly above it',
  deep.parent_task === 'B' && deep.parent_path === 'spice/tasks/A/B/B.md');

const doneTree = TE.parseNote({ file: { path: 'spice/tasks/_done/2026/11/A/B/B.md' }, parent_task: '[[Stale]]' });
ok('TF-READ-PARENT-DONE-TREE a subtask inside a _done/YYYY/MM tree names its parent folder',
  doneTree.parent_task === 'A' && doneTree.parent_path === 'spice/tasks/_done/2026/11/A/A.md');

const top = TE.parseNote({ file: { path: 'spice/tasks/A/A.md' }, parent_task: '[[Ghost]]' });
ok('TF-READ-PARENT-TOP a top-level folder note falls back to its frontmatter parent',
  top.parent_task === 'Ghost' && top.parent_path === '');

const flat = TE.parseNote({ file: { path: 'spice/tasks/B.md' }, parent_task: '[[A]]' });
ok('TF-READ-PARENT-FLAT a flat note falls back to its parent_task link',
  flat.parent_task === 'A' && flat.parent_path === '');

const none = TE.parseNote({ file: { path: 'spice/tasks/X.md' } });
ok('TF-READ-PARENT-NONE a task with no parent has an empty parent and parent path',
  none.parent_task === '' && none.parent_path === '');

const PATH_GATED = [
  'mechanisms/task-entity/task-trip-list.js',
  'mechanisms/task-entity/task-meeting-list.js',
  'mechanisms/task-entity/task-project-list.js',
  'mechanisms/task-entity/task-today-list.js',
  'mechanisms/task-entity/task-done-today-list.js',
  'mechanisms/task-entity/task-entity.js',
  'mechanisms/task-entity/task-note-view.js',
  'blueprints/daily/helpers/space-daily-dashboard.js',
  'blueprints/project/helpers/project-dashboard.js',
  'blueprints/project/helpers/project-meetings-list.js',
  'blueprints/meetings/helpers/meetings-hub-cards.js',
  'blueprints/meetings/helpers/meetings-browse-list.js',
  'blueprints/to-do/helpers/todo-daily-project-groups.js',
  'blueprints/to-do/helpers/todo-daily-filter-view.js',
  'blueprints/to-do/helpers/task-done-archive.js',
  'blueprints/to-do/helpers/todo-daily-trip-groups.js',
  'blueprints/to-do/helpers/todo-daily-unassigned-meetings.js',
  'blueprints/trips/helpers/trip-dashboard.js',
];
const gated = PATH_GATED.filter((f) => /includes\(\s*['"]\/_done\/['"]\s*\)/.test(read(f)));
ok('TF-READ-NO-PATH-CHECKS no read surface filters on includes(\'/_done/\')', gated.length === 0);
if (gated.length) console.log('    path-gated: ' + gated.join(', '));
const MEETING_NOTE_TRASH = 'blueprints/meetings/helpers/meetings-browse-list.js';
const trashed = PATH_GATED.filter((f) => f !== MEETING_NOTE_TRASH && /includes\(\s*['"]\/_trash\/['"]\s*\)/.test(read(f)));
const browse = read(MEETING_NOTE_TRASH);
ok('TF-READ-MEETING-NOTES-TRASH meetings-browse-list keeps the trash filter on meeting notes only, not tasks',
  (browse.match(/includes\(\s*['"]\/_trash\/['"]\s*\)/g) || []).length === 1
  && /spice\/meetings\/notes"'\);[\s\S]{0,300}includes\('\/_trash\/'\)/.test(browse));
ok('TF-READ-NO-TRASH-CHECKS no read surface filters on includes(\'/_trash/\')', trashed.length === 0);
if (trashed.length) console.log('    path-gated: ' + trashed.join(', '));

const mkEl = (cls) => ({
  className: cls || '', children: [], style: { cssText: '' }, dataset: {}, attributes: {}, listeners: {}, _text: '',
  createEl(tag, o) { const c = mkEl((o && o.cls) || ''); c.tag = tag; if (o && o.text != null) c.textContent = o.text; this.children.push(c); return c; },
  setAttribute(k, v) { this.attributes[k] = v; },
  addEventListener(t, f) { this.listeners[t] = f; },
  get textContent() { return this._text; },
  set textContent(v) { this._text = String(v); },
});
const findCls = (el, cls) => el.children.find((c) => c.className.split(' ').includes(cls));
const savedWindow = global.window;
global.window = { customJS: { TaskDialog: { reopen() {} } } };
try {
  const nested = { title: 'B', status: 'done', path: 'spice/tasks/A/B/B.md', completed_at: '2026-11-09T09:15:00-06:00' };
  const row = TTL.renderDoneRow(mkEl(''), nested, { onUndo() {} });
  ok('TF-READ-DONE-ROW-REOPEN a done task anywhere in the tree draws the Reopen button', !!findCls(row, 'sauce-today-undo'));
  const noCb = TTL.renderDoneRow(mkEl(''), nested, {});
  ok('TF-READ-DONE-ROW-NO-CALLBACK no button without an onUndo callback', !findCls(noCb, 'sauce-today-undo'));
  const open = TTL.renderDoneRow(mkEl(''), { title: 'O', status: 'open', path: 'spice/tasks/_done/O.md' }, { onUndo() {} });
  ok('TF-READ-DONE-ROW-STATUS an open task has no Reopen button whatever its path', !findCls(open, 'sauce-today-undo'));
  global.window = { customJS: { TaskDialog: {} } };
  const noTD = TTL.renderDoneRow(mkEl(''), nested, { onUndo() {} });
  ok('TF-READ-DONE-ROW-NO-REOPEN no button when TaskDialog cannot reopen', !findCls(noTD, 'sauce-today-undo'));
} finally { global.window = savedWindow; }

ok('TF-READ-ACTIONS a done task gets Reopen + Edit at any path; open and deleted unchanged',
  TNV._actionsFor('done', 'spice/tasks/A/B/B.md').join() === 'reopen,edit'
  && TNV._actionsFor('done', 'spice/tasks/B.md').join() === 'reopen,edit'
  && TNV._actionsFor('open', 'spice/tasks/_done/A.md').join() === 'done,edit'
  && TNV._actionsFor('deleted', 'spice/tasks/_trash/A/A.md').join() === 'edit');

const manifest = JSON.parse(read('mechanisms/task-entity/manifest.json'));
const anc = manifest.breadcrumb.types.task.ancestors.find((x) => x.label === 'fm:parent_task');
ok('TF-READ-BREADCRUMB the parent ancestor links by name', !!anc && anc.link === '{fm:parent_task}');

const mkPage = (p, status, type) => ({ type: type === undefined ? 'task' : type, status, file: { path: p } });
ok('TF-READ-STATE-OPEN-ANYWHERE an open task is open in a folder, flat, or a stale _done path',
  TE.isOpenTask(mkPage('spice/tasks/A/B/B.md', 'open'))
  && TE.isOpenTask(mkPage('spice/tasks/B.md', undefined))
  && TE.isOpenTask(mkPage('spice/tasks/_done/2026/11/A/A.md', 'open')));
ok('TF-READ-STATE-DONE-ANYWHERE a done task is done wherever it lives',
  !TE.isOpenTask(mkPage('spice/tasks/A/B/B.md', 'done'))
  && TE.taskState(mkPage('spice/tasks/_done/2026/11/A/A.md', 'done')) === 'done'
  && TE.taskState(mkPage('spice/tasks/A/B/B.md', 'done')) === 'done');
ok('TF-READ-STATE-DELETED a trashed or deleted task is deleted',
  TE.taskState(mkPage('spice/tasks/_trash/A/A.md', 'open')) === 'deleted'
  && TE.taskState(mkPage('spice/tasks/A/A.md', 'deleted')) === 'deleted');

const PD = load('blueprints/project/helpers/project-dashboard.js', 'ProjectDashboard');
const TD2 = load('blueprints/trips/helpers/trip-dashboard.js', 'TripDashboard');
const pages = [
  { type: 'task', status: 'open', project_slug: 'foo', trip_slug: 't', source: '', title: 'Top', file: { path: 'spice/tasks/Top/Top.md', name: 'Top' } },
  { type: 'task', status: 'open', project_slug: 'foo', trip_slug: 't', source: '', title: 'Kid', file: { path: 'spice/tasks/Top/Kid/Kid.md', name: 'Kid' } },
  { type: 'task', status: 'done', project_slug: 'foo', trip_slug: 't', source: '', title: 'Fin', file: { path: 'spice/tasks/Top/Fin/Fin.md', name: 'Fin' } },
  { type: 'task', status: 'deleted', project_slug: 'foo', trip_slug: 't', source: '', title: 'Gone', file: { path: 'spice/tasks/_trash/Gone/Gone.md', name: 'Gone' } },
  { type: 'task', status: 'open', project_slug: 'foo', trip_slug: 't', source: '', title: 'Flat', file: { path: 'spice/tasks/Flat.md', name: 'Flat' } },
];
const mkDv = () => ({
  pages: () => { const wrap = (a) => Object.assign(a, { where: (fn) => wrap(a.filter(fn)) }); return wrap(pages.slice()); },
});
const savedCJS = global.customJS;
const savedWin = global.window;
(async () => {
  global.window = savedWin;
  global.customJS = { TaskEntity: TE };
  const withTE = (await new PD()._openTasks({ dv: mkDv(), slug: 'foo', currentPage: { project_slug: 'foo' } })).map((t) => t.title).join();
  ok('TF-READ-FILTER-OPEN-NESTED the project open list keeps nested and flat open tasks, drops done and deleted', withTE === 'Top,Kid,Flat');
  ok('TF-READ-FILTER-TRIP-COUNT the trip open count follows status on both layouts', TD2._countOpenTasks(mkDv(), 't') === 3);
  global.customJS = undefined;
  const cold = (await new PD()._openTasks({ dv: mkDv(), slug: 'foo', currentPage: { project_slug: 'foo' } })).map((t) => t.title).join();
  ok('TF-READ-FILTER-COLD-LOAD without TaskEntity the open list falls back to status open and never throws', cold === 'Top,Kid,Flat');
  global.customJS = savedCJS;

  const TODAY = '2026-11-10';
  const doneAt = TODAY + 'T09:00:00-07:00';
  const mkDone = (p, status, title) => ({ type: 'task', status, title, completed_at: doneAt, file: { path: p, name: title } });
  const DONE_PAGES = [
    mkDone('spice/tasks/A/B/B.md', 'done', 'Nested done'),
    mkDone('spice/tasks/_done/2026/11/C/C.md', 'done', 'Archived done'),
    mkDone('spice/tasks/_done/Flat.md', 'done', 'Flat done'),
    mkDone('spice/tasks/_trash/D/D.md', 'deleted', 'Trashed'),
    mkDone('spice/tasks/A/E/E.md', 'deleted', 'Deleted in place'),
    mkDone('spice/tasks/_trash/G/G.md', 'done', 'Done but trashed'),
    { type: 'task', status: 'open', title: 'Still open', file: { path: 'spice/tasks/F/F.md', name: 'Still open' } },
  ];
  const WANT = ['Archived done', 'Flat done', 'Nested done'];
  const queries = [];
  const mkDoneDv = (container) => ({
    container,
    pages(q) {
      queries.push(q);
      const wrap = (arr) => ({ where: (fn) => wrap(arr.filter(fn)), array: () => arr.slice(), length: arr.length });
      return wrap(DONE_PAGES.slice());
    },
    current: () => ({}),
  });
  const node = () => {
    const n = {
      children: [], style: {}, dataset: {}, firstChild: null, lastChild: null, lastElementChild: null,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      createEl(_t, o) { const c = node(); c.cls = (o && o.cls) || ''; n.children.push(c); return c; },
      createDiv() { return n.createEl('div'); },
      appendChild(c) { n.children.push(c); return c; },
      removeChild() {}, setAttribute() {}, addEventListener() {}, setText() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    };
    return n;
  };
  const stubTTL = (seen) => ({
    renderTaskRow(_c, t) { seen.push(t.title || t.path); return node(); },
    renderDoneRow(_c, t) { seen.push(t.title || t.path); return node(); },
  });
  const oldTE = {};
  for (const k of Object.getOwnPropertyNames(TE)) {
    if (typeof TE[k] === 'function' && !['taskState', 'isOpenTask', 'constructor'].includes(k)) oldTE[k] = TE[k].bind(TE);
  }
  const DoneToday = load('mechanisms/task-entity/task-done-today-list.js', 'TaskDoneTodayList');
  const Archive = load('blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
  const SDD = load('blueprints/daily/helpers/space-daily-dashboard.js', 'SpaceDailyDashboard');
  const moment = () => ({ format: () => TODAY });
  const sorted = (a) => a.slice().sort().join();
  const runSurfaces = async (customJS) => {
    global.window = { customJS, moment, localStorage: { getItem: () => 'today', setItem() {} }, app: { vault: {} } };
    const out = {};
    for (const [key, cls] of [['today', DoneToday], ['archive', Archive]]) {
      queries.length = 0;
      const seen = [];
      customJS.TaskTodayList = stubTTL(seen);
      let threw = false;
      try { await new cls().render(mkDoneDv(node())); } catch (_e) { threw = true; }
      out[key] = { seen, threw, queries: queries.slice() };
    }
    return out;
  };
  try {
    const live = await runSurfaces({ TaskEntity: TE, RenderSafe: { page: () => ({}) } });
    ok('TF-READ-DONE-TODAY-NESTED the done-today list shows nested, archived and flat done tasks, not deleted ones',
      sorted(live.today.seen) === sorted(WANT) && !live.today.threw && live.today.queries.join() === '"spice/tasks"');
    ok('TF-READ-DONE-ARCHIVE-NESTED the done archive shows nested, archived and flat done tasks, not deleted ones',
      sorted(live.archive.seen) === sorted(WANT) && !live.archive.threw && live.archive.queries.join() === '"spice/tasks"');

    const stale = await runSurfaces({ TaskEntity: oldTE, RenderSafe: { page: () => ({}) } });
    ok('TF-READ-DONE-TODAY-COLD-STATE a TaskEntity without taskState still selects done, non-trashed tasks',
      sorted(stale.today.seen) === sorted(WANT) && !stale.today.threw);
    ok('TF-READ-DONE-ARCHIVE-COLD-STATE the archive without taskState still selects done, non-trashed tasks',
      sorted(stale.archive.seen) === sorted(WANT) && !stale.archive.threw);

    const bare = await runSurfaces({ RenderSafe: { page: () => ({}) } });
    ok('TF-READ-DONE-SURFACES-NO-TASKENTITY with no TaskEntity at all both lists draw nothing and never throw',
      !bare.today.threw && !bare.archive.threw && bare.today.seen.length === 0 && bare.archive.seen.length === 0);

    global.window = { customJS: {}, moment };
    const dailyDv = {
      pages: (q) => DONE_PAGES.filter((p) => q === '"spice/tasks"'
        || (q === '"spice/tasks/_done"' && p.file.path.indexOf('spice/tasks/_done/') === 0)),
    };
    const dailyLive = SDD.selectTasks(dailyDv, TODAY, new TE());
    ok('TF-READ-DONE-DAILY-NESTED the daily done count and list include nested, archived and flat done tasks, not deleted ones',
      dailyLive.done === 3 && sorted(dailyLive.doneToday.map((t) => t.title)) === sorted(WANT));
    const dailyOld = SDD.selectTasks(dailyDv, TODAY, oldTE);
    ok('TF-READ-DONE-DAILY-COLD-STATE the daily done count without taskState still counts done, non-trashed tasks',
      dailyOld.done === 3 && sorted(dailyOld.doneToday.map((t) => t.title)) === sorted(WANT));
    let dailyCold = null;
    let dailyThrew = false;
    try { dailyCold = SDD.selectTasks(dailyDv, TODAY, null); } catch (_e) { dailyThrew = true; }
    ok('TF-READ-DONE-DAILY-NO-TASKENTITY with no TaskEntity the daily selection is empty and never throws',
      !dailyThrew && dailyCold.done === 0 && dailyCold.doneToday.length === 0 && dailyCold.open.length === 0);
    const donePathSrc = read('blueprints/daily/helpers/space-daily-dashboard.js');
    ok('TF-READ-DONE-NO-DONE-SOURCE no done surface sources spice/tasks/_done',
      ![donePathSrc, read('mechanisms/task-entity/task-done-today-list.js'), read('blueprints/to-do/helpers/task-done-archive.js')]
        .some((src) => /pages\(\s*'"spice\/tasks\/_done"'/.test(src) || /toArr\(\s*'"spice\/tasks\/_done"'/.test(src)));
  } finally { global.window = savedWin; }

  const failed = results.filter(([, c]) => !c).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
})();
