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

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const inst = new ProjectChromeBar();

// ── DOM stub ────────────────────────────────────────────────────────────────
// Minimal element supporting createEl (Obsidian) + appendChild/createElement
// (document.body path) + querySelector (returns null; no prior overlay).
function makeEl(tag) {
  const el = {
    tag,
    textContent: '',
    innerHTML: '',
    className: '',
    style: { cssText: '', setProperty() {} },
    children: [],
    onclick: null,
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
{
  const s = inst._surfaceSpec('docs-hub');
  ok('PCB-SPEC-3 docs-hub primary=new-doc + overflow[new-section,move-docs] + not leaf',
    s.primary && s.primary.id === 'new-doc' && s.leaf === false
      && s.overflow.some((o) => o.id === 'new-section')
      && s.overflow.some((o) => o.id === 'move-docs'));
}
{
  const s = inst._surfaceSpec('section-hub');
  ok('PCB-SPEC-4 section-hub primary=new-doc + overflow[new-subsection,move-docs]',
    s.primary && s.primary.id === 'new-doc' && s.leaf === false
      && s.overflow.some((o) => o.id === 'new-subsection')
      && s.overflow.some((o) => o.id === 'move-docs'));
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
  global.customJS = { SpaceNavButtons: { _dispatchAction: () => {} } };

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

    finish();
  })();
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
    SpaceNavButtons: { _dispatchAction: () => {} },
  };
  // _navEntries reads the registry via app.vault.adapter.read; supply a stub so
  // the Go ▾ click can build entries without throwing.
  global.app.vault = {
    adapter: { read: async () => JSON.stringify({ schema_version: 1, contributions: { project: [{ id: 'projects-hub', label: 'Projects', icon: 'projects', action: { type: 'openLink', target: 'spice/projects/Projects.md' } }] } }) },
    getAbstractFileByPath: () => ({}),
  };

  const restore = () => { global.app = prevApp; global.customJS = prevCustomJS; global.activeDocument = prevActiveDocument; };

  // PCB-RENDER-1 — doc-note (leaf): breadcrumb + Go ▾ + ⋯, NO primary.
  const doDocNote = () => {
    accentCalls.length = 0; popoverCalls.length = 0;
    const container = makeEl('div');
    const dv = {
      container,
      current: () => ({ file: { path: 'spice/projects/connectors/docs/Some Doc.md', name: 'Some Doc' }, type: 'doc-note' }),
    };
    return inst.render(dv).then(() => {
      const labels = accentCalls.map((c) => c.label);
      const hasGo = labels.some((l) => /Go/.test(l));
      const hasDots = labels.some((l) => l === '⋯');
      // NO primary button labelled New * on a leaf surface.
      const hasPrimary = labels.some((l) => /^New /.test(l) || /workstream/i.test(l) || /Add link/.test(l));
      const desc = allDescendants(container);
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
      const labels = accentCalls.map((c) => c.label);
      ok('PCB-RENDER-2a docs-hub renders primary "New Doc"', labels.some((l) => l === 'New Doc'));
      ok('PCB-RENDER-2b docs-hub renders a Go ▾ control', labels.some((l) => /Go/.test(l)));
      ok('PCB-RENDER-2c docs-hub renders a ⋯ overflow control', labels.some((l) => l === '⋯'));
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
      const goBtn = accentCalls.find((c) => /Go/.test(c.label));
      ok('PCB-RENDER-3a a Go ▾ control with an onClick exists', !!(goBtn && typeof goBtn.onClick === 'function'));
      if (goBtn && typeof goBtn.onClick === 'function') {
        await goBtn.onClick();
      }
      ok('PCB-RENDER-3b clicking Go ▾ calls MenuPopover.open exactly once', popoverCalls.length === 1);
      const passed = popoverCalls[0] && popoverCalls[0].entries;
      const hasMarkers = Array.isArray(passed)
        && passed.some((e) => e && e.section === 'This project')
        && passed.some((e) => e && e.section === 'Vault');
      ok('PCB-RENDER-3c Go ▾ entries include the section markers', hasMarkers);
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
    .then(doCrumbClick)
    .then(() => { restore(); summarize(); })
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
