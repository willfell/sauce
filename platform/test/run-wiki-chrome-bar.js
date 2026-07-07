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
// WCB-DISPATCH — new-page/new-section → EntityCreate.create(instance); move → WikiLeafActions._openMoveDialog.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
    WikiLeafActions: { _openMoveDialog: (dv, p) => calls.push({ move: p }) },
  };
  const dv = { current: () => ({ file: { path: 'spice/wiki/Foo/Bar.md' } }) };
  cfg.dispatch(dv, { context: 'wiki-hub' }, 'new-page');
  cfg.dispatch(dv, { context: 'wiki-hub' }, 'new-section');
  cfg.dispatch(dv, { context: 'wiki-page' }, 'move');
  global.customJS = prevCJS;
  ok('WCB-DISPATCH-1 new-page → EntityCreate.create(instance:"wiki-page")', calls.some((c) => c.create === 'wiki-page'));
  ok('WCB-DISPATCH-2 new-section → EntityCreate.create(instance:"wiki-section")', calls.some((c) => c.create === 'wiki-section'));
  ok('WCB-DISPATCH-3 move → WikiLeafActions._openMoveDialog(dv, currentPath)', calls.some((c) => c.move === 'spice/wiki/Foo/Bar.md'));
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
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
