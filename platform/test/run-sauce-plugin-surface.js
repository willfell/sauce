#!/usr/bin/env node
/**
 * run-sauce-plugin-surface — preflight harness for the loop plugin's Claude
 * surface: marketplace + plugin manifest validity, per-skill body gates
 * (frontmatter, dir/name match, trigger-style description), and the
 * portability gate (no machine-specific paths anywhere in the plugin).
 */
'use strict';
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const PLUGIN = path.join(REPO, 'plugins', 'sauce');
const GEN = require(path.join(PLUGIN, 'scripts', 'gen-codex-routers.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

const EXPECTED_SKILLS = ['block-review', 'execute', 'init', 'intake', 'loop', 'plan', 'propose', 'review', 'status'];

// LP-1: marketplace manifest at repo root points at the plugin subdirectory.
{
  const mkt = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'));
  ok('LP-1 marketplace name', mkt.name === 'sauce');
  ok('LP-1 marketplace owner', mkt.owner && typeof mkt.owner.name === 'string');
  const entry = (mkt.plugins || []).find((p) => p.name === 'sauce');
  ok('LP-1 loop plugin entry', !!entry);
  ok('LP-1 relative source', entry && entry.source === './plugins/sauce');
  ok('LP-1 source dir exists', entry && fs.existsSync(path.join(REPO, entry.source.slice(2))));
  ok('LP-1 no marketplace version pin', !('version' in (entry || {})), 'plugin versions ride git SHAs — never hand-version');
}

// LP-2: plugin manifest.
{
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  ok('LP-2 plugin name', manifest.name === 'sauce');
  ok('LP-2 kebab name', /^[a-z][a-z0-9-]*$/.test(manifest.name));
  ok('LP-2 description', typeof manifest.description === 'string' && manifest.description.length > 20);
  ok('LP-2 no version field', !('version' in manifest), 'git SHA is the version — never hand-version');
}

// LP-3: per-skill body gates.
{
  const dirs = fs.readdirSync(path.join(PLUGIN, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  ok('LP-3 exact skill set', JSON.stringify(dirs) === JSON.stringify(EXPECTED_SKILLS), JSON.stringify(dirs));
  for (const dir of dirs) {
    const body = fs.readFileSync(path.join(PLUGIN, 'skills', dir, 'SKILL.md'), 'utf8');
    const fm = GEN.parseFrontmatter(body);
    ok(`LP-3 ${dir} frontmatter`, fm && fm.name === dir && typeof fm.description === 'string' && fm.description.length > 40);
    ok(`LP-3 ${dir} trigger-style description`, fm && /Use when/.test(fm.description));
    ok(`LP-3 ${dir} slash surface documented`, new RegExp(`sauce:${dir}`).test(body) || dir === 'intake' || dir === 'loop', 'body should self-name its slash command');
  }
}

// LP-4: portability gate — nothing under plugins/sauce/ may carry machine paths.
{
  const offenders = [];
  const FORBIDDEN = [/\/Users\//, /notes\/sauce\//];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const content = fs.readFileSync(full, 'utf8');
        for (const rx of FORBIDDEN) if (rx.test(content)) offenders.push(`${path.relative(REPO, full)} (${rx})`);
      }
    }
  };
  walk(PLUGIN);
  ok('LP-4 no machine paths in plugin', offenders.length === 0, offenders.join(', '));
}

// LP-5: write-path skills honor observe_only; read-path skills bind first.
{
  for (const dir of ['plan', 'execute', 'loop', 'intake']) {
    const body = fs.readFileSync(path.join(PLUGIN, 'skills', dir, 'SKILL.md'), 'utf8');
    ok(`LP-5 ${dir} refuses observe_only`, /observe_only/.test(body));
  }
  for (const dir of EXPECTED_SKILLS.filter((d) => d !== 'init')) {
    const body = fs.readFileSync(path.join(PLUGIN, 'skills', dir, 'SKILL.md'), 'utf8');
    ok(`LP-5 ${dir} resolves binding`, /loop-config\.js.*resolve --json|loop-config\.js.*check --json/.test(body));
  }
}

// LP-7: universal-prompt contract — the drive skills encode scope + deploy
// posture themselves so the start prompt can be identical for every repo.
{
  const run = fs.readFileSync(path.join(PLUGIN, 'skills', 'loop', 'SKILL.md'), 'utf8');
  ok('LP-7 run documents the universal prompt', /Use \$sauce-loop --live\. Start NOW/.test(run));
  ok('LP-7 run honors run_scope', /run_scope/.test(run) && /`board` \(default\)/.test(run));
  ok('LP-7 run encodes merge-only posture', /deploy_vaults: \[\]/.test(run) && /never wait/.test(run));
  const execute = fs.readFileSync(path.join(PLUGIN, 'skills', 'execute', 'SKILL.md'), 'utf8');
  ok('LP-7 execute defaults to the board-order frontier', /board-order frontier/.test(execute) && /run_scope/.test(execute));
  ok('LP-7 execute encodes merge-only posture', /deploy_vaults: \[\]/.test(execute) && /never wait/.test(execute));
  const init = fs.readFileSync(path.join(PLUGIN, 'skills', 'init', 'SKILL.md'), 'utf8');
  ok('LP-7 init interviews run_scope', /run_scope/.test(init));
}

// LP-6: the workshop repo is itself bound (dogfood) with routers enabled.
{
  const cfgPath = path.join(REPO, '.loop', 'config.json');
  ok('LP-6 workshop .loop/config.json present', fs.existsSync(cfgPath));
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    ok('LP-6 workshop slug', cfg.project && cfg.project.slug === 'sauce');
    ok('LP-6 coupling invariant', path.posix.dirname(cfg.board.board_path) === cfg.board.project_root);
    ok('LP-6 routers enabled', cfg.codex && cfg.codex.routers === true);
  }
}

// LP-GRAPH: the loop skill surface teaches the GraphView graph — status points
// at the Loop Station project-scope map, plan reviews the minted atlas graph,
// brainstorm notes the sketch renders as a live graph. Behavioral: RED if any
// one of the three mentions is removed.
{
  const statusBody = fs.readFileSync(path.join(PLUGIN, 'skills', 'status', 'SKILL.md'), 'utf8');
  const planBody = fs.readFileSync(path.join(PLUGIN, 'skills', 'plan', 'SKILL.md'), 'utf8');
  const proposeBody = fs.readFileSync(path.join(PLUGIN, 'skills', 'propose', 'SKILL.md'), 'utf8');
  ok('LP-GRAPH status points at the Loop Station map',
    /graphview|loop station/i.test(statusBody) && /\bmap\b/i.test(statusBody),
    'status body must point at the Loop Station GraphView project-scope map');
  ok('LP-GRAPH plan reviews the minted atlas graph',
    /review the graph/i.test(planBody) && /graphview/i.test(planBody),
    'plan body must add a step to review the minted epic atlas GraphView graph');
  ok('LP-GRAPH propose notes the live graph',
    /live graphview graph/i.test(proposeBody),
    'propose body must note the sketch renders as a live GraphView graph');
}

// LP-CACHE: the Claude plugin cache holds only the plugin subtree, so the
// shim's in-tree require has nothing above it. Every skill's first step runs
// this shim; it must still reach a resolver, and fail with a receipt, not a
// stack trace, when none exists.
{
  const os = require('os');
  const { spawnSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-plugin-cache-'));
  const cachePlugin = path.join(tmp, 'cache', 'sauce', 'sauce', '0123456789ab');
  fs.cpSync(PLUGIN, cachePlugin, { recursive: true });
  const shim = path.join(cachePlugin, 'scripts', 'loop-config.js');

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-plugin-cache-repo-'));
  fs.mkdirSync(path.join(repo, '.loop'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.loop', 'config.json'), JSON.stringify({
    schema_version: '1.0.0',
    project: { slug: 'demo', name: 'Demo' },
    vault: { root: '~/vaults/demo-vault' },
    board: {
      project_root: 'spice/projects/demo',
      board_path: 'spice/projects/demo/demo-board.md',
      cards_root: 'spice/projects/demo/tasks',
    },
    coordinator: { resolve: 'path', path: '~/tools/coordinator.js' },
  }, null, 2));

  try {
  const noBrew = path.join(tmp, 'no-such-brew');
  const run = (extraEnv) => {
    const env = { ...process.env, SAUCE_BREW: noBrew, ...extraEnv };
    if (!extraEnv || !('SAUCE_LIBEXEC' in extraEnv)) delete env.SAUCE_LIBEXEC;
    const r = spawnSync(process.execPath, [shim, 'resolve', '--json', '--repo', repo, '--home', '/home/fixture'], {
      cwd: tmp, env, encoding: 'utf8',
    });
    let receipt = null;
    try { receipt = JSON.parse(r.stdout); } catch (_) { receipt = null; }
    return { status: r.status, receipt, stderr: r.stderr };
  };

  const none = run({});
  ok('LP-CACHE no resolver: exits 1 with a JSON receipt, not a stack trace',
    none.status === 1 && none.receipt && none.receipt.ok === false && !/Cannot find module/.test(none.stderr),
    `status=${none.status} stderr=${none.stderr.slice(0, 160)}`);
  ok('LP-CACHE no resolver: refusal code resolver_unavailable',
    !!(none.receipt && none.receipt.refusals && none.receipt.refusals[0].code === 'resolver_unavailable'));

  const viaEnv = run({ SAUCE_LIBEXEC: REPO });
  ok('LP-CACHE SAUCE_LIBEXEC override resolves the binding from the cache copy',
    viaEnv.status === 0 && viaEnv.receipt && viaEnv.receipt.ok === true
      && viaEnv.receipt.config.board_path_abs === '/home/fixture/vaults/demo-vault/spice/projects/demo/demo-board.md',
    `status=${viaEnv.status} stderr=${viaEnv.stderr.slice(0, 160)}`);

  const prefix = path.join(tmp, 'brew-prefix');
  fs.mkdirSync(prefix);
  fs.symlinkSync(REPO, path.join(prefix, 'libexec'));
  const fakeBrew = path.join(tmp, 'fake-brew');
  fs.writeFileSync(fakeBrew, `#!/bin/sh\n[ "$1" = "--prefix" ] && [ "$2" = "sauce" ] && echo "${prefix}" && exit 0\nexit 1\n`);
  fs.chmodSync(fakeBrew, 0o755);
  const viaBrew = run({ SAUCE_BREW: fakeBrew });
  ok('LP-CACHE brew --prefix sauce fallback resolves the binding from the cache copy',
    viaBrew.status === 0 && viaBrew.receipt && viaBrew.receipt.ok === true,
    `status=${viaBrew.status} stderr=${viaBrew.stderr.slice(0, 160)}`);

  const inTree = require(path.join(PLUGIN, 'scripts', 'loop-config.js'));
  ok('LP-CACHE in-tree shim still forwards the resolver exports',
    typeof inTree.resolveBinding === 'function' && typeof inTree.main === 'function');

  const marker = path.join(tmp, 'brew-was-called');
  const spyBrew = path.join(tmp, 'spy-brew');
  fs.writeFileSync(spyBrew, `#!/bin/sh\necho called > "${marker}"\nexit 1\n`);
  fs.chmodSync(spyBrew, 0o755);
  const inTreeRun = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'loop-config.js'), 'resolve', '--json', '--repo', repo, '--home', '/home/fixture'], {
    cwd: tmp, env: { ...process.env, SAUCE_BREW: spyBrew }, encoding: 'utf8',
  });
  ok('LP-CACHE in-tree shim resolves without spawning brew',
    inTreeRun.status === 0 && !fs.existsSync(marker),
    `status=${inTreeRun.status} brewCalled=${fs.existsSync(marker)}`);

  const missing = run({});
  ok('LP-CACHE no resolver: required exports still return the refusal',
    missing.status === 1 && (() => {
      const probe = spawnSync(process.execPath, ['-e',
        `const m = require(${JSON.stringify(shim)}); const r = m.resolveBinding('.'); process.stdout.write(JSON.stringify(r));`],
        { cwd: tmp, env: { ...process.env, SAUCE_BREW: noBrew, SAUCE_LIBEXEC: '' }, encoding: 'utf8' });
      try { const r = JSON.parse(probe.stdout); return r.ok === false && r.refusals[0].code === 'resolver_unavailable'; }
      catch (_) { return false; }
    })());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
