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
    for (const f of files.values()) { const d = folders.get(dirOf(f.path)); if (d) d.children.push(f); }
  };
  const put = (p, fm, body, mtime) => {
    files.set(p, { path: p, basename: p.split('/').pop().replace(/\.md$/, ''), _fm: fm || null, _body: body || '', stat: { mtime: mtime || 0 } });
    addFolder(dirOf(p));
    link();
  };
  for (const [p, v] of Object.entries(seed || {})) put(p, v.fm, v.body, v.mtime);
  const opened = [];
  return {
    _files: files, _opened: opened,
    vault: {
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
    const el = { tag, className: cls || '', children: [], _attrs: {}, _l: {}, textContent: '', innerHTML: '', classList: { add() {}, remove() {} } };
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

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
