// platform/blueprints/cowork/helpers/ingest-feedback-helper.js
//
// v0.98.2 — Feedback-loop closure: the deterministic ingest core.
// Pure data — no MCP calls, no LLM, no I/O. The reconcile-cowork OI re-states
// this contract inline (the reconciler is pure-MCP at fire time per its
// v0.97.1 posture); this module is the testable reference implementation and
// the runtime implementation for any Node-capable session.
//
// Exports:
//   INGEST_DEFAULTS — entity-weight constants (deltas, decay, clamps).
//   rollupFeedback({ parsed, registry, ambiguous_items }) — per-item ticks /
//     downvotes → entity_deltas + kind_observations + knob_deltas.
//   applyEntityDeltas(per_kind, entity_deltas, opts?) — clamp + round + count.
//   applyKnobDeltas(per_kind, knob_deltas, opts?) — post-formula ±0.05, re-clamped.
//   applyDecay(per_kind, opts?) — entity weights decay TOWARD 1.00:
//     w' = 1.00 + (w − 1.00) × 0.995 (NOT w × 0.995). Kind weights untouched.
//   applyFloorSet(per_kind, { kind, entity_type, entity }, opts?) — hard 0.10.
//   normalizeLearnedWeightsV3(raw) — accepts schema 2 (int) / missing /
//     "1.1.0" (helper-era) / 3; returns nested schema-3 shape, additive.
//   validateIntents(intents, free_text) — allowlist + verbatim-quote gate;
//     returns { accepted, rejected, pending }.
//   composeAuditEntry({ day, run_id, lines }) — feedback-deltas.md section.

const { _clamp, _round } = require("./learn-from-checks-helper.js");

const INGEST_DEFAULTS = Object.freeze({
  mattered_delta: 0.05,
  downvote_delta: -0.10,
  knob_delta: 0.05,
  entity_decay: 0.995,          // toward 1.00: w' = 1 + (w-1)*decay
  clamp_min: 0.10,
  clamp_max: 3.00,
  floor_set: 0.10,
  entity_warmup_observations: 3, // advisory below this; consumed at OI layer
});

const ENTITY_TYPES = Object.freeze(["per_person", "per_channel", "per_topic"]);
const VALID_INTENTS = Object.freeze([
  "uprank", "downrank", "voice_correction", "coverage_gap", "frequency", "other",
]);
const TARGET_RX = /^(learned_weights|microscope:[a-z][a-z_-]*|voice-proposals|coverage-queue)$/;

// Deterministic identity classification from the sidecar registry entry.
// Rules (first match wins):
//   1. identifier `person:<name>`            → per_person, <name>
//   2. kind github/ado: strip `#N` / `:<id>` → per_topic, repo / project
//   3. kind chat, identifier `<chan>:<ts>`   → per_channel, <chan>
//   4. everything else                       → per_topic, label
function _classifyEntity(kind, identifier, label) {
  const id = String(identifier || "");
  if (id.startsWith("person:")) {
    return { entity_type: "per_person", entity: id.slice("person:".length) };
  }
  if (kind === "github" && id.includes("#")) {
    return { entity_type: "per_topic", entity: id.split("#")[0] };
  }
  if (kind === "ado" && id.includes(":")) {
    return { entity_type: "per_topic", entity: id.split(":")[0] };
  }
  if (kind === "chat" && id.includes(":")) {
    return { entity_type: "per_channel", entity: id.split(":")[0] };
  }
  return { entity_type: "per_topic", entity: String(label || id) };
}

function rollupFeedback(opts) {
  const o = opts || {};
  const parsed = o.parsed || {};
  const registry = Array.isArray(o.registry) ? o.registry : [];
  const ambiguous = new Set(Array.isArray(o.ambiguous_items) ? o.ambiguous_items : []);
  const cfg = Object.assign({}, INGEST_DEFAULTS, o.defaults || {});

  const byId = new Map();
  for (const entry of registry) {
    if (entry && entry.item_id) byId.set(entry.item_id, entry);
  }

  const entity_deltas = [];
  const matteredByKind = new Map();   // kind → count of mattered ticks
  const seenKinds = new Set();
  for (const entry of registry) {
    if (entry && entry.kind) seenKinds.add(entry.kind);
  }

  for (const [itemId, ticked] of Object.entries(parsed.ticks || {})) {
    if (!ticked || ambiguous.has(itemId)) continue;
    const entry = byId.get(itemId);
    if (!entry) continue;   // identity unrecoverable → kind signal only (below)
    matteredByKind.set(entry.kind, (matteredByKind.get(entry.kind) || 0) + 1);
    const cls = _classifyEntity(entry.kind, entry.identifier, entry.label);
    entity_deltas.push({
      kind: entry.kind, entity_type: cls.entity_type, entity: cls.entity,
      delta: cfg.mattered_delta,
      source: `mattered ^${itemId} "${entry.label}"`,
    });
  }
  for (const [itemId, downed] of Object.entries(parsed.downvotes || {})) {
    if (!downed || ambiguous.has(itemId)) continue;
    const entry = byId.get(itemId);
    if (!entry) continue;
    const cls = _classifyEntity(entry.kind, entry.identifier, entry.label);
    entity_deltas.push({
      kind: entry.kind, entity_type: cls.entity_type, entity: cls.entity,
      delta: cfg.downvote_delta,
      source: `didn't-like ^${itemId} "${entry.label}"`,
    });
  }

  // Kind-level mapping for the existing v0.96.0 formula:
  // ≥1 mattered tick in the kind → kind tick; else kind skip.
  const kind_observations = [...seenKinds].map((kind) => ({
    kind, ticked: (matteredByKind.get(kind) || 0) > 0,
  }));

  // Frequency knobs → direct post-formula deltas. "same"/absent/"ambiguous"
  // contribute nothing.
  const knob_deltas = [];
  for (const [kind, position] of Object.entries(parsed.knobs || {})) {
    if (position === "less") knob_deltas.push({ kind, position, delta: -cfg.knob_delta });
    else if (position === "more") knob_deltas.push({ kind, position, delta: cfg.knob_delta });
  }

  return { entity_deltas, kind_observations, knob_deltas };
}

function _ensureEntity(per_kind, kind, entity_type, entity) {
  if (!per_kind[kind]) per_kind[kind] = { weight: 1.00, ticks: 0, skips: 0, warmup: true };
  if (!per_kind[kind][entity_type]) per_kind[kind][entity_type] = {};
  if (!per_kind[kind][entity_type][entity]) {
    per_kind[kind][entity_type][entity] = { weight: 1.00, ticks: 0, downvotes: 0 };
  }
  return per_kind[kind][entity_type][entity];
}

function _today(opts) {
  return (opts && opts.today) || new Date().toISOString().slice(0, 10);
}

function applyEntityDeltas(per_kind, entity_deltas, opts) {
  const cfg = Object.assign({}, INGEST_DEFAULTS, opts || {});
  const next = JSON.parse(JSON.stringify(per_kind || {}));
  for (const d of (entity_deltas || [])) {
    if (!d || !d.kind || !ENTITY_TYPES.includes(d.entity_type) || !d.entity) continue;
    const e = _ensureEntity(next, d.kind, d.entity_type, d.entity);
    e.weight = _round(_clamp((e.weight || 1.00) + d.delta, cfg.clamp_min, cfg.clamp_max), 3);
    if (d.delta > 0) e.ticks = (e.ticks || 0) + 1;
    else e.downvotes = (e.downvotes || 0) + 1;
    e.last_updated = _today(opts);
  }
  return next;
}

function applyKnobDeltas(per_kind, knob_deltas, opts) {
  const cfg = Object.assign({}, INGEST_DEFAULTS, opts || {});
  const next = JSON.parse(JSON.stringify(per_kind || {}));
  for (const k of (knob_deltas || [])) {
    if (!k || !k.kind || !next[k.kind] || typeof k.delta !== "number") continue;
    const w = typeof next[k.kind].weight === "number" ? next[k.kind].weight : 1.00;
    next[k.kind].weight = _round(_clamp(w + k.delta, cfg.clamp_min, cfg.clamp_max), 3);
    next[k.kind].last_updated = _today(opts);
  }
  return next;
}

function applyDecay(per_kind, opts) {
  const cfg = Object.assign({}, INGEST_DEFAULTS, opts || {});
  const next = JSON.parse(JSON.stringify(per_kind || {}));
  for (const kind of Object.keys(next)) {
    for (const et of ENTITY_TYPES) {
      const entities = next[kind][et];
      if (!entities) continue;
      for (const name of Object.keys(entities)) {
        const w = typeof entities[name].weight === "number" ? entities[name].weight : 1.00;
        // Decay TOWARD 1.00 — w' = 1 + (w−1)×decay. NOT w×decay (which would
        // decay toward zero and erase upranks).
        entities[name].weight = _round(
          _clamp(1.00 + (w - 1.00) * cfg.entity_decay, cfg.clamp_min, cfg.clamp_max), 3);
      }
    }
  }
  return next;
}

function applyFloorSet(per_kind, target, opts) {
  const cfg = Object.assign({}, INGEST_DEFAULTS, opts || {});
  const next = JSON.parse(JSON.stringify(per_kind || {}));
  if (!target || !target.kind || !ENTITY_TYPES.includes(target.entity_type) || !target.entity) {
    return next;
  }
  const e = _ensureEntity(next, target.kind, target.entity_type, target.entity);
  e.weight = _round(cfg.floor_set, 3);
  e.floor_set = true;
  e.last_updated = _today(opts);
  return next;
}

function normalizeLearnedWeightsV3(raw) {
  const skeletonTotals = () => ({
    notes_scanned: 0, notes_with_any_tick: 0, scanned_days: [],
    feedback_ingested_days: [], warmup_until: null,
  });
  const out = { schema_version: 3, engagements: {} };
  if (!raw || typeof raw !== "object") return out;
  const engagements = raw.engagements || {};
  for (const [eid, eng] of Object.entries(engagements)) {
    const per_kind = JSON.parse(JSON.stringify((eng && eng.per_kind) || {}));
    for (const kind of Object.keys(per_kind)) {
      for (const et of ENTITY_TYPES) {
        if (!per_kind[kind][et] || typeof per_kind[kind][et] !== "object") {
          per_kind[kind][et] = {};
        }
      }
    }
    const totals = Object.assign(skeletonTotals(), (eng && eng.totals) || {});
    if (!Array.isArray(totals.feedback_ingested_days)) totals.feedback_ingested_days = [];
    out.engagements[eid] = Object.assign({}, eng, { per_kind, totals });
  }
  return out;
}

function validateIntents(intents, free_text) {
  const text = typeof free_text === "string" ? free_text : "";
  const result = { accepted: [], rejected: [], pending: [] };
  for (const intent of (Array.isArray(intents) ? intents : [])) {
    if (!intent || typeof intent !== "object") {
      result.rejected.push({ intent, reason: "not-an-object" });
      continue;
    }
    if (!VALID_INTENTS.includes(intent.intent)) {
      result.rejected.push({ intent, reason: `unknown-intent:${intent.intent}` });
      continue;
    }
    if (!intent.source_quote || !text.includes(intent.source_quote)) {
      result.rejected.push({ intent, reason: "source-quote-not-verbatim" });
      continue;
    }
    if (!TARGET_RX.test(String(intent.proposed_target || ""))) {
      result.rejected.push({ intent, reason: `target-outside-allowlist:${intent.proposed_target}` });
      continue;
    }
    if (["uprank", "downrank", "frequency"].includes(intent.intent) && !intent.kind) {
      result.rejected.push({ intent, reason: "weights-intent-requires-kind" });
      continue;
    }
    if (intent.intent === "other" || intent.confidence === "low") {
      result.pending.push(intent);
      continue;
    }
    result.accepted.push(intent);
  }
  return result;
}

function composeAuditEntry(opts) {
  const o = opts || {};
  const lines = Array.isArray(o.lines) ? o.lines : [];
  return [
    `## ${o.day} (run-id: ${o.run_id})`,
    ...lines.map((l) => `- ${l}`),
  ].join("\n") + "\n";
}

module.exports = {
  INGEST_DEFAULTS,
  ENTITY_TYPES,
  VALID_INTENTS,
  rollupFeedback,
  applyEntityDeltas,
  applyKnobDeltas,
  applyDecay,
  applyFloorSet,
  normalizeLearnedWeightsV3,
  validateIntents,
  composeAuditEntry,
  _classifyEntity,
};
