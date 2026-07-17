#!/usr/bin/env node
/**
 * Durable Sauce batch ledger and shadow-only lifecycle controls.
 *
 * A4 intentionally does not claim or dispatch work. It persists immutable
 * budgets and exact engine/contract pins, exposes idempotent lifecycle
 * controls, and asks the coordinator's pure selector what unattended work
 * would do. Later slices may consume the exported accounting primitives.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const coordinator = require('./codex-coordinator');
const delivery = require('../../platform/mechanisms/delivery');

const LEDGER_VERSION = '1.0.0';
const MODE = 'shadow';
const HARD_MAX_CARDS = 5;
const HARD_MAX_SECONDS = 8 * 60 * 60;
const HARD_MAX_INFRA_RETRIES = 1;
const HARD_MAX_CODE_REPAIRS = 1;
const DEFAULT_MAX_CARDS = 2;
const LOCK_STALE_MS = 30 * 60 * 1000;
const TERMINAL_CARD_PHASES = new Set(['deployed', 'blocked', 'failed', 'cancelled']);
const EFFECT_KINDS = new Set(['claim', 'retry', 'pr', 'release', 'promotion', 'deployment', 'projection']);
const MAXBUF = 64 * 1024 * 1024;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowOf(deps = {}) { return (deps.now || (() => new Date().toISOString()))(); }
function engineRevisionOf(deps = {}) {
  return (deps.engineRevision || (() => execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: MAXBUF,
  }).trim()))();
}
function pidAliveDefault(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const key = token.slice(2).replace(/-/g, '_');
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? next : true;
    if (out[key] !== true) index += 1;
  }
  return out;
}

function resolveContext(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd, encoding: 'utf8', maxBuffer: MAXBUF,
  }).trim();
  const commonDir = path.resolve(cwd, common);
  const root = path.dirname(commonDir);
  const stateDir = path.join(commonDir, 'sauce-autoloop');
  const batchesDir = path.join(stateDir, 'batches');
  const home = os.homedir();
  const boardPath = path.join(home, 'notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md');
  const cardsRoot = path.join(home, 'notes/sauce/headspace-sauce/spice/projects/sauce/tasks');
  return {
    root, commonDir, stateDir, batchesDir,
    ledgerPath: path.join(batchesDir, 'current.json'),
    lockPath: path.join(batchesDir, 'batch.lock'),
    coordinatorStatePath: path.join(stateDir, 'state.json'),
    boardPath, cardsRoot, intakeRoots: [path.dirname(boardPath), cardsRoot],
    haltPath: path.join(root, '.autoloop-halt'),
  };
}

function asInteger(value, fallback, name, minimum, maximum) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function asNumber(value, fallback, name, minimum) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${name} must be a number >= ${minimum}`);
  return parsed;
}

function normalizeBudgets(options = {}) {
  const maxCards = asInteger(options.max_cards, DEFAULT_MAX_CARDS, 'max_cards', 1, HARD_MAX_CARDS);
  return {
    max_distinct_cards: maxCards,
    duration_seconds: asInteger(options.duration_seconds, HARD_MAX_SECONDS, 'duration_seconds', 1, HARD_MAX_SECONDS),
    max_infra_retries: asInteger(options.max_infra_retries, 1, 'max_infra_retries', 0, HARD_MAX_INFRA_RETRIES),
    max_code_repairs: asInteger(options.max_code_repairs, 1, 'max_code_repairs', 0, HARD_MAX_CODE_REPAIRS),
    max_model_turns: asInteger(options.max_model_turns, maxCards * 8, 'max_model_turns', 1, maxCards * 8),
    max_intervention_weight: asNumber(options.max_intervention_weight, maxCards * 0.5, 'max_intervention_weight', 0),
  };
}

function integrityFor(ledger) {
  const copy = clone(ledger);
  delete copy.integrity;
  return crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}

function createLedger(options = {}, deps = {}) {
  const budgets = normalizeBudgets(options);
  const startedAt = nowOf(deps);
  const randomBytes = deps.randomBytes || crypto.randomBytes;
  const engineRevision = engineRevisionOf(deps);
  if (!/^[0-9a-f]{40}$/i.test(engineRevision)) throw new Error('engine revision must be a full Git SHA');
  const ledger = {
    schema_version: LEDGER_VERSION,
    mode: MODE,
    phase: 'running',
    batch_id: `batch-${randomBytes(32).toString('hex')}`,
    attempt_id: `attempt-${randomBytes(32).toString('hex')}`,
    started_at: startedAt,
    deadline_at: new Date(Date.parse(startedAt) + budgets.duration_seconds * 1000).toISOString(),
    engine_revision: engineRevision,
    contract_version: delivery.CONTRACT_VERSION,
    budgets,
    counters: {
      distinct_cards: [], infra_retries: 0, code_repairs: 0,
      model_turns: 0, intervention_weight: 0, failure_signatures: [],
    },
    effects: {},
    stop_requested_at: null,
    stop_reason: null,
    resumed_at: null,
  };
  ledger.integrity = integrityFor(ledger);
  return ledger;
}

function validateLedger(value) {
  const errors = [];
  const ledger = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (ledger.schema_version !== LEDGER_VERSION) errors.push('unsupported ledger schema_version');
  if (ledger.mode !== MODE) errors.push('unknown batch policy or mode');
  if (!['running', 'stopped'].includes(ledger.phase)) errors.push('unknown batch phase');
  if (!/^batch-[0-9a-f]{64}$/.test(String(ledger.batch_id || ''))) errors.push('invalid batch identity');
  if (!/^attempt-[0-9a-f]{64}$/.test(String(ledger.attempt_id || ''))) errors.push('invalid attempt identity');
  if (!/^[0-9a-f]{40}$/i.test(String(ledger.engine_revision || ''))) errors.push('invalid engine revision');
  if (delivery.compareVersions(ledger.contract_version, ledger.contract_version) !== 0) errors.push('invalid contract version');
  try {
    const normalized = normalizeBudgets({
      max_cards: ledger.budgets && ledger.budgets.max_distinct_cards,
      duration_seconds: ledger.budgets && ledger.budgets.duration_seconds,
      max_infra_retries: ledger.budgets && ledger.budgets.max_infra_retries,
      max_code_repairs: ledger.budgets && ledger.budgets.max_code_repairs,
      max_model_turns: ledger.budgets && ledger.budgets.max_model_turns,
      max_intervention_weight: ledger.budgets && ledger.budgets.max_intervention_weight,
    });
    if (JSON.stringify(normalized) !== JSON.stringify(ledger.budgets)) errors.push('noncanonical budgets');
  } catch (err) { errors.push(err.message); }
  if (!ledger.counters || !Array.isArray(ledger.counters.distinct_cards)
    || !Array.isArray(ledger.counters.failure_signatures) || !ledger.effects || typeof ledger.effects !== 'object') {
    errors.push('malformed mutable accounting');
  }
  if (ledger.integrity !== integrityFor(ledger)) errors.push('ledger integrity mismatch');
  return { ok: errors.length === 0, errors };
}

function atomicWriteJson(file, value, faults = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (faults.fail_after_sync) throw new Error('fault after sync before atomic rename');
  fs.renameSync(tmp, file);
  const dirFd = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

function readLedger(ctx) {
  if (!fs.existsSync(ctx.ledgerPath)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(ctx.ledgerPath, 'utf8')); }
  catch (err) { throw new Error(`batch ledger is malformed; preserve and recover ${ctx.ledgerPath}: ${err.message}`); }
  const validation = validateLedger(parsed);
  if (!validation.ok) throw new Error(`batch ledger is invalid; preserve and recover ${ctx.ledgerPath}: ${validation.errors.join('; ')}`);
  return parsed;
}

function lockStale(ctx, owner, deps = {}) {
  const now = Date.parse(nowOf(deps));
  let startedAt = owner && Date.parse(owner.started_at);
  if (!Number.isFinite(startedAt)) {
    try { startedAt = fs.statSync(ctx.lockPath).mtimeMs; } catch (_) { return false; }
  }
  if (now - startedAt <= LOCK_STALE_MS) return false;
  if (!owner) return true;
  if (owner.host && owner.host !== (deps.hostname || os.hostname())) return true;
  return !(deps.pidAlive || pidAliveDefault)(Number(owner.pid));
}

function withBatchLock(ctx, fn, deps = {}) {
  fs.mkdirSync(ctx.batchesDir, { recursive: true });
  if (fs.existsSync(ctx.lockPath)) {
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(path.join(ctx.lockPath, 'owner.json'), 'utf8')); } catch (_) {}
    if (!lockStale(ctx, owner, deps)) {
      if (!owner) throw new Error('ambiguous batch lock has no readable owner');
      throw new Error(`batch lock held by pid ${owner.pid || '?'} on ${owner.host || '?'}`);
    }
    fs.rmSync(ctx.lockPath, { recursive: true, force: true });
  }
  fs.mkdirSync(ctx.lockPath);
  atomicWriteJson(path.join(ctx.lockPath, 'owner.json'), {
    pid: process.pid, host: deps.hostname || os.hostname(), started_at: nowOf(deps),
    command: process.argv.slice(2).join(' '),
  });
  try { return fn(); }
  finally { fs.rmSync(ctx.lockPath, { recursive: true, force: true }); }
}

function findReservedIntakeArtifact(roots) {
  const reserved = (name) => /^\.card-intake(?:[.-]|$)/.test(name) || /\.card-intake-.*\.tmp$/.test(name);
  for (const root of roots || []) {
    if (!root || !fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (reserved(entry.name)) return path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(path.join(dir, entry.name));
      }
    }
  }
  return null;
}

function findCard(cardsRoot, card) {
  if (!cardsRoot || !fs.existsSync(cardsRoot)) return null;
  const target = `${card}.md`; const stack = [cardsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === target) return full;
    }
  }
  return null;
}

function coordinatorSnapshot(ctx) {
  let state;
  try { state = JSON.parse(fs.readFileSync(ctx.coordinatorStatePath, 'utf8')); }
  catch (err) { throw new Error(`coordinator state is malformed; preserve and recover: ${err.message}`); }
  if (!state || state.schema_version !== 1 || !state.cards || typeof state.cards !== 'object') {
    throw new Error('coordinator state is malformed or unsupported');
  }
  const boardMd = fs.readFileSync(ctx.boardPath, 'utf8');
  const loadCard = (card) => {
    const cardPath = findCard(ctx.cardsRoot, card);
    return cardPath ? { path: cardPath, raw: fs.readFileSync(cardPath, 'utf8') } : null;
  };
  return coordinator.commandStatus(ctx, { state, boardMd, loadCard, cardsRoot: ctx.cardsRoot, supervised: false });
}

function readiness(ctx) {
  const problems = [];
  if (fs.existsSync(ctx.haltPath)) problems.push('halt sentinel is present');
  const intake = findReservedIntakeArtifact(ctx.intakeRoots);
  if (intake) problems.push(`incomplete intake transaction artifact: ${intake}`);
  const snapshot = coordinatorSnapshot(ctx);
  if (snapshot.active_count > 0) problems.push(`active coordinator work is ambiguous: ${snapshot.active.map((item) => item.card).join(', ')}`);
  if (snapshot.projection_problems.length) problems.push('coordinator projection problems require inspection');
  if (snapshot.board_drift.length) problems.push('coordinator board drift requires inspection');
  if (problems.length) throw new Error(`batch readiness failed: ${problems.join('; ')}`);
  return snapshot;
}

function budgetProblems(ledger, at = new Date().toISOString()) {
  const counters = ledger.counters; const budgets = ledger.budgets; const problems = [];
  if (Date.parse(at) >= Date.parse(ledger.deadline_at)) problems.push('deadline budget exhausted');
  if (counters.distinct_cards.length >= budgets.max_distinct_cards) problems.push('distinct-card budget exhausted');
  if (budgets.max_infra_retries > 0 && counters.infra_retries >= budgets.max_infra_retries) problems.push('infra retry budget exhausted');
  if (budgets.max_code_repairs > 0 && counters.code_repairs >= budgets.max_code_repairs) problems.push('code repair budget exhausted');
  if (counters.model_turns >= budgets.max_model_turns) problems.push('usage budget exhausted');
  if (budgets.max_intervention_weight > 0
    && counters.intervention_weight >= budgets.max_intervention_weight) problems.push('intervention budget exhausted');
  return problems;
}

function requestedConfigMatches(ledger, options) {
  const keys = ['max_cards', 'duration_seconds', 'max_infra_retries', 'max_code_repairs', 'max_model_turns', 'max_intervention_weight'];
  if (!keys.some((key) => options[key] != null)) return true;
  const requested = normalizeBudgets({
    max_cards: options.max_cards ?? ledger.budgets.max_distinct_cards,
    duration_seconds: options.duration_seconds ?? ledger.budgets.duration_seconds,
    max_infra_retries: options.max_infra_retries ?? ledger.budgets.max_infra_retries,
    max_code_repairs: options.max_code_repairs ?? ledger.budgets.max_code_repairs,
    max_model_turns: options.max_model_turns ?? ledger.budgets.max_model_turns,
    max_intervention_weight: options.max_intervention_weight ?? ledger.budgets.max_intervention_weight,
  });
  return JSON.stringify(ledger.budgets) === JSON.stringify(requested);
}

function assertPinnedRuntime(ledger, deps = {}) {
  const currentEngine = engineRevisionOf(deps);
  if (currentEngine !== ledger.engine_revision) {
    throw new Error(`engine revision changed during batch: pinned ${ledger.engine_revision}, current ${currentEngine}`);
  }
  if (delivery.CONTRACT_VERSION !== ledger.contract_version) {
    throw new Error(`Delivery contract version changed during batch: pinned ${ledger.contract_version}, current ${delivery.CONTRACT_VERSION}`);
  }
}

function start(ctx, options = {}, deps = {}) {
  return withBatchLock(ctx, () => {
    readiness(ctx);
    const existing = readLedger(ctx);
    if (existing) {
      assertPinnedRuntime(existing, deps);
      if (!requestedConfigMatches(existing, options)) throw new Error('active batch has a different immutable configuration');
      return { action: 'already-started', ledger: existing };
    }
    const ledger = createLedger(options, deps);
    atomicWriteJson(ctx.ledgerPath, ledger);
    return { action: 'started', ledger };
  }, deps);
}

function status(ctx) {
  const ledger = readLedger(ctx);
  return ledger ? { action: 'status', ledger, budget_problems: budgetProblems(ledger) } : { action: 'no-batch' };
}

function stop(ctx, options = {}, deps = {}) {
  return withBatchLock(ctx, () => {
    const ledger = readLedger(ctx);
    if (!ledger) throw new Error('no batch to stop');
    if (ledger.phase === 'stopped') return { action: 'already-stopped', ledger };
    ledger.phase = 'stopped';
    ledger.stop_requested_at = nowOf(deps);
    ledger.stop_reason = String(options.reason || 'operator request').trim();
    ledger.integrity = integrityFor(ledger);
    atomicWriteJson(ctx.ledgerPath, ledger);
    return { action: 'stopped', ledger };
  }, deps);
}

function resume(ctx, options = {}, deps = {}) {
  return withBatchLock(ctx, () => {
    readiness(ctx);
    const ledger = readLedger(ctx);
    if (!ledger) throw new Error('no batch to resume');
    assertPinnedRuntime(ledger, deps);
    if (!requestedConfigMatches(ledger, options)) throw new Error('resume cannot change immutable configuration');
    if (ledger.phase === 'running') return { action: 'already-running', ledger };
    const exhausted = budgetProblems(ledger, nowOf(deps));
    if (exhausted.length) throw new Error(`resume refused: ${exhausted.join('; ')}`);
    ledger.phase = 'running'; ledger.resumed_at = nowOf(deps);
    ledger.stop_requested_at = null; ledger.stop_reason = null;
    ledger.integrity = integrityFor(ledger);
    atomicWriteJson(ctx.ledgerPath, ledger);
    return { action: 'resumed', ledger };
  }, deps);
}

function recordFailure(input, failure) {
  const ledger = clone(input); const kind = String(failure && failure.kind || 'unknown');
  const signature = String(failure && failure.signature || '').trim();
  if (!signature || !['infra', 'code', 'mixed', 'unknown'].includes(kind)) return { action: 'stop', reason: 'unknown failure', ledger };
  if (['mixed', 'unknown'].includes(kind)) return { action: 'stop', reason: `${kind} failure`, ledger };
  if (ledger.counters.failure_signatures.includes(signature)) return { action: 'stop', reason: 'same normalized signature repeated', ledger };
  ledger.counters.failure_signatures.push(signature);
  const counter = kind === 'infra' ? 'infra_retries' : 'code_repairs';
  const limit = kind === 'infra' ? 'max_infra_retries' : 'max_code_repairs';
  if (ledger.counters[counter] >= ledger.budgets[limit]) return { action: 'stop', reason: `${kind} budget exhausted`, ledger };
  ledger.counters[counter] += 1; ledger.integrity = integrityFor(ledger);
  return { action: kind === 'infra' ? 'retry' : 'repair', ledger };
}

function effectId(effect) { return `${effect.kind}:${effect.key}`; }
function reserveEffect(input, effect) {
  const ledger = clone(input);
  if (!EFFECT_KINDS.has(effect && effect.kind) || !String(effect && effect.key || '').trim()) {
    return { action: 'stop', execute: false, reason: 'invalid side-effect identity', ledger };
  }
  const id = effectId(effect); const existing = ledger.effects[id];
  if (existing) return { action: existing.status === 'complete' ? 'already-complete' : 'inspect', execute: false, ledger };
  ledger.effects[id] = { kind: effect.kind, key: String(effect.key), status: 'pending', receipt: null };
  ledger.integrity = integrityFor(ledger);
  return { action: 'execute', execute: true, ledger };
}

function completeEffect(input, effect) {
  const ledger = clone(input); const id = effectId(effect || {}); const existing = ledger.effects[id];
  if (!existing) return { action: 'stop', reason: 'side effect was not reserved', ledger };
  if (existing.status === 'complete') return { action: 'already-complete', ledger };
  existing.status = 'complete'; existing.receipt = String(effect.receipt || '').trim();
  if (!existing.receipt) return { action: 'stop', reason: 'completion receipt is required', ledger: clone(input) };
  ledger.integrity = integrityFor(ledger);
  return { action: 'completed', ledger };
}

function shadowSelection({ boardMd, state, loadCard }) {
  return coordinator.summarizeClaimSelection(coordinator.selectClaimCandidate({
    boardMd, state, loadCard, supervised: false,
  }));
}

function shadowFromContext(ctx) {
  let state;
  try { state = JSON.parse(fs.readFileSync(ctx.coordinatorStatePath, 'utf8')); }
  catch (err) { throw new Error(`coordinator state is malformed; preserve and recover: ${err.message}`); }
  const boardMd = fs.readFileSync(ctx.boardPath, 'utf8');
  return shadowSelection({
    boardMd, state,
    loadCard: (card) => {
      const cardPath = findCard(ctx.cardsRoot, card);
      return cardPath ? { path: cardPath, raw: fs.readFileSync(cardPath, 'utf8') } : null;
    },
  });
}

function cliOptions(args) {
  const keys = ['max_cards', 'duration_seconds', 'max_infra_retries', 'max_code_repairs', 'max_model_turns', 'max_intervention_weight'];
  return Object.fromEntries(keys.filter((key) => args[key] != null).map((key) => [key, Number(args[key])]));
}

function main() {
  const args = parseArgs(process.argv.slice(2)); const command = args._[0];
  const ctx = resolveContext(); let result;
  if (command === 'start') result = start(ctx, cliOptions(args));
  else if (command === 'status') result = status(ctx);
  else if (command === 'stop') result = stop(ctx, { reason: args.reason });
  else if (command === 'resume') result = resume(ctx, cliOptions(args));
  else if (command === 'shadow') result = { action: 'shadow', selection: shadowFromContext(ctx), mutated: false };
  else throw new Error('usage: batch-runner.js start|status|stop|resume|shadow [--json]');
  console.log(args.json ? JSON.stringify(result, null, 2) : JSON.stringify(result));
}

module.exports = {
  LEDGER_VERSION, MODE, parseArgs, resolveContext, normalizeBudgets, integrityFor, createLedger, validateLedger,
  atomicWriteJson, readLedger, withBatchLock, findReservedIntakeArtifact, readiness, budgetProblems,
  start, status, stop, resume, assertPinnedRuntime, recordFailure, reserveEffect, completeEffect, shadowSelection, shadowFromContext,
};

if (require.main === module) {
  try { main(); } catch (err) { console.error(JSON.stringify({ action: 'error', message: err.message })); process.exit(1); }
}
