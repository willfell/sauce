#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  auditEpicProject,
  moveBoardCard,
} = require('../../scripts/autoloop/codex-coordinator');
const { auditDelivery } = require('../../scripts/autoloop/audit-delivery');

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

function detectionOnly(report, label) {
  ok(report.findings.every((finding) => finding.repairable === false
    && !Object.prototype.hasOwnProperty.call(finding, 'reconcile')
    && Array.isArray(finding.backup_paths)
    && finding.backup_paths.length === 0), label);
  eq(report.repair_routes, [], `${label} exposes no repair routes`);
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

(async () => {
  const clean = fixture();
  const cleanReport = auditFx(clean);
  ok(cleanReport.clean, 'ES4B-AUDIT-CANONICAL-SEED canonical epic fixture passes vault-wide audit');
  eq(cleanReport.epic_count, 2, 'canonical audit enumerates both epics across active and planning columns');
  eq(cleanReport.slice_count, 2, 'canonical audit enumerates every slice');
  eq(cleanReport.repair_routes, [], 'clean audit emits no reconcile routes');

  const duplicateParent = fixture();
  fs.writeFileSync(duplicateParent.boardPath,
    fs.readFileSync(duplicateParent.boardPath, 'utf8')
      .replace('## Completed\n', '## Completed\n- [x] [[Epic Alpha]]\n'));
  const duplicateParentReport = auditFx(duplicateParent);
  const duplicateParentFinding = duplicateParentReport.findings
    .find((finding) => finding.code === 'resolver-duplicate-parent-membership');
  ok(!duplicateParentReport.clean && duplicateParentFinding,
    'ES4B-PARENT-EPIC-DUPLICATE-MEMBERSHIP-UNDETECTED duplicate parent membership fails the audit');
  eq(duplicateParentFinding.card, 'Alpha 1',
    'duplicate parent membership remains a bounded per-card finding');
  detectionOnly(duplicateParentReport,
    'ES4BA-DETECTION-ONLY duplicate parent audit remains semantic and side-effect-free');
  eq(duplicateParentReport.epic_count, 2,
    'duplicate parent membership never double-counts the canonical epic');

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
  ok(partialReceiptFinding && partialReceiptFinding.card === 'Alpha 1',
    'ES4BA-PARTIAL-RECEIPTS-NOT-DONE deployed phase with incomplete vault proof remains a bounded finding');
  ok(!partialReceiptReport.findings.some((finding) => finding.code === 'epic-rollup-drift'),
    'partial vault receipts leave the otherwise-active epic projecting normally');
  detectionOnly(partialReceiptReport,
    'ES4BA-PARTIAL-RECEIPTS-DETECTION-ONLY incomplete deployment proof advertises no repair side effect');

  const legacy = fixture();
  delete legacy.state.cards['Alpha 1'];
  fs.writeFileSync(legacy.statePath, `${JSON.stringify(legacy.state, null, 2)}\n`);
  fs.writeFileSync(legacy.alphaCard,
    fs.readFileSync(legacy.alphaCard, 'utf8').replace('status: in_progress', 'status: completed'));
  const legacyReport = auditFx(legacy);
  const legacyFinding = legacyReport.findings.find((finding) => finding.code === 'legacy-completion-no-receipt');
  ok(legacyFinding && !legacyFinding.repairable,
    'ES4B-LEGACY-COMPLETION-GRACEFUL receiptless completed note is a bounded finding, never done or a crash');
  eq(legacyFinding.card, 'Alpha 1',
    'legacy completion remains a bounded per-card diagnostic without completion authority');
  detectionOnly(legacyReport,
    'ES4BA-LEGACY-DETECTION-ONLY receiptless completion advertises no repair side effect');
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
  detectionOnly(parentReport,
    'ES4BA-ROLLUP-DETECTION-ONLY epic roll-up drift advertises no repair side effect');

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
  detectionOnly(sliceReport,
    'ES4BA-SLICE-DETECTION-ONLY slice drift advertises no repair side effect');

  const backlink = fixture();
  fs.writeFileSync(backlink.alpha.atlasPath,
    fs.readFileSync(backlink.alpha.atlasPath, 'utf8')
      .replace('tasks/Epic Alpha/board/Epic Alpha-board.md', 'tasks/Epic Alpha/board/wrong.md'));
  const backlinkReport = auditFx(backlink);
  ok(backlinkReport.findings.some((finding) => finding.code === 'resolver-epic-atlas-mismatch'),
    'ES4B-EPIC-BOARD-BACKLINK-REFERENTIAL reports an atlas backlink mismatch');

  const sliceBacklink = fixture();
  fs.writeFileSync(sliceBacklink.alphaCard,
    fs.readFileSync(sliceBacklink.alphaCard, 'utf8').replace('epic: "[[Epic Alpha]]"', 'epic: "[[Epic Wrong]]"'));
  const sliceBacklinkReport = auditFx(sliceBacklink);
  const topologyFinding = sliceBacklinkReport.findings.find((finding) => finding.code === 'epic-referential-invalid');
  ok(topologyFinding, 'ES4B-SLICE-EPIC-BACKLINK-REFERENTIAL reports a mismatched slice epic backlink');
  eq(topologyFinding.card, 'Alpha 1', 'topology refusal remains a bounded per-card finding');
  detectionOnly(sliceBacklinkReport,
    'ES4BA-TOPOLOGY-DETECTION-ONLY referential findings advertise no repair side effect');

  const roleless = fixture();
  fs.writeFileSync(roleless.beta.boardPath,
    fs.readFileSync(roleless.beta.boardPath, 'utf8').replace('board_role: epic', 'board_role: list'));
  const rolelessReport = auditFx(roleless);
  ok(rolelessReport.findings.some((finding) => finding.code === 'resolver-missing-epic-board'),
    'ES4B-EPIC-BOARD-ROLE-REFERENTIAL reports a role-less epic board');

  const orphan = fixture();
  writeEpic(orphan.projectRoot, 'Epic Orphan', [{
    card: 'Orphan 1', column: 'In Planning', status: 'planning',
  }]);
  const orphanReport = auditFx(orphan);
  const orphanFinding = orphanReport.findings.find((finding) => finding.code === 'orphan-epic-directory');
  ok(orphanFinding && orphanFinding.owner === 'semantic' && !orphanFinding.repairable,
    'ES4B-ORPHAN-EPIC-DIRECTORY reports an unowned semantic finding without inventing priority');
  detectionOnly(orphanReport,
    'ES4BA-ORPHAN-DETECTION-ONLY orphan findings advertise no repair side effect');

  const readOnly = fixture();
  fs.writeFileSync(readOnly.boardPath,
    moveBoardCard(fs.readFileSync(readOnly.boardPath, 'utf8'), 'Epic Alpha', 'Completed', true));
  const beforeAudit = treeSnapshot(readOnly.root);
  const readOnlyReport = auditFx(readOnly);
  ok(!readOnlyReport.clean, 'ES4BA-READ-ONLY-FINDING fixture produces a visible drift finding');
  eq(treeSnapshot(readOnly.root), beforeAudit,
    'ES4BA-READ-ONLY-AUDIT direct audit leaves every vault file and directory byte-stable');
  ok(!fs.existsSync(path.join(readOnly.projectRoot, '.sauce-backup')),
    'ES4BA-NO-BACKUP-ROOT read-only audit creates no backup root');
  detectionOnly(readOnlyReport,
    'ES4BA-READ-ONLY-ROUTES read-only audit advertises no repair side effect');

  const cliBefore = treeSnapshot(readOnly.root);
  const refusedRepair = spawnSync(process.execPath, [
    path.resolve(__dirname, '../../scripts/autoloop/audit-delivery.js'),
    '--board', readOnly.boardPath,
    '--cards-root', readOnly.cardsRoot,
    '--state', readOnly.statePath,
    '--repair',
    '--json',
  ], { encoding: 'utf8' });
  eq(refusedRepair.status, 1,
    'ES4BA-NO-REPAIR-CLI read-only audit refuses the repair option');
  ok(refusedRepair.stderr.includes('refuses unsupported option --repair'),
    'ES4BA-NO-REPAIR-CLI refusal names the unsupported repair surface');
  eq(treeSnapshot(readOnly.root), cliBefore,
    'ES4BA-NO-REPAIR-CLI refusal leaves every vault file and directory byte-stable');

  const direct = auditEpicProject({
    parentBoardPath: clean.boardPath,
    cardsRoot: clean.cardsRoot,
    state: clean.state,
  });
  ok(direct.clean, 'coordinator-exported vault audit and CLI wrapper share one canonical implementation');
  ok(direct.findings.every((finding) => finding.repairable === false
      && !Object.prototype.hasOwnProperty.call(finding, 'reconcile')
      && finding.backup_paths.length === 0),
  'coordinator-exported audit is detection-only by construction');

  console.log(`PASS — audit-delivery (${count} assertions)`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
