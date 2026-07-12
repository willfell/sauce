#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const HomeChromeBar = loadClass('platform/blueprints/home/helpers/home-chrome-bar.js', 'HomeChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// HCB-1: detect() — matches ONLY spice/home/Home.md.
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  const hit = cfg.detect({}, { type: 'home', file: { path: 'spice/home/Home.md', name: 'Home' } });
  ok('HCB-1a detect() matches spice/home/Home.md', !!hit);
  const miss = cfg.detect({}, { type: 'cowork-daily', file: { path: 'spice/daily/2026-07-08.md', name: '2026-07-08' } });
  ok('HCB-1b detect() returns null for a non-Home page', miss === null);
}
// HCB-2: surfaceSpec() — no primary, no overflow (Home's own bespoke capture menu stays untouched).
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  const spec = cfg.surfaceSpec({});
  ok('HCB-2 surfaceSpec has no primary and empty overflow', spec.primary === null && Array.isArray(spec.overflow) && spec.overflow.length === 0);
}
// HCB-3: no dayNav — Home is a single fixed page, not a per-day note.
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  ok('HCB-3 config has no dayNav key', !('dayNav' in cfg));
}
// HCB-4: destinations() — empty (Vault grid only, no "This home" section).
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  ok('HCB-4 destinations() returns []', Array.isArray(cfg.destinations({}, {})) && cfg.destinations({}, {}).length === 0);
}

const failed = results.filter(([, c]) => !c);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
process.exit(0);
