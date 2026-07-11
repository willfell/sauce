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

// JCB-DETECT — three surfaces + non-journal off-switch.
{
  const hub = cfg.detect({}, { file: { path: 'spice/journal/Journal.md' }, type: 'journal-hub' });
  const day = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/2026-01-14/Journal-Day-2026-01-14.md' }, type: 'journal-day', day: '2026-01-14' });
  const entry = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/2026-01-14/Journal-2026-01-14-09-30-00.md' }, type: 'journal-entry', day: '2026-01-14' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('JCB-DETECT-1 journal-hub classifies', hub && hub.context === 'journal-hub');
  ok('JCB-DETECT-2 journal-day classifies + carries day', day && day.context === 'journal-day' && day.day === '2026-01-14');
  ok('JCB-DETECT-3 journal-entry classifies + carries day', entry && entry.context === 'journal-entry' && entry.day === '2026-01-14');
  ok('JCB-DETECT-4 non-journal type → null', off === null);
}
// JCB-SPEC — per-surface primary/overflow/leaf shape.
{
  const hub = cfg.surfaceSpec({ context: 'journal-hub' });
  ok('JCB-SPEC-1 journal-hub: primary=Today, leaf=false', hub.primary && hub.primary.id === 'today' && hub.leaf === false);
  const day = cfg.surfaceSpec({ context: 'journal-day' });
  ok('JCB-SPEC-2 journal-day: primary=new-journal-entry, overflow has hub, leaf=false',
    day.primary && day.primary.id === 'new-journal-entry' && day.overflow.some(o => o.id === 'hub') && day.leaf === false);
  const entry = cfg.surfaceSpec({ context: 'journal-entry' });
  ok('JCB-SPEC-3 journal-entry: primary=null, overflow has back-day+hub, leaf=true',
    entry.primary === null && entry.overflow.some(o => o.id === 'back-day') && entry.overflow.some(o => o.id === 'hub') && entry.leaf === true);
}
// JCB-DISPATCH — never throws for any known id or an unknown one.
{
  let threw = false;
  try {
    cfg.dispatch({}, { context: 'journal-day' }, 'unknown-id');
  } catch (_e) { threw = true; }
  ok('JCB-DISPATCH-1 unknown id never throws', threw === false);
}
// JCB-DEST — leads with "This journal entry" marker; includes hub when not already there.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} }, RenderSafe: { page: () => ({ day: '2026-01-14' }) } };
  global.window = { moment: (d, f, s) => ({ format: (fmt) => fmt === 'YYYY/MM-MMMM' ? '2026/01-January' : '2026-01-14', isValid: () => true }) };
  const dest = cfg.destinations({}, { context: 'journal-entry', path: 'spice/journal/2026/01-January/2026-01-14/Journal-2026-01-14-09-30-00.md', day: '2026-01-14' });
  ok('JCB-DEST-1 destinations lead with This journal entry marker', dest[0] && dest[0].section === 'This journal entry');
  ok('JCB-DEST-2 destinations include Journal Hub', dest.some(d => d.label === 'Journal Hub'));
  global.customJS = prevCJS;
  delete global.window;
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
