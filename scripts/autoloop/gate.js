#!/usr/bin/env node
/**
 * gate.js — Gate B (the autoloop's verifier). Pure decisions + a
 * dependency-injected mutation-check orchestration; the CLI wires real
 * git/node. Runs in live Phase C before a PR opens.
 *
 * Exports: splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck
 * CLI: node scripts/autoloop/gate.js verify-adequacy [--base main] [--json]
 */
'use strict';

function splitDiff(paths) {
  const testFiles = [];
  const sourceFiles = [];
  for (const raw of paths || []) {
    const f = String(raw).trim();
    if (!f) continue;
    if (/^platform\/test\/run-.*\.js$/.test(f)) { testFiles.push(f); continue; }
    if (/\.md$/.test(f) || f === 'autoloop-queue.md') continue;
    sourceFiles.push(f);
  }
  return { testFiles, sourceFiles };
}

function adequacyVerdict(o) {
  const { hasTest, redWithoutSource, greenWithSource } = o || {};
  if (!hasTest) return { adequate: false, reason: 'behavioral change ships no regression test' };
  if (!redWithoutSource) return { adequate: false, reason: 'test PASSES without the source change — it does not exercise the fix' };
  if (!greenWithSource) return { adequate: false, reason: 'test FAILS with the change restored — the change is broken' };
  return { adequate: true, reason: 'test goes red without the change and green with it' };
}

function gateVerdict(o) {
  const { adequacy, votes = [] } = o || {};
  if (!adequacy || adequacy.adequate !== true) {
    return { gate: 'block', reason: `Gate B L1 (adequacy): ${adequacy ? adequacy.reason : 'no adequacy result'}` };
  }
  if (votes.length < 3) {
    return { gate: 'block', reason: `Gate B L2 (panel): only ${votes.length}/3 verdicts received (fail-closed)` };
  }
  const refutes = votes.filter((v) => !v || v.refuted === true).length;
  if (refutes >= 2) return { gate: 'block', reason: `Gate B L2 (panel): ${refutes}/${votes.length} lenses refuted` };
  return { gate: 'pass', reason: `adequate + ${refutes}/${votes.length} refutes` };
}

function runAdequacyCheck(o) {
  const { paths, runTest, mutate } = o || {};
  const { testFiles, sourceFiles } = splitDiff(paths);
  if (!sourceFiles.length) return { behavioral: false, adequate: true, reason: 'no source change (doc/test-only) — Gate B not required' };
  if (!testFiles.length) return { behavioral: true, ...adequacyVerdict({ hasTest: false }) };
  const allPass = () => testFiles.every((t) => runTest(t));
  let mutated = false, red = false, green = false, err = null;
  try {
    mutated = true;
    mutate('revert', sourceFiles);
    red = !allPass();
    mutate('restore', sourceFiles); mutated = false;
    green = allPass();
  } catch (e) { err = String((e && e.message) || e); }
  finally { if (mutated) { try { mutate('restore', sourceFiles); } catch (_) { /* best effort */ } } }
  if (err) return { behavioral: true, adequate: false, reason: `mutation-check error (fail-closed): ${err}` };
  return { behavioral: true, ...adequacyVerdict({ hasTest: true, redWithoutSource: red, greenWithSource: green }) };
}

module.exports = { splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck };

if (require.main === module) {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = {};
  for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v && !v.startsWith('--')) { args[k] = v; i++; } else args[k] = true; } }
  const sh = (c, a, opts = {}) => execFileSync(c, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  const out = (obj) => { console.log(JSON.stringify(obj, null, 2)); process.exit(0); };

  if (cmd !== 'verify-adequacy') { console.error('usage: gate.js verify-adequacy [--base main] [--json]'); process.exit(2); }
  const base = args.base || 'main';
  let paths = [];
  try { paths = sh('git', ['diff', '--name-only', `${base}...HEAD`]).split('\n').map((s) => s.trim()).filter(Boolean); } catch (_) {}
  const existsInBase = (f) => { try { sh('git', ['cat-file', '-e', `${base}:${f}`]); return true; } catch (_) { return false; } };
  const runTest = (t) => { try { sh('node', [t], { stdio: 'ignore' }); return true; } catch (_) { return false; } };
  const mutate = (action, files) => {
    if (action === 'revert') {
      for (const f of files) { if (existsInBase(f)) sh('git', ['checkout', base, '--', f]); else sh('git', ['rm', '-f', '--quiet', f]); }
    } else { sh('git', ['checkout', 'HEAD', '--', ...files]); }
  };
  out(runAdequacyCheck({ paths, runTest, mutate }));
}
