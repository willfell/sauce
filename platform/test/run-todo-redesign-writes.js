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
const prevNotice = global.Notice;

function makeTreeNode(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, attributes: {}, type: '', checked: false, cls: '', className: '',
    _textContent: '', children: [], parentNode: null, _listeners: {},
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v == null ? '' : v); this.children = []; },
    createEl(t, opts) {
      const c = makeTreeNode(t);
      if (opts) {
        if (opts.cls) { c.cls = opts.cls; c.className = opts.cls; }
        if (opts.text != null) c.textContent = opts.text;
        if (opts.type) c.type = opts.type;
      }
      this.appendChild(c);
      return c;
    },
    createSpan(opts) { return this.createEl('span', opts); },
    createDiv(opts) { return this.createEl('div', opts); },
    appendText(v) { this.children.push({ tagName: '#text', textContent: String(v == null ? '' : v), parentNode: this }); },
    setText(v) { this.textContent = v; this.children = []; },
    empty() { this.children = []; },
    setAttribute(k, v) { this.attributes[k] = v; if (k === 'class') { this.cls = String(v); this.className = String(v); } },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { const list = this._listeners[ev] || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(node, ref) {
      node.parentNode = this;
      if (ref == null) { this.children.push(node); return node; }
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
      return node;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (c) c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return (i >= 0 && i + 1 < this.parentNode.children.length) ? this.parentNode.children[i + 1] : null;
    },
    get firstChild() { return this.children[0] || null; },
    get options() { return this.children.filter((child) => child.tagName === 'OPTION'); },
    classList: { add() {} },
    focus() { this._focusCount = (this._focusCount || 0) + 1; },
    click() {
      const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
      if (typeof this.onclick === 'function') return this.onclick(event);
      const listeners = this._listeners.click || [];
      return listeners[0] ? listeners[0](event) : undefined;
    },
    contains(candidate) {
      if (candidate === this) return true;
      return this.children.some((child) => child && typeof child.contains === 'function' && child.contains(candidate));
    },
    querySelector(selector) {
      const selectors = String(selector || '').split(',').map((value) => value.trim());
      const match = (node, part) => {
        if (part.startsWith('.')) return (` ${node.className || node.cls || ''} `).includes(` ${part.slice(1)} `);
        if (/^(input|select|textarea|button)/.test(part)) return node.tagName === part.match(/^\w+/)[0].toUpperCase() && !node.disabled;
        return node.tagName === part.toUpperCase();
      };
      const stack = this.children.slice();
      while (stack.length) {
        const node = stack.shift();
        if (selectors.some((part) => match(node, part))) return node;
        if (node && node.children) stack.unshift(...node.children);
      }
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      const stack = this.children.slice();
      while (stack.length) {
        const node = stack.shift();
        if (selector.startsWith('.') && (` ${node.className || node.cls || ''} `).includes(` ${selector.slice(1)} `)) out.push(node);
        if (node && node.children) stack.unshift(...node.children);
      }
      return out;
    },
    closest() { return null; },
  };
  n.classList = {
    add(...names) {
      const current = String(n.className || n.cls || '').split(/\s+/).filter(Boolean);
      for (const name of names) if (!current.includes(name)) current.push(name);
      n.className = current.join(' ');
      n.cls = n.className;
    },
  };
  return n;
}

function findByCls(node, cls) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    const classes = String((c && (c.className || c.cls)) || '').split(/\s+/);
    if (c && classes.includes(cls)) return c;
    const d = findByCls(c, cls); if (d) return d;
  }
  return null;
}
function fireEvent(el, name, extra) {
  const fns = (el && el._listeners && el._listeners[name]) || [];
  const event = Object.assign({ target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} }, extra || {});
  return fns[0] ? fns[0](event) : undefined;
}
function fireClick(el) { return fireEvent(el, 'click'); }

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
    const fm = env.files.get(src)._fm;
    assert(fm.status === 'done', 'status restored to done after failed rename');
    assert(fm.completed_at === 'x', 'completed_at restored after failed rename: ' + JSON.stringify(fm.completed_at));
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


  const rowEnv = (over) => {
    const o = over || {};
    global.window = {
      app: o.app || { workspace: { openLinkText() {} } },
      customJS: Object.assign({ TaskEntity, TaskDialog: { open() {}, confirmDelete: async () => ({ ok: false }) }, RenderSafe: { captureScroll() {} } }, o.customJS || {}),
      moment: () => ({ format: () => o.today || '2026-11-09' }),
    };
    global.app = null;
  };
  const openTask = (extra) => Object.assign({ title: 'Row task', path: 'spice/tasks/row.md', status: 'open', due: '2026-11-09' }, extra || {});
  const withReschedule = (spy, fn) => {
    const Cls = TaskTodayList.constructor;
    const orig = Cls.reschedule;
    Cls.reschedule = spy;
    return Promise.resolve().then(fn).finally(() => { Cls.reschedule = orig; });
  };
  const stubMenu = (menus) => {
    global.window.customJS.MenuPopover = {
      open(entries, o) {
        menus.push({ shown: true, opts: o, entries, items: entries.map((e) => ({ title: e.label, handler: e.onSelect, danger: e.danger })) });
        return {};
      },
    };
  };

  await ok('RD-ROW-NEXTMON', async () => {
    rowEnv();
    const calls = [];
    await withReschedule(async (...a) => { calls.push(a); return { ok: true, due: a[2] }; }, async () => {
      const done = [];
      const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null, { viewedDay: '2026-11-09', onRescheduled: (t, d) => done.push(d) });
      const btn = findByCls(row, 'sauce-task-action-nextmon');
      assert(btn, 'nextmon button rendered');
      assert(btn.attributes['aria-label'] === 'Move to next Monday', 'aria-label ' + btn.attributes['aria-label']);
      assert(btn.textContent === '→ Mon 16', 'label ' + JSON.stringify(btn.textContent));
      await fireClick(btn);
      assert(calls.length === 1 && calls[0][2] === '2026-11-16' && calls[0][3] === '2026-11-09', 'reschedule args ' + JSON.stringify(calls.map((c) => c.slice(2, 4))));
      assert(done.length === 1 && done[0] === '2026-11-16', 'onRescheduled ' + JSON.stringify(done));
    });
    const row2 = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null, { todayStr: '2026-11-15' });
    assert(findByCls(row2, 'sauce-task-action-nextmon').textContent === '→ Mon 16', 'options.todayStr wins over the clock (Sunday -> next day)');
    const doneRow = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ status: 'done' }), null);
    assert(!findByCls(doneRow, 'sauce-task-action-nextmon') && !findByCls(doneRow, 'sauce-task-action-more'), 'done rows get no reschedule actions');
  });

  await ok('RD-ROW-NOTES', async () => {
    const chromeLen = TaskEntity._chromeBody().length;
    const mk = (stat, fmEnd) => ({
      vault: { getAbstractFileByPath: (p) => (p === 'spice/tasks/row.md' ? (stat == null ? { path: p } : { path: p, stat: { size: stat } }) : null) },
      metadataCache: { getFileCache: () => (fmEnd == null ? {} : { frontmatterPosition: { end: { offset: fmEnd } } }) },
      workspace: { openLinkText() {} },
    });
    rowEnv({ app: mk(400 + chromeLen + 5600, 400) });
    let row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null);
    const chip = findByCls(row, 'sauce-task-notes');
    assert(chip && chip.textContent === '5 KB notes', 'chip ' + (chip && chip.textContent));
    rowEnv({ app: mk(400 + chromeLen + 300, 400) });
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null);
    assert(findByCls(row, 'sauce-task-notes').textContent === '1 KB notes', 'min 1 KB');
    rowEnv({ app: mk(400 + chromeLen + 150, 400) });
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null);
    assert(!findByCls(row, 'sauce-task-notes'), 'at or under 200 bytes -> no chip');
    for (const [stat, fmEnd, label] of [[null, 400, 'stat missing'], [6000, null, 'cache missing'], [6000, 400, 'file missing']]) {
      rowEnv({ app: label === 'file missing' ? { vault: { getAbstractFileByPath: () => null }, metadataCache: {}, workspace: {} } : mk(stat, fmEnd) });
      row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null);
      assert(!findByCls(row, 'sauce-task-notes'), label + ' -> no chip');
    }
  });

  await ok('RD-ROW-PRIO', async () => {
    rowEnv();
    for (const [prio, level] of [['highest', 'highest'], ['high', 'high'], ['medium', 'medium'], ['low', 'low'], ['', 'none'], ['urgent', 'none'], [undefined, 'none']]) {
      const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ priority: prio }), null);
      const bar = findByCls(row, 'sauce-task-prio-bar');
      assert(bar, 'bar rendered for ' + prio);
      assert(String(bar.className).split(/\s+/).includes('is-' + level), 'bar class ' + bar.className + ' for ' + prio);
    }
    const done = TaskTodayList.renderTaskRow(makeTreeNode('div'), { title: 'd', path: 'p.md', status: 'done' }, null);
    assert(findByCls(done, 'sauce-task-prio-bar'), 'bar renders on every row');
  });

  await ok('RD-ROW-AGE', async () => {
    rowEnv();
    let row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ due: '2026-11-02' }), null);
    let age = findByCls(row, 'sauce-task-age');
    assert(age && age.textContent === '7 days' && String(age.className).includes('is-overdue'), 'overdue ' + (age && age.textContent + '|' + age.className));
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ due: '2026-11-08' }), null);
    assert(findByCls(row, 'sauce-task-age').textContent === '1 day', 'singular');
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ due: '2026-10-10' }), null);
    age = findByCls(row, 'sauce-task-age');
    assert(age && age.textContent === 'since Oct 10' && String(age.className).includes('is-stale'), 'stale ' + (age && age.textContent + '|' + age.className));
    for (const due of ['2026-11-09', '2026-11-12', '']) {
      row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ due }), null);
      assert(!findByCls(row, 'sauce-task-age'), 'no age chip for due=' + due);
    }
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ due: '2026-11-02' }), null, { showAge: false });
    assert(!findByCls(row, 'sauce-task-age'), 'showAge:false hides it');
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask({ due: '2026-11-02', status: 'done' }), null);
    assert(!findByCls(row, 'sauce-task-age'), 'done rows never show age');
  });

  await ok('RD-ROW-MENU', async () => {
    rowEnv();
    const menus = [];
    stubMenu(menus);
    try {
      const calls = [];
      const moves = [];
      const deleted = [];
      await withReschedule(async (...a) => { calls.push(a); return { ok: true, due: a[2] }; }, async () => {
        const TD = { open() {}, confirmDelete: async (p) => { deleted.push(p); return { ok: false }; } };
        let row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), TD, { viewedDay: '2026-11-09' });
        const more = findByCls(row, 'sauce-task-action-more');
        assert(more && more.attributes['aria-label'] === 'More actions', 'more button');
        assert(!findByCls(row, 'sauce-task-action-delete'), 'standalone trash button is gone from open rows');
        await fireClick(more);
        assert(menus.length === 1 && menus[0].shown, 'menu opened');
        assert(menus[0].opts.anchor === more, 'menu anchored on the more button');
        assert(menus[0].items[2].danger === true && !menus[0].items[0].danger, 'only Delete is danger');
        eq(menus[0].items.map((i) => i.title), ['Move to backlog', 'Pick date…', 'Delete'], 'items without onMove');
        await menus[0].items[0].handler();
        assert(calls.length === 1 && calls[0][2] === '', 'backlog -> reschedule(..., "")');
        await menus[0].items[2].handler();
        assert(deleted.length === 1 && deleted[0] === 'spice/tasks/row.md', 'Delete reuses confirmDelete flow');

        row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), TD, { onMove: (t, d) => moves.push(d) });
        await fireClick(findByCls(row, 'sauce-task-action-more'));
        const m = menus[1];
        eq(m.items.map((i) => i.title), ['Move to backlog', 'Pick date…', 'Move up', 'Move down', 'Delete'], 'items with onMove');
        await m.items[2].handler();
        await m.items[3].handler();
        eq(moves, [-1, 1], 'onMove directions');
      });
    } finally { delete global.window.customJS.MenuPopover; }
  });

  await ok('RD-ROW-PICKDATE', async () => {
    rowEnv();
    const menus = [];
    stubMenu(menus);
    try {
      const calls = [];
      const done = [];
      await withReschedule(async (...a) => { calls.push(a); return { ok: true, due: a[2] }; }, async () => {
        const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null, { viewedDay: '2026-11-09', onRescheduled: (t, d) => done.push(d) });
        await fireClick(findByCls(row, 'sauce-task-action-more'));
        await menus[0].items.find((i) => i.title === 'Pick date…').handler();
        const input = findByCls(row, 'sauce-task-datepick');
        assert(input && input.type === 'date', 'date input anchored in the row');
        input.value = '2026-12-01';
        await fireEvent(input, 'change');
        assert(calls.length === 1 && calls[0][2] === '2026-12-01' && calls[0][3] === '2026-11-09', 'reschedule args');
        assert(done.length === 1 && done[0] === '2026-12-01', 'onRescheduled');
        assert(!findByCls(row, 'sauce-task-datepick'), 'popover removed after pick');
      });
    } finally { delete global.window.customJS.MenuPopover; }
  });

  await ok('RD-ROW-PICKDATE-FOCUS-AND-OUTSIDE', async () => {
    rowEnv();
    const menus = [];
    stubMenu(menus);
    const listeners = {};
    const prevDoc = global.document;
    global.document = {
      addEventListener(n, fn) { listeners[n] = fn; },
      removeEventListener(n, fn) { if (listeners[n] === fn) delete listeners[n]; },
    };
    try {
      const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null);
      const orig = row.createEl;
      row.createEl = function (t, o) {
        const c = orig.call(this, t, o);
        if (t === 'input' && o && o.cls === 'sauce-task-datepick') c.showPicker = () => { throw new Error('picker unsupported'); };
        return c;
      };
      await fireClick(findByCls(row, 'sauce-task-action-more'));
      await menus[0].items.find((i) => i.title === 'Pick date…').handler();
      const input = findByCls(row, 'sauce-task-datepick');
      assert(input, 'popover rendered');
      assert(input._focusCount === 1, 'focus is the fallback when showPicker throws');
      await new Promise((r) => setTimeout(r, 5));
      assert(typeof listeners.pointerdown === 'function', 'outside-click listener registered');
      listeners.pointerdown({ target: input });
      assert(findByCls(row, 'sauce-task-datepick'), 'click inside the popover keeps it open');
      listeners.pointerdown({ target: makeTreeNode('div') });
      assert(!findByCls(row, 'sauce-task-datepick'), 'outside click closes it');
      assert(!listeners.pointerdown, 'listener removed on close');
    } finally {
      if (prevDoc === undefined) delete global.document; else global.document = prevDoc;
      delete global.window.customJS.MenuPopover;
    }
  });

  await ok('RD-ROW-MENU-COLD', async () => {
    for (const MenuPopover of [undefined, {}, { open: 'nope' }, { open() { throw new Error('boom'); } }]) {
      rowEnv();
      if (MenuPopover) global.window.customJS.MenuPopover = MenuPopover;
      const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null);
      const more = findByCls(row, 'sauce-task-action-more');
      assert(more, 'more button renders without MenuPopover');
      let threw = false;
      try { await fireClick(more); } catch (_e) { threw = true; }
      assert(!threw, 'click is a no-op / never throws for ' + JSON.stringify(MenuPopover && Object.keys(MenuPopover)));
    }
  });

  await ok('RD-ROW-SELECT', async () => {
    rowEnv();
    let row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), null);
    assert(!findByCls(row, 'sauce-task-select') && !findByCls(row, 'sauce-task-drag'), 'no select/drag by default');
    const seen = [];
    const task = openTask();
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), task, null, { selectable: true, selected: true, onSelect: (t, c) => seen.push([t, c]) });
    const sel = findByCls(row, 'sauce-task-select');
    assert(sel && sel.type === 'checkbox' && sel.attributes['aria-label'] === 'Select task', 'checkbox rendered');
    assert(sel.checked === true, 'selected option pre-checks');
    sel.checked = false;
    fireEvent(sel, 'change');
    assert(seen.length === 1 && seen[0][0] === task && seen[0][1] === false, 'onSelect(task, checked)');
    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), task, null, { selectable: true });
    assert(findByCls(row, 'sauce-task-select').checked === false, 'unselected by default');

    row = TaskTodayList.renderTaskRow(makeTreeNode('div'), task, null, { dragHandle: true });
    const drag = findByCls(row, 'sauce-task-drag');
    assert(drag && drag.draggable === true && drag.dataset.path === task.path, 'drag handle');
  });

  await ok('RD-ROW-ONDONE onDone fires once after a successful checkbox completion, never on failure', async () => {
    rowEnv();
    const run = async (markDone, withHook) => {
      const seen = [];
      const marked = [];
      const td = { open() {}, async markDone(p) { marked.push(p); return markDone(p); } };
      const list = makeTreeNode('div');
      const task = openTask();
      const row = TaskTodayList.renderTaskRow(list, task, td, withHook ? { onDone: (t) => seen.push(t) } : {});
      const cb = findByCls(row, 'sauce-task-today-cbwrap').children[0];
      cb.checked = true;
      let threw = false;
      try { await fireEvent(cb, 'change'); } catch (_e) { threw = true; }
      return { seen, marked, task, row, list, threw };
    };
    const okRun = await run(async () => ({ ok: true }), true);
    assert(okRun.marked.length === 1 && okRun.marked[0] === 'spice/tasks/row.md', 'markDone called with the path');
    assert(okRun.seen.length === 1 && okRun.seen[0] === okRun.task, 'onDone(task) once on success');
    assert(!okRun.list.children.includes(okRun.row), 'row stays removed on success');

    const refused = await run(async () => ({ ok: false, reason: 'write failed' }), true);
    assert(refused.seen.length === 0, 'no onDone when markDone refuses');
    assert(refused.list.children.includes(refused.row), 'row restored on refusal');

    const thrown = await run(async () => { throw new Error('boom'); }, true);
    assert(thrown.seen.length === 0 && !thrown.threw, 'no onDone and no throw when markDone throws');

    const bare = await run(async () => ({ ok: true }), false);
    assert(!bare.threw && bare.marked.length === 1, 'callers without onDone are unaffected');

    rowEnv();
    const td = { open() {}, async markDone() { return { ok: true }; } };
    const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), openTask(), td, { onDone: () => { throw new Error('hook'); } });
    const cb = findByCls(row, 'sauce-task-today-cbwrap').children[0];
    let threw = false;
    try { await fireEvent(cb, 'change'); } catch (_e) { threw = true; }
    assert(!threw, 'a throwing onDone never escapes the gesture');
  });

  await ok('RD-DIALOG-SLUGIFY _slugify is reachable through the stored instance', async () => {
    assert(TaskDialog._slugify('Zeta Works') === 'zeta-works', 'instance delegate: ' + TaskDialog._slugify('Zeta Works'));
    assert(TaskDialog._slugify('  Q3 / Launch!! ') === 'q3-launch');
  });

  await ok('RD-ORDER-PURE moveInOrder / reorderInOrder return new lists and never mutate', async () => {
    const list = ['a', 'b', 'c'].map((p) => ({ path: p }));
    const paths = (l) => (l ? l.map((t) => t.path) : null);
    eq(paths(TaskTodayList.moveInOrder(list, 'b', -1)), ['b', 'a', 'c']);
    eq(paths(TaskTodayList.moveInOrder(list, 'b', 1)), ['a', 'c', 'b']);
    eq(TaskTodayList.moveInOrder(list, 'a', -1), null, 'top edge');
    eq(TaskTodayList.moveInOrder(list, 'c', 1), null, 'bottom edge');
    eq(TaskTodayList.moveInOrder(list, 'zz', 1), null, 'unknown path');
    eq(paths(TaskTodayList.reorderInOrder(list, 'c', 'a')), ['c', 'a', 'b']);
    eq(paths(TaskTodayList.reorderInOrder(list, 'a', 'c')), ['b', 'c', 'a']);
    eq(TaskTodayList.reorderInOrder(list, 'a', 'a'), null);
    eq(TaskTodayList.reorderInOrder(null, 'a', 'b'), null);
    eq(paths(list), ['a', 'b', 'c'], 'input untouched');
  });

  await ok('RD-ORDER-APPLY applyManualOrder: optimistic ranks, sequential writes, restore + one Notice on silent failure, lock', async () => {
    const tasks = [{ path: 'b', rank: 2 }, { path: 'a', rank: 1 }, { path: 'c', rank: null }];
    const writes = [];
    const notices = [];
    const lockSet = new Set();
    let repaints = 0;
    let lockedDuringWrite = false;
    const res = await TaskTodayList.applyManualOrder(tasks, {
      async setFields(p, fields) {
        lockedDuringWrite = lockedDuringWrite || lockSet.has('k');
        writes.push([p, fields.rank]);
        return p === 'a' ? { ok: false, reason: 'task file not found' } : { ok: true };
      },
      renumber: (p, r) => TaskEntity.renumber(p, r),
      repaint() { repaints += 1; },
      notice: (m) => notices.push(m),
      lock: { set: lockSet, key: 'k' },
    });
    eq(writes, [['b', 1], ['a', 2], ['c', 3]], 'only changed ranks, in order');
    eq(res, { written: ['b', 'c'], failed: ['a'] });
    eq(tasks.map((t) => t.rank), [1, 1, 3], 'failed task keeps its prior rank');
    assert(repaints === 2, 'optimistic repaint + one after failure: ' + repaints);
    eq(notices, ['Could not save the new task order']);
    assert(lockedDuringWrite && !lockSet.has('k'), 'lock held while writing, released after');

    lockSet.add('k');
    const refused = await TaskTodayList.applyManualOrder([{ path: 'x', rank: null }], {
      setFields: async () => { throw new Error('must not write'); },
      renumber: (p, r) => TaskEntity.renumber(p, r),
      lock: { set: lockSet, key: 'k' },
    });
    assert(refused === null && lockSet.has('k'), 'refused while locked; foreign lock untouched');

    const quiet = [];
    const same = await TaskTodayList.applyManualOrder([{ path: 'a', rank: 1 }], {
      setFields: async () => { throw new Error('must not write'); },
      renumber: (p, r) => TaskEntity.renumber(p, r),
      notice: (m) => quiet.push(m),
    });
    assert(same === null && quiet.length === 0, 'nothing changed: no write, no notice');

    const noticed = [];
    await TaskTodayList.applyManualOrder([{ path: 'q', rank: null }], {
      setFields: async () => ({ ok: false, reason: 'disk full' }),
      renumber: (p, r) => TaskEntity.renumber(p, r),
      notice: (m) => noticed.push(m),
    });
    eq(noticed, [], 'a noticed failure already told the user');

    const thrown = new Set();
    let threw = false;
    try {
      await TaskTodayList.applyManualOrder([{ path: 'q', rank: null }], {
        setFields: async () => ({ ok: true }),
        renumber: () => { throw new Error('boom'); },
        lock: { set: thrown, key: 'k' },
      });
    } catch (_e) { threw = true; }
    assert(!threw && !thrown.has('k'), 'a throwing renumber never escapes and releases the lock');
  });

  await ok('RD-ORDER-CONTROLLER manualOrder only moves rows still attached', async () => {
    const tasks = ['a', 'b', 'c'].map((p) => ({ path: p, rank: null }));
    const rows = new Map(tasks.map((t) => [t.path, { parentNode: {} }]));
    rows.get('b').parentNode = null;
    const writes = [];
    const order = TaskTodayList.manualOrder({
      order: () => tasks,
      rows,
      setFields: async (p, f) => { writes.push([p, f.rank]); return { ok: true }; },
      renumber: (p, r) => TaskEntity.renumber(p, r),
    });
    await order.move(tasks[2], -1);
    eq(writes, [['c', 1], ['a', 2]], 'detached b is left out');
    writes.length = 0;
    assert(order.reorder('a', 'b') === undefined && writes.length === 0, 'a detached target is not a move');
    assert(order.move({ path: 'c' }, -1) !== undefined, 'returns the apply promise for a real move');
  });

  await ok('RD-ROW-COMPAT', async () => {
    rowEnv();
    const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), { title: 'x', path: 'p.md' }, null);
    assert(findByCls(row, 'sauce-task-action-delete') && findByCls(row, 'sauce-task-action-edit'), 'non-open rows keep edit + delete buttons');
    assert(findByCls(row, 'sauce-task-actions') && findByCls(row, 'sauce-task-today-actions'), 'actions container carries both classes');
  });

  const TaskDoneArchive = new (loadClass('blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive'))();
  const allByCls = (node, cls, out) => {
    out = out || [];
    for (const c of (node && node.children) || []) {
      if (String((c && (c.className || c.cls)) || '').split(/\s+/).includes(cls)) out.push(c);
      allByCls(c, cls, out);
    }
    return out;
  };
  const textOf = (node) => {
    if (!node) return '';
    let t = node.tagName === '#text' ? node.textContent : (node.children && node.children.length ? '' : (node._textContent || ''));
    for (const c of node.children || []) t += textOf(c);
    return t;
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  const DONE_PAGES = [
    { title: 'Ship invoices', completed_at: '2026-11-06T09:00:00-07:00', project: '[[Alpha]]', source: 'daily', body: 'Sent the quarterly invoices' },
    { title: 'Call vendor', completed_at: '2026-11-06T15:00:00-07:00', project: '[[Beta]]', source: 'meeting', body: 'Discussed the renewal pricing' },
    { title: 'Water plants', completed_at: '2026-11-03T10:00:00-07:00', project: null, source: 'manual', body: 'Front office ferns' },
    { title: 'Old thing', completed_at: '2026-10-20T10:00:00-07:00', project: '[[Alpha]]', source: 'daily', body: 'Archive cleanup' },
  ].map((t, i) => ({
    type: 'task', status: 'done', title: t.title, completed_at: t.completed_at, project: t.project, source: t.source, _body: t.body,
    file: { path: 'spice/tasks/_done/' + t.title + '.md', mtime: 1000 + i },
  }));
  const doneEnv = (o) => {
    o = o || {};
    const store = Object.assign({}, o.store || {});
    const log = { notices: [], reopen: [], menus: [], reads: [], clip: [] };
    const pages = o.pages || DONE_PAGES;
    const reopenImpl = o.reopen || (async (p) => ({ ok: true, path: 'spice/tasks/' + p.split('/').pop() }));
    const files = new Map(pages.map((p) => [p.file.path, { path: p.file.path, stat: { mtime: p.file.mtime }, _body: p._body }]));
    global.Notice = function (msg) { log.notices.push(String(msg)); };
    global.window = {
      customJS: {
        TaskEntity, TaskTodayList,
        TaskDialog: { reopen: async (p) => { log.reopen.push(p); return reopenImpl(p); } },
        RenderSafe: { page: () => ({}) },
        MenuPopover: { open(entries, opts) { log.menus.push({ entries, opts }); } },
      },
      moment: () => ({ format: () => '2026-11-09' }),
      localStorage: o.noStorage ? undefined : {
        getItem(k) { if (o.throwStorage) throw new Error('blocked'); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem(k, v) { if (o.throwStorage) throw new Error('blocked'); store[k] = String(v); },
      },
      app: {
        vault: {
          getAbstractFileByPath: (p) => files.get(p) || null,
          async cachedRead(f) {
            log.reads.push(f.path);
            if (o.failRead && o.failRead.includes(f.path)) throw new Error('read failed');
            if (o.readGate) await o.readGate;
            return '---\ntitle: x\n---\n' + f._body;
          },
        },
        workspace: { openLinkText() {} },
      },
    };
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: o.noClipboard ? {} : { clipboard: { async writeText(t) { if (o.clipFail) throw new Error('denied'); log.clip.push(t); } } },
    });
    const container = makeTreeNode('div');
    const dv = {
      container,
      pages: () => ({ where: (fn) => { const arr = pages.filter(fn); return { array: () => arr }; } }),
    };
    return { dv, container, log, store, files };
  };
  const mountDone = async (env) => { await TaskDoneArchive.render(env.dv); await settle(); return env.container; };
  const headerOf = (c) => textOf(findByCls(c, 'sauce-done-header'));
  const pill = (c, label) => allByCls(c, 'sauce-done-pill').find((b) => b.textContent === label);
  const clearBodyCache = () => { const k = TaskDoneArchive.constructor; if (k._bodyCache) k._bodyCache.clear(); };

  await ok('RD-DL-RENDER default last-week: header, pills, bars, project panel, grouped Reopen rows', async () => {
    const env = doneEnv();
    const c = await mountDone(env);
    assert(headerOf(c) === '3 done Nov 2 – 8, across 2 projects', 'header: ' + headerOf(c));
    const pills = allByCls(c, 'sauce-done-pill');
    assert(pills.map((b) => b.textContent).join('|') === 'Today|Yesterday|This week|Last week|This month|Pick range…', 'pills ' + pills.map((b) => b.textContent));
    assert(pill(c, 'Last week').attributes['aria-pressed'] === 'true' && pill(c, 'Today').attributes['aria-pressed'] === 'false', 'pressed state');
    const bars = allByCls(c, 'sauce-done-bar');
    assert(bars.length === 7 && bars.map((b) => b.attributes['aria-label']).join(',') === '0 done,1 done,0 done,0 done,2 done,0 done,0 done', 'bar labels ' + bars.map((b) => b.attributes['aria-label']));
    const projRows = allByCls(c, 'sauce-done-project-row');
    assert(projRows.length === 3 && textOf(projRows[2]).startsWith('No project'), 'project panel keeps a No project row, last: ' + projRows.map(textOf));
    const days = allByCls(c, 'sauce-done-day').map((d) => textOf(d));
    assert(days.length === 2 && /Fri Nov 6/.test(days[0]) && /Tue Nov 3/.test(days[1]), 'day headings ' + days);
    const rows = allByCls(c, 'sauce-today-done-row');
    assert(rows.length === 3, 'three rows ' + rows.length);
    assert(textOf(rows[0]).includes('Call vendor') && textOf(rows[1]).includes('Ship invoices'), 'newest first within the day');
    const btns = allByCls(c, 'sauce-today-undo');
    assert(btns.length === 3 && btns.every((b) => b.textContent === 'Reopen'), 'Reopen buttons');
    assert(allByCls(c, 'sauce-today-done-project').map((x) => x.textContent).join(',') === 'Beta,Alpha', 'project chips');
    assert(allByCls(c, 'sauce-done-search').length === 1, 'exactly one search box');
  });

  await ok('RD-DL-PRESET picking a preset repaints and persists it; stored/invalid/blocked storage are tolerated', async () => {
    let env = doneEnv();
    let c = await mountDone(env);
    fireClick(pill(c, 'Today'));
    await settle();
    assert(headerOf(c) === '0 done today, across 0 projects', 'today header ' + headerOf(c));
    assert(env.store['sauce-done-log:range'] === 'today', 'persisted ' + JSON.stringify(env.store));
    assert(allByCls(c, 'sauce-today-done-row').length === 0 && allByCls(c, 'sauce-done-empty').length === 1, 'empty state');
    assert(pill(c, 'Today').attributes['aria-pressed'] === 'true', 'pressed follows');
    fireClick(pill(c, 'This month'));
    await settle();
    assert(headerOf(c) === '3 done in November, across 2 projects', 'month header ' + headerOf(c));
    env = doneEnv({ store: { 'sauce-done-log:range': 'this-month' } });
    c = await mountDone(env);
    assert(pill(c, 'This month').attributes['aria-pressed'] === 'true', 'stored preset restored');
    env = doneEnv({ store: { 'sauce-done-log:range': 'bogus' } });
    c = await mountDone(env);
    assert(pill(c, 'Last week').attributes['aria-pressed'] === 'true', 'invalid stored falls back to last-week');
    env = doneEnv({ throwStorage: true });
    c = await mountDone(env);
    fireClick(pill(c, 'Yesterday'));
    await settle();
    assert(/yesterday/.test(headerOf(c)), 'blocked storage still works');
    env = doneEnv({ noStorage: true });
    c = await mountDone(env);
    assert(headerOf(c).startsWith('3 done'), 'no storage at all');
  });

  await ok('RD-DL-CUSTOM Pick range uses two date inputs; invalid or empty input keeps the previous range', async () => {
    const env = doneEnv();
    const c = await mountDone(env);
    assert(!allByCls(c, 'sauce-done-range-from').length, 'inputs hidden until Pick range');
    fireClick(pill(c, 'Pick range…'));
    await settle();
    const from = allByCls(c, 'sauce-done-range-from')[0];
    const to = allByCls(c, 'sauce-done-range-to')[0];
    assert(from && to && from.type === 'date' && to.type === 'date', 'two native date inputs');
    assert(from.value === '2026-11-02' && to.value === '2026-11-08', 'seeded with the current range: ' + from.value + ' ' + to.value);
    from.value = '2026-10-19'; to.value = '2026-10-21';
    fireEvent(to, 'change');
    await settle();
    assert(headerOf(c) === '1 done Oct 19 – 21, across 1 project', 'custom header ' + headerOf(c));
    assert(pill(c, 'Pick range…').attributes['aria-pressed'] === 'true', 'custom pill pressed');
    assert(!('sauce-done-log:range' in env.store), 'custom range is not persisted');
    const to2 = allByCls(c, 'sauce-done-range-to')[0];
    to2.value = '2026-10-01';
    fireEvent(to2, 'change');
    await settle();
    assert(headerOf(c).includes('Oct 19 – 21'), 'to before from keeps the previous range: ' + headerOf(c));
    assert(allByCls(c, 'sauce-done-range-to')[0].value === '2026-10-21', 'input reverts');
    const from3 = allByCls(c, 'sauce-done-range-from')[0];
    from3.value = '';
    fireEvent(from3, 'change');
    await settle();
    assert(headerOf(c).includes('Oct 19 – 21') && allByCls(c, 'sauce-done-range-from')[0].value === '2026-10-19', 'empty keeps the previous range');
  });

  await ok('RD-DL-REOPEN Reopen hands the path to TaskDialog.reopen, drops the row on success, Notice only when silent', async () => {
    let env = doneEnv();
    let c = await mountDone(env);
    const rowBtn = allByCls(c, 'sauce-today-undo').find((b) => b.attributes['aria-label'] === 'Reopen: Ship invoices');
    await fireClick(rowBtn);
    await settle();
    assert(env.log.reopen.join() === 'spice/tasks/_done/Ship invoices.md', 'reopen path ' + env.log.reopen);
    assert(allByCls(c, 'sauce-today-done-row').length === 2 && headerOf(c).startsWith('2 done'), 'row gone, header recounted: ' + headerOf(c));
    assert(env.log.notices.length === 0, 'success is quiet');

    env = doneEnv({ reopen: async () => ({ ok: false, reason: 'not-done' }) });
    c = await mountDone(env);
    const btn = allByCls(c, 'sauce-today-undo')[0];
    await fireClick(btn);
    await settle();
    assert(allByCls(c, 'sauce-today-done-row').length === 3, 'failed reopen keeps the row');
    assert(env.log.notices.length === 1 && /Could not reopen task: not-done/.test(env.log.notices[0]), 'silent -> Notice: ' + env.log.notices);
    assert(!btn.disabled, 'button usable again');

    env = doneEnv({ reopen: async () => ({ ok: false, reason: 'write failed' }) });
    c = await mountDone(env);
    await fireClick(allByCls(c, 'sauce-today-undo')[0]);
    await settle();
    assert(env.log.notices.length === 0, 'noticed outcomes are not double-reported');

    env = doneEnv({ reopen: async () => ({ ok: false, no_op: true, reason: 'in-flight' }) });
    c = await mountDone(env);
    await fireClick(allByCls(c, 'sauce-today-undo')[0]);
    await settle();
    assert(env.log.notices.length === 0 && allByCls(c, 'sauce-today-done-row').length === 3, 'skipped is quiet');
  });

  await ok('RD-DL-SEARCH title filters at once; notes bodies load lazily (>=3 chars, range files only), cached per path+mtime', async () => {
    clearBodyCache();
    const env = doneEnv();
    const c = await mountDone(env);
    const input = allByCls(c, 'sauce-done-search')[0];
    input.value = 'wa';
    fireEvent(input, 'input');
    await settle();
    assert(allByCls(c, 'sauce-today-done-row').length === 1 && /Water plants/.test(textOf(allByCls(c, 'sauce-today-done-row')[0])), 'two chars match titles only');
    assert(env.log.reads.length === 0, 'no body reads below 3 characters');
    input.value = 'renewal';
    fireEvent(input, 'input');
    await settle();
    const rows = allByCls(c, 'sauce-today-done-row');
    assert(rows.length === 1 && /Call vendor/.test(textOf(rows[0])), 'body-only match found: ' + rows.length);
    const want = ['Call vendor', 'Ship invoices', 'Water plants'].map((t) => 'spice/tasks/_done/' + t + '.md').sort().join('|');
    assert(env.log.reads.slice().sort().join('|') === want, 'reads only range files: ' + env.log.reads);
    assert(!allByCls(c, 'sauce-done-loading').length, 'loading indicator cleared');
    const readsBefore = env.log.reads.length;
    input.value = 'renewals';
    fireEvent(input, 'input');
    await settle();
    input.value = 'renewal';
    fireEvent(input, 'input');
    await settle();
    assert(env.log.reads.length === readsBefore, 'cache hit per path+mtime: ' + env.log.reads.length + ' vs ' + readsBefore);
    env.files.get('spice/tasks/_done/Call vendor.md').stat.mtime = 9999;
    const c2 = await mountDone(env);
    const input2 = allByCls(c2, 'sauce-done-search')[0];
    input2.value = 'renewal';
    fireEvent(input2, 'input');
    await settle();
    assert(env.log.reads.length === readsBefore + 1, 'mtime change re-reads only that file: ' + env.log.reads.length);
  });

  await ok('RD-DL-SEARCH shows Searching notes… while loading and falls back to title-only when a read fails', async () => {
    clearBodyCache();
    let release;
    const gate = new Promise((r) => { release = r; });
    let env = doneEnv({ readGate: gate });
    let c = await mountDone(env);
    const input = allByCls(c, 'sauce-done-search')[0];
    input.value = 'renewal';
    fireEvent(input, 'input');
    await settle();
    assert(allByCls(c, 'sauce-done-loading').length === 1 && textOf(allByCls(c, 'sauce-done-loading')[0]) === 'Searching notes…', 'loading shown');
    release();
    await settle();
    assert(!allByCls(c, 'sauce-done-loading').length && allByCls(c, 'sauce-today-done-row').length === 1, 'resolved');

    clearBodyCache();
    env = doneEnv({ failRead: ['spice/tasks/_done/Call vendor.md'] });
    c = await mountDone(env);
    const i2 = allByCls(c, 'sauce-done-search')[0];
    i2.value = 'vendor';
    fireEvent(i2, 'input');
    await settle();
    assert(allByCls(c, 'sauce-today-done-row').length === 1, 'failed read still matches by title');
    i2.value = 'renewal';
    fireEvent(i2, 'input');
    await settle();
    assert(allByCls(c, 'sauce-today-done-row').length === 0, 'failed read has no body match, no throw');
  });

  await ok('RD-DL-HEADER-PROJECTS counts named projects only; unprojected-only range says 0 projects; one says "1 project"', async () => {
    const only = DONE_PAGES.filter((p) => p.title === 'Water plants');
    let c = await mountDone(doneEnv({ pages: only }));
    assert(headerOf(c) === '1 done Nov 2 – 8, across 0 projects', 'unprojected only: ' + headerOf(c));
    assert(allByCls(c, 'sauce-done-project-row').length === 1, 'the No project row is still listed');
    const one = DONE_PAGES.filter((p) => p.title !== 'Call vendor');
    c = await mountDone(doneEnv({ pages: one }));
    assert(headerOf(c) === '2 done Nov 2 – 8, across 1 project', 'singular: ' + headerOf(c));
  });

  await ok('RD-DL-SEARCH overlapping queries: the list follows the latest query and the indicator clears', async () => {
    clearBodyCache();
    let release;
    const gate = new Promise((r) => { release = r; });
    const env = doneEnv({ readGate: gate });
    const c = await mountDone(env);
    const input = allByCls(c, 'sauce-done-search')[0];
    input.value = 'renewal';
    fireEvent(input, 'input');
    await settle();
    assert(allByCls(c, 'sauce-done-loading').length === 1, 'first query is loading');
    input.value = 'ferns';
    fireEvent(input, 'input');
    await settle();
    release();
    await settle();
    const rows = allByCls(c, 'sauce-today-done-row');
    assert(rows.length === 1 && /Water plants/.test(textOf(rows[0])), 'list matches the latest query: ' + rows.map(textOf));
    assert(!allByCls(c, 'sauce-done-loading').length, 'indicator cleared');
    assert(/1 of 3/.test(textOf(findByCls(c, 'sauce-done-showing'))), 'showing line follows the latest query');
  });

  await ok('RD-DL-FILTERS Project and Source menus filter the list; header keeps the range total', async () => {
    const env = doneEnv();
    const c = await mountDone(env);
    fireClick(allByCls(c, 'sauce-done-project-filter')[0]);
    const pm = env.log.menus[0];
    assert(pm.entries.map((e) => e.label).join('|') === 'All projects|Alpha|Beta|No project', 'project entries ' + pm.entries.map((e) => e.label));
    pm.entries[2].onSelect();
    await settle();
    assert(allByCls(c, 'sauce-today-done-row').length === 1 && /Call vendor/.test(textOf(allByCls(c, 'sauce-today-done-row')[0])), 'project filter applied');
    assert(headerOf(c).startsWith('3 done'), 'header is the range total');
    assert(/Beta/.test(allByCls(c, 'sauce-done-project-filter')[0].textContent), 'button shows selection');
    assert(/1 of 3/.test(textOf(findByCls(c, 'sauce-done-showing'))), 'showing line');
    fireClick(allByCls(c, 'sauce-done-source-filter')[0]);
    const sm = env.log.menus[1];
    assert(sm.entries.map((e) => e.label).join('|') === 'All sources|daily|meeting|project|trip|manual', 'source entries ' + sm.entries.map((e) => e.label));
    sm.entries[1].onSelect();
    await settle();
    assert(allByCls(c, 'sauce-today-done-row').length === 0 && allByCls(c, 'sauce-done-empty').length === 1, 'AND of both filters');
  });

  await ok('RD-DL-COPY Copy as standup writes the visible list as markdown and reports with a Notice', async () => {
    let env = doneEnv();
    let c = await mountDone(env);
    await fireClick(allByCls(c, 'sauce-done-copy')[0]);
    await settle();
    assert(env.log.clip.length === 1, 'one write');
    assert(env.log.clip[0] === '**Fri Nov 6**\n- Call vendor (Beta)\n- Ship invoices (Alpha)\n\n**Tue Nov 3**\n- Water plants', JSON.stringify(env.log.clip[0]));
    assert(env.log.notices.join() === 'Copied 3 tasks', 'notice ' + env.log.notices);

    env = doneEnv();
    c = await mountDone(env);
    const input = allByCls(c, 'sauce-done-search')[0];
    input.value = 'plants';
    fireEvent(input, 'input');
    await settle();
    await fireClick(allByCls(c, 'sauce-done-copy')[0]);
    await settle();
    assert(env.log.clip[0] === '**Tue Nov 3**\n- Water plants' && env.log.notices.join() === 'Copied 1 task', 'filters apply: ' + JSON.stringify(env.log));

    env = doneEnv({ clipFail: true });
    c = await mountDone(env);
    await fireClick(allByCls(c, 'sauce-done-copy')[0]);
    await settle();
    assert(env.log.notices.join() === 'Could not copy', 'failure notice ' + env.log.notices);

    env = doneEnv({ noClipboard: true });
    c = await mountDone(env);
    await fireClick(allByCls(c, 'sauce-done-copy')[0]);
    await settle();
    assert(env.log.notices.join() === 'Could not copy', 'missing clipboard notice ' + env.log.notices);
    try { delete global.navigator; } catch (_e) { /* test-only restore */ }
  });

  await ok('RD-DL-COLD render is quiet without dependencies, inside an embed, and does not stack on dual fire', async () => {
    const env = doneEnv();
    global.window.customJS.TaskTodayList = undefined;
    await TaskDoneArchive.render(env.dv);
    assert(!allByCls(env.container, 'sauce-done-log').length, 'no UI without TaskTodayList');
    const env2 = doneEnv();
    env2.container.closest = () => ({});
    await TaskDoneArchive.render(env2.dv);
    assert(env2.container.children.length === 0, 'embed returns early');
    const env3 = doneEnv();
    await Promise.all([TaskDoneArchive.render(env3.dv), TaskDoneArchive.render(env3.dv)]);
    await settle();
    assert(allByCls(env3.container, 'sauce-done-log').length === 1, 'dual fire renders once');
  });

  global.Notice = prevNotice;

  console.log(passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
