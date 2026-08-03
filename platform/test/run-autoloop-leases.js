#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  leaseIsLive, leaseSummary, acquireLease, clearLease, LEASE_TTL_MS, commandResume, commandClaim,
} = require('../../scripts/autoloop/codex-coordinator');

let count = 0;
function ok(value, label) { assert.ok(value, label); count += 1; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); count += 1; }

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

  console.log(`AUTOLOOP-LEASES PASS (${count} assertions)`);
})().catch((err) => { console.error(err); process.exit(1); });
