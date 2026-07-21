#!/usr/bin/env node
/**
 * run-delivery-status — preflight harness for delivery:status deterministic
 * helpers (delivery-paths.js + delivery-status-digest.js). Zero-dep.
 */
'use strict';
const path = require('path');
const P = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-paths.js'));

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
