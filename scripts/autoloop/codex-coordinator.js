#!/usr/bin/env node
/**
 * Codex Sauce Autoloop coordinator.
 *
 * Deterministic ownership: claims, touch-zone concurrency, durable state,
 * GitHub/release ancestry, Homebrew promotion, and parallel vault receipts.
 * The model owns implementation and review; this file owns operational state.
 *
 * State is local-only under <git-common-dir>/sauce-autoloop/ so every worktree
 * shares one ledger without advancing main.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const {
  parseBoard, parseCheckedColumn, parseDependsOn, parseCardStatus, parseBatchPolicy,
  delivery, prepareDeliveryCard, validationReason,
} = require('./select-card');
const { cmpVersion } = require('./deploy');
const { gateVerdict } = require('./gate');
const { parseCommit, bumpLevel } = require('../release/lib/conventional');
const deliveryStatusDigest = require('./delivery-status-digest');
const deliveryReviewTriage = require('./delivery-review-triage');
const { deliveryPaths } = require('./delivery-paths');
const {
  EXIT_CODES, parseArgs, successReceipt, refuse, usage, requireJson, requireOnlyOptions, receiptForError,
} = require('./cli-kit');

const execFileAsync = promisify(execFile);
const MAXBUF = 64 * 1024 * 1024;
// SAUCE_LOOP_REPO (loop-plugin bindings): the GitHub repo record-pr/advance
// query. Derived by the resolver from the bound repo's origin remote; absent
// env keeps the historical sauce default.
const REPO = process.env.SAUCE_LOOP_REPO || 'willfell/sauce';
const TAP_REPO = 'willfell/homebrew-sauce';
const MAX_ACTIVE = 3;
const LEASE_TTL_MS = 2 * 60 * 60 * 1000; // per-card session lease: generous, time-based only —
// coordinator invocations are short-lived node processes, so pid-liveness can't arbitrate here.
const DEFAULT_LEASE_SECONDS = 600;
const DEFAULT_POLL_SECONDS = 20;
const REVIEW_LENSES = ['correctness', 'regression-risk', 'test-adequacy'];
const STRICT_CLI_OPTIONS = Object.freeze({
  park: ['json', 'card', 'depends-on', 'resume-condition', 'lease-token'],
  'amend-park': ['json', 'card', 'expected-head', 'reason', 'depends-on', 'clear-dependencies', 'resume-condition'],
  resume: ['json', 'card', 'lease-token'],
  'record-review': [
    'json', 'card', 'lens', 'verdict', 'summary', 'expected-head',
    'accepted-limitation', 'bound', 'lease-token',
  ],
  'record-pr': ['json', 'card', 'pr', 'lease-token'],
  'break-lease': ['json', 'card', 'reason'],
  'supersession-depth': ['json', 'card'],
  'heal-epic-bindings': ['json', 'apply', 'dry-run'],
});
// Loop-binding env seam (loop plugin `.loop/config.json` → loop-config.js
// resolver → SAUCE_LOOP_* env). With no SAUCE_LOOP_* set, every derived value
// is byte-identical to the historical hardcoded defaults; malformed values
// fail loud at load rather than silently retargeting board writes.
function loopBindingEnv(env = process.env) {
  let vaults = null;
  if (env.SAUCE_LOOP_VAULTS) {
    let parsed;
    try { parsed = JSON.parse(env.SAUCE_LOOP_VAULTS); } catch (e) {
      throw new Error(`SAUCE_LOOP_VAULTS is not valid JSON: ${e.message}`);
    }
    if (!Array.isArray(parsed) || !parsed.every((v) => v && typeof v.id === 'string' && typeof v.path === 'string')) {
      throw new Error('SAUCE_LOOP_VAULTS must be a JSON array of {id, path}');
    }
    vaults = parsed;
  }
  return {
    board: env.SAUCE_LOOP_BOARD || null,
    cardsRoot: env.SAUCE_LOOP_CARDS_ROOT || null,
    vaults,
    // Epic-native board topology (fresh loop-plugin bindings): routes selection
    // through the two-level epic frontier even when the ledger has no cutover
    // history. Absent env → the ledger's cutover flag remains the only switch.
    epicTopology: env.SAUCE_LOOP_BOARD_TOPOLOGY === 'epic',
  };
}
// Self-resolve board/cards/vault defaults from the bound repo's committed
// .loop/config.json via the loop plugin resolver. Returns null (→ literal
// fallback) when the repo is unbound, the resolver is absent, or resolution
// refuses. brewPrefix is stubbed because only the vault-layout fields are
// consumed here, never the coordinator path.
function resolveBoundDefaults(cwd) {
  try {
    const resolver = require(path.join(__dirname, '..', '..', 'plugins', 'loop', 'scripts', 'loop-config.js'));
    const res = resolver.resolveBinding(cwd, { brewPrefix: () => '' });
    if (!res || !res.ok) return null;
    const c = res.config;
    let vaults = null;
    if (c.env && c.env.SAUCE_LOOP_VAULTS) {
      try { vaults = JSON.parse(c.env.SAUCE_LOOP_VAULTS); } catch (_) { vaults = null; }
    }
    return { board: c.board_path_abs, cardsRoot: c.cards_root_abs, vaults };
  } catch (_) { return null; }
}
const LOOP_BINDING = loopBindingEnv();
// When the SAUCE_LOOP_* env seam is unset, self-resolve the bound repo's own
// committed .loop/config.json (process.cwd()) so the coordinator's board, cards
// root and vault list track the binding rather than a machine-specific literal.
// The ~/obsidian/<vault> literals below are the last resort for an unbound cwd.
const BOUND_DEFAULTS = (LOOP_BINDING.board && LOOP_BINDING.cardsRoot && LOOP_BINDING.vaults)
  ? null
  : resolveBoundDefaults(process.cwd());
// Contract vocabulary vs deployment binding: a card's deploy_subscriptions map
// always carries the contract's required_vaults keys; the BINDING's vault list
// (SAUCE_LOOP_VAULTS) decides which vaults this board actually deploys to. An
// empty binding list ([]) means merge-only completion. Identical by default.
const CONTRACT_VAULT_IDS = delivery.registry.policies.required_vaults;
const DELIVERY_STABLE_FIELDS = Object.freeze(
  delivery.registry.types['execution-card'].fields.map((field) => field.name),
);
const AMEND_CONTRACT_OPTIONS = new Set([
  '_', 'json', 'card', 'expected-head', 'expected-origin-main', 'reason',
  'add-touch-zone', 'expected-deployment', 'desired-deployment',
  'expected-batch-policy', 'desired-batch-policy',
]);
const TERMINAL = new Set(['deployed', 'blocked', 'failed', 'cancelled', 'discarded']);
const RECOVER_DEPLOYED_PHASES = new Set([
  'feature_pr', 'feature_merged', 'release_pr', 'release_merged', 'tagged',
  'tap_pr', 'tap_merged', 'brew_installed', 'deploying', 'blocked', 'needs-inspection',
]);
const METADATA_RECONCILE_PHASES = new Set(['blocked', 'needs-inspection', 'deployed']);
const PARKED_METADATA_REBIND_CARDS = Object.freeze([
  'GA-C8a2 To-do and meetings actions onto sauce-core (supersedes GA-C8a)',
  'GA-V1a2 Deterministic visual baseline runner (supersedes GA-V1a)',
  'GA-R1a2 Migrate move references and retire duplicate helpers (supersedes GA-R1a)',
  'GA-R4a2 Parameterized Cowork timeframe hub cards (supersedes GA-R4a)',
  'GA-R2a2 Extract sticky-notes day-capture shared core (supersedes GA-R2a1)',
  'GA-R3a2 Shared Links behavior contract (supersedes GA-R3a)',
  'GA-F1a Bare project Docs scaffolding and zero-section creation',
  'GA-F3a2 Recursive recent docs across project and wiki hubs (supersedes GA-F3a)',
]);
const PARKED_METADATA_REBIND_OPTIONS = new Set([
  '_', 'json', 'parked-rebind', 'dry-run', 'apply', 'reason', 'spec',
]);
const CONTRACT_FRONTMATTER_RESTAMP_OPTIONS = new Set([
  '_', 'json', 'contract-frontmatter-restamp', 'dry-run', 'apply', 'reason', 'spec',
]);
const CONSUME_RATIFICATION_OPTIONS = new Set(['_', 'json', 'card', 'artifact']);
const EXACT_SHA = /^[0-9a-f]{40}$/;
const RATIFICATION_SCHEMA_VERSION = '1.0.0';
const SYMBOLIC_TOUCH_ZONES = new Set(['shared-registries', 'homebrew-promotion']);
const HOME = os.homedir();
const BOARD = LOOP_BINDING.board || (BOUND_DEFAULTS && BOUND_DEFAULTS.board)
  || path.join(HOME, 'obsidian/headspace-sauce/spice/projects/sauce/sauce-board.md');
const CARDS_ROOT = LOOP_BINDING.cardsRoot || (BOUND_DEFAULTS && BOUND_DEFAULTS.cardsRoot)
  || path.join(HOME, 'obsidian/headspace-sauce/spice/projects/sauce/tasks');
const VAULTS = LOOP_BINDING.vaults || (BOUND_DEFAULTS && BOUND_DEFAULTS.vaults) || [
  { id: 'headspace', path: path.join(HOME, 'obsidian/headspace-sauce') },
  { id: 'accuris', path: path.join(HOME, 'obsidian/accuris-sauce') },
  { id: 'ero', path: path.join(HOME, 'obsidian/ero-sauce') },
];
// Deployment vault ids follow whichever source populated VAULTS (env binding,
// self-resolved binding, or literal fallback).
const DEPLOYMENT_VAULT_IDS = VAULTS.map((v) => v.id);

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: MAXBUF, ...opts }).trim();
}

function workshopContext(cwd = process.cwd()) {
  const common = sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  const commonDir = path.resolve(cwd, common);
  const root = path.dirname(commonDir);
  const stateDir = path.join(commonDir, 'sauce-autoloop');
  return { root, commonDir, stateDir, statePath: path.join(stateDir, 'state.json') };
}

function emptyState() {
  return { schema_version: 1, updated_at: new Date().toISOString(), cards: {} };
}

function ensureStateDir(ctx) {
  fs.mkdirSync(path.join(ctx.stateDir, 'locks'), { recursive: true });
  fs.mkdirSync(path.join(ctx.stateDir, 'receipts'), { recursive: true });
}

function readState(ctx) {
  ensureStateDir(ctx);
  if (!fs.existsSync(ctx.statePath)) return emptyState();
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(ctx.statePath, 'utf8')); }
  catch (err) { throw new Error(`state is malformed; preserve and recover ${ctx.statePath}: ${err.message}`); }
  if (!parsed || parsed.schema_version !== 1 || typeof parsed.cards !== 'object') {
    throw new Error(`unsupported state contract at ${ctx.statePath}`);
  }
  return parsed;
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function writeState(ctx, state, changedRecord, options = {}) {
  ensureStateDir(ctx);
  const lockPath = path.join(ctx.stateDir, 'locks', 'state-write.lock');
  const ownerPath = path.join(lockPath, 'owner.json');
  const deadline = Date.now() + 5000;
  while (true) {
    try { fs.mkdirSync(lockPath); break; }
    catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); } catch (_) {}
      if (lockDirectoryIsStale(lockPath, owner, 30 * 1000)) { fs.rmSync(lockPath, { recursive: true, force: true }); continue; }
      if (Date.now() >= deadline) throw new Error('timed out acquiring state-write lock');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    atomicWriteJson(ownerPath, { pid: process.pid, host: os.hostname(), started_at: new Date().toISOString() });
    let latest = emptyState();
    if (fs.existsSync(ctx.statePath)) {
      latest = JSON.parse(fs.readFileSync(ctx.statePath, 'utf8'));
      if (!latest || latest.schema_version !== 1 || typeof latest.cards !== 'object') throw new Error(`unsupported state contract at ${ctx.statePath}`);
    }
    const next = changedRecord
      ? { ...latest, cards: { ...latest.cards, [changedRecord.card]: changedRecord } }
      : { ...latest, ...state, cards: { ...latest.cards, ...(state.cards || {}) } };
    if (options.preserveUpdatedAt === true) {
      if (Object.prototype.hasOwnProperty.call(latest, 'updated_at')) {
        next.updated_at = latest.updated_at;
      } else {
        delete next.updated_at;
      }
    } else {
      next.updated_at = new Date().toISOString();
    }
    atomicWriteJson(ctx.statePath, next);
    if (Object.prototype.hasOwnProperty.call(next, 'updated_at')) state.updated_at = next.updated_at;
    else delete state.updated_at;
    state.cards = next.cards;
  } finally { fs.rmSync(lockPath, { recursive: true, force: true }); }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function lockIsStale(owner, now = Date.now(), staleMs = 30 * 60 * 1000) {
  if (!owner || !owner.started_at) return true;
  const age = now - Date.parse(owner.started_at);
  if (!Number.isFinite(age) || age <= staleMs) return false;
  if (owner.host && owner.host !== os.hostname()) return true;
  return !pidAlive(Number(owner.pid));
}

function leaseIsLive(lease, nowMs, ttlMs = LEASE_TTL_MS) {
  if (!lease || typeof lease !== 'object') return false;
  const renewed = Date.parse(lease.renewed_at);
  if (!Number.isFinite(renewed)) return false;
  const age = nowMs - renewed;
  return age >= 0 && age < ttlMs; // negative age = clock skew = stale (turn-lock.js precedent)
}

function leaseSummary(lease, nowMs, ttlMs = LEASE_TTL_MS) {
  if (!lease || typeof lease !== 'object') return null;
  const renewed = Date.parse(lease.renewed_at);
  const age = Number.isFinite(renewed) ? nowMs - renewed : null;
  const held = leaseIsLive(lease, nowMs, ttlMs);
  return {
    held, stale: !held, age_ms: age,
    expires_in_ms: held ? ttlMs - age : 0,
    holder: lease.holder || null, acquired_at: lease.acquired_at || null,
  };
}

function acquireLease(record, { now, token, label = '' } = {}) {
  const at = (now || (() => new Date().toISOString()))();
  record.lease = {
    token: token || crypto.randomUUID(),
    acquired_at: at, renewed_at: at,
    holder: { host: os.hostname(), ...(label ? { label } : {}) },
  };
  return record.lease;
}

function clearLease(record, reason, now) {
  if (!record || !record.lease) return false;
  const at = (now || (() => new Date().toISOString()))();
  record.lease_breaks = [...(record.lease_breaks || []), {
    at, reason, previous_token: record.lease.token, previous_holder: record.lease.holder || null,
  }];
  delete record.lease;
  return true;
}

// Shared pipeline-verb lease guard. Unleased records are a tokenless no-op
// (back-compat); a live lease requires a matching --lease-token; a stale
// lease refuses lease_stale BEFORE lease_required so a returning holder must
// re-attach via resume (auditing the takeover) rather than silently reusing
// an expired token. A matching token renews the lease in place — the verb's
// own persist carries the renewal, no extra write.
function requireLeaseToken(record, args, verb, nowMs) {
  if (!record) return;
  if (!record.lease) {
    // Unleased is normally a back-compat tokenless no-op — but a token
    // supplied against an ACTIVE unleased card means the caller believes it
    // holds a lease that no longer exists (broken, superseded, or never
    // persisted). Parked/terminal records keep the old silent pass-through
    // so tokened idempotent replays after park/completion still no-op.
    const supplied = String(args['lease-token'] || '').trim();
    const active = record.phase !== 'parked' && !TERMINAL.has(record.phase);
    if (supplied && active) {
      refuse(`${verb}-refused`, 'lease_gone',
        `your lease on ${record.card} no longer exists (broken or superseded) — re-attach with resume --card "${record.card}" --json before continuing`,
        { card: record.card });
    }
    return;
  }
  const supplied = String(args['lease-token'] || '').trim();
  const live = leaseIsLive(record.lease, nowMs);
  const remedy = `resume --card "${record.card}" --json to attach (or break-lease --card "${record.card}" --reason "..." if the holder is known dead)`;
  if (!live) {
    refuse(`${verb}-refused`, 'lease_stale',
      `card ${record.card} carries a stale lease — ${remedy}`,
      { card: record.card, lease: leaseSummary(record.lease, nowMs) });
  }
  if (!supplied) {
    refuse(`${verb}-refused`, 'lease_required',
      `card ${record.card} is leased; ${verb} requires --lease-token <token from your claim/resume receipt> — ${remedy}`,
      { card: record.card, lease: leaseSummary(record.lease, nowMs) });
  }
  if (supplied !== record.lease.token) {
    refuse(`${verb}-refused`, 'lease_mismatch',
      `--lease-token does not match the live lease on ${record.card} held by ${record.lease.holder && record.lease.holder.host ? record.lease.holder.host : 'another session'} — ${remedy}`,
      { card: record.card, lease: leaseSummary(record.lease, nowMs) });
  }
  record.lease.renewed_at = new Date(nowMs).toISOString(); // renewal rides the verb's own persist
}

function lockDirectoryIsStale(lockPath, owner, staleMs) {
  if (owner) return lockIsStale(owner, Date.now(), staleMs);
  try { return Date.now() - fs.statSync(lockPath).mtimeMs > staleMs; }
  catch (_) { return false; }
}

async function withLock(ctx, name, fn, opts = {}) {
  ensureStateDir(ctx);
  const lockPath = path.join(ctx.stateDir, 'locks', `${name}.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');
  const staleMs = opts.staleMs || 30 * 60 * 1000;
  try { fs.mkdirSync(lockPath); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); } catch (_) {}
    if (!lockDirectoryIsStale(lockPath, owner, staleMs)) {
      const e = new Error(`lock ${name} held by pid ${owner && owner.pid ? owner.pid : '?'} on ${owner && owner.host ? owner.host : '?'}`);
      e.code = 'LOCKED'; e.owner = owner; throw e;
    }
    fs.rmSync(lockPath, { recursive: true, force: true });
    fs.mkdirSync(lockPath);
  }
  atomicWriteJson(ownerPath, {
    pid: process.pid, host: os.hostname(), started_at: new Date().toISOString(),
    card: opts.card || null, command: process.argv.slice(2).join(' '),
  });
  try { return await fn(); }
  finally { fs.rmSync(lockPath, { recursive: true, force: true }); }
}

function normalizeZone(zone) {
  return String(zone || '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
}

function reconcileRoute(card) {
  const operand = `'${String(card).replaceAll("'", "'\"'\"'")}'`;
  return `reconcile --card ${operand}`;
}

function normalizeCardLink(value) {
  return delivery.normalizeIdentity(value);
}

function consumeRatificationReceipt(receipt, expected = {}) {
  const validation = delivery.validateRatificationReceipt(receipt);
  const errors = [...validation.errors];
  const targetCard = String(expected.target_card || '').trim();
  const targetHead = String(expected.target_head || '').trim();
  const decision = String(expected.decision || 'accepted').trim();
  if (!targetCard || delivery.normalizeIdentity(targetCard) !== targetCard) {
    errors.push({ code: 'expected-target-card-invalid', field: 'target_card', message: 'expected target_card must be the exact plain canonical identity' });
  } else if (validation.receipt.target_card !== targetCard) {
    errors.push({ code: 'ratification-target-card-mismatch', field: 'target_card', message: 'receipt does not bind the exact expected full target-card identity' });
  }
  if (!/^[0-9a-f]{40}$/.test(targetHead)) {
    errors.push({ code: 'expected-target-head-invalid', field: 'target_head', message: 'expected target_head must be exactly one lowercase 40-hex SHA token' });
  } else if (validation.receipt.target_head !== targetHead) {
    errors.push({ code: 'ratification-target-head-mismatch', field: 'target_head', message: 'receipt does not bind the exact expected target HEAD' });
  }
  if (!delivery.registry.enums.ratification_decision.includes(decision)) {
    errors.push({ code: 'expected-decision-invalid', field: 'decision', message: 'expected decision is not a Delivery ratification decision' });
  } else if (validation.receipt.decision !== decision) {
    errors.push({ code: 'ratification-decision-mismatch', field: 'decision', message: 'receipt decision does not match the required authority class' });
  }
  return {
    ok: errors.length === 0,
    errors,
    receipt: validation.receipt,
    contract_version: delivery.CONTRACT_VERSION,
  };
}

function exactRatificationSectionRange(markdown, heading) {
  const wanted = String(heading || '').trim();
  if (!wanted) return null;
  const source = String(markdown || '');
  const lines = source.split(/(?<=\n)/);
  const matches = [];
  let offset = 0;
  let fence = null;
  for (const chunk of lines) {
    const line = chunk.replace(/\r?\n$/, '');
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      offset += chunk.length;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      offset += chunk.length;
      continue;
    }
    const match = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (match && match[2].trim() === wanted) matches.push({ start: offset, level: match[1].length });
    offset += chunk.length;
  }
  if (matches.length !== 1) return null;
  const selected = matches[0];
  let end = source.length;
  offset = 0;
  fence = null;
  for (const chunk of lines) {
    const line = chunk.replace(/\r?\n$/, '');
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) fence = { character: opening[1][0], length: opening[1].length };
      else if (offset > selected.start) {
        const match = line.match(/^(#{1,6})[ \t]+/);
        if (match && match[1].length <= selected.level) { end = offset; break; }
      }
    }
    offset += chunk.length;
  }
  return {
    start: selected.start,
    end,
    section: source.slice(selected.start, end),
  };
}

function exactRatificationSection(markdown, heading) {
  const selected = exactRatificationSectionRange(markdown, heading);
  return selected ? selected.section : null;
}

function jsonDuplicateKeys(raw) {
  let index = 0;
  const duplicates = [];
  const skip = () => { while (/\s/.test(raw[index] || '')) index += 1; };
  const string = () => {
    const start = index;
    if (raw[index] !== '"') throw new Error('string');
    index += 1;
    while (index < raw.length) {
      if (raw[index] === '\\') { index += 2; continue; }
      if (raw[index] === '"') {
        index += 1;
        return JSON.parse(raw.slice(start, index));
      }
      index += 1;
    }
    throw new Error('unterminated string');
  };
  const value = () => {
    skip();
    if (raw[index] === '{') {
      index += 1;
      skip();
      const keys = new Set();
      if (raw[index] === '}') { index += 1; return; }
      while (index < raw.length) {
        const key = string();
        if (keys.has(key) && !duplicates.includes(key)) duplicates.push(key);
        keys.add(key);
        skip();
        if (raw[index] !== ':') throw new Error('colon');
        index += 1;
        value();
        skip();
        if (raw[index] === '}') { index += 1; return; }
        if (raw[index] !== ',') throw new Error('comma');
        index += 1;
        skip();
      }
      throw new Error('unterminated object');
    }
    if (raw[index] === '[') {
      index += 1;
      skip();
      if (raw[index] === ']') { index += 1; return; }
      while (index < raw.length) {
        value();
        skip();
        if (raw[index] === ']') { index += 1; return; }
        if (raw[index] !== ',') throw new Error('comma');
        index += 1;
      }
      throw new Error('unterminated array');
    }
    if (raw[index] === '"') { string(); return; }
    const token = raw.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!token) throw new Error('value');
    index += token[0].length;
  };
  try {
    value();
    skip();
    return index === raw.length ? duplicates : null;
  } catch (_) {
    return null;
  }
}

function uniqueRatificationErrors(errors) {
  const seen = new Set();
  return errors.filter((issue) => {
    const key = JSON.stringify([issue && issue.code, issue && issue.field, issue && issue.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allUnexpectedRatificationPayloadErrors(markdown, sectionHeading, provenance, parsed) {
  const current = Array.isArray(parsed && parsed.errors) ? parsed.errors : [];
  if (!current.some((issue) => issue && issue.code === 'ratification-field-unexpected')) return parsed;
  const selected = exactRatificationSectionRange(markdown, sectionHeading);
  if (!selected) return parsed;
  const section = selected.section;
  const blocks = [...section.matchAll(/^```delivery-ratification[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (blocks.length !== 1) return parsed;
  let payload;
  try { payload = JSON.parse(blocks[0][1]); } catch (_) { return parsed; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return parsed;
  const allowed = new Set([
    'schema_version', 'receipt_id', 'decision', 'accepted_at',
    'authority', 'target_card', 'target_head', 'scope',
  ]);
  const unexpected = Object.keys(payload).filter((key) => !allowed.has(key));
  if (!unexpected.length) return parsed;
  const nonUnexpected = current.filter((issue) => issue && issue.code !== 'ratification-field-unexpected');
  const unexpectedErrors = unexpected.map((field) => ({
    code: 'ratification-field-unexpected',
    field,
    message: `ratification payload contains unsupported field ${field}`,
  }));
  const sanitizedPayload = Object.fromEntries(
    Object.entries(payload).filter(([field]) => allowed.has(field)),
  );
  const sanitizedBlock = [
    '```delivery-ratification',
    JSON.stringify(sanitizedPayload, null, 2),
    '```',
  ].join('\n');
  const sanitizedSection = section.replace(blocks[0][0], sanitizedBlock);
  const sanitizedMarkdown = [
    markdown.slice(0, selected.start),
    sanitizedSection,
    markdown.slice(selected.end),
  ].join('');
  const semantic = delivery.parseRatificationArtifact(
    sanitizedMarkdown, sectionHeading, provenance,
  );
  return {
    ...semantic,
    ok: false,
    errors: uniqueRatificationErrors([
      ...nonUnexpected,
      ...unexpectedErrors,
      ...(semantic.ok ? [] : semantic.errors),
    ]),
  };
}

function consumeRatificationArtifact(markdown, sectionHeading, provenance, expected = {}) {
  const section = exactRatificationSection(markdown, sectionHeading);
  let duplicates = [];
  if (section) {
    const blocks = [...section.matchAll(/^```delivery-ratification[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
    if (blocks.length === 1) {
      duplicates = jsonDuplicateKeys(blocks[0][1]) || [];
    }
  }
  const parsed = delivery.parseRatificationArtifact(markdown, sectionHeading, provenance);
  const payloadValidation = allUnexpectedRatificationPayloadErrors(
    markdown, sectionHeading, provenance, parsed,
  );
  if (duplicates.length || !parsed.ok) return {
    ok: false,
    errors: uniqueRatificationErrors([
      ...duplicates.map((field) => ({
        code: 'ratification-field-duplicate',
        field,
        message: `ratification payload contains duplicate field ${field}`,
      })),
      ...payloadValidation.errors,
      ...(payloadValidation.receipt
        ? consumeRatificationReceipt(payloadValidation.receipt, expected).errors : []),
    ]),
    receipt: null,
    contract_version: delivery.CONTRACT_VERSION,
  };
  return consumeRatificationReceipt(parsed.receipt, expected);
}

function ratificationRoots(boardPath = BOARD) {
  const projectRoot = path.dirname(boardPath);
  return {
    projectRoot,
    vaultRoot: path.resolve(projectRoot, '../../..'),
    ratificationsRoot: path.join(projectRoot, 'ratifications'),
  };
}

function ratificationArtifactForCard(card, boardPath = BOARD) {
  const id = cardIdToken(card);
  if (!id) throw new Error('ratification target card has no canonical short id');
  const roots = ratificationRoots(boardPath);
  const absolute = path.join(roots.ratificationsRoot, `${id}.md`);
  return {
    ...roots,
    absolute,
    relative: path.relative(roots.vaultRoot, absolute).replace(/\\/g, '/'),
    sectionHeading: `Ratification — ${card}`,
  };
}

function ratificationTargetHead(record) {
  const head = record && record.gate_receipt && record.gate_receipt.head_sha;
  return typeof head === 'string' && EXACT_SHA.test(head) ? head : null;
}

function isRatificationEscalation(record, state) {
  if (!record || record.phase !== 'parked' || record.ratification_receipt) return false;
  const activeIds = new Set(activeRecords(state || { cards: {} }).map((item) => item.card));
  return deliveryReviewTriage.classifyCard({
    card: record.card,
    status: 'parked',
    resume_condition: record.resume_condition || '',
  }, {
    activeIds,
    tracked: Object.values((state && state.cards) || {}),
  }) === 'escalation';
}

function pendingRatificationMarkdown(record, artifact, createdAt, receiptId) {
  const head = ratificationTargetHead(record);
  if (!head) throw new Error(`ratification scaffold requires exact 40-hex gate HEAD for ${record.card}`);
  const scope = String(record.resume_condition || '').trim();
  if (!scope) throw new Error(`ratification scaffold requires a non-empty scope for ${record.card}`);
  const payload = {
    schema_version: delivery.CONTRACT_VERSION,
    receipt_id: receiptId,
    decision: '',
    accepted_at: '',
    authority: '',
    target_card: record.card,
    target_head: head,
    scope: [scope],
  };
  return [
    '---',
    'type: ratification',
    `schema_version: ${JSON.stringify(RATIFICATION_SCHEMA_VERSION)}`,
    'state: pending',
    `target_card: ${JSON.stringify(record.card)}`,
    `created_at: ${JSON.stringify(createdAt)}`,
    '---',
    '',
    `# Ratification: ${cardIdToken(record.card)}`,
    '',
    `Decide whether to accept the bounded authority for **${record.card}**.`,
    'Accepting records the exact authority receipt and lets the coordinator resume the parked work when its remaining execution constraints are clear.',
    '',
    `## ${artifact.sectionHeading}`,
    '',
    '```delivery-ratification',
    JSON.stringify(payload, null, 2),
    '```',
    '',
  ].join('\n');
}

function scaffoldPendingRatifications(state, deps = {}) {
  const boardPath = deps.boardPath || BOARD;
  const now = deps.now || (() => new Date().toISOString());
  const exists = deps.exists || fs.existsSync;
  const writeText = deps.writeText || atomicWriteText;
  const ensureDir = deps.ensureDir || ((dir) => fs.mkdirSync(dir, { recursive: true }));
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const records = Object.values((state && state.cards) || {})
    .filter((record) => isRatificationEscalation(record, state))
    .sort((a, b) => a.card.localeCompare(b.card));
  const scaffolded = [];
  const existing = [];
  const errors = [];
  const plans = [];
  for (const record of records) {
    const artifact = ratificationArtifactForCard(record.card, boardPath);
    if (exists(artifact.absolute)) {
      existing.push(artifact.relative);
      continue;
    }
    try {
      const createdAt = now();
      const markdown = pendingRatificationMarkdown(record, artifact, createdAt, uuid());
      plans.push({ artifact, markdown });
    } catch (err) {
      errors.push({ card: record.card, error: err.message });
    }
  }
  if (errors.length === 0 && plans.length) {
    ensureDir(plans[0].artifact.ratificationsRoot);
    for (const plan of plans) {
      writeText(plan.artifact.absolute, plan.markdown);
      scaffolded.push(plan.artifact.relative);
    }
  }
  return {
    scaffolded,
    existing,
    errors,
    no_op: scaffolded.length === 0,
  };
}

async function commandBackfillRatifications(ctx, args, deps = {}) {
  if (args.json !== true) throw new Error('backfill-ratifications requires --json for a machine-readable receipt');
  if (!Array.isArray(args._) || args._.length !== 1 || args._[0] !== 'backfill-ratifications') {
    throw new Error('backfill-ratifications requires the exact command verb');
  }
  const extras = Object.keys(args).filter((key) => !['_', 'json'].includes(key));
  if (extras.length) throw new Error(`backfill-ratifications received unsupported option --${extras[0]}`);
  const loadState = deps.readState || readState;
  const lock = deps.withLock || withLock;
  return lock(ctx, 'selector', async () => {
    const receipt = scaffoldPendingRatifications(loadState(ctx), deps);
    if (receipt.errors.length) {
      const error = new Error(`ratification backfill refused: ${receipt.errors.map((item) => `${item.card}: ${item.error}`).join('; ')}`);
      error.code = 'RATIFICATION_BACKFILL_REFUSED';
      throw error;
    }
    return {
      action: 'ratifications-backfilled',
      no_op: receipt.no_op,
      created: receipt.scaffolded,
      existing: receipt.existing,
    };
  }, { staleMs: 60 * 60 * 1000 });
}

function validateRatificationArtifactOperand(args, boardPath = BOARD, deps = {}) {
  if (args.json !== true) throw new Error('consume-ratification requires --json for a machine-readable receipt');
  const extras = Object.keys(args).filter((key) => !CONSUME_RATIFICATION_OPTIONS.has(key));
  if (extras.length) throw new Error(`consume-ratification received unsupported option --${extras[0]}`);
  if (!Array.isArray(args._) || args._.length !== 1 || args._[0] !== 'consume-ratification') {
    throw new Error('consume-ratification requires the exact command verb');
  }
  const card = Array.isArray(args.card) ? '' : String(args.card || '').trim();
  if (!card || normalizeCardLink(card) !== card) {
    throw new Error('consume-ratification requires one exact canonical --card identity');
  }
  const canonical = ratificationArtifactForCard(card, boardPath);
  const artifactOperand = args.artifact == null
    ? null
    : (Array.isArray(args.artifact) ? '' : String(args.artifact).trim().replace(/\\/g, '/'));
  if (args.artifact != null && !artifactOperand) {
    throw new Error('consume-ratification requires --artifact to be one non-empty vault-relative Markdown path');
  }
  const relative = artifactOperand == null ? canonical.relative : artifactOperand;
  const parts = relative.split('/');
  if (!relative || relative.startsWith('/') || /^[A-Za-z]:\//.test(relative)
    || !/\.md$/i.test(relative)
    || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('consume-ratification artifact must be a canonical vault-relative Markdown path');
  }
  const absolute = path.resolve(canonical.vaultRoot, ...parts);
  const lexicalRoot = path.resolve(canonical.ratificationsRoot);
  if (absolute === lexicalRoot || !absolute.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new Error('consume-ratification artifact must stay inside the project ratifications directory');
  }
  const exists = deps.exists || fs.existsSync;
  if (!exists(absolute)) throw new Error(`consume-ratification artifact does not exist: ${relative}`);
  const lstat = deps.lstat || fs.lstatSync;
  const entry = lstat(absolute);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error('consume-ratification artifact must be one regular non-symlink Markdown file');
  }
  const physical = deps.physicalDescendant || physicalDescendant;
  physical(canonical.ratificationsRoot, absolute, 'consume-ratification artifact');
  return {
    card,
    artifactOperand,
    absolute,
    relative,
    sectionHeading: canonical.sectionHeading,
    requestIdentity: {
      positional: [...args._],
      json: true,
      card: args.card,
      artifact: artifactOperand,
    },
  };
}

function ratificationFrontmatterErrors(raw, expectedCard, expectedState) {
  const allowed = new Set([
    'type', 'schema_version', 'state', 'target_card', 'created_at',
    ...(expectedState === 'consumed' ? ['consumed_at'] : []),
  ]);
  const lines = frontmatter(raw).split('\n').filter(Boolean);
  const keys = lines.filter((line) => !/^\s/.test(line) && line.includes(':'))
    .map((line) => line.slice(0, line.indexOf(':')).trim());
  const errors = [];
  const counts = keys.reduce((result, key) => result.set(key, (result.get(key) || 0) + 1), new Map());
  for (const unexpected of keys.filter((key) => !allowed.has(key))) {
    errors.push({ code: 'ratification-frontmatter-field-unexpected', field: unexpected, message: `ratification frontmatter contains unsupported field ${unexpected}` });
  }
  for (const [duplicate, count] of counts.entries()) {
    if (count > 1) errors.push({ code: 'ratification-frontmatter-field-duplicate', field: duplicate, message: `ratification frontmatter contains duplicate field ${duplicate}` });
  }
  if (scalarField(raw, 'type') !== 'ratification') errors.push({ code: 'ratification-frontmatter-type', field: 'type', message: 'ratification frontmatter type must be ratification' });
  if (scalarField(raw, 'schema_version') !== RATIFICATION_SCHEMA_VERSION) errors.push({ code: 'ratification-frontmatter-version', field: 'schema_version', message: `ratification frontmatter schema_version must be ${RATIFICATION_SCHEMA_VERSION}` });
  if (scalarField(raw, 'state') !== expectedState) errors.push({ code: 'ratification-frontmatter-state', field: 'state', message: `ratification frontmatter state must be ${expectedState}` });
  if (scalarField(raw, 'target_card') !== expectedCard) errors.push({ code: 'ratification-frontmatter-target', field: 'target_card', message: 'ratification frontmatter target_card must match the exact ledger identity' });
  const createdAt = scalarField(raw, 'created_at');
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) errors.push({ code: 'ratification-frontmatter-created-at', field: 'created_at', message: 'ratification frontmatter created_at must be an ISO timestamp' });
  return errors;
}

function ratificationReplayMatches(record, requestIdentity) {
  const consumption = record && record.ratification_consumption;
  return Boolean(consumption && sameJson(consumption.request_identity, requestIdentity));
}

function ratificationAcceptedWait({ sibling, conflict, unmet = [], atCapacity = false } = {}) {
  if (sibling) return `accepted authority recorded; resume after active sibling ${sibling.card} concurrency clears`;
  if (conflict) return `accepted authority recorded; resume after touch-zone conflict with ${conflict.card} clears`;
  if (unmet.length) return `accepted authority recorded; resume after dependencies deploy: ${unmet.join(', ')}`;
  if (atCapacity) return 'accepted authority recorded; resume after concurrency capacity clears';
  return 'accepted authority recorded; preserved worktree recovery required before resume';
}

async function commandConsumeRatification(ctx, args, deps = {}) {
  const boardPath = deps.boardPath || BOARD;
  // OPX4-CONTAINMENT: resolve and physically contain the artifact before even
  // selecting a state reader. No malformed path can observe coordinator state.
  const operand = validateRatificationArtifactOperand(args, boardPath, deps);
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const lock = deps.withLock || withLock;
  const readText = deps.readText || ((target) => fs.readFileSync(target, 'utf8'));
  const writeText = deps.writeText || atomicWriteText;
  const now = deps.now || (() => new Date().toISOString());
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  const project = deps.projectCard || projectCard;
  return lock(ctx, 'selector', async () => withCardGateLock(ctx, operand.card, async () => {
    const state = loadState(ctx);
    const record = state.cards[operand.card];
    if (!record) throw new Error(`card ${operand.card} is not claimed`);
    requireLeaseToken(record, args, 'consume-ratification', leaseNowMs());
    if (record.ratification_receipt) {
      if (!ratificationReplayMatches(record, operand.requestIdentity)) {
        throw new Error('ratification was already consumed with different operands; replay must be literal');
      }
      const raw = readText(operand.absolute);
      const artifactState = scalarField(raw, 'state');
      const expectedState = artifactState === 'consumed' ? 'consumed' : 'pending';
      const frontmatterErrors = ratificationFrontmatterErrors(raw, operand.card, expectedState);
      const stored = record.ratification_receipt;
      const finishRecovery = async () => {
        const projection = await attemptProjection(ctx, record, boardPath, {
          withLock: lock, projectCard: project, now, state,
        });
        persist(ctx, state, record);
        const station = await attemptLoopStationProjection(ctx, state, 'consume-ratification-recovery', {
          projectLoopStation: deps.projectLoopStation,
          boardPath,
          cardsRoot: deps.cardsRoot,
        });
        const deadend = record.phase === 'blocked' ? String(record.reason || '') : '';
        return {
          action: projection.ok
            ? (deadend ? 'ratification-consumed-deadend' : 'ratification-consumed')
            : 'ratification-consumed-projection-failed',
          card: operand.card,
          phase: record.phase,
          no_op: false,
          recovered: true,
          receipt: stored,
          artifact: operand.relative,
          ...(deadend ? { blocked: true, deadend } : {}),
          ...(projection.ok ? {} : { projection_error: projection.error, reconcile: reconcileRoute(operand.card) }),
          loop_station: station.receipt,
        };
      };
      const verdict = consumeRatificationArtifact(
        raw,
        operand.sectionHeading,
        { artifact_path: operand.relative },
        { target_card: operand.card, target_head: stored.target_head, decision: 'accepted' },
      );
      const receipt = verdict.receipt;
      const receiptMismatch = !receipt
        || receipt.section_sha256 !== stored.section_sha256
        || receipt.section_heading !== stored.section_heading
        || receipt.artifact_path !== stored.artifact_path
        || receipt.receipt_id !== stored.receipt_id
        || receipt.decision !== stored.decision
        || receipt.accepted_at !== stored.accepted_at
        || receipt.authority !== stored.authority
        || JSON.stringify(receipt.scope) !== JSON.stringify(stored.scope)
        || (artifactState === 'pending' && receipt.artifact_sha256 !== stored.artifact_sha256)
        || (artifactState === 'consumed'
          && sha256Text(raw) !== record.ratification_consumption.consumed_artifact_sha256);
      if (frontmatterErrors.length || !verdict.ok || receiptMismatch) {
        throw new Error('settled ratification artifact differs from the stored exact-head receipt');
      }
      if (artifactState === 'pending') {
        const consumedAt = record.ratification_consumption.consumed_at;
        writeText(operand.absolute, patchFrontmatter(raw, {
          state: 'consumed',
          consumed_at: JSON.stringify(consumedAt),
        }));
        record.ratification_consumption.artifact_state = 'consumed';
        record.ratification_consumption.artifact_finalized_at = consumedAt;
        persist(ctx, state, record);
        return finishRecovery();
      }
      if (scalarField(raw, 'consumed_at') !== record.ratification_consumption.consumed_at) {
        throw new Error('settled ratification artifact consumed_at differs from the ledger');
      }
      if (record.ratification_consumption.artifact_state !== 'consumed') {
        record.ratification_consumption.artifact_state = 'consumed';
        record.ratification_consumption.artifact_finalized_at = record.ratification_consumption.consumed_at;
        persist(ctx, state, record);
        return finishRecovery();
      }
      return {
        action: 'ratification-consumed',
        card: operand.card,
        phase: record.phase,
        no_op: true,
        recovered: false,
        receipt: stored,
        artifact: operand.relative,
      };
    }
    if (record.phase !== 'parked' || !isRatificationEscalation(record, state)) {
      throw new Error(`consume-ratification requires a parked escalation; ${operand.card} is ${record.phase}`);
    }
    const targetHead = ratificationTargetHead(record);
    if (!targetHead) throw new Error('parked escalation lacks an exact 40-hex gate HEAD');
    const raw = readText(operand.absolute);
    const frontmatterErrors = ratificationFrontmatterErrors(raw, operand.card, 'pending');
    const verdict = consumeRatificationArtifact(
      raw,
      operand.sectionHeading,
      { artifact_path: operand.relative },
      { target_card: operand.card, target_head: targetHead, decision: 'accepted' },
    );
    const errors = [...frontmatterErrors, ...(verdict.errors || [])];
    if (errors.length) {
      return {
        action: 'ratification-refused',
        card: operand.card,
        phase: record.phase,
        no_op: true,
        state_changed: false,
        artifact: operand.relative,
        errors,
      };
    }
    const consumedAt = now();
    const consumedRaw = patchFrontmatter(raw, {
      state: 'consumed',
      consumed_at: JSON.stringify(consumedAt),
    });
    const active = activeRecords(state);
    const sibling = sameParentConflict(record.parent_card, active, record.card);
    const conflict = conflictsWithActive({ touchZones: record.touch_zones || [] }, active);
    const boardMd = readText(boardPath);
    const dependencies = record.dependencies || [];
    const discardedDependencyProblems = dependencies
      .map((dependency) => discardedDependencyProblem(normalizeCardLink(dependency), state))
      .filter(Boolean);
    const unmet = dependencies.filter((dependency) => (
      !dependencySatisfied(normalizeCardLink(dependency), parseBoard(boardMd), state, boardMd)
    ));
    const deadend = discardedDependencyProblems.length
      ? `ratification accepted but resume refused: ${discardedDependencyProblems.join('; ')}`
      : null;
    const worktreeExists = deps.worktreeExists || fs.existsSync;
    const canResume = !deadend && active.length < MAX_ACTIVE && !sibling && !conflict && unmet.length === 0
      && record.worktree && worktreeExists(record.worktree);
    if (canResume) {
      let actualHead;
      try {
        actualHead = typeof deps.resolveWorktreeHead === 'function'
          ? deps.resolveWorktreeHead(record)
          : (deps.sh || sh)('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
      } catch (err) {
        return {
          action: 'ratification-refused',
          card: operand.card,
          phase: record.phase,
          no_op: true,
          state_changed: false,
          artifact: operand.relative,
          errors: [{ code: 'ratification-worktree-head-unreadable', field: 'target_head', message: err.message }],
        };
      }
      if (String(actualHead || '').trim().toLowerCase() !== targetHead) {
        return {
          action: 'ratification-refused',
          card: operand.card,
          phase: record.phase,
          no_op: true,
          state_changed: false,
          artifact: operand.relative,
          errors: [{ code: 'ratification-worktree-head-mismatch', field: 'target_head', message: 'preserved worktree HEAD differs from the exact ratification target' }],
        };
      }
    }
    const invalidation = {
      invalidated_at: consumedAt,
      reason: 'ratification receipt consumed; rerun every review and combined gate',
      head_sha: targetHead,
      reviews: record.reviews || {},
      gate_receipt: record.gate_receipt || null,
    };
    const priorRecord = JSON.parse(JSON.stringify(record));
    record.ratification_receipt = verdict.receipt;
    record.ratification_consumption = {
      consumed_at: consumedAt,
      request_identity: operand.requestIdentity,
      artifact_state: 'pending-finalize',
      artifact_finalized_at: null,
      consumed_artifact_sha256: sha256Text(consumedRaw),
    };
    if (deadend) {
      record.phase = 'blocked';
      record.reason = deadend;
      record.resume_condition = null;
      record.blocked_at = consumedAt;
    } else if (canResume) {
      record.receipt_invalidations = [...(record.receipt_invalidations || []), invalidation];
      record.reviews = {};
      record.gate_receipt = null;
      record.phase = 'implementing';
      record.resume_condition = null;
      record.resumed_at = consumedAt;
      record.resume_invalidation_reason = invalidation.reason;
    } else {
      record.resume_condition = ratificationAcceptedWait({
        sibling,
        conflict,
        unmet,
        atCapacity: active.length >= MAX_ACTIVE,
      });
    }
    try {
      persist(ctx, state, record);
    } catch (err) {
      state.cards[operand.card] = priorRecord;
      throw err;
    }
    writeText(operand.absolute, consumedRaw);
    record.ratification_consumption.artifact_state = 'consumed';
    record.ratification_consumption.artifact_finalized_at = consumedAt;
    persist(ctx, state, record);
    const projection = await attemptProjection(ctx, record, boardPath, {
      withLock: lock, projectCard: project, now, state,
    });
    persist(ctx, state, record);
    const station = await attemptLoopStationProjection(ctx, state, 'consume-ratification', {
      projectLoopStation: deps.projectLoopStation,
      boardPath,
      cardsRoot: deps.cardsRoot,
    });
    return {
      action: projection.ok
        ? (deadend ? 'ratification-consumed-deadend' : 'ratification-consumed')
        : 'ratification-consumed-projection-failed',
      card: operand.card,
      phase: record.phase,
      no_op: false,
      artifact: operand.relative,
      receipt: verdict.receipt,
      resumed: canResume,
      ...(deadend
        ? { blocked: true, deadend }
        : canResume
          ? { reviews_invalidated: true, invalidation_reason: invalidation.reason }
          : { wait: record.resume_condition }),
      ...(projection.ok ? {} : { projection_error: projection.error, reconcile: reconcileRoute(operand.card) }),
      loop_station: station.receipt,
    };
  }, { card: operand.card, staleMs: 60 * 60 * 1000 }, lock), {
    card: operand.card,
    staleMs: 60 * 60 * 1000,
  });
}

function sameParentConflict(parentCard, records, excludeCard = '') {
  const parent = normalizeCardLink(parentCard);
  if (!parent) return null;
  return (records || []).find((record) => record.card !== excludeCard
    && record.phase !== 'parked'
    && normalizeCardLink(record.parent_card) === parent) || null;
}

function zonesOverlap(a, b) {
  return delivery.zoneConflicts([a], [b]);
}

function conflictsWithActive(meta, active) {
  for (const record of active || []) {
    for (const mine of meta.touchZones || []) {
      for (const theirs of record.touch_zones || []) {
        if (zonesOverlap(mine, theirs)) return { card: record.card, zone: mine, conflicts_with: theirs };
      }
    }
  }
  return null;
}

function frontmatter(raw) {
  const match = String(raw || '').match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function scalarField(raw, key) {
  const line = frontmatter(raw).split('\n').find((s) => new RegExp(`^${key}:`).test(s));
  return line ? line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '') : '';
}

function listField(raw, key) {
  const lines = frontmatter(raw).split('\n');
  const idx = lines.findIndex((s) => new RegExp(`^${key}:`).test(s));
  if (idx < 0) return [];
  const inline = lines[idx].slice(lines[idx].indexOf(':') + 1).trim();
  if (inline) {
    if (inline === '[]') return [];
    return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  const out = [];
  for (let i = idx + 1; i < lines.length && /^\s+/.test(lines[i]); i++) {
    const match = lines[i].match(/^\s+-\s+(.*?)\s*$/);
    if (match) out.push(match[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

function deploymentField(raw) {
  const lines = frontmatter(raw).split('\n');
  const idx = lines.findIndex((s) => /^deploy_subscriptions:/.test(s));
  if (idx < 0) return null;
  const inline = lines[idx].slice(lines[idx].indexOf(':') + 1).trim();
  if (inline) {
    try {
      const yamlScalar = JSON.parse(inline);
      const decoded = delivery.decodeStructuredContractFields({ deploy_subscriptions: yamlScalar });
      return decoded.errors.length ? null : decoded.card.deploy_subscriptions;
    } catch (_) {
      return null;
    }
  }
  const out = {};
  let current = null;
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i] && !/^\s+/.test(lines[i])) break;
    const vault = lines[i].match(/^\s{2}([a-zA-Z0-9_-]+):\s*(.*?)\s*$/);
    if (vault) {
      current = vault[1];
      const inline = vault[2];
      out[current] = !inline || inline === '[]' ? []
        : inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      continue;
    }
    const item = lines[i].match(/^\s{4}-\s+(.*?)\s*$/);
    if (item && current) out[current].push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

function normalizeDeploymentMap(value, opts = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${opts.label || 'deployment map'} must be a JSON object`);
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [...CONTRACT_VAULT_IDS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${opts.label || 'deployment map'} requires exactly headspace, accuris, and ero arrays`);
  }
  const normalized = {};
  for (const vault of CONTRACT_VAULT_IDS) {
    if (!Array.isArray(value[vault])) {
      throw new Error(`${opts.label || 'deployment map'}.${vault} must be an array`);
    }
    if (value[vault].some((entry) => typeof entry !== 'string')) {
      throw new Error(`${opts.label || 'deployment map'}.${vault} entries must be strings`);
    }
    normalized[vault] = opts.preserveEntries
      ? [...value[vault]]
      : [...new Set(value[vault].map((entry) => entry.trim()).filter(Boolean))];
    if (opts.requireTyped && normalized[vault].some((entry) => !/^(mechanism|blueprint):[a-z0-9._-]+$/i.test(entry))) {
      throw new Error(`${opts.label || 'deployment map'}.${vault} entries must match mechanism:name or blueprint:name`);
    }
  }
  return normalized;
}

function parseDeploymentArgument(value, label, opts = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`amend-contract requires --${label}`);
  let parsed;
  try { parsed = JSON.parse(value); }
  catch (err) { throw new Error(`--${label} must be valid JSON: ${err.message}`); }
  return normalizeDeploymentMap(parsed, { label: `--${label}`, ...opts });
}

function parseBatchPolicyArgument(value, label, opts = {}) {
  if (Array.isArray(value) || typeof value !== 'string' || !value.trim()) {
    throw new Error(`amend-contract requires --${label}`);
  }
  const normalized = value.trim().toLowerCase();
  if (opts.allowNull && normalized === 'null') return null;
  if (!delivery.registry.policies.policy_strength.includes(normalized)) {
    throw new Error(`--${label} must be ${opts.allowNull ? 'null|' : ''}${delivery.registry.policies.policy_strength.join('|')}`);
  }
  return normalized;
}

function normalizeStoredTouchZones(value) {
  if (!Array.isArray(value) || !value.length || value.some((zone) => typeof zone !== 'string')) {
    throw new Error('tracked contract has malformed touch_zones');
  }
  const normalized = value.map(normalizeZone);
  if (normalized.some((zone) => !zone) || new Set(normalized).size !== normalized.length) {
    throw new Error('tracked contract has malformed touch_zones');
  }
  if (normalized.some((zone, index) => zone !== value[index])) {
    throw new Error('tracked contract has noncanonical touch_zones');
  }
  return normalized;
}

function sameDeploymentMap(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function amendmentRequestOperands(args) {
  return {
    positional: Array.isArray(args._) ? [...args._] : [],
    json: args.json === true,
    card: args.card,
    expected_head: args['expected-head'],
    expected_origin_main: args['expected-origin-main'],
    reason: args.reason,
    add_touch_zone: args['add-touch-zone'] == null
      ? [] : (Array.isArray(args['add-touch-zone']) ? [...args['add-touch-zone']] : [args['add-touch-zone']]),
    expected_deployment: args['expected-deployment'],
    desired_deployment: args['desired-deployment'],
    expected_batch_policy: args['expected-batch-policy'],
    desired_batch_policy: args['desired-batch-policy'],
  };
}

function amendmentReplayMatches(record, request, currentContract) {
  const amendments = record.contract_amendments;
  const audit = Array.isArray(amendments) ? amendments[amendments.length - 1] : null;
  const identity = audit && audit.request_identity;
  return Boolean(identity
    && sameJson(identity.request, request)
    && sameJson(identity.prior_contract, audit.old_contract)
    && sameJson(identity.new_contract, audit.new_contract)
    && sameJson(audit.new_contract, currentContract));
}

// A parked card may legitimately hold ZERO dependencies only when amend-park
// cleared them: its audit trail is the proof the empty list was supervised,
// not corrupted park metadata.
function parkDependenciesClearedByAudit(record) {
  return Array.isArray(record.park_amendments) && record.park_amendments.some((amendment) => amendment
    && amendment.next && Array.isArray(amendment.next.dependencies) && amendment.next.dependencies.length === 0);
}

function parkedAmendmentProblem(record) {
  if (!Array.isArray(record.dependencies)
    || record.dependencies.some((dependency) => !normalizeCardLink(dependency))
    || (!record.dependencies.length && !parkDependenciesClearedByAudit(record))) {
    return 'amend-contract requires parked work to retain non-empty dependencies';
  }
  if (typeof record.resume_condition !== 'string' || !record.resume_condition.trim()) {
    return 'amend-contract requires parked work to retain a non-empty resume condition';
  }
  return '';
}

function formatExecutionContractFrontmatter(touchZones, deployments) {
  return {
    touch_zones: ['touch_zones:', ...touchZones.map((zone) => `  - ${JSON.stringify(zone)}`)],
    deploy_subscriptions: [
      `deploy_subscriptions: ${delivery.encodeStructuredFrontmatterValue(deployments)}`,
    ],
  };
}

function patchFrontmatterBlocks(raw, fields) {
  return String(raw).replace(/^---\n([\s\S]*?)\n---/, (_, body) => {
    let lines = body.split('\n');
    for (const [key, replacement] of Object.entries(fields)) {
      const idx = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
      if (idx < 0) throw new Error(`card frontmatter is missing ${key}`);
      let end = idx + 1;
      while (end < lines.length && /^\s+/.test(lines[end])) end++;
      lines.splice(idx, end - idx, ...replacement);
    }
    return `---\n${lines.join('\n')}\n---`;
  });
}

function rewriteDependsOn(raw, fromName, toNameOrNull) {
  const from = normalizeCardLink(fromName);
  const to = toNameOrNull == null ? null : normalizeCardLink(toNameOrNull);
  const current = parseDependsOn(raw); // normalized names
  if (!current.includes(from)) return { text: raw, changed: false };
  const next = [];
  for (const name of current) {
    if (name !== from) { if (!next.includes(name)) next.push(name); continue; }
    if (to && !next.includes(to)) next.push(to);
  }
  const serialized = next.length
    ? ['depends_on:', ...next.map((n) => (/^external:/.test(n) ? `  - ${JSON.stringify(n)}` : `  - "[[${n}]]"`))]
    : ['depends_on: []'];
  const text = patchFrontmatterBlocks(raw, { depends_on: serialized });
  return { text, changed: true };
}

function ownsAmendedContract(record) {
  return Boolean(record && Array.isArray(record.contract_amendments) && record.contract_amendments.length);
}

function ownsAmendedBatchPolicy(record) {
  return ownsAmendedContract(record) && record.contract_amendments.some((amendment) => (
    amendment && amendment.new_contract
      && Object.prototype.hasOwnProperty.call(amendment.new_contract, 'batch_policy')
  ));
}

function executionContractProjectionProblem(record, raw) {
  const projectedTouchZones = listField(raw, 'touch_zones').map(normalizeZone);
  const authoritativeTouchZones = normalizeStoredTouchZones(record.touch_zones);
  const projectedDeployments = deploymentField(raw);
  const authoritativeDeployments = normalizeDeploymentMap(record.deploy_subscriptions, {
    label: 'tracked contract deployment map', preserveEntries: true,
  });
  if (JSON.stringify(projectedTouchZones) !== JSON.stringify(authoritativeTouchZones)) return 'projected touch_zones differ from authority';
  if (!projectedDeployments || !sameDeploymentMap(
    normalizeDeploymentMap(projectedDeployments, { label: 'projected deployment map', preserveEntries: true }),
    authoritativeDeployments,
  )) return 'projected deployment map differs from authority';
  if (record.model_profile && scalarField(raw, 'model_profile') !== record.model_profile) return 'projected model_profile differs from authority';
  if (Array.isArray(record.dependencies)
    && JSON.stringify(parseDependsOn(raw).map(normalizeCardLink)) !== JSON.stringify(record.dependencies.map(normalizeCardLink))) {
    return 'projected dependencies differ from authority';
  }
  if (record.parent_card && normalizeCardLink(scalarField(raw, 'parent_card')) !== normalizeCardLink(record.parent_card)) {
    return 'projected parent_card differs from authority';
  }
  if (record.slice && scalarField(raw, 'slice') !== String(record.slice)) return 'projected slice differs from authority';
  if (scalarField(raw, 'execution_mode') !== 'release') return 'projected execution_mode must remain release';
  if (ownsAmendedBatchPolicy(record) && parseBatchPolicy(raw) !== record.batch_policy) {
    return 'projected batch_policy differs from authority';
  }
  return null;
}

function parseExecutionMeta(raw, card) {
  const prepared = prepareDeliveryCard(raw, card);
  return {
    modelProfile: prepared.card.model_profile,
    touchZones: prepared.card.touch_zones || [],
    dependencies: prepared.card.depends_on || [],
    deploySubscriptions: prepared.card.deploy_subscriptions,
    parentCard: prepared.card.parent_card,
    slice: prepared.card.slice,
    status: prepared.card.status,
    batchPolicy: delivery.derivePolicy(prepared.card),
    contract: prepared.card,
    contractSource: prepared.source,
    contractVersion: delivery.CONTRACT_VERSION,
    contractValidation: prepared.validation,
    contractMigration: prepared.migration,
    contractOk: prepared.ok,
    contractReason: validationReason(prepared),
  };
}

function validateExecutionMeta(meta) {
  const errors = [];
  if (!meta.contractOk) errors.push(`delivery contract invalid: ${meta.contractReason}`);
  if (!['standard', 'heavy'].includes(meta.modelProfile)) errors.push('model_profile must be standard|heavy');
  if (!meta.touchZones.length) errors.push('touch_zones must be non-empty');
  if (meta.status !== undefined && meta.status !== 'planning') errors.push(`status must normalize to planning for eligibility (got ${meta.status || 'unknown'})`);
  if (!meta.deploySubscriptions) errors.push('deploy_subscriptions is required');
  else for (const id of CONTRACT_VAULT_IDS) if (!Array.isArray(meta.deploySubscriptions[id])) errors.push(`deploy_subscriptions.${id} is required`);
  return errors;
}

function findCard(cardsRoot, card) {
  const target = `${card}.md`;
  const stack = [cardsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.name === target) return full;
    }
  }
  return null;
}

function resolveCardPath(cardPath, card, cardsRoot = CARDS_ROOT) {
  if (cardPath && fs.existsSync(cardPath)) return cardPath;
  return card ? (findCard(cardsRoot, card) || cardPath) : cardPath;
}

function activeRecords(state) {
  return Object.values(state.cards || {}).filter((r) => r.phase !== 'parked' && !TERMINAL.has(r.phase));
}

function successfulDeploymentReceipts(record) {
  if (!record || record.phase !== 'deployed') return false;
  return VAULTS.every((vault) => {
    const receipt = record.vault_receipts && record.vault_receipts[vault.id];
    if (!receipt || receipt.ok !== true) return false;
    if (record.required_version && (!receipt.installed_version
      || cmpVersion(receipt.installed_version, record.required_version) < 0)) return false;
    return true;
  });
}

function dependencySatisfied(dep, board, state, boardMd) {
  const record = state.cards[dep];
  // A tombstoned dependency will never deploy; it must fail loudly and can
  // never fall through to the Completed-checkbox fallback below.
  if (record && record.phase === 'discarded') return false;
  if (record) return successfulDeploymentReceipts(record);
  const completed = boardMd == null
    ? new Set(board.Completed || [])
    : parseCheckedColumn(boardMd, 'Completed');
  return completed.has(dep);
}

function resolveSupersessionTail(dep, state) {
  const cards = (state && state.cards) || {};
  const hops = [];
  const seen = new Set();
  let name = normalizeCardLink(dep);
  while (true) {
    if (seen.has(name)) return { tail: hops[hops.length - 1] || name, hops, deadEnd: false, cycle: true };
    const record = cards[name];
    if (!record || record.phase !== 'discarded') {
      // reached a live/unknown node — it is a valid repoint target
      return { tail: name, hops, deadEnd: false, cycle: false };
    }
    const next = record.superseded_by ? normalizeCardLink(record.superseded_by) : null;
    if (!next) return { tail: name, hops, deadEnd: true, cycle: false }; // discarded, no successor
    seen.add(name);
    hops.push(name);
    name = next;
  }
}

// Supersession-depth circuit-breaker: count how many prior supersessions already
// lead INTO `card` by walking `superseded_by` backward through the ledger (the
// predecessor of `card` is whatever record points its superseded_by at it). A
// deep chain is the accreting-1:1 runaway (one slice spun 27 supersessions and
// merged nothing) that the carried_findings breadth cap can't see — each hop
// carries few findings but the lineage never converges.
function supersessionChainDepth(card, state) {
  const cards = (state && state.cards) || {};
  let current = normalizeCardLink(card);
  let depth = 0;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const predecessor = Object.values(cards).find((record) => record
      && record.superseded_by && normalizeCardLink(record.superseded_by) === current);
    if (!predecessor) break;
    depth += 1;
    current = normalizeCardLink(predecessor.card);
  }
  return depth;
}

// Registry-sourced ceiling (policies.slice_scope_caps.supersession_depth). 0 or
// absent disables the guard, so an unconfigured board degrades safely.
function supersessionDepthLimit() {
  const caps = delivery.registry.policies && delivery.registry.policies.slice_scope_caps;
  const limit = caps && caps.supersession_depth;
  return typeof limit === 'number' ? limit : 0;
}

function discardedDependencyProblem(dep, state) {
  const record = state.cards && state.cards[dep];
  if (!record || record.phase !== 'discarded') return null;
  const resolved = resolveSupersessionTail(dep, state);
  const successor = resolved.tail && resolved.tail !== dep ? ` (superseded by ${resolved.tail})` : '';
  return `depends on discarded card ${dep}${successor}`;
}

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/');
}

function resolveEpicBoardSet({
  parentBoardMd, cardsRoot = CARDS_ROOT,
  columns = ['In Progress', 'In Planning'],
  readFile = (file) => fs.readFileSync(file, 'utf8'),
  readDir = (dir) => fs.readdirSync(dir, { withFileTypes: true }),
  exists = (target) => fs.existsSync(target),
} = {}) {
  const parent = parseBoard(parentBoardMd || '');
  const ordered = columns.flatMap((column) => parent[column] || []);
  const epics = [];
  const findings = [];
  const flat = [];
  const seen = new Set();
  ordered.forEach((epic, parentOrder) => {
    if (seen.has(epic)) {
      findings.push({ epic, code: 'duplicate-parent-membership' });
      return;
    }
    seen.add(epic);
    const epicRoot = path.join(cardsRoot, epic);
    const resolvedRoot = path.resolve(epicRoot);
    const resolvedCardsRoot = path.resolve(cardsRoot);
    if (resolvedRoot !== resolvedCardsRoot && !resolvedRoot.startsWith(`${resolvedCardsRoot}${path.sep}`)) {
      findings.push({ epic, code: 'epic-path-escape' });
      return;
    }
    const boardDir = path.join(epicRoot, 'board');
    if (!exists(boardDir)) {
      const possibleAtlas = path.join(epicRoot, `${epic}.md`);
      if (exists(possibleAtlas)) {
        try {
          if (scalarField(readFile(possibleAtlas), 'type') === 'epic') {
            findings.push({ epic, code: 'missing-epic-board', count: 0 });
            return;
          }
        } catch (err) {
          findings.push({ epic, code: 'epic-atlas-unreadable', detail: err.message });
          return;
        }
      }
      flat.push({
        card: epic,
        parent_column: columns.find((column) => (parent[column] || []).includes(epic)) || null,
        parent_order: parentOrder,
      });
      return;
    }
    let candidates;
    try {
      candidates = readDir(boardDir)
        .filter((entry) => entry && (entry.isFile ? entry.isFile() : entry.type === 'file') && entry.name.endsWith('.md'))
        .map((entry) => {
          const boardPath = path.join(boardDir, entry.name);
          return { board_path: boardPath, raw: readFile(boardPath) };
        })
        .filter((entry) => scalarField(entry.raw, 'board_role') === 'epic');
    } catch (err) {
      findings.push({ epic, code: 'epic-board-unreadable', detail: err.message });
      return;
    }
    if (candidates.length !== 1) {
      findings.push({ epic, code: candidates.length ? 'multiple-epic-boards' : 'missing-epic-board', count: candidates.length });
      return;
    }
    const atlasPath = path.join(epicRoot, `${epic}.md`);
    if (!exists(atlasPath)) {
      findings.push({ epic, code: 'missing-epic-atlas', board_path: candidates[0].board_path });
      return;
    }
    let atlasRaw;
    try { atlasRaw = readFile(atlasPath); }
    catch (err) {
      findings.push({ epic, code: 'epic-atlas-unreadable', detail: err.message });
      return;
    }
    const expectedSuffix = normalizedPath(path.join(path.basename(cardsRoot), epic, 'board', path.basename(candidates[0].board_path)));
    const backlink = normalizedPath(scalarField(atlasRaw, 'epic_board'));
    if (scalarField(atlasRaw, 'type') !== 'epic' || (!backlink.endsWith(expectedSuffix) && backlink !== expectedSuffix)) {
      findings.push({ epic, code: 'epic-atlas-mismatch', atlas_path: atlasPath, board_path: candidates[0].board_path });
      return;
    }
    epics.push({
      epic, atlas_path: atlasPath, board_path: candidates[0].board_path,
      parent_column: columns.find((column) => (parent[column] || []).includes(epic)) || null,
      parent_order: parentOrder,
    });
  });
  return { epics, flat, findings };
}

function loadCanonicalEpicSlice({
  epic, card, boardPath, cardsRoot = CARDS_ROOT,
  readFile = (file) => fs.readFileSync(file, 'utf8'),
  exists = (target) => fs.existsSync(target),
} = {}) {
  const boardDir = path.resolve(path.dirname(boardPath));
  const cardPath = path.resolve(boardDir, `${card}.md`);
  if (path.dirname(cardPath) !== boardDir) {
    return { path: cardPath, error: 'epic slice name must remain beside its epic board' };
  }
  if (!exists(cardPath)) return null;
  let raw;
  try { raw = readFile(cardPath); }
  catch (err) { return { path: cardPath, error: `epic slice unreadable: ${err.message}` }; }
  const expectedBoardSuffix = normalizedPath(path.join(path.basename(cardsRoot), epic, 'board', path.basename(boardPath)));
  const expectedAtlasSuffix = normalizedPath(path.join(path.basename(cardsRoot), epic, `${epic}.md`));
  const actualEpic = normalizeCardLink(scalarField(raw, 'epic'));
  const actualParent = normalizeCardLink(scalarField(raw, 'parent_card'));
  const actualTaskParent = normalizedPath(scalarField(raw, 'task_parent'));
  const actualSourceBoard = normalizedPath(scalarField(raw, 'source_board'));
  const actualKanbanBoard = normalizedPath(scalarField(raw, 'kanban_board'));
  const suffixMatches = (actual, expected) => actual === expected || actual.endsWith(`/${expected}`);
  const problems = [];
  if (scalarField(raw, 'type') !== 'slice') problems.push('type must be slice');
  if (actualEpic !== epic) problems.push(`epic must be ${epic}`);
  if (actualParent !== epic) problems.push(`parent_card must be ${epic}`);
  if (!suffixMatches(actualTaskParent, expectedAtlasSuffix)) problems.push(`task_parent must end with ${expectedAtlasSuffix}`);
  if (!suffixMatches(actualSourceBoard, expectedBoardSuffix)) problems.push(`source_board must end with ${expectedBoardSuffix}`);
  if (!suffixMatches(actualKanbanBoard, expectedBoardSuffix)) problems.push(`kanban_board must end with ${expectedBoardSuffix}`);
  if (problems.length) return { path: cardPath, error: `epic slice binding invalid: ${problems.join('; ')}` };
  return { path: cardPath, raw };
}

function selectEpicCandidate({
  boardMd, state, loadCard, supervised = false, cardsRoot = CARDS_ROOT,
  readFile, readDir, exists, loadEpicCard,
} = {}) {
  const resolved = resolveEpicBoardSet({
    parentBoardMd: boardMd, cardsRoot, readFile, readDir, exists,
  });
  const epicByName = new Map(resolved.epics.map((entry) => [entry.epic, entry]));
  const flatByName = new Map(resolved.flat.map((entry) => [entry.card, entry]));
  const parent = parseBoard(boardMd);
  const parentOrder = [...(parent['In Progress'] || []), ...(parent['In Planning'] || [])];
  const tracked = Object.values(state.cards || {});
  const activeEpicNames = new Set(tracked
    .filter((record) => record && (record.phase === 'parked' || !TERMINAL.has(record.phase)))
    .map((record) => normalizeCardLink(record.parent_card))
    .filter((name) => epicByName.has(name)));
  const orderedNames = [
    ...parentOrder.filter((name) => activeEpicNames.has(name)),
    ...parentOrder.filter((name) => !activeEpicNames.has(name)),
  ];
  const skipped = [];
  const epicBoards = new Map();
  const globalCompleted = new Set(parseCheckedColumn(boardMd, 'Completed'));
  const load = readFile || ((file) => fs.readFileSync(file, 'utf8'));
  for (const epic of resolved.epics) {
    try {
      const raw = load(epic.board_path);
      const parsed = parseBoard(raw);
      epicBoards.set(epic.epic, parsed);
      for (const card of parseCheckedColumn(raw, 'Completed')) globalCompleted.add(card);
    } catch (err) {
      skipped.push({ epic: epic.epic, reason: `epic board unreadable: ${err.message}` });
    }
  }
  for (const name of orderedNames) {
    const epic = epicByName.get(name);
    const flat = flatByName.get(name);
    if (!epic && !flat) continue;
    let candidateBoard;
    if (epic) {
      const parsed = epicBoards.get(name);
      if (!parsed) continue;
      candidateBoard = [
        '## In Planning', ...(parsed['In Planning'] || []).map((card) => `- [ ] [[${card}]]`), '',
        '## In Progress', ...(parsed['In Progress'] || []).map((card) => `- [ ] [[${card}]]`), '',
        '## Blocked', ...(parsed.Blocked || []).map((card) => `- [ ] [[${card}]]`), '',
        '## Completed', ...[...globalCompleted].map((card) => `- [x] [[${card}]]`), '',
      ].join('\n');
    } else {
      candidateBoard = [
        '## In Planning', `- [ ] [[${name}]]`, '', '## In Progress', '', '## Blocked', '',
        '## Completed', ...[...globalCompleted].map((card) => `- [x] [[${card}]]`), '',
      ].join('\n');
    }
    const candidateLoader = epic
      ? (card) => (loadEpicCard
        ? loadEpicCard(name, card, epic.board_path)
        : loadCanonicalEpicSlice({
          epic: name, card, boardPath: epic.board_path, cardsRoot,
          readFile: readFile || ((file) => fs.readFileSync(file, 'utf8')),
          exists: exists || ((target) => fs.existsSync(target)),
        }))
      : loadCard;
    const selected = selectClaimCandidate({
      boardMd: candidateBoard, state, loadCard: candidateLoader, supervised, epicShadow: false,
    });
    if (selected.action === 'claim' || selected.action === 'at-capacity') {
      return {
        ...selected,
        source: epic ? 'epic' : 'flat',
        ...(epic ? { epic: name, board_path: epic.board_path } : {}),
        findings: resolved.findings,
        skipped: [...skipped, ...(selected.skipped || [])],
      };
    }
    skipped.push(...(selected.skipped || []).map((item) => ({ ...item, ...(epic ? { epic: name } : {}) })));
  }
  return { action: 'no-work', reason: 'no eligible execution card', findings: resolved.findings, skipped };
}

function selectEpicShadowCandidate(options = {}) {
  const selected = selectEpicCandidate(options);
  return {
    ...summarizeClaimSelection(selected),
    ...(selected.source ? { source: selected.source } : {}),
    ...(selected.epic ? { epic: selected.epic } : {}),
    ...(selected.board_path ? { board_path: selected.board_path } : {}),
    findings: selected.findings || [],
    skipped: selected.skipped || [],
  };
}

function selectClaimCandidate({
  boardMd, state, loadCard, supervised = false, epicShadow = false,
  cardsRoot = CARDS_ROOT, readFile, readDir, exists, loadEpicCard,
}) {
  const board = parseBoard(boardMd);
  const active = activeRecords(state);
  if (active.length >= MAX_ACTIVE) {
    const selected = { action: 'at-capacity', active: active.map((r) => r.card), activeRecords: active };
    if (epicShadow) selected.shadow_selection = selectEpicShadowCandidate({
      boardMd, state, loadCard, supervised, cardsRoot, readFile, readDir, exists, loadEpicCard,
    });
    return selected;
  }
  const skipped = []; const boardDrift = [];
  for (const card of board['In Planning']) {
    if (state.cards[card] && state.cards[card].phase !== 'cancelled') { skipped.push({ card, reason: `already tracked (${state.cards[card].phase})` }); continue; }
    const loaded = loadCard(card);
    if (!loaded || !loaded.raw) { skipped.push({ card, reason: (loaded && loaded.error) || 'card note missing' }); continue; }
    const meta = parseExecutionMeta(loaded.raw, card);
    const errors = validateExecutionMeta(meta);
    if (errors.length) { skipped.push({ card, reason: errors.join('; ') }); continue; }
    // Keep the unmet set explicit so recovery diagnostics can name each gate.
    const unmet = [];
    let discardedDependency = null;
    for (const dep of meta.dependencies) {
      discardedDependency ||= discardedDependencyProblem(dep, state);
      if (!dependencySatisfied(dep, board, state, boardMd)) unmet.push(dep);
      else if (state.cards[dep] && !parseCheckedColumn(boardMd, 'Completed').has(dep)
        && !boardDrift.some((item) => item.card === dep)) {
        boardDrift.push({ card: dep, issue: 'deployed dependency is not checked in Completed' });
      }
    }
    if (discardedDependency) { skipped.push({ card, reason: discardedDependency }); continue; }
    if (unmet.length) { skipped.push({ card, reason: `dependencies not deployed: ${unmet.join(', ')}` }); continue; }
    const eligibility = delivery.batchEligibility(meta.contract, {
      mode: meta.contractSource === 'historical' ? 'historical' : 'current',
      supervised,
      dependency_result: { eligible: true, missing_proof: [] },
    });
    if (!eligibility.eligible) {
      skipped.push({ card, reason: `delivery batch ineligible: ${eligibility.reason}` }); continue;
    }
    const sibling = sameParentConflict(meta.parentCard, active);
    if (sibling) { skipped.push({ card, reason: `active sibling ${sibling.card} has parent ${normalizeCardLink(meta.parentCard)}` }); continue; }
    const conflict = conflictsWithActive(meta, active);
    if (conflict) { skipped.push({ card, reason: `touch-zone conflict with ${conflict.card}: ${conflict.zone}` }); continue; }
    const selected = {
      action: 'claim', card, cardPath: loaded.path, meta, skipped,
      ...(boardDrift.length ? { board_drift: boardDrift } : {}),
    };
    if (epicShadow) selected.shadow_selection = selectEpicShadowCandidate({
      boardMd, state, loadCard, supervised, cardsRoot, readFile, readDir, exists, loadEpicCard,
    });
    return selected;
  }
  const selected = {
    action: 'no-work', skipped, reason: 'no eligible execution card',
    ...(boardDrift.length ? { board_drift: boardDrift } : {}),
  };
  if (epicShadow) selected.shadow_selection = selectEpicShadowCandidate({
    boardMd, state, loadCard, supervised, cardsRoot, readFile, readDir, exists, loadEpicCard,
  });
  return selected;
}

function selectCoordinatorCandidate({
  boardMd, state, loadCard, supervised = false, epicShadow = false,
  cardsRoot = CARDS_ROOT, readFile, readDir, exists, loadEpicCard,
  epicTopology = LOOP_BINDING.epicTopology,
}) {
  if (epicTopology || (state && state.cutover && state.cutover.enabled === true)) {
    return selectEpicCandidate({
      boardMd, state, loadCard, supervised, cardsRoot, readFile, readDir, exists, loadEpicCard,
    });
  }
  return selectClaimCandidate({
    boardMd, state, loadCard, supervised, epicShadow,
    cardsRoot, readFile, readDir, exists, loadEpicCard,
  });
}

function summarizeClaimSelection(selected, nowMs = Date.now()) {
  const skipped = selected.skipped || [];
  if (selected.action === 'claim') {
    const summary = {
      action: 'claim', card: selected.card,
      model_profile: selected.meta.modelProfile,
      touch_zones: selected.meta.touchZones,
      contract_version: selected.meta.contractVersion,
      contract_source: selected.meta.contractSource,
      skipped_count: skipped.length,
    };
    if (selected.meta.status) summary.status = selected.meta.status;
    if (selected.meta.batchPolicy) summary.batch_policy = selected.meta.batchPolicy;
    if (selected.board_drift) summary.board_drift = selected.board_drift;
    if (selected.shadow_selection) summary.shadow_selection = selected.shadow_selection;
    if (selected.source) summary.source = selected.source;
    if (selected.epic) summary.epic = selected.epic;
    if (selected.board_path) summary.board_path = selected.board_path;
    if (selected.findings) summary.findings = selected.findings;
    return summary;
  }
  if (selected.action === 'at-capacity') {
    const records = selected.activeRecords || [];
    const resumable = records.filter((r) => !leaseIsLive(r.lease, nowMs)).map((r) => r.card);
    const leased = records.filter((r) => leaseIsLive(r.lease, nowMs))
      .map((r) => ({ card: r.card, expires_in_ms: leaseSummary(r.lease, nowMs).expires_in_ms }));
    const shadow = selected.shadow_selection ? { shadow_selection: selected.shadow_selection } : {};
    if (records.length && resumable.length === 0) {
      return {
        action: 'all-work-leased', leased,
        soonest_expiry_ms: Math.min(...leased.map((l) => l.expires_in_ms)),
        ...shadow,
      };
    }
    return {
      action: 'at-capacity', active: selected.active || [], resumable, leased,
      ...shadow,
    };
  }
  const summary = {
    action: selected.action, reason: selected.reason || null,
    skipped_count: skipped.length, first_blocker: skipped[0] || null,
  };
  if (selected.board_drift) summary.board_drift = selected.board_drift;
  if (selected.shadow_selection) summary.shadow_selection = selected.shadow_selection;
  if (selected.source) summary.source = selected.source;
  if (selected.epic) summary.epic = selected.epic;
  if (selected.board_path) summary.board_path = selected.board_path;
  if (selected.findings) summary.findings = selected.findings;
  return summary;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

function cardGateLockName(card) {
  const exactIdentity = String(card);
  const readable = slugify(exactIdentity) || 'card';
  const digest = crypto.createHash('sha256').update(exactIdentity).digest('hex');
  return `gates-${readable}-${digest}`;
}

function legacyCardGateLockName(card) {
  return `gates-${slugify(card)}`;
}

function withCardGateLock(ctx, card, fn, opts = {}, lock = withLock, heldLegacyName = '') {
  const legacyName = legacyCardGateLockName(card);
  const acquireExact = () => lock(ctx, cardGateLockName(card), fn, opts);
  if (heldLegacyName === legacyName) return acquireExact();
  return lock(ctx, legacyName, acquireExact, opts);
}

function patchFrontmatter(raw, fields) {
  return String(raw).replace(/^---\n([\s\S]*?)\n---/, (_, body) => {
    const lines = body.split('\n');
    for (const [key, value] of Object.entries(fields)) {
      const idx = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
      let end = idx + 1;
      if (idx >= 0) while (end < lines.length && /^\s+/.test(lines[end])) end++;
      if (value == null) {
        if (idx >= 0) lines.splice(idx, end - idx);
      } else if (idx >= 0) lines.splice(idx, end - idx, `${key}: ${value}`);
      else lines.push(`${key}: ${value}`);
    }
    return `---\n${lines.join('\n')}\n---`;
  });
}

function projectionMapping(phase) {
  const inProgress = { column: 'In Progress', status: 'in_progress', complete: false };
  return {
    claimed: inProgress,
    implementing: inProgress,
    feature_pr: inProgress,
    feature_merged: inProgress,
    release_pr: inProgress,
    release_merged: inProgress,
    tagged: inProgress,
    tap_pr: inProgress,
    tap_merged: inProgress,
    brew_installed: inProgress,
    deploying: inProgress,
    parked: { column: 'In Progress', status: 'parked', complete: false },
    blocked: { column: 'Blocked', status: 'blocked', complete: false },
    'needs-inspection': { column: 'Blocked', status: 'blocked', complete: false },
    deployed: { column: 'Completed', status: 'completed', complete: true },
  }[phase] || null;
}

function effectiveProjectionMapping(record, raw = '') {
  const mapping = record && projectionMapping(record.phase);
  const canonicalSlice = scalarField(raw, 'type') === 'slice'
    && Boolean(normalizeCardLink(scalarField(raw, 'epic')));
  if (mapping && canonicalSlice && mapping.status === 'completed'
    && !successfulDeploymentReceipts(record)) {
    return projectionMapping('implementing');
  }
  return mapping;
}

function projectedRecordMapping(record, cardsRoot = CARDS_ROOT) {
  const mapping = record && projectionMapping(record.phase);
  if (!mapping || mapping.status !== 'completed' || successfulDeploymentReceipts(record)) return mapping;
  try {
    const raw = fs.readFileSync(resolveCardPath(record.card_path, record.card, cardsRoot), 'utf8');
    return effectiveProjectionMapping(record, raw);
  } catch (_) {
    return mapping;
  }
}

function boardCardLocation(md, card) {
  const escaped = card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let section = null;
  const lines = String(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (h) section = h[1];
    const match = lines[i].match(new RegExp(`^\\s*- \\[([ xX])\\] \\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]`));
    if (match) return { column: section, checked: /x/i.test(match[1]), line: i };
  }
  return null;
}

function moveBoardCard(md, card, target, complete = false) {
  const lines = String(md).split('\n');
  const escaped = card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const locations = [];
  let section = null;
  lines.forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) section = heading[1];
    const match = line.match(new RegExp(`^\\s*- \\[([ xX])\\] \\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]`));
    if (match) locations.push({
      column: section,
      checked: /x/i.test(match[1]),
      line: index,
    });
  });
  if (!locations.length) throw new Error(`card ${card} not found on board`);
  const inTarget = locations.find((location) => location.column === target);
  if (inTarget) {
    const duplicateLines = new Set(locations.map((location) => location.line));
    const targetIndex = lines
      .slice(0, inTarget.line)
      .filter((_line, index) => !duplicateLines.has(index))
      .length;
    const retained = lines.filter((_line, index) => index === inTarget.line || !duplicateLines.has(index));
    retained[targetIndex] = retained[targetIndex]
      .replace(/^\s*- \[[ xX]\]/, `- [${complete ? 'x' : ' '}]`);
    return retained.join('\n');
  }
  const retainedLine = lines[locations[0].line]
    .replace(/^\s*- \[[ xX]\]/, `- [${complete ? 'x' : ' '}]`);
  const duplicateLines = new Set(locations.map((location) => location.line));
  const retained = lines.filter((_line, index) => !duplicateLines.has(index));
  const header = retained.findIndex((line) => line.trim() === `## ${target}`);
  if (header < 0) throw new Error(`board column ${target} missing`);
  retained.splice(header + 1, 0, '', retainedLine);
  return retained.join('\n');
}

function removeBoardCard(md, card) {
  const location = boardCardLocation(md, card);
  // Absence is already-removed: the discard caller treats this as idempotent.
  if (!location) return String(md);
  const lines = String(md).split('\n');
  lines.splice(location.line, 1);
  return lines.join('\n');
}

function atomicWriteText(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
}

function canonicalWorkspacePath(value, expected) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  const parts = raw.split('/');
  return Boolean(raw) && !raw.startsWith('/') && !/^[A-Za-z]:\//.test(raw)
    && !parts.some((part) => !part || part === '.' || part === '..')
    && raw === expected;
}

function physicalProjectPrefix(cardsRoot) {
  const projectRoot = path.dirname(fs.realpathSync(cardsRoot)).replace(/\\/g, '/');
  const marker = '/spice/projects/';
  const markerAt = projectRoot.lastIndexOf(marker);
  if (markerAt < 0) throw new Error('canonical cards root is outside spice/projects');
  const relative = projectRoot.slice(markerAt + 1);
  if (!/^spice\/projects\/[^/]+$/.test(relative)) {
    throw new Error('canonical cards root is not one project directly under spice/projects');
  }
  return { prefix: relative, root: projectRoot };
}

function physicalDescendant(root, target, label) {
  const physicalRoot = fs.realpathSync(root);
  const physicalTarget = fs.realpathSync(target);
  if (physicalTarget === physicalRoot || !physicalTarget.startsWith(`${physicalRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its physical root`);
  }
  return physicalTarget;
}

function validatePhysicalProjectionMembers(entries) {
  const paths = new Map();
  const files = new Map();
  for (const { root, target, label } of entries) {
    const entry = fs.lstatSync(target);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`${label} must be one regular non-symlink file`);
    }
    const physicalPath = physicalDescendant(root, target, label);
    const priorPath = paths.get(physicalPath);
    if (priorPath) throw new Error(`${label} physically aliases ${priorPath}`);
    paths.set(physicalPath, label);
    const stat = fs.statSync(physicalPath);
    const physicalFile = `${stat.dev}:${stat.ino}`;
    const priorFile = files.get(physicalFile);
    if (priorFile) throw new Error(`${label} shares physical file identity with ${priorFile}`);
    files.set(physicalFile, label);
  }
}

function validateCanonicalSliceTopology(cardRaw, cardPath, epic, boardPath, expectedAtlasPath, expectedBoardPath) {
  if (scalarField(cardRaw, 'type') !== 'slice') {
    throw new Error(`canonical epic member ${path.basename(cardPath)} is not type slice`);
  }
  if (normalizeCardLink(scalarField(cardRaw, 'epic')) !== epic) {
    throw new Error(`canonical epic member ${path.basename(cardPath)} has a mismatched epic backlink`);
  }
  const boardDir = path.dirname(boardPath);
  if (path.dirname(path.resolve(cardPath)) !== path.resolve(boardDir)) {
    throw new Error(`canonical slice ${path.basename(cardPath)} must live flat beside its epic board`);
  }
  const taskParent = scalarField(cardRaw, 'task_parent');
  const sourceBoard = scalarField(cardRaw, 'source_board');
  const kanbanBoard = scalarField(cardRaw, 'kanban_board');
  if (!canonicalWorkspacePath(taskParent, expectedAtlasPath)) {
    throw new Error(`canonical slice ${path.basename(cardPath)} has a mismatched task_parent`);
  }
  if (sourceBoard !== kanbanBoard || !canonicalWorkspacePath(sourceBoard, expectedBoardPath)) {
    throw new Error(`canonical slice ${path.basename(cardPath)} has a shallow or mismatched source board`);
  }
}

function canonicalEpicMembers(boardRaw, boardDir, epic, boardPath, expectedAtlasPath, expectedBoardPath, physicalBoardDir = null) {
  const parsed = parseBoard(boardRaw);
  const members = ['In Planning', 'In Progress', 'Blocked', 'Completed']
    .flatMap((column) => parsed[column] || []);
  const duplicate = members.find((name, index) => members.indexOf(name) !== index);
  if (duplicate) throw new Error(`canonical epic ${epic} contains duplicate board membership for ${duplicate}`);
  const physicalPaths = new Map();
  const physicalFiles = new Map();
  for (const name of members) {
    const slicePath = path.join(boardDir, `${name}.md`);
    if (!fs.existsSync(slicePath)) throw new Error(`epic slice ${name} note is missing`);
    const entry = fs.lstatSync(slicePath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`canonical epic slice ${name} must be one regular non-symlink file`);
    }
    if (physicalBoardDir) {
      const physicalPath = physicalDescendant(physicalBoardDir, slicePath, `epic slice ${name}`);
      const priorPath = physicalPaths.get(physicalPath);
      if (priorPath) throw new Error(`epic slice ${name} physically aliases sibling ${priorPath}`);
      physicalPaths.set(physicalPath, name);
      const stat = fs.statSync(physicalPath);
      const physicalFile = `${stat.dev}:${stat.ino}`;
      const priorFile = physicalFiles.get(physicalFile);
      if (priorFile) throw new Error(`epic slice ${name} shares physical file identity with sibling ${priorFile}`);
      physicalFiles.set(physicalFile, name);
    }
    validateCanonicalSliceTopology(
      fs.readFileSync(slicePath, 'utf8'),
      slicePath,
      epic,
      boardPath,
      expectedAtlasPath,
      expectedBoardPath,
    );
  }
  return members;
}

function canonicalEpicProjection(cardRaw, cardPath, parentBoardPath, cardsRoot, opts = {}) {
  if (scalarField(cardRaw, 'type') !== 'slice') return null;
  const epic = normalizeCardLink(scalarField(cardRaw, 'epic'));
  if (!epic) throw new Error('canonical slice is missing its epic backlink');
  const currentCard = normalizeCardLink(opts.currentCard);
  if (currentCard && path.basename(cardPath, '.md') !== currentCard) {
    throw new Error(`canonical slice path ${path.basename(cardPath)} does not bind exact card ${currentCard}`);
  }
  const root = fs.realpathSync(cardsRoot);
  const epicRoot = path.resolve(cardsRoot, epic);
  if (epicRoot === path.resolve(cardsRoot) || !epicRoot.startsWith(`${path.resolve(cardsRoot)}${path.sep}`)) {
    throw new Error(`epic ${epic} escapes cards root`);
  }
  const atlasPath = path.join(epicRoot, `${epic}.md`);
  const boardDir = path.join(epicRoot, 'board');
  const runsDir = path.join(epicRoot, 'context', 'runs');
  if (!fs.existsSync(atlasPath) || !fs.existsSync(boardDir) || !fs.existsSync(runsDir)) {
    throw new Error(`canonical epic ${epic} is missing its atlas or board directory`);
  }
  const physicalEpicRoot = physicalDescendant(root, epicRoot, `epic ${epic}`);
  const physicalBoardDir = physicalDescendant(physicalEpicRoot, boardDir, `epic ${epic} board directory`);
  physicalDescendant(physicalEpicRoot, runsDir, `epic ${epic} context runs directory`);
  physicalDescendant(physicalEpicRoot, atlasPath, `epic ${epic} atlas`);
  const atlasRaw = fs.readFileSync(atlasPath, 'utf8');
  if (scalarField(atlasRaw, 'type') !== 'epic') throw new Error(`epic atlas ${epic} has invalid type`);
  const epicBoardPath = path.join(boardDir, `${epic}-board.md`);
  if (!fs.existsSync(epicBoardPath)
    || scalarField(fs.readFileSync(epicBoardPath, 'utf8'), 'board_role') !== 'epic') {
    throw new Error(`canonical epic ${epic} is missing its exact named epic board`);
  }
  physicalDescendant(physicalBoardDir, epicBoardPath, `epic ${epic} board`);
  const parentSourceBoard = scalarField(atlasRaw, 'source_board');
  const parentKanbanBoard = scalarField(atlasRaw, 'kanban_board');
  const physicalProject = physicalProjectPrefix(cardsRoot);
  const projectPrefix = physicalProject.prefix;
  const expectedParentBoardPath = path.posix.join(projectPrefix, path.basename(parentBoardPath));
  if (parentSourceBoard !== parentKanbanBoard
    || !canonicalWorkspacePath(parentSourceBoard, expectedParentBoardPath)
    || path.dirname(fs.realpathSync(parentBoardPath)).replace(/\\/g, '/') !== physicalProject.root) {
    throw new Error(`epic atlas ${epic} does not bind its canonical parent board`);
  }
  const expectedAtlasPath = path.posix.join(projectPrefix, 'tasks', epic, `${epic}.md`);
  const expectedBoardPath = path.posix.join(projectPrefix, 'tasks', epic, 'board', `${epic}-board.md`);
  const backlink = scalarField(atlasRaw, 'epic_board');
  if (!canonicalWorkspacePath(backlink, expectedBoardPath)) {
    throw new Error(`epic atlas ${epic} does not bind its canonical board`);
  }
  validateCanonicalSliceTopology(cardRaw, cardPath, epic, epicBoardPath, expectedAtlasPath, expectedBoardPath);
  const boardRaw = fs.readFileSync(epicBoardPath, 'utf8');
  const members = canonicalEpicMembers(
    boardRaw,
    boardDir,
    epic,
    epicBoardPath,
    expectedAtlasPath,
    expectedBoardPath,
    physicalBoardDir,
  );
  validatePhysicalProjectionMembers([
    { root: physicalProject.root, target: parentBoardPath, label: `epic ${epic} parent board` },
    { root, target: atlasPath, label: `epic ${epic} atlas` },
    { root, target: epicBoardPath, label: `epic ${epic} board` },
    ...members.map((name) => ({
      root,
      target: path.join(boardDir, `${name}.md`),
      label: `epic slice ${name}`,
    })),
  ]);
  if (!members.includes(path.basename(cardPath, '.md'))) {
    throw new Error(`canonical slice ${path.basename(cardPath)} is missing from its epic board`);
  }
  const parentRaw = fs.readFileSync(parentBoardPath, 'utf8');
  if (!boardCardLocation(parentRaw, epic)) throw new Error(`epic ${epic} is missing from its parent board`);
  return {
    epic, atlasPath, atlasRaw, boardPath: epicBoardPath,
    boardRaw, parentRaw, members, expectedAtlasPath, expectedBoardPath,
    cardsRoot: root, physicalBoardDir, state: opts.state || { cards: {} },
  };
}

function epicProjectionMapping(state) {
  return {
    planned: { column: 'In Planning', complete: false },
    active: { column: 'In Progress', complete: false },
    blocked: { column: 'Blocked', complete: false },
    done: { column: 'Completed', complete: true },
  }[state];
}

function legacyCompletionFinding(surface, card, record = null) {
  return {
    card,
    epic: surface.epic,
    phase: record ? record.phase || null : null,
    issue: 'legacy completion lacks successful deployment receipts and is not counted done',
    reconcile: reconcileRoute(card),
  };
}

function deriveEpicProjection(surface, currentCard, currentStatus) {
  const cards = canonicalEpicMembers(
    surface.boardRaw,
    path.dirname(surface.boardPath),
    surface.epic,
    surface.boardPath,
    surface.expectedAtlasPath,
    surface.expectedBoardPath,
    surface.physicalBoardDir,
  );
  const siblings = new Set(cards.map(normalizeCardLink));
  const findings = [];
  const slices = cards.map((name) => {
    const tracked = surface.state.cards && surface.state.cards[name];
    const trackedMapping = tracked && projectionMapping(tracked.phase);
    const slicePath = path.join(path.dirname(surface.boardPath), `${name}.md`);
    if (!fs.existsSync(slicePath)) throw new Error(`epic slice ${name} note is missing`);
    const sliceRaw = fs.readFileSync(slicePath, 'utf8');
    const dependencies = tracked && Array.isArray(tracked.dependencies)
      ? tracked.dependencies.map(normalizeCardLink) : parseDependsOn(sliceRaw).map(normalizeCardLink);
    const decorate = (status) => ({
      card: name,
      status,
      cross_epic_dependency: dependencies.some((dependency) => !siblings.has(dependency)),
    });
    if (name === currentCard) {
      if (currentStatus === 'completed' && !successfulDeploymentReceipts(tracked)) {
        findings.push(legacyCompletionFinding(surface, name, tracked));
        return decorate('in_progress');
      }
      return decorate(currentStatus);
    }
    if (trackedMapping) {
      if (trackedMapping.status === 'completed' && !successfulDeploymentReceipts(tracked)) {
        findings.push(legacyCompletionFinding(surface, name, tracked));
        return decorate('in_progress');
      }
      return decorate(trackedMapping.status);
    }
    const status = scalarField(sliceRaw, 'status') || 'planning';
    if (delivery.normalizeStatus(status) === 'completed') {
      findings.push(legacyCompletionFinding(surface, name));
      return decorate('in_progress');
    }
    return decorate(status);
  });
  return { ...delivery.deriveEpicLifecycle(slices), findings };
}

function noteProjectionMapping(raw, record = null) {
  const tracked = record && projectionMapping(record.phase);
  if (tracked) {
    if (tracked.status === 'completed' && !successfulDeploymentReceipts(record)) {
      return projectionMapping('implementing');
    }
    return tracked;
  }
  const status = delivery.normalizeStatus(scalarField(raw, 'status')) || 'planning';
  if (status === 'completed' && scalarField(raw, 'type') === 'slice') {
    return projectionMapping('implementing');
  }
  return {
    planning: { column: 'In Planning', complete: false, status: 'planning' },
    in_progress: { column: 'In Progress', complete: false, status: 'in_progress' },
    parked: { column: 'In Progress', complete: false, status: 'parked' },
    blocked: { column: 'Blocked', complete: false, status: 'blocked' },
    completed: { column: 'Completed', complete: true, status: 'completed' },
  }[status];
}

function auditReconcileFinding(
  finding,
  card,
  backupPaths = [],
  repairable = false,
  routeable = true,
) {
  const exactCard = normalizeCardLink(card);
  return {
    ...finding,
    owner: routeable && exactCard ? 'coordinator' : 'semantic',
    ...(exactCard ? { card: exactCard } : {}),
    ...(routeable && exactCard ? { reconcile: reconcileRoute(exactCard) } : {}),
    repairable: Boolean(repairable && routeable && exactCard),
    backup_paths: routeable
      ? [...new Set(backupPaths.filter(Boolean).map((target) => path.resolve(target)))]
      : [],
  };
}

function epicProjectionMutationPaths(parentBoardPath, atlasPath, boardPath, card) {
  const exactCard = normalizeCardLink(card);
  return [
    parentBoardPath,
    atlasPath,
    boardPath,
    exactCard ? path.join(path.dirname(boardPath), `${exactCard}.md`) : null,
  ];
}

function auditEpicProject({
  parentBoardPath = BOARD,
  cardsRoot = CARDS_ROOT,
  state = { cards: {} },
} = {}) {
  const parentRaw = fs.readFileSync(parentBoardPath, 'utf8');
  const columns = ['In Planning', 'In Progress', 'Blocked', 'Completed'];
  const resolved = resolveEpicBoardSet({
    parentBoardMd: parentRaw,
    cardsRoot,
    columns,
  });
  const findings = [];
  const parentNames = new Set(columns.flatMap((column) => parseBoard(parentRaw)[column] || []));
  const resolvedNames = new Set(resolved.epics.map((entry) => entry.epic));
  const flatNames = new Set(resolved.flat.map((entry) => entry.card));
  const resolverBlockedEpics = new Set(resolved.findings
    .filter((finding) => finding.code !== 'duplicate-parent-membership')
    .map((finding) => finding.epic));

  const boardMembers = (boardPath) => {
    try {
      const parsed = parseBoard(fs.readFileSync(boardPath, 'utf8'));
      return columns.flatMap((column) => parsed[column] || []);
    } catch (_) {
      return [];
    }
  };
  const canonicalTrackedRouteCard = (card, boardPath) => {
    const exactCard = normalizeCardLink(card);
    const record = exactCard && state.cards && state.cards[exactCard];
    if (!record
      || normalizeCardLink(record.card) !== exactCard
      || !projectionMapping(record.phase)
      || typeof record.card_path !== 'string'
      || !record.card_path.trim()) return null;
    const expectedPath = path.resolve(path.dirname(boardPath), `${exactCard}.md`);
    const recordedPath = path.resolve(record.card_path);
    if (recordedPath !== expectedPath) return null;
    try {
      const cardsPhysicalRoot = fs.realpathSync(cardsRoot);
      const recordedEntry = fs.lstatSync(recordedPath);
      const expectedEntry = fs.lstatSync(expectedPath);
      if (recordedEntry.isSymbolicLink()
        || expectedEntry.isSymbolicLink()
        || !recordedEntry.isFile()
        || !expectedEntry.isFile()) return null;
      const recordedPhysical = physicalDescendant(
        cardsPhysicalRoot,
        recordedPath,
        `ledger card_path for ${exactCard}`,
      );
      const expectedPhysical = physicalDescendant(
        cardsPhysicalRoot,
        expectedPath,
        `canonical epic member ${exactCard}`,
      );
      const recordedStat = fs.statSync(recordedPhysical);
      const expectedStat = fs.statSync(expectedPhysical);
      if (recordedPhysical !== expectedPhysical
        || recordedStat.dev !== expectedStat.dev
        || recordedStat.ino !== expectedStat.ino) return null;
    } catch (_) {
      return null;
    }
    return exactCard;
  };
  const trackedRouteCardForEpic = (epic, boardPath = null) => {
    const candidate = boardPath || path.join(cardsRoot, epic, 'board', `${epic}-board.md`);
    return boardMembers(candidate)
      .map((card) => canonicalTrackedRouteCard(card, candidate))
      .find(Boolean) || null;
  };

  for (const finding of resolved.findings) {
    const boardPath = finding.board_path || path.join(cardsRoot, finding.epic, 'board', `${finding.epic}-board.md`);
    const routeCard = trackedRouteCardForEpic(finding.epic, boardPath);
    const surfaceCard = boardMembers(boardPath)[0] || null;
    const repairable = finding.code === 'duplicate-parent-membership'
      && Boolean(routeCard)
      && !resolverBlockedEpics.has(finding.epic);
    findings.push(auditReconcileFinding({
      code: `resolver-${finding.code}`,
      epic: finding.epic,
      issue: `epic resolver finding: ${finding.code}`,
      detail: finding.detail || null,
    }, routeCard || surfaceCard, epicProjectionMutationPaths(
      parentBoardPath,
      path.join(cardsRoot, finding.epic, `${finding.epic}.md`),
      boardPath,
      routeCard || surfaceCard,
    ), repairable, repairable));
  }

  for (const entry of fs.readdirSync(cardsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const epic = entry.name;
    const boardDir = path.join(cardsRoot, epic, 'board');
    if (!fs.existsSync(boardDir)) continue;
    let epicBoards = [];
    try {
      epicBoards = fs.readdirSync(boardDir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => path.join(boardDir, name))
        .filter((boardPath) => scalarField(fs.readFileSync(boardPath, 'utf8'), 'board_role') === 'epic');
    } catch (_) {
      continue;
    }
    if (epicBoards.length && !parentNames.has(epic) && !resolvedNames.has(epic) && !flatNames.has(epic)) {
      findings.push({
        code: 'orphan-epic-directory',
        epic,
        issue: 'conformant epic directory is absent from the parent board',
        owner: 'semantic',
        repairable: false,
        backup_paths: [],
      });
    }
  }

  let sliceCount = 0;
  for (const epic of resolved.epics) {
    const members = boardMembers(epic.board_path);
    sliceCount += members.length;
    const surfaceCard = members[0] || null;
    if (!surfaceCard) {
      const atlasRaw = fs.readFileSync(epic.atlas_path, 'utf8');
      const lifecycle = delivery.deriveEpicLifecycle([]);
      const expected = epicProjectionMapping(lifecycle.state);
      const actual = boardCardLocation(parentRaw, epic.epic);
      if (!actual || actual.column !== expected.column || actual.checked !== expected.complete
        || scalarField(atlasRaw, 'status') !== lifecycle.state
        || scalarField(atlasRaw, 'posture') !== lifecycle.posture) {
        findings.push({
          code: 'empty-epic-rollup-drift',
          epic: epic.epic,
          issue: 'empty epic surface differs from canonical Delivery derivation',
          owner: 'semantic',
          repairable: false,
          backup_paths: [],
        });
      }
      continue;
    }
    const routeCard = members
      .map((card) => canonicalTrackedRouteCard(card, epic.board_path))
      .find(Boolean) || null;
    const surfacePath = path.join(path.dirname(epic.board_path), `${surfaceCard}.md`);
    let surface;
    try {
      surface = canonicalEpicProjection(
        fs.readFileSync(surfacePath, 'utf8'),
        surfacePath,
        parentBoardPath,
        cardsRoot,
        { state },
      );
    } catch (err) {
      findings.push(auditReconcileFinding({
        code: 'epic-referential-invalid',
        epic: epic.epic,
        issue: `canonical epic topology is invalid: ${err.message}`,
      }, routeCard || surfaceCard, epicProjectionMutationPaths(
        parentBoardPath,
        epic.atlas_path,
        epic.board_path,
        routeCard || surfaceCard,
      ), false, false));
      continue;
    }

    const lifecycle = deriveEpicProjection(surface, null, null);
    for (const finding of lifecycle.findings) {
      findings.push(auditReconcileFinding({
        code: 'legacy-completion-no-receipt',
        epic: surface.epic,
        phase: finding.phase,
        issue: finding.issue,
      }, finding.card, epicProjectionMutationPaths(
        parentBoardPath,
        surface.atlasPath,
        surface.boardPath,
        finding.card,
      )));
    }

    for (const member of surface.members) {
      const memberPath = path.join(path.dirname(surface.boardPath), `${member}.md`);
      const memberRaw = fs.readFileSync(memberPath, 'utf8');
      const mapping = noteProjectionMapping(memberRaw, state.cards && state.cards[member]);
      const location = boardCardLocation(surface.boardRaw, member);
      if (!location || location.column !== mapping.column || location.checked !== mapping.complete) {
        const routeable = Boolean(canonicalTrackedRouteCard(member, surface.boardPath));
        findings.push(auditReconcileFinding({
          code: 'slice-projection-drift',
          epic: surface.epic,
          issue: 'slice board position differs from authoritative lifecycle projection',
          expected_column: mapping.column,
          actual_column: location ? location.column : null,
          expected_checked: mapping.complete,
          actual_checked: location ? location.checked : null,
        }, member, epicProjectionMutationPaths(
          parentBoardPath,
          surface.atlasPath,
          surface.boardPath,
          member,
        ), routeable, routeable));
      }
    }

    const expectedEpic = epicProjectionMapping(lifecycle.state);
    const epicLocation = boardCardLocation(surface.parentRaw, surface.epic);
    const actualStatus = scalarField(surface.atlasRaw, 'status');
    const actualPosture = scalarField(surface.atlasRaw, 'posture');
    if (!epicLocation
      || epicLocation.column !== expectedEpic.column
      || epicLocation.checked !== expectedEpic.complete
      || actualStatus !== lifecycle.state
      || actualPosture !== lifecycle.posture) {
      findings.push(auditReconcileFinding({
        code: 'epic-rollup-drift',
        epic: surface.epic,
        issue: 'epic column and atlas projection differ from authoritative slice roll-up',
        expected_column: expectedEpic.column,
        actual_column: epicLocation ? epicLocation.column : null,
        expected_checked: expectedEpic.complete,
        actual_checked: epicLocation ? epicLocation.checked : null,
        expected_status: lifecycle.state,
        actual_status: actualStatus || null,
        expected_posture: lifecycle.posture,
        actual_posture: actualPosture || null,
      }, routeCard || surfaceCard, epicProjectionMutationPaths(
        parentBoardPath,
        surface.atlasPath,
        surface.boardPath,
        routeCard || surfaceCard,
      ), Boolean(routeCard), Boolean(routeCard)));
    }
  }

  const finalRepairBlockedEpics = new Set(findings
    .filter((finding) => finding.code === 'epic-referential-invalid'
      || (finding.code.startsWith('resolver-')
        && finding.code !== 'resolver-duplicate-parent-membership'))
    .map((finding) => finding.epic));
  for (const finding of findings) {
    if (finding.code !== 'resolver-duplicate-parent-membership'
      || !finalRepairBlockedEpics.has(finding.epic)) continue;
    finding.owner = 'semantic';
    finding.repairable = false;
    finding.backup_paths = [];
    delete finding.reconcile;
  }

  findings.sort((a, b) => [
    a.epic || '', a.card || '', a.code || '',
  ].join('\0').localeCompare([
    b.epic || '', b.card || '', b.code || '',
  ].join('\0')));
  return {
    clean: findings.length === 0,
    epic_count: resolved.epics.length,
    slice_count: sliceCount,
    findings,
  };
}

function durablePathBarrier(file, deps = {}) {
  const open = deps.openSync || fs.openSync;
  const sync = deps.fsyncSync || fs.fsyncSync;
  const close = deps.closeSync || fs.closeSync;
  const flush = (target) => {
    let fd;
    try {
      fd = open(target, 'r');
      sync(fd);
    } finally {
      if (fd !== undefined) close(fd);
    }
  };
  flush(file);
  flush(path.dirname(file));
}

function projectCard(cardPath, boardPath, card, phase, opts = {}) {
  const mapping = projectionMapping(phase);
  if (!mapping) return { changed: false, skipped: true };
  const resolvedCardPath = resolveCardPath(cardPath, card, opts.cardsRoot || CARDS_ROOT);
  const cardRaw = fs.readFileSync(resolvedCardPath, 'utf8');
  const epicSurface = canonicalEpicProjection(cardRaw, resolvedCardPath, boardPath, opts.cardsRoot || CARDS_ROOT, {
    ...opts,
    currentCard: card,
  });
  const record = opts.record || null;
  const surfaceMapping = epicSurface ? effectiveProjectionMapping(record, cardRaw) : mapping;
  const sliceBoardPath = epicSurface ? epicSurface.boardPath : boardPath;
  const boardRaw = epicSurface ? epicSurface.boardRaw : fs.readFileSync(boardPath, 'utf8');
  const boardNext = moveBoardCard(boardRaw, card, surfaceMapping.column, surfaceMapping.complete);
  const ownsParkMetadata = Boolean(record && Object.prototype.hasOwnProperty.call(record, 'resume_condition'));
  const expectedDependencies = ownsParkMetadata ? (record.dependencies || []).map(normalizeCardLink) : null;
  const currentDependencies = ownsParkMetadata ? parseDependsOn(cardRaw).map(normalizeCardLink) : null;
  const hasResumeCondition = /^resume_condition:/m.test(frontmatter(cardRaw));
  const expectedResumeCondition = ownsParkMetadata && record.resume_condition != null
    ? String(record.resume_condition).trim() : null;
  const lifecycleMetadataChanged = scalarField(cardRaw, 'kanban_column') !== surfaceMapping.column
    || parseCardStatus(cardRaw) !== surfaceMapping.status
    || (ownsParkMetadata && JSON.stringify(currentDependencies) !== JSON.stringify(expectedDependencies))
    || (ownsParkMetadata && (expectedResumeCondition == null
      ? hasResumeCondition : scalarField(cardRaw, 'resume_condition') !== expectedResumeCondition));
  const ownsContract = ownsAmendedContract(record);
  const expectedTouchZones = ownsContract ? normalizeStoredTouchZones(record.touch_zones) : null;
  const expectedDeployments = ownsContract
    ? normalizeDeploymentMap(record.deploy_subscriptions, { label: 'tracked contract deployment map', requireTyped: true })
    : null;
  const ownsBatchPolicy = ownsAmendedBatchPolicy(record);
  const expectedBatchPolicy = ownsBatchPolicy ? record.batch_policy : null;
  const currentTouchZones = ownsContract ? listField(cardRaw, 'touch_zones').map(normalizeZone) : null;
  const currentDeployments = ownsContract ? deploymentField(cardRaw) : null;
  const contractMetadataChanged = ownsContract && (
    JSON.stringify(currentTouchZones) !== JSON.stringify(expectedTouchZones)
    || !currentDeployments
    || !sameDeploymentMap(
      normalizeDeploymentMap(currentDeployments, { label: 'projected deployment map' }),
      expectedDeployments,
    )
    || (ownsBatchPolicy && parseBatchPolicy(cardRaw) !== expectedBatchPolicy)
  );
  const boardChanged = boardNext !== boardRaw;
  const metadataFields = {};
  if (lifecycleMetadataChanged) {
    metadataFields.kanban_column = surfaceMapping.column;
    metadataFields.status = surfaceMapping.status;
    metadataFields.status_changed_at = (opts.now || (() => new Date().toISOString()))();
  }
  if (ownsParkMetadata) {
    metadataFields.depends_on = JSON.stringify(expectedDependencies.map((dep) => `[[${dep}]]`));
    metadataFields.resume_condition = expectedResumeCondition == null ? null : JSON.stringify(expectedResumeCondition);
  }
  let cardNext = lifecycleMetadataChanged
    ? patchFrontmatter(cardRaw, metadataFields)
    : cardRaw;
  if (contractMetadataChanged) {
    cardNext = patchFrontmatterBlocks(cardNext, formatExecutionContractFrontmatter(expectedTouchZones, expectedDeployments));
    if (ownsBatchPolicy) cardNext = patchFrontmatter(cardNext, { batch_policy: expectedBatchPolicy });
  }
  if ((lifecycleMetadataChanged || contractMetadataChanged) && cardNext === cardRaw && !frontmatter(cardRaw)) {
    throw new Error(`card ${card} frontmatter missing`);
  }
  let epicBoardChanged = false;
  let epicAtlasChanged = false;
  let epicState = null;
  let projectionFindings = [];
  let parentNext = null;
  let atlasNext = null;
  if (epicSurface) {
    epicSurface.boardRaw = boardNext;
    const lifecycle = deriveEpicProjection(epicSurface, card, mapping.status);
    const epicMapping = epicProjectionMapping(lifecycle.state);
    if (!epicMapping) throw new Error(`unsupported derived epic state ${lifecycle.state}`);
    parentNext = moveBoardCard(epicSurface.parentRaw, epicSurface.epic, epicMapping.column, epicMapping.complete);
    atlasNext = patchFrontmatter(epicSurface.atlasRaw, {
      status: lifecycle.state,
      posture: lifecycle.posture,
    });
    epicBoardChanged = parentNext !== epicSurface.parentRaw;
    epicAtlasChanged = atlasNext !== epicSurface.atlasRaw;
    epicState = lifecycle.state;
    projectionFindings = lifecycle.findings;
  }
  const writeText = opts.writeText || atomicWriteText;
  if (boardChanged) writeText(sliceBoardPath, boardNext);
  if (cardNext !== cardRaw) writeText(resolvedCardPath, cardNext);
  if (epicBoardChanged) writeText(boardPath, parentNext);
  if (epicAtlasChanged) writeText(epicSurface.atlasPath, atlasNext);
  const result = {
    changed: boardChanged || cardNext !== cardRaw || epicBoardChanged || epicAtlasChanged,
    board_changed: boardChanged,
    card_changed: cardNext !== cardRaw,
  };
  if (epicSurface) Object.assign(result, {
    epic_board_changed: epicBoardChanged,
    epic_atlas_changed: epicAtlasChanged,
    epic_state: epicState,
    projection_findings: projectionFindings,
  });
  return result;
}

async function attemptProjection(ctx, record, boardPath = BOARD, opts = {}) {
  const project = opts.projectCard || projectCard;
  const now = opts.now || (() => new Date().toISOString());
  const projectionLock = opts.withLock || withLock;
  try {
    return await projectionLock(ctx, 'completion-projection', async () => {
      const state = opts.state || { cards: {} };
      state.cards ||= {};
      state.cards[record.card] = record;
      const result = project(record.card_path, boardPath, record.card, record.phase, {
        now, record, state, cardsRoot: opts.cardsRoot,
      });
      delete record.projection_error;
      delete record.projection_failed_at;
      record.projection_reconciled_at = now();
      return { ok: true, ...result };
    }, { card: record.card });
  } catch (err) {
    record.projection_error = err.message;
    record.projection_failed_at = now();
    return { ok: false, changed: false, error: err.message };
  }
}

function projectionBoardDrift(boardMd, record, opts = {}) {
  const mapping = projectionMapping(record.phase);
  if (!mapping) return null;
  let projectedBoard = boardMd;
  let epicSurface = null;
  let epic = null;
  let cardRaw = '';
  try {
    const cardPath = resolveCardPath(record.card_path, record.card, opts.cardsRoot || CARDS_ROOT);
    if (cardPath && fs.existsSync(cardPath)) {
      cardRaw = fs.readFileSync(cardPath, 'utf8');
      epic = normalizeCardLink(scalarField(cardRaw, 'epic')) || null;
      epicSurface = canonicalEpicProjection(cardRaw, cardPath, opts.boardPath || BOARD, opts.cardsRoot || CARDS_ROOT, {
        state: opts.state,
        currentCard: record.card,
      });
      if (epicSurface) projectedBoard = epicSurface.boardRaw;
    }
  } catch (err) {
    return {
      card: record.card,
      epic,
      phase: record.phase,
      issue: `canonical epic projection is unreadable: ${err.message}`,
      reconcile: reconcileRoute(record.card),
    };
  }
  const surfaceMapping = epicSurface ? effectiveProjectionMapping(record, cardRaw) : mapping;
  const location = boardCardLocation(projectedBoard, record.card);
  if (!location) return { card: record.card, phase: record.phase, issue: 'card is missing from board' };
  if (location.column !== surfaceMapping.column || location.checked !== surfaceMapping.complete) {
    return {
      card: record.card, phase: record.phase,
      expected_column: surfaceMapping.column, actual_column: location.column,
      expected_checked: surfaceMapping.complete, actual_checked: location.checked,
    };
  }
  if (epicSurface) {
    try {
      const lifecycle = deriveEpicProjection(epicSurface, record.card, mapping.status);
      const epicMapping = epicProjectionMapping(lifecycle.state);
      const epicLocation = boardCardLocation(epicSurface.parentRaw, epicSurface.epic);
      const atlasStatus = scalarField(epicSurface.atlasRaw, 'status');
      const atlasPosture = scalarField(epicSurface.atlasRaw, 'posture');
      if (lifecycle.findings.length) {
        return opts.allFindings === true ? lifecycle.findings : lifecycle.findings[0];
      }
      if (!epicLocation || epicLocation.column !== epicMapping.column || epicLocation.checked !== epicMapping.complete
        || atlasStatus !== lifecycle.state || atlasPosture !== lifecycle.posture) {
        return {
          card: record.card, epic: epicSurface.epic, phase: record.phase,
          issue: 'epic surface differs from the authoritative slice roll-up',
          expected_column: epicMapping.column, actual_column: epicLocation ? epicLocation.column : null,
          expected_checked: epicMapping.complete, actual_checked: epicLocation ? epicLocation.checked : null,
          expected_status: lifecycle.state, actual_status: atlasStatus,
          expected_posture: lifecycle.posture, actual_posture: atlasPosture,
        };
      }
    } catch (err) {
      return {
        card: record.card, epic: epicSurface.epic, phase: record.phase,
        issue: `canonical epic roll-up refusal: ${err.message}`,
        reconcile: reconcileRoute(record.card),
      };
    }
  }
  return null;
}

function expectedProjectedContract(record, mapping) {
  const raw = {
    ...record.delivery_contract,
    status: mapping.status,
    depends_on: record.dependencies,
    touch_zones: record.touch_zones,
    deploy_subscriptions: record.deploy_subscriptions,
  };
  const comparison = delivery.compareVersions(raw.schema_version, delivery.CONTRACT_VERSION);
  const migrated = comparison === -1 ? delivery.migrate(raw, raw.schema_version) : { ok: true, note: raw };
  if (!migrated.ok) throw new Error(`ledger Delivery contract cannot migrate: ${migrated.reason}`);
  const validation = delivery.validateCard(migrated.note, 'historical');
  if (!validation.ok) throw new Error(`ledger Delivery contract is invalid: ${validation.errors.map((item) => item.code).join(', ')}`);
  const expected = { ...validation.card };
  // Optional evidence was absent on legitimate historical Delivery cards.
  // Validation normalizes that omission to [], but projection comparison must
  // preserve the ledger's historical shape just as prepareDeliveryCard does.
  if (!Object.prototype.hasOwnProperty.call(raw, 'evidence')) delete expected.evidence;
  return expected;
}

function projectionMetadataProblemFromRaw(record, raw, opts = {}) {
  const mapping = effectiveProjectionMapping(record, raw);
  if (!mapping || (record.projection_error && opts.ignoreSavedProjectionError !== true)) return null;
  try {
    const prepared = prepareDeliveryCard(raw, record.card);
    if (!prepared.ok && (record.delivery_contract || ['current', 'future', 'invalid'].includes(prepared.source))) {
      return {
        card: record.card, phase: record.phase,
        error: `card Delivery contract is invalid: ${validationReason(prepared)}`,
      };
    }
    // Pre-A2 tracked cards remain readable without rewriting protected
    // historical metadata; lifecycle still normalizes through Delivery.
    const actualStatus = prepared.ok ? prepared.card.status : delivery.normalizeStatus(scalarField(raw, 'status'));
    let differs = scalarField(raw, 'kanban_column') !== mapping.column || actualStatus !== mapping.status;
    if (record.delivery_contract) {
      const expectedContract = expectedProjectedContract(record, mapping);
      const actualContract = prepared.card;
      differs = differs || DELIVERY_STABLE_FIELDS.some(
        (field) => JSON.stringify(actualContract[field]) !== JSON.stringify(expectedContract[field]),
      );
    }
    if (record.phase === 'parked') {
      const dependencies = parseDependsOn(raw).map(normalizeCardLink);
      const expected = Array.isArray(record.dependencies) ? record.dependencies.map(normalizeCardLink) : [];
      const condition = typeof record.resume_condition === 'string' ? record.resume_condition.trim() : '';
      differs = differs || !expected.length || !condition
        || JSON.stringify(dependencies) !== JSON.stringify(expected)
        || scalarField(raw, 'resume_condition') !== condition;
    }
    if (ownsAmendedContract(record)) {
      const touchZones = listField(raw, 'touch_zones').map(normalizeZone);
      const deployments = deploymentField(raw);
      const expectedTouchZones = normalizeStoredTouchZones(record.touch_zones);
      const expectedDeployments = normalizeDeploymentMap(record.deploy_subscriptions, {
        label: 'tracked contract deployment map', requireTyped: true,
      });
      differs = differs
        || JSON.stringify(touchZones) !== JSON.stringify(expectedTouchZones)
        || !deployments
        || !sameDeploymentMap(normalizeDeploymentMap(deployments, { label: 'projected deployment map' }), expectedDeployments);
    }
    if (differs) {
      return {
        card: record.card, phase: record.phase,
        expected_column: mapping.column, actual_column: scalarField(raw, 'kanban_column') || null,
        expected_status: mapping.status, actual_status: actualStatus || null,
        error: 'card metadata differs from the authoritative ledger; reconcile before continuing',
      };
    }
  } catch (err) {
    return { card: record.card, phase: record.phase, error: `card metadata is unreadable: ${err.message}` };
  }
  return null;
}

function projectionMetadataProblem(record, cardsRoot = CARDS_ROOT) {
  const mapping = record && projectionMapping(record.phase);
  if (!mapping || record.projection_error) return null;
  try {
    const raw = fs.readFileSync(resolveCardPath(record.card_path, record.card, cardsRoot), 'utf8');
    return projectionMetadataProblemFromRaw(record, raw);
  } catch (err) {
    return { card: record.card, phase: record.phase, error: `card metadata is unreadable: ${err.message}` };
  }
}

function completionResult(record) {
  const result = {
    card: record.card,
    version: record.brew_version,
    receipts: record.vault_receipts,
  };
  if (record.projection_error) {
    return {
      action: 'completion-projection-failed', deployment: 'deployed', ...result,
      projection_error: record.projection_error,
      projection_failed_at: record.projection_failed_at || null,
      reconcile: `reconcile --card ${record.card}`,
    };
  }
  return {
    action: 'complete', deployment: 'deployed', ...result,
    projection_reconciled_at: record.projection_reconciled_at || null,
  };
}

function checkRollup(items) {
  const failed = []; const pending = [];
  for (const item of items || []) {
    const name = item.name || item.context || item.workflowName || 'unknown';
    const status = String(item.status || item.state || '').toUpperCase();
    const conclusion = String(item.conclusion || '').toUpperCase();
    if (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE'].includes(conclusion) || status === 'ERROR') failed.push(name);
    else if (status !== 'COMPLETED' && status !== 'SUCCESS' && conclusion !== 'SUCCESS' && conclusion !== 'NEUTRAL' && conclusion !== 'SKIPPED') pending.push(name);
  }
  return { failed, pending, green: failed.length === 0 && pending.length === 0 && (items || []).length > 0 };
}

function releaseCheckFailureNames(reason) {
  const match = String(reason || '').match(/^release PR checks failed: ([^\r\n]+)$/);
  if (!match) return null;
  const names = match[1].split(', ');
  if (!names.length || names.some((name) => !name || name.trim() !== name || name.includes(','))) return null;
  return names;
}

function ghJson(args, cwd) {
  const text = sh('gh', args, { cwd });
  return text ? JSON.parse(text) : null;
}

function prView(repo, number, cwd) {
  return ghJson(['pr', 'view', String(number), '-R', repo, '--json',
    'number,state,title,url,baseRefName,baseRefOid,headRefName,headRefOid,mergeStateStatus,mergeCommit,statusCheckRollup,autoMergeRequest'], cwd);
}

function commitContains(repo, ancestor, descendant, cwd) {
  if (!ancestor || !descendant) return false;
  try {
    const result = ghJson(['api', `repos/${repo}/compare/${ancestor}...${descendant}`], cwd);
    return result && (result.status === 'ahead' || result.status === 'identical');
  } catch (_) { return false; }
}

function releaseCandidates(cwd) {
  return ghJson(['pr', 'list', '-R', REPO, '--state', 'all', '--limit', '50', '--search', 'head:release/next', '--json',
    'number,state,title,url,headRefName,headRefOid,mergeCommit,createdAt,mergedAt'], cwd) || [];
}

function findContainingRelease(mergeSha, cwd) {
  const candidates = releaseCandidates(cwd).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return candidates.find((pr) => commitContains(REPO, mergeSha, pr.state === 'MERGED' ? pr.mergeCommit && pr.mergeCommit.oid : pr.headRefOid, cwd)) || null;
}

function versionFrom(value) {
  const match = String(value || '').match(/v?(\d+\.\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : '';
}

function isReleasableTitle(title) {
  return bumpLevel(parseCommit(title), true) !== 'none';
}

function assertReleasableTitle(title) {
  if (!isReleasableTitle(title)) {
    throw new Error(`PR title "${title}" will not trigger a release; use a releasable conventional title such as fix(scope): ... or feat(scope): ...`);
  }
}

function gateReceiptStatus(record, headSha, baseSha = null, prTitle = null) {
  const receipt = record && record.gate_receipt;
  if (!receipt) return { valid: false, reason: 'required gate receipt is missing' };
  if (receipt.head_sha !== headSha) {
    return { valid: false, reason: `gate receipt is stale (${receipt.head_sha || 'unknown'} != ${headSha})` };
  }
  if (receipt.status !== 'pass') return { valid: false, reason: `gate receipt did not pass: ${receipt.reason || 'unknown failure'}` };
  if (receipt.base_ref !== 'origin/main' || !receipt.base_sha) {
    return { valid: false, reason: 'gate receipt does not use the canonical origin/main base' };
  }
  if (baseSha && receipt.base_sha !== baseSha) {
    return { valid: false, reason: `gate receipt base is stale (${receipt.base_sha} != ${baseSha})` };
  }
  if (!receipt.prospective_pr_title || !isReleasableTitle(receipt.prospective_pr_title)) {
    return { valid: false, reason: 'gate receipt has no releasable prospective PR title' };
  }
  if (prTitle !== null && prTitle !== receipt.prospective_pr_title) {
    return {
      valid: false,
      reason: `PR title "${prTitle}" != gate-verified prospective title "${receipt.prospective_pr_title}"`,
    };
  }
  if (receipt.merge_only === true) {
    // Merge-only bindings run the repo's own verify_commands instead of the
    // sauce release preflights; verify-gates records that under verify_commands.
    if (!receipt.checks || receipt.checks.adequacy !== 'pass') {
      return { valid: false, reason: 'gate receipt is incomplete: adequacy' };
    }
    const vc = receipt.checks.verify_commands;
    if (!vc || !['pass', 'none-declared'].includes(vc.status)) {
      return { valid: false, reason: 'gate receipt is incomplete: verify_commands' };
    }
  } else {
    const required = ['adequacy', 'release_preflight', 'workshop_self_install', 'release_preflight_bumped'];
    const missing = required.filter((name) => !receipt.checks || receipt.checks[name] !== 'pass');
    if (missing.length) return { valid: false, reason: `gate receipt is incomplete: ${missing.join(', ')}` };
  }
  if (receipt.behavioral) {
    const reviews = receipt.reviews || {};
    const stale = REVIEW_LENSES.filter((lens) => !reviews[lens] || reviews[lens].head_sha !== headSha);
    if (stale.length) return { valid: false, reason: `review receipts are missing or stale: ${stale.join(', ')}` };
  }
  return { valid: true, reason: 'all required gates passed for this commit' };
}

function pathCoveredByTouchZones(file, zones) {
  const normalized = normalizeZone(file);
  const pathZones = (zones || []).map(normalizeZone)
    .filter((zone) => zone && !SYMBOLIC_TOUCH_ZONES.has(zone));
  if (!pathZones.length) return false;
  return pathZones.some((zone) => normalized === zone || normalized.startsWith(`${zone}/`));
}

function runIsolatedWorkshopSelfInstall(ctx, headSha, baseSha, prospectiveTitle, run = sh) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-autoloop-self-install-'));
  let temp = null;
  let setupComplete = false;
  let added = false;
  let failure = null;
  const appendFailure = (err) => {
    failure = failure ? new Error(`${failure.message}; ${err.message}`) : err;
  };
  try {
    temp = fs.realpathSync.native(tempRoot);
    fs.rmSync(temp, { recursive: true, force: true });
    setupComplete = true;
    run('git', ['worktree', 'add', '--detach', temp, headSha], { cwd: ctx.root, stdio: 'pipe' });
    added = true;
    const headTree = run('git', ['rev-parse', `${headSha}^{tree}`], { cwd: temp, stdio: 'pipe' });
    const syntheticSha = run('git', ['commit-tree', headTree, '-p', baseSha, '-m', prospectiveTitle], {
      cwd: temp,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Sauce Release Gate',
        GIT_AUTHOR_EMAIL: 'sauce-release-gate@example.invalid',
        GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
        GIT_COMMITTER_NAME: 'Sauce Release Gate',
        GIT_COMMITTER_EMAIL: 'sauce-release-gate@example.invalid',
        GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
      },
    });
    run('git', ['reset', '--hard', syntheticSha], { cwd: temp, stdio: 'pipe' });
    run('node', ['scripts/release/compute-release.js', '--write'], { cwd: temp, stdio: 'pipe' });
    run('node', ['platform/install.js', '--vault', '.', '--auto-approve'], { cwd: temp, stdio: 'pipe' });
  } catch (err) {
    failure = err;
  } finally {
    if (!setupComplete) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (err) {
        appendFailure(new Error(`failed to delete disposable self-install setup path ${tempRoot}: ${err.message}`));
        try {
          fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch (retryErr) {
          appendFailure(new Error(`failed target-safe retry for disposable self-install setup path ${tempRoot}: ${retryErr.message}`));
        }
      }
    } else {
      let registered = added;
      let registrationInspectionFailed = false;
      if (!registered) {
        try {
          const listed = run('git', ['worktree', 'list', '--porcelain'], { cwd: ctx.root, stdio: 'pipe' });
          registered = String(listed).split('\n').some((line) => line === `worktree ${temp}`);
        } catch (err) {
          registrationInspectionFailed = true;
          appendFailure(new Error(`could not inspect disposable worktree registration: ${err.message}`));
        }
      }
      if (registered) {
        try { run('git', ['worktree', 'remove', '--force', temp], { cwd: ctx.root, stdio: 'pipe' }); }
        catch (err) {
          appendFailure(new Error(`failed to remove disposable self-install worktree ${temp}: ${err.message}`));
          try {
            run('git', ['worktree', 'remove', '--force', '--force', temp], { cwd: ctx.root, stdio: 'pipe' });
          } catch (retryErr) {
            appendFailure(new Error(`failed target-safe retry for disposable self-install worktree ${temp}: ${retryErr.message}`));
          }
        }
      } else if (registrationInspectionFailed) {
        try {
          run('git', ['worktree', 'remove', '--force', '--force', temp], { cwd: ctx.root, stdio: 'pipe' });
        } catch (err) {
          appendFailure(new Error(`failed target-safe cleanup for uninspectable disposable worktree ${temp}: ${err.message}`));
        }
      } else {
        try { fs.rmSync(temp, { recursive: true, force: true }); }
        catch (err) {
          appendFailure(new Error(`failed to delete disposable self-install path ${temp}: ${err.message}`));
        }
      }
    }
  }
  if (failure) throw failure;
}

function armFeatureAutoMerge(pr, cwd, run = sh) {
  assertReleasableTitle(pr.title);
  run('gh', ['pr', 'merge', String(pr.number), '-R', REPO, '--squash', '--auto', '--subject', pr.title], { cwd });
}

function disableFeatureAutoMerge(pr, cwd, run = sh) {
  run('gh', ['pr', 'merge', String(pr.number), '-R', REPO, '--disable-auto'], { cwd });
}

function releasePrWaitReceipt() {
  return {
    action: 'waiting',
    phase: 'feature_merged',
    waiting_for: 'release_pr',
    reason: 'containing release PR not created yet',
  };
}

function findContainingTag(mergeSha, root) {
  try { sh('git', ['fetch', 'origin', 'main', '--tags', '--quiet'], { cwd: root }); } catch (_) {}
  const tags = sh('git', ['tag', '--list', 'v[0-9]*', '--sort=version:refname'], { cwd: root }).split('\n').filter(Boolean);
  for (const tag of tags) {
    try { sh('git', ['merge-base', '--is-ancestor', mergeSha, tag], { cwd: root }); return tag; } catch (_) {}
  }
  return '';
}

function tapPr(version, cwd) {
  const prs = ghJson(['pr', 'list', '-R', TAP_REPO, '--state', 'all', '--limit', '20', '--search', `head:bump-v${version}`, '--json',
    'number,state,title,url,headRefName,mergeCommit,createdAt,mergedAt'], cwd) || [];
  return prs.find((pr) => pr.headRefName === `bump-v${version}` || pr.title === `sauce v${version}`) || null;
}

function formulaTagFromText(raw) {
  const sauceUrl = /^\s*url\s+(["'])https:\/\/github\.com\/willfell\/sauce\/archive\/refs\/tags\/(v\d+\.\d+\.\d+(?:\.\d+)?)\.tar\.gz\1\s*(?:#.*)?$/;
  const matches = [];
  let blockComment = false;
  for (const rawLine of String(raw || '').split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!blockComment && /^=begin(?:\s|$)/.test(line)) {
      blockComment = true;
      continue;
    }
    if (blockComment) {
      if (/^=end(?:\s|$)/.test(line)) blockComment = false;
      continue;
    }
    const match = line.match(sauceUrl);
    if (match) matches.push(match[2]);
  }
  return matches.length === 1 ? matches[0] : '';
}

function currentTapFormulaTag(_cwd, read = fs.readFileSync) {
  const tapFormula = '/opt/homebrew/Library/Taps/willfell/homebrew-sauce/Formula/sauce.rb';
  const installedFormula = '/opt/homebrew/opt/sauce/.brew/sauce.rb';
  const tapTag = formulaTagFromText(read(tapFormula, 'utf8'));
  const installedTag = formulaTagFromText(read(installedFormula, 'utf8'));
  return tapTag && tapTag === installedTag ? tapTag : '';
}

function tagContainsCommit(root, tag, commit, run = sh) {
  if (!/^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(tag || '')) || !EXACT_SHA.test(String(commit || ''))) return false;
  try {
    run('git', ['fetch', 'origin', 'main', '--tags', '--quiet'], { cwd: root, stdio: 'pipe' });
    run('git', ['merge-base', '--is-ancestor', commit, tag], { cwd: root, stdio: 'pipe' });
    return true;
  } catch (_) { return false; }
}

function vaultLedgerProof(vault, requiredVersion, now = () => new Date().toISOString()) {
  const ledgerPath = path.join(vault.path, 'ranch/platform-installed.json');
  const ledger = readJson(ledgerPath);
  const installedVersion = String(ledger.workshop_version || '');
  return {
    vault: vault.id, path: vault.path, ledger_path: ledgerPath,
    ok: Boolean(installedVersion && cmpVersion(installedVersion, requiredVersion) >= 0),
    required_version: requiredVersion, installed_version: installedVersion,
    source: 'platform-installed.json', verified_at: now(),
  };
}

function hasDeploymentAdditions(record) {
  return CONTRACT_VAULT_IDS.some((vault) => Array.isArray(record.deploy_subscriptions && record.deploy_subscriptions[vault])
    && record.deploy_subscriptions[vault].length > 0);
}

function exactRecoveryHead(record, expectedHead) {
  if (typeof expectedHead !== 'string' || !EXACT_SHA.test(expectedHead)) {
    throw new Error('recover-deployed requires --expected-head as one exact lowercase 40-hex SHA token');
  }
  const receiptHead = record.gate_receipt && record.gate_receipt.head_sha;
  if (receiptHead !== expectedHead) throw new Error(`expected HEAD does not match preserved gate receipt (${expectedHead} != ${receiptHead || 'missing'})`);
  if (record.gate_receipt.status !== 'pass') throw new Error('preserved combined gate receipt did not pass');
  for (const lens of REVIEW_LENSES) {
    const review = record.reviews && record.reviews[lens];
    if (!review || review.head_sha !== expectedHead || review.verdict !== 'pass') {
      throw new Error(`preserved ${lens} review does not pass at exact expected HEAD`);
    }
  }
  return expectedHead;
}

function collectDeployedRecoveryEvidence(ctx, record, expectedHead, deps = {}) {
  const view = deps.prView || prView;
  const releaseFinder = deps.findContainingRelease || findContainingRelease;
  const releaseContains = deps.releaseContainsCommit
    || ((ancestor, descendant) => commitContains(REPO, ancestor, descendant, ctx.root));
  const formulaTag = deps.currentTapFormulaTag || currentTapFormulaTag;
  const contains = deps.tagContainsCommit || tagContainsCommit;
  const findTap = deps.tapPr || tapPr;
  const installed = deps.bottleVersion || bottleVersion;
  const vaultProof = deps.vaultLedgerProof || vaultLedgerProof;
  const now = deps.now || (() => new Date().toISOString());
  if (!Number.isInteger(record.feature_pr)) throw new Error('recover-deployed requires a recorded feature PR');
  const feature = view(REPO, record.feature_pr, ctx.root);
  if (!feature || feature.state !== 'MERGED') throw new Error('feature PR is not merged');
  if (feature.headRefOid !== expectedHead) throw new Error('feature PR head is not the exact expected 40-hex HEAD');
  const featureMerge = feature.mergeCommit && feature.mergeCommit.oid;
  if (!EXACT_SHA.test(String(featureMerge || ''))) throw new Error('feature PR has no exact merge commit receipt');
  if (record.feature_merge_sha && record.feature_merge_sha !== featureMerge) throw new Error('feature merge commit differs from preserved ledger evidence');

  const release = record.release_pr ? view(REPO, record.release_pr, ctx.root) : releaseFinder(featureMerge, ctx.root);
  if (!release || release.state !== 'MERGED') throw new Error('containing release PR is not merged');
  const releaseMerge = release.mergeCommit && release.mergeCommit.oid;
  if (!EXACT_SHA.test(String(releaseMerge || ''))) throw new Error('release PR has no exact merge commit receipt');
  if (!releaseContains(featureMerge, releaseMerge)) throw new Error('release PR does not contain the verified feature merge');

  const tag = formulaTag(ctx.root);
  if (!tag) throw new Error('tap formula must contain exactly one Sauce release tag URL');
  if (!contains(ctx.root, tag, featureMerge)) throw new Error(`tap formula tag ${tag} does not contain feature merge ${featureMerge}`);
  if (!contains(ctx.root, tag, releaseMerge)) throw new Error(`tap formula tag ${tag} does not contain release merge ${releaseMerge}`);
  const version = versionFrom(tag);
  const tap = findTap(version, ctx.root);
  if (!tap || tap.state !== 'MERGED') throw new Error(`tap PR for ${tag} is not merged`);
  const tapMerge = tap.mergeCommit && tap.mergeCommit.oid;
  if (!EXACT_SHA.test(String(tapMerge || ''))) throw new Error(`tap PR for ${tag} has no exact merge commit receipt`);
  const brewVersion = installed();
  if (!brewVersion || cmpVersion(brewVersion, version) < 0) throw new Error(`installed brew ${brewVersion || 'missing'} is older than ${version}`);
  if (!contains(ctx.root, `v${brewVersion}`, featureMerge)) throw new Error(`installed brew v${brewVersion} does not contain feature merge ${featureMerge}`);

  let vaultReceipts;
  if (hasDeploymentAdditions(record)) {
    vaultReceipts = record.vault_receipts;
    if (!VAULTS.every((vault) => {
      const receipt = vaultReceipts && vaultReceipts[vault.id];
      return receipt && receipt.ok === true && receipt.installed_version
        && cmpVersion(receipt.installed_version, version) >= 0;
    })) throw new Error('non-empty deployment additions require existing green three-vault receipts at the recovered version');
  } else {
    vaultReceipts = Object.fromEntries(VAULTS.map((vault) => [vault.id, vaultProof(vault, version, now)]));
    if (!VAULTS.every((vault) => vaultReceipts[vault.id] && vaultReceipts[vault.id].ok === true)) {
      throw new Error('read-only three-vault ledgers do not prove the recovered version');
    }
  }
  return {
    expected_head: expectedHead,
    feature_pr: { number: feature.number, url: feature.url, head_sha: feature.headRefOid, merge_sha: featureMerge },
    release_pr: { number: release.number, url: release.url, merge_sha: releaseMerge },
    tag, version,
    tap_pr: { number: tap.number, url: tap.url, merge_sha: tapMerge },
    brew_version: brewVersion,
    vault_receipts: vaultReceipts,
    verified_at: now(),
  };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function bottleVersion() {
  try { return String(readJson('/opt/homebrew/opt/sauce/libexec/platform/manifest.json').workshop_version || ''); }
  catch (_) { return ''; }
}

function applySubscriptionAdditions(vaultPath, additions) {
  if (!(additions || []).length) return [];
  const subscriptionPath = path.join(vaultPath, 'ranch/platform-subscription.json');
  const manifest = readJson('/opt/homebrew/opt/sauce/libexec/platform/manifest.json');
  const subscription = readJson(subscriptionPath);
  const added = [];
  for (const spec of additions) {
    const match = String(spec).match(/^(mechanism|blueprint):([a-z0-9._-]+)$/i);
    if (!match) throw new Error(`invalid subscription addition ${spec}; expected mechanism:name or blueprint:name`);
    const plural = match[1].toLowerCase() === 'mechanism' ? 'mechanisms' : 'blueprints';
    const item = (manifest[plural] || []).find((entry) => entry.name === match[2]);
    if (!item) throw new Error(`${spec} not present in installed bottle manifest`);
    if (!Array.isArray(subscription[plural])) subscription[plural] = [];
    if (!(subscription[plural] || []).some((entry) => entry.name === item.name)) {
      subscription[plural].push({ name: item.name, version: item.version });
      added.push(spec);
    }
  }
  if (added.length) atomicWriteJson(subscriptionPath, subscription);
  return added;
}

async function deployVault(vault, record) {
  const receipt = { vault: vault.id, path: vault.path, ok: false, required_version: record.required_version, started_at: new Date().toISOString() };
  try {
    if (!fs.existsSync(path.join(vault.path, 'ranch/platform-config.json'))) throw new Error('platform-config.json missing');
    const config = readJson(path.join(vault.path, 'ranch/platform-config.json'));
    if (config.workshop_relative_path !== '/opt/homebrew/opt/sauce/libexec') throw new Error(`not brew-backed: ${config.workshop_relative_path || 'missing'}`);
    const ledgerPath = path.join(vault.path, 'ranch/platform-installed.json');
    const before = fs.existsSync(ledgerPath) ? readJson(ledgerPath) : { history: [] };
    receipt.added_subscriptions = applySubscriptionAdditions(vault.path, (record.deploy_subscriptions || {})[vault.id] || []);
    await execFileAsync('sauce', ['update', '--bump-pins'], { cwd: vault.path, encoding: 'utf8', maxBuffer: MAXBUF });
    const after = readJson(ledgerPath);
    const history = (after.history || []).slice((before.history || []).length);
    const errors = history.filter((row) => row && row.event === 'error');
    receipt.installed_version = String(after.workshop_version || '');
    receipt.history_errors = errors;
    try {
      const status = await execFileAsync('sauce', ['status'], { cwd: vault.path, encoding: 'utf8', maxBuffer: MAXBUF });
      receipt.status_exit = 0; receipt.status_tail = String(status.stdout || '').trim().split('\n').slice(-8);
    } catch (err) { receipt.status_exit = err.code || 1; receipt.status_tail = String(err.stderr || err.message).trim().split('\n').slice(-8); }
    receipt.ok = cmpVersion(receipt.installed_version, record.required_version) >= 0 && errors.length === 0 && receipt.status_exit === 0;
    if (!receipt.ok) receipt.reason = `version/status/history verification failed`;
  } catch (err) { receipt.reason = err.message; }
  receipt.finished_at = new Date().toISOString();
  return receipt;
}

async function promoteAndDeploy(ctx, state, record) {
  return withLock(ctx, 'homebrew-promotion', async () => {
    if (fs.existsSync(path.join(ctx.root, '.autoloop-halt'))) return { action: 'halted', card: record.card, phase: record.phase };
    let installed = bottleVersion();
    if (cmpVersion(installed, record.required_version) < 0) {
      sh('brew', ['update'], { cwd: ctx.root, stdio: 'pipe' });
      sh('brew', ['upgrade', 'sauce'], { cwd: ctx.root, stdio: 'pipe' });
      installed = bottleVersion();
    }
    if (cmpVersion(installed, record.required_version) < 0) throw new Error(`brew ${installed || 'missing'} < required ${record.required_version}`);
    try {
      sh('git', ['fetch', 'origin', '--tags', '--quiet'], { cwd: ctx.root });
      sh('git', ['merge-base', '--is-ancestor', record.feature_merge_sha, `v${installed}`], { cwd: ctx.root });
    } catch (_) {
      throw new Error(`installed brew v${installed} does not prove ancestry for ${record.feature_merge_sha}`);
    }
    record.brew_version = installed; record.phase = 'deploying'; writeState(ctx, state, record);
    const prior = record.vault_receipts || {};
    const needed = VAULTS.filter((vault) => !(prior[vault.id] && prior[vault.id].ok && cmpVersion(prior[vault.id].installed_version, record.required_version) >= 0));
    const results = await Promise.all(needed.map((vault) => deployVault(vault, record)));
    record.vault_receipts = { ...prior, ...Object.fromEntries(results.map((receipt) => [receipt.vault, receipt])) };
    for (const receipt of results) atomicWriteJson(path.join(ctx.stateDir, 'receipts', `${slugify(record.card)}-${receipt.vault}.json`), receipt);
    const allOk = VAULTS.every((vault) => record.vault_receipts[vault.id] && record.vault_receipts[vault.id].ok);
    if (allOk) {
      record.phase = 'deployed'; record.deployed_at = new Date().toISOString();
      await attemptProjection(ctx, record, BOARD, { state });
    }
    writeState(ctx, state, record);
    return allOk
      ? completionResult(record)
      : { action: 'deploy-failed', card: record.card, version: installed, receipts: record.vault_receipts };
  }, { card: record.card, staleMs: 60 * 60 * 1000 });
}

async function stepCard(ctx, state, record, opts = {}, deps = {}) {
  const viewPr = deps.prView || prView;
  const findTag = deps.findContainingTag || findContainingTag;
  const findRelease = deps.findContainingRelease || findContainingRelease;
  const armAutoMerge = deps.armFeatureAutoMerge || armFeatureAutoMerge;
  const disableAutoMerge = deps.disableFeatureAutoMerge || disableFeatureAutoMerge;
  const persist = deps.writeState || writeState;
  if (record.phase === 'blocked'
    && Number.isInteger(record.release_pr)
    && record.release_pr > 0
    && releaseCheckFailureNames(record.reason)) {
    if (!EXACT_SHA.test(String(record.feature_merge_sha || ''))) {
      return { action: 'blocked', card: record.card, reason: record.reason };
    }
    let containingRelease;
    let release;
    try {
      containingRelease = findRelease(record.feature_merge_sha, ctx.root);
      release = viewPr(REPO, record.release_pr, ctx.root);
    } catch (_) {
      return { action: 'blocked', card: record.card, reason: record.reason };
    }
    const usableRelease = release
      && containingRelease
      && containingRelease.number === record.release_pr
      && release.number === record.release_pr
      && typeof release.url === 'string'
      && release.url.length > 0;
    if (!usableRelease) return { action: 'blocked', card: record.card, reason: record.reason };
    if (release.state === 'MERGED') {
      const releaseMergeSha = release.mergeCommit && release.mergeCommit.oid;
      const requiredVersion = versionFrom(release.title);
      if (!EXACT_SHA.test(String(releaseMergeSha || '')) || !requiredVersion) {
        return { action: 'blocked', card: record.card, reason: record.reason };
      }
      record.release_url = release.url;
      record.release_merge_sha = releaseMergeSha;
      record.required_version = requiredVersion;
      delete record.reason;
      record.phase = 'release_merged';
      persist(ctx, state, record);
      return {
        action: 'phase-change', phase: record.phase,
        release_pr: release.number, version: record.required_version,
      };
    }
    if (release.state === 'OPEN') {
      if (!Array.isArray(release.statusCheckRollup)) {
        return { action: 'blocked', card: record.card, reason: record.reason };
      }
      const releaseChecks = checkRollup(release.statusCheckRollup);
      if (releaseChecks.failed.length) {
        record.release_url = release.url;
        record.reason = `release PR checks failed: ${releaseChecks.failed.join(', ')}`;
        persist(ctx, state, record);
        return { action: 'blocked-external', reason: record.reason, url: release.url };
      }
      record.release_url = release.url;
      delete record.reason;
      record.phase = 'release_pr';
      persist(ctx, state, record);
      return {
        action: 'waiting', phase: 'release_pr',
        release_pr: release.number, url: release.url,
      };
    }
    return { action: 'blocked', card: record.card, reason: record.reason };
  }
  if (record.phase === 'parked') {
    return {
      action: 'parked', card: record.card, phase: 'parked',
      dependencies: record.dependencies || [], resume_condition: record.resume_condition || '',
      resume: `resume --card ${record.card}`,
    };
  }
  if (record.phase === 'feature_pr') {
    const pr = viewPr(REPO, record.feature_pr, ctx.root);
    const gateStatus = gateReceiptStatus(record, pr.headRefOid, pr.baseRefOid, pr.title);
    if (pr.state === 'MERGED') {
      if (!gateStatus.valid) {
        record.phase = 'needs-inspection';
        record.reason = `merged feature PR has no valid gate receipt: ${gateStatus.reason}`;
        persist(ctx, state, record);
        return { action: 'needs-inspection', card: record.card, phase: record.phase, reason: record.reason, url: pr.url };
      }
      record.feature_merge_sha = pr.mergeCommit && pr.mergeCommit.oid;
      record.phase = 'feature_merged'; record.feature_merged_at = new Date().toISOString(); persist(ctx, state, record);
      return { action: 'phase-change', phase: record.phase, pr: record.feature_pr, merge_sha: record.feature_merge_sha };
    }
    if (pr.state !== 'OPEN') { record.phase = 'blocked'; record.reason = `feature PR ${pr.state}`; persist(ctx, state, record); return { action: 'blocked', reason: record.reason, url: pr.url }; }
    if (!gateStatus.valid) {
      if (pr.autoMergeRequest) disableAutoMerge(pr, ctx.root);
      return { action: 'verify-gates', card: record.card, phase: 'feature_pr', head_sha: pr.headRefOid, reason: gateStatus.reason, url: pr.url };
    }
    const checks = checkRollup(pr.statusCheckRollup);
    if (checks.failed.length) return { action: 'fix-ci', card: record.card, pr: pr.number, failed_checks: checks.failed, url: pr.url };
    if (['BEHIND', 'DIRTY'].includes(pr.mergeStateStatus)) {
      return { action: 'refresh-feature', card: record.card, pr: pr.number, merge_state: pr.mergeStateStatus, url: pr.url };
    }
    if (!isReleasableTitle(pr.title)) {
      return { action: 'blocked', card: record.card, phase: 'feature_pr', reason: `PR title "${pr.title}" will not trigger a release`, url: pr.url };
    }
    if (checks.green && !pr.autoMergeRequest) {
      try { armAutoMerge(pr, ctx.root); } catch (_) {}
    }
    return { action: 'waiting', phase: 'feature_pr', pending_checks: checks.pending, url: pr.url };
  }

  if (record.phase === 'feature_merged' || record.phase === 'release_pr') {
    // Merge-only binding: an EMPTY deployment vault list (SAUCE_LOOP_VAULTS=[]
    // via .loop/config.json policy.deploy_vaults: []) means this board has no
    // release/tag/tap/brew/deploy chain — a merged feature PR with green
    // protected checks IS completion. Deploy-bound bindings (the default three
    // sauce vaults) never enter this branch and behave byte-identically.
    const deployVaults = deps.deployVaults || VAULTS;
    if (deployVaults.length === 0) {
      record.phase = 'deployed'; record.deployed_at = new Date().toISOString();
      record.merge_only = true;
      await (deps.attemptProjection || attemptProjection)(ctx, record, deps.board || BOARD, { state });
      persist(ctx, state, record);
      return completionResult(record);
    }
    const tag = findTag(record.feature_merge_sha, ctx.root);
    if (tag) {
      record.tag = tag; record.required_version = versionFrom(tag); record.phase = 'tagged'; persist(ctx, state, record);
      return { action: 'phase-change', phase: 'tagged', tag };
    }
    let release = record.release_pr ? viewPr(REPO, record.release_pr, ctx.root) : findRelease(record.feature_merge_sha, ctx.root);
    if (!release) return releasePrWaitReceipt();
    if (release.state === 'OPEN' && !release.statusCheckRollup) release = viewPr(REPO, release.number, ctx.root);
    record.release_pr = release.number; record.release_url = release.url;
    if (release.state === 'MERGED') {
      record.release_merge_sha = release.mergeCommit && release.mergeCommit.oid;
      record.required_version = versionFrom(release.title);
      record.phase = 'release_merged'; persist(ctx, state, record);
      return { action: 'phase-change', phase: record.phase, release_pr: release.number, version: record.required_version };
    }
    if (release.state !== 'OPEN') { record.phase = 'blocked'; record.reason = `release PR ${release.state}`; persist(ctx, state, record); return { action: 'blocked-external', reason: record.reason, url: release.url }; }
    const releaseChecks = checkRollup(release.statusCheckRollup);
    if (releaseChecks.failed.length) {
      record.phase = 'blocked'; record.reason = `release PR checks failed: ${releaseChecks.failed.join(', ')}`; persist(ctx, state, record);
      return { action: 'blocked-external', reason: record.reason, url: release.url };
    }
    record.phase = 'release_pr'; persist(ctx, state, record);
    return { action: 'waiting', phase: 'release_pr', release_pr: release.number, url: release.url };
  }

  if (record.phase === 'release_merged') {
    const tag = findTag(record.feature_merge_sha, ctx.root);
    if (!tag) return { action: 'waiting', phase: 'tag', reason: 'containing tag not created yet' };
    record.tag = tag; record.required_version = versionFrom(tag); record.phase = 'tagged'; persist(ctx, state, record);
    return { action: 'phase-change', phase: record.phase, tag };
  }

  if (record.phase === 'tagged' || record.phase === 'tap_pr') {
    let tap = record.tap_pr ? prView(TAP_REPO, record.tap_pr, ctx.root) : tapPr(record.required_version, ctx.root);
    if (!tap) return { action: 'waiting', phase: 'tap_pr', reason: `bump-v${record.required_version} not created yet` };
    if (tap.state === 'OPEN' && !tap.statusCheckRollup) tap = prView(TAP_REPO, tap.number, ctx.root);
    record.tap_pr = tap.number; record.tap_url = tap.url;
    if (tap.state === 'MERGED') { record.phase = 'tap_merged'; persist(ctx, state, record); return { action: 'phase-change', phase: record.phase, tap_pr: tap.number }; }
    if (tap.state !== 'OPEN') { record.phase = 'blocked'; record.reason = `tap PR ${tap.state}`; persist(ctx, state, record); return { action: 'blocked-external', reason: record.reason, url: tap.url }; }
    const tapChecks = checkRollup(tap.statusCheckRollup);
    if (tapChecks.failed.length) {
      record.phase = 'blocked'; record.reason = `tap PR checks failed: ${tapChecks.failed.join(', ')}`; persist(ctx, state, record);
      return { action: 'blocked-external', reason: record.reason, url: tap.url };
    }
    record.phase = 'tap_pr'; persist(ctx, state, record);
    return { action: 'waiting', phase: 'tap_pr', tap_pr: tap.number, url: tap.url };
  }

  if (record.phase === 'tap_merged' || record.phase === 'brew_installed' || record.phase === 'deploying') {
    if (opts.dryRun) return { action: 'deploy', card: record.card, required_version: record.required_version, vaults: VAULTS.map((v) => v.id) };
    return promoteAndDeploy(ctx, state, record);
  }

  if (record.phase === 'deployed') return completionResult(record);
  if (record.phase === 'blocked') return { action: 'blocked', card: record.card, reason: record.reason };
  if (record.phase === 'needs-inspection') {
    return { action: 'needs-inspection', card: record.card, phase: record.phase, reason: record.reason, url: record.feature_url || null };
  }
  return { action: 'needs-implementation', card: record.card, phase: record.phase, worktree: record.worktree };
}

function argumentValues(value) {
  return (Array.isArray(value) ? value : [value])
    .filter((item) => typeof item === 'string')
    .map(normalizeCardLink)
    .filter(Boolean);
}

function resumeRefused(record, reason, extra = {}) {
  return {
    action: 'resume-refused', ok: false, no_op: false, code: 'resume_ineligible',
    message: reason,
    card: record.card, phase: record.phase,
    reason, dependencies: record.dependencies || [],
    resume_condition: record.resume_condition || '', ...extra,
  };
}

async function commandAmendContract(ctx, args, deps = {}) {
  const unsupported = Object.keys(args).filter((key) => !AMEND_CONTRACT_OPTIONS.has(key));
  if (unsupported.length) throw new Error(`amend-contract refuses unsupported option --${unsupported[0]}`);
  if (args._ && (args._.length !== 1 || args._[0] !== 'amend-contract')) {
    throw new Error('amend-contract refuses unexpected positional arguments');
  }
  if (args.json != null && args.json !== true) throw new Error('amend-contract requires --json without a value');
  const singleton = (key) => Array.isArray(args[key]) ? '' : String(args[key] || '').trim();
  const card = singleton('card');
  const expectedHead = singleton('expected-head').toLowerCase();
  const expectedOriginMain = singleton('expected-origin-main').toLowerCase();
  const reason = singleton('reason');
  if (!card) throw new Error('amend-contract requires an exact --card');
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) throw new Error('amend-contract requires a 40-character --expected-head SHA');
  if (!/^[0-9a-f]{40}$/.test(expectedOriginMain)) throw new Error('amend-contract requires a 40-character --expected-origin-main SHA');
  if (!reason) throw new Error('amend-contract requires a non-empty --reason');
  const rawAdditions = args['add-touch-zone'] == null
    ? [] : (Array.isArray(args['add-touch-zone']) ? args['add-touch-zone'] : [args['add-touch-zone']]);
  if (rawAdditions.some((zone) => typeof zone !== 'string' || !normalizeZone(zone))) {
    throw new Error('--add-touch-zone values must be non-empty paths');
  }
  const additions = [...new Set(rawAdditions.map(normalizeZone))];
  // The expected operand is structurally strict but may spell the legacy value
  // being repaired. Only the desired map can become authoritative, so it alone
  // requires typed mechanism:name / blueprint:name entries.
  const expectedDeployments = parseDeploymentArgument(args['expected-deployment'], 'expected-deployment', { preserveEntries: true });
  const desiredDeployments = parseDeploymentArgument(args['desired-deployment'], 'desired-deployment', { requireTyped: true });
  const expectedBatchPolicy = parseBatchPolicyArgument(args['expected-batch-policy'], 'expected-batch-policy', { allowNull: true });
  const desiredBatchPolicy = parseBatchPolicyArgument(args['desired-batch-policy'], 'desired-batch-policy');
  const requestOperands = amendmentRequestOperands(args);

  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const transitionLock = deps.withLock || withLock;
  const run = deps.sh || sh;
  const worktreeExists = deps.worktreeExists || fs.existsSync;
  const boardPath = deps.boardPath || BOARD;
  const project = deps.projectCard || projectCard;
  const now = deps.now || (() => new Date().toISOString());
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  return transitionLock(ctx, 'selector', async () => withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx);
    const record = state.cards[card];
    if (!record) throw new Error(`amend-contract requires a tracked --card; ${card} is not tracked`);
    requireLeaseToken(record, args, 'amend-contract', leaseNowMs());
    if (!['claimed', 'implementing', 'parked'].includes(record.phase)) {
      throw new Error(`amend-contract accepts only claimed, implementing, or parked pre-PR work; ${card} is ${record.phase}`);
    }
    const isParked = record.phase === 'parked';
    const parkedProblem = isParked ? parkedAmendmentProblem(record) : '';
    if (parkedProblem) throw new Error(parkedProblem);
    if (record.feature_pr != null || record.feature_url != null || record.feature_merge_sha != null) {
      throw new Error('amend-contract refuses tracked feature PR state');
    }
    if (!record.worktree || !worktreeExists(record.worktree)) {
      throw new Error(`amend-contract requires the existing worktree for ${card}`);
    }
    if (record.contract_amendments != null && !Array.isArray(record.contract_amendments)) {
      throw new Error('tracked contract has malformed amendment audit history');
    }
    if (record.receipt_invalidations != null && !Array.isArray(record.receipt_invalidations)) {
      throw new Error('tracked contract has malformed receipt invalidation history');
    }
    const oldTouchZones = normalizeStoredTouchZones(record.touch_zones);
    const oldDeployments = normalizeDeploymentMap(record.deploy_subscriptions, {
      label: 'tracked contract deployment map', preserveEntries: true,
    });
    const oldBatchPolicy = record.batch_policy == null ? null : String(record.batch_policy).trim().toLowerCase();
    if (oldBatchPolicy != null && !delivery.registry.policies.policy_strength.includes(oldBatchPolicy)) {
      throw new Error('tracked contract has malformed batch_policy');
    }
    run('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: record.worktree, stdio: 'pipe' });
    const actualHead = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree }).toLowerCase();
    const actualOriginMain = run('git', ['rev-parse', 'origin/main'], { cwd: record.worktree }).toLowerCase();
    const actualBranch = run('git', ['branch', '--show-current'], { cwd: record.worktree });
    if (actualHead !== expectedHead) throw new Error(`stale expected HEAD; ${card} is ${actualHead}`);
    if (actualOriginMain !== expectedOriginMain) throw new Error(`stale expected origin/main; current revision is ${actualOriginMain}`);
    if (!record.branch || actualBranch !== record.branch) throw new Error(`target worktree branch differs from tracked branch ${record.branch || '(missing)'}`);
    const dirty = run('git', ['status', '--porcelain=v1'], { cwd: record.worktree });
    if (dirty) throw new Error(`amend-contract requires a clean target worktree; ${card} is dirty`);
    if (record.projection_error) throw new Error(`target projection is unresolved: ${record.projection_error}`);
    let targetRaw;
    try { targetRaw = fs.readFileSync(resolveCardPath(record.card_path, record.card, deps.cardsRoot || CARDS_ROOT), 'utf8'); }
    catch (err) { throw new Error(`target card metadata is unreadable: ${err.message}`); }
    const executionProjectionProblem = executionContractProjectionProblem(record, targetRaw);
    if (executionProjectionProblem) {
      throw new Error(`target execution contract must match authority before amendment: ${executionProjectionProblem}`);
    }
    if (parseBatchPolicy(targetRaw) !== desiredBatchPolicy) {
      throw new Error(`desired batch policy must match projected policy ${parseBatchPolicy(targetRaw) || 'null'}`);
    }
    const targetContract = prepareDeliveryCard(targetRaw, card);
    const projectedBatchPolicy = delivery.derivePolicy(targetContract.card);
    if (desiredBatchPolicy !== projectedBatchPolicy) {
      throw new Error(`desired batch policy must match Delivery-derived policy ${projectedBatchPolicy}`);
    }
    const policyStrength = delivery.registry.policies.policy_strength;
    const oldPolicyStrength = oldBatchPolicy == null ? -1 : policyStrength.indexOf(oldBatchPolicy);
    if (policyStrength.indexOf(desiredBatchPolicy) < oldPolicyStrength) {
      throw new Error(`amend-contract refuses batch policy weakening from ${oldBatchPolicy} to ${desiredBatchPolicy}`);
    }
    const metadataProblem = projectionMetadataProblem(record, deps.cardsRoot || CARDS_ROOT);
    if (metadataProblem) throw new Error(`target metadata must be reconciled before amendment: ${metadataProblem.error}`);
    let boardRaw;
    try { boardRaw = fs.readFileSync(boardPath, 'utf8'); }
    catch (err) { throw new Error(`target board projection is unreadable: ${err.message}`); }
    const boardProblem = projectionBoardDrift(boardRaw, record);
    if (boardProblem) throw new Error('target board projection must be reconciled before amendment');

    const newTouchZones = [...oldTouchZones];
    for (const zone of additions) if (!newTouchZones.includes(zone)) newTouchZones.push(zone);
    const oldContract = {
      touch_zones: oldTouchZones, deploy_subscriptions: oldDeployments, batch_policy: oldBatchPolicy,
    };
    const newContract = {
      touch_zones: newTouchZones, deploy_subscriptions: desiredDeployments, batch_policy: desiredBatchPolicy,
    };
    const priorProjectionReceipt = record.projection_reconciled_at;
    const conflict = conflictsWithActive(
      { touchZones: newTouchZones },
      activeRecords(state).filter((candidate) => candidate.card !== card),
    );
    if (conflict) throw new Error(`touch-zone conflict with ${conflict.card}: ${conflict.zone}`);
    const desiredState = sameJson(newContract, oldContract);
    if (desiredState) {
      if (!amendmentReplayMatches(record, requestOperands, oldContract)) {
        throw new Error('desired contract state already exists without an exact successful request identity');
      }
      return {
        action: 'contract-amended', card, phase: record.phase, no_op: true,
        head_sha: actualHead, origin_main_sha: actualOriginMain,
        touch_zones: oldTouchZones, deploy_subscriptions: oldDeployments,
        batch_policy: oldBatchPolicy,
      };
    }
    if (oldBatchPolicy !== expectedBatchPolicy) {
      throw new Error('stale expected batch policy; authoritative contract differs');
    }
    if (!sameDeploymentMap(oldDeployments, expectedDeployments)) {
      throw new Error('stale expected deployment map; authoritative contract differs');
    }

    const amendedAt = now();
    const audit = {
      revision: (record.contract_amendments || []).length + 1,
      amended_at: amendedAt,
      reason,
      expected_head: expectedHead,
      expected_origin_main: expectedOriginMain,
      old_contract: oldContract,
      new_contract: newContract,
      request_identity: {
        request: requestOperands,
        prior_contract: oldContract,
        new_contract: newContract,
      },
    };
    const invalidationReason = `execution contract amended: ${reason}; rerun every review and combined gate`;
    const invalidation = {
      invalidated_at: amendedAt,
      reason: invalidationReason,
      head_sha: actualHead,
      reviews: record.reviews || {},
      gate_receipt: record.gate_receipt || null,
    };
    if (deps.beforeAuthority) await deps.beforeAuthority({ state, record, audit });
    record.touch_zones = newTouchZones;
    record.deploy_subscriptions = desiredDeployments;
    record.batch_policy = desiredBatchPolicy;
    record.contract_amendments = [...(record.contract_amendments || []), audit];
    record.contract_amended_at = amendedAt;
    if (!isParked) {
      record.receipt_invalidations = [...(record.receipt_invalidations || []), invalidation];
      record.reviews = {};
      record.gate_receipt = null;
      delete record.projection_reconciled_at;
    }
    persist(ctx, state, record);
    if (deps.afterAuthority) await deps.afterAuthority({ state, record, audit });
    const projection = await attemptProjection(ctx, record, boardPath, {
      withLock: transitionLock, projectCard: project, now, cardsRoot: deps.cardsRoot, state,
    });
    if (isParked) {
      if (priorProjectionReceipt == null) delete record.projection_reconciled_at;
      else record.projection_reconciled_at = priorProjectionReceipt;
    }
    if (deps.afterProjection) await deps.afterProjection({ state, record, audit, projection });
    persist(ctx, state, record);
    return {
      action: projection.ok ? 'contract-amended' : 'amend-contract-projection-failed',
      card, phase: record.phase, no_op: false,
      head_sha: actualHead, origin_main_sha: actualOriginMain,
      touch_zones: newTouchZones, deploy_subscriptions: desiredDeployments,
      batch_policy: desiredBatchPolicy,
      audit, reviews_invalidated: !isParked, ...(isParked ? {} : { invalidation_reason: invalidationReason }),
      ...(projection.ok ? {} : { projection_error: projection.error, reconcile: `reconcile --card ${card}` }),
    };
  }, { card, staleMs: 60 * 60 * 1000 }, transitionLock), { card, staleMs: 60 * 60 * 1000 });
}

async function commandPark(ctx, args, deps = {}) {
  requireJson(args, 'park');
  requireOnlyOptions(args, 'park', STRICT_CLI_OPTIONS.park);
  const card = String(args.card || '').trim();
  const resumeCondition = Array.isArray(args['resume-condition']) ? '' : String(args['resume-condition'] || '').trim();
  const dependencies = [...new Set(argumentValues(args['depends-on']))];
  if (!card) usage('park-refused', 'invalid_arguments', 'park requires --card');
  if (!dependencies.length) usage('park-refused', 'invalid_arguments', 'park requires one or more --depends-on prerequisite cards');
  if (!resumeCondition) usage('park-refused', 'invalid_arguments', 'park requires a non-empty --resume-condition');
  if (dependencies.some((dependency) => normalizeCardLink(dependency) === normalizeCardLink(card))) {
    refuse('park-refused', 'self_dependency', `${card} cannot depend on itself`);
  }
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const transitionLock = deps.withLock || withLock;
  const find = deps.findCard || findCard;
  const boardPath = deps.boardPath || BOARD;
  const project = deps.projectCard || projectCard;
  const now = deps.now || (() => new Date().toISOString());
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  return transitionLock(ctx, 'selector', async () => withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) refuse('park-refused', 'card_not_claimed', `card ${card} is not claimed`);
    if (record.phase === 'parked') {
      const exactReplay = JSON.stringify(record.dependencies || []) === JSON.stringify(dependencies)
        && record.resume_condition === resumeCondition;
      if (!exactReplay) {
        refuse('park-refused', 'literal_replay_mismatch',
          `parked card ${card} accepts only literal replay of its settled park operands`);
      }
      return successReceipt(record.projection_error ? 'parked-projection-failed' : 'parked', {
        no_op: true, card, phase: record.phase, dependencies,
        resume_condition: resumeCondition, branch: record.branch, worktree: record.worktree,
        ...(record.projection_error ? {
          projection_error: record.projection_error,
          reconcile: `reconcile --card ${card}`,
        } : {}),
      });
    }
    requireLeaseToken(record, args, 'park', leaseNowMs());
    if (!['claimed', 'implementing'].includes(record.phase)) {
      refuse('park-refused', 'phase_ineligible',
        `park only accepts claimed pre-PR work; ${card} is ${record.phase}`);
    }
    for (const dependency of dependencies) {
      if (!find(CARDS_ROOT, dependency)) {
        refuse('park-refused', 'dependency_missing', `prerequisite card ${dependency} does not exist`);
      }
    }
    const parkedAt = now();
    record.phase = 'parked';
    record.dependencies = dependencies;
    record.resume_condition = resumeCondition;
    record.parked_at = parkedAt;
    clearLease(record, 'lease_released_park', now);
    persist(ctx, state, record);
    const projection = await attemptProjection(ctx, record, boardPath, {
      withLock: transitionLock, projectCard: project, now, state,
    });
    persist(ctx, state, record);
    const station = await attemptLoopStationProjection(ctx, state, 'park', {
      projectLoopStation: deps.projectLoopStation, boardPath, cardsRoot: deps.cardsRoot,
    });
    const result = successReceipt(projection.ok ? 'parked' : 'parked-projection-failed', {
      card, phase: record.phase, dependencies, resume_condition: resumeCondition,
      branch: record.branch, worktree: record.worktree,
      loop_station: station.receipt,
    });
    if (!projection.ok) {
      result.projection_error = projection.error;
      result.reconcile = `reconcile --card ${card}`;
    }
    return result;
  }, { card, staleMs: 60 * 60 * 1000 }, transitionLock), { card, staleMs: 60 * 60 * 1000 });
}

// amend-park — bounded supervised repair for a parked card whose recorded park
// metadata (dependencies / resume condition) is wrong, e.g. a park recorded
// against a dependency that later proves impossible or already-satisfied.
// Compare-and-swap on the preserved worktree HEAD, full audit trail on the
// record, literal replay is no_op. Never touches receipts, reviews, the
// worktree, or any non-parked card; discard/supersession remains the only
// path that deletes work.
async function commandAmendPark(ctx, args, deps = {}) {
  requireJson(args, 'amend-park');
  requireOnlyOptions(args, 'amend-park', STRICT_CLI_OPTIONS['amend-park']);
  const card = String(args.card || '').trim();
  const expectedHead = String(args['expected-head'] || '').trim();
  const reason = Array.isArray(args.reason) ? '' : String(args.reason || '').trim();
  const clearDependencies = args['clear-dependencies'] === true;
  const dependencies = [...new Set(argumentValues(args['depends-on']))];
  const resumeCondition = Array.isArray(args['resume-condition']) ? '' : String(args['resume-condition'] || '').trim();
  if (!card) usage('amend-park-refused', 'invalid_arguments', 'amend-park requires --card');
  if (!EXACT_SHA.test(expectedHead)) {
    usage('amend-park-refused', 'invalid_arguments',
      'amend-park requires --expected-head as one exact lowercase 40-hex SHA of the preserved worktree HEAD');
  }
  if (!reason) usage('amend-park-refused', 'invalid_arguments', 'amend-park requires a non-empty audit --reason');
  if (clearDependencies === (dependencies.length > 0)) {
    usage('amend-park-refused', 'invalid_arguments',
      'amend-park requires exactly one of --clear-dependencies or one-or-more --depends-on');
  }
  if (dependencies.some((dependency) => normalizeCardLink(dependency) === normalizeCardLink(card))) {
    refuse('amend-park-refused', 'self_dependency', `${card} cannot depend on itself`);
  }
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const transitionLock = deps.withLock || withLock;
  const find = deps.findCard || findCard;
  const boardPath = deps.boardPath || BOARD;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const project = deps.projectCard || projectCard;
  const run = deps.sh || sh;
  const now = deps.now || (() => new Date().toISOString());
  return transitionLock(ctx, 'selector', async () => withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) refuse('amend-park-refused', 'card_not_claimed', `card ${card} is not claimed`);
    if (record.phase !== 'parked') {
      refuse('amend-park-refused', 'phase_ineligible',
        `amend-park only amends parked cards; ${card} is ${record.phase}`);
    }
    if (!record.worktree || !fs.existsSync(record.worktree)) {
      refuse('amend-park-refused', 'worktree_missing', `worktree is missing for ${card}`);
    }
    const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    if (headSha !== expectedHead) {
      refuse('amend-park-refused', 'head_mismatch',
        `amend-park expected HEAD ${expectedHead} but the preserved worktree is ${headSha}`);
    }
    const nextDependencies = clearDependencies ? [] : dependencies;
    const nextResumeCondition = resumeCondition || record.resume_condition || '';
    if (!nextResumeCondition) {
      usage('amend-park-refused', 'invalid_arguments',
        'amend-park requires --resume-condition when the parked record has none');
    }
    if (JSON.stringify(record.dependencies || []) === JSON.stringify(nextDependencies)
      && (record.resume_condition || '') === nextResumeCondition) {
      return successReceipt('park-amended', {
        no_op: true, card, phase: record.phase,
        dependencies: nextDependencies, resume_condition: nextResumeCondition,
      });
    }
    for (const dependency of nextDependencies) {
      if (!find(cardsRoot, dependency)) {
        refuse('amend-park-refused', 'dependency_missing', `prerequisite card ${dependency} does not exist`);
      }
    }
    record.park_amendments = [...(record.park_amendments || []), {
      at: now(), reason, expected_head: expectedHead,
      previous: { dependencies: record.dependencies || [], resume_condition: record.resume_condition || '' },
      next: { dependencies: nextDependencies, resume_condition: nextResumeCondition },
    }];
    record.dependencies = nextDependencies;
    record.resume_condition = nextResumeCondition;
    persist(ctx, state, record);
    const projection = await attemptProjection(ctx, record, boardPath, {
      withLock: transitionLock, projectCard: project, now, state,
    });
    persist(ctx, state, record);
    const result = successReceipt(projection.ok ? 'park-amended' : 'park-amended-projection-failed', {
      card, phase: record.phase, reason,
      dependencies: nextDependencies, resume_condition: nextResumeCondition,
      amendments: record.park_amendments.length,
    });
    if (!projection.ok) {
      result.projection_error = projection.error;
      result.reconcile = `reconcile --card ${card}`;
    }
    return result;
  }, { card, staleMs: 60 * 60 * 1000 }, transitionLock), { card, staleMs: 60 * 60 * 1000 });
}

// break-lease — manual escape hatch for a holder known to be gone (dead chat
// window, crashed process). Never touches receipts, worktrees, or card
// phase; it only clears the lease and audits the manual reason. No board
// projection: this is a lease-only operation, so it does not need the
// selector transitionLock that board-writing verbs (amend-park) take.
async function commandBreakLease(ctx, args, deps = {}) {
  requireJson(args, 'break-lease');
  requireOnlyOptions(args, 'break-lease', STRICT_CLI_OPTIONS['break-lease']);
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const lock = deps.withLock || withLock;
  const now = deps.now || (() => new Date().toISOString());
  const nowMs = (deps.leaseNowMs || (() => Date.now()))();
  const card = String(args.card || '').trim();
  const reason = Array.isArray(args.reason) ? '' : String(args.reason || '').trim();
  if (!card) usage('break-lease-refused', 'card_required', 'break-lease requires --card "<exact name>"');
  if (!reason) refuse('break-lease-refused', 'reason_required', 'break-lease requires --reason "<why the holder is gone>"');
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx);
    const record = state.cards[card];
    if (!record) refuse('break-lease-refused', 'card_not_claimed', `card ${card} is not claimed`);
    const broken = leaseSummary(record.lease, nowMs);
    if (!clearLease(record, 'lease_broken_manual', now)) {
      return successReceipt('break-lease', { card, no_op: true, broken: null, reason });
    }
    record.lease_breaks[record.lease_breaks.length - 1].manual_reason = reason;
    persist(ctx, state, record);
    return successReceipt('break-lease', { card, no_op: false, broken, reason });
  }, { card }, lock);
}

async function commandResume(ctx, args, deps = {}) {
  requireJson(args, 'resume');
  requireOnlyOptions(args, 'resume', STRICT_CLI_OPTIONS.resume);
  const card = String(args.card || '').trim();
  if (!card) usage('resume-refused', 'invalid_arguments', 'resume requires --card');
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const transitionLock = deps.withLock || withLock;
  const find = deps.findCard || findCard;
  const run = deps.sh || sh;
  const boardPath = deps.boardPath || BOARD;
  const project = deps.projectCard || projectCard;
  const now = deps.now || (() => new Date().toISOString());
  const worktreeExists = deps.worktreeExists || fs.existsSync;
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  const mintLeaseToken = deps.leaseToken || (() => crypto.randomUUID());
  return transitionLock(ctx, 'selector', async () => withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) refuse('resume-refused', 'card_not_claimed', `card ${card} is not claimed`);
    const nowMs = leaseNowMs();
    const suppliedToken = String(args['lease-token'] || '').trim();
    if (record.phase !== 'parked') {
      if (!TERMINAL.has(record.phase)) {
        // active card → attach: lease arbitration only, zero phase/review side effects
        const live = leaseIsLive(record.lease, nowMs);
        if (live && suppliedToken && suppliedToken === record.lease.token) {
          record.lease.renewed_at = now();
          persist(ctx, state, record);
          return successReceipt('attach', {
            card, phase: record.phase, no_op: true,
            lease_token: record.lease.token, lease: leaseSummary(record.lease, nowMs),
            branch: record.branch, worktree: record.worktree,
          });
        }
        if (live) {
          refuse('resume-refused', 'lease_held',
            `card ${card} is actively leased by ${record.lease.holder && record.lease.holder.host ? record.lease.holder.host : 'another session'} (expires in ${Math.round((LEASE_TTL_MS - (nowMs - Date.parse(record.lease.renewed_at))) / 60000)}m) — resume a different active card, claim new work, or break-lease --card "${card}" --reason "..." if the holder is known dead`,
            { card, phase: record.phase, lease: leaseSummary(record.lease, nowMs) });
        }
        if (record.lease) clearLease(record, 'lease_superseded_stale', now); // stale takeover, audited
        acquireLease(record, { now, token: mintLeaseToken() });
        persist(ctx, state, record);
        return successReceipt('attach', {
          card, phase: record.phase, no_op: false,
          lease_token: record.lease.token, lease: leaseSummary(record.lease, nowMs),
          branch: record.branch, worktree: record.worktree,
        });
      }
      // terminal phases fall through to the existing 'not parked' refusal below
    }
    if (record.phase === 'implementing' && record.last_resume_request
      && record.last_resume_request.card === card) {
      return successReceipt(record.projection_error ? 'resume-projection-failed' : 'implement', {
        no_op: true, card, phase: record.phase, branch: record.branch,
        worktree: record.worktree, dependencies: record.dependencies || [],
        reviews_invalidated: true,
        invalidation_reason: record.resume_invalidation_reason || '',
        head_sha: record.last_resume_request.head_sha || null,
        origin_main_sha: record.last_resume_request.origin_main_sha || null,
        origin_main_advanced: record.last_resume_request.origin_main_advanced === true,
        requires_main_update: record.last_resume_request.requires_main_update === true,
        ...(record.projection_error ? {
          projection_error: record.projection_error,
          reconcile: `reconcile --card ${card}`,
        } : {}),
      });
    }
    if (record.phase !== 'parked') return resumeRefused(record, `card is ${record.phase}, not parked`);
    if (record.projection_error) {
      return resumeRefused(record, `park metadata projection is unresolved: ${record.projection_error}`, {
        reconcile: `reconcile --card ${card}`,
      });
    }
    if (!Array.isArray(record.dependencies)
      || record.dependencies.some((dependency) => typeof dependency !== 'string' || !normalizeCardLink(dependency))
      || (!record.dependencies.length && !parkDependenciesClearedByAudit(record))) {
      return resumeRefused(record, 'parked dependency metadata is missing or malformed');
    }
    if (record.dependencies.some((dependency) => normalizeCardLink(dependency) === normalizeCardLink(card))) {
      return resumeRefused(record, 'parked dependency metadata contains a self-dependency');
    }
    if (typeof record.resume_condition !== 'string' || !record.resume_condition.trim()) {
      return resumeRefused(record, 'parked resume condition is missing or malformed');
    }
    if (!record.worktree || !worktreeExists(record.worktree)) {
      return resumeRefused(record, 'preserved parked worktree is missing; recover before resuming');
    }
    for (const dependency of record.dependencies) {
      if (!find(CARDS_ROOT, normalizeCardLink(dependency))) {
        return resumeRefused(record, `prerequisite card ${normalizeCardLink(dependency)} does not exist`);
      }
    }
    let cardRaw;
    try { cardRaw = fs.readFileSync(record.card_path, 'utf8'); }
    catch (err) { return resumeRefused(record, `parked card metadata is unreadable: ${err.message}`); }
    const projectedDependencies = parseDependsOn(cardRaw).map(normalizeCardLink);
    if (JSON.stringify(projectedDependencies) !== JSON.stringify(record.dependencies.map(normalizeCardLink))
      || scalarField(cardRaw, 'resume_condition') !== record.resume_condition.trim()
      || scalarField(cardRaw, 'status') !== 'parked') {
      return resumeRefused(record, 'parked card metadata does not match the ledger; reconcile before resuming', {
        reconcile: `reconcile --card ${card}`,
      });
    }
    const active = activeRecords(state);
    if (active.length >= MAX_ACTIVE) {
      return resumeRefused(record, `active capacity is full (${active.length}/${MAX_ACTIVE})`, {
        active: active.map((item) => item.card),
      });
    }
    const sibling = sameParentConflict(record.parent_card, active, card);
    if (sibling) return resumeRefused(record, `active sibling ${sibling.card} has parent ${normalizeCardLink(record.parent_card)}`);
    const conflict = conflictsWithActive({ touchZones: record.touch_zones || [] }, active);
    if (conflict) return resumeRefused(record, `touch-zone conflict with ${conflict.card}: ${conflict.zone}`);
    const discardedDependency = record.dependencies
      .map((dependency) => discardedDependencyProblem(normalizeCardLink(dependency), state))
      .find(Boolean);
    if (discardedDependency) return resumeRefused(record, discardedDependency);
    const boardMd = fs.readFileSync(boardPath, 'utf8');
    const unmet = record.dependencies.filter((dependency) => !dependencySatisfied(normalizeCardLink(dependency), parseBoard(boardMd), state, boardMd));
    if (unmet.length) return resumeRefused(record, `dependencies not deployed: ${unmet.join(', ')}`, { unmet });

    run('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: record.worktree, stdio: 'pipe' });
    const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    const originMainSha = run('git', ['rev-parse', 'origin/main'], { cwd: record.worktree });
    let originMainAdvanced = false;
    try { run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { cwd: record.worktree }); }
    catch (_) { originMainAdvanced = true; }

    const invalidatedAt = now();
    const invalidation = {
      invalidated_at: invalidatedAt,
      reason: 'successful resume after parked prerequisites deployed; rerun every review and combined gate',
      head_sha: headSha,
      reviews: record.reviews || {},
      gate_receipt: record.gate_receipt || null,
    };
    record.receipt_invalidations = [...(record.receipt_invalidations || []), invalidation];
    record.reviews = {};
    record.gate_receipt = null;
    record.phase = 'implementing';
    record.resume_condition = null;
    record.resumed_at = invalidatedAt;
    record.resume_invalidation_reason = invalidation.reason;
    record.last_resume_request = {
      card, head_sha: headSha, origin_main_sha: originMainSha,
      origin_main_advanced: originMainAdvanced,
      requires_main_update: originMainAdvanced,
    };
    acquireLease(record, { now, token: mintLeaseToken() });
    persist(ctx, state, record);
    const projection = await attemptProjection(ctx, record, boardPath, {
      withLock: transitionLock, projectCard: project, now, state,
    });
    persist(ctx, state, record);
    const station = await attemptLoopStationProjection(ctx, state, 'resume', {
      projectLoopStation: deps.projectLoopStation, boardPath, cardsRoot: deps.cardsRoot,
    });
    return successReceipt(projection.ok ? 'implement' : 'resume-projection-failed', {
      card, phase: record.phase, branch: record.branch, worktree: record.worktree,
      dependencies: record.dependencies, reviews_invalidated: true,
      invalidation_reason: invalidation.reason,
      head_sha: headSha, origin_main_sha: originMainSha,
      origin_main_advanced: originMainAdvanced, requires_main_update: originMainAdvanced,
      loop_station: station.receipt,
      lease_token: record.lease.token, lease: leaseSummary(record.lease, leaseNowMs()),
      ...(projection.ok ? {} : { projection_error: projection.error, reconcile: `reconcile --card ${card}` }),
    });
  }, { card, staleMs: 60 * 60 * 1000 }, transitionLock), { card, staleMs: 60 * 60 * 1000 });
}

function discardReplayMatches(record, reason, supersededBy, carriedFixtures) {
  return record.discard_reason === reason
    && (record.superseded_by || null) === supersededBy
    && JSON.stringify(record.carried_fixtures || []) === JSON.stringify(carriedFixtures);
}

function discardOperands(args) {
  const card = String(args.card || '').trim();
  const reason = Array.isArray(args.reason) ? '' : String(args.reason || '').trim();
  const supersededBy = args['superseded-by'] == null
    ? null : (Array.isArray(args['superseded-by']) ? '' : String(args['superseded-by']).trim());
  const carriedFixtures = args['carried-fixture'] == null
    ? [] : (Array.isArray(args['carried-fixture']) ? [...args['carried-fixture']] : [args['carried-fixture']]);
  if (!card) throw new Error('discard requires --card');
  if (!reason) throw new Error('discard requires a non-empty --reason');
  if (supersededBy === '') throw new Error('discard requires --superseded-by to be one exact card name when present');
  if (carriedFixtures.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('--carried-fixture values must be non-empty strings');
  }
  return { card, reason, supersededBy, carriedFixtures };
}

function resolveDiscardDeps(deps = {}) {
  return {
    loadState: deps.readState || readState,
    persist: deps.writeState || writeState,
    transitionLock: deps.withLock || withLock,
    run: deps.sh || sh,
    worktreeExists: deps.worktreeExists || fs.existsSync,
    boardPath: deps.boardPath || BOARD,
    cardsRoot: deps.cardsRoot || CARDS_ROOT,
    writeText: deps.writeText || atomicWriteText,
    now: deps.now || (() => new Date().toISOString()),
    stationProject: deps.projectLoopStation || projectLoopStation,
  };
}

// Shared worktree/branch pruning for discard-shaped exits: never deletes a
// branch with a recorded feature PR or a live worktree checkout.
function pruneCardWorkspace(ctx, record, { run, worktreeExists }) {
  let worktreeRemoved = false;
  let worktreeError = null;
  if (record && record.worktree && worktreeExists(record.worktree)) {
    try {
      run('git', ['worktree', 'remove', '--force', record.worktree], { cwd: ctx.root, stdio: 'pipe' });
      worktreeRemoved = true;
    } catch (err) { worktreeError = err.message; }
  }
  let branchReceipt = null;
  if (record && record.branch) {
    if (record.feature_pr != null) {
      branchReceipt = {
        branch: record.branch, deleted: false, retained_unsafe_to_delete: true,
        reason: `record has feature PR #${record.feature_pr} recorded; branch deletion not verified safe`,
      };
    } else {
      try {
        const listed = run('git', ['worktree', 'list', '--porcelain'], { cwd: ctx.root, stdio: 'pipe' });
        if (String(listed).split('\n').some((line) => line.trim() === `branch refs/heads/${record.branch}`)) {
          branchReceipt = {
            branch: record.branch, deleted: false, retained_unsafe_to_delete: true,
            reason: 'branch is checked out in a worktree',
          };
        }
      } catch (err) {
        branchReceipt = {
          branch: record.branch, deleted: false, retained_unsafe_to_delete: true,
          reason: `could not inspect worktree checkouts: ${err.message}`,
        };
      }
      if (!branchReceipt) {
        try {
          run('git', ['branch', '-D', record.branch], { cwd: ctx.root, stdio: 'pipe' });
          branchReceipt = { branch: record.branch, deleted: true };
        } catch (err) {
          branchReceipt = { branch: record.branch, deleted: false, reason: `branch deletion failed: ${err.message}` };
        }
      }
    }
  }
  return { worktreeRemoved, worktreeError, branchReceipt };
}

// Discard-time dependents scan: when a card is discarded with a named
// successor, any live note still pointing at the discarded predecessor is
// walked from cardsRoot. Planning-status dependents are repointed to the
// successor's own live tail (chased through any further supersession
// chain); active/parked dependents, and any dependent when the successor
// chain is a cycle or dead-end, are reported but never rewritten.
function scanDependentsForDiscard(card, supersededBy, state, cardsRoot, d) {
  const rewrites = [];
  const reports = [];
  const predecessor = normalizeCardLink(card);
  // Repoint dependents to the successor's own live tail (always repoint, never clear).
  const resolved = resolveSupersessionTail(supersededBy, state);
  const repointable = !resolved.cycle && !resolved.deadEnd;
  const target = resolved.tail;
  const stack = [cardsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.name.endsWith('.md')) continue;
      const depName = ent.name.replace(/\.md$/, '');
      if (normalizeCardLink(depName) === predecessor) continue; // skip the predecessor's own note
      const raw = fs.readFileSync(full, 'utf8');
      if (!parseDependsOn(raw).includes(predecessor)) continue;
      const record = state.cards[depName];
      const phase = record ? record.phase : null;
      const inFlight = record && (phase === 'claimed' || phase === 'implementing' || phase === 'parked');
      if (inFlight || !repointable) {
        reports.push({ card: depName, from: predecessor, phase }); // active/parked or unrepointable → report only
        continue;
      }
      const rewritten = rewriteDependsOn(raw, predecessor, target);
      if (rewritten.changed) {
        d.writeText(full, rewritten.text);
        rewrites.push({ card: depName, from: predecessor, to: target, path: full });
      }
    }
  }
  return { rewrites, reports };
}

// The epic sub-board that physically owns a card note. A canonical slice lives
// flat beside its epic board, so the owning board is derivable from the note's own
// directory alone — no projection contract required.
//
// This exists because the full contract is fragile by design: one non-canonical
// atlas binding, or one already-orphaned sibling, makes canonicalEpicProjection
// throw for the whole epic. Discard used to fall back to the PARENT board in that
// case, which never carries slice lines, so it removed nothing and unlinked the
// note anyway. The surviving sub-board line then made every later projection of
// that epic throw "epic slice <X> note is missing" — one failed surface silently
// converted into permanent board-wide freeze.
function owningEpicBoardPath(cardPath, cardsRoot) {
  if (!cardPath) return null;
  const boardDir = path.dirname(path.resolve(cardPath));
  if (path.basename(boardDir) !== 'board') return null;
  const epic = path.basename(path.dirname(boardDir));
  const candidate = path.join(boardDir, `${epic}-board.md`);
  try {
    const entry = fs.lstatSync(candidate);
    if (entry.isSymbolicLink() || !entry.isFile()) return null;
    physicalDescendant(cardsRoot, candidate, `epic board beside ${path.basename(cardPath)}`);
    return scalarField(fs.readFileSync(candidate, 'utf8'), 'board_role') === 'epic' ? candidate : null;
  } catch (_) { return null; }
}

// Per-card discard core. Callers own the selector + card-gate locks; commandDiscard
// takes them for a single card and commandReap takes them per corpse in one batch.
async function discardCardCore(ctx, operands, d) {
  const { card, reason, supersededBy, carriedFixtures } = operands;
  const {
    loadState, persist, run, worktreeExists, boardPath, cardsRoot, writeText, now,
  } = d;
  const state = loadState(ctx);
  const record = state.cards[card];
  if (record && record.phase === 'discarded') {
    if (discardReplayMatches(record, reason, supersededBy, carriedFixtures)) {
      return {
        action: 'discarded', card, phase: 'discarded', no_op: true, tracked: true,
        tombstone: {
          discarded_at: record.discarded_at || null, discard_reason: record.discard_reason || null,
          superseded_by: record.superseded_by || null, final_head: record.final_head || null,
          carried_fixtures: record.carried_fixtures || [],
        },
      };
    }
    throw new Error(`card ${card} is already discarded with different operands; replay must be literal`);
  }
  if (record && record.phase !== 'parked' && !['blocked', 'failed', 'cancelled'].includes(record.phase)) {
    throw new Error(`discard refuses ${record.phase === 'deployed' ? 'deployed' : 'active in-flight'} work; ${card} is ${record.phase}`);
  }
  const cardPath = resolveCardPath(record ? record.card_path : null, card, cardsRoot);
  const noteExists = Boolean(cardPath && fs.existsSync(cardPath));
  let cardRaw = '';
  let epicSurface = null;
  let epicSurfaceError = null;
  if (noteExists) {
    cardRaw = fs.readFileSync(cardPath, 'utf8');
    // ES4a canonicalization: refuse to unlink anything but one regular
    // non-symlink file physically inside the project tasks root.
    const entry = fs.lstatSync(cardPath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`discard target note for ${card} must be one regular non-symlink file`);
    }
    physicalDescendant(cardsRoot, cardPath, `discard target note ${card}`);
    try {
      epicSurface = canonicalEpicProjection(cardRaw, cardPath, boardPath, cardsRoot, { state, currentCard: card });
    } catch (err) { epicSurfaceError = err.message; }
  }
  const targetBoardPath = (epicSurface && epicSurface.boardPath)
    || owningEpicBoardPath(cardPath, cardsRoot)
    || boardPath;
  let boardRaw;
  try { boardRaw = fs.readFileSync(targetBoardPath, 'utf8'); }
  catch (err) { throw new Error(`discard target board is unreadable: ${err.message}`); }
  const boardLine = boardCardLocation(boardRaw, card);
  if (!record && !noteExists && !boardLine) {
    throw new Error(`discard requires a tracked record, card note, or board line for ${card}; none exist`);
  }

  // Ledger first: the tombstone is authoritative before any projection removal.
  const preservedHead = record && record.gate_receipt && record.gate_receipt.head_sha;
  const tombstone = {
    discarded_at: now(), discard_reason: reason, superseded_by: supersededBy,
    // A tombstone's final_head must be canonical: exactly one 40-hex SHA or null.
    final_head: typeof preservedHead === 'string' && EXACT_SHA.test(preservedHead) ? preservedHead : null,
    carried_fixtures: carriedFixtures,
  };
  const target = record || { card, card_path: noteExists ? cardPath : null };
  target.phase = 'discarded';
  Object.assign(target, tombstone);
  clearLease(target, 'lease_cleared_supervised', now);
  state.cards[card] = target;
  persist(ctx, state, target);

  let dependencyScan = { rewrites: [], reports: [] };
  if (supersededBy) {
    dependencyScan = scanDependentsForDiscard(card, supersededBy, state, cardsRoot, d);
  }

  const boardNext = removeBoardCard(boardRaw, card);
  const boardChanged = boardNext !== boardRaw;
  if (boardChanged) writeText(targetBoardPath, boardNext);
  let noteDeleted = false;
  if (noteExists) {
    fs.unlinkSync(cardPath);
    noteDeleted = true;
  }
  let epicReceipt = null;
  if (epicSurface) {
    try {
      epicSurface.boardRaw = boardNext;
      const lifecycle = deriveEpicProjection(epicSurface, null, null);
      const epicMapping = epicProjectionMapping(lifecycle.state);
      if (!epicMapping) throw new Error(`unsupported derived epic state ${lifecycle.state}`);
      const parentNext = moveBoardCard(epicSurface.parentRaw, epicSurface.epic, epicMapping.column, epicMapping.complete);
      const atlasNext = patchFrontmatter(epicSurface.atlasRaw, { status: lifecycle.state, posture: lifecycle.posture });
      if (parentNext !== epicSurface.parentRaw) writeText(boardPath, parentNext);
      if (atlasNext !== epicSurface.atlasRaw) writeText(epicSurface.atlasPath, atlasNext);
      epicReceipt = {
        epic: epicSurface.epic, state: lifecycle.state, posture: lifecycle.posture,
        findings: lifecycle.findings,
      };
    } catch (err) {
      target.projection_error = err.message;
      target.projection_failed_at = now();
      persist(ctx, state, target);
      epicReceipt = { epic: epicSurface.epic, error: err.message, reconcile: reconcileRoute(card) };
    }
  }

  const workspace = pruneCardWorkspace(ctx, record, { run, worktreeExists });
  return {
    action: 'discarded', card, phase: 'discarded', no_op: false,
    tracked: Boolean(record), tombstone,
    board_path: targetBoardPath, board_line_removed: boardChanged, note_deleted: noteDeleted,
    worktree_removed: workspace.worktreeRemoved,
    ...(workspace.worktreeError ? { worktree_error: workspace.worktreeError } : {}),
    ...(workspace.branchReceipt ? { branch: workspace.branchReceipt } : {}),
    ...(epicReceipt ? { epic: epicReceipt } : {}),
    ...(epicSurfaceError ? { epic_surface_error: epicSurfaceError } : {}),
    ...(dependencyScan.rewrites.length ? { dependency_rewrites: dependencyScan.rewrites } : {}),
    ...(dependencyScan.reports.length ? { dependency_reports: dependencyScan.reports } : {}),
  };
}

// The canonical vault-relative bindings for one epic, derived from the physical
// project prefix — the same authority canonicalEpicProjection validates against,
// so "what the heal writes" and "what the contract demands" cannot drift.
function canonicalEpicBindings(epic, cardsRoot, parentBoardPath) {
  const { prefix } = physicalProjectPrefix(cardsRoot);
  return {
    parentBoard: path.posix.join(prefix, path.basename(parentBoardPath)),
    atlas: path.posix.join(prefix, 'tasks', epic, `${epic}.md`),
    board: path.posix.join(prefix, 'tasks', epic, 'board', `${epic}-board.md`),
  };
}

// Everything the heal would change, computed before any write. Two findings:
// bindings whose value differs from the canonical vault-relative form, and epic
// sub-board lines whose slice note no longer exists (each one of which makes the
// whole epic's projection throw "epic slice <X> note is missing").
function planEpicBindingHeal(cardsRoot, parentBoardPath) {
  const atlases = [];
  const slices = [];
  const orphanLines = [];
  const drift = (raw, wanted) => {
    const fields = {};
    for (const [key, to] of wanted) {
      const from = scalarField(raw, key);
      if (from && from !== to) fields[key] = { from, to };
    }
    return fields;
  };
  const epics = fs.readdirSync(cardsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const epic of epics) {
    const atlasPath = path.join(cardsRoot, epic, `${epic}.md`);
    const boardDir = path.join(cardsRoot, epic, 'board');
    const epicBoardPath = path.join(boardDir, `${epic}-board.md`);
    if (!fs.existsSync(atlasPath) || !fs.existsSync(epicBoardPath)) continue;
    const atlasRaw = fs.readFileSync(atlasPath, 'utf8');
    if (scalarField(atlasRaw, 'type') !== 'epic') continue;
    const want = canonicalEpicBindings(epic, cardsRoot, parentBoardPath);
    const atlasFields = drift(atlasRaw, [
      ['source_board', want.parentBoard], ['kanban_board', want.parentBoard], ['epic_board', want.board],
    ]);
    if (Object.keys(atlasFields).length) atlases.push({ epic, path: atlasPath, fields: atlasFields });
    const boardRaw = fs.readFileSync(epicBoardPath, 'utf8');
    const parsed = parseBoard(boardRaw);
    for (const name of ['In Planning', 'In Progress', 'Blocked', 'Completed'].flatMap((c) => parsed[c] || [])) {
      const notePath = path.join(boardDir, `${name}.md`);
      if (!fs.existsSync(notePath)) {
        orphanLines.push({ board: epicBoardPath, epic, card: name });
        continue;
      }
      const sliceRaw = fs.readFileSync(notePath, 'utf8');
      if (scalarField(sliceRaw, 'type') !== 'slice') continue;
      const sliceFields = drift(sliceRaw, [
        ['task_parent', want.atlas], ['source_board', want.board], ['kanban_board', want.board],
      ]);
      if (Object.keys(sliceFields).length) slices.push({ card: name, epic, path: notePath, fields: sliceFields });
    }
  }
  return { atlases, slices, orphanLines };
}

// Reusable repair for boards frozen by non-canonical bindings or orphaned
// sub-board lines. Deliberately NOT spec-handshaked like `reconcile-metadata`:
// the target state is derived entirely from the on-disk canonical form rather
// than from operator-supplied operands, so recomputing at apply time is exactly
// as safe as replaying a recorded intent, and the verb is idempotent by
// construction. It touches ONLY the drifted frontmatter fields and the orphaned
// board lines — never bodies, ledger state, worktrees, or lane placement.
async function commandHealEpicBindings(ctx, args, deps = {}) {
  requireOnlyOptions(args, 'heal-epic-bindings', STRICT_CLI_OPTIONS['heal-epic-bindings']);
  if (args.json !== true) throw new Error('heal-epic-bindings requires --json for a machine-readable receipt');
  const apply = args.apply === true;
  const dryRun = args['dry-run'] === true;
  if (apply === dryRun) throw new Error('heal-epic-bindings requires exactly one of --apply or --dry-run');
  const boardPath = deps.boardPath || BOARD;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const writeText = deps.writeText || atomicWriteText;
  const transitionLock = deps.withLock || withLock;
  return transitionLock(ctx, 'selector', async () => {
    const plan = planEpicBindingHeal(cardsRoot, boardPath);
    const { atlases, slices, orphanLines } = plan;
    if (apply) {
      for (const target of [...atlases, ...slices]) {
        const raw = fs.readFileSync(target.path, 'utf8');
        const patch = {};
        for (const [key, change] of Object.entries(target.fields)) patch[key] = JSON.stringify(change.to);
        writeText(target.path, patchFrontmatter(raw, patch));
      }
      // Group by board so one board with several orphans is written once.
      const byBoard = new Map();
      for (const orphan of orphanLines) {
        if (!byBoard.has(orphan.board)) byBoard.set(orphan.board, []);
        byBoard.get(orphan.board).push(orphan.card);
      }
      for (const [board, cards] of byBoard) {
        let raw = fs.readFileSync(board, 'utf8');
        for (const card of cards) raw = removeBoardCard(raw, card);
        writeText(board, raw);
      }
    }
    return successReceipt('heal-epic-bindings', {
      no_op: !atlases.length && !slices.length && !orphanLines.length,
      applied: apply,
      atlases: atlases.map(({ epic, path: target, fields }) => ({ epic, path: target, fields })),
      slices: slices.map(({ card, epic, path: target, fields }) => ({ card, epic, path: target, fields })),
      orphan_lines: orphanLines,
    });
  }, { staleMs: 60 * 60 * 1000 });
}

// --- Board-health sweep (workstream 1 of the loop-integrity program).
// Every check starts from the BOARD, not the ledger: the other checks in this
// file iterate Object.values(state.cards), so a board member with no ledger
// record is unreachable by them — that blind spot is why this verb exists.
// Report-only: it never blocks, never heals, and never changes completion
// semantics; heal-epic-bindings and reconcile remain the explicit remedies.

const BOARD_HEALTH_LANES = ['In Planning', 'In Progress', 'Blocked', 'Completed'];
// Pre-claim `planning` is the one note status the ledger legitimately has no
// record for; anything else on an untracked member is work outside the rail.
const BOARD_HEALTH_PROGRESS_STATUSES = new Set(['in_progress', 'parked', 'blocked', 'completed']);
const BOARD_HEALTH_DRIFT_REMEDY = 'heal-epic-bindings --dry-run --json';

function untrackedMemberFinding(epic, cardName, noteStatus) {
  return {
    epic,
    card: cardName,
    note_status: noteStatus,
    issue: noteStatus === 'completed'
      ? 'board member has no ledger record; a completed note is never counted done'
      : `board member has no ledger record; the note claims ${noteStatus} with no coordinator history`,
    // Deliberately non-mechanical: fabricating ledger records is exactly the
    // drift the reconciler exists to flag.
    remedy: 'investigate: work completed outside the rail',
  };
}

function collectBoardHealth(state, opts = {}) {
  const boardPath = opts.boardPath || BOARD;
  const cardsRoot = opts.cardsRoot || CARDS_ROOT;
  const exists = opts.exists || fs.existsSync;
  const readText = opts.readText || ((target) => fs.readFileSync(target, 'utf8'));
  const ledger = opts.ledger || 'present';
  const project = physicalProjectPrefix(cardsRoot);
  const parentRaw = readText(boardPath);
  const cards = (state && state.cards) || {};
  const tracked = (name) => Object.prototype.hasOwnProperty.call(cards, name);
  const parsedParent = parseBoard(parentRaw);
  const members = BOARD_HEALTH_LANES.flatMap((lane) => parsedParent[lane] || []);
  const untracked = [];
  const unprojectable = [];
  const laneDivergence = [];
  let epicCount = 0;
  let sliceCount = 0;
  const untrackedCheck = (epic, name, notePath) => {
    if (tracked(name) || !exists(notePath)) return;
    const status = delivery.normalizeStatus(scalarField(readText(notePath), 'status')) || 'planning';
    if (BOARD_HEALTH_PROGRESS_STATUSES.has(status)) {
      untracked.push(untrackedMemberFinding(epic, name, status));
    }
  };
  for (const member of members) {
    const epicRoot = path.join(cardsRoot, member);
    const atlasPath = path.join(epicRoot, `${member}.md`);
    // Per-epic isolation: one epic that throws is a finding, not an abort — a
    // malformed atlas in epic 7 must not hide epics 8..N. Check 1 runs BEFORE
    // projection so an unprojectable epic's members stay reachable.
    try {
      const isEpic = exists(atlasPath) && scalarField(readText(atlasPath), 'type') === 'epic';
      if (!isEpic) {
        const flatNotePath = findCard(cardsRoot, member);
        if (flatNotePath) {
          sliceCount++;
          untrackedCheck(null, member, flatNotePath);
        } else {
          epicCount++;
          unprojectable.push({
            epic: member,
            error: 'board member has neither an epic scaffold nor a note',
            remedy: BOARD_HEALTH_DRIFT_REMEDY,
          });
        }
        continue;
      }
      epicCount++;
      const boardDir = path.join(epicRoot, 'board');
      const epicBoardRaw = readText(path.join(boardDir, `${member}-board.md`));
      const parsedEpicBoard = parseBoard(epicBoardRaw);
      const sliceNames = BOARD_HEALTH_LANES.flatMap((lane) => parsedEpicBoard[lane] || []);
      sliceCount += sliceNames.length;
      for (const name of sliceNames) untrackedCheck(member, name, path.join(boardDir, `${name}.md`));
      // Check 2 — the epic must project through the real contract, seeded with
      // its first existing slice note (the projection validates every member).
      const seed = sliceNames.find((name) => exists(path.join(boardDir, `${name}.md`)));
      if (seed) {
        const seedPath = path.join(boardDir, `${seed}.md`);
        const surface = canonicalEpicProjection(readText(seedPath), seedPath, boardPath, cardsRoot, { state: { cards } });
        // Check 4 — derived slice roll-up vs painted parent lane. Ledger-driven,
        // so an empty/absent ledger contributes nothing here. Agreement is
        // reported too whenever the epic carries untracked members: a lane that
        // LOOKS broken but is correct must say so, or the confusion survives.
        if (ledger === 'present' && surface) {
          const lifecycle = deriveEpicProjection(surface, null, null);
          const mapping = epicProjectionMapping(lifecycle.state);
          const painted = boardCardLocation(parentRaw, member);
          const agrees = Boolean(painted && mapping
            && painted.column === mapping.column && painted.checked === mapping.complete);
          if (!agrees || untracked.some((finding) => finding.epic === member)) {
            laneDivergence.push({
              epic: member,
              derived: lifecycle.state,
              painted: painted ? painted.column : null,
              agrees,
            });
          }
        }
      }
    } catch (err) {
      unprojectable.push({ epic: member, error: err.message, remedy: BOARD_HEALTH_DRIFT_REMEDY });
    }
  }
  // Check 3 — binding drift + orphan sub-board lines, reused verbatim from the
  // heal planner so the sweep and the remedy can never disagree. A throw here
  // is itself a finding: the sweep's own failures must never look like health.
  let bindingDrift;
  try {
    const plan = planEpicBindingHeal(cardsRoot, boardPath);
    bindingDrift = {
      atlases: plan.atlases.length,
      slices: plan.slices.length,
      orphan_lines: plan.orphanLines.length,
      remedy: BOARD_HEALTH_DRIFT_REMEDY,
    };
  } catch (err) {
    bindingDrift = { error: `binding-drift plan is unreadable: ${err.message}`, remedy: BOARD_HEALTH_DRIFT_REMEDY };
  }
  // Check 5 — records carrying projection_error. Ledger-driven by nature, so
  // an empty/absent ledger contributes zero findings (skipped, not failed).
  const projectionErrors = ledger === 'present'
    ? Object.values(cards)
      .filter((record) => record.projection_error)
      .map((record) => ({ card: record.card, phase: record.phase, error: record.projection_error }))
    : [];
  const findings = {
    untracked_members: untracked,
    unprojectable_epics: unprojectable,
    binding_drift: bindingDrift,
    lane_divergence: laneDivergence,
    projection_errors: projectionErrors,
  };
  const driftClean = !bindingDrift.error
    && !bindingDrift.atlases && !bindingDrift.slices && !bindingDrift.orphan_lines;
  return {
    project: path.posix.basename(project.prefix),
    ledger,
    checked: { epics: epicCount, slices: sliceCount, records: Object.keys(cards).length },
    findings,
    healthy: driftClean && Object.entries(findings)
      .every(([key, value]) => key === 'binding_drift' || !value.length),
  };
}

async function commandBoardHealth(ctx, args, deps = {}) {
  if (args.json !== true) throw new Error('board-health requires --json for a machine-readable receipt');
  const boardPath = deps.boardPath || BOARD;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const exists = deps.exists || fs.existsSync;
  const loadState = deps.readState || readState;
  const transitionLock = deps.withLock || withLock;
  return transitionLock(ctx, 'selector', async () => {
    const state = loadState(ctx);
    const records = Object.keys((state && state.cards) || {}).length;
    // Tri-state so a clean ledgerless run can never be mistaken for a fully
    // checked board: present ⇒ checks 4–5 ran; empty/absent ⇒ they were
    // skipped, not failed.
    const ledger = records > 0
      ? 'present'
      : (ctx.statePath && exists(ctx.statePath) ? 'empty' : 'absent');
    const { healthy, ...core } = collectBoardHealth(state, {
      boardPath, cardsRoot, ledger, exists, readText: deps.readText,
    });
    return successReceipt('board-health', { no_op: healthy, ...core });
  }, { staleMs: 60 * 60 * 1000 });
}

// Read-only supersession-depth probe: how many prior supersessions already lead
// into --card. Lets loop:run / loop:execute fail-fast at the second-refutation
// step — escalate to the Director instead of minting a successor the discard
// circuit-breaker would then refuse (which would leave an orphaned successor).
function commandSupersessionDepth(ctx, args, deps = {}) {
  const card = String(args.card || '').trim();
  if (!card) throw new Error('supersession-depth requires --card');
  const loadState = deps.readState || readState;
  const depth = supersessionChainDepth(card, loadState(ctx));
  const limit = supersessionDepthLimit();
  return successReceipt('supersession-depth', {
    no_op: true, card, depth, limit, at_limit: Boolean(limit) && depth >= limit,
  });
}

async function commandDiscard(ctx, args, deps = {}) {
  // GA-OPS10 F2 precedent: the machine-readable contract is required before
  // any read or write, so refusal here precedes every lock and state load.
  if (args.json !== true) throw new Error('discard requires --json for a machine-readable receipt');
  const operands = discardOperands(args);
  const d = resolveDiscardDeps(deps);
  const gate = { card: operands.card, staleMs: 60 * 60 * 1000 };
  return d.transitionLock(ctx, 'selector',
    async () => withCardGateLock(ctx, operands.card, async () => {
      // Supersession-depth circuit-breaker: a fresh supersession (--superseded-by)
      // whose lineage is already at the registry ceiling is refused BEFORE any
      // write. It escalates to the Director instead of minting the Nth successor,
      // breaking the accreting-1:1 runaway. Only commandDiscard enforces this;
      // reap discards call discardCardCore directly, so corpse cleanup of an
      // already-settled deep chain is never blocked.
      const depthLimit = supersessionDepthLimit();
      if (operands.supersededBy && depthLimit) {
        const depth = supersessionChainDepth(operands.card, d.loadState(ctx));
        if (depth >= depthLimit) {
          return {
            action: 'awaiting_user_decision', card: operands.card, no_op: true,
            reason: 'supersession_depth_exceeded',
            supersession_depth: depth, supersession_depth_limit: depthLimit,
            remediation: `${operands.card} sits at supersession depth ${depth} (>= ${depthLimit}); this lineage has been superseded ${depth}x without converging, so the slice is mis-scoped. Decompose it into independently mergeable slices, or make an explicit scope decision — do not supersede 1:1 again.`,
          };
        }
      }
      const result = await discardCardCore(ctx, operands, d);
      if (result.no_op) return result;
      const station = await attemptLoopStationProjection(ctx, d.loadState(ctx), 'discard', {
        projectLoopStation: d.stationProject, boardPath: d.boardPath, cardsRoot: d.cardsRoot,
      });
      return { ...result, loop_station: station.receipt };
    }, gate, d.transitionLock),
    gate);
}

// --- Superseded-corpse inference, ported from scripts/autoloop/delivery-review-triage.js.
// The coordinator owns the canonical answer; the triage skill repoints here (Task 7).

// The first whitespace-delimited token is the card id (e.g. "GA-C9a2").
function cardIdToken(cardName) {
  return String(cardName || '').trim().split(/\s+/)[0] || '';
}

// Strip a trailing supersession suffix: a lowercase letter + optional digits
// ("a", "b", "a2", "c"). "GA-C9a2" → "GA-C9"; "GA-OPS11a" → "GA-OPS11".
function stemOf(cardName) {
  const id = cardIdToken(cardName);
  const m = id.match(/^(.*?)([a-z]\d*)$/);
  return m ? m[1] : id;
}

function supersessionStatusIsDeployed(status) {
  return status === 'deployed' || status === 'completed';
}

// A settled card X is a superseded corpse when some OTHER tracked card Y is
// deployed AND shares X's stem AND its name marks it as the successor
// ("supersedes" or "final value-review completion").
function deployedSupersedingSibling(card, tracked) {
  const stem = stemOf(card.card);
  if (!stem) return null;
  const selfId = cardIdToken(card.card);
  return (tracked || []).find((y) => {
    if (cardIdToken(y.card) === selfId) return false;
    if (!supersessionStatusIsDeployed(y.status)) return false;
    if (stemOf(y.card) !== stem) return false;
    return /supersedes|final value-review completion/i.test(y.card);
  }) || null;
}

function hasDeployedSupersedingSibling(card, tracked) {
  return Boolean(deployedSupersedingSibling(card, tracked));
}

// One lazy predicate owns both read-only status detection and reap healing:
// a discarded ledger record whose resolved card note still exists. Laziness
// preserves reap's per-item check after each prior deletion.
function* tombstoneResidue(state, cardsRoot = CARDS_ROOT, exists = fs.existsSync) {
  const discarded = Object.values((state && state.cards) || {})
    .filter((record) => record.phase === 'discarded')
    .sort((a, b) => String(a.card).localeCompare(String(b.card)));
  for (const record of discarded) {
    const notePath = resolveCardPath(record.card_path, record.card, cardsRoot);
    if (!notePath || !exists(notePath)) continue;
    yield { card: record.card, path: notePath, heal: 'reap' };
  }
}

// Board-line grammar for the reap sweep: a checkbox line whose first wikilink
// is the card it targets, optionally trailed by a planning-stub annotation
// ("(decomposed → …)" / "(docs-only → …)").
const REAP_BOARD_LINE = /^\s*- \[[ xX]\] \[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;

// Never String.replace here: card names can contain $-specials. The kept
// prefix is the captured checkbox + wikilink, byte-exact.
function stubAnnotationParts(line) {
  const m = line.match(/^(\s*- \[[ xX]\] \[\[[^\]]+\]\])\s*\((?:decomposed|docs-only)\b/);
  if (!m) return null;
  const children = [...line.slice(m[1].length).matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]
    .map((match) => match[1]);
  return { kept: m[1], children };
}

const REAP_DISCARDABLE_PHASES = new Set(['parked', 'blocked', 'failed', 'cancelled']);

async function commandReap(ctx, args, deps = {}) {
  // Same contract as discard: the machine-readable receipt is required before
  // any read or write, so refusal here precedes every lock and state load.
  if (args.json !== true) throw new Error('reap requires --json for a machine-readable receipt');
  const alsoNames = args.also == null ? [] : [...new Set(argumentValues(args.also))];
  if (args.also != null && !alsoNames.length) throw new Error('--also values must be non-empty card names');
  const d = resolveDiscardDeps(deps);
  const staleMs = 60 * 60 * 1000;
  return d.transitionLock(ctx, 'selector', async () => {
    const discardOne = (operands, boardOverride) => withCardGateLock(
      ctx, operands.card,
      () => discardCardCore(ctx, operands, boardOverride ? { ...d, boardPath: boardOverride } : d),
      { card: operands.card, staleMs }, d.transitionLock,
    );
    let state = d.loadState(ctx);
    // Explicit --also refusal precedes every write: same refusal set as discard,
    // and every name must resolve (tracked record, card note, or board line) so
    // a typo can never abort the batch mid-run after corpse discards landed.
    let alsoBoardRaw = null;
    for (const name of alsoNames) {
      const record = state.cards[name];
      if (record && record.phase !== 'discarded' && !REAP_DISCARDABLE_PHASES.has(record.phase)) {
        throw new Error(`reap refuses ${record.phase === 'deployed' ? 'deployed' : 'active in-flight'} work; ${name} is ${record.phase}`);
      }
      if (record || findCard(d.cardsRoot, name)) continue;
      if (alsoBoardRaw == null) {
        try { alsoBoardRaw = fs.readFileSync(d.boardPath, 'utf8'); } catch (_) { alsoBoardRaw = ''; }
      }
      if (boardCardLocation(alsoBoardRaw, name)) continue;
      throw new Error(`reap cannot resolve --also card ${name}; no tracked record, card note, or board line exists`);
    }
    const receipt = {
      action: 'reaped', no_op: true, boards: [],
      corpses: [], stub_parents: [], also: [],
      annotations_stripped: [], duplicates_removed: [],
      residue_lines_removed: [], residue_notes_deleted: [], residue_notes_refused: [],
    };

    // (1)+(2) Corpse set from the ledger via the ported triage inference: a
    // settled record whose deployed stem-sibling names itself the successor.
    const trackedView = Object.values(state.cards || {}).map((record) => ({ card: record.card, status: record.phase }));
    for (const record of Object.values(state.cards || {})) {
      if (!REAP_DISCARDABLE_PHASES.has(record.phase)) continue;
      const successor = deployedSupersedingSibling({ card: record.card }, trackedView);
      if (!successor) continue;
      receipt.corpses.push(await discardOne({
        card: record.card, reason: 'reaped: superseded corpse (deployed successor)',
        supersededBy: successor.card, carriedFixtures: [],
      }));
    }

    // (6) Explicitly listed names ride the same per-card discard core. A name
    // already tombstoned when this pass reaches it (this run's corpse pass, or
    // an earlier discard with its own reason) is skipped, never re-routed into
    // the core with a fresh reason — that non-literal replay throw would brick
    // every identical re-run.
    state = d.loadState(ctx);
    for (const name of alsoNames) {
      const listed = state.cards[name];
      if (listed && listed.phase === 'discarded') {
        receipt.also.push({ card: name, no_op: true, skipped: 'already discarded' });
        continue;
      }
      receipt.also.push(await discardOne({
        card: name, reason: 'reaped: explicitly listed via --also',
        supersededBy: null, carriedFixtures: [],
      }));
    }

    // Board sweep set: the parent board, every resolvable epic board, and every
    // tracked record's projected epic board.
    state = d.loadState(ctx);
    const boards = new Map();
    const addBoard = (target) => {
      if (target && fs.existsSync(target)) boards.set(path.resolve(target), target);
    };
    addBoard(d.boardPath);
    let parentRaw = '';
    try { parentRaw = fs.readFileSync(d.boardPath, 'utf8'); } catch (_) {}
    try {
      for (const epic of resolveEpicBoardSet({ parentBoardMd: parentRaw, cardsRoot: d.cardsRoot }).epics) {
        addBoard(epic.board_path);
      }
    } catch (_) {}
    for (const record of Object.values(state.cards || {})) {
      if (!record.card_path) continue;
      const rel = path.relative(path.resolve(d.cardsRoot), path.resolve(record.card_path));
      const segments = rel.split(path.sep);
      if (!rel.startsWith('..') && segments.length === 3 && segments[1] === 'board') {
        addBoard(path.join(d.cardsRoot, segments[0], 'board', `${segments[0]}-board.md`));
      }
    }
    receipt.boards = [...boards.values()];

    // A stub child is settled when its ledger record is tombstoned or deployed,
    // or a swept board checks it Completed.
    const completedAnywhere = new Set();
    for (const sweptPath of boards.values()) {
      try {
        for (const name of parseCheckedColumn(fs.readFileSync(sweptPath, 'utf8'), 'Completed')) completedAnywhere.add(name);
      } catch (_) {}
    }
    const childSettled = (child) => {
      const record = state.cards[child];
      if (record && (record.phase === 'discarded' || record.phase === 'deployed')) return true;
      return completedAnywhere.has(child);
    };
    // A parent is a non-claimable planning container when it was never tracked
    // and carries no valid execution contract.
    const carriesExecutionContract = (name) => {
      const notePath = findCard(d.cardsRoot, name);
      if (!notePath) return false;
      try {
        return validateExecutionMeta(parseExecutionMeta(fs.readFileSync(notePath, 'utf8'), name)).length === 0;
      } catch (_) { return false; }
    };

    for (const sweptPath of boards.values()) {
      // (3a) Settled planning containers are discarded outright through the core.
      for (const line of fs.readFileSync(sweptPath, 'utf8').split('\n')) {
        const stub = stubAnnotationParts(line);
        if (!stub || !stub.children.length) continue;
        const target = line.match(REAP_BOARD_LINE);
        if (!target) continue;
        const name = target[1];
        if (state.cards[name] || !stub.children.every(childSettled) || carriesExecutionContract(name)) continue;
        receipt.stub_parents.push(await discardOne({
          card: name, reason: 'reaped: settled planning container (every child tombstoned or completed)',
          supersededBy: null, carriedFixtures: [],
        }, sweptPath));
        state = d.loadState(ctx);
      }
      // (3b) strip surviving annotations, (4) dedupe, (5) heal residual tombstone lines.
      const raw = fs.readFileSync(sweptPath, 'utf8');
      const seen = new Set();
      const kept = [];
      let changed = false;
      for (const line of raw.split('\n')) {
        const target = line.match(REAP_BOARD_LINE);
        if (!target) { kept.push(line); continue; }
        const name = target[1];
        const record = state.cards[name];
        if (record && record.phase === 'discarded') {
          receipt.residue_lines_removed.push({ board: sweptPath, card: name });
          changed = true;
          continue;
        }
        if (seen.has(name)) {
          receipt.duplicates_removed.push({ board: sweptPath, card: name });
          changed = true;
          continue;
        }
        seen.add(name);
        const stub = stubAnnotationParts(line);
        if (stub) {
          receipt.annotations_stripped.push({ board: sweptPath, card: name });
          kept.push(stub.kept);
          changed = true;
          continue;
        }
        kept.push(line);
      }
      // A mid-sweep abort after this write is safe: the write is converged state, and an identical replay heals the remainder.
      if (changed) d.writeText(sweptPath, kept.join('\n'));
    }

    // (5) Tombstone note residue: same lstat + containment guards as discard,
    // enforced per item. A corrupt entry is refused loudly in the receipt but
    // never aborts the batch — an abort would lose the whole receipt, and the
    // persistent corrupt entry would make every future reap throw.
    for (const residue of tombstoneResidue(state, d.cardsRoot)) {
      const record = state.cards[residue.card];
      const notePath = residue.path;
      try {
        const entry = fs.lstatSync(notePath);
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new Error(`reap residue note for ${record.card} must be one regular non-symlink file`);
        }
        physicalDescendant(d.cardsRoot, notePath, `reap residue note ${record.card}`);
        fs.unlinkSync(notePath);
        receipt.residue_notes_deleted.push({ card: record.card, path: notePath });
      } catch (err) {
        receipt.residue_notes_refused.push({ card: record.card, residue_note: 'refused', reason: err.message });
      }
    }

    receipt.no_op = receipt.corpses.every((item) => item.no_op)
      && receipt.stub_parents.every((item) => item.no_op)
      && receipt.also.every((item) => item.no_op)
      && !receipt.annotations_stripped.length && !receipt.duplicates_removed.length
      && !receipt.residue_lines_removed.length && !receipt.residue_notes_deleted.length;
    if (!receipt.no_op) {
      const station = await attemptLoopStationProjection(ctx, d.loadState(ctx), 'reap', {
        projectLoopStation: d.stationProject, boardPath: d.boardPath, cardsRoot: d.cardsRoot,
      });
      receipt.loop_station = station.receipt;
    }
    return receipt;
  }, { staleMs });
}

// --- Restructure: sanctioned flat-to-epic board migration (BGR §4). ---
// One durable intent journal is written before the first mutation; every write
// is content-addressed (preimage hash + intended bytes) so a crashed pass
// resumes forward only where targets are still the recorded preimage or the
// intended result, and fails closed on any third state.

const RESTRUCTURE_STALE_MS = 60 * 60 * 1000;

// Epic/slice NOTE schema version, mirroring the shipped project-blueprint
// templates (Template, Epic.md / Slice Card.md, the entity-create manifest)
// and the committed epic-fixture — all 1.1.0. NOTE the convention split: this
// is the project-blueprint note schema, NOT the Delivery execution-card
// contract version — card-intake stamps execution cards with
// delivery.CONTRACT_VERSION (currently 1.2.0). The two are separate version
// spaces that share one frontmatter key name; if they are ever unified, the
// SSOT (blueprint manifest vs delivery registry) must be decided explicitly.
const RESTRUCTURE_NOTE_SCHEMA_VERSION = '1.1.0';

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function restructureChromeBlock(widget) {
  return '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });\n```';
}

function loadRestructureSpec(specPath) {
  let raw;
  try { raw = fs.readFileSync(specPath, 'utf8'); }
  catch (err) { throw new Error(`restructure cannot read --spec: ${err.message}`); }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) { throw new Error(`restructure --spec must be valid JSON: ${err.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('restructure --spec must be a JSON object');
  }
  const projectRoot = typeof parsed.project_root === 'string' ? parsed.project_root.trim() : '';
  const board = typeof parsed.board === 'string' ? parsed.board.trim() : '';
  if (!projectRoot) throw new Error('restructure --spec requires project_root');
  if (!board) throw new Error('restructure --spec requires board');
  if (!Array.isArray(parsed.epics) || !parsed.epics.length) {
    throw new Error('restructure --spec requires a non-empty epics array');
  }
  const safeName = (value) => typeof value === 'string' && value.trim()
    && !/[\\/]/.test(value) && value.trim() !== '.' && value.trim() !== '..' && !value.trim().endsWith('.md');
  const seenEpics = new Set();
  const seenMembers = new Set();
  const epics = parsed.epics.map((entry) => {
    const epic = entry && typeof entry.epic === 'string' ? entry.epic.trim() : '';
    if (!safeName(epic)) {
      throw new Error(`restructure refuses epic name ${JSON.stringify(entry && entry.epic)}; an epic name must be one safe note name`);
    }
    if (seenEpics.has(epic)) throw new Error(`restructure refuses: epic ${epic} is listed more than once in the spec`);
    seenEpics.add(epic);
    if (!entry || !Array.isArray(entry.members) || !entry.members.length) {
      throw new Error(`restructure --spec epic ${epic} requires a non-empty members array`);
    }
    const members = entry.members.map((member) => {
      const name = typeof member === 'string' ? member.trim() : '';
      if (!safeName(name)) {
        throw new Error(`restructure refuses member name ${JSON.stringify(member)} in epic ${epic}; a member must be one safe note name`);
      }
      if (seenMembers.has(name)) throw new Error(`restructure refuses: member ${name} is listed more than once in the spec`);
      seenMembers.add(name);
      return name;
    });
    return { epic, members };
  });
  return {
    project_root: path.resolve(projectRoot),
    board: path.isAbsolute(board) ? board : path.resolve(projectRoot, board),
    epics,
  };
}

function resolveRestructureDeps(ctx, deps = {}) {
  return {
    loadState: deps.readState || readState,
    persist: deps.writeState || writeState,
    transitionLock: deps.withLock || withLock,
    writeText: deps.writeText || atomicWriteText,
    now: deps.now || (() => new Date().toISOString()),
    journalPath: deps.journalPath
      || (ctx.stateDir ? path.join(ctx.stateDir, 'restructure-journal.json')
        : path.join(ctx.root, '.sauce-restructure-journal.json')),
  };
}

// Board lines whose FIRST wikilink is each card, counted with the shared
// checkbox grammar — used for the duplicate-member-line refusal.
function countBoardCardLines(md) {
  const counts = new Map();
  for (const line of String(md).split('\n')) {
    const match = line.match(REAP_BOARD_LINE);
    if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return counts;
}

// The parent-board rewrite for one epic: the epic's topmost member line becomes
// the single epic line; every other member line is removed. Never String.replace
// with card-derived text — card names can contain $-specials.
function restructureParentStage(parentRaw, epic, members, checked = false) {
  const raw = String(parentRaw);
  const lines = raw.split('\n');
  const indices = members.map((member) => {
    const location = boardCardLocation(raw, member);
    if (!location) throw new Error(`restructure refuses: member ${member} is absent from the parent board`);
    return location.line;
  });
  const anchor = Math.min(...indices);
  const drop = new Set(indices);
  const out = [];
  lines.forEach((line, index) => {
    if (index === anchor) { out.push(`- [${checked ? 'x' : ' '}] [[${epic}]]`); return; }
    if (drop.has(index)) return;
    out.push(line);
  });
  return out.join('\n');
}

// Full-frontmatter rewrite to the canonical slice binding while preserving the
// card's remaining metadata (status, depends_on, contract fields) and keeping
// the body below frontmatter byte-identical.
function restructureSliceContent(raw, card, epic, atlasRel, boardRel) {
  if (!frontmatter(raw)) throw new Error(`restructure refuses: member note for ${card} has no frontmatter`);
  return patchFrontmatter(raw, {
    type: 'slice',
    schema_version: RESTRUCTURE_NOTE_SCHEMA_VERSION,
    epic: `"[[${epic}]]"`,
    task_parent: atlasRel,
    source_board: boardRel,
    kanban_board: boardRel,
  });
}

function restructureAtlasContent({ epic, prefix, parentBoardBase, projectName, projectSlug, state, posture, nowIso }) {
  const lines = ['---', 'type: epic', `schema_version: ${RESTRUCTURE_NOTE_SCHEMA_VERSION}`, `created_at: ${nowIso}`];
  if (projectName) lines.push(`project: "[[${projectName}]]"`);
  if (projectSlug) lines.push(`project_slug: ${projectSlug}`);
  if (projectName) lines.push(`project_name: ${projectName}`);
  lines.push(
    `source_board: ${prefix}/${parentBoardBase}`,
    `kanban_board: ${prefix}/${parentBoardBase}`,
    `status: ${state}`,
    `epic_board: ${prefix}/tasks/${epic}/board/${epic}-board.md`,
    `posture: ${posture}`,
    'docs: []',
    'tags:', '  - epic',
    '---', '',
    restructureChromeBlock('ProjectChromeBar'), '',
    restructureChromeBlock('EpicDashboard'), '',
  );
  return lines.join('\n');
}

function restructureEpicBoardContent({ epic, prefix, projectName, projectSlug, memberLines, nowIso }) {
  const settings = JSON.stringify({
    'kanban-plugin': 'board',
    'list-collapse': [false, false, false, false],
    'mark-cards-complete': true,
    'new-note-folder': `${prefix}/tasks/${epic}/board`,
    'new-note-template': 'ranch/templates/Template, Slice Card.md',
  });
  return [
    '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic', `epic: "[[${epic}]]"`,
    ...(projectSlug ? [`project_slug: ${projectSlug}`] : []),
    ...(projectName ? [`project_name: ${projectName}`] : []),
    `created_at: ${nowIso}`, 'tags:', '  - epic-board', '---', '',
    restructureChromeBlock('ProjectChromeBar'), '',
    '## In Planning', '', ...memberLines, '',
    '## In Progress', '', '## Blocked', '', '## Completed', '',
    '%% kanban:settings', '```', settings, '```', '%%', '',
  ].join('\n');
}

// A spec epic is "applied" when the canonical epic surface exists with every
// spec member bound and the parent board carries the epic line but no member
// lines — the structural literal-replay signal.
function restructureEpicApplied(epicSpec, boardPath, cardsRoot, parentRaw) {
  const { epic, members } = epicSpec;
  const boardDir = path.join(cardsRoot, epic, 'board');
  const firstTarget = path.join(boardDir, `${members[0]}.md`);
  if (!fs.existsSync(path.join(cardsRoot, epic, `${epic}.md`)) || !fs.existsSync(firstTarget)) return false;
  for (const member of members) {
    if (!fs.existsSync(path.join(boardDir, `${member}.md`))) return false;
    if (boardCardLocation(parentRaw, member)) return false;
  }
  if (!boardCardLocation(parentRaw, epic)) return false;
  try {
    const surface = canonicalEpicProjection(
      fs.readFileSync(firstTarget, 'utf8'), firstTarget, boardPath, cardsRoot, { currentCard: members[0] },
    );
    return Boolean(surface) && members.every((member) => surface.members.includes(member));
  } catch (_) { return false; }
}

// Refusals + the full deterministic intent, computed BEFORE the first mutation.
function planRestructure(spec, env) {
  const {
    parentRaw, prefix, cardsRoot, boardPath, state, nowIso, specDigest,
  } = env;
  const projectName = scalarField(parentRaw, 'project_name');
  const projectSlug = scalarField(parentRaw, 'project_slug');
  const parentBoardBase = path.basename(boardPath);
  const memberLineCounts = countBoardCardLines(parentRaw);
  let parentStagePrior = parentRaw;
  const epics = spec.epics.map((epicSpec) => {
    const { epic, members } = epicSpec;
    if (fs.existsSync(path.join(cardsRoot, epic))
      || findCard(cardsRoot, epic)
      || boardCardLocation(parentRaw, epic)) {
      throw new Error(`restructure refuses: epic ${epic} collides with an existing note path or board line`);
    }
    const atlasRel = path.posix.join(prefix, 'tasks', epic, `${epic}.md`);
    const boardRel = path.posix.join(prefix, 'tasks', epic, 'board', `${epic}-board.md`);
    const epicRoot = path.join(cardsRoot, epic);
    const boardDir = path.join(epicRoot, 'board');
    const moves = members.map((card) => {
      const location = boardCardLocation(parentRaw, card);
      if (!location) throw new Error(`restructure refuses: member ${card} is absent from the parent board`);
      if ((memberLineCounts.get(card) || 0) > 1) {
        throw new Error(`restructure refuses: member ${card} appears more than once on the parent board`);
      }
      const from = findCard(cardsRoot, card);
      if (!from) throw new Error(`restructure refuses: member ${card} has no note under the project tasks root`);
      const entry = fs.lstatSync(from);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(`restructure refuses: member note for ${card} must be one regular non-symlink file`);
      }
      physicalDescendant(cardsRoot, from, `restructure member note ${card}`);
      const raw = fs.readFileSync(from, 'utf8');
      const record = state.cards && state.cards[card];
      if (record && record.phase === 'discarded') {
        throw new Error(`restructure refuses: member ${card} is a discarded tombstone`);
      }
      const trackedMapping = record && projectionMapping(record.phase);
      return {
        card,
        from,
        to: path.join(boardDir, `${card}.md`),
        tracked: Boolean(record),
        preimage_sha256: sha256Text(raw),
        content: restructureSliceContent(raw, card, epic, atlasRel, boardRel),
        status: trackedMapping ? trackedMapping.status : (scalarField(raw, 'status') || 'planning'),
        dependencies: parseDependsOn(raw).map(normalizeCardLink),
        checked: location.checked,
      };
    });
    const siblings = new Set(moves.map((move) => normalizeCardLink(move.card)));
    const lifecycle = delivery.deriveEpicLifecycle(moves.map((move) => ({
      card: move.card,
      status: move.status,
      cross_epic_dependency: move.dependencies.some((dependency) => !siblings.has(dependency)),
    })));
    const atlasPath = path.join(epicRoot, `${epic}.md`);
    const epicBoardPath = path.join(boardDir, `${epic}-board.md`);
    const scaffolds = [
      { path: path.join(epicRoot, 'context', 'runs', '.keep'), content: '' },
      { path: path.join(epicRoot, 'context', 'lessons', '.keep'), content: '' },
      { path: path.join(epicRoot, 'context', 'decisions', '.keep'), content: '' },
      {
        path: atlasPath,
        content: restructureAtlasContent({
          epic, prefix, parentBoardBase, projectName, projectSlug,
          state: lifecycle.state, posture: lifecycle.posture, nowIso,
        }),
      },
      {
        path: epicBoardPath,
        content: restructureEpicBoardContent({
          epic, prefix, projectName, projectSlug, nowIso,
          memberLines: moves.map((move) => `- [${move.checked ? 'x' : ' '}] [[${move.card}]]`),
        }),
      },
    ];
    const stageContent = restructureParentStage(parentStagePrior, epic, members, lifecycle.state === 'done');
    const parentStage = { prior_sha256: sha256Text(parentStagePrior), content: stageContent };
    parentStagePrior = stageContent;
    return {
      epic,
      state: lifecycle.state,
      posture: lifecycle.posture,
      atlas: atlasPath,
      board: epicBoardPath,
      scaffolds,
      moves: moves.map(({ card, from, to, tracked, preimage_sha256, content }) => ({
        card, from, to, tracked, preimage_sha256, content,
      })),
      parent_stage: parentStage,
    };
  });
  return {
    schema_version: 1,
    created_at: nowIso,
    spec_digest: specDigest,
    spec,
    project_root: spec.project_root,
    board: boardPath,
    cards_root: cardsRoot,
    prefix,
    epics,
    completed: false,
  };
}

function restructureThirdState(target) {
  return new Error(`restructure fail-closed: ${target} is neither the recorded preimage nor the intended result`);
}

// Containment for journal-supplied TARGET paths, symmetric with the
// physicalDescendant source guard: resolve through the nearest existing
// ancestor so a tampered or corrupted journal can never write outside the
// physical cards root, even for paths that do not exist yet.
function physicalDescendantTarget(root, target, label) {
  const physicalRoot = fs.realpathSync(root);
  let existing = path.resolve(target);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const resolved = path.join(fs.realpathSync(existing), ...suffix);
  if (resolved === physicalRoot || !resolved.startsWith(`${physicalRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its physical root`);
  }
  return resolved;
}

function applyIntendedWrite(op, journal, d) {
  physicalDescendantTarget(journal.cards_root, op.path, `restructure scaffold target ${path.basename(op.path)}`);
  const current = fs.existsSync(op.path) ? fs.readFileSync(op.path, 'utf8') : null;
  if (current === op.content) return false;
  if (current !== null) throw restructureThirdState(op.path);
  fs.mkdirSync(path.dirname(op.path), { recursive: true });
  d.writeText(op.path, op.content);
  return true;
}

async function rebindTrackedCardPath(ctx, move, d) {
  if (!move.tracked) return;
  await withCardGateLock(ctx, move.card, async () => {
    const state = d.loadState(ctx);
    const record = state.cards[move.card];
    if (!record) throw new Error(`restructure fail-closed: tracked member ${move.card} record disappeared mid-pass`);
    if (record.card_path === move.to) return;
    record.card_path = move.to;
    d.persist(ctx, state, record);
  }, { card: move.card, staleMs: RESTRUCTURE_STALE_MS }, d.transitionLock);
}

async function applyIntendedMove(ctx, move, journal, d) {
  physicalDescendantTarget(journal.cards_root, move.to, `restructure member target ${move.card}`);
  const guardSourceIsPreimage = () => {
    const entry = fs.lstatSync(move.from);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`restructure fail-closed: source note for ${move.card} must be one regular non-symlink file`);
    }
    physicalDescendant(journal.cards_root, move.from, `restructure member note ${move.card}`);
    const raw = fs.readFileSync(move.from, 'utf8');
    if (sha256Text(raw) !== move.preimage_sha256) throw restructureThirdState(move.from);
    return raw;
  };
  const targetCurrent = fs.existsSync(move.to) ? fs.readFileSync(move.to, 'utf8') : null;
  if (targetCurrent === move.content) {
    // Crash landed between the target write and the source unlink — or the
    // move fully completed. Never delete a source that drifted from its preimage.
    if (fs.existsSync(move.from)) {
      guardSourceIsPreimage();
      fs.unlinkSync(move.from);
    }
    await rebindTrackedCardPath(ctx, move, d);
    return;
  }
  if (targetCurrent !== null) throw restructureThirdState(move.to);
  if (!fs.existsSync(move.from)) throw restructureThirdState(move.from);
  guardSourceIsPreimage();
  fs.mkdirSync(path.dirname(move.to), { recursive: true });
  d.writeText(move.to, move.content);
  await rebindTrackedCardPath(ctx, move, d);
  fs.unlinkSync(move.from);
}

function applyParentStage(journal, index, d) {
  const stage = journal.epics[index].parent_stage;
  const current = fs.readFileSync(journal.board, 'utf8');
  if (current === stage.content) return;
  if (sha256Text(current) !== stage.prior_sha256) throw restructureThirdState(journal.board);
  d.writeText(journal.board, stage.content);
}

async function executeRestructure(ctx, journal, d, opts = {}) {
  const receiptEpics = [];
  for (let index = 0; index < journal.epics.length; index++) {
    const plan = journal.epics[index];
    for (const scaffold of plan.scaffolds) applyIntendedWrite(scaffold, journal, d);
    for (const move of plan.moves) await applyIntendedMove(ctx, move, journal, d);
    applyParentStage(journal, index, d);
    // Build then verify: the built surface must satisfy the canonical epic
    // validator before the pass moves to the next epic.
    const firstMove = plan.moves[0];
    let surface;
    try {
      surface = canonicalEpicProjection(
        fs.readFileSync(firstMove.to, 'utf8'), firstMove.to, journal.board, journal.cards_root,
        { currentCard: firstMove.card },
      );
    } catch (err) {
      throw new Error(`restructure fail-closed: built epic ${plan.epic} is not canonical: ${err.message}`);
    }
    const missing = plan.moves.map((move) => move.card).filter((card) => !surface.members.includes(card));
    if (missing.length) {
      throw new Error(`restructure fail-closed: built epic ${plan.epic} is missing members ${missing.join(', ')}`);
    }
    receiptEpics.push({
      epic: plan.epic, state: plan.state, posture: plan.posture,
      atlas: plan.atlas, board: plan.board,
      members: plan.moves.map((move) => ({
        card: move.card, from: move.from, to: move.to, tracked: move.tracked,
      })),
    });
  }
  return {
    action: 'restructured', no_op: false, resumed: Boolean(opts.resumed),
    spec_digest: journal.spec_digest,
    project_root: journal.project_root, board: journal.board,
    epics: receiptEpics,
    parent: {
      path: journal.board,
      epic_lines_added: journal.epics.map((plan) => plan.epic),
      member_lines_removed: journal.epics.reduce((total, plan) => total + plan.moves.length, 0),
    },
    journal: d.journalPath,
  };
}

function readRestructureJournal(journalPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    return parsed && parsed.schema_version === 1 ? parsed : null;
  } catch (_) { return null; }
}

async function restructureCore(ctx, spec, d) {
  const projectRoot = spec.project_root;
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error('restructure --spec project_root must be an existing project directory');
  }
  const boardPath = spec.board;
  if (!fs.existsSync(boardPath)) throw new Error('restructure --spec board must be an existing parent board file');
  if (path.dirname(fs.realpathSync(boardPath)) !== fs.realpathSync(projectRoot)) {
    throw new Error('restructure --spec board must live directly inside project_root');
  }
  const cardsRoot = path.join(projectRoot, 'tasks');
  if (!fs.existsSync(cardsRoot)) throw new Error('restructure requires <project_root>/tasks to exist');
  const prefix = physicalProjectPrefix(cardsRoot).prefix;
  const parentRaw = fs.readFileSync(boardPath, 'utf8');
  const state = d.loadState(ctx);
  const specDigest = sha256Text(JSON.stringify(spec));
  const appliedCount = spec.epics
    .filter((epicSpec) => restructureEpicApplied(epicSpec, boardPath, cardsRoot, parentRaw)).length;
  let journal = readRestructureJournal(d.journalPath);
  if (appliedCount === spec.epics.length) {
    // Literal replay of a completed restructure: zero vault writes.
    if (journal && journal.spec_digest === specDigest && journal.completed !== true) {
      journal.completed = true;
      journal.completed_at = d.now();
      atomicWriteJson(d.journalPath, journal);
      durablePathBarrier(d.journalPath);
    }
    return {
      action: 'restructured', no_op: true, resumed: false, spec_digest: specDigest,
      project_root: projectRoot, board: boardPath,
      epics: spec.epics.map((epicSpec) => ({
        epic: epicSpec.epic, applied: true,
        members: epicSpec.members.map((card) => ({ card })),
      })),
      journal: d.journalPath,
    };
  }
  let resumed = false;
  if (journal && journal.spec_digest === specDigest && journal.completed !== true) {
    resumed = true;
  } else {
    if (appliedCount > 0) {
      throw new Error('restructure fail-closed: the spec is partially applied without a matching intent journal');
    }
    if (journal && journal.completed !== true && journal.spec_digest !== specDigest) {
      throw new Error('restructure fail-closed: a different restructure intent journal is mid-flight; inspect it before continuing');
    }
    journal = planRestructure(spec, {
      parentRaw, prefix, cardsRoot, boardPath, state, nowIso: d.now(), specDigest,
    });
    // Durable intent BEFORE the first mutation.
    atomicWriteJson(d.journalPath, journal);
    durablePathBarrier(d.journalPath);
  }
  const receipt = await executeRestructure(ctx, journal, d, { resumed });
  journal.completed = true;
  journal.completed_at = d.now();
  atomicWriteJson(d.journalPath, journal);
  durablePathBarrier(d.journalPath);
  return receipt;
}

async function commandRestructure(ctx, args, deps = {}) {
  // Same contract as discard/reap: the machine-readable receipt is required
  // before any read or write, so refusal here precedes every lock and read.
  if (args.json !== true) throw new Error('restructure requires --json for a machine-readable receipt');
  if (typeof args.spec !== 'string' || !args.spec.trim()) throw new Error('restructure requires --spec <map.json>');
  const d = resolveRestructureDeps(ctx, deps);
  const spec = loadRestructureSpec(args.spec.trim());
  return d.transitionLock(ctx, 'selector', () => restructureCore(ctx, spec, d), { staleMs: RESTRUCTURE_STALE_MS });
}

async function commandClaim(ctx, args, deps = {}) {
  const now = deps.now || (() => new Date().toISOString());
  const mintLeaseToken = deps.leaseToken || (() => crypto.randomUUID());
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  return withLock(ctx, 'selector', async () => {
    if (fs.existsSync(path.join(ctx.root, '.autoloop-halt'))) {
      return successReceipt('halted', { no_op: true, reason: '.autoloop-halt present' });
    }
    const state = readState(ctx);
    const boardMd = fs.readFileSync(BOARD, 'utf8');
    const selected = selectCoordinatorCandidate({
      boardMd, state,
      loadCard: (card) => { const p = findCard(CARDS_ROOT, card); return p ? { path: p, raw: fs.readFileSync(p, 'utf8') } : null; },
      // A direct coordinator claim is the supervised operator path. Future
      // batch callers use the pure selector without this capability.
      supervised: true,
    });
    if (selected.action !== 'claim' || args['dry-run']) {
      return successReceipt(selected.action, { no_op: true, ...selected });
    }
    const slug = slugify(selected.card);
    const branch = `codex-autoloop/${slug}`;
    const worktree = path.join(ctx.root, '.worktrees', `codex-autoloop-${slug}`);
    sh('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: ctx.root });
    const record = {
      card: selected.card, parent_card: selected.meta.parentCard || null, slice: selected.meta.slice || null,
      phase: 'claimed', model_profile: selected.meta.modelProfile,
      batch_policy: selected.meta.batchPolicy || null,
      touch_zones: selected.meta.touchZones, dependencies: selected.meta.dependencies,
      deploy_subscriptions: selected.meta.deploySubscriptions, card_path: selected.cardPath,
      delivery_contract_version: selected.meta.contractVersion,
      delivery_contract_source: selected.meta.contractSource,
      delivery_contract_migration: selected.meta.contractMigration
        ? { applied: selected.meta.contractMigration.applied, manual: selected.meta.contractMigration.manual } : null,
      ...(selected.meta.contractSource === 'current' ? { delivery_contract: selected.meta.contract } : {}),
      branch, worktree, claimed_at: new Date().toISOString(),
    };
    acquireLease(record, { now, token: mintLeaseToken() });
    state.cards[selected.card] = record;
    writeState(ctx, state, record);
    try {
      sh('git', ['worktree', 'add', '-b', branch, worktree, 'origin/main'], { cwd: ctx.root, stdio: 'pipe' });
    } catch (err) {
      record.phase = 'needs-inspection'; record.reason = `worktree creation failed: ${err.message}`; writeState(ctx, state, record);
      throw err;
    }
    record.phase = 'implementing';
    await attemptProjection(ctx, record, BOARD, { state });
    writeState(ctx, state, record);
    const station = await attemptLoopStationProjection(ctx, state, 'claim');
    return successReceipt('implement', {
      ...record, skipped: selected.skipped,
      lease_token: record.lease.token,
      lease: leaseSummary(record.lease, leaseNowMs()),
      loop_station: station.receipt,
    });
  });
}

function recordReviewOperands(args) {
  const card = args.card; const lens = args.lens; const verdict = args.verdict;
  const summary = String(args.summary || '').trim();
  const expectedHead = Array.isArray(args['expected-head']) ? '' : String(args['expected-head'] || '').trim();
  const limitationFlagPresent = args['accepted-limitation'] != null;
  const acceptedLimitation = args['accepted-limitation'] === true;
  const rawBounds = Array.isArray(args.bound) ? args.bound : (args.bound == null ? [] : [args.bound]);
  const malformedLimitationOperand = (limitationFlagPresent && !acceptedLimitation)
    || rawBounds.some((item) => typeof item !== 'string' || !item.trim());
  const bound = rawBounds.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (!card || !REVIEW_LENSES.includes(lens)) {
    usage('record-review-refused', 'invalid_arguments',
      `record-review requires --card and --lens ${REVIEW_LENSES.join('|')}`);
  }
  if (!['pass', 'refute'].includes(verdict)) {
    usage('record-review-refused', 'invalid_arguments', 'record-review requires --verdict pass|refute');
  }
  if (summary.length < 20) {
    usage('record-review-refused', 'invalid_arguments',
      'record-review requires a specific --summary of at least 20 characters');
  }
  if (!EXACT_SHA.test(expectedHead)) {
    usage('record-review-refused', 'invalid_arguments',
      'record-review requires --expected-head as one exact lowercase 40-hex SHA');
  }
  if (malformedLimitationOperand || acceptedLimitation !== (bound.length > 0)) {
    refuse('record-review-refused', 'invalid_limitation',
      'record-review --accepted-limitation requires one or more --bound names, and --bound requires --accepted-limitation');
  }
  if (acceptedLimitation && verdict !== 'pass') {
    refuse('record-review-refused', 'invalid_limitation',
      'record-review accepted limitations require --verdict pass');
  }
  return {
    card, lens, verdict, summary, expectedHead, acceptedLimitation, bound,
  };
}

async function commandRecordReview(ctx, args, deps = {}) {
  requireJson(args, 'record-review');
  requireOnlyOptions(args, 'record-review', STRICT_CLI_OPTIONS['record-review']);
  const {
    card, lens, verdict, summary, expectedHead, acceptedLimitation, bound,
  } = recordReviewOperands(args);
  const loadState = deps.readState || readState;
  const run = deps.sh || sh;
  const persist = deps.writeState || writeState;
  const gateLock = deps.withLock || withLock;
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) refuse('record-review-refused', 'card_not_claimed', `card ${card} is not claimed`);
    requireLeaseToken(record, args, 'record-review', leaseNowMs());
    if (!record.worktree || !fs.existsSync(record.worktree)) {
      refuse('record-review-refused', 'worktree_missing', `worktree is missing for ${card}`);
    }
    if (!['implementing', 'feature_pr'].includes(record.phase)) {
      refuse('record-review-refused', 'phase_ineligible',
        `reviews are closed for ${card} in phase ${record.phase}`);
    }
    const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    if (expectedHead && expectedHead !== headSha) {
      refuse('record-review-refused', 'head_mismatch',
        `record-review expected HEAD ${expectedHead} but worktree is ${headSha}`);
    }
    const limitation = acceptedLimitation ? { bound } : null;
    const prior = record.reviews && record.reviews[lens];
    if (prior && prior.head_sha === headSha) {
      const literalReplay = prior.verdict === verdict && prior.summary === summary
        && JSON.stringify(prior.accepted_limitation || null) === JSON.stringify(limitation);
      if (!literalReplay) {
        refuse('record-review-refused', 'literal_replay_mismatch',
          `review ${lens} at ${headSha} accepts only literal replay of its settled operands`);
      }
      return successReceipt('review-recorded', {
        no_op: true, card, lens, verdict, head_sha: headSha,
        ...(limitation ? { accepted_limitation: limitation } : {}),
      });
    }
    record.gate_receipt = null;
    record.reviews = { ...(record.reviews || {}), [lens]: {
      lens, verdict, refuted: verdict === 'refute', summary, head_sha: headSha, recorded_at: new Date().toISOString(),
      ...(limitation ? { accepted_limitation: limitation } : {}),
    } };
    persist(ctx, state, record);
    return successReceipt('review-recorded', {
      card, lens, verdict, head_sha: headSha,
      ...(limitation ? { accepted_limitation: limitation } : {}),
    });
  }, { card, staleMs: 60 * 60 * 1000 }, gateLock);
}

async function commandVerifyGates(ctx, args, deps = {}) {
  const card = args.card;
  if (!card) throw new Error('verify-gates requires --card');
  const loadState = deps.readState || readState;
  const run = deps.sh || sh;
  const persist = deps.writeState || writeState;
  const runSelfInstall = deps.runIsolatedWorkshopSelfInstall || runIsolatedWorkshopSelfInstall;
  const gateLock = deps.withLock || withLock;
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) throw new Error(`card ${card} is not claimed`);
    requireLeaseToken(record, args, 'verify-gates', leaseNowMs());
    if (!record.worktree || !fs.existsSync(record.worktree)) throw new Error(`worktree is missing for ${card}`);
    const dirty = run('git', ['status', '--short'], { cwd: record.worktree });
    if (dirty) throw new Error(`worktree is not clean: ${dirty.split('\n')[0]}`);
    const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    const baseRef = 'origin/main';
    run('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: record.worktree, stdio: 'pipe' });
    const baseSha = run('git', ['rev-parse', baseRef], { cwd: record.worktree });
    const prospectiveTitle = run('git', ['show', '-s', '--format=%s', headSha], { cwd: record.worktree, stdio: 'pipe' });
    assertReleasableTitle(prospectiveTitle);
    const paths = run('git', ['diff', '--name-only', `${baseSha}...${headSha}`], { cwd: record.worktree }).split('\n').map((s) => s.trim()).filter(Boolean);
    const outside = paths.filter((file) => !pathCoveredByTouchZones(file, record.touch_zones));
    if (outside.length) throw new Error(`diff exceeds declared touch zones: ${outside.join(', ')}`);

    // Merge-only bindings (empty deployment vault list) verify with the
    // installed gate script (absolute sibling — the worktree has no
    // scripts/autoloop) and the binding's own verify commands instead of the
    // sauce release preflights/self-install. Deploy-bound bindings (the
    // default) are byte-identical to the historical path.
    const deployVaults = deps.deployVaults || VAULTS;
    const mergeOnly = deployVaults.length === 0;
    const gateEnv = deps.env || process.env;

    const receipt = {
      status: 'fail', reason: 'gate verification did not finish', head_sha: headSha,
      base_ref: baseRef, base_sha: baseSha, prospective_pr_title: prospectiveTitle, paths,
      checks: {}, reviews: {}, started_at: new Date().toISOString(),
      ...(mergeOnly ? { merge_only: true } : {}),
    };
    try {
      const adequacyText = mergeOnly
        ? run('node', [path.join(__dirname, 'gate.js'), 'verify-adequacy', '--base', baseSha, '--cwd', record.worktree, '--json'], { cwd: record.worktree })
        : run('node', ['scripts/autoloop/gate.js', 'verify-adequacy', '--base', baseSha, '--json'], { cwd: record.worktree });
      const adequacy = JSON.parse(adequacyText);
      receipt.behavioral = adequacy.behavioral === true;
      receipt.adequacy = adequacy;
      if (adequacy.adequate !== true) throw new Error(`Gate B adequacy failed: ${adequacy.reason}`);
      receipt.checks.adequacy = 'pass';

      if (receipt.behavioral) {
        const reviews = record.reviews || {};
        const selected = REVIEW_LENSES.map((lens) => reviews[lens]).filter((review) => review && review.head_sha === headSha);
        const panel = gateVerdict({ adequacy, votes: selected });
        if (panel.gate !== 'pass') throw new Error(panel.reason);
        receipt.reviews = Object.fromEntries(selected.map((review) => [review.lens, review]));
        receipt.review_panel = panel;
      }

      if (mergeOnly) {
        let verifyCommands = [];
        if (gateEnv.SAUCE_LOOP_VERIFY_COMMANDS) {
          let parsed;
          try { parsed = JSON.parse(gateEnv.SAUCE_LOOP_VERIFY_COMMANDS); } catch (e) {
            throw new Error(`SAUCE_LOOP_VERIFY_COMMANDS is not valid JSON: ${e.message}`);
          }
          if (!Array.isArray(parsed) || !parsed.every((c) => typeof c === 'string' && c.trim())) {
            throw new Error('SAUCE_LOOP_VERIFY_COMMANDS must be a JSON array of non-empty command strings');
          }
          verifyCommands = parsed;
        }
        for (const commandLine of verifyCommands) {
          run('/bin/sh', ['-c', commandLine], { cwd: record.worktree, stdio: 'pipe' });
        }
        receipt.checks.verify_commands = verifyCommands.length
          ? { status: 'pass', commands: verifyCommands }
          : { status: 'none-declared', note: 'protected CI checks gate the merge' };
      } else {
        run('npm', ['run', 'release:preflight'], { cwd: record.worktree, stdio: 'pipe' });
        receipt.checks.release_preflight = 'pass';
        runSelfInstall(ctx, headSha, baseSha, prospectiveTitle, run);
        receipt.checks.workshop_self_install = 'pass';
        run('npm', ['run', 'release:preflight-bumped'], { cwd: record.worktree, stdio: 'pipe' });
        receipt.checks.release_preflight_bumped = 'pass';
      }
      const finalDirty = run('git', ['status', '--short'], { cwd: record.worktree });
      const finalHead = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
      if (finalDirty || finalHead !== headSha) throw new Error('worktree or HEAD changed while gate verification was running');
      receipt.status = 'pass'; receipt.reason = 'all required gates passed for this commit'; receipt.completed_at = new Date().toISOString();
      record.gate_receipt = receipt;
      persist(ctx, state, record);
      return {
        action: 'gates-passed', card, head_sha: headSha, base_sha: baseSha,
        prospective_pr_title: prospectiveTitle, behavioral: receipt.behavioral, checks: receipt.checks,
      };
    } catch (err) {
      receipt.reason = err.message; receipt.completed_at = new Date().toISOString();
      record.gate_receipt = receipt;
      persist(ctx, state, record);
      throw err;
    }
  }, { card, staleMs: 60 * 60 * 1000 }, gateLock);
}

async function commandRecordPr(ctx, args, deps = {}) {
  requireJson(args, 'record-pr');
  requireOnlyOptions(args, 'record-pr', STRICT_CLI_OPTIONS['record-pr']);
  const card = args.card; const number = Number(args.pr);
  if (!card || !Number.isInteger(number)) {
    usage('record-pr-refused', 'invalid_arguments', 'record-pr requires --card and numeric --pr');
  }
  const loadState = deps.readState || readState;
  const viewPr = deps.prView || prView;
  const run = deps.sh || sh;
  const persist = deps.writeState || writeState;
  const gateLock = deps.withLock || withLock;
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) refuse('record-pr-refused', 'card_not_claimed', `card ${card} is not claimed`);
    requireLeaseToken(record, args, 'record-pr', leaseNowMs());
    if (record.feature_pr != null) {
      if (record.feature_pr !== number) {
        refuse('record-pr-refused', 'literal_replay_mismatch',
          `record-pr for ${card} accepts only literal replay of PR ${record.feature_pr}`);
      }
      return successReceipt('recorded', {
        no_op: true, card, pr: number, phase: record.phase, url: record.feature_url,
      });
    }
    const pr = viewPr(REPO, number, ctx.root);
    if (pr.headRefName !== record.branch) {
      refuse('record-pr-refused', 'head_branch_mismatch',
        `PR head ${pr.headRefName} != recorded branch ${record.branch}`);
    }
    if (pr.baseRefName !== 'main') {
      refuse('record-pr-refused', 'base_branch_mismatch', `PR base ${pr.baseRefName} != main`);
    }
    if (!isReleasableTitle(pr.title)) {
      refuse('record-pr-refused', 'title_not_releasable',
        `PR title "${pr.title}" will not trigger a release`);
    }
    const dirty = run('git', ['status', '--short'], { cwd: record.worktree });
    if (dirty) refuse('record-pr-refused', 'worktree_dirty', `worktree is not clean: ${dirty.split('\n')[0]}`);
    const localHead = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    if (pr.headRefOid !== localHead) {
      refuse('record-pr-refused', 'head_mismatch', `PR head ${pr.headRefOid} != worktree HEAD ${localHead}`);
    }
    const gateStatus = gateReceiptStatus(record, localHead, pr.baseRefOid);
    if (!gateStatus.valid) {
      refuse('record-pr-refused', 'gate_invalid', `record-pr refused: ${gateStatus.reason}`);
    }
    if (pr.title !== record.gate_receipt.prospective_pr_title) {
      refuse('record-pr-refused', 'title_mismatch',
        `PR title "${pr.title}" != gate-verified prospective title "${record.gate_receipt.prospective_pr_title}"`);
    }
    record.feature_pr = number; record.feature_url = pr.url; record.phase = 'feature_pr'; record.pr_recorded_at = new Date().toISOString();
    persist(ctx, state, record);
    return successReceipt('recorded', { card, pr: number, phase: record.phase, url: pr.url });
  }, { card, staleMs: 60 * 60 * 1000 }, gateLock);
}

async function commandAdvance(ctx, args, deps = {}) {
  const card = args.card; if (!card) throw new Error('advance requires --card');
  const lease = Math.min(DEFAULT_LEASE_SECONDS, Math.max(0, Number(args['lease-seconds'] || DEFAULT_LEASE_SECONDS)));
  const poll = Math.max(5, Number(args['poll-seconds'] || DEFAULT_POLL_SECONDS));
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const gateLock = deps.withLock || withLock;
  const step = deps.stepCard || stepCard;
  const emit = deps.emit || ((value) => process.stdout.write(`${JSON.stringify(value)}\n`));
  const selectorLock = deps.selectorLock || deps.withLock || withLock;
  const leaseNowMs = deps.leaseNowMs || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + lease * 1000;
  let last = '';
  while (true) {
    if (fs.existsSync(path.join(ctx.root, '.autoloop-halt'))) {
      const halted = { action: 'halted', card, reason: '.autoloop-halt present' };
      emit(halted); return halted;
    }
    let transitionedTo = null;
    let result = await withCardGateLock(ctx, card, async () => {
      const state = loadState(ctx); const record = state.cards[card];
      if (!record) throw new Error(`card ${card} not in state`);
      // Arbitrate the lease on EVERY poll iteration, inside the card-gate
      // lock — not just the first pass. A mid-poll break-lease + foreign
      // attach must abort this loop with the appropriate refusal instead of
      // silently continuing to step (and eventually writeState-stomping) a
      // record now owned by a different holder.
      requireLeaseToken(record, args, 'advance', leaseNowMs());
      const priorPhase = record.phase;
      const stepped = await step(ctx, state, record, { dryRun: Boolean(args['dry-run']) });
      if (!args['dry-run'] && record.phase !== priorPhase) transitionedTo = record.phase;
      // Dry-run is a preview call — never durably release a lease on its
      // behalf, even when the (already-terminal) record's phase happens to
      // satisfy TERMINAL. Mirrors the transitionedTo gate immediately above.
      if (!args['dry-run'] && TERMINAL.has(record.phase)) {
        // clearLease is a no-op on an unleased record (returns false) — only
        // persist the extra write when there was actually a lease to release,
        // so unleased advance calls stay byte-identical to pre-lease behavior.
        const released = clearLease(record, 'lease_released_terminal', () => new Date(leaseNowMs()).toISOString());
        if (released) persist(ctx, state, record);
      }
      return stepped;
    }, { card, staleMs: 60 * 60 * 1000 }, gateLock);
    if (transitionedTo) {
      const station = await selectorLock(ctx, 'selector', async () => attemptLoopStationProjection(
        ctx, loadState(ctx), transitionedTo === 'deployed' ? 'deploy' : 'advance',
        {
          projectLoopStation: deps.projectLoopStation,
          boardPath: deps.boardPath,
          cardsRoot: deps.cardsRoot,
        },
      ));
      result = { ...result, loop_station: station.receipt };
    }
    const fingerprint = JSON.stringify(result);
    if (fingerprint !== last) { emit(result); last = fingerprint; }
    if (!['waiting', 'phase-change'].includes(result.action) || lease === 0) return result;
    if (Date.now() >= deadline) {
      const receipt = { action: 'waiting', card, phase: loadState(ctx).cards[card].phase, lease_expired: true, resume: `advance --card ${card}` };
      emit(receipt); return receipt;
    }
    await sleep(Math.min(poll * 1000, Math.max(0, deadline - Date.now())));
  }
}

function commandStatus(ctx, opts = {}) {
  const nowMs = (opts.leaseNowMs || (() => Date.now()))();
  const state = opts.state || readState(ctx); const active = activeRecords(state);
  const parked = Object.values(state.cards || {}).filter((record) => record.phase === 'parked');
  const tracked = Object.values(state.cards || {}).filter((record) => projectionMapping(record.phase));
  const discarded = Object.values(state.cards || {}).filter((record) => record.phase === 'discarded');
  const cardsRoot = opts.cardsRoot || CARDS_ROOT;
  const residue = [...tombstoneResidue(state, cardsRoot, opts.exists || fs.existsSync)];
  const boardPath = opts.boardPath || BOARD;
  const boardMd = opts.boardMd ?? fs.readFileSync(boardPath, 'utf8');
  const loadCard = opts.loadCard || ((card) => {
    const p = findCard(CARDS_ROOT, card);
    return p ? { path: p, raw: fs.readFileSync(p, 'utf8') } : null;
  });
  const next = summarizeClaimSelection(selectCoordinatorCandidate({
    boardMd, state, loadCard, supervised: opts.supervised !== false,
    epicShadow: opts.epicShadow ?? process.env.SAUCE_EPIC_SELECTION_SHADOW === '1',
    cardsRoot,
    readFile: opts.readFile, readDir: opts.readDir, exists: opts.exists,
    loadEpicCard: opts.loadEpicCard,
  }), nowMs);
  const savedProjectionProblems = Object.values(state.cards || {})
    .filter((record) => record.projection_error)
    .map((record) => ({ card: record.card, phase: record.phase, error: record.projection_error }));
  const detectedMetadataProblems = Object.values(state.cards || {})
    .map((record) => projectionMetadataProblem(record, cardsRoot))
    .filter(Boolean);
  const projectionProblems = [...savedProjectionProblems, ...detectedMetadataProblems];
  const boardDrift = [];
  const boardDriftKeys = new Set();
  for (const record of Object.values(state.cards || {})) {
    const detected = projectionBoardDrift(boardMd, record, {
      boardPath: opts.boardPath || BOARD, cardsRoot, state,
      allFindings: true,
    });
    for (const finding of Array.isArray(detected) ? detected : [detected]) {
      if (!finding) continue;
      const key = JSON.stringify([finding.card, finding.epic, finding.phase, finding.issue, finding.reconcile]);
      if (boardDriftKeys.has(key)) continue;
      boardDriftKeys.add(key);
      boardDrift.push(finding);
    }
  }
  return {
    action: 'status', halted: fs.existsSync(path.join(ctx.root, '.autoloop-halt')),
    active: active.map((r) => ({
      card: r.card, phase: r.phase, status: (projectedRecordMapping(r, cardsRoot) || {}).status || null,
      model_profile: r.model_profile, batch_policy: r.batch_policy || null, branch: r.branch, pr: r.feature_pr || null,
      lease: leaseSummary(r.lease, nowMs),
    })),
    parked: parked.map((r) => {
      const ratification = ratificationStatus(r, state, {
        boardPath,
        exists: opts.exists,
        readText: opts.readText,
      });
      return {
        card: r.card, phase: r.phase, status: 'parked', model_profile: r.model_profile, branch: r.branch,
        dependencies: r.dependencies || [], resume_condition: r.resume_condition || '',
        parked_at: r.parked_at || null, projection_error: r.projection_error || null,
        lease: leaseSummary(r.lease, nowMs),
        ...(ratification ? { ratification } : {}),
      };
    }),
    tracked: tracked.map((r) => ({
      card: r.card, phase: r.phase, status: projectedRecordMapping(r, cardsRoot).status,
      model_profile: r.model_profile, batch_policy: r.batch_policy || null,
    })),
    discarded_total: discarded.length,
    discarded_recent: [...discarded]
      .sort((a, b) => String(a.discarded_at || '').localeCompare(String(b.discarded_at || '')))
      .slice(-10).reverse()
      .map((record) => ({
        name: record.card, discarded_at: record.discarded_at || null,
        superseded_by: record.superseded_by || null, reason: record.discard_reason || null,
      })),
    ratified_recent: Object.values(state.cards || {})
      .filter((record) => record.ratification_receipt)
      .sort((a, b) => {
        const acceptedA = String(a.ratification_receipt.accepted_at || '');
        const acceptedB = String(b.ratification_receipt.accepted_at || '');
        const timeA = Date.parse(acceptedA);
        const timeB = Date.parse(acceptedB);
        if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeB - timeA;
        return acceptedB.localeCompare(acceptedA);
      })
      .slice(0, 20)
      .map((record) => ({
        card: record.card,
        authority: record.ratification_receipt.authority,
        at: record.ratification_receipt.accepted_at,
        artifact_path: record.ratification_receipt.artifact_path,
      })),
    tombstone_residue: residue,
    active_count: active.length, capacity: MAX_ACTIVE, available_slots: Math.max(0, MAX_ACTIVE - active.length),
    cutover: state.cutover || null,
    cutover_history: state.cutover_history || [],
    next, projection_problems: projectionProblems, board_drift: boardDrift, state_path: ctx.statePath,
  };
}

function ratificationStatus(record, state, deps = {}) {
  if (!isRatificationEscalation(record, state)) return null;
  const artifact = ratificationArtifactForCard(record.card, deps.boardPath || BOARD);
  const exists = deps.exists || fs.existsSync;
  if (!exists(artifact.absolute)) return {
    state: 'missing',
    artifact_path: artifact.relative,
    error: 'pending ratification artifact is missing',
  };
  const readText = deps.readText || ((target) => fs.readFileSync(target, 'utf8'));
  try {
    const raw = readText(artifact.absolute);
    const frontmatterErrors = ratificationFrontmatterErrors(raw, record.card, 'pending');
    const targetHead = ratificationTargetHead(record);
    const verdict = targetHead
      ? consumeRatificationArtifact(
        raw,
        artifact.sectionHeading,
        { artifact_path: artifact.relative },
        { target_card: record.card, target_head: targetHead, decision: 'accepted' },
      )
      : { errors: [{ message: 'parked escalation lacks an exact 40-hex gate HEAD' }] };
    const errors = [...frontmatterErrors, ...(verdict.errors || [])];
    return {
      state: scalarField(raw, 'state') || 'unknown',
      artifact_path: artifact.relative,
      ...(errors.length ? { error: errors[0].message } : {}),
    };
  } catch (err) {
    return {
      state: 'unreadable',
      artifact_path: artifact.relative,
      error: err.message,
    };
  }
}

const LOOP_STATION_SCHEMA_VERSION = '1.0.0';
const LOOP_STATION_LIST_CAP = 20;
// Scaffold-if-absent body only: existing station bodies are NEVER rewritten
// by the coordinator (that guarantee is asserted by run-codex-autoloop.js);
// existing stations gain the project-scope GraphView block via the install
// heal (platform/install.js applyLoopStationGraphHeal), not here.
const LOOP_STATION_BODY = [
  '',
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });',
  '```',
  '',
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "GraphView", args: [{ scope: "project" }] });',
  '```',
  '',
].join('\n');

function boundedStationList(items, cap = LOOP_STATION_LIST_CAP) {
  const values = Array.isArray(items) ? items : [];
  return { items: values.slice(0, cap), overflow_count: Math.max(0, values.length - cap) };
}

function loopStationEpic(record) {
  if (!record) return null;
  return normalizeCardLink(record.parent_card
    || (record.delivery_contract && record.delivery_contract.epic)
    || '') || null;
}

function loopStationWhy(item) {
  const raw = String((item && item.resume_condition) || '').trim();
  if (raw) return raw.slice(0, 500);
  if (item && item.bucket === 'coordinator-deadend') return 'Coordinator projection needs deterministic repair.';
  if (item && item.bucket === 'provisional-pending') return 'A provisional design amendment needs resolution.';
  return 'This item is outside the loop’s autonomous resume authority.';
}

function loopStationRatificationPath(stationPath, card, exists = fs.existsSync) {
  const id = cardIdToken(card);
  if (!id) return null;
  const artifact = path.join(path.dirname(stationPath), 'ratifications', `${id}.md`);
  if (!exists(artifact)) return null;
  const normalized = artifact.replace(/\\/g, '/');
  const marker = normalized.lastIndexOf('/spice/');
  const relative = marker >= 0 ? normalized.slice(marker + 1) : path.relative(path.dirname(stationPath), artifact).replace(/\\/g, '/');
  return relative.replace(/\.md$/i, '');
}

function recentLoopStationReleases(state) {
  const seen = new Set();
  return Object.values((state && state.cards) || {})
    .filter((record) => record.phase === 'deployed' && (record.required_version || record.brew_version))
    .sort((a, b) => String(b.deployed_at || '').localeCompare(String(a.deployed_at || '')))
    .map((record) => String(record.required_version || record.brew_version))
    .filter((version) => {
      if (seen.has(version)) return false;
      seen.add(version);
      return true;
    });
}

function buildLoopStationPayload({
  status, state, fidText = '', lastSeen = null, updatedOn, updatedAt,
  stationPath, exists = fs.existsSync, releases,
}) {
  const digest = deliveryStatusDigest.buildDigest(
    status, fidText, releases || recentLoopStationReleases(state), { lastSeen },
  );
  const cards = (state && state.cards) || {};
  const parkedByCard = new Map((status.parked || []).map((item) => [item.card, item]));
  const needsAll = digest.actionable.map((item) => {
    const parked = parkedByCard.get(item.card);
    const ratification = cards[item.card] && cards[item.card].ratification_receipt
      ? null
      : loopStationRatificationPath(stationPath, item.card, exists);
    return {
      card: item.card,
      epic: loopStationEpic(cards[item.card]),
      bucket: item.bucket,
      why: parked && parked.ratification && parked.ratification.error
        ? `ratification for ${item.card} is malformed: ${parked.ratification.error}`
        : loopStationWhy(item),
      ratification,
    };
  });
  const activeIds = new Set((status.active || []).map((item) => item.card));
  const trackedByCard = new Map((status.tracked || []).map((item) => [item.card, item]));
  const waitingAll = (status.parked || []).flatMap((parked) => {
    const enriched = { ...parked, ...(trackedByCard.get(parked.card) || {}) };
    const bucket = deliveryReviewTriage.classifyCard(enriched, {
      activeIds, tracked: status.tracked || [],
    });
    if (!['concurrency-wait', 'deploy-wait'].includes(bucket)) return [];
    return [{
      card: parked.card,
      epic: loopStationEpic(cards[parked.card]),
      bucket,
      why: loopStationWhy(enriched),
    }];
  });
  const needs = boundedStationList(needsAll);
  const waiting = boundedStationList(waitingAll);
  const discards = boundedStationList((digest.since && digest.since.discards) || []);
  const selfRatified = boundedStationList((digest.since && digest.since.self_ratified) || []);
  const cutoverFlips = boundedStationList((digest.since && digest.since.cutover_flips) || []);
  const ratified = boundedStationList((digest.since && digest.since.ratified) || []);
  const releaseList = boundedStationList(digest.releases || []);
  const residue = boundedStationList(status.tombstone_residue || []);
  const activeStatus = (status.active || [])[0] || null;
  const active = activeStatus ? {
    card: activeStatus.card,
    phase: activeStatus.phase,
    epic: loopStationEpic(cards[activeStatus.card]),
  } : null;
  const first = needs.items[0] || null;
  const exactAction = !first
    ? null
    : first.ratification
      ? `Ratify ${first.card} in [[${first.ratification}]] — ${first.why}`
      : `Review ${first.card} — ${first.why}`;
  return {
    type: 'loop-station',
    schema_version: LOOP_STATION_SCHEMA_VERSION,
    updated_at: updatedAt,
    updated_on: updatedOn,
    headline: deliveryStatusDigest.headline(digest),
    exact_action: exactAction,
    active,
    needs_attention: needs.items,
    needs_attention_overflow_count: needs.overflow_count,
    waiting: waiting.items,
    waiting_overflow_count: waiting.overflow_count,
    since: {
      marker_at: lastSeen,
      discards: discards.items,
      discards_overflow_count: discards.overflow_count,
      self_ratified: selfRatified.items,
      self_ratified_overflow_count: selfRatified.overflow_count,
      cutover_flips: cutoverFlips.items,
      cutover_flips_overflow_count: cutoverFlips.overflow_count,
      ratified: ratified.items,
      ratified_overflow_count: ratified.overflow_count,
    },
    releases_recent: releaseList.items,
    releases_recent_overflow_count: releaseList.overflow_count,
    tombstone_residue: residue.items,
    tombstone_residue_overflow_count: residue.overflow_count,
    counts: {
      needs_attention: needsAll.length,
      waiting: waitingAll.length,
      frozen: digest.noAction.frozen,
      done: digest.noAction.done,
      tombstone_residue: (status.tombstone_residue || []).length,
    },
  };
}

function validateLoopStationPayload(payload) {
  const errors = [];
  const required = [
    'type', 'schema_version', 'updated_at', 'updated_on', 'headline', 'exact_action',
    'active', 'needs_attention', 'needs_attention_overflow_count', 'waiting',
    'waiting_overflow_count', 'since', 'releases_recent', 'releases_recent_overflow_count',
    'tombstone_residue', 'tombstone_residue_overflow_count', 'counts',
  ];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(payload || {}, key)) errors.push(`missing ${key}`);
  }
  if (!payload || payload.type !== 'loop-station') errors.push('type must be loop-station');
  if (!payload || payload.schema_version !== LOOP_STATION_SCHEMA_VERSION) errors.push(`schema_version must be ${LOOP_STATION_SCHEMA_VERSION}`);
  if (!payload || typeof payload.updated_at !== 'string' || !Number.isFinite(Date.parse(payload.updated_at))) errors.push('updated_at must be an ISO timestamp');
  if (!payload || typeof payload.updated_on !== 'string' || !payload.updated_on.trim()) errors.push('updated_on must be a non-empty transition verb');
  if (!payload || typeof payload.headline !== 'string') errors.push('headline must be a string');
  if (payload && payload.exact_action !== null && typeof payload.exact_action !== 'string') errors.push('exact_action must be string|null');
  if (payload && payload.active !== null && (typeof payload.active !== 'object' || Array.isArray(payload.active))) errors.push('active must be object|null');
  const checkBounded = (value, overflow, label) => {
    if (!Array.isArray(value)) errors.push(`${label} must be an array`);
    else if (value.length > LOOP_STATION_LIST_CAP) errors.push(`${label} exceeds ${LOOP_STATION_LIST_CAP}`);
    if (!Number.isInteger(overflow) || overflow < 0) errors.push(`${label}_overflow_count must be a non-negative integer`);
  };
  checkBounded(payload && payload.needs_attention, payload && payload.needs_attention_overflow_count, 'needs_attention');
  checkBounded(payload && payload.waiting, payload && payload.waiting_overflow_count, 'waiting');
  checkBounded(payload && payload.releases_recent, payload && payload.releases_recent_overflow_count, 'releases_recent');
  checkBounded(payload && payload.tombstone_residue, payload && payload.tombstone_residue_overflow_count, 'tombstone_residue');
  if (!payload || !payload.since || typeof payload.since !== 'object' || Array.isArray(payload.since)) {
    errors.push('since must be an object');
  } else {
    checkBounded(payload.since.discards, payload.since.discards_overflow_count, 'since.discards');
    checkBounded(payload.since.self_ratified, payload.since.self_ratified_overflow_count, 'since.self_ratified');
    checkBounded(payload.since.cutover_flips, payload.since.cutover_flips_overflow_count, 'since.cutover_flips');
    checkBounded(payload.since.ratified, payload.since.ratified_overflow_count, 'since.ratified');
  }
  if (!payload || !payload.counts || typeof payload.counts !== 'object' || Array.isArray(payload.counts)) {
    errors.push('counts must be an object');
  } else {
    for (const key of ['needs_attention', 'waiting', 'frozen', 'done', 'tombstone_residue']) {
      if (!Number.isInteger(payload.counts[key]) || payload.counts[key] < 0) errors.push(`counts.${key} must be a non-negative integer`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function loopStationFrontmatterFields(payload) {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key, value === null ? 'null' : JSON.stringify(value),
  ]));
}

function projectLoopStation(ctx, state, updatedOn, deps = {}) {
  const boardPath = deps.boardPath || BOARD;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const stationPath = deps.stationPath || path.join(path.dirname(boardPath), 'Loop Station.md');
  const exists = deps.exists || fs.existsSync;
  const readText = deps.readText || ((target) => fs.readFileSync(target, 'utf8'));
  const writeText = deps.writeText || atomicWriteText;
  const now = deps.now || (() => new Date().toISOString());
  const updatedAt = now();
  const ratifications = scaffoldPendingRatifications(state, {
    boardPath,
    now: () => updatedAt,
    exists,
    writeText,
    ensureDir: deps.ensureDir,
    uuid: deps.uuid,
  });
  const status = deps.status || (() => {
    const boardMd = deps.boardMd ?? readText(boardPath);
    return commandStatus(ctx, {
      state, boardMd, boardPath, cardsRoot,
      exists,
      readText,
      loadCard: (card) => {
        const target = findCard(cardsRoot, card);
        return target ? { path: target, raw: readText(target) } : null;
      },
    });
  })();
  const fidPath = deps.fidPath || deliveryPaths().fid;
  const fidText = Object.prototype.hasOwnProperty.call(deps, 'fidText')
    ? deps.fidText
    : (exists(fidPath) ? readText(fidPath) : '');
  const markerPath = Object.prototype.hasOwnProperty.call(deps, 'markerPath')
    ? deps.markerPath
    : deliveryStatusDigest.markerPathFor(status);
  const lastSeen = Object.prototype.hasOwnProperty.call(deps, 'lastSeen')
    ? deps.lastSeen
    : (markerPath && exists(markerPath) ? readText(markerPath).trim() || null : null);
  const payload = buildLoopStationPayload({
    status, state, fidText, lastSeen, updatedOn, updatedAt, stationPath, exists,
    releases: deps.releases,
  });
  const validation = validateLoopStationPayload(payload);
  if (!validation.ok) throw new Error(`Loop Station payload is invalid: ${validation.errors.join('; ')}`);
  const fields = loopStationFrontmatterFields(payload);
  if (!exists(stationPath)) {
    if (deps.ensureDir) deps.ensureDir(path.dirname(stationPath));
    else fs.mkdirSync(path.dirname(stationPath), { recursive: true });
    const scaffold = patchFrontmatter(`---\n\n---${LOOP_STATION_BODY}`, fields);
    writeText(stationPath, scaffold);
    return { action: 'loop-station-projected', updated_on: updatedOn, changed: true, scaffolded: true, no_op: false, path: stationPath, payload, ratifications };
  }
  const raw = readText(stationPath);
  if (!/^---\n[\s\S]*?\n---/.test(raw)) {
    throw new Error('Loop Station exists without frontmatter; refusing to rewrite its body');
  }
  const priorUpdatedAt = scalarField(raw, 'updated_at');
  const stablePayload = {
    ...payload,
    updated_at: priorUpdatedAt && Number.isFinite(Date.parse(priorUpdatedAt))
      ? priorUpdatedAt
      : payload.updated_at,
  };
  const stableNext = patchFrontmatter(raw, loopStationFrontmatterFields(stablePayload));
  if (stableNext === raw) {
    return { action: 'loop-station-projected', updated_on: updatedOn, changed: false, scaffolded: false, no_op: true, path: stationPath, payload: stablePayload, ratifications };
  }
  const next = patchFrontmatter(raw, fields);
  writeText(stationPath, next);
  return { action: 'loop-station-projected', updated_on: updatedOn, changed: true, scaffolded: false, no_op: false, path: stationPath, payload, ratifications };
}

async function attemptLoopStationProjection(ctx, state, updatedOn, deps = {}) {
  const project = deps.projectLoopStation || projectLoopStation;
  try {
    const receipt = await project(ctx, state, updatedOn, {
      boardPath: deps.boardPath || BOARD,
      cardsRoot: deps.cardsRoot || CARDS_ROOT,
    });
    return { ok: true, receipt };
  } catch (err) {
    return {
      ok: false,
      receipt: {
        action: 'loop-station-projection-failed',
        updated_on: updatedOn,
        error: err.message,
      },
    };
  }
}

async function commandStatusLocked(ctx, opts = {}) {
  const lock = opts.withLock || withLock;
  return lock(ctx, 'selector', () => commandStatus(ctx, opts));
}

async function commandReconcile(ctx, args = {}, deps = {}) {
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const reconcileLock = deps.withLock || withLock;
  const boardPath = deps.boardPath || BOARD;
  const project = deps.projectCard || projectCard;
  const now = deps.now || (() => new Date().toISOString());
  const initialState = loadState(ctx);
  const cardNames = args.card ? [args.card] : Object.keys(initialState.cards || {});
  const results = [];
  for (const card of cardNames) {
    try {
      const legacyGateName = legacyCardGateLockName(card);
      const result = await withCardGateLock(ctx, card, async () => {
        const state = loadState(ctx);
        const record = state.cards[card];
        if (!record && args.card) {
          const cardsRoot = deps.cardsRoot || CARDS_ROOT;
          const cardPath = findCard(cardsRoot, card);
          if (!cardPath) {
            return { card, phase: null, ok: false, changed: false, error: 'exact-card reconciliation target is neither tracked nor a canonical slice' };
          }
          const cardRaw = fs.readFileSync(cardPath, 'utf8');
          const epic = normalizeCardLink(scalarField(cardRaw, 'epic'));
          if (scalarField(cardRaw, 'type') !== 'slice' || !epic
            || delivery.normalizeStatus(scalarField(cardRaw, 'status')) !== 'completed') {
            return { card, phase: null, ok: false, changed: false, error: 'untracked exact-card reconciliation is limited to completed canonical epic slices' };
          }
          const viaCandidate = Object.values(state.cards || {}).find((candidate) => {
            if (!projectionMapping(candidate.phase) || !candidate.card_path) return false;
            try {
              const candidatePath = resolveCardPath(candidate.card_path, candidate.card, cardsRoot);
              const candidateRaw = fs.readFileSync(candidatePath, 'utf8');
              return scalarField(candidateRaw, 'type') === 'slice'
                && normalizeCardLink(scalarField(candidateRaw, 'epic')) === epic;
            } catch (_) {
              return false;
            }
          });
          if (!viaCandidate) {
            return { card, epic, phase: null, ok: false, changed: false, error: 'legacy exact-card reconciliation requires one tracked canonical sibling' };
          }
          return withCardGateLock(ctx, viaCandidate.card, async () => {
            const lockedState = loadState(ctx);
            const via = lockedState.cards[viaCandidate.card];
            if (!via || !projectionMapping(via.phase) || !via.card_path) {
              return { card, epic, via_card: viaCandidate.card, phase: null, ok: false, changed: false, error: 'tracked canonical sibling changed before legacy reconciliation acquired its gate' };
            }
            try {
              const lockedViaPath = resolveCardPath(via.card_path, via.card, cardsRoot);
              const lockedViaRaw = fs.readFileSync(lockedViaPath, 'utf8');
              if (scalarField(lockedViaRaw, 'type') !== 'slice'
                || normalizeCardLink(scalarField(lockedViaRaw, 'epic')) !== epic) {
                return { card, epic, via_card: via.card, phase: null, ok: false, changed: false, error: 'tracked reconciliation sibling no longer belongs to the target canonical epic' };
              }
            } catch (err) {
              return { card, epic, via_card: via.card, phase: null, ok: false, changed: false, error: `tracked reconciliation sibling is unreadable: ${err.message}` };
            }
            return reconcileLock(ctx, 'completion-projection', async () => {
              const priorError = via.projection_error || null;
              const priorFailedAt = via.projection_failed_at || null;
              const projected = project(via.card_path, boardPath, via.card, via.phase, {
                now, record: via, state: lockedState, cardsRoot,
              });
              const findings = (projected.projection_findings || []).filter((finding) => finding.card === card);
              if (!findings.length) {
                return { card, epic, via_card: via.card, phase: null, ok: false, changed: false, error: 'legacy exact-card finding disappeared during reconciliation' };
              }
              const stateChanged = Boolean(priorError || priorFailedAt || !via.projection_reconciled_at || projected.changed);
              if (stateChanged) {
                delete via.projection_error;
                delete via.projection_failed_at;
                via.projection_reconciled_at = now();
                persist(ctx, lockedState, via);
              }
              return {
                card, epic, via_card: via.card, phase: null, ok: true,
                changed: Boolean(projected.changed || stateChanged),
                projection_changed: Boolean(projected.changed), state_changed: stateChanged,
                projection_findings: findings,
              };
            }, { card: via.card });
          }, { card: viaCandidate.card }, reconcileLock, legacyGateName);
        }
        if (!record) return { card, phase: null, ok: false, changed: false, error: 'tracked record disappeared during reconciliation' };
        if (!projectionMapping(record.phase)) {
          return { card: record.card, phase: record.phase, ok: true, changed: false, skipped: 'phase has no board projection' };
        }
        return reconcileLock(ctx, 'completion-projection', async () => {
          const priorError = record.projection_error || null;
          const priorFailedAt = record.projection_failed_at || null;
          try {
            const projected = project(record.card_path, boardPath, record.card, record.phase, {
              now, record, state, cardsRoot: deps.cardsRoot,
            });
            const stateChanged = Boolean(priorError || priorFailedAt || !record.projection_reconciled_at || projected.changed);
            if (stateChanged) {
              delete record.projection_error;
              delete record.projection_failed_at;
              record.projection_reconciled_at = now();
              persist(ctx, state, record);
            }
            return {
              card: record.card, phase: record.phase, ok: true,
              changed: Boolean(projected.changed || stateChanged),
              projection_changed: Boolean(projected.changed), state_changed: stateChanged,
              projection_findings: projected.projection_findings || [],
            };
          } catch (err) {
            const stateChanged = record.projection_error !== err.message || !record.projection_failed_at;
            record.projection_error = err.message;
            if (stateChanged) record.projection_failed_at = now();
            if (stateChanged) persist(ctx, state, record);
            return { card: record.card, phase: record.phase, ok: false, changed: stateChanged, error: err.message };
          }
        }, { card });
      }, { card }, reconcileLock);
      results.push(result);
    } catch (err) {
      results.push({ card, phase: null, ok: false, changed: false, error: `reconciliation lock failed: ${err.message}` });
    }
  }
  const failed = results.filter((result) => !result.ok);
  const changed = results.filter((result) => result.changed).length;
  const receipt = {
    action: failed.length ? 'reconcile-failed' : 'reconciled',
    scope: args.card ? 'card' : 'all-tracked', checked: results.length,
    changed, failed: failed.length, no_op: changed === 0 && failed.length === 0,
    results,
  };
  if (!args.card) {
    // ES5 cutover evidence: count consecutive FULL passes that found zero
    // drift and zero projection problems (i.e. nothing to change and nothing
    // failed). Any full pass that repaired or failed anything resets the
    // streak. Single-card passes never touch the counter.
    // Read-modify-write is unguarded; safe under the single-flight autoloop turn lock.
    const finalState = loadState(ctx);
    const prior = Number.isInteger(finalState.reconcile_clean_streak) ? finalState.reconcile_clean_streak : 0;
    const streak = receipt.no_op ? prior + 1 : 0;
    if (streak !== prior) {
      finalState.reconcile_clean_streak = streak;
      persist(ctx, finalState);
    }
    receipt.reconcile_clean_streak = streak;
  }
  return receipt;
}

// --- ES5 cutover: receipt-gated, reversible epic-intake flag (BGR §3.4).
//
// Usage:
//   cutover --json [--require-card '<exact name>']... [--chain-prefix <prefix>]
//   cutover --off --reason '<why>' --json
//
// Enable path: three deterministic criteria, each returning {ok, evidence|missing}:
//   1. es_chain_complete — every declared chain card is terminal-complete in
//      the ledger: phase 'deployed', or tombstoned 'discarded' (superseded ES
//      siblings are discarded under the reap law and never block cutover).
//      Declare the chain with repeatable --require-card '<exact name>' and/or
//      --chain-prefix <prefix>, which sweeps every ledger card whose id token
//      (first whitespace-delimited token, see cardIdToken) starts with the
//      prefix. A prefix matching zero ledger cards FAILS the criterion — a
//      typo must never pass vacuously. At least one operand is required.
//   2. migration_harness_registered — the repo package.json scripts still
//      invoke platform/test/run-codex-autoloop.js; de-registration breaks
//      cutover (running green is CI's job; registration is the local check).
//   3. reconcile_clean_streak — coordinator state records >= 3 consecutive
//      clean full reconciles (see commandReconcile's full-pass counter).
// All green: writes cutover {enabled:true, enabled_at, receipts} into
// coordinator state. Any red: returns action 'cutover-refused' listing EVERY
// unmet criterion, zero writes. Replay while enabled: {no_op:true}, zero
// writes. --off flips to {enabled:false, disabled_at, reason}; --off replay
// while disabled is a no_op; a later enable call re-evaluates the criteria.
// Every flip (enable and disable — never a no_op replay) also appends
// {enabled, at, reason?} to cutover_history, bounded to the 20 most recent
// entries, so digests can report flips between reads without latest-only loss.
const CUTOVER_HARNESS_PATH = 'platform/test/run-codex-autoloop.js';
const CUTOVER_STREAK_REQUIRED = 3;
const CUTOVER_HISTORY_CAP = 20;

function appendCutoverHistory(state, entry) {
  state.cutover_history = [...(state.cutover_history || []), entry].slice(-CUTOVER_HISTORY_CAP);
}

async function commandCutover(ctx, args, deps = {}) {
  // Same contract as discard/reap/restructure: the machine-readable receipt
  // is required before any read or write, so refusal precedes every lock.
  if (args.json !== true) throw new Error('cutover requires --json for a machine-readable receipt');
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const transitionLock = deps.withLock || withLock;
  const now = deps.now || (() => new Date().toISOString());
  if (args.off === true) {
    if (typeof args.reason !== 'string' || !args.reason.trim()) throw new Error('cutover --off requires a non-empty --reason');
    if (args['require-card'] != null || args['chain-prefix'] != null) {
      throw new Error('cutover --off never evaluates criteria; drop --require-card/--chain-prefix');
    }
    const reason = args.reason.trim();
    return transitionLock(ctx, 'selector', async () => {
      const state = loadState(ctx);
      if (!state.cutover || state.cutover.enabled !== true) {
        return { action: 'cutover', enabled: false, no_op: true, cutover: state.cutover || null };
      }
      const disabledAt = now();
      state.cutover = { enabled: false, disabled_at: disabledAt, reason };
      appendCutoverHistory(state, { enabled: false, at: disabledAt, reason });
      persist(ctx, state);
      const station = await attemptLoopStationProjection(ctx, state, 'cutover', {
        projectLoopStation: deps.projectLoopStation,
        boardPath: deps.boardPath,
        cardsRoot: deps.cardsRoot,
      });
      return {
        action: 'cutover', enabled: false, no_op: false, cutover: state.cutover,
        loop_station: station.receipt,
      };
    });
  }
  const requiredCards = args['require-card'] == null ? [] : argumentValues(args['require-card']);
  if (args['require-card'] != null && !requiredCards.length) throw new Error('--require-card values must be non-empty card names');
  const chainPrefix = typeof args['chain-prefix'] === 'string' && args['chain-prefix'].trim() ? args['chain-prefix'].trim() : null;
  if (args['chain-prefix'] != null && !chainPrefix) throw new Error('--chain-prefix requires a non-empty id-token prefix');
  if (!requiredCards.length && !chainPrefix) {
    throw new Error('cutover requires an explicit chain declaration: repeatable --require-card <exact name> and/or --chain-prefix <prefix>');
  }
  const readPackageJson = deps.readPackageJson
    || (() => JSON.parse(fs.readFileSync(path.join(ctx.root, 'package.json'), 'utf8')));
  return transitionLock(ctx, 'selector', async () => {
    const state = loadState(ctx);
    if (state.cutover && state.cutover.enabled === true) {
      return { action: 'cutover', enabled: true, no_op: true, cutover: state.cutover };
    }
    const criteria = {};
    {
      const cards = state.cards || {};
      const declared = new Map();
      for (const name of requiredCards) declared.set(name, cards[name] || null);
      const chainMatches = [];
      if (chainPrefix) {
        for (const record of Object.values(cards)) {
          if (!cardIdToken(record.card).startsWith(chainPrefix)) continue;
          chainMatches.push(record.card);
          if (!declared.has(record.card)) declared.set(record.card, record);
        }
      }
      const missing = [];
      const satisfied = [];
      for (const [name, record] of declared) {
        if (!record) missing.push({ card: name, problem: 'not tracked in the coordinator ledger' });
        // Ledger PHASES only — 'completed' is a card status vocabulary word, never a ledger phase, hence not listed.
        else if (record.phase === 'deployed' || record.phase === 'discarded') satisfied.push({ card: name, phase: record.phase });
        else missing.push({ card: name, phase: record.phase, problem: "phase is neither 'deployed' nor tombstoned 'discarded'" });
      }
      if (chainPrefix && !chainMatches.length) {
        missing.push({ chain_prefix: chainPrefix, problem: 'matches no ledger cards; refusing a vacuously-true chain criterion' });
      }
      criteria.es_chain_complete = missing.length
        ? { ok: false, missing }
        : { ok: true, evidence: { required_cards: requiredCards, chain_prefix: chainPrefix, chain_matches: chainMatches, satisfied } };
    }
    {
      let scripts = {};
      let problem = null;
      try { scripts = readPackageJson().scripts || {}; }
      catch (err) { problem = `package.json unreadable: ${err.message}`; }
      const entry = Object.entries(scripts).find(([, cmd]) => typeof cmd === 'string' && cmd.includes(CUTOVER_HARNESS_PATH));
      criteria.migration_harness_registered = entry
        ? { ok: true, evidence: { script: entry[0], harness: CUTOVER_HARNESS_PATH } }
        : { ok: false, missing: problem || `no package.json script invokes ${CUTOVER_HARNESS_PATH}` };
    }
    {
      const streak = Number.isInteger(state.reconcile_clean_streak) ? state.reconcile_clean_streak : 0;
      criteria.reconcile_clean_streak = streak >= CUTOVER_STREAK_REQUIRED
        ? { ok: true, evidence: { streak, required: CUTOVER_STREAK_REQUIRED } }
        : { ok: false, missing: `reconcile_clean_streak ${streak} < ${CUTOVER_STREAK_REQUIRED} consecutive clean full reconciles` };
    }
    const unmet = Object.entries(criteria).filter(([, criterion]) => !criterion.ok).map(([name]) => name);
    if (unmet.length) return { action: 'cutover-refused', enabled: false, unmet, criteria };
    const receipts = {};
    for (const [name, criterion] of Object.entries(criteria)) receipts[name] = criterion.evidence;
    const enabledAt = now();
    state.cutover = { enabled: true, enabled_at: enabledAt, receipts };
    appendCutoverHistory(state, { enabled: true, at: enabledAt });
    persist(ctx, state);
    const station = await attemptLoopStationProjection(ctx, state, 'cutover', {
      projectLoopStation: deps.projectLoopStation,
      boardPath: deps.boardPath,
      cardsRoot: deps.cardsRoot,
    });
    return {
      action: 'cutover', enabled: true, no_op: false, cutover: state.cutover,
      loop_station: station.receipt,
    };
  });
}

function recoveryRequest(args) {
  if (!args.card || typeof args.card !== 'string') throw new Error('recover-deployed requires exact --card');
  if (typeof args.reason !== 'string' || !args.reason.trim()) throw new Error('recover-deployed requires non-empty --reason');
  if (args.apply === true && args['dry-run'] === true) throw new Error('recover-deployed accepts only one of --apply or --dry-run');
  return {
    card: normalizeCardLink(args.card),
    expected_head: args['expected-head'],
    reason: args.reason.trim(),
  };
}

function sameRecoveryRequest(audit, request) {
  return Boolean(audit && sameJson(audit.request, request));
}

async function commandRecoverDeployed(ctx, args = {}, deps = {}) {
  const request = recoveryRequest(args);
  const apply = args.apply === true;
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const lock = deps.withLock || withLock;
  const collect = deps.collectDeployedRecoveryEvidence || collectDeployedRecoveryEvidence;
  const project = deps.attemptProjection || attemptProjection;
  const now = deps.now || (() => new Date().toISOString());
  const result = await withCardGateLock(ctx, request.card, async () => {
    const state = loadState(ctx);
    const record = state.cards[request.card];
    if (!record) throw new Error('recover-deployed requires a tracked card');
    if (record.batch_policy !== 'supervised_only') throw new Error('recover-deployed requires a supervised_only card');
    const priorAudits = Array.isArray(record.deployed_recoveries) ? record.deployed_recoveries : [];
    const priorAudit = priorAudits[priorAudits.length - 1] || null;
    const replay = record.phase === 'deployed' && sameRecoveryRequest(priorAudit, request);
    if (!replay && !RECOVER_DEPLOYED_PHASES.has(record.phase)) {
      throw new Error(`recover-deployed refuses phase ${record.phase || 'missing'}; parked and pre-PR cards are never recovery targets`);
    }
    const expectedHead = exactRecoveryHead(record, request.expected_head);
    const evidence = collect(ctx, record, expectedHead, deps);
    if (!apply) {
      return {
        action: 'recover-deployed-plan', card: record.card, phase: record.phase,
        apply_required: !replay, no_op: replay, request, evidence,
      };
    }
    if (replay) {
      return { action: 'recovered-deployed', card: record.card, phase: record.phase, no_op: true, request, evidence };
    }
    const audit = {
      request, prior_phase: record.phase, expected_head: expectedHead,
      evidence, recovered_at: now(),
    };
    record.deployed_recoveries = [...priorAudits, audit];
    record.feature_merge_sha = evidence.feature_pr.merge_sha;
    record.release_pr = evidence.release_pr.number;
    record.release_url = evidence.release_pr.url;
    record.release_merge_sha = evidence.release_pr.merge_sha;
    record.tag = evidence.tag;
    record.required_version = evidence.version;
    record.tap_pr = evidence.tap_pr.number;
    record.tap_url = evidence.tap_pr.url;
    record.brew_version = evidence.brew_version;
    record.vault_receipts = evidence.vault_receipts;
    record.phase = 'deployed';
    record.deployed_at = audit.recovered_at;
    clearLease(record, 'lease_cleared_supervised', now);
    persist(ctx, state, record);
    const projection = await project(ctx, record, deps.boardPath || BOARD, {
      projectCard: deps.projectCard, withLock: deps.projectionLock || deps.withLock,
      cardsRoot: deps.cardsRoot, now,
    });
    persist(ctx, state, record);
    return {
      action: projection.ok ? 'recovered-deployed' : 'recovered-deployed-projection-failed',
      card: record.card, phase: record.phase, no_op: false, request, evidence, projection,
    };
  }, { card: request.card }, lock);
  if (!apply || result.no_op) return result;
  const station = await lock(ctx, 'selector', async () => attemptLoopStationProjection(
    ctx, loadState(ctx), 'recover', {
      projectLoopStation: deps.projectLoopStation,
      boardPath: deps.boardPath,
      cardsRoot: deps.cardsRoot,
    },
  ));
  return { ...result, loop_station: station.receipt };
}

function metadataScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}

function metadataReconciliationPlan(record, raw, now = () => new Date().toISOString()) {
  if (!record || !METADATA_RECONCILE_PHASES.has(record.phase)) {
    throw new Error(`reconcile-metadata refuses phase ${(record && record.phase) || 'missing'}; active and parked cards are out of scope`);
  }
  const mapping = effectiveProjectionMapping(record, raw);
  const fields = {};
  if (scalarField(raw, 'kanban_column') !== mapping.column) fields.kanban_column = metadataScalar(mapping.column);
  if (delivery.normalizeStatus(scalarField(raw, 'status')) !== mapping.status) fields.status = metadataScalar(mapping.status);
  if (record.delivery_contract && record.delivery_contract.schema_version
    && scalarField(raw, 'schema_version') !== record.delivery_contract.schema_version) {
    fields.schema_version = metadataScalar(record.delivery_contract.schema_version);
  }
  if (record.batch_policy && scalarField(raw, 'batch_policy') !== record.batch_policy) {
    fields.batch_policy = metadataScalar(record.batch_policy);
  }
  if (Object.keys(fields).length && (fields.kanban_column || fields.status)) {
    fields.status_changed_at = metadataScalar(now());
  }
  const next = Object.keys(fields).length ? patchFrontmatter(raw, fields) : raw;
  if (!frontmatter(next)) throw new Error(`card ${record.card} frontmatter missing`);
  // A saved projection failure is evidence to repair, not authority to bypass
  // the stable-contract guard on this deliberately narrower operation.
  const remaining = projectionMetadataProblemFromRaw(record, next, { ignoreSavedProjectionError: true });
  if (remaining) throw new Error(`metadata-only repair cannot resolve this drift without widening scope: ${remaining.error}`);
  return {
    card: record.card,
    card_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    next_sha256: crypto.createHash('sha256').update(next).digest('hex'),
    changed_fields: Object.keys(fields),
    field_values: fields,
    changed: next !== raw,
    next,
  };
}

function metadataApplyRequest(card, args) {
  return {
    card,
    card_operand: String(args.card),
    reason: args.reason,
    expected_card_sha256: typeof args['expected-card-sha256'] === 'string' ? args['expected-card-sha256'] : null,
    apply: true,
    json: args.json === true,
  };
}

function validateMetadataPending(record, pending, request) {
  const hash = /^[0-9a-f]{64}$/;
  const allowed = new Set(['kanban_column', 'status', 'schema_version', 'batch_policy', 'status_changed_at']);
  if (!pending || pending.state !== 'prepared' || !pending.request
    || JSON.stringify(pending.request) !== JSON.stringify(request)
    || !hash.test(String(pending.card_sha256 || '')) || !hash.test(String(pending.next_sha256 || ''))
    || !Array.isArray(pending.changed_fields) || !pending.changed_fields.length
    || !pending.field_values || typeof pending.field_values !== 'object' || Array.isArray(pending.field_values)
    || pending.changed_fields.some((field) => !allowed.has(field) || typeof pending.field_values[field] !== 'string')
    || JSON.stringify(Object.keys(pending.field_values)) !== JSON.stringify(pending.changed_fields)
    || typeof pending.reconciled_at !== 'string' || !pending.reconciled_at) {
    throw new Error(`reconcile-metadata pending intent is malformed or does not exactly match the literal apply request for ${record.card}`);
  }
  return pending;
}

function finalizeMetadataReconciliation(ctx, state, record, pending, persist, barrier) {
  const priorAudits = Array.isArray(record.metadata_reconciliations) ? record.metadata_reconciliations : [];
  const audit = {
    request: pending.request, reason: pending.request.reason.trim(),
    card_sha256: pending.card_sha256, next_sha256: pending.next_sha256,
    changed_fields: pending.changed_fields, reconciled_at: pending.reconciled_at,
  };
  record.metadata_reconciliations = [...priorAudits, audit];
  record.projection_reconciled_at = audit.reconciled_at;
  delete record.metadata_reconciliation_pending;
  delete record.projection_error;
  delete record.projection_failed_at;
  persist(ctx, state, record);
  barrier(ctx.statePath);
  return audit;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactParkedMetadataProblemCards(state, cardsRoot) {
  return Object.values(state.cards || {})
    .filter((record) => record.phase === 'parked' && projectionMetadataProblem(record, cardsRoot))
    .map((record) => record.card);
}

function parkedMetadataRebindPlan(state, cardsRoot, reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reconcile-metadata --parked-rebind requires non-empty --reason');
  }
  const findings = exactParkedMetadataProblemCards(state, cardsRoot);
  if (JSON.stringify([...findings].sort()) !== JSON.stringify([...PARKED_METADATA_REBIND_CARDS].sort())) {
    throw new Error('parked metadata rebind requires the complete exact-eight status finding set');
  }
  const cards = PARKED_METADATA_REBIND_CARDS.map((card) => {
    const record = state.cards[card];
    if (!record || record.phase !== 'parked') {
      throw new Error(`parked metadata rebind requires parked tracked target ${card}`);
    }
    const cardPath = resolveCardPath(record.card_path, record.card, cardsRoot);
    const raw = fs.readFileSync(cardPath, 'utf8');
    const prepared = prepareDeliveryCard(raw, card);
    if (!prepared.ok || !record.delivery_contract) {
      throw new Error(`parked metadata rebind requires a valid projected and ledger Delivery contract for ${card}`);
    }
    const expected = expectedProjectedContract(record, effectiveProjectionMapping(record, raw));
    const differences = DELIVERY_STABLE_FIELDS.filter(
      (field) => JSON.stringify(prepared.card[field]) !== JSON.stringify(expected[field]),
    );
    if (JSON.stringify(differences) !== JSON.stringify(['epic'])) {
      throw new Error(`parked metadata rebind refuses non-epic or multi-field migration drift for ${card}`);
    }
    const currentSha256 = sha256Text(raw);
    return {
      card,
      expected_card_sha256: currentSha256,
      intended_next_sha256: currentSha256,
      expected_ledger_epic: expected.epic,
      intended_ledger_epic: prepared.card.epic,
    };
  });
  return { schema_version: 1, reason, cards };
}

function validateParkedMetadataRebindSpec(spec, reason) {
  const hash = /^[0-9a-f]{64}$/;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)
    || JSON.stringify(Object.keys(spec)) !== JSON.stringify(['schema_version', 'reason', 'cards'])
    || spec.schema_version !== 1 || spec.reason !== reason || !Array.isArray(spec.cards)
    || spec.cards.length !== PARKED_METADATA_REBIND_CARDS.length) {
    throw new Error('parked metadata rebind spec does not exactly match the dry-run contract and literal reason');
  }
  for (let index = 0; index < spec.cards.length; index++) {
    const entry = spec.cards[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || JSON.stringify(Object.keys(entry)) !== JSON.stringify([
        'card', 'expected_card_sha256', 'intended_next_sha256',
        'expected_ledger_epic', 'intended_ledger_epic',
      ])
      || entry.card !== PARKED_METADATA_REBIND_CARDS[index]
      || !hash.test(String(entry.expected_card_sha256 || ''))
      || !hash.test(String(entry.intended_next_sha256 || ''))
      || entry.expected_card_sha256 !== entry.intended_next_sha256
      || typeof entry.expected_ledger_epic !== 'string' || !normalizeCardLink(entry.expected_ledger_epic)
      || typeof entry.intended_ledger_epic !== 'string' || !normalizeCardLink(entry.intended_ledger_epic)
      || entry.expected_ledger_epic === entry.intended_ledger_epic) {
      throw new Error(`parked metadata rebind spec has an invalid exact-eight entry at index ${index}`);
    }
  }
  return spec;
}

function parkedMetadataRebindRequest(args, specRaw) {
  return {
    command_operands: Array.isArray(args._) ? [...args._] : [],
    parked_rebind_operand: args['parked-rebind'],
    spec_operand: String(args.spec),
    reason_operand: args.reason,
    apply_operand: args.apply,
    json_operand: args.json,
    spec_sha256: sha256Text(specRaw),
  };
}

function parkedMetadataRebindReplayMatches(records, request, spec) {
  return records.every((record) => {
    const audits = Array.isArray(record.parked_metadata_rebindings) ? record.parked_metadata_rebindings : [];
    const audit = audits[audits.length - 1] || null;
    return audit && sameJson(audit.request, request) && sameJson(audit.spec, spec);
  });
}

async function commandRebindParkedMetadata(ctx, args = {}, deps = {}) {
  for (const key of Object.keys(args)) {
    if (!PARKED_METADATA_REBIND_OPTIONS.has(key)) {
      throw new Error(`reconcile-metadata --parked-rebind refuses unsupported --${key} operand`);
    }
  }
  if (args['parked-rebind'] !== true || args.json !== true) {
    throw new Error('reconcile-metadata --parked-rebind requires literal --parked-rebind and --json');
  }
  if (typeof args.reason !== 'string' || !args.reason.trim()) {
    throw new Error('reconcile-metadata --parked-rebind requires non-empty --reason');
  }
  const apply = args.apply === true;
  const dryRun = args['dry-run'] === true;
  if (apply === dryRun) {
    throw new Error('reconcile-metadata --parked-rebind requires exactly one of --apply or --dry-run');
  }
  if ((apply && Object.prototype.hasOwnProperty.call(args, 'dry-run'))
    || (dryRun && Object.prototype.hasOwnProperty.call(args, 'apply'))) {
    throw new Error('reconcile-metadata --parked-rebind refuses a substituted opposite-mode operand');
  }
  if ((apply && typeof args.spec !== 'string') || (!apply && args.spec !== undefined)) {
    throw new Error('reconcile-metadata --parked-rebind accepts --spec only with --apply');
  }
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const lock = deps.withLock || withLock;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const barrier = deps.durablePathBarrier || durablePathBarrier;
  const readSpec = deps.readSpec || ((file) => fs.readFileSync(file, 'utf8'));
  const now = deps.now || (() => new Date().toISOString());
  return lock(ctx, 'parked-metadata-rebind', async () => {
    const state = loadState(ctx);
    if (!apply) {
      const spec = parkedMetadataRebindPlan(state, cardsRoot, args.reason);
      return {
        action: 'rebind-parked-metadata-plan',
        apply_required: true,
        no_op: false,
        exact_target_count: spec.cards.length,
        spec,
      };
    }
    const specRaw = readSpec(path.resolve(String(args.spec)));
    let parsed;
    try { parsed = JSON.parse(specRaw); }
    catch (err) { throw new Error(`parked metadata rebind spec is malformed JSON: ${err.message}`); }
    const spec = validateParkedMetadataRebindSpec(parsed, args.reason);
    const request = parkedMetadataRebindRequest(args, specRaw);
    const records = [];
    const states = [];
    for (const entry of spec.cards) {
      const record = state.cards[entry.card];
      if (!record || record.phase !== 'parked' || !record.delivery_contract) {
        throw new Error(`parked metadata rebind refuses missing, active, completed, or untracked target ${entry.card}`);
      }
      const raw = fs.readFileSync(resolveCardPath(record.card_path, record.card, cardsRoot), 'utf8');
      const currentSha256 = sha256Text(raw);
      if (currentSha256 !== entry.expected_card_sha256
        && currentSha256 !== entry.intended_next_sha256) {
        throw new Error(`parked metadata rebind found a third card hash for ${entry.card}; zero writes`);
      }
      const prepared = prepareDeliveryCard(raw, entry.card);
      if (!prepared.ok || prepared.card.epic !== entry.intended_ledger_epic) {
        throw new Error(`parked metadata rebind found a third projected epic state for ${entry.card}; zero writes`);
      }
      const ledgerEpic = record.delivery_contract.epic;
      if (ledgerEpic !== entry.expected_ledger_epic && ledgerEpic !== entry.intended_ledger_epic) {
        throw new Error(`parked metadata rebind found a third ledger epic state for ${entry.card}; zero writes`);
      }
      records.push(record);
      states.push(ledgerEpic === entry.expected_ledger_epic ? 'expected' : 'intended');
    }
    const allExpected = states.every((stateName) => stateName === 'expected');
    const allIntended = states.every((stateName) => stateName === 'intended');
    if (!allExpected && !allIntended) {
      throw new Error('parked metadata rebind found a mixed third state; zero writes');
    }
    if (allIntended) {
      if (!parkedMetadataRebindReplayMatches(records, request, spec)) {
        throw new Error('parked metadata rebind completed state accepts only literal replay of the exact successful apply request');
      }
      barrier(ctx.statePath);
      return {
        action: 'rebound-parked-metadata', no_op: true,
        exact_target_count: records.length, request, spec,
      };
    }
    const plan = parkedMetadataRebindPlan(state, cardsRoot, args.reason);
    if (!sameJson(plan, spec)) {
      throw new Error('parked metadata rebind --apply requires the exact expected and intended SHAs from its dry-run');
    }
    const reconciledAt = now();
    const nextRecords = records.map((record, index) => {
      const nextRecord = {
        ...record,
        delivery_contract: {
          ...record.delivery_contract,
          epic: spec.cards[index].intended_ledger_epic,
        },
        parked_metadata_rebindings: [
          ...(Array.isArray(record.parked_metadata_rebindings) ? record.parked_metadata_rebindings : []),
          { request, spec, reconciled_at: reconciledAt },
        ],
      };
      const raw = fs.readFileSync(resolveCardPath(record.card_path, record.card, cardsRoot), 'utf8');
      const remaining = projectionMetadataProblemFromRaw(nextRecord, raw, { ignoreSavedProjectionError: true });
      if (remaining) {
        throw new Error(`parked metadata rebind did not clear the bounded finding for ${record.card}: ${remaining.error}`);
      }
      return nextRecord;
    });
    for (const nextRecord of nextRecords) {
      state.cards[nextRecord.card] = nextRecord;
    }
    persist(ctx, state, null, { preserveUpdatedAt: true });
    barrier(ctx.statePath);
    return {
      action: 'rebound-parked-metadata', no_op: false,
      exact_target_count: records.length, request, spec, reconciled_at: reconciledAt,
    };
  }, { cards: PARKED_METADATA_REBIND_CARDS });
}

function authoredFrontmatterField(raw, key) {
  return frontmatter(raw).split('\n').some((line) => new RegExp(`^${key}:`).test(line));
}

function frontmatterBodySuffix(raw) {
  const match = String(raw).match(/^---\n[\s\S]*?\n---/);
  if (!match) throw new Error('contract frontmatter restamp requires leading frontmatter');
  return String(raw).slice(match[0].length);
}

function restampContractFrontmatter(raw, card) {
  const fields = ['deploy_subscriptions', 'evidence']
    .filter((field) => authoredFrontmatterField(raw, field));
  if (!fields.length) return { changed: false, next: raw, fields: [], contract: null };
  const prepared = prepareDeliveryCard(raw, card);
  const decoded = delivery.decodeStructuredContractFields(prepared.raw_card);
  const structuredErrors = decoded.errors.filter((issue) => fields.includes(issue.field));
  if (structuredErrors.length) {
    throw new Error(`contract frontmatter restamp refuses invalid structured metadata for ${card}: ${
      structuredErrors.map((issue) => `${issue.code}:${issue.field}`).join(', ')
    }`);
  }
  const replacements = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(decoded.card, field)) {
      throw new Error(`contract frontmatter restamp cannot decode authored ${field} for ${card}`);
    }
    replacements[field] = delivery.encodeStructuredFrontmatterValue(decoded.card[field]);
  }
  const next = patchFrontmatter(raw, replacements);
  if (frontmatterBodySuffix(next) !== frontmatterBodySuffix(raw)) {
    throw new Error(`contract frontmatter restamp changed body bytes for ${card}`);
  }
  const verified = prepareDeliveryCard(next, card);
  const verifiedDecoded = delivery.decodeStructuredContractFields(verified.raw_card);
  const verifiedErrors = verifiedDecoded.errors.filter((issue) => fields.includes(issue.field));
  if (verifiedErrors.length) throw new Error(`contract frontmatter restamp produced invalid structured metadata for ${card}`);
  for (const field of fields) {
    if (!sameJson(verifiedDecoded.card[field], decoded.card[field])) {
      throw new Error(`contract frontmatter restamp changed parsed ${field} for ${card}`);
    }
  }
  return {
    changed: next !== raw,
    next,
    fields,
    contract: decoded.card,
  };
}

function canonicalContractNoteFiles(cardsRoot) {
  const root = path.resolve(cardsRoot);
  const rootEntry = fs.lstatSync(root);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new Error('contract frontmatter restamp cards root must be one regular non-symlink directory');
  }
  const files = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new Error(`contract frontmatter restamp refuses symlink path ${target}`);
      }
      physicalDescendant(root, target, `contract frontmatter restamp target ${entry.name}`);
      if (stat.isDirectory()) {
        stack.push(target);
      } else if (stat.isFile() && entry.name.endsWith('.md')) {
        const raw = fs.readFileSync(target, 'utf8');
        if (/^card:/m.test(frontmatter(raw))
          && (authoredFrontmatterField(raw, 'deploy_subscriptions')
            || authoredFrontmatterField(raw, 'evidence'))) {
          files.push(target);
        }
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function contractFrontmatterRestampPlan(cardsRoot, reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reconcile-metadata --contract-frontmatter-restamp requires non-empty --reason');
  }
  const root = path.resolve(cardsRoot);
  const files = [];
  for (const file of canonicalContractNoteFiles(root)) {
    const raw = fs.readFileSync(file, 'utf8');
    const card = path.basename(file, '.md');
    const restamped = restampContractFrontmatter(raw, card);
    if (!restamped.changed) continue;
    files.push({
      path: path.relative(root, file).split(path.sep).join('/'),
      card,
      fields: restamped.fields,
      expected_sha256: sha256Text(raw),
      intended_sha256: sha256Text(restamped.next),
    });
  }
  return {
    schema_version: 1,
    reason,
    cards_root: root,
    files,
  };
}

function validateContractFrontmatterRestampSpec(spec, reason, cardsRoot) {
  const hash = /^[0-9a-f]{64}$/;
  const root = path.resolve(cardsRoot);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)
    || JSON.stringify(Object.keys(spec)) !== JSON.stringify(['schema_version', 'reason', 'cards_root', 'files'])
    || spec.schema_version !== 1 || spec.reason !== reason || spec.cards_root !== root
    || !Array.isArray(spec.files)) {
    throw new Error('contract frontmatter restamp spec does not exactly match the dry-run contract and literal reason');
  }
  const seen = new Set();
  for (let index = 0; index < spec.files.length; index++) {
    const entry = spec.files[index];
    const platformPath = typeof entry.path === 'string' ? entry.path : '';
    const normalized = platformPath.split('/').filter(Boolean);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || JSON.stringify(Object.keys(entry)) !== JSON.stringify([
        'path', 'card', 'fields', 'expected_sha256', 'intended_sha256',
      ])
      || !platformPath || path.isAbsolute(platformPath) || normalized.join('/') !== platformPath
      || normalized.some((part) => part === '.' || part === '..')
      || !platformPath.endsWith('.md') || path.basename(platformPath, '.md') !== entry.card
      || !Array.isArray(entry.fields) || !entry.fields.length
      || entry.fields.some((field) => !['deploy_subscriptions', 'evidence'].includes(field))
      || new Set(entry.fields).size !== entry.fields.length
      || !hash.test(String(entry.expected_sha256 || ''))
      || !hash.test(String(entry.intended_sha256 || ''))
      || entry.expected_sha256 === entry.intended_sha256
      || seen.has(platformPath)) {
      throw new Error(`contract frontmatter restamp spec has an invalid entry at index ${index}`);
    }
    seen.add(platformPath);
  }
  const ordered = [...spec.files].sort((left, right) => left.path.localeCompare(right.path));
  if (!sameJson(ordered, spec.files)) {
    throw new Error('contract frontmatter restamp spec files must use deterministic path order');
  }
  return spec;
}

async function commandRestampContractFrontmatter(ctx, args = {}, deps = {}) {
  for (const key of Object.keys(args)) {
    if (!CONTRACT_FRONTMATTER_RESTAMP_OPTIONS.has(key)) {
      throw new Error(`reconcile-metadata --contract-frontmatter-restamp refuses unsupported --${key} operand`);
    }
  }
  if (args['contract-frontmatter-restamp'] !== true || args.json !== true) {
    throw new Error('reconcile-metadata --contract-frontmatter-restamp requires literal --contract-frontmatter-restamp and --json');
  }
  if (typeof args.reason !== 'string' || !args.reason.trim()) {
    throw new Error('reconcile-metadata --contract-frontmatter-restamp requires non-empty --reason');
  }
  const apply = args.apply === true;
  const dryRun = args['dry-run'] === true;
  if (apply === dryRun) {
    throw new Error('reconcile-metadata --contract-frontmatter-restamp requires exactly one of --apply or --dry-run');
  }
  if ((apply && Object.prototype.hasOwnProperty.call(args, 'dry-run'))
    || (dryRun && Object.prototype.hasOwnProperty.call(args, 'apply'))) {
    throw new Error('reconcile-metadata --contract-frontmatter-restamp refuses a substituted opposite-mode operand');
  }
  if ((apply && typeof args.spec !== 'string') || (!apply && args.spec !== undefined)) {
    throw new Error('reconcile-metadata --contract-frontmatter-restamp accepts --spec only with --apply');
  }
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const lock = deps.withLock || withLock;
  const writeText = deps.atomicWriteText || atomicWriteText;
  const barrier = deps.durablePathBarrier || durablePathBarrier;
  const readSpec = deps.readSpec || ((file) => fs.readFileSync(file, 'utf8'));
  return lock(ctx, 'contract-frontmatter-restamp', async () => {
    if (!apply) {
      const spec = contractFrontmatterRestampPlan(cardsRoot, args.reason);
      return {
        action: 'contract-frontmatter-restamp-plan',
        apply_required: spec.files.length > 0,
        no_op: spec.files.length === 0,
        exact_target_count: spec.files.length,
        spec,
      };
    }
    const specRaw = readSpec(path.resolve(String(args.spec)));
    let parsed;
    try { parsed = JSON.parse(specRaw); }
    catch (err) { throw new Error(`contract frontmatter restamp spec is malformed JSON: ${err.message}`); }
    const spec = validateContractFrontmatterRestampSpec(parsed, args.reason, cardsRoot);
    const request = {
      command_operands: Array.isArray(args._) ? [...args._] : [],
      restamp_operand: args['contract-frontmatter-restamp'],
      spec_operand: String(args.spec),
      reason_operand: args.reason,
      apply_operand: args.apply,
      json_operand: args.json,
      spec_sha256: sha256Text(specRaw),
    };
    const pendingWrites = [];
    const specByPath = new Map(spec.files.map((entry) => [entry.path, entry]));
    const currentPlan = contractFrontmatterRestampPlan(cardsRoot, args.reason);
    for (const current of currentPlan.files) {
      const expected = specByPath.get(current.path);
      if (!expected || !sameJson(current, expected)) {
        throw new Error(`contract frontmatter restamp found an unplanned or changed canonical target ${current.path}; zero writes`);
      }
    }
    for (const entry of spec.files) {
      const file = path.resolve(cardsRoot, ...entry.path.split('/'));
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`contract frontmatter restamp target ${entry.path} must be one regular non-symlink file`);
      }
      physicalDescendant(cardsRoot, file, `contract frontmatter restamp target ${entry.path}`);
      const raw = fs.readFileSync(file, 'utf8');
      const currentSha256 = sha256Text(raw);
      if (currentSha256 !== entry.expected_sha256 && currentSha256 !== entry.intended_sha256) {
        throw new Error(`contract frontmatter restamp found a third hash for ${entry.path}; zero writes`);
      }
      const restamped = restampContractFrontmatter(raw, entry.card);
      if (currentSha256 === entry.expected_sha256) {
        if (!restamped.changed || sha256Text(restamped.next) !== entry.intended_sha256
          || !sameJson(restamped.fields, entry.fields)) {
          throw new Error(`contract frontmatter restamp cannot reproduce intended bytes for ${entry.path}; zero writes`);
        }
        pendingWrites.push({ file, next: restamped.next, entry });
      } else if (restamped.changed || sha256Text(restamped.next) !== entry.intended_sha256) {
        throw new Error(`contract frontmatter restamp intended state is not canonical for ${entry.path}; zero writes`);
      }
    }
    for (const pending of pendingWrites) {
      writeText(pending.file, pending.next);
      barrier(pending.file);
      if (sha256Text(fs.readFileSync(pending.file, 'utf8')) !== pending.entry.intended_sha256) {
        throw new Error(`contract frontmatter restamp write did not verify for ${pending.entry.path}`);
      }
    }
    return {
      action: 'restamped-contract-frontmatter',
      no_op: pendingWrites.length === 0,
      exact_target_count: spec.files.length,
      changed_count: pendingWrites.length,
      request,
      spec,
    };
  }, { cards_root: path.resolve(cardsRoot) });
}

async function commandReconcileMetadata(ctx, args = {}, deps = {}) {
  if (args['parked-rebind'] === true) return commandRebindParkedMetadata(ctx, args, deps);
  if (args['contract-frontmatter-restamp'] === true) {
    return commandRestampContractFrontmatter(ctx, args, deps);
  }
  const card = normalizeCardLink(args.card);
  if (!card) throw new Error('reconcile-metadata requires exact --card');
  if (args.apply === true && args['dry-run'] === true) throw new Error('reconcile-metadata accepts only one of --apply or --dry-run');
  if (args.apply === true && (typeof args.reason !== 'string' || !args.reason.trim())) {
    throw new Error('reconcile-metadata --apply requires non-empty --reason');
  }
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const lock = deps.withLock || withLock;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const writeText = deps.atomicWriteText || atomicWriteText;
  const barrier = deps.durablePathBarrier || durablePathBarrier;
  const now = deps.now || (() => new Date().toISOString());
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx);
    const record = state.cards[card];
    if (!record) throw new Error('reconcile-metadata requires a tracked card');
    if (!METADATA_RECONCILE_PHASES.has(record.phase)) {
      throw new Error(`reconcile-metadata refuses phase ${record.phase || 'missing'}; active and parked cards are out of scope`);
    }
    const cardPath = resolveCardPath(record.card_path, record.card, cardsRoot);
    const raw = fs.readFileSync(cardPath, 'utf8');
    const rawSha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const pending = record.metadata_reconciliation_pending || null;
    if (pending && args.apply !== true) {
      throw new Error('reconcile-metadata pending intent requires the exact literal --apply request');
    }
    const request = args.apply === true ? metadataApplyRequest(card, args) : null;
    if (pending) {
      validateMetadataPending(record, pending, request);
      if (rawSha256 === pending.card_sha256) {
        const next = patchFrontmatter(raw, pending.field_values);
        const nextSha256 = crypto.createHash('sha256').update(next).digest('hex');
        if (nextSha256 !== pending.next_sha256) {
          throw new Error('reconcile-metadata pending intent does not reproduce its exact intended card hash');
        }
        const remaining = projectionMetadataProblemFromRaw(record, next, { ignoreSavedProjectionError: true });
        if (remaining) throw new Error(`metadata-only pending repair cannot resolve this drift without widening scope: ${remaining.error}`);
        writeText(cardPath, next);
        barrier(cardPath);
        const verifiedSha256 = crypto.createHash('sha256').update(fs.readFileSync(cardPath, 'utf8')).digest('hex');
        if (verifiedSha256 !== pending.next_sha256) throw new Error('reconcile-metadata card replacement did not verify at the intended hash');
      } else if (rawSha256 !== pending.next_sha256) {
        throw new Error('reconcile-metadata pending intent found a third card hash; needs-inspection with zero writes');
      } else {
        barrier(cardPath);
        const verifiedSha256 = crypto.createHash('sha256').update(fs.readFileSync(cardPath, 'utf8')).digest('hex');
        if (verifiedSha256 !== pending.next_sha256) throw new Error('reconcile-metadata pending next card did not verify after its durability barrier');
        const remaining = projectionMetadataProblemFromRaw(record, raw, { ignoreSavedProjectionError: true });
        if (remaining) throw new Error(`metadata-only pending repair cannot finalize this drift without widening scope: ${remaining.error}`);
      }
      const audit = finalizeMetadataReconciliation(ctx, state, record, pending, persist, barrier);
      return {
        action: 'reconciled-metadata', phase: record.phase, no_op: false, recovered_pending: true,
        audit, card: record.card, card_sha256: pending.card_sha256, next_sha256: pending.next_sha256,
        changed_fields: pending.changed_fields, changed: true, request,
      };
    }
    const reconciledAt = now();
    const plan = metadataReconciliationPlan(record, raw, () => reconciledAt);
    if (args.apply !== true) {
      const receipt = { ...plan };
      delete receipt.next;
      delete receipt.field_values;
      return { action: 'reconcile-metadata-plan', phase: record.phase, apply_required: plan.changed, no_op: !plan.changed, ...receipt };
    }
    const priorAudits = Array.isArray(record.metadata_reconciliations) ? record.metadata_reconciliations : [];
    const priorAudit = priorAudits[priorAudits.length - 1] || null;
    const replay = !plan.changed && priorAudit && priorAudit.request
      && JSON.stringify(priorAudit.request) === JSON.stringify(request)
      && priorAudit.card_sha256 === request.expected_card_sha256
      && priorAudit.next_sha256 === plan.card_sha256;
    if (replay) {
      barrier(ctx.statePath);
      const receipt = { ...plan };
      delete receipt.next;
      delete receipt.field_values;
      return { action: 'reconciled-metadata', phase: record.phase, no_op: true, request, ...receipt };
    }
    if (typeof args['expected-card-sha256'] !== 'string' || args['expected-card-sha256'] !== plan.card_sha256) {
      throw new Error('reconcile-metadata --apply requires the exact --expected-card-sha256 from its dry-run');
    }
    if (!plan.changed) {
      throw new Error('reconcile-metadata completed state accepts only a literal replay of the exact successful apply request');
    }
    const intent = {
      state: 'prepared', request, card_sha256: plan.card_sha256, next_sha256: plan.next_sha256,
      changed_fields: plan.changed_fields, field_values: plan.field_values, reconciled_at: reconciledAt,
    };
    record.metadata_reconciliation_pending = intent;
    persist(ctx, state, record);
    barrier(ctx.statePath);
    writeText(cardPath, plan.next);
    barrier(cardPath);
    const verifiedSha256 = crypto.createHash('sha256').update(fs.readFileSync(cardPath, 'utf8')).digest('hex');
    if (verifiedSha256 !== plan.next_sha256) throw new Error('reconcile-metadata card replacement did not verify at the intended hash');
    const audit = finalizeMetadataReconciliation(ctx, state, record, intent, persist, barrier);
    const receipt = { ...plan };
    delete receipt.next;
    delete receipt.field_values;
    return { action: 'reconciled-metadata', phase: record.phase, no_op: false, audit, ...receipt };
  }, { card }, lock);
}

// One-time audit/repair verb: scans planning cards for dangling depends_on
// pointers and repoints them to the live supersession tail (auto, repoint-only
// — never clears). Dead-end tombstones, cycles, and never-minted refs escalate
// as needs_decision. Director-authorized --clear <name> is the only path that
// removes a dep, and only for that exact dead pointer.
async function commandReconcileDependencies(ctx, args, deps = {}) {
  if (args.json !== true) throw new Error('reconcile-dependencies requires --json');
  const single = args.card ? normalizeCardLink(String(args.card)) : null;
  const all = args.all === true;
  const reason = Array.isArray(args.reason) ? '' : String(args.reason || '').trim();
  if (single === null && !all) throw new Error('reconcile-dependencies requires --card or --all');
  if (single !== null && all) throw new Error('reconcile-dependencies accepts --card or --all, not both');
  if (!reason) throw new Error('reconcile-dependencies requires a non-empty --reason');
  const apply = args.apply === true;
  const clearName = args.clear ? normalizeCardLink(String(args.clear)) : null;
  const toName = args.to ? normalizeCardLink(String(args.to)) : null;
  if (toName !== null && clearName === null) throw new Error('reconcile-dependencies --to requires --clear to name the dead pointer');
  const loadState = deps.readState || readState;
  const writeText = deps.writeText || atomicWriteText;
  const lock = deps.withLock || withLock;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  return lock(ctx, 'selector', async () => {
    const state = loadState(ctx);
    // A dangling dependency is one that resolves to NO live card. "Live" must be
    // judged against the board — the same honest gather GraphView uses — not just
    // the coordinator ledger: the ledger only holds cards it has TRACKED
    // (claimed/parked/discarded/deployed), while the vast majority of In-Planning
    // slices exist only as notes on disk. Pre-walk cardsRoot once to build the set
    // of every card note that exists, plus a `(supersedes <id>)` naming map so a
    // dangling pointer whose successor was renamed can be repointed even when the
    // old tombstone is no longer in state.
    const diskCards = new Set();
    const supByPredId = new Map(); // predecessor id token -> successor full card name
    {
      const st = [cardsRoot];
      while (st.length) {
        const dir = st.pop();
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) { st.push(full); continue; }
          if (!ent.name.endsWith('.md')) continue;
          const name = ent.name.replace(/\.md$/, '');
          diskCards.add(name);
          const m = name.match(/\(supersedes ([^)]+)\)/);
          if (m) { const predId = cardIdToken(m[1].trim()); if (predId && !supByPredId.has(predId)) supByPredId.set(predId, name); }
        }
      }
    }
    const isLive = (name) => (state.cards[name] && state.cards[name].phase !== 'discarded') || diskCards.has(name);
    // Resolve a dangling ref to a live successor, or null when genuinely orphaned.
    const resolveTarget = (ref) => {
      const rec = state.cards[ref];
      if (rec && rec.phase === 'discarded') {
        const r = resolveSupersessionTail(ref, state);
        if (!r.cycle && !r.deadEnd && isLive(r.tail)) return r.tail;
      }
      const seen = new Set();
      let cur = ref;
      for (let i = 0; i < 50; i += 1) {
        const succ = supByPredId.get(cardIdToken(cur));
        if (!succ || seen.has(succ)) break;
        seen.add(succ);
        if (isLive(succ)) return succ;
        cur = succ; // successor itself missing → keep chasing the rename chain
      }
      return null;
    };
    const plan = [];
    const reports = [];
    const needsDecision = [];
    const stack = [cardsRoot];
    while (stack.length) {
      const dir = stack.pop();
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { stack.push(full); continue; }
        if (!ent.name.endsWith('.md')) continue;
        const depName = ent.name.replace(/\.md$/, '');
        if (single && depName !== single) continue;
        let raw = fs.readFileSync(full, 'utf8');
        const record = state.cards[depName];
        const phase = record ? record.phase : null;
        const inFlight = record && (phase === 'claimed' || phase === 'implementing' || phase === 'parked');
        for (const ref of parseDependsOn(raw)) {
          if (typeof ref === 'string' && /^external:/.test(ref)) continue; // off-board dep, never resolved
          // Director-authorized explicit clear takes precedence over any auto-classification.
          if (clearName && ref === clearName) {
            if (isLive(ref)) continue; // live card (tracked or on disk) — refuse to touch
            if (inFlight) { reports.push({ card: depName, from: ref, phase }); continue; }
            if (toName) {
              // Director-directed repoint: target must be a live card and never the dependent itself.
              if (!isLive(toName) || toName === normalizeCardLink(depName)) { needsDecision.push({ card: depName, from: ref }); continue; }
              plan.push({ card: depName, from: ref, to: toName, classification: 'repoint', path: full });
              if (apply) { const w = rewriteDependsOn(raw, ref, toName); if (w.changed) { raw = w.text; writeText(full, raw); } }
              continue;
            }
            plan.push({ card: depName, from: ref, to: null, classification: 'clear', path: full });
            if (apply) { const w = rewriteDependsOn(raw, ref, null); if (w.changed) { raw = w.text; writeText(full, raw); } }
            continue;
          }
          if (isLive(ref)) continue; // resolves to a real card (tracked or on-disk planning note) — not dangling
          if (inFlight) { reports.push({ card: depName, from: ref, phase }); continue; }
          const to = resolveTarget(ref);
          if (!to) { needsDecision.push({ card: depName, from: ref }); continue; } // genuinely never-minted / orphaned
          plan.push({ card: depName, from: ref, to, classification: 'repoint', path: full });
          if (apply) { const w = rewriteDependsOn(raw, ref, to); if (w.changed) { raw = w.text; writeText(full, raw); } }
        }
      }
    }
    return successReceipt('reconcile-dependencies', {
      apply, no_op: apply ? plan.length === 0 : true, reason,
      plan: plan.map(({ path: _p, ...rest }) => rest),
      reports, needs_decision: needsDecision,
    });
  });
}

function commandRecover(ctx, opts = {}) {
  const state = opts.state || readState(ctx); const inspections = [];
  const run = opts.sh || sh;
  const recoverable = Object.values(state.cards || {}).filter((record) => !TERMINAL.has(record.phase));
  for (const record of recoverable) {
    if (!record.worktree || !fs.existsSync(record.worktree)) { inspections.push({ card: record.card, issue: 'worktree missing', phase: record.phase }); continue; }
    const dirty = run('git', ['status', '--short'], { cwd: record.worktree });
    if (dirty) inspections.push({ card: record.card, issue: 'dirty worktree requires inspection', sample: dirty.split('\n').slice(0, 20) });
  }
  return successReceipt(inspections.length ? 'needs-inspection' : 'clean', {
    no_op: true, inspections,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2)); const command = args._[0] || 'status';
  if (STRICT_CLI_OPTIONS[command]) {
    requireJson(args, command);
    requireOnlyOptions(args, command, STRICT_CLI_OPTIONS[command]);
  }
  if (command === 'record-review') recordReviewOperands(args);
  const ctx = workshopContext();
  let result;
  if (command === 'status') result = await commandStatusLocked(ctx);
  else if (command === 'claim') result = await commandClaim(ctx, args);
  else if (command === 'amend-contract') result = await commandAmendContract(ctx, args);
  else if (command === 'park') result = await commandPark(ctx, args);
  else if (command === 'amend-park') result = await commandAmendPark(ctx, args);
  else if (command === 'resume') result = await commandResume(ctx, args);
  else if (command === 'break-lease') result = await commandBreakLease(ctx, args);
  else if (command === 'backfill-ratifications') result = await commandBackfillRatifications(ctx, args);
  else if (command === 'consume-ratification') result = await commandConsumeRatification(ctx, args);
  else if (command === 'discard') result = await commandDiscard(ctx, args);
  else if (command === 'supersession-depth') result = commandSupersessionDepth(ctx, args);
  else if (command === 'heal-epic-bindings') result = await commandHealEpicBindings(ctx, args);
  else if (command === 'reap') result = await commandReap(ctx, args);
  else if (command === 'restructure') result = await commandRestructure(ctx, args);
  else if (command === 'record-review') result = await commandRecordReview(ctx, args);
  else if (command === 'verify-gates') result = await commandVerifyGates(ctx, args);
  else if (command === 'record-pr') result = await commandRecordPr(ctx, args);
  else if (command === 'advance') { await commandAdvance(ctx, args); return; }
  else if (command === 'recover-deployed') result = await commandRecoverDeployed(ctx, args);
  else if (command === 'reconcile-metadata') result = await commandReconcileMetadata(ctx, args);
  else if (command === 'reconcile') result = await commandReconcile(ctx, args);
  else if (command === 'reconcile-dependencies') result = await commandReconcileDependencies(ctx, args);
  else if (command === 'cutover') result = await commandCutover(ctx, args);
  else if (command === 'deploy') {
    // Whole block runs under the card gate lock — not just the guard — so a
    // concurrent attach during a multi-minute deploy can't have its lease
    // clobbered by this dispatch's own whole-record writeState on terminal
    // release. promoteAndDeploy locks under a distinct 'homebrew-promotion'
    // name, so nesting here does not risk a same-name relock/deadlock.
    result = await withCardGateLock(ctx, args.card, async () => {
      const state = readState(ctx); const record = state.cards[args.card];
      if (!record) throw new Error('deploy requires a known --card');
      requireLeaseToken(record, args, 'deploy', Date.now());
      const deployed = await promoteAndDeploy(ctx, state, record);
      // promoteAndDeploy mutates `record` in place (same reference held in
      // `state.cards`) and persists its own writes internally; once it lands
      // the record in a TERMINAL phase (deployed), release the lease and
      // persist the release as a follow-up write — same conditional-persist
      // pattern as commandAdvance's terminal release, so an unleased card
      // never triggers an extra write.
      if (TERMINAL.has(record.phase)) {
        const released = clearLease(record, 'lease_released_terminal', () => new Date().toISOString());
        if (released) writeState(ctx, state, record);
      }
      return deployed;
    }, { card: args.card, staleMs: 60 * 60 * 1000 });
  } else if (command === 'recover') result = commandRecover(ctx);
  else throw new Error('usage: codex-coordinator.js status|claim|amend-contract|park|amend-park|resume|break-lease|backfill-ratifications|consume-ratification|discard|supersession-depth|heal-epic-bindings|reap|restructure|record-review|verify-gates|record-pr|advance|deploy|recover-deployed|reconcile-metadata|reconcile|reconcile-dependencies|cutover|recover [options]');
  console.log(JSON.stringify(result, null, 2));
  if (result && result.ok === false) process.exitCode = EXIT_CODES.refusal;
}

module.exports = {
  EXIT_CODES, parseArgs, emptyState, atomicWriteJson, writeState, durablePathBarrier, lockIsStale, lockDirectoryIsStale, normalizeZone, zonesOverlap, conflictsWithActive,
  cardGateLockName, legacyCardGateLockName, withCardGateLock,
  normalizeCardLink, sameParentConflict, parseExecutionMeta, validateExecutionMeta, dependencySatisfied, successfulDeploymentReceipts,
  discardedDependencyProblem, resolveSupersessionTail,
  resolveEpicBoardSet, loadCanonicalEpicSlice, selectEpicCandidate, selectEpicShadowCandidate, selectClaimCandidate, selectCoordinatorCandidate,
  summarizeClaimSelection, commandStatus, commandStatusLocked, commandClaim, commandReconcile, commandReconcileDependencies, commandCutover, commandRecover,
  buildLoopStationPayload, validateLoopStationPayload, projectLoopStation, attemptLoopStationProjection,
  commandRecoverDeployed, commandReconcileMetadata, commandRebindParkedMetadata,
  commandRestampContractFrontmatter,
  metadataReconciliationPlan, parkedMetadataRebindPlan, validateParkedMetadataRebindSpec,
  restampContractFrontmatter, canonicalContractNoteFiles,
  contractFrontmatterRestampPlan, validateContractFrontmatterRestampSpec,
  consumeRatificationReceipt, consumeRatificationArtifact,
  ratificationRoots, ratificationArtifactForCard, ratificationTargetHead,
  isRatificationEscalation, pendingRatificationMarkdown, scaffoldPendingRatifications,
  commandBackfillRatifications,
  validateRatificationArtifactOperand, ratificationFrontmatterErrors, ratificationStatus,
  ratificationAcceptedWait, commandConsumeRatification,
  checkRollup, versionFrom, isReleasableTitle, gateReceiptStatus, pathCoveredByTouchZones, releasePrWaitReceipt,
  armFeatureAutoMerge, disableFeatureAutoMerge, runIsolatedWorkshopSelfInstall,
  commandAmendContract, commandPark, commandAmendPark, commandResume, commandBreakLease, commandDiscard, commandReap, commandRestructure,
  commandSupersessionDepth,
  recordReviewOperands, commandRecordReview, commandVerifyGates, commandRecordPr, commandAdvance, stepCard,
  canonicalEpicProjection,
  commandHealEpicBindings, planEpicBindingHeal, owningEpicBoardPath,
  commandBoardHealth, collectBoardHealth,
  stemOf, hasDeployedSupersedingSibling, deployedSupersedingSibling, tombstoneResidue, pruneCardWorkspace,
  normalizeDeploymentMap, moveBoardCard, removeBoardCard, patchFrontmatter, rewriteDependsOn, projectionMapping, projectCard, attemptProjection,
  projectionBoardDrift, auditEpicProject, projectionMetadataProblem, projectionMetadataProblemFromRaw,
  completionResult, expectedProjectedContract, collectDeployedRecoveryEvidence,
  formulaTagFromText, currentTapFormulaTag, tagContainsCommit, DELIVERY_STABLE_FIELDS,
  PARKED_METADATA_REBIND_CARDS,
  loopBindingEnv, resolveBoundDefaults, BOARD, CARDS_ROOT, VAULTS, DEPLOYMENT_VAULT_IDS, REPO,
  LEASE_TTL_MS, leaseIsLive, leaseSummary, acquireLease, clearLease, requireLeaseToken,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify(receiptForError(err)));
    process.exit(err.exitCode || EXIT_CODES.refusal);
  });
}
