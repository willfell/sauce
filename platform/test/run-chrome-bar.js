#!/usr/bin/env node
/**
 * run-chrome-bar.js — ChromeBar is the shared per-surface chrome bar mechanism.
 * Drives the REAL ChromeBar (loaded via new Function — no module system in
 * customJS) against DOM + customJS stubs. ChromeBar is an INSTANCE (customJS
 * stores instances), so every case uses `new ChromeBar()`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const ChromeBar = loadClass('platform/mechanisms/chrome-bar/chrome-bar.js', 'ChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ChromeBar();

// Minimal element supporting createEl (Obsidian) + appendChild/createElement +
// querySelector/getBoundingClientRect. Mirrors run-project-chrome-bar.js makeEl.
function makeEl(tag) {
  const el = { tag, textContent: '', innerHTML: '', className: '', style: { cssText: '', setProperty() {} }, children: [], onclick: null, disabled: false };
  el.createEl = (t, opts) => { const c = makeEl(t); if (opts && opts.cls) c.className = opts.cls; if (opts && opts.text) c.textContent = opts.text; el.children.push(c); return c; };
  el.appendChild = (c) => { el.children.push(c); return c; };
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.getBoundingClientRect = () => ({ left: 0, bottom: 0, width: 100 });
  el.remove = () => {};
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  return el;
}
function allDescendants(el) { const out = []; for (const c of (el.children || [])) { out.push(c); out.push(...allDescendants(c)); } return out; }

// ── CB-SMOKE-1 — CHROME_ICONS exposes the three control glyphs as SVG strings.
{
  const ic = inst.CHROME_ICONS;
  ok('CB-SMOKE-1 CHROME_ICONS has compass/chevronDown/moreHorizontal SVGs',
    ic && /svg/.test(ic.compass) && /svg/.test(ic.chevronDown) && /svg/.test(ic.moreHorizontal));
}

// ── (Task 3 appends CB-BTN-*, Task 4 CB-VAULT-*, Task 5 CB-RENDER-* here) ──
// PLACEHOLDER-ANCHOR: additional cases inserted above the summary block below.
// ── CB-HOME-1..3 — CHROME_ICONS.home glyph + render() emits a Home button
// before the Go button, wired to adapter.openNavTarget("spice/home/Home.md").
{
  const ic = inst.CHROME_ICONS;
  ok('CB-HOME-1 CHROME_ICONS has a home SVG', ic && /svg/.test(ic.home));
}
async function cbHomeButtonCase() {
  const prevApp = global.app, prevCJS = global.customJS, prevAD = global.activeDocument;
  global.activeDocument = { body: makeEl('body'), createElement: (t) => makeEl(t), addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  global.app = { isMobile: false, workspace: { openLinkText() {}, getLeaf: () => ({ openFile() {} }) } };
  global.customJS = {
    RenderSafe: { page: (dv) => (dv && dv.current ? dv.current() : null) },
    Breadcrumb: { buildSegments: async () => ([]) },
    MenuPopover: { open: () => makeEl('div') },
  };
  const opened = [];
  const adapter = {
    resolve: () => ({ ctx: {}, spec: { primary: null, overflow: [] } }),
    navEntries: async () => ([]),
    dispatch: () => {},
    openNavTarget: (p) => opened.push(p),
    rootClass: 'x-root',
    btnClass: (v) => `x-btn x-btn-${v}`,
  };
  const container = makeEl('div');
  const dv = { container, current: () => ({ file: { path: 'spice/x/y.md', name: 'y' } }) };
  await inst.render(dv, adapter);
  const desc = allDescendants(container);
  const homeBtn = desc.find((e) => e.className && String(e.className).includes('x-btn-home'));
  ok('CB-HOME-2 renders a Home button (x-btn-home via adapter.btnClass)', !!homeBtn);
  if (homeBtn && typeof homeBtn.onclick === 'function') homeBtn.onclick();
  ok('CB-HOME-3 clicking Home calls adapter.openNavTarget("spice/home/Home.md")',
    opened.length === 1 && opened[0] === 'spice/home/Home.md');
  global.app = prevApp; global.customJS = prevCJS; global.activeDocument = prevAD;
}
// ── CB-RENDER-1..6 — render(dv, adapter): guards, adapter.resolve gate, root/btn
// classes from the adapter, Go/primary/⋯ wiring to adapter.navEntries/dispatch.
async function cbRenderCases() {
  const prevApp = global.app, prevCJS = global.customJS, prevAD = global.activeDocument;
  const menuOpens = [];
  global.activeDocument = { body: makeEl('body'), createElement: (t) => makeEl(t), addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  global.app = { isMobile: false, workspace: { openLinkText() {}, getLeaf: () => ({ openFile() {} }) } };
  global.customJS = {
    RenderSafe: { page: (dv) => (dv && dv.current ? dv.current() : null) },
    Breadcrumb: { buildSegments: async () => ([{ label: 'Projects', link: 'p.md' }, { label: 'Docs', link: null }]) },
    MenuPopover: { open: (entries, opts) => { menuOpens.push({ entries, opts }); return makeEl('div'); } },
  };
  const dispatched = [];
  const navEntries = [{ section: 'This project' }, { label: 'Board', onSelect() {} }, { section: 'Vault', layout: 'grid' }, { label: 'Home', onSelect() {} }];
  const adapter = {
    resolve: (dv, page) => ({ ctx: { context: 'docs-hub' }, spec: { primary: { id: 'new-doc', label: 'New Doc', icon: '<svg/>' }, overflow: [{ id: 'move-docs', label: 'Move', icon: '<svg/>' }], leaf: false } }),
    navEntries: async () => navEntries,
    dispatch: (dv, ctx, id) => dispatched.push(id),
    openNavTarget: () => {},
    rootClass: 'pcb-root',
    btnClass: (v) => `pcb-btn pcb-btn-${v}`,
  };
  const container = makeEl('div');
  const dv = { container, current: () => ({ file: { path: 'spice/projects/x/docs/Docs.md', name: 'Docs' } }) };
  await inst.render(dv, adapter);

  const desc = allDescendants(container);
  const root = desc.find((e) => e.className && String(e.className).includes('pcb-root'));
  ok('CB-RENDER-1 dedupe root uses adapter.rootClass (pcb-root)', !!root);
  const goBtn = desc.find((e) => e.className && String(e.className).includes('pcb-btn-go'));
  const primaryBtn = desc.find((e) => e.className && String(e.className).includes('pcb-btn-primary'));
  const dotsBtn = desc.find((e) => e.className && String(e.className).includes('pcb-btn-dots'));
  ok('CB-RENDER-2 renders Go (pcb-btn-go), primary (pcb-btn-primary), ⋯ (pcb-btn-dots) via adapter.btnClass', !!goBtn && !!primaryBtn && !!dotsBtn);
  ok('CB-RENDER-3 renders a breadcrumb sub-div', desc.some((e) => e.className && String(e.className).includes('project-breadcrumb')));
  if (goBtn && typeof goBtn.onclick === 'function') await goBtn.onclick();
  ok('CB-RENDER-4 clicking Go calls MenuPopover.open with the adapter.navEntries', menuOpens.length === 1 && menuOpens[0].entries === navEntries);
  if (primaryBtn && typeof primaryBtn.onclick === 'function') primaryBtn.onclick();
  ok('CB-RENDER-5 clicking primary routes to adapter.dispatch with the primary id', dispatched.includes('new-doc'));

  const c2 = makeEl('div');
  const nullAdapter = Object.assign({}, adapter, { resolve: () => null });
  await inst.render({ container: c2, current: () => ({ file: { path: 'x.md', name: 'x' } }) }, nullAdapter);
  ok('CB-RENDER-6 adapter.resolve → null renders nothing', allDescendants(c2).length === 0);

  global.app = prevApp; global.customJS = prevCJS; global.activeDocument = prevAD;
}
// ── CB-VAULT-1..5 — vaultEntries reads the registry, delegates ordering to
// SpaceNavButtons.firstEntryPerSource, emits a { section:"Vault", layout:"grid" }
// marker + one entry per source, openLink→open / else→_dispatchAction, []-when-empty.
async function cbVaultCases() {
  const registryJson = JSON.stringify({ schema_version: 1, contributions: {
    project:  [{ id: 'projects-hub', label: 'Projects', icon: 'projects', order: 100, action: { type: 'openLink', target: 'spice/projects/Projects.md' } }],
    'to-do':  [{ id: 'todo-today', label: 'To Do', icon: 'todo', order: 110, action: { type: 'runTemplaterTemplate', template_source: 'x' } }],
  } });
  const opened = [];
  const dispatched = [];
  const prevApp = global.app, prevCJS = global.customJS;
  global.app = { vault: { adapter: { read: async (p) => (p === 'ranch/nav-buttons-registry.json' ? registryJson : (() => { throw new Error('ENOENT'); })()) } } };
  global.customJS = {
    Icons: { resolve: () => '<svg/>' },
    SpaceNavButtons: {
      firstEntryPerSource: (reg) => {
        const reps = [];
        for (const [src, list] of Object.entries((reg && reg.contributions) || {})) {
          if (Array.isArray(list) && list.length) reps.push({ ...list[0], _source: src });
        }
        return reps.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a._source.localeCompare(b._source));
      },
      _dispatchAction: (entry) => dispatched.push(entry),
    },
  };
  const entries = await inst.vaultEntries({ current: () => ({ file: { path: 'x.md' } }) }, (p) => opened.push(p));

  ok('CB-VAULT-1 first element is the { section:"Vault", layout:"grid" } marker',
    entries[0] && entries[0].section === 'Vault' && entries[0].layout === 'grid');
  const rows = entries.filter((e) => e && !('section' in e));
  ok('CB-VAULT-2 one row per registry source', rows.length === 2);
  ok('CB-VAULT-3 every row carries an onSelect handler', rows.every((e) => typeof e.onSelect === 'function'));
  const projRow = rows.find((e) => e.label === 'Projects');
  const todoRow = rows.find((e) => e.label === 'To Do');
  // Invoke onSelect while the customJS stub is STILL installed — vaultEntries reads
  // customJS.SpaceNavButtons._dispatchAction lazily inside the closure (verbatim to
  // the source), so restore globals only AFTER these calls.
  if (projRow) projRow.onSelect();
  if (todoRow) todoRow.onSelect();
  global.app = prevApp; global.customJS = prevCJS;
  ok('CB-VAULT-4 openLink→open(target), non-openLink→_dispatchAction',
    opened.length === 1 && opened[0] === 'spice/projects/Projects.md' && dispatched.length === 1);
}
async function cbVaultEmpty() {
  const prevApp = global.app, prevCJS = global.customJS;
  global.app = { vault: { adapter: { read: async () => { throw new Error('ENOENT'); } } } };
  global.customJS = { SpaceNavButtons: { firstEntryPerSource: () => [] }, Icons: { resolve: () => '' } };
  const entries = await inst.vaultEntries({ current: () => ({ file: { path: 'x.md' } }) }, () => {});
  global.app = prevApp; global.customJS = prevCJS;
  ok('CB-VAULT-5 no registry / no sources → [] (no Vault marker)', Array.isArray(entries) && entries.length === 0);
}
// ── CB-BTN-1..5 — renderChromeButton: caller-supplied cls, icon-only vs labeled,
// onClick wiring, hover/press motion handlers.
{
  const parent = makeEl('div');
  let clicked = 0;
  const btn = inst.renderChromeButton(parent, { cls: 'pcb-btn pcb-btn-go', icon: '<svg id="i"/>', onClick: () => { clicked += 1; } });
  ok('CB-BTN-1 button carries the caller-supplied cls verbatim', btn.className === 'pcb-btn pcb-btn-go');
  ok('CB-BTN-2 icon-only (no label) → innerHTML has the icon, no label span',
    (btn.innerHTML || '').indexOf('<svg id="i"/>') >= 0 && (btn.innerHTML || '').indexOf('<span') < 0);
  if (typeof btn.onclick === 'function') btn.onclick();
  ok('CB-BTN-3 onClick is wired to btn.onclick', clicked === 1);
  ok('CB-BTN-4 wires hover-lift + press-scale handlers + a CSS transition',
    typeof btn.onmouseenter === 'function' && typeof btn.onmouseleave === 'function' &&
    typeof btn.onmousedown === 'function' && typeof btn.onmouseup === 'function' &&
    /transition:/.test(btn.style.cssText || ''));
}
{
  const parent = makeEl('div');
  const btn = inst.renderChromeButton(parent, { cls: 'pcb-btn pcb-btn-primary', label: 'New Task', icon: '<svg/>', onClick: () => {} });
  ok('CB-BTN-5 labeled button renders the label inside a span', (btn.innerHTML || '').indexOf('New Task') >= 0 && (btn.innerHTML || '').indexOf('<span') >= 0);
}

function summarize() {
  const failed = results.filter(([, c]) => !c);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
  process.exit(0);
}
// ── CB-FACTORY-1..6 — makeAdapter(config) assembles a render-ready adapter;
// openNavTarget opens cold-cache-safe.
async function cbFactoryCases() {
  const openFiles = [], openLinks = [];
  const prevApp = global.app;
  const f = { path: 'spice/wiki/Wiki.md' };
  global.app = { vault: { getAbstractFileByPath: (p) => (p === f.path ? f : null) },
    workspace: { getLeaf: () => ({ openFile: (x) => openFiles.push(x) }), openLinkText: (p) => openLinks.push(p) } };
  inst.openNavTarget('spice/wiki/Wiki.md', {});
  inst.openNavTarget('spice/wiki/Missing.md', {});
  global.app = prevApp;
  ok('CB-FACTORY-1 openNavTarget opens a resolvable path via getLeaf().openFile (TFile)', openFiles.length === 1 && openFiles[0] === f);
  ok('CB-FACTORY-2 openNavTarget falls back to openLinkText for an unresolved path', openLinks.length === 1 && openLinks[0] === 'spice/wiki/Missing.md');

  const cfg = {
    detect: (dv, page) => (page && page.file && page.file.path.indexOf('/wiki/') >= 0 ? { context: 'wiki-hub' } : null),
    surfaceSpec: (ctx) => ({ primary: { id: 'new-page', label: 'New Page', icon: '<svg/>' }, overflow: [], leaf: false }),
    dispatch: (dv, ctx, id) => { dv.__dispatched = id; },
    destinations: (dv, ctx) => ([{ section: 'This wiki' }, { label: 'Wiki', icon: '<svg/>', onSelect() {} }]),
    rootClass: 'wiki-chrome-root',
    btnClass: (v) => `wiki-chrome-btn wiki-chrome-btn-${v}`,
  };
  const adapter = inst.makeAdapter(cfg);
  ok('CB-FACTORY-3 resolve → null when detect returns null', adapter.resolve({}, { file: { path: 'x.md' } }) === null);
  const r = adapter.resolve({}, { file: { path: 'spice/wiki/Wiki.md' } });
  ok('CB-FACTORY-4 resolve → { ctx, spec } when detect matches', r && r.ctx.context === 'wiki-hub' && r.spec.primary.id === 'new-page');
  ok('CB-FACTORY-5 rootClass/btnClass thread through', adapter.rootClass === 'wiki-chrome-root' && adapter.btnClass('go') === 'wiki-chrome-btn wiki-chrome-btn-go');
  const prevApp2 = global.app, prevCJS = global.customJS;
  global.app = { vault: { adapter: { read: async () => { throw new Error('ENOENT'); } } } };
  global.customJS = { SpaceNavButtons: { firstEntryPerSource: () => [] }, Icons: { resolve: () => '' } };
  const entries = await adapter.navEntries({}, { context: 'wiki-hub' });
  global.app = prevApp2; global.customJS = prevCJS;
  ok('CB-FACTORY-6 navEntries begins with the config.destinations (This wiki + Wiki)',
    entries[0] && entries[0].section === 'This wiki' && entries.some((e) => e && e.label === 'Wiki'));
}

(async () => {
  await cbVaultCases();
  await cbVaultEmpty();
  await cbRenderCases();
  await cbHomeButtonCase();
  await cbFactoryCases();
  summarize();
})();
