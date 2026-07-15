#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  executeSweep,
  liveProcessPaths,
  sweepContext,
} = require('../../scripts/autoloop/sweep-worktrees');

const MAXBUF = 16 * 1024 * 1024;
let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAXBUF }).trim();
}
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
function item(report, key, target) {
  function canonical(value) {
    const resolved = path.resolve(value);
    try { return fs.realpathSync.native(resolved); }
    catch (_) {
      const parent = path.dirname(resolved);
      return parent === resolved ? resolved : path.join(canonical(parent), path.basename(resolved));
    }
  }
  return (report[key] || []).find((entry) => entry.path === canonical(target));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-worktree-sweep-'));
const repo = path.join(tmp, 'repo');
const remote = path.join(tmp, 'remote.git');
try {
  fs.mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-b', 'main']);
  sh(repo, ['config', 'user.name', 'Sweep Test']);
  sh(repo, ['config', 'user.email', 'sweep@example.invalid']);
  write(path.join(repo, 'tracked.txt'), 'base\n');
  write(path.join(repo, '.gitignore'), 'Ignored/\n');
  sh(repo, ['add', 'tracked.txt', '.gitignore']);
  sh(repo, ['commit', '-m', 'initial']);
  sh(tmp, ['init', '--bare', '--initial-branch', 'main', remote]);
  sh(repo, ['remote', 'add', 'origin', remote]);
  sh(repo, ['push', '-u', 'origin', 'main']);

  const managed = path.join(repo, '.worktrees');
  const claudeManaged = path.join(repo, '.claude', 'worktrees');
  fs.mkdirSync(managed, { recursive: true });
  fs.mkdirSync(claudeManaged, { recursive: true });

  const clean = path.join(managed, 'clean merged');
  sh(repo, ['branch', 'clean-merged']);
  sh(repo, ['worktree', 'add', clean, 'clean-merged']);

  const dirty = path.join(managed, 'dirty');
  sh(repo, ['branch', 'dirty-branch']);
  sh(repo, ['worktree', 'add', dirty, 'dirty-branch']);
  write(path.join(dirty, 'tracked.txt'), 'dirty\n');

  const untracked = path.join(managed, 'untracked');
  sh(repo, ['branch', 'untracked-branch']);
  sh(repo, ['worktree', 'add', untracked, 'untracked-branch']);
  write(path.join(untracked, 'new.txt'), 'preserve me\n');

  const ignored = path.join(managed, 'ignored');
  sh(repo, ['branch', 'ignored-branch']);
  sh(repo, ['worktree', 'add', ignored, 'ignored-branch']);
  write(path.join(ignored, 'Ignored', 'preserve.txt'), 'ignored but still user data\n');

  const unmerged = path.join(managed, 'unmerged');
  sh(repo, ['branch', 'unmerged-branch']);
  sh(repo, ['worktree', 'add', unmerged, 'unmerged-branch']);
  write(path.join(unmerged, 'branch.txt'), 'not on main\n');
  sh(unmerged, ['add', 'branch.txt']);
  sh(unmerged, ['commit', '-m', 'unmerged work']);

  const detached = path.join(managed, 'detached');
  sh(repo, ['worktree', 'add', '--detach', detached, 'origin/main']);

  const locked = path.join(managed, 'locked');
  sh(repo, ['branch', 'locked-branch']);
  sh(repo, ['worktree', 'add', locked, 'locked-branch']);
  sh(repo, ['worktree', 'lock', '--reason', 'behavioral test', locked]);

  const active = path.join(managed, 'active-coordinator');
  sh(repo, ['branch', 'active-branch']);
  sh(repo, ['worktree', 'add', active, 'active-branch']);
  const parked = path.join(managed, 'parked-coordinator');
  sh(repo, ['branch', 'parked-branch']);
  sh(repo, ['worktree', 'add', parked, 'parked-branch']);
  const inUse = path.join(managed, 'live-process');
  sh(repo, ['branch', 'live-process-branch']);
  sh(repo, ['worktree', 'add', inUse, 'live-process-branch']);
  const knownDirty = path.join(managed, 'autoloop-bug-meetings-hub-cards-cold-load-guard');
  sh(repo, ['branch', 'known-dirty-branch']);
  sh(repo, ['worktree', 'add', knownDirty, 'known-dirty-branch']);
  write(path.join(knownDirty, 'legacy.txt'), 'must survive\n');
  const ctx = sweepContext(repo);
  write(ctx.statePath, `${JSON.stringify({
    schema_version: 1,
    cards: {
      Active: { card: 'Active', phase: 'implementing', worktree: active },
      Parked: { card: 'Parked', phase: 'parked', worktree: parked },
    },
  }, null, 2)}\n`);

  const outside = path.join(tmp, 'outside-managed-roots');
  sh(repo, ['branch', 'outside-branch']);
  sh(repo, ['worktree', 'add', outside, 'outside-branch']);

  const plan = executeSweep({
    repo,
    currentWorktree: repo,
    processPaths: [{ pid: 4242, path: path.join(inUse, 'tracked.txt') }],
  });
  const cleanItem = item(plan, 'safe_to_remove', clean);
  check('clean, merged worktree is planned for removal', !!cleanItem, JSON.stringify(plan.inventory));
  check('path with spaces survives structured parsing', !!cleanItem && cleanItem.branch === 'clean-merged');
  check('tracked dirty worktree is preserved', !!item(plan, 'dirty', dirty) && fs.existsSync(dirty));
  check('untracked file makes a worktree dirty and preserved', !!item(plan, 'dirty', untracked) && fs.existsSync(path.join(untracked, 'new.txt')));
  check('ignored untracked content makes a worktree dirty and preserved',
    !!item(plan, 'dirty', ignored) && fs.existsSync(path.join(ignored, 'Ignored', 'preserve.txt')));
  check('unmerged branch is preserved', !!item(plan, 'unmerged', unmerged) && fs.existsSync(unmerged));
  check('detached worktree is preserved', !!item(plan, 'detached', detached) && fs.existsSync(detached));
  check('Git-locked worktree is preserved', !!item(plan, 'locked', locked) && fs.existsSync(locked));
  check('active coordinator worktree is preserved', !!item(plan, 'active_or_in_use', active) && fs.existsSync(active));
  check('parked coordinator worktree is preserved', !!item(plan, 'active_or_in_use', parked) && fs.existsSync(parked));
  check('worktree used by a live process is preserved', !!item(plan, 'active_or_in_use', inUse) && fs.existsSync(inUse));
  check('known dirty legacy worktree is explicitly preserved for inspection',
    !!item(plan, 'needs_inspection', knownDirty) && fs.existsSync(path.join(knownDirty, 'legacy.txt')));
  check('outside registered path is reported without inspection', !!item(plan, 'outside_managed_roots', outside) && fs.existsSync(outside));
  check('all unsafe managed worktrees flow to needs inspection',
    [dirty, untracked, ignored, unmerged, detached, locked, active, parked, inUse, knownDirty]
      .every((p) => item(plan, 'needs_inspection', p)));
  const sameUseDifferentPid = executeSweep({
    repo,
    currentWorktree: repo,
    processPaths: [{ pid: 9898, path: path.join(inUse, 'tracked.txt') }],
  });
  check('transient PID changes do not invalidate an otherwise identical plan',
    sameUseDifferentPid.inventory_digest === plan.inventory_digest);
  const tamperedPlan = JSON.parse(JSON.stringify(plan));
  tamperedPlan.safe_to_remove.push(plan.outside_managed_roots[0]);
  const tamperedRefusal = executeSweep({
    repo,
    mode: 'apply',
    plan: tamperedPlan,
    currentWorktree: repo,
    processPaths: [{ pid: 4242, path: path.join(inUse, 'tracked.txt') }],
  });
  check('apply rejects a candidate set altered after dry-run',
    tamperedRefusal.action === 'refused-invalid-plan' && fs.existsSync(clean));

  const changed = path.join(claudeManaged, 'changes-after-plan');
  sh(repo, ['branch', 'changes-after-plan']);
  sh(repo, ['worktree', 'add', changed, 'changes-after-plan']);
  const changedPlan = executeSweep({ repo, currentWorktree: repo, processPaths: [] });
  write(path.join(changed, 'late.txt'), 'changed after dry-run\n');
  const refused = executeSweep({
    repo,
    mode: 'apply',
    plan: changedPlan,
    currentWorktree: repo,
    processPaths: [],
  });
  check('state change between plan and apply refuses the whole plan', refused.action === 'refused-state-changed');
  check('state-change refusal removes no planned candidate', fs.existsSync(clean) && fs.existsSync(changed));

  fs.unlinkSync(path.join(changed, 'late.txt'));
  const otherCandidatePlan = executeSweep({ repo, currentWorktree: repo, processPaths: [] });
  let otherCandidateMutation = null;
  let protectedFirstCandidate = null;
  const wholeInventoryRefusal = executeSweep({
    repo,
    mode: 'apply',
    plan: otherCandidatePlan,
    currentWorktree: repo,
    processPaths: [],
    beforeRemove(candidate, index) {
      if (index !== 0) return;
      protectedFirstCandidate = candidate.path;
      const other = otherCandidatePlan.safe_to_remove.find((entry) => entry.path !== candidate.path);
      otherCandidateMutation = path.join(other.path, 'other-candidate-changed.txt');
      write(otherCandidateMutation, 'different candidate changed during apply\n');
    },
  });
  check('any remaining-inventory drift stops before the current removal',
    wholeInventoryRefusal.action === 'stopped-state-changed'
      && wholeInventoryRefusal.removed.length === 0
      && protectedFirstCandidate && fs.existsSync(protectedFirstCandidate)
      && otherCandidateMutation && fs.existsSync(otherCandidateMutation));
  fs.unlinkSync(otherCandidateMutation);

  const immediatePlan = executeSweep({ repo, currentWorktree: repo, processPaths: [] });
  let immediateMutation = null;
  const immediateRefusal = executeSweep({
    repo,
    mode: 'apply',
    plan: immediatePlan,
    currentWorktree: repo,
    processPaths: [],
    beforeRemove(candidate, index) {
      if (index !== 0) return;
      immediateMutation = path.join(candidate.path, 'changed-during-apply.txt');
      write(immediateMutation, 'changed immediately before removal\n');
    },
  });
  check('every candidate is revalidated immediately before removal',
    immediateRefusal.action === 'stopped-state-changed'
      && immediateRefusal.removed.length === 0
      && immediateMutation && fs.existsSync(immediateMutation));
  fs.unlinkSync(immediateMutation);

  const applyPlan = executeSweep({ repo, currentWorktree: repo, processPaths: [] });
  const applied = executeSweep({
    repo,
    mode: 'apply',
    plan: applyPlan,
    currentWorktree: repo,
    processPaths: [],
  });
  check('apply removes clean merged candidates with plain git worktree remove',
    applied.action === 'applied' && !!item(applied, 'removed', clean) && !!item(applied, 'removed', changed));
  check('removed paths are gone but branches remain',
    !fs.existsSync(clean) && !fs.existsSync(changed)
      && sh(repo, ['show-ref', '--verify', '--quiet', 'refs/heads/clean-merged']) === '');
  const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/autoloop/sweep-worktrees.js'), 'utf8');
  check('removal command is statically pinned to git worktree remove without force',
    source.includes("git(ctx.root, ['worktree', 'remove', '--', planned.path])")
      && !/worktree['"],\s*['"]remove['"],\s*['"]--force/.test(source));

  const currentManaged = path.join(claudeManaged, 'current execution');
  sh(repo, ['branch', 'current-execution-branch']);
  sh(repo, ['worktree', 'add', currentManaged, 'current-execution-branch']);
  const currentPlan = executeSweep({ repo, currentWorktree: currentManaged, processPaths: [] });
  check('managed current execution worktree is classified active and needs inspection',
    !!item(currentPlan, 'active_or_in_use', currentManaged)
      && !!item(currentPlan, 'needs_inspection', currentManaged));
  const currentApply = executeSweep({
    repo,
    mode: 'apply',
    plan: currentPlan,
    currentWorktree: currentManaged,
    processPaths: [],
  });
  check('apply preserves a clean merged managed current execution worktree',
    currentApply.action === 'applied' && fs.existsSync(currentManaged));

  const incompleteLsof = liveProcessPaths(ctx, () => ({
    status: 1,
    stdout: '',
    stderr: "lsof: WARNING: can't opendir unreadable: Permission denied\n",
    error: null,
  }));
  check('lsof warnings make process detection fail closed',
    /scan incomplete/.test(incompleteLsof.error || ''));
  const incompleteScanPlan = executeSweep({
    repo,
    currentWorktree: currentManaged,
    processScanner: () => ({ paths: [], error: 'live-process scan incomplete: permission denied' }),
  });
  check('an incomplete process scan leaves no removable worktree',
    incompleteScanPlan.safe_to_remove.length === 0
      && incompleteScanPlan.needs_inspection.length === incompleteScanPlan.inventory.length);

  const noop = executeSweep({ repo, currentWorktree: currentManaged, processPaths: [] });
  check('repeat dry-run is a clean no-op for removable candidates', noop.safe_to_remove.length === 0);

  function holdLock(name) {
    const lock = path.join(ctx.locksDir, `${name}.lock`);
    fs.mkdirSync(lock, { recursive: true });
    write(path.join(lock, 'owner.json'), `${JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      started_at: new Date().toISOString(),
      command: `held ${name} behavioral test`,
    })}\n`);
    return lock;
  }
  function dropHeldLock(lock) {
    fs.unlinkSync(path.join(lock, 'owner.json'));
    fs.rmdirSync(lock);
  }

  const selectorLock = holdLock('selector');
  const selectorRefusal = executeSweep({ repo, currentWorktree: currentManaged, processPaths: [] });
  check('a concurrent claim selector lock refuses the sweep and releases its partial lock',
    selectorRefusal.action === 'refused-concurrent' && selectorRefusal.lock === 'selector'
      && !fs.existsSync(path.join(ctx.locksDir, 'worktree-sweep.lock')));
  dropHeldLock(selectorLock);

  const promotionLock = holdLock('homebrew-promotion');
  const promotionRefusal = executeSweep({ repo, currentWorktree: currentManaged, processPaths: [] });
  check('a concurrent deployment lock refuses the sweep and releases earlier locks',
    promotionRefusal.action === 'refused-concurrent' && promotionRefusal.lock === 'homebrew-promotion'
      && !fs.existsSync(path.join(ctx.locksDir, 'worktree-sweep.lock'))
      && !fs.existsSync(path.join(ctx.locksDir, 'selector.lock')));
  dropHeldLock(promotionLock);

  const lockRoot = holdLock('worktree-sweep');
  const lockRefusal = executeSweep({ repo, currentWorktree: repo, processPaths: [] });
  check('concurrent sweep is refused with lock owner evidence',
    lockRefusal.action === 'refused-concurrent' && lockRefusal.lock === 'worktree-sweep');
  dropHeldLock(lockRoot);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nrun-worktree-sweep: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
