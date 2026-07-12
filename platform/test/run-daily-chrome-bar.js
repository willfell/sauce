#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// Minimal moment-like shim (no `moment` npm dep in this project) — just enough
// for DailyChromeBar.resolveDayNav's usage: strict YYYY-MM-DD parse, isValid,
// isBefore/isAfter (day granularity), diff, format(ddd/MMM/D).
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function makeMoment(str, fmt, strict) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
  const valid = !!m;
  const date = valid ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  return {
    isValid: () => valid,
    isBefore: (other) => valid && other && other.isValid() && date.getTime() < other._time(),
    isAfter: (other) => valid && other && other.isValid() && date.getTime() > other._time(),
    diff: (other) => valid && other && other.isValid() ? date.getTime() - other._time() : NaN,
    format: (f) => {
      if (!valid) return '';
      const wd = WEEKDAYS[date.getUTCDay()];
      const mo = MONTHS[date.getUTCMonth()];
      const day = date.getUTCDate();
      if (f === 'ddd, MMM D') return `${wd}, ${mo} ${day}`;
      if (f === 'YYYY-MM-DD') return str;
      return str;
    },
    _time: () => date.getTime(),
  };
}
global.window = global.window || {};
global.window.moment = (str, fmt, strict) => makeMoment(str, fmt, strict);

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const DailyChromeBar = loadClass('platform/blueprints/daily/helpers/daily-chrome-bar.js', 'DailyChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// DCB-1: resolveDayNav — middle of the run, both neighbors exist.
{
  const dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];
  const nav = DailyChromeBar.resolveDayNav('2026-07-08', dates);
  ok('DCB-1a prevPath resolves to the nearest earlier date', nav.prevPath && nav.prevPath.includes('2026-07-07'));
  ok('DCB-1b nextPath resolves to the nearest later date', nav.nextPath && nav.nextPath.includes('2026-07-09'));
  ok('DCB-1c prevLabel is a human weekday/date string', /\w{3},\s*\w{3}\s*\d{1,2}/.test(nav.prevLabel));
}
// DCB-2: resolveDayNav — no earlier daily note → prevPath null (grey-out).
{
  const dates = ['2026-07-08', '2026-07-09'];
  const nav = DailyChromeBar.resolveDayNav('2026-07-08', dates);
  ok('DCB-2a no earlier daily → prevPath null', nav.prevPath === null);
  ok('DCB-2b later daily still resolves', !!nav.nextPath);
}
// DCB-3: resolveDayNav — no later daily note → nextPath null (grey-out).
{
  const dates = ['2026-07-07', '2026-07-08'];
  const nav = DailyChromeBar.resolveDayNav('2026-07-08', dates);
  ok('DCB-3 no later daily → nextPath null', nav.nextPath === null);
}
// DCB-4: detect() — matches a daily-folder note, null otherwise.
{
  const inst = new DailyChromeBar();
  const cfg = inst._config();
  const hit = cfg.detect({}, { type: 'cowork-daily', file: { path: 'spice/daily/2026/07-July/Wednesday-2026-07-08.md', name: 'Wednesday-2026-07-08' } });
  ok('DCB-4a detect() matches type:cowork-daily', !!hit);
  const miss = cfg.detect({}, { type: 'home', file: { path: 'spice/home/Home.md', name: 'Home' } });
  ok('DCB-4b detect() returns null for a non-daily page', miss === null);
}
// DCB-5: surfaceSpec() — no primary, no overflow (capture stays Home's job).
{
  const inst = new DailyChromeBar();
  const cfg = inst._config();
  const spec = cfg.surfaceSpec({});
  ok('DCB-5 surfaceSpec has no primary and empty overflow', spec.primary === null && Array.isArray(spec.overflow) && spec.overflow.length === 0);
}

const failed = results.filter(([, c]) => !c);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
process.exit(0);
