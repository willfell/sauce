#!/usr/bin/env node
/**
 * run-loop-binding — preflight harness for the SAUCE_LOOP_* binding seam in
 * codex-coordinator.js and batch-runner.js. The seam's contract: with no
 * SAUCE_LOOP_* env set, every derived constant is byte-identical to the
 * historical hardcoded defaults (the live loop is untouched); with env set,
 * the binding is honored; malformed env fails loud. Zero-dep.
 */
'use strict';
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const COORD = path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'codex-coordinator.js');
const BATCH = path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'batch-runner.js');
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

function nodeEval(script, env) {
  return execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: REPO,
    env: { ...process.env, SAUCE_LOOP_BOARD: '', SAUCE_LOOP_CARDS_ROOT: '', SAUCE_LOOP_VAULTS: '', ...env },
  }).trim();
}
// Empty-string env vars are falsy for the seam, but delete them for clean runs.
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['SAUCE_LOOP_BOARD', 'SAUCE_LOOP_CARDS_ROOT', 'SAUCE_LOOP_VAULTS']) {
    if (!(k in extra)) delete env[k];
  }
  return env;
}
function nodeEvalClean(script, extra = {}) {
  return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: REPO, env: cleanEnv(extra) }).trim();
}

const HOME = os.homedir();

// LB-1: no env → historical defaults, byte-identical.
{
  const out = JSON.parse(nodeEvalClean(
    `const c = require(${JSON.stringify(COORD)}); console.log(JSON.stringify({ b: c.BOARD, cr: c.CARDS_ROOT, v: c.VAULTS, ids: c.DEPLOYMENT_VAULT_IDS }));`));
  ok('LB-1 default BOARD unchanged', out.b === path.join(HOME, 'notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md'));
  ok('LB-1 default CARDS_ROOT unchanged', out.cr === path.join(HOME, 'notes/sauce/headspace-sauce/spice/projects/sauce/tasks'));
  ok('LB-1 default VAULTS unchanged', out.v.length === 3 && out.v[0].id === 'headspace' && out.v[2].path === path.join(HOME, 'notes/sauce/ero-sauce'));
  ok('LB-1 default DEPLOYMENT_VAULT_IDS unchanged', JSON.stringify(out.ids) === JSON.stringify(['headspace', 'accuris', 'ero']));
}

// LB-2: env overrides honored (coordinator).
{
  const vaults = JSON.stringify([{ id: 'demo', path: '/v/demo' }]);
  const out = JSON.parse(nodeEvalClean(
    `const c = require(${JSON.stringify(COORD)}); console.log(JSON.stringify({ b: c.BOARD, cr: c.CARDS_ROOT, v: c.VAULTS, ids: c.DEPLOYMENT_VAULT_IDS }));`,
    { SAUCE_LOOP_BOARD: '/v/demo/spice/projects/demo/demo-board.md', SAUCE_LOOP_CARDS_ROOT: '/v/demo/spice/projects/demo/tasks', SAUCE_LOOP_VAULTS: vaults }));
  ok('LB-2 BOARD override', out.b === '/v/demo/spice/projects/demo/demo-board.md');
  ok('LB-2 CARDS_ROOT override', out.cr === '/v/demo/spice/projects/demo/tasks');
  ok('LB-2 VAULTS override', out.v.length === 1 && out.v[0].id === 'demo');
  ok('LB-2 DEPLOYMENT_VAULT_IDS derive from VAULTS', JSON.stringify(out.ids) === JSON.stringify(['demo']));
}

// LB-3: malformed SAUCE_LOOP_VAULTS fails loud at load.
{
  let failed = false, msg = '';
  try {
    nodeEvalClean(`require(${JSON.stringify(COORD)});`, { SAUCE_LOOP_VAULTS: '{not json' });
  } catch (e) { failed = true; msg = String(e.stderr || e.message); }
  ok('LB-3 malformed VAULTS JSON throws', failed && /SAUCE_LOOP_VAULTS is not valid JSON/.test(msg));

  let failed2 = false, msg2 = '';
  try {
    nodeEvalClean(`require(${JSON.stringify(COORD)});`, { SAUCE_LOOP_VAULTS: '[{"id":"x"}]' });
  } catch (e) { failed2 = true; msg2 = String(e.stderr || e.message); }
  ok('LB-3 wrong-shape VAULTS throws', failed2 && /array of \{id, path\}/.test(msg2));
}

// LB-4: loopBindingEnv is a pure function of its env argument.
{
  const c = require(COORD);
  const none = c.loopBindingEnv({});
  ok('LB-4 empty env → nulls', none.board === null && none.cardsRoot === null && none.vaults === null);
  const bound = c.loopBindingEnv({ SAUCE_LOOP_BOARD: '/b.md', SAUCE_LOOP_CARDS_ROOT: '/t', SAUCE_LOOP_VAULTS: '[{"id":"a","path":"/p"}]' });
  ok('LB-4 bound env parsed', bound.board === '/b.md' && bound.cardsRoot === '/t' && bound.vaults[0].id === 'a');
}

// LB-5: batch-runner resolveContext honors the same seam.
{
  const out = JSON.parse(nodeEvalClean(
    `const b = require(${JSON.stringify(BATCH)}); const ctx = b.resolveContext(${JSON.stringify(REPO)}); console.log(JSON.stringify({ bp: ctx.boardPath, cr: ctx.cardsRoot }));`));
  ok('LB-5 batch default boardPath unchanged', out.bp === path.join(HOME, 'notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md'));
  const out2 = JSON.parse(nodeEvalClean(
    `const b = require(${JSON.stringify(BATCH)}); const ctx = b.resolveContext(${JSON.stringify(REPO)}); console.log(JSON.stringify({ bp: ctx.boardPath, cr: ctx.cardsRoot, ir: ctx.intakeRoots }));`,
    { SAUCE_LOOP_BOARD: '/v/demo/spice/projects/demo/demo-board.md', SAUCE_LOOP_CARDS_ROOT: '/v/demo/spice/projects/demo/tasks' }));
  ok('LB-5 batch boardPath override', out2.bp === '/v/demo/spice/projects/demo/demo-board.md');
  ok('LB-5 batch cardsRoot override', out2.cr === '/v/demo/spice/projects/demo/tasks');
  ok('LB-5 batch intakeRoots follow the binding', JSON.stringify(out2.ir) === JSON.stringify(['/v/demo/spice/projects/demo', '/v/demo/spice/projects/demo/tasks']));
}

// LB-6: SAUCE_LOOP_REPO retargets record-pr/advance PR lookups; default is the
// historical sauce repo.
{
  const def = nodeEvalClean(`console.log(require(${JSON.stringify(COORD)}).REPO);`);
  ok('LB-6 default REPO unchanged', def === 'willfell/sauce');
  const bound = nodeEvalClean(`console.log(require(${JSON.stringify(COORD)}).REPO);`, { SAUCE_LOOP_REPO: 'willfell/ero-copilot-iac' });
  ok('LB-6 REPO override honored', bound === 'willfell/ero-copilot-iac');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
