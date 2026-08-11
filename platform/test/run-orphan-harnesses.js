#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { orphanHarnesses } = require('../../scripts/check-orphan-harnesses.js');

const results = [];
const ok = (name, condition) => {
  results.push([name, !!condition]);
  console.log(`  ${condition ? 'PASS' : 'FAIL'} — ${name}`);
};

const registered = { preflight: 'node platform/test/run-covered.js' };
ok('ORPHAN-1 registered harness is accepted',
  orphanHarnesses(['run-covered.js'], registered).length === 0);
ok('ORPHAN-2 synthetic unregistered harness is rejected',
  JSON.stringify(orphanHarnesses(['run-covered.js', 'run-orphan.js'], registered)) === '["run-orphan.js"]');

const imported = spawnSync(process.execPath, ['-e', "require('./scripts/check-orphan-harnesses.js')"], {
  cwd: path.resolve(__dirname, '..', '..'),
  encoding: 'utf8',
});
ok('ORPHAN-3 importing the guard does not execute its CLI',
  imported.status === 0 && imported.stdout === '' && imported.stderr === '');

// PERF-10a: the wall-clock benchmark stays manual, so bind the deterministic
// receipt contract from a separate preflight-owned harness. This prevents the
// Projects suite from silently returning to its pre-measurement 19/19 shape.
const projectsHarness = fs.readFileSync(path.join(__dirname, 'run-projects-hub-cards.js'), 'utf8');
ok('PERF10-SENTINEL-1 Projects harness retains the in-loop emission contract',
  projectsHarness.includes('PERF10-EMIT-1 counter increments inside the BeaconCards loop')
    && projectsHarness.includes(String.raw`/for \(const p of opts\.pages \|\| \[\]\) \{\s*metrics\.beaconEmitted \+= 1;/.test(perfReceiptSrc)`));
ok('PERF10-SENTINEL-2 Projects harness rejects eligible-input counting',
  projectsHarness.includes('PERF10-EMIT-2 counter never trusts eligible input length')
    && projectsHarness.includes(String.raw`!/beaconEmitted \+= \(opts\.pages \|\| \[\]\)\.length/.test(perfReceiptSrc)`));
ok('PERF10-SENTINEL-3 Projects harness requires exactly 106 emitted cards',
  projectsHarness.includes('PERF10-EMIT-3 Projects requires exactly 106 emitted cards')
    && projectsHarness.includes(String.raw`/metrics\.beaconEmitted === 106/.test(perfReceiptSrc)`));
ok('PERF10-SENTINEL-4 Projects harness requires exactly 180 emitted cards',
  projectsHarness.includes('PERF10-EMIT-4 Daily requires exactly 180 emitted cards')
    && projectsHarness.includes(String.raw`/metrics\.beaconEmitted === 180/.test(perfReceiptSrc)`));

const failed = results.filter(([, passed]) => !passed);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — orphan harness guard (${results.length - failed.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
