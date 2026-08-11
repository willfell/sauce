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

// Registration is the union of package.json scripts and the preflight manifest.
// Before the manifest existed, harnesses like run-cli.js appeared in
// package.json ONLY inside the release:preflight chain string; moving that
// chain out is what forces this merge. Seven harnesses are registered solely
// via test:* scripts and are intentionally not in preflight -- see
// Docs/superpowers/specs/2026-08-10-parallel-preflight-design.md.
function registrationSources(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const sources = { ...(pkg.scripts || {}) };
  const manifestPath = path.join(root, 'platform', 'test', 'preflight-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    sources.preflightManifest = (manifest.steps || [])
      .map((step) => (step.cmd || []).join(' '))
      .join('\n');
  }
  return sources;
}

// Parallel safety: harnesses isolate through mkdtemp (which appends random
// characters and therefore cannot collide), but a hardcoded /tmp/<name> path
// shared by two harnesses IS a cross-test race once they run concurrently.
// Today every such path is single-owner; this keeps it that way.
function sharedTmpPaths(root) {
  const dir = path.join(root, 'platform', 'test');
  const owners = new Map();
  for (const name of repositoryHarnesses(root)) {
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    const found = new Set();
    for (const m of src.matchAll(/['"`](\/tmp\/[A-Za-z0-9._-]+)/g)) found.add(m[1]);
    for (const p of found) {
      if (!owners.has(p)) owners.set(p, []);
      owners.get(p).push(name);
    }
  }
  return [...owners.entries()]
    .filter(([, harnesses]) => harnesses.length > 1)
    .map(([tmpPath, harnesses]) => ({ tmpPath, harnesses }));
}

function main() {
  const missing = orphanHarnesses(repositoryHarnesses(ROOT), registrationSources(ROOT));
  const shared = sharedTmpPaths(ROOT);
  if (missing.length === 0 && shared.length === 0) {
    console.log('PASS — every platform/test/run-*.js harness is registered, and no fixed /tmp path is shared');
    return;
  }
  if (missing.length) {
    console.error(`FAIL — unregistered platform/test harnesses: ${missing.join(', ')}`);
  }
  for (const { tmpPath, harnesses } of shared) {
    console.error(`FAIL — ${tmpPath} is used by multiple harnesses: ${harnesses.join(', ')}`);
  }
  process.exit(1);
}

module.exports = {
  orphanHarnesses, repositoryHarnesses, registrationSources, sharedTmpPaths,
};

if (require.main === module) main();
