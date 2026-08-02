#!/usr/bin/env node
/**
 * run-loop-plugin-surface — preflight harness for the loop plugin's Claude
 * surface: marketplace + plugin manifest validity, per-skill body gates
 * (frontmatter, dir/name match, trigger-style description), and the
 * portability gate (no machine-specific paths anywhere in the plugin).
 */
'use strict';
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');
const PLUGIN = path.join(REPO, 'plugins', 'loop');
const GEN = require(path.join(PLUGIN, 'scripts', 'gen-codex-routers.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

const EXPECTED_SKILLS = ['block-review', 'brainstorm', 'execute', 'init', 'intake', 'plan', 'review', 'run', 'status'];

// LP-1: marketplace manifest at repo root points at the plugin subdirectory.
{
  const mkt = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'));
  ok('LP-1 marketplace name', mkt.name === 'sauce');
  ok('LP-1 marketplace owner', mkt.owner && typeof mkt.owner.name === 'string');
  const entry = (mkt.plugins || []).find((p) => p.name === 'loop');
  ok('LP-1 loop plugin entry', !!entry);
  ok('LP-1 relative source', entry && entry.source === './plugins/loop');
  ok('LP-1 source dir exists', entry && fs.existsSync(path.join(REPO, entry.source.slice(2))));
  ok('LP-1 no marketplace version pin', !('version' in (entry || {})), 'plugin versions ride git SHAs — never hand-version');
}

// LP-2: plugin manifest.
{
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  ok('LP-2 plugin name', manifest.name === 'loop');
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
    ok(`LP-3 ${dir} slash surface documented`, new RegExp(`loop:${dir}`).test(body) || dir === 'intake' || dir === 'run', 'body should self-name its slash command');
  }
}

// LP-4: portability gate — nothing under plugins/loop/ may carry machine paths.
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
  for (const dir of ['plan', 'execute', 'run', 'intake']) {
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
  const run = fs.readFileSync(path.join(PLUGIN, 'skills', 'run', 'SKILL.md'), 'utf8');
  ok('LP-7 run documents the universal prompt', /Use \$loop-run --live\. Start NOW/.test(run));
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
  const brainstormBody = fs.readFileSync(path.join(PLUGIN, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  ok('LP-GRAPH status points at the Loop Station map',
    /graphview|loop station/i.test(statusBody) && /\bmap\b/i.test(statusBody),
    'status body must point at the Loop Station GraphView project-scope map');
  ok('LP-GRAPH plan reviews the minted atlas graph',
    /review the graph/i.test(planBody) && /graphview/i.test(planBody),
    'plan body must add a step to review the minted epic atlas GraphView graph');
  ok('LP-GRAPH brainstorm notes the live graph',
    /live graphview graph/i.test(brainstormBody),
    'brainstorm body must note the sketch renders as a live GraphView graph');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
