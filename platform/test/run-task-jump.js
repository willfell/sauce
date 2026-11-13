#!/usr/bin/env node
/**
 * run-task-jump.js — Jump to task or note. TaskJump builds the picker rows
 * from metadata-cache records (open tasks, then done, then trashed, then task
 * notes, leaving out spice/tasks/_sets/), ranks them for a query, draws each
 * row (checkbox glyph or kind icon, title, parent trail, status or due date)
 * and opens the chosen note, in a new tab on Mod+Enter. TaskJumpInit
 * registers the `Sauce: Jump to task or note` command, and the To-Do and Home
 * chrome bars carry a search button that opens it. Zero-dep; exit 0 iff all
 * pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c, d) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${c || d == null ? '' : ' — ' + d}`); };
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const TEClass = new Function(`${read('platform/mechanisms/task-entity/task-entity.js')}\nreturn TaskEntity;`)();
const TDClass = new Function('window', 'Notice', `${read('platform/mechanisms/task-entity/task-docs.js')}\nreturn TaskDocs;`);
const loadJump = (win, notice) => new Function('window', 'Notice', 'document', `${read('platform/mechanisms/task-entity/task-jump.js')}\nreturn TaskJump;`)(win, notice || function () {}, undefined);

const win = { customJS: { TaskEntity: new TEClass() } };
const TDC = TDClass(win, function () {});
win.customJS.TaskDocs = new TDC();
const TJ = loadJump(win);
const KINDS = TDC.KINDS;

const rec = (p, fm, mtime) => ({ path: p, basename: p.split('/').pop().replace(/\.md$/, ''), mtime: mtime || 0, fm });
const RECORDS = [
  rec('spice/tasks/Help Henry out with Routes/Help Henry out with Routes.md', { type: 'task', title: 'Help Henry out with Routes', status: 'open', due: '2026-11-20' }),
  rec('spice/tasks/Help Henry out with Routes/Review the routes PR/Review the routes PR.md', { type: 'task', title: 'Review the routes PR', status: 'open', due: '2026-11-10' }),
  rec('spice/tasks/Help Henry out with Routes/Write tests/Write tests.md', { type: 'task', title: 'Write tests', status: 'done', completed_at: '2026-11-12T10:00:00-06:00' }),
  rec('spice/tasks/Help Henry out with Routes/notes/Kickoff prompt.md', { type: 'task-doc', kind: 'prompt', title: 'Kickoff prompt', task: '[[Help Henry out with Routes]]' }, 300),
  rec('spice/tasks/Help Henry out with Routes/notes/Routes findings.md', { type: 'task-doc', kind: 'findings', title: 'Routes findings', task: '[[Help Henry out with Routes]]' }, 500),
  rec('spice/tasks/Inbox zero/Inbox zero.md', { type: 'task', title: 'Inbox zero', status: 'open' }),
  rec('spice/tasks/_done/2026/11/Pay Bills/Pay Bills.md', { type: 'task', title: 'Pay Bills', status: 'done', completed_at: '2026-11-05T09:00:00-06:00' }),
  rec('spice/tasks/_done/2026/11/Pay Bills/Call the bank/Call the bank.md', { type: 'task', title: 'Call the bank', status: 'open' }),
  rec('spice/tasks/_done/2026/10/Old Ledger/Old Ledger.md', { type: 'task', title: 'Old Ledger' }),
  rec('spice/tasks/_trash/Old idea/Old idea.md', { type: 'task', title: 'Old idea', status: 'open' }, 100),
  rec('spice/tasks/Gone/Gone.md', { type: 'task', title: 'Gone', status: 'deleted' }, 200),
  rec('spice/tasks/Flat child.md', { type: 'task', title: 'Flat child', status: 'open', parent_task: '[[Inbox zero]]' }),
  rec('spice/tasks/Loose note.md', { type: 'task-doc', kind: 'runbook', title: 'Loose note', task: '[[Inbox zero|Inbox]]' }, 100),
  rec('spice/tasks/_sets/PR rollout.md', { type: 'task-set', title: 'PR rollout' }),
  rec('spice/tasks/_sets/Deploy/Deploy.md', { type: 'task', title: 'Deploy set task', status: 'open' }),
  rec('spice/tasks/Help Henry out with Routes/brief.md', { type: 'reference', title: 'Brief' }),
  rec('spice/projects/x/X Task.md', { type: 'task', title: 'Not in tasks', status: 'open' }),
  rec('spice/tasks/Untitled/Untitled.md', { type: 'task', status: 'open' }),
];
const items = TJ.build(RECORDS, { today: '2026-11-13' });
const byTitle = (t) => items.find((i) => i.title === t);
const titles = items.map((i) => i.title);

ok('TJ-BUILD-1 lists only type task and task-doc notes under spice/tasks, leaving out spice/tasks/_sets/',
  !titles.includes('PR rollout') && !titles.includes('Deploy set task') && !titles.includes('Brief') && !titles.includes('Not in tasks')
  && titles.length === 14, JSON.stringify(titles));

const groups = items.map((i) => i.group);
ok('TJ-BUILD-2 order is open tasks, then done, then trashed, then task notes',
  groups.every((g, i) => i === 0 || groups[i - 1] <= g)
  && items.filter((i) => i.group === 0).every((i) => i.task && i.state === 'open')
  && items.filter((i) => i.group === 1).every((i) => i.task && i.state === 'done')
  && items.filter((i) => i.group === 2).every((i) => i.task && i.state === 'deleted')
  && items.filter((i) => i.group === 3).every((i) => !i.task), JSON.stringify(items.map((i) => [i.title, i.group])));

ok('TJ-BUILD-3 status decides the state; a note under _trash/ is trashed; a note with no status under _done/ is done; an open subtask under _done/ stays open',
  byTitle('Write tests').state === 'done' && byTitle('Gone').state === 'deleted' && byTitle('Old idea').state === 'deleted'
  && byTitle('Old Ledger').state === 'done' && byTitle('Call the bank').state === 'open' && byTitle('Inbox zero').state === 'open'
  && TJ.stateOf('spice/tasks/_done/2026/11/A/A.md', { status: 'open' }) === 'open'
  && TJ.stateOf('spice/tasks/_trash/A/A.md', { status: 'done' }) === 'deleted');

const open = items.filter((i) => i.group === 0).map((i) => i.title);
const done = items.filter((i) => i.group === 1).map((i) => i.title);
const trashed = items.filter((i) => i.group === 2).map((i) => i.title);
const notes = items.filter((i) => i.group === 3).map((i) => i.title);
ok('TJ-BUILD-4 open tasks by due date with undated last (then by title); done newest completed first; trashed and notes newest first',
  JSON.stringify(open) === JSON.stringify(['Review the routes PR', 'Help Henry out with Routes', 'Call the bank', 'Flat child', 'Inbox zero', 'Untitled'])
  && JSON.stringify(done) === JSON.stringify(['Write tests', 'Pay Bills', 'Old Ledger'])
  && JSON.stringify(trashed) === JSON.stringify(['Gone', 'Old idea'])
  && JSON.stringify(notes) === JSON.stringify(['Routes findings', 'Kickoff prompt', 'Loose note']),
  JSON.stringify({ open, done, trashed, notes }));

ok('TJ-BUILD-5 the parent trail follows the task folders (TaskEntity.parentNotePathOf); _done/ and _trash/ folders are not parents',
  JSON.stringify(byTitle('Review the routes PR').trail) === JSON.stringify(['Help Henry out with Routes'])
  && JSON.stringify(byTitle('Call the bank').trail) === JSON.stringify(['Pay Bills'])
  && byTitle('Pay Bills').trail.length === 0 && byTitle('Old idea').trail.length === 0
  && byTitle('Help Henry out with Routes').trail.length === 0);

ok('TJ-BUILD-6 a flat task takes its trail from parent_task; a note shows its task (and the task\'s parents); a loose note falls back to task:',
  JSON.stringify(byTitle('Flat child').trail) === JSON.stringify(['Inbox zero'])
  && JSON.stringify(byTitle('Kickoff prompt').trail) === JSON.stringify(['Help Henry out with Routes'])
  && JSON.stringify(byTitle('Loose note').trail) === JSON.stringify(['Inbox zero']));
{
  const deep = TJ.build([
    rec('spice/tasks/A/A.md', { type: 'task', title: 'Alpha' }),
    rec('spice/tasks/A/B/B.md', { type: 'task', title: 'Beta' }),
    rec('spice/tasks/A/B/notes/N.md', { type: 'task-doc', kind: 'plan', title: 'N' }),
    rec('spice/tasks/A/B/C/C.md', { type: 'task', title: 'Gamma' }),
  ], {});
  const t = (x) => deep.find((i) => i.title === x).trail.join(' › ');
  ok('TJ-BUILD-7 trails run from the top task down, using titles, for subtasks and notes at any depth',
    t('Gamma') === 'Alpha › Beta' && t('N') === 'Alpha › Beta' && t('Alpha') === '');
}

ok('TJ-BUILD-8 the status or due date: Due <Mon D>, late when before today, the year when not this year; Open, Done, Trashed',
  byTitle('Help Henry out with Routes').meta === 'Due Nov 20' && byTitle('Help Henry out with Routes').late === false
  && byTitle('Review the routes PR').meta === 'Due Nov 10' && byTitle('Review the routes PR').late === true
  && byTitle('Inbox zero').meta === 'Open' && byTitle('Write tests').meta === 'Done' && byTitle('Gone').meta === 'Trashed'
  && TJ.fmtDay('2027-01-04', '2026-11-13') === 'Jan 4, 2027' && TJ.fmtDay('', '2026-11-13') === '');

ok('TJ-BUILD-9 a note shows its kind; an unknown kind reads as Note; a task with no title uses its file name',
  byTitle('Kickoff prompt').kind === 'prompt' && byTitle('Kickoff prompt').meta === 'Prompt'
  && byTitle('Loose note').kind === 'note' && byTitle('Loose note').meta === 'Note'
  && !!byTitle('Untitled') && byTitle('Untitled').task === true && byTitle('Untitled').kind === 'task');

ok('TJ-BUILD-10 pure: no clock — build without opts.today never marks a row late and reads no date',
  TJ.build(RECORDS, {}).every((i) => i.late === false) && !/Date\.now|new Date|Math\.random/.test(TJ.build.toString() + TJ.rank.toString() + TJ.score.toString()));

ok('TJ-RANK-1 an empty or blank query keeps every row in build order',
  JSON.stringify(TJ.rank(items, '').map((i) => i.path)) === JSON.stringify(items.map((i) => i.path))
  && TJ.rank(items, '   ').length === items.length && TJ.rank(items, '') !== items);

{
  const s = (q, t, x) => { const r = TJ.score(q, t, x); return r ? r.tier : 0; };
  ok('TJ-RANK-2 tiers: exact > starts with > a word starts with > inside > every word inside > title or trail > letters in order > no match',
    s('pay bills', 'Pay Bills') === 7 && s('pay', 'Pay Bills') === 6 && s('bil', 'Pay Bills') === 5
    && s('ill', 'Pay Bills') === 4 && s('bills pay', 'Pay Bills') === 3 && s('henry', 'Write tests', 'Help Henry out') === 2
    && s('pybl', 'Pay Bills') === 1 && TJ.score('xyz', 'Pay Bills', 'Henry') === null && s('ill', 'Pay Bills') > s('pybl', 'Pay Bills'));
}

{
  const r = TJ.rank(items, 'routes').map((i) => i.title);
  ok('TJ-RANK-3 a query ranks title matches first, then rows whose trail matches it',
    r[0] === 'Routes findings' && r.indexOf('Review the routes PR') < r.indexOf('Write tests')
    && r.includes('Kickoff prompt') && r.includes('Write tests') && !r.includes('Inbox zero'), JSON.stringify(r));
}

{
  const tie = TJ.build([
    rec('spice/tasks/_trash/Plan trip/Plan trip.md', { type: 'task', title: 'Plan trip' }),
    rec('spice/tasks/Plan trip 2/Plan trip 2.md', { type: 'task', title: 'Plan trip', status: 'done' }),
    rec('spice/tasks/Plan trip 3/Plan trip 3.md', { type: 'task', title: 'Plan trip', status: 'open' }),
    rec('spice/tasks/X/notes/Plan trip.md', { type: 'task-doc', kind: 'plan', title: 'Plan trip' }),
  ], {});
  const r = TJ.rank(tie, 'plan trip');
  ok('TJ-RANK-4 equal matches order open task, done task, trashed task, then note',
    r.map((i) => (i.task ? i.state : 'doc')).join(',') === 'open,done,deleted,doc');
}

{
  const r = TJ.rank(items, 'prompt').map((i) => i.title);
  const none = TJ.rank(items, 'qqqzz');
  ok('TJ-RANK-5 a note\'s kind is searchable ("prompt" finds the prompt note); nothing matches gives no rows',
    r.includes('Kickoff prompt') && none.length === 0);
}

ok('TJ-NEWTAB Mod (Cmd or Ctrl) means a new tab',
  TJ.isNewTab({ metaKey: true }) && TJ.isNewTab({ ctrlKey: true }) && !TJ.isNewTab({}) && !TJ.isNewTab(null));

{
  const leaves = [];
  const files = { 'spice/tasks/A/A.md': { path: 'spice/tasks/A/A.md' } };
  const app = {
    vault: { getAbstractFileByPath: (p) => files[p] || null },
    workspace: {
      getLeaf: (how) => ({ openFile: (f) => leaves.push([how, f.path]) }),
      openLinkText: (p, src, nt) => leaves.push(['link', p, nt]),
    },
  };
  TJ.openItem(app, { path: 'spice/tasks/A/A.md' }, false);
  TJ.openItem(app, { path: 'spice/tasks/A/A.md' }, true);
  TJ.openItem(app, { path: 'spice/tasks/Missing.md' }, true);
  ok('TJ-OPEN Enter opens in the current tab, Mod+Enter in a new tab (getLeaf("tab")); a missing file falls back to openLinkText',
    JSON.stringify(leaves) === JSON.stringify([[false, 'spice/tasks/A/A.md'], ['tab', 'spice/tasks/A/A.md'], ['link', 'spice/tasks/Missing.md', true]]));
}

function makeEl(tag) {
  const classes = new Set();
  const attrs = {};
  const el = { tag, children: [], textContent: '', innerHTML: '' };
  Object.defineProperty(el, 'className', { get: () => [...classes].join(' '), set: (v) => { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); } });
  el.classList = { add: (...n) => n.forEach((c) => classes.add(c)), contains: (c) => classes.has(c) };
  el.setAttribute = (k, v) => { attrs[k] = String(v); };
  el.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  el.createEl = (t, o) => { const c = makeEl(t); if (o && o.cls) c.className = o.cls; if (o && o.text != null) c.textContent = String(o.text); el.children.push(c); return c; };
  return el;
}
const all = (el) => el.children.flatMap((c) => [c, ...all(c)]);
const find = (el, cls) => all(el).find((c) => c.classList.contains(cls));

{
  const row = makeEl('div');
  TJ.renderRow(byTitle('Review the routes PR'), row);
  const doneRow = makeEl('div');
  TJ.renderRow(byTitle('Write tests'), doneRow);
  const noteRow = makeEl('div');
  TJ.renderRow(byTitle('Kickoff prompt'), noteRow);
  const prompt = KINDS.find((k) => k.key === 'prompt');
  ok('TJ-ROW-1 a task row shows a checkbox glyph (ticked when done), its title, its trail and its due date, marked late',
    row.classList.contains('mod-complex') && find(row, 'sauce-tj-icon').innerHTML === TJ.ICON.open
    && find(doneRow, 'sauce-tj-icon').innerHTML === TJ.ICON.done && TJ.ICON.open !== TJ.ICON.done
    && find(row, 'suggestion-title').textContent === 'Review the routes PR'
    && find(row, 'sauce-tj-trail').textContent === 'Help Henry out with Routes'
    && find(row, 'sauce-tj-meta').textContent === 'Due Nov 10' && find(row, 'sauce-tj-meta').classList.contains('is-late'));
  const deep = TJ.build([rec('spice/tasks/A/A.md', { type: 'task', title: 'Alpha' }), rec('spice/tasks/A/B/B.md', { type: 'task', title: 'Beta' }), rec('spice/tasks/A/B/C/C.md', { type: 'task', title: 'Gamma' })], {});
  const deepRow = makeEl('div');
  TJ.renderRow(deep.find((i) => i.title === 'Gamma'), deepRow);
  const top = makeEl('div');
  TJ.renderRow(byTitle('Inbox zero'), top);
  ok('TJ-ROW-2 a note row shows its kind icon (TaskDocs.KINDS) and kind; trails join with ›; a top-level task has no trail line',
    find(noteRow, 'sauce-tj-icon').innerHTML === prompt.icon && find(noteRow, 'sauce-tj-icon').getAttribute('data-kind') === 'prompt'
    && find(noteRow, 'sauce-tj-meta').textContent === 'Prompt'
    && find(deepRow, 'sauce-tj-trail').textContent === 'Alpha › Beta' && !find(top, 'sauce-tj-trail'));
  const trashRow = makeEl('div');
  TJ.renderRow(byTitle('Gone'), trashRow);
  ok('TJ-ROW-3 a trashed task row is struck through and shows Trashed; renderRow never throws on bad input',
    find(trashRow, 'suggestion-title').classList.contains('is-trashed') && find(trashRow, 'sauce-tj-meta').textContent === 'Trashed'
    && (() => { try { TJ.renderRow(null, null); TJ.renderRow({}, {}); return true; } catch (_e) { return false; } })());
}

{
  const notices = [];
  class FakeSuggestModal {
    constructor(app) {
      this.app = app;
      this.keys = [];
      this.scope = { register: (mods, key, fn) => this.keys.push({ mods, key, fn }) };
      this.modalEl = makeEl('div');
    }
    setPlaceholder(p) { this.placeholder = p; }
    setInstructions(i) { this.instructions = i; }
    open() { this.opened = true; }
    selectActiveSuggestion(evt) { this.onChooseSuggestion(this.getSuggestions(this.query || '')[0], evt); }
  }
  const leaves = [];
  const mdFiles = RECORDS.map((r) => ({ path: r.path, basename: r.basename, stat: { mtime: r.mtime }, _fm: r.fm }));
  const app = {
    isMobile: false,
    vault: { getMarkdownFiles: () => mdFiles, getAbstractFileByPath: (p) => mdFiles.find((f) => f.path === p) || null },
    metadataCache: { getFileCache: (f) => ({ frontmatter: f._fm }) },
    workspace: { getLeaf: (how) => ({ openFile: (f) => leaves.push([how, f.path]) }), openLinkText() {} },
  };
  const mwin = {
    app,
    moment: () => ({ format: () => '2026-11-13' }),
    customJS: { TaskEntity: win.customJS.TaskEntity, TaskDocs: win.customJS.TaskDocs, obsidian: { SuggestModal: FakeSuggestModal, Platform: { isMacOS: true } } },
  };
  const MJ = loadJump(mwin, function (m) { notices.push(m); });
  const modal = MJ.open();
  ok('TJ-MODAL-1 open() builds a SuggestModal (customJS.obsidian) over the vault\'s tasks and notes and opens it',
    modal && modal instanceof FakeSuggestModal && modal.opened === true && modal.placeholder === 'Jump to a task or note'
    && modal.getSuggestions('').length === 14 && modal.getSuggestions('pay bills')[0].title === 'Pay Bills'
    && modal.modalEl.classList.contains('sauce-tj-modal'));
  modal.onChooseSuggestion(modal.getSuggestions('inbox zero')[0], {});
  const mod = modal.keys.find((k) => k.key === 'Enter' && JSON.stringify(k.mods) === JSON.stringify(['Mod']));
  modal.query = 'kickoff';
  if (mod) mod.fn({ metaKey: true });
  ok('TJ-MODAL-2 Enter opens in the current tab; Mod+Enter is registered and opens in a new tab',
    !!mod && JSON.stringify(leaves) === JSON.stringify([[false, 'spice/tasks/Inbox zero/Inbox zero.md'], ['tab', 'spice/tasks/Help Henry out with Routes/notes/Kickoff prompt.md']]));
  ok('TJ-MODAL-3 the desktop shows the keys (⌘ ↵ opens in a new tab); the phone shows none',
    Array.isArray(modal.instructions) && modal.instructions.some((i) => i.command === '⌘ ↵' && /new tab/.test(i.purpose))
    && (() => { app.isMobile = true; const m = MJ.open(); app.isMobile = false; return m && m.instructions === undefined; })());
  const bare = loadJump({ app, customJS: {} }, function (m) { notices.push(m); });
  ok('TJ-MODAL-4 without SuggestModal (customJS still loading) open() returns null with a notice, never throws',
    bare.open() === null && notices.length === 1);
}

{
  const added = [];
  const opened = [];
  const prev = { window: global.window, customJS: global.customJS };
  global.window = { app: { commands: { addCommand: (c) => added.push(c) } } };
  global.customJS = { TaskJump: { open: () => opened.push(1) } };
  const Init = new Function(`${read('platform/mechanisms/task-entity/task-jump-init.js')}\nreturn TaskJumpInit;`)();
  const init = new Init();
  init.invoke();
  init.invoke();
  if (added[0]) added[0].callback();
  ok('TJ-INIT TaskJumpInit registers "Sauce: Jump to task or note" once; the command opens TaskJump',
    added.length === 1 && added[0].id === 'sauce:jump-to-task' && added[0].name === 'Sauce: Jump to task or note' && opened.length === 1);
  global.window = prev.window;
  global.customJS = prev.customJS;
}

{
  const m = JSON.parse(read('platform/mechanisms/task-entity/manifest.json'));
  ok('TJ-MANIFEST task-entity ships TaskJump and TaskJumpInit, runs TaskJumpInit at startup, and installs both files',
    m.customjs_classes.includes('TaskJump') && m.customjs_classes.includes('TaskJumpInit')
    && Array.isArray(m.customjs_startup_scripts) && m.customjs_startup_scripts.includes('TaskJumpInit')
    && ['task-jump.js', 'task-jump-init.js'].every((s) => m.files.some((f) => f.source === s && f.dest === '{{scripts_path}}/task-entity/' + s)));
  const pairs = [
    ['platform/mechanisms/task-entity/task-jump.js', 'ranch/scripts/task-entity/task-jump.js'],
    ['platform/mechanisms/task-entity/task-jump-init.js', 'ranch/scripts/task-entity/task-jump-init.js'],
    ['platform/mechanisms/chrome-bar/chrome-bar.js', 'ranch/scripts/chrome-bar/chrome-bar.js'],
    ['platform/blueprints/to-do/helpers/todo-chrome-bar.js', 'ranch/scripts/to-do/todo-chrome-bar.js'],
    ['platform/blueprints/home/helpers/home-chrome-bar.js', 'ranch/scripts/home/home-chrome-bar.js'],
  ];
  ok('TJ-MIRROR ranch mirrors equal their platform sources', pairs.every(([a, b]) => fs.existsSync(path.join(ROOT, b)) && read(a) === read(b)));
}

{
  const load = (rel, name) => new Function(`${read(rel)}\nreturn ${name};`)();
  const ToDo = load('platform/blueprints/to-do/helpers/todo-chrome-bar.js', 'ToDoChromeBar');
  const Home = load('platform/blueprints/home/helpers/home-chrome-bar.js', 'HomeChromeBar');
  const tcfg = new ToDo()._config();
  const hcfg = new Home()._config();
  const jumpOf = (spec) => (spec.iconActions || []).find((a) => a.id === 'jump');
  const contexts = ['to-do', 'to-do-hub', 'project-todo', 'to-do-recurring', 'to-do-recurring-list'];
  ok('TJ-BAR-1 every To-Do bar and the Home bar carry the Jump search button (icon only, labelled)',
    contexts.every((c) => { const j = jumpOf(tcfg.surfaceSpec({ context: c })); return j && /<svg/.test(j.icon) && j.label === 'Jump to task or note'; })
    && !!jumpOf(hcfg.surfaceSpec({})));
  const opened = [];
  const prev = { window: global.window, Notice: global.Notice };
  global.window = { customJS: { TaskJump: { open: () => opened.push('open') } } };
  tcfg.dispatch({}, { context: 'to-do' }, 'jump');
  hcfg.dispatch({}, {}, 'jump');
  hcfg.dispatch({}, {}, 'other');
  ok('TJ-BAR-2 the search button opens TaskJump on both bars', opened.length === 2);
  global.window = prev.window;
}

const failed = results.filter(([, c]) => !c);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
process.exit(0);
