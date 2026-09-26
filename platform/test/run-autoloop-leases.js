#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const delivery = require('../mechanisms/delivery');

const coordinatorModulePath = require.resolve('../../scripts/autoloop/codex-coordinator');
// These fixtures intentionally exercise the coordinator's flat-board selection
// seam unless a case opts into a binding through withFreshCoordinator below.
// A live loop exports epic topology while running release:preflight (dispatched
// as a manifest step via scripts/run-preflight.js, transitively from package.json's
// release:preflight script), so keep that ambient binding from changing the
// module-level fixture semantics.
const inheritedBoardTopology = process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
let coordinator;
try {
  delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
  coordinator = require(coordinatorModulePath);
} finally {
  if (inheritedBoardTopology === undefined) delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
  else process.env.SAUCE_LOOP_BOARD_TOPOLOGY = inheritedBoardTopology;
}
const {
  leaseIsLive, leaseSummary, acquireLease, clearLease, LEASE_TTL_MS, commandResume, commandClaim,
  requireLeaseToken, commandRecordReview, commandPark, commandAdvance, commandBreakLease, commandDiscard,
  cliOptionAllowlist,
  commandStatus,
} = coordinator;

let count = 0;
function ok(value, label) { assert.ok(value, label); count += 1; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); count += 1; }

// --- Non-vacuity guard -----------------------------------------------------
// This suite awaits real children, real worker threads and real files. An await
// that never settles drains the event loop, and node then exits 0 having run
// none of the assertions below and printed nothing at all; run-preflight.js
// scores that as a PASS, because it scores the exit code and discards the output.
// This block was measured doing exactly that (2 of 32 serial runs, 0 bytes at
// rc=0) while every assertion here was skipped. Two conditions are therefore
// checked independently of the assertions themselves: the suite must reach
// finish(), and it must have run at least ASSERTION_FLOOR assertions. That floor
// is the EXACT count this suite runs, with zero slack, because every case here
// is deterministic in how many assertions it makes -- so raise it to the new
// exact count whenever assertions are added. A run that silently skips a block
// reds instead of passing quietly.
// Scoped to THIS harness on purpose. 174 other harnesses share the gap and the
// rail-level fix (run-preflight.js scoring `code === 0`) is escalated separately.
const ASSERTION_FLOOR = 420;
let finished = false;
const strayChildren = new Set();
function finish() {
  finished = true;
  if (count < ASSERTION_FLOOR) {
    console.error(`AUTOLOOP-LEASES FAIL: ran ${count} assertions, expected at least ${ASSERTION_FLOOR} — a block was skipped`);
    process.exitCode = 1;
    return;
  }
  console.log(`AUTOLOOP-LEASES PASS (${count} assertions)`);
}
process.on('exit', (code) => {
  for (const child of strayChildren) { try { child.kill('SIGKILL'); } catch (_) { /* already gone */ } }
  if (finished) return;
  console.error(`\nAUTOLOOP-LEASES ABORTED after ${count} assertions without reaching the end of the suite`);
  console.error('  (an await never settled and the event loop drained, or the process was killed)');
  if (code === 0) process.exitCode = 1;
});
eq(process.env.SAUCE_LOOP_BOARD_TOPOLOGY, inheritedBoardTopology,
  'module-level flat fixture import restores inherited board topology');

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

      const cachedCoordinatorBeforeClaim = require.cache[coordinatorModulePath];
      const bindingBeforeClaim = Object.fromEntries(
        ['SAUCE_LOOP_BOARD', 'SAUCE_LOOP_CARDS_ROOT', 'SAUCE_LOOP_VAULTS']
          .map((key) => [key, process.env[key]]));
      const claimReceipt = await withFreshCoordinator({
        SAUCE_LOOP_BOARD: boardPath, SAUCE_LOOP_CARDS_ROOT: cardsRoot, SAUCE_LOOP_VAULTS: '[]',
      }, (fresh) => fresh.commandClaim(ctx, { json: true }, {
        now: () => new Date(T0).toISOString(), leaseNowMs: () => T0, leaseToken: () => 'tok-claim-1',
      }));

      ok(require.cache[coordinatorModulePath] === cachedCoordinatorBeforeClaim,
        'withFreshCoordinator restores the prior coordinator cache entry');
      for (const [key, value] of Object.entries(bindingBeforeClaim)) {
        eq(process.env[key], value, `withFreshCoordinator restores ${key}`);
      }
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

  // --- Task 2: pipeline-verb enforcement (requireLeaseToken) ---

  // commandRecordReview is the fully-worked pure-deps example: exercises the
  // shared guard through a real verb call (refusal codes + renew-on-match +
  // tokenless back-compat), not just the guard function in isolation.
  const HEAD = 'a'.repeat(40);
  function reviewFixture(lease) {
    // worktree must exist on disk — commandRecordReview checks it with real
    // fs.existsSync (no worktreeExists dep seam), mirroring the os.tmpdir()
    // fixture used by the reference invocation in run-codex-autoloop.js.
    return { schema_version: 1, cards: { R: {
      card: 'R', phase: 'implementing', worktree: os.tmpdir(), branch: 'b',
      reviews: [], ...(lease ? { lease } : {}),
    } } };
  }
  const reviewArgs = {
    json: true, card: 'R', lens: 'correctness', verdict: 'pass',
    summary: 'review looks fine and ready', 'expected-head': HEAD,
  };
  const reviewDeps = (state, extra = {}) => ({
    readState: () => state, sh: () => HEAD, writeState: () => {}, projectLoopStation: () => {},
    withLock: immediateLock, worktreeExists: () => true,
    leaseNowMs: () => T0 + 1000, now: () => new Date(T0 + 1000).toISOString(), ...extra,
  });

  // live lease + no token → lease_required
  await assert.rejects(() => commandRecordReview({ root: '/ws' }, { ...reviewArgs }, reviewDeps(reviewFixture(mkLease()))),
    (e) => e.code === 'lease_required', 'record-review requires token under live lease'); count++;
  // live lease + wrong token → lease_mismatch
  await assert.rejects(() => commandRecordReview({ root: '/ws' }, { ...reviewArgs, 'lease-token': 'wrong' }, reviewDeps(reviewFixture(mkLease()))),
    (e) => e.code === 'lease_mismatch', 'wrong token refused'); count++;
  // stale lease + old token → lease_stale (must re-resume to take over)
  {
    const state = reviewFixture(mkLease());
    await assert.rejects(() => commandRecordReview({ root: '/ws' }, { ...reviewArgs, 'lease-token': 'tok-1' },
      reviewDeps(state, { leaseNowMs: () => T0 + LEASE_TTL_MS + 1, now: () => new Date(T0 + LEASE_TTL_MS + 1).toISOString() })),
      (e) => e.code === 'lease_stale', 'stale token refused'); count++;
  }
  // matching token → proceeds + renews
  {
    const state = reviewFixture(mkLease());
    const r = await commandRecordReview({ root: '/ws' }, { ...reviewArgs, 'lease-token': 'tok-1' }, reviewDeps(state));
    ok(r.ok, 'matching token proceeds');
    eq(state.cards.R.lease.renewed_at, new Date(T0 + 1000).toISOString(), 'verb renews lease');
  }
  // unleased card → tokenless verb still proceeds (back-compat)
  {
    const state = reviewFixture(null);
    const r = await commandRecordReview({ root: '/ws' }, { ...reviewArgs }, reviewDeps(state));
    ok(r.ok, 'unleased card works tokenless');
  }

  // The guard and the CLI allowlists are two halves of one contract, and
  // testing them apart is how the deadlock shipped twice: requireLeaseToken
  // DEMANDS --lease-token on a leased card while the verb's allowlist refused
  // the option outright, leaving it unusable in both directions with
  // break-lease the only audited way through. amend-contract carried that for
  // a release; consume-ratification carried it afterwards, and the suite below
  // stayed green through both because calling the guard as a function never
  // touches the allowlist. Join the halves here, and derive the verb list from
  // the source so a newly enforced verb cannot quietly skip the check.
  {
    const source = fs.readFileSync(coordinatorModulePath, 'utf8');
    const enforced = [...new Set(
      [...source.matchAll(/requireLeaseToken\(record, args, '([a-z-]+)'/g)].map((m) => m[1]),
    )].sort();
    ok(enforced.length >= 8,
      `lease-gated verbs are discoverable from the coordinator source (found ${enforced.length})`);
    for (const verb of enforced) {
      const allowed = cliOptionAllowlist(verb);
      // A verb with no allowlist accepts every option, so it cannot deadlock.
      if (allowed === null) continue;
      ok(allowed.includes('lease-token'),
        `${verb}: demands --lease-token on a leased card, so its allowlist must accept it`);
    }
  }

  // requireLeaseToken directly: identical shared behavior for every enforced
  // verb — refusal codes, action naming (`${verb}-refused`), stale-before-
  // missing-token ordering, and renew-on-match.
  {
    const verbs = [
      'record-review', 'verify-gates', 'record-pr', 'advance',
      'park', 'amend-contract', 'consume-ratification', 'deploy',
    ];
    for (const verb of verbs) {
      // unleased record → guard is a no-op (back-compat)
      {
        const record = { card: 'U', phase: 'implementing' };
        requireLeaseToken(record, {}, verb, T0);
        ok(!record.lease, `${verb}: unleased record is a tokenless no-op`);
      }
      // FIX 2: active unleased record + a supplied token → lease_gone. The
      // token implies the caller believes it holds a lease that no longer
      // exists (broken or superseded); refuse instead of silently no-op'ing.
      {
        const record = { card: 'U', phase: 'implementing' };
        assert.throws(() => requireLeaseToken(record, { 'lease-token': 'ghost-token' }, verb, T0),
          (e) => e.code === 'lease_gone' && e.action === `${verb}-refused`
            && /no longer exists/.test(e.message) && /resume --card/.test(e.message),
          `${verb}: active unleased record + token refuses lease_gone`); count++;
        ok(!record.lease, `${verb}: lease_gone refusal never fabricates a lease`);
      }
      // FIX 2: PARKED unleased record + a supplied token stays the old
      // silent no-op — tokened idempotent replays after park must still work.
      {
        const record = { card: 'U', phase: 'parked' };
        requireLeaseToken(record, { 'lease-token': 'ghost-token' }, verb, T0);
        ok(!record.lease, `${verb}: parked unleased record + token is still a silent no-op`);
      }
      // FIX 2: TERMINAL (e.g. deployed) unleased record + a supplied token
      // also stays the old silent no-op, for the same idempotent-replay reason.
      {
        const record = { card: 'U', phase: 'deployed' };
        requireLeaseToken(record, { 'lease-token': 'ghost-token' }, verb, T0);
        ok(!record.lease, `${verb}: terminal unleased record + token is still a silent no-op`);
      }
      // live lease + no token → lease_required
      {
        const record = { card: 'V', phase: 'implementing', lease: mkLease() };
        assert.throws(() => requireLeaseToken(record, {}, verb, T0 + 1000),
          (e) => e.code === 'lease_required' && e.action === `${verb}-refused`
            && /--lease-token/.test(e.message) && /resume --card/.test(e.message) && /break-lease/.test(e.message),
          `${verb}: live lease + no token refuses lease_required with remedy`); count++;
      }
      // live lease + wrong token → lease_mismatch
      {
        const record = { card: 'V', phase: 'implementing', lease: mkLease() };
        assert.throws(() => requireLeaseToken(record, { 'lease-token': 'wrong' }, verb, T0 + 1000),
          (e) => e.code === 'lease_mismatch' && e.action === `${verb}-refused`,
          `${verb}: wrong token refuses lease_mismatch`); count++;
      }
      // stale lease → lease_stale BEFORE lease_required/lease_mismatch, even
      // with the previously-correct token: a returning holder must re-attach
      // via resume so the takeover is audited.
      {
        const record = { card: 'V', phase: 'implementing', lease: mkLease() };
        const staleNow = T0 + LEASE_TTL_MS + 1;
        assert.throws(() => requireLeaseToken(record, {}, verb, staleNow),
          (e) => e.code === 'lease_stale' && e.action === `${verb}-refused`,
          `${verb}: stale lease + no token refuses lease_stale, not lease_required`); count++;
        assert.throws(() => requireLeaseToken(record, { 'lease-token': 'tok-1' }, verb, staleNow),
          (e) => e.code === 'lease_stale',
          `${verb}: stale lease + previously-correct token still refuses lease_stale`); count++;
      }
      // matching token on a live lease → proceeds and renews in place
      {
        const record = { card: 'V', phase: 'implementing', lease: mkLease() };
        const renewNow = T0 + 1000;
        requireLeaseToken(record, { 'lease-token': 'tok-1' }, verb, renewNow);
        eq(record.lease.renewed_at, new Date(renewNow).toISOString(), `${verb}: matching token renews the lease`);
        eq(record.lease.token, 'tok-1', `${verb}: matching token does not rotate the token`);
      }
    }
  }

  // commandPark releases the lease on success.
  {
    const parkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-park-'));
    try {
      const boardPath = path.join(parkRoot, 'board.md');
      const cardPath = path.join(parkRoot, 'Lease park.md');
      fs.writeFileSync(boardPath, [
        '---', 'kanban-plugin: board', '---', '',
        '## In Planning', '',
        '## In Progress', '- [ ] [[Lease park]]', '',
        '## Blocked', '',
        '## Discovered (autoloop)', '- [ ] [[Unrelated discovery]]', '',
        '## Completed', '',
        '***', '', '## Archive', '',
        '%% kanban:settings', '{}', '%%',
      ].join('\n'));
      fs.writeFileSync(cardPath, [
        '---', 'kanban_column: In Progress', 'status: in_progress',
        'parent_card: "[[Shared parent]]"', 'depends_on: []', '---', 'body',
      ].join('\n'));
      const state = {
        schema_version: 1,
        cards: { 'Lease park': {
          card: 'Lease park', phase: 'implementing', card_path: cardPath,
          branch: 'b-lp', worktree: '/w', touch_zones: ['platform/lp'],
          lease: mkLease(),
        } },
      };
      let writes = 0;
      const receipt = await commandPark({ root: parkRoot }, {
        json: true, card: 'Lease park', 'lease-token': 'tok-1',
        'depends-on': 'Prerequisite A', 'resume-condition': 'wait for it',
      }, {
        readState: () => state, writeState: () => { writes++; }, withLock: immediateLock,
        boardPath, findCard: (_root, name) => (name === 'Prerequisite A' ? `/cards/${name}.md` : null),
        now: () => new Date(T0 + 5000).toISOString(), leaseNowMs: () => T0 + 5000,
        projectLoopStation: () => {},
      });
      ok(receipt.ok, 'park with matching token succeeds');
      ok(!state.cards['Lease park'].lease, 'park clears the lease on success');
      const breaks = state.cards['Lease park'].lease_breaks;
      eq(breaks[breaks.length - 1].reason, 'lease_released_park', 'park release reason is exact');
      ok(writes >= 1, 'park persists the lease release');
    } finally {
      fs.rmSync(parkRoot, { recursive: true, force: true });
    }
  }

  // commandAdvance releases the lease once the record reaches a TERMINAL
  // phase, via stepCard injection (mirrors OPX2 deploy-transition coverage
  // in run-codex-autoloop.js).
  {
    const state = { schema_version: 1, cards: { Deploy: {
      card: 'Deploy', phase: 'tap_merged', lease: mkLease(),
    } } };
    let writes = 0;
    const result = await commandAdvance({ root: '/workshop' }, {
      card: 'Deploy', 'lease-seconds': '0', 'lease-token': 'tok-1',
    }, {
      withLock: immediateLock,
      readState: () => state,
      writeState: () => { writes++; },
      stepCard: async (_ctx, _st, record) => {
        record.phase = 'deployed';
        return { action: 'complete', card: record.card, phase: record.phase };
      },
      projectLoopStation: () => {},
      leaseNowMs: () => T0 + 2000,
      emit: () => {},
    });
    eq(result.phase, 'deployed', 'advance completes the terminal transition');
    ok(!state.cards.Deploy.lease, 'advance clears the lease on reaching a TERMINAL phase');
    const breaks = state.cards.Deploy.lease_breaks;
    eq(breaks[breaks.length - 1].reason, 'lease_released_terminal', 'advance release reason is exact');
    ok(writes >= 1, 'advance persists the terminal lease release');
  }

  // FINDING 1 (review fix): --dry-run is a preview call and must never
  // durably release a lease, even when the record's phase already satisfies
  // TERMINAL (e.g. a stale --dry-run advance against an already-blocked,
  // still-leased card). Mirrors the pre-existing `transitionedTo` dry-run
  // gate in the same lock callback.
  {
    const state = { schema_version: 1, cards: { X: {
      card: 'X', phase: 'blocked', reason: 'external block', lease: mkLease(),
    } } };
    let writes = 0;
    const result = await commandAdvance({ root: '/workshop' }, {
      card: 'X', 'lease-seconds': '0', 'lease-token': 'tok-1', 'dry-run': true,
    }, {
      withLock: immediateLock,
      readState: () => state,
      writeState: () => { writes++; },
      stepCard: async (_ctx, _st, record) => ({ action: 'blocked', card: record.card, reason: record.reason }),
      projectLoopStation: () => {},
      leaseNowMs: () => T0 + 2000,
      emit: () => {},
    });
    eq(result.action, 'blocked', 'dry-run advance on an already-terminal card still reports its phase');
    ok(!!state.cards.X.lease, 'dry-run advance never releases a lease on a TERMINAL-phase card');
    ok(!state.cards.X.lease_breaks, 'dry-run advance records no lease_breaks entry');
    eq(writes, 0, 'dry-run advance performs zero persistence from the release path');
  }

  // FIX 1 (final-review): commandAdvance must arbitrate the lease on EVERY
  // poll iteration, inside the card-gate lock, not just the first pass. A
  // mid-poll break-lease + foreign attach (simulated here inside stepCard,
  // as a `resume --card` from another session would perform it) must abort
  // the loop with lease_mismatch before a second stepCard call ever runs —
  // never silently keep stepping (and eventually writeState-stomping) a
  // record now owned by a different holder. `deps.sleep` is injected so the
  // test drives two real loop iterations without a real poll-interval wait.
  {
    const state = { schema_version: 1, cards: { P: {
      card: 'P', phase: 'implementing', lease: mkLease(),
    } } };
    let stepCalls = 0;
    const stepCard = async (_ctx, _st, record) => {
      stepCalls += 1;
      // Simulate a foreign attach landing between iteration 1 and 2: the
      // original holder's lease is broken and re-acquired under a different
      // token, exactly as `resume --card` would do it.
      clearLease(record, 'lease_broken_manual', () => new Date(T0 + 2000).toISOString());
      acquireLease(record, { now: () => new Date(T0 + 2000).toISOString(), token: 'tok-2', label: 'foreign' });
      return { action: 'waiting', card: record.card };
    };
    await assert.rejects(() => commandAdvance({ root: '/workshop' }, {
      card: 'P', 'lease-seconds': '60', 'lease-token': 'tok-1',
    }, {
      withLock: immediateLock, readState: () => state, writeState: () => {},
      stepCard, sleep: () => Promise.resolve(), projectLoopStation: () => {},
      leaseNowMs: () => T0 + 3000, emit: () => {},
    }), (e) => e.code === 'lease_mismatch', 'mid-poll foreign attach aborts the advance loop with lease_mismatch'); count++;
    eq(stepCalls, 1, 'the loop stops before a second stepCard call once the lease is foreign-mismatched');
  }

  // FIX 2 (final-review): a supplied --lease-token against an ACTIVE unleased
  // card means the caller believes it holds a lease that no longer exists
  // (broken or superseded) — refuse lease_gone rather than silently
  // proceeding. Exercised end-to-end via commandRecordReview and
  // commandAdvance (unit coverage for the shared guard itself lives in the
  // requireLeaseToken verbs loop below).
  {
    const state = reviewFixture(null);
    await assert.rejects(() => commandRecordReview({ root: '/ws' }, { ...reviewArgs, 'lease-token': 'ghost' }, reviewDeps(state)),
      (e) => e.code === 'lease_gone', 'record-review: active unleased card + token refuses lease_gone'); count++;
  }
  {
    const state = { schema_version: 1, cards: { G: { card: 'G', phase: 'implementing' } } };
    await assert.rejects(() => commandAdvance({ root: '/workshop' }, {
      card: 'G', 'lease-seconds': '0', 'lease-token': 'ghost',
    }, {
      withLock: immediateLock, readState: () => state, writeState: () => {},
      stepCard: async () => { throw new Error('stepCard must not run once the guard refuses'); },
      projectLoopStation: () => {}, leaseNowMs: () => T0, emit: () => {},
    }), (e) => e.code === 'lease_gone', 'advance: active unleased card + token refuses lease_gone before stepping'); count++;
  }

  // --- Task 3: break-lease verb + supervised-verb lease clearing ---

  // break-lease clears + audits
  {
    const state = { schema_version: 1, cards: { B: { card: 'B', phase: 'implementing', lease: mkLease() } } };
    const r = await commandBreakLease({ root: '/ws' }, { json: true, card: 'B', reason: 'chat window closed' }, {
      readState: () => state, writeState: () => {}, withLock: immediateLock,
      now: () => new Date(T0).toISOString(), leaseNowMs: () => T0,
    });
    eq(r.action, 'break-lease', 'break-lease action'); eq(r.no_op, false, 'break-lease not a no-op');
    eq(state.cards.B.lease, undefined, 'break-lease clears the lease');
    eq(state.cards.B.lease_breaks[0].reason, 'lease_broken_manual', 'break-lease audited as manual break');
    eq(state.cards.B.lease_breaks[0].manual_reason, 'chat window closed', 'break-lease audit carries the manual reason');
    ok(r.broken && r.broken.holder && r.broken.holder.host === 'mac-a', 'break-lease receipt reports the broken lease summary');
    eq(r.reason, 'chat window closed', 'break-lease receipt echoes the reason');
  }
  // break-lease on unleased card → no_op success
  {
    const state = { schema_version: 1, cards: { B: { card: 'B', phase: 'implementing' } } };
    const r = await commandBreakLease({ root: '/ws' }, { json: true, card: 'B', reason: 'x' }, {
      readState: () => state, writeState: () => {}, withLock: immediateLock,
      now: () => new Date(T0).toISOString(), leaseNowMs: () => T0,
    });
    eq(r.no_op, true, 'unleased break-lease is no_op');
    eq(r.broken, null, 'unleased break-lease reports no broken lease');
  }
  // break-lease refusals: unknown card → card_not_claimed; missing reason → reason_required; missing card → card_required
  await assert.rejects(() => commandBreakLease({ root: '/ws' }, { json: true, card: 'ghost', reason: 'x' },
    { readState: () => ({ schema_version: 1, cards: {} }), writeState: () => {}, withLock: immediateLock }),
    (e) => e.code === 'card_not_claimed', 'break-lease unknown card refused'); count++;
  await assert.rejects(() => commandBreakLease({ root: '/ws' }, { json: true, card: 'B', reason: '' },
    { readState: () => ({ schema_version: 1, cards: { B: { card: 'B' } } }), writeState: () => {}, withLock: immediateLock }),
    (e) => e.code === 'reason_required', 'break-lease empty reason refused'); count++;
  await assert.rejects(() => commandBreakLease({ root: '/ws' }, { json: true, reason: 'x' },
    { readState: () => ({ schema_version: 1, cards: {} }), writeState: () => {}, withLock: immediateLock }),
    (e) => e.code === 'card_required', 'break-lease missing card refused via usage()'); count++;

  // commandDiscard clears a live lease as a supervised verb (bypasses
  // break-lease entirely — the card is leaving the active set for good).
  {
    const discardRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-discard-'));
    try {
      const cardPath = path.join(discardRoot, 'Lease discard.md');
      const boardPath = path.join(discardRoot, 'board.md');
      fs.writeFileSync(cardPath, '---\nstatus: parked\ndepends_on: []\n---\nbody\n');
      fs.writeFileSync(boardPath, '## In Progress\n- [ ] [[Lease discard]]\n\n## Completed\n');
      const state = {
        schema_version: 1,
        cards: { 'Lease discard': {
          card: 'Lease discard', phase: 'parked', card_path: cardPath,
          lease: mkLease(),
        } },
      };
      const receipt = await commandDiscard({ root: discardRoot }, {
        json: true, card: 'Lease discard', reason: 'lease harness cleanup',
      }, {
        readState: () => state, writeState: () => {}, withLock: immediateLock,
        boardPath, cardsRoot: discardRoot, worktreeExists: () => false,
        sh: () => { throw new Error('sh should not be called for a leaseless, worktreeless discard'); },
        now: () => new Date(T0).toISOString(),
        projectLoopStation: () => ({ action: 'loop-station-projected', no_op: false }),
      });
      eq(receipt.action, 'discarded', 'discard succeeds against a leased parked card');
      eq(receipt.no_op, false, 'discard is not a no-op');
      ok(!state.cards['Lease discard'].lease, 'discard clears the lease on tombstone');
      const breaks = state.cards['Lease discard'].lease_breaks;
      eq(breaks[breaks.length - 1].reason, 'lease_cleared_supervised', 'discard lease clear reason is exact');
    } finally {
      fs.rmSync(discardRoot, { recursive: true, force: true });
    }
  }

  // --- Task 4: status projection + all-work-leased selection ---

  function statusFixture(leases) { // leases: array of lease|null for three active cards
    const cards = {};
    ['A1', 'A2', 'A3'].forEach((name, i) => {
      cards[name] = {
        card: name, phase: 'implementing', branch: `b${i}`, worktree: `/w${i}`,
        ...(leases[i] ? { lease: leases[i] } : {}),
      };
    });
    return { schema_version: 1, cards };
  }
  const STATUS_BOARD = '## In Planning\n\n## In Progress\n\n## Blocked\n\n## Completed\n'; // minimal board — no claimable work

  // all three active + all live-leased → all-work-leased
  {
    const receipt = commandStatus({ root: '/ws' }, {
      state: statusFixture([mkLease(), mkLease({ token: 't2' }), mkLease({ token: 't3' })]),
      boardMd: STATUS_BOARD, loadCard: () => null, cardsRoot: '/cards', supervised: false,
      leaseNowMs: () => T0 + 1000,
    });
    eq(receipt.next.action, 'all-work-leased', 'all leased at capacity -> all-work-leased');
    eq(receipt.next.leased.length, 3, 'names all leased cards');
    ok(receipt.next.soonest_expiry_ms > 0 && receipt.next.soonest_expiry_ms <= LEASE_TTL_MS,
      'soonest_expiry_ms is the minimum of the leased expiries');
    ok(receipt.active[0].lease && receipt.active[0].lease.held === true, 'status projects lease per card');
    eq(receipt.active.filter((r) => r.lease && r.lease.held).length, 3, 'every active card carries a live lease projection');
  }

  // one lease stale -> at-capacity with that card resumable
  {
    const receipt = commandStatus({ root: '/ws' }, {
      state: statusFixture([mkLease(), mkLease({ token: 't2' }),
        mkLease({ token: 't3', renewed_at: new Date(T0 - LEASE_TTL_MS - 1000).toISOString() })]),
      boardMd: STATUS_BOARD, loadCard: () => null, cardsRoot: '/cards', supervised: false,
      leaseNowMs: () => T0 + 1000,
    });
    eq(receipt.next.action, 'at-capacity', 'stale lease keeps at-capacity');
    eq(receipt.next.resumable, ['A3'], 'stale-leased card listed resumable');
    eq(receipt.next.leased.length, 2, 'the two live-leased cards are reported leased');
    eq(receipt.next.active, ['A1', 'A2', 'A3'], 'REGRESSION at-capacity active stays a card-name string array');
    ok(receipt.next.active.every((v) => typeof v === 'string'), 'REGRESSION every at-capacity active entry is a string');
    ok(receipt.active.find((r) => r.card === 'A3').lease.stale === true, 'status projects the stale lease per card');
  }

  // under capacity with an unleased active card -> unchanged 'no-work'
  // semantics (regression guard: capacity gate never fires below MAX_ACTIVE,
  // regardless of lease state).
  {
    const state = statusFixture([mkLease(), null, null]);
    delete state.cards.A3; // only two active cards tracked: under MAX_ACTIVE (3)
    const receipt = commandStatus({ root: '/ws' }, {
      state, boardMd: STATUS_BOARD, loadCard: () => null, cardsRoot: '/cards', supervised: false,
      leaseNowMs: () => T0 + 1000,
    });
    eq(receipt.next.action, 'no-work', 'under-capacity selection is unaffected by lease projection');
    ok(!receipt.next.leased && !receipt.next.resumable, 'under-capacity next carries no lease-selection fields');
    eq(receipt.active.find((r) => r.card === 'A2').lease, null, 'unleased active card projects a null lease');
  }


  // --- OPS-3: lock reclamation for provably-dead same-host owners ---
  // Drives the REAL lockIsStale / lockDirectoryIsStale / withLock against real
  // temp lock directories (no immediateLock stub) because the defect lives in the
  // acquisition path itself. A pid is only meaningful on its own host, and any
  // uncertainty about liveness must fail CLOSED (keep the lock held).
  {
    const { lockIsStale, lockDirectoryIsStale, withLock, pidLiveness } = coordinator;
    const HOST = os.hostname();
    const STALE = 30 * 60 * 1000;
    const LNOW = Date.parse('2026-09-10T12:00:00.000Z');
    // spawnSync waits for exit and reaps, so this pid is provably gone on this host.
    const DEAD_PID = require('child_process').spawnSync(process.execPath, ['-e', '0']).pid;
    const at = (deltaMs) => new Date(LNOW - deltaMs).toISOString();
    const owner = (over = {}) => ({ pid: process.pid, host: HOST, started_at: at(60 * 1000), ...over });

    // pid liveness is tri-state and fails closed: only ESRCH is "gone".
    eq(pidLiveness(process.pid), true, 'OPS3 pidLiveness: own live pid → alive');
    eq(pidLiveness(DEAD_PID), false, 'OPS3 pidLiveness: reaped pid → provably dead (ESRCH)');
    eq(pidLiveness(1), true, 'OPS3 pidLiveness: pid 1 exists (EPERM or signalable) → ALIVE, never dead');
    eq(pidLiveness(0), null, 'OPS3 pidLiveness: pid 0 → unknown');
    eq(pidLiveness(-3), null, 'OPS3 pidLiveness: negative pid → unknown');
    eq(pidLiveness('abc'), null, 'OPS3 pidLiveness: non-numeric pid → unknown');

    // 1. same host + provably dead pid → reclaimed IMMEDIATELY, well inside the window.
    eq(lockIsStale(owner({ pid: DEAD_PID }), LNOW, STALE), true,
      'OPS3 same-host dead-pid lock is stale after 1 minute (no 30m wait)');
    eq(lockIsStale(owner({ pid: DEAD_PID, started_at: at(0) }), LNOW, STALE), true,
      'OPS3 same-host dead-pid lock is stale at age zero');

    // 2. same host + LIVE pid → never reclaimed early, at any age below the window.
    eq(lockIsStale(owner(), LNOW, STALE), false, 'OPS3 same-host live-pid lock is held at 1 minute');
    eq(lockIsStale(owner({ started_at: at(29 * 60 * 1000) }), LNOW, STALE), false,
      'OPS3 same-host live-pid lock is held at 29 minutes');
    eq(lockIsStale(owner({ started_at: at(STALE) }), LNOW, STALE), false,
      'OPS3 window boundary is unchanged: age === staleMs with a live pid stays held');
    eq(lockIsStale(owner({ started_at: at(STALE + 1) }), LNOW, STALE), false,
      'OPS3 past the window a LIVE same-host owner is still held');

    // EPERM (process exists, owned by another user) must read as ALIVE, not dead —
    // the old code reclaimed such a lock once the window elapsed.
    eq(lockIsStale(owner({ pid: 1 }), LNOW, STALE), false,
      'OPS3 EPERM/other-user pid is ALIVE: fresh lock held');
    eq(lockIsStale(owner({ pid: 1, started_at: at(STALE + 60 * 1000) }), LNOW, STALE), false,
      'OPS3 EPERM/other-user pid is ALIVE: lock past the window is STILL held (fail closed)');

    // 3. different host → pid numbers are meaningless; only the window may reclaim.
    eq(lockIsStale(owner({ pid: DEAD_PID, host: 'other-host' }), LNOW, STALE), false,
      'OPS3 foreign-host lock is NOT reclaimed early even though the pid is dead here');
    eq(lockIsStale(owner({ pid: process.pid, host: 'other-host' }), LNOW, STALE), false,
      'OPS3 foreign-host fresh lock is held');
    eq(lockIsStale(owner({ pid: DEAD_PID, host: 'other-host', started_at: at(STALE + 1) }), LNOW, STALE), true,
      'OPS3 foreign-host lock past the window keeps its existing stale semantics');
    {
      const o = owner({ pid: DEAD_PID });
      delete o.host;
      eq(lockIsStale(o, LNOW, STALE), false,
        'OPS3 owner without a host is not provably ours → no early reclaim');
      eq(lockIsStale({ ...o, started_at: at(STALE + 1) }, LNOW, STALE), true,
        'OPS3 owner without a host past the window keeps its existing stale semantics');
    }

    // pid shapes that cannot prove death keep the lock held inside the window.
    for (const [label, pid] of [['absent', undefined], ['zero', 0], ['negative', -3],
      ['non-numeric', 'abc'], ['fractional', 12.5], ['null', null], ['object', {}]]) {
      const o = owner({ pid });
      if (pid === undefined) delete o.pid;
      eq(lockIsStale(o, LNOW, STALE), false,
        `OPS3 fresh same-host lock with a ${label} pid is held (fail closed)`);
      eq(lockIsStale({ ...o, started_at: at(STALE + 1) }, LNOW, STALE), true,
        `OPS3 same-host lock with a ${label} pid past the window keeps its existing stale semantics`);
    }

    // owner records that were already unconditionally stale stay that way.
    eq(lockIsStale(null, LNOW, STALE), true, 'OPS3 absent owner record stays stale');
    eq(lockIsStale({ pid: process.pid, host: HOST }, LNOW, STALE), true,
      'OPS3 owner without started_at stays stale');

    // unparseable / future started_at: a live owner is still held, a provably dead
    // same-host owner is reclaimed instead of wedging the lock forever.
    eq(lockIsStale(owner({ started_at: 'garbage' }), LNOW, STALE), false,
      'OPS3 unparseable started_at with a live pid stays held');
    eq(lockIsStale(owner({ started_at: 'garbage', pid: DEAD_PID }), LNOW, STALE), true,
      'OPS3 unparseable started_at with a provably dead same-host pid is reclaimed');
    eq(lockIsStale(owner({ started_at: new Date(LNOW + 60 * 60 * 1000).toISOString() }), LNOW, STALE), false,
      'OPS3 future-dated started_at with a live pid stays held');
    eq(lockIsStale(owner({ started_at: new Date(LNOW + 60 * 60 * 1000).toISOString(), pid: DEAD_PID }), LNOW, STALE), true,
      'OPS3 future-dated started_at with a provably dead same-host pid is reclaimed');

    // 4. malformed / absent owner.json keeps the mtime-based behaviour.
    const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops3-locks-'));
    const seedLock = (name, ownerBody) => {
      const lockPath = path.join(lockRoot, 'locks', `${name}.lock`);
      fs.mkdirSync(lockPath, { recursive: true });
      if (ownerBody !== undefined) fs.writeFileSync(path.join(lockPath, 'owner.json'), ownerBody);
      return lockPath;
    };
    const ageDirectory = (lockPath, ms) => {
      const when = (Date.now() - ms) / 1000;
      fs.utimesSync(lockPath, when, when);
    };
    {
      const fresh = seedLock('mtime-fresh');
      eq(lockDirectoryIsStale(fresh, null, STALE), false, 'OPS3 ownerless fresh lock dir is held on mtime');
      const old = seedLock('mtime-old');
      ageDirectory(old, STALE + 60 * 1000);
      eq(lockDirectoryIsStale(old, null, STALE), true, 'OPS3 ownerless old lock dir is stale on mtime');
      eq(lockDirectoryIsStale(path.join(lockRoot, 'locks', 'absent.lock'), null, STALE), false,
        'OPS3 missing lock dir reports not-stale');
    }

    // --- real withLock against real lock directories ---
    const ctx = { stateDir: lockRoot };
    const attempt = async (name) => {
      let ran = false;
      try {
        await withLock(ctx, name, async () => { ran = true; return 'ok'; });
        return { acquired: true, ran };
      } catch (err) { return { acquired: false, code: err.code, ran }; }
    };

    seedLock('dead-owner', JSON.stringify({ pid: DEAD_PID, host: HOST, started_at: new Date().toISOString() }));
    {
      const result = await attempt('dead-owner');
      eq(result.acquired, true, 'OPS3 withLock reclaims a fresh lock whose same-host owner pid is gone');
      eq(result.ran, true, 'OPS3 the reclaimed lock actually runs the critical section');
      eq(fs.existsSync(path.join(lockRoot, 'locks', 'dead-owner.lock')), false,
        'OPS3 withLock releases the reclaimed lock');
    }

    seedLock('live-owner', JSON.stringify({ pid: process.pid, host: HOST, started_at: new Date().toISOString() }));
    {
      const result = await attempt('live-owner');
      eq(result.acquired, false, 'OPS3 withLock REFUSES a fresh lock whose owner pid is alive');
      eq(result.code, 'LOCKED', 'OPS3 the live-owner refusal is a LOCKED refusal');
      eq(fs.existsSync(path.join(lockRoot, 'locks', 'live-owner.lock')), true,
        'OPS3 the live owner keeps its lock directory');
    }

    seedLock('foreign-owner', JSON.stringify({ pid: DEAD_PID, host: `${HOST}-elsewhere`, started_at: new Date().toISOString() }));
    {
      const result = await attempt('foreign-owner');
      eq(result.acquired, false, 'OPS3 withLock REFUSES a fresh foreign-host lock with a locally-dead pid');
      eq(result.code, 'LOCKED', 'OPS3 the foreign-host refusal is a LOCKED refusal');
    }

    seedLock('garbage-owner', '{not json');
    {
      const result = await attempt('garbage-owner');
      eq(result.acquired, false, 'OPS3 withLock REFUSES a fresh lock with an unparseable owner.json (mtime path)');
      const old = seedLock('garbage-owner-old', '{not json');
      ageDirectory(old, STALE + 60 * 1000);
      const aged = await attempt('garbage-owner-old');
      eq(aged.acquired, true, 'OPS3 an unparseable owner.json past the mtime window is still reclaimed');
    }

    seedLock('stamp-owner', JSON.stringify({ pid: DEAD_PID, host: HOST, started_at: new Date().toISOString() }));
    {
      let stamped = null;
      await withLock(ctx, 'stamp-owner', async () => {
        stamped = JSON.parse(fs.readFileSync(path.join(lockRoot, 'locks', 'stamp-owner.lock', 'owner.json'), 'utf8'));
      });
      eq(stamped.pid, process.pid, 'OPS3 the reclaimer stamps its own pid as the new owner');
      eq(stamped.host, HOST, 'OPS3 the reclaimer stamps its own host as the new owner');
    }

    // --- OPS-3 mutual exclusion under a synchronised reclaim storm ---
    // The predicate above only decides WHEN a lock may be reclaimed. This block
    // proves the reclaim PATH is exclusion-safe, because reclaiming a dead
    // owner's lock a minute after it died (instead of half an hour later) puts
    // every retrying session through that path at the same instant.
    //
    // Real concurrency, not a simulation: N worker threads each drive the real
    // withLock against one real lock directory, released from a shared
    // Atomics barrier and then a tight wall-clock spin so they arrive together.
    // The winner stays inside the critical section until every racer has
    // reported, so "acquired" counts genuine OVERLAP, not sequential handoff.
    // That deadline has to outlast scheduler latency on a loaded machine: if the
    // winner leaves before a slow racer arrives, the racer acquires legitimately
    // and the tally counts a handoff the lock never permitted.
    // On the unfixed reclaim path (read stale owner -> rmSync -> mkdirSync) a
    // loser deletes the winner's fresh lock directory and enters beside it;
    // measured on that path this yields 2-3 simultaneous holders in ~20% of
    // trials with 8 racers.
    {
      const { Worker } = require('worker_threads');
      const RACERS = 8;
      const TRIALS = 60;
      const GO = 0; const INSIDE = 1; const MAXI = 2; const ATTEMPTS = 3;
      const raceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops3-race-'));
      const raceLock = path.join(raceRoot, 'locks', 'race-target.lock');
      const sab = new SharedArrayBuffer(8 * 4);
      const startBuf = new SharedArrayBuffer(8);
      const arr = new Int32Array(sab);
      const startAt = new Float64Array(startBuf);
      const racerSource = [
        "const { parentPort, workerData } = require('worker_threads');",
        "delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;",
        "const coordinator = require(workerData.coordinatorPath);",
        "const arr = new Int32Array(workerData.sab);",
        "const startAt = new Float64Array(workerData.startBuf);",
        "const ctx = { stateDir: workerData.stateDir };",
        "const GO = 0, INSIDE = 1, MAXI = 2, ATTEMPTS = 3;",
        "let seen = 0;",
        // Readiness is REPORTED, never assumed. The parent used to sleep 900ms
        // and hope every worker had finished requiring a 9,000-line module; a
        // worker that had not would miss the barrier, and the whole batch then
        // waited on a message it would never send.
        "parentPort.postMessage({ ready: true });",
        "(async () => {",
        "  for (;;) {",
        "    while (Atomics.load(arr, GO) === seen) Atomics.wait(arr, GO, seen, 1000);",
        "    seen = Atomics.load(arr, GO);",
        "    if (seen < 0) return;",
        "    while (Date.now() < startAt[0]) { /* tight barrier: arrive in the same millisecond */ }",
        "    let acquired = false; let code = null;",
        "    try {",
        "      await coordinator.withLock(ctx, workerData.lockName, async () => {",
        "        const n = Atomics.add(arr, INSIDE, 1) + 1;",
        "        let m = Atomics.load(arr, MAXI);",
        "        while (n > m) { const prev = Atomics.compareExchange(arr, MAXI, m, n); if (prev === m) break; m = prev; }",
        "        Atomics.add(arr, ATTEMPTS, 1); Atomics.notify(arr, ATTEMPTS);",
        "        const until = Date.now() + 5000;",
        "        while (Atomics.load(arr, ATTEMPTS) < workerData.racers && Date.now() < until) {",
        "          Atomics.wait(arr, ATTEMPTS, Atomics.load(arr, ATTEMPTS), 5);",
        "        }",
        "        Atomics.sub(arr, INSIDE, 1);",
        "      });",
        "      acquired = true;",
        "    } catch (err) {",
        "      code = (err && err.code) || (err && err.message) || 'error';",
        "      Atomics.add(arr, ATTEMPTS, 1); Atomics.notify(arr, ATTEMPTS);",
        "    }",
        "    parentPort.postMessage({ acquired, code });",
        "  }",
        "})();",
      ].join('\n');
      // NOTHING in this block is unref'd. Every worker and every timer below is a
      // REF'D handle, so an await that cannot be satisfied hangs and is reported
      // by its deadline instead of draining the event loop and exiting 0 in
      // silence. `worker.unref()` plus an unref'd startup timer is precisely how
      // this suite was measured exiting 0 with no output and no assertions run.
      const inbox = [];
      let releaseBatch = null;
      let rejectBatch = null;
      let stormOver = false;
      const racerWorkers = [];
      // A worker that dies never posts, so the batch it was in can never reach
      // RACERS messages. Surfacing that as a rejection is the difference between
      // a named failure and an unsatisfiable await.
      let stormAbort = null;
      const abortStorm = (err) => {
        if (stormOver) return;
        const reject = rejectBatch;
        releaseBatch = null; rejectBatch = null;
        if (reject) reject(err); else stormAbort = stormAbort || err;
      };
      // Ref'd deadline: a wedged batch reds with a diagnosis rather than hanging.
      const WORKER_READY_BOUND_MS = 120000;
      const STORM_TRIAL_BOUND_MS = 120000;
      const withDeadline = (promise, ms, label) => {
        let timer = null;
        const bounded = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); });
        return Promise.race([promise, bounded]).finally(() => { if (timer !== null) clearTimeout(timer); });
      };
      let readyCount = 0;
      let readyResolve = null;
      const allReady = new Promise((resolve) => { readyResolve = resolve; });
      for (let i = 0; i < RACERS; i += 1) {
        const worker = new Worker(racerSource, {
          eval: true,
          workerData: {
            coordinatorPath: coordinatorModulePath, stateDir: raceRoot,
            lockName: 'race-target', sab, startBuf, racers: RACERS,
          },
        });
        worker.on('message', (message) => {
          if (message && message.ready === true) {
            readyCount += 1;
            if (readyCount === RACERS && readyResolve) { const done = readyResolve; readyResolve = null; done(); }
            return;
          }
          inbox.push(message);
          if (inbox.length === RACERS && releaseBatch) {
            const done = releaseBatch; releaseBatch = null; rejectBatch = null; done();
          }
        });
        worker.on('error', (err) => abortStorm(err));
        worker.on('exit', (code) => abortStorm(new Error(`OPS3 racer worker exited early with code ${code}`)));
        racerWorkers.push(worker);
      }
      await withDeadline(allReady, WORKER_READY_BOUND_MS,
        `OPS3 only ${readyCount} of ${RACERS} racer workers became ready within ${WORKER_READY_BOUND_MS}ms`);
      eq(readyCount, RACERS, 'OPS3 every racer worker reports itself ready before any trial is released');

      const runStorm = async (label, seedAgeMs, seedToken) => {
        const tally = {};
        let maxConcurrent = 0;
        let nonLockedRefusals = 0;
        let leakedLock = 0;
        let trialsWithNoHolder = 0;
        let trialsWithoutContention = 0;
        for (let trial = 1; trial <= TRIALS; trial += 1) {
          if (stormAbort) throw stormAbort;
          fs.rmSync(path.join(raceRoot, 'locks'), { recursive: true, force: true });
          fs.mkdirSync(raceLock, { recursive: true });
          const seed = { pid: DEAD_PID, host: HOST, started_at: new Date(Date.now() - seedAgeMs).toISOString() };
          if (seedToken) seed.token = `seed-${label}-${trial}`;
          fs.writeFileSync(path.join(raceLock, 'owner.json'), `${JSON.stringify(seed, null, 2)}\n`);
          inbox.length = 0;
          Atomics.store(arr, INSIDE, 0); Atomics.store(arr, MAXI, 0); Atomics.store(arr, ATTEMPTS, 0);
          const settled = new Promise((resolve, reject) => { releaseBatch = resolve; rejectBatch = reject; });
          startAt[0] = Date.now() + 8;
          Atomics.store(arr, GO, trial); Atomics.notify(arr, GO);
          await withDeadline(settled, STORM_TRIAL_BOUND_MS,
            `OPS3 storm '${label}' trial ${trial}: only ${inbox.length} of ${RACERS} racers reported within ${STORM_TRIAL_BOUND_MS}ms`);
          const acquired = inbox.filter((entry) => entry.acquired).length;
          tally[acquired] = (tally[acquired] || 0) + 1;
          if (acquired === 0) trialsWithNoHolder += 1;
          // A trial in which nobody was refused is a trial in which nobody
          // contended, and exclusion measured over an uncontended trial is
          // vacuously satisfied. The racers are released from a shared barrier
          // and the winner holds until every racer has reported, so a real trial
          // always produces losers; counting them is how this suite knows the
          // storm was a storm.
          if (inbox.filter((entry) => !entry.acquired && entry.code === 'LOCKED').length === 0) trialsWithoutContention += 1;
          maxConcurrent = Math.max(maxConcurrent, Atomics.load(arr, MAXI));
          nonLockedRefusals += inbox.filter((entry) => !entry.acquired && entry.code !== 'LOCKED').length;
          if (fs.existsSync(raceLock)) leakedLock += 1;
        }
        return { tally, maxConcurrent, nonLockedRefusals, leakedLock, trialsWithNoHolder, trialsWithoutContention };
      };

      // 1. the OPS-3 path itself: a one-minute-old lock whose same-host owner pid
      //    is provably gone, in the legacy tokenless owner shape a pre-fix
      //    coordinator leaves behind.
      const fresh = await runStorm('fresh', 60 * 1000, false);
      // WHAT IS ASSERTED HERE IS CONCURRENCY, NOT ACQUISITION COUNT.
      // `maxConcurrent` is sampled with Atomics from INSIDE the critical section,
      // so it measures the property under test directly. The per-trial tally does
      // not: two acquisitions in one trial are a legitimate SEQUENTIAL handoff —
      // the winner's hold elapses, it releases, and a racer still retrying takes
      // the now-free lock — and that is exactly what was observed red, at
      // {'1':59,'2':1} with maxConcurrent never leaving 1. Pinning the tally to
      // `{1: TRIALS}` turned a wall-clock outcome into an exclusion assertion and
      // reported a green result as a breach. The tally is kept only as a LIVENESS
      // check (a trial that produces no holder at all is a real failure) and as
      // the guarantee that `maxConcurrent === 1` is not vacuously true because
      // nobody ever entered.
      eq(fresh.trialsWithNoHolder, 0,
        `OPS3 every one of the ${TRIALS} trials against a fresh same-host dead-pid lock produces a holder`);
      eq(fresh.trialsWithoutContention, 0,
        `OPS3 every one of the ${TRIALS} trials against a fresh same-host dead-pid lock is genuinely contended, so exclusion is never vacuously satisfied`);
      eq(fresh.maxConcurrent, 1, 'OPS3 no two racers are ever inside the critical section together');
      eq(fresh.nonLockedRefusals, 0, 'OPS3 every losing racer refuses with a clean LOCKED, never a crash');
      eq(fresh.leakedLock, 0, 'OPS3 the single winner releases the lock directory after every trial');

      // 2. the pre-existing post-window reclaim path (same code, same hazard).
      const aged = await runStorm('aged', 31 * 60 * 1000, false);
      eq(aged.trialsWithNoHolder, 0,
        `OPS3 every one of the ${TRIALS} trials against a lock past the staleness window produces a holder`);
      eq(aged.trialsWithoutContention, 0,
        `OPS3 every one of the ${TRIALS} trials against a lock past the staleness window is genuinely contended, so exclusion is never vacuously satisfied`);
      eq(aged.maxConcurrent, 1, 'OPS3 post-window reclaim is exclusion-safe too');
      eq(aged.nonLockedRefusals, 0, 'OPS3 post-window losers refuse with a clean LOCKED, never a crash');
      eq(aged.leakedLock, 0, 'OPS3 the post-window winner releases the lock directory after every trial');

      // 3. owner records that already carry a claim token key off the token.
      const tokened = await runStorm('tokened', 60 * 1000, true);
      eq(tokened.trialsWithNoHolder, 0,
        `OPS3 every one of the ${TRIALS} trials against a tokened dead-pid lock produces a holder`);
      eq(tokened.trialsWithoutContention, 0,
        `OPS3 every one of the ${TRIALS} trials against a tokened dead-pid lock is genuinely contended, so exclusion is never vacuously satisfied`);
      eq(tokened.maxConcurrent, 1, 'OPS3 token-keyed reclaim is exclusion-safe');
      eq(tokened.nonLockedRefusals, 0, 'OPS3 token-keyed losers refuse with a clean LOCKED, never a crash');
      eq(tokened.leakedLock, 0, 'OPS3 the token-keyed winner releases the lock directory after every trial');

      stormOver = true;
      Atomics.store(arr, GO, -1); Atomics.notify(arr, GO);
      for (const worker of racerWorkers) await worker.terminate();
      fs.rmSync(raceRoot, { recursive: true, force: true });
    }

    // A release only removes a lock directory that is still THIS process's:
    // a reclaimer that took the lock over must not have it deleted underneath it.
    {
      const handoverLock = path.join(lockRoot, 'locks', 'handover.lock');
      let observed = null;
      await withLock(ctx, 'handover', async () => {
        // simulate a reclaim landing mid-section: the directory is replaced and
        // re-owned by somebody else while this section is still running.
        fs.rmSync(handoverLock, { recursive: true, force: true });
        fs.mkdirSync(handoverLock, { recursive: true });
        fs.writeFileSync(path.join(handoverLock, 'owner.json'), `${JSON.stringify({
          pid: process.pid, host: HOST, started_at: new Date().toISOString(), token: 'successor-token',
        }, null, 2)}\n`);
      });
      // Guarded: an unconditional release deletes this record, and an unguarded
      // read then throws a bare ENOENT stack instead of naming what broke.
      eq(fs.existsSync(path.join(handoverLock, 'owner.json')), true,
        'OPS3 the successor\u2019s owner record still exists after the previous holder released');
      observed = JSON.parse(fs.readFileSync(path.join(handoverLock, 'owner.json'), 'utf8'));
      eq(observed.token, 'successor-token',
        'OPS3 release leaves a lock directory that another process legitimately owns intact');
      fs.rmSync(handoverLock, { recursive: true, force: true });
    }

    fs.rmSync(lockRoot, { recursive: true, force: true });
  }

  // --- OPS-3b: no expiry may revoke a steal gate whose winner is mid-steal ---
  // The per-generation steal gate is the ONLY thing serialising the destructive
  // half of a reclaim (compare the generation -> rmSync -> mkdirSync). An
  // age-only sweep therefore handed one generation to a second authorised
  // destroyer: the second reclaimer re-won the gate, re-observed the still
  // unchanged generation, reclaimed, claimed and entered `fn`, and the first
  // reclaimer then destroyed the second's LIVE directory and entered beside it.
  // A safety mechanism must not depend on a timeout for correctness, so a gate
  // is now removed only when its stamped creator is PROVABLY DEAD on this host.
  {
    const {
      withLock, observeLockDirectory, observeReclaimGate, sweepLockReclaimGates,
      lockReclaimGateRoot, reclaimLockDirectory,
    } = coordinator;
    const HOST = os.hostname();
    const DEAD_PID = require('child_process').spawnSync(process.execPath, ['-e', '0']).pid;
    const gateRoot3b = fs.mkdtempSync(path.join(os.tmpdir(), 'ops3b-'));
    const ctx3b = { stateDir: gateRoot3b };
    const gateDir = lockReclaimGateRoot(ctx3b);
    const AGED = 10 * 60 * 1000;

    const seedStale = (name) => {
      const lockPath = path.join(gateRoot3b, 'locks', `${name}.lock`);
      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify({
        pid: DEAD_PID, host: HOST, started_at: new Date(Date.now() - 60 * 1000).toISOString(),
      }, null, 2)}\n`);
      return lockPath;
    };
    const backdate = (target, ms) => {
      const when = (Date.now() - ms) / 1000;
      fs.utimesSync(target, when, when);
    };
    // Writes a gate for `name`'s CURRENT generation exactly where the coordinator
    // would look for it, stamped with whatever creator the case is probing.
    const plantGate = (name, lockPath, creator, ageMs) => {
      fs.mkdirSync(gateDir, { recursive: true });
      const gatePath = path.join(gateDir, `${name}.${observeLockDirectory(lockPath).key}`);
      if (creator === 'legacy-directory') fs.mkdirSync(gatePath);
      else fs.writeFileSync(gatePath, `${JSON.stringify(creator, null, 2)}\n`);
      if (ageMs) backdate(gatePath, ageMs);
      return gatePath;
    };
    const attempt3b = async (name) => {
      try {
        await withLock(ctx3b, name, async () => 'ok');
        return { acquired: true, code: null };
      } catch (err) { return { acquired: false, code: err.code }; }
    };
    const liveCreator = () => ({ pid: process.pid, host: HOST, started_at: new Date().toISOString(), nonce: 'live' });
    const deadCreator = () => ({ pid: DEAD_PID, host: HOST, started_at: new Date().toISOString(), nonce: 'dead' });

    // 1. The sweep predicate itself: ownership decides, not age.
    {
      const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'ops3b-sweep-'));
      const put = (label, body, ageMs) => {
        const p = path.join(probe, label);
        if (body === 'legacy-directory') fs.mkdirSync(p);
        else fs.writeFileSync(p, typeof body === 'string' ? body : `${JSON.stringify(body)}\n`);
        if (ageMs) backdate(p, ageMs);
        return p;
      };
      const liveAged = put('live-aged', liveCreator(), AGED);
      const liveFresh = put('live-fresh', liveCreator(), 0);
      const deadAged = put('dead-aged', deadCreator(), AGED);
      const deadFresh = put('dead-fresh', deadCreator(), 0);
      const unknownAged = put('unknown-aged', { pid: 0, host: HOST, started_at: new Date().toISOString() }, AGED);
      const foreignAged = put('foreign-aged', { pid: DEAD_PID, host: `${HOST}-elsewhere`, started_at: new Date().toISOString() }, AGED);
      const foreignFresh = put('foreign-fresh', { pid: DEAD_PID, host: `${HOST}-elsewhere`, started_at: new Date().toISOString() }, 0);
      const garbageAged = put('garbage-aged', '{not json', AGED);
      const garbageFresh = put('garbage-fresh', '{not json', 0);
      const legacyAged = put('legacy-aged', 'legacy-directory', AGED);
      const legacyFresh = put('legacy-fresh', 'legacy-directory', 0);

      sweepLockReclaimGates(probe);

      eq(fs.existsSync(liveAged), true,
        'OPS3b the sweep KEEPS a long-expired gate whose stamped creator is alive on this host');
      eq(fs.existsSync(liveFresh), true, 'OPS3b the sweep keeps a fresh live-creator gate');
      eq(fs.existsSync(unknownAged), true,
        'OPS3b the sweep KEEPS an expired gate whose same-host creator liveness is UNKNOWN (fail closed)');
      eq(fs.existsSync(deadAged), false,
        'OPS3b the sweep removes a gate whose same-host creator is provably dead');
      eq(fs.existsSync(deadFresh), false,
        'OPS3b a provably-dead creator releases its gate immediately, with no TTL wait');
      eq(fs.existsSync(foreignAged), false, 'OPS3b a foreign-host stamp falls back to the TTL');
      eq(fs.existsSync(foreignFresh), true, 'OPS3b a fresh foreign-host stamp is inside its TTL and kept');
      eq(fs.existsSync(garbageAged), false, 'OPS3b an unparseable gate falls back to the TTL');
      eq(fs.existsSync(garbageFresh), true, 'OPS3b a fresh unparseable gate is inside its TTL and kept');
      eq(fs.existsSync(legacyAged), false, 'OPS3b a legacy directory-shaped gate falls back to the TTL');
      eq(fs.existsSync(legacyFresh), true, 'OPS3b a fresh legacy directory-shaped gate is kept');
      fs.rmSync(probe, { recursive: true, force: true });
    }

    // 2. A gate this code writes ends up stamped with its creator. Creation and
    //    attribution are NOT one operation -- `wx` is open+write+close, and the
    //    zero-byte window is observable -- so this pins the settled state only.
    //    An unstamped gate is kept by the TTL branch; what stops a second
    //    destroyer is the pre/post re-check exercised in the cases below.
    {
      const lockPath = seedStale('stamped');
      const result = await attempt3b('stamped');
      eq(result.acquired, true, 'OPS3b reclaiming a stale lock still succeeds');
      const gates = fs.readdirSync(gateDir).filter((e) => e.startsWith('stamped.'));
      eq(gates.length, 1, 'OPS3b the reclaim leaves exactly one consumed gate for that generation');
      const stamp = observeReclaimGate(path.join(gateDir, gates[0]));
      eq((stamp.creator || {}).pid, process.pid, 'OPS3b the gate is stamped with its creator pid');
      eq((stamp.creator || {}).host, HOST, 'OPS3b the gate is stamped with its creator host');
      ok(typeof (stamp.creator || {}).nonce === 'string' && stamp.creator.nonce.length > 0,
        'OPS3b the gate stamp carries a per-attempt nonce so byte equality identifies it');
      eq(fs.existsSync(lockPath), false, 'OPS3b the reclaimed lock is released');
    }

    // 3. THE DEFECT. A gate whose winner is still alive has aged past the expiry.
    //    Under an age-only sweep a second reclaimer revokes it, re-wins the same
    //    generation and reclaims a lock the first reclaimer is still stealing.
    {
      const lockPath = seedStale('mid-steal-live');
      const gatePath = plantGate('mid-steal-live', lockPath, liveCreator(), AGED);
      const result = await attempt3b('mid-steal-live');
      eq(result.acquired, false,
        'OPS3b an EXPIRED gate whose winner is still alive is NOT revoked: the generation stays reserved');
      eq(result.code, 'LOCKED', 'OPS3b the refusal is a clean LOCKED, not a raw filesystem error');
      eq(fs.existsSync(gatePath), true, 'OPS3b the live winner keeps its gate');
      eq((observeLockDirectory(lockPath).owner || {}).pid, DEAD_PID,
        'OPS3b the generation the live winner is stealing is left untouched');
    }

    // 4. Liveness is preserved: a gate whose creator really did die mid-reclaim
    //    is cleared at once, so a crashed reclaimer cannot wedge a generation.
    {
      const lockPath = seedStale('mid-steal-dead');
      const gatePath = plantGate('mid-steal-dead', lockPath, deadCreator(), 0);
      const result = await attempt3b('mid-steal-dead');
      eq(result.acquired, true,
        'OPS3b a gate abandoned by a provably dead reclaimer is cleared and the generation is reclaimable');
      eq(fs.existsSync(gatePath), true, 'OPS3b the successor leaves its own consumed gate behind');
      eq((observeReclaimGate(gatePath).creator || {}).pid, process.pid,
        'OPS3b the gate left behind is the successor’s, not the dead creator’s');
    }

    // 5. Same-host gates with unknown liveness, and fresh foreign/unparseable
    //    gates, all keep the generation reserved rather than guessing.
    for (const [label, creator, ageMs] of [
      ['an unknown-liveness same-host creator', { pid: 0, host: HOST, started_at: new Date().toISOString() }, AGED],
      ['a fresh foreign-host creator', { pid: DEAD_PID, host: `${HOST}-elsewhere`, started_at: new Date().toISOString() }, 0],
      ['a fresh unparseable stamp', 'not-json-at-all', 0],
      ['a fresh legacy directory gate', 'legacy-directory', 0],
    ]) {
      const name = `reserved-${label.replace(/[^a-z]+/gi, '-')}`;
      const lockPath = seedStale(name);
      plantGate(name, lockPath, creator, ageMs);
      const result = await attempt3b(name);
      eq(result.acquired, false, `OPS3b a generation gated by ${label} is not reclaimed`);
      eq(result.code, 'LOCKED', `OPS3b the refusal for ${label} is a clean LOCKED`);
    }

    // 6. The TTL fallback still applies to entries this code never writes, so
    //    foreign and legacy debris cannot wedge a generation forever.
    for (const [label, creator] of [
      ['an expired foreign-host creator', { pid: DEAD_PID, host: `${HOST}-elsewhere`, started_at: new Date().toISOString() }],
      ['an expired unparseable stamp', 'not-json-at-all'],
      ['an expired legacy directory gate', 'legacy-directory'],
    ]) {
      const name = `ttl-${label.replace(/[^a-z]+/gi, '-')}`;
      const lockPath = seedStale(name);
      plantGate(name, lockPath, creator, AGED);
      const result = await attempt3b(name);
      eq(result.acquired, true, `OPS3b ${label} still falls back to the TTL and is swept`);
    }

    // --- Shared child-process rig for the concurrency cases below. -----------
    // EVERY wait here is released by another process creating a FILE (or, in the
    // ledger cases, by a FIFO rendezvous or a rename). The clocks that remain are
    // failsafe upper bounds — CHILD_SIGNAL_BOUND_MS and STALL_FAILSAFE_MS below,
    // deliberately an order of magnitude apart so they cannot race each other,
    // and the matching bounds inside the ledger storm's own writers. The one
    // clock that is ASSERTED rather than merely bounded is writeState's own
    // five-second acquire deadline, in 13d, and that is production behaviour
    // being measured, not the test guessing at how long something takes.
    // Three of these cases used to infer "the other process has reached the
    // window I care about" from a fixed sleep instead; two of them flaked at
    // ~3.5% over 86 serial runs because a child's node startup outran the sleep,
    // and that flake masked a surviving mutant (the O_EXCL owner record) by
    // reporting it as caught.
    const spawnProcessRaw = require('child_process').spawn;
    // REF'D on purpose. An unref'd poll timer means that while this suite waits
    // for a child to reach a state, node may hold zero ref'd handles, drain the
    // loop, and exit 0 having asserted nothing — which is what this suite was
    // measured doing. A wait must either be satisfied or reported, never skipped.
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    // The parent's bound on observing a child signal and the CHILD's own stall
    // failsafe used to be the same 30s number, which made them race: a parent
    // slow to observe `reached` could spend its whole budget while the child's
    // stall budget ran out underneath it, and the child then resumed unreleased.
    // They are now separated by an order of magnitude in the safe direction —
    // the child never self-releases inside a wait the parent is still in — and
    // the parent's bound is generous enough to absorb node startup plus a
    // 9,000-line require on a loaded machine.
    const CHILD_SIGNAL_BOUND_MS = 120000;
    const STALL_FAILSAFE_MS = 600000;
    const spawnProcess = (...args) => {
      const child = spawnProcessRaw(...args);
      strayChildren.add(child);
      child.on('exit', () => strayChildren.delete(child));
      return child;
    };
    const childGone = (child) => Boolean(child) && (child.exitCode !== null || child.signalCode !== null);
    // Passing the child turns "this process already exited and will never write
    // the file" from a full-bound wait into an immediate, diagnosable red.
    const awaitFile = async (target, child) => {
      const until = Date.now() + CHILD_SIGNAL_BOUND_MS;
      for (;;) {
        if (fs.existsSync(target)) return true;
        if (childGone(child)) return fs.existsSync(target);
        if (Date.now() >= until) return fs.existsSync(target);
        await sleep(5);
      }
    };
    // A ref'd deadline around a child's exit: a wedged case reds by name instead
    // of hanging the preflight slot it runs in.
    const settleWithin = (promise, label) => {
      let timer = null;
      const bounded = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle within ${CHILD_SIGNAL_BOUND_MS}ms`)), CHILD_SIGNAL_BOUND_MS);
      });
      return Promise.race([promise, bounded]).finally(() => { if (timer !== null) clearTimeout(timer); });
    };
    // Tolerates a torn trailing line while a child is still appending; once the
    // children have exited there are no partial lines left to tolerate.
    const readEvents = (log) => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } }).filter(Boolean);
    const racerRunner = path.join(gateRoot3b, 'racer.js');
    fs.writeFileSync(racerRunner, [
      "'use strict';",
      "const fs = require('fs');",
      "delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;",
      "const coordinator = require(process.argv[2]);",
      "const [stateDir, name, who, holdMs, log] = process.argv.slice(3);",
      "const rec = (ev, extra) => fs.appendFileSync(log, JSON.stringify({ who, ev, at: Date.now(), ...(extra || {}) }) + '\\n');",
      "(async () => {",
      "  try {",
      "    await coordinator.withLock({ stateDir }, name, async () => {",
      "      rec('enter');",
      "      const until = Date.now() + Number(holdMs);",
      "      while (Date.now() < until) { /* hold the critical section */ }",
      "      rec('exit');",
      "    });",
      "    rec('acquired');",
      "  } catch (err) { rec('refused', { code: (err && err.code) || 'error' }); }",
      "})();",
    ].join('\n'));
    const spawnRacer = (name, who, holdMs, log, env) => spawnProcess(
      process.execPath, [racerRunner, coordinatorModulePath, gateRoot3b, name, who, String(holdMs), log],
      { stdio: 'ignore', env: { ...process.env, ...env } },
    );
    const settle = (child) => new Promise((resolve) => { child.on('exit', resolve); });
    const stallEnv = (stage, reached, go) => ({
      SAUCE_AUTOLOOP_RECLAIM_STALL_AT: stage,
      SAUCE_AUTOLOOP_RECLAIM_STALL_MS: String(STALL_FAILSAFE_MS),
      SAUCE_AUTOLOOP_RECLAIM_STALL_REACHED_FILE: reached,
      SAUCE_AUTOLOOP_RECLAIM_STALL_UNTIL_FILE: go,
    });
    const overlapCount = (events) => {
      const holds = events.filter((e) => e.ev === 'enter').map((e) => ({
        from: e.at,
        to: (events.find((x) => x.ev === 'exit' && x.who === e.who) || { at: Infinity }).at,
      }));
      let overlaps = 0;
      for (let i = 0; i < holds.length; i += 1) {
        for (let j = i + 1; j < holds.length; j += 1) {
          if (holds[i].from < holds[j].to && holds[j].from < holds[i].to) overlaps += 1;
        }
      }
      return overlaps;
    };

    // 7. END TO END, two real processes, on a handshake. A wins the gate and is
    //    suspended between its generation compare and its swap; it does not
    //    resume until this test releases it, and it is released only once B has
    //    committed to an outcome. So B's whole life happens inside A's mid-steal
    //    window: a second `enter` can only be an unauthorised one, and the
    //    legitimate sequential handoff that used to red this case (A reclaims,
    //    holds, releases, and only THEN a late-starting B acquires cleanly) is
    //    impossible by construction rather than improbable by timing.
    {
      const name = 'mid-steal-e2e';
      const logPath = path.join(gateRoot3b, 'mid-steal.log');
      const reached = path.join(gateRoot3b, 'mid-steal.reached');
      const go = path.join(gateRoot3b, 'mid-steal.go');
      fs.writeFileSync(logPath, '');
      const lockPath = seedStale(name);
      const gatePath = path.join(gateDir, `${name}.${observeLockDirectory(lockPath).key}`);
      const a = spawnRacer(name, 'A', 400, logPath, stallEnv('swap', reached, go));
      const aDone = settle(a);
      eq(await awaitFile(reached, a), true,
        'OPS3b the first reclaimer signals that it is suspended mid-steal, so B starts from a known state');
      eq(fs.existsSync(gatePath), true,
        'OPS3b the suspended reclaimer has already published the gate for the generation it is stealing');
      // Age the gate past every expiry without waiting for one: this is exactly
      // the condition an age-only sweep revoked a mid-steal winner's gate on.
      backdate(gatePath, AGED);
      const b = spawnRacer(name, 'B', 2000, logPath, {});
      const bDone = settle(b);
      let bSettled = false;
      bDone.then(() => { bSettled = true; });
      const bound = Date.now() + CHILD_SIGNAL_BOUND_MS;
      while (!bSettled && Date.now() < bound && !readEvents(logPath).some((e) => e.who === 'B')) await sleep(5);
      // The case is only meaningful if B really did commit to an outcome while A
      // was still suspended. Asserting that is what stops the wait from degrading
      // into "we waited a while and then released A anyway", which would leave
      // the sequential-handoff shape this case exists to exclude back on the table.
      eq(bSettled || readEvents(logPath).some((e) => e.who === 'B'), true,
        'OPS3b the second racer commits to an outcome INSIDE the first reclaimer’s mid-steal window');
      // Released only now, so if B did enter, the two holds genuinely overlap in
      // time rather than merely both existing.
      fs.writeFileSync(go, 'go');
      await settleWithin(Promise.all([aDone, bDone]), 'OPS3b mid-steal racers A and B');

      const events = readEvents(logPath);
      const entries = events.filter((e) => e.ev === 'enter');
      eq(overlapCount(events), 0,
        'OPS3b no expiry revokes a gate mid-steal: the two reclaimers never hold the section together');
      eq(entries.length, 1, 'OPS3b exactly one of the two racers enters the critical section');
      eq(entries[0].who, 'A', 'OPS3b the gate winner is the one that proceeds');
      eq(events.filter((e) => e.ev === 'refused').map((e) => `${e.who}:${e.code}`), ['B:LOCKED'],
        'OPS3b the racer that met the reserved gate refuses cleanly with LOCKED');
      eq(events.some((e) => e.who === 'A' && e.ev === 'acquired'), true,
        'OPS3b the suspended winner still completes its own reclaim after the stall');
    }

    // 8. Backstop for gates this code did NOT create. The ownership rule makes
    //    the sweep correctness-neutral for our own gates, but `.reclaim/` is a
    //    plain directory a third rail (or a hand) can empty. If our gate is gone
    //    when the swap completes, a second destroyer may already be authorised
    //    and inside `fn`, so we refuse instead of claiming — and we deliberately
    //    LEAVE the empty directory, because removing it would let a third
    //    process win the uncontended create and enter beside that holder.
    //
    //    The 'replaced' fixtures carry a stamp `reclaimLockDirectory` ACTUALLY
    //    writes. A real second reclaimer of this generation necessarily repeats
    //    our `lock` AND our `key` — the gate path IS `<name>.<key>` — and differs
    //    only in `pid` and `nonce`. An earlier fixture wrote `{pid, host,
    //    started_at, nonce}`, a shape nothing in the coordinator produces, so a
    //    gate identity check weakened to comparing only `key` refused it for the
    //    wrong reason and the suite stayed green. In-place replacement (same
    //    dev/ino, new bytes) covers the mirror weakening to dev/ino alone.
    const secondReclaimerStamp = (name, key, tag) => `${JSON.stringify({
      pid: process.pid, host: HOST, started_at: new Date().toISOString(),
      lock: name, key, nonce: `second-reclaimer-${tag}`,
    }, null, 2)}\n`;
    for (const stage of ['compare', 'swap']) for (const how of ['removed', 'replaced-in-place', 'replaced-fresh-inode']) {
      const name = `gate-${how}-at-${stage}`;
      const logPath = path.join(gateRoot3b, `${name}.log`);
      const reached = path.join(gateRoot3b, `${name}.reached`);
      const go = path.join(gateRoot3b, `${name}.go`);
      fs.writeFileSync(logPath, '');
      const lockPath = seedStale(name);
      const gateKey = observeLockDirectory(lockPath).key;
      const gatePath = path.join(gateDir, `${name}.${gateKey}`);
      const racer = spawnRacer(name, 'R', 0, logPath, stallEnv(stage, reached, go));
      const exited = settle(racer);
      eq(await awaitFile(reached, racer), true, `OPS3b the reclaimer signals that it is suspended at ${stage}`);
      eq(fs.existsSync(gatePath), true, `OPS3b the reclaimer stalled at ${stage} published its gate first`);
      const usurper = secondReclaimerStamp(name, gateKey, `${stage}-${how}`);
      if (how === 'removed') fs.rmSync(gatePath, { force: true });
      else if (how === 'replaced-in-place') fs.writeFileSync(gatePath, usurper); // same dev/ino, new bytes
      else { fs.rmSync(gatePath, { force: true }); fs.writeFileSync(gatePath, usurper); } // the shape a sweep-then-rewin leaves
      fs.writeFileSync(go, 'go');
      await settleWithin(exited, `OPS3b reclaimer with its gate ${how} at ${stage}`);

      const events = readEvents(logPath);
      eq(events.map((e) => e.ev), ['refused'],
        `OPS3b a reclaimer whose gate was ${how} at ${stage} never enters the critical section`);
      eq(events[0].code, 'LOCKED', `OPS3b the reclaimer whose gate was ${how} at ${stage} refuses with a clean LOCKED`);
      eq(fs.existsSync(lockPath), true, `OPS3b the lock directory survives a reclaim revoked at ${stage} (${how})`);
      if (how !== 'removed') {
        eq(observeReclaimGate(gatePath).raw, usurper,
          `OPS3b a reclaimer that lost its gate at ${stage} never deletes the gate that replaced it (${how})`);
      }
      // The handshake pins WHICH check fired, so both stages assert their exact
      // shape instead of a disjunction that either one would satisfy.
      const after = observeLockDirectory(lockPath);
      if (stage === 'compare') {
        eq((after.owner || {}).pid, DEAD_PID,
          `OPS3b a gate lost BEFORE the swap costs nothing: the observed generation is intact (${how})`);
      } else {
        eq(after.owner, null,
          `OPS3b a gate lost AFTER the swap leaves the directory unclaimable, never re-owned (${how})`);
        eq(fs.readdirSync(lockPath), [],
          `OPS3b the post-swap refusal deliberately leaves the empty directory, so no third process wins an uncontended create (${how})`);
      }
    }

    // 8b. WHICH BYTES ARE "OURS". The gate's `wx` write returns, and only then
    //     does the reclaimer record the identity it will re-check against. A
    //     second reclaimer of this generation can replace the gate inside that
    //     gap. Recording the identity with a READ-BACK of the file instead of
    //     the constant this process WROTE adopts the usurper's stamp as our own,
    //     both of the coordinator's gate re-checks then pass against it, and we
    //     destroy a generation the usurper is already authorised for. codex-coordinator.js says in
    //     capitals that `mine.raw` must be the written bytes; this is the case
    //     that makes that sentence load-bearing instead of decorative. The
    //     'removed' variant of case 8 cannot reach it (a missing file makes the
    //     stat throw and the read-back never happens), so both replacements are
    //     driven here.
    for (const how of ['replaced-in-place', 'replaced-fresh-inode']) {
      const name = `gate-stamp-${how}`;
      const logPath = path.join(gateRoot3b, `${name}.log`);
      const reached = path.join(gateRoot3b, `${name}.reached`);
      const go = path.join(gateRoot3b, `${name}.go`);
      fs.writeFileSync(logPath, '');
      const lockPath = seedStale(name);
      const gateKey = observeLockDirectory(lockPath).key;
      const gatePath = path.join(gateDir, `${name}.${gateKey}`);
      const racer = spawnRacer(name, 'R', 0, logPath, stallEnv('gate-stamped', reached, go));
      const exited = settle(racer);
      eq(await awaitFile(reached, racer), true,
        `OPS3b the reclaimer signals that it is suspended between its gate write and its identity capture (${how})`);
      eq(fs.existsSync(gatePath), true,
        `OPS3b the suspended reclaimer's gate already exists at that point (${how})`);
      const usurper = secondReclaimerStamp(name, gateKey, `stamped-${how}`);
      if (how === 'replaced-in-place') fs.writeFileSync(gatePath, usurper); // same dev/ino, new bytes
      else { fs.rmSync(gatePath, { force: true }); fs.writeFileSync(gatePath, usurper); }
      fs.writeFileSync(go, 'go');
      await settleWithin(exited, `OPS3b reclaimer whose gate was ${how} before its identity capture`);

      const events = readEvents(logPath);
      eq(events.map((e) => e.ev), ['refused'],
        `OPS3b a reclaimer that captured its identity AFTER its gate was ${how} never enters the critical section`);
      eq(events[0].code, 'LOCKED',
        `OPS3b that reclaimer refuses with a clean LOCKED (${how})`);
      eq(observeReclaimGate(gatePath).raw, usurper,
        `OPS3b it never adopts, and never deletes, the stamp that replaced its own (${how})`);
      const after = observeLockDirectory(lockPath);
      eq((after.owner || {}).pid, DEAD_PID,
        `OPS3b the generation the usurper is now authorised for is left completely intact (${how})`);
      fs.rmSync(lockPath, { recursive: true, force: true });
    }

    // 9. The generation key. It is only ever USED to build a gate path, so the
    //    gate protocol cannot notice if it stops discriminating — a key that
    //    never changes still admits exactly one reclaimer per name, and every
    //    case above stays green. What it must actually do is name ONE generation:
    //    the compare in reclaimLockDirectory is the sole TOCTOU guard between
    //    "I read a stale owner" and "I am about to destroy this directory".
    {
      const keyDir = path.join(gateRoot3b, 'locks', 'generation-key.lock');
      const ownerFile = path.join(keyDir, 'owner.json');
      fs.mkdirSync(keyDir, { recursive: true });
      const ownerless1 = observeLockDirectory(keyDir).key;
      fs.rmSync(keyDir, { recursive: true, force: true });
      fs.mkdirSync(keyDir, { recursive: true });
      const ownerless2 = observeLockDirectory(keyDir).key;
      ok(ownerless1 !== ownerless2,
        'OPS3b two generations of an ownerless lock directory are keyed apart by the directory itself');

      const legacy = (pid) => `${JSON.stringify({ pid, host: HOST, started_at: new Date().toISOString() }, null, 2)}\n`;
      fs.writeFileSync(ownerFile, legacy(111));
      const legacy1 = observeLockDirectory(keyDir).key;
      // Overwritten IN PLACE: adding no entry leaves the directory's own stat
      // untouched, so only the owner bytes can tell these two generations apart.
      fs.writeFileSync(ownerFile, legacy(222));
      const legacy2 = observeLockDirectory(keyDir).key;
      ok(legacy1 !== legacy2,
        'OPS3b a legacy generation key changes with the owner bytes, with the directory stat held constant');

      const tokened = (token) => `${JSON.stringify({ pid: process.pid, host: HOST, started_at: new Date().toISOString(), token }, null, 2)}\n`;
      fs.writeFileSync(ownerFile, tokened('token-one'));
      const tokened1 = observeLockDirectory(keyDir).key;
      fs.writeFileSync(ownerFile, tokened('token-two'));
      const tokened2 = observeLockDirectory(keyDir).key;
      ok(tokened1 !== tokened2, 'OPS3b two acquisitions of the same lock are keyed apart by their tokens');
      ok(tokened1.startsWith('t.'), 'OPS3b a tokened generation keys off the acquisition-unique token');
      ok(legacy1.startsWith('d.'), 'OPS3b an ownerless/legacy generation falls back to the directory digest');
      // DISCLOSED UNPINNED: dropping dev/ino from that digest survives this suite.
      // It is NOT an equivalent mutant — on a filesystem with coarse timestamps
      // two generations of one lock path can share ctime and birthtime, and the
      // weakened digest then names them both, which is exactly the TOCTOU the
      // compare exists to catch. It is unpinned because no deterministic fixture
      // exists here: nothing in POSIX can set ctime or birthtime, and 500
      // consecutive create/stat/remove/create pairs on this machine's APFS temp
      // filesystem produced 0 pairs sharing both (re-measured for this card; the
      // predecessor measured 0 of 200). An assertion that recomputed the digest
      // and compared it would pin the IMPLEMENTATION, not the behaviour, so none
      // is written. The behavioural consequence that CAN be reached is pinned
      // instead, in the case immediately below: a reclaimer carrying a stale
      // generation key must lose to the live generation that replaced it.
      eq(observeLockDirectory(path.join(gateRoot3b, 'locks', 'never-existed.lock')).key, 'absent',
        'OPS3b an absent lock names no generation');
      fs.rmSync(keyDir, { recursive: true, force: true });
    }

    // 10. ...and what that key BUYS, through the exported CAS itself. This is
    //     ordinary operation, not a fault injection: on the post-window and
    //     ownerless paths the owner this reclaimer observed can release normally
    //     and a LIVE holder can take the lock before the reclaimer gets there.
    //     Reclaiming a generation that is no longer present must lose; without
    //     the compare the reclaimer destroys a live holder's lock and reports
    //     success.
    {
      const name = 'stale-generation';
      const lockPath = seedStale(name);
      const staleKey = observeLockDirectory(lockPath).key;
      const ownerFile = path.join(lockPath, 'owner.json');
      fs.rmSync(lockPath, { recursive: true, force: true });
      fs.mkdirSync(lockPath, { recursive: true });
      const liveOwner = `${JSON.stringify({
        pid: process.pid, host: HOST, started_at: new Date().toISOString(), token: 'live-holder-token',
      }, null, 2)}\n`;
      fs.writeFileSync(ownerFile, liveOwner);
      eq(reclaimLockDirectory(ctx3b, name, lockPath, staleKey), 'lost',
        'OPS3b a reclaimer carrying a stale generation key loses to the live generation that replaced it');
      eq(fs.readFileSync(ownerFile, 'utf8'), liveOwner,
        'OPS3b the live holder keeps its lock and its owner record, byte for byte');
      fs.rmSync(lockPath, { recursive: true, force: true });
      eq(reclaimLockDirectory(ctx3b, name, lockPath, `${staleKey}-released`), 'vanished',
        'OPS3b a lock that released itself reports vanished, so the caller retries the atomic create');
    }

    // 11. The owner record is the identity that admits a process to `fn`, and the
    //     third-rail threat model that motivates the gate re-checks applies here
    //     too: sweep-worktrees.js writes these same directories with the pre-CAS
    //     shape. Entering requires having CREATED the record (O_EXCL) and still
    //     reading OUR OWN token back out of it — two conditions, one per stage.
    for (const stage of ['claim-write', 'claim-readback']) {
      const name = `owner-record-${stage}`;
      const logPath = path.join(gateRoot3b, `${name}.log`);
      const reached = path.join(gateRoot3b, `${name}.reached`);
      const go = path.join(gateRoot3b, `${name}.go`);
      fs.writeFileSync(logPath, '');
      const lockPath = path.join(gateRoot3b, 'locks', `${name}.lock`);
      const ownerFile = path.join(lockPath, 'owner.json');
      // No seeding: the racer wins the UNCONTENDED create, and is then taken from
      // under it before it is admitted to the critical section.
      const racer = spawnRacer(name, 'R', 0, logPath, stallEnv(stage, reached, go));
      const exited = settle(racer);
      eq(await awaitFile(reached, racer), true, `OPS3b the claimant signals that it is suspended at ${stage}`);
      const squatter = `${JSON.stringify({
        pid: process.pid, host: HOST, started_at: new Date().toISOString(), token: `squatter-${stage}`,
      }, null, 2)}\n`;
      if (stage === 'claim-write') {
        // The directory is the racer's, but the record lands first from
        // elsewhere. Only O_EXCL notices; a plain write silently overwrites it.
        fs.writeFileSync(ownerFile, squatter);
      } else {
        // The racer's record was written; the directory is then replaced
        // wholesale and re-owned. Only the read-back, compared against OUR OWN
        // token, notices.
        fs.rmSync(lockPath, { recursive: true, force: true });
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(ownerFile, squatter);
      }
      fs.writeFileSync(go, 'go');
      await settleWithin(exited, `OPS3b claimant that lost its owner record at ${stage}`);

      const events = readEvents(logPath);
      eq(events.map((e) => e.ev), ['refused'],
        `OPS3b a claimant that lost the owner record at ${stage} never enters the critical section`);
      eq(events[0].code, 'LOCKED', `OPS3b the claimant refused at ${stage} refuses with a clean LOCKED`);
      eq(fs.readFileSync(ownerFile, 'utf8'), squatter,
        `OPS3b the refused claimant leaves the record that beat it at ${stage} intact`);
      fs.rmSync(lockPath, { recursive: true, force: true });
    }

    // 12. The gate TTL override. It only ever REMOVES gates, and only gates this
    //     code did not write, so an absurdly large value is fail-SAFE (`.reclaim/`
    //     just accumulates) — there is no upper clamp and none is asserted. A
    //     non-positive one is fail-OPEN: it would sweep every foreign-host and
    //     legacy gate on sight, handing away generations whose winners still hold
    //     them. That asymmetry is the whole reason the validation is one-sided.
    {
      const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'ops3b-ttl-'));
      const foreignGate = (label) => {
        const p = path.join(probe, label);
        fs.writeFileSync(p, `${JSON.stringify({
          pid: DEAD_PID, host: `${HOST}-elsewhere`, started_at: new Date().toISOString(),
        }, null, 2)}\n`);
        return p;
      };
      const previousTtl = process.env.SAUCE_AUTOLOOP_LOCK_GATE_TTL_MS;
      try {
        const rejected = ['-1', '-60000', '0', 'not-a-number', ''];
        rejected.forEach((value, index) => {
          const gate = foreignGate(`rejected-${index}`);
          process.env.SAUCE_AUTOLOOP_LOCK_GATE_TTL_MS = value;
          sweepLockReclaimGates(probe);
          eq(fs.existsSync(gate), true,
            `OPS3b a ${JSON.stringify(value)} gate-TTL override is rejected for the default, not applied: the fresh foreign gate survives`);
        });
        const honoured = foreignGate('honoured');
        backdate(honoured, 5000);
        process.env.SAUCE_AUTOLOOP_LOCK_GATE_TTL_MS = '1000';
        sweepLockReclaimGates(probe);
        eq(fs.existsSync(honoured), false, 'OPS3b a POSITIVE gate-TTL override is honoured');
      } finally {
        if (previousTtl === undefined) delete process.env.SAUCE_AUTOLOOP_LOCK_GATE_TTL_MS;
        else process.env.SAUCE_AUTOLOOP_LOCK_GATE_TTL_MS = previousTtl;
      }
      fs.rmSync(probe, { recursive: true, force: true });
    }

    // 13. writeState's `state-write` lock — the LEDGER lock. It routes through the
    //     same primitives, but every case above drives withLock, not writeState.
    //     Four cases run here: 13a concurrency, 13b release, 13c reclamation,
    //     13d admission. 13a and 13b were the whole of it until this revision,
    //     and neither one reaches the reclaim branch — 13a now asserts that it
    //     does not, rather than leaving it to be assumed.
    {
      const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops3b-state-'));
      const writerSrc = path.join(stateRoot, 'ledger-writer.js');
      fs.writeFileSync(writerSrc, [
        "'use strict';",
        "const fs = require('fs');",
        "delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;",
        "const coordinator = require(process.argv[2]);",
        "const [stateDir, statePath, who, rounds, ready, go] = process.argv.slice(3);",
        "const ctx = { stateDir, statePath };",
        "if (ready) fs.writeFileSync(ready, '1');",
        "if (go) {",
        "  const until = Date.now() + 30000;",
        "  while (!fs.existsSync(go) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);",
        "}",
        "for (let i = 0; i < Number(rounds); i += 1) {",
        "  coordinator.writeState(ctx, coordinator.emptyState(), { card: `${who}-${i}`, phase: 'claimed' });",
        "}",
      ].join('\n'));

      // 13a. The concurrency claim, reproducible from the repo: six processes
      //      writing the ledger at once lose no updates. They are released by a
      //      barrier file, so they contend rather than merely running near
      //      each other.
      {
        const stormDir = path.join(stateRoot, 'storm');
        const statePath = path.join(stormDir, 'state.json');
        const go = path.join(stateRoot, 'storm.go');
        const WRITERS = 6;
        const ROUNDS = 3;
        const children = [];
        const readies = [];
        for (let i = 0; i < WRITERS; i += 1) {
          const ready = path.join(stateRoot, `storm-ready-${i}`);
          readies.push(ready);
          children.push(spawnProcess(
            process.execPath,
            [writerSrc, coordinatorModulePath, stormDir, statePath, `w${i}`, String(ROUNDS), ready, go],
            { stdio: 'ignore', env: { ...process.env } },
          ));
        }
        const codes = Promise.all(children.map((child) => new Promise((resolve) => { child.on('exit', resolve); })));
        let armed = true;
        for (let i = 0; i < readies.length; i += 1) armed = (await awaitFile(readies[i], children[i])) && armed;
        eq(armed, true, 'OPS3b all six ledger writers reached the barrier before any of them wrote');
        fs.writeFileSync(go, 'go');
        eq((await settleWithin(codes, 'OPS3b the six concurrent ledger writers')).filter((code) => code !== 0), [],
          'OPS3b no concurrent ledger writer fails or times out');

        const written = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const expected = [];
        for (let i = 0; i < WRITERS; i += 1) for (let r = 0; r < ROUNDS; r += 1) expected.push(`w${i}-${r}`);
        eq(Object.keys(written.cards).sort(), expected.sort(),
          'OPS3b six processes writing the ledger concurrently lose zero updates');
        eq(written.schema_version, 1, 'OPS3b the concurrently written ledger is still a valid state document');
        // AND WHAT THIS CASE DOES NOT REACH, asserted rather than assumed.
        // Nothing here is ever STOLEN. A surviving steal gate is the record of a
        // generation somebody committed to destroying: reclaimLockDirectory
        // hands its own gate back when it walks away without touching the
        // directory, and keeps it only once it has passed the generation compare
        // and started the swap. Nothing outside the coordinator writes into
        // `.reclaim/` in this case, so an empty one means no generation was
        // reclaimed here.
        //
        // The weaker thing, that reclaimLockDirectory is never ENTERED, is NOT
        // asserted, because it is not true: these writers hold sub-second locks
        // and then exit, and a writer that reads a holder's owner bytes just
        // before that holder releases and exits probes it as provably dead a
        // moment later, so the lock momentarily looks reclaimable. Entry ends
        // 'vanished' (the lock is already gone) or 'lost' (a new generation
        // replaced it), and both give the gate back. Asserting on the DIRECTORY
        // instead of on its contents reds under six-way concurrency; it was
        // measured doing so once in eighteen runs, which is the whole reason
        // this assertion says gates and not directories.
        //
        // So a `state-write` reclaim reverted to a blind rmSync+mkdirSync leaves
        // this case green, and 13c is the case that drives it.
        eq(fs.existsSync(path.join(stormDir, 'locks', '.reclaim'))
          ? fs.readdirSync(path.join(stormDir, 'locks', '.reclaim')) : [], [],
          'OPS3b six live ledger writers never steal a generation: not one consumed steal gate survives, so this case proves nothing about reclamation');
      }

      // 13b. ...and the release is TOKEN-CONDITIONAL. A ledger writer suspended
      //      long enough to be reclaimed must not delete the lock its successor
      //      now holds: an unconditional rmSync there leaves the ledger's own
      //      critical section unprotected for whoever legitimately took it. The
      //      suspension is a FIFO read INSIDE the critical section — writeState
      //      reads the ledger under its lock — so it is a handshake with no
      //      timing assumption at all, not a sleep.
      {
        const fifoDir = path.join(stateRoot, 'fifo');
        fs.mkdirSync(fifoDir, { recursive: true });
        const statePath = path.join(fifoDir, 'state.json');
        execFileSync('mkfifo', [statePath]);
        const child = spawnProcess(
          process.execPath, [writerSrc, coordinatorModulePath, fifoDir, statePath, 'suspended', '1', '', ''],
          { stdio: 'ignore', env: { ...process.env } },
        );
        const exited = new Promise((resolve) => { child.on('exit', resolve); });
        const lockPath = path.join(fifoDir, 'locks', 'state-write.lock');
        const ownerFile = path.join(lockPath, 'owner.json');
        // THE FIFO IS THE HANDSHAKE, AND THE ORDER IS WHAT MAKES IT ONE.
        // Waiting on owner.json first — as this case used to — is a race, not a
        // handshake: that file is observable the INSTANT claimLockDirectory's
        // O_EXCL write returns, which is BEFORE the read-back that actually
        // admits the writer. Replacing the lock directory on sight therefore
        // sometimes took the record away at exactly the stage `claim-readback`
        // exists to test, the writer refused with LOCKED, it never opened the
        // FIFO, and the parent's open loop then spent its entire bound and
        // failed on an assertion that was describing the wrong thing.
        // Opening the FIFO for writing is the correct wait. On POSIX, O_WRONLY
        // with O_NONBLOCK is ENXIO until a reader has the FIFO open, and the
        // only reader is writeState reading the ledger from INSIDE its own
        // critical section — so a successful open proves the child is past BOTH
        // admission conditions and is suspended in the section, with no clock
        // assumption anywhere in the sequence.
        let fd = null;
        const bound = Date.now() + CHILD_SIGNAL_BOUND_MS;
        while (fd === null && Date.now() < bound && !childGone(child)) {
          try { fd = fs.openSync(statePath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK); }
          catch (_) { await sleep(5); }
        }
        ok(fd !== null, 'OPS3b the ledger writer is suspended INSIDE its critical section, blocked reading the ledger');
        eq(fs.existsSync(ownerFile), true,
          'OPS3b the suspended ledger writer holds the state-write lock while it is blocked there');
        // Only now does a successor take the generation out from under it.
        fs.rmSync(lockPath, { recursive: true, force: true });
        fs.mkdirSync(lockPath, { recursive: true });
        const successor = `${JSON.stringify({
          pid: process.pid, host: HOST, started_at: new Date().toISOString(), token: 'ledger-successor-token',
        }, null, 2)}\n`;
        fs.writeFileSync(ownerFile, successor);
        // Releasing the holder is now a single write into the fd already open.
        fs.writeSync(fd, `${JSON.stringify({ schema_version: 1, updated_at: new Date().toISOString(), cards: {} })}\n`);
        fs.closeSync(fd);
        eq(await settleWithin(exited, 'OPS3b the suspended ledger writer'), 0,
          'OPS3b the reclaimed ledger writer still completes its own write and exits cleanly');

        eq(fs.existsSync(lockPath), true,
          'OPS3b a ledger writer reclaimed while suspended does not delete the lock its successor now holds');
        eq(fs.readFileSync(ownerFile, 'utf8'), successor,
          'OPS3b the successor’s ledger-lock owner record survives the reclaimed writer’s release');
      }

      // 13c. ...and the RECLAIM half of that same lock, which 13a never performs
      //      and now asserts that it never performs. What a tool-timeout SIGTERM
      //      actually leaves behind is a state-write.lock whose same-host pid is
      //      provably gone here. Every writer that meets one finds it stale at
      //      once, so six of them take the reclaim branch together, and only the
      //      compare-and-set stops the losers deleting the winner's fresh lock
      //      and merging the ledger beside it. Reverting this one call site to
      //      the blind rmSync+mkdirSync it replaced leaves every other case in
      //      this file green.
      //
      //      Two independent things are measured. Zero lost updates is the
      //      BEHAVIOUR: each trial seeds a dead-owner lock, releases six writers
      //      onto it from a two-phase barrier that has them all hot-spinning on
      //      one file before it appears, and requires all six cards to survive
      //      the merge. Exactly one steal gate per seeded generation is the
      //      NON-VACUITY: `.reclaim/<lock>.<key>` is written by
      //      reclaimLockDirectory and by nothing else, and a reclaimer that
      //      walks away without touching the directory hands its gate back. So a
      //      SURVIVING gate at the seeded generation's exact path proves that
      //      generation was committed to and consumed, not merely looked at, and
      //      its uniqueness proves it was never handed to a second destroyer.
      {
        const reclaimDir = path.join(stateRoot, 'reclaim-storm');
        const statePath = path.join(reclaimDir, 'state.json');
        const signals = path.join(stateRoot, 'reclaim-signals');
        fs.mkdirSync(signals, { recursive: true });
        const lockPath = path.join(reclaimDir, 'locks', 'state-write.lock');
        const stormGateDir = lockReclaimGateRoot({ stateDir: reclaimDir });
        const WRITERS = 6;
        const TRIALS = 20;
        const stormSrc = path.join(stateRoot, 'ledger-storm-writer.js');
        fs.writeFileSync(stormSrc, [
          "'use strict';",
          "const fs = require('fs');",
          "delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;",
          "const coordinator = require(process.argv[2]);",
          "const [stateDir, statePath, who, trials, signals] = process.argv.slice(3);",
          "const ctx = { stateDir, statePath };",
          // Files the PARENT creates release every round, so no writer ever
          // infers "the fixture is ready" from the clock. The bounds are
          // failsafes against a wedged parent, never the thing being waited on.
          "const waitFor = (target) => { const until = Date.now() + 120000; while (!fs.existsSync(target)) { if (Date.now() >= until) return false; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); } return true; };",
          // Two-phase release. Phase one is a cheap polled wait for `arm`, and
          // a writer announces that it has left it. Only once the parent has
          // seen all six announcements does it create `go`, and by then all six
          // are in a tight stat loop with no sleep in it, so they observe `go`
          // within microseconds of each other. A 2ms poll released them within
          // ~2ms instead, which is an eternity next to the window this case
          // exists to hit: a loser has to still be between its staleness
          // decision on the dead owner and its own destructive step while the
          // winner completes the swap AND claims the record. Released on the
          // 2ms poll, the pre-CAS revert lost 0 updates in 20 trials; released
          // on this hot spin it loses 3 to 14.
          "const spinFor = (target) => { const until = Date.now() + 120000; while (!fs.existsSync(target)) { if (Date.now() >= until) return false; } return true; };",
          "fs.writeFileSync(`${signals}/ready-${who}`, '1');",
          "for (let t = 1; t <= Number(trials); t += 1) {",
          "  if (!waitFor(`${signals}/arm-${t}`)) process.exit(3);",
          "  fs.writeFileSync(`${signals}/spinning-${t}-${who}`, '1');",
          "  if (!spinFor(`${signals}/go-${t}`)) process.exit(4);",
          "  let failure = '';",
          "  try { coordinator.writeState(ctx, coordinator.emptyState(), { card: `${who}-${t}`, phase: 'claimed' }); }",
          "  catch (err) { failure = (err && err.message) || 'error'; }",
          // Published by rename, never by a bare write: the parent treats the
          // file's APPEARANCE as the result being ready, and writeFileSync is
          // create-then-write, so a bare write is observable empty. That is the
          // same "readable is not yet written" hazard the gate stamp has.
          "  fs.writeFileSync(`${signals}/done-${t}-${who}.part`, failure);",
          "  fs.renameSync(`${signals}/done-${t}-${who}.part`, `${signals}/done-${t}-${who}`);",
          "}",
          // NO WRITER EXITS WHILE THE PARENT IS STILL MEASURING. A writer that
          // exits is a writer whose owner record now probes as provably dead,
          // and that has two effects the measurement cannot tolerate: a sibling
          // that read those bytes a moment earlier treats a perfectly live lock
          // as reclaimable, and the gate sweep -- which removes any gate whose
          // same-host creator is dead -- can take away the consumed gate that
          // IS the evidence this case collects. Parking here means the only
          // reclaimable generation in the whole storm is the one the parent
          // seeded, by construction rather than by luck.
          "waitFor(`${signals}/finish`);",
        ].join('\n'));

        const stormChildren = [];
        for (let i = 0; i < WRITERS; i += 1) {
          stormChildren.push(spawnProcess(
            process.execPath,
            [stormSrc, coordinatorModulePath, reclaimDir, statePath, `w${i}`, String(TRIALS), signals],
            { stdio: 'ignore', env: { ...process.env } },
          ));
        }
        const stormCodes = Promise.all(stormChildren.map((child) => new Promise((resolve) => { child.on('exit', resolve); })));
        let stormArmed = true;
        for (let i = 0; i < WRITERS; i += 1) {
          stormArmed = (await awaitFile(path.join(signals, `ready-w${i}`), stormChildren[i])) && stormArmed;
        }
        eq(stormArmed, true,
          'OPS3b all six ledger reclaimers are running and parked on the barrier before the first stale lock is seeded');

        let unarmedWriters = 0;
        let missingResults = 0;
        let failedWrites = 0;
        let unreadableLedgers = 0;
        let lostUpdates = 0;
        let trialsWithSeededGate = 0;
        let trialsWithExactlyOneGate = 0;
        for (let trial = 1; trial <= TRIALS; trial += 1) {
          fs.rmSync(path.join(reclaimDir, 'locks'), { recursive: true, force: true });
          fs.rmSync(statePath, { force: true });
          // The SIGTERM'd-coordinator fixture: this host, a pid that is provably
          // gone here, and an age far INSIDE the staleness window — so it is the
          // early-reclaim predicate, not the clock, that makes it reclaimable.
          fs.mkdirSync(lockPath, { recursive: true });
          fs.writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify({
            pid: DEAD_PID, host: HOST, started_at: new Date().toISOString(),
          }, null, 2)}\n`);
          const seededKey = observeLockDirectory(lockPath).key;
          fs.writeFileSync(path.join(signals, `arm-${trial}`), 'arm');
          for (let i = 0; i < WRITERS; i += 1) {
            if (!(await awaitFile(path.join(signals, `spinning-${trial}-w${i}`), stormChildren[i]))) unarmedWriters += 1;
          }
          fs.writeFileSync(path.join(signals, `go-${trial}`), 'go');
          for (let i = 0; i < WRITERS; i += 1) {
            const done = path.join(signals, `done-${trial}-w${i}`);
            if (!(await awaitFile(done, stormChildren[i]))) missingResults += 1;
            else if (fs.readFileSync(done, 'utf8') !== '') failedWrites += 1;
          }
          const gates = fs.existsSync(stormGateDir) ? fs.readdirSync(stormGateDir) : [];
          if (gates.includes(`state-write.${seededKey}`)) trialsWithSeededGate += 1;
          if (gates.length === 1) trialsWithExactlyOneGate += 1;
          let cards = null;
          try {
            const doc = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (doc && doc.schema_version === 1 && doc.cards && typeof doc.cards === 'object') cards = doc.cards;
          } catch (_) { cards = null; }
          if (!cards) { unreadableLedgers += 1; continue; }
          for (let i = 0; i < WRITERS; i += 1) if (!Object.prototype.hasOwnProperty.call(cards, `w${i}-${trial}`)) lostUpdates += 1;
        }
        fs.writeFileSync(path.join(signals, 'finish'), 'finish'); // released only now that every trial is measured
        eq((await settleWithin(stormCodes, 'OPS3b the six concurrent ledger reclaimers')).filter((code) => code !== 0), [],
          'OPS3b no ledger reclaimer crashes or abandons the barrier');
        eq(unarmedWriters, 0,
          `OPS3b every trial releases all ${WRITERS} writers from a hot spin on one file, so they genuinely contend rather than merely running near each other`);
        eq(missingResults, 0, `OPS3b every one of the ${WRITERS} writers reports an outcome in all ${TRIALS} trials`);
        eq(failedWrites, 0,
          'OPS3b no writer is refused or times out acquiring a state-write lock whose owner is provably dead');
        eq(unreadableLedgers, 0, 'OPS3b every trial leaves a readable, schema-valid ledger');
        eq(lostUpdates, 0,
          `OPS3b ${WRITERS} processes reclaiming the SAME stale state-write lock lose zero ledger updates across ${TRIALS} trials`);
        eq(trialsWithSeededGate, TRIALS,
          `OPS3b every one of the ${TRIALS} trials actually reclaimed the generation it seeded: a consumed steal gate survives at that exact generation's path`);
        eq(trialsWithExactlyOneGate, TRIALS,
          'OPS3b the seeded generation is stolen exactly once per trial, never handed to a second destroyer');
      }

      // 13d. writeState's ADMISSION, which nothing above drives off its
      //      uncontended branch. 13c proves the compare-and-set that decides WHO
      //      may replace a dead owner's lock; these three probes pin what stands
      //      on either side of it — that a same-host owner of merely UNKNOWN
      //      liveness is not reclaimable inside the staleness window at all, and
      //      that the owner record which admits a writer is claimed with O_EXCL
      //      and then read back. All three are REFUSALS, so each settles on
      //      writeState's own five-second acquire deadline. That deadline is
      //      production behaviour being asserted, not a test guessing at
      //      timing — and the three run CONCURRENTLY, in one window rather than
      //      three, because none of them touches another's fixture.
      {
        const probeSrc = path.join(stateRoot, 'ledger-probe.js');
        fs.writeFileSync(probeSrc, [
          "'use strict';",
          "const fs = require('fs');",
          "delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;",
          "const coordinator = require(process.argv[2]);",
          "const [stateDir, statePath, card, result] = process.argv.slice(3);",
          "let outcome;",
          "try { coordinator.writeState({ stateDir, statePath }, coordinator.emptyState(), { card, phase: 'claimed' }); outcome = { admitted: true, message: '' }; }",
          "catch (err) { outcome = { admitted: false, message: (err && err.message) || 'error' }; }",
          // Same rename discipline as 13c: the parent parses this file the
          // moment it appears, so it must never be observable half-written.
          "fs.writeFileSync(`${result}.part`, JSON.stringify(outcome));",
          "fs.renameSync(`${result}.part`, result);",
        ].join('\n'));
        const probe = (label, env) => {
          const dir = path.join(stateRoot, `probe-${label}`);
          fs.mkdirSync(dir, { recursive: true });
          const statePath = path.join(dir, 'state.json');
          const result = path.join(stateRoot, `probe-${label}.json`);
          const child = spawnProcess(
            process.execPath, [probeSrc, coordinatorModulePath, dir, statePath, `probe-${label}`, result],
            { stdio: 'ignore', env: { ...process.env, ...(env || {}) } },
          );
          return {
            dir, statePath, result, child,
            lockPath: path.join(dir, 'locks', 'state-write.lock'),
            gateRoot: lockReclaimGateRoot({ stateDir: dir }),
            outcome: async () => {
              if (!(await awaitFile(result, child))) return { admitted: 'no result file', message: '' };
              const raw = fs.readFileSync(result, 'utf8');
              try { return JSON.parse(raw); } catch (_) { return { admitted: `unparseable result ${JSON.stringify(raw)}`, message: '' }; }
            },
          };
        };
        // A. UNKNOWN liveness is not death. A same-host owner whose pid cannot be
        //    probed at all, two seconds into a thirty-second window, is held —
        //    the reclaim branch is not even entered, which `.reclaim/` records
        //    by not existing.
        //
        //    TWO seconds, not ten, and the margin is the reason. This fixture
        //    ages in real time while the child starts node and requires a
        //    9,000-line module, so a slow enough start would carry the lock past
        //    the window and the child would then reclaim it legitimately, reddening
        //    a case about something else entirely. Two seconds leaves
        //    twenty-eight for that start under any load this machine produces,
        //    while still leaving the mutant it exists to catch — the window cut
        //    to zero — a full two seconds of age to trip over.
        const unknownDir = path.join(stateRoot, 'probe-unknown');
        fs.mkdirSync(path.join(unknownDir, 'locks'), { recursive: true });
        const unknownLock = path.join(unknownDir, 'locks', 'state-write.lock');
        fs.mkdirSync(unknownLock, { recursive: true });
        const unknownOwner = `${JSON.stringify({
          pid: 0, host: HOST, started_at: new Date(Date.now() - 2 * 1000).toISOString(),
        }, null, 2)}\n`;
        fs.writeFileSync(path.join(unknownLock, 'owner.json'), unknownOwner);
        const unknown = probe('unknown', {});

        // B. The owner record is claimed with O_EXCL. The writer is suspended
        //    with the directory created and the record not yet written; a
        //    squatter — live pid, so never stale — takes the record first.
        const exclReached = path.join(stateRoot, 'probe-excl.reached');
        const exclGo = path.join(stateRoot, 'probe-excl.go');
        const excl = probe('excl', stallEnv('claim-write', exclReached, exclGo));

        // C. ...and read back. Here the writer's OWN record is already written;
        //    the squatter replaces it before the read-back that admits.
        const backReached = path.join(stateRoot, 'probe-readback.reached');
        const backGo = path.join(stateRoot, 'probe-readback.go');
        const back = probe('readback', stallEnv('claim-readback', backReached, backGo));

        const squatter = `${JSON.stringify({
          pid: process.pid, host: HOST, started_at: new Date().toISOString(), token: 'ledger-squatter-token',
        }, null, 2)}\n`;
        eq(await awaitFile(exclReached, excl.child), true,
          'OPS3b the ledger writer signals that it is suspended with its lock directory created and its owner record not yet written');
        fs.writeFileSync(path.join(excl.lockPath, 'owner.json'), squatter);
        fs.writeFileSync(exclGo, 'go');
        eq(await awaitFile(backReached, back.child), true,
          'OPS3b the ledger writer signals that it is suspended between its owner-record write and the read-back that admits it');
        fs.writeFileSync(path.join(back.lockPath, 'owner.json'), squatter);
        fs.writeFileSync(backGo, 'go');

        const unknownOutcome = await unknown.outcome();
        eq(unknownOutcome.admitted, false,
          'OPS3b a ledger lock whose same-host owner liveness is UNKNOWN is NOT reclaimable inside the staleness window');
        ok(/timed out acquiring state-write lock/.test(unknownOutcome.message),
          'OPS3b that writer refuses on the acquire deadline, the one refusal writeState has');
        eq(fs.readFileSync(path.join(unknownLock, 'owner.json'), 'utf8'), unknownOwner,
          'OPS3b it leaves the unknown-liveness owner record exactly as it found it');
        eq(fs.existsSync(unknown.gateRoot), false,
          'OPS3b it never even opens a steal gate: an owner inside the window is not a generation to be reclaimed');
        eq(fs.existsSync(unknown.statePath), false, 'OPS3b and it writes no ledger');

        const exclOutcome = await excl.outcome();
        eq(exclOutcome.admitted, false,
          'OPS3b a ledger writer whose owner record was taken by a squatter before its own write is never admitted');
        eq(fs.readFileSync(path.join(excl.lockPath, 'owner.json'), 'utf8'), squatter,
          'OPS3b it never overwrites the squatter record that beat it to the ledger lock');
        eq(fs.existsSync(excl.statePath), false,
          'OPS3b and it writes no ledger beside the squatter');

        const backOutcome = await back.outcome();
        eq(backOutcome.admitted, false,
          'OPS3b a ledger writer whose own owner record was replaced before its read-back is never admitted');
        eq(fs.readFileSync(path.join(back.lockPath, 'owner.json'), 'utf8'), squatter,
          'OPS3b the record that replaced it survives its refusal');
        eq(fs.existsSync(back.statePath), false,
          'OPS3b and it writes no ledger beside the record that replaced it');
      }

      fs.rmSync(stateRoot, { recursive: true, force: true });
    }

    fs.rmSync(gateRoot3b, { recursive: true, force: true });
  }

  finish();
})().catch((err) => { console.error(err); process.exit(1); });
