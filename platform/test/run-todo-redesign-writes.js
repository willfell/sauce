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

  await ok('RD-ROW-COMPAT', async () => {
    rowEnv();
    const row = TaskTodayList.renderTaskRow(makeTreeNode('div'), { title: 'x', path: 'p.md' }, null);
    assert(findByCls(row, 'sauce-task-action-delete') && findByCls(row, 'sauce-task-action-edit'), 'non-open rows keep edit + delete buttons');
    assert(findByCls(row, 'sauce-task-actions') && findByCls(row, 'sauce-task-today-actions'), 'actions container carries both classes');
  });

  global.Notice = prevNotice;

  console.log(passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
