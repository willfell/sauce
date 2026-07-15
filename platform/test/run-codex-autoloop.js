#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  emptyState, atomicWriteJson, writeState, lockIsStale, lockDirectoryIsStale, normalizeZone, zonesOverlap,
  conflictsWithActive, parseExecutionMeta, validateExecutionMeta,
  selectClaimCandidate, summarizeClaimSelection, commandStatus, checkRollup, versionFrom, isReleasableTitle,
  gateReceiptStatus, pathCoveredByTouchZones, releasePrWaitReceipt, commandRecordReview, commandVerifyGates,
  commandRecordPr, stepCard, moveBoardCard, patchFrontmatter,
} = require('../../scripts/autoloop/codex-coordinator');

let count = 0;
function ok(value, label) { assert.ok(value, label); count++; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); count++; }

function card({ profile = 'standard', zones = ['platform/mechanisms/example'], deps = [], deploy = true } = {}) {
  return [
    '---',
    `model_profile: ${profile}`,
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

eq(normalizeZone('./platform/mechanisms/x/'), 'platform/mechanisms/x', 'normalizes zones');
ok(zonesOverlap('platform/mechanisms/x', 'platform/mechanisms/x/sub'), 'parent and child overlap');
ok(!zonesOverlap('platform/mechanisms/x', 'platform/mechanisms/y'), 'siblings do not overlap');
eq(conflictsWithActive({ touchZones: ['package.json'] }, [{ card: 'A', touch_zones: ['package.json'] }]).card, 'A', 'exclusive zone conflicts');

const board = (planning, completed = []) => [
  '## In Planning', ...planning.map((c) => `- [ ] [[${c}]]`), '',
  '## In Progress', '', '## Blocked', '',
  '## Completed', ...completed.map((c) => `- [x] [[${c}]]`), '',
].join('\n');
const bodies = {
  A: card({ zones: ['platform/a'] }),
  B: card({ zones: ['platform/b'], deps: ['Done'] }),
  C: card({ zones: ['platform/c'] }),
  Done: card(),
};
const loadCard = (name) => bodies[name] ? { path: `/cards/${name}.md`, raw: bodies[name] } : null;

let state = emptyState();
eq(selectClaimCandidate({ boardMd: board(['A']), state, loadCard }).card, 'A', 'selects first eligible card');
state.cards.Done = { card: 'Done', phase: 'feature_merged', touch_zones: [] };
eq(selectClaimCandidate({ boardMd: board(['B', 'C'], ['Done']), state, loadCard }).card, 'C', 'requires dependency deployed, skips to next');
state.cards.Done.phase = 'deployed';
eq(selectClaimCandidate({ boardMd: board(['B'], ['Done']), state, loadCard }).card, 'B', 'deployed dependency satisfies gate');

state = emptyState();
state.cards.Active = { card: 'Active', phase: 'feature_pr', touch_zones: ['platform/a'] };
eq(selectClaimCandidate({ boardMd: board(['A', 'C']), state, loadCard }).card, 'C', 'touch-zone conflict skips to disjoint card');
state.cards.Busy2 = { card: 'Busy2', phase: 'release_pr', touch_zones: ['platform/z'] };
state.cards.Busy3 = { card: 'Busy3', phase: 'tap_pr', touch_zones: ['platform/y'] };
eq(selectClaimCandidate({ boardMd: board(['C']), state, loadCard }).action, 'at-capacity', 'three active claims enforce cap');

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
  status: 'pass', head_sha: head, behavioral,
  checks: { adequacy: 'pass', release_preflight: 'pass', workshop_self_install: 'pass', release_preflight_bumped: 'pass' },
  reviews: behavioral ? Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, { lens, head_sha: head, verdict: 'pass' }])) : {},
});
ok(gateReceiptStatus({ gate_receipt: passingReceipt() }, 'head42').valid, 'complete current gate receipt is valid');
ok(!gateReceiptStatus({ gate_receipt: passingReceipt('old') }, 'head42').valid, 'stale gate receipt is invalid');
ok(pathCoveredByTouchZones('platform/mechanisms/x/a.js', ['platform/mechanisms/x']), 'touch zone covers descendants');
ok(!pathCoveredByTouchZones('platform/test/run-x.js', ['platform/mechanisms/x']), 'touch zone rejects undeclared files');
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

const recordState = emptyState();
recordState.cards.A = { card: 'A', branch: 'autoloop/a', worktree: '/worktrees/a', phase: 'implementing' };
const basePr = {
  number: 42, state: 'OPEN', title: 'test(preflight): guard orphan harnesses', url: 'https://example.test/pr/42',
  baseRefName: 'main', headRefName: 'autoloop/a', headRefOid: 'head42', autoMergeRequest: null,
};
const staleGateRecord = { card: 'A', phase: 'feature_pr', feature_pr: 42, gate_receipt: passingReceipt('old') };
eq((await stepCard({ root: '/workshop' }, emptyState(), staleGateRecord, {}, {
  prView: () => ({ ...basePr, title: 'fix(x): y', headRefOid: 'new', statusCheckRollup: [] }),
})).action, 'verify-gates', 'feature PR refuses stale local gates before auto-merge');
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
assert.throws(() => commandRecordPr({ root: '/workshop' }, { card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => basePr,
  sh: () => { throw new Error('git or gh must not run for a rejected title'); },
  writeState: () => { writes++; },
  armFeatureAutoMerge: () => { merges++; },
}), /will not trigger a release/, 'record-pr rejects a non-releasable title');
eq(writes, 0, 'rejected title is not persisted');
eq(merges, 0, 'rejected title never arms auto-merge');
eq(recordState.cards.A.phase, 'implementing', 'rejected title leaves the recorded phase unchanged');

assert.throws(() => commandRecordPr({ root: '/workshop' }, { card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, title: 'fix(autoloop): require gate receipts' }),
  sh: (cmd, args) => args[0] === 'status' ? '' : 'head42',
  writeState: () => { writes++; },
}), /gate receipt is missing/, 'record-pr refuses a clean matching PR without gate receipts');

const events = [];
recordState.cards.A.gate_receipt = passingReceipt();
const accepted = commandRecordPr({ root: '/workshop' }, { card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, title: 'fix(autoloop): guard release triggering' }),
  sh: (cmd, args) => {
    if (cmd === 'git' && args[0] === 'status') return '';
    if (cmd === 'git' && args[0] === 'rev-parse') return 'head42';
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  },
  writeState: () => { events.push('write'); writes++; },
});
eq(accepted.action, 'recorded', 'record-pr accepts a releasable title');
eq(events, ['write'], 'record-pr persists validated state without arming auto-merge before CI is green');

const reviewState = emptyState();
reviewState.cards.Review = { card: 'Review', branch: 'autoloop/review', worktree: os.tmpdir(), phase: 'implementing', gate_receipt: passingReceipt() };
const review = commandRecordReview({ root: '/workshop' }, {
  card: 'Review', lens: 'correctness', verdict: 'pass', summary: 'No correctness defect found in the reviewed diff.',
}, {
  readState: () => reviewState, sh: () => 'review-head', writeState: () => {},
});
eq(review.head_sha, 'review-head', 'review receipt is tied to the exact commit');
eq(reviewState.cards.Review.gate_receipt, null, 'new review invalidates an earlier combined gate receipt');

reviewState.cards.Review.touch_zones = ['scripts/autoloop', 'platform/test'];
reviewState.cards.Review.reviews = Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, {
  lens, verdict: 'pass', refuted: false, summary: `${lens} review found no release-blocking defect.`, head_sha: 'review-head',
}]));
const gateCalls = [];
const verified = commandVerifyGates({ root: '/workshop' }, { card: 'Review' }, {
  readState: () => reviewState,
  writeState: () => {},
  runIsolatedWorkshopSelfInstall: () => { gateCalls.push('self-install'); },
  sh: (cmd, args) => {
    if (cmd === 'git' && args[0] === 'status') return '';
    if (cmd === 'git' && args[0] === 'rev-parse') return 'review-head';
    if (cmd === 'git' && args[0] === 'diff') return 'scripts/autoloop/codex-coordinator.js\nplatform/test/run-codex-autoloop.js';
    if (cmd === 'node' && args[0] === 'scripts/autoloop/gate.js') return JSON.stringify({ behavioral: true, adequate: true, reason: 'red then green' });
    if (cmd === 'npm') { gateCalls.push(args[1]); return ''; }
    throw new Error(`unexpected gate command: ${cmd} ${args.join(' ')}`);
  },
});
eq(verified.action, 'gates-passed', 'verify-gates records a passing combined receipt');
eq(gateCalls, ['release:preflight', 'self-install', 'release:preflight-bumped'], 'verify-gates owns every deterministic release check');
ok(gateReceiptStatus(reviewState.cards.Review, 'review-head').valid, 'combined receipt is accepted after every check passes');

const moved = moveBoardCard(board(['A', 'C']), 'A', 'In Progress');
ok(!/## In Planning\n- \[ \] \[\[A\]\]/.test(moved), 'removes card from source lane');
ok(/## In Progress\n\n- \[ \] \[\[A\]\]/.test(moved), 'adds card to target lane');
const completed = moveBoardCard(moved, 'A', 'Completed', true);
ok(/## Completed\n\n- \[x\] \[\[A\]\]/.test(completed), 'marks completed projection checked');

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
