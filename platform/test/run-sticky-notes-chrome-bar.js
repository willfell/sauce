#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const StickyChromeBar = loadClass('platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js', 'StickyChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new StickyChromeBar();
const cfg = inst._config();

// SCB-DETECT — classify sticky surfaces; null off-surface.
{
  const hub = cfg.detect({}, { file: { path: 'spice/sticky-notes/Sticky.md' }, type: 'sticky-hub' });
  const day = cfg.detect({}, { file: { path: 'spice/sticky-notes/2026/07-July/2026-07-06/Sticky-Day-2026-07-06.md' }, type: 'sticky-day', day: '2026-07-06' });
  const leaf = cfg.detect({}, { file: { path: 'spice/sticky-notes/2026/07-July/2026-07-06/Sticky-2026-07-06-14-30.md' }, type: 'sticky-note', day: '2026-07-06' });
  const off = cfg.detect({}, { file: { path: 'spice/wiki/Wiki.md' }, type: 'wiki-hub' });
  ok('SCB-DETECT-1 sticky-hub/day/note classify; non-sticky → null',
    hub && hub.context === 'sticky-hub' && day && day.context === 'sticky-day'
    && leaf && leaf.context === 'sticky-note' && off === null);
}

// SCB-SPEC — surface specs match approved design.
{
  const h = cfg.surfaceSpec({ context: 'sticky-hub' });
  const d = cfg.surfaceSpec({ context: 'sticky-day' });
  const l = cfg.surfaceSpec({ context: 'sticky-note' });
  ok('SCB-SPEC-1 hub: primary Today + no overflow + not leaf',
    h.primary && h.primary.id === 'today' && h.overflow.length === 0 && h.leaf === false);
  ok('SCB-SPEC-2 day: primary new-sticky-note + overflow hub + not leaf',
    d.primary && d.primary.id === 'new-sticky-note' && d.overflow.length === 1 && d.overflow[0].id === 'hub' && d.leaf === false);
  ok('SCB-SPEC-3 note: no primary + overflow back-day,hub + leaf',
    l.primary === null && l.overflow.length === 2
    && l.overflow[0].id === 'back-day' && l.overflow[1].id === 'hub' && l.leaf === true);
}

// SCB-DISPATCH — routes to correct handlers.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
    RenderSafe: { page: () => ({ day: '2026-07-06' }) },
    ChromeBar: { openNavTarget: () => {} },
  };
  global.app = {
    workspace: { openLinkText: (p) => calls.push({ openLink: p }) },
    vault: { getAbstractFileByPath: () => null },
    plugins: { plugins: {} },
  };
  global.window = { moment: (d, f, s) => ({
    format: (fmt) => {
      if (fmt === 'YYYY-MM-DD') return '2026-07-06';
      if (fmt === 'YYYY/MM-MMMM') return '2026/07-July';
      return '2026-07-06';
    },
    isValid: () => true,
  }) };
  global.Notice = function(m) { calls.push({ notice: m }); };

  cfg.dispatch({}, { context: 'sticky-day' }, 'new-sticky-note');
  cfg.dispatch({}, { context: 'sticky-note' }, 'hub');
  cfg.dispatch({}, { context: 'sticky-note', day: '2026-07-06' }, 'back-day');

  ok('SCB-DISPATCH-1 new-sticky-note → EntityCreate.create(sticky-note)', calls.some(c => c.create === 'sticky-note'));
  ok('SCB-DISPATCH-2 hub → openLinkText(Sticky.md)', calls.some(c => c.openLink === 'spice/sticky-notes/Sticky.md'));
  ok('SCB-DISPATCH-3 back-day → openLinkText(Sticky-Day-*)', calls.some(c => c.openLink && c.openLink.includes('Sticky-Day-2026-07-06')));

  global.customJS = prevCJS;
  delete global.window;
  delete global.app;
  delete global.Notice;
}

// SCB-DEST — destinations include section marker + hub.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} }, RenderSafe: { page: () => ({ day: '2026-07-06' }) } };
  global.window = { moment: (d, f, s) => ({ format: (fmt) => fmt === 'YYYY/MM-MMMM' ? '2026/07-July' : '2026-07-06', isValid: () => true }) };
  const dests = cfg.destinations({}, { context: 'sticky-note', path: 'spice/sticky-notes/2026/07-July/2026-07-06/Sticky-2026-07-06-14-30.md', day: '2026-07-06' });
  ok('SCB-DEST-1 includes This sticky note section + Sticky Notes Hub + Day Hub',
    dests[0] && dests[0].section === 'This sticky note'
    && dests.some(e => e && e.label === 'Sticky Notes Hub')
    && dests.some(e => e && e.label === 'Day Hub'));
  global.customJS = prevCJS;
  delete global.window;
}

// SCB-CLASS — rootClass + btnClass correct.
{
  ok('SCB-CLASS-1 rootClass + btnClass',
    cfg.rootClass === 'sticky-chrome-root' && cfg.btnClass('go') === 'sticky-chrome-btn sticky-chrome-btn-go');
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
