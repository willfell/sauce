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

function canonicalTimestampMs(value) {
  if (typeof value !== 'string' || !value) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NaN;
  try { return new Date(parsed).toISOString() === value ? parsed : NaN; }
  catch (_) { return NaN; }
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
  let normalizedBudgets = null;
  try {
    normalizedBudgets = normalizeBudgets({
      max_cards: ledger.budgets && ledger.budgets.max_distinct_cards,
      duration_seconds: ledger.budgets && ledger.budgets.duration_seconds,
      max_infra_retries: ledger.budgets && ledger.budgets.max_infra_retries,
      max_code_repairs: ledger.budgets && ledger.budgets.max_code_repairs,
      max_model_turns: ledger.budgets && ledger.budgets.max_model_turns,
      max_intervention_weight: ledger.budgets && ledger.budgets.max_intervention_weight,
    });
    if (JSON.stringify(normalizedBudgets) !== JSON.stringify(ledger.budgets)) errors.push('noncanonical budgets');
  } catch (err) { errors.push(err.message); }
  const startedMs = canonicalTimestampMs(ledger.started_at);
  const deadlineMs = canonicalTimestampMs(ledger.deadline_at);
  if (!Number.isFinite(startedMs)) errors.push('started_at must be a canonical ISO timestamp');
  if (!Number.isFinite(deadlineMs)
    || (ledger.budgets && deadlineMs !== startedMs + ledger.budgets.duration_seconds * 1000)) {
    errors.push('deadline_at must equal started_at plus duration_seconds');
  }
  const stopMs = ledger.stop_requested_at === null ? null : canonicalTimestampMs(ledger.stop_requested_at);
  const resumedMs = ledger.resumed_at === null ? null : canonicalTimestampMs(ledger.resumed_at);
  if (ledger.resumed_at !== null && (!Number.isFinite(resumedMs) || resumedMs < startedMs)) {
    errors.push('resumed_at must be a canonical ISO timestamp at or after started_at');
  }
  if (ledger.phase === 'running' && (ledger.stop_requested_at !== null || ledger.stop_reason !== null)) {
    errors.push('running lifecycle cannot carry stop_requested_at or stop_reason');
  }
  if (ledger.phase === 'stopped') {
    if (!Number.isFinite(stopMs) || stopMs < startedMs) {
      errors.push('stop_requested_at must be a canonical ISO timestamp at or after started_at');
    }
    if (typeof ledger.stop_reason !== 'string' || !ledger.stop_reason.trim()) {
      errors.push('stopped lifecycle requires a non-empty stop_reason');
    }
    if (Number.isFinite(resumedMs) && Number.isFinite(stopMs) && resumedMs > stopMs) {
      errors.push('resumed_at cannot be later than stop_requested_at');
    }
  }
  const counters = ledger.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) errors.push('counters must be an object');
  else {
    if (!Array.isArray(counters.distinct_cards)
      || counters.distinct_cards.some((item) => typeof item !== 'string' || !item.trim())
      || new Set(counters.distinct_cards).size !== counters.distinct_cards.length) errors.push('distinct_cards must be unique non-empty strings');
    for (const field of ['infra_retries', 'code_repairs', 'model_turns']) {
      if (!Number.isInteger(counters[field]) || counters[field] < 0) errors.push(`${field} must be a nonnegative integer`);
    }
    if (!Number.isFinite(counters.intervention_weight) || counters.intervention_weight < 0) {
      errors.push('intervention_weight must be a nonnegative finite number');
    }
    if (!Array.isArray(counters.failure_signatures)
      || counters.failure_signatures.some((item) => typeof item !== 'string' || !item.trim())
      || new Set(counters.failure_signatures).size !== counters.failure_signatures.length) {
      errors.push('failure_signatures must be unique non-empty strings');
    }
    if (normalizedBudgets) {
      if (Array.isArray(counters.distinct_cards)
        && counters.distinct_cards.length > normalizedBudgets.max_distinct_cards) {
        errors.push('distinct-card accounting exceeds immutable budget');
      }
      if (Number.isInteger(counters.infra_retries)
        && counters.infra_retries > normalizedBudgets.max_infra_retries) {
        errors.push('infra retry accounting exceeds immutable budget');
      }
      if (Number.isInteger(counters.code_repairs)
        && counters.code_repairs > normalizedBudgets.max_code_repairs) {
        errors.push('code repair accounting exceeds immutable budget');
      }
      if (Number.isInteger(counters.model_turns)
        && counters.model_turns > normalizedBudgets.max_model_turns) {
        errors.push('model usage accounting exceeds immutable budget');
      }
      if (Number.isFinite(counters.intervention_weight)
        && counters.intervention_weight > normalizedBudgets.max_intervention_weight) {
        errors.push('intervention accounting exceeds immutable budget');
      }
    }
  }
  if (!ledger.effects || typeof ledger.effects !== 'object' || Array.isArray(ledger.effects)) errors.push('effects must be an object');
  else for (const [id, effect] of Object.entries(ledger.effects)) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)
      || !EFFECT_KINDS.has(effect.kind) || typeof effect.key !== 'string' || !effect.key.trim()
      || id !== effectId(effect) || !['pending', 'complete'].includes(effect.status)
      || (effect.status === 'complete' && (typeof effect.receipt !== 'string' || !effect.receipt.trim()))
      || (effect.status === 'pending' && effect.receipt !== null)) errors.push(`effects.${id} is malformed`);
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
  if (!owner || owner.host !== (deps.hostname || os.hostname())) return false;
  const now = Date.parse(nowOf(deps));
  const startedAt = Date.parse(owner.started_at);
  if (!Number.isFinite(startedAt)) return false;
  if (now - startedAt <= LOCK_STALE_MS) return false;
  return !(deps.pidAlive || pidAliveDefault)(Number(owner.pid));
}

function withBatchLock(ctx, fn, deps = {}) {
  fs.mkdirSync(ctx.batchesDir, { recursive: true });
  const localHost = deps.hostname || os.hostname();
  if (fs.existsSync(ctx.lockPath)) {
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(path.join(ctx.lockPath, 'owner.json'), 'utf8')); } catch (_) {}
    if (!owner) throw new Error('ambiguous batch lock has no readable owner');
    if (owner.host !== localHost) throw new Error(`ambiguous batch lock belongs to foreign host ${owner.host || '?'}`);
    if (lockStale(ctx, owner, deps)) throw new Error('stale batch lock requires explicit recovery; it was not removed');
    throw new Error(`batch lock held by pid ${owner.pid || '?'} on ${owner.host || '?'}`);
  }
  try { fs.mkdirSync(ctx.lockPath); }
  catch (err) {
    if (err.code === 'EEXIST') throw new Error('batch lock was acquired concurrently');
    throw err;
  }
  const lockId = crypto.randomBytes(32).toString('hex');
  atomicWriteJson(path.join(ctx.lockPath, 'owner.json'), {
    lock_id: lockId, pid: process.pid, host: localHost, started_at: nowOf(deps),
    command: process.argv.slice(2).join(' '),
  });
  try { return fn(); }
  finally {
    let current = null;
    try { current = JSON.parse(fs.readFileSync(path.join(ctx.lockPath, 'owner.json'), 'utf8')); } catch (_) {}
    const entries = fs.existsSync(ctx.lockPath) ? fs.readdirSync(ctx.lockPath) : [];
    if (!current || current.lock_id !== lockId || entries.length !== 1 || entries[0] !== 'owner.json') {
      throw new Error('batch lock cleanup ownership became ambiguous; preserve it for explicit recovery');
    }
    fs.unlinkSync(path.join(ctx.lockPath, 'owner.json'));
    fs.rmdirSync(ctx.lockPath);
  }
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

function markStopped(ledger, reason, deps = {}, stoppedAt = nowOf(deps)) {
  const normalizedReason = String(reason || '').trim() || 'stop requested';
  ledger.phase = 'stopped';
  ledger.stop_requested_at = stoppedAt;
  ledger.stop_reason = normalizedReason;
}

function persistValidatedLedger(ctx, ledger) {
  ledger.integrity = integrityFor(ledger);
  const validation = validateLedger(ledger);
  if (!validation.ok) throw new Error(`ledger mutation refused: ${validation.errors.join('; ')}`);
  atomicWriteJson(ctx.ledgerPath, ledger);
}

function enforceDeadline(ctx, ledger, deps = {}) {
  if (ledger.phase !== 'running') return;
  const observedAt = nowOf(deps);
  const observedMs = canonicalTimestampMs(observedAt);
  if (!Number.isFinite(observedMs)) throw new Error('operation time must be a canonical ISO timestamp');
  if (observedMs < canonicalTimestampMs(ledger.deadline_at)) return;
  markStopped(ledger, 'deadline budget exhausted', deps, observedAt);
  persistValidatedLedger(ctx, ledger);
  throw new Error('deadline budget exhausted; batch is stopped and terminal');
}

function start(ctx, options = {}, deps = {}) {
  return withBatchLock(ctx, () => {
    const existing = readLedger(ctx);
    if (existing) {
      if (existing.phase === 'stopped') throw new Error('batch is stopped and terminal; start refused');
      enforceDeadline(ctx, existing, deps);
      readiness(ctx);
      assertPinnedRuntime(existing, deps);
      if (!requestedConfigMatches(existing, options)) throw new Error('active batch has a different immutable configuration');
      return { action: 'already-started', ledger: existing };
    }
    readiness(ctx);
    const ledger = createLedger(options, deps);
    atomicWriteJson(ctx.ledgerPath, ledger);
    return { action: 'started', ledger };
  }, deps);
}

function status(ctx, deps = {}) {
  const ledger = readLedger(ctx);
  return ledger ? { action: 'status', ledger, budget_problems: budgetProblems(ledger, nowOf(deps)) } : { action: 'no-batch' };
}

function stop(ctx, options = {}, deps = {}) {
  return withBatchLock(ctx, () => {
    const ledger = readLedger(ctx);
    if (!ledger) throw new Error('no batch to stop');
    if (ledger.phase === 'stopped') return { action: 'already-stopped', ledger };
    markStopped(ledger, options.reason || 'operator request', deps);
    persistValidatedLedger(ctx, ledger);
    return { action: 'stopped', ledger };
  }, deps);
}

function resume(ctx, options = {}, deps = {}) {
  return withBatchLock(ctx, () => {
    const ledger = readLedger(ctx);
    if (!ledger) throw new Error('no batch to resume');
    if (ledger.phase === 'stopped') throw new Error('resume refused: batch is stopped and terminal');
    enforceDeadline(ctx, ledger, deps);
    readiness(ctx);
    assertPinnedRuntime(ledger, deps);
    if (!requestedConfigMatches(ledger, options)) throw new Error('resume cannot change immutable configuration');
    return { action: 'already-running', ledger };
  }, deps);
}

function mutateLedger(ctx, updater, deps = {}) {
  return withBatchLock(ctx, () => {
    const ledger = readLedger(ctx);
    if (!ledger) throw new Error('no batch ledger exists');
    if (ledger.phase === 'stopped') throw new Error('batch is stopped and terminal; mutation refused');
    enforceDeadline(ctx, ledger, deps);
    assertPinnedRuntime(ledger, deps);
    let result = updater(ledger) || { action: 'stop', reason: 'empty ledger mutation' };
    if (result.action === 'stop') {
      markStopped(ledger, result.reason || 'stop-class failure', deps);
      result = { ...result, changed: true };
    }
    if (result.changed) {
      persistValidatedLedger(ctx, ledger);
    }
    return { ...result, ledger };
  }, deps);
}

function recordFailure(ctx, failure, deps = {}) {
  return mutateLedger(ctx, (ledger) => {
    const kind = String(failure && failure.kind || 'unknown');
    const signature = String(failure && failure.signature || '').trim();
    if (!signature || !['infra', 'code', 'mixed', 'unknown'].includes(kind)) return { action: 'stop', reason: 'unknown failure' };
    if (['mixed', 'unknown'].includes(kind)) return { action: 'stop', reason: `${kind} failure` };
    if (ledger.counters.failure_signatures.includes(signature)) return { action: 'stop', reason: 'same normalized signature repeated' };
    const counter = kind === 'infra' ? 'infra_retries' : 'code_repairs';
    const limit = kind === 'infra' ? 'max_infra_retries' : 'max_code_repairs';
    if (ledger.counters[counter] >= ledger.budgets[limit]) return { action: 'stop', reason: `${kind} budget exhausted` };
    ledger.counters.failure_signatures.push(signature); ledger.counters[counter] += 1;
    return { action: kind === 'infra' ? 'retry' : 'repair', changed: true };
  }, deps);
}

function effectId(effect) { return `${effect.kind}:${effect.key}`; }
function reserveEffect(ctx, effect, deps = {}) {
  return mutateLedger(ctx, (ledger) => {
    if (!EFFECT_KINDS.has(effect && effect.kind) || !String(effect && effect.key || '').trim()) {
      return { action: 'stop', execute: false, reason: 'invalid side-effect identity' };
    }
    const id = effectId(effect); const existing = ledger.effects[id];
    if (existing) return { action: existing.status === 'complete' ? 'already-complete' : 'inspect', execute: false };
    ledger.effects[id] = { kind: effect.kind, key: String(effect.key), status: 'pending', receipt: null };
    return { action: 'execute', execute: true, changed: true };
  }, deps);
}

function completeEffect(ctx, effect, deps = {}) {
  return mutateLedger(ctx, (ledger) => {
    const id = effectId(effect || {}); const existing = ledger.effects[id];
    if (!existing) return { action: 'stop', reason: 'side effect was not reserved' };
    if (existing.status === 'complete') return { action: 'already-complete' };
    const receipt = String(effect.receipt || '').trim();
    if (!receipt) return { action: 'stop', reason: 'completion receipt is required' };
    existing.status = 'complete'; existing.receipt = receipt;
    return { action: 'completed', changed: true };
  }, deps);
}

function recordDistinctCard(ctx, card, deps = {}) {
  return mutateLedger(ctx, (ledger) => {
    const identity = delivery.normalizeIdentity(card);
    if (!identity) return { action: 'stop', reason: 'card identity is required' };
    if (ledger.counters.distinct_cards.includes(identity)) return { action: 'already-recorded' };
    if (ledger.counters.distinct_cards.length >= ledger.budgets.max_distinct_cards) return { action: 'stop', reason: 'distinct-card budget exhausted' };
    ledger.counters.distinct_cards.push(identity);
    return { action: 'recorded', changed: true };
  }, deps);
}

function recordUsage(ctx, turns, deps = {}) {
  return mutateLedger(ctx, (ledger) => {
    if (!Number.isInteger(turns) || turns <= 0) return { action: 'stop', reason: 'usage turns must be a positive integer' };
    if (ledger.counters.model_turns + turns > ledger.budgets.max_model_turns) return { action: 'stop', reason: 'usage budget exhausted' };
    ledger.counters.model_turns += turns;
    return { action: 'recorded', changed: true };
  }, deps);
}

function recordIntervention(ctx, weight, deps = {}) {
  return mutateLedger(ctx, (ledger) => {
    if (!Number.isFinite(weight) || weight <= 0) return { action: 'stop', reason: 'intervention weight must be positive' };
    if (ledger.counters.intervention_weight + weight > ledger.budgets.max_intervention_weight) {
      return { action: 'stop', reason: 'intervention budget exhausted' };
    }
    ledger.counters.intervention_weight += weight;
    return { action: 'recorded', changed: true };
  }, deps);
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
  start, status, stop, resume, assertPinnedRuntime, mutateLedger,
  recordFailure, reserveEffect, completeEffect, recordDistinctCard, recordUsage, recordIntervention,
  shadowSelection, shadowFromContext,
};

if (require.main === module) {
  try { main(); } catch (err) { console.error(JSON.stringify({ action: 'error', message: err.message })); process.exit(1); }
}
