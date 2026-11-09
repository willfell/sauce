'use strict';
// Behavioral harness for the to-do redesign's pure TaskEntity helpers:
// date math, bucketing, sort comparators, completed-day, title shortcuts,
// notes-size arithmetic and the parseNote additions (rank, mtime).
const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
function ok(name, fn) { try { fn(); console.log('ok ' + name); passes++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}; return ${className};`)();
}
const TaskEntityClass = loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity');
const TE = new TaskEntityClass();

const T = '2026-11-09'; // Monday

ok('RD-E-DATES', () => {
  assert(TE.tomorrow(T) === '2026-11-10');
  assert(TE.nextMonday(T) === '2026-11-16');            // Monday -> following Monday
  assert(TE.nextMonday('2026-11-08') === '2026-11-09'); // Sunday -> next day
  assert(TE.nextMonday('2026-11-13') === '2026-11-16'); // Friday
  assert(TE.addDays('2026-12-31', 1) === '2027-01-01');
  assert(TE.STALE_DAYS === 30);
});

ok('RD-E-BUCKETS', () => {
  const b = (t) => TE.bucketOf(Object.assign({ status: 'open' }, t), T);
  assert(b({ due: T }) === 'today');
  assert(b({ due: '2026-11-02' }) === 'overdue');       // 7 late
  assert(b({ due: '2026-10-11' }) === 'overdue');       // 29 late
  assert(b({ due: '2026-10-10' }) === 'stale');         // 30 late
  assert(b({ due: '2026-11-30' }) === 'upcoming');
  assert(b({ due: '' }) === 'backlog');
  assert(b({ due: '', project_slug: 'alpha' }) === 'undated');
  assert(b({ due: '', source: 'meeting' }) === 'undated');
  assert(b({ due: '', parent_task: 'Parent' }) === 'undated');
  assert(b({ due: '', trip_slug: 'x' }) === 'undated');
  assert(TE.bucketOf({ status: 'done', due: T }, T) === 'done');
  assert(TE.daysLate({ status: 'open', due: '2026-11-02' }, T) === 7);
  assert(TE.daysLate({ status: 'open', due: T }, T) === 0);
  assert(TE.daysLate({ status: 'open', due: '2026-11-30' }, T) === 0);
  assert(TE.daysLate({ status: 'open', due: '' }, T) === 0);
  assert(TE.isBacklog({ status: 'open', due: '' }) === true);
  assert(TE.isBacklog({ status: 'open', due: T }) === false);
  assert(TE.isBacklog({ status: 'done', due: '' }) === false);
  assert(TE.bucketOf({ status: 'deleted', due: '' }, T) === 'undated');
});

ok('RD-E-SMART', () => {
  const tasks = [
    { title: 'c none old',  priority: '',     due: T, created_at: '2026-10-01T09:00:00-07:00' },
    { title: 'b high',      priority: 'high', due: T, created_at: '2026-11-05T09:00:00-07:00' },
    { title: 'a ranked 2',  priority: '',     due: T, rank: 2 },
    { title: 'z ranked 1',  priority: 'low',  due: T, rank: 1 },
    { title: 'd none late', priority: '',     due: '2026-11-01', created_at: '2026-11-06T09:00:00-07:00' },
  ];
  const order = tasks.slice().sort(TE.compareBy('smart', T)).map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['z ranked 1', 'a ranked 2', 'b high', 'd none late', 'c none old']), order.join(' | '));
});

ok('RD-E-MODES', () => {
  const titles = (arr, mode) => arr.slice().sort(TE.compareBy(mode, T)).map((t) => t.title).join(',');

  const pri = [
    { title: 'none' }, { title: 'low', priority: 'low' }, { title: 'highest', priority: 'highest' },
    { title: 'medium', priority: 'medium' }, { title: 'high', priority: 'high' },
  ];
  assert(titles(pri, 'priority') === 'highest,high,medium,low,none', titles(pri, 'priority'));

  const due = [
    { title: 'blank', due: '' }, { title: 'late', due: '2026-12-01' }, { title: 'soon', due: '2026-11-10' },
  ];
  assert(titles(due, 'due') === 'soon,late,blank', titles(due, 'due'));

  const old = [
    { title: 'missing' }, { title: 'new', created_at: '2026-11-05T09:00:00-07:00' }, { title: 'old', created_at: '2026-10-01T09:00:00-07:00' },
  ];
  assert(titles(old, 'oldest') === 'old,new,missing', titles(old, 'oldest'));

  const touched = [
    { title: 'missing' }, { title: 'stale', mtime: 100 }, { title: 'fresh', mtime: 900 },
  ];
  assert(titles(touched, 'touched') === 'fresh,stale,missing', titles(touched, 'touched'));

  const manual = [
    { title: 'unranked late', created_at: '2026-11-05T09:00:00-07:00' },
    { title: 'unranked early', created_at: '2026-10-01T09:00:00-07:00' },
    { title: 'r2', rank: 2 }, { title: 'r1', rank: 1 },
  ];
  assert(titles(manual, 'manual') === 'r1,r2,unranked early,unranked late', titles(manual, 'manual'));

  const mixed = [
    { title: 'plain', due: T }, { title: 'ranked', due: T, rank: 1 }, { title: 'high', due: T, priority: 'high' },
  ];
  assert(titles(mixed, 'bogus') === titles(mixed, 'smart'), 'bogus behaves as smart');
  assert(titles(mixed, 'smart') === 'ranked,high,plain', titles(mixed, 'smart'));
});

ok('RD-E-LEGACY', () => {
  const weird = [
    { title: 'luxon', due: { toFormat: () => '2026-11-02' }, status: 'open' },
    { title: 'nocreated', due: T, status: 'open', priority: 'urgent' },
    { title: 'badrank', due: T, status: 'open', rank: 'abc' },
  ];
  weird.slice().sort(TE.compareBy('smart', T));
  assert(TE.bucketOf(weird[0], T) === 'overdue');
  const parsed = TE.parseNote({ type: 'task', title: 'x', status: 'open', completed_at: '2026-11-05T10:00:00-07:00', rank: 'abc', file: { path: 'spice/tasks/x.md', mtime: { ts: 5 } } });
  assert(parsed.completed_at === null && parsed.rank === null);
  assert(parsed.mtime === 5, 'mtime from luxon ts');
});

ok('RD-E-PARSE', () => {
  const p = (page) => TE.parseNote(Object.assign({ type: 'task', title: 'x', file: { path: 'spice/tasks/x.md' } }, page));
  assert(p({ rank: 3 }).rank === 3);
  assert(p({ rank: '4' }).rank === 4);
  assert(p({ rank: '' }).rank === null);
  assert(p({}).rank === null);
  assert(p({}).mtime === null);
  assert(p({ file: { path: 'a.md', mtime: 1234 } }).mtime === 1234);
  assert(p({ file: { path: 'a.md', mtime: { toMillis: () => 77 } } }).mtime === 77);
  assert(p({ status: 'done', completed_at: '2026-11-05T10:00:00-07:00' }).completed_at === '2026-11-05T10:00:00-07:00');
  assert(p({ status: 'open', completed_at: '2026-11-05T10:00:00-07:00' }).completed_at === null);
  assert(p({ title: 'keep', project_slug: 'alpha' }).project_slug === 'alpha');
});

ok('RD-E-DONEDAY', () => {
  assert(TE.completedDay({ completed_at: '2026-11-06T23:30:00-07:00' }) === '2026-11-06');
  assert(TE.completedDay({ completed_at: { toISODate: () => '2026-11-06' } }) === '2026-11-06');
  assert(TE.completedDay({ completed_at: '' }) === null);
});

ok('RD-E-SC', () => {
  const P = ['SCI', 'Content Registry', 'EMS'];
  const r = TE.parseTitleShortcuts('Size the paging condition next mon !high #SCI', T, P);
  assert(r.title === 'Size the paging condition' && r.due === '2026-11-16' && r.priority === 'high' && r.project === 'SCI');
  assert(TE.parseTitleShortcuts('Ship it tomorrow', T, P).due === '2026-11-10');
  assert(TE.parseTitleShortcuts('Ship it fri', T, P).due === '2026-11-13');
  assert(TE.parseTitleShortcuts('Ship it #"content registry"', T, P).project === 'Content Registry');
  assert(TE.parseTitleShortcuts('Ship it #ems', T, P).project === 'EMS');
  assert(TE.parseTitleShortcuts('Ship it today', T, P).due === T);
  assert(TE.parseTitleShortcuts('Ship it next monday', T, P).due === '2026-11-16');
  assert(TE.parseTitleShortcuts('Ship it #content', T, P).project === 'Content Registry');
  assert(TE.parseTitleShortcuts('Ship it !highest', T, P).priority === 'highest');
});

ok('RD-E-SC-SAFE', () => {
  const P = ['SCI'];
  for (const s of ['Prep Monday standup notes', 'Fix #1 priority bug', 'Email Tom tomorrow about X', 'Look at #unknownproj']) {
    const r = TE.parseTitleShortcuts(s, T, P);
    assert(r.title === s && !r.due && !r.priority && !r.project, s);
  }
});

ok('RD-E-NOTESBYTES', () => {
  const chrome = TE._chromeBody().length;
  assert(TE.notesBytes(400 + chrome + 5000, 400) === 5000);
  assert(TE.notesBytes(100, 400) === 0);
});

console.log(passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
