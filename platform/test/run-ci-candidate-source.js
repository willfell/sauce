#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const CI_PATH = path.join(ROOT, ".github/workflows/ci.yml");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const CANDIDATE_CLI = path.join(ROOT, "platform/cli/sauce-cli.js");

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

function jobBody(source, name) {
  const lines = String(source).split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function stepBodies(job) {
  const lines = String(job).split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^      - name:\s+/.test(lines[i])) starts.push(i);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    return lines.slice(start, end).join("\n");
  });
}

function candidateErrors(source) {
  const body = jobBody(source, "preflight");
  const errors = [];
  if (!body) return ["missing preflight job"];
  if (!/matrix:\s*[\s\S]*os:\s*\[macos-latest,\s*ubuntu-latest\]/.test(body)) {
    errors.push("required macOS/Ubuntu matrix changed");
  }
  if (!body.includes("uses: actions/checkout@v4")) {
    errors.push("candidate source is not checked out");
  }
  const candidateStep = stepBodies(body).find((step) =>
    step.includes('node "$SAUCE_CANDIDATE_CLI" bootstrap --vault "$TMP_VAULT" --non-interactive --no-register')
  ) || "";
  if (!candidateStep) {
    errors.push("candidate bootstrap step is missing");
  }
  if (!candidateStep.includes("if: matrix.os == 'macos-latest'")) {
    errors.push("candidate bootstrap is not bound to the required macOS matrix arm");
  }
  if (!candidateStep.includes('SAUCE_CANDIDATE_CLI: ${{ github.workspace }}/platform/cli/sauce-cli.js')) {
    errors.push("candidate CLI is not bound to the checked-out workspace");
  }
  if (!candidateStep.includes('test -f "$SAUCE_CANDIDATE_CLI"')) {
    errors.push("candidate CLI existence is not failure-loud");
  }
  if (!candidateStep.includes('node "$SAUCE_CANDIDATE_CLI" help')) {
    errors.push("candidate CLI help does not execute checked-out source");
  }
  if (!candidateStep.includes('node "$SAUCE_CANDIDATE_CLI" bootstrap --vault "$TMP_VAULT" --non-interactive --no-register')) {
    errors.push("fresh-vault bootstrap does not execute checked-out source");
  }
  if (!candidateStep.includes('node "$SAUCE_CANDIDATE_CLI" audit --vault "$TMP_VAULT"')) {
    errors.push("fresh-vault audit does not execute checked-out source");
  }
  if (/\bbrew (?:tap|install|upgrade)\b/.test(body)) {
    errors.push("required preflight still depends on a released formula");
  }
  if (/^\s+sauce (?:help|bootstrap|audit)\b/m.test(body)) {
    errors.push("required preflight invokes ambient sauce instead of candidate source");
  }
  if (body.includes("SKIP_BREW_SMOKE")) {
    errors.push("required candidate validation contains a formula skip path");
  }
  return errors;
}

function releasedFormulaEvidenceErrors(source) {
  const body = jobBody(source, "released-formula-smoke");
  const errors = [];
  if (!body) return ["missing released-formula-smoke job"];
  if (!body.includes("if: github.event_name != 'pull_request'")) {
    errors.push("released-formula evidence can run as a pull-request gate");
  }
  if (!body.includes("continue-on-error: true")) {
    errors.push("released-formula evidence is not explicitly non-required");
  }
  if (!body.includes("runs-on: macos-latest")) {
    errors.push("released-formula evidence is not macOS-only");
  }
  if (!body.includes("brew install willfell/sauce/sauce")) {
    errors.push("released formula is not installed explicitly");
  }
  if (!body.includes('sauce bootstrap --vault "$TMP_VAULT" --non-interactive --no-register')) {
    errors.push("released-formula bootstrap evidence is missing");
  }
  if (!body.includes("if: always()")) {
    errors.push("released-formula cleanup is not unconditional");
  }
  return errors;
}

function replaceOnce(source, from, to) {
  const at = source.indexOf(from);
  if (at < 0) throw new Error(`fixture precondition missing: ${from}`);
  return source.slice(0, at) + to + source.slice(at + from.length);
}

console.log("\n--- GA-OPS12b2 candidate-source macOS premerge validation ---");

const workflow = fs.readFileSync(CI_PATH, "utf8");
const candidateBaseline = candidateErrors(workflow);
const releasedBaseline = releasedFormulaEvidenceErrors(workflow);

check(
  candidateBaseline.length === 0,
  "GA-OPS12-CANDIDATE-SOURCE-PREMERGE",
  candidateBaseline.join("; ")
);
check(
  releasedBaseline.length === 0,
  "GA-OPS12-RELEASED-FORMULA-POSTRELEASE",
  releasedBaseline.join("; ")
);

const help = spawnSync(process.execPath, [CANDIDATE_CLI, "help"], {
  cwd: ROOT,
  encoding: "utf8",
  env: { ...process.env },
});
check(
  help.status === 0 && /Sauce/.test(help.stdout),
  "candidate CLI source is directly executable",
  `status=${help.status} stderr=${String(help.stderr || "").trim()}`
);

if (candidateBaseline.length === 0 && releasedBaseline.length === 0) {
  const badFormula = replaceOnce(
    workflow,
    "          brew install willfell/sauce/sauce",
    "          false # synthetic known-bad released formula\n          brew install willfell/sauce/sauce"
  );
  check(
    candidateErrors(badFormula).length === 0,
    "GA-OPS12-PREDECESSOR-DEFECT-ISOLATION released-formula failure cannot poison required candidate validation"
  );

  const missingCandidate = replaceOnce(
    workflow,
    "${{ github.workspace }}/platform/cli/sauce-cli.js",
    "${{ github.workspace }}/platform/cli/missing-sauce-cli.js"
  );
  check(
    candidateErrors(missingCandidate).length > 0,
    "GA-OPS12-PREDECESSOR-DEFECT-ISOLATION equivalent candidate-path defect fails loudly"
  );

  const ambientBootstrap = replaceOnce(
    workflow,
    'node "$SAUCE_CANDIDATE_CLI" bootstrap --vault "$TMP_VAULT" --non-interactive --no-register',
    'sauce bootstrap --vault "$TMP_VAULT" --non-interactive --no-register'
  );
  check(
    candidateErrors(ambientBootstrap).length > 0,
    "ambient released sauce cannot replace candidate bootstrap"
  );

  const ubuntuOnlyCandidate = replaceOnce(
    workflow,
    "        if: matrix.os == 'macos-latest'\n        env:\n          SAUCE_CANDIDATE_CLI:",
    "        if: matrix.os == 'ubuntu-latest'\n        env:\n          SAUCE_CANDIDATE_CLI:"
  );
  check(
    candidateErrors(ubuntuOnlyCandidate).length > 0,
    "candidate bootstrap cannot leave the required macOS matrix arm"
  );

  const formulaInRequired = replaceOnce(
    workflow,
    '          test -f "$SAUCE_CANDIDATE_CLI"',
    '          brew install willfell/sauce/sauce\n          test -f "$SAUCE_CANDIDATE_CLI"'
  );
  check(
    candidateErrors(formulaInRequired).length > 0,
    "required preflight rejects a released-formula dependency"
  );

  const requiredFormula = replaceOnce(workflow, "    continue-on-error: true", "    continue-on-error: false");
  check(
    releasedFormulaEvidenceErrors(requiredFormula).length > 0,
    "released-formula evidence cannot become required"
  );

  const pullRequestFormula = replaceOnce(
    workflow,
    "    if: github.event_name != 'pull_request'",
    "    if: github.event_name == 'pull_request'"
  );
  check(
    releasedFormulaEvidenceErrors(pullRequestFormula).length > 0,
    "released-formula evidence cannot re-enter pull-request gating"
  );
} else {
  check(false, "mutation fixtures require a green baseline", "repair workflow contract first");
}

const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
const preflight = String(pkg.scripts && pkg.scripts["release:preflight"] || "");
check(
  (preflight.match(/node platform\/test\/run-ci-candidate-source\.js/g) || []).length === 1,
  "candidate-source harness is registered exactly once in release:preflight"
);

console.log(`\nci-candidate-source: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
