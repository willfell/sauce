#!/usr/bin/env node
/**
 * run-task-day-plan.js — the day rhythm (spec 2026-11-13-task-flow-design.md
 * sections 3 and 4). TaskDayPlan picks the Now task (the open task with the
 * newest pinned_at), pins and unpins through RenderSafe.mutate, builds and
 * draws the Plan the day panel (Now, Overdue, Due today, meetings, Waiting)
 * and the Now card, and runs Shut down: one task at a time through
 * TaskTodayList.reschedule and TaskDialog.markDone, then a `## Shutdown`
 * section in today's daily note that a second run replaces. TaskDayPlanInit
 * registers `Sauce: Shut down the day`. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c, d) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${c || d == null ? '' : ' — ' + d}`); };
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DP_SRC = read('platform/mechanisms/task-entity/task-day-plan.js');
const INIT_SRC = read('platform/mechanisms/task-entity/task-day-plan-init.js');
const TEClass = new Function(`${read('platform/mechanisms/task-entity/task-entity.js')}\nreturn TaskEntity;`)();
const TDocsClass = new Function('window', 'Notice', `${read('platform/mechanisms/task-entity/task-docs.js')}\nreturn TaskDocs;`);
const RSClass = new Function(`${read('platform/mechanisms/render-safe/render-safe.js')}\nreturn RenderSafe;`)();
const loadDP = (win, notice, doc) => new Function('window', 'Notice', 'document', 'navigator', `${DP_SRC}\nreturn TaskDayPlan;`)(win, notice || function () {}, doc, undefined);

// ---------- fake DOM ----------
function el(tag) {
  const e = {
    tag, className: '', children: [], parentNode: null, attrs: {}, style: {}, dataset: {}, _listeners: {}, _text: '', innerHTML: '', open: false, value: '',
    createEl(t, o) {
      const c = el(t);
      if (o && o.cls) c.className = o.cls;
      if (o && o.text != null) c._text = String(o.text);
      if (o && o.href) c.href = o.href;
      if (o && o.type) c.type = o.type;
      c.parentNode = e; e.children.push(c); return c;
    },
    appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
    insertBefore(c, ref) { if (c.parentNode) c.remove(); const i = ref ? e.children.indexOf(ref) : -1; c.parentNode = e; if (i < 0) e.children.push(c); else e.children.splice(i, 0, c); return c; },
    remove() { if (e.parentNode) { e.parentNode.children = e.parentNode.children.filter((x) => x !== e); e.parentNode = null; } },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
    addEventListener(t, fn) { (e._listeners[t] = e._listeners[t] || []).push(fn); },
    fire(t, ev) { return Promise.all((e._listeners[t] || []).map((fn) => fn(Object.assign({ preventDefault() {}, stopPropagation() {}, target: e }, ev || {})))); },
    focus() {},
    get textContent() { return e._text + e.children.map((c) => c.textContent).join(''); },
    set textContent(v) { e._text = String(v); e.children = []; },
    get nextSibling() { if (!e.parentNode) return null; const s = e.parentNode.children; return s[s.indexOf(e) + 1] || null; },
    classList: null,
    all(cls) { const out = []; const walk = (n) => { for (const c of n.children) { if (String(c.className).split(/\s+/).includes(cls)) out.push(c); walk(c); } }; walk(e); return out; },
    one(cls) { return e.all(cls)[0] || null; },
  };
  e.classList = {
    add(c) { const s = new Set(String(e.className).split(/\s+/).filter(Boolean)); s.add(c); e.className = [...s].join(' '); },
    remove(c) { e.className = String(e.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains(c) { return String(e.className).split(/\s+/).includes(c); },
    toggle(c, on) { if (on === undefined) on = !e.classList.contains(c); if (on) e.classList.add(c); else e.classList.remove(c); return on; },
  };
  return e;
}

// ---------- fake vault ----------
function makeApp(files, opts) {
  const o = opts || {};
  const byPath = new Map();
  const writes = [];
  const opened = [];
  for (const f of files) {
    const base = f.path.split('/').pop().replace(/\.md$/, '');
    byPath.set(f.path, { path: f.path, basename: base, stat: { mtime: f.mtime || 0 }, fm: f.fm ? Object.assign({}, f.fm) : null, body: f.body || '' });
  }
  const app = {
    isMobile: false,
    vault: {
      configDir: '.obsidian',
      getMarkdownFiles: () => [...byPath.values()].filter((f) => /\.md$/.test(f.path)),
      getAbstractFileByPath: (p) => {
        if (byPath.has(p)) return byPath.get(p);
        const kids = [...byPath.values()].filter((f) => f.path.indexOf(p + '/') === 0 && f.path.slice(p.length + 1).indexOf('/') < 0);
        return kids.length ? { path: p, children: kids } : null;
      },
      cachedRead: async (f) => f.body,
      process: async (f, fn) => { if (o.processFails) throw new Error('disk on fire'); writes.push({ kind: 'process', path: f.path }); f.body = fn(f.body); return f.body; },
      adapter: { read: async (p) => { if (p === '.obsidian/daily-notes.json' && o.dailyConfig) return JSON.stringify(o.dailyConfig); throw new Error('ENOENT'); } },
    },
    metadataCache: { getFileCache: (f) => (f && f.fm ? { frontmatter: f.fm } : null) },
    fileManager: {
      processFrontMatter: async (f, fn) => { if (o.pinFails) throw new Error('disk on fire'); writes.push({ kind: 'fm', path: f.path }); f.fm = f.fm || {}; fn(f.fm); },
    },
    workspace: { openLinkText: (p, src, newTab) => opened.push({ p, newTab: !!newTab }), getActiveFile: () => null },
    _byPath: byPath, _writes: writes, _opened: opened,
  };
  return app;
}

const TODAY = '2026-11-13';
const moment = (d, fmt) => {
  const day = d == null ? TODAY : String(d).slice(0, 10);
  return {
    format(f) {
      if (f === 'YYYY-MM-DD') return day;
      if (f === 'YYYY-MM-DDTHH:mm:ssZ') return d == null ? TODAY + 'T17:30:00-06:00' : day + 'T00:00:00-06:00';
      if (f === 'YYYY/MM-MMMM/dddd-YYYY-MM-DD') return day.slice(0, 4) + '/' + day.slice(5, 7) + '-November/Friday-' + day;
      return day;
    },
  };
};

const TASK = (p, fm, mtime) => ({ path: p, fm: Object.assign({ type: 'task' }, fm), mtime });
const FILES = [
  TASK('spice/tasks/Ship routes/Ship routes.md', { title: 'Ship routes', status: 'open', due: '2026-11-13', pinned_at: '2026-11-13T09:00:00-06:00' }),
  TASK('spice/tasks/Ship routes/Write tests/Write tests.md', { title: 'Write tests', status: 'done', completed_at: '2026-11-13T11:00:00-06:00' }),
  TASK('spice/tasks/Ship routes/Deploy/Deploy.md', { title: 'Deploy', status: 'open' }),
  TASK('spice/tasks/Old pin/Old pin.md', { title: 'Old pin', status: 'open', due: '2026-11-10', pinned_at: '2026-11-12T09:00:00-06:00' }),
  TASK('spice/tasks/Finished pin/Finished pin.md', { title: 'Finished pin', status: 'done', completed_at: '2026-11-13T08:00:00-06:00', pinned_at: '2026-11-13T10:00:00-06:00' }),
  TASK('spice/tasks/_trash/Trashed pin/Trashed pin.md', { title: 'Trashed pin', status: 'open', pinned_at: '2026-11-13T12:00:00-06:00' }),
  TASK('spice/tasks/Call bank/Call bank.md', { title: 'Call bank', status: 'open', due: '2026-11-11' }),
  TASK('spice/tasks/Pay rent/Pay rent.md', { title: 'Pay rent', status: 'open', due: '2026-11-13', priority: 'high' }),
  TASK('spice/tasks/Later/Later.md', { title: 'Later', status: 'open', due: '2026-11-20' }),
  TASK('spice/tasks/_sets/PR rollout/PR rollout.md', { title: 'Set task', status: 'open', due: '2026-11-13' }),
  { path: 'spice/tasks/Ship routes/notes/Kickoff prompt.md', fm: { type: 'task-doc', kind: 'prompt', title: 'Kickoff prompt', task: '[[Ship routes]]' }, mtime: 100, body: '---\ntype: task-doc\n---\n\n## Prompt\n\n```\nDo the routes\n```\n' },
  { path: 'spice/tasks/Ship routes/notes/Sent update.md', fm: { type: 'task-doc', kind: 'comms', title: 'Sent update', task: '[[Ship routes]]', to: 'Jason', via: 'Slack', sent_at: '2026-11-11T10:00:00-06:00' }, mtime: 300, body: 'old message' },
  { path: 'spice/tasks/Ship routes/notes/Draft ask.md', fm: { type: 'task-doc', kind: 'comms', title: 'Draft ask', task: '[[Ship routes]]', to: 'Matt' }, mtime: 200, body: 'Hi Matt, can you review?' },
  { path: 'spice/daily/2026/11-November/Friday-2026-11-13.md', fm: { type: 'cowork-daily' }, body: '---\ntype: cowork-daily\n---\n\n```dataviewjs\nawait x;\n```\n\n---\n\nmy notes\n' },
];

function setup(opts) {
  const o = opts || {};
  const notices = [];
  const app = makeApp(o.files || FILES, o.app);
  const win = { app, moment, customJS: {} };
  const TE = new TEClass();
  win.customJS.TaskEntity = TE;
  const TDocsC = TDocsClass(win, function () {});
  const TDocs = new TDocsC();
  if (o.noWaiting) {
    TDocs.waiting = undefined;
  } else if (o.spyWaiting) {
    const real = TDocs.waiting.bind(TDocs);
    TDocs.waiting = (items, tasks, today) => { win._waitingCall = { items, tasks, today }; return real(items, tasks, today); };
  } else if (o.waiting) {
    TDocs.waiting = (items, tasks, today) => { win._waitingCall = { items, tasks, today }; return o.waiting(items, tasks, today); };
    TDocs.waitingText = (d) => (d > 0 ? 'Waiting ' + d + 'd' : 'Waiting');
  }
  win.customJS.TaskDocs = TDocs;
  win.customJS.RenderSafe = o.renderSafe || new RSClass();
  const DPC = loadDP(win, function (m) { notices.push(String(m)); }, o.doc);
  win.customJS.TaskDayPlan = new DPC();
  global.window = win;
  global.app = app;
  global.Notice = function (m) { notices.push(String(m)); };
  return { DPC, DP: win.customJS.TaskDayPlan, app, win, notices, TE };
}

(async () => {
  // ---------- pure ----------
  {
    const { DPC, app } = setup();
    const tasks = DPC.tasksFrom(DPC.collect(app));
    const now = DPC.nowTask(tasks);
    ok('DP-NOW-1 Now is the open task with the newest pinned_at; done and trashed pins drop out',
      now && now.title === 'Ship routes', now && now.title);
    ok('DP-NOW-2 no pin, no Now', DPC.nowTask(tasks.map((t) => Object.assign({}, t, { pinned_at: '' }))) === null);
    ok('DP-TASKS-1 tasksFrom keeps pinned_at, leaves out trashed tasks, and collect skips _sets/',
      !tasks.some((t) => t.title === 'Trashed pin') && !tasks.some((t) => t.title === 'Set task')
      && tasks.find((t) => t.title === 'Old pin').pinned_at === '2026-11-12T09:00:00-06:00');

    const model = DPC.planModel({ tasks, today: TODAY, meetings: [{ path: 'm.md', title: 'Standup', time: '9:00 AM' }], waiting: [{ path: 'w.md' }] });
    ok('DP-PLAN-1 Overdue is every open task due before today, oldest first; Due today is due today; done and future tasks are out',
      JSON.stringify(model.overdue.map((t) => t.title)) === JSON.stringify(['Old pin', 'Call bank'])
      && JSON.stringify(model.dueToday.map((t) => t.title)) === JSON.stringify(['Pay rent', 'Ship routes']),
      JSON.stringify([model.overdue.map((t) => t.title), model.dueToday.map((t) => t.title)]));
    ok('DP-PLAN-2 counts for the panel head', JSON.stringify(model.counts) === JSON.stringify({ overdue: 2, today: 2, meetings: 1, waiting: 1 }), JSON.stringify(model.counts));
    ok('DP-PLAN-3 the signature changes when the Now task changes',
      DPC.signature(model) !== DPC.signature(DPC.planModel({ tasks: tasks.map((t) => Object.assign({}, t, { pinned_at: '' })), today: TODAY })));

    const prog = DPC.subtaskProgress(tasks, now);
    ok('DP-PROG-1 subtask progress counts the folder children, done and open', prog.done === 1 && prog.total === 2, JSON.stringify(prog));
    ok('DP-PROG-2 a flat child counts by parent_task',
      JSON.stringify(DPC.subtaskProgress([{ path: 'spice/tasks/A.md', status: 'open' }, { path: 'spice/tasks/B.md', status: 'done', parent_task: 'A' }], { path: 'spice/tasks/A.md' })) === JSON.stringify({ done: 1, total: 1 }));

    const done = DPC.doneToday(tasks, TODAY);
    ok('DP-DONE-1 done today, newest first', JSON.stringify(done.map((t) => t.title)) === JSON.stringify(['Write tests', 'Finished pin']), JSON.stringify(done.map((t) => t.title)));
  }

  {
    const DPC = loadDP({});
    ok('DP-DATE-1 addDays crosses months and years', DPC.addDays('2026-11-30', 1) === '2026-12-01' && DPC.addDays('2026-12-31', 1) === '2027-01-01' && DPC.addDays('2028-02-28', 1) === '2028-02-29');
    ok('DP-DATE-2 next work day skips the weekend', DPC.nextWorkDay('2026-11-13') === '2026-11-16' && DPC.nextWorkDay('2026-11-14') === '2026-11-16'
      && DPC.nextWorkDay('2026-11-16') === '2026-11-17', DPC.nextWorkDay('2026-11-13'));
    ok('DP-DATE-3 targetDate: Tomorrow, Next work day, Pick date; Done and Leave move nothing',
      DPC.targetDate({ key: 'tomorrow' }, '2026-11-13') === '2026-11-14' && DPC.targetDate({ key: 'next' }, '2026-11-13') === '2026-11-16'
      && DPC.targetDate({ key: 'pick', date: '2026-12-01' }, '2026-11-13') === '2026-12-01' && DPC.targetDate({ key: 'pick', date: '' }, '2026-11-13') === ''
      && DPC.targetDate({ key: 'done' }, '2026-11-13') === '' && DPC.targetDate({ key: 'leave' }, '2026-11-13') === '');
    ok('DP-DATE-4 dayLabel', DPC.dayLabel('2026-11-16') === 'Mon Nov 16', DPC.dayLabel('2026-11-16'));
    ok('DP-CHOICES-1 the five choices in order, Leave last', DPC.CHOICES.map((c) => c.label).join('|') === 'Tomorrow|Next work day|Pick date|Done|Leave');

    const section = DPC.shutdownSection({
      done: [{ path: 'spice/tasks/Write tests/Write tests.md', title: 'Write tests' }, { path: 'spice/tasks/Pay Bills - 11-10-26/Pay Bills - 11-10-26.md', title: 'Pay [the] Bills' }],
      moved: [{ path: 'spice/tasks/Call bank/Call bank.md', title: 'Call bank', date: '2026-11-16' }],
      waiting: 3,
    });
    const want = '## Shutdown\n%% shutdown:start %%\n\nDone: 2\n- [[Write tests]]\n- [[Pay Bills - 11-10-26|Pay the Bills]]\n\nMoved: 1\n- [[Call bank]] → Mon Nov 16\n\nStill waiting: 3\n%% shutdown:end %%\n';
    ok('DP-SECTION-1 Done: N with links, Moved: N as title → date, Still waiting: N, between hidden markers', section === want, JSON.stringify(section));
    ok('DP-SECTION-2 an empty day still writes the three counts', DPC.shutdownSection({}) === '## Shutdown\n%% shutdown:start %%\n\nDone: 0\n\nMoved: 0\n\nStill waiting: 0\n%% shutdown:end %%\n');

    const note = '---\ntype: cowork-daily\n---\n\nmy notes\n';
    const s1 = DPC.shutdownSection({ waiting: 1 });
    const s2 = DPC.shutdownSection({ waiting: 2 });
    const once = DPC.replaceShutdown(note, s1);
    ok('DP-REPLACE-1 appends the section after a blank line', once === note + '\n' + s1, JSON.stringify(once));
    const twice = DPC.replaceShutdown(once, s2);
    ok('DP-REPLACE-2 a second run the same day replaces the section, never adds a second one',
      twice === note + '\n' + s2 && (twice.match(/## Shutdown/g) || []).length === 1, JSON.stringify(twice));
    const middle = '# Day\n\n## Shutdown\n\nDone: 9\n- [[Old]]\n\nMoved: 0\n\nStill waiting: 4\n### detail\nold\n\n## Notes\n\nkeep me\n';
    const mid = DPC.replaceShutdown(middle, s1);
    ok('DP-REPLACE-3 an old section without markers is replaced up to the first line Shut down did not write',
      mid === '# Day\n\n' + s1 + '\n### detail\nold\n\n## Notes\n\nkeep me\n', JSON.stringify(mid));
    const withUser = once + '\nMy own thoughts on the day.\n- [[Someone]] said hi\n';
    const rerun = DPC.replaceShutdown(withUser, s2);
    ok('DP-REPLACE-6 a re-run replaces only the text between the markers; what the person wrote below stays',
      rerun === note + '\n' + s2 + '\nMy own thoughts on the day.\n- [[Someone]] said hi\n', JSON.stringify(rerun));
    const crlf = '---\r\ntype: cowork-daily\r\n---\r\n\r\nmy notes\r\n';
    const c1 = DPC.replaceShutdown(crlf, s1);
    const c2 = DPC.replaceShutdown(c1 + 'later\r\n', s2);
    ok('DP-REPLACE-7 CRLF notes keep CRLF on every line, old and new',
      c1 === crlf + '\r\n' + s1.replace(/\n/g, '\r\n') && c2 === crlf + '\r\n' + s2.replace(/\n/g, '\r\n') + 'later\r\n'
      && !/[^\r]\n/.test(c2), JSON.stringify(c2));
    const mixed = 'a\r\nb\n\n## Shutdown\n%% shutdown:start %%\nDone: 0\n%% shutdown:end %%\nc\r\n';
    const m2 = DPC.replaceShutdown(mixed, s1);
    ok('DP-REPLACE-8 untouched lines keep their own endings in a mixed note',
      m2.indexOf('a\r\nb\n\n') === 0 && m2.endsWith('%% shutdown:end %%\nc\r\n'), JSON.stringify(m2));
    const prior = DPC.replaceShutdown(note, DPC.shutdownSection({ moved: [
      { path: 'spice/tasks/Call bank/Call bank.md', title: 'Call bank', date: '2026-11-16' },
      { path: 'spice/tasks/Pay Bills - 11-10-26/Pay Bills - 11-10-26.md', title: 'Pay Bills', date: '2026-11-17' },
    ] }));
    const parsed = DPC.parseMoved(prior);
    ok('DP-MOVED-1 the Moved items already in the section are read back',
      JSON.stringify(parsed) === JSON.stringify([
        { link: '[[Call bank]]', label: 'Mon Nov 16', key: 'call bank' },
        { link: '[[Pay Bills - 11-10-26|Pay Bills]]', label: 'Tue Nov 17', key: 'pay bills - 11-10-26' },
      ]), JSON.stringify(parsed));
    const merged = DPC.mergeMoved(parsed, [{ path: 'spice/tasks/Call bank/Call bank.md', title: 'Call bank', date: '2026-11-20' }, { path: 'spice/tasks/Gym/Gym.md', title: 'Gym', date: '2026-11-14' }]);
    const mergedSec = DPC.shutdownSection({ moved: merged });
    ok('DP-MOVED-2 a re-run keeps earlier moves and adds this run\'s, one line per task, this run\'s date winning',
      /Moved: 3\n- \[\[Pay Bills - 11-10-26\|Pay Bills\]\] → Tue Nov 17\n- \[\[Call bank\]\] → Fri Nov 20\n- \[\[Gym\]\] → Sat Nov 14\n/.test(mergedSec), mergedSec);
    const fenced = '```\n## Shutdown\n```\n';
    ok('DP-REPLACE-4 a ## Shutdown inside fenced code is not the section', DPC.replaceShutdown(fenced, s1) === fenced + '\n' + s1);
    ok('DP-REPLACE-5 replacing is idempotent', DPC.replaceShutdown(DPC.replaceShutdown(mid, s2), s2) === DPC.replaceShutdown(mid, s2));

    ok('DP-PATH-1 today\'s daily note from the Daily notes folder and format',
      DPC.dailyNotePath(TODAY, { folder: 'spice/daily/', format: 'YYYY/MM-MMMM/dddd-YYYY-MM-DD' }, moment) === 'spice/daily/2026/11-November/Friday-2026-11-13.md'
      && DPC.dailyNotePath(TODAY, null, moment) === '2026-11-13.md' && DPC.dailyNotePath('nope', {}, moment) === '');

    const items = DPC.commsItems([
      { path: 'spice/tasks/A/notes/Ask.md', basename: 'Ask', fm: { type: 'task-doc', kind: 'Comms', title: 'Ask', to: ['Jason', 'Matt'], via: 'Slack', sent_at: '2026-11-12T10:00:00Z' } },
      { path: 'spice/tasks/A/notes/P.md', basename: 'P', fm: { type: 'task-doc', kind: 'prompt' } },
      { path: 'spice/tasks/A/A.md', basename: 'A', fm: { type: 'task' } },
    ]);
    ok('DP-COMMS-1 comms items carry path, kind, title, to, via, sent_at, replied_at',
      items.length === 1 && JSON.stringify(items[0]) === JSON.stringify({ path: 'spice/tasks/A/notes/Ask.md', kind: 'comms', title: 'Ask', to: 'Jason, Matt', via: 'Slack', sent_at: '2026-11-12T10:00:00Z', replied_at: '' }), JSON.stringify(items));
  }

  // ---------- build: Waiting only when TaskDocs.waiting exists ----------
  {
    const { DP } = setup({ noWaiting: true });
    const m = DP.build({ today: TODAY });
    ok('DP-WAIT-1 without TaskDocs.waiting the panel leaves Waiting out', m.hasWaiting === false && m.waiting.length === 0 && m.counts.waiting === 0);
  }
  {
    const { DP, win } = setup({ waiting: (items) => items.filter((i) => i.sent_at).map((i) => Object.assign({}, i, { days: 2, taskTitle: 'Ship routes' })) });
    const m = DP.build({ today: TODAY });
    const call = win._waitingCall || {};
    ok('DP-WAIT-2 Waiting comes from TaskDocs.waiting over the comms notes and the tasks, for today',
      m.hasWaiting === true && m.waiting.length === 1 && m.waiting[0].title === 'Sent update'
      && Array.isArray(call.items) && call.items.length === 2 && call.items.every((i) => i.kind === 'comms')
      && Array.isArray(call.tasks) && call.tasks.some((t) => t.status === 'done') && call.today === TODAY);
  }

  {
    const { DP, win } = setup({ spyWaiting: true });
    const m = DP.build({ today: TODAY });
    const host = el('div');
    DP.renderDay(host, { today: TODAY, model: m, surface: 'home', open: true });
    const group = host.all('sauce-dp-group').find((g) => g.getAttribute('data-group') === 'waiting');
    const row = group && group.one('sauce-dp-row');
    ok('DP-WAIT-3 Plan the day calls the real TaskDocs.waiting and renders its entries: the sent, unanswered comms note, how long, to whom, via what and the task',
      !!win._waitingCall && m.hasWaiting === true && m.counts.waiting === 1
      && row && row.getAttribute('data-path') === 'spice/tasks/Ship routes/notes/Sent update.md'
      && row.textContent === 'Sent updateWaiting 2d · to Jason · Slack · Ship routes'
      && host.one('sauce-dp-plan-head').all('sauce-dp-count').some((c) => c.textContent === '1 waiting'),
      row && row.textContent);
  }

  // ---------- pin / unpin ----------
  {
    const calls = [];
    const RS = new RSClass();
    const real = RS.mutate.bind(RS);
    RS.mutate = (opts) => { calls.push(opts); return real(opts); };
    const { DP, app } = setup({ renderSafe: RS });
    const res = await DP.togglePin(app, 'spice/tasks/Call bank/Call bank.md');
    const fm = (p) => app._byPath.get(p).fm;
    ok('DP-PIN-1 pinning goes through RenderSafe.mutate', calls.length === 1 && res.ok === true && calls[0].path === 'spice/tasks/Call bank/Call bank.md');
    ok('DP-PIN-2 pinning sets pinned_at on this task and clears it on every other task that has it',
      fm('spice/tasks/Call bank/Call bank.md').pinned_at === TODAY + 'T17:30:00-06:00'
      && !('pinned_at' in fm('spice/tasks/Ship routes/Ship routes.md')) && !('pinned_at' in fm('spice/tasks/Old pin/Old pin.md'))
      && !('pinned_at' in fm('spice/tasks/Finished pin/Finished pin.md')) && !('pinned_at' in fm('spice/tasks/_trash/Trashed pin/Trashed pin.md')));
    ok('DP-PIN-3 the pinned task is written first', app._writes[0].path === 'spice/tasks/Call bank/Call bank.md');
    const now = DP.build({ today: TODAY }).now;
    ok('DP-PIN-4 the newly pinned task is Now', now && now.title === 'Call bank');
    const res2 = await DP.togglePin(app, 'spice/tasks/Call bank/Call bank.md');
    ok('DP-PIN-5 toggling a pinned task unpins it', res2.ok === true && !('pinned_at' in fm('spice/tasks/Call bank/Call bank.md')) && DP.build({ today: TODAY }).now === null);
  }
  {
    const { DP, app, notices } = setup({ app: { pinFails: true } });
    let reverted = false;
    const res = await DP.togglePin(app, 'spice/tasks/Ship routes/Deploy/Deploy.md', { optimistic() {}, revert() { reverted = true; } });
    ok('DP-PIN-6 a failed pin reverts and says so', res.ok === false && reverted && notices.some((n) => /Could not pin the task/.test(n)), JSON.stringify(notices));
  }
  {
    const { DP } = setup();
    const e1 = DP.menuEntry({ path: 'spice/tasks/Ship routes/Ship routes.md', status: 'open' });
    const e2 = DP.menuEntry({ path: 'spice/tasks/Ship routes/Deploy/Deploy.md', status: 'open' });
    ok('DP-MENU-1 the ⋯ entry reads Unpin on the pinned task and Pin as Now on others, and none for a done task',
      e1 && e1.label === 'Unpin' && e2 && e2.label === 'Pin as Now' && typeof e2.onSelect === 'function'
      && DP.menuEntry({ path: 'spice/tasks/Ship routes/Write tests/Write tests.md', status: 'done' }) === null);
  }
  {
    const { DP, app } = setup();
    const head = el('div');
    const btn = DP.renderPinButton(head, { path: 'spice/tasks/Ship routes/Deploy/Deploy.md', status: 'open' });
    ok('DP-PINBTN-1 the card pin button starts unpinned with a label', btn && btn.getAttribute('aria-label') === 'Pin as Now' && btn.getAttribute('aria-pressed') === 'false');
    await btn.fire('click');
    ok('DP-PINBTN-2 clicking pins the task and shows it pinned',
      app._byPath.get('spice/tasks/Ship routes/Deploy/Deploy.md').fm.pinned_at && btn.classList.contains('is-pinned') && btn.getAttribute('aria-label') === 'Unpin');
    ok('DP-PINBTN-3 no pin button on a done or trashed task',
      DP.renderPinButton(el('div'), { path: 'spice/tasks/Ship routes/Write tests/Write tests.md', status: 'done' }) === null
      && DP.renderPinButton(el('div'), { path: 'spice/tasks/_trash/Trashed pin/Trashed pin.md', status: 'open' }) === null);
  }

  // ---------- render ----------
  {
    const { DP, app } = setup({ waiting: (items) => items.filter((i) => i.sent_at).map((i) => Object.assign({}, i, { days: 2, taskTitle: 'Ship routes' })) });
    const host = el('div');
    const model = DP.renderDay(host, { today: TODAY, meetingPages: [{ file: { path: 'spice/meetings/notes/Standup-2026-11-13.md', name: 'Standup-2026-11-13' } }], surface: 'home', open: true });
    const card = host.one('sauce-dp-now');
    ok('DP-RENDER-1 the Now card shows the title, the due chip and subtask progress',
      card && card.one('sauce-dp-now-title').textContent === 'Ship routes'
      && card.all('sauce-dp-chip').map((c) => c.textContent).join('|') === 'Due today|1/2 subtasks',
      card && card.all('sauce-dp-chip').map((c) => c.textContent).join('|'));
    const labels = card ? card.all('sauce-dp-btn').map((b) => b.textContent) : [];
    ok('DP-RENDER-2 Now actions: Copy prompt, Copy message, Open, Unpin', labels.join('|') === 'Copy prompt|Copy message|Open|Unpin', labels.join('|'));
    let copied = null;
    app.vault.cachedRead = async (f) => f.body;
    window.customJS.TaskTodayList = { copyText: async (t) => { copied = t; return true; } };
    await card.one('sauce-dp-copy-message').fire('click');
    ok('DP-RENDER-3 Copy message copies the newest unsent comms note', copied === 'Hi Matt, can you review?', JSON.stringify(copied));
    await card.one('sauce-dp-copy-prompt').fire('click');
    ok('DP-RENDER-4 Copy prompt copies the newest prompt note', copied === 'Do the routes', JSON.stringify(copied));
    await card.one('sauce-dp-open').fire('click');
    ok('DP-RENDER-5 Open opens the task', app._opened.some((o) => o.p === 'spice/tasks/Ship routes/Ship routes.md'));

    const panel = host.one('sauce-dp-plan');
    ok('DP-RENDER-6 the Home panel is open; the counts sit in the head',
      panel && panel.open === true && panel.one('sauce-dp-plan-head').all('sauce-dp-count').map((c) => c.textContent).join('|') === '2 overdue|2 today|1 meeting|1 waiting',
      panel && panel.one('sauce-dp-plan-head').all('sauce-dp-count').map((c) => c.textContent).join('|'));
    const groups = panel.all('sauce-dp-group').map((g) => g.getAttribute('data-group'));
    ok('DP-RENDER-7 groups: Now, Overdue, Due today, Meetings, Waiting', groups.join('|') === 'now|overdue|today|meetings|waiting', groups.join('|'));
    const waitRow = panel.all('sauce-dp-group').find((g) => g.getAttribute('data-group') === 'waiting').one('sauce-dp-row');
    ok('DP-RENDER-8 a Waiting row says how long it has waited, to whom and via what', /Waiting 2d · to Jason · Slack/.test(waitRow.textContent), waitRow.textContent);
    const meetRow = panel.all('sauce-dp-group').find((g) => g.getAttribute('data-group') === 'meetings').one('sauce-dp-row');
    ok('DP-RENDER-9 meetings show their title without the date', meetRow.textContent === 'Standup', meetRow.textContent);
    await panel.all('sauce-dp-row').find((r) => r.getAttribute('data-path') === 'spice/tasks/Call bank/Call bank.md').fire('click');
    ok('DP-RENDER-10 every row opens its note', app._opened.some((o) => o.p === 'spice/tasks/Call bank/Call bank.md'));
    ok('DP-RENDER-11 the head carries Shut down', !!panel.one('sauce-dp-plan-head').one('sauce-dp-shutdown'));
    ok('DP-RENDER-12 the model comes back for the caller', model && model.now && model.now.title === 'Ship routes');

    const daily = el('div');
    DP.renderDay(daily, { today: TODAY, surface: 'daily', open: false });
    ok('DP-RENDER-13 the daily note panel starts collapsed', daily.one('sauce-dp-plan').open === false);
    daily.one('sauce-dp-plan').open = true;
    await daily.one('sauce-dp-plan').fire('toggle');
    const again = el('div');
    DP.renderDay(again, { today: TODAY, surface: 'daily', open: false });
    ok('DP-RENDER-14 the panel stays as it was left when it draws again', again.one('sauce-dp-plan').open === true);
  }
  {
    const files = FILES.filter((f) => !/pinned_at/.test(JSON.stringify(f.fm || {})));
    const { DP } = setup({ files, noWaiting: true });
    const host = el('div');
    DP.renderDay(host, { today: '2026-11-25', surface: 'home', open: true });
    ok('DP-RENDER-15 with nothing pinned there is no Now card and no Waiting group',
      !host.one('sauce-dp-now') && !host.all('sauce-dp-group').some((g) => g.getAttribute('data-group') === 'waiting'));
  }

  // ---------- Shut down ----------
  {
    const order = [];
    let active = 0;
    let maxActive = 0;
    const { DP, app, win, notices } = setup({ app: { dailyConfig: { folder: 'spice/daily', format: 'YYYY/MM-MMMM/dddd-YYYY-MM-DD' } } });
    win.customJS.TaskTodayList = {
      reschedule: async (row, task, newDue, viewedDay) => {
        active++; maxActive = Math.max(maxActive, active);
        order.push(['move', task.path, newDue, viewedDay, !!row]);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return { ok: true, due: newDue };
      },
    };
    win.customJS.TaskDialog = {
      open() {},
      markDone: async (p) => { active++; maxActive = Math.max(maxActive, active); order.push(['done', p]); await new Promise((r) => setTimeout(r, 2)); active--; return { ok: true, path: p }; },
    };
    const tasks = DP.tasksFrom(DP.collect(app));
    const model = DP.planModel({ tasks, today: TODAY });
    const still = model.overdue.concat(model.dueToday);
    const choices = new Map([
      ['spice/tasks/Old pin/Old pin.md', { key: 'tomorrow' }],
      ['spice/tasks/Call bank/Call bank.md', { key: 'next' }],
      ['spice/tasks/Pay rent/Pay rent.md', { key: 'done' }],
      ['spice/tasks/Ship routes/Ship routes.md', { key: 'pick', date: '2026-11-20' }],
    ]);
    const res = await DP.finishShutdown({ app, today: TODAY, tasks: still, done: DP.doneToday(tasks, TODAY), choices });
    ok('DP-SHUT-1 Finish applies the choices one at a time through reschedule and markDone, Done last',
      maxActive === 1 && JSON.stringify(order) === JSON.stringify([
        ['move', 'spice/tasks/Old pin/Old pin.md', '2026-11-14', TODAY, true],
        ['move', 'spice/tasks/Call bank/Call bank.md', '2026-11-16', TODAY, true],
        ['move', 'spice/tasks/Ship routes/Ship routes.md', '2026-11-20', TODAY, true],
        ['done', 'spice/tasks/Pay rent/Pay rent.md'],
      ]), JSON.stringify(order));
    const body = app._byPath.get('spice/daily/2026/11-November/Friday-2026-11-13.md').body;
    ok('DP-SHUT-2 the summary lands in today\'s daily note through app.vault.process (Still waiting from TaskDocs.waiting)',
      res.written === true && app._writes.some((w) => w.kind === 'process')
      && /\n## Shutdown\n%% shutdown:start %%\n\nDone: 3\n- \[\[Write tests\]\]\n- \[\[Finished pin\]\]\n- \[\[Pay rent\]\]\n\nMoved: 3\n- \[\[Old pin\]\] → Sat Nov 14\n- \[\[Call bank\]\] → Mon Nov 16\n- \[\[Ship routes\]\] → Fri Nov 20\n\nStill waiting: 1\n%% shutdown:end %%\n$/.test(body), body);
    ok('DP-SHUT-3 a notice sums it up', notices.some((n) => n === 'Day shut down: 1 done, 3 moved'), JSON.stringify(notices));
    const dailyFile = app._byPath.get('spice/daily/2026/11-November/Friday-2026-11-13.md');
    dailyFile.body += '\nWrapped up early.\n';
    await DP.finishShutdown({ app, today: TODAY, tasks: [{ path: 'spice/tasks/Later/Later.md', title: 'Later', status: 'open' }], done: [],
      choices: new Map([['spice/tasks/Later/Later.md', { key: 'tomorrow' }]]) });
    const body2 = dailyFile.body;
    ok('DP-SHUT-4 running it again the same day replaces that day\'s section, keeps the earlier moves and the text below it',
      (body2.match(/## Shutdown/g) || []).length === 1 && body2.indexOf('my notes') > 0
      && /Moved: 4\n- \[\[Old pin\]\] → Sat Nov 14\n- \[\[Call bank\]\] → Mon Nov 16\n- \[\[Ship routes\]\] → Fri Nov 20\n- \[\[Later\]\] → Sat Nov 14\n/.test(body2)
      && /%% shutdown:end %%\n\nWrapped up early\.\n$/.test(body2), body2);
  }
  {
    const { DP, app, win, notices } = setup({ app: { dailyConfig: { folder: 'spice/journal', format: 'YYYY-MM-DD' } } });
    win.customJS.TaskTodayList = { reschedule: async () => ({ ok: false }) };
    win.customJS.TaskDialog = { open() {}, markDone: async () => ({ ok: false, reason: 'cancelled' }) };
    const res = await DP.finishShutdown({ app, today: TODAY, tasks: [{ path: 'spice/tasks/Call bank/Call bank.md', title: 'Call bank', status: 'open' }, { path: 'spice/tasks/Pay rent/Pay rent.md', title: 'Pay rent', status: 'open' }], done: [],
      choices: new Map([['spice/tasks/Call bank/Call bank.md', { key: 'tomorrow' }], ['spice/tasks/Pay rent/Pay rent.md', { key: 'done' }]]) });
    ok('DP-SHUT-5 with no daily note for today the choices still apply and a notice says the summary was not saved',
      res.written === false && res.failed === 1 && notices.some((n) => /No daily note for today/.test(n)) && notices.some((n) => n === 'Day shut down: 0 done, 0 moved, 1 not changed'), JSON.stringify(notices));
  }
  {
    const opened = [];
    const doc = { body: {}, head: null };
    const fakeModal = { open: (o) => { opened.push(o); const h = { close() {} }; if (o.footer) o._footerLater = true; return h; } };
    const { DP, app, win } = setup({ doc });
    win.customJS.SauceModal = fakeModal;
    let finished = null;
    const DPC = win.customJS.TaskDayPlan.constructor;
    const orig = DPC.finishShutdown;
    DPC.finishShutdown = async (ctx) => { finished = ctx; return {}; };
    DP.openShutdown({ app, today: TODAY });
    const spec = opened[0] || {};
    const body = el('div');
    spec.body(body);
    const rows = body.all('sauce-dp-sd-row');
    ok('DP-SHUT-6 the modal lists Done today read-only and Still open with five choices per task',
      spec.title === 'Shut down the day' && body.all('sauce-dp-sd-done').map((d) => d.textContent).join('|') === 'Write tests|Finished pin'
      && rows.map((r) => r.getAttribute('data-path')).join('|') === 'spice/tasks/Old pin/Old pin.md|spice/tasks/Call bank/Call bank.md|spice/tasks/Pay rent/Pay rent.md|spice/tasks/Ship routes/Ship routes.md'
      && rows.every((r) => r.all('sauce-dp-sd-choice').map((b) => b.textContent).join('|') === 'Tomorrow|Next work day|Pick date|Done|Leave'),
      rows.map((r) => r.getAttribute('data-path')).join('|'));
    ok('DP-SHUT-7 Leave is chosen until you pick', rows.every((r) => r.all('sauce-dp-sd-choice').find((b) => b.classList.contains('is-active')).textContent === 'Leave'));
    await rows[0].all('sauce-dp-sd-choice')[0].fire('click');
    await rows[2].all('sauce-dp-sd-choice')[3].fire('click');
    await rows[3].all('sauce-dp-sd-choice')[2].fire('click');
    const date = rows[3].one('sauce-dp-sd-date');
    let closed = false;
    const footer = el('div');
    spec.footer(footer, { close: () => { closed = true; } });
    const finishBtn = footer.one('sauce-dp-finish');
    const hint = footer.one('sauce-dp-sd-hint');
    ok('DP-SHUT-9 Finish is disabled with a hint while a Pick date has no date',
      finishBtn && finishBtn.disabled === true && hint && hint.style.display === '' && /Pick a date/.test(hint.textContent) && !finished);
    await finishBtn.fire('click');
    ok('DP-SHUT-10 a click on the disabled Finish does nothing', !closed && !finished);
    date.value = '2026-11-25';
    await date.fire('change');
    ok('DP-SHUT-11 picking the date enables Finish and hides the hint', finishBtn.disabled === false && hint.style.display === 'none');
    await finishBtn.fire('click');
    await new Promise((r) => setTimeout(r, 0));
    DPC.finishShutdown = orig;
  }

  // ---------- review fixes: pin clears, Now by path, done refused, twice, _done skip, moved subtask ----------
  {
    const { DP, app, notices } = setup();
    const realPfm = app.fileManager.processFrontMatter;
    app.fileManager.processFrontMatter = async (f, fn) => {
      if (f.path === 'spice/tasks/Old pin/Old pin.md') throw new Error('locked');
      return realPfm(f, fn);
    };
    const res = await DP.togglePin(app, 'spice/tasks/Call bank/Call bank.md');
    const fm = (p) => app._byPath.get(p).fm;
    ok('DP-PIN-7 the target write is the pin; a failed clear is counted and named in one notice',
      res.ok === true && res.value && res.value.uncleared === 1 && fm('spice/tasks/Call bank/Call bank.md').pinned_at
      && !('pinned_at' in fm('spice/tasks/Ship routes/Ship routes.md')) && fm('spice/tasks/Old pin/Old pin.md').pinned_at
      && notices.filter((n) => /^Pinned; couldn't clear 1 other pin$/.test(n)).length === 1, JSON.stringify(notices));
    ok('DP-PIN-8 Now is still the task just pinned', DP.nowPath(app) === 'spice/tasks/Call bank/Call bank.md');
  }
  {
    const { DP, app } = setup();
    const head = el('div');
    const btn = DP.renderPinButton(head, { path: 'spice/tasks/Old pin/Old pin.md', status: 'open' });
    const entry = DP.menuEntry({ path: 'spice/tasks/Old pin/Old pin.md', status: 'open' });
    ok('DP-PIN-9 a task with an older pinned_at that is not Now reads Pin as Now, on the button and in the menu',
      btn.getAttribute('aria-label') === 'Pin as Now' && entry.label === 'Pin as Now' && DP.isNow(app, 'spice/tasks/Old pin/Old pin.md') === false);
    await entry.onSelect();
    await new Promise((r) => setTimeout(r, 0));
    ok('DP-PIN-10 choosing it makes it Now (it pins, it does not unpin)', DP.nowPath(app) === 'spice/tasks/Old pin/Old pin.md'
      && app._byPath.get('spice/tasks/Old pin/Old pin.md').fm.pinned_at === TODAY + 'T17:30:00-06:00');
  }
  {
    const { DP, app, notices } = setup();
    const before = app._writes.length;
    const res = await DP.togglePin(app, 'spice/tasks/Ship routes/Write tests/Write tests.md');
    let threw = false;
    try { await DP.constructor.pin(app, 'spice/tasks/Ship routes/Write tests/Write tests.md', 'x'); } catch (_e) { threw = true; }
    ok('DP-PIN-11 pinning a done task is refused with a notice and writes nothing',
      res.ok === false && threw && app._writes.length === before && notices.some((n) => n === 'Only an open task can be Now'), JSON.stringify(notices));
  }
  {
    const { DP, app, win, notices } = setup({ doc: { body: {}, head: null } });
    const opened = [];
    win.customJS.SauceModal = { open: (o) => { opened.push(o); return { close() {} }; } };
    let release;
    win.customJS.TaskTodayList = { reschedule: () => new Promise((r) => { release = () => r({ ok: true }); }) };
    win.customJS.TaskDialog = { open() {}, markDone: async () => ({ ok: true }) };
    const run = DP.finishShutdown({ app, today: TODAY, tasks: [{ path: 'spice/tasks/Call bank/Call bank.md', title: 'Call bank', status: 'open' }], done: [],
      choices: new Map([['spice/tasks/Call bank/Call bank.md', { key: 'tomorrow' }]]) });
    const second = DP.openShutdown({ app, today: TODAY });
    ok('DP-SHUT-12 while Finish is still writing, Shut down will not open again',
      second === null && opened.length === 0 && notices.includes('Shut down is still finishing'), JSON.stringify(notices));
    await new Promise((r) => setTimeout(r, 0));
    release();
    await run;
    const third = DP.openShutdown({ app, today: TODAY });
    ok('DP-SHUT-13 once it is done Shut down opens again', third !== null && opened.length === 1);
    win.customJS.TaskTodayList = { reschedule: async () => { throw new Error('boom'); } };
    win.customJS.TaskDialog = { open() {}, markDone: async () => { throw new Error('boom'); } };
    app.vault.adapter.read = async () => { throw new Error('boom'); };
    await DP.finishShutdown({ app, today: TODAY, tasks: [], done: [], choices: new Map() });
    ok('DP-SHUT-14 the flag clears even when a run fails', DP.openShutdown({ app, today: TODAY }) !== null);
  }
  {
    const files = FILES.concat([
      TASK('spice/tasks/_done/2026/10/Ancient/Ancient.md', { title: 'Ancient', status: 'done', completed_at: '2026-10-01T09:00:00-06:00' }),
      TASK('spice/tasks/_done/2026/11/Today done/Today done.md', { title: 'Today done', status: 'done', completed_at: '2026-11-13T07:00:00-06:00' }),
      TASK('spice/tasks/_done/2026/11/Today done/Open child/Open child.md', { title: 'Open child', status: 'open', due: '2026-11-12' }),
    ]);
    const { DP, app } = setup({ files });
    let reads = 0;
    const real = app.metadataCache.getFileCache;
    app.metadataCache.getFileCache = (f) => { reads++; return real(f); };
    const recs = DP.collect(app, { today: TODAY }).map((r) => r.basename);
    const m = DP.build({ today: TODAY });
    ok('DP-PERF-1 build skips _done/ notes unless they were finished today (an open one stays)',
      !recs.includes('Ancient') && recs.includes('Today done') && recs.includes('Open child')
      && !m.tasks.some((t) => t.title === 'Ancient') && m.overdue.some((t) => t.title === 'Open child') && reads > 0, JSON.stringify(recs));
    ok('DP-PERF-2 without a day, collect keeps everything (pin clearing sees every task)', DP.collect(app).some((r) => r.basename === 'Ancient'));
  }
  {
    const { DP, app, win } = setup({ app: { dailyConfig: { folder: 'spice/daily', format: 'YYYY/MM-MMMM/dddd-YYYY-MM-DD' } } });
    const calls = [];
    const move = (from, to) => {
      const f = app._byPath.get(from);
      app._byPath.delete(from);
      f.path = to;
      app._byPath.set(to, f);
    };
    win.customJS.TaskTodayList = { reschedule: async (row, task, due) => { calls.push(['move', task.path, due]); return app._byPath.has(task.path) ? { ok: true, due } : { ok: false }; } };
    win.customJS.TaskDialog = {
      open() {},
      markDone: async (p) => {
        calls.push(['done', p]);
        if (!app._byPath.has(p)) return { ok: false, reason: 'task file not found' };
        if (p === 'spice/tasks/Ship routes/Ship routes.md') {
          for (const q of [...app._byPath.keys()].filter((k) => k.indexOf('spice/tasks/Ship routes/') === 0)) move(q, q.replace('spice/tasks/', 'spice/tasks/_done/2026/11/'));
          return { ok: true, path: 'spice/tasks/_done/2026/11/Ship routes/Ship routes.md' };
        }
        return { ok: true, path: p };
      },
    };
    move('spice/tasks/Call bank/Call bank.md', 'spice/tasks/Errands/Call bank/Call bank.md');
    const res = await DP.finishShutdown({ app, today: TODAY, done: [],
      tasks: [
        { path: 'spice/tasks/Ship routes/Ship routes.md', title: 'Ship routes', status: 'open' },
        { path: 'spice/tasks/Ship routes/Deploy/Deploy.md', title: 'Deploy', status: 'open' },
        { path: 'spice/tasks/Ship routes/Write tests/Write tests.md', title: 'Write tests', status: 'open' },
        { path: 'spice/tasks/Call bank/Call bank.md', title: 'Call bank', status: 'open' },
      ],
      choices: new Map([
        ['spice/tasks/Ship routes/Ship routes.md', { key: 'done' }],
        ['spice/tasks/Ship routes/Deploy/Deploy.md', { key: 'tomorrow' }],
        ['spice/tasks/Ship routes/Write tests/Write tests.md', { key: 'done' }],
        ['spice/tasks/Call bank/Call bank.md', { key: 'next' }],
      ]) });
    ok('DP-SHUT-15 a parent and its subtask in one run: moves go first, Done last, each at the task\'s current path',
      JSON.stringify(calls) === JSON.stringify([
        ['move', 'spice/tasks/Ship routes/Deploy/Deploy.md', '2026-11-14'],
        ['move', 'spice/tasks/Errands/Call bank/Call bank.md', '2026-11-16'],
        ['done', 'spice/tasks/Ship routes/Ship routes.md'],
        ['done', 'spice/tasks/_done/2026/11/Ship routes/Write tests/Write tests.md'],
      ]) && res.failed === 0 && res.moved.length === 2, JSON.stringify(calls));
  }

  // ---------- command ----------
  {
    const added = [];
    let openedWith = null;
    const win = { app: { commands: { addCommand: (c) => added.push(c) } } };
    const Init = new Function('window', 'customJS', 'Notice', 'console', `${INIT_SRC}\nreturn TaskDayPlanInit;`)(win, { TaskDayPlan: { openShutdown: (o) => { openedWith = o; } } }, function () {}, console);
    const init = new Init();
    init.invoke();
    init.invoke();
    ok('DP-INIT-1 registers Sauce: Shut down the day once', added.length === 1 && added[0].id === 'sauce:shut-down-day' && added[0].name === 'Sauce: Shut down the day');
    added[0].callback();
    ok('DP-INIT-2 the command opens Shut down', openedWith && openedWith.app === win.app);
  }

  // ---------- wiring ----------
  {
    const manifest = JSON.parse(read('platform/mechanisms/task-entity/manifest.json'));
    ok('DP-WIRE-1 the manifest ships TaskDayPlan and its startup script',
      manifest.customjs_classes.includes('TaskDayPlan') && manifest.customjs_classes.includes('TaskDayPlanInit')
      && manifest.customjs_startup_scripts.includes('TaskDayPlanInit')
      && manifest.files.some((f) => f.source === 'task-day-plan.js') && manifest.files.some((f) => f.source === 'task-day-plan-init.js'));
    const ttl = read('platform/mechanisms/task-entity/task-today-list.js');
    ok('DP-WIRE-2 the To-Do row ⋯ menu offers the pin entry before Delete',
      /DP\.menuEntry\(task\)[\s\S]{0,200}entries\.push\(pin\)[\s\S]{0,120}label: 'Delete'/.test(ttl));
    ok('DP-WIRE-3 the task card header draws the pin button', /DP\.renderPinButton\(head, \{ path: filePath, status \}\)/.test(read('platform/mechanisms/task-entity/task-note-view.js')));
    const sdd = read('platform/blueprints/daily/helpers/space-daily-dashboard.js');
    ok('DP-WIRE-4 the daily dashboard draws the day plan collapsed, only on today, unless told not to',
      /params\.dayPlan === false[\s\S]{0,120}isLivePanel\(today, wallToday\)[\s\S]{0,80}DP\.renderDay\(container, \{ today, dv, meetingPages: meetings, surface: "daily", open: false \}\)/.test(sdd));
    const home = read('platform/blueprints/home/helpers/space-home.js');
    ok('DP-WIRE-5 Home draws its own open panel and tells the dashboard not to',
      /dayPlan: false/.test(home) && /surface: "home", open: true/.test(home));
    ok('DP-WIRE-6 pin, unpin and the shutdown write sit inside RenderSafe.mutate',
      /return RenderSafe\.mutate\(\{[\s\S]{0,300}write: \(\) => \(pinned \? TaskDayPlan\.unpin/.test(DP_SRC)
      && /return RenderSafe\.mutate\(\{[\s\S]{0,200}write: \(\) => app\.vault\.process\(file, \(data\) => TaskDayPlan\.replaceShutdown\(data, build\(data\)\)\)/.test(DP_SRC)
      && (DP_SRC.match(/app\.vault\.process\(/g) || []).length === 1);
    ok('DP-WIRE-7 no wall clock in the class (moment only, through window)', !/Date\.now\(|new Date\(|Math\.random/.test(DP_SRC));
    for (const rel of ['task-entity/task-day-plan.js', 'task-entity/task-day-plan-init.js', 'task-entity/task-today-list.js', 'task-entity/task-note-view.js']) {
      ok('DP-MIRROR ranch/scripts/' + rel + ' equals its platform source', read('ranch/scripts/' + rel) === read('platform/mechanisms/' + rel));
    }
    ok('DP-MIRROR ranch/scripts/home/space-home.js equals its platform source', read('ranch/scripts/home/space-home.js') === read('platform/blueprints/home/helpers/space-home.js'));
    ok('DP-MIRROR ranch/scripts/daily/space-daily-dashboard.js equals its platform source', read('ranch/scripts/daily/space-daily-dashboard.js') === read('platform/blueprints/daily/helpers/space-daily-dashboard.js'));
  }

  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
