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
function makeModalNode(tag = 'div', text = '') {
  const node = {
    tagName: String(tag).toUpperCase(),
    textContent: text,
    style: { cssText: '' },
    childNodes: [],
    parentNode: null,
    disabled: false,
    focusCount: 0,
    classList: { add() {} },
    createEl(childTag, opts = {}) {
      const child = makeModalNode(childTag, opts.text || '');
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    replaceChildren(...children) {
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = children;
      for (const child of children) child.parentNode = this;
    },
    focus() { this.focusCount += 1; },
    setAttribute() {},
    remove() { this.parentNode?.removeChild(this); },
  };
  Object.defineProperties(node, {
    children: { get() { return this.childNodes; } },
    firstChild: { get() { return this.childNodes[0] || null; } },
  });
  return node;
}
function modalNodes(root) {
  const out = [];
  const visit = (node) => { out.push(node); for (const child of node.childNodes || []) visit(child); };
  visit(root);
  return out;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
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

  // Exercise the actual modal handlers, not just their extracted lifecycle
  // callbacks. Alice paints optimistically and then rejects while Bob is
  // queued; Save is clicked before either write settles. The handler must
  // restore Alice's exact pre-mutation DOM receipt, let Bob persist, and defer
  // the meeting frontmatter write until the person queue drains.
  const meetingFile = { path: 'spice/meetings/notes/Test.md' };
  const meetingPage = { file: meetingFile, attendees: ['[[Existing]]'] };
  const personGates = { Alice: deferred(), Bob: deferred() };
  const handlerEvents = [];
  const createdPeople = [];
  const savedFrontmatters = [];
  let attendeePanel;
  let attendeeCloseCount = 0;
  let rollbackReceipt;
  const handlerInst = new MLA();
  handlerInst._listPeople = () => ['Existing'];
  handlerInst._openModal = ({ build }) => {
    attendeePanel = makeModalNode('div');
    build(attendeePanel, () => { attendeeCloseCount += 1; });
  };
  global.app = {
    vault: {
      getAbstractFileByPath(target) { return target === meetingFile.path ? meetingFile : null; },
      async create(target) {
        const name = path.basename(target, '.md');
        createdPeople.push(name);
        handlerEvents.push(`${name.toLowerCase()}-write-start`);
        return personGates[name].promise;
      },
    },
    fileManager: {
      async processFrontMatter(_file, updater) {
        const next = {};
        updater(next);
        savedFrontmatters.push(next);
        handlerEvents.push('frontmatter');
      },
    },
  };
  global.customJS = {
    RenderSafe: {
      page: () => meetingPage,
      async mutateStructure(opts) {
        const receipt = opts.apply();
        try {
          await opts.write();
          return { ok: true };
        } catch (error) {
          opts.rollback(receipt);
          rollbackReceipt = {
            nodes: [...attendeeList.childNodes],
            inputValue: attendeeInput.value,
            inputFocusCount: attendeeInput.focusCount,
          };
          return { ok: false, error };
        }
      },
      async mutate(opts) {
        await opts.optimistic?.();
        await opts.write();
        return { ok: true };
      },
    },
  };

  handlerInst._onEditAttendees({ current: () => meetingPage });
  const attendeeList = modalNodes(attendeePanel).find((node) => /max-height:46vh/.test(node.style.cssText));
  const attendeeInput = modalNodes(attendeePanel).find((node) => node.tagName === 'INPUT' && node.placeholder === 'Search or add new…');
  const attendeeButtons = () => modalNodes(attendeePanel).filter((node) => node.tagName === 'BUTTON');
  const addPersonButton = attendeeButtons().find((node) => /^Add/.test(node.textContent));
  const saveAttendeesButton = attendeeButtons().find((node) => node.textContent === 'Save attendees');
  attendeeInput.value = 'Alice';
  attendeeInput.oninput();
  const originalExistingNode = attendeeList.childNodes[0];
  const aliceClick = addPersonButton.onclick();
  while (!handlerEvents.includes('alice-write-start')) await tick();

  attendeeInput.value = 'Bob';
  attendeeInput.oninput();
  const bobClick = addPersonButton.onclick();
  const saveClick = saveAttendeesButton.onclick();
  await tick();
  ok('PERF5B-SAVE-QUEUE-BINDING real Save handler does not write frontmatter while person receipts are pending',
    savedFrontmatters.length === 0 && !handlerEvents.includes('frontmatter'));

  handlerEvents.push('alice-reject');
  personGates.Alice.reject(new Error('Alice fixture rejection'));
  while (!handlerEvents.includes('bob-write-start')) await tick();
  ok('PERF5B-EXACT-NODE-IDENTITY real Alice failure handler restores exact nodes, input, and retry focus before Bob applies',
    rollbackReceipt
      && rollbackReceipt.nodes.length === 1
      && rollbackReceipt.nodes[0] === originalExistingNode
      && rollbackReceipt.inputValue === 'Alice'
      && rollbackReceipt.inputFocusCount === 1,
    JSON.stringify(rollbackReceipt && { inputValue: rollbackReceipt.inputValue, inputFocusCount: rollbackReceipt.inputFocusCount }));

  handlerEvents.push('bob-resolve');
  personGates.Bob.resolve({ path: 'spice/people/Bob.md' });
  await Promise.all([aliceClick, bobClick, saveClick]);
  const frontmatterIndex = handlerEvents.indexOf('frontmatter');
  ok('PERF5B-REAL-HANDLER-PROOF real queued handlers preserve Bob, omit rejected Alice, and close only after Save succeeds',
    JSON.stringify(createdPeople) === JSON.stringify(['Alice', 'Bob'])
      && savedFrontmatters.length === 1
      && JSON.stringify(savedFrontmatters[0].attendees) === JSON.stringify(['[[Existing]]', '[[Bob]]'])
      && JSON.stringify(savedFrontmatters[0].people) === JSON.stringify(['[[Existing]]', '[[Bob]]'])
      && frontmatterIndex > handlerEvents.indexOf('bob-resolve')
      && attendeeCloseCount === 1,
    JSON.stringify({ handlerEvents, createdPeople, savedFrontmatters, attendeeCloseCount }));

  // Drive both field-mutation failure callbacks through their real controls.
  // Each failed mutation must leave its modal mounted and restore the exact
  // triggering control state/focus for an immediate retry.
  const installFailingFieldMutation = (page) => {
    global.customJS = {
      RenderSafe: {
        page: () => page,
        async mutate(opts) {
          await opts.optimistic?.();
          await opts.revert?.(new Error('field fixture rejection'));
          return { ok: false };
        },
      },
    };
  };

  let projectPanel;
  let projectCloseCount = 0;
  const projectInst = new MLA();
  projectInst._listProjects = () => [{ slug: 'project-a', name: 'Project A' }];
  projectInst._openModal = ({ build }) => {
    projectPanel = makeModalNode('div');
    build(projectPanel, () => { projectCloseCount += 1; });
  };
  installFailingFieldMutation(meetingPage);
  projectInst._onAddToProject({ current: () => meetingPage });
  const projectButton = modalNodes(projectPanel).find((node) => node.tagName === 'BUTTON' && node.textContent === 'Project A');
  const projectPrior = { disabled: projectButton.disabled, text: projectButton.textContent };
  await projectButton.onclick();
  ok('PERF5B-RETRY-FOCUS-PROOF real project failure handler restores control state/focus and keeps its modal mounted',
    projectButton.disabled === projectPrior.disabled
      && projectButton.textContent === projectPrior.text
      && projectButton.focusCount === 1
      && projectCloseCount === 0);

  let failedAttendeePanel;
  let failedAttendeeCloseCount = 0;
  const failedAttendeeInst = new MLA();
  failedAttendeeInst._listPeople = () => ['Existing'];
  failedAttendeeInst._openModal = ({ build }) => {
    failedAttendeePanel = makeModalNode('div');
    build(failedAttendeePanel, () => { failedAttendeeCloseCount += 1; });
  };
  installFailingFieldMutation({ file: meetingFile, attendees: ['[[Existing]]'] });
  failedAttendeeInst._onEditAttendees({ current: () => meetingPage });
  const failedSave = modalNodes(failedAttendeePanel).find((node) => node.tagName === 'BUTTON' && node.textContent === 'Save attendees');
  const savePrior = { disabled: failedSave.disabled, text: failedSave.textContent };
  await failedSave.onclick();
  ok('PERF5B-RETRY-FOCUS-PROOF real attendee failure handler restores control state/focus and keeps its modal mounted',
    failedSave.disabled === savePrior.disabled
      && failedSave.textContent === savePrior.text
      && failedSave.focusCount === 1
      && failedAttendeeCloseCount === 0);

  const ledger = fs.readFileSync(path.resolve(__dirname, '..', '..', 'Docs', 'agent-guides', 'code-conventions.md'), 'utf8');
  const meetingsLedgerRow = ledger.split('\n').find((line) => /^\| Meetings \| `MeetingChromeBar`/.test(line));
  const ledgerVerdicts = (row) => {
    if (!row) return [];
    return row.split('|').slice(1, -1).map((cell) => cell.trim()).slice(2)
      .map((cell) => (cell.match(/\*\*(OK(?:\/N\/A)?)\*\*/) || [])[1] || '');
  };
  const gapLedgerMutant = meetingsLedgerRow.replace(/\*\*OK(?:\/N\/A)?\*\*/g, '**GAP PERF-5C**');
  ok('PERF5B-PARSED-LEDGER-BINDING parses the Meetings ledger and rejects a four-dimension GAP mutant',
    JSON.stringify(ledgerVerdicts(meetingsLedgerRow)) === JSON.stringify(['OK/N/A', 'OK/N/A', 'OK', 'OK'])
      && ledgerVerdicts(gapLedgerMutant).some((verdict) => verdict === ''));

  global.customJS = previous.customJS;
  global.app = previous.app;
  console.log(`\nResult: ${pass} passed, ${fail} failed.`);
  if (fail) { console.log('Failures:'); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
})().catch((error) => { console.error(error); process.exit(1); });
