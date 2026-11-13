#!/usr/bin/env node
/**
 * run-task-docs.js — task notes: prompts, handoffs, plans, context, findings
 * and questions that belong to a task without being steps of it. TaskDocs
 * keeps them at spice/tasks/<Task>/notes/ as `type: task-doc`, lists them on
 * the task card's Notes section in kind order, copies a note's prompt, and
 * creates new ones from per-kind templates with vault-unique names. The
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

ok('TD-KINDS the kinds are prompt, handoff, plan, context, findings, questions, note; anything else reads as note',
  JSON.stringify(TD.KINDS.map((k) => k.key)) === JSON.stringify(['prompt', 'handoff', 'plan', 'context', 'findings', 'questions', 'note'])
  && TD.kindOf('Handoff') === 'handoff' && TD.kindOf('runbook') === 'note' && TD.kindOf(null) === 'note');
ok('TD-FOLDER a folder task keeps its notes in <Task>/notes; a flat task has none',
  TD.notesFolder('spice/tasks/Backup Script/Backup Script.md') === 'spice/tasks/Backup Script/notes'
  && TD.notesFolder('spice/tasks/A/B/B.md') === 'spice/tasks/A/B/notes'
  && TD.notesFolder('spice/tasks/Flat.md') === '' && TD.notesFolder('spice/tasks/A/notes/Prompt.md') === '');

{
  const text = TD.compose('handoff', 'Handoff', 'Finish AccurAPI Plugin', '2026-11-12T10:00:00-07:00');
  ok('TD-COMPOSE a new note is type task-doc with its kind, title and task link, a header back to the task, and its template',
    /^---\ntype: task-doc\nkind: handoff\ntitle: "Handoff"\ntask: "\[\[Finish AccurAPI Plugin\]\]"\ncreated_at: 2026-11-12T10:00:00-07:00\n---\n/.test(text)
    && /> \[!info\] Handoff for \[\[Finish AccurAPI Plugin\]\]/.test(text) && /## Prompt to paste/.test(text) && /claude --resume/.test(text));
  ok('TD-COMPOSE-TEMPLATES each known kind has its own starting text; note starts blank',
    /## Steps/.test(TD.template('plan')) && /\[!abstract\] Goal/.test(TD.template('context')) && /\[!abstract\] Summary/.test(TD.template('findings'))
    && /## Open questions/.test(TD.template('questions')) && TD.template('note') === '' && TD.template('prompt').length > 0);
  ok('TD-PROMPT-HANDOFF-TEMPLATE a fresh handoff copies just its prompt block', /^You are continuing work on <what>/.test(TD.extractPrompt(text))
    && !/claude --resume/.test(TD.extractPrompt(text)));
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
  ok('TD-PROMPT-NEW-PROMPT a new prompt note copies its own body, not its header line',
    TD.extractPrompt(TD.compose('prompt', 'Prompt', 'Backup Script', 'x')) === TD.template('prompt').trim());
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
  ok('TD-RENDER-ADD + Note offers every kind', menus[0] && menus[0].entries.map((e) => e.label).join(',') === 'Prompt,Handoff,Plan,Context,Findings,Questions,Note');
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
    ok('TD-CONVERT-BODY the task chrome is replaced by the note header and the text is kept',
      !/TaskNoteView|TaskChromeBar|TASK_NOTES/.test(prompt._body) && /> \[!info\] Prompt for \[\[Hemi Config\]\]/.test(prompt._body)
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

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
