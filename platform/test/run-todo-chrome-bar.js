#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const ToDoChromeBar = loadClass('platform/blueprints/to-do/helpers/todo-chrome-bar.js', 'ToDoChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ToDoChromeBar();
const cfg = inst._config();

// TDCB-DETECT — classify surfaces by frontmatter type; null off-surface.
{
  const todo = cfg.detect({}, { file: { path: 'spice/to-do/2026/07-July/ToDo-2026-07-06.md' }, type: 'to-do' });
  const hub = cfg.detect({}, { file: { path: 'spice/to-do/All-ToDos.md' }, type: 'to-do-hub' });
  const ptodo = cfg.detect({}, { file: { path: 'spice/projects/conn/Connectors To-Do.md' }, type: 'project-todo' });
  const rec = cfg.detect({}, { file: { path: 'spice/to-do/Recurring Tasks.md' }, type: 'to-do-recurring' });
  const recList = cfg.detect({}, { file: { path: 'spice/to-do/Recurring.md' }, type: 'to-do-recurring-list' });
  const off = cfg.detect({}, { file: { path: 'spice/wiki/Wiki.md' }, type: 'wiki-hub' });
  ok('TDCB-DETECT-1 to-do/hub/project-todo/recurring classify; non-todo → null',
    todo && todo.context === 'to-do' && hub && hub.context === 'to-do-hub'
    && ptodo && ptodo.context === 'project-todo' && rec && rec.context === 'to-do-recurring'
    && recList && recList.context === 'to-do-recurring-list'
    && off === null);
}

// TDCB-SPEC — surface specs match approved design.
{
  const daily = cfg.surfaceSpec({ context: 'to-do' });
  const hub = cfg.surfaceSpec({ context: 'to-do-hub' });
  const ptodo = cfg.surfaceSpec({ context: 'project-todo' });
  const rec = cfg.surfaceSpec({ context: 'to-do-recurring' });
  const recListSpec = cfg.surfaceSpec({ context: 'to-do-recurring-list' });
  ok('TDCB-SPEC-1 daily: primary new-task + 3 overflow (recurring/all-todos/completed-tasks) + leaf',
    daily.primary && daily.primary.id === 'new-task' && daily.overflow.length === 3 && daily.leaf === true
    && daily.overflow.some(e => e.id === 'completed-tasks'));
  ok('TDCB-SPEC-2 hub: no primary + back-today overflow + not leaf',
    hub.primary === null && hub.overflow.length === 1 && hub.overflow[0].id === 'back-today' && hub.leaf === false);
  ok('TDCB-SPEC-3 project-todo: primary new-task + recurring overflow + leaf',
    ptodo.primary && ptodo.primary.id === 'new-task' && ptodo.overflow.length === 1 && ptodo.overflow[0].id === 'recurring' && ptodo.leaf === true);
  ok('TDCB-SPEC-4 recurring: no primary + 2 overflow (all-todos/completed-tasks) + leaf',
    rec.primary === null && rec.overflow.length === 2 && rec.overflow.some(e => e.id === 'all-todos')
    && rec.overflow.some(e => e.id === 'completed-tasks') && rec.leaf === true);
  ok('TDCB-SPEC-5 recurring-list: no primary + 2 overflow (all-todos/completed-tasks) + leaf',
    recListSpec.primary === null && recListSpec.overflow.length === 2 && recListSpec.overflow.some(e => e.id === 'all-todos')
    && recListSpec.overflow.some(e => e.id === 'completed-tasks') && recListSpec.leaf === true);
}

// TDCB-DISPATCH — routes to correct handlers.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.window = { customJS: { TaskDialog: { open: (o) => calls.push({ taskDialog: o }) } }, moment: () => ({ format: () => '2026-07-06' }) };
  global.app = { workspace: { openLinkText: (p) => calls.push({ openLink: p }) }, commands: { commands: {} } };
  global.Notice = function(m) { calls.push({ notice: m }); };
  global.customJS = window.customJS;

  cfg.dispatch({}, { context: 'to-do' }, 'new-task');
  cfg.dispatch({}, { context: 'to-do' }, 'recurring');
  cfg.dispatch({}, { context: 'to-do' }, 'all-todos');
  cfg.dispatch({}, { context: 'to-do' }, 'completed-tasks');
  cfg.dispatch({}, { context: 'to-do-hub' }, 'back-today');

  ok('TDCB-DISPATCH-1 new-task → TaskDialog.open with surface "daily" + a today date (matches TaskEntity.defaultsForSurface\'s contract, NOT "today"/"scheduled" which silently fall through to source:manual with no scheduled date)',
    calls.some(c => c.taskDialog && c.taskDialog.surface === 'daily' && c.taskDialog.today === '2026-07-06'));
  ok('TDCB-DISPATCH-2 recurring → openLinkText(Recurring.md, the new index)', calls.some(c => c.openLink === 'spice/to-do/Recurring.md'));
  ok('TDCB-DISPATCH-3 all-todos → openLinkText(All-ToDos)', calls.some(c => c.openLink === 'spice/to-do/All-ToDos.md'));
  ok('TDCB-DISPATCH-4 completed-tasks → openLinkText(Completed Tasks)', calls.some(c => c.openLink === 'spice/to-do/Completed Tasks.md'));

  global.customJS = prevCJS;
  delete global.window;
  delete global.app;
  delete global.Notice;
}

// TDCB-DEST — destinations include section marker + today + all-todos.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} } };
  global.window = { moment: () => ({ format: (f) => f === 'YYYY-MM-DD' ? '2026-07-06' : '2026/07-July' }) };
  const dests = cfg.destinations({}, { context: 'to-do-recurring', path: 'spice/to-do/Recurring Tasks.md' });
  ok('TDCB-DEST-1 includes This to-do section + Today + All To-Dos + Completed Tasks',
    dests[0] && dests[0].section === 'This to-do'
    && dests.some(e => e && e.label === "Today's To-Do")
    && dests.some(e => e && e.label === 'All To-Dos')
    && dests.some(e => e && e.label === 'Completed Tasks'));
  global.customJS = prevCJS;
  delete global.window;
}

// TDCB-CLASS — rootClass + btnClass correct.
{
  ok('TDCB-CLASS-1 rootClass + btnClass',
    cfg.rootClass === 'todo-chrome-root' && cfg.btnClass('go') === 'todo-chrome-btn todo-chrome-btn-go');
}

// TDCB-CONTRACT — end-to-end proof that ToDoChromeBar's new-task dispatch
// opts actually produce a scheduled task via the REAL TaskEntity.defaultsForSurface
// (not a mock). This is the regression the bug fix targets: the dispatch used to
// send { surface: "today", scheduled: <date> } — a surface value / key name
// defaultsForSurface does not recognize — which silently fell through to its
// default case (source: manual, no scheduled date), so the created task never
// appeared in TaskTodayList (which requires a scheduled date). Loading the real
// TaskDialog class here (not stubbed) closes the gap that let a wrong-but-plausible
// opts shape ship without any test catching it.
{
  const TaskDialogClass = loadClass('platform/mechanisms/task-entity/task-dialog.js', 'TaskDialog');
  const correctDefaults = TaskDialogClass.defaultsForSurface({ surface: 'daily', today: '2026-07-06' });
  ok('TDCB-CONTRACT-1 the dispatch opts shape (surface:"daily", today:<date>) yields a real scheduled date + source:daily',
    correctDefaults.scheduled === '2026-07-06' && correctDefaults.source === 'daily');

  const buggyDefaults = TaskDialogClass.defaultsForSurface({ surface: 'today', scheduled: '2026-07-06' });
  ok('TDCB-CONTRACT-2 sanity: the OLD buggy opts shape (surface:"today", scheduled:<date>) is confirmed unrecognized (source:manual, no scheduled) — proves this was a real, silent defect',
    buggyDefaults.source === 'manual' && !buggyDefaults.scheduled);
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
