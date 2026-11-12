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
      remove: (...c) => { el.className = el.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
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
ok('TNC-ACTIONS open → Mark done + Edit; done at any path → Reopen + Edit; deleted → Edit alone',
  TNV._actionsFor('open', 'spice/tasks/A.md').join() === 'done,edit'
  && TNV._actionsFor('done', 'spice/tasks/_done/A.md').join() === 'reopen,edit'
  && TNV._actionsFor('done', 'spice/tasks/A.md').join() === 'reopen,edit'
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
    ok('TNC-MARKDONE-CELEBRATE Mark done completes this note, strikes the title and pops a check before refreshing',
      calls.markDone[0] === 'spice/tasks/Help Henry out with Routes.md' && markBtn.textContent === 'Done'
      && markBtn.classList.contains('is-completing') && card.classList.contains('is-completing')
      && one(card, 'sauce-tnv-burst-mark') && !calls.commands.includes('dataview:dataview-force-refresh-views'));
    await new Promise((r) => setTimeout(r, TNV._CELEBRATE_MS + 50));
    ok('TNC-MARKDONE then the views refresh', calls.commands.includes('dataview:dataview-force-refresh-views'));

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
    const { dv, container, calls } = harness(HENRY, [], { markDone: { ok: false, reason: 'cancelled' } });
    await new TNV().render(dv);
    const markBtn = byClass(one(container, 'sauce-tnv-actions'), 'sauce-btn')[0];
    await markBtn._listeners.click();
    ok('TNC-MARKDONE-CANCEL a declined subtasks question puts Mark done back without a notice or a celebration',
      markBtn.textContent === 'Mark done' && !markBtn.disabled && calls.notice === undefined
      && !markBtn.classList.contains('is-completing'));
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
    one(parent, 'sauce-tnv-parent-name')._listeners.click({ preventDefault() {}, stopPropagation() {} });
    ok('TNC-PARENT-OPEN the parent link opens the parent note', calls.open.includes('Help Henry out with Routes'));
    ok('TNC-SUB-OWN a subtask note has a Subtasks section of its own, so it can be broken down further',
      !!one(container, 'is-subtasks') && !!one(container, 'sauce-tnv-add'));
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

  {
    const under = (parent, title, status, extra) => Object.assign(kid(title, status, extra), { parent_task: '[[' + parent + ']]' });
    const NEST = Object.assign({}, HENRY, { title: 'Nest root', file: { path: 'spice/tasks/Nest root.md', name: 'Nest root' } });
    const kids = [
      under('Nest root', 'A', 'open'),
      under('Nest root', 'B', 'done', { completed_at: '2026-11-10T09:00:00-07:00' }),
      under('A', 'A1', 'open'),
      under('A', 'A2', 'done', { completed_at: '2026-11-10T08:00:00-07:00' }),
      under('A1', 'A1a', 'open'),
      under('A1a', 'A1a-i', 'open'),
      under('A1a-i', 'too deep', 'open'),
    ];
    const { dv, container, calls } = harness(NEST, kids);
    await new TNV().render(dv);
    const rowA = calls.rows.find((r) => r.task.title === 'A');
    ok('TNC-NEST-METER a subtask with its own subtasks shows their progress on its row',
      rowA && JSON.stringify(rowA.task.subtask_count) === JSON.stringify({ done: 1, total: 2 }));
    const nests = byClass(container, 'sauce-tnv-nest');
    ok('TNC-NEST-TREE open sub-subtasks nest under their parent row, three levels deep and no further',
      nests.length === 2 && nests[0].children.some((c) => c.textContent === 'A1')
      && calls.rows.some((r) => r.task.title === 'A1a-i') === false
      && calls.rows.map((r) => r.task.title).join() === 'A,A1,A1a');
    ok('TNC-NEST-COUNT the card counts its own direct subtasks', one(container, 'sauce-tnv-count').textContent === '1 of 2 done');
    ok('TNC-ROWS-IN on first open the rows rise in one after another',
      byClass(container, 'row').every((r) => r.classList.contains('sauce-tnv-row-in'))
      && byClass(container, 'row')[1].style.animationDelay === '45ms');
    const ring = one(container, 'sauce-tnv-ring');
    ok('TNC-RING the header ring shows the share of subtasks done',
      ring.style.display === '' && ring.attributes['aria-label'] === '50% of subtasks done');

    const rowA1 = calls.rows.find((r) => r.task.title === 'A1');
    calls.rows.length = 0;
    rowA1.options.onDone(rowA1.task);
    const rowA2 = calls.rows.find((r) => r.task.title === 'A');
    ok('TNC-NEST-ONDONE ticking a nested subtask updates its parent row at once',
      rowA2 && JSON.stringify(rowA2.task.subtask_count) === JSON.stringify({ done: 2, total: 2 })
      && !calls.rows.some((r) => r.task.title === 'A1'));

    calls.rows.length = 0;
    rowA2.options.onDone(rowA2.task);
    const markBtn = byClass(one(container, 'sauce-tnv-actions'), 'sauce-btn')[0];
    ok('TNC-READY with every subtask done, the count says so, the ring is complete and Mark done glows',
      one(container, 'sauce-tnv-count').textContent === 'All 2 done' && ring.classList.contains('is-complete')
      && markBtn.classList.contains('is-ready'));

    const again = harness(NEST, kids);
    await new TNV().render(again.dv);
    ok('TNC-ROWS-IN-ONCE a refresh draws the rows without the rise', !byClass(again.container, 'row').some((r) => r.classList.contains('sauce-tnv-row-in')));
  }

  {
    const under = (parent, title, status) => Object.assign(kid(title, status), { parent_task: '[[' + parent + ']]' });
    const LOOP = { type: 'task', title: 'Loop A', status: 'open', parent_task: '[[Loop B]]', file: { path: 'spice/tasks/Loop A.md', name: 'Loop A' } };
    const kids = [Object.assign(under('Loop A', 'Loop B', 'open'), {}), LOOP];
    const { dv, container, calls } = harness(LOOP, kids);
    await new TNV().render(dv);
    ok('TNC-LOOP a parent loop draws once and stops, never nesting the note inside its own card',
      calls.rows.map((r) => r.task.title).join() === 'Loop B' && !one(container, 'sauce-tnv-nest')
      && byClass(container, 'sauce-tnv-parent-name').map((a) => a.textContent).join() === 'Loop B');
  }

  {
    const note = (p, extra) => Object.assign({ type: 'task', status: 'open', source: 'manual', title: p.split('/').pop(), file: { path: 'spice/tasks/' + p + '/' + p.split('/').pop() + '.md', name: p.split('/').pop() } }, extra || {});
    const TOP = note('Top');
    const kids = [TOP, note('Top/A'), note('Top/A/A1'), note('Top/B', { status: 'done', completed_at: '2026-11-10T09:00:00-07:00' })];
    const { dv, container, calls } = harness(TOP, kids);
    await new TNV().render(dv);
    ok('TNC-FOLDER-TREE children given as folder-note paths, with no parent_task, still nest',
      calls.rows.map((r) => r.task.title).join() === 'A,A1' && byClass(container, 'sauce-tnv-nest').length === 1
      && one(container, 'sauce-tnv-count').textContent === '1 of 2 done');
  }

  {
    const note = (p, extra) => Object.assign({ type: 'task', status: 'open', source: 'manual', title: p.split('/').pop(), file: { path: 'spice/tasks/' + p + '/' + p.split('/').pop() + '.md', name: p.split('/').pop() } }, extra || {});
    const P1 = note('P1');
    const kids = [P1, note('P1/Notes'), note('P1/Notes/X1'), note('P2'), note('P2/Notes'), note('P2/Notes/X2')];
    const { dv, container, calls } = harness(P1, kids);
    await new TNV().render(dv);
    ok('TNC-FOLDER-SAME-NAME two parents each with a child named Notes do not share children',
      calls.rows.map((r) => r.task.title).join() === 'Notes,X1' && !calls.rows.some((r) => r.task.title === 'X2'));
    const idx = TNV._taskIndex([
      { path: 'spice/tasks/P1/Notes/Notes.md', parent_task: 'P1', parent_path: 'spice/tasks/P1/P1.md' },
      { path: 'spice/tasks/P1/Notes/X1/X1.md', parent_task: 'Notes', parent_path: 'spice/tasks/P1/Notes/Notes.md' },
      { path: 'spice/tasks/P2/Notes/X2/X2.md', parent_task: 'Notes', parent_path: 'spice/tasks/P2/Notes/Notes.md' },
      { path: 'spice/tasks/Flat child.md', parent_task: 'Flat', parent_path: '' },
    ], null);
    const titles = (k) => (idx.children.get(k) || []).map((t) => TNV._baseOf(t.path)).join();
    ok('TNC-INDEX-PATH-KEY a child with a parent path is keyed under that path; one without, under the parent basename',
      titles('spice/tasks/P1/Notes/Notes.md') === 'X1' && titles('spice/tasks/P2/Notes/Notes.md') === 'X2'
      && titles('Notes') === '' && titles('Flat') === 'Flat child'
      && TNV._kidsOf(idx, 'spice/tasks/P1/Notes/Notes.md').length === 1 && TNV._kidsOf(idx, 'spice/tasks/Flat.md').length === 1);
  }

  {
    const GRAND = { type: 'task', title: 'Review the PR', status: 'open', parent_task: '[[Help Henry out with Routes]]', file: { path: 'spice/tasks/Review the PR.md', name: 'Review the PR' } };
    const LEAF = { type: 'task', title: 'Leave a comment', status: 'open', parent_task: '[[Review the PR]]', file: { path: 'spice/tasks/Leave a comment.md', name: 'Leave a comment' } };
    const ROOT = Object.assign({}, HENRY, { parent_task: '[[Launch]]' });
    const LAUNCH = { type: 'task', title: 'Launch', status: 'open', file: { path: 'spice/tasks/Launch.md', name: 'Launch' } };
    const { dv, container, calls } = harness(LEAF, [LAUNCH, ROOT, GRAND, LEAF]);
    await new TNV().render(dv);
    ok('TNC-CHAIN a deep subtask shows its whole chain of parents, outermost first, each a link',
      byClass(container, 'sauce-tnv-parent-name').map((a) => a.textContent).join(' › ') === 'Launch › Help Henry out with Routes › Review the PR');
    byClass(container, 'sauce-tnv-parent-name')[0]._listeners.click({ preventDefault() {}, stopPropagation() {} });
    ok('TNC-CHAIN-OPEN each link in the chain opens that task', calls.open.includes('Launch'));
  }

  ok('TNC-ANCESTORS-PURE the chain stops at a loop, at the note itself, and after five',
    JSON.stringify(TNV._ancestors('B', new Map([['B', { parent_task: 'A' }], ['A', { parent_task: 'B' }]]), null, 'X')) === JSON.stringify(['A', 'B'])
    && JSON.stringify(TNV._ancestors('B', new Map([['B', { parent_task: 'X' }]]), null, 'X')) === JSON.stringify(['B'])
    && TNV._ancestors('L0', new Map(Array.from({ length: 9 }, (_, i) => ['L' + i, { parent_task: 'L' + (i + 1) }])), null, '').length === 5);
  ok('TNC-INDEX-PURE the index groups subtasks by parent and ignores a task naming itself',
    (() => {
      const idx = TNV._taskIndex([{ path: 'spice/tasks/A.md', parent_task: 'P' }, { path: 'spice/tasks/_done/B.md', parent_task: 'P' }, { path: 'spice/tasks/S.md', parent_task: 'S' }], null);
      return idx.children.get('P').length === 2 && !idx.children.has('S') && idx.byName.has('B');
    })());
  ok('TNC-CSS-NEST the tree indents with a guide line, tighter on a phone',
    /\.sauce-tnv-nest \{ margin: 0 0 2px 16px; padding-left: 10px; border-left: 2px solid/.test(css)
    && /body\.is-phone \.sauce-tnv-nest \{ margin-left: 8px; padding-left: 8px; \}/.test(css));
  ok('TNC-CSS-MOTION-ALL reduced motion also stops the rows, the ring, the glow and the celebration',
    /prefers-reduced-motion: reduce\) \{[^}]*\.sauce-tnv-done,[^}]*\.sauce-tnv-row-in,[^}]*\.sauce-tnv-ring-arc,[^}]*\.sauce-tnv-burst-mark[^}]*animation: none !important;/.test(css));

  const failed = results.filter(([, pass]) => !pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
