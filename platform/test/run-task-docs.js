#!/usr/bin/env node
/**
 * run-task-docs.js — task notes: prompts, handoffs, plans, context, findings
 * and questions that belong to a task without being steps of it. TaskDocs
 * keeps them at spice/tasks/<Task>/notes/ as `type: task-doc`, lists them on
 * the task card's Notes section in kind order, copies a note's prompt, and
 * creates new ones, blank under their header, with vault-unique names. The
 * task-entity manifest ships the class, a breadcrumb for task-doc notes, and
 * directory-map rows that tell agent sessions where to write. Zero-dep; exit
 * 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c, d) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${c || d == null ? '' : ' — ' + d}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const TaskDocs = new Function('window', 'Notice', `${read('mechanisms/task-entity/task-docs.js')}\nreturn TaskDocs;`);
const TEClass = new Function(`${read('mechanisms/task-entity/task-entity.js')}\nreturn TaskEntity;`)();

function makeApp(seed) {
  const files = new Map();
  const folders = new Map();
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const addFolder = (d) => {
    for (let x = d; x; x = x.lastIndexOf('/') < 0 ? '' : dirOf(x)) {
      if (!folders.has(x)) folders.set(x, { path: x, children: [] });
    }
  };
  const link = () => {
    for (const f of folders.values()) f.children = [];
    for (const f of folders.values()) { const d = f.path.indexOf('/') < 0 ? null : folders.get(dirOf(f.path)); if (d) d.children.push(f); }
    for (const f of files.values()) { const d = folders.get(dirOf(f.path)); if (d) d.children.push(f); }
  };
  const deleted = [];
  const put = (p, fm, body, mtime) => {
    files.set(p, { path: p, basename: p.split('/').pop().replace(/\.md$/, ''), _fm: fm ? Object.assign({}, fm) : null, _body: body || '', stat: { mtime: mtime || 0 } });
    addFolder(dirOf(p));
    link();
  };
  for (const [p, v] of Object.entries(seed || {})) put(p, v.fm, v.body, v.mtime);
  const opened = [];
  return {
    _files: files, _opened: opened, _deleted: deleted, _relink: link,
    vault: {
      delete: async (f) => {
        if (!f || !Array.isArray(f.children) || f.children.length) throw new Error('not an empty folder');
        folders.delete(f.path); deleted.push(f.path); link();
      },
      getAbstractFileByPath: (p) => files.get(p) || folders.get(p) || null,
      getMarkdownFiles: () => Array.from(files.values()),
      createFolder: async (p) => { addFolder(p); link(); },
      create: async (p, text) => {
        if (files.has(p)) throw new Error('exists');
        if (!folders.has(dirOf(p))) throw new Error('no folder');
        const fm = {};
        const m = /^---\n([\s\S]*?)\n---/.exec(text);
        if (m) for (const line of m[1].split('\n')) { const kv = /^(\w+): (.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2].replace(/^"|"$/g, ''); }
        put(p, fm, text, Date.now());
        return files.get(p);
      },
      cachedRead: async (f) => f._body,
    },
    metadataCache: { getFileCache: (f) => (f && f._fm ? { frontmatter: f._fm } : null) },
    workspace: { openLinkText: (p) => opened.push(p) },
  };
}

const win = { customJS: { TaskEntity: new TEClass() }, moment: null };
const TD = TaskDocs(win, function () {});

ok('TD-KINDS the kinds are prompt, handoff, comms, plan, context, findings, questions, note; anything else reads as note',
  JSON.stringify(TD.KINDS.map((k) => k.key)) === JSON.stringify(['prompt', 'handoff', 'comms', 'plan', 'context', 'findings', 'questions', 'note'])
  && TD.kindOf('Handoff') === 'handoff' && TD.kindOf('runbook') === 'note' && TD.kindOf(null) === 'note');
ok('TD-FOLDER a folder task keeps its notes in <Task>/notes; a flat task has none',
  TD.notesFolder('spice/tasks/Backup Script/Backup Script.md') === 'spice/tasks/Backup Script/notes'
  && TD.notesFolder('spice/tasks/A/B/B.md') === 'spice/tasks/A/B/notes'
  && TD.notesFolder('spice/tasks/Flat.md') === '' && TD.notesFolder('spice/tasks/A/notes/Prompt.md') === '');

{
  const text = TD.compose('handoff', 'Handoff', 'Finish AccurAPI Plugin', '2026-11-12T10:00:00-07:00');
  ok('TD-COMPOSE a new note is type task-doc with its kind, title and task link, then the breadcrumb bar and header card',
    /^---\ntype: task-doc\nkind: handoff\ntitle: "Handoff"\ntask: "\[\[Finish AccurAPI Plugin\]\]"\ncreated_at: 2026-11-12T10:00:00-07:00\n---\n/.test(text)
    && /\n---\n\n```dataviewjs\n[^`]*TaskChromeBar[^`]*```\n\n```dataviewjs\n[^`]*class: "TaskDocs", method: "renderHeader"[^`]*```\n\n/.test(text) && !/\[!info\]/.test(text));
  const blank = (k) => { const c = TD.compose(k, 'X', 'Task', 'x'); return c.slice(c.indexOf(TD.HEADER) + TD.HEADER.length) === '\n'; };
  ok('TD-COMPOSE-BLANK every kind starts blank under its header: no starter text',
    TD.KINDS.every((k) => blank(k.key)) && blank('unknown') && typeof TD.template === 'undefined', TD.KINDS.filter((k) => !blank(k.key)).map((k) => k.key));
}

{
  const chromeBody = '---\ntype: task\ntitle: Prompt\n---\n\n```dataviewjs\nawait dv.view("x", { class: "TaskNoteView" });\n```\n\n<!-- TASK_NOTES -->\nI am wanting for you to take a look at the dir.\n- accuris-connect.iac\n';
  ok('TD-PROMPT-PLAIN a prompt written as plain text (as the old prompt subtasks are) copies its text without frontmatter or code-run blocks',
    TD.extractPrompt(chromeBody) === 'I am wanting for you to take a look at the dir.\n- accuris-connect.iac');
  const quoted = '> [!tip] Resume session\n> ```bash\n> cd ~/x\n> claude --resume abc\n> ```\n\n> [!example]- Prompt to paste\n> ````text\n> You are continuing work.\n>\n> Then do these.\n> ````\n';
  ok('TD-PROMPT-CALLOUT a prompt inside a "Prompt to paste" callout copies unquoted, and the Resume session block is not it',
    TD.extractPrompt(quoted) === 'You are continuing work.\n\nThen do these.');
  ok('TD-PROMPT-FIRST-TEXT-FENCE with no prompt heading, the first text fence is the prompt; a bash fence is not',
    TD.extractPrompt('Intro\n```bash\nls\n```\n```\nDo the thing\n```\n') === 'Do the thing');
  ok('TD-PROMPT-NEW-PROMPT a new prompt note has nothing to copy until something is written under its header',
    TD.extractPrompt(TD.compose('prompt', 'Prompt', 'Backup Script', 'x')) === ''
    && TD.extractPrompt(TD.compose('prompt', 'Prompt', 'Backup Script', 'x') + 'Look at the dir.\n') === 'Look at the dir.');
  ok('TD-PROMPT-EMPTY an empty note has nothing to copy', TD.extractPrompt('---\ntype: task-doc\n---\n') === '' && TD.extractPrompt(null) === '');
}

(async () => {
  const T = 'spice/tasks/Backup Script';
  const app = makeApp({
    [`${T}/Backup Script.md`]: { fm: { type: 'task', title: 'Backup Script' } },
    [`${T}/notes/Plan (Backup Script).md`]: { fm: { type: 'task-doc', kind: 'plan', title: 'Plan' }, mtime: 500 },
    [`${T}/notes/Prompt (Backup Script).md`]: { fm: { type: 'task-doc', kind: 'prompt', title: 'Prompt' }, body: 'Do it', mtime: 100 },
    [`${T}/notes/Handoff (Backup Script).md`]: { fm: { type: 'task-doc', kind: 'handoff', title: 'Handoff' }, mtime: 300 },
    [`${T}/notes/Older prompt.md`]: { fm: { type: 'task-doc', kind: 'prompt', title: 'Older prompt' }, mtime: 50 },
    [`${T}/notes/Loose.md`]: { fm: null, mtime: 10 },
    [`${T}/notes/notes.md`]: { fm: { type: 'task', title: 'notes' } },
    'spice/tasks/Other/Other.md': { fm: { type: 'task', title: 'Other' } },
    'spice/projects/x/Prompt.md': { fm: { type: 'doc-note' } },
  });
  const list = TD.list(app, `${T}/Backup Script.md`);
  ok('TD-LIST notes list in kind order, newest first within a kind; a task note in the folder is not a note',
    JSON.stringify(list.map((d) => d.title)) === JSON.stringify(['Prompt', 'Older prompt', 'Handoff', 'Plan', 'Loose']), JSON.stringify(list.map((d) => d.title)));

  const made = await TD.create(app, 'spice/tasks/Other/Other.md', 'prompt', '');
  ok('TD-CREATE a new note goes in the task\'s notes folder, named by the title plus the task on a clash',
    made.ok === true && made.path === 'spice/tasks/Other/notes/Prompt (Other).md'
    && app._files.get(made.path)._fm.type === 'task-doc' && app._files.get(made.path)._fm.kind === 'prompt', JSON.stringify(made));
  const fresh = await TD.create(app, 'spice/tasks/Other/Other.md', 'findings', 'Index sizes');
  ok('TD-CREATE-UNIQUE a unique title keeps its plain name', fresh.ok && fresh.path === 'spice/tasks/Other/notes/Index sizes.md');
  const flat = await TD.create(app, 'spice/tasks/Flat.md', 'note', 'x');
  ok('TD-CREATE-FLAT a flat task cannot hold notes', flat.ok === false);

  const makeEl = (tag, cls) => {
    const el = { tag, className: cls || '', children: [], style: {}, _attrs: {}, _l: {}, textContent: '', innerHTML: '', classList: { add() {}, remove() {} } };
    el.createEl = (t, o) => { const c = makeEl(t, (o && o.cls) || ''); if (o && o.text != null) c.textContent = o.text; el.children.push(c); c.parentNode = el; return c; };
    el.setAttribute = (k, v) => { el._attrs[k] = v; };
    el.addEventListener = (k, fn) => { el._l[k] = fn; };
    el.removeChild = (c) => { el.children.splice(el.children.indexOf(c), 1); };
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
    return el;
  };
  const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
  const byCls = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
  const copied = [];
  const menus = [];
  win.customJS.TaskTodayList = { copyText: async (t) => { copied.push(t); return true; } };
  win.customJS.MenuPopover = { open: (entries, o) => menus.push({ entries, o }) };
  const card = makeEl('div');
  const section = TD.render(card, { app, taskPath: `${T}/Backup Script.md` });
  const rows = byCls(section, 'sauce-tnv-doc');
  ok('TD-RENDER the Notes section draws one row per note with its kind, and Copy prompt only on prompt and handoff notes',
    rows.length === 5 && byCls(section, 'sauce-tnv-doc-copy').length === 3
    && byCls(section, 'sauce-tnv-label')[0].textContent === 'Notes' && byCls(section, 'sauce-tnv-count')[0].textContent === '5');
  await byCls(rows[0], 'sauce-tnv-doc-copy')[0]._l.click({ stopPropagation() {} });
  ok('TD-RENDER-COPY Copy prompt copies the note\'s prompt', copied[0] === 'Do it');
  byCls(rows[3], 'sauce-tnv-doc-main')[0]._l.click();
  ok('TD-RENDER-OPEN clicking a row opens the note', app._opened[0] === `${T}/notes/Plan (Backup Script).md`);
  byCls(section, 'sauce-tnv-doc-add')[0]._l.click();
  ok('TD-RENDER-ADD + Note offers every kind', menus[0] && menus[0].entries.map((e) => e.label).join(',') === 'Prompt,Handoff,Comms,Plan,Context,Findings,Questions,Note');
  const none = TD.render(makeEl('div'), { app, taskPath: 'spice/tasks/Flat.md' });
  const empty = TD.render(makeEl('div'), { app, taskPath: 'spice/tasks/Other/Other.md' });
  ok('TD-RENDER-NONE a flat task draws no Notes section', none === null && empty !== null);

  const manifest = JSON.parse(read('mechanisms/task-entity/manifest.json'));
  ok('TD-MANIFEST the class ships and is loaded',
    manifest.customjs_classes.includes('TaskDocs') && manifest.files.some((f) => f.source === 'task-docs.js' && /task-entity\/task-docs\.js$/.test(f.dest)));
  ok('TD-MANIFEST-BREADCRUMB a task-doc note\'s breadcrumb links back to its task',
    manifest.breadcrumb.types['task-doc'] && manifest.breadcrumb.types['task-doc'].ancestors.some((a) => a.link === '{fm:task}'));
  const rowsMd = (manifest.claude_surface || []).filter((s) => s.kind === 'claude_md_row' && s.table === 'directory-map').map((s) => s.row);
  ok('TD-MANIFEST-AGENTS the vault CLAUDE.md tells sessions where task notes and tasks go',
    rowsMd.some((r) => r.path === 'spice/tasks/<Task>/notes/' && /task-doc/.test(r.purpose) && /not as subtasks/.test(r.purpose))
    && rowsMd.some((r) => r.path === 'spice/tasks/<Task>/<Task>.md' && /Never write a flat/.test(r.purpose)));
  const cardSrc = read('mechanisms/task-entity/task-note-view.js');
  ok('TD-CARD the task card draws the Notes section after Subtasks', /TDocs\.render\(card, \{ app: appRef, taskPath: filePath \}\)/.test(cardSrc)
    && cardSrc.indexOf('TDocs.render(card') > cardSrc.indexOf("text: 'Subtasks'"));

  ok('TD-TITLE-KIND note-like subtask titles read as their kind; step-like titles do not',
    TD.titleKind('Prompt (Backup Script)') === 'prompt' && TD.titleKind('Handoff Prompt (Finish AccurAPI Plugin)') === 'handoff'
    && TD.titleKind('Redis us-west-2 handoff') === 'handoff' && TD.titleKind('Proposed Plan') === 'plan'
    && TD.titleKind('Questions (Prompt) 2') === 'questions' && TD.titleKind('Explanation') === 'context'
    && TD.titleKind('CI Impact') === 'findings' && TD.titleKind('Major Theme Initial Prompt') === 'prompt'
    && TD.titleKind('Determine Plan to Handle Multi Service Deploys') === '' && TD.titleKind('Plan out Refactor') === ''
    && TD.titleKind('Take a look at Re-Authenticate Prompts PR for Mesh') === '' && TD.titleKind('') === '');

  {
    const H = 'spice/tasks/Hemi Config';
    const chrome = (title, extra) => '---\ntype: task\ntitle: ' + title + '\nstatus: done\ndue: ""\nparent_task: "[[x]]"\ncreated_at: 2026-11-12\n---\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });\n```\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n```\n\n<!-- TASK_NOTES -->\n' + (extra || '');
    const fmFrom = (text) => { const o = {}; const m = /^---\n([\s\S]*?)\n---/.exec(text); if (m) for (const l of m[1].split('\n')) { const kv = /^(\w+): (.*)$/.exec(l); if (kv) o[kv[1]] = kv[2].replace(/^"|"$/g, ''); } return o; };
    const seed = {
      [`${H}/Hemi Config.md`]: { fm: { type: 'task', title: 'Hemi Config' } },
      [`${H}/Prompt (Hemi Config)/Prompt (Hemi Config).md`]: { body: chrome('Prompt', 'Look at the config repos.\n') },
      [`${H}/Prompt (Hemi Config)/Questions (Prompt)/Questions (Prompt).md`]: { body: chrome('Questions', '- which env?\n') },
      [`${H}/Ship it/Ship it.md`]: { body: chrome('Ship it') },
      [`${H}/Plan/Plan.md`]: { body: chrome('Plan') },
      [`${H}/Plan/Do step one/Do step one.md`]: { body: chrome('Do step one') },
      [`${H}/Context/Context.md`]: { body: chrome('Context') },
      [`${H}/Context/diagram.png`]: { body: '' },
      'spice/tasks/Elsewhere/Elsewhere.md': { fm: { type: 'task', title: 'Elsewhere' }, body: 'see [[Prompt (Hemi Config)]]' },
    };
    for (const v of Object.values(seed)) if (v.body && !v.fm) v.fm = fmFrom(v.body);
    const app2 = makeApp(seed);
    for (const f of app2._files.values()) if (/\.png$/.test(f.path)) f.extension = 'png';
    app2.fileManager = {
      processFrontMatter: async (f, fn) => { fn(f._fm); },
      renameFile: async (f, to) => {
        app2._files.delete(f.path);
        const old = f.path;
        f.path = to; f.basename = to.split('/').pop().replace(/\.md$/, '');
        app2._files.set(to, f);
        app2._renames = (app2._renames || []).concat([[old, to]]);
        app2._relink();
      },
    };
    app2.vault.process = async (f, fn) => { f._body = fn(f._body); };
    const cands = TD.candidates(app2, `${H}/Hemi Config.md`);
    ok('TD-CANDIDATES a note-like subtask and the note-like subtask under it are offered; one with a step under it or an attachment is not',
      JSON.stringify(cands.map((c) => [c.title, c.kind, c.depth])) === JSON.stringify([['Prompt', 'prompt', 1], ['Questions', 'questions', 2]]), JSON.stringify(cands));
    ok('TD-CANDIDATES-SELF a note-like subtask offers nothing itself; its parent converts the whole tree',
      TD.candidates(app2, `${H}/Prompt (Hemi Config)/Prompt (Hemi Config).md`).length === 0);
    const res = await TD.convert(app2, `${H}/Hemi Config.md`, cands.map((c) => ({ path: c.path, kind: c.kind })));
    const prompt = app2._files.get(`${H}/notes/Prompt.md`);
    const questions = app2._files.get(`${H}/notes/Questions.md`);
    ok('TD-CONVERT both land in the task\'s notes as task-docs, task fields dropped, title kept, linked to the task',
      res.converted.length === 2 && res.failed.length === 0 && prompt && questions
      && prompt._fm.type === 'task-doc' && prompt._fm.kind === 'prompt' && prompt._fm.task === '[[Hemi Config]]' && prompt._fm.title === 'Prompt'
      && !('status' in prompt._fm) && !('parent_task' in prompt._fm) && !('due' in prompt._fm) && prompt._fm.created_at === '2026-11-12'
      && questions._fm.kind === 'questions', JSON.stringify(res));
    ok('TD-CONVERT-BODY the task card is replaced by the note header card and the text is kept',
      !/TaskNoteView|TASK_NOTES/.test(prompt._body) && /method: "renderHeader"/.test(prompt._body) && prompt._body.split('TaskChromeBar').length === 2
      && /Look at the config repos\./.test(prompt._body) && TD.extractPrompt(prompt._body) === 'Look at the config repos.');
    ok('TD-CONVERT-ORDER deepest first, so the nested one moves before its parent, through renameFile (links follow)',
      app2._renames[0][0] === `${H}/Prompt (Hemi Config)/Questions (Prompt)/Questions (Prompt).md` && app2._renames.length === 2);
    ok('TD-CONVERT-FOLDERS emptied subtask folders are removed; others stay',
      app2._deleted.includes(`${H}/Prompt (Hemi Config)/Questions (Prompt)`) && app2._deleted.includes(`${H}/Prompt (Hemi Config)`)
      && app2._files.has(`${H}/Plan/Plan.md`) && app2._files.has(`${H}/Context/Context.md`) && app2._files.has(`${H}/Ship it/Ship it.md`));
    ok('TD-CONVERT-LIST the converted notes now show on the card list', TD.list(app2, `${H}/Hemi Config.md`).map((d) => d.title).join(',') === 'Prompt,Questions');

    const card2 = makeEl('div');
    const app3 = makeApp(seed);
    for (const f of app3._files.values()) if (/\.png$/.test(f.path)) f.extension = 'png';
    const sec2 = TD.render(card2, { app: app3, taskPath: `${H}/Hemi Config.md` });
    const hint = byCls(sec2, 'sauce-tnv-notes-hint')[0];
    ok('TD-RENDER-HINT the Notes section offers to review subtasks that read like notes',
      hint && hint.children[0] && hint.children[0].textContent === '2 subtasks read like notes' && byCls(sec2, 'sauce-tnv-doc-review').length === 1);
  }


  {
    const install = require('../install.js');
    const oldNote = '---\ntype: task-doc\nkind: prompt\ntitle: "Prompt"\ntask: "[[Get SND Alerting]]"\n---\n\n> [!info] Prompt for [[Get SND Alerting]]\n\nWrite the prompt here.\n';
    const healed = TD.withHeader(oldNote);
    ok('TD-WITH-HEADER an older note gets the breadcrumb bar and header card after its frontmatter, in place of its one-line header',
      /^---\n[\s\S]*?\n---\n\n```dataviewjs\nawait dv.view\("ranch\/views\/customjs-guard", \{ class: "TaskChromeBar" \}\);\n```\n\n```dataviewjs\nawait dv.view\("ranch\/views\/customjs-guard", \{ class: "TaskDocs", method: "renderHeader" \}\);\n```\n\nWrite the prompt here\.\n$/.test(healed)
      && !/\[!info\]/.test(healed), JSON.stringify(healed));
    ok('TD-WITH-HEADER-IDEMPOTENT a note with the header is unchanged, and a user callout is kept',
      TD.withHeader(healed) === healed
      && /> \[!info\] Context for the reviewer/.test(TD.withHeader('---\ntype: task-doc\n---\n> [!info] Context for the reviewer\n> read this\n')));
    ok('TD-WITH-HEADER-PROMPT the header blocks never end up in a copied prompt', TD.extractPrompt(healed) === 'Write the prompt here.');
    ok('TD-HEADER-INSTALLER the installer adds the same header, by the same rules, as new notes get',
      install._TASK_DOC_HEADER === TD.HEADER
      && [oldNote, healed, '---\ntype: task-doc\n---\nbody\n', 'no frontmatter\n', '---\na: 1\n---'].every((t) => install._taskDocWithHeader(t) === TD.withHeader(t)));
    ok('TD-TASK-PATH a note\'s task is the folder note above its notes folder',
      TD.taskPathOf('spice/tasks/A/notes/P.md') === 'spice/tasks/A/A.md' && TD.taskPathOf('spice/tasks/A/B/notes/P.md') === 'spice/tasks/A/B/B.md'
      && TD.taskPathOf('spice/tasks/A/A.md') === '' && TD.taskPathOf('notes/P.md') === '');
    const due = (d, s) => JSON.stringify(TD.dueChip(d, '2026-11-12', s));
    ok('TD-DUE the task\'s due chip reads today, tomorrow, overdue or the date',
      due('2026-11-12') === '{"text":"Due today","tone":"accent"}' && due('2026-11-13') === '{"text":"Due tomorrow","tone":""}'
      && due('2026-11-10') === '{"text":"Overdue · Nov 10","tone":"danger"}' && due('2026-11-10', 'done') === '{"text":"Due Nov 10","tone":""}'
      && due('2026-12-01') === '{"text":"Due Dec 1","tone":""}' && TD.dueChip('', '2026-11-12') === null);

    const chromeCfg = new Function(`${read('mechanisms/task-entity/task-chrome-bar.js')}\nreturn TaskChromeBar;`)()._config();
    ok('TD-CHROME the breadcrumb bar draws on task notes as well as tasks',
      chromeCfg.detect(null, { type: 'task-doc', file: { path: 'x' } }).context === 'task-doc'
      && chromeCfg.detect(null, { type: 'task', file: { path: 'x' } }).context === 'task' && chromeCfg.detect(null, { type: 'doc-note' }) === null);

    const mem = new Map([
      ['spice/tasks/A/A.md', '---\ntype: task\n---\n'],
      ['spice/tasks/A/notes/Prompt (A).md', oldNote],
      ['spice/tasks/A/notes/Done.md', healed],
      ['spice/tasks/A/notes/Loose.md', 'no frontmatter'],
      ['spice/tasks/A/B/notes/Plan.md', '---\ntype: task-doc\nkind: plan\n---\n\n## Goal\n'],
      ['spice/tasks/A/Prompt/Prompt.md', '---\ntype: task-doc\n---\n'],
    ]);
    const writes = [];
    const dirs = () => { const s = new Set(); for (const k of mem.keys()) { const parts = k.split('/'); for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/')); } return s; };
    const adapter = {
      exists: async (p) => mem.has(p) || dirs().has(p),
      list: async (p) => {
        const files = [], folders = new Set();
        for (const k of mem.keys()) {
          if (!k.startsWith(p + '/')) continue;
          const rest = k.slice(p.length + 1).split('/');
          if (rest.length === 1) files.push(k); else folders.add(p + '/' + rest[0]);
        }
        return { files, folders: Array.from(folders) };
      },
      read: async (p) => mem.get(p),
      write: async (p, t) => { writes.push(p); mem.set(p, t); },
    };
    const history = [];
    await install.applyTaskDocHeaderHeal({ app: { vault: { adapter } } }, history, {});
    ok('TD-HEAL the installer gives task notes without one the header, and leaves everything else alone',
      JSON.stringify(writes.sort()) === JSON.stringify(['spice/tasks/A/B/notes/Plan.md', 'spice/tasks/A/notes/Prompt (A).md'])
      && mem.get('spice/tasks/A/notes/Prompt (A).md') === healed && /method: "renderHeader"[\s\S]*## Goal/.test(mem.get('spice/tasks/A/B/notes/Plan.md'))
      && history.some((h) => h.step === 'task_doc_header_heal' && h.summary.notes === 2), JSON.stringify(writes));
    writes.length = 0;
    await install.applyTaskDocHeaderHeal({ app: { vault: { adapter } } }, [], {});
    ok('TD-HEAL-IDEMPOTENT a second run writes nothing', writes.length === 0);
  }

  {
    const T = 'spice/tasks/Backup Script';
    const hApp = makeApp({
      'spice/tasks/Infra/Infra.md': { fm: { type: 'task', title: 'Infra' } },
      [`spice/tasks/Infra/${'Backup Script'}/Backup Script.md`]: { fm: { type: 'task', title: 'Backup Script', status: 'open', due: '2026-11-12', priority: 'high', project: '[[Content-Registry]]' } },
      [`spice/tasks/Infra/Backup Script/notes/Prompt (Backup Script).md`]: { fm: { type: 'task-doc', kind: 'prompt', title: 'Prompt', created_at: '2026-11-12T10:00:00-06:00' }, body: '---\ntype: task-doc\n---\n\nDo it', mtime: 900 },
      [`spice/tasks/Infra/Backup Script/notes/Plan.md`]: { fm: { type: 'task-doc', kind: 'plan', title: 'Plan' }, mtime: 500 },
    });
    hApp.vault.read = async (f) => f._body;
    const fmCalls = [];
    hApp.fileManager = { processFrontMatter: async (f, fn) => { fn(f._fm); fmCalls.push(f.path); } };
    const copied = [];
    const menus = [];
    win.customJS.TaskTodayList = { copyText: async (t) => { copied.push(t); return true; } };
    win.customJS.MenuPopover = { open: (entries, o) => menus.push({ entries, o }) };
    const mutations = [];
    win.customJS.RenderSafe = {
      mutate: async (o) => {
        mutations.push(o);
        try { await o.optimistic(); await o.write(); return { ok: true }; } catch (e) { await o.revert(e); return { ok: false, error: e }; }
      },
    };
    win.moment = () => ({ format: (f) => (f === 'YYYY-MM-DD' ? '2026-11-12' : f === 'YYYY/MM-MMMM' ? '2026/11-November' : '') });
    const mk = (tag, cls) => {
      const el = { tag, className: cls || '', children: [], style: {}, _attrs: {}, _l: {}, textContent: '', _html: '', classes: new Set(String(cls || '').split(/\s+/).filter(Boolean)) };
      el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c) };
      Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: (v) => { el._html = v; el.children = []; } });
      el.createEl = (t, o) => { const c = mk(t, (o && o.cls) || ''); if (o && o.text != null) c.textContent = o.text; el.children.push(c); return c; };
      el.setAttribute = (k, v) => { el._attrs[k] = v; };
      el.addEventListener = (k, fn) => { el._l[k] = fn; };
      el.insertAdjacentHTML = (where, html) => { el._html += html; };
      return el;
    };
    const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
    const by = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
    const text = (root, cls) => by(root, cls).map((n) => n.textContent || (n.children[0] && n.children[0].textContent) || '');
    const P = 'spice/tasks/Infra/Backup Script/notes/Prompt (Backup Script).md';
    const dv = { container: mk('div'), current: () => ({ file: { path: P } }) };
    const card = TD.renderHeader(dv, { app: hApp });
    ok('TD-HEADER-RENDER a prompt note draws a prompt-coloured header card: kind badge, title, and the trail back through its parent task',
      card && card._attrs['data-kind'] === 'prompt' && text(card, 'sauce-tdv-crumb').join(' › ') === 'To-Do › Infra › Backup Script'
      && by(card, 'sauce-tdv-kind')[0].children[0].textContent === 'Prompt' && text(card, 'sauce-tdv-title')[0] === 'Prompt', JSON.stringify(text(card, 'sauce-tdv-crumb')));
    ok('TD-HEADER-CHIPS the card shows the task\'s status, due date, priority and project, and when the note was made',
      JSON.stringify(text(card, 'sauce-tdv-chip')) === JSON.stringify(['Task open', 'Due today', 'High priority', 'Content-Registry'])
      && /^Created Nov 12/.test(text(card, 'sauce-tdv-meta')[0]), JSON.stringify(text(card, 'sauce-tdv-chip')));
    ok('TD-HEADER-SIBLINGS the card steps to the task\'s other notes', text(card, 'sauce-tdv-pos')[0] === '1 of 2 notes' && by(card, 'sauce-tdv-sib').length === 1);
    await by(card, 'sauce-tdv-copy')[0]._l.click();
    ok('TD-HEADER-COPY Copy prompt copies the note\'s prompt', copied[copied.length - 1] === 'Do it' && by(card, 'sauce-tdv-copy')[0].style.display === '');
    by(card, 'sauce-tdv-task')[0]._l.click({});
    by(card, 'sauce-tdv-crumb')[2]._l.click({});
    ok('TD-HEADER-OPEN Open task and the trail open the task', hApp._opened.slice(-2).every((p) => p === 'spice/tasks/Infra/Backup Script/Backup Script.md'));
    by(card, 'sauce-tdv-kind')[0]._l.click();
    const menu = menus[menus.length - 1];
    ok('TD-HEADER-KIND-MENU the kind badge offers every kind, the current one ticked', menu && menu.entries.length === 8 && /✓/.test(menu.entries[0].label));
    await menu.entries.find((e) => e.label === 'Plan').onSelect();
    ok('TD-HEADER-KIND-CHANGE picking a kind writes it through RenderSafe.mutate and recolours the card; Copy prompt hides for a plan',
      mutations.length === 1 && mutations[0].path === P && fmCalls[0] === P && hApp._files.get(P)._fm.kind === 'plan'
      && card._attrs['data-kind'] === 'plan' && by(card, 'sauce-tdv-copy')[0].style.display === 'none');
    hApp.fileManager.processFrontMatter = async () => { throw new Error('locked'); };
    by(card, 'sauce-tdv-kind')[0]._l.click();
    await menus[menus.length - 1].entries.find((e) => e.label === 'Handoff').onSelect();
    ok('TD-HEADER-KIND-REVERT a failed write puts the card back to the kind on disk',
      card._attrs['data-kind'] === 'plan' && by(card, 'sauce-tdv-kind')[0].children[0].textContent === 'Plan' && mutations[1].failureMessage === 'Could not change the kind');
    ok('TD-HEADER-NONE a note that is not in a vault file, or inside an embed, draws nothing',
      TD.renderHeader({ container: mk('div'), current: () => ({ file: { path: 'nope.md' } }) }, { app: hApp }) === null
      && TD.renderHeader({ container: Object.assign(mk('div'), { closest: () => ({}) }), current: () => ({ file: { path: P } }) }, { app: hApp }) === null);
    ok('TD-HEADER-CSS each kind has its own colour, used by the card and the task card\'s note icons',
      Object.keys(TD.TONES).join(',') === TD.KINDS.map((k) => k.key).join(',') && /\.sauce-tdv\[data-kind="prompt"\]/.test(TD._CSS) && /\.sauce-tnv-doc\.is-handoff/.test(TD._CSS));
    win.moment = null;
  }


  {
    const comms = TD.compose('comms', 'Comms', 'Get SND Alerting', '2026-11-13T09:00:00-06:00');
    const kind = TD.KINDS.find((k) => k.key === 'comms');
    ok('TD-COMMS a Comms note has a message-bubble icon, its own colour, and copies its message with Copy message',
      kind && kind.label === 'Comms' && kind.copy === true && kind.copyLabel === 'Copy message' && /M7\.9 20A9 9 0 1 0 4 16\.1L2 22Z/.test(kind.icon)
      && /pink/.test(TD.TONES.comms) && !/Send to/.test(comms)
      && TD.extractPrompt(comms + 'Hi Sam,\n\nThe fix ships today.\n') === 'Hi Sam,\n\nThe fix ships today.', TD.extractPrompt(comms));
    ok('TD-COMMS-TITLE subtasks titled like a message read as comms',
      TD.titleKind('Comms') === 'comms' && TD.titleKind('Slack message') === 'comms' && TD.titleKind('Customer comms') === 'comms'
      && TD.titleKind('Message the team about the outage') === '');
    const C = 'spice/tasks/Outage';
    const cApp = makeApp({
      [`${C}/Outage.md`]: { fm: { type: 'task', title: 'Outage' } },
      [`${C}/notes/Comms (Outage).md`]: { fm: { type: 'task-doc', kind: 'comms', title: 'Comms' }, body: '```text\nHi all, the fix ships today.\n```', mtime: 5 },
    });
    const copied = [];
    win.customJS.TaskTodayList = { copyText: async (t) => { copied.push(t); return true; } };
    const mkEl = (tag, cls) => {
      const el = { tag, className: cls || '', children: [], style: {}, _attrs: {}, _l: {}, textContent: '', innerHTML: '', classList: { add() {}, remove() {} } };
      el.createEl = (t, o) => { const c = mkEl(t, (o && o.cls) || ''); if (o && o.text != null) c.textContent = o.text; el.children.push(c); return c; };
      el.setAttribute = (k, v) => { el._attrs[k] = v; };
      el.addEventListener = (k, fn) => { el._l[k] = fn; };
      el.removeChild = (c) => { el.children.splice(el.children.indexOf(c), 1); };
      Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
      return el;
    };
    const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
    const sec = TD.render(mkEl('div'), { app: cApp, taskPath: `${C}/Outage.md` });
    const btn = all(sec).find((n) => n.className === 'sauce-tnv-doc-copy');
    const label = btn.textContent;
    await btn._l.click({ stopPropagation() {} });
    ok('TD-COMMS-CARD on the task card a Comms note offers Copy message, which copies the message',
      label === 'Copy message' && copied[0] === 'Hi all, the fix ships today.', JSON.stringify([label, copied]));
  }


  {
    const R = 'spice/tasks/Redis';
    const rApp = makeApp({
      [`${R}/Redis.md`]: { fm: { type: 'task', title: 'Fix Redis' } },
      [`${R}/notes/Prompt (Redis).md`]: { fm: { type: 'task-doc', kind: 'prompt', title: 'Prompt' }, body: 'one', mtime: 9 },
      [`${R}/notes/Prompt 2.md`]: { fm: { type: 'task-doc', kind: 'prompt', title: 'Prompt' }, body: 'two', mtime: 8 },
      'spice/tasks/Other/notes/Taken name.md': { fm: { type: 'task-doc', title: 'Taken name' } },
    });
    const renames = [];
    rApp.fileManager = {
      processFrontMatter: async (f, fn) => { fn(f._fm); },
      renameFile: async (f, to) => { renames.push([f.path, to]); rApp._files.delete(f.path); f.path = to; f.basename = to.split('/').pop().replace(/\.md$/, ''); rApp._files.set(to, f); rApp._relink(); },
    };
    const a = await TD.rename(rApp, `${R}/notes/Prompt (Redis).md`, '  Prompt   for the  failover ');
    ok('TD-RENAME a note takes the new name as its title and file name, moved with renameFile so links follow',
      a.ok && a.path === `${R}/notes/Prompt for the failover.md` && rApp._files.get(a.path)._fm.title === 'Prompt for the failover'
      && renames[0][0] === `${R}/notes/Prompt (Redis).md`, JSON.stringify(a));
    const b = await TD.rename(rApp, `${R}/notes/Prompt 2.md`, 'Taken name');
    ok('TD-RENAME-CLASH a name used elsewhere in the vault gets the task after it, the way new notes do',
      b.ok && b.path === `${R}/notes/Taken name (Fix Redis).md` && rApp._files.get(b.path)._fm.title === 'Taken name', JSON.stringify(b));
    renames.length = 0;
    const c = await TD.rename(rApp, `${R}/notes/Taken name (Fix Redis).md`, 'Taken name');
    ok('TD-RENAME-SAME renaming to its own name keeps the file where it is', c.ok && c.path === `${R}/notes/Taken name (Fix Redis).md` && renames.length === 0, JSON.stringify(c));
    const d = await TD.rename(rApp, `${R}/notes/Prompt for the failover.md`, '   ');
    const e = await TD.rename(rApp, `${R}/notes/Gone.md`, 'x');
    ok('TD-RENAME-INVALID an empty name or a missing note is refused', d.ok === false && e.ok === false && rApp._files.has(`${R}/notes/Prompt for the failover.md`));

    const mutations = [];
    win.customJS.RenderSafe = { mutate: async (o) => { mutations.push(o); try { await o.optimistic(); const value = await o.write(); return { ok: true, value }; } catch (err) { await o.revert(err); return { ok: false, error: err }; } } };
    const mk = (tag, cls) => {
      const el = { tag, className: cls || '', children: [], style: {}, _attrs: {}, _l: {}, textContent: '', _html: '', value: '', classes: new Set(String(cls || '').split(/\s+/).filter(Boolean)) };
      el.classList = { add: (x) => el.classes.add(x), remove: (x) => el.classes.delete(x), contains: (x) => el.classes.has(x) };
      Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: (v) => { el._html = v; el.children = []; } });
      el.createEl = (t, o) => { const ch = mk(t, (o && o.cls) || ''); if (o && o.text != null) ch.textContent = o.text; ch.parentNode = el; el.children.push(ch); return ch; };
      el.setAttribute = (k, v) => { el._attrs[k] = v; };
      el.addEventListener = (k, fn) => { el._l[k] = fn; };
      el.insertAdjacentHTML = (w, h) => { el._html += h; };
      el.removeChild = (ch) => { el.children.splice(el.children.indexOf(ch), 1); };
      el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
      el.focus = () => {}; el.select = () => {};
      Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
      return el;
    };
    const all = (n) => (n.children || []).flatMap((x) => [x, ...all(x)]);
    const by = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
    const key = (k) => ({ key: k, preventDefault() {} });

    const sec = TD.render(mk('div'), { app: rApp, taskPath: `${R}/Redis.md` });
    const row0 = by(sec, 'sauce-tnv-doc')[0];
    const before = by(row0, 'sauce-tnv-doc-title')[0].textContent;
    by(row0, 'sauce-tnv-doc-rename')[0]._l.click({ stopPropagation() {} });
    const rowInput = by(row0, 'sauce-tdv-rename-input')[0];
    ok('TD-RENAME-ROW each note on the task card has Rename, which turns its name into a field holding the current name',
      rowInput && rowInput.value === before && by(row0, 'sauce-tnv-doc-title')[0].style.display === 'none', before);
    rowInput.value = 'Failover prompt';
    await rowInput._l.keydown(key('Enter'));
    await new Promise((r) => setTimeout(r, 0));
    ok('TD-RENAME-ROW-SAVE Enter renames the note through RenderSafe.mutate and the list redraws with the new name',
      mutations.length === 1 && rApp._files.has(`${R}/notes/Failover prompt.md`)
      && by(sec, 'sauce-tnv-doc-title').map((n) => n.textContent).includes('Failover prompt'), JSON.stringify(by(sec, 'sauce-tnv-doc-title').map((n) => n.textContent)));
    const row1 = by(sec, 'sauce-tnv-doc')[1];
    by(row1, 'sauce-tnv-doc-rename')[0]._l.click({ stopPropagation() {} });
    const esc = by(row1, 'sauce-tdv-rename-input')[0];
    esc.value = 'Should not stick';
    await esc._l.keydown(key('Escape'));
    ok('TD-RENAME-ESCAPE Escape puts the name back and writes nothing', mutations.length === 1 && by(row1, 'sauce-tdv-rename-input').length === 0
      && by(row1, 'sauce-tnv-doc-title')[0].style.display === '');

    const P = `${R}/notes/Failover prompt.md`;
    const dv = { container: mk('div'), current: () => ({ file: { path: P } }) };
    const card = TD.renderHeader(dv, { app: rApp });
    by(card, 'sauce-tdv-rename')[0]._l.click();
    const hIn = by(card, 'sauce-tdv-rename-input')[0];
    ok('TD-RENAME-HEADER the header card has Rename next to the title', hIn && hIn.value === 'Failover prompt' && by(card, 'sauce-tdv-title-row')[0].classes.has('is-renaming'));
    hIn.value = 'Redis failover prompt';
    await hIn._l.blur();
    await new Promise((r) => setTimeout(r, 0));
    ok('TD-RENAME-HEADER-SAVE leaving the field saves: the title shows the new name and the file is renamed',
      by(card, 'sauce-tdv-title')[0].textContent === 'Redis failover prompt' && rApp._files.has(`${R}/notes/Redis failover prompt.md`) && mutations[1].failureMessage === 'Could not rename the note');
    rApp.fileManager.processFrontMatter = async () => { throw new Error('locked'); };
    by(card, 'sauce-tdv-rename')[0]._l.click();
    const hIn2 = by(card, 'sauce-tdv-rename-input')[0];
    hIn2.value = 'Never';
    await hIn2._l.keydown(key('Enter'));
    await new Promise((r) => setTimeout(r, 0));
    ok('TD-RENAME-REVERT a failed rename puts the old name back on the card', by(card, 'sauce-tdv-title')[0].textContent === 'Redis failover prompt');
  }

  {
    const st = (fm, ups, today) => TD.commsState(fm, ups || [], today || '2026-11-13');
    const unsent = st({ to: 'Jason' });
    const waiting = st({ to: 'Jason', via: 'Slack', sent_at: '2026-11-11T09:00:00-06:00', replied_at: '' });
    const replied = st({ via: 'Slack', sent_at: '2026-11-11T09:00:00-06:00', replied_at: '2026-11-12T08:00:00-06:00' });
    const byTask = st({ via: 'Email', sent_at: '2026-11-11T09:00:00-06:00' }, [{ status: 'done' }]);
    const dvDate = st({ via: 'Teams', sent_at: { toISO: () => '2026-11-13T07:00:00.000-06:00' } });
    ok('FL1-STATE a comms note is unsent until sent_at, waiting until replied_at or a done follow-up, and counts days since it was sent',
      unsent.state === 'unsent' && waiting.state === 'waiting' && waiting.days === 2 && waiting.sentLabel === 'Sent Nov 11'
      && replied.state === 'answered' && byTask.state === 'answered' && dvDate.state === 'waiting' && dvDate.days === 0
      && st({ sent_at: '2026-11-11' }, [{ status: 'open' }]).state === 'waiting', JSON.stringify([waiting, byTask]));
    ok('FL1-CHIP the sent chip reads Sent Nov 11 · Slack · waiting 2d, then replied; Notes rows say Waiting 2d',
      TD.commsChip(waiting) === 'Sent Nov 11 · Slack · waiting 2d' && TD.commsChip(replied) === 'Sent Nov 11 · Slack · replied Nov 12'
      && TD.commsChip(dvDate) === 'Sent Nov 13 · Teams · waiting' && TD.commsChip(unsent) === ''
      && TD.waitingText(2) === 'Waiting 2d' && TD.waitingText(0) === 'Waiting' && TD.waitingText(null) === 'Waiting', TD.commsChip(waiting));
    ok('FL1-FOLLOW-DATE Follow up: None, Tomorrow, In 2 work days (skipping the weekend), Next Monday, or a date',
      TD.followUpDate('none', '2026-11-13') === '' && TD.followUpDate('tomorrow', '2026-11-13') === '2026-11-14'
      && TD.followUpDate('two', '2026-11-13') === '2026-11-17' && TD.followUpDate('two', '2026-11-10') === '2026-11-12'
      && TD.followUpDate('monday', '2026-11-13') === '2026-11-16' && TD.followUpDate('monday', '2026-11-16') === '2026-11-23'
      && TD.followUpDate('2026-12-01', '2026-11-13') === '2026-12-01' && TD.followUpDate('two', '') === '');
    ok('FL1-FOLLOW-TITLE the follow-up task is Hear back from <first names>: <note title>',
      TD.followUpTitle('Jason Batai, Matt Hemingway', 'Rollout note') === 'Hear back from Jason and Matt: Rollout note'
      && TD.followUpTitle('Jason Batai', 'X') === 'Hear back from Jason: X'
      && TD.firstNames('Ann Lee; @bob & Cy Doe') === 'Ann, bob and Cy' && TD.firstNames('sam@example.com') === 'sam'
      && TD.followUpTitle('', 'Rollout note') === 'Hear back: Rollout note');
    const item = TD.commsItem({
      file: { path: 'spice/tasks/A/notes/Ping.md' }, type: 'task-doc', kind: 'comms', title: 'Ping',
      to: ['Jason Batai', 'Matt'], via: 'Slack', sent_at: { toISO: () => '2026-11-10T09:00:00.000-06:00' }, replied_at: null,
    });
    ok('FL1-ITEM a Dataview comms page reads as a plain item: dates as ISO text, a list of people joined',
      item.path === 'spice/tasks/A/notes/Ping.md' && item.title === 'Ping' && item.kind === 'comms' && item.to === 'Jason Batai, Matt'
      && item.sent_at === '2026-11-10T09:00:00.000-06:00' && item.replied_at === '', JSON.stringify(item));
    const items = [
      { path: 'spice/tasks/A/notes/Newer.md', kind: 'comms', title: 'Newer', sent_at: '2026-11-12T09:00:00-06:00', replied_at: '' },
      { path: 'spice/tasks/A/notes/Older.md', kind: 'comms', title: 'Older', to: 'Jason', via: 'Slack', sent_at: '2026-11-10T09:00:00-06:00', replied_at: '' },
      { path: 'spice/tasks/A/notes/Replied.md', kind: 'comms', title: 'Replied', sent_at: '2026-11-09', replied_at: '2026-11-10' },
      { path: 'spice/tasks/A/notes/Unsent.md', kind: 'comms', title: 'Unsent', sent_at: '', replied_at: '' },
      { path: 'spice/tasks/A/notes/Answered.md', kind: 'comms', title: 'Answered', sent_at: '2026-11-08', replied_at: '' },
      { path: 'spice/tasks/A/notes/Prompt.md', kind: 'prompt', title: 'Prompt', sent_at: '2026-11-08', replied_at: '' },
      { path: 'spice/tasks/_done/2026/11/B/notes/Closed.md', kind: 'comms', title: 'Closed', sent_at: '2026-11-01', replied_at: '' },
    ];
    const tasks = [
      { path: 'spice/tasks/A/A.md', title: 'Ship A', status: 'open' },
      { path: 'spice/tasks/A/Hear back/Hear back.md', title: 'Hear back', status: 'done', source: 'comms', source_note: 'Answered' },
      { path: 'spice/tasks/A/Other/Other.md', title: 'Other', status: 'done', source: 'meeting', source_note: 'Older' },
    ];
    const w = TD.waiting(items, tasks, '2026-11-13');
    ok('FL1-WAITING Waiting lists sent, unanswered comms notes oldest first with their task; a done follow-up answers one',
      JSON.stringify(w.map((x) => x.title)) === JSON.stringify(['Older', 'Newer'])
      && w[0].taskTitle === 'Ship A' && w[0].taskPath === 'spice/tasks/A/A.md' && w[0].days === 3 && w[1].days === 1, JSON.stringify(w));
  }

  {
    const R = 'spice/tasks/Rollout';
    const N = `${R}/notes/Rollout note.md`;
    const app = makeApp({
      [`${R}/Rollout.md`]: { fm: { type: 'task', title: 'PR rollout', status: 'open' } },
      [N]: { fm: { type: 'task-doc', kind: 'comms', title: 'Rollout note', to: 'Jason Batai, Matt Hemingway' }, body: 'Hi both', mtime: 1 },
    });
    app.vault.read = async (f) => f._body;
    app.fileManager = { processFrontMatter: async (f, fn) => { fn(f._fm); } };
    const quick = [];
    const doneCalls = [];
    let quickOk = true;
    win.customJS.TaskDialog = {
      createQuick: async (o) => {
        quick.push(o);
        if (!quickOk) return { ok: false };
        const dir = `${R}/Hear back from Jason and Matt`;
        const p = `${dir}/Hear back from Jason and Matt.md`;
        await app.vault.createFolder(dir);
        await app.vault.create(p, `---\ntype: task\nstatus: open\nsource: ${o.source}\nsource_note: ${o.source_note}\n---\n`);
        return { ok: true, path: p };
      },
      markDone: async (p) => { doneCalls.push(p); const f = app._files.get(p); if (f) f._fm.status = 'done'; return { ok: true }; },
    };
    const plain = await TD.markSent(app, N, { to: 'Jason Batai, Matt Hemingway', via: 'slack', due: '', stamp: '2026-11-13T10:00:00-06:00' });
    const fm = app._files.get(N)._fm;
    ok('FL1-MARK-SENT Mark sent writes to, via and sent_at, and a blank replied_at; with no follow-up it makes no task',
      plain.ok && plain.followUp === '' && fm.to === 'Jason Batai, Matt Hemingway' && fm.via === 'Slack'
      && fm.sent_at === '2026-11-13T10:00:00-06:00' && fm.replied_at === '' && quick.length === 0, JSON.stringify(fm));
    const withTask = await TD.markSent(app, N, { to: 'Jason Batai, Matt Hemingway', via: 'Email', due: '2026-11-17', stamp: 'S' });
    ok('FL1-MARK-SENT-FOLLOW-UP a follow-up is a subtask of the note\'s task, made through the + subtask path, due that day and linked back',
      withTask.ok && /Hear back from Jason and Matt\.md$/.test(withTask.followUp) && quick.length === 1
      && JSON.stringify(quick[0]) === JSON.stringify({ title: 'Hear back from Jason and Matt: Rollout note', today: '2026-11-17', source: 'comms', source_note: '[[Rollout note]]', parent_task: '[[Rollout]]' }),
      JSON.stringify(quick[0]));
    ok('FL1-FOLLOW-UPS the note finds its follow-up task among its task\'s subtasks',
      JSON.stringify(TD.followUps(app, N).map((t) => t.status)) === JSON.stringify(['open']));
    const reply = await TD.gotReply(app, N, '2026-11-14T09:00:00-06:00');
    ok('FL1-GOT-REPLY Got reply sets replied_at and marks the open follow-up task done',
      reply.ok && reply.closed === 1 && doneCalls.length === 1 && app._files.get(N)._fm.replied_at === '2026-11-14T09:00:00-06:00'
      && TD.followUps(app, N)[0].status === 'done');
    await TD.gotReply(app, N, 'again');
    ok('FL1-GOT-REPLY-ONCE a follow-up that is already done is not marked again', doneCalls.length === 1);
    quickOk = false;
    const failedTask = await TD.markSent(app, N, { to: 'Jason', via: 'Slack', due: '2026-11-17', stamp: 'S2' });
    ok('FL1-MARK-SENT-NO-TASK when the follow-up cannot be made the note is still marked sent and says so', failedTask.ok && failedTask.followUp === null);
    const missing = await TD.markSent(app, `${R}/notes/Gone.md`, { to: 'x' });
    ok('FL1-MARK-SENT-MISSING a missing note is refused', missing.ok === false);
  }

  {
    const mk = (tag, cls) => {
      const el = { tag, className: cls || '', children: [], style: {}, _attrs: {}, _l: {}, _text: '', _html: '', value: '', dataset: {}, parentNode: null };
      el.classList = {
        add: (c) => { if (!el.className.split(/\s+/).includes(c)) el.className = (el.className + ' ' + c).trim(); },
        remove: (c) => { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
        contains: (c) => el.className.split(/\s+/).includes(c),
      };
      Object.defineProperty(el, 'textContent', { get: () => el._text + el.children.map((c) => c.textContent).join(''), set: (v) => { el._text = String(v == null ? '' : v); el.children = []; } });
      Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: (v) => { el._html = v; el.children = []; el._text = ''; } });
      Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
      Object.defineProperty(el, 'nextSibling', { get: () => (el.parentNode ? el.parentNode.children[el.parentNode.children.indexOf(el) + 1] || null : null) });
      el.createEl = (t, o) => { const c = mk(t, (o && o.cls) || ''); if (o && o.text != null) c._text = String(o.text); if (o && o.type) c.type = o.type; c.parentNode = el; el.children.push(c); return c; };
      el.setAttribute = (k, v) => { el._attrs[k] = v; };
      el.addEventListener = (k, fn) => { el._l[k] = fn; };
      el.insertAdjacentHTML = (w, h) => { el._html += h; };
      el.removeChild = (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; };
      el.insertBefore = (c, ref) => { if (c.parentNode) c.parentNode.removeChild(c); const i = ref ? el.children.indexOf(ref) : -1; el.children.splice(i < 0 ? el.children.length : i, 0, c); c.parentNode = el; };
      el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
      el.focus = () => {}; el.select = () => {};
      el.getBoundingClientRect = () => ({ left: 100, top: 100, bottom: 130 });
      return el;
    };
    const all = (n) => (n.children || []).flatMap((x) => [x, ...all(x)]);
    const by = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
    const makeStore = (seed) => { const d = new Map(Object.entries(seed || {})); return { d, getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)) }; };
    const store = makeStore();
    win.localStorage = store;
    win.moment = () => ({ format: (f) => (f === 'YYYY-MM-DD' ? '2026-11-13' : f === 'YYYY-MM-DDTHH:mm:ssZ' ? '2026-11-13T10:00:00-06:00' : '2026/11-November') });
    const mutations = [];
    win.customJS.RenderSafe = { mutate: async (o) => { mutations.push(o); try { await o.optimistic(); const value = await o.write(); return { ok: true, value }; } catch (err) { await o.revert(err); return { ok: false, error: err }; } } };
    const copied = [];
    win.customJS.TaskTodayList = { copyText: async (t) => { copied.push(t); return true; }, fullPath: (p) => '/Vault/' + p };
    const docListeners = {};
    const fakeDoc = { body: mk('body'), addEventListener: (k, fn) => { docListeners[k] = fn; }, removeEventListener: (k) => { delete docListeners[k]; } };
    global.document = fakeDoc;

    const R = 'spice/tasks/Rollout';
    const N = `${R}/notes/Rollout note.md`;
    const now = Date.now();
    const app = makeApp({
      [`${R}/Rollout.md`]: { fm: { type: 'task', title: 'PR rollout', status: 'open' } },
      [N]: { fm: { type: 'task-doc', kind: 'comms', title: 'Rollout note', to: 'Jason Batai, Matt Hemingway' }, body: 'Hi both', mtime: now - 1000 },
      [`${R}/notes/Kickoff.md`]: { fm: { type: 'task-doc', kind: 'prompt', title: 'Kickoff' }, body: '---\ntype: task-doc\n---\n\nRead the rollout plan.', mtime: now - 2000 },
      [`${R}/notes/Handoff.md`]: { fm: { type: 'task-doc', kind: 'handoff', title: 'Handoff', session: 'abc-123' }, body: 'Continue.', mtime: now - 3000 },
      [`${R}/notes/Web handoff.md`]: { fm: { type: 'task-doc', kind: 'handoff', title: 'Web handoff', session: 'https://claude.ai/code/session_1' }, body: 'Continue.', mtime: now - 4000 },
    });
    app.vault.read = async (f) => f._body;
    app.fileManager = { processFrontMatter: async (f, fn) => { fn(f._fm); } };
    const quick = [];
    win.customJS.TaskDialog = { createQuick: async (o) => { quick.push(o); return { ok: true, path: `${R}/Hear back/Hear back.md` }; }, markDone: async () => ({ ok: true }) };
    const header = (p, a) => TD.renderHeader({ container: mk('div'), current: () => ({ file: { path: p } }) }, { app: a || app });
    const shown = (card, cls) => by(card, cls)[0] && by(card, cls)[0].style.display !== 'none';

    const card = header(N);
    ok('FL1-HEADER-UNSENT an unsent comms note has Mark sent and no sent chip or Got reply',
      shown(card, 'sauce-tdv-sent') && !shown(card, 'sauce-tdv-reply') && by(card, 'sauce-tdv-chip').filter((c) => c.classList.contains('is-sent')).length === 0
      && !shown(card, 'sauce-tdv-claude') && !shown(card, 'sauce-tdv-resume'));
    by(card, 'sauce-tdv-sent')[0]._l.click();
    const overlay = by(fakeDoc.body, 'sauce-tdv-pop-overlay')[0];
    const toInput = overlay && by(overlay, 'sauce-tdv-pop-input')[0];
    const pill = (label) => by(overlay, 'sauce-tdv-pill').find((b) => b.textContent === label);
    ok('FL1-PANEL Mark sent opens a small panel: To prefilled from to:, Via with four choices, Follow up defaulting to In 2 work days',
      overlay && !overlay.classList.contains('is-sheet') && toInput.value === 'Jason Batai, Matt Hemingway'
      && by(overlay, 'sauce-tdv-pill').map((b) => b.textContent).join(',') === 'Slack,Email,Teams,Other,None,Tomorrow,In 2 work days,Next Monday'
      && pill('In 2 work days').classList.contains('is-on') && pill('Slack').classList.contains('is-on')
      && by(overlay, 'sauce-tdv-pop-hint')[0].textContent === 'Follow-up task due Tue Nov 17' && by(overlay, 'sauce-tdv-pop-date').length === 1,
      overlay ? by(overlay, 'sauce-tdv-pop-hint').map((h) => h.textContent).join() : 'no panel');
    pill('Email')._l.click();
    const dateIn = by(overlay, 'sauce-tdv-pop-date')[0];
    dateIn.value = '2026-11-20';
    dateIn._l.change();
    ok('FL1-PANEL-DATE picking a date selects it in place of the preset choices',
      !pill('In 2 work days').classList.contains('is-on') && by(overlay, 'sauce-tdv-pop-hint')[0].textContent === 'Follow-up task due Fri Nov 20');
    await by(overlay, 'sauce-tdv-pop-save')[0]._l.click();
    const fm = app._files.get(N)._fm;
    const chip = () => by(card, 'sauce-tdv-chip').find((c) => c.classList.contains('is-sent'));
    ok('FL1-HEADER-SAVE saving writes through RenderSafe.mutate, makes the follow-up, closes the panel and shows the sent chip with Got reply',
      mutations.length === 1 && mutations[0].path === N && fm.via === 'Email' && fm.sent_at === '2026-11-13T10:00:00-06:00'
      && quick.length === 1 && quick[0].today === '2026-11-20' && fakeDoc.body.children.length === 0
      && chip() && chip().textContent === 'Sent Nov 13 · Email · waiting' && shown(card, 'sauce-tdv-reply') && !shown(card, 'sauce-tdv-sent'),
      JSON.stringify([fm, chip() && chip().textContent]));
    await by(card, 'sauce-tdv-reply')[0]._l.click();
    ok('FL1-HEADER-REPLY Got reply sets replied_at and the chip says replied',
      mutations.length === 2 && fm.replied_at === '2026-11-13T10:00:00-06:00' && chip().textContent === 'Sent Nov 13 · Email · replied Nov 13' && !shown(card, 'sauce-tdv-reply'));
    const sentCard = header(N);
    ok('FL1-HEADER-SENT a sent note drawn fresh shows its chip from frontmatter, not Mark sent',
      !shown(sentCard, 'sauce-tdv-sent') && by(sentCard, 'sauce-tdv-chip').some((c) => c.textContent === 'Sent Nov 13 · Email · replied Nov 13'));

    app.isMobile = true;
    fm.sent_at = ''; fm.replied_at = '';
    const phoneComms = header(N);
    by(phoneComms, 'sauce-tdv-sent')[0]._l.click();
    ok('FL1-PANEL-PHONE on a phone the same panel opens as a sheet', by(fakeDoc.body, 'sauce-tdv-pop-overlay')[0].classList.contains('is-sheet'));
    docListeners.keydown({ key: 'Escape', preventDefault() {} });
    ok('FL1-PANEL-ESCAPE Escape closes the panel without writing', fakeDoc.body.children.length === 0 && mutations.length === 2);
    app.isMobile = false;

    const prompt = header(`${R}/notes/Kickoff.md`);
    ok('FL2-CLAUDE-BUTTON a prompt note has Copy for Claude next to Copy prompt', shown(prompt, 'sauce-tdv-claude') && shown(prompt, 'sauce-tdv-copy')
      && by(prompt, 'sauce-tdv-actions')[0].children.indexOf(by(prompt, 'sauce-tdv-claude')[0]) === 1);
    await by(prompt, 'sauce-tdv-claude')[0]._l.click();
    const text = copied[copied.length - 1];
    const ctx = text.split('\n\n---\n')[1] || '';
    ok('FL2-CLAUDE-COPY it copies the prompt, a --- line, then a short context block: the task and its path, the notes folder, and how to write results',
      text.indexOf('Read the rollout plan.\n\n---\n') === 0
      && ctx.split('\n').length <= 5
      && /^Task: PR rollout \(\/Vault\/spice\/tasks\/Rollout\/Rollout\.md\)$/m.test(ctx)
      && /^Notes folder: \/Vault\/spice\/tasks\/Rollout\/notes\/$/m.test(ctx)
      && /type: task-doc, kind: findings, comms or handoff, title:, task: "\[\[Rollout\]\]" and created_at:/.test(ctx)
      && /header blocks/.test(ctx) && /set session:/.test(ctx), JSON.stringify(text));
    ok('FL2-CLAUDE-PURE claudeContext and forClaude are plain text from their inputs',
      TD.forClaude('P  \n', { taskTitle: 'T', taskName: 'T', taskPath: 'a/T/T.md', notesPath: 'a/T/notes' }).split('\n')[0] === 'P'
      && TD.claudeContext({ taskTitle: 'T', taskName: 'T', taskPath: 'x', notesPath: 'a/T/notes/' }).split('\n')[2] === 'Notes folder: a/T/notes/');
    const commsCard = header(N);
    ok('FL2-CLAUDE-KIND only prompt notes have it', !shown(commsCard, 'sauce-tdv-claude'));

    ok('FL2-RESUME-PURE session: a link opens, an id becomes claude --resume <id>, blank is nothing',
      JSON.stringify(TD.resumeAction('https://claude.ai/code/session_1')) === JSON.stringify({ kind: 'url', url: 'https://claude.ai/code/session_1' })
      && TD.resumeAction(' abc-123 ').command === 'claude --resume abc-123' && TD.resumeAction('') === null && TD.resumeAction(null) === null);
    const ho = header(`${R}/notes/Handoff.md`);
    await by(ho, 'sauce-tdv-resume')[0]._l.click();
    ok('FL2-RESUME-ID a handoff with a session id has Resume, which copies claude --resume <id>',
      shown(ho, 'sauce-tdv-resume') && copied[copied.length - 1] === 'claude --resume abc-123');
    const openedUrls = [];
    win.open = (u) => openedUrls.push(u);
    const web = header(`${R}/notes/Web handoff.md`);
    await by(web, 'sauce-tdv-resume')[0]._l.click();
    ok('FL2-RESUME-URL a session link opens with window.open', openedUrls[0] === 'https://claude.ai/code/session_1');
    ok('FL2-RESUME-NONE no Resume without a session or on other kinds', !shown(prompt, 'sauce-tdv-resume') && !shown(commsCard, 'sauce-tdv-resume'));

    const day = 86400000;
    ok('FL2-NEW-RULE a note is new when changed after this device last viewed it, and never when changed over 14 days ago',
      TD.isNew(now - 1000, now - 5000, now) && !TD.isNew(now - 5000, now - 1000, now) && TD.isNew(now - 1000, undefined, now)
      && !TD.isNew(now - 15 * day, undefined, now) && TD.isNew(now - 13 * day, undefined, now) && !TD.isNew(0, undefined, now));
    const seen = JSON.parse(store.getItem('sauce-taskdoc-seen'));
    ok('FL2-SEEN-RECORD drawing a note\'s header card records it as seen in sauce-taskdoc-seen', seen[N] >= now && seen[`${R}/notes/Kickoff.md`] >= now);
    const s2 = makeStore({ 'sauce-taskdoc-seen': JSON.stringify({ old: now - 20 * day, keep: now - day, bad: 'x' }) });
    TD.markSeen('fresh', now, s2);
    const m2 = JSON.parse(s2.getItem('sauce-taskdoc-seen'));
    ok('FL2-SEEN-PRUNE recording drops entries older than 14 days and junk', !('old' in m2) && m2.keep === now - day && m2.fresh === now && !('bad' in m2));
    const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    ok('FL2-SEEN-SAFE unreadable storage reads as nothing seen and never throws',
      JSON.stringify(TD.readSeen(broken)) === '{}' && (TD.markSeen('x', now, broken), true) && JSON.stringify(TD.readSeen(makeStore({ 'sauce-taskdoc-seen': '{bad' }))) === '{}');

    const T2 = 'spice/tasks/Fresh';
    const fresh = makeApp({
      [`${T2}/Fresh.md`]: { fm: { type: 'task', title: 'Fresh' } },
      [`${T2}/notes/Findings.md`]: { fm: { type: 'task-doc', kind: 'findings', title: 'Findings' }, mtime: now - 60000 },
      [`${T2}/notes/Handoff.md`]: { fm: { type: 'task-doc', kind: 'handoff', title: 'Handoff' }, mtime: now - 30000 },
      [`${T2}/notes/Seen.md`]: { fm: { type: 'task-doc', kind: 'plan', title: 'Seen' }, mtime: now - 90000 },
      [`${T2}/notes/Ancient.md`]: { fm: { type: 'task-doc', kind: 'context', title: 'Ancient' }, mtime: now - 30 * day },
    });
    TD.markSeen(`${T2}/notes/Seen.md`, now - 1000);
    const nn = TD.newNotes(fresh, `${T2}/Fresh.md`, now);
    ok('FL2-NEW-NOTES the task\'s new notes, newest first: not the seen one, not the old one',
      JSON.stringify(nn.map((x) => x.title)) === JSON.stringify(['Handoff', 'Findings']), JSON.stringify(nn));
    const sec = TD.render(mk('div'), { app: fresh, taskPath: `${T2}/Fresh.md` });
    const pills = by(sec, 'sauce-tnv-doc').filter((r) => by(r, 'sauce-tnv-doc-new').length).map((r) => by(r, 'sauce-tnv-doc-title')[0].textContent);
    ok('FL2-NEW-PILL the task card\'s Notes rows show New on notes changed since they were last opened here',
      JSON.stringify(pills.sort()) === JSON.stringify(['Findings', 'Handoff']) && by(sec, 'sauce-tnv-doc-new')[0].textContent === 'New', JSON.stringify(pills));
    header(`${T2}/notes/Handoff.md`, fresh);
    ok('FL2-NEW-CLEARS opening a note (its header card renders) clears its New', TD.newNotes(fresh, `${T2}/Fresh.md`, Date.now()).map((x) => x.title).join() === 'Findings');
    const menus = [];
    win.customJS.MenuPopover = { open: (entries) => menus.push(entries) };
    by(sec, 'sauce-tnv-doc-add')[0]._l.click();
    await menus[0].find((e) => e.label === 'Plan').onSelect();
    await new Promise((r) => setTimeout(r, 0));
    const made = Array.from(fresh._files.keys()).find((p) => /notes\/Plan/.test(p));
    ok('FL2-NEW-OWN a note made here through + Note is recorded as seen', made && !TD.newNotes(fresh, `${T2}/Fresh.md`, Date.now() + 1).some((x) => x.path === made), made);

    const TTLClass = new Function('window', `${read('mechanisms/task-entity/task-today-list.js')}\nreturn TaskTodayList;`)(win);
    const opened = [];
    const rowApp = Object.assign(fresh, { workspace: { openLinkText: (p, src) => opened.push([p, src]) } });
    store.setItem('sauce-taskdoc-seen', JSON.stringify({ [`${T2}/notes/Seen.md`]: now - 1000, [made]: now + 60000 }));
    win.customJS.TaskDocs = new (TaskDocs(win, function () {}))();
    const slot = mk('span');
    const chip2 = TTLClass.renderNewNotesChip(slot, `${T2}/Fresh.md`, rowApp, now);
    ok('FL2-ROW-CHIP a To-Do row of a task with new notes shows 2 new notes', chip2 && chip2.textContent === '2 new notes');
    chip2._l.click({ preventDefault() {}, stopPropagation() {} });
    ok('FL2-ROW-CHIP-OPEN the chip opens the newest note', opened[0] && opened[0][0] === `${T2}/notes/Handoff.md`);
    store.setItem('sauce-taskdoc-seen', JSON.stringify({ [`${T2}/notes/Seen.md`]: now - 1000, [made]: now + 60000, [`${T2}/notes/Handoff.md`]: now }));
    const one = TTLClass.renderNewNotesChip(mk('span'), `${T2}/Fresh.md`, rowApp, now);
    const none = TTLClass.renderNewNotesChip(mk('span'), 'spice/tasks/Flat.md', rowApp, now);
    ok('FL2-ROW-CHIP-ONE one new note reads New note; a task with none draws nothing', one && one.textContent === 'New note' && none === null);
    const rowSrc = read('mechanisms/task-entity/task-today-list.js');
    ok('FL2-ROW-CHIP-WIRED every task row asks for the chip', /if \(path && opts\.showNewNotes !== false\) TaskTodayList\.renderNewNotesChip\(extras, path\);/.test(rowSrc));
    delete win.customJS.TaskDocs;

    const C = 'spice/tasks/Comms task';
    const cApp = makeApp({
      [`${C}/Comms task.md`]: { fm: { type: 'task', title: 'Comms task' } },
      [`${C}/notes/Waiting one.md`]: { fm: { type: 'task-doc', kind: 'comms', title: 'Waiting one', via: 'Slack', sent_at: '2026-11-11T09:00:00-06:00', replied_at: '' }, mtime: 5 },
      [`${C}/notes/Answered one.md`]: { fm: { type: 'task-doc', kind: 'comms', title: 'Answered one', via: 'Slack', sent_at: '2026-11-10T09:00:00-06:00', replied_at: '' }, mtime: 4 },
      [`${C}/Hear back/Hear back.md`]: { fm: { type: 'task', status: 'done', source: 'comms', source_note: '[[Answered one]]' } },
      [`${C}/notes/Draft.md`]: { fm: { type: 'task-doc', kind: 'comms', title: 'Draft' }, mtime: 3 },
    });
    const cSec = TD.render(mk('div'), { app: cApp, taskPath: `${C}/Comms task.md` });
    const meta = (t) => { const r = by(cSec, 'sauce-tnv-doc').find((x) => by(x, 'sauce-tnv-doc-title')[0].textContent === t); return by(r, 'sauce-tnv-doc-meta')[0].textContent; };
    ok('FL1-NOTES-ROW comms rows on the task card show Waiting 2d or Sent Nov 10; an unsent one shows its age',
      meta('Waiting one') === 'Comms · Waiting 2d' && meta('Answered one') === 'Comms · Sent Nov 10' && /^Comms · /.test(meta('Draft')) && !/Sent|Waiting/.test(meta('Draft')),
      JSON.stringify([meta('Waiting one'), meta('Answered one'), meta('Draft')]));

    const list = mk('div');
    const replied = [];
    const W = { path: `${C}/notes/Waiting one.md`, title: 'Waiting one', to: 'Jason', via: 'Slack', days: 2, taskPath: `${C}/Comms task.md`, taskTitle: 'Comms task' };
    cApp.fileManager = { processFrontMatter: async (f, fn) => { fn(f._fm); } };
    const row = TD.renderWaitingRow(list, W, { app: cApp, onReplied: (it, stamp) => replied.push([it.path, stamp]) });
    ok('FL1-WAIT-ROW a Waiting row shows the comms icon and title, to whom and via what, how long ago, the task, and Got reply',
      /M7\.9 20A9/.test(by(row, 'sauce-tdv-wait-icon')[0].innerHTML) && by(row, 'sauce-tdv-wait-title')[0].textContent === 'Waiting one'
      && by(row, 'sauce-tdv-wait-meta')[0].children[0].textContent === 'To Jason · Slack · Sent 2d ago'
      && by(row, 'sauce-tdv-wait-task')[0].textContent === '↳ Comms task' && by(row, 'sauce-tdv-wait-reply')[0].textContent === 'Got reply');
    const before = mutations.length;
    await by(row, 'sauce-tdv-wait-reply')[0]._l.click({ stopPropagation() {} });
    ok('FL1-WAIT-ROW-REPLY Got reply writes replied_at through RenderSafe.mutate and takes the row out',
      mutations.length === before + 1 && list.children.length === 0 && cApp._files.get(W.path)._fm.replied_at === '2026-11-13T10:00:00-06:00'
      && replied.length === 1 && replied[0][0] === W.path);
    const list2 = mk('div');
    const row2 = TD.renderWaitingRow(list2, Object.assign({}, W, { path: `${C}/notes/Missing.md` }), { app: cApp });
    await by(row2, 'sauce-tdv-wait-reply')[0]._l.click({ stopPropagation() {} });
    ok('FL1-WAIT-ROW-REVERT a failed reply puts the row back', list2.children.length === 1 && list2.children[0] === row2);

    delete global.document;
    delete win.localStorage;
    win.moment = null;
  }

  {
    const manifest = JSON.parse(read('mechanisms/task-entity/manifest.json'));
    const row = (manifest.claude_surface || []).map((s) => s.row).find((r) => r && r.path === 'spice/tasks/<Task>/notes/');
    ok('FL2-AGENTS the vault CLAUDE.md notes row tells sessions to write results into the task\'s notes/ folder and set session: on handoffs',
      row && /session:/.test(row.purpose) && /handoff/.test(row.purpose) && /notes\/ folder/.test(row.purpose) && /not as subtasks/.test(row.purpose), row && row.purpose);
    const dialog = read('mechanisms/task-entity/task-dialog.js');
    ok('FL1-QUICK-SOURCE-NOTE the + subtask path carries source_note, so a follow-up links back to its note',
      /source_note: \(opts && opts\.source_note\) \|\| ''/.test(dialog));
  }

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
