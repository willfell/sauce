#!/usr/bin/env node
/**
 * run-cowork-note-chrome.js — consistency-audit C3 regression guard for cowork.
 *
 * note-chrome: content section headers must use SectionLabel, never a markdown
 * heading — including Dataview's `dv.header(3, …)` (which emits an <h3>). The
 * cowork hub-card helpers (daily/weekly/monthly/lens-shift) rendered a per-group
 * dv.header(3, …); they now call window.customJS.SectionLabel.render(dv, {text}).
 * cowork gained a section-label dependency (already subscribed everywhere via the
 * project/to-do blueprints). This harness asserts no cowork helper calls
 * dv.header( and that the converted helpers use SectionLabel; reverting a
 * conversion makes it red.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const HELPERS = path.join(ROOT, 'platform', 'blueprints', 'cowork', 'helpers');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const files = fs.existsSync(HELPERS) ? fs.readdirSync(HELPERS).filter((f) => f.endsWith('.js')) : [];
ok('CNC-0 found cowork helper files', files.length > 0);

// CNC-1: no cowork helper calls dv.header( (note-chrome: use SectionLabel).
const offenders = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(HELPERS, f), 'utf8');
  if (/\bdv\.header\s*\(/.test(text)) offenders.push(f);
}
if (offenders.length) console.log('  dv.header offenders:\n    ' + offenders.join('\n    '));
ok('CNC-1 no cowork helper calls dv.header( (use SectionLabel)', offenders.length === 0);

// CNC-2: the four converted hub-card helpers reference SectionLabel.render.
for (const f of ['cowork-daily-hub-cards.js', 'cowork-weekly-hub-cards.js', 'cowork-monthly-hub-cards.js', 'cowork-lens-shift-cards.js']) {
  const fp = path.join(HELPERS, f);
  if (!fs.existsSync(fp)) { ok(`CNC-2 ${f} present`, false); continue; }
  ok(`CNC-2 ${f} uses SectionLabel.render`, /customJS\.SectionLabel\.render\s*\(/.test(fs.readFileSync(fp, 'utf8')));
}

// CNC-3: cowork manifest declares the section-label dependency (so the resolver
// is installed wherever cowork is).
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'cowork', 'manifest.json'), 'utf8'));
ok('CNC-3 cowork depends_on section-label', (man.depends_on || []).some((d) => d.name === 'section-label'));

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed (${files.length} cowork helpers scanned)`);
process.exit(allPass ? 0 : 1);
