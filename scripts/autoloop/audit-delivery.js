#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, auditEpicProject } = require('./codex-coordinator');

const DEFAULT_PROJECT = path.join(os.homedir(), 'notes/sauce/headspace-sauce/spice/projects/sauce');
const DEFAULT_BOARD = path.join(DEFAULT_PROJECT, 'sauce-board.md');
const DEFAULT_CARDS = path.join(DEFAULT_PROJECT, 'tasks');

function readState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) return { schema_version: 1, cards: {} };
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!state || typeof state.cards !== 'object' || Array.isArray(state.cards)) {
    throw new Error(`invalid Delivery ledger at ${statePath}`);
  }
  return state;
}

function defaultStatePath(cwd = process.cwd()) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    return path.join(path.resolve(cwd, common), 'sauce-autoloop', 'state.json');
  } catch (_) {
    return null;
  }
}

function auditDelivery({
  boardPath = DEFAULT_BOARD,
  cardsRoot = DEFAULT_CARDS,
  statePath = defaultStatePath(),
  state = null,
} = {}) {
  const resolvedBoard = path.resolve(boardPath);
  const resolvedCards = path.resolve(cardsRoot);
  if (!fs.existsSync(resolvedBoard) || !fs.statSync(resolvedBoard).isFile()) {
    throw new Error(`Delivery parent board is missing: ${resolvedBoard}`);
  }
  if (!fs.existsSync(resolvedCards) || !fs.statSync(resolvedCards).isDirectory()) {
    throw new Error(`Delivery cards root is missing: ${resolvedCards}`);
  }
  const report = auditEpicProject({
    parentBoardPath: resolvedBoard,
    cardsRoot: resolvedCards,
    state: state || readState(statePath),
  });
  return {
    action: report.clean ? 'audit-clean' : 'audit-findings',
    board_path: resolvedBoard,
    cards_root: resolvedCards,
    state_path: statePath ? path.resolve(statePath) : null,
    ...report,
    repair_routes: [],
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const allowed = new Set(['_', 'board', 'cards-root', 'state', 'json']);
  const unsupported = Object.keys(args).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`audit-delivery refuses unsupported option --${unsupported}`);
  if (args._.length) throw new Error('audit-delivery refuses positional arguments');
  if (args.json != null && args.json !== true) throw new Error('--json takes no value');
  const singleton = (key, fallback) => {
    if (Array.isArray(args[key])) throw new Error(`--${key} may be supplied only once`);
    return args[key] === undefined ? fallback : String(args[key]);
  };
  const report = auditDelivery({
    boardPath: singleton('board', DEFAULT_BOARD),
    cardsRoot: singleton('cards-root', DEFAULT_CARDS),
    statePath: singleton('state', defaultStatePath()),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.clean) process.exitCode = 2;
}

module.exports = {
  auditDelivery,
  readState,
  defaultStatePath,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ action: 'error', message: error.message })}\n`);
    process.exit(1);
  });
}
