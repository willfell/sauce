#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  auditEpicProject,
  commandReconcile,
  moveBoardCard,
  projectCard,
} = require('../../scripts/autoloop/codex-coordinator');
const {
  auditDelivery,
  backupProjectionFiles,
  repairAudit,
} = require('../../scripts/autoloop/audit-delivery');

let count = 0;
function ok(value, label) { assert.ok(value, label); count += 1; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); count += 1; }

function treeSnapshot(root) {
  const snapshot = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      const relative = path.relative(root, target);
      if (entry.isDirectory()) {
        snapshot[`${relative}/`] = 'directory';
        walk(target);
      } else if (entry.isFile()) {
        snapshot[relative] = fs.readFileSync(target).toString('base64');
      } else {
        snapshot[relative] = `other:${fs.lstatSync(target).mode}`;
      }
    }
  };
  walk(root);
  return snapshot;
}

function board(columns, frontmatter = '') {
  return [
    ...(frontmatter ? ['---', frontmatter, '---', ''] : []),
    '## In Planning',
    ...(columns['In Planning'] || []).map((card) => `- [ ] [[${card}]]`),
    '',
    '## In Progress',
    ...(columns['In Progress'] || []).map((card) => `- [ ] [[${card}]]`),
    '',
    '## Blocked',
    ...(columns.Blocked || []).map((card) => `- [ ] [[${card}]]`),
    '',
    '## Completed',
    ...(columns.Completed || []).map((card) => `- [x] [[${card}]]`),
    '',
  ].join('\n');
}

function writeEpic(projectRoot, epic, slices, {
  state = 'planned',
  posture = 'claimable',
  boardRole = 'epic',
  atlasBacklink = null,
  sliceOverrides = {},
} = {}) {
  const projectPrefix = `spice/projects/${path.basename(projectRoot)}`;
  const cardsRoot = path.join(projectRoot, 'tasks');
  const epicRoot = path.join(cardsRoot, epic);
  const boardDir = path.join(epicRoot, 'board');
  const boardPath = path.join(boardDir, `${epic}-board.md`);
  const atlasPath = path.join(epicRoot, `${epic}.md`);
  fs.mkdirSync(path.join(epicRoot, 'context', 'runs'), { recursive: true });
  fs.mkdirSync(boardDir, { recursive: true });
  const columns = { 'In Planning': [], 'In Progress': [], Blocked: [], Completed: [] };
  for (const slice of slices) {
    columns[slice.column].push(slice.card);
    const override = sliceOverrides[slice.card] || {};
    const sourceBoard = override.source_board
      || `${projectPrefix}/tasks/${epic}/board/${epic}-board.md`;
    const sliceRaw = [
      '---',
      'type: slice',
      `card: ${slice.card}`,
      `epic: "[[${override.epic || epic}]]"`,
      `task_parent: ${projectPrefix}/tasks/${epic}/${epic}.md`,
      `source_board: ${sourceBoard}`,
      `kanban_board: ${override.kanban_board || sourceBoard}`,
      `status: ${override.status || slice.status}`,
      'depends_on: []',
      '---',
      '',
      `# ${slice.card}`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(boardDir, `${slice.card}.md`), sliceRaw);
  }
  fs.writeFileSync(boardPath, board(columns, `board_role: ${boardRole}`));
  fs.writeFileSync(atlasPath, [
    '---',
    'type: epic',
    `epic: ${epic}`,
    `source_board: ${projectPrefix}/${path.basename(projectRoot)}-board.md`,
    `kanban_board: ${projectPrefix}/${path.basename(projectRoot)}-board.md`,
    `epic_board: ${atlasBacklink || `${projectPrefix}/tasks/${epic}/board/${epic}-board.md`}`,
    `status: ${state}`,
    `posture: ${posture}`,
    '---',
    '',
    `# ${epic}`,
    '',
  ].join('\n'));
  return { epicRoot, boardDir, boardPath, atlasPath };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-audit-delivery-'));
  const projectRoot = path.join(root, 'spice', 'projects', 'demo');
  const cardsRoot = path.join(projectRoot, 'tasks');
  const boardPath = path.join(projectRoot, 'demo-board.md');
  fs.mkdirSync(cardsRoot, { recursive: true });
  const alpha = writeEpic(projectRoot, 'Epic Alpha', [{
    card: 'Alpha 1', column: 'In Progress', status: 'in_progress',
  }], { state: 'active', posture: 'claimable' });
  const beta = writeEpic(projectRoot, 'Epic Beta', [{
    card: 'Beta 1', column: 'In Planning', status: 'planning',
  }]);
  fs.writeFileSync(boardPath, board({
    'In Planning': ['Epic Beta', 'Planning peer'],
    'In Progress': ['Epic Alpha'],
    Blocked: [],
    Completed: [],
  }));
  const state = {
    schema_version: 1,
    cards: {
      'Alpha 1': {
        card: 'Alpha 1',
        phase: 'implementing',
        card_path: path.join(alpha.boardDir, 'Alpha 1.md'),
        dependencies: [],
      },
    },
  };
  const statePath = path.join(root, 'state.json');
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return {
    root, projectRoot, cardsRoot, boardPath, statePath, state, alpha, beta,
    alphaCard: path.join(alpha.boardDir, 'Alpha 1.md'),
  };
}

function auditFx(fx) {
  return auditDelivery({
    boardPath: fx.boardPath,
    cardsRoot: fx.cardsRoot,
    statePath: fx.statePath,
  });
}

function reconcileFx(fx, card) {
  return commandReconcile(
    { root: fx.root },
    { card },
    {
      readState: () => fx.state,
      writeState: () => {},
      boardPath: fx.boardPath,
      cardsRoot: fx.cardsRoot,
      withLock: async (_ctx, _name, operation) => operation(),
    },
  );
}

(async () => {
  const clean = fixture();
  const cleanReport = auditFx(clean);
  ok(cleanReport.clean, 'ES4B-AUDIT-CANONICAL-SEED canonical epic fixture passes vault-wide audit');
  eq(cleanReport.epic_count, 2, 'canonical audit enumerates both epics across active and planning columns');
  eq(cleanReport.slice_count, 2, 'canonical audit enumerates every slice');
  eq(cleanReport.repair_routes, [], 'clean audit emits no reconcile routes');

  const readOnlyDefault = fixture();
  fs.writeFileSync(readOnlyDefault.boardPath,
    fs.readFileSync(readOnlyDefault.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  const readOnlyBefore = treeSnapshot(readOnlyDefault.root);
  const readOnlyResult = spawnSync(process.execPath, [
    path.join(__dirname, '../../scripts/autoloop/audit-delivery.js'),
    '--board', readOnlyDefault.boardPath,
    '--cards-root', readOnlyDefault.cardsRoot,
    '--state', readOnlyDefault.statePath,
    '--json',
  ], { encoding: 'utf8' });
  eq(readOnlyResult.status, 2,
    'default CLI reports detected drift without entering repair mode');
  ok(JSON.parse(readOnlyResult.stdout).findings
    .some((finding) => finding.code === 'resolver-duplicate-parent-membership'),
  'default CLI emits the duplicate-parent finding');
  eq(treeSnapshot(readOnlyDefault.root), readOnlyBefore,
    'ES4BA-READ-ONLY-DEFAULT default vault-wide audit leaves every fixture byte unchanged');

  const duplicateParent = fixture();
  fs.writeFileSync(duplicateParent.boardPath,
    fs.readFileSync(duplicateParent.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  const duplicateParentReport = auditFx(duplicateParent);
  const duplicateParentFinding = duplicateParentReport.findings
    .find((finding) => finding.code === 'resolver-duplicate-parent-membership');
  ok(!duplicateParentReport.clean && duplicateParentFinding,
    'ES4B-PARENT-EPIC-DUPLICATE-MEMBERSHIP-UNDETECTED duplicate parent membership fails the audit');
  eq(duplicateParentFinding.reconcile, "reconcile --card 'Alpha 1'",
    'duplicate parent membership carries the exact-card reconciliation route');
  eq(duplicateParentReport.epic_count, 2,
    'duplicate parent membership never double-counts the canonical epic');
  const duplicateMutationPaths = [
    duplicateParent.boardPath,
    duplicateParent.alpha.atlasPath,
    duplicateParent.alpha.boardPath,
    duplicateParent.alphaCard,
  ].map((target) => path.resolve(target));
  eq(duplicateParentFinding.backup_paths, duplicateMutationPaths,
    'ES4B-DUPLICATE-REPAIR-SLICE-BACKUP-OMITTED exact manifest covers every route-mutated projection surface');
  const duplicateOriginalBytes = new Map(duplicateMutationPaths.map((target) => [
    target,
    fs.readFileSync(target),
  ]));
  let duplicateReconcileCalls = 0;
  const duplicateBackupRoot = path.join(
    duplicateParent.projectRoot,
    '.sauce-backup',
    'duplicate-parent-test',
  );
  const duplicateRepair = await repairAudit(duplicateParentReport, {
    projectRoot: duplicateParent.projectRoot,
    backupRoot: duplicateBackupRoot,
    reconcile: async (card) => {
      duplicateReconcileCalls += 1;
      ok(fs.existsSync(duplicateBackupRoot)
          && fs.readdirSync(duplicateBackupRoot, { recursive: true }).length > 0,
      'duplicate-parent reconciliation starts only after durable projection backups exist');
      ok(duplicateMutationPaths.every((source) => {
        const digest = crypto.createHash('sha256').update(duplicateOriginalBytes.get(source)).digest('hex');
        const backup = path.join(
          duplicateBackupRoot,
          `${path.relative(duplicateParent.projectRoot, source)}.${digest.slice(0, 16)}.bak`,
        );
        return fs.existsSync(backup)
          && fs.readFileSync(backup).equals(duplicateOriginalBytes.get(source));
      }), 'duplicate-parent exact manifest is durably materialized before the first reconciliation write');
      const result = await commandReconcile(
        { root: duplicateParent.root },
        { card },
        {
          readState: () => duplicateParent.state,
          writeState: () => {},
          boardPath: duplicateParent.boardPath,
          cardsRoot: duplicateParent.cardsRoot,
          withLock: async (_ctx, _name, operation) => operation(),
          now: () => '2026-07-25T02:30:00.000Z',
        },
      );
      ok(result.action === 'reconciled' && result.failed === 0,
        'duplicate-parent exact-card route executes successfully through coordinator reconciliation');
    },
    reaudit: async () => auditFx(duplicateParent),
  });
  eq(duplicateReconcileCalls, 1,
    'duplicate-parent repair invokes exactly one coordinator-owned exact-card route');
  ok(!duplicateRepair.no_op && duplicateRepair.report.clean,
    'ES4B-DUPLICATE-PARENT-RECONCILE-NONCONVERGENT exact-card repair converges on clean re-audit');
  eq((fs.readFileSync(duplicateParent.boardPath, 'utf8').match(/\[\[Epic Alpha\]\]/g) || []).length, 1,
    'duplicate-parent repair retains exactly one authoritative parent projection');

  const siblingMisboundRoute = fixture();
  siblingMisboundRoute.alpha = writeEpic(siblingMisboundRoute.projectRoot, 'Epic Alpha', [{
    card: 'Alpha 1', column: 'In Progress', status: 'in_progress',
  }, {
    card: 'Alpha 2', column: 'In Planning', status: 'planning',
  }], { state: 'active', posture: 'claimable' });
  siblingMisboundRoute.alphaCard = path.join(siblingMisboundRoute.alpha.boardDir, 'Alpha 1.md');
  siblingMisboundRoute.state.cards['Alpha 1'].card_path = path.join(
    siblingMisboundRoute.alpha.boardDir,
    'Alpha 2.md',
  );
  fs.writeFileSync(
    siblingMisboundRoute.statePath,
    `${JSON.stringify(siblingMisboundRoute.state, null, 2)}\n`,
  );
  fs.writeFileSync(siblingMisboundRoute.boardPath,
    fs.readFileSync(siblingMisboundRoute.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  const siblingMisboundReport = auditFx(siblingMisboundRoute);
  const siblingMisboundFinding = siblingMisboundReport.findings
    .find((finding) => finding.code === 'resolver-duplicate-parent-membership');
  ok(siblingMisboundFinding,
    'ES4B-DUPLICATE-REPAIR-TRACKED-CARD-PATH-REFERENTIAL-ROUTE-UNEXECUTABLE keeps the duplicate visible');
  ok(siblingMisboundFinding.owner === 'semantic'
      && !siblingMisboundFinding.repairable
      && !siblingMisboundFinding.reconcile
      && siblingMisboundFinding.backup_paths.length === 0,
  'sibling-misbound ledger card_path advertises no route and no backup transaction');
  const refusedSiblingMisboundRoute = await reconcileFx(siblingMisboundRoute, 'Alpha 1');
  eq(refusedSiblingMisboundRoute.action, 'reconcile-failed',
    'strict exact-card reconciliation rejects a ledger card_path bound to its sibling note');
  let siblingMisboundReconcileCalls = 0;
  const siblingMisboundBackupRoot = path.join(
    siblingMisboundRoute.projectRoot,
    '.sauce-backup',
    'sibling-misbound-route-test',
  );
  const siblingMisboundRepair = await repairAudit(siblingMisboundReport, {
    projectRoot: siblingMisboundRoute.projectRoot,
    backupRoot: siblingMisboundBackupRoot,
    reconcile: async () => { siblingMisboundReconcileCalls += 1; },
    reaudit: async () => auditFx(siblingMisboundRoute),
  });
  ok(siblingMisboundRepair.no_op
      && siblingMisboundRepair.backups.length === 0
      && siblingMisboundReconcileCalls === 0
      && !fs.existsSync(siblingMisboundBackupRoot),
  'sibling-misbound route refusal performs zero backup writes and zero reconciliation calls');

  const compoundResolver = fixture();
  fs.writeFileSync(compoundResolver.boardPath,
    fs.readFileSync(compoundResolver.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  fs.writeFileSync(compoundResolver.alpha.atlasPath,
    fs.readFileSync(compoundResolver.alpha.atlasPath, 'utf8')
      .replace('tasks/Epic Alpha/board/Epic Alpha-board.md', 'tasks/Epic Alpha/board/wrong.md'));
  const compoundReport = auditFx(compoundResolver);
  const compoundDuplicate = compoundReport.findings
    .find((finding) => finding.code === 'resolver-duplicate-parent-membership');
  const compoundAtlas = compoundReport.findings
    .find((finding) => finding.code === 'resolver-epic-atlas-mismatch');
  ok(compoundDuplicate && compoundAtlas,
    'ES4B-DUPLICATE-REPAIR-COMPOUND-REFERENTIAL-ROUTE-UNEXECUTABLE reports both compound resolver findings');
  const refusedCompoundRoute = await reconcileFx(compoundResolver, 'Alpha 1');
  eq(refusedCompoundRoute.action, 'reconcile-failed',
    'compound duplicate-plus-atlas-mismatch candidate route is unexecutable under strict reconciliation');
  ok([compoundDuplicate, compoundAtlas].every((finding) => finding.owner === 'semantic'
      && !finding.repairable
      && !finding.reconcile
      && finding.backup_paths.length === 0),
  'compound resolver findings stay visible but advertise no route or backup transaction');
  let compoundReconcileCalls = 0;
  const compoundBackupRoot = path.join(
    compoundResolver.projectRoot,
    '.sauce-backup',
    'compound-resolver-test',
  );
  const compoundRepair = await repairAudit(compoundReport, {
    projectRoot: compoundResolver.projectRoot,
    backupRoot: compoundBackupRoot,
    reconcile: async () => { compoundReconcileCalls += 1; },
    reaudit: async () => auditFx(compoundResolver),
  });
  ok(compoundRepair.no_op
      && compoundRepair.backups.length === 0
      && compoundReconcileCalls === 0
      && !fs.existsSync(compoundBackupRoot),
  'compound resolver refusal performs zero backup writes and zero reconciliation calls');

  const compoundSliceTopology = fixture();
  fs.writeFileSync(compoundSliceTopology.boardPath,
    fs.readFileSync(compoundSliceTopology.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  fs.writeFileSync(compoundSliceTopology.alphaCard,
    fs.readFileSync(compoundSliceTopology.alphaCard, 'utf8')
      .replace('epic: "[[Epic Alpha]]"', 'epic: "[[Epic Wrong]]"'));
  const compoundSliceReport = auditFx(compoundSliceTopology);
  const compoundSliceDuplicate = compoundSliceReport.findings
    .find((finding) => finding.code === 'resolver-duplicate-parent-membership');
  const compoundSliceReferential = compoundSliceReport.findings
    .find((finding) => finding.code === 'epic-referential-invalid');
  ok(compoundSliceDuplicate && compoundSliceReferential,
    'ES4B-DUPLICATE-REPAIR-COMPOUND-SLICE-REFERENTIAL-ROUTE-UNEXECUTABLE reports both structural layers');
  const refusedCompoundSliceRoute = await reconcileFx(compoundSliceTopology, 'Alpha 1');
  eq(refusedCompoundSliceRoute.action, 'reconcile-failed',
    'compound duplicate-plus-slice-backlink candidate route is unexecutable under strict reconciliation');
  ok([compoundSliceDuplicate, compoundSliceReferential].every((finding) => finding.owner === 'semantic'
      && !finding.repairable
      && !finding.reconcile
      && finding.backup_paths.length === 0),
  'compound slice-topology findings stay visible but advertise no route or backup transaction');
  let compoundSliceReconcileCalls = 0;
  const compoundSliceBackupRoot = path.join(
    compoundSliceTopology.projectRoot,
    '.sauce-backup',
    'compound-slice-topology-test',
  );
  const compoundSliceRepair = await repairAudit(compoundSliceReport, {
    projectRoot: compoundSliceTopology.projectRoot,
    backupRoot: compoundSliceBackupRoot,
    reconcile: async () => { compoundSliceReconcileCalls += 1; },
    reaudit: async () => auditFx(compoundSliceTopology),
  });
  ok(compoundSliceRepair.no_op
      && compoundSliceRepair.backups.length === 0
      && compoundSliceReconcileCalls === 0
      && !fs.existsSync(compoundSliceBackupRoot),
  'compound slice-topology refusal performs zero backup writes and zero reconciliation calls');

  const backupRootEscape = fixture();
  fs.writeFileSync(backupRootEscape.boardPath,
    fs.readFileSync(backupRootEscape.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  const backupRootEscapeReport = auditFx(backupRootEscape);
  const outsideBackupRoot = path.join(backupRootEscape.root, 'outside-backup-root');
  fs.mkdirSync(outsideBackupRoot);
  fs.symlinkSync(
    outsideBackupRoot,
    path.join(backupRootEscape.projectRoot, '.sauce-backup'),
    'dir',
  );
  let backupRootEscapeReconcileCalls = 0;
  await assert.rejects(
    repairAudit(backupRootEscapeReport, {
      projectRoot: backupRootEscape.projectRoot,
      reconcile: async () => { backupRootEscapeReconcileCalls += 1; },
      reaudit: async () => auditFx(backupRootEscape),
    }),
    /backup root escapes the project physically/,
  );
  ok(!fs.existsSync(path.join(outsideBackupRoot, 'audit-delivery')),
    'ES4B-BACKUP-ROOT-SYMLINK-FIRST-WRITE-ESCAPE rejects a symlinked backup root before creating an outside directory');
  eq(backupRootEscapeReconcileCalls, 0,
    'symlinked backup-root refusal occurs before coordinator reconciliation');

  const nestedBackupEscape = fixture();
  fs.writeFileSync(nestedBackupEscape.boardPath,
    fs.readFileSync(nestedBackupEscape.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  const nestedBackupEscapeReport = auditFx(nestedBackupEscape);
  const nestedBackupRoot = path.join(
    nestedBackupEscape.projectRoot,
    '.sauce-backup',
    'audit-delivery',
  );
  const outsideNestedParent = path.join(nestedBackupEscape.root, 'outside-nested-parent');
  fs.mkdirSync(nestedBackupRoot, { recursive: true });
  fs.mkdirSync(outsideNestedParent);
  fs.symlinkSync(outsideNestedParent, path.join(nestedBackupRoot, 'tasks'), 'dir');
  let nestedBackupEscapeReconcileCalls = 0;
  await assert.rejects(
    repairAudit(nestedBackupEscapeReport, {
      projectRoot: nestedBackupEscape.projectRoot,
      reconcile: async () => { nestedBackupEscapeReconcileCalls += 1; },
      reaudit: async () => auditFx(nestedBackupEscape),
    }),
    /backup parent escapes physically/,
  );
  eq(fs.readdirSync(outsideNestedParent), [],
    'nested backup-parent symlink is refused before any outside file or directory is created');
  eq(nestedBackupEscapeReconcileCalls, 0,
    'nested backup-parent refusal occurs before coordinator reconciliation');
  assert.throws(
    () => backupProjectionFiles([nestedBackupEscape.alphaCard], {
      projectRoot: nestedBackupEscape.projectRoot,
      backupRoot: nestedBackupRoot,
    }),
    /backup parent escapes physically/,
  );
  eq(fs.readdirSync(outsideNestedParent), [],
    'direct backup helper also leaves a symlinked nested destination outside tree untouched');

  const done = fixture();
  done.state.cards['Alpha 1'].phase = 'deployed';
  done.state.cards['Alpha 1'].vault_receipts = {
    headspace: { ok: true },
    accuris: { ok: true },
    ero: { ok: true },
  };
  fs.writeFileSync(done.statePath, `${JSON.stringify(done.state, null, 2)}\n`);
  fs.writeFileSync(done.alpha.boardPath,
    moveBoardCard(fs.readFileSync(done.alpha.boardPath, 'utf8'), 'Alpha 1', 'Completed', true));
  fs.writeFileSync(done.alphaCard,
    fs.readFileSync(done.alphaCard, 'utf8').replace('status: in_progress', 'status: completed'));
  fs.writeFileSync(done.boardPath,
    moveBoardCard(fs.readFileSync(done.boardPath, 'utf8'), 'Epic Alpha', 'Completed', true));
  fs.writeFileSync(done.alpha.atlasPath,
    fs.readFileSync(done.alpha.atlasPath, 'utf8')
      .replace('status: active', 'status: done')
      .replace('posture: claimable', 'posture: done'));
  ok(auditFx(done).clean,
    'ES4B-RECEIPT-DERIVED-DONE successful three-vault receipts canonically derive a completed epic');

  const partialReceipts = fixture();
  partialReceipts.state.cards['Alpha 1'].phase = 'deployed';
  partialReceipts.state.cards['Alpha 1'].vault_receipts = {
    headspace: { ok: true },
    accuris: { ok: true },
  };
  fs.writeFileSync(partialReceipts.statePath, `${JSON.stringify(partialReceipts.state, null, 2)}\n`);
  const partialReceiptReport = auditFx(partialReceipts);
  const partialReceiptFinding = partialReceiptReport.findings
    .find((finding) => finding.code === 'legacy-completion-no-receipt');
  ok(partialReceiptFinding
      && partialReceiptFinding.card === 'Alpha 1'
      && !partialReceiptFinding.repairable,
  'ES4BA-PARTIAL-RECEIPTS-NOT-DONE incomplete three-vault proof remains a bounded finding');
  eq(partialReceiptFinding.reconcile, "reconcile --card 'Alpha 1'",
    'partial deployment proof retains its exact-card diagnostic route');
  ok(!partialReceiptReport.findings.some((finding) => finding.code === 'epic-rollup-drift'),
    'partial vault receipts leave the otherwise-active epic projecting normally');

  const legacy = fixture();
  delete legacy.state.cards['Alpha 1'];
  fs.writeFileSync(legacy.statePath, `${JSON.stringify(legacy.state, null, 2)}\n`);
  fs.writeFileSync(legacy.alphaCard,
    fs.readFileSync(legacy.alphaCard, 'utf8').replace('status: in_progress', 'status: completed'));
  const legacyReport = auditFx(legacy);
  const legacyFinding = legacyReport.findings.find((finding) => finding.code === 'legacy-completion-no-receipt');
  ok(legacyFinding && !legacyFinding.repairable,
    'ES4B-LEGACY-COMPLETION-GRACEFUL receiptless completed note is a bounded finding, never done or a crash');
  eq(legacyFinding.reconcile, "reconcile --card 'Alpha 1'",
    'legacy completion finding carries the exact-card reconciliation route');
  ok(!legacyReport.findings.some((finding) => finding.code === 'epic-rollup-drift'),
    'legacy completion leaves the otherwise-active epic projecting normally');

  const parentDrift = fixture();
  let parentRaw = fs.readFileSync(parentDrift.boardPath, 'utf8');
  parentRaw = moveBoardCard(parentRaw, 'Epic Alpha', 'Completed', true);
  fs.writeFileSync(parentDrift.boardPath, parentRaw);
  let atlasRaw = fs.readFileSync(parentDrift.alpha.atlasPath, 'utf8')
    .replace('status: active', 'status: done')
    .replace('posture: claimable', 'posture: done');
  fs.writeFileSync(parentDrift.alpha.atlasPath, atlasRaw);
  const parentReport = auditFx(parentDrift);
  const rollup = parentReport.findings.find((finding) => finding.code === 'epic-rollup-drift');
  ok(rollup, 'ES4B-EPIC-COLUMN-ATLAS-ROLLUP-DRIFT detects parent-column and atlas projection drift');
  eq(rollup.expected_column, 'In Progress', 'epic drift derives active column from slice truth');
  eq(rollup.expected_status, 'active', 'epic drift derives atlas status from Delivery');
  eq(rollup.reconcile, "reconcile --card 'Alpha 1'", 'owned epic drift emits an exact shell-safe reconcile route');

  const untrackedPlanning = fixture();
  fs.writeFileSync(untrackedPlanning.boardPath,
    moveBoardCard(fs.readFileSync(untrackedPlanning.boardPath, 'utf8'), 'Epic Beta', 'Completed', true));
  fs.writeFileSync(untrackedPlanning.beta.atlasPath,
    fs.readFileSync(untrackedPlanning.beta.atlasPath, 'utf8')
      .replace('status: planned', 'status: done')
      .replace('posture: claimable', 'posture: done'));
  const untrackedPlanningReport = auditFx(untrackedPlanning);
  const untrackedPlanningFinding = untrackedPlanningReport.findings
    .find((finding) => finding.code === 'epic-rollup-drift' && finding.epic === 'Epic Beta');
  const refusedUntrackedRoute = await commandReconcile(
    { root: untrackedPlanning.root },
    { card: 'Beta 1' },
    {
      readState: () => untrackedPlanning.state,
      writeState: () => {},
      boardPath: untrackedPlanning.boardPath,
      cardsRoot: untrackedPlanning.cardsRoot,
      withLock: async (_ctx, _name, operation) => operation(),
    },
  );
  eq(refusedUntrackedRoute.action, 'reconcile-failed',
    'ES4B-UNTRACKED-PLANNING-ROLLUP-RECONCILE-ROUTE-UNEXECUTABLE proves the coordinator refuses the candidate route');
  ok(untrackedPlanningFinding
      && untrackedPlanningFinding.owner === 'semantic'
      && !untrackedPlanningFinding.repairable
      && !untrackedPlanningFinding.reconcile,
  'untracked planning roll-up drift remains report-only and never emits an unexecutable repair route');
  let untrackedRepairCalls = 0;
  const untrackedRepair = await repairAudit(untrackedPlanningReport, {
    projectRoot: untrackedPlanning.projectRoot,
    reconcile: async () => { untrackedRepairCalls += 1; },
    reaudit: async () => auditFx(untrackedPlanning),
  });
  ok(untrackedRepair.no_op && untrackedRepairCalls === 0,
    'repair routing never invokes coordinator reconciliation for an unowned planning lifecycle');

  const sliceDrift = fixture();
  const badSliceBoard = moveBoardCard(
    fs.readFileSync(sliceDrift.alpha.boardPath, 'utf8'),
    'Alpha 1',
    'Completed',
    true,
  );
  fs.writeFileSync(sliceDrift.alpha.boardPath, badSliceBoard);
  const sliceReport = auditFx(sliceDrift);
  const sliceFinding = sliceReport.findings.find((finding) => finding.code === 'slice-projection-drift');
  ok(sliceFinding, 'ES4B-SLICE-LIFECYCLE-PROJECTION-DRIFT detects slice board drift');
  eq(sliceFinding.expected_column, 'In Progress', 'slice audit derives position from authoritative ledger phase');
  eq(sliceFinding.reconcile, "reconcile --card 'Alpha 1'", 'slice drift routes through exact-card reconciliation');

  const backlink = fixture();
  fs.writeFileSync(backlink.alpha.atlasPath,
    fs.readFileSync(backlink.alpha.atlasPath, 'utf8')
      .replace('tasks/Epic Alpha/board/Epic Alpha-board.md', 'tasks/Epic Alpha/board/wrong.md'));
  const backlinkReport = auditFx(backlink);
  const backlinkFinding = backlinkReport.findings
    .find((finding) => finding.code === 'resolver-epic-atlas-mismatch');
  ok(backlinkFinding,
    'ES4B-EPIC-BOARD-BACKLINK-REFERENTIAL reports an atlas backlink mismatch');
  const refusedBacklinkRoute = await reconcileFx(backlink, 'Alpha 1');
  eq(refusedBacklinkRoute.action, 'reconcile-failed',
    'ES4B-RESOLVER-REFERENTIAL-RECONCILE-ROUTE-UNEXECUTABLE proves strict reconciliation rejects an atlas-mismatch candidate route');
  ok(backlinkFinding.owner === 'semantic'
      && !backlinkFinding.repairable
      && !backlinkFinding.reconcile
      && backlinkFinding.backup_paths.length === 0,
  'atlas mismatch remains visible but never advertises the refused coordinator route');

  const sliceBacklink = fixture();
  fs.writeFileSync(sliceBacklink.alphaCard,
    fs.readFileSync(sliceBacklink.alphaCard, 'utf8').replace('epic: "[[Epic Alpha]]"', 'epic: "[[Epic Wrong]]"'));
  const sliceBacklinkReport = auditFx(sliceBacklink);
  const topologyFinding = sliceBacklinkReport.findings.find((finding) => finding.code === 'epic-referential-invalid');
  ok(topologyFinding, 'ES4B-SLICE-EPIC-BACKLINK-REFERENTIAL reports a mismatched slice epic backlink');
  const refusedTopologyRoute = await commandReconcile(
    { root: sliceBacklink.root },
    { card: 'Alpha 1' },
    {
      readState: () => sliceBacklink.state,
      writeState: () => {},
      boardPath: sliceBacklink.boardPath,
      cardsRoot: sliceBacklink.cardsRoot,
      withLock: async (_ctx, _name, operation) => operation(),
    },
  );
  eq(refusedTopologyRoute.action, 'reconcile-failed',
    'ES4B-REFERENTIAL-RECONCILE-ROUTE-UNEXECUTABLE proves strict topology rejects the candidate exact-card route');
  ok(topologyFinding.owner === 'semantic'
      && !topologyFinding.repairable
      && !topologyFinding.reconcile
      && topologyFinding.backup_paths.length === 0,
  'referential topology remains visible but never advertises the refused coordinator route');

  const roleless = fixture();
  fs.writeFileSync(roleless.alpha.boardPath,
    fs.readFileSync(roleless.alpha.boardPath, 'utf8').replace('board_role: epic', 'board_role: list'));
  const rolelessReport = auditFx(roleless);
  const rolelessFinding = rolelessReport.findings
    .find((finding) => finding.code === 'resolver-missing-epic-board' && finding.epic === 'Epic Alpha');
  ok(rolelessFinding,
    'ES4B-EPIC-BOARD-ROLE-REFERENTIAL reports a role-less epic board');
  const refusedRolelessRoute = await reconcileFx(roleless, 'Alpha 1');
  eq(refusedRolelessRoute.action, 'reconcile-failed',
    'ES4B-RESOLVER-REFERENTIAL-RECONCILE-ROUTE-UNEXECUTABLE proves strict reconciliation rejects a role-less-board candidate route');
  ok(rolelessFinding.owner === 'semantic'
      && !rolelessFinding.repairable
      && !rolelessFinding.reconcile
      && rolelessFinding.backup_paths.length === 0,
  'role-less board remains visible but never advertises the refused coordinator route');

  const orphan = fixture();
  writeEpic(orphan.projectRoot, 'Epic Orphan', [{
    card: 'Orphan 1', column: 'In Planning', status: 'planning',
  }]);
  const orphanReport = auditFx(orphan);
  const orphanFinding = orphanReport.findings.find((finding) => finding.code === 'orphan-epic-directory');
  ok(orphanFinding && orphanFinding.owner === 'semantic' && !orphanFinding.repairable,
    'ES4B-ORPHAN-EPIC-DIRECTORY reports an unowned semantic finding without inventing priority');

  const repair = fixture();
  fs.writeFileSync(repair.boardPath,
    moveBoardCard(fs.readFileSync(repair.boardPath, 'utf8'), 'Epic Alpha', 'Completed', true));
  fs.writeFileSync(repair.alpha.atlasPath,
    fs.readFileSync(repair.alpha.atlasPath, 'utf8')
      .replace('status: active', 'status: done')
      .replace('posture: claimable', 'posture: done'));
  const corruptBoardBytes = fs.readFileSync(repair.boardPath);
  const backupRoot = path.join(repair.projectRoot, '.sauce-backup', 'audit-delivery-test');
  let reconcileCalls = 0;
  const repaired = await repairAudit(auditFx(repair), {
    projectRoot: repair.projectRoot,
    backupRoot,
    reconcile: async (card) => {
      reconcileCalls += 1;
      ok(fs.existsSync(backupRoot) && fs.readdirSync(backupRoot, { recursive: true }).length > 0,
        'ES4B-BACKUP-FIRST backups exist before coordinator-owned reconciliation runs');
      projectCard(repair.alphaCard, repair.boardPath, card, 'implementing', {
        cardsRoot: repair.cardsRoot,
        state: repair.state,
        record: repair.state.cards[card],
        now: () => '2026-07-25T02:00:00.000Z',
      });
    },
    reaudit: async () => auditFx(repair),
  });
  eq(reconcileCalls, 1, 'repair deduplicates multiple owned drift findings to one exact-card reconcile');
  ok(!repaired.no_op && repaired.report.clean, 'ES4B-REPAIR-CONVERGES backup-first routed repair converges cleanly');
  ok(repaired.backups.some((item) => item.source === repair.boardPath
      && fs.readFileSync(item.backup).equals(corruptBoardBytes)),
  'ES4B-BACKUP-FIRST parent-board backup preserves exact pre-repair bytes');
  const repairedParent = fs.readFileSync(repair.boardPath, 'utf8');
  ok(repairedParent.indexOf('[[Epic Beta]]') < repairedParent.indexOf('[[Planning peer]]'),
    'ES4B-WITHIN-LANE-ORDER-PRESERVED repair retains operator order among untouched planning entries');
  const afterFirstRepair = [
    fs.readFileSync(repair.boardPath),
    fs.readFileSync(repair.alpha.boardPath),
    fs.readFileSync(repair.alpha.atlasPath),
    fs.readFileSync(repair.alphaCard),
  ];
  const replay = await repairAudit(auditFx(repair), {
    projectRoot: repair.projectRoot,
    backupRoot,
    reconcile: async () => { throw new Error('clean replay must not reconcile'); },
    reaudit: async () => auditFx(repair),
  });
  ok(replay.no_op && replay.repaired_cards.length === 0, 'ES4B-REPAIR-NO-OP unchanged second repair returns no_op:true');
  eq([
    fs.readFileSync(repair.boardPath),
    fs.readFileSync(repair.alpha.boardPath),
    fs.readFileSync(repair.alpha.atlasPath),
    fs.readFileSync(repair.alphaCard),
  ], afterFirstRepair, 'unchanged repair replay leaves every projection surface byte-stable');

  const cliRepair = fixture();
  fs.writeFileSync(cliRepair.boardPath,
    fs.readFileSync(cliRepair.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  const cliResult = spawnSync(process.execPath, [
    path.join(__dirname, '../../scripts/autoloop/audit-delivery.js'),
    '--board', cliRepair.boardPath,
    '--cards-root', cliRepair.cardsRoot,
    '--state', cliRepair.statePath,
    '--repair',
    '--json',
  ], { encoding: 'utf8' });
  eq(cliResult.status, 0,
    `ES4B-CLI-REPAIR-ROUTE-NONEXECUTING production --repair exits clean after coordinator reconciliation: ${cliResult.stderr}`);
  const cliReceipt = JSON.parse(cliResult.stdout);
  ok(!cliReceipt.no_op
      && cliReceipt.repaired_cards.join(',') === 'Alpha 1'
      && cliReceipt.backups.length === 4
      && cliReceipt.report.clean,
  'production --repair creates the complete backup set, executes the exact-card route, and converges');
  eq((fs.readFileSync(cliRepair.boardPath, 'utf8').match(/\[\[Epic Alpha\]\]/g) || []).length, 1,
    'production --repair removes duplicate parent membership through coordinator ownership');

  let structuralReconcileCalls = 0;
  const routedOnly = await repairAudit(sliceBacklinkReport, {
    projectRoot: sliceBacklink.projectRoot,
    reconcile: async () => { structuralReconcileCalls += 1; },
    reaudit: async () => auditFx(sliceBacklink),
  });
  ok(routedOnly.no_op && structuralReconcileCalls === 0
      && routedOnly.repair_routes.length === 0,
  'ES4B-COORDINATOR-OWNED-ROUTE structural note findings remain visible without an unexecutable route or audit-owned edit');
  ok(fs.readFileSync(sliceBacklink.alphaCard, 'utf8').includes('epic: "[[Epic Wrong]]"'),
    'audit repair never edits a coordinator-owned malformed slice');

  const direct = auditEpicProject({
    parentBoardPath: clean.boardPath,
    cardsRoot: clean.cardsRoot,
    state: clean.state,
  });
  ok(direct.clean, 'coordinator-exported vault audit and CLI wrapper share one canonical implementation');

  console.log(`PASS — audit-delivery (${count} assertions)`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
