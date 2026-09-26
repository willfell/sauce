// platform/engine/isolation.js — per-node git worktree isolation. Filesystem
// and branch isolation only: the worker keeps the user's local privileges.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function git(repo, args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {})).trim();
}

function branchExists(repo, branch) {
  try { git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); return true; }
  catch (_e) { return false; }
}

function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch (_e) { return path.resolve(p); }
}

function worktreeRegistered(repo, dest) {
  const abs = realOrResolved(dest);
  return git(repo, ['worktree', 'list', '--porcelain']).split('\n').some((l) => l.startsWith('worktree ') && realOrResolved(l.slice(9)) === abs);
}

// Create (or reuse) the worktree at `dest` on `branch`, branching from
// `base` when the branch does not exist yet.
function createWorktree({ repo, dest, branch, base }) {
  const abs = path.resolve(dest);
  if (fs.existsSync(abs) && worktreeRegistered(repo, abs)) return { path: abs, branch, created: false };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const args = branchExists(repo, branch)
    ? ['worktree', 'add', abs, branch]
    : ['worktree', 'add', '-b', branch, abs, base || 'HEAD'];
  git(repo, args);
  return { path: abs, branch, created: true };
}

function removeWorktree({ repo, path: wt, force }) {
  const abs = path.resolve(wt);
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(abs);
  try { git(repo, args); }
  catch (e) {
    if (!fs.existsSync(abs)) { git(repo, ['worktree', 'prune']); return; }
    throw e;
  }
}

function worktreeBranch(repo, wt) {
  try { return git(wt, ['rev-parse', '--abbrev-ref', 'HEAD']); }
  catch (_e) { return null; }
}

// null means "could not measure" — the sweep treats that as carrying work,
// never as empty. Failing open here would delete unmerged commits.
function commitsAhead(repo, branch, baseRef) {
  try {
    const n = parseInt(git(repo, ['rev-list', '--count', `${baseRef}..${branch}`]), 10);
    return Number.isFinite(n) ? n : null;
  } catch (_e) { return null; }
}

function isDirty(wt) {
  try { return git(wt, ['status', '--porcelain']).length > 0; }
  catch (_e) { return true;
  }
}

// Remove finished worktrees that carry nothing: clean tree, no commits ahead
// of baseRef. Everything else is kept with a reason.
function sweep({ repo, worktrees, baseRef }) {
  const removed = [], kept = [];
  const base = baseRef || 'origin/main';
  for (const wt of worktrees || []) {
    const abs = path.resolve(wt);
    if (!fs.existsSync(abs)) { git(repo, ['worktree', 'prune']); continue; }
    const branch = worktreeBranch(repo, abs);
    if (isDirty(abs)) { kept.push({ path: abs, reason: 'dirty working tree' }); continue; }
    if (!branch || branch === 'HEAD') { kept.push({ path: abs, reason: 'detached HEAD — cannot prove its commits are merged' }); continue; }
    const ahead = commitsAhead(repo, branch, base);
    if (ahead === null) { kept.push({ path: abs, reason: `cannot measure commits ahead of ${base}` }); continue; }
    if (ahead > 0) { kept.push({ path: abs, reason: `${ahead} commit(s) ahead of ${base}` }); continue; }
    removeWorktree({ repo, path: abs, force: false });
    if (branch && branch !== 'HEAD') { try { git(repo, ['branch', '-D', branch]); } catch (_e) { /* branch may be checked out elsewhere */ } }
    removed.push(abs);
  }
  return { removed, kept };
}

function defaultBase(repo) {
  try { git(repo, ['rev-parse', '--verify', '--quiet', 'origin/main']); return 'origin/main'; }
  catch (_e) { return 'HEAD'; }
}

module.exports = { createWorktree, removeWorktree, sweep, defaultBase, worktreeBranch, git };
