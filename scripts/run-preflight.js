#!/usr/bin/env node
'use strict';

// scripts/run-preflight.js — manifest-driven preflight runner.
//
// Replaces the 171-step `&&` chain that used to live in package.json's
// `release:preflight`. Steps come from platform/test/preflight-manifest.json.
// The `serial` lane runs to completion first, then the `parallel` lane runs
// through a bounded work queue.
//
// Concurrency defaults to the machine's parallelism (see the plan's final
// task, which soaked ten consecutive full-concurrency runs before flipping
// this). See Docs/superpowers/specs/2026-08-10-parallel-preflight-design.md.
//
// Usage: node scripts/run-preflight.js [--jobs N]
// Env:   SAUCE_PREFLIGHT_JOBS=N   (argv wins)

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'platform', 'test', 'preflight-manifest.json');

// Default concurrency: the machine's available parallelism.
const DEFAULT_JOBS = os.availableParallelism ? os.availableParallelism() : os.cpus().length;

const LANES = ['serial', 'parallel'];

// Per-step timeout. Generous — ~20x the longest real step (~46s) — but a hung
// step must not hang the run forever, and with groups it would otherwise wedge
// its whole group. 15 minutes.
const STEP_TIMEOUT_MS = 900000;

// Grace period between SIGTERM and SIGKILL for a step that doesn't exit promptly.
const KILL_GRACE_MS = 5000;

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
    if (step.group !== undefined && (typeof step.group !== 'string' || !step.group.trim())) {
      errors.push(`${where}: group must be a non-empty string`);
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

function runStep(step, cwd, timeoutMs = STEP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(step.cmd[0], step.cmd.slice(1), {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    let timedOut = false;
    let killTimer = null;

    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });

    // Fires once at timeoutMs: send SIGTERM, then SIGKILL if the child hasn't
    // exited within KILL_GRACE_MS. The 'close' handler below always resolves
    // the step — this timer only ever nudges the child toward exiting so
    // 'close' can fire; it never resolves directly.
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (e) { /* already dead */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* already dead */ }
      }, KILL_GRACE_MS);
    }, timeoutMs);

    const clearTimers = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        id: step.id, cmd: step.cmd, status: 'fail', code: null,
        durationMs: Date.now() - started, output: `${output}${err.message}`,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (timedOut) {
        resolve({
          id: step.id, cmd: step.cmd, status: 'fail', code,
          durationMs: Date.now() - started,
          output: `${output}\nFAIL — step "${step.id}" timed out after ${(timeoutMs / 1000).toFixed(1)}s\n`,
        });
        return;
      }
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
//
// A step may carry an optional `group`. At most one step per group runs at a
// time; steps in different groups (or with no group at all) still run
// concurrently around them. A worker that finds every remaining step's group
// busy polls rather than blocking, so other workers can keep draining
// ungrouped/other-group work in the meantime. Releasing a group happens in a
// `finally` so a step that throws never wedges its group forever.
async function runLane(steps, jobs, cwd, onResult, isHalted, timeoutMs = STEP_TIMEOUT_MS) {
  const queue = steps.map((step) => step);
  const busy = new Set();
  let failed = false;
  const takeNext = () => {
    for (let k = 0; k < queue.length; k += 1) {
      const g = queue[k].group;
      if (!g || !busy.has(g)) return queue.splice(k, 1)[0];
    }
    return null;
  };
  const workers = Array.from({ length: Math.min(jobs, steps.length || 1) }, async () => {
    for (;;) {
      if (failed || isHalted()) return;
      const step = takeNext();
      if (!step) {
        if (queue.length === 0) return;
        // Every queued step's group is currently busy; wait for a holder to
        // finish rather than spin-locking the event loop.
        await new Promise((resolve) => { setTimeout(resolve, 25); });
        continue;
      }
      const g = step.group;
      if (g) busy.add(g);
      try {
        const result = await runStep(step, cwd, timeoutMs);
        onResult(result);
        if (result.status === 'fail') failed = true;
      } finally {
        if (g) busy.delete(g);
      }
    }
  });
  await Promise.all(workers);
  return !failed;
}

async function runManifest(manifest, opts = {}) {
  const jobs = Math.max(1, opts.jobs || DEFAULT_JOBS);
  const cwd = opts.cwd || ROOT;
  const timeoutMs = opts.timeoutMs || STEP_TIMEOUT_MS;
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
  await runLane(lanes.serial, 1, cwd, onResult, () => halted, timeoutMs);
  if (!halted) await runLane(lanes.parallel, jobs, cwd, onResult, () => halted, timeoutMs);

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
  // process.exitCode (not process.exit) so queued stdout isn't truncated when
  // stdout is a pipe — exactly how the coordinator invokes this (stdio: 'pipe').
  process.exitCode = ok ? 0 : 1;
}

module.exports = {
  loadManifest, validateManifest, planLanes, runManifest, runStep,
  formatSummary, resolveJobs, DEFAULT_JOBS, STEP_TIMEOUT_MS,
};

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
