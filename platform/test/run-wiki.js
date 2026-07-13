#!/usr/bin/env node
/**
 * run-wiki.js — behavioral harness for WikiTree / WikiMove / WikiLeafActions.
 * Uses the new Function(SRC + "\nreturn ClassName;")() load pattern to replicate
 * the CustomJS eval-expression loader.  Exercises PURE helpers only (no full DOM
 * required for logic asserts).
 *
 * Asserts W1–W6 per Docs/plans/2026-07-01-wiki-blueprint-plan.md § Task D4.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..', '..');
const TREE_SRC  = path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-tree.js');
const MOVE_SRC  = path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-move.js');
const LEAF_SRC  = path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-leaf-actions.js');
const SE_SRC    = path.join(ROOT, 'platform', 'mechanisms', 'section-explorer', 'section-explorer.js');

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
function loadClass(srcPath, className) {
  const src = fs.readFileSync(srcPath, 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}

const WikiTree         = loadClass(TREE_SRC,  'WikiTree');
const WikiMove         = loadClass(MOVE_SRC,  'WikiMove');
const WikiLeafActions  = loadClass(LEAF_SRC,  'WikiLeafActions');

// ---------------------------------------------------------------------------
// Assert helpers
// ---------------------------------------------------------------------------
const results = [];
const ok = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}`);
};

// ---------------------------------------------------------------------------
// Shared synthetic page array
//
// Layout:
//   spice/wiki/                       ← scopePath for hub
//   spice/wiki/a/A Hub.md             ← wiki-section  (immediate child folder 'a')
//   spice/wiki/a/Page-A1.md           ← wiki-page     (in 'a', direct child)
//   spice/wiki/a/b/Page-B1.md         ← wiki-page     (in 'a/b', NOT direct child of 'a')
//   spice/wiki/c/C Hub.md             ← wiki-section  (immediate child folder 'c')
//   spice/wiki/c/Page-C1.md           ← wiki-page     (in 'c')
//   spice/wiki/Loose.md               ← wiki-page     (in wiki root itself)
// ---------------------------------------------------------------------------
function makePage(type, filePath, mtimeTs, extra) {
  const folder = filePath.slice(0, filePath.lastIndexOf('/'));
  const name   = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return Object.assign({ type, title: name, file: { path: filePath, folder, name, mtime: { ts: mtimeTs } } }, extra || {});
}

const pages = [
  makePage('wiki-section', 'spice/wiki/a/A Hub.md',        1000),
  makePage('wiki-page',    'spice/wiki/a/Page-A1.md',      3000),
  makePage('wiki-page',    'spice/wiki/a/b/Page-B1.md',    2000),
  makePage('wiki-section', 'spice/wiki/c/C Hub.md',        500),
  makePage('wiki-page',    'spice/wiki/c/Page-C1.md',      4000),
  makePage('wiki-page',    'spice/wiki/Loose.md',          5000),
];

// ---------------------------------------------------------------------------
// W1 — WikiTree._immediateChildFolders returns only direct child folders
// ---------------------------------------------------------------------------
{
  const tree  = new WikiTree();
  const subs  = tree._immediateChildFolders('spice/wiki', pages);
  const names = subs.map(s => s.folder);

  // Must have exactly 'spice/wiki/a' and 'spice/wiki/c' (NOT 'spice/wiki/a/b')
  const hasA      = names.includes('spice/wiki/a');
  const hasC      = names.includes('spice/wiki/c');
  const noAB      = !names.includes('spice/wiki/a/b');
  const exactTwo  = names.length === 2;

  // pageCount for 'a' must include Page-A1 (direct) AND Page-B1 (nested under a)
  const subA      = subs.find(s => s.folder === 'spice/wiki/a');
  const countA    = subA ? subA.pageCount : -1;

  ok('W1 immediateChildFolders — folders a + c only (not a/b)', hasA && hasC && noAB && exactTwo);

  // pageCount: Page-A1 + Page-B1 both sit under spice/wiki/a so count should be 2
  ok('W1b pageCount for folder a === 2', countA === 2);

  // #2 fix: the section entry captures the REAL hub-note path (so cards link to it,
  // not a reconstructed folder+slug+".md" that 404s on case-sensitive filesystems).
  ok('W1c hubPath resolves the real section-hub note path',
     subA && subA.hubPath === 'spice/wiki/a/A Hub.md');
}

// ---------------------------------------------------------------------------
// W2 — WikiTree._immediatePages returns only pages in the exact folder
// ---------------------------------------------------------------------------
{
  const tree  = new WikiTree();
  const aPages = tree._immediatePages('spice/wiki/a', pages);
  const paths  = aPages.map(p => p.file.path);

  // Page-A1.md is a direct child; Page-B1.md (in a/b/) must be excluded
  ok('W2 immediatePages — only direct pages (Page-A1, not Page-B1)',
     paths.includes('spice/wiki/a/Page-A1.md') && !paths.includes('spice/wiki/a/b/Page-B1.md'));
}

// ---------------------------------------------------------------------------
// W3 — WikiTree._recentPages returns N highest-mtime wiki-pages, desc
// ---------------------------------------------------------------------------
{
  const tree   = new WikiTree();
  const recent = tree._recentPages(pages, 3);

  // mtimes desc: Loose(5000) > Page-C1(4000) > Page-A1(3000)
  const paths = recent.map(p => p.file.path);
  ok('W3 recentPages top-3 descending mtime',
     paths[0] === 'spice/wiki/Loose.md' &&
     paths[1] === 'spice/wiki/c/Page-C1.md' &&
     paths[2] === 'spice/wiki/a/Page-A1.md' &&
     recent.length === 3);
}

// ---------------------------------------------------------------------------
// W4 — WikiMove: sectionTargets / targetPath / isNoop
// ---------------------------------------------------------------------------
{
  const mover    = new WikiMove();
  const targets  = mover.sectionTargets(pages);
  const folders  = targets.map(t => t.folder);

  // Must include root + 'a' section + 'c' section
  const hasRoot  = folders.includes('spice/wiki');
  const hasA     = folders.includes('spice/wiki/a');
  const hasC     = folders.includes('spice/wiki/c');

  ok('W4a sectionTargets includes root + all wiki-section folders', hasRoot && hasA && hasC);
  ok('W4b targetPath("spice/wiki/x","spice/wiki/y/Page.md") === "spice/wiki/x/Page.md"',
     mover.targetPath('spice/wiki/x', 'spice/wiki/y/Page.md') === 'spice/wiki/x/Page.md');
  ok('W4c isNoop("spice/wiki/y","spice/wiki/y/Page.md") === true',
     mover.isNoop('spice/wiki/y', 'spice/wiki/y/Page.md') === true);
  ok('W4d isNoop("spice/wiki/x","spice/wiki/y/Page.md") === false',
     mover.isNoop('spice/wiki/x', 'spice/wiki/y/Page.md') === false);
}

// ---------------------------------------------------------------------------
// W5 — WikiLeafActions._buildMoveOptions excludes current folder
// ---------------------------------------------------------------------------
{
  // _buildMoveOptions calls customJS.WikiMove.sectionTargets internally;
  // we stub customJS in the function scope by wrapping the call.
  // Load the class source and patch in a minimal customJS stub.
  const leafSrc = fs.readFileSync(LEAF_SRC, 'utf8');

  // Build a minimal fake customJS with a WikiMove that uses our real WikiMove
  const realMover = new WikiMove();
  const fakeCustomJS = {
    WikiMove: {
      sectionTargets: (p) => realMover.sectionTargets(p),
    },
  };

  // Wrap in a function scope that provides `customJS`
  const LeafCls = new Function('customJS', `${leafSrc}\nreturn WikiLeafActions;`)(fakeCustomJS);
  const leaf    = new LeafCls();

  const options = leaf._buildMoveOptions(pages, 'spice/wiki/a/Page-A1.md');
  const folders = options.map(o => o.folder);

  // Current folder is 'spice/wiki/a' — it must be excluded
  ok('W5 _buildMoveOptions excludes current folder (spice/wiki/a)',
     !folders.includes('spice/wiki/a') &&
     folders.includes('spice/wiki') &&
     folders.includes('spice/wiki/c'));
}

// ---------------------------------------------------------------------------
// W6 — Structural: all three files start with `class` + no module.exports
// ---------------------------------------------------------------------------
{
  function checkBareClass(srcPath) {
    const src = fs.readFileSync(srcPath, 'utf8');
    // Strip leading comments + blank lines to find first token
    const stripped = src.replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)+/, '').trimStart();
    const startsWithClass = stripped.startsWith('class ');
    const hasModuleExports = /module\.exports/.test(src);
    return startsWithClass && !hasModuleExports;
  }

  ok('W6a wiki-tree.js is a bare class (starts with class, no module.exports)',   checkBareClass(TREE_SRC));
  ok('W6b wiki-move.js is a bare class (starts with class, no module.exports)',   checkBareClass(MOVE_SRC));
  ok('W6c wiki-leaf-actions.js is a bare class (starts with class, no module.exports)', checkBareClass(LEAF_SRC));
}

// ---------------------------------------------------------------------------
// W7 — WikiHubActions renders "+ New Section" + "+ New Page" in ONE flex row
// (evenly spaced via AccentButton flex:true), gated to hub/section notes.
// ---------------------------------------------------------------------------
{
  const HUB_SRC = path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-hub-actions.js');
  const hubSrc  = fs.readFileSync(HUB_SRC, 'utf8');

  function makeEl() {
    const el = { children: [], style: { cssText: '' } };
    el.createEl = (tag, o) => { const c = makeEl(); c.cls = (o && o.cls) || ''; el.children.push(c); return c; };
    el.querySelector = () => null;
    el.closest = () => null;
    el.remove = () => {};
    return el;
  }
  function runRender(curType) {
    const btnCalls = [];
    const fakeCustomJS = {
      AccentButton: { render: (container, opts) => { btnCalls.push(opts); } },
      EntityCreate: { create: (arg) => { btnCalls._lastCreate = arg; } },
    };
    const dv = { container: makeEl(), current: () => ({ type: curType, file: { path: 'spice/wiki/Wiki.md' } }) };
    const HubCls = new Function('customJS', 'Notice', `${hubSrc}\nreturn WikiHubActions;`)(fakeCustomJS, function () {});
    new HubCls().render(dv); // async but body is synchronous (no awaits before button render)
    return { btnCalls, fakeCustomJS };
  }

  // W7a — hub note: exactly two buttons, both flex:true, correct labels.
  {
    const { btnCalls } = runRender('wiki-hub');
    const labels = btnCalls.map(b => b.label);
    ok('W7a WikiHubActions renders 2 flex buttons (+ New Section / + New Page) on a hub',
       btnCalls.length === 2 &&
       labels.includes('+ New Section') && labels.includes('+ New Page') &&
       btnCalls.every(b => b.flex === true));
  }
  // W7b/W7c — each button delegates to EntityCreate.create with the right instance.
  {
    const { btnCalls } = runRender('wiki-section');
    const sec = btnCalls.find(b => b.label === '+ New Section');
    const pg  = btnCalls.find(b => b.label === '+ New Page');
    sec.onClick();
    ok('W7b + New Section onClick → EntityCreate.create({instance:"wiki-section"})',
       btnCalls._lastCreate && btnCalls._lastCreate.instance === 'wiki-section');
    pg.onClick();
    ok('W7c + New Page onClick → EntityCreate.create({instance:"wiki-page"})',
       btnCalls._lastCreate && btnCalls._lastCreate.instance === 'wiki-page');
  }
  // W7d — leaf page: no buttons (gated).
  {
    const { btnCalls } = runRender('wiki-page');
    ok('W7d WikiHubActions renders nothing on a wiki-page (gated to hub/section)', btnCalls.length === 0);
  }
  // W7e — bare class.
  {
    const src = fs.readFileSync(HUB_SRC, 'utf8');
    const stripped = src.replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)+/, '').trimStart();
    ok('W7e wiki-hub-actions.js is a bare class (no module.exports)',
       stripped.startsWith('class ') && !/module\.exports/.test(src));
  }
  // W7f — section note prepends a "Wiki" home nav button (get back to docs).
  {
    const { btnCalls } = runRender('wiki-section');
    ok('W7f WikiHubActions renders a "Wiki" home nav button on a section',
       btnCalls.map(b => b.label).includes('Wiki'));
  }
}

// ---------------------------------------------------------------------------
// W8 — regression: card navigation. BeaconCards navigates via `target` (→
// openLinkText), NOT `link`. Section entries are plain objects with no
// .file.path, so a `link:` opt left them with an undefined default target →
// clicking a section card did nothing. Guard the source so it can't regress.
// Since Task 9 (section-explorer), section-card nav lives in SectionExplorer
// (WikiTree only delegates); page-card nav (search results + recently-updated)
// still lives in WikiTree itself.
// ---------------------------------------------------------------------------
{
  const src = fs.readFileSync(TREE_SRC, 'utf8');
  const seSrc = fs.readFileSync(SE_SRC, 'utf8');
  // v0.210: SectionExplorer renders its OWN doc cards (openLinkText nav) —
  // BeaconCards left the pane, so the old `target:` assertion is retired.
  ok('W8a SectionExplorer doc-card nav opens via openLinkText (no dead `link:` opt)',
     /openLinkText\(c\.path/.test(seSrc) && !/\blink:\s*\(/.test(seSrc));
  ok('W8a2 WikiTree page-card nav uses BeaconCards `target:` (not `link:`)',
     /target:\s*\(p\)\s*=>/.test(src) && !/\blink:\s*\(/.test(src));
  ok('W8b recent-updates flow through the adapter listRecent (no no-op raw <a href>)',
     /listRecent:\s*\(/.test(src) && !/innerHTML\s*=\s*'<a href/.test(src));
}

// ---------------------------------------------------------------------------
// W9 — WikiLeafActions nav row on a wiki-page: [ Wiki ] [ Up: <section> ] [ Move ],
// resolves the parent section hub, and renders WITHOUT throwing when WikiMove is
// cold/absent (move options are computed lazily on click, never at render).
// ---------------------------------------------------------------------------
{
  const LEAF_SRC = path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-leaf-actions.js');
  const leafSrc  = fs.readFileSync(LEAF_SRC, 'utf8');
  function makeEl2() {
    const el = { children: [], style: { cssText: '' } };
    el.createEl = (tag, o) => { const c = makeEl2(); c.cls = (o && o.cls) || ''; el.children.push(c); return c; };
    el.closest = () => null;
    el.querySelector = () => null;
    return el;
  }
  function runLeaf(filePath, sectionHubs, withWikiMove) {
    const btnCalls = [];
    const fakeCustomJS = { AccentButton: { render: (c, o) => btnCalls.push(o) } };
    if (withWikiMove) fakeCustomJS.WikiMove = { sectionTargets: () => [], move: () => {} };
    const dv = {
      container: makeEl2(),
      current: () => ({ type: 'wiki-page', file: { path: filePath } }),
      pages: () => ({ array: () => (sectionHubs || []) }),
    };
    const Cls = new Function('customJS', 'Notice', 'app', `${leafSrc}\nreturn WikiLeafActions;`)(
      fakeCustomJS, function () {}, { workspace: { openLinkText() {} } });
    new Cls().render(dv);
    return btnCalls;
  }
  const hubs = [{ type: 'wiki-section', title: 'testing', file: { folder: 'spice/wiki/testing', path: 'spice/wiki/testing/testing.md', name: 'testing.md' } }];
  // W9a/b — page inside a section: Wiki + Up:<section-title> + Move.
  {
    const b = runLeaf('spice/wiki/testing/what.md', hubs, true);
    const labels = b.map(x => x.label);
    ok('W9a wiki-page nav row: Wiki + <section> + Move',
       b.length === 3 && labels.includes('Wiki') && labels.includes('testing') && labels.includes('Move'));
    ok('W9b section nav button shows the real section-hub title ("testing", no "Up:" prefix)',
       labels.includes('testing') && !labels.some(l => l.startsWith('Up:')));
  }
  // W9c — render must NOT throw when WikiMove is cold/absent (lazy move options).
  {
    let threw = false;
    try { runLeaf('spice/wiki/testing/what.md', hubs, false); } catch (_e) { threw = true; }
    ok('W9c render does not throw when WikiMove is cold/absent (lazy move)', !threw);
  }
  // W9d — page at the wiki root: Wiki + Move only (no Up).
  {
    const b = runLeaf('spice/wiki/Loose.md', [], true);
    const labels = b.map(x => x.label);
    ok('W9d root-level page: Wiki + Move only (no Up)',
       b.length === 2 && labels.includes('Wiki') && labels.includes('Move') && !labels.some(l => l.startsWith('Up:')));
  }
}

// ---------------------------------------------------------------------------
// W10 — "Recently updated" renders as BeaconCards, each tagged with the section
// the page came from ("in <section>").
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  const bcCalls = [];
  function makeEl3() {
    const el = { children: [], style: { cssText: '' } };
    el.createEl = (t, o) => { const c = makeEl3(); c.cls = (o && o.cls) || ''; el.children.push(c); return c; };
    el.querySelector = () => null; el.closest = () => null; el.empty = () => { el.children.length = 0; };
    return el;
  }
  const fakeCustomJS = {
    DocSearch: { render: () => ({ resultsContainer: makeEl3(), text: '', tags: new Set(), hasActiveFilter: false }), matches: () => true },
    SectionLabel: { render: () => {} },
    BeaconCards: { render: (dv, opts) => bcCalls.push(opts) },
    SectionExplorer: { makeAdapter: (cfg) => cfg, render: () => {} },
  };
  const wikiPages = [
    makePage('wiki-section', 'spice/wiki/testing/testing.md', 1000),
    makePage('wiki-page', 'spice/wiki/testing/what.md', 5000),
  ];
  const dv = { container: makeEl3(), current: () => ({ type: 'wiki-hub', file: { path: 'spice/wiki/Wiki.md' } }), pages: () => ({ array: () => wikiPages }) };
  const TreeCls = new Function('customJS', 'window', `${treeSrc}\nreturn WikiTree;`)(fakeCustomJS, { moment: null });
  // v0.210: the hub's recently-updated grid moved INTO SectionExplorer's page
  // pane — WikiTree supplies it via the adapter config's listRecent instead of
  // rendering BeaconCards itself. Pin the config contract directly.
  const wt = new TreeCls();
  const cfg = wt._buildConfig(dv, dv.current());
  const recent = cfg.listRecent(dv, { scopePath: 'spice/wiki' });
  ok('W10a recently-updated flows through the adapter listRecent (card models, most-recent first)',
     Array.isArray(recent) && recent.length === 1 && recent[0].path === 'spice/wiki/testing/what.md' && recent[0].mtime === 5000);
  ok('W10b recent card carries the section it came from ("testing")',
     recent[0].where === 'testing');
}

// ---------------------------------------------------------------------------
// W11 — mobile legibility + divider: both wiki action helpers render an <hr>
// divider (between the global nav row and the wiki buttons) and apply mobile
// sizing to every button via _mobilize; the wiki breadcrumb is prominent.
// ---------------------------------------------------------------------------
{
  const hubSrc  = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-hub-actions.js'), 'utf8');
  const leafSrc = fs.readFileSync(LEAF_SRC, 'utf8');
  const bcSrc   = fs.readFileSync(path.join(ROOT, 'platform', 'mechanisms', 'breadcrumb', 'breadcrumb.js'), 'utf8');
  const mobilizes = (s) => /_mobilize\(/.test(s) && /minWidth\s*=/.test(s) && /fontSize\s*=/.test(s);
  const hasHr = (s) => /createEl\("hr"\)/.test(s);
  // Leaf uses _styleLeafBtn — buttons stretch to fill a centered row (flex:1), NOT
  // Move-pushed-right (no margin-left:auto).
  const stylesLeaf = (s) => /_styleLeafBtn\(/.test(s) && /flex\s*=\s*"1 1 0"/.test(s) && /fontSize\s*=/.test(s) && !/marginLeft\s*=\s*"auto"/.test(s);
  ok('W11a WikiHubActions: hr divider + _mobilize sizing', hasHr(hubSrc) && mobilizes(hubSrc));
  ok('W11b WikiLeafActions: hr divider + centered width-filling buttons', hasHr(leafSrc) && stylesLeaf(leafSrc));
  ok('W11c wiki breadcrumb (path_walk) is prominent (font-size: 1em, wiki-breadcrumb class)',
     /wiki-breadcrumb/.test(bcSrc) && /"font-size: 1em; margin: 2px 0 10px 0; line-height: 1\.9;"/.test(bcSrc));
}

// ---------------------------------------------------------------------------
// W12 — WikiMove.sectionTargets carries `depth` (tree hierarchy) in depth-first
// order so the Move dialog can indent section → sub-section.
// ---------------------------------------------------------------------------
{
  const move = new WikiMove();
  const pages = [
    makePage('wiki-section', 'spice/wiki/ems/ems.md', 1),
    makePage('wiki-section', 'spice/wiki/ems/sub/sub.md', 2),
    makePage('wiki-section', 'spice/wiki/zeta/zeta.md', 3),
    makePage('wiki-page',    'spice/wiki/ems/p.md', 4),
  ];
  const t = move.sectionTargets(pages);
  const byFolder = {}; t.forEach(x => { byFolder[x.folder] = x; });
  ok('W12a root target is depth 0', t[0].folder === 'spice/wiki' && t[0].depth === 0);
  ok('W12b top-level section depth 1, sub-section depth 2',
     byFolder['spice/wiki/ems'].depth === 1 && byFolder['spice/wiki/ems/sub'].depth === 2);
  const iEms = t.findIndex(x => x.folder === 'spice/wiki/ems');
  ok('W12c depth-first order — a sub-section immediately follows its parent',
     t[iEms + 1] && t[iEms + 1].folder === 'spice/wiki/ems/sub');
}

// ---------------------------------------------------------------------------
// W13 — polish: search doesn't persist, recent uses the note icon, the move
// dialog is an indented tree (not a flat <select>), dividers are tight.
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  const leafSrc = fs.readFileSync(LEAF_SRC, 'utf8');
  const hubSrc  = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-hub-actions.js'), 'utf8');
  ok('W13a wiki search does not persist (persist: false)', /persist:\s*false/.test(treeSrc));
  // v0.210: recent cards render in SectionExplorer's pane with the adapter's
  // file icon (the same note glyph the doc cards use) — the tree-local
  // recentIcon is gone with the old grid.
  ok('W13b recently-updated renders with the adapter note (file) icon, not a clock',
     /listRecent:\s*\(/.test(treeSrc) && /const fileIcon = [^;]*M14 2H6a2/.test(treeSrc) && !/recentIcon/.test(treeSrc));
  ok('W13c move dialog is an indented tree (depth), not a flat <select>',
     /opt\.depth/.test(leafSrc) && !/document\.createElement\("select"\)/.test(leafSrc));
  ok('W13d divider margins give breathing room (12px line-break, not squished)',
     /border-top: 1px solid var\(--background-modifier-border\); margin: 12px 0;/.test(hubSrc) &&
     /border-top: 1px solid var\(--background-modifier-border\); margin: 12px 0;/.test(leafSrc));
}

// ---------------------------------------------------------------------------
// W14 — closing polish: no "Up:" prefix, 2-col card grid (stacks on mobile),
// leaf owns top+bottom dividers, page template has no trailing "---".
// ---------------------------------------------------------------------------
{
  const leafSrc = fs.readFileSync(LEAF_SRC, 'utf8');
  const hubSrc  = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-hub-actions.js'), 'utf8');
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  const installSrc = fs.readFileSync(path.join(ROOT, 'platform', 'install.js'), 'utf8');
  const pageTpl = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'wiki', 'templates', 'Wiki Page.md'), 'utf8');

  ok('W14a "Up:" prefix removed from the up/section nav button (both helpers)',
     !/"Up: "/.test(leafSrc) && !/"Up: "/.test(hubSrc));
  // Since Task 9 (section-explorer): section rows are SectionExplorer's own
  // `se-rail-row` divs (no longer BeaconCards `layout: "row"`); WikiTree's own
  // BeaconCards calls (recently-updated + search results) still stay a 2-col grid.
  const seSrc2 = fs.readFileSync(path.join(ROOT, 'platform', 'mechanisms', 'section-explorer', 'section-explorer.js'), 'utf8');
  ok('W14b SectionExplorer rail renders section ROWS; WikiTree recent/pages stay a 2-col grid',
     /se-rail-row/.test(seSrc2) && /layout: "stacked"/.test(treeSrc) && /columns: 2/.test(treeSrc));
  ok('W14c WikiLeafActions renders its own top AND bottom divider (2 hrs)',
     (leafSrc.match(/createEl\("hr"\)/g) || []).length >= 2);
  ok('W14d page template no longer carries a trailing "---"',
     !/\n-{3,}\s*$/.test(pageTpl.trimEnd() + "\n") && !/WikiLeafActions[\s\S]*\n---/.test(pageTpl));
  ok('W14e page heal migrates existing pages to the WikiChromeBar bar (strips the legacy WikiLeafActions block)',
     /_healWikiChromeBody/.test(installSrc) && /class:\s*"WikiChromeBar"/.test(installSrc)
     && /"WikiLeafActions"/.test(installSrc));
}

// ---------------------------------------------------------------------------
// W15 — hub chrome consolidated into ONE block: WikiTree renders the create/nav
// buttons itself (calling WikiHubActions), the hub/section templates no longer
// carry a separate WikiHubActions block or "---", and the heal collapses that
// legacy block out of existing notes (idempotently). This is what kills the
// cross-block line gap between the wiki buttons and the search bar.
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  const hubSrc  = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'wiki', 'helpers', 'wiki-hub-actions.js'), 'utf8');
  const installSrc = fs.readFileSync(path.join(ROOT, 'platform', 'install.js'), 'utf8');
  const hubTpl = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'wiki', 'templates', 'Section Hub.md'), 'utf8');
  const wikiTpl = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'wiki', 'content', 'Wiki Hub.md'), 'utf8');

  // W15a — WikiTree NO LONGER calls WikiHubActions (chrome-bar adoption): the
  // create/nav buttons moved into the WikiChromeBar bar, so WikiTree renders only
  // the search strip + tree (content). It must not invoke WikiHubActions.
  {
    function el() {
      const e = { children: [], style: { cssText: '' } };
      e.createEl = (t, o) => { const c = el(); c.cls = (o && o.cls) || ''; e.children.push(c); return c; };
      e.querySelector = () => null; e.closest = () => null; e.empty = () => { e.children.length = 0; };
      return e;
    }
    let hubRendered = false;
    const cjs = {
      WikiHubActions: { render: () => { hubRendered = true; } },
      DocSearch: { render: () => ({ resultsContainer: el(), text: '', tags: new Set(), hasActiveFilter: false }), matches: () => true },
      SectionLabel: { render: () => {} },
      BeaconCards: { render: () => {} },
      SectionExplorer: { makeAdapter: (cfg) => cfg, render: () => {} },
    };
    const dv = { container: el(), current: () => ({ type: 'wiki-hub', file: { path: 'spice/wiki/Wiki.md' } }), pages: () => ({ array: () => [] }) };
    const Tree = new Function('customJS', 'window', `${treeSrc}\nreturn WikiTree;`)(cjs, { moment: null });
    new Tree().render(dv);
    ok('W15a WikiTree does NOT call WikiHubActions (buttons moved to the ChromeBar)', !hubRendered);
  }

  // W15b — WikiHubActions owns BOTH a top and a bottom divider (2 hrs) so its
  // buttons sit tight between the nav row and the search bar.
  ok('W15b WikiHubActions renders top + bottom dividers (2 hrs)',
     (hubSrc.match(/createEl\("hr"\)/g) || []).length >= 2);

  // W15c — hub/section chrome is now the single WikiChromeBar bar (chrome-bar
  // adoption): no Breadcrumb / SpaceNavButtons / WikiHubActions blocks; WikiTree
  // stays below as content.
  ok('W15c hub/section templates render WikiChromeBar + WikiTree (no legacy chrome blocks)',
     /WikiChromeBar/.test(hubTpl) && /WikiTree/.test(hubTpl)
     && !/WikiHubActions/.test(hubTpl) && !/SpaceNavButtons/.test(hubTpl) && !/Breadcrumb/.test(hubTpl)
     && /WikiChromeBar/.test(wikiTpl) && /WikiTree/.test(wikiTpl)
     && !/WikiHubActions/.test(wikiTpl) && !/SpaceNavButtons/.test(wikiTpl) && !/Breadcrumb/.test(wikiTpl));

  // W15d — heal behavior (chrome-bar adoption): a legacy hub/section note
  // ([bc][nav][WikiHubActions][---][WikiTree]) migrates to [WikiChromeBar][WikiTree]
  // — one bar, no legacy chrome blocks, WikiTree preserved as content, idempotent;
  // and a legacy page ([bc][nav][WikiLeafActions]) migrates to [WikiChromeBar].
  {
    const m = installSrc.match(/function _healWikiChromeBody\(body, type\) \{[\s\S]*?\n\}\n/);
    const heal = new Function(m[0] + '\nreturn _healWikiChromeBody;')();
    const VP = 'ranch/views/customjs-guard';
    const blk = (c) => '```dataviewjs\nawait dv.view("' + VP + '", { class: "' + c + '" });\n```';
    const hub = ['---', 'type: wiki-section', 'title: ems', 'dir: spice/wiki/ems', '---', '',
      blk('Breadcrumb'), '', blk('SpaceNavButtons'), '', blk('WikiHubActions'), '', '---', '', blk('WikiTree'), ''].join('\n');
    const h1 = heal(hub, 'wiki-section');
    const h2 = heal(h1, 'wiki-section');
    ok('W15d heal → single WikiChromeBar bar + WikiTree content, no legacy chrome, bar before tree, idempotent',
       /class:\s*"WikiChromeBar"/.test(h1) && /class:\s*"WikiTree"/.test(h1)
       && !/class:\s*"WikiHubActions"/.test(h1) && !/class:\s*"SpaceNavButtons"/.test(h1) && !/class:\s*"Breadcrumb"/.test(h1)
       && h1.indexOf('WikiChromeBar') < h1.indexOf('WikiTree') && h1 === h2);

    const page = ['---', 'type: wiki-page', 'title: p', '---', '',
      blk('Breadcrumb'), '', blk('SpaceNavButtons'), '', blk('WikiLeafActions'), '', 'Body.', ''].join('\n');
    const p1 = heal(page, 'wiki-page');
    const p2 = heal(p1, 'wiki-page');
    ok('W15d2 page heal → WikiChromeBar, WikiLeafActions/nav stripped, body kept, idempotent',
       /class:\s*"WikiChromeBar"/.test(p1) && !/class:\s*"WikiLeafActions"/.test(p1)
       && !/class:\s*"SpaceNavButtons"/.test(p1) && /Body\./.test(p1) && p1 === p2);
  }
}

// ---------------------------------------------------------------------------
// W16 — section listing carries rich metadata (sub-sections · docs, recursive),
// and the leaf row is centered + width-filling. Since Task 9 (section-explorer),
// section-card RENDERING (rows vs grid, meta string) lives in SectionExplorer's
// own test suite (run-section-explorer.js); this suite still verifies WikiTree's
// own _immediateChildFolders data (feeds the adapter's listSections) is correct.
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  const leafSrc = fs.readFileSync(LEAF_SRC, 'utf8');

  const factory = new Function('module', 'exports', treeSrc + '\nmodule.exports = WikiTree;');
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const WikiTreeCls = mod.exports;
  const tree = new WikiTreeCls();

  // ems has 1 sub-section (other-stuff) + 2 docs (recursive); zeta is empty.
  const wp = [
    makePage('wiki-section', 'spice/wiki/ems/ems.md', 1000),
    makePage('wiki-section', 'spice/wiki/ems/other-stuff/other-stuff.md', 1100),
    makePage('wiki-page',    'spice/wiki/ems/doc0.md', 1200),
    makePage('wiki-page',    'spice/wiki/ems/other-stuff/doc1.md', 1300),
    makePage('wiki-section', 'spice/wiki/zeta/zeta.md', 900),
  ];
  const subs = tree._immediateChildFolders('spice/wiki', wp);
  const ems = subs.find(s => s.folder === 'spice/wiki/ems');
  ok('W16b _immediateChildFolders counts sub-sections + docs (recursive)',
     !!ems && ems.subSectionCount === 1 && ems.pageCount === 2);
  const zeta = subs.find(s => s.folder === 'spice/wiki/zeta');
  ok('W16d empty section still reports a doc count', !!zeta && zeta.pageCount === 0 && zeta.subSectionCount === 0);

  // Leaf: centered row that stretches its buttons to fill the width (flex:1), NOT
  // Move-pushed-right.
  ok('W16e leaf row is centered + width-filling (max-width + justify center + flex:1, no Move-right)',
     /max-width: 640px/.test(leafSrc.split('_styleLeafBtn')[0]) &&
     /justify-content: center/.test(leafSrc.split('_styleLeafBtn')[0]) &&
     /flex\s*=\s*"1 1 0"/.test(leafSrc) &&
     !/marginLeft\s*=\s*"auto"/.test(leafSrc));
}

// ---------------------------------------------------------------------------
// W17 — sections sort toggle (last-edited default, A–Z toggle) + search-gap match.
// Since Task 9 (section-explorer), the sort toggle + rail rendering live in
// SectionExplorer (see run-section-explorer.js "rail rows show meta ... and
// re-sort on toggle click"); this suite keeps WikiTree's own search-gap check.
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  const seSrc3 = fs.readFileSync(path.join(ROOT, 'platform', 'mechanisms', 'section-explorer', 'section-explorer.js'), 'utf8');
  // W17a — the search strip top gap is normalized to 12px (identical to the
  // buttons↔divider gap the user wanted matched).
  ok('W17a WikiTree matches the search strip top gap to 12px',
     /\.doc-search-strip/.test(treeSrc) && /marginTop\s*=\s*"12px"/.test(treeSrc));
  // W17d — toggle labels present in SectionExplorer's source.
  ok('W17d SectionExplorer sections render a "Recent | A–Z" toggle',
     /Recent/.test(seSrc3) && /A–Z/.test(seSrc3));
}

// ---------------------------------------------------------------------------
// W18 — recursive search: an active query searches the current note's whole
// subtree (flat Results grid, each tagged with its section trail); an empty query
// falls through to the browse view.
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  function el() {
    const e = { children: [], style: { cssText: '' } };
    e.createEl = (t, o) => { const c = el(); c.cls = (o && o.cls) || ''; e.children.push(c); return c; };
    e.querySelector = () => null; e.closest = () => null; e.empty = () => { e.children.length = 0; };
    return e;
  }
  const wp = [
    makePage('wiki-section', 'spice/wiki/infra/infra.md', 100),
    makePage('wiki-section', 'spice/wiki/infra/aws/aws.md', 110),
    makePage('wiki-page',    'spice/wiki/infra/aws/VPC Peering.md', 500),
    makePage('wiki-page',    'spice/wiki/infra/Overview.md', 400),
    makePage('wiki-page',    'spice/wiki/ems/VPC notes.md', 600),
  ];
  function runTree(active) {
    const bc = [], labels = [];
    const cjs = {
      DocSearch: {
        render: () => ({ resultsContainer: el(), text: active ? 'vpc' : '', tags: new Set(), hasActiveFilter: !!active }),
        matches: (p, c) => { if (!c || !c.hasActiveFilter) return true; const n = ((p.file && p.file.name) || '').toLowerCase(); return n.includes((c.text || '').toLowerCase()); },
      },
      SectionLabel: { render: (dv, o) => labels.push(o && o.text) },
      BeaconCards: { render: (dv, opts) => bc.push(opts) },
      SectionExplorer: { makeAdapter: (cfg) => cfg, render: () => { labels.push('__SectionExplorer.render__'); } },
    };
    const dv = { container: el(), current: () => ({ type: 'wiki-hub', file: { path: 'spice/wiki/Wiki.md' } }), pages: () => ({ array: () => wp }) };
    const Tree = new Function('customJS', 'window', `${treeSrc}\nreturn WikiTree;`)(cjs, { moment: null });
    new Tree().render(dv);
    return { bc, labels };
  }
  const s = runTree(true);
  const resCall = s.bc.find(c => c.layout === 'stacked' && Array.isArray(c.pages) && c.pages.every(p => p.file));
  ok('W18a active query → a single flat Results grid (browse view suppressed)',
     s.bc.length === 1 && !!resCall && resCall.columns === 2 && s.labels.some(l => /^Results \(2\)/.test(l)));
  ok('W18b results are RECURSIVE (2-level-deep doc matched, non-matches excluded)',
     !!resCall && resCall.pages.some(p => p.file.path === 'spice/wiki/infra/aws/VPC Peering.md') &&
     !resCall.pages.some(p => /Overview/.test(p.file.name)));
  const vpcPeer  = resCall && resCall.pages.find(p => p.file.path === 'spice/wiki/infra/aws/VPC Peering.md');
  const vpcNotes = resCall && resCall.pages.find(p => p.file.path === 'spice/wiki/ems/VPC notes.md');
  ok('W18c subtitle shows the section trail relative to the search root',
     !!vpcPeer && resCall.subtitle(vpcPeer) === 'in infra / aws' &&
     !!vpcNotes && resCall.subtitle(vpcNotes) === 'in ems');
  const b = runTree(false);
  ok('W18d empty query falls through to browse (delegates to SectionExplorer, no Results label)',
     b.labels.includes('__SectionExplorer.render__') && !b.labels.some(l => /^Results/.test(l)));
}

// ---------------------------------------------------------------------------
// W19 — cold-load guard: WikiTree.render must never throw when
// customJS.SectionExplorer is missing/undefined (matching the sibling
// customJS-guard idiom used by WikiChromeBar/WikiHubActions/WikiLeafActions).
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  function el() {
    const e = { children: [], style: { cssText: '' } };
    e.createEl = (t, o) => { const c = el(); c.cls = (o && o.cls) || ''; e.children.push(c); return c; };
    e.querySelector = () => null; e.closest = () => null; e.empty = () => { e.children.length = 0; };
    return e;
  }
  const cjs = {
    DocSearch: { render: () => ({ resultsContainer: el(), text: '', tags: new Set(), hasActiveFilter: false }), matches: () => true },
    SectionLabel: { render: () => {} },
    BeaconCards: { render: () => {} },
    // SectionExplorer deliberately absent — simulates cold-load TDZ ordering.
  };
  const dv = { container: el(), current: () => ({ type: 'wiki-hub', file: { path: 'spice/wiki/Wiki.md' } }), pages: () => ({ array: () => [] }) };
  const Tree = new Function('customJS', 'window', `${treeSrc}\nreturn WikiTree;`)(cjs, { moment: null });
  let threw = false;
  try { new Tree().render(dv); } catch (_e) { threw = true; }
  ok('W19a WikiTree.render does not throw when customJS.SectionExplorer is missing (cold-load guard)', !threw);
}

// ---------------------------------------------------------------------------
// W20 — Task B: the DocSearch options in WikiTree.render hide the tag chips
// (hideTags: true), matching the project blueprint.
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');
  // Assert hideTags: true appears within the DocSearch.render options object.
  ok('W20a WikiTree DocSearch options include hideTags: true',
     /customJS\.DocSearch\.render\(dv,\s*\{[\s\S]*?hideTags:\s*true[\s\S]*?\}\)/.test(treeSrc));
}

// ---------------------------------------------------------------------------
// W21 — Task G: WikiTree._buildConfig returns a `move` block (folder-is-truth:
// rewrite hooks return null, canAcceptSection true), an `emptySubsectionCount`
// counting child sections, and a recursive-doc-count `canDelete` gate.
// ---------------------------------------------------------------------------
{
  const treeSrc = fs.readFileSync(TREE_SRC, 'utf8');

  // Load the REAL statics from section-explorer.js so the block behaves faithfully.
  const SE = new Function(`${fs.readFileSync(SE_SRC, 'utf8')}\nreturn SectionExplorer;`)();

  // Stub dv.pages to return our synthetic wiki subtree.
  const subtree = [
    makePage('wiki-section', 'spice/wiki/cooking/Cooking.md', 100),
    makePage('wiki-section', 'spice/wiki/cooking/sauces/Sauces.md', 110),
    makePage('wiki-page',    'spice/wiki/cooking/Recipe.md', 200),
  ];
  const dvStub = {
    pages: (q) => {
      // q is like '"spice/wiki/cooking"' — return matching subtree pages.
      const m = String(q).replace(/"/g, '');
      const arr = subtree.filter(p => {
        const f = p.file.path.slice(0, p.file.path.lastIndexOf('/'));
        return f === m || f.indexOf(m + '/') === 0;
      });
      return { array: () => arr };
    },
    current: () => ({ type: 'wiki-section', file: { path: 'spice/wiki/cooking/Cooking.md' } }),
    page: () => null,
  };

  const TreeCls = new Function('customJS', `${treeSrc}\nreturn WikiTree;`)({ SectionExplorer: SE });
  const tree = new TreeCls();
  const cur = dvStub.current();
  const cfg = tree._buildConfig(dvStub, cur);

  // W21a — move block shape.
  ok('W21a move block: root/sectionType/rootLabel present',
     cfg.move && cfg.move.root === 'spice/wiki' && cfg.move.sectionType === 'wiki-section' && cfg.move.rootLabel === 'Wiki (root)');
  ok('W21b move.rewriteOnDocMove() === null (folder-is-truth)',
     typeof cfg.move.rewriteOnDocMove === 'function' && cfg.move.rewriteOnDocMove('spice/wiki/x', 'spice/wiki/y/D.md') === null);
  ok('W21c move.rewriteOnSectionMove() === null',
     typeof cfg.move.rewriteOnSectionMove === 'function' && cfg.move.rewriteOnSectionMove({}, 'spice/wiki') === null);
  ok('W21d move.canAcceptSection() === true (arbitrary depth)',
     typeof cfg.move.canAcceptSection === 'function' && cfg.move.canAcceptSection({}, 'spice/wiki/anything') === true);

  // W21e — enumerateSectionTargets returns root-first section targets.
  {
    const targets = cfg.move.enumerateSectionTargets(dvStub);
    const folders = targets.map(t => t.folder);
    ok('W21e enumerateSectionTargets: root first, then wiki-section folders',
       folders[0] === 'spice/wiki' &&
       folders.includes('spice/wiki/cooking') &&
       folders.includes('spice/wiki/cooking/sauces') &&
       targets[0].label === 'Wiki (root)');
  }

  // W21f — emptySubsectionCount counts child section folders under the section.
  ok('W21f emptySubsectionCount counts child sections (cooking has 1: sauces)',
     typeof cfg.emptySubsectionCount === 'function' &&
     cfg.emptySubsectionCount({ folder: 'spice/wiki/cooking' }) === 1);

  // W21g — canDelete: false when a wiki-page exists in the subtree.
  ok('W21g canDelete false when a wiki-page exists in the section subtree',
     cfg.canDelete({ folder: 'spice/wiki/cooking', hubPath: 'spice/wiki/cooking/Cooking.md' }) === false);

  // W21h — canDelete: true when the section subtree has no wiki-page.
  {
    // sauces subtree has only its own hub, no wiki-page.
    ok('W21h canDelete true when the section subtree has no wiki-page',
       cfg.canDelete({ folder: 'spice/wiki/cooking/sauces', hubPath: 'spice/wiki/cooking/sauces/Sauces.md' }) === true);
  }

  // W21i — canDelete false without a hubPath (never delete a phantom).
  ok('W21i canDelete false when section has no hubPath',
     cfg.canDelete({ folder: 'spice/wiki/cooking/sauces' }) === false);
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
const passed = results.filter(([, p]) => p).length;
const total  = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
