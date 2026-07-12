'use strict';
// Behavioral harness for TaskTripList (CustomJS) — the trip analogue of
// TaskProjectList. Exercises the pure static _matches(task, tripSlug) filter
// via the same instance-call form customJS uses (customJS.TaskTripList = new
// TaskTripList()), loaded bare (new Function(src + "; return TaskTripList;"))
// the same way run-task-entity.js loads TaskProjectList.
const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
function ok(name, fn) { try { fn(); console.log('ok ' + name); passes++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}; return ${className};`)();
}

const TaskTripListClass = loadClass('mechanisms/task-entity/task-trip-list.js', 'TaskTripList');
const TaskTripList = new TaskTripListClass();

ok('TTL-1 _matches keys off trip_slug (raw plain-string equality)', () => {
  assert(TaskTripList._matches({ trip_slug: 'bussin' }, 'bussin') === true, 'exact match');
  assert(TaskTripList._matches({ trip_slug: 'other' }, 'bussin') === false, 'non-match');
  assert(TaskTripList._matches({ trip_slug: '' }, 'bussin') === false, 'blank slug → false');
  assert(TaskTripList._matches({ trip_slug: 'bussin' }, '') === false, 'blank target → false');
  assert(TaskTripList._matches(null, 'bussin') === false, 'null task → false');
});

// TTL-2. _matches excludes meeting-sourced tasks (mirrors TaskProjectList's
// dedup with "From Meetings" — meeting-sourced tasks render elsewhere).
ok('TTL-2 _matches excludes meeting-sourced tasks', () => {
  assert(TaskTripList._matches({ trip_slug: 'bussin', source: 'meeting' }, 'bussin') === false,
    'meeting-sourced with matching slug → false');
  assert(TaskTripList._matches({ trip_slug: 'bussin', source: 'trip' }, 'bussin') === true,
    'trip-sourced → true');
  assert(TaskTripList._matches({ trip_slug: 'bussin', source: 'daily' }, 'bussin') === true,
    'daily-sourced → true');
  assert(TaskTripList._matches({ trip_slug: 'bussin' }, 'bussin') === true,
    'missing source → true');
  assert(TaskTripList._matches({ trip_slug: 'bussin', source: '' }, 'bussin') === true,
    'blank source → true');
});

// Prompt-flavored assertions (status open, non-meeting, matching slug) built
// on top of the same _matches contract — task-status/path filtering happens
// in render()'s dv.pages() query, not in the pure _matches guard.
ok('TTL-3 prompt-style scenarios', () => {
  const m = (t, slug) => TaskTripList._matches(t, slug);
  assert(m({ type: 'task', status: 'open', trip_slug: 'bussin', source: '', file: { path: 'spice/tasks/a.md' } }, 'bussin') === true);
  assert(m({ type: 'task', status: 'open', trip_slug: 'other', source: '', file: { path: 'spice/tasks/b.md' } }, 'bussin') === false);
  assert(m({ type: 'task', status: 'open', trip_slug: 'bussin', source: 'meeting', file: { path: 'spice/tasks/c.md' } }, 'bussin') === false);
});

console.log(`\n${passes} passed, ${fails} failed`);
if (fails > 0) process.exit(1);
