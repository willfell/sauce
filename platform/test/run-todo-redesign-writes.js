'use strict';
// Behavioral harness for the to-do redesign's task writes: any-date reschedule,
// reopen from _done/, and field writes (rank / priority / project / due).
const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
async function ok(name, fn) {
  try { await fn(); console.log('ok ' + name); passes++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), (msg || 'mismatch') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}; return ${className};`)();
}
const TaskEntity = new (loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity'))();
const TaskTodayList = new (loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList'))();
const TaskDialog = new (loadClass('mechanisms/task-entity/task-dialog.js', 'TaskDialog'))();

global.Notice = function () {};

function makeRow() {
  return { dataset: {}, parentNode: null, remove() {} };
}

function makeEnv(initialFiles, opts) {
  const o = opts || {};
  const files = new Map();
  for (const [p, fm] of Object.entries(initialFiles)) files.set(p, { path: p, _fm: Object.assign({}, fm) });
  const log = { fmWrites: [], renames: [], mutateCalls: 0 };
  const app = {
    vault: { getAbstractFileByPath: (p) => files.get(p) || null },
    fileManager: {
      async processFrontMatter(f, mutate) {
        await Promise.resolve();
        mutate(f._fm);
        log.fmWrites.push({ path: f.path, fm: Object.assign({}, f._fm) });
      },
      async renameFile(f, to) {
        await Promise.resolve();
        if (o.failRename) throw new Error('rename failed');
        files.delete(f.path);
        log.renames.push({ from: f.path, to });
        f.path = to;
        files.set(to, f);
      },
    },
    workspace: { openLinkText() {} },
  };
  const renderSafe = o.noRenderSafe ? undefined : {
    captureScroll() {},
    async mutate(opts) {
      log.mutateCalls++;
      try {
        const value = await opts.write();
        return { ok: true, value };
      } catch (error) {
        if (typeof opts.revert === 'function') { try { await opts.revert(error); } catch (_e) {} }
        return { ok: false, error };
      }
    },
  };
  global.window = {
    app,
    customJS: { TaskDialog: { open() {} }, TaskEntity, RenderSafe: renderSafe },
    moment: () => ({ format: () => '2099-12-31' }),
  };
  global.app = null;
  return { files, log };
}

(async () => {
  await ok('RD-W-RESCHED', async () => {
    const p = 'spice/tasks/x.md';
    const env = makeEnv({ [p]: { status: 'open', due: '2026-11-09', rank: 3, keep: 'yes' } });
    const r = await TaskTodayList.reschedule(makeRow(), { path: p, due: '2026-11-09', status: 'open', rank: 3 }, '2026-11-16', '2026-11-09', { open() {} });
    assert(r.ok === true && r.due === '2026-11-16', 'result ' + JSON.stringify(r));
    const fm = env.files.get(p)._fm;
    assert(fm.due === '2026-11-16' && fm.rank === '' && fm.keep === 'yes', 'fm ' + JSON.stringify(fm));

    const r2 = await TaskTodayList.reschedule(makeRow(), { path: p, due: '2026-11-16', status: 'open' }, '', '2026-11-09', { open() {} });
    assert(r2.ok === true && r2.due === '', 'backlog result ' + JSON.stringify(r2));
    assert(env.files.get(p)._fm.due === '', 'backlog due empty');

    const r3 = await TaskTodayList.reschedule(makeRow(), { path: p, due: '', status: 'open' }, 'next week', '2026-11-09', { open() {} });
    assert(r3.ok === false && r3.no_op === true, 'malformed date is a no-op');
  });

  await ok('RD-W-TOMORROW-COMPAT', async () => {
    const p = 'spice/tasks/f.md';
    const env = makeEnv({ [p]: { status: 'open', due: '2026-11-13', rank: 1 } });
    const r = await TaskTodayList.rescheduleTomorrow(makeRow(), { path: p, due: '2026-11-13', status: 'open' }, '2026-11-13', { open() {} });
    assert(r.ok === true && r.due === '2026-11-14', 'result ' + JSON.stringify(r));
    assert(env.files.get(p)._fm.due === '2026-11-14', 'due');
    assert(env.files.get(p)._fm.rank === '', 'rank cleared');
  });

  await ok('RD-W-REOPEN', async () => {
    const src = 'spice/tasks/_done/A.md';
    const env = makeEnv({ [src]: { status: 'done', completed_at: '2026-11-06T10:00:00-07:00', title: 'A' } });
    const r = await TaskDialog.reopen(src);
    assert(r.ok === true && r.path === 'spice/tasks/A.md', 'result ' + JSON.stringify(r));
    const f = env.files.get('spice/tasks/A.md');
    assert(f && f._fm.status === 'open' && f._fm.completed_at === '', 'fm ' + JSON.stringify(f && f._fm));
    eq(env.log.renames, [{ from: src, to: 'spice/tasks/A.md' }], 'rename');
    assert(env.log.mutateCalls === 1, 'went through RenderSafe.mutate');

    const env2 = makeEnv({
      [src]: { status: 'done', completed_at: 'x' },
      'spice/tasks/A.md': { status: 'open' },
    });
    const r2 = await TaskDialog.reopen(src);
    assert(r2.ok === true && r2.path === 'spice/tasks/A 2.md', 'collision ' + JSON.stringify(r2));
    assert(env2.files.has('spice/tasks/A 2.md') && env2.files.has('spice/tasks/A.md'), 'both files exist');

    const env3 = makeEnv({ 'spice/tasks/B.md': { status: 'open' } });
    const r3 = await TaskDialog.reopen('spice/tasks/B.md');
    assert(r3.ok === false && r3.reason === 'not-done', 'non-done ' + JSON.stringify(r3));
    assert(env3.log.mutateCalls === 0 && env3.log.fmWrites.length === 0, 'no write for non-done');
  });

  await ok('RD-W-REOPEN-NO-RENDERSAFE', async () => {
    const src = 'spice/tasks/_done/A.md';
    const env = makeEnv({ [src]: { status: 'done' } }, { noRenderSafe: true });
    const r = await TaskDialog.reopen(src);
    assert(r.ok === false && r.reason === 'render-safe-unavailable', JSON.stringify(r));
    assert(env.log.fmWrites.length === 0 && env.log.renames.length === 0, 'no bare write');
    const r2 = await TaskDialog.setFields(src, { rank: 1 });
    assert(r2.ok === false && r2.reason === 'render-safe-unavailable', JSON.stringify(r2));
    assert(env.log.fmWrites.length === 0, 'no bare setFields write');
  });

  await ok('RD-W-REOPEN-RENAME-FAILURE-RESTORES-DONE', async () => {
    const src = 'spice/tasks/_done/A.md';
    const env = makeEnv({ [src]: { status: 'done', completed_at: 'x' } }, { failRename: true });
    const r = await TaskDialog.reopen(src);
    assert(r.ok === false, 'failure reported');
    assert(env.files.get(src)._fm.status === 'done', 'status restored to done after failed rename');
  });

  await ok('RD-W-SETFIELDS', async () => {
    const p = 'spice/tasks/s.md';
    const env = makeEnv({ [p]: { status: 'open', due: '2026-11-09', rank: 5, priority: 'low' } });
    const r = await TaskDialog.setFields(p, { due: '2026-11-16' });
    assert(r.ok === true, JSON.stringify(r));
    let fm = env.files.get(p)._fm;
    assert(fm.due === '2026-11-16' && fm.rank === '' && fm.priority === 'low', 'due write ' + JSON.stringify(fm));

    const r2 = await TaskDialog.setFields(p, { rank: 2 });
    assert(r2.ok === true, JSON.stringify(r2));
    fm = env.files.get(p)._fm;
    assert(fm.rank === 2 && fm.due === '2026-11-16', 'rank only ' + JSON.stringify(fm));

    await TaskDialog.setFields(p, { due: '2026-11-20', rank: 7 });
    fm = env.files.get(p)._fm;
    assert(fm.due === '2026-11-20' && fm.rank === 7, 'explicit rank wins ' + JSON.stringify(fm));

    const last = env.log.fmWrites;
    assert(env.log.mutateCalls === 3 && last.length === 3, 'every write through mutate');

    const r3 = await TaskDialog.setFields(p, {});
    assert(r3.ok === false, 'empty fields refused');
    const r4 = await TaskDialog.setFields('spice/tasks/missing.md', { rank: 1 });
    assert(r4.ok === false, 'missing file refused');
  });

  await ok('RD-W-INFLIGHT', async () => {
    const src = 'spice/tasks/_done/A.md';
    const env = makeEnv({ [src]: { status: 'done' } });
    const [a, b] = await Promise.all([TaskDialog.reopen(src), TaskDialog.reopen(src)]);
    const oks = [a, b].filter((x) => x.ok).length;
    assert(oks === 1, 'exactly one reopen succeeds: ' + JSON.stringify([a, b]));
    assert(env.log.fmWrites.length === 1 && env.log.renames.length === 1, 'one write each');

    const p = 'spice/tasks/r.md';
    const env2 = makeEnv({ [p]: { status: 'open', due: '2026-11-09' } });
    const task = { path: p, due: '2026-11-09', status: 'open' };
    const [c, d] = await Promise.all([
      TaskTodayList.reschedule(makeRow(), task, '2026-11-16', '2026-11-09', { open() {} }),
      TaskTodayList.reschedule(makeRow(), task, '2026-11-16', '2026-11-09', { open() {} }),
    ]);
    assert([c, d].filter((x) => x.ok).length === 1 && [c, d].filter((x) => x.in_flight).length === 1, 'reschedule guard ' + JSON.stringify([c, d]));
    assert(env2.log.fmWrites.length === 1, 'one reschedule write');
  });

  await ok('RD-W-SAVEEDIT-RANK', async () => {
    const p = 'spice/tasks/e.md';
    const env = makeEnv({ [p]: { status: 'open', title: 'E', due: '2026-11-09', rank: 4 } });
    const file = env.files.get(p);
    const payload = (due) => ({ title: 'E', due, priority: '', recurrence: '', project: null, trip: null, links: [] });
    await TaskDialog._saveEdit(global.window.app, file, payload('2026-11-09'), null);
    assert(file._fm.rank === 4, 'unchanged due keeps rank');
    await TaskDialog._saveEdit(global.window.app, file, payload('2026-11-12'), null);
    assert(file._fm.due === '2026-11-12' && file._fm.rank === '', 'changed due clears rank: ' + JSON.stringify(file._fm));
  });

  console.log(passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
