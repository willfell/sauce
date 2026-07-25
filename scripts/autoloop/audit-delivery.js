#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  parseArgs,
  auditEpicProject,
  commandReconcile,
  durablePathBarrier,
} = require('./codex-coordinator');

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
    repair_routes: [...new Set(report.findings.map((finding) => finding.reconcile).filter(Boolean))],
  };
}

function containedPath(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}

function assertPhysicalContainmentBeforeCreate({
  lexicalRoot,
  physicalRoot,
  target,
  errorMessage,
}) {
  const lexical = path.resolve(lexicalRoot);
  const candidate = path.resolve(target);
  if (!containedPath(lexical, candidate)) throw new Error(errorMessage);
  let ancestor = candidate;
  while (!lstatIfPresent(ancestor)) {
    if (ancestor === lexical) throw new Error(errorMessage);
    const parent = path.dirname(ancestor);
    if (parent === ancestor || !containedPath(lexical, parent)) throw new Error(errorMessage);
    ancestor = parent;
  }
  const physicalAncestor = fs.realpathSync(ancestor);
  const physicalCandidate = path.resolve(
    physicalAncestor,
    path.relative(ancestor, candidate),
  );
  if (!containedPath(physicalRoot, physicalCandidate)) throw new Error(errorMessage);
  return physicalCandidate;
}

function backupProjectionFiles(paths, {
  projectRoot,
  backupRoot = path.join(projectRoot, '.sauce-backup', 'audit-delivery'),
} = {}) {
  if (!projectRoot) throw new Error('backup-first repair requires projectRoot');
  const lexicalRoot = path.resolve(projectRoot);
  const root = fs.realpathSync(lexicalRoot);
  const destination = path.resolve(backupRoot);
  if (!containedPath(lexicalRoot, destination)) throw new Error('backup root escapes the project');
  assertPhysicalContainmentBeforeCreate({
    lexicalRoot,
    physicalRoot: root,
    target: destination,
    errorMessage: 'backup root escapes the project physically',
  });
  fs.mkdirSync(destination, { recursive: true });
  const physicalDestination = fs.realpathSync(destination);
  if (!containedPath(root, physicalDestination)) throw new Error('backup root escapes the project physically');
  const backups = [];
  for (const sourceValue of [...new Set((paths || []).map((item) => path.resolve(item)))]) {
    if (!containedPath(lexicalRoot, sourceValue)) throw new Error(`repair source escapes the project: ${sourceValue}`);
    const entry = fs.lstatSync(sourceValue);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`repair source must be one regular non-symlink file: ${sourceValue}`);
    }
    const physicalSource = fs.realpathSync(sourceValue);
    if (!containedPath(root, physicalSource)) throw new Error(`repair source escapes physically: ${sourceValue}`);
    const content = fs.readFileSync(sourceValue);
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    const relative = path.relative(lexicalRoot, sourceValue);
    const backupPath = path.join(destination, `${relative}.${digest.slice(0, 16)}.bak`);
    if (!containedPath(destination, backupPath)) throw new Error(`backup path escapes its root: ${backupPath}`);
    const backupParent = path.dirname(backupPath);
    assertPhysicalContainmentBeforeCreate({
      lexicalRoot: destination,
      physicalRoot: physicalDestination,
      target: backupParent,
      errorMessage: `backup parent escapes physically: ${backupPath}`,
    });
    fs.mkdirSync(backupParent, { recursive: true });
    if (!containedPath(physicalDestination, fs.realpathSync(backupParent))) {
      throw new Error(`backup parent escapes physically: ${backupPath}`);
    }
    const backupEntry = lstatIfPresent(backupPath);
    if (backupEntry) {
      if (backupEntry.isSymbolicLink() || !backupEntry.isFile()) {
        throw new Error(`existing backup must be one regular non-symlink file: ${backupPath}`);
      }
      const prior = fs.readFileSync(backupPath);
      if (!prior.equals(content)) throw new Error(`existing backup differs from source: ${backupPath}`);
    } else {
      fs.writeFileSync(backupPath, content, { flag: 'wx' });
      durablePathBarrier(backupPath);
    }
    backups.push({ source: sourceValue, backup: backupPath, sha256: digest });
  }
  return backups;
}

async function repairAudit(report, {
  reconcile,
  reaudit,
  projectRoot = path.dirname(report.board_path),
  backupRoot,
} = {}) {
  const routes = [...new Set((report.findings || []).map((finding) => finding.reconcile).filter(Boolean))];
  const repairable = (report.findings || []).filter((finding) => finding.repairable && finding.card);
  const cards = [...new Set(repairable.map((finding) => finding.card))];
  if (cards.length === 0 || typeof reconcile !== 'function') {
    return {
      action: routes.length ? 'reconcile-routes-emitted' : 'repair-clean',
      no_op: true,
      repair_routes: routes,
      repaired_cards: [],
      backups: [],
      report,
    };
  }
  if (typeof reaudit !== 'function') throw new Error('repair execution requires a reaudit function');
  const backupPaths = repairable.flatMap((finding) => finding.backup_paths || []);
  const backups = backupProjectionFiles(backupPaths, { projectRoot, backupRoot });
  const repairedCards = [];
  for (const card of cards) {
    await reconcile(card);
    repairedCards.push(card);
  }
  const next = await reaudit();
  return {
    action: 'repair-applied',
    no_op: false,
    repair_routes: routes,
    repaired_cards: repairedCards,
    backups,
    report: next,
  };
}

async function repairAuditThroughCoordinator(report) {
  if (!report.state_path) throw new Error('coordinator-owned repair requires a Delivery state path');
  const statePath = path.resolve(report.state_path);
  const ctx = {
    root: process.cwd(),
    commonDir: path.dirname(statePath),
    stateDir: path.dirname(statePath),
    statePath,
  };
  const auditOptions = {
    boardPath: report.board_path,
    cardsRoot: report.cards_root,
    statePath,
  };
  return repairAudit(report, {
    projectRoot: path.dirname(report.board_path),
    reconcile: async (card) => {
      const result = await commandReconcile(ctx, { card }, {
        boardPath: report.board_path,
        cardsRoot: report.cards_root,
      });
      if (result.failed || result.action !== 'reconciled') {
        const detail = result.results && result.results[0] && result.results[0].error;
        throw new Error(`coordinator reconciliation refused ${card}: ${detail || result.action}`);
      }
    },
    reaudit: async () => auditDelivery(auditOptions),
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const allowed = new Set(['_', 'board', 'cards-root', 'state', 'repair', 'json']);
  const unsupported = Object.keys(args).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`audit-delivery refuses unsupported option --${unsupported}`);
  if (args._.length) throw new Error('audit-delivery refuses positional arguments');
  if (args.repair != null && args.repair !== true) throw new Error('--repair takes no value');
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
  const result = args.repair ? await repairAuditThroughCoordinator(report) : report;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const finalReport = args.repair ? result.report : report;
  if (!finalReport.clean) process.exitCode = 2;
}

module.exports = {
  auditDelivery,
  backupProjectionFiles,
  repairAudit,
  repairAuditThroughCoordinator,
  readState,
  defaultStatePath,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ action: 'error', message: error.message })}\n`);
    process.exit(1);
  });
}
