#!/usr/bin/env node
/**
 * reconcile-inflight — derive the autoloop's in-flight status from OBSERVED
 * git + GitHub PR state (the system of record). Level-triggered, idempotent.
 * Pure function: observed facts in → {status, card, nextAction} out.
 * The CLI does the impure git/gh gathering, then calls the pure function.
 *
 * Exports: reconcileInFlight, slugFromRef
 */
'use strict';

// 'autoloop/fix-x' or 'origin/autoloop/fix-x' → 'fix-x'
function slugFromRef(ref) {
  if (!ref) return null;
  const m = String(ref).match(/(?:^|\/)autoloop\/(.+)$/);
  return m ? m[1].trim() : null;
}

/**
 * @param {object} o
 * @param {string[]} [o.branches] branch names matching autoloop/* (local and/or remote)
 * @param {Array<{headRefName:string,state:string,number:number}>} [o.prs] autoloop/* PRs, any state
 * @param {number[]} [o.reconciled] PR numbers already reconciled by a prior turn (the ledger).
 *   Terminal (merged/failed) PRs on this list are SKIPPED when judging the newest terminal
 *   state — without it, the newest merged PR re-fires `merged` forever and the loop never
 *   reaches `idle` (the merged-deadlock). Open PRs / bare branches are never filtered: an
 *   open or in-implementation card is in-flight regardless of what was reconciled before.
 * @returns {{status:string, card:(string|null), nextAction:string, number?:number, extra?:string[]}}
 */
function reconcileInFlight(o) {
  const { branches = [], prs = [], reconciled = [] } = o || {};
  const reconciledSet = new Set((Array.isArray(reconciled) ? reconciled : []).map(Number).filter(Number.isFinite));
  const branchSlugs = [...new Set(branches.map(slugFromRef).filter(Boolean))];
  const prRecs = prs
    .map((p) => ({ slug: slugFromRef(p.headRefName), state: String(p.state || '').toUpperCase(), number: Number(p.number) || 0 }))
    .filter((p) => p.slug);

  // 1. Any OPEN autoloop PR wins (highest number = most recent). Never ledger-filtered.
  const open = prRecs.filter((p) => p.state === 'OPEN').sort((a, b) => b.number - a.number);
  if (open.length) {
    return { status: 'pr-open', card: open[0].slug, number: open[0].number, nextAction: 'wait',
      ...(open.length > 1 ? { extra: open.slice(1).map((p) => p.slug) } : {}) };
  }

  // 2. A branch with no PR at all → mid-implementation (crashed before PR, or in progress).
  const prSlugs = new Set(prRecs.map((p) => p.slug));
  const bare = branchSlugs.filter((s) => !prSlugs.has(s));
  if (bare.length) {
    return { status: 'implementing', card: bare[0], nextAction: 'resume-or-clean',
      ...(bare.length > 1 ? { extra: bare.slice(1) } : {}) };
  }

  // 3. No open PR, no bare branch → judge by the most-recent NOT-YET-RECONCILED terminal PR.
  //    A PR already in the ledger was closed/blocked by a prior turn; skipping it is what
  //    lets the loop fall through to `idle` instead of re-firing merged/failed forever.
  const terminal = prRecs.filter((p) => !reconciledSet.has(p.number));
  if (terminal.length) {
    const recent = terminal.slice().sort((a, b) => b.number - a.number)[0];
    if (recent.state === 'MERGED') return { status: 'merged', card: recent.slug, number: recent.number, nextAction: 'close-card' };
    return { status: 'failed', card: recent.slug, number: recent.number, nextAction: 'block-card' };
  }

  // 4. Nothing un-reconciled in flight.
  return { status: 'idle', card: null, nextAction: 'pick' };
}

// Pure ledger update: add `number` to `existing` (deduped, numeric), keep the most-recent `cap`.
// Small integers, so the cap is only a runaway guard; the tail is what matters (newest PRs).
function nextLedger(existing, number, cap = 500) {
  const nums = (Array.isArray(existing) ? existing : []).map(Number).filter(Number.isFinite);
  const n = Number(number);
  if (Number.isFinite(n) && !nums.includes(n)) nums.push(n);
  return cap > 0 ? nums.slice(-cap) : nums;
}

module.exports = { reconcileInFlight, slugFromRef, nextLedger };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const ROOT = path.resolve(__dirname, '..', '..');
  const LEDGER = path.join(ROOT, '.autoloop-reconciled.json'); // local-only (gitignored), one machine
  const readLedger = () => { try { const v = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).reconciled; return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  const writeLedger = (nums) => fs.writeFileSync(LEDGER, JSON.stringify({ reconciled: nums }), 'utf8');

  const cmd = process.argv[2];
  // `record <pr-number>` — the live merged/failed branch calls this AFTER it closes/blocks the
  // card, so the NEXT turn skips that PR and can reach idle. Read-only reconcile never mutates.
  if (cmd === 'record') {
    const n = Number(process.argv[3]);
    if (!Number.isFinite(n)) { console.error('usage: reconcile-inflight.js record <pr-number>'); process.exit(2); }
    const updated = nextLedger(readLedger(), n);
    writeLedger(updated);
    console.log(JSON.stringify({ recorded: n, count: updated.length }));
    process.exit(0);
  }
  if (cmd === 'list') { console.log(JSON.stringify({ reconciled: readLedger() })); process.exit(0); }

  const sh = (c, args) => {
    try { return execFileSync(c, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch (_) { return null; }
  };
  const clean = (out) => (out || '').split('\n').map((s) => s.replace(/^[*+]?\s*/, '').trim()).filter(Boolean);
  const branches = [...clean(sh('git', ['branch', '--list', 'autoloop/*'])),
                    ...clean(sh('git', ['branch', '-r', '--list', 'origin/autoloop/*']))];
  // gh is authoritative for PR state. If it fails, do NOT assume idle — fail safe to halt.
  const prJson = sh('gh', ['pr', 'list', '--state', 'all', '--limit', '200', '--json', 'headRefName,state,number']);
  if (prJson === null) {
    console.log(JSON.stringify({ status: 'unknown', card: null, nextAction: 'halt', reason: 'gh query failed — not assuming idle' }));
    process.exit(0);
  }
  let prs;
  try { prs = JSON.parse(prJson); }
  catch (_) {
    // Exit-0 but unparseable output (OOM-truncated, wrapper noise) — do NOT assume idle.
    console.log(JSON.stringify({ status: 'unknown', card: null, nextAction: 'halt', reason: 'gh output not valid JSON — not assuming idle' }));
    process.exit(0);
  }
  console.log(JSON.stringify(reconcileInFlight({ branches, prs, reconciled: readLedger() }), null, 2));
  process.exit(0);
}
