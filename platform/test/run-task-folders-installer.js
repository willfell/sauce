#!/usr/bin/env node
/**
 * run-task-folders-installer.js — the installer's side of the task-folder
 * layout. install.js cannot load the customJS TaskEntity class, so it carries
 * its own copy of the naming rule (_taskFolderName); TF-INST-PARITY holds the
 * two equal over a shared case table. The rest drive the real heals against a
 * temp vault: the task-note heal reaches nested folder notes, and the capture
 * and migration writers create spice/tasks/<Name>/<Name>.md.
 * Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const install = require('../install.js');
const TE = new Function(fs.readFileSync(path.resolve(__dirname, '../mechanisms/task-entity/task-entity.js'), 'utf8') + '\nreturn TaskEntity;')();

const results = [];
const ok = (n, c, detail) => {
  results.push([n, !!c]);
  console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${!c && detail ? ' — ' + detail : ''}`);
};

function makeFsAdapter(root) {
  const abs = (rel) => path.join(root, rel);
  return {
    async exists(rel) { return fs.existsSync(abs(rel)); },
    async list(rel) {
      const dir = abs(rel);
      if (!fs.existsSync(dir)) return { files: [], folders: [] };
      const files = [], folders = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const child = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) folders.push(child);
        else files.push(child);
      }
      return { files, folders };
    },
    async read(rel) { return fs.readFileSync(abs(rel), 'utf8'); },
    async write(rel, content) {
      const f = abs(rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    },
    async mkdir(rel) { fs.mkdirSync(abs(rel), { recursive: true }); },
    async remove(rel) { try { fs.unlinkSync(abs(rel)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
  };
}

function withVault(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-inst-'));
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  const adapter = makeFsAdapter(root);
  const tp = { app: { vault: { adapter } } };
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const has = (rel) => fs.existsSync(path.join(root, rel));
  const mdBelow = (rel) => {
    const out = [];
    const walk = (d) => {
      const a = path.join(root, d);
      if (!fs.existsSync(a)) return;
      for (const e of fs.readdirSync(a, { withFileTypes: true })) {
        const r = d + '/' + e.name;
        if (e.isDirectory()) walk(r);
        else if (e.name.endsWith('.md')) out.push(r);
      }
    };
    walk(rel);
    return out.sort();
  };
  return Promise.resolve(fn({ root, adapter, tp, read, has, mdBelow }))
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

const isTaken = (...names) => (n) => names.includes(n);
const T80 = 'T'.repeat(80);
const P80 = 'P'.repeat(80);

const CASES = [
  ['plain', 'Pay Bills', {}, () => false],
  ['subtask-clash', 'Review PR', { parentTitle: 'Help Henry' }, isTaken('review pr')],
  ['date-clash', 'Pay Bills', { createdAt: '2026-11-10T14:06:43-07:00' }, isTaken('pay bills')],
  ['number', 'Pay Bills', { createdAt: '2026-11-10T14:06:43-07:00' }, isTaken('pay bills', 'pay bills (nov 10)')],
  ['number-3', 'Pay Bills', { createdAt: '2026-11-10' }, isTaken('pay bills', 'pay bills (nov 10)', 'pay bills (nov 10) 2')],
  ['case', 'PAY BILLS', {}, isTaken('pay bills')],
  ['same-as-parent', 'Review', { parentTitle: 'Review' }, isTaken('review')],
  ['sanitized', 'Fix: a/b', {}, isTaken('fix ab')],
  ['length-cap', T80, { parentTitle: P80 }, isTaken(T80.toLowerCase())],
  ['length-cap-number', T80, { parentTitle: P80 }, (n) => !/ 2$/.test(n)],
  ['length-cap-date', T80, { createdAt: '2026-11-10' }, isTaken(T80.toLowerCase())],
  ['blank-title-no-date', '  ', { createdAt: 'not a date' }, isTaken('task')],
];

const CAPTURE_DAILY = [
  '---',
  'type: todo-daily',
  '---',
  '',
  '- [ ] Pay Bills [due:: 2026-11-20]',
  '- [ ] Call Shirley',
  '- [x] Feed the dogs',
  '',
].join('\n');

(async () => {
  {
    ok('TF-INST-PARITY the installer exports _taskFolderName', typeof install._taskFolderName === 'function');
    ok('TF-INST-PARITY the case table has 12 cases', CASES.length === 12);
    const mismatches = [];
    for (const [label, title, ctx, taken] of CASES) {
      const want = TE.taskName(title, Object.assign({}, ctx, { taken }));
      let got;
      try { got = install._taskFolderName(title, Object.assign({}, ctx, { taken })); }
      catch (e) { got = 'THREW ' + e.message; }
      if (got !== want) mismatches.push(`${label}: TaskEntity=${JSON.stringify(want)} installer=${JSON.stringify(got)}`);
    }
    ok('TF-INST-PARITY every case names the task the same in TaskEntity and the installer',
      mismatches.length === 0, mismatches.join('; '));
  }

  await withVault({
    'spice/tasks/A/A.md': '---\ntype: task\ntitle: A\nstatus: open\n---\n' + install._taskNoteChromeBody(),
    'spice/tasks/A/B/B.md': '---\ntype: task\ntitle: B\nstatus: open\n---\nmy notes about B\n',
    'spice/tasks/A/B/C/C.md': '---\ntype: task\ntitle: C\nstatus: open\n---\n',
    'spice/tasks/_done/2026/11/D/D.md': '---\ntype: task\ntitle: D\nstatus: done\n---\n',
    'spice/tasks/_trash/E/E.md': '---\ntype: task\ntitle: E\nstatus: deleted\n---\n',
    'spice/tasks/task-20260101-120000-abcd.md': '---\ntype: task\ntitle: Flat One\nstatus: open\n---\n',
    'spice/tasks/F/task-20260101-120000-beef.md': '---\ntype: task\ntitle: Not a folder note\nstatus: open\n---\n',
  }, async ({ tp, read, has }) => {
    const history = [];
    await install.applyTaskNoteHeal(tp, history, {});
    const b = read('spice/tasks/A/B/B.md');
    ok('TF-INST-RECURSE a nested folder note missing its chrome gets the chrome',
      b.includes('<!-- TASK_NOTES -->') && /class: "TaskNoteView"/.test(b), b);
    ok('TF-INST-RECURSE the user text in that note survives below the marker',
      b.indexOf('my notes about B') > b.indexOf('<!-- TASK_NOTES -->'));
    ok('TF-INST-RECURSE a three-deep folder note is reached too',
      read('spice/tasks/A/B/C/C.md').includes('<!-- TASK_NOTES -->'));
    ok('TF-INST-RECURSE a folder note already carrying the chrome is left alone',
      (read('spice/tasks/A/A.md').match(/<!-- TASK_NOTES -->/g) || []).length === 1);
    ok('TF-INST-RECURSE _done and _trash are still skipped',
      !read('spice/tasks/_done/2026/11/D/D.md').includes('<!-- TASK_NOTES -->') &&
      !read('spice/tasks/_trash/E/E.md').includes('<!-- TASK_NOTES -->'));
    ok('TF-INST-RECURSE the old-name rename still applies to a flat note',
      !has('spice/tasks/task-20260101-120000-abcd.md') && has('spice/tasks/Flat One.md'));
    ok('TF-INST-RECURSE a nested file that is not a folder note is not treated as a task note',
      has('spice/tasks/F/task-20260101-120000-beef.md') &&
      !read('spice/tasks/F/task-20260101-120000-beef.md').includes('<!-- TASK_NOTES -->'));
    const history2 = [];
    await install.applyTaskNoteHeal(tp, history2, {});
    const summary = history2.find((h) => h.summary);
    ok('TF-INST-RECURSE a second run changes nothing',
      summary && summary.summary.renamed === 0 && summary.summary.chromed === 0, JSON.stringify(summary));
  });

  await withVault({
    'spice/tasks/A/A.md': '---\ntype: task\ntitle: A\nstatus: open\nproject: "[[spice/projects/connectors/Connectors.md|Connectors]]"\nproject_slug: spice-projects-connectors-connectors-md-connectors\n---\n',
  }, async ({ tp, read }) => {
    await install.applyTaskNoteProjectSlugHeal(tp, [], {});
    ok('TF-INST-RECURSE the project-slug heal reaches a folder note',
      /^project: "\[\[Connectors\]\]"$/m.test(read('spice/tasks/A/A.md')));
  });

  await withVault({
    'spice/to-do/2026/11-November/ToDo-2026-11-10.md': CAPTURE_DAILY,
    'spice/wiki/Call Shirley.md': '# a wiki page that owns the name\n',
  }, async ({ tp, read, has, mdBelow }) => {
    await install.applyDailyTasksToEntityMigration(tp, [], {});
    const notes = mdBelow('spice/tasks');
    ok('TF-INST-CAPTURE-FOLDER a daily capture migration writes spice/tasks/<Name>/<Name>.md',
      has('spice/tasks/Pay Bills/Pay Bills.md') &&
      /^title: Pay Bills$/m.test(read('spice/tasks/Pay Bills/Pay Bills.md')), notes.join(', '));
    const shirley = notes.filter((n) => /Call Shirley/.test(n));
    ok('TF-INST-CAPTURE-FOLDER a name taken elsewhere in the vault gets the date qualifier',
      shirley.length === 1 && /^spice\/tasks\/Call Shirley - \d{2}-\d{2}-\d{2}\/Call Shirley - \d{2}-\d{2}-\d{2}\.md$/.test(shirley[0]),
      shirley.join(', '));
    ok('TF-INST-CAPTURE-FOLDER no flat task note is written',
      notes.every((n) => n.split('/').length >= 4), notes.join(', '));
    ok('TF-INST-CAPTURE-FOLDER the done line is not converted', !notes.some((n) => /Feed the dogs/.test(n)));
  });

  await withVault({
    'spice/to-do/2026/11-November/ToDo-2026-11-10.md': CAPTURE_DAILY,
    'spice/tasks/Pay Bills.md': '---\ntype: task\ntitle: Pay Bills\nstatus: open\ndue: 2026-11-20\nsource: daily\n---\n',
    'spice/tasks/Call Shirley/Call Shirley.md': '---\ntype: task\ntitle: Call Shirley\nstatus: open\ndue:\nsource: daily\n---\n',
  }, async ({ tp, mdBelow }) => {
    await install.applyDailyTasksToEntityMigration(tp, [], {});
    const notes = mdBelow('spice/tasks');
    ok('TF-INST-CAPTURE-FOLDER a task already present flat or as a folder note is not re-created',
      notes.length === 2, notes.join(', '));
  });

  await withVault({
    'spice/meetings/notes/Retro.md': '---\ntype: meeting\n---\n<!-- ACTION_ITEMS_MARKER -->\n- [ ] Send notes\n',
    'spice/projects/sauce/Sauce To-Do.md': '---\ntype: project-todo\nproject: "[[Sauce]]"\nproject_slug: sauce\n---\n<!-- OWNED_TASKS_MARKER -->\n- [ ] Ship it\n',
  }, async ({ tp, read, has, mdBelow }) => {
    await install.applyMeetingTasksToEntityMigration(tp, [], {});
    await install.applyProjectTasksToEntityMigration(tp, [], {});
    ok('TF-INST-CAPTURE-FOLDER the meeting migration writes a folder note',
      has('spice/tasks/Send notes/Send notes.md') && /^source: meeting$/m.test(read('spice/tasks/Send notes/Send notes.md')),
      mdBelow('spice/tasks').join(', '));
    ok('TF-INST-CAPTURE-FOLDER the project migration writes a folder note',
      has('spice/tasks/Ship it/Ship it.md') && /^source: project$/m.test(read('spice/tasks/Ship it/Ship it.md')),
      mdBelow('spice/tasks').join(', '));
  });

  const REGISTRY = '## Recurring Tasks\n\n- [ ] Water the plants [recurrence:: every day]\n- [ ] Take out trash [recurrence:: every Monday]\n';
  await withVault({
    'spice/to-do/Recurring Tasks.md': REGISTRY,
    'spice/wiki/Take out trash.md': '# owns the name\n',
  }, async ({ tp, mdBelow }) => {
    const manifest = { name: 'to-do' };
    await install.applyRecurringTasksMigrationHeal(tp, manifest, {}, [], {});
    const first = mdBelow('spice/tasks');
    ok('TF-INST-CAPTURE-FOLDER the recurring-tasks heal writes a folder note',
      first.includes('spice/tasks/Water the plants/Water the plants.md'), first.join(', '));
    await install.applyRecurringTasksMigrationHeal(tp, manifest, {}, [], {});
    const second = mdBelow('spice/tasks');
    ok('TF-INST-CAPTURE-FOLDER a second recurring run re-creates nothing, even a task whose name took a qualifier',
      first.length === 2 && JSON.stringify(first) === JSON.stringify(second), second.join(', '));
  });

  await withVault({
    'spice/to-do/Recurring Tasks.md': REGISTRY,
    'spice/tasks/Water the plants.md': '---\ntype: task\ntitle: Water the plants\nstatus: open\n---\n',
    'spice/tasks/Take out trash/Take out trash.md': '---\ntype: task\ntitle: Take out trash\nstatus: open\n---\n',
  }, async ({ tp, mdBelow }) => {
    await install.applyRecurringTasksMigrationHeal(tp, { name: 'to-do' }, {}, [], {});
    const notes = mdBelow('spice/tasks');
    ok('TF-INST-CAPTURE-FOLDER the recurring heal sees tasks in both layouts', notes.length === 2, notes.join(', '));
  });

  const CHROME = '\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n```\n\n<!-- TASK_NOTES -->\n';
  await withVault({
    'spice/tasks/Std Naming/Std Naming.md': '---\ntype: task\ntitle: Std Naming\nstatus: open\n---\n' + CHROME + 'real notes\n',
    'spice/tasks/Std Naming.md': CHROME + 'notes a session wrote to the old flat path\n',
    'spice/tasks/Fix Redis/Fix Redis.md': '---\ntype: task\ntitle: Fix Redis\nstatus: open\n---\n',
    'spice/tasks/Fix Redis/Stage Env (Fix Redis)/Stage Env (Fix Redis).md': '---\ntype: task\ntitle: Stage Env\nstatus: open\nparent_task: "[[Fix Redis]]"\n---\n',
    'spice/tasks/Stage Env.md': CHROME + 'old copy\n',
    'spice/tasks/Mint Token.md': CHROME + '# Mint Token\nsteps\n',
    'spice/tasks/PR Review.md': '---\ntype: doc-note\ntitle: PR Review\nproject_slug: hemi\n---\nreview\n',
    'spice/tasks/Orphan Doc.md': '---\ntype: doc-note\ntitle: Orphan Doc\nproject_slug: gone\n---\nx\n',
    'spice/tasks/Scratch.md': 'just some text\n',
    'spice/tasks/Real Flat.md': '---\ntype: task\ntitle: Real Flat\nstatus: open\n---\n',
    'spice/projects/hemi/Hemi.md': '---\ntype: project\n---\n',
  }, async ({ tp, read, has, mdBelow }) => {
    const history = [];
    await install.applyTaskStraysHeal(tp, history, {});
    const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    ok('TF-STRAY-PARK a frontmatter-less copy of a task with a folder moves into that folder, not listed twice',
      !has('spice/tasks/Std Naming.md') && /old flat path/.test(read(`spice/tasks/Std Naming/Recovered - Std Naming - ${today}.md`))
      && /real notes/.test(read('spice/tasks/Std Naming/Std Naming.md')));
    ok('TF-STRAY-PARK-QUALIFIED a twin named with a clash qualifier counts too',
      !has('spice/tasks/Stage Env.md') && has(`spice/tasks/Fix Redis/Stage Env (Fix Redis)/Recovered - Stage Env - ${today}.md`));
    const mint = read('spice/tasks/Mint Token.md');
    ok('TF-STRAY-MAKE-TASK task chrome with no frontmatter and no twin becomes an open task in place, body kept',
      /^---\ntype: task\ntitle: "Mint Token"\nstatus: open\n/.test(mint) && /# Mint Token\nsteps/.test(mint) && /created_at: \d{4}-/.test(mint));
    ok('TF-STRAY-TO-DOCS a doc-note for a known project moves to its docs folder; an unknown project stays',
      !has('spice/tasks/PR Review.md') && /review/.test(read('spice/projects/hemi/docs/PR Review.md')) && has('spice/tasks/Orphan Doc.md'));
    ok('TF-STRAY-LEAVE plain text and real tasks are left alone',
      has('spice/tasks/Scratch.md') && read('spice/tasks/Real Flat.md') === '---\ntype: task\ntitle: Real Flat\nstatus: open\n---\n');
    const report = read(`ranch/reports/task-strays-${today}.md`);
    ok('TF-STRAY-REPORT the report lists each action and the reason',
      /Moved into its task's folder \(2\)/.test(report) && /Made a task \(1\)/.test(report) && /Moved to project docs \(1\)/.test(report)
      && /Left in place \(2\)/.test(report) && history.some((h) => h.step === 'task_strays_heal' && h.action === 'report_written'));
    const odd = install.planTaskStrays([{ path: 'spice/tasks/a|b\\c.md', body: 'x' }], [], [], today);
    ok('TF-STRAY-REPORT-ESCAPE pipes and backslashes in a name cannot break the table',
      /\| `spice\/tasks\/a\\\|b\\\\c\.md` \|/.test(install.renderTaskStraysReport(odd, today)));
    const before = mdBelow('ranch/reports');
    const h2 = [];
    await install.applyTaskStraysHeal(tp, h2, {});
    ok('TF-STRAY-IDEMPOTENT a second run with only left-in-place notes changes nothing and writes no report',
      JSON.stringify(mdBelow('ranch/reports')) === JSON.stringify(before) && read(`ranch/reports/task-strays-${today}.md`) === report
      && h2.some((h) => h.action === 'nothing_applied'));
  });

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\nrun-task-folders-installer: ${results.length - failed} pass · ${failed} fail`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
