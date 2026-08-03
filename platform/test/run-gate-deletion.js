'use strict';
// run-gate-deletion — CLI integration coverage for Gate B on REMOVAL slices.
//
// Reproduces the exact ero_loop-retirement shape against a throwaway git repo:
// a slice that DELETES a source file and rewrites its test into a removal guard.
// Before the fix, the mutation check's restore step ran `git checkout HEAD -- <f>`
// on a file with no HEAD blob and threw ("pathspec did not match") → fail-closed.
// Now restore re-deletes such a file (mirror of revert's new-file branch), and a
// deleted test file is dropped from the runnable guard set instead of poisoning
// the check red. Exercises the real CLI (git + node), not the injected unit path.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATE = path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'gate.js');
const GATE_CONFIG = JSON.stringify({ test_globs: ['tests/**'], exclude_globs: ['docs/**', '*.md'], test_command: 'node {test}' });

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('ok ' + n); } else { fail++; console.error('FAIL ' + n); } };

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }); }
function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-del-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'gate@test.local');
  git(dir, 'config', 'user.name', 'gate test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}
function write(dir, rel, body) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}
function runGate(dir, base) {
  // The gate probes git with caught calls (existsInHead/checkout) that print
  // handled 'fatal:' lines to stderr; silence stderr so CI logs stay clean.
  const outText = execFileSync('node', [GATE, 'verify-adequacy', '--base', base, '--cwd', dir, '--json'],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, SAUCE_LOOP_GATE: GATE_CONFIG } });
  return JSON.parse(outText);
}

// ---- GD-1: removal with a surviving removal-guard test → adequate ----
// Base has the module + its behavioral test; HEAD deletes the module and rewrites
// the test into a guard that is GREEN iff the module file is gone.
{
  const dir = initRepo();
  write(dir, 'src/a.py', 'VALUE = 1\n');
  write(dir, 'tests/test_a.py', "print('legacy behavioral test')\n"); // placeholder; runner is node per config
  write(dir, 'tests/test_a.js', "process.exit(0);\n"); // legacy test passes at base
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base: module + test');
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  // HEAD: delete the source module, repurpose the test into a removal guard.
  fs.rmSync(path.join(dir, 'src/a.py'));
  fs.rmSync(path.join(dir, 'tests/test_a.py'));
  write(dir, 'tests/test_a.js',
    "const fs=require('fs'); process.exit(fs.existsSync('src/a.py') ? 1 : 0);\n");
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'remove module, guard its absence');
  const r = runGate(dir, base);
  ok('GD-1 removal with a live removal-guard test is adequate (no fail-closed crash)', r.adequate === true);
  ok('GD-1b verdict reads as a real red→green mutation result', /red without the change and green with it/.test(r.reason || ''));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- GD-2: removal whose only test is also deleted → inadequate, not a crash ----
{
  const dir = initRepo();
  write(dir, 'src/b.py', 'VALUE = 2\n');
  write(dir, 'tests/test_b.js', 'process.exit(0);\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base: module + test');
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  fs.rmSync(path.join(dir, 'src/b.py'));
  fs.rmSync(path.join(dir, 'tests/test_b.js'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'remove module and its only test');
  const r = runGate(dir, base);
  ok('GD-2 removal with no surviving guard is inadequate (clean verdict, no crash)',
    r.adequate === false && r.reason === 'behavioral change ships no regression test');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nrun-gate-deletion: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
