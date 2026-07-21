#!/usr/bin/env node
/**
 * run-delivery-review — preflight harness for delivery:review deterministic
 * helpers (scripts/autoloop/delivery-review-triage.js + delivery-review-ratify.js).
 * Zero-dep.
 */
'use strict';
const path = require('path');
const T = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-review-triage.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

// DR-HOST-1: the ratified NEVER-list ids are host lineage.
for (const id of ['LH1', 'LH3b', 'A5 durable host, readiness', 'GA-OPS10a Consume', 'GA-OPS10b x', 'GA-OPS4b Transactional']) {
  ok(`DR-HOST-1 host lineage: ${id}`, T.isHostLineage(id) === true);
}
// DR-HOST-2: product/ops cards are NOT host lineage.
for (const id of ['GA-C1a Core design', 'ES2 Epic dashboard', 'GA-OPS11a Fresh-vault', 'GA-H1a Regenerate']) {
  ok(`DR-HOST-2 not host: ${id}`, T.isHostLineage(id) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
