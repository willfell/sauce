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
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
const passed = results.filter(([, p]) => p).length;
const total  = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
