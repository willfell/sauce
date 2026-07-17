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
const beforeDeadline = { ...fixed, now: () => '2026-07-17T19:59:59.999Z' };
const atDeadline = { ...fixed, now: () => '2026-07-17T20:00:00.000Z' };
const afterDeadline = { ...fixed, now: () => '2026-07-17T20:00:00.001Z' };

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

// Status never writes; stop is idempotent and terminal while resume is a read-only no-op for running work.
{
  const ctx = tempContext();
  const original = batch.start(ctx, { max_cards: 3, max_model_turns: 24, max_intervention_weight: 1.5 }, fixed).ledger;
  const beforeStatus = fs.readFileSync(ctx.ledgerPath, 'utf8');
  eq(batch.status(ctx, fixed).ledger.batch_id, original.batch_id, 'status reads the current identity');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), beforeStatus, 'status is byte-for-byte read-only');
  eq(batch.resume(ctx, {}, fixed).action, 'already-running', 'resume is idempotent while already running');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), beforeStatus, 'running resume is a byte no-op');
  const stopped = batch.stop(ctx, { reason: 'operator request' }, fixed);
  eq(stopped.ledger.phase, 'stopped', 'stop records a graceful stop');
  for (const field of ['batch_id', 'attempt_id', 'started_at', 'deadline_at', 'engine_revision', 'contract_version', 'budgets', 'counters', 'effects']) {
    eq(stopped.ledger[field], original[field], `stop preserves ${field}`);
  }
  const stoppedBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  eq(batch.stop(ctx, { reason: 'ignored duplicate' }, fixed).action, 'already-stopped', 'stop is idempotent');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), stoppedBytes, 'repeated stop is a byte no-op');
  throws(() => batch.resume(ctx, {}, fixed), /stopped.*terminal/, 'resume refuses a stopped batch');
  throws(() => batch.resume(ctx, {}, fixed), /stopped.*terminal/, 'repeated resume remains refused after reload');
  throws(() => batch.start(ctx, {}, fixed), /stopped.*terminal/, 'start cannot restart a stopped batch');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), stoppedBytes, 'terminal lifecycle refusals are byte no-ops');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Runtime pins reject changed control-plane code or a changed shared contract.
{
  const ctx = tempContext();
  const ledger = batch.start(ctx, {}, fixed).ledger;
  throws(() => batch.assertPinnedRuntime(ledger, { ...fixed, engineRevision: () => '2'.repeat(40) }),
    /engine revision changed during batch/, 'runtime refuses a changed engine revision');
  ledger.contract_version = '0.9.0';
  throws(() => batch.assertPinnedRuntime(ledger, fixed), /Delivery contract version changed during batch/,
    'runtime refuses a changed Delivery contract version');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// The injected deadline boundary is strict: mutable before, exhausted at, and exhausted after.
{
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  eq(batch.recordUsage(ctx, 1, beforeDeadline).action, 'recorded', 'running ledger mutates one instant before deadline');
  eq(batch.readLedger(ctx).phase, 'running', 'pre-deadline mutation leaves the ledger running');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
for (const [deps, label] of [[atDeadline, 'exact deadline'], [afterDeadline, 'after deadline']]) {
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  throws(() => batch.recordUsage(ctx, 1, deps), /deadline budget exhausted.*stopped.*terminal/, `${label} is exhausted`);
  const reloaded = batch.readLedger(ctx);
  eq(reloaded.phase, 'stopped', `${label} durably stops the ledger`);
  eq(reloaded.stop_reason, 'deadline budget exhausted', `${label} records the deadline reason`);
  eq(reloaded.counters.model_turns, 0, `${label} does not execute usage accounting`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Status reports injected deadline exhaustion but remains byte-for-byte read-only.
{
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  const runningBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  ok(batch.status(ctx, atDeadline).budget_problems.includes('deadline budget exhausted'), 'status reports exact deadline exhaustion');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), runningBytes, 'deadline status performs no write');
  eq(batch.status(ctx, beforeDeadline).budget_problems.includes('deadline budget exhausted'), false,
    'status does not exhaust one instant before deadline');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Resume and repeated start both make the first expired encounter durable, then refuse byte-level no-ops.
for (const [firstOperation, label] of [
  [(ctx) => batch.resume(ctx, {}, atDeadline), 'resume'],
  [(ctx) => batch.start(ctx, {}, atDeadline), 'start-again'],
]) {
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  throws(() => firstOperation(ctx), /deadline budget exhausted.*stopped.*terminal/, `expired ${label} durably refuses`);
  const terminalBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  eq(batch.readLedger(ctx).phase, 'stopped', `expired ${label} survives reload`);
  throws(() => batch.resume(ctx, {}, afterDeadline), /stopped.*terminal/, `expired ${label} later resume refuses terminally`);
  throws(() => batch.start(ctx, {}, afterDeadline), /stopped.*terminal/, `expired ${label} later start refuses terminally`);
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), terminalBytes, `expired ${label} repeated lifecycle operations are byte no-ops`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Every public accounting/effect mutation stops before its updater can alter durable state.
for (const { label, setup, invoke } of [
  { label: 'infra retry', invoke: (ctx) => batch.recordFailure(ctx, { kind: 'infra', signature: 'network:expired' }, afterDeadline) },
  { label: 'code repair', invoke: (ctx) => batch.recordFailure(ctx, { kind: 'code', signature: 'assert:expired' }, afterDeadline) },
  { label: 'distinct card', invoke: (ctx) => batch.recordDistinctCard(ctx, 'Expired Card', afterDeadline) },
  { label: 'usage', invoke: (ctx) => batch.recordUsage(ctx, 1, afterDeadline) },
  { label: 'intervention', invoke: (ctx) => batch.recordIntervention(ctx, 0.5, afterDeadline) },
  { label: 'effect reservation', invoke: (ctx) => batch.reserveEffect(ctx, { kind: 'pr', key: 'pr:expired' }, afterDeadline) },
  {
    label: 'effect completion',
    setup: (ctx) => batch.reserveEffect(ctx, { kind: 'claim', key: 'claim:pending' }, beforeDeadline),
    invoke: (ctx) => batch.completeEffect(ctx, { kind: 'claim', key: 'claim:pending', receipt: 'must-not-land' }, afterDeadline),
  },
]) {
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  if (setup) setup(ctx);
  const before = batch.readLedger(ctx);
  throws(() => invoke(ctx), /deadline budget exhausted.*stopped.*terminal/, `expired ${label} refuses`);
  const stopped = batch.readLedger(ctx);
  eq(stopped.counters, before.counters, `expired ${label} does not change counters`);
  eq(stopped.effects, before.effects, `expired ${label} does not change effects or receipts`);
  eq(stopped.stop_reason, 'deadline budget exhausted', `expired ${label} records terminal reason`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// The centralized expiration check never invokes an arbitrary updater and all later mutations are byte no-ops.
{
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  let invoked = false;
  throws(() => batch.mutateLedger(ctx, () => { invoked = true; return { action: 'recorded', changed: true }; }, atDeadline),
    /deadline budget exhausted.*stopped.*terminal/, 'expired generic mutation refuses');
  eq(invoked, false, 'expired generic mutation never invokes its updater callback');
  const terminalBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  for (const [operation, label] of [
    [() => batch.recordDistinctCard(ctx, 'Later Card', afterDeadline), 'distinct-card mutation'],
    [() => batch.recordUsage(ctx, 1, afterDeadline), 'usage mutation'],
    [() => batch.recordIntervention(ctx, 0.5, afterDeadline), 'intervention mutation'],
    [() => batch.reserveEffect(ctx, { kind: 'release', key: 'release:later' }, afterDeadline), 'effect mutation'],
  ]) throws(operation, /stopped.*terminal/, `terminal ledger rejects later ${label}`);
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), terminalBytes, 'all repeated terminal mutations preserve exact ledger bytes');
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

// Exhaustion is visible at the exact boundary, and a subsequent stop remains terminal.
for (const [mutate, pattern, label] of [
  [(ledger) => { ledger.counters.distinct_cards = ['A', 'B']; }, /distinct-card budget exhausted/, 'card budget'],
  [(ledger) => { ledger.counters.infra_retries = 1; }, /infra retry budget exhausted/, 'infra budget'],
  [(ledger) => { ledger.counters.code_repairs = 1; }, /code repair budget exhausted/, 'repair budget'],
  [(ledger) => { ledger.counters.model_turns = ledger.budgets.max_model_turns; }, /usage budget exhausted/, 'usage budget'],
  [(ledger) => { ledger.counters.intervention_weight = ledger.budgets.max_intervention_weight; }, /intervention budget exhausted/, 'intervention budget'],
]) {
  const ctx = tempContext();
  batch.start(ctx, {}, fixed);
  const ledger = batch.readLedger(ctx); mutate(ledger); ledger.integrity = batch.integrityFor(ledger); batch.atomicWriteJson(ctx.ledgerPath, ledger);
  ok(batch.status(ctx, fixed).budget_problems.some((problem) => pattern.test(problem)), `status reports exhausted ${label}`);
  batch.stop(ctx, { reason: `exhausted ${label}` }, fixed);
  throws(() => batch.resume(ctx, {}, fixed), /stopped.*terminal/, `resume refuses stopped exhausted ${label}`);
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
  [(ledger) => { ledger.phase = 'paused'; }, /phase/, 'unknown lifecycle phase'],
  [(ledger) => { ledger.started_at = 'July 17, 2026'; }, /started_at/, 'noncanonical start timestamp'],
  [(ledger) => { ledger.phase = 'running'; ledger.stop_requested_at = '2026-07-17T12:01:00.000Z'; ledger.stop_reason = 'stale'; }, /running lifecycle/, 'running phase with stop metadata'],
  [(ledger) => { ledger.phase = 'stopped'; }, /stopped lifecycle/, 'stopped phase without stop metadata'],
  [(ledger) => { ledger.phase = 'stopped'; ledger.stop_requested_at = 'later'; ledger.stop_reason = 'bad timestamp'; }, /stop_requested_at/, 'malformed stop timestamp'],
  [(ledger) => { ledger.phase = 'stopped'; ledger.stop_requested_at = '2026-07-17T11:59:59.000Z'; ledger.stop_reason = 'too early'; }, /stop_requested_at/, 'stop before start'],
  [(ledger) => { ledger.resumed_at = 'soon'; }, /resumed_at/, 'malformed resume timestamp'],
  [(ledger) => { ledger.resumed_at = '2026-07-17T11:59:59.000Z'; }, /resumed_at/, 'resume before start'],
  [(ledger) => { ledger.counters.infra_retries = '1'; }, /infra_retries/, 'nonnumeric retry counter'],
  [(ledger) => { delete ledger.counters.code_repairs; }, /code_repairs/, 'missing repair counter'],
  [(ledger) => { ledger.counters.model_turns = -1; }, /model_turns/, 'negative usage counter'],
  [(ledger) => { ledger.counters.intervention_weight = NaN; }, /intervention_weight/, 'nonfinite intervention counter'],
  [(ledger) => { ledger.counters.distinct_cards = ['A', 'A']; }, /distinct_cards/, 'duplicate distinct-card accounting'],
  [(ledger) => { ledger.counters.failure_signatures = [42]; }, /failure_signatures/, 'nonstrig failure signature'],
  [(ledger) => { ledger.effects = []; }, /effects/, 'array effects registry'],
  [(ledger) => { ledger.deadline_at = 'tomorrow'; }, /deadline_at/, 'malformed deadline'],
  [(ledger) => { ledger.deadline_at = '2026-07-17T19:59:59.000Z'; }, /deadline_at/, 'deadline inconsistent with immutable duration'],
  [(ledger) => { ledger.counters.distinct_cards = ['A', 'B', 'C']; }, /distinct-card.*exceeds/, 'over-budget distinct cards'],
  [(ledger) => { ledger.counters.infra_retries = 2; }, /infra retry.*exceeds/, 'over-budget infrastructure retries'],
  [(ledger) => { ledger.counters.code_repairs = 2; }, /code repair.*exceeds/, 'over-budget code repairs'],
  [(ledger) => { ledger.counters.model_turns = ledger.budgets.max_model_turns + 1; }, /model usage.*exceeds/, 'over-budget model usage'],
  [(ledger) => { ledger.counters.intervention_weight = ledger.budgets.max_intervention_weight + 0.1; }, /intervention.*exceeds/, 'over-budget intervention weight'],
]) {
  const ledger = batch.createLedger({}, fixed); mutate(ledger); ledger.integrity = batch.integrityFor(ledger);
  const validation = batch.validateLedger(ledger);
  ok(!validation.ok && validation.errors.some((error) => pattern.test(error)), `rehashed malformed ledger rejects ${label}`);
}

// One allowlisted retry and one repair are durable; a stop-class failure is terminal across reload.
{
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  const first = batch.recordFailure(ctx, { kind: 'infra', signature: 'network:reset' }, fixed);
  eq(first.action, 'retry', 'first allowlisted infrastructure failure may retry');
  eq(batch.readLedger(ctx).counters.infra_retries, 1, 'infra retry is durably counted');
  const repair = batch.recordFailure(ctx, { kind: 'code', signature: 'assert:a1' }, fixed);
  eq(repair.action, 'repair', 'first code failure may repair once');
  eq(batch.readLedger(ctx).counters.code_repairs, 1, 'code repair is durably counted');
  const terminal = batch.recordFailure(ctx, { kind: 'infra', signature: 'network:reset' }, fixed);
  eq(terminal.action, 'stop', 'same normalized signature twice stops');
  eq(terminal.ledger.phase, 'stopped', 'stop-class failure durably changes lifecycle phase');
  const terminalBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  eq(batch.readLedger(ctx).phase, 'stopped', 'terminal phase survives a fresh ledger load');
  throws(() => batch.recordFailure(ctx, { kind: 'code', signature: 'other' }, fixed), /stopped.*terminal/, 'stopped batch rejects further failure accounting');
  throws(() => batch.resume(ctx, {}, fixed), /stopped.*terminal/, 'terminal failure refuses resume');
  throws(() => batch.resume(ctx, {}, fixed), /stopped.*terminal/, 'terminal failure repeatedly refuses resume');
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), terminalBytes, 'terminal reload and resume refusals never rewrite the ledger');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
for (const [failure, label] of [
  [{ kind: 'mixed', signature: 'mixed' }, 'mixed failure'],
  [{ kind: 'unknown', signature: 'unknown' }, 'unknown failure'],
  [{ kind: 'wat', signature: 'invalid-kind' }, 'invalid failure class'],
  [{ kind: 'infra', signature: '' }, 'missing failure signature'],
]) {
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  const result = batch.recordFailure(ctx, failure, fixed);
  eq(result.action, 'stop', `${label} stops`);
  eq(batch.readLedger(ctx).phase, 'stopped', `${label} is durably terminal`);
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Zero retry/repair ceilings refuse the first matching failure without incrementing accounting.
for (const { kind, option, counter, reason } of [
  { kind: 'infra', option: 'max_infra_retries', counter: 'infra_retries', reason: 'infra budget exhausted' },
  { kind: 'code', option: 'max_code_repairs', counter: 'code_repairs', reason: 'code budget exhausted' },
]) {
  const ctx = tempContext(); batch.start(ctx, { [option]: 0 }, fixed);
  const result = batch.recordFailure(ctx, { kind, signature: `${kind}:zero-ceiling` }, fixed);
  eq(result.action, 'stop', `zero ${kind} ceiling refuses first failure`);
  const stopped = batch.readLedger(ctx);
  eq(stopped.counters[counter], 0, `zero ${kind} ceiling does not increment ${counter}`);
  eq(stopped.counters.failure_signatures, [], `zero ${kind} ceiling does not record a failure signature`);
  eq(stopped.stop_reason, reason, `zero ${kind} ceiling records its non-time budget reason`);
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

// Every accounting budget permits its exact boundary, then durably stops before exceeding it.
{
  const ctx = tempContext(); batch.start(ctx, { max_cards: 2, max_model_turns: 16, max_intervention_weight: 1 }, fixed);
  eq(batch.recordDistinctCard(ctx, 'Card A', fixed).action, 'recorded', 'first distinct card records');
  eq(batch.recordDistinctCard(ctx, 'Card A', fixed).action, 'already-recorded', 'same card does not double count');
  eq(batch.recordDistinctCard(ctx, 'Card B', fixed).action, 'recorded', 'second distinct card records');
  eq(batch.recordDistinctCard(ctx, 'Card C', fixed).action, 'stop', 'third card stops at immutable boundary');
  eq(batch.readLedger(ctx).phase, 'stopped', 'distinct-card exhaustion is terminal');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
{
  const ctx = tempContext(); batch.start(ctx, { max_model_turns: 16 }, fixed);
  eq(batch.recordUsage(ctx, 16, fixed).action, 'recorded', 'usage may reach the exact immutable boundary');
  eq(batch.readLedger(ctx).counters.model_turns, 16, 'exact usage boundary survives reload');
  eq(batch.recordUsage(ctx, 1, fixed).action, 'stop', 'usage cannot exceed immutable boundary');
  eq(batch.readLedger(ctx).phase, 'stopped', 'usage exhaustion is terminal');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}
{
  const ctx = tempContext(); batch.start(ctx, { max_intervention_weight: 1 }, fixed);
  eq(batch.recordIntervention(ctx, 1, fixed).action, 'recorded', 'intervention may reach the exact immutable boundary');
  eq(batch.readLedger(ctx).counters.intervention_weight, 1, 'exact intervention boundary survives reload');
  eq(batch.recordIntervention(ctx, 0.1, fixed).action, 'stop', 'intervention cannot exceed immutable boundary');
  eq(batch.readLedger(ctx).phase, 'stopped', 'intervention exhaustion is terminal');
  fs.rmSync(ctx.root, { recursive: true, force: true });
}

// Once stopped, every accounting or side-effect mutation refuses without changing authoritative bytes.
{
  const ctx = tempContext(); batch.start(ctx, {}, fixed);
  batch.reserveEffect(ctx, { kind: 'claim', key: 'claim:pending' }, fixed);
  batch.stop(ctx, { reason: 'bounded stop' }, fixed);
  const stoppedBytes = fs.readFileSync(ctx.ledgerPath, 'utf8');
  for (const [mutate, label] of [
    [() => batch.recordDistinctCard(ctx, 'Card A', fixed), 'distinct-card accounting'],
    [() => batch.recordUsage(ctx, 1, fixed), 'usage accounting'],
    [() => batch.recordIntervention(ctx, 0.5, fixed), 'intervention accounting'],
    [() => batch.reserveEffect(ctx, { kind: 'pr', key: 'pr:1' }, fixed), 'side-effect reservation'],
    [() => batch.completeEffect(ctx, { kind: 'claim', key: 'claim:pending', receipt: 'done' }, fixed), 'side-effect completion'],
  ]) throws(mutate, /stopped.*terminal/, `stopped batch rejects ${label}`);
  eq(fs.readFileSync(ctx.ledgerPath, 'utf8'), stoppedBytes, 'stopped accounting refusals are byte no-ops');
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
