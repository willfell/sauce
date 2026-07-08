#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const BoardsChromeBar = loadClass('platform/blueprints/boards/helpers/boards-chrome-bar.js', 'BoardsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new BoardsChromeBar();
const cfg = inst._config();

// BCB-DETECT
{
  const card = cfg.detect({}, { file: { path: 'spice/boards/cards/2026/07-July/Ship the widget.md' }, type: 'board-card' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('BCB-DETECT-1 board-card classifies; non-board → null', card && card.context === 'board-card' && off === null);
}
// BCB-SPEC — no primary/overflow, always leaf (single-surface blueprint).
{
  const c = cfg.surfaceSpec({ context: 'board-card' });
  ok('BCB-SPEC-1 board-card: primary null + overflow empty + leaf', c.primary === null && c.overflow.length === 0 && c.leaf === true);
}
// BCB-DISPATCH — no ids to dispatch; must never throw.
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'board-card' }, 'anything'); } catch (_e) { threw = true; }
  ok('BCB-DISPATCH-1 dispatch never throws (no-op surface)', threw === false);
}
// BCB-DEST — just the section marker, no further entries (no hub-and-spoke relation).
{
  const dest = cfg.destinations({}, { context: 'board-card', path: 'spice/boards/cards/2026/07-July/Ship the widget.md' });
  ok('BCB-DEST-1 destinations lead with This boards marker', dest[0] && dest[0].section === 'This boards');
  ok('BCB-DEST-2 destinations has exactly one entry (no hub link)', dest.length === 1);
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
