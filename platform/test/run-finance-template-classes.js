#!/usr/bin/env node
/**
 * run-finance-template-classes.js — consistency-audit W0 regression guard.
 *
 * Every `customJS.<Class>` invoked from a finance template/content note (via a
 * `customjs-guard` view) must resolve to a REAL class — either one the finance
 * blueprint declares in `customjs_classes[]`, or one provided by a mechanism the
 * blueprint depends_on. The audit found two templates invoking the DELETED
 * `InvoiceNavButtons` class (repointed to `FinanceNav`), which rendered an
 * "_InvoiceNavButtons unavailable_" placeholder on every new time-log note and
 * invoice-board card. Reverting that fix makes this harness red.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const FIN = path.join(ROOT, 'platform', 'blueprints', 'finance');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// Build the allowed-class set: finance's own customjs_classes ∪ every depends_on
// mechanism's customjs_classes.
const finMan = JSON.parse(fs.readFileSync(path.join(FIN, 'manifest.json'), 'utf8'));
const allowed = new Set(finMan.customjs_classes || []);
for (const dep of (finMan.depends_on || [])) {
  const depMan = path.join(ROOT, 'platform', 'mechanisms', dep.name, 'manifest.json');
  if (fs.existsSync(depMan)) {
    try {
      const m = JSON.parse(fs.readFileSync(depMan, 'utf8'));
      for (const c of (m.customjs_classes || [])) allowed.add(c);
    } catch (_e) { /* ignore */ }
  }
}
ok('FTC-0 finance manifest + deps loaded (allowed set non-empty)', allowed.size > 0);
ok('FTC-1 FinanceNav is a real class', allowed.has('FinanceNav'));
ok('FTC-2 InvoiceNavButtons is NOT a real class (deleted)', !allowed.has('InvoiceNavButtons'));

// Scan every finance template + content note for customjs-guard class refs.
const dirs = ['templates', 'content'].map((d) => path.join(FIN, d));
const files = [];
for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) files.push(path.join(d, f));
}
ok('FTC-3 found finance template/content notes to scan', files.length > 0);

const refRe = /customjs-guard"?\s*,\s*\{\s*class:\s*"([A-Za-z0-9_]+)"/g;
const dead = [];
let refCount = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = refRe.exec(text)) !== null) {
    refCount++;
    const cls = m[1];
    if (!allowed.has(cls)) dead.push(`${path.relative(ROOT, f)} -> ${cls}`);
  }
}
ok('FTC-4 at least one class ref scanned', refCount > 0);
if (dead.length) { console.log('  DEAD REFS:\n    ' + dead.join('\n    ')); }
ok('FTC-5 no finance note references a non-existent customJS class', dead.length === 0);

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed (${refCount} class refs across ${files.length} notes)`);
process.exit(allPass ? 0 : 1);
