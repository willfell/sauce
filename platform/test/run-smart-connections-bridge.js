#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * run-smart-connections-bridge.js — focused harness for sc-bridge CLI.
 *
 * Asserts the bridge's JSON output contract against synthetic fixtures.
 * Semantic-search cases pay @xenova/transformers cold-load cost on first
 * fire (cached for subsequent runs).
 */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FIX = path.join(ROOT, "platform/test/fixtures/smart-connections-bridge");
const BRIDGE = path.join(ROOT, "platform/mechanisms/smart-connections-bridge/sc-bridge.js");

let passed = 0, failed = 0;
function assertTrue(c, msg) { if (!c) { failed++; console.error(`FAIL ${msg}`); } else passed++; }
function assertEq(actual, expected, msg) {
  if (actual !== expected) { failed++; console.error(`FAIL ${msg} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  else passed++;
}
const assertEqual = assertEq;

function runBridge(args) {
  const r = spawnSync("node", [BRIDGE, ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// ---------------------------------------------------------------------------
// HC-V0750-B1 — index-status on vault-empty returns absent
// ---------------------------------------------------------------------------
{
  const { code, stdout } = runBridge(["index-status", "--vault", path.join(FIX, "vault-empty")]);
  assertEq(code, 0, "HC-V0750-B1 exit 0");
  const obj = JSON.parse(stdout.trim());
  assertEq(obj.index_status, "absent", "HC-V0750-B1 index_status absent on vault-empty");
}

// HC-V0750-B2 — index-status on vault-no-multi returns absent
{
  const { code, stdout } = runBridge(["index-status", "--vault", path.join(FIX, "vault-no-multi")]);
  assertEq(code, 0, "HC-V0750-B2 exit 0");
  const obj = JSON.parse(stdout.trim());
  assertEq(obj.index_status, "absent", "HC-V0750-B2 index_status absent on vault-no-multi");
}

// HC-V0750-B3 — index-status on vault-ready returns ready with source_count 4
{
  const { code, stdout } = runBridge(["index-status", "--vault", path.join(FIX, "vault-ready")]);
  assertEq(code, 0, "HC-V0750-B3 exit 0");
  const obj = JSON.parse(stdout.trim());
  assertEq(obj.index_status, "ready", "HC-V0750-B3 index_status ready");
  assertEq(obj.source_count, 4, "HC-V0750-B3 source_count 4");
  assertEq(obj.embedding_model, "TaylorAI/bge-micro-v2", "HC-V0750-B3 embedding_model captured");
  assertTrue(typeof obj.index_age_minutes === "number", "HC-V0750-B3 index_age_minutes is number");
}

// HC-V0750-B4 — find-related on alpha returns beta first (closest similarity)
{
  const { code, stdout } = runBridge(["find-related", "notes/alpha.md", "--vault", path.join(FIX, "vault-ready"), "--top-k", "3", "--min-similarity", "0"]);
  assertEq(code, 0, "HC-V0750-B4 exit 0");
  const obj = JSON.parse(stdout.trim());
  assertTrue(obj.hits.length >= 1, "HC-V0750-B4 has hits");
  assertEq(obj.hits[0].path, "notes/beta.md", "HC-V0750-B4 top hit is beta");
}

// HC-V0750-B5 — find-related with --min-similarity 0.95 returns 0 hits
{
  const { code, stdout } = runBridge(["find-related", "notes/alpha.md", "--vault", path.join(FIX, "vault-ready"), "--min-similarity", "0.95"]);
  assertEq(code, 0, "HC-V0750-B5 exit 0");
  const obj = JSON.parse(stdout.trim());
  assertEq(obj.hits.length, 0, "HC-V0750-B5 zero hits above 0.95 floor");
}

// HC-V0750-B6 — find-related on unindexed anchor returns skipped:anchor-not-indexed
{
  const { code, stdout } = runBridge(["find-related", "notes/missing.md", "--vault", path.join(FIX, "vault-ready"), "--min-similarity", "0"]);
  assertEq(code, 0, "HC-V0750-B6 exit 0");
  const obj = JSON.parse(stdout.trim());
  assertEq(obj.skipped, "anchor-not-indexed", "HC-V0750-B6 skipped reason correct");
  assertEq(obj.hits.length, 0, "HC-V0750-B6 zero hits");
}

// HC-V0750-B7 — {{module_directory}} substitution resolves correctly
{
  const { code, stdout } = runBridge(["find-related", "spice/cowork/test.md", "--vault", path.join(FIX, "vault-module-dir"), "--min-similarity", "0"]);
  assertEq(code, 0, "HC-V0750-B7 exit 0");
  const obj = JSON.parse(stdout.trim());
  // Anchor IS in the index (substitution resolves), so we shouldn't see anchor-not-indexed.
  assertTrue(!("skipped" in obj) || obj.skipped !== "anchor-not-indexed",
             "HC-V0750-B7 substitution resolves anchor (not anchor-not-indexed)");
}

// HC-V0750-B8 — corrupt fixture: 1 file skipped, remaining returned
{
  const { code, stdout, stderr } = runBridge(["find-related", "notes/alpha.md", "--vault", path.join(FIX, "vault-corrupt"), "--top-k", "5", "--min-similarity", "0"]);
  assertEq(code, 0, "HC-V0750-B8 exit 0 (corrupt file did not abort)");
  assertTrue(stderr.includes("skipping unparseable"), "HC-V0750-B8 stderr warns about skipped file");
  const obj = JSON.parse(stdout.trim());
  // Expect 2 hits (beta + gamma; broken was skipped; alpha is the anchor itself).
  assertTrue(obj.hits.length === 2, `HC-V0750-B8 hits.length == 2; got ${obj.hits.length}`);
}

// HC-V0750-B9 — exit 4 when ALL files unparseable
{
  const tmpVault = fs.mkdtempSync(path.join(require("os").tmpdir(), "sc-bridge-all-corrupt-"));
  fs.mkdirSync(path.join(tmpVault, ".smart-env", "multi"), { recursive: true });
  fs.writeFileSync(path.join(tmpVault, ".smart-env", "smart_env.json"), '{"is_obsidian_vault":true,"smart_sources":{"embed_model":{"adapter":"transformers","transformers":{"model_key":"TaylorAI/bge-micro-v2"}}}}');
  fs.writeFileSync(path.join(tmpVault, ".smart-env", "multi", "broken.ajson"), '"smart_sources:x.md": {"path":');
  fs.writeFileSync(path.join(tmpVault, ".smart-env", "multi", "broken2.ajson"), 'not even json');
  const { code, stdout } = runBridge(["find-related", "x.md", "--vault", tmpVault, "--min-similarity", "0"]);
  assertEq(code, 4, "HC-V0750-B9 exit 4 on all-corrupt");
  const obj = JSON.parse(stdout.trim());
  assertEq(obj.index_status, "error", "HC-V0750-B9 index_status error");
  fs.rmSync(tmpVault, { recursive: true, force: true });
}

// HC-V0750-B10 — --exclude-glob filters hits
{
  const { code, stdout } = runBridge(["find-related", "notes/alpha.md", "--vault", path.join(FIX, "vault-ready"), "--top-k", "5", "--min-similarity", "0", "--exclude-glob", "notes/beta.md"]);
  assertEq(code, 0, "HC-V0750-B10 exit 0");
  const obj = JSON.parse(stdout.trim());
  const hasBeta = obj.hits.some((h) => h.path === "notes/beta.md");
  assertTrue(!hasBeta, "HC-V0750-B10 beta filtered out by --exclude-glob");
}

// HC-V0750-B11 — missing --vault → exit 2
{
  const { code, stderr } = runBridge(["index-status"]);
  assertEq(code, 2, "HC-V0750-B11 exit 2 on missing --vault");
  assertTrue(stderr.includes("missing required --vault"), "HC-V0750-B11 stderr message");
}

// HC-V0750-B12 — vault path doesn't exist → exit 3
{
  const { code, stderr } = runBridge(["index-status", "--vault", "/tmp/sc-bridge-nonexistent-vault-xyz"]);
  assertEq(code, 3, "HC-V0750-B12 exit 3 on bad vault path");
  assertTrue(stderr.includes("vault path not found"), "HC-V0750-B12 stderr message");
}

// HC-V0751-D1 — --quiet suppresses the non-fatal "skipping unparseable .ajson"
// stderr warning. Constructs a vault with one malformed .ajson file then
// invokes index-status with --quiet and asserts zero stderr bytes.
async function caseV0751D1QuietSuppressesStderr() {
    const label = "HC-V0751-D1 sc-bridge --quiet produces zero stderr on parse-skip";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-d1-"));
    try {
        const multiDir = path.join(tmp, ".smart-env", "multi");
        fs.mkdirSync(multiDir, { recursive: true });
        // One valid + one malformed .ajson so loadIndex exercises the warn path.
        fs.writeFileSync(path.join(multiDir, "valid.ajson"),
            '"a/note.md": {"path": "a/note.md", "embeddings": {"TaylorAI/bge-micro-v2": {"vec": [0.1, 0.2]}}}');
        fs.writeFileSync(path.join(multiDir, "malformed.ajson"), "not json at all");
        const bridge = path.join(__dirname, "..", "mechanisms", "smart-connections-bridge", "sc-bridge.js");
        // Run semantic-search (which exercises loadIndex) with --quiet.
        const r = spawnSync("node", [bridge, "semantic-search", "test query",
            "--vault", tmp, "--quiet"], { encoding: "utf8" });
        assertEqual(r.stderr || "", "", label);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Async runner for v0.75.1 cases
// ---------------------------------------------------------------------------
(async () => {
  await caseV0751D1QuietSuppressesStderr();

  console.log(`\n=== run-smart-connections-bridge ===`);
  console.log(`passed: ${passed}  failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
