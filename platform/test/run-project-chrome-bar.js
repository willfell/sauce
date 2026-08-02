#!/usr/bin/env node
/**
 * run-project-chrome-bar.js — ProjectChromeBar regression guard (Task 3).
 *
 * ProjectChromeBar is the single per-surface chrome renderer: one dv.view call
 * per project template that replaces Breadcrumb + SpaceNavButtons +
 * ProjectNavButtons + the action-row helper. It owns:
 *   • detectContext(filePath, dv)  — copied verbatim from ProjectNavButtons so
 *     the 15 project contexts classify identically.
 *   • _surfaceSpec(context)        — pure per-surface config { primary, overflow,
 *     leaf } driving which action buttons the bar shows.
 *   • _navEntries(dv, ctx)         — the `Go ▾` launcher entries: a
 *     { section:'This project' } marker + project destinations, then a
 *     { section:'Vault' } marker + vault destinations (current surface omitted).
 *   • render(dv)                   — builds ONE flex container: breadcrumb crumbs
 *     on the left, `Go ▾` + primary + `⋯` controls on the right.
 *
 * These cases lock the pure config, the launcher-entry shape, and the render
 * wiring (via DOM + customJS stubs) without the live Obsidian render path.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}

const ProjectChromeBar = loadClass(
  'platform/blueprints/project/helpers/project-chrome-bar.js',
  'ProjectChromeBar'
);
// The bar now delegates its render + Vault-section to the shared chrome-bar
// mechanism, which delegates ordering to nav-buttons. Load both REAL classes so
// the render + _navEntries cases exercise the true end-to-end wiring (not stubs).
const ChromeBar = loadClass('platform/mechanisms/chrome-bar/chrome-bar.js', 'ChromeBar');
const SpaceNavButtons = loadClass('platform/mechanisms/nav-buttons/space-nav-buttons.js', 'SpaceNavButtons');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const inst = new ProjectChromeBar();

// The async new-note flow test (PCB-DISPATCH-8) is defined inside the DISPATCH
// block but awaited from the render chain (so it runs before summarize()).
let dispatch8Fn = async () => {};

// ── DOM stub ────────────────────────────────────────────────────────────────
// Minimal element supporting createEl (Obsidian) + appendChild/createElement
// (document.body path) + querySelector (returns null; no prior overlay).
function makeEl(tag) {
  const classes = new Set();
  const el = {
    tag,
    textContent: '',
    innerHTML: '',
    style: { cssText: '', setProperty() {} },
    children: [],
    onclick: null,
  };
  Object.defineProperty(el, 'className', {
    get: () => [...classes].join(' '),
    set: (value) => {
      classes.clear();
      for (const name of String(value || '').split(/\s+/).filter(Boolean)) classes.add(name);
    },
  });
  el.classList = {
    add: (...names) => { for (const name of names) classes.add(name); },
    remove: (...names) => { for (const name of names) classes.delete(name); },
    contains: (name) => classes.has(name),
  };
  el.createEl = (t, opts) => {
    const c = makeEl(t);
    if (opts && opts.cls) c.className = opts.cls;
    if (opts && opts.text) c.textContent = opts.text;
    el.children.push(c);
    return c;
  };
  el.appendChild = (c) => { el.children.push(c); return c; };
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.getBoundingClientRect = () => ({ left: 0, bottom: 0, width: 100 });
  el.remove = () => {};
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  return el;
}

// Recursively collect all descendant elements (self excluded).
function allDescendants(el) {
  const out = [];
  for (const c of (el.children || [])) { out.push(c); out.push(...allDescendants(c)); }
  return out;
}

// ── PCB-SPEC-1..9 — _surfaceSpec(context) pure config ────────────────────────
{
  const s = inst._surfaceSpec('projects-hub');
  ok('PCB-SPEC-1 projects-hub primary=new-project + overflow[sort] + not leaf',
    s.primary && s.primary.id === 'new-project' && s.leaf === false
      && s.overflow.length === 1 && s.overflow[0].id === 'sort');
}
{
  const s = inst._surfaceSpec('project-hub');
  ok('PCB-SPEC-2 project-hub primary=new-task + overflow[new-doc] + not leaf',
    s.primary && s.primary.id === 'new-task' && s.leaf === false
      && s.overflow.some((o) => o.id === 'new-doc'));
}
// ── ARCHTOG-1..4 — Archive/Unarchive project (chrome-bar overflow + pure transform)
{
  const s = inst._surfaceSpec('project-hub');
  ok('ARCHTOG-1 project-hub overflow has archive-toggle',
    s.overflow.some((o) => o.id === 'archive-toggle'));
}
{
  const s = inst._surfaceSpec('project-todo');
  ok('ARCHTOG-1b project-todo overflow does NOT have archive-toggle',
    !s.overflow.some((o) => o.id === 'archive-toggle'));
}
{
  const fm = { status: 'in-progress' };
  ProjectChromeBar._applyArchiveToggle(fm, '2026-07-13');
  ok('ARCHTOG-2a status→archived', fm.status === 'archived');
  ok('ARCHTOG-2b pre_archive_status stashed', fm.pre_archive_status === 'in-progress');
  ok('ARCHTOG-2c status_changed_at set', fm.status_changed_at === '2026-07-13');
}
{
  const fm = { status: 'archived', pre_archive_status: 'planning' };
  ProjectChromeBar._applyArchiveToggle(fm, '2026-07-14');
  ok('ARCHTOG-3a status restored', fm.status === 'planning');
  ok('ARCHTOG-3b stash cleared', fm.pre_archive_status === undefined || fm.pre_archive_status === null);
  ok('ARCHTOG-3c status_changed_at set', fm.status_changed_at === '2026-07-14');
}
{
  const fm = { status: 'archived' };
  ProjectChromeBar._applyArchiveToggle(fm, '2026-07-15');
  ok('ARCHTOG-4 fallback to idea', fm.status === 'idea');
}

{
  const s = inst._surfaceSpec('docs-hub');
  ok('PCB-SPEC-3 docs-hub primary=new-doc + overflow[new-section,move-docs] + not leaf',
    s.primary && s.primary.id === 'new-doc' && s.leaf === false
      && s.overflow.some((o) => o.id === 'new-section')
      && s.overflow.some((o) => o.id === 'move-docs'));
  ok('PCB-SPEC-3b docs-hub overflow ALSO offers "Select docs" (root-level bulk move), keeping new-section + move-docs',
    s.overflow.some((o) => o.id === 'select-docs' && o.label === 'Select docs')
      && s.overflow.some((o) => o.id === 'new-section')
      && s.overflow.some((o) => o.id === 'move-docs'));
}
{
  const s = inst._surfaceSpec('section-hub');
  ok('PCB-SPEC-4 section-hub primary=new-doc + overflow[new-subsection, move-section, select-docs, delete-section]',
    s.primary && s.primary.id === 'new-doc' && s.leaf === false
      && s.overflow.some((o) => o.id === 'new-subsection')
      && s.overflow.some((o) => o.id === 'move-section')
      && s.overflow.some((o) => o.id === 'select-docs')
      && s.overflow.some((o) => o.id === 'delete-section'));
  ok('PCB-SPEC-4b section-hub drops the legacy "move-docs" bulk entry (converged on select-docs)',
    !s.overflow.some((o) => o.id === 'move-docs'));
}
{
  const s = inst._surfaceSpec('project-map');
  const rm = s.overflow.find((o) => o.id === 'remove-workstream');
  ok('PCB-SPEC-5 project-map primary=add-workstream + overflow[remove-workstream danger]',
    s.primary && s.primary.id === 'add-workstream' && s.leaf === false
      && rm && rm.danger === true);
}
{
  const s = inst._surfaceSpec('task-hub');
  ok('PCB-SPEC-6 task-hub primary=new-note + overflow[task-board] + not leaf',
    s.primary && s.primary.id === 'new-note' && s.leaf === false
      && s.overflow.some((o) => o.id === 'task-board'));
}
{
  const s = inst._surfaceSpec('links-hub');
  ok('PCB-SPEC-7 links-hub primary=add-link + overflow[manage-links] + not leaf',
    s.primary && s.primary.id === 'add-link' && s.leaf === false
      && s.overflow.some((o) => o.id === 'manage-links'));
}
{
  const s = inst._surfaceSpec('doc-note');
  ok('PCB-SPEC-8 doc-note leaf + primary=null + overflow[move-docs]',
    s.leaf === true && s.primary === null
      && s.overflow.length === 1 && s.overflow[0].id === 'move-docs');
}
{
  // project-board / task-board / task-board-card / task-note / default → leaf, no primary, no overflow.
  const bareCtxs = ['project-board', 'task-board', 'task-board-card', 'task-note', 'unknown'];
  const allLeaf = bareCtxs.every((c) => {
    const s = inst._surfaceSpec(c);
    return s.leaf === true && s.primary === null && Array.isArray(s.overflow) && s.overflow.length === 0;
  });
  ok('PCB-SPEC-9 board/task-note/default surfaces are bare leaves (no primary, no overflow)', allLeaf);
}

// ── PCB-OPEN-1..2 — _openNavTarget(path, dv) cold-cache-safe direct opens ─────
// Both the breadcrumb crumb click and the _navEntries `open()` helper route
// direct absolute-path opens through _openNavTarget so a cold metadata cache
// can't double-prefix the path (spice/projects/<slug>/spice/projects/<slug>/…).
// When the file resolves in the vault index we openFile() the TFile (bypassing
// the link resolver); only an unresolved path falls back to openLinkText.
{
  // PCB-OPEN-1 — resolvable path → getLeaf(false).openFile(file), NOT openLinkText.
  const fakeFile = { path: 'spice/projects/connectors/Connectors.md' };
  const openFileCalls = [];
  const openLinkCalls = [];
  const prevApp = global.app;
  global.app = {
    vault: { getAbstractFileByPath: (p) => (p === fakeFile.path ? fakeFile : null) },
    workspace: {
      getLeaf: () => ({ openFile: (f) => openFileCalls.push(f) }),
      openLinkText: (p) => openLinkCalls.push(p),
    },
  };
  const dv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md' } }) };
  inst._openNavTarget(fakeFile.path, dv);
  global.app = prevApp;
  ok('PCB-OPEN-1a resolvable path calls getLeaf().openFile with the TFile',
    openFileCalls.length === 1 && openFileCalls[0] === fakeFile);
  ok('PCB-OPEN-1b resolvable path does NOT call openLinkText (cold-cache safe)',
    openLinkCalls.length === 0);
}
{
  // PCB-OPEN-2 — unresolved path (getAbstractFileByPath → null) → openLinkText fallback.
  const openFileCalls = [];
  const openLinkCalls = [];
  const prevApp = global.app;
  global.app = {
    vault: { getAbstractFileByPath: () => null },
    workspace: {
      getLeaf: () => ({ openFile: (f) => openFileCalls.push(f) }),
      openLinkText: (p) => openLinkCalls.push(p),
    },
  };
  const dv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md' } }) };
  inst._openNavTarget('spice/projects/connectors/Connectors.md', dv);
  global.app = prevApp;
  ok('PCB-OPEN-2a unresolved path falls back to openLinkText',
    openLinkCalls.length === 1 && openLinkCalls[0] === 'spice/projects/connectors/Connectors.md');
  ok('PCB-OPEN-2b unresolved path does NOT call openFile', openFileCalls.length === 0);
}

// ── PCB-DISPATCH-1..* — _dispatch(dv, ctx, id) routes to existing helpers ─────
// Each case stubs the mapped customJS.<Helper> with a spy + a stub app/global,
// invokes _dispatch, and asserts the spy fired exactly once with expected args.
// The whole method is never-throw; the stubs let us prove the WIRING without the
// live helper bodies. Restores globals after each case.
{
  // Shared dispatch harness: run `fn(spies)` with the given customJS + app stubs
  // installed, restoring the prior globals afterward.
  const runDispatch = (customJSStub, appStub, fn) => {
    const prevApp = global.app;
    const prevCJS = global.customJS;
    const prevNotice = global.Notice;
    global.app = appStub || {};
    global.customJS = customJSStub || {};
    // Silence Notice (graceful-degrade path) without a real DOM.
    global.Notice = function Notice() {};
    try { fn(); } finally {
      global.app = prevApp; global.customJS = prevCJS; global.Notice = prevNotice;
    }
  };

  // PCB-DISPATCH-1 — move-docs on a doc-note → DocMoveDialog._openMoveDialog(dv, currentPath).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/Some Doc.md' } }) };
    runDispatch(
      { DocMoveDialog: { _openMoveDialog: (d, p) => calls.push({ d, p }) },
        DocBulkMoveActions: { _onBulkMove: () => calls.push({ bulk: true }) } },
      {},
      () => inst._dispatch(dv, { context: 'doc-note' }, 'move-docs')
    );
    ok('PCB-DISPATCH-1a move-docs on doc-note calls DocMoveDialog._openMoveDialog once',
      calls.length === 1 && !calls[0].bulk);
    ok('PCB-DISPATCH-1b …with the current doc path',
      calls.length === 1 && calls[0].p === 'spice/projects/connectors/docs/Some Doc.md');
  }

  // PCB-DISPATCH-2 — move-docs on docs-hub → DocBulkMoveActions._onBulkMove(dv).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md' } }) };
    runDispatch(
      { DocMoveDialog: { _openMoveDialog: () => calls.push({ single: true }) },
        DocBulkMoveActions: { _onBulkMove: (d) => calls.push({ d }) } },
      {},
      () => inst._dispatch(dv, { context: 'docs-hub' }, 'move-docs')
    );
    ok('PCB-DISPATCH-2 move-docs on docs-hub calls DocBulkMoveActions._onBulkMove once (not the single-doc dialog)',
      calls.length === 1 && !calls[0].single && calls[0].d === dv);
  }

  // PCB-DISPATCH-3 — add-link → ProjectLinksManager._onAdd(dv).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/Links Hub.md' } }) };
    runDispatch(
      { ProjectLinksManager: { _onAdd: (d) => calls.push({ add: d }), _onManage: () => calls.push({ manage: true }) } },
      {},
      () => inst._dispatch(dv, { context: 'links-hub' }, 'add-link')
    );
    ok('PCB-DISPATCH-3 add-link calls ProjectLinksManager._onAdd once with dv',
      calls.length === 1 && calls[0].add === dv);
  }

  // PCB-DISPATCH-3b — manage-links → ProjectLinksManager._onManage(dv).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/Links Hub.md' } }) };
    runDispatch(
      { ProjectLinksManager: { _onAdd: () => calls.push({ add: true }), _onManage: (d) => calls.push({ manage: d }) } },
      {},
      () => inst._dispatch(dv, { context: 'links-hub' }, 'manage-links')
    );
    ok('PCB-DISPATCH-3b manage-links calls ProjectLinksManager._onManage once with dv',
      calls.length === 1 && calls[0].manage === dv);
  }

  // PCB-DISPATCH-4 — add-workstream → ProjectWorkstreamManager.addWorkstream(dv).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/Connectors - Map.md' } }) };
    runDispatch(
      { ProjectWorkstreamManager: { addWorkstream: (d) => calls.push({ add: d }), removeWorkstream: () => calls.push({ remove: true }) } },
      {},
      () => inst._dispatch(dv, { context: 'project-map' }, 'add-workstream')
    );
    ok('PCB-DISPATCH-4a add-workstream calls ProjectWorkstreamManager.addWorkstream once with dv',
      calls.length === 1 && calls[0].add === dv);
  }

  // PCB-DISPATCH-4b — remove-workstream → ProjectWorkstreamManager.removeWorkstream(dv).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/Connectors - Map.md' } }) };
    runDispatch(
      { ProjectWorkstreamManager: { addWorkstream: () => calls.push({ add: true }), removeWorkstream: (d) => calls.push({ remove: d }) } },
      {},
      () => inst._dispatch(dv, { context: 'project-map' }, 'remove-workstream')
    );
    ok('PCB-DISPATCH-4b remove-workstream calls ProjectWorkstreamManager.removeWorkstream once with dv',
      calls.length === 1 && calls[0].remove === dv);
  }

  // PCB-DISPATCH-5 — new-task → TaskDialog.open({ surface:'project', project:{name,slug} }).
  {
    const calls = [];
    // The note carries project_slug; the hub note supplies the display name.
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/Connectors.md' }, project_slug: 'connectors' }) };
    runDispatch(
      { TaskDialog: { open: (o) => calls.push(o) } },
      { vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null } },
      () => inst._dispatch(dv, { context: 'project-hub', projectDir: 'spice/projects/connectors', projectSlug: 'connectors' }, 'new-task')
    );
    ok('PCB-DISPATCH-5a new-task calls TaskDialog.open exactly once', calls.length === 1);
    ok('PCB-DISPATCH-5b …with surface:"project"', calls.length === 1 && calls[0].surface === 'project');
    ok('PCB-DISPATCH-5c …carrying a project identity { name, slug } (slug from project_slug)',
      calls.length === 1 && calls[0].project && calls[0].project.slug === 'connectors'
        && typeof calls[0].project.name === 'string');
  }

  // PCB-DISPATCH-6 — task-board (board absent) → ProjectNavButtons._createTaskBoard(projectDir, taskFolder).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/tasks/rollout/rollout.md' } }) };
    runDispatch(
      { ProjectNavButtons: { _createTaskBoard: (dir, folder) => { calls.push({ dir, folder }); return Promise.resolve(`${dir}/tasks/${folder}/board/${folder}-board.md`); } } },
      { vault: { getAbstractFileByPath: () => null }, workspace: { openLinkText: () => {} } },
      () => inst._dispatch(dv, { context: 'task-hub', projectDir: 'spice/projects/connectors', projectSlug: 'connectors', taskFolder: 'rollout' }, 'task-board')
    );
    ok('PCB-DISPATCH-6a task-board (absent) calls ProjectNavButtons._createTaskBoard once',
      calls.length === 1);
    ok('PCB-DISPATCH-6b …with (projectDir, taskFolder)',
      calls.length === 1 && calls[0].dir === 'spice/projects/connectors' && calls[0].folder === 'rollout');
  }

  // PCB-DISPATCH-6c — task-board (board EXISTS) → opens it, does NOT re-create.
  {
    const boardPath = 'spice/projects/connectors/tasks/rollout/board/rollout-board.md';
    const opened = [];
    const created = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/tasks/rollout/rollout.md' } }) };
    runDispatch(
      { ProjectNavButtons: { _createTaskBoard: (dir, folder) => { created.push({ dir, folder }); return Promise.resolve(null); } } },
      { vault: { getAbstractFileByPath: (p) => (p === boardPath ? {} : null) }, workspace: { openLinkText: (p) => opened.push(p) } },
      () => inst._dispatch(dv, { context: 'task-hub', projectDir: 'spice/projects/connectors', projectSlug: 'connectors', taskFolder: 'rollout' }, 'task-board')
    );
    ok('PCB-DISPATCH-6c existing board opens (openLinkText) and does NOT re-create',
      opened.length === 1 && opened[0] === boardPath && created.length === 0);
  }

  // PCB-DISPATCH-7 — entity-create ids route through EntityCreate.create({instance, dv, presetPrompts?}).
  {
    const calls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md' } }) };
    const cjs = { EntityCreate: { create: (o) => calls.push(o) } };
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'docs-hub' }, 'new-doc'));
    ok('PCB-DISPATCH-7a new-doc calls EntityCreate.create with instance:"doc-note" + dv',
      calls.length === 1 && calls[0].instance === 'doc-note' && calls[0].dv === dv);

    calls.length = 0;
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'docs-hub' }, 'new-section'));
    ok('PCB-DISPATCH-7b new-section calls EntityCreate.create with instance:"section-hub"',
      calls.length === 1 && calls[0].instance === 'section-hub');

    // new-doc on a docs-hub → NO presetPrompts (the user picks the section).
    ok('PCB-DISPATCH-7a2 new-doc on docs-hub passes NO presetPrompts',
      calls.length === 1 && !('presetPrompts' in calls[0]));

    // new-doc on a section-hub (depth 1) → seed the current section so the doc
    // lands there without re-prompting (byte-faithful to section-hub.js).
    calls.length = 0;
    const secDv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/knowledge/Knowledge.md', name: 'Knowledge' }, section: 'Knowledge', section_slug: 'knowledge', depth: 1 }) };
    runDispatch(cjs, {}, () => inst._dispatch(secDv, { context: 'section-hub', sectionSlug: 'knowledge' }, 'new-doc'));
    ok('PCB-DISPATCH-7a3 new-doc on section-hub seeds presetPrompts.section_slug of the current section',
      calls.length === 1 && calls[0].instance === 'doc-note'
        && calls[0].presetPrompts && calls[0].presetPrompts.section_slug === 'knowledge'
        && calls[0].presetPrompts.section === 'Knowledge');

    calls.length = 0;
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'section-hub', sectionSlug: 'knowledge' }, 'new-subsection'));
    ok('PCB-DISPATCH-7c new-subsection calls EntityCreate.create with instance:"sub-section-hub" + presetPrompts.parent_slug',
      calls.length === 1 && calls[0].instance === 'sub-section-hub'
        && calls[0].presetPrompts && calls[0].presetPrompts.parent_slug === 'knowledge');

    calls.length = 0;
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'projects-hub' }, 'new-project'));
    ok('PCB-DISPATCH-7d new-project calls EntityCreate.create with instance:"project"',
      calls.length === 1 && calls[0].instance === 'project');
  }

  // PCB-DISPATCH-8 — new-note (task-hub) → ProjectNavButtons prompt + create.
  // _createTaskNoteFlow is async; call + await it directly (via the async harness
  // pushed to dispatch8) so the assertions are deterministic, not microtask-racy.
  dispatch8Fn = async () => {
    const promptCalls = [];
    const createCalls = [];
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/tasks/rollout/rollout.md' } }) };
    const prevApp = global.app;
    const prevCJS = global.customJS;
    const prevNotice = global.Notice;
    global.app = { workspace: { openLinkText: () => {} } };
    global.customJS = { ProjectNavButtons: {
      _promptForTitle: (folder) => { promptCalls.push(folder); return Promise.resolve('My Note'); },
      _createTaskNote: (notesFolder, title, slug, taskFolder, hubPath, dir) => { createCalls.push({ notesFolder, title, slug, taskFolder, hubPath, dir }); return Promise.resolve(`${notesFolder}/${title}.md`); },
    } };
    global.Notice = function Notice() {};
    try {
      await inst._createTaskNoteFlow(dv, { context: 'task-hub', projectDir: 'spice/projects/connectors', projectSlug: 'connectors', taskFolder: 'rollout' });
    } finally {
      global.app = prevApp; global.customJS = prevCJS; global.Notice = prevNotice;
    }
    ok('PCB-DISPATCH-8a new-note calls ProjectNavButtons._promptForTitle with the notes folder',
      promptCalls.length === 1 && promptCalls[0] === 'spice/projects/connectors/tasks/rollout/notes');
    ok('PCB-DISPATCH-8b new-note calls ProjectNavButtons._createTaskNote with title + notes folder',
      createCalls.length === 1 && createCalls[0].title === 'My Note'
        && createCalls[0].notesFolder === 'spice/projects/connectors/tasks/rollout/notes'
        && createCalls[0].hubPath === 'spice/projects/connectors/tasks/rollout/rollout.md');
  };

  // PCB-DISPATCH-9 — sort (projects-hub) → flips the persisted ProjectsHubCards mode.
  {
    const store = {};
    const prevLS = global.localStorage;
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    const cmdCalls = [];
    runDispatch(
      {},
      { commands: { executeCommandById: (id) => cmdCalls.push(id) } },
      () => {
        // default (unset) → 'mtime'; toggling once persists 'alpha'.
        inst._dispatch({}, { context: 'projects-hub' }, 'sort');
      }
    );
    global.localStorage = prevLS;
    ok('PCB-DISPATCH-9a sort flips the persisted sort mode to "alpha" (from the mtime default)',
      store['sauce.projects-hub.sort'] === 'alpha');
    ok('PCB-DISPATCH-9b sort forces a Dataview refresh so the hub re-renders',
      cmdCalls.includes('dataview:dataview-force-refresh-views'));
  }

  // PCB-DISPATCH-10 — a missing helper degrades gracefully (never throws).
  {
    let threw = false;
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/Links Hub.md' } }) };
    try {
      runDispatch({}, {}, () => inst._dispatch(dv, { context: 'links-hub' }, 'add-link'));
    } catch (_e) { threw = true; }
    ok('PCB-DISPATCH-10 a missing helper (cold-load) does NOT throw', !threw);
  }

  // PCB-DISPATCH-11..13 — section-hub overflow routes to the shared SectionExplorer.
  // The section-hub note supplies type/depth/section/section_slug/project_slug; the
  // dispatch builds an adapter via SectionHub._buildConfig + SectionExplorer.makeAdapter
  // and a section descriptor from the current file, then calls the shared entry point.
  const sectionHubStub = () => ({
    SectionHub: {
      _buildConfig: (...args) => ({ __cfg: true, __args: args }),
      _stripLink: (v) => (typeof v === 'string' ? v : ''),
    },
    SectionExplorer: {
      makeAdapter: (cfg) => ({ __adapter: true, cfg }),
    },
  });
  const sectionHubDv = () => ({
    current: () => ({
      type: 'section-hub',
      depth: 1,
      section: 'Knowledge',
      section_slug: 'knowledge',
      project_slug: 'connectors',
      file: { path: 'spice/projects/connectors/docs/knowledge/Knowledge.md', name: 'Knowledge' },
    }),
  });

  // PCB-DISPATCH-11 — select-docs → SectionExplorer.openSelectDocsPicker(dv, adapter, section).
  {
    const calls = [];
    const cjs = sectionHubStub();
    cjs.SectionExplorer.openSelectDocsPicker = (d, adapter, section) => calls.push({ d: d === undefined ? false : !!d, section: !!section });
    const dv = sectionHubDv();
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'section-hub' }, 'select-docs'));
    ok('PCB-DISPATCH-11 select-docs calls SectionExplorer.openSelectDocsPicker once with dv+section',
      calls.length === 1 && calls[0].d === true && calls[0].section === true);
  }

  // PCB-DISPATCH-12 — move-section → SectionExplorer._openMovePickerForSection(dv, adapter, section).
  {
    const calls = [];
    const cjs = sectionHubStub();
    cjs.SectionExplorer._openMovePickerForSection = (d, adapter, section) => calls.push({ d, adapter, section });
    const dv = sectionHubDv();
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'section-hub' }, 'move-section'));
    ok('PCB-DISPATCH-12a move-section calls SectionExplorer._openMovePickerForSection once',
      calls.length === 1 && calls[0].d === dv);
    ok('PCB-DISPATCH-12b …with an adapter built from makeAdapter(_buildConfig(...))',
      calls.length === 1 && calls[0].adapter && calls[0].adapter.__adapter === true && calls[0].adapter.cfg && calls[0].adapter.cfg.__cfg === true);
    ok('PCB-DISPATCH-12c …and a section descriptor { folder, hubPath, title } from the current note',
      calls.length === 1 && calls[0].section
        && calls[0].section.folder === 'spice/projects/connectors/docs/knowledge'
        && calls[0].section.hubPath === 'spice/projects/connectors/docs/knowledge/Knowledge.md'
        && calls[0].section.title === 'Knowledge');
  }

  // PCB-DISPATCH-13 — delete-section → SectionExplorer._openDeleteConfirm(dv, adapter, section).
  {
    const calls = [];
    const cjs = sectionHubStub();
    cjs.SectionExplorer._openDeleteConfirm = (d, adapter, section) => calls.push({ d, adapter, section });
    const dv = sectionHubDv();
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'section-hub' }, 'delete-section'));
    ok('PCB-DISPATCH-13 delete-section calls SectionExplorer._openDeleteConfirm once with (dv, adapter, section)',
      calls.length === 1 && calls[0].d === dv && calls[0].adapter && calls[0].adapter.__adapter === true
        && calls[0].section && calls[0].section.hubPath === 'spice/projects/connectors/docs/knowledge/Knowledge.md');
  }

  // PCB-DISPATCH-14 — select-docs on the Docs ATLAS ROOT (docs-hub) resolves a
  // docs-root adapter (built from SectionHub._buildDocsRootConfig) and calls
  // SectionExplorer.openSelectDocsPicker(dv, adapter, null). section === null so
  // the picker enumerates docs directly under the docs root folder.
  {
    const calls = [];
    const cjs = {
      SectionHub: {
        _buildDocsRootConfig: (dv2, projectSlug) => ({
          rootClass: 'se-root',
          icons: { folder: '', file: '' },
          listSections: () => [],
          listPages: () => [],
          move: { root: `spice/projects/${projectSlug}/docs`, docType: 'doc-note', rewriteOnDocMove: () => ({ section: '', sub_section: '' }) },
        }),
      },
      SectionExplorer: {
        makeAdapter: (cfg) => ({ __adapter: true, move: cfg.move }),
        openSelectDocsPicker: (d, adapter, section) => calls.push({ d, adapter, section }),
      },
    };
    const dv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md', name: 'Docs' }, type: 'docs-hub' }) };
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'docs-hub', projectSlug: 'connectors', projectDir: 'spice/projects/connectors' }, 'select-docs'));
    ok('PCB-DISPATCH-14a select-docs on docs-hub calls SectionExplorer.openSelectDocsPicker once with dv',
      calls.length === 1 && calls[0].d === dv);
    ok('PCB-DISPATCH-14b …with section === null (root-level bulk move)',
      calls.length === 1 && calls[0].section === null);
    ok('PCB-DISPATCH-14c …and a docs-root adapter whose move.root ends in "/docs"',
      calls.length === 1 && calls[0].adapter && calls[0].adapter.move
        && /\/docs$/.test(String(calls[0].adapter.move.root)));
  }
}

// ── PCB-NAV-1 — _navEntries(dv, ctx) launcher entries ────────────────────────
{
  // Small registry with two openLink vault destinations + one non-openLink.
  const registryJson = JSON.stringify({
    schema_version: 1,
    contributions: {
      project: [{ id: 'projects-hub', label: 'Projects', icon: 'projects', order: 100, action: { type: 'openLink', target: 'spice/projects/Projects.md' } }],
      'to-do': [{ id: 'todo-today', label: 'To Do', icon: 'todo', order: 110, action: { type: 'runTemplaterTemplate', template_source: 'x' } }],
    },
  });

  // Stub globals for the duration of the async call.
  const openedLinks = [];
  const prevApp = global.app;
  const prevCustomJS = global.customJS;
  global.app = {
    isMobile: false,
    vault: {
      adapter: { read: async (p) => (p === 'ranch/nav-buttons-registry.json' ? registryJson : (() => { throw new Error('ENOENT'); })()) },
      getAbstractFileByPath: () => ({}), // every candidate destination "exists"
    },
    workspace: { openLinkText: (p) => openedLinks.push(p) },
  };
  global.customJS = { ChromeBar: new ChromeBar(), SpaceNavButtons: new SpaceNavButtons() };

  const ctx = {
    context: 'docs-hub',
    projectSlug: 'connectors',
    projectDir: 'spice/projects/connectors',
  };
  // mainNote resolution: ProjectChromeBar._navEntries computes project targets
  // from ctx.projectDir; a stubbed getAbstractFileByPath makes all exist.
  const dv = { current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md' } }) };

  (async () => {
    const entries = await inst._navEntries(dv, ctx);
    global.app = prevApp;
    global.customJS = prevCustomJS;

    const projIdx = entries.findIndex((e) => e && e.section === 'This project');
    const vaultIdx = entries.findIndex((e) => e && e.section === 'Vault');
    ok('PCB-NAV-1a has a "This project" section marker', projIdx >= 0);
    ok('PCB-NAV-1b has a "Vault" section marker after the project marker', vaultIdx > projIdx);
    ok('PCB-NAV-1g the "Vault" marker requests MenuPopover\'s 2-column grid layout (long list)',
      entries[vaultIdx] && entries[vaultIdx].layout === 'grid');

    const projEntries = entries.slice(projIdx + 1, vaultIdx).filter((e) => e && !('section' in e));
    const vaultEntries = entries.slice(vaultIdx + 1).filter((e) => e && !('section' in e));
    ok('PCB-NAV-1c >= 2 project destinations', projEntries.length >= 2);
    ok('PCB-NAV-1d >= 1 vault destination', vaultEntries.length >= 1);
    ok('PCB-NAV-1e project entries carry onSelect handlers',
      projEntries.every((e) => typeof e.onSelect === 'function'));

    // Current surface (docs-hub → Docs) must be omitted from project entries.
    const docsHubPath = 'spice/projects/connectors/docs/Docs.md';
    const hasCurrentDest = projEntries.some((e) => e._navTarget === docsHubPath || e.label === 'Docs');
    ok('PCB-NAV-1f current surface (Docs) omitted from project destinations', !hasCurrentDest);

    await runNav2();
    await runNav3();
    finish();
  })();
}

// ── PCB-NAV-2 — vault destination icons resolve via customJS.Icons ──────────
// Regression: the "home" vault destination's icon came back blank in the real
// Go ▾ launcher because Icons had no Tier-1 entry for "home" (unlike to-do/
// scratch/project/meetings, which all did) — _navEntries' iconFor() degrades
// to "" on any resolve failure, so the button silently rendered no icon at
// all (not an error, just a blank slot). Lock that a registered Icons.resolve
// is actually consulted per vault entry and its result flows through.
async function runNav2() {
  const registryJson = JSON.stringify({
    schema_version: 1,
    contributions: {
      home: [{ id: 'home-open', label: 'Home', icon: 'home', order: 40, action: { type: 'invoke_command', command_id: 'homepage:open-homepage' } }],
    },
  });
  const prevApp = global.app;
  const prevCustomJS = global.customJS;
  global.app = {
    isMobile: false,
    vault: {
      adapter: { read: async (p) => (p === 'ranch/nav-buttons-registry.json' ? registryJson : (() => { throw new Error('ENOENT'); })()) },
      getAbstractFileByPath: () => null,
    },
    workspace: { openLinkText: () => {} },
  };
  const resolveCalls = [];
  global.customJS = {
    ChromeBar: new ChromeBar(),
    SpaceNavButtons: new SpaceNavButtons(),
    Icons: { resolve: (name) => { resolveCalls.push(name); return name === 'home' ? '<svg>home</svg>' : null; } },
  };

  const ctx = { context: 'projects-hub' };
  const dv = { current: () => ({ file: { path: 'spice/projects/Projects.md' } }) };
  const entries = await inst._navEntries(dv, ctx);
  global.app = prevApp;
  global.customJS = prevCustomJS;

  const homeEntry = entries.find((e) => e && e.label === 'Home');
  ok('PCB-NAV-2a Icons.resolve is consulted for the "home" vault destination', resolveCalls.includes('home'));
  ok('PCB-NAV-2b the "Home" launcher entry carries a non-empty icon',
    !!(homeEntry && homeEntry.icon && homeEntry.icon.length > 0), `got icon=${JSON.stringify(homeEntry && homeEntry.icon)}`);
}

// ── PCB-NAV-3 — Vault section lists EVERY registered source, not just
// SpaceNavButtons' 5 PINNED_SOURCES. That pin list exists only because
// SpaceNavButtons' vault-wide nav bar is a fixed 3x2 grid with limited visible
// slots; the Go ▾ launcher is already a plain dropdown with no such
// constraint, so daily/cowork/people/wiki/reader (previously entirely absent)
// must appear alongside home/to-do/scratch/project/meetings, ordered by
// (order, source, id) — the same ordering SpaceNavButtons itself uses.
async function runNav3() {
  const registryJson = JSON.stringify({
    schema_version: 1,
    contributions: {
      project:  [{ id: 'projects-hub', label: 'Projects', icon: 'projects', order: 100, action: { type: 'openLink', target: 'spice/projects/Projects.md' } }],
      daily:    [{ id: 'daily-open', label: 'Daily', icon: 'daily', order: 50, action: { type: 'openLink', target: 'spice/daily/Daily.md' } }],
      meetings: [{ id: 'meetings-open', label: 'Meetings', icon: 'meetings', order: 120, action: { type: 'openLink', target: 'spice/meetings/Meetings.md' } }],
      scratch:  [{ id: 'scratch-open', label: 'Scratch', icon: 'scratch', order: 130, action: { type: 'openLink', target: 'spice/scratch/Scratch.md' } }],
      cowork:   [{ id: 'cowork-open', label: 'Cowork', icon: 'briefcase', order: 51, action: { type: 'openLink', target: 'spice/cowork/Cowork.md' } }],
      people:   [{ id: 'people-open', label: 'People', icon: 'people', order: 60, action: { type: 'openLink', target: 'spice/people/People.md' } }],
      'to-do':  [{ id: 'todo-today', label: 'To Do', icon: 'todo', order: 110, action: { type: 'openLink', target: 'spice/to-do/Today To-Do.md' } }],
      wiki:     [{ id: 'wiki-open', label: 'Wiki', icon: 'journal', order: 135, action: { type: 'openLink', target: 'spice/wiki/Wiki.md' } }],
      home:     [{ id: 'home-open', label: 'Home', icon: 'home', order: 40, action: { type: 'invoke_command', command_id: 'homepage:open-homepage' } }],
      reader:   [{ id: 'reader-open', label: 'Reader', icon: 'book-open', order: 140, action: { type: 'openLink', target: 'spice/reader/Reader.md' } }],
    },
  });
  const prevApp = global.app;
  const prevCustomJS = global.customJS;
  global.app = {
    isMobile: false,
    vault: {
      adapter: { read: async (p) => (p === 'ranch/nav-buttons-registry.json' ? registryJson : (() => { throw new Error('ENOENT'); })()) },
      getAbstractFileByPath: () => null,
    },
    workspace: { openLinkText: () => {} },
  };
  global.customJS = { ChromeBar: new ChromeBar(), SpaceNavButtons: new SpaceNavButtons(), Icons: { resolve: () => '<svg/>' } };

  const ctx = { context: 'projects-hub' };
  const dv = { current: () => ({ file: { path: 'spice/projects/Projects.md' } }) };
  const entries = await inst._navEntries(dv, ctx);
  global.app = prevApp;
  global.customJS = prevCustomJS;

  const vaultIdx = entries.findIndex((e) => e && e.section === 'Vault');
  const vaultEntries = entries.slice(vaultIdx + 1).filter((e) => e && !('section' in e));
  const labels = vaultEntries.map((e) => e.label);
  const expectedAll = ['Home', 'Daily', 'Cowork', 'People', 'Projects', 'To Do', 'Meetings', 'Scratch', 'Wiki', 'Reader'];
  ok('PCB-NAV-3a Vault section includes all 10 registered sources (not just the 5 SpaceNavButtons pins)',
    expectedAll.every((l) => labels.includes(l)), `got ${JSON.stringify(labels)}`);
  ok('PCB-NAV-3b Vault section is ordered by (order, source, id), matching SpaceNavButtons',
    JSON.stringify(labels) === JSON.stringify(expectedAll), `got ${JSON.stringify(labels)}`);
}

// ── render() cases run after the async NAV block; defer the summary. ──────────
function runRenderCases() {
  // Shared customJS + app stubs for render(). AccentButton.render is spied.
  const accentCalls = [];
  const popoverCalls = [];
  const prevApp = global.app;
  const prevCustomJS = global.customJS;
  const prevActiveDocument = global.activeDocument;

  const docBody = makeEl('body');
  global.activeDocument = {
    body: docBody,
    createElement: (t) => makeEl(t),
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  // workspace.getLeaf(false).openFile(file) is the cold-cache-safe direct-open
  // path (_openNavTarget); openBreadcrumbFiles records TFiles opened that way so
  // the breadcrumb-click integration case can assert it routed correctly.
  const openBreadcrumbFiles = [];
  global.app = {
    isMobile: false,
    workspace: {
      openLinkText: () => {},
      getLeaf: () => ({ openFile: (f) => openBreadcrumbFiles.push(f) }),
    },
  };
  global.customJS = {
    RenderSafe: { page: (dv) => (dv && dv.current ? dv.current() : null) },
    SectionLabel: { divider: () => {} },
    Breadcrumb: {
      buildSegments: async () => ([
        { label: 'Projects', link: 'spice/projects/Projects.md' },
        { label: 'Connectors', link: 'spice/projects/connectors/Connectors.md' },
        { label: 'Docs', link: null },
      ]),
    },
    AccentButton: {
      render: (parent, opts) => {
        accentCalls.push(opts);
        const btn = makeEl('button');
        btn.__label = opts.label;
        btn.__onClick = opts.onClick;
        parent.appendChild(btn);
        return btn;
      },
    },
    MenuPopover: { open: (entries, opts) => { popoverCalls.push({ entries, opts }); return makeEl('div'); } },
    // The bar delegates its render to the REAL ChromeBar, which delegates the
    // Vault section to the REAL SpaceNavButtons.firstEntryPerSource — load both so
    // the render cases exercise true end-to-end wiring + byte-identical DOM.
    ChromeBar: new ChromeBar(),
    SpaceNavButtons: new SpaceNavButtons(),
    Icons: { resolve: () => '<svg/>' },
  };
  // _navEntries reads the registry via app.vault.adapter.read; supply a stub so
  // the Go ▾ click can build entries without throwing.
  global.app.vault = {
    adapter: { read: async () => JSON.stringify({ schema_version: 1, contributions: { project: [{ id: 'projects-hub', label: 'Projects', icon: 'projects', action: { type: 'openLink', target: 'spice/projects/Projects.md' } }] } }) },
    getAbstractFileByPath: () => ({}),
  };

  const restore = () => { global.app = prevApp; global.customJS = prevCustomJS; global.activeDocument = prevActiveDocument; };

  // The bar's 3 controls (Go ▾ / primary / ⋯) are rendered via the bar's own
  // _renderChromeButton (icon-first, Go/⋯ icon-only — no "Go"/"⋯" text), NOT
  // customJS.AccentButton, so render-case detection below finds them by their
  // pcb-btn-{go,primary,dots} class in the real DOM tree rather than spying on
  // accentCalls labels.
  const findByVariant = (container, variant) =>
    allDescendants(container).find((e) => e.className && String(e.className).includes(`pcb-btn-${variant}`));

  // PCB-RENDER-1 — doc-note (leaf): breadcrumb + Go ▾ + ⋯, NO primary.
  const doDocNote = () => {
    accentCalls.length = 0; popoverCalls.length = 0;
    const container = makeEl('div');
    const dv = {
      container,
      current: () => ({ file: { path: 'spice/projects/connectors/docs/Some Doc.md', name: 'Some Doc' }, type: 'doc-note' }),
    };
    return inst.render(dv).then(() => {
      const desc = allDescendants(container);
      const hasGo = !!findByVariant(container, 'go');
      const hasDots = !!findByVariant(container, 'dots');
      const hasPrimary = !!findByVariant(container, 'primary');
      const hasBreadcrumbDiv = desc.some((e) => e.className && String(e.className).includes('project-breadcrumb'));
      ok('PCB-RENDER-1a doc-note renders a Go ▾ control', hasGo);
      ok('PCB-RENDER-1b doc-note renders a ⋯ overflow control', hasDots);
      ok('PCB-RENDER-1c doc-note renders NO primary button (leaf)', !hasPrimary);
      ok('PCB-RENDER-1d doc-note renders a breadcrumb sub-div', hasBreadcrumbDiv);
    });
  };

  // PCB-RENDER-2 — docs-hub: primary "New Doc" + ⋯ + Go ▾.
  const doDocsHub = () => {
    accentCalls.length = 0; popoverCalls.length = 0;
    const container = makeEl('div');
    const dv = {
      container,
      current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md', name: 'Docs' }, type: 'docs-hub' }),
    };
    return inst.render(dv).then(() => {
      const primaryBtn = findByVariant(container, 'primary');
      ok('PCB-RENDER-2a docs-hub renders primary "New Doc"',
        !!primaryBtn && String(primaryBtn.innerHTML).includes('New Doc'));
      ok('PCB-RENDER-2b docs-hub renders a Go ▾ control', !!findByVariant(container, 'go'));
      ok('PCB-RENDER-2c docs-hub renders a ⋯ overflow control', !!findByVariant(container, 'dots'));
    });
  };

  // PCB-RENDER-3 — clicking Go ▾ calls MenuPopover.open once with section markers.
  const doGoClick = () => {
    accentCalls.length = 0; popoverCalls.length = 0;
    const container = makeEl('div');
    const dv = {
      container,
      current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md', name: 'Docs' }, type: 'docs-hub' }),
    };
    return inst.render(dv).then(async () => {
      const goBtn = findByVariant(container, 'go');
      ok('PCB-RENDER-3a a Go ▾ control with an onClick exists', !!(goBtn && typeof goBtn.onclick === 'function'));
      if (goBtn && typeof goBtn.onclick === 'function') {
        await goBtn.onclick();
      }
      ok('PCB-RENDER-3b clicking Go ▾ calls MenuPopover.open exactly once', popoverCalls.length === 1);
      const passed = popoverCalls[0] && popoverCalls[0].entries;
      const hasMarkers = Array.isArray(passed)
        && passed.some((e) => e && e.section === 'This project')
        && passed.some((e) => e && e.section === 'Vault');
      ok('PCB-RENDER-3c Go ▾ entries include the section markers', hasMarkers);
    });
  };

  // PCB-STYLE-1 — the bar's visual redesign: icon-only Go/⋯ (no "Go"/"⋯" text),
  // a header→content gap (≥10px root bottom margin), and the hover-lift +
  // press-scale micro-motion (sauce-core classes + handler wiring) on all 3
  // controls, mirroring the Home "+" button's animated feel without inline CSS.
  const doStyleChecks = () => {
    accentCalls.length = 0; popoverCalls.length = 0;
    const container = makeEl('div');
    const dv = {
      container,
      current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md', name: 'Docs' }, type: 'docs-hub' }),
    };
    return inst.render(dv).then(() => {
      const root = container.children.find((e) => e.className && String(e.className).includes('pcb-root'));
      ok('PCB-STYLE-1a .pcb-root carries a >= 10px bottom margin (header→content gap)',
        !!root && /margin-bottom:\s*(\d+)px/.exec(root.style.cssText) && Number(/margin-bottom:\s*(\d+)px/.exec(root.style.cssText)[1]) >= 10);

      const goBtn = findByVariant(container, 'go');
      const dotsBtn = findByVariant(container, 'dots');
      const primaryBtn = findByVariant(container, 'primary');
      ok('PCB-STYLE-1b Go ▾ control is icon-only — no "Go" text in its markup',
        !!goBtn && !/>Go</.test(goBtn.innerHTML) && !/^Go$/.test(String(goBtn.innerHTML).trim()));
      ok('PCB-STYLE-1c ⋯ control is icon-only — no literal "⋯" glyph in its markup',
        !!dotsBtn && !dotsBtn.innerHTML.includes('⋯'));
      ok('PCB-STYLE-1d all 3 controls delegate presentation to sauce-core classes',
        [goBtn, dotsBtn, primaryBtn].every((b) => b
          && b.classList.contains('sauce-btn') && b.classList.contains('sauce-chrome-btn')
          && b.style.cssText === ''));
      ok('PCB-STYLE-1e all 3 controls wire hover-lift + press-scale handlers',
        [goBtn, dotsBtn, primaryBtn].every((b) => b
          && typeof b.onmouseenter === 'function' && typeof b.onmousedown === 'function' && typeof b.onmouseup === 'function'));
    });
  };

  // PCB-OPEN-3 — clicking an ancestor breadcrumb crumb routes through
  // _openNavTarget (getLeaf().openFile), NOT the raw openLinkText — proving the
  // cold-cache doubled-path fix is wired into the real render path.
  const doCrumbClick = () => {
    accentCalls.length = 0; popoverCalls.length = 0; openBreadcrumbFiles.length = 0;
    const container = makeEl('div');
    const dv = {
      container,
      current: () => ({ file: { path: 'spice/projects/connectors/docs/Docs.md', name: 'Docs' }, type: 'docs-hub' }),
    };
    return inst.render(dv).then(() => {
      // Ancestor crumbs render as <a> with an onclick; the current crumb ("Docs")
      // is a plain <span> (link:null). Grab the first crumb <a>.
      const crumbAnchor = allDescendants(container)
        .find((e) => e.tag === 'a' && typeof e.onclick === 'function');
      ok('PCB-OPEN-3a ancestor breadcrumb crumb is a clickable <a>', !!crumbAnchor);
      if (crumbAnchor) crumbAnchor.onclick({ preventDefault() {} });
      ok('PCB-OPEN-3b breadcrumb click routes through openFile (getLeaf), not openLinkText',
        openBreadcrumbFiles.length === 1);
    });
  };

  return doDocNote()
    .then(doDocsHub)
    .then(doGoClick)
    .then(doStyleChecks)
    .then(doCrumbClick)
    .then(() => { restore(); return dispatch8Fn(); })
    .then(() => { summarize(); })
    .catch((e) => { restore(); console.error('render case threw:', e && e.stack || e); results.push(['render-cases-threw', false]); summarize(); });
}

// After the NAV async block resolves, kick off the render cases.
let finished = false;
function finish() { if (finished) return; finished = true; runRenderCases(); }

function summarize() {
  const failed = results.filter(([, c]) => !c);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
  process.exit(0);
}
