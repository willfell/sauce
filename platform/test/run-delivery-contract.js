#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
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
  'normalizeEvidenceClaim', 'validateEpic', 'validateSlice', 'deriveEpicLifecycle',
  'deriveEpicState', 'deriveEpicPosture', 'validateRatificationReceipt', 'parseRatificationArtifact',
].every((name) => typeof api[name] === 'function'));
eq('DEL-API-2 public contract version matches the registry', api.CONTRACT_VERSION, api.registry.contract.version);
check('DEL-API-3 registry is deeply frozen', Object.isFrozen(api.registry)
  && Object.isFrozen(api.registry.types)
  && Object.isFrozen(api.registry.fixtures)
  && Object.isFrozen(api.registry.types['execution-card'])
  && Object.isFrozen(api.registry.types['execution-card'].fields)
  && Object.isFrozen(api.registry.types['execution-card'].fields[0])
  && Object.isFrozen(api.registry.types.epic)
  && Object.isFrozen(api.registry.types.slice)
  && Object.isFrozen(api.registry.types['ratification-receipt'])
  && Object.isFrozen(api.registry.fixtures.base_execution_card)
  && Object.isFrozen(api.registry.fixtures.base_execution_card.deploy_subscriptions.headspace));
eq('DEL-API-4 base fixture pins Delivery deployment for all authoritative vaults',
  api.registry.fixtures.base_execution_card.deploy_subscriptions,
  { headspace: ['mechanism:delivery'], accuris: ['mechanism:delivery'], ero: ['mechanism:delivery'] });

for (const fixture of api.registry.fixtures.valid) {
  const verdict = api.validateCard(fixtureCard(fixture), fixture.mode || 'current');
  check(`DEL-FIX-VALID ${fixture.name}`, verdict.ok, JSON.stringify(verdict.errors));
  if (Object.prototype.hasOwnProperty.call(fixture, 'expected_requires_migration')) {
    eq(`DEL-FIX-MIGRATION ${fixture.name}`, verdict.requires_migration, fixture.expected_requires_migration);
  }
  if (Object.prototype.hasOwnProperty.call(fixture, 'expected_historical_unversioned')) {
    eq(`DEL-FIX-HISTORICAL ${fixture.name}`, verdict.historical_unversioned, fixture.expected_historical_unversioned);
  }
  if (fixture.expected_warning) {
    check(`DEL-FIX-WARNING ${fixture.name}`,
      verdict.warnings.some((warning) => warning.code === fixture.expected_warning), JSON.stringify(verdict.warnings));
  }
}
for (const fixture of api.registry.fixtures.invalid) {
  const verdict = api.validateCard(fixtureCard(fixture), fixture.mode || 'current');
  const codes = verdict.errors.map((error) => error.code);
  check(`DEL-FIX-INVALID ${fixture.name}`, !verdict.ok && codes.includes(fixture.expected_error), codes.join(','));
}

function recordFixture(group, fixture) {
  const record = JSON.parse(JSON.stringify(group.base));
  Object.assign(record, fixture.patch || {});
  for (const key of fixture.remove || []) delete record[key];
  return record;
}

for (const fixture of api.registry.fixtures.epic.valid) {
  const verdict = api.validateEpic(recordFixture(api.registry.fixtures.epic, fixture));
  check(`DEL-EPIC-VALID ${fixture.name}`, verdict.ok, JSON.stringify(verdict.errors));
}
for (const fixture of api.registry.fixtures.epic.invalid) {
  const verdict = api.validateEpic(recordFixture(api.registry.fixtures.epic, fixture));
  check(`DEL-EPIC-INVALID ${fixture.name}`, !verdict.ok
    && verdict.errors.some((issue) => issue.code === fixture.expected_error), JSON.stringify(verdict.errors));
}
check('DEL-EPIC-STATE-ENUM atlas status uses the derived epic-state vocabulary',
  api.registry.types.epic.fields.find((field) => field.name === 'status').enum === 'epic_state'
    && api.validateEpic({ ...api.registry.fixtures.epic.base, status: 'planning' }).errors
      .some((issue) => issue.code === 'invalid-enum'));
for (const fixture of api.registry.fixtures.slice.valid) {
  const verdict = api.validateSlice(recordFixture(api.registry.fixtures.slice, fixture), {
    sibling_slices: ['Contract registry'],
  });
  check(`DEL-SLICE-VALID ${fixture.name}`, verdict.ok, JSON.stringify(verdict.errors));
  if (fixture.expected_warning) check(`DEL-SLICE-WARNING ${fixture.name}`,
    verdict.warnings.some((issue) => issue.code === fixture.expected_warning), JSON.stringify(verdict.warnings));
}
for (const fixture of api.registry.fixtures.slice.invalid) {
  const verdict = api.validateSlice(recordFixture(api.registry.fixtures.slice, fixture));
  check(`DEL-SLICE-INVALID ${fixture.name}`, !verdict.ok
    && verdict.errors.some((issue) => issue.code === fixture.expected_error), JSON.stringify(verdict.errors));
}
eq('DEL-SLICE-RECORD preserves the epic backlink in normalized output',
  api.validateSlice(api.registry.fixtures.slice.base).record.epic,
  api.registry.fixtures.slice.base.epic);
for (const fixture of api.registry.fixtures.ratification_receipt.valid) {
  const verdict = api.validateRatificationReceipt(recordFixture(api.registry.fixtures.ratification_receipt, fixture));
  check(`DEL-RATIFICATION-VALID ${fixture.name}`, verdict.ok, JSON.stringify(verdict.errors));
}
for (const fixture of api.registry.fixtures.ratification_receipt.invalid) {
  const verdict = api.validateRatificationReceipt(recordFixture(api.registry.fixtures.ratification_receipt, fixture));
  check(`DEL-RATIFICATION-INVALID ${fixture.name}`, !verdict.ok
    && verdict.errors.some((issue) => issue.code === fixture.expected_error), JSON.stringify(verdict.errors));
}

const lifecycleCases = [
  ['empty board is planned', [], 'planned', 'claimable'],
  ['single planned slice is planned', [{ card: 'A', status: 'planning' }], 'planned', 'claimable'],
  ['one implementing slice is active', [{ card: 'A', status: 'in_progress' }], 'active', 'claimable'],
  // BGR redesign 2026-07-25: parked slices count as waiting and roll up like blocked, never active.
  ['all parked slices wait as blocked', [{ card: 'A', status: 'parked' }, { card: 'B', status: 'parked' }], 'blocked', 'blocked_by_dependencies'],
  ['blocked frontier with nothing claimable is blocked', [{ card: 'A', status: 'blocked' }], 'blocked', 'blocked_by_dependencies'],
  ['a claimable planned sibling outranks a blocked slice', [{ card: 'A', status: 'blocked' }, { card: 'B', status: 'planning' }], 'planned', 'claimable'],
  ['every completed slice is done', [{ card: 'A', status: 'completed' }, { card: 'B', phase: 'deployed' }], 'done', 'done'],
  ['cross-epic dependency degrades posture', [{ card: 'A', status: 'planning', cross_epic_dependency: true }], 'planned', 'blocked_by_dependencies'],
  ['decision-required slice degrades posture first', [{ card: 'A', status: 'planning', decision_required: true }], 'planned', 'awaiting_user_decision'],
  ['all pending docs-only slices use docs posture', [{ card: 'A', status: 'planning', execution_mode: 'docs_only' }], 'planned', 'docs_only'],
];
for (const [label, slices, expectedState, expectedPosture] of lifecycleCases) {
  const lifecycle = api.deriveEpicLifecycle(slices);
  eq(`DEL-EPIC-STATE ${label}`, lifecycle.state, expectedState);
  eq(`DEL-EPIC-POSTURE ${label}`, lifecycle.posture, expectedPosture);
  eq(`DEL-EPIC-STATE-WRAPPER ${label}`, api.deriveEpicState(slices), expectedState);
  eq(`DEL-EPIC-POSTURE-WRAPPER ${label}`, api.deriveEpicPosture(slices), expectedPosture);
}

// BGR redesign 2026-07-25 — discarded slices are tombstones (excluded from the rollup
// entirely) and parked slices wait on a decision (waiting bucket, rolls up like blocked).
const discardedLifecycle = api.deriveEpicLifecycle([
  { card: 'A', status: 'completed' }, { card: 'B', status: 'discarded' }, { card: 'C', status: 'discarded' },
]);
eq('BGR-CONTRACT-DISCARDED-EXCLUDED discarded slices vanish from the rollup entirely', {
  state: discardedLifecycle.state,
  done: discardedLifecycle.counts.done,
  has_discarded_bucket: Object.prototype.hasOwnProperty.call(discardedLifecycle.counts, 'discarded'),
}, { state: 'done', done: 1, has_discarded_bucket: false });
const waitingLifecycle = api.deriveEpicLifecycle([{ status: 'parked' }, { status: 'planning' }]);
eq('BGR-CONTRACT-PARKED-IS-WAITING parked counts as waiting and rolls up like blocked', {
  waiting: waitingLifecycle.counts.waiting,
  active: waitingLifecycle.counts.active,
  state: waitingLifecycle.state,
}, { waiting: 1, active: 0, state: 'blocked' });
eq('BGR-CONTRACT-ALL-DISCARDED-IS-PLANNED an epic emptied by discards is planned, not done',
  api.deriveEpicLifecycle([{ status: 'discarded' }]).state, 'planned');
const discardedSliceVerdict = api.validateSlice({ ...api.registry.fixtures.slice.base, status: 'discarded' });
check('BGR-CONTRACT-STATUS-ENUM the contract accepts a discarded slice as valid',
  discardedSliceVerdict.ok, JSON.stringify(discardedSliceVerdict.errors));

const ratificationPayload = {
  schema_version: api.CONTRACT_VERSION,
  receipt_id: 'ratification-es1-artifact',
  decision: 'accepted',
  accepted_at: '2026-07-20T09:28:12-05:00',
  authority: 'Will',
  target_card: 'ES1 Delivery epic-slice contract and ratification receipts',
  target_head: 'd'.repeat(40),
  scope: ['resume only the exact target'],
};
const ratificationHeading = 'ES1 receipt — accepted 2026-07-20';
const ratificationMarkdown = [
  '# Final Initial Design', '',
  'A decoy outside the selected section names Different full target and eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.', '',
  `## ${ratificationHeading}`, '',
  'The prose is explanatory; the receipt block is authority.', '',
  '```delivery-ratification', JSON.stringify(ratificationPayload, null, 2), '```', '',
  '## Later section', '', 'Unrelated.', '',
].join('\n');
const parsedRatification = api.parseRatificationArtifact(ratificationMarkdown, ratificationHeading, {
  artifact_path: 'spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md',
});
check('DEL-RATIFICATION-PARSE-1 exact selected receipt parses', parsedRatification.ok, JSON.stringify(parsedRatification.errors));
eq('DEL-RATIFICATION-PARSE-2 target identity comes from the selected receipt only',
  parsedRatification.receipt.target_card, ratificationPayload.target_card);
eq('DEL-RATIFICATION-PARSE-3 target HEAD is one exact structured token',
  parsedRatification.receipt.target_head, ratificationPayload.target_head);
check('DEL-RATIFICATION-PARSE-4 parser binds whole artifact and exact section digests',
  /^[0-9a-f]{64}$/.test(parsedRatification.receipt.artifact_sha256)
    && /^[0-9a-f]{64}$/.test(parsedRatification.receipt.section_sha256)
    && parsedRatification.receipt.artifact_sha256 !== parsedRatification.receipt.section_sha256);
const decoyIdentityPayload = { ...ratificationPayload, target_card: 'ES1 Delivery epic-slice contract' };
const decoyIdentityMarkdown = ratificationMarkdown.replace(JSON.stringify(ratificationPayload, null, 2), JSON.stringify(decoyIdentityPayload, null, 2));
const decoyIdentityReceipt = api.parseRatificationArtifact(decoyIdentityMarkdown, ratificationHeading, {
  artifact_path: 'spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md',
});
eq('DEL-RATIFICATION-PARSE-5 full-file prose cannot replace selected-section target identity',
  decoyIdentityReceipt.receipt.target_card, decoyIdentityPayload.target_card);
const substringHeadPayload = { ...ratificationPayload, target_head: `prefix-${ratificationPayload.target_head}-suffix` };
const substringHeadMarkdown = ratificationMarkdown.replace(JSON.stringify(ratificationPayload, null, 2), JSON.stringify(substringHeadPayload, null, 2));
const substringHeadReceipt = api.parseRatificationArtifact(substringHeadMarkdown, ratificationHeading, {
  artifact_path: 'spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md',
});
check('DEL-RATIFICATION-PARSE-6 a containing HEAD substring is rejected', !substringHeadReceipt.ok
  && substringHeadReceipt.errors.some((issue) => issue.code === 'invalid-target-head'));
for (const [label, markdown, heading, code] of [
  ['duplicate selected heading', `${ratificationMarkdown}\n## ${ratificationHeading}\n`, ratificationHeading, 'ratification-heading-ambiguous'],
  ['missing selected heading', ratificationMarkdown, 'Missing heading', 'ratification-heading-ambiguous'],
  ['missing receipt block', ratificationMarkdown.replace('delivery-ratification', 'json'), ratificationHeading, 'ratification-block-ambiguous'],
  ['duplicate receipt block', ratificationMarkdown.replace('## Later section', `\`\`\`delivery-ratification\n${JSON.stringify(ratificationPayload)}\n\`\`\`\n\n## Later section`), ratificationHeading, 'ratification-block-ambiguous'],
]) {
  const verdict = api.parseRatificationArtifact(markdown, heading, { artifact_path: 'docs/ratification.md' });
  check(`DEL-RATIFICATION-PARSE-REFUSE ${label}`, !verdict.ok && verdict.errors.some((issue) => issue.code === code));
}
const fencedHeadingDecoy = ratificationMarkdown.replace(
  '# Final Initial Design',
  `# Final Initial Design\n\n\`\`\`text\n## ${ratificationHeading}\n\`\`\``,
);
check('DEL-RATIFICATION-PARSE-7 headings inside fenced examples are never selected authority',
  api.parseRatificationArtifact(fencedHeadingDecoy, ratificationHeading, {
    artifact_path: 'docs/ratification.md',
  }).ok);

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
eq('DEL-NORM-5 evidence claim strings normalize without losing provenance', api.normalizeEvidenceClaim({
  source_identity: ' repo ', captured_at: ' 2026-07-16T17:51:05Z ', revision: ' abc123 ',
  locator: ' path.md:12 ', claim: ' supported claim ',
}), {
  source_identity: 'repo', captured_at: '2026-07-16T17:51:05Z', revision: 'abc123',
  locator: 'path.md:12', claim: 'supported claim',
});

const base = fixtureCard({});
const docsValidationReceipt = {
  ok: true, receipt_id: 'docs-validation-1', checked_at: '2026-07-16T17:51:05Z',
  verifier_revision: 'c'.repeat(40), head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40),
};
const docsCompletionRecord = {
  execution_mode: 'docs_only', phase: 'completed', head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40),
  validation_receipt: docsValidationReceipt,
};
const fullReceipt = {
  card: 'Dependency', phase: 'deployed', execution_mode: 'release',
  feature_pr: 9, feature_merge_sha: 'a'.repeat(40), release_pr: 10, release_merge_sha: 'b'.repeat(40),
  required_version: '1.2.3', tag: 'v1.2.3', tap_pr: 11, brew_version: '1.2.3',
  brew_receipt: {
    ok: true, receipt_id: 'brew-receipt-1', checked_at: '2026-07-16T17:51:05Z',
    verifier_revision: 'c'.repeat(40), tap_pr: 11, installed_version: '1.2.3',
  },
  deploy_subscriptions: {
    headspace: ['mechanism:delivery'], accuris: ['mechanism:delivery'], ero: ['mechanism:delivery'],
  },
  release_ancestry_receipt: {
    ok: true, receipt_id: 'ancestry-receipt-1', repository: 'willfellhoelter/sauce',
    checked_at: '2026-07-16T17:51:05Z', verifier_revision: 'c'.repeat(40),
    feature_pr: 9, feature_merge_sha: 'a'.repeat(40),
    release_pr: 10, release_merge_sha: 'b'.repeat(40), tag: 'v1.2.3',
  },
  vault_receipts: {
    headspace: { vault: 'headspace', path: '/vaults/headspace', ok: true, required_version: '1.2.3', added_subscriptions: ['mechanism:delivery'], verified_subscriptions: ['mechanism:delivery'], started_at: '2026-07-16T17:51:05Z', finished_at: '2026-07-16T17:51:06Z', status_exit: 0, history_errors: [], installed_version: '1.2.3' },
    accuris: { vault: 'accuris', path: '/vaults/accuris', ok: true, required_version: '1.2.3', added_subscriptions: ['mechanism:delivery'], verified_subscriptions: ['mechanism:delivery'], started_at: '2026-07-16T17:51:05Z', finished_at: '2026-07-16T17:51:06Z', status_exit: 0, history_errors: [], installed_version: '1.2.4' },
    ero: { vault: 'ero', path: '/vaults/ero', ok: true, required_version: '1.2.3', added_subscriptions: ['mechanism:delivery'], verified_subscriptions: ['mechanism:delivery'], started_at: '2026-07-16T17:51:05Z', finished_at: '2026-07-16T17:51:06Z', status_exit: 0, history_errors: [], installed_version: '2.0.0' },
  },
};
check('DEL-COMP-1 complete release receipt proves completion', api.completionProof(fullReceipt).complete);
const incomplete = JSON.parse(JSON.stringify(fullReceipt));
delete incomplete.vault_receipts.ero;
const incompleteProof = api.completionProof(incomplete);
check('DEL-COMP-2 missing vault receipt names the missing proof', !incompleteProof.complete
  && incompleteProof.missing.includes('vault_receipts.ero'));
check('DEL-COMP-3 docs-only completion uses validation proof without release evidence',
  api.completionProof(docsCompletionRecord).complete);
check('DEL-COMP-16 docs-only completion rejects a nonterminal phase',
  !api.completionProof({ ...docsCompletionRecord, phase: 'planning' }).complete);
check('DEL-COMP-17 docs-only completion requires validation proof',
  !api.completionProof({ execution_mode: 'docs_only', phase: 'completed' }).complete);
check('DEL-COMP-18 docs-only completion rejects a failed validation receipt',
  !api.completionProof({ execution_mode: 'docs_only', phase: 'completed', validation_receipt: { ok: false } }).complete);
check('DEL-COMP-18b docs-only completion rejects an unpinned truthy validation result',
  !api.completionProof({ execution_mode: 'docs_only', phase: 'completed', validation_receipt: { ok: true } }).complete);
for (const [label, mutate] of [
  ['DEL-COMP-18c docs receipt binds head', (record) => { record.validation_receipt.head_sha = 'd'.repeat(40); }],
  ['DEL-COMP-18d docs receipt binds base', (record) => { record.validation_receipt.base_sha = 'd'.repeat(40); }],
  ['DEL-COMP-18e docs receipt pins timestamp', (record) => { record.validation_receipt.checked_at = 'yesterday'; }],
  ['DEL-COMP-18f docs receipt pins verifier', (record) => { record.validation_receipt.verifier_revision = 'short'; }],
  ['DEL-COMP-18g docs receipt requires ok true', (record) => { record.validation_receipt.ok = false; }],
  ['DEL-COMP-18h docs receipt requires identity', (record) => { record.validation_receipt.receipt_id = ''; }],
]) {
  const record = JSON.parse(JSON.stringify(docsCompletionRecord)); mutate(record);
  check(label, api.completionProof(record).missing.includes('validation_receipt'));
}
const matchingMalformedDocs = JSON.parse(JSON.stringify(docsCompletionRecord));
matchingMalformedDocs.head_sha = 'short'; matchingMalformedDocs.validation_receipt.head_sha = 'short';
check('DEL-COMP-18i matching malformed docs SHAs still fail closed',
  api.completionProof(matchingMalformedDocs).missing.includes('validation_receipt'));
for (const [label, mutate, missing] of [
  ['DEL-COMP-4 stale tag is rejected', (receipt) => { receipt.tag = 'v1.2.2'; }, 'tag'],
  ['DEL-COMP-5 malformed brew version is rejected', (receipt) => { receipt.brew_version = 'latest'; }, 'brew_version'],
  ['DEL-COMP-6 stale vault install is rejected', (receipt) => { receipt.vault_receipts.headspace.installed_version = '1.2.2'; }, 'vault_receipts.headspace'],
  ['DEL-COMP-13 non-deployed phase is rejected', (receipt) => { receipt.phase = 'release_merged'; }, 'phase'],
  ['DEL-COMP-14 stale valid brew version is rejected', (receipt) => { receipt.brew_version = '1.2.2'; }, 'brew_version'],
  ['DEL-COMP-15 failed vault receipt is rejected', (receipt) => { receipt.vault_receipts.ero.ok = false; }, 'vault_receipts.ero'],
]) {
  const receipt = JSON.parse(JSON.stringify(fullReceipt));
  mutate(receipt);
  const proof = api.completionProof(receipt);
  check(label, !proof.complete && proof.missing.includes(missing));
}
for (const [label, field, value] of [
  ['DEL-COMP-19 string feature PR is rejected', 'feature_pr', '9'],
  ['DEL-COMP-7 fake merge SHA is rejected', 'feature_merge_sha', 'x'],
  ['DEL-COMP-8 string release PR is rejected', 'release_pr', '10'],
  ['DEL-COMP-9 fake release merge SHA is rejected', 'release_merge_sha', 'y'],
  ['DEL-COMP-10 malformed required version is rejected', 'required_version', 'latest'],
  ['DEL-COMP-11 unversioned tag is rejected', 'tag', 'release'],
  ['DEL-COMP-12 string tap PR is rejected', 'tap_pr', '11'],
]) {
  const receipt = JSON.parse(JSON.stringify(fullReceipt));
  receipt[field] = value;
  const proof = api.completionProof(receipt);
  check(label, !proof.complete && proof.missing.includes(field));
}
const missingAncestry = JSON.parse(JSON.stringify(fullReceipt));
delete missingAncestry.release_ancestry_receipt;
check('DEL-COMP-20 syntactic identifiers without a deterministic ancestry receipt are incomplete',
  api.completionProof(missingAncestry).missing.includes('release_ancestry_receipt'));
const mismatchedAncestry = JSON.parse(JSON.stringify(fullReceipt));
mismatchedAncestry.release_ancestry_receipt.feature_merge_sha = 'd'.repeat(40);
check('DEL-COMP-21 ancestry receipt must bind the exact completion identifiers',
  api.completionProof(mismatchedAncestry).missing.includes('release_ancestry_receipt'));
for (const [label, mutate] of [
  ['DEL-COMP-21b ancestry binds feature PR', (r) => { r.release_ancestry_receipt.feature_pr = 99; }],
  ['DEL-COMP-21c ancestry binds release PR', (r) => { r.release_ancestry_receipt.release_pr = 99; }],
  ['DEL-COMP-21d ancestry binds release SHA', (r) => { r.release_ancestry_receipt.release_merge_sha = 'd'.repeat(40); }],
  ['DEL-COMP-21e ancestry binds tag', (r) => { r.release_ancestry_receipt.tag = 'v1.2.4'; }],
  ['DEL-COMP-21f ancestry pins repository', (r) => { r.release_ancestry_receipt.repository = ''; }],
  ['DEL-COMP-21g ancestry pins timestamp', (r) => { r.release_ancestry_receipt.checked_at = 'yesterday'; }],
  ['DEL-COMP-21h ancestry pins verifier', (r) => { r.release_ancestry_receipt.verifier_revision = 'short'; }],
  ['DEL-COMP-21j ancestry receipt requires ok true', (r) => { r.release_ancestry_receipt.ok = false; }],
  ['DEL-COMP-21k ancestry receipt requires identity', (r) => { r.release_ancestry_receipt.receipt_id = ''; }],
]) {
  const receipt = JSON.parse(JSON.stringify(fullReceipt)); mutate(receipt);
  check(label, api.completionProof(receipt).missing.includes('release_ancestry_receipt'));
}
const wrongContainingTag = JSON.parse(JSON.stringify(fullReceipt));
wrongContainingTag.tag = 'v9.0.0'; wrongContainingTag.release_ancestry_receipt.tag = 'v9.0.0';
check('DEL-COMP-21i containing tag must equal the required feature release',
  api.completionProof(wrongContainingTag).missing.includes('tag'));
const missingBrewReceipt = JSON.parse(JSON.stringify(fullReceipt));
delete missingBrewReceipt.brew_receipt;
check('DEL-COMP-22 Homebrew version requires a pinned promotion receipt',
  api.completionProof(missingBrewReceipt).missing.includes('brew_receipt'));
for (const [label, mutate] of [
  ['DEL-COMP-22b brew receipt binds tap PR', (r) => { r.brew_receipt.tap_pr = 99; }],
  ['DEL-COMP-22c brew receipt binds installed version', (r) => { r.brew_receipt.installed_version = '1.2.4'; }],
  ['DEL-COMP-22d brew receipt pins timestamp', (r) => { r.brew_receipt.checked_at = 'yesterday'; }],
  ['DEL-COMP-22e brew receipt pins verifier', (r) => { r.brew_receipt.verifier_revision = 'short'; }],
  ['DEL-COMP-22f brew receipt requires ok true', (r) => { r.brew_receipt.ok = false; }],
  ['DEL-COMP-22g brew receipt requires identity', (r) => { r.brew_receipt.receipt_id = ''; }],
]) {
  const receipt = JSON.parse(JSON.stringify(fullReceipt)); mutate(receipt);
  check(label, api.completionProof(receipt).missing.includes('brew_receipt'));
}
const malformedVaultReceipt = JSON.parse(JSON.stringify(fullReceipt));
malformedVaultReceipt.vault_receipts.ero.status_exit = 1;
check('DEL-COMP-23 vault proof requires the exact green deployment receipt shape',
  api.completionProof(malformedVaultReceipt).missing.includes('vault_receipts.ero'));
const missingDeploymentMap = JSON.parse(JSON.stringify(fullReceipt));
delete missingDeploymentMap.deploy_subscriptions;
check('DEL-COMP-23a completion requires the exact deployment contract',
  api.completionProof(missingDeploymentMap).missing.includes('deploy_subscriptions'));
const malformedDeploymentMap = JSON.parse(JSON.stringify(fullReceipt));
malformedDeploymentMap.deploy_subscriptions.ero = [42];
check('DEL-COMP-23a2 completion deployment contract enforces typed additions',
  api.completionProof(malformedDeploymentMap).missing.includes('deploy_subscriptions'));
const duplicateDeploymentMap = JSON.parse(JSON.stringify(fullReceipt));
duplicateDeploymentMap.deploy_subscriptions.ero.push('mechanism:delivery');
check('DEL-COMP-23a3 completion deployment contract rejects duplicate additions',
  api.completionProof(duplicateDeploymentMap).missing.includes('deploy_subscriptions'));
const whitespaceDuplicateDeploymentMap = JSON.parse(JSON.stringify(fullReceipt));
whitespaceDuplicateDeploymentMap.deploy_subscriptions.ero.push(' mechanism:delivery ');
check('DEL-COMP-23a4 completion deployment contract normalizes before duplicate detection',
  api.completionProof(whitespaceDuplicateDeploymentMap).missing.includes('deploy_subscriptions'));
for (const [label, mutate] of [
  ['DEL-COMP-23b vault receipt binds identity', (r) => { r.vault_receipts.ero.vault = 'other'; }],
  ['DEL-COMP-23c vault receipt pins path', (r) => { r.vault_receipts.ero.path = ''; }],
  ['DEL-COMP-23d vault receipt binds required version', (r) => { r.vault_receipts.ero.required_version = '1.2.2'; }],
  ['DEL-COMP-23e vault receipt pins start', (r) => { r.vault_receipts.ero.started_at = 'yesterday'; }],
  ['DEL-COMP-23f vault receipt pins finish', (r) => { r.vault_receipts.ero.finished_at = 'yesterday'; }],
  ['DEL-COMP-23f2 vault receipt completion cannot precede start', (r) => { r.vault_receipts.ero.finished_at = '2026-07-16T17:51:04Z'; }],
  ['DEL-COMP-23g vault receipt requires clean history', (r) => { r.vault_receipts.ero.history_errors = ['error']; }],
  ['DEL-COMP-23h vault receipt proves requested subscriptions are currently present', (r) => { r.vault_receipts.ero.verified_subscriptions = []; }],
]) {
  const receipt = JSON.parse(JSON.stringify(fullReceipt)); mutate(receipt);
  check(label, api.completionProof(receipt).missing.includes('vault_receipts.ero'));
}
const retrySubscriptionReceipt = JSON.parse(JSON.stringify(fullReceipt));
retrySubscriptionReceipt.vault_receipts.ero.added_subscriptions = [];
check('DEL-COMP-23i verified subscription snapshot stays valid on idempotent retry',
  api.completionProof(retrySubscriptionReceipt).complete);
const malformedAddedSubscriptions = JSON.parse(JSON.stringify(fullReceipt));
malformedAddedSubscriptions.vault_receipts.ero.added_subscriptions.push(42);
check('DEL-COMP-23j newly-added subscription evidence enforces array:string',
  api.completionProof(malformedAddedSubscriptions).missing.includes('vault_receipts.ero'));
const malformedVerifiedSubscriptions = JSON.parse(JSON.stringify(fullReceipt));
malformedVerifiedSubscriptions.vault_receipts.ero.verified_subscriptions.push(42);
check('DEL-COMP-23k current subscription evidence enforces array:string',
  api.completionProof(malformedVerifiedSubscriptions).missing.includes('vault_receipts.ero'));

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
const archivedProjectionWithReceipt = api.resolveDependencies([
  { ...base, card: 'Receipt authority child', depends_on: ['Dependency'] },
], { Dependency: fullReceipt }, { archive: ['Dependency'] });
check('DEL-DEP-10 authoritative deployed receipt outranks an Archive projection',
  archivedProjectionWithReceipt['Receipt authority child'].eligible);
const incompleteDespiteCompleted = api.resolveDependencies([
  { ...base, card: 'Incomplete despite projection', depends_on: ['Dependency'] },
], { Dependency: incompleteDependency }, { completed: ['Dependency'] });
check('DEL-DEP-11 incomplete authoritative receipt cannot be bypassed by checked Completed',
  incompleteDespiteCompleted['Incomplete despite projection'].reason === 'dependency-proof-missing');
const trackedCompletedWithoutReceipt = api.resolveDependencies([
  { ...base, card: 'Tracked projection child', depends_on: ['Tracked dependency'] },
], {}, { completed: ['Tracked dependency'], known_cards: ['Tracked dependency'] });
check('DEL-DEP-12 checked Completed cannot satisfy a tracked dependency without a receipt',
  trackedCompletedWithoutReceipt['Tracked projection child'].reason === 'dependency-not-complete');

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
check('DEL-ZONE-7 dot path segments normalize before conflict comparison', api.zoneConflicts(
  { touch_zones: ['platform/./mechanisms/delivery'] }, { touch_zones: ['platform/mechanisms/delivery/index.js'] }));

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
eq('DEL-POSTURE-5 a declared dependency without a proof result is blocked', api.posture({ card: base }), 'blocked_by_dependencies');

const unattended = api.batchEligibility(base, { supervised: false, dependency_result: { eligible: true } });
check('DEL-BATCH-1 supervised_only is machine-enforced for unattended selection',
  !unattended.eligible && unattended.reason === 'supervised-only');
check('DEL-BATCH-2 explicit supervision admits a valid supervised_only card',
  api.batchEligibility(base, { supervised: true, dependency_result: { eligible: true } }).eligible);
check('DEL-BATCH-2b supervision cannot bypass a missing dependency result',
  api.batchEligibility(base, { supervised: true }).reason === 'dependencies-not-complete');
const stopAfter = {
  ...base, touch_zones: ['Docs/release-note.md'], risk_dimensions: [], batch_policy: 'stop_after',
};
const stopVerdict = api.batchEligibility(stopAfter, { supervised: false, dependency_result: { eligible: true } });
check('DEL-BATCH-3 stop_after permits this card but forbids continuation',
  stopVerdict.eligible && stopVerdict.continue_after === false);
const docsCard = fixtureCard(api.registry.fixtures.valid.find((fixture) => fixture.name === 'docs-only-standard'));
check('DEL-BATCH-4 docs_only remains supervised even with a weaker authored continuation policy',
  api.batchEligibility(docsCard, { supervised: false }).reason === 'docs-only-requires-supervision');
check('DEL-BATCH-5 invalid cards fail closed before policy evaluation',
  api.batchEligibility({ ...base, model_profile: 'ultra' }, {
    supervised: true, dependency_result: { eligible: true },
  }).reason === 'contract-invalid');
const dependencyFree = { ...stopAfter, depends_on: [], batch_policy: 'continue' };
check('DEL-BATCH-6 an explicit dependency refusal is honored even for a dependency-free card',
  api.batchEligibility(dependencyFree, {
    supervised: true, dependency_result: { eligible: false, missing_proof: ['external-refusal'] },
  }).reason === 'dependencies-not-complete');
const olderContractCard = fixtureCard(api.registry.fixtures.valid.find(
  (fixture) => fixture.name === 'older-contract-requires-migration'));
check('DEL-BATCH-7 older readable contracts cannot execute before migration',
  api.batchEligibility(olderContractCard, {
    supervised: true, dependency_result: { eligible: true },
  }).reason === 'contract-migration-required');
const unversionedContractCard = fixtureCard(api.registry.fixtures.valid.find(
  (fixture) => fixture.name === 'historical-unversioned'));
check('DEL-BATCH-8 unversioned historical contracts cannot execute before migration',
  api.batchEligibility(unversionedContractCard, {
    mode: 'historical', supervised: true, dependency_result: { eligible: true },
  }).reason === 'contract-migration-required');

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
const malformedMigration = api.migrate(base, 'v1');
check('DEL-MIGRATE-3b malformed source versions refuse without mutation', !malformedMigration.ok
  && malformedMigration.reason === 'invalid-schema-version'
  && JSON.stringify(malformedMigration.note) === JSON.stringify(base));
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
const legacyEvidence = fixtureCard(api.registry.fixtures.valid.find(
  (fixture) => fixture.name === 'historical-unpinned-evidence-is-readable-with-warning'));
const evidenceMigration = api.migrate(legacyEvidence);
check('DEL-MIGRATE-5 unpinned historical evidence is preserved and flagged for manual pinning',
  evidenceMigration.ok
  && evidenceMigration.note.evidence[0] === 'legacy/path.md:12'
  && evidenceMigration.manual.includes('evidence.0:requires-pinning'));
const repeatedEvidenceMigration = api.migrate(evidenceMigration.note, evidenceMigration.note.schema_version);
check('DEL-MIGRATE-6 manual evidence work remains visible on idempotent repeat migration',
  repeatedEvidenceMigration.ok
  && repeatedEvidenceMigration.manual.includes('evidence.0:requires-pinning')
  && JSON.stringify(repeatedEvidenceMigration.note) === JSON.stringify(evidenceMigration.note));
const missingEvidenceHistorical = fixtureCard({});
delete missingEvidenceHistorical.schema_version;
delete missingEvidenceHistorical.evidence;
const missingEvidenceMigration = api.migrate(missingEvidenceHistorical);
check('DEL-MIGRATE-7 missing historical evidence is not invented and requires authoring',
  missingEvidenceMigration.ok
  && !Object.prototype.hasOwnProperty.call(missingEvidenceMigration.note, 'evidence')
  && missingEvidenceMigration.manual.includes('evidence:requires-authoring'));

const planner = api.describe('execution-card', 'planner');
const coordinator = api.describe('execution-card', 'coordinator');
check('DEL-DESCRIBE-1 planner gets authoring descriptions', planner.fields.every((field) => field.description));
check('DEL-DESCRIBE-2 consumer descriptions are seat-specific',
  planner.fields.find((field) => field.name === 'touch_zones').description
    !== coordinator.fields.find((field) => field.name === 'touch_zones').description);
check('DEL-DESCRIBE-3 registry describes the deterministic ancestry receipt',
  api.describe('release-ancestry-receipt', 'coordinator').fields.some((field) => field.name === 'verifier_revision'));
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
for (const [label, args] of [
  ['DEL-CLI-3 missing arguments return machine-readable usage', []],
  ['DEL-CLI-4 unsupported commands return machine-readable usage', ['validate', 'execution-card', '--json']],
]) {
  const usageCli = spawnSync(process.execPath, [
    path.join(DELIVERY, 'scripts', 'delivery-schema-cli.js'), ...args,
  ], { encoding: 'utf8' });
  let usageBody = null;
  try { usageBody = JSON.parse(usageCli.stdout); } catch (_) { /* asserted below */ }
  check(label, usageCli.status === 2 && usageBody && usageBody.ok === false
    && /^usage: delivery-schema-cli\.js describe/.test(usageBody.error));
}

const manifest = JSON.parse(fs.readFileSync(path.join(DELIVERY, 'manifest.json'), 'utf8'));
const installed = new Map((manifest.files || []).map((file) => [file.source, file.dest]));
check('DEL-MAN-1 mechanism declares no module_directory', !Object.prototype.hasOwnProperty.call(manifest, 'module_directory'));
check('DEL-MAN-2 registry is installed in a non-loader content tree',
  installed.get('data/delivery-schema.json') === '{{content_path}}/delivery/data/delivery-schema.json'
  && [...installed.values()].every((dest) => !dest.startsWith('{{scripts_path}}/')
    && !dest.startsWith('{{templater_scripts_path}}/')));
check('DEL-MAN-3 public API and semantic scripts are installed together', [
  'index.js', 'scripts/delivery-contract.js', 'scripts/delivery-schema-cli.js',
].every((source) => installed.has(source)));
eq('DEL-MAN-3a every installed source has its exact non-loader destination', Object.fromEntries(installed), {
  'data/delivery-schema.json': '{{content_path}}/delivery/data/delivery-schema.json',
  'scripts/delivery-contract.js': '{{content_path}}/delivery/scripts/delivery-contract.js',
  'scripts/delivery-schema-cli.js': '{{content_path}}/delivery/scripts/delivery-schema-cli.js',
  'index.js': '{{content_path}}/delivery/index.js',
});
const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-contract-install-'));
let installedLoadOk = false;
let installedCliOk = false;
try {
  for (const file of manifest.files) {
    const relative = file.dest.replace(/^\{\{content_path\}\}\//, '');
    const destination = path.join(installRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(DELIVERY, file.source), destination);
  }
  const installedApi = require(path.join(installRoot, 'delivery', 'index.js'));
  installedLoadOk = installedApi.CONTRACT_VERSION === api.CONTRACT_VERSION
    && installedApi.describe('execution-card', 'coordinator').fields.length === coordinator.fields.length;
  const installedCli = spawnSync(process.execPath, [
    path.join(installRoot, 'delivery', 'scripts', 'delivery-schema-cli.js'),
    'describe', 'execution-card', '--json',
  ], { encoding: 'utf8' });
  installedCliOk = installedCli.status === 0
    && JSON.parse(installedCli.stdout).contract_version === api.CONTRACT_VERSION;
} finally {
  fs.rmSync(installRoot, { recursive: true, force: true });
}
check('DEL-MAN-3b copied install layout loads the public API through relative dependencies', installedLoadOk);
check('DEL-MAN-3c copied install layout runs the public CLI through relative dependencies', installedCliOk);
const platformManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'manifest.json'), 'utf8'));
const deliveryCatalogue = platformManifest.mechanisms.filter((mechanism) => mechanism.name === 'delivery');
check('DEL-MAN-4 platform catalogue registers Delivery exactly once at its manifest version',
  deliveryCatalogue.length === 1
  && deliveryCatalogue[0].version === manifest.version
  && deliveryCatalogue[0].path === 'mechanisms/delivery');
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
