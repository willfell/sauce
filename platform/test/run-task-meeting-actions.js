#!/usr/bin/env node
/**
 * run-task-meeting-actions.js — meeting action items become tasks. A line in a
 * meeting note starting with `->` or `→` is an action item (`-> thing` is
 * mine, `-> Name: thing` someone else's, with an optional trailing
 * `(due Fri)` / `(due tomorrow)` / `(due 2026-11-20)`). The Make tasks button
 * on the meeting's task section (TaskMeetingList) opens a review modal; Make
 * tasks creates each ticked row through TaskDialog's create path with
 * `source: meeting` and `source_note`, adds a comms note with `to:` under a
 * "Hear back from" task, and rewrites each converted line to end with
 * ` ✓ [[<task name>]]`. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c, d) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${c || d == null ? '' : ' — ' + d}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const TML = new Function(`${read('mechanisms/task-entity/task-meeting-list.js')}\nreturn TaskMeetingList;`)();
const TEClass = new Function(`${read('mechanisms/task-entity/task-entity.js')}\nreturn TaskEntity;`)();
const TDClass = new Function('window', 'Notice', 'document', 'globalThis', `${read('mechanisms/task-entity/task-dialog.js')}\nreturn TaskDialog;`);
const DocsClass = new Function('window', 'Notice', `${read('mechanisms/task-entity/task-docs.js')}\nreturn TaskDocs;`);
const RSClass = new Function(`${read('mechanisms/render-safe/render-safe.js')}\nreturn RenderSafe;`)();

// ---------- fake vault ----------

function parseFm(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text || ''));
  if (!m) return null;
  const fm = {};
  let listKey = null;
  for (const line of m[1].split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { fm[listKey].push(item[1].replace(/^"|"$/g, '')); continue; }
    const kv = /^([\w-]+):\s?(.*)$/.exec(line);
    if (!kv) continue;
    listKey = null;
    const v = kv[2].trim();
    if (v === '') { fm[kv[1]] = []; listKey = kv[1]; continue; }
    if (v === '[]') { fm[kv[1]] = []; continue; }
    fm[kv[1]] = v.replace(/^"|"$/g, '').replace(/\\"/g, '"');
  }
  for (const k of Object.keys(fm)) if (Array.isArray(fm[k]) && !fm[k].length && k !== 'links' && k !== 'attendees') fm[k] = '';
  return fm;
}

function writeFm(fm) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) lines.push(k + ': [' + v.map((x) => JSON.stringify(String(x))).join(', ') + ']');
    else lines.push(k + ': ' + (v === '' || v == null ? '' : JSON.stringify(String(v))));
  }
  lines.push('---');
  return lines.join('\n');
}

function makeApp(seed) {
  const files = new Map();
  const folders = new Map();
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const addFolder = (d) => {
    for (let x = d; x; x = x.lastIndexOf('/') < 0 ? '' : dirOf(x)) if (!folders.has(x)) folders.set(x, { path: x, children: [] });
  };
  const relink = () => {
    for (const f of folders.values()) f.children = [];
    for (const f of folders.values()) { const d = f.path.indexOf('/') < 0 ? null : folders.get(dirOf(f.path)); if (d) d.children.push(f); }
    for (const f of files.values()) { const d = folders.get(dirOf(f.path)); if (d) d.children.push(f); }
  };
  const put = (p, text) => {
    const f = files.get(p) || { path: p, basename: p.split('/').pop().replace(/\.md$/, ''), extension: 'md', stat: { mtime: 0 } };
    f.text = text;
    files.set(p, f);
    addFolder(dirOf(p));
    relink();
    return f;
  };
  for (const [p, text] of Object.entries(seed || {})) put(p, text);
  addFolder('spice/tasks');
  const log = { creates: [], processes: [], frontmatter: [] };
  const app = {
    _files: files, _log: log, _put: put,
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || folders.get(p) || null,
      getMarkdownFiles: () => Array.from(files.values()),
      createFolder: async (p) => { if (folders.has(p)) throw new Error('Folder already exists'); addFolder(p); relink(); },
      create: async (p, text) => {
        if (files.has(p)) throw new Error('exists');
        if (!folders.has(dirOf(p))) throw new Error('no folder ' + dirOf(p));
        log.creates.push(p);
        return put(p, text);
      },
      read: async (f) => f.text,
      cachedRead: async (f) => f.text,
      process: async (f, fn) => { log.processes.push(f.path); f.text = fn(f.text); return f.text; },
    },
    fileManager: {
      processFrontMatter: async (f, fn) => {
        log.frontmatter.push(f.path);
        const fm = parseFm(f.text) || {};
        fn(fm);
        const m = /^---\n[\s\S]*?\n---/.exec(f.text);
        f.text = writeFm(fm) + (m ? f.text.slice(m[0].length) : '\n' + f.text);
      },
    },
    metadataCache: {
      getFileCache: (f) => { const fm = f && f.text != null ? parseFm(f.text) : null; return fm ? { frontmatter: fm } : null; },
      getFirstLinkpathDest: () => null,
    },
    workspace: { getActiveFile: () => null },
  };
  return app;
}

function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: {}, attributes: {}, _text: '', _listeners: {}, value: '', checked: false, type: '',
    classList: { _s: new Set(), toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    createEl(t, o) { const c = makeEl(t, (o && o.cls) || ''); if (o && o.type) c.type = o.type; c.parentNode = this; if (o && o.text != null) c.textContent = o.text; this.children.push(c); return c; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener(t, fn) { this._listeners[t] = fn; },
    async fire(t, e) { return this._listeners[t] && this._listeners[t]({ preventDefault() {}, stopPropagation() {}, ...(e || {}) }); },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
  };
  return el;
}
const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
const byClass = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));

const MEETING = 'spice/meetings/notes/Atlas Sync 2026-11-11.md';
const MEETING_TEXT = [
  '---',
  'date: 2026-11-11T10:00:00-07:00',
  'type: meeting',
  'attendees:',
  '  - "[[Jason Batai]]"',
  '  - "[[Matt Hemingway]]"',
  'project: "[[Atlas]]"',
  '---',
  '',
  '```dataviewjs',
  '-> not an action, inside a fence',
  '```',
  '',
  '- -> Draft the rollout plan (due Fri)',
  '- -> Jason: send the API keys (due tomorrow)',
  '-> already done ✓ [[Old task]]',
  '→ Matt Hemingway: review the PR (due 2026-11-20)',
  '- -> follow up with legal: pricing',
  '',
].join('\n');

function setup(seed) {
  const app = makeApp(seed);
  const notices = [];
  const NoticeFn = function (msg) { notices.push(String(msg)); };
  const win = {
    app,
    Notice: NoticeFn,
    moment: () => ({ format: (f) => (f === 'YYYY-MM-DDTHH:mm:ssZ' ? '2026-11-13T09:00:00-07:00' : '2026-11-13') }),
    customJS: {},
  };
  global.window = win;
  global.Notice = NoticeFn;
  const TE = new TEClass();
  win.customJS.TaskEntity = TE;
  const TD = new (TDClass(win, NoticeFn, undefined, { app }))();
  const reconciled = [];
  TD._reconcileAfterCreate = (_a, p) => { reconciled.push(p); };
  win.customJS.TaskDialog = TD;
  win.customJS.TaskDocs = new (DocsClass(win, NoticeFn))();
  const RS = new RSClass();
  const mutations = [];
  const realMutate = RS.mutate.bind(RS);
  RS.mutate = (o) => { mutations.push(o); return realMutate(o); };
  win.customJS.RenderSafe = RS;
  return { app, win, notices, mutations, reconciled, TD };
}

(async () => {
  // ---------- line format ----------
  ok('MA-LINE-MINE "-> thing" is mine',
    JSON.stringify(TML.parseActionLine('-> Draft the plan')) === JSON.stringify({ prefix: '', owner: '', thing: 'Draft the plan', dueSpec: '' }));
  ok('MA-LINE-ARROW "→ thing" works too, after a list bullet and indentation',
    TML.parseActionLine('  - → Draft the plan').thing === 'Draft the plan' && TML.parseActionLine('  - → Draft the plan').prefix === '  - ');
  const PEOPLE = ['[[Jason Batai]]', 'Matt Hemingway'];
  ok('MA-LINE-OTHER "-> Name: thing" is someone else\'s when Name is a known person, by first or full name (any case), or a [[link]]',
    TML.parseActionLine('-> Jason: send the keys', PEOPLE).owner === 'Jason' && TML.parseActionLine('-> Jason: send the keys', PEOPLE).thing === 'send the keys'
    && TML.parseActionLine('-> Matt Hemingway: review', PEOPLE).owner === 'Matt Hemingway'
    && TML.parseActionLine('-> matt: review', PEOPLE).owner === 'matt'
    && TML.parseActionLine('-> [[Priya Shah]]: send').owner === 'Priya Shah');
  ok('MA-OWNER-STRICT anything before a colon that is not a known person or a link stays mine, colon and all',
    TML.parseActionLine('-> Note: check the logs', PEOPLE).owner === '' && TML.parseActionLine('-> Note: check the logs', PEOPLE).thing === 'Note: check the logs'
    && TML.parseActionLine('-> Jason: send the keys').owner === ''
    && TML.parseActionLine('-> follow up with legal: pricing', PEOPLE).owner === ''
    && TML.parseActionLine('-> 10:30 call with ops', PEOPLE).owner === ''
    && TML.parseActionLine('-> Jason Smith: x', PEOPLE).owner === '');
  ok('MA-LINE-DUE a trailing (due …) is split off the thing',
    TML.parseActionLine('-> Jason: send keys (due Fri)', PEOPLE).dueSpec === 'Fri' && TML.parseActionLine('-> Jason: send keys (due Fri)', PEOPLE).thing === 'send keys');
  ok('MA-LINE-SKIP plain lines, a bare arrow and converted lines are not action items',
    TML.parseActionLine('Draft the plan') === null && TML.parseActionLine('->') === null
    && TML.parseActionLine('- -> Draft ✓ [[Draft]]') === null && TML.parseActionLine('a -> b') === null);

  // ---------- due dates ----------
  ok('MA-DUE-WEEKDAY (due Fri) is the next Friday after the base date',
    TML.parseDue('Fri', '2026-11-11') === '2026-11-13' && TML.parseDue('friday', '2026-11-11') === '2026-11-13'
    && TML.parseDue('Mon', '2026-11-11') === '2026-11-16');
  ok('MA-DUE-WEEKDAY-SAME a meeting on a Friday saying (due Fri) means the Friday after',
    TML.parseDue('Fri', '2026-11-13') === '2026-11-20');
  ok('MA-DUE-TOMORROW (due tomorrow) is the day after the base date, across a month end',
    TML.parseDue('tomorrow', '2026-11-11') === '2026-11-12' && TML.parseDue('Tomorrow', '2026-11-30') === '2026-12-01');
  ok('MA-DUE-ISO (due YYYY-MM-DD) is taken as written; an impossible date is not a date',
    TML.parseDue('2026-11-20', '2026-11-11') === '2026-11-20' && TML.parseDue('2026-02-30', '2026-11-11') === null
    && TML.parseDue('2026-11-20', '') === '2026-11-20');
  ok('MA-DUE-UNKNOWN anything else, or a weekday with no base date, is null',
    TML.parseDue('next week', '2026-11-11') === null && TML.parseDue('Fri', '') === null && TML.parseDue('', '2026-11-11') === null);
  ok('MA-DUE-BASE the base is the meeting\'s date, else today',
    TML.baseDate('2026-11-11T10:00:00-07:00', '2026-11-13') === '2026-11-11' && TML.baseDate('', '2026-11-13') === '2026-11-13'
    && TML.baseDate(undefined, '2026-11-13') === '2026-11-13');

  // ---------- reading a note ----------
  const items = TML.actionItems(MEETING_TEXT, { base: '2026-11-11', attendees: ['[[Jason Batai]]', '[[Matt Hemingway]]'] });
  ok('MA-ITEMS every unconverted action line, outside the frontmatter and code fences, in note order',
    JSON.stringify(items.map((i) => i.title)) === JSON.stringify([
      'Draft the rollout plan',
      'Hear back from Jason: send the API keys',
      'Hear back from Matt Hemingway: review the PR',
      'follow up with legal: pricing',
    ]), JSON.stringify(items.map((i) => i.title)));
  ok('MA-ITEMS-DUE each item carries its parsed due date from the meeting date',
    JSON.stringify(items.map((i) => i.due)) === JSON.stringify(['2026-11-13', '2026-11-12', '2026-11-20', '']));
  ok('MA-ITEMS-TO a first name resolves to the one attendee who has it; a full name stays',
    items[1].to === 'Jason Batai' && items[2].to === 'Matt Hemingway' && items[0].to === '');
  ok('MA-ITEMS-TO-AMBIGUOUS a first name two attendees share stays as written',
    TML.actionItems('-> Sam: x', { attendees: ['[[Sam A]]', '[[Sam B]]'] })[0].to === 'Sam'
    && TML.actionItems('-> Sam: x', { attendees: ['[[Sam A]]', '[[Sam B]]'] })[0].owner === 'Sam');
  ok('MA-ITEMS-PEOPLE a name that is not an attendee but is a spice/people note is someone else\'s, resolved to that note',
    TML.actionItems('-> Priya: x', { attendees: ['[[Jason Batai]]'], people: ['Priya Shah'] })[0].to === 'Priya Shah'
    && TML.actionItems('-> Priya: x', { attendees: ['[[Jason Batai]]'] })[0].owner === '');
  ok('MA-ITEMS-UNPARSED-DUE a (due …) that is not a date stays in the title with no due date',
    TML.actionItems('-> Draft (due next week)', { base: '2026-11-11' })[0].title === 'Draft (due next week)'
    && TML.actionItems('-> Draft (due next week)', { base: '2026-11-11' })[0].due === '');
  ok('MA-OWNER-OF-TITLE "Hear back from <Name>: <thing>" names the other person; any other title is mine',
    JSON.stringify(TML.ownerOfTitle('Hear back from Jason: send keys')) === JSON.stringify({ owner: 'Jason', thing: 'send keys' })
    && TML.ownerOfTitle('Draft the plan') === null);

  // ---------- marking lines ----------
  {
    const text = 'a\n-> x\n-> x\n-> y\n';
    const r = TML.markConverted(text, [{ index: 2, raw: '-> x', name: 'X 2' }, { index: 1, raw: '-> x', name: 'X' }, { index: 3, raw: '-> gone', name: 'G' }]);
    ok('MA-MARK each converted line ends with " ✓ [[<task name>]]", matched by its exact text; a changed line is left and reported',
      r.text === 'a\n-> x ✓ [[X]]\n-> x ✓ [[X 2]]\n-> y\n' && r.missed.length === 1 && r.missed[0].name === 'G', JSON.stringify(r));
    ok('MA-MARK-ONCE a marked line is never offered again',
      TML.actionItems(r.text, {}).map((i) => i.title).join('|') === 'y');
  }

  // ---------- Make tasks ----------
  {
    const { app, notices, mutations, reconciled } = setup({ [MEETING]: MEETING_TEXT });
    const opened = TML.actionItems(MEETING_TEXT, { base: '2026-11-11', attendees: ['[[Jason Batai]]', '[[Matt Hemingway]]'] });
    const rows = opened.map((it) => ({ ...it, on: true }));
    rows[3].on = false;
    rows[0].title = 'Draft the rollout plan for Atlas';
    const before = app._files.get(MEETING).text;
    app._files.get(MEETING).text = before.replace('→ Matt Hemingway: review the PR (due 2026-11-20)', '→ Matt Hemingway: review the PR today');
    const res = await TML.makeTasks(app, MEETING, rows);
    const v = res && res.value;
    ok('MA-MUTATE Make tasks is one RenderSafe.mutate write on the meeting note',
      res && res.ok === true && mutations.length === 1 && mutations[0].path === MEETING && typeof mutations[0].write === 'function');
    ok('MA-MADE ticked, unchanged rows become tasks; an unticked row is left; a line changed since the modal opened is skipped',
      v && v.made.length === 2 && v.skipped === 1 && v.failed === 0, JSON.stringify(v));
    const mine = app._files.get('spice/tasks/Draft the rollout plan for Atlas/Draft the rollout plan for Atlas.md');
    const mfm = mine ? parseFm(mine.text) : {};
    ok('MA-MINE my item is a task with the edited title, its due date, source: meeting, source_note set to the meeting and the meeting\'s project',
      mine && mfm.type === 'task' && mfm.title === 'Draft the rollout plan for Atlas' && mfm.due === '2026-11-13'
      && mfm.source === 'meeting' && mfm.source_note === '[[Atlas Sync 2026-11-11]]' && mfm.project === '[[Atlas]]' && mfm.project_slug === 'atlas',
      mine ? JSON.stringify(mfm) : 'missing: ' + app._log.creates.join(', '));
    const otherPath = 'spice/tasks/Hear back from Jason send the API keys/Hear back from Jason send the API keys.md';
    const other = app._files.get(otherPath);
    const ofm = other ? parseFm(other.text) : {};
    ok('MA-OTHER someone else\'s item is a "Hear back from <Name>: <thing>" task with the same source fields',
      other && ofm.title === 'Hear back from Jason: send the API keys' && ofm.due === '2026-11-12'
      && ofm.source === 'meeting' && ofm.source_note === '[[Atlas Sync 2026-11-11]]', other ? JSON.stringify(ofm) : 'missing');
    const commsPath = 'spice/tasks/Hear back from Jason send the API keys/notes/Message to Jason Batai.md';
    const comms = app._files.get(commsPath);
    const cfm = comms ? parseFm(comms.text) : {};
    const body = comms ? comms.text.slice(comms.text.indexOf('method: "renderHeader"')) : '';
    const firstLine = body.split('\n').slice(2).find((l) => l.trim() !== '');
    ok('MA-COMMS a comms note under that task, with to: the attendee\'s name and the action as its first line',
      comms && cfm.type === 'task-doc' && cfm.kind === 'comms' && cfm.to === 'Jason Batai'
      && cfm.task === '[[Hear back from Jason send the API keys]]' && firstLine === 'send the API keys',
      comms ? JSON.stringify(cfm) + ' / ' + JSON.stringify(firstLine) : 'missing: ' + app._log.creates.join(', '));
    ok('MA-COMMS-ONLY-TO the comms note gets to: and none of via, sent_at or replied_at',
      comms && !('via' in cfm) && !('sent_at' in cfm) && !('replied_at' in cfm));
    const after = app._files.get(MEETING).text;
    ok('MA-REWRITE each converted line now ends with " ✓ [[<task name>]]"; the unticked and the changed lines are untouched',
      after.includes('- -> Draft the rollout plan (due Fri) ✓ [[Draft the rollout plan for Atlas]]')
      && after.includes('- -> Jason: send the API keys (due tomorrow) ✓ [[Hear back from Jason send the API keys]]')
      && after.includes('→ Matt Hemingway: review the PR today\n')
      && after.includes('- -> follow up with legal: pricing\n'), after);
    ok('MA-REWRITE-PROCESS the meeting note is rewritten once, through vault.process',
      app._log.processes.filter((p) => p === MEETING).length === 1);
    ok('MA-AGAIN a second Make tasks offers only the lines not yet converted',
      TML.actionItems(after, { base: '2026-11-11', attendees: ['[[Matt Hemingway]]'] }).map((i) => i.title).join('|')
      === 'Hear back from Matt Hemingway: review the PR today|follow up with legal: pricing');
    ok('MA-NOTICE one summary notice, no "Task created" toast per task',
      !notices.includes('Task created') && notices.some((n) => /^Made 2 tasks; 1 line changed, skipped$/.test(n)), JSON.stringify(notices));
    ok('MA-RECONCILE the task list is refreshed once after the batch',
      reconciled.length === 1);
  }

  {
    const { app } = setup({ [MEETING]: MEETING_TEXT });
    const rows = TML.actionItems(MEETING_TEXT, { base: '2026-11-11' }).map((it) => ({ ...it, on: true }));
    rows[1].title = 'Send Jason the API keys';
    const res = await TML.makeTasks(app, MEETING, [rows[1]]);
    ok('MA-TITLE-DECIDES editing the "Hear back from" out of a title makes the item mine: no comms note',
      res.ok && res.value.made.length === 1 && !res.value.made[0].comms
      && !Array.from(app._files.keys()).some((p) => p.startsWith('spice/tasks/') && p.includes('/notes/')));
  }

  {
    const { app } = setup({ [MEETING]: MEETING_TEXT });
    const rows = TML.actionItems(MEETING_TEXT, { base: '2026-11-11' }).map((it) => ({ ...it, on: true }));
    app._files.delete(MEETING);
    const res = await TML.makeTasks(app, MEETING, rows);
    ok('MA-GONE a meeting note deleted under the modal fails the write and creates nothing',
      res.ok === false && app._log.creates.length === 0);
  }

  // ---------- review fixes ----------
  ok('MA-DUE-NOT-PAST a weekday from an old meeting rolls forward a week at a time to today or later; tomorrow becomes today + 1; an explicit date stays',
    TML.parseDue('Fri', '2026-10-01', '2026-11-13') === '2026-11-13'
    && TML.parseDue('Mon', '2026-10-01', '2026-11-13') === '2026-11-16'
    && TML.parseDue('tomorrow', '2026-10-01', '2026-11-13') === '2026-11-14'
    && TML.parseDue('today', '2026-10-01', '2026-11-13') === '2026-11-13'
    && TML.parseDue('2026-10-01', '2026-10-01', '2026-11-13') === '2026-10-01'
    && TML.parseDue('Fri', '2026-11-11', '2026-11-11') === '2026-11-13'
    && TML.parseDue('tomorrow', '2026-11-12', '2026-11-11') === '2026-11-13');
  ok('MA-DUE-NOT-PAST-ITEMS actionItems passes today through',
    TML.actionItems('-> a (due tomorrow)\n-> b (due 2026-01-02)', { base: '2026-10-01', today: '2026-11-13' }).map((i) => i.due).join('|') === '2026-11-14|2026-01-02');
  {
    const text = 'a\r\n-> x\n-> y\r\nz';
    const items2 = TML.actionItems(text, {});
    const r = TML.markConverted(text, [{ index: 1, raw: '-> x', name: 'X' }, { index: 2, raw: '-> y', name: 'Y' }]);
    ok('MA-LINE-ENDINGS mixed line endings: items carry no stray \\r, and every line keeps its own ending after marking',
      items2.map((i) => i.raw).join('|') === '-> x|-> y'
      && r.text === 'a\r\n-> x ✓ [[X]]\n-> y ✓ [[Y]]\r\nz', JSON.stringify(r.text));
  }
  ok('MA-INDENTED-CODE a line indented 4+ spaces or a tab that is not a list item is code, not an action',
    TML.actionItems('    -> code sample\n\t-> tabbed\n    - -> nested item\n\t* -> tab item\n  -> two spaces', {}).map((i) => i.title).join('|')
    === 'nested item|tab item|two spaces');

  {
    const { app, notices } = setup({ [MEETING]: MEETING_TEXT });
    const rows = TML.actionItems(MEETING_TEXT, { base: '2026-11-11', attendees: ['[[Jason Batai]]', '[[Matt Hemingway]]'] }).map((it) => ({ ...it, on: true }));
    window.customJS.TaskDocs.create = async () => { throw new Error('disk full'); };
    const realRow = TML._convertRow;
    let calls = 0;
    TML._convertRow = async (...a) => { calls++; if (calls === 4) throw new Error('crash mid-batch'); return realRow.apply(TML, a); };
    let res;
    try { res = await TML.makeTasks(app, MEETING, rows); } finally { TML._convertRow = realRow; }
    const text = app._files.get(MEETING).text;
    ok('MA-PARTIAL a crash part-way still marks every line whose task was made, so no task is made twice',
      res.ok === false && text.includes('(due Fri) ✓ [[') && text.includes('(due tomorrow) ✓ [[') && text.includes('(due 2026-11-20) ✓ [[')
      && text.includes('- -> follow up with legal: pricing\n')
      && TML.actionItems(text, { base: '2026-11-11', attendees: ['[[Matt Hemingway]]'] }).map((i) => i.title).join('|') === 'follow up with legal: pricing', text);
    ok('MA-PARTIAL-COMMS a failing comms note never stops the rows after it',
      app._files.has('spice/tasks/Hear back from Matt Hemingway review the PR/Hear back from Matt Hemingway review the PR.md'));
    notices.length = 0;
    const app2 = setup({ [MEETING]: MEETING_TEXT });
    app2.win.customJS.TaskDocs.create = async () => ({ ok: false, reason: 'no folder' });
    const res2 = await TML.makeTasks(app2.app, MEETING, TML.actionItems(MEETING_TEXT, { base: '2026-11-11', attendees: ['[[Jason Batai]]', '[[Matt Hemingway]]'] }).map((it) => ({ ...it, on: true })));
    ok('MA-COMMS-MISSED a comms note that was not made is counted in the summary notice',
      res2.ok && res2.value.commsMissed === 2 && res2.value.made.length === 4
      && app2.notices.includes('Made 4 tasks; comms note not made for 2'), JSON.stringify(app2.notices));
  }

  {
    const { app, notices, win } = setup({ [MEETING]: MEETING_TEXT });
    const rows = TML.actionItems(MEETING_TEXT, { base: '2026-11-11' }).map((it) => ({ ...it, on: true }));
    let release;
    const gate = new Promise((r) => { release = r; });
    const realCreate = win.customJS.TaskDialog._create.bind(win.customJS.TaskDialog);
    win.customJS.TaskDialog._create = async (...a) => { await gate; return realCreate(...a); };
    win.customJS.SauceModal = { open: () => { throw new Error('must not open while busy'); } };
    const first = TML.makeTasks(app, MEETING, rows);
    await new Promise((r) => setImmediate(r));
    const second = await TML.makeTasks(app, MEETING, rows);
    const opened = await TML.openMakeTasks(app, MEETING);
    ok('MA-BUSY while a batch runs, a second Make tasks or modal for the same meeting is refused with a notice',
      second.ok === false && opened === null
      && notices.filter((n) => n === 'Already making tasks for this meeting').length === 2);
    release();
    const done = await first;
    ok('MA-BUSY-CLEARS the meeting is free again once the batch ends, and the batch made each task once',
      done.ok && done.value.made.length === 4 && TML._busy().size === 0
      && app._log.creates.filter((p) => !p.includes('/notes/')).length === 4);
  }

  {
    const { app } = setup({
      [MEETING]: MEETING_TEXT,
      'spice/projects/atlas/Atlas.md': '---\ntype: project\nname: Atlas\nslug: atlas-old\nproject_slug: atlas-core\n---\n',
    });
    const rows = TML.actionItems(MEETING_TEXT, { base: '2026-11-11' }).map((it) => ({ ...it, on: true }));
    await TML.makeTasks(app, MEETING, [rows[0]]);
    const t = app._files.get('spice/tasks/Draft the rollout plan/Draft the rollout plan.md');
    ok('MA-PROJECT-SLUG the project note\'s project_slug wins over its slug',
      t && parseFm(t.text).project_slug === 'atlas-core' && parseFm(t.text).project === '[[Atlas]]', t ? t.text : 'missing');
  }

  // ---------- the modal ----------
  {
    const { app, win } = setup({ [MEETING]: MEETING_TEXT });
    let spec = null;
    let closed = null;
    win.customJS.SauceModal = { open: (o) => { spec = o; return { close: (r) => { closed = r; if (o.onClose) o.onClose(r); } }; } };
    const pending = TML.openMakeTasks(app, MEETING);
    await new Promise((r) => setImmediate(r));
    const body = makeEl('div');
    spec.body(body);
    const rowsEls = byClass(body, 'sauce-mtg-review-row');
    const titles = byClass(body, 'sauce-mtg-review-title');
    const dues = byClass(body, 'sauce-mtg-review-due');
    const boxes = all(body).filter((n) => n.type === 'checkbox');
    ok('MA-MODAL one row per unconverted action line, each with a checkbox, an editable title and an editable due date',
      spec.title === 'Make tasks' && rowsEls.length === 4 && boxes.length === 4 && boxes.every((b) => b.checked)
      && titles.map((t) => t.value).join('|') === 'Draft the rollout plan|Hear back from Jason: send the API keys|Hear back from Matt Hemingway: review the PR|follow up with legal: pricing'
      && titles.every((t) => t.type === 'text') && dues.every((d) => d.type === 'date')
      && dues.map((d) => d.value).join('|') === '2026-11-13|2026-11-14|2026-11-20|', dues.map((d) => d.value).join('|'));
    const hints = byClass(body, 'sauce-mtg-review-hint').map((h) => h.textContent);
    ok('MA-MODAL-HINT someone else\'s row says it will also get a comms note, to whom',
      hints[1] === 'Plus a comms note to Jason Batai' && hints[0] === '- -> Draft the rollout plan (due Fri)');
    boxes[1].checked = false; await boxes[1].fire('change');
    boxes[2].checked = false; await boxes[2].fire('change');
    boxes[3].checked = false; await boxes[3].fire('change');
    titles[0].value = 'Draft it'; await titles[0].fire('input');
    dues[0].value = ''; await dues[0].fire('change');
    const make = spec.buttons.find((b) => b.label === 'Make tasks');
    ok('MA-MODAL-BUTTONS Cancel and Make tasks', spec.buttons.map((b) => b.label).join('|') === 'Cancel|Make tasks' && make.close === false);
    const btn = { disabled: false };
    await make.onClick({ close: (r) => { closed = r; spec.onClose(r); } }, { currentTarget: btn });
    const res = await pending;
    const made = app._files.get('spice/tasks/Draft it/Draft it.md');
    ok('MA-MODAL-APPLY Make tasks makes only the ticked rows, with their edited title and due date, then closes',
      res && res.ok && res.value.made.length === 1 && made && parseFm(made.text).due === '' && btn.disabled === true && closed === 'made'
      && rowsEls[1].classList.contains('is-off'));
  }

  {
    const { app, win } = setup({ [MEETING]: '---\ntype: meeting\n---\n\n- notes only\n' });
    let spec = null;
    win.customJS.SauceModal = { open: (o) => { spec = o; return {}; } };
    TML.openMakeTasks(app, MEETING);
    await new Promise((r) => setImmediate(r));
    const body = makeEl('div');
    spec.body(body);
    ok('MA-MODAL-EMPTY with no action lines the modal says how to write one, with only Close',
      /Start a line with ->/.test(body.textContent) && spec.buttons.map((b) => b.label).join('|') === 'Close');
  }

  // ---------- the button on the task section ----------
  {
    const { app, win } = setup({ [MEETING]: MEETING_TEXT });
    const page = { file: { name: 'Atlas Sync 2026-11-11', path: MEETING } };
    win.customJS.RenderSafe.page = () => page;
    class FakeView {
      static get SURFACES() { return { meeting: {} }; }
      render(dv) { while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild); dv.container.createEl('div', { cls: 'sauce-todo-daily-filter-view' }); return 'drawn'; }
    }
    win.customJS.ToDoDailyFilterView = new FakeView();
    const dv = { container: makeEl('div') };
    const drawn = await new TML().render(dv);
    await new TML().render(dv);
    const first = dv.container.children[0];
    const btn = first && byClass(first, 'sauce-mtg-make')[0];
    ok('MA-BUTTON a Make tasks button sits first on the meeting\'s task section, above the shared list, once per render',
      drawn === 'drawn' && first && String(first.className) === 'sauce-mtg-actions' && btn && btn.textContent === 'Make tasks'
      && byClass(dv.container, 'sauce-mtg-actions').length === 1 && dv.container.children.length === 2);
    let spec = null;
    win.customJS.SauceModal = { open: (o) => { spec = o; return {}; } };
    await btn.fire('click');
    await new Promise((r) => setImmediate(r));
    ok('MA-BUTTON-OPENS the button opens the review modal for this meeting', spec && spec.title === 'Make tasks');
    ok('MA-BUTTON-TOUCH the button is a shared sauce-btn (36px tall on every device)',
      String(btn.className).split(/\s+/).includes('sauce-btn'));

    delete win.customJS.ToDoDailyFilterView;
    const flat = { container: makeEl('div'), current: () => page, pages: () => { const a = []; a.where = () => a; a.map = () => []; return a; } };
    await new TML().render(flat);
    ok('MA-BUTTON-FLAT the flat list (no to-do blueprint) gets the button too',
      byClass(flat.container, 'sauce-mtg-make').length === 1 && String(flat.container.children[0].className) === 'sauce-mtg-actions');
  }

  ok('MA-CSS-PHONE on a phone the title and due fields take a full row at 16px, and every control is at least 36px tall',
    /body\.is-phone \.sauce-mtg-review-title[^{]*\{[^}]*flex-basis: 100%; font-size: 16px/.test(TML._CSS)
    && /sauce-mtg-review-tick \{[^}]*width: 36px; height: 36px/.test(TML._CSS)
    && /sauce-mtg-review-title\.sauce-mtg-review-title \{[^}]*min-height: 36px/.test(TML._CSS)
    && !/:hover/.test(TML._CSS));

  ok('MA-MIRROR the ranch mirror equals the platform source',
    read('../ranch/scripts/task-entity/task-meeting-list.js') === read('mechanisms/task-entity/task-meeting-list.js')
    && read('../ranch/scripts/task-entity/task-dialog.js') === read('mechanisms/task-entity/task-dialog.js'));

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
