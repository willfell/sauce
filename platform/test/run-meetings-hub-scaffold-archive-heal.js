#!/usr/bin/env node
'use strict';

// run-meetings-hub-scaffold-archive-heal.js — unit harness for the meetings
// hub scaffold+archive install heal. Drives the PURE path mapper
// _archivedHubPath (exported by install.js), which relocates a per-day hub note
// under spice/meetings/hubs/ into the _archive/ subtree (preserving the
// relative path). Asserts: archival mapping, idempotence (already-archived),
// no-op outside the hubs root, and null-safety. Prints "N passed, M failed";
// exits 0 iff M === 0.

const install = require('../install.js');
const _archivedHubPath = install._archivedHubPath;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

if (typeof _archivedHubPath !== 'function') {
  console.log('  FAIL LOAD: _archivedHubPath not found');
  console.log('0 passed, 1 failed');
  process.exit(1);
}

// 1: per-day hub note → archived, relative path preserved
{
  const src = 'spice/meetings/hubs/2026/07-July/Meetings-2026-07-13.md';
  const dst = 'spice/meetings/hubs/_archive/2026/07-July/Meetings-2026-07-13.md';
  ok('archives per-day hub preserving relative path', _archivedHubPath(src) === dst, _archivedHubPath(src));
}

// 2: already-archived → unchanged (idempotent)
{
  const p = 'spice/meetings/hubs/_archive/2026/07-July/Meetings-2026-07-13.md';
  ok('idempotent on already-archived path', _archivedHubPath(p) === p, _archivedHubPath(p));
}

// 3: outside the hubs root → unchanged
{
  const p = 'spice/meetings/notes/2026/07-July/Foo-2026-07-13.md';
  ok('leaves path outside hubs root untouched', _archivedHubPath(p) === p, _archivedHubPath(p));
}

// 4: null → null without throwing
{
  let res, threw = false;
  try { res = _archivedHubPath(null); } catch (_e) { threw = true; }
  ok('null-safe (returns null, no throw)', !threw && res === null, threw ? 'threw' : String(res));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
