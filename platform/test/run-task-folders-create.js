#!/usr/bin/env node
/**
 * run-task-folders-create.js — new tasks and subtasks are created as nested
 * folders (spice/tasks/<Name>/<Name>.md, or inside the parent's folder) with a
 * vault-unique name, through the same prepareQuick/createQuick path the card's
 * "+ Add subtask" and the quick-add use. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const TEClass = new Function(fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-entity.js'), 'utf8') + '\nreturn TaskEntity;')();
const TDSrc = fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-dialog.js'), 'utf8');
const TDClass = new Function('window', 'Notice', 'document', 'globalThis', TDSrc + '\nreturn TaskDialog;');

const momentOf = (day) => () => ({
  format: (f) => (f === 'YYYY-MM-DDTHH:mm:ssZ' ? day + 'T09:00:00-07:00' : day),
});

function makeApp(files, parentLinks, titles) {
  const vault = new Map();
  const folders = new Set(['spice', 'spice/tasks', 'spice/wiki']);
  const creates = [];
  const folderCalls = [];
  const addFile = (p) => {
    const base = p.split('/').pop().replace(/\.md$/i, '');
    vault.set(p, { path: p, basename: base, extension: 'md' });
    for (let d = p.slice(0, p.lastIndexOf('/')); d; d = d.indexOf('/') < 0 ? '' : d.slice(0, d.lastIndexOf('/'))) folders.add(d);
  };
  (files || []).forEach(addFile);
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  return {
    _creates: creates,
    _folderCalls: folderCalls,
    _vault: vault,
    vault: {
      getMarkdownFiles: () => Array.from(vault.values()),
      getAbstractFileByPath: (p) => vault.get(p) || (folders.has(p) ? { path: p } : null),
      createFolder: async (p) => {
        if (folders.has(p)) throw new Error('Folder already exists');
        if (!folders.has(dirOf(p))) throw new Error('Parent folder missing: ' + p);
        folders.add(p);
        folderCalls.push(p);
      },
      create: async (p, content) => {
        if (!folders.has(dirOf(p))) throw new Error('Folder missing for ' + p);
        creates.push({ path: p, content });
        addFile(p);
        return { path: p };
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (name) => {
        const hit = (parentLinks || {})[name];
        return hit ? vault.get(hit) || null : null;
      },
      getFileCache: (f) => (titles && titles[f.path] ? { frontmatter: { title: titles[f.path] } } : null),
    },
  };
}

function setup(app, day) {
  const TE = new TEClass();
  const win = { app, customJS: { TaskEntity: TE }, moment: momentOf(day || '2026-11-10') };
  global.window = win;
  global.app = app;
  global.Notice = function () {};
  const TD = new (TDClass(win, global.Notice, undefined, { app }))();
  TD._reconcileAfterCreate = () => {};
  return { TD, TE };
}

(async () => {
  const savedWin = global.window;
  const savedApp = global.app;
  const savedNotice = global.Notice;
  try {
    {
      const app = makeApp([]);
      const { TD } = setup(app);
      const r = await TD.createQuick({ title: 'Pay Bills', today: '2026-11-10', source: 'daily', reconcile: false });
      ok('TF-CREATE-TOP a new task is created as spice/tasks/<Name>/<Name>.md',
        app._creates.length === 1 && app._creates[0].path === 'spice/tasks/Pay Bills/Pay Bills.md'
        && r && r.ok && r.path === 'spice/tasks/Pay Bills/Pay Bills.md');
      ok('TF-CREATE-TOP-FOLDER the task folder is created before its note',
        app._folderCalls.join('|') === 'spice/tasks/Pay Bills');
    }

    {
      const app = makeApp(['spice/tasks/Help Henry/Help Henry.md'], { 'Help Henry': 'spice/tasks/Help Henry/Help Henry.md' });
      const { TD } = setup(app);
      await TD.createQuick({ title: 'Review PR', today: '2026-11-10', source: 'daily', parent_task: '[[Help Henry]]', reconcile: false });
      ok('TF-CREATE-SUB a subtask is created inside its parent folder and keeps parent_task',
        app._creates.length === 1 && app._creates[0].path === 'spice/tasks/Help Henry/Review PR/Review PR.md'
        && /\nparent_task: "\[\[Help Henry\]\]"\n/.test(app._creates[0].content));
      ok('TF-CREATE-SUB-FOLDER only the missing folder level is created',
        app._folderCalls.join('|') === 'spice/tasks/Help Henry/Review PR');
    }

    {
      const app = makeApp(['spice/tasks/A/A.md', 'spice/tasks/A/B/B.md'], { B: 'spice/tasks/A/B/B.md' });
      const { TD } = setup(app);
      await TD.createQuick({ title: 'C', today: '2026-11-10', parent_task: '[[B]]', reconcile: false });
      ok('TF-CREATE-SUB-DEEP a subtask of a subtask nests inside the subtask folder',
        app._creates[0].path === 'spice/tasks/A/B/C/C.md');
    }

    {
      const app = makeApp([]);
      const { TD } = setup(app);
      await TD._commitCreate(app, { path: 'spice/tasks/P/Q/R/R.md', content: 'x' });
      ok('TF-CREATE-ENSURE-ORDER every missing folder level is created, outermost first',
        app._folderCalls.join('|') === 'spice/tasks/P|spice/tasks/P/Q|spice/tasks/P/Q/R');
    }

    {
      const app = makeApp(['spice/wiki/Pay Bills.md']);
      const { TD } = setup(app, '2026-11-10');
      await TD.createQuick({ title: 'Pay Bills', today: '2026-11-10', reconcile: false });
      ok('TF-CREATE-CLASH-VAULTWIDE a basename taken anywhere in the vault adds the creation date',
        app._creates[0].path === 'spice/tasks/Pay Bills - 11-10-26/Pay Bills - 11-10-26.md');
    }

    {
      const app = makeApp(['spice/tasks/Help Henry/Help Henry.md', 'spice/wiki/Review PR.md'],
        { 'Help Henry': 'spice/tasks/Help Henry/Help Henry.md' }, { 'spice/tasks/Help Henry/Help Henry.md': 'Help Henry out' });
      const { TD } = setup(app);
      await TD.createQuick({ title: 'Review PR', parent_task: '[[Help Henry]]', reconcile: false });
      ok('TF-CREATE-CLASH-SUB-PARENT-TITLE a clashing subtask adds its parent title frontmatter',
        app._creates[0].path === 'spice/tasks/Help Henry/Review PR (Help Henry out)/Review PR (Help Henry out).md');
    }

    {
      const app = makeApp(['spice/tasks/Help Henry.md'], { 'Help Henry': 'spice/tasks/Help Henry.md' });
      const { TD, TE } = setup(app);
      await TD.createQuick({ title: 'Review PR', parent_task: '[[Help Henry]]', reconcile: false });
      const c = app._creates[0];
      ok('TF-CREATE-UNDER-FLAT-PARENT a subtask of a still-flat parent goes to the task root and keeps parent_task',
        c.path === 'spice/tasks/Review PR/Review PR.md' && /\nparent_task: "\[\[Help Henry\]\]"\n/.test(c.content));
      const parsed = TE.parseNote({ file: { path: c.path }, parent_task: '[[Help Henry]]' });
      ok('TF-CREATE-UNDER-FLAT-PARENT-READ the read side still nests it under the flat parent',
        parsed.parent_task === 'Help Henry');
    }

    {
      const app = makeApp(['spice/tasks/_done/2026/11/Old/Old.md'], { Old: 'spice/tasks/_done/2026/11/Old/Old.md' });
      const { TD } = setup(app);
      await TD.createQuick({ title: 'Follow up', parent_task: '[[Old]]', reconcile: false });
      ok('TF-CREATE-UNDER-DONE-PARENT a new subtask of a finished task is not buried in the done tree',
        app._creates[0].path === 'spice/tasks/Follow up/Follow up.md');
    }

    {
      const app = makeApp([]);
      const { TD } = setup(app);
      const first = TD.prepareQuick({ title: 'Call Bob' });
      const second = TD.prepareQuick({ title: 'Call Bob' });
      ok('TF-CREATE-RESERVED two back-to-back quick creates with the same title get distinct names',
        first.path === 'spice/tasks/Call Bob/Call Bob.md'
        && second.path === 'spice/tasks/Call Bob - 11-10-26/Call Bob - 11-10-26.md');
      await Promise.all([TD.createQuick({ plan: first, reconcile: false }), TD.createQuick({ plan: second, reconcile: false })]);
      ok('TF-CREATE-RESERVED-RELEASED both persist and the reservations are released',
        app._creates.length === 2 && TD._quickCreateReservations.size === 0);
      const third = TD.prepareQuick({ title: 'Call Bob' });
      ok('TF-CREATE-RESERVED-NEXT a later create sees the persisted notes and numbers on',
        third.path === 'spice/tasks/Call Bob - 11-10-26 2/Call Bob - 11-10-26 2.md');
      TD.releaseQuickPlan(third);
    }

    {
      const app = makeApp([]);
      const { TD } = setup(app);
      const names = TD._takenNames(app, new Set(['reserved']));
      app._vault.set('spice/wiki/Zed.md', { path: 'spice/wiki/Zed.md', basename: 'Zed', extension: 'md' });
      const names2 = TD._takenNames(app, new Set(['reserved']));
      ok('TF-CREATE-TAKEN _takenNames is case-insensitive over the vault basenames plus the reserved set',
        names('reserved') === true && names('zed') === false && names2('zed') === true && names2('nope') === false);
      const dest = TD._parentFolderFor(makeApp(['spice/tasks/P/P.md'], { P: 'spice/tasks/P/P.md' }), '[[P]]');
      ok('TF-CREATE-PARENT-FOLDER _parentFolderFor gives the folder and title of a folder-note parent',
        dest && dest.folder === 'spice/tasks/P' && dest.title === 'P');
      ok('TF-CREATE-PARENT-NONE _parentFolderFor is null for no parent, an unknown parent and a flat parent',
        TD._parentFolderFor(app, '') === null && TD._parentFolderFor(app, '[[Nope]]') === null
        && TD._parentFolderFor(makeApp(['spice/tasks/F.md'], { F: 'spice/tasks/F.md' }), '[[F]]') === null);
    }

    {
      const app = makeApp([]);
      const { TE } = setup(app);
      const composed = TE.composeNote({ title: 'X', moment: momentOf('2026-11-10')() });
      ok('TF-CREATE-COMPOSE composeNote still returns frontmatter and body',
        !!composed.frontmatter && typeof composed.body === 'string');
      ok('TF-CREATE-DELEGATORS the new statics have instance delegators',
        /^\s+_takenNames\(/m.test(TDSrc) && /^\s+_parentFolderFor\(/m.test(TDSrc));
    }
  } catch (e) {
    ok('TF-CREATE-NO-THROW the harness ran without an exception: ' + ((e && e.stack) || e), false);
  } finally {
    global.window = savedWin;
    global.app = savedApp;
    global.Notice = savedNotice;
  }

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
