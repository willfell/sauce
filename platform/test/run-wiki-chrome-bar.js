#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const WikiChromeBar = loadClass('platform/blueprints/wiki/helpers/wiki-chrome-bar.js', 'WikiChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new WikiChromeBar();
const cfg = inst._config();

// WCB-DETECT — classify surfaces by frontmatter type; null off-surface.
{
  const hub = cfg.detect({}, { file: { path: 'spice/wiki/Wiki.md' }, type: 'wiki-hub' });
  const sec = cfg.detect({}, { file: { path: 'spice/wiki/Foo/Foo.md' }, type: 'wiki-section' });
  const page = cfg.detect({}, { file: { path: 'spice/wiki/Foo/Bar.md' }, type: 'wiki-page' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('WCB-DETECT-1 wiki-hub/section/page classify; non-wiki → null',
    hub && hub.context === 'wiki-hub' && sec && sec.context === 'wiki-section' && page && page.context === 'wiki-page' && off === null);
}
// WCB-SPEC — hub/section = New Page primary + New Section overflow, not leaf; page = leaf + Move overflow.
{
  const h = cfg.surfaceSpec({ context: 'wiki-hub' });
  const p = cfg.surfaceSpec({ context: 'wiki-page' });
  ok('WCB-SPEC-1 hub: primary new-page + overflow new-section + not leaf',
    h.primary.id === 'new-page' && h.overflow.some((o) => o.id === 'new-section') && h.leaf === false);
  ok('WCB-SPEC-2 page: leaf + primary null + overflow move',
    p.leaf === true && p.primary === null && p.overflow.length === 1 && p.overflow[0].id === 'move');
}
// WCB-DISPATCH — new-page/new-section → EntityCreate.create(instance); leaf move
// → the shared SectionExplorer.openMovePicker (Task G reroute, not WikiLeafActions).
{
  const calls = [];
  const prevCJS = global.customJS; const prevApp = global.app;
  global.customJS = {
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
    WikiLeafActions: { _openMoveDialog: (dv, p) => calls.push({ legacyMove: p }) },
    SectionExplorer: {
      openMovePicker: (o) => calls.push({ move: o && o.currentFolder }),
      sectionTargets: () => [{ folder: 'spice/wiki', label: 'Wiki (root)', depth: 0 }],
      applyDocMove: () => {},
    },
  };
  const dv = { current: () => ({ file: { path: 'spice/wiki/Foo/Bar.md' } }), pages: () => ({ array: () => [] }) };
  global.app = { workspace: { getActiveFile: () => ({ path: 'spice/wiki/Foo/Bar.md' }) } };
  cfg.dispatch(dv, { context: 'wiki-hub' }, 'new-page');
  cfg.dispatch(dv, { context: 'wiki-hub' }, 'new-section');
  cfg.dispatch(dv, { context: 'wiki-page' }, 'move');
  global.customJS = prevCJS; global.app = prevApp;
  ok('WCB-DISPATCH-1 new-page → EntityCreate.create(instance:"wiki-page")', calls.some((c) => c.create === 'wiki-page'));
  ok('WCB-DISPATCH-2 new-section → EntityCreate.create(instance:"wiki-section")', calls.some((c) => c.create === 'wiki-section'));
  ok('WCB-DISPATCH-3 leaf move → SectionExplorer.openMovePicker(currentFolder=file folder), not legacy dialog',
    calls.some((c) => c.move === 'spice/wiki/Foo') && !calls.some((c) => c.legacyMove !== undefined));
}
// WCB-DEST — destinations lead with a { section:"This wiki" } marker + a Wiki-home entry;
// the root hub omits its own Wiki entry (no self-nav).
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} }, WikiLeafActions: { _resolveSectionHub: () => ({ label: 'Foo', path: 'spice/wiki/Foo/Foo.md' }) } };
  const page = cfg.destinations({ current: () => ({ file: { path: 'spice/wiki/Foo/Bar.md' } }) }, { context: 'wiki-page', path: 'spice/wiki/Foo/Bar.md' });
  const rootHub = cfg.destinations({ current: () => ({ file: { path: 'spice/wiki/Wiki.md' } }) }, { context: 'wiki-hub', path: 'spice/wiki/Wiki.md' });
  global.customJS = prevCJS;
  ok('WCB-DEST-1 page destinations: This wiki marker + Wiki home + up-section',
    page[0] && page[0].section === 'This wiki' && page.some((e) => e && e.label === 'Wiki') && page.some((e) => e && e.label === 'Foo'));
  ok('WCB-DEST-2 root hub omits its own Wiki self-link', !rootHub.some((e) => e && e._navTarget === 'spice/wiki/Wiki.md'));
}
// WCB-SPEC-SECTION — hub/section overflow gains the shared section-management
// entries after new-section: select-docs on both; move-section + delete-section
// on a section only (NOT the root hub). New Page stays primary; New Section stays.
{
  const h = cfg.surfaceSpec({ context: 'wiki-hub' });
  const s = cfg.surfaceSpec({ context: 'wiki-section' });
  const ids = (spec) => spec.overflow.map((o) => o.id);
  ok('WCB-SPEC-3 hub: New Page primary + overflow has new-section + select-docs, NO move/delete-section',
    h.primary.id === 'new-page' &&
    ids(h).includes('new-section') && ids(h).includes('select-docs') &&
    !ids(h).includes('move-section') && !ids(h).includes('delete-section'));
  ok('WCB-SPEC-4 section: overflow has new-section, move-section, select-docs, delete-section',
    ids(s).includes('new-section') && ids(s).includes('move-section') &&
    ids(s).includes('select-docs') && ids(s).includes('delete-section'));
  ok('WCB-SPEC-5 new-section precedes move-section/select-docs/delete-section in section overflow',
    ids(s).indexOf('new-section') < ids(s).indexOf('move-section') &&
    ids(s).indexOf('new-section') < ids(s).indexOf('select-docs') &&
    ids(s).indexOf('new-section') < ids(s).indexOf('delete-section'));
}

// WCB-DISPATCH-SE — the shared section-management routes call the right
// SectionExplorer methods. Spy on customJS.SectionExplorer.* + WikiTree._buildConfig.
{
  const calls = [];
  const prevCJS = global.customJS;
  const stubConfig = { move: { rewriteOnDocMove: () => null, enumerateSectionTargets: () => [] } };
  global.customJS = {
    WikiTree: { _buildConfig: () => stubConfig },
    SectionExplorer: {
      makeAdapter: (c) => ({ __fromConfig: c }),
      enterSelectMode: (dv) => calls.push({ enterSelectMode: !!dv }),
      _openMovePickerForSection: (dv, a, sec) => calls.push({ moveSection: sec && sec.folder }),
      _openDeleteConfirm: (dv, a, sec) => calls.push({ deleteSection: sec && sec.folder }),
      openMovePicker: (o) => calls.push({ openMovePicker: o && o.title }),
      applyDocMove: () => calls.push({ applyDocMove: true }),
      sectionTargets: () => [{ folder: 'spice/wiki', label: 'Wiki (root)', depth: 0 }],
    },
  };
  const dv = {
    current: () => ({ type: 'wiki-section', title: 'Cooking', file: { path: 'spice/wiki/cooking/Cooking.md', name: 'Cooking.md' } }),
    pages: () => ({ array: () => [] }),
  };
  const prevApp = global.app;
  global.app = { workspace: { getActiveFile: () => ({ path: 'spice/wiki/cooking/Recipe.md' }) } };

  cfg.dispatch(dv, { context: 'wiki-section' }, 'select-docs');
  cfg.dispatch(dv, { context: 'wiki-section' }, 'move-section');
  cfg.dispatch(dv, { context: 'wiki-section' }, 'delete-section');
  cfg.dispatch(dv, { context: 'wiki-page' }, 'move');

  global.customJS = prevCJS;
  global.app = prevApp;

  ok('WCB-DISPATCH-4 select-docs → SectionExplorer.enterSelectMode(dv)',
    calls.some((c) => c.enterSelectMode === true));
  ok('WCB-DISPATCH-5 move-section → SectionExplorer._openMovePickerForSection(section=current folder)',
    calls.some((c) => c.moveSection === 'spice/wiki/cooking'));
  ok('WCB-DISPATCH-6 delete-section → SectionExplorer._openDeleteConfirm(section=current folder)',
    calls.some((c) => c.deleteSection === 'spice/wiki/cooking'));
  ok('WCB-DISPATCH-7 leaf move → SectionExplorer.openMovePicker (shared picker, not WikiLeafActions)',
    calls.some((c) => c.openMovePicker === 'Move to section'));
}

// WCB-DISPATCH-GUARD — never-throw: dispatch tolerates missing customJS/app.
{
  const prevCJS = global.customJS; const prevApp = global.app;
  global.customJS = {}; global.app = undefined;
  let threw = false;
  const dv = { current: () => ({ type: 'wiki-section', file: { path: 'spice/wiki/x/X.md', name: 'X.md' } }), pages: () => ({ array: () => [] }) };
  try {
    cfg.dispatch(dv, { context: 'wiki-section' }, 'select-docs');
    cfg.dispatch(dv, { context: 'wiki-section' }, 'move-section');
    cfg.dispatch(dv, { context: 'wiki-section' }, 'delete-section');
    cfg.dispatch(dv, { context: 'wiki-page' }, 'move');
  } catch (_e) { threw = true; }
  global.customJS = prevCJS; global.app = prevApp;
  ok('WCB-DISPATCH-8 new section-management dispatch branches never throw when deps absent', !threw);
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
