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

// The file's existing header destructures only `orphanHarnesses`; the cases
// below also need `repositoryHarnesses`, so re-destructure here rather than
// editing the header and risking a merge conflict with the top of the file.
const {
  registrationSources, sharedTmpPaths, repositoryHarnesses,
} = require('../../scripts/check-orphan-harnesses.js');

const ROOT = path.resolve(__dirname, '..', '..');

// Registration is the UNION of package.json scripts and the manifest. Seven
// harnesses (run-install.js, run-project-dashboard{,-heal}.js,
// run-task-trip-list.js, run-trip-{dashboard,entry-list,links}.js) are
// registered only via test:* scripts and are deliberately not in preflight --
// a manifest-only assertion would fail on day one.
const sources = registrationSources(ROOT);
ok('ORPHAN-4 registration sources include the preflight manifest',
  typeof sources.preflightManifest === 'string'
    && sources.preflightManifest.includes('platform/test/run-cli.js'));
ok('ORPHAN-5 registration sources still include package.json scripts',
  Object.keys(sources).some((k) => k !== 'preflightManifest'));
ok('ORPHAN-6 no harness is orphaned under the merged sources',
  orphanHarnesses(repositoryHarnesses(ROOT), sources).length === 0);
ok('ORPHAN-7 the seven non-preflight harnesses stay registered',
  ['run-install.js', 'run-project-dashboard.js', 'run-project-dashboard-heal.js',
    'run-task-trip-list.js', 'run-trip-dashboard.js', 'run-trip-entry-list.js',
    'run-trip-links.js'].every((h) => orphanHarnesses([h], sources).length === 0));

// The parallel-safety invariant: fixed /tmp paths must be single-owner.
// mkdtemp prefixes are exempt -- mkdtemp appends random characters, so they
// cannot collide.
const shared = sharedTmpPaths(ROOT);
ok('ORPHAN-8 no fixed /tmp path is shared by two harnesses',
  shared.length === 0);
if (shared.length) {
  console.error(`  shared: ${shared.map((s) => `${s.tmpPath} <- ${s.harnesses.join(', ')}`).join(' | ')}`);
}

const failed = results.filter(([, passed]) => !passed);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — orphan harness guard (${results.length - failed.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
