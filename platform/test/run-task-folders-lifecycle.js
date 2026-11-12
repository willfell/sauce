#!/usr/bin/env node
/**
 * run-task-folders-lifecycle.js — finish, reopen and delete on the folder
 * layout. A finished subtask stays in place; a finished top-level task moves
 * its whole folder to spice/tasks/_done/YYYY/MM/; reopening a note inside a
 * _done tree reopens its ancestors and moves the tree back; a deleted task's
 * folder moves to spice/tasks/_trash/. Flat legacy notes keep the old moves.
 * Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const TEClass = new Function(fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-entity.js'), 'utf8') + '\nreturn TaskEntity;')();
const TDSrc = fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-dialog.js'), 'utf8');
const TDClass = new Function('window', 'Notice', 'document', 'globalThis', TDSrc + '\nreturn TaskDialog;');

const DAY = '2026-11-10';
const ISO = DAY + 'T09:00:00-07:00';
const momentStub = () => ({
  format: (f) => (f === 'YYYY-MM-DDTHH:mm:ssZ' ? ISO : f === 'YYYY-MM' ? DAY.slice(0, 7) : DAY),
});

function makeApp(seed) {
  const files = new Map();
  const folders = new Map();
  const log = { renames: [], fmWrites: [], createdFolders: [], mutateCalls: 0 };
  const dirOf = (p) => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));
  const baseOf = (p) => p.split('/').pop().replace(/\.md$/i, '');
  const addFolder = (d) => {
    for (let x = d; x; x = dirOf(x)) if (!folders.has(x)) folders.set(x, { path: x, children: [] });
  };
  addFolder('spice/tasks');
  addFolder('spice/wiki');
  for (const [p, fm] of Object.entries(seed || {})) {
    files.set(p, { path: p, basename: baseOf(p), extension: 'md', _fm: Object.assign({ type: 'task' }, fm) });
    addFolder(dirOf(p));
  }
  const app = {
    _files: files,
    _folders: folders,
    _log: log,
    vault: {
      getMarkdownFiles: () => Array.from(files.values()),
      getAbstractFileByPath: (p) => files.get(p) || folders.get(p) || null,
      createFolder: async (p) => {
        if (folders.has(p)) throw new Error('Folder already exists');
        if (!folders.has(dirOf(p))) throw new Error('Parent folder missing: ' + p);
        folders.set(p, { path: p, children: [] });
        log.createdFolders.push(p);
      },
    },
    metadataCache: {
      getFileCache: (f) => (f && f._fm ? { frontmatter: f._fm } : null),
      getFirstLinkpathDest: () => null,
    },
    fileManager: {
      processFrontMatter: async (f, fn) => {
        await Promise.resolve();
        fn(f._fm);
        log.fmWrites.push({ path: f.path, fm: Object.assign({}, f._fm) });
      },
      renameFile: async (f, to) => {
        await Promise.resolve();
        if (app._failRename) throw new Error('rename failed');
        if (files.has(to) || folders.has(to)) throw new Error('Destination exists: ' + to);
        if (!folders.has(dirOf(to))) throw new Error('Destination folder missing: ' + to);
        log.renames.push({ from: f.path, to });
        if (files.get(f.path) === f) {
          files.delete(f.path);
          f.path = to;
          f.basename = baseOf(to);
          files.set(to, f);
          return;
        }
        const from = f.path;
        const moveKey = (p) => to + p.slice(from.length);
        for (const [p, file] of Array.from(files.entries())) {
          if (p.indexOf(from + '/') !== 0) continue;
          files.delete(p);
          file.path = moveKey(p);
          files.set(file.path, file);
        }
        for (const [p, folder] of Array.from(folders.entries())) {
          if (p !== from && p.indexOf(from + '/') !== 0) continue;
          folders.delete(p);
          folder.path = moveKey(p);
          folders.set(folder.path, folder);
        }
      },
    },
  };
  return app;
}

function setup(app, extra) {
  const TE = new TEClass();
  const renderSafe = {
    captureScroll() {},
    async mutate(opts) {
      app._log.mutateCalls++;
      try {
        const value = await opts.write();
        return { ok: true, value };
      } catch (error) {
        if (typeof opts.revert === 'function') { try { await opts.revert(error); } catch (_e) {} }
        return { ok: false, error };
      }
    },
  };
  const customJS = Object.assign({ TaskEntity: TE, RenderSafe: renderSafe }, extra || {});
  const win = { app, customJS, moment: momentStub };
  global.window = win;
  global.app = null;
  global.Notice = function () {};
  const doc = { body: {} };
  const TD = new (TDClass(win, global.Notice, doc, { app, customJS }))();
  return { TD, TE, customJS };
}

const fmOf = (app, p) => (app._files.get(p) || {})._fm || null;

(async () => {
  const savedWin = global.window;
  const savedApp = global.app;
  const savedNotice = global.Notice;
  try {
    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[A]]' },
      });
      const { TD } = setup(app);
      const r = await TD.markDone('spice/tasks/A/B/B.md');
      const fm = fmOf(app, 'spice/tasks/A/B/B.md');
      ok('TF-DONE-SUBTASK-STAYS finishing a subtask sets status done and leaves the path',
        r && r.ok === true && fm && fm.status === 'done' && fm.completed_at === ISO
        && app._log.renames.length === 0 && fmOf(app, 'spice/tasks/A/A.md').status === 'open');
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'done', title: 'B', completed_at: '2026-11-01T08:00:00-07:00', parent_task: '[[A]]' },
      });
      const { TD } = setup(app);
      let asked = 0;
      TD.confirmComplete = async () => { asked++; return true; };
      const r = await TD.markDone('spice/tasks/A/A.md');
      const a = fmOf(app, 'spice/tasks/_done/2026/11/A/A.md');
      const b = fmOf(app, 'spice/tasks/_done/2026/11/A/B/B.md');
      ok('TF-DONE-ROOT-MOVES-TREE finishing a top-level task moves its whole folder to _done/YYYY/MM',
        r && r.ok === true && r.path === 'spice/tasks/_done/2026/11/A/A.md'
        && a && a.status === 'done' && a.completed_at === ISO
        && b && b.status === 'done' && b.completed_at === '2026-11-01T08:00:00-07:00'
        && !app._folders.has('spice/tasks/A') && asked === 0);
      ok('TF-DONE-ROOT-ONE-RENAME the folder moves with one renameFile on the folder itself',
        app._log.renames.length === 1 && app._log.renames[0].from === 'spice/tasks/A'
        && app._log.renames[0].to === 'spice/tasks/_done/2026/11/A');
      ok('TF-DONE-ROOT-ENSURES-MONTH the _done year and month folders are created outermost first',
        app._log.createdFolders.join('|') === 'spice/tasks/_done|spice/tasks/_done/2026|spice/tasks/_done/2026/11');
    }

    {
      const app = makeApp({
        'spice/tasks/_done/2026/11/A/notes.txt.md': { type: 'note' },
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
      });
      app._folders.set('spice/tasks/_done/2026/11/A', { path: 'spice/tasks/_done/2026/11/A', children: [] });
      const { TD } = setup(app);
      const r = await TD.markDone('spice/tasks/A/A.md');
      ok('TF-DONE-ROOT-MONTH-CLASH a taken month folder gets " 2", and the note keeps its folder name',
        r && r.ok === true && r.path === 'spice/tasks/_done/2026/11/A 2/A 2.md'
        && fmOf(app, 'spice/tasks/_done/2026/11/A 2/A 2.md').status === 'done');
    }

    {
      const seed = {
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[A]]' },
        'spice/tasks/A/B/C/C.md': { status: 'open', title: 'C', parent_task: '[[B]]' },
      };
      const app = makeApp(seed);
      const { TD } = setup(app);
      let askedFor = null;
      TD.confirmComplete = async (p) => { askedFor = p; return false; };
      const r = await TD.markDone('spice/tasks/A/A.md');
      ok('TF-DONE-OPEN-CHILDREN-ASK No gives { ok: false, reason: cancelled } and changes nothing',
        r && r.ok === false && r.reason === 'cancelled' && askedFor === 'spice/tasks/A/A.md'
        && app._log.fmWrites.length === 0 && app._log.renames.length === 0
        && fmOf(app, 'spice/tasks/A/A.md').status === 'open');

      const app2 = makeApp(seed);
      const s2 = setup(app2);
      let asked2 = 0;
      s2.TD.confirmComplete = async () => { asked2++; return true; };
      const r2 = await s2.TD.markDone('spice/tasks/A/A.md');
      const order = app2._log.fmWrites.map((w) => w.path.split('/').pop());
      ok('TF-DONE-OPEN-CHILDREN-ASK Yes completes the open subtasks, then the task, then moves the tree',
        r2 && r2.ok === true && asked2 === 1
        && fmOf(app2, 'spice/tasks/_done/2026/11/A/B/B.md').status === 'done'
        && fmOf(app2, 'spice/tasks/_done/2026/11/A/B/C/C.md').status === 'done'
        && fmOf(app2, 'spice/tasks/_done/2026/11/A/A.md').status === 'done'
        && order[order.length - 1] === 'A.md' && order.length === 3
        && app2._log.renames.length === 1);

      const app3 = makeApp(seed);
      const s3 = setup(app3);
      let asked3 = 0;
      s3.TD.confirmComplete = async () => { asked3++; return false; };
      const r3 = await s3.TD.markDone('spice/tasks/A/A.md', { completeOpenSubtasks: true });
      ok('TF-DONE-OPEN-CHILDREN-FLAG completeOpenSubtasks skips the question',
        r3 && r3.ok === true && asked3 === 0
        && fmOf(app3, 'spice/tasks/_done/2026/11/A/B/C/C.md').status === 'done');

      const app4 = makeApp(seed);
      const s4 = setup(app4);
      let asked4 = 0;
      s4.TD.confirmComplete = async () => { asked4++; return false; };
      const r4 = await s4.TD.markDone('spice/tasks/A/B/B.md');
      ok('TF-DONE-OPEN-CHILDREN-SUBTASK a subtask with an open subtask asks too',
        r4 && r4.ok === false && r4.reason === 'cancelled' && asked4 === 1
        && fmOf(app4, 'spice/tasks/A/B/B.md').status === 'open');
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B' },
        'spice/tasks/A/C/C.md': { status: 'done', title: 'C' },
      });
      const { TD } = setup(app);
      const open = TD._openDescendants(app, 'spice/tasks/A').map((f) => f.path);
      ok('TF-OPEN-DESCENDANTS lists only open task notes below the folder',
        open.length === 1 && open[0] === 'spice/tasks/A/B/B.md');
    }

    {
      const app = makeApp({
        'spice/tasks/R/R.md': { status: 'open', title: 'R', recurrence: 'every day', due: DAY, created_at: '2026-11-01' },
        'spice/tasks/R/S/S.md': { status: 'open', title: 'S' },
      });
      const RecurrenceParser = { matches: () => true };
      const { TD } = setup(app, { RecurrenceParser });
      window.moment = (...args) => (args.length ? { _d: args[0] } : momentStub());
      let asked = 0;
      TD.confirmComplete = async () => { asked++; return false; };
      const r = await TD.markDone('spice/tasks/R/R.md');
      const fm = fmOf(app, 'spice/tasks/R/R.md');
      ok('TF-DONE-RECURRING-STAYS a recurring task rolls its due date forward and does not move',
        r && r.ok === true && fm && fm.due === '2026-11-11' && fm.status === 'open'
        && app._log.renames.length === 0 && asked === 0);
    }

    {
      const app = makeApp({ 'spice/tasks/X.md': { status: 'open', title: 'X' } });
      const { TD } = setup(app);
      const r = await TD.markDone('spice/tasks/X.md');
      ok('TF-DONE-FLAT-LEGACY a flat note still moves to spice/tasks/_done/<file>',
        r && r.ok === true && fmOf(app, 'spice/tasks/_done/X.md') && fmOf(app, 'spice/tasks/_done/X.md').status === 'done'
        && app._log.renames.length === 1 && app._log.renames[0].to === 'spice/tasks/_done/X.md');
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'done', title: 'B', completed_at: ISO },
      });
      const { TD } = setup(app);
      const r = await TD.reopen('spice/tasks/A/B/B.md');
      const fm = fmOf(app, 'spice/tasks/A/B/B.md');
      ok('TF-REOPEN-SUBTASK a done subtask in place gets status only',
        r && r.ok === true && r.path === 'spice/tasks/A/B/B.md'
        && fm.status === 'open' && fm.completed_at === '' && app._log.renames.length === 0
        && app._log.mutateCalls === 1);

      const r2 = await TD.reopen('spice/tasks/A/A.md');
      ok('TF-REOPEN-OPEN-REFUSED an open task outside _done is not-done, with no write',
        r2 && r2.ok === false && r2.reason === 'not-done' && app._log.fmWrites.length === 1);
    }

    {
      const app = makeApp({
        'spice/tasks/_done/2026/11/A/A.md': { status: 'done', title: 'A', completed_at: ISO },
        'spice/tasks/_done/2026/11/A/B/B.md': { status: 'done', title: 'B', completed_at: ISO, parent_task: '[[A]]' },
        'spice/tasks/_done/2026/11/A/C/C.md': { status: 'done', title: 'C', completed_at: ISO, parent_task: '[[A]]' },
      });
      const { TD } = setup(app);
      const r = await TD.reopen('spice/tasks/_done/2026/11/A/B/B.md');
      const a = fmOf(app, 'spice/tasks/A/A.md');
      const b = fmOf(app, 'spice/tasks/A/B/B.md');
      const c = fmOf(app, 'spice/tasks/A/C/C.md');
      ok('TF-REOPEN-IN-DONE-TREE reopening a note in a _done tree reopens it and its ancestors and moves the tree back',
        r && r.ok === true && r.path === 'spice/tasks/A/B/B.md'
        && a && a.status === 'open' && a.completed_at === ''
        && b && b.status === 'open' && b.completed_at === ''
        && c && c.status === 'done'
        && app._log.renames.length === 1 && app._log.renames[0].from === 'spice/tasks/_done/2026/11/A'
        && app._log.renames[0].to === 'spice/tasks/A');
    }

    {
      const app = makeApp({
        'spice/tasks/_done/2026/11/A/A.md': { status: 'done', title: 'A', completed_at: ISO, created_at: '2026-11-03' },
        'spice/tasks/_done/2026/11/A/B/B.md': { status: 'done', title: 'B', completed_at: ISO },
        'spice/wiki/A.md': { type: 'wiki' },
      });
      const { TD } = setup(app);
      const r = await TD.reopen('spice/tasks/_done/2026/11/A/B/B.md');
      ok('TF-REOPEN-IN-DONE-TREE-RENAMED the tree comes back renamed when its name is now taken',
        r && r.ok === true && r.path === 'spice/tasks/A (Nov 3)/B/B.md'
        && fmOf(app, 'spice/tasks/A (Nov 3)/A (Nov 3).md').status === 'open'
        && fmOf(app, 'spice/tasks/A (Nov 3)/B/B.md').status === 'open'
        && !!fmOf(app, 'spice/wiki/A.md'));
    }

    {
      const app = makeApp({
        'spice/tasks/_done/2026/11/A/A.md': { status: 'done', title: 'A', completed_at: ISO },
      });
      const { TD } = setup(app);
      app._failRename = true;
      const r = await TD.reopen('spice/tasks/_done/2026/11/A/A.md');
      const fm = fmOf(app, 'spice/tasks/_done/2026/11/A/A.md');
      ok('TF-REOPEN-TREE-FAILURE-RESTORES a failed move restores status and completed_at',
        r && r.ok === false && fm.status === 'done' && fm.completed_at === ISO);
    }

    {
      const app = makeApp({ 'spice/tasks/_done/X.md': { status: 'done', title: 'X', completed_at: ISO } });
      const { TD } = setup(app);
      const r = await TD.reopen('spice/tasks/_done/X.md');
      ok('TF-REOPEN-FLAT-LEGACY a flat _done note still moves back to spice/tasks/<file>',
        r && r.ok === true && r.path === 'spice/tasks/X.md' && fmOf(app, 'spice/tasks/X.md').status === 'open');
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[A]]' },
        'spice/tasks/A/B/C/C.md': { status: 'done', title: 'C', parent_task: '[[B]]' },
      });
      const texts = [];
      const el = () => ({
        createEl: (_t, o) => { if (o && o.text) texts.push(o.text); return el(); },
        createSpan: (o) => { if (o && o.text) texts.push(o.text); return el(); },
      });
      let handleOpts = null;
      const SauceModal = {
        open: (o) => { handleOpts = o; o.body(el()); return { footer: null }; },
      };
      const { TD } = setup(app, { SauceModal });
      const pending = TD.confirmDelete('spice/tasks/A/A.md');
      await Promise.resolve();
      const copy = texts.join('');
      const delBtn = handleOpts && handleOpts.buttons.find((b) => b.label === 'Delete');
      await delBtn.onClick({ close() {} }, null);
      const res = await pending;
      ok('TF-DELETE-CONFIRM-COUNT the delete confirm names the subtasks that go with the task',
        /and 2 subtasks/.test(copy));
      ok('TF-DELETE-TREE deleting a top-level task moves its whole folder to _trash/<Name>',
        res && res.ok === true
        && fmOf(app, 'spice/tasks/_trash/A/A.md') && fmOf(app, 'spice/tasks/_trash/A/A.md').status === 'deleted'
        && fmOf(app, 'spice/tasks/_trash/A/B/B.md').status === 'open'
        && fmOf(app, 'spice/tasks/_trash/A/B/C/C.md').status === 'done'
        && app._log.renames.length === 1 && app._log.renames[0].from === 'spice/tasks/A'
        && app._log.renames[0].to === 'spice/tasks/_trash/A');
    }

    {
      const app = makeApp({ 'spice/tasks/A/A.md': { status: 'open', title: 'A' } });
      const texts = [];
      const el = () => ({
        createEl: (_t, o) => { if (o && o.text) texts.push(o.text); return el(); },
        createSpan: (o) => { if (o && o.text) texts.push(o.text); return el(); },
      });
      const SauceModal = { open: (o) => { o.body(el()); return { footer: null }; } };
      const { TD } = setup(app, { SauceModal });
      TD.confirmDelete('spice/tasks/A/A.md');
      await Promise.resolve();
      ok('TF-DELETE-CONFIRM-NO-SUBTASKS a task with no subtasks keeps the plain wording',
        !/subtask/.test(texts.join('')) && /to the trash/.test(texts.join('')));
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[A]]' },
        'spice/tasks/_trash/B/B.md': { status: 'deleted', title: 'old' },
      });
      app._files.delete('spice/tasks/_trash/B/B.md');
      const { TD } = setup(app);
      const r = await TD.markDeleted('spice/tasks/A/B/B.md');
      const fm = fmOf(app, 'spice/tasks/_trash/B 2/B 2.md');
      ok('TF-DELETE-SUBTASK-LEAVES deleting a subtask moves its folder to _trash and keeps parent_task',
        r && r.ok === true && fm && fm.status === 'deleted' && fm.parent_task === '[[A]]'
        && fmOf(app, 'spice/tasks/A/A.md').status === 'open'
        && !app._folders.has('spice/tasks/A/B'));
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[A]]' },
      });
      const { TD } = setup(app);
      const r = await TD.markDeleted('spice/tasks/A/B/B.md');
      const fm = fmOf(app, 'spice/tasks/_trash/B/B.md');
      ok('TF-DELETE-SUBTASK-PLAIN a deleted subtask lands at _trash/<Name> with parent_task kept',
        r && r.ok === true && fm && fm.status === 'deleted' && fm.parent_task === '[[A]]');
    }

    {
      const app = makeApp({ 'spice/tasks/Y.md': { status: 'open', title: 'Y' } });
      const { TD } = setup(app);
      const r = await TD.markDeleted('spice/tasks/Y.md');
      ok('TF-DELETE-FLAT-LEGACY a flat note still moves to spice/tasks/_trash/<file>',
        r && r.ok === true && fmOf(app, 'spice/tasks/_trash/Y.md').status === 'deleted');
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B' },
        'spice/tasks/A/B/C/C.md': { status: 'open', title: 'C' },
        'spice/tasks/A/D/D.md': { status: 'done', title: 'D' },
      });
      const texts = [];
      const el = () => ({
        createEl: (_t, o) => { if (o && o.text) texts.push(o.text); return el(); },
        createSpan: (o) => { if (o && o.text) texts.push(o.text); return el(); },
      });
      let modal = null;
      const SauceModal = { open: (o) => { modal = o; o.body(el()); return { footer: null }; } };
      const { TD } = setup(app, { SauceModal });
      const yes = TD.confirmComplete('spice/tasks/A/A.md');
      await Promise.resolve();
      ok('TF-CONFIRM-COMPLETE-TEXT the question counts the open subtasks',
        texts.join('') === 'Also complete its 2 open subtasks?');
      modal.buttons.find((b) => b.label === 'Complete all').onClick({ close() { modal.onClose(); } });
      const no = TD.confirmComplete('spice/tasks/A/A.md');
      await Promise.resolve();
      modal.onClose();
      ok('TF-CONFIRM-COMPLETE-ANSWERS Complete all resolves true; dismissing resolves false',
        (await yes) === true && (await no) === false && app._log.fmWrites.length === 0);
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'B' },
      });
      const { TD } = setup(app);
      app._failRename = true;
      TD.confirmComplete = async () => true;
      const r = await TD.markDone('spice/tasks/A/A.md');
      ok('TF-DONE-MOVE-FAILURE-RESTORES a failed folder move puts every status back',
        r && r.ok === false && fmOf(app, 'spice/tasks/A/A.md').status === 'open'
        && fmOf(app, 'spice/tasks/A/B/B.md').status === 'open'
        && fmOf(app, 'spice/tasks/A/A.md').completed_at === undefined);
    }

    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/Z.md': { status: 'open', title: 'Z' },
      });
      const { TD, customJS } = setup(app);
      delete customJS.TaskEntity;
      const r1 = await TD.markDone('spice/tasks/A/A.md');
      const r2 = await TD.markDeleted('spice/tasks/A/A.md');
      const r3 = await TD.markDone('spice/tasks/Z.md');
      ok('TF-COLD-FOLDER-NOTE-REFUSED with TaskEntity cold, a folder note is refused, never moved by the flat rule',
        r1 && r1.ok === false && r1.reason === 'task-entity-unavailable'
        && r2 && r2.ok === false && r2.reason === 'task-entity-unavailable'
        && fmOf(app, 'spice/tasks/A/A.md').status === 'open'
        && r3 && r3.ok === true && !!fmOf(app, 'spice/tasks/_done/Z.md'));
    }

    {
      const app = makeApp({ 'spice/tasks/A/A.md': { status: 'open' } });
      const { TD } = setup(app);
      const inst = ['_openDescendants', 'confirmComplete'].every((m) => typeof TD[m] === 'function');
      const stat = typeof TDClass(window, function () {}, undefined, {})._openDescendants === 'function';
      ok('TF-LIFECYCLE-DELEGATORS _openDescendants is static with an instance delegator', inst && stat);
    }
  } catch (e) {
    console.log('  FAIL — harness threw: ' + (e && (e.stack || e.message || e)));
    results.push(['harness', false]);
  } finally {
    global.window = savedWin;
    global.app = savedApp;
    global.Notice = savedNotice;
  }
  const failed = results.filter(([, p]) => !p);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
