#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  emptyState, atomicWriteJson, writeState, lockIsStale, lockDirectoryIsStale, normalizeZone, zonesOverlap,
  conflictsWithActive, parseExecutionMeta, validateExecutionMeta,
  selectClaimCandidate, summarizeClaimSelection, commandStatus, checkRollup, versionFrom, moveBoardCard, patchFrontmatter,
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

console.log(`CODEX-AUTOLOOP PASS (${count} assertions)`);
