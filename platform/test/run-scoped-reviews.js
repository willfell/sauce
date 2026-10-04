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
test('SR1-self-review-refused', () => {
  const b = fixture(); b.judgments[0].reviewer_context_id = 'implementer'; rejected(bundleCheck(b), 'self_review');
});
test('SR1-separate-three-lens-contexts-required', () => {
  const b = fixture(); b.judgments[1].reviewer_context_id = b.judgments[0].reviewer_context_id;
  rejected(authCheck(authorization(b), b, b.snapshots[0]), 'reviewer_context_reused');
});
test('SR1-missing-lens-coverage-and-evidence-refused', () => {
  const b = fixture(); b.judgments[0].scope = 'delta'; b.judgments[0].claim_ids = [b.claims[1].claim_id];
  rejected(authCheck(authorization(b), b, b.snapshots[0]), 'coverage_incomplete');
  const b2 = fixture(); b2.evidence.pop(); rejected(bundleCheck(b2), 'reference_missing');
  const a = authorization(fixture()); delete a.lenses.correctness; rejected(authCheck(a, fixture(), fixture().snapshots[0]), 'lenses_missing');
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

// Counterfactual executes the same assertions against a disposable source copy.
// A specific behavior guard is removed; a named assertion must catch acceptance.
if (!process.env.SCOPED_REVIEW_MUTANT_CHILD) test('SR1-RED-self-review-source-mutant', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-scoped-reviews-'));
  try {
    const source = fs.readFileSync(contractPath, 'utf8');
    const guard = "if (snapshots.some((v) => v.implementer_context_id === j.reviewer_context_id))";
    assert.ok(source.includes(guard), 'mutant guard exists');
    const mutant = path.join(root, 'review-contract.js'); fs.writeFileSync(mutant, source.replace(guard, 'if (false)'));
    const result = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: root, SCOPED_REVIEW_CONTRACT: mutant, SCOPED_REVIEW_MUTANT_CHILD: '1', SAUCE_LOOP_BOARD: path.join(root, 'unused-board.md'), DELIVERY_STATE: path.join(root, 'unused-state.json') } });
    assert.equal(result.status, 1, JSON.stringify(result));
    assert.match(result.stderr, /FAIL SR1-self-review-refused: expected rejection self_review/);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|SyntaxError|getter executed/);
    console.log('RED proof: FAIL SR1-self-review-refused: expected rejection self_review (disposable mutant)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
console.log(`scoped-reviews: ${passed} cases passed`);
