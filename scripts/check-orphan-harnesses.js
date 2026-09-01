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

// Profile safety: headless Chrome with no --user-data-dir falls back to the
// developer's REAL Chrome profile. That profile's process singleton is held by any
// desktop Chrome they have open, so the headless instance can take the singleton
// over, adopt the live browsing session, and never exit — a preflight step wedged
// for its full timeout, failing in the suite and passing when re-run alone.
//
// This is only enforceable because every Chrome launch now goes through the
// DevTools protocol. Chrome's one-shot --screenshot / --dump-dom modes hang when
// given an explicit --user-data-dir, so a harness using them could not comply;
// platform/test/chrome-cdp.js exists to keep that route available.
function unprofiledChromeLaunchers(root) {
  const dir = path.join(root, 'platform', 'test');
  const offenders = [];
  // Strip comments first: the rationale for this rule names both flags, and a check
  // that counted prose would pass on a file whose actual launch is unprofiled.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Check each LAUNCH, not each file. run-cross-blueprint-style-adoption.js held a
  // profiled CDP launch and an unprofiled one-shot --dump-dom launch in the same
  // file; a file-level check saw the first and passed, and the second went on
  // wedging preflight against the developer's real Chrome profile.
  const enclosingArgList = (src, at) => {
    let depth = 0;
    let start = -1;
    for (let i = at; i >= 0; i -= 1) {
      if (src[i] === ']') depth += 1;
      else if (src[i] === '[') { if (depth === 0) { start = i; break; } depth -= 1; }
    }
    if (start < 0) return null;
    depth = 0;
    for (let i = start; i < src.length; i += 1) {
      if (src[i] === '[') depth += 1;
      else if (src[i] === ']') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
    }
    return null;
  };
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = stripComments(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (let at = src.indexOf('--headless'); at !== -1; at = src.indexOf('--headless', at + 1)) {
      const args = enclosingArgList(src, at);
      if (args === null || !args.includes('--user-data-dir')) {
        offenders.push(name);
        break;
      }
    }
  }
  return offenders;
}

function main() {
  const missing = orphanHarnesses(repositoryHarnesses(ROOT), registrationSources(ROOT));
  const shared = sharedTmpPaths(ROOT);
  const unprofiled = unprofiledChromeLaunchers(ROOT);
  if (missing.length === 0 && shared.length === 0 && unprofiled.length === 0) {
    console.log('PASS — every platform/test/run-*.js harness is registered, no fixed /tmp path is shared, and every headless Chrome launch uses a private profile');
    return;
  }
  if (missing.length) {
    console.error(`FAIL — unregistered platform/test harnesses: ${missing.join(', ')}`);
  }
  for (const { tmpPath, harnesses } of shared) {
    console.error(`FAIL — ${tmpPath} is used by multiple harnesses: ${harnesses.join(', ')}`);
  }
  for (const name of unprofiled) {
    console.error(`FAIL — ${name} launches headless Chrome without --user-data-dir, so it would run against the developer's real Chrome profile`);
  }
  process.exit(1);
}

module.exports = {
  orphanHarnesses, repositoryHarnesses, registrationSources, sharedTmpPaths,
  unprofiledChromeLaunchers,
};

if (require.main === module) main();
