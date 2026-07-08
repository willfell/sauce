#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const ScratchChromeBar = loadClass('platform/blueprints/scratch/helpers/scratch-chrome-bar.js', 'ScratchChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ScratchChromeBar();
const cfg = inst._config();

// SCB-DETECT — classify scratch surfaces; null off-surface.
{
  const hub = cfg.detect({}, { file: { path: 'spice/scratch/Scratch.md' }, type: 'scratch-hub' });
  const day = cfg.detect({}, { file: { path: 'spice/scratch/2026/07-July/2026-07-06/Scratch-Day-2026-07-06.md' }, type: 'scratch-day', day: '2026-07-06' });
  const leaf = cfg.detect({}, { file: { path: 'spice/scratch/2026/07-July/2026-07-06/Scratch-2026-07-06-14-30.md' }, type: 'scratch', day: '2026-07-06' });
  const off = cfg.detect({}, { file: { path: 'spice/wiki/Wiki.md' }, type: 'wiki-hub' });
  ok('SCB-DETECT-1 scratch-hub/day/leaf classify; non-scratch → null',
    hub && hub.context === 'scratch-hub' && day && day.context === 'scratch-day'
    && leaf && leaf.context === 'scratch' && off === null);
}

// SCB-SPEC — surface specs match approved design.
{
  const h = cfg.surfaceSpec({ context: 'scratch-hub' });
  const d = cfg.surfaceSpec({ context: 'scratch-day' });
  const l = cfg.surfaceSpec({ context: 'scratch' });
  ok('SCB-SPEC-1 hub: primary Today + no overflow + not leaf',
    h.primary && h.primary.id === 'today' && h.overflow.length === 0 && h.leaf === false);
  ok('SCB-SPEC-2 day: primary new-scratch + overflow hub + not leaf',
    d.primary && d.primary.id === 'new-scratch' && d.overflow.length === 1 && d.overflow[0].id === 'hub' && d.leaf === false);
  ok('SCB-SPEC-3 leaf: no primary + overflow back-day,hub + leaf',
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

  cfg.dispatch({}, { context: 'scratch-day' }, 'new-scratch');
  cfg.dispatch({}, { context: 'scratch' }, 'hub');
  cfg.dispatch({}, { context: 'scratch', day: '2026-07-06' }, 'back-day');

  ok('SCB-DISPATCH-1 new-scratch → EntityCreate.create(scratch)', calls.some(c => c.create === 'scratch'));
  ok('SCB-DISPATCH-2 hub → openLinkText(Scratch.md)', calls.some(c => c.openLink === 'spice/scratch/Scratch.md'));
  ok('SCB-DISPATCH-3 back-day → openLinkText(Scratch-Day-*)', calls.some(c => c.openLink && c.openLink.includes('Scratch-Day-2026-07-06')));

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
  const dests = cfg.destinations({}, { context: 'scratch', path: 'spice/scratch/2026/07-July/2026-07-06/Scratch-2026-07-06-14-30.md', day: '2026-07-06' });
  ok('SCB-DEST-1 includes This scratch section + Scratch Hub + Day Hub',
    dests[0] && dests[0].section === 'This scratch'
    && dests.some(e => e && e.label === 'Scratch Hub')
    && dests.some(e => e && e.label === 'Day Hub'));
  global.customJS = prevCJS;
  delete global.window;
}

// SCB-CLASS — rootClass + btnClass correct.
{
  ok('SCB-CLASS-1 rootClass + btnClass',
    cfg.rootClass === 'scratch-chrome-root' && cfg.btnClass('go') === 'scratch-chrome-btn scratch-chrome-btn-go');
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
