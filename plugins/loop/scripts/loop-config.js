#!/usr/bin/env node
/**
 * loop-config — the loop plugin's binding resolver.
 *
 * Reads the committed `.loop/config.json` at a repo root and resolves it into
 * absolute paths plus the env map that feeds the two existing portability
 * seams (DELIVERY_* for the delivery: family, SAUCE_LOOP_* for the
 * coordinator/batch-runner). Every plugin skill starts here; a repo without a
 * valid binding is refused loudly, never guessed.
 *
 * Self-contained on purpose: after marketplace install this file lives in the
 * plugin cache and cannot require() anything from the sauce repo. The receipt
 * envelope mirrors scripts/autoloop/cli-kit.js (action/ok/no_op + refusal
 * codes) without importing it.
 *
 * CLI:
 *   loop-config.js resolve --json [--repo <root>] [--home <home>]
 *   loop-config.js check   --json [--repo <root>] [--home <home>]
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CONFIG_RELPATH = path.join('.loop', 'config.json');
const SUPPORTED_SCHEMA_MAJOR = 1;
const EXIT_CODES = Object.freeze({ success: 0, refusal: 1, usage: 2 });

const REQUIRED_FIELDS = [
  ['schema_version', (c) => c.schema_version],
  ['project.slug', (c) => c.project && c.project.slug],
  ['vault.root', (c) => c.vault && c.vault.root],
  ['board.project_root', (c) => c.board && c.board.project_root],
  ['board.board_path', (c) => c.board && c.board.board_path],
  ['board.cards_root', (c) => c.board && c.board.cards_root],
];

function refusal(code, message, extra = {}) {
  return { code, message, ...extra };
}

function expandTilde(p, home) {
  if (typeof p !== 'string' || p.length === 0) return p;
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

function defaultBrewPrefix() {
  return execFileSync('brew', ['--prefix', 'sauce'], { encoding: 'utf8' }).trim();
}

function readRawConfig(repoRoot) {
  const configPath = path.join(repoRoot, CONFIG_RELPATH);
  if (!fs.existsSync(configPath)) {
    return { refusals: [refusal('config_missing', `no ${CONFIG_RELPATH} at ${repoRoot} — run /loop:init to bind this repo`)] };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return { refusals: [refusal('config_invalid_json', `${CONFIG_RELPATH} is not valid JSON: ${e.message}`)] };
  }
  return { raw, configPath };
}

function validateRaw(raw) {
  const refusals = [];
  for (const [name, get] of REQUIRED_FIELDS) {
    const value = get(raw);
    if (typeof value !== 'string' || value.length === 0) {
      refusals.push(refusal('config_missing_field', `required field ${name} is missing or not a string`));
    }
  }
  if (refusals.length) return refusals;

  const major = parseInt(String(raw.schema_version).split('.')[0], 10);
  if (!Number.isInteger(major) || major !== SUPPORTED_SCHEMA_MAJOR) {
    refusals.push(refusal('config_unsupported_schema', `schema_version ${raw.schema_version} is not supported (expected major ${SUPPORTED_SCHEMA_MAJOR})`));
  }

  const boardDir = path.posix.dirname(String(raw.board.board_path));
  const projectRoot = String(raw.board.project_root).replace(/\/+$/, '');
  if (boardDir !== projectRoot) {
    refusals.push(refusal('config_coupling_violation', `board.project_root (${projectRoot}) must equal dirname(board.board_path) (${boardDir}) — the intake coupling invariant`));
  }

  const coordinator = raw.coordinator || { resolve: 'brew' };
  if (!['brew', 'path'].includes(coordinator.resolve)) {
    refusals.push(refusal('config_bad_value', `coordinator.resolve must be "brew" or "path", got ${JSON.stringify(coordinator.resolve)}`));
  } else if (coordinator.resolve === 'path' && (typeof coordinator.path !== 'string' || !coordinator.path.length)) {
    refusals.push(refusal('config_bad_value', 'coordinator.resolve "path" requires coordinator.path'));
  }
  if (raw.policy && raw.policy.deploy_vaults) {
    const dv = raw.policy.deploy_vaults;
    const shapeOk = Array.isArray(dv) && dv.every((v) => v && typeof v.id === 'string' && typeof v.path === 'string');
    if (!shapeOk) refusals.push(refusal('config_bad_value', 'policy.deploy_vaults must be an array of {id, path}'));
  }
  if (raw.board.topology !== undefined && !['epic', 'flat'].includes(raw.board.topology)) {
    refusals.push(refusal('config_bad_value', `board.topology must be "epic" or "flat", got ${JSON.stringify(raw.board.topology)}`));
  }
  return refusals;
}

function resolveBinding(repoRoot, opts = {}) {
  const home = opts.home || os.homedir();
  const read = readRawConfig(repoRoot);
  if (read.refusals) return { ok: false, refusals: read.refusals };
  const raw = read.raw;
  const refusals = validateRaw(raw);
  if (refusals.length) return { ok: false, refusals };

  const vaultRoot = path.resolve(expandTilde(raw.vault.root, home));
  const boardPathAbs = path.join(vaultRoot, raw.board.board_path);
  const cardsRootAbs = path.join(vaultRoot, raw.board.cards_root);
  const projectRootAbs = path.join(vaultRoot, raw.board.project_root);

  const coordinatorSpec = raw.coordinator || { resolve: 'brew' };
  let coordinator = null;
  if (coordinatorSpec.resolve === 'path') {
    coordinator = path.resolve(expandTilde(coordinatorSpec.path, home));
  } else {
    const brewPrefix = opts.brewPrefix || defaultBrewPrefix;
    try {
      coordinator = path.join(brewPrefix(), 'libexec', 'scripts', 'autoloop', 'codex-coordinator.js');
    } catch (e) {
      return {
        ok: false,
        refusals: [refusal('coordinator_unresolved', `coordinator.resolve is "brew" but brew --prefix sauce failed (${e.message}) — install sauce via Homebrew or set coordinator.resolve to "path"`)],
      };
    }
  }

  const fidAbs = raw.fid ? path.resolve(expandTilde(raw.fid, home)) : null;

  const env = {
    DELIVERY_REPO_ROOT: repoRoot,
    DELIVERY_COORDINATOR: coordinator,
    DELIVERY_STATE: path.join(repoRoot, '.git', 'sauce-autoloop', 'state.json'),
    SAUCE_LOOP_BOARD: boardPathAbs,
    SAUCE_LOOP_CARDS_ROOT: cardsRootAbs,
    SAUCE_LOOP_BOARD_TOPOLOGY: raw.board.topology || 'epic',
  };
  if (fidAbs) env.DELIVERY_FID = fidAbs;
  const deployVaults = raw.policy && raw.policy.deploy_vaults;
  if (Array.isArray(deployVaults)) {
    // An EXPLICIT empty array is meaningful: SAUCE_LOOP_VAULTS=[] tells the
    // coordinator this binding is merge-only (no deploy chain). Absent field →
    // no env → the coordinator keeps its default vault list.
    env.SAUCE_LOOP_VAULTS = JSON.stringify(
      deployVaults.map((v) => ({ id: v.id, path: path.resolve(expandTilde(v.path, home)) })),
    );
  }

  return {
    ok: true,
    config: {
      schema_version: raw.schema_version,
      project_slug: raw.project.slug,
      project_name: (raw.project && raw.project.name) || raw.project.slug,
      repo_root: repoRoot,
      vault_root: vaultRoot,
      vault_mcp_server: (raw.vault && raw.vault.mcp_server) || null,
      board: { ...raw.board },
      board_topology: raw.board.topology || 'epic',
      project_root_abs: projectRootAbs,
      board_path_abs: boardPathAbs,
      cards_root_abs: cardsRootAbs,
      id_prefix: (raw.ids && raw.ids.default_prefix) || null,
      policy: raw.policy ? { ...raw.policy } : {},
      coordinator,
      fid_abs: fidAbs,
      codex: {
        routers: !!(raw.codex && raw.codex.routers),
        plugin_root: (raw.codex && raw.codex.plugin_root) ? path.resolve(expandTilde(raw.codex.plugin_root, home)) : null,
      },
      env,
    },
  };
}

function checkBinding(repoRoot, opts = {}) {
  const resolved = resolveBinding(repoRoot, opts);
  if (!resolved.ok) return resolved;
  const c = resolved.config;
  const refusals = [];
  if (!fs.existsSync(c.vault_root)) {
    refusals.push(refusal('vault_missing', `vault root does not exist: ${c.vault_root}`));
  } else {
    if (!fs.existsSync(c.board_path_abs)) {
      refusals.push(refusal('board_missing', `board file does not exist: ${c.board_path_abs}`));
    } else if (!/^## In Planning\s*$/m.test(fs.readFileSync(c.board_path_abs, 'utf8'))) {
      refusals.push(refusal('board_heading_missing', `board has no "## In Planning" lane: ${c.board_path_abs}`));
    }
    if (!fs.existsSync(c.cards_root_abs) || !fs.statSync(c.cards_root_abs).isDirectory()) {
      refusals.push(refusal('cards_root_missing', `cards root is not a directory: ${c.cards_root_abs}`));
    }
  }
  if (refusals.length) return { ok: false, refusals, config: c };
  return resolved;
}

function main(argv) {
  const verb = argv[0];
  const args = { _: [] };
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) { args[key] = value; i++; } else args[key] = true;
  }

  const action = `loop-config-${verb || 'resolve'}`;
  if (!['resolve', 'check'].includes(verb)) {
    process.stdout.write(JSON.stringify({ action, ok: false, no_op: false, code: 'usage', message: 'usage: loop-config.js <resolve|check> --json [--repo <root>] [--home <home>]' }) + '\n');
    process.exit(EXIT_CODES.usage);
  }
  if (args.json !== true) {
    process.stdout.write(JSON.stringify({ action, ok: false, no_op: false, code: 'json_required', message: `${verb} requires --json for a machine-readable receipt` }) + '\n');
    process.exit(EXIT_CODES.usage);
  }

  const repoRoot = path.resolve(args.repo || process.cwd());
  const opts = {};
  if (args.home) opts.home = args.home;
  const result = verb === 'check' ? checkBinding(repoRoot, opts) : resolveBinding(repoRoot, opts);
  if (!result.ok) {
    process.stdout.write(JSON.stringify({ action, ok: false, no_op: false, refusals: result.refusals }, null, 2) + '\n');
    process.exit(EXIT_CODES.refusal);
  }
  process.stdout.write(JSON.stringify({ action, ok: true, no_op: false, config: result.config }, null, 2) + '\n');
  process.exit(EXIT_CODES.success);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { resolveBinding, checkBinding, expandTilde, validateRaw, CONFIG_RELPATH, EXIT_CODES };
