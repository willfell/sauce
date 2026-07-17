#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  emptyState, atomicWriteJson, writeState, lockIsStale, lockDirectoryIsStale, normalizeZone, zonesOverlap,
  parseArgs,
  conflictsWithActive, parseExecutionMeta, validateExecutionMeta,
  normalizeCardLink, sameParentConflict, dependencySatisfied, selectClaimCandidate, summarizeClaimSelection,
  commandStatus, commandAmendContract, commandPark, commandResume, commandReconcile, commandRecover,
  checkRollup, versionFrom, isReleasableTitle,
  gateReceiptStatus, pathCoveredByTouchZones, releasePrWaitReceipt, commandRecordReview, commandVerifyGates,
  runIsolatedWorkshopSelfInstall, commandRecordPr, commandAdvance, stepCard, moveBoardCard, patchFrontmatter,
  attemptProjection, completionResult, projectionMapping, projectionMetadataProblem,
} = require('../../scripts/autoloop/codex-coordinator');
const { normalizeStatus, parseCardStatus, parseBatchPolicy, parseCheckedColumn, selectCard } = require('../../scripts/autoloop/select-card');

let count = 0;
function ok(value, label) { assert.ok(value, label); count++; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); count++; }

function card({ profile = 'standard', zones = ['platform/mechanisms/example'], deps = [], deploy = true, parent = '' } = {}) {
  return [
    '---',
    `model_profile: ${profile}`,
    ...(parent ? [`parent_card: "[[${parent}]]"`] : []),
    'touch_zones:', ...zones.map((z) => `  - ${z}`),
    'depends_on:', ...deps.map((d) => `  - "[[${d}]]"`),
    ...(deploy ? ['deploy_subscriptions:', '  headspace: []', '  accuris: []', '  ero: []'] : []),
    '---', '', '# Work', '', 'Bounded work.',
  ].join('\n');
}

(async () => {

const meta = parseExecutionMeta(card({ profile: 'heavy', zones: ['platform/install.js', 'platform/test/run-x.js'], deps: ['A'] }));
eq(meta.modelProfile, 'heavy', 'parses model profile');
eq(meta.touchZones, ['platform/install.js', 'platform/test/run-x.js'], 'parses touch zones');
eq(meta.dependencies, ['A'], 'parses dependencies');
eq(meta.deploySubscriptions, { headspace: [], accuris: [], ero: [] }, 'parses deployment map');
eq(validateExecutionMeta(meta), [], 'valid execution metadata');
ok(validateExecutionMeta(parseExecutionMeta(card({ deploy: false }))).includes('deploy_subscriptions is required'), 'deployment map required');
ok(validateExecutionMeta(parseExecutionMeta(card({ profile: 'luna' }))).some((e) => /model_profile/.test(e)), 'only two model profiles');
eq(parseArgs(['park', '--depends-on', 'A', '--depends-on', 'B'])['depends-on'], ['A', 'B'], 'CLI preserves repeated dependency arguments');
eq(projectionMapping('claimed').status, 'in_progress', 'claimed lifecycle projects to canonical in_progress');
eq(projectionMapping('feature_pr').status, 'in_progress', 'waiting release lifecycle remains canonical in_progress');
eq(projectionMapping('blocked').status, 'blocked', 'blocked lifecycle keeps canonical blocked');
eq(projectionMapping('parked').status, 'parked', 'parked remains distinct from its In Progress board lane');
eq(projectionMapping('deployed').status, 'completed', 'deployed lifecycle projects to canonical completed');
eq(normalizeStatus('in-progress'), 'in_progress', 'Obsidian in-progress alias normalizes at the coordinator boundary');

const obsidianA1 = [
  '---', 'model_profile: heavy', 'kanban_column: In Planning', 'status: in-planning',
  'status_prev: planning', 'status_changed_at: 2026-07-16', 'touch_zones:', '  - scripts/autoloop/codex-coordinator.js',
  'depends_on: []', 'deploy_subscriptions:', '  headspace: []', '  accuris: []', '  ero: []', '---', '',
  '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
  '## A1 status normalization and drift visibility', '',
  'batch_policy: supervised_only — Normalize the live GA status vocabulary.',
].join('\n');
eq(parseCardStatus(obsidianA1), 'planning', 'real Obsidian planning rewrite parses into the canonical contract');
eq(parseBatchPolicy(obsidianA1), 'supervised_only', 'A1 textual batch policy is preserved as supervised_only');
const obsidianMeta = parseExecutionMeta(obsidianA1);
eq(obsidianMeta.status, 'planning', 'execution metadata exposes normalized planning status');
eq(obsidianMeta.batchPolicy, 'supervised_only', 'execution metadata exposes the supervised-only policy');

eq(normalizeZone('./platform/mechanisms/x/'), 'platform/mechanisms/x', 'normalizes zones');
ok(zonesOverlap('platform/mechanisms/x', 'platform/mechanisms/x/sub'), 'parent and child overlap');
ok(!zonesOverlap('platform/mechanisms/x', 'platform/mechanisms/y'), 'siblings do not overlap');
eq(conflictsWithActive({ touchZones: ['package.json'] }, [{ card: 'A', touch_zones: ['package.json'] }]).card, 'A', 'exclusive zone conflicts');

const board = (planning, completed = []) => [
  '## In Planning', ...planning.map((c) => `- [ ] [[${c}]]`), '',
  '## In Progress', '', '## Blocked', '',
  '## Completed', ...completed.map((c) => `- [x] [[${c}]]`), '',
].join('\n');
const liveBoard = ({ planning = [], progress = [], blocked = [], completed = [], archive = [] } = {}) => [
  '---', 'kanban-plugin: board', '---', '',
  '## In Planning', ...planning.map((c) => `- [ ] [[${c}]]`), '',
  '## In Progress', ...progress.map((c) => `- [ ] [[${c}]]`), '',
  '## Blocked', ...blocked.map((c) => `- [ ] [[${c}]]`), '',
  '## Discovered (autoloop)', '- [ ] [[Unrelated discovery]]', '',
  '## Completed', ...completed.map(([checked, c]) => `- [${checked ? 'x' : ' '}] [[${c}]]`), '',
  '***', '', '## Archive', ...archive.map(([checked, c]) => `- [${checked ? 'x' : ' '}] [[${c}]]`), '',
  '%% kanban:settings', '{}', '%%',
].join('\n');
const successfulVaultReceipts = (version = '0.233.0') => Object.fromEntries(
  ['headspace', 'accuris', 'ero'].map((vault) => [vault, { vault, ok: true, installed_version: version }]),
);
const bodies = {
  A: card({ zones: ['platform/a'] }),
  B: card({ zones: ['platform/b'], deps: ['Done'] }),
  C: card({ zones: ['platform/c'] }),
  Done: card(),
};
const loadCard = (name) => bodies[name] ? { path: `/cards/${name}.md`, raw: bodies[name] } : null;

let state = emptyState();
eq(selectClaimCandidate({ boardMd: board(['A']), state, loadCard }).card, 'A', 'selects first eligible card');
eq(selectClaimCandidate({
  boardMd: board(['A1 status normalization and drift visibility']), state: emptyState(),
  loadCard: () => ({ path: '/cards/A1.md', raw: obsidianA1 }),
}).action, 'no-work', 'unattended coordinator eligibility refuses supervised-only A1');
eq(selectClaimCandidate({
  boardMd: board(['A1 status normalization and drift visibility']), state: emptyState(), supervised: true,
  loadCard: () => ({ path: '/cards/A1.md', raw: obsidianA1 }),
}).card, 'A1 status normalization and drift visibility', 'explicit supervised coordinator eligibility accepts A1 with Obsidian planning status');
eq(summarizeClaimSelection(selectClaimCandidate({
  boardMd: board(['A1 status normalization and drift visibility']), state: emptyState(), supervised: true,
  loadCard: () => ({ path: '/cards/A1.md', raw: obsidianA1 }),
})).status, 'planning', 'status selection output exposes canonical planning');
eq(selectClaimCandidate({
  boardMd: board(['A1 status normalization and drift visibility']), state: emptyState(), supervised: true,
  loadCard: () => ({ path: '/cards/A1.md', raw: obsidianA1.replace('status: in-planning', 'status: post-ga') }),
}).action, 'no-work', 'Post-GA card metadata is not planning-eligible even if the board lane is stale');
state.cards.Done = { card: 'Done', phase: 'feature_merged', required_version: '0.233.0', touch_zones: [] };
eq(selectClaimCandidate({ boardMd: board(['B', 'C'], ['Done']), state, loadCard }).card, 'C', 'requires dependency deployed, skips to next');
state.cards.Done.phase = 'deployed';
eq(selectClaimCandidate({ boardMd: board(['B']), state, loadCard }).action, 'no-work', 'tracked deployed dependency still requires successful vault receipts');
state.cards.Done.vault_receipts = successfulVaultReceipts();
const driftedTrackedDependency = selectClaimCandidate({
  boardMd: liveBoard({ planning: ['B'], archive: [[true, 'Done'], [false, 'Archived unchecked work']] }), state, loadCard,
});
eq(driftedTrackedDependency.card, 'B', 'authoritative tracked deployment satisfies dependency despite board drift');
eq(driftedTrackedDependency.board_drift, [{ card: 'Done', issue: 'deployed dependency is not checked in Completed' }], 'tracked dependency board drift is reported separately');
state.cards.Done.vault_receipts.ero.ok = false;
eq(selectClaimCandidate({ boardMd: board(['B'], ['Done']), state, loadCard }).action, 'no-work', 'failed required-vault receipt rejects tracked dependency');
state.cards.Done.vault_receipts.ero = { vault: 'ero', ok: true };
eq(selectClaimCandidate({ boardMd: board(['B'], ['Done']), state, loadCard }).action, 'no-work', 'required-version deployment receipt must name an installed version');

state = emptyState();
eq(selectClaimCandidate({ boardMd: liveBoard({ planning: ['B'], completed: [[true, 'Done']] }), state, loadCard }).card, 'B', 'checked Completed entry satisfies an untracked dependency');
eq(selectClaimCandidate({ boardMd: liveBoard({ planning: ['B'], completed: [[false, 'Done']] }), state, loadCard }).action, 'no-work', 'unchecked Completed entry does not satisfy an untracked dependency');
eq(selectClaimCandidate({ boardMd: liveBoard({ planning: ['B'], archive: [[true, 'Done'], [false, 'Archived unchecked work']] }), state, loadCard }).action, 'no-work', 'checked Archive entry does not satisfy an untracked dependency');
eq([...parseCheckedColumn(liveBoard({ completed: [[true, 'Completed only']], archive: [[true, 'Archived checked'], [false, 'Archived unchecked']] }), 'Completed')], ['Completed only'], 'checked-column parser keeps Completed separate from mixed Archive');
eq(selectCard({ boardMd: liveBoard({ planning: ['B'], archive: [[true, 'Done']] }), loadBody: (name) => bodies[name] || '' }).action, 'no-eligible-work', 'legacy selector also refuses checked Archive as completion');

state = emptyState();
state.cards.Active = { card: 'Active', phase: 'feature_pr', touch_zones: ['platform/a'] };
eq(selectClaimCandidate({ boardMd: board(['A', 'C']), state, loadCard }).card, 'C', 'touch-zone conflict skips to disjoint card');
state.cards.Busy2 = { card: 'Busy2', phase: 'release_pr', touch_zones: ['platform/z'] };
state.cards.Busy3 = { card: 'Busy3', phase: 'tap_pr', touch_zones: ['platform/y'] };
eq(selectClaimCandidate({ boardMd: board(['C']), state, loadCard }).action, 'at-capacity', 'three active claims enforce cap');

state.cards.Active.phase = 'parked';
eq(selectClaimCandidate({ boardMd: board(['C']), state, loadCard }).card, 'C', 'parked work does not consume active capacity');
state.cards.Busy2.phase = 'parked';
state.cards.Busy3.phase = 'parked';
eq(selectClaimCandidate({ boardMd: board(['A']), state, loadCard }).card, 'A', 'parked work does not create touch-zone conflicts');

eq(normalizeCardLink('"[[Parent card|Parent alias]]"'), 'Parent card', 'normalizes parent wikilinks before comparison');
const parentBodies = {
  Child2: card({ zones: ['platform/child-2'], parent: 'Shared parent' }),
  Child3: card({ zones: ['platform/child-3'], parent: 'Shared parent' }),
};
const loadParentCard = (name) => parentBodies[name] ? { path: `/cards/${name}.md`, raw: parentBodies[name] } : null;
const siblingState = emptyState();
siblingState.cards.Child1 = {
  card: 'Child1', phase: 'implementing', parent_card: '[[Shared parent|Alias]]', touch_zones: ['platform/child-1'],
};
eq(sameParentConflict('Shared parent', Object.values(siblingState.cards)).card, 'Child1', 'same-parent detection uses normalized links');
eq(selectClaimCandidate({ boardMd: board(['Child2']), state: siblingState, loadCard: loadParentCard }).action, 'no-work', 'claim refuses a second active child of one parent');
siblingState.cards.Child1.phase = 'parked';
eq(selectClaimCandidate({ boardMd: board(['Child2']), state: siblingState, loadCard: loadParentCard }).card, 'Child2', 'parked sibling allows another child claim');

state = emptyState();
state.cards.A = { card: 'A', phase: 'blocked', touch_zones: [] };
eq(selectClaimCandidate({ boardMd: board(['A']), state, loadCard }).action, 'no-work', 'tracked blocked card is not reclaimed');

const eligibleSummary = summarizeClaimSelection(selectClaimCandidate({ boardMd: board(['A']), state: emptyState(), loadCard }));
eq(eligibleSummary, { action: 'claim', card: 'A', model_profile: 'standard', touch_zones: ['platform/a'], skipped_count: 0 }, 'summarizes next eligible card');
const blockedSummary = summarizeClaimSelection(selectClaimCandidate({ boardMd: board(['Missing']), state: emptyState(), loadCard }));
eq(blockedSummary.first_blocker, { card: 'Missing', reason: 'card note missing' }, 'summarizes the first board blocker');

eq(checkRollup([{ name: 'mac', status: 'COMPLETED', conclusion: 'SUCCESS' }]).green, true, 'green rollup');
eq(checkRollup([{ name: 'linux', status: 'IN_PROGRESS', conclusion: '' }]).pending, ['linux'], 'pending rollup');
eq(checkRollup([{ name: 'mac', status: 'COMPLETED', conclusion: 'FAILURE' }]).failed, ['mac'], 'failed rollup');
eq(versionFrom('chore(release): v0.232.1'), '0.232.1', 'extracts release version');
ok(isReleasableTitle('fix(autoloop): reject non-releasable PR titles'), 'fix title triggers a release');
ok(isReleasableTitle('feat!: replace the loop contract'), 'breaking feature title triggers a release');
ok(isReleasableTitle('perf(coordinator): reduce status latency'), 'release classifier accepts other patch types');
ok(!isReleasableTitle('test(preflight): guard orphan harnesses'), 'test-only title cannot enter the deploy loop');
ok(!isReleasableTitle('docs(autoloop): explain mobile prompts'), 'docs-only title cannot enter the deploy loop');
const passingReceipt = (head = 'head42', behavioral = true) => ({
  status: 'pass', head_sha: head, base_ref: 'origin/main', base_sha: 'base42', behavioral,
  checks: { adequacy: 'pass', release_preflight: 'pass', workshop_self_install: 'pass', release_preflight_bumped: 'pass' },
  reviews: behavioral ? Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, { lens, head_sha: head, verdict: 'pass' }])) : {},
});
ok(gateReceiptStatus({ gate_receipt: passingReceipt() }, 'head42').valid, 'complete current gate receipt is valid');
ok(!gateReceiptStatus({ gate_receipt: passingReceipt('old') }, 'head42').valid, 'stale gate receipt is invalid');
ok(!gateReceiptStatus({ gate_receipt: passingReceipt() }, 'head42', 'new-base').valid, 'stale base receipt is invalid for an open PR');
ok(pathCoveredByTouchZones('platform/mechanisms/x/a.js', ['platform/mechanisms/x']), 'touch zone covers descendants');
ok(!pathCoveredByTouchZones('platform/test/run-x.js', ['platform/mechanisms/x']), 'touch zone rejects undeclared files');
ok(pathCoveredByTouchZones('scripts/autoloop/gate.js', ['scripts']), 'top-level directory touch zone covers descendants');
ok(!pathCoveredByTouchZones('platform/install.js', ['scripts']), 'top-level directory touch zone rejects other roots');
ok(!pathCoveredByTouchZones('platform/install.js', ['shared-registries']), 'symbolic-only touch zones fail closed for file changes');
const spacedTouchZone = 'platform/blueprints/people/templates/Template, People.md';
ok(pathCoveredByTouchZones(spacedTouchZone, [spacedTouchZone]), 'exact touch-zone paths may contain spaces');
ok(!pathCoveredByTouchZones('platform/install.js', [spacedTouchZone]), 'spaced touch-zone paths still reject other files');
const waitRecord = { card: 'A', phase: 'feature_merged', feature_merge_sha: 'abc123' };
eq(await stepCard({ root: '/workshop' }, emptyState(), waitRecord, {}, {
  findContainingTag: () => '',
  findContainingRelease: () => null,
}), {
  action: 'waiting',
  phase: 'feature_merged',
  waiting_for: 'release_pr',
  reason: 'containing release PR not created yet',
}, 'release branch preserves the durable phase and names the next phase');
eq(waitRecord.phase, 'feature_merged', 'release wait does not advance durable state');
const parkedAdvanceRecord = {
  card: 'Parked work', phase: 'parked', dependencies: ['Prerequisite'], resume_condition: 'Prerequisite deploys',
};
eq(await stepCard({ root: '/workshop' }, emptyState(), parkedAdvanceRecord), {
  action: 'parked', card: 'Parked work', phase: 'parked', dependencies: ['Prerequisite'],
  resume_condition: 'Prerequisite deploys', resume: 'resume --card Parked work',
}, 'advance stops on a parked card and returns its explicit resume command');

const recordState = emptyState();
recordState.cards.A = { card: 'A', branch: 'autoloop/a', worktree: '/worktrees/a', phase: 'implementing' };
const basePr = {
  number: 42, state: 'OPEN', title: 'test(preflight): guard orphan harnesses', url: 'https://example.test/pr/42',
  baseRefName: 'main', baseRefOid: 'base42', headRefName: 'autoloop/a', headRefOid: 'head42', autoMergeRequest: null,
};
const staleGateRecord = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: passingReceipt('old') };
eq((await stepCard({ root: '/workshop' }, emptyState(), staleGateRecord, {}, {
  prView: () => ({ ...basePr, title: 'fix(x): y', headRefOid: 'new', statusCheckRollup: [] }),
})).action, 'verify-gates', 'feature PR refuses stale local gates before auto-merge');
let disabled = 0;
const legacyAutoMergeRecord = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: null };
eq((await stepCard({ root: '/workshop' }, emptyState(), legacyAutoMergeRecord, {}, {
  prView: () => ({ ...basePr, title: 'fix(x): y', autoMergeRequest: { enabledAt: 'now' }, statusCheckRollup: [] }),
  disableFeatureAutoMerge: () => { disabled++; },
})).action, 'verify-gates', 'invalid receipt returns to gate verification');
eq(disabled, 1, 'invalid receipt disables a legacy auto-merge request');
const mergedWithoutGates = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: null };
eq((await stepCard({ root: '/workshop' }, emptyState(), mergedWithoutGates, {}, {
  prView: () => ({ ...basePr, state: 'MERGED', title: 'fix(x): y', mergeCommit: { oid: 'merge42' } }),
  writeState: () => {},
})).action, 'needs-inspection', 'merged PR cannot advance without a current gate receipt');
const mergedWithStaleGates = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: passingReceipt('old') };
eq((await stepCard({ root: '/workshop' }, emptyState(), mergedWithStaleGates, {}, {
  prView: () => ({ ...basePr, state: 'MERGED', title: 'fix(x): y', mergeCommit: { oid: 'merge42' } }),
  writeState: () => {},
})).action, 'needs-inspection', 'merged PR cannot advance with a stale gate receipt');
const mergedWithStaleBase = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: passingReceipt() };
eq((await stepCard({ root: '/workshop' }, emptyState(), mergedWithStaleBase, {}, {
  prView: () => ({ ...basePr, baseRefOid: 'new-base', state: 'MERGED', title: 'fix(x): y', mergeCommit: { oid: 'merge42' } }),
  writeState: () => {},
})).action, 'needs-inspection', 'merged PR cannot advance with a stale base receipt');
const mergedWithGates = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: passingReceipt() };
eq((await stepCard({ root: '/workshop' }, emptyState(), mergedWithGates, {}, {
  prView: () => ({ ...basePr, state: 'MERGED', title: 'fix(x): y', mergeCommit: { oid: 'merge42' } }),
  writeState: () => {},
})).phase, 'feature_merged', 'merged PR advances with a current canonical gate receipt');
eq((await stepCard({ root: '/workshop' }, emptyState(), mergedWithoutGates, {}, {})).action, 'needs-inspection', 'resuming needs-inspection preserves its durable action');
let armed = 0;
const validGateRecord = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: passingReceipt() };
await stepCard({ root: '/workshop' }, emptyState(), validGateRecord, {}, {
  prView: () => ({ ...basePr, title: 'fix(x): y', statusCheckRollup: [{ name: 'mac', status: 'IN_PROGRESS', conclusion: '' }] }),
  armFeatureAutoMerge: () => { armed++; },
});
eq(armed, 0, 'feature PR does not arm auto-merge while GitHub CI is pending');
await stepCard({ root: '/workshop' }, emptyState(), validGateRecord, {}, {
  prView: () => ({ ...basePr, title: 'fix(x): y', statusCheckRollup: [{ name: 'mac', status: 'COMPLETED', conclusion: 'SUCCESS' }] }),
  armFeatureAutoMerge: () => { armed++; },
});
eq(armed, 1, 'feature PR arms auto-merge only after current local gates and GitHub CI are green');
let writes = 0; let merges = 0;
const immediateCardLock = async (_ctx, _name, fn) => fn();
await assert.rejects(() => commandRecordPr({ root: '/workshop' }, { card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => basePr,
  sh: () => { throw new Error('git or gh must not run for a rejected title'); },
  writeState: () => { writes++; },
  armFeatureAutoMerge: () => { merges++; },
  withLock: immediateCardLock,
}), /will not trigger a release/, 'record-pr rejects a non-releasable title');
eq(writes, 0, 'rejected title is not persisted');
eq(merges, 0, 'rejected title never arms auto-merge');
eq(recordState.cards.A.phase, 'implementing', 'rejected title leaves the recorded phase unchanged');

await assert.rejects(() => commandRecordPr({ root: '/workshop' }, { card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, title: 'fix(autoloop): require gate receipts' }),
  sh: (cmd, args) => args[0] === 'status' ? '' : 'head42',
  writeState: () => { writes++; },
  withLock: immediateCardLock,
}), /gate receipt is missing/, 'record-pr refuses a clean matching PR without gate receipts');

recordState.cards.A.gate_receipt = passingReceipt();
await assert.rejects(() => commandRecordPr({ root: '/workshop' }, { card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, baseRefOid: 'new-base', title: 'fix(autoloop): require gate receipts' }),
  sh: (cmd, args) => args[0] === 'status' ? '' : 'head42',
  writeState: () => { writes++; },
  withLock: immediateCardLock,
}), /gate receipt base is stale/, 'record-pr refuses gates run against an outdated main base');

const events = [];
let prLock = '';
const accepted = await commandRecordPr({ root: '/workshop' }, { card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, title: 'fix(autoloop): guard release triggering' }),
  sh: (cmd, args) => {
    if (cmd === 'git' && args[0] === 'status') return '';
    if (cmd === 'git' && args[0] === 'rev-parse') return 'head42';
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  },
  writeState: () => { events.push('write'); writes++; },
  withLock: async (_ctx, name, fn) => { prLock = name; return fn(); },
});
eq(accepted.action, 'recorded', 'record-pr accepts a releasable title');
eq(prLock, 'gates-a', 'record-pr shares the per-card gate lock');
eq(events, ['write'], 'record-pr persists validated state without arming auto-merge before CI is green');

const reviewState = emptyState();
reviewState.cards.Review = { card: 'Review', branch: 'autoloop/review', worktree: os.tmpdir(), phase: 'implementing', gate_receipt: passingReceipt() };
let reviewLock = '';
const review = await commandRecordReview({ root: '/workshop' }, {
  card: 'Review', lens: 'correctness', verdict: 'pass', summary: 'No correctness defect found in the reviewed diff.',
}, {
  readState: () => reviewState, sh: () => 'review-head', writeState: () => {},
  withLock: async (_ctx, name, fn) => { reviewLock = name; return fn(); },
});
eq(review.head_sha, 'review-head', 'review receipt is tied to the exact commit');
eq(reviewLock, 'gates-review', 'review writes share the per-card gate lock');
eq(reviewState.cards.Review.gate_receipt, null, 'new review invalidates an earlier combined gate receipt');

reviewState.cards.Review.phase = 'feature_merged';
await assert.rejects(() => commandRecordReview({ root: '/workshop' }, {
  card: 'Review', lens: 'correctness', verdict: 'refute', summary: 'A late refutation must not reopen a merged feature.',
}, {
  readState: () => reviewState, sh: () => 'review-head', writeState: () => {}, withLock: immediateCardLock,
}), /reviews are closed .*feature_merged/, 'review writes are rejected after the feature PR merges');
reviewState.cards.Review.phase = 'implementing';

reviewState.cards.Review.touch_zones = ['scripts/autoloop', 'platform/test'];
reviewState.cards.Review.reviews = Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, {
  lens, verdict: 'pass', refuted: false, summary: `${lens} review found no release-blocking defect.`, head_sha: 'review-head',
}]));
const gateCalls = [];
const verified = await commandVerifyGates({ root: '/workshop' }, { card: 'Review', base: 'HEAD' }, {
  readState: () => reviewState,
  writeState: () => {},
  withLock: async (_ctx, name, fn) => { gateCalls.push(name); return fn(); },
  runIsolatedWorkshopSelfInstall: () => { gateCalls.push('self-install'); },
  sh: (cmd, args) => {
    if (cmd === 'git' && args[0] === 'status') return '';
    if (cmd === 'git' && args[0] === 'fetch') { gateCalls.push('fetch-main'); return ''; }
    if (cmd === 'git' && args[0] === 'rev-parse') return args[1] === 'origin/main' ? 'base-current' : 'review-head';
    if (cmd === 'git' && args[0] === 'diff') return 'scripts/autoloop/codex-coordinator.js\nplatform/test/run-codex-autoloop.js';
    if (cmd === 'node' && args[0] === 'scripts/autoloop/gate.js') {
      eq(args[args.indexOf('--base') + 1], 'base-current', 'verify-gates ignores caller base overrides and uses fetched origin/main');
      return JSON.stringify({ behavioral: true, adequate: true, reason: 'red then green' });
    }
    if (cmd === 'npm') { gateCalls.push(args[1]); return ''; }
    throw new Error(`unexpected gate command: ${cmd} ${args.join(' ')}`);
  },
});
eq(verified.action, 'gates-passed', 'verify-gates records a passing combined receipt');
eq(gateCalls, ['gates-review', 'fetch-main', 'release:preflight', 'self-install', 'release:preflight-bumped'], 'verify-gates serializes, fetches main, and owns every deterministic release check');
eq(reviewState.cards.Review.gate_receipt.base_ref, 'origin/main', 'combined receipt records the canonical base ref');
eq(reviewState.cards.Review.gate_receipt.base_sha, 'base-current', 'combined receipt records the exact fetched base SHA');
ok(gateReceiptStatus(reviewState.cards.Review, 'review-head').valid, 'combined receipt is accepted after every check passes');

const advanceState = emptyState();
advanceState.cards.Advance = { card: 'Advance', phase: 'feature_pr', gate_receipt: passingReceipt() };
let advanceLock = ''; let insideAdvanceLock = false; let advanceReadInsideLock = false;
const advanceResult = await commandAdvance({ root: '/workshop' }, { card: 'Advance', 'lease-seconds': '0' }, {
  withLock: async (_ctx, name, fn) => {
    advanceLock = name; insideAdvanceLock = true;
    try { return await fn(); } finally { insideAdvanceLock = false; }
  },
  readState: () => { advanceReadInsideLock = insideAdvanceLock; return advanceState; },
  stepCard: async () => ({ action: 'waiting', phase: 'feature_pr' }),
  emit: () => {},
});
eq(advanceLock, 'gates-advance', 'advance shares the per-card gate lock');
ok(advanceReadInsideLock, 'advance rereads the card only after acquiring its lock');
eq(advanceResult.phase, 'feature_pr', 'locked advance returns the feature PR state');
const parkedAdvanceState = emptyState();
parkedAdvanceState.cards.Parked = {
  card: 'Parked', phase: 'parked', dependencies: ['Prerequisite'], resume_condition: 'Prerequisite deploys',
};
eq((await commandAdvance({ root: '/workshop' }, { card: 'Parked', 'lease-seconds': '0' }, {
  withLock: immediateCardLock, readState: () => parkedAdvanceState, emit: () => {},
})).action, 'parked', 'advance command refuses to treat a parked card as implementation');

assert.throws(() => runIsolatedWorkshopSelfInstall({ root: '/workshop' }, 'head42', (cmd, args) => {
  if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') throw new Error('cleanup denied');
  return '';
}), /failed to remove disposable self-install worktree .*cleanup denied/, 'self-install gate surfaces disposable worktree cleanup failures');

let partialRemoved = false;
let partialPath = '';
assert.throws(() => runIsolatedWorkshopSelfInstall({ root: '/workshop' }, 'head42', (cmd, args) => {
  if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
    partialPath = args[3];
    throw new Error('checkout failed after registration');
  }
  if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') {
    return `worktree ${partialPath}\nHEAD head42\ndetached`;
  }
  if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') { partialRemoved = true; return ''; }
  return '';
}), /checkout failed after registration/, 'self-install preserves the original partial-add failure');
ok(partialRemoved, 'self-install unregisters a partially-added disposable worktree');

const moved = moveBoardCard(board(['A', 'C']), 'A', 'In Progress');
ok(!/## In Planning\n- \[ \] \[\[A\]\]/.test(moved), 'removes card from source lane');
ok(/## In Progress\n\n- \[ \] \[\[A\]\]/.test(moved), 'adds card to target lane');
const completed = moveBoardCard(moved, 'A', 'Completed', true);
ok(/## Completed\n\n- \[x\] \[\[A\]\]/.test(completed), 'marks completed projection checked');
eq(moveBoardCard(completed, 'A', 'Completed', true), completed, 'board projection is idempotent when lane and check state already match');

const patched = patchFrontmatter('---\nstatus: planning\n---\nbody', { status: 'in_progress', kanban_column: 'In Progress' });
ok(/status: in_progress/.test(patched), 'patches existing frontmatter key');
ok(/kanban_column: In Progress/.test(patched), 'adds missing frontmatter key');

const recentDead = { pid: 99999999, host: os.hostname(), started_at: new Date().toISOString() };
ok(!lockIsStale(recentDead), 'recent dead lock waits for stale threshold');
const oldDead = { ...recentDead, started_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() };
ok(lockIsStale(oldDead), 'old dead lock is stale');
const oldLive = { pid: process.pid, host: os.hostname(), started_at: oldDead.started_at };
ok(!lockIsStale(oldLive), 'live pid retains old lock');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-codex-loop-'));
const file = path.join(tmp, 'state.json');
atomicWriteJson(file, { schema_version: 1, cards: { A: { phase: 'claimed' } } });
eq(JSON.parse(fs.readFileSync(file, 'utf8')).cards.A.phase, 'claimed', 'atomic JSON write');
ok(!fs.readdirSync(tmp).some((name) => name.endsWith('.tmp')), 'atomic write leaves no temp');
const lockDir = path.join(tmp, 'owner-gap.lock');
fs.mkdirSync(lockDir);
ok(!lockDirectoryIsStale(lockDir, null, 30_000), 'new lock without owner is not stolen during owner-write gap');

const ctx = { stateDir: path.join(tmp, 'shared'), statePath: path.join(tmp, 'shared/state.json') };
const first = emptyState();
const recordA = { card: 'A', phase: 'feature_pr' };
first.cards.A = recordA;
writeState(ctx, first, recordA);
const staleA = JSON.parse(fs.readFileSync(ctx.statePath, 'utf8'));
const staleB = JSON.parse(fs.readFileSync(ctx.statePath, 'utf8'));
staleA.cards.A.phase = 'feature_merged';
writeState(ctx, staleA, staleA.cards.A);
const recordB = { card: 'B', phase: 'release_pr' };
staleB.cards.B = recordB;
writeState(ctx, staleB, recordB);
const merged = JSON.parse(fs.readFileSync(ctx.statePath, 'utf8'));
eq(merged.cards.A.phase, 'feature_merged', 'stale writer preserves another card advancement');
eq(merged.cards.B.phase, 'release_pr', 'stale writer merges only its changed card');
const statusCtx = { ...ctx, root: tmp };
const status = commandStatus(statusCtx, { boardMd: board(['Missing']), loadCard });
eq(status.next.action, 'no-work', 'status includes the read-only selector result');
eq(status.next.first_blocker.card, 'Missing', 'status names the first card that needs preparation');
ok(status.active.every((record) => record.status === 'in_progress'), 'status output normalizes every active lifecycle phase to in_progress');
ok(status.tracked.every((record) => record.status === 'in_progress'), 'all-tracked status view includes active in_progress records');
const parkedRecoveryState = emptyState();
parkedRecoveryState.cards.MissingParked = { card: 'MissingParked', phase: 'parked', worktree: '/definitely/missing/parked-worktree' };
eq(commandRecover(statusCtx, { state: parkedRecoveryState }).action, 'needs-inspection', 'recovery reports a missing parked worktree');
parkedRecoveryState.cards.MissingParked.worktree = tmp;
eq(commandRecover(statusCtx, { state: parkedRecoveryState, sh: () => ' M preserved-implementation.js' }).inspections[0].issue,
  'dirty worktree requires inspection', 'recovery reports preserved dirty parked implementation');

const AMEND_HEAD = 'a'.repeat(40);
const AMEND_MAIN = 'b'.repeat(40);
const AMEND_CARD = 'Protected active contract';
const legacyDeployments = { headspace: ['delivery'], accuris: ['delivery'], ero: ['delivery'] };
const typedDeployments = {
  headspace: ['mechanism:delivery'], accuris: ['mechanism:delivery'], ero: ['mechanism:delivery'],
};
let amendFixtureId = 0;
const deepCopy = (value) => JSON.parse(JSON.stringify(value));
function makeAmendFixture(opts = {}) {
  const root = path.join(tmp, `amend-${++amendFixtureId}`);
  const worktree = path.join(root, 'target-worktree');
  const cardPath = path.join(root, `${AMEND_CARD}.md`);
  const boardPath = path.join(root, 'sauce-board.md');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, 'protected.txt'), 'target worktree must never change\n');
  fs.writeFileSync(cardPath, [
    '---', 'kanban_column: In Progress', 'status: in_progress',
    'touch_zones:', '  - platform/mechanisms/delivery', '  - platform/schemas-index.json',
    'deploy_subscriptions:', '  headspace:', '    - delivery', '  accuris:', '    - delivery', '  ero:', '    - delivery',
    '---', '', '## Protected active contract', '',
    `${opts.batchPolicyLine || 'batch_policy: supervised_only'} — protected active work.`, '',
  ].join('\n'));
  fs.writeFileSync(boardPath, liveBoard({ progress: [AMEND_CARD] }));
  const record = {
    card: AMEND_CARD, phase: opts.phase || 'implementing', card_path: cardPath,
    branch: 'codex-autoloop/protected-active-contract', worktree,
    touch_zones: ['platform/mechanisms/delivery', 'platform/schemas-index.json'],
    deploy_subscriptions: deepCopy(legacyDeployments),
    reviews: { correctness: { lens: 'correctness', verdict: 'pass', head_sha: AMEND_HEAD, summary: 'old exact-head review' } },
    gate_receipt: passingReceipt(AMEND_HEAD),
    receipt_invalidations: [{ invalidated_at: '2026-07-14T00:00:00.000Z', reason: 'older', head_sha: 'old', reviews: {}, gate_receipt: null }],
    ...opts.record,
  };
  const fixture = {
    root, worktree, cardPath, boardPath,
    state: { schema_version: 1, updated_at: '2026-07-16T00:00:00.000Z', cards: { [AMEND_CARD]: record } },
    writes: 0, locks: [], gitCalls: [], dirty: opts.dirty || '',
  };
  fixture.args = {
    _: ['amend-contract'], json: true, card: AMEND_CARD,
    'expected-head': AMEND_HEAD, 'expected-origin-main': AMEND_MAIN,
    reason: 'add the omitted catalogue zone and type legacy deployment additions',
    'add-touch-zone': ['./platform/manifest.json/', 'platform/manifest.json'],
    'expected-deployment': JSON.stringify(legacyDeployments),
    'desired-deployment': JSON.stringify(typedDeployments),
  };
  fixture.deps = {
    readState: () => deepCopy(fixture.state),
    writeState: (_ctx, _state, changedRecord) => {
      fixture.writes++;
      fixture.state.cards[changedRecord.card] = deepCopy(changedRecord);
    },
    withLock: async (_ctx, name, fn) => { fixture.locks.push(name); return fn(); },
    worktreeExists: () => opts.worktreeExists !== false,
    sh: (_cmd, argv) => {
      fixture.gitCalls.push([...argv]);
      if (argv[0] === 'fetch') return '';
      if (argv[0] === 'rev-parse') return argv[1] === 'HEAD' ? (opts.actualHead || AMEND_HEAD) : (opts.actualMain || AMEND_MAIN);
      if (argv[0] === 'branch') return opts.actualBranch || record.branch;
      if (argv[0] === 'status') return fixture.dirty;
      throw new Error(`unexpected git fixture call ${argv.join(' ')}`);
    },
    boardPath, cardsRoot: root,
    now: () => '2026-07-16T18:00:00.000Z',
  };
  fixture.worktreeSnapshot = fs.readFileSync(path.join(worktree, 'protected.txt'), 'utf8');
  fixture.cardSnapshot = fs.readFileSync(cardPath, 'utf8');
  return fixture;
}

const amend = makeAmendFixture();
const amended = await commandAmendContract({ root: amend.root }, amend.args, amend.deps);
eq(amended.action, 'contract-amended', 'amend-contract succeeds through the explicit supervised command');
eq(amended.no_op, false, 'real execution-contract amendment is not a no-op');
eq(amend.locks, ['selector', `gates-protected-active-contract`, 'completion-projection'], 'amend-contract uses selector, card, then projection lock order');
eq(amend.state.cards[AMEND_CARD].touch_zones, [
  'platform/mechanisms/delivery', 'platform/schemas-index.json', 'platform/manifest.json',
], 'touch-zone amendment is normalized, deduplicated, additive, and preserves existing order');
eq(amend.state.cards[AMEND_CARD].deploy_subscriptions, typedDeployments, 'deployment replacement stores only the normalized typed desired map');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].old_contract.deploy_subscriptions, legacyDeployments, 'audit preserves the exact normalized old deployment map');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].new_contract.deploy_subscriptions, typedDeployments, 'audit records the exact new deployment map');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].expected_head, AMEND_HEAD, 'audit pins the exact target HEAD');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].expected_origin_main, AMEND_MAIN, 'audit pins the exact origin/main revision');
eq(amend.state.cards[AMEND_CARD].receipt_invalidations.length, 2, 'real amendment appends one receipt invalidation');
eq(amend.state.cards[AMEND_CARD].reviews, {}, 'real amendment invalidates current reviews');
eq(amend.state.cards[AMEND_CARD].gate_receipt, null, 'real amendment invalidates the combined gate receipt');
ok(/platform\/manifest\.json/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'amended touch zones project into card frontmatter');
ok(/mechanism:delivery/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'typed deployments project into card frontmatter');
ok(/status: in_progress/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'contract-only projection preserves lifecycle metadata');
ok(!/status_changed_at: 2026-07-16T18:00:00.000Z/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'contract-only projection does not rewrite the status timestamp');
eq(fs.readFileSync(path.join(amend.worktree, 'protected.txt'), 'utf8'), amend.worktreeSnapshot, 'successful amendment never modifies the target worktree');
ok(!amend.gitCalls.some((call) => ['merge', 'rebase', 'push', 'checkout', 'switch', 'reset'].includes(call[0])), 'amend-contract performs no target-worktree mutation command');
eq(amend.writes, 2, 'successful amendment persists authority first and its projection receipt second');

const claimedAmendment = makeAmendFixture({ phase: 'claimed' });
eq((await commandAmendContract({ root: claimedAmendment.root }, claimedAmendment.args, claimedAmendment.deps)).action,
  'contract-amended', 'amend-contract accepts tracked claimed work before feature PR creation');

const replayWrites = amend.writes;
const replayInvalidations = deepCopy(amend.state.cards[AMEND_CARD].receipt_invalidations);
const replayAudit = deepCopy(amend.state.cards[AMEND_CARD].contract_amendments);
const replayCard = fs.readFileSync(amend.cardPath, 'utf8');
const replayArgs = {
  ...amend.args,
  'expected-deployment': JSON.stringify(typedDeployments),
  'add-touch-zone': 'platform/manifest.json',
};
const replay = await commandAmendContract({ root: amend.root }, replayArgs, amend.deps);
eq(replay.no_op, true, 'identical normalized replay is an explicit no-op');
eq(amend.writes, replayWrites, 'identical replay performs no ledger write');
eq(amend.state.cards[AMEND_CARD].receipt_invalidations, replayInvalidations, 'identical replay preserves every receipt and invalidation timestamp');
eq(amend.state.cards[AMEND_CARD].contract_amendments, replayAudit, 'identical replay preserves amendment audit timestamps');
eq(fs.readFileSync(amend.cardPath, 'utf8'), replayCard, 'identical replay performs no projection rewrite');

const refusalCases = [
  ['untracked card', (f) => { f.state.cards = {}; }, /not tracked/],
  ['missing worktree', (f) => { f.deps.worktreeExists = () => false; }, /existing worktree/],
  ['dirty worktree', (f) => { f.dirty = ' M protected.txt'; }, /clean target worktree/],
  ['post-PR phase', (f) => { f.state.cards[AMEND_CARD].phase = 'feature_pr'; }, /pre-PR work/],
  ['stale HEAD', (f) => { f.args['expected-head'] = 'c'.repeat(40); }, /stale expected HEAD/],
  ['stale origin main', (f) => { f.args['expected-origin-main'] = 'c'.repeat(40); }, /stale expected origin\/main/],
  ['wrong tracked branch', (f) => { f.deps.sh = (_cmd, argv) => argv[0] === 'fetch' ? '' : argv[0] === 'rev-parse' ? (argv[1] === 'HEAD' ? AMEND_HEAD : AMEND_MAIN) : argv[0] === 'branch' ? 'other-branch' : ''; }, /branch differs/],
  ['stale deployment CAS', (f) => { f.args['expected-deployment'] = JSON.stringify({ ...legacyDeployments, ero: [] }); }, /stale expected deployment/],
  ['untyped desired deployment', (f) => { f.args['desired-deployment'] = JSON.stringify(legacyDeployments); }, /mechanism:name or blueprint:name/],
  ['malformed authoritative deployment', (f) => { f.state.cards[AMEND_CARD].deploy_subscriptions = { headspace: [], accuris: [] }; }, /requires exactly/],
  ['malformed authoritative touch zones', (f) => { f.state.cards[AMEND_CARD].touch_zones = ['platform/x', 'platform/x']; }, /malformed touch_zones/],
  ['non-supervised target', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('batch_policy: supervised_only', 'batch_policy: unattended')); }, /supervised_only/],
  ['unsupported metadata mutation', (f) => { f.args.phase = 'claimed'; }, /unsupported option --phase/],
];
for (const [label, mutate, pattern] of refusalCases) {
  const fixture = makeAmendFixture();
  mutate(fixture);
  const before = deepCopy(fixture.state);
  const beforeCard = fs.readFileSync(fixture.cardPath, 'utf8');
  const beforeWorktree = fs.readFileSync(path.join(fixture.worktree, 'protected.txt'), 'utf8');
  await assert.rejects(() => commandAmendContract({ root: fixture.root }, fixture.args, fixture.deps), pattern, `amend-contract refuses ${label}`);
  eq(fixture.state, before, `${label} refusal preserves authoritative state`);
  eq(fixture.writes, 0, `${label} refusal performs no ledger write`);
  eq(fs.readFileSync(fixture.cardPath, 'utf8'), beforeCard, `${label} refusal preserves projected card bytes`);
  eq(fs.readFileSync(path.join(fixture.worktree, 'protected.txt'), 'utf8'), beforeWorktree, `${label} refusal preserves target worktree bytes`);
}
const malformedArgumentFixture = makeAmendFixture();
malformedArgumentFixture.args['desired-deployment'] = '{bad';
await assert.rejects(
  () => commandAmendContract({ root: malformedArgumentFixture.root }, malformedArgumentFixture.args, malformedArgumentFixture.deps),
  /valid JSON/, 'amend-contract refuses malformed deployment JSON before locks or writes',
);
eq(malformedArgumentFixture.locks, [], 'malformed argument refusal occurs before acquiring transition locks');
eq(malformedArgumentFixture.writes, 0, 'malformed argument refusal performs no state write');
const malformedRevisionFixture = makeAmendFixture();
malformedRevisionFixture.args['expected-head'] = 'short';
await assert.rejects(
  () => commandAmendContract({ root: malformedRevisionFixture.root }, malformedRevisionFixture.args, malformedRevisionFixture.deps),
  /40-character --expected-head/, 'amend-contract refuses a malformed revision pin before locks or writes',
);
eq(malformedRevisionFixture.locks, [], 'malformed revision refusal occurs before acquiring transition locks');

const conflictFixture = makeAmendFixture();
conflictFixture.state.cards.Conflict = {
  card: 'Conflict', phase: 'implementing', touch_zones: ['platform/manifest.json'],
};
const conflictBefore = deepCopy(conflictFixture.state);
await assert.rejects(
  () => commandAmendContract({ root: conflictFixture.root }, conflictFixture.args, conflictFixture.deps),
  /touch-zone conflict with Conflict/, 'amend-contract refuses a new active-zone conflict',
);
eq(conflictFixture.state, conflictBefore, 'active-zone conflict refusal preserves all tracked records');
eq(conflictFixture.writes, 0, 'active-zone conflict refusal occurs before authoritative mutation');

const projectionFailure = makeAmendFixture();
projectionFailure.deps.projectCard = () => { throw new Error('contract projection denied'); };
const failedAmend = await commandAmendContract({ root: projectionFailure.root }, projectionFailure.args, projectionFailure.deps);
eq(failedAmend.action, 'amend-contract-projection-failed', 'projection failure is explicit after authoritative amendment');
eq(projectionFailure.state.cards[AMEND_CARD].deploy_subscriptions, typedDeployments, 'projection failure preserves authoritative desired deployment map');
eq(projectionFailure.state.cards[AMEND_CARD].projection_error, 'contract projection denied', 'projection failure is saved for reconciliation');
eq(fs.readFileSync(projectionFailure.cardPath, 'utf8'), projectionFailure.cardSnapshot, 'failed projection leaves the card for reconciliation');
const projectionFailureWrites = projectionFailure.writes;
delete projectionFailure.deps.projectCard;
const repairedAmendment = await commandReconcile({ root: projectionFailure.root }, { card: AMEND_CARD }, projectionFailure.deps);
eq(repairedAmendment.action, 'reconciled', 'reconciliation repairs a failed contract projection without replaying amendment');
eq(projectionFailure.state.cards[AMEND_CARD].contract_amendments.length, 1, 'reconciliation never replays or duplicates the amendment audit');
ok(projectionFailure.writes > projectionFailureWrites, 'reconciliation persists projection recovery');
ok(/mechanism:delivery/.test(fs.readFileSync(projectionFailure.cardPath, 'utf8')), 'reconciliation projects the authoritative deployment contract');
eq((await commandReconcile({ root: projectionFailure.root }, { card: AMEND_CARD }, projectionFailure.deps)).no_op, true, 'second contract reconciliation is idempotent');

const beforeAuthorityCrash = makeAmendFixture();
beforeAuthorityCrash.deps.beforeAuthority = () => { throw new Error('crash before authority'); };
await assert.rejects(() => commandAmendContract({ root: beforeAuthorityCrash.root }, beforeAuthorityCrash.args, beforeAuthorityCrash.deps), /crash before authority/);
eq(beforeAuthorityCrash.writes, 0, 'crash before authority leaves no ledger amendment');
eq(beforeAuthorityCrash.state.cards[AMEND_CARD].deploy_subscriptions, legacyDeployments, 'crash before authority preserves the old contract');
eq(fs.readFileSync(beforeAuthorityCrash.cardPath, 'utf8'), beforeAuthorityCrash.cardSnapshot, 'crash before authority leaves projection untouched');

const afterAuthorityCrash = makeAmendFixture();
afterAuthorityCrash.deps.afterAuthority = () => { throw new Error('crash after authority'); };
await assert.rejects(() => commandAmendContract({ root: afterAuthorityCrash.root }, afterAuthorityCrash.args, afterAuthorityCrash.deps), /crash after authority/);
eq(afterAuthorityCrash.writes, 1, 'crash after authority preserves exactly one authoritative ledger update');
eq(afterAuthorityCrash.state.cards[AMEND_CARD].deploy_subscriptions, typedDeployments, 'crash after authority preserves the new contract');
eq(fs.readFileSync(afterAuthorityCrash.cardPath, 'utf8'), afterAuthorityCrash.cardSnapshot, 'crash after authority leaves projection recoverably stale');
ok(projectionMetadataProblem(afterAuthorityCrash.state.cards[AMEND_CARD], afterAuthorityCrash.root), 'status detection exposes the post-authority projection boundary');
const postAuthorityStatus = commandStatus({ root: afterAuthorityCrash.root }, {
  state: afterAuthorityCrash.state,
  boardMd: fs.readFileSync(afterAuthorityCrash.boardPath, 'utf8'),
  loadCard: () => null,
  cardsRoot: afterAuthorityCrash.root,
});
ok(postAuthorityStatus.projection_problems.some((problem) => problem.card === AMEND_CARD), 'coordinator status reports the post-authority contract projection problem');
delete afterAuthorityCrash.deps.afterAuthority;
eq((await commandReconcile({ root: afterAuthorityCrash.root }, { card: AMEND_CARD }, afterAuthorityCrash.deps)).action, 'reconciled', 'reconciliation repairs the post-authority crash boundary');

const afterProjectionCrash = makeAmendFixture();
afterProjectionCrash.deps.afterProjection = () => { throw new Error('crash after projection'); };
await assert.rejects(() => commandAmendContract({ root: afterProjectionCrash.root }, afterProjectionCrash.args, afterProjectionCrash.deps), /crash after projection/);
eq(afterProjectionCrash.writes, 1, 'crash after projection preserves the authoritative update before final projection receipt');
ok(/mechanism:delivery/.test(fs.readFileSync(afterProjectionCrash.cardPath, 'utf8')), 'crash after projection preserves the fully projected card contract');
delete afterProjectionCrash.deps.afterProjection;
const afterProjectionRecovery = await commandReconcile({ root: afterProjectionCrash.root }, { card: AMEND_CARD }, afterProjectionCrash.deps);
eq(afterProjectionRecovery.results[0].projection_changed, false, 'after-projection recovery does not rewrite an already exact card');
eq(afterProjectionCrash.state.cards[AMEND_CARD].contract_amendments.length, 1, 'after-projection recovery never duplicates authority');
eq(fs.readFileSync(path.join(afterProjectionCrash.worktree, 'protected.txt'), 'utf8'), afterProjectionCrash.worktreeSnapshot, 'every crash boundary preserves target worktree bytes');

const parkRoot = path.join(tmp, 'park');
fs.mkdirSync(parkRoot, { recursive: true });
const parkBoardPath = path.join(parkRoot, 'sauce-board.md');
const parkCardPath = path.join(parkRoot, 'Park me.md');
fs.writeFileSync(parkBoardPath, liveBoard({ progress: ['Park me'] }));
fs.writeFileSync(parkCardPath, [
  '---', 'kanban_column: In Progress', 'status: in_progress',
  'parent_card: "[[Shared parent]]"', 'depends_on: []', '---', 'body',
].join('\n'));
const oldReviews = Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, {
  lens, verdict: 'pass', head_sha: 'old-head', summary: `${lens} passed the old head`,
}]));
const oldGate = passingReceipt('old-head');
const priorInvalidation = {
  invalidated_at: '2026-07-14T12:00:00.000Z', reason: 'older invalidation', head_sha: 'older-head', reviews: {}, gate_receipt: null,
};
const parkState = emptyState();
parkState.cards['Park me'] = {
  card: 'Park me', phase: 'implementing', parent_card: '[[Shared parent]]', card_path: parkCardPath,
  branch: 'codex-autoloop/park-me', worktree: '/worktrees/park-me', touch_zones: ['platform/park-me'],
  reviews: oldReviews, gate_receipt: oldGate, receipt_invalidations: [priorInvalidation],
};
const parkLocks = [];
let parkWrites = 0;
const parkDeps = {
  readState: () => parkState,
  writeState: () => { parkWrites++; },
  withLock: async (_ctx, name, fn) => { parkLocks.push(name); return fn(); },
  boardPath: parkBoardPath,
  findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  now: () => '2026-07-15T16:00:00.000Z',
};
await assert.rejects(() => commandPark({ root: parkRoot }, {
  card: 'Park me', 'depends-on': 'Park me', 'resume-condition': 'wait for myself',
}, parkDeps), /cannot depend on itself/, 'park rejects self-dependencies');
await assert.rejects(() => commandPark({ root: parkRoot }, {
  card: 'Park me', 'depends-on': 'Missing prerequisite', 'resume-condition': 'wait for it',
}, parkDeps), /prerequisite card .* does not exist/, 'park rejects missing prerequisite cards');
await assert.rejects(() => commandPark({ root: parkRoot }, {
  card: 'Park me', 'depends-on': 'Prerequisite A', 'resume-condition': '   ',
}, parkDeps), /non-empty --resume-condition/, 'park requires an exact non-empty resume condition');
parkState.cards['Park me'].phase = 'feature_pr';
await assert.rejects(() => commandPark({ root: parkRoot }, {
  card: 'Park me', 'depends-on': 'Prerequisite A', 'resume-condition': 'wait for deployment',
}, parkDeps), /claimed pre-PR work/, 'park refuses post-feature-PR phases');
parkState.cards['Park me'].phase = 'implementing';
const parked = await commandPark({ root: parkRoot }, {
  card: 'Park me', 'depends-on': ['Prerequisite A', 'Prerequisite B'], 'resume-condition': 'Both prerequisites deploy cleanly',
}, parkDeps);
eq(parked.action, 'parked', 'park succeeds through the explicit command');
eq(parkLocks.slice(-3), ['selector', 'gates-park-me', 'completion-projection'], 'park serializes selector, card transition, and metadata projection');
eq(parkState.cards['Park me'].phase, 'parked', 'park records the durable parked phase');
eq(parkState.cards['Park me'].dependencies, ['Prerequisite A', 'Prerequisite B'], 'park records exact prerequisite names');
eq(parkState.cards['Park me'].resume_condition, 'Both prerequisites deploy cleanly', 'park records exact resume condition');
eq(parkState.cards['Park me'].branch, 'codex-autoloop/park-me', 'park preserves the branch');
eq(parkState.cards['Park me'].worktree, '/worktrees/park-me', 'park preserves the worktree');
eq(parkState.cards['Park me'].reviews, oldReviews, 'park preserves historical review receipts');
eq(parkState.cards['Park me'].gate_receipt, oldGate, 'park preserves the combined gate receipt');
ok(/depends_on: \["\[\[Prerequisite A\]\]","\[\[Prerequisite B\]\]"\]/.test(fs.readFileSync(parkCardPath, 'utf8')), 'park projects exact dependencies into card metadata');
ok(/resume_condition: "Both prerequisites deploy cleanly"/.test(fs.readFileSync(parkCardPath, 'utf8')), 'park projects the resume condition into card metadata');
ok(parkWrites >= 2, 'park saves authoritative state before and after projection for crash recovery');
const claimedParkState = emptyState();
claimedParkState.cards.Claimed = { card: 'Claimed', phase: 'claimed', card_path: parkCardPath };
eq((await commandPark({ root: parkRoot }, {
  card: 'Claimed', 'depends-on': 'Prerequisite A', 'resume-condition': 'Prerequisite A deploys',
}, {
  ...parkDeps, readState: () => claimedParkState, writeState: () => {}, projectCard: () => ({ changed: false }),
})).action, 'parked', 'park accepts the claimed pre-implementation phase');
const parkRaceState = emptyState();
parkRaceState.cards.Race = { card: 'Race', phase: 'claimed', card_path: parkCardPath };
let parkSelectorEntered = false; let parkReadAfterSelector = false;
eq((await commandPark({ root: parkRoot }, {
  card: 'Race', 'depends-on': 'Prerequisite A', 'resume-condition': 'Prerequisite A deploys',
}, {
  ...parkDeps,
  readState: () => { parkReadAfterSelector = parkSelectorEntered; return parkRaceState; },
  writeState: () => {}, projectCard: () => ({ changed: false }),
  withLock: async (_ctx, name, fn) => {
    if (name === 'selector') {
      parkSelectorEntered = true;
      parkRaceState.cards.Race.phase = 'implementing';
    }
    return fn();
  },
})).action, 'parked', 'park waits for a competing claim transition before parking');
ok(parkReadAfterSelector, 'park rereads claimed state only after acquiring the selector lock');

const parkedStatus = commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: fs.readFileSync(parkBoardPath, 'utf8'), loadCard, state: parkState,
});
eq(parkedStatus.active_count, 0, 'parked cards do not count against capacity');
eq(parkedStatus.active, [], 'parked cards are excluded from the active list');
eq(parkedStatus.available_slots, 3, 'parked cards leave every capacity slot available');
eq(parkedStatus.parked, [{
  card: 'Park me', phase: 'parked', status: 'parked', model_profile: undefined, branch: 'codex-autoloop/park-me',
  dependencies: ['Prerequisite A', 'Prerequisite B'], resume_condition: 'Both prerequisites deploy cleanly',
  parked_at: '2026-07-15T16:00:00.000Z', projection_error: null,
}], 'status lists parked cards separately with prerequisites and resume condition');
eq(parkedStatus.tracked.find((record) => record.card === 'Park me').status, 'parked', 'all-tracked status view includes canonical parked');

const crashCardPath = path.join(parkRoot, 'Crash parked.md');
const crashBoardPath = path.join(parkRoot, 'crash-board.md');
const obsidianParkedRewrite = [
  '---', 'kanban_column: In Progress', 'status: in-progress', 'status_prev: parked',
  'status_changed_at: 2026-07-16', 'depends_on: []', '---', '',
  '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
  '## Crash parked', '', 'body', '',
].join('\n');
fs.writeFileSync(crashCardPath, obsidianParkedRewrite);
fs.writeFileSync(crashBoardPath, liveBoard({ progress: ['Crash parked'] }));
const crashParkState = emptyState();
crashParkState.cards['Crash parked'] = {
  card: 'Crash parked', phase: 'parked', card_path: crashCardPath,
  dependencies: ['Prerequisite A'], resume_condition: 'Prerequisite A deploys',
};
eq(commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: fs.readFileSync(crashBoardPath, 'utf8'), loadCard, state: crashParkState,
}).projection_problems, [{
  card: 'Crash parked', phase: 'parked', expected_column: 'In Progress', actual_column: 'In Progress',
  expected_status: 'parked', actual_status: 'in_progress',
  error: 'card metadata differs from the authoritative ledger; reconcile before continuing',
}], 'status detects a crash between authoritative park state and card metadata projection');
eq(crashParkState.cards['Crash parked'].phase, 'parked', 'authoritative ledger remains parked while human projection says in_progress');
const crashBeforeRefusal = JSON.stringify(crashParkState.cards['Crash parked']);
eq((await commandResume({ root: parkRoot }, { card: 'Crash parked' }, {
  ...parkDeps, readState: () => crashParkState, writeState: () => {}, boardPath: crashBoardPath,
})).action, 'resume-refused', 'resume directly refuses ledger/card metadata divergence without a saved projection error');
eq(JSON.stringify(crashParkState.cards['Crash parked']), crashBeforeRefusal, 'metadata-divergence refusal preserves the parked record byte-for-byte');
let crashReconcileWrites = 0;
const crashReconcileDeps = {
  readState: () => crashParkState, writeState: () => { crashReconcileWrites++; },
  withLock: immediateCardLock, boardPath: crashBoardPath, now: () => '2026-07-15T16:02:00.000Z',
};
const crashReconciled = await commandReconcile({ root: parkRoot }, { card: 'Crash parked' }, crashReconcileDeps);
eq(crashReconciled.action, 'reconciled', 'parked reconciliation repairs an interrupted metadata projection');
ok(/status: parked/.test(fs.readFileSync(crashCardPath, 'utf8')), 'parked reconciliation restores parked card status');
ok(/depends_on: \["\[\[Prerequisite A\]\]"\]/.test(fs.readFileSync(crashCardPath, 'utf8')), 'parked reconciliation restores exact dependency metadata');
ok(/resume_condition: "Prerequisite A deploys"/.test(fs.readFileSync(crashCardPath, 'utf8')), 'parked reconciliation restores the exact resume condition');
ok(/status_prev: parked/.test(fs.readFileSync(crashCardPath, 'utf8')), 'reconciliation preserves Obsidian status history evidence');
ok(/status_changed_at: 2026-07-15T16:02:00.000Z/.test(fs.readFileSync(crashCardPath, 'utf8')), 'reconciliation records the canonical repair timestamp');
ok(/ProjectChromeBar/.test(fs.readFileSync(crashCardPath, 'utf8')), 'reconciliation preserves rewritten project chrome');
ok(!crashParkState.cards['Crash parked'].projection_error, 'parked reconciliation clears any projection error');
const writesAfterCrashReconcile = crashReconcileWrites;
eq((await commandReconcile({ root: parkRoot }, { card: 'Crash parked' }, crashReconcileDeps)).no_op, true, 'second parked reconciliation is idempotent');
eq(crashReconcileWrites, writesAfterCrashReconcile, 'idempotent parked reconciliation preserves state writes');
const crashAudit = commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: fs.readFileSync(crashBoardPath, 'utf8'), loadCard, state: crashParkState,
});
eq(crashAudit.projection_problems, [], 'post-reconciliation audit has zero parked projection problems');
eq(crashAudit.board_drift, [], 'post-reconciliation audit has zero parked board drift');
crashParkState.cards['Crash parked'].branch = 'codex-autoloop/crash-parked';
crashParkState.cards['Crash parked'].worktree = parkRoot;
crashParkState.cards['Crash parked'].touch_zones = ['platform/crash'];
fs.writeFileSync(crashBoardPath, liveBoard({ progress: ['Crash parked'], completed: [[true, 'Prerequisite A']] }));
const currentMainCalls = [];
const currentMainResume = await commandResume({ root: parkRoot }, { card: 'Crash parked' }, {
  ...parkDeps, readState: () => crashParkState, writeState: () => {}, boardPath: crashBoardPath,
  findCard: (_root, name) => name === 'Prerequisite A' ? '/cards/Prerequisite A.md' : null,
  worktreeExists: () => true,
  sh: (cmd, args) => {
    currentMainCalls.push([cmd, ...args]);
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse') return args[1] === 'origin/main' ? 'current-main' : 'branch-head';
    if (args[0] === 'merge-base') return '';
    throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
  },
  now: () => '2026-07-15T16:03:00.000Z',
});
eq(currentMainResume.action, 'implement', 'reconciled parked metadata becomes resume-eligible');
eq(currentMainResume.origin_main_advanced, false, 'resume reports current origin/main without a false stale warning');
eq(currentMainResume.requires_main_update, false, 'current origin/main does not require a branch update');
eq(currentMainCalls.map((call) => call.slice(0, 2)), [['git', 'fetch'], ['git', 'rev-parse'], ['git', 'rev-parse'], ['git', 'merge-base']], 'resume performs only the exact read-only Git freshness checks');

const failedParkState = emptyState();
failedParkState.cards.Failed = {
  card: 'Failed', phase: 'implementing', card_path: parkCardPath, branch: 'codex-autoloop/failed', worktree: '/worktrees/failed',
};
let failedParkWrites = 0;
const failedPark = await commandPark({ root: parkRoot }, {
  card: 'Failed', 'depends-on': 'Prerequisite A', 'resume-condition': 'Prerequisite A deploys',
}, {
  ...parkDeps, readState: () => failedParkState, writeState: () => { failedParkWrites++; },
  projectCard: () => { throw new Error('metadata projection denied'); },
});
eq(failedPark.action, 'parked-projection-failed', 'metadata projection failure is explicit');
eq(failedParkState.cards.Failed.phase, 'parked', 'failed metadata projection preserves authoritative parked state');
eq(failedParkState.cards.Failed.projection_error, 'metadata projection denied', 'failed metadata projection is saved for reconciliation');
ok(failedParkWrites >= 2, 'failed metadata projection persists both transition and failure receipt');
eq((await commandResume({ root: parkRoot }, { card: 'Failed' }, {
  ...parkDeps, readState: () => failedParkState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses a parked card with unresolved metadata projection failure');

const malformedResumeState = emptyState();
malformedResumeState.cards.Malformed = { card: 'Malformed', phase: 'parked', dependencies: [], resume_condition: 'later', card_path: parkCardPath };
const malformedBefore = JSON.stringify(malformedResumeState.cards.Malformed);
eq((await commandResume({ root: parkRoot }, { card: 'Malformed' }, {
  ...parkDeps, readState: () => malformedResumeState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses missing dependency metadata');
eq(JSON.stringify(malformedResumeState.cards.Malformed), malformedBefore, 'missing-dependency refusal preserves the parked record');
const invalidDependencyState = emptyState();
invalidDependencyState.cards.Invalid = { card: 'Invalid', phase: 'parked', dependencies: [42], resume_condition: 'later', card_path: parkCardPath };
const invalidBefore = JSON.stringify(invalidDependencyState.cards.Invalid);
eq((await commandResume({ root: parkRoot }, { card: 'Invalid' }, {
  ...parkDeps, readState: () => invalidDependencyState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses malformed dependency elements');
eq(JSON.stringify(invalidDependencyState.cards.Invalid), invalidBefore, 'malformed-dependency refusal preserves receipts and state');
const selfResumeState = emptyState();
selfResumeState.cards.Self = { card: 'Self', phase: 'parked', dependencies: ['Self'], resume_condition: 'later', card_path: parkCardPath };
const selfBefore = JSON.stringify(selfResumeState.cards.Self);
eq((await commandResume({ root: parkRoot }, { card: 'Self' }, {
  ...parkDeps, readState: () => selfResumeState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses a saved self-dependency');
eq(JSON.stringify(selfResumeState.cards.Self), selfBefore, 'self-dependency refusal preserves receipts and state byte-for-byte');
const emptyConditionState = emptyState();
emptyConditionState.cards.Empty = { card: 'Empty', phase: 'parked', dependencies: ['Prerequisite A'], resume_condition: ' ', card_path: parkCardPath };
const emptyConditionBefore = JSON.stringify(emptyConditionState.cards.Empty);
eq((await commandResume({ root: parkRoot }, { card: 'Empty' }, {
  ...parkDeps, readState: () => emptyConditionState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses an empty saved resume condition');
eq(JSON.stringify(emptyConditionState.cards.Empty), emptyConditionBefore, 'empty-condition refusal preserves receipts and state byte-for-byte');
const missingResumeState = emptyState();
missingResumeState.cards.Missing = {
  card: 'Missing', phase: 'parked', dependencies: ['Vanished prerequisite'], resume_condition: 'later', card_path: parkCardPath,
};
eq((await commandResume({ root: parkRoot }, { card: 'Missing' }, {
  ...parkDeps, readState: () => missingResumeState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses a dependency whose card no longer exists');

parkState.cards['Prerequisite A'] = {
  card: 'Prerequisite A', phase: 'deployed', required_version: '0.233.1', vault_receipts: successfulVaultReceipts('0.233.1'),
};
fs.writeFileSync(parkBoardPath, liveBoard({
  progress: ['Park me'], completed: [[true, 'Prerequisite A'], [true, 'Prerequisite B']],
}));
const resumeRaceState = emptyState();
resumeRaceState.cards.Target = {
  card: 'Target', phase: 'parked', parent_card: '[[Shared parent]]', card_path: parkCardPath,
  branch: 'codex-autoloop/target', worktree: parkRoot, touch_zones: ['platform/target'],
  dependencies: ['Prerequisite A', 'Prerequisite B'], resume_condition: 'Both prerequisites deploy cleanly',
};
resumeRaceState.cards.Contender = { card: 'Contender', phase: 'parked', parent_card: 'Shared parent', touch_zones: ['platform/contender'] };
let resumeSelectorEntered = false; let resumeReadAfterSelector = false;
const resumeRace = await commandResume({ root: parkRoot }, { card: 'Target' }, {
  ...parkDeps,
  readState: () => { resumeReadAfterSelector = resumeSelectorEntered; return resumeRaceState; },
  writeState: () => {}, worktreeExists: () => true,
  findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  withLock: async (_ctx, name, fn) => {
    if (name === 'selector') {
      resumeSelectorEntered = true;
      resumeRaceState.cards.Contender.phase = 'implementing';
    }
    return fn();
  },
});
eq(resumeRace.action, 'resume-refused', 'resume contender sees a sibling activated by the preceding selector transition');
ok(resumeReadAfterSelector, 'resume rereads state only after acquiring the shared selector lock');
eq(resumeRaceState.cards.Target.phase, 'parked', 'losing resume contender remains durably parked');
for (const name of ['Capacity 1', 'Capacity 2', 'Capacity 3']) {
  parkState.cards[name] = { card: name, phase: 'implementing', touch_zones: [`platform/${name.toLowerCase().replace(' ', '-')}`] };
}
eq((await commandResume({ root: parkRoot }, { card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  worktreeExists: () => true,
})).action, 'resume-refused', 'resume refuses to create a fourth active card');
for (const name of ['Capacity 1', 'Capacity 2', 'Capacity 3']) delete parkState.cards[name];
parkState.cards.Overlap = { card: 'Overlap', phase: 'implementing', touch_zones: ['platform/park-me'] };
eq((await commandResume({ root: parkRoot }, { card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  worktreeExists: () => true,
})).action, 'resume-refused', 'resume refuses an active touch-zone conflict');
delete parkState.cards.Overlap;
const preservedWorktree = parkState.cards['Park me'].worktree;
parkState.cards['Park me'].worktree = '/missing/parked-worktree';
eq((await commandResume({ root: parkRoot }, { card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  worktreeExists: () => false,
})).action, 'resume-refused', 'resume refuses a missing preserved parked worktree');
parkState.cards['Park me'].worktree = preservedWorktree;
parkState.cards.Sibling = {
  card: 'Sibling', phase: 'implementing', parent_card: 'Shared parent', touch_zones: ['platform/sibling'],
};
eq((await commandResume({ root: parkRoot }, { card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
})).action, 'resume-refused', 'resume refuses a second active child of the normalized parent');
parkState.cards.Sibling.phase = 'parked';
parkState.cards['Prerequisite A'].vault_receipts.ero.ok = false;
eq((await commandResume({ root: parkRoot }, { card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
})).action, 'resume-refused', 'resume refuses a tracked prerequisite with a failed required-vault receipt');
parkState.cards['Prerequisite A'].vault_receipts.ero.ok = true;
const gitCalls = [];
const resumeLockStart = parkLocks.length;
const resumed = await commandResume({ root: parkRoot }, { card: 'Park me' }, {
  ...parkDeps,
  findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  worktreeExists: () => true,
  sh: (cmd, args) => {
    gitCalls.push([cmd, ...args]);
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse') return args[1] === 'origin/main' ? 'new-main' : 'old-branch-head';
    if (args[0] === 'merge-base') throw new Error('origin/main is not an ancestor');
    throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
  },
  now: () => '2026-07-15T16:05:00.000Z',
});
eq(resumed.action, 'implement', 'resume succeeds only after every prerequisite is satisfied');
eq(resumed.origin_main_advanced, true, 'resume reports that origin/main advanced');
eq(resumed.requires_main_update, true, 'resume reports that the branch needs a manual update');
ok(!gitCalls.some((call) => ['merge', 'rebase', 'push'].includes(call[1])), 'resume never merges, rebases, or pushes automatically');
eq(parkLocks.slice(resumeLockStart), ['selector', 'gates-park-me', 'completion-projection'], 'resume serializes selector, card, and projection transitions in one lock order');
eq(parkState.cards['Park me'].phase, 'implementing', 'successful resume returns to implementing');
eq(parkState.cards['Park me'].reviews, {}, 'successful resume invalidates all current review receipts');
eq(parkState.cards['Park me'].gate_receipt, null, 'successful resume invalidates the combined gate receipt');
eq(parkState.cards['Park me'].receipt_invalidations.length, 2, 'successful resume appends one exact receipt invalidation');
eq(parkState.cards['Park me'].receipt_invalidations[0], priorInvalidation, 'successful resume preserves prior invalidation history');
eq(parkState.cards['Park me'].receipt_invalidations[1], {
  invalidated_at: '2026-07-15T16:05:00.000Z',
  reason: 'successful resume after parked prerequisites deployed; rerun every review and combined gate',
  head_sha: 'old-branch-head', reviews: oldReviews, gate_receipt: oldGate,
}, 'successful resume records the exact timestamp, head, reason, three reviews, and combined gate receipt');
eq(parkState.cards['Park me'].resume_condition, null, 'successful resume clears the active resume condition');
ok(!/^resume_condition:/m.test(fs.readFileSync(parkCardPath, 'utf8')), 'successful resume clears resume condition from card metadata');
eq(parkState.cards['Park me'].branch, 'codex-autoloop/park-me', 'resume preserves the branch');
eq(parkState.cards['Park me'].worktree, '/worktrees/park-me', 'resume preserves the worktree and implementation');

const reconcileRoot = path.join(tmp, 'projection');
fs.mkdirSync(reconcileRoot, { recursive: true });
const reconcileBoardPath = path.join(reconcileRoot, 'sauce-board.md');
const reconciledCardPath = path.join(reconcileRoot, 'Tracked deployed.md');
fs.writeFileSync(reconcileBoardPath, liveBoard({
  completed: [[true, 'Already completed']],
  archive: [[true, 'Tracked deployed'], [false, 'Archived unchecked work'], [true, 'Unrelated archived completion']],
}));
fs.writeFileSync(reconciledCardPath, '---\nkanban_column: Archive\nstatus: planning\n---\nbody\n');
const reconcileState = emptyState();
reconcileState.cards['Tracked deployed'] = {
  card: 'Tracked deployed', phase: 'deployed', card_path: reconciledCardPath,
  required_version: '0.233.0', vault_receipts: successfulVaultReceipts(),
};
const movedCardsRoot = path.join(reconcileRoot, 'cards');
const movedCardPath = path.join(movedCardsRoot, 'Parent after move', 'Moved deployed', 'Moved deployed.md');
fs.mkdirSync(path.dirname(movedCardPath), { recursive: true });
fs.writeFileSync(movedCardPath, '---\nkanban_column: Completed\nstatus: completed\n---\nbody\n');
const movedState = emptyState();
movedState.cards['Moved deployed'] = {
  card: 'Moved deployed', phase: 'deployed',
  card_path: path.join(movedCardsRoot, 'Moved deployed', 'Moved deployed.md'),
};
eq(commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: liveBoard({ completed: [[true, 'Moved deployed']] }), loadCard, state: movedState, cardsRoot: movedCardsRoot,
}).projection_problems, [], 'drift inspection resolves a current card after its parent folder moved');
let reconcileWrites = 0; let redeploys = 0;
const reconcileLocks = [];
const reconcileDeps = {
  readState: () => reconcileState,
  writeState: () => { reconcileWrites++; },
  withLock: async (_ctx, name, fn) => { reconcileLocks.push(name); return fn(); },
  boardPath: reconcileBoardPath,
  deployVault: () => { redeploys++; throw new Error('reconciliation must never deploy'); },
  now: () => '2026-07-15T15:00:00.000Z',
};
const receiptsBeforeReconcile = JSON.stringify(reconcileState.cards['Tracked deployed'].vault_receipts);
const driftBeforeReconcile = commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: fs.readFileSync(reconcileBoardPath, 'utf8'), loadCard, state: reconcileState,
});
eq(driftBeforeReconcile.board_drift, [{
  card: 'Tracked deployed', phase: 'deployed', expected_column: 'Completed', actual_column: 'Archive',
  expected_checked: true, actual_checked: true,
}], 'status reports deployed board drift separately from projection failures');
eq(driftBeforeReconcile.projection_problems, [{
  card: 'Tracked deployed', phase: 'deployed', expected_column: 'Completed', actual_column: 'Archive',
  expected_status: 'completed', actual_status: 'planning',
  error: 'card metadata differs from the authoritative ledger; reconcile before continuing',
}], 'status reports card projection problems independently from board drift');
const firstReconcile = await commandReconcile({ root: reconcileRoot }, { card: 'Tracked deployed' }, reconcileDeps);
eq(firstReconcile.action, 'reconciled', 'single-card reconciliation succeeds');
eq(reconcileLocks.slice(0, 2), ['gates-tracked-deployed', 'completion-projection'], 'reconciliation serializes card state then shared board projection');
eq(firstReconcile.changed, 1, 'first reconciliation repairs projection');
ok(/## Completed[\s\S]*- \[x\] \[\[Tracked deployed\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'deployed execution card moves to checked Completed');
ok(/## Archive[\s\S]*- \[ \] \[\[Archived unchecked work\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'unchecked Archive entry stays untouched');
ok(/## Archive[\s\S]*- \[x\] \[\[Unrelated archived completion\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'unrelated checked Archive entry stays untouched');
ok(/kanban_column: Completed/.test(fs.readFileSync(reconciledCardPath, 'utf8')), 'reconciliation repairs card column metadata');
ok(/status: completed/.test(fs.readFileSync(reconciledCardPath, 'utf8')), 'reconciliation repairs card status metadata');
eq(reconcileState.cards['Tracked deployed'].projection_reconciled_at, '2026-07-15T15:00:00.000Z', 'successful reconciliation records timestamp');
eq(JSON.stringify(reconcileState.cards['Tracked deployed'].vault_receipts), receiptsBeforeReconcile, 'reconciliation preserves saved deployment receipts');
eq(redeploys, 0, 'reconciliation never redeploys');
const writesAfterFirstReconcile = reconcileWrites;
const secondReconcile = await commandReconcile({ root: reconcileRoot }, { card: 'Tracked deployed' }, reconcileDeps);
eq(secondReconcile.changed, 0, 'second reconciliation is a projection no-op');
eq(secondReconcile.no_op, true, 'second reconciliation reports no-op');
eq(reconcileWrites, writesAfterFirstReconcile, 'second reconciliation does not rewrite ledger state');

const aliasCardPath = path.join(reconcileRoot, 'Alias implementing.md');
const ailsArtifactPath = path.join(reconcileRoot, 'AILS historical artifact.md');
const ops5ArtifactPath = path.join(reconcileRoot, 'GA-OPS5 historical artifact.md');
const aliasCardRaw = [
  '---', 'kanban_column: In Progress', 'status: in-progress', 'status_prev: planning',
  'status_changed_at: 2026-07-16', '---', '',
  '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
  'body', '',
].join('\n');
const ailsArtifactRaw = '---\nstatus: completed\n---\nHistorical AILS body and chrome.\n';
const ops5ArtifactRaw = '---\nstatus: planning\n---\nHistorical GA-OPS5 body and chrome.\n';
fs.writeFileSync(aliasCardPath, aliasCardRaw);
fs.writeFileSync(ailsArtifactPath, ailsArtifactRaw);
fs.writeFileSync(ops5ArtifactPath, ops5ArtifactRaw);
fs.writeFileSync(reconcileBoardPath, liveBoard({ planning: ['Alias implementing'], completed: [[true, 'Tracked deployed']] }));
reconcileState.cards['Alias implementing'] = { card: 'Alias implementing', phase: 'implementing', card_path: aliasCardPath };
const aliasDrift = commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: fs.readFileSync(reconcileBoardPath, 'utf8'), loadCard, state: reconcileState,
});
ok(!aliasDrift.projection_problems.some((problem) => problem.card === 'Alias implementing'), 'Obsidian in-progress alias is not false-positive projection drift');
ok(aliasDrift.board_drift.some((problem) => problem.card === 'Alias implementing'), 'lane mismatch remains independently visible as board drift');
const aliasReconcile = await commandReconcile({ root: reconcileRoot }, { card: 'Alias implementing' }, reconcileDeps);
eq(aliasReconcile.changed, 1, 'reconciliation repairs only the alias card board projection');
eq(fs.readFileSync(aliasCardPath, 'utf8'), aliasCardRaw, 'board-only reconciliation preserves status timestamps and chrome byte-for-byte');
eq(fs.readFileSync(ailsArtifactPath, 'utf8'), ailsArtifactRaw, 'historical AILS artifact remains byte-identical');
eq(fs.readFileSync(ops5ArtifactPath, 'utf8'), ops5ArtifactRaw, 'historical GA-OPS5 artifact remains byte-identical');
eq((await commandReconcile({ root: reconcileRoot }, { card: 'Alias implementing' }, reconcileDeps)).no_op, true, 'board-only repair is idempotent on its second run');

const implementingCardPath = path.join(reconcileRoot, 'Tracked implementing.md');
const blockedCardPath = path.join(reconcileRoot, 'Tracked blocked.md');
const waitingCardPath = path.join(reconcileRoot, 'Tracked waiting.md');
fs.writeFileSync(implementingCardPath, '---\nkanban_column: In Planning\nstatus: planning\n---\nbody\n');
fs.writeFileSync(blockedCardPath, '---\nkanban_column: In Progress\nstatus: in_progress\n---\nbody\n');
fs.writeFileSync(waitingCardPath, '---\nkanban_column: In Progress\nstatus: in_progress\n---\nbody\n');
fs.writeFileSync(reconcileBoardPath, liveBoard({
  planning: ['Parent roadmap card', 'Tracked implementing'],
  progress: ['Alias implementing', 'Tracked blocked', 'Tracked waiting'],
  completed: [[true, 'Tracked deployed']],
  archive: [[false, 'Archived unchecked work'], [true, 'Unrelated archived completion']],
}));
reconcileState.cards['Tracked implementing'] = { card: 'Tracked implementing', phase: 'implementing', card_path: implementingCardPath };
reconcileState.cards['Tracked blocked'] = { card: 'Tracked blocked', phase: 'blocked', card_path: blockedCardPath };
reconcileState.cards['Tracked waiting'] = { card: 'Tracked waiting', phase: 'feature_pr', card_path: waitingCardPath };
const allReconcile = await commandReconcile({ root: reconcileRoot }, {}, reconcileDeps);
eq(allReconcile.scope, 'all-tracked', 'reconcile without --card covers all tracked records');
eq(allReconcile.changed, 3, 'all-tracked reconciliation repairs implementing and blocked projections and records the waiting-phase check');
ok(/## In Planning[\s\S]*- \[ \] \[\[Parent roadmap card\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'all-tracked reconciliation does not move parent roadmap cards');
ok(/## In Progress[\s\S]*- \[ \] \[\[Tracked implementing\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'all-tracked reconciliation projects implementing lane');
ok(/## Blocked[\s\S]*- \[ \] \[\[Tracked blocked\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'all-tracked reconciliation projects blocked lane');
ok(/## In Progress[\s\S]*- \[ \] \[\[Tracked waiting\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'non-projectable tracked phase stays in place');
ok(/## Archive[\s\S]*- \[ \] \[\[Archived unchecked work\]\]/.test(fs.readFileSync(reconcileBoardPath, 'utf8')), 'all-tracked reconciliation preserves unrelated Archive entries');
const allReconcileAgain = await commandReconcile({ root: reconcileRoot }, {}, reconcileDeps);
eq(allReconcileAgain.changed, 0, 'second all-tracked reconciliation is a no-op');
eq(allReconcileAgain.no_op, true, 'all-tracked no-op is explicit');

reconcileState.cards['Tracked deployed'].projection_error = 'permission denied';
const terminalStatus = commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: fs.readFileSync(reconcileBoardPath, 'utf8'), loadCard, state: reconcileState,
});
ok(terminalStatus.tracked.some((record) => record.card === 'Tracked blocked' && record.status === 'blocked'), 'all-tracked status view includes canonical blocked');
ok(terminalStatus.tracked.some((record) => record.card === 'Tracked deployed' && record.status === 'completed'), 'all-tracked status view includes canonical completed');
ok(!terminalStatus.active.some((record) => record.card === 'Tracked deployed'), 'deployed card with projection failure is not counted active');
eq(terminalStatus.projection_problems, [{ card: 'Tracked deployed', phase: 'deployed', error: 'permission denied' }], 'status exposes saved terminal projection failure');
const failedCompletion = await stepCard({ root: reconcileRoot }, reconcileState, reconcileState.cards['Tracked deployed']);
eq(failedCompletion.action, 'completion-projection-failed', 'deployed card never reports clean completion while projection failed');
eq(failedCompletion.deployment, 'deployed', 'failed completion preserves authoritative deployment truth');
eq(failedCompletion.receipts, reconcileState.cards['Tracked deployed'].vault_receipts, 'failed completion still returns vault receipts');
const repairedSavedError = await commandReconcile({ root: reconcileRoot }, { card: 'Tracked deployed' }, reconcileDeps);
eq(repairedSavedError.action, 'reconciled', 'successful reconciliation repairs a saved terminal projection failure');
ok(!reconcileState.cards['Tracked deployed'].projection_error, 'successful reconciliation clears saved projection error');
eq((await stepCard({ root: reconcileRoot }, reconcileState, reconcileState.cards['Tracked deployed'])).action, 'complete', 'clean projection restores clean completion output');

const automaticProjectionRecord = {
  card: 'Automatic deployed', phase: 'deployed', card_path: path.join(reconcileRoot, 'automatic.md'),
  required_version: '0.233.0', vault_receipts: successfulVaultReceipts(),
};
const automaticReceiptsBefore = JSON.stringify(automaticProjectionRecord.vault_receipts);
let automaticProjectionLock = '';
const automaticProjection = await attemptProjection({ root: reconcileRoot }, automaticProjectionRecord, reconcileBoardPath, {
  withLock: async (_ctx, name, fn) => { automaticProjectionLock = name; return fn(); },
  projectCard: () => { throw new Error('automatic completion projection denied'); },
  now: () => '2026-07-15T15:00:30.000Z',
});
eq(automaticProjectionLock, 'completion-projection', 'automatic completion projection uses the shared board lock');
eq(automaticProjection.ok, false, 'deployment-time projection failure is returned');
eq(automaticProjectionRecord.projection_error, 'automatic completion projection denied', 'deployment-time projection failure is saved on the deployed record');
eq(completionResult(automaticProjectionRecord).action, 'completion-projection-failed', 'saved automatic projection failure blocks clean completion');
eq(JSON.stringify(automaticProjectionRecord.vault_receipts), automaticReceiptsBefore, 'automatic projection failure preserves successful deployment receipts');

const failedProjectionState = emptyState();
failedProjectionState.cards.Failed = {
  card: 'Failed', phase: 'deployed', card_path: path.join(reconcileRoot, 'missing-card.md'),
  vault_receipts: successfulVaultReceipts(), projection_error: 'old projection failure',
};
let failedProjectionWrites = 0;
const failedProjectionReceiptsBefore = JSON.stringify(failedProjectionState.cards.Failed.vault_receipts);
const failedReconcile = await commandReconcile({ root: reconcileRoot }, { card: 'Failed' }, {
  readState: () => failedProjectionState,
  writeState: () => { failedProjectionWrites++; },
  withLock: immediateCardLock,
  boardPath: reconcileBoardPath,
  projectCard: () => { throw new Error('card note missing'); },
  now: () => '2026-07-15T15:01:00.000Z',
});
eq(failedReconcile.action, 'reconcile-failed', 'projection failure remains explicit');
eq(failedProjectionState.cards.Failed.projection_error, 'card note missing', 'latest projection error stays saved');
eq(failedProjectionWrites, 1, 'failed projection persists its error without touching receipts');
eq(JSON.stringify(failedProjectionState.cards.Failed.vault_receipts), failedProjectionReceiptsBefore, 'failed reconciliation preserves saved receipt values');
fs.rmSync(tmp, { recursive: true, force: true });

const subscription = JSON.parse(fs.readFileSync(path.join(__dirname, '../../ranch/platform-subscription.json'), 'utf8'));
const subscribed = new Set([...(subscription.mechanisms || []), ...(subscription.blueprints || [])].map((item) => item.name));
for (const [kind, items] of [['mechanisms', subscription.mechanisms || []], ['blueprints', subscription.blueprints || []]]) {
  for (const item of items) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, `../${kind}/${item.name}/manifest.json`), 'utf8'));
    for (const dependency of manifest.depends_on || []) {
      ok(subscribed.has(dependency.name), `workshop subscription closes ${item.name} -> ${dependency.name}`);
    }
  }
}

console.log(`CODEX-AUTOLOOP PASS (${count} assertions)`);
})().catch((err) => { console.error(err); process.exit(1); });
