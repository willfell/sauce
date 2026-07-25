#!/usr/bin/env node
/**
 * run-delivery-status — preflight harness for delivery:status deterministic
 * helpers (delivery-paths.js + delivery-status-digest.js). Zero-dep.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const P = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-paths.js'));
const D = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-status-digest.js'));
const DIGEST_CLI = path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-status-digest.js');

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

// DP-1: empty env → defaults.
const d = P.deliveryPaths({});
ok('DP-1 default repoRoot', d.repoRoot === P.DEFAULTS.repoRoot);
ok('DP-1 default coordinator', d.coordinator === P.DEFAULTS.coordinator);
ok('DP-1 default fid', d.fid === P.DEFAULTS.fid);

// DP-2: env overrides win.
const o = P.deliveryPaths({ DELIVERY_REPO_ROOT: '/x', DELIVERY_COORDINATOR: '/c', DELIVERY_FID: '/f', DELIVERY_STATE: '/s' });
ok('DP-2 override repoRoot', o.repoRoot === '/x');
ok('DP-2 override coordinator', o.coordinator === '/c');
ok('DP-2 override fid', o.fid === '/f');

// DP-3: coordinatorPresent uses injected fs, true if either path exists.
const fsYes = { existsSync: (p) => p === '/c' };
const fsNo = { existsSync: () => false };
ok('DP-3 present when coordinator exists', P.coordinatorPresent({ coordinator: '/c', statePath: '/s' }, fsYes) === true);
ok('DP-3 absent when neither exists', P.coordinatorPresent({ coordinator: '/c', statePath: '/s' }, fsNo) === false);

// Digest fixture: post-reap status shape — no superseded corpses in parked[];
// parked cards are genuine waits or escalations. Tombstone data arrives via
// discarded_recent[]; cutover flips via cutover_history[].
const STATUS = {
  active: [{ card: 'ES2 Epic dashboard', phase: 'implementing' }],
  tracked: [
    { card: 'ES2 Epic dashboard', phase: 'implementing', status: 'implementing' },
    { card: 'GA-S1a done thing', status: 'completed' },
    { card: 'GA-R5 dedup pass', status: 'parked' },
    { card: 'ES3 gate', status: 'parked' },
  ],
  parked: [
    { card: 'GA-R5 dedup pass', status: 'parked',
      resume_condition: 'auto-resume after the GA-R2b2 touch-zone concurrency conflict clears' },
    { card: 'ES3 gate', status: 'parked',
      resume_condition: 'needs a Director decision on the perimeter scope' },
  ],
  projection_problems: [],
  discarded_total: 3,
  discarded_recent: [
    { name: 'ES4a Original renderer', discarded_at: '2026-07-24T10:00:00Z', superseded_by: 'ES4a2 Rebuilt renderer', reason: 'superseded at mint' },
    { name: 'GA-C1a Core design tokens', discarded_at: '2026-07-20T09:00:00Z', superseded_by: 'GA-C1c', reason: 'superseded corpse reaped' },
  ],
  cutover_history: [
    { enabled: false, at: '2026-07-19T08:00:00Z', reason: 'drift found' },
    { enabled: true, at: '2026-07-23T08:00:00Z' },
  ],
  state_path: '/tmp/coordinator/state.json',
};
const dig = D.buildDigest(STATUS, '', ['v0.251.0', 'v0.250.0']);
ok('DS-1 exceptionCount = actionable length', dig.exceptionCount === 1);
ok('DS-2 noAction waiting/done', dig.noAction.waiting === 1 && dig.noAction.done === 1 && dig.noAction.frozen === 0);
ok('DS-3 activeClaim from status.active[0]', dig.activeClaim && dig.activeClaim.card === 'ES2 Epic dashboard');
ok('DS-4 releases carried', dig.releases[0] === 'v0.251.0');

// DS-5: no active claim → activeClaim null.
const dig2 = D.buildDigest({ active: [], tracked: [], parked: [], projection_problems: [] }, '', []);
ok('DS-5 null activeClaim when none', dig2.activeClaim === null);

// DS-6: headline mentions the exception count, waiting count, and active card.
const h = D.headline(dig);
ok('DS-6 headline exception count', /1 need you/.test(h));
ok('DS-6 headline waiting not superseded', /1 waiting/.test(h) && !/superseded/.test(h));
ok('DS-6 headline active card', /active: ES2 Epic dashboard/.test(h));
const h2 = D.headline(dig2);
ok('DS-6 headline zero → walk away', /walk away/.test(h2) && /active: none/.test(h2));

// ---------------------------------------------------------------------------
// BGR-DIGEST-SINCE-LAST — "since you last looked" retroactive section.
// ---------------------------------------------------------------------------

// Marker path derives from status.state_path (the digest's OWN file beside the
// coordinator state, never a coordinator state file).
ok('BGR-DIGEST-SINCE-LAST markerPathFor derives from state_path',
  D.markerPathFor(STATUS) === path.join('/tmp/coordinator', '.delivery-digest-last-seen'));
ok('BGR-DIGEST-SINCE-LAST markerPathFor null without state_path',
  D.markerPathFor({}) === null);

// SELF-RATIFIED FID headings parse with their dates; PROPOSED/accepted ignored.
const FID = [
  '## Zone widening — SELF-RATIFIED 2026-07-24',
  'body',
  '## Old thing — accepted 2026-07-01',
  '## Pending thing — PROPOSED 2026-07-22',
  '## Early quorum pass — SELF-RATIFIED 2026-07-18',
  '',
].join('\n');
const sr = D.parseSelfRatified(FID);
ok('BGR-DIGEST-SINCE-LAST parseSelfRatified finds both', sr.length === 2);
ok('BGR-DIGEST-SINCE-LAST parseSelfRatified heading+date',
  sr[0] && /Zone widening/.test(sr[0].heading) && sr[0].date === '2026-07-24');
ok('BGR-DIGEST-SINCE-LAST parseSelfRatified ignores PROPOSED/accepted',
  sr.every((a) => !/Old thing|Pending thing/.test(a.heading)));

// sinceLastLook filters each feed by the last-seen timestamp.
const since = D.sinceLastLook(STATUS, FID, '2026-07-22T00:00:00Z');
ok('BGR-DIGEST-SINCE-LAST discards newer than last-seen only',
  since.discards.length === 1 && since.discards[0].name === 'ES4a Original renderer');
ok('BGR-DIGEST-SINCE-LAST discard carries reason + superseded_by',
  since.discards[0].reason === 'superseded at mint' && since.discards[0].superseded_by === 'ES4a2 Rebuilt renderer');
ok('BGR-DIGEST-SINCE-LAST cutover flips newer than last-seen only',
  since.cutover_flips.length === 1 && since.cutover_flips[0].enabled === true);
ok('BGR-DIGEST-SINCE-LAST self-ratified newer than last-seen only',
  since.self_ratified.length === 1 && /Zone widening/.test(since.self_ratified[0].heading));
ok('BGR-DIGEST-SINCE-LAST carries last_seen', since.last_seen === '2026-07-22T00:00:00Z');

// Null last-seen (first read) → everything is new.
const sinceAll = D.sinceLastLook(STATUS, FID, null);
ok('BGR-DIGEST-SINCE-LAST null last-seen includes everything',
  sinceAll.discards.length === 2 && sinceAll.cutover_flips.length === 2 && sinceAll.self_ratified.length === 2);

// Same-day self-ratified amendments always show (date-granular headings vs
// timestamp marker — over-inclusion is the safe side).
const sameDay = D.sinceLastLook(STATUS, FID, '2026-07-24T23:00:00Z');
ok('BGR-DIGEST-SINCE-LAST same-day self-ratified still shown',
  sameDay.self_ratified.length === 1 && sameDay.self_ratified[0].date === '2026-07-24');

// Older coordinator output without the new fields → empty feeds, no throw.
const sinceEmpty = D.sinceLastLook({}, '', null);
ok('BGR-DIGEST-SINCE-LAST missing fields → empty feeds',
  sinceEmpty.discards.length === 0 && sinceEmpty.cutover_flips.length === 0 && sinceEmpty.self_ratified.length === 0);

// A discard with no timestamp always shows — over-inclusion is the safe side.
const sinceNoTs = D.sinceLastLook(
  { discarded_recent: [{ name: 'GA-X1 Undated tombstone', discarded_at: null, superseded_by: null, reason: 'legacy record' }] },
  '', '2026-07-22T00:00:00Z');
ok('BGR-DIGEST-SINCE-LAST timestamp-less discard always shows',
  sinceNoTs.discards.length === 1 && sinceNoTs.discards[0].name === 'GA-X1 Undated tombstone');

// buildDigest carries the since section; opts.lastSeen threads through.
const dig3 = D.buildDigest(STATUS, FID, [], { lastSeen: '2026-07-22T00:00:00Z' });
ok('BGR-DIGEST-SINCE-LAST buildDigest.since threaded',
  dig3.since && dig3.since.discards.length === 1 && dig3.since.self_ratified.length === 1);
ok('BGR-DIGEST-SINCE-LAST 3-arg buildDigest defaults to everything-new',
  dig.since && dig.since.discards.length === 2);
ok('BGR-DIGEST-SINCE-LAST headline counts new items',
  /3 new since last look/.test(D.headline(dig3)));

// CLI: reading the digest updates the marker; --peek does not.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-digest-'));
try {
  const stateDir = path.join(tmp, 'coordinator');
  fs.mkdirSync(stateDir, { recursive: true });
  const statusPath = path.join(tmp, 'status.json');
  fs.writeFileSync(statusPath, JSON.stringify({ ...STATUS, state_path: path.join(stateDir, 'state.json') }));
  const fidPath = path.join(tmp, 'FID.md');
  fs.writeFileSync(fidPath, FID);
  const marker = path.join(stateDir, '.delivery-digest-last-seen');

  // Seed a marker, then peek: output filtered by it, marker untouched.
  fs.writeFileSync(marker, '2026-07-22T00:00:00Z');
  const peekOut = JSON.parse(execFileSync(process.execPath, [DIGEST_CLI, '--status', statusPath, '--fid', fidPath, '--peek'], { encoding: 'utf8' }));
  ok('BGR-DIGEST-SINCE-LAST CLI peek filters by marker', peekOut.since.discards.length === 1);
  ok('BGR-DIGEST-SINCE-LAST CLI peek leaves marker untouched',
    fs.readFileSync(marker, 'utf8') === '2026-07-22T00:00:00Z');

  // Non-peek read updates the marker to now.
  const readOut = JSON.parse(execFileSync(process.execPath, [DIGEST_CLI, '--status', statusPath, '--fid', fidPath], { encoding: 'utf8' }));
  const after = fs.readFileSync(marker, 'utf8').trim();
  ok('BGR-DIGEST-SINCE-LAST CLI read updates marker',
    after !== '2026-07-22T00:00:00Z' && /^\d{4}-\d{2}-\d{2}T/.test(after));
  ok('BGR-DIGEST-SINCE-LAST CLI read rendered before marker write', readOut.since.discards.length === 1);

  // First-ever read (no marker): everything new, marker created.
  fs.rmSync(marker);
  const firstOut = JSON.parse(execFileSync(process.execPath, [DIGEST_CLI, '--status', statusPath, '--fid', fidPath], { encoding: 'utf8' }));
  ok('BGR-DIGEST-SINCE-LAST CLI first read shows everything', firstOut.since.discards.length === 2);
  ok('BGR-DIGEST-SINCE-LAST CLI first read creates marker', fs.existsSync(marker));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
