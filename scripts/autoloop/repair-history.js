'use strict';

const { isDeepStrictEqual } = require('util');

// Pure event contract. The coordinator supplies server time and persists the
// returned value; this module has no filesystem, clock, lease or retry policy.
const VERSION = '1.0.0';
const LATEST_EVENT_CAP = 20;
const SHA = /^[0-9a-f]{40}$/;
const KINDS = new Set([
  'activity_started', 'review_completed', 'repair_recorded', 'infra_retry',
  'reassessment_required', 'reassessment_recorded', 'successor_linked', 'deployed',
]);
// Reserved for scoped repeat review. These are provenance, never approvals.
const EXTENSION_KINDS = new Set(['impact_assessed', 'judgment_retained', 'judgment_invalidated', 'evidence_reused', 'finding_resolved', 'authorization_composed']);
const LENSES = new Set(['correctness', 'regression-risk', 'test-adequacy']);
const CAUSES = new Set(['infrastructure', 'product', 'mixed', 'unknown']);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z');

// A readable, collision-free binding, including an explicitly unknown legacy
// base. A change to either operand creates a different review snapshot.
function snapshotId(headSha, baseSha) {
  return `${headSha}:${baseSha === null ? 'unknown' : baseSha}`;
}

// Reject values JSON persistence would silently drop/change, as well as cycles.
function jsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  if (Array.isArray(value) && (Object.keys(value).length !== value.length
    || Object.keys(value).some((key, index) => key !== String(index)))) return false;
  ancestors.add(value);
  const valid = Object.keys(value).every((key) => !['__proto__', 'constructor', 'prototype'].includes(key)
    && jsonValue(value[key], ancestors));
  ancestors.delete(value);
  return valid;
}

function validateRepairHistory(history) {
  const errors = [];
  const fail = (code, field, message) => errors.push({ code, field, message });
  if (!object(history) || !jsonValue(history)) {
    fail('history_shape_invalid', 'history', 'history must be a plain JSON object');
    return { ok: false, errors };
  }
  if (history.schema_version !== VERSION) fail('history_version_unsupported', 'schema_version', `expected ${VERSION}`);
  if (!text(history.lineage_id)) fail('lineage_id_invalid', 'lineage_id', 'lineage identity is required');
  if ('history_complete' in history && typeof history.history_complete !== 'boolean') fail('history_complete_invalid', 'history_complete', 'expected boolean');
  if (!Array.isArray(history.events)) {
    fail('events_invalid', 'events', 'ordered events array is required');
    return { ok: false, errors };
  }
  const ids = new Set();
  let previousAt = -Infinity;
  history.events.forEach((event, index) => {
    const field = `events[${index}]`;
    if (!object(event)) { fail('event_shape_invalid', field, 'expected event object'); return; }
    if (event.schema_version !== VERSION) fail('event_version_unsupported', `${field}.schema_version`, `expected ${VERSION}`);
    for (const name of ['event_id', 'card', 'summary', 'reason']) {
      if (!text(event[name])) fail('event_field_invalid', `${field}.${name}`, 'nonempty string is required');
    }
    if (ids.has(event.event_id)) fail('event_id_conflict', `${field}.event_id`, 'event identity already exists');
    ids.add(event.event_id);
    if (event.sequence !== index + 1) fail('event_sequence_invalid', `${field}.sequence`, 'sequence must be contiguous and start at one');
    // Extensions are stored but never interpreted as review/approval evidence.
    if (!KINDS.has(event.kind) && !EXTENSION_KINDS.has(event.kind) && !(typeof event.kind === 'string' && /^extension:[a-z][a-z0-9_]*$/.test(event.kind))) {
      fail('event_kind_unsupported', `${field}.kind`, 'unsupported event kind');
    }
    if (!iso(event.at)) fail('event_time_invalid', `${field}.at`, 'server time must be a valid UTC ISO timestamp');
    else if (Date.parse(event.at) < previousAt) fail('event_time_reordered', `${field}.at`, 'server time cannot move backwards');
    else previousAt = Date.parse(event.at);
    if (typeof event.head_sha !== 'string' || !SHA.test(event.head_sha)) fail('event_head_invalid', `${field}.head_sha`, 'expected exact lowercase 40-hex SHA');
    if (event.base_sha !== null && (typeof event.base_sha !== 'string' || !SHA.test(event.base_sha))) fail('event_base_invalid', `${field}.base_sha`, 'expected exact lowercase 40-hex SHA or unknown legacy base null');
    if (event.snapshot_id !== snapshotId(event.head_sha, event.base_sha)) fail('snapshot_binding_invalid', `${field}.snapshot_id`, 'snapshot must bind exact HEAD and base');
    if (!Array.isArray(event.evidence_refs) || event.evidence_refs.length === 0
      || event.evidence_refs.some((ref) => !object(ref) || !text(ref.source_identity) || !text(ref.locator))) {
      fail('evidence_identity_missing', `${field}.evidence_refs`, 'at least one source identity and locator is required');
    }
    if (event.kind === 'review_completed' || 'lens' in event) {
      if (!LENSES.has(event.lens)) fail('review_lens_invalid', `${field}.lens`, 'expected required review lens');
    }
    if (event.kind === 'review_completed' || 'verdict' in event) {
      if (!['pass', 'refute'].includes(event.verdict)) fail('review_verdict_invalid', `${field}.verdict`, 'expected pass or refute');
    }
    for (const name of ['finding_id', 'repair_id']) {
      if (name in event && !text(event[name])) fail('event_field_invalid', `${field}.${name}`, 'nonempty string is required');
    }
    if ('response' in event && !object(event.response)) fail('event_response_invalid', `${field}.response`, 'expected response object');
    if (event.kind === 'infra_retry' && (!object(event.response) || !CAUSES.has(event.response.cause))) {
      fail('retry_cause_invalid', `${field}.response.cause`, 'explicit infrastructure, product, mixed or unknown cause is required');
    }
  });
  return { ok: errors.length === 0, errors };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
function appendRepairEvent(history, event) {
  const prior = validateRepairHistory(history);
  if (!prior.ok) return { ok: false, code: 'repair_history_invalid', errors: prior.errors };
  if (!object(event) || !jsonValue(event)) return { ok: false, code: 'repair_event_invalid', errors: [{ code: 'event_shape_invalid', field: 'event', message: 'expected plain JSON event' }] };
  const existing = history.events.find((item) => item.event_id === event.event_id);
  if (existing) {
    // Literal replay preserves even the prior object's key order and bytes.
    if (isDeepStrictEqual(clone(existing), clone(event))) return { history, no_op: true };
    return { ok: false, code: 'event_id_conflict', errors: [{ code: 'event_id_conflict', field: 'event_id', message: 'event identity reused with different operands' }] };
  }
  const next = { ...history, events: [...history.events, event] };
  const validated = validateRepairHistory(next);
  if (!validated.ok) return { ok: false, code: 'repair_event_invalid', errors: validated.errors };
  return { history: clone(next), no_op: false };
}

function deriveRepairSummary(history, nowIso) {
  if (!iso(nowIso)) return { ok: false, code: 'summary_time_invalid', errors: [{ code: 'summary_time_invalid', field: 'nowIso', message: 'expected valid UTC ISO time' }] };
  // Absence/legacy maps supply no immutable observations. Do not reconstruct
  // overwritten receipts, old rounds, or timestamps from mutable legacy data.
  if (history != null && !object(history)) return { ok: false, code: 'repair_history_invalid', errors: [{ code: 'history_shape_invalid', field: 'history', message: 'expected history object or absent legacy history' }] };
  const legacy = history == null || history.schema_version === undefined;
  if (!legacy) {
    const validated = validateRepairHistory(history);
    if (!validated.ok) return { ok: false, code: 'repair_history_invalid', errors: validated.errors };
  }
  const events = legacy ? [] : history.events;
  if (events.length && Date.parse(nowIso) < Date.parse(events[events.length - 1].at)) return { ok: false, code: 'summary_time_before_history', errors: [{ code: 'summary_time_before_history', field: 'nowIso', message: 'observation time precedes recorded server time' }] };
  const failed = new Map();
  const retryCauses = { infrastructure: 0, product: 0, mixed: 0, unknown: 0 };
  let reassessment = { state: 'none', required_at: null, recorded_at: null, event_id: null };
  let reassessedSequence = 0;
  let lastProgress = null;
  let latestActivity = null;
  for (const event of events) {
    if (event.kind === 'review_completed' && event.verdict === 'refute' && !failed.has(event.snapshot_id)) failed.set(event.snapshot_id, event.sequence);
    if (event.kind === 'infra_retry') retryCauses[event.response.cause]++;
    if (event.kind === 'reassessment_required') reassessment = { ...reassessment, state: 'required', required_at: event.at, event_id: event.event_id };
    if (event.kind === 'reassessment_recorded') {
      reassessedSequence = event.sequence;
      reassessment = { ...reassessment, state: 'recorded', recorded_at: event.at, event_id: event.event_id };
    }
    // Retry attempts/start markers are activity, not proof of forward progress.
    // Unknown extensions cannot reset freshness or satisfy any lifecycle gate.
    if (KINDS.has(event.kind)) latestActivity = event;
    if (['review_completed', 'repair_recorded', 'reassessment_recorded', 'successor_linked', 'deployed'].includes(event.kind)) lastProgress = event.at;
  }
  const activityAt = latestActivity ? latestActivity.at : null;
  const age = activityAt === null ? null : Math.max(0, (Date.parse(nowIso) - Date.parse(activityAt)) / 1000);
  return {
    lineage_id: history && text(history.lineage_id) ? history.lineage_id : null,
    history_complete: !legacy && history.history_complete !== false && events.every((event) => event.base_sha !== null),
    activity: { kind: latestActivity ? latestActivity.kind : 'unknown', card: latestActivity ? latestActivity.card : null, at: activityAt, age_seconds: age, retry_causes: retryCauses },
    last_progress_at: lastProgress,
    failed_rounds_total: failed.size,
    failed_rounds_since_reassessment: [...failed.values()].filter((sequence) => sequence > reassessedSequence).length,
    infra_retries: retryCauses.infrastructure,
    reassessment_state: reassessment,
    latest_events: clone(events.slice(-LATEST_EVENT_CAP).reverse()),
    overflow_count: Math.max(0, events.length - LATEST_EVENT_CAP),
  };
}

module.exports = { VERSION, LATEST_EVENT_CAP, snapshotId, validateRepairHistory, appendRepairEvent, deriveRepairSummary };
