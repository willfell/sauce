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
  const dflt = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  ok('JOBS-5 the default is the machine parallelism',
    resolveJobs([], {}) === dflt);
  ok('JOBS-6 a non-numeric value falls back to the default',
    resolveJobs(['--jobs', 'lots'], {}) === dflt);
  ok('JOBS-7 zero and negative values clamp to the default',
    resolveJobs(['--jobs', '0'], {}) === dflt && resolveJobs(['--jobs', '-3'], {}) === dflt);

  // --- concurrency is actually bounded ---
  // Each step appends "+" on start and "-" on end to a shared log, sleeping in
  // between. Replaying the log gives the true peak overlap. Real subprocesses,
  // real clock: the spawn seam is the thing under test and must not be faked.
  const logPath = path.join(tmp, 'concurrency.log');
  const overlapStep = (id) => ({
    id,
    cmd: ['node', '-e',
      `const fs=require("fs");fs.appendFileSync(${JSON.stringify(logPath)},"+");`
      + `const t=Date.now();while(Date.now()-t<150);`
      + `fs.appendFileSync(${JSON.stringify(logPath)},"-")`],
  });
  const peakFromLog = (p) => {
    let cur = 0; let peak = 0;
    for (const ch of fs.readFileSync(p, 'utf8')) {
      if (ch === '+') { cur += 1; peak = Math.max(peak, cur); } else { cur -= 1; }
    }
    return peak;
  };
  const overlapSteps = Array.from({ length: 8 }, (_, i) => overlapStep(`o${i}`));

  fs.writeFileSync(logPath, '');
  await runManifest({ schema_version: '1.0.0', steps: overlapSteps }, { jobs: 1 });
  ok('CONC-1 jobs=1 never overlaps two steps', peakFromLog(logPath) === 1);

  fs.writeFileSync(logPath, '');
  await runManifest({ schema_version: '1.0.0', steps: overlapSteps }, { jobs: 4 });
  const peak4 = peakFromLog(logPath);
  ok('CONC-2 jobs=4 actually runs steps concurrently', peak4 > 1);
  ok('CONC-3 jobs=4 never exceeds its bound', peak4 <= 4);

  fs.writeFileSync(logPath, '');
  const conc = await runManifest({ schema_version: '1.0.0', steps: overlapSteps }, { jobs: 4 });
  ok('CONC-4 every step still completes under concurrency',
    conc.ok === true && conc.results.length === 8);

  // The serial lane must not overlap even when jobs is high.
  fs.writeFileSync(logPath, '');
  await runManifest({
    schema_version: '1.0.0',
    steps: overlapSteps.map((s) => ({ ...s, lane: 'serial' })),
  }, { jobs: 8 });
  ok('CONC-5 the serial lane ignores jobs and never overlaps',
    peakFromLog(logPath) === 1);

  // Output must stay contiguous per step, never interleaved.
  const chatty = (id) => ({
    id,
    cmd: ['node', '-e',
      `for(let i=0;i<50;i++)process.stdout.write("${id}:"+i+"\\n")`],
  });
  const chattyRun = await runManifest(
    { schema_version: '1.0.0', steps: [chatty('x'), chatty('y'), chatty('z')] },
    { jobs: 3 },
  );
  ok('CONC-6 each step captures only its own output',
    chattyRun.results.every((r) => {
      const lines = r.output.trim().split('\n');
      return lines.length === 50 && lines.every((l) => l.startsWith(`${r.id}:`));
    }));

  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter(([, passed]) => !passed);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — preflight runner (${results.length - failed.length}/${results.length})`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
