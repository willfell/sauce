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
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const { parseBoard, parseCheckedColumn, parseDependsOn } = require('./select-card');
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
const TERMINAL = new Set(['deployed', 'blocked', 'failed', 'cancelled']);
const EXCLUSIVE_ZONES = [
  'platform/install.js', 'package.json', '.github/workflows',
  'platform/manifest.json', 'shared-registries', 'homebrew-promotion',
];
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
    if (value && !value.startsWith('--')) { out[key] = value; i++; }
    else out[key] = true;
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

function zonesOverlap(a, b) {
  const x = normalizeZone(a); const y = normalizeZone(b);
  if (!x || !y) return false;
  if (EXCLUSIVE_ZONES.includes(x) || EXCLUSIVE_ZONES.includes(y)) return x === y;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
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

function parseExecutionMeta(raw) {
  return {
    modelProfile: scalarField(raw, 'model_profile'),
    touchZones: listField(raw, 'touch_zones').map(normalizeZone),
    dependencies: parseDependsOn(raw),
    deploySubscriptions: deploymentField(raw),
    parentCard: scalarField(raw, 'parent_card'),
    slice: scalarField(raw, 'slice'),
  };
}

function validateExecutionMeta(meta) {
  const errors = [];
  if (!['standard', 'heavy'].includes(meta.modelProfile)) errors.push('model_profile must be standard|heavy');
  if (!meta.touchZones.length) errors.push('touch_zones must be non-empty');
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

function activeRecords(state) {
  return Object.values(state.cards || {}).filter((r) => !TERMINAL.has(r.phase));
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

function selectClaimCandidate({ boardMd, state, loadCard }) {
  const board = parseBoard(boardMd);
  const active = activeRecords(state);
  if (active.length >= MAX_ACTIVE) return { action: 'at-capacity', active: active.map((r) => r.card) };
  const skipped = []; const boardDrift = [];
  for (const card of board['In Planning']) {
    if (state.cards[card] && state.cards[card].phase !== 'cancelled') { skipped.push({ card, reason: `already tracked (${state.cards[card].phase})` }); continue; }
    const loaded = loadCard(card);
    if (!loaded || !loaded.raw) { skipped.push({ card, reason: 'card note missing' }); continue; }
    const meta = parseExecutionMeta(loaded.raw);
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
    const conflict = conflictsWithActive(meta, active);
    if (conflict) { skipped.push({ card, reason: `touch-zone conflict with ${conflict.card}: ${conflict.zone}` }); continue; }
    return {
      action: 'claim', card, cardPath: loaded.path, meta, skipped,
      ...(boardDrift.length ? { board_drift: boardDrift } : {}),
    };
  }
  return {
    action: 'no-work', skipped, reason: 'no eligible execution card',
    ...(boardDrift.length ? { board_drift: boardDrift } : {}),
  };
}

function summarizeClaimSelection(selected) {
  const skipped = selected.skipped || [];
  if (selected.action === 'claim') {
    const summary = {
      action: 'claim', card: selected.card,
      model_profile: selected.meta.modelProfile,
      touch_zones: selected.meta.touchZones,
      skipped_count: skipped.length,
    };
    if (selected.board_drift) summary.board_drift = selected.board_drift;
    return summary;
  }
  if (selected.action === 'at-capacity') return { action: 'at-capacity', active: selected.active || [] };
  const summary = {
    action: selected.action, reason: selected.reason || null,
    skipped_count: skipped.length, first_blocker: skipped[0] || null,
  };
  if (selected.board_drift) summary.board_drift = selected.board_drift;
  return summary;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

function patchFrontmatter(raw, fields) {
  return String(raw).replace(/^---\n([\s\S]*?)\n---/, (_, body) => {
    let next = body;
    for (const [key, value] of Object.entries(fields)) {
      const re = new RegExp(`^${key}:.*$`, 'm');
      next = re.test(next) ? next.replace(re, `${key}: ${value}`) : `${next}\n${key}: ${value}`;
    }
    return `---\n${next}\n---`;
  });
}

function projectionMapping(phase) {
  return {
    implementing: { column: 'In Progress', status: 'in_progress', complete: false },
    blocked: { column: 'Blocked', status: 'blocked', complete: false },
    deployed: { column: 'Completed', status: 'completed', complete: true },
  }[phase] || null;
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
  const location = boardCardLocation(md, card);
  if (!location) throw new Error(`card ${card} not found on board`);
  if (location.column === target && location.checked === complete) return String(md);
  if (location.column === target) {
    lines[location.line] = lines[location.line].replace(/^\s*- \[[ xX]\]/, `- [${complete ? 'x' : ' '}]`);
    return lines.join('\n');
  }
  lines.splice(location.line, 1);
  const header = lines.findIndex((line) => line.trim() === `## ${target}`);
  if (header < 0) throw new Error(`board column ${target} missing`);
  lines.splice(header + 1, 0, '', `- [${complete ? 'x' : ' '}] [[${card}]]`);
  return lines.join('\n');
}

function atomicWriteText(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
}

function projectCard(cardPath, boardPath, card, phase, opts = {}) {
  const mapping = projectionMapping(phase);
  if (!mapping) return { changed: false, skipped: true };
  const boardRaw = fs.readFileSync(boardPath, 'utf8');
  const cardRaw = fs.readFileSync(cardPath, 'utf8');
  const boardNext = moveBoardCard(boardRaw, card, mapping.column, mapping.complete);
  const metadataChanged = scalarField(cardRaw, 'kanban_column') !== mapping.column
    || scalarField(cardRaw, 'status') !== mapping.status;
  const boardChanged = boardNext !== boardRaw;
  const cardNext = metadataChanged || boardChanged
    ? patchFrontmatter(cardRaw, {
      kanban_column: mapping.column,
      status: mapping.status,
      status_changed_at: (opts.now || (() => new Date().toISOString()))(),
    })
    : cardRaw;
  if ((metadataChanged || boardChanged) && cardNext === cardRaw && !frontmatter(cardRaw)) {
    throw new Error(`card ${card} frontmatter missing`);
  }
  if (boardChanged) atomicWriteText(boardPath, boardNext);
  if (cardNext !== cardRaw) atomicWriteText(cardPath, cardNext);
  return {
    changed: boardChanged || cardNext !== cardRaw,
    board_changed: boardChanged,
    card_changed: cardNext !== cardRaw,
  };
}

async function attemptProjection(ctx, record, boardPath = BOARD, opts = {}) {
  const project = opts.projectCard || projectCard;
  const now = opts.now || (() => new Date().toISOString());
  const projectionLock = opts.withLock || withLock;
  try {
    return await projectionLock(ctx, 'completion-projection', async () => {
      const result = project(record.card_path, boardPath, record.card, record.phase, { now });
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

function projectionBoardDrift(boardMd, record) {
  const mapping = projectionMapping(record.phase);
  if (!mapping) return null;
  const location = boardCardLocation(boardMd, record.card);
  if (!location) return { card: record.card, phase: record.phase, issue: 'card is missing from board' };
  if (location.column !== mapping.column || location.checked !== mapping.complete) {
    return {
      card: record.card, phase: record.phase,
      expected_column: mapping.column, actual_column: location.column,
      expected_checked: mapping.complete, actual_checked: location.checked,
    };
  }
  return null;
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
      await attemptProjection(ctx, record);
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

async function commandClaim(ctx, args) {
  return withLock(ctx, 'selector', async () => {
    if (fs.existsSync(path.join(ctx.root, '.autoloop-halt'))) return { action: 'halted', reason: '.autoloop-halt present' };
    const state = readState(ctx);
    const boardMd = fs.readFileSync(BOARD, 'utf8');
    const selected = selectClaimCandidate({
      boardMd, state,
      loadCard: (card) => { const p = findCard(CARDS_ROOT, card); return p ? { path: p, raw: fs.readFileSync(p, 'utf8') } : null; },
    });
    if (selected.action !== 'claim' || args['dry-run']) return selected;
    const slug = slugify(selected.card);
    const branch = `codex-autoloop/${slug}`;
    const worktree = path.join(ctx.root, '.worktrees', `codex-autoloop-${slug}`);
    sh('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: ctx.root });
    const record = {
      card: selected.card, parent_card: selected.meta.parentCard || null, slice: selected.meta.slice || null,
      phase: 'claimed', model_profile: selected.meta.modelProfile,
      touch_zones: selected.meta.touchZones, dependencies: selected.meta.dependencies,
      deploy_subscriptions: selected.meta.deploySubscriptions, card_path: selected.cardPath,
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
    await attemptProjection(ctx, record);
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
  return gateLock(ctx, `gates-${slugify(card)}`, async () => {
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
  }, { card, staleMs: 60 * 60 * 1000 });
}

async function commandVerifyGates(ctx, args, deps = {}) {
  const card = args.card;
  if (!card) throw new Error('verify-gates requires --card');
  const loadState = deps.readState || readState;
  const run = deps.sh || sh;
  const persist = deps.writeState || writeState;
  const runSelfInstall = deps.runIsolatedWorkshopSelfInstall || runIsolatedWorkshopSelfInstall;
  const gateLock = deps.withLock || withLock;
  return gateLock(ctx, `gates-${slugify(card)}`, async () => {
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
  }, { card, staleMs: 60 * 60 * 1000 });
}

async function commandRecordPr(ctx, args, deps = {}) {
  const card = args.card; const number = Number(args.pr);
  if (!card || !Number.isInteger(number)) throw new Error('record-pr requires --card and numeric --pr');
  const loadState = deps.readState || readState;
  const viewPr = deps.prView || prView;
  const run = deps.sh || sh;
  const persist = deps.writeState || writeState;
  const gateLock = deps.withLock || withLock;
  return gateLock(ctx, `gates-${slugify(card)}`, async () => {
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
  }, { card, staleMs: 60 * 60 * 1000 });
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
    const result = await gateLock(ctx, `gates-${slugify(card)}`, async () => {
      const state = loadState(ctx); const record = state.cards[card];
      if (!record) throw new Error(`card ${card} not in state`);
      return step(ctx, state, record, { dryRun: Boolean(args['dry-run']) });
    }, { card, staleMs: 60 * 60 * 1000 });
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
  const boardMd = opts.boardMd ?? fs.readFileSync(BOARD, 'utf8');
  const loadCard = opts.loadCard || ((card) => {
    const p = findCard(CARDS_ROOT, card);
    return p ? { path: p, raw: fs.readFileSync(p, 'utf8') } : null;
  });
  const next = summarizeClaimSelection(selectClaimCandidate({ boardMd, state, loadCard }));
  const projectionProblems = Object.values(state.cards || {})
    .filter((record) => record.projection_error)
    .map((record) => ({ card: record.card, phase: record.phase, error: record.projection_error }));
  const boardDrift = Object.values(state.cards || {})
    .map((record) => projectionBoardDrift(boardMd, record))
    .filter(Boolean);
  return {
    action: 'status', halted: fs.existsSync(path.join(ctx.root, '.autoloop-halt')),
    active: active.map((r) => ({ card: r.card, phase: r.phase, model_profile: r.model_profile, branch: r.branch, pr: r.feature_pr || null })),
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
  if (args.card && !initialState.cards[args.card]) {
    throw new Error(`reconcile requires a tracked --card; ${args.card} is not tracked`);
  }
  const results = [];
  for (const card of cardNames) {
    try {
      const result = await reconcileLock(ctx, `gates-${slugify(card)}`, async () => {
        const state = loadState(ctx);
        const record = state.cards[card];
        if (!record) return { card, phase: null, ok: false, changed: false, error: 'tracked record disappeared during reconciliation' };
        if (!projectionMapping(record.phase)) {
          return { card: record.card, phase: record.phase, ok: true, changed: false, skipped: 'phase has no board projection' };
        }
        return reconcileLock(ctx, 'completion-projection', async () => {
          const priorError = record.projection_error || null;
          const priorFailedAt = record.projection_failed_at || null;
          try {
            const projected = project(record.card_path, boardPath, record.card, record.phase, { now });
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
            };
          } catch (err) {
            const stateChanged = record.projection_error !== err.message || !record.projection_failed_at;
            record.projection_error = err.message;
            if (stateChanged) record.projection_failed_at = now();
            if (stateChanged) persist(ctx, state, record);
            return { card: record.card, phase: record.phase, ok: false, changed: stateChanged, error: err.message };
          }
        }, { card });
      }, { card });
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

function commandRecover(ctx) {
  const state = readState(ctx); const inspections = [];
  for (const record of activeRecords(state)) {
    if (!record.worktree || !fs.existsSync(record.worktree)) { inspections.push({ card: record.card, issue: 'worktree missing', phase: record.phase }); continue; }
    const dirty = sh('git', ['status', '--short'], { cwd: record.worktree });
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
  else if (command === 'record-review') result = await commandRecordReview(ctx, args);
  else if (command === 'verify-gates') result = await commandVerifyGates(ctx, args);
  else if (command === 'record-pr') result = await commandRecordPr(ctx, args);
  else if (command === 'advance') { await commandAdvance(ctx, args); return; }
  else if (command === 'reconcile') result = await commandReconcile(ctx, args);
  else if (command === 'deploy') {
    const state = readState(ctx); const record = state.cards[args.card];
    if (!record) throw new Error('deploy requires a known --card');
    result = await promoteAndDeploy(ctx, state, record);
  } else if (command === 'recover') result = commandRecover(ctx);
  else throw new Error('usage: codex-coordinator.js status|claim|record-review|verify-gates|record-pr|advance|deploy|reconcile|recover [options]');
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  emptyState, atomicWriteJson, writeState, lockIsStale, lockDirectoryIsStale, normalizeZone, zonesOverlap, conflictsWithActive,
  parseExecutionMeta, validateExecutionMeta, dependencySatisfied, successfulDeploymentReceipts,
  selectClaimCandidate, summarizeClaimSelection, commandStatus, commandReconcile,
  checkRollup, versionFrom, isReleasableTitle, gateReceiptStatus, pathCoveredByTouchZones, releasePrWaitReceipt,
  armFeatureAutoMerge, disableFeatureAutoMerge, runIsolatedWorkshopSelfInstall,
  commandRecordReview, commandVerifyGates, commandRecordPr, commandAdvance, stepCard,
  moveBoardCard, patchFrontmatter, projectCard, attemptProjection, projectionBoardDrift, completionResult,
};

if (require.main === module) {
  main().catch((err) => { console.error(JSON.stringify({ action: 'error', message: err.message, code: err.code || null })); process.exit(1); });
}
