#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function orphanHarnesses(harnesses, scripts) {
  const registry = Object.values(scripts).join('\n');
  return harnesses.filter((name) => !registry.includes(`platform/test/${name}`));
}

function repositoryHarnesses(root) {
  return fs.readdirSync(path.join(root, 'platform', 'test'))
    .filter((name) => /^run-.*\.js$/.test(name))
    .sort();
}

function runSelfTest() {
  const registered = { preflight: 'node platform/test/run-covered.js' };
  const covered = orphanHarnesses(['run-covered.js'], registered);
  const missing = orphanHarnesses(['run-covered.js', 'run-orphan.js'], registered);
  const passes = covered.length === 0 && missing.length === 1 && missing[0] === 'run-orphan.js';
  console.log(`${passes ? 'PASS' : 'FAIL'} — orphan harness guard accepts registered harnesses and rejects a synthetic orphan`);
  return passes;
}

function main() {
  if (process.argv.includes('--self-test')) process.exit(runSelfTest() ? 0 : 1);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const missing = orphanHarnesses(repositoryHarnesses(ROOT), pkg.scripts || {});
  if (missing.length === 0) {
    console.log('PASS — every platform/test/run-*.js harness is registered in package.json scripts');
    return;
  }

  console.error(`FAIL — unregistered platform/test harnesses: ${missing.join(', ')}`);
  process.exit(1);
}

main();
