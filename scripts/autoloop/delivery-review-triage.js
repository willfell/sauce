#!/usr/bin/env node
/**
 * delivery-review-triage — deterministic blocker classifier for delivery:review.
 * Pure functions over `codex-coordinator.js status --json` output + FID text.
 * No model, no side effects.
 *
 * Post-reap semantics (board & governance redesign): superseded corpses never
 * appear in status.tracked/parked — the coordinator discards them at mint time
 * (and `reap` is the backstop), so there is no superseded-corpse bucket here.
 * The corpse-inference helpers (stemOf/hasDeployedSupersedingSibling) live in
 * codex-coordinator.js now; the copies that used to live here were dead code.
 * Parked cards classify only as genuine waits (concurrency/deploy) or
 * escalations the Director should see.
 *
 * Exports: isHostLineage, classifyCard, triage, parseProvisionalPending
 * CLI: node scripts/autoloop/delivery-review-triage.js --status <status.json> [--fid <FID.md>]
 */
'use strict';
const fs = require('fs');

// The constitutional durable-host suspension (FID § durable-host suspension).
// Reap discards the evidence cards, but the suspension is policy, not a card —
// this guard is defense-in-depth so host lineage can never surface as work.
const HOST_LINEAGE = [
  /^LH\d/i,                       // LH1, LH2, LH3, LH3b, LH4
  /^A5\b/i,                       // original A5 durable host
  /^GA-OPS10[ab]\b/i,             // GA-OPS10a / GA-OPS10b
  /^GA-OPS4b\b/i,                 // transactional intake amendments
  /\bLoop host parent\b/i,
  /\bdurable host\b/i,
  /\blaunchd\b/i,
  /\beffect-authority engine\b/i,
];

function isHostLineage(cardName) {
  const s = String(cardName || '');
  return HOST_LINEAGE.some((re) => re.test(s));
}

function isDeployed(status) {
  return status === 'deployed' || status === 'completed';
}

// Genuine loop-owned waits: the coordinator self-resumes these, so they are
// no-action. Free-text resume conditions, matched on the two sanctioned park
// causes under the new governance.
function isConcurrencyWait(resume) {
  const s = String(resume || '');
  return /concurren/i.test(s) || (/touch[- ]?zones?/i.test(s) && /\b(conflict|overlap|lock|clear|free)/i.test(s));
}

function isDeployWait(resume) {
  return /\b(deploy(s|ed|ment)?|release[sd]?|ships?|brew)\b/i.test(String(resume || ''));
}

// Explicit-approval precedence: a resume condition naming Will/the Director or
// using approval phrasing (ratify/approve/authorize) is a human gate no matter
// what wait vocabulary it also uses — "Will ratifies the release-cadence
// amendment" is not a deploy wait. Checked BEFORE both wait heuristics so
// gates are never buried in noAction.waiting; fail-open toward surfacing.
// "Will" matches case-SENSITIVELY (the proper noun), so ordinary auxiliary
// "will" in loop-authored prose does not escalate every wait.
function namesHumanApproval(resume) {
  const s = String(resume || '');
  return /\bWill\b/.test(s) || /\bdirector\b/i.test(s) || /ratif|approv|authoriz/i.test(s);
}

// Order matters: safety buckets (active, done, host) win before wait/escalation
// classification, so the host suspension can never be surfaced as work.
function classifyCard(card, ctx) {
  const name = card.card;
  if (ctx.activeIds && ctx.activeIds.has(name)) return 'active';
  if (card.status === 'in_progress' || card.status === 'implementing' ||
      card.status === 'claimed' || card.status === 'feature_pr') return 'active';
  if (isDeployed(card.status)) return 'done';
  if (isHostLineage(name)) return 'suspended-evidence';
  if (card.status === 'blocked') return 'coordinator-deadend';
  const resume = String(card.resume_condition || '');
  if (namesHumanApproval(resume)) return 'escalation';
  if (isConcurrencyWait(resume)) return 'concurrency-wait';
  if (isDeployWait(resume)) return 'deploy-wait';
  // Anything else parked is outside the loop's own resume authority — surface
  // it to the Director instead of inventing a wait.
  return 'escalation';
}

// Rank actionable buckets: ledger-distorting first, then Director escalations.
const RANK = {
  'provisional-pending': 0,
  'coordinator-deadend': 1,
  'escalation': 2,
};

function parseProvisionalPending(fidText) {
  return String(fidText || '')
    .split('\n')
    .filter((line) => /^##\s+.*PROVISIONALLY ACCEPTED/i.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

function triage(status, fidText) {
  const activeIds = new Set((status.active || []).map((c) => c.card));
  const tracked = status.tracked || [];
  // Enrich each tracked card with its parked resume_condition (parked[] carries it).
  const parkedByName = new Map((status.parked || []).map((p) => [p.card, p]));
  const ctx = { activeIds, tracked };

  const actionable = [];
  const noAction = { frozen: 0, waiting: 0, done: 0, active: 0 };

  for (const t of tracked) {
    const enriched = { ...(parkedByName.get(t.card) || {}), ...t };
    const bucket = classifyCard(enriched, ctx);
    if (bucket === 'active') { noAction.active++; continue; }
    if (bucket === 'suspended-evidence') { noAction.frozen++; continue; }
    if (bucket === 'concurrency-wait' || bucket === 'deploy-wait') { noAction.waiting++; continue; }
    if (bucket === 'done') { noAction.done++; continue; }
    actionable.push({ card: t.card, bucket, resume_condition: enriched.resume_condition || '' });
  }

  // Coordinator projection-problem cards are deadends even when their status reads clean.
  for (const p of status.projection_problems || []) {
    if (!actionable.some((a) => a.card === p.card)) {
      actionable.push({ card: p.card, bucket: 'coordinator-deadend', resume_condition: p.error || '' });
    }
  }

  // Provisional-pending amendments (from FID) rank first.
  for (const heading of parseProvisionalPending(fidText)) {
    actionable.push({ card: heading, bucket: 'provisional-pending', resume_condition: '' });
  }

  actionable.sort((a, b) => (RANK[a.bucket] ?? 9) - (RANK[b.bucket] ?? 9));
  return { actionable, noAction };
}

module.exports = { isHostLineage, classifyCard, triage, parseProvisionalPending };

if (require.main === module) {
  const args = process.argv.slice(2);
  const statusPath = args[args.indexOf('--status') + 1];
  const fidIdx = args.indexOf('--fid');
  const fidText = fidIdx >= 0 ? fs.readFileSync(args[fidIdx + 1], 'utf8') : '';
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  console.log(JSON.stringify(triage(status, fidText), null, 2));
}
