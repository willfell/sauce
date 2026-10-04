#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
// Alternate module is used only by this bounded harness's disposable mutant.
const contractPath = process.env.SCOPED_REVIEW_CONTRACT || path.resolve(__dirname, '../../scripts/autoloop/review-contract.js');
const { VERSION, LENSES, canonicalReviewDigest: digest, validateReviewBundle: bundleCheck, validateAuthorization: authCheck } = require(contractPath);
const copy = (v) => JSON.parse(JSON.stringify(v));
const sha = (n) => n.toString(16).padStart(40, '0');
const hex = (n) => n.toString(16).padStart(64, '0');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
function rejected(result, code) {
  assert.equal(result.ok, false, `expected rejection ${code}`);
  assert.ok(result.errors.some((e) => e.code === code), JSON.stringify(result.errors));
}
function fixture() {
  const snapshot = {
    schema_version: VERSION, snapshot_id: 's0', repository_id: 'fixture-repo', card_id: 'SR-fixture',
    head_sha: sha(1), tree_sha: sha(2), base_sha: sha(3), merge_base_sha: sha(3), diff_digest: hex(1),
    messages: [{ sha: sha(1), message: 'feat: isolated fixture' }], contract_digest: hex(2), policy_digest: hex(3),
    implementer_context_id: 'implementer', required_claims: Object.fromEntries(LENSES.map((lens) => [lens, [`claim-${lens}`]])),
  };
  const bundle = { schema_version: VERSION, snapshots: [snapshot], claims: [], evidence: [], findings: [], bridges: [], judgments: [] };
  LENSES.forEach((lens) => {
    bundle.evidence.push({ evidence_id: `e-${lens}`, snapshot_id: 's0', source_identity: 'disposable fixture source', locator: `${lens}:1`, digest: hex(4) });
    bundle.claims.push({ claim_id: `claim-${lens}`, statement: `All ${lens} requirements covered`, dependencies: [{ kind: 'source', identity: 'fixture.js', digest: hex(5) }], evidence_ids: [`e-${lens}`] });
    bundle.judgments.push({ schema_version: VERSION, receipt_id: `r-${lens}`, kind: 'direct', snapshot_id: 's0', lens, verdict: 'pass', reviewer_context_id: `reviewer-${lens}`, implementer_context_id: 'implementer', scope: 'full', claim_ids: [`claim-${lens}`], finding_ids: [], evidence_ids: [`e-${lens}`] });
  });
  return bundle;
}
function authorization(bundle) {
  const s = bundle.snapshots.at(-1);
  return { schema_version: VERSION, authorization_id: 'authorization-1', snapshot: copy(s), bundle_digest: digest(bundle), lenses: Object.fromEntries(LENSES.map((lens) => [lens, bundle.judgments.filter((j) => j.snapshot_id === s.snapshot_id && j.lens === lens).map((j) => j.receipt_id)])) };
}
function inheritedFixture() {
  const b = fixture();
  const s = copy(b.snapshots[0]);
  Object.assign(s, { snapshot_id: 's1', head_sha: sha(6), tree_sha: sha(7), diff_digest: hex(6), messages: [...s.messages, { sha: sha(6), message: 'fix: fixture prose repair' }] });
  b.snapshots.push(s);
  b.evidence.push({ evidence_id: 'e-impact', snapshot_id: 's1', source_identity: 'independent repair assessment', locator: 'fixture:bridge', digest: hex(8) });
  b.bridges.push({ schema_version: VERSION, bridge_id: 'b01', from_snapshot_id: 's0', to_snapshot_id: 's1', assessed: true, assessor_context_id: 'impact-context', retained_claim_ids: b.claims.map((c) => c.claim_id), evidence_ids: ['e-impact'] });
  b.judgments.slice().forEach((j) => b.judgments.push({ ...copy(j), kind: 'inherited', receipt_id: `i-${j.lens}`, snapshot_id: 's1', source_receipt_id: j.receipt_id, bridge_id: 'b01', origin_receipt_id: j.receipt_id, origin_head_sha: sha(1), origin_base_sha: sha(3) }));
  return b;
}

test('SR1-interfaces-and-direct-authorization', () => {
  const b = fixture(); assert.deepEqual(bundleCheck(b), { ok: true, errors: [] });
  assert.deepEqual(authCheck(authorization(b), b, b.snapshots[0]), { ok: true, errors: [] });
});
test('SR1-canonical-order-array-identity-and-no-mutation', () => {
  assert.match(digest({ b: 2, a: [1, 2] }), /^[0-9a-f]{64}$/);
  assert.equal(digest({ b: 2, a: [1, 2] }), digest({ a: [1, 2], b: 2 }));
  assert.notEqual(digest([1, 2]), digest([2, 1]));
  const b = fixture(), before = JSON.stringify(b); bundleCheck(b); authCheck(authorization(b), b, b.snapshots[0]); assert.equal(JSON.stringify(b), before);
});
test('SR1-reject-legacy-map-and-unknown-version', () => {
  rejected(bundleCheck({ correctness: { verdict: 'pass' } }), 'version_unsupported');
  const b = fixture(); b.schema_version = '2.0.0'; rejected(bundleCheck(b), 'version_unsupported');
  const a = authorization(fixture()); a.schema_version = '0'; rejected(authCheck(a, fixture(), fixture().snapshots[0]), 'version_unsupported');
});
test('SR1-non-JSON-and-getters-never-executed', () => {
  const cyclic = {}; cyclic.self = cyclic;
  const sparse = new Array(1), extra = [1]; extra.more = true;
  const symbolic = {}; symbolic[Symbol('x')] = 1;
  const hidden = {}; Object.defineProperty(hidden, 'x', { value: 1 });
  const proxy = new Proxy({}, { ownKeys() { throw new Error('proxy executed'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const getter = {}; Object.defineProperty(getter, 'x', { enumerable: true, get() { throw new Error('getter executed'); } });
  for (const v of [undefined, NaN, Infinity, -0, 1n, () => true, new Date(0), cyclic, sparse, extra, symbolic, hidden, getter, proxy, revoked.proxy, { x: undefined }]) {
    assert.throws(() => digest(v), TypeError);
    const b = fixture(); b.extra = v; rejected(bundleCheck(b), 'non_json');
  }
  let deep = {}; for (let i = 0; i < 150; i++) deep = { deep }; assert.throws(() => digest(deep), TypeError);
});
// Each factory models a distinct caller-controlled array surface; none may be
// read through ordinary property access before the JSON purity check rejects it.
function callerArrays(called) {
  class SpoofedArray extends Array {
    map() { called(); return []; }
    forEach() { called(); }
  }
  const subclass = new SpoofedArray(1, 2);
  const custom = [1, 2];
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, 'forEach', { get() { called(); return () => called(); } });
  Object.setPrototypeOf(custom, prototype);
  const swapped = [1, 2]; Object.setPrototypeOf(swapped, null);
  const ownMethod = [1, 2]; ownMethod.map = () => { called(); return []; };
  const ownGetter = [1];
  Object.defineProperty(ownGetter, '0', { enumerable: true, get() { called(); return 1; } });
  return [subclass, custom, swapped, ownMethod, ownGetter];
}
test('SR1b-array-purity-validator-never-dispatches-caller-code', () => {
  let calls = 0;
  for (const malicious of callerArrays(() => calls++)) {
    const b = fixture(); b.snapshots = malicious;
    rejected(bundleCheck(b), 'non_json');
    const clean = fixture(), a = authorization(clean); a.lenses.correctness = malicious;
    rejected(authCheck(a, clean, clean.snapshots[0]), 'non_json');
    const snapshot = copy(clean.snapshots[0]); snapshot.messages = malicious;
    rejected(authCheck(authorization(clean), clean, snapshot), 'non_json');
  }
  assert.equal(calls, 0, 'validators must not invoke caller methods or getters');
});
test('SR1b-array-purity-digest-rejects-collisions-without-caller-code', () => {
  let calls = 0;
  for (const malicious of callerArrays(() => calls++)) {
    assert.throws(() => digest(malicious), TypeError);
    assert.throws(() => digest({ nested: malicious }), TypeError);
  }
  class Collision extends Array { map() { calls++; return []; } }
  assert.throws(() => digest(new Collision(1, 2)), TypeError);
  assert.throws(() => digest(new Collision(3, 4)), TypeError);
  assert.equal(calls, 0, 'digest must not invoke caller methods or getters');
});
test('SR1b-mutable-array-prototype-rejected-without-dispatch', () => {
  for (const key of ['map', 'forEach', 'every', 'some', 'includes', 'filter', 'find', 'findIndex', Symbol.iterator]) {
    const b = fixture(), a = authorization(b), snapshot = copy(b.snapshots[0]);
    const original = Object.getOwnPropertyDescriptor(Array.prototype, key);
    let calls = 0, bundleResult, authorizationResult, digestError, emptyResult, emptyDigestError;
    try {
      Object.defineProperty(Array.prototype, key, { configurable: true, get() { calls++; return () => { calls++; return []; }; } });
      bundleResult = bundleCheck(b);
      emptyResult = bundleCheck({});
      authorizationResult = authCheck(a, b, snapshot);
      try { digest([1, 2]); } catch (error) { digestError = error; }
      try { digest({}); } catch (error) { emptyDigestError = error; }
    } finally { Object.defineProperty(Array.prototype, key, original); }
    rejected(bundleResult, 'non_json'); rejected(authorizationResult, 'non_json');
    rejected(emptyResult, 'non_json'); assert.ok(emptyDigestError instanceof TypeError);
    assert.ok(digestError instanceof TypeError, String(key));
    assert.equal(calls, 0, `modified ${String(key)} must never execute`);
    assert.equal(bundleCheck(b).ok, true, 'restoring prototype restores valid JSON');
  }
});
test('SR1-all-snapshot-bindings-required', () => {
  for (const key of ['repository_id', 'card_id', 'head_sha', 'tree_sha', 'base_sha', 'merge_base_sha', 'diff_digest', 'messages', 'contract_digest', 'policy_digest', 'implementer_context_id', 'required_claims']) {
    const b = fixture(); delete b.snapshots[0][key]; assert.equal(bundleCheck(b).ok, false, key);
  }
});
test('SR1-authorization-binds-entire-snapshot-and-bundle', () => {
  for (const key of ['snapshot_id', 'repository_id', 'card_id', 'head_sha', 'tree_sha', 'base_sha', 'merge_base_sha', 'diff_digest', 'contract_digest', 'policy_digest', 'implementer_context_id']) {
    const b = fixture(), a = authorization(b), s = copy(b.snapshots[0]); s[key] = 'changed'; rejected(authCheck(a, b, s), 'snapshot_mismatch');
  }
  const b = fixture(), a = authorization(b); a.snapshot.messages[0].message = 'docs: no release'; rejected(authCheck(a, b, b.snapshots[0]), 'snapshot_mismatch');
  const a2 = authorization(b); b.claims[0].statement += ' altered'; rejected(authCheck(a2, b, b.snapshots[0]), 'bundle_mismatch');
  const old = fixture().snapshots[0], inherited = inheritedFixture(); rejected(authCheck(authorization(inherited), inherited, old), 'snapshot_mismatch');
});
test('SR1-hash-fields-reject-coercion-values', () => {
  const cases = [
    ...['tree_sha', 'head_sha', 'base_sha', 'merge_base_sha'].map((key) => [b => b.snapshots[0], key, sha(9), 'sha_invalid']),
    ...['diff_digest', 'contract_digest', 'policy_digest'].map((key) => [b => b.snapshots[0], key, hex(9), 'digest_invalid']),
    [b => b.snapshots[0].messages[0], 'sha', sha(1), 'messages_incomplete'],
    [b => b.evidence[0], 'digest', hex(9), 'digest_invalid'],
    [b => b.claims[0].dependencies[0], 'digest', hex(9), 'dependencies_missing'],
  ];
  for (const [target, key, valid, code] of cases) {
    for (const value of [[valid], [[valid]], {}, null, false, 9]) {
      const b = fixture(); target(b)[key] = value; rejected(bundleCheck(b), code);
    }
  }
  for (const key of ['origin_head_sha', 'origin_base_sha']) {
    const b = inheritedFixture(); b.judgments[3][key] = [b.judgments[3][key]];
    rejected(bundleCheck(b), 'sha_invalid');
  }
  const b = fixture(), a = authorization(b); a.bundle_digest = [a.bundle_digest]; rejected(authCheck(a, b, b.snapshots[0]), 'digest_invalid');
});
test('SR1-direct-judgment-must-cite-covered-claim-evidence', () => {
  const b = fixture();
  b.evidence.push({ ...copy(b.evidence[0]), evidence_id: 'unrelated-evidence', locator: 'unrelated:1' });
  b.judgments[0].evidence_ids = ['unrelated-evidence'];
  rejected(bundleCheck(b), 'claim_evidence_missing');
  rejected(authCheck(authorization(b), b, b.snapshots[0]), 'claim_evidence_missing');
});
test('SR1-inherited-judgment-cannot-omit-covered-claim-evidence', () => {
  const b = inheritedFixture();
  b.evidence.push({ ...copy(b.evidence[0]), evidence_id: 'additional-evidence', locator: 'additional:1' });
  b.judgments[0].evidence_ids.push('additional-evidence');
  b.judgments[3].evidence_ids = ['additional-evidence'];
  rejected(bundleCheck(b), 'claim_evidence_missing');
  rejected(authCheck(authorization(b), b, b.snapshots[1]), 'claim_evidence_missing');
});
test('SR1-self-review-refused', () => {
  const b = fixture(); b.judgments[0].reviewer_context_id = 'implementer'; rejected(bundleCheck(b), 'self_review');
});
test('SR1-separate-three-lens-contexts-required', () => {
  const b = fixture(); b.judgments[1].reviewer_context_id = b.judgments[0].reviewer_context_id;
  rejected(authCheck(authorization(b), b, b.snapshots[0]), 'reviewer_context_reused');
});
test('SR1-missing-lens-coverage-and-evidence-refused', () => {
  const b = fixture(); b.judgments[0].scope = 'delta'; b.judgments[0].claim_ids = [b.claims[1].claim_id]; b.judgments[0].evidence_ids = b.claims[1].evidence_ids.slice();
  rejected(authCheck(authorization(b), b, b.snapshots[0]), 'coverage_incomplete');
  const b2 = fixture(); b2.evidence.pop(); rejected(bundleCheck(b2), 'reference_missing');
  const a = authorization(fixture()); delete a.lenses.correctness; rejected(authCheck(a, fixture(), fixture().snapshots[0]), 'lenses_missing');
});
test('SR1-all-covered-claim-evidence-required-for-full-and-delta', () => {
  for (const scope of ['full', 'delta']) {
    const b = fixture();
    b.evidence.push({ ...copy(b.evidence[0]), evidence_id: 'second-required-evidence', locator: 'second:1' });
    b.claims[0].evidence_ids.push('second-required-evidence');
    b.judgments[0].scope = scope;
    rejected(bundleCheck(b), 'claim_evidence_missing');
    b.judgments[0].evidence_ids.push('second-required-evidence');
    assert.equal(authCheck(authorization(b), b, b.snapshots[0]).ok, true);
  }
});
test('SR1-refutation-history-valid-authorization-refused', () => {
  const b = fixture(); b.findings.push({ finding_id: 'f1', claim_id: b.claims[0].claim_id, status: 'unresolved', evidence_ids: ['e-correctness'] });
  b.judgments[0].finding_ids = ['f1']; b.judgments[0].verdict = 'refute'; assert.equal(bundleCheck(b).ok, true);
  rejected(authCheck(authorization(b), b, b.snapshots[0]), 'judgment_not_passing');
  b.judgments[0].verdict = 'pass'; rejected(authCheck(authorization(b), b, b.snapshots[0]), 'finding_unresolved');
  b.judgments[0].finding_ids = []; rejected(authCheck(authorization(b), b, b.snapshots[0]), 'finding_unresolved');
  b.findings[0].status = 'resolved'; assert.equal(authCheck(authorization(b), b, b.snapshots[0]).ok, true);
});
test('SR1-duplicate-identities-and-missing-dependencies-refused', () => {
  const b = fixture(); b.evidence.push(copy(b.evidence[0])); rejected(bundleCheck(b), 'duplicate_id');
  const b2 = fixture(); b2.claims[0].dependencies = []; rejected(bundleCheck(b2), 'dependencies_missing');
});
test('SR1-adjacent-assessed-inheritance-preserves-origin', () => {
  const b = inheritedFixture(); assert.deepEqual(bundleCheck(b), { ok: true, errors: [] });
  assert.deepEqual(authCheck(authorization(b), b, b.snapshots.at(-1)), { ok: true, errors: [] });
  b.judgments.at(-1).origin_head_sha = sha(99); rejected(bundleCheck(b), 'origin_rewritten');
});
test('SR1-unassessed-skipped-cyclic-and-missing-bridge-refused', () => {
  const b = inheritedFixture(); b.bridges[0].assessed = false; rejected(bundleCheck(b), 'bridge_unassessed');
  const b2 = inheritedFixture(); b2.bridges[0].from_snapshot_id = 's1'; rejected(bundleCheck(b2), 'bridge_skipped');
  const b3 = inheritedFixture(); b3.judgments[3].source_receipt_id = b3.judgments[3].receipt_id; rejected(bundleCheck(b3), 'inheritance_cycle');
  const b4 = inheritedFixture(); b4.bridges = []; rejected(bundleCheck(b4), 'inheritance_origin_missing');
  const b5 = inheritedFixture(); b5.bridges[0].assessor_context_id = 'implementer'; rejected(bundleCheck(b5), 'self_review');
});
test('SR1-retention-cannot-invent-claims-evidence-or-erase-findings', () => {
  const b = inheritedFixture(); b.bridges[0].retained_claim_ids = []; rejected(bundleCheck(b), 'inheritance_claim_invalid');
  const b2 = inheritedFixture(); b2.judgments[3].evidence_ids = ['e-impact']; rejected(bundleCheck(b2), 'inheritance_evidence_invalid');
  const b3 = inheritedFixture(); b3.findings.push({ finding_id: 'f1', claim_id: b3.claims[0].claim_id, status: 'resolved', evidence_ids: ['e-correctness'] }); b3.judgments[0].finding_ids = ['f1']; rejected(bundleCheck(b3), 'inheritance_findings_invalid');
  const b4 = inheritedFixture(); b4.snapshots[1].base_sha = sha(99); rejected(bundleCheck(b4), 'inheritance_policy_changed');
});
test('SR1-multi-bridge-chain-preserves-original-receipt', () => {
  const b = inheritedFixture(), s = copy(b.snapshots[1]); s.snapshot_id = 's2'; s.head_sha = sha(8); s.messages.push({ sha: sha(8), message: 'fix: second prose repair' }); b.snapshots.push(s);
  b.evidence.push({ ...copy(b.evidence.at(-1)), evidence_id: 'e-impact2', snapshot_id: 's2' });
  b.bridges.push({ ...copy(b.bridges[0]), bridge_id: 'b12', from_snapshot_id: 's1', to_snapshot_id: 's2', evidence_ids: ['e-impact2'] });
  b.judgments.slice(3).forEach((j) => b.judgments.push({ ...copy(j), receipt_id: `i2-${j.lens}`, source_receipt_id: j.receipt_id, snapshot_id: 's2', bridge_id: 'b12' }));
  assert.equal(authCheck(authorization(b), b, s).ok, true);
  b.bridges[1].from_snapshot_id = 's0'; rejected(bundleCheck(b), 'bridge_skipped');
});
test('SR1-malformed-JSON-shapes-return-errors-without-throwing', () => {
  for (const collection of ['snapshots', 'claims', 'evidence', 'findings', 'bridges', 'judgments']) {
    for (const value of [null, {}, 1, [], [null], [{}]]) { const b = fixture(); b[collection] = value; if (Array.isArray(value) && !value.length && ['findings', 'bridges', 'judgments'].includes(collection)) continue; assert.equal(bundleCheck(b).ok, false, collection); }
  }
  for (const field of ['claim_ids', 'evidence_ids', 'finding_ids']) { const b = inheritedFixture(); b.judgments[0][field] = {}; assert.equal(bundleCheck(b).ok, false, field); }
});

// Synthetic decision inputs, never live repair history or measured timing.
const impactPath = process.env.SCOPED_REVIEW_IMPACT || path.resolve(__dirname, '../../scripts/autoloop/review-impact.js');
const { validateImpactAssessment: impactCheck, deriveReviewPlan: plan } = require(impactPath);
function impactFixture(kind = 'prose') {
  const b = fixture(), old = b.snapshots[0];
  old.review_inputs = { release_title: 'feat: isolated fixture', ci_skip_text: '', caller_digest: hex(20), schema_digest: hex(21), scanned_subjects: ['fixture.js', 'repair-subject', 'consumer.js'] };
  const s = copy(old); Object.assign(s, { snapshot_id: 's1', head_sha: sha(6), tree_sha: sha(7), diff_digest: hex(6), messages: [...s.messages, { sha: sha(6), message: 'feat: isolated fixture\n\nRepair comment with updated SHA reference' }] }); b.snapshots.push(s);
  b.evidence.push({ evidence_id: 'e-impact', snapshot_id: 's1', source_identity: 'synthetic independent assessment', locator: 'repair:1', digest: hex(8) });
  b.evidence.push({ ...copy(b.evidence[0]), evidence_id: 'e-current-correctness', snapshot_id: 's1' });
  const currentClaim = { ...copy(b.claims[0]), claim_id: 'claim-current-correctness', evidence_ids: ['e-current-correctness'] };
  b.claims.push(currentClaim); s.required_claims.correctness = [currentClaim.claim_id];
  b.judgments.push({ schema_version: VERSION, receipt_id: 'fresh-correctness', kind: 'direct', snapshot_id: 's1', lens: 'correctness', verdict: 'pass', reviewer_context_id: 'fresh-independent-context', implementer_context_id: 'implementer', scope: 'delta', claim_ids: [currentClaim.claim_id], finding_ids: [], evidence_ids: ['e-current-correctness', 'e-impact'] });
  const a = { schema_version: VERSION, assessment_id: 'impact-1', from_snapshot_id: 's0', to_snapshot_id: 's1', assessor_context_id: 'fresh-independent-context', correctness_receipt_id: 'fresh-correctness', evidence_ids: ['e-impact'], disputed: false,
    changes: [{ identity: 'repair-subject', kind, behavioral: false, roles: [], removed_or_weakened: false, isolated: true, additive: true, explanation: 'Explicit semantic inspection of the isolated repair', evidence_ids: ['e-impact'] }],
    discovery: { complete: true, before: [...old.review_inputs.scanned_subjects], after: [...s.review_inputs.scanned_subjects], consumers: [{ dependency: { kind: 'source', identity: 'fixture.js' }, consumer_ids: ['consumer.js'] }], evidence_ids: ['e-impact'] },
    retention: b.claims.slice(0, 3).map((c) => ({ claim_id: c.claim_id, unchanged: true, assumptions: ['The documented subject and its consumers preserve behavior'], explanation: 'Inspected dependencies and complete consumers remain untouched', dependencies: c.dependencies.map((d) => ({ kind: d.kind, identity: d.identity, from_digest: d.digest, to_digest: d.digest, evidence_ids: ['e-impact'] })), consumer_ids: ['consumer.js'], evidence_ids: ['e-impact'] })) };
  b.judgments.at(-1).impact_assessment_digest = digest(a);
  return { bundle: b, assessment: a, currentSnapshot: s };
}
// Matrix edits model a new independent signed assessment; tampering tests call
// plan directly and cannot regenerate this signature.
function decide(f) { f.bundle.judgments.at(-1).impact_assessment_digest = digest(f.assessment); return plan(f); }
function scopes(p) { return Object.fromEntries(p.lenses.map((v) => [v.lens, v.scope])); }
test('SR2-PH-comment-and-SHA-prose-repair-narrows-C', () => {
  const f = impactFixture(), before = digest(f), p = decide(f);
  assert.deepEqual(impactCheck(f.assessment, f.bundle), { ok: true, errors: [] });
  assert.equal(p.action, 'scoped-review'); assert.deepEqual(scopes(p), { correctness: 'delta' });
  assert.deepEqual(p.retained.map((r) => r.lens), ['regression-risk', 'test-adequacy']); assert.equal(digest(f), before);
});
test('SR2-PH-isolated-additive-fixture-requires-C-and-T', () => {
  const f = impactFixture('test'); f.assessment.changes[0].roles = ['assertion'];
  const p = decide(f); assert.deepEqual(scopes(p), { correctness: 'delta', 'test-adequacy': 'delta' });
  assert.deepEqual(p.retained.map((r) => r.lens), ['regression-risk']);
});
test('SR2-fresh-independent-correctness-signs-target-impact', () => {
  for (const change of [f => f.assessment.assessor_context_id = 'implementer', f => f.assessment.correctness_receipt_id = 'r-correctness', f => f.bundle.judgments.at(-1).evidence_ids.pop()]) {
    const f = impactFixture(); change(f); assert.equal(decide(f).action, 'refuse');
  }
});
test('SR2-never-passed-and-refuted-lenses-require-full-cumulative-review', () => {
  const f = impactFixture(); f.bundle.judgments.splice(1, 1);
  const p = decide(f); assert.equal(scopes(p)['regression-risk'], 'full');
  assert.ok(p.invalidations.some((i) => i.code === 'lens_unpassed'));
  const g = impactFixture(); g.bundle.findings.push({ finding_id: 'old-refutation', claim_id: 'claim-regression-risk', status: 'resolved', evidence_ids: ['e-regression-risk'] });
  g.bundle.judgments.push({ ...copy(g.bundle.judgments[1]), receipt_id: 'later-refute', verdict: 'refute', finding_ids: ['old-refutation'] });
  assert.equal(scopes(decide(g))['regression-risk'], 'full');
});
test('SR2-hash-match-alone-cannot-retain-a-judgment', () => {
  for (const change of [f => f.assessment.retention = [], f => f.assessment.retention[1].unchanged = false, f => f.assessment.retention[1].consumer_ids = [], f => f.assessment.discovery.consumers = [], f => f.assessment.retention[1].dependencies[0].to_digest = hex(99)]) {
    const f = impactFixture(); change(f); const p = decide(f); assert.equal(scopes(p)['regression-risk'], 'full');
  }
  const f = impactFixture(); f.assessment.retention[1].assumptions = []; assert.equal(decide(f).action, 'refuse');
});
test('SR2-RR-enclosing-template-and-sequence-transfer-invalidates-all-lenses', () => {
  for (const identity of ['fixture.js', 'repair-subject']) {
    const f = impactFixture('behavioral'); Object.assign(f.assessment.changes[0], { identity, behavioral: true, roles: ['runtime'], explanation: 'RR enclosing-template sequence transfer changes runtime behavior' });
    const p = decide(f); assert.equal(p.action, 'full-review'); assert.equal(p.retained.length, 0);
    assert.deepEqual(scopes(p), Object.fromEntries(LENSES.map(l => [l, 'delta'])));
  }
});
test('SR2-executable-analyzer-under-test-or-Markdown-name-is-behavioral', () => {
  for (const identity of ['platform/test/run-analyzer.js', 'execute.md']) {
    const f = impactFixture('test'); f.assessment.discovery.before.push(identity); f.assessment.discovery.after.push(identity);
    f.bundle.snapshots[0].review_inputs.scanned_subjects.push(identity); f.currentSnapshot.review_inputs.scanned_subjects.push(identity);
    Object.assign(f.assessment.changes[0], { identity, roles: ['analyzer'], explanation: 'Callable executable analyzer, not an isolated assertion' });
    const p = decide(f); assert.equal(p.retained.length, 0); assert.equal(p.lenses.length, 3);
  }
});
test('SR2-weakened-assertions-or-shared-oracles-require-all-three', () => {
  for (const change of [c => c.removed_or_weakened = true, c => c.roles = ['oracle'], c => c.roles = ['shared-generator'], c => c.isolated = false, c => c.additive = false]) {
    const f = impactFixture('test'); change(f.assessment.changes[0]); assert.equal(decide(f).retained.length, 0); assert.equal(decide(f).lenses.length, 3);
  }
});
test('SR2-SYNC-archived-history-prerequisites-unknown-or-missing-refuses-reuse', () => {
  const f = impactFixture(); f.assessment.from_snapshot_id = 'missing-archived-history'; assert.equal(decide(f).action, 'refuse');
  for (const change of [g => g.assessment.changes[0].kind = 'unknown', g => g.assessment.disputed = true, g => g.assessment.discovery.complete = false, g => g.assessment.discovery.after.push('new-scanned-file'), g => g.assessment.discovery.before.pop()]) {
    const g = impactFixture(); change(g); const p = decide(g); assert.equal(p.action, 'full-review'); assert.equal(p.retained.length, 0); assert.ok(p.lenses.every(l => l.scope === 'full'));
  }
});
test('SR2-release-CI-base-contract-policy-caller-schema-inputs-force-full-review', () => {
  for (const change of [f => f.currentSnapshot.base_sha = sha(99), f => f.currentSnapshot.merge_base_sha = sha(99), f => f.currentSnapshot.contract_digest = hex(99), f => f.currentSnapshot.policy_digest = hex(99), ...['release_title','ci_skip_text','caller_digest','schema_digest'].map(k => f => f.currentSnapshot.review_inputs[k] += ' changed'), f => delete f.currentSnapshot.review_inputs, f => f.currentSnapshot.messages.at(-1).message += ' [skip ci]']) {
    const f = impactFixture(); change(f); const p = decide(f); assert.equal(p.action, 'full-review'); assert.ok(p.lenses.every(l => l.scope === 'full'));
  }
  const f = impactFixture(); f.currentSnapshot = copy(f.currentSnapshot); f.currentSnapshot.head_sha = sha(99); assert.equal(decide(f).action, 'refuse');
});
test('SR2-dependency-consumer-closure-invalidates-retention', () => {
  const f = impactFixture(); f.assessment.changes[0].identity = 'consumer.js'; assert.equal(scopes(decide(f))['regression-risk'], 'full');
  const g = impactFixture(); g.assessment.retention[1].dependencies.push(copy(g.assessment.retention[1].dependencies[0])); assert.equal(scopes(decide(g))['regression-risk'], 'full');
});
test('SR2-actual-HEAD-release-title-cannot-hide-behind-stale-summary', () => {
  const f = impactFixture('message'); f.currentSnapshot.messages.at(-1).message = 'fix: changed release subject\n\nComment';
  const p = decide(f); assert.equal(p.action, 'full-review'); assert.ok(p.invalidations.some(i => i.code === 'release_title_changed'));
  const g = impactFixture('message'); g.currentSnapshot.messages.at(-1).message += '\n\nUpdated comment SHA ' + sha(42);
  assert.equal(decide(g).action, 'scoped-review', 'body and SHA-only repair retains a verified unchanged subject');
  const h = impactFixture('message'); h.currentSnapshot.review_inputs.release_title = 'feat: stale false title';
  assert.equal(decide(h).action, 'full-review');
});
test('SR2-actual-CI-trailers-and-brackets-append-remove-alter-force-full-review', () => {
  const controls = ['skip-checks:true', 'skip-checks: true', '[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]'];
  for (const control of controls) {
    const suffix = '\n\n\n' + control;
    const f = impactFixture('message'); f.currentSnapshot.messages.at(-1).message += suffix;
    const p = decide(f); assert.equal(p.action, 'full-review', `append ${control}`);
    assert.ok(p.invalidations.some(i => i.code === 'ci_skip_text_changed')); assert.equal(p.retained.length, 0);
    for (const replacement of ['', suffix.replace('true', 'false').toUpperCase()]) {
      const g = impactFixture('message'); g.bundle.snapshots[0].messages[0].message += suffix;
      g.currentSnapshot.messages[0].message += replacement;
      assert.equal(decide(g).action, 'full-review', `remove/alter ${control} in non-HEAD history`);
    }
  }
  const olderHead = impactFixture('message');
  olderHead.bundle.snapshots[0].messages[0].message += '\n\n\nskip-checks:true';
  olderHead.currentSnapshot.messages[0].message += '\n\n\nskip-checks:true';
  assert.equal(decide(olderHead).action, 'full-review', 'old HEAD skip becomes non-HEAD after a new commit');
  // Moving an identical control to another commit cannot hide behind total counts.
  const moved = impactFixture('message'); moved.bundle.snapshots[0].messages[0].message += '\n\n\nskip-checks:true';
  moved.currentSnapshot.messages.at(-1).message += '\n\n\nskip-checks:true';
  assert.equal(decide(moved).action, 'full-review');
});
test('SR2-actual-release-controls-across-history-force-full-review', () => {
  for (const control of ['BREAKING CHANGE: behavior changed', 'BREAKING-CHANGE: changed', 'feat!: changed major release']) {
    const f = impactFixture('message'); f.currentSnapshot.messages[0].message += '\n\n' + control;
    const p = decide(f); assert.equal(p.action, 'full-review'); assert.ok(p.invalidations.some(i => i.code === 'release_message_control_changed'));
  }
});
test('SR2-signature-binds-whole-assessment-and-context-must-be-fresh', () => {
  const f = impactFixture(); f.assessment.changes[0].explanation += ' tampered';
  rejected(impactCheck(f.assessment, f.bundle), 'impact_signature_mismatch'); assert.equal(plan(f).action, 'refuse');
  const g = impactFixture(); g.assessment.assessor_context_id = 'reviewer-regression-risk'; g.bundle.judgments.at(-1).reviewer_context_id = 'reviewer-regression-risk';
  assert.equal(decide(g).action, 'refuse');
});
test('SR2-malicious-and-malformed-inputs-never-dispatch-or-throw', () => {
  let calls = 0;
  for (const malicious of callerArrays(() => calls++)) {
    const f = impactFixture(); f.assessment.changes = malicious;
    rejected(impactCheck(f.assessment, f.bundle), 'non_json'); assert.equal(plan(f).action, 'refuse');
  }
  assert.equal(calls, 0);
  for (const field of ['changes', 'discovery', 'retention']) for (const value of [null, {}, [], [null], [{}]]) {
    const f = impactFixture(); f.assessment[field] = value; assert.doesNotThrow(() => plan(f));
  }
});
if (!process.env.SCOPED_REVIEW_MUTANT_CHILD) test('SR2-RED-disposable-impact-mutant', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-impact-red-'));
  try {
    const source = fs.readFileSync(impactPath, 'utf8'), guard = "!c.roles.length && !c.removed_or_weakened";
    assert.ok(source.includes(guard));
    const mutant = path.join(root, 'review-impact.js');
    fs.copyFileSync(contractPath, path.join(root, 'review-contract.js'));
    fs.writeFileSync(mutant, source.replaceAll(guard, 'true').replace("c.roles.every((r) => r === 'assertion')", 'true'));
    const result = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: root, SCOPED_REVIEW_IMPACT: mutant, SCOPED_REVIEW_MUTANT_CHILD: '1', SAUCE_LOOP_BOARD: path.join(root, 'unused-board.md'), DELIVERY_STATE: path.join(root, 'unused-state.json') } });
    assert.equal(result.status, 1); assert.match(result.stderr, /FAIL SR2-executable-analyzer-under-test-or-Markdown-name-is-behavioral:/);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|SyntaxError|getter executed/);
    console.log('RED proof: impact role mutant triggered named SR2 executable analyzer assertion');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

if (!process.env.SCOPED_REVIEW_MUTANT_CHILD) test('SR2-RED-disposable-CI-trailer-detector-mutant', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-ci-control-red-'));
  try {
    const source = fs.readFileSync(impactPath, 'utf8');
    const guard = "if (!equal(messageControls(previous, ciPattern), messageControls(target, ciPattern)))";
    assert.ok(source.includes(guard));
    fs.copyFileSync(contractPath, path.join(root, 'review-contract.js'));
    const mutant = path.join(root, 'review-impact.js'); fs.writeFileSync(mutant, source.replace(guard, 'if (false)'));
    const result = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: root, SCOPED_REVIEW_IMPACT: mutant, SCOPED_REVIEW_MUTANT_CHILD: '1', SAUCE_LOOP_BOARD: path.join(root, 'unused-board.md'), DELIVERY_STATE: path.join(root, 'unused-state.json') } });
    assert.equal(result.status, 1); assert.match(result.stderr, /FAIL SR2-actual-CI-trailers-and-brackets-append-remove-alter-force-full-review:/);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|SyntaxError|getter executed/);
    console.log('RED proof: CI detector mutant triggered named SR2 trailer/bracket assertion');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Counterfactual executes the same assertions against a disposable source copy.
// A specific behavior guard is removed; a named assertion must catch acceptance.
if (!process.env.SCOPED_REVIEW_MUTANT_CHILD) test('SR1-RED-disposable-source-mutants', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-scoped-reviews-'));
  try {
    const source = fs.readFileSync(contractPath, 'utf8');
    const mutants = [
      ['plain-array', 'if (array && !plainArray(value)) return false;', 'if (false) return false;', /FAIL SR1b-array-purity-validator-never-dispatches-caller-code:/],
      ['self-review', "if (snapshots.some((v) => v.implementer_context_id === j.reviewer_context_id))", 'if (false)', /FAIL SR1-self-review-refused: expected rejection self_review/],
      ['hash-type', "const shaValue = (v) => typeof v === 'string' && SHA.test(v);", 'const shaValue = (v) => SHA.test(v);', /FAIL SR1-hash-fields-reject-coercion-values: expected rejection sha_invalid/],
      ['claim-evidence', 'if (!claimEvidenceCovered(j, maps.claims))', 'if (false)', /FAIL SR1-direct-judgment-must-cite-covered-claim-evidence: expected rejection claim_evidence_missing/],
    ];
    for (const [name, guard, replacement, expectedFailure] of mutants) {
      assert.ok(source.includes(guard), `${name} mutant guard exists`);
      const mutant = path.join(root, `review-contract-${name}.js`); fs.writeFileSync(mutant, source.replace(guard, replacement));
      const result = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: root, SCOPED_REVIEW_CONTRACT: mutant, SCOPED_REVIEW_MUTANT_CHILD: '1', SAUCE_LOOP_BOARD: path.join(root, 'unused-board.md'), DELIVERY_STATE: path.join(root, 'unused-state.json') } });
      assert.equal(result.status, 1, JSON.stringify(result));
      assert.match(result.stderr, expectedFailure);
      if (name === 'plain-array') assert.match(result.stderr, /FAIL SR1b-array-purity-digest-rejects-collisions-without-caller-code: Missing expected exception/);
      if (name === 'claim-evidence') assert.match(result.stderr, /FAIL SR1-inherited-judgment-cannot-omit-covered-claim-evidence: expected rejection claim_evidence_missing/);
      assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|SyntaxError|getter executed/);
      console.log(`RED proof: ${name} guard mutant triggered its named assertion failure`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
console.log(`scoped-reviews: ${passed} cases passed`);
