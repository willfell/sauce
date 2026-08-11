#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_DIR = path.join(ROOT, ".github/workflows");

const GITHUB_HOSTED = /^(?:ubuntu|macos|windows)-/i;
const ALLOWED_LABELS = new Set(["sauce", "self-hosted", "macOS", "ARM64"]);
const RAW_HOSTED = /(ubuntu|macos|windows)-(latest|\d)/i;

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

// Every runner label a workflow can dispatch to: literal `runs-on:` values plus
// the matrix `runner:` entries an expression-valued `runs-on` resolves through.
// Regex rather than a YAML parser -- harnesses are zero-dependency.
function runnerLabels(source) {
  const lines = String(source).split("\n");
  const found = [];
  const push = (value, line) => {
    const trimmed = String(value).trim().replace(/^['"]|['"]$/g, "");
    if (trimmed) found.push({ value: trimmed, line });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*(?:runs-on|runner):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const raw = match[1].trim();

    if (raw === "") {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s*$/.test(lines[j])) continue;
        const item = /^\s*-\s+(.+)$/.exec(lines[j]);
        if (!item) break;
        push(item[1], j + 1);
      }
      continue;
    }

    if (raw.startsWith("[")) {
      raw.replace(/^\[|\]$/g, "").split(",").forEach((token) => push(token, i + 1));
      continue;
    }

    push(raw, i + 1);
  }
  return found;
}

// Belt-and-braces raw-text scan of the whole file, independent of the
// structured runs-on/runner parse above. Catches shapes the structured parse
// cannot see -- an `os:`-keyed matrix resolved through `runs-on: ${{ matrix.os }}`,
// or a `runs-on: {group: ..., labels: ubuntu-latest}` mapping -- because those
// resolve to zero or an opaque expression under runnerLabels().
function rawHostedHits(source) {
  const lines = String(source).split("\n");
  const hits = [];
  lines.forEach((line, index) => {
    if (RAW_HOSTED.test(line)) hits.push({ line: index + 1, text: line.trim() });
  });
  return hits;
}

console.log("\n--- CI runner policy: no GitHub-hosted runners ---");

const files = workflowFiles();
check(files.length > 0, "workflow directory is non-empty", WORKFLOW_DIR);

for (const file of files) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
  const labels = runnerLabels(source);

  check(labels.length > 0, `${file} declares at least one runner target`);

  const hosted = labels.filter((entry) => GITHUB_HOSTED.test(entry.value));
  check(
    hosted.length === 0,
    `${file} targets no GitHub-hosted runner`,
    hosted.map((entry) => `line ${entry.line}: ${entry.value}`).join("; ")
  );

  const unknown = labels.filter(
    (entry) => !entry.value.includes("${{") && !ALLOWED_LABELS.has(entry.value)
  );
  check(
    unknown.length === 0,
    `${file} uses only known self-hosted labels`,
    unknown.map((entry) => `line ${entry.line}: ${entry.value}`).join("; ")
  );

  const rawHits = rawHostedHits(source);
  check(
    rawHits.length === 0,
    `${file} contains no GitHub-hosted runner token anywhere in the file`,
    rawHits.map((hit) => `line ${hit.line}: ${hit.text}`).join("; ")
  );
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
