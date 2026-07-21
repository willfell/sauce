#!/usr/bin/env node
/**
 * run-delivery-status — preflight harness for delivery:status deterministic
 * helpers (delivery-paths.js + delivery-status-digest.js). Zero-dep.
 */
'use strict';
const path = require('path');
const P = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-paths.js'));
const D = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-status-digest.js'));

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

// Digest fixture: one active claim, one actionable single-gate, plus no-action buckets.
const STATUS = {
  active: [{ card: 'ES2 Epic dashboard', phase: 'implementing' }],
  tracked: [
    { card: 'ES2 Epic dashboard', phase: 'implementing', status: 'implementing' },
    { card: 'GA-S1a done thing', status: 'completed' },
    { card: 'LH1 launchd authority', status: 'parked', resume_condition: 'do not resume host' },
    { card: 'ES3 gate', status: 'parked', resume_condition: 'Resume only after Will explicitly authorizes the flag' },
  ],
  parked: [
    { card: 'LH1 launchd authority', status: 'parked', resume_condition: 'do not resume host' },
    { card: 'ES3 gate', status: 'parked', resume_condition: 'Resume only after Will explicitly authorizes the flag' },
  ],
  projection_problems: [],
};
const dig = D.buildDigest(STATUS, '', ['v0.251.0', 'v0.250.0']);
ok('DS-1 exceptionCount = actionable length', dig.exceptionCount === 1);
ok('DS-2 noAction frozen/done', dig.noAction.frozen === 1 && dig.noAction.done === 1);
ok('DS-3 activeClaim from status.active[0]', dig.activeClaim && dig.activeClaim.card === 'ES2 Epic dashboard');
ok('DS-4 releases carried', dig.releases[0] === 'v0.251.0');

// DS-5: no active claim → activeClaim null.
const dig2 = D.buildDigest({ active: [], tracked: [], parked: [], projection_problems: [] }, '', []);
ok('DS-5 null activeClaim when none', dig2.activeClaim === null);

// DS-6: headline mentions the exception count and active card.
const h = D.headline(dig);
ok('DS-6 headline exception count', /1 need you/.test(h));
ok('DS-6 headline active card', /active: ES2 Epic dashboard/.test(h));
const h2 = D.headline(dig2);
ok('DS-6 headline zero → walk away', /walk away/.test(h2) && /active: none/.test(h2));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
