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

  // Append skipped results for any step that was never dispatched.
  const resultIds = new Set(results.map((r) => r.id));
  for (const step of manifest.steps) {
    if (!resultIds.has(step.id)) {
      results.push({
        id: step.id, cmd: step.cmd, status: 'skipped', code: null,
        durationMs: 0, output: '',
      });
    }
  }

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
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const lines = [''];
  lines.push('preflight summary');
  lines.push('-'.repeat(60));
  for (const r of results) {
    if (r.status === 'skipped') continue;
    const secs = (r.durationMs / 1000).toFixed(1).padStart(7);
    lines.push(`${(r.status === 'pass' ? 'PASS' : 'FAIL').padEnd(5)}${secs}s  ${r.id}`);
  }
  if (skipped > 0) {
    lines.push(`SKIP  ${skipped} steps not dispatched after the failure`);
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
