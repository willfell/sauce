#!/usr/bin/env node
/**
 * run-autoloop-select — preflight harness for the Sauce Autoloop deterministic
 * helpers (scripts/autoloop/select-card.js). Zero-dep.
 */
'use strict';
const path = require('path');
const { isBroadScope, parseBoard, recommendedFrom, selectCard, parsePlanningChecked, parseDependsOn, stripCardChrome,
  normalizeStatus, parseCardStatus, parseBatchPolicy, delivery } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'select-card.js'));
const { lockState, pidAlive } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'turn-lock.js'));
const { splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck, matchesGlob, parseGateConfig } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'gate.js'));
const { cmpVersion, deployPlan, verifyDeploy } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'deploy.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

function deliveryCard(name, body, options = {}) {
  const zones = options.zones || ['Docs/autoloop-fixture.md'];
  const deps = options.deps || [];
  const profile = options.profile || (zones.some((zone) => /^(?:scripts\/autoloop|platform\/mechanisms)/.test(zone)) ? 'heavy' : 'standard');
  const batchPolicy = options.batch_policy || delivery.derivePolicy({ touch_zones: zones, batch_policy: 'continue' });
  const evidence = [{
    source_identity: 'run-autoloop-select fixture', captured_at: '2026-07-17T06:00:00Z',
    revision: 'fixture-v1', locator: 'platform/test/run-autoloop-select.js', claim: 'Selector fixture.',
  }];
  return [
    '---', `card: ${name}`, `schema_version: ${delivery.CONTRACT_VERSION}`,
    'parent_card: "[[Selector fixtures]]"', `slice: ${name}`, `model_profile: ${profile}`,
    'execution_mode: release', `batch_policy: ${batchPolicy}`, `status: ${options.status || 'planning'}`,
    'kanban_column: In Planning', 'touch_zones:', ...zones.map((zone) => `  - ${zone}`),
    ...(deps.length ? ['depends_on:', ...deps.map((dep) => `  - "[[${dep}]]"`)] : ['depends_on: []']),
    'deploy_subscriptions:', '  headspace: []', '  accuris: []', '  ero: []',
    'epic: "[[Selector fixtures]]"', `evidence: ${JSON.stringify(evidence)}`, 'risk_dimensions: []',
    'release_required: true', 'deployment_required: true', ...(options.frontmatter || []), '---', '', body,
  ].join('\n');
}

// ---- isBroadScope (AB-*) ----
ok('AB-1 "audit the project blueprint" is broad', isBroadScope('audit the project blueprint').broad === true);
ok('AB-2 "redesign navigation" is broad', isBroadScope('Redesign navigation').broad === true);
ok('AB-3 "fix breadcrumb paren bug" is NOT broad', isBroadScope('fix breadcrumb paren bug').broad === false);
ok('AB-4 empty text is NOT broad', isBroadScope('').broad === false);
ok('AB-5 >2500 char body is broad', isBroadScope('x'.repeat(3000)).broad === true);

// ---- parseBoard + recommendedFrom (PB-*) ----
const BOARD = [
  '# Sauce Board', '',
  '## In Planning', '- [ ] [[Fix breadcrumb paren]]', '- [ ] [[Add render harness|harness]]', '',
  '## In Progress', '',
  '## Blocked', '- [ ] [[Wiki area redesign]]', '',
  '## Completed', '- [[Old card]] — v0.135.0', '',
].join('\n');
const cols = parseBoard(BOARD);
ok('PB-1 In Planning has 2 cards', cols['In Planning'].length === 2, JSON.stringify(cols['In Planning']));
ok('PB-2 parses plain wikilink', cols['In Planning'][0] === 'Fix breadcrumb paren');
ok('PB-3 strips alias', cols['In Planning'][1] === 'Add render harness');
ok('PB-4 In Progress empty', cols['In Progress'].length === 0);
ok('PB-5 Blocked has 1', cols['Blocked'].length === 1);
ok('PB-6 recommendedFrom finds card', recommendedFrom('## Recommended next\n- **Card:** [[Add render harness]]') === 'Add render harness');
ok('PB-7 recommendedFrom null when absent', recommendedFrom('## Board snapshot\nnothing') === null);

// ---- selectCard (SC-*) ----
const bodies = {
  'Fix breadcrumb paren': deliveryCard('Fix breadcrumb paren', 'Small render fix for a stray paren.'),
  'Add render harness': deliveryCard('Add render harness', 'Add a behavioral harness for X.'),
  'Wiki area redesign': deliveryCard('Wiki area redesign', 'Redesign the entire wiki area across all blueprints.'),
};
const loadBody = (c) => bodies[c] || '';
ok('SC-1 halt wins', selectCard({ haltExists: true, boardMd: BOARD, loadBody }).action === 'halt');
ok('SC-2 parked In Progress does NOT block a Planning pick',
  selectCard({ boardMd: BOARD.replace('## In Progress', '## In Progress\n- [ ] [[Parked workstream]]'), loadBody }).action === 'work');
ok('SC-3 empty planning -> no-work',
  selectCard({ boardMd: '## In Planning\n\n## In Progress\n', loadBody }).action === 'no-work');
const pick = selectCard({ boardMd: BOARD, loadBody });
ok('SC-4 picks first in-scope planning card', pick.action === 'work' && pick.card === 'Fix breadcrumb paren', JSON.stringify(pick));
const recPick = selectCard({ boardMd: BOARD, handoffMd: '## Recommended next [[Add render harness]]', loadBody });
ok('SC-5 recommendation-first', recPick.action === 'work' && recPick.card === 'Add render harness');
const broadBoard = '## In Planning\n- [ ] [[Wiki area redesign]]\n- [ ] [[Fix breadcrumb paren]]\n## In Progress\n';
const skipPick = selectCard({ boardMd: broadBoard, loadBody });
ok('SC-6 broad-looking board card is PICKED (attempt-anything) with a broadHint',
  skipPick.action === 'work' && skipPick.card === 'Wiki area redesign' && !!skipPick.broadHint);
const allBroad = '## In Planning\n- [ ] [[Wiki area redesign]]\n## In Progress\n';
ok('SC-7 broad-only board still returns work (no pre-filter)', selectCard({ boardMd: allBroad, loadBody }).action === 'work');

// ---- normalized status + supervised policy (NS-*) ----
ok('NS-1 canonical status aliases normalize to one vocabulary',
  ['planning', 'in-planning'].every((value) => normalizeStatus(value) === 'planning')
  && ['in_progress', 'in-progress'].every((value) => normalizeStatus(value) === 'in_progress')
  && ['blocked', 'parked', 'completed'].every((value) => normalizeStatus(value) === value));
ok('NS-2 unknown statuses stay outside the execution contract', normalizeStatus('post-ga') === null);
const OBSIDIAN_PLANNING = [
  deliveryCard('A1 status normalization and drift visibility', [
    '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
    '## A1 status normalization and drift visibility', '', 'Normalize the live status vocabulary.',
  ].join('\n'), {
    status: 'in-planning', batch_policy: 'supervised_only', profile: 'heavy',
    zones: ['scripts/autoloop/select-card.js'], frontmatter: ['status_prev: planning', 'status_changed_at: 2026-07-16'],
  }),
].join('\n');
ok('NS-3 real Obsidian planning rewrite parses as canonical planning', parseCardStatus(OBSIDIAN_PLANNING) === 'planning');
ok('NS-4 textual A1 policy remains supervised_only', parseBatchPolicy(OBSIDIAN_PLANNING) === 'supervised_only');
const supervisedBoard = '## In Planning\n- [ ] [[A1 status normalization and drift visibility]]\n## In Progress\n';
const supervisedLoad = () => OBSIDIAN_PLANNING;
ok('NS-5 unattended eligibility refuses supervised-only A1',
  selectCard({ boardMd: supervisedBoard, loadBody: supervisedLoad }).action === 'no-eligible-work');
ok('NS-6 explicit supervised eligibility accepts rewritten A1',
  selectCard({ boardMd: supervisedBoard, loadBody: supervisedLoad, supervised: true }).card === 'A1 status normalization and drift visibility');
ok('NS-7 a card projected as in-progress is not planning-eligible',
  selectCard({ boardMd: supervisedBoard, loadBody: () => OBSIDIAN_PLANNING.replace('status: in-planning', 'status: in-progress'), supervised: true }).action === 'no-eligible-work');
ok('NS-8 empty card bodies fail closed before selection',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Missing body]]\n', loadBody: () => '' }).action === 'no-eligible-work');
ok('NS-9 skeletal historical cards fail closed before selection',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Skeleton]]\n', loadBody: () => '---\nstatus: planning\n---\n' }).action === 'no-eligible-work');
ok('NS-10 authored and board card identities must match exactly',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Board identity]]\n', loadBody: () => deliveryCard('Authored identity', 'Mismatch.') }).action === 'no-eligible-work');
const requiredFieldCard = deliveryCard('Required fields', 'Required field fixture.');
ok('NS-11 current cards missing execution_mode fail closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace(/^execution_mode:.*\n/m, '') }).action === 'no-eligible-work');
ok('NS-12 current cards missing depends_on fail closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace(/^depends_on: \[\]\n/m, '') }).action === 'no-eligible-work');
const evidenceLessHistorical = deliveryCard('Historical evidence optional', 'Historical fixture.')
  .replace(/^schema_version:.*\n/m, '').replace(/^batch_policy:.*\n/m, '').replace(/^evidence:.*\n/m, '');
ok('NS-13 evidence-less historical cards remain readable through in-memory migration',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Historical evidence optional]]\n', loadBody: () => evidenceLessHistorical }).card === 'Historical evidence optional');
const sparseStaleHistorical = requiredFieldCard
  .replace(`schema_version: ${delivery.CONTRACT_VERSION}`, 'schema_version: 0.9.0')
  .replace(/^execution_mode:.*\n/m, '').replace(/^batch_policy:.*\n/m, '')
  .replace(/^depends_on:.*\n/m, '')
  .replace(/^deploy_subscriptions:\n  headspace: \[\]\n  accuris: \[\]\n  ero: \[\]\n/m, '')
  .replace(/^release_required:.*\n/m, '').replace(/^deployment_required:.*\n/m, '');
ok('NS-13b stale historical cards reach shared migration-owned field backfills',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => sparseStaleHistorical }).card === 'Required fields');
ok('NS-14 malformed scalar touch_zones fail closed instead of being coerced',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones: Docs/autoloop-fixture.md') }).action === 'no-eligible-work');
const emptyIdentityHistorical = requiredFieldCard.replace(/^schema_version:.*\n/m, '').replace(/^batch_policy:.*\n/m, '').replace(/^card:.*$/m, 'card:');
ok('NS-15 explicitly empty historical identity fails closed instead of inheriting the board name',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => emptyIdentityHistorical }).action === 'no-eligible-work');
const emptyPolicyHistorical = requiredFieldCard.replace(/^schema_version:.*\n/m, '').replace(/^batch_policy:.*$/m, 'batch_policy:');
ok('NS-16 explicitly empty historical batch policy fails closed instead of being treated as omitted',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => emptyPolicyHistorical }).action === 'no-eligible-work');
ok('NS-17 multi-token frontmatter batch policy fails closed instead of truncating',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('batch_policy: continue', 'batch_policy: continue garbage') }).action === 'no-eligible-work');
ok('NS-18 duplicate card keys fail closed as ambiguous',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('card: Required fields', 'card: Required fields\ncard: Different') }).action === 'no-eligible-work');
ok('NS-19 duplicate status keys fail closed as ambiguous',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('status: planning', 'status: planning\nstatus: blocked') }).action === 'no-eligible-work');
ok('NS-20 duplicate deployment vault keys fail closed as ambiguous',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('  headspace: []', '  headspace: []\n  headspace: []') }).action === 'no-eligible-work');
const currentPolicyOnlyInBody = requiredFieldCard.replace(/^batch_policy:.*\n/m, '') + '\nbatch_policy: continue — prose only\n';
ok('NS-21 current cards cannot source a missing batch policy from body prose',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => currentPolicyOnlyInBody }).action === 'no-eligible-work');
ok('NS-22 an empty historical Evidence section remains readable as omitted evidence',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Historical evidence optional]]\n', loadBody: () => `${evidenceLessHistorical}\n### Evidence\n\n` }).card === 'Historical evidence optional');
ok('NS-23 spaced duplicate card keys fail closed as ambiguous YAML',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('card: Required fields', 'card: Required fields\ncard : Different') }).action === 'no-eligible-work');
ok('NS-24 spaced duplicate deployment keys fail closed as ambiguous YAML',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('  headspace: []', '  headspace: []\n  headspace : []') }).action === 'no-eligible-work');
const contextPackCard = requiredFieldCard.replace('epic: "[[Selector fixtures]]"', 'context_pack: "Docs/context.md"\nepic: "[[Selector fixtures]]"');
ok('NS-25 valid optional context_pack is preserved through shared validation',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => contextPackCard }).card === 'Required fields');
ok('NS-26 explicitly empty context_pack fails closed instead of being discarded',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => contextPackCard.replace('context_pack: "Docs/context.md"', 'context_pack:') }).action === 'no-eligible-work');
ok('NS-27 malformed release_required fails closed instead of defaulting true',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('release_required: true', 'release_required: nonsense') }).action === 'no-eligible-work');
ok('NS-28 YAML-null depends_on fails closed instead of becoming an empty array',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('depends_on: []', 'depends_on:') }).action === 'no-eligible-work');
ok('NS-29 YAML-null risk_dimensions fails closed instead of becoming an empty array',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('risk_dimensions: []', 'risk_dimensions:') }).action === 'no-eligible-work');
ok('NS-30 YAML-null deployment vault fails closed instead of becoming an empty array',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('  headspace: []', '  headspace:') }).action === 'no-eligible-work');
ok('NS-31 quoted boolean remains a string and fails shared boolean validation',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('release_required: true', 'release_required: "true"') }).action === 'no-eligible-work');
ok('NS-32 unquoted null parent identity fails closed instead of becoming a string',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('parent_card: "[[Selector fixtures]]"', 'parent_card: null') }).action === 'no-eligible-work');
ok('NS-33 unquoted null context_pack fails closed instead of becoming a string',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => contextPackCard.replace('context_pack: "Docs/context.md"', 'context_pack: null') }).action === 'no-eligible-work');
ok('NS-34 unquoted null dependency fails closed instead of becoming an identity',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n## Completed\n- [x] [[null]]\n', loadBody: () => requiredFieldCard.replace('depends_on: []', 'depends_on: null') }).action === 'no-eligible-work');
ok('NS-35 flow-list null dependency retains its YAML type and fails closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n## Completed\n- [x] [[null]]\n', loadBody: () => requiredFieldCard.replace('depends_on: []', 'depends_on: [null]') }).action === 'no-eligible-work');
ok('NS-36 block-list null dependency retains its YAML type and fails closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n## Completed\n- [x] [[null]]\n', loadBody: () => requiredFieldCard.replace('depends_on: []', 'depends_on:\n  - null') }).action === 'no-eligible-work');
ok('NS-37 touch-zone tuple preserves its invalid root for shared validation',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones:\n  - root: other\n    path: package.json') }).action === 'no-eligible-work');
ok('NS-38 valid workshop touch-zone tuple remains selectable',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones:\n  - root: workshop\n    path: Docs/autoloop-fixture.md') }).card === 'Required fields');
ok('NS-39 malformed risk-dimension mapping fails closed instead of becoming an empty list',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('risk_dimensions: []', 'risk_dimensions:\n  bad: mapping') }).action === 'no-eligible-work');
ok('NS-40 malformed double-quoted scalar escape fails closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('parent_card: "[[Selector fixtures]]"', 'parent_card: "bad\\q"') }).action === 'no-eligible-work');
ok('NS-41 unmatched scalar quote fails closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('parent_card: "[[Selector fixtures]]"', 'parent_card: "bad') }).action === 'no-eligible-work');
ok('NS-42 duplicate JSON touch-zone keys fail closed before parsing overwrites them',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones: [{"root":"other","root":"workshop","path":"Docs/autoloop-fixture.md"}]') }).action === 'no-eligible-work');
ok('NS-43 duplicate evidence keys fail closed before parsing overwrites them',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace(/^evidence:.*$/m, 'evidence: [{"source_identity":"fixture","captured_at":"invalid","captured_at":"2026-07-17T06:00:00Z","revision":"v1","locator":"fixture","claim":"claim"}]') }).action === 'no-eligible-work');
ok('NS-44 repeated evidence field names in separate objects remain unambiguous',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace(/^evidence:.*$/m, 'evidence: [{"source_identity":"fixture-a","captured_at":"2026-07-17T06:00:00Z","revision":"v1","locator":"fixture-a","claim":"claim a"},{"source_identity":"fixture-b","captured_at":"2026-07-17T06:01:00Z","revision":"v2","locator":"fixture-b","claim":"claim b"}]') }).card === 'Required fields');
ok('NS-45 duplicate keys in a block touch-zone tuple fail closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones:\n  - root: other\n    root: workshop\n    path: Docs/autoloop-fixture.md') }).action === 'no-eligible-work');
ok('NS-46 explicitly empty quoted scalar dependency fails closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('depends_on: []', 'depends_on: ""') }).action === 'no-eligible-work');
ok('NS-47 nested YAML flow dependencies remain structured and fail shared identity typing',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('depends_on: []', 'depends_on: [[A], [B]]') }).action === 'no-eligible-work');
const blockEvidenceCard = requiredFieldCard.replace(/^evidence:.*$/m, [
  'evidence:', '  - source_identity: selector fixture', '    captured_at: "2026-07-17T06:00:00Z"',
  '    revision: fixture-v1', '    locator: platform/test/run-autoloop-select.js', '    claim: Block evidence fixture.',
].join('\n'));
ok('NS-48 block YAML evidence-claim mappings remain readable',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => blockEvidenceCard }).card === 'Required fields');
const inlineDeploymentCard = requiredFieldCard.replace(
  'deploy_subscriptions:\n  headspace: []\n  accuris: []\n  ero: []',
  'deploy_subscriptions: {headspace: [], accuris: [], ero: []}',
);
ok('NS-49 inline YAML deployment map remains readable',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => inlineDeploymentCard }).card === 'Required fields');
ok('NS-50 malformed indented deployment-map lines fail closed instead of disappearing',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('  ero: []', '  ero: []\n    broken mapping line') }).action === 'no-eligible-work');
ok('NS-51 unquoted YAML flow arrays remain typed deployment lists',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('  headspace: []', '  headspace: [mechanism:delivery]') }).card === 'Required fields');
const commentedContractCard = requiredFieldCard
  .replace('parent_card: "[[Selector fixtures]]"', 'parent_card: Selector fixtures # same parent authority')
  .replace('  - Docs/autoloop-fixture.md', '  - Docs/autoloop-fixture.md # same touch-zone authority');
ok('NS-52 unquoted YAML comments do not become contract identity or path data',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => commentedContractCard }).card === 'Required fields');
ok('NS-53 quoted hash characters remain literal scalar data',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('parent_card: "[[Selector fixtures]]"', 'parent_card: "Selector # literal"') }).card === 'Required fields');
ok('NS-54 apostrophes in plain YAML remain literal while trailing comments are stripped',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('parent_card: "[[Selector fixtures]]"', "parent_card: Will's project # comment") }).card === 'Required fields');
ok('NS-55 interior double quotes in plain YAML remain literal while trailing comments are stripped',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('parent_card: "[[Selector fixtures]]"', 'parent_card: Project "Alpha" # comment') }).card === 'Required fields');
const commentedStructuredCard = requiredFieldCard
  .replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones: [Docs/autoloop-fixture.md] # unchanged zones')
  .replace('depends_on: []', 'depends_on: [] # no dependencies')
  .replace('deploy_subscriptions:\n  headspace: []\n  accuris: []\n  ero: []', 'deploy_subscriptions: {headspace: [], accuris: [], ero: []} # unchanged map')
  .replace(/^evidence: (.*)$/m, 'evidence: $1 # pinned evidence')
  .replace('risk_dimensions: []', 'risk_dimensions: [] # no explicit risk');
ok('NS-56 trailing comments on inline structured YAML preserve contract semantics',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => commentedStructuredCard }).card === 'Required fields');
ok('NS-57 hash characters inside quoted flow values remain literal',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones: ["Docs/hash # literal.md"] # trailing comment') }).card === 'Required fields');
ok('NS-58 apostrophes inside plain flow paths remain literal while comments are stripped',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', "touch_zones: [Docs/Will's file.md] # trailing comment") }).card === 'Required fields');
ok('NS-59 apostrophes inside flow wikilinks remain literal while comments are stripped',
  selectCard({ boardMd: "## In Planning\n- [ ] [[Required fields]]\n## Completed\n- [x] [[Will's project]]\n", loadBody: () => requiredFieldCard.replace('depends_on: []', "depends_on: [[Will's project]] # trailing comment") }).card === 'Required fields');
ok('NS-60 interior double quotes inside plain flow paths remain literal',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones: [Docs/Project "Alpha".md] # trailing comment') }).card === 'Required fields');
ok('NS-61 doubled apostrophes preserve commas inside single-quoted flow values',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('touch_zones:\n  - Docs/autoloop-fixture.md', "touch_zones: ['Docs/Will''s, file.md'] # trailing comment") }).card === 'Required fields');
ok('NS-62 deployment subscription whitespace canonicalizes without blocking selection',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('  headspace: []', '  headspace: [" mechanism:delivery "]') }).card === 'Required fields');
ok('NS-63 whitespace-equivalent duplicate subscriptions still fail closed',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => requiredFieldCard.replace('  headspace: []', '  headspace: ["mechanism:delivery", " mechanism:delivery "]') }).action === 'no-eligible-work');
const commentedBlockCard = blockEvidenceCard
  .replace('touch_zones:\n  - Docs/autoloop-fixture.md', 'touch_zones:\n  # canonical zone\n  - Docs/autoloop-fixture.md')
  .replace('depends_on: []', 'depends_on:\n  # intentionally empty\n  []')
  .replace('evidence:\n', 'evidence:\n  # pinned evidence\n')
  .replace('risk_dimensions: []', 'risk_dimensions:\n  # no explicit risk\n  []');
ok('NS-64 comment-only lines inside block contract fields preserve semantics',
  selectCard({ boardMd: '## In Planning\n- [ ] [[Required fields]]\n', loadBody: () => commentedBlockCard }).card === 'Required fields');

// ---- parsePlanningChecked + checked-skip (PC-*, SC-8) ----
ok('PC-1 finds an [x]-checked Planning card',
  parsePlanningChecked('## In Planning\n- [x] [[Done card]]\n- [ ] [[Active]]\n## In Progress\n').has('Done card'));
ok('PC-2 unchecked card not in the set',
  parsePlanningChecked('## In Planning\n- [ ] [[Active]]\n').has('Active') === false);
ok('PC-3 checked card in In Progress is NOT Planning-checked',
  parsePlanningChecked('## In Planning\n\n## In Progress\n- [x] [[Elsewhere]]\n').has('Elsewhere') === false);
const checkedBoard = '## In Planning\n- [x] [[Done card]]\n- [ ] [[Fix breadcrumb paren]]\n## In Progress\n';
ok('SC-8 skips [x]-checked Planning card, picks next',
  selectCard({ boardMd: checkedBoard, loadBody }).card === 'Fix breadcrumb paren');
const allChecked = '## In Planning\n- [x] [[Done one]]\n- [x] [[Done two]]\n## In Progress\n';
ok('SC-9 all-checked Planning → no-eligible-work',
  selectCard({ boardMd: allChecked, loadBody }).action === 'no-eligible-work');

// ---- depends_on dependency gate (DEP-*) ----
ok('DEP-1 parseDependsOn reads every YAML shape (inline/flow/block/alias/bare)',
  JSON.stringify(parseDependsOn('---\ndepends_on: "[[Slice 2]]"\n---')) === '["Slice 2"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: [[A]]\n---')) === '["A"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: Slice 2\n---')) === '["Slice 2"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: ["[[A]]", "[[B]]"]\n---')) === '["A","B"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on:\n  - "[[A]]"\n  - B\n---')) === '["A","B"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: "[[Slice 2|alias]]"\n---')) === '["Slice 2"]'
  && JSON.stringify(parseDependsOn('---\ntype: card\n---')) === '[]');
// A depends-chain board: A done, B depends A, C depends B.
const depBodies = {
  A: deliveryCard('A', 'do A'),
  B: deliveryCard('B', 'do B', { deps: ['A'] }),
  C: deliveryCard('C', 'do C', { deps: ['B'] }),
};
const depLoad = (c) => depBodies[c] || '';
const depBoard = '## In Planning\n- [ ] [[B]]\n- [ ] [[C]]\n## Completed\n- [x] [[A]]\n';
const depPick = selectCard({ boardMd: depBoard, loadBody: depLoad });
ok('DEP-2 card whose dep is Completed is eligible; the next (unmet) is skipped',
  depPick.action === 'work' && depPick.card === 'B'
  && (depPick.skipped || []).every((s) => s.card !== 'B'), JSON.stringify(depPick));
const cOnly = selectCard({ boardMd: '## In Planning\n- [ ] [[C]]\n## Completed\n- [x] [[A]]\n', loadBody: depLoad });
ok('DEP-3 card blocked by an unmet dependency → no-eligible-work (never runs early)',
  cOnly.action === 'no-eligible-work' && /depends_on not complete: B/.test((cOnly.skipped || []).map((s) => s.reason).join('|')),
  JSON.stringify(cOnly));
// Only a DIRECT dep in Completed satisfies — B being eligible does NOT satisfy C.
const bAndC = '## In Planning\n- [ ] [[B]]\n- [ ] [[C]]\n## Completed\n- [x] [[A]]\n';
const bc = selectCard({ boardMd: bAndC, loadBody: depLoad });
ok('DEP-4 satisfaction is Completed-gated, not recursive (picks B, not C)', bc.card === 'B');
// The whole chain sits in Planning; only the head (A, no deps) is picked.
const chainBoard = '## In Planning\n- [ ] [[A]]\n- [ ] [[B]]\n- [ ] [[C]]\n## Completed\n';
ok('DEP-5 full chain in Planning → picks the dependency-free head first',
  selectCard({ boardMd: chainBoard, loadBody: depLoad }).card === 'A');
// The dependency gate applies to the handoff-recommended card too.
const recBlocked = selectCard({
  boardMd: '## In Planning\n- [ ] [[B]]\n## Completed\n',
  handoffMd: '## Recommended next\n[[B]]',
  loadBody: depLoad,
});
ok('DEP-6 an unmet dep blocks even the recommended card',
  recBlocked.action === 'no-eligible-work' && /depends_on not complete: A/.test((recBlocked.skipped || []).map((s) => s.reason).join('|')),
  JSON.stringify(recBlocked));

// ---- stripCardChrome (SCH-*) — scope heuristic must measure task body, not chrome ----
const CHROME = '---\nkey: value\nstatus: in-planning\n---\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n```\n\n---\n\nFix the separator between Open Tasks and Meetings.';
ok('SCH-1 strips frontmatter', !stripCardChrome(CHROME).includes('status: in-planning'));
ok('SCH-2 strips dataviewjs fenced block', !stripCardChrome(CHROME).includes('customjs-guard'));
ok('SCH-3 keeps the task prose', stripCardChrome(CHROME).includes('Fix the separator'));
const chromeBoard = '## In Planning\n- [ ] [[Chrome card]]\n## In Progress\n';
const chromeLoad = (c) => c === 'Chrome card' ? deliveryCard('Chrome card', '```dataviewjs\ncode\n```\nFix a small styling bug.', { frontmatter: [`x: ${'y'.repeat(1300)}`] }) : '';
ok('SCH-4 chrome-inflated card → broadHint null after strip (still picked)',
  (r => r.action === 'work' && r.broadHint === null)(selectCard({ boardMd: chromeBoard, loadBody: chromeLoad })));

// ---- splitDiff (SD-*) ----
const sd = splitDiff(['scripts/autoloop/select-card.js', 'platform/test/run-foo.js', 'Docs/x.md', 'autoloop-queue.md']);
ok('SD-1 test file classified', sd.testFiles.length === 1 && sd.testFiles[0] === 'platform/test/run-foo.js');
ok('SD-2 source file classified', sd.sourceFiles.length === 1 && sd.sourceFiles[0] === 'scripts/autoloop/select-card.js');
ok('SD-3 docs + queue excluded from source', !sd.sourceFiles.some(f => /\.md$/.test(f) || f === 'autoloop-queue.md'));
// A test-only harness addition wires itself into package.json (release:preflight)
// to run in CI; that manifest edit is NOT behavioral source, so the mutation check
// must treat the change as test-only (empty sourceFiles) rather than spuriously
// blocking. package.json + package-lock.json are excluded like docs + the queue.
const sdPkg = splitDiff(['platform/test/run-products-render-guards.js', 'package.json', 'package-lock.json', 'autoloop-queue.md']);
ok('SD-4 package.json + lockfile excluded from source (test-runner wiring is not behavioral)', sdPkg.sourceFiles.length === 0);
ok('SD-5 pure harness addition classified test-only', sdPkg.testFiles.length === 1 && sdPkg.testFiles[0] === 'platform/test/run-products-render-guards.js');
// platform/test/coverage-matrix.json is GENERATED by regen-coverage-matrix.js (a
// deterministic re-score of the tree), not hand-authored behavioral source — so a
// stale-snapshot refresh must be excluded from behavioral source like docs / the
// queue / package.json, else the matrix-regen PR spuriously fails the mutation check.
const sdCov = splitDiff(['platform/test/coverage-matrix.json', 'autoloop-queue.md']);
ok('SD-6 generated coverage-matrix.json excluded from source (matrix-only refresh is non-behavioral)', sdCov.sourceFiles.length === 0);
const sdCovMixed = splitDiff(['scripts/autoloop/gate.js', 'platform/test/run-autoloop-select.js', 'platform/test/coverage-matrix.json']);
ok('SD-7 matrix rides alongside real source without inflating the behavioral set', sdCovMixed.sourceFiles.length === 1 && sdCovMixed.sourceFiles[0] === 'scripts/autoloop/gate.js' && sdCovMixed.testFiles.length === 1);
// platform/test/preflight-manifest.json replaced package.json's release:preflight
// && chain as the registration surface a new harness wires itself into to run in
// CI. It is the same class of test-runner wiring as package.json above, not
// behavioral source — a harness-only card must classify as test-only (empty
// sourceFiles) or it spuriously blocks at Gate B.
const sdManifest = splitDiff(['platform/test/run-foo.js', 'platform/test/preflight-manifest.json']);
ok('SD-8 harness + its preflight-manifest step classify test-only', sdManifest.sourceFiles.length === 0
  && sdManifest.testFiles.length === 1 && sdManifest.testFiles[0] === 'platform/test/run-foo.js');
// ---- splitDiff gate config (SD-CFG-*): repo-agnostic bindings classify by
// their own globs; absent config keeps the sauce rules byte-identical.
const pyConfig = { test_globs: ['tests/**'], exclude_globs: ['docs/**', '*.md'] };
const sdPy = splitDiff(['src/ero_loop/ratify.py', 'tests/loop/test_ratify.py', 'docs/adr/0001.md', 'README.md'], pyConfig);
ok('SD-CFG-1 configured test glob classifies python tests', sdPy.testFiles.length === 1 && sdPy.testFiles[0] === 'tests/loop/test_ratify.py');
ok('SD-CFG-2 configured source classification keeps python source behavioral', sdPy.sourceFiles.length === 1 && sdPy.sourceFiles[0] === 'src/ero_loop/ratify.py');
ok('SD-CFG-3 configured exclude globs drop docs', !sdPy.sourceFiles.some((f) => f.includes('docs/') || f.endsWith('.md')));
const sdDefaultAgain = splitDiff(['scripts/autoloop/select-card.js', 'platform/test/run-foo.js', 'Docs/x.md', 'autoloop-queue.md'], null);
ok('SD-CFG-4 null config is byte-identical to legacy rules', JSON.stringify(sdDefaultAgain) === JSON.stringify(sd));
ok('SD-CFG-5 matchesGlob shapes', matchesGlob('tests/a/b.py', 'tests/**') && matchesGlob('x/y.md', '*.md') === true && !matchesGlob('src/a.py', 'tests/**'));
let cfgErr = null;
try { parseGateConfig('{not json'); } catch (e) { cfgErr = e.message; }
ok('SD-CFG-6 malformed gate config fails loud', /not valid JSON/.test(cfgErr || ''));
let cfgErr2 = null;
try { parseGateConfig(JSON.stringify({ test_command: 'pytest -q' })); } catch (e) { cfgErr2 = e.message; }
ok('SD-CFG-7 test_command without {test} fails loud', /\{test\} placeholder/.test(cfgErr2 || ''));
// ---- adequacyVerdict (AV-*) ----
ok('AV-1 no test → inadequate', adequacyVerdict({ hasTest: false }).adequate === false);
ok('AV-2 passes without source → inadequate', adequacyVerdict({ hasTest: true, redWithoutSource: false, greenWithSource: true }).adequate === false);
ok('AV-3 fails with source → inadequate', adequacyVerdict({ hasTest: true, redWithoutSource: true, greenWithSource: false }).adequate === false);
ok('AV-4 red-without + green-with → adequate', adequacyVerdict({ hasTest: true, redWithoutSource: true, greenWithSource: true }).adequate === true);
// ---- gateVerdict (GV-*) ----
const adq = { adequate: true, reason: 'ok' };
ok('GV-1 inadequate → block regardless of votes', gateVerdict({ adequacy: { adequate: false, reason: 'x' }, votes: [{ refuted: false }, { refuted: false }, { refuted: false }] }).gate === 'block');
ok('GV-2 adequate + 0 refutes → pass', gateVerdict({ adequacy: adq, votes: [{ refuted: false }, { refuted: false }, { refuted: false }] }).gate === 'pass');
ok('GV-3 adequate + 1 refute → pass', gateVerdict({ adequacy: adq, votes: [{ refuted: true }, { refuted: false }, { refuted: false }] }).gate === 'pass');
ok('GV-4 adequate + 2 refutes → block', gateVerdict({ adequacy: adq, votes: [{ refuted: true }, { refuted: true }, { refuted: false }] }).gate === 'block');
ok('GV-5 null verdict counts as refuted', gateVerdict({ adequacy: adq, votes: [null, { refuted: true }, { refuted: false }] }).gate === 'block');
ok('GV-6 empty panel → block (fail-closed)', gateVerdict({ adequacy: adq, votes: [] }).gate === 'block');
ok('GV-7 short panel (<3 verdicts) → block', gateVerdict({ adequacy: adq, votes: [{ refuted: false }, { refuted: false }] }).gate === 'block');
// ---- runAdequacyCheck (RA-*) ----
const order = [];
ok('RA-1 doc/test-only → behavioral:false adequate',
  runAdequacyCheck({ paths: ['Docs/x.md', 'platform/test/run-foo.js'], runTest: () => true, mutate: () => {} }).behavioral === false);
ok('RA-2 source but no test → inadequate',
  runAdequacyCheck({ paths: ['scripts/a.js'], runTest: () => true, mutate: () => {} }).adequate === false);
ok('RA-3 red-without + green-with → adequate',
  runAdequacyCheck({ paths: ['scripts/a.js', 'platform/test/run-foo.js'],
    mutate: (action) => order.push(action),
    runTest: () => order[order.length - 1] === 'restore' }).adequate === true);
ok('RA-4 restores on runTest throw (fail-closed)',
  (() => { const seen = []; const r = runAdequacyCheck({ paths: ['scripts/a.js', 'platform/test/run-foo.js'],
    mutate: (a) => seen.push(a), runTest: () => { throw new Error('boom'); } });
    return r.adequate === false && seen.filter(x => x === 'restore').length >= 1; })());
// A removal slice DELETES the old test alongside the source. A deleted test file
// is not a runnable regression guard, so `exists` drops it: a removal that ships
// no surviving guard is inadequate (RA-5), while one that keeps a live guard test
// is exercised normally (RA-6). Without `exists`, the deleted test would be run
// and always fail, poisoning the mutation check closed (the old deletion bug).
ok('RA-5 removal whose only test is deleted → no surviving guard → inadequate',
  (() => { const r = runAdequacyCheck({ paths: ['src/mod.py', 'tests/test_mod.py'],
    exists: () => false, runTest: () => true, mutate: () => {},
    config: { test_globs: ['tests/**'], exclude_globs: ['docs/**', '*.md'] } });
    return r.adequate === false && r.reason === 'behavioral change ships no regression test'; })());
ok('RA-6 removal with a surviving guard test → mutation check runs → adequate',
  (() => { const order = []; const r = runAdequacyCheck({
    paths: ['src/mod.py', 'tests/test_mod_removed.py', 'tests/test_mod.py'],
    exists: (f) => f !== 'tests/test_mod.py',
    mutate: (a) => order.push(a),
    runTest: (t) => t === 'tests/test_mod_removed.py' ? order[order.length - 1] === 'restore' : true,
    config: { test_globs: ['tests/**'], exclude_globs: ['docs/**', '*.md'] } });
    return r.adequate === true; })());

// ---- turn-lock (TL-*) ----
const TL_NOW = 1000000000000;
const TL_MIN = 60 * 1000;
ok('TL-1 empty lock → not present, not held',
  (s => s.present === false && s.held === false)(lockState('', TL_NOW, 30 * TL_MIN)));
ok('TL-2 fresh lock → held',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN).held === true);
ok('TL-3 stale lock → not held + stale',
  (s => s.held === false && s.stale === true)(lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 31 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN)));
ok('TL-4 garbage lock → stale (overridable)', lockState('not json', TL_NOW, 30 * TL_MIN).stale === true);
ok('TL-5 future-skewed lock (negative age) → not held + stale',
  (s => s.held === false && s.stale === true)(lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW + 10 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN)));
// pid-liveness override (crashed turn that never released must not wedge later turns for staleMs):
ok('TL-6 recent lock but holder pid KNOWN-dead → overridable',
  (s => s.held === false && s.stale === true && s.reason === 'holder-pid-dead')(
    lockState(JSON.stringify({ pid: 50003, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, false)));
ok('TL-7 recent lock + holder alive → still held (never stomp a live turn)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, true).held === true);
ok('TL-8 recent lock + liveness unknown (null) → falls back to time (held)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, null).held === true);
ok('TL-9 time-stale lock overridable even if holder pid alive (time wins)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 31 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, true).held === false);
ok('TL-10 backward-compat: 3-arg call unchanged (fresh lock held)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN).held === true);
ok('TL-11 pidAlive: own pid alive; bad pids → unknown (null)',
  pidAlive(process.pid) === true && pidAlive(0) === null && pidAlive(-5) === null && pidAlive('x') === null);
// Pin the helper's core branches so ESRCH→false can't silently mutate to →null (which would re-wedge crashes):
const TL_DEAD_PID = require('child_process').spawnSync(process.execPath, ['-e', '0']).pid; // spawned, exited, reaped → gone
ok('TL-12 pidAlive: a reaped (exited) pid reads as KNOWN-dead (false)', pidAlive(TL_DEAD_PID) === false);
ok('TL-13 pidAlive: pid 1 exists (EPERM/other-owner or signalable) → alive (true)', pidAlive(1) === true);

// ---- deploy (DP-*) ----
ok('DP-1 cmpVersion orders patch/minor/major + tolerates v-prefix',
  cmpVersion('0.145.1', '0.145.0') === 1 && cmpVersion('0.145.0', '0.146.0') === -1 && cmpVersion('v0.145.1', '0.145.1') === 0);
ok('DP-2 all vaults behind shipped → deploy all three at once',
  (p => p.action === 'deploy' && p.target === '0.146.0' && p.vaults.length === 3
    && p.vaults.includes('ero-sauce') && p.vaults.includes('accuris-sauce') && p.vaults.includes('headspace-sauce'))(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.145.1' }, { name: 'accuris-sauce', version: '0.145.1' }, { name: 'headspace-sauce', version: '0.145.1' }] })));
ok('DP-3 only the behind vaults are deployed (mixed current/behind)',
  (p => p.action === 'deploy' && p.target === '0.146.0' && p.vaults.length === 2
    && p.vaults.includes('accuris-sauce') && p.vaults.includes('headspace-sauce') && !p.vaults.includes('ero-sauce'))(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.146.0' }, { name: 'accuris-sauce', version: '0.145.1' }, { name: 'headspace-sauce', version: '0.145.1' }] })));
ok('DP-4 all current → no action',
  deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.146.0' }, { name: 'accuris-sauce', version: '0.146.0' }, { name: 'headspace-sauce', version: '0.146.0' }] }).action === 'none');
ok('DP-5 a single behind vault is deployed alone',
  (p => p.action === 'deploy' && p.vaults.length === 1 && p.vaults[0] === 'headspace-sauce')(
    deployPlan({ shippedVersion: '0.147.0', vaults: [{ name: 'ero-sauce', version: '0.147.0' }, { name: 'accuris-sauce', version: '0.147.0' }, { name: 'headspace-sauce', version: '0.146.0' }] })));
ok('DP-6 a vault with no installed version reads as behind and is included',
  (p => p.action === 'deploy' && p.vaults.length === 1 && p.vaults[0] === 'accuris-sauce')(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.146.0' }, { name: 'accuris-sauce', version: '' }, { name: 'headspace-sauce', version: '0.146.0' }] })));
ok('DP-7 fresh (all empty) → deploy all three to the shipped target',
  (p => p.action === 'deploy' && p.target === '0.146.0' && p.vaults.length === 3)(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '' }, { name: 'accuris-sauce', version: '' }, { name: 'headspace-sauce', version: '' }] })));
ok('DP-8 no shipped version → no action (fail-safe)',
  deployPlan({ shippedVersion: '', vaults: [{ name: 'ero-sauce', version: '0.145.1' }] }).action === 'none');
ok('DP-9 verifyDeploy ok only when installed matches target',
  verifyDeploy({ target: '0.146.0', installed: '0.146.0' }).ok === true && verifyDeploy({ target: '0.146.0', installed: '0.145.1' }).ok === false && verifyDeploy({ target: '0.146.0', installed: '' }).ok === false);
ok('DP-10 cmpVersion is numeric not lexical (0.9.0 < 0.10.0); unequal length compares + treats trailing zero as equal',
  cmpVersion('0.9.0', '0.10.0') === -1 && cmpVersion('0.145', '0.145.1') === -1 && cmpVersion('0.146.1', '0.146') === 1 && cmpVersion('0.146.0', '0.146') === 0);

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
