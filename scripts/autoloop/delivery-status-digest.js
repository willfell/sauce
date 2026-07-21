#!/usr/bin/env node
/**
 * delivery-status-digest — compose the read-only board glance for delivery:status.
 * Reuses delivery-review-triage.js; adds the active claim and a releases feed.
 * Pure functions; the CLI is the only I/O.
 *
 * Exports: buildDigest, headline
 * CLI: node scripts/autoloop/delivery-status-digest.js --status <status.json> [--fid <FID.md>] [--releases v1,v2,...]
 */
'use strict';
const fs = require('fs');
const triage = require('./delivery-review-triage.js');

function buildDigest(status, fidText, releases) {
  const t = triage.triage(status, fidText);
  const active = (status.active && status.active[0]) || null;
  return {
    exceptionCount: t.actionable.length,
    noAction: t.noAction,
    activeClaim: active ? { card: active.card, phase: active.phase } : null,
    actionable: t.actionable,
    releases: releases || [],
  };
}

function headline(d) {
  const na = d.noAction;
  const active = d.activeClaim ? d.activeClaim.card : 'none';
  const excl = d.exceptionCount === 0
    ? '0 need you — walk away'
    : `${d.exceptionCount} need you`;
  return `${excl} · ${na.frozen} frozen / ${na.superseded} superseded / ${na.done} done · active: ${active}`;
}

module.exports = { buildDigest, headline };

if (require.main === module) {
  const args = process.argv.slice(2);
  const statusPath = args[args.indexOf('--status') + 1];
  const fidIdx = args.indexOf('--fid');
  const fidText = fidIdx >= 0 ? fs.readFileSync(args[fidIdx + 1], 'utf8') : '';
  const relIdx = args.indexOf('--releases');
  const releases = relIdx >= 0 ? String(args[relIdx + 1] || '').split(',').filter(Boolean) : [];
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const d = buildDigest(status, fidText, releases);
  console.log(JSON.stringify({ ...d, headline: headline(d) }, null, 2));
}
