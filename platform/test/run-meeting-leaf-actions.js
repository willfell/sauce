#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharedWindow = { app: undefined, customJS: undefined, moment: undefined };
function loadHelperClass(rel, className) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  const stubs = `const document = {}; const Notice = function (msg, ms) { if (window.__captureNotice) window.__captureNotice(msg, ms); }; const console = { error(){}, warn(){} };`;
  // eslint-disable-next-line no-new-func
  return new Function('window', `${stubs}\n${src}\nreturn ${className};`)(sharedWindow);
}
const MLA = loadHelperClass('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');
let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) { if (cond) { console.log(`  ok  ${label}`); pass++; } else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; } }
console.log('run-meeting-leaf-actions:');

ok('MLA-1 stripWikilink unwraps', MLA.stripWikilink('[[Q3 Planning]]') === 'Q3 Planning');
ok('MLA-2 stripWikilink passthrough plain', MLA.stripWikilink('Plain') === 'Plain');
ok('MLA-3 stripWikilink empty/nullish', MLA.stripWikilink('') === '' && MLA.stripWikilink(undefined) === '' && MLA.stripWikilink(null) === '');

const projects = [{ slug: 'q3-planning', name: 'Q3 Planning' }, { slug: 'sauce', name: 'Sauce' }];
ok('MLA-4 preselect matches project → object', JSON.stringify(MLA.resolveProjectPreselect({ project: '[[Q3 Planning]]' }, projects)) === JSON.stringify({ type: 'project', slug: 'q3-planning', name: 'Q3 Planning' }));
ok('MLA-5 preselect no project → today', MLA.resolveProjectPreselect({ project: '' }, projects) === 'today');
ok('MLA-6 preselect unknown project → today', MLA.resolveProjectPreselect({ project: '[[Nonexistent]]' }, projects) === 'today');

const fm = MLA.buildAttendeeFrontmatter(['Alex Kim', 'Sam Lee', 'Alex Kim']);
ok('MLA-7 attendees wikilinked + deduped', JSON.stringify(fm.attendees) === JSON.stringify(['[[Alex Kim]]', '[[Sam Lee]]']));
ok('MLA-8 people kept in sync with attendees', JSON.stringify(fm.people) === JSON.stringify(fm.attendees));
ok('MLA-9 empty selection → empty arrays', (() => { const e = MLA.buildAttendeeFrontmatter([]); return Array.isArray(e.attendees) && e.attendees.length === 0 && e.people.length === 0; })());

const stub = MLA.personStubBody('Jordan Fox', '2026-06-19T10:00:00Z');
ok('MLA-10 personStubBody has type: person frontmatter', /^---\ntype: person\n/.test(stub) && /\n---\n/.test(stub));
ok('MLA-11 personStubBody embeds the name', stub.includes('Jordan Fox'));

// ── HC-TE-MLA-NT-* — task-entity meetings wiring (_onNewTask → TaskDialog) ───
// _onNewTask now opens the task-entity TaskDialog with surface: 'meeting'
// instead of the old custom modal + dual-write. Verify the payload it passes.
const inst = new MLA();

// Capture TaskDialog.open payloads via a stubbed window.customJS.
const opened = [];
sharedWindow.app = {
  fileManager: {},
  vault: { getAbstractFileByPath() { return {}; } },
  workspace: {},
};
sharedWindow.customJS = {
  TaskDialog: { open(opts) { opened.push(opts); } },
};

// _onNewTask reads _listProjects(dv) to resolve the {name,slug} pair; stub it.
inst._listProjects = () => [{ slug: 'databricks', name: 'Databricks' }, { slug: 'sauce', name: 'Sauce' }];

// A dv whose current() is a meeting WITH a project: frontmatter.
const dvMeetingWithProject = {
  current() { return { project: '[[Databricks]]', file: { name: 'Standup-2026-06-23.md', path: 'spice/meetings/notes/2026/06-June/Standup-2026-06-23.md' } }; },
  pages() { return { where() { return { array() { return []; } }; } }; },
};

opened.length = 0;
inst._onNewTask(dvMeetingWithProject);
ok('HC-TE-MLA-NT-A _onNewTask opens TaskDialog with surface: meeting',
  opened.length === 1 && opened[0].surface === 'meeting', JSON.stringify(opened[0] || null));
ok('HC-TE-MLA-NT-B source_note is the meeting basename wikilink',
  opened.length === 1 && opened[0].sourceNote === '[[Standup-2026-06-23]]', JSON.stringify(opened[0] || null));
ok('HC-TE-MLA-NT-C project resolved to {name, slug} from the project list',
  opened.length === 1 && opened[0].project && opened[0].project.name === 'Databricks' && opened[0].project.slug === 'databricks',
  JSON.stringify(opened[0] && opened[0].project || null));

// A meeting WITHOUT a project: frontmatter → no project on the payload.
const dvMeetingNoProject = {
  current() { return { project: '', file: { name: 'Standup-2026-06-24.md', path: 'spice/meetings/notes/2026/06-June/Standup-2026-06-24.md' } }; },
  pages() { return { where() { return { array() { return []; } }; } }; },
};
opened.length = 0;
inst._onNewTask(dvMeetingNoProject);
ok('HC-TE-MLA-NT-D no project frontmatter → project is undefined',
  opened.length === 1 && opened[0].project === undefined, JSON.stringify(opened[0] || null));
ok('HC-TE-MLA-NT-E still stamps source_note for the projectless meeting',
  opened.length === 1 && opened[0].sourceNote === '[[Standup-2026-06-24]]', JSON.stringify(opened[0] || null));

// A meeting with an UNLISTED project → slug is the slugified name fallback.
// The fallback now uses the canonical slug shape (MeetingLeafActions._slugify),
// which trims a TRAILING "-" left by a terminal illegal char ("!") — so the slug
// is the clean "some-new-thing" (was "some-new-thing-" with a dangling dash under
// the old inline replace). Matches the slug shape composeNote / the project list use.
inst._listProjects = () => [];
const dvUnlistedProject = {
  current() { return { project: '[[Some New Thing!]]', file: { name: 'Standup-2026-06-25.md', path: 'x' } }; },
  pages() { return { where() { return { array() { return []; } }; } }; },
};
opened.length = 0;
inst._onNewTask(dvUnlistedProject);
ok('HC-TE-MLA-NT-F unlisted project → slugified-name fallback slug (canonical, no trailing dash)',
  opened.length === 1 && opened[0].project && opened[0].project.slug === 'some-new-thing',
  JSON.stringify(opened[0] && opened[0].project || null));

// The removed dual-write helpers must be GONE (no reintroduction of raw-markdown path).
const mlaSrc = fs.readFileSync(path.resolve(__dirname, '..', 'blueprints/meetings/helpers/meeting-leaf-actions.js'), 'utf8');
ok('HC-TE-MLA-NT-G removed the dual-write helpers (_openTaskModal / _noticeDualWrite / _projectTodoPath)',
  !/_openTaskModal|_noticeDualWrite|_projectTodoPath/.test(mlaSrc));
ok('HC-TE-MLA-NT-H _onNewTask routes through TaskDialog surface: "meeting"',
  /TaskDialog[\s\S]{0,400}surface:\s*["']meeting["']/.test(mlaSrc));

const meetManifest = fs.readFileSync(path.resolve(__dirname, '..', 'blueprints/meetings/manifest.json'), 'utf8');
ok('HC-V01330-MLA-DVGUARD-A manifest inline_body has no unguarded dv.current().file.path',
  !/dv\.current\(\)\.file\.path/.test(meetManifest));
ok('HC-V01330-MLA-DVGUARD-B manifest inline_body uses the guarded optional-chained form',
  meetManifest.includes('dv.current()?.file?.path') && meetManifest.includes('getActiveFile()'));

const meetTemplate = fs.readFileSync(path.resolve(__dirname, '..', 'blueprints/meetings/templates/Meeting.md'), 'utf8');
ok('HC-V01330-MLA-DVGUARD-C Meeting.md template has no unguarded dv.current().file.path',
  !/dv\.current\(\)\.file\.path/.test(meetTemplate));

// MTU-1 — the "Agenda" AND "Action Items" sections were removed from the meeting
// template (meetings blueprint overhaul). Task-entity (TaskMeetingList) fully
// supersedes Action Items — a live Action Items SectionLabel + dead
// <!-- ACTION_ITEMS_MARKER --> caused tasks to appear twice. New meetings go
// Attendees → Notes → Tasks with NO Agenda and NO Action Items SectionLabel.
// The install heal (applyMeetingChromeModernizeHeal) removes both from existing
// meeting notes (folding any Agenda content into Notes).
ok('MTU-1 Meeting.md template no longer renders an "Agenda" SectionLabel',
  !/class:\s*"SectionLabel"[^`]*text:\s*"Agenda"/.test(meetTemplate));
ok('MTU-1 Meeting.md template no longer renders an "Action Items" SectionLabel',
  !/class:\s*"SectionLabel"[^`]*text:\s*"Action Items"/.test(meetTemplate));
ok('MTU-1 Meeting.md template has no dead ACTION_ITEMS_MARKER',
  !/ACTION_ITEMS_MARKER/.test(meetTemplate));
ok('MTU-1 Meeting.md template keeps Attendees / Notes / Tasks SectionLabels',
  /class:\s*"SectionLabel"[^`]*text:\s*"Attendees"/.test(meetTemplate) &&
  /class:\s*"SectionLabel"[^`]*text:\s*"Notes"/.test(meetTemplate) &&
  /class:\s*"SectionLabel"[^`]*text:\s*"Tasks"/.test(meetTemplate));

// MLA-DIV — MeetingLeafActions owns its own <hr> dividers (wiki methodology): a
// top + bottom <hr> (12px breathing room) render INSIDE its dataviewjs block, and
// the Meeting.md template drops the literal `---`, so the separators hug the
// buttons instead of leaving the big Obsidian inter-block gap. Mirrors run-wiki
// W13d/W14c; the install heal strips the legacy `---` from existing meetings.
// (mlaSrc is already read above.)
ok('MLA-DIV-1 MeetingLeafActions renders top+bottom <hr> (2 hrs)',
  (mlaSrc.match(/createEl\(["']hr["']\)/g) || []).length >= 2);
ok('MLA-DIV-2 hr dividers use the 12px breathing-room margin',
  /border-top: 1px solid var\(--background-modifier-border\); margin: 12px 0;/.test(mlaSrc));
ok('MLA-DIV-3 Meeting.md template no longer brackets MeetingLeafActions with `---`',
  !/-{3,}[ \t]*\n+```dataviewjs\n[^`]*MeetingLeafActions/.test(meetTemplate) &&
  !/MeetingLeafActions[\s\S]*?\n```\n+-{3,}/.test(meetTemplate));

(async () => {
  const previous = { customJS: global.customJS, app: global.app };
  const effects = [];
  global.app = { fileManager: { processFrontMatter: async () => { effects.push('write'); } } };
  global.customJS = {
    RenderSafe: {
      async mutate(opts) {
        effects.push(typeof opts.optimistic === 'function' ? 'optimistic-hook' : 'missing-optimistic');
        effects.push(typeof opts.revert === 'function' ? 'revert-hook' : 'missing-revert');
        await opts.optimistic();
        await opts.revert(new Error('fixture rejection'));
        return { ok: false };
      },
    },
  };
  await inst._mutateFrontmatter({}, { path: 'spice/meetings/notes/Test.md' }, {
    failureMessage: 'fixture',
    optimistic: () => effects.push('optimistic'),
    revert: () => effects.push('revert'),
    write: () => {},
  });
  ok('PERF5-FIELDMUTATION-ROLLBACK forwards optimistic and exact revert hooks through RenderSafe',
    effects.join(',') === 'optimistic-hook,revert-hook,optimistic,revert', effects.join(','));

  ok('PERF5-FIELDMUTATION-ROLLBACK keeps mutation modals mounted on failure and closes only after success',
    (mlaSrc.match(/if \(saved\) \{[\s\S]{0,180}close\(\);[\s\S]{0,20}\}/g) || []).length >= 2
    && !/\}\s*close\(\);\s*\n\s*\};/.test(mlaSrc));

  const personBlock = (body) => body.slice(body.indexOf('addBtn.onclick'), body.indexOf('const save =', body.indexOf('addBtn.onclick')));
  const personLifecycleContract = (body) => {
    const block = personBlock(body);
    const lifecycle = body.slice(body.indexOf('_personLifecycle('), body.indexOf('// ── handlers'));
    return /_enqueuePerson\(personQueue/.test(block)
      && /renderSafe\.mutateStructure\s*\(\{/.test(block)
      && /apply:\s*\(\)\s*=>/.test(lifecycle)
      && /rollback:\s*\(receipt\)\s*=>/.test(lifecycle)
      && /priorNodes:\s*Array\.from/.test(lifecycle)
      && /app\.vault\.create\s*\(/.test(block);
  };
  const bareCreateMutant = mlaSrc.replace('renderSafe.mutateStructure({', 'renderSafe.mutate({');
  ok('PERF5-REQUIREMENT-MUTANTS kills the bare new-person create source mutant',
    personLifecycleContract(mlaSrc) && !personLifecycleContract(bareCreateMutant));

  // Execute the production queue and receipt callbacks: Alice paints first,
  // Bob is queued while Alice persists, Alice rejects/rolls back, then Bob
  // paints and succeeds. The old unqueued implementation restored pre-Alice
  // nodes after Bob and made Bob disappear.
  const selected = new Set();
  const people = [];
  const addInput = { value: 'Alice', focus() {} };
  let nodes = ['base-node'];
  const list = {
    get childNodes() { return nodes; },
    get children() { return nodes; },
    get firstChild() { return nodes[0] || null; },
    replaceChildren(...next) { nodes = next; },
    removeChild(node) { nodes = nodes.filter((item) => item !== node); },
    appendChild(node) { nodes.push(node); },
  };
  const redrawList = () => { nodes = [...selected]; };
  const updateAddButton = () => {};
  const queue = { tail: Promise.resolve() };
  let releaseAlice;
  let aliceApplied;
  const aliceStarted = new Promise((resolve) => { aliceApplied = resolve; });
  const aliceGate = new Promise((resolve) => { releaseAlice = resolve; });
  const alice = MLA._enqueuePerson(queue, async () => {
    const lifecycle = inst._personLifecycle({ name: 'Alice', selected, people, addInput, list, redrawList, updateAddButton });
    const receipt = lifecycle.apply();
    aliceApplied();
    await aliceGate;
    lifecycle.rollback(receipt);
    return false;
  });
  await aliceStarted;
  addInput.value = 'Bob';
  const bob = MLA._enqueuePerson(queue, async () => {
    const lifecycle = inst._personLifecycle({ name: 'Bob', selected, people, addInput, list, redrawList, updateAddButton });
    lifecycle.apply();
    return true;
  });
  releaseAlice();
  await Promise.all([alice, bob]);
  ok('PERF5-PERSON-CREATE-LIFECYCLE serializes overlapping receipts so a late rejection preserves the later success',
    !selected.has('Alice') && selected.has('Bob')
    && people.length === 1 && people[0] === 'Bob'
    && nodes.length === 1 && nodes[0] === 'Bob');

  const unqueuedMutant = mlaSrc.replace('MeetingLeafActions._enqueuePerson(personQueue, async () => {', '(async () => {');
  ok('PERF5-REQUIREMENT-MUTANTS kills the unqueued person-create source mutant',
    personLifecycleContract(mlaSrc) && !personLifecycleContract(unqueuedMutant));

  global.customJS = previous.customJS;
  global.app = previous.app;
  console.log(`\nResult: ${pass} passed, ${fail} failed.`);
  if (fail) { console.log('Failures:'); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
})().catch((error) => { console.error(error); process.exit(1); });
