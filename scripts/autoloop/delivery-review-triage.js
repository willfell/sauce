#!/usr/bin/env node
/**
 * delivery-review-triage — deterministic blocker classifier for delivery:review.
 * Pure functions over `codex-coordinator.js status --json` output + FID text.
 * No model, no side effects.
 *
 * Exports: isHostLineage, stemOf, hasDeployedSupersedingSibling, classifyCard,
 *          triage, parseProvisionalPending
 * CLI: node scripts/autoloop/delivery-review-triage.js --status <status.json> [--fid <FID.md>]
 */
'use strict';
const fs = require('fs');

// The ratified durable-host NEVER-list (FID § durable-host suspension) plus the
// direct-approval-gated cards. Matched against the card id/name prefix.
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

// The first whitespace-delimited token is the card id (e.g. "GA-C9a2").
function idToken(cardName) {
  return String(cardName || '').trim().split(/\s+/)[0] || '';
}

// Strip a trailing supersession suffix: a lowercase letter + optional digits
// ("a", "b", "a2", "c"). "GA-C9a2" → "GA-C9"; "GA-OPS11a" → "GA-OPS11".
function stemOf(cardName) {
  const id = idToken(cardName);
  const m = id.match(/^(.*?)([a-z]\d*)$/);
  return m ? m[1] : id;
}

function isDeployed(status) {
  return status === 'deployed' || status === 'completed';
}

// A parked card X is a superseded corpse when some OTHER tracked card Y is
// deployed AND shares X's stem AND its name marks it as the successor
// ("supersedes" or "final value-review completion").
function hasDeployedSupersedingSibling(card, tracked) {
  const stem = stemOf(card.card);
  if (!stem) return false;
  const selfId = idToken(card.card);
  return (tracked || []).some((y) => {
    if (idToken(y.card) === selfId) return false;
    if (!isDeployed(y.status)) return false;
    if (stemOf(y.card) !== stem) return false;
    return /supersedes|final value-review completion/i.test(y.card);
  });
}

// resume_condition names Will's direct approval by name — never actionable.
function isDirectApproval(resume) {
  return /Will\b[^.]*\bexplicit(ly)?\b[^.]*\bapprov/i.test(String(resume || ''));
}

// Order matters: safety buckets (active, host, direct-approval, corpse) win
// before any "actionable" classification, so a NEVER-list card can never be
// surfaced as work.
function classifyCard(card, ctx) {
  const name = card.card;
  if (ctx.activeIds && ctx.activeIds.has(name)) return 'active';
  if (card.status === 'in_progress' || card.status === 'implementing' ||
      card.status === 'claimed' || card.status === 'feature_pr') return 'active';
  if (isHostLineage(name)) return 'suspended-evidence';
  if (isDirectApproval(card.resume_condition)) return 'suspended-evidence';
  if (hasDeployedSupersedingSibling(card, ctx.tracked)) return 'superseded-corpse';
  if (card.status === 'blocked') return 'coordinator-deadend';
  const resume = String(card.resume_condition || '');
  if (/\bvalue review\b/i.test(resume) && /\bexhaust/i.test(resume)) return 'exhausted-lineage';
  if (/Resume only after Will\b.*\bauthori/i.test(resume)) return 'single-gate-block';
  if (/\bvalue review\b/i.test(resume)) return 'exhausted-lineage';
  return 'single-gate-block';
}

module.exports = { isHostLineage, stemOf, hasDeployedSupersedingSibling, classifyCard };
