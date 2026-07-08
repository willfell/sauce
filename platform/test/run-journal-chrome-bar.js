#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const JournalChromeBar = loadClass('platform/blueprints/journal/helpers/journal-chrome-bar.js', 'JournalChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new JournalChromeBar();
const cfg = inst._config();

// JCB-DETECT
{
  const journal = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/Journal-2026-01-14.md' }, type: 'journal' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('JCB-DETECT-1 journal classifies; non-journal → null', journal && journal.context === 'journal' && off === null);
}
// JCB-SPEC — no primary/overflow, always leaf (single-surface blueprint).
{
  const j = cfg.surfaceSpec({ context: 'journal' });
  ok('JCB-SPEC-1 journal: primary null + overflow empty + leaf', j.primary === null && j.overflow.length === 0 && j.leaf === true);
}
// JCB-DISPATCH — no ids to dispatch; must never throw.
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'journal' }, 'anything'); } catch (_e) { threw = true; }
  ok('JCB-DISPATCH-1 dispatch never throws (no-op surface)', threw === false);
}
// JCB-DEST — just the section marker, no further entries (single-surface, no hub).
{
  const dest = cfg.destinations({}, { context: 'journal', path: 'spice/journal/2026/01-January/Journal-2026-01-14.md' });
  ok('JCB-DEST-1 destinations lead with This journal marker', dest[0] && dest[0].section === 'This journal');
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
