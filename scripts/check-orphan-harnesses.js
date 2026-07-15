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

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const missing = orphanHarnesses(repositoryHarnesses(ROOT), pkg.scripts || {});
  if (missing.length === 0) {
    console.log('PASS — every platform/test/run-*.js harness is registered in package.json scripts');
    return;
  }

  console.error(`FAIL — unregistered platform/test harnesses: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = { orphanHarnesses, repositoryHarnesses };

if (require.main === module) main();
