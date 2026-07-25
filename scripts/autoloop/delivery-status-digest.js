#!/usr/bin/env node
/**
 * delivery-status-digest — compose the read-only board glance for delivery:status.
 * Reuses delivery-review-triage.js; adds the active claim, a releases feed, and
 * the retroactive "since you last looked" section (discards, cutover flips,
 * SELF-RATIFIED FID amendments) filtered by a last-seen marker.
 *
 * The marker `.delivery-digest-last-seen` is the digest's OWN file, written
 * beside the coordinator state file (derived from status.state_path). The
 * digest never reads coordinator state directly — its only inputs are the
 * `status --json` output shape and the FID markdown.
 *
 * Documented gap: spec §3.5 also names "ceilings hit" and "decompositions" as
 * digest feeds, but coordinator `status --json` does not expose either yet;
 * they are omitted here until the coordinator grows them.
 *
 * Exports: buildDigest, headline, sinceLastLook, parseSelfRatified, markerPathFor
 * CLI: node scripts/autoloop/delivery-status-digest.js --status <status.json>
 *        [--fid <FID.md>] [--releases v1,v2,...] [--marker <path>] [--peek]
 *      Reading updates the marker (after a successful render); --peek renders
 *      without updating it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const triage = require('./delivery-review-triage.js');

// The digest's last-seen marker lives in the coordinator STATE dir, beside
// state.json — derived from the status output, never from vault paths.
function markerPathFor(status) {
  const statePath = status && status.state_path;
  if (!statePath) return null;
  return path.join(path.dirname(String(statePath)), '.delivery-digest-last-seen');
}

// SELF-RATIFIED FID amendments: `## <title> — SELF-RATIFIED <YYYY-MM-DD>`.
function parseSelfRatified(fidText) {
  const out = [];
  for (const line of String(fidText || '').split('\n')) {
    const m = line.match(/^##\s+(.*—\s*SELF-RATIFIED\s+(\d{4}-\d{2}-\d{2}))\s*$/);
    if (m) out.push({ heading: m[1].trim(), date: m[2] });
  }
  return out;
}

// Everything that happened after lastSeen (ISO timestamp; null = first read,
// everything is new). Self-ratified headings carry dates, not timestamps, so
// same-day amendments always show — over-inclusion is the safe side.
function sinceLastLook(status, fidText, lastSeen) {
  const seen = lastSeen || null;
  const afterTs = (ts) => !seen || String(ts || '') > seen;
  const seenDay = seen ? String(seen).slice(0, 10) : null;
  return {
    last_seen: seen,
    discards: (status.discarded_recent || [])
      // Timestamp-less discards always show — over-inclusion is the safe side.
      .filter((d) => !d.discarded_at || afterTs(d.discarded_at))
      .map((d) => ({
        name: d.name, reason: d.reason || null,
        superseded_by: d.superseded_by || null, discarded_at: d.discarded_at || null,
      })),
    cutover_flips: (status.cutover_history || []).filter((c) => afterTs(c.at)),
    self_ratified: parseSelfRatified(fidText).filter((a) => !seenDay || a.date >= seenDay),
  };
}

function sinceCount(since) {
  if (!since) return 0;
  return since.discards.length + since.cutover_flips.length + since.self_ratified.length;
}

function buildDigest(status, fidText, releases, opts) {
  const t = triage.triage(status, fidText);
  const active = (status.active && status.active[0]) || null;
  return {
    exceptionCount: t.actionable.length,
    noAction: t.noAction,
    activeClaim: active ? { card: active.card, phase: active.phase } : null,
    actionable: t.actionable,
    releases: releases || [],
    since: sinceLastLook(status, fidText, (opts && opts.lastSeen) || null),
  };
}

function headline(d) {
  const na = d.noAction;
  const active = d.activeClaim ? d.activeClaim.card : 'none';
  const excl = d.exceptionCount === 0
    ? '0 need you — walk away'
    : `${d.exceptionCount} need you`;
  const n = sinceCount(d.since);
  const tail = n > 0 ? ` · ${n} new since last look` : '';
  return `${excl} · ${na.frozen} frozen / ${na.waiting} waiting / ${na.done} done · active: ${active}${tail}`;
}

module.exports = { buildDigest, headline, sinceLastLook, parseSelfRatified, markerPathFor };

if (require.main === module) {
  const args = process.argv.slice(2);
  const statusPath = args[args.indexOf('--status') + 1];
  const fidIdx = args.indexOf('--fid');
  const fidText = fidIdx >= 0 ? fs.readFileSync(args[fidIdx + 1], 'utf8') : '';
  const relIdx = args.indexOf('--releases');
  const releases = relIdx >= 0 ? String(args[relIdx + 1] || '').split(',').filter(Boolean) : [];
  const peek = args.includes('--peek');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const markerIdx = args.indexOf('--marker');
  const markerPath = markerIdx >= 0 ? args[markerIdx + 1] : markerPathFor(status);
  let lastSeen = null;
  if (markerPath && fs.existsSync(markerPath)) {
    lastSeen = fs.readFileSync(markerPath, 'utf8').trim() || null;
  }
  const d = buildDigest(status, fidText, releases, { lastSeen });
  console.log(JSON.stringify({ ...d, headline: headline(d) }, null, 2));
  // Reading updates the marker — after the successful render, unless peeking.
  if (!peek && markerPath) {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, new Date().toISOString());
  }
}
