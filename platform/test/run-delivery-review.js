#!/usr/bin/env node
/**
 * run-delivery-review — preflight harness for delivery:review deterministic
 * helpers (scripts/autoloop/delivery-review-triage.js + delivery-review-ratify.js).
 * Zero-dep.
 */
'use strict';
const path = require('path');
const T = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-review-triage.js'));
const R = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-review-ratify.js'));

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

// DR-CLASS-1: each card lands in its bucket. ctx carries the tracked list +
// active id set (built by triage(); here passed directly).
const ctx = {
  activeIds: new Set(['ES1 Delivery epic-slice contract']),
  tracked: [
    { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
  ],
};
function cls(card) { return T.classifyCard(card, ctx); }

ok('DR-CLASS active', cls({ card: 'ES1 Delivery epic-slice contract', status: 'in_progress' }) === 'active');
ok('DR-CLASS host', cls({ card: 'LH1 launchd job authority', status: 'parked' }) === 'suspended-evidence');
ok('DR-CLASS direct-approval',
  cls({ card: 'GA-OPS4b Transactional', status: 'parked',
        resume_condition: 'Do not resume ... unless Will explicitly approves ...' }) === 'suspended-evidence');
ok('DR-CLASS corpse',
  cls({ card: 'GA-C1a Core design tokens', status: 'parked',
        resume_condition: 'Do not resume exhausted GA-C1a.' }) === 'superseded-corpse');
ok('DR-CLASS exhausted',
  cls({ card: 'GA-C2b ChromeBar (supersedes GA-C2a)', status: 'parked',
        resume_condition: 'unless Will completes the mandatory human value review after the lineage sole superseding child exhausted its post-repair correctness quorum' }) === 'exhausted-lineage');
ok('DR-CLASS single-gate',
  cls({ card: 'ES2 Epic dashboard', status: 'parked',
        resume_condition: 'Resume only after Will explicitly authorizes adding package.json to ES2 touch zones' }) === 'single-gate-block');
ok('DR-CLASS deadend blocked',
  cls({ card: 'GA-OPS11a2 Fresh-vault bootstrap', status: 'blocked',
        resume_condition: '' }) === 'coordinator-deadend');

// DR-TRIAGE-1: full status object → actionable queue + no-action summary.
const status = {
  active: [{ card: 'ES1 Delivery epic-slice contract', status: 'in_progress' }],
  // Real coordinator `tracked` includes every projection-mapped card, and the
  // `parked` phase HAS a projection mapping (codex-coordinator.js projectionMapping),
  // so tracked always ⊇ the parked cards below. The fixture mirrors that contract.
  tracked: [
    { card: 'ES1 Delivery epic-slice contract', status: 'in_progress' },
    { card: 'LH1 launchd job authority', status: 'parked' },
    { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
    { card: 'GA-C1a Core design tokens', status: 'parked' },
    { card: 'ES2 Epic dashboard', status: 'parked' },
    { card: 'GA-C2b ChromeBar (supersedes GA-C2a)', status: 'parked' },
  ],
  parked: [
    { card: 'LH1 launchd job authority', status: 'parked', resume_condition: 'do not resume host' },
    { card: 'GA-C1a Core design tokens', status: 'parked', resume_condition: 'exhausted GA-C1a' },
    { card: 'ES2 Epic dashboard', status: 'parked',
      resume_condition: 'Resume only after Will explicitly authorizes adding package.json to ES2 touch zones' },
    { card: 'GA-C2b ChromeBar (supersedes GA-C2a)', status: 'parked',
      resume_condition: 'Will completes the mandatory human value review after the lineage exhausted its post-repair quorum' },
  ],
  projection_problems: [],
};
const r = T.triage(status, '');
ok('DR-TRIAGE actionable excludes host+corpse',
  r.actionable.every((a) => a.bucket !== 'suspended-evidence' && a.bucket !== 'superseded-corpse'));
ok('DR-TRIAGE single-gate ranked above exhausted',
  r.actionable.findIndex((a) => a.bucket === 'single-gate-block') <
  r.actionable.findIndex((a) => a.bucket === 'exhausted-lineage'));
ok('DR-TRIAGE noAction counts frozen+superseded',
  r.noAction.frozen === 1 && r.noAction.superseded === 1);

// DR-PROV-1: PROVISIONALLY ACCEPTED headings are surfaced from FID text.
const fid = '## Foo — accepted 2026-07-20\ntext\n## Bar refresh — PROVISIONALLY ACCEPTED 2026-07-20\nmore\n';
ok('DR-PROV-1 finds provisional heading',
  T.parseProvisionalPending(fid).length === 1 && /Bar refresh/.test(T.parseProvisionalPending(fid)[0]));

// DR-RATIFY-1: flip PROPOSED heading + warning callout to accepted + success callout.
const proposed = [
  '## ES2 touch-zone authorization — PROPOSED 2026-07-20',
  '',
  "> [!warning] PROPOSED — awaiting Will's ratification",
  '> body',
  '',
  '### Basis',
].join('\n');
const flipped = R.flipRatification(proposed, 'ES2 touch-zone authorization', '2026-07-21');
ok('DR-RATIFY-1 heading flipped',
  /## ES2 touch-zone authorization — accepted 2026-07-21/.test(flipped));
ok('DR-RATIFY-1 callout flipped',
  /> \[!success\] Ratified by Will — 2026-07-21/.test(flipped) && !/PROPOSED/.test(flipped));
// DR-RATIFY-2: an unrelated PROPOSED heading is untouched.
const two = proposed + '\n## Other — PROPOSED 2026-07-20\n';
ok('DR-RATIFY-2 only named heading flips',
  /## Other — PROPOSED 2026-07-20/.test(R.flipRatification(two, 'ES2 touch-zone authorization', '2026-07-21')));
// DR-RATIFY-3: appendAmendment adds a trailing block with one blank-line separator.
ok('DR-RATIFY-3 append',
  R.appendAmendment('# FID\nbody', '## New — PROPOSED 2026-07-21\nx').endsWith('\n\n## New — PROPOSED 2026-07-21\nx'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
