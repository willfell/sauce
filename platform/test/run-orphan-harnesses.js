#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
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

const failed = results.filter(([, passed]) => !passed);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — orphan harness guard (${results.length - failed.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
