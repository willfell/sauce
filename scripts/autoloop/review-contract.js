'use strict';

const { createHash } = require('crypto');
const { types: { isProxy } } = require('util');
// Capture the standard array surface once. A caller must not change inherited
// methods between validation and canonicalization or cause validator dispatch.
const ARRAY_KEYS = Reflect.ownKeys(Array.prototype);
const ARRAY_DESCRIPTORS = Object.getOwnPropertyDescriptors(Array.prototype);
function plainArraySurface() {
  if (Object.getPrototypeOf(Array.prototype) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(Array.prototype);
  if (keys.length !== ARRAY_KEYS.length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== ARRAY_KEYS[i]) return false;
    const current = Object.getOwnPropertyDescriptor(Array.prototype, keys[i]);
    const original = ARRAY_DESCRIPTORS[keys[i]];
    if (current.value !== original.value || current.get !== original.get
      || current.set !== original.set || current.enumerable !== original.enumerable
      || current.writable !== original.writable || current.configurable !== original.configurable) return false;
  }
  return true;
}
function plainArray(value) {
  return Object.getPrototypeOf(value) === Array.prototype && plainArraySurface();
}
const VERSION = '1.0.0';
const LENSES = Object.freeze(['correctness', 'regression-risk', 'test-adequacy']);
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const shaValue = (v) => typeof v === 'string' && SHA.test(v);
const digestValue = (v) => typeof v === 'string' && DIGEST.test(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const contains = (v, id) => Array.isArray(v) && v.includes(id);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v, nonempty = false) => Array.isArray(v) && (!nonempty || v.length > 0)
  && v.every(text) && new Set(v).size === v.length;

// Strict JSON, with bounded traversal. Do not invoke getters/toJSON or silently
// discard symbols, sparse elements, undefined, custom prototypes or extra keys.
function jsonValue(value, ancestors = new Set(), budget = { nodes: 0 }, depth = 0) {
  if (depth === 0 && !plainArraySurface()) return false;
  if (++budget.nodes > 50000 || depth > 128) return false;
  const type = typeof value;
  if (value === null || type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (type !== 'object' || isProxy(value) || ancestors.has(value)) return false;
  const array = Array.isArray(value);
  if (array && !plainArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  let element = 0;
  ancestors.add(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key !== 'string') { ancestors.delete(value); return false; }
    if (array && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if ((array && key !== String(element++)) || !d.enumerable || !('value' in d)
      || key === '__proto__' || key === 'constructor' || key === 'prototype'
      || !jsonValue(d.value, ancestors, budget, depth + 1)) {
      ancestors.delete(value); return false;
    }
  }
  ancestors.delete(value);
  return !array || element === value.length;
}
function canonical(value) {
  if (Array.isArray(value)) {
    let result = '[';
    for (let i = 0; i < value.length; i++) result += `${i ? ',' : ''}${canonical(value[i])}`;
    return `${result}]`;
  }
  if (object(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function canonicalReviewDigest(value) {
  if (!jsonValue(value)) throw new TypeError('review value must be bounded plain JSON');
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/* v1 contract (structural provenance only; no runtime activation or IO):
 * bundle: schema_version, snapshots (ordered complete repair lineage), claims,
 * evidence, findings, bridges, judgments. Every object ID is globally unique.
 * snapshot: snapshot_id, schema_version, repository_id, card_id, head_sha,
 * tree_sha, base_sha, merge_base_sha, diff_digest, messages [{sha,message}],
 * contract_digest, policy_digest, implementer_context_id, required_claims
 * {correctness: [claim IDs], regression-risk: [...], test-adequacy: [...]}.
 * claim: claim_id, statement, dependencies [{kind,identity,digest}], evidence_ids.
 * evidence: evidence_id, snapshot_id, source_identity, locator, digest.
 * finding: finding_id, claim_id, status (unresolved/resolved), evidence_ids.
 * bridge: bridge_id, schema_version, from_snapshot_id, to_snapshot_id,
 * assessed:true, assessor_context_id, retained_claim_ids, evidence_ids.
 * judgment: receipt_id, schema_version, kind (direct/inherited), snapshot_id,
 * lens, verdict, reviewer_context_id, implementer_context_id, scope (full/delta),
 * claim_ids, finding_ids, evidence_ids. Inherited also requires source_receipt_id,
 * bridge_id, origin_receipt_id, origin_head_sha, origin_base_sha.
 * authorization: schema_version, authorization_id, snapshot (entire object),
 * bundle_digest, lenses {each lens: [receipt IDs]}. Each lens must cover all its
 * snapshot requirements. Refutations are valid history, never authorization.
 * Bridge assessment and evidence authenticity remain caller policy obligations;
 * this module refuses broken provenance, it does not decide semantic retention.
 */
function claimEvidenceCovered(judgment, claims) {
  return Array.isArray(judgment.claim_ids) && judgment.claim_ids.every((id) => {
    const claim = claims.get(id);
    return claim && Array.isArray(claim.evidence_ids)
      && claim.evidence_ids.every((evidenceId) => contains(judgment.evidence_ids, evidenceId));
  });
}

function validateReviewBundle(bundle) {
  const errors = [];
  const fail = (code, field, message) => errors.push({ code, field, message });
  if (!jsonValue(bundle) || !object(bundle)) return { ok: false, errors: [{ code: 'non_json', field: 'bundle', message: 'expected bounded plain JSON object' }] };
  if (bundle.schema_version !== VERSION) fail('version_unsupported', 'schema_version', `expected ${VERSION}`);
  const maps = {};
  const globalIds = new Set();
  for (const [name, id] of [['snapshots', 'snapshot_id'], ['claims', 'claim_id'], ['evidence', 'evidence_id'], ['findings', 'finding_id'], ['bridges', 'bridge_id'], ['judgments', 'receipt_id']]) {
    maps[name] = new Map();
    if (!Array.isArray(bundle[name])) { fail('collection_missing', name, 'array required'); continue; }
    bundle[name].forEach((item, i) => {
      const field = `${name}[${i}]`;
      if (!object(item) || !text(item[id])) { fail('identity_missing', field, `${id} required`); return; }
      if (globalIds.has(item[id])) fail('duplicate_id', `${field}.${id}`, 'IDs must be globally unique');
      globalIds.add(item[id]);
      maps[name].set(item[id], item);
    });
  }
  const list = (name) => [...maps[name].values()];
  const refs = (value, map, field, nonempty = true) => {
    if (!strings(value, nonempty)) { fail('references_invalid', field, 'unique nonempty identity strings required'); return; }
    value.forEach((id) => { if (!map.has(id)) fail('reference_missing', field, `unknown ${id}`); });
  };
  const version = (v, f) => { if (v !== VERSION) fail('version_unsupported', f, `expected ${VERSION}`); };
  const snapshots = list('snapshots');
  if (!snapshots.length) fail('snapshot_missing', 'snapshots', 'at least one snapshot required');
  snapshots.forEach((s, i) => {
    const f = `snapshots[${i}]`;
    version(s.schema_version, `${f}.schema_version`);
    for (const k of ['repository_id', 'card_id', 'implementer_context_id']) if (!text(s[k])) fail('identity_missing', `${f}.${k}`, 'nonempty identity required');
    for (const k of ['head_sha', 'tree_sha', 'base_sha', 'merge_base_sha']) if (!shaValue(s[k])) fail('sha_invalid', `${f}.${k}`, '40 lowercase hex required');
    for (const k of ['diff_digest', 'contract_digest', 'policy_digest']) if (!digestValue(s[k])) fail('digest_invalid', `${f}.${k}`, '64 lowercase hex required');
    if (i && (s.repository_id !== snapshots[0].repository_id || s.card_id !== snapshots[0].card_id)) fail('lineage_mismatch', f, 'all snapshots must belong to one repository/card');
    if (!Array.isArray(s.messages) || !s.messages.length || s.messages.some((m) => !object(m) || !shaValue(m.sha) || !text(m.message))
      || new Set(s.messages.map((m) => m && m.sha)).size !== s.messages.length || !s.messages.some((m) => m && m.sha === s.head_sha)) fail('messages_incomplete', `${f}.messages`, 'unique full branch-message inventory including HEAD required');
    if (!object(s.required_claims) || Object.keys(s.required_claims).length !== LENSES.length) fail('coverage_requirements_missing', `${f}.required_claims`, 'all three lens requirement lists required');
    for (const lens of LENSES) refs(s.required_claims && s.required_claims[lens], maps.claims, `${f}.required_claims.${lens}`);
  });
  list('evidence').forEach((e) => {
    const f = `evidence.${e.evidence_id}`;
    if (!maps.snapshots.has(e.snapshot_id)) fail('reference_missing', f, 'evidence snapshot missing');
    for (const k of ['source_identity', 'locator']) if (!text(e[k])) fail('evidence_identity_missing', `${f}.${k}`, 'evidence source and locator required');
    if (!digestValue(e.digest)) fail('digest_invalid', `${f}.digest`, 'evidence digest required');
  });
  list('claims').forEach((c) => {
    const f = `claims.${c.claim_id}`;
    if (!text(c.statement)) fail('claim_missing', f, 'explicit statement required');
    if (!Array.isArray(c.dependencies) || !c.dependencies.length || c.dependencies.some((d) => !object(d) || !text(d.kind) || !text(d.identity) || !digestValue(d.digest))
      || new Set(c.dependencies.map(canonical)).size !== c.dependencies.length) fail('dependencies_missing', f, 'explicit unique dependency identities/digests required');
    refs(c.evidence_ids, maps.evidence, `${f}.evidence_ids`);
  });
  list('findings').forEach((f) => {
    if (!maps.claims.has(f.claim_id)) fail('reference_missing', `findings.${f.finding_id}`, 'finding claim missing');
    if (!['unresolved', 'resolved'].includes(f.status)) fail('finding_status_invalid', `findings.${f.finding_id}`, 'explicit finding status required');
    refs(f.evidence_ids, maps.evidence, `findings.${f.finding_id}.evidence_ids`);
  });
  list('bridges').forEach((b) => {
    const f = `bridges.${b.bridge_id}`;
    version(b.schema_version, `${f}.schema_version`);
    const from = snapshots.findIndex((s) => s.snapshot_id === b.from_snapshot_id);
    const to = snapshots.findIndex((s) => s.snapshot_id === b.to_snapshot_id);
    if (from < 0 || to !== from + 1) fail('bridge_skipped', f, 'bridge must join adjacent ordered snapshots');
    if (b.assessed !== true || !text(b.assessor_context_id)) fail('bridge_unassessed', f, 'explicit independent assessment required');
    if (snapshots.some((s) => s.implementer_context_id === b.assessor_context_id)) fail('self_review', f, 'implementer cannot assess retention');
    refs(b.retained_claim_ids, maps.claims, `${f}.retained_claim_ids`, false);
    refs(b.evidence_ids, maps.evidence, `${f}.evidence_ids`);
    if (Array.isArray(b.evidence_ids) && b.evidence_ids.some((id) => maps.evidence.has(id) && maps.evidence.get(id).snapshot_id !== b.to_snapshot_id)) fail('evidence_snapshot_mismatch', f, 'assessment evidence must bind target snapshot');
  });
  list('judgments').forEach((j) => {
    const f = `judgments.${j.receipt_id}`;
    version(j.schema_version, `${f}.schema_version`);
    const s = maps.snapshots.get(j.snapshot_id);
    if (!s) fail('reference_missing', f, 'judgment snapshot missing');
    if (!LENSES.includes(j.lens) || !['pass', 'refute'].includes(j.verdict) || !['full', 'delta'].includes(j.scope) || !['direct', 'inherited'].includes(j.kind)) fail('judgment_invalid', f, 'known kind, lens, verdict and scope required');
    if (!text(j.reviewer_context_id) || !text(j.implementer_context_id)) fail('identity_missing', f, 'reviewer and implementer contexts required');
    if (snapshots.some((v) => v.implementer_context_id === j.reviewer_context_id)) fail('self_review', f, 'implementer cannot review any snapshot in its repair lineage');
    if (s && j.implementer_context_id !== s.implementer_context_id) fail('context_mismatch', f, 'judgment implementer must match snapshot');
    refs(j.claim_ids, maps.claims, `${f}.claim_ids`);
    refs(j.evidence_ids, maps.evidence, `${f}.evidence_ids`);
    if (!claimEvidenceCovered(j, maps.claims)) fail('claim_evidence_missing', f, 'every covered claim requires its explicit evidence IDs in the judgment');
    refs(j.finding_ids, maps.findings, `${f}.finding_ids`, false);
    if (Array.isArray(j.finding_ids) && j.finding_ids.some((id) => maps.findings.has(id) && !contains(j.claim_ids, maps.findings.get(id).claim_id))) fail('finding_scope_mismatch', f, 'finding must belong to judgment claims');
    if (j.verdict === 'refute' && (!Array.isArray(j.finding_ids) || !j.finding_ids.length)) fail('refutation_unexplained', f, 'refutation requires finding');
    if (j.scope === 'full' && s && Array.isArray(s.required_claims?.[j.lens]) && !s.required_claims[j.lens].every((id) => contains(j.claim_ids, id))) fail('coverage_incomplete', f, 'full judgment must cover every required claim');
    if (j.kind === 'direct') {
      if (['source_receipt_id', 'bridge_id', 'origin_receipt_id', 'origin_head_sha', 'origin_base_sha'].some((k) => k in j)) fail('direct_inheritance_invalid', f, 'direct judgment cannot impersonate retained receipt');
      if (Array.isArray(j.evidence_ids) && j.evidence_ids.some((id) => maps.evidence.has(id) && maps.evidence.get(id).snapshot_id !== j.snapshot_id)) fail('evidence_snapshot_mismatch', f, 'direct evidence must bind reviewed snapshot');
    } else {
      for (const k of ['origin_head_sha', 'origin_base_sha']) if (!shaValue(j[k])) fail('sha_invalid', `${f}.${k}`, 'origin SHA must be a 40 lowercase hex string');
      const source = maps.judgments.get(j.source_receipt_id);
      const bridge = maps.bridges.get(j.bridge_id);
      const origin = maps.judgments.get(j.origin_receipt_id);
      const originalSnapshot = origin && maps.snapshots.get(origin.snapshot_id);
      if (!source || !bridge || !origin || origin.kind !== 'direct' || !originalSnapshot) fail('inheritance_origin_missing', f, 'source, assessed bridge and original direct receipt required');
      else {
        if (source.verdict !== 'pass' || j.verdict !== 'pass' || source.lens !== j.lens || source.reviewer_context_id !== j.reviewer_context_id
          || bridge.from_snapshot_id !== source.snapshot_id || bridge.to_snapshot_id !== j.snapshot_id) fail('inheritance_mismatch', f, 'passing source and exact adjacent bridge required');
        if (j.origin_receipt_id !== (source.kind === 'direct' ? source.receipt_id : source.origin_receipt_id)
          || j.origin_head_sha !== originalSnapshot.head_sha || j.origin_base_sha !== originalSnapshot.base_sha) fail('origin_rewritten', f, 'original receipt HEAD/base must be preserved');
        if (!Array.isArray(j.claim_ids) || !j.claim_ids.every((id) => contains(source.claim_ids, id) && contains(bridge.retained_claim_ids, id))) fail('inheritance_claim_invalid', f, 'retention needs source coverage and bridge assessment for each claim');
        if (!Array.isArray(j.evidence_ids) || !j.evidence_ids.every((id) => contains(source.evidence_ids, id))) fail('inheritance_evidence_invalid', f, 'retained evidence must preserve source evidence');
        if (canonical(j.finding_ids) !== canonical(source.finding_ids)) fail('inheritance_findings_invalid', f, 'retention cannot erase findings');
        const old = maps.snapshots.get(source.snapshot_id);
        if (old && s && ['base_sha', 'contract_digest', 'policy_digest'].some((k) => old[k] !== s[k])) fail('inheritance_policy_changed', f, 'base, contract or policy changes require fresh review');
      }
    }
  });
  // Iterative ancestry walk catches cycles without trusting receipt array order.
  for (const j of list('judgments')) {
    const seen = new Set();
    let current = j;
    while (current && current.kind === 'inherited') {
      if (seen.has(current.receipt_id)) { fail('inheritance_cycle', `judgments.${j.receipt_id}`, 'receipt ancestry must be acyclic'); break; }
      seen.add(current.receipt_id);
      current = maps.judgments.get(current.source_receipt_id);
    }
  }
  return { ok: !errors.length, errors };
}

function validateAuthorization(authorization, bundle, snapshot) {
  const validation = validateReviewBundle(bundle);
  if (!validation.ok) return validation;
  const errors = [];
  const fail = (code, field, message) => errors.push({ code, field, message });
  if (!jsonValue(authorization) || !object(authorization) || !jsonValue(snapshot) || !object(snapshot)) return { ok: false, errors: [{ code: 'non_json', field: 'authorization', message: 'authorization and snapshot must be bounded plain JSON' }] };
  if (authorization.schema_version !== VERSION) fail('version_unsupported', 'schema_version', `expected ${VERSION}`);
  if (!text(authorization.authorization_id)) fail('identity_missing', 'authorization_id', 'authorization identity required');
  const current = bundle.snapshots[bundle.snapshots.length - 1];
  if (canonical(snapshot) !== canonical(current) || canonical(authorization.snapshot) !== canonical(current)) fail('snapshot_mismatch', 'snapshot', 'authorization must bind entire exact latest snapshot');
  if (!digestValue(authorization.bundle_digest)) fail('digest_invalid', 'bundle_digest', 'bundle digest must be a 64 lowercase hex string');
  if (authorization.bundle_digest !== canonicalReviewDigest(bundle)) fail('bundle_mismatch', 'bundle_digest', 'entire validated bundle digest required');
  if (!object(authorization.lenses) || Object.keys(authorization.lenses).length !== LENSES.length) fail('lenses_missing', 'lenses', 'exact three lens slots required');
  const judgments = new Map(bundle.judgments.map((j) => [j.receipt_id, j]));
  const reviewers = new Map();
  for (const lens of LENSES) {
    const ids = authorization.lenses?.[lens];
    if (!strings(ids, true)) { fail('coverage_incomplete', `lenses.${lens}`, 'nonempty unique receipt IDs required'); continue; }
    const covered = new Set();
    for (const id of ids) {
      const j = judgments.get(id);
      if (!j || j.lens !== lens || j.snapshot_id !== current.snapshot_id || j.verdict !== 'pass') { fail('judgment_not_passing', `lenses.${lens}`, 'exact-current passing receipt for this lens required'); continue; }
      const previousLens = reviewers.get(j.reviewer_context_id);
      if (previousLens && previousLens !== lens) fail('reviewer_context_reused', `lenses.${lens}`, 'three lenses need separate reviewer contexts');
      reviewers.set(j.reviewer_context_id, lens);
      j.claim_ids.forEach((c) => covered.add(c));
      if (j.finding_ids.some((f) => bundle.findings.find((v) => v.finding_id === f).status !== 'resolved')) fail('finding_unresolved', `lenses.${lens}`, 'selected receipt has unresolved findings');
    }
    if (!current.required_claims[lens].every((c) => covered.has(c))) fail('coverage_incomplete', `lenses.${lens}`, 'every required claim must have passing coverage');
  }
  // An unresolved current claim cannot disappear by choosing another receipt.
  if (bundle.findings.some((f) => f.status === 'unresolved' && LENSES.some((lens) => current.required_claims[lens].includes(f.claim_id)))) fail('finding_unresolved', 'findings', 'current required claims have unresolved findings');
  return { ok: !errors.length, errors };
}

module.exports = { VERSION, LENSES, isPlainReviewJson: jsonValue, canonicalReviewDigest, validateReviewBundle, validateAuthorization };
