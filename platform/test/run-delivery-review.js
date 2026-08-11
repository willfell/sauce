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

// DR-HOST-1: the constitutional host-suspension ids are host lineage.
for (const id of ['LH1', 'LH3b', 'A5 durable host, readiness', 'GA-OPS10a Consume', 'GA-OPS10b x', 'GA-OPS4b Transactional']) {
  ok(`DR-HOST-1 host lineage: ${id}`, T.isHostLineage(id) === true);
}
// DR-HOST-2: product/ops cards are NOT host lineage.
for (const id of ['GA-C1a Core design', 'ES2 Epic dashboard', 'GA-OPS11a Fresh-vault', 'GA-H1a Regenerate']) {
  ok(`DR-HOST-2 not host: ${id}`, T.isHostLineage(id) === false);
}

// ---------------------------------------------------------------------------
// BGR-TRIAGE-NO-CORPSES — the superseded-corpse bucket is gone. The coordinator
// owns corpse inference (reap/discard-at-mint); tombstones never appear in
// status.tracked/parked, so the triage copy is dead code and must not exist.
// ---------------------------------------------------------------------------
ok('BGR-TRIAGE-NO-CORPSES dead inference deleted (stemOf)', T.stemOf === undefined);
ok('BGR-TRIAGE-NO-CORPSES dead inference deleted (hasDeployedSupersedingSibling)',
  T.hasDeployedSupersedingSibling === undefined);

// A parked card that LOOKS like a pre-reap corpse (deployed superseding sibling
// present in tracked) is never classified superseded-corpse — post-reap that
// shape is a ledger bug, and the review surfaces it instead of hiding it.
const corpseCtx = {
  activeIds: new Set(),
  tracked: [{ card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' }],
};
ok('BGR-TRIAGE-NO-CORPSES corpse-shaped parked card is not silently buried',
  T.classifyCard({ card: 'GA-C1a Core design tokens', status: 'parked',
    resume_condition: 'Do not resume exhausted GA-C1a.' }, corpseCtx) !== 'superseded-corpse');

// DR-CLASS: parked cards classify only as genuine waits (concurrency/deploy)
// or escalations; safety buckets (active/host/done) still win first.
const ctx = {
  activeIds: new Set(['ES1 Delivery epic-slice contract']),
  tracked: [
    { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
  ],
};
function cls(card) { return T.classifyCard(card, ctx); }

ok('DR-CLASS active', cls({ card: 'ES1 Delivery epic-slice contract', status: 'in_progress' }) === 'active');
ok('DR-CLASS host', cls({ card: 'LH1 launchd job authority', status: 'parked' }) === 'suspended-evidence');
ok('DR-CLASS concurrency wait',
  cls({ card: 'GA-R5 dedup pass', status: 'parked',
        resume_condition: 'auto-resume after the touch-zone concurrency conflict with GA-R2b2 clears' }) === 'concurrency-wait');
ok('DR-CLASS deploy wait',
  cls({ card: 'GA-M2 row actions', status: 'parked',
        resume_condition: 'resume after GA-M1 deploys to the workshop via brew' }) === 'deploy-wait');
ok('DR-CLASS escalation (outside loop authority)',
  cls({ card: 'ES3 gate', status: 'parked',
        resume_condition: 'needs a Director decision on publishing outside the perimeter' }) === 'escalation');
ok('DR-CLASS escalation (legacy Will-gate text)',
  cls({ card: 'ES2 Epic dashboard', status: 'parked',
        resume_condition: 'Resume only after Will explicitly authorizes adding package.json to ES2 touch zones' }) === 'escalation');
// Explicit-approval precedence: naming Will/the Director or approval phrasing
// escalates even when the sentence uses deploy/release vocabulary — Will-gate
// subjects overlap that vocabulary heavily, and burying them in noAction.waiting
// would invert the fail-open property.
ok('DR-CLASS escalation beats deploy vocabulary (Will ratifies)',
  cls({ card: 'GA-OPS12b Release cadence', status: 'parked',
        resume_condition: 'Resume only after Will ratifies the release-cadence amendment' }) === 'escalation');
ok('DR-CLASS escalation beats deploy vocabulary (explicit approval)',
  cls({ card: 'GA-P3 Deploy plan', status: 'parked',
        resume_condition: 'Do not resume unless Will explicitly approves the deploy plan' }) === 'escalation');
ok('DR-CLASS genuine deploy-wait survives the guard',
  cls({ card: 'GA-M3 Receipts wait', status: 'parked',
        resume_condition: 'Resume when v0.260.0 reaches brew and the three vault receipts land' }) === 'deploy-wait');
ok('DR-CLASS auxiliary "will" does not trip the approval guard',
  cls({ card: 'GA-R7 Zone wait', status: 'parked',
        resume_condition: 'the coordinator will auto-resume after the touch-zone conflict clears' }) === 'concurrency-wait');
ok('DR-CLASS deadend blocked',
  cls({ card: 'GA-OPS11a2 Fresh-vault bootstrap', status: 'blocked',
        resume_condition: '' }) === 'coordinator-deadend');

// DR-CLASS done: a completed card is finished work, not actionable.
ok('DR-CLASS done', cls({ card: 'GA-S1a Wire and guard orphan harnesses', status: 'completed' }) === 'done');

// DR-DONE-1: triage() counts completed cards in noAction.done and never in actionable.
const doneStatus = {
  active: [],
  tracked: [{ card: 'GA-S1a Wire and guard orphan harnesses', status: 'completed' }],
  parked: [],
  projection_problems: [],
};
const dr = T.triage(doneStatus, '');
ok('DR-DONE-1 completed → noAction.done', dr.noAction.done === 1);
ok('DR-DONE-1 completed not in actionable', dr.actionable.every((a) => a.card !== 'GA-S1a Wire and guard orphan harnesses'));

// DR-TRIAGE-1: post-reap status object → actionable queue + no-action summary.
// No superseded corpses exist in parked[] (the coordinator reaps them); parked
// cards are genuine waits or escalations only.
const status = {
  active: [{ card: 'ES1 Delivery epic-slice contract', status: 'in_progress' }],
  // Real coordinator `tracked` includes every projection-mapped card, and the
  // `parked` phase HAS a projection mapping (codex-coordinator.js projectionMapping),
  // so tracked always ⊇ the parked cards below. The fixture mirrors that contract.
  tracked: [
    { card: 'ES1 Delivery epic-slice contract', status: 'in_progress' },
    { card: 'LH1 launchd job authority', status: 'parked' },
    { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
    { card: 'GA-R5 dedup pass', status: 'parked' },
    { card: 'GA-M2 row actions', status: 'parked' },
    { card: 'ES3 gate', status: 'parked' },
    { card: 'GA-OPS11a2 Fresh-vault bootstrap', status: 'blocked' },
  ],
  parked: [
    { card: 'LH1 launchd job authority', status: 'parked', resume_condition: 'do not resume host' },
    { card: 'GA-R5 dedup pass', status: 'parked',
      resume_condition: 'auto-resume after the touch-zone concurrency conflict with GA-R2b2 clears' },
    { card: 'GA-M2 row actions', status: 'parked',
      resume_condition: 'resume after GA-M1 deploys to the workshop via brew' },
    { card: 'ES3 gate', status: 'parked',
      resume_condition: 'needs a Director decision on publishing outside the perimeter' },
  ],
  projection_problems: [],
};
const r = T.triage(status, '');
ok('DR-TRIAGE actionable excludes host + waits',
  r.actionable.every((a) => a.bucket !== 'suspended-evidence' && a.bucket !== 'concurrency-wait' && a.bucket !== 'deploy-wait'));
ok('DR-TRIAGE noAction counts frozen/waiting/done/active',
  r.noAction.frozen === 1 && r.noAction.waiting === 2 && r.noAction.done === 1 && r.noAction.active === 1);
ok('DR-TRIAGE noAction has no superseded key', !('superseded' in r.noAction));
ok('DR-TRIAGE deadend ranked above escalation',
  r.actionable.findIndex((a) => a.bucket === 'coordinator-deadend') <
  r.actionable.findIndex((a) => a.bucket === 'escalation'));
ok('DR-TRIAGE escalation surfaced',
  r.actionable.some((a) => a.card === 'ES3 gate' && a.bucket === 'escalation'));

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
