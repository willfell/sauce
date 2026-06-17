#!/usr/bin/env node
/**
 * run-breadcrumb.js — Breadcrumb mechanism guards + resolver primitives + project parity.
 *
 * Phase 1 (Task 1): relocation + manifest assertions only.
 * Phase 2 (Task 2): adds BR5+ resolver + parity assertions once Breadcrumb is
 * generalized to read from ranch/breadcrumb-registry.json.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MECH   = path.join(ROOT, 'platform', 'mechanisms', 'breadcrumb', 'breadcrumb.js');
const MAN    = path.join(ROOT, 'platform', 'mechanisms', 'breadcrumb', 'manifest.json');
const CAT    = path.join(ROOT, 'platform', 'manifest.json');
const LEGACY = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'breadcrumb.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// BR1 — mechanism file present
ok('BR1 mechanism file at platform/mechanisms/breadcrumb/breadcrumb.js', fs.existsSync(MECH));

// BR2 — legacy project-helper copy gone (single source of truth)
ok('BR2 legacy project-helper copy gone', !fs.existsSync(LEGACY));

// BR3 — manifest declares Breadcrumb class
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(MAN, 'utf8')); } catch (_e) {}
ok('BR3 mechanism manifest declares customjs_classes: ["Breadcrumb"]',
   manifest && Array.isArray(manifest.customjs_classes) && manifest.customjs_classes.includes('Breadcrumb'));

// BR4 — catalogue includes breadcrumb@0.1.0
let cat = null;
try { cat = JSON.parse(fs.readFileSync(CAT, 'utf8')); } catch (_e) {}
const catEntry = cat && Array.isArray(cat.mechanisms) && cat.mechanisms.find(m => m.name === 'breadcrumb');
ok('BR4 catalogue includes breadcrumb@0.1.0', catEntry && catEntry.version === '0.1.0');

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
