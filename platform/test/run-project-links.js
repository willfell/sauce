#!/usr/bin/env node
/**
 * run-project-links.js — Project Links PR1 regression guard.
 *
 * Covers the two behavioral source changes of the "Project Links Wiring" PR1:
 *   1. ProjectLinksPanel (helpers/project-links-panel.js) — read-only render of a
 *      note's `links` frontmatter into external anchors (inline, no customJS.Links
 *      dependency — the Option B decision). Reverting the helper deletes the file,
 *      so the class fails to load below → red.
 *   2. ProjectNavButtons.detectContext (helpers/project-nav-buttons.js) — the new
 *      `links-hub` context branch for a "Links Hub.md" note at the project root.
 *      Reverting the helper drops the branch → the Links Hub path resolves to
 *      "unknown" → the PLB-D1 assertion fails → red.
 *
 * Both restored → green. This is the red-without-source guard Gate B Layer 1 runs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// Obsidian-ish element stub: createEl(tag, {text, href}) + setAttr + style.
function makeEl(tag) {
  const el = { tag, textContent: '', href: undefined, attrs: {}, style: { cssText: '' }, children: [], className: '', dataset: {} };
  Object.defineProperty(el, 'childNodes', { get: () => el.children });
  el.createEl = (t, opts) => {
    const c = makeEl(t);
    if (opts && opts.text != null) c.textContent = opts.text;
    if (opts && opts.href != null) c.href = opts.href;
    if (opts && opts.cls != null) c.className = opts.cls;
    c.parentNode = el;
    el.children.push(c);
    return c;
  };
  el.setAttr = (k, v) => { el.attrs[k] = v; };
  el.replaceChildren = (...nodes) => { el.children = nodes; for (const node of nodes) node.parentNode = el; };
  el.appendChild = (node) => { node.parentNode = el; el.children.push(node); return node; };
  el.querySelector = (selector) => {
    const cls = selector.startsWith('.') ? selector.slice(1) : null;
    const walk = (node) => {
      for (const child of node.children || []) {
        if (cls && String(child.className || '').split(/\s+/).includes(cls)) return child;
        const nested = walk(child); if (nested) return nested;
      }
      return null;
    };
    return walk(el);
  };
  return el;
}

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// Shared globals: real RenderSafe (the blessed cold-load page shim) + a no-op
// SectionLabel + a minimal `app` (detectContext reads app.metadataCache before
// reaching the links-hub branch; RenderSafe.page falls through to null when the
// stub dv has no indexed page and app.workspace is absent).
const RenderSafe = loadClass('platform/mechanisms/render-safe/render-safe.js', 'RenderSafe');
global.customJS = Object.assign(global.customJS || {}, {
  RenderSafe: new RenderSafe(),
  SectionLabel: { render: () => {} },
});
global.app = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };

const anchorsOf = (root) => {
  const out = [];
  const walk = (el) => { for (const ch of el.children) { if (ch.tag === 'a') out.push(ch); walk(ch); } };
  walk(root);
  return out;
};
// WS6: the panel now renders each link as a CARD anchor — the display title +
// host live in child <div>s (not anchor.textContent). Helpers read them back.
const cardTitleOf = (a) => (a.children[0] ? a.children[0].textContent : '');
const cardHostOf = (a) => (a.children[1] ? a.children[1].textContent : '');

// ─── ProjectLinksPanel render ────────────────────────────────────────────────
const Panel = loadClass('platform/blueprints/project/helpers/project-links-panel.js', 'ProjectLinksPanel');
ok('PLB-P0 ProjectLinksPanel class loads', !!Panel);
const panel = Panel ? new Panel() : null;
const pageWith = (links) => ({ current: () => ({ file: { name: 'Links Hub', path: 'spice/projects/x/Links Hub.md' }, links }) });

// PLB-P1 — WS6: renders one CARD anchor per link — each carries the external-safe
// target/rel + href, with the display title in a child <div> and the host below it.
{
  const c = makeEl('div');
  const dv = Object.assign(pageWith([{ url: 'https://a.com', text: 'A' }, { url: 'https://b.com', text: 'B' }]), { container: c });
  panel && panel.render(dv);
  const a = anchorsOf(c);
  ok('PLB-P1 card anchors rendered (per-anchor target/rel/href + title + host)',
    a.length === 2 &&
    a.every(x => x.attrs.target === '_blank' && x.attrs.rel === 'noopener') &&
    a[0].href === 'https://a.com' && cardTitleOf(a[0]) === 'A' && cardHostOf(a[0]) === 'a.com' &&
    a[1].href === 'https://b.com' && cardTitleOf(a[1]) === 'B' && cardHostOf(a[1]) === 'b.com');
}
// PLB-P2 — WS6 empty-state rule: empty links render NOTHING (no anchors, no label,
// no "No links yet." hint). The Add-link button above owns the empty affordance.
{
  const c = makeEl('div');
  const dv = Object.assign(pageWith([]), { container: c });
  panel && panel.render(dv);
  ok('PLB-P2 empty -> renders nothing', anchorsOf(c).length === 0 && c.children.length === 0);
}
// PLB-P3 — cold-load (dv.current() undefined, no active file): no throw, no anchors.
{
  const c = makeEl('div');
  let threw = false;
  try { panel && panel.render({ current: () => undefined, container: c }); } catch (_e) { threw = true; }
  ok('PLB-P3 cold-load no throw', !threw && anchorsOf(c).length === 0);
}
// PLB-P4 — raw JSON-string frontmatter value is normalized + rendered.
{
  const c = makeEl('div');
  const dv = Object.assign(pageWith('[{"url":"https://a.com","text":"A"}]'), { container: c });
  panel && panel.render(dv);
  ok('PLB-P4 raw string value parsed', anchorsOf(c).length === 1 && anchorsOf(c)[0].href === 'https://a.com');
}
// PLB-P5 — urlless/garbage dropped + duplicate urls deduped (keep first).
{
  const c = makeEl('div');
  const dv = Object.assign(pageWith([{ text: 'no url' }, null, { url: 'https://a.com', text: 'first' }, { url: 'https://a.com', text: 'second' }]), { container: c });
  panel && panel.render(dv);
  const a = anchorsOf(c);
  ok('PLB-P5 dedup + drop urlless', a.length === 1 && a[0].href === 'https://a.com' && cardTitleOf(a[0]) === 'first');
}

// PLB-P6 — PR2 slice 2: on a type:project hub the panel mirrors the SIBLING
// Link Hub's links read-only (routes through _resolveSiblingLinks, not page.links).
{
  const c = makeEl('div');
  const dv = {
    current: () => ({ type: 'project', file: { name: 'X', folder: 'spice/projects/x', path: 'spice/projects/x/X.md' } }),
    pages: () => ({ where: (fn) => ({ array: () => [{ type: 'links-hub', links: [{ url: 'https://a.com', text: 'A' }] }].filter(fn) }) }),
    container: c,
  };
  panel && panel.render(dv);
  const a = anchorsOf(c);
  ok('PLB-P6 project-hub mirrors sibling Link Hub links', a.length === 1 && a[0].href === 'https://a.com' && cardTitleOf(a[0]) === 'A');
}
// PLB-P7 — project-hub with no sibling links renders NOTHING (no clutter / no hint).
{
  const c = makeEl('div');
  const dv = {
    current: () => ({ type: 'project', file: { name: 'Y', folder: 'spice/projects/y', path: 'spice/projects/y/Y.md' } }),
    pages: () => ({ where: () => ({ array: () => [] }) }),
    container: c,
  };
  panel && panel.render(dv);
  ok('PLB-P7 project-hub silent when no sibling links', c.children.length === 0);
}

// ─── ProjectNavButtons.detectContext links-hub branch ────────────────────────
const Nav = loadClass('platform/blueprints/project/helpers/project-nav-buttons.js', 'ProjectNavButtons');
ok('PLB-D0 ProjectNavButtons class loads', !!Nav);
const nav = Nav ? new Nav() : null;
const dvFor = (name, p) => ({ current: () => ({ file: { name, path: p } }) });

// PLB-D1 — "Links Hub.md" at the project root resolves to the links-hub context.
{
  const p = 'spice/projects/x/Links Hub.md';
  const ctx = nav && nav.detectContext(p, dvFor('Links Hub', p));
  ok('PLB-D1 Links Hub -> links-hub context',
    ctx && ctx.context === 'links-hub' && ctx.projectDir === 'spice/projects/x' && ctx.projectSlug === 'x');
}
// PLB-D2 — a Map note at the project root is NOT links-hub (branch is specific).
{
  const p = 'spice/projects/x/x - Map.md';
  const ctx = nav && nav.detectContext(p, dvFor('x - Map', p));
  ok('PLB-D2 Map note -> project-map (not links-hub)', ctx && ctx.context === 'project-map');
}
// PLB-D3 — an unrelated root note is NOT mis-detected as links-hub.
{
  const p = 'spice/projects/x/Something.md';
  const ctx = nav && nav.detectContext(p, dvFor('Something', p));
  ok('PLB-D3 unrelated note not links-hub', ctx && ctx.context !== 'links-hub');
}

// ─── ProjectNavButtons._linksHubButton (the "Helpful Links" button) ───────────
// PLB-D4 — on a project (non-hub) context with the hub note present, returns the
// button pointing at "<projectDir>/Links Hub.md" (pins the exact path string — a
// typo like "Link Hub.md" would fail here).
{
  const btn = nav && nav._linksHubButton('spice/projects/x', { context: 'project-hub' }, () => true);
  ok('PLB-D4 button path + label', btn && btn.label === 'Helpful Links' && btn.path === 'spice/projects/x/Links Hub.md');
}
// PLB-D5 — self-hidden on the links-hub note, and hidden when the hub is absent.
{
  const onHub = nav && nav._linksHubButton('spice/projects/x', { context: 'links-hub' }, () => true);
  const absent = nav && nav._linksHubButton('spice/projects/x', { context: 'project-hub' }, () => false);
  ok('PLB-D5 self-hide on hub + hide when absent', onHub === null && absent === null);
}

// ─── Manifest wiring consistency (scaffold + breadcrumb + basename agreement) ──
// PLB-M1 — the three "Links Hub" references must agree so navigation is not silently
// broken: the entity-create scaffold filename, the button/detectContext basename,
// and the registrations (breadcrumb type, customjs class, template + helper files).
{
  const man = require(path.join(ROOT, 'platform/blueprints/project/manifest.json'));
  const projEntity = (man.new_entity_buttons || []).find((b) => b.id === 'project');
  const linksExtra = projEntity && (projEntity.extra_files || []).find((f) => f.filename_pattern === 'Links Hub.md');
  const btn = nav && nav._linksHubButton('spice/projects/x', { context: 'project-hub' }, () => true);
  const btnBasename = btn && btn.path.split('/').pop();
  const bc = man.breadcrumb && man.breadcrumb.types && man.breadcrumb.types['links-hub'];
  const files = man.files || [];
  ok('PLB-M1 links-hub wiring is consistent',
    !!linksExtra &&
    linksExtra.frontmatter_template && linksExtra.frontmatter_template.type === 'links-hub' &&
    btnBasename === linksExtra.filename_pattern &&
    !!bc && bc.current && bc.current.label === 'lit:Links' &&
    (man.customjs_classes || []).includes('ProjectLinksPanel') &&
    files.some((f) => f.source === 'templates/Links Hub.md') &&
    files.some((f) => f.source === 'helpers/project-links-panel.js'));
}

// ─── ProjectLinksManager pure CRUD ops (PR2 slice 1) ──────────────────────────
// The add/edit/delete modals + processFrontMatter are dogfood-only; these pin the
// pure link-mutation logic. Loads the class from source, so reverting the helper
// fails PLM-0 (Gate B L1 red-without-fix).
{
  const PLM = loadClass('platform/blueprints/project/helpers/project-links-manager.js', 'ProjectLinksManager');
  ok('PLM-0 manager class loads', typeof PLM === 'function');

  let r = PLM.addLink([], { url: 'https://a.com', text: 'A' });
  ok('PLM-1 addLink appends normalized', r.changed && r.links.length === 1 && r.links[0].url === 'https://a.com' && r.links[0].text === 'A');
  r = PLM.addLink([{ url: 'https://a.com', text: 'A' }], { url: '  https://a.com  ', text: 'dup' });
  ok('PLM-2 addLink dedups by trimmed url', !r.changed && r.reason === 'duplicate' && r.links.length === 1);
  r = PLM.addLink([], { url: '   ', text: 'x' });
  ok('PLM-3 addLink rejects empty url', !r.changed && r.reason === 'empty-url');
  r = PLM.addLink([], { url: 'https://b.com' });
  ok('PLM-4 addLink text defaults to url', r.changed && r.links[0].text === 'https://b.com');
  const srcArr = [{ url: 'https://a.com', text: 'A' }];
  PLM.addLink(srcArr, { url: 'https://c.com', text: 'C' });
  ok('PLM-5 addLink does not mutate source', srcArr.length === 1);

  const two = [{ url: 'https://a.com', text: 'A' }, { url: 'https://b.com', text: 'B' }];
  r = PLM.updateLink(two, 1, { url: 'https://b2.com', text: 'B2' });
  ok('PLM-6 updateLink replaces at index', r.changed && r.links[1].url === 'https://b2.com' && r.links[1].text === 'B2' && r.links[0].url === 'https://a.com');
  r = PLM.updateLink(two, 1, { url: 'https://a.com', text: 'x' });
  ok('PLM-7 updateLink rejects collision with a DIFFERENT entry', !r.changed && r.reason === 'duplicate');
  r = PLM.updateLink(two, 0, { url: 'https://a.com', text: 'A-renamed' });
  ok('PLM-8 updateLink allows same-index same-url (text-only edit)', r.changed && r.links[0].text === 'A-renamed');
  r = PLM.updateLink(two, 5, { url: 'https://z.com' });
  ok('PLM-9 updateLink bad index rejected', !r.changed && r.reason === 'bad-index');

  r = PLM.deleteLink(two, 0);
  ok('PLM-10 deleteLink removes at index', r.changed && r.links.length === 1 && r.links[0].url === 'https://b.com');
  r = PLM.deleteLink(two, 9);
  ok('PLM-11 deleteLink bad index rejected', !r.changed && r.reason === 'bad-index');
  ok('PLM-12 deleteLink does not mutate source', two.length === 2);
}

// ─── ProjectLinksPanel project-hub sibling mirror (PR2 slice 2) ────────────────
// On a project hub the panel reads the SIBLING Links Hub.md's links (read-only).
{
  const PLP = loadClass('platform/blueprints/project/helpers/project-links-panel.js', 'ProjectLinksPanel');
  const panel = new PLP();
  let capturedQuery = null;
  const mkDv = (pages) => ({ pages: (q) => { capturedQuery = q; return { where: (fn) => ({ array: () => pages.filter(fn) }) }; } });
  const got = panel._resolveSiblingLinks(
    mkDv([{ type: 'links-hub', links: [{ url: 'https://a.com', text: 'A' }] }]),
    { file: { folder: 'spice/projects/x' } });
  ok('PLP-S1 resolves sibling links + scopes the query to the folder',
    got.length === 1 && got[0].url === 'https://a.com' && typeof capturedQuery === 'string' && capturedQuery.includes('spice/projects/x'));
  const none = panel._resolveSiblingLinks(mkDv([]), { file: { folder: 'spice/projects/y' } });
  ok('PLP-S2 no sibling hub -> []', Array.isArray(none) && none.length === 0);
  const noFolder = panel._resolveSiblingLinks(mkDv([{ type: 'links-hub', links: [] }]), { file: {} });
  ok('PLP-S3 no folder -> []', Array.isArray(noFolder) && noFolder.length === 0);
}

async function structuralRollbackCase() {
  const PLM = loadClass('platform/blueprints/project/helpers/project-links-manager.js', 'ProjectLinksManager');
  const manager = new PLM();
  const originalLinks = [];
  const page = { type: 'links-hub', file: { name: 'Links Hub', path: 'spice/projects/x/Links Hub.md' }, links: originalLinks };
  const noteView = makeEl('div');
  const chromeContainer = makeEl('div');
  const panelContainer = makeEl('div');
  noteView.appendChild(chromeContainer);
  noteView.appendChild(panelContainer);
  chromeContainer.closest = () => noteView;
  panel.render({ container: panelContainer, current: () => page });
  const dv = { container: chromeContainer, current: () => page };
  let rejectWrite = false;
  const optimistic = [];
  let focusRestored = false;
  const priorDocument = global.document;
  const priorRenderSafe = global.customJS.RenderSafe;
  const priorPanel = global.customJS.ProjectLinksPanel;
  const priorApp = global.app;
  global.document = { activeElement: { focus: () => { focusRestored = true; } } };
  global.customJS.RenderSafe = {
    page: () => page,
    mutateStructure: async (opts) => {
      const receipt = opts.apply();
      const visibleGrid = panelContainer.querySelector('.project-links-grid');
      optimistic.push({
        links: page.links.slice(),
        visibleGrid,
        nodes: visibleGrid ? [...visibleGrid.children] : [],
        chromeGrid: chromeContainer.querySelector('.project-links-grid'),
      });
      try { await opts.write(); return { ok: true, receipt }; }
      catch (error) { await opts.rollback(receipt, error); return { ok: false, error, receipt }; }
    },
  };
  global.customJS.ProjectLinksPanel = panel;
  const file = { path: page.file.path, fm: { links: [] } };
  global.app = {
    vault: { getAbstractFileByPath: () => file },
    fileManager: { processFrontMatter: async (target, mutate) => {
      if (rejectWrite) throw new Error('fixture write failure');
      mutate(target.fm);
    } },
    commands: { executeCommandById: () => { throw new Error('global refresh forbidden'); } },
  };
  try {
    const added = await manager._write(dv, [{ url: 'https://new.example', text: 'New' }]);
    const grid = panelContainer.querySelector('.project-links-grid');
    const committedLinks = page.links;
    const committedNodes = [...grid.children];
    ok('PLM-13 split-block add applies to the visible panel before persistence',
      added === true && optimistic[0].links[0].url === 'https://new.example'
        && optimistic[0].visibleGrid === grid && optimistic[0].nodes.length === 1);
    ok('PLM-14 split-block add never fabricates a chrome-local grid',
      optimistic[0].chromeGrid === null && chromeContainer.querySelector('.project-links-grid') === null
        && grid.parentNode === panelContainer);
    rejectWrite = true;
    const deleted = await manager._write(dv, []);
    ok('PLM-15 split-block delete is optimistic before rejected persistence',
      optimistic[1].links.length === 0 && optimistic[1].visibleGrid === grid
        && optimistic[1].nodes.length === 0 && optimistic[1].chromeGrid === null);
    ok('PLM-16 rejected split-block write restores exact links value + card node identities',
      deleted === false && page.links === committedLinks
        && grid.children.length === committedNodes.length
        && grid.children.every((node, index) => node === committedNodes[index]));
    ok('PLM-17 rejected split-block write restores focus without global refresh', focusRestored);
  } finally {
    global.document = priorDocument;
    global.customJS.RenderSafe = priorRenderSafe;
    global.customJS.ProjectLinksPanel = priorPanel;
    global.app = priorApp;
  }
}

structuralRollbackCase().then(() => {
  const allPass = results.every(([, p]) => p);
  console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
  process.exit(allPass ? 0 : 1);
}).catch((error) => { console.error(error && error.stack || error); process.exit(1); });
