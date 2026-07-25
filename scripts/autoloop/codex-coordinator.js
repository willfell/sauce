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

const execFileAsync = promisify(execFile);
const MAXBUF = 64 * 1024 * 1024;
const REPO = 'willfell/sauce';
const TAP_REPO = 'willfell/homebrew-sauce';
const MAX_ACTIVE = 3;
const DEFAULT_LEASE_SECONDS = 600;
const DEFAULT_POLL_SECONDS = 20;
const REVIEW_LENSES = ['correctness', 'regression-risk', 'test-adequacy'];
const DEPLOYMENT_VAULT_IDS = ['headspace', 'accuris', 'ero'];
const DELIVERY_STABLE_FIELDS = Object.freeze(
  delivery.registry.types['execution-card'].fields.map((field) => field.name),
);
const AMEND_CONTRACT_OPTIONS = new Set([
  '_', 'json', 'card', 'expected-head', 'expected-origin-main', 'reason',
  'add-touch-zone', 'expected-deployment', 'desired-deployment',
  'expected-batch-policy', 'desired-batch-policy',
]);
const TERMINAL = new Set(['deployed', 'blocked', 'failed', 'cancelled']);
const RECOVER_DEPLOYED_PHASES = new Set([
  'feature_pr', 'feature_merged', 'release_pr', 'release_merged', 'tagged',
  'tap_pr', 'tap_merged', 'brew_installed', 'deploying', 'blocked', 'needs-inspection',
]);
const METADATA_RECONCILE_PHASES = new Set(['blocked', 'needs-inspection', 'deployed']);
const EXACT_SHA = /^[0-9a-f]{40}$/;
const SYMBOLIC_TOUCH_ZONES = new Set(['shared-registries', 'homebrew-promotion']);
const HOME = os.homedir();
const BOARD = path.join(HOME, 'notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md');
const CARDS_ROOT = path.join(HOME, 'notes/sauce/headspace-sauce/spice/projects/sauce/tasks');
const VAULTS = [
  { id: 'headspace', path: path.join(HOME, 'notes/sauce/headspace-sauce') },
  { id: 'accuris', path: path.join(HOME, 'notes/sauce/accuris-sauce') },
  { id: 'ero', path: path.join(HOME, 'notes/sauce/ero-sauce') },
];

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: MAXBUF, ...opts }).trim();
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[i + 1];
    const parsed = value && !value.startsWith('--') ? value : true;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = Array.isArray(out[key]) ? [...out[key], parsed] : [out[key], parsed];
    } else out[key] = parsed;
    if (parsed !== true) i++;
  }
  return out;
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

function writeState(ctx, state, changedRecord) {
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
    next.updated_at = new Date().toISOString();
    atomicWriteJson(ctx.statePath, next);
    state.updated_at = next.updated_at;
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

function consumeRatificationArtifact(markdown, sectionHeading, provenance, expected = {}) {
  const parsed = delivery.parseRatificationArtifact(markdown, sectionHeading, provenance);
  if (!parsed.ok) return {
    ok: false,
    errors: parsed.errors,
    receipt: null,
    contract_version: delivery.CONTRACT_VERSION,
  };
  return consumeRatificationReceipt(parsed.receipt, expected);
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
  const expectedKeys = [...DEPLOYMENT_VAULT_IDS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${opts.label || 'deployment map'} requires exactly headspace, accuris, and ero arrays`);
  }
  const normalized = {};
  for (const vault of DEPLOYMENT_VAULT_IDS) {
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

function parkedAmendmentProblem(record) {
  if (!Array.isArray(record.dependencies) || !record.dependencies.length
    || record.dependencies.some((dependency) => !normalizeCardLink(dependency))) {
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
      'deploy_subscriptions:',
      ...DEPLOYMENT_VAULT_IDS.flatMap((vault) => deployments[vault].length
        ? [`  ${vault}:`, ...deployments[vault].map((entry) => `    - ${JSON.stringify(entry)}`)]
        : [`  ${vault}: []`]),
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
  else for (const id of VAULTS.map((v) => v.id)) if (!Array.isArray(meta.deploySubscriptions[id])) errors.push(`deploy_subscriptions.${id} is required`);
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
  if (record) return successfulDeploymentReceipts(record);
  const completed = boardMd == null
    ? new Set(board.Completed || [])
    : parseCheckedColumn(boardMd, 'Completed');
  return completed.has(dep);
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

function selectEpicShadowCandidate({
  boardMd, state, loadCard, supervised = false, cardsRoot = CARDS_ROOT,
  readFile, readDir, exists,
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
    const selected = selectClaimCandidate({
      boardMd: candidateBoard, state, loadCard, supervised, epicShadow: false,
    });
    if (selected.action === 'claim' || selected.action === 'at-capacity') {
      return {
        ...summarizeClaimSelection(selected),
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

function selectClaimCandidate({
  boardMd, state, loadCard, supervised = false, epicShadow = false,
  cardsRoot = CARDS_ROOT, readFile, readDir, exists,
}) {
  const board = parseBoard(boardMd);
  const active = activeRecords(state);
  if (active.length >= MAX_ACTIVE) {
    const selected = { action: 'at-capacity', active: active.map((r) => r.card) };
    if (epicShadow) selected.shadow_selection = selectEpicShadowCandidate({
      boardMd, state, loadCard, supervised, cardsRoot, readFile, readDir, exists,
    });
    return selected;
  }
  const skipped = []; const boardDrift = [];
  for (const card of board['In Planning']) {
    if (state.cards[card] && state.cards[card].phase !== 'cancelled') { skipped.push({ card, reason: `already tracked (${state.cards[card].phase})` }); continue; }
    const loaded = loadCard(card);
    if (!loaded || !loaded.raw) { skipped.push({ card, reason: 'card note missing' }); continue; }
    const meta = parseExecutionMeta(loaded.raw, card);
    const errors = validateExecutionMeta(meta);
    if (errors.length) { skipped.push({ card, reason: errors.join('; ') }); continue; }
    // Keep the unmet set explicit so recovery diagnostics can name each gate.
    const unmet = [];
    for (const dep of meta.dependencies) {
      if (!dependencySatisfied(dep, board, state, boardMd)) unmet.push(dep);
      else if (state.cards[dep] && !parseCheckedColumn(boardMd, 'Completed').has(dep)
        && !boardDrift.some((item) => item.card === dep)) {
        boardDrift.push({ card: dep, issue: 'deployed dependency is not checked in Completed' });
      }
    }
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
      boardMd, state, loadCard, supervised, cardsRoot, readFile, readDir, exists,
    });
    return selected;
  }
  const selected = {
    action: 'no-work', skipped, reason: 'no eligible execution card',
    ...(boardDrift.length ? { board_drift: boardDrift } : {}),
  };
  if (epicShadow) selected.shadow_selection = selectEpicShadowCandidate({
    boardMd, state, loadCard, supervised, cardsRoot, readFile, readDir, exists,
  });
  return selected;
}

function summarizeClaimSelection(selected) {
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
    return summary;
  }
  if (selected.action === 'at-capacity') {
    return {
      action: 'at-capacity', active: selected.active || [],
      ...(selected.shadow_selection ? { shadow_selection: selected.shadow_selection } : {}),
    };
  }
  const summary = {
    action: selected.action, reason: selected.reason || null,
    skipped_count: skipped.length, first_blocker: skipped[0] || null,
  };
  if (selected.board_drift) summary.board_drift = selected.board_drift;
  if (selected.shadow_selection) summary.shadow_selection = selected.shadow_selection;
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

function gateReceiptStatus(record, headSha, baseSha = null) {
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
  const required = ['adequacy', 'release_preflight', 'workshop_self_install', 'release_preflight_bumped'];
  const missing = required.filter((name) => !receipt.checks || receipt.checks[name] !== 'pass');
  if (missing.length) return { valid: false, reason: `gate receipt is incomplete: ${missing.join(', ')}` };
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

function runIsolatedWorkshopSelfInstall(ctx, headSha, run = sh) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-autoloop-self-install-'));
  fs.rmSync(temp, { recursive: true, force: true });
  let added = false;
  let failure = null;
  try {
    run('git', ['worktree', 'add', '--detach', temp, headSha], { cwd: ctx.root, stdio: 'pipe' });
    added = true;
    run('node', ['platform/install.js', '--vault', '.', '--auto-approve'], { cwd: temp, stdio: 'pipe' });
  } catch (err) {
    failure = err;
  } finally {
    let registered = added;
    if (!registered) {
      try {
        const listed = run('git', ['worktree', 'list', '--porcelain'], { cwd: ctx.root, stdio: 'pipe' });
        registered = String(listed).split('\n').some((line) => line === `worktree ${temp}`);
      } catch (err) {
        failure = failure ? new Error(`${failure.message}; could not inspect disposable worktree registration: ${err.message}`) : err;
      }
    }
    if (registered) {
      try { run('git', ['worktree', 'remove', '--force', temp], { cwd: ctx.root, stdio: 'pipe' }); }
      catch (err) {
        const cleanup = new Error(`failed to remove disposable self-install worktree ${temp}: ${err.message}`);
        failure = failure ? new Error(`${failure.message}; ${cleanup.message}`) : cleanup;
      }
    } else fs.rmSync(temp, { recursive: true, force: true });
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
  return DEPLOYMENT_VAULT_IDS.some((vault) => Array.isArray(record.deploy_subscriptions && record.deploy_subscriptions[vault])
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
  if (record.phase === 'parked') {
    return {
      action: 'parked', card: record.card, phase: 'parked',
      dependencies: record.dependencies || [], resume_condition: record.resume_condition || '',
      resume: `resume --card ${record.card}`,
    };
  }
  if (record.phase === 'feature_pr') {
    const pr = viewPr(REPO, record.feature_pr, ctx.root);
    const gateStatus = gateReceiptStatus(record, pr.headRefOid, pr.baseRefOid);
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
    action: 'resume-refused', card: record.card, phase: record.phase,
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
  return transitionLock(ctx, 'selector', async () => withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx);
    const record = state.cards[card];
    if (!record) throw new Error(`amend-contract requires a tracked --card; ${card} is not tracked`);
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
  const card = String(args.card || '').trim();
  const resumeCondition = Array.isArray(args['resume-condition']) ? '' : String(args['resume-condition'] || '').trim();
  const dependencies = [...new Set(argumentValues(args['depends-on']))];
  if (!card) throw new Error('park requires --card');
  if (!dependencies.length) throw new Error('park requires one or more --depends-on prerequisite cards');
  if (!resumeCondition) throw new Error('park requires a non-empty --resume-condition');
  if (dependencies.some((dependency) => normalizeCardLink(dependency) === normalizeCardLink(card))) {
    throw new Error(`${card} cannot depend on itself`);
  }
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const transitionLock = deps.withLock || withLock;
  const find = deps.findCard || findCard;
  const boardPath = deps.boardPath || BOARD;
  const project = deps.projectCard || projectCard;
  const now = deps.now || (() => new Date().toISOString());
  return transitionLock(ctx, 'selector', async () => withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) throw new Error(`card ${card} is not claimed`);
    if (!['claimed', 'implementing'].includes(record.phase)) {
      throw new Error(`park only accepts claimed pre-PR work; ${card} is ${record.phase}`);
    }
    for (const dependency of dependencies) {
      if (!find(CARDS_ROOT, dependency)) throw new Error(`prerequisite card ${dependency} does not exist`);
    }
    record.phase = 'parked';
    record.dependencies = dependencies;
    record.resume_condition = resumeCondition;
    record.parked_at = now();
    persist(ctx, state, record);
    const projection = await attemptProjection(ctx, record, boardPath, {
      withLock: transitionLock, projectCard: project, now, state,
    });
    persist(ctx, state, record);
    const result = {
      action: projection.ok ? 'parked' : 'parked-projection-failed',
      card, phase: record.phase, dependencies, resume_condition: resumeCondition,
      branch: record.branch, worktree: record.worktree,
    };
    if (!projection.ok) {
      result.projection_error = projection.error;
      result.reconcile = `reconcile --card ${card}`;
    }
    return result;
  }, { card, staleMs: 60 * 60 * 1000 }, transitionLock), { card, staleMs: 60 * 60 * 1000 });
}

async function commandResume(ctx, args, deps = {}) {
  const card = String(args.card || '').trim();
  if (!card) throw new Error('resume requires --card');
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const transitionLock = deps.withLock || withLock;
  const find = deps.findCard || findCard;
  const run = deps.sh || sh;
  const boardPath = deps.boardPath || BOARD;
  const project = deps.projectCard || projectCard;
  const now = deps.now || (() => new Date().toISOString());
  const worktreeExists = deps.worktreeExists || fs.existsSync;
  return transitionLock(ctx, 'selector', async () => withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) throw new Error(`card ${card} is not claimed`);
    if (record.phase !== 'parked') return resumeRefused(record, `card is ${record.phase}, not parked`);
    if (record.projection_error) {
      return resumeRefused(record, `park metadata projection is unresolved: ${record.projection_error}`, {
        reconcile: `reconcile --card ${card}`,
      });
    }
    if (!Array.isArray(record.dependencies) || !record.dependencies.length
      || record.dependencies.some((dependency) => typeof dependency !== 'string' || !normalizeCardLink(dependency))) {
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
    persist(ctx, state, record);
    const projection = await attemptProjection(ctx, record, boardPath, {
      withLock: transitionLock, projectCard: project, now, state,
    });
    persist(ctx, state, record);
    return {
      action: projection.ok ? 'implement' : 'resume-projection-failed',
      card, phase: record.phase, branch: record.branch, worktree: record.worktree,
      dependencies: record.dependencies, reviews_invalidated: true,
      invalidation_reason: invalidation.reason,
      head_sha: headSha, origin_main_sha: originMainSha,
      origin_main_advanced: originMainAdvanced, requires_main_update: originMainAdvanced,
      ...(projection.ok ? {} : { projection_error: projection.error, reconcile: `reconcile --card ${card}` }),
    };
  }, { card, staleMs: 60 * 60 * 1000 }, transitionLock), { card, staleMs: 60 * 60 * 1000 });
}

async function commandClaim(ctx, args) {
  return withLock(ctx, 'selector', async () => {
    if (fs.existsSync(path.join(ctx.root, '.autoloop-halt'))) return { action: 'halted', reason: '.autoloop-halt present' };
    const state = readState(ctx);
    const boardMd = fs.readFileSync(BOARD, 'utf8');
    const selected = selectClaimCandidate({
      boardMd, state,
      loadCard: (card) => { const p = findCard(CARDS_ROOT, card); return p ? { path: p, raw: fs.readFileSync(p, 'utf8') } : null; },
      // A direct coordinator claim is the supervised operator path. Future
      // batch callers use the pure selector without this capability.
      supervised: true,
    });
    if (selected.action !== 'claim' || args['dry-run']) return selected;
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
    return { action: 'implement', ...record, skipped: selected.skipped };
  });
}

async function commandRecordReview(ctx, args, deps = {}) {
  const card = args.card; const lens = args.lens; const verdict = args.verdict;
  const summary = String(args.summary || '').trim();
  if (!card || !REVIEW_LENSES.includes(lens)) throw new Error(`record-review requires --card and --lens ${REVIEW_LENSES.join('|')}`);
  if (!['pass', 'refute'].includes(verdict)) throw new Error('record-review requires --verdict pass|refute');
  if (summary.length < 20) throw new Error('record-review requires a specific --summary of at least 20 characters');
  const loadState = deps.readState || readState;
  const run = deps.sh || sh;
  const persist = deps.writeState || writeState;
  const gateLock = deps.withLock || withLock;
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) throw new Error(`card ${card} is not claimed`);
    if (!record.worktree || !fs.existsSync(record.worktree)) throw new Error(`worktree is missing for ${card}`);
    if (!['implementing', 'feature_pr'].includes(record.phase)) {
      throw new Error(`reviews are closed for ${card} in phase ${record.phase}`);
    }
    const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    record.gate_receipt = null;
    record.reviews = { ...(record.reviews || {}), [lens]: {
      lens, verdict, refuted: verdict === 'refute', summary, head_sha: headSha, recorded_at: new Date().toISOString(),
    } };
    persist(ctx, state, record);
    return { action: 'review-recorded', card, lens, verdict, head_sha: headSha };
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
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) throw new Error(`card ${card} is not claimed`);
    if (!record.worktree || !fs.existsSync(record.worktree)) throw new Error(`worktree is missing for ${card}`);
    const dirty = run('git', ['status', '--short'], { cwd: record.worktree });
    if (dirty) throw new Error(`worktree is not clean: ${dirty.split('\n')[0]}`);
    const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    const baseRef = 'origin/main';
    run('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: record.worktree, stdio: 'pipe' });
    const baseSha = run('git', ['rev-parse', baseRef], { cwd: record.worktree });
    const paths = run('git', ['diff', '--name-only', `${baseSha}...${headSha}`], { cwd: record.worktree }).split('\n').map((s) => s.trim()).filter(Boolean);
    const outside = paths.filter((file) => !pathCoveredByTouchZones(file, record.touch_zones));
    if (outside.length) throw new Error(`diff exceeds declared touch zones: ${outside.join(', ')}`);

    const receipt = {
      status: 'fail', reason: 'gate verification did not finish', head_sha: headSha,
      base_ref: baseRef, base_sha: baseSha, paths,
      checks: {}, reviews: {}, started_at: new Date().toISOString(),
    };
    try {
      const adequacyText = run('node', ['scripts/autoloop/gate.js', 'verify-adequacy', '--base', baseSha, '--json'], { cwd: record.worktree });
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

      run('npm', ['run', 'release:preflight'], { cwd: record.worktree, stdio: 'pipe' });
      receipt.checks.release_preflight = 'pass';
      runSelfInstall(ctx, headSha, run);
      receipt.checks.workshop_self_install = 'pass';
      run('npm', ['run', 'release:preflight-bumped'], { cwd: record.worktree, stdio: 'pipe' });
      receipt.checks.release_preflight_bumped = 'pass';
      const finalDirty = run('git', ['status', '--short'], { cwd: record.worktree });
      const finalHead = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
      if (finalDirty || finalHead !== headSha) throw new Error('worktree or HEAD changed while gate verification was running');
      receipt.status = 'pass'; receipt.reason = 'all required gates passed for this commit'; receipt.completed_at = new Date().toISOString();
      record.gate_receipt = receipt;
      persist(ctx, state, record);
      return { action: 'gates-passed', card, head_sha: headSha, base_sha: baseSha, behavioral: receipt.behavioral, checks: receipt.checks };
    } catch (err) {
      receipt.reason = err.message; receipt.completed_at = new Date().toISOString();
      record.gate_receipt = receipt;
      persist(ctx, state, record);
      throw err;
    }
  }, { card, staleMs: 60 * 60 * 1000 }, gateLock);
}

async function commandRecordPr(ctx, args, deps = {}) {
  const card = args.card; const number = Number(args.pr);
  if (!card || !Number.isInteger(number)) throw new Error('record-pr requires --card and numeric --pr');
  const loadState = deps.readState || readState;
  const viewPr = deps.prView || prView;
  const run = deps.sh || sh;
  const persist = deps.writeState || writeState;
  const gateLock = deps.withLock || withLock;
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx); const record = state.cards[card];
    if (!record) throw new Error(`card ${card} is not claimed`);
    const pr = viewPr(REPO, number, ctx.root);
    if (pr.headRefName !== record.branch) throw new Error(`PR head ${pr.headRefName} != recorded branch ${record.branch}`);
    if (pr.baseRefName !== 'main') throw new Error(`PR base ${pr.baseRefName} != main`);
    assertReleasableTitle(pr.title);
    const dirty = run('git', ['status', '--short'], { cwd: record.worktree });
    if (dirty) throw new Error(`worktree is not clean: ${dirty.split('\n')[0]}`);
    const localHead = run('git', ['rev-parse', 'HEAD'], { cwd: record.worktree });
    if (pr.headRefOid !== localHead) throw new Error(`PR head ${pr.headRefOid} != worktree HEAD ${localHead}`);
    const gateStatus = gateReceiptStatus(record, localHead, pr.baseRefOid);
    if (!gateStatus.valid) throw new Error(`record-pr refused: ${gateStatus.reason}`);
    record.feature_pr = number; record.feature_url = pr.url; record.phase = 'feature_pr'; record.pr_recorded_at = new Date().toISOString();
    persist(ctx, state, record);
    return { action: 'recorded', card, pr: number, phase: record.phase, url: pr.url };
  }, { card, staleMs: 60 * 60 * 1000 }, gateLock);
}

async function commandAdvance(ctx, args, deps = {}) {
  const card = args.card; if (!card) throw new Error('advance requires --card');
  const lease = Math.min(DEFAULT_LEASE_SECONDS, Math.max(0, Number(args['lease-seconds'] || DEFAULT_LEASE_SECONDS)));
  const poll = Math.max(5, Number(args['poll-seconds'] || DEFAULT_POLL_SECONDS));
  const loadState = deps.readState || readState;
  const gateLock = deps.withLock || withLock;
  const step = deps.stepCard || stepCard;
  const emit = deps.emit || ((value) => process.stdout.write(`${JSON.stringify(value)}\n`));
  const deadline = Date.now() + lease * 1000;
  let last = '';
  while (true) {
    if (fs.existsSync(path.join(ctx.root, '.autoloop-halt'))) {
      const halted = { action: 'halted', card, reason: '.autoloop-halt present' };
      emit(halted); return halted;
    }
    const result = await withCardGateLock(ctx, card, async () => {
      const state = loadState(ctx); const record = state.cards[card];
      if (!record) throw new Error(`card ${card} not in state`);
      return step(ctx, state, record, { dryRun: Boolean(args['dry-run']) });
    }, { card, staleMs: 60 * 60 * 1000 }, gateLock);
    const fingerprint = JSON.stringify(result);
    if (fingerprint !== last) { emit(result); last = fingerprint; }
    if (!['waiting', 'phase-change'].includes(result.action) || lease === 0) return result;
    if (Date.now() >= deadline) {
      const receipt = { action: 'waiting', card, phase: loadState(ctx).cards[card].phase, lease_expired: true, resume: `advance --card ${card}` };
      emit(receipt); return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(poll * 1000, Math.max(0, deadline - Date.now()))));
  }
}

function commandStatus(ctx, opts = {}) {
  const state = opts.state || readState(ctx); const active = activeRecords(state);
  const parked = Object.values(state.cards || {}).filter((record) => record.phase === 'parked');
  const tracked = Object.values(state.cards || {}).filter((record) => projectionMapping(record.phase));
  const cardsRoot = opts.cardsRoot || CARDS_ROOT;
  const boardMd = opts.boardMd ?? fs.readFileSync(BOARD, 'utf8');
  const loadCard = opts.loadCard || ((card) => {
    const p = findCard(CARDS_ROOT, card);
    return p ? { path: p, raw: fs.readFileSync(p, 'utf8') } : null;
  });
  const next = summarizeClaimSelection(selectClaimCandidate({
    boardMd, state, loadCard, supervised: opts.supervised !== false,
    epicShadow: opts.epicShadow ?? process.env.SAUCE_EPIC_SELECTION_SHADOW === '1',
    cardsRoot,
    readFile: opts.readFile, readDir: opts.readDir, exists: opts.exists,
  }));
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
    })),
    parked: parked.map((r) => ({
      card: r.card, phase: r.phase, status: 'parked', model_profile: r.model_profile, branch: r.branch,
      dependencies: r.dependencies || [], resume_condition: r.resume_condition || '',
      parked_at: r.parked_at || null, projection_error: r.projection_error || null,
    })),
    tracked: tracked.map((r) => ({
      card: r.card, phase: r.phase, status: projectedRecordMapping(r, cardsRoot).status,
      model_profile: r.model_profile, batch_policy: r.batch_policy || null,
    })),
    active_count: active.length, capacity: MAX_ACTIVE, available_slots: Math.max(0, MAX_ACTIVE - active.length),
    next, projection_problems: projectionProblems, board_drift: boardDrift, state_path: ctx.statePath,
  };
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
  return {
    action: failed.length ? 'reconcile-failed' : 'reconciled',
    scope: args.card ? 'card' : 'all-tracked', checked: results.length,
    changed, failed: failed.length, no_op: changed === 0 && failed.length === 0,
    results,
  };
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
  return withCardGateLock(ctx, request.card, async () => {
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

async function commandReconcileMetadata(ctx, args = {}, deps = {}) {
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

function commandRecover(ctx, opts = {}) {
  const state = opts.state || readState(ctx); const inspections = [];
  const run = opts.sh || sh;
  const recoverable = Object.values(state.cards || {}).filter((record) => !TERMINAL.has(record.phase));
  for (const record of recoverable) {
    if (!record.worktree || !fs.existsSync(record.worktree)) { inspections.push({ card: record.card, issue: 'worktree missing', phase: record.phase }); continue; }
    const dirty = run('git', ['status', '--short'], { cwd: record.worktree });
    if (dirty) inspections.push({ card: record.card, issue: 'dirty worktree requires inspection', sample: dirty.split('\n').slice(0, 20) });
  }
  return { action: inspections.length ? 'needs-inspection' : 'clean', inspections };
}

async function main() {
  const args = parseArgs(process.argv.slice(2)); const command = args._[0] || 'status';
  const ctx = workshopContext();
  let result;
  if (command === 'status') result = commandStatus(ctx);
  else if (command === 'claim') result = await commandClaim(ctx, args);
  else if (command === 'amend-contract') result = await commandAmendContract(ctx, args);
  else if (command === 'park') result = await commandPark(ctx, args);
  else if (command === 'resume') result = await commandResume(ctx, args);
  else if (command === 'record-review') result = await commandRecordReview(ctx, args);
  else if (command === 'verify-gates') result = await commandVerifyGates(ctx, args);
  else if (command === 'record-pr') result = await commandRecordPr(ctx, args);
  else if (command === 'advance') { await commandAdvance(ctx, args); return; }
  else if (command === 'recover-deployed') result = await commandRecoverDeployed(ctx, args);
  else if (command === 'reconcile-metadata') result = await commandReconcileMetadata(ctx, args);
  else if (command === 'reconcile') result = await commandReconcile(ctx, args);
  else if (command === 'deploy') {
    const state = readState(ctx); const record = state.cards[args.card];
    if (!record) throw new Error('deploy requires a known --card');
    result = await promoteAndDeploy(ctx, state, record);
  } else if (command === 'recover') result = commandRecover(ctx);
  else throw new Error('usage: codex-coordinator.js status|claim|amend-contract|park|resume|record-review|verify-gates|record-pr|advance|deploy|recover-deployed|reconcile-metadata|reconcile|recover [options]');
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  parseArgs, emptyState, atomicWriteJson, writeState, durablePathBarrier, lockIsStale, lockDirectoryIsStale, normalizeZone, zonesOverlap, conflictsWithActive,
  cardGateLockName, legacyCardGateLockName, withCardGateLock,
  normalizeCardLink, sameParentConflict, parseExecutionMeta, validateExecutionMeta, dependencySatisfied, successfulDeploymentReceipts,
  resolveEpicBoardSet, selectEpicShadowCandidate, selectClaimCandidate, summarizeClaimSelection, commandStatus, commandReconcile, commandRecover,
  commandRecoverDeployed, commandReconcileMetadata, metadataReconciliationPlan,
  consumeRatificationReceipt, consumeRatificationArtifact,
  checkRollup, versionFrom, isReleasableTitle, gateReceiptStatus, pathCoveredByTouchZones, releasePrWaitReceipt,
  armFeatureAutoMerge, disableFeatureAutoMerge, runIsolatedWorkshopSelfInstall,
  commandAmendContract, commandPark, commandResume, commandRecordReview, commandVerifyGates, commandRecordPr, commandAdvance, stepCard,
  normalizeDeploymentMap, moveBoardCard, patchFrontmatter, projectionMapping, projectCard, attemptProjection,
  projectionBoardDrift, auditEpicProject, projectionMetadataProblem, projectionMetadataProblemFromRaw,
  completionResult, expectedProjectedContract, collectDeployedRecoveryEvidence,
  formulaTagFromText, currentTapFormulaTag, tagContainsCommit, DELIVERY_STABLE_FIELDS,
};

if (require.main === module) {
  main().catch((err) => { console.error(JSON.stringify({ action: 'error', message: err.message, code: err.code || null })); process.exit(1); });
}
