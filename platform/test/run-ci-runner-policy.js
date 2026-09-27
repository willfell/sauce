#!/usr/bin/env node
"use strict";

// CI runner policy: every job in every workflow runs on a self-hosted pool, so
// this public repo never spends a GitHub-hosted (or billed larger-runner)
// minute, and a wedged self-hosted job cannot hold a pool for the 6h default.
//
// The audit is per job, not per file. A file-level scan passed a workflow whose
// reusable-workflow job had lost its `with: runner:` — that job then runs on the
// callee's default (`ubuntu-latest` for wac.lab.actions' actionlint), and the
// callee's own runner-policy step is skipped in exactly that case. Per-job
// resolution closes that hole; the mutation fixtures at the bottom prove each
// rule still bites.
//
// Regex rather than a YAML parser -- harnesses are zero-dependency. The parser
// assumes the two-space indentation every workflow here uses; a job it cannot
// resolve is a finding, never a silent pass.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_DIR = path.join(ROOT, ".github/workflows");

const GITHUB_HOSTED = /^(?:ubuntu|macos|windows)-/i;
const ALLOWED_LABELS = new Set(["sauce", "self-hosted", "macOS", "ARM64"]);
const RAW_HOSTED = /(ubuntu|macos|windows)-(latest|\d)/i;
const MAX_TIMEOUT_MINUTES = 60;

// Reusable workflows whose `runs-on` is known to be `${{ inputs.runner }}`.
// Calling anything else is a finding: its runner is invisible from here.
const REUSABLE_WITH_RUNNER_INPUT = new Set([
  "willfell/wac.lab.actions/.github/workflows/actionlint.yml",
]);

// Triggers that run with base-repo privileges on fork-supplied input. On a
// persistent self-hosted runner in a public repo they bypass the fork-PR
// approval gate that is the runner's only protection.
const FORBIDDEN_TRIGGERS = /(^|[\s\[,])(pull_request_target|workflow_run)\s*(:|,|\]|$)/;

let passed = 0;
let failed = 0;

function check(condition, name, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

function stripComment(line) {
  return line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, "");
}

function indentOf(line) {
  return /^( *)/.exec(line)[1].length;
}

function unquote(value) {
  return String(value).trim().replace(/^['"]|['"]$/g, "");
}

function splitFlowList(raw) {
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(unquote)
    .filter(Boolean);
}

// Value of `key:` at `line`: a scalar, a flow list, or a block sequence on the
// following deeper-indented lines. Returns null for a mapping (e.g. runs-on
// `group:`/`labels:`), which the caller treats as unresolvable.
function readValue(lines, index) {
  const match = /^\s*[A-Za-z0-9_-]+:\s*(.*)$/.exec(stripComment(lines[index]));
  const raw = match ? match[1].trim() : "";
  if (raw.startsWith("[")) return splitFlowList(raw);
  if (raw !== "") return [unquote(raw)];
  const own = indentOf(lines[index]);
  const items = [];
  for (let j = index + 1; j < lines.length; j += 1) {
    const line = stripComment(lines[j]);
    if (line.trim() === "") continue;
    if (indentOf(line) <= own) break;
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (!item) return null;
    items.push(unquote(item[1]));
  }
  return items;
}

function parseJobs(source) {
  const lines = String(source).split("\n");
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(stripComment(line)));
  if (jobsAt < 0) return [];
  const jobs = [];
  let current = null;
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const line = stripComment(lines[i]);
    if (line.trim() === "") continue;
    if (indentOf(line) === 0) break;
    const header = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = { id: header[1], line: i + 1, start: i, end: lines.length };
      if (jobs.length) jobs[jobs.length - 1].end = i;
      jobs.push(current);
    }
  }
  return jobs.map((job) => describeJob(lines, job));
}

function describeJob(lines, job) {
  const out = { id: job.id, line: job.line, runsOn: null, uses: null, runner: null, timeout: null, matrix: {} };
  let inWith = false;
  let inStrategy = false;
  for (let i = job.start + 1; i < job.end; i += 1) {
    const line = stripComment(lines[i]);
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    const key = /^\s*-?\s*([A-Za-z0-9_-]+):/.exec(line);
    if (indent === 4) {
      inWith = /^    with:\s*$/.test(line);
      inStrategy = /^    strategy:\s*$/.test(line);
      if (!key) continue;
      if (key[1] === "runs-on") out.runsOn = { values: readValue(lines, i), line: i + 1 };
      if (key[1] === "uses") out.uses = { value: readValue(lines, i)[0], line: i + 1 };
      if (key[1] === "timeout-minutes") out.timeout = { value: readValue(lines, i)[0], line: i + 1 };
      continue;
    }
    if (inWith && indent === 6 && key && key[1] === "runner") {
      out.runner = { values: readValue(lines, i), line: i + 1 };
    }
    if (inStrategy && key) {
      const values = readValue(lines, i);
      if (values && values.length) {
        out.matrix[key[1]] = (out.matrix[key[1]] || []).concat(values);
      }
    }
  }
  return out;
}

// Labels a `runs-on` can dispatch to, or an error string when they cannot be
// known statically. Only a bare `${{ matrix.KEY }}` resolves; vars/inputs/
// fallbacks carry their label outside this file and are refused.
function resolveRunsOn(job) {
  const values = job.runsOn.values;
  if (!values || values.length === 0) return { error: "runs-on has no resolvable labels (mapping or empty)" };
  const labels = [];
  for (const value of values) {
    if (!value.includes("${{")) {
      labels.push(value);
      continue;
    }
    const matrixRef = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/.exec(value);
    if (!matrixRef) return { error: `runs-on expression ${value} cannot be resolved statically` };
    const resolved = job.matrix[matrixRef[1]];
    if (!resolved || resolved.length === 0) {
      return { error: `runs-on references matrix.${matrixRef[1]}, which the job's strategy does not define` };
    }
    labels.push(...resolved);
  }
  return { labels };
}

function badLabels(labels) {
  return labels.filter((label) => GITHUB_HOSTED.test(label) || !ALLOWED_LABELS.has(label));
}

function auditWorkflow(source) {
  const findings = [];
  const add = (rule, line, detail) => findings.push({ rule, line, detail });

  String(source)
    .split("\n")
    .forEach((line, index) => {
      const code = stripComment(line);
      if (RAW_HOSTED.test(code)) add("raw-hosted-token", index + 1, code.trim());
      if (FORBIDDEN_TRIGGERS.test(code)) add("forbidden-trigger", index + 1, code.trim());
    });

  const jobs = parseJobs(source);
  if (jobs.length === 0) add("no-jobs", 0, "no jobs parsed");

  for (const job of jobs) {
    const where = `job ${job.id}`;
    if (Boolean(job.runsOn) === Boolean(job.uses)) {
      add("runs-on-xor-uses", job.line, `${where} must declare exactly one of runs-on / uses`);
      continue;
    }

    if (job.uses) {
      const target = String(job.uses.value).replace(/@.*$/, "");
      if (!REUSABLE_WITH_RUNNER_INPUT.has(target)) {
        add("unknown-reusable", job.uses.line, `${where} calls ${job.uses.value}, whose runner is not known to be self-hosted`);
        continue;
      }
      if (!job.runner) {
        add("reusable-missing-runner", job.uses.line, `${where} calls ${target} without with.runner, so it falls back to the callee's GitHub-hosted default`);
        continue;
      }
      const bad = badLabels(job.runner.values || []);
      if (bad.length || !(job.runner.values || []).length) {
        add("reusable-bad-runner", job.runner.line, `${where} passes runner ${JSON.stringify(job.runner.values)}`);
      }
      continue;
    }

    const resolved = resolveRunsOn(job);
    if (resolved.error) {
      add("unresolvable-runs-on", job.runsOn.line, `${where}: ${resolved.error}`);
    } else {
      const bad = badLabels(resolved.labels);
      if (bad.length) add("hosted-or-unknown-label", job.runsOn.line, `${where} targets ${bad.join(", ")}`);
    }

    if (!job.timeout) {
      add("missing-timeout", job.line, `${where} has no timeout-minutes (the default is 360)`);
    } else {
      const minutes = Number(job.timeout.value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) {
        add("bad-timeout", job.timeout.line, `${where} timeout-minutes ${job.timeout.value} is not an integer in 1..${MAX_TIMEOUT_MINUTES}`);
      }
    }
  }
  return { jobs, findings };
}

console.log("\n--- CI runner policy: every job on a self-hosted pool ---");

const files = workflowFiles();
check(files.length > 0, "workflow directory is non-empty", WORKFLOW_DIR);

let jobCount = 0;
for (const file of files) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
  const { jobs, findings } = auditWorkflow(source);
  jobCount += jobs.length;
  check(jobs.length > 0, `${file} declares at least one job`);
  check(
    findings.length === 0,
    `${file}: all ${jobs.length} job(s) resolve to self-hosted pools with bounded timeouts`,
    findings.map((f) => `line ${f.line} [${f.rule}] ${f.detail}`).join("; ")
  );
}
check(jobCount >= 8, `parsed every job across the workflows (${jobCount})`);

console.log("\n--- mutation fixtures: each rule still bites ---");

const BASE = `name: fixture
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    strategy:
      matrix:
        include:
          - platform: linux
            runner: sauce
          - platform: macos
            runner: [self-hosted, macOS, ARM64]
    runs-on: \${{ matrix.runner }}
    timeout-minutes: 30
    steps:
      - run: echo ok
  lint:
    uses: willfell/wac.lab.actions/.github/workflows/actionlint.yml@v1.10.5
    with:
      runner: sauce
  mac:
    runs-on:
      - self-hosted
      - macOS
    timeout-minutes: 10
    steps:
      - run: echo ok
`;

const baseline = auditWorkflow(BASE);
check(
  baseline.findings.length === 0 && baseline.jobs.length === 3,
  "baseline fixture is clean",
  JSON.stringify(baseline.findings)
);

const MUTATIONS = [
  ["reusable call drops with.runner", "reusable-missing-runner", (s) => s.replace("    with:\n      runner: sauce\n", "")],
  ["reusable call passes a hosted runner", "reusable-bad-runner", (s) => s.replace("    with:\n      runner: sauce\n", "    with:\n      runner: ubuntu-latest\n")],
  ["unknown reusable workflow", "unknown-reusable", (s) => s.replace("willfell/wac.lab.actions/.github/workflows/actionlint.yml", "someone/else/.github/workflows/x.yml")],
  ["include-form matrix runner is hosted", "hosted-or-unknown-label", (s) => s.replace("            runner: sauce\n", "            runner: ubuntu-24.04-arm\n")],
  ["larger hosted runner label", "hosted-or-unknown-label", (s) => s.replace("      - macOS\n", "      - macos-latest-xlarge\n")],
  ["unknown label", "hosted-or-unknown-label", (s) => s.replace("      - macOS\n", "      - gpu\n")],
  ["runs-on from vars", "unresolvable-runs-on", (s) => s.replace("\${{ matrix.runner }}", "\${{ vars.RUNNER }}")],
  ["runs-on with a hosted fallback", "unresolvable-runs-on", (s) => s.replace("\${{ matrix.runner }}", "\${{ matrix.runner || 'sauce' }}")],
  ["runs-on mapping form", "unresolvable-runs-on", (s) => s.replace("    runs-on:\n      - self-hosted\n      - macOS\n", "    runs-on:\n      group: big\n")],
  ["matrix key missing", "unresolvable-runs-on", (s) => s.replace("\${{ matrix.runner }}", "\${{ matrix.os }}")],
  ["job with neither runs-on nor uses", "runs-on-xor-uses", (s) => s.replace("    runs-on:\n      - self-hosted\n      - macOS\n", "")],
  ["missing timeout", "missing-timeout", (s) => s.replace("    timeout-minutes: 10\n", "")],
  ["unbounded timeout", "bad-timeout", (s) => s.replace("timeout-minutes: 10", "timeout-minutes: 360")],
  ["expression timeout", "bad-timeout", (s) => s.replace("timeout-minutes: 10", "timeout-minutes: \${{ inputs.t }}")],
  ["pull_request_target trigger", "forbidden-trigger", (s) => s.replace("  pull_request:\n", "  pull_request_target:\n")],
  ["workflow_run trigger", "forbidden-trigger", (s) => s.replace("  push:\n", "  workflow_run:\n")],
  ["flow-list pull_request_target", "forbidden-trigger", (s) => s.replace("on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n", "on: [push, pull_request_target]\n")],
  ["hosted token hidden in an os matrix", "raw-hosted-token", (s) => s.replace("          - platform: linux\n", "          - platform: linux\n            os: windows-2022\n")],
];

if (baseline.findings.length !== 0) {
  check(false, "mutation fixtures require a clean baseline", "repair the policy parser first");
} else {
  for (const [name, rule, mutate] of MUTATIONS) {
    const mutated = mutate(BASE);
    check(mutated !== BASE, `fixture applies: ${name}`);
    const { findings } = auditWorkflow(mutated);
    check(
      findings.some((f) => f.rule === rule),
      `${name} -> ${rule}`,
      findings.length ? findings.map((f) => f.rule).join(", ") : "no findings"
    );
  }
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
