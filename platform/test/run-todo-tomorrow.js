#!/usr/bin/env node
/**
 * run-todo-tomorrow.js — "Move to tomorrow" always moves a task forward.
 * TaskTodayList.tomorrowFor(task, viewedDay) is the day after the later of
 * the viewed day and the task's own due date: on Tuesday's note a task due
 * Wednesday (the week strip's next day) goes to Thursday, one due Thursday to
 * Friday, and an overdue or undated task to Wednesday. The row's button names
 * the day it will move to. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const TTL = new Function(`${read('mechanisms/task-entity/task-today-list.js')}\nreturn TaskTodayList;`)();

const TUE = '2026-11-10';
const at = (due) => TTL.tomorrowFor({ due, status: 'open' }, TUE);
ok('TT-AHEAD on Tuesday, a task due Wednesday moves to Thursday', at('2026-11-11') === '2026-11-12');
ok('TT-AHEAD-2 a task due Thursday moves to Friday', at('2026-11-12') === '2026-11-13');
ok('TT-TODAY a task due today moves to tomorrow', at(TUE) === '2026-11-11');
ok('TT-OVERDUE an overdue task moves to the day after the viewed day', at('2026-11-02') === '2026-11-11');
ok('TT-UNDATED an undated task moves to the day after the viewed day', at('') === '2026-11-11' && at(null) === '2026-11-11');
ok('TT-LUXON a Luxon-like due date reads the same as a string',
  TTL.tomorrowFor({ due: { toFormat: () => '2026-11-11' } }, TUE) === '2026-11-12');
ok('TT-TIMESTAMP a due with a time reads its date', at('2026-11-11T09:00:00-07:00') === '2026-11-12');
ok('TT-ROLLOVER it rolls over months and years', TTL.tomorrowFor({ due: '2026-12-31' }, '2026-12-30') === '2027-01-01');
ok('TT-BAD-DUE a malformed due is ignored', at('2026-13-45') === '2026-11-11' && at('soon') === '2026-11-11');
global.window = { moment: () => ({ format: () => '2026-11-20' }) };
ok('TT-NO-DAY without a viewed day it counts from the wall clock', TTL.tomorrowFor({ due: '' }, '') === '2026-11-21'
  && TTL.tomorrowFor({ due: '2026-11-25' }, 'nope') === '2026-11-26');
delete global.window;
ok('TT-LABEL day labels read "Thu Nov 12"', TTL.dayLabel('2026-11-12') === 'Thu Nov 12' && TTL.dayLabel('') === '');

function makeEl(tag) {
  const el = {
    tag, style: {}, children: [], _attrs: {}, _listeners: {}, dataset: {},
    classList: { add() {} },
    createEl(t, o) { const c = makeEl(t); if (o && o.cls) c._attrs.cls = o.cls; if (o && o.text != null) c.textContent = o.text; el.children.push(c); c.parentNode = el; return c; },
    createSpan(o) { return el.createEl('span', o); },
    addEventListener(name, fn) { el._listeners[name] = fn; },
    setAttribute(k, v) { el._attrs[k] = v; },
    querySelector() { return null; },
  };
  return el;
}
const find = (root, cls) => {
  if (root._attrs && String(root._attrs.cls || '').split(/\s+/).includes(cls)) return root;
  for (const c of root.children || []) { const f = find(c, cls); if (f) return f; }
  return null;
};
{
  const row = TTL.renderTaskRow(makeEl('div'), { title: 'Wed task', path: 'spice/tasks/Wed task.md', due: '2026-11-11', status: 'open' }, null, { viewedDay: TUE, todayStr: TUE });
  const btn = find(row, 'sauce-task-action-tomorrow');
  ok('TT-BUTTON the row\'s tomorrow button names the day it moves to', btn && btn._attrs['aria-label'] === 'Move to Thu Nov 12' && btn._attrs.title === 'Move to Thu Nov 12');
}

const viewSrc = read('blueprints/to-do/helpers/todo-daily-filter-view.js');
ok('TT-BULK Select mode\'s → Tomorrow uses the same per-task rule',
  /action\('→ Tomorrow', \(\) => bulkTomorrow\(\)\);/.test(viewSrc) && /TTL\.tomorrowFor\(task, viewedDay\)/.test(viewSrc));

const failed = results.filter(([, pass]) => !pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
