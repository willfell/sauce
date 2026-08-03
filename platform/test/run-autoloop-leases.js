#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const delivery = require('../mechanisms/delivery');

const coordinatorModulePath = require.resolve('../../scripts/autoloop/codex-coordinator');
const {
  leaseIsLive, leaseSummary, acquireLease, clearLease, LEASE_TTL_MS, commandResume, commandClaim,
} = require(coordinatorModulePath);

let count = 0;
function ok(value, label) { assert.ok(value, label); count += 1; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); count += 1; }

// commandClaim hardcodes BOARD/CARDS_ROOT from the SAUCE_LOOP_BOARD /
// SAUCE_LOOP_CARDS_ROOT env seam at module load time and has no
// readState/writeState/findCard/sh dependency seam of its own — driving it
// for real needs a fresh module instance bound to an isolated fixture, never
// the real repo's bound board. Mirrors the cache-safe reimport already used
// by run-codex-autoloop.js for its own topology-prewarm coverage.
async function withFreshCoordinator(envOverrides, fn) {
  const prevEnv = {};
  for (const key of Object.keys(envOverrides)) prevEnv[key] = process.env[key];
  const hadCache = Object.prototype.hasOwnProperty.call(require.cache, coordinatorModulePath);
  const prevCacheEntry = require.cache[coordinatorModulePath];
  try {
    Object.assign(process.env, envOverrides);
    delete require.cache[coordinatorModulePath];
    const fresh = require(coordinatorModulePath);
    return await fn(fresh);
  } finally {
    delete require.cache[coordinatorModulePath];
    if (hadCache) require.cache[coordinatorModulePath] = prevCacheEntry;
    for (const key of Object.keys(envOverrides)) {
      if (prevEnv[key] === undefined) delete process.env[key]; else process.env[key] = prevEnv[key];
    }
  }
}

(async () => {
  // --- pure helpers ---
  const T0 = Date.parse('2026-08-02T10:00:00.000Z');
  const mkLease = (over = {}) => ({ token: 'tok-1', acquired_at: new Date(T0).toISOString(),
    renewed_at: new Date(T0).toISOString(), holder: { host: 'mac-a', label: 'chat-1' }, ...over });

  eq(leaseIsLive(undefined, T0), false, 'no lease is not live');
  eq(leaseIsLive(mkLease(), T0 + 1000), true, 'fresh lease live');
  eq(leaseIsLive(mkLease(), T0 + LEASE_TTL_MS), false, 'TTL boundary stale');
  eq(leaseIsLive(mkLease(), T0 - 1000), false, 'future-skewed lease stale');
  eq(leaseIsLive({ token: 'x', renewed_at: 'garbage' }, T0), false, 'garbage renewed_at stale');
  const summ = leaseSummary(mkLease(), T0 + 60000);
  eq(summ.held, true, 'summary held'); eq(summ.age_ms, 60000, 'summary age');
  eq(summ.expires_in_ms, LEASE_TTL_MS - 60000, 'summary expiry');
  eq(leaseSummary(undefined, T0), null, 'no lease → null summary');

  // --- acquire / clear ---
  const rec = { card: 'X', phase: 'implementing' };
  const nowIso = () => new Date(T0).toISOString();
  acquireLease(rec, { now: nowIso, token: 'tok-A', label: 'chat-1' });
  eq(rec.lease.token, 'tok-A', 'acquire stamps token');
  ok(rec.lease.holder.host && typeof rec.lease.holder.host === 'string', 'acquire stamps host');
  eq(clearLease(rec, 'test-clear', nowIso), true, 'clear returns true');
  eq(rec.lease, undefined, 'lease removed');
  eq(rec.lease_breaks.length, 1, 'audit appended');
  eq(rec.lease_breaks[0].previous_token, 'tok-A', 'audit records token');
  eq(clearLease(rec, 'again', nowIso), false, 'clear is idempotent');

  const immediateLock = async (_ctx, _name, fn) => fn();

  // attach: resume on an ACTIVE (implementing) unleased card acquires, no phase side effects
  {
    const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', branch: 'b', worktree: '/w' } } };
    let writes = 0;
    const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'A' }, {
      readState: () => state, writeState: () => { writes++; }, withLock: immediateLock,
      now: () => new Date(T0).toISOString(), leaseNowMs: () => T0, leaseToken: () => 'tok-A1',
    });
    eq(receipt.action, 'attach', 'active unleased resume attaches');
    eq(receipt.lease_token, 'tok-A1', 'attach returns token');
    eq(state.cards.A.phase, 'implementing', 'attach does not touch phase');
    ok(!state.cards.A.resumed_at, 'attach does not stamp resumed_at');
    ok(writes >= 1, 'attach persists the lease');
  }
  // attach refusal: live lease held by someone else
  {
    const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', lease: mkLease() } } };
    await assert.rejects(
      () => commandResume({ root: '/ws' }, { json: true, card: 'A' }, {
        readState: () => state, writeState: () => {}, withLock: immediateLock,
        now: () => new Date(T0 + 60000).toISOString(), leaseNowMs: () => T0 + 60000, leaseToken: () => 'tok-A2',
      }),
      (err) => err && err.code === 'lease_held', 'live foreign lease refuses attach'); count++;
  }
  // attach renew: same token is idempotent + renews
  {
    const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', lease: mkLease() } } };
    const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'A', 'lease-token': 'tok-1' }, {
      readState: () => state, writeState: () => {}, withLock: immediateLock,
      now: () => new Date(T0 + 60000).toISOString(), leaseNowMs: () => T0 + 60000, leaseToken: () => 'unused',
    });
    eq(receipt.action, 'attach', 'same-token attach ok');
    eq(receipt.no_op, true, 'same-token attach is no_op');
    eq(state.cards.A.lease.renewed_at, new Date(T0 + 60000).toISOString(), 'renewed');
    eq(state.cards.A.lease.token, 'tok-1', 'token unchanged');
  }
  // stale takeover
  {
    const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', lease: mkLease() } } };
    const later = T0 + LEASE_TTL_MS + 1;
    const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'A' }, {
      readState: () => state, writeState: () => {}, withLock: immediateLock,
      now: () => new Date(later).toISOString(), leaseNowMs: () => later, leaseToken: () => 'tok-B',
    });
    eq(receipt.lease_token, 'tok-B', 'stale lease taken over');
    eq(state.cards.A.lease_breaks[0].reason, 'lease_superseded_stale', 'takeover audited');
  }

  // parked-card resume still acquires a lease (on-disk fixture, mirrors
  // LOOP-RESUME-CLEARED-PARK in run-codex-autoloop.js)
  {
    const resumeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-resume-parked-'));
    try {
      const HEAD40 = 'c'.repeat(40);
      const resumeWt = path.join(resumeRoot, 'wt'); fs.mkdirSync(resumeWt);
      const cardPath = path.join(resumeRoot, 'P.md');
      fs.writeFileSync(cardPath, '---\ntype: slice\nstatus: parked\nresume_condition: ready — Q deployed\n---\nbody\n');
      const boardPath = path.join(resumeRoot, 'board.md');
      fs.writeFileSync(boardPath, '## In Planning\n\n## Completed\n');
      const state = {
        schema_version: 1,
        cards: {
          P: {
            card: 'P', phase: 'parked', worktree: resumeWt, branch: 'b-p',
            card_path: cardPath, dependencies: [], touch_zones: ['some/zone'],
            resume_condition: 'ready — Q deployed',
            park_amendments: [{
              at: '2026-07-29T00:00:00.000Z', reason: 'cleared for lease harness',
              previous: { dependencies: ['[[Q]]'], resume_condition: 'blocked' },
              next: { dependencies: [], resume_condition: 'ready — Q deployed' },
            }],
          },
        },
      };
      const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'P' }, {
        readState: () => state, writeState: () => {}, withLock: immediateLock,
        findCard: () => cardPath,
        sh: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'fetch') return '';
          if (cmd === 'git' && args[0] === 'rev-parse') return HEAD40;
          if (cmd === 'git' && args[0] === 'merge-base') return '';
          throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
        },
        boardPath,
        projectCard: () => {},
        now: () => new Date(T0).toISOString(),
        leaseNowMs: () => T0, leaseToken: () => 'tok-P1',
        worktreeExists: () => true,
      });
      eq(receipt.action, 'implement', 'parked resume still succeeds');
      eq(receipt.lease_token, 'tok-P1', 'parked resume receipt carries a lease token');
      ok(!!state.cards.P.lease, 'parked resume record carries a lease');
    } finally {
      fs.rmSync(resumeRoot, { recursive: true, force: true });
    }
  }

  // ADDITION (deliberate design pin): attach applies to every non-terminal
  // phase, not only 'implementing' — a session must be able to attach to a
  // mid-pipeline card (e.g. awaiting CI) to obtain the token for advance.
  {
    const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'feature_pr', branch: 'b', worktree: '/w' } } };
    const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'A' }, {
      readState: () => state, writeState: () => {}, withLock: immediateLock,
      now: () => new Date(T0).toISOString(), leaseNowMs: () => T0, leaseToken: () => 'tok-fp1',
    });
    eq(receipt.action, 'attach', 'a mid-pipeline feature_pr card also attaches');
    eq(receipt.lease_token, 'tok-fp1', 'feature_pr attach returns a token');
    eq(state.cards.A.phase, 'feature_pr', 'feature_pr attach does not touch phase');
  }

  // commandClaim lease acquisition (Finding 2 coverage) + receipt shape
  // (Finding 1: `lease` must be the leaseSummary contract, never the raw
  // lease record — the token appears ONLY at `lease_token`).
  {
    const claimTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-claim-'));
    try {
      const originRepo = path.join(claimTmp, 'origin.git');
      const seedRepo = path.join(claimTmp, 'seed');
      const claimRoot = path.join(claimTmp, 'root');
      const boardPath = path.join(claimTmp, 'board.md');
      const cardsRoot = path.join(claimTmp, 'cards');
      fs.mkdirSync(seedRepo, { recursive: true });
      fs.mkdirSync(cardsRoot, { recursive: true });

      const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
      git(['init', '--bare', '--initial-branch=main', originRepo]);
      git(['init', '--initial-branch=main', seedRepo]);
      fs.writeFileSync(path.join(seedRepo, 'README.md'), 'seed\n');
      git(['add', '-A'], seedRepo);
      git(['-c', 'user.email=lease-test@example.com', '-c', 'user.name=lease-test', 'commit', '-m', 'seed'], seedRepo);
      git(['remote', 'add', 'origin', originRepo], seedRepo);
      git(['push', 'origin', 'main'], seedRepo);
      git(['clone', originRepo, claimRoot]);

      fs.writeFileSync(boardPath, [
        '## In Planning', '- [ ] [[A]]', '',
        '## In Progress', '', '## Blocked', '', '## Completed', '',
      ].join('\n'));
      const zones = ['Docs/example.md'];
      const policy = delivery.derivePolicy({ touch_zones: zones, batch_policy: 'continue' });
      const evidence = [{
        source_identity: 'lease test', captured_at: '2026-07-17T06:00:00Z',
        revision: 'fixture-v1', locator: 'platform/test/run-autoloop-leases.js', claim: 'Bounded test card.',
      }];
      const claimCardBody = [
        '---', 'card: A', `schema_version: ${delivery.CONTRACT_VERSION}`,
        'parent_card: "[[Test parent]]"', 'slice: T1', 'model_profile: standard',
        'execution_mode: release', `batch_policy: ${policy}`, 'status: planning',
        'touch_zones:', ...zones.map((z) => `  - ${z}`), 'depends_on: []',
        'deploy_subscriptions:', '  headspace: []', '  accuris: []', '  ero: []',
        'context_pack: "Docs/test-context.md"', 'epic: "[[Test epic]]"',
        `evidence: ${JSON.stringify(evidence)}`, 'risk_dimensions: []',
        'release_required: true', 'deployment_required: true',
        '---', '', '# Work', '', 'Bounded work.',
      ].join('\n');
      fs.writeFileSync(path.join(cardsRoot, 'A.md'), claimCardBody);

      const ctx = {
        root: claimRoot,
        commonDir: path.join(claimRoot, '.git'),
        stateDir: path.join(claimRoot, '.git', 'sauce-autoloop'),
        statePath: path.join(claimRoot, '.git', 'sauce-autoloop', 'state.json'),
      };

      const claimReceipt = await withFreshCoordinator({
        SAUCE_LOOP_BOARD: boardPath, SAUCE_LOOP_CARDS_ROOT: cardsRoot, SAUCE_LOOP_VAULTS: '[]',
      }, (fresh) => fresh.commandClaim(ctx, { json: true }, {
        now: () => new Date(T0).toISOString(), leaseNowMs: () => T0, leaseToken: () => 'tok-claim-1',
      }));

      eq(claimReceipt.action, 'implement', 'commandClaim succeeds against the isolated fixture');
      eq(claimReceipt.card, 'A', 'commandClaim claims the only eligible card');
      eq(claimReceipt.lease_token, 'tok-claim-1', 'FINDING-2b claim receipt lease_token matches the acquired token');
      ok(claimReceipt.lease && typeof claimReceipt.lease.expires_in_ms === 'number',
        'FINDING-2c claim receipt lease is the summary shape (expires_in_ms present)');
      eq(claimReceipt.lease.token, undefined,
        'FINDING-2d claim receipt lease never carries the raw token (lease_token is the only place it appears)');
      eq(claimReceipt.lease.held, true, 'FINDING-1 claim receipt lease is the leaseSummary contract, not the raw record');

      const persisted = JSON.parse(fs.readFileSync(ctx.statePath, 'utf8'));
      const persistedLease = persisted.cards.A.lease;
      eq(persistedLease.token, 'tok-claim-1', 'FINDING-2a claimed record carries the lease token');
      ok(typeof persistedLease.acquired_at === 'string' && persistedLease.acquired_at.length > 0,
        'FINDING-2a claimed record lease carries acquired_at');
      ok(typeof persistedLease.renewed_at === 'string' && persistedLease.renewed_at.length > 0,
        'FINDING-2a claimed record lease carries renewed_at');
      ok(typeof persistedLease.holder.host === 'string' && persistedLease.holder.host.length > 0,
        'FINDING-2a claimed record lease carries holder.host');
    } finally {
      fs.rmSync(claimTmp, { recursive: true, force: true });
    }
  }

  console.log(`AUTOLOOP-LEASES PASS (${count} assertions)`);
})().catch((err) => { console.error(err); process.exit(1); });
