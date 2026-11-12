#!/usr/bin/env node
/**
 * run-task-folders-edit.js — editing a task on the folder layout. Changing
 * "Subtask of…" moves the task's folder under the new parent's folder (or to
 * spice/tasks/ when cleared); retitling renames folder and note together with
 * a vault-unique name; the parent picker lists nested open tasks but never the
 * task itself, anything inside its folder, or done and trashed tasks. Flat
 * legacy notes keep the frontmatter-only edit. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const TEClass = new Function(fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-entity.js'), 'utf8') + '\nreturn TaskEntity;')();
const TDSrc = fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-dialog.js'), 'utf8');
const TDClass = new Function('window', 'Notice', 'document', 'globalThis', TDSrc + '\nreturn TaskDialog;');

function makeApp(seed) {
  const files = new Map();
  const folders = new Map();
  const log = { renames: [], fmWrites: [], notices: [] };
  const dirOf = (p) => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));
  const baseOf = (p) => p.split('/').pop().replace(/\.md$/i, '');
  const addFolder = (d) => {
    for (let x = d; x; x = dirOf(x)) if (!folders.has(x)) folders.set(x, { path: x, children: [] });
  };
  addFolder('spice/tasks');
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
      },
      process: async (f, fn) => { f._body = fn(f._body || ''); },
    },
    metadataCache: {
      getFileCache: (f) => (f && f._fm ? { frontmatter: f._fm } : null),
      getFirstLinkpathDest: (name) => {
        const want = String(name).toLowerCase();
        return Array.from(files.values()).find((f) => f.basename.toLowerCase() === want) || null;
      },
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

function setup(app) {
  const TE = new TEClass();
  const win = { app, customJS: { TaskEntity: TE }, moment: null };
  global.window = win;
  global.app = null;
  global.Notice = function (m) { app._log.notices.push(String(m)); };
  const doc = { body: {} };
  const TD = new (TDClass(win, global.Notice, doc, { app, customJS: win.customJS }))();
  return { TD, TE };
}

const fmOf = (app, p) => (app._files.get(p) || {})._fm || null;
const base = (extra) => Object.assign({
  'spice/tasks/A/A.md': { status: 'open', title: 'A', created_at: '2026-11-01T08:00:00-07:00' },
  'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[A]]', created_at: '2026-11-02T08:00:00-07:00' },
  'spice/tasks/C/C.md': { status: 'open', title: 'C', created_at: '2026-11-03T08:00:00-07:00' },
}, extra || {});

(async () => {
  const savedWin = global.window;
  const savedApp = global.app;
  const savedNotice = global.Notice;
  try {
    {
      const app = makeApp(base());
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      const r = await TD._saveEdit(app, file, { title: 'B', parent_task: '[[C]]' }, null);
      const fm = fmOf(app, 'spice/tasks/C/B/B.md');
      ok('TF-EDIT-REPARENT setting parent [[C]] moves spice/tasks/A/B/B.md to spice/tasks/C/B/B.md',
        r && r.ok === true && r.path === 'spice/tasks/C/B/B.md' && fm && fm.parent_task === '[[C]]'
        && !app._files.has('spice/tasks/A/B/B.md') && !app._folders.has('spice/tasks/A/B')
        && app._log.renames.length === 1 && app._log.renames[0].from === 'spice/tasks/A/B'
        && app._log.renames[0].to === 'spice/tasks/C/B');
    }

    {
      const app = makeApp(base({
        'spice/tasks/A/B/D/D.md': { status: 'open', title: 'D', parent_task: '[[B]]' },
      }));
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      await TD._saveEdit(app, file, { title: 'B', parent_task: '' }, null);
      const fm = fmOf(app, 'spice/tasks/B/B.md');
      ok('TF-EDIT-UNPARENT clearing the parent moves the task, and its subtasks with it, to spice/tasks/B/B.md',
        fm && fm.parent_task === '' && !!fmOf(app, 'spice/tasks/B/D/D.md') && !app._folders.has('spice/tasks/A/B'));
    }

    {
      const app = makeApp(base());
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      const r = await TD._saveEdit(app, file, { title: 'Bee', parent_task: '[[A]]' }, null);
      const fm = fmOf(app, 'spice/tasks/A/Bee/Bee.md');
      ok('TF-EDIT-RENAME retitling B to Bee gives spice/tasks/A/Bee/Bee.md with title Bee',
        r && r.ok === true && r.path === 'spice/tasks/A/Bee/Bee.md' && fm && fm.title === 'Bee'
        && !app._folders.has('spice/tasks/A/B') && !app._files.has('spice/tasks/A/B/B.md'));
      ok('TF-EDIT-RENAME-NOTE-FIRST the note is renamed inside its folder, then the folder moves',
        app._log.renames.length === 2 && app._log.renames[0].from === 'spice/tasks/A/B/B.md'
        && app._log.renames[0].to === 'spice/tasks/A/B/Bee.md'
        && app._log.renames[1].from === 'spice/tasks/A/B' && app._log.renames[1].to === 'spice/tasks/A/Bee');
    }

    {
      const app = makeApp(base({ 'spice/tasks/Bee/Bee.md': { status: 'open', title: 'Bee' } }));
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      const r = await TD._saveEdit(app, file, { title: 'Bee', parent_task: '[[A]]' }, null);
      const fm = fmOf(app, 'spice/tasks/A/Bee (A)/Bee (A).md');
      ok('TF-EDIT-RENAME-CLASH retitling to a title taken elsewhere gives Bee (A)',
        r && r.ok === true && fm && fm.title === 'Bee' && !!fmOf(app, 'spice/tasks/Bee/Bee.md'));
    }

    {
      const app = makeApp(base());
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      const r = await TD._saveEdit(app, file, { title: 'B', parent_task: '[[A]]', due: '2026-12-01' }, 'hello');
      ok('TF-EDIT-NO-RENAME saving with an unchanged title leaves the path',
        r && r.ok === true && r.path === 'spice/tasks/A/B/B.md' && app._log.renames.length === 0
        && fmOf(app, 'spice/tasks/A/B/B.md').due === '2026-12-01');
    }

    {
      const app = makeApp(base({
        'spice/tasks/Bee/Bee.md': { status: 'open', title: 'Bee' },
        'spice/tasks/A/Bee (A)/Bee (A).md': { status: 'open', title: 'Bee', parent_task: '[[A]]', created_at: '2026-11-02T08:00:00-07:00' },
      }));
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/Bee (A)/Bee (A).md');
      const r = await TD._saveEdit(app, file, { title: 'Bee', parent_task: '[[A]]', priority: 'high' }, null);
      ok('TF-EDIT-NAME-FIXED a clash-suffixed name is not re-derived when the title did not change',
        r && r.ok === true && r.path === 'spice/tasks/A/Bee (A)/Bee (A).md' && app._log.renames.length === 0);
    }

    {
      const app = makeApp(base({
        'spice/tasks/A/B/D/D.md': { status: 'open', title: 'D', parent_task: '[[B]]' },
      }));
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      const before = JSON.stringify(Array.from(app._files.keys()).sort());
      const r1 = await TD._saveEdit(app, file, { title: 'B2', parent_task: '[[D]]' }, null);
      const r2 = await TD._saveEdit(app, file, { title: 'B2', parent_task: '[[B]]' }, null);
      ok('TF-EDIT-NO-CYCLE moving a task under its own subtask or itself is refused and changes nothing',
        r1 && r1.ok === false && r2 && r2.ok === false
        && JSON.stringify(Array.from(app._files.keys()).sort()) === before
        && app._log.renames.length === 0 && app._log.fmWrites.length === 0
        && fmOf(app, 'spice/tasks/A/B/B.md').parent_task === '[[A]]'
        && fmOf(app, 'spice/tasks/A/B/B.md').title === 'B'
        && app._log.notices.length >= 2);
    }

    {
      const app = makeApp(base({ 'spice/tasks/X.md': { status: 'open', title: 'X' } }));
      const { TD, TE } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      const r = await TD._saveEdit(app, file, { title: 'B', parent_task: '[[X]]' }, null);
      const fm = fmOf(app, 'spice/tasks/B/B.md');
      const parsed = TE.parseNote(Object.assign({ file: { path: 'spice/tasks/B/B.md' } }, fm));
      ok('TF-EDIT-FLAT-PARENT-TOP-LEVEL re-parenting a nested task to flat [[X]] moves it to spice/tasks/B/B.md and parseNote reads X',
        r && r.ok === true && r.path === 'spice/tasks/B/B.md' && fm && fm.parent_task === '[[X]]'
        && parsed.parent_task === 'X' && !app._folders.has('spice/tasks/A/B'));
    }

    {
      const app = makeApp(base());
      const { TD } = setup(app);
      const r = await TD._saveEdit(app, app._files.get('spice/tasks/A/B/B.md'), { title: 'B', parent_task: '[[Nowhere]]' }, null);
      ok('TF-EDIT-UNRESOLVED-PARENT-TOP-LEVEL an unresolved new parent also moves a nested task to the top level',
        r && r.ok === true && r.path === 'spice/tasks/B/B.md' && fmOf(app, 'spice/tasks/B/B.md').parent_task === '[[Nowhere]]');
    }

    {
      const app = makeApp(base({
        'spice/tasks/X.md': { status: 'open', title: 'X' },
        'spice/tasks/B/B.md': { status: 'open', title: 'B', parent_task: '[[C]]' },
      }));
      delete app._files.get('spice/tasks/B/B.md')._fm.parent_task;
      app._files.delete('spice/tasks/A/B/B.md');
      app._folders.delete('spice/tasks/A/B');
      const { TD } = setup(app);
      const r = await TD._saveEdit(app, app._files.get('spice/tasks/B/B.md'), { title: 'B', parent_task: '[[X]]' }, null);
      ok('TF-EDIT-TOP-LEVEL-STAYS a task already at the top level just gets parent_task written',
        r && r.ok === true && r.path === 'spice/tasks/B/B.md' && app._log.renames.length === 0
        && fmOf(app, 'spice/tasks/B/B.md').parent_task === '[[X]]');
    }

    {
      const app = makeApp(base({
        'spice/tasks/_done/2026/11/Z/Z.md': { status: 'done', title: 'Z', parent_task: '' },
      }));
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/_done/2026/11/Z/Z.md');
      const r = await TD._saveEdit(app, file, { title: 'Zed', parent_task: '[[C]]' }, null);
      ok('TF-EDIT-DONE-RENAMES-IN-PLACE a done task keeps its _done folder; only the name changes',
        r && r.ok === true && r.path === 'spice/tasks/_done/2026/11/Zed/Zed.md'
        && fmOf(app, 'spice/tasks/_done/2026/11/Zed/Zed.md').parent_task === '[[C]]');
    }

    {
      const app = makeApp(base());
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/A/B/B.md');
      const r = await TD._saveEdit(app, file, { title: 'Bee', parent_task: '[[C]]' }, null);
      ok('TF-EDIT-MOVE-AND-RENAME a parent change plus a retitle lands at the new parent under the new name',
        r && r.ok === true && r.path === 'spice/tasks/C/Bee/Bee.md' && !app._folders.has('spice/tasks/A/B')
        && fmOf(app, 'spice/tasks/C/Bee/Bee.md').title === 'Bee');
    }

    {
      const app = makeApp(base());
      const { TD } = setup(app);
      app._failRename = true;
      const file = app._files.get('spice/tasks/A/B/B.md');
      const r = await TD._saveEdit(app, file, { title: 'Bee', parent_task: '[[C]]' }, null);
      const fm = fmOf(app, 'spice/tasks/A/B/B.md');
      ok('TF-EDIT-MOVE-FAILS a failed rename reports ok false and puts title and parent_task back',
        r && r.ok === false && fm && fm.title === 'B' && fm.parent_task === '[[A]]');
    }

    {
      const app = makeApp({
        'spice/tasks/Flat.md': { status: 'open', title: 'Flat', parent_task: '[[A]]' },
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
      });
      const { TD } = setup(app);
      const file = app._files.get('spice/tasks/Flat.md');
      const r = await TD._saveEdit(app, file, { title: 'Flatter', parent_task: '' }, null);
      ok('TF-EDIT-FLAT-UNCHANGED a flat note gets the frontmatter edit only: no move, no rename',
        r && r.ok === true && app._log.renames.length === 0
        && fmOf(app, 'spice/tasks/Flat.md').title === 'Flatter' && fmOf(app, 'spice/tasks/Flat.md').parent_task === '');
    }

    {
      const app = makeApp(base({
        'spice/tasks/A/B/D/D.md': { status: 'open', title: 'D', parent_task: '[[B]]' },
        'spice/tasks/E.md': { status: 'open', title: 'E' },
        'spice/tasks/_done/2026/11/F/F.md': { status: 'done', title: 'F' },
        'spice/tasks/_trash/G/G.md': { status: 'deleted', title: 'G' },
        'spice/tasks/H/H.md': { status: 'done', title: 'H' },
        'spice/tasks/Flat child.md': { status: 'open', title: 'Flat child', parent_task: '[[B]]' },
      }));
      const { TD } = setup(app);
      const all = TD._parentCandidates(app, null).slice().sort();
      ok('TF-PARENT-CANDIDATES-ALL nested open tasks at any depth are listed; done and trashed are not',
        JSON.stringify(all) === JSON.stringify(['A', 'B', 'C', 'D', 'E', 'Flat child']));
      const forB = TD._parentCandidates(app, 'spice/tasks/A/B/B.md').slice().sort();
      ok('TF-PARENT-CANDIDATES the edited task, its own subtasks (folder or flat) and done and trashed tasks are not',
        JSON.stringify(forB) === JSON.stringify(['A', 'C', 'E']));
      const forA = TD._parentCandidates(app, 'spice/tasks/A/A.md').slice().sort();
      ok('TF-PARENT-CANDIDATES-ROOT editing a root task leaves out its whole tree',
        JSON.stringify(forA) === JSON.stringify(['C', 'E']));
    }

    {
      const app = makeApp(base({
        'spice/tasks/A/A.md': { status: 'open', title: 'A', due: '2026-11-12', created_at: '2026-11-01T08:00:00-07:00' },
        'spice/tasks/A/B/D/D.md': { status: 'open', title: 'D', parent_task: '[[B]]' },
      }));
      const { TD } = setup(app);
      const r = await TD._saveEdit(app, app._files.get('spice/tasks/A/B/B.md'), { title: 'B', parent_task: '', due: '' }, null);
      const fm = fmOf(app, 'spice/tasks/B/B.md');
      ok('TF-EDIT-DETACH-DUE an undated subtask detached from a dated parent takes the parent\'s due and keeps its subtasks',
        r && r.ok === true && r.due === '2026-11-12' && fm && fm.due === '2026-11-12' && fm.parent_task === ''
        && !!fmOf(app, 'spice/tasks/B/D/D.md') && app._log.notices.some((n) => /top-level task now, due 2026-11-12/.test(n)));
    }

    {
      const app = makeApp(base({
        'spice/tasks/A/A.md': { status: 'open', title: 'A', due: '2026-11-20', created_at: '2026-11-01T08:00:00-07:00' },
        'spice/tasks/A/B/D/D.md': { status: 'open', title: 'D', parent_task: '[[B]]' },
      }));
      const { TD } = setup(app);
      await TD._saveEdit(app, app._files.get('spice/tasks/A/B/D/D.md'), { title: 'D', parent_task: '', due: '' }, null);
      ok('TF-EDIT-DETACH-DUE-ANCESTOR with an undated parent the nearest dated ancestor gives the due',
        (fmOf(app, 'spice/tasks/D/D.md') || {}).due === '2026-11-20');
    }

    {
      const app = makeApp(base({
        'spice/tasks/A/A.md': { status: 'open', title: 'A', due: '2026-11-12', created_at: '2026-11-01T08:00:00-07:00' },
      }));
      const { TD } = setup(app);
      await TD._saveEdit(app, app._files.get('spice/tasks/A/B/B.md'), { title: 'B', parent_task: '', due: '2026-12-01' }, null);
      const own = (fmOf(app, 'spice/tasks/B/B.md') || {}).due;
      const app2 = makeApp(base({
        'spice/tasks/A/A.md': { status: 'open', title: 'A', due: '2026-11-12', created_at: '2026-11-01T08:00:00-07:00' },
      }));
      const s2 = setup(app2);
      await s2.TD._saveEdit(app2, app2._files.get('spice/tasks/A/B/B.md'), { title: 'B', parent_task: '[[C]]', due: '' }, null);
      const moved = (fmOf(app2, 'spice/tasks/C/B/B.md') || {}).due;
      const app3 = makeApp(base());
      const s3 = setup(app3);
      await s3.TD._saveEdit(app3, app3._files.get('spice/tasks/A/B/B.md'), { title: 'B', parent_task: '', due: '' }, null);
      const undated = (fmOf(app3, 'spice/tasks/B/B.md') || {}).due;
      ok('TF-EDIT-DETACH-DUE-ONLY-WHEN-NEEDED its own due wins, a re-parent inherits nothing, an undated chain leaves it undated',
        own === '2026-12-01' && moved === '' && undated === '');
    }

    {
      const app = makeApp({
        'spice/tasks/Errands/Errands.md': { status: 'open', title: 'Errands', created_at: '2026-11-01T08:00:00-07:00' },
        'spice/tasks/Errands/Milk (Errands)/Milk (Errands).md': { status: 'open', title: 'Milk', parent_task: '[[Errands]]' },
        'spice/tasks/Errands/Eggs (Errands) 2/Eggs (Errands) 2.md': { status: 'open', title: 'Eggs', parent_task: '[[Errands]]' },
        'spice/tasks/Errands/Bread/Bread.md': { status: 'open', title: 'Bread', parent_task: '[[Errands]]' },
        'spice/tasks/Errands/Milk (Errands)/Oat (Milk (Errands))/Oat (Milk (Errands)).md': { status: 'open', title: 'Oat', parent_task: '[[Milk (Errands)]]' },
        'spice/tasks/Milk/Milk.md': { status: 'open', title: 'Milk' },
        'spice/tasks/Eggs/Eggs.md': { status: 'open', title: 'Eggs' },
      });
      const { TD } = setup(app);
      const r = await TD._saveEdit(app, app._files.get('spice/tasks/Errands/Errands.md'), { title: 'Groceries', parent_task: '' }, null);
      const has = (p) => app._files.has(p);
      ok('TF-EDIT-STALE-NAMES renaming a task renames subtasks still named after its old title, and only those',
        r && r.ok === true && r.path === 'spice/tasks/Groceries/Groceries.md' && r.renamedSubtasks === 2
        && has('spice/tasks/Groceries/Milk (Groceries)/Milk (Groceries).md')
        && has('spice/tasks/Groceries/Eggs (Groceries)/Eggs (Groceries).md')
        && has('spice/tasks/Groceries/Bread/Bread.md')
        && has('spice/tasks/Groceries/Milk (Groceries)/Oat (Milk (Errands))/Oat (Milk (Errands)).md')
        && app._log.notices.some((n) => /2 subtasks renamed to match/.test(n)), JSON.stringify(Array.from(app._files.keys())));
    }

    {
      const app = makeApp(base());
      const { TD } = setup(app);
      const r = await TD._saveEdit(app, app._files.get('spice/tasks/A/A.md'), { title: 'A', parent_task: '', priority: 'high' }, null);
      ok('TF-EDIT-STALE-NAMES-NONE an edit that keeps the title renames no subtask', r && r.ok === true && !r.renamedSubtasks
        && app._files.has('spice/tasks/A/B/B.md') && app._log.notices.includes('Task saved'));
    }

    {
      const app = makeApp(base());
      const inst = typeof setup(app).TD._planEditMove === 'function';
      const stat = typeof TDClass(window, function () {}, undefined, {})._planEditMove === 'function';
      ok('TF-EDIT-DELEGATORS _planEditMove is static with an instance delegator', inst && stat);
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
