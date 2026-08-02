#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AsyncLocalStorage, createHook } = require('async_hooks');
const { execFileSync, spawn } = require('child_process');
const { EventEmitter } = require('events');
const Module = require('module');
const { PassThrough } = require('stream');
const {
  parseCommit: parseReleaseCommit,
  bumpLevel: releaseBumpLevel,
} = require('../../scripts/release/lib/conventional');
const { inc: incrementReleaseVersion } = require('../../scripts/release/lib/semver-inc');
const coordinatorModulePath = require.resolve('../../scripts/autoloop/codex-coordinator');
const priorImportedBoardTopology = process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
const hadPriorImportedCoordinatorCache = Object.prototype.hasOwnProperty.call(require.cache, coordinatorModulePath);
const priorImportedCoordinatorCache = require.cache[coordinatorModulePath];
let coordinator;
try {
  delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
  delete require.cache[coordinatorModulePath];
  coordinator = require(coordinatorModulePath);
} finally {
  delete require.cache[coordinatorModulePath];
  if (hadPriorImportedCoordinatorCache) require.cache[coordinatorModulePath] = priorImportedCoordinatorCache;
  if (priorImportedBoardTopology === undefined) delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
  else process.env.SAUCE_LOOP_BOARD_TOPOLOGY = priorImportedBoardTopology;
}
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, coordinatorModulePath),
  hadPriorImportedCoordinatorCache,
  'LOOP-BOUND-TOPOLOGY-PREWARMED-CACHE-LEAK restores caller coordinator cache presence exactly',
);
if (hadPriorImportedCoordinatorCache) {
  assert.strictEqual(
    require.cache[coordinatorModulePath],
    priorImportedCoordinatorCache,
    'LOOP-BOUND-TOPOLOGY-PREWARMED-CACHE-LEAK restores caller coordinator cache identity exactly',
  );
}
assert.strictEqual(
  process.env.SAUCE_LOOP_BOARD_TOPOLOGY,
  priorImportedBoardTopology,
  'LOOP-BOUND-TOPOLOGY-PREWARMED-CACHE-LEAK restores caller topology environment byte-for-byte',
);
const {
  emptyState, atomicWriteJson, writeState, durablePathBarrier, lockIsStale, lockDirectoryIsStale, normalizeZone, zonesOverlap,
  cardGateLockName, legacyCardGateLockName, withCardGateLock,
  parseArgs,
  conflictsWithActive, parseExecutionMeta, validateExecutionMeta,
  normalizeCardLink, sameParentConflict, dependencySatisfied, resolveEpicBoardSet, selectEpicCandidate, selectEpicShadowCandidate,
  selectClaimCandidate, selectCoordinatorCandidate, summarizeClaimSelection,
  commandStatus, commandStatusLocked, commandAmendContract,
  commandPark: rawCommandPark, commandResume: rawCommandResume,
  commandDiscard, commandReap, commandRestructure, commandReconcile, commandRecover, commandCutover,
  removeBoardCard, discardedDependencyProblem, stemOf, hasDeployedSupersedingSibling, canonicalEpicProjection,
  commandRecoverDeployed, commandReconcileMetadata, commandRestampContractFrontmatter,
  metadataReconciliationPlan, restampContractFrontmatter, contractFrontmatterRestampPlan,
  PARKED_METADATA_REBIND_CARDS,
  buildLoopStationPayload, validateLoopStationPayload, projectLoopStation,
  consumeRatificationReceipt, consumeRatificationArtifact,
  scaffoldPendingRatifications, ratificationArtifactForCard, ratificationStatus,
  commandBackfillRatifications, ratificationAcceptedWait, commandConsumeRatification,
  checkRollup, versionFrom, isReleasableTitle,
  gateReceiptStatus, pathCoveredByTouchZones, releasePrWaitReceipt,
  commandRecordReview: rawCommandRecordReview, commandVerifyGates,
  runIsolatedWorkshopSelfInstall, commandRecordPr: rawCommandRecordPr,
  commandAdvance, stepCard, moveBoardCard, patchFrontmatter,
  projectCard, attemptProjection, completionResult, projectionMapping, projectionBoardDrift, projectionMetadataProblem,
  collectDeployedRecoveryEvidence, formulaTagFromText, currentTapFormulaTag, tagContainsCommit, DELIVERY_STABLE_FIELDS,
} = coordinator;
const {
  normalizeStatus, parseCardStatus, parseBatchPolicy, parseCheckedColumn, selectCard,
  parseBoard, parseDependsOn,
  delivery, prepareDeliveryCard, prepareDeliveryObject,
} = require('../../scripts/autoloop/select-card');
const {
  EXIT_CODES, successReceipt, refusalReceipt, usage, requireOnlyOptions, validateReceiptEnvelope,
} = require('../../scripts/autoloop/cli-kit');
const deliveryStatusDigest = require('../../scripts/autoloop/delivery-status-digest');
const commandPark = rawCommandPark;
const commandResume = rawCommandResume;
const commandRecordReview = rawCommandRecordReview;
const commandRecordPr = rawCommandRecordPr;

let count = 0;
function ok(value, label) { assert.ok(value, label); count++; }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); count++; }
function testSha256(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
function testScalarField(raw, key) {
  const frontmatter = String(raw).match(/^---\n([\s\S]*?)\n---/);
  const line = frontmatter && frontmatter[1].split('\n').find((item) => item.startsWith(`${key}:`));
  return line ? line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '') : '';
}

function card({ profile = 'standard', zones = ['Docs/example.md'], deps = [], deploy = true, parent = 'Test parent', name = 'Test card' } = {}) {
  const policy = delivery.derivePolicy({ touch_zones: zones, batch_policy: 'continue' });
  const evidence = [{
    source_identity: 'autoloop test', captured_at: '2026-07-17T06:00:00Z',
    revision: 'fixture-v1', locator: 'platform/test/run-codex-autoloop.js', claim: 'Bounded test card.',
  }];
  return [
    '---',
    `card: ${name}`,
    `schema_version: ${delivery.CONTRACT_VERSION}`,
    `parent_card: "[[${parent}]]"`,
    'slice: T1',
    `model_profile: ${profile}`,
    'execution_mode: release',
    `batch_policy: ${policy}`,
    'status: planning',
    'touch_zones:', ...zones.map((z) => `  - ${z}`),
    ...(deps.length ? ['depends_on:', ...deps.map((d) => `  - "[[${d}]]"`)] : ['depends_on: []']),
    ...(deploy ? ['deploy_subscriptions:', '  headspace: []', '  accuris: []', '  ero: []'] : []),
    'context_pack: "Docs/test-context.md"',
    'epic: "[[Test epic]]"',
    `evidence: ${JSON.stringify(evidence)}`,
    'risk_dimensions: []',
    'release_required: true',
    'deployment_required: true',
    '---', '', '# Work', '', 'Bounded work.',
  ].join('\n');
}

function canonicalEpicSlice({ name, epic, zones = ['Docs/example.md'], deps = [] }) {
  return card({ name, parent: epic, zones, deps })
    .replace('---\n', [
      '---',
      'type: slice',
      `task_parent: "tasks/${epic}/${epic}.md"`,
      `source_board: "tasks/${epic}/board/${epic}-board.md"`,
      `kanban_board: "tasks/${epic}/board/${epic}-board.md"`,
      '',
    ].join('\n'))
    .replace('epic: "[[Test epic]]"', `epic: "[[${epic}]]"`);
}

(async () => {

const meta = parseExecutionMeta(card({ profile: 'heavy', zones: ['platform/install.js', 'platform/test/run-x.js'], deps: ['A'] }));
eq(meta.modelProfile, 'heavy', 'parses model profile');
eq(meta.touchZones, ['platform/install.js', 'platform/test/run-x.js'], 'parses touch zones');
eq(meta.dependencies, ['A'], 'parses dependencies');
eq(meta.deploySubscriptions, { headspace: [], accuris: [], ero: [] }, 'parses deployment map');
eq(validateExecutionMeta(meta), [], 'valid execution metadata');
eq(meta.contractVersion, delivery.CONTRACT_VERSION, 'coordinator reports the shared Delivery contract version');
eq(meta.contractSource, 'current', 'versioned execution metadata uses the current Delivery path');
ok(validateExecutionMeta(parseExecutionMeta(card({ deploy: false }))).includes('deploy_subscriptions is required'), 'deployment map required');
ok(validateExecutionMeta(parseExecutionMeta(card({ profile: 'luna' }))).some((e) => /model_profile/.test(e)), 'only two model profiles');

const currentRaw = card();
const historicalRaw = currentRaw.replace(`schema_version: ${delivery.CONTRACT_VERSION}\n`, '').replace('batch_policy: continue\n', '');
const historicalSnapshot = historicalRaw;
const historicalPrepared = prepareDeliveryCard(historicalRaw, 'Test card');
ok(historicalPrepared.ok, 'unversioned historical cards are readable through the shared compatibility path');
eq(historicalPrepared.source, 'historical', 'unversioned cards are identified as historical');
eq(historicalPrepared.card.schema_version, delivery.CONTRACT_VERSION, 'historical cards migrate in memory to the current schema');
eq(historicalRaw, historicalSnapshot, 'historical compatibility never rewrites the protected source note');
const stalePrepared = prepareDeliveryCard(currentRaw.replace(`schema_version: ${delivery.CONTRACT_VERSION}`, 'schema_version: 0.9.0'), 'Test card');
ok(stalePrepared.ok && stalePrepared.migration.applied.some((item) => /schema_version/.test(item)), 'stale schema versions migrate deterministically in memory');
const sparseStaleObject = JSON.parse(JSON.stringify(delivery.registry.fixtures.base_execution_card));
sparseStaleObject.schema_version = '0.9.0';
for (const field of ['execution_mode', 'depends_on', 'deploy_subscriptions', 'release_required', 'deployment_required', 'batch_policy']) delete sparseStaleObject[field];
const sparseStalePrepared = prepareDeliveryObject(sparseStaleObject);
ok(sparseStalePrepared.ok, 'coordinator permits shared migration-owned backfills on stale historical cards');
eq(sparseStalePrepared.card.depends_on, [], 'historical migration backfills dependencies');
eq(sparseStalePrepared.card.deploy_subscriptions, { headspace: [], accuris: [], ero: [] }, 'historical migration backfills the deployment map');
ok(!prepareDeliveryCard(currentRaw.replace(`schema_version: ${delivery.CONTRACT_VERSION}`, 'schema_version: 9.0.0'), 'Test card').ok, 'future schema versions fail closed');
ok(!prepareDeliveryCard(currentRaw.replace(`schema_version: ${delivery.CONTRACT_VERSION}`, 'schema_version: v1'), 'Test card').ok, 'malformed schema versions fail closed');
ok(!prepareDeliveryCard(currentRaw.replace('status: planning', 'status: mystery'), 'Test card').ok, 'unknown lifecycle vocabulary fails closed');
const emptyScalarDependency = parseExecutionMeta(currentRaw.replace('depends_on: []', 'depends_on: ""'));
ok(!emptyScalarDependency.contractOk, 'coordinator rejects an explicitly empty quoted scalar dependency');
ok(validateExecutionMeta(emptyScalarDependency).some((error) => /invalid-dependency:depends_on/.test(error)), 'coordinator surfaces the empty scalar dependency boundary error');
const nestedFlowDependency = parseExecutionMeta(currentRaw.replace('depends_on: []', 'depends_on: [[A], [B]]'));
ok(!nestedFlowDependency.contractOk, 'coordinator rejects nested YAML flow sequences as non-string dependencies');
ok(validateExecutionMeta(nestedFlowDependency).some((error) => /depends_on/.test(error)), 'coordinator surfaces nested dependency typing failure');
const blockEvidenceMeta = parseExecutionMeta(currentRaw.replace(/^evidence:.*$/m, [
  'evidence:', '  - source_identity: autoloop test', '    captured_at: "2026-07-17T06:00:00Z"',
  '    revision: fixture-v1', '    locator: platform/test/run-codex-autoloop.js', '    claim: Block evidence fixture.',
].join('\n')));
ok(blockEvidenceMeta.contractOk, 'coordinator accepts valid block YAML evidence-claim mappings');
const inlineDeploymentMeta = parseExecutionMeta(currentRaw.replace(
  'deploy_subscriptions:\n  headspace: []\n  accuris: []\n  ero: []',
  'deploy_subscriptions: {headspace: [], accuris: [], ero: []}',
));
ok(inlineDeploymentMeta.contractOk, 'coordinator accepts a valid inline YAML deployment map');
eq(inlineDeploymentMeta.deploySubscriptions, { headspace: [], accuris: [], ero: [] }, 'inline deployment map preserves every required vault');
const encodedStructuredRaw = currentRaw
  .replace(
    'deploy_subscriptions:\n  headspace: []\n  accuris: []\n  ero: []',
    `deploy_subscriptions: ${delivery.encodeStructuredFrontmatterValue(meta.deploySubscriptions)}`,
  )
  .replace(
    /^evidence:.*$/m,
    `evidence: ${delivery.encodeStructuredFrontmatterValue(meta.contract.evidence)}`,
  );
const encodedStructuredMeta = parseExecutionMeta(encodedStructuredRaw);
ok(encodedStructuredMeta.contractOk,
  'BGR-OBSY-READERS-BOTH-ENCODINGS coordinator accepts JSON-string structured fields');
eq(encodedStructuredMeta.deploySubscriptions, meta.deploySubscriptions,
  'BGR-OBSY-READERS-BOTH-ENCODINGS coordinator preserves byte-equivalent deployment maps');
eq(encodedStructuredMeta.contract.evidence, meta.contract.evidence,
  'BGR-OBSY-READERS-BOTH-ENCODINGS coordinator preserves byte-equivalent evidence');
const malformedStructuredMeta = parseExecutionMeta(encodedStructuredRaw.replace(
  /^evidence:.*$/m,
  `evidence: ${JSON.stringify('[{"source_identity":"unterminated"}')}`,
));
ok(!malformedStructuredMeta.contractOk
  && validateExecutionMeta(malformedStructuredMeta).some((error) => /invalid-structured-json:evidence/.test(error)),
'BGR-OBSY-READERS-BOTH-ENCODINGS coordinator refuses malformed JSON strings loudly');
const malformedDeploymentMeta = parseExecutionMeta(currentRaw.replace('  ero: []', '  ero: []\n    broken mapping line'));
ok(!malformedDeploymentMeta.contractOk, 'coordinator rejects unsupported indented deployment-map lines');
const flowDeploymentMeta = parseExecutionMeta(currentRaw.replace('  headspace: []', '  headspace: [mechanism:delivery]'));
ok(flowDeploymentMeta.contractOk, 'coordinator accepts unquoted YAML flow arrays for deployment additions');
eq(flowDeploymentMeta.deploySubscriptions.headspace, ['mechanism:delivery'], 'coordinator preserves typed unquoted flow deployment entries');
const commentedMeta = parseExecutionMeta(currentRaw
  .replace('parent_card: "[[Test parent]]"', 'parent_card: Test parent # first comment')
  .replace('  - Docs/example.md', '  - Docs/example.md # first comment'));
const differentlyCommentedMeta = parseExecutionMeta(currentRaw.replace('parent_card: "[[Test parent]]"', 'parent_card: Test parent # second comment'));
eq(commentedMeta.parentCard, 'Test parent', 'coordinator strips unquoted YAML comments from parent identity');
eq(commentedMeta.touchZones, ['Docs/example.md'], 'coordinator strips unquoted YAML comments from touch zones');
ok(sameParentConflict(differentlyCommentedMeta.parentCard, [{ card: 'Sibling', phase: 'implementing', parent_card: commentedMeta.parentCard }]), 'different comments cannot evade same-parent conflict detection');
ok(zonesOverlap(commentedMeta.touchZones[0], 'Docs/example.md'), 'commented touch zones retain exact conflict authority');
eq(parseExecutionMeta(currentRaw.replace('parent_card: "[[Test parent]]"', 'parent_card: "Test # literal"')).parentCard, 'Test # literal', 'quoted hash remains literal parent data');
const apostropheParentA = parseExecutionMeta(currentRaw.replace('parent_card: "[[Test parent]]"', "parent_card: Will's project # first"));
const apostropheParentB = parseExecutionMeta(currentRaw.replace('parent_card: "[[Test parent]]"', "parent_card: Will's project # second"));
eq(apostropheParentA.parentCard, "Will's project", 'apostrophe remains literal in a plain parent scalar');
ok(sameParentConflict(apostropheParentB.parentCard, [{ card: 'Sibling', phase: 'implementing', parent_card: apostropheParentA.parentCard }]), 'apostrophe-bearing parents cannot evade same-parent conflict via comments');
eq(parseExecutionMeta(currentRaw.replace('parent_card: "[[Test parent]]"', 'parent_card: Project "Alpha" # comment')).parentCard, 'Project "Alpha"', 'interior double quotes remain literal in a plain parent scalar');
const commentedStructuredMeta = parseExecutionMeta(currentRaw
  .replace('touch_zones:\n  - Docs/example.md', 'touch_zones: [Docs/example.md] # unchanged zones')
  .replace('depends_on: []', 'depends_on: [] # no dependencies')
  .replace('deploy_subscriptions:\n  headspace: []\n  accuris: []\n  ero: []', 'deploy_subscriptions: {headspace: [], accuris: [], ero: []} # unchanged map')
  .replace(/^evidence: (.*)$/m, 'evidence: $1 # pinned evidence')
  .replace('risk_dimensions: []', 'risk_dimensions: [] # no explicit risk'));
ok(commentedStructuredMeta.contractOk, 'coordinator accepts trailing comments on inline structured YAML');
eq(commentedStructuredMeta.touchZones, ['Docs/example.md'], 'structured comments do not alter touch-zone authority');
eq(commentedStructuredMeta.dependencies, [], 'structured comments do not invent dependencies');
eq(parseExecutionMeta(currentRaw.replace('touch_zones:\n  - Docs/example.md', 'touch_zones: ["Docs/hash # literal.md"] # trailing comment')).touchZones, ['Docs/hash # literal.md'], 'quoted hash inside a flow value remains literal');
eq(parseExecutionMeta(currentRaw.replace('touch_zones:\n  - Docs/example.md', "touch_zones: [Docs/Will's file.md] # trailing comment")).touchZones, ["Docs/Will's file.md"], 'apostrophe inside a plain flow path remains literal');
eq(parseExecutionMeta(currentRaw.replace('depends_on: []', "depends_on: [[Will's project]] # trailing comment")).dependencies, ["Will's project"], 'apostrophe inside a flow wikilink remains literal');
eq(parseExecutionMeta(currentRaw.replace('touch_zones:\n  - Docs/example.md', 'touch_zones: [Docs/Project "Alpha".md] # trailing comment')).touchZones, ['Docs/Project "Alpha".md'], 'interior double quote inside a plain flow path remains literal');
eq(parseExecutionMeta(currentRaw.replace('touch_zones:\n  - Docs/example.md', "touch_zones: ['Docs/Will''s, file.md'] # trailing comment")).touchZones, ["Docs/Will's, file.md"], 'doubled apostrophe preserves a comma inside a single-quoted flow path');
const spacedDeploymentMeta = parseExecutionMeta(currentRaw.replace('  headspace: []', '  headspace: [" mechanism:delivery "]'));
ok(spacedDeploymentMeta.contractOk, 'coordinator accepts canonicalizable deployment subscription whitespace');
eq(spacedDeploymentMeta.deploySubscriptions.headspace, ['mechanism:delivery'], 'coordinator trims deployment subscription tokens');
ok(!parseExecutionMeta(currentRaw.replace('  headspace: []', '  headspace: ["mechanism:delivery", " mechanism:delivery "]')).contractOk, 'coordinator still rejects whitespace-equivalent duplicate subscriptions');
const commentedBlockMeta = parseExecutionMeta(currentRaw
  .replace('touch_zones:\n  - Docs/example.md', 'touch_zones:\n  # canonical zone\n  - Docs/example.md')
  .replace('depends_on: []', 'depends_on:\n  # intentionally empty\n  []')
  .replace(/^evidence:.*$/m, [
    'evidence:', '  # pinned evidence', '  - source_identity: autoloop test', '    captured_at: "2026-07-17T06:00:00Z"',
    '    revision: fixture-v1', '    locator: platform/test/run-codex-autoloop.js', '    claim: Block evidence fixture.',
  ].join('\n'))
  .replace('risk_dimensions: []', 'risk_dimensions:\n  # no explicit risk\n  []'));
ok(commentedBlockMeta.contractOk, 'coordinator accepts comment-only lines inside block contract fields');
eq(commentedBlockMeta.touchZones, ['Docs/example.md'], 'block comments do not alter touch zones');
eq(commentedBlockMeta.dependencies, [], 'block comments do not alter dependencies');

const sharedFixtures = delivery.registry.fixtures;
const fixtureValue = (fixture) => {
  const value = JSON.parse(JSON.stringify(sharedFixtures.base_execution_card));
  for (const field of fixture.remove || []) delete value[field];
  return Object.assign(value, JSON.parse(JSON.stringify(fixture.patch || {})));
};
for (const fixture of sharedFixtures.valid) {
  ok(prepareDeliveryObject(fixtureValue(fixture)).ok, `coordinator adapter accepts shared valid fixture: ${fixture.name}`);
}
for (const fixture of sharedFixtures.invalid) {
  ok(!prepareDeliveryObject(fixtureValue(fixture)).ok, `coordinator adapter rejects shared invalid fixture: ${fixture.name}`);
}
eq(parseArgs(['park', '--depends-on', 'A', '--depends-on', 'B'])['depends-on'], ['A', 'B'], 'CLI preserves repeated dependency arguments');
eq(EXIT_CODES, { success: 0, refusal: 1, usage: 2 }, 'CS1-KIT-ENVELOPE exports the shared exit-code contract');
eq(successReceipt('changed', { card: 'A' }), {
  action: 'changed', ok: true, no_op: false, card: 'A',
}, 'CS1-KIT-ENVELOPE builds the additive success receipt');
eq(refusalReceipt('park-refused', 'json_required', 'park requires --json'), {
  action: 'park-refused', ok: false, no_op: false, code: 'json_required', message: 'park requires --json',
}, 'CS1-KIT-ENVELOPE builds the machine refusal receipt');
eq(validateReceiptEnvelope(successReceipt('changed')), { ok: true, errors: [] },
  'CS1-KIT-ENVELOPE validates a successful receipt');
eq(validateReceiptEnvelope(refusalReceipt('park-refused', 'json_required', 'park requires --json')),
  { ok: true, errors: [] }, 'CS1-KIT-ENVELOPE validates a refusal receipt');
eq(validateReceiptEnvelope({ action: 'broken', ok: true }).errors, ['no_op must be boolean'],
  'CS1-KIT-ENVELOPE rejects an incomplete envelope');
let unknownOptionError = null;
try {
  requireOnlyOptions({ _: ['park'], json: true, 'expected-heed': 'a'.repeat(40) },
    'park', ['json', 'card']);
} catch (error) {
  unknownOptionError = error;
}
eq({ action: unknownOptionError.action, code: unknownOptionError.code }, {
  action: 'park-refused', code: 'unknown_option',
}, 'CS1-KIT-ENVELOPE exports stable shared option allowlist enforcement');
let cliUsageError = null;
try {
  usage('record-pr-refused', 'invalid_arguments', 'record-pr requires --card and numeric --pr');
} catch (error) {
  cliUsageError = error;
}
eq(cliUsageError.exitCode, EXIT_CODES.usage,
  'CS1-KIT-ENVELOPE assigns exit code 2 to usage errors');
eq(projectionMapping('claimed').status, 'in_progress', 'claimed lifecycle projects to canonical in_progress');
eq(projectionMapping('feature_pr').status, 'in_progress', 'waiting release lifecycle remains canonical in_progress');
eq(projectionMapping('blocked').status, 'blocked', 'blocked lifecycle keeps canonical blocked');
eq(projectionMapping('parked').status, 'parked', 'parked remains distinct from its In Progress board lane');
eq(projectionMapping('deployed').status, 'completed', 'deployed lifecycle projects to canonical completed');
eq(normalizeStatus('in-progress'), 'in_progress', 'Obsidian in-progress alias normalizes at the coordinator boundary');

const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-delivery-drift-'));
const driftPath = path.join(driftRoot, 'Test card.md');
const currentContract = prepareDeliveryCard(currentRaw, 'Test card').card;
const projectedCurrentRaw = currentRaw.replace('status: planning', 'kanban_column: In Progress\nstatus: in_progress');
const currentRecord = {
  card: 'Test card', phase: 'implementing', card_path: driftPath,
  dependencies: currentContract.depends_on, touch_zones: currentContract.touch_zones,
  deploy_subscriptions: currentContract.deploy_subscriptions, delivery_contract: currentContract,
};
fs.writeFileSync(driftPath, projectedCurrentRaw.replace('card: Test card', 'card:   Test card  ')
  .replace('  - Docs/example.md', '  -   Docs/example.md   '));
eq(projectionMetadataProblem(currentRecord, driftRoot), null, 'whitespace-only Delivery projection changes canonicalize without drift');
fs.writeFileSync(driftPath, projectedCurrentRaw
  .replace('touch_zones:\n  - Docs/example.md', 'touch_zones:\n  # canonical zone\n  - Docs/example.md')
  .replace('depends_on: []', 'depends_on:\n  # intentionally empty\n  []')
  .replace(/^evidence:.*$/m, [
    'evidence:', '  # pinned evidence', '  - source_identity: autoloop test', '    captured_at: "2026-07-17T06:00:00Z"',
    '    revision: fixture-v1', '    locator: platform/test/run-codex-autoloop.js', '    claim: Bounded test card.',
  ].join('\n'))
  .replace('risk_dimensions: []', 'risk_dimensions:\n  # no explicit risk\n  []'));
eq(projectionMetadataProblem(currentRecord, driftRoot), null, 'comment-only block collection edits canonicalize without lifecycle drift');
fs.writeFileSync(driftPath, projectedCurrentRaw.replace('Docs/example.md', 'Docs/other.md'));
ok(/authoritative ledger/.test(projectionMetadataProblem(currentRecord, driftRoot).error), 'meaningful Delivery contract edits surface as lifecycle drift');
fs.writeFileSync(driftPath, projectedCurrentRaw.replace('card: Test card', 'card: Different card'));
ok(/identity-mismatch/.test(projectionMetadataProblem(currentRecord, driftRoot).error), 'authored identity drift cannot be masked by the ledger card name');
fs.writeFileSync(driftPath, projectedCurrentRaw.replace('context_pack: "Docs/test-context.md"', 'context_pack: "Docs/different-context.md"'));
ok(/authoritative ledger/.test(projectionMetadataProblem(currentRecord, driftRoot).error), 'context_pack changes surface as meaningful Delivery contract drift');
eq(DELIVERY_STABLE_FIELDS, delivery.registry.types['execution-card'].fields.map((field) => field.name), 'lifecycle drift fields derive from all 17 registry fields');

const coordinatorRatificationPayload = {
  schema_version: delivery.CONTRACT_VERSION,
  receipt_id: 'coordinator-ratification-fixture',
  decision: 'accepted',
  accepted_at: '2026-07-20T09:28:12-05:00',
  authority: 'Will',
  target_card: 'Exact full coordinator target card',
  target_head: 'd'.repeat(40),
  scope: ['consume the exact receipt without authenticating prose'],
};
const coordinatorRatificationHeading = 'Coordinator receipt — accepted 2026-07-20';
const coordinatorRatificationMarkdown = [
  '# Final Initial Design', '',
  'Exact full coordinator target card appears here outside the selected authority section.', '',
  `## ${coordinatorRatificationHeading}`, '',
  '```delivery-ratification', JSON.stringify(coordinatorRatificationPayload, null, 2), '```', '',
].join('\n');
const coordinatorParsedRatification = delivery.parseRatificationArtifact(
  coordinatorRatificationMarkdown,
  coordinatorRatificationHeading,
  { artifact_path: 'spice/projects/example/Final Initial Design.md' },
);
ok(coordinatorParsedRatification.ok, 'ES1-RAT-COORD-1 Delivery emits a valid first-class receipt for the coordinator');
ok(consumeRatificationArtifact(
  coordinatorRatificationMarkdown,
  coordinatorRatificationHeading,
  { artifact_path: 'spice/projects/example/Final Initial Design.md' },
  {
    target_card: coordinatorRatificationPayload.target_card,
    target_head: coordinatorRatificationPayload.target_head,
    decision: 'accepted',
  },
).ok, 'ES1-RAT-COORD-1b coordinator delegates artifact parsing to the Delivery receipt contract');
ok(consumeRatificationReceipt(coordinatorParsedRatification.receipt, {
  target_card: coordinatorRatificationPayload.target_card,
  target_head: coordinatorRatificationPayload.target_head,
  decision: 'accepted',
}).ok, 'ES1-RAT-COORD-2 coordinator consumes the exact target-card, HEAD, and decision receipt');
const truncatedCoordinatorPayload = {
  ...coordinatorRatificationPayload,
  target_card: 'Exact full coordinator target',
};
const truncatedCoordinatorMarkdown = coordinatorRatificationMarkdown.replace(
  JSON.stringify(coordinatorRatificationPayload, null, 2),
  JSON.stringify(truncatedCoordinatorPayload, null, 2),
);
const truncatedCoordinatorReceipt = delivery.parseRatificationArtifact(
  truncatedCoordinatorMarkdown,
  coordinatorRatificationHeading,
  { artifact_path: 'spice/projects/example/Final Initial Design.md' },
);
const truncatedCoordinatorVerdict = consumeRatificationReceipt(truncatedCoordinatorReceipt.receipt, {
  target_card: coordinatorRatificationPayload.target_card,
  target_head: coordinatorRatificationPayload.target_head,
});
ok(!truncatedCoordinatorVerdict.ok
  && truncatedCoordinatorVerdict.errors.some((issue) => issue.code === 'ratification-target-card-mismatch'),
'ES1-RAT-COORD-3 whole-file prose cannot complete a truncated selected-section target identity');
const substringCoordinatorReceipt = {
  ...coordinatorParsedRatification.receipt,
  target_head: `prefix-${coordinatorRatificationPayload.target_head}-suffix`,
};
const substringCoordinatorVerdict = consumeRatificationReceipt(substringCoordinatorReceipt, {
  target_card: coordinatorRatificationPayload.target_card,
  target_head: coordinatorRatificationPayload.target_head,
});
ok(!substringCoordinatorVerdict.ok
  && substringCoordinatorVerdict.errors.some((issue) => issue.code === 'invalid-target-head'),
'ES1-RAT-COORD-4 a containing parked-HEAD substring is never coordinator authority');
ok(!consumeRatificationReceipt(coordinatorParsedRatification.receipt, {
  target_card: coordinatorRatificationPayload.target_card,
  target_head: coordinatorRatificationPayload.target_head,
  decision: 'provisionally_accepted',
}).ok, 'ES1-RAT-COORD-5 coordinator binds the required ratification decision class');
const ledgerFieldValues = {
  schema_version: '9.0.0', card: 'Different ledger card', parent_card: 'Different parent', slice: 'T2',
  model_profile: 'heavy', execution_mode: 'docs_only', batch_policy: 'stop_after', epic: 'Different epic',
  context_pack: 'Docs/different-context.md',
  evidence: [{ source_identity: 'other', captured_at: '2026-07-17T06:00:00Z', revision: 'other-v1', locator: 'other', claim: 'Other claim.' }],
  risk_dimensions: ['shared_contract'], release_required: false, deployment_required: false,
};
for (const field of DELIVERY_STABLE_FIELDS) {
  const fieldRecord = JSON.parse(JSON.stringify(currentRecord));
  let fieldRaw = projectedCurrentRaw;
  if (field === 'status') fieldRaw = fieldRaw.replace('status: in_progress', 'status: blocked');
  else if (field === 'touch_zones') fieldRecord.touch_zones = ['Docs/other.md'];
  else if (field === 'depends_on') fieldRecord.dependencies = ['Other dependency'];
  else if (field === 'deploy_subscriptions') fieldRecord.deploy_subscriptions = { headspace: ['mechanism:delivery'], accuris: [], ero: [] };
  else fieldRecord.delivery_contract[field] = ledgerFieldValues[field];
  fs.writeFileSync(driftPath, fieldRaw);
  ok(projectionMetadataProblem(fieldRecord, driftRoot), `semantic lifecycle drift is detected for ${field}`);
}
const deploymentContractRaw = currentRaw.replace('  headspace: []', '  headspace: ["mechanism:delivery"]');
const deploymentContract = prepareDeliveryCard(deploymentContractRaw, 'Test card').card;
const deploymentRecord = {
  ...currentRecord,
  deploy_subscriptions: deploymentContract.deploy_subscriptions,
  delivery_contract: deploymentContract,
};
fs.writeFileSync(driftPath, deploymentContractRaw
  .replace('status: planning', 'kanban_column: In Progress\nstatus: in_progress')
  .replace('["mechanism:delivery"]', '[" mechanism:delivery "]'));
eq(projectionMetadataProblem(deploymentRecord, driftRoot), null, 'deployment token whitespace canonicalizes as lifecycle no-op');
fs.rmSync(driftRoot, { recursive: true, force: true });

const obsidianA1 = [
  '---', 'card: A1 status normalization and drift visibility',
  'parent_card: "[[Tranche A — trustworthy substrate]]"', 'slice: A1',
  'model_profile: heavy', 'execution_mode: release', 'kanban_column: In Planning', 'status: in-planning',
  'status_prev: planning', 'status_changed_at: 2026-07-16', 'touch_zones:', '  - scripts/autoloop/codex-coordinator.js',
  'depends_on: []', 'deploy_subscriptions:', '  headspace: []', '  accuris: []', '  ero: []',
  'epic: "[[Final Initial Design]]"', 'release_required: true', 'deployment_required: true', '---', '',
  '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
  '## A1 status normalization and drift visibility', '',
  'batch_policy: supervised_only — Normalize the live GA status vocabulary.', '',
  '### Evidence', '- legacy evidence',
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
  A: card({ name: 'A', zones: ['platform/a'] }),
  B: card({ name: 'B', zones: ['platform/b'], deps: ['Done'] }),
  C: card({ name: 'C', zones: ['platform/c'] }),
  Done: card({ name: 'Done' }),
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
const forcedSupervisionBody = card({ zones: ['scripts/autoloop/select-card.js'], profile: 'heavy', name: 'Control plane' });
eq(selectCard({ boardMd: board(['Control plane']), loadBody: () => forcedSupervisionBody }).action, 'no-eligible-work', 'selector enforces Delivery-derived control-plane supervision');
eq(selectCard({ boardMd: board(['Control plane']), loadBody: () => forcedSupervisionBody, supervised: true }).card, 'Control plane', 'selector accepts a Delivery-valid control-plane card only with supervision');
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
  Child2: card({ name: 'Child2', zones: ['platform/child-2'], parent: 'Shared parent' }),
  Child3: card({ name: 'Child3', zones: ['platform/child-3'], parent: 'Shared parent' }),
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
eq(eligibleSummary, {
  action: 'claim', card: 'A', model_profile: 'standard', touch_zones: ['platform/a'], skipped_count: 0,
  contract_version: delivery.CONTRACT_VERSION, contract_source: 'current', status: 'planning', batch_policy: 'continue',
}, 'summarizes next eligible card with Delivery contract provenance');
const blockedSummary = summarizeClaimSelection(selectClaimCandidate({ boardMd: board(['Missing']), state: emptyState(), loadCard }));
eq(blockedSummary.first_blocker, { card: 'Missing', reason: 'card note missing' }, 'summarizes the first board blocker');

const shadowRoot = '/vault/tasks';
const shadowParent = (planning = ['Epic A', 'Epic B', 'Flat Card'], progress = []) => [
  '## In Planning', ...planning.map((name) => `- [ ] [[${name}]]`), '',
  '## In Progress', ...progress.map((name) => `- [ ] [[${name}]]`), '',
  '## Blocked', '', '## Completed', '',
].join('\n');
const epicBoard = (planning = [], progress = [], completed = []) => [
  '---', 'board_role: epic', '---', '',
  '## In Planning', ...planning.map((name) => `- [ ] [[${name}]]`), '',
  '## In Progress', ...progress.map((name) => `- [ ] [[${name}]]`), '',
  '## Blocked', '',
  '## Completed', ...completed.map((name) => `- [x] [[${name}]]`), '',
].join('\n');
const shadowFiles = {
  '/vault/tasks/Epic A/Epic A.md': '---\ntype: epic\nepic_board: tasks/Epic A/board/Epic A-board.md\n---\n',
  '/vault/tasks/Epic A/board/Epic A-board.md': epicBoard(['A1', 'A2']),
  '/vault/tasks/Epic B/Epic B.md': '---\ntype: epic\nepic_board: spice/projects/test/tasks/Epic B/board/Epic B-board.md\n---\n',
  '/vault/tasks/Epic B/board/Epic B-board.md': epicBoard(['B1']),
};
const shadowBodies = {
  A1: card({ name: 'A1', parent: 'Epic A', zones: ['platform/a1'] }),
  A2: card({ name: 'A2', parent: 'Epic A', zones: ['platform/a2'], deps: ['A1'] }),
  B1: card({ name: 'B1', parent: 'Epic B', zones: ['platform/b1'] }),
  'Flat Card': card({ name: 'Flat Card', parent: 'Flat parent', zones: ['platform/flat'] }),
};
const shadowIo = (overrides = {}) => {
  const files = { ...shadowFiles, ...(overrides.files || {}) };
  const dirs = new Set(['/vault/tasks/Epic A/board', '/vault/tasks/Epic B/board', ...(overrides.dirs || [])]);
  return {
    files,
    exists: (target) => Object.prototype.hasOwnProperty.call(files, target) || dirs.has(target),
    readFile: (target) => {
      if (!Object.prototype.hasOwnProperty.call(files, target)) throw new Error(`missing ${target}`);
      return files[target];
    },
    readDir: (target) => Object.keys(files)
      .filter((file) => path.dirname(file) === target)
      .map((file) => ({ name: path.basename(file), isFile: () => true })),
    loadCard: (name) => shadowBodies[name] ? { path: `/cards/${name}.md`, raw: shadowBodies[name] } : null,
  };
};
const shadow = (extra = {}) => {
  const io = extra.io || shadowIo();
  const loader = extra.loadCard || io.loadCard;
  return selectEpicShadowCandidate({
    boardMd: extra.boardMd || shadowParent(), state: extra.state || emptyState(),
    loadCard: loader, loadEpicCard: extra.loadEpicCard || ((_epic, name) => loader(name)),
    supervised: true, cardsRoot: shadowRoot,
    readFile: io.readFile, readDir: io.readDir, exists: io.exists,
  });
};

const resolvedEpics = resolveEpicBoardSet({
  parentBoardMd: shadowParent(), cardsRoot: shadowRoot,
  readFile: shadowIo().readFile, readDir: shadowIo().readDir, exists: shadowIo().exists,
});
eq(resolvedEpics.epics.map((entry) => [entry.epic, entry.parent_order]), [['Epic A', 0], ['Epic B', 1]], 'ES3-STATE-01 resolver orders board_role epic pairs by parent board');
eq(resolvedEpics.flat.map((entry) => entry.card), ['Flat Card'], 'ES3-STATE-02 resolver retains flat cards as degenerate epics');
const seedEpicRoot = path.join(__dirname, 'seed-vault', 'spice', 'projects', 'epic-fixture');
const seedReadOnlyPaths = [
  'epic-fixture-board.md',
  'tasks/Alpha Epic/Alpha Epic.md',
  'tasks/Alpha Epic/board/Alpha Epic-board.md',
  'tasks/Beta Epic/Beta Epic.md',
  'tasks/Beta Epic/board/Beta Epic-board.md',
];
const seedBeforeResolve = seedReadOnlyPaths.map((file) => fs.readFileSync(path.join(seedEpicRoot, file), 'utf8'));
const seedResolved = resolveEpicBoardSet({
  parentBoardMd: fs.readFileSync(path.join(seedEpicRoot, 'epic-fixture-board.md'), 'utf8'),
  cardsRoot: path.join(seedEpicRoot, 'tasks'),
});
eq(seedResolved.epics.map((entry) => entry.epic), ['Alpha Epic', 'Beta Epic'], 'ES3-SEED-IO resolves both committed canonical epic pairs through real filesystem reads');
eq(seedResolved.flat.map((entry) => entry.card), ['Degenerate Flat Card'], 'ES3-SEED-IO preserves the committed legacy flat fixture');
eq(seedResolved.findings, [], 'ES3-SEED-IO reports no findings for the conformant committed fixture');
eq(seedReadOnlyPaths.map((file) => fs.readFileSync(path.join(seedEpicRoot, file), 'utf8')), seedBeforeResolve, 'ES3-SEED-IO real resolver path is byte-for-byte read-only');
eq(shadow().card, 'A1', 'ES3-STATE-03 parent order selects the first eligible epic slice');
eq(shadow({ boardMd: shadowParent(['Epic B', 'Epic A', 'Flat Card']) }).card, 'B1', 'ES3-STATE-04 operator priority inversion changes shadow selection deterministically');

const activeEpicState = emptyState();
activeEpicState.cards.B0 = { card: 'B0', parent_card: 'Epic B', phase: 'parked', touch_zones: [] };
eq(shadow({ state: activeEpicState }).card, 'B1', 'ES3-STATE-05 a parked slice makes its epic first without consuming capacity');

const blockedA = { ...shadowBodies, A1: card({ name: 'A1', parent: 'Epic A', zones: ['platform/a1'], deps: ['Missing'] }) };
eq(shadow({ loadCard: (name) => blockedA[name] ? { path: `/cards/${name}.md`, raw: blockedA[name] } : null }).card, 'B1', 'ES3-STATE-06 unmet dependency falls through to the next epic');
const crossEpicIo = shadowIo({ files: { '/vault/tasks/Epic B/board/Epic B-board.md': epicBoard(['B1'], [], ['B0']) } });
const crossEpicBodies = { ...shadowBodies, A1: card({ name: 'A1', parent: 'Epic A', zones: ['platform/a1'], deps: ['B0'] }) };
eq(shadow({
  io: crossEpicIo,
  loadCard: (name) => crossEpicBodies[name] ? { path: `/cards/${name}.md`, raw: crossEpicBodies[name] } : null,
}).card, 'A1', 'ES3-STATE-06B checked completion on another epic board satisfies the unchanged global dependency rule');
const uncheckedCrossEpicIo = shadowIo({ files: { '/vault/tasks/Epic B/board/Epic B-board.md': epicBoard(['B1'], [], ['B0']).replace('- [x] [[B0]]', '- [ ] [[B0]]') } });
eq(shadow({
  io: uncheckedCrossEpicIo,
  loadCard: (name) => crossEpicBodies[name] ? { path: `/cards/${name}.md`, raw: crossEpicBodies[name] } : null,
}).card, 'B1', 'ES3-STATE-06C unchecked Completed entries never satisfy a global dependency');
const conflictState = emptyState();
conflictState.cards.Other = { card: 'Other', phase: 'implementing', touch_zones: ['platform/a1'] };
eq(shadow({ state: conflictState }).card, 'B1', 'ES3-STATE-07 global touch-zone conflict and unchanged dependency ordering fall through to the next epic');

const noEpicBodies = { ...shadowBodies, A1: blockedA.A1, A2: card({ name: 'A2', parent: 'Epic A', zones: ['platform/a2'], deps: ['Missing'] }), B1: card({ name: 'B1', parent: 'Epic B', zones: ['platform/b1'], deps: ['Missing'] }) };
eq(shadow({ loadCard: (name) => noEpicBodies[name] ? { path: `/cards/${name}.md`, raw: noEpicBodies[name] } : null }).card, 'Flat Card', 'ES3-STATE-08 flat fallback remains selectable after epic fall-through');

const missingAtlasIo = shadowIo({ files: { '/vault/tasks/Epic A/Epic A.md': undefined } });
delete missingAtlasIo.files['/vault/tasks/Epic A/Epic A.md'];
missingAtlasIo.exists = (target) => Object.prototype.hasOwnProperty.call(missingAtlasIo.files, target) || ['/vault/tasks/Epic A/board', '/vault/tasks/Epic B/board'].includes(target);
const missingAtlas = selectEpicShadowCandidate({
  boardMd: shadowParent(['Epic A']), state: emptyState(), loadCard: missingAtlasIo.loadCard,
  supervised: true, cardsRoot: shadowRoot, readFile: missingAtlasIo.readFile,
  readDir: missingAtlasIo.readDir, exists: missingAtlasIo.exists,
});
eq(missingAtlas.findings[0].code, 'missing-epic-atlas', 'ES3-STATE-09 unpaired epic board fails closed with a resolver finding');
const mismatchIo = shadowIo({ files: { '/vault/tasks/Epic A/Epic A.md': '---\ntype: epic\nepic_board: tasks/Epic A/board/Wrong.md\n---\n' } });
const mismatch = selectEpicShadowCandidate({
  boardMd: shadowParent(['Epic A']), state: emptyState(), loadCard: mismatchIo.loadCard,
  supervised: true, cardsRoot: shadowRoot, readFile: mismatchIo.readFile,
  readDir: mismatchIo.readDir, exists: mismatchIo.exists,
});
eq(mismatch.findings[0].code, 'epic-atlas-mismatch', 'ES3-STATE-10 mismatched atlas backlink fails closed');
eq(shadow({ boardMd: shadowParent([], []) }).action, 'no-work', 'ES3-STATE-11 empty parent board returns no-work');
const missingBoardIo = shadowIo({ files: { '/vault/tasks/Epic C/Epic C.md': '---\ntype: epic\nepic_board: tasks/Epic C/board/Epic C-board.md\n---\n' } });
const missingBoard = resolveEpicBoardSet({
  parentBoardMd: shadowParent(['Epic C']), cardsRoot: shadowRoot,
  readFile: missingBoardIo.readFile, readDir: missingBoardIo.readDir, exists: missingBoardIo.exists,
});
eq(missingBoard.findings[0].code, 'missing-epic-board', 'ES3-STATE-12 typed epic atlas without a board fails closed instead of degrading to flat');

const lifecycleState = emptyState();
eq(shadow({ boardMd: shadowParent(['Epic A']), state: lifecycleState }).card, 'A1', 'ES3-LIFECYCLE-PLANNED selects the first planned slice');
lifecycleState.cards.A1 = { card: 'A1', parent_card: 'Epic A', phase: 'deployed', required_version: '1.0.0', touch_zones: ['platform/a1'], vault_receipts: successfulVaultReceipts('1.0.0') };
eq(shadow({ boardMd: shadowParent(['Epic A']), state: lifecycleState }).card, 'A2', 'ES3-LIFECYCLE-ACTIVE advances after deployed slice receipts');
lifecycleState.cards.A2 = { card: 'A2', parent_card: 'Epic A', phase: 'deployed', required_version: '1.0.0', touch_zones: ['platform/a2'], vault_receipts: successfulVaultReceipts('1.0.0') };
eq(shadow({ boardMd: shadowParent(['Epic A']), state: lifecycleState }).action, 'no-work', 'ES3-LIFECYCLE-DONE reaches no-work after the complete epic lifecycle');

const flagOff = selectClaimCandidate({ boardMd: board(['A']), state: emptyState(), loadCard });
const flagOffAgain = selectClaimCandidate({ boardMd: board(['A']), state: emptyState(), loadCard, epicShadow: false });
eq(flagOffAgain, flagOff, 'ES3-FLAG-OFF keeps legacy selector output byte-for-byte unchanged');
const fileSnapshot = JSON.stringify(shadowFiles);
const flagOn = selectClaimCandidate({
  boardMd: shadowParent(), state: emptyState(), loadCard: shadowIo().loadCard, supervised: true,
  epicShadow: true, cardsRoot: shadowRoot, readFile: shadowIo().readFile, readDir: shadowIo().readDir, exists: shadowIo().exists,
  loadEpicCard: (_epic, name) => shadowIo().loadCard(name),
});
eq(flagOn.shadow_selection.card, 'A1', 'ES3-FLAG-ON exposes the observational two-level selection beside legacy authority');
eq(JSON.stringify(shadowFiles), fileSnapshot, 'ES3-SHADOW-NO-WRITE leaves every resolver fixture byte-identical');
const priorShadowFlag = process.env.SAUCE_EPIC_SELECTION_SHADOW;
const priorBoardTopology = process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
process.env.SAUCE_EPIC_SELECTION_SHADOW = '1';
delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
let flaggedStatus;
try {
  const statusIo = shadowIo();
  flaggedStatus = commandStatus({ root: '/tmp/es3-shadow-status', statePath: '/tmp/es3-shadow-state.json' }, {
    state: emptyState(), boardMd: shadowParent(), loadCard: statusIo.loadCard,
    loadEpicCard: (_epic, name) => statusIo.loadCard(name),
    cardsRoot: shadowRoot, readFile: statusIo.readFile, readDir: statusIo.readDir, exists: statusIo.exists,
  });
} finally {
  if (priorShadowFlag === undefined) delete process.env.SAUCE_EPIC_SELECTION_SHADOW;
  else process.env.SAUCE_EPIC_SELECTION_SHADOW = priorShadowFlag;
  if (priorBoardTopology === undefined) delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
  else process.env.SAUCE_LOOP_BOARD_TOPOLOGY = priorBoardTopology;
}
assert.deepStrictEqual(
  process.env.SAUCE_LOOP_BOARD_TOPOLOGY,
  priorBoardTopology,
  'ES3-STATUS-FLAG restores the caller topology environment byte-for-byte',
);
eq(flaggedStatus.next.shadow_selection.card, 'A1', 'ES3-STATUS-FLAG invokes the production commandStatus environment-flag wiring');
eq(flaggedStatus.projection_problems, [], 'ES3-STATUS-FLAG remains observational and creates no tracked projection state');
const shadowCapacityState = emptyState();
for (const [index, zone] of ['x', 'y', 'z'].entries()) shadowCapacityState.cards[`Busy${index}`] = { card: `Busy${index}`, phase: 'implementing', touch_zones: [`platform/${zone}`] };
const shadowAtCapacity = selectClaimCandidate({
  boardMd: shadowParent(), state: shadowCapacityState, loadCard: shadowIo().loadCard, supervised: true,
  epicShadow: true, cardsRoot: shadowRoot, readFile: shadowIo().readFile, readDir: shadowIo().readDir, exists: shadowIo().exists,
  loadEpicCard: (_epic, name) => shadowIo().loadCard(name),
});
eq(shadowAtCapacity.action, 'at-capacity', 'ES3-STATE-13 legacy capacity remains authoritative');
eq(shadowAtCapacity.shadow_selection.action, 'at-capacity', 'ES3-STATE-13 shadow status still reports the same global capacity boundary');
eq(summarizeClaimSelection(shadowAtCapacity).shadow_selection.action, 'at-capacity', 'ES3-STATE-13 summarized status preserves the observational capacity receipt');

const cutoverActualState = emptyState();
cutoverActualState.cutover = { enabled: true, enabled_at: '2026-07-25T19:00:00.000Z', receipts: {} };
const cutoverActualIo = shadowIo();
const cutoverEpicLoader = (_epic, name) => cutoverActualIo.loadCard(name);
const cutoverActual = selectCoordinatorCandidate({
  boardMd: shadowParent(), state: cutoverActualState, loadCard: cutoverActualIo.loadCard, supervised: true,
  loadEpicCard: cutoverEpicLoader,
  cardsRoot: shadowRoot, readFile: cutoverActualIo.readFile, readDir: cutoverActualIo.readDir, exists: cutoverActualIo.exists,
});
eq(
  [cutoverActual.action, cutoverActual.card, cutoverActual.source, cutoverActual.epic, cutoverActual.board_path],
  ['claim', 'A1', 'epic', 'Epic A', '/vault/tasks/Epic A/board/Epic A-board.md'],
  'BGD-CUTOVER-ACTUAL-SELECTOR cutover-on authority selects the top epic frontier slice and records its board',
);
const duplicateSlice = 'DUP-1 Shared slice title';
const duplicateIo = shadowIo({
  files: {
    '/vault/tasks/Epic A/board/Epic A-board.md': epicBoard([duplicateSlice]),
    '/vault/tasks/Epic B/board/Epic B-board.md': epicBoard([duplicateSlice]),
    [`/vault/tasks/Epic A/board/${duplicateSlice}.md`]: canonicalEpicSlice({
      name: duplicateSlice, epic: 'Epic A', zones: ['platform/from-epic-a'],
    }),
    [`/vault/tasks/Epic B/board/${duplicateSlice}.md`]: canonicalEpicSlice({
      name: duplicateSlice, epic: 'Epic B', zones: ['platform/from-epic-b'],
    }),
  },
});
const duplicateSelection = selectCoordinatorCandidate({
  boardMd: shadowParent(['Epic A', 'Epic B']), state: cutoverActualState,
  loadCard: () => ({
    path: `/vault/tasks/Epic B/board/${duplicateSlice}.md`,
    raw: duplicateIo.files[`/vault/tasks/Epic B/board/${duplicateSlice}.md`],
  }),
  supervised: true, cardsRoot: shadowRoot,
  readFile: duplicateIo.readFile, readDir: duplicateIo.readDir, exists: duplicateIo.exists,
});
eq(
  [duplicateSelection.cardPath, normalizeCardLink(duplicateSelection.meta.parentCard), duplicateSelection.meta.touchZones],
  [`/vault/tasks/Epic A/board/${duplicateSlice}.md`, 'Epic A', ['platform/from-epic-a']],
  'GA-OPS13A-CROSS-EPIC-DUPLICATE-MISCLAIM binds a selected board line to the canonical slice beside that exact epic board',
);
const invalidDuplicateIo = shadowIo({
  files: {
    '/vault/tasks/Epic A/board/Epic A-board.md': epicBoard([duplicateSlice]),
    [`/vault/tasks/Epic A/board/${duplicateSlice}.md`]: canonicalEpicSlice({
      name: duplicateSlice, epic: 'Epic B', zones: ['platform/from-wrong-epic'],
    }),
  },
});
const invalidDuplicateSelection = selectCoordinatorCandidate({
  boardMd: shadowParent(['Epic A']), state: cutoverActualState,
  loadCard: () => ({
    path: `/vault/tasks/Epic B/board/${duplicateSlice}.md`,
    raw: duplicateIo.files[`/vault/tasks/Epic B/board/${duplicateSlice}.md`],
  }),
  supervised: true, cardsRoot: shadowRoot,
  readFile: invalidDuplicateIo.readFile, readDir: invalidDuplicateIo.readDir, exists: invalidDuplicateIo.exists,
});
ok(
  invalidDuplicateSelection.action === 'no-work'
    && invalidDuplicateSelection.skipped[0].reason.includes('epic slice binding invalid: epic must be Epic A'),
  'GA-OPS13A-CROSS-EPIC-DUPLICATE-MISCLAIM refuses a malformed board-local slice instead of resolving a same-title note from another epic',
);
const cutoverStatus = commandStatus({ root: '/tmp/bgd-cutover-status', statePath: '/tmp/bgd-cutover-state.json' }, {
  state: cutoverActualState, boardMd: shadowParent(), loadCard: cutoverActualIo.loadCard,
  loadEpicCard: cutoverEpicLoader,
  cardsRoot: shadowRoot, readFile: cutoverActualIo.readFile, readDir: cutoverActualIo.readDir, exists: cutoverActualIo.exists,
});
eq(
  [cutoverStatus.next.card, cutoverStatus.next.source, cutoverStatus.next.epic, cutoverStatus.next.board_path],
  [cutoverActual.card, cutoverActual.source, cutoverActual.epic, cutoverActual.board_path],
  'BGD-CUTOVER-STATUS-CLAIM-PARITY status exposes the exact authoritative claim card, epic, and board path',
);
const atlasLoadAttempts = [];
selectCoordinatorCandidate({
  boardMd: shadowParent(['Epic A']), state: cutoverActualState,
  loadCard: (name) => {
    if (name === 'Epic A') throw new Error('epic atlas must never be validated as an execution card');
    return cutoverActualIo.loadCard(name);
  },
  loadEpicCard: (_epic, name) => {
    atlasLoadAttempts.push(name);
    return cutoverActualIo.loadCard(name);
  },
  supervised: true, cardsRoot: shadowRoot,
  readFile: cutoverActualIo.readFile, readDir: cutoverActualIo.readDir, exists: cutoverActualIo.exists,
});
eq(atlasLoadAttempts, ['A1'], 'BGD-CUTOVER-ACTUAL-SELECTOR never loads the epic atlas through execution-card validation');
const cutoverBlockedBodies = {
  ...shadowBodies,
  A1: card({ name: 'A1', parent: 'Epic A', zones: ['platform/a1'], deps: ['Missing'] }),
  A2: card({ name: 'A2', parent: 'Epic A', zones: ['platform/a2'], deps: ['Missing'] }),
};
const cutoverBlocked = selectCoordinatorCandidate({
  boardMd: shadowParent(['Epic A']), state: cutoverActualState,
  loadCard: (name) => cutoverBlockedBodies[name] ? { path: `/cards/${name}.md`, raw: cutoverBlockedBodies[name] } : null,
  loadEpicCard: (_epic, name) => cutoverBlockedBodies[name] ? { path: `/cards/${name}.md`, raw: cutoverBlockedBodies[name] } : null,
  supervised: true, cardsRoot: shadowRoot,
  readFile: cutoverActualIo.readFile, readDir: cutoverActualIo.readDir, exists: cutoverActualIo.exists,
});
const cutoverBlockedStatus = commandStatus({ root: '/tmp/bgd-cutover-blocked', statePath: '/tmp/bgd-cutover-blocked-state.json' }, {
  state: cutoverActualState, boardMd: shadowParent(['Epic A']),
  loadCard: (name) => cutoverBlockedBodies[name] ? { path: `/cards/${name}.md`, raw: cutoverBlockedBodies[name] } : null,
  loadEpicCard: (_epic, name) => cutoverBlockedBodies[name] ? { path: `/cards/${name}.md`, raw: cutoverBlockedBodies[name] } : null,
  cardsRoot: shadowRoot, readFile: cutoverActualIo.readFile, readDir: cutoverActualIo.readDir, exists: cutoverActualIo.exists,
});
eq(
  cutoverBlockedStatus.next.first_blocker,
  cutoverBlocked.skipped[0],
  'BGD-CUTOVER-STATUS-CLAIM-PARITY status and claim preserve the same first refusal reason',
);
const cutoverOffState = emptyState();
cutoverOffState.cutover = { enabled: false, disabled_at: '2026-07-25T20:00:00.000Z', reason: 'fixture' };
const cutoverOffActual = selectCoordinatorCandidate({ boardMd: board(['A']), state: cutoverOffState, loadCard });
const cutoverOffLegacy = selectClaimCandidate({ boardMd: board(['A']), state: cutoverOffState, loadCard });
eq(cutoverOffActual, cutoverOffLegacy, 'BGD-CUTOVER-PRE-COMPAT cutover-off selection is byte-for-byte legacy-compatible');
const cutoverAbsentActual = selectCoordinatorCandidate({ boardMd: board(['A']), state: emptyState(), loadCard });
const cutoverAbsentLegacy = selectClaimCandidate({ boardMd: board(['A']), state: emptyState(), loadCard });
eq(cutoverAbsentActual, cutoverAbsentLegacy, 'BGD-CUTOVER-PRE-COMPAT absent cutover selection is byte-for-byte legacy-compatible');

// LOOP-EPIC-TOPOLOGY: SAUCE_LOOP_BOARD_TOPOLOGY=epic (fresh loop-plugin
// bindings) routes selection through the epic frontier even with NO cutover
// history in the ledger; absent flag keeps the legacy pre-cutover path above.
{
  const topologyCoordinatorPath = require.resolve('../../scripts/autoloop/codex-coordinator');
  const cachedTopologyCoordinator = require.cache[topologyCoordinatorPath];
  const priorTopologyEnvironment = process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
  process.env.SAUCE_LOOP_BOARD_TOPOLOGY = 'epic';
  delete require.cache[topologyCoordinatorPath];
  const topologyIo = shadowIo();
  let topologySelection;
  try {
    const boundSelectCoordinatorCandidate = require(topologyCoordinatorPath).selectCoordinatorCandidate;
    topologySelection = boundSelectCoordinatorCandidate({
      boardMd: shadowParent(), state: emptyState(), loadCard: topologyIo.loadCard, supervised: true,
      loadEpicCard: (_epic, name) => topologyIo.loadCard(name),
      cardsRoot: shadowRoot, readFile: topologyIo.readFile, readDir: topologyIo.readDir, exists: topologyIo.exists,
    });
  } finally {
    delete require.cache[topologyCoordinatorPath];
    if (cachedTopologyCoordinator) require.cache[topologyCoordinatorPath] = cachedTopologyCoordinator;
    if (priorTopologyEnvironment === undefined) delete process.env.SAUCE_LOOP_BOARD_TOPOLOGY;
    else process.env.SAUCE_LOOP_BOARD_TOPOLOGY = priorTopologyEnvironment;
  }
  eq(
    [topologySelection.action, topologySelection.card, topologySelection.source, topologySelection.epic],
    ['claim', 'A1', 'epic', 'Epic A'],
    'LOOP-EPIC-TOPOLOGY bound environment selects the epic frontier on a cutover-null ledger',
  );
}
const statusLockNames = [];
const lockedStatus = await commandStatusLocked({ root: '/tmp/bgd-cutover-locked', statePath: '/tmp/bgd-cutover-locked-state.json' }, {
  state: cutoverActualState, boardMd: shadowParent(), loadCard: cutoverActualIo.loadCard,
  loadEpicCard: cutoverEpicLoader,
  cardsRoot: shadowRoot, readFile: cutoverActualIo.readFile, readDir: cutoverActualIo.readDir, exists: cutoverActualIo.exists,
  withLock: async (_ctx, name, fn) => { statusLockNames.push(name); return fn(); },
});
eq(statusLockNames, ['selector'], 'BGD-CUTOVER-STATUS-CLAIM-PARITY operational status selects under the selector lock');
eq(lockedStatus.next.card, cutoverActual.card, 'BGD-CUTOVER-STATUS-CLAIM-PARITY locked status preserves the authoritative candidate');

eq(checkRollup([{ name: 'mac', status: 'COMPLETED', conclusion: 'SUCCESS' }]).green, true, 'green rollup');
eq(checkRollup([{ name: 'linux', status: 'IN_PROGRESS', conclusion: '' }]).pending, ['linux'], 'pending rollup');
eq(checkRollup([{ name: 'mac', status: 'COMPLETED', conclusion: 'FAILURE' }]).failed, ['mac'], 'failed rollup');
eq(versionFrom('chore(release): v0.232.1'), '0.232.1', 'extracts release version');
ok(isReleasableTitle('fix(autoloop): reject non-releasable PR titles'), 'fix title triggers a release');
ok(isReleasableTitle('feat!: replace the loop contract'), 'breaking feature title triggers a release');
ok(isReleasableTitle('perf(coordinator): reduce status latency'), 'release classifier accepts other patch types');
ok(!isReleasableTitle('test(preflight): guard orphan harnesses'), 'test-only title cannot enter the deploy loop');
ok(!isReleasableTitle('docs(autoloop): explain mobile prompts'), 'docs-only title cannot enter the deploy loop');
const passingReceipt = (head = 'head42', behavioral = true, prospectiveTitle = 'fix(x): y') => ({
  status: 'pass', head_sha: head, base_ref: 'origin/main', base_sha: 'base42', behavioral,
  prospective_pr_title: prospectiveTitle,
  checks: { adequacy: 'pass', release_preflight: 'pass', workshop_self_install: 'pass', release_preflight_bumped: 'pass' },
  reviews: behavioral ? Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, { lens, head_sha: head, verdict: 'pass' }])) : {},
});
ok(gateReceiptStatus({ gate_receipt: passingReceipt() }, 'head42').valid, 'complete current gate receipt is valid');
ok(!gateReceiptStatus({ gate_receipt: passingReceipt('old') }, 'head42').valid, 'stale gate receipt is invalid');
ok(!gateReceiptStatus({ gate_receipt: passingReceipt() }, 'head42', 'new-base').valid, 'stale base receipt is invalid for an open PR');
ok(!gateReceiptStatus({ gate_receipt: { ...passingReceipt(), prospective_pr_title: undefined } }, 'head42').valid,
  'gate receipt without a prospective PR title is invalid');
ok(!gateReceiptStatus({ gate_receipt: passingReceipt() }, 'head42', 'base42', 'fix(x): changed').valid,
  'gate receipt is invalid after the PR title changes');
// Merge-only receipts (verify-gates on deploy_vaults:[] bindings) record
// verify_commands instead of the sauce release checks; record-pr/advance must
// accept them while deploy-bound validation stays byte-identical.
const mergeOnlyReceipt = (checks) => ({
  ...passingReceipt(), merge_only: true,
  checks: checks || { adequacy: 'pass', verify_commands: { status: 'pass', commands: ['uv run pytest'] } },
});
ok(gateReceiptStatus({ gate_receipt: mergeOnlyReceipt() }, 'head42').valid,
  'merge-only receipt with passing verify_commands is valid');
ok(gateReceiptStatus({ gate_receipt: mergeOnlyReceipt({ adequacy: 'pass', verify_commands: { status: 'none-declared' } }) }, 'head42').valid,
  'merge-only receipt with none-declared verify_commands is valid (protected CI gates the merge)');
ok(!gateReceiptStatus({ gate_receipt: mergeOnlyReceipt({ adequacy: 'pass' }) }, 'head42').valid,
  'merge-only receipt without verify_commands is incomplete');
ok(!gateReceiptStatus({ gate_receipt: mergeOnlyReceipt({ verify_commands: { status: 'pass', commands: [] } }) }, 'head42').valid,
  'merge-only receipt without adequacy is incomplete');
ok(!gateReceiptStatus({ gate_receipt: { ...passingReceipt(), checks: { adequacy: 'pass', verify_commands: { status: 'pass', commands: ['x'] } } } }, 'head42').valid,
  'deploy-bound receipt still requires the release checks (merge_only flag absent)');
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

// LOOP-RELEASE-CI-RERUN-DEADEND: a release PR can move after the coordinator
// persisted its check failure. Only that exact blocked cause may re-enter the
// release rail; every unrelated or unusable blocked record remains terminal.
{
  const releaseFailure = 'release PR checks failed: preflight (macos-latest)';
  const releasePr = (overrides = {}) => ({
    number: 646,
    state: 'OPEN',
    title: 'chore(release): v0.267.0',
    url: 'https://example.test/pr/646',
    mergeCommit: null,
    statusCheckRollup: [{ name: 'preflight (macos-latest)', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...overrides,
  });
  const blockedRelease = (overrides = {}) => ({
    card: 'TD-1a9 Call-site-bound quick reschedule',
    phase: 'blocked',
    reason: releaseFailure,
    release_pr: 646,
    release_url: 'https://example.test/pr/646',
    feature_merge_sha: 'f'.repeat(40),
    ...overrides,
  });
  const withLineage = (deps = {}) => ({
    findContainingRelease: () => releasePr(),
    ...deps,
  });

  let mergedViews = 0; let mergedWrites = 0;
  const mergedRecord = blockedRelease();
  const mergedResult = await stepCard({ root: '/workshop' }, emptyState(), mergedRecord, {}, withLineage({
    prView: (_repo, number) => {
      mergedViews += 1;
      eq(number, 646, 'LOOP-RELEASE-CI-RERUN-DEADEND merged recovery views the exact recorded release PR');
      return releasePr({ state: 'MERGED', mergeCommit: { oid: 'a'.repeat(40) }, statusCheckRollup: null });
    },
    writeState: () => { mergedWrites += 1; },
  }));
  eq(mergedResult, {
    action: 'phase-change', phase: 'release_merged', release_pr: 646, version: '0.267.0',
  }, 'LOOP-RELEASE-CI-RERUN-DEADEND merged green rerun rejoins the release_merged rail');
  eq(mergedRecord.phase, 'release_merged',
    'LOOP-RELEASE-CI-RERUN-DEADEND merged recovery advances durable phase');
  eq(mergedRecord.release_merge_sha, 'a'.repeat(40),
    'LOOP-RELEASE-CI-RERUN-DEADEND merged recovery records the release merge SHA');
  eq(mergedRecord.required_version, '0.267.0',
    'LOOP-RELEASE-CI-RERUN-DEADEND merged recovery derives the required version from the recorded PR title');
  eq(mergedRecord.reason, undefined,
    'LOOP-RELEASE-CI-RERUN-DEADEND merged recovery clears the stale release-check failure');
  eq({ views: mergedViews, writes: mergedWrites }, { views: 1, writes: 1 },
    'LOOP-RELEASE-CI-RERUN-DEADEND merged recovery reads and persists exactly once');

  for (const [label, statusCheckRollup] of [
    ['green', [{ name: 'preflight (macos-latest)', status: 'COMPLETED', conclusion: 'SUCCESS' }]],
    ['pending', [{ name: 'preflight (macos-latest)', status: 'IN_PROGRESS', conclusion: '' }]],
  ]) {
    let writes = 0;
    const record = blockedRelease();
    const result = await stepCard({ root: '/workshop' }, emptyState(), record, {}, withLineage({
      prView: () => releasePr({ statusCheckRollup }),
      writeState: () => { writes += 1; },
    }));
    eq(result, {
      action: 'waiting', phase: 'release_pr', release_pr: 646, url: 'https://example.test/pr/646',
    }, `LOOP-RELEASE-CI-RERUN-DEADEND open ${label} rerun matches the existing release_pr waiting rail`);
    eq(record.phase, 'release_pr',
      `LOOP-RELEASE-CI-RERUN-DEADEND open ${label} rerun restores the durable release_pr phase`);
    eq(record.reason, undefined,
      `LOOP-RELEASE-CI-RERUN-DEADEND open ${label} rerun clears the stale failure`);
    eq(writes, 1,
      `LOOP-RELEASE-CI-RERUN-DEADEND open ${label} rerun persists exactly once`);
  }

  let failedWrites = 0;
  const stillFailedRecord = blockedRelease();
  const stillFailedDeps = withLineage({
    prView: () => releasePr({
      statusCheckRollup: [
        { name: 'preflight (macos-latest)', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'preflight (ubuntu-latest)', status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
    }),
    writeState: () => { failedWrites += 1; },
  });
  const stillFailedResult = await stepCard(
    { root: '/workshop' }, emptyState(), stillFailedRecord, {}, stillFailedDeps,
  );
  eq(stillFailedResult.action, 'blocked-external',
    'LOOP-RELEASE-CI-RERUN-DEADEND a still-failed rerun remains externally blocked');
  eq(stillFailedRecord.phase, 'blocked',
    'LOOP-RELEASE-CI-RERUN-DEADEND a still-failed rerun cannot reopen the release rail');
  eq(stillFailedRecord.reason,
    'release PR checks failed: preflight (macos-latest), preflight (ubuntu-latest)',
    'LOOP-RELEASE-CI-RERUN-DEADEND a still-failed rerun refreshes the deterministic failure reason');
  eq(failedWrites, 1,
    'LOOP-RELEASE-CI-RERUN-DEADEND a still-failed rerun persists current external evidence');
  const stillFailedReplay = await stepCard(
    { root: '/workshop' }, emptyState(), stillFailedRecord, {}, stillFailedDeps,
  );
  eq(stillFailedReplay, stillFailedResult,
    'LOOP-RELEASE-CI-RERUN-DEADEND repeated failed recovery returns a deterministic receipt');
  eq(stillFailedRecord.reason,
    'release PR checks failed: preflight (macos-latest), preflight (ubuntu-latest)',
    'LOOP-RELEASE-CI-RERUN-DEADEND repeated failed recovery keeps deterministic durable state');
  eq(failedWrites, 2,
    'LOOP-RELEASE-CI-RERUN-DEADEND repeated failed recovery persists each current evidence read once');

  const closedRecord = blockedRelease();
  const closedResult = await stepCard({ root: '/workshop' }, emptyState(), closedRecord, {}, withLineage({
    prView: () => releasePr({ state: 'CLOSED', statusCheckRollup: null }),
    writeState: () => { throw new Error('closed non-merged recovery must not mutate blocked state'); },
  }));
  eq(closedResult.action, 'blocked',
    'LOOP-RELEASE-CI-RERUN-DEADEND a closed non-merged release remains terminal');
  eq(closedRecord, blockedRelease(),
    'LOOP-RELEASE-CI-RERUN-DEADEND a closed non-merged release preserves blocked evidence byte-for-byte');

  const malformedRecord = blockedRelease();
  const malformedResult = await stepCard({ root: '/workshop' }, emptyState(), malformedRecord, {}, withLineage({
    prView: () => releasePr({ state: 'MERGED', title: 'chore(release): malformed', mergeCommit: null }),
    writeState: () => { throw new Error('malformed release recovery must fail closed without writes'); },
  }));
  eq(malformedResult.action, 'blocked',
    'LOOP-RELEASE-CI-RERUN-DEADEND malformed merged evidence fails closed');
  eq(malformedRecord, blockedRelease(),
    'LOOP-RELEASE-CI-RERUN-DEADEND malformed merged evidence preserves blocked state');

  const mismatchedContainingRelease = () => releasePr({
    number: 647,
    title: 'chore(release): v0.267.1',
    url: 'https://example.test/pr/647',
  });
  let mismatchedMergedWrites = 0;
  const mismatchedMergedRecord = blockedRelease();
  const mismatchedMergedResult = await stepCard(
    { root: '/workshop' }, emptyState(), mismatchedMergedRecord, {}, withLineage({
      findContainingRelease: mismatchedContainingRelease,
      prView: () => releasePr({
        state: 'MERGED',
        title: 'chore(release): v9.9.9',
        mergeCommit: { oid: '9'.repeat(40) },
        statusCheckRollup: null,
      }),
      writeState: () => { mismatchedMergedWrites += 1; },
    }),
  );
  eq(mismatchedMergedResult.action, 'blocked',
    'LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS unrelated merged PR remains blocked');
  eq(mismatchedMergedRecord, blockedRelease(),
    'LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS unrelated merged PR cannot persist merge or version evidence');
  eq(mismatchedMergedWrites, 0,
    'LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS unrelated merged PR performs no ledger write');

  for (const [label, statusCheckRollup] of [
    ['green', [{ name: 'preflight (macos-latest)', status: 'COMPLETED', conclusion: 'SUCCESS' }]],
    ['pending', [{ name: 'preflight (macos-latest)', status: 'IN_PROGRESS', conclusion: '' }]],
  ]) {
    let writes = 0;
    const record = blockedRelease();
    const result = await stepCard({ root: '/workshop' }, emptyState(), record, {}, withLineage({
      findContainingRelease: mismatchedContainingRelease,
      prView: () => releasePr({ statusCheckRollup }),
      writeState: () => { writes += 1; },
    }));
    eq(result.action, 'blocked',
      `LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS unrelated open ${label} PR remains blocked`);
    eq(record, blockedRelease(),
      `LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS unrelated open ${label} PR preserves blocked evidence`);
    eq(writes, 0,
      `LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS unrelated open ${label} PR performs no ledger write`);
  }

  for (const [label, findContainingRelease] of [
    ['missing', () => null],
    ['lookup-error', () => { throw new Error('release lookup unavailable'); }],
  ]) {
    let views = 0; let writes = 0;
    const record = blockedRelease();
    const result = await stepCard({ root: '/workshop' }, emptyState(), record, {}, withLineage({
      findContainingRelease,
      prView: () => { views += 1; return releasePr(); },
      writeState: () => { writes += 1; },
    }));
    eq(result.action, 'blocked',
      `LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS ${label} containing-release evidence fails closed`);
    eq(record, blockedRelease(),
      `LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS ${label} lineage evidence preserves blocked state`);
    eq({ views, writes }, { views: label === 'missing' ? 1 : 0, writes: 0 },
      `LOOP-RELEASE-RERUN-MISMATCHED-PR-REOPENS ${label} lineage failure has deterministic reads and no writes`);
  }

  let unrelatedViews = 0; let unrelatedWrites = 0;
  const unrelatedRecord = blockedRelease({ reason: 'tap PR checks failed: bottles' });
  const unrelatedResult = await stepCard({ root: '/workshop' }, emptyState(), unrelatedRecord, {}, {
    findContainingRelease: () => { throw new Error('unrelated blocked reason must not inspect release lineage'); },
    prView: () => { unrelatedViews += 1; throw new Error('unrelated blocked reason must not view a release PR'); },
    writeState: () => { unrelatedWrites += 1; },
  });
  eq(unrelatedResult.action, 'blocked',
    'LOOP-RELEASE-CI-RERUN-DEADEND unrelated blocked causes remain terminal');
  eq({ views: unrelatedViews, writes: unrelatedWrites }, { views: 0, writes: 0 },
    'LOOP-RELEASE-CI-RERUN-DEADEND unrelated blocked causes cannot enter the recovery seam');
}

// LOOP-MERGE-ONLY: an EMPTY deployment vault list (merge-only binding, e.g.
// ero's `deploy_vaults: []`) completes at feature_merged — no release chain.
// The default (non-empty) vault list is byte-identical to the waitRecord case
// above, which is the no-op guard for deploy-bound boards.
{
  let projected = 0; let persisted = 0;
  const mergeOnlyRecord = { card: 'EM-X Merge-only slice', phase: 'feature_merged', feature_merge_sha: 'abc123' };
  const result = await stepCard({ root: '/workshop' }, emptyState(), mergeOnlyRecord, {}, {
    deployVaults: [],
    attemptProjection: async () => { projected += 1; },
    writeState: () => { persisted += 1; },
    findContainingTag: () => { throw new Error('merge-only must not consult tags'); },
    findContainingRelease: () => { throw new Error('merge-only must not consult release PRs'); },
  });
  eq(result.action, 'complete', 'LOOP-MERGE-ONLY empty vault list completes at feature_merged');
  eq(result.deployment, 'deployed', 'LOOP-MERGE-ONLY completion reports deployed');
  eq(mergeOnlyRecord.phase, 'deployed', 'LOOP-MERGE-ONLY durable phase advances to deployed');
  eq(mergeOnlyRecord.merge_only, true, 'LOOP-MERGE-ONLY record is stamped merge_only');
  ok(typeof mergeOnlyRecord.deployed_at === 'string' && mergeOnlyRecord.deployed_at.length > 0,
    'LOOP-MERGE-ONLY deployed_at is stamped');
  eq(projected, 1, 'LOOP-MERGE-ONLY completion attempts board projection exactly once');
  eq(persisted, 1, 'LOOP-MERGE-ONLY completion persists exactly once');

  const releasePrRecord = { card: 'EM-Y Merge-only from release_pr', phase: 'release_pr', feature_merge_sha: 'def456' };
  const fromReleasePhase = await stepCard({ root: '/workshop' }, emptyState(), releasePrRecord, {}, {
    deployVaults: [],
    attemptProjection: async () => {},
    writeState: () => {},
  });
  eq(fromReleasePhase.action, 'complete', 'LOOP-MERGE-ONLY release_pr phase also exits merge-only (stale phase from a deploy-bound past)');

  const stillWaiting = await stepCard({ root: '/workshop' }, emptyState(),
    { card: 'A', phase: 'feature_merged', feature_merge_sha: 'abc123' }, {}, {
      deployVaults: [{ id: 'headspace', path: '/v/h' }],
      findContainingTag: () => '',
      findContainingRelease: () => null,
    });
  eq(stillWaiting.action, 'waiting', 'LOOP-MERGE-ONLY non-empty vault list keeps the release chain (byte-identical default)');
}
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
let cs1Reads = 0; let cs1Locks = 0; let cs1Writes = 0;
const jsonFirstDeps = {
  readState: () => { cs1Reads++; return emptyState(); },
  writeState: () => { cs1Writes++; },
  withLock: async (_ctx, _name, fn) => { cs1Locks++; return fn(); },
};
for (const [verb, invoke] of [
  ['park', () => rawCommandPark({ root: '/workshop' }, {
    card: 'A', 'depends-on': 'B', 'resume-condition': 'B deploys',
  }, jsonFirstDeps)],
  ['resume', () => rawCommandResume({ root: '/workshop' }, { card: 'A' }, jsonFirstDeps)],
  ['record-review', () => rawCommandRecordReview({ root: '/workshop' }, {
    card: 'A', lens: 'correctness', verdict: 'pass',
    summary: 'A sufficiently specific exact-head correctness summary.',
  }, jsonFirstDeps)],
  ['record-pr', () => rawCommandRecordPr({ root: '/workshop' }, {
    card: 'A', pr: '42',
  }, jsonFirstDeps)],
]) {
  await assert.rejects(invoke, (error) => error.code === 'json_required'
    && error.action === `${verb}-refused`, `CS1-JSON-FIRST-REFUSAL ${verb} has a stable refusal`);
  count++;
}
eq({ reads: cs1Reads, locks: cs1Locks, writes: cs1Writes }, { reads: 0, locks: 0, writes: 0 },
  'CS1-JSON-FIRST-REFUSAL all four verbs refuse before every read, lock, or write');
const jsonFirstCli = await new Promise((resolve) => {
  const child = spawn(process.execPath, [
    path.resolve(__dirname, '../../scripts/autoloop/codex-coordinator.js'),
    'park', '--card', 'A', '--depends-on', 'B', '--resume-condition', 'B deploys',
  ], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});
eq(jsonFirstCli.code, EXIT_CODES.refusal,
  'CS1-JSON-FIRST-REFUSAL CLI exits 1 before attempting workshop resolution');
eq(jsonFirstCli.stdout, '', 'CS1-JSON-FIRST-REFUSAL CLI emits no non-machine success output');
eq(JSON.parse(jsonFirstCli.stderr), {
  action: 'park-refused', ok: false, no_op: false, code: 'json_required',
  message: 'park requires --json for a machine-readable receipt',
}, 'CS1-JSON-FIRST-REFUSAL CLI emits a parseable refusal even outside a Git checkout');
for (const [verb, args, invoke] of [
  ['park', {
    json: true, card: 'A', 'depends-on': 'B', 'resume-condition': 'B deploys',
    'unexpected-park-option': true,
  }, rawCommandPark],
  ['resume', {
    json: true, card: 'A', 'unexpected-resume-option': true,
  }, rawCommandResume],
  ['record-review', {
    json: true, card: 'A', lens: 'correctness', verdict: 'pass',
    summary: 'A sufficiently specific exact-head correctness summary.',
    'expected-head': 'a'.repeat(40), 'expected-heed': 'a'.repeat(40),
  }, rawCommandRecordReview],
  ['record-pr', {
    json: true, card: 'A', pr: '42', 'unexpected-pr-option': true,
  }, rawCommandRecordPr],
]) {
  const effects = { reads: 0, locks: 0, writes: 0 };
  const before = JSON.stringify(recordState);
  await assert.rejects(() => invoke({ root: '/workshop' }, args, {
    readState: () => { effects.reads++; return recordState; },
    writeState: () => { effects.writes++; },
    withLock: async (_ctx, _name, fn) => { effects.locks++; return fn(); },
  }), (error) => error.code === 'unknown_option' && error.action === `${verb}-refused`,
  `CS1-UNKNOWN-OPTION-REFUSAL ${verb} returns the stable refusal`);
  count++;
  eq(effects, { reads: 0, locks: 0, writes: 0 },
    `CS1-UNKNOWN-OPTION-REFUSAL ${verb} refuses before reads, locks, or writes`);
  eq(JSON.stringify(recordState), before,
    `CS1-UNKNOWN-OPTION-REFUSAL ${verb} preserves authoritative state byte-for-byte`);
}
const unknownOptionCli = await new Promise((resolve) => {
  const child = spawn(process.execPath, [
    path.resolve(__dirname, '../../scripts/autoloop/codex-coordinator.js'),
    'record-review', '--json', '--card', 'A', '--lens', 'correctness', '--verdict', 'pass',
    '--summary', 'A sufficiently specific exact-head correctness summary.',
    '--expected-heed', 'a'.repeat(40),
  ], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});
eq(unknownOptionCli.code, EXIT_CODES.refusal,
  'CS1-UNKNOWN-OPTION-REFUSAL CLI exits 1 before attempting workshop resolution');
eq(unknownOptionCli.stdout, '',
  'CS1-UNKNOWN-OPTION-REFUSAL CLI emits no non-machine success output');
eq(JSON.parse(unknownOptionCli.stderr).code, 'unknown_option',
  'CS1-UNKNOWN-OPTION-REFUSAL misspelled expected-head emits a stable refusal outside Git');
const usageCli = await new Promise((resolve) => {
  const child = spawn(process.execPath, [
    path.resolve(__dirname, '../../scripts/autoloop/codex-coordinator.js'),
    'record-pr', '--json',
  ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});
eq(usageCli.code, EXIT_CODES.usage, 'CS1-KIT-ENVELOPE CLI exits 2 for invalid usage');
eq(usageCli.stdout, '', 'CS1-KIT-ENVELOPE usage emits no non-machine success output');
eq(JSON.parse(usageCli.stderr).code, 'invalid_arguments',
  'CS1-KIT-ENVELOPE usage emits a stable machine code');
await assert.rejects(() => commandRecordPr({ root: '/workshop' }, { json: true, card: 'A', pr: '42' }, {
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

await assert.rejects(() => commandRecordPr({ root: '/workshop' }, { json: true, card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, title: 'fix(autoloop): require gate receipts' }),
  sh: (cmd, args) => args[0] === 'status' ? '' : 'head42',
  writeState: () => { writes++; },
  withLock: immediateCardLock,
}), /gate receipt is missing/, 'record-pr refuses a clean matching PR without gate receipts');

recordState.cards.A.gate_receipt = passingReceipt('head42', true, 'fix(autoloop): guard release triggering');
await assert.rejects(() => commandRecordPr({ root: '/workshop' }, { json: true, card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, baseRefOid: 'new-base', title: 'fix(autoloop): require gate receipts' }),
  sh: (cmd, args) => args[0] === 'status' ? '' : 'head42',
  writeState: () => { writes++; },
  withLock: immediateCardLock,
}), /gate receipt base is stale/, 'record-pr refuses gates run against an outdated main base');

const events = [];
const prLocks = [];
await assert.rejects(() => commandRecordPr({ root: '/workshop' }, { json: true, card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, title: 'fix(autoloop): edited after verification' }),
  sh: (cmd, args) => args[0] === 'status' ? '' : 'head42',
  writeState: () => { writes++; },
  withLock: immediateCardLock,
}), (error) => error.code === 'title_mismatch',
'GA-P1G-TITLE-BINDING record-pr refuses a releasable title that differs byte-for-byte from the gate receipt');
const accepted = await commandRecordPr({ root: '/workshop' }, { json: true, card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => ({ ...basePr, title: 'fix(autoloop): guard release triggering' }),
  sh: (cmd, args) => {
    if (cmd === 'git' && args[0] === 'status') return '';
    if (cmd === 'git' && args[0] === 'rev-parse') return 'head42';
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  },
  writeState: () => { events.push('write'); writes++; },
  withLock: async (_ctx, name, fn) => { prLocks.push(name); return fn(); },
});
eq(accepted.action, 'recorded', 'record-pr accepts a releasable title');
eq(accepted.ok, true, 'record-pr adds ok:true without removing legacy receipt keys');
eq(accepted.no_op, false, 'record-pr first apply reports no_op:false');
eq(prLocks, [legacyCardGateLockName('A'), cardGateLockName('A')],
  'record-pr acquires migration-compatible then exact-identity per-card gates');
eq(events, ['write'], 'record-pr persists validated state without arming auto-merge before CI is green');
const prReplayStateBytes = JSON.stringify(recordState);
const writesBeforePrReplay = writes;
const prReplay = await commandRecordPr({ root: '/workshop' }, { json: true, card: 'A', pr: '42' }, {
  readState: () => recordState,
  prView: () => { throw new Error('literal record-pr replay must not query GitHub'); },
  sh: () => { throw new Error('literal record-pr replay must not inspect Git'); },
  writeState: () => { writes++; },
  withLock: immediateCardLock,
});
eq(prReplay.no_op, true, 'CS1-REPLAY-NOOP literal record-pr replay returns no_op:true');
eq(JSON.stringify(recordState), prReplayStateBytes,
  'CS1-REPLAY-NOOP literal record-pr replay preserves authoritative state byte-for-byte');
eq(writes, writesBeforePrReplay, 'CS1-REPLAY-NOOP literal record-pr replay performs zero ledger writes');
await assert.rejects(() => commandRecordPr({ root: '/workshop' }, {
  json: true, card: 'A', pr: '43',
}, {
  readState: () => recordState, writeState: () => { writes++; }, withLock: immediateCardLock,
}), (error) => error.code === 'literal_replay_mismatch',
'CS1-REPLAY-NOOP different record-pr operands on a settled target refuse');
eq(writes, writesBeforePrReplay, 'CS1-REPLAY-NOOP mismatched record-pr replay performs zero ledger writes');

const reviewState = emptyState();
reviewState.cards.Review = { card: 'Review', branch: 'autoloop/review', worktree: os.tmpdir(), phase: 'implementing', gate_receipt: passingReceipt() };
const reviewLocks = [];
let opx2ReviewProjections = 0;
let reviewWrites = 0;
const initialReviewHead = 'c'.repeat(40);
const missingHeadEffects = { reads: 0, locks: 0, writes: 0 };
const beforeMissingHead = JSON.stringify(reviewState);
await assert.rejects(() => commandRecordReview({ root: '/workshop' }, {
  json: true,
  card: 'Review', lens: 'correctness', verdict: 'pass',
  summary: 'No correctness defect found in the reviewed diff.',
}, {
  readState: () => { missingHeadEffects.reads++; return reviewState; },
  writeState: () => { missingHeadEffects.writes++; },
  withLock: async (_ctx, _name, fn) => { missingHeadEffects.locks++; return fn(); },
}), (error) => error.code === 'invalid_arguments' && error.exitCode === EXIT_CODES.usage,
'CS1-MANDATORY-EXACT-HEAD omission refuses with stable usage before command effects');
eq(missingHeadEffects, { reads: 0, locks: 0, writes: 0 },
  'CS1-MANDATORY-EXACT-HEAD omission performs zero reads, locks, or writes');
eq(JSON.stringify(reviewState), beforeMissingHead,
  'CS1-MANDATORY-EXACT-HEAD omission preserves review state byte-for-byte');
for (const [label, expectedHeadOperand] of [
  ['bare token', true],
  ['duplicate operands', ['a'.repeat(40), 'a'.repeat(40)]],
  ['uppercase SHA', 'A'.repeat(40)],
  ['short SHA', 'a'.repeat(39)],
]) {
  const effects = { reads: 0, locks: 0, writes: 0 };
  const before = JSON.stringify(reviewState);
  await assert.rejects(() => commandRecordReview({ root: '/workshop' }, {
    json: true,
    card: 'Review', lens: 'correctness', verdict: 'pass',
    summary: 'No correctness defect found in the reviewed diff.',
    'expected-head': expectedHeadOperand,
  }, {
    readState: () => { effects.reads++; return reviewState; },
    writeState: () => { effects.writes++; },
    withLock: async (_ctx, _name, fn) => { effects.locks++; return fn(); },
  }), (error) => error.code === 'invalid_arguments',
  `CS1-MANDATORY-EXACT-HEAD ${label} refuses with stable usage`);
  count++;
  eq(effects, { reads: 0, locks: 0, writes: 0 },
    `CS1-MANDATORY-EXACT-HEAD ${label} refuses before reads, locks, or writes`);
  eq(JSON.stringify(reviewState), before,
    `CS1-MANDATORY-EXACT-HEAD ${label} preserves review state byte-for-byte`);
}
const review = await commandRecordReview({ root: '/workshop' }, {
  json: true,
  card: 'Review', lens: 'correctness', verdict: 'pass',
  summary: 'No correctness defect found in the reviewed diff.',
  'expected-head': initialReviewHead,
}, {
  readState: () => reviewState, sh: () => initialReviewHead, writeState: () => { reviewWrites++; },
  projectLoopStation: () => { opx2ReviewProjections++; },
  withLock: async (_ctx, name, fn) => { reviewLocks.push(name); return fn(); },
});
eq(review.head_sha, initialReviewHead, 'review receipt is tied to the mandatory exact commit');
eq(review.ok, true, 'record-review adds ok:true without removing legacy receipt keys');
eq(review.no_op, false, 'record-review first apply reports no_op:false');
eq(reviewLocks, [legacyCardGateLockName('Review'), cardGateLockName('Review')],
  'review writes acquire migration-compatible then exact-identity per-card gates');
eq(reviewState.cards.Review.gate_receipt, null, 'new review invalidates an earlier combined gate receipt');
eq(opx2ReviewProjections, 0,
  'OPX2-TRANSITION-ONLY review receipt writes never project Loop Station');
const exactReviewHead = 'a'.repeat(40);
const beforeHeadMismatch = JSON.stringify(reviewState);
const writesBeforeHeadMismatch = reviewWrites;
await assert.rejects(() => commandRecordReview({ root: '/workshop' }, {
  json: true, card: 'Review', lens: 'regression-risk', verdict: 'pass',
  summary: 'Regression behavior remains bounded by the single-writer deployment model.',
  'expected-head': 'b'.repeat(40),
}, {
  readState: () => reviewState, sh: () => exactReviewHead,
  writeState: () => { reviewWrites++; }, withLock: immediateCardLock,
}), (error) => error.code === 'head_mismatch',
'CS1-EXPECTED-HEAD-BINDING refuses a review bound to a different exact HEAD');
eq(JSON.stringify(reviewState), beforeHeadMismatch,
  'CS1-EXPECTED-HEAD-BINDING mismatch preserves review state byte-for-byte');
eq(reviewWrites, writesBeforeHeadMismatch,
  'CS1-EXPECTED-HEAD-BINDING mismatch performs zero ledger writes');
const limitedReviewArgs = {
  json: true, card: 'Review', lens: 'regression-risk', verdict: 'pass',
  summary: 'Concurrency races remain outside the ratified single-writer deployment model.',
  'expected-head': exactReviewHead, 'accepted-limitation': true,
  bound: 'single-writer-no-concurrent-races',
};
for (const [label, malformed] of [
  ['accepted flag without bound', {
    ...limitedReviewArgs, 'accepted-limitation': true, bound: undefined,
  }],
  ['bound without accepted flag', {
    ...limitedReviewArgs, 'accepted-limitation': undefined,
    bound: 'single-writer-no-concurrent-races',
  }],
  ['bare bound token without accepted flag', {
    ...limitedReviewArgs, 'accepted-limitation': undefined, bound: true,
  }],
  ['valued accepted flag', {
    ...limitedReviewArgs, 'accepted-limitation': 'yes',
    bound: 'single-writer-no-concurrent-races',
  }],
  ['duplicated accepted flags', {
    ...limitedReviewArgs, 'accepted-limitation': [true, true],
    bound: 'single-writer-no-concurrent-races',
  }],
  ['mixed named and bare bound tokens', {
    ...limitedReviewArgs, 'accepted-limitation': true,
    bound: ['single-writer-no-concurrent-races', true],
  }],
]) {
  const invalidLimitationEffects = { reads: 0, locks: 0, writes: 0 };
  const invalidLimitationDeps = {
    readState: () => { invalidLimitationEffects.reads++; return reviewState; },
    writeState: () => { invalidLimitationEffects.writes++; },
    withLock: async (_ctx, _name, fn) => { invalidLimitationEffects.locks++; return fn(); },
  };
  const beforeInvalidLimitation = JSON.stringify(reviewState);
  await assert.rejects(() => commandRecordReview({ root: '/workshop' }, malformed, invalidLimitationDeps),
    (error) => error.code === 'invalid_limitation',
    `CS1-ACCEPTED-LIMITATION-PAIRING-COVERAGE ${label} refuses with the stable code`);
  count++;
  eq(invalidLimitationEffects, { reads: 0, locks: 0, writes: 0 },
    `CS1-ACCEPTED-LIMITATION-PER-CASE-ISOLATION ${label} refuses before reads, locks, or writes`);
  eq(JSON.stringify(reviewState), beforeInvalidLimitation,
    `CS1-ACCEPTED-LIMITATION-PER-CASE-ISOLATION ${label} preserves review state byte-for-byte`);
}
const rawLimitationCliBase = [
  path.resolve(__dirname, '../../scripts/autoloop/codex-coordinator.js'),
  'record-review', '--json', '--card', 'Review', '--lens', 'regression-risk',
  '--verdict', 'pass',
  '--summary', 'A sufficiently specific raw limitation operand refusal summary.',
  '--expected-head', exactReviewHead,
];
for (const [label, rawOperands] of [
  ['bare bound token', ['--bound']],
  ['valued accepted flag', [
    '--accepted-limitation', 'yes', '--bound', 'single-writer-no-concurrent-races',
  ]],
  ['duplicated accepted flags', [
    '--accepted-limitation', '--accepted-limitation',
    '--bound', 'single-writer-no-concurrent-races',
  ]],
  ['mixed named and bare bound tokens', [
    '--accepted-limitation', '--bound', 'single-writer-no-concurrent-races', '--bound',
  ]],
]) {
  const cliResult = await new Promise((resolve) => {
    const child = spawn(process.execPath, [...rawLimitationCliBase, ...rawOperands], {
      cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  eq(cliResult.code, EXIT_CODES.refusal,
    `CS1-RAW-LIMITATION-OPERAND-SHAPE ${label} exits 1 before workshop resolution`);
  eq(cliResult.stdout, '',
    `CS1-RAW-LIMITATION-OPERAND-SHAPE ${label} emits no non-machine success output`);
  eq(JSON.parse(cliResult.stderr).code, 'invalid_limitation',
    `CS1-RAW-LIMITATION-OPERAND-SHAPE ${label} reaches the real parser and dispatcher`);
}
const limitedReview = await commandRecordReview({ root: '/workshop' }, limitedReviewArgs, {
  readState: () => reviewState, sh: () => exactReviewHead,
  writeState: () => { reviewWrites++; }, withLock: immediateCardLock,
});
eq(limitedReview.accepted_limitation, { bound: ['single-writer-no-concurrent-races'] },
  'CS1-ACCEPTED-LIMITATION returns the named bound machine-readably');
eq(reviewState.cards.Review.reviews['regression-risk'].accepted_limitation,
  { bound: ['single-writer-no-concurrent-races'] },
  'CS1-ACCEPTED-LIMITATION persists the named single-writer-bound limitation');
const limitedReviewStateBytes = JSON.stringify(reviewState);
const writesBeforeReviewReplay = reviewWrites;
const limitedReplay = await commandRecordReview({ root: '/workshop' }, limitedReviewArgs, {
  readState: () => reviewState, sh: () => exactReviewHead,
  writeState: () => { reviewWrites++; }, withLock: immediateCardLock,
});
eq(limitedReplay.no_op, true, 'CS1-REPLAY-NOOP literal record-review replay returns no_op:true');
eq(JSON.stringify(reviewState), limitedReviewStateBytes,
  'CS1-REPLAY-NOOP literal record-review replay preserves authoritative state byte-for-byte');
eq(reviewWrites, writesBeforeReviewReplay,
  'CS1-REPLAY-NOOP literal record-review replay performs zero ledger writes');
await assert.rejects(() => commandRecordReview({ root: '/workshop' }, {
  ...limitedReviewArgs, summary: 'A different summary cannot replace a settled exact-head review receipt.',
}, {
  readState: () => reviewState, sh: () => exactReviewHead,
  writeState: () => { reviewWrites++; }, withLock: immediateCardLock,
}), (error) => error.code === 'literal_replay_mismatch',
'CS1-REPLAY-NOOP different record-review operands on the same exact HEAD refuse');
eq(reviewWrites, writesBeforeReviewReplay,
  'CS1-REPLAY-NOOP mismatched record-review replay performs zero ledger writes');
await assert.rejects(() => commandRecordReview({ root: '/workshop' }, {
  ...limitedReviewArgs, lens: 'test-adequacy', verdict: 'refute',
}, {
  readState: () => reviewState, sh: () => exactReviewHead,
  writeState: () => { reviewWrites++; }, withLock: immediateCardLock,
}), (error) => error.code === 'invalid_limitation',
'CS1-ACCEPTED-LIMITATION refuses attaching an accepted limitation to a refutation');

reviewState.cards.Review.phase = 'feature_merged';
await assert.rejects(() => commandRecordReview({ root: '/workshop' }, {
  json: true,
  card: 'Review', lens: 'correctness', verdict: 'refute',
  summary: 'A late refutation must not reopen a merged feature.',
  'expected-head': exactReviewHead,
}, {
  readState: () => reviewState, sh: () => exactReviewHead, writeState: () => {}, withLock: immediateCardLock,
}), /reviews are closed .*feature_merged/, 'review writes are rejected after the feature PR merges');
reviewState.cards.Review.phase = 'implementing';

reviewState.cards.Review.touch_zones = ['scripts/autoloop', 'platform/test'];
reviewState.cards.Review.reviews = Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, {
  lens, verdict: 'pass', refuted: false, summary: `${lens} review found no release-blocking defect.`, head_sha: 'review-head',
}]));
const gateCalls = [];
let selfInstallOperands = null;
const verified = await commandVerifyGates({ root: '/workshop' }, { card: 'Review', base: 'HEAD' }, {
  readState: () => reviewState,
  writeState: () => {},
  withLock: async (_ctx, name, fn) => { gateCalls.push(name); return fn(); },
  runIsolatedWorkshopSelfInstall: (_ctx, head, base, title) => {
    gateCalls.push('self-install');
    selfInstallOperands = { head, base, title };
  },
  sh: (cmd, args) => {
    if (cmd === 'git' && args[0] === 'status') return '';
    if (cmd === 'git' && args[0] === 'fetch') { gateCalls.push('fetch-main'); return ''; }
    if (cmd === 'git' && args[0] === 'rev-parse') return args[1] === 'origin/main' ? 'base-current' : 'review-head';
    if (cmd === 'git' && args[0] === 'show') return 'fix(autoloop): verify release provenance';
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
eq(gateCalls, [legacyCardGateLockName('Review'), cardGateLockName('Review'), 'fetch-main', 'release:preflight', 'self-install', 'release:preflight-bumped'],
  'verify-gates serializes through migration-compatible and exact card identity, fetches main, and owns every deterministic release check');
eq(reviewState.cards.Review.gate_receipt.base_ref, 'origin/main', 'combined receipt records the canonical base ref');
eq(reviewState.cards.Review.gate_receipt.base_sha, 'base-current', 'combined receipt records the exact fetched base SHA');
eq(reviewState.cards.Review.gate_receipt.prospective_pr_title, 'fix(autoloop): verify release provenance',
  'combined receipt records the exact prospective squash title');
eq(selfInstallOperands, {
  head: 'review-head', base: 'base-current', title: 'fix(autoloop): verify release provenance',
}, 'verify-gates binds self-install to exact head, fetched base, and prospective title');
ok(gateReceiptStatus(reviewState.cards.Review, 'review-head').valid, 'combined receipt is accepted after every check passes');

const advanceState = emptyState();
advanceState.cards.Advance = { card: 'Advance', phase: 'feature_pr', gate_receipt: passingReceipt() };
const advanceLocks = []; let insideAdvanceLock = false; let advanceReadInsideLock = false;
let opx2WaitingProjections = 0;
const advanceResult = await commandAdvance({ root: '/workshop' }, { card: 'Advance', 'lease-seconds': '0' }, {
  withLock: async (_ctx, name, fn) => {
    advanceLocks.push(name); insideAdvanceLock = true;
    try { return await fn(); } finally { insideAdvanceLock = false; }
  },
  readState: () => { advanceReadInsideLock = insideAdvanceLock; return advanceState; },
  stepCard: async () => ({ action: 'waiting', phase: 'feature_pr' }),
  projectLoopStation: () => { opx2WaitingProjections++; },
  emit: () => {},
});
eq(advanceLocks, [legacyCardGateLockName('Advance'), cardGateLockName('Advance')],
  'advance acquires migration-compatible then exact-identity per-card gates');
ok(advanceReadInsideLock, 'advance rereads the card only after acquiring its lock');
eq(advanceResult.phase, 'feature_pr', 'locked advance returns the feature PR state');
eq(opx2WaitingProjections, 0,
  'OPX2-TRANSITION-ONLY waiting poll/retry fires no Loop Station projection');
const opx2DeployState = emptyState();
opx2DeployState.cards.Deploy = { card: 'Deploy', phase: 'tap_merged' };
const opx2DeployProjections = [];
const opx2DeployDeps = {
  withLock: immediateCardLock,
  readState: () => opx2DeployState,
  stepCard: async (_ctx, _state, record) => {
    record.phase = 'deployed';
    return { action: 'complete', card: record.card, phase: record.phase };
  },
  projectLoopStation: (_ctx, _state, updatedOn) => {
    opx2DeployProjections.push(updatedOn);
    return { action: 'loop-station-projected', no_op: false, updated_on: updatedOn };
  },
  emit: () => {},
};
eq((await commandAdvance({ root: '/workshop' }, { card: 'Deploy', 'lease-seconds': '0' }, opx2DeployDeps)).phase,
  'deployed', 'OPX2-TRANSITION-ONLY deploy transition completes normally');
eq(opx2DeployProjections, ['deploy'],
  'OPX2-TRANSITION-ONLY deploy transition fires exactly one Loop Station projection');
opx2DeployDeps.stepCard = async (_ctx, _state, record) => ({
  action: 'complete', card: record.card, phase: record.phase,
});
await commandAdvance({ root: '/workshop' }, { card: 'Deploy', 'lease-seconds': '0' }, opx2DeployDeps);
eq(opx2DeployProjections, ['deploy'],
  'OPX2-TRANSITION-ONLY deployed replay fires no additional Loop Station projection');
const parkedAdvanceState = emptyState();
parkedAdvanceState.cards.Parked = {
  card: 'Parked', phase: 'parked', dependencies: ['Prerequisite'], resume_condition: 'Prerequisite deploys',
};
eq((await commandAdvance({ root: '/workshop' }, { card: 'Parked', 'lease-seconds': '0' }, {
  withLock: immediateCardLock, readState: () => parkedAdvanceState, emit: () => {},
})).action, 'parked', 'advance command refuses to treat a parked card as implementation');

assert.throws(() => runIsolatedWorkshopSelfInstall(
  { root: '/workshop' }, 'head42', 'base42', 'fix(x): y', (cmd, args) => {
  if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') throw new Error('cleanup denied');
  if (cmd === 'git' && args[0] === 'rev-parse') return 'tree42';
  if (cmd === 'git' && args[0] === 'commit-tree') return 'synthetic42';
  return '';
}), /failed to remove disposable self-install worktree .*cleanup denied/, 'self-install gate surfaces disposable worktree cleanup failures');

let partialRemoved = false;
let partialPath = '';
assert.throws(() => runIsolatedWorkshopSelfInstall(
  { root: '/workshop' }, 'head42', 'base42', 'fix(x): y', (cmd, args) => {
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

// GA-P1g — the deploy-bound workshop gate validates exactly the state the
// release bumper will publish. The real fixture below starts from an exact
// detached HEAD, raises Home's TaskEntity floor one minor, and commits a real
// TaskEntity feature. Raw installation must reject that source state; the
// production helper must compute the release in a second disposable worktree,
// run the real installer there, and leave the claimed fixture byte-clean.
{
  const realRun = (cmd, args, opts = {}) => execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  }).trim();
  const releaseGateCommitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Sauce Release Gate',
    GIT_AUTHOR_EMAIL: 'sauce-release-gate@example.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'Sauce Release Gate',
    GIT_COMMITTER_EMAIL: 'sauce-release-gate@example.invalid',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  };
  const localCommitFromTree = (cwd, tree, parent, title) => realRun('git', [
    'commit-tree', tree, '-p', parent, '-m', title,
  ], { cwd, stdio: 'pipe', env: releaseGateCommitEnv });
  const localRootCommitFromTree = (cwd, tree, title) => realRun('git', [
    'commit-tree', tree, '-m', title,
  ], { cwd, stdio: 'pipe', env: releaseGateCommitEnv });
  const resolveOrdinaryReleaseTitle = (
    cwd, headSha, env = process.env, readEvent = fs.readFileSync,
  ) => {
    const checkedOutTitle = realRun('git', ['show', '-s', '--format=%s', headSha], { cwd });
    if (env.GITHUB_EVENT_NAME !== 'pull_request') return checkedOutTitle;
    if (!env.GITHUB_SHA || env.GITHUB_SHA !== headSha) {
      throw new Error(
        `pull-request title binding does not match checked-out HEAD (${env.GITHUB_SHA || 'missing'} != ${headSha})`,
      );
    }
    if (!env.GITHUB_EVENT_PATH) {
      throw new Error('pull-request title binding requires GITHUB_EVENT_PATH');
    }
    let event;
    try {
      event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH, 'utf8'));
    } catch (error) {
      throw new Error(`pull-request title binding could not read GITHUB_EVENT_PATH: ${error.message}`);
    }
    const title = event && event.pull_request && event.pull_request.title;
    if (typeof title !== 'string' || !title || title !== title.trim()) {
      throw new Error('pull-request title binding requires one exact non-empty PR title');
    }
    return title;
  };

  // Actions checks out PRs at depth 1. Prove the ordinary release fixture can
  // build a complete local base/feature pair from that one exact HEAD without
  // fetching its absent parent or changing the checked-out branch.
  const shallowSource = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-p1g-shallow-source-'));
  const shallowClone = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-p1g-shallow-clone-'));
  fs.rmSync(shallowClone, { recursive: true, force: true });
  try {
    realRun('git', ['init', '--quiet', '--initial-branch=main'], { cwd: shallowSource, stdio: 'pipe' });
    fs.writeFileSync(path.join(shallowSource, 'fixture.txt'), 'base\n');
    realRun('git', ['add', 'fixture.txt'], { cwd: shallowSource, stdio: 'pipe' });
    realRun('git', [
      '-c', 'user.name=Sauce Test', '-c', 'user.email=sauce-test@example.invalid',
      'commit', '--quiet', '-m', 'fix(test): shallow base',
    ], { cwd: shallowSource, stdio: 'pipe' });
    fs.writeFileSync(path.join(shallowSource, 'fixture.txt'), 'feature\n');
    realRun('git', ['add', 'fixture.txt'], { cwd: shallowSource, stdio: 'pipe' });
    realRun('git', [
      '-c', 'user.name=Sauce Test', '-c', 'user.email=sauce-test@example.invalid',
      'commit', '--quiet', '-m', 'fix(test): shallow feature',
    ], { cwd: shallowSource, stdio: 'pipe' });
    realRun('git', ['clone', '--quiet', '--depth=1', '--no-local', shallowSource, shallowClone], {
      cwd: os.tmpdir(), stdio: 'pipe',
    });
    eq(realRun('git', ['rev-parse', '--is-shallow-repository'], { cwd: shallowClone }), 'true',
      'GA-P1G3-SHALLOW-ORDINARY oracle executes in a real depth-1 clone');
    assert.throws(
      () => realRun('git', ['rev-parse', 'HEAD^'], { cwd: shallowClone, stdio: 'pipe' }),
      /Command failed/,
      'GA-P1G3-SHALLOW-ORDINARY confirms the checkout parent object is absent',
    );
    count++;
    const shallowHead = realRun('git', ['rev-parse', 'HEAD'], { cwd: shallowClone });
    const shallowTree = realRun('git', ['rev-parse', `${shallowHead}^{tree}`], { cwd: shallowClone });
    const localBase = localCommitFromTree(
      shallowClone, shallowTree, shallowHead, 'test(autoloop): local ordinary base',
    );
    const localFeature = localCommitFromTree(
      shallowClone, shallowTree, localBase, 'fix(autoloop): local ordinary feature',
    );
    ok(/^[0-9a-f]{40}$/.test(localBase),
      'GA-P1G3-SHALLOW-ORDINARY creates a valid local base commit');
    eq(realRun('git', ['rev-parse', `${localBase}^`], { cwd: shallowClone }), shallowHead,
      'GA-P1G3-SHALLOW-ORDINARY local base extends the only available exact HEAD');
    eq(realRun('git', ['rev-parse', `${localFeature}^`], { cwd: shallowClone }), localBase,
      'GA-P1G3-SHALLOW-ORDINARY local feature has the constructed base as its exact parent');
    eq(realRun('git', ['rev-parse', `${localFeature}^{tree}`], { cwd: shallowClone }), shallowTree,
      'GA-P1G3-SHALLOW-ORDINARY local feature preserves the exact checked-out tree');
    eq(localCommitFromTree(
      shallowClone, shallowTree, localBase, 'fix(autoloop): local ordinary feature',
    ), localFeature, 'GA-P1G3-SHALLOW-ORDINARY local feature construction is deterministic');
  } finally {
    fs.rmSync(shallowClone, { recursive: true, force: true });
    fs.rmSync(shallowSource, { recursive: true, force: true });
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-p1g-claim-'));
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-p1g-raw-'));
  fs.rmSync(rawRoot, { recursive: true, force: true });
  const ordinaryDisposable = [];
  const releaseDisposable = [];
  const mismatchedDisposable = [];
  const borrowedDisposable = [];
  let fixtureAdded = false;
  let rawAdded = false;
  try {
    realRun('git', ['worktree', 'add', '--detach', fixtureRoot, 'HEAD'], {
      cwd: path.resolve(__dirname, '../..'), stdio: 'pipe',
    });
    fixtureAdded = true;
    const fixtureStart = realRun('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot });
    const homeManifestPath = path.join(fixtureRoot, 'platform/blueprints/home/manifest.json');
    const taskManifestPath = path.join(fixtureRoot, 'platform/mechanisms/task-entity/manifest.json');
    const taskReadmePath = path.join(fixtureRoot, 'platform/mechanisms/task-entity/README.md');
    const homeManifest = JSON.parse(fs.readFileSync(homeManifestPath, 'utf8'));
    const taskManifest = JSON.parse(fs.readFileSync(taskManifestPath, 'utf8'));
    const [taskMajor, taskMinor, taskPatch] = taskManifest.version.split('.').map(Number);
    const computedTaskVersion = `${taskMajor}.${taskMinor + 1}.0`;
    const taskDependency = homeManifest.depends_on.find((dep) => dep.name === 'task-entity');
    ok(taskDependency && /^\d+\.\d+\.\d+$/.test(taskManifest.version),
      'GA-P1G-REAL-RELEASE-FIXTURE starts from a versioned shipping TaskEntity dependency');
    const normalizeFixtureTaskFloor = (manifest, sourceVersion) => {
      const dependency = manifest.depends_on.find((dep) => dep.name === 'task-entity');
      if (!dependency) throw new Error('fixture Home manifest lacks task-entity dependency');
      dependency.range = `>=${sourceVersion}`;
      return dependency;
    };
    const normalizationOracle = (normalizer, sourceVersion) => {
      const candidate = JSON.parse(JSON.stringify(homeManifest));
      const candidateDependency = candidate.depends_on.find((dep) => dep.name === 'task-entity');
      candidateDependency.range = `>=${taskMajor}.${taskMinor + 1}.0`;
      normalizer(candidate, sourceVersion);
      assert.strictEqual(
        candidateDependency.range,
        `>=${sourceVersion}`,
        'fixture normalization must bind Home to the exact source TaskEntity version',
      );
    };
    normalizationOracle(normalizeFixtureTaskFloor, taskManifest.version);
    count++;
    assert.throws(
      () => normalizationOracle(() => {}, taskManifest.version),
      /fixture normalization must bind Home to the exact source TaskEntity version/,
      'GA-P1H-OMITTED-NORMALIZATION-MUTANT-KILLED requires the preparation floor rewrite',
    );
    count++;
    const alternateSourceVersion = `${taskMajor}.${taskMinor}.${taskPatch + 1}`;
    normalizationOracle(normalizeFixtureTaskFloor, alternateSourceVersion);
    count++;
    assert.throws(
      () => normalizationOracle(
        (manifest) => normalizeFixtureTaskFloor(manifest, taskManifest.version),
        alternateSourceVersion,
      ),
      /fixture normalization must bind Home to the exact source TaskEntity version/,
      'GA-P1H-HISTORICAL-FLOOR-MUTANT-KILLED rejects a fixture pinned to one source release',
    );
    count++;
    ok(!/\d+\.\d+\.\d+/.test(normalizeFixtureTaskFloor.toString()),
      'GA-P1H-VERSION-RELATIVE-NORMALIZATION contains no historical TaskEntity literal');

    // Reproduce the post-floor source that blocked GA-P1b10: TaskEntity is
    // still at the shipping version while Home already requires its next
    // minor. This synthetic source commit is the exact base of the prospective
    // squash, so the preparation + feature pair below must net back to its
    // raised floor without borrowing a bump from branch history.
    taskDependency.range = `>=${computedTaskVersion}`;
    fs.writeFileSync(homeManifestPath, `${JSON.stringify(homeManifest, null, 2)}\n`);
    const raisedSourceMarker = '<!-- GA-P1h raised-floor source fixture -->';
    fs.appendFileSync(taskReadmePath, `\n${raisedSourceMarker}\n`);
    const raisedSourcePaths = realRun('git', ['diff', '--name-only'], { cwd: fixtureRoot })
      .split('\n').filter(Boolean).sort();
    ok(raisedSourcePaths.includes('platform/mechanisms/task-entity/README.md'),
      'GA-P1H-ALREADY-RAISED-SOURCE-MUTANT-KILLED setup stays non-empty when Home already has the computed floor');
    ok(raisedSourcePaths.every((sourcePath) => [
      'platform/blueprints/home/manifest.json',
      'platform/mechanisms/task-entity/README.md',
    ].includes(sourcePath)), 'GA-P1H-RAISED-SOURCE setup changes only its two fixture-owned paths');
    realRun('git', [
      'add',
      'platform/blueprints/home/manifest.json',
      'platform/mechanisms/task-entity/README.md',
    ], { cwd: fixtureRoot, stdio: 'pipe' });
    const raisedSourceCommitArgs = [
      '-c', 'user.name=Sauce Test',
      '-c', 'user.email=sauce-test@example.invalid',
      'commit', '-m', 'feat(task-entity): reproduce ambient release provenance',
    ];
    ok(!raisedSourceCommitArgs.includes('--allow-empty'),
      'GA-P1H-RAISED-SOURCE-ALLOW-EMPTY-MUTANT-KILLED source setup rejects empty commits');
    realRun('git', raisedSourceCommitArgs, { cwd: fixtureRoot, stdio: 'pipe' });
    const fixtureBase = realRun('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot });
    eq(realRun('git', ['rev-parse', `${fixtureBase}^`], { cwd: fixtureRoot }), fixtureStart,
      'GA-P1H-RAISED-SOURCE base extends the exact checked-out source');
    eq(
      JSON.parse(realRun('git', ['show', `${fixtureBase}:platform/blueprints/home/manifest.json`], {
        cwd: fixtureRoot,
      })).depends_on.find((dep) => dep.name === 'task-entity').range,
      `>=${computedTaskVersion}`,
      'GA-P1H-RAISED-SOURCE reproduces Home already requiring the computed next minor',
    );
    eq(
      JSON.parse(realRun('git', ['show', `${fixtureBase}:platform/mechanisms/task-entity/manifest.json`], {
        cwd: fixtureRoot,
      })).version,
      taskManifest.version,
      'GA-P1H-RAISED-SOURCE keeps TaskEntity at the exact shipping source version',
    );
    ok(realRun('git', [
      'show', `${fixtureBase}:platform/mechanisms/task-entity/README.md`,
    ], { cwd: fixtureRoot }).includes(raisedSourceMarker),
    'GA-P1H-RAISED-SOURCE base carries the independent non-empty fixture marker');
    eq(realRun('git', ['show', '-s', '--format=%s', fixtureBase], { cwd: fixtureRoot }),
      'feat(task-entity): reproduce ambient release provenance',
      'GA-P1I-AMBIENT-FEATURE fixture carries a real releasable feature before the prospective squash');

    // The real feature above deliberately reproduces the history present at
    // GA-P1b10's preserved product HEAD. Give the prospective squash a
    // parent with the exact same base tree but independent ancestry, so
    // compute-release can see only that prospective title. This stays valid
    // in Actions' depth-1 checkout because it does not need a fetched tag or
    // the checked-out commit's absent parent.
    const releaseRangeTree = realRun('git', ['rev-parse', `${fixtureBase}^{tree}`], {
      cwd: fixtureRoot,
    });
    const releaseRangeBase = realRun('git', [
      'commit-tree', releaseRangeTree,
      '-m', 'test(autoloop): isolate prospective release range',
    ], { cwd: fixtureRoot, stdio: 'pipe', env: releaseGateCommitEnv });
    eq(realRun('git', ['rev-parse', `${releaseRangeBase}^{tree}`], { cwd: fixtureRoot }),
      releaseRangeTree,
      'GA-P1I-RANGE-BASE preserves the exact fixture base tree');
    eq(realRun('git', ['rev-list', '--parents', '-n', '1', releaseRangeBase], { cwd: fixtureRoot }),
      releaseRangeBase,
      'GA-P1I-RANGE-BASE is an ancestry-isolated root that needs no fetched history');
    assert.throws(
      () => realRun('git', ['merge-base', '--is-ancestor', fixtureBase, releaseRangeBase], {
        cwd: fixtureRoot, stdio: 'pipe',
      }),
      /Command failed/,
      'GA-P1I-RANGE-BASE excludes the ambient feature from prospective release ancestry',
    );
    count++;
    const rangeAnchorOracle = (selectRangeBase) => {
      const selected = selectRangeBase({ isolated: releaseRangeBase, ambient: fixtureBase });
      assert.strictEqual(
        selected,
        releaseRangeBase,
        'prospective release must use the ancestry-isolated exact-tree base',
      );
    };
    rangeAnchorOracle(({ isolated }) => isolated);
    count++;
    assert.throws(
      () => rangeAnchorOracle(({ ambient }) => ambient),
      /prospective release must use the ancestry-isolated exact-tree base/,
      'GA-P1I-WRONG-RANGE-ANCHOR-MUTANT-KILLED rejects the ambient feature-bearing parent',
    );
    count++;

    normalizeFixtureTaskFloor(homeManifest, taskManifest.version);
    fs.writeFileSync(homeManifestPath, `${JSON.stringify(homeManifest, null, 2)}\n`);
    fs.appendFileSync(taskReadmePath, '\n<!-- GA-P1g computed-release fixture -->\n');
    eq(
      realRun('git', ['diff', '--name-only'], { cwd: fixtureRoot }).split('\n').filter(Boolean).sort(),
      ['platform/blueprints/home/manifest.json', 'platform/mechanisms/task-entity/README.md'],
      'GA-P1H-NORMALIZED-PREP is non-empty and binds the exact floor plus feature fixture',
    );
    realRun('git', [
      'add',
      'platform/blueprints/home/manifest.json',
      'platform/mechanisms/task-entity/README.md',
    ], { cwd: fixtureRoot, stdio: 'pipe' });
    realRun('git', [
      '-c', 'user.name=Sauce Test',
      '-c', 'user.email=sauce-test@example.invalid',
      'commit', '-m', 'fix(task-entity): prepare multi-commit release fixture',
    ], { cwd: fixtureRoot, stdio: 'pipe' });
    const fixturePreparation = realRun('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot });
    eq(realRun('git', ['rev-parse', `${fixturePreparation}^`], { cwd: fixtureRoot }), fixtureBase,
      'GA-P1H-NORMALIZED-PREP extends the exact raised-floor base');
    eq(
      JSON.parse(realRun('git', ['show', `${fixturePreparation}:platform/blueprints/home/manifest.json`], {
        cwd: fixtureRoot,
      })).depends_on.find((dep) => dep.name === 'task-entity').range,
      `>=${taskManifest.version}`,
      'GA-P1H-NORMALIZED-PREP lowers Home to the exact source TaskEntity version',
    );
    taskDependency.range = `>=${computedTaskVersion}`;
    fs.writeFileSync(homeManifestPath, `${JSON.stringify(homeManifest, null, 2)}\n`);
    eq(realRun('git', ['diff', '--name-only'], { cwd: fixtureRoot }),
      'platform/blueprints/home/manifest.json',
      'GA-P1H-NONEMPTY-FEATURE-MUTANT-KILLED requires a real computed-floor tree transition');
    realRun('git', ['add', 'platform/blueprints/home/manifest.json'], { cwd: fixtureRoot, stdio: 'pipe' });
    const featureCommitArgs = [
      '-c', 'user.name=Sauce Test',
      '-c', 'user.email=sauce-test@example.invalid',
      'commit', '-m', 'feat(task-entity): exercise computed release floor',
    ];
    ok(!featureCommitArgs.includes('--allow-empty'),
      'GA-P1H-ALLOW-EMPTY-COMMIT-MUTANT-KILLED feature fixture rejects empty commits');
    realRun('git', featureCommitArgs, { cwd: fixtureRoot, stdio: 'pipe' });
    const fixtureHead = realRun('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot });
    eq(realRun('git', ['rev-parse', `${fixtureHead}^`], { cwd: fixtureRoot }), fixturePreparation,
      'GA-P1H-NONEMPTY-FEATURE commit extends the normalized preparation');
    eq(
      JSON.parse(realRun('git', ['show', `${fixtureHead}:platform/blueprints/home/manifest.json`], {
        cwd: fixtureRoot,
      })).depends_on.find((dep) => dep.name === 'task-entity').range,
      `>=${computedTaskVersion}`,
      'GA-P1H-NONEMPTY-FEATURE raises Home to the computed next TaskEntity minor',
    );
    ok(realRun('git', ['rev-parse', `${fixtureHead}^{tree}`], { cwd: fixtureRoot })
        !== realRun('git', ['rev-parse', `${fixturePreparation}^{tree}`], { cwd: fixtureRoot }),
    'GA-P1H-NONEMPTY-FEATURE feature and preparation trees differ');
    const claimedHeadBefore = fixtureHead;
    const claimedStatusBefore = realRun('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: fixtureRoot });
    const claimedHomeBefore = fs.readFileSync(homeManifestPath);
    const claimedTaskBefore = fs.readFileSync(taskReadmePath);
    eq(claimedStatusBefore, '', 'GA-P1G-CLAIM-BYTE-CLEAN fixture claim starts clean');

    realRun('git', ['worktree', 'add', '--detach', rawRoot, fixtureHead], {
      cwd: fixtureRoot, stdio: 'pipe',
    });
    rawAdded = true;
    let rawInstallError = null;
    try {
      realRun('node', ['platform/install.js', '--vault', '.', '--auto-approve'], {
        cwd: rawRoot, stdio: 'pipe',
      });
    } catch (error) {
      rawInstallError = error;
    }
    const rawInstallOutput = `${rawInstallError && rawInstallError.stdout || ''}\n${rawInstallError && rawInstallError.stderr || ''}`;
    ok(rawInstallError && rawInstallError.status === 1,
      'GA-P1G-RAW-FLOOR-FAIL real installer rejects the uncomputed same-release floor');
    ok(rawInstallOutput.includes(`depends on task-entity >=${computedTaskVersion} but subscription pins task-entity@${taskManifest.version}`),
      'GA-P1G-RAW-FLOOR-FAIL rejection is the exact TaskEntity dependency floor');
    realRun('git', ['worktree', 'remove', '--force', rawRoot], { cwd: fixtureRoot, stdio: 'pipe' });
    rawAdded = false;

    const releaseRun = (cmd, args, opts = {}) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') releaseDisposable.push(args[3]);
      return realRun(cmd, args, opts);
    };
    runIsolatedWorkshopSelfInstall(
      { root: fixtureRoot }, fixtureHead, releaseRangeBase,
      'feat(task-entity): exercise computed release floor', releaseRun,
    );
    eq(releaseDisposable.length, 1,
      'GA-P1G-COMPUTED-RELEASE-INSTALL production gate creates one disposable release worktree');
    ok(!fs.existsSync(releaseDisposable[0]),
      'GA-P1G-COMPUTED-RELEASE-INSTALL successful release-state worktree is removed');
    ok(!realRun('git', ['worktree', 'list', '--porcelain'], { cwd: fixtureRoot }).includes(`worktree ${releaseDisposable[0]}`),
      'GA-P1G-COMPUTED-RELEASE-INSTALL successful release-state registration is removed');
    eq(realRun('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot }), claimedHeadBefore,
      'GA-P1G-CLAIM-BYTE-CLEAN computed release leaves claimed HEAD unchanged');
    eq(realRun('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: fixtureRoot }), claimedStatusBefore,
      'GA-P1G-CLAIM-BYTE-CLEAN computed release leaves claimed status unchanged');
    ok(fs.readFileSync(homeManifestPath).equals(claimedHomeBefore)
        && fs.readFileSync(taskReadmePath).equals(claimedTaskBefore),
    'GA-P1G-CLAIM-BYTE-CLEAN computed release leaves claimed source bytes unchanged');

    const mismatchedRun = (cmd, args, opts = {}) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') mismatchedDisposable.push(args[3]);
      return realRun(cmd, args, opts);
    };
    const provenanceMismatchOracle = (rangeBase, trackedRun, disposable) => {
      let mismatchError = null;
      try {
        runIsolatedWorkshopSelfInstall(
          { root: fixtureRoot }, fixtureHead, rangeBase,
          'fix(task-entity): misclassified prospective squash', trackedRun,
        );
      } catch (error) {
        mismatchError = error;
      }
      const mismatchOutput = `${mismatchError && mismatchError.message || ''}\n`
        + `${mismatchError && mismatchError.stdout || ''}\n${mismatchError && mismatchError.stderr || ''}`;
      assert(
        mismatchError && /depends on task-entity .* but subscription pins task-entity@/.test(mismatchOutput),
        'GA-P1G-PROVENANCE-MISMATCH isolated fix-title synthetic squash must fail the exact TaskEntity dependency floor',
      );
      assert(disposable.length === 1 && !fs.existsSync(disposable[0]),
        'GA-P1G-PROVENANCE-MISMATCH failed synthetic release worktree is target-cleaned');
    };
    provenanceMismatchOracle(releaseRangeBase, mismatchedRun, mismatchedDisposable);
    count += 2;
    const borrowedRun = (cmd, args, opts = {}) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') borrowedDisposable.push(args[3]);
      return realRun(cmd, args, opts);
    };
    assert.throws(
      () => provenanceMismatchOracle(fixtureBase, borrowedRun, borrowedDisposable),
      /GA-P1G-PROVENANCE-MISMATCH isolated fix-title synthetic squash must fail the exact TaskEntity dependency floor/,
      'GA-P1I-AMBIENT-FEATURE-BORROWING-MUTANT-KILLED proves the wrong parent borrows the ambient feat bump',
    );
    count++;
    ok(borrowedDisposable.length === 1 && !fs.existsSync(borrowedDisposable[0]),
      'GA-P1I-AMBIENT-FEATURE-BORROWING-MUTANT-KILLED wrong-anchor success still target-cleans');

    // GitHub Actions checks pull requests out at a synthetic merge commit.
    // Its subject is not the future squash title, so bind the ordinary gate
    // fixture to the exact PR title in the event payload after proving that
    // GITHUB_SHA names this exact checkout. Normalize the isolated base to the
    // exact source TaskEntity version even when the checked-out source already
    // carries the next-minor Home floor, then use the exact raised-floor tree
    // as the merge checkout. The base/feature delta stays non-empty in both
    // component touch zones and preserves Actions' base-first/feature-second
    // topology. Release attribution still uses mergeRefBase explicitly, so it
    // cannot borrow the feature commit through the merge checkout's ancestry.
    const mergeRefTree = realRun('git', ['rev-parse', `${fixtureBase}^{tree}`], {
      cwd: fixtureRoot,
    });
    const mergeRefBaseTree = realRun('git', ['rev-parse', `${fixturePreparation}^{tree}`], {
      cwd: fixtureRoot,
    });
    const mergeRefFloorAt = (treeish) => JSON.parse(realRun('git', [
      'show', `${treeish}:platform/blueprints/home/manifest.json`,
    ], { cwd: fixtureRoot })).depends_on.find((dep) => dep.name === 'task-entity').range;
    const mergeRefTransitionOracle = (
      baseTree, featureTree, sourceTaskVersion = taskManifest.version,
    ) => {
      assert.notStrictEqual(
        baseTree,
        featureTree,
        'merge-ref release transition must preserve a non-empty exact feature tree',
      );
      assert.strictEqual(
        mergeRefFloorAt(baseTree),
        `>=${sourceTaskVersion}`,
        'merge-ref release base must normalize Home to the exact source TaskEntity version',
      );
      assert.strictEqual(
        mergeRefFloorAt(featureTree),
        `>=${computedTaskVersion}`,
        'merge-ref feature tree must raise Home to the computed next TaskEntity minor',
      );
      assert.deepStrictEqual(
        realRun('git', ['diff', '--name-only', baseTree, featureTree], { cwd: fixtureRoot })
          .split('\n').filter(Boolean).sort(),
        [
          'platform/blueprints/home/manifest.json',
          'platform/mechanisms/task-entity/README.md',
        ],
        'merge-ref release transition must touch exactly Home and TaskEntity fixture paths',
      );
    };
    mergeRefTransitionOracle(mergeRefBaseTree, mergeRefTree);
    count++;
    assert.throws(
      () => mergeRefTransitionOracle(
        realRun('git', ['rev-parse', `${fixtureBase}^{tree}`], { cwd: fixtureRoot }),
        realRun('git', ['rev-parse', `${fixtureHead}^{tree}`], { cwd: fixtureRoot }),
      ),
      /merge-ref release base must normalize Home/,
      'GA-P1K-ALREADY-RAISED-BASE-MUTANT-KILLED rejects reuse of the raised source tree',
    );
    count++;
    assert.throws(
      () => mergeRefTransitionOracle(mergeRefBaseTree, mergeRefBaseTree),
      /non-empty exact feature tree/,
      'GA-P1K-EMPTY-TRANSITION-MUTANT-KILLED rejects an empty normalized merge range',
    );
    count++;
    assert.throws(
      () => mergeRefTransitionOracle(mergeRefBaseTree, mergeRefTree, alternateSourceVersion),
      /exact source TaskEntity version/,
      'GA-P1K-HISTORICAL-VERSION-MUTANT-KILLED binds normalization to the live source version',
    );
    count++;
    ok(!/\d+\.\d+\.\d+/.test(mergeRefTransitionOracle.toString()),
      'GA-P1K-VERSION-RELATIVE-MERGE-STATE contains no historical component literal');
    const mergeRefBase = realRun('git', [
      'commit-tree', mergeRefBaseTree,
      '-m', 'test(autoloop): isolate merge-ref prospective release range',
    ], { cwd: fixtureRoot, stdio: 'pipe', env: releaseGateCommitEnv });
    const mergeRefSubject = 'Merge pull request #663 from willfell/codex-autoloop/ga-p1b12';
    const mergeRefHead = realRun('git', [
      'commit-tree', mergeRefTree,
      '-p', mergeRefBase,
      '-p', fixtureBase,
      '-m', mergeRefSubject,
    ], { cwd: fixtureRoot, stdio: 'pipe', env: releaseGateCommitEnv });
    eq(realRun('git', ['show', '-s', '--format=%s', mergeRefHead], { cwd: fixtureRoot }),
      mergeRefSubject,
      'GA-P1J-MERGE-REF fixture HEAD carries the non-conventional synthetic merge subject');
    eq(realRun('git', ['rev-parse', `${mergeRefHead}^{tree}`], { cwd: fixtureRoot }), mergeRefTree,
      'GA-P1J-MERGE-REF fixture preserves the exact feature tree');
    eq(realRun('git', ['rev-list', '--parents', '-n', '1', mergeRefHead], { cwd: fixtureRoot }),
      `${mergeRefHead} ${mergeRefBase} ${fixtureBase}`,
      'GA-P1J-MERGE-REF-TOPOLOGY-ORACLE fixture is exactly base-first/feature-second two-parent merge');
    eq(realRun('git', ['rev-parse', `${mergeRefHead}^1`], { cwd: fixtureRoot }), mergeRefBase,
      'GA-P1J-MERGE-REF-TOPOLOGY-ORACLE first parent is the normalized isolated exact base');
    eq(realRun('git', ['rev-parse', `${mergeRefHead}^2`], { cwd: fixtureRoot }), fixtureBase,
      'GA-P1J-MERGE-REF-TOPOLOGY-ORACLE second parent is the exact feature commit');
    assert.throws(
      () => realRun('git', ['rev-parse', `${mergeRefHead}^3`], {
        cwd: fixtureRoot, stdio: 'pipe',
      }),
      /Command failed/,
      'GA-P1J-MERGE-REF-TOPOLOGY-ORACLE fixture has no third parent',
    );
    count++;
    eq(realRun('git', ['rev-list', '--parents', '-n', '1', mergeRefBase], { cwd: fixtureRoot }),
      mergeRefBase,
      'GA-P1J-MERGE-REF isolated range base has no ambient feature ancestry');
    assert.throws(
      () => realRun('git', ['merge-base', '--is-ancestor', fixtureBase, mergeRefBase], {
        cwd: fixtureRoot, stdio: 'pipe',
      }),
      /Command failed/,
      'GA-P1J-AMBIENT-ANCESTRY-MUTANT-KILLED isolated range excludes the ambient feature',
    );
    count++;

    const exactFeatureTitle = 'feat(task-entity): adopt RenderSafe mutation lifecycle';
    const mergeEventPath = path.join(os.tmpdir(), 'ga-p1j-event.json');
    let eventReads = 0;
    const eventReader = (eventPath, encoding) => {
      eq(eventPath, mergeEventPath,
        'GA-P1J-EXACT-EVENT-PATH reads the repository-native Actions event seam');
      eq(encoding, 'utf8', 'GA-P1J-EXACT-EVENT-PATH decodes the payload as UTF-8');
      eventReads++;
      return JSON.stringify({ pull_request: { title: exactFeatureTitle } });
    };
    const mergeRefEnv = {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: mergeEventPath,
      GITHUB_SHA: mergeRefHead,
    };
    const resolvedFeatureTitle = resolveOrdinaryReleaseTitle(
      fixtureRoot, mergeRefHead, mergeRefEnv, eventReader,
    );
    eq(resolvedFeatureTitle, exactFeatureTitle,
      'GA-P1J-EXACT-PR-TITLE binds the merge checkout to its exact future squash title');
    eq(eventReads, 1, 'GA-P1J-EXACT-PR-TITLE reads the exact event payload once');
    ok(resolvedFeatureTitle !== mergeRefSubject,
      'GA-P1J-MERGE-TITLE-ONLY-MUTANT-KILLED rejects the synthetic merge subject as release attribution');

    const alternateTitle = 'fix(autoloop): alternate exact pull-request title';
    eq(resolveOrdinaryReleaseTitle(fixtureRoot, mergeRefHead, mergeRefEnv, () => JSON.stringify({
      pull_request: { title: alternateTitle },
    })), alternateTitle,
    'GA-P1J-HARDCODED-FEATURE-TITLE-MUTANT-KILLED resolves the event title rather than one fixture literal');
    assert.throws(
      () => resolveOrdinaryReleaseTitle(fixtureRoot, mergeRefHead, {
        ...mergeRefEnv, GITHUB_SHA: fixtureHead,
      }, eventReader),
      /title binding does not match checked-out HEAD/,
      'GA-P1J-EXACT-CHECKOUT-BINDING-MUTANT-KILLED rejects a stale event/checkout pairing',
    );
    count++;
    assert.throws(
      () => resolveOrdinaryReleaseTitle(fixtureRoot, mergeRefHead, {
        ...mergeRefEnv, GITHUB_EVENT_PATH: '',
      }, eventReader),
      /requires GITHUB_EVENT_PATH/,
      'GA-P1J-EVENT-BYPASS-MUTANT-KILLED refuses a pull-request checkout without its exact title seam',
    );
    count++;
    eq(resolveOrdinaryReleaseTitle(fixtureRoot, mergeRefHead, {}, eventReader), mergeRefSubject,
      'GA-P1J-NON-PR-FALLBACK preserves the exact HEAD-subject behavior outside pull-request CI');

    const [homeMajor, homeMinor] = homeManifest.version.split('.').map(Number);
    const computedHomeVersion = `${homeMajor}.${homeMinor + 1}.0`;
    const mergeRefDisposable = [];
    let computedMergeState = null;
    const computedMergeRun = (cmd, args, opts = {}) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        mergeRefDisposable.push(args[3]);
      }
      const output = realRun(cmd, args, opts);
      if (cmd === 'node'
          && args[0] === 'scripts/release/compute-release.js'
          && args[1] === '--write') {
        const subscription = JSON.parse(fs.readFileSync(
          path.join(opts.cwd, 'ranch/platform-subscription.json'), 'utf8',
        ));
        computedMergeState = {
          task: JSON.parse(fs.readFileSync(
            path.join(opts.cwd, 'platform/mechanisms/task-entity/manifest.json'), 'utf8',
          )).version,
          home: JSON.parse(fs.readFileSync(
            path.join(opts.cwd, 'platform/blueprints/home/manifest.json'), 'utf8',
          )).version,
          taskPin: subscription.mechanisms.find((item) => item.name === 'task-entity').version,
          homePin: subscription.blueprints.find((item) => item.name === 'home').version,
        };
      }
      return output;
    };
    runIsolatedWorkshopSelfInstall(
      { root: fixtureRoot }, mergeRefHead, mergeRefBase,
      resolvedFeatureTitle, computedMergeRun,
    );
    eq(computedMergeState, {
      task: computedTaskVersion,
      home: computedHomeVersion,
      taskPin: computedTaskVersion,
      homePin: computedHomeVersion,
    }, 'GA-P1J-MERGE-REF-COMPUTED-STATE writes exact version-relative TaskEntity/Home manifests and pins');
    ok(mergeRefDisposable.length === 1 && !fs.existsSync(mergeRefDisposable[0]),
      'GA-P1J-MERGE-REF-COMPUTED-STATE exact-title release install succeeds and target-cleans');

    const mergeTitleDisposable = [];
    const isolatedMergeTitleOracle = (rangeBase, disposable) => {
      let mergeTitleError = null;
      try {
        runIsolatedWorkshopSelfInstall(
          { root: fixtureRoot }, mergeRefHead, rangeBase, mergeRefSubject,
          (cmd, args, opts = {}) => {
            if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
              disposable.push(args[3]);
            }
            return realRun(cmd, args, opts);
          },
        );
      } catch (error) {
        mergeTitleError = error;
      }
      const output = `${mergeTitleError && mergeTitleError.message || ''}\n`
        + `${mergeTitleError && mergeTitleError.stdout || ''}\n`
        + `${mergeTitleError && mergeTitleError.stderr || ''}`;
      assert(
        mergeTitleError
          && /depends on task-entity .* but subscription pins task-entity@/.test(output),
        'GA-P1J-MERGE-TITLE-ONLY-MUTANT-KILLED isolated merge subject must fail the exact TaskEntity floor',
      );
      assert(disposable.length === 1 && !fs.existsSync(disposable[0]),
        'GA-P1J-MERGE-TITLE-ONLY-MUTANT-KILLED failed release worktree is target-cleaned');
    };
    isolatedMergeTitleOracle(mergeRefBase, mergeTitleDisposable);
    count += 2;
    const mergeBorrowedDisposable = [];
    assert.throws(
      () => isolatedMergeTitleOracle(fixtureBase, mergeBorrowedDisposable),
      /isolated merge subject must fail the exact TaskEntity floor/,
      'GA-P1J-AMBIENT-ANCESTRY-MUTANT-KILLED rejects a merge-title result that borrows fixtureBase feat attribution',
    );
    count++;
    ok(mergeBorrowedDisposable.length === 1 && !fs.existsSync(mergeBorrowedDisposable[0]),
      'GA-P1J-AMBIENT-ANCESTRY-MUTANT-KILLED borrowed-attribution worktree still target-cleans');

    // Reproduce PR #668's depth-one failure exactly: the event supplies the
    // future feat title, but an unchanged synthetic feature tree gives
    // compute-release no TaskEntity or Home path attribution.
    const unchangedOrdinaryBase = localCommitFromTree(
      fixtureRoot, mergeRefTree, mergeRefBase, 'test(autoloop): unchanged shallow ordinary base',
    );
    const unchangedOrdinaryHead = localCommitFromTree(
      fixtureRoot, mergeRefTree, unchangedOrdinaryBase, exactFeatureTitle,
    );
    eq(realRun('git', ['diff', '--name-only', unchangedOrdinaryBase, unchangedOrdinaryHead], {
      cwd: fixtureRoot,
    }), '', 'GA-P1L-UNCHANGED-TREE-REPRO has the exact empty component attribution from PR 668');
    const unchangedOrdinaryDisposable = [];
    const unchangedOrdinaryCalls = [];
    let unchangedOrdinaryError = null;
    try {
      runIsolatedWorkshopSelfInstall(
        { root: fixtureRoot }, unchangedOrdinaryHead, unchangedOrdinaryBase, exactFeatureTitle,
        (cmd, args, opts = {}) => {
          unchangedOrdinaryCalls.push([cmd, ...args]);
          if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
            unchangedOrdinaryDisposable.push(args[3]);
          }
          return realRun(cmd, args, opts);
        },
      );
    } catch (error) {
      unchangedOrdinaryError = error;
    }
    const unchangedOrdinaryOutput = `${unchangedOrdinaryError && unchangedOrdinaryError.message || ''}\n`
      + `${unchangedOrdinaryError && unchangedOrdinaryError.stdout || ''}\n`
      + `${unchangedOrdinaryError && unchangedOrdinaryError.stderr || ''}`;
    ok(unchangedOrdinaryError
        && /depends on task-entity .* but subscription pins task-entity@/.test(unchangedOrdinaryOutput),
    'GA-P1L-TITLE-ONLY-ATTRIBUTION-MUTANT-KILLED exact feat title cannot replace component paths');
    ok(unchangedOrdinaryDisposable.length === 1 && !fs.existsSync(unchangedOrdinaryDisposable[0]),
      'GA-P1L-UNCHANGED-TREE-REPRO failed disposable release worktree target-cleans');
    ok(!unchangedOrdinaryCalls.some(([cmd, operation]) => cmd === 'git'
        && ['fetch', 'pull', 'remote'].includes(operation)),
    'GA-P1L-PARENT-FETCH-MUTANT-KILLED unchanged-tree reproduction uses no network or parent fetch');

    const workshopRoot = path.resolve(__dirname, '../..');
    const workshopHead = realRun('git', ['rev-parse', 'HEAD'], { cwd: workshopRoot });
    const workshopTree = realRun('git', ['rev-parse', `${workshopHead}^{tree}`], { cwd: workshopRoot });
    const ordinaryTitle = resolveOrdinaryReleaseTitle(workshopRoot, workshopHead);
    const ordinaryReleaseTitle = isReleasableTitle(ordinaryTitle)
      ? ordinaryTitle
      : exactFeatureTitle;
    const ordinaryPlumbingCalls = [];
    const ordinaryPlumbingRun = (cmd, args, opts = {}) => {
      ordinaryPlumbingCalls.push([cmd, ...args]);
      return realRun(cmd, args, opts);
    };
    const ordinaryTaskPath = 'platform/mechanisms/task-entity/README.md';
    const ordinaryHomePath = 'platform/blueprints/home/manifest.json';
    const ordinaryTreeMode = (root, tree, sourcePath) => {
      const entry = ordinaryPlumbingRun('git', ['ls-tree', tree, '--', sourcePath], { cwd: root });
      const match = entry.match(/^([0-7]{6})\s+blob\s+[0-9a-f]{40}\t/);
      if (!match) throw new Error(`ordinary release tree lacks ${sourcePath}`);
      return match[1];
    };
    const ordinaryTreeWithContents = (root, sourceTree, contentsByPath) => {
      const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-p1l-index-'));
      const indexPath = path.join(indexRoot, 'normalized.index');
      const indexEnv = { ...releaseGateCommitEnv, GIT_INDEX_FILE: indexPath };
      try {
        ordinaryPlumbingRun('git', ['read-tree', sourceTree], {
          cwd: root, stdio: 'pipe', env: indexEnv,
        });
        for (const [sourcePath, contents] of contentsByPath) {
          const blob = ordinaryPlumbingRun('git', ['hash-object', '-w', '--stdin'], {
            cwd: root, stdio: 'pipe', env: indexEnv, input: contents,
          });
          ordinaryPlumbingRun('git', [
            'update-index', '--add', '--cacheinfo',
            `${ordinaryTreeMode(root, sourceTree, sourcePath)},${blob},${sourcePath}`,
          ], { cwd: root, stdio: 'pipe', env: indexEnv });
        }
        return ordinaryPlumbingRun('git', ['write-tree'], {
          cwd: root, stdio: 'pipe', env: indexEnv,
        });
      } finally {
        fs.rmSync(indexRoot, { recursive: true, force: true });
      }
    };
    const ordinaryHomeBaseMarker = '[GA-P1l normalized ordinary base]';
    const buildOrdinaryBaseTree = (
      root, featureTree, sourceTaskVersion, {
        homeDelta = true, homeMarker = true, taskDelta = true,
      } = {},
    ) => {
      const contentsByPath = [];
      if (homeDelta) {
        const normalizedHome = JSON.parse(ordinaryPlumbingRun('git', [
          'show', `${featureTree}:${ordinaryHomePath}`,
        ], { cwd: root }));
        normalizeFixtureTaskFloor(normalizedHome, sourceTaskVersion);
        if (homeMarker) {
          normalizedHome.description = `${normalizedHome.description || ''} ${ordinaryHomeBaseMarker}`
            .trim();
        }
        contentsByPath.push([ordinaryHomePath, `${JSON.stringify(normalizedHome, null, 2)}\n`]);
      }
      if (taskDelta) {
        const featureTask = ordinaryPlumbingRun('git', [
          'show', `${featureTree}:${ordinaryTaskPath}`,
        ], { cwd: root });
        contentsByPath.push([
          ordinaryTaskPath,
          `${featureTask}\n\n<!-- GA-P1l normalized ordinary base -->\n`,
        ]);
      }
      return ordinaryTreeWithContents(root, featureTree, contentsByPath);
    };
    const ordinaryFloorAt = (treeish) => JSON.parse(ordinaryPlumbingRun('git', [
      'show', `${treeish}:${ordinaryHomePath}`,
    ], { cwd: workshopRoot })).depends_on.find((dep) => dep.name === 'task-entity').range;
    const ordinaryTransitionOracle = (
      baseTree, featureTree, sourceTaskVersion = taskManifest.version,
    ) => {
      assert.notStrictEqual(
        baseTree,
        featureTree,
        'shallow ordinary release requires a non-empty exact-tree transition',
      );
      assert.strictEqual(
        ordinaryFloorAt(baseTree),
        `>=${sourceTaskVersion}`,
        'shallow ordinary base normalizes Home to the live TaskEntity source version',
      );
      assert.deepStrictEqual(
        ordinaryPlumbingRun('git', ['diff', '--name-only', baseTree, featureTree], {
          cwd: workshopRoot,
        }).split('\n').filter(Boolean).sort(),
        [ordinaryHomePath, ordinaryTaskPath],
        'shallow ordinary release attributes exactly Home and TaskEntity',
      );
    };
    const ordinaryBaseTree = buildOrdinaryBaseTree(
      workshopRoot, workshopTree, taskManifest.version,
    );
    ordinaryTransitionOracle(ordinaryBaseTree, workshopTree);
    count++;
    const equalFloorHome = JSON.parse(ordinaryPlumbingRun('git', [
      'show', `${workshopTree}:${ordinaryHomePath}`,
    ], { cwd: workshopRoot }));
    normalizeFixtureTaskFloor(equalFloorHome, taskManifest.version);
    const equalFloorFeatureTree = ordinaryTreeWithContents(workshopRoot, workshopTree, [[
      ordinaryHomePath, `${JSON.stringify(equalFloorHome, null, 2)}\n`,
    ]]);
    eq(ordinaryFloorAt(equalFloorFeatureTree), `>=${taskManifest.version}`,
      'GA-P1L-BUMPED-RELEASE-HEAD fixture starts with Home already at the live TaskEntity floor');
    const equalFloorBaseTree = buildOrdinaryBaseTree(
      workshopRoot, equalFloorFeatureTree, taskManifest.version,
    );
    ordinaryTransitionOracle(equalFloorBaseTree, equalFloorFeatureTree);
    count++;
    assert.throws(
      () => ordinaryTransitionOracle(
        buildOrdinaryBaseTree(
          workshopRoot, equalFloorFeatureTree, taskManifest.version, { homeMarker: false },
        ),
        equalFloorFeatureTree,
      ),
      /attributes exactly Home and TaskEntity/,
      'GA-P1L-RELEASE-PR-HOME-DELTA-COLLAPSE-MUTANT-KILLED floor-only normalization cannot omit Home',
    );
    count++;
    assert.throws(
      () => ordinaryTransitionOracle(workshopTree, workshopTree),
      /non-empty exact-tree transition/,
      'GA-P1L-UNCHANGED-TREE-MUTANT-KILLED rejects reuse of the workshop tree as range base',
    );
    count++;
    assert.throws(
      () => ordinaryTransitionOracle(
        buildOrdinaryBaseTree(workshopRoot, workshopTree, taskManifest.version, {
          taskDelta: false,
        }),
        workshopTree,
      ),
      /attributes exactly Home and TaskEntity/,
      'GA-P1L-MISSING-TASK-DELTA-MUTANT-KILLED requires TaskEntity file attribution',
    );
    count++;
    assert.throws(
      () => ordinaryTransitionOracle(
        buildOrdinaryBaseTree(workshopRoot, workshopTree, taskManifest.version, {
          homeDelta: false,
        }),
        workshopTree,
      ),
      /normalizes Home|attributes exactly Home and TaskEntity/,
      'GA-P1L-MISSING-HOME-DELTA-MUTANT-KILLED requires Home file attribution',
    );
    count++;
    assert.throws(
      () => ordinaryTransitionOracle(
        buildOrdinaryBaseTree(workshopRoot, workshopTree, alternateSourceVersion),
        workshopTree,
      ),
      /live TaskEntity source version/,
      'GA-P1L-HISTORICAL-VERSION-MUTANT-KILLED rejects a stale normalization version',
    );
    count++;
    ok(!/\d+\.\d+\.\d+/.test(buildOrdinaryBaseTree.toString())
        && !/\d+\.\d+\.\d+/.test(ordinaryTransitionOracle.toString()),
    'GA-P1L-VERSION-RELATIVE-ORDINARY-RANGE contains no historical component versions');
    ok(!ordinaryPlumbingCalls.some(([cmd, operation]) => cmd === 'git'
        && ['fetch', 'pull', 'remote'].includes(operation)),
    'GA-P1L-PARENT-FETCH-MUTANT-KILLED normalized range uses local plumbing only');

    const nextOrdinaryVersion = (version, title, {
      parse = parseReleaseCommit,
      level = releaseBumpLevel,
      increment = incrementReleaseVersion,
    } = {}) => {
      const parsed = parse(title);
      return increment(version, level(parsed, String(version).startsWith('0.')));
    };
    const expectedOrdinaryState = (title, hooks) => {
      const task = nextOrdinaryVersion(taskManifest.version, title, hooks);
      const home = nextOrdinaryVersion(homeManifest.version, title, hooks);
      return {
        task,
        home,
        taskPin: task,
        homePin: home,
      };
    };
    const ordinaryExpected = expectedOrdinaryState(ordinaryReleaseTitle);
    const ordinaryFeatureHome = JSON.parse(ordinaryPlumbingRun('git', [
      'show', `${workshopTree}:${ordinaryHomePath}`,
    ], { cwd: workshopRoot }));
    normalizeFixtureTaskFloor(ordinaryFeatureHome, ordinaryExpected.task);
    const ordinaryFeatureTree = ordinaryTreeWithContents(workshopRoot, workshopTree, [[
      ordinaryHomePath, `${JSON.stringify(ordinaryFeatureHome, null, 2)}\n`,
    ]]);
    const ordinaryComputedBaseTree = buildOrdinaryBaseTree(
      workshopRoot, ordinaryFeatureTree, taskManifest.version,
    );
    ordinaryTransitionOracle(ordinaryComputedBaseTree, ordinaryFeatureTree);
    const ordinaryBase = localRootCommitFromTree(
      workshopRoot, ordinaryComputedBaseTree, 'test(autoloop): isolated ordinary base',
    );
    const ordinaryHead = localCommitFromTree(
      workshopRoot, ordinaryFeatureTree, ordinaryBase, ordinaryReleaseTitle,
    );
    eq(realRun('git', ['rev-list', '--parents', '-n', '1', ordinaryBase], {
      cwd: workshopRoot,
    }), ordinaryBase,
    'GA-P1M-SHALLOW-COMPUTED-STATE ordinary base has no ambient workshop ancestry');
    eq(realRun('git', ['rev-parse', `${ordinaryHead}^{tree}`], { cwd: workshopRoot }),
      ordinaryFeatureTree,
      'GA-P1G3-SHALLOW-ORDINARY ordinary release binds its title-specific feature tree');
    const ordinaryStatus = realRun('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workshopRoot });
    const ordinaryHomeBefore = fs.readFileSync(path.join(workshopRoot, ordinaryHomePath));
    const ordinaryTaskBefore = fs.readFileSync(path.join(workshopRoot, ordinaryTaskPath));
    const computeOrdinaryState = (head, title, disposable, rangeBase = ordinaryBase) => {
      let computed = null;
      const trackedRun = (cmd, args, opts = {}) => {
        if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          disposable.push(args[3]);
        }
        const output = realRun(cmd, args, opts);
        if (cmd === 'node'
            && args[0] === 'scripts/release/compute-release.js'
            && args[1] === '--write') {
          const subscription = JSON.parse(fs.readFileSync(
            path.join(opts.cwd, 'ranch/platform-subscription.json'), 'utf8',
          ));
          computed = {
            task: JSON.parse(fs.readFileSync(
              path.join(opts.cwd, 'platform/mechanisms/task-entity/manifest.json'), 'utf8',
            )).version,
            home: JSON.parse(fs.readFileSync(
              path.join(opts.cwd, ordinaryHomePath), 'utf8',
            )).version,
            taskPin: subscription.mechanisms.find((item) => item.name === 'task-entity').version,
            homePin: subscription.blueprints.find((item) => item.name === 'home').version,
          };
        }
        return output;
      };
      runIsolatedWorkshopSelfInstall(
        { root: workshopRoot }, head, rangeBase, title, trackedRun,
      );
      return computed;
    };
    const computedOrdinaryState = computeOrdinaryState(
      ordinaryHead, ordinaryReleaseTitle, ordinaryDisposable,
    );
    eq(computedOrdinaryState, ordinaryExpected,
      'GA-P1L2-SHALLOW-COMPUTED-STATE writes canonically classified TaskEntity/Home versions and pins');
    eq(nextOrdinaryVersion(taskManifest.version, exactFeatureTitle), computedTaskVersion,
      'GA-P1L2-FUTURE-FEAT-COMPUTED-STATE computes TaskEntity next minor without a historical literal');
    eq(nextOrdinaryVersion(homeManifest.version, exactFeatureTitle), computedHomeVersion,
      'GA-P1L2-FUTURE-FEAT-COMPUTED-STATE computes Home next minor without a historical literal');

    const ordinaryTitleCases = [
      ['FEAT', exactFeatureTitle],
      ['FIX', 'fix(task-entity): preserve shallow component attribution'],
      ['BREAKING-FIX', 'fix(task-entity)!: replace the shallow component contract'],
      ['BREAKING-PERF', 'perf(task-entity)!: replace the shallow performance contract'],
      ['BREAKING-REFACTOR', 'refactor(task-entity)!: replace the shallow ownership contract'],
    ];
    const buildCanonicalOrdinaryCase = (title) => {
      const expected = expectedOrdinaryState(title);
      const featureHome = JSON.parse(ordinaryPlumbingRun('git', [
        'show', `${workshopTree}:${ordinaryHomePath}`,
      ], { cwd: workshopRoot }));
      normalizeFixtureTaskFloor(featureHome, expected.task);
      const featureTree = ordinaryTreeWithContents(workshopRoot, workshopTree, [[
        ordinaryHomePath, `${JSON.stringify(featureHome, null, 2)}\n`,
      ]]);
      const baseTree = buildOrdinaryBaseTree(
        workshopRoot, featureTree, taskManifest.version,
      );
      ordinaryTransitionOracle(baseTree, featureTree);
      const base = localRootCommitFromTree(
        workshopRoot, baseTree, 'test(autoloop): isolated canonical-state base',
      );
      const head = localCommitFromTree(workshopRoot, featureTree, base, title);
      return { base, head, expected };
    };
    const computedOrdinaryCases = new Map();
    for (const [label, title] of ordinaryTitleCases) {
      ok(isReleasableTitle(title),
        `GA-P1L2-${label}-TITLE is accepted by the production release-title classifier`);
      const fixture = buildCanonicalOrdinaryCase(title);
      eq(realRun('git', ['rev-list', '--parents', '-n', '1', fixture.base], {
        cwd: workshopRoot,
      }), fixture.base,
      `GA-P1M-${label}-CANONICAL-STATE base has no ambient workshop ancestry`);
      const disposable = [];
      computedOrdinaryCases.set(
        label,
        computeOrdinaryState(fixture.head, title, disposable, fixture.base),
      );
      eq(computedOrdinaryCases.get(label), fixture.expected,
        `GA-P1L2-${label}-CANONICAL-STATE predicts exact production TaskEntity/Home versions and pins`);
      ok(disposable.length === 1 && !fs.existsSync(disposable[0]),
        `GA-P1L2-${label}-CANONICAL-STATE target-cleans its disposable release worktree`);
    }
    const fixTitle = ordinaryTitleCases.find(([label]) => label === 'FIX')[1];
    const fixFixture = buildCanonicalOrdinaryCase(fixTitle);
    const simulatedAmbientBase = localRootCommitFromTree(
      workshopRoot, ordinaryBaseTree, 'test(autoloop): simulated ambient base',
    );
    const simulatedAmbientWorkshopHead = localCommitFromTree(
      workshopRoot, workshopTree, simulatedAmbientBase, exactFeatureTitle,
    );
    const borrowedBase = localCommitFromTree(
      workshopRoot,
      realRun('git', ['rev-parse', `${fixFixture.base}^{tree}`], { cwd: workshopRoot }),
      simulatedAmbientWorkshopHead,
      'test(autoloop): canonical-state base borrowing ambient workshop head',
    );
    const borrowedHead = localCommitFromTree(
      workshopRoot,
      realRun('git', ['rev-parse', `${fixFixture.head}^{tree}`], { cwd: workshopRoot }),
      borrowedBase,
      fixTitle,
    );
    const borrowedCanonicalDisposable = [];
    const borrowedFixState = computeOrdinaryState(
      borrowedHead, fixTitle, borrowedCanonicalDisposable, borrowedBase,
    );
    eq(borrowedFixState, expectedOrdinaryState(exactFeatureTitle),
      'GA-P1M-ACTIVE-FEAT-BORROWED-BY-P1L2-FIXTURE control observes the ambient feature bump');
    assert.throws(
      () => assert.deepStrictEqual(borrowedFixState, fixFixture.expected),
      /Expected values to be strictly deep-equal/,
      'GA-P1M-AMBIENT-WORKSHOP-HEAD-MUTANT-KILLED reusing ambient workshopHead fails FIX canonical state',
    );
    count++;
    ok(borrowedCanonicalDisposable.length === 1 && !fs.existsSync(borrowedCanonicalDisposable[0]),
      'GA-P1M-AMBIENT-WORKSHOP-HEAD-MUTANT-KILLED borrowed control target-cleans its release worktree');
    const breakingFixTitle = ordinaryTitleCases.find(([label]) => label === 'BREAKING-FIX')[1];
    const canonicalBreakingState = computedOrdinaryCases.get('BREAKING-FIX');
    assert.throws(
      () => assert.deepStrictEqual(
        expectedOrdinaryState(breakingFixTitle, {
          parse: () => parseReleaseCommit('fix(task-entity): parser bypass'),
        }),
        canonicalBreakingState,
      ),
      /Expected values to be strictly deep-equal/,
      'GA-P1L2-CANONICAL-PARSE-MUTANT-KILLED bypassing parseCommit loses the breaking marker',
    );
    count++;
    assert.throws(
      () => assert.deepStrictEqual(
        expectedOrdinaryState(breakingFixTitle, {
          level: (parsed) => (parsed && parsed.type === 'feat' ? 'minor' : 'patch'),
        }),
        canonicalBreakingState,
      ),
      /Expected values to be strictly deep-equal/,
      'GA-P1L2-NONFEAT-PATCH-MUTANT-KILLED the predecessor feat-versus-patch shortcut misclassifies breaking fix',
    );
    count++;
    assert.throws(
      () => assert.deepStrictEqual(
        expectedOrdinaryState(breakingFixTitle, {
          increment: (version) => version,
        }),
        canonicalBreakingState,
      ),
      /Expected values to be strictly deep-equal/,
      'GA-P1L2-CANONICAL-INCREMENT-MUTANT-KILLED bypassing semver inc cannot predict computed release state',
    );
    count++;
    ok(!/\d+\.\d+\.\d+/.test(nextOrdinaryVersion.toString())
        && !/\d+\.\d+\.\d+/.test(expectedOrdinaryState.toString()),
    'GA-P1L2-CANONICAL-SEMVER-BINDING contains no historical component versions');
    eq(realRun('git', ['rev-parse', 'HEAD'], { cwd: workshopRoot }), workshopHead,
      'GA-P1G-ORDINARY-RELEASE ordinary exact HEAD remains unchanged');
    eq(realRun('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workshopRoot }), ordinaryStatus,
      'GA-P1G-ORDINARY-RELEASE ordinary claimed worktree remains byte-clean');
    ok(fs.readFileSync(path.join(workshopRoot, ordinaryHomePath)).equals(ordinaryHomeBefore)
        && fs.readFileSync(path.join(workshopRoot, ordinaryTaskPath)).equals(ordinaryTaskBefore),
    'GA-P1L-SOURCE-BYTE-CLEAN normalized base and computed release preserve exact source bytes');
    ok(ordinaryDisposable.length === 1 && !fs.existsSync(ordinaryDisposable[0]),
      'GA-P1G-ORDINARY-RELEASE ordinary release install still succeeds and cleans up');
  } finally {
    if (rawAdded) {
      try { realRun('git', ['worktree', 'remove', '--force', rawRoot], { cwd: fixtureRoot, stdio: 'pipe' }); } catch (_) {}
    }
    if (fixtureAdded) {
      try {
        realRun('git', ['worktree', 'remove', '--force', fixtureRoot], {
          cwd: path.resolve(__dirname, '../..'), stdio: 'pipe',
        });
      } catch (_) {}
    }
    fs.rmSync(rawRoot, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

// Production-bound failure and semantic-mutation contract. The shell model
// distinguishes feature-branch history from the one prospective squash, and
// keeps an unrelated worktree registration as a cleanup-side-effect sentinel.
{
  const p1gCoordinatorPath = path.resolve(__dirname, '../../scripts/autoloop/codex-coordinator.js');
  const productionSource = fs.readFileSync(p1gCoordinatorPath, 'utf8');
  const loadMutatedCoordinator = (label, before, after) => {
    eq(productionSource.split(before).length - 1, 1,
      `GA-P1G-${label} mutation anchor matches production exactly once`);
    const mutantPath = path.join(path.dirname(p1gCoordinatorPath), `ga-p1g-${label.toLowerCase()}.js`);
    const mutantModule = new Module(mutantPath);
    mutantModule.filename = mutantPath;
    mutantModule.paths = Module._nodeModulePaths(path.dirname(p1gCoordinatorPath));
    mutantModule._compile(productionSource.replace(before, after), mutantPath);
    return mutantModule.exports;
  };
  const partialAddCanonicalPathOracle = (helper) => {
    const originalTmpdir = os.tmpdir;
    let aliasFixtureRoot = null;
    let aliasTmpRoot;
    let physicalTmpRoot;
    if (process.platform === 'darwin') {
      aliasTmpRoot = '/var/tmp';
      physicalTmpRoot = fs.realpathSync.native(aliasTmpRoot);
      assert.strictEqual(physicalTmpRoot, '/private/var/tmp',
        'GA-P1G2-MACOS-WORKTREE-PATH-ALIAS uses the real /var -> /private/var alias');
    } else {
      aliasFixtureRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'ga-p1g2-path-alias-'));
      physicalTmpRoot = path.join(aliasFixtureRoot, 'private-var');
      aliasTmpRoot = path.join(aliasFixtureRoot, 'var');
      fs.mkdirSync(physicalTmpRoot);
      fs.symlinkSync(physicalTmpRoot, aliasTmpRoot, 'dir');
    }
    const state = {
      registered: false, registeredPath: '', addTarget: '', removeTarget: '',
    };
    const physicalRegistration = (target) => {
      if (target === aliasTmpRoot || target.startsWith(`${aliasTmpRoot}${path.sep}`)) {
        return path.join(physicalTmpRoot, path.relative(aliasTmpRoot, target));
      }
      return target;
    };
    const run = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        state.addTarget = args[3];
        state.registeredPath = physicalRegistration(state.addTarget);
        state.registered = true;
        throw new Error('checkout failed after canonical registration');
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') {
        return state.registered
          ? `worktree ${state.registeredPath}\nHEAD head42\ndetached\n`
          : '';
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        state.removeTarget = args[args.length - 1];
        if (state.removeTarget !== state.registeredPath) throw new Error('noncanonical exact-target removal');
        state.registered = false;
        return '';
      }
      throw new Error(`unexpected canonical-path fixture command: ${cmd} ${args.join(' ')}`);
    };
    os.tmpdir = () => aliasTmpRoot;
    try {
      assert.throws(() => helper(
        { root: '/claimed' }, 'head42', 'base42', 'fix(autoloop): canonical cleanup', run,
      ), /checkout failed after canonical registration/);
    } finally {
      os.tmpdir = originalTmpdir;
      if (aliasFixtureRoot) fs.rmSync(aliasFixtureRoot, { recursive: true, force: true });
    }
    assert.strictEqual(state.registered, false,
      'partial registration leaked through the worktree path alias');
    assert.strictEqual(state.addTarget, state.registeredPath,
      'worktree add must receive the canonical physical target');
    assert.strictEqual(state.removeTarget, state.registeredPath,
      'partial-add cleanup must remove the exact canonical registered target');
  };
  partialAddCanonicalPathOracle(runIsolatedWorkshopSelfInstall);
  count += 3;
  const canonicalTempLine = '    temp = fs.realpathSync.native(tempRoot);';
  const lexicalTempMutant = loadMutatedCoordinator(
    'MACOS-WORKTREE-PATH-ALIAS-MUTANT-KILLED', canonicalTempLine,
    '    temp = tempRoot;',
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => partialAddCanonicalPathOracle(lexicalTempMutant),
    /partial registration leaked through the worktree path alias/,
    'GA-P1G2-MACOS-WORKTREE-PATH-ALIAS-MUTANT-KILLED requires physical target identity');
  count++;
  const registrationInspectionFailureOracle = (helper, cleanupFails = false) => {
    const state = {
      registered: false, registeredPath: '', addTarget: '', cleanupArgs: null,
    };
    const run = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        state.addTarget = args[3];
        state.registeredPath = args[3];
        state.registered = true;
        throw new Error('partial add failed after registration');
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') {
        throw new Error('registration inspection failed');
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        state.cleanupArgs = args.slice();
        state.registered = false;
        if (cleanupFails) throw new Error('target-safe double-force cleanup failed');
        return '';
      }
      throw new Error(`unexpected inspection-failure fixture command: ${cmd} ${args.join(' ')}`);
    };
    let failure = null;
    try {
      helper(
        { root: '/claimed' }, 'head42', 'base42',
        'fix(autoloop): inspection-failure cleanup', run,
      );
    } catch (error) {
      failure = error;
    }
    assert.match(failure && failure.message || '',
      /partial add failed after registration; could not inspect disposable worktree registration: registration inspection failed/,
      'GA-P1G3-INSPECTION-FAILURE aggregates the original add and registration-inspection errors');
    assert.strictEqual(state.registered, false,
      'GA-P1G3-INSPECTION-FAILURE leaves zero disposable registration residue');
    assert.deepStrictEqual(state.cleanupArgs,
      ['worktree', 'remove', '--force', '--force', state.registeredPath],
      'GA-P1G3-INSPECTION-FAILURE uses exact canonical double-force removal');
    assert.strictEqual(state.cleanupArgs[state.cleanupArgs.length - 1], state.addTarget,
      'GA-P1G3-INSPECTION-FAILURE removes the exact canonical partial-add target');
    if (cleanupFails) {
      assert.match(failure.message,
        /failed target-safe cleanup for uninspectable disposable worktree .*target-safe double-force cleanup failed/,
        'GA-P1G3-INSPECTION-FAILURE cleanup failure remains failure-loud');
    }
  };
  registrationInspectionFailureOracle(runIsolatedWorkshopSelfInstall);
  registrationInspectionFailureOracle(runIsolatedWorkshopSelfInstall, true);
  count += 9;
  const omittedRegistrationInspectionCleanup = loadMutatedCoordinator(
    'OMITTED-REGISTRATION-INSPECTION-CLEANUP-MUTANT-KILLED',
    '      } else if (registrationInspectionFailed) {',
    '      } else if (false && registrationInspectionFailed) {',
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(
    () => registrationInspectionFailureOracle(omittedRegistrationInspectionCleanup),
    /leaves zero disposable registration residue/,
    'GA-P1G3-OMITTED-REGISTRATION-INSPECTION-CLEANUP-MUTANT-KILLED uninspectable partial adds require target-safe cleanup',
  );
  count++;
  const setupFailureResidueOracle = (helper, failAt) => {
    const originalMkdtempSync = fs.mkdtempSync;
    const originalRealpathNative = fs.realpathSync.native;
    const originalRmSync = fs.rmSync;
    let tempRoot = '';
    let physicalTarget = '';
    let initialRmFaultInjected = false;
    let setupCleanupFaultInjected = false;
    let setupCleanupTarget = '';
    let runCalls = 0;
    fs.mkdtempSync = (prefix, ...args) => {
      const created = originalMkdtempSync(prefix, ...args);
      if (String(prefix).endsWith('sauce-autoloop-self-install-')) tempRoot = created;
      return created;
    };
    fs.realpathSync.native = (target, ...args) => {
      if (failAt === 'realpath' && target === tempRoot) throw new Error('injected setup realpath failure');
      return originalRealpathNative(target, ...args);
    };
    fs.rmSync = (target, opts) => {
      if (failAt === 'initial-rm'
          && path.basename(target).startsWith('sauce-autoloop-self-install-')) {
        if (!initialRmFaultInjected) {
          initialRmFaultInjected = true;
          physicalTarget = target;
          throw new Error('injected initial placeholder removal failure');
        }
        if (!setupCleanupFaultInjected) {
          setupCleanupFaultInjected = true;
          setupCleanupTarget = target;
          throw new Error('injected setup cleanup failure');
        }
      }
      return originalRmSync(target, opts);
    };
    let setupError = null;
    try {
      try {
        helper(
          { root: '/claimed' }, 'head42', 'base42', 'fix(autoloop): guarded setup',
          () => { runCalls++; throw new Error('git must not run after setup failure'); },
        );
      } catch (error) {
        setupError = error;
      }
    } finally {
      fs.mkdtempSync = originalMkdtempSync;
      fs.realpathSync.native = originalRealpathNative;
      fs.rmSync = originalRmSync;
    }
    assert.match(setupError && setupError.message || '', failAt === 'realpath'
      ? /injected setup realpath failure/
      : /injected initial placeholder removal failure/);
    const residuePaths = [...new Set([tempRoot, physicalTarget].filter(Boolean))]
      .filter((target) => fs.existsSync(target));
    for (const target of residuePaths) originalRmSync(target, { recursive: true, force: true });
    assert.deepStrictEqual(residuePaths, [],
      `GA-P1G2-SETUP-${failAt.toUpperCase()} leaves zero disposable path residue`);
    assert.strictEqual(runCalls, 0,
      `GA-P1G2-SETUP-${failAt.toUpperCase()} fails before every Git operation`);
    if (failAt === 'initial-rm') {
      assert.match(setupError.message, /failed to delete disposable self-install setup path .*injected setup cleanup failure/,
        'GA-P1G2-SETUP-INITIAL-RM aggregates setup and cleanup failures');
      assert.strictEqual(setupCleanupTarget, tempRoot,
        'GA-P1G2-SETUP-INITIAL-RM retries the exact lexical mkdtemp target');
    }
  };
  setupFailureResidueOracle(runIsolatedWorkshopSelfInstall, 'realpath');
  setupFailureResidueOracle(runIsolatedWorkshopSelfInstall, 'initial-rm');
  count += 8;
  const guardedRealpathPrefix = `  try {
    temp = fs.realpathSync.native(tempRoot);`;
  const unguardedRealpathMutant = loadMutatedCoordinator(
    'UNGUARDED-REALPATH-MUTANT-KILLED', guardedRealpathPrefix,
    `  temp = fs.realpathSync.native(tempRoot);
  try {`,
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => setupFailureResidueOracle(unguardedRealpathMutant, 'realpath'),
    /leaves zero disposable path residue/,
    'GA-P1G2-UNGUARDED-REALPATH-MUTANT-KILLED requires setup cleanup after realpath failure');
  count++;
  const guardedInitialRemovalPrefix = `  try {
    temp = fs.realpathSync.native(tempRoot);
    fs.rmSync(temp, { recursive: true, force: true });`;
  const unguardedInitialRemovalMutant = loadMutatedCoordinator(
    'UNGUARDED-INITIAL-RM-MUTANT-KILLED', guardedInitialRemovalPrefix,
    `  temp = fs.realpathSync.native(tempRoot);
  fs.rmSync(temp, { recursive: true, force: true });
  try {`,
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => setupFailureResidueOracle(unguardedInitialRemovalMutant, 'initial-rm'),
    /leaves zero disposable path residue/,
    'GA-P1G2-UNGUARDED-INITIAL-RM-MUTANT-KILLED requires setup cleanup after placeholder removal failure');
  count++;
  const shellFixture = (failAt = '') => {
    const state = {
      calls: [], registered: false, unrelatedRegistered: true, temp: '',
      currentCommit: '', computedCommit: '', computedCwd: '', syntheticTitle: '', removeAttempts: 0,
    };
    const run = (cmd, args, opts = {}) => {
      state.calls.push({ cmd, args: args.slice(), cwd: opts.cwd });
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        state.temp = args[3];
        state.registered = true;
        state.currentCommit = args[4];
        if (failAt === 'checkout') throw new Error('checkout exploded after registration');
        return '';
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') {
        return state.registered ? `worktree ${state.temp}\nHEAD head42\ndetached\n` : '';
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        state.removeAttempts += 1;
        if (failAt === 'remove' && state.removeAttempts === 1) throw new Error('remove exploded');
        state.registered = false;
        return '';
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'prune') {
        state.unrelatedRegistered = false;
        return '';
      }
      if (cmd === 'git' && args[0] === 'rev-parse') return 'tree42';
      if (cmd === 'git' && args[0] === 'commit-tree') {
        eq(args.slice(0, 4), ['commit-tree', 'tree42', '-p', 'base42'],
          'GA-P1G-SYNTHETIC-SQUASH commit-tree binds exact feature tree to exact fetched base');
        state.syntheticTitle = args[args.indexOf('-m') + 1];
        return 'synthetic42';
      }
      if (cmd === 'git' && args[0] === 'reset' && args[1] === '--hard') {
        state.currentCommit = args[2];
        return '';
      }
      if (cmd === 'node' && args[0] === 'scripts/release/compute-release.js') {
        if (failAt === 'compute') throw new Error('compute exploded');
        state.computedCommit = state.currentCommit;
        state.computedCwd = opts.cwd;
        return '';
      }
      if (cmd === 'node' && args[0] === 'platform/install.js') {
        if (failAt === 'install') throw new Error('install exploded');
        if (!state.computedCommit || state.computedCwd !== state.temp || opts.cwd !== state.temp) {
          throw new Error('uncomputed dependency floor');
        }
        if (state.computedCommit === 'synthetic42' && state.syntheticTitle.startsWith('fix(')) {
          throw new Error('synthetic fix leaves dependency floor unsatisfied');
        }
        return '';
      }
      throw new Error(`unexpected self-install fixture command: ${cmd} ${args.join(' ')}`);
    };
    return { state, run };
  };
  const successOracle = (helper) => {
    const fixture = shellFixture();
    helper({ root: '/claimed' }, 'head42', 'base42', 'feat(task-entity): release floor', fixture.run);
    assert.strictEqual(fixture.state.registered, false, 'disposable registration must be removed');
    assert.strictEqual(fixture.state.unrelatedRegistered, true, 'cleanup must preserve unrelated worktree registrations');
    assert.strictEqual(fixture.state.computedCommit, 'synthetic42',
      'compute-release must consume the prospective synthetic squash');
    const compute = fixture.state.calls.find((call) => call.cmd === 'node'
      && call.args[0] === 'scripts/release/compute-release.js');
    assert(compute && compute.cwd === fixture.state.temp,
      'compute-release must run in the disposable worktree');
  };
  const provenanceMismatchOracle = (helper) => {
    const fixture = shellFixture();
    assert.throws(() => helper(
      { root: '/claimed' }, 'head42', 'base42', 'fix(task-entity): wrong squash bump', fixture.run,
    ), /synthetic fix leaves dependency floor unsatisfied/);
    assert.strictEqual(fixture.state.registered, false, 'provenance mismatch must clean target registration');
    assert.strictEqual(fixture.state.unrelatedRegistered, true,
      'provenance mismatch cleanup must preserve unrelated registrations');
  };
  const failureOracle = (helper, failAt, message) => {
    const fixture = shellFixture(failAt);
    assert.throws(() => helper(
      { root: '/claimed' }, 'head42', 'base42', 'feat(task-entity): release floor', fixture.run,
    ), new RegExp(message));
    assert.strictEqual(fixture.state.registered, false, `${failAt} failure must clean registration`);
    assert.strictEqual(fixture.state.unrelatedRegistered, true,
      `${failAt} failure must preserve unrelated registrations`);
  };

  successOracle(runIsolatedWorkshopSelfInstall);
  provenanceMismatchOracle(runIsolatedWorkshopSelfInstall);
  count += 6;
  for (const [failAt, message] of [
    ['checkout', 'checkout exploded after registration'],
    ['compute', 'compute exploded'],
    ['install', 'install exploded'],
    ['remove', 'failed to remove disposable self-install worktree .*remove exploded'],
  ]) {
    failureOracle(runIsolatedWorkshopSelfInstall, failAt, message);
    count += 2;
  }

  const computeLine = "    run('node', ['scripts/release/compute-release.js', '--write'], { cwd: temp, stdio: 'pipe' });";
  const installLine = "    run('node', ['platform/install.js', '--vault', '.', '--auto-approve'], { cwd: temp, stdio: 'pipe' });";
  const syntheticResetLine = "    run('git', ['reset', '--hard', syntheticSha], { cwd: temp, stdio: 'pipe' });";
  const removeLine = "      try { run('git', ['worktree', 'remove', '--force', temp], { cwd: ctx.root, stdio: 'pipe' }); }";
  const omittedCompute = loadMutatedCoordinator(
    'OMITTED-COMPUTE-MUTANT-KILLED', computeLine, '    // mutant: release computation omitted',
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => successOracle(omittedCompute), /uncomputed dependency floor/,
    'GA-P1G-OMITTED-COMPUTE-MUTANT-KILLED release-floor oracle turns red');
  count++;
  const claimedCompute = loadMutatedCoordinator(
    'CLAIMED-CWD-MUTANT-KILLED', computeLine,
    "    run('node', ['scripts/release/compute-release.js', '--write'], { cwd: ctx.root, stdio: 'pipe' });",
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => successOracle(claimedCompute), /uncomputed dependency floor/,
    'GA-P1G-CLAIMED-CWD-MUTANT-KILLED exact-disposable oracle turns red');
  count++;
  const swallowedCompute = loadMutatedCoordinator(
    'SWALLOWED-COMPUTE-MUTANT-KILLED', computeLine,
    `    try { ${computeLine.trim()} } catch (_) {}`,
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => failureOracle(swallowedCompute, 'compute', 'compute exploded'),
    /Missing expected exception|did not match the regular expression/,
    'GA-P1G-SWALLOWED-COMPUTE-MUTANT-KILLED failure-loud oracle turns red');
  count++;
  const swallowedInstall = loadMutatedCoordinator(
    'SWALLOWED-INSTALL-MUTANT-KILLED', installLine,
    `    try { ${installLine.trim()} } catch (_) {}`,
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => failureOracle(swallowedInstall, 'install', 'install exploded'),
    /Missing expected exception/,
    'GA-P1G-SWALLOWED-INSTALL-MUTANT-KILLED failure-loud oracle turns red');
  count++;
  const leakedWorktree = loadMutatedCoordinator(
    'LEAKED-WORKTREE-MUTANT-KILLED', removeLine,
    '      try { /* mutant: disposable worktree removal omitted */ }',
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => successOracle(leakedWorktree), /disposable registration must be removed/,
    'GA-P1G-LEAKED-WORKTREE-MUTANT-KILLED cleanup oracle turns red');
  count++;
  const branchHistoryCompute = loadMutatedCoordinator(
    'BRANCH-HISTORY-COMPUTE-MUTANT-KILLED', computeLine,
    `    run('git', ['reset', '--hard', headSha], { cwd: temp, stdio: 'pipe' });
${computeLine}`,
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => provenanceMismatchOracle(branchHistoryCompute), /Missing expected exception/,
    'GA-P1G-BRANCH-HISTORY-COMPUTE-MUTANT-KILLED multi-commit branch history cannot determine the release plan');
  count++;
  const noSyntheticSquash = loadMutatedCoordinator(
    'NO-SYNTHETIC-SQUASH-MUTANT-KILLED', syntheticResetLine,
    '    // mutant: prospective synthetic squash is never checked out',
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => provenanceMismatchOracle(noSyntheticSquash), /Missing expected exception/,
    'GA-P1G-NO-SYNTHETIC-SQUASH-MUTANT-KILLED exact prospective squash is required');
  count++;
  const relaxedTitleBinding = loadMutatedCoordinator(
    'RELAXED-RECORD-PR-TITLE-MUTANT-KILLED',
    '    if (pr.title !== record.gate_receipt.prospective_pr_title) {',
    '    if (false && pr.title !== record.gate_receipt.prospective_pr_title) {',
  ).commandRecordPr;
  const titleBindingOracle = async (recordPr) => {
    const state = emptyState();
    state.cards.A = {
      card: 'A', branch: 'autoloop/a', worktree: '/workshop/a', phase: 'implementing',
      gate_receipt: passingReceipt('head42', false, 'fix(autoloop): verified title'),
    };
    await assert.rejects(() => recordPr({ root: '/workshop' }, {
      json: true, card: 'A', pr: '42',
    }, {
      readState: () => state,
      prView: () => ({
        number: 42, headRefName: 'autoloop/a', baseRefName: 'main',
        headRefOid: 'head42', baseRefOid: 'base42',
        title: 'fix(autoloop): edited title', url: 'https://example.invalid/pr/42',
      }),
      sh: (_cmd, args) => args[0] === 'status' ? '' : 'head42',
      writeState: () => {},
      withLock: immediateCardLock,
    }), (error) => error.code === 'title_mismatch');
  };
  await titleBindingOracle(commandRecordPr);
  await assert.rejects(() => titleBindingOracle(relaxedTitleBinding), /Missing expected rejection/,
    'GA-P1G-RELAXED-RECORD-PR-TITLE-MUTANT-KILLED byte-exact title binding is required');
  count += 2;
  const omittedAdvanceTitleBinding = loadMutatedCoordinator(
    'OMITTED-ADVANCE-PR-TITLE-MUTANT-KILLED',
    '    const gateStatus = gateReceiptStatus(record, pr.headRefOid, pr.baseRefOid, pr.title);',
    '    const gateStatus = gateReceiptStatus(record, pr.headRefOid, pr.baseRefOid);',
  ).stepCard;
  const advanceVerifiedTitle = 'fix(autoloop): gate-verified title';
  const advanceActualTitle = 'fix(autoloop): byte-different actual title';
  assert.notStrictEqual(advanceActualTitle, advanceVerifiedTitle,
    'GA-P1G3-ADVANCE-TITLE-BINDING fixtures use byte-different verified and actual titles');
  count++;
  const openAdvanceTitleBindingOracle = async (advanceStep) => {
    const record = {
      card: 'A', phase: 'feature_pr', feature_pr: 42,
      gate_receipt: passingReceipt('head42', true, advanceVerifiedTitle),
    };
    let armed = 0;
    const result = await advanceStep({ root: '/workshop' }, emptyState(), record, {}, {
      prView: () => ({
        ...basePr, title: advanceActualTitle, statusCheckRollup: [
          { name: 'mac', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ],
      }),
      armFeatureAutoMerge: () => { armed++; },
    });
    assert.strictEqual(armed, 0,
      'GA-P1G3-ADVANCE-TITLE-BINDING open title drift never arms auto-merge');
    assert.strictEqual(result.action, 'verify-gates',
      'GA-P1G3-ADVANCE-TITLE-BINDING open title drift returns to verify-gates');
    assert.strictEqual(record.phase, 'feature_pr',
      'GA-P1G3-ADVANCE-TITLE-BINDING open title drift preserves feature_pr');
  };
  await openAdvanceTitleBindingOracle(stepCard);
  count += 3;
  await assert.rejects(
    () => openAdvanceTitleBindingOracle(omittedAdvanceTitleBinding),
    /open title drift never arms auto-merge/,
    'GA-P1G3-OMITTED-ADVANCE-PR-TITLE-OPEN-MUTANT-KILLED production call-site binding is required',
  );
  count++;
  const mergedAdvanceTitleBindingOracle = async (advanceStep) => {
    const record = {
      card: 'A', phase: 'feature_pr', feature_pr: 42,
      gate_receipt: passingReceipt('head42', true, advanceVerifiedTitle),
    };
    const result = await advanceStep({ root: '/workshop' }, emptyState(), record, {}, {
      prView: () => ({
        ...basePr, state: 'MERGED', title: advanceActualTitle,
        mergeCommit: { oid: 'merge42' },
      }),
      writeState: () => {},
    });
    assert.notStrictEqual(record.phase, 'feature_merged',
      'GA-P1G3-ADVANCE-TITLE-BINDING merged title drift never transitions feature_merged');
    assert.strictEqual(record.phase, 'needs-inspection',
      'GA-P1G3-ADVANCE-TITLE-BINDING merged title drift persists needs-inspection');
    assert.strictEqual(result.action, 'needs-inspection',
      'GA-P1G3-ADVANCE-TITLE-BINDING merged title drift returns needs-inspection');
  };
  await mergedAdvanceTitleBindingOracle(stepCard);
  count += 3;
  await assert.rejects(
    () => mergedAdvanceTitleBindingOracle(omittedAdvanceTitleBinding),
    /merged title drift never transitions feature_merged/,
    'GA-P1G3-OMITTED-ADVANCE-PR-TITLE-MERGED-MUTANT-KILLED production call-site binding is required',
  );
  count++;
  const unrelatedPrune = loadMutatedCoordinator(
    'UNRELATED-PRUNE-SIDE-EFFECT-MUTANT-KILLED', removeLine,
    "      try { run('git', ['worktree', 'remove', '--force', temp], { cwd: ctx.root, stdio: 'pipe' }); run('git', ['worktree', 'prune'], { cwd: ctx.root, stdio: 'pipe' }); }",
  ).runIsolatedWorkshopSelfInstall;
  assert.throws(() => successOracle(unrelatedPrune), /cleanup must preserve unrelated worktree registrations/,
    'GA-P1G-UNRELATED-PRUNE-SIDE-EFFECT-MUTANT-KILLED cleanup never prunes unrelated registrations');
  count++;
}

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

function makeEpicProjectionFixture(label) {
  const root = path.join(tmp, `es4-${label}`);
  const projectRoot = path.join(root, 'spice', 'projects', 'test');
  const cardsRoot = path.join(projectRoot, 'tasks');
  const epicRoot = path.join(cardsRoot, 'Epic A');
  const epicBoardDir = path.join(epicRoot, 'board');
  const parentBoardPath = path.join(projectRoot, 'project-board.md');
  const atlasPath = path.join(epicRoot, 'Epic A.md');
  const epicBoardPath = path.join(epicBoardDir, 'Epic A-board.md');
  const cardPath = path.join(epicBoardDir, 'A1.md');
  fs.mkdirSync(epicBoardDir, { recursive: true });
  fs.mkdirSync(path.join(epicRoot, 'context', 'runs'), { recursive: true });
  fs.writeFileSync(parentBoardPath, [
    '## In Planning', '- [ ] [[Epic B]]', '- [ ] [[Epic C]]', '',
    '## In Progress', '', '## Blocked', '',
    '## Completed', '- [x] [[Epic A]]', '',
  ].join('\n'));
  fs.writeFileSync(atlasPath, [
    '---', 'type: epic', 'schema_version: 1.1.0',
    'source_board: spice/projects/test/project-board.md',
    'kanban_board: spice/projects/test/project-board.md',
    'status: planned',
    'epic_board: spice/projects/test/tasks/Epic A/board/Epic A-board.md',
    'posture: claimable', '---', 'atlas body', '',
  ].join('\n'));
  fs.writeFileSync(epicBoardPath, [
    '---', 'kanban-plugin: board', 'board_role: epic', 'epic: "[[Epic A]]"', '---', '',
    '## In Planning', '- [ ] [[A1]]', '- [ ] [[A2]]', '',
    '## In Progress', '', '## Blocked', '', '## Completed', '',
  ].join('\n'));
  fs.writeFileSync(cardPath, [
    '---', 'type: slice', 'schema_version: 1.1.0', 'epic: "[[Epic A]]"',
    'task_parent: spice/projects/test/tasks/Epic A/Epic A.md',
    'source_board: spice/projects/test/tasks/Epic A/board/Epic A-board.md',
    'kanban_board: spice/projects/test/tasks/Epic A/board/Epic A-board.md',
    'kanban_column: In Planning', 'status: planning', 'depends_on: []', '---', 'A1 body', '',
  ].join('\n'));
  fs.writeFileSync(path.join(epicBoardDir, 'A2.md'), [
    '---', 'type: slice', 'schema_version: 1.1.0', 'epic: "[[Epic A]]"',
    'task_parent: spice/projects/test/tasks/Epic A/Epic A.md',
    'source_board: spice/projects/test/tasks/Epic A/board/Epic A-board.md',
    'kanban_board: spice/projects/test/tasks/Epic A/board/Epic A-board.md',
    'status: planning', 'depends_on: []', '---', '',
  ].join('\n'));
  const state = emptyState();
  state.cards.A1 = { card: 'A1', phase: 'implementing', parent_card: 'Epic A', card_path: cardPath };
  const files = [epicBoardPath, cardPath, parentBoardPath, atlasPath];
  return { root, cardsRoot, parentBoardPath, atlasPath, epicBoardPath, cardPath, state, files };
}

function assertEpicProjectionConverged(fixture, label) {
  ok(/## In Progress[\s\S]*- \[ \] \[\[A1\]\]/.test(fs.readFileSync(fixture.epicBoardPath, 'utf8')), `${label} paints the slice on its epic board`);
  ok(/kanban_column: In Progress/.test(fs.readFileSync(fixture.cardPath, 'utf8'))
    && /status: in_progress/.test(fs.readFileSync(fixture.cardPath, 'utf8')), `${label} paints canonical slice metadata`);
  const parent = fs.readFileSync(fixture.parentBoardPath, 'utf8');
  ok(/## In Progress[\s\S]*- \[ \] \[\[Epic A\]\]/.test(parent), `${label} repaints the epic from its slice roll-up`);
  ok(parent.indexOf('[[Epic B]]') < parent.indexOf('[[Epic C]]'), `${label} preserves untouched In Planning priority order`);
  const atlas = fs.readFileSync(fixture.atlasPath, 'utf8');
  ok(/status: active/.test(atlas) && /posture: claimable/.test(atlas), `${label} paints the derived epic atlas state`);
}

const epicProjection = makeEpicProjectionFixture('reconcile');
let epicLedgerWrites = 0;
const epicReconcileDeps = {
  readState: () => epicProjection.state,
  writeState: () => { epicLedgerWrites += 1; },
  withLock: async (_ctx, _name, fn) => fn(),
  boardPath: epicProjection.parentBoardPath,
  cardsRoot: epicProjection.cardsRoot,
  now: () => '2026-07-23T14:00:00.000Z',
};
const firstEpicReconcile = await commandReconcile(
  { root: epicProjection.root },
  { card: 'A1' },
  epicReconcileDeps,
);
eq(firstEpicReconcile.changed, 1, 'ES4-DUAL-RECONCILE repairs all canonical projection surfaces');
assertEpicProjectionConverged(epicProjection, 'ES4-DUAL-RECONCILE');
const epicBytesAfterRepair = epicProjection.files.map((target) => fs.readFileSync(target, 'utf8'));
const epicStateAfterRepair = JSON.stringify(epicProjection.state);
const epicWritesAfterRepair = epicLedgerWrites;
const secondEpicReconcile = await commandReconcile(
  { root: epicProjection.root },
  { card: 'A1' },
  epicReconcileDeps,
);
eq(secondEpicReconcile.no_op, true, 'ES4-DUAL-NOOP exact-card replay reports no_op:true');
eq(epicProjection.files.map((target) => fs.readFileSync(target, 'utf8')), epicBytesAfterRepair, 'ES4-DUAL-NOOP keeps every projection surface byte-stable');
eq(JSON.stringify(epicProjection.state), epicStateAfterRepair, 'ES4-DUAL-NOOP keeps ledger state byte-stable');
eq(epicLedgerWrites, epicWritesAfterRepair, 'ES4-DUAL-NOOP performs no ledger write');

const missingReceiptProjection = makeEpicProjectionFixture('missing-receipts');
missingReceiptProjection.state.cards.A1.phase = 'deployed';
const missingReceiptResult = projectCard(
  missingReceiptProjection.cardPath,
  missingReceiptProjection.parentBoardPath,
  'A1',
  'deployed',
  {
    record: missingReceiptProjection.state.cards.A1,
    state: missingReceiptProjection.state,
    cardsRoot: missingReceiptProjection.cardsRoot,
  },
);
eq(missingReceiptResult.projection_findings.map((finding) => finding.card), ['A1'],
  'ES4-VALID-CANONICAL-UNTRACKED-COMPLETION-GRACEFUL-FINDING contains a receiptless deployed phase per exact card');
eq(missingReceiptResult.projection_findings[0].reconcile, "reconcile --card 'A1'",
  'ES4-VALID-CANONICAL-UNTRACKED-COMPLETION-GRACEFUL-FINDING gives the receiptless card a shell-safe exact reconcile route');
ok(!/status: done/.test(fs.readFileSync(missingReceiptProjection.atlasPath, 'utf8')),
  'ES4-NO-SYNTHETIC-LEGACY-RECEIPT never counts a deployed phase done without successful deployment receipts');
ok(/## In Progress[\s\S]*- \[ \] \[\[A1\]\]/.test(fs.readFileSync(missingReceiptProjection.epicBoardPath, 'utf8')),
  'ES4-PHASE-ONLY-SLICE-COMPLETION-PROJECTION keeps a receiptless deployed slice unchecked and non-completed');
ok(/kanban_column: In Progress/.test(fs.readFileSync(missingReceiptProjection.cardPath, 'utf8'))
  && /status: in_progress/.test(fs.readFileSync(missingReceiptProjection.cardPath, 'utf8')),
  'ES4-PHASE-ONLY-SLICE-COMPLETION-PROJECTION keeps receiptless deployed note metadata non-completed');
ok(!missingReceiptProjection.state.cards.A1.vault_receipts,
  'ES4-NO-SYNTHETIC-LEGACY-RECEIPT never mints or backfills a deployment receipt');
const missingReceiptStatus = commandStatus(
  { root: missingReceiptProjection.root },
  {
    state: missingReceiptProjection.state,
    boardMd: fs.readFileSync(missingReceiptProjection.parentBoardPath, 'utf8'),
    boardPath: missingReceiptProjection.parentBoardPath,
    cardsRoot: missingReceiptProjection.cardsRoot,
    loadCard: () => null,
  },
);
ok(missingReceiptStatus.board_drift.some((finding) => finding.card === 'A1'
  && /legacy completion lacks successful deployment receipts/.test(finding.issue)),
  'ES4-PHASE-ONLY-SLICE-COMPLETION-PROJECTION keeps status available with one actionable finding');

const statusMetadataProjection = makeEpicProjectionFixture('status-metadata-convergence');
fs.writeFileSync(
  statusMetadataProjection.cardPath,
  fs.readFileSync(statusMetadataProjection.cardPath, 'utf8').replace('schema_version: 1.1.0\n', ''),
);
statusMetadataProjection.state.cards.A1.phase = 'deployed';
const statusMetadataReconcileDeps = {
  readState: () => statusMetadataProjection.state,
  writeState: () => {},
  withLock: async (_ctx, _name, fn) => fn(),
  boardPath: statusMetadataProjection.parentBoardPath,
  cardsRoot: statusMetadataProjection.cardsRoot,
  now: () => '2026-07-24T21:00:00.000Z',
};
const statusMetadataReconcile = await commandReconcile(
  { root: statusMetadataProjection.root },
  { card: 'A1' },
  statusMetadataReconcileDeps,
);
ok(statusMetadataReconcile.action === 'reconciled'
  && statusMetadataReconcile.results[0].projection_findings[0].card === 'A1',
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE exact reconcile returns the one receiptless finding');
const statusMetadataReplay = await commandReconcile(
  { root: statusMetadataProjection.root },
  { card: 'A1' },
  statusMetadataReconcileDeps,
);
ok(statusMetadataReplay.no_op,
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE exact replay is a literal no-op');
const statusMetadataStatus = commandStatus(
  { root: statusMetadataProjection.root },
  {
    state: statusMetadataProjection.state,
    boardMd: fs.readFileSync(statusMetadataProjection.parentBoardPath, 'utf8'),
    boardPath: statusMetadataProjection.parentBoardPath,
    cardsRoot: statusMetadataProjection.cardsRoot,
    loadCard: () => null,
  },
);
eq(statusMetadataStatus.tracked.find((record) => record.card === 'A1').status, 'in_progress',
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE summarizes receiptless deployed state as non-completed');
eq(statusMetadataStatus.projection_problems, [],
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE has zero contradictory metadata projection problems');
eq(statusMetadataStatus.board_drift.map((finding) => finding.card), ['A1'],
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE emits exactly one bounded legacy finding');
ok(!statusMetadataProjection.state.cards.A1.vault_receipts && !statusMetadataProjection.state.cards.A2,
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE synthesizes neither receipts nor legacy records');

const successfulReceipts = {
  headspace: { ok: true, installed_version: '0.257.0' },
  accuris: { ok: true, installed_version: '0.257.0' },
  ero: { ok: true, installed_version: '0.257.0' },
};
missingReceiptProjection.state.cards.A1.required_version = '0.257.0';
missingReceiptProjection.state.cards.A1.vault_receipts = successfulReceipts;
missingReceiptProjection.state.cards.A2 = {
  card: 'A2',
  phase: 'deployed',
  required_version: '0.257.0',
  vault_receipts: successfulReceipts,
  card_path: path.join(path.dirname(missingReceiptProjection.cardPath), 'A2.md'),
};
projectCard(
  missingReceiptProjection.cardPath,
  missingReceiptProjection.parentBoardPath,
  'A1',
  'deployed',
  {
    record: missingReceiptProjection.state.cards.A1,
    state: missingReceiptProjection.state,
    cardsRoot: missingReceiptProjection.cardsRoot,
  },
);
ok(/## Completed[\s\S]*- \[x\] \[\[Epic A\]\]/.test(fs.readFileSync(missingReceiptProjection.parentBoardPath, 'utf8')),
  'ES4-RECEIPT-ROLLUP paints done only when every slice has successful deployment receipts');
ok(/status: done/.test(fs.readFileSync(missingReceiptProjection.atlasPath, 'utf8'))
  && /posture: done/.test(fs.readFileSync(missingReceiptProjection.atlasPath, 'utf8')),
'ES4-RECEIPT-ROLLUP paints a receipt-proven done atlas');
projectCard(
  missingReceiptProjection.state.cards.A2.card_path,
  missingReceiptProjection.parentBoardPath,
  'A2',
  'deployed',
  {
    record: missingReceiptProjection.state.cards.A2,
    state: missingReceiptProjection.state,
    cardsRoot: missingReceiptProjection.cardsRoot,
  },
);
const successfulReceiptStatus = commandStatus(
  { root: missingReceiptProjection.root },
  {
    state: missingReceiptProjection.state,
    boardMd: fs.readFileSync(missingReceiptProjection.parentBoardPath, 'utf8'),
    boardPath: missingReceiptProjection.parentBoardPath,
    cardsRoot: missingReceiptProjection.cardsRoot,
    loadCard: () => null,
  },
);
eq(successfulReceiptStatus.tracked.filter((record) => ['A1', 'A2'].includes(record.card))
  .map((record) => record.status), ['completed', 'completed'],
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE permits completed status only after every required receipt succeeds');
ok(!successfulReceiptStatus.board_drift.some((finding) => /legacy completion lacks/.test(finding.issue)),
  'ES4-PHASE-ONLY-STATUS-METADATA-CONVERGENCE clears legacy findings after receipt-proven deployment');

const backlinkProjection = makeEpicProjectionFixture('bad-backlink');
fs.writeFileSync(
  backlinkProjection.cardPath,
  fs.readFileSync(backlinkProjection.cardPath, 'utf8')
    .replace('tasks/Epic A/Epic A.md', 'tasks/Other Epic/Other Epic.md'),
);
assert.throws(() => projectCard(
  backlinkProjection.cardPath,
  backlinkProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: backlinkProjection.state.cards.A1,
    state: backlinkProjection.state,
    cardsRoot: backlinkProjection.cardsRoot,
  },
), /mismatched task_parent/, 'ES4-CANONICAL-SLICE-FAILOPEN rejects an epic/task_parent identity mismatch');

const shallowProjection = makeEpicProjectionFixture('shallow-board');
fs.writeFileSync(
  shallowProjection.cardPath,
  fs.readFileSync(shallowProjection.cardPath, 'utf8')
    .replaceAll('spice/projects/test/tasks/Epic A/board/Epic A-board.md', 'board/Epic A-board.md'),
);
assert.throws(() => projectCard(
  shallowProjection.cardPath,
  shallowProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: shallowProjection.state.cards.A1,
    state: shallowProjection.state,
    cardsRoot: shallowProjection.cardsRoot,
  },
), /shallow or mismatched source board/, 'ES4-CANONICAL-SLICE-FAILOPEN rejects shallow source_board and kanban_board paths');

const nestedProjection = makeEpicProjectionFixture('nested-slice');
const nestedCardPath = path.join(path.dirname(nestedProjection.cardPath), 'A1', 'A1.md');
fs.mkdirSync(path.dirname(nestedCardPath));
fs.copyFileSync(nestedProjection.cardPath, nestedCardPath);
nestedProjection.state.cards.A1.card_path = nestedCardPath;
assert.throws(() => projectCard(
  nestedCardPath,
  nestedProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: nestedProjection.state.cards.A1,
    state: nestedProjection.state,
    cardsRoot: nestedProjection.cardsRoot,
  },
), /must live flat beside its epic board/, 'ES4-CANONICAL-SLICE-FAILOPEN rejects a slice nested below the canonical board directory');

const crossEpicProjection = makeEpicProjectionFixture('cross-epic-posture');
const crossEpicSiblingPath = path.join(path.dirname(crossEpicProjection.cardPath), 'A2.md');
fs.writeFileSync(
  crossEpicSiblingPath,
  fs.readFileSync(crossEpicSiblingPath, 'utf8')
    .replace('depends_on: []', 'depends_on:\n  - "[[External Slice]]"'),
);
projectCard(
  crossEpicProjection.cardPath,
  crossEpicProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: crossEpicProjection.state.cards.A1,
    state: crossEpicProjection.state,
    cardsRoot: crossEpicProjection.cardsRoot,
  },
);
ok(/posture: blocked_by_dependencies/.test(fs.readFileSync(crossEpicProjection.atlasPath, 'utf8')),
  'ES4-DUAL-POSTURE derives a cross-epic dependency posture from canonical sibling contracts');

const malformedSiblingProjection = makeEpicProjectionFixture('malformed-sibling');
const malformedSiblingPath = path.join(path.dirname(malformedSiblingProjection.cardPath), 'A2.md');
fs.writeFileSync(
  malformedSiblingPath,
  fs.readFileSync(malformedSiblingPath, 'utf8')
    .replace('type: slice', 'type: task-hub')
    .replace('epic: "[[Epic A]]"', 'epic: "[[Other Epic]]"')
    .replace('tasks/Epic A/Epic A.md', 'tasks/Other Epic/Other Epic.md')
    .replaceAll('tasks/Epic A/board/Epic A-board.md', 'tasks/Other Epic/board/Other Epic-board.md'),
);
const malformedParentBefore = fs.readFileSync(malformedSiblingProjection.parentBoardPath, 'utf8');
const malformedAtlasBefore = fs.readFileSync(malformedSiblingProjection.atlasPath, 'utf8');
assert.throws(() => projectCard(
  malformedSiblingProjection.cardPath,
  malformedSiblingProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: malformedSiblingProjection.state.cards.A1,
    state: malformedSiblingProjection.state,
    cardsRoot: malformedSiblingProjection.cardsRoot,
  },
), /epic member A2\.md is not type slice/, 'ES4-CANONICAL-SLICE-FAILOPEN validates every sibling note before roll-up');
eq(fs.readFileSync(malformedSiblingProjection.parentBoardPath, 'utf8'), malformedParentBefore,
  'ES4-CANONICAL-SLICE-FAILOPEN leaves the parent board byte-stable after sibling refusal');
eq(fs.readFileSync(malformedSiblingProjection.atlasPath, 'utf8'), malformedAtlasBefore,
  'ES4-CANONICAL-SLICE-FAILOPEN leaves the atlas byte-stable after sibling refusal');
const topologyDiagnostic = projectionBoardDrift(
  fs.readFileSync(malformedSiblingProjection.parentBoardPath, 'utf8'),
  {
    ...malformedSiblingProjection.state.cards.A1,
    card: 'ES4a4 Dual projection and exact-card reconciliation (value-review completion)',
  },
  {
    boardPath: malformedSiblingProjection.parentBoardPath,
    cardsRoot: malformedSiblingProjection.cardsRoot,
    state: malformedSiblingProjection.state,
  },
);
ok(/canonical epic projection is unreadable:/.test(topologyDiagnostic.issue),
  'ES4-CANONICAL-TOPOLOGY-DIAGNOSTIC-ROUTE contains a topology refusal as an actionable drift finding');
eq(topologyDiagnostic.reconcile,
  "reconcile --card 'ES4a4 Dual projection and exact-card reconciliation (value-review completion)'",
  'ES4-CANONICAL-TOPOLOGY-DIAGNOSTIC-EXACT-CARD-QUOTING preserves a spaced exact-card operand');
eq(fs.readFileSync(malformedSiblingProjection.parentBoardPath, 'utf8'), malformedParentBefore,
  'ES4-CANONICAL-TOPOLOGY-DIAGNOSTIC-ROUTE leaves projection surfaces byte-stable');

const crossPrefixProjection = makeEpicProjectionFixture('cross-prefix-sibling');
const crossPrefixSiblingPath = path.join(path.dirname(crossPrefixProjection.cardPath), 'A2.md');
fs.writeFileSync(
  crossPrefixSiblingPath,
  fs.readFileSync(crossPrefixSiblingPath, 'utf8')
    .replaceAll('spice/projects/test/', 'spice/projects/WRONG/'),
);
assert.throws(() => projectCard(
  crossPrefixProjection.cardPath,
  crossPrefixProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: crossPrefixProjection.state.cards.A1,
    state: crossPrefixProjection.state,
    cardsRoot: crossPrefixProjection.cardsRoot,
  },
), /mismatched task_parent/, 'ES4-CANONICAL-SLICE-FAILOPEN binds every sibling to the atlas exact project prefix');

const rootAliasProjection = makeEpicProjectionFixture('physical-root-alias');
for (const target of [
  rootAliasProjection.atlasPath,
  rootAliasProjection.cardPath,
  path.join(path.dirname(rootAliasProjection.cardPath), 'A2.md'),
]) {
  fs.writeFileSync(
    target,
    fs.readFileSync(target, 'utf8').replaceAll('spice/projects/test/', 'bogus/projects/test/'),
  );
}
const rootAliasBytes = rootAliasProjection.files.map((target) => fs.readFileSync(target, 'utf8'));
assert.throws(() => projectCard(
  rootAliasProjection.cardPath,
  rootAliasProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: rootAliasProjection.state.cards.A1,
    state: rootAliasProjection.state,
    cardsRoot: rootAliasProjection.cardsRoot,
  },
), /does not bind its canonical parent board/, 'ES4-CANONICAL-SLICE-PROJECT-PREFIX-ROOT-ALIAS rejects a consistently bogus metadata prefix');
eq(rootAliasProjection.files.map((target) => fs.readFileSync(target, 'utf8')), rootAliasBytes,
  'ES4-CANONICAL-SLICE-PROJECT-PREFIX-ROOT-ALIAS fails before every slice and epic projection write');

const symlinkAliasProjection = makeEpicProjectionFixture('physical-root-symlink-alias');
const physicalProjectRoot = path.dirname(symlinkAliasProjection.cardsRoot);
const aliasProjectRoot = path.join(path.dirname(physicalProjectRoot), 'alias');
fs.symlinkSync(physicalProjectRoot, aliasProjectRoot, 'dir');
for (const target of [
  symlinkAliasProjection.atlasPath,
  symlinkAliasProjection.cardPath,
  path.join(path.dirname(symlinkAliasProjection.cardPath), 'A2.md'),
]) {
  fs.writeFileSync(
    target,
    fs.readFileSync(target, 'utf8').replaceAll('spice/projects/test/', 'spice/projects/alias/'),
  );
}
const symlinkAliasBytes = symlinkAliasProjection.files.map((target) => fs.readFileSync(target, 'utf8'));
const aliasCardsRoot = path.join(aliasProjectRoot, 'tasks');
const aliasParentBoard = path.join(aliasProjectRoot, 'project-board.md');
const symlinkAliasCardPath = path.join(aliasCardsRoot, 'Epic A', 'board', 'A1.md');
assert.throws(() => projectCard(
  symlinkAliasCardPath,
  aliasParentBoard,
  'A1',
  'implementing',
  {
    record: { ...symlinkAliasProjection.state.cards.A1, card_path: symlinkAliasCardPath },
    state: symlinkAliasProjection.state,
    cardsRoot: aliasCardsRoot,
  },
), /does not bind its canonical parent board/, 'ES4-CANONICAL-SLICE-PROJECT-PREFIX-ROOT-ALIAS resolves project-directory symlinks to physical identity');
eq(symlinkAliasProjection.files.map((target) => fs.readFileSync(target, 'utf8')), symlinkAliasBytes,
  'ES4-CANONICAL-SLICE-PROJECT-PREFIX-ROOT-ALIAS rejects a symlink alias before every projection write');

const epicRootEscapeProjection = makeEpicProjectionFixture('epic-root-symlink-escape');
const escapedEpicRoot = path.join(epicRootEscapeProjection.root, 'outside', 'Epic A');
const canonicalEpicRoot = path.dirname(epicRootEscapeProjection.atlasPath);
fs.mkdirSync(path.dirname(escapedEpicRoot), { recursive: true });
fs.renameSync(canonicalEpicRoot, escapedEpicRoot);
fs.symlinkSync(escapedEpicRoot, canonicalEpicRoot, 'dir');
const epicRootEscapeBytes = epicRootEscapeProjection.files.map((target) => fs.readFileSync(target, 'utf8'));
let epicRootEscapeWrites = 0;
assert.throws(() => projectCard(
  epicRootEscapeProjection.cardPath,
  epicRootEscapeProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: epicRootEscapeProjection.state.cards.A1,
    state: epicRootEscapeProjection.state,
    cardsRoot: epicRootEscapeProjection.cardsRoot,
    writeText: () => { epicRootEscapeWrites += 1; },
  },
), /epic Epic A escapes its physical root/,
'ES4-CANONICAL-EPIC-ROOT-SYMLINK-ESCAPE rejects an epic-root symlink outside the physical cards root');
eq(epicRootEscapeWrites, 0,
  'ES4-CANONICAL-EPIC-ROOT-SYMLINK-ESCAPE refuses before every projection write');
eq(epicRootEscapeProjection.files.map((target) => fs.readFileSync(target, 'utf8')), epicRootEscapeBytes,
  'ES4-CANONICAL-EPIC-ROOT-SYMLINK-ESCAPE preserves every inside and outside target byte');

const boardDirEscapeProjection = makeEpicProjectionFixture('board-dir-symlink-escape');
const canonicalBoardDir = path.dirname(boardDirEscapeProjection.cardPath);
const escapedBoardDir = path.join(boardDirEscapeProjection.root, 'outside-board');
fs.renameSync(canonicalBoardDir, escapedBoardDir);
fs.symlinkSync(escapedBoardDir, canonicalBoardDir, 'dir');
const boardDirEscapeBytes = boardDirEscapeProjection.files.map((target) => fs.readFileSync(target, 'utf8'));
let boardDirEscapeWrites = 0;
assert.throws(() => projectCard(
  boardDirEscapeProjection.cardPath,
  boardDirEscapeProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: boardDirEscapeProjection.state.cards.A1,
    state: boardDirEscapeProjection.state,
    cardsRoot: boardDirEscapeProjection.cardsRoot,
    writeText: () => { boardDirEscapeWrites += 1; },
  },
), /epic Epic A board directory escapes its physical root/,
'ES4-CANONICAL-EPIC-ROOT-SYMLINK-ESCAPE rejects a board-directory symlink outside the physical epic root');
eq(boardDirEscapeWrites, 0,
  'ES4-CANONICAL-EPIC-ROOT-SYMLINK-ESCAPE rejects a board-directory escape before every write');
eq(boardDirEscapeProjection.files.map((target) => fs.readFileSync(target, 'utf8')), boardDirEscapeBytes,
  'ES4-CANONICAL-EPIC-ROOT-SYMLINK-ESCAPE preserves every board-directory escape target byte');

const siblingMisbindProjection = makeEpicProjectionFixture('exact-card-sibling-misbind');
const siblingMisbindPath = path.join(path.dirname(siblingMisbindProjection.cardPath), 'A2.md');
const siblingMisbindFiles = [...siblingMisbindProjection.files, siblingMisbindPath];
const siblingMisbindBytes = siblingMisbindFiles.map((target) => fs.readFileSync(target, 'utf8'));
let siblingMisbindWrites = 0;
assert.throws(() => projectCard(
  siblingMisbindPath,
  siblingMisbindProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: { ...siblingMisbindProjection.state.cards.A1, card_path: siblingMisbindPath },
    state: siblingMisbindProjection.state,
    cardsRoot: siblingMisbindProjection.cardsRoot,
    writeText: () => { siblingMisbindWrites += 1; },
  },
), /canonical slice path A2\.md does not bind exact card A1/,
'ES4-EXACT-CARD-PATH-SIBLING-MISBIND rejects a valid sibling path for the exact card operand');
eq(siblingMisbindWrites, 0,
  'ES4-EXACT-CARD-PATH-SIBLING-MISBIND refuses before every projection write');
eq(siblingMisbindFiles.map((target) => fs.readFileSync(target, 'utf8')), siblingMisbindBytes,
  'ES4-EXACT-CARD-PATH-SIBLING-MISBIND preserves both sibling notes and all epic surfaces');

const siblingSymlinkProjection = makeEpicProjectionFixture('exact-card-sibling-symlink');
const siblingSymlinkPath = path.join(path.dirname(siblingSymlinkProjection.cardPath), 'A2.md');
fs.unlinkSync(siblingSymlinkProjection.cardPath);
fs.symlinkSync(siblingSymlinkPath, siblingSymlinkProjection.cardPath);
const siblingSymlinkFiles = [...siblingSymlinkProjection.files, siblingSymlinkPath];
const siblingSymlinkBytes = siblingSymlinkFiles.map((target) => fs.readFileSync(target, 'utf8'));
let siblingSymlinkWrites = 0;
assert.throws(() => projectCard(
  siblingSymlinkProjection.cardPath,
  siblingSymlinkProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: siblingSymlinkProjection.state.cards.A1,
    state: siblingSymlinkProjection.state,
    cardsRoot: siblingSymlinkProjection.cardsRoot,
    writeText: () => { siblingSymlinkWrites += 1; },
  },
), /canonical epic slice A1 must be one regular non-symlink file/,
'ES4-EXACT-CARD-PATH-SYMLINK-MISBIND rejects A1.md physically resolving to sibling A2.md');
eq(siblingSymlinkWrites, 0,
  'ES4-EXACT-CARD-PATH-SYMLINK-MISBIND rejects a sibling symlink before every projection write');
eq(siblingSymlinkFiles.map((target) => fs.readFileSync(target, 'utf8')), siblingSymlinkBytes,
  'ES4-EXACT-CARD-PATH-SYMLINK-MISBIND leaves both sibling aliases and all epic surfaces byte-stable');

const siblingHardlinkProjection = makeEpicProjectionFixture('exact-card-sibling-hardlink');
const siblingHardlinkPath = path.join(path.dirname(siblingHardlinkProjection.cardPath), 'A2.md');
fs.unlinkSync(siblingHardlinkProjection.cardPath);
fs.linkSync(siblingHardlinkPath, siblingHardlinkProjection.cardPath);
const siblingHardlinkFiles = [...siblingHardlinkProjection.files, siblingHardlinkPath];
const siblingHardlinkBytes = siblingHardlinkFiles.map((target) => fs.readFileSync(target, 'utf8'));
let siblingHardlinkWrites = 0;
assert.throws(() => projectCard(
  siblingHardlinkProjection.cardPath,
  siblingHardlinkProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: siblingHardlinkProjection.state.cards.A1,
    state: siblingHardlinkProjection.state,
    cardsRoot: siblingHardlinkProjection.cardsRoot,
    writeText: () => { siblingHardlinkWrites += 1; },
  },
), /epic slice A2 shares physical file identity with sibling A1/,
'ES4-EXACT-CARD-PATH-SYMLINK-MISBIND rejects hard-linked sibling slice identities');
eq(siblingHardlinkWrites, 0,
  'ES4-EXACT-CARD-PATH-SYMLINK-MISBIND rejects a sibling hard link before every projection write');
eq(siblingHardlinkFiles.map((target) => fs.readFileSync(target, 'utf8')), siblingHardlinkBytes,
  'ES4-EXACT-CARD-PATH-SYMLINK-MISBIND leaves hard-linked siblings and every epic surface byte-stable');

const containmentMatrix = [
  {
    name: 'symlink-write-root',
    pattern: /epic Epic A escapes its physical root/,
    setup: (fixture) => {
      const canonical = path.dirname(fixture.atlasPath);
      const escaped = path.join(fixture.root, 'matrix-outside', 'Epic A');
      fs.mkdirSync(path.dirname(escaped), { recursive: true });
      fs.renameSync(canonical, escaped);
      fs.symlinkSync(escaped, canonical, 'dir');
    },
  },
  {
    name: 'hardlink-sibling-alias',
    pattern: /shares physical file identity/,
    setup: (fixture) => {
      const sibling = path.join(path.dirname(fixture.cardPath), 'A2.md');
      fs.unlinkSync(fixture.cardPath);
      fs.linkSync(sibling, fixture.cardPath);
    },
  },
  {
    name: 'dot-dot-traversal',
    pattern: /escapes cards root/,
    setup: (fixture) => {
      fs.writeFileSync(
        fixture.cardPath,
        fs.readFileSync(fixture.cardPath, 'utf8').replace('epic: "[[Epic A]]"', 'epic: "[[../../outside]]"'),
      );
    },
  },
  {
    name: 'project-root-prefix-alias',
    pattern: /does not bind its canonical parent board/,
    setup: (fixture) => {
      for (const target of [
        fixture.atlasPath,
        fixture.cardPath,
        path.join(path.dirname(fixture.cardPath), 'A2.md'),
      ]) {
        fs.writeFileSync(
          target,
          fs.readFileSync(target, 'utf8').replaceAll('spice/projects/test/', 'bogus/projects/test/'),
        );
      }
    },
  },
  {
    name: 'physical-device-inode-collision',
    pattern: /shares physical file identity/,
    setup: (fixture) => {
      const originalStat = fs.statSync;
      const firstPath = fs.realpathSync(fixture.cardPath);
      const siblingPath = fs.realpathSync(path.join(path.dirname(fixture.cardPath), 'A2.md'));
      const firstIdentity = originalStat(firstPath);
      fs.statSync = (target, ...args) => {
        const stat = originalStat(target, ...args);
        return fs.realpathSync(target) === siblingPath
          ? { ...stat, dev: firstIdentity.dev, ino: firstIdentity.ino }
          : stat;
      };
      return () => { fs.statSync = originalStat; };
    },
  },
];

for (const matrixCase of containmentMatrix) {
  const fault = makeEpicProjectionFixture(`matrix-red-${matrixCase.name}`);
  const restore = matrixCase.setup(fault) || (() => {});
  const faultSurfaces = [...new Set([
    ...fault.files,
    path.join(path.dirname(fault.cardPath), 'A2.md'),
  ])];
  const before = faultSurfaces.map((target) => fs.readFileSync(target, 'utf8'));
  let writes = 0;
  try {
    assert.throws(() => projectCard(
      fault.cardPath,
      fault.parentBoardPath,
      'A1',
      'implementing',
      {
        record: fault.state.cards.A1,
        state: fault.state,
        cardsRoot: fault.cardsRoot,
        writeText: () => { writes += 1; },
      },
    ), matrixCase.pattern,
    `ES4-CONTAINMENT-MATRIX ${matrixCase.name} is red with the enumerated escape fault`);
  } finally {
    restore();
  }
  eq(writes, 0,
    `ES4-CONTAINMENT-MATRIX ${matrixCase.name} is refused before the first projection write`);
  eq(faultSurfaces.map((target) => fs.readFileSync(target, 'utf8')), before,
    `ES4-CONTAINMENT-MATRIX ${matrixCase.name} keeps every inside and outside surface byte-stable`);

  const valid = makeEpicProjectionFixture(`matrix-green-${matrixCase.name}`);
  let validWrites = 0;
  const validResult = projectCard(
    valid.cardPath,
    valid.parentBoardPath,
    'A1',
    'implementing',
    {
      record: valid.state.cards.A1,
      state: valid.state,
      cardsRoot: valid.cardsRoot,
      writeText: () => { validWrites += 1; },
    },
  );
  ok(validResult.changed && validWrites > 0,
    `ES4-CONTAINMENT-MATRIX ${matrixCase.name} is green with a canonical contained projection`);
}

const duplicateSiblingProjection = makeEpicProjectionFixture('duplicate-sibling');
fs.writeFileSync(
  duplicateSiblingProjection.epicBoardPath,
  fs.readFileSync(duplicateSiblingProjection.epicBoardPath, 'utf8')
    .replace('## In Progress\n', '## In Progress\n- [ ] [[A2]]\n'),
);
assert.throws(() => projectCard(
  duplicateSiblingProjection.cardPath,
  duplicateSiblingProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: duplicateSiblingProjection.state.cards.A1,
    state: duplicateSiblingProjection.state,
    cardsRoot: duplicateSiblingProjection.cardsRoot,
  },
), /duplicate board membership for A2/, 'ES4-CANONICAL-SLICE-FAILOPEN rejects duplicate sibling membership across epic lanes');

const diagnosticProjection = makeEpicProjectionFixture('diagnostic-refusal');
fs.writeFileSync(
  diagnosticProjection.epicBoardPath,
  moveBoardCard(fs.readFileSync(diagnosticProjection.epicBoardPath, 'utf8'), 'A1', 'In Progress'),
);
fs.writeFileSync(
  diagnosticProjection.cardPath,
  fs.readFileSync(diagnosticProjection.cardPath, 'utf8')
    .replace('kanban_column: In Planning', 'kanban_column: In Progress')
    .replace('status: planning', 'status: in_progress'),
);
const diagnosticSiblingPath = path.join(path.dirname(diagnosticProjection.cardPath), 'A2.md');
fs.writeFileSync(
  diagnosticSiblingPath,
  fs.readFileSync(diagnosticSiblingPath, 'utf8').replace('status: planning', 'status: completed'),
);
const diagnosticFinding = projectionBoardDrift(
  fs.readFileSync(diagnosticProjection.parentBoardPath, 'utf8'),
  diagnosticProjection.state.cards.A1,
  {
    boardPath: diagnosticProjection.parentBoardPath,
    cardsRoot: diagnosticProjection.cardsRoot,
    state: diagnosticProjection.state,
  },
);
ok(/legacy completion lacks successful deployment receipts/.test(diagnosticFinding.issue),
  'ES4-VALID-CANONICAL-UNTRACKED-COMPLETION-GRACEFUL-FINDING reports receiptless note completion without throwing');
eq(diagnosticFinding.card, 'A2',
  'ES4-VALID-CANONICAL-UNTRACKED-COMPLETION-GRACEFUL-FINDING binds the finding to the exact legacy slice');
eq(diagnosticFinding.reconcile, "reconcile --card 'A2'",
  'ES4-VALID-CANONICAL-UNTRACKED-COMPLETION-GRACEFUL-FINDING routes reconciliation to the exact legacy slice');
const diagnosticProjectionResult = projectCard(
  diagnosticProjection.cardPath,
  diagnosticProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: diagnosticProjection.state.cards.A1,
    state: diagnosticProjection.state,
    cardsRoot: diagnosticProjection.cardsRoot,
  },
);
eq(diagnosticProjectionResult.projection_findings.map((finding) => finding.card), ['A2'],
  'ES4-VALID-CANONICAL-UNTRACKED-COMPLETION-GRACEFUL-FINDING lets the rest of the epic project');
ok(!diagnosticProjection.state.cards.A2,
  'ES4-NO-SYNTHETIC-LEGACY-RECEIPT does not manufacture a tracked record or receipt for a legacy slice');
const diagnosticReconcile = await commandReconcile(
  { root: diagnosticProjection.root },
  { card: 'A2' },
  {
    readState: () => diagnosticProjection.state,
    writeState: () => {},
    withLock: async (_ctx, _name, fn) => fn(),
    boardPath: diagnosticProjection.parentBoardPath,
    cardsRoot: diagnosticProjection.cardsRoot,
    now: () => '2026-07-24T20:00:00.000Z',
  },
);
eq(diagnosticReconcile.action, 'reconciled',
  'ES4-LEGACY-EXACT-RECONCILE-ROUTE-UNEXECUTABLE makes the emitted untracked exact-card route executable');
eq(diagnosticReconcile.results[0].projection_findings.map((finding) => finding.card), ['A2'],
  'ES4-LEGACY-EXACT-RECONCILE-ROUTE-UNEXECUTABLE preserves the exact legacy finding in reconcile receipts');
eq(diagnosticReconcile.results[0].via_card, 'A1',
  'ES4-LEGACY-EXACT-RECONCILE-ROUTE-UNEXECUTABLE projects through the tracked canonical sibling without tracking the legacy card');
ok(!diagnosticProjection.state.cards.A2,
  'ES4-LEGACY-EXACT-RECONCILE-ROUTE-UNEXECUTABLE leaves the legacy card untracked after its exact route runs');
const diagnosticReconcileReplay = await commandReconcile(
  { root: diagnosticProjection.root },
  { card: 'A2' },
  {
    readState: () => diagnosticProjection.state,
    writeState: () => {},
    withLock: async (_ctx, _name, fn) => fn(),
    boardPath: diagnosticProjection.parentBoardPath,
    cardsRoot: diagnosticProjection.cardsRoot,
    now: () => '2026-07-24T20:00:00.000Z',
  },
);
ok(diagnosticReconcileReplay.no_op
  && diagnosticReconcileReplay.results[0].projection_findings[0].reconcile === "reconcile --card 'A2'",
  'ES4-LEGACY-EXACT-RECONCILE-ROUTE-UNEXECUTABLE exact replay is a byte-stable no-op with the same bounded finding');

const viaGateRace = makeEpicProjectionFixture('legacy-via-gate-race');
const viaGateRaceSibling = path.join(path.dirname(viaGateRace.cardPath), 'A2.md');
fs.writeFileSync(
  viaGateRaceSibling,
  fs.readFileSync(viaGateRaceSibling, 'utf8').replace('status: planning', 'status: completed'),
);
let viaGateRaceState = viaGateRace.state;
let viaGateTransitionSnapshot = null;
const viaGateLocks = [];
const viaGateNow = '2026-07-24T21:30:00.000Z';
const viaGateRaceResult = await commandReconcile(
  { root: viaGateRace.root },
  { card: 'A2' },
  {
    readState: () => viaGateRaceState,
    writeState: (_ctx, next) => { viaGateRaceState = next; },
    withLock: async (_ctx, name, fn) => {
      viaGateLocks.push(name);
      if (name === cardGateLockName('A1') && !viaGateTransitionSnapshot) {
        viaGateRaceState = JSON.parse(JSON.stringify(viaGateRaceState));
        Object.assign(viaGateRaceState.cards.A1, {
          phase: 'deployed',
          required_version: '0.257.0',
          vault_receipts: successfulVaultReceipts('0.257.0'),
          projection_reconciled_at: viaGateNow,
        });
        viaGateTransitionSnapshot = JSON.stringify(viaGateRaceState.cards.A1);
      }
      return fn();
    },
    boardPath: viaGateRace.parentBoardPath,
    cardsRoot: viaGateRace.cardsRoot,
    now: () => viaGateNow,
  },
);
eq(viaGateLocks, [
  legacyCardGateLockName('A2'), cardGateLockName('A2'),
  legacyCardGateLockName('A1'), cardGateLockName('A1'),
  'completion-projection',
], 'ES4-LEGACY-EXACT-RECONCILE-VIA-CARD-GATE-RACE serializes both legacy and tracked sibling identities before projection');
eq(JSON.stringify(viaGateRaceState.cards.A1), viaGateTransitionSnapshot,
  'ES4-LEGACY-EXACT-RECONCILE-VIA-CARD-GATE-RACE locked reread preserves the newer sibling phase and receipts byte-for-byte');
ok(viaGateRaceResult.results[0].projection_findings[0].card === 'A2',
  'ES4-LEGACY-EXACT-RECONCILE-VIA-CARD-GATE-RACE retains the exact legacy finding after the concurrent sibling transition');

const gateSlugCollision = makeEpicProjectionFixture('legacy-via-gate-slug-collision');
const collisionTrackedPath = path.join(path.dirname(gateSlugCollision.cardPath), 'Lock-Alias.md');
const collisionLegacyPath = path.join(path.dirname(gateSlugCollision.cardPath), 'Lock Alias.md');
fs.renameSync(gateSlugCollision.cardPath, collisionTrackedPath);
fs.renameSync(path.join(path.dirname(gateSlugCollision.cardPath), 'A2.md'), collisionLegacyPath);
fs.writeFileSync(
  gateSlugCollision.epicBoardPath,
  fs.readFileSync(gateSlugCollision.epicBoardPath, 'utf8')
    .replace('[[A1]]', '[[Lock-Alias]]')
    .replace('[[A2]]', '[[Lock Alias]]'),
);
fs.writeFileSync(
  collisionLegacyPath,
  fs.readFileSync(collisionLegacyPath, 'utf8').replace('status: planning', 'status: completed'),
);
gateSlugCollision.state.cards['Lock-Alias'] = {
  ...gateSlugCollision.state.cards.A1,
  card: 'Lock-Alias',
  card_path: collisionTrackedPath,
};
delete gateSlugCollision.state.cards.A1;
const collisionActiveLocks = new Set();
const collisionLockSequence = [];
const collisionDeps = {
  readState: () => gateSlugCollision.state,
  writeState: () => {},
  withLock: async (_ctx, name, fn) => {
    if (collisionActiveLocks.has(name)) throw new Error(`self-colliding lock ${name}`);
    collisionActiveLocks.add(name);
    collisionLockSequence.push(name);
    try {
      return await fn();
    } finally {
      collisionActiveLocks.delete(name);
    }
  },
  boardPath: gateSlugCollision.parentBoardPath,
  cardsRoot: gateSlugCollision.cardsRoot,
  now: () => '2026-07-24T21:45:00.000Z',
};
const collisionReconcile = await commandReconcile(
  { root: gateSlugCollision.root },
  { card: 'Lock Alias' },
  collisionDeps,
);
eq(collisionReconcile.action, 'reconciled',
  'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION assigns distinct gate identities to exact legacy and tracked sibling names');
eq(cardGateLockName('Lock Alias'), cardGateLockName('Lock Alias'),
  'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION gate identity is deterministic across independent calls');
const fixtureChildren = new Set();
const closedFixtureChildren = new Set();
const trackFixtureChild = (child) => {
  fixtureChildren.add(child);
  return child;
};
const spawnFixtureChild = (script) => {
  return trackFixtureChild(spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }));
};
const collectFixtureChild = (child, { label = 'fixture child', timeoutMs = 5000 } = {}) => new Promise((resolve, reject) => {
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let primaryError = null;
  let forceKillTimer = null;
  let terminalTimer = null;
  let settled = false;
  const clearLifecycleTimers = () => {
    clearTimeout(timer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    if (terminalTimer) clearTimeout(terminalTimer);
  };
  const settle = (error, value) => {
    if (settled) return;
    settled = true;
    clearLifecycleTimers();
    if (error) reject(error);
    else resolve(value);
  };
  const attemptKill = (signal) => {
    try {
      child.kill(signal);
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    attemptKill('SIGTERM');
    forceKillTimer = setTimeout(() => {
      attemptKill('SIGKILL');
      terminalTimer = setTimeout(() => {
        if (primaryError) {
          primaryError.close_barrier_observed = false;
          primaryError.lifecycle_terminal = true;
          settle(primaryError);
        } else {
          settle(new Error(`${label} failed closed without an exact-child close barrier after ${timeoutMs}ms`));
        }
      }, 250);
    }, 100);
  }, timeoutMs);
  if (child.stdout && typeof child.stdout.on === 'function') {
    child.stdout.on('data', (chunk) => { stdout += chunk; });
  }
  if (child.stderr && typeof child.stderr.on === 'function') {
    child.stderr.on('data', (chunk) => { stderr += chunk; });
  }
  child.on('error', (error) => {
    if (!primaryError) primaryError = error;
  });
  child.once('close', (code) => {
    closedFixtureChildren.add(child);
    if (primaryError) settle(primaryError);
    else if (timedOut) settle(new Error(`${label} timed out after ${timeoutMs}ms`));
    else if (code === 0) settle(null, stdout);
    else settle(new Error(`${label} exited ${code}: ${stderr}`));
  });
});
const runFixtureProcess = async (script, options = {}) => {
  const child = spawnFixtureChild(script);
  return collectFixtureChild(child, options);
};
const makeFixtureChild = ({ pid = 4242, kill, track = true } = {}) => {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = kill || (() => true);
  return track ? trackFixtureChild(child) : child;
};

const errorCloseOrder = [];
const errorBeforeCloseChild = makeFixtureChild({ pid: 61001 });
let errorBeforeCloseSettled = false;
const errorBeforeCloseResult = collectFixtureChild(errorBeforeCloseChild, {
  label: 'spawn error close barrier',
  timeoutMs: 1000,
}).catch((error) => {
  errorCloseOrder.push('settled');
  errorBeforeCloseSettled = true;
  return error;
});
const exactSpawnError = new Error('fixture-spawn-error');
errorBeforeCloseChild.emit('error', exactSpawnError);
await new Promise((resolve) => setImmediate(resolve));
ok(!errorBeforeCloseSettled,
  'ES4-CHILD-ERROR-BYPASSES-CLOSE-BARRIER ChildProcess error cannot settle before the exact child close event');
errorCloseOrder.push('close');
errorBeforeCloseChild.emit('close', -1);
const observedSpawnError = await errorBeforeCloseResult;
ok(observedSpawnError === exactSpawnError && errorCloseOrder.join('>') === 'close>settled'
    && closedFixtureChildren.has(errorBeforeCloseChild),
  'ES4-CHILD-ERROR-BYPASSES-CLOSE-BARRIER preserves the primary spawn error only after exact-child close');

const missingExecutable = path.join(tmp, 'es4-missing-child-executable');
const actualSpawnErrorChild = trackFixtureChild(spawn(missingExecutable, [], {
  stdio: ['ignore', 'pipe', 'pipe'],
}));
const actualSpawnErrorFinding = await collectFixtureChild(actualSpawnErrorChild, {
  label: 'actual spawn error close barrier',
  timeoutMs: 1000,
}).catch((error) => error);
ok(actualSpawnErrorFinding.code === 'ENOENT' && closedFixtureChildren.has(actualSpawnErrorChild),
  'ES4-CHILD-ERROR-BYPASSES-CLOSE-BARRIER real spawn ENOENT preserves its error through the later exact-child close');

const killFalseSignals = [];
let killFalseChild;
killFalseChild = makeFixtureChild({
  pid: 61002,
  kill: (signal) => {
    killFalseSignals.push(signal);
    if (signal === 'SIGKILL') setImmediate(() => killFalseChild.emit('close', null));
    return false;
  },
});
const killFalseFinding = await collectFixtureChild(killFalseChild, {
  label: 'kill false close barrier',
  timeoutMs: 20,
}).catch((error) => error);
ok(/timed out/.test(killFalseFinding.message)
    && killFalseSignals.join('>') === 'SIGTERM>SIGKILL'
    && closedFixtureChildren.has(killFalseChild),
  'ES4-CHILD-ERROR-BYPASSES-CLOSE-BARRIER kill returning false still escalates and awaits exact-child close');

const killThrowSignals = [];
let killThrowChild;
killThrowChild = makeFixtureChild({
  pid: 61003,
  kill: (signal) => {
    killThrowSignals.push(signal);
    if (signal === 'SIGKILL') setImmediate(() => killThrowChild.emit('close', null));
    throw new Error(`fixture-${signal}-throw`);
  },
});
const killThrowFinding = await collectFixtureChild(killThrowChild, {
  label: 'kill throw close barrier',
  timeoutMs: 20,
}).catch((error) => error);
ok(killThrowFinding.message === 'fixture-SIGTERM-throw'
    && killThrowSignals.join('>') === 'SIGTERM>SIGKILL'
    && closedFixtureChildren.has(killThrowChild),
  'ES4-CHILD-ERROR-BYPASSES-CLOSE-BARRIER kill exceptions preserve the first error while awaiting exact-child close');

const terminalNoCloseSignals = [];
const terminalNoClosePrimary = new Error('fixture-terminal-primary-error');
const terminalNoCloseChild = makeFixtureChild({
  pid: 61004,
  track: false,
  kill: (signal) => {
    terminalNoCloseSignals.push(signal);
    return false;
  },
});
const terminalNoCloseResult = collectFixtureChild(terminalNoCloseChild, {
  label: 'terminal no-close barrier',
  timeoutMs: 10,
}).catch((error) => error);
terminalNoCloseChild.emit('error', terminalNoClosePrimary);
const terminalNoCloseFinding = await terminalNoCloseResult;
const terminalSignalsAtSettlement = terminalNoCloseSignals.join('>');
await new Promise((resolve) => setTimeout(resolve, 300));
ok(terminalNoCloseFinding === terminalNoClosePrimary
    && terminalNoCloseFinding.lifecycle_terminal === true
    && terminalNoCloseFinding.close_barrier_observed === false
    && terminalSignalsAtSettlement === 'SIGTERM>SIGKILL'
    && terminalNoCloseSignals.join('>') === terminalSignalsAtSettlement
    && !closedFixtureChildren.has(terminalNoCloseChild),
  'ES4-TERMINAL-NO-CLOSE-PRIMARY-ERROR-PRECEDENCE returns the exact first error, reports no close authority, and clears every lifecycle timer');
const coordinatorModulePath = path.resolve(__dirname, '../../scripts/autoloop/codex-coordinator.js');
const crossProcessGateName = await runFixtureProcess([
  `const { cardGateLockName } = require(${JSON.stringify(coordinatorModulePath)});`,
  `process.stdout.write(cardGateLockName(${JSON.stringify('Lock Alias')}));`,
].join(' '), { label: 'exact gate identity probe', timeoutMs: 2000 });
eq(crossProcessGateName, cardGateLockName('Lock Alias'),
  'ES4-GATE-IDENTITY-CROSS-PROCESS-FIXTURE-MISSING proves exact gate identity is stable in a fresh child process');
ok(cardGateLockName('Lock Alias') !== cardGateLockName('Lock-Alias'),
  'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION binds the exact full card identity beyond its readable slug');
ok(/^[a-z0-9-]+$/.test(cardGateLockName('Lock Alias')) && cardGateLockName('x'.repeat(400)).length <= 143,
  'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION gate identities are filesystem-safe and bounded');
const coordinatorLockSource = fs.readFileSync(path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js'), 'utf8');
eq((coordinatorLockSource.match(/`gates-\$\{slugify\(/g) || []).length, 1,
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN keeps the shipping slug spelling in one compatibility helper only');
eq(collisionReconcile.results[0].via_card, 'Lock-Alias',
  'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION preserves legacy-to-via routing through the exact tracked sibling');
ok(collisionReconcile.results[0].projection_findings[0].card === 'Lock Alias',
  'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION preserves the exact bounded legacy finding');
eq(collisionLockSequence.slice(0, 4), [
  legacyCardGateLockName('Lock Alias'),
  cardGateLockName('Lock Alias'),
  cardGateLockName('Lock-Alias'),
  'completion-projection',
], 'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION retains one shared compatibility gate plus two exact gates without a slug self-collision');
const collisionReplay = await commandReconcile(
  { root: gateSlugCollision.root },
  { card: 'Lock Alias' },
  collisionDeps,
);
ok(collisionReplay.no_op && collisionReplay.results[0].projection_findings[0].card === 'Lock Alias',
  'ES4-LEGACY-EXACT-RECONCILE-VIA-GATE-SLUG-COLLISION exact replay is a byte-stable no-op');

const lockNamespaceMigration = makeEpicProjectionFixture('gate-lock-namespace-migration');
const migrationLegacyLock = legacyCardGateLockName('A1');
const frozenShippingLegacyLock = 'gates-a1';
eq(migrationLegacyLock, frozenShippingLegacyLock,
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN matches the frozen shipping lock spelling without deriving the expected value from production code');
const migrationActiveLocks = new Set([migrationLegacyLock]);
const migrationLockSequence = [];
let migrationOldProcessBlocked = false;
const migrationWithLock = async (ctx, name, fn) => {
  migrationLockSequence.push(name);
  if (migrationActiveLocks.has(name)) throw new Error(`lock ${name} held by shipping coordinator`);
  migrationActiveLocks.add(name);
  try {
    if (name === cardGateLockName('A1')) {
      try {
        await migrationWithLock(ctx, migrationLegacyLock, async () => {
          throw new Error('old coordinator entered while new coordinator held compatibility authority');
        });
      } catch (error) {
        migrationOldProcessBlocked = /held by shipping coordinator/.test(error.message);
      }
    }
    return await fn();
  } finally {
    migrationActiveLocks.delete(name);
  }
};
const migrationDeps = {
  readState: () => lockNamespaceMigration.state,
  writeState: () => {},
  withLock: migrationWithLock,
  boardPath: lockNamespaceMigration.parentBoardPath,
  cardsRoot: lockNamespaceMigration.cardsRoot,
  now: () => '2026-07-24T22:15:00.000Z',
};
const migrationBlocked = await commandReconcile(
  { root: lockNamespaceMigration.root },
  { card: 'A1' },
  migrationDeps,
);
eq(migrationBlocked.action, 'reconcile-failed',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN blocks a new exact-identity operation while a shipping slug-only coordinator holds legacy authority');
ok(!migrationLockSequence.includes(cardGateLockName('A1')),
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN refuses before the new exact-identity authoritative section');
migrationActiveLocks.delete(migrationLegacyLock);
migrationLockSequence.length = 0;
const migrationReleased = await commandReconcile(
  { root: lockNamespaceMigration.root },
  { card: 'A1' },
  migrationDeps,
);
eq(migrationReleased.action, 'reconciled',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN proceeds after the shipping legacy lock releases');
eq(migrationLockSequence.slice(0, 4), [
  migrationLegacyLock, cardGateLockName('A1'), migrationLegacyLock, 'completion-projection',
], 'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN holds legacy compatibility before exact identity, refuses the simulated old acquisition, then reaches completion projection');
ok(migrationOldProcessBlocked,
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN blocks an old slug-only acquisition throughout the new exact-identity section');
const migrationReplay = await commandReconcile(
  { root: lockNamespaceMigration.root },
  { card: 'A1' },
  migrationDeps,
);
ok(migrationReplay.no_op,
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN preserves exact-card no-op replay after the compatibility lock releases');

const crossProcessMigrationStateDir = path.join(tmp, 'es4-gate-migration-cross-process');
const crossProcessMigrationCtx = {
  root: tmp,
  stateDir: crossProcessMigrationStateDir,
  statePath: path.join(crossProcessMigrationStateDir, 'state.json'),
};
const crossProcessLegacyPath = path.join(crossProcessMigrationStateDir, 'locks', `${migrationLegacyLock}.lock`);
fs.mkdirSync(crossProcessLegacyPath, { recursive: true });
fs.writeFileSync(path.join(crossProcessLegacyPath, 'owner.json'), JSON.stringify({
  pid: process.pid, host: os.hostname(), started_at: new Date().toISOString(),
}));
const migrationChildScript = [
  `const { withCardGateLock } = require(${JSON.stringify(coordinatorModulePath)});`,
  `const ctx = ${JSON.stringify(crossProcessMigrationCtx)};`,
  `withCardGateLock(ctx, 'A1', async () => 'entered')`,
  `.then((value) => process.stdout.write(value))`,
  `.catch((error) => process.stdout.write(error.code || error.message));`,
].join(' ');
eq(await runFixtureProcess(migrationChildScript, {
  label: 'legacy-held migration probe',
  timeoutMs: 2000,
}), 'LOCKED',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN blocks a fresh process on a live shipping legacy lock directory');
fs.rmSync(crossProcessLegacyPath, { recursive: true, force: true });
eq(await runFixtureProcess(migrationChildScript, {
  label: 'legacy-released migration probe',
  timeoutMs: 2000,
}), 'entered',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN lets the same fresh process enter after the live legacy lock releases');

const installedShippingCoordinatorPath = '/opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js';
const shippingCoordinatorFixturePath = fs.existsSync(installedShippingCoordinatorPath)
  ? installedShippingCoordinatorPath
  : path.join(tmp, 'frozen-shipping-codex-coordinator.js');
if (!fs.existsSync(shippingCoordinatorFixturePath)) {
  fs.writeFileSync(shippingCoordinatorFixturePath, [
    "'use strict';",
    "const fs = require('fs');",
    "const os = require('os');",
    "const path = require('path');",
    "function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72); }",
    "async function withLock(ctx, name, fn) {",
    "  const lockPath = path.join(ctx.stateDir, 'locks', `${name}.lock`);",
    "  fs.mkdirSync(path.dirname(lockPath), { recursive: true });",
    "  try { fs.mkdirSync(lockPath); } catch (error) {",
    "    if (error.code !== 'EEXIST') throw error;",
    "    const held = new Error(`lock ${name} held`); held.code = 'LOCKED'; throw held;",
    "  }",
    "  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), started_at: new Date().toISOString() }));",
    "  try { return await fn(); } finally { fs.rmSync(lockPath, { recursive: true, force: true }); }",
    "}",
    "async function withShippingCardGateLock(ctx, card, fn) { return withLock(ctx, `gates-${slugify(card)}`, fn, { card }); }",
    "module.exports = {};",
  ].join('\n'));
}
const shippingCoordinatorSource = fs.readFileSync(shippingCoordinatorFixturePath, 'utf8');
ok(shippingCoordinatorSource.includes('`gates-${slugify(card)}`'),
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN binds the installed shipping artifact direct slug-only namespace when Homebrew is present');
const shippingModuleLoaderLines = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const Module = require('module');",
  `const shippingPath = ${JSON.stringify(shippingCoordinatorFixturePath)};`,
  "const shippingSource = fs.readFileSync(shippingPath, 'utf8');",
  "const shippingModule = new Module(shippingPath);",
  "shippingModule.filename = shippingPath;",
  "shippingModule.paths = Module._nodeModulePaths(path.dirname(shippingPath));",
  "shippingModule._compile(shippingSource + '\\nmodule.exports.__fixtureWithLock = withLock; module.exports.__fixtureSlugify = slugify;', shippingPath);",
  "const shippingWithLock = shippingModule.exports.__fixtureWithLock;",
  "const shippingSlugify = shippingModule.exports.__fixtureSlugify;",
  "const shippingWithCardGateLock = (ctx, card, fn) => shippingWithLock(ctx, 'gates-' + shippingSlugify(card), fn, { card });",
];
const waitForFixturePath = async (targetPath, childResult, timeoutMs = 5000, lifecycle = {}) => {
  let cancelled = false;
  let pendingTimer = null;
  let wakePendingTimer = null;
  lifecycle.poll_count = 0;
  lifecycle.timer_count = 0;
  lifecycle.cancelled = false;
  lifecycle.joined = false;
  lifecycle.settled = false;
  lifecycle.pending_timer = false;
  const waitForNextPoll = () => new Promise((resolve) => {
    const wake = () => {
      if (wakePendingTimer !== wake) return;
      pendingTimer = null;
      wakePendingTimer = null;
      lifecycle.pending_timer = false;
      resolve();
    };
    wakePendingTimer = wake;
    pendingTimer = setTimeout(wake, 10);
    lifecycle.timer_count += 1;
    lifecycle.pending_timer = true;
  });
  const cancelReadiness = () => {
    cancelled = true;
    lifecycle.cancelled = true;
    if (pendingTimer) clearTimeout(pendingTimer);
    const wake = wakePendingTimer;
    if (wake) wake();
    else {
      pendingTimer = null;
      lifecycle.pending_timer = false;
    }
  };
  const readiness = (async () => {
    try {
      const deadline = Date.now() + timeoutMs;
      while (!fs.existsSync(targetPath)) {
        if (cancelled) return 'cancelled';
        if (Date.now() >= deadline) throw new Error(`fixture readiness timed out after ${timeoutMs}ms`);
        lifecycle.poll_count += 1;
        await waitForNextPoll();
      }
      return 'ready';
    } finally {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
      wakePendingTimer = null;
      lifecycle.pending_timer = false;
      lifecycle.settled = true;
    }
  })();
  const winner = await Promise.race([
    readiness.then(() => ({ source: 'readiness' })),
    childResult.then(
      () => ({ source: 'holder', error: new Error('fixture holder exited before readiness') }),
      (error) => ({ source: 'holder', error }),
    ),
  ]);
  if (winner.source === 'holder') {
    cancelReadiness();
    await readiness;
    lifecycle.joined = true;
    throw winner.error;
  }
};

const readinessRaceDir = path.join(tmp, 'es4-readiness-early-exit');
fs.mkdirSync(readinessRaceDir, { recursive: true });
const readinessRaceMissing = path.join(readinessRaceDir, 'missing');
const observeReadinessTimerCallbacks = async (operation, settleMs = 25) => {
  const scope = new AsyncLocalStorage();
  const marker = {};
  const scopedTimerIds = new Set();
  let operationSettled = false;
  let scheduledTimerCount = 0;
  let callbacksAfterSettle = 0;
  const hook = createHook({
    init: (asyncId, type) => {
      if (type !== 'Timeout' || scope.getStore() !== marker) return;
      scopedTimerIds.add(asyncId);
      scheduledTimerCount += 1;
    },
    before: (asyncId) => {
      if (operationSettled && scopedTimerIds.has(asyncId)) callbacksAfterSettle += 1;
    },
    destroy: (asyncId) => {
      scopedTimerIds.delete(asyncId);
    },
  });
  hook.enable();
  let value;
  let error = null;
  try {
    try {
      value = await scope.run(marker, operation);
    } catch (caught) {
      error = caught;
    }
    operationSettled = true;
    await scope.exit(() => new Promise((resolve) => setTimeout(resolve, settleMs)));
    return { value, error, scheduledTimerCount, callbacksAfterSettle };
  } finally {
    hook.disable();
    scope.disable();
  }
};
const readinessUnhandled = [];
const recordReadinessUnhandled = (reason) => readinessUnhandled.push(reason);
process.on('unhandledRejection', recordReadinessUnhandled);
try {
  const cleanExitLifecycle = {};
  const cleanExitObservation = await observeReadinessTimerCallbacks(
    () => waitForFixturePath(readinessRaceMissing, Promise.resolve('clean exit'), 1000, cleanExitLifecycle),
  );
  const cleanExitFinding = cleanExitObservation.error?.message || '';
  const cleanExitPolls = cleanExitLifecycle.poll_count;
  ok(/holder exited before readiness/.test(cleanExitFinding)
      && cleanExitLifecycle.cancelled
      && cleanExitLifecycle.joined
      && cleanExitLifecycle.settled
      && !cleanExitLifecycle.pending_timer
      && cleanExitLifecycle.poll_count === cleanExitPolls,
  'ES4-READINESS-EARLY-EXIT-LOSER-PROMISE-LEAK clean holder exit cancels and joins readiness with no surviving poll timer');

  const earlyError = new Error('fixture holder early error');
  const errorExitLifecycle = {};
  const errorExitObservation = await observeReadinessTimerCallbacks(
    () => waitForFixturePath(readinessRaceMissing, Promise.reject(earlyError), 1000, errorExitLifecycle),
  );
  const errorExitFinding = errorExitObservation.error;
  eq(errorExitFinding, earlyError,
    'ES4-READINESS-EARLY-EXIT-LOSER-PROMISE-LEAK early holder error remains the exact primary error');
  ok(errorExitLifecycle.cancelled
      && errorExitLifecycle.joined
      && errorExitLifecycle.settled
      && !errorExitLifecycle.pending_timer,
  'ES4-READINESS-EARLY-EXIT-LOSER-PROMISE-LEAK early holder error leaves the readiness loser fully settled');

  const successPath = path.join(readinessRaceDir, 'ready');
  fs.writeFileSync(successPath, 'ready');
  let resolveSuccessHolder;
  const successHolder = new Promise((resolve) => { resolveSuccessHolder = resolve; });
  const successLifecycle = {};
  await waitForFixturePath(successPath, successHolder, 1000, successLifecycle);
  resolveSuccessHolder('released');
  await successHolder;
  ok(successLifecycle.settled
      && !successLifecycle.cancelled
      && !successLifecycle.pending_timer,
  'ES4-READINESS-EARLY-EXIT-LOSER-PROMISE-LEAK successful readiness settles without manufacturing cancellation or a timer');

  let resolveTimeoutHolder;
  const timeoutHolder = new Promise((resolve) => { resolveTimeoutHolder = resolve; });
  const timeoutLifecycle = {};
  let timeoutFinding = '';
  try {
    await waitForFixturePath(readinessRaceMissing, timeoutHolder, 20, timeoutLifecycle);
  } catch (error) {
    timeoutFinding = error.message;
  }
  resolveTimeoutHolder('released');
  await timeoutHolder;
  ok(/readiness timed out/.test(timeoutFinding)
      && timeoutLifecycle.settled
      && !timeoutLifecycle.pending_timer,
  'ES4-READINESS-EARLY-EXIT-LOSER-PROMISE-LEAK readiness timeout settles its own final timer before propagation');

  const finalTickPath = path.join(readinessRaceDir, 'final-tick');
  let resolveFinalTickHolder;
  const finalTickHolder = new Promise((resolve) => { resolveFinalTickHolder = resolve; });
  const finalTickLifecycle = {};
  const finalTick = setTimeout(() => {
    fs.writeFileSync(finalTickPath, 'ready');
    resolveFinalTickHolder('exited');
  }, 10);
  const finalTickObservation = await observeReadinessTimerCallbacks(
    () => waitForFixturePath(finalTickPath, finalTickHolder, 1000, finalTickLifecycle),
  );
  const finalTickFinding = finalTickObservation.error?.message || '';
  clearTimeout(finalTick);
  await finalTickHolder;
  ok((!finalTickFinding || /holder exited before readiness/.test(finalTickFinding))
      && finalTickLifecycle.settled
      && !finalTickLifecycle.pending_timer
      && (!finalTickLifecycle.cancelled || finalTickLifecycle.joined),
  'ES4-READINESS-EARLY-EXIT-LOSER-PROMISE-LEAK final-tick race reports a valid winner and leaves no readiness timer');
  ok(cleanExitObservation.scheduledTimerCount > 0
      && errorExitObservation.scheduledTimerCount > 0
      && finalTickObservation.scheduledTimerCount > 0
      && cleanExitObservation.callbacksAfterSettle === 0
      && errorExitObservation.callbacksAfterSettle === 0
      && finalTickObservation.callbacksAfterSettle === 0,
  'ES4-READINESS-PENDING-TIMER-CALLBACK-ORACLE-MISSING async_hooks independently observes zero real readiness callbacks after clean, error, and final-tick cleanup');
  await new Promise((resolve) => setImmediate(resolve));
  eq(readinessUnhandled.length, 0,
    'ES4-READINESS-EARLY-EXIT-LOSER-PROMISE-LEAK clean, error, success, timeout, and final-tick paths emit zero unhandled rejections');
} finally {
  process.off('unhandledRejection', recordReadinessUnhandled);
}
const withFixtureHolder = async ({
  holderScript, readyPath, releasePath, probe, readinessMs = 5000, holderMs = 5000, label,
}) => {
  const holder = spawnFixtureChild(holderScript);
  const holderResult = collectFixtureChild(holder, { label: `${label} holder`, timeoutMs: holderMs });
  let result;
  let primaryError = null;
  let holderOutput = '';
  try {
    await waitForFixturePath(readyPath, holderResult, readinessMs);
    result = await probe();
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      fs.mkdirSync(path.dirname(releasePath), { recursive: true });
      fs.writeFileSync(releasePath, 'release');
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
    try {
      holderOutput = await holderResult;
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
    for (const artifactPath of [readyPath, releasePath]) {
      try {
        fs.rmSync(artifactPath, { force: true });
      } catch (error) {
        if (!primaryError) primaryError = error;
      }
    }
  }
  if (primaryError) throw primaryError;
  return { result, holderOutput, pid: holder.pid };
};
const newCoordinatorHolderScript = (ctx, readyPath, releasePath, writeReady = true) => [
  "const fs = require('fs');",
  `const { withCardGateLock } = require(${JSON.stringify(coordinatorModulePath)});`,
  `const ctx = ${JSON.stringify(ctx)};`,
  `withCardGateLock(ctx, 'A1', async () => {`,
  ...(writeReady ? [`  fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');`] : []),
  `  while (!fs.existsSync(${JSON.stringify(releasePath)})) await new Promise((resolve) => setTimeout(resolve, 10));`,
  "  return 'released';",
  "}).then((value) => process.stdout.write(value)).catch((error) => { process.stderr.write(error.stack || error.message); process.exitCode = 1; });",
].join('\n');

const artifactIsolationDir = path.join(tmp, 'es4-readiness-artifact-isolation');
const artifactIsolationReady = path.join(artifactIsolationDir, 'ready');
const artifactIsolationRelease = path.join(artifactIsolationDir, 'release');
fs.mkdirSync(artifactIsolationDir, { recursive: true });
const artifactIsolationCtx = {
  root: tmp,
  stateDir: path.join(artifactIsolationDir, 'state'),
  statePath: path.join(artifactIsolationDir, 'state', 'state.json'),
};
for (const reuseAttempt of ['first', 'second']) {
  const artifactIsolationResult = await withFixtureHolder({
    holderScript: newCoordinatorHolderScript(
      artifactIsolationCtx,
      artifactIsolationReady,
      artifactIsolationRelease,
    ),
    readyPath: artifactIsolationReady,
    releasePath: artifactIsolationRelease,
    label: `artifact isolation ${reuseAttempt}`,
    probe: async () => reuseAttempt,
  });
  ok(artifactIsolationResult.result === reuseAttempt
      && artifactIsolationResult.holderOutput === 'released'
      && !fs.existsSync(artifactIsolationReady)
      && !fs.existsSync(artifactIsolationRelease),
  `ES4-READINESS-READY-RELEASE-ARTIFACT-LEAK ${reuseAttempt} success removes both lifecycle artifacts before directory reuse`);
}
let artifactIsolationFinding = '';
try {
  await withFixtureHolder({
    holderScript: newCoordinatorHolderScript(
      artifactIsolationCtx,
      artifactIsolationReady,
      artifactIsolationRelease,
    ),
    readyPath: artifactIsolationReady,
    releasePath: artifactIsolationRelease,
    label: 'artifact isolation failure',
    probe: async () => { throw new Error('artifact isolation probe failure'); },
  });
} catch (error) {
  artifactIsolationFinding = error.message;
}
ok(/artifact isolation probe failure/.test(artifactIsolationFinding)
    && !fs.existsSync(artifactIsolationReady)
    && !fs.existsSync(artifactIsolationRelease),
'ES4-READINESS-READY-RELEASE-ARTIFACT-LEAK failure preserves the primary error and removes both lifecycle artifacts');

const liveOldHeldDir = path.join(tmp, 'es4-gate-live-old-held');
const liveOldReady = path.join(liveOldHeldDir, 'old-ready');
const liveOldRelease = path.join(liveOldHeldDir, 'old-release');
fs.mkdirSync(liveOldHeldDir, { recursive: true });
const liveOldCtx = {
  root: tmp,
  stateDir: path.join(liveOldHeldDir, 'state'),
  statePath: path.join(liveOldHeldDir, 'state', 'state.json'),
};
const liveOldResult = await withFixtureHolder({
  holderScript: [
  ...shippingModuleLoaderLines,
  `const ctx = ${JSON.stringify(liveOldCtx)};`,
  `shippingWithCardGateLock(ctx, 'A1', async () => {`,
  `  fs.writeFileSync(${JSON.stringify(liveOldReady)}, 'ready');`,
  `  while (!fs.existsSync(${JSON.stringify(liveOldRelease)})) await new Promise((resolve) => setTimeout(resolve, 10));`,
  "  return 'released';",
  "}).then((value) => process.stdout.write(value)).catch((error) => { process.stderr.write(error.stack || error.message); process.exitCode = 1; });",
  ].join('\n'),
  readyPath: liveOldReady,
  releasePath: liveOldRelease,
  label: 'live shipping-old',
  probe: async () => {
    try {
      await withCardGateLock(liveOldCtx, 'A1', async () => 'incorrectly-entered');
      return 'incorrectly-entered';
    } catch (error) {
      return error.code || error.message;
    }
  },
});
eq(liveOldResult.result, 'LOCKED',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN blocks the new coordinator behind a live installed shipping process');
eq(liveOldResult.holderOutput, 'released',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN releases the live shipping process cleanly after the new-side exclusion proof');

const liveNewHeldDir = path.join(tmp, 'es4-gate-live-new-held');
const liveNewReady = path.join(liveNewHeldDir, 'new-ready');
const liveNewRelease = path.join(liveNewHeldDir, 'new-release');
fs.mkdirSync(liveNewHeldDir, { recursive: true });
const liveNewCtx = {
  root: tmp,
  stateDir: path.join(liveNewHeldDir, 'state'),
  statePath: path.join(liveNewHeldDir, 'state', 'state.json'),
};
const liveNewResult = await withFixtureHolder({
  holderScript: newCoordinatorHolderScript(liveNewCtx, liveNewReady, liveNewRelease),
  readyPath: liveNewReady,
  releasePath: liveNewRelease,
  label: 'live new',
  probe: () => runFixtureProcess([
    ...shippingModuleLoaderLines,
    `const ctx = ${JSON.stringify(liveNewCtx)};`,
    "shippingWithCardGateLock(ctx, 'A1', async () => 'incorrectly-entered')",
    ".then((value) => process.stdout.write(value))",
    ".catch((error) => process.stdout.write(error.code || error.message));",
  ].join('\n'), { label: 'live shipping probe', timeoutMs: 2000 }),
});
eq(liveNewResult.result, 'LOCKED',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN blocks a fresh installed shipping process behind the live new coordinator');
eq(liveNewResult.holderOutput, 'released',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN releases the live new process cleanly after the old-side exclusion proof');

const shippingFaultScript = (faultSource) => [
  "const fs = require('fs');",
  "const path = require('path');",
  "const Module = require('module');",
  `const shippingPath = ${JSON.stringify(shippingCoordinatorFixturePath)};`,
  "const shippingSource = fs.readFileSync(shippingPath, 'utf8');",
  "const shippingModule = new Module(shippingPath);",
  "shippingModule.filename = shippingPath;",
  "shippingModule.paths = Module._nodeModulePaths(path.dirname(shippingPath));",
  `shippingModule._compile(shippingSource + ${JSON.stringify(`\n${faultSource}`)}, shippingPath);`,
].join('\n');
const lifecycleFaults = [
  {
    name: 'compilation',
    script: shippingFaultScript('this is not valid JavaScript {'),
    pattern: /SyntaxError/,
  },
  {
    name: 'resolution',
    script: shippingFaultScript("require('./es4-live-migration-definitely-missing');"),
    pattern: /Cannot find module/,
  },
  {
    name: 'execution',
    script: shippingFaultScript("throw new Error('probe-execution-failure');"),
    pattern: /probe-execution-failure/,
  },
  {
    name: 'timeout',
    script: shippingFaultScript('setInterval(() => {}, 1000);'),
    pattern: /timed out/,
    timeoutMs: 50,
  },
];
for (const fault of lifecycleFaults) {
  const faultDir = path.join(tmp, `es4-live-migration-${fault.name}`);
  const faultReady = path.join(faultDir, 'ready');
  const faultRelease = path.join(faultDir, 'release');
  const faultCtx = {
    root: tmp,
    stateDir: path.join(faultDir, 'state'),
    statePath: path.join(faultDir, 'state', 'state.json'),
  };
  let finding = '';
  try {
    await withFixtureHolder({
      holderScript: newCoordinatorHolderScript(faultCtx, faultReady, faultRelease),
      readyPath: faultReady,
      releasePath: faultRelease,
      label: `${fault.name} failure`,
      probe: () => runFixtureProcess(fault.script, {
        label: `${fault.name} probe`,
        timeoutMs: fault.timeoutMs || 1000,
      }),
    });
  } catch (error) {
    finding = error.message;
  }
  ok(fault.pattern.test(finding)
      && !fs.existsSync(path.join(faultCtx.stateDir, 'locks', `${frozenShippingLegacyLock}.lock`))
      && !fs.existsSync(path.join(faultCtx.stateDir, 'locks', `${cardGateLockName('A1')}.lock`)),
  `ES4-LIVE-MIGRATION-FIXTURE-CHILD-LEAK ${fault.name} failure releases its peer, reaps children, and removes both lock namespaces`);
}

const readinessFaultDir = path.join(tmp, 'es4-live-migration-readiness');
const readinessFaultReady = path.join(readinessFaultDir, 'never-ready');
const readinessFaultRelease = path.join(readinessFaultDir, 'release');
const readinessFaultCtx = {
  root: tmp,
  stateDir: path.join(readinessFaultDir, 'state'),
  statePath: path.join(readinessFaultDir, 'state', 'state.json'),
};
let readinessFinding = '';
try {
  await withFixtureHolder({
    holderScript: newCoordinatorHolderScript(readinessFaultCtx, readinessFaultReady, readinessFaultRelease, false),
    readyPath: readinessFaultReady,
    releasePath: readinessFaultRelease,
    readinessMs: 50,
    label: 'readiness failure',
    probe: async () => 'unreachable',
  });
} catch (error) {
  readinessFinding = error.message;
}
ok(/readiness timed out/.test(readinessFinding)
    && !fs.existsSync(path.join(readinessFaultCtx.stateDir, 'locks', `${frozenShippingLegacyLock}.lock`))
    && !fs.existsSync(path.join(readinessFaultCtx.stateDir, 'locks', `${cardGateLockName('A1')}.lock`)),
'ES4-LIVE-MIGRATION-FIXTURE-CHILD-LEAK readiness timeout releases and reaps the holder before continuing');

const assertionFaultDir = path.join(tmp, 'es4-live-migration-assertion');
const assertionFaultReady = path.join(assertionFaultDir, 'ready');
const assertionFaultRelease = path.join(assertionFaultDir, 'release');
const assertionFaultCtx = {
  root: tmp,
  stateDir: path.join(assertionFaultDir, 'state'),
  statePath: path.join(assertionFaultDir, 'state', 'state.json'),
};
let assertionFinding = '';
try {
  await withFixtureHolder({
    holderScript: newCoordinatorHolderScript(assertionFaultCtx, assertionFaultReady, assertionFaultRelease),
    readyPath: assertionFaultReady,
    releasePath: assertionFaultRelease,
    label: 'assertion failure',
    probe: async () => { throw new Error('probe-assertion-failure'); },
  });
} catch (error) {
  assertionFinding = error.message;
}
ok(/probe-assertion-failure/.test(assertionFinding)
    && !fs.existsSync(path.join(assertionFaultCtx.stateDir, 'locks', `${frozenShippingLegacyLock}.lock`))
    && !fs.existsSync(path.join(assertionFaultCtx.stateDir, 'locks', `${cardGateLockName('A1')}.lock`)),
'ES4-LIVE-MIGRATION-FIXTURE-CHILD-LEAK assertion failure releases and reaps the holder before propagating');

const reusedPidOriginal = makeFixtureChild({ pid: 62000 });
const reusedPidOriginalResult = collectFixtureChild(reusedPidOriginal, {
  label: 'reused PID original',
  timeoutMs: 1000,
});
reusedPidOriginal.emit('close', 0);
await reusedPidOriginalResult;
const reusedPidReplacement = makeFixtureChild({ pid: 62000 });
const reusedPidReplacementResult = collectFixtureChild(reusedPidReplacement, {
  label: 'reused PID replacement',
  timeoutMs: 1000,
});
ok(closedFixtureChildren.has(reusedPidOriginal) && !closedFixtureChildren.has(reusedPidReplacement),
  'ES4-PID-REUSE-LIVENESS-ORACLE close authority binds the exact child object even when another child reuses its numeric PID');
reusedPidReplacement.emit('close', 0);
await reusedPidReplacementResult;

const originalProcessKill = process.kill;
let forbiddenPidProbeCalls = 0;
process.kill = () => {
  forbiddenPidProbeCalls += 1;
  const error = new Error('fixture EPERM ambiguity');
  error.code = 'EPERM';
  throw error;
};
try {
  ok([...fixtureChildren].every((child) => closedFixtureChildren.has(child)),
    'ES4-PID-REUSE-LIVENESS-ORACLE every holder and probe is reaped by the close event of its exact captured child object');
  eq(forbiddenPidProbeCalls, 0,
    'ES4-PID-REUSE-LIVENESS-ORACLE EPERM and PID-reuse observations cannot participate in the reaping verdict');
} finally {
  process.kill = originalProcessKill;
}
const lifecycleHarnessSource = fs.readFileSync(__filename, 'utf8');
ok(!/process\.kill\(pid,\s*0\)/.test(lifecycleHarnessSource),
  'ES4-PID-REUSE-LIVENESS-ORACLE removes the numeric PID liveness inference from the migration harness');

const exceptionReleaseDir = path.join(tmp, 'es4-gate-exception-release');
const exceptionReleaseCtx = {
  root: tmp,
  stateDir: exceptionReleaseDir,
  statePath: path.join(exceptionReleaseDir, 'state.json'),
};
let exceptionReleaseFinding = '';
try {
  await withCardGateLock(exceptionReleaseCtx, 'A1', async () => {
    throw new Error('fixture-authoritative-section-failed');
  });
} catch (error) {
  exceptionReleaseFinding = error.message;
}
eq(exceptionReleaseFinding, 'fixture-authoritative-section-failed',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN propagates an authoritative-section failure through production locks');
ok(!fs.existsSync(path.join(exceptionReleaseDir, 'locks', `${frozenShippingLegacyLock}.lock`))
    && !fs.existsSync(path.join(exceptionReleaseDir, 'locks', `${cardGateLockName('A1')}.lock`)),
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN releases both production legacy and exact directories after an exception');
eq(await withCardGateLock(exceptionReleaseCtx, 'A1', async () => 'reacquired'), 'reacquired',
  'ES4-GATE-LOCK-NAMESPACE-MIGRATION-SPLIT-BRAIN reacquires both production lock namespaces after exception cleanup');

const containedStatus = commandStatus(
  { root: diagnosticProjection.root },
  {
    state: diagnosticProjection.state,
    boardMd: fs.readFileSync(diagnosticProjection.parentBoardPath, 'utf8'),
    boardPath: diagnosticProjection.parentBoardPath,
    cardsRoot: diagnosticProjection.cardsRoot,
    loadCard: () => null,
  },
);
ok(containedStatus.board_drift.some((finding) => finding.card === 'A2'
  && /legacy completion lacks successful deployment receipts/.test(finding.issue)),
  'ES4-VALID-CANONICAL-UNTRACKED-COMPLETION-GRACEFUL-FINDING keeps coordinator status available with the bounded finding');

eq(projectionBoardDrift(
  fs.readFileSync(epicProjection.parentBoardPath, 'utf8'),
  epicProjection.state.cards.A1,
  {
    boardPath: epicProjection.parentBoardPath,
    cardsRoot: epicProjection.cardsRoot,
    state: epicProjection.state,
  },
), null, 'ES4-DUAL-INVARIANT accepts a converged slice, epic board, atlas, and parent board');
fs.writeFileSync(
  epicProjection.parentBoardPath,
  moveBoardCard(fs.readFileSync(epicProjection.parentBoardPath, 'utf8'), 'Epic A', 'Completed', true),
);
ok(/epic surface differs/.test(projectionBoardDrift(
  fs.readFileSync(epicProjection.parentBoardPath, 'utf8'),
  epicProjection.state.cards.A1,
  {
    boardPath: epicProjection.parentBoardPath,
    cardsRoot: epicProjection.cardsRoot,
    state: epicProjection.state,
  },
).issue), 'ES4-DUAL-INVARIANT detects a hand-moved epic against the authoritative slice roll-up');
projectCard(
  epicProjection.cardPath,
  epicProjection.parentBoardPath,
  'A1',
  'implementing',
  {
    record: epicProjection.state.cards.A1,
    state: epicProjection.state,
    cardsRoot: epicProjection.cardsRoot,
    now: () => '2026-07-23T14:00:00.000Z',
  },
);
assertEpicProjectionConverged(epicProjection, 'ES4-DUAL-INVARIANT-REPAIR');

for (let boundary = 1; boundary <= 4; boundary++) {
  const fixture = makeEpicProjectionFixture(`fault-${boundary}`);
  let writes = 0;
  assert.throws(() => projectCard(
    fixture.cardPath,
    fixture.parentBoardPath,
    'A1',
    'implementing',
    {
      record: fixture.state.cards.A1,
      state: fixture.state,
      cardsRoot: fixture.cardsRoot,
      now: () => '2026-07-23T14:00:00.000Z',
      writeText: (target, value) => {
        writes += 1;
        if (writes === boundary) throw new Error(`ES4-WRITE-${boundary}`);
        fs.writeFileSync(target, value);
      },
    },
  ), new RegExp(`ES4-WRITE-${boundary}`), `ES4-WRITE-${boundary} injects a crash at its atomic write boundary`);
  const recovered = projectCard(
    fixture.cardPath,
    fixture.parentBoardPath,
    'A1',
    'implementing',
    {
      record: fixture.state.cards.A1,
      state: fixture.state,
      cardsRoot: fixture.cardsRoot,
      now: () => '2026-07-23T14:00:00.000Z',
    },
  );
  ok(recovered.changed, `ES4-WRITE-${boundary} reconcile repairs the interrupted projection`);
  assertEpicProjectionConverged(fixture, `ES4-WRITE-${boundary}`);
  eq(projectCard(
    fixture.cardPath,
    fixture.parentBoardPath,
    'A1',
    'implementing',
    {
      record: fixture.state.cards.A1,
      state: fixture.state,
      cardsRoot: fixture.cardsRoot,
      now: () => '2026-07-23T14:00:00.000Z',
    },
  ).changed, false, `ES4-WRITE-${boundary} converges to a projection no-op`);
}

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
function snapshotDirectory(root) {
  const rows = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { rows.push(['dir', relative]); walk(full, relative); }
      else rows.push(['file', relative, fs.readFileSync(full).toString('base64')]);
    }
  };
  walk(root);
  return rows;
}
function withoutExecutionContractBlocks(raw) {
  const lines = String(raw).split('\n');
  const out = [];
  for (let index = 0; index < lines.length;) {
    if (/^(touch_zones|deploy_subscriptions):/.test(lines[index])) {
      index++;
      while (index < lines.length && /^\s+/.test(lines[index])) index++;
    } else out.push(lines[index++]);
  }
  return out.join('\n');
}
function makeAmendFixture(opts = {}) {
  const root = path.join(tmp, `amend-${++amendFixtureId}`);
  const worktree = path.join(root, 'target-worktree');
  const cardPath = path.join(root, `${AMEND_CARD}.md`);
  const boardPath = path.join(root, 'sauce-board.md');
  const parked = (opts.phase || 'implementing') === 'parked';
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, 'protected.txt'), 'target worktree must never change\n');
  fs.mkdirSync(path.join(worktree, 'nested'));
  fs.writeFileSync(path.join(worktree, 'nested/second.txt'), 'second protected file\n');
  fs.writeFileSync(cardPath, [
    '---', 'kanban_column: In Progress', `status: ${parked ? 'parked' : 'in_progress'}`, 'model_profile: heavy', 'execution_mode: release',
    opts.batchPolicyLine || 'batch_policy: supervised_only',
    'parent_card: "[[Protected parent]]"', 'slice: TEST', 'depends_on:', '  - "[[Prerequisite]]"',
    ...(parked ? ['resume_condition: "Prerequisite deploys before this card resumes."'] : []),
    'touch_zones:', '  - platform/mechanisms/delivery', '  - platform/schemas-index.json',
    'deploy_subscriptions:', '  headspace:', '    - delivery', '  accuris:', '    - delivery', '  ero:', '    - delivery',
    '---', '', '## Protected active contract', '',
    'Protected active work.', '',
  ].join('\n'));
  fs.writeFileSync(boardPath, liveBoard({ progress: [AMEND_CARD] }));
  const record = {
    card: AMEND_CARD, phase: opts.phase || 'implementing', card_path: cardPath,
    branch: 'codex-autoloop/protected-active-contract', worktree,
    model_profile: 'heavy', parent_card: '[[Protected parent]]', slice: 'TEST', dependencies: ['Prerequisite'],
    ...(parked ? { resume_condition: 'Prerequisite deploys before this card resumes.' } : {}),
    projection_reconciled_at: '2026-07-15T00:00:00.000Z',
    touch_zones: ['platform/mechanisms/delivery', 'platform/schemas-index.json'],
    deploy_subscriptions: deepCopy(legacyDeployments),
    reviews: { correctness: { lens: 'correctness', verdict: 'pass', head_sha: AMEND_HEAD, summary: 'old exact-head review' } },
    gate_receipt: passingReceipt(AMEND_HEAD),
    receipt_invalidations: [{ invalidated_at: '2026-07-14T00:00:00.000Z', reason: 'older', head_sha: 'old', reviews: {}, gate_receipt: null }],
    ...opts.record,
  };
  const fixture = {
    root, worktree, cardPath, boardPath,
    state: { schema_version: 1, updated_at: '2026-07-16T00:00:00.000Z', cards: {
      [AMEND_CARD]: record,
      Unrelated: { card: 'Unrelated', phase: 'deployed', untouched: { proof: true }, touch_zones: ['platform/unrelated'] },
    } },
    writes: 0, locks: [], gitCalls: [], dirty: opts.dirty || '',
  };
  fixture.args = {
    _: ['amend-contract'], json: true, card: AMEND_CARD,
    'expected-head': AMEND_HEAD, 'expected-origin-main': AMEND_MAIN,
    reason: 'add the omitted catalogue zone and type legacy deployment additions',
    'add-touch-zone': ['./platform/manifest.json/', 'platform/manifest.json'],
    'expected-deployment': JSON.stringify(legacyDeployments),
    'desired-deployment': JSON.stringify(typedDeployments),
    'expected-batch-policy': 'null',
    'desired-batch-policy': 'supervised_only',
  };
  fixture.deps = {
    readState: () => deepCopy(fixture.state),
    writeState: (_ctx, _state, changedRecord) => {
      fixture.writes++;
      fixture.state.cards[changedRecord.card] = deepCopy(changedRecord);
    },
    withLock: async (_ctx, name, fn) => { fixture.locks.push(name); return fn(); },
    worktreeExists: () => opts.worktreeExists !== false,
    sh: (cmd, argv, options = {}) => {
      fixture.gitCalls.push({ cmd, argv: [...argv], cwd: options.cwd, stdio: options.stdio || null });
      if (argv[0] === 'fetch') return '';
      if (argv[0] === 'rev-parse') return argv[1] === 'HEAD' ? (opts.actualHead || AMEND_HEAD) : (opts.actualMain || AMEND_MAIN);
      if (argv[0] === 'branch') return opts.actualBranch || record.branch;
      if (argv[0] === 'status') return fixture.dirty;
      throw new Error(`unexpected git fixture call ${argv.join(' ')}`);
    },
    boardPath, cardsRoot: root,
    now: () => '2026-07-16T18:00:00.000Z',
  };
  fixture.worktreeSnapshot = snapshotDirectory(worktree);
  fixture.cardSnapshot = fs.readFileSync(cardPath, 'utf8');
  return fixture;
}

const amend = makeAmendFixture();
const amendUnrelatedBefore = deepCopy(amend.state.cards.Unrelated);
const amendProtectedBefore = Object.fromEntries([
  'phase', 'model_profile', 'dependencies', 'parent_card', 'slice', 'branch', 'worktree', 'card_path',
].map((key) => [key, deepCopy(amend.state.cards[AMEND_CARD][key])]));
const amendOldReviews = deepCopy(amend.state.cards[AMEND_CARD].reviews);
const amendOldGate = deepCopy(amend.state.cards[AMEND_CARD].gate_receipt);
const amendPriorInvalidation = deepCopy(amend.state.cards[AMEND_CARD].receipt_invalidations[0]);
const amended = await commandAmendContract({ root: amend.root }, amend.args, amend.deps);
eq(amended.action, 'contract-amended', 'amend-contract succeeds through the explicit supervised command');
eq(amended.no_op, false, 'real execution-contract amendment is not a no-op');
eq(amend.locks, [
  'selector', legacyCardGateLockName('Protected active contract'),
  cardGateLockName('Protected active contract'), 'completion-projection',
], 'amend-contract uses selector, migration-compatible card, exact card, then projection lock order');
eq(amend.state.cards[AMEND_CARD].touch_zones, [
  'platform/mechanisms/delivery', 'platform/schemas-index.json', 'platform/manifest.json',
], 'touch-zone amendment is normalized, deduplicated, additive, and preserves existing order');
eq(amend.state.cards[AMEND_CARD].deploy_subscriptions, typedDeployments, 'deployment replacement stores only the normalized typed desired map');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].old_contract.deploy_subscriptions, legacyDeployments, 'audit preserves the exact normalized old deployment map');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].new_contract.deploy_subscriptions, typedDeployments, 'audit records the exact new deployment map');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].old_contract.batch_policy, null, 'audit preserves the exact null old batch policy');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].new_contract.batch_policy, 'supervised_only', 'audit records the strengthened batch policy');
eq(amend.state.cards[AMEND_CARD].batch_policy, 'supervised_only', 'batch-policy amendment stores the desired authority');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].expected_head, AMEND_HEAD, 'audit pins the exact target HEAD');
eq(amend.state.cards[AMEND_CARD].contract_amendments[0].expected_origin_main, AMEND_MAIN, 'audit pins the exact origin/main revision');
eq(amend.state.cards[AMEND_CARD].receipt_invalidations.length, 2, 'real amendment appends one receipt invalidation');
eq(amend.state.cards[AMEND_CARD].receipt_invalidations[0], amendPriorInvalidation, 'real amendment preserves prior invalidation history byte-for-byte');
eq(amend.state.cards[AMEND_CARD].receipt_invalidations[1], {
  invalidated_at: '2026-07-16T18:00:00.000Z',
  reason: 'execution contract amended: add the omitted catalogue zone and type legacy deployment additions; rerun every review and combined gate',
  head_sha: AMEND_HEAD, reviews: amendOldReviews, gate_receipt: amendOldGate,
}, 'real amendment snapshots exact reviews, gate, reason, timestamp, and HEAD');
eq(amend.state.cards[AMEND_CARD].reviews, {}, 'real amendment invalidates current reviews');
eq(amend.state.cards[AMEND_CARD].gate_receipt, null, 'real amendment invalidates the combined gate receipt');
eq(amend.state.cards.Unrelated, amendUnrelatedBefore, 'authoritative update preserves every unrelated tracked record');
eq(Object.fromEntries(Object.keys(amendProtectedBefore).map((key) => [key, amend.state.cards[AMEND_CARD][key]])),
  amendProtectedBefore, 'amendment preserves every protected target metadata field outside the two authorized contract fields');
ok(/platform\/manifest\.json/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'amended touch zones project into card frontmatter');
ok(/mechanism:delivery/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'typed deployments project into card frontmatter');
const amendedCardRaw = fs.readFileSync(amend.cardPath, 'utf8');
const amendedDeploymentLine = amendedCardRaw.split('\n').find((line) => line.startsWith('deploy_subscriptions: '));
eq(JSON.parse(JSON.parse(amendedDeploymentLine.slice(amendedDeploymentLine.indexOf(':') + 1).trim())),
  typedDeployments,
  'GA-OPS20A-AMEND-PROJECTION-FLAT amend-contract projects the exact authority map as one JSON text scalar');
ok(!/\ndeploy_subscriptions:\n\s+headspace:/m.test(amendedCardRaw),
  'GA-OPS20A-AMEND-PROJECTION-FLAT amend-contract never restores the legacy nested deployment map');
ok(/status: in_progress/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'contract-only projection preserves lifecycle metadata');
ok(!/status_changed_at: 2026-07-16T18:00:00.000Z/.test(fs.readFileSync(amend.cardPath, 'utf8')), 'contract-only projection does not rewrite the status timestamp');
eq(withoutExecutionContractBlocks(fs.readFileSync(amend.cardPath, 'utf8')), withoutExecutionContractBlocks(amend.cardSnapshot),
  'card projection preserves every frontmatter field and body byte outside the two authorized contract blocks');
const repeatedAmendProjection = projectCard(
  amend.cardPath,
  amend.boardPath,
  AMEND_CARD,
  'implementing',
  {
    cardsRoot: amend.root,
    record: amend.state.cards[AMEND_CARD],
    state: amend.state,
    now: amend.deps.now,
  },
);
ok(repeatedAmendProjection.changed === false && repeatedAmendProjection.card_changed === false,
  'GA-OPS20A-AMEND-PROJECTION-FLAT normal projection recognizes the JSON text scalar and stays no-op');
eq(fs.readFileSync(amend.cardPath, 'utf8'), amendedCardRaw,
  'GA-OPS20A-AMEND-PROJECTION-FLAT normal projection preserves the scalar card byte-for-byte');
eq(snapshotDirectory(amend.worktree), amend.worktreeSnapshot, 'successful amendment preserves the complete target worktree tree and bytes');
eq(amend.gitCalls, [
  { cmd: 'git', argv: ['fetch', 'origin', 'main', '--quiet'], cwd: amend.worktree, stdio: 'pipe' },
  { cmd: 'git', argv: ['rev-parse', 'HEAD'], cwd: amend.worktree, stdio: null },
  { cmd: 'git', argv: ['rev-parse', 'origin/main'], cwd: amend.worktree, stdio: null },
  { cmd: 'git', argv: ['branch', '--show-current'], cwd: amend.worktree, stdio: null },
  { cmd: 'git', argv: ['status', '--porcelain=v1'], cwd: amend.worktree, stdio: null },
], 'amend-contract runs only the exact read-only Git argv/options/cwd verification sequence');
eq(amend.writes, 2, 'successful amendment persists authority first and its projection receipt second');

const claimedAmendment = makeAmendFixture({ phase: 'claimed' });
eq((await commandAmendContract({ root: claimedAmendment.root }, claimedAmendment.args, claimedAmendment.deps)).action,
  'contract-amended', 'amend-contract accepts tracked claimed work before feature PR creation');

const replayWrites = amend.writes;
const replayInvalidations = deepCopy(amend.state.cards[AMEND_CARD].receipt_invalidations);
const replayAudit = deepCopy(amend.state.cards[AMEND_CARD].contract_amendments);
const replayCard = fs.readFileSync(amend.cardPath, 'utf8');
const replayState = deepCopy(amend.state);
const replayBoard = fs.readFileSync(amend.boardPath, 'utf8');
const replay = await commandAmendContract({ root: amend.root }, amend.args, amend.deps);
eq(replay.no_op, true, 'the literal unchanged original arguments are an explicit no-op');
eq(amend.writes, replayWrites, 'literal exact replay performs no ledger write');
eq(amend.state, replayState, 'literal exact replay performs no ledger, audit, review, gate, or timestamp write');
eq(amend.state.cards[AMEND_CARD].receipt_invalidations, replayInvalidations, 'literal exact replay preserves every receipt and invalidation timestamp');
eq(amend.state.cards[AMEND_CARD].contract_amendments, replayAudit, 'literal exact replay preserves amendment audit timestamps');
eq(fs.readFileSync(amend.cardPath, 'utf8'), replayCard, 'literal exact replay performs no card projection rewrite');
eq(fs.readFileSync(amend.boardPath, 'utf8'), replayBoard, 'literal exact replay performs no board projection rewrite');

for (const [label, mutate] of [
  ['json output flag', (args) => { delete args.json; }],
  ['reason', (args) => { args.reason = `${args.reason} altered`; }],
  ['expected HEAD', (args) => { args['expected-head'] = 'c'.repeat(40); }],
  ['expected origin/main', (args) => { args['expected-origin-main'] = 'c'.repeat(40); }],
  ['expected deployment JSON bytes', (args) => { args['expected-deployment'] = '{ "ero" : ["delivery"], "accuris" : ["delivery"], "headspace" : ["delivery"] }'; }],
  ['expected deployment', (args) => { args['expected-deployment'] = JSON.stringify(typedDeployments); }],
  ['desired deployment JSON bytes', (args) => { args['desired-deployment'] = '{ "ero" : ["mechanism:delivery"], "accuris" : ["mechanism:delivery"], "headspace" : ["mechanism:delivery"] }'; }],
  ['desired deployment', (args) => { args['desired-deployment'] = JSON.stringify({ ...typedDeployments, ero: [] }); }],
  ['expected batch policy', (args) => { args['expected-batch-policy'] = 'supervised_only'; }],
  ['desired batch policy', (args) => { args['desired-batch-policy'] = 'stop_after'; }],
  ['touch-zone additions', (args) => { args['add-touch-zone'] = 'platform/manifest.json'; }],
]) {
  const altered = deepCopy(amend.args);
  mutate(altered);
  await assert.rejects(
    () => commandAmendContract({ root: amend.root }, altered, amend.deps),
    /desired contract state already exists without an exact successful request identity|stale expected HEAD|stale expected origin\/main|desired batch policy must match projected policy|stale expected batch policy/,
    `desired-state equality without matching ${label} identity fails closed`,
  );
  eq(amend.state, replayState, `altered ${label} replay preserves all authority and evidence`);
  eq(amend.writes, replayWrites, `altered ${label} replay performs no ledger write`);
}

// This isolated fixture mirrors A4's authority shape: clean tracked parked
// pre-PR work with null policy, non-empty dependencies, and a resume condition.
const parkedAmendment = makeAmendFixture({ phase: 'parked' });
const parkedProtectedBefore = Object.fromEntries([
  'phase', 'dependencies', 'resume_condition', 'branch', 'worktree', 'reviews', 'gate_receipt',
  'receipt_invalidations', 'projection_reconciled_at',
].map((key) => [key, deepCopy(parkedAmendment.state.cards[AMEND_CARD][key])]));
const parkedResult = await commandAmendContract(
  { root: parkedAmendment.root }, parkedAmendment.args, parkedAmendment.deps,
);
eq(parkedResult.action, 'contract-amended', 'amend-contract accepts a clean tracked parked pre-PR card');
eq(parkedResult.phase, 'parked', 'parked amendment never resumes the target');
eq(parkedResult.reviews_invalidated, false, 'parked amendment preserves historical review authority');
eq(Object.fromEntries(Object.keys(parkedProtectedBefore).map((key) => [key, parkedAmendment.state.cards[AMEND_CARD][key]])),
  parkedProtectedBefore, 'parked amendment preserves phase, dependencies, resume condition, worktree, and historical evidence');
const parkedWrites = parkedAmendment.writes;
const parkedState = deepCopy(parkedAmendment.state);
const parkedCard = fs.readFileSync(parkedAmendment.cardPath, 'utf8');
const parkedBoard = fs.readFileSync(parkedAmendment.boardPath, 'utf8');
eq((await commandAmendContract({ root: parkedAmendment.root }, parkedAmendment.args, parkedAmendment.deps)).no_op, true,
  'parked amendment replays only with the literal original arguments');
eq(parkedAmendment.writes, parkedWrites, 'parked exact replay has no ledger write');
eq(parkedAmendment.state, parkedState, 'parked exact replay preserves ledger, review, gate, audit, and timestamps');
eq(fs.readFileSync(parkedAmendment.cardPath, 'utf8'), parkedCard, 'parked exact replay has no card write');
eq(fs.readFileSync(parkedAmendment.boardPath, 'utf8'), parkedBoard, 'parked exact replay has no board write');

const parkedProjectionFailure = makeAmendFixture({ phase: 'parked' });
parkedProjectionFailure.deps.projectCard = () => { throw new Error('parked projection crash'); };
const parkedFailed = await commandAmendContract(
  { root: parkedProjectionFailure.root }, parkedProjectionFailure.args, parkedProjectionFailure.deps,
);
eq(parkedFailed.action, 'amend-contract-projection-failed', 'parked projection failure is recoverable without resuming');
eq(parkedProjectionFailure.state.cards[AMEND_CARD].phase, 'parked', 'parked projection failure preserves the parked phase');
delete parkedProjectionFailure.deps.projectCard;
eq((await commandReconcile({ root: parkedProjectionFailure.root }, { card: AMEND_CARD }, parkedProjectionFailure.deps)).action,
  'reconciled', 'reconciliation repairs a parked amendment projection failure');
const parkedRecoveryWrites = parkedProjectionFailure.writes;
const parkedProjectionRecoveryState = deepCopy(parkedProjectionFailure.state);
const parkedRecoveryCard = fs.readFileSync(parkedProjectionFailure.cardPath, 'utf8');
const parkedRecoveryBoard = fs.readFileSync(parkedProjectionFailure.boardPath, 'utf8');
eq((await commandAmendContract(
  { root: parkedProjectionFailure.root }, parkedProjectionFailure.args, parkedProjectionFailure.deps,
)).no_op, true, 'reconciled parked amendment accepts only the literal original replay');
eq(parkedProjectionFailure.writes, parkedRecoveryWrites, 'reconciled parked literal replay has no ledger write');
eq(parkedProjectionFailure.state, parkedProjectionRecoveryState, 'reconciled parked literal replay preserves all receipts and timestamps');
eq(fs.readFileSync(parkedProjectionFailure.cardPath, 'utf8'), parkedRecoveryCard, 'reconciled parked literal replay has no card write');
eq(fs.readFileSync(parkedProjectionFailure.boardPath, 'utf8'), parkedRecoveryBoard, 'reconciled parked literal replay has no board write');

for (const [label, mutate, pattern] of [
  ['missing dependencies', (f) => { f.state.cards[AMEND_CARD].dependencies = []; }, /retain non-empty dependencies/],
  ['missing resume condition', (f) => { f.state.cards[AMEND_CARD].resume_condition = ''; }, /retain a non-empty resume condition/],
  ['unresolved projection failure', (f) => { f.state.cards[AMEND_CARD].projection_error = 'projection drift'; }, /projection is unresolved/],
  ['dirty worktree', (f) => { f.dirty = ' M protected.txt'; }, /clean target worktree/],
  ['post-PR state', (f) => { f.state.cards[AMEND_CARD].feature_pr = 123; }, /feature PR state/],
  ['stale HEAD', (f) => { f.args['expected-head'] = 'c'.repeat(40); }, /stale expected HEAD/],
  ['malformed policy', (f) => { f.state.cards[AMEND_CARD].batch_policy = 'unattended'; }, /malformed batch_policy/],
  ['projected board drift', (f) => { fs.writeFileSync(f.boardPath, liveBoard({ planning: [AMEND_CARD] })); }, /board projection must be reconciled/],
]) {
  const fixture = makeAmendFixture({ phase: 'parked' });
  mutate(fixture);
  const before = deepCopy(fixture.state);
  await assert.rejects(() => commandAmendContract({ root: fixture.root }, fixture.args, fixture.deps), pattern,
    `parked amendment refuses ${label}`);
  eq(fixture.state, before, `parked ${label} refusal preserves authority`);
  eq(fixture.writes, 0, `parked ${label} refusal performs no ledger write`);
}

const refusalCases = [
  ['unexpected positional argument', (f) => { f.args._.push('extra'); }, /unexpected positional/],
  ['valued json flag', (f) => { f.args.json = 'true'; }, /--json without a value/],
  ['missing card argument', (f) => { delete f.args.card; }, /exact --card/],
  ['duplicate card argument', (f) => { f.args.card = [AMEND_CARD, AMEND_CARD]; }, /exact --card/],
  ['missing expected HEAD', (f) => { delete f.args['expected-head']; }, /40-character --expected-head/],
  ['missing expected origin main', (f) => { delete f.args['expected-origin-main']; }, /40-character --expected-origin-main/],
  ['missing reason', (f) => { delete f.args.reason; }, /non-empty --reason/],
  ['duplicate reason', (f) => { f.args.reason = ['one', 'two']; }, /non-empty --reason/],
  ['empty touch-zone addition', (f) => { f.args['add-touch-zone'] = true; }, /non-empty paths/],
  ['missing expected deployment', (f) => { delete f.args['expected-deployment']; }, /requires --expected-deployment/],
  ['missing desired deployment', (f) => { delete f.args['desired-deployment']; }, /requires --desired-deployment/],
  ['missing expected batch policy', (f) => { delete f.args['expected-batch-policy']; }, /requires --expected-batch-policy/],
  ['duplicate expected batch policy', (f) => { f.args['expected-batch-policy'] = ['null', 'null']; }, /requires --expected-batch-policy/],
  ['missing desired batch policy', (f) => { delete f.args['desired-batch-policy']; }, /requires --desired-batch-policy/],
  ['duplicate desired batch policy', (f) => { f.args['desired-batch-policy'] = ['supervised_only', 'supervised_only']; }, /requires --desired-batch-policy/],
  ['invalid expected batch policy', (f) => { f.args['expected-batch-policy'] = 'unattended'; }, /must be null\|continue\|stop_after\|supervised_only/],
  ['null desired batch policy', (f) => { f.args['desired-batch-policy'] = 'null'; }, /must be continue\|stop_after\|supervised_only/],
  ['malformed expected deployment keys', (f) => { f.args['expected-deployment'] = JSON.stringify({ headspace: [], accuris: [] }); }, /requires exactly/],
  ['malformed expected deployment array', (f) => { f.args['expected-deployment'] = JSON.stringify({ headspace: 'delivery', accuris: [], ero: [] }); }, /headspace must be an array/],
  ['malformed expected deployment entry', (f) => { f.args['expected-deployment'] = JSON.stringify({ headspace: [42], accuris: [], ero: [] }); }, /entries must be strings/],
  ['malformed desired deployment keys', (f) => { f.args['desired-deployment'] = JSON.stringify({ headspace: [], accuris: [] }); }, /requires exactly/],
  ['untracked card', (f) => { f.state.cards = {}; }, /not tracked/],
  ['missing worktree', (f) => { f.deps.worktreeExists = () => false; }, /existing worktree/],
  ['dirty worktree', (f) => { f.dirty = ' M protected.txt'; }, /clean target worktree/],
  ['post-PR phase', (f) => { f.state.cards[AMEND_CARD].phase = 'feature_pr'; }, /pre-PR work/],
  ['stale tracked PR state', (f) => { f.state.cards[AMEND_CARD].feature_pr = 123; }, /feature PR state/],
  ['stale HEAD', (f) => { f.args['expected-head'] = 'c'.repeat(40); }, /stale expected HEAD/],
  ['stale origin main', (f) => { f.args['expected-origin-main'] = 'c'.repeat(40); }, /stale expected origin\/main/],
  ['wrong tracked branch', (f) => { f.deps.sh = (_cmd, argv) => argv[0] === 'fetch' ? '' : argv[0] === 'rev-parse' ? (argv[1] === 'HEAD' ? AMEND_HEAD : AMEND_MAIN) : argv[0] === 'branch' ? 'other-branch' : ''; }, /branch differs/],
  ['stale deployment CAS', (f) => { f.args['expected-deployment'] = JSON.stringify({ ...legacyDeployments, ero: [] }); }, /stale expected deployment/],
  ['stale batch-policy CAS', (f) => { f.args['expected-batch-policy'] = 'continue'; }, /stale expected batch policy/],
  ['structurally inexact deployment CAS', (f) => { f.args['expected-deployment'] = JSON.stringify({ ...legacyDeployments, headspace: [' delivery ', 'delivery', ''] }); }, /stale expected deployment/],
  ['untyped desired deployment', (f) => { f.args['desired-deployment'] = JSON.stringify(legacyDeployments); }, /mechanism:name or blueprint:name/],
  ['malformed authoritative deployment', (f) => { f.state.cards[AMEND_CARD].deploy_subscriptions = { headspace: [], accuris: [] }; }, /requires exactly/],
  ['malformed authoritative touch zones', (f) => { f.state.cards[AMEND_CARD].touch_zones = ['platform/x', 'platform/x']; }, /malformed touch_zones/],
  ['noncanonical authoritative touch zones', (f) => { f.state.cards[AMEND_CARD].touch_zones = ['./platform/mechanisms/delivery', 'platform/schemas-index.json']; }, /noncanonical touch_zones/],
  ['malformed amendment history', (f) => { f.state.cards[AMEND_CARD].contract_amendments = {}; }, /malformed amendment audit history/],
  ['malformed invalidation history', (f) => { f.state.cards[AMEND_CARD].receipt_invalidations = {}; }, /malformed receipt invalidation history/],
  ['unresolved projection error', (f) => { f.state.cards[AMEND_CARD].projection_error = 'prior failure'; }, /projection is unresolved/],
  ['unreadable target card', (f) => { fs.rmSync(f.cardPath); }, /target card metadata is unreadable/],
  ['unreadable target board', (f) => { fs.rmSync(f.boardPath); }, /target board projection is unreadable/],
  ['drifted projected touch zones', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('  - platform/schemas-index.json', '  - platform/other.json')); }, /projected touch_zones differ/],
  ['drifted projected deployment map', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('    - delivery', '    - other')); }, /projected deployment map differs/],
  ['drifted projected model profile', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('model_profile: heavy', 'model_profile: standard')); }, /projected model_profile differs/],
  ['drifted projected dependencies', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('[[Prerequisite]]', '[[Other prerequisite]]')); }, /projected dependencies differ/],
  ['drifted projected parent', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('[[Protected parent]]', '[[Other parent]]')); }, /projected parent_card differs/],
  ['drifted projected slice', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('slice: TEST', 'slice: OTHER')); }, /projected slice differs/],
  ['missing projected execution mode', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('execution_mode: release\n', '')); }, /execution_mode must remain release/],
  ['changed projected execution mode', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('execution_mode: release', 'execution_mode: docs_only')); }, /execution_mode must remain release/],
  ['non-supervised target', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('batch_policy: supervised_only', 'batch_policy: unattended')); }, /desired batch policy must match projected policy unattended/],
  ['ledger batch-policy drift', (f) => { f.state.cards[AMEND_CARD].batch_policy = 'unattended'; }, /malformed batch_policy/],
  ['lifecycle metadata drift', (f) => { fs.writeFileSync(f.cardPath, f.cardSnapshot.replace('status: in_progress', 'status: planning')); }, /metadata must be reconciled/],
  ['board projection drift', (f) => { fs.writeFileSync(f.boardPath, liveBoard({ planning: [AMEND_CARD] })); }, /board projection must be reconciled/],
  ['unsupported execution-mode mutation', (f) => { f.args['execution-mode'] = 'docs'; }, /unsupported option --execution-mode/],
  ['unsupported metadata mutation', (f) => { f.args.phase = 'claimed'; }, /unsupported option --phase/],
];
for (const [label, mutate, pattern] of refusalCases) {
  const fixture = makeAmendFixture();
  mutate(fixture);
  const before = deepCopy(fixture.state);
  const beforeCard = fs.existsSync(fixture.cardPath) ? fs.readFileSync(fixture.cardPath, 'utf8') : null;
  const beforeBoard = fs.existsSync(fixture.boardPath) ? fs.readFileSync(fixture.boardPath, 'utf8') : null;
  const beforeWorktree = snapshotDirectory(fixture.worktree);
  await assert.rejects(() => commandAmendContract({ root: fixture.root }, fixture.args, fixture.deps), pattern, `amend-contract refuses ${label}`);
  eq(fixture.state, before, `${label} refusal preserves authoritative state`);
  eq(fixture.writes, 0, `${label} refusal performs no ledger write`);
  eq(fs.existsSync(fixture.cardPath) ? fs.readFileSync(fixture.cardPath, 'utf8') : null, beforeCard, `${label} refusal preserves projected card bytes`);
  eq(fs.existsSync(fixture.boardPath) ? fs.readFileSync(fixture.boardPath, 'utf8') : null, beforeBoard, `${label} refusal preserves projected board bytes`);
  eq(snapshotDirectory(fixture.worktree), beforeWorktree, `${label} refusal preserves the complete target worktree tree and bytes`);
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

const weakeningFixture = makeAmendFixture({
  batchPolicyLine: 'batch_policy: continue',
  record: {
    batch_policy: 'stop_after',
    touch_zones: ['platform/schemas-index.json'],
  },
});
weakeningFixture.cardSnapshot = weakeningFixture.cardSnapshot.replace('  - platform/mechanisms/delivery\n', '');
fs.writeFileSync(weakeningFixture.cardPath, weakeningFixture.cardSnapshot);
weakeningFixture.args['expected-batch-policy'] = 'stop_after';
weakeningFixture.args['desired-batch-policy'] = 'continue';
const weakeningBefore = deepCopy(weakeningFixture.state);
await assert.rejects(
  () => commandAmendContract({ root: weakeningFixture.root }, weakeningFixture.args, weakeningFixture.deps),
  /refuses batch policy weakening/, 'amend-contract refuses an explicit batch-policy weakening',
);
eq(weakeningFixture.state, weakeningBefore, 'batch-policy weakening preserves authoritative state');
eq(weakeningFixture.writes, 0, 'batch-policy weakening occurs before authoritative mutation');

const projectionFailure = makeAmendFixture();
projectionFailure.deps.projectCard = () => {
  fs.writeFileSync(projectionFailure.cardPath, projectionFailure.cardSnapshot.replace(
    '  - platform/schemas-index.json', '  - platform/schemas-index.json\n  - "platform/manifest.json"',
  ));
  throw new Error('crash during contract projection');
};
const failedAmend = await commandAmendContract({ root: projectionFailure.root }, projectionFailure.args, projectionFailure.deps);
eq(failedAmend.action, 'amend-contract-projection-failed', 'projection failure is explicit after authoritative amendment');
eq(projectionFailure.state.cards[AMEND_CARD].deploy_subscriptions, typedDeployments, 'projection failure preserves authoritative desired deployment map');
eq(projectionFailure.state.cards[AMEND_CARD].projection_error, 'crash during contract projection', 'during-projection crash is saved for reconciliation');
ok(/platform\/manifest\.json/.test(fs.readFileSync(projectionFailure.cardPath, 'utf8'))
  && !/mechanism:delivery/.test(fs.readFileSync(projectionFailure.cardPath, 'utf8')), 'during-projection crash fixture leaves a genuinely partial card projection');
const projectionFailureWrites = projectionFailure.writes;
delete projectionFailure.deps.projectCard;
const repairedAmendment = await commandReconcile({ root: projectionFailure.root }, { card: AMEND_CARD }, projectionFailure.deps);
eq(repairedAmendment.action, 'reconciled', 'reconciliation repairs a failed contract projection without replaying amendment');
eq(projectionFailure.state.cards[AMEND_CARD].contract_amendments.length, 1, 'reconciliation never replays or duplicates the amendment audit');
ok(projectionFailure.writes > projectionFailureWrites, 'reconciliation persists projection recovery');
ok(/mechanism:delivery/.test(fs.readFileSync(projectionFailure.cardPath, 'utf8')), 'reconciliation projects the authoritative deployment contract');
eq(snapshotDirectory(projectionFailure.worktree), projectionFailure.worktreeSnapshot, 'during-projection crash and reconciliation preserve the complete target worktree');
eq((await commandReconcile({ root: projectionFailure.root }, { card: AMEND_CARD }, projectionFailure.deps)).no_op, true, 'second contract reconciliation is idempotent');
const postReconcileReviews = { correctness: { lens: 'correctness', verdict: 'pass', head_sha: AMEND_HEAD, summary: 'fresh review after repair' } };
const postReconcileGate = passingReceipt(AMEND_HEAD);
projectionFailure.state.cards[AMEND_CARD].reviews = deepCopy(postReconcileReviews);
projectionFailure.state.cards[AMEND_CARD].gate_receipt = deepCopy(postReconcileGate);
const postReconcileInvalidations = deepCopy(projectionFailure.state.cards[AMEND_CARD].receipt_invalidations);
const postReconcileAudits = deepCopy(projectionFailure.state.cards[AMEND_CARD].contract_amendments);
const postReconcileTimestamp = projectionFailure.state.cards[AMEND_CARD].projection_reconciled_at;
const postReconcileWrites = projectionFailure.writes;
const postReconcileReplay = await commandAmendContract(
  { root: projectionFailure.root }, projectionFailure.args, projectionFailure.deps,
);
eq(postReconcileReplay.no_op, true, 'literal original replay after reconciliation is an explicit no-op');
eq(projectionFailure.writes, postReconcileWrites, 'post-reconciliation literal replay performs no write');
eq(projectionFailure.state.cards[AMEND_CARD].reviews, postReconcileReviews, 'post-reconciliation literal replay preserves fresh reviews');
eq(projectionFailure.state.cards[AMEND_CARD].gate_receipt, postReconcileGate, 'post-reconciliation literal replay preserves the fresh combined gate');
eq(projectionFailure.state.cards[AMEND_CARD].receipt_invalidations, postReconcileInvalidations, 'post-reconciliation literal replay preserves invalidation history');
eq(projectionFailure.state.cards[AMEND_CARD].contract_amendments, postReconcileAudits, 'post-reconciliation literal replay preserves amendment audit history');
eq(projectionFailure.state.cards[AMEND_CARD].projection_reconciled_at, postReconcileTimestamp, 'post-reconciliation literal replay preserves projection timestamps');

const beforeAuthorityCrash = makeAmendFixture();
beforeAuthorityCrash.deps.beforeAuthority = () => { throw new Error('crash before authority'); };
await assert.rejects(() => commandAmendContract({ root: beforeAuthorityCrash.root }, beforeAuthorityCrash.args, beforeAuthorityCrash.deps), /crash before authority/);
eq(beforeAuthorityCrash.writes, 0, 'crash before authority leaves no ledger amendment');
eq(beforeAuthorityCrash.state.cards[AMEND_CARD].deploy_subscriptions, legacyDeployments, 'crash before authority preserves the old contract');
eq(fs.readFileSync(beforeAuthorityCrash.cardPath, 'utf8'), beforeAuthorityCrash.cardSnapshot, 'crash before authority leaves projection untouched');
eq(snapshotDirectory(beforeAuthorityCrash.worktree), beforeAuthorityCrash.worktreeSnapshot, 'crash before authority preserves the complete target worktree');

const afterAuthorityCrash = makeAmendFixture();
afterAuthorityCrash.deps.afterAuthority = () => { throw new Error('crash after authority'); };
await assert.rejects(() => commandAmendContract({ root: afterAuthorityCrash.root }, afterAuthorityCrash.args, afterAuthorityCrash.deps), /crash after authority/);
eq(afterAuthorityCrash.writes, 1, 'crash after authority preserves exactly one authoritative ledger update');
eq(afterAuthorityCrash.state.cards[AMEND_CARD].deploy_subscriptions, typedDeployments, 'crash after authority preserves the new contract');
eq(fs.readFileSync(afterAuthorityCrash.cardPath, 'utf8'), afterAuthorityCrash.cardSnapshot, 'crash after authority leaves projection recoverably stale');
eq(snapshotDirectory(afterAuthorityCrash.worktree), afterAuthorityCrash.worktreeSnapshot, 'crash after authority preserves the complete target worktree');
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
ok(!afterProjectionCrash.state.cards[AMEND_CARD].projection_reconciled_at, 'authority invalidates the old projection receipt before projection begins');
ok(/mechanism:delivery/.test(fs.readFileSync(afterProjectionCrash.cardPath, 'utf8')), 'crash after projection preserves the fully projected card contract');
delete afterProjectionCrash.deps.afterProjection;
const afterProjectionRecovery = await commandReconcile({ root: afterProjectionCrash.root }, { card: AMEND_CARD }, afterProjectionCrash.deps);
eq(afterProjectionRecovery.results[0].projection_changed, false, 'after-projection recovery does not rewrite an already exact card');
eq(afterProjectionRecovery.results[0].state_changed, true, 'after-projection recovery replaces the invalidated projection receipt even when card bytes are exact');
eq(afterProjectionCrash.state.cards[AMEND_CARD].projection_reconciled_at, '2026-07-16T18:00:00.000Z', 'after-projection recovery records a post-amendment projection receipt');
eq(afterProjectionCrash.state.cards[AMEND_CARD].contract_amendments.length, 1, 'after-projection recovery never duplicates authority');
eq(snapshotDirectory(afterProjectionCrash.worktree), afterProjectionCrash.worktreeSnapshot, 'every crash boundary preserves the complete target worktree tree and bytes');

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
const opx2ParkResumeProjections = [];
const parkDeps = {
  readState: () => parkState,
  writeState: () => { parkWrites++; },
  withLock: async (_ctx, name, fn) => { parkLocks.push(name); return fn(); },
  boardPath: parkBoardPath,
  findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  now: () => '2026-07-15T16:00:00.000Z',
  projectLoopStation: (_ctx, _state, updatedOn) => {
    opx2ParkResumeProjections.push(updatedOn);
    return { action: 'loop-station-projected', no_op: false, updated_on: updatedOn };
  },
};
await assert.rejects(() => commandPark({ root: parkRoot }, {
  json: true,
  card: 'Park me', 'depends-on': 'Park me', 'resume-condition': 'wait for myself',
}, parkDeps), /cannot depend on itself/, 'park rejects self-dependencies');
await assert.rejects(() => commandPark({ root: parkRoot }, {
  json: true,
  card: 'Park me', 'depends-on': 'Missing prerequisite', 'resume-condition': 'wait for it',
}, parkDeps), /prerequisite card .* does not exist/, 'park rejects missing prerequisite cards');
await assert.rejects(() => commandPark({ root: parkRoot }, {
  json: true,
  card: 'Park me', 'depends-on': 'Prerequisite A', 'resume-condition': '   ',
}, parkDeps), /non-empty --resume-condition/, 'park requires an exact non-empty resume condition');
parkState.cards['Park me'].phase = 'feature_pr';
await assert.rejects(() => commandPark({ root: parkRoot }, {
  json: true,
  card: 'Park me', 'depends-on': 'Prerequisite A', 'resume-condition': 'wait for deployment',
}, parkDeps), /claimed pre-PR work/, 'park refuses post-feature-PR phases');
parkState.cards['Park me'].phase = 'implementing';
const parked = await commandPark({ root: parkRoot }, {
  json: true,
  card: 'Park me', 'depends-on': ['Prerequisite A', 'Prerequisite B'], 'resume-condition': 'Both prerequisites deploy cleanly',
}, parkDeps);
eq(parked.action, 'parked', 'park succeeds through the explicit command');
eq({ ok: parked.ok, no_op: parked.no_op }, { ok: true, no_op: false },
  'park adds the success envelope without removing legacy receipt keys');
eq(opx2ParkResumeProjections, ['park'],
  'OPX2-TRANSITION-ONLY park transition fires exactly one Loop Station projection');
eq(parkLocks.slice(-4), [
  'selector', legacyCardGateLockName('Park me'), cardGateLockName('Park me'), 'completion-projection',
], 'park serializes selector, migration-compatible card, exact-card transition, and metadata projection');
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
const parkedStateBytes = JSON.stringify(parkState);
const parkedCardBytes = fs.readFileSync(parkCardPath, 'utf8');
const writesBeforeParkReplay = parkWrites;
const projectionsBeforeParkReplay = opx2ParkResumeProjections.length;
const parkReplay = await commandPark({ root: parkRoot }, {
  json: true,
  card: 'Park me', 'depends-on': ['Prerequisite A', 'Prerequisite B'], 'resume-condition': 'Both prerequisites deploy cleanly',
}, parkDeps);
eq(parkReplay.no_op, true, 'CS1-REPLAY-NOOP literal park replay returns no_op:true');
eq(JSON.stringify(parkState), parkedStateBytes,
  'CS1-REPLAY-NOOP literal park replay preserves authoritative state byte-for-byte');
eq(fs.readFileSync(parkCardPath, 'utf8'), parkedCardBytes,
  'CS1-REPLAY-NOOP literal park replay preserves projected card bytes');
eq(parkWrites, writesBeforeParkReplay, 'CS1-REPLAY-NOOP literal park replay performs zero ledger writes');
eq(opx2ParkResumeProjections.length, projectionsBeforeParkReplay,
  'CS1-REPLAY-NOOP literal park replay performs zero Loop Station writes');
await assert.rejects(() => commandPark({ root: parkRoot }, {
  json: true,
  card: 'Park me', 'depends-on': ['Prerequisite A', 'Prerequisite B'], 'resume-condition': 'Different condition',
}, parkDeps), (error) => error.code === 'literal_replay_mismatch',
'CS1-REPLAY-NOOP different park operands on a settled target refuse');
eq(parkWrites, writesBeforeParkReplay, 'CS1-REPLAY-NOOP mismatched park replay performs zero ledger writes');
eq(fs.readFileSync(parkCardPath, 'utf8'), parkedCardBytes,
  'CS1-REPLAY-NOOP mismatched park replay preserves projected card bytes');
const claimedParkState = emptyState();
claimedParkState.cards.Claimed = { card: 'Claimed', phase: 'claimed', card_path: parkCardPath };
eq((await commandPark({ root: parkRoot }, {
  json: true,
  card: 'Claimed', 'depends-on': 'Prerequisite A', 'resume-condition': 'Prerequisite A deploys',
}, {
  ...parkDeps, readState: () => claimedParkState, writeState: () => {}, projectCard: () => ({ changed: false }),
})).action, 'parked', 'park accepts the claimed pre-implementation phase');
const parkRaceState = emptyState();
parkRaceState.cards.Race = { card: 'Race', phase: 'claimed', card_path: parkCardPath };
let parkSelectorEntered = false; let parkReadAfterSelector = false;
eq((await commandPark({ root: parkRoot }, {
  json: true,
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
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Crash parked' }, {
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
const failedResumeState = JSON.parse(JSON.stringify(crashParkState));
let failedResumeWrites = 0;
const failedResumeGitCalls = [];
const failedResumeDeps = {
  ...parkDeps,
  readState: () => failedResumeState,
  writeState: () => { failedResumeWrites++; },
  boardPath: crashBoardPath,
  findCard: (_root, name) => name === 'Prerequisite A' ? '/cards/Prerequisite A.md' : null,
  worktreeExists: () => true,
  projectCard: () => { throw new Error('resume metadata projection denied'); },
  sh: (cmd, args) => {
    failedResumeGitCalls.push([cmd, ...args]);
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse') return args[1] === 'origin/main' ? 'current-main' : 'branch-head';
    if (args[0] === 'merge-base') return '';
    throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
  },
  now: () => '2026-07-15T16:02:30.000Z',
};
const failedResume = await commandResume(
  { root: parkRoot }, { json: true, card: 'Crash parked' }, failedResumeDeps,
);
eq(failedResume.action, 'resume-projection-failed',
  'CS1-PROJECTION-REPLAY initial resume projection failure is explicit');
eq(failedResumeState.cards['Crash parked'].phase, 'implementing',
  'CS1-PROJECTION-REPLAY failed resume projection preserves authoritative implementing state');
eq(failedResumeState.cards['Crash parked'].projection_error, 'resume metadata projection denied',
  'CS1-PROJECTION-REPLAY failed resume projection is saved for reconciliation');
const failedResumeBytes = JSON.stringify(failedResumeState);
const failedResumeWritesBeforeReplay = failedResumeWrites;
const failedResumeGitCallsBeforeReplay = failedResumeGitCalls.length;
const failedResumeReplay = await commandResume(
  { root: parkRoot }, { json: true, card: 'Crash parked' }, failedResumeDeps,
);
eq(failedResumeReplay.action, 'resume-projection-failed',
  'CS1-PROJECTION-REPLAY resume replay keeps the unresolved projection failure explicit');
eq(failedResumeReplay.no_op, true,
  'CS1-PROJECTION-REPLAY failed resume replay is a settled zero-write no-op');
eq(failedResumeReplay.projection_error, 'resume metadata projection denied',
  'CS1-PROJECTION-REPLAY failed resume replay preserves the exact projection error');
eq(failedResumeReplay.reconcile, 'reconcile --card Crash parked',
  'CS1-PROJECTION-REPLAY failed resume replay names the exact repair command');
eq(failedResumeWrites, failedResumeWritesBeforeReplay,
  'CS1-PROJECTION-REPLAY failed resume replay performs zero ledger writes');
eq(failedResumeGitCalls.length, failedResumeGitCallsBeforeReplay,
  'CS1-PROJECTION-REPLAY failed resume replay performs zero Git freshness reads');
eq(JSON.stringify(failedResumeState), failedResumeBytes,
  'CS1-PROJECTION-REPLAY failed resume replay preserves authoritative state byte-for-byte');
const currentMainCalls = [];
const currentMainResume = await commandResume({ root: parkRoot }, { json: true, card: 'Crash parked' }, {
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
  json: true,
  card: 'Failed', 'depends-on': 'Prerequisite A', 'resume-condition': 'Prerequisite A deploys',
}, {
  ...parkDeps, readState: () => failedParkState, writeState: () => { failedParkWrites++; },
  projectCard: () => { throw new Error('metadata projection denied'); },
});
eq(failedPark.action, 'parked-projection-failed', 'metadata projection failure is explicit');
eq(failedParkState.cards.Failed.phase, 'parked', 'failed metadata projection preserves authoritative parked state');
eq(failedParkState.cards.Failed.projection_error, 'metadata projection denied', 'failed metadata projection is saved for reconciliation');
ok(failedParkWrites >= 2, 'failed metadata projection persists both transition and failure receipt');
const failedParkBytes = JSON.stringify(failedParkState);
const failedParkWritesBeforeReplay = failedParkWrites;
const failedParkReplay = await commandPark({ root: parkRoot }, {
  json: true,
  card: 'Failed', 'depends-on': 'Prerequisite A', 'resume-condition': 'Prerequisite A deploys',
}, {
  ...parkDeps, readState: () => failedParkState, writeState: () => { failedParkWrites++; },
});
eq(failedParkReplay.action, 'parked-projection-failed',
  'CS1-PROJECTION-REPLAY park replay keeps the unresolved projection failure explicit');
eq(failedParkReplay.no_op, true,
  'CS1-PROJECTION-REPLAY failed park replay is a settled zero-write no-op');
eq(failedParkReplay.projection_error, 'metadata projection denied',
  'CS1-PROJECTION-REPLAY failed park replay preserves the exact projection error');
eq(failedParkReplay.reconcile, 'reconcile --card Failed',
  'CS1-PROJECTION-REPLAY failed park replay names the exact repair command');
eq(failedParkWrites, failedParkWritesBeforeReplay,
  'CS1-PROJECTION-REPLAY failed park replay performs zero ledger writes');
eq(JSON.stringify(failedParkState), failedParkBytes,
  'CS1-PROJECTION-REPLAY failed park replay preserves authoritative state byte-for-byte');
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Failed' }, {
  ...parkDeps, readState: () => failedParkState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses a parked card with unresolved metadata projection failure');

const malformedResumeState = emptyState();
malformedResumeState.cards.Malformed = { card: 'Malformed', phase: 'parked', dependencies: [], resume_condition: 'later', card_path: parkCardPath };
const malformedBefore = JSON.stringify(malformedResumeState.cards.Malformed);
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Malformed' }, {
  ...parkDeps, readState: () => malformedResumeState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses missing dependency metadata');
eq(JSON.stringify(malformedResumeState.cards.Malformed), malformedBefore, 'missing-dependency refusal preserves the parked record');
const invalidDependencyState = emptyState();
invalidDependencyState.cards.Invalid = { card: 'Invalid', phase: 'parked', dependencies: [42], resume_condition: 'later', card_path: parkCardPath };
const invalidBefore = JSON.stringify(invalidDependencyState.cards.Invalid);
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Invalid' }, {
  ...parkDeps, readState: () => invalidDependencyState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses malformed dependency elements');
eq(JSON.stringify(invalidDependencyState.cards.Invalid), invalidBefore, 'malformed-dependency refusal preserves receipts and state');
const selfResumeState = emptyState();
selfResumeState.cards.Self = { card: 'Self', phase: 'parked', dependencies: ['Self'], resume_condition: 'later', card_path: parkCardPath };
const selfBefore = JSON.stringify(selfResumeState.cards.Self);
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Self' }, {
  ...parkDeps, readState: () => selfResumeState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses a saved self-dependency');
eq(JSON.stringify(selfResumeState.cards.Self), selfBefore, 'self-dependency refusal preserves receipts and state byte-for-byte');
const emptyConditionState = emptyState();
emptyConditionState.cards.Empty = { card: 'Empty', phase: 'parked', dependencies: ['Prerequisite A'], resume_condition: ' ', card_path: parkCardPath };
const emptyConditionBefore = JSON.stringify(emptyConditionState.cards.Empty);
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Empty' }, {
  ...parkDeps, readState: () => emptyConditionState, writeState: () => {},
})).action, 'resume-refused', 'resume refuses an empty saved resume condition');
eq(JSON.stringify(emptyConditionState.cards.Empty), emptyConditionBefore, 'empty-condition refusal preserves receipts and state byte-for-byte');
const missingResumeState = emptyState();
missingResumeState.cards.Missing = {
  card: 'Missing', phase: 'parked', dependencies: ['Vanished prerequisite'], resume_condition: 'later', card_path: parkCardPath,
};
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Missing' }, {
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
const resumeRace = await commandResume({ root: parkRoot }, { json: true, card: 'Target' }, {
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
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  worktreeExists: () => true,
})).action, 'resume-refused', 'resume refuses to create a fourth active card');
for (const name of ['Capacity 1', 'Capacity 2', 'Capacity 3']) delete parkState.cards[name];
parkState.cards.Overlap = { card: 'Overlap', phase: 'implementing', touch_zones: ['platform/park-me'] };
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  worktreeExists: () => true,
})).action, 'resume-refused', 'resume refuses an active touch-zone conflict');
delete parkState.cards.Overlap;
const preservedWorktree = parkState.cards['Park me'].worktree;
parkState.cards['Park me'].worktree = '/missing/parked-worktree';
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
  worktreeExists: () => false,
})).action, 'resume-refused', 'resume refuses a missing preserved parked worktree');
parkState.cards['Park me'].worktree = preservedWorktree;
parkState.cards.Sibling = {
  card: 'Sibling', phase: 'implementing', parent_card: 'Shared parent', touch_zones: ['platform/sibling'],
};
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
})).action, 'resume-refused', 'resume refuses a second active child of the normalized parent');
parkState.cards.Sibling.phase = 'parked';
parkState.cards['Prerequisite A'].vault_receipts.ero.ok = false;
eq((await commandResume({ root: parkRoot }, { json: true, card: 'Park me' }, {
  ...parkDeps, findCard: (_root, name) => ['Prerequisite A', 'Prerequisite B'].includes(name) ? `/cards/${name}.md` : null,
})).action, 'resume-refused', 'resume refuses a tracked prerequisite with a failed required-vault receipt');
parkState.cards['Prerequisite A'].vault_receipts.ero.ok = true;
const gitCalls = [];
const resumeLockStart = parkLocks.length;
opx2ParkResumeProjections.length = 0;
const resumed = await commandResume({ root: parkRoot }, { json: true, card: 'Park me' }, {
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
eq({ ok: resumed.ok, no_op: resumed.no_op }, { ok: true, no_op: false },
  'resume adds the success envelope without removing legacy receipt keys');
eq(opx2ParkResumeProjections, ['resume'],
  'OPX2-TRANSITION-ONLY resume transition fires exactly one Loop Station projection');
eq(resumed.origin_main_advanced, true, 'resume reports that origin/main advanced');
eq(resumed.requires_main_update, true, 'resume reports that the branch needs a manual update');
ok(!gitCalls.some((call) => ['merge', 'rebase', 'push'].includes(call[1])), 'resume never merges, rebases, or pushes automatically');
eq(parkLocks.slice(resumeLockStart), [
  'selector', legacyCardGateLockName('Park me'), cardGateLockName('Park me'), 'completion-projection',
], 'resume serializes selector, migration-compatible card, exact-card, and projection transitions in one lock order');
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
const resumedStateBytes = JSON.stringify(parkState);
const resumedCardBytes = fs.readFileSync(parkCardPath, 'utf8');
const writesBeforeResumeReplay = parkWrites;
const projectionsBeforeResumeReplay = opx2ParkResumeProjections.length;
const parkResumeReplay = await commandResume({ root: parkRoot }, { json: true, card: 'Park me' }, {
  ...parkDeps,
  sh: () => { throw new Error('literal resume replay must not inspect Git'); },
  writeState: () => { parkWrites++; },
  projectCard: () => { throw new Error('literal resume replay must not project card metadata'); },
  projectLoopStation: () => { throw new Error('literal resume replay must not project Loop Station'); },
});
eq(parkResumeReplay.no_op, true, 'CS1-REPLAY-NOOP literal resume replay returns no_op:true');
eq({
  origin_main_advanced: parkResumeReplay.origin_main_advanced,
  requires_main_update: parkResumeReplay.requires_main_update,
}, {
  origin_main_advanced: resumed.origin_main_advanced,
  requires_main_update: resumed.requires_main_update,
}, 'CS1-REPLAY-NOOP literal resume replay preserves the legacy freshness fields');
eq(JSON.stringify(parkState), resumedStateBytes,
  'CS1-REPLAY-NOOP literal resume replay preserves authoritative state byte-for-byte');
eq(fs.readFileSync(parkCardPath, 'utf8'), resumedCardBytes,
  'CS1-REPLAY-NOOP literal resume replay preserves projected card bytes');
eq(parkWrites, writesBeforeResumeReplay, 'CS1-REPLAY-NOOP literal resume replay performs zero ledger writes');
eq(opx2ParkResumeProjections.length, projectionsBeforeResumeReplay,
  'CS1-REPLAY-NOOP literal resume replay performs zero Loop Station writes');

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
eq(reconcileLocks.slice(0, 3), [
  legacyCardGateLockName('Tracked deployed'), cardGateLockName('Tracked deployed'), 'completion-projection',
], 'reconciliation serializes migration-compatible and exact-card state before shared board projection');
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

// GA-OPS12-BLOCKED-RELEASE-RECEIPTS: exact-token, release, tap, brew, and vault proof.
const RECOVERY_HEAD = 'c'.repeat(40);
const FEATURE_MERGE = 'd'.repeat(40);
const RELEASE_MERGE = 'e'.repeat(40);
const TAP_MERGE = 'f'.repeat(40);
const recoveryRecord = {
  card: 'Stranded shipped card', phase: 'blocked', batch_policy: 'supervised_only',
  feature_pr: 570, release_pr: 571, feature_merge_sha: FEATURE_MERGE,
  deploy_subscriptions: { headspace: [], accuris: [], ero: [] },
};
const featurePr = {
  number: 570, state: 'MERGED', url: 'https://example.test/feature/570',
  headRefOid: RECOVERY_HEAD, mergeCommit: { oid: FEATURE_MERGE },
};
const releasePr = {
  number: 571, state: 'MERGED', url: 'https://example.test/release/571',
  mergeCommit: { oid: RELEASE_MERGE },
};
const recoveryCollectorDeps = {
  prView: (_repo, number) => number === 570 ? featurePr : releasePr,
  releaseContainsCommit: () => true,
  currentTapFormulaTag: () => 'v0.245.0',
  tagContainsCommit: () => true,
  tapPr: () => ({ number: 91, state: 'MERGED', url: 'https://example.test/tap/91', mergeCommit: { oid: TAP_MERGE } }),
  bottleVersion: () => '0.245.0',
  vaultLedgerProof: (vault, version) => ({ vault: vault.id, ok: true, installed_version: version }),
  now: () => '2026-07-20T19:00:00.000Z',
};
const collectedRecovery = collectDeployedRecoveryEvidence({ root: tmp }, recoveryRecord, RECOVERY_HEAD, recoveryCollectorDeps);
eq(collectedRecovery.feature_pr.head_sha, RECOVERY_HEAD, 'GA-OPS12 recovery binds the complete exact feature HEAD token');
eq(collectedRecovery.tag, 'v0.245.0', 'GA-OPS12 recovery binds the exact tap formula tag');
eq(Object.keys(collectedRecovery.vault_receipts), ['headspace', 'accuris', 'ero'], 'GA-OPS12 recovery collects three read-only vault ledger proofs');
eq(formulaTagFromText('url "https://github.com/willfell/sauce/archive/refs/tags/v0.245.0.tar.gz"'), 'v0.245.0', 'tap parser accepts one exact release tag URL');
eq(formulaTagFromText('url "https://attacker.invalid/archive/refs/tags/v0.245.0.tar.gz"'), '', 'tap parser refuses an unrelated archive domain');
eq(formulaTagFromText('url "https://github.com/willfell/sauce/releases/download/source.tar.gz"\n# url "https://github.com/willfell/sauce/archive/refs/tags/v0.245.0.tar.gz"'), '', 'tap parser refuses a Sauce tag URL that exists only in a comment');
eq(formulaTagFromText('homepage "https://github.com/willfell/sauce/archive/refs/tags/v0.245.0.tar.gz"'), '', 'tap parser requires the active Homebrew url directive');
eq(formulaTagFromText('url "https://github.com/willfell/sauce/archive/refs/tags/v0.245.0.tar.gz"\nurl "https://github.com/willfell/sauce/archive/refs/tags/v0.244.2.tar.gz"'), '', 'tap parser refuses multiple active Sauce tag directives');
const formulaFor = (tag) => `url "https://github.com/willfell/sauce/archive/refs/tags/${tag}.tar.gz"`;
eq(formulaTagFromText(`${formulaFor('v0.245.0')} # bottle source\r\n`), 'v0.245.0', 'tap parser accepts an active inline-commented Sauce URL in CRLF formula text');
const blockCommentedFormula = `=begin\n${formulaFor('v0.245.0')}\n=end`;
eq(formulaTagFromText(blockCommentedFormula), '', 'Ruby block-commented Sauce URL is inactive');
eq(formulaTagFromText(`${blockCommentedFormula}\n${formulaFor('v0.245.0')}`), 'v0.245.0', 'active Sauce URL after a closed Ruby block comment is accepted');
eq(formulaTagFromText(`=begin\n${formulaFor('v0.244.2')}\n=end\n${formulaFor('v0.245.0')}`), 'v0.245.0', 'stale Ruby block-commented tag does not create active ambiguity');
eq(formulaTagFromText(`=begin\n${formulaFor('v0.245.0')}`), '', 'unterminated Ruby block comment suppresses its Sauce URL');
eq(currentTapFormulaTag(tmp, () => blockCommentedFormula), '', 'matching block-comment-only tap and installed formulas do not prove active evidence');
eq(currentTapFormulaTag(tmp, (file) => file.includes('/Library/Taps/') ? formulaFor('v0.245.0') : formulaFor('v0.245.0')),
  'v0.245.0', 'tap proof accepts matching active tap and installed formula tags');
eq(currentTapFormulaTag(tmp, (file) => file.includes('/Library/Taps/') ? formulaFor('v0.245.0') : formulaFor('v0.244.2')),
  '', 'tap proof refuses stale disagreement between active tap and installed formulas');
const tagAncestryCommands = [];
ok(tagContainsCommit(tmp, 'v0.245.0', FEATURE_MERGE, (command, args, opts) => {
  tagAncestryCommands.push([command, args, opts.cwd]);
  return '';
}), 'tag ancestry helper accepts only after exact Git proof');
eq(tagAncestryCommands, [
  ['git', ['fetch', 'origin', 'main', '--tags', '--quiet'], tmp],
  ['git', ['merge-base', '--is-ancestor', FEATURE_MERGE, 'v0.245.0'], tmp],
], 'tag ancestry helper executes exact fetch and tokenized ancestor query');
eq(tagContainsCommit(tmp, 'v0.245.0-extra', FEATURE_MERGE, () => { throw new Error('must not run'); }), false,
  'tag ancestry helper rejects a decorated tag before Git');
eq(tagContainsCommit(tmp, 'v0.245.0', `prefix-${FEATURE_MERGE}`, () => { throw new Error('must not run'); }), false,
  'tag ancestry helper rejects a decorated commit before Git');
let tagAncestryFailureCalls = 0;
eq(tagContainsCommit(tmp, 'v0.245.0', FEATURE_MERGE, () => {
  tagAncestryFailureCalls++;
  if (tagAncestryFailureCalls === 2) throw new Error('not ancestor');
  return '';
}), false, 'tag ancestry helper fails closed when exact merge-base proof fails');
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, prView: (_repo, number) => number === 570 ? { ...featurePr, state: 'OPEN' } : releasePr },
), /feature PR is not merged/, 'unmerged feature PR refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, prView: (_repo, number) => number === 570 ? { ...featurePr, mergeCommit: null } : releasePr },
), /feature PR has no exact merge commit/, 'feature PR without an exact merge SHA refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, prView: (_repo, number) => number === 570 ? { ...featurePr, headRefOid: `0${RECOVERY_HEAD.slice(1)}` } : releasePr },
), /feature PR head is not the exact expected/, 'wrong exact feature HEAD refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, { ...recoveryRecord, feature_merge_sha: 'a'.repeat(40) }, RECOVERY_HEAD, recoveryCollectorDeps,
), /feature merge commit differs from preserved ledger evidence/, 'feature merge SHA differing from preserved ledger evidence refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, prView: (_repo, number) => number === 570 ? featurePr : { ...releasePr, state: 'OPEN' } },
), /containing release PR is not merged/, 'unmerged containing release PR refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, prView: (_repo, number) => number === 570 ? featurePr : { ...releasePr, mergeCommit: null } },
), /release PR has no exact merge commit/, 'release PR without an exact merge SHA refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD, { ...recoveryCollectorDeps, tagContainsCommit: () => false },
), /does not contain feature merge/, 'missing tag ancestry refuses recovery'); count++;
const ancestryCalls = [];
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD, {
    ...recoveryCollectorDeps,
    tagContainsCommit: (_root, _tag, commit) => {
      ancestryCalls.push(commit);
      return commit === FEATURE_MERGE;
    },
  },
), /does not contain release merge/, 'formula tag must contain the exact release merge independently of feature ancestry'); count++;
eq(ancestryCalls, [FEATURE_MERGE, RELEASE_MERGE], 'release-tag fixture proves both independent ancestry edges are evaluated in order');
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD, { ...recoveryCollectorDeps, releaseContainsCommit: () => false },
), /release PR does not contain/, 'unrelated merged release PR refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD, { ...recoveryCollectorDeps, currentTapFormulaTag: () => '' },
), /tap formula must contain exactly one/, 'missing or ambiguous active Sauce formula tag refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD, { ...recoveryCollectorDeps, tapPr: () => null },
), /tap PR.*not merged/, 'missing tap receipt refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, tapPr: () => ({ number: 91, state: 'OPEN', url: 'https://example.test/tap/91', mergeCommit: { oid: TAP_MERGE } }) },
), /tap PR.*not merged/, 'unmerged tap PR refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, tapPr: () => ({ number: 91, state: 'MERGED', url: 'https://example.test/tap/91', mergeCommit: null }) },
), /tap PR.*no exact merge commit/, 'tap PR without an exact merge SHA refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD, { ...recoveryCollectorDeps, bottleVersion: () => '0.244.2' },
), /installed brew.*is older/, 'older installed Homebrew version refuses recovery'); count++;
const installedAncestryCalls = [];
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD, {
    ...recoveryCollectorDeps,
    tagContainsCommit: (_root, tag, commit) => {
      installedAncestryCalls.push([tag, commit]);
      return installedAncestryCalls.length < 3;
    },
  },
), /installed brew.*does not contain feature merge/, 'installed Homebrew tag must independently contain the feature merge'); count++;
eq(installedAncestryCalls, [
  ['v0.245.0', FEATURE_MERGE],
  ['v0.245.0', RELEASE_MERGE],
  ['v0.245.0', FEATURE_MERGE],
], 'Homebrew ancestry fixture reaches the independent installed-tag edge after both formula-tag edges');
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, recoveryRecord, RECOVERY_HEAD,
  { ...recoveryCollectorDeps, vaultLedgerProof: (vault, version) => ({ vault: vault.id, ok: vault.id !== 'ero', installed_version: version }) },
), /three-vault ledgers/, 'one missing vault proof refuses recovery'); count++;
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, { ...recoveryRecord, deploy_subscriptions: { headspace: ['mechanism:x'], accuris: [], ero: [] } },
  RECOVERY_HEAD, recoveryCollectorDeps,
), /non-empty deployment additions require existing green three-vault receipts/, 'subscription additions require prior green deployment receipts'); count++;
const behindSubscriptionReceipts = Object.fromEntries(['headspace', 'accuris', 'ero'].map((vault) => [vault, {
  vault, ok: true, installed_version: vault === 'ero' ? '0.244.2' : '0.245.0',
}]));
assert.throws(() => collectDeployedRecoveryEvidence(
  { root: tmp }, {
    ...recoveryRecord,
    deploy_subscriptions: { headspace: ['mechanism:x'], accuris: [], ero: [] },
    vault_receipts: behindSubscriptionReceipts,
  }, RECOVERY_HEAD, recoveryCollectorDeps,
), /non-empty deployment additions require existing green three-vault receipts/, 'subscription recovery refuses a green receipt behind the recovered version'); count++;

// GA-OPS12-RECOVERY-IDEMPOTENCE: dry-run, apply, projection, and literal replay.
const recoveryCardPath = path.join(reconcileRoot, 'Stranded shipped card.md');
const recoveryBoardPath = path.join(reconcileRoot, 'recovery-board.md');
fs.writeFileSync(recoveryCardPath, '---\nkanban_column: Blocked\nstatus: blocked\n---\nPreserved body\n');
fs.writeFileSync(recoveryBoardPath, liveBoard({ blocked: [['ignored', 'Stranded shipped card']].map((row) => row[1]) }));
const recoveryState = emptyState();
recoveryState.cards['Stranded shipped card'] = {
  ...recoveryRecord, card_path: recoveryCardPath, branch: 'preserved-branch', worktree: '/preserved-worktree',
  gate_receipt: { status: 'pass', head_sha: RECOVERY_HEAD },
  reviews: Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [lens, { lens, verdict: 'pass', head_sha: RECOVERY_HEAD }])),
};
let recoveryWrites = 0;
const recoveryLocks = [];
const opx2RecoveryProjections = [];
const recoveryDeps = {
  readState: () => recoveryState,
  writeState: () => { recoveryWrites++; },
  withLock: async (_ctx, name, fn) => { recoveryLocks.push(name); return fn(); },
  collectDeployedRecoveryEvidence: () => deepCopy(collectedRecovery),
  boardPath: recoveryBoardPath,
  cardsRoot: reconcileRoot,
  now: () => '2026-07-20T19:01:00.000Z',
  projectLoopStation: (_ctx, _state, updatedOn) => {
    opx2RecoveryProjections.push(updatedOn);
    return { action: 'loop-station-projected', no_op: false, updated_on: updatedOn };
  },
};
const recoveryArgs = { card: 'Stranded shipped card', 'expected-head': RECOVERY_HEAD, reason: 'receipts prove shipped code', 'dry-run': true };
const recoveryBefore = deepCopy(recoveryState.cards['Stranded shipped card']);
const mismatchedGateHead = deepCopy(recoveryBefore);
mismatchedGateHead.gate_receipt.head_sha = 'a'.repeat(40);
await assert.rejects(() => commandRecoverDeployed(
  { root: reconcileRoot }, recoveryArgs,
  { ...recoveryDeps, readState: () => ({ ...emptyState(), cards: { [recoveryBefore.card]: mismatchedGateHead } }) },
), /does not match preserved gate receipt/, 'valid but different preserved gate HEAD refuses recovery'); count++;
const failedGateReceipt = deepCopy(recoveryBefore);
failedGateReceipt.gate_receipt.status = 'fail';
await assert.rejects(() => commandRecoverDeployed(
  { root: reconcileRoot }, recoveryArgs,
  { ...recoveryDeps, readState: () => ({ ...emptyState(), cards: { [recoveryBefore.card]: failedGateReceipt } }) },
), /gate receipt did not pass/, 'matching preserved gate HEAD still requires a passing gate receipt'); count++;
for (const lens of ['correctness', 'regression-risk', 'test-adequacy']) {
  const mismatchedReviewHead = deepCopy(recoveryBefore);
  mismatchedReviewHead.reviews[lens].head_sha = 'b'.repeat(40);
  await assert.rejects(() => commandRecoverDeployed(
    { root: reconcileRoot }, recoveryArgs,
    { ...recoveryDeps, readState: () => ({ ...emptyState(), cards: { [recoveryBefore.card]: mismatchedReviewHead } }) },
  ), new RegExp(`preserved ${lens} review`), `valid but different preserved ${lens} review HEAD refuses recovery`); count++;
}
const refutedReviewReceipt = deepCopy(recoveryBefore);
refutedReviewReceipt.reviews.correctness.verdict = 'refute';
await assert.rejects(() => commandRecoverDeployed(
  { root: reconcileRoot }, recoveryArgs,
  { ...recoveryDeps, readState: () => ({ ...emptyState(), cards: { [recoveryBefore.card]: refutedReviewReceipt } }) },
), /preserved correctness review/, 'matching review HEAD still requires a passing verdict'); count++;
eq(recoveryWrites, 0, 'preserved exact-head receipt refusals perform no ledger write');
const recoveryDryRun = await commandRecoverDeployed({ root: reconcileRoot }, recoveryArgs, recoveryDeps);
eq(recoveryDryRun.action, 'recover-deployed-plan', 'receipt-bound recovery is dry-run first');
eq(recoveryLocks.slice(-2), [
  legacyCardGateLockName('Stranded shipped card'), cardGateLockName('Stranded shipped card'),
], 'ES4-PER-CARD-LOCK-PATH-COVERAGE-INCOMPLETE proves recover-deployed acquires migration-compatible and exact card gates');
eq(recoveryState.cards['Stranded shipped card'], recoveryBefore, 'recovery dry-run leaves the ledger byte-equivalent');
const recovered = await commandRecoverDeployed({ root: reconcileRoot }, { ...recoveryArgs, 'dry-run': false, apply: true }, recoveryDeps);
eq(recovered.action, 'recovered-deployed', 'verified recovery reaches authoritative deployed');
eq(opx2RecoveryProjections, ['recover'],
  'OPX2-TRANSITION-ONLY recover-deployed apply fires exactly one Loop Station projection');
eq(recoveryState.cards['Stranded shipped card'].phase, 'deployed', 'recovery changes the terminal phase only after every proof passes');
eq(recoveryState.cards['Stranded shipped card'].branch, 'preserved-branch', 'recovery preserves the branch');
eq(recoveryState.cards['Stranded shipped card'].worktree, '/preserved-worktree', 'recovery preserves the worktree');
eq(recoveryState.cards['Stranded shipped card'].gate_receipt, recoveryBefore.gate_receipt, 'recovery preserves the exact gate receipt');
eq(recoveryState.cards['Stranded shipped card'].reviews, recoveryBefore.reviews, 'recovery preserves all exact-head reviews');
eq(recoveryState.cards['Stranded shipped card'].deployed_recoveries.length, 1, 'recovery journals exactly one receipt-bound transition');
ok(/kanban_column: Completed/.test(fs.readFileSync(recoveryCardPath, 'utf8')), 'recovery projects completed card metadata');
ok(/## Completed[\s\S]*\[x\] \[\[Stranded shipped card\]\]/.test(fs.readFileSync(recoveryBoardPath, 'utf8')), 'recovery projects a checked Completed board entry');
const recoveryWritesAfterApply = recoveryWrites;
const replayedRecovery = await commandRecoverDeployed({ root: reconcileRoot }, { ...recoveryArgs, 'dry-run': false, apply: true }, recoveryDeps);
eq(replayedRecovery.no_op, true, 'literal receipt-bound recovery replay returns no_op true');
eq(recoveryWrites, recoveryWritesAfterApply, 'literal recovery replay performs no ledger write');
eq(recoveryState.cards['Stranded shipped card'].deployed_recoveries.length, 1, 'literal recovery replay never duplicates its audit');
eq(opx2RecoveryProjections, ['recover'],
  'OPX2-TRANSITION-ONLY recover-deployed replay fires no additional Loop Station projection');
await assert.rejects(() => commandRecoverDeployed(
  { root: reconcileRoot }, { ...recoveryArgs, 'expected-head': `prefix-${RECOVERY_HEAD}` },
  { ...recoveryDeps, readState: () => ({ ...emptyState(), cards: { [recoveryBefore.card]: deepCopy(recoveryBefore) } }) },
), /exact lowercase 40-hex SHA token/, 'substring or decorated HEAD refuses before external proof'); count++;
const parkedRecoveryRefusal = deepCopy(recoveryBefore); parkedRecoveryRefusal.phase = 'parked';
const parkedRecoveryRefusalState = { ...emptyState(), cards: { [parkedRecoveryRefusal.card]: parkedRecoveryRefusal } };
await assert.rejects(() => commandRecoverDeployed(
  { root: reconcileRoot }, recoveryArgs, { ...recoveryDeps, readState: () => parkedRecoveryRefusalState },
), /parked and pre-PR cards are never recovery targets/, 'parked recovery is unconditionally refused'); count++;

// GA-OPS12-METADATA-ONLY-RECONCILE: card-only CAS, audit, and exact replay.
const metadataCardPath = path.join(reconcileRoot, 'Metadata drift.md');
const currentMetadataRaw = card({ name: 'Metadata drift', profile: 'heavy', zones: ['platform/meta'] })
  .replace('---\n', '---\nkanban_column: Completed\n')
  .replace('status: planning', 'status: completed');
const currentMetadata = prepareDeliveryCard(currentMetadataRaw, 'Metadata drift').card;
const historicalMetadataRaw = currentMetadataRaw.replace(`schema_version: ${delivery.CONTRACT_VERSION}`, 'schema_version: 1.0.0');
fs.writeFileSync(metadataCardPath, historicalMetadataRaw);
const metadataState = emptyState();
metadataState.cards['Metadata drift'] = {
  card: 'Metadata drift', phase: 'deployed', card_path: metadataCardPath,
  delivery_contract: currentMetadata, delivery_contract_version: delivery.CONTRACT_VERSION,
  dependencies: currentMetadata.depends_on, touch_zones: currentMetadata.touch_zones,
  deploy_subscriptions: currentMetadata.deploy_subscriptions, batch_policy: currentMetadata.batch_policy,
  branch: 'untouched-metadata-branch', worktree: '/untouched-metadata-worktree',
};
let metadataWrites = 0;
let metadataCardWrites = 0;
const metadataLocks = [];
const metadataDeps = {
  readState: () => metadataState, writeState: () => { metadataWrites++; },
  withLock: async (_ctx, name, fn) => { metadataLocks.push(name); return fn(); },
  atomicWriteText: (file, raw) => { metadataCardWrites++; fs.writeFileSync(file, raw); },
  durablePathBarrier: () => {},
  cardsRoot: reconcileRoot, now: () => '2026-07-20T19:02:00.000Z',
};
const metadataDryRun = await commandReconcileMetadata({ root: reconcileRoot }, { card: 'Metadata drift', 'dry-run': true }, metadataDeps);
eq(metadataDryRun.changed_fields, ['schema_version'], 'metadata dry-run scopes repair to the one ledger-owned scalar');
eq(metadataLocks.slice(-2), [
  legacyCardGateLockName('Metadata drift'), cardGateLockName('Metadata drift'),
], 'ES4-PER-CARD-LOCK-PATH-COVERAGE-INCOMPLETE proves reconcile-metadata acquires migration-compatible and exact card gates');
eq(fs.readFileSync(metadataCardPath, 'utf8'), historicalMetadataRaw, 'metadata dry-run performs no card write');
const metadataApplyArgs = {
  card: 'Metadata drift', apply: true, reason: 'repair exact ledger-owned schema metadata',
  'expected-card-sha256': metadataDryRun.card_sha256,
  json: true,
};
const metadataApplied = await commandReconcileMetadata({ root: reconcileRoot }, metadataApplyArgs, metadataDeps);
eq(metadataApplied.action, 'reconciled-metadata', 'bounded metadata apply succeeds');
eq(metadataApplied.no_op, false, 'first metadata apply records a real change');
eq(fs.readFileSync(metadataCardPath, 'utf8'), historicalMetadataRaw.replace('schema_version: 1.0.0', `schema_version: "${delivery.CONTRACT_VERSION}"`), 'metadata apply changes only schema_version bytes');
eq(metadataState.cards['Metadata drift'].branch, 'untouched-metadata-branch', 'metadata reconcile preserves branch authority');
eq(metadataState.cards['Metadata drift'].worktree, '/untouched-metadata-worktree', 'metadata reconcile preserves worktree authority');
eq(metadataState.cards['Metadata drift'].metadata_reconciliations.length, 1, 'metadata reconcile journals one bounded audit');
eq(metadataWrites, 2, 'metadata apply persists one write-ahead intent and one completed audit');
eq(metadataCardWrites, 1, 'metadata apply performs exactly one bounded card write');
const metadataWritesAfterApply = metadataWrites;
const metadataCardWritesAfterApply = metadataCardWrites;
const metadataTimestampAfterApply = metadataState.cards['Metadata drift'].projection_reconciled_at;
const metadataReplay = await commandReconcileMetadata({ root: reconcileRoot }, metadataApplyArgs, metadataDeps);
eq(metadataReplay.no_op, true, 'literal metadata replay preserves the original dry-run CAS operand and returns no_op true');
eq(metadataWrites, metadataWritesAfterApply, 'literal metadata replay performs no ledger write');
eq(metadataCardWrites, metadataCardWritesAfterApply, 'literal metadata replay performs no card write');
eq(metadataState.cards['Metadata drift'].projection_reconciled_at, metadataTimestampAfterApply, 'literal metadata replay performs no timestamp write');
eq(metadataState.cards['Metadata drift'].metadata_reconciliations.length, 1, 'literal metadata replay never duplicates its audit');
await assert.rejects(() => commandReconcileMetadata({ root: reconcileRoot }, {
  ...metadataApplyArgs, reason: 'changed replay reason',
}, metadataDeps), /exact --expected-card-sha256 from its dry-run/, 'changed replay reason fails closed even with the original CAS operand'); count++;
await assert.rejects(() => commandReconcileMetadata({ root: reconcileRoot }, {
  ...metadataApplyArgs, 'expected-card-sha256': metadataApplied.next_sha256,
}, metadataDeps), /only a literal replay/, 'substituting the post-apply hash fails closed instead of masquerading as replay'); count++;
await assert.rejects(() => commandReconcileMetadata({ root: reconcileRoot }, {
  ...metadataApplyArgs, json: false,
}, metadataDeps), /exact --expected-card-sha256 from its dry-run/, 'removing the successful request json operand fails closed'); count++;
await assert.rejects(() => commandReconcileMetadata({ root: reconcileRoot }, {
  ...metadataApplyArgs, reason: ` ${metadataApplyArgs.reason}`,
}, metadataDeps), /exact --expected-card-sha256 from its dry-run/, 'even normalization-equivalent reason whitespace is not accepted as literal replay'); count++;
await assert.rejects(() => commandReconcileMetadata({ root: reconcileRoot }, {
  ...metadataApplyArgs, card: '[[Metadata drift]]',
}, metadataDeps), /exact --expected-card-sha256 from its dry-run/, 'normalization-equivalent card syntax is not accepted as literal replay'); count++;
eq(metadataWrites, metadataWritesAfterApply, 'altered replay attempts perform no ledger write');
eq(metadataCardWrites, metadataCardWritesAfterApply, 'altered replay attempts perform no card write');
const parkedMetadataState = { ...emptyState(), cards: { 'Metadata drift': { ...metadataState.cards['Metadata drift'], phase: 'parked' } } };
await assert.rejects(() => commandReconcileMetadata(
  { root: reconcileRoot }, { card: 'Metadata drift', 'dry-run': true }, { ...metadataDeps, readState: () => parkedMetadataState },
), /active and parked cards are out of scope/, 'metadata reconciliation refuses parked cards'); count++;
const activeMetadataState = { ...emptyState(), cards: { 'Metadata drift': { ...metadataState.cards['Metadata drift'], phase: 'implementing' } } };
await assert.rejects(() => commandReconcileMetadata(
  { root: reconcileRoot }, { card: 'Metadata drift', 'dry-run': true }, { ...metadataDeps, readState: () => activeMetadataState },
), /active and parked cards are out of scope/, 'GA-OPS12A2-METADATA-ACTIVE-PHASE-SCOPE-MUTATION-SURVIVES refuses an active implementing card independently of parked refusal'); count++;
const unsupportedMetadata = historicalMetadataRaw.replace('model_profile: heavy', 'model_profile: standard');
assert.throws(() => metadataReconciliationPlan(metadataState.cards['Metadata drift'], unsupportedMetadata),
  /without widening scope/, 'metadata-only operation refuses unsupported contract drift'); count++;
const savedProjectionErrorRecord = {
  ...deepCopy(metadataState.cards['Metadata drift']),
  projection_error: 'prior projection write denied',
  projection_failed_at: '2026-07-20T18:59:00.000Z',
  metadata_reconciliations: [],
};
const savedProjectionErrorState = { ...emptyState(), cards: { 'Metadata drift': savedProjectionErrorRecord } };
let savedProjectionErrorWrites = 0;
let savedProjectionErrorCardWrites = 0;
const savedProjectionErrorDeps = {
  ...metadataDeps,
  readState: () => savedProjectionErrorState,
  writeState: () => { savedProjectionErrorWrites++; },
  atomicWriteText: (file, raw) => { savedProjectionErrorCardWrites++; fs.writeFileSync(file, raw); },
};
fs.writeFileSync(metadataCardPath, unsupportedMetadata);
await assert.rejects(() => commandReconcileMetadata(
  { root: reconcileRoot }, { card: 'Metadata drift', 'dry-run': true }, savedProjectionErrorDeps,
), /without widening scope/, 'GA-OPS12A2 saved projection error cannot suppress unsupported stable-contract drift'); count++;
eq(savedProjectionErrorRecord.projection_error, 'prior projection write denied', 'refused metadata widening preserves the saved projection error');
eq(savedProjectionErrorWrites, 0, 'refused saved-error widening performs no ledger write');
eq(savedProjectionErrorCardWrites, 0, 'refused saved-error widening performs no card write');
fs.writeFileSync(metadataCardPath, historicalMetadataRaw);
const savedErrorDryRun = await commandReconcileMetadata(
  { root: reconcileRoot }, { card: 'Metadata drift', 'dry-run': true }, savedProjectionErrorDeps,
);
eq(savedErrorDryRun.changed_fields, ['schema_version'], 'saved projection error still permits a genuinely metadata-only repair plan');
const savedErrorApplied = await commandReconcileMetadata({ root: reconcileRoot }, {
  card: 'Metadata drift', apply: true, reason: 'repair supported drift behind saved projection error',
  'expected-card-sha256': savedErrorDryRun.card_sha256, json: true,
}, savedProjectionErrorDeps);
eq(savedErrorApplied.no_op, false, 'supported metadata-only repair applies behind a saved projection error');
eq(savedProjectionErrorRecord.projection_error, undefined, 'only the supported metadata repair clears the saved projection error');
eq(savedProjectionErrorWrites, 2, 'supported saved-error repair persists intent then completion');
eq(savedProjectionErrorCardWrites, 1, 'supported saved-error repair performs one card write');

function metadataCrashHarness(id) {
  const name = 'Metadata drift';
  const cardPath = path.join(reconcileRoot, `Metadata transaction ${id}.md`);
  const statePath = path.join(reconcileRoot, `Metadata transaction ${id}.state.json`);
  fs.writeFileSync(cardPath, historicalMetadataRaw);
  const record = {
    ...deepCopy(metadataState.cards['Metadata drift']), card: name, card_path: cardPath,
    metadata_reconciliations: [],
  };
  delete record.metadata_reconciliation_pending;
  let durableState = { ...emptyState(), cards: { [name]: record } };
  let ledgerWrites = 0;
  let cardWrites = 0;
  let barrierCalls = 0;
  const barrierTargets = [];
  let ledgerFailure = null;
  let cardFailure = null;
  let barrierFailure = null;
  let replacement = null;
  const deps = {
    readState: () => deepCopy(durableState),
    writeState: (_ctx, _state, changedRecord) => {
      ledgerWrites++;
      const failure = ledgerFailure && ledgerFailure.call === ledgerWrites ? ledgerFailure : null;
      if (failure && failure.when === 'before') throw new Error(failure.message);
      durableState.cards[changedRecord.card] = deepCopy(changedRecord);
      if (failure && failure.when === 'after') throw new Error(failure.message);
    },
    withLock: immediateCardLock,
    atomicWriteText: (file, raw) => {
      cardWrites++;
      const failure = cardFailure && cardFailure.call === cardWrites ? cardFailure : null;
      if (failure && failure.when === 'before') throw new Error(failure.message);
      fs.writeFileSync(file, replacement === null ? raw : replacement(raw));
      if (failure && failure.when === 'after') throw new Error(failure.message);
    },
    durablePathBarrier: (target) => {
      barrierCalls++;
      barrierTargets.push(target);
      if (barrierFailure && barrierFailure.call === barrierCalls) throw new Error(barrierFailure.message);
    },
    cardsRoot: reconcileRoot,
    now: () => '2026-07-20T19:03:00.000Z',
  };
  const ctx = { root: reconcileRoot, statePath };
  const dryRun = () => commandReconcileMetadata(ctx, { card: name, 'dry-run': true }, deps);
  const applyArgs = (sha) => ({
    card: name, apply: true, reason: 'recover exact metadata transaction',
    'expected-card-sha256': sha, json: true,
  });
  return {
    name, cardPath, ctx, deps, dryRun, applyArgs,
    state: () => deepCopy(durableState),
    raw: () => fs.readFileSync(cardPath, 'utf8'),
    counts: () => ({ ledgerWrites, cardWrites, barrierCalls, barrierTargets: [...barrierTargets] }),
    failLedger: (call, when, message) => { ledgerFailure = { call, when, message }; },
    failCard: (call, when, message) => { cardFailure = { call, when, message }; },
    failBarrier: (call, message) => { barrierFailure = { call, message }; },
    clearFailures: () => { ledgerFailure = null; cardFailure = null; barrierFailure = null; replacement = null; },
    replaceWith: (fn) => { replacement = fn; },
  };
}

// GA-OPS12A2-METADATA-INTENT-BEFORE-CARD: no card write precedes durable intent.
const intentFailure = metadataCrashHarness('intent-before-card');
const intentFailurePlan = await intentFailure.dryRun();
const intentFailureArgs = intentFailure.applyArgs(intentFailurePlan.card_sha256);
intentFailure.failLedger(1, 'before', 'injected intent persist failure');
await assert.rejects(() => commandReconcileMetadata(intentFailure.ctx, intentFailureArgs, intentFailure.deps),
  /injected intent persist failure/, 'GA-OPS12A2-METADATA-INTENT-BEFORE-CARD propagates intent failure'); count++;
eq(intentFailure.raw(), historicalMetadataRaw, 'GA-OPS12A2-METADATA-INTENT-BEFORE-CARD preserves original card bytes');
eq(intentFailure.state().cards[intentFailure.name].metadata_reconciliation_pending, undefined, 'GA-OPS12A2-METADATA-INTENT-BEFORE-CARD records no false pending intent');
intentFailure.clearFailures();
eq((await commandReconcileMetadata(intentFailure.ctx, intentFailureArgs, intentFailure.deps)).no_op, false,
  'GA-OPS12A2-METADATA-INTENT-BEFORE-CARD literal retry completes normally');

// GA-OPS12A2-METADATA-CARD-WRITE-FAILURE-RECOVERY: prepared intent survives a failed rename/write.
const cardFailure = metadataCrashHarness('card-write-failure');
const cardFailurePlan = await cardFailure.dryRun();
const cardFailureArgs = cardFailure.applyArgs(cardFailurePlan.card_sha256);
cardFailure.failCard(1, 'before', 'injected atomic replacement failure');
await assert.rejects(() => commandReconcileMetadata(cardFailure.ctx, cardFailureArgs, cardFailure.deps),
  /injected atomic replacement failure/, 'GA-OPS12A2-METADATA-CARD-WRITE-FAILURE-RECOVERY propagates card failure'); count++;
ok(cardFailure.state().cards[cardFailure.name].metadata_reconciliation_pending, 'GA-OPS12A2-METADATA-CARD-WRITE-FAILURE-RECOVERY retains durable prepared intent');
eq(cardFailure.raw(), historicalMetadataRaw, 'GA-OPS12A2-METADATA-CARD-WRITE-FAILURE-RECOVERY retains original card');
cardFailure.clearFailures();
const cardFailureRecovered = await commandReconcileMetadata(cardFailure.ctx, cardFailureArgs, cardFailure.deps);
eq(cardFailureRecovered.recovered_pending, true, 'GA-OPS12A2-METADATA-CARD-WRITE-FAILURE-RECOVERY literal retry recovers pending transaction');
eq(cardFailure.state().cards[cardFailure.name].metadata_reconciliations.length, 1, 'GA-OPS12A2-METADATA-CARD-WRITE-FAILURE-RECOVERY finalizes exactly one audit');

// GA-OPS12A2-METADATA-CARD-BEFORE-AUDIT-RECOVERY and recovered literal replay.
const auditFailure = metadataCrashHarness('card-before-audit');
const auditFailurePlan = await auditFailure.dryRun();
const auditFailureArgs = auditFailure.applyArgs(auditFailurePlan.card_sha256);
auditFailure.failLedger(2, 'before', 'injected final audit persist failure');
await assert.rejects(() => commandReconcileMetadata(auditFailure.ctx, auditFailureArgs, auditFailure.deps),
  /injected final audit persist failure/, 'GA-OPS12A2-METADATA-CARD-BEFORE-AUDIT-RECOVERY exposes the exact crash window'); count++;
ok(auditFailure.state().cards[auditFailure.name].metadata_reconciliation_pending, 'GA-OPS12A2-METADATA-CARD-BEFORE-AUDIT-RECOVERY keeps prepared intent authoritative');
ok(auditFailure.raw() !== historicalMetadataRaw, 'GA-OPS12A2-METADATA-CARD-BEFORE-AUDIT-RECOVERY begins from already-replaced card bytes');
const auditFailureCardWrites = auditFailure.counts().cardWrites;
auditFailure.clearFailures();
const auditRecovered = await commandReconcileMetadata(auditFailure.ctx, auditFailureArgs, auditFailure.deps);
eq(auditRecovered.recovered_pending, true, 'GA-OPS12A2-METADATA-CARD-BEFORE-AUDIT-RECOVERY finalizes from next-card hash');
eq(auditFailure.counts().cardWrites, auditFailureCardWrites, 'GA-OPS12A2-METADATA-CARD-BEFORE-AUDIT-RECOVERY does not rewrite the already-correct card');
eq(auditFailure.state().cards[auditFailure.name].metadata_reconciliations.length, 1, 'GA-OPS12A2-METADATA-CARD-BEFORE-AUDIT-RECOVERY appends exactly one audit');
const recoveredCounts = auditFailure.counts();
const recoveredReplay = await commandReconcileMetadata(auditFailure.ctx, auditFailureArgs, auditFailure.deps);
eq(recoveredReplay.no_op, true, 'GA-OPS12A2-METADATA-RECOVERED-LITERAL-REPLAY returns literal no_op true');
eq(auditFailure.counts().ledgerWrites, recoveredCounts.ledgerWrites, 'GA-OPS12A2-METADATA-RECOVERED-LITERAL-REPLAY performs zero ledger writes');
eq(auditFailure.counts().cardWrites, recoveredCounts.cardWrites, 'GA-OPS12A2-METADATA-RECOVERED-LITERAL-REPLAY performs zero card writes');

// GA-OPS12A2-METADATA-FINAL-PERSIST-RETRY: ambiguous success is reread, never duplicated.
const ambiguousFinal = metadataCrashHarness('ambiguous-final-persist');
const ambiguousFinalPlan = await ambiguousFinal.dryRun();
const ambiguousFinalArgs = ambiguousFinal.applyArgs(ambiguousFinalPlan.card_sha256);
ambiguousFinal.failLedger(2, 'after', 'injected ambiguous final persist result');
await assert.rejects(() => commandReconcileMetadata(ambiguousFinal.ctx, ambiguousFinalArgs, ambiguousFinal.deps),
  /injected ambiguous final persist result/, 'GA-OPS12A2-METADATA-FINAL-PERSIST-RETRY propagates ambiguous persist result'); count++;
eq(ambiguousFinal.state().cards[ambiguousFinal.name].metadata_reconciliations.length, 1, 'GA-OPS12A2-METADATA-FINAL-PERSIST-RETRY observes already-durable single audit');
ambiguousFinal.clearFailures();
eq((await commandReconcileMetadata(ambiguousFinal.ctx, ambiguousFinalArgs, ambiguousFinal.deps)).no_op, true,
  'GA-OPS12A2-METADATA-FINAL-PERSIST-RETRY converges through literal replay');
eq(ambiguousFinal.state().cards[ambiguousFinal.name].metadata_reconciliations.length, 1, 'GA-OPS12A2-METADATA-FINAL-PERSIST-RETRY never duplicates audit');

// GA-OPS12A2-METADATA-PENDING-REQUEST-BINDING: every literal operand remains authority.
const requestBinding = metadataCrashHarness('pending-request-binding');
const requestBindingPlan = await requestBinding.dryRun();
const requestBindingArgs = requestBinding.applyArgs(requestBindingPlan.card_sha256);
requestBinding.failCard(1, 'before', 'prepare pending request fixture');
await assert.rejects(() => commandReconcileMetadata(requestBinding.ctx, requestBindingArgs, requestBinding.deps), /prepare pending request fixture/); count++;
requestBinding.clearFailures();
const requestBindingState = JSON.stringify(requestBinding.state());
const requestBindingRaw = requestBinding.raw();
for (const altered of [
  { ...requestBindingArgs, reason: ` ${requestBindingArgs.reason}` },
  { ...requestBindingArgs, 'expected-card-sha256': 'a'.repeat(64) },
  { ...requestBindingArgs, json: false },
  { ...requestBindingArgs, card: `[[${requestBinding.name}]]` },
  { card: requestBinding.name, 'dry-run': true },
]) {
  await assert.rejects(() => commandReconcileMetadata(requestBinding.ctx, altered, requestBinding.deps),
    /pending intent.*exact|pending intent requires/, 'GA-OPS12A2-METADATA-PENDING-REQUEST-BINDING refuses altered literal operand'); count++;
}
eq(JSON.stringify(requestBinding.state()), requestBindingState, 'GA-OPS12A2-METADATA-PENDING-REQUEST-BINDING leaves ledger byte-equivalent');
eq(requestBinding.raw(), requestBindingRaw, 'GA-OPS12A2-METADATA-PENDING-REQUEST-BINDING leaves card byte-equivalent');

// GA-OPS12A2-METADATA-PENDING-THIRD-HASH: external bytes never inherit the intent.
const thirdHash = metadataCrashHarness('pending-third-hash');
const thirdHashPlan = await thirdHash.dryRun();
const thirdHashArgs = thirdHash.applyArgs(thirdHashPlan.card_sha256);
thirdHash.failCard(1, 'before', 'prepare third-hash fixture');
await assert.rejects(() => commandReconcileMetadata(thirdHash.ctx, thirdHashArgs, thirdHash.deps), /prepare third-hash fixture/); count++;
thirdHash.clearFailures();
fs.writeFileSync(thirdHash.cardPath, `${thirdHash.raw()}operator drift\n`);
const thirdHashState = JSON.stringify(thirdHash.state());
const thirdHashCounts = thirdHash.counts();
await assert.rejects(() => commandReconcileMetadata(thirdHash.ctx, thirdHashArgs, thirdHash.deps),
  /third card hash; needs-inspection/, 'GA-OPS12A2-METADATA-PENDING-THIRD-HASH refuses unknown card bytes'); count++;
eq(JSON.stringify(thirdHash.state()), thirdHashState, 'GA-OPS12A2-METADATA-PENDING-THIRD-HASH retains intent unchanged');
eq(thirdHash.counts().ledgerWrites, thirdHashCounts.ledgerWrites, 'GA-OPS12A2-METADATA-PENDING-THIRD-HASH performs zero ledger writes');
eq(thirdHash.counts().cardWrites, thirdHashCounts.cardWrites, 'GA-OPS12A2-METADATA-PENDING-THIRD-HASH performs zero coordinator card writes');

// GA-OPS12A2-METADATA-DURABLE-BARRIERS: every uncertain boundary refuses completion and remains recoverable.
const stateBarrierFailure = metadataCrashHarness('state-barrier-failure');
const stateBarrierPlan = await stateBarrierFailure.dryRun();
const stateBarrierArgs = stateBarrierFailure.applyArgs(stateBarrierPlan.card_sha256);
stateBarrierFailure.failBarrier(1, 'injected ledger durability barrier failure');
await assert.rejects(() => commandReconcileMetadata(stateBarrierFailure.ctx, stateBarrierArgs, stateBarrierFailure.deps),
  /ledger durability barrier failure/, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS propagates ledger barrier failure'); count++;
ok(stateBarrierFailure.state().cards[stateBarrierFailure.name].metadata_reconciliation_pending, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS retains intent after state barrier uncertainty');
eq(stateBarrierFailure.raw(), historicalMetadataRaw, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS does not write card before state barrier');

const cardBarrierFailure = metadataCrashHarness('card-barrier-failure');
const cardBarrierPlan = await cardBarrierFailure.dryRun();
const cardBarrierArgs = cardBarrierFailure.applyArgs(cardBarrierPlan.card_sha256);
cardBarrierFailure.failBarrier(2, 'injected card durability barrier failure');
await assert.rejects(() => commandReconcileMetadata(cardBarrierFailure.ctx, cardBarrierArgs, cardBarrierFailure.deps),
  /card durability barrier failure/, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS propagates card barrier failure'); count++;
ok(cardBarrierFailure.state().cards[cardBarrierFailure.name].metadata_reconciliation_pending, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS leaves no false completed audit after card barrier failure');
const cardBarrierTargetsBeforeRetry = cardBarrierFailure.counts().barrierTargets.length;
cardBarrierFailure.clearFailures();
eq((await commandReconcileMetadata(cardBarrierFailure.ctx, cardBarrierArgs, cardBarrierFailure.deps)).recovered_pending, true,
  'GA-OPS12A2-METADATA-DURABLE-BARRIERS literal retry recovers ambiguous visible card replacement');
eq(cardBarrierFailure.counts().barrierTargets.slice(cardBarrierTargetsBeforeRetry), [cardBarrierFailure.cardPath, cardBarrierFailure.ctx.statePath],
  'GA-OPS12A2-METADATA-DURABLE-BARRIERS reestablishes card durability before final ledger durability');

const hashVerificationFailure = metadataCrashHarness('hash-verification-failure');
const hashVerificationPlan = await hashVerificationFailure.dryRun();
const hashVerificationArgs = hashVerificationFailure.applyArgs(hashVerificationPlan.card_sha256);
hashVerificationFailure.replaceWith((raw) => `${raw}corrupt replacement\n`);
await assert.rejects(() => commandReconcileMetadata(hashVerificationFailure.ctx, hashVerificationArgs, hashVerificationFailure.deps),
  /did not verify at the intended hash/, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS refuses reread hash mismatch'); count++;
ok(hashVerificationFailure.state().cards[hashVerificationFailure.name].metadata_reconciliation_pending, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS retains intent after reread mismatch');

const barrierProbePath = path.join(reconcileRoot, 'durable-barrier-probe');
fs.writeFileSync(barrierProbePath, 'probe');
const fileBarrierCloses = [];
assert.throws(() => durablePathBarrier(barrierProbePath, {
  openSync: () => 11,
  fsyncSync: () => { throw new Error('injected file fsync failure'); },
  closeSync: (fd) => { fileBarrierCloses.push(fd); },
}), /file fsync failure/, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS propagates file fsync failure'); count++;
eq(fileBarrierCloses, [11], 'GA-OPS12A2-METADATA-DURABLE-BARRIERS closes descriptor after file fsync failure');
const directoryBarrierTargets = [];
assert.throws(() => durablePathBarrier(barrierProbePath, {
  openSync: (target) => { directoryBarrierTargets.push(target); return directoryBarrierTargets.length; },
  fsyncSync: (fd) => { if (fd === 2) throw new Error('injected directory fsync failure'); },
  closeSync: () => {},
}), /directory fsync failure/, 'GA-OPS12A2-METADATA-DURABLE-BARRIERS propagates directory fsync failure'); count++;
eq(directoryBarrierTargets, [barrierProbePath, path.dirname(barrierProbePath)], 'GA-OPS12A2-METADATA-DURABLE-BARRIERS flushes file before containing directory');

const historicalLedgerRecord = {
  ...metadataState.cards['Metadata drift'],
  delivery_contract: { ...currentMetadata, schema_version: '1.0.0' },
  delivery_contract_version: '1.0.0',
};
eq(projectionMetadataProblem(historicalLedgerRecord, reconcileRoot), null, 'compatible historical schema migration no longer creates false metadata projection drift');
const historicalNoEvidenceRaw = historicalMetadataRaw.replace(/^evidence:.*\n/m, '');
const historicalNoEvidenceContract = { ...currentMetadata, schema_version: '1.0.0' };
delete historicalNoEvidenceContract.evidence;
fs.writeFileSync(metadataCardPath, historicalNoEvidenceRaw);
eq(projectionMetadataProblem({
  ...metadataState.cards['Metadata drift'],
  delivery_contract: historicalNoEvidenceContract,
  delivery_contract_version: '1.0.0',
}, reconcileRoot), null, 'historical cards may omit optional evidence without false metadata drift');

// GA-OPS20a: canonical structured fields restamp to Obsidian-safe text scalars.
function restampHarness(id = 'happy') {
  const root = path.join(reconcileRoot, `contract-frontmatter-restamp-${id}`);
  fs.mkdirSync(path.join(root, 'Nested Epic', 'board'), { recursive: true });
  const legacyNames = ['Legacy Restamp A', 'Legacy Restamp B'];
  const paths = legacyNames.map((name, index) => {
    const file = index === 0
      ? path.join(root, `${name}.md`)
      : path.join(root, 'Nested Epic', 'board', `${name}.md`);
    fs.writeFileSync(file, `${card({ name })}\nBODY-SENTINEL-${index}\n`);
    return file;
  });
  const alreadyName = 'Already Encoded';
  const alreadyPath = path.join(root, `${alreadyName}.md`);
  const alreadyLegacy = card({ name: alreadyName });
  const alreadyMeta = parseExecutionMeta(alreadyLegacy, alreadyName);
  const alreadyEncoded = alreadyLegacy
    .replace(
      'deploy_subscriptions:\n  headspace: []\n  accuris: []\n  ero: []',
      `deploy_subscriptions: ${delivery.encodeStructuredFrontmatterValue(alreadyMeta.deploySubscriptions)}`,
    )
    .replace(
      /^evidence:.*$/m,
      `evidence: ${delivery.encodeStructuredFrontmatterValue(alreadyMeta.contract.evidence)}`,
    );
  fs.writeFileSync(alreadyPath, alreadyEncoded);
  fs.writeFileSync(path.join(root, 'non-card.md'), '---\ntype: context-pack\n---\n\nUnrelated body.\n');
  let specRaw = '';
  let writes = 0;
  let failWrite = 0;
  const ctx = { root, stateDir: path.join(root, '.state'), statePath: path.join(root, '.state', 'state.json') };
  const reason = 'restamp canonical structured contract fields';
  const deps = {
    cardsRoot: root,
    withLock: async (_ctx, _name, fn) => fn(),
    readSpec: () => specRaw,
    atomicWriteText: (file, raw) => {
      writes += 1;
      if (failWrite && writes === failWrite) throw new Error('injected restamp write failure');
      fs.writeFileSync(file, raw);
    },
    durablePathBarrier: () => {},
  };
  const dryRunArgs = {
    _: ['reconcile-metadata'],
    'contract-frontmatter-restamp': true,
    'dry-run': true,
    reason,
    json: true,
  };
  const applyArgs = {
    _: ['reconcile-metadata'],
    'contract-frontmatter-restamp': true,
    apply: true,
    reason,
    spec: 'contract-frontmatter-restamp.json',
    json: true,
  };
  return {
    root, paths, alreadyPath, ctx, deps, reason, dryRunArgs, applyArgs,
    setSpec: (spec) => { specRaw = `${JSON.stringify(spec, null, 2)}\n`; },
    setSpecRaw: (raw) => { specRaw = raw; },
    writes: () => writes,
    failWrite: (attempt) => { failWrite = attempt; },
    clearFailure: () => { failWrite = 0; },
  };
}

function independentlyRestampedContractBytes(raw) {
  const legacyDeployments = [
    'deploy_subscriptions:',
    '  headspace: []',
    '  accuris: []',
    '  ero: []',
  ].join('\n');
  const evidenceMatch = raw.match(/^evidence: (.*)$/m);
  if (!raw.includes(legacyDeployments) || !evidenceMatch) {
    throw new Error('independent restamp oracle requires the exact legacy writer preimage');
  }
  const scalar = (value) => JSON.stringify(JSON.stringify(value));
  return raw
    .replace(legacyDeployments, `deploy_subscriptions: ${scalar({
      headspace: [], accuris: [], ero: [],
    })}`)
    .replace(/^evidence:.*$/m, `evidence: ${scalar(JSON.parse(evidenceMatch[1]))}`);
}

const restamp = restampHarness();
const restampBodiesBefore = restamp.paths.map((file) => {
  const raw = fs.readFileSync(file, 'utf8');
  return raw.slice(raw.match(/^---\n[\s\S]*?\n---/)[0].length);
});
const restampContractsBefore = restamp.paths.map((file) => (
  parseExecutionMeta(fs.readFileSync(file, 'utf8'), path.basename(file, '.md')).contract
));
const restampPreimages = restamp.paths.map((file) => fs.readFileSync(file, 'utf8'));
const restampIntended = restampPreimages.map(independentlyRestampedContractBytes);
const restampPlan = await commandReconcileMetadata(restamp.ctx, restamp.dryRunArgs, restamp.deps);
eq(restampPlan.action, 'contract-frontmatter-restamp-plan',
  'BGR-OBSY-HEAL-IDEMPOTENT starts with a deterministic dry-run');
eq(restampPlan.exact_target_count, 2,
  'BGR-OBSY-HEAL-IDEMPOTENT plans every legacy canonical note and excludes already encoded or unrelated notes');
eq(restampPlan.spec.files.map((entry) => entry.card), ['Legacy Restamp A', 'Legacy Restamp B'],
  'BGR-OBSY-HEAL-IDEMPOTENT uses stable path ordering');
for (let index = 0; index < restampPlan.spec.files.length; index += 1) {
  eq(restampPlan.spec.files[index].expected_sha256, testSha256(restampPreimages[index]),
    `GA-OPS20A2-RESTAMP-HASH-ORACLE-SELF-DERIVED target ${index + 1} expected receipt uses independent SHA-256`);
  eq(restampPlan.spec.files[index].intended_sha256, testSha256(restampIntended[index]),
    `GA-OPS20A2-RESTAMP-HASH-ORACLE-SELF-DERIVED target ${index + 1} intended receipt uses independent SHA-256`);
}
eq(restamp.writes(), 0, 'BGR-OBSY-HEAL-IDEMPOTENT dry-run performs zero writes');
restamp.setSpec(restampPlan.spec);
restamp.failWrite(2);
await assert.rejects(
  () => commandReconcileMetadata(restamp.ctx, restamp.applyArgs, restamp.deps),
  /injected restamp write failure/,
  'BGR-OBSY-HEAL-IDEMPOTENT propagates an interrupted atomic write',
); count++;
const firstInterruptedRaw = fs.readFileSync(restamp.paths[0], 'utf8');
const secondInterruptedRaw = fs.readFileSync(restamp.paths[1], 'utf8');
ok(!restampContractFrontmatter(firstInterruptedRaw, 'Legacy Restamp A').changed
  && restampContractFrontmatter(secondInterruptedRaw, 'Legacy Restamp B').changed,
'BGR-OBSY-HEAL-IDEMPOTENT interrupted apply leaves only canonical intended or exact preimage states');
restamp.clearFailure();
const restampApplied = await commandReconcileMetadata(restamp.ctx, restamp.applyArgs, restamp.deps);
eq(restampApplied.changed_count, 1,
  'BGR-OBSY-HEAL-IDEMPOTENT literal retry rolls the one remaining preimage forward');
for (let index = 0; index < restamp.paths.length; index += 1) {
  const raw = fs.readFileSync(restamp.paths[index], 'utf8');
  const fieldLines = raw.match(/^---\n([\s\S]*?)\n---/)[1].split('\n');
  ok(/^deploy_subscriptions: "/m.test(raw) && /^evidence: "/m.test(raw),
    `BGR-OBSY-HEAL-IDEMPOTENT target ${index + 1} uses JSON text scalars`);
  ok(!fieldLines.some((line) => /^\s{2}(?:headspace|accuris|ero):/.test(line)),
    `BGR-OBSY-NO-OBJECT-FRONTMATTER-GUARD target ${index + 1} has no nested deployment map`);
  eq(raw.slice(raw.match(/^---\n[\s\S]*?\n---/)[0].length), restampBodiesBefore[index],
    `BGR-OBSY-HEAL-IDEMPOTENT target ${index + 1} preserves every body byte`);
  eq(parseExecutionMeta(raw, path.basename(restamp.paths[index], '.md')).contract,
    restampContractsBefore[index],
    `BGR-OBSY-READERS-BOTH-ENCODINGS target ${index + 1} preserves its complete parsed contract`);
}
const restampWritesAfterApply = restamp.writes();
const restampReplay = await commandReconcileMetadata(restamp.ctx, restamp.applyArgs, restamp.deps);
ok(restampReplay.no_op && restampReplay.changed_count === 0,
  'BGR-OBSY-HEAL-IDEMPOTENT literal replay returns no_op true');
eq(restamp.writes(), restampWritesAfterApply,
  'BGR-OBSY-HEAL-IDEMPOTENT literal replay performs zero writes');

const malformedRestamp = restampHarness('malformed');
fs.writeFileSync(malformedRestamp.paths[0], fs.readFileSync(malformedRestamp.paths[0], 'utf8')
  .replace(/^evidence:.*$/m, `evidence: ${JSON.stringify('[{"source_identity":"unterminated"}')}`));
assert.throws(
  () => contractFrontmatterRestampPlan(malformedRestamp.root, malformedRestamp.reason),
  /invalid-structured-json:evidence/,
  'BGR-OBSY-READERS-BOTH-ENCODINGS bulk restamp refuses malformed structured JSON before writes',
); count++;
eq(malformedRestamp.writes(), 0,
  'BGR-OBSY-READERS-BOTH-ENCODINGS malformed bulk restamp performs zero writes');

const symlinkRestamp = restampHarness('symlink');
const outsideRestamp = path.join(reconcileRoot, 'contract-frontmatter-restamp-outside.md');
fs.writeFileSync(outsideRestamp, card({ name: 'Outside Restamp' }));
fs.symlinkSync(outsideRestamp, path.join(symlinkRestamp.root, 'Escaped Restamp.md'));
assert.throws(
  () => contractFrontmatterRestampPlan(symlinkRestamp.root, symlinkRestamp.reason),
  /refuses symlink path/,
  'BGR-OBSY-HEAL-IDEMPOTENT refuses a symlinked canonical-note path',
); count++;
eq(symlinkRestamp.writes(), 0,
  'BGR-OBSY-HEAL-IDEMPOTENT symlink refusal performs zero writes');

const escapeRestamp = restampHarness('escape-spec');
const escapePlan = await commandRestampContractFrontmatter(
  escapeRestamp.ctx, escapeRestamp.dryRunArgs, escapeRestamp.deps,
);
const escapedSpec = deepCopy(escapePlan.spec);
escapedSpec.files[0].path = '../contract-frontmatter-restamp-outside.md';
escapeRestamp.setSpec(escapedSpec);
await assert.rejects(
  () => commandRestampContractFrontmatter(escapeRestamp.ctx, escapeRestamp.applyArgs, escapeRestamp.deps),
  /invalid entry/,
  'BGR-OBSY-HEAL-IDEMPOTENT refuses an out-of-root spec before writes',
); count++;
eq(escapeRestamp.writes(), 0,
  'BGR-OBSY-HEAL-IDEMPOTENT out-of-root refusal performs zero writes');

const thirdHashRestamp = restampHarness('third-hash');
const thirdHashRestampPlan = await commandRestampContractFrontmatter(
  thirdHashRestamp.ctx, thirdHashRestamp.dryRunArgs, thirdHashRestamp.deps,
);
thirdHashRestamp.setSpec(thirdHashRestampPlan.spec);
const untouchedThirdHashPeer = fs.readFileSync(thirdHashRestamp.paths[1], 'utf8');
const thirdHashPreimage = fs.readFileSync(thirdHashRestamp.paths[0], 'utf8');
const thirdHashMutated = thirdHashPreimage.replace('BODY-SENTINEL-0', 'BODY-SENTINEL-X');
eq(Buffer.byteLength(thirdHashMutated), Buffer.byteLength(thirdHashPreimage),
  'GA-OPS20A2-RESTAMP-HASH-ORACLE-SELF-DERIVED mutation preserves preimage length');
eq([...Buffer.from(thirdHashMutated)].filter((byte, index) => byte !== Buffer.from(thirdHashPreimage)[index]).length, 1,
  'GA-OPS20A2-RESTAMP-HASH-ORACLE-SELF-DERIVED fixture mutates exactly one byte');
fs.writeFileSync(thirdHashRestamp.paths[0], thirdHashMutated);
await assert.rejects(
  () => commandRestampContractFrontmatter(
    thirdHashRestamp.ctx, thirdHashRestamp.applyArgs, thirdHashRestamp.deps,
  ),
  /unplanned or changed canonical target|third hash/,
  'GA-OPS20A2-RESTAMP-HASH-ORACLE-SELF-DERIVED refuses a one-byte post-plan mutation before writes',
); count++;
eq(thirdHashRestamp.writes(), 0,
  'GA-OPS20A2-RESTAMP-HASH-ORACLE-SELF-DERIVED one-byte refusal performs zero coordinator writes');
eq(fs.readFileSync(thirdHashRestamp.paths[1], 'utf8'), untouchedThirdHashPeer,
  'GA-OPS20A2-RESTAMP-HASH-ORACLE-SELF-DERIVED one-byte refusal preserves every peer preimage');

// BGD-PARKED-REBIND: exact-eight migration metadata repair is one atomic ledger write.
async function captureFsMutationAttempts(run) {
  const methods = ['writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'rmSync'];
  const originals = Object.fromEntries(methods.map((method) => [method, fs[method]]));
  const calls = [];
  for (const method of methods) {
    fs[method] = (...args) => {
      calls.push({
        method,
        path: args[0] == null ? null : String(args[0]),
        target: args[1] == null || method !== 'renameSync' ? null : String(args[1]),
      });
      return undefined;
    };
  }
  let result = null;
  let error = null;
  try {
    try { result = await run(); }
    catch (err) { error = err; }
  } finally {
    for (const method of methods) fs[method] = originals[method];
  }
  return { result, error, calls };
}

function parkedRebindHarness(id = 'happy') {
  const root = path.join(reconcileRoot, `parked-rebind-${id}`);
  fs.mkdirSync(root, { recursive: true });
  const boardPath = path.join(root, 'board-sentinel.md');
  fs.writeFileSync(boardPath, '## In Progress\n- [ ] parked authority sentinel\n');
  const state = emptyState();
  const actualEpics = [
    'Core Styling Adoption', 'Harness and Docs Hygiene',
    'Shared-Mechanism Dedup', 'Shared-Mechanism Dedup',
    'Shared-Mechanism Dedup', 'Shared-Mechanism Dedup',
    'Feature Polish', 'Feature Polish',
  ];
  for (let index = 0; index < PARKED_METADATA_REBIND_CARDS.length; index++) {
    const name = PARKED_METADATA_REBIND_CARDS[index];
    const cardPath = path.join(root, `${name}.md`);
    const raw = card({ name, deps: ['Satisfied dependency'] })
      .replace('---\n', '---\nkanban_column: In Progress\nresume_condition: \"wait for bounded authority\"\n')
      .replace('status: planning', 'status: parked')
      .replace('epic: "[[Test epic]]"', `epic: "[[${actualEpics[index]}]]"`);
    fs.writeFileSync(cardPath, raw);
    const projected = prepareDeliveryCard(raw, name).card;
    state.cards[name] = {
      card: name, phase: 'parked', card_path: cardPath,
      delivery_contract: { ...projected, status: 'planning', epic: '[[Priorities for GA]]' },
      delivery_contract_version: delivery.CONTRACT_VERSION,
      dependencies: projected.depends_on, touch_zones: projected.touch_zones,
      deploy_subscriptions: projected.deploy_subscriptions, batch_policy: projected.batch_policy,
      resume_condition: 'wait for bounded authority',
      head_sha: 'a'.repeat(40), branch: `preserved-${index}`, worktree: `/preserved-${index}`,
      gate_receipt: { fixture: `gate-${index}` }, reviews: { fixture: `reviews-${index}` },
      parked_metadata_rebindings: [{
        request: { prior_receipt: name, index },
        spec: { prior_spec: name, index },
        reconciled_at: `2026-07-24T00:00:${String(index).padStart(2, '0')}.000Z`,
      }],
    };
  }
  let ledgerWrites = 0;
  let cardWrites = 0;
  let barrierCalls = 0;
  let barrierFailure = null;
  const locks = [];
  const stateDir = path.join(root, '.state');
  const ctx = { root, stateDir, statePath: path.join(stateDir, 'state.json'), boardPath };
  let specRaw = '';
  const deps = {
    readState: () => state,
    writeState: () => { ledgerWrites++; },
    withLock: async (_ctx, name, fn) => { locks.push(name); return fn(); },
    atomicWriteText: (target, raw) => {
      cardWrites++;
      fs.writeFileSync(target, raw);
    },
    durablePathBarrier: () => {
      barrierCalls++;
      if (barrierFailure) throw new Error(barrierFailure);
    },
    readSpec: () => specRaw,
    cardsRoot: root,
    boardPath,
    now: () => '2026-07-25T23:30:00.000Z',
  };
  const reason = 'rebind the exact eight canonical epic migrations';
  const dryRunArgs = {
    _: ['reconcile-metadata'],
    'parked-rebind': true,
    'dry-run': true,
    reason,
    json: true,
  };
  const applyArgs = {
    _: ['reconcile-metadata'],
    'parked-rebind': true,
    apply: true,
    reason,
    spec: 'exact-eight.json',
    json: true,
  };
  return {
    root, boardPath, state, ctx, deps, reason, dryRunArgs, applyArgs,
    setSpec: (spec) => { specRaw = `${JSON.stringify(spec, null, 2)}\n`; },
    setSpecRaw: (raw) => { specRaw = String(raw); },
    counts: () => ({ ledgerWrites, cardWrites, barrierCalls, locks: [...locks] }),
    failBarrier: (message) => { barrierFailure = message; },
    clearBarrierFailure: () => { barrierFailure = null; },
  };
}

function parkedRefusalSnapshot(harness) {
  return {
    state: deepCopy(harness.state),
    board_sha256: testSha256(fs.readFileSync(harness.boardPath, 'utf8')),
    card_sha256: Object.fromEntries(Object.entries(harness.state.cards)
      .filter(([, record]) => record && record.card_path && fs.existsSync(record.card_path))
      .map(([name, record]) => [name, testSha256(fs.readFileSync(record.card_path, 'utf8'))])),
    ledger_writes: harness.counts().ledgerWrites,
    card_writes: harness.counts().cardWrites,
  };
}

async function assertParkedRefusalNoMutation(harness, args, pattern, label) {
  const before = parkedRefusalSnapshot(harness);
  const probe = await captureFsMutationAttempts(() => commandReconcileMetadata(
    harness.ctx, args, harness.deps,
  ));
  ok(probe.error && pattern.test(probe.error.message),
    `${label} reaches its exact refusal`);
  eq(probe.calls, [], `${label} attempts zero filesystem or board mutations`);
  eq(harness.counts().ledgerWrites, before.ledger_writes,
    `${label} performs zero ledger writes`);
  eq(harness.counts().cardWrites, before.card_writes,
    `${label} performs zero card or board writer calls`);
  eq(harness.state, before.state, `${label} leaves every ledger/control record exact`);
  eq(testSha256(fs.readFileSync(harness.boardPath, 'utf8')), before.board_sha256,
    `${label} preserves the relevant board hash`);
  eq(Object.fromEntries(Object.entries(harness.state.cards)
    .filter(([, record]) => record && record.card_path && fs.existsSync(record.card_path))
    .map(([name, record]) => [name, testSha256(fs.readFileSync(record.card_path, 'utf8'))])),
  before.card_sha256, `${label} preserves every target card hash`);
}

const parkedRebind = parkedRebindHarness();
const parkedLedgerBefore = deepCopy(parkedRebind.state.cards);
const parkedBoardBefore = fs.readFileSync(parkedRebind.boardPath, 'utf8');
const parkedCardHashesBefore = Object.fromEntries(PARKED_METADATA_REBIND_CARDS.map((name) => {
  const raw = fs.readFileSync(parkedRebind.state.cards[name].card_path, 'utf8');
  return [name, testSha256(raw)];
}));
const parkedAuthorityBefore = Object.fromEntries(PARKED_METADATA_REBIND_CARDS.map((name) => {
  const record = parkedRebind.state.cards[name];
  const raw = fs.readFileSync(record.card_path, 'utf8');
  return [name, {
    raw, phase: record.phase, resume_condition: record.resume_condition,
    head_sha: record.head_sha, branch: record.branch, worktree: record.worktree,
    gate_receipt: deepCopy(record.gate_receipt), reviews: deepCopy(record.reviews),
    dependencies: deepCopy(record.dependencies),
  }];
}));
const parkedRebindPlan = await commandReconcileMetadata(
  parkedRebind.ctx, parkedRebind.dryRunArgs, parkedRebind.deps,
);
eq(parkedRebindPlan.action, 'rebind-parked-metadata-plan', 'BGD-PARKED-REBIND-EXACT-EIGHT exposes a dry-run first');
eq(parkedRebindPlan.spec.cards.map((entry) => entry.card), PARKED_METADATA_REBIND_CARDS,
  'BGD-PARKED-REBIND-EXACT-EIGHT binds the complete canonical target set in order');
ok(parkedRebindPlan.spec.cards.every((entry) => entry.expected_card_sha256 === entry.intended_next_sha256),
  'BGD-PARKED-REBIND-PRESERVES-AUTHORITY binds byte-identical card preimage and intended hashes');
eq(parkedRebind.counts().ledgerWrites, 0, 'parked rebind dry-run performs zero ledger writes');
eq(parkedRebind.counts().cardWrites, 0, 'parked rebind dry-run performs zero card writes');
parkedRebind.setSpec(parkedRebindPlan.spec);
const parkedRebindApplied = await commandReconcileMetadata(
  parkedRebind.ctx, parkedRebind.applyArgs, parkedRebind.deps,
);
eq(parkedRebindApplied.action, 'rebound-parked-metadata', 'bounded exact-eight parked rebind applies');
eq(parkedRebindApplied.no_op, false, 'first exact-eight parked rebind records a real ledger repair');
eq(parkedRebind.counts().ledgerWrites, 1, 'exact-eight parked rebind is one atomic ledger write');
eq(parkedRebind.counts().cardWrites, 0, 'exact-eight parked rebind never rewrites a card');
for (const name of PARKED_METADATA_REBIND_CARDS) {
  const record = parkedRebind.state.cards[name];
  const before = parkedAuthorityBefore[name];
  eq({
    raw: fs.readFileSync(record.card_path, 'utf8'),
    phase: record.phase, resume_condition: record.resume_condition,
    head_sha: record.head_sha, branch: record.branch, worktree: record.worktree,
    gate_receipt: record.gate_receipt, reviews: record.reviews, dependencies: record.dependencies,
  }, before, `BGD-PARKED-REBIND-PRESERVES-AUTHORITY preserves ${name}`);
  eq(projectionMetadataProblem(record, parkedRebind.root), null,
    `BGD-PARKED-REBIND-PRESERVES-AUTHORITY clears ${name}`);
  eq(record.parked_metadata_rebindings, [
    ...parkedLedgerBefore[name].parked_metadata_rebindings,
    {
      request: parkedRebindApplied.request,
      spec: parkedRebindApplied.spec,
      reconciled_at: parkedRebindApplied.reconciled_at,
    },
  ], `GA-OPS14A2-PRIOR-AUDIT-HISTORY-UNBOUND preserves ${name}'s exact audit prefix and appends one receipt`);
}
const parkedLedgerAfterNormalized = deepCopy(parkedRebind.state.cards);
for (const name of PARKED_METADATA_REBIND_CARDS) {
  parkedLedgerAfterNormalized[name].delivery_contract.epic =
    parkedLedgerBefore[name].delivery_contract.epic;
  if (Object.prototype.hasOwnProperty.call(parkedLedgerBefore[name], 'parked_metadata_rebindings')) {
    parkedLedgerAfterNormalized[name].parked_metadata_rebindings =
      deepCopy(parkedLedgerBefore[name].parked_metadata_rebindings);
  } else {
    delete parkedLedgerAfterNormalized[name].parked_metadata_rebindings;
  }
}
eq(parkedLedgerAfterNormalized, parkedLedgerBefore,
  'GA-OPS14A2-AUTHORITY-COMPARISON-INCOMPLETE preserves every ledger and control field except intended epic plus audit');
eq(fs.readFileSync(parkedRebind.boardPath, 'utf8'), parkedBoardBefore,
  'GA-OPS14A2-AUTHORITY-COMPARISON-INCOMPLETE preserves board bytes');
eq(Object.fromEntries(PARKED_METADATA_REBIND_CARDS.map((name) => {
  const raw = fs.readFileSync(parkedRebind.state.cards[name].card_path, 'utf8');
  return [name, testSha256(raw)];
})), parkedCardHashesBefore,
  'GA-OPS14A2-AUTHORITY-COMPARISON-INCOMPLETE preserves every card byte hash');
const parkedRebindCountsAfterApply = parkedRebind.counts();
const parkedAuditsAfterApply = Object.fromEntries(PARKED_METADATA_REBIND_CARDS.map((name) => [
  name,
  deepCopy(parkedRebind.state.cards[name].parked_metadata_rebindings),
]));
const parkedRebindReplay = await commandReconcileMetadata(
  parkedRebind.ctx, parkedRebind.applyArgs, parkedRebind.deps,
);
eq(parkedRebindReplay.no_op, true, 'GA-OPS12-METADATA-LITERAL-REPLAY-CAS returns no_op true');
eq(parkedRebind.counts(), {
  ...parkedRebindCountsAfterApply,
  barrierCalls: parkedRebindCountsAfterApply.barrierCalls + 1,
  locks: [...parkedRebindCountsAfterApply.locks, 'parked-metadata-rebind'],
}, 'GA-OPS12-METADATA-LITERAL-REPLAY-CAS performs zero second ledger or card writes');
eq(Object.fromEntries(PARKED_METADATA_REBIND_CARDS.map((name) => [
  name,
  parkedRebind.state.cards[name].parked_metadata_rebindings,
])), parkedAuditsAfterApply,
  'GA-OPS14A2-PRIOR-AUDIT-HISTORY-UNBOUND literal replay leaves every prior-plus-appended audit chain exact');

// GA-OPS14A3-TOP-LEVEL-AUTHORITY-DRIFT: cross the real readState/writeState seam
// and compare the complete serialized ledger envelope, then prove literal replay
// is byte-identical. Only the eight epic values and eight appended audits may move.
const realPersistenceRebind = parkedRebindHarness('real-persistence-envelope');
realPersistenceRebind.state.updated_at = '2026-07-20T12:34:56.789Z';
realPersistenceRebind.state.top_level_authority_sentinel = {
  digest_marker: 'preserve-exactly',
  cutover: { enabled: true, streak: 3 },
  receipts: ['alpha', 'beta'],
};
realPersistenceRebind.state.cards['Unrelated ledger authority sentinel'] = {
  card: 'Unrelated ledger authority sentinel',
  phase: 'completed',
  delivery_contract: {
    epic: '[[Unrelated Epic]]',
    status: 'completed',
  },
  nested_authority: {
    deployment_receipts: [{ vault: 'sentinel', ok: true }],
    prior_reviews: { correctness: 'preserve-exactly' },
  },
};
atomicWriteJson(realPersistenceRebind.ctx.statePath, realPersistenceRebind.state);
const realPersistenceBefore = JSON.parse(fs.readFileSync(
  realPersistenceRebind.ctx.statePath, 'utf8',
));
const realPersistenceDeps = { ...realPersistenceRebind.deps };
delete realPersistenceDeps.readState;
delete realPersistenceDeps.writeState;
const realPersistencePlan = await commandReconcileMetadata(
  realPersistenceRebind.ctx,
  realPersistenceRebind.dryRunArgs,
  realPersistenceDeps,
);
realPersistenceRebind.setSpec(realPersistencePlan.spec);
const realPersistenceApplied = await commandReconcileMetadata(
  realPersistenceRebind.ctx,
  realPersistenceRebind.applyArgs,
  realPersistenceDeps,
);
const realPersistenceAfter = JSON.parse(fs.readFileSync(
  realPersistenceRebind.ctx.statePath, 'utf8',
));
const realPersistenceExpected = deepCopy(realPersistenceBefore);
for (const entry of realPersistencePlan.spec.cards) {
  const record = realPersistenceExpected.cards[entry.card];
  record.delivery_contract.epic = entry.intended_ledger_epic;
  record.parked_metadata_rebindings.push({
    request: realPersistenceApplied.request,
    spec: realPersistenceApplied.spec,
    reconciled_at: realPersistenceApplied.reconciled_at,
  });
}
eq(realPersistenceAfter.cards['Unrelated ledger authority sentinel'],
  realPersistenceBefore.cards['Unrelated ledger authority sentinel'],
  'GA-OPS14A4-NON-TARGET-CARD-ENVELOPE-UNBOUND preserves an unrelated complete ledger record through real persistence');
eq(realPersistenceAfter, realPersistenceExpected,
  'GA-OPS14A3-TOP-LEVEL-AUTHORITY-DRIFT changes only eight epic bindings plus eight appended audits across real persistence');
eq(realPersistenceAfter.updated_at, realPersistenceBefore.updated_at,
  'GA-OPS14A3-TOP-LEVEL-AUTHORITY-DRIFT preserves the exact top-level updated_at authority');
const realPersistenceHashAfterApply = testSha256(fs.readFileSync(
  realPersistenceRebind.ctx.statePath, 'utf8',
));
const realPersistenceReplay = await commandReconcileMetadata(
  realPersistenceRebind.ctx,
  realPersistenceRebind.applyArgs,
  realPersistenceDeps,
);
eq(realPersistenceReplay.no_op, true,
  'GA-OPS14A3-TOP-LEVEL-AUTHORITY-DRIFT literal replay is a no-op through real persistence');
eq(testSha256(fs.readFileSync(realPersistenceRebind.ctx.statePath, 'utf8')),
  realPersistenceHashAfterApply,
  'GA-OPS14A3-TOP-LEVEL-AUTHORITY-DRIFT literal replay preserves the complete serialized ledger byte hash');

for (const altered of [
  { ...parkedRebind.applyArgs, reason: ` ${parkedRebind.reason}` },
  { ...parkedRebind.applyArgs, spec: './exact-eight.json' },
  { ...parkedRebind.applyArgs, json: false },
  { ...parkedRebind.applyArgs, 'dry-run': 'false' },
]) {
  await assert.rejects(() => commandReconcileMetadata(parkedRebind.ctx, altered, parkedRebind.deps),
    /literal|requires|reason|substituted/, 'GA-OPS12-METADATA-LITERAL-REPLAY-CAS refuses a substituted operand'); count++;
}
for (const [mutation, altered] of [
  ['added', { ...parkedRebind.applyArgs, _: ['reconcile-metadata', 'extra'] }],
  ['removed', { ...parkedRebind.applyArgs, _: [] }],
  ['changed', { ...parkedRebind.applyArgs, _: ['reconcile-metadata-substituted'] }],
]) {
  await assert.rejects(
    () => commandReconcileMetadata(parkedRebind.ctx, altered, parkedRebind.deps),
    /literal|substituted/,
    `GA-OPS14A-LITERAL-POSITIONAL-OPERANDS-UNCOVERED refuses ${mutation} positional operands`,
  ); count++;
  eq(parkedRebind.counts().ledgerWrites, 1,
    `GA-OPS14A-LITERAL-POSITIONAL-OPERANDS-UNCOVERED ${mutation} positional operands perform zero ledger writes`);
  eq(parkedRebind.counts().cardWrites, 0,
    `GA-OPS14A-LITERAL-POSITIONAL-OPERANDS-UNCOVERED ${mutation} positional operands perform zero card writes`);
}
const substitutedParkedSpec = deepCopy(parkedRebindPlan.spec);
substitutedParkedSpec.cards[0].expected_card_sha256 = 'b'.repeat(64);
parkedRebind.setSpec(substitutedParkedSpec);
await assert.rejects(() => commandReconcileMetadata(
  parkedRebind.ctx, parkedRebind.applyArgs, parkedRebind.deps,
), /invalid exact-eight entry/, 'GA-OPS12-METADATA-LITERAL-REPLAY-CAS refuses a substituted CAS hash'); count++;
parkedRebind.setSpec(parkedRebindPlan.spec);
eq(parkedRebind.counts().ledgerWrites, 1, 'substituted parked-rebind operands perform zero ledger writes');
eq(parkedRebind.counts().cardWrites, 0, 'substituted parked-rebind operands perform zero card writes');

const parkedDurabilityReplay = parkedRebindHarness('durability-replay');
const parkedDurabilityPlan = await commandReconcileMetadata(
  parkedDurabilityReplay.ctx, parkedDurabilityReplay.dryRunArgs, parkedDurabilityReplay.deps,
);
parkedDurabilityReplay.setSpec(parkedDurabilityPlan.spec);
parkedDurabilityReplay.failBarrier('injected post-ledger durability failure');
await assert.rejects(() => commandReconcileMetadata(
  parkedDurabilityReplay.ctx, parkedDurabilityReplay.applyArgs, parkedDurabilityReplay.deps,
), /post-ledger durability failure/, 'GA-OPS14A-DURABILITY-REPLAY-GAP propagates the first post-ledger barrier failure'); count++;
eq(parkedDurabilityReplay.counts().ledgerWrites, 1,
  'GA-OPS14A-DURABILITY-REPLAY-GAP leaves exactly one visible atomic ledger write');
parkedDurabilityReplay.clearBarrierFailure();
const parkedDurabilityRecovered = await commandReconcileMetadata(
  parkedDurabilityReplay.ctx, parkedDurabilityReplay.applyArgs, parkedDurabilityReplay.deps,
);
eq(parkedDurabilityRecovered.no_op, true,
  'GA-OPS14A-DURABILITY-REPLAY-GAP exact retry recovers through the replay path');
eq(parkedDurabilityReplay.counts().barrierCalls, 2,
  'GA-OPS14A-DURABILITY-REPLAY-GAP replay re-establishes the state durability barrier');
eq(parkedDurabilityReplay.counts().ledgerWrites, 1,
  'GA-OPS14A-DURABILITY-REPLAY-GAP recovery performs zero second ledger writes');

const mixedStateRebind = parkedRebindHarness('mixed-ledger-state');
const mixedStatePlan = await commandReconcileMetadata(
  mixedStateRebind.ctx, mixedStateRebind.dryRunArgs, mixedStateRebind.deps,
);
mixedStateRebind.setSpec(mixedStatePlan.spec);
mixedStateRebind.state.cards[PARKED_METADATA_REBIND_CARDS[0]].delivery_contract.epic =
  mixedStatePlan.spec.cards[0].intended_ledger_epic;
const mixedStateBefore = deepCopy(mixedStateRebind.state.cards);
const mixedStateBoardBefore = fs.readFileSync(mixedStateRebind.boardPath, 'utf8');
await assert.rejects(
  () => commandReconcileMetadata(mixedStateRebind.ctx, mixedStateRebind.applyArgs, mixedStateRebind.deps),
  /mixed third state; zero writes/,
  'GA-OPS14A2-MIXED-STATE-FIXTURE-ABSENT refuses one intended plus seven expected ledger epics',
); count++;
eq(mixedStateRebind.counts().ledgerWrites, 0,
  'GA-OPS14A2-MIXED-STATE-FIXTURE-ABSENT performs zero ledger writes');
eq(mixedStateRebind.counts().cardWrites, 0,
  'GA-OPS14A2-MIXED-STATE-FIXTURE-ABSENT performs zero card writes');
eq(mixedStateRebind.state.cards, mixedStateBefore,
  'GA-OPS14A2-MIXED-STATE-FIXTURE-ABSENT leaves every record unchanged');
eq(fs.readFileSync(mixedStateRebind.boardPath, 'utf8'), mixedStateBoardBefore,
  'GA-OPS14A2-MIXED-STATE-FIXTURE-ABSENT leaves board bytes unchanged');

for (const phase of ['implementing', 'deployed']) {
  const refusal = parkedRebindHarness(`phase-${phase}`);
  const refusalPlan = await commandReconcileMetadata(refusal.ctx, refusal.dryRunArgs, refusal.deps);
  refusal.setSpec(refusalPlan.spec);
  refusal.state.cards[PARKED_METADATA_REBIND_CARDS[0]].phase = phase;
  await assert.rejects(() => commandReconcileMetadata(refusal.ctx, refusal.applyArgs, refusal.deps),
    /missing, active, completed/, `BGD-PARKED-REBIND-EXACT-EIGHT refuses ${phase} target before writes`); count++;
  eq(refusal.counts().ledgerWrites, 0, `${phase} parked-rebind refusal performs zero ledger writes`);
}
const missingFindingRebind = parkedRebindHarness('missing-finding');
const missingFindingRecord = missingFindingRebind.state.cards[PARKED_METADATA_REBIND_CARDS[0]];
missingFindingRecord.delivery_contract.epic = prepareDeliveryCard(
  fs.readFileSync(missingFindingRecord.card_path, 'utf8'), missingFindingRecord.card,
).card.epic;
await assert.rejects(() => commandReconcileMetadata(
  missingFindingRebind.ctx, missingFindingRebind.dryRunArgs, missingFindingRebind.deps,
), /complete exact-eight status finding set/, 'BGD-PARKED-REBIND-EXACT-EIGHT refuses a missing current finding before writes'); count++;
eq(missingFindingRebind.counts().ledgerWrites, 0, 'missing current finding refusal performs zero ledger writes');
const extraFindingRebind = parkedRebindHarness('extra-finding');
const extraFindingName = 'Unexpected ninth parked metadata finding';
const extraFindingSource = extraFindingRebind.state.cards[PARKED_METADATA_REBIND_CARDS[0]];
const extraFindingPath = path.join(extraFindingRebind.root, `${extraFindingName}.md`);
const extraFindingRaw = fs.readFileSync(extraFindingSource.card_path, 'utf8')
  .replaceAll(PARKED_METADATA_REBIND_CARDS[0], extraFindingName);
fs.writeFileSync(extraFindingPath, extraFindingRaw);
extraFindingRebind.state.cards[extraFindingName] = {
  ...deepCopy(extraFindingSource),
  card: extraFindingName,
  card_path: extraFindingPath,
  delivery_contract: {
    ...deepCopy(extraFindingSource.delivery_contract),
    card: extraFindingName,
  },
};
await assert.rejects(() => commandReconcileMetadata(
  extraFindingRebind.ctx, extraFindingRebind.dryRunArgs, extraFindingRebind.deps,
), /complete exact-eight status finding set/, 'BGD-PARKED-REBIND-EXACT-EIGHT refuses an extra current finding before writes'); count++;
eq(extraFindingRebind.counts().ledgerWrites, 0, 'extra current finding refusal performs zero ledger writes');
const thirdStateRebind = parkedRebindHarness('third-card-state');
const thirdStatePlan = await commandReconcileMetadata(thirdStateRebind.ctx, thirdStateRebind.dryRunArgs, thirdStateRebind.deps);
thirdStateRebind.setSpec(thirdStatePlan.spec);
fs.appendFileSync(thirdStateRebind.state.cards[PARKED_METADATA_REBIND_CARDS[0]].card_path, '\nthird-state');
await assert.rejects(() => commandReconcileMetadata(thirdStateRebind.ctx, thirdStateRebind.applyArgs, thirdStateRebind.deps),
  /third card hash/, 'BGD-PARKED-REBIND-EXACT-EIGHT refuses a third card state before writes'); count++;
eq(thirdStateRebind.counts().ledgerWrites, 0, 'third-state parked-rebind refusal performs zero ledger writes');
for (const shape of ['missing', 'extra']) {
  const refusal = parkedRebindHarness(shape);
  const refusalPlan = await commandReconcileMetadata(refusal.ctx, refusal.dryRunArgs, refusal.deps);
  const cards = shape === 'missing'
    ? refusalPlan.spec.cards.slice(0, -1)
    : [...refusalPlan.spec.cards, deepCopy(refusalPlan.spec.cards[0])];
  refusal.setSpec({ ...refusalPlan.spec, cards });
  await assert.rejects(() => commandReconcileMetadata(refusal.ctx, refusal.applyArgs, refusal.deps),
    /does not exactly match/, `BGD-PARKED-REBIND-EXACT-EIGHT refuses ${shape} target set before writes`); count++;
  eq(refusal.counts().ledgerWrites, 0, `${shape} target-set refusal performs zero ledger writes`);
}

// GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE: every refusal class crosses the
// same filesystem/state/card/board zero-mutation oracle.
for (const [label, altered, pattern] of [
  ['unsupported named operand',
    { ...parkedRebind.applyArgs, 'unknown-named-operand': true },
    /unsupported --unknown-named-operand/],
  ['substituted reason',
    { ...parkedRebind.applyArgs, reason: ` ${parkedRebind.reason}` },
    /literal/],
  ['substituted spec path',
    { ...parkedRebind.applyArgs, spec: './exact-eight.json' },
    /literal/],
  ['substituted JSON operand',
    { ...parkedRebind.applyArgs, json: false },
    /requires literal/],
  ['opposite-mode operand',
    { ...parkedRebind.applyArgs, 'dry-run': 'false' },
    /opposite-mode operand/],
  ['added positional operand',
    { ...parkedRebind.applyArgs, _: ['reconcile-metadata', 'extra'] },
    /literal/],
  ['removed positional operand',
    { ...parkedRebind.applyArgs, _: [] },
    /literal/],
  ['changed positional operand',
    { ...parkedRebind.applyArgs, _: ['reconcile-metadata-substituted'] },
    /literal/],
]) {
  await assertParkedRefusalNoMutation(
    parkedRebind,
    altered,
    pattern,
    `GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE ${label}`,
  );
}
const refusalCasSpec = deepCopy(parkedRebindPlan.spec);
refusalCasSpec.cards[0].expected_card_sha256 = 'b'.repeat(64);
parkedRebind.setSpec(refusalCasSpec);
await assertParkedRefusalNoMutation(
  parkedRebind,
  parkedRebind.applyArgs,
  /invalid exact-eight entry/,
  'GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE substituted CAS',
);
parkedRebind.setSpec(parkedRebindPlan.spec);
await assertParkedRefusalNoMutation(
  missingFindingRebind,
  missingFindingRebind.dryRunArgs,
  /complete exact-eight status finding set/,
  'GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE missing current finding',
);
await assertParkedRefusalNoMutation(
  extraFindingRebind,
  extraFindingRebind.dryRunArgs,
  /complete exact-eight status finding set/,
  'GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE extra current finding',
);
await assertParkedRefusalNoMutation(
  mixedStateRebind,
  mixedStateRebind.applyArgs,
  /mixed third state/,
  'GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE mixed ledger state',
);
await assertParkedRefusalNoMutation(
  thirdStateRebind,
  thirdStateRebind.applyArgs,
  /third card hash/,
  'GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE third card state',
);
const malformedJsonRefusal = parkedRebindHarness('write-seam-malformed-json');
await commandReconcileMetadata(
  malformedJsonRefusal.ctx,
  malformedJsonRefusal.dryRunArgs,
  malformedJsonRefusal.deps,
);
malformedJsonRefusal.setSpecRaw('{"schema_version":1,"reason":');
await assertParkedRefusalNoMutation(
  malformedJsonRefusal,
  malformedJsonRefusal.applyArgs,
  /spec is malformed JSON/,
  'GA-OPS14A4-MALFORMED-REFUSAL-ORACLE-GAP malformed spec JSON',
);
const malformedProjectedRefusal = parkedRebindHarness('write-seam-malformed-projected-target');
const malformedProjectedPlan = await commandReconcileMetadata(
  malformedProjectedRefusal.ctx,
  malformedProjectedRefusal.dryRunArgs,
  malformedProjectedRefusal.deps,
);
const malformedProjectedPath =
  malformedProjectedRefusal.state.cards[PARKED_METADATA_REBIND_CARDS[0]].card_path;
const malformedProjectedRaw = 'malformed projected target with no Delivery contract\n';
fs.writeFileSync(malformedProjectedPath, malformedProjectedRaw);
const malformedProjectedSpec = deepCopy(malformedProjectedPlan.spec);
malformedProjectedSpec.cards[0].expected_card_sha256 = testSha256(malformedProjectedRaw);
malformedProjectedSpec.cards[0].intended_next_sha256 = testSha256(malformedProjectedRaw);
malformedProjectedRefusal.setSpec(malformedProjectedSpec);
await assertParkedRefusalNoMutation(
  malformedProjectedRefusal,
  malformedProjectedRefusal.applyArgs,
  /third projected epic state/,
  'GA-OPS14A4-MALFORMED-REFUSAL-ORACLE-GAP hash-matched malformed projected target',
);
for (const phase of ['implementing', 'deployed']) {
  const refusal = parkedRebindHarness(`write-seam-phase-${phase}`);
  const plan = await commandReconcileMetadata(refusal.ctx, refusal.dryRunArgs, refusal.deps);
  refusal.setSpec(plan.spec);
  refusal.state.cards[PARKED_METADATA_REBIND_CARDS[0]].phase = phase;
  await assertParkedRefusalNoMutation(
    refusal,
    refusal.applyArgs,
    /missing, active, completed/,
    `GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE ${phase} target`,
  );
}
const missingRecordRefusal = parkedRebindHarness('write-seam-missing-record');
const missingRecordPlan = await commandReconcileMetadata(
  missingRecordRefusal.ctx, missingRecordRefusal.dryRunArgs, missingRecordRefusal.deps,
);
missingRecordRefusal.setSpec(missingRecordPlan.spec);
delete missingRecordRefusal.state.cards[PARKED_METADATA_REBIND_CARDS[0]];
await assertParkedRefusalNoMutation(
  missingRecordRefusal,
  missingRecordRefusal.applyArgs,
  /missing, active, completed/,
  'GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE missing target record',
);
const thirdLedgerRefusal = parkedRebindHarness('write-seam-third-ledger');
const thirdLedgerPlan = await commandReconcileMetadata(
  thirdLedgerRefusal.ctx, thirdLedgerRefusal.dryRunArgs, thirdLedgerRefusal.deps,
);
thirdLedgerRefusal.setSpec(thirdLedgerPlan.spec);
thirdLedgerRefusal.state.cards[PARKED_METADATA_REBIND_CARDS[0]].delivery_contract.epic = '[[Third epic]]';
await assertParkedRefusalNoMutation(
  thirdLedgerRefusal,
  thirdLedgerRefusal.applyArgs,
  /third ledger epic state/,
  'GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE third ledger state',
);
for (const shape of ['missing', 'extra']) {
  const refusal = parkedRebindHarness(`write-seam-spec-${shape}`);
  const plan = await commandReconcileMetadata(refusal.ctx, refusal.dryRunArgs, refusal.deps);
  const cards = shape === 'missing'
    ? plan.spec.cards.slice(0, -1)
    : [...plan.spec.cards, deepCopy(plan.spec.cards[0])];
  refusal.setSpec({ ...plan.spec, cards });
  await assertParkedRefusalNoMutation(
    refusal,
    refusal.applyArgs,
    /does not exactly match/,
    `GA-OPS14A3-REFUSAL-WRITE-SEAM-INCOMPLETE ${shape} spec target`,
  );
}

// GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED: instrument every filesystem
// mutation seam while apply, replay, and refusal execute, then prove the probe
// itself catches an injected board write without allowing it to reach disk.
const boardSeamRebind = parkedRebindHarness('board-write-seam');
const boardSeamPlan = await commandReconcileMetadata(
  boardSeamRebind.ctx, boardSeamRebind.dryRunArgs, boardSeamRebind.deps,
);
boardSeamRebind.setSpec(boardSeamPlan.spec);
const boardSeamHash = testSha256(fs.readFileSync(boardSeamRebind.boardPath, 'utf8'));
const boardApplyProbe = await captureFsMutationAttempts(() => commandReconcileMetadata(
  boardSeamRebind.ctx, boardSeamRebind.applyArgs, boardSeamRebind.deps,
));
eq(boardApplyProbe.error, null,
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED apply completes under the filesystem mutation probe');
eq(boardApplyProbe.calls, [],
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED apply reaches zero filesystem or board writes');
eq(testSha256(fs.readFileSync(boardSeamRebind.boardPath, 'utf8')), boardSeamHash,
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED apply preserves the relevant board hash');
const boardReplayProbe = await captureFsMutationAttempts(() => commandReconcileMetadata(
  boardSeamRebind.ctx, boardSeamRebind.applyArgs, boardSeamRebind.deps,
));
eq(boardReplayProbe.error, null,
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED literal replay completes under the mutation probe');
eq(boardReplayProbe.calls, [],
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED literal replay reaches zero filesystem or board writes');
eq(testSha256(fs.readFileSync(boardSeamRebind.boardPath, 'utf8')), boardSeamHash,
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED literal replay preserves the relevant board hash');
const boardRefusalProbe = await captureFsMutationAttempts(() => commandReconcileMetadata(
  boardSeamRebind.ctx,
  { ...boardSeamRebind.applyArgs, reason: `${boardSeamRebind.reason} substituted` },
  boardSeamRebind.deps,
));
ok(boardRefusalProbe.error && /literal/.test(boardRefusalProbe.error.message),
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED substituted request reaches the expected refusal');
eq(boardRefusalProbe.calls, [],
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED refusal reaches zero filesystem or board writes');
eq(testSha256(fs.readFileSync(boardSeamRebind.boardPath, 'utf8')), boardSeamHash,
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED refusal preserves the relevant board hash');
const injectedBoardMutation = await captureFsMutationAttempts(async () => {
  fs.writeFileSync(boardSeamRebind.boardPath, 'injected board mutation');
});
eq(injectedBoardMutation.calls, [{
  method: 'writeFileSync',
  path: boardSeamRebind.boardPath,
  target: null,
}], 'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED probe turns red on a targeted board-write mutation');
eq(testSha256(fs.readFileSync(boardSeamRebind.boardPath, 'utf8')), boardSeamHash,
  'GA-OPS14A2-BOARD-PRESERVATION-FIXTURE-DISCONNECTED probe blocks the injected mutation from disk');

// GA-OPS14A2-CLI-ROUTING-UNCOVERED: real parser + main dispatch reach the parked-rebind route.
{
  const { execFileSync: execCli } = require('child_process');
  const coordinatorCli = path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js');
  let cliError = null;
  try {
    execCli('node', [
      coordinatorCli,
      'reconcile-metadata',
      '--parked-rebind',
      '--dry-run',
      '--reason',
      'side-effect-free routing probe',
    ], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) { cliError = err; }
  ok(cliError && /--parked-rebind requires literal --parked-rebind and --json/.test(String(cliError.stderr)),
    'GA-OPS14A2-CLI-ROUTING-UNCOVERED parser and main dispatch reach the parked-rebind-specific pre-read refusal');
}
// --- BGR redesign: discarded terminal phase with tombstones ---

// removeBoardCard: exact mirror of moveBoardCard's location grammar.
const removalBoard = liveBoard({ progress: ['Doomed card'], planning: ['Survivor'] });
const removedBoard = removeBoardCard(removalBoard, 'Doomed card');
ok(!/\[\[Doomed card\]\]/.test(removedBoard), 'removeBoardCard splices the exact card line out of its lane');
ok(/\[\[Survivor\]\]/.test(removedBoard) && /\[\[Unrelated discovery\]\]/.test(removedBoard), 'removeBoardCard preserves every unrelated board line');
eq(removeBoardCard(removedBoard, 'Doomed card'), removedBoard, 'removeBoardCard treats absence as already-removed (idempotent)');

// BGR-DISCARD-HAPPY: parked tracked card → tombstone, board line removed, note deleted.
const DISCARD_HEAD = 'f'.repeat(40);
const discardRoot = path.join(tmp, 'bgr-discard');
const discardCardsRoot = path.join(discardRoot, 'spice', 'projects', 'test', 'tasks');
fs.mkdirSync(discardCardsRoot, { recursive: true });
const discardBoardPath = path.join(discardRoot, 'spice', 'projects', 'test', 'project-board.md');
const discardCardPath = path.join(discardCardsRoot, 'Stale slice.md');
fs.writeFileSync(discardBoardPath, liveBoard({ progress: ['Stale slice'] }));
fs.writeFileSync(discardCardPath, [
  '---', 'kanban_column: In Progress', 'status: parked', 'depends_on: []', '---', 'stale body',
].join('\n'));
const discardState = emptyState();
discardState.cards['Stale slice'] = {
  card: 'Stale slice', phase: 'parked', card_path: discardCardPath,
  branch: 'codex-autoloop/stale-slice', worktree: '/missing/stale-slice',
  dependencies: ['Prerequisite A'], resume_condition: 'never satisfied',
  gate_receipt: passingReceipt(DISCARD_HEAD),
};
let discardWrites = 0;
const discardLocks = [];
const discardShCalls = [];
const discardBoardAtPersist = [];
const opx2DiscardProjections = [];
const discardDeps = {
  readState: () => discardState,
  writeState: () => { discardWrites++; discardBoardAtPersist.push(fs.readFileSync(discardBoardPath, 'utf8')); },
  withLock: async (_ctx, name, fn) => { discardLocks.push(name); return fn(); },
  boardPath: discardBoardPath,
  cardsRoot: discardCardsRoot,
  worktreeExists: () => false,
  sh: (cmd, args) => { discardShCalls.push([cmd, ...args]); return ''; },
  now: () => '2026-07-25T12:00:00.000Z',
  projectLoopStation: (_ctx, _state, updatedOn) => {
    opx2DiscardProjections.push(updatedOn);
    return { action: 'loop-station-projected', no_op: false, updated_on: updatedOn };
  },
};
await assert.rejects(() => commandDiscard({ root: discardRoot }, {
  card: 'Stale slice', 'superseded-by': 'Stale slice v2', reason: 'redesigned under BGR',
}, discardDeps), /requires --json/, 'BGR-DISCARD-HAPPY discard refuses without --json before any read or write');
eq(discardLocks, [], 'BGR-DISCARD-HAPPY missing --json refusal precedes every lock');
eq(discardWrites, 0, 'BGR-DISCARD-HAPPY missing --json refusal performs zero writes');
const discardArgs = {
  card: 'Stale slice', 'superseded-by': 'Stale slice v2', reason: 'redesigned under BGR', json: true,
};
const discarded = await commandDiscard({ root: discardRoot }, discardArgs, discardDeps);
eq(discarded.action, 'discarded', 'BGR-DISCARD-HAPPY discard succeeds with a machine-readable receipt');
eq(opx2DiscardProjections, ['discard'],
  'OPX2-TRANSITION-ONLY discard transition fires exactly one Loop Station projection');
eq(discarded.no_op, false, 'BGR-DISCARD-HAPPY first discard is not a no-op');
eq(discarded.tombstone, {
  discarded_at: '2026-07-25T12:00:00.000Z', discard_reason: 'redesigned under BGR',
  superseded_by: 'Stale slice v2', final_head: DISCARD_HEAD, carried_fixtures: [],
}, 'BGR-DISCARD-HAPPY receipt carries the exact tombstone fields');
eq(discardState.cards['Stale slice'].phase, 'discarded', 'BGR-DISCARD-HAPPY ledger phase becomes discarded');
eq(discardState.cards['Stale slice'].discarded_at, '2026-07-25T12:00:00.000Z', 'BGR-DISCARD-HAPPY ledger records discarded_at');
eq(discardState.cards['Stale slice'].discard_reason, 'redesigned under BGR', 'BGR-DISCARD-HAPPY ledger records the discard reason');
eq(discardState.cards['Stale slice'].superseded_by, 'Stale slice v2', 'BGR-DISCARD-HAPPY ledger records the superseding card');
eq(discardState.cards['Stale slice'].final_head, DISCARD_HEAD, 'BGR-DISCARD-HAPPY final_head preserves the record gate-receipt HEAD');
eq(discardState.cards['Stale slice'].carried_fixtures, [], 'BGR-DISCARD-HAPPY ledger records carried fixtures');
ok(!/\[\[Stale slice\]\]/.test(fs.readFileSync(discardBoardPath, 'utf8')), 'BGR-DISCARD-HAPPY board line is removed from its lane');
ok(!fs.existsSync(discardCardPath), 'BGR-DISCARD-HAPPY card note file is deleted');
ok(discardWrites >= 1, 'BGR-DISCARD-HAPPY ledger write happens first');
ok(/\[\[Stale slice\]\]/.test(discardBoardAtPersist[0]),
  'BGR-DISCARD-HAPPY the board line is still present at tombstone-persist time (ledger-first ordering)');
eq(discardShCalls, [
  ['git', 'worktree', 'list', '--porcelain'],
  ['git', 'branch', '-D', 'codex-autoloop/stale-slice'],
], 'BGR-DISCARD-HAPPY deletes the unguarded branch after checking checkouts');
eq(discarded.branch, { branch: 'codex-autoloop/stale-slice', deleted: true }, 'BGR-DISCARD-HAPPY receipt reports the deleted branch');

// Untracked never-claimed corpse: minimal tombstone, line + note removed.
const corpsePath = path.join(discardCardsRoot, 'Never claimed.md');
fs.writeFileSync(discardBoardPath, liveBoard({ planning: ['Never claimed'] }));
fs.writeFileSync(corpsePath, '---\nstatus: planning\n---\ncorpse body\n');
const corpse = await commandDiscard({ root: discardRoot }, {
  card: 'Never claimed', reason: 'never-claimed corpse', json: true,
}, discardDeps);
eq(corpse.action, 'discarded', 'BGR-DISCARD-HAPPY untracked corpse discard succeeds');
eq(corpse.tracked, false, 'BGR-DISCARD-HAPPY untracked corpse is reported untracked');
eq(discardState.cards['Never claimed'].phase, 'discarded', 'BGR-DISCARD-HAPPY untracked corpse gains a minimal tombstone record');
eq(discardState.cards['Never claimed'].discarded_at, '2026-07-25T12:00:00.000Z', 'BGR-DISCARD-HAPPY corpse tombstone records discarded_at');
eq(discardState.cards['Never claimed'].discard_reason, 'never-claimed corpse', 'BGR-DISCARD-HAPPY corpse tombstone records the reason');
eq(discardState.cards['Never claimed'].final_head, null, 'BGR-DISCARD-HAPPY corpse tombstone has no preserved HEAD');
ok(!fs.existsSync(corpsePath), 'BGR-DISCARD-HAPPY corpse note file is deleted');
ok(!/\[\[Never claimed\]\]/.test(fs.readFileSync(discardBoardPath, 'utf8')), 'BGR-DISCARD-HAPPY corpse board line is removed');

// Status surfaces tombstones without consuming capacity.
const discardStatus = commandStatus({ ...statusCtx, statePath: ctx.statePath }, {
  boardMd: fs.readFileSync(discardBoardPath, 'utf8'), loadCard: () => null, state: discardState,
  cardsRoot: discardCardsRoot,
});
eq(discardStatus.discarded_total, 2, 'status reports the total tombstone count');
eq(discardStatus.discarded_recent.find((item) => item.name === 'Stale slice'), {
  name: 'Stale slice', discarded_at: '2026-07-25T12:00:00.000Z',
  superseded_by: 'Stale slice v2', reason: 'redesigned under BGR',
}, 'status lists recent tombstones with name, time, supersession, and reason');
eq(discardStatus.active_count, 0, 'tombstones never consume active capacity');
eq(discardStatus.tracked.some((record) => record.card === 'Stale slice'), false, 'tombstones have no board projection in the tracked view');

// OPX5-RESIDUE-REPORTED / READ-ONLY: status detects the same tombstone-note
// residue that reap heals, but performs no mutation while doing so.
const opx5Root = path.join(tmp, 'opx5-residue');
const opx5CardsRoot = path.join(opx5Root, 'tasks');
const opx5BoardPath = path.join(opx5Root, 'project-board.md');
const opx5ResiduePath = path.join(opx5CardsRoot, 'GA-OPS14a Residue.md');
fs.mkdirSync(opx5CardsRoot, { recursive: true });
fs.writeFileSync(opx5BoardPath, liveBoard({}));
fs.writeFileSync(opx5ResiduePath, '---\nstatus: archived\n---\nresidual body\n');
const opx5State = emptyState();
opx5State.cards['GA-OPS14a Residue'] = {
  card: 'GA-OPS14a Residue', phase: 'discarded', card_path: opx5ResiduePath,
  discarded_at: '2026-07-26T05:49:28.000Z', discard_reason: 'superseded at mint',
  superseded_by: 'GA-OPS14a2 Successor', final_head: null, carried_fixtures: [],
};
const opx5StateBefore = JSON.stringify(opx5State);
const opx5BoardBefore = fs.readFileSync(opx5BoardPath);
const opx5NoteBefore = fs.readFileSync(opx5ResiduePath);
const opx5WriteMethods = ['appendFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'unlinkSync', 'writeFileSync'];
const opx5OriginalWrites = Object.fromEntries(opx5WriteMethods.map((name) => [name, fs[name]]));
const opx5Writes = [];
let opx5Status;
try {
  for (const name of opx5WriteMethods) {
    fs[name] = (...args) => {
      opx5Writes.push({ name, target: args[0] });
      throw new Error(`OPX5 status attempted filesystem write via ${name}`);
    };
  }
  opx5Status = commandStatus({ root: opx5Root, statePath: path.join(opx5Root, 'state.json') }, {
    boardMd: opx5BoardBefore.toString('utf8'), boardPath: opx5BoardPath,
    loadCard: () => null, state: opx5State, cardsRoot: opx5CardsRoot,
  });
} finally {
  for (const name of opx5WriteMethods) fs[name] = opx5OriginalWrites[name];
}
eq(opx5Status.tombstone_residue, [{
  card: 'GA-OPS14a Residue', path: opx5ResiduePath, heal: 'reap',
}], 'OPX5-RESIDUE-REPORTED status reports the exact discarded-note residue and its sanctioned healer');
eq(opx5Writes, [], 'OPX5-RESIDUE-READ-ONLY status invokes no filesystem write seam');
eq(JSON.stringify(opx5State), opx5StateBefore, 'OPX5-RESIDUE-READ-ONLY status keeps the ledger object byte-stable');
eq(fs.readFileSync(opx5BoardPath), opx5BoardBefore, 'OPX5-RESIDUE-READ-ONLY status keeps board bytes stable');
eq(fs.readFileSync(opx5ResiduePath), opx5NoteBefore, 'OPX5-RESIDUE-READ-ONLY status keeps residue-note bytes stable');

// OPX5-DIGEST-SURFACES-RESIDUE: current residue is an attention-lite digest
// block; an empty field is omitted so the pre-OPX5 digest shape is unchanged.
const opx5Digest = deliveryStatusDigest.buildDigest(opx5Status, '', []);
eq(opx5Digest.tombstoneResidue, {
  count: 1,
  entries: [{ card: 'GA-OPS14a Residue', path: opx5ResiduePath, heal: 'reap' }],
}, 'OPX5-DIGEST-SURFACES-RESIDUE digest carries the residue count and exact entries');
const opx5DigestBaseline = deliveryStatusDigest.buildDigest({
  ...opx5Status, tombstone_residue: undefined,
}, '', []);
const opx5DigestEmpty = deliveryStatusDigest.buildDigest({
  ...opx5Status, tombstone_residue: [],
}, '', []);
eq(JSON.stringify(opx5DigestEmpty), JSON.stringify(opx5DigestBaseline),
  'OPX5-DIGEST-SURFACES-RESIDUE residue-free status keeps the prior digest shape byte-identical');

// OPX5-RESIDUE-CLEAN-AFTER-REAP: reap remains the only healer; status observes
// its deletion and an empty discarded set deterministically reports [].
const opx5ReapDeps = {
  readState: () => opx5State,
  writeState: () => {},
  withLock: async (_ctx, _name, fn) => fn(),
  boardPath: opx5BoardPath, cardsRoot: opx5CardsRoot,
  worktreeExists: () => false, sh: () => '',
  now: () => '2026-07-26T12:00:00.000Z',
};
const opx5Reaped = await commandReap({ root: opx5Root }, { json: true }, opx5ReapDeps);
eq(opx5Reaped.residue_notes_deleted, [{
  card: 'GA-OPS14a Residue', path: opx5ResiduePath,
}], 'OPX5-RESIDUE-CLEAN-AFTER-REAP reap deletes the detected residue');
const opx5CleanStatus = commandStatus({ root: opx5Root, statePath: path.join(opx5Root, 'state.json') }, {
  boardMd: fs.readFileSync(opx5BoardPath, 'utf8'), boardPath: opx5BoardPath,
  loadCard: () => null, state: opx5State, cardsRoot: opx5CardsRoot,
});
eq(opx5CleanStatus.tombstone_residue, [],
  'OPX5-RESIDUE-CLEAN-AFTER-REAP status is empty after reap heals the note');
eq(commandStatus({ root: opx5Root, statePath: path.join(opx5Root, 'empty-state.json') }, {
  boardMd: liveBoard({}), boardPath: opx5BoardPath,
  loadCard: () => null, state: emptyState(), cardsRoot: opx5CardsRoot,
}).tombstone_residue, [], 'OPX5-RESIDUE-CLEAN-AFTER-REAP a ledger without tombstones reports an empty array');

// OPX5-REAP-LAZY-EXISTENCE: sharing the predicate must preserve reap's
// per-record existence check. If corrupt tombstones alias one note path, the
// first deletion makes the second a clean skip rather than a false refusal.
const opx5SharedPath = path.join(opx5CardsRoot, 'Shared residue.md');
fs.writeFileSync(opx5SharedPath, '---\nstatus: archived\n---\nshared residue\n');
const opx5AliasedState = emptyState();
opx5AliasedState.cards['Aliased residue A'] = {
  card: 'Aliased residue A', phase: 'discarded', card_path: opx5SharedPath,
};
opx5AliasedState.cards['Aliased residue B'] = {
  card: 'Aliased residue B', phase: 'discarded', card_path: opx5SharedPath,
};
const opx5AliasedReap = await commandReap({ root: opx5Root }, { json: true }, {
  ...opx5ReapDeps, readState: () => opx5AliasedState,
});
eq(opx5AliasedReap.residue_notes_deleted, [{
  card: 'Aliased residue A', path: opx5SharedPath,
}], 'OPX5-REAP-LAZY-EXISTENCE the first aliased tombstone deletes the shared residue');
eq(opx5AliasedReap.residue_notes_refused, [],
  'OPX5-REAP-LAZY-EXISTENCE the second aliased tombstone observes deletion and skips cleanly');

ok(typeof buildLoopStationPayload === 'function'
  && typeof validateLoopStationPayload === 'function'
  && typeof projectLoopStation === 'function',
'OPX2-PAYLOAD-SCHEMA exposes the deterministic Loop Station payload, validator, and projection seam');

// OPX2-PAYLOAD-SCHEMA / EXACT-ACTION / BOUNDED: one render-ready payload,
// reuse of triage + digest semantics, and an explicit overflow count beside
// every capped list.
const opx2Root = path.join(tmp, 'opx2-loop-station');
const opx2StationPath = path.join(opx2Root, 'spice', 'projects', 'sauce', 'Loop Station.md');
const opx2Ratifications = path.join(path.dirname(opx2StationPath), 'ratifications');
fs.mkdirSync(opx2Ratifications, { recursive: true });
fs.writeFileSync(path.join(opx2Ratifications, 'ESC0.md'), 'pending\n');
const opx2State = emptyState();
const opx2Active = { card: 'ACTIVE0 Working slice', phase: 'implementing', parent_card: '[[Loop Ops]]' };
opx2State.cards[opx2Active.card] = opx2Active;
const opx2Parked = [];
const opx2Tracked = [{ card: opx2Active.card, phase: 'implementing', status: 'in_progress' }];
for (let i = 0; i < 25; i++) {
  const escalation = `ESC${i} Escalation`;
  const wait = `WAIT${i} Deploy wait`;
  opx2State.cards[escalation] = { card: escalation, phase: 'parked', parent_card: '[[Loop Ops]]' };
  opx2State.cards[wait] = { card: wait, phase: 'parked', parent_card: '[[Other Epic]]' };
  opx2Parked.push(
    { card: escalation, phase: 'parked', resume_condition: `Will ratifies decision ${i}` },
    { card: wait, phase: 'parked', resume_condition: `resume after release deploys ${i}` },
  );
  opx2Tracked.push(
    { card: escalation, phase: 'parked', status: 'parked' },
    { card: wait, phase: 'parked', status: 'parked' },
  );
}
const opx2Status = {
  action: 'status',
  active: [{ card: opx2Active.card, phase: 'implementing' }],
  parked: opx2Parked,
  tracked: opx2Tracked,
  projection_problems: [],
  discarded_recent: Array.from({ length: 25 }, (_, i) => ({
    name: `DEAD${i}`, discarded_at: `2026-07-26T10:${String(i).padStart(2, '0')}:00.000Z`,
    reason: 'superseded', superseded_by: null,
  })),
  cutover_history: Array.from({ length: 25 }, (_, i) => ({
    enabled: i % 2 === 0, at: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
  })),
  tombstone_residue: Array.from({ length: 25 }, (_, i) => ({
    card: `RES${i}`, path: `/cards/RES${i}.md`, heal: 'reap',
  })),
  state_path: path.join(opx2Root, 'state.json'),
};
const opx2Fid = Array.from({ length: 25 }, (_, i) =>
  `## Amendment ${i} — SELF-RATIFIED 2026-07-${String(i + 1).padStart(2, '0')}`).join('\n');
const opx2Releases = Array.from({ length: 25 }, (_, i) => `0.${300 - i}.0`);
const opx2Payload = buildLoopStationPayload({
  status: opx2Status, state: opx2State, fidText: opx2Fid, lastSeen: null,
  updatedOn: 'park', updatedAt: '2026-07-26T12:00:00.000Z',
  stationPath: opx2StationPath, releases: opx2Releases,
});
eq(validateLoopStationPayload(opx2Payload), { ok: true, errors: [] },
  'OPX2-PAYLOAD-SCHEMA the complete projected payload validates against sauce.loop-station.v1');
ok(opx2Payload.exact_action.includes('ESC0 Escalation')
  && opx2Payload.exact_action.includes('[[spice/projects/sauce/ratifications/ESC0]]'),
'OPX2-EXACT-ACTION names the first escalation and its existing ratification artifact');
eq(opx2Payload.active, { card: opx2Active.card, phase: 'implementing', epic: 'Loop Ops' },
  'OPX2-PAYLOAD-SCHEMA active carries card, phase, and epic');
for (const [label, list, overflow] of [
  ['needs_attention', opx2Payload.needs_attention, opx2Payload.needs_attention_overflow_count],
  ['waiting', opx2Payload.waiting, opx2Payload.waiting_overflow_count],
  ['releases_recent', opx2Payload.releases_recent, opx2Payload.releases_recent_overflow_count],
  ['tombstone_residue', opx2Payload.tombstone_residue, opx2Payload.tombstone_residue_overflow_count],
  ['since.discards', opx2Payload.since.discards, opx2Payload.since.discards_overflow_count],
  ['since.self_ratified', opx2Payload.since.self_ratified, opx2Payload.since.self_ratified_overflow_count],
  ['since.cutover_flips', opx2Payload.since.cutover_flips, opx2Payload.since.cutover_flips_overflow_count],
]) {
  eq(list.length, 20, `OPX2-BOUNDED ${label} caps at twenty`);
  eq(overflow, 5, `OPX2-BOUNDED ${label} records five overflow entries`);
}
eq(opx2Payload.counts.needs_attention, 25, 'OPX2-BOUNDED counts preserve the unbounded needs-attention total');
eq(opx2Payload.counts.waiting, 25, 'OPX2-BOUNDED counts preserve the unbounded genuine-wait total');
const opx2NoAction = buildLoopStationPayload({
  status: {
    ...opx2Status, active: [], parked: [], tracked: [], discarded_recent: [],
    cutover_history: [], tombstone_residue: [],
  },
  state: emptyState(), fidText: '', lastSeen: null, updatedOn: 'resume',
  updatedAt: '2026-07-26T12:01:00.000Z', stationPath: opx2StationPath, releases: [],
});
eq(opx2NoAction.exact_action, null, 'OPX2-EXACT-ACTION no escalation state projects exact_action null');

// OPX2-BODY-PRESERVED / IDEMPOTENT-REPLAY / PEEK-NEVER-ADVANCES.
fs.mkdirSync(path.dirname(opx2StationPath), { recursive: true });
const opx2Body = '\n\nCUSTOM OPERATOR BODY — coordinator must never rewrite this.\n';
fs.writeFileSync(opx2StationPath, `---\ntype: loop-station\n---${opx2Body}`);
const opx2MarkerPath = path.join(opx2Root, '.delivery-digest-last-seen');
fs.writeFileSync(opx2MarkerPath, '2026-07-25T00:00:00.000Z');
const opx2MarkerBefore = fs.readFileSync(opx2MarkerPath);
let opx2StationWrites = 0;
let opx2NowCalls = 0;
let opx2UnexpectedBoardReads = 0;
const opx2InjectedBoardPath = path.join(opx2Root, 'machine-default-board-must-not-be-read.md');
const opx2ProjectionDeps = {
  status: opx2Status, boardPath: opx2InjectedBoardPath,
  stationPath: opx2StationPath, markerPath: opx2MarkerPath,
  fidText: opx2Fid, releases: opx2Releases,
  now: () => `2026-07-26T12:0${opx2NowCalls++}:00.000Z`,
  readText: (target) => {
    if (target === opx2InjectedBoardPath) {
      opx2UnexpectedBoardReads++;
      throw new Error(`unexpected injected-status read: ${target}`);
    }
    return fs.readFileSync(target, 'utf8');
  },
  writeText: (target, raw) => { opx2StationWrites++; fs.writeFileSync(target, raw); },
};
const opx2Projected = projectLoopStation(
  { root: opx2Root, statePath: path.join(opx2Root, 'state.json') },
  opx2State, 'park', opx2ProjectionDeps,
);
eq(opx2Projected.changed, true, 'OPX2-BODY-PRESERVED first projection changes frontmatter');
eq(opx2StationWrites, 1, 'OPX2-BODY-PRESERVED first projection performs exactly one station write');
eq(opx2UnexpectedBoardReads, 0,
  'OPX2-INJECTED-STATUS-ISOLATION injected authoritative status performs no machine-default board read');
ok(fs.readFileSync(opx2StationPath, 'utf8').endsWith(opx2Body),
  'OPX2-BODY-PRESERVED existing station body remains byte-identical');
ok(!fs.readFileSync(opx2StationPath, 'utf8').includes('GraphView'),
  'OPX2-BODY-PRESERVED the coordinator never injects the GraphView mount into an existing station body');
const opx2ProjectedBytes = fs.readFileSync(opx2StationPath);
const opx2Replay = projectLoopStation(
  { root: opx2Root, statePath: path.join(opx2Root, 'state.json') },
  opx2State, 'park', opx2ProjectionDeps,
);
eq(opx2Replay.no_op, true, 'OPX2-IDEMPOTENT-REPLAY identical transition replay is an explicit no-op');
eq(opx2StationWrites, 1, 'OPX2-IDEMPOTENT-REPLAY identical replay performs zero churn writes');
eq(fs.readFileSync(opx2StationPath), opx2ProjectedBytes,
  'OPX2-IDEMPOTENT-REPLAY station frontmatter and body stay byte-identical');
eq(fs.readFileSync(opx2MarkerPath), opx2MarkerBefore,
  'OPX2-PEEK-NEVER-ADVANCES projection leaves the digest last-seen marker byte-identical');
eq(opx2Projected.payload.since.marker_at, '2026-07-25T00:00:00.000Z',
  'OPX2-PEEK-NEVER-ADVANCES payload carries the peeked marker value');
const opx2MalformedTimestamp = fs.readFileSync(opx2StationPath, 'utf8')
  .replace(/updated_at: "[^"]+"/, 'updated_at: "not-an-iso-timestamp"');
fs.writeFileSync(opx2StationPath, opx2MalformedTimestamp);
const opx2TimestampWritesBefore = opx2StationWrites;
const opx2TimestampHealed = projectLoopStation(
  { root: opx2Root, statePath: path.join(opx2Root, 'state.json') },
  opx2State, 'park', opx2ProjectionDeps,
);
eq(opx2TimestampHealed.changed, true,
  'OPX2-PAYLOAD-SCHEMA malformed prior updated_at is healed instead of reused after validation');
eq(opx2StationWrites, opx2TimestampWritesBefore + 1,
  'OPX2-PAYLOAD-SCHEMA malformed prior updated_at performs one corrective projection write');
ok(Number.isFinite(Date.parse(
  fs.readFileSync(opx2StationPath, 'utf8').match(/updated_at: "([^"]+)"/)[1],
)), 'OPX2-PAYLOAD-SCHEMA healed station carries a valid updated_at timestamp');
ok(fs.readFileSync(opx2StationPath, 'utf8').endsWith(opx2Body),
  'OPX2-BODY-PRESERVED timestamp healing still preserves the existing station body byte-identically');

const opx2MissingStationPath = path.join(opx2Root, 'missing', 'Loop Station.md');
let opx2ScaffoldWrites = 0;
const opx2ScaffoldDeps = {
  ...opx2ProjectionDeps, stationPath: opx2MissingStationPath,
  writeText: (target, raw) => { opx2ScaffoldWrites++; fs.writeFileSync(target, raw); },
};
const opx2Scaffolded = projectLoopStation(
  { root: opx2Root, statePath: path.join(opx2Root, 'state.json') },
  opx2State, 'deploy', opx2ScaffoldDeps,
);
eq(opx2Scaffolded.scaffolded, true, 'OPX2-BODY-PRESERVED a missing station is scaffolded exactly once');
const opx2ScaffoldBody = fs.readFileSync(opx2MissingStationPath, 'utf8');
ok(/customjs-guard.*OperatorStation/.test(opx2ScaffoldBody),
  'OPX2-BODY-PRESERVED scaffold carries the stock OperatorStation render body');
ok(opx2ScaffoldBody.includes('{ class: "GraphView", args: [{ scope: "project" }] }'),
  'OPX2-SCAFFOLD-GRAPH scaffold-if-absent body mounts the project-scope GraphView block');
ok(opx2ScaffoldBody.indexOf('class: "OperatorStation"') < opx2ScaffoldBody.indexOf('class: "GraphView"'),
  'OPX2-SCAFFOLD-GRAPH the GraphView mount sits after the OperatorStation block');
eq(projectLoopStation(
  { root: opx2Root, statePath: path.join(opx2Root, 'state.json') },
  opx2State, 'deploy', opx2ScaffoldDeps,
).no_op, true, 'OPX2-IDEMPOTENT-REPLAY scaffold replay is a no-op');
eq(opx2ScaffoldWrites, 1, 'OPX2-IDEMPOTENT-REPLAY scaffold replay performs zero writes');

// OPX2-STATUS-NO-WRITE-MUTATION: intercept the real atomic writer used by
// projectLoopStation at the exact station target. Status must perform zero
// writes, while the positive-control projector must hit the trap exactly once;
// adding that projector to status therefore turns this fixture red.
const opx2ReadOnlyBoard = path.join(opx2Root, 'read-only', 'sauce-board.md');
const opx2ReadOnlyStation = path.join(path.dirname(opx2ReadOnlyBoard), 'Loop Station.md');
const opx2OriginalWriteFileSync = fs.writeFileSync;
const opx2ReadWriteAttempts = [];
fs.writeFileSync = (target) => {
  opx2ReadWriteAttempts.push(String(target));
  throw new Error('OPX2-STATUS-NO-WRITE-MUTATION trapped a forbidden station write');
};
try {
  commandStatus({ root: opx2Root, statePath: path.join(opx2Root, 'status-state.json') }, {
    state: emptyState(), boardMd: liveBoard({}), boardPath: opx2ReadOnlyBoard,
    cardsRoot: path.join(opx2Root, 'read-only-cards'), loadCard: () => null,
  });
  eq(opx2ReadWriteAttempts, [],
    'OPX2-STATUS-NO-WRITE-MUTATION status reaches zero production-writer calls');
  commandRecover({ root: opx2Root }, { state: emptyState(), sh: () => '' });
  eq(opx2ReadWriteAttempts, [],
    'OPX2-STATUS-NO-WRITE-MUTATION read-only recovery inspection reaches zero production-writer calls');
  assert.throws(() => projectLoopStation(
    { root: opx2Root, statePath: path.join(opx2Root, 'status-state.json') },
    opx2State, 'status-positive-control', {
      status: opx2Status, stationPath: opx2ReadOnlyStation, markerPath: null,
      fidText: opx2Fid, releases: opx2Releases,
      now: () => '2026-07-26T12:30:00.000Z',
    },
  ), /OPX2-STATUS-NO-WRITE-MUTATION trapped/,
  'OPX2-STATUS-NO-WRITE-MUTATION positive-control projection turns the writer oracle red'); count++;
  eq(opx2ReadWriteAttempts.length, 1,
    'OPX2-STATUS-NO-WRITE-MUTATION positive control reaches the exact atomic station writer once');
} finally {
  fs.writeFileSync = opx2OriginalWriteFileSync;
}
ok(!fs.existsSync(opx2ReadOnlyStation),
  'OPX2-TRANSITION-ONLY status and the trapped positive control leave the actual station target absent');

// BGR-DISCARD-REPLAY-NOOP: literal replay is a no-op with zero writes.
const replayWritesBefore = discardWrites;
const replayShBefore = discardShCalls.length;
const replayStationBefore = opx2DiscardProjections.length;
const replayBoardBytes = fs.readFileSync(discardBoardPath, 'utf8');
const replayStateBytes = JSON.stringify(discardState);
const discardReplay = await commandDiscard({ root: discardRoot }, discardArgs, discardDeps);
eq(discardReplay.action, 'discarded', 'BGR-DISCARD-REPLAY-NOOP literal replay reports discarded');
eq(discardReplay.no_op, true, 'BGR-DISCARD-REPLAY-NOOP literal replay is an explicit no-op');
eq(discardWrites, replayWritesBefore, 'BGR-DISCARD-REPLAY-NOOP replay performs zero ledger writes');
eq(discardShCalls.length, replayShBefore, 'BGR-DISCARD-REPLAY-NOOP replay performs zero git operations');
eq(opx2DiscardProjections.length, replayStationBefore,
  'OPX2-TRANSITION-ONLY discard replay fires no additional Loop Station projection');
eq(fs.readFileSync(discardBoardPath, 'utf8'), replayBoardBytes, 'BGR-DISCARD-REPLAY-NOOP replay keeps board bytes stable');
eq(JSON.stringify(discardState), replayStateBytes, 'BGR-DISCARD-REPLAY-NOOP replay keeps ledger state byte-stable');
await assert.rejects(() => commandDiscard({ root: discardRoot }, {
  ...discardArgs, reason: 'a different reason',
}, discardDeps), /already discarded/, 'BGR-DISCARD-REPLAY-NOOP non-literal replay of a tombstone refuses');

// BGR-DISCARD-ACTIVE-REFUSED: active claim and every in-flight phase refuse with zero writes.
for (const phase of ['claimed', 'implementing', 'feature_pr', 'feature_merged', 'release_pr',
  'release_merged', 'tagged', 'tap_pr', 'tap_merged', 'brew_installed', 'deploying', 'needs-inspection', 'deployed']) {
  const activeState = emptyState();
  activeState.cards.Active = { card: 'Active', phase, card_path: path.join(discardCardsRoot, 'missing.md') };
  let activeWrites = 0;
  await assert.rejects(() => commandDiscard({ root: discardRoot }, {
    card: 'Active', reason: 'attempted discard of live work', json: true,
  }, {
    ...discardDeps, readState: () => activeState, writeState: () => { activeWrites++; },
  }), /discard refuses/, `BGR-DISCARD-ACTIVE-REFUSED refuses phase ${phase}`);
  eq(activeWrites, 0, `BGR-DISCARD-ACTIVE-REFUSED ${phase} refusal performs zero writes`);
  eq(activeState.cards.Active.phase, phase, `BGR-DISCARD-ACTIVE-REFUSED ${phase} refusal preserves the record`);
}

// BGR-DISCARD-TOMBSTONE-UNCLAIMABLE: a hand-added board line with a tombstoned name is never claimed.
const unclaimableSelection = selectClaimCandidate({
  boardMd: board(['Stale slice']), state: discardState,
  loadCard: () => { throw new Error('claim must never load a tombstoned card'); },
});
eq(unclaimableSelection.action, 'no-work', 'BGR-DISCARD-TOMBSTONE-UNCLAIMABLE tombstoned board line yields no work');
ok(unclaimableSelection.skipped.some((item) => item.card === 'Stale slice' && /already tracked \(discarded\)/.test(item.reason)),
  'BGR-DISCARD-TOMBSTONE-UNCLAIMABLE claim guard skips the tombstoned name explicitly');

// BGR-DISCARD-DEP-FAILS-LOUD: a dependency on a tombstone is never satisfied and never checkbox-satisfied.
const depState = emptyState();
depState.cards['Dead dep'] = {
  card: 'Dead dep', phase: 'discarded', discarded_at: '2026-07-25T12:00:00.000Z',
  discard_reason: 'redesigned', superseded_by: 'Dead dep v2',
};
const depBoard = board(['Dependent'], ['Dead dep']);
eq(dependencySatisfied('Dead dep', null, depState, depBoard), false,
  'BGR-DISCARD-DEP-FAILS-LOUD a tombstoned dependency is never satisfied even with a checked Completed checkbox');
eq(discardedDependencyProblem('Dead dep', depState), 'depends on discarded card Dead dep (superseded by Dead dep v2)',
  'BGR-DISCARD-DEP-FAILS-LOUD the discarded-dependency finding names the tombstone and its successor');
eq(discardedDependencyProblem('Alive dep', depState), null,
  'BGR-DISCARD-DEP-FAILS-LOUD non-tombstoned dependencies produce no discarded finding');
const depSelection = selectClaimCandidate({
  boardMd: depBoard, state: depState,
  loadCard: (name) => name === 'Dependent'
    ? { path: '/cards/Dependent.md', raw: card({ name: 'Dependent', deps: ['Dead dep'], zones: ['platform/dependent'] }) } : null,
});
eq(depSelection.action, 'no-work', 'BGR-DISCARD-DEP-FAILS-LOUD a dependent card is not claimable');
ok(/depends on discarded card Dead dep/.test(depSelection.skipped[0].reason),
  'BGR-DISCARD-DEP-FAILS-LOUD claim skip reason is the explicit discarded-dependency error, not the checkbox fallback');

// BGR-DISCARD-PROJECTION-NULL: tombstones project to nothing; reconcile is a clean no-op.
eq(projectionMapping('discarded'), null, 'BGR-DISCARD-PROJECTION-NULL projectionMapping(discarded) is null');
const tombstoneReconcileWritesBefore = discardWrites;
const tombstoneReconcile = await commandReconcile({ root: discardRoot }, { card: 'Stale slice' }, {
  readState: () => discardState, writeState: () => { discardWrites++; },
  withLock: immediateCardLock, boardPath: discardBoardPath, cardsRoot: discardCardsRoot,
});
eq(tombstoneReconcile.action, 'reconciled', 'BGR-DISCARD-PROJECTION-NULL reconcile of a tombstone succeeds');
eq(tombstoneReconcile.no_op, true, 'BGR-DISCARD-PROJECTION-NULL reconcile of a tombstone is a no-op');
eq(tombstoneReconcile.results[0].skipped, 'phase has no board projection',
  'BGR-DISCARD-PROJECTION-NULL tombstone reconcile skips projection entirely');
eq(discardWrites, tombstoneReconcileWritesBefore, 'BGR-DISCARD-PROJECTION-NULL tombstone reconcile performs zero writes');
ok(!discardState.cards['Stale slice'].projection_error,
  'BGR-DISCARD-PROJECTION-NULL absence of the board line is the correct projection, never a projection_error');

// BGR-DISCARD-BRANCH-GUARD: open PR or checked-out branch refuses deletion; discard still completes.
const guardedPath = path.join(discardCardsRoot, 'Guarded.md');
fs.writeFileSync(discardBoardPath, liveBoard({ blocked: ['Guarded'] }));
fs.writeFileSync(guardedPath, '---\nstatus: blocked\n---\nguarded body\n');
const guardState = emptyState();
guardState.cards.Guarded = {
  card: 'Guarded', phase: 'blocked', reason: 'feature PR CLOSED', feature_pr: 321,
  branch: 'codex-autoloop/guarded', worktree: path.join(discardRoot, 'guarded-worktree'), card_path: guardedPath,
};
const guardShCalls = [];
const guarded = await commandDiscard({ root: discardRoot }, {
  card: 'Guarded', reason: 'abandoned closed PR', json: true,
}, {
  ...discardDeps, readState: () => guardState, writeState: () => {},
  worktreeExists: () => true,
  sh: (cmd, args) => { guardShCalls.push([cmd, ...args]); return ''; },
});
eq(guarded.action, 'discarded', 'BGR-DISCARD-BRANCH-GUARD the discard itself still completes');
eq(guardState.cards.Guarded.phase, 'discarded', 'BGR-DISCARD-BRANCH-GUARD ledger still becomes discarded');
eq(guarded.branch.retained_unsafe_to_delete, true, 'BGR-DISCARD-BRANCH-GUARD recorded-PR branch is flagged retained_unsafe_to_delete');
ok(/record has feature PR #321 recorded; branch deletion not verified safe/.test(guarded.branch.reason),
  'BGR-DISCARD-BRANCH-GUARD recorded-PR retention names its reason without claiming the PR is open');
ok(guardShCalls.some((call) => call[1] === 'worktree' && call[2] === 'remove'),
  'BGR-DISCARD-BRANCH-GUARD the record worktree is still removed');
ok(!guardShCalls.some((call) => call[1] === 'branch'), 'BGR-DISCARD-BRANCH-GUARD no branch deletion is attempted with a recorded PR');
const checkedPath = path.join(discardCardsRoot, 'Checked out.md');
fs.writeFileSync(discardBoardPath, liveBoard({ blocked: ['Checked out'] }));
fs.writeFileSync(checkedPath, '---\nstatus: blocked\n---\nchecked body\n');
const checkedState = emptyState();
checkedState.cards['Checked out'] = {
  card: 'Checked out', phase: 'blocked', reason: 'stuck', branch: 'codex-autoloop/checked-out', card_path: checkedPath,
  gate_receipt: passingReceipt('not-a-canonical-sha'),
};
const checkedShCalls = [];
const checkedOut = await commandDiscard({ root: discardRoot }, {
  card: 'Checked out', reason: 'superseded while checked out', json: true,
}, {
  ...discardDeps, readState: () => checkedState, writeState: () => {},
  worktreeExists: () => false,
  sh: (cmd, args) => {
    checkedShCalls.push([cmd, ...args]);
    if (args[0] === 'worktree' && args[1] === 'list') {
      return ['worktree /elsewhere', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/codex-autoloop/checked-out', ''].join('\n');
    }
    return '';
  },
});
eq(checkedOut.action, 'discarded', 'BGR-DISCARD-BRANCH-GUARD checked-out branch discard still completes');
eq(checkedOut.branch.retained_unsafe_to_delete, true, 'BGR-DISCARD-BRANCH-GUARD checked-out branch is retained');
ok(/checked out/.test(checkedOut.branch.reason), 'BGR-DISCARD-BRANCH-GUARD checked-out retention names its reason');
ok(!checkedShCalls.some((call) => call[1] === 'branch'), 'BGR-DISCARD-BRANCH-GUARD no branch deletion when a worktree holds the branch');
eq(checkedState.cards['Checked out'].final_head, null,
  'a malformed preserved gate-receipt HEAD never becomes a tombstone final_head (canonical 40-hex or null)');

// BGR-DISCARD-EPIC-ROLLUP: discarding a canonical epic slice reprojects the epic without it.
const rollup = makeEpicProjectionFixture('bgr-discard-rollup');
rollup.state.cards.A1.phase = 'parked';
rollup.state.cards.A1.branch = 'codex-autoloop/a1';
const rollupResult = await commandDiscard({ root: rollup.root }, {
  card: 'A1', 'superseded-by': 'A1b', reason: 'resliced under BGR', json: true,
}, {
  readState: () => rollup.state, writeState: () => {},
  withLock: async (_ctx, _name, fn) => fn(),
  boardPath: rollup.parentBoardPath, cardsRoot: rollup.cardsRoot,
  worktreeExists: () => false, sh: () => '', now: () => '2026-07-25T13:00:00.000Z',
});
eq(rollupResult.action, 'discarded', 'BGR-DISCARD-EPIC-ROLLUP canonical slice discard succeeds');
eq(rollup.state.cards.A1.phase, 'discarded', 'BGR-DISCARD-EPIC-ROLLUP slice ledger becomes a tombstone');
ok(!/\[\[A1\]\]/.test(fs.readFileSync(rollup.epicBoardPath, 'utf8')), 'BGR-DISCARD-EPIC-ROLLUP discarded slice disappears from the epic board');
ok(!fs.existsSync(rollup.cardPath), 'BGR-DISCARD-EPIC-ROLLUP discarded slice note is deleted');
const rollupParent = fs.readFileSync(rollup.parentBoardPath, 'utf8');
const rollupPlanningIdx = rollupParent.indexOf('## In Planning');
const rollupProgressIdx = rollupParent.indexOf('## In Progress');
const rollupEpicIdx = rollupParent.indexOf('- [ ] [[Epic A]]');
ok(rollupEpicIdx > rollupPlanningIdx && rollupEpicIdx < rollupProgressIdx,
  'BGR-DISCARD-EPIC-ROLLUP the parent rollup recomputes the epic from surviving slices');
ok(!/- \[x\] \[\[Epic A\]\]/.test(rollupParent), 'BGR-DISCARD-EPIC-ROLLUP the epic is no longer checked Completed');
const rollupAtlas = fs.readFileSync(rollup.atlasPath, 'utf8');
ok(/status: planned/.test(rollupAtlas) && /posture: claimable/.test(rollupAtlas),
  'BGR-DISCARD-EPIC-ROLLUP the atlas recomputes without the tombstone');
eq(rollupResult.epic.state, 'planned', 'BGR-DISCARD-EPIC-ROLLUP receipt reports the recomputed epic state');

// CLI wiring: the discard command exists and refuses without --json before any read or write.
{
  const { execFileSync: execCli } = require('child_process');
  const coordinatorCli = path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js');
  let cliError = null;
  try {
    execCli('node', [coordinatorCli, 'discard', '--card', 'X', '--reason', 'r'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) { cliError = err; }
  ok(cliError && /requires --json/.test(String(cliError.stderr)),
    'CLI discard without --json refuses with a machine-parseable error before any read or write');
}

// --- BGR redesign: idempotent reap ---

// BGR-REAP-STEM-EXACT: the ported triage inference is token-exact.
eq(stemOf('ES4a Something bounded'), 'ES4', 'BGR-REAP-STEM-EXACT stem strips a single lowercase supersession suffix');
eq(stemOf('ES4a2 Something rebuilt'), 'ES4', 'BGR-REAP-STEM-EXACT stem strips a lowercase letter + digits suffix');
eq(stemOf('ES41 No suffix here'), 'ES41', 'BGR-REAP-STEM-EXACT ids without a lowercase suffix are their own stem');
eq(stemOf('GA-C9a2'), 'GA-C9', 'BGR-REAP-STEM-EXACT stem handles hyphenated card ids');
const stemTracked = [
  { card: 'ES4a2 Rebuilt renderer (supersedes ES4a)', status: 'deployed' },
  { card: 'ES5a2 Rebuilt without marker', status: 'deployed' },
  { card: 'ES6a2 Pending successor (supersedes ES6a)', status: 'parked' },
];
eq(hasDeployedSupersedingSibling({ card: 'ES4a Original renderer' }, stemTracked), true,
  'BGR-REAP-STEM-EXACT a deployed stem-sibling with a supersession marker is a corpse signal');
eq(hasDeployedSupersedingSibling({ card: 'ES5a Original renderer' }, stemTracked), false,
  'BGR-REAP-STEM-EXACT a deployed stem-sibling without the marker is not a corpse signal');
eq(hasDeployedSupersedingSibling({ card: 'ES6a Original renderer' }, stemTracked), false,
  'BGR-REAP-STEM-EXACT a non-deployed successor is not a corpse signal');
eq(hasDeployedSupersedingSibling({ card: 'ES4a2 Rebuilt renderer (supersedes ES4a)' }, stemTracked), false,
  'BGR-REAP-STEM-EXACT a card is never its own superseding sibling (id tokens are exact)');
eq(hasDeployedSupersedingSibling({ card: 'ES40a Widened scope' }, stemTracked), false,
  'BGR-REAP-STEM-EXACT stem matching is token-exact, never substring: ES40a does not match the ES4 stem');
eq(hasDeployedSupersedingSibling({ card: 'ES7a Legacy pass' },
  [{ card: 'ES7a2 Wrap-up (final value-review completion)', status: 'completed' }]), true,
  'BGR-REAP-STEM-EXACT completed final value-review successors also mark corpses');

// BGR-REAP-CORPSES / STUBS / DUPES / RESIDUE-HEAL: one sweep over a live board.
const reapRoot = path.join(tmp, 'bgr-reap');
const reapProjectRoot = path.join(reapRoot, 'spice', 'projects', 'test');
const reapCardsRoot = path.join(reapProjectRoot, 'tasks');
fs.mkdirSync(reapCardsRoot, { recursive: true });
const reapBoardPath = path.join(reapProjectRoot, 'project-board.md');
fs.writeFileSync(reapBoardPath, [
  '---', 'kanban-plugin: board', '---', '',
  '## In Planning',
  '- [ ] [[Decomposed parent]] (decomposed → [[Child one]] → [[Child two]])',
  '- [ ] [[Settled container]] (decomposed → [[Done child]] → [[Dead child]])',
  '- [ ] [[Docs $$ parent]] (docs-only → [[Some doc]])',
  '- [ ] [[Dupe card]]',
  '- [ ] [[Dupe card]]',
  '',
  '## In Progress',
  '- [ ] [[ES9a Old renderer]]',
  '- [ ] [[Keeper parked]]',
  '- [ ] [[Ghost residue]]',
  '',
  '## Blocked', '',
  '## Completed',
  '- [x] [[Done child]]',
  '- [x] [[ES9a2 Renderer rework (supersedes ES9a)]]',
  '',
].join('\n'));
const reapCorpsePath = path.join(reapCardsRoot, 'ES9a Old renderer.md');
const reapKeeperPath = path.join(reapCardsRoot, 'Keeper parked.md');
const reapGhostPath = path.join(reapCardsRoot, 'Ghost residue.md');
fs.writeFileSync(reapCorpsePath, '---\nstatus: parked\n---\nold renderer body\n');
fs.writeFileSync(reapKeeperPath, '---\nstatus: parked\n---\nkeeper body\n');
fs.writeFileSync(reapGhostPath, '---\nstatus: parked\n---\nghost body\n');
const REAP_HEAD = 'e'.repeat(40);
const reapState = emptyState();
reapState.cards['ES9a Old renderer'] = {
  card: 'ES9a Old renderer', phase: 'parked', card_path: reapCorpsePath,
  branch: 'codex-autoloop/es9a', dependencies: ['ES9 base'], resume_condition: 'never satisfied',
  gate_receipt: passingReceipt(REAP_HEAD),
};
reapState.cards['ES9a2 Renderer rework (supersedes ES9a)'] = {
  card: 'ES9a2 Renderer rework (supersedes ES9a)', phase: 'deployed',
};
reapState.cards['Keeper parked'] = {
  card: 'Keeper parked', phase: 'parked', card_path: reapKeeperPath,
  dependencies: ['Something real'], resume_condition: 'still real',
};
reapState.cards['Dead child'] = {
  card: 'Dead child', phase: 'discarded', discarded_at: '2026-07-24T00:00:00.000Z',
  discard_reason: 'superseded', superseded_by: null, final_head: null, carried_fixtures: [],
};
reapState.cards['Ghost residue'] = {
  card: 'Ghost residue', phase: 'discarded', card_path: reapGhostPath,
  discarded_at: '2026-07-24T00:00:00.000Z', discard_reason: 'crashed mid-discard',
  superseded_by: null, final_head: null, carried_fixtures: [],
};
let reapWrites = 0;
const reapLocks = [];
const reapShCalls = [];
const opx2ReapProjections = [];
const reapDeps = {
  readState: () => reapState,
  writeState: () => { reapWrites++; },
  withLock: async (_ctx, name, fn) => { reapLocks.push(name); return fn(); },
  boardPath: reapBoardPath, cardsRoot: reapCardsRoot,
  worktreeExists: () => false,
  sh: (cmd, cmdArgs) => { reapShCalls.push([cmd, ...cmdArgs]); return ''; },
  now: () => '2026-07-25T14:00:00.000Z',
  projectLoopStation: (_ctx, _state, updatedOn) => {
    opx2ReapProjections.push(updatedOn);
    return { action: 'loop-station-projected', no_op: false, updated_on: updatedOn };
  },
};
await assert.rejects(() => commandReap({ root: reapRoot }, {}, reapDeps), /requires --json/,
  'BGR-REAP refuses without --json before any read or write');
eq(reapLocks, [], 'BGR-REAP missing --json refusal precedes every lock');
eq(reapWrites, 0, 'BGR-REAP missing --json refusal performs zero writes');
const reaped = await commandReap({ root: reapRoot }, { json: true }, reapDeps);
eq(reaped.action, 'reaped', 'BGR-REAP emits one machine-readable reap receipt');
eq(reaped.no_op, false, 'BGR-REAP first sweep is not a no-op');
eq(opx2ReapProjections, ['reap'],
  'OPX2-TRANSITION-ONLY one mutating reap batch fires exactly one Loop Station projection');
ok(reapLocks.includes('selector'), 'BGR-REAP the sweep runs under the selector lock');

// BGR-REAP-CORPSES: parked stem-sibling with a deployed successor is discarded.
eq(reaped.corpses.length, 1, 'BGR-REAP-CORPSES exactly one superseded corpse is discovered');
eq(reaped.corpses[0].card, 'ES9a Old renderer', 'BGR-REAP-CORPSES the parked stem-sibling is the corpse');
eq(reaped.corpses[0].tombstone.superseded_by, 'ES9a2 Renderer rework (supersedes ES9a)',
  'BGR-REAP-CORPSES the tombstone names the exact deployed successor card');
eq(reapState.cards['ES9a Old renderer'].phase, 'discarded', 'BGR-REAP-CORPSES the corpse ledger record becomes a tombstone');
eq(reapState.cards['ES9a Old renderer'].final_head, REAP_HEAD, 'BGR-REAP-CORPSES the tombstone preserves the corpse gate-receipt HEAD');
ok(!fs.existsSync(reapCorpsePath), 'BGR-REAP-CORPSES the corpse note is deleted');
const sweptBoard = fs.readFileSync(reapBoardPath, 'utf8');
ok(!/\[\[ES9a Old renderer\]\]/.test(sweptBoard), 'BGR-REAP-CORPSES the corpse board line is removed');
eq(reapState.cards['Keeper parked'].phase, 'parked', 'BGR-REAP-CORPSES a parked card with no deployed successor is untouched');
ok(fs.existsSync(reapKeeperPath), 'BGR-REAP-CORPSES the untouched parked note survives');
ok(/- \[ \] \[\[Keeper parked\]\]/.test(sweptBoard), 'BGR-REAP-CORPSES the untouched parked board line survives');

// BGR-REAP-STUBS: annotations stripped; fully settled containers discarded outright.
ok(sweptBoard.includes('- [ ] [[Decomposed parent]]') && !/Decomposed parent\]\] \(decomposed/.test(sweptBoard),
  'BGR-REAP-STUBS the decomposition annotation is stripped, checkbox state and wikilink preserved exactly');
ok(sweptBoard.includes('- [ ] [[Docs $$ parent]]') && !/\(docs-only/.test(sweptBoard),
  'BGR-REAP-STUBS the docs-only variant strips safely for names containing $');
ok(!/\[\[Settled container\]\]/.test(sweptBoard),
  'BGR-REAP-STUBS a planning container whose children are all tombstoned or completed is discarded outright');
eq(reapState.cards['Settled container'].phase, 'discarded', 'BGR-REAP-STUBS the settled container gains a tombstone');
eq(reaped.stub_parents.length, 1, 'BGR-REAP-STUBS the receipt lists exactly one settled-container discard');
eq(reaped.stub_parents[0].card, 'Settled container', 'BGR-REAP-STUBS the receipt names the discarded container');
eq(reaped.annotations_stripped.map((item) => item.card).sort(), ['Decomposed parent', 'Docs $$ parent'],
  'BGR-REAP-STUBS the receipt lists every stripped annotation');

// BGR-REAP-DUPES: two lines targeting the same wikilink → first kept, second removed.
eq((sweptBoard.match(/\[\[Dupe card\]\]/g) || []).length, 1, 'BGR-REAP-DUPES only the first duplicate line survives');
eq(reaped.duplicates_removed, [{ board: reapBoardPath, card: 'Dupe card' }],
  'BGR-REAP-DUPES the receipt lists the removed duplicate line');

// BGR-REAP-RESIDUE-HEAL: tombstone residue (line + note) is healed.
ok(!/\[\[Ghost residue\]\]/.test(sweptBoard), 'BGR-REAP-RESIDUE-HEAL the residual tombstone board line is removed');
eq(reaped.residue_lines_removed, [{ board: reapBoardPath, card: 'Ghost residue' }],
  'BGR-REAP-RESIDUE-HEAL the receipt lists the healed residual line');
ok(!fs.existsSync(reapGhostPath), 'BGR-REAP-RESIDUE-HEAL the residual tombstone note is deleted');
eq(reaped.residue_notes_deleted, [{ card: 'Ghost residue', path: reapGhostPath }],
  'BGR-REAP-RESIDUE-HEAL the receipt lists the healed residual note');

// BGR-REAP-NOOP: replay on the settled board is a no-op with zero writes.
const noopWritesBefore = reapWrites;
const noopShBefore = reapShCalls.length;
const noopBoardBytes = fs.readFileSync(reapBoardPath, 'utf8');
const noopStateBytes = JSON.stringify(reapState);
const reapReplay = await commandReap({ root: reapRoot }, { json: true }, reapDeps);
eq(reapReplay.action, 'reaped', 'BGR-REAP-NOOP replay still emits the reap receipt');
eq(reapReplay.no_op, true, 'BGR-REAP-NOOP replay on a settled board is an explicit no-op');
eq(reapWrites, noopWritesBefore, 'BGR-REAP-NOOP replay performs zero ledger writes');
eq(reapShCalls.length, noopShBefore, 'BGR-REAP-NOOP replay performs zero git operations');
eq(fs.readFileSync(reapBoardPath, 'utf8'), noopBoardBytes, 'BGR-REAP-NOOP replay keeps board bytes stable');
eq(JSON.stringify(reapState), noopStateBytes, 'BGR-REAP-NOOP replay keeps ledger state byte-stable');

// BGR-REAP-EXPLICIT-LIST: --also discards named settled work, refuses active phases.
const explicitPath = path.join(reapCardsRoot, 'Explicit corpse.md');
const untrackedStubPath = path.join(reapCardsRoot, 'Untracked stub.md');
fs.writeFileSync(reapBoardPath, liveBoard({ blocked: ['Explicit corpse'], planning: ['Untracked stub'], progress: ['Busy card'] }));
fs.writeFileSync(explicitPath, '---\nstatus: blocked\n---\nexplicit body\n');
fs.writeFileSync(untrackedStubPath, '---\nstatus: planning\n---\nstub body\n');
const alsoState = emptyState();
alsoState.cards['Explicit corpse'] = { card: 'Explicit corpse', phase: 'blocked', card_path: explicitPath };
alsoState.cards['Busy card'] = { card: 'Busy card', phase: 'implementing' };
let alsoWrites = 0;
const alsoDeps = { ...reapDeps, readState: () => alsoState, writeState: () => { alsoWrites++; } };
const alsoReap = await commandReap({ root: reapRoot }, { json: true, also: ['Explicit corpse', 'Untracked stub'] }, alsoDeps);
eq(alsoReap.also.map((item) => item.card), ['Explicit corpse', 'Untracked stub'],
  'BGR-REAP-EXPLICIT-LIST discards every explicitly listed card');
eq(alsoState.cards['Explicit corpse'].phase, 'discarded', 'BGR-REAP-EXPLICIT-LIST a blocked listed card becomes a tombstone');
eq(alsoState.cards['Untracked stub'].phase, 'discarded', 'BGR-REAP-EXPLICIT-LIST an untracked listed card gains a minimal tombstone');
ok(!fs.existsSync(explicitPath) && !fs.existsSync(untrackedStubPath), 'BGR-REAP-EXPLICIT-LIST listed card notes are deleted');
const alsoBoard = fs.readFileSync(reapBoardPath, 'utf8');
ok(!/\[\[Explicit corpse\]\]/.test(alsoBoard) && !/\[\[Untracked stub\]\]/.test(alsoBoard),
  'BGR-REAP-EXPLICIT-LIST listed board lines are removed');
ok(/\[\[Busy card\]\]/.test(alsoBoard), 'BGR-REAP-EXPLICIT-LIST the active board line survives');
const refuseWritesBefore = alsoWrites;
const refuseBoardBytes = fs.readFileSync(reapBoardPath, 'utf8');
await assert.rejects(() => commandReap({ root: reapRoot }, { json: true, also: 'Busy card' }, alsoDeps),
  /refuses active in-flight work/, 'BGR-REAP-EXPLICIT-LIST refuses names with active in-flight phases');
eq(alsoWrites, refuseWritesBefore, 'BGR-REAP-EXPLICIT-LIST active-name refusal performs zero writes');
eq(fs.readFileSync(reapBoardPath, 'utf8'), refuseBoardBytes, 'BGR-REAP-EXPLICIT-LIST active-name refusal keeps board bytes stable');
eq(alsoState.cards['Busy card'].phase, 'implementing', 'BGR-REAP-EXPLICIT-LIST the active record is preserved');

// BGR-REAP-EXPLICIT-LIST overlap: --also naming a corpse-set member (or any
// already-tombstoned card) records a skip entry; the identical re-run stays no_op.
const overlapCorpsePath = path.join(reapCardsRoot, 'ES8a Old pass.md');
fs.writeFileSync(reapBoardPath, liveBoard({ progress: ['ES8a Old pass'] }));
fs.writeFileSync(overlapCorpsePath, '---\nstatus: parked\n---\nold pass body\n');
const overlapState = emptyState();
overlapState.cards['ES8a Old pass'] = { card: 'ES8a Old pass', phase: 'parked', card_path: overlapCorpsePath };
overlapState.cards['ES8a2 New pass (supersedes ES8a)'] = { card: 'ES8a2 New pass (supersedes ES8a)', phase: 'deployed' };
overlapState.cards['Manual tombstone'] = {
  card: 'Manual tombstone', phase: 'discarded', discarded_at: '2026-07-24T00:00:00.000Z',
  discard_reason: 'hand discarded with its own reason', superseded_by: null, final_head: null, carried_fixtures: [],
};
const overlapDeps = { ...reapDeps, readState: () => overlapState, writeState: () => {} };
const overlapArgs = { json: true, also: ['ES8a Old pass', 'Manual tombstone'] };

// BGR-REAP-EXPLICIT-LIST typo: an unresolvable --also name refuses up-front,
// before the corpse pass performs any write, and names the offender.
const typoBoardBytes = fs.readFileSync(reapBoardPath, 'utf8');
await assert.rejects(() => commandReap({ root: reapRoot }, { json: true, also: 'No Such Card' }, overlapDeps),
  /cannot resolve --also card No Such Card/,
  'BGR-REAP-EXPLICIT-LIST typo: an unresolvable listed name refuses up-front and names the offender');
eq(overlapState.cards['ES8a Old pass'].phase, 'parked',
  'BGR-REAP-EXPLICIT-LIST typo: the refusal precedes the corpse pass, so the corpse record is untouched');
ok(fs.existsSync(overlapCorpsePath), 'BGR-REAP-EXPLICIT-LIST typo: the refused run performs zero note deletions');
eq(fs.readFileSync(reapBoardPath, 'utf8'), typoBoardBytes,
  'BGR-REAP-EXPLICIT-LIST typo: the refused run keeps board bytes stable');

const overlapReap = await commandReap({ root: reapRoot }, overlapArgs, overlapDeps);
eq(overlapReap.corpses.map((item) => item.card), ['ES8a Old pass'],
  'BGR-REAP-EXPLICIT-LIST overlap: the corpse pass discards the listed card first');
eq(overlapReap.also, [
  { card: 'ES8a Old pass', no_op: true, skipped: 'already discarded' },
  { card: 'Manual tombstone', no_op: true, skipped: 'already discarded' },
], 'BGR-REAP-EXPLICIT-LIST overlap: already-tombstoned listed names record skip entries, never a throw');
eq(overlapReap.no_op, false, 'BGR-REAP-EXPLICIT-LIST overlap: the first run still reports its corpse work');
const overlapBoardBytes = fs.readFileSync(reapBoardPath, 'utf8');
const overlapReplay = await commandReap({ root: reapRoot }, overlapArgs, overlapDeps);
eq(overlapReplay.no_op, true, 'BGR-REAP-EXPLICIT-LIST overlap: the identical re-run is an explicit no-op');
eq(overlapReplay.also, [
  { card: 'ES8a Old pass', no_op: true, skipped: 'already discarded' },
  { card: 'Manual tombstone', no_op: true, skipped: 'already discarded' },
], 'BGR-REAP-EXPLICIT-LIST overlap: the re-run keeps the skip entries');
eq(fs.readFileSync(reapBoardPath, 'utf8'), overlapBoardBytes,
  'BGR-REAP-EXPLICIT-LIST overlap: the re-run keeps board bytes stable');

// BGR-REAP-RESIDUE-HEAL guard: a symlinked residue note is refused per-item and
// reported in the receipt; the rest of the reap completes.
const symTargetPath = path.join(reapRoot, 'outside-note.md');
const symNotePath = path.join(reapCardsRoot, 'Symlinked residue.md');
const healthyResiduePath = path.join(reapCardsRoot, 'Healthy residue.md');
fs.writeFileSync(symTargetPath, 'outside body\n');
fs.symlinkSync(symTargetPath, symNotePath);
fs.writeFileSync(healthyResiduePath, '---\nstatus: parked\n---\nhealthy residue body\n');
const symState = emptyState();
symState.cards['Symlinked residue'] = {
  card: 'Symlinked residue', phase: 'discarded', card_path: symNotePath,
  discarded_at: '2026-07-24T00:00:00.000Z', discard_reason: 'crash residue',
  superseded_by: null, final_head: null, carried_fixtures: [],
};
symState.cards['Healthy residue'] = {
  card: 'Healthy residue', phase: 'discarded', card_path: healthyResiduePath,
  discarded_at: '2026-07-24T00:00:00.000Z', discard_reason: 'crash residue',
  superseded_by: null, final_head: null, carried_fixtures: [],
};
fs.writeFileSync(reapBoardPath, liveBoard({}));
const symDeps = { ...reapDeps, readState: () => symState, writeState: () => {} };
const symReap = await commandReap({ root: reapRoot }, { json: true }, symDeps);
eq(symReap.action, 'reaped', 'BGR-REAP-RESIDUE-HEAL a corrupt residue entry never aborts the batch');
eq(symReap.residue_notes_refused.length, 1, 'BGR-REAP-RESIDUE-HEAL exactly one residue refusal is reported');
eq(symReap.residue_notes_refused[0].card, 'Symlinked residue', 'BGR-REAP-RESIDUE-HEAL the refusal names the corrupt entry');
eq(symReap.residue_notes_refused[0].residue_note, 'refused', 'BGR-REAP-RESIDUE-HEAL the refusal is marked refused');
ok(/regular non-symlink file/.test(symReap.residue_notes_refused[0].reason),
  'BGR-REAP-RESIDUE-HEAL the refusal carries the guard reason');
ok(fs.existsSync(symNotePath), 'BGR-REAP-RESIDUE-HEAL the guard leaves the symlink in place');
ok(fs.existsSync(symTargetPath), 'BGR-REAP-RESIDUE-HEAL the guard leaves the symlink target untouched');
ok(!fs.existsSync(healthyResiduePath), 'BGR-REAP-RESIDUE-HEAL the rest of the residue pass still completes');
eq(symReap.residue_notes_deleted, [{ card: 'Healthy residue', path: healthyResiduePath }],
  'BGR-REAP-RESIDUE-HEAL the receipt still lists the healed healthy residue');
const symReplay = await commandReap({ root: reapRoot }, { json: true }, symDeps);
eq(symReplay.no_op, true, 'BGR-REAP-RESIDUE-HEAL a persistent refused entry keeps the replay an explicit zero-write no-op');
eq(symReplay.residue_notes_refused.length, 1, 'BGR-REAP-RESIDUE-HEAL the replay still reports the persistent refusal');
ok(fs.existsSync(symNotePath), 'BGR-REAP-RESIDUE-HEAL the replay still leaves the symlink in place');

// CLI wiring: the reap command exists and refuses without --json before any read or write.
{
  const { execFileSync: execCli } = require('child_process');
  const coordinatorCli = path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js');
  let cliError = null;
  try {
    execCli('node', [coordinatorCli, 'reap'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) { cliError = err; }
  ok(cliError && /requires --json/.test(String(cliError.stderr)),
    'CLI reap without --json refuses with a machine-parseable error before any read or write');
}

// --- BGR redesign: restructure — sanctioned flat-to-epic board migration ---

const noteBody = (raw) => String(raw).replace(/^---\n[\s\S]*?\n---/, '');
let restructureFixtureId = 0;
function makeRestructureFixture(opts = {}) {
  const root = path.join(tmp, `bgr-restructure-${++restructureFixtureId}`);
  const projectRoot = path.join(root, 'spice', 'projects', 'test');
  const cardsRoot = path.join(projectRoot, 'tasks');
  const boardPath = path.join(projectRoot, 'project-board.md');
  fs.mkdirSync(cardsRoot, { recursive: true });
  fs.writeFileSync(boardPath, [
    '---', 'kanban-plugin: board', 'type: kanban', 'project_name: Test', 'project_slug: test', '---', '',
    '## In Planning',
    '- [ ] [[Card A1]]',
    '- [ ] [[Card A2]]',
    '- [ ] [[Bystander card]]',
    '- [ ] [[Card B1]]',
    '- [ ] [[Card B2]]',
    '',
    '## In Progress', '', '## Blocked', '', '## Completed', '',
  ].join('\n'));
  const bodies = {
    'Card A1': '\n\nA1 body line one.\n\nA1 body line two.\n',
    'Card A2': '\n\nA2 body with $& and $$ and $1 dollar specials.\n',
    'Card B1': '\n\nB1 body.\n',
    'Card B2': '\n\nB2 body.\n',
    'Bystander card': '\n\nBystander body.\n',
  };
  for (const [name, body] of Object.entries(bodies)) {
    fs.writeFileSync(path.join(cardsRoot, `${name}.md`), [
      '---', 'type: task-hub',
      'source_board: spice/projects/test/project-board.md',
      `status: ${(opts.statuses || {})[name] || 'planning'}`,
      name === 'Card A2' ? 'depends_on: "[[Card A1]]"' : 'depends_on: []',
      '---',
    ].join('\n') + body);
  }
  const spec = {
    project_root: projectRoot,
    board: boardPath,
    epics: [
      { epic: 'Family A', members: ['Card A1', 'Card A2'] },
      { epic: 'Family B', members: ['Card B1', 'Card B2'] },
    ],
  };
  const specPath = path.join(root, 'map.json');
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  const state = emptyState();
  const counters = { writes: 0, locks: [] };
  const deps = {
    readState: () => state,
    writeState: () => { counters.writes++; },
    withLock: async (_ctx, name, fn) => { counters.locks.push(name); return fn(); },
    now: () => '2026-07-25T15:00:00.000Z',
    journalPath: path.join(root, 'restructure-journal.json'),
  };
  return { root, projectRoot, cardsRoot, boardPath, spec, specPath, state, bodies, counters, deps };
}
const writeSpec = (fixture, spec) => fs.writeFileSync(fixture.specPath, JSON.stringify(spec, null, 2));

// BGR-RESTRUCTURE-HAPPY: the spec'd flat cards become two canonical epics.
const happy = makeRestructureFixture();
const happySources = Object.fromEntries(Object.keys(happy.bodies)
  .map((name) => [name, fs.readFileSync(path.join(happy.cardsRoot, `${name}.md`), 'utf8')]));
await assert.rejects(() => commandRestructure({ root: happy.root }, { spec: happy.specPath }, happy.deps),
  /requires --json/, 'BGR-RESTRUCTURE-HAPPY restructure refuses without --json before any read or write');
eq(happy.counters.locks, [], 'BGR-RESTRUCTURE-HAPPY missing --json refusal precedes every lock');
eq(happy.counters.writes, 0, 'BGR-RESTRUCTURE-HAPPY missing --json refusal performs zero ledger writes');
const restructured = await commandRestructure({ root: happy.root }, { spec: happy.specPath, json: true }, happy.deps);
eq(restructured.action, 'restructured', 'BGR-RESTRUCTURE-HAPPY emits one machine-readable receipt');
eq(restructured.no_op, false, 'BGR-RESTRUCTURE-HAPPY first run is not a no-op');
ok(happy.counters.locks.includes('selector'), 'BGR-RESTRUCTURE-HAPPY the pass runs under the selector lock');
eq(restructured.epics.map((entry) => entry.epic), ['Family A', 'Family B'],
  'BGR-RESTRUCTURE-HAPPY receipt reports every epic in spec order');
eq(restructured.epics[0].members.map((entry) => entry.card), ['Card A1', 'Card A2'],
  'BGR-RESTRUCTURE-HAPPY receipt reports every member move');
const happyAtlasPath = path.join(happy.cardsRoot, 'Family A', 'Family A.md');
const happyEpicBoardPath = path.join(happy.cardsRoot, 'Family A', 'board', 'Family A-board.md');
const happyAtlas = fs.readFileSync(happyAtlasPath, 'utf8');
ok(/^type: epic$/m.test(happyAtlas), 'BGR-RESTRUCTURE-HAPPY atlas is type epic');
ok(/^status: planned$/m.test(happyAtlas) && /^posture: claimable$/m.test(happyAtlas),
  'BGR-RESTRUCTURE-HAPPY atlas derives planned/claimable from all-planning members');
ok(happyAtlas.includes('source_board: spice/projects/test/project-board.md')
  && happyAtlas.includes('kanban_board: spice/projects/test/project-board.md'),
  'BGR-RESTRUCTURE-HAPPY atlas binds its canonical parent board');
ok(happyAtlas.includes('epic_board: spice/projects/test/tasks/Family A/board/Family A-board.md'),
  'BGR-RESTRUCTURE-HAPPY atlas binds its canonical epic board');
const happyEpicBoard = fs.readFileSync(happyEpicBoardPath, 'utf8');
ok(/^board_role: epic$/m.test(happyEpicBoard), 'BGR-RESTRUCTURE-HAPPY epic board carries board_role epic');
ok(/## In Planning\n\n- \[ \] \[\[Card A1\]\]\n- \[ \] \[\[Card A2\]\]/.test(happyEpicBoard),
  'BGR-RESTRUCTURE-HAPPY member lines land in the epic In Planning lane in original relative order');
ok(/## In Progress/.test(happyEpicBoard) && /## Blocked/.test(happyEpicBoard) && /## Completed/.test(happyEpicBoard),
  'BGR-RESTRUCTURE-HAPPY epic board carries all four canonical lanes');
for (const keepDir of ['runs', 'lessons', 'decisions']) {
  ok(fs.existsSync(path.join(happy.cardsRoot, 'Family A', 'context', keepDir, '.keep')),
    `BGR-RESTRUCTURE-HAPPY epic context/${keepDir}/.keep scaffold exists`);
}
for (const [epic, member] of [['Family A', 'Card A1'], ['Family A', 'Card A2'], ['Family B', 'Card B1'], ['Family B', 'Card B2']]) {
  const target = path.join(happy.cardsRoot, epic, 'board', `${member}.md`);
  ok(!fs.existsSync(path.join(happy.cardsRoot, `${member}.md`)), `BGR-RESTRUCTURE-HAPPY ${member} source note is gone`);
  ok(fs.existsSync(target), `BGR-RESTRUCTURE-HAPPY ${member} note moved into the epic board directory`);
  const raw = fs.readFileSync(target, 'utf8');
  ok(/^type: slice$/m.test(raw), `BGR-RESTRUCTURE-HAPPY ${member} is rewritten to type slice`);
  ok(raw.includes(`epic: "[[${epic}]]"`), `BGR-RESTRUCTURE-HAPPY ${member} carries its epic backlink`);
  ok(raw.includes(`task_parent: spice/projects/test/tasks/${epic}/${epic}.md`),
    `BGR-RESTRUCTURE-HAPPY ${member} binds its canonical task_parent`);
  ok(raw.includes(`source_board: spice/projects/test/tasks/${epic}/board/${epic}-board.md`)
    && raw.includes(`kanban_board: spice/projects/test/tasks/${epic}/board/${epic}-board.md`),
    `BGR-RESTRUCTURE-HAPPY ${member} binds its canonical epic board`);
  ok(/^status: planning$/m.test(raw), `BGR-RESTRUCTURE-HAPPY ${member} preserves its flat status`);
  eq(noteBody(raw), happy.bodies[member], `BGR-RESTRUCTURE-HAPPY ${member} body below frontmatter is byte-preserved`);
}
eq(parseDependsOn(fs.readFileSync(path.join(happy.cardsRoot, 'Family A', 'board', 'Card A2.md'), 'utf8')), ['Card A1'],
  'BGR-RESTRUCTURE-HAPPY depends_on is preserved through the slice rewrite');
ok(/^schema_version: 1\.1\.0$/m.test(fs.readFileSync(path.join(happy.cardsRoot, 'Family A', 'board', 'Card A1.md'), 'utf8'))
  && /^schema_version: 1\.1\.0$/m.test(happyAtlas),
  'BGR-RESTRUCTURE-HAPPY slices and atlas stamp the project-blueprint note schema (1.1.0, not the Delivery contract version)');
const happyParent = fs.readFileSync(happy.boardPath, 'utf8');
for (const member of ['Card A1', 'Card A2', 'Card B1', 'Card B2']) {
  ok(!new RegExp(`\\[\\[${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`).test(happyParent),
    `BGR-RESTRUCTURE-HAPPY parent board member line for ${member} is removed`);
}
eq(parseBoard(happyParent)['In Planning'], ['Family A', 'Bystander card', 'Family B'],
  'BGR-RESTRUCTURE-HAPPY one unchecked epic line replaces its first member position; bystanders stay put');
eq(noteBody(fs.readFileSync(path.join(happy.cardsRoot, 'Bystander card.md'), 'utf8')), happy.bodies['Bystander card'],
  'BGR-RESTRUCTURE-HAPPY the bystander note is untouched');
eq(happy.counters.writes, 0, 'BGR-RESTRUCTURE-HAPPY untracked flat cards trigger zero ledger writes');
for (const [epic, member] of [['Family A', 'Card A1'], ['Family B', 'Card B2']]) {
  const target = path.join(happy.cardsRoot, epic, 'board', `${member}.md`);
  const surface = canonicalEpicProjection(fs.readFileSync(target, 'utf8'), target, happy.boardPath, happy.cardsRoot, { currentCard: member });
  eq(surface.epic, epic, `BGR-RESTRUCTURE-HAPPY canonicalEpicProjection accepts the built ${epic} surface`);
}
const happyResolved = resolveEpicBoardSet({ parentBoardMd: happyParent, cardsRoot: happy.cardsRoot });
eq(happyResolved.epics.map((entry) => entry.epic), ['Family A', 'Family B'],
  'BGR-RESTRUCTURE-HAPPY the epic resolver sees both built epics');
eq(happyResolved.findings, [], 'BGR-RESTRUCTURE-HAPPY the epic resolver reports no findings');

// BGR-RESTRUCTURE-NOOP: literal replay of the applied spec is a zero-write no-op.
const happySnapshot = snapshotDirectory(happy.projectRoot);
const happyLocksBefore = happy.counters.locks.length;
const replayRestructure = await commandRestructure({ root: happy.root }, { spec: happy.specPath, json: true }, happy.deps);
eq(replayRestructure.action, 'restructured', 'BGR-RESTRUCTURE-NOOP literal replay still emits the receipt');
eq(replayRestructure.no_op, true, 'BGR-RESTRUCTURE-NOOP literal replay is an explicit no-op');
eq(snapshotDirectory(happy.projectRoot), happySnapshot, 'BGR-RESTRUCTURE-NOOP replay keeps every project byte stable');
eq(happy.counters.writes, 0, 'BGR-RESTRUCTURE-NOOP replay performs zero ledger writes');
ok(happy.counters.locks.length > happyLocksBefore, 'BGR-RESTRUCTURE-NOOP replay still runs under the selector lock');

// BGR-RESTRUCTURE-TRACKED: a tracked member keeps its exact ledger key and phase.
const tracked = makeRestructureFixture({ statuses: { 'Card A2': 'parked' } });
const trackedOldPath = path.join(tracked.cardsRoot, 'Card A2.md');
tracked.state.cards['Card A2'] = {
  card: 'Card A2', phase: 'parked', card_path: trackedOldPath,
  dependencies: ['Card A1'], resume_condition: 'restructure lands',
};
let trackedPersists = 0;
tracked.deps.writeState = (_ctx, _state, record) => { trackedPersists++; if (record) tracked.state.cards[record.card] = record; };
const trackedReceipt = await commandRestructure({ root: tracked.root }, { spec: tracked.specPath, json: true }, tracked.deps);
eq(trackedReceipt.no_op, false, 'BGR-RESTRUCTURE-TRACKED restructure applies');
const trackedNewPath = path.join(tracked.cardsRoot, 'Family A', 'board', 'Card A2.md');
eq(Object.keys(tracked.state.cards), ['Card A2'], 'BGR-RESTRUCTURE-TRACKED the ledger key set is unchanged');
eq(tracked.state.cards['Card A2'].phase, 'parked', 'BGR-RESTRUCTURE-TRACKED the tracked phase is unchanged');
eq(tracked.state.cards['Card A2'].card_path, trackedNewPath,
  'BGR-RESTRUCTURE-TRACKED the ledger card_path is rebound to the epic-board location with the move');
ok(trackedPersists >= 1, 'BGR-RESTRUCTURE-TRACKED the card_path rebind is persisted');
ok(trackedReceipt.epics[0].members.find((entry) => entry.card === 'Card A2').tracked === true,
  'BGR-RESTRUCTURE-TRACKED the receipt marks the tracked member');
ok(/^status: parked$/m.test(fs.readFileSync(trackedNewPath, 'utf8')),
  'BGR-RESTRUCTURE-TRACKED the tracked member status is preserved from the flat card');
const trackedReconcileDeps = {
  readState: () => tracked.state,
  writeState: tracked.deps.writeState,
  withLock: immediateCardLock,
  boardPath: tracked.boardPath, cardsRoot: tracked.cardsRoot,
  now: () => '2026-07-25T15:30:00.000Z',
};
const trackedReconcile = await commandReconcile({ root: tracked.root }, { card: 'Card A2' }, trackedReconcileDeps);
eq(trackedReconcile.action, 'reconciled', 'BGR-RESTRUCTURE-TRACKED reconcile succeeds against the new epic-board location');
eq(trackedReconcile.results[0].ok, true, 'BGR-RESTRUCTURE-TRACKED reconcile reports zero projection errors');
ok(!tracked.state.cards['Card A2'].projection_error,
  'BGR-RESTRUCTURE-TRACKED the tracked record carries no projection error after reconcile');
const trackedReplay = await commandReconcile({ root: tracked.root }, { card: 'Card A2' }, trackedReconcileDeps);
eq(trackedReplay.no_op, true, 'BGR-RESTRUCTURE-TRACKED the second reconcile is an explicit no-op');
eq(projectionBoardDrift(fs.readFileSync(tracked.boardPath, 'utf8'), tracked.state.cards['Card A2'], {
  boardPath: tracked.boardPath, cardsRoot: tracked.cardsRoot, state: tracked.state,
}), null, 'BGR-RESTRUCTURE-TRACKED the epic drift audit reports clean after reconcile');

// BGR-RESTRUCTURE-REFUSES: every refusal precedes the first write.
const refuseChecks = [
  [{ epics: [{ epic: 'Family A', members: ['Card A1', 'No Such Card'] }] }, /absent from the parent board/, 'a member name absent from the parent board'],
  [{ epics: [{ epic: 'Family A', members: ['Card A1', 'Card A1'] }] }, /listed more than once/, 'a member present twice in one epic'],
  [{ epics: [{ epic: 'Family A', members: ['Card A1'] }, { epic: 'Family B', members: ['Card A1'] }] }, /listed more than once/, 'a member present twice across epics'],
  [{ epics: [{ epic: 'Bystander card', members: ['Card A1'] }] }, /collides with an existing note/, 'an epic name colliding with an existing note path'],
  [{ epics: [{ epic: 'Bad/Name', members: ['Card A1'] }] }, /epic name/, 'an unsafe epic name'],
];
for (const [partial, pattern, label] of refuseChecks) {
  const refuse = makeRestructureFixture();
  writeSpec(refuse, { ...refuse.spec, ...partial });
  const before = snapshotDirectory(refuse.projectRoot);
  await assert.rejects(() => commandRestructure({ root: refuse.root }, { spec: refuse.specPath, json: true }, refuse.deps),
    pattern, `BGR-RESTRUCTURE-REFUSES ${label} refuses with a machine-readable error`);
  eq(snapshotDirectory(refuse.projectRoot), before, `BGR-RESTRUCTURE-REFUSES ${label} performs zero writes`);
  eq(refuse.counters.writes, 0, `BGR-RESTRUCTURE-REFUSES ${label} performs zero ledger writes`);
  ok(!fs.existsSync(refuse.deps.journalPath), `BGR-RESTRUCTURE-REFUSES ${label} records no intent journal`);
}

// BGR-RESTRUCTURE-RESUME: a crash mid-pass resumes forward from the durable intent journal.
const resume = makeRestructureFixture();
const crashingWriteText = (file, value) => {
  if (file.endsWith('Family B-board.md')) throw new Error('injected crash before the Family B board write');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
await assert.rejects(
  () => commandRestructure({ root: resume.root }, { spec: resume.specPath, json: true }, { ...resume.deps, writeText: crashingWriteText }),
  /injected crash/, 'BGR-RESTRUCTURE-RESUME the injected crash propagates');
ok(fs.existsSync(resume.deps.journalPath), 'BGR-RESTRUCTURE-RESUME the durable intent journal survives the crash');
ok(fs.existsSync(path.join(resume.cardsRoot, 'Family A', 'board', 'Card A1.md')),
  'BGR-RESTRUCTURE-RESUME the first epic completed before the crash');
ok(fs.existsSync(path.join(resume.cardsRoot, 'Card B1.md')),
  'BGR-RESTRUCTURE-RESUME the second epic members are still at their preimage locations');
const resumedRestructure = await commandRestructure({ root: resume.root }, { spec: resume.specPath, json: true }, resume.deps);
eq(resumedRestructure.action, 'restructured', 'BGR-RESTRUCTURE-RESUME the rerun completes the pass');
eq(resumedRestructure.no_op, false, 'BGR-RESTRUCTURE-RESUME the completing rerun is not a no-op');
eq(resumedRestructure.resumed, true, 'BGR-RESTRUCTURE-RESUME the rerun reports that it resumed the recorded intent');
ok(fs.existsSync(path.join(resume.cardsRoot, 'Family B', 'board', 'Card B1.md'))
  && !fs.existsSync(path.join(resume.cardsRoot, 'Card B1.md')),
  'BGR-RESTRUCTURE-RESUME the rerun finishes the interrupted moves');
eq(parseBoard(fs.readFileSync(resume.boardPath, 'utf8'))['In Planning'], ['Family A', 'Bystander card', 'Family B'],
  'BGR-RESTRUCTURE-RESUME the parent board converges to the intended shape');
const resumeReplay = await commandRestructure({ root: resume.root }, { spec: resume.specPath, json: true }, resume.deps);
eq(resumeReplay.no_op, true, 'BGR-RESTRUCTURE-RESUME the post-resume literal replay is a no-op');

// BGR-RESTRUCTURE-RESUME third state: a mutated preimage fails closed and deletes nothing.
const thirdState = makeRestructureFixture();
await assert.rejects(
  () => commandRestructure({ root: thirdState.root }, { spec: thirdState.specPath, json: true }, { ...thirdState.deps, writeText: crashingWriteText }),
  /injected crash/, 'BGR-RESTRUCTURE-RESUME third-state setup crash propagates');
const mutatedPath = path.join(thirdState.cardsRoot, 'Card B1.md');
fs.appendFileSync(mutatedPath, 'operator edit after the crash\n');
const mutatedRaw = fs.readFileSync(mutatedPath, 'utf8');
await assert.rejects(
  () => commandRestructure({ root: thirdState.root }, { spec: thirdState.specPath, json: true }, thirdState.deps),
  /neither the recorded preimage nor the intended result/,
  'BGR-RESTRUCTURE-RESUME a target in a third state fails closed with a machine-readable error');
eq(fs.readFileSync(mutatedPath, 'utf8'), mutatedRaw,
  'BGR-RESTRUCTURE-RESUME the fail-closed rerun never deletes or rewrites the mutated note');
ok(!fs.existsSync(path.join(thirdState.cardsRoot, 'Family B', 'board', 'Card B1.md')),
  'BGR-RESTRUCTURE-RESUME the fail-closed rerun writes no target for the mutated member');

// BGR-RESTRUCTURE-PARTIAL-NO-JOURNAL: a partially applied spec with no intent
// journal is a third state for the whole pass — refuse before any write.
const partialNoJournal = makeRestructureFixture();
await commandRestructure({ root: partialNoJournal.root }, { spec: partialNoJournal.specPath, json: true }, partialNoJournal.deps);
fs.rmSync(partialNoJournal.deps.journalPath);
const partialParentRaw = fs.readFileSync(partialNoJournal.boardPath, 'utf8');
fs.writeFileSync(partialNoJournal.boardPath,
  partialParentRaw.replace('## In Planning\n', '## In Planning\n\n- [ ] [[Card B1]]\n'));
const partialSnapshot = snapshotDirectory(partialNoJournal.projectRoot);
await assert.rejects(
  () => commandRestructure({ root: partialNoJournal.root }, { spec: partialNoJournal.specPath, json: true }, partialNoJournal.deps),
  /partially applied without a matching intent journal/,
  'BGR-RESTRUCTURE-PARTIAL-NO-JOURNAL a converged-except-one-detail state without a journal fails closed');
eq(snapshotDirectory(partialNoJournal.projectRoot), partialSnapshot,
  'BGR-RESTRUCTURE-PARTIAL-NO-JOURNAL the refusal performs zero writes');
eq(partialNoJournal.counters.writes, 0,
  'BGR-RESTRUCTURE-PARTIAL-NO-JOURNAL the refusal performs zero ledger writes');
ok(!fs.existsSync(partialNoJournal.deps.journalPath),
  'BGR-RESTRUCTURE-PARTIAL-NO-JOURNAL the refusal records no new intent journal');

// BGR-RESTRUCTURE-FOREIGN-JOURNAL: an uncompleted journal from a DIFFERENT
// spec refuses a new pass and is left byte-untouched for inspection.
const foreignJournal = makeRestructureFixture();
const foreignJournalBytes = `${JSON.stringify({ schema_version: 1, spec_digest: 'deadbeef', completed: false }, null, 2)}\n`;
fs.writeFileSync(foreignJournal.deps.journalPath, foreignJournalBytes);
const foreignSnapshot = snapshotDirectory(foreignJournal.projectRoot);
await assert.rejects(
  () => commandRestructure({ root: foreignJournal.root }, { spec: foreignJournal.specPath, json: true }, foreignJournal.deps),
  /a different restructure intent journal is mid-flight/,
  'BGR-RESTRUCTURE-FOREIGN-JOURNAL a mid-flight journal for a different spec fails closed');
eq(snapshotDirectory(foreignJournal.projectRoot), foreignSnapshot,
  'BGR-RESTRUCTURE-FOREIGN-JOURNAL the refusal performs zero writes');
eq(foreignJournal.counters.writes, 0,
  'BGR-RESTRUCTURE-FOREIGN-JOURNAL the refusal performs zero ledger writes');
eq(fs.readFileSync(foreignJournal.deps.journalPath, 'utf8'), foreignJournalBytes,
  'BGR-RESTRUCTURE-FOREIGN-JOURNAL the foreign journal is left byte-untouched for inspection');

// BGR-RESTRUCTURE-HALF-MOVE: crash landed between the target write and the
// source unlink — resume unlinks ONLY the source and never rewrites the target.
const halfMove = makeRestructureFixture();
await assert.rejects(
  () => commandRestructure({ root: halfMove.root }, { spec: halfMove.specPath, json: true }, { ...halfMove.deps, writeText: crashingWriteText }),
  /injected crash/, 'BGR-RESTRUCTURE-HALF-MOVE setup crash propagates');
const halfJournal = JSON.parse(fs.readFileSync(halfMove.deps.journalPath, 'utf8'));
const halfB1 = halfJournal.epics[1].moves.find((move) => move.card === 'Card B1');
fs.mkdirSync(path.dirname(halfB1.to), { recursive: true });
fs.writeFileSync(halfB1.to, halfB1.content);
ok(fs.existsSync(halfB1.from), 'BGR-RESTRUCTURE-HALF-MOVE the hand-staged half-move keeps the source present');
const halfResume = await commandRestructure({ root: halfMove.root }, { spec: halfMove.specPath, json: true }, halfMove.deps);
eq(halfResume.resumed, true, 'BGR-RESTRUCTURE-HALF-MOVE the rerun resumes the recorded intent');
eq(halfResume.no_op, false, 'BGR-RESTRUCTURE-HALF-MOVE the completing rerun is not a no-op');
ok(!fs.existsSync(halfB1.from), 'BGR-RESTRUCTURE-HALF-MOVE resume unlinks only the source of the half-completed move');
eq(fs.readFileSync(halfB1.to, 'utf8'), halfB1.content,
  'BGR-RESTRUCTURE-HALF-MOVE the already-intended target bytes are untouched');
eq(parseBoard(fs.readFileSync(halfMove.boardPath, 'utf8'))['In Planning'], ['Family A', 'Bystander card', 'Family B'],
  'BGR-RESTRUCTURE-HALF-MOVE the pass completes to the intended parent shape');

// BGR-RESTRUCTURE-REENTRANT: a crash during the RESUMED pass still converges
// on a third invocation.
const reentrant = makeRestructureFixture();
const crashFamilyA = (file, value) => {
  if (file.endsWith('Family A-board.md')) throw new Error('injected crash before the Family A board write');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
await assert.rejects(
  () => commandRestructure({ root: reentrant.root }, { spec: reentrant.specPath, json: true }, { ...reentrant.deps, writeText: crashFamilyA }),
  /injected crash/, 'BGR-RESTRUCTURE-REENTRANT the first crash propagates');
await assert.rejects(
  () => commandRestructure({ root: reentrant.root }, { spec: reentrant.specPath, json: true }, { ...reentrant.deps, writeText: crashingWriteText }),
  /injected crash/, 'BGR-RESTRUCTURE-REENTRANT the second crash during the resumed pass propagates');
const reentrantFinal = await commandRestructure({ root: reentrant.root }, { spec: reentrant.specPath, json: true }, reentrant.deps);
eq(reentrantFinal.action, 'restructured', 'BGR-RESTRUCTURE-REENTRANT the third invocation completes cleanly');
eq(reentrantFinal.resumed, true, 'BGR-RESTRUCTURE-REENTRANT the third invocation resumes the same recorded intent');
eq(parseBoard(fs.readFileSync(reentrant.boardPath, 'utf8'))['In Planning'], ['Family A', 'Bystander card', 'Family B'],
  'BGR-RESTRUCTURE-REENTRANT the parent board converges to the intended shape');
for (const [epic, member] of [['Family A', 'Card A1'], ['Family A', 'Card A2'], ['Family B', 'Card B1'], ['Family B', 'Card B2']]) {
  ok(fs.existsSync(path.join(reentrant.cardsRoot, epic, 'board', `${member}.md`))
    && !fs.existsSync(path.join(reentrant.cardsRoot, `${member}.md`)),
    `BGR-RESTRUCTURE-REENTRANT ${member} converged into ${epic}`);
}
const reentrantReplay = await commandRestructure({ root: reentrant.root }, { spec: reentrant.specPath, json: true }, reentrant.deps);
eq(reentrantReplay.no_op, true, 'BGR-RESTRUCTURE-REENTRANT the post-convergence literal replay is a no-op');

// BGR-RESTRUCTURE-DONE-CHECKBOX: the parent epic line derives its checkbox
// from the derived lifecycle, checked only when the epic rolls up done.
const doneEpic = makeRestructureFixture({ statuses: { 'Card A1': 'completed', 'Card A2': 'completed' } });
writeSpec(doneEpic, { ...doneEpic.spec, epics: [{ epic: 'Family A', members: ['Card A1', 'Card A2'] }] });
const doneReceipt = await commandRestructure({ root: doneEpic.root }, { spec: doneEpic.specPath, json: true }, doneEpic.deps);
eq(doneReceipt.epics[0].state, 'done', 'BGR-RESTRUCTURE-DONE-CHECKBOX all-completed members derive a done epic');
ok(/- \[x\] \[\[Family A\]\]/.test(fs.readFileSync(doneEpic.boardPath, 'utf8')),
  'BGR-RESTRUCTURE-DONE-CHECKBOX a done epic paints a checked parent line');

// BGR-RESTRUCTURE-ESCAPING-TARGET: a tampered journal target outside the cards
// root fails closed before any write (symmetric with the source guard).
const escapeTarget = makeRestructureFixture();
await assert.rejects(
  () => commandRestructure({ root: escapeTarget.root }, { spec: escapeTarget.specPath, json: true }, { ...escapeTarget.deps, writeText: crashingWriteText }),
  /injected crash/, 'BGR-RESTRUCTURE-ESCAPING-TARGET setup crash propagates');
const escapeJournal = JSON.parse(fs.readFileSync(escapeTarget.deps.journalPath, 'utf8'));
const escapedPath = path.join(escapeTarget.root, 'escaped-outside.md');
escapeJournal.epics[1].scaffolds.find((scaffold) => scaffold.path.endsWith('Family B-board.md')).path = escapedPath;
fs.writeFileSync(escapeTarget.deps.journalPath, JSON.stringify(escapeJournal, null, 2));
const escapeSnapshot = snapshotDirectory(escapeTarget.projectRoot);
await assert.rejects(
  () => commandRestructure({ root: escapeTarget.root }, { spec: escapeTarget.specPath, json: true }, escapeTarget.deps),
  /escapes its physical root/,
  'BGR-RESTRUCTURE-ESCAPING-TARGET a journal-supplied target outside the cards root fails closed');
ok(!fs.existsSync(escapedPath), 'BGR-RESTRUCTURE-ESCAPING-TARGET the escaping target is never written');
eq(snapshotDirectory(escapeTarget.projectRoot), escapeSnapshot,
  'BGR-RESTRUCTURE-ESCAPING-TARGET the fail-closed rerun performs zero project writes');

// BGR-RESTRUCTURE-E2E: seed fixture → reap → restructure → double reconcile → clean audit.
const seedFlatSource = path.join(__dirname, 'seed-vault', 'spice', 'projects', 'flat-fixture');
const e2eRoot = path.join(tmp, 'bgr-restructure-e2e');
const e2eProjectRoot = path.join(e2eRoot, 'spice', 'projects', 'flat-fixture');
fs.cpSync(seedFlatSource, e2eProjectRoot, { recursive: true });
const e2eBoardPath = path.join(e2eProjectRoot, 'flat-fixture-board.md');
const e2eCardsRoot = path.join(e2eProjectRoot, 'tasks');
const e2eState = emptyState();
e2eState.cards['FF4a Corpse pass'] = {
  card: 'FF4a Corpse pass', phase: 'parked',
  card_path: path.join(e2eCardsRoot, 'FF4a Corpse pass.md'),
};
e2eState.cards['FF4a2 Corpse rework (supersedes FF4a)'] = {
  card: 'FF4a2 Corpse rework (supersedes FF4a)', phase: 'deployed',
  card_path: path.join(e2eCardsRoot, 'FF4a2 Corpse rework (supersedes FF4a).md'),
};
const e2eDeps = {
  readState: () => e2eState,
  writeState: (_ctx, _state, record) => { if (record) e2eState.cards[record.card] = record; },
  withLock: immediateCardLock,
  boardPath: e2eBoardPath, cardsRoot: e2eCardsRoot,
  worktreeExists: () => false, sh: () => '',
  now: () => '2026-07-25T16:00:00.000Z',
  journalPath: path.join(e2eRoot, 'restructure-journal.json'),
};
const e2eReap = await commandReap({ root: e2eRoot }, { json: true }, e2eDeps);
eq(e2eReap.corpses.map((entry) => entry.card), ['FF4a Corpse pass'],
  'BGR-RESTRUCTURE-E2E reap discards the corpse-pair member');
eq(e2eReap.corpses[0].tombstone.superseded_by, 'FF4a2 Corpse rework (supersedes FF4a)',
  'BGR-RESTRUCTURE-E2E the corpse tombstone names its deployed successor');
eq(e2eReap.annotations_stripped.map((entry) => entry.card), ['FF Stub Parent'],
  'BGR-RESTRUCTURE-E2E reap strips the stub annotation');
ok(!fs.existsSync(path.join(e2eCardsRoot, 'FF4a Corpse pass.md')), 'BGR-RESTRUCTURE-E2E the corpse note is deleted');
const e2eSpecPath = path.join(e2eRoot, 'map.json');
fs.writeFileSync(e2eSpecPath, JSON.stringify({
  project_root: e2eProjectRoot,
  board: e2eBoardPath,
  epics: [
    { epic: 'Family A', members: ['FA1 Alpha intake', 'FA2 Alpha engine', 'FA3 Alpha polish'] },
    { epic: 'Family B', members: ['FB1 Beta capture', 'FB2 Beta render', 'FB3 Beta ship'] },
  ],
}, null, 2));
const e2eRestructure = await commandRestructure({ root: e2eRoot }, { spec: e2eSpecPath, json: true }, e2eDeps);
eq(e2eRestructure.no_op, false, 'BGR-RESTRUCTURE-E2E restructure applies against the reaped board');
eq(e2eRestructure.epics.map((entry) => [entry.epic, entry.members.length]), [['Family A', 3], ['Family B', 3]],
  'BGR-RESTRUCTURE-E2E both family epics absorb their three members');
const e2eParent = fs.readFileSync(e2eBoardPath, 'utf8');
eq(parseBoard(e2eParent)['In Planning'], ['FF Stub Parent', 'Family A', 'Family B'],
  'BGR-RESTRUCTURE-E2E the parent In Planning lane holds the stripped stub and both epic lines');
ok(/- \[x\] \[\[FF4a2 Corpse rework \(supersedes FF4a\)\]\]/.test(e2eParent),
  'BGR-RESTRUCTURE-E2E the deployed successor line survives untouched');
const e2eFirstReconcile = await commandReconcile({ root: e2eRoot }, {}, e2eDeps);
eq(e2eFirstReconcile.failed, 0, 'BGR-RESTRUCTURE-E2E the first full reconcile reports zero failures');
const e2eSecondReconcile = await commandReconcile({ root: e2eRoot }, {}, e2eDeps);
eq(e2eSecondReconcile.no_op, true, 'BGR-RESTRUCTURE-E2E the second full reconcile reports zero drift and no_op');
eq(e2eSecondReconcile.failed, 0, 'BGR-RESTRUCTURE-E2E the second full reconcile reports zero failures');
const e2eStatus = commandStatus({ root: e2eRoot, statePath: path.join(e2eRoot, 'state.json') }, {
  state: e2eState, boardMd: fs.readFileSync(e2eBoardPath, 'utf8'),
  loadCard: () => null, cardsRoot: e2eCardsRoot, boardPath: e2eBoardPath,
});
eq(e2eStatus.board_drift, [], 'BGR-RESTRUCTURE-E2E the epic drift audit reports clean');
eq(e2eStatus.projection_problems, [], 'BGR-RESTRUCTURE-E2E status reports zero projection problems');
eq(e2eStatus.discarded_total, 1, 'BGR-RESTRUCTURE-E2E the corpse tombstone is the only discard');
const e2eResolved = resolveEpicBoardSet({ parentBoardMd: e2eParent, cardsRoot: e2eCardsRoot });
eq(e2eResolved.epics.map((entry) => entry.epic), ['Family A', 'Family B'],
  'BGR-RESTRUCTURE-E2E the epic resolver sees both migrated family epics');
eq(e2eResolved.findings, [], 'BGR-RESTRUCTURE-E2E the epic resolver reports no findings');
const e2eReplay = await commandRestructure({ root: e2eRoot }, { spec: e2eSpecPath, json: true }, e2eDeps);
eq(e2eReplay.no_op, true, 'BGR-RESTRUCTURE-E2E the literal replay after reconcile is still a no-op');

// --- BGR-CUTOVER: receipt-gated, reversible ES5 epic-intake cutover flag ---
const cutRoot = path.join(tmp, 'bgr-cutover');
fs.mkdirSync(cutRoot, { recursive: true });
const cutBoardPath = path.join(cutRoot, 'board.md');
const cutCardPath = path.join(cutRoot, 'Cut card.md');
fs.writeFileSync(cutCardPath, '---\nkanban_column: In Progress\nstatus: in_progress\n---\nbody\n');
fs.writeFileSync(cutBoardPath, liveBoard({ progress: ['Cut card'] }));
const cutState = emptyState();
cutState.cards['Cut card'] = {
  card: 'Cut card', phase: 'implementing', card_path: cutCardPath,
  projection_reconciled_at: '2026-07-25T00:00:00.000Z',
};
let cutWrites = 0;
const cutLocks = [];
const cutDeps = {
  readState: () => cutState,
  writeState: () => { cutWrites++; },
  withLock: async (_ctx, name, fn) => { cutLocks.push(name); return fn(); },
  boardPath: cutBoardPath,
  now: () => '2026-07-25T18:00:00.000Z',
};

// Status before any cutover call: the object is absent (null), not fabricated.
const cutStatusBefore = commandStatus({ root: cutRoot, statePath: path.join(cutRoot, 'state.json') }, {
  state: cutState, boardMd: fs.readFileSync(cutBoardPath, 'utf8'), loadCard: () => null, boardPath: cutBoardPath, cardsRoot: cutRoot,
});
eq(cutStatusBefore.cutover, null, 'BGR-CUTOVER-REVERSIBLE status exposes cutover as null before any cutover write');
eq(cutStatusBefore.cutover_history, [], 'BGR-CUTOVER-REVERSIBLE status exposes an empty cutover_history before any flip');

// BGR-CUTOVER-STREAK: only clean FULL reconciles advance the counter.
const cutClean1 = await commandReconcile({ root: cutRoot }, {}, cutDeps);
eq(cutClean1.no_op, true, 'BGR-CUTOVER-STREAK the fixture starts converged (clean full pass)');
eq(cutClean1.reconcile_clean_streak, 1, 'BGR-CUTOVER-STREAK first clean full reconcile reports streak 1');
eq(cutState.reconcile_clean_streak, 1, 'BGR-CUTOVER-STREAK the streak persists in top-level coordinator state');
eq((await commandReconcile({ root: cutRoot }, {}, cutDeps)).reconcile_clean_streak, 2, 'BGR-CUTOVER-STREAK second clean full reconcile reports streak 2');
eq((await commandReconcile({ root: cutRoot }, {}, cutDeps)).reconcile_clean_streak, 3, 'BGR-CUTOVER-STREAK third clean full reconcile reports streak 3');
const cutSingle = await commandReconcile({ root: cutRoot }, { card: 'Cut card' }, cutDeps);
eq(cutSingle.no_op, true, 'BGR-CUTOVER-STREAK the single-card pass is itself clean');
ok(!('reconcile_clean_streak' in cutSingle), 'BGR-CUTOVER-STREAK single-card receipts never carry the streak');
eq(cutState.reconcile_clean_streak, 3, 'BGR-CUTOVER-STREAK single-card reconciles leave the streak untouched');
fs.writeFileSync(cutBoardPath, liveBoard({ planning: ['Cut card'] }));
const cutDrift = await commandReconcile({ root: cutRoot }, {}, cutDeps);
ok(cutDrift.changed >= 1, 'BGR-CUTOVER-STREAK the moved board line registers as drift on the full pass');
eq(cutDrift.reconcile_clean_streak, 0, 'BGR-CUTOVER-STREAK a drift-finding full reconcile resets the streak to 0');
eq(cutState.reconcile_clean_streak, 0, 'BGR-CUTOVER-STREAK the reset persists in coordinator state');

// BGR-CUTOVER-CRITERIA: --json first, operands required, every unmet criterion listed.
const opx2CutoverProjections = [];
const cutoverBaseDeps = {
  readState: () => cutState,
  writeState: () => { cutWrites++; },
  withLock: async (_ctx, name, fn) => { cutLocks.push(name); return fn(); },
  now: () => '2026-07-25T19:00:00.000Z',
  projectLoopStation: (_ctx, _state, updatedOn) => {
    opx2CutoverProjections.push(updatedOn);
    return { action: 'loop-station-projected', no_op: false, updated_on: updatedOn };
  },
};
cutLocks.length = 0;
const cutWritesBeforeRefusals = cutWrites;
await assert.rejects(() => commandCutover({ root: cutRoot }, { 'chain-prefix': 'ES' }, cutoverBaseDeps),
  /requires --json/, 'BGR-CUTOVER-CRITERIA cutover refuses without --json before any read or write');
eq(cutLocks, [], 'BGR-CUTOVER-CRITERIA missing --json refusal precedes every lock');
await assert.rejects(() => commandCutover({ root: cutRoot }, { json: true }, cutoverBaseDeps),
  /--require-card|--chain-prefix/, 'BGR-CUTOVER-CRITERIA cutover requires an explicit chain declaration operand');
eq(cutLocks, [], 'BGR-CUTOVER-CRITERIA missing-operand refusal precedes every lock');
eq(cutWrites, cutWritesBeforeRefusals, 'BGR-CUTOVER-CRITERIA usage refusals perform zero writes');
// All three criteria red: streak is 0, the ES chain is undeclared/incomplete,
// and the injected package.json has no registered harness.
const cutRefused = await commandCutover({ root: cutRoot }, {
  json: true, 'require-card': 'ES1 Alpha', 'chain-prefix': 'ES',
}, { ...cutoverBaseDeps, readPackageJson: () => ({ scripts: { test: 'echo nothing' } }) });
eq(cutRefused.action, 'cutover-refused', 'BGR-CUTOVER-CRITERIA unmet criteria refuse with a machine-readable receipt');
eq(cutRefused.enabled, false, 'BGR-CUTOVER-CRITERIA a refused cutover never enables');
eq(cutRefused.unmet, ['es_chain_complete', 'migration_harness_registered', 'reconcile_clean_streak'],
  'BGR-CUTOVER-CRITERIA the refusal lists EVERY unmet criterion');
ok(cutRefused.criteria.es_chain_complete.missing.some((entry) => entry.card === 'ES1 Alpha'),
  'BGR-CUTOVER-CRITERIA the chain criterion names the untracked required card');
ok(cutRefused.criteria.es_chain_complete.missing.some((entry) => entry.chain_prefix === 'ES'),
  'BGR-CUTOVER-CRITERIA a chain prefix matching zero ledger cards fails rather than passing vacuously');
ok(/reconcile_clean_streak 0 < 3/.test(cutRefused.criteria.reconcile_clean_streak.missing),
  'BGR-CUTOVER-CRITERIA the streak criterion reports the exact shortfall');
ok(typeof cutRefused.criteria.migration_harness_registered.missing === 'string',
  'BGR-CUTOVER-CRITERIA the harness criterion reports a machine-readable missing reason');
eq(cutWrites, cutWritesBeforeRefusals, 'BGR-CUTOVER-CRITERIA a refused cutover performs zero writes');
ok(!cutState.cutover, 'BGR-CUTOVER-CRITERIA a refused cutover leaves no cutover object in state');

// Rebuild the streak to 3, then complete the ES chain in the ledger.
await commandReconcile({ root: cutRoot }, {}, cutDeps);
await commandReconcile({ root: cutRoot }, {}, cutDeps);
eq((await commandReconcile({ root: cutRoot }, {}, cutDeps)).reconcile_clean_streak, 3,
  'BGR-CUTOVER-STREAK three clean full reconciles after a reset rebuild streak 3');
cutState.cards['ES1 Alpha'] = { card: 'ES1 Alpha', phase: 'deployed' };
cutState.cards['ES2 Beta'] = { card: 'ES2 Beta', phase: 'deployed' };
cutState.cards['ES3a Gamma'] = {
  card: 'ES3a Gamma', phase: 'discarded', discarded_at: '2026-07-24T00:00:00.000Z',
  discard_reason: 'superseded', superseded_by: 'ES3a2 Gamma rework (supersedes ES3a)', final_head: null, carried_fixtures: [],
};
cutState.cards['ES3a2 Gamma rework (supersedes ES3a)'] = { card: 'ES3a2 Gamma rework (supersedes ES3a)', phase: 'deployed' };
// The real repo package.json is the harness registry: de-registering
// run-codex-autoloop there must break this fixture (criterion 2 is live).
const realPackageJson = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
// Harness de-registration alone blocks cutover even with chain + streak green.
const cutHarnessOnly = await commandCutover({ root: cutRoot }, {
  json: true, 'require-card': 'ES1 Alpha', 'chain-prefix': 'ES',
}, { ...cutoverBaseDeps, readPackageJson: () => ({ scripts: { test: 'echo nothing' } }) });
eq(cutHarnessOnly.unmet, ['migration_harness_registered'],
  'BGR-CUTOVER-CRITERIA harness de-registration alone blocks an otherwise-green cutover');
// A tracked-but-parked chain card blocks completeness until it turns terminal.
cutState.cards['ES9 Parked'] = { card: 'ES9 Parked', phase: 'parked' };
const cutParked = await commandCutover({ root: cutRoot }, {
  json: true, 'require-card': 'ES1 Alpha', 'chain-prefix': 'ES',
}, { ...cutoverBaseDeps, readPackageJson: realPackageJson });
eq(cutParked.unmet, ['es_chain_complete'], 'BGR-CUTOVER-CRITERIA a parked chain card alone blocks cutover');
eq(cutParked.criteria.es_chain_complete.missing,
  [{ card: 'ES9 Parked', phase: 'parked', problem: "phase is neither 'deployed' nor tombstoned 'discarded'" }],
  'BGR-CUTOVER-CRITERIA the refusal names the parked card and its ledger phase');
cutState.cards['ES9 Parked'].phase = 'deployed'; // flipping it terminal unblocks the enable below
cutLocks.length = 0;
const cutWritesBeforeEnable = cutWrites;
const cutEnabled = await commandCutover({ root: cutRoot }, {
  json: true, 'require-card': 'ES1 Alpha', 'chain-prefix': 'ES',
}, { ...cutoverBaseDeps, readPackageJson: realPackageJson });
eq(cutEnabled.action, 'cutover', 'BGR-CUTOVER-CRITERIA all-green cutover emits the cutover receipt');
eq(cutEnabled.enabled, true, 'BGR-CUTOVER-CRITERIA all-green cutover enables the flag');
eq(cutEnabled.no_op, false, 'BGR-CUTOVER-CRITERIA first enable is not a no-op');
eq(opx2CutoverProjections, ['cutover'],
  'OPX2-TRANSITION-ONLY cutover enable fires exactly one Loop Station projection');
ok(cutLocks.includes('selector'), 'BGR-CUTOVER-CRITERIA cutover evaluates under the selector lock');
eq(cutWrites, cutWritesBeforeEnable + 1, 'BGR-CUTOVER-CRITERIA enabling writes coordinator state exactly once');
eq(cutState.cutover.enabled, true, 'BGR-CUTOVER-CRITERIA the enabled flag persists in coordinator state');
eq(cutState.cutover.enabled_at, '2026-07-25T19:00:00.000Z', 'BGR-CUTOVER-CRITERIA the receipt records when cutover enabled');
ok(cutState.cutover.receipts.es_chain_complete.satisfied.some((entry) => entry.card === 'ES3a Gamma' && entry.phase === 'discarded'),
  'BGR-CUTOVER-CRITERIA a tombstoned superseded ES sibling satisfies (never blocks) the chain criterion');
ok(cutState.cutover.receipts.es_chain_complete.satisfied.some((entry) => entry.card === 'ES1 Alpha' && entry.phase === 'deployed'),
  'BGR-CUTOVER-CRITERIA the receipt lists each deployed chain card as evidence');
ok(typeof cutState.cutover.receipts.migration_harness_registered.script === 'string',
  'BGR-CUTOVER-CRITERIA the receipt names the package.json script that registers the harness');
eq(cutState.cutover.receipts.reconcile_clean_streak.streak, 3,
  'BGR-CUTOVER-CRITERIA the receipt carries the clean-reconcile streak evidence');
eq(cutState.cutover_history, [{ enabled: true, at: '2026-07-25T19:00:00.000Z' }],
  'BGR-CUTOVER-REVERSIBLE the enable flip appends one cutover_history entry');

// BGR-CUTOVER-NOOP: replay when already enabled → no_op, zero writes.
const cutWritesBeforeReplay = cutWrites;
const cutReplay = await commandCutover({ root: cutRoot }, {
  json: true, 'require-card': 'ES1 Alpha', 'chain-prefix': 'ES',
}, { ...cutoverBaseDeps, readPackageJson: realPackageJson });
eq(cutReplay.no_op, true, 'BGR-CUTOVER-NOOP replay while enabled reports no_op:true');
eq(cutReplay.enabled, true, 'BGR-CUTOVER-NOOP replay reports the enabled flag');
eq(cutWrites, cutWritesBeforeReplay, 'BGR-CUTOVER-NOOP replay performs zero writes');
eq(cutState.cutover.enabled_at, '2026-07-25T19:00:00.000Z', 'BGR-CUTOVER-NOOP replay never restamps enabled_at');
eq(cutState.cutover_history.length, 1, 'BGR-CUTOVER-NOOP replay appends no cutover_history entry');
eq(opx2CutoverProjections, ['cutover'],
  'OPX2-TRANSITION-ONLY cutover replay fires no additional Loop Station projection');

// BGR-CUTOVER-REVERSIBLE: --off flips it back; status exposes both ways; re-enable works.
const cutStatusEnabled = commandStatus({ root: cutRoot, statePath: path.join(cutRoot, 'state.json') }, {
  state: cutState, boardMd: fs.readFileSync(cutBoardPath, 'utf8'), loadCard: () => null, boardPath: cutBoardPath, cardsRoot: cutRoot,
});
eq(cutStatusEnabled.cutover.enabled, true, 'BGR-CUTOVER-REVERSIBLE status --json exposes the enabled cutover object');
ok(cutStatusEnabled.cutover.receipts, 'BGR-CUTOVER-REVERSIBLE status carries the cutover receipts');
eq(cutStatusEnabled.cutover_history, [{ enabled: true, at: '2026-07-25T19:00:00.000Z' }],
  'BGR-CUTOVER-REVERSIBLE status --json exposes cutover_history while enabled');
await assert.rejects(() => commandCutover({ root: cutRoot }, { json: true, off: true }, cutoverBaseDeps),
  /--reason/, 'BGR-CUTOVER-REVERSIBLE --off requires a non-empty --reason');
await assert.rejects(() => commandCutover({ root: cutRoot }, { json: true, off: true, reason: 'x', 'chain-prefix': 'ES' }, cutoverBaseDeps),
  /never evaluates criteria/, 'BGR-CUTOVER-REVERSIBLE --off refuses criteria operands rather than silently ignoring them');
const cutOff = await commandCutover({ root: cutRoot }, { json: true, off: true, reason: 'live incident' }, cutoverBaseDeps);
eq(cutOff.enabled, false, 'BGR-CUTOVER-REVERSIBLE --off disables the flag');
eq(cutOff.no_op, false, 'BGR-CUTOVER-REVERSIBLE first --off is not a no-op');
eq(opx2CutoverProjections, ['cutover', 'cutover'],
  'OPX2-TRANSITION-ONLY cutover disable fires exactly one additional Loop Station projection');
eq(cutState.cutover, { enabled: false, disabled_at: '2026-07-25T19:00:00.000Z', reason: 'live incident' },
  'BGR-CUTOVER-REVERSIBLE the disable receipt records disabled_at and reason');
eq(cutState.cutover_history, [
  { enabled: true, at: '2026-07-25T19:00:00.000Z' },
  { enabled: false, at: '2026-07-25T19:00:00.000Z', reason: 'live incident' },
], 'BGR-CUTOVER-REVERSIBLE the disable flip appends a history entry carrying the reason');
const cutWritesBeforeOffReplay = cutWrites;
const cutOffReplay = await commandCutover({ root: cutRoot }, { json: true, off: true, reason: 'live incident' }, cutoverBaseDeps);
eq(cutOffReplay.no_op, true, 'BGR-CUTOVER-REVERSIBLE --off replay while disabled is a no_op');
eq(cutWrites, cutWritesBeforeOffReplay, 'BGR-CUTOVER-REVERSIBLE --off replay performs zero writes');
eq(cutState.cutover_history.length, 2, 'BGR-CUTOVER-REVERSIBLE --off replay appends no cutover_history entry');
const cutStatusDisabled = commandStatus({ root: cutRoot, statePath: path.join(cutRoot, 'state.json') }, {
  state: cutState, boardMd: fs.readFileSync(cutBoardPath, 'utf8'), loadCard: () => null, boardPath: cutBoardPath, cardsRoot: cutRoot,
});
eq(cutStatusDisabled.cutover, { enabled: false, disabled_at: '2026-07-25T19:00:00.000Z', reason: 'live incident' },
  'BGR-CUTOVER-REVERSIBLE status --json exposes the disabled cutover object');
eq(cutStatusDisabled.cutover_history.length, 2, 'BGR-CUTOVER-REVERSIBLE status --json exposes cutover_history while disabled');
const cutReEnabled = await commandCutover({ root: cutRoot }, {
  json: true, 'require-card': 'ES1 Alpha', 'chain-prefix': 'ES',
}, { ...cutoverBaseDeps, readPackageJson: realPackageJson });
eq(cutReEnabled.enabled, true, 'BGR-CUTOVER-REVERSIBLE a subsequent cutover with criteria green re-enables');
eq(cutReEnabled.no_op, false, 'BGR-CUTOVER-REVERSIBLE re-enable after --off is a fresh enable, not a replay');
eq(cutState.cutover.enabled, true, 'BGR-CUTOVER-REVERSIBLE the re-enabled flag persists with fresh receipts');
eq(cutState.cutover_history.length, 3, 'BGR-CUTOVER-REVERSIBLE the re-enable flip appends a third history entry');
eq(cutState.cutover_history[2], { enabled: true, at: '2026-07-25T19:00:00.000Z' },
  'BGR-CUTOVER-REVERSIBLE the newest history entry is the re-enable flip');
// History is bounded: seed past the cap, flip once, oldest entries drop.
cutState.cutover_history = Array.from({ length: 22 }, (_, i) => ({ enabled: i % 2 === 0, at: `seed-${i}` }));
await commandCutover({ root: cutRoot }, { json: true, off: true, reason: 'cap check' }, cutoverBaseDeps);
eq(cutState.cutover_history.length, 20, 'BGR-CUTOVER-REVERSIBLE cutover_history is capped at the 20 most recent entries');
eq(cutState.cutover_history[0].at, 'seed-3', 'BGR-CUTOVER-REVERSIBLE the cap drops the oldest entries first');
eq(cutState.cutover_history[19], { enabled: false, at: '2026-07-25T19:00:00.000Z', reason: 'cap check' },
  'BGR-CUTOVER-REVERSIBLE the newest capped entry is the latest flip');

// --- OPX4: coordinator-owned ratification inbox, receipt consumption, and digest feed ---
const OPX4_CARD = 'GA-TEST1a Exact ratification fixture';
const OPX4_HEAD = 'e'.repeat(40);
const opx4Vault = path.join(tmp, 'opx4-vault');
const opx4Project = path.join(opx4Vault, 'spice/projects/sauce');
const opx4Board = path.join(opx4Project, 'sauce-board.md');
const opx4Worktree = path.join(tmp, 'opx4-worktree');
const opx4CardPath = path.join(opx4Project, 'tasks/Test epic/board', `${OPX4_CARD}.md`);
fs.mkdirSync(path.dirname(opx4CardPath), { recursive: true });
fs.mkdirSync(opx4Worktree, { recursive: true });
fs.writeFileSync(opx4Board, [
  '# Board', '', '## In Planning', '', '## In Progress', '',
  `- [ ] [[${OPX4_CARD}]]`, '', '## Blocked', '', '## Completed', '',
].join('\n'));
fs.writeFileSync(opx4CardPath, card({ name: OPX4_CARD, parent: 'Test epic' })
  .replace('status: planning', 'status: parked'));
const opx4State = {
  schema_version: 1,
  cards: {
    [OPX4_CARD]: {
      card: OPX4_CARD,
      phase: 'parked',
      status: 'parked',
      model_profile: 'heavy',
      parent_card: 'Test epic',
      touch_zones: ['scripts/autoloop/codex-coordinator.js'],
      dependencies: [],
      deploy_subscriptions: { headspace: [], accuris: [], ero: [] },
      resume_condition: 'Will must ratify the exact bounded continuation.',
      gate_receipt: passingReceipt(OPX4_HEAD),
      reviews: { correctness: { head_sha: OPX4_HEAD } },
      worktree: opx4Worktree,
      card_path: opx4CardPath,
    },
  },
};
const firstScaffold = scaffoldPendingRatifications(opx4State, {
  boardPath: opx4Board,
  now: () => '2026-07-26T15:30:00.000Z',
  uuid: () => '11111111-2222-4333-8444-555555555555',
});
eq(firstScaffold.scaffolded.length, 1,
  'OPX4-SCAFFOLD-PREFILLED escalation projection scaffolds exactly one missing artifact');
const opx4Artifact = ratificationArtifactForCard(OPX4_CARD, opx4Board);
const opx4PendingRaw = fs.readFileSync(opx4Artifact.absolute, 'utf8');
eq(testScalarField(opx4PendingRaw, 'type'), 'ratification',
  'OPX4-SCAFFOLD-PREFILLED artifact frontmatter has the canonical type');
eq(testScalarField(opx4PendingRaw, 'state'), 'pending',
  'OPX4-SCAFFOLD-PREFILLED artifact frontmatter begins pending');
eq(testScalarField(opx4PendingRaw, 'target_card'), OPX4_CARD,
  'OPX4-SCAFFOLD-PREFILLED target identity comes from the ledger');
ok(opx4PendingRaw.includes(`"target_head": "${OPX4_HEAD}"`),
  'OPX4-SCAFFOLD-PREFILLED exact 40-hex target HEAD comes from the preserved gate receipt');
ok(opx4PendingRaw.includes('"decision": ""')
  && opx4PendingRaw.includes('"accepted_at": ""')
  && opx4PendingRaw.includes('"authority": ""'),
'OPX4-SCAFFOLD-PREFILLED only the three human-authored receipt fields begin empty');
const scaffoldReplay = scaffoldPendingRatifications(opx4State, {
  boardPath: opx4Board,
  now: () => '2026-07-26T16:00:00.000Z',
  uuid: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
});
eq(scaffoldReplay.scaffolded, [],
  'OPX4-BACKFILL-IDEMPOTENT replay scaffolds no artifact');
eq(fs.readFileSync(opx4Artifact.absolute, 'utf8'), opx4PendingRaw,
  'OPX4-BACKFILL-IDEMPOTENT replay preserves the existing artifact byte-for-byte');
const commandBackfillReplay = await commandBackfillRatifications({ root: tmp }, {
  _: ['backfill-ratifications'], json: true,
}, {
  boardPath: opx4Board,
  readState: () => opx4State,
  withLock: async (_ctx, _name, fn) => fn(),
});
eq(commandBackfillReplay.no_op, true,
  'OPX4-BACKFILL-IDEMPOTENT the explicit backfill replay emits no_op true');
ok(ratificationStatus(opx4State.cards[OPX4_CARD], opx4State, { boardPath: opx4Board }).error,
  'OPX4-CONSUME-INCOMPLETE status surfaces the incomplete pending receipt read-only');

let opx4Writes = 0;
let opx4StateReads = 0;
let opx4ProjectionWrites = 0;
const opx4ImmediateLock = async (_ctx, _name, fn) => fn();
const opx4Deps = {
  boardPath: opx4Board,
  cardsRoot: path.join(opx4Project, 'tasks'),
  readState: () => { opx4StateReads++; return opx4State; },
  writeState: () => { opx4Writes++; },
  withLock: opx4ImmediateLock,
  projectCard: () => { opx4ProjectionWrites++; return { changed: true }; },
  projectLoopStation: async () => {
    opx4ProjectionWrites++;
    return { action: 'loop-station-projected', no_op: false };
  },
  resolveWorktreeHead: () => OPX4_HEAD,
  now: () => '2026-07-26T15:31:00.000Z',
};
const opx4Args = { _: ['consume-ratification'], json: true, card: OPX4_CARD };
const incompleteConsume = await commandConsumeRatification({ root: tmp }, opx4Args, opx4Deps);
eq(incompleteConsume.action, 'ratification-refused',
  'OPX4-CONSUME-INCOMPLETE an empty decision refuses with a machine receipt');
eq(opx4Writes, 0, 'OPX4-CONSUME-INCOMPLETE refusal performs zero ledger writes');
eq(fs.readFileSync(opx4Artifact.absolute, 'utf8'), opx4PendingRaw,
  'OPX4-CONSUME-INCOMPLETE refusal leaves the pending artifact byte-identical');

const multiInvalidRaw = opx4PendingRaw.replace(
  'created_at:',
  'unexpected_one: "x"\nunexpected_two: "y"\ntype: ratification\ncreated_at:',
);
fs.writeFileSync(opx4Artifact.absolute, multiInvalidRaw);
const multiInvalidConsume = await commandConsumeRatification({ root: tmp }, opx4Args, opx4Deps);
eq(
  multiInvalidConsume.errors.filter((issue) => issue.code === 'ratification-frontmatter-field-unexpected')
    .map((issue) => issue.field),
  ['unexpected_one', 'unexpected_two'],
  'OPX4-CONSUME-INCOMPLETE returns every unsupported frontmatter field',
);
ok(multiInvalidConsume.errors.some((issue) => (
  issue.code === 'ratification-frontmatter-field-duplicate' && issue.field === 'type'
)), 'OPX4-CONSUME-INCOMPLETE rejects ambiguous duplicate frontmatter keys');
eq(opx4Writes, 0, 'OPX4-CONSUME-INCOMPLETE multi-error refusal performs zero ledger writes');

const tamperedRaw = opx4PendingRaw
  .replace('"decision": ""', '"decision": "accepted"')
  .replace('"accepted_at": ""', '"accepted_at": "2026-07-26T09:30:00-06:00"')
  .replace('"authority": ""', '"authority": "delegate"')
  .replace(OPX4_HEAD, `f${OPX4_HEAD.slice(1)}`);
fs.writeFileSync(opx4Artifact.absolute, tamperedRaw);
const tamperedConsume = await commandConsumeRatification({ root: tmp }, opx4Args, opx4Deps);
eq(tamperedConsume.action, 'ratification-refused',
  'OPX4-CONSUME-TAMPERED-HEAD target-head deviation refuses');
ok(tamperedConsume.errors.some((issue) => issue.code === 'ratification-target-head-mismatch'),
  'OPX4-CONSUME-TAMPERED-HEAD receipt names the exact-head mismatch');
eq(opx4Writes, 0, 'OPX4-CONSUME-TAMPERED-HEAD refusal performs zero ledger writes');
eq(fs.readFileSync(opx4Artifact.absolute, 'utf8'), tamperedRaw,
  'OPX4-CONSUME-TAMPERED-HEAD refusal does not flip artifact state');

const authorityVerbatim = 'delegate: exact mechanical authority';
const acceptedRaw = opx4PendingRaw
  .replace('"decision": ""', '"decision": "accepted"')
  .replace('"accepted_at": ""', '"accepted_at": "2026-07-26T09:31:00-06:00"')
  .replace('"authority": ""', `"authority": ${JSON.stringify(authorityVerbatim)}`);
const duplicatePayloadRaw = acceptedRaw
  .replace('"decision": "accepted"', '"decision": "",\n  "decision": "accepted"')
  .replace(
    `"authority": ${JSON.stringify(authorityVerbatim)}`,
    `"authority": "",\n  "authority": ${JSON.stringify(authorityVerbatim)}`,
  );
fs.writeFileSync(opx4Artifact.absolute, duplicatePayloadRaw);
const duplicatePayloadConsume = await commandConsumeRatification(
  { root: tmp }, opx4Args, opx4Deps,
);
eq(
  duplicatePayloadConsume.errors.filter((issue) => issue.code === 'ratification-field-duplicate')
    .map((issue) => issue.field),
  ['decision', 'authority'],
  'OPX4-CONSUME-INCOMPLETE returns every duplicate selected receipt payload field',
);
eq(opx4Writes, 0,
  'OPX4-CONSUME-INCOMPLETE duplicate-payload refusal performs zero ledger writes');
eq(fs.readFileSync(opx4Artifact.absolute, 'utf8'), duplicatePayloadRaw,
  'OPX4-CONSUME-INCOMPLETE duplicate-payload refusal leaves the artifact byte-identical');
const mixedPayloadInvalidRaw = acceptedRaw
  .replace(
    '"decision": "accepted"',
    '"decision": "accepted",\n  "decision": "provisionally_accepted"',
  )
  .replace('"accepted_at": "2026-07-26T09:31:00-06:00"', '"accepted_at": "not-a-timestamp"')
  .replace(`"target_card": "${OPX4_CARD}"`, '"target_card": "GA-OPX4 wrong target"')
  .replace(`"target_head": "${OPX4_HEAD}"`, `"target_head": "${'b'.repeat(40)}"`)
  .replace(
    '  "scope": [',
    '  "unexpected_one": "x",\n  "unexpected_two": "y",\n  "scope": [',
  );
fs.writeFileSync(opx4Artifact.absolute, mixedPayloadInvalidRaw);
const mixedPayloadInvalidConsume = await commandConsumeRatification(
  { root: tmp }, opx4Args, opx4Deps,
);
eq(
  mixedPayloadInvalidConsume.errors.map((issue) => [issue.code, issue.field]),
  [
    ['ratification-field-duplicate', 'decision'],
    ['ratification-field-unexpected', 'unexpected_one'],
    ['ratification-field-unexpected', 'unexpected_two'],
    ['invalid-ratification-timestamp', 'accepted_at'],
    ['ratification-target-card-mismatch', 'target_card'],
    ['ratification-target-head-mismatch', 'target_head'],
    ['ratification-decision-mismatch', 'decision'],
  ],
  'GA-OPS19A4-MIXED-PAYLOAD-ERROR-EXHAUSTIVENESS returns structural, semantic, and binding errors together',
);
eq(opx4Writes, 0,
  'GA-OPS19A4-MIXED-PAYLOAD-ERROR-EXHAUSTIVENESS performs zero ledger writes');
eq(fs.readFileSync(opx4Artifact.absolute, 'utf8'), mixedPayloadInvalidRaw,
  'GA-OPS19A4-MIXED-PAYLOAD-ERROR-EXHAUSTIVENESS leaves the artifact pending and byte-identical');
const mixedSectionOffset = mixedPayloadInvalidRaw.indexOf(`## Ratification — ${OPX4_CARD}`);
ok(mixedSectionOffset >= 0,
  'GA-OPS19A5-AUTHORITATIVE-SECTION-OFFSET-COLLISION locates the authoritative section fixture');
const mixedSection = mixedPayloadInvalidRaw.slice(mixedSectionOffset);
const positionCollisionRaw = [
  mixedPayloadInvalidRaw.slice(0, mixedSectionOffset),
  '````md',
  mixedSection,
  '````',
  '',
  mixedPayloadInvalidRaw.slice(mixedSectionOffset),
].join('\n');
fs.writeFileSync(opx4Artifact.absolute, positionCollisionRaw);
const positionCollisionConsume = await commandConsumeRatification(
  { root: tmp }, opx4Args, opx4Deps,
);
eq(
  positionCollisionConsume.errors.map((issue) => [issue.code, issue.field]),
  mixedPayloadInvalidConsume.errors.map((issue) => [issue.code, issue.field]),
  'GA-OPS19A5-AUTHORITATIVE-SECTION-OFFSET-COLLISION ignores the earlier byte-identical fenced decoy and preserves the exhaustive error order',
);
eq(opx4Writes, 0,
  'GA-OPS19A5-AUTHORITATIVE-SECTION-OFFSET-COLLISION performs zero ledger writes');
eq(opx4ProjectionWrites, 0,
  'GA-OPS19A5-AUTHORITATIVE-SECTION-OFFSET-COLLISION performs zero card or Loop Station projection writes');
eq(fs.readFileSync(opx4Artifact.absolute, 'utf8'), positionCollisionRaw,
  'GA-OPS19A5-AUTHORITATIVE-SECTION-OFFSET-COLLISION leaves the pending artifact byte-identical');
const multiPayloadDecoy = [
  '````md',
  `## Ratification — ${OPX4_CARD}`,
  '```delivery-ratification',
  '{"decoy_unexpected":"must-not-be-selected"}',
  '```',
  '````',
  '',
].join('\n');
const multiPayloadInvalidRaw = `${multiPayloadDecoy}${acceptedRaw.replace(
  '  "scope": [',
  '  "unexpected_one": "x",\n  "unexpected_two": "y",\n  "scope": [',
)}`;
fs.writeFileSync(opx4Artifact.absolute, multiPayloadInvalidRaw);
const multiPayloadInvalidConsume = await commandConsumeRatification(
  { root: tmp }, opx4Args, opx4Deps,
);
eq(
  multiPayloadInvalidConsume.errors.filter((issue) => issue.code === 'ratification-field-unexpected')
    .map((issue) => issue.field),
  ['unexpected_one', 'unexpected_two'],
  'OPX4-CONSUME-INCOMPLETE returns every unsupported receipt payload field',
);
eq(opx4Writes, 0,
  'OPX4-CONSUME-INCOMPLETE multi-payload-error refusal performs zero ledger writes');
fs.writeFileSync(opx4Artifact.absolute, acceptedRaw);
await assert.rejects(() => commandConsumeRatification({ root: tmp }, opx4Args, {
  ...opx4Deps,
  writeText: (_target, value) => {
    if (String(value).includes('state: consumed')) throw new Error('injected artifact finalize failure');
  },
}), /injected artifact finalize failure/,
'OPX4-CONSUME-VALID a post-ledger artifact finalize failure remains recoverable');
count++;
ok(opx4State.cards[OPX4_CARD].ratification_receipt
  && testScalarField(fs.readFileSync(opx4Artifact.absolute, 'utf8'), 'state') === 'pending',
'OPX4-CONSUME-VALID authority persists before a failed consumed-state flip');
const validConsume = await commandConsumeRatification({ root: tmp }, opx4Args, opx4Deps);
eq(validConsume.action, 'ratification-consumed',
  'OPX4-CONSUME-VALID a complete exact-head artifact is consumed');
eq(validConsume.recovered, true,
  'OPX4-CONSUME-VALID literal recovery finishes the pending artifact flip');
eq(opx4State.cards[OPX4_CARD].ratification_receipt.authority, authorityVerbatim,
  'OPX4-AUTHORITY-VERBATIM authority is recorded exactly without validator policy');
for (const field of ['artifact_path', 'artifact_sha256', 'section_heading', 'section_sha256']) {
  ok(opx4State.cards[OPX4_CARD].ratification_receipt[field],
    `OPX4-CONSUME-VALID stores receipt provenance ${field}`);
}
eq(opx4State.cards[OPX4_CARD].phase, 'implementing',
  'OPX4-CONSUME-VALID resolves the ratification park');
const opx4ConsumedRaw = fs.readFileSync(opx4Artifact.absolute, 'utf8');
eq(testScalarField(opx4ConsumedRaw, 'state'), 'consumed',
  'OPX4-CONSUME-VALID flips artifact frontmatter to consumed');
eq(testScalarField(opx4ConsumedRaw, 'consumed_at'), '2026-07-26T15:31:00.000Z',
  'OPX4-CONSUME-VALID records the exact consumption timestamp');
const opx4WritesAfterSuccess = opx4Writes;
const replayConsume = await commandConsumeRatification({ root: tmp }, opx4Args, opx4Deps);
eq(replayConsume.no_op, true,
  'OPX4-REPLAY-LITERAL identical re-consume returns no_op true');
eq(opx4Writes, opx4WritesAfterSuccess,
  'OPX4-REPLAY-LITERAL exact replay performs no additional ledger write');
fs.writeFileSync(opx4Artifact.absolute, `${opx4ConsumedRaw}\nchanged prose outside the receipt\n`);
await assert.rejects(
  () => commandConsumeRatification({ root: tmp }, opx4Args, opx4Deps),
  /differs from the stored exact-head receipt/,
  'OPX4-REPLAY-LITERAL full consumed-artifact drift refuses even when the selected receipt is unchanged',
);
count++;
fs.writeFileSync(opx4Artifact.absolute, opx4ConsumedRaw);
await assert.rejects(() => commandConsumeRatification({ root: tmp }, {
  ...opx4Args,
  artifact: opx4Artifact.relative,
}, opx4Deps), /different operands; replay must be literal/,
'OPX4-REPLAY-LITERAL an explicit substituted artifact operand refuses after omitted-operand success');
count++;

const outsideArtifact = path.join(opx4Vault, 'outside.md');
fs.writeFileSync(outsideArtifact, '# outside\n');
const readsBeforeContainment = opx4StateReads;
await assert.rejects(() => commandConsumeRatification({ root: tmp }, {
  ...opx4Args,
  artifact: 'outside.md',
}, opx4Deps), /inside the project ratifications directory/,
'OPX4-CONTAINMENT an artifact outside the ratifications root refuses');
count++;
eq(opx4StateReads, readsBeforeContainment,
  'OPX4-CONTAINMENT refusal happens before any state read');

const opx4Digest = deliveryStatusDigest.buildDigest({
  active: [],
  parked: [],
  tracked: [],
  ratified_recent: [{
    card: OPX4_CARD,
    authority: authorityVerbatim,
    at: '2026-07-26T09:31:00-06:00',
    artifact_path: opx4Artifact.relative,
  }],
}, '', [], { lastSeen: '2026-07-26T09:00:00-06:00' });
eq(opx4Digest.since.ratified, [{
  card: OPX4_CARD,
  authority: authorityVerbatim,
  at: '2026-07-26T09:31:00-06:00',
  artifact_path: opx4Artifact.relative,
}], 'OPX4-CONSUME-VALID successful consumption enters the digest ratified feed');
const opx4OffsetDigest = deliveryStatusDigest.buildDigest({
  active: [],
  parked: [],
  tracked: [],
  ratified_recent: [{
    card: OPX4_CARD,
    authority: authorityVerbatim,
    at: '2026-07-26T10:01:00-06:00',
    artifact_path: opx4Artifact.relative,
  }],
}, '', [], { lastSeen: '2026-07-26T16:00:00.000Z' });
eq(opx4OffsetDigest.since.ratified.length, 1,
  'OPX4-CONSUME-VALID digest compares offset timestamps chronologically');
const opx4OffsetStatusState = emptyState();
opx4OffsetStatusState.cards['GA-RAT-NEWER'] = {
  card: 'GA-RAT-NEWER',
  phase: 'discarded',
  ratification_receipt: {
    accepted_at: '2026-07-26T10:00:00-06:00',
    authority: 'delegate',
    artifact_path: 'spice/projects/sauce/ratifications/GA-RAT-NEWER.md',
  },
};
opx4OffsetStatusState.cards['GA-RAT-OLDER'] = {
  card: 'GA-RAT-OLDER',
  phase: 'discarded',
  ratification_receipt: {
    accepted_at: '2026-07-26T15:30:00Z',
    authority: 'delegate',
    artifact_path: 'spice/projects/sauce/ratifications/GA-RAT-OLDER.md',
  },
};
const opx4OffsetStatus = commandStatus(
  { root: tmp, statePath: path.join(tmp, 'opx4-offset-state.json') },
  {
    state: opx4OffsetStatusState,
    boardMd: '# Board\n\n## In Planning\n\n## In Progress\n\n## Blocked\n\n## Completed\n',
    boardPath: opx4Board,
    cardsRoot: opx4Project,
    loadCard: () => null,
    exists: () => false,
  },
);
eq(opx4OffsetStatus.ratified_recent.map((item) => item.card), ['GA-RAT-NEWER', 'GA-RAT-OLDER'],
  'OPX4-CONSUME-VALID status orders offset ratification timestamps chronologically');

const deliveryReviewTriage = require('../../scripts/autoloop/delivery-review-triage');
for (const [label, wait, expectedBucket] of [
  ['sibling', ratificationAcceptedWait({ sibling: { card: 'GA-SIBLING' } }), 'concurrency-wait'],
  ['touch-zone', ratificationAcceptedWait({ conflict: { card: 'GA-CONFLICT' } }), 'concurrency-wait'],
  ['dependency', ratificationAcceptedWait({ unmet: ['GA-DEP'] }), 'deploy-wait'],
  ['capacity', ratificationAcceptedWait({ atCapacity: true }), 'concurrency-wait'],
]) {
  eq(
    deliveryReviewTriage.classifyCard(
      { card: `GA-WAIT-${label}`, status: 'parked', resume_condition: wait },
      { activeIds: new Set(), tracked: [] },
    ),
    expectedBucket,
    `OPX4-CONSUME-VALID accepted ${label} constraint remains a loop-owned wait`,
  );
}

const OPX4_DEAD_CARD = 'GA-TEST1b Discarded dependency ratification fixture';
const OPX4_DEAD_DEP = 'GA-TEST0a Discarded prerequisite';
const opx4DeadCardPath = path.join(
  opx4Project, 'tasks/Test epic/board', `${OPX4_DEAD_CARD}.md`,
);
fs.writeFileSync(opx4DeadCardPath, card({ name: OPX4_DEAD_CARD, parent: 'Test epic' })
  .replace('status: planning', 'status: parked'));
const opx4DeadState = {
  schema_version: 1,
  cards: {
    [OPX4_DEAD_DEP]: {
      card: OPX4_DEAD_DEP,
      phase: 'discarded',
      superseded_by: 'GA-TEST0a2 Deployed successor',
    },
    [OPX4_DEAD_CARD]: {
      card: OPX4_DEAD_CARD,
      phase: 'parked',
      status: 'parked',
      model_profile: 'heavy',
      parent_card: 'Test epic',
      touch_zones: ['scripts/autoloop/codex-coordinator.js'],
      dependencies: [OPX4_DEAD_DEP],
      deploy_subscriptions: { headspace: [], accuris: [], ero: [] },
      resume_condition: 'Will must ratify the exact bounded continuation.',
      gate_receipt: passingReceipt(OPX4_HEAD),
      reviews: { correctness: { head_sha: OPX4_HEAD } },
      worktree: opx4Worktree,
      card_path: opx4DeadCardPath,
    },
  },
};
scaffoldPendingRatifications(opx4DeadState, {
  boardPath: opx4Board,
  now: () => '2026-07-26T15:40:00.000Z',
  uuid: () => '99999999-2222-4333-8444-555555555555',
});
const opx4DeadArtifact = ratificationArtifactForCard(OPX4_DEAD_CARD, opx4Board);
const opx4DeadAcceptedRaw = fs.readFileSync(opx4DeadArtifact.absolute, 'utf8')
  .replace('"decision": ""', '"decision": "accepted"')
  .replace('"accepted_at": ""', '"accepted_at": "2026-07-26T09:40:00-06:00"')
  .replace('"authority": ""', '"authority": "delegate"');
fs.writeFileSync(opx4DeadArtifact.absolute, opx4DeadAcceptedRaw);
let opx4DeadProjectedPhase = null;
let opx4DeadStationProjections = 0;
const opx4DeadArgs = {
  _: ['consume-ratification'], json: true, card: OPX4_DEAD_CARD,
};
const opx4DeadDeps = {
  boardPath: opx4Board,
  cardsRoot: path.join(opx4Project, 'tasks'),
  readState: () => opx4DeadState,
  writeState: () => {},
  withLock: opx4ImmediateLock,
  projectCard: (_cardPath, _boardPath, _card, phase) => {
    opx4DeadProjectedPhase = phase;
    return { changed: true };
  },
  projectLoopStation: async () => {
    opx4DeadStationProjections++;
    return { action: 'loop-station-projected', no_op: false };
  },
  resolveWorktreeHead: () => OPX4_HEAD,
  now: () => '2026-07-26T15:41:00.000Z',
};
await assert.rejects(() => commandConsumeRatification(
  { root: tmp },
  opx4DeadArgs,
  {
    ...opx4DeadDeps,
    writeText: (_target, value) => {
      if (String(value).includes('state: consumed')) {
        throw new Error('injected deadend artifact finalize failure');
      }
    },
  },
), /injected deadend artifact finalize failure/,
'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND preserves blocked authority when artifact finalization fails');
count++;
eq(opx4DeadState.cards[OPX4_DEAD_CARD].phase, 'blocked',
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND stores the deadend before artifact finalization');
eq(opx4DeadProjectedPhase, null,
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND cannot project before interrupted artifact finalization');
eq(opx4DeadStationProjections, 0,
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND cannot project Loop Station before interrupted finalization');
const opx4DeadConsume = await commandConsumeRatification(
  { root: tmp },
  opx4DeadArgs,
  opx4DeadDeps,
);
eq(opx4DeadConsume.recovered, true,
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND literal replay reports recovered finalization');
eq(opx4DeadStationProjections, 1,
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND literal recovery refreshes Loop Station exactly once');
eq(testScalarField(fs.readFileSync(opx4DeadArtifact.absolute, 'utf8'), 'state'), 'consumed',
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND literal recovery finalizes the artifact');
eq(opx4DeadConsume.action, 'ratification-consumed-deadend',
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND emits a fail-loud consumption receipt');
eq(opx4DeadState.cards[OPX4_DEAD_CARD].phase, 'blocked',
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND moves the accepted card out of parked');
ok(opx4DeadConsume.blocked === true
  && opx4DeadConsume.deadend.includes(`depends on discarded card ${OPX4_DEAD_DEP}`),
'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND names the impossible prerequisite');
eq(opx4DeadProjectedPhase, 'blocked',
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND projects the coordinator deadend');
eq(opx4DeadState.cards[OPX4_DEAD_CARD].resume_condition, null,
  'GA-OPS19A3-DISCARDED-DEPENDENCY-DEADEND never writes a hidden deploy wait');

// GA-OPS19A2-CLI-DISPATCH-UNBOUND: execute both ratification verbs through
// main(), rather than proving only the exported command functions.
for (const [verb, args, expected] of [
  [
    'backfill-ratifications',
    ['backfill-ratifications'],
    /backfill-ratifications requires --json for a machine-readable receipt/,
  ],
  [
    'consume-ratification',
    ['consume-ratification', '--card', OPX4_CARD],
    /consume-ratification requires --json for a machine-readable receipt/,
  ],
]) {
  const { execFileSync: execCli } = require('child_process');
  const coordinatorCli = path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js');
  let cliError = null;
  try {
    execCli(process.execPath, [coordinatorCli, ...args], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) { cliError = err; }
  ok(cliError && expected.test(String(cliError.stderr)),
    `GA-OPS19A2-CLI-DISPATCH-UNBOUND ${verb} reaches its real dispatcher branch and refuses before state read`);
}

// CLI wiring: the cutover command exists and refuses without --json.
{
  const { execFileSync: execCli } = require('child_process');
  const coordinatorCli = path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js');
  let cliError = null;
  try {
    execCli('node', [coordinatorCli, 'cutover', '--chain-prefix', 'ES'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) { cliError = err; }
  ok(cliError && /requires --json/.test(String(cliError.stderr)),
    'CLI cutover without --json refuses with a machine-parseable error before any read or write');
}

// CLI wiring: the restructure command exists and refuses without --json.
{
  const { execFileSync: execCli } = require('child_process');
  const coordinatorCli = path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js');
  let cliError = null;
  try {
    execCli('node', [coordinatorCli, 'restructure', '--spec', 'missing.json'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) { cliError = err; }
  ok(cliError && /requires --json/.test(String(cliError.stderr)),
    'CLI restructure without --json refuses with a machine-parseable error before any read or write');
}

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

// LOOP-MERGE-ONLY-GATE: verify-gates on a merge-only binding (empty vault
// list) uses the installed gate script by absolute path with --cwd, runs the
// binding's verify commands instead of the sauce release preflights, and never
// touches npm or the workshop self-install. Deploy-bound bindings keep the
// historical checks byte-identically.
{
  const gateWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-gate-wt-'));
  try {
    const mkRecord = () => ({
      card: 'PA-1 Merge-only slice', phase: 'implementing', worktree: gateWorktree,
      touch_zones: ['src', 'tests'],
      reviews: Object.fromEntries(['correctness', 'regression-risk', 'test-adequacy'].map((lens) => [
        lens, { lens, verdict: 'pass', refuted: false, summary: 'ok', head_sha: 'headM' },
      ])),
    });
    const mergeState = { schema_version: 1, cards: { 'PA-1 Merge-only slice': mkRecord() } };
    const calls = [];
    const gateSh = (cmd, cmdArgs, opts = {}) => {
      calls.push({ cmd, args: cmdArgs, cwd: opts.cwd });
      if (cmd === 'git' && cmdArgs[0] === 'status') return '';
      if (cmd === 'git' && cmdArgs[0] === 'rev-parse') return cmdArgs[1] === 'origin/main' ? 'baseM' : 'headM';
      if (cmd === 'git' && cmdArgs[0] === 'show') return 'fix(loop): merge-only fixture';
      if (cmd === 'git' && cmdArgs[0] === 'fetch') return '';
      if (cmd === 'git' && cmdArgs[0] === 'diff') return 'src/x.py\ntests/test_x.py';
      if (cmd === 'node' && String(cmdArgs[0]).endsWith('gate.js')) {
        return JSON.stringify({ behavioral: true, adequate: true, reason: 'ok' });
      }
      if (cmd === '/bin/sh' && cmdArgs[0] === '-c') return '';
      if (cmd === 'npm') throw new Error('npm must never run on a merge-only binding');
      throw new Error(`unexpected command: ${cmd} ${cmdArgs.join(' ')}`);
    };
    const mergeOnlyResult = await commandVerifyGates({ root: '/workshop' }, { card: 'PA-1 Merge-only slice' }, {
      readState: () => mergeState,
      writeState: () => {},
      sh: gateSh,
      withLock: immediateCardLock,
      deployVaults: [],
      env: { SAUCE_LOOP_VERIFY_COMMANDS: JSON.stringify(['./venv/bin/pytest -q', 'echo lint']) },
      runIsolatedWorkshopSelfInstall: () => { throw new Error('self-install must never run on a merge-only binding'); },
    });
    eq(mergeOnlyResult.action, 'gates-passed', 'LOOP-MERGE-ONLY-GATE merge-only verify-gates passes');
    const gateCall = calls.find((c) => c.cmd === 'node' && String(c.args[0]).endsWith('gate.js'));
    ok(path.isAbsolute(gateCall.args[0]), 'LOOP-MERGE-ONLY-GATE gate.js invoked by absolute installed path');
    ok(gateCall.args.includes('--cwd') && gateCall.args[gateCall.args.indexOf('--cwd') + 1] === gateWorktree,
      'LOOP-MERGE-ONLY-GATE gate.js bound to the card worktree via --cwd');
    const shellCalls = calls.filter((c) => c.cmd === '/bin/sh');
    eq(shellCalls.length, 2, 'LOOP-MERGE-ONLY-GATE both verify commands ran');
    ok(!calls.some((c) => c.cmd === 'npm'), 'LOOP-MERGE-ONLY-GATE npm never invoked');
    const mergeReceipt = mergeState.cards['PA-1 Merge-only slice'].gate_receipt;
    eq(mergeReceipt.merge_only, true, 'LOOP-MERGE-ONLY-GATE receipt marked merge_only');
    eq(mergeReceipt.checks.verify_commands.status, 'pass', 'LOOP-MERGE-ONLY-GATE receipt records verify commands');

    // Malformed verify-commands env fails loud before any command runs.
    const badState = { schema_version: 1, cards: { 'PA-1 Merge-only slice': mkRecord() } };
    await assert.rejects(() => commandVerifyGates({ root: '/workshop' }, { card: 'PA-1 Merge-only slice' }, {
      readState: () => badState,
      writeState: () => {},
      sh: gateSh,
      withLock: immediateCardLock,
      deployVaults: [],
      env: { SAUCE_LOOP_VERIFY_COMMANDS: '{not json' },
    }), /not valid JSON/, 'LOOP-MERGE-ONLY-GATE malformed verify-commands env fails loud');

    // Deploy-bound guard: default vault list still runs the sauce checks.
    const deployState = { schema_version: 1, cards: { 'PA-1 Merge-only slice': mkRecord() } };
    const deployCalls = [];
    let selfInstalls = 0;
    const deployResult = await commandVerifyGates({ root: '/workshop' }, { card: 'PA-1 Merge-only slice' }, {
      readState: () => deployState,
      writeState: () => {},
      sh: (cmd, cmdArgs, opts = {}) => {
        deployCalls.push({ cmd, args: cmdArgs });
        if (cmd === 'git' && cmdArgs[0] === 'status') return '';
        if (cmd === 'git' && cmdArgs[0] === 'rev-parse') return cmdArgs[1] === 'origin/main' ? 'baseM' : 'headM';
        if (cmd === 'git' && cmdArgs[0] === 'show') return 'fix(loop): deploy-bound fixture';
        if (cmd === 'git' && cmdArgs[0] === 'fetch') return '';
        if (cmd === 'git' && cmdArgs[0] === 'diff') return 'src/x.py\ntests/test_x.py';
        if (cmd === 'node' && String(cmdArgs[0]).endsWith('gate.js')) return JSON.stringify({ behavioral: true, adequate: true, reason: 'ok' });
        if (cmd === 'npm') return '';
        throw new Error(`unexpected command: ${cmd} ${cmdArgs.join(' ')}`);
      },
      withLock: immediateCardLock,
      deployVaults: [{ id: 'headspace', path: '/v/h' }],
      runIsolatedWorkshopSelfInstall: () => { selfInstalls += 1; },
    });
    eq(deployResult.action, 'gates-passed', 'LOOP-MERGE-ONLY-GATE deploy-bound path still passes');
    eq(deployCalls.filter((c) => c.cmd === 'npm').length, 2, 'LOOP-MERGE-ONLY-GATE deploy-bound path keeps both npm preflights');
    eq(selfInstalls, 1, 'LOOP-MERGE-ONLY-GATE deploy-bound path keeps the workshop self-install');
    const deployGateCall = deployCalls.find((c) => c.cmd === 'node' && String(c.args[0]).endsWith('gate.js'));
    eq(deployGateCall.args[0], 'scripts/autoloop/gate.js', 'LOOP-MERGE-ONLY-GATE deploy-bound gate invocation is byte-identical (repo-relative, no --cwd)');
    ok(!deployGateCall.args.includes('--cwd'), 'LOOP-MERGE-ONLY-GATE deploy-bound gate has no --cwd flag');
  } finally {
    fs.rmSync(gateWorktree, { recursive: true, force: true });
  }
}

// LOOP-AMEND-PARK: bounded supervised repair for parked-card metadata (wrong
// dependency recorded at park time, e.g. the ero OC-1/EM-1 knot). Compare-and-
// swap on the preserved worktree HEAD, audit trail, literal replay no_op;
// never touches receipts, worktrees, or non-parked cards.
{
  const parkWt = fs.mkdtempSync(path.join(os.tmpdir(), 'amend-park-wt-'));
  try {
    const HEAD40 = 'a'.repeat(40);
    const mkParked = () => ({
      card: 'OC-1 Parked slice', phase: 'parked', worktree: parkWt, branch: 'x/oc-1',
      dependencies: ['[[EM-4 Wrong dependency]]'], resume_condition: 'blocked on EM-4',
      reviews: { correctness: { lens: 'correctness', verdict: 'pass', head_sha: HEAD40 } },
    });
    const amendDeps = (state, extra = {}) => ({
      readState: () => state,
      writeState: () => {},
      withLock: immediateCardLock,
      sh: (cmd, cmdArgs) => {
        if (cmd === 'git' && cmdArgs[0] === 'rev-parse') return HEAD40;
        throw new Error(`unexpected command: ${cmd} ${cmdArgs.join(' ')}`);
      },
      findCard: () => '/vault/tasks/somewhere.md',
      projectCard: () => {},
      boardPath: '/vault/board.md',
      cardsRoot: '/vault/tasks',
      now: () => '2026-07-28T00:00:00.000Z',
      ...extra,
    });

    const amendState = { schema_version: 1, cards: { 'OC-1 Parked slice': mkParked() } };
    const amended = await coordinator.commandAmendPark({ root: '/workshop' }, {
      json: true, card: 'OC-1 Parked slice', 'expected-head': HEAD40,
      reason: 'park recorded an impossible dependency; prerequisite shipped upstream',
      'clear-dependencies': true, 'resume-condition': 'ready to resume — upstream fix deployed',
    }, amendDeps(amendState));
    eq(amended.action, 'park-amended', 'LOOP-AMEND-PARK amend succeeds');
    const rec = amendState.cards['OC-1 Parked slice'];
    eq(rec.dependencies, [], 'LOOP-AMEND-PARK dependencies cleared');
    eq(rec.resume_condition, 'ready to resume — upstream fix deployed', 'LOOP-AMEND-PARK resume condition replaced');
    eq(rec.park_amendments.length, 1, 'LOOP-AMEND-PARK audit record appended');
    eq(rec.park_amendments[0].previous.dependencies, ['[[EM-4 Wrong dependency]]'], 'LOOP-AMEND-PARK audit preserves the previous metadata');
    ok(rec.reviews.correctness.verdict === 'pass', 'LOOP-AMEND-PARK preserved receipts untouched');
    eq(rec.phase, 'parked', 'LOOP-AMEND-PARK card stays parked (resume is a separate explicit command)');

    const replay = await coordinator.commandAmendPark({ root: '/workshop' }, {
      json: true, card: 'OC-1 Parked slice', 'expected-head': HEAD40,
      reason: 'park recorded an impossible dependency; prerequisite shipped upstream',
      'clear-dependencies': true, 'resume-condition': 'ready to resume — upstream fix deployed',
    }, amendDeps(amendState));
    eq(replay.no_op, true, 'LOOP-AMEND-PARK literal replay is no_op');
    eq(amendState.cards['OC-1 Parked slice'].park_amendments.length, 1, 'LOOP-AMEND-PARK replay appends no second audit record');

    const headMismatchState = { schema_version: 1, cards: { 'OC-1 Parked slice': mkParked() } };
    await assert.rejects(() => coordinator.commandAmendPark({ root: '/workshop' }, {
      json: true, card: 'OC-1 Parked slice', 'expected-head': 'b'.repeat(40),
      reason: 'stale head', 'clear-dependencies': true,
    }, amendDeps(headMismatchState)), /head_mismatch|expected HEAD/, 'LOOP-AMEND-PARK refuses a stale expected head');
    eq(headMismatchState.cards['OC-1 Parked slice'].dependencies, ['[[EM-4 Wrong dependency]]'],
      'LOOP-AMEND-PARK refused amend leaves metadata untouched');

    const notParkedState = { schema_version: 1, cards: { 'OC-1 Parked slice': { ...mkParked(), phase: 'implementing' } } };
    await assert.rejects(() => coordinator.commandAmendPark({ root: '/workshop' }, {
      json: true, card: 'OC-1 Parked slice', 'expected-head': HEAD40,
      reason: 'wrong phase', 'clear-dependencies': true,
    }, amendDeps(notParkedState)), /phase_ineligible|only amends parked/, 'LOOP-AMEND-PARK refuses non-parked cards');

    await assert.rejects(() => coordinator.commandAmendPark({ root: '/workshop' }, {
      json: true, card: 'OC-1 Parked slice', 'expected-head': HEAD40,
      reason: 'both operands', 'clear-dependencies': true, 'depends-on': 'EM-2 Other',
    }, amendDeps({ schema_version: 1, cards: { 'OC-1 Parked slice': mkParked() } })),
    /exactly one of/, 'LOOP-AMEND-PARK refuses --clear-dependencies combined with --depends-on');

    const missingDepState = { schema_version: 1, cards: { 'OC-1 Parked slice': mkParked() } };
    await assert.rejects(() => coordinator.commandAmendPark({ root: '/workshop' }, {
      json: true, card: 'OC-1 Parked slice', 'expected-head': HEAD40,
      reason: 'swap dependency', 'depends-on': 'EM-9 Ghost card',
    }, amendDeps(missingDepState, { findCard: () => null })), /dependency_missing|does not exist/,
    'LOOP-AMEND-PARK refuses a replacement dependency that does not exist');
  } finally {
    fs.rmSync(parkWt, { recursive: true, force: true });
  }
}

// LOOP-RESUME-CLEARED-PARK: a parked card whose dependencies were cleared by
// amend-park (audit trail present) is resumable; the same empty list WITHOUT
// the audit trail stays refused as malformed park metadata.
{
  const resumeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-cleared-park-'));
  try {
    const HEAD40 = 'c'.repeat(40);
    const resumeWt = path.join(resumeRoot, 'wt'); fs.mkdirSync(resumeWt);
    const cardPath = path.join(resumeRoot, 'OC-1 Cleared slice.md');
    fs.writeFileSync(cardPath, '---\ntype: slice\nstatus: parked\nresume_condition: ready — upstream merge-only support deployed\n---\nbody\n');
    const resumeBoard = path.join(resumeRoot, 'board.md');
    fs.writeFileSync(resumeBoard, '## In Planning\n\n## Completed\n');
    const mkCleared = (audited) => ({
      card: 'OC-1 Cleared slice', phase: 'parked', worktree: resumeWt, branch: 'x/oc-1',
      card_path: cardPath, dependencies: [], touch_zones: ['some/zone'],
      resume_condition: 'ready — upstream merge-only support deployed',
      ...(audited ? {
        park_amendments: [{
          at: '2026-07-29T00:00:00.000Z', reason: 'wrong dependency recorded at park',
          previous: { dependencies: ['[[EM-4 Wrong dependency]]'], resume_condition: 'blocked' },
          next: { dependencies: [], resume_condition: 'ready — upstream merge-only support deployed' },
        }],
      } : {}),
    });
    const resumeDeps = (state) => ({
      readState: () => state,
      writeState: () => {},
      withLock: immediateCardLock,
      findCard: () => cardPath,
      sh: (cmd, cmdArgs) => {
        if (cmd === 'git' && cmdArgs[0] === 'fetch') return '';
        if (cmd === 'git' && cmdArgs[0] === 'rev-parse') return HEAD40;
        if (cmd === 'git' && cmdArgs[0] === 'merge-base') return '';
        throw new Error(`unexpected command: ${cmd} ${cmdArgs.join(' ')}`);
      },
      boardPath: resumeBoard,
      projectCard: () => {},
      now: () => '2026-07-29T00:00:00.000Z',
    });

    const clearedState = { schema_version: 1, cards: { 'OC-1 Cleared slice': mkCleared(true) } };
    const resumed = await coordinator.commandResume({ root: '/workshop' }, {
      json: true, card: 'OC-1 Cleared slice',
    }, resumeDeps(clearedState));
    ok(resumed.action !== 'resume-refused', 'LOOP-RESUME-CLEARED-PARK audited empty dependencies resume');
    eq(clearedState.cards['OC-1 Cleared slice'].phase, 'implementing',
      'LOOP-RESUME-CLEARED-PARK resumed card is implementing');
    eq(clearedState.cards['OC-1 Cleared slice'].gate_receipt, null,
      'LOOP-RESUME-CLEARED-PARK resume still invalidates receipts');

    const unauditedState = { schema_version: 1, cards: { 'OC-1 Cleared slice': mkCleared(false) } };
    const refused = await coordinator.commandResume({ root: '/workshop' }, {
      json: true, card: 'OC-1 Cleared slice',
    }, resumeDeps(unauditedState));
    eq(refused.action, 'resume-refused', 'LOOP-RESUME-CLEARED-PARK unaudited empty dependencies stay refused');
    ok(/missing or malformed/.test(refused.reason), 'LOOP-RESUME-CLEARED-PARK refusal names malformed park metadata');
  } finally {
    fs.rmSync(resumeRoot, { recursive: true, force: true });
  }
}

console.log(`CODEX-AUTOLOOP PASS (${count} assertions)`);
})().catch((err) => { console.error(err); process.exit(1); });
