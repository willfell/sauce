#!/usr/bin/env node
/**
 * run-task-folders-core.js — the pure helpers behind the task-folder layout:
 * vault-unique task names (taskName), folder-note paths, parent and root
 * lookups, the _done/YYYY/MM bucket and the open/done/deleted task state.
 * Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const TE = new Function(fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-entity.js'), 'utf8') + '\nreturn TaskEntity;')();

const free = { taken: () => false };
const takenSet = (...names) => ({ taken: (n) => names.includes(n) });
const isTaken = (...names) => (n) => names.includes(n);

ok('TF-ROOT TASK_ROOT is spice/tasks', TE.TASK_ROOT === 'spice/tasks');

ok('TF-NAME-PLAIN a unique title is the name', TE.taskName('Pay Bills', free) === 'Pay Bills');
ok('TF-NAME-SUBTASK-CLASH a clashing subtask adds its parent title',
  TE.taskName('Review PR', { parentTitle: 'Help Henry', taken: isTaken('review pr') }) === 'Review PR (Help Henry)');
ok('TF-NAME-DATE-CLASH a clashing top-level task adds its creation date',
  TE.taskName('Pay Bills', { createdAt: '2026-11-10T14:06:43-07:00', taken: isTaken('pay bills') }) === 'Pay Bills - 11-10-26');
ok('TF-NAME-NUMBER a clash on the qualified name adds a number',
  TE.taskName('Pay Bills', { createdAt: '2026-11-10T14:06:43-07:00', taken: isTaken('pay bills', 'pay bills - 11-10-26') }) === 'Pay Bills - 11-10-26 2');
ok('TF-NAME-NUMBER-3 numbers keep counting',
  TE.taskName('Pay Bills', { createdAt: '2026-11-10', taken: isTaken('pay bills', 'pay bills - 11-10-26', 'pay bills - 11-10-26 2') }) === 'Pay Bills - 11-10-26 3');
ok('TF-NAME-CASE the clash check ignores case and a bare title gets a number',
  TE.taskName('PAY BILLS', takenSet('pay bills')) === 'PAY BILLS 2');
ok('TF-NAME-SAME-AS-PARENT a subtask named like its parent still gets the suffix',
  TE.taskName('Review', { parentTitle: 'Review', taken: isTaken('review') }) === 'Review (Review)');
ok('TF-NAME-SANITIZED illegal characters are dropped before the check',
  TE.taskName('Fix: a/b', takenSet('fix ab')) === 'Fix ab 2');
{
  const title = 'T'.repeat(80);
  const parent = 'P'.repeat(80);
  const r = TE.taskName(title, { parentTitle: parent, taken: isTaken(title.toLowerCase()) });
  ok('TF-NAME-LENGTH-CAP an 80 + 80 character name keeps the whole title and trims the parent qualifier to fit 120',
    r.length <= 120 && r.startsWith(title) && /^T{80} \(P{1,37}\)$/.test(r) && r.length === 120);
  const r2 = TE.taskName(title, { parentTitle: parent, taken: (n) => !/ 2$/.test(n) });
  ok('TF-NAME-LENGTH-CAP-NUMBER a number suffix on a capped name keeps the title, fits in 120 and ends in the number',
    r2.length <= 120 && r2.startsWith(title) && / 2$/.test(r2) && r2.length === 120);
  const r3 = TE.taskName(title, { createdAt: '2026-11-10', taken: isTaken(title.toLowerCase()) });
  ok('TF-NAME-LENGTH-CAP-DATE a date qualifier on a long title is not cut', r3 === title + ' - 11-10-26');

  const realSanitize = TE._sanitizeTitle;
  TE._sanitizeTitle = (t) => String(t).slice(0, 120);
  try {
    const full = 'F'.repeat(120);
    const seen = new Set([full.toLowerCase()]);
    const r4 = TE.taskName(full, { parentTitle: 'Parent', taken: (n) => seen.has(n) });
    ok('TF-NAME-LENGTH-CAP-FULL a title that alone fills 120 drops the qualifier and takes a number, still within 120 and unique',
      r4.length <= 120 && !seen.has(r4.toLowerCase()) && / 2$/.test(r4) && r4.startsWith('F'.repeat(100)));
  } finally {
    TE._sanitizeTitle = realSanitize;
  }
}

ok('TF-PATHS folderNotePath', TE.folderNotePath('spice/tasks/A', 'B') === 'spice/tasks/A/B/B.md');
ok('TF-PATHS isFolderNote', TE.isFolderNote('spice/tasks/A/B/B.md') && !TE.isFolderNote('spice/tasks/B.md'));
ok('TF-PATHS taskFolderOf', TE.taskFolderOf('spice/tasks/A/B/B.md') === 'spice/tasks/A/B' && TE.taskFolderOf('spice/tasks/B.md') === 'spice/tasks');
ok('TF-PATHS parentNotePathOf a subtask', TE.parentNotePathOf('spice/tasks/A/B/B.md') === 'spice/tasks/A/A.md');
ok('TF-PATHS parentNotePathOf a top-level task', TE.parentNotePathOf('spice/tasks/A/A.md') === '');
ok('TF-PATHS parentNotePathOf a flat note', TE.parentNotePathOf('spice/tasks/B.md') === '');
ok('TF-PATHS parentNotePathOf inside _done', TE.parentNotePathOf('spice/tasks/_done/2026/11/A/B/B.md') === 'spice/tasks/_done/2026/11/A/A.md');
ok('TF-PATHS parentNotePathOf a top-level task in _done', TE.parentNotePathOf('spice/tasks/_done/2026/11/A/A.md') === '');
ok('TF-PATHS parentNotePathOf a top-level task in _trash', TE.parentNotePathOf('spice/tasks/_trash/X/X.md') === '');
ok('TF-PATHS parentNotePathOf a subtask in _trash', TE.parentNotePathOf('spice/tasks/_trash/X/Y/Y.md') === 'spice/tasks/_trash/X/X.md');
ok('TF-PATHS parentNotePathOf outside spice/tasks', TE.parentNotePathOf('spice/notes/A/B/B.md') === '');
ok('TF-PATHS parentNotePathOf three deep', TE.parentNotePathOf('spice/tasks/A/B/C/C.md') === 'spice/tasks/A/B/B.md');
ok('TF-PATHS rootFolderOf in _done', TE.rootFolderOf('spice/tasks/_done/2026/11/A/B/B.md') === 'spice/tasks/_done/2026/11/A');
ok('TF-PATHS rootFolderOf in _trash', TE.rootFolderOf('spice/tasks/_trash/X/X.md') === 'spice/tasks/_trash/X');
ok('TF-PATHS rootFolderOf open', TE.rootFolderOf('spice/tasks/A/B/B.md') === 'spice/tasks/A' && TE.rootFolderOf('spice/tasks/A/A.md') === 'spice/tasks/A');

ok('TF-DONE-FOLDER the completion month names the bucket', TE.doneFolderFor('2026-11-10T09:00:00-07:00') === 'spice/tasks/_done/2026/11');
ok('TF-DONE-FOLDER-BLANK a blank completion uses the current month', /^spice\/tasks\/_done\/\d{4}\/\d{2}$/.test(TE.doneFolderFor('')));

ok('TF-STATE done', TE.taskState({ status: 'done', path: 'spice/tasks/A/A.md' }) === 'done');
ok('TF-STATE trash wins over status', TE.taskState({ status: 'open', path: 'spice/tasks/_trash/X/X.md' }) === 'deleted');
ok('TF-STATE open and missing status', TE.taskState({ status: 'open', path: 'spice/tasks/A/A.md' }) === 'open' && TE.taskState({ path: 'spice/tasks/A/A.md' }) === 'open');
ok('TF-STATE deleted status', TE.taskState({ status: 'deleted', path: 'spice/tasks/A/A.md' }) === 'deleted');
ok('TF-OPEN a nested open task', TE.isOpenTask({ type: 'task', status: 'open', file: { path: 'spice/tasks/A/B/B.md' } }));
ok('TF-OPEN a done task is not open', !TE.isOpenTask({ type: 'task', status: 'done', file: { path: 'spice/tasks/A/B/B.md' } }));
ok('TF-OPEN a trashed task is not open', !TE.isOpenTask({ type: 'task', status: 'open', file: { path: 'spice/tasks/_trash/B/B.md' } }));
ok('TF-OPEN a non-task is not open', !TE.isOpenTask({ type: 'note', status: 'open', file: { path: 'spice/tasks/A/A.md' } }));
ok('TF-OPEN a missing type counts as a task', TE.isOpenTask({ status: 'open', path: 'spice/tasks/A/A.md' }));

const inst = new TE();
ok('TF-DELEGATORS the instance reaches every helper',
  ['taskName', 'folderNotePath', 'isFolderNote', 'taskFolderOf', 'parentNotePathOf', 'rootFolderOf', 'doneFolderFor', 'taskState', 'isOpenTask'].every((k) => typeof inst[k] === 'function') && inst.TASK_ROOT === 'spice/tasks');

const failed = results.filter(([, pass]) => !pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
