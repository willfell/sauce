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

// DR-STEM-1: stemOf strips the trailing supersession suffix from the id token.
ok('DR-STEM-1 GA-C1a', T.stemOf('GA-C1a Core design tokens') === 'GA-C1');
ok('DR-STEM-1 GA-C9a2', T.stemOf('GA-C9a2 Icons (supersedes GA-C9a)') === 'GA-C9');
ok('DR-STEM-1 GA-OPS11a', T.stemOf('GA-OPS11a Fresh-vault bootstrap') === 'GA-OPS11');

// DR-CORPSE-1: a parked card whose deployed sibling supersedes it → corpse.
const tracked = [
  { card: 'GA-C1a Core design tokens', status: 'parked' },
  { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
  { card: 'GA-C2a ChromeBar adoption', status: 'parked' },
  { card: 'GA-C2b ChromeBar adoption (supersedes GA-C2a)', status: 'parked' },
];
ok('DR-CORPSE-1 C1a is a corpse (C1c deployed)',
  T.hasDeployedSupersedingSibling({ card: 'GA-C1a Core design tokens' }, tracked) === true);
ok('DR-CORPSE-2 C2a NOT a corpse (C2b also parked)',
  T.hasDeployedSupersedingSibling({ card: 'GA-C2a ChromeBar adoption' }, tracked) === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
