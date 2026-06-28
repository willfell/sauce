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
 * @returns {{status:string, card:(string|null), nextAction:string, number?:number, extra?:string[]}}
 */
function reconcileInFlight(o) {
  const { branches = [], prs = [] } = o || {};
  const branchSlugs = [...new Set(branches.map(slugFromRef).filter(Boolean))];
  const prRecs = prs
    .map((p) => ({ slug: slugFromRef(p.headRefName), state: String(p.state || '').toUpperCase(), number: Number(p.number) || 0 }))
    .filter((p) => p.slug);

  // 1. Any OPEN autoloop PR wins (highest number = most recent).
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

  // 3. No open PR, no bare branch → judge by the most-recent PR's terminal state.
  if (prRecs.length) {
    const recent = prRecs.slice().sort((a, b) => b.number - a.number)[0];
    if (recent.state === 'MERGED') return { status: 'merged', card: recent.slug, number: recent.number, nextAction: 'close-card' };
    return { status: 'failed', card: recent.slug, number: recent.number, nextAction: 'block-card' };
  }

  // 4. Nothing in flight.
  return { status: 'idle', card: null, nextAction: 'pick' };
}

module.exports = { reconcileInFlight, slugFromRef };

if (require.main === module) {
  const { execFileSync } = require('child_process');
  const sh = (cmd, args) => {
    try { return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
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
  console.log(JSON.stringify(reconcileInFlight({ branches, prs }), null, 2));
  process.exit(0);
}
