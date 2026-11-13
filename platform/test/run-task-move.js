#!/usr/bin/env node
/**
 * run-task-move.js — drag and drop and the ⋯ menu moves (spec
 * Docs/superpowers/specs/2026-11-13-task-flow-design.md §6):
 *   - TaskDialog.reparent, the one re-parent the edit dialog and the
 *     gestures share (loops refused, folder moved, parent_task and rank);
 *   - TaskDocs.moveTo (a note to another task's notes/);
 *   - TaskTodayList's drag controller (zones, refusals, the Make top-level
 *     strip, group headers, note drags) and the row ⋯ menu entries;
 *   - TaskMove (gesture writes through RenderSafe.mutate, pickers);
 *   - TaskNoteView rank order and the card's index move.
 * Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const results = [];
const ok = (n, c, detail) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${c || !detail ? '' : ' :: ' + detail}`); };

const TEClass = new Function(read('platform/mechanisms/task-entity/task-entity.js') + '\nreturn TaskEntity;')();
const TDClass = new Function('window', 'Notice', 'document', 'globalThis', read('platform/mechanisms/task-entity/task-dialog.js') + '\nreturn TaskDialog;');
const DocsClass = new Function(read('platform/mechanisms/task-entity/task-docs.js') + '\nreturn TaskDocs;')();
const TTLClass = new Function(read('platform/mechanisms/task-entity/task-today-list.js') + '\nreturn TaskTodayList;')();
const TMClass = new Function(read('platform/mechanisms/task-entity/task-move.js') + '\nreturn TaskMove;')();
const TNVClass = new Function(read('platform/mechanisms/task-entity/task-note-view.js') + '\nreturn TaskNoteView;')();

// ---------- a fake vault (folders, files, frontmatter, renames) ----------

function makeApp(seed, extra) {
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
    files.set(p, { path: p, basename: baseOf(p), extension: 'md', stat: { mtime: 1 }, _fm: Object.assign({ type: 'task' }, fm) });
    addFolder(dirOf(p));
  }
  for (const d of (extra && extra.folders) || []) addFolder(d);
  const childrenOf = (dir) => Array.from(files.values()).filter((f) => dirOf(f.path) === dir)
    .concat(Array.from(folders.values()).filter((f) => dirOf(f.path) === dir));
  const app = {
    _files: files,
    _folders: folders,
    _log: log,
    isMobile: false,
    vault: {
      getMarkdownFiles: () => Array.from(files.values()),
      getAbstractFileByPath: (p) => {
        if (files.has(p)) return files.get(p);
        if (folders.has(p)) { const f = folders.get(p); f.children = childrenOf(p); return f; }
        return null;
      },
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

function makeRenderSafe(log) {
  return {
    captureScroll() {},
    async mutate(opts) {
      log.push({ path: opts.path, failureMessage: opts.failureMessage });
      try {
        if (typeof opts.optimistic === 'function') await opts.optimistic();
        const value = await opts.write();
        return { ok: true, value };
      } catch (error) {
        if (typeof opts.revert === 'function') await opts.revert(error);
        return { ok: false, error };
      }
    },
  };
}

function setup(app, opts) {
  const o = opts || {};
  const TE = new TEClass();
  const mutations = [];
  const cjs = { TaskEntity: TE, RenderSafe: makeRenderSafe(mutations), TaskDocs: new DocsClass(), TaskTodayList: new TTLClass() };
  const win = { app, customJS: cjs, moment: null };
  global.window = win;
  global.app = null;
  global.Notice = function (m) { app._log.notices.push(String(m)); };
  const TDStatic = TDClass(win, global.Notice, { body: {} }, { app, customJS: cjs });
  const TD = new TDStatic();
  cjs.TaskDialog = TD;
  if (!o.noMove) cjs.TaskMove = new TMClass();
  return { TD, TDStatic, TE, cjs, mutations };
}

const fmOf = (app, p) => (app._files.get(p) || {})._fm || null;
const base = (extra) => Object.assign({
  'spice/tasks/A/A.md': { status: 'open', title: 'A', due: '2026-11-20', created_at: '2026-11-01T08:00:00-07:00' },
  'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[A]]', rank: 2, created_at: '2026-11-02T08:00:00-07:00' },
  'spice/tasks/C/C.md': { status: 'open', title: 'C', rank: 3, sibling_rank: 4, created_at: '2026-11-03T08:00:00-07:00' },
}, extra || {});

// ---------- a fake DOM with real class lists and multi-listeners ----------

function descendants(node) {
  return (node.children || []).flatMap((c) => [c, ...descendants(c)]);
}
function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, dataset: {}, _text: '', _listeners: {}, draggable: false,
    createEl(t, o = {}) {
      const c = makeEl(t, o.cls || '');
      c.parentNode = this;
      if (o.text != null) c.textContent = o.text;
      if (o.type) c.type = o.type;
      this.children.push(c);
      return c;
    },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      const i = ref == null ? this.children.length : this.children.indexOf(ref);
      c.parentNode = this;
      this.children.splice(i < 0 ? this.children.length : i, 0, c);
      return c;
    },
    querySelector(sel) {
      const want = String(sel).replace(/^\./, '');
      return descendants(this).find((n) => String(n.className).split(/\s+/).includes(want)) || null;
    },
    querySelectorAll(sel) {
      const want = String(sel).replace(/^\./, '');
      return descendants(this).filter((n) => String(n.className).split(/\s+/).includes(want));
    },
    contains(n) { return n === this || descendants(this).includes(n); },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    async fire(type, event = {}) {
      let out;
      for (const fn of this._listeners[type] || []) out = await fn({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
      return out;
    },
    insertAdjacentHTML() {},
    closest() { return null; },
    focus() {},
    get firstChild() { return this.children[0] || null; },
    get nextSibling() { const s = this.parentNode ? this.parentNode.children : []; return s[s.indexOf(this) + 1] || null; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    set innerHTML(_v) { this.children = []; },
    get innerHTML() { return ''; },
  };
  el.classList = {
    add: (c) => { const s = new Set(String(el.className).split(/\s+/).filter(Boolean)); s.add(c); el.className = Array.from(s).join(' '); },
    remove: (c) => { el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c) => String(el.className).split(/\s+/).includes(c),
  };
  return el;
}
const has = (el, cls) => String(el.className).split(/\s+/).includes(cls);
const rowWithHandle = (taskPath) => {
  const row = makeEl('div', 'sauce-task-today-row');
  row.createEl('span', { cls: 'sauce-task-drag' }).draggable = true;
  row.getBoundingClientRect = () => ({ top: 100, height: 30 });
  row.dataset.path = taskPath;
  return row;
};
const dt = () => {
  const data = {};
  const types = [];
  return { data, types, setData(t, v) { data[t] = v; if (!types.includes(t)) types.push(t); }, getData(t) { return data[t] || ''; }, setDragImage() {}, effectAllowed: '', dropEffect: '' };
};
// During dragover a browser shows the types but keeps the data unreadable.
const overOf = (d) => ({ types: d.types.slice(), getData: () => '', dropEffect: '' });

(async () => {
  const saved = { window: global.window, app: global.app, Notice: global.Notice };
  try {
    // ----- TaskDialog.reparent -----
    {
      const app = makeApp(base());
      const { TDStatic } = setup(app);
      const r = await TDStatic.reparent(app, 'spice/tasks/C/C.md', 'spice/tasks/A/A.md');
      const fm = fmOf(app, 'spice/tasks/A/C/C.md');
      ok('TM-REPARENT-NEST a task path dropped on another task moves its folder under it, parent_task [[A]], sibling_rank cleared, rank (Today order) kept',
        r && r.ok === true && r.path === 'spice/tasks/A/C/C.md' && fm && fm.parent_task === '[[A]]' && fm.sibling_rank === '' && fm.rank === 3
        && !app._folders.has('spice/tasks/C') && app._log.renames.length === 1, JSON.stringify(r));
    }
    {
      const app = makeApp(base({ 'spice/tasks/A/B/D/D.md': { status: 'open', title: 'D', parent_task: '[[B]]' } }));
      const { TDStatic } = setup(app);
      const r = await TDStatic.reparent(app, 'spice/tasks/A/B/B.md', null);
      ok('TM-REPARENT-TOP null makes it top-level: the folder (with its subtasks) moves to spice/tasks, parent_task cleared',
        r && r.ok && r.path === 'spice/tasks/B/B.md' && fmOf(app, 'spice/tasks/B/B.md').parent_task === ''
        && !!fmOf(app, 'spice/tasks/B/D/D.md'), JSON.stringify(r));
    }
    {
      const app = makeApp(base({ 'spice/tasks/A/B/D/D.md': { status: 'open', title: 'D', parent_task: '[[B]]' } }));
      const { TDStatic } = setup(app);
      const r1 = await TDStatic.reparent(app, 'spice/tasks/A/A.md', 'spice/tasks/A/B/D/D.md');
      const r2 = await TDStatic.reparent(app, 'spice/tasks/A/A.md', 'spice/tasks/A/A.md');
      ok('TM-REPARENT-LOOP a task under itself or its own subtask is refused before anything is written',
        r1 && r1.ok === false && /own subtask/.test(r1.reason) && r2 && r2.ok === false
        && app._log.fmWrites.length === 0 && app._log.renames.length === 0, JSON.stringify([r1, r2]));
    }
    {
      const app = makeApp(base({ 'spice/tasks/X.md': { status: 'open', title: 'X', parent_task: '[[C]]' } }));
      const { TDStatic } = setup(app);
      const refusal = TDStatic.reparentRefusal(app, 'spice/tasks/C/C.md', 'spice/tasks/X.md');
      const r = await TDStatic.reparent(app, 'spice/tasks/C/C.md', '[[X]]');
      ok('TM-REPARENT-LOOP-FLAT a flat note whose parent_task chain reaches the task is refused too',
        /own subtask/.test(refusal) && r.ok === false && app._log.fmWrites.length === 0, refusal);
    }
    {
      const app = makeApp(base());
      const { TDStatic } = setup(app);
      const r = await TDStatic.reparent(app, 'spice/tasks/A/B/B.md', 'spice/tasks/A/A.md');
      ok('TM-REPARENT-NOOP the parent it already has changes nothing',
        r && r.ok === true && r.changed === false && app._log.fmWrites.length === 0 && app._log.renames.length === 0);
    }
    {
      const app = makeApp(base());
      const { TDStatic } = setup(app);
      const r = await TDStatic.reparent(app, 'spice/tasks/A/B/B.md', null);
      ok('TM-REPARENT-DETACH-DUE an undated subtask made top-level takes its old parent\'s due',
        r && r.ok && r.due === '2026-11-20' && fmOf(app, 'spice/tasks/B/B.md').due === '2026-11-20');
    }
    {
      const app = makeApp(base());
      const { TDStatic } = setup(app);
      app._failRename = true;
      const r = await TDStatic.reparent(app, 'spice/tasks/C/C.md', 'spice/tasks/A/A.md');
      const fm = fmOf(app, 'spice/tasks/C/C.md');
      ok('TM-REPARENT-MOVE-FAILS a failed folder move puts parent_task and sibling_rank back and leaves rank',
        r && r.ok === false && r.reason === 'move-failed' && fm && fm.parent_task === undefined && fm.sibling_rank === 4 && fm.rank === 3, JSON.stringify(fm));
    }
    {
      const app = makeApp(base({ 'spice/tasks/_done/2026/11/Z/Z.md': { status: 'done', title: 'Z' } }));
      const { TDStatic } = setup(app);
      const r = await TDStatic.reparent(app, 'spice/tasks/_done/2026/11/Z/Z.md', 'spice/tasks/C/C.md');
      ok('TM-REPARENT-DONE status is truth: a done task keeps its _done folder and only takes the link',
        r && r.ok && r.path === 'spice/tasks/_done/2026/11/Z/Z.md' && fmOf(app, r.path).parent_task === '[[C]]');
    }
    {
      const app = makeApp(base());
      const { TD, TDStatic } = setup(app);
      const calls = [];
      const real = TDStatic.reparent;
      TDStatic.reparent = async (...args) => { calls.push(args); return real.apply(TDStatic, args); };
      try {
        const r = await TD._saveEdit(app, app._files.get('spice/tasks/C/C.md'), { title: 'C', parent_task: '[[A]]' }, null);
        ok('TM-REPARENT-SHARED the edit dialog\'s Subtask of… save runs TaskDialog.reparent',
          calls.length === 1 && calls[0][2] === '[[A]]' && r && r.ok && r.path === 'spice/tasks/A/C/C.md', JSON.stringify(r));
      } finally { TDStatic.reparent = real; }
      ok('TM-REPARENT-DELEGATORS reparent, reparentRefusal, projectFields and tripFields reach the statics from the instance',
        typeof TD.reparent === 'function' && typeof TD.reparentRefusal === 'function'
        && JSON.stringify(TD.projectFields({ name: 'Atlas Two' })) === JSON.stringify({ project: '[[Atlas Two]]', project_slug: 'atlas-two' })
        && JSON.stringify(TD.projectFields(null)) === JSON.stringify({ project: '', project_slug: '' })
        && JSON.stringify(TD.tripFields({ name: 'Costa Rica', slug: 'cr' })) === JSON.stringify({ trip: '[[Costa Rica]]', trip_slug: 'cr' }));
    }

    {
      const results = [];
      for (const stored of ['A', [['A']], '[[spice/tasks/A/A|A]]']) {
        const app = makeApp(base());
        app._files.get('spice/tasks/A/B/B.md')._fm.parent_task = stored;
        const { TDStatic } = setup(app);
        const r = await TDStatic.reparent(app, 'spice/tasks/A/B/B.md', 'spice/tasks/A/A.md');
        results.push(r.ok && r.changed === false && app._log.fmWrites.length === 0 && app._log.renames.length === 0);
      }
      ok('TM-REPARENT-NOOP-FORMS a drop on the parent it has is a no-op whatever form parent_task takes (plain, YAML-nested, path-qualified)',
        results.every(Boolean), JSON.stringify(results));
    }
    {
      const app = makeApp(Object.assign({ 'spice/wiki/A.md': { type: 'wiki', title: 'A' } }, base()));
      const order = Array.from(app._files.keys());
      const { TDStatic } = setup(app);
      const r = await TDStatic.reparent(app, 'spice/tasks/C/C.md', 'spice/tasks/A/A.md');
      const fm = fmOf(app, 'spice/tasks/A/C/C.md');
      ok('TM-REPARENT-KNOWN-TARGET a known target file is used as it is when another note shares its name, and the link is path-qualified',
        order[0] === 'spice/wiki/A.md' && r.ok && r.path === 'spice/tasks/A/C/C.md' && fm && fm.parent_task === '[[spice/tasks/A/A|A]]'
        && TEClass._linkText(fm.parent_task) === 'A', JSON.stringify([r, fm && fm.parent_task]));
    }
    {
      const app = makeApp(base({ 'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '' } }));
      const { TDStatic, cjs } = setup(app);
      const r = await TDStatic.reparent(app, 'spice/tasks/A/B/B.md', null);
      ok('TM-REPARENT-FOLDER-TOP Make top-level moves a folder-nested task whose parent_task is empty',
        r.ok && r.changed === true && r.path === 'spice/tasks/B/B.md' && cjs.TaskMove.hasParent({ path: 'spice/tasks/A/B/B.md', parent_task: '' }), JSON.stringify(r));
      const app2 = makeApp(base({ 'spice/tasks/A/B/B.md': { status: 'open', title: 'B', parent_task: '[[C]]' } }));
      const s2 = setup(app2);
      const r2 = await s2.TDStatic.reparent(app2, 'spice/tasks/A/B/B.md', 'spice/tasks/C/C.md');
      ok('TM-REPARENT-FOLDER-MISMATCH re-nesting under the task parent_task already names still moves the folder there',
        r2.ok && r2.path === 'spice/tasks/C/B/B.md' && fmOf(app2, r2.path).parent_task === '[[C]]', JSON.stringify(r2));
    }
    {
      const app = makeApp(base());
      const { TD } = setup(app);
      const c = app._files.get('spice/tasks/C/C.md');
      const res = await TD.setFields('spice/tasks/C/C.md', { due: '2026-12-01' });
      ok('TM-SETFIELDS-SIBLING a date change clears rank (Today order) and never touches sibling_rank',
        res.ok && c._fm.due === '2026-12-01' && c._fm.rank === '' && c._fm.sibling_rank === 4, JSON.stringify(c._fm));
      const writes = [];
      const list = [{ path: 'x', sibling_rank: 1, rank: 7 }, { path: 'y', sibling_rank: 2, rank: 8 }];
      const ctl = TTLClass.manualOrder({
        order: () => list,
        rows: new Map([['x', { parentNode: {} }], ['y', { parentNode: {} }]]),
        setFields: async (p, f) => { writes.push([p, f]); return { ok: true }; },
        renumber: (paths, ranks) => TEClass.renumber(paths, ranks),
        field: 'sibling_rank',
      });
      await ctl.move(list[1], -1);
      ok('TM-SIBLING-ORDER subtask Move up / drag renumber sibling_rank, never rank',
        JSON.stringify(writes) === JSON.stringify([['y', { sibling_rank: 1 }], ['x', { sibling_rank: 2 }]]) && list[0].rank === 7 && list[1].rank === 8,
        JSON.stringify(writes));
      const card = read('platform/mechanisms/task-entity/task-note-view.js');
      ok('TM-SIBLING-CARD the card\'s subtask order runs on sibling_rank and parseNote reads it',
        /field: 'sibling_rank'/.test(card) && TEClass.parseNote({ type: 'task', title: 'x', sibling_rank: '3', file: { path: 'spice/tasks/x/x.md' } }).sibling_rank === 3);
    }

    // ----- TaskDocs.moveTo -----
    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/A/C/C.md': { status: 'open', title: 'C', parent_task: '[[A]]' },
        'spice/tasks/A/notes/Plan.md': { type: 'task-doc', kind: 'plan', title: 'Plan', task: '[[A]]' },
        'spice/tasks/Other/Plan (C).md': { type: 'task-doc', title: 'Plan' },
      });
      setup(app);
      const r = await DocsClass.moveTo(app, 'spice/tasks/A/notes/Plan.md', 'spice/tasks/A/C/C.md');
      const fm = fmOf(app, 'spice/tasks/A/C/notes/Plan.md');
      ok('TM-NOTE-MOVE a note moves into the subtask\'s notes/ (made), task: set, keeping its name while unique',
        r && r.ok && r.path === 'spice/tasks/A/C/notes/Plan.md' && fm && fm.task === '[[C]]' && app._folders.has('spice/tasks/A/C/notes'), JSON.stringify(r));
    }
    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'A' },
        'spice/tasks/D/D.md': { status: 'open', title: 'D' },
        'spice/tasks/A/notes/Plan (A).md': { type: 'task-doc', kind: 'plan', title: 'Plan', task: '[[A]]' },
        'spice/tasks/Elsewhere/Plan.md': { type: 'task-doc', title: 'Plan' },
      });
      setup(app);
      const r = await DocsClass.moveTo(app, 'spice/tasks/A/notes/Plan (A).md', 'spice/tasks/D/D.md');
      const same = await DocsClass.moveTo(app, r.path, 'spice/tasks/D/D.md');
      ok('TM-NOTE-MOVE-NAME renamed by the usual rule with the new task as parent: Plan (D); a move to its own task does nothing',
        r && r.ok && r.path === 'spice/tasks/D/notes/Plan (D).md' && fmOf(app, r.path).task === '[[D]]'
        && same.ok && same.unchanged === true, JSON.stringify(r));
    }
    {
      const app = makeApp({ 'spice/tasks/Flat.md': { status: 'open', title: 'Flat' }, 'spice/tasks/A/A.md': { title: 'A' }, 'spice/tasks/A/notes/N.md': { type: 'task-doc', title: 'N' } });
      setup(app);
      const r = await DocsClass.moveTo(app, 'spice/tasks/A/notes/N.md', 'spice/tasks/Flat.md');
      app._failRename = true;
      app._files.set('spice/tasks/B/B.md', { path: 'spice/tasks/B/B.md', basename: 'B', _fm: { type: 'task', title: 'B' } });
      app._folders.set('spice/tasks/B', { path: 'spice/tasks/B', children: [] });
      const f = await DocsClass.moveTo(app, 'spice/tasks/A/notes/N.md', 'spice/tasks/B/B.md');
      ok('TM-NOTE-MOVE-REFUSE a flat task cannot hold notes; a failed rename puts task: back',
        r.ok === false && f.ok === false && fmOf(app, 'spice/tasks/A/notes/N.md').task === undefined, JSON.stringify([r, f]));
    }

    // ----- TaskTodayList pure helpers -----
    {
      const T = TTLClass;
      const rect = { top: 100, height: 30 };
      ok('TM-ZONE thirds: top before, middle nest, bottom after; nest alone takes the whole row; no layout keeps reorder',
        T.dropZone(rect, 102, true, true) === 'before' && T.dropZone(rect, 115, true, true) === 'nest'
        && T.dropZone(rect, 128, true, true) === 'after' && T.dropZone(rect, 102, false, true) === 'nest'
        && T.dropZone(rect, 102, true, false) === 'before' && T.dropZone(rect, 120, true, false) === 'after'
        && T.dropZone(null, 0, true, true) === 'reorder' && T.dropZone(rect, 115, false, false) === null);
      ok('TM-REFUSAL itself, its own subtask and its current parent are refused; a sibling is fine',
        /itself/.test(T.nestRefusal('spice/tasks/A/A.md', 'spice/tasks/A/A.md'))
        && /own subtask/.test(T.nestRefusal('spice/tasks/A/A.md', 'spice/tasks/A/B/B.md'))
        && /Already/.test(T.nestRefusal('spice/tasks/A/B/B.md', 'spice/tasks/A/A.md', 'spice/tasks/A/A.md'))
        && T.nestRefusal('spice/tasks/A/B/B.md', 'spice/tasks/C/C.md', 'spice/tasks/A/A.md') === ''
        && T.nestRefusal('spice/tasks/Flat.md', 'spice/tasks/Flat 2.md') === '');
      const list = [{ path: 'a' }, { path: 'b' }, { path: 'c' }, { path: 'd' }];
      const p = (l) => (l ? l.map((t) => t.path).join('') : null);
      ok('TM-REORDER-PLACE a line above or below the target lands the row there; the old whole-row meaning is unchanged',
        p(T.reorderInOrder(list, 'a', 'c', 'before')) === 'bacd' && p(T.reorderInOrder(list, 'a', 'c', 'after')) === 'bcad'
        && p(T.reorderInOrder(list, 'd', 'b', 'before')) === 'adbc' && p(T.reorderInOrder(list, 'a', 'b', 'before')) === null
        && p(T.reorderInOrder(list, 'a', 'c')) === 'bcad');
    }

    // ----- wireRowDrag -----
    {
      const app = makeApp(base());
      setup(app);
      const T = TTLClass;
      const nests = [];
      const reorders = [];
      const rowA = rowWithHandle('spice/tasks/A/A.md');
      const rowB = rowWithHandle('spice/tasks/A/B/B.md');
      const rowC = rowWithHandle('spice/tasks/C/C.md');
      const deps = {
        reorder: (from, to, place) => { reorders.push([from, to, place]); return 'r'; },
        canReorder: () => true,
        nest: (from, task) => { nests.push([from, task.path]); return 'n'; },
      };
      T.wireRowDrag(rowA, { path: 'spice/tasks/A/A.md' }, deps);
      T.wireRowDrag(rowB, { path: 'spice/tasks/A/B/B.md', parent_task: 'A' }, deps);
      T.wireRowDrag(rowC, { path: 'spice/tasks/C/C.md' }, deps);
      const d1 = dt();
      await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: d1 });
      ok('TM-DRAG-START the handle carries the path under the task type only and marks the drag',
        JSON.stringify(Object.keys(d1.data)) === JSON.stringify(['application/x-sauce-task-path'])
        && T.dragState() && T.dragState().path === 'spice/tasks/C/C.md' && has(rowC, 'sauce-task-dragging'));
      let prevented = false;
      await rowA.fire('dragover', { clientY: 115, dataTransfer: overOf(d1), preventDefault() { prevented = true; } });
      ok('TM-DRAG-NEST-PAINT the middle of a row shows the nest outline with its label and accepts the drop',
        prevented && has(rowA, 'sauce-drop-nest') && rowA.dataset.dropLabel === 'Make subtask');
      await rowA.fire('dragover', { clientY: 102, dataTransfer: overOf(d1), preventDefault() {} });
      ok('TM-DRAG-LINE the top third swaps the outline for a line above', has(rowA, 'sauce-drop-before') && !has(rowA, 'sauce-drop-nest'));
      const outN = await rowA.fire('drop', { clientY: 115, dataTransfer: d1 });
      ok('TM-DRAG-NEST-DROP a drop on the middle nests the dragged task under that row and ends the drag',
        outN === 'n' && JSON.stringify(nests) === JSON.stringify([['spice/tasks/C/C.md', 'spice/tasks/A/A.md']])
        && T.dragState() === null && !has(rowA, 'sauce-drop-nest'));
      const d2 = dt();
      await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: d2 });
      await rowA.fire('drop', { clientY: 128, dataTransfer: d2 });
      ok('TM-DRAG-REORDER-DROP a drop on the bottom third reorders after the row', JSON.stringify(reorders) === JSON.stringify([['spice/tasks/C/C.md', 'spice/tasks/A/A.md', 'after']]));

      const d3 = dt();
      await rowA.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: d3 });
      prevented = false;
      await rowB.fire('dragover', { clientY: 115, preventDefault() { prevented = true; }, dataTransfer: overOf(d3) });
      ok('TM-DRAG-REFUSED a task over its own subtask is refused visibly: red dashes, a label, no drop',
        !prevented && has(rowB, 'sauce-drop-refused') && /own subtask/.test(rowB.dataset.dropLabel));
      await rowB.fire('drop', { clientY: 115, dataTransfer: d3 });
      ok('TM-DRAG-REFUSED-DROP a refused drop writes nothing and says why', nests.length === 1 && app._log.notices.some((n) => /own subtask/.test(n)));

      const d4 = dt();
      await rowA.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: d4 });
      const before = app._log.notices.length;
      let selfPrevented = false;
      for (const y of [102, 115, 128]) {
        await rowA.fire('dragover', { clientY: y, dataTransfer: overOf(d4), preventDefault() { selfPrevented = true; } });
      }
      const selfOut = await rowA.fire('drop', { clientY: 115, dataTransfer: d4 });
      ok('TM-DRAG-SELF a row over itself stays quiet in every zone: no paint, no label, no drop, no notice',
        !selfPrevented && selfOut === undefined && !['before', 'after', 'nest', 'refused'].some((z) => has(rowA, 'sauce-drop-' + z))
        && rowA.dataset.dropLabel === undefined && app._log.notices.length === before && nests.length === 1 && reorders.length === 1);

      await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dt() });
      prevented = false;
      await rowA.fire('dragover', { clientY: 115, dataTransfer: { types: ['Files'] }, preventDefault() { prevented = true; } });
      const foreign = await rowA.fire('drop', { clientY: 115, dataTransfer: { types: ['text/plain'], getData: () => 'x' } });
      ok('TM-DRAG-TYPES a drag that carries neither task type is never accepted, even with a drag in flight',
        !prevented && foreign === undefined && nests.length === 1);
      T.endDrag();

      const d5 = dt();
      await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: d5 });
      const d6 = { types: ['application/x-sauce-task-path'], getData: (t) => (t === 'application/x-sauce-task-path' ? 'spice/tasks/Other/Other.md' : '') };
      await rowA.fire('drop', { clientY: 115, dataTransfer: d6 });
      ok('TM-DRAG-EVENT-PATH the drop reads its path from the event before the shared state',
        JSON.stringify(nests[1]) === JSON.stringify(['spice/tasks/Other/Other.md', 'spice/tasks/A/A.md']), JSON.stringify(nests));

      const mobileRow = rowWithHandle('spice/tasks/C/C.md');
      const wired = T.wireRowDrag(mobileRow, { path: 'spice/tasks/C/C.md' }, Object.assign({ isMobile: true }, deps));
      ok('TM-DRAG-MOBILE on the phone nothing is wired (the ⋯ menu carries the moves)',
        wired === false && !Object.keys(mobileRow._listeners).length && !Object.keys(mobileRow.querySelector('sauce-task-drag')._listeners).length);
    }
    {
      const app = makeApp(base());
      setup(app);
      const T = TTLClass;
      const doc = makeEl('document');
      doc.head = null;
      const savedDoc = global.document;
      global.document = doc;
      try {
        const rowA = rowWithHandle('spice/tasks/A/A.md');
        T.wireRowDrag(rowA, { path: 'spice/tasks/A/A.md' }, {});
        const rowC = rowWithHandle('spice/tasks/C/C.md');
        T.wireRowDrag(rowC, { path: 'spice/tasks/C/C.md' }, {});
        await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dt() });
        const listening = (doc._listeners.dragend || []).length === 1 && (doc._listeners.drop || []).length === 1;
        await rowA.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dt() });
        const once = (doc._listeners.dragend || []).length === 1;
        await doc.fire('dragend', {});
        ok('TM-DRAG-DOC-END one document-level dragend / drop listener, added once, clears a drag that ends anywhere',
          listening && once && doc.__sauceTaskDragEnd === true && T.dragState() === null);
        await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dt() });
        await doc.fire('drop', {});
        ok('TM-DRAG-DOC-DROP a drop outside every row also clears it', T.dragState() === null);
      } finally { global.document = savedDoc; }
      const view = read('platform/blueprints/to-do/helpers/todo-daily-filter-view.js');
      ok('TM-DRAG-STRIP-END the week-strip drop ends the shared drag too',
        /return dropOnDay\(from, cell\.date\)/.test(view) && /TTL\.endDrag\(\)/.test(view.slice(view.indexOf("button.addEventListener('drop'"), view.indexOf('return dropOnDay(from, cell.date)'))));
    }

    // ----- Make top-level strip, group headers, note drags -----
    {
      const app = makeApp(base());
      setup(app);
      const T = TTLClass;
      const host = makeEl('div');
      const list = host.createEl('div', { cls: 'list' });
      const lifted = [];
      const strip = T.wireTopLevelStrip(host, { before: list, makeTopLevel: (p) => { lifted.push(p); return 'top'; } });
      const rowB = rowWithHandle('spice/tasks/A/B/B.md');
      const rowC = rowWithHandle('spice/tasks/C/C.md');
      T.wireRowDrag(rowB, { path: 'spice/tasks/A/B/B.md', parent_task: 'A' }, {});
      T.wireRowDrag(rowC, { path: 'spice/tasks/C/C.md' }, {});
      const hidden = !has(strip, 'is-active') && host.children[0] === strip && host.children[1] === list;
      await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dt() });
      const notForTop = !has(strip, 'is-active');
      await rowC.querySelector('sauce-task-drag').fire('dragend', {});
      const dB = dt();
      await rowB.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dB });
      const shown = has(strip, 'is-active');
      let prevented = false;
      await strip.fire('dragover', { dataTransfer: overOf(dB), preventDefault() { prevented = true; } });
      const out = await strip.fire('drop', { dataTransfer: dB });
      ok('TM-STRIP Make top-level sits above the list, hidden until a subtask is dragged, and a drop lifts it out',
        hidden && notForTop && shown && prevented && out === 'top' && JSON.stringify(lifted) === JSON.stringify(['spice/tasks/A/B/B.md'])
        && !has(strip, 'is-active'));
      ok('TM-STRIP-MOBILE no strip on the phone', T.wireTopLevelStrip(makeEl('div'), { isMobile: true }) === null);

      const { cjs } = setup(app, { noMove: true });
      const dead = T.wireTopLevelStrip(makeEl('div'), {});
      const dB2 = dt();
      await rowB.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dB2 });
      let deadPrevented = false;
      await dead.fire('dragover', { dataTransfer: overOf(dB2), preventDefault() { deadPrevented = true; } });
      const deadOut = await dead.fire('drop', { dataTransfer: dB2 });
      ok('TM-STRIP-NO-MOVER without makeTopLevel or TaskMove.nest the strip stays hidden and takes no drop',
        !cjs.TaskMove && !has(dead, 'is-active') && !deadPrevented && deadOut === undefined);
      T.endDrag();
      setup(app);

      const head = makeEl('div', 'sauce-todo-project-head');
      const applied = [];
      T.wireGroupDrop(head, { label: 'Move to Atlas', apply: (p) => { applied.push(p); return 'g'; }, refuse: (p) => (p === 'spice/tasks/A/A.md' ? 'Already in Atlas' : '') });
      const dC = dt();
      await rowC.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dC });
      prevented = false;
      await head.fire('dragover', { dataTransfer: overOf(dC), preventDefault() { prevented = true; } });
      const lit = has(head, 'sauce-drop-nest') && head.dataset.dropLabel === 'Move to Atlas';
      const g = await head.fire('drop', { dataTransfer: dC });
      const rowA = rowWithHandle('spice/tasks/A/A.md');
      T.wireRowDrag(rowA, { path: 'spice/tasks/A/A.md' }, {});
      const dA = dt();
      await rowA.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: dA });
      let refusedPrevent = false;
      await head.fire('dragover', { dataTransfer: overOf(dA), preventDefault() { refusedPrevent = true; } });
      ok('TM-GROUP a project header takes a dropped task and outlines it; one already there is refused',
        prevented && lit && g === 'g' && JSON.stringify(applied) === JSON.stringify(['spice/tasks/C/C.md'])
        && !refusedPrevent && has(head, 'sauce-drop-refused'));
      T.endDrag();

      const noteRow = makeEl('div', 'sauce-tnv-doc');
      noteRow.createEl('span', { cls: 'sauce-tnv-doc-icon' });
      const handle = T.wireNoteDrag(noteRow, { path: 'spice/tasks/A/notes/Plan.md' }, { taskPath: 'spice/tasks/A/A.md' });
      const moved = [];
      const subRow = rowWithHandle('spice/tasks/A/B/B.md');
      T.wireRowDrag(subRow, { path: 'spice/tasks/A/B/B.md' }, { acceptNotes: true, moveNote: (doc, task) => { moved.push([doc, task.path]); return 'm'; } });
      const plainRow = rowWithHandle('spice/tasks/C/C.md');
      T.wireRowDrag(plainRow, { path: 'spice/tasks/C/C.md' }, { nest: () => 'never' });
      const nd = dt();
      await handle.fire('dragstart', { dataTransfer: nd });
      prevented = false;
      await subRow.fire('dragover', { clientY: 102, dataTransfer: overOf(nd), preventDefault() { prevented = true; } });
      let plainPrevented = false;
      await plainRow.fire('dragover', { dataTransfer: overOf(nd), preventDefault() { plainPrevented = true; } });
      const m = await subRow.fire('drop', { dataTransfer: nd });
      ok('TM-NOTE-DRAG a Notes row has a handle first; it drops on a subtask row that takes notes, and only there',
        noteRow.children[0] === handle && JSON.stringify(Object.keys(nd.data)) === JSON.stringify(['application/x-sauce-task-doc-path'])
        && prevented && !plainPrevented && m === 'm' && JSON.stringify(moved) === JSON.stringify([['spice/tasks/A/notes/Plan.md', 'spice/tasks/A/B/B.md']]));
    }
    {
      const trips = read('platform/blueprints/to-do/helpers/todo-daily-trip-groups.js');
      const app = makeApp(base());
      setup(app);
      const T = TTLClass;
      const label = makeEl('div', 'sauce-section-label');
      const applied = [];
      T.wireGroupDrop(label, {
        label: 'Move to Costa Rica',
        refuse: (p, drag) => (drag && drag.hasProject ? 'This task is under a project; remove the project first' : ''),
        apply: (p) => { applied.push(p); },
      });
      const row = rowWithHandle('spice/tasks/C/C.md');
      T.wireRowDrag(row, { path: 'spice/tasks/C/C.md', project: '[[Atlas]]', project_slug: 'atlas' }, {});
      const d = dt();
      await row.querySelector('sauce-task-drag').fire('dragstart', { dataTransfer: d });
      let prevented = false;
      await label.fire('dragover', { dataTransfer: overOf(d), preventDefault() { prevented = true; } });
      ok('TM-TRIP-UNDER-PROJECT a task with a project is refused on a trip header with the notice text, in the trip groups too',
        !prevented && has(label, 'sauce-drop-refused') && label.dataset.dropLabel === 'This task is under a project; remove the project first'
        && applied.length === 0 && /drag && drag\.hasProject/.test(trips) && trips.indexOf('This task is under a project; remove the project first') >= 0);
      T.endDrag();
    }

    // ----- TaskMove -----
    {
      const app = makeApp(base({ 'spice/tasks/Gone/Gone.md': { status: 'done', title: 'Gone' } }));
      const { cjs, mutations } = setup(app);
      const TM = cjs.TaskMove;
      const labels = (t) => TM.menuEntries(t).map((e) => e.label);
      ok('TM-MENU an open task offers Make subtask of… and Move to project…; a subtask also Make top-level; a done task none',
        JSON.stringify(labels({ path: 'spice/tasks/C/C.md', status: 'open' })) === JSON.stringify(['Make subtask of…', 'Move to project…'])
        && JSON.stringify(labels({ path: 'spice/tasks/A/B/B.md', status: 'open' })) === JSON.stringify(['Make subtask of…', 'Make top-level', 'Move to project…'])
        && labels({ path: 'spice/tasks/Gone/Gone.md', status: 'done' }).length === 0);
      const choices = TM.parentChoices(app, 'spice/tasks/A/B/B.md', '[[A]]').map((c) => c.label);
      ok('TM-PARENT-CHOICES the picker lists open tasks, never the task, its subtasks, done tasks or its current parent',
        JSON.stringify(choices) === JSON.stringify(['C']), JSON.stringify(choices));
      const before = app._log.notices.length;
      const refused = await TM.nest('spice/tasks/A/A.md', 'spice/tasks/A/B/B.md');
      ok('TM-NEST-REFUSED a loop is refused with a plain Notice and no gesture write',
        refused.ok === false && mutations.length === 0 && app._log.notices.slice(before).some((n) => /can't go inside itself or its own subtask/.test(n)));
      let done = null;
      const res = await TM.nest('spice/tasks/C/C.md', 'spice/tasks/A/A.md', { onDone: (r) => { done = r; } });
      ok('TM-NEST a nest is one RenderSafe.mutate gesture write running TaskDialog.reparent',
        res && res.ok && mutations.length === 1 && mutations[0].path === 'spice/tasks/C/C.md'
        && done && done.path === 'spice/tasks/A/C/C.md' && !!fmOf(app, 'spice/tasks/A/C/C.md'));
      const top = await TM.nest('spice/tasks/A/B/B.md', null);
      ok('TM-NEST-TOP Make top-level goes through the same path', top && top.ok && top.path === 'spice/tasks/B/B.md' && mutations.length === 2);
      const trip = await TM.setTrip('spice/tasks/B/B.md', { name: 'Costa Rica', slug: 'cr' });
      const proj = await TM.setProject('spice/tasks/B/B.md', { name: 'Atlas', slug: 'atlas' });
      const fm = fmOf(app, 'spice/tasks/B/B.md');
      ok('TM-SET-GROUP project and trip moves write the dialog\'s fields through RenderSafe.mutate',
        proj.ok && trip.ok && fm.project === '[[Atlas]]' && fm.project_slug === 'atlas' && fm.trip === '[[Costa Rica]]'
        && fm.trip_slug === 'cr' && mutations.length === 4);
      const n0 = app._log.notices.length;
      const refusedTrip = await TM.setTrip('spice/tasks/B/B.md', { name: 'Japan', slug: 'jp' });
      ok('TM-SET-TRIP-UNDER-PROJECT a task with a project is refused a trip, with the notice and no write',
        refusedTrip.ok === false && refusedTrip.reason === 'under-project' && fm.trip === '[[Costa Rica]]' && mutations.length === 4
        && app._log.notices.slice(n0).includes('This task is under a project; remove the project first'));
      const cleared = await TM.setProject('spice/tasks/B/B.md', null);
      ok('TM-SET-GROUP-CLEAR No project clears both fields', cleared.ok && fm.project === '' && fm.project_slug === '');
    }
    {
      const app = makeApp({
        'spice/tasks/A/A.md': { status: 'open', title: 'Alpha' },
        'spice/tasks/A/B/B.md': { status: 'open', title: 'Bravo' },
        'spice/tasks/Flat.md': { status: 'open', title: 'Flat' },
        'spice/tasks/_done/2026/11/D/D.md': { status: 'done', title: 'Done' },
        'spice/tasks/E/E.md': { status: 'done', title: 'Echo' },
        'spice/tasks/_sets/S.md': { type: 'task-set', title: 'Set' },
      });
      const { cjs } = setup(app);
      const targets = cjs.TaskMove.noteTargets(app, 'spice/tasks/A/A.md');
      ok('TM-NOTE-TARGETS a note can move to open folder-layout tasks other than its own',
        JSON.stringify(targets.map((t) => [t.label, t.value, t.sub])) === JSON.stringify([['Bravo', 'spice/tasks/A/B/B.md', 'in A']]),
        JSON.stringify(targets));
    }
    {
      const app = makeApp(base());
      const { cjs } = setup(app);
      const opened = [];
      class FakeFuzzy {
        constructor(a) { this.app = a; }
        setPlaceholder(p) { this._ph = p; }
        open() { opened.push(this); }
        renderSuggestion() {}
      }
      cjs.obsidian = { FuzzySuggestModal: FakeFuzzy };
      const modal = cjs.TaskMove.pickParent('spice/tasks/C/C.md', {});
      const items = modal && modal.getItems().map((i) => i.label);
      const valuesArePaths = modal.getItems().every((i) => /^spice\/tasks\/.*\.md$/.test(i.value));
      modal.onChooseItem(modal.getItems().find((i) => i.label === 'B'));
      await new Promise((r) => setTimeout(r, 10));
      ok('TM-PICKER Make subtask of… opens a fuzzy picker of open tasks and nests on a choice',
        opened.length === 1 && valuesArePaths && modal._ph === 'Make it a subtask of…' && JSON.stringify(items.slice().sort()) === JSON.stringify(['A', 'B'])
        && !!fmOf(app, 'spice/tasks/A/B/C/C.md'), JSON.stringify(items));
      cjs.obsidian = {};
      const none = cjs.TaskMove.pickProject('spice/tasks/C/C.md', {});
      ok('TM-PICKER-COLD without the modal class the picker says so and does nothing', none === null && app._log.notices.some((n) => /not ready/.test(n)));
    }

    // ----- the row ⋯ menu -----
    {
      const app = makeApp(base());
      const { cjs } = setup(app);
      const menus = [];
      cjs.MenuPopover = { open: (entries) => { menus.push(entries.map((e) => e.label)); } };
      global.document = undefined;
      const host = makeEl('div');
      const T = TTLClass;
      const row = T.renderTaskRow(host, { path: 'spice/tasks/A/B/B.md', title: 'B', status: 'open', parent_task: 'A' }, null, { todayStr: '2026-11-13', onMove: () => {} });
      await row.querySelector('sauce-task-action-more').fire('click', {});
      delete cjs.TaskMove;
      const row2 = T.renderTaskRow(host, { path: 'spice/tasks/C/C.md', title: 'C', status: 'open' }, null, { todayStr: '2026-11-13' });
      await row2.querySelector('sauce-task-action-more').fire('click', {});
      ok('TM-ROW-MENU the ⋯ menu adds the moves after Move up / down and before Delete, on every device; without TaskMove it is unchanged',
        JSON.stringify(menus[0]) === JSON.stringify(['Remove date', 'Pick date…', 'Move up', 'Move down', 'Make subtask of…', 'Make top-level', 'Move to project…', 'Delete'])
        && JSON.stringify(menus[1]) === JSON.stringify(['Move to backlog', 'Pick date…', 'Delete']), JSON.stringify(menus));
    }

    // ----- TaskNoteView: rank among siblings, the card's index move -----
    {
      const N = TNVClass;
      const t = (name, extra) => Object.assign({ path: 'spice/tasks/P/' + name + '/' + name + '.md', title: name, status: 'open', parent_path: 'spice/tasks/P/P.md' }, extra || {});
      const kids = [t('a', { rank: 1 }), t('b', { sibling_rank: 2, rank: 9 }), t('c', { sibling_rank: 1 }), t('d'), t('x', { status: 'done', completed_at: '2026-11-01' }), t('y', { status: 'done', completed_at: '2026-11-05' })];
      const children = new Map([['spice/tasks/P/P.md', kids]]);
      const ordered = N._orderedChildren('spice/tasks/P/P.md', children).map((k) => k.title).join('');
      ok('TM-RANK open subtasks by sibling_rank, unranked last in their order (rank plays no part); done ones newest first', ordered === 'cbadyx', ordered);
      ok('TM-RANK-DELEGATOR _rankOrder and _applyMove reach the statics from the instance',
        typeof new N()._rankOrder === 'function' && typeof new N()._applyMove === 'function');
      const index = N._taskIndex([
        { path: 'spice/tasks/P/P.md', title: 'P', parent_path: '' },
        { path: 'spice/tasks/P/a/a.md', title: 'a', parent_path: 'spice/tasks/P/P.md', status: 'open' },
        { path: 'spice/tasks/P/b/b.md', title: 'b', parent_path: 'spice/tasks/P/P.md', status: 'open', sibling_rank: 1 },
        { path: 'spice/tasks/P/b/k/k.md', title: 'k', parent_path: 'spice/tasks/P/b/b.md', status: 'open' },
      ]);
      const moved = N._applyMove(index, 'spice/tasks/P/b/b.md', 'spice/tasks/P/a/a.md', 'spice/tasks/P/a/b/b.md');
      const under = (p) => N._kidsOf(index, p).map((k) => k.title).join('');
      ok('TM-CARD-MOVE a nest on the card moves the subtask under its sibling, unranked, and its own subtasks follow',
        moved && moved.sibling_rank === null && under('spice/tasks/P/P.md') === 'a' && under('spice/tasks/P/a/a.md') === 'b'
        && under('spice/tasks/P/a/b/b.md') === 'k' && N._kidsOf(index, 'spice/tasks/P/a/b/b.md')[0].path === 'spice/tasks/P/a/b/k/k.md');
      N._applyMove(index, 'spice/tasks/P/a/b/b.md', null, 'spice/tasks/b/b.md');
      ok('TM-CARD-TOP Make top-level takes it off the card', under('spice/tasks/P/a/a.md') === '');
    }

    // ----- wiring: every surface hands its rows to the shared controller -----
    {
      const view = read('platform/blueprints/to-do/helpers/todo-daily-filter-view.js');
      const dash = read('platform/blueprints/daily/helpers/space-daily-dashboard.js');
      const card = read('platform/mechanisms/task-entity/task-note-view.js');
      const groups = read('platform/blueprints/to-do/helpers/todo-daily-project-groups.js');
      const trips = read('platform/blueprints/to-do/helpers/todo-daily-trip-groups.js');
      ok('TM-WIRED the To-Do view, the dashboard panel, the task card and the project and trip groups use wireRowDrag; headers use wireGroupDrop',
        [view, dash, card, groups, trips].every((s) => /TTL\.wireRowDrag\(/.test(s))
        && [view, dash, card].every((s) => /wireTopLevelStrip\(/.test(s))
        && [view, groups, trips].every((s) => /wireGroupDrop\(/.test(s))
        && /wireNoteDrag\(/.test(card) && /acceptNotes: true/.test(card));
      const manifest = JSON.parse(read('platform/mechanisms/task-entity/manifest.json'));
      ok('TM-MANIFEST TaskMove ships as a customJS class of task-entity',
        manifest.customjs_classes.includes('TaskMove') && manifest.files.some((f) => f.source === 'task-move.js'));
    }
  } catch (e) {
    console.log('  FAIL — harness threw: ' + (e && (e.stack || e.message || e)));
    results.push(['harness', false]);
  } finally {
    global.window = saved.window;
    global.app = saved.app;
    global.Notice = saved.Notice;
  }
  const failed = results.filter(([, p]) => !p);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
