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

module.exports = { isHostLineage };
