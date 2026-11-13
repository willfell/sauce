#!/usr/bin/env node
/**
 * run-task-folders-plan.js — the task folder migration's planner and dry-run
 * report (install.js planTaskFolders / renderTaskFoldersReport /
 * applyTaskFoldersHeal). The fixture vault is built here in a temp dir rather
 * than in platform/test/seed-vault/: the seed is installed end to end by
 * run-seed-migrations.js, where these ~25 extra task notes would ripple through
 * every other task heal's assertions. run-seed-migrations.js carries the
 * install-sequence check (HC-TASKFOLDERS-SEED) on the seed's own flat tasks.
 * Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const install = require('../install.js');

const results = [];
const ok = (n, c, detail) => {
  results.push([n, !!c]);
  console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${!c && detail ? ' — ' + detail : ''}`);
};

const T = 'spice/tasks';

function task(fields) {
  const lines = ['---', 'type: task'];
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}: ${v}`);
  lines.push('---', '', '<!-- TASK_NOTES -->', '');
  return lines.join('\n');
}

const FIXTURE = {
  'spice/wiki/ems/other-stuff/Yup.md': '---\ntype: wiki\n---\n# Yup\n',
  'spice/wiki/ems/other-stuff/Notes.md': '---\ntype: wiki\n---\nSee [[Yup]].\n',

  [`${T}/_done/Pay Bills.md`]: task({ title: 'Pay Bills', status: 'done', created_at: '2026-01-05T09:00:00-07:00', completed_at: '2026-01-31' }),
  [`${T}/Pay Bills.md`]: task({ title: 'Pay Bills', status: 'open', created_at: '2026-11-03T09:00:00-07:00' }),
  [`${T}/_done/yup.md`]: task({ title: 'yup', status: 'done', created_at: '2026-03-04T09:00:00-07:00', completed_at: '2026-03-10' }),

  [`${T}/Help Henry.md`]: task({ title: 'Help Henry', status: 'open', created_at: '2026-10-01T09:00:00-07:00' }),
  [`${T}/Review PR.md`]: task({ title: 'Review PR', status: 'open', parent_task: '"[[Help Henry]]"', created_at: '2026-10-02T09:00:00-07:00' }),
  [`${T}/Leave comments.md`]: task({ title: 'Leave comments', status: 'open', parent_task: '"[[Review PR]]"', created_at: '2026-10-03T09:00:00-07:00' }),
  [`${T}/_done/Read diff.md`]: task({ title: 'Read diff', status: 'done', parent_task: '"[[Review PR]]"', created_at: '2026-10-04T09:00:00-07:00', completed_at: '2026-10-05' }),

  [`${T}/_done/Move house.md`]: task({ title: 'Move house', status: 'done', created_at: '2026-08-01T09:00:00-07:00', completed_at: '2026-09-15' }),
  [`${T}/_done/Pack boxes.md`]: task({ title: 'Pack boxes', status: 'done', parent_task: '"[[Move house]]"', created_at: '2026-08-02T09:00:00-07:00', completed_at: '2026-09-01' }),
  [`${T}/_done/Tape boxes.md`]: task({ title: 'Tape boxes', status: 'done', parent_task: '"[[Pack boxes]]"', created_at: '2026-08-03T09:00:00-07:00', completed_at: '2026-08-20' }),

  [`${T}/Orphan.md`]: task({ title: 'Orphan', status: 'open', parent_task: '"[[Gone Task]]"', created_at: '2026-06-10T09:00:00-07:00' }),

  [`${T}/_done/Plan trip.md`]: task({ title: 'Plan trip', status: 'done', created_at: '2026-02-01T09:00:00-07:00', completed_at: '2026-02-20' }),
  [`${T}/Plan trip.md`]: task({ title: 'Plan trip', status: 'open', created_at: '2026-05-01T09:00:00-07:00' }),
  [`${T}/Book flights.md`]: task({ title: 'Book flights', status: 'open', parent_task: '"[[Plan trip]]"', created_at: '2026-06-01T09:00:00-07:00' }),

  [`${T}/Loop A.md`]: task({ title: 'Loop A', status: 'open', parent_task: '"[[Loop B]]"', created_at: '2026-04-01T09:00:00-07:00' }),
  [`${T}/Loop B.md`]: task({ title: 'Loop B', status: 'open', parent_task: '"[[Loop A]]"', created_at: '2026-04-02T09:00:00-07:00' }),

  [`${T}/_done/Taxes.md`]: task({ title: 'Taxes', status: 'done', created_at: '2026-03-01T09:00:00-07:00', completed_at: '2026-04-15' }),
  [`${T}/File state return.md`]: task({ title: 'File state return', status: 'open', parent_task: '"[[Taxes]]"', created_at: '2026-03-02T09:00:00-07:00' }),

  [`${T}/_done/Garden.md`]: task({ title: 'Garden', status: 'done', created_at: '2026-07-01T09:00:00-07:00', completed_at: '2026-07-20' }),
  [`${T}/_trash/Buy gnome.md`]: task({ title: 'Buy gnome', status: 'deleted', parent_task: '"[[Garden]]"', created_at: '2026-07-02T09:00:00-07:00' }),

  [`${T}/_trash/Old idea.md`]: task({ title: 'Old idea', status: 'deleted', created_at: '2026-05-05T09:00:00-07:00' }),
  [`${T}/_done/Sketch it.md`]: task({ title: 'Sketch it', status: 'done', parent_task: '"[[Old idea]]"', created_at: '2026-05-06T09:00:00-07:00', completed_at: '2026-05-07' }),

  'spice/daily/2026-11-10.md': '---\ntype: daily\nlinks: ["[[Pay Bills]]"]\n---\nRemember [[Pay Bills|bills]], ![[Help Henry]] and [[spice/tasks/Orphan]].\n',
  'spice/home/Done Board.md': '---\ntype: board\n---\n```dataview\nLIST FROM "spice/tasks/_done"\n```\n',
};

const EXPECT = {
  [`${T}/Help Henry.md`]: `${T}/Help Henry/Help Henry.md`,
  [`${T}/Review PR.md`]: `${T}/Help Henry/Review PR/Review PR.md`,
  [`${T}/Leave comments.md`]: `${T}/Help Henry/Review PR/Leave comments/Leave comments.md`,
  [`${T}/_done/Read diff.md`]: `${T}/Help Henry/Review PR/Read diff/Read diff.md`,
  [`${T}/_done/Move house.md`]: `${T}/_done/2026/09/Move house/Move house.md`,
  [`${T}/_done/Pack boxes.md`]: `${T}/_done/2026/09/Move house/Pack boxes/Pack boxes.md`,
  [`${T}/_done/Tape boxes.md`]: `${T}/_done/2026/09/Move house/Pack boxes/Tape boxes/Tape boxes.md`,
  [`${T}/_done/Pay Bills.md`]: `${T}/_done/2026/01/Pay Bills/Pay Bills.md`,
  [`${T}/Pay Bills.md`]: `${T}/Pay Bills - 11-03-26/Pay Bills - 11-03-26.md`,
  [`${T}/_done/yup.md`]: `${T}/_done/2026/03/yup - 03-04-26/yup - 03-04-26.md`,
  [`${T}/Orphan.md`]: `${T}/Orphan/Orphan.md`,
  [`${T}/_done/Plan trip.md`]: `${T}/_done/2026/02/Plan trip/Plan trip.md`,
  [`${T}/Plan trip.md`]: `${T}/Plan trip - 05-01-26/Plan trip - 05-01-26.md`,
  [`${T}/Book flights.md`]: `${T}/Plan trip - 05-01-26/Book flights/Book flights.md`,
  [`${T}/Loop A.md`]: `${T}/Loop A/Loop A.md`,
  [`${T}/Loop B.md`]: `${T}/Loop A/Loop B/Loop B.md`,
  [`${T}/_done/Taxes.md`]: `${T}/_done/2026/04/Taxes/Taxes.md`,
  [`${T}/File state return.md`]: `${T}/File state return/File state return.md`,
  [`${T}/_done/Garden.md`]: `${T}/_done/2026/07/Garden/Garden.md`,
  [`${T}/_trash/Buy gnome.md`]: `${T}/_trash/Buy gnome/Buy gnome.md`,
  [`${T}/_trash/Old idea.md`]: `${T}/_trash/Old idea/Old idea.md`,
  [`${T}/_done/Sketch it.md`]: `${T}/_trash/Old idea/Sketch it/Sketch it.md`,
};

function readFm(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
    fm[kv[1]] = v;
  }
  return fm;
}

function fixtureInputs(files) {
  const notes = [];
  const others = [];
  for (const [p, body] of Object.entries(files)) {
    const fm = readFm(body);
    if (p.startsWith(T + '/') && fm.type === 'task') notes.push({ path: p, fm, body });
    else others.push({ path: p, body });
  }
  return { notes, allMdPaths: Object.keys(files).filter((p) => p.endsWith('.md')), others };
}

function plan(files) {
  const { notes, allMdPaths, others } = fixtureInputs(files);
  return install.planTaskFolders(notes, allMdPaths, others, { today: '2026-11-11' });
}

function makeFsAdapter(root, calls) {
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
      calls.push(['write', rel]);
      const f = abs(rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    },
    async mkdir(rel) { calls.push(['mkdir', rel]); fs.mkdirSync(abs(rel), { recursive: true }); },
    async remove(rel) { calls.push(['remove', rel]); fs.unlinkSync(abs(rel)); },
    async rename(from, to) { calls.push(['rename', from, to]); fs.renameSync(abs(from), abs(to)); },
  };
}

function snapshot(root) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(root, r), 'utf8');
    }
  };
  walk('');
  return out;
}

async function withVault(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-plan-'));
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  const calls = [];
  const adapter = makeFsAdapter(root, calls);
  const tp = { app: { vault: { adapter } } };
  try { await fn({ root, tp, calls }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function localToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  ok('TF-PLAN the installer exports planTaskFolders, renderTaskFoldersReport and applyTaskFoldersHeal',
    typeof install.planTaskFolders === 'function' && typeof install.renderTaskFoldersReport === 'function' &&
    typeof install.applyTaskFoldersHeal === 'function');
  if (typeof install.planTaskFolders !== 'function') {
    console.log('\nrun-task-folders-plan: planner missing, stopping');
    process.exit(1);
  }

  const p = plan(FIXTURE);
  const to = new Map(p.moves.map((m) => [m.from, m.to]));
  const target = (from) => to.has(from) ? to.get(from) : from;
  const wrong = (keys) => keys.filter((k) => target(k) !== EXPECT[k]).map((k) => `${k} → ${target(k)} (want ${EXPECT[k]})`).join('; ');

  {
    const keys = [`${T}/Help Henry.md`, `${T}/Review PR.md`, `${T}/Leave comments.md`, `${T}/_done/Read diff.md`];
    ok('TF-PLAN-TREE each open subtask lands in its parent\'s folder, a done subtask stays in its open tree', !wrong(keys), wrong(keys));
  }
  {
    const keys = [`${T}/_done/Move house.md`, `${T}/_done/Pack boxes.md`, `${T}/_done/Tape boxes.md`];
    ok('TF-PLAN-DONE-ROOT a done root lands under _done/<completed YYYY/MM>/ with its done children (and a nested done subtask) inside', !wrong(keys), wrong(keys));
    const mv = p.moves.find((m) => m.from === `${T}/_done/Move house.md`);
    ok('TF-PLAN-DONE-ROOT the move reason names completed_at as the month source', mv && /completed_at/.test(mv.reason), mv && mv.reason);
    const pm = install.planTaskFolders([
      { path: `${T}/_done/Undated.md`, fm: { type: 'task', title: 'Undated', status: 'done', created_at: '2026-01-02' }, body: '', mtime: new Date(2026, 5, 15, 12).getTime() },
      { path: `${T}/_done/Bare.md`, fm: { type: 'task', title: 'Bare', status: 'done', created_at: '2026-02-03' }, body: '' },
    ], [`${T}/_done/Undated.md`, `${T}/_done/Bare.md`], [], {});
    const um = pm.moves.find((m) => m.from === `${T}/_done/Undated.md`);
    const bm = pm.moves.find((m) => m.from === `${T}/_done/Bare.md`);
    ok('TF-PLAN-DONE-ROOT with no completed_at the month comes from the file mtime, and the reason says so',
      um && um.to === `${T}/_done/2026/06/Undated/Undated.md` && /mtime/.test(um.reason), um && JSON.stringify(um));
    ok('TF-PLAN-DONE-ROOT with no completed_at and no mtime the month comes from created_at',
      bm && bm.to === `${T}/_done/2026/02/Bare/Bare.md` && /created_at/.test(bm.reason), bm && JSON.stringify(bm));
  }
  {
    const keys = [`${T}/_done/Pay Bills.md`, `${T}/Pay Bills.md`, `${T}/_done/yup.md`];
    ok('TF-PLAN-NAMES the oldest Pay Bills keeps the plain name, the other gets - MM-DD-YY, the wiki clash gets - MM-DD-YY', !wrong(keys), wrong(keys));
    const yupRename = p.renames.find((r) => r.from === `${T}/_done/yup.md`);
    ok('TF-PLAN-NAMES the wiki clash rename names the wiki path',
      yupRename && /clash with spice\/wiki\/ems\/other-stuff\/Yup\.md/.test(yupRename.why), JSON.stringify(yupRename));
    const yupMove = p.moves.find((m) => m.from === `${T}/_done/yup.md`);
    ok('TF-PLAN-NAMES the wiki clash move reason names the wiki path',
      yupMove && /spice\/wiki\/ems\/other-stuff\/Yup\.md/.test(yupMove.reason), yupMove && yupMove.reason);
    const payRename = p.renames.find((r) => r.from === `${T}/Pay Bills.md`);
    ok('TF-PLAN-NAMES the younger Pay Bills rename names the older task',
      payRename && payRename.to === EXPECT[`${T}/Pay Bills.md`] && /spice\/tasks\/_done\/Pay Bills\.md/.test(payRename.why), JSON.stringify(payRename));
    ok('TF-PLAN-NAMES a task whose name is already unique is never renamed',
      p.renames.every((r) => [`${T}/_done/yup.md`, `${T}/Pay Bills.md`, `${T}/Plan trip.md`].includes(r.from)),
      p.renames.map((r) => r.from).join(', '));
  }
  {
    const keys = [`${T}/Book flights.md`, `${T}/Plan trip.md`];
    ok('TF-PLAN-AMBIGUOUS-PARENT the same-place candidate wins', !wrong(keys), wrong(keys));
    const pick = p.parentPicks.find((x) => x.child === `${T}/Book flights.md`);
    ok('TF-PLAN-AMBIGUOUS-PARENT the pick is listed with its candidates',
      pick && pick.picked === `${T}/Plan trip.md` &&
      JSON.stringify(pick.candidates.slice().sort()) === JSON.stringify([`${T}/Plan trip.md`, `${T}/_done/Plan trip.md`]),
      JSON.stringify(pick));
    const groceries = (childCreated) => install.planTaskFolders([
      { path: `${T}/Errands/Errands.md`, fm: { type: 'task', title: 'Errands', status: 'open', created_at: '2026-01-01' }, body: '' },
      { path: `${T}/Groceries.md`, fm: { type: 'task', title: 'Groceries', status: 'open', created_at: '2026-01-01' }, body: '' },
      { path: `${T}/Errands/Groceries/Groceries.md`, fm: { type: 'task', title: 'Groceries', status: 'open', created_at: '2026-09-01' }, body: '' },
      { path: `${T}/Milk.md`, fm: { type: 'task', title: 'Milk', status: 'open', parent_task: '[[Groceries]]', created_at: childCreated }, body: '' },
    ], [`${T}/Errands/Errands.md`, `${T}/Groceries.md`, `${T}/Errands/Groceries/Groceries.md`, `${T}/Milk.md`], [], {});
    const before = groceries('2026-05-01').parentPicks.find((x) => x.child === `${T}/Milk.md`);
    ok('TF-PLAN-AMBIGUOUS-PARENT among same-place candidates the one created before the child wins',
      before && before.picked === `${T}/Groceries.md`, JSON.stringify(before));
    const newest = groceries('2026-12-01').parentPicks.find((x) => x.child === `${T}/Milk.md`);
    ok('TF-PLAN-AMBIGUOUS-PARENT when several were created before the child the newest wins',
      newest && newest.picked === `${T}/Errands/Groceries/Groceries.md`, JSON.stringify(newest));
  }
  {
    ok('TF-PLAN-MISSING-PARENT the task is top-level', target(`${T}/Orphan.md`) === EXPECT[`${T}/Orphan.md`], target(`${T}/Orphan.md`));
    ok('TF-PLAN-MISSING-PARENT the task is listed in unresolved',
      p.unresolved.some((u) => u.path === `${T}/Orphan.md` && /Gone Task/.test(u.why)), JSON.stringify(p.unresolved));
  }
  {
    const keys = [`${T}/Loop A.md`, `${T}/Loop B.md`];
    ok('TF-PLAN-LOOP the loop breaks at the oldest task, which becomes top-level', !wrong(keys), wrong(keys));
    ok('TF-PLAN-LOOP the broken task is listed in unresolved',
      p.unresolved.some((u) => u.path === `${T}/Loop A.md` && /loop/i.test(u.why)) &&
      !p.unresolved.some((u) => u.path === `${T}/Loop B.md`), JSON.stringify(p.unresolved));
  }
  {
    ok('TF-PLAN-PROMOTE the open child of a done parent is top-level in spice/tasks/',
      target(`${T}/File state return.md`) === EXPECT[`${T}/File state return.md`], target(`${T}/File state return.md`));
    ok('TF-PLAN-PROMOTE the promoted task is listed with its former parent',
      p.promoted.length === 1 && p.promoted[0].path === `${T}/File state return.md` && p.promoted[0].formerParent === `${T}/_done/Taxes.md`,
      JSON.stringify(p.promoted));
  }
  {
    const keys = [`${T}/_done/Garden.md`, `${T}/_trash/Buy gnome.md`, `${T}/_trash/Old idea.md`, `${T}/_done/Sketch it.md`];
    ok('TF-PLAN-TRASH a trashed child of a done parent goes to _trash/<Name>/ alone; a trashed parent takes its done child', !wrong(keys), wrong(keys));
  }
  {
    ok('TF-PLAN-QUERY-REF the Dataview path is in queryRefs',
      p.queryRefs.some((q) => q.in === 'spice/home/Done Board.md' && /spice\/tasks\/_done/.test(q.text)), JSON.stringify(p.queryRefs));
    ok('TF-PLAN-QUERY-REF a link inside a query block is not an ambiguous link',
      !p.ambiguousLinks.some((a) => a.in === 'spice/home/Done Board.md'), JSON.stringify(p.ambiguousLinks));
  }
  {
    const inDaily = p.ambiguousLinks.filter((a) => a.in === 'spice/daily/2026-11-10.md');
    ok('TF-PLAN-LINKS a body link and a frontmatter link to the ambiguous Pay Bills are both listed',
      inDaily.some((a) => a.link === '[[Pay Bills|bills]]') && inDaily.some((a) => a.link === '[[Pay Bills]]'), JSON.stringify(inDaily));
    ok('TF-PLAN-LINKS a link from a non-task note resolves to the open task',
      inDaily.length === 2 && inDaily.every((a) => a.resolvesTo === `${T}/Pay Bills.md`), JSON.stringify(inDaily));
    ok('TF-PLAN-LINKS unique and path-qualified links are not listed',
      !inDaily.some((a) => /Help Henry|Orphan/.test(a.link)), JSON.stringify(inDaily));
    const wiki = p.ambiguousLinks.find((a) => a.in === 'spice/wiki/ems/other-stuff/Notes.md');
    ok('TF-PLAN-LINKS a link beside a same-named note in its own folder resolves to that note',
      wiki && wiki.resolvesTo === 'spice/wiki/ems/other-stuff/Yup.md', JSON.stringify(wiki));
    const parentLink = p.ambiguousLinks.find((a) => a.in === `${T}/Book flights.md`);
    ok('TF-PLAN-LINKS an ambiguous parent_task link resolves to the plan\'s parent pick',
      parentLink && parentLink.link === '[[Plan trip]]' && parentLink.resolvesTo === `${T}/Plan trip.md`, JSON.stringify(parentLink));
  }
  {
    const files = {};
    for (const [k, body] of Object.entries(FIXTURE)) {
      let pth = target(k);
      let text = body;
      files[pth] = text;
    }
    const picks = new Map(p.parentPicks.map((x) => [x.child, x.picked]));
    const fixtureTasks = fixtureInputs(FIXTURE).notes;
    const byBase = (name) => fixtureTasks.filter((n) => path.basename(n.path, '.md').toLowerCase() === name.toLowerCase());
    for (const n of fixtureTasks) {
      const m = /\[\[([^\]|]+)/.exec(n.fm.parent_task || '');
      if (!m) continue;
      const parentFrom = picks.get(n.path) || (byBase(m[1]).length === 1 ? byBase(m[1])[0].path : '');
      if (!parentFrom) continue;
      const newName = path.basename(target(parentFrom), '.md');
      files[target(n.path)] = files[target(n.path)].replace(/^parent_task: .*$/m, `parent_task: "[[${newName}]]"`);
    }
    const again = plan(files);
    ok('TF-PLAN-IDEMPOTENT planning an already-migrated fixture gives zero moves',
      again.moves.length === 0 && again.renames.length === 0, JSON.stringify(again.moves.slice(0, 3)));
  }
  {
    const report = install.renderTaskFoldersReport(p, '2026-11-11');
    const missing = p.moves.filter((m) => !report.includes('`' + m.from + '` → `' + m.to + '`'));
    ok('TF-REPORT every move appears as from → to', p.moves.length === Object.keys(EXPECT).length && missing.length === 0,
      `${p.moves.length} moves; missing ${missing.map((m) => m.from).join(', ')}`);
    const json = /```json\n([\s\S]*?)\n```/.exec(report);
    let parsed = null;
    try { parsed = JSON.parse(json[1]); } catch (_e) { parsed = null; }
    ok('TF-REPORT the json block holds the full plan', parsed && JSON.stringify(parsed) === JSON.stringify(p));
    ok('TF-REPORT the Apply block calls TaskFolders through customjs-guard',
      /## Apply[\s\S]*```dataviewjs\nawait dv\.view\("ranch\/views\/customjs-guard", \{ class: "TaskFolders" \}\);\n```/.test(report));
    ok('TF-REPORT the Apply section says Obsidian Sync version history is the undo for a move',
      /## Apply\n[\s\S]*?Sync[^\n]*version history[^\n]*undo/i.test(report.split('## Moves')[0]), report.split('## Moves')[0]);
    ok('TF-REPORT renames carry their reason', report.includes('clash with spice/wiki/ems/other-stuff/Yup.md'));
    ok('TF-REPORT the summary counts the moves', report.includes(`| Moves | ${p.moves.length} |`));

    const sectionOf = (heading) => {
      const i = report.indexOf(heading + '\n');
      if (i < 0) return '';
      const rest = report.slice(i + heading.length + 1);
      const j = rest.search(/^##{1,2} /m);
      return j < 0 ? rest : rest.slice(0, j);
    };
    const settled = sectionOf('### Rewritten at Apply');
    const guessed = sectionOf('### Listed only (best guess)');
    ok('TF-REPORT-AMBIGUOUS the intro says settled links are rewritten to their full path and best-guess ones are only listed',
      /settled[^\n]*rewritten to (its|their) full path/i.test(sectionOf('## Ambiguous links')) &&
      /best.guess[^\n]*only listed/i.test(sectionOf('## Ambiguous links')), sectionOf('## Ambiguous links'));
    ok('TF-REPORT-AMBIGUOUS the parent_task-settled and same-folder links sit under "Rewritten at Apply"',
      settled.includes('`spice/tasks/Book flights.md`: `[[Plan trip]]`') &&
      settled.includes('`spice/wiki/ems/other-stuff/Notes.md`: `[[Yup]]`') && !/same-place-oldest/.test(settled), settled);
    ok('TF-REPORT-AMBIGUOUS the same-place-oldest links sit under "Listed only (best guess)"',
      guessed.includes('`spice/daily/2026-11-10.md`: `[[Pay Bills|bills]]`') && !/parent_task\)|same-folder\)/.test(guessed), guessed);
    const unresolved = sectionOf('## Unresolved');
    ok('TF-REPORT-UNRESOLVED a missing parent is named in inline code, never as a live link',
      unresolved.includes('`Gone Task`') && !/\[\[Gone Task\]\]/.test(report.split('## Plan data')[0]), unresolved);
  }

  await withVault(FIXTURE, async ({ root, tp, calls }) => {
    const before = snapshot(root);
    const history = [];
    await install.applyTaskFoldersHeal(tp, history, {});
    const after = snapshot(root);
    const reportPath = `ranch/reports/task-folders-${localToday()}.md`;
    const changed = Object.keys(before).filter((k) => after[k] !== before[k]);
    const added = Object.keys(after).filter((k) => !(k in before));
    ok('TF-HEAL-NO-MOVE every task path is unchanged and no note is changed', changed.length === 0, changed.join(', '));
    ok('TF-HEAL-NO-MOVE exactly one report is written', added.length === 1 && added[0] === reportPath, added.join(', '));
    ok('TF-HEAL-NO-MOVE the only write is the report; nothing is removed or renamed',
      calls.filter((c) => c[0] === 'write').every((c) => c[1] === reportPath) && !calls.some((c) => c[0] === 'remove' || c[0] === 'rename'),
      JSON.stringify(calls));
    ok('TF-HEAL-NO-MOVE history records the report', history.some((h) => h.step === 'task_folders_heal' && h.target === reportPath));
    const report1 = after[reportPath] || '';
    await install.applyTaskFoldersHeal(tp, [], {});
    const third = snapshot(root);
    ok('TF-HEAL-NO-MOVE a re-run the same day overwrites the one report and moves nothing',
      Object.keys(third).length === Object.keys(after).length && third[reportPath] === report1);

    const applied = report1 + '\n<!-- task-folders:applied -->\n## Applied 2026-11-11T12:00:00.000Z\n\n| Moved | 1 |\n';
    fs.writeFileSync(path.join(root, reportPath), applied);
    await install.applyTaskFoldersHeal(tp, [], {});
    const second = reportPath.replace(/\.md$/, '-2.md');
    const fourth = snapshot(root);
    ok('TF-HEAL-APPLIED-KEPT a report that has the applied anchor is kept and the new one is written as -2',
      fourth[reportPath] === applied && fourth[second] === report1, Object.keys(fourth).filter((k) => k.startsWith('ranch/')).join(', '));
    await install.applyTaskFoldersHeal(tp, [], {});
    const fifth = snapshot(root);
    ok('TF-HEAL-APPLIED-KEPT an unapplied -2 is overwritten on the next run, not followed by -3',
      fifth[second] === report1 && !(reportPath.replace(/\.md$/, '-3.md') in fifth));
    fs.writeFileSync(path.join(root, second), report1 + '\n<!-- task-folders:applied -->\n## Applied 2026-11-11T13:00:00.000Z\n');
    await install.applyTaskFoldersHeal(tp, [], {});
    const sixth = snapshot(root);
    ok('TF-HEAL-APPLIED-KEPT with -1 and -2 both applied the next report is -3',
      sixth[reportPath.replace(/\.md$/, '-3.md')] === report1 && /task-folders:applied/.test(sixth[second]) && sixth[reportPath] === applied);
    fs.writeFileSync(path.join(root, reportPath.replace(/\.md$/, '-3.md')), report1 + '\n## Applied by hand, no anchor\n');
    await install.applyTaskFoldersHeal(tp, [], {});
    const seventh = snapshot(root);
    ok('TF-HEAL-APPLIED-KEPT the visible heading alone does not count as applied: -3 is overwritten, no -4',
      seventh[reportPath.replace(/\.md$/, '-3.md')] === report1 && !(reportPath.replace(/\.md$/, '-4.md') in seventh));
  });

  await withVault({
    [`${T}/Solo/Solo.md`]: task({ title: 'Solo', status: 'open', created_at: '2026-11-01' }),
    'spice/wiki/Other.md': '# other\n',
  }, async ({ root, tp }) => {
    const history = [];
    await install.applyTaskFoldersHeal(tp, history, {});
    ok('TF-HEAL-NO-MOVE an already-migrated vault gets no report', !fs.existsSync(path.join(root, 'ranch/reports')));
    ok('TF-HEAL-NO-MOVE history says nothing needs to move',
      history.some((h) => h.step === 'task_folders_heal' && h.action === 'no_moves'), JSON.stringify(history));
  });

  await withVault({}, async ({ tp }) => {
    let threw = false;
    try { await install.applyTaskFoldersHeal(tp, [], {}); await install.applyTaskFoldersHeal({}, [], {}); }
    catch (_e) { threw = true; }
    ok('TF-HEAL-NO-MOVE the heal never throws, with or without spice/tasks', !threw);
  });

  const SEED = install._TASK_SETS_SEED || {};
  const TE_MANIFEST = { name: 'task-entity' };
  await withVault({ [`${T}/Live/Live.md`]: task({ title: 'Live', status: 'open' }) }, async ({ root, tp, calls }) => {
    const history = [];
    await install.applyTaskSetsSeedHeal(tp, TE_MANIFEST, history, {});
    const after = snapshot(root);
    ok('TS-SEED-HEAL with no _sets folder the installer writes PR rollout and Incident, exactly as shipped',
      after[`${T}/_sets/PR rollout.md`] === SEED['PR rollout.md'] && after[`${T}/_sets/Incident.md`] === SEED['Incident.md']
      && Object.keys(SEED).length === 2 && history.some((h) => h.step === 'task_sets_seed' && h.action === 'seeded'),
      Object.keys(after).join(', '));
    fs.writeFileSync(path.join(root, `${T}/_sets/PR rollout.md`), 'my edited set\n');
    fs.unlinkSync(path.join(root, `${T}/_sets/Incident.md`));
    calls.length = 0;
    await install.applyTaskSetsSeedHeal(tp, TE_MANIFEST, [], {});
    const again = snapshot(root);
    ok('TS-SEED-NEVER-OVERWRITE once _sets exists nothing in it is written again: an edited set stays, a deleted one stays gone',
      again[`${T}/_sets/PR rollout.md`] === 'my edited set\n' && !(`${T}/_sets/Incident.md` in again)
      && !calls.some((c) => c[0] === 'write' || c[0] === 'mkdir'), JSON.stringify(calls));
  });

  await withVault({ [`${T}/_sets/.keep`]: '' }, async ({ root, tp }) => {
    await install.applyTaskSetsSeedHeal(tp, TE_MANIFEST, [], {});
    ok('TS-SEED-EMPTY-FOLDER an empty _sets folder the user kept is not refilled', !fs.existsSync(path.join(root, `${T}/_sets/PR rollout.md`)));
  });

  await withVault({}, async ({ root, tp }) => {
    await install.applyTaskSetsSeedHeal(tp, { name: 'to-do' }, [], {});
    const other = fs.existsSync(path.join(root, `${T}/_sets`));
    let threw = false;
    try { await install.applyTaskSetsSeedHeal({}, TE_MANIFEST, [], {}); await install.applyTaskSetsSeedHeal(null, null, null, null); }
    catch (_e) { threw = true; }
    await install.applyTaskSetsSeedHeal(tp, TE_MANIFEST, [], {});
    ok('TS-SEED-GATED only the task-entity install seeds; a fresh vault gets the folder; it never throws',
      !other && !threw && fs.existsSync(path.join(root, `${T}/_sets/Incident.md`)));
  });

  {
    const files = Object.assign({}, FIXTURE, {
      [`${T}/_sets/Odd/Odd.md`]: task({ title: 'Odd', status: 'done', parent_task: '"[[Plan trip]]"' }),
      [`${T}/_sets/Flat Typed.md`]: task({ title: 'Flat Typed', status: 'deleted' }),
    });
    const withSets = plan(files);
    const json = JSON.stringify(withSets);
    ok('TS-FOLDERS-PLAN a task-shaped note inside _sets is never planned, moved, renamed, picked as a parent or reported',
      !/_sets/.test(json) && JSON.stringify(withSets.moves) === JSON.stringify(plan(FIXTURE).moves), json.slice(0, 300));
  }

  await withVault({
    [`${T}/_sets/PR rollout.md`]: SEED['PR rollout.md'] || '',
    [`${T}/_sets/Typed/Typed.md`]: task({ title: 'Typed', status: 'done' }),
    [`${T}/_sets/Typed/notes/Old.md`]: '---\ntype: task-doc\nkind: prompt\n---\n\n> [!info] Prompt for [[Typed]]\n',
    [`${T}/Live/Live.md`]: task({ title: 'Live', status: 'open' }),
  }, async ({ root, tp, calls }) => {
    const before = snapshot(root);
    const history = [];
    await install.applyTaskFoldersHeal(tp, history, {});
    await install.applyTaskDocHeaderHeal(tp, history, {});
    const after = snapshot(root);
    ok('TS-HEALS-SKIP-SETS the folder dry run and the note-header heal leave _sets alone: no report, no write',
      JSON.stringify(after) === JSON.stringify(before) && !calls.some((c) => c[0] === 'write')
      && history.some((h) => h.step === 'task_folders_heal' && h.action === 'no_moves'), JSON.stringify(calls));
  });

  {
    const today = '2026-11-13';
    const strays = install.planTaskStrays([{ path: `${T}/Typed.md`, body: 'old flat copy' }], [`${T}/_sets/Typed/Typed.md`], [], today);
    ok('TS-STRAYS a stray whose only twin sits in _sets is left in place, never parked in a set',
      strays.actions.length === 1 && strays.actions[0].kind === 'leave', JSON.stringify(strays.actions));
  }

  const failed = results.filter(([, c]) => !c).length;
  console.log(`\nrun-task-folders-plan: ${results.length - failed} pass · ${failed} fail`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
