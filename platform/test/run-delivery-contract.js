#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DELIVERY = path.join(ROOT, 'platform', 'mechanisms', 'delivery');
const api = require(path.join(DELIVERY, 'index.js'));

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok  ${label}`); }
  else { failed += 1; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function eq(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function fixtureCard(fixture) {
  const card = JSON.parse(JSON.stringify(api.registry.fixtures.base_execution_card));
  Object.assign(card, fixture.patch || {});
  for (const key of fixture.remove || []) delete card[key];
  return card;
}

console.log('\nDelivery contract harness');

check('DEL-API-1 public API exposes the semantic surface', [
  'validateCard', 'resolveDependencies', 'completionProof', 'zoneConflicts',
  'derivePolicy', 'classifyFailure', 'posture', 'migrate', 'describe',
  'batchEligibility', 'normalizeCard', 'normalizeStatus', 'parseDependencyField', 'compareVersions',
].every((name) => typeof api[name] === 'function'));
eq('DEL-API-2 public contract version matches the registry', api.CONTRACT_VERSION, api.registry.contract.version);
check('DEL-API-3 registry is deeply frozen', Object.isFrozen(api.registry)
  && Object.isFrozen(api.registry.types)
  && Object.isFrozen(api.registry.fixtures));

for (const fixture of api.registry.fixtures.valid) {
  const verdict = api.validateCard(fixtureCard(fixture), fixture.mode || 'current');
  check(`DEL-FIX-VALID ${fixture.name}`, verdict.ok, JSON.stringify(verdict.errors));
}
for (const fixture of api.registry.fixtures.invalid) {
  const verdict = api.validateCard(fixtureCard(fixture), fixture.mode || 'current');
  const codes = verdict.errors.map((error) => error.code);
  check(`DEL-FIX-INVALID ${fixture.name}`, !verdict.ok && codes.includes(fixture.expected_error), codes.join(','));
}

for (const fixture of api.registry.fixtures.dependency_syntax) {
  eq(`DEL-DEP-SYNTAX ${fixture.name}`, api.parseDependencyField(fixture.input), fixture.expected);
}
eq('DEL-NORM-1 wikilink aliases and whitespace normalize',
  api.normalizeIdentity('  "[[Parent Card|Parent]]"  '), 'Parent Card');
eq('DEL-NORM-2 historical status alias normalizes', api.normalizeStatus(' in-planning '), 'planning');
eq('DEL-NORM-3 unknown status fails closed', api.normalizeStatus('almost-done'), null);
const normalizedFixture = api.validateCard(fixtureCard(
  api.registry.fixtures.valid.find((fixture) => fixture.name === 'whitespace-and-unicode-normalization')));
eq('DEL-NORM-4 card validation returns normalized identities and zones', {
  card: normalizedFixture.card.card,
  parent_card: normalizedFixture.card.parent_card,
  touch_zones: normalizedFixture.card.touch_zones,
  depends_on: normalizedFixture.card.depends_on,
}, {
  card: 'Delivery 🚚',
  parent_card: 'Tranche A — trustworthy substrate',
  touch_zones: ['platform/mechanisms/delivery'],
  depends_on: ['A1 status normalization and drift visibility'],
});

const base = fixtureCard({});
const fullReceipt = {
  card: 'Dependency', phase: 'deployed', execution_mode: 'release',
  feature_merge_sha: 'a'.repeat(40), release_pr: 10, release_merge_sha: 'b'.repeat(40),
  required_version: '1.2.3', tag: 'v1.2.3', tap_pr: 11, brew_version: '1.2.3',
  vault_receipts: {
    headspace: { ok: true, installed_version: '1.2.3' },
    accuris: { ok: true, installed_version: '1.2.4' },
    ero: { ok: true, installed_version: '2.0.0' },
  },
};
check('DEL-COMP-1 complete release receipt proves completion', api.completionProof(fullReceipt).complete);
const incomplete = JSON.parse(JSON.stringify(fullReceipt));
delete incomplete.vault_receipts.ero;
const incompleteProof = api.completionProof(incomplete);
check('DEL-COMP-2 missing vault receipt names the missing proof', !incompleteProof.complete
  && incompleteProof.missing.includes('vault_receipts.ero'));
check('DEL-COMP-3 docs-only completion uses validation proof without release evidence',
  api.completionProof({ execution_mode: 'docs_only', phase: 'completed', validation_receipt: { ok: true } }).complete);
for (const [label, mutate, missing] of [
  ['DEL-COMP-4 stale tag is rejected', (receipt) => { receipt.tag = 'v1.2.2'; }, 'tag'],
  ['DEL-COMP-5 malformed brew version is rejected', (receipt) => { receipt.brew_version = 'latest'; }, 'brew_version'],
  ['DEL-COMP-6 stale vault install is rejected', (receipt) => { receipt.vault_receipts.headspace.installed_version = '1.2.2'; }, 'vault_receipts.headspace'],
]) {
  const receipt = JSON.parse(JSON.stringify(fullReceipt));
  mutate(receipt);
  const proof = api.completionProof(receipt);
  check(label, !proof.complete && proof.missing.includes(missing));
}

const depCards = [
  { ...base, card: 'Tracked child', depends_on: ['Dependency'] },
  { ...base, card: 'Historical child', depends_on: ['Historical complete'] },
  { ...base, card: 'Archive child', depends_on: ['Archived only'] },
  { ...base, card: 'Missing child', depends_on: ['Missing target'] },
  { ...base, card: 'Self child', depends_on: ['Self child'] },
  { ...base, card: 'Cycle A', depends_on: ['Cycle B'] },
  { ...base, card: 'Cycle B', depends_on: ['Cycle A'] },
];
const depResult = api.resolveDependencies(depCards, { Dependency: fullReceipt }, {
  completed: ['Historical complete'], archive: ['Archived only'], known_cards: ['Archived only'],
});
check('DEL-DEP-1 tracked dependency requires and accepts authoritative release proof', depResult['Tracked child'].eligible);
check('DEL-DEP-2 checked Completed satisfies an untracked historical dependency', depResult['Historical child'].eligible);
check('DEL-DEP-3 Archive never satisfies a dependency', depResult['Archive child'].reason === 'archive-never-satisfies');
check('DEL-DEP-4 dangling dependency is named', depResult['Missing child'].reason === 'dangling-dependency');
check('DEL-DEP-5 self dependency is refused', depResult['Self child'].reason === 'self-dependency');
check('DEL-DEP-6 dependency cycles are refused', depResult['Cycle A'].reason === 'dependency-cycle'
  && depResult['Cycle B'].reason === 'dependency-cycle');
const ambiguous = api.resolveDependencies([{ ...base, card: 'Ambiguous child', depends_on: ['Twin'] }], {}, {
  known_cards: ['Twin'], duplicate_cards: ['Twin'],
});
check('DEL-DEP-7 ambiguous duplicate basenames fail closed', ambiguous['Ambiguous child'].reason === 'ambiguous-dependency');
const parked = api.resolveDependencies([{ ...base, card: 'No deps', depends_on: [] }], {}, { parked: ['Sibling'] });
check('DEL-DEP-8 parked siblings do not block dependency eligibility', parked['No deps'].eligible);
const incompleteDependency = JSON.parse(JSON.stringify(fullReceipt));
incompleteDependency.vault_receipts.ero.installed_version = '1.2.2';
const incompleteTracked = api.resolveDependencies([
  { ...base, card: 'Incomplete tracked child', depends_on: ['Dependency'] },
], { Dependency: incompleteDependency });
check('DEL-DEP-9 incomplete tracked proof fails closed with exact missing evidence',
  incompleteTracked['Incomplete tracked child'].reason === 'dependency-proof-missing'
  && incompleteTracked['Incomplete tracked child'].missing_proof.includes('vault_receipts.ero'));

check('DEL-ZONE-1 nested paths conflict', api.zoneConflicts(
  { touch_zones: ['scripts/autoloop'] }, { touch_zones: ['scripts/autoloop/gate.js'] }));
check('DEL-ZONE-2 spaces in paths remain comparable', api.zoneConflicts(
  { touch_zones: ['spice/projects/Space Name'] }, { touch_zones: ['spice/projects/Space Name/card.md'] }));
check('DEL-ZONE-3 identical paths under different roots do not conflict', !api.zoneConflicts(
  { touch_zones: [{ root: 'workshop-a', path: 'package.json' }] },
  { touch_zones: [{ root: 'workshop-b', path: 'package.json' }] }));
check('DEL-ZONE-4 exclusive zones conflict on exact identity', api.zoneConflicts(
  { touch_zones: ['package.json'] }, { touch_zones: ['package.json'] }));
check('DEL-ZONE-5 disjoint paths do not conflict', !api.zoneConflicts(
  { touch_zones: ['platform/mechanisms/delivery'] }, { touch_zones: ['Docs/Index.md'] }));
check('DEL-ZONE-6 nesting under an exclusive zone still conflicts', api.zoneConflicts(
  { touch_zones: ['.github/workflows'] }, { touch_zones: ['.github/workflows/ci.yml'] }));

eq('DEL-POLICY-1 control-plane work is supervised-only',
  api.derivePolicy({ batch_policy: 'continue', touch_zones: ['platform/mechanisms/delivery'] }), 'supervised_only');
eq('DEL-POLICY-2 authored policy can strengthen continue to stop_after',
  api.derivePolicy({ batch_policy: 'stop_after', touch_zones: ['Docs/Index.md'] }), 'stop_after');
eq('DEL-POLICY-3 supervised_only is never weakened',
  api.derivePolicy({ batch_policy: 'supervised_only', touch_zones: [] }), 'supervised_only');

eq('DEL-FAIL-1 infrastructure signature classification', api.classifyFailure('ECONNRESET from github.com'), 'infra');
eq('DEL-FAIL-2 code signature classification', api.classifyFailure('AssertionError: expected true'), 'code');
eq('DEL-FAIL-3 mixed signature classification', api.classifyFailure('ETIMEDOUT then SyntaxError'), 'mixed');
eq('DEL-FAIL-4 unknown signature classification', api.classifyFailure('something novel happened'), 'unknown');
const classifications = new Set(['infra', 'code', 'mixed', 'unknown']);
let fuzzSafe = true;
for (let i = 0; i < 250; i += 1) {
  const input = `${String.fromCharCode(32 + (i % 90))}\u0000${i % 7 === 0 ? 'timeout' : ''}${i % 11 === 0 ? 'assert' : ''}`;
  try { fuzzSafe = fuzzSafe && classifications.has(api.classifyFailure(input)); } catch (_) { fuzzSafe = false; }
}
check('DEL-FAIL-5 mangled failure logs always classify without throwing', fuzzSafe);

eq('DEL-POSTURE-1 user decision blocks first', api.posture({ decision_required: true }), 'awaiting_user_decision');
eq('DEL-POSTURE-2 dependency proof blocks claim', api.posture({ dependency_result: { eligible: false } }), 'blocked_by_dependencies');
eq('DEL-POSTURE-3 docs-only stays outside release claims', api.posture({ card: { execution_mode: 'docs_only' } }), 'docs_only');
eq('DEL-POSTURE-4 otherwise claimable', api.posture({ card: base, dependency_result: { eligible: true } }), 'claimable');

const unattended = api.batchEligibility(base, { supervised: false });
check('DEL-BATCH-1 supervised_only is machine-enforced for unattended selection',
  !unattended.eligible && unattended.reason === 'supervised-only');
check('DEL-BATCH-2 explicit supervision admits a valid supervised_only card',
  api.batchEligibility(base, { supervised: true }).eligible);
const stopAfter = {
  ...base, touch_zones: ['Docs/release-note.md'], risk_dimensions: [], batch_policy: 'stop_after',
};
const stopVerdict = api.batchEligibility(stopAfter, { supervised: false });
check('DEL-BATCH-3 stop_after permits this card but forbids continuation',
  stopVerdict.eligible && stopVerdict.continue_after === false);
const docsCard = fixtureCard(api.registry.fixtures.valid.find((fixture) => fixture.name === 'docs-only-standard'));
check('DEL-BATCH-4 docs_only remains supervised even with a weaker authored continuation policy',
  api.batchEligibility(docsCard, { supervised: false }).reason === 'docs-only-requires-supervision');

const historical = fixtureCard(api.registry.fixtures.valid.find((fixture) => fixture.name === 'historical-unversioned'));
const migrated = api.migrate(historical, historical.schema_version);
check('DEL-MIGRATE-1 historical card migrates to current contract', migrated.ok
  && migrated.note.schema_version === api.CONTRACT_VERSION
  && migrated.applied.length > 0);
const remigrated = api.migrate(migrated.note, migrated.note.schema_version);
check('DEL-MIGRATE-2 migration is idempotent', remigrated.ok && remigrated.applied.length === 0
  && JSON.stringify(remigrated.note) === JSON.stringify(migrated.note));
const future = api.migrate({ ...base, schema_version: '9.0.0' }, '9.0.0');
check('DEL-MIGRATE-3 newer-than-engine refuses without mutation', !future.ok
  && future.reason === 'newer-than-engine');
const sparseHistorical = fixtureCard({});
for (const field of ['schema_version', 'execution_mode', 'depends_on', 'deploy_subscriptions',
  'release_required', 'deployment_required', 'batch_policy']) delete sparseHistorical[field];
sparseHistorical.touch_zones = ['platform/mechanisms/delivery'];
const backfilled = api.migrate(sparseHistorical);
check('DEL-MIGRATE-4 migration backfills release defaults and derives supervised_only', backfilled.ok
  && backfilled.note.schema_version === api.CONTRACT_VERSION
  && backfilled.note.execution_mode === 'release'
  && backfilled.note.release_required === true
  && backfilled.note.deployment_required === true
  && JSON.stringify(backfilled.note.depends_on) === '[]'
  && JSON.stringify(backfilled.note.deploy_subscriptions) === JSON.stringify({ headspace: [], accuris: [], ero: [] })
  && backfilled.note.batch_policy === 'supervised_only');

const planner = api.describe('execution-card', 'planner');
const coordinator = api.describe('execution-card', 'coordinator');
check('DEL-DESCRIBE-1 planner gets authoring descriptions', planner.fields.every((field) => field.description));
check('DEL-DESCRIBE-2 consumer descriptions are seat-specific',
  planner.fields.find((field) => field.name === 'touch_zones').description
    !== coordinator.fields.find((field) => field.name === 'touch_zones').description);
const cli = JSON.parse(execFileSync(process.execPath, [
  path.join(DELIVERY, 'scripts', 'delivery-schema-cli.js'),
  'describe', 'execution-card', '--consumer', 'coordinator', '--json',
], { encoding: 'utf8' }));
check('DEL-CLI-1 describe CLI returns the public contract version and fields', cli.ok
  && cli.contract_version === api.CONTRACT_VERSION && cli.fields.length === coordinator.fields.length);
const badCli = spawnSync(process.execPath, [
  path.join(DELIVERY, 'scripts', 'delivery-schema-cli.js'), 'describe', 'unknown-type', '--json',
], { encoding: 'utf8' });
const badCliBody = JSON.parse(badCli.stdout);
check('DEL-CLI-2 unknown contract types fail with machine-readable output', badCli.status === 2
  && badCliBody.ok === false && /unknown Delivery contract type/.test(badCliBody.error));

const manifest = JSON.parse(fs.readFileSync(path.join(DELIVERY, 'manifest.json'), 'utf8'));
const installed = new Map((manifest.files || []).map((file) => [file.source, file.dest]));
check('DEL-MAN-1 mechanism declares no module_directory', !Object.prototype.hasOwnProperty.call(manifest, 'module_directory'));
check('DEL-MAN-2 registry is installed under ranch scripts',
  installed.get('data/delivery-schema.json') === '{{scripts_path}}/delivery/data/delivery-schema.json');
check('DEL-MAN-3 public API and semantic scripts are installed together', [
  'index.js', 'scripts/delivery-contract.js', 'scripts/delivery-schema-cli.js',
].every((source) => installed.has(source)));
const platformManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifest.json'), 'utf8'));
const deliveryCatalogue = platformManifest.mechanisms.filter((mechanism) => mechanism.name === 'delivery');
check('DEL-MAN-4 platform catalogue registers Delivery exactly once at its manifest version',
  deliveryCatalogue.length === 1
  && deliveryCatalogue[0].version === manifest.version
  && deliveryCatalogue[0].path === 'mechanisms/delivery');
eq('DEL-MAN-5 platform catalogue contains 33 mechanisms including Delivery', platformManifest.mechanisms.length, 33);
const schemasIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'schemas-index.json'), 'utf8'));
const deliverySchemas = schemasIndex.schemas.filter((schema) => schema.id === 'delivery-execution-card-contract');
check('DEL-SCHEMA-1 schema catalogue registers the Delivery registry and semantic validator exactly once',
  deliverySchemas.length === 1
  && deliverySchemas[0].owner.type === 'mechanism'
  && deliverySchemas[0].owner.name === 'delivery'
  && deliverySchemas[0].source === 'platform/mechanisms/delivery/data/delivery-schema.json'
  && deliverySchemas[0].validator === 'platform/mechanisms/delivery/scripts/delivery-contract.js'
  && deliverySchemas[0].accepted_versions.includes(api.CONTRACT_VERSION));

console.log(`\nDelivery contract: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
