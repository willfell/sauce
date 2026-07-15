#!/usr/bin/env node
/**
 * Deterministic, supervised cleanup for registered Sauce worktrees.
 * Dry-run is the default. Apply requires the exact saved JSON plan.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const MAXBUF = 64 * 1024 * 1024;
const LOCK_NAMES = ['worktree-sweep', 'selector', 'homebrew-promotion'];
const TERMINAL_PHASES = new Set(['deployed', 'blocked', 'failed', 'cancelled']);
const REPORT_KEYS = [
  'safe_to_remove', 'removed', 'dirty', 'unmerged', 'locked',
  'active_or_in_use', 'detached', 'outside_managed_roots', 'needs_inspection',
];

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: options.encoding === null ? null : 'utf8',
    maxBuffer: MAXBUF,
    stdio: options.stdio || 'pipe',
  });
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try { return fs.realpathSync.native(resolved); }
  catch (_) {
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    return path.join(canonicalPath(parent), path.basename(resolved));
  }
}

function sweepContext(cwd = process.cwd()) {
  const commonDir = canonicalPath(String(git(cwd, [
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ])).trim());
  const root = path.dirname(commonDir);
  const stateDir = path.join(commonDir, 'sauce-autoloop');
  return {
    root,
    commonDir,
    stateDir,
    statePath: path.join(stateDir, 'state.json'),
    locksDir: path.join(stateDir, 'locks'),
    managedRoots: [path.join(root, '.worktrees'), path.join(root, '.claude', 'worktrees')],
  };
}

function parseWorktreeList(buffer) {
  const records = [];
  let current = null;
  const fields = buffer.toString('utf8').split('\0').flatMap((record) => record.split('\n'));
  for (const field of fields) {
    if (!field) continue;
    if (field.startsWith('worktree ')) {
      if (current) records.push(current);
      current = { path: canonicalPath(field.slice('worktree '.length)) };
    } else if (current && field.startsWith('HEAD ')) current.head = field.slice(5);
    else if (current && field.startsWith('branch ')) current.branch_ref = field.slice(7);
    else if (current && field === 'detached') current.detached = true;
    else if (current && field.startsWith('locked')) current.lock_reason = field.slice(6).trim() || 'Git worktree lock';
    else if (current && field.startsWith('prunable')) current.prunable_reason = field.slice(8).trim() || 'prunable registration';
    else if (current && field === 'bare') current.bare = true;
  }
  if (current) records.push(current);
  return records;
}

function inside(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function digestInventory(inventory) {
  return crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

function validatePlan(plan) {
  if (!plan || plan.schema_version !== 1 || plan.tool !== 'sauce-worktree-sweep'
    || plan.mode !== 'dry-run' || plan.action !== 'dry-run' || !Array.isArray(plan.inventory)
    || !Array.isArray(plan.safe_to_remove)) return 'apply requires an unmodified dry-run JSON plan';
  const digest = digestInventory(plan.inventory);
  if (digest !== plan.inventory_digest || digest !== plan.plan_id) return 'plan inventory digest is invalid';
  const paths = plan.inventory.map((entry) => entry && entry.path);
  if (paths.some((value) => typeof value !== 'string') || new Set(paths).size !== paths.length) {
    return 'plan inventory paths are invalid or duplicated';
  }
  const project = (entry) => ({
    path: entry.path, branch: entry.branch, head: entry.head, fingerprint: entry.fingerprint,
  });
  const derived = plan.inventory.filter((entry) => entry.classification === 'safe_to_remove').map(project);
  const supplied = plan.safe_to_remove.map(project);
  if (JSON.stringify(derived) !== JSON.stringify(supplied)) return 'safe candidate set does not match plan inventory';
  if (plan.inventory.some((entry) => entry.classification === 'safe_to_remove'
    && (!Array.isArray(entry.reasons) || entry.reasons.length !== 0
      || entry.merged_into_origin_main !== true || !entry.branch))) {
    return 'safe candidate classification is inconsistent';
  }
  return null;
}

function readActiveOwners(ctx) {
  if (!fs.existsSync(ctx.statePath)) return { owners: new Map(), error: null };
  try {
    const state = JSON.parse(fs.readFileSync(ctx.statePath, 'utf8'));
    if (!state || state.schema_version !== 1 || !state.cards || typeof state.cards !== 'object') {
      throw new Error('unsupported state contract');
    }
    const owners = new Map();
    for (const record of Object.values(state.cards)) {
      if (!record || !record.worktree || TERMINAL_PHASES.has(record.phase)) continue;
      const resolved = canonicalPath(record.worktree);
      if (!owners.has(resolved)) owners.set(resolved, []);
      owners.get(resolved).push({ card: record.card || 'unknown', phase: record.phase || 'unknown' });
    }
    for (const value of owners.values()) value.sort((a, b) => a.card.localeCompare(b.card));
    return { owners, error: null };
  } catch (error) {
    return { owners: new Map(), error: `autoloop state unreadable: ${error.message}` };
  }
}

function parseLsof(output) {
  const found = [];
  let pid = null;
  for (const line of String(output || '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1)) || null;
    else if (line.startsWith('n') && line.length > 1) found.push({ pid, path: canonicalPath(line.slice(1)) });
  }
  return found;
}

function liveProcessPaths(ctx, run = spawnSync) {
  const found = [];
  const commands = [['-a', '-d', 'cwd', '-F', 'pn']];
  for (const root of ctx.managedRoots) if (fs.existsSync(root)) commands.push(['-F', 'pn', '+D', root]);
  for (const args of commands) {
    const result = run('lsof', args, { encoding: 'utf8', maxBuffer: MAXBUF });
    if (result.error) return { paths: [], error: `live-process scan failed: ${result.error.message}` };
    if (String(result.stderr || '').trim()) {
      return { paths: [], error: `live-process scan incomplete: ${String(result.stderr).trim()}` };
    }
    if (result.status !== 0 && result.status !== 1) {
      return { paths: [], error: `live-process scan failed with exit ${result.status}` };
    }
    found.push(...parseLsof(result.stdout));
  }
  const unique = new Map(found.map((entry) => [`${entry.pid || ''}:${entry.path}`, entry]));
  return { paths: [...unique.values()].sort((a, b) => a.path.localeCompare(b.path)), error: null };
}

function statusResult(cwd, args) {
  try { return { ok: true, output: git(cwd, args, { encoding: null }) }; }
  catch (error) { return { ok: false, error: String(error.stderr || error.message).trim() }; }
}

function inspectManaged(record, ctx, options, active, processes, globalErrors, baseSha) {
  const entry = {
    path: record.path,
    branch: record.branch_ref ? record.branch_ref.replace(/^refs\/heads\//, '') : null,
    head: record.head || null,
    reasons: [],
  };
  const add = (reason) => { if (!entry.reasons.includes(reason)) entry.reasons.push(reason); };
  if (record.prunable_reason) add(`prunable: ${record.prunable_reason}`);
  if (record.lock_reason) add(`locked: ${record.lock_reason}`);
  if (record.detached || !record.branch_ref) add('detached');
  if (record.path === path.resolve(options.currentWorktree)) add('current execution worktree');
  if (record.path === ctx.root) add('main checkout');
  if (record.path === path.join(ctx.root, '.worktrees', 'autoloop-bug-meetings-hub-cards-cold-load-guard')) {
    add('known dirty legacy worktree; preserve for inspection');
  }
  for (const owner of active.owners.get(record.path) || []) add(`autoloop ${owner.phase}: ${owner.card}`);
  for (const process of processes.paths) if (inside(process.path, record.path)) add('live process uses worktree');
  for (const error of globalErrors) add(error);

  const dirty = statusResult(record.path, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching',
  ]);
  if (!dirty.ok) add(`status inspection failed: ${dirty.error}`);
  else if (dirty.output.length) add('dirty including untracked or ignored files');

  const branch = statusResult(record.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch.ok) add('detached');
  else if (branch.output.toString('utf8').trim() !== entry.branch) add('branch registration changed');

  const head = statusResult(record.path, ['rev-parse', 'HEAD']);
  if (!head.ok) add(`HEAD inspection failed: ${head.error}`);
  else if (head.output.toString('utf8').trim() !== entry.head) add('HEAD registration changed');

  const merged = statusResult(record.path, ['merge-base', '--is-ancestor', 'HEAD', baseSha || 'origin/main']);
  if (!merged.ok) add('unmerged branch');
  entry.status_fingerprint = dirty.ok ? crypto.createHash('sha256').update(dirty.output).digest('hex') : null;
  entry.merged_into_origin_main = merged.ok;
  entry.reasons.sort();
  entry.fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    path: entry.path,
    branch: entry.branch,
    head: entry.head,
    lock: record.lock_reason || null,
    prunable: record.prunable_reason || null,
    reasons: entry.reasons,
    status: entry.status_fingerprint,
    merged: entry.merged_into_origin_main,
  })).digest('hex');
  return entry;
}

function emptyReport(ctx, mode) {
  return Object.assign({
    schema_version: 1,
    tool: 'sauce-worktree-sweep',
    mode,
    action: mode === 'apply' ? 'pending' : 'dry-run',
    workshop_root: ctx.root,
    managed_roots: ctx.managedRoots,
    base_ref: 'origin/main',
    base_sha: null,
    inventory: [],
  }, Object.fromEntries(REPORT_KEYS.map((key) => [key, []])));
}

function buildReport(ctx, options = {}) {
  const report = emptyReport(ctx, options.mode || 'dry-run');
  try { report.base_sha = String(git(ctx.root, ['rev-parse', 'origin/main'])).trim(); }
  catch (error) { report.base_error = `origin/main unavailable: ${String(error.stderr || error.message).trim()}`; }
  const records = parseWorktreeList(git(ctx.root, ['worktree', 'list', '--porcelain', '-z'], { encoding: null }));
  const active = readActiveOwners(ctx);
  const processes = options.processPaths === undefined
    ? liveProcessPaths(ctx)
    : { paths: options.processPaths.map((value) => typeof value === 'string'
      ? { pid: null, path: canonicalPath(value) }
      : { pid: value.pid || null, path: canonicalPath(value.path) }), error: null };
  const globalErrors = [report.base_error, active.error, processes.error].filter(Boolean);

  for (const record of records.sort((a, b) => a.path.localeCompare(b.path))) {
    let resolved = record.path;
    try { resolved = canonicalPath(record.path); } catch (_) { /* inspection below fails closed */ }
    const managed = ctx.managedRoots.some((root) => inside(record.path, root) && inside(resolved, root));
    if (!managed) {
      const outside = {
        path: record.path,
        branch: record.branch_ref ? record.branch_ref.replace(/^refs\/heads\//, '') : null,
        head: record.head || null,
        reasons: [record.path === ctx.root ? 'main checkout' : 'outside managed roots'],
      };
      outside.fingerprint = crypto.createHash('sha256').update(JSON.stringify(outside)).digest('hex');
      report.outside_managed_roots.push(outside);
      report.needs_inspection.push(outside);
      if (record.path === ctx.root) report.active_or_in_use.push(outside);
      report.inventory.push({ ...outside, classification: 'outside_managed_roots' });
      continue;
    }
    const entry = inspectManaged(record, ctx, options, active, processes, globalErrors, report.base_sha);
    const reasonText = entry.reasons.join('\n');
    if (/dirty including untracked or ignored/.test(reasonText)) report.dirty.push(entry);
    if (/unmerged branch/.test(reasonText)) report.unmerged.push(entry);
    if (/^locked:/m.test(reasonText)) report.locked.push(entry);
    if (/current execution|main checkout|autoloop |live process/.test(reasonText)) report.active_or_in_use.push(entry);
    if (/detached/.test(reasonText)) report.detached.push(entry);
    if (entry.reasons.length) report.needs_inspection.push(entry);
    else report.safe_to_remove.push(entry);
    report.inventory.push({ ...entry, classification: entry.reasons.length ? 'needs_inspection' : 'safe_to_remove' });
  }
  for (const key of REPORT_KEYS) report[key].sort((a, b) => a.path.localeCompare(b.path));
  report.inventory_digest = digestInventory(report.inventory);
  report.plan_id = report.inventory_digest;
  return report;
}

function pidAlive(pid) {
  try { process.kill(Number(pid), 0); return Number(pid) > 0; } catch (_) { return false; }
}

function removeLockDirectory(lockPath) {
  const ownerPath = path.join(lockPath, 'owner.json');
  try { fs.unlinkSync(ownerPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.rmdirSync(lockPath);
}

function acquireLock(ctx, name, now = Date.now()) {
  fs.mkdirSync(ctx.locksDir, { recursive: true });
  const lockPath = path.join(ctx.locksDir, `${name}.lock`);
  try { fs.mkdirSync(lockPath); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')); } catch (_) {}
    const age = owner && owner.started_at ? now - Date.parse(owner.started_at) : 0;
    const stale = Number.isFinite(age) && age > 30 * 60 * 1000
      && (!owner.host || owner.host === os.hostname()) && !pidAlive(owner.pid);
    if (!stale) {
      const held = new Error(`lock ${name} is held`);
      held.code = 'LOCKED'; held.lock = name; held.owner = owner; throw held;
    }
    removeLockDirectory(lockPath);
    fs.mkdirSync(lockPath);
  }
  fs.writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify({
    pid: process.pid,
    host: os.hostname(),
    started_at: new Date(now).toISOString(),
    command: process.argv.slice(2).join(' '),
  }, null, 2)}\n`);
  return { name, lockPath };
}

function acquireSweepLocks(ctx) {
  const held = [];
  try {
    for (const name of LOCK_NAMES) held.push(acquireLock(ctx, name));
    return held;
  } catch (error) {
    for (const lock of held.reverse()) removeLockDirectory(lock.lockPath);
    throw error;
  }
}

function releaseSweepLocks(held) {
  for (const lock of [...held].reverse()) removeLockDirectory(lock.lockPath);
}

function executeSweep(options = {}) {
  const mode = options.mode === 'apply' ? 'apply' : 'dry-run';
  const ctx = sweepContext(options.repo || process.cwd());
  const currentWorktree = canonicalPath(options.currentWorktree || String(git(process.cwd(), ['rev-parse', '--show-toplevel'])).trim());
  let held;
  try { held = acquireSweepLocks(ctx); }
  catch (error) {
    const report = emptyReport(ctx, mode);
    report.action = 'refused-concurrent';
    report.lock = error.lock || 'unknown';
    report.lock_owner = error.owner || null;
    report.error = error.message;
    return report;
  }
  try {
    const runOptions = { ...options, mode, currentWorktree };
    const report = buildReport(ctx, runOptions);
    if (mode === 'dry-run') return report;
    const planError = validatePlan(options.plan);
    if (planError) {
      report.action = 'refused-invalid-plan';
      report.error = planError;
      return report;
    }
    if (options.plan.inventory_digest !== report.inventory_digest
      || options.plan.base_sha !== report.base_sha) {
      report.action = 'refused-state-changed';
      report.planned_inventory_digest = options.plan.inventory_digest || null;
      report.current_inventory_digest = report.inventory_digest;
      return report;
    }

    const removed = [];
    const plannedCandidates = options.plan.inventory.filter((entry) => entry.classification === 'safe_to_remove');
    for (const planned of plannedCandidates) {
      if (typeof options.beforeRemove === 'function') options.beforeRemove(planned, removed.length);
      const latest = buildReport(ctx, runOptions);
      const candidate = latest.safe_to_remove.find((entry) => entry.path === planned.path);
      if (!candidate || candidate.fingerprint !== planned.fingerprint) {
        latest.action = 'stopped-state-changed';
        latest.removed = removed;
        latest.changed_candidate = planned.path;
        return latest;
      }
      try { git(ctx.root, ['worktree', 'remove', '--', planned.path]); }
      catch (error) {
        const stopped = buildReport(ctx, runOptions);
        stopped.action = 'stopped-removal-error';
        stopped.removed = removed;
        stopped.removal_error = { path: planned.path, error: String(error.stderr || error.message).trim() };
        return stopped;
      }
      removed.push({ ...planned, removed_at: new Date().toISOString() });
    }
    const final = buildReport(ctx, runOptions);
    final.action = 'applied';
    final.removed = removed;
    final.applied_plan_id = options.plan.plan_id;
    return final;
  } finally {
    releaseSweepLocks(held);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--apply') { out.mode = 'apply'; continue; }
    if (token === '--dry-run') { out.mode = 'dry-run'; continue; }
    if (token === '--repo' || token === '--plan' || token === '--output') { out[token.slice(2)] = argv[++i]; continue; }
    throw new Error(`unknown argument ${token}`);
  }
  return out;
}

module.exports = {
  acquireSweepLocks,
  buildReport,
  executeSweep,
  liveProcessPaths,
  parseWorktreeList,
  releaseSweepLocks,
  sweepContext,
};

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = args.plan ? JSON.parse(fs.readFileSync(path.resolve(args.plan), 'utf8')) : null;
    const report = executeSweep({ repo: args.repo, mode: args.mode, plan });
    if (args.output) {
      const output = path.resolve(args.output);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const temp = `${output}.${process.pid}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`);
      fs.renameSync(temp, output);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.action === 'dry-run' || report.action === 'applied' ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ action: 'error', error: error.message }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
