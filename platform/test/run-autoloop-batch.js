#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const batch = require('../../scripts/autoloop/batch-runner');
const coordinator = require('../../scripts/autoloop/codex-coordinator');
const delivery = require('../mechanisms/delivery');

let passed = 0;
function ok(value, label) { assert.ok(value, label); passed += 1; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); passed += 1; }
function throws(fn, pattern, label) { assert.throws(fn, pattern, label); passed += 1; }

function tempContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-autoloop-batch-'));
  const commonDir = path.join(root, '.git');
  const stateDir = path.join(commonDir, 'sauce-autoloop');
  const batchesDir = path.join(stateDir, 'batches');
  fs.mkdirSync(batchesDir, { recursive: true });
  const ctx = {
    root, commonDir, stateDir, batchesDir,
    ledgerPath: path.join(batchesDir, 'current.json'),
    lockPath: path.join(batchesDir, 'batch.lock'),
    coordinatorStatePath: path.join(stateDir, 'state.json'),
    boardPath: path.join(root, 'sauce-board.md'),
    cardsRoot: path.join(root, 'tasks'),
    intakeRoots: [root],
    haltPath: path.join(root, '.autoloop-halt'),
  };
  fs.mkdirSync(ctx.cardsRoot, { recursive: true });
  fs.writeFileSync(ctx.coordinatorStatePath, `${JSON.stringify({ schema_version: 1, cards: {} }, null, 2)}\n`);
  fs.writeFileSync(ctx.boardPath, '## In Planning\n\n## In Progress\n\n## Blocked\n\n## Completed\n');
  return ctx;
}

const fixed = {
  now: () => '2026-07-17T12:00:00.000Z',
  randomBytes: (size) => Buffer.alloc(size, 0xab),
  engineRevision: () => '1'.repeat(40),
  pidAlive: () => false,
  hostname: 'test-host',
};

function makeCard(name, policy = 'continue') {
  return [
    '---', 'schema_version: 1.0.0', `card: ${name}`, 'parent_card: Parent', 'slice: S1',
    'model_profile: heavy', 'execution_mode: release', 'status: planning', `batch_policy: ${policy}`,
    'touch_zones:', `  - platform/${name.toLowerCase()}`, 'depends_on: []', 'deploy_subscriptions:',
    '  headspace: []', '  accuris: []', '  ero: []', 'epic: Epic',
    'evidence:', '  - source_identity: test', '    captured_at: 2026-07-17T12:00:00Z',
    '    revision: rev-1', '    locator: test:1', '    claim: Test claim.',
    'risk_dimensions: []', 'release_required: true', 'deployment_required: true', '---', '',
  ].join('\n');
}

function board(planning, completed = []) {
  return [
    '## In Planning', ...planning.map((card) => `- [ ] [[${card}]]`), '',
    '## In Progress', '', '## Blocked', '',
    '## Completed', ...completed.map((card) => `- [x] [[${card}]]`), '',
  ].join('\n');
}

// Defaults are the certified two-card preset while five cards/eight hours remain hard ceilings.
{
  const ctx = tempContext();
  const started = batch.start(ctx, {}, fixed);
  eq(started.action, 'started', 'start creates a durable batch');
  eq(started.ledger.budgets.max_distinct_cards, 2, 'start defaults to the two-card preset');
  eq(started.ledger.budgets.duration_seconds, 28800, 'start defaults to the eight-hour ceiling');
  eq(started.ledger.deadline_at, '2026-07-17T20:00:00.000Z', 'deadline is absolute wall-clock state');
  eq(started.ledger.engine_revision, '1'.repeat(40), 'engine revision is pinned');
  eq(started.ledger.contract_version, delivery.CONTRACT_VERSION, 'Delivery contract version is pinned');
  eq(started.ledger.batch_id, `batch-${'ab'.repeat(32)}`, 'batch identity uses 256 bits');
  eq(started.ledger.attempt_id, `attempt-${'ab'.repeat(32)}`, 'attempt identity uses 256 bits');
  ok(batch.validateLedger(started.ledger).ok, 'fresh ledger validates');
  const firstBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  const repeated = batch.start(ctx, {}, fixed);
  eq(repeated.action, 'already-started', 'repeated start is idempotent');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), firstBytes, 'repeated start is a byte no-op');
  throws(() => batch.start(ctx, { max_cards: 3 }, fixed), /different immutable configuration/, 'start refuses budget mutation');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

for (const [opts, pattern, label] of [
  [{ max_cards: 6 }, /max_cards.*5/, 'five-card ceiling'],
  [{ duration_seconds: 28801 }, /duration_seconds.*28800/, 'eight-hour ceiling'],
  [{ max_infra_retries: 2 }, /max_infra_retries.*1/, 'one infra retry ceiling'],
  [{ max_code_repairs: 2 }, /max_code_repairs.*1/, 'one code repair ceiling'],
  [{ max_model_turns: 0 }, /max_model_turns/, 'positive usage budget'],
  [{ max_intervention_weight: -1 }, /max_intervention_weight/, 'nonnegative intervention budget'],
]) {
  const ctx = tempContext();
  throws(() => batch.start(ctx, opts, fixed), pattern, `start rejects ${label}`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Status never writes; stop and resume preserve identity, deadline, pins, budgets, counters, and receipts.
{
  const ctx = tempContext();
  const original = batch.start(ctx, { max_cards: 3, max_model_turns: 24, max_intervention_weight: 1.5 }, fixed).ledger;
  const beforeStatus = fs.readFileSync(ctx.ledgerPath, 'utf8');
  eq(batch.status(ctx, fixed).ledger.batch_id, original.batch_id, 'status reads the current identity');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), beforeStatus, 'status is byte-for-byte read-only');
  const stopped = batch.stop(ctx, { reason: 'operator request' }, fixed);
  eq(stopped.ledger.phase, 'stopped', 'stop records a graceful stop');
  const stoppedBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  eq(batch.stop(ctx, { reason: 'ignored duplicate' }, fixed).action, 'already-stopped', 'stop is idempotent');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), stoppedBytes, 'repeated stop is a byte no-op');
  const resumed = batch.resume(ctx, {}, { ...fixed, now: () => '2026-07-17T13:00:00.000Z' });
  eq(resumed.ledger.phase, 'running', 'resume returns the same batch to running');
  for (const field of ['batch_id', 'attempt_id', 'started_at', 'deadline_at', 'engine_revision', 'contract_version', 'budgets', 'counters', 'effects']) {
    eq(resumed.ledger[field], original[field], `resume preserves ${field}`);
  }
  const resumedBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  eq(batch.resume(ctx, {}, fixed).action, 'already-running', 'resume is idempotent');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), resumedBytes, 'repeated resume is a byte no-op');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// A stopped batch never reloads changed control-plane code or a changed shared contract.
{
  const ctx = tempContext();
  batch.start(ctx, {}, fixed); batch.stop(ctx, {}, fixed);
  throws(() => batch.resume(ctx, {}, { ...fixed, engineRevision: () => '2'.repeat(40) }),
    /engine revision changed during batch/, 'resume refuses a changed engine revision');
  const ledger = batch.readLedger(ctx); ledger.contract_version = '0.9.0'; ledger.integrity = batch.integrityFor(ledger);
  batch.atomicWriteJson(ctx.ledgerPath, ledger);
  throws(() => batch.resume(ctx, {}, fixed), /Delivery contract version changed during batch/,
    'resume refuses a changed Delivery contract version');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Malformed ledgers and interrupted atomic writes preserve the last authoritative bytes.
{
  const ctx = tempContext();
  const malformed = '{"schema_version":';
  fs.writeFileSync(ctx.ledgerPath, malformed);
  throws(() => batch.status(ctx, fixed), /malformed.*preserve/, 'malformed ledger fails closed');
  throws(() => batch.start(ctx, {}, fixed), /malformed.*preserve/, 'start never overwrites malformed state');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), malformed, 'malformed bytes remain untouched');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
{
  const ctx = tempContext();
  batch.start(ctx, {}, fixed);
  const authoritative = fs.readFileSync(ctx.ledgerPath, 'utf8');
  const next = { ...batch.readLedger(ctx), phase: 'stopped' };
  next.integrity = batch.integrityFor(next);
  throws(() => batch.atomicWriteJson(ctx.ledgerPath, next, { fail_after_sync: true }), /fault after sync/, 'fault injection interrupts before rename');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), authoritative, 'pre-rename fault preserves authoritative ledger');
  ok(fs.readdirSync(ctx.batchesDir).some((name) => name.endsWith('.tmp')), 'fault leaves recovery evidence');
  eq(batch.status(ctx, fixed).ledger.phase, 'running', 'orphan temp does not replace authoritative state');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Locks fail closed while live/ambiguous and recover only proven stale ownership.
{
  const ctx = tempContext();
  fs.mkdirSync(ctx.lockPath);
  fs.writeFileSync(path.join(ctx.lockPath, 'owner.json'), JSON.stringify({ pid: 42, host: 'test-host', started_at: '2026-07-17T11:59:59Z' }));
  throws(() => batch.withBatchLock(ctx, () => null, { ...fixed, pidAlive: () => true }), /lock.*held/, 'live lock is never reclaimed');
  fs.rmSync(ctx.lockPath, { recursive: true, force: true });
  fs.mkdirSync(ctx.lockPath);
  fs.writeFileSync(path.join(ctx.lockPath, 'owner.json'), JSON.stringify({ pid: 42, host: 'test-host', started_at: '2026-07-17T10:00:00Z' }));
  throws(() => batch.withBatchLock(ctx, () => null, fixed), /stale batch lock.*explicit recovery/, 'dead stale lock is detected but never destructively reclaimed');
  fs.rmSync(ctx.lockPath, { recursive: true, force: true });
  fs.mkdirSync(ctx.lockPath);
  throws(() => batch.withBatchLock(ctx, () => null, fixed), /ambiguous batch lock/, 'fresh ownerless lock fails closed');
  fs.utimesSync(ctx.lockPath, new Date('2026-07-17T10:00:00Z'), new Date('2026-07-17T10:00:00Z'));
  throws(() => batch.withBatchLock(ctx, () => null, fixed), /ambiguous batch lock/, 'old ownerless lock remains ambiguous');
  fs.rmSync(ctx.lockPath, { recursive: true, force: true });
  fs.mkdirSync(ctx.lockPath);
  fs.writeFileSync(path.join(ctx.lockPath, 'owner.json'), JSON.stringify({ pid: 42, host: 'other-host', started_at: '2026-07-17T10:00:00Z' }));
  throws(() => batch.withBatchLock(ctx, () => null, fixed), /ambiguous batch lock.*foreign host/, 'foreign-host lock is never reclaimed');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Readiness rejects every specified unsafe state without creating a ledger.
for (const [mutate, pattern, label] of [
  [(ctx) => fs.writeFileSync(ctx.haltPath, ''), /halt sentinel/, 'halt sentinel'],
  [(ctx) => fs.writeFileSync(ctx.coordinatorStatePath, '{'), /coordinator state is malformed/, 'malformed coordinator state'],
  [(ctx) => fs.writeFileSync(path.join(ctx.root, '.card-intake.pending'), 'x'), /incomplete intake transaction/, 'incomplete intake artifact'],
  [(ctx) => fs.writeFileSync(ctx.coordinatorStatePath, JSON.stringify({ schema_version: 1, cards: { A: { card: 'A', phase: 'implementing' } } })), /active coordinator work/, 'active coordinator ambiguity'],
]) {
  const ctx = tempContext(); mutate(ctx);
  throws(() => batch.start(ctx, {}, fixed), pattern, `readiness rejects ${label}`);
  ok(!fs.existsSync(ctx.ledgerPath), `${label} creates no batch ledger`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Exhaustion and ledger tampering never reset or silently continue on resume.
for (const [mutate, pattern, label] of [
  [(ledger) => { ledger.counters.distinct_cards = ['A', 'B']; }, /distinct-card budget exhausted/, 'card budget'],
  [(ledger) => { ledger.counters.infra_retries = 1; }, /infra retry budget exhausted/, 'infra budget'],
  [(ledger) => { ledger.counters.code_repairs = 1; }, /code repair budget exhausted/, 'repair budget'],
  [(ledger) => { ledger.counters.model_turns = ledger.budgets.max_model_turns; }, /usage budget exhausted/, 'usage budget'],
  [(ledger) => { ledger.counters.intervention_weight = ledger.budgets.max_intervention_weight; }, /intervention budget exhausted/, 'intervention budget'],
]) {
  const ctx = tempContext();
  batch.start(ctx, {}, fixed); batch.stop(ctx, {}, fixed);
  const ledger = batch.readLedger(ctx); mutate(ledger); ledger.integrity = batch.integrityFor(ledger); batch.atomicWriteJson(ctx.ledgerPath, ledger);
  throws(() => batch.resume(ctx, {}, fixed), pattern, `resume refuses exhausted ${label}`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
{
  const ctx = tempContext();
  batch.start(ctx, {}, fixed);
  const ledger = batch.readLedger(ctx); ledger.budgets.max_distinct_cards = 5;
  batch.atomicWriteJson(ctx.ledgerPath, ledger);
  throws(() => batch.status(ctx, fixed), /integrity mismatch/, 'immutable budget tampering fails closed');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Even self-consistent/rehashed malformed state fails structural and derived-value validation.
for (const [mutate, pattern, label] of [
  [(ledger) => { ledger.counters.infra_retries = '1'; }, /infra_retries/, 'nonnumeric retry counter'],
  [(ledger) => { delete ledger.counters.code_repairs; }, /code_repairs/, 'missing repair counter'],
  [(ledger) => { ledger.counters.model_turns = -1; }, /model_turns/, 'negative usage counter'],
  [(ledger) => { ledger.counters.intervention_weight = NaN; }, /intervention_weight/, 'nonfinite intervention counter'],
  [(ledger) => { ledger.counters.distinct_cards = ['A', 'A']; }, /distinct_cards/, 'duplicate distinct-card accounting'],
  [(ledger) => { ledger.counters.failure_signatures = [42]; }, /failure_signatures/, 'nonstrig failure signature'],
  [(ledger) => { ledger.effects = []; }, /effects/, 'array effects registry'],
  [(ledger) => { ledger.deadline_at = 'tomorrow'; }, /deadline_at/, 'malformed deadline'],
  [(ledger) => { ledger.deadline_at = '2026-07-17T19:59:59.000Z'; }, /deadline_at/, 'deadline inconsistent with immutable duration'],
]) {
  const ledger = batch.createLedger({}, fixed); mutate(ledger); ledger.integrity = batch.integrityFor(ledger);
  const validation = batch.validateLedger(ledger);
  ok(!validation.ok && validation.errors.some((error) => pattern.test(error)), `rehashed malformed ledger rejects ${label}`);
}

// One allowlisted retry and one repair are durable; duplicate or unknown failures stop.
{
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  const first = batch.recordFailure(ctx, { kind: 'infra', signature: 'network:reset' }, fixed);
  eq(first.action, 'retry', 'first allowlisted infrastructure failure may retry');
  eq(batch.readLedger(ctx).counters.infra_retries, 1, 'infra retry is durably counted');
  eq(batch.recordFailure(ctx, { kind: 'infra', signature: 'network:reset' }, fixed).action, 'stop', 'same normalized signature twice stops');
  const repair = batch.recordFailure(ctx, { kind: 'code', signature: 'assert:a1' }, fixed);
  eq(repair.action, 'repair', 'first code failure may repair once');
  eq(batch.readLedger(ctx).counters.code_repairs, 1, 'code repair is durably counted');
  eq(batch.recordFailure(ctx, { kind: 'code', signature: 'assert:a1' }, fixed).action, 'stop', 'same code defect after repair stops');
  eq(batch.recordFailure(ctx, { kind: 'mixed', signature: 'mixed' }, fixed).action, 'stop', 'mixed failures stop');
  eq(batch.recordFailure(ctx, { kind: 'unknown', signature: 'unknown' }, fixed).action, 'stop', 'unknown failures stop');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Every side-effect class has a durable idempotency key and uncertain state is inspected, never repeated.
{
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  for (const kind of ['claim', 'retry', 'pr', 'release', 'promotion', 'deployment', 'projection']) {
    const reserved = batch.reserveEffect(ctx, { kind, key: `${kind}:42` }, fixed);
    ok(reserved.execute, `${kind} executes once`);
    ok(batch.readLedger(ctx).effects[`${kind}:${kind}:42`], `${kind} reservation is durable before execution`);
    const uncertain = batch.reserveEffect(ctx, { kind, key: `${kind}:42` }, fixed);
    eq(uncertain.action, 'inspect', `${kind} pending state is inspected before retry`);
    batch.completeEffect(ctx, { kind, key: `${kind}:42`, receipt: `${kind}-receipt` }, fixed);
    eq(batch.readLedger(ctx).effects[`${kind}:${kind}:42`].receipt, `${kind}-receipt`, `${kind} receipt is durable`);
    const repeated = batch.reserveEffect(ctx, { kind, key: `${kind}:42` }, fixed);
    eq(repeated.action, 'already-complete', `${kind} completed state is not duplicated`);
  }
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Distinct-card, usage, and intervention accounting mutate only through the durable locked ledger.
{
  const ctx = tempContext(); batch.start(ctx, { max_cards: 2, max_model_turns: 16, max_intervention_weight: 1 }, fixed);
  eq(batch.recordDistinctCard(ctx, 'Card A', fixed).action, 'recorded', 'first distinct card records');
  eq(batch.recordDistinctCard(ctx, 'Card A', fixed).action, 'already-recorded', 'same card does not double count');
  eq(batch.recordDistinctCard(ctx, 'Card B', fixed).action, 'recorded', 'second distinct card records');
  eq(batch.recordDistinctCard(ctx, 'Card C', fixed).action, 'stop', 'third card refuses at immutable budget');
  eq(batch.recordUsage(ctx, 3, fixed).action, 'recorded', 'model usage records');
  eq(batch.readLedger(ctx).counters.model_turns, 3, 'model usage survives a new read');
  eq(batch.recordIntervention(ctx, 0.5, fixed).action, 'recorded', 'intervention weight records');
  eq(batch.readLedger(ctx).counters.intervention_weight, 0.5, 'intervention weight survives a new read');
  eq(batch.recordIntervention(ctx, 0.6, fixed).action, 'stop', 'intervention cannot exceed immutable budget');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Ten changing board snapshots match the coordinator's exact unattended candidate/refusal and mutate nothing.
{
  const cards = {
    A: makeCard('A'), B: makeCard('B'), C: makeCard('C'),
    Supervised: makeCard('Supervised', 'supervised_only'),
    Unknown: makeCard('Unknown', 'not-a-policy'),
  };
  const loadCard = (name) => cards[name] ? { path: `/cards/${name}.md`, raw: cards[name] } : null;
  const states = Array.from({ length: 10 }, (_, index) => ({ schema_version: 1, cards: index % 4 === 3
    ? { Active: { card: 'Active', phase: 'implementing', parent_card: 'Other', touch_zones: ['platform/a'] } } : {} }));
  const boards = [
    board(['A']), board(['Supervised', 'B']), board(['Missing', 'C']), board(['A', 'B']),
    board(['Unknown', 'C']), board([]), board(['B', 'A']), board(['A']), board(['Supervised']), board(['C']),
  ];
  for (let index = 0; index < 10; index += 1) {
    const before = crypto.createHash('sha256').update(JSON.stringify({ board: boards[index], state: states[index], cards })).digest('hex');
    const exact = coordinator.summarizeClaimSelection(coordinator.selectClaimCandidate({
      boardMd: boards[index], state: states[index], loadCard, supervised: false,
    }));
    const shadow = batch.shadowSelection({ boardMd: boards[index], state: states[index], loadCard });
    eq(shadow, exact, `shadow selection ${index + 1} matches coordinator exactly`);
    const after = crypto.createHash('sha256').update(JSON.stringify({ board: boards[index], state: states[index], cards })).digest('hex');
    eq(after, before, `shadow selection ${index + 1} performs no mutation`);
  }
  eq(batch.shadowSelection({ boardMd: board(['Supervised']), state: { schema_version: 1, cards: {} }, loadCard }).action,
    'no-work', 'supervised_only never enters unattended selection');
  eq(batch.shadowSelection({ boardMd: board(['Unknown']), state: { schema_version: 1, cards: {} }, loadCard }).action,
    'no-work', 'unknown batch policy fails closed');
}

console.log(`autoloop batch: ${passed} passed, 0 failed`);
