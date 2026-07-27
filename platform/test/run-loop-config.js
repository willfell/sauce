#!/usr/bin/env node
/**
 * run-loop-config — preflight harness for the loop plugin's binding resolver
 * (plugins/loop/scripts/loop-config.js). Fixture families: config resolution,
 * refusals (missing/invalid/coupling), tilde expansion, env-map emission,
 * coordinator resolution, and the `check` vault validations. Zero-dep.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const LC = require(path.resolve(__dirname, '..', '..', 'plugins', 'loop', 'scripts', 'loop-config.js'));
const CLI = path.resolve(__dirname, '..', '..', 'plugins', 'loop', 'scripts', 'loop-config.js');

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

const HOME = '/home/fixture';
function baseConfig() {
  return {
    schema_version: '1.0.0',
    project: { slug: 'demo', name: 'Demo' },
    vault: { root: '~/vaults/demo-vault' },
    board: {
      project_root: 'spice/projects/demo',
      board_path: 'spice/projects/demo/demo-board.md',
      cards_root: 'spice/projects/demo/tasks',
    },
    ids: { default_prefix: 'DM' },
    policy: { batch_policy: 'continue', execution_mode: 'release' },
    coordinator: { resolve: 'path', path: '~/tools/coordinator.js' },
    fid: '~/vaults/demo-vault/docs/FID.md',
    codex: { routers: true, plugin_root: '/opt/homebrew/opt/sauce/libexec/plugins/loop' },
  };
}

function mkRepo(config) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-config-'));
  if (config !== undefined) {
    fs.mkdirSync(path.join(repo, '.loop'), { recursive: true });
    const body = typeof config === 'string' ? config : JSON.stringify(config, null, 2);
    fs.writeFileSync(path.join(repo, '.loop', 'config.json'), body);
  }
  return repo;
}

// ---------------------------------------------------------------------------
// LC-1 — valid config resolves with tilde expansion + absolute paths.
// ---------------------------------------------------------------------------
{
  const repo = mkRepo(baseConfig());
  const r = LC.resolveBinding(repo, { home: HOME });
  ok('LC-1 ok', r.ok === true);
  ok('LC-1 slug', r.config.project_slug === 'demo');
  ok('LC-1 vault_root expanded', r.config.vault_root === path.join(HOME, 'vaults/demo-vault'));
  ok('LC-1 board abs under vault', r.config.board_path_abs === path.join(HOME, 'vaults/demo-vault/spice/projects/demo/demo-board.md'));
  ok('LC-1 cards abs under vault', r.config.cards_root_abs === path.join(HOME, 'vaults/demo-vault/spice/projects/demo/tasks'));
  ok('LC-1 coordinator tilde expanded', r.config.coordinator === path.join(HOME, 'tools/coordinator.js'));
  ok('LC-1 fid expanded', r.config.fid_abs === path.join(HOME, 'vaults/demo-vault/docs/FID.md'));
  ok('LC-1 id prefix', r.config.id_prefix === 'DM');
  ok('LC-1 repo_root', r.config.repo_root === repo);
  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// LC-2 — refusals: missing config / invalid JSON / missing field / coupling.
// ---------------------------------------------------------------------------
{
  const repo = mkRepo(undefined);
  const r = LC.resolveBinding(repo, { home: HOME });
  ok('LC-2 missing config refuses', r.ok === false && r.refusals.some((x) => x.code === 'config_missing'));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const repo = mkRepo('{not json');
  const r = LC.resolveBinding(repo, { home: HOME });
  ok('LC-2 invalid JSON refuses', r.ok === false && r.refusals.some((x) => x.code === 'config_invalid_json'));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const c = baseConfig(); delete c.board.board_path;
  const repo = mkRepo(c);
  const r = LC.resolveBinding(repo, { home: HOME });
  ok('LC-2 missing field refuses', r.ok === false && r.refusals.some((x) => x.code === 'config_missing_field' && /board\.board_path/.test(x.message)));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const c = baseConfig(); c.board.board_path = 'spice/projects/elsewhere/demo-board.md';
  const repo = mkRepo(c);
  const r = LC.resolveBinding(repo, { home: HOME });
  ok('LC-2 coupling violation refuses', r.ok === false && r.refusals.some((x) => x.code === 'config_coupling_violation'));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const c = baseConfig(); c.schema_version = '2.0.0';
  const repo = mkRepo(c);
  const r = LC.resolveBinding(repo, { home: HOME });
  ok('LC-2 unsupported schema refuses', r.ok === false && r.refusals.some((x) => x.code === 'config_unsupported_schema'));
  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// LC-3 — env map feeds both existing seams.
// ---------------------------------------------------------------------------
{
  const repo = mkRepo(baseConfig());
  const r = LC.resolveBinding(repo, { home: HOME });
  const env = r.config.env;
  ok('LC-3 DELIVERY_REPO_ROOT', env.DELIVERY_REPO_ROOT === repo);
  ok('LC-3 DELIVERY_COORDINATOR', env.DELIVERY_COORDINATOR === path.join(HOME, 'tools/coordinator.js'));
  ok('LC-3 DELIVERY_FID', env.DELIVERY_FID === path.join(HOME, 'vaults/demo-vault/docs/FID.md'));
  ok('LC-3 DELIVERY_STATE under repo git', env.DELIVERY_STATE === path.join(repo, '.git', 'sauce-autoloop', 'state.json'));
  ok('LC-3 SAUCE_LOOP_BOARD', env.SAUCE_LOOP_BOARD === r.config.board_path_abs);
  ok('LC-3 SAUCE_LOOP_CARDS_ROOT', env.SAUCE_LOOP_CARDS_ROOT === r.config.cards_root_abs);
  ok('LC-3 no vaults env without deploy_vaults', !('SAUCE_LOOP_VAULTS' in env));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const c = baseConfig();
  c.policy.deploy_vaults = [{ id: 'demo', path: '~/vaults/demo-vault' }];
  const repo = mkRepo(c);
  const r = LC.resolveBinding(repo, { home: HOME });
  const vaults = JSON.parse(r.config.env.SAUCE_LOOP_VAULTS);
  ok('LC-3 SAUCE_LOOP_VAULTS expanded', vaults.length === 1 && vaults[0].id === 'demo' && vaults[0].path === path.join(HOME, 'vaults/demo-vault'));
  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// LC-4 — coordinator resolution modes.
// ---------------------------------------------------------------------------
{
  const c = baseConfig(); c.coordinator = { resolve: 'brew' };
  const repo = mkRepo(c);
  const r = LC.resolveBinding(repo, { home: HOME, brewPrefix: () => '/brew/opt/sauce' });
  ok('LC-4 brew resolve', r.ok === true && r.config.coordinator === '/brew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js');
  const rFail = LC.resolveBinding(repo, { home: HOME, brewPrefix: () => { throw new Error('no brew'); } });
  ok('LC-4 brew failure refuses', rFail.ok === false && rFail.refusals.some((x) => x.code === 'coordinator_unresolved'));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const c = baseConfig(); c.coordinator = { resolve: 'teleport' };
  const repo = mkRepo(c);
  const r = LC.resolveBinding(repo, { home: HOME });
  ok('LC-4 unknown resolve refuses', r.ok === false && r.refusals.some((x) => x.code === 'config_bad_value'));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const c = baseConfig(); delete c.coordinator; // default = brew
  const repo = mkRepo(c);
  const r = LC.resolveBinding(repo, { home: HOME, brewPrefix: () => '/brew/opt/sauce' });
  ok('LC-4 default resolve is brew', r.ok === true && /codex-coordinator\.js$/.test(r.config.coordinator));
  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// LC-5 — check verb validates the bound vault.
// ---------------------------------------------------------------------------
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-home-'));
  const c = baseConfig();
  const repo = mkRepo(c);
  const vaultRoot = path.join(home, 'vaults/demo-vault');
  fs.mkdirSync(path.join(vaultRoot, 'spice/projects/demo/tasks'), { recursive: true });
  fs.writeFileSync(path.join(vaultRoot, 'spice/projects/demo/demo-board.md'), '## In Planning\n\n## Completed\n');
  const good = LC.checkBinding(repo, { home });
  ok('LC-5 check passes on healthy vault', good.ok === true, JSON.stringify(good.refusals || []));

  fs.rmSync(path.join(vaultRoot, 'spice/projects/demo/demo-board.md'));
  const noBoard = LC.checkBinding(repo, { home });
  ok('LC-5 missing board refuses', noBoard.ok === false && noBoard.refusals.some((x) => x.code === 'board_missing'));

  fs.writeFileSync(path.join(vaultRoot, 'spice/projects/demo/demo-board.md'), '# no planning lane\n');
  const noLane = LC.checkBinding(repo, { home });
  ok('LC-5 board without In Planning refuses', noLane.ok === false && noLane.refusals.some((x) => x.code === 'board_heading_missing'));

  fs.writeFileSync(path.join(vaultRoot, 'spice/projects/demo/demo-board.md'), '## In Planning\n');
  fs.rmSync(path.join(vaultRoot, 'spice/projects/demo/tasks'), { recursive: true });
  const noCards = LC.checkBinding(repo, { home });
  ok('LC-5 missing cards_root refuses', noCards.ok === false && noCards.refusals.some((x) => x.code === 'cards_root_missing'));

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// LC-6 — CLI envelope (receipt grammar: action/ok/no_op + refusal codes).
// ---------------------------------------------------------------------------
{
  const repo = mkRepo(baseConfig());
  const out = JSON.parse(execFileSync(process.execPath, [CLI, 'resolve', '--json', '--repo', repo, '--home', HOME], { encoding: 'utf8' }));
  ok('LC-6 CLI resolve ok envelope', out.action === 'loop-config-resolve' && out.ok === true && out.no_op === false);
  ok('LC-6 CLI carries env map', out.config && out.config.env && out.config.env.SAUCE_LOOP_BOARD === out.config.board_path_abs);
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  const repo = mkRepo(undefined);
  let code = 0, body = '';
  try {
    execFileSync(process.execPath, [CLI, 'resolve', '--json', '--repo', repo, '--home', HOME], { encoding: 'utf8' });
  } catch (e) { code = e.status; body = String(e.stdout || ''); }
  const out = JSON.parse(body);
  ok('LC-6 CLI refusal exits 1', code === 1);
  ok('LC-6 CLI refusal envelope', out.ok === false && out.refusals.some((x) => x.code === 'config_missing'));
  fs.rmSync(repo, { recursive: true, force: true });
}
{
  let code = 0, body = '';
  try {
    execFileSync(process.execPath, [CLI, 'resolve'], { encoding: 'utf8' });
  } catch (e) { code = e.status; body = String(e.stdout || ''); }
  ok('LC-6 CLI requires --json (usage exit 2)', code === 2 && /json/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
