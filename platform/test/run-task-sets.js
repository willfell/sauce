#!/usr/bin/env node
/**
 * run-task-sets.js — task sets: reusable starter bundles at
 * spice/tasks/_sets/<Name>.md (type: task-set). TaskSets reads a set's
 * `- [ ]` lines (nesting, `(due +N)` work days), its Prompt and Comms
 * sections and `{{task}}`, plans the task and subtasks in the folder layout,
 * and writes them plus the prompt and comms notes. New from set sits next to
 * New task in the + menus. Lists and helpers skip _sets/. Zero-dep; exit 0
 * iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c, d) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${c || d == null ? '' : ' — ' + d}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const load = (file, name) => new Function('window', 'Notice', `${read(file)}\nreturn ${name};`);

const notices = [];
function NoticeStub(msg) { notices.push(String(msg)); }
const win = { customJS: {}, moment: null };
const TEClass = new Function(`${read('mechanisms/task-entity/task-entity.js')}\nreturn TaskEntity;`)();
const TDClass = load('mechanisms/task-entity/task-dialog.js', 'TaskDialog')(win, NoticeStub);
const TDocsClass = load('mechanisms/task-entity/task-docs.js', 'TaskDocs')(win, NoticeStub);
const TS = load('mechanisms/task-entity/task-sets.js', 'TaskSets')(win, NoticeStub);
win.customJS.TaskEntity = new TEClass();
win.customJS.TaskDialog = new TDClass();
win.customJS.TaskDocs = new TDocsClass();

function makeApp(seed) {
  const files = new Map();
  const folders = new Map();
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const addFolder = (d) => {
    for (let x = d; x; x = x.lastIndexOf('/') < 0 ? '' : dirOf(x)) {
      if (!folders.has(x)) folders.set(x, { path: x, children: [] });
    }
  };
  const readFm = (text) => {
    const fm = {};
    const m = /^---\n([\s\S]*?)\n---/.exec(text);
    if (m) for (const line of m[1].split('\n')) { const kv = /^(\w+):[ ]?(.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2].replace(/^"|"$/g, ''); }
    return fm;
  };
  const put = (p, text) => {
    files.set(p, { path: p, basename: p.split('/').pop().replace(/\.md$/, ''), _fm: readFm(text), _body: text, stat: { mtime: 0 } });
  };
  for (const [p, text] of Object.entries(seed || {})) { addFolder(dirOf(p)); put(p, text); }
  const opened = [];
  const createdFolders = [];
  const trashed = [];
  const fail = { on: null };
  const drop = (p) => {
    for (const k of Array.from(files.keys())) if (k === p || k.indexOf(p + '/') === 0) files.delete(k);
    for (const k of Array.from(folders.keys())) if (k === p || k.indexOf(p + '/') === 0) folders.delete(k);
  };
  return {
    _files: files, _folders: folders, _opened: opened, _createdFolders: createdFolders, _trashed: trashed, _fail: fail,
    vault: {
      trash: async (f, system) => { trashed.push([f.path, system]); drop(f.path); },
      getAbstractFileByPath: (p) => files.get(p) || folders.get(p) || null,
      getMarkdownFiles: () => Array.from(files.values()),
      createFolder: async (p) => {
        if (!folders.has(dirOf(p)) && p.indexOf('/') >= 0) throw new Error('no parent folder for ' + p);
        createdFolders.push(p);
        folders.set(p, { path: p, children: [] });
      },
      create: async (p, text) => {
        if (fail.on && fail.on.test(p)) throw new Error('disk full: ' + p);
        if (files.has(p)) throw new Error('exists: ' + p);
        if (!folders.has(dirOf(p))) throw new Error('no folder: ' + dirOf(p));
        put(p, text);
        return files.get(p);
      },
      cachedRead: async (f) => f._body,
      process: async (f, fn) => { f._body = fn(f._body); f._fm = readFm(f._body); },
    },
    metadataCache: { getFileCache: (f) => (f && f._fm ? { frontmatter: f._fm } : null) },
    workspace: { openLinkText: (p) => opened.push(p) },
  };
}

const SET = [
  '---', 'type: task-set', '---', '',
  '> [!info] Task set',
  '> Each `- [ ]` line is a subtask. `{{task}}` is the title.',
  '> - [ ] not a step, it is in the callout',
  '',
  '## Subtasks', '',
  '- [ ] Open the PR for {{task}}',
  '- [ ] CI green',
  '\t- [ ] Fix flaky test (due +1)',
  '\t\t- [ ] Rerun',
  '- Notes, a plain bullet: not a step',
  '\t- [ ] under a plain bullet, not a step',
  '\t\t- [ ] deeper under it, not a step',
  '- [ ] Review (due +2)',
  '    - [ ] Address comments',
  '- [ ] Deploy   ( due + 3 )',
  '',
  '```text',
  '- [ ] inside a fence, not a step',
  '```',
  '',
  '## Prompt', '',
  'Check the rollout of {{task}}.',
  '',
  '```',
  '## not a heading',
  '- [ ] not a step',
  '```',
  '',
  '### Detail',
  'Still the prompt.',
  '',
  '## Comms', '',
  'Heads up: {{ task }} goes out today.',
  '',
  '# Afterword',
  '- [ ] Afterword step',
  '',
].join('\n');

{
  const p = TS.parse(SET);
  ok('TS-PARSE every `- [ ]` line outside the Prompt and Comms sections, fences and callouts is a subtask, in order',
    JSON.stringify(p.steps.map((s) => s.title)) === JSON.stringify(['Open the PR for {{task}}', 'CI green', 'Fix flaky test', 'Rerun', 'Review', 'Address comments', 'Deploy', 'Afterword step']),
    JSON.stringify(p.steps.map((s) => s.title)));
  ok('TS-PARSE-NEST indentation nests a line under the nearest less-indented line above it (tabs and spaces)',
    JSON.stringify(p.steps.map((s) => [s.depth, s.parent])) === JSON.stringify([[0, -1], [0, -1], [1, 1], [2, 2], [0, -1], [1, 4], [0, -1], [0, -1]]),
    JSON.stringify(p.steps.map((s) => [s.depth, s.parent])));
  ok('TS-PARSE-DUE a trailing (due +N) sets a work-day offset and leaves the title',
    JSON.stringify(p.steps.map((s) => s.dueOffset)) === JSON.stringify([null, null, 1, null, 2, null, 3, null]));
  ok('TS-PARSE-PROMPT the Prompt section runs to the next level 1 or 2 heading; fenced lines and ### headings stay in it',
    p.prompt === 'Check the rollout of {{task}}.\n\n```\n## not a heading\n- [ ] not a step\n```\n\n### Detail\nStill the prompt.', JSON.stringify(p.prompt));
  ok('TS-PARSE-COMMS the Comms section is its text, trimmed', p.comms === 'Heads up: {{ task }} goes out today.', JSON.stringify(p.comms));
  const bare = TS.parse('- [ ] Only step\n');
  ok('TS-PARSE-BARE a set with no frontmatter or sections still lists its steps and has no notes',
    bare.steps.length === 1 && bare.steps[0].title === 'Only step' && bare.prompt === '' && bare.comms === '');
  ok('TS-PARSE-EMPTY nothing in, nothing out', TS.parse(null).steps.length === 0 && TS.parse('').prompt === '');
  const checked = TS.parse('- [x] Tag it\n- [X] Ship it (due +1)\n\t- [ ] Smoke test\n- [ ] Announce\n');
  ok('TS-PARSE-CHECKED `- [x]` and `- [X]` lines are steps like `- [ ]`, nesting and due included',
    JSON.stringify(checked.steps.map((s) => [s.title, s.parent, s.dueOffset])) === JSON.stringify([['Tag it', -1, null], ['Ship it', -1, 1], ['Smoke test', 1, null], ['Announce', -1, null]]),
    JSON.stringify(checked.steps));
  const plain = TS.parse([
    '- [ ] Build',
    '  - a note about the build',
    '    - [ ] not a step: under the note',
    '  - [ ] Lint',
    '- Context',
    '  - [ ] not a step either',
    'Some paragraph.',
    '- [ ] Release',
    '1. numbered, plain',
    '   - [ ] not a step: under the numbered item',
    '2. [ ] Numbered checkbox',
  ].join('\n'));
  ok('TS-PARSE-PLAIN a plain bullet and everything indented under it are skipped, and the next step keeps its real parent',
    JSON.stringify(plain.steps.map((s) => [s.title, s.parent])) === JSON.stringify([['Build', -1], ['Lint', 0], ['Release', -1], ['Numbered checkbox', -1]]),
    JSON.stringify(plain.steps.map((s) => [s.title, s.parent])));
  ok('TS-SUMMARY the picker line counts subtasks and names the notes',
    TS.summary(p) === '8 subtasks · prompt · comms' && TS.summary(bare) === '1 subtask');
}

ok('TS-FILL {{task}} and {{ task }} become the title, and $-patterns in the title are literal',
  TS.fill('A {{task}} B {{ Task }}', 'Ship $& now') === 'A Ship $& now B Ship $& now');

ok('TS-WORKDAYS work days skip weekends: Fri +1 is Mon, Thu +2 is Mon, +0 is the day itself',
  TS.addWorkDays('2026-11-13', 1) === '2026-11-16' && TS.addWorkDays('2026-11-12', 2) === '2026-11-16'
  && TS.addWorkDays('2026-11-14', 0) === '2026-11-14' && TS.addWorkDays('2026-11-14', 1) === '2026-11-16');
ok('TS-WORKDAYS-ROLLOVER month, year and leap-day rollover',
  TS.addWorkDays('2026-12-31', 1) === '2027-01-01' && TS.addWorkDays('2028-02-28', 1) === '2028-02-29'
  && TS.addWorkDays('2027-02-26', 1) === '2027-03-01' && TS.addWorkDays('2026-11-13', 10) === '2026-11-27');
ok('TS-WORKDAYS-BAD an unreadable date gives null', TS.addWorkDays('', 1) === null && TS.addWorkDays('soon', 2) === null);

{
  const taken = new Set(['ci green', 'review']);
  const plan = TS.plan(SET, {
    title: 'Ship Auth', due: '2026-11-20', today: '2026-11-13', createdAt: '2026-11-13T09:00:00-07:00',
    source: 'daily', taken: (n) => taken.has(n),
  });
  const R = 'spice/tasks/Ship Auth';
  ok('TS-PLAN the task and every subtask get a folder note, each subtask\'s folder inside its parent\'s',
    plan.ok && JSON.stringify(plan.tasks.map((t) => t.path)) === JSON.stringify([
      `${R}/Ship Auth.md`,
      `${R}/Open the PR for Ship Auth/Open the PR for Ship Auth.md`,
      `${R}/CI green (Ship Auth)/CI green (Ship Auth).md`,
      `${R}/CI green (Ship Auth)/Fix flaky test/Fix flaky test.md`,
      `${R}/CI green (Ship Auth)/Fix flaky test/Rerun/Rerun.md`,
      `${R}/Review (Ship Auth)/Review (Ship Auth).md`,
      `${R}/Review (Ship Auth)/Address comments/Address comments.md`,
      `${R}/Deploy/Deploy.md`,
      `${R}/Afterword step/Afterword step.md`,
    ]), JSON.stringify(plan.tasks && plan.tasks.map((t) => t.path)));
  const fm = (i) => { const o = {}; for (const l of /^---\n([\s\S]*?)\n---/.exec(plan.tasks[i].content)[1].split('\n')) { const kv = /^(\w+):[ ]?(.*)$/.exec(l); if (kv) o[kv[1]] = kv[2].replace(/^"|"$/g, ''); } return o; };
  ok('TS-PLAN-ROOT the task has the typed title and due, the surface source, no parent, and the task card chrome',
    fm(0).type === 'task' && fm(0).title === 'Ship Auth' && fm(0).status === 'open' && fm(0).due === '2026-11-20'
    && fm(0).source === 'daily' && fm(0).parent_task === '' && fm(0).created_at === '2026-11-13T09:00:00-07:00'
    && /class: "TaskNoteView"/.test(plan.tasks[0].content), JSON.stringify(fm(0)));
  ok('TS-PLAN-SUB subtasks link their parent and take {{task}} and (due +N) from the set',
    fm(1).title === 'Open the PR for Ship Auth' && fm(1).parent_task === '[[Ship Auth]]'
    && fm(3).parent_task === '[[CI green (Ship Auth)]]' && fm(3).due === '2026-11-16'
    && fm(4).parent_task === '[[Fix flaky test]]' && fm(4).due === ''
    && fm(5).due === '2026-11-17' && fm(7).due === '2026-11-18' && fm(2).title === 'CI green', JSON.stringify([fm(3), fm(5)]));
  ok('TS-PLAN-FOLDERS the folders come parents first, from the task root down',
    plan.folders[0] === 'spice' && plan.folders[1] === 'spice/tasks' && plan.folders[2] === R
    && plan.folders.indexOf(`${R}/CI green (Ship Auth)`) < plan.folders.indexOf(`${R}/CI green (Ship Auth)/Fix flaky test`));
  ok('TS-PLAN-DOCS the Prompt and Comms sections become notes with {{task}} filled in',
    JSON.stringify(plan.docs) === JSON.stringify([
      { kind: 'prompt', text: 'Check the rollout of Ship Auth.\n\n```\n## not a heading\n- [ ] not a step\n```\n\n### Detail\nStill the prompt.' },
      { kind: 'comms', text: 'Heads up: Ship Auth goes out today.' },
    ]), JSON.stringify(plan.docs));
  const twice = TS.plan('- [ ] Step\n\t- [ ] Step\n- [ ] Step\n', { title: 'X', today: '2026-11-13', createdAt: '2026-11-13T09:00:00Z' });
  ok('TS-PLAN-UNIQUE names given earlier in the same plan count as taken',
    JSON.stringify(twice.tasks.map((t) => t.path)) === JSON.stringify([
      'spice/tasks/X/X.md', 'spice/tasks/X/Step/Step.md', 'spice/tasks/X/Step/Step (Step)/Step (Step).md', 'spice/tasks/X/Step (X)/Step (X).md',
    ]), JSON.stringify(twice.tasks.map((t) => t.path)));
  const fmOf = (content) => { const o = {}; for (const l of /^---\n([\s\S]*?)\n---/.exec(content)[1].split('\n')) { const kv = /^(\w+):[ ]?(.*)$/.exec(l); if (kv) o[kv[1]] = kv[2].replace(/^"|"$/g, ''); } return o; };
  const dueTitle = TS.plan('- [ ] {{task}}\n- [ ] Ship {{task}}\n', { title: 'Hotfix (due +3)', today: '2026-11-13', createdAt: '2026-11-13T09:00:00Z' });
  ok('TS-FILL-AFTER-PARSE a title with "(due +3)" in it is just text in each subtask title: no due date is set',
    dueTitle.ok && JSON.stringify(dueTitle.tasks.slice(1).map((t) => [fmOf(t.content).title, fmOf(t.content).due])) === JSON.stringify([['Hotfix (due +3)', ''], ['Ship Hotfix (due +3)', '']]),
    JSON.stringify(dueTitle.tasks && dueTitle.tasks.map((t) => fmOf(t.content).title)));
  const headTitle = TS.plan('- [ ] Step\n{{task}}\n- [ ] After\n\n## Comms\n\nHi {{task}}\n', { title: '## Prompt', today: '2026-11-13', createdAt: '2026-11-13T09:00:00Z' });
  ok('TS-FILL-AFTER-PARSE a title that reads as a heading cannot start a section: the steps and the notes keep their shape',
    headTitle.ok && headTitle.tasks.length === 3 && fmOf(headTitle.tasks[2].content).title === 'After'
    && JSON.stringify(headTitle.docs) === JSON.stringify([{ kind: 'comms', text: 'Hi ## Prompt' }]), JSON.stringify(headTitle.docs));
  const checkedPlan = TS.plan('- [x] Already ticked\n', { title: 'Y', today: '2026-11-13', createdAt: '2026-11-13T09:00:00Z' });
  ok('TS-PLAN-CHECKED a `- [x]` step is still created open', fmOf(checkedPlan.tasks[1].content).status === 'open' && fmOf(checkedPlan.tasks[1].content).completed_at === '');
  ok('TS-PLAN-INVALID a blank title or a bad due date is refused before anything is written',
    TS.plan(SET, { title: '  ' }).ok === false && TS.plan(SET, { title: 'A', due: '11/20' }).ok === false);
  const saved = win.customJS.TaskEntity;
  win.customJS.TaskEntity = undefined;
  ok('TS-PLAN-COLD with TaskEntity not loaded the plan says so', TS.plan(SET, { title: 'A' }).ok === false);
  win.customJS.TaskEntity = saved;
}

ok('TS-APPEND set text goes below the header with one blank line',
  TS.appendBody('---\na: 1\n---\n\nHEADER\n\n', 'Body\n\n') === '---\na: 1\n---\n\nHEADER\n\nBody\n');

ok('TS-IS-SET-PATH only paths inside spice/tasks/_sets/ are set paths',
  TS.isSetPath('spice/tasks/_sets/PR rollout.md') && !TS.isSetPath('spice/tasks/_setsy/x.md') && !TS.isSetPath('spice/tasks/A/A.md'));

{
  const app = makeApp({
    'spice/tasks/_sets/PR rollout.md': '---\ntype: task-set\n---\n- [ ] Open\n',
    'spice/tasks/_sets/Blank.md': '- [ ] A\n',
    'spice/tasks/_sets/Other.md': '---\ntype: note\n---\n',
    'spice/tasks/_sets/deep/Nested.md': '---\ntype: task-set\n---\n',
    'spice/tasks/Real/Real.md': '---\ntype: task\n---\n',
  });
  ok('TS-LIST the sets are the task-set (or untyped) notes directly in _sets/, by name',
    JSON.stringify(TS.list(app).map((s) => s.name)) === JSON.stringify(['Blank', 'PR rollout']));
}

(async () => {
  {
    const app = makeApp({ 'spice/tasks/Other/Other.md': '---\ntype: task\ntitle: Other\n---\n', 'spice/tasks/Prompt.md': '---\ntype: task\n---\n' });
    const plan = TS.plan(SET, { title: 'Ship Auth', today: '2026-11-13', createdAt: '2026-11-13T09:00:00-07:00', taken: win.customJS.TaskDialog._takenNames(app) });
    const res = await TS.apply(app, plan);
    const R = 'spice/tasks/Ship Auth';
    ok('TS-APPLY every planned task is written, parents before children',
      res.tasks === 9 && plan.tasks.every((t) => app._files.has(t.path) && app._files.get(t.path)._body === t.content), JSON.stringify(res));
    ok('TS-APPLY-FOLDERS missing folders are created, existing ones are left alone',
      !app._createdFolders.includes('spice/tasks') && app._createdFolders.includes(R) && app._createdFolders.includes(`${R}/CI green/Fix flaky test/Rerun`),
      app._createdFolders.join(', '));
    const notes = Array.from(app._files.keys()).filter((p) => p.indexOf(`${R}/notes/`) === 0).sort();
    ok('TS-APPLY-NOTES the prompt and comms notes are made under the task through TaskDocs.create, by its naming rule',
      res.notes === 2 && JSON.stringify(notes) === JSON.stringify([`${R}/notes/Comms.md`, `${R}/notes/Prompt (Ship Auth).md`]), JSON.stringify(notes));
    const prompt = app._files.get(`${R}/notes/Prompt (Ship Auth).md`);
    const comms = app._files.get(`${R}/notes/Comms.md`);
    ok('TS-APPLY-TEXT each note keeps its header and gets the set\'s section text below it',
      prompt._fm.type === 'task-doc' && prompt._fm.kind === 'prompt' && prompt._fm.task === '[[Ship Auth]]'
      && /method: "renderHeader" \}\);\n```\n\nCheck the rollout of Ship Auth\.\n/.test(prompt._body)
      && comms._fm.kind === 'comms' && /```\n\nHeads up: Ship Auth goes out today\.\n$/.test(comms._body), prompt._body);
    const incPlan = TS.plan(require('../install.js')._TASK_SETS_SEED['Incident.md'], { title: 'API 502s', today: '2026-11-13', createdAt: '2026-11-13T09:00:00-07:00', taken: win.customJS.TaskDialog._takenNames(app) });
    await TS.apply(app, incPlan);
    const incPrompt = Array.from(app._files.values()).find((f) => f.path.indexOf('spice/tasks/API 502s/notes/') === 0 && f._fm.kind === 'prompt');
    const copiedText = incPrompt ? win.customJS.TaskDocs.extractPrompt(incPrompt._body) : '';
    ok('TS-APPLY-COPY Copy prompt on a new prompt note copies the set\'s prompt with the title filled in, and nothing of the header',
      copiedText.indexOf('Help me investigate an incident: API 502s.') === 0 && /ask before running anything that writes\.$/.test(copiedText)
      && !/dataviewjs|renderHeader/.test(copiedText), copiedText);
    let threw = '';
    try { await TS.apply(app, plan); } catch (e) { threw = e.message; }
    ok('TS-APPLY-FAIL a write that fails throws, so RenderSafe.mutate reports it, and files it did not make are never touched',
      /exists/.test(threw) && app._trashed.length === 0 && plan.tasks.every((t) => app._files.has(t.path)), threw);
  }

  {
    const app = makeApp({ 'spice/tasks/Other/Other.md': '---\ntype: task\ntitle: Other\n---\n' });
    const before = JSON.stringify([Array.from(app._files.keys()).sort(), Array.from(app._folders.keys()).sort()]);
    const plan = TS.plan(SET, { title: 'Ship Auth', today: '2026-11-13', createdAt: '2026-11-13T09:00:00-07:00', taken: win.customJS.TaskDialog._takenNames(app) });
    app._fail.on = /\/Rerun\.md$/;
    let err = null;
    try { await TS.apply(app, plan); } catch (e) { err = e; }
    const after = JSON.stringify([Array.from(app._files.keys()).sort(), Array.from(app._folders.keys()).sort()]);
    ok('TS-ROLLBACK-TASK a failed subtask write trashes every file and folder that run made, newest first, and rethrows',
      err && /disk full/.test(err.message) && Array.isArray(err.kept) && err.kept.length === 0 && after === before
      && app._trashed[0][0] === 'spice/tasks/Ship Auth/CI green/Fix flaky test/Fix flaky test.md'
      && app._trashed[app._trashed.length - 1][0] === 'spice/tasks/Ship Auth' && app._trashed.every((t) => t[1] === true),
      JSON.stringify(app._trashed));

    const app2 = makeApp({ 'spice/tasks/Other/Other.md': '---\ntype: task\ntitle: Other\n---\n' });
    const before2 = JSON.stringify(Array.from(app2._files.keys()).sort());
    const plan2 = TS.plan(SET, { title: 'Ship Auth', today: '2026-11-13', createdAt: '2026-11-13T09:00:00-07:00', taken: win.customJS.TaskDialog._takenNames(app2) });
    app2._fail.on = /\/notes\/Comms\.md$/;
    const viaManager = [];
    app2.fileManager = { trashFile: async (f) => { viaManager.push(f.path); app2._trashed.push([f.path, 'fm']); } };
    let err2 = null;
    try { await TS.apply(app2, plan2); } catch (e) { err2 = e; }
    ok('TS-ROLLBACK-NOTE a failed note removes the note already made and the notes folder too, through fileManager.trashFile when there is one',
      err2 && viaManager[0] === 'spice/tasks/Ship Auth/notes/Prompt.md' && viaManager[1] === 'spice/tasks/Ship Auth/notes'
      && viaManager.includes('spice/tasks/Ship Auth/Ship Auth.md') && viaManager[viaManager.length - 1] === 'spice/tasks/Ship Auth'
      && !viaManager.includes('spice/tasks') && before2.length > 0, JSON.stringify(viaManager));

    const app3 = makeApp({});
    const plan3 = TS.plan('- [ ] A\n', { title: 'Z', today: '2026-11-13', createdAt: 'x' });
    app3._fail.on = /\/A\.md$/;
    app3.vault.trash = async (f) => { if (/Z\.md$/.test(f.path)) throw new Error('locked'); };
    let err3 = null;
    try { await TS.apply(app3, plan3); } catch (e) { err3 = e; }
    ok('TS-ROLLBACK-KEPT a file the rollback cannot remove is listed on the error as kept',
      err3 && JSON.stringify(err3.kept) === JSON.stringify(['spice/tasks/Z/Z.md']), JSON.stringify(err3 && err3.kept));
  }

  {
    const doc = { head: { children: [], appendChild(c) { this.children.push(c); } }, createElement: (t) => ({ tag: t, id: '', textContent: '' }) };
    const makeEl = (tag, cls) => {
      const el = { tag, className: cls || '', children: [], style: {}, _attrs: {}, textContent: '', innerHTML: '', value: '', disabled: false, classList: { add() {} } };
      el.createEl = (t, o) => { const c = makeEl(t, (o && o.cls) || ''); if (o && o.text != null) c.textContent = o.text; if (o && o.type) c.type = o.type; el.children.push(c); return c; };
      el.createDiv = (o) => el.createEl('div', o);
      el.createSpan = (o) => el.createEl('span', o);
      el.setAttribute = (k, v) => { el._attrs[k] = v; };
      el.focus = () => { focused.push(el); };
      return el;
    };
    const focused = [];
    const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
    const byCls = (root, cls) => all(root).filter((x) => String(x.className).split(/\s+/).includes(cls));
    let shellOpts = null;
    let closed = 0;
    let shells = 0;
    let left = makeEl('div');
    let footer = makeEl('div');
    const td = new TDClass();
    td.openShell = (o) => {
      shellOpts = o;
      shells += 1;
      if (shells > 1) { left = makeEl('div'); footer = makeEl('div'); }
      const handle = { isOpen: true, submit: (ev) => o.onSubmit(handle, ev) };
      return { handle, modal: makeEl('div'), body: makeEl('div'), footer, left, right: null, close: () => { closed++; handle.isOpen = false; }, doc };
    };
    const mutations = [];
    win.customJS.TaskDialog = td;
    win.customJS.RenderSafe = {
      mutate: async (o) => { mutations.push(o); try { return { ok: true, value: await o.write() }; } catch (error) { return { ok: false, error }; } },
    };
    win.moment = () => ({ format: (f) => (f === 'YYYY-MM-DD' ? '2026-11-13' : '2026-11-13T09:00:00-07:00') });
    const SEED = require('../install.js')._TASK_SETS_SEED;
    const app = makeApp({
      'spice/tasks/_sets/Incident.md': SEED['Incident.md'],
      'spice/tasks/_sets/PR rollout.md': SEED['PR rollout.md'],
    });
    win.app = app;
    const opened = TS.open({ surface: 'home', today: '2026-11-13' });
    const pills = byCls(left, 'sauce-task-set-pill');
    ok('TS-DIALOG New from set opens one dialog with a pill per set, a title and a due date',
      opened === true && shellOpts && shellOpts.title === 'New from set' && shellOpts.columns === false
      && pills.map((b) => b.textContent).join(',') === 'Incident,PR rollout'
      && byCls(left, 'sauce-task-set-title').length === 1 && all(left).some((n) => n.type === 'date'));
    const create = byCls(footer, 'sauce-task-set-create')[0];
    ok('TS-DIALOG-DISABLED Create task waits for a set and a title', create && create.disabled === true);
    pills[1].onclick();
    const title = byCls(left, 'sauce-task-set-title')[0];
    title.value = 'Roll out SSO';
    title.oninput();
    await new Promise((r) => setTimeout(r, 0));
    ok('TS-DIALOG-PICK picking a set marks it and shows what it makes',
      /is-selected/.test(pills[1].className) && !/is-selected/.test(pills[0].className)
      && byCls(left, 'sauce-task-set-caption')[0].textContent === '7 subtasks · comms' && create.disabled === false,
      byCls(left, 'sauce-task-set-caption')[0].textContent);
    await create.onclick({ currentTarget: create });
    const R = 'spice/tasks/Roll out SSO';
    const root = app._files.get(`${R}/Roll out SSO.md`);
    ok('TS-DIALOG-CREATE Create task closes the dialog and writes the task, its subtasks and its comms note in one RenderSafe.mutate',
      closed === 1 && mutations.length === 1 && mutations[0].mode === 'create' && mutations[0].path === `${R}/Roll out SSO.md`
      && root && root._fm.source === 'daily'
      && app._files.has(`${R}/Review/Address review comments/Address review comments.md`)
      && app._files.get(`${R}/Merge/Merge.md`)._fm.due === '2026-11-16'
      && app._files.get(`${R}/Verify in production/Verify in production.md`)._fm.due === '2026-11-17'
      && /Heads up: Roll out SSO goes out today\./.test(app._files.get(`${R}/notes/Comms.md`)._body),
      JSON.stringify(Array.from(app._files.keys())));
    ok('TS-DIALOG-OPEN the new task opens and a notice names the set',
      app._opened[0] === `${R}/Roll out SSO.md` && notices.some((n) => n === 'Created Roll out SSO from PR rollout'), notices.join(' | '));

    {
      const keysBefore = JSON.stringify(Array.from(app._files.keys()).sort());
      TS.open({ surface: 'home', today: '2026-11-13' });
      byCls(left, 'sauce-task-set-pill')[0].onclick();
      const t2 = byCls(left, 'sauce-task-set-title')[0];
      t2.value = 'DB failover';
      t2.oninput();
      const due2 = all(left).find((n) => n.type === 'date');
      due2.value = '2026-11-20';
      due2.onchange();
      app._fail.on = /\/Mitigate\.md$/;
      const firstLeft = left;
      const c2 = byCls(footer, 'sauce-task-set-create')[0];
      await c2.onclick({ currentTarget: c2 });
      app._fail.on = null;
      const reTitle = byCls(left, 'sauce-task-set-title')[0];
      const rePills = byCls(left, 'sauce-task-set-pill');
      ok('TS-DIALOG-FAILED a failed create keeps nothing, says so, and reopens the dialog with the title, set and due date filled in',
        mutations[mutations.length - 1].failureMessage === "Couldn't create from set; nothing was kept" && TS.FAILED === mutations[mutations.length - 1].failureMessage
        && JSON.stringify(Array.from(app._files.keys()).sort()) === keysBefore
        && left !== firstLeft && reTitle && reTitle.value === 'DB failover' && /is-selected/.test(rePills[0].className)
        && all(left).find((n) => n.type === 'date').value === '2026-11-20' && byCls(footer, 'sauce-task-set-create')[0].disabled === false,
        JSON.stringify([reTitle && reTitle.value, Array.from(app._files.keys()).length]));
    }

    {
      app.isMobile = true;
      focused.length = 0;
      TS.open({ surface: 'home', today: '2026-11-13' });
      const phoneTitle = byCls(left, 'sauce-task-set-title')[0];
      await new Promise((r) => setTimeout(r, 80));
      const noFocus = !focused.includes(phoneTitle);
      TS.open({ surface: 'home', today: '2026-11-13', setPath: 'spice/tasks/_sets/Incident.md' });
      const phoneTitle2 = byCls(left, 'sauce-task-set-title')[0];
      await new Promise((r) => setTimeout(r, 80));
      app.isMobile = false;
      TS.open({ surface: 'home', today: '2026-11-13' });
      const deskTitle = byCls(left, 'sauce-task-set-title')[0];
      await new Promise((r) => setTimeout(r, 80));
      ok('TS-DIALOG-PHONE on a phone with no set picked yet the title is not focused (no keyboard over the set pills); with a set, or on desktop, it is',
        noFocus && focused.includes(phoneTitle2) && focused.includes(deskTitle));
    }

    win.app = makeApp({});
    const none = TS.open({});
    ok('TS-DIALOG-NONE with no sets the dialog does not open and a notice says where sets go',
      none === false && /spice\/tasks\/_sets\//.test(notices[notices.length - 1]));
    win.customJS.TaskDialog = new TDClass();
  }

  {
    const seed = require('../install.js')._TASK_SETS_SEED;
    const pr = TS.parse(seed['PR rollout.md']);
    const inc = TS.parse(seed['Incident.md']);
    ok('TS-SEED-PR PR rollout opens the PR, gets CI green, review, merge, deploy and verify, with a Comms note announcing it',
      JSON.stringify(pr.steps.map((s) => s.title)) === JSON.stringify(['Open the PR', 'CI green', 'Review', 'Address review comments', 'Merge', 'Deploy', 'Verify in production'])
      && pr.steps[3].parent === 2 && pr.comms.indexOf('{{task}}') >= 0 && pr.prompt === '');
    ok('TS-SEED-INCIDENT Incident triages, mitigates, finds the root cause and follows up, with a Prompt asking Claude to investigate',
      JSON.stringify(inc.steps.map((s) => s.title)) === JSON.stringify(['Triage impact and severity', 'Post a status update', 'Mitigate', 'Find the root cause', 'Follow-ups', 'Write the postmortem'])
      && /investigate/i.test(inc.prompt) && inc.comms === '');
    ok('TS-SEED-HEADER each seed set starts with a callout that explains the format, and the callout makes no subtasks',
      Object.values(seed).every((t) => /^---\ntype: task-set\n---\n\n> \[!info\] Task set\n> .*`- \[ \]`.*\(due \+2\).*## Prompt.*## Comms.*\{\{task\}\}/.test(t)));
  }

  {
    const manifest = JSON.parse(read('mechanisms/task-entity/manifest.json'));
    ok('TS-MANIFEST the class ships and is loaded',
      manifest.customjs_classes.includes('TaskSets') && manifest.files.some((f) => f.source === 'task-sets.js' && /task-entity\/task-sets\.js$/.test(f.dest)));
    const mirror = path.resolve(__dirname, '../../ranch/scripts/task-entity/task-sets.js');
    ok('TS-MIRROR the ranch mirror equals the platform source', fs.existsSync(mirror) && fs.readFileSync(mirror, 'utf8') === read('mechanisms/task-entity/task-sets.js'));
    ok('TS-README the README tells the user to delete unwanted sets and that an empty _sets/ is never refilled',
      read('mechanisms/task-entity/README.md').includes("Delete the sets you don't want; an empty `_sets/` folder is never refilled."));
    const init = read('blueprints/to-do/helpers/todo-create-task-init.js');
    ok('TS-COMMAND Sauce: New task from set opens the dialog', /id: 'sauce:new-task-from-set'/.test(init) && /name: 'Sauce: New task from set'/.test(init) && /TS\.open\(/.test(init));
  }

  {
    const TE = new TEClass();
    ok('TS-ENTITY _sets is never a task folder: no parent from it, no root folder in it',
      TE.parentNotePathOf('spice/tasks/_sets/X/X.md') === '' && TE.rootFolderOf('spice/tasks/_sets/X/X.md') === ''
      && TE.parentNotePathOf('spice/tasks/A/B/B.md') === 'spice/tasks/A/A.md');
    const sources = [
      'mechanisms/task-entity/task-today-list.js', 'mechanisms/task-entity/task-project-list.js', 'mechanisms/task-entity/task-trip-list.js',
      'mechanisms/task-entity/task-meeting-list.js', 'blueprints/to-do/helpers/todo-daily-project-groups.js', 'blueprints/to-do/helpers/todo-daily-trip-groups.js',
      'blueprints/to-do/helpers/todo-daily-unassigned-meetings.js', 'blueprints/project/helpers/project-dashboard.js',
    ];
    const missing = [];
    for (const f of sources) {
      for (const m of read(f).match(/'"spice\/tasks"[^']*'/g) || []) {
        if (/_trash/.test(m) && !/-"spice\/tasks\/_sets"/.test(m)) missing.push(f + ': ' + m);
      }
    }
    ok('TS-LISTS every task list query that leaves out _done and _trash leaves out _sets too', missing.length === 0, missing.join(' | '));
    const app = makeApp({
      'spice/tasks/_sets/Open/Open.md': '---\ntype: task\ntitle: Open\nstatus: open\n---\n',
      'spice/tasks/Live/Live.md': '---\ntype: task\ntitle: Live\nstatus: open\n---\n',
    });
    for (const f of app._files.values()) f._fm.status = 'open';
    const cands = TDClass._parentCandidates(app, '');
    ok('TS-DIALOG-PARENT a task-shaped note in _sets is never offered as a parent', JSON.stringify(cands) === JSON.stringify(['Live']), JSON.stringify(cands));
  }

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\nrun-task-sets: ${results.length - failed} pass · ${failed} fail`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
