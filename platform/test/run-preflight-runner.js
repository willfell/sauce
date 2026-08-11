#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadManifest, validateManifest, planLanes, runManifest, formatSummary, resolveJobs,
} = require('../../scripts/run-preflight.js');

const results = [];
const ok = (name, condition) => {
  results.push([name, !!condition]);
  console.log(`  ${condition ? 'PASS' : 'FAIL'} — ${name}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-preflight-runner-'));
const writeManifest = (name, manifest) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2));
  return p;
};
// A step that always succeeds, printing a unique marker.
const passStep = (id) => ({ id, cmd: ['node', '-e', `process.stdout.write("marker-${id}")`] });
// A step that always fails with exit code 3.
const failStep = (id) => ({ id, cmd: ['node', '-e', `process.stderr.write("boom-${id}");process.exit(3)`] });

async function main() {
  // --- loadManifest ---
  const good = writeManifest('good.json', { schema_version: '1.0.0', steps: [passStep('a')] });
  ok('LOAD-1 loadManifest returns parsed manifest',
    loadManifest(good).steps.length === 1);

  let threw = false;
  try { loadManifest(path.join(tmp, 'missing.json')); } catch (e) { threw = true; }
  ok('LOAD-2 loadManifest throws on a missing file', threw);

  fs.writeFileSync(path.join(tmp, 'bad.json'), '{ not json');
  threw = false;
  try { loadManifest(path.join(tmp, 'bad.json')); } catch (e) { threw = true; }
  ok('LOAD-3 loadManifest throws on unparseable JSON', threw);

  // --- validateManifest ---
  ok('VALID-1 a well-formed manifest has no errors',
    validateManifest({ schema_version: '1.0.0', steps: [passStep('a')] }).length === 0);
  ok('VALID-2 duplicate ids are rejected',
    validateManifest({ schema_version: '1.0.0', steps: [passStep('a'), passStep('a')] })
      .some((m) => m.includes('duplicate')));
  ok('VALID-3 a non-array cmd is rejected',
    validateManifest({ schema_version: '1.0.0', steps: [{ id: 'a', cmd: 'node -e 0' }] })
      .some((m) => m.includes('cmd')));
  ok('VALID-4 an empty cmd is rejected',
    validateManifest({ schema_version: '1.0.0', steps: [{ id: 'a', cmd: [] }] })
      .some((m) => m.includes('cmd')));
  ok('VALID-5 an unknown lane is rejected',
    validateManifest({ schema_version: '1.0.0', steps: [{ id: 'a', cmd: ['node', '-e', '0'], lane: 'turbo' }] })
      .some((m) => m.includes('lane')));
  ok('VALID-6 a missing id is rejected',
    validateManifest({ schema_version: '1.0.0', steps: [{ cmd: ['node', '-e', '0'] }] })
      .some((m) => m.includes('id')));

  // --- planLanes ---
  const lanes = planLanes([
    { id: 'p1', cmd: ['node', '-e', '0'] },
    { id: 's1', cmd: ['node', '-e', '0'], lane: 'serial' },
    { id: 'p2', cmd: ['node', '-e', '0'], lane: 'parallel' },
  ]);
  ok('LANE-1 steps default to the parallel lane',
    lanes.parallel.map((s) => s.id).join(',') === 'p1,p2');
  ok('LANE-2 serial steps are separated out',
    lanes.serial.map((s) => s.id).join(',') === 's1');

  // --- runManifest: success ---
  const passing = { schema_version: '1.0.0', steps: [passStep('a'), passStep('b')] };
  const good1 = await runManifest(passing, { jobs: 1 });
  ok('RUN-1 an all-passing manifest reports ok', good1.ok === true);
  ok('RUN-2 every step is reported as pass',
    good1.results.length === 2 && good1.results.every((r) => r.status === 'pass'));
  ok('RUN-3 step output is captured',
    good1.results.find((r) => r.id === 'a').output.includes('marker-a'));
  ok('RUN-4 durations are recorded',
    good1.results.every((r) => typeof r.durationMs === 'number' && r.durationMs >= 0));

  // --- runManifest: serial ordering ---
  const ordered = await runManifest(
    { schema_version: '1.0.0', steps: [passStep('one'), passStep('two'), passStep('three')] },
    { jobs: 1 },
  );
  ok('RUN-5 jobs=1 executes in manifest order',
    ordered.results.map((r) => r.id).join(',') === 'one,two,three');

  // --- runManifest: failure semantics ---
  const failing = await runManifest(
    { schema_version: '1.0.0', steps: [failStep('bad'), passStep('after')] },
    { jobs: 1 },
  );
  ok('RUN-6 a failing step makes the run not ok', failing.ok === false);
  ok('RUN-7 the failing step records its exit code',
    failing.results.find((r) => r.id === 'bad').code === 3);
  ok('RUN-8 the failing step captures stderr',
    failing.results.find((r) => r.id === 'bad').output.includes('boom-bad'));
  ok('RUN-9 undispatched steps are marked skipped',
    failing.results.find((r) => r.id === 'after').status === 'skipped');
  ok('RUN-9b exactly one step ran before the halt',
    failing.results.length === 2);

  // --- runManifest: serial lane runs before parallel lane ---
  const laneOrder = await runManifest({
    schema_version: '1.0.0',
    steps: [passStep('par'), { ...passStep('ser'), lane: 'serial' }],
  }, { jobs: 1 });
  ok('RUN-10 the serial lane runs before the parallel lane',
    laneOrder.results.map((r) => r.id).join(',') === 'ser,par');

  // --- formatSummary ---
  const summary = formatSummary(good1.results);
  ok('SUM-1 the summary names every step',
    summary.includes('a') && summary.includes('b'));
  ok('SUM-2 the summary reports the total count',
    summary.includes('(2/2)'));
  const failSummary = formatSummary(failing.results);
  ok('SUM-3 the summary marks failures',
    /FAIL/.test(failSummary));
  ok('SUM-4 the summary shows skipped steps roll-up',
    failSummary.includes('SKIP') && failSummary.includes('(0/2)'));

  // --- resolveJobs ---
  ok('JOBS-1 --jobs is parsed from argv',
    resolveJobs(['--jobs', '4'], {}) === 4);
  ok('JOBS-2 --jobs=N form is parsed',
    resolveJobs(['--jobs=6'], {}) === 6);
  ok('JOBS-3 SAUCE_PREFLIGHT_JOBS is honoured',
    resolveJobs([], { SAUCE_PREFLIGHT_JOBS: '5' }) === 5);
  ok('JOBS-4 argv beats the environment',
    resolveJobs(['--jobs', '2'], { SAUCE_PREFLIGHT_JOBS: '9' }) === 2);
  ok('JOBS-5 the default is 1 until the soak flips it',
    resolveJobs([], {}) === 1);
  ok('JOBS-6 a non-numeric value falls back to the default',
    resolveJobs(['--jobs', 'lots'], {}) === 1);
  ok('JOBS-7 zero and negative values clamp to 1',
    resolveJobs(['--jobs', '0'], {}) === 1 && resolveJobs(['--jobs', '-3'], {}) === 1);

  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter(([, passed]) => !passed);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — preflight runner (${results.length - failed.length}/${results.length})`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
