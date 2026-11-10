#!/usr/bin/env node
/**
 * run-task-note-card.js — the task note card (TaskNoteView) on the To-Do design.
 * The header is a title over one row of chips, links are rows with their site,
 * subtasks show a progress bar, open shared rows, "+ Add subtask…" and done
 * rows with Reopen (five, then "Show N more"), and the footer pairs Mark done
 * or Reopen with Edit. A subtask's own note links back to its parent. The
 * stylesheet carries the phone rules. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const loadClass = (rel, name) => new Function(`${read(rel)}\nreturn ${name};`)();

function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, dataset: {}, _text: '', _listeners: {}, disabled: false, placeholder: '',
    classList: {
      add: (...c) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); el.className = [...s].join(' '); },
      contains: (x) => el.className.split(/\s+/).includes(x),
    },
    createEl(t, o) {
      const c = makeEl(t, (o && o.cls) || '');
      if (o && o.text != null) c.textContent = o.text;
      if (o && o.type) c.type = o.type;
      if (o && o.href) c.attributes.href = o.href;
      return this.appendChild(c);
    },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(t, fn) { this._listeners[t] = fn; },
    insertAdjacentHTML() {},
    focus() {},
    closest() { return null; },
    querySelector(sel) {
      if (sel === 'span') return all(this).find((n) => n.tagName === 'SPAN') || null;
      return null;
    },
    querySelectorAll(sel) {
      const m = /^:scope\s*>\s*\.([\w-]+)$/.exec(sel);
      return m ? this.children.filter((c) => c.classList.contains(m[1])) : [];
    },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
  };
  return el;
}
const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
const byClass = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
const one = (root, cls) => byClass(root, cls)[0] || null;

const TNV = loadClass('mechanisms/task-entity/task-note-view.js', 'TaskNoteView');
const TaskEntity = loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity');

ok('TNC-DUE-TODAY an open task due today reads "Due today" in the accent tone',
  JSON.stringify(TNV._dueChip('2026-11-10', '2026-11-10', 'open')) === JSON.stringify({ text: 'Due today', tone: 'accent' }));
ok('TNC-DUE-TOMORROW tomorrow reads "Due tomorrow"', TNV._dueChip('2026-11-11', '2026-11-10', 'open').text === 'Due tomorrow');
ok('TNC-DUE-OVERDUE an open task past its date reads "Overdue · N days" in the danger tone, singular for one',
  JSON.stringify(TNV._dueChip('2026-11-08', '2026-11-10', 'open')) === JSON.stringify({ text: 'Overdue · 2 days', tone: 'danger' })
  && TNV._dueChip('2026-11-09', '2026-11-10', 'open').text === 'Overdue · 1 day');
ok('TNC-DUE-DONE a done task is never overdue',
  TNV._dueChip('2026-11-08', '2026-11-10', 'done').tone === '' && !/Overdue/.test(TNV._dueChip('2026-11-08', '2026-11-10', 'done').text));
ok('TNC-DUE-LATER a later date reads weekday and short date, with the year only when it differs',
  TNV._dueChip('2026-11-12', '2026-11-10', 'open').text === 'Due Thu, Nov 12'
  && TNV._dueChip('2027-01-05', '2026-11-10', 'open').text === 'Due Tue, Jan 5, 2027');
ok('TNC-DUE-NONE no due date → no chip', TNV._dueChip('', '2026-11-10', 'open') === null);
ok('TNC-SHORT short dates drop the current year and read ISO timestamps',
  TNV._shortDate('2026-11-10T14:06:43-07:00', '2026-11-10') === 'Nov 10' && TNV._shortDate('2025-03-02', '2026-11-10') === 'Mar 2, 2025' && TNV._shortDate('', '2026-11-10') === '');
ok('TNC-PROGRESS progress counts done of total as a whole percent',
  JSON.stringify(TNV._progress([{ status: 'done' }, { status: 'open' }, { status: 'open' }])) === JSON.stringify({ done: 1, total: 3, pct: 33, text: '1 of 3 done' })
  && TNV._progress([]).text === '' && TNV._progress(null).total === 0);
ok('TNC-LINK-META a web link names its site without www; a note link is a note',
  TNV._linkMeta('[PR](https://www.github.com/a/b/pull/1)').host === 'github.com'
  && TNV._linkMeta('https://teams.microsoft.com/l/x').host === 'teams.microsoft.com'
  && TNV._linkMeta('[[Retro Notes]]').kind === 'note');
ok('TNC-ACTIONS open → Mark done + Edit; archived done → Reopen + Edit; otherwise Edit alone',
  TNV._actionsFor('open', 'spice/tasks/A.md').join() === 'done,edit'
  && TNV._actionsFor('done', 'spice/tasks/_done/A.md').join() === 'reopen,edit'
  && TNV._actionsFor('done', 'spice/tasks/A.md').join() === 'edit'
  && TNV._actionsFor('deleted', 'spice/tasks/_trash/A.md').join() === 'edit');

const css = TNV._CSS;
ok('TNC-CSS-PHONE on a phone the footer buttons share the row at a touch height and outrank the theme',
  /body\.is-phone \.sauce-tnv-actions > \.sauce-btn\.sauce-btn\.sauce-btn\.sauce-btn \{ flex: 1 1 0; height: auto; min-height: 42px; \}/.test(css));
ok('TNC-CSS-INPUT on a phone the add-subtask input is 16px, so iOS does not zoom in',
  /body\.is-phone \.sauce-tnv-add\.sauce-tnv-add\.sauce-tnv-add \{[^}]*font-size: 16px;/.test(css));
ok('TNC-CSS-MOTION reduced motion stops the bar fill and the reveal',
  /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.sauce-tnv-progress > span[^}]*animation: none !important;/.test(css));
ok('TNC-CSS-PRIO the card edge takes the priority colour',
  /\.sauce-task-note-view\[data-priority="high"\][^{]*\{ --tnv-prio: var\(--color-red/.test(css) && /\.sauce-task-note-view::before \{[^}]*background: var\(--tnv-prio\)/.test(css));

function harness(page, kids, opts) {
  const o = opts || {};
  const calls = { rows: [], done: [], markDone: [], reopen: [], commands: [], open: [] };
  const TE = new TaskEntity();
  const TTL = {
    _priorityLevel: (t) => { const p = String(t && t.priority || '').toLowerCase(); return ['highest', 'high', 'medium', 'low'].includes(p) ? p : 'none'; },
    renderTaskRow: (host, task, TD, options) => { calls.rows.push({ task, options }); return host.createEl('div', { cls: 'row', text: task.title }); },
    renderDoneRow: (host, task, options) => { calls.done.push({ task, options }); return host.createEl('div', { cls: 'done-row', text: task.title }); },
  };
  global.Notice = class { constructor(m) { calls.notice = m; } };
  global.requestAnimationFrame = undefined;
  global.window = {
    customJS: {
      TaskEntity: TE, TaskTodayList: TTL,
      TaskDialog: {
        markDone: async (p) => { calls.markDone.push(p); return o.markDone || { ok: true }; },
        reopen: async (p) => { calls.reopen.push(p); return { ok: true, path: 'spice/tasks/' + p.split('/').pop() }; },
        open: (a) => calls.open.push(a),
      },
      RenderSafe: { page: () => page },
    },
    moment: () => ({ format: (f) => (f === 'YYYY-MM-DD' ? '2026-11-10' : '2026-11-10T15:00:00-07:00') }),
    app: { workspace: { openLinkText: (t) => calls.open.push(t) }, commands: { executeCommandById: (id) => calls.commands.push(id) } },
  };
  const arr = (xs) => { const a = xs.slice(); a.where = (f) => arr(a.filter(f)); a.array = () => a.slice(); return a; };
  const container = makeEl('div');
  const dv = { container, current: () => page, pages: () => arr(kids || []) };
  return { dv, container, calls };
}

const HENRY = { type: 'task', title: 'Help Henry out with Routes', status: 'open', due: '2026-11-10', priority: 'high', project: '[[Content-Registry]]', source: 'daily', source_note: '[[ToDo-2026-11-10]]', links: ['[Routes PR #342](https://github.com/accuristech/accurapi.ingress-api.routes/pull/342)'], created_at: '2026-11-10T14:06:43-07:00', file: { path: 'spice/tasks/Help Henry out with Routes.md', name: 'Help Henry out with Routes' } };
const kid = (title, status, extra) => Object.assign({ type: 'task', title, status, parent_task: '[[Help Henry out with Routes]]', source: 'manual', file: { path: 'spice/tasks/' + (status === 'done' ? '_done/' : '') + title + '.md', name: title } }, extra || {});

(async () => {
  {
    const kids = [kid('Review the PR', 'open', { due: '2026-11-10' }), kid('Write up rules', 'open'), kid('Find stale routes', 'done', { completed_at: '2026-11-09T09:10:00-07:00' })];
    const { dv, container, calls } = harness(HENRY, kids);
    await new TNV().render(dv);
    const card = one(container, 'sauce-task-note-view');
    const chips = byClass(container, 'sauce-tnv-chip').map((c) => c.textContent);
    ok('TNC-HEAD the header is the title over chips: status, due, priority and the project',
      one(container, 'sauce-tnv-title').textContent === 'Help Henry out with Routes'
      && JSON.stringify(chips) === JSON.stringify(['Open', 'Due today', 'High priority', 'Content-Registry']));
    ok('TNC-PRIO-ATTR the card carries its priority and status for the edge colour',
      card.attributes['data-priority'] === 'high' && card.attributes['data-status'] === 'open');
    ok('TNC-LINKS each link is a row with the site it goes to',
      byClass(container, 'sauce-tnv-link').length === 1 && one(container, 'sauce-tnv-link-host').textContent === 'github.com');
    ok('TNC-SUB-ROWS open subtasks draw as shared rows without the project chip',
      calls.rows.length === 2 && calls.rows.every((r) => r.options && r.options.showProject === false && r.options.todayStr === '2026-11-10'));
    ok('TNC-SUB-COUNT the count reads "1 of 3 done" and the bar is a third full',
      one(container, 'sauce-tnv-count').textContent === '1 of 3 done'
      && byClass(container, 'sauce-tnv-progress')[0].children[0].style.width === '33%');
    ok('TNC-SUB-DONE finished subtasks draw as done rows with Reopen and their day',
      calls.done.length === 1 && calls.done[0].options.undoLabel === 'Reopen' && calls.done[0].options.stamp === 'Nov 9'
      && byClass(container, 'sauce-tnv-label').some((l) => l.textContent === 'Done · 1'));
    ok('TNC-ADD the add-subtask input sits under the open rows',
      one(container, 'sauce-tnv-add') && one(container, 'sauce-tnv-add').placeholder === '+ Add subtask…');
    const buttons = byClass(one(container, 'sauce-tnv-actions'), 'sauce-btn').map((b) => b.textContent);
    ok('TNC-FOOTER an open task has Mark done beside Edit', JSON.stringify(buttons) === JSON.stringify(['Mark done', 'Edit']));
    ok('TNC-META the quiet line has the created day and the source note',
      one(container, 'sauce-tnv-meta').textContent === 'Created Nov 10·From ToDo-2026-11-10');
    ok('TNC-REVEAL the card rises in on first open', card.classList.contains('sauce-anim-reveal'));

    calls.rows[0].options.onDone(calls.rows[0].task);
    ok('TNC-SUB-ONDONE ticking a subtask moves it to the done list and fills the bar, without waiting for a refresh',
      one(container, 'sauce-tnv-count').textContent === '2 of 3 done'
      && byClass(container, 'sauce-tnv-progress')[0].children[0].style.width === '67%'
      && byClass(container, 'done-row').length === 2 && byClass(container, 'row').length === 1);

    const reopenRow = calls.done.find((d) => d.task.title === 'Find stale routes');
    await reopenRow.options.onUndo(reopenRow.task, makeEl('button'));
    ok('TNC-SUB-REOPEN Reopen puts a subtask back in the open list',
      calls.reopen[0] === 'spice/tasks/_done/Find stale routes.md'
      && one(container, 'sauce-tnv-count').textContent === '1 of 3 done' && byClass(container, 'row').length === 2);

    const markBtn = byClass(one(container, 'sauce-tnv-actions'), 'sauce-btn')[0];
    await markBtn._listeners.click();
    ok('TNC-MARKDONE Mark done completes this note, shows Done and refreshes the views',
      calls.markDone[0] === 'spice/tasks/Help Henry out with Routes.md' && markBtn.textContent === 'Done'
      && markBtn.classList.contains('is-completing') && calls.commands.includes('dataview:dataview-force-refresh-views'));

    const again = harness(HENRY, kids);
    await new TNV().render(again.dv);
    ok('TNC-REVEAL-ONCE a refresh of the same note does not replay the rise',
      !one(again.container, 'sauce-task-note-view').classList.contains('sauce-anim-reveal'));
  }

  {
    const { dv, container, calls } = harness(HENRY, [], { markDone: { ok: false, reason: 'locked' } });
    await new TNV().render(dv);
    const markBtn = byClass(one(container, 'sauce-tnv-actions'), 'sauce-btn')[0];
    await markBtn._listeners.click();
    ok('TNC-MARKDONE-FAIL a failed Mark done puts the button back and says why',
      markBtn.textContent === 'Mark done' && !markBtn.disabled && /locked/.test(calls.notice || ''));
    ok('TNC-EMPTY a task with no subtasks shows a one-line hint and no bar',
      one(container, 'sauce-tnv-empty') && byClass(container, 'sauce-tnv-progress')[0].style.display === 'none' && !one(container, 'sauce-tnv-count').textContent);
  }

  {
    const kids = Array.from({ length: 7 }, (_, i) => kid('Done ' + i, 'done', { completed_at: '2026-11-0' + (i + 1) + 'T09:00:00-07:00' }));
    const { dv, container } = harness(HENRY, kids);
    await new TNV().render(dv);
    const more = one(container, 'sauce-tnv-more');
    ok('TNC-MORE seven done subtasks show the newest five and "Show 2 more"',
      byClass(container, 'done-row').length === 5 && more && more.textContent === 'Show 2 more'
      && byClass(container, 'done-row')[0].textContent === 'Done 6');
    more._listeners.click();
    ok('TNC-MORE-ALL Show more lists them all', byClass(container, 'done-row').length === 7 && !one(container, 'sauce-tnv-more'));
  }

  {
    const SUB = { type: 'task', title: 'Review the PR', status: 'open', due: '2026-11-08', parent_task: '[[Help Henry out with Routes]]', file: { path: 'spice/tasks/Review the PR.md', name: 'Review the PR' } };
    const { dv, container, calls } = harness(SUB, []);
    await new TNV().render(dv);
    const parent = one(container, 'sauce-tnv-parent');
    ok('TNC-PARENT a subtask note opens with "Part of" its parent, which is a link',
      parent && one(parent, 'sauce-tnv-parent-name').textContent === 'Help Henry out with Routes');
    parent._listeners.click({ preventDefault() {}, stopPropagation() {} });
    ok('TNC-PARENT-OPEN the parent link opens the parent note', calls.open.includes('Help Henry out with Routes'));
    ok('TNC-SUB-NOSUB a subtask has no subtasks section of its own', !one(container, 'is-subtasks'));
    ok('TNC-SUB-OVERDUE its overdue date reads in the danger tone',
      byClass(container, 'is-due')[0].className.includes('is-danger') && byClass(container, 'is-due')[0].textContent === 'Overdue · 2 days');
  }

  {
    const DONE = Object.assign({}, HENRY, { status: 'done', completed_at: '2026-11-10T16:00:00-07:00', file: { path: 'spice/tasks/_done/Help Henry out with Routes.md', name: 'Help Henry out with Routes' } });
    const { dv, container, calls } = harness(DONE, []);
    await new TNV().render(dv);
    const buttons = byClass(one(container, 'sauce-tnv-actions'), 'sauce-btn');
    ok('TNC-DONE-NOTE a finished task offers Reopen beside Edit, and its chips say Done',
      JSON.stringify(buttons.map((b) => b.textContent)) === JSON.stringify(['Reopen', 'Edit'])
      && byClass(container, 'is-status')[0].textContent === 'Done' && !byClass(container, 'is-due')[0].className.includes('is-accent'));
    await buttons[0]._listeners.click();
    ok('TNC-DONE-REOPEN Reopen reopens this note and refreshes',
      calls.reopen[0] === 'spice/tasks/_done/Help Henry out with Routes.md' && calls.commands.includes('dataview:dataview-force-refresh-views'));
    ok('TNC-DONE-META the quiet line adds the day it was done', /Done Nov 10/.test(one(container, 'sauce-tnv-meta').textContent));
  }

  const failed = results.filter(([, pass]) => !pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
