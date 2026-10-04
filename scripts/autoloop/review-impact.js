'use strict';

const { VERSION, LENSES, isPlainReviewJson, canonicalReviewDigest: digest, validateReviewBundle } = require('./review-contract');
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const strings = (v, nonempty = false) => Array.isArray(v) && (!nonempty || v.length > 0)
  && v.every(text) && new Set(v).size === v.length;
const equal = (a, b) => digest(a) === digest(b);
const key = (v) => digest({ kind: v.kind, identity: v.identity });
const ROLES = Object.freeze(['assertion', 'oracle', 'shared-generator', 'analyzer', 'runtime', 'config', 'dependency', 'workflow', 'caller', 'schema']);
const KINDS = Object.freeze(['prose', 'message', 'test', 'behavioral', 'unknown']);

/* Pure impact read-contract, within the v1 review contract; no IO or live policy.
 * assessment: schema_version, assessment_id, from_snapshot_id, to_snapshot_id,
 * assessor_context_id, correctness_receipt_id, evidence_ids, disputed (boolean),
 * changes [{identity,kind,behavioral,roles,removed_or_weakened,isolated,additive,
 *           explanation,evidence_ids}], discovery {complete, before, after,
 *           consumers:[{dependency:{kind,identity},consumer_ids}], evidence_ids},
 * retention [{claim_id,unchanged,assumptions:[nonempty statements],explanation,
 *            dependencies:[{kind,identity,from_digest,to_digest,evidence_ids}],
 *            consumer_ids,evidence_ids}]. before/after are complete unique scanned
 * subject identities, not filenames classified by extension. Empty consumer
 * sets are allowed only with explicit complete discovery and cited evidence.
 * Snapshot review_inputs binds release_title, ci_skip_text, caller_digest,
 * schema_digest and scanned_subjects. Missing/changed inputs force full review.
 * The independent correctness receipt signs the assessment by citing its full
 * target evidence set and impact_assessment_digest (canonical whole assessment).
 * Authenticity of evidence is an upstream reviewer duty.
 */
function validateImpactAssessment(assessment, bundle) {
  const checked = validateReviewBundle(bundle);
  if (!checked.ok) return checked;
  if (!isPlainReviewJson(assessment) || !object(assessment)) return { ok: false, errors: [{ code: 'non_json', field: 'assessment', message: 'bounded plain JSON object required' }] };
  const errors = [], fail = (code, field) => errors.push({ code, field, message: code });
  if (assessment.schema_version !== VERSION) fail('version_unsupported', 'schema_version');
  for (const f of ['assessment_id', 'assessor_context_id', 'correctness_receipt_id']) if (!text(assessment[f])) fail('identity_missing', f);
  const index = bundle.snapshots.findIndex((s) => s.snapshot_id === assessment.to_snapshot_id);
  const target = bundle.snapshots[index], previous = bundle.snapshots[index - 1];
  if (!previous || assessment.from_snapshot_id !== previous.snapshot_id || index !== bundle.snapshots.length - 1) fail('history_missing', 'snapshots');
  if (typeof assessment.disputed !== 'boolean') fail('classification_missing', 'disputed');
  const evidence = new Map(bundle.evidence.map((e) => [e.evidence_id, e]));
  const refs = (ids, f) => {
    if (!strings(ids, true)) { fail('evidence_missing', f); return; }
    for (const id of ids) if (!evidence.has(id) || evidence.get(id).snapshot_id !== assessment.to_snapshot_id) fail('evidence_snapshot_mismatch', f);
  };
  refs(assessment.evidence_ids, 'evidence_ids');
  const approval = bundle.judgments.find((j) => j.receipt_id === assessment.correctness_receipt_id);
  if (bundle.snapshots.some((s) => s.implementer_context_id === assessment.assessor_context_id)) fail('self_review', 'assessor_context_id');
  // Always a fresh direct repair judgment. Prior correctness cannot sign impact.
  if (!target || !approval || approval.kind !== 'direct' || approval.lens !== 'correctness'
    || approval.snapshot_id !== target.snapshot_id || approval.verdict !== 'pass'
    || approval.reviewer_context_id !== assessment.assessor_context_id
    || !target.required_claims.correctness.every((id) => approval.claim_ids.includes(id))
    || bundle.findings.some((f) => target.required_claims.correctness.includes(f.claim_id) && f.status !== 'resolved')) fail('fresh_correctness_required', 'correctness_receipt_id');
  const cited = [];
  const cite = (ids, f) => { refs(ids, f); if (Array.isArray(ids)) cited.push(...ids); };
  cite(assessment.evidence_ids, 'evidence_ids');
  if (!Array.isArray(assessment.changes) || !assessment.changes.length) fail('classification_missing', 'changes');
  else {
    const identities = new Set();
    for (const c of assessment.changes) {
      if (!object(c) || !text(c.identity)) { fail('classification_missing', 'changes'); continue; }
      if (identities.has(c.identity)) fail('duplicate_id', 'changes'); identities.add(c.identity);
      if (!KINDS.includes(c.kind) || !strings(c.roles) || c.roles.some((r) => !ROLES.includes(r))
        || !text(c.explanation) || ['behavioral', 'removed_or_weakened', 'isolated', 'additive'].some((f) => typeof c[f] !== 'boolean')) fail('classification_missing', c.identity);
      cite(c.evidence_ids, `changes.${c.identity}.evidence_ids`);
    }
  }
  const discovery = assessment.discovery;
  if (!object(discovery) || typeof discovery.complete !== 'boolean' || !strings(discovery.before) || !strings(discovery.after) || !Array.isArray(discovery.consumers)) fail('discovery_missing', 'discovery');
  else {
    cite(discovery.evidence_ids, 'discovery.evidence_ids');
    const dependencies = new Set();
    for (const entry of discovery.consumers) {
      if (!object(entry) || !object(entry.dependency) || !text(entry.dependency.kind) || !text(entry.dependency.identity) || !strings(entry.consumer_ids)) { fail('consumers_incomplete', 'discovery.consumers'); continue; }
      const id = key(entry.dependency);
      if (dependencies.has(id)) fail('duplicate_id', 'discovery.consumers'); dependencies.add(id);
      if (entry.consumer_ids.some((c) => !discovery.after.includes(c))) fail('consumers_incomplete', 'discovery.consumers');
    }
  }
  if (!Array.isArray(assessment.retention)) fail('retention_missing', 'retention');
  else {
    const claims = new Set();
    for (const proof of assessment.retention) {
      if (!object(proof) || !text(proof.claim_id)) { fail('retention_missing', 'retention'); continue; }
      if (claims.has(proof.claim_id)) fail('duplicate_id', 'retention'); claims.add(proof.claim_id);
      if (!bundle.claims.some((c) => c.claim_id === proof.claim_id)) fail('reference_missing', proof.claim_id);
      if (typeof proof.unchanged !== 'boolean' || !strings(proof.assumptions, true) || !text(proof.explanation) || !strings(proof.consumer_ids)
        || !Array.isArray(proof.dependencies) || !proof.dependencies.length) fail('retention_missing', proof.claim_id);
      cite(proof.evidence_ids, `retention.${proof.claim_id}.evidence_ids`);
      if (Array.isArray(proof.dependencies)) for (const dep of proof.dependencies) {
        if (!object(dep) || !text(dep.kind) || !text(dep.identity) || !/^[0-9a-f]{64}$/.test(typeof dep.from_digest === 'string' ? dep.from_digest : '')
          || !/^[0-9a-f]{64}$/.test(typeof dep.to_digest === 'string' ? dep.to_digest : '')) fail('dependencies_missing', proof.claim_id);
        else cite(dep.evidence_ids, `retention.${proof.claim_id}.dependencies`);
      }
    }
  }
  if (approval && approval.impact_assessment_digest !== digest(assessment)) fail('impact_signature_mismatch', 'correctness_receipt_id');
  if (bundle.judgments.some((j) => j.receipt_id !== assessment.correctness_receipt_id && j.reviewer_context_id === assessment.assessor_context_id)) fail('impact_context_not_fresh', 'assessor_context_id');
  if (approval && cited.some((id) => !approval.evidence_ids.includes(id))) fail('impact_evidence_unsigned', 'correctness_receipt_id');
  return { ok: !errors.length, errors };
}

function deriveReviewPlan(input) {
  const refuse = (codes) => ({ ok: false, action: 'refuse', lenses: [], retained: [], invalidations: codes.map((code) => ({ code })) });
  if (!isPlainReviewJson(input) || !object(input)) return refuse(['non_json']);
  const { bundle, assessment, currentSnapshot } = input;
  const checked = validateImpactAssessment(assessment, bundle);
  if (!checked.ok) return refuse([...new Set(checked.errors.map((e) => e.code))]);
  const target = bundle.snapshots.at(-1), previous = bundle.snapshots.at(-2);
  if (!object(currentSnapshot) || !equal(currentSnapshot, target)) return refuse(['snapshot_mismatch']);
  const invalidations = [];
  const invalidate = (code, lens) => invalidations.push(lens ? { code, lens } : { code });
  const full = () => ({ ok: true, action: 'full-review', lenses: LENSES.map((lens) => ({ lens, scope: 'full' })), retained: [], invalidations });
  for (const f of ['base_sha', 'merge_base_sha', 'contract_digest', 'policy_digest']) if (previous[f] !== target[f]) invalidate(`${f}_changed`);
  const before = previous.review_inputs, after = target.review_inputs;
  if (!object(before) || !object(after) || ['release_title', 'ci_skip_text', 'caller_digest', 'schema_digest'].some((f) => typeof before[f] !== 'string' || typeof after[f] !== 'string')
    || !text(before.release_title) || !text(after.release_title)
    || ['caller_digest', 'schema_digest'].some((f) => !/^[0-9a-f]{64}$/.test(before[f]) || !/^[0-9a-f]{64}$/.test(after[f])) || !strings(before.scanned_subjects) || !strings(after.scanned_subjects)) invalidate('review_inputs_missing');
  else {
    for (const f of ['release_title', 'ci_skip_text', 'caller_digest', 'schema_digest']) if (before[f] !== after[f]) invalidate(`${f}_changed`);
    if (!equal([...before.scanned_subjects].sort(), [...assessment.discovery.before].sort()) || !equal([...after.scanned_subjects].sort(), [...assessment.discovery.after].sort())) invalidate('discovery_mismatch');
  }
  // Read actual HEAD subjects, not caller summaries. A body/comment or SHA
  // repair can preserve a title; changed release subjects always invalidate.
  const headTitle = (s) => s.messages.find((m) => m.sha === s.head_sha).message.split(/\r?\n/, 1)[0];
  if (headTitle(previous) !== headTitle(target)) invalidate('release_title_changed');
  if (before && after && (before.release_title !== headTitle(previous) || after.release_title !== headTitle(target))) invalidate('release_title_mismatch');
  // Bind controls to each actual message identity. Aggregate token counts could
  // hide moving a control between commits. Conservatively recognize trailers
  // even without GitHub's two empty lines or terminal trailer placement; we
  // cannot establish those ambiguous forms as harmless. Both skip-checks:true
  // and skip-checks: true are covered, as are removals/value/spacing changes.
  const messageControls = (s, pattern) => s.messages.flatMap((m) => {
    const controls = m.message.match(pattern) || [];
    return controls.length ? [{ sha: m.sha, is_head: m.sha === s.head_sha, controls }] : [];
  });
  const ciPattern = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|\bskip-checks[ \t]*:[^\r\n]*/gi;
  if (!equal(messageControls(previous, ciPattern), messageControls(target, ciPattern))) invalidate('ci_skip_text_changed');
  const releasePattern = /\bbreaking(?:-|[ \t]+)change[ \t]*:[^\r\n]*|^[a-z][\w-]*(?:\([^\r\n)]*\))?![ \t]*:[^\r\n]*/gmi;
  if (!equal(messageControls(previous, releasePattern), messageControls(target, releasePattern))) invalidate('release_message_control_changed');
  if (assessment.disputed) invalidate('classification_disputed');
  if (!assessment.discovery.complete) invalidate('consumers_incomplete');
  if (!equal([...assessment.discovery.before].sort(), [...assessment.discovery.after].sort())) invalidate('new_scanned_subjects');
  if (assessment.changes.some((c) => c.kind === 'unknown')) invalidate('impact_unknown');
  if (assessment.changes.some((c) => c.kind !== 'message' && !assessment.discovery.after.includes(c.identity))) invalidate('changed_subject_missing');
  if (invalidations.length) return full();
  const priorReviewers = new Map();
  for (const j of bundle.judgments.filter((v) => v.snapshot_id === previous.snapshot_id)) {
    if (priorReviewers.has(j.reviewer_context_id) && priorReviewers.get(j.reviewer_context_id) !== j.lens) invalidate('reviewer_context_reused');
    priorReviewers.set(j.reviewer_context_id, j.lens);
  }
  if (invalidations.length) return full();
  const prose = assessment.changes.every((c) => ['prose', 'message'].includes(c.kind) && !c.behavioral && !c.roles.length && !c.removed_or_weakened);
  const tests = assessment.changes.every((c) => (['prose', 'message'].includes(c.kind) && !c.behavioral && !c.roles.length && !c.removed_or_weakened)
    || (c.kind === 'test' && !c.behavioral && c.isolated && c.additive && !c.removed_or_weakened && c.roles.every((r) => r === 'assertion')));
  if (!prose && !tests) invalidate('behavioral_closure_changed');
  const requiredFresh = prose ? ['correctness'] : tests ? ['correctness', 'test-adequacy'] : [...LENSES];
  const lenses = [], retained = [];
  for (const lens of LENSES) {
    const candidates = bundle.judgments.filter((j) => j.snapshot_id === previous.snapshot_id && j.lens === lens);
    const passing = candidates.filter((j) => j.verdict === 'pass');
    const claimIds = previous.required_claims[lens];
    const covered = claimIds.every((id) => passing.some((j) => j.claim_ids.includes(id)));
    const unresolved = bundle.findings.some((f) => claimIds.includes(f.claim_id) && f.status === 'unresolved');
    // A later refutation defeats an earlier pass; never treat stale partial
    // coverage as a passed cumulative lens.
    const passed = covered && !unresolved && !candidates.some((j) => j.verdict === 'refute');
    if (!passed) { lenses.push({ lens, scope: 'full' }); invalidate('lens_unpassed', lens); continue; }
    if (requiredFresh.includes(lens)) { lenses.push({ lens, scope: 'delta' }); continue; }
    let retainable = equal(previous.required_claims[lens], target.required_claims[lens]);
    for (const id of claimIds) {
      const claim = bundle.claims.find((c) => c.claim_id === id), proof = assessment.retention.find((p) => p.claim_id === id);
      if (!proof || !proof.unchanged || !proof.assumptions.length || proof.dependencies.length !== claim.dependencies.length) { retainable = false; continue; }
      const dependencyKeys = new Set(proof.dependencies.map(key));
      if (dependencyKeys.size !== claim.dependencies.length) retainable = false;
      const consumers = new Set();
      for (const dep of claim.dependencies) {
        const identity = key(dep), bound = proof.dependencies.find((d) => key(d) === identity);
        const discovery = assessment.discovery.consumers.find((d) => key(d.dependency) === identity);
        if (!bound || bound.from_digest !== dep.digest || bound.to_digest !== dep.digest || !discovery) retainable = false;
        if (discovery) discovery.consumer_ids.forEach((c) => consumers.add(c));
        if (assessment.changes.some((c) => c.identity === dep.identity || (discovery && discovery.consumer_ids.includes(c.identity)))) retainable = false;
      }
      if (!equal([...consumers].sort(), [...proof.consumer_ids].sort())) retainable = false;
    }
    if (!retainable) { lenses.push({ lens, scope: 'full' }); invalidate('retention_unproven', lens); }
    else retained.push({ lens, receipt_ids: passing.map((j) => j.receipt_id), claim_ids: [...claimIds] });
  }
  return { ok: true, action: retained.length ? 'scoped-review' : 'full-review', lenses, retained, invalidations };
}
module.exports = { validateImpactAssessment, deriveReviewPlan };
