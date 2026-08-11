#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadManifest, validateManifest, planLanes, runManifest, runStep, formatSummary, resolveJobs,
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
  ok('RUN-9b results include the ran step plus the skipped one',
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

  // --- group mutual exclusion ---
  // Steps append a one-character "tag" plus "+"/"-" to a shared log around a
  // 150ms busy-wait: `<tag>+` on start, `<tag>-` on end. Replaying the log
  // gives the true peak overlap, either across every step (ignore the tag) or
  // within a single group (filter by tag first). Real subprocesses only — the
  // spawn seam is what group mutual-exclusion has to hold up under.
  const makeGroupStep = (logPath) => (id, tag, group) => ({
    id,
    ...(group ? { group } : {}),
    cmd: ['node', '-e',
      `const fs=require("fs");fs.appendFileSync(${JSON.stringify(logPath)},"${tag}+");`
      + `const t=Date.now();while(Date.now()-t<150);`
      + `fs.appendFileSync(${JSON.stringify(logPath)},"${tag}-")`],
  });
  const parseTaggedLog = (p) => fs.readFileSync(p, 'utf8').match(/.[-+]/g) || [];
  const peakOverall = (tokens) => {
    let cur = 0; let peak = 0;
    for (const tok of tokens) {
      if (tok.endsWith('+')) { cur += 1; peak = Math.max(peak, cur); } else { cur -= 1; }
    }
    return peak;
  };
  const peakForTag = (tokens, tag) => peakOverall(tokens.filter((t) => t[0] === tag));
  const timeoutGuard = (promise, ms) => Promise.race([
    promise.then((v) => ({ timedOut: false, value: v })),
    new Promise((resolve) => { setTimeout(() => resolve({ timedOut: true }), ms); }),
  ]);

  // GROUP-1: six steps in a single group never overlap even with jobs to spare.
  const log1 = path.join(tmp, 'group1.log');
  fs.writeFileSync(log1, '');
  const step1 = makeGroupStep(log1);
  const g1steps = Array.from({ length: 6 }, (_, i) => step1(`g1-${i}`, 'g', 'g'));
  await runManifest({ schema_version: '1.0.0', steps: g1steps }, { jobs: 4 });
  const g1tokens = parseTaggedLog(log1);
  ok('GROUP-1 six steps in one group never overlap at jobs=4',
    peakForTag(g1tokens, 'g') === 1 && peakOverall(g1tokens) === 1);

  // GROUP-2: two different groups run concurrently with each other, while each
  // group still serializes internally.
  const log2 = path.join(tmp, 'group2.log');
  fs.writeFileSync(log2, '');
  const step2 = makeGroupStep(log2);
  const g2steps = [
    ...Array.from({ length: 3 }, (_, i) => step2(`g2-a${i}`, 'a', 'a')),
    ...Array.from({ length: 3 }, (_, i) => step2(`g2-b${i}`, 'b', 'b')),
  ];
  await runManifest({ schema_version: '1.0.0', steps: g2steps }, { jobs: 4 });
  const g2tokens = parseTaggedLog(log2);
  ok('GROUP-2 steps in two different groups overlap with each other',
    peakOverall(g2tokens) > 1);
  ok('GROUP-2b each group still never overlaps with itself',
    peakForTag(g2tokens, 'a') === 1 && peakForTag(g2tokens, 'b') === 1);

  // GROUP-3 / GROUP-4: grouped and ungrouped steps overlap with each other, the
  // grouped ones still serialize among themselves, and every step completes.
  const log3 = path.join(tmp, 'group3.log');
  fs.writeFileSync(log3, '');
  const step3 = makeGroupStep(log3);
  const g3steps = [
    ...Array.from({ length: 3 }, (_, i) => step3(`g3-c${i}`, 'c', 'c')),
    ...Array.from({ length: 3 }, (_, i) => step3(`g3-u${i}`, 'u')),
  ];
  const g3run = await runManifest({ schema_version: '1.0.0', steps: g3steps }, { jobs: 4 });
  const g3tokens = parseTaggedLog(log3);
  ok('GROUP-3 grouped and ungrouped steps overlap with each other',
    peakOverall(g3tokens) > 1);
  ok('GROUP-3b the grouped steps still never overlap each other',
    peakForTag(g3tokens, 'c') === 1);
  ok('GROUP-4 every step still completes and the run reports ok',
    g3run.ok === true && g3run.results.length === 6
    && g3run.results.every((r) => r.status === 'pass'));

  // GROUP-5: a failing grouped step must release its group rather than wedge
  // it forever. Within one jobs=1 run, a passing step and then a failing step
  // share a group; if release didn't happen the single worker would poll its
  // own permanently-busy group forever. Guarded with a timeout so a real
  // deadlock fails the assertion instead of hanging the whole test file.
  const group5 = 'g5line';
  const seq5 = [
    { id: 'g5line-first', group: group5, cmd: ['node', '-e', 'process.stdout.write("marker-first")'] },
    { id: 'g5line-fail', group: group5, cmd: ['node', '-e', 'process.stderr.write("boom");process.exit(3)'] },
  ];
  const run5Guard = await timeoutGuard(
    runManifest({ schema_version: '1.0.0', steps: seq5 }, { jobs: 1 }), 5000,
  );
  ok('GROUP-5a a failing grouped step releases its group instead of deadlocking',
    run5Guard.timedOut === false);
  if (!run5Guard.timedOut) {
    const run5 = run5Guard.value;
    ok('GROUP-5b the later same-group step still dispatched, and the run terminated',
      run5.results.map((r) => r.id).join(',') === 'g5line-first,g5line-fail'
      && run5.results[0].status === 'pass' && run5.results[1].status === 'fail');
  }

  // A separate run reusing the same group id proves group state does not leak
  // across manifest runs — the group is reachable and the run is not halted.
  const passing5 = { id: 'g5line-second', group: group5, cmd: ['node', '-e', 'process.stdout.write("marker-second")'] };
  const run5bGuard = await timeoutGuard(
    runManifest({ schema_version: '1.0.0', steps: [passing5] }, { jobs: 2 }), 5000,
  );
  ok('GROUP-5c a later, separate run reusing the same group id is not deadlocked',
    run5bGuard.timedOut === false && run5bGuard.value.ok === true);

  // --- validateManifest: group ---
  ok('VALID-7 a non-string group is rejected',
    validateManifest({ schema_version: '1.0.0', steps: [{ id: 'a', cmd: ['node', '-e', '0'], group: 42 }] })
      .some((m) => m.includes('group')));
  ok('VALID-8 an empty-string group is rejected',
    validateManifest({ schema_version: '1.0.0', steps: [{ id: 'a', cmd: ['node', '-e', '0'], group: '' }] })
      .some((m) => m.includes('group')));

  // --- per-step timeout ---
  // A step that hangs well past its timeout must be killed and recorded as a
  // normal failed result, never left to hang the run forever — a real
  // subprocess and a real timer, with timeoutMs overridden low so the test
  // doesn't wait for STEP_TIMEOUT_MS's production value of 15 minutes.
  // Guarded with an outer timeout so a regression (runStep hanging instead of
  // killing) fails the assertion instead of hanging this whole test file.
  const TIMEOUT_TEST_MS = 300;
  const hangStep = { id: 'hang', cmd: ['node', '-e', 'setTimeout(() => {}, 60000)'] };
  const timeoutRunGuard = await timeoutGuard(
    runManifest({ schema_version: '1.0.0', steps: [hangStep] }, { jobs: 1, timeoutMs: TIMEOUT_TEST_MS }),
    15000,
  );
  ok('TIMEOUT-1 a hung step is killed instead of hanging the run', timeoutRunGuard.timedOut === false);
  if (!timeoutRunGuard.timedOut) {
    const timeoutRun = timeoutRunGuard.value;
    ok('TIMEOUT-2 the run reports ok === false', timeoutRun.ok === false);
    const hangResult = timeoutRun.results.find((r) => r.id === 'hang');
    ok('TIMEOUT-3 the timed-out step resolves as a normal fail result',
      !!hangResult && hangResult.status === 'fail');
    ok('TIMEOUT-4 the output names the step and mentions the timeout',
      !!hangResult && /timed out/i.test(hangResult.output) && hangResult.output.includes('hang'));
  }

  // runStep itself must also resolve (never reject) on timeout, since runLane's
  // group release and halt/skip-padding logic depend on that.
  let runStepRejected = false;
  const directTimeoutGuard = await timeoutGuard(
    runStep({ id: 'hang2', cmd: ['node', '-e', 'setTimeout(() => {}, 60000)'] }, process.cwd(), TIMEOUT_TEST_MS)
      .catch(() => { runStepRejected = true; return null; }),
    15000,
  );
  ok('TIMEOUT-5 runStep resolves (never rejects) on timeout',
    directTimeoutGuard.timedOut === false && runStepRejected === false);

  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter(([, passed]) => !passed);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — preflight runner (${results.length - failed.length}/${results.length})`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
