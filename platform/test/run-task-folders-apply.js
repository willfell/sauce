#!/usr/bin/env node
/**
 * run-task-folders-apply.js — TaskFolders (platform/mechanisms/task-entity/
 * task-folders.js), the customJS class that applies the task folder migration
 * from its dry-run report inside Obsidian. The plan comes from the real
 * planner (install.js planTaskFolders) over a fixture vault; the report from
 * renderTaskFoldersReport. A fake app records every renameFile, vault.process,
 * createFolder, delete and processFrontMatter call and actually moves paths: it
 * refuses a rename into a missing folder or onto an existing file, a folder
 * whose parent is missing, and the deletion of a folder that is not empty. Any
 * adapter call throws, so a move that bypasses fileManager.renameFile fails.
 * Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const install = require('../install.js');

const results = [];
const ok = (n, c, detail) => {
  results.push([n, !!c]);
  console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${!c && detail ? ' — ' + detail : ''}`);
};

const SRC = path.join(__dirname, '..', 'mechanisms', 'task-entity', 'task-folders.js');
const MIRROR = path.join(__dirname, '..', '..', 'ranch', 'scripts', 'task-entity', 'task-folders.js');

function loadClass() {
  if (!fs.existsSync(SRC)) return null;
  const body = fs.readFileSync(SRC, 'utf8');
  // eslint-disable-next-line no-eval
  const def = eval('(' + body + ')');
  return def;
}

const T = 'spice/tasks';
const REPORT = 'ranch/reports/task-folders-2026-11-11.md';

function task(fields, body) {
  const lines = ['---', 'type: task'];
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}: ${v}`);
  lines.push('---', '', body || '<!-- TASK_NOTES -->', '');
  return lines.join('\n');
}

function fixture() {
  return {
    'spice/wiki/ems/other-stuff/Yup.md': '---\ntype: wiki\n---\n# Yup\n',
    'spice/wiki/ems/other-stuff/Notes.md': '---\ntype: wiki\n---\nSee [[Yup]] and `[[Yup]]` in code.\n',
    [`${T}/_done/yup.md`]: task({ title: 'yup', status: 'done', created_at: '2026-03-04T09:00:00-07:00', completed_at: '2026-03-10' }),

    [`${T}/Help Henry.md`]: task({ title: 'Help Henry', status: 'open', created_at: '2026-10-01T09:00:00-07:00' }),
    [`${T}/Review PR.md`]: task({ title: 'Review PR', status: 'open', parent_task: '"[[Help Henry]]"', created_at: '2026-10-02T09:00:00-07:00' }),
    [`${T}/Leave comments.md`]: task({ title: 'Leave comments', status: 'open', parent_task: '"[[Review PR]]"', created_at: '2026-10-03T09:00:00-07:00' }),

    [`${T}/_done/Plan trip.md`]: task({ title: 'Plan trip', status: 'done', created_at: '2026-02-01T09:00:00-07:00', completed_at: '2026-02-20' }),
    [`${T}/Plan trip.md`]: task({ title: 'Plan trip', status: 'open', created_at: '2026-05-01T09:00:00-07:00' }),
    [`${T}/Book flights.md`]: task({ title: 'Book flights', status: 'open', parent_task: '"[[Plan trip]]"', created_at: '2026-06-01T09:00:00-07:00' },
      'Also see [[Plan trip]] for dates.'),

    [`${T}/_done/Pay Bills.md`]: task({ title: 'Pay Bills', status: 'done', created_at: '2026-01-05T09:00:00-07:00', completed_at: '2026-01-31' }),
    [`${T}/Pay Bills.md`]: task({ title: 'Pay Bills', status: 'open', created_at: '2026-11-03T09:00:00-07:00' }),
    'spice/daily/2026-11-10.md': '---\ntype: daily\n---\nRemember [[Pay Bills|bills]].\n',

    [`${T}/Old Folder/Old Folder.md`]: task({ title: 'Old Folder', status: 'done', created_at: '2026-04-01T09:00:00-07:00', completed_at: '2026-04-20' }),
    [`${T}/Keep/Keep.md`]: task({ title: 'Keep', status: 'done', created_at: '2026-04-02T09:00:00-07:00', completed_at: '2026-04-21' }),
    [`${T}/Keep/sketch.png`]: 'PNG',
  };
}

function readFm(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
    fm[kv[1]] = v;
  }
  return fm;
}

function planOf(files) {
  const notes = [];
  const others = [];
  for (const [p, body] of Object.entries(files)) {
    if (!p.endsWith('.md')) continue;
    const fm = readFm(body);
    if (p.startsWith(T + '/') && fm.type === 'task') notes.push({ path: p, fm, body });
    else others.push({ path: p, body });
  }
  return install.planTaskFolders(notes, Object.keys(files).filter((p) => p.endsWith('.md')), others, { today: '2026-11-11' });
}

const dirOf = (p) => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));

function makeApp(files, opt) {
  const o = opt || {};
  const calls = [];
  const listeners = new Map();
  let nextRef = 0;
  const stats = { inFlight: 0, maxInFlight: 0 };
  const content = new Map();
  const folders = new Set();
  const fileObjs = new Map();
  const addFolders = (p) => { for (let d = dirOf(p); d; d = dirOf(d)) folders.add(d); };
  const fileObj = (p) => {
    if (!fileObjs.has(p)) {
      const o = { path: p };
      Object.defineProperty(o, 'name', { get: () => o.path.slice(o.path.lastIndexOf('/') + 1), enumerable: true });
      Object.defineProperty(o, 'basename', { get: () => o.name.replace(/\.[^.]+$/, ''), enumerable: true });
      Object.defineProperty(o, 'extension', { get: () => (/\.([^.]+)$/.exec(o.name) || [, ''])[1], enumerable: true });
      fileObjs.set(p, o);
    }
    return fileObjs.get(p);
  };
  for (const [p, body] of Object.entries(files)) { content.set(p, body); addFolders(p); }
  const folderObj = (d) => ({
    path: d,
    name: d.slice(d.lastIndexOf('/') + 1),
    get children() {
      const out = [];
      for (const p of content.keys()) if (dirOf(p) === d) out.push(fileObj(p));
      for (const f of folders) if (dirOf(f) === d) out.push(folderObj(f));
      return out;
    },
  });
  const get = (p) => {
    if (content.has(p)) return fileObj(p);
    if (folders.has(p)) return folderObj(p);
    return null;
  };
  const need = (file) => {
    if (!file || !content.has(file.path)) throw new Error('no such file ' + (file && file.path));
    return file.path;
  };
  const parseFm = (text) => {
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    const fm = {};
    if (m) for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
      if (!kv) continue;
      let v = kv[2].trim();
      if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
      fm[kv[1]] = v;
    }
    return { fm, rest: m ? text.slice(m[0].length) : text };
  };
  const adapter = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return () => { calls.push(['adapter', String(prop)]); throw new Error('adapter.' + String(prop) + ' must not be used'); };
    },
  });
  const app = {
    vault: {
      adapter,
      getConfig(k) { return k === 'alwaysUpdateLinks' ? app._alwaysUpdateLinks : undefined; },
      getAbstractFileByPath: (p) => get(p),
      async read(file) { return content.get(need(file)); },
      async cachedRead(file) { return content.get(need(file)); },
      async process(file, fn) {
        const p = need(file);
        calls.push(['process', p]);
        const next = fn(content.get(p));
        content.set(p, next);
        if (o.cache === 'async') {
          setTimeout(() => {
            calls.push(['changed', p]);
            for (const cb of Array.from(listeners.values())) cb(fileObj(p));
          }, 15);
        }
        return next;
      },
      async createFolder(d) {
        calls.push(['createFolder', d]);
        if (folders.has(d) || content.has(d)) throw new Error('Folder already exists: ' + d);
        if (dirOf(d) && !folders.has(dirOf(d))) throw new Error('parent folder missing for ' + d);
        folders.add(d);
      },
      async delete(f) {
        calls.push(['delete', f.path]);
        if (folders.has(f.path)) {
          if (folderObj(f.path).children.length) throw new Error('folder not empty: ' + f.path);
          folders.delete(f.path);
          return;
        }
        need(f);
        content.delete(f.path);
      },
    },
    fileManager: {
      async renameFile(file, to) {
        const from = need(file);
        calls.push(['rename', from, to]);
        stats.inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        try { if (o.renameDelay) await new Promise((r) => setTimeout(r, o.renameDelay)); } finally { stats.inFlight--; }
        if (o.failRename && o.failRename.has(from)) throw new Error('simulated rename failure');
        if (content.has(to) || folders.has(to)) throw new Error('Destination file already exists: ' + to);
        if (dirOf(to) && !folders.has(dirOf(to))) throw new Error('parent folder missing for ' + to);
        content.set(to, content.get(from));
        content.delete(from);
        fileObjs.delete(from);
        file.path = to;
        fileObjs.set(to, file);
      },
      async processFrontMatter(file, fn) {
        const p = need(file);
        calls.push(['processFrontMatter', p]);
        const { fm, rest } = parseFm(content.get(p));
        fn(fm);
        const lines = Object.entries(fm).map(([k, v]) => `${k}: ${/[[\]:#]/.test(String(v)) ? JSON.stringify(String(v)) : v}`);
        content.set(p, '---\n' + lines.join('\n') + '\n---\n' + rest);
      },
    },
    _alwaysUpdateLinks: true,
  };
  if (o.cache) {
    app.metadataCache = {
      on(name, cb) { const ref = { id: ++nextRef, name }; if (name === 'changed') listeners.set(ref.id, cb); return ref; },
      offref(ref) { if (ref) listeners.delete(ref.id); },
      get listenerCount() { return listeners.size; },
    };
  }
  return { app, calls, content, folders, stats };
}

// A tolerant element tree with enough of Obsidian's createEl API for render().
function makeEl(tag) {
  const el = {
    tag: tag || 'div', children: [], attrs: {}, cls: '', _text: '', disabled: false, texts: [], listeners: {},
    style: {},
    get textContent() { return el._text + el.children.map((c) => c.textContent).join(''); },
    set textContent(v) { el._text = String(v); el.children = []; el.texts.push(String(v)); },
    createEl(t, o) {
      const c = makeEl(t);
      const opts = o || {};
      if (opts.text != null) c.textContent = opts.text;
      if (opts.cls) c.cls = Array.isArray(opts.cls) ? opts.cls.join(' ') : opts.cls;
      if (opts.attr) Object.assign(c.attrs, opts.attr);
      el.children.push(c);
      c.parentElement = el;
      return c;
    },
    createDiv(o) { return el.createEl('div', typeof o === 'string' ? { cls: o } : o); },
    createSpan(o) { return el.createEl('span', typeof o === 'string' ? { cls: o } : o); },
    setText(v) { el.textContent = v; },
    empty() { el.children = []; el._text = ''; },
    addClass(c) { el.cls = (el.cls + ' ' + c).trim(); },
    setAttribute(k, v) { el.attrs[k] = v; },
    removeAttribute(k) { delete el.attrs[k]; },
    addEventListener(ev, fn) { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
    get isConnected() { return true; },
    closest() { return null; },
  };
  return el;
}

function find(el, pred) {
  if (pred(el)) return el;
  for (const c of el.children) { const f = find(c, pred); if (f) return f; }
  return null;
}
const buttonOf = (root) => find(root, (e) => e.tag === 'button');

async function click(btn) {
  const fns = (btn.listeners.click || []).concat(btn.onclick ? [btn.onclick] : []);
  for (const fn of fns) await fn({ preventDefault() {} });
}

const orderOf = (calls, pred) => calls.findIndex(pred);

(async () => {
  const TaskFolders = loadClass();
  ok('TF-APPLY the task-folders.js class file exists and loads as a customJS class', typeof TaskFolders === 'function');
  if (typeof TaskFolders !== 'function') {
    const failed = results.filter(([, c]) => !c).length;
    console.log(`\nrun-task-folders-apply: ${results.length - failed} pass · ${failed} fail`);
    process.exit(1);
  }
  const inst = new TaskFolders();
  ok('TF-APPLY render and apply are exposed on the customJS instance',
    typeof inst.render === 'function' && typeof inst.apply === 'function');

  const files = fixture();
  const plan = planOf(files);
  const report = install.renderTaskFoldersReport(plan, '2026-11-11');
  const settled = plan.ambiguousLinks.filter((a) => a.settledBy === 'parent_task' || a.settledBy === 'same-folder');
  const guessed = plan.ambiguousLinks.filter((a) => a.settledBy === 'same-place-oldest');
  ok('TF-APPLY fixture the plan has settled and best-guess ambiguous links, renames and folder-note moves',
    settled.length >= 2 && guessed.length >= 1 && plan.renames.length >= 1 &&
    plan.moves.some((m) => m.from === `${T}/Old Folder/Old Folder.md`), JSON.stringify(plan.ambiguousLinks));

  {
    const { app, calls, content, folders } = makeApp(Object.assign({}, files, { [REPORT]: report }));
    const res = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T12:00:00.000Z' });
    const firstRename = orderOf(calls, (c) => c[0] === 'rename');
    const lastCreate = calls.map((c) => c[0]).lastIndexOf('createFolder');

    ok('TF-APPLY-ORDER every target folder is created before the first move',
      lastCreate >= 0 && firstRename > lastCreate, JSON.stringify(calls.slice(0, 12)));
    ok('TF-APPLY-ORDER folders are created outermost first (the fake refuses a missing parent)',
      !res.failed.length && calls.filter((c) => c[0] === 'createFolder').every((c, i, a) =>
        a.slice(i + 1).every((d) => !c[1].startsWith(d[1] + '/'))), JSON.stringify(res.failed));
    const renameIdx = (from) => orderOf(calls, (c) => c[0] === 'rename' && c[1] === from);
    ok('TF-APPLY-ORDER a parent moves before its child and grandchild',
      renameIdx(`${T}/Help Henry.md`) >= 0 && renameIdx(`${T}/Help Henry.md`) < renameIdx(`${T}/Review PR.md`) &&
      renameIdx(`${T}/Review PR.md`) < renameIdx(`${T}/Leave comments.md`) &&
      renameIdx(`${T}/Plan trip.md`) < renameIdx(`${T}/Book flights.md`));
    ok('TF-APPLY-ORDER the moves run in plan order',
      JSON.stringify(calls.filter((c) => c[0] === 'rename').map((c) => c[1])) === JSON.stringify(plan.moves.map((m) => m.from)));

    const lastProcessBeforeMove = calls.slice(0, firstRename).filter((c) => c[0] === 'process').map((c) => c[1]);
    ok('TF-APPLY-AMBIGUOUS-FIRST each settled link is rewritten before any renameFile',
      settled.every((a) => lastProcessBeforeMove.indexOf(a.in) >= 0) &&
      !calls.slice(firstRename).some((c) => c[0] === 'process' && c[1] !== REPORT), JSON.stringify(calls.filter((c) => c[0] === 'process')));
    ok('TF-APPLY-AMBIGUOUS-FIRST a same-folder link becomes [[full/path|text]] and a link inside code is left alone',
      content.get('spice/wiki/ems/other-stuff/Notes.md') === '---\ntype: wiki\n---\nSee [[spice/wiki/ems/other-stuff/Yup|Yup]] and `[[Yup]]` in code.\n',
      content.get('spice/wiki/ems/other-stuff/Notes.md'));
    const bookTo = plan.moves.find((m) => m.from === `${T}/Book flights.md`).to;
    const book = content.get(bookTo) || '';
    ok('TF-APPLY-AMBIGUOUS-FIRST the same link text on the parent_task line and in the body is rewritten by each one\'s own entry',
      plan.ambiguousLinks.some((a) => a.in === `${T}/Book flights.md` && a.settledBy === 'parent_task') &&
      plan.ambiguousLinks.some((a) => a.in === `${T}/Book flights.md` && a.settledBy === 'same-folder') &&
      book.includes('Also see [[spice/tasks/Plan trip|Plan trip]] for dates.'), book);
    ok('TF-APPLY-BEST-GUESS a same-place-oldest link is not rewritten and its note is never processed',
      content.get('spice/daily/2026-11-10.md') === files['spice/daily/2026-11-10.md'] &&
      !calls.some((c) => c[0] === 'process' && c[1] === 'spice/daily/2026-11-10.md'));

    ok('TF-APPLY-RENAMEFILE every move goes through fileManager.renameFile, none through the adapter',
      calls.filter((c) => c[0] === 'rename').length === plan.moves.length && !calls.some((c) => c[0] === 'adapter'),
      JSON.stringify(calls.filter((c) => c[0] === 'adapter')));
    ok('TF-APPLY-RENAMEFILE every note is at its target and gone from its source',
      plan.moves.every((m) => content.has(m.to) && !content.has(m.from)), plan.moves.filter((m) => !content.has(m.to)).map((m) => m.to).join(', '));
    ok('TF-APPLY-RENAMEFILE the result counts every move', res.moved === plan.moves.length && res.skipped === 0 && res.failed.length === 0,
      JSON.stringify(res));

    ok('TF-APPLY-PARENT a child whose parent was renamed gets parent_task "[[<new parent name>]]"',
      readFm(book).parent_task === '[[Plan trip - 05-01-26]]', book);
    const review = content.get(plan.moves.find((m) => m.from === `${T}/Review PR.md`).to);
    ok('TF-APPLY-PARENT a child whose parent kept its name is not rewritten',
      readFm(review).parent_task === '[[Help Henry]]' &&
      !calls.some((c) => c[0] === 'processFrontMatter' && c[1].endsWith('/Review PR.md')), review);
    ok('TF-APPLY-PARENT a top-level task gets no parent_task',
      !('parent_task' in readFm(content.get(plan.moves.find((m) => m.from === `${T}/Help Henry.md`).to))));

    ok('TF-APPLY-EMPTY-FOLDERS an emptied source folder is removed',
      !folders.has(`${T}/Old Folder`) && calls.some((c) => c[0] === 'delete' && c[1] === `${T}/Old Folder`));
    ok('TF-APPLY-EMPTY-FOLDERS a source folder that still holds a file is kept',
      folders.has(`${T}/Keep`) && content.has(`${T}/Keep/sketch.png`));
    ok('TF-APPLY-EMPTY-FOLDERS nothing outside spice/tasks is deleted and the task roots stay',
      calls.filter((c) => c[0] === 'delete').every((c) => c[1].startsWith(T + '/') && c[1] !== `${T}/_done` && c[1] !== `${T}/_trash`) &&
      folders.has(T) && folders.has(`${T}/_done`));

    const after = content.get(REPORT);
    ok('TF-APPLY-REPORT the report gets an "## Applied <ISO>" section with the counts',
      after.startsWith(report) && after.includes('## Applied 2026-11-11T12:00:00.000Z') &&
      after.includes(`| Moved | ${plan.moves.length} |`) && after.includes('| Failed | 0 |'), after.slice(report.length));
    ok('TF-APPLY-MARKER the Applied section carries the hidden anchor <!-- task-folders:applied --> on its own line',
      /^<!-- task-folders:applied -->$/m.test(after.slice(report.length)) && !report.includes('task-folders:applied'),
      after.slice(report.length, report.length + 200));
    ok('TF-APPLY-MARKER applied is decided by the anchor, not by the visible heading',
      inst.isApplied(after) && inst.isApplied('x\n<!-- task-folders:applied -->\n') &&
      !inst.isApplied('x\n## Applied 2026-11-11T12:00:00.000Z\n') && !inst.isApplied(report));

    const again = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T13:00:00.000Z' });
    ok('TF-APPLY-IDEMPOTENT a second run moves nothing and appends nothing',
      again.moved === 0 && content.get(REPORT) === after && (again.alreadyApplied === true), JSON.stringify(again));
    const plainAgain = await inst.apply(app, plan, {});
    ok('TF-APPLY-IDEMPOTENT without the report a second run skips every move and fails none',
      plainAgain.moved === 0 && plainAgain.failed.length === 0 && plainAgain.skipped === plan.moves.length, JSON.stringify(plainAgain));

    const dv = { container: makeEl('div'), currentFilePath: REPORT, app };
    await inst.render(dv);
    ok('TF-APPLY-IDEMPOTENT the report says "Already applied." and offers no button',
      dv.container.textContent.includes('Already applied.') && !buttonOf(dv.container), dv.container.textContent);
  }

  {
    const vanished = `${T}/Pay Bills.md`;
    const start = Object.assign({}, files, { [REPORT]: report });
    delete start[vanished];
    const { app, content } = makeApp(start);
    const res = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T12:00:00.000Z' });
    ok('TF-APPLY-SKIP a vanished from is skipped, not failed',
      res.skipped === 1 && res.failed.length === 0 && res.moved === plan.moves.length - 1 &&
      res.skips.some((s) => s.from === vanished && /no longer exists/.test(s.why)), JSON.stringify(res));
    ok('TF-APPLY-SKIP the report lists the skipped note', /### Skipped[\s\S]*`spice\/tasks\/Pay Bills\.md`: [^\n]*no longer exists/.test(content.get(REPORT)),
      content.get(REPORT).slice(report.length));
  }

  {
    const occupied = plan.moves.find((m) => m.from === `${T}/Help Henry.md`).to;
    const start = Object.assign({}, files, { [REPORT]: report, [occupied]: 'someone else\n' });
    const { app, content } = makeApp(start);
    const res = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T12:00:00.000Z' });
    ok('TF-APPLY-SKIP a move whose target already exists is skipped and the target is untouched',
      res.skips.some((s) => s.from === `${T}/Help Henry.md` && /already exists/.test(s.why)) &&
      content.get(occupied) === 'someone else\n' && content.has(`${T}/Help Henry.md`), JSON.stringify(res));
  }

  {
    const { app, calls, content } = makeApp(Object.assign({}, files, { [REPORT]: report }));
    app._alwaysUpdateLinks = false;
    const res = await inst.apply(app, plan, { reportPath: REPORT });
    ok('TF-APPLY-LINK-SETTING with "Automatically update internal links" off nothing is moved or rewritten',
      res.moved === 0 && res.failed.length === 1 && !calls.some((c) => c[0] === 'rename' || c[0] === 'process') &&
      content.get(REPORT) === report, JSON.stringify(res));
  }

  {
    const { app, calls } = makeApp(Object.assign({}, files, { [REPORT]: report }));
    const dv = { container: makeEl('div'), currentFilePath: REPORT, app };
    await inst.render(dv);
    const text = dv.container.textContent;
    const cnt = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    ok('TF-APPLY-RENDER the summary counts match the plan',
      text.includes(cnt(plan.moves.length, 'move', 'moves')) && text.includes(cnt(plan.renames.length, 'rename', 'renames')) &&
      text.includes(cnt(plan.parentPicks.length, 'parent pick', 'parent picks')) && text.includes(`${plan.promoted.length} promoted`) &&
      text.includes(`${plan.unresolved.length} unresolved`), text);
    const btn = buttonOf(dv.container);
    ok('TF-APPLY-RENDER an enabled Apply button (sauce-btn) is drawn', btn && btn.textContent === 'Apply' && /\bsauce-btn\b/.test(btn.cls) && !btn.disabled,
      btn && JSON.stringify({ t: btn.textContent, c: btn.cls }));
    ok('TF-APPLY-RENDER drawing moves nothing', !calls.some((c) => c[0] === 'rename' || c[0] === 'process' || c[0] === 'createFolder'));
    let disabledDuring = false;
    const origRename = app.fileManager.renameFile;
    app.fileManager.renameFile = async (f, to) => { if (btn.disabled) disabledDuring = true; return origRename(f, to); };
    await click(btn);
    ok('TF-APPLY-RENDER the button is disabled while running and counts "Applying… n/N"',
      disabledDuring && btn.texts.some((t) => t === `Applying… 1/${plan.moves.length}`) &&
      btn.texts.some((t) => t === `Applying… ${plan.moves.length}/${plan.moves.length}`), JSON.stringify(btn.texts));
    ok('TF-APPLY-RENDER after the run the result is shown',
      new RegExp(`${plan.moves.length} moved`).test(dv.container.textContent) && /0 failed/.test(dv.container.textContent), dv.container.textContent);
    const dv2 = { container: makeEl('div'), currentFilePath: REPORT, app };
    await inst.render(dv2);
    ok('TF-APPLY-RENDER a later draw of the applied report says "Already applied." with no button',
      dv2.container.textContent.includes('Already applied.') && !buttonOf(dv2.container), dv2.container.textContent);
  }

  {
    const { app } = makeApp({ [REPORT]: '# no plan here\n' });
    let threw = false;
    const dv = { container: makeEl('div'), currentFilePath: REPORT, app };
    try { await inst.render(dv); await inst.render({}); await inst.render(null); } catch (_e) { threw = true; }
    ok('TF-APPLY-RENDER a note with no plan says so and render never throws',
      !threw && /no plan/i.test(dv.container.textContent) && !buttonOf(dv.container), dv.container.textContent);
  }

  {
    const big = { moves: [], renames: [], parentPicks: [], promoted: [], ambiguousLinks: [], queryRefs: [], unresolved: [] };
    const start = {};
    for (let i = 0; i < 60; i++) {
      start[`${T}/N${i}.md`] = task({ title: 'N' + i, status: 'open' });
      big.moves.push({ from: `${T}/N${i}.md`, to: `${T}/N${i}/N${i}.md`, name: 'N' + i, reason: 'open top-level task' });
    }
    const { app } = makeApp(start);
    let ticks = 0;
    const origSet = global.setTimeout;
    global.setTimeout = (fn, ms) => { if (!ms) ticks++; return origSet(fn, ms); };
    const res = await inst.apply(app, big, {});
    global.setTimeout = origSet;
    ok('TF-APPLY-YIELD a long run yields to the UI every ~25 moves', res.moved === 60 && ticks >= 2, `ticks=${ticks} moved=${res.moved}`);
  }

  {
    const moveOf = (from) => plan.moves.find((m) => m.from === from);
    const kids = [`${T}/Review PR.md`, `${T}/Leave comments.md`];
    const stayed = (content) => kids.every((k) => content.has(k) && !content.has(moveOf(k).to));
    const parentDir = `${T}/Help Henry`;

    {
      const start = Object.assign({}, files);
      delete start[`${T}/Help Henry.md`];
      const { app, calls, content, folders } = makeApp(start);
      const res = await inst.apply(app, plan, {});
      ok('TF-APPLY-SUBTREE a parent whose from and to are both missing blocks its subtree: children stay, skipped with a reason',
        stayed(content) && kids.every((k) => res.skips.some((s) => s.from === k && /Help Henry\.md/.test(s.why))) &&
        !calls.some((c) => c[0] === 'rename' && kids.indexOf(c[1]) >= 0), JSON.stringify(res.skips));
      ok('TF-APPLY-SUBTREE no folder is created for a blocked subtree',
        !folders.has(parentDir) && !calls.some((c) => c[0] === 'createFolder' && c[1].indexOf(parentDir) === 0) && res.failed.length === 0,
        JSON.stringify(calls.filter((c) => c[0] === 'createFolder')));
    }
    {
      const start = Object.assign({}, files, { [moveOf(`${T}/Help Henry.md`).to]: 'someone else\n' });
      const { app, calls, content } = makeApp(start);
      const res = await inst.apply(app, plan, {});
      ok('TF-APPLY-SUBTREE a parent whose from and to both exist blocks its subtree: children do not land under the other note',
        stayed(content) && kids.every((k) => res.skips.some((s) => s.from === k)) &&
        !calls.some((c) => c[0] === 'rename' && kids.indexOf(c[1]) >= 0) &&
        !calls.some((c) => c[0] === 'createFolder' && c[1].indexOf(parentDir + '/') === 0), JSON.stringify(res.skips));
    }
    {
      const start = Object.assign({}, files);
      start[moveOf(`${T}/Help Henry.md`).to] = start[`${T}/Help Henry.md`];
      delete start[`${T}/Help Henry.md`];
      const { app, content } = makeApp(start);
      const res = await inst.apply(app, plan, {});
      ok('TF-APPLY-SUBTREE a parent already at its target lets its children move under it',
        kids.every((k) => !content.has(k) && content.has(moveOf(k).to)) &&
        res.skips.some((s) => s.from === `${T}/Help Henry.md`) && res.failed.length === 0 &&
        readFm(content.get(moveOf(`${T}/Review PR.md`).to)).parent_task === '[[Help Henry]]', JSON.stringify(res));
    }
    {
      const { app, calls, content } = makeApp(Object.assign({}, files), { failRename: new Set([`${T}/Help Henry.md`]) });
      const res = await inst.apply(app, plan, {});
      ok('TF-APPLY-SUBTREE a failed parent move blocks its subtree: the parent is failed and its children did not move',
        res.failed.some((f) => f.from === `${T}/Help Henry.md`) && stayed(content) &&
        !calls.some((c) => c[0] === 'rename' && kids.indexOf(c[1]) >= 0) &&
        kids.every((k) => res.skips.some((s) => s.from === k) || res.failed.some((f) => f.from === k)), JSON.stringify(res));
    }
  }

  {
    const { app, calls, stats } = makeApp(Object.assign({}, files, { [REPORT]: report }), { cache: 'async', renameDelay: 2 });
    const res = await inst.apply(app, plan, { reportPath: REPORT });
    const touched = calls.filter((c) => c[0] === 'process' && c[1] !== REPORT).map((c) => c[1]);
    const firstRename = orderOf(calls, (c) => c[0] === 'rename');
    const changedAt = (p) => orderOf(calls, (c) => c[0] === 'changed' && c[1] === p);
    ok('TF-APPLY-CACHE no renameFile runs before every rewritten note\'s metadataCache "changed" event',
      touched.length >= 2 && firstRename > 0 && touched.every((p) => changedAt(p) >= 0 && changedAt(p) < firstRename),
      JSON.stringify(calls.slice(0, 20)));
    ok('TF-APPLY-CACHE renames are strictly sequential and the listener is removed',
      stats.maxInFlight === 1 && app.metadataCache.listenerCount === 0 && res.moved === plan.moves.length &&
      !(res.warnings || []).length, JSON.stringify({ stats, warnings: res.warnings }));
  }
  {
    const { app, content } = makeApp(Object.assign({}, files, { [REPORT]: report }), { cache: 'never' });
    const t0 = Date.now();
    const res = await inst.apply(app, plan, { reportPath: REPORT, cacheTimeoutMs: 60 });
    const waited = Date.now() - t0;
    ok('TF-APPLY-CACHE when the index never reports the change the run proceeds after the timeout and says so',
      waited >= 50 && res.moved === plan.moves.length && (res.warnings || []).some((w) => /index/i.test(w)) &&
      /### Notes[\s\S]*index/i.test(content.get(REPORT)) && app.metadataCache.listenerCount === 0,
      JSON.stringify({ waited, warnings: res.warnings }));
  }

  {
    const { app, calls, content } = makeApp(Object.assign({}, files, { [REPORT]: report }));
    app.isMobile = true;
    const res = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T12:00:00.000Z' });
    ok('TF-APPLY-MOBILE on a phone apply refuses: nothing is moved, rewritten or written to the report',
      res.refused === 'mobile' && res.moved === 0 && !calls.some((c) => c[0] === 'rename' || c[0] === 'process' || c[0] === 'createFolder') &&
      content.get(REPORT) === report, JSON.stringify(res));
    TaskFolders.__runs = new Map();
    const dv = { container: makeEl('div'), currentFilePath: REPORT, app };
    await inst.render(dv);
    ok('TF-APPLY-MOBILE on a phone the report says "Run this on your desktop" and draws no Apply button',
      /Run this on your desktop/.test(dv.container.textContent) && !buttonOf(dv.container), dv.container.textContent);
  }

  {
    const failAll = new Set(plan.moves.map((m) => m.from));
    const { app, content } = makeApp(Object.assign({}, files, { [REPORT]: report }), { failRename: failAll });
    const res = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T12:00:00.000Z' });
    const tail = content.get(REPORT).slice(report.length);
    ok('TF-APPLY-NOTHING-MOVED a run where no move lands records an "## Apply attempt <ISO>" section with the failures',
      res.moved === 0 && res.failed.length > 0 && tail.includes('## Apply attempt 2026-11-11T12:00:00.000Z') &&
      /### Failed/.test(tail), tail.slice(0, 300));
    ok('TF-APPLY-NOTHING-MOVED that section has no applied anchor and no "## Applied" heading, so the report is not applied',
      !inst.isApplied(content.get(REPORT)) && !/^## Applied /m.test(tail), tail.slice(0, 300));
    TaskFolders.__runs = new Map();
    const dv = { container: makeEl('div'), currentFilePath: REPORT, app };
    await inst.render(dv);
    const btn = buttonOf(dv.container);
    ok('TF-APPLY-NOTHING-MOVED the report still offers the Apply button', btn && btn.textContent === 'Apply' && !btn.disabled,
      dv.container.textContent);
    if (btn) await click(btn);
    ok('TF-APPLY-NOTHING-MOVED pressing Apply again with every move still failing leaves the button available',
      btn && btn.textContent === 'Apply' && !btn.disabled && !inst.isApplied(content.get(REPORT)), btn && JSON.stringify(btn.texts));
    failAll.clear();
    const again = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T14:00:00.000Z' });
    const after = content.get(REPORT);
    ok('TF-APPLY-NOTHING-MOVED a later run that moves notes writes the anchor and the Applied section',
      again.moved === plan.moves.length && inst.isApplied(after) && after.includes('## Applied 2026-11-11T14:00:00.000Z'),
      JSON.stringify({ moved: again.moved, failed: again.failed }));
  }

  {
    const one = new Set(plan.moves.slice(1).map((m) => m.from));
    const { app, content } = makeApp(Object.assign({}, files, { [REPORT]: report }), { failRename: one });
    const res = await inst.apply(app, plan, { reportPath: REPORT, now: '2026-11-11T12:00:00.000Z' });
    ok('TF-APPLY-PARTIAL a run where at least one move lands is applied: anchor and "## Applied" are written',
      res.moved >= 1 && res.failed.length > 0 && inst.isApplied(content.get(REPORT)) &&
      content.get(REPORT).includes('## Applied 2026-11-11T12:00:00.000Z'), JSON.stringify({ moved: res.moved, failed: res.failed.length }));
  }

  {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'task-entity', 'manifest.json'), 'utf8'));
    ok('TF-APPLY-SHIP the manifest ships task-folders.js and lists TaskFolders',
      manifest.files.some((f) => f.source === 'task-folders.js' && f.dest === '{{scripts_path}}/task-entity/task-folders.js') &&
      manifest.customjs_classes.includes('TaskFolders'));
    ok('TF-APPLY-SHIP the ranch mirror is byte-identical',
      fs.existsSync(MIRROR) && fs.readFileSync(MIRROR, 'utf8') === fs.readFileSync(SRC, 'utf8'));
  }

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\nrun-task-folders-apply: ${results.length - failed} pass · ${failed} fail`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
