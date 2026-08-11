# Parallel Preflight Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sauce's 171-step serial `release:preflight` shell chain with a manifest-driven concurrent runner, cutting it from ~333s to ~75s.

**Architecture:** The step list moves from a `&&`-joined string in `package.json` into `platform/test/preflight-manifest.json`. A new `scripts/run-preflight.js` reads that manifest and executes steps through a bounded work queue — a `serial` lane first, then a `parallel` lane. `release:preflight` keeps its name and exit-code contract, so CI, `release.yml`, and the autoloop coordinator gate are untouched. Concurrency ships defaulted **off** (`--jobs 1`, behavior-identical to today) and is flipped on in a separate one-line commit after a soak.

**Tech Stack:** Node.js (CommonJS, `>=18`), `child_process.spawn`, no new dependencies.

## Global Constraints

- **No new npm dependencies.** The runner uses only Node built-ins.
- **CommonJS**, `'use strict'`, matching every other file in `scripts/` and `platform/test/`.
- **`engines.node` is `>=18`.** `os.availableParallelism()` landed in 18.14, so every use must be `os.availableParallelism?.() ?? os.cpus().length`.
- **`npm run release:preflight` must keep its exact name and exit-code contract** — 0 on success, non-zero on any failure. `scripts/autoloop/codex-coordinator.js:6384` and three GitHub workflows depend on it.
- **Never auto-retry a failed step.** Retrying masks concurrency-coupling bugs.
- **No emoji** anywhere in code or output. The repo has a `check-no-emoji`-style posture and an ASCII-only house style in harness output.
- **Harness output convention:** each assertion prints `  PASS — <name>` or `  FAIL — <name>`, and the file ends with `\n<PASS|FAIL> — <suite name> (<passed>/<total>)`, setting `process.exitCode`. Copy this shape exactly; see `platform/test/run-orphan-harnesses.js`.
- **Conventional commits.** The release bumper parses them. Use `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- **Do not touch** `.github/workflows/`, `scripts/autoloop/`, or the release pipeline. (Also: workflow-file pushes require SSH, another reason to stay out.)
- **Working tree caution:** `platform/test/run-codex-autoloop.js` and `scripts/autoloop/codex-coordinator.js` may carry unrelated uncommitted changes from another session. Always `git add` explicit paths; never `git add -A` or `git commit -a`.

## Reference Data

Measured on the target machine (14 cores). Used for heaviest-first manifest ordering:

| Harness | Duration |
| --- | --- |
| `run-codex-autoloop.js` | 65.8s |
| `run-seed-migrations.js` | 23.3s |
| `run-integration-smoke.js` | 19.1s |
| `run-helper-cases.js` | 16.6s |
| `run-bootstrap.js` | 2.0s |
| everything else | < 1s each |

Expanded chain: **173 steps** — 165 harness invocations plus 8 lint/check scripts. Two scripts appear twice with different arguments (`lint-cold-load.js` bare and `--self-test`; `run-customjs-loadable.js` bare and `--self-test`), so step `id`s must disambiguate them.

---

### Task 1: Runner core — manifest loading, validation, serial execution

Builds `scripts/run-preflight.js` with everything except concurrency. Default `--jobs 1`. Tests use **real** `node -e` subprocesses against temp manifests — the `spawn` seam is deliberately not mocked, because mocking the seam under test is how bugs hide.

**Files:**
- Create: `scripts/run-preflight.js`
- Create: `platform/test/run-preflight-runner.js`
- Modify: `package.json` (add `test:preflight-runner` script only)

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `scripts/run-preflight.js`:
  - `loadManifest(manifestPath: string) -> { schema_version: string, steps: Step[] }` — throws `Error` if the file is missing or unparseable.
  - `Step = { id: string, cmd: string[], lane?: 'serial' | 'parallel' }`
  - `validateManifest(manifest) -> string[]` — array of human-readable error messages; empty means valid.
  - `planLanes(steps: Step[]) -> { serial: Step[], parallel: Step[] }` — preserves manifest order within each lane; a step with no `lane` is `parallel`.
  - `StepResult = { id: string, cmd: string[], status: 'pass' | 'fail' | 'skipped', code: number | null, durationMs: number, output: string }`
  - `runManifest(manifest, opts: { jobs?: number, cwd?: string }) -> Promise<{ ok: boolean, results: StepResult[] }>`
  - `formatSummary(results: StepResult[]) -> string`
  - `resolveJobs(argv: string[], env: object) -> number`

- [ ] **Step 1: Write the failing test file**

Create `platform/test/run-preflight-runner.js`:

```js
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
  ok('RUN-9 no new step is dispatched after a failure',
    !failing.results.some((r) => r.id === 'after' && r.status === 'pass'));

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
    /2/.test(summary));
  const failSummary = formatSummary(failing.results);
  ok('SUM-3 the summary marks failures',
    /FAIL/.test(failSummary));

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-preflight-runner.js`
Expected: FAIL — `Cannot find module '../../scripts/run-preflight.js'`

- [ ] **Step 3: Implement the runner**

Create `scripts/run-preflight.js`:

```js
#!/usr/bin/env node
'use strict';

// scripts/run-preflight.js — manifest-driven preflight runner.
//
// Replaces the 171-step `&&` chain that used to live in package.json's
// `release:preflight`. Steps come from platform/test/preflight-manifest.json.
// The `serial` lane runs to completion first, then the `parallel` lane runs
// through a bounded work queue.
//
// Concurrency ships defaulted OFF (--jobs 1, behaviour-identical to the old
// chain). See Docs/superpowers/specs/2026-08-10-parallel-preflight-design.md.
//
// Usage: node scripts/run-preflight.js [--jobs N]
// Env:   SAUCE_PREFLIGHT_JOBS=N   (argv wins)

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'platform', 'test', 'preflight-manifest.json');

// Default concurrency. Flipped to availableParallelism only after the soak
// (see the plan's final task) so the rollout stays one revertible line.
const DEFAULT_JOBS = 1;

const LANES = ['serial', 'parallel'];

function loadManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    errors.push('manifest must be an object');
    return errors;
  }
  if (!Array.isArray(manifest.steps)) {
    errors.push('manifest.steps must be an array');
    return errors;
  }
  const seen = new Set();
  manifest.steps.forEach((step, i) => {
    const where = `step ${i}`;
    if (!step || typeof step.id !== 'string' || !step.id.trim()) {
      errors.push(`${where}: missing id`);
    } else if (seen.has(step.id)) {
      errors.push(`${where}: duplicate id "${step.id}"`);
    } else {
      seen.add(step.id);
    }
    if (!Array.isArray(step.cmd) || step.cmd.length === 0
      || !step.cmd.every((a) => typeof a === 'string')) {
      errors.push(`${where}: cmd must be a non-empty array of strings`);
    }
    if (step.lane !== undefined && !LANES.includes(step.lane)) {
      errors.push(`${where}: lane must be one of ${LANES.join(', ')}`);
    }
  });
  return errors;
}

function planLanes(steps) {
  return {
    serial: steps.filter((s) => s.lane === 'serial'),
    parallel: steps.filter((s) => s.lane !== 'serial'),
  };
}

function runStep(step, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(step.cmd[0], step.cmd.slice(1), {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (err) => {
      resolve({
        id: step.id, cmd: step.cmd, status: 'fail', code: null,
        durationMs: Date.now() - started, output: `${output}${err.message}`,
      });
    });
    child.on('close', (code) => {
      resolve({
        id: step.id, cmd: step.cmd, status: code === 0 ? 'pass' : 'fail',
        code, durationMs: Date.now() - started, output,
      });
    });
  });
}

// Runs `steps` with at most `jobs` concurrent children. Stops dispatching new
// steps once any step has failed, but lets in-flight steps finish. Never
// retries: a retry would mask exactly the concurrency-coupling bugs the soak
// exists to find.
async function runLane(steps, jobs, cwd, onResult, isHalted) {
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(jobs, steps.length || 1) }, async () => {
    for (;;) {
      if (failed || isHalted()) return;
      const i = next;
      next += 1;
      if (i >= steps.length) return;
      const result = await runStep(steps[i], cwd);
      onResult(result);
      if (result.status === 'fail') failed = true;
    }
  });
  await Promise.all(workers);
  return !failed;
}

async function runManifest(manifest, opts = {}) {
  const jobs = Math.max(1, opts.jobs || DEFAULT_JOBS);
  const cwd = opts.cwd || ROOT;
  const lanes = planLanes(manifest.steps);
  const results = [];
  let halted = false;
  const onResult = (r) => {
    results.push(r);
    if (r.status === 'fail') halted = true;
    process.stdout.write(renderStep(r));
  };

  // The serial lane runs single-file and to completion first. check-version-sync
  // lives here so a version mismatch still fails on the very first line, the way
  // the old chain did.
  await runLane(lanes.serial, 1, cwd, onResult, () => halted);
  if (!halted) await runLane(lanes.parallel, jobs, cwd, onResult, () => halted);

  return { ok: !results.some((r) => r.status === 'fail'), results };
}

function renderStep(r) {
  const secs = (r.durationMs / 1000).toFixed(1);
  const head = `\n${r.status === 'pass' ? 'PASS' : 'FAIL'} — ${r.id} (${secs}s)\n`;
  // Output is buffered per step and emitted as one contiguous block, so
  // concurrent steps never interleave their lines.
  if (r.status === 'pass') return head;
  return `${head}${r.output}\n`;
}

function formatSummary(results) {
  const passed = results.filter((r) => r.status === 'pass').length;
  const lines = [''];
  lines.push('preflight summary');
  lines.push('-'.repeat(60));
  for (const r of results) {
    const secs = (r.durationMs / 1000).toFixed(1).padStart(7);
    lines.push(`${(r.status === 'pass' ? 'PASS' : 'FAIL').padEnd(5)}${secs}s  ${r.id}`);
  }
  lines.push('-'.repeat(60));
  const failedIds = results.filter((r) => r.status === 'fail').map((r) => r.id);
  lines.push(`${failedIds.length ? 'FAIL' : 'PASS'} — preflight (${passed}/${results.length})`);
  if (failedIds.length) lines.push(`failed: ${failedIds.join(', ')}`);
  return lines.join('\n');
}

function resolveJobs(argv, env) {
  let raw = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--jobs' && argv[i + 1] !== undefined) { raw = argv[i + 1]; break; }
    const m = /^--jobs=(.*)$/.exec(argv[i]);
    if (m) { raw = m[1]; break; }
  }
  if (raw === null && env && env.SAUCE_PREFLIGHT_JOBS !== undefined) {
    raw = env.SAUCE_PREFLIGHT_JOBS;
  }
  if (raw === null) return DEFAULT_JOBS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_JOBS;
  return n;
}

function defaultJobCount() {
  return os.availableParallelism ? os.availableParallelism() : os.cpus().length;
}

async function main() {
  const manifest = loadManifest(MANIFEST_PATH);
  const errors = validateManifest(manifest);
  if (errors.length) {
    console.error(`FAIL — invalid preflight manifest:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  const jobs = resolveJobs(process.argv.slice(2), process.env);
  const started = Date.now();
  console.log(`preflight — ${manifest.steps.length} steps, jobs=${jobs}`);
  const { ok, results } = await runManifest(manifest, { jobs });
  console.log(formatSummary(results));
  console.log(`total ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(ok ? 0 : 1);
}

module.exports = {
  loadManifest, validateManifest, planLanes, runManifest,
  formatSummary, resolveJobs, defaultJobCount, DEFAULT_JOBS,
};

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-preflight-runner.js`
Expected: `PASS — preflight runner (31/31)` — 3 LOAD, 6 VALID, 2 LANE, 10 RUN, 3 SUM, 7 JOBS.

- [ ] **Step 5: Register the new harness so the orphan guard stays green**

Add to `package.json` `scripts`, immediately after `"test:loop-codex-routers"`:

```json
"test:preflight-runner": "node platform/test/run-preflight-runner.js"
```

- [ ] **Step 6: Verify the orphan guard still passes**

Run: `node scripts/check-orphan-harnesses.js`
Expected: `PASS — every platform/test/run-*.js harness is registered in package.json scripts`

- [ ] **Step 7: Commit**

```bash
git add scripts/run-preflight.js platform/test/run-preflight-runner.js package.json
git commit -m "feat: add manifest-driven preflight runner (serial default)"
```

---

### Task 2: Bounded concurrency

Task 1's `runLane` already accepts a `jobs` bound, but nothing proves it is respected. This task adds the tests that pin the concurrency contract. Default stays 1.

**Files:**
- Modify: `platform/test/run-preflight-runner.js` (append before the `fs.rmSync(tmp, ...)` line)

**Interfaces:**
- Consumes: `runManifest(manifest, { jobs })` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing concurrency tests**

Insert into `platform/test/run-preflight-runner.js`, immediately before `fs.rmSync(tmp, { recursive: true, force: true });`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `node platform/test/run-preflight-runner.js`
Expected: `PASS — preflight runner (37/37)` — the 31 from Task 1 plus 6 CONC cases.

If CONC-2 fails with `peak4 === 1`, `runLane` is awaiting sequentially — check that the workers array is built before any `await`, so all workers start concurrently.

- [ ] **Step 3: Commit**

```bash
git add platform/test/run-preflight-runner.js
git commit -m "test: pin the preflight runner's concurrency bounds"
```

---

### Task 3: Generate the manifest

The manifest is generated once from the existing chain — hand-transcribing 173 steps invites transcription errors. The generator is a throwaway run, not a committed file.

**`package.json` is deliberately NOT cut over in this task.** The orphan guard still reads `package.json` scripts, and harnesses like `run-cli.js` live there *only* inside the chain string. Deleting the chain before Task 4 teaches the guard about the manifest would make `release:preflight` fail at its own guard step. Task 4 does the cutover.

**Files:**
- Create: `platform/test/preflight-manifest.json`

**Interfaces:**
- Consumes: `loadManifest` / `validateManifest` from Task 1.
- Produces: `platform/test/preflight-manifest.json`, read by `scripts/run-preflight.js` and (in Task 4) `scripts/check-orphan-harnesses.js`.

- [ ] **Step 1: Capture the current baseline**

```bash
cd /Users/willfell/Documents/GitHub/sauce
node -e '
const p=require("./package.json");
function expand(cmd,d=0){const out=[];
 for(const s of cmd.split("&&").map(x=>x.trim()).filter(Boolean)){
  const m=s.match(/^npm run (?:--silent )?([\w:-]+)$/);
  if(m&&p.scripts[m[1]]&&d<4) out.push(...expand(p.scripts[m[1]],d+1)); else out.push(s);}
 return out;}
require("fs").writeFileSync("/tmp/preflight-baseline.txt", expand(p.scripts["release:preflight"]).join("\n"));
console.log("baseline steps:", expand(p.scripts["release:preflight"]).length);
'
```

Expected: `baseline steps: 173`

- [ ] **Step 2: Generate the manifest**

```bash
cd /Users/willfell/Documents/GitHub/sauce
node -e '
const fs=require("fs");
const HEAVY=["run-codex-autoloop.js","run-seed-migrations.js","run-integration-smoke.js","run-helper-cases.js"];
const lines=fs.readFileSync("/tmp/preflight-baseline.txt","utf8").split("\n").filter(Boolean);
const used=new Set();
const steps=lines.map((line)=>{
  const cmd=line.split(/\s+/);
  const file=(line.match(/([\w.-]+)\.js/)||[])[1]||"step";
  let id=file.replace(/^run-/,"").replace(/^check-/,"").replace(/^lint-/,"lint-");
  if(line.includes("--self-test")) id+="-self-test";
  let n=2; const base=id; while(used.has(id)) id=`${base}-${n++}`;
  used.add(id);
  // check-version-sync stays in the serial lane so a version mismatch still
  // fails on the very first line, exactly as the old chain did.
  const lane=line.includes("check-version-sync.js")?"serial":"parallel";
  return {id,cmd,lane};
});
// Heaviest-first dispatch: the 66s pole starts at t=0 and the tail packs behind it.
const weight=(s)=>{const i=HEAVY.findIndex(h=>s.cmd.join(" ").includes(h));return i<0?HEAVY.length:i;};
const serial=steps.filter(s=>s.lane==="serial");
const parallel=steps.filter(s=>s.lane!=="serial").sort((a,b)=>weight(a)-weight(b));
parallel.push({id:"preflight-runner",cmd:["node","platform/test/run-preflight-runner.js"],lane:"parallel"});
fs.writeFileSync("platform/test/preflight-manifest.json",
  JSON.stringify({schema_version:"1.0.0",
    _comment:"Preflight step list. Authored heaviest-first; see Docs/superpowers/specs/2026-08-10-parallel-preflight-design.md",
    steps:[...serial,...parallel]},null,2)+"\n");
console.log("steps:",serial.length+parallel.length);
'
```

Expected: `steps: 174` (173 from the chain, plus `run-preflight-runner.js`)

- [ ] **Step 3: Verify the manifest is valid and covers the baseline**

```bash
cd /Users/willfell/Documents/GitHub/sauce
node -e '
const {loadManifest,validateManifest}=require("./scripts/run-preflight.js");
const fs=require("fs");
const m=loadManifest("platform/test/preflight-manifest.json");
const errs=validateManifest(m);
console.log("validation errors:",errs.length?errs:"none");
const base=fs.readFileSync("/tmp/preflight-baseline.txt","utf8").split("\n").filter(Boolean);
const got=new Set(m.steps.map(s=>s.cmd.join(" ")));
const missing=base.filter(b=>!got.has(b));
console.log("baseline steps missing from manifest:",missing.length?missing:"none");
console.log("serial lane:",m.steps.filter(s=>s.lane==="serial").map(s=>s.id));
'
```

Expected: `validation errors: none`, `baseline steps missing from manifest: none`, serial lane `[ 'version-sync' ]`

- [ ] **Step 4: Verify the runner reproduces the old chain's result**

Run: `node scripts/run-preflight.js`
Expected: exit 0, ending in `PASS — preflight (174/174)`. Takes ~5-6 minutes; it is still serial.

Confirm the exit code:

```bash
node scripts/run-preflight.js > /tmp/preflight-serial.log 2>&1; echo "exit=$?"; tail -5 /tmp/preflight-serial.log
```

Expected: `exit=0`

- [ ] **Step 5: Commit the manifest**

`package.json` is untouched — the chain is still live and still authoritative. The manifest is committed as dead weight that the next task activates.

```bash
git add platform/test/preflight-manifest.json
git commit -m "refactor: generate the preflight step manifest"
```

---

### Task 4: Extend the orphan guard, then cut `release:preflight` over

Moving the chain out of `package.json` breaks the existing guard — harnesses like `run-cli.js` appear in `package.json` *only* inside the chain string. The guard must learn about the manifest **before** the chain is deleted, so both changes land in this one task: the guard first, the cutover second.

**Files:**
- Modify: `scripts/check-orphan-harnesses.js`
- Modify: `platform/test/run-orphan-harnesses.js` (append new cases before the `const failed =` line)
- Modify: `package.json` (`release:preflight` value)

**Interfaces:**
- Consumes: `platform/test/preflight-manifest.json` from Task 3.
- Produces, from `scripts/check-orphan-harnesses.js`:
  - `orphanHarnesses(harnesses: string[], scripts: Record<string, string>) -> string[]` — **signature unchanged**, so existing ORPHAN-1/ORPHAN-2 cases keep working.
  - `repositoryHarnesses(root: string) -> string[]` — unchanged.
  - `registrationSources(root: string) -> Record<string, string>` — merges `package.json` scripts with a synthetic `preflightManifest` entry holding every manifest command.
  - `sharedTmpPaths(root: string) -> Array<{ tmpPath: string, harnesses: string[] }>` — fixed `/tmp/<name>` literals appearing in two or more harnesses.

- [ ] **Step 1: Write the failing tests**

Append to `platform/test/run-orphan-harnesses.js`, immediately before `const failed = results.filter(...)`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-orphan-harnesses.js`
Expected: FAIL — `registrationSources is not a function`

- [ ] **Step 3: Implement the guard changes**

Replace the body of `scripts/check-orphan-harnesses.js` between the `repositoryHarnesses` function and `module.exports` with:

```js
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
```

Leave `orphanHarnesses` and `repositoryHarnesses` exactly as they are, and keep the trailing `if (require.main === module) main();`.

- [ ] **Step 4: Run to verify it passes**

Run: `node platform/test/run-orphan-harnesses.js`
Expected: `PASS — orphan harness guard (12/12)`

Run: `node scripts/check-orphan-harnesses.js`
Expected: `PASS — every platform/test/run-*.js harness is registered, and no fixed /tmp path is shared`

If ORPHAN-8 fails, the guard has found a genuine parallel-safety hazard. Do not weaken the regex — fix the offending harness to use `fs.mkdtempSync` instead of the fixed path.

- [ ] **Step 5: Now cut `release:preflight` over**

The guard understands the manifest, so the chain can finally go. In `package.json`, replace the entire `release:preflight` value (the 171-step `&&` chain) with:

```json
"release:preflight": "node scripts/run-preflight.js"
```

Leave every `test:*` script exactly as it is — the seven harnesses that are not in the chain rely on them for orphan-guard registration.

- [ ] **Step 6: Verify the public contract is unchanged**

```bash
npm run release:preflight > /tmp/preflight-npm.log 2>&1; echo "exit=$?"; tail -3 /tmp/preflight-npm.log
```

Expected: `exit=0`, ending in `PASS — preflight (174/174)`. This is the run that proves the cutover and the guard change agree: the guard now runs as a manifest step, reading the manifest that dispatched it.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-orphan-harnesses.js platform/test/run-orphan-harnesses.js package.json
git commit -m "refactor: point release:preflight at the manifest runner"
```

---

### Task 5: Register the manifest in the schema registry

Tooling contracts under `scripts/` are registered (`autoloop-durable-batch-ledger`, `autoloop-card-lease`, `loop-plugin-binding-config`). The manifest follows the same convention.

**Files:**
- Modify: `platform/schemas-index.json`

**Interfaces:**
- Consumes: `platform/test/preflight-manifest.json` from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the registry entry**

Append to the `schemas` array in `platform/schemas-index.json`, after the `loop-plugin-binding-config` entry:

```json
{
  "id": "preflight-manifest",
  "kind": "data-file",
  "owner": {
    "type": "workshop",
    "name": "sauce"
  },
  "source": "platform/test/preflight-manifest.json",
  "accepted_versions": [
    "1.0.0"
  ],
  "consumers": [
    "scripts/run-preflight.js",
    "scripts/check-orphan-harnesses.js",
    "platform/test/run-preflight-runner.js"
  ],
  "notes": "Preflight step list — id/cmd/lane per step, authored heaviest-first. Replaces the release:preflight && chain. Lane is serial or parallel; the serial lane runs first."
}
```

- [ ] **Step 2: Verify the registry lints clean**

Run: `node scripts/lint-schemas.js`
Expected: exit 0, no hard failures.

- [ ] **Step 3: Commit**

```bash
git add platform/schemas-index.json
git commit -m "chore: register the preflight manifest in the schema registry"
```

---

### Task 6: Soak, then flip the default

The acceptance gate. Concurrency is still off until Step 3 of this task.

**Files:**
- Modify: `scripts/run-preflight.js:1` (the `DEFAULT_JOBS` constant)
- Modify: `platform/test/run-preflight-runner.js` (the JOBS-5 assertion)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing.

- [ ] **Step 1: Soak for coupling — 10 consecutive parallel runs**

```bash
cd /Users/willfell/Documents/GitHub/sauce
for i in $(seq 1 10); do
  node scripts/run-preflight.js --jobs "$(node -e 'const os=require("os");console.log(os.availableParallelism?os.availableParallelism():os.cpus().length)')" \
    > "/tmp/preflight-soak-$i.log" 2>&1
  echo "run $i: exit=$?  $(grep -E '^PASS — preflight|^FAIL — preflight' "/tmp/preflight-soak-$i.log" | tail -1)"
done
```

Expected: ten lines, all `exit=0`.

**If any run fails:** that is a real finding, not noise. Re-run the failing step alone with `node scripts/run-preflight.js --jobs 1`. If it passes serially, it is a concurrency-coupling bug — either fix the harness's isolation, or set `"lane": "serial"` on that step in `platform/test/preflight-manifest.json` and note why. Then restart the ten-run soak from scratch. **Do not add a retry.**

- [ ] **Step 2: Record the measured speedup**

```bash
cd /Users/willfell/Documents/GitHub/sauce
grep -h '^total' /tmp/preflight-soak-*.log | sort -n -k2
```

Compare against the 333s serial baseline from the spec. Expect roughly 70-90s, floored by `run-codex-autoloop.js` at ~66s.

- [ ] **Step 3: Flip the default**

In `scripts/run-preflight.js`, change:

```js
const DEFAULT_JOBS = 1;
```

to:

```js
const DEFAULT_JOBS = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
```

`os` is already required at the top of the file. Delete the now-redundant `defaultJobCount` function and drop it from `module.exports`.

- [ ] **Step 4: Update the assertion that pinned the old default**

In `platform/test/run-preflight-runner.js`, replace the JOBS-5 case:

```js
  ok('JOBS-5 the default is 1 until the soak flips it',
    resolveJobs([], {}) === 1);
```

with:

```js
  ok('JOBS-5 the default is the machine parallelism',
    resolveJobs([], {}) === (os.availableParallelism ? os.availableParallelism() : os.cpus().length));
```

Note that JOBS-6 and JOBS-7 assert a fallback to the default on bad input; they now compare against that same value. Update them to match:

```js
  const dflt = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  ok('JOBS-6 a non-numeric value falls back to the default',
    resolveJobs(['--jobs', 'lots'], {}) === dflt);
  ok('JOBS-7 zero and negative values clamp to the default',
    resolveJobs(['--jobs', '0'], {}) === dflt && resolveJobs(['--jobs', '-3'], {}) === dflt);
```

- [ ] **Step 5: Verify**

Run: `node platform/test/run-preflight-runner.js`
Expected: `PASS — preflight runner (37/37)`

Run: `npm run release:preflight`
Expected: exit 0, `total` well under the 333s baseline.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-preflight.js platform/test/run-preflight-runner.js
git commit -m "perf: run preflight steps concurrently by default"
```

---

## Verification

After all six tasks:

```bash
cd /Users/willfell/Documents/GitHub/sauce
npm run release:preflight; echo "exit=$?"      # 0, ~75s
node scripts/check-orphan-harnesses.js         # PASS
node scripts/lint-schemas.js; echo "exit=$?"   # 0
git status --short                             # only the two pre-existing autoloop files
```

The coordinator gate and all three workflows call `npm run release:preflight` and were never edited — that is the point of keeping the script name and exit-code contract.

## Out of Scope

- Sharding `run-codex-autoloop.js` to lower the ~66s floor.
- Whether the seven non-preflight harnesses should gate.
- Trimming the CI matrix so each OS leg runs a different subset.
- `release:preflight-bumped` running the full suite a second time.
- Any change to `.github/workflows/`, the release pipeline, or the coordinator.
