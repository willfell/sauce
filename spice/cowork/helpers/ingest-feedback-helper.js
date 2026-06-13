"use strict";
// platform/blueprints/cowork/helpers/ingest-feedback-helper.js
//
// v0.99.0/v0.101.0 — Engagement gate + schema 4/5 + kind-prefix + per-cadence satisfaction primitives.
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
//   normalizeLearnedWeightsV4(raw) — wraps V3; migration: zero skips, force
//     warmup, init engaged_days[] + satisfaction[], retire warmup_until.
//   normalizeLearnedWeightsV5(raw) — wraps V4; purely additive: satisfaction
//     entries gain cadence (pre-5 default "eod-review"); already-5 input is
//     guarded from re-entering V4's silence-reset migration.
//   validateIntents(intents, free_text) — allowlist + verbatim-quote gate;
//     returns { accepted, rejected, pending }.
//   composeAuditEntry({ day, run_id, lines }) — feedback-deltas.md section.
//   classifyEngagementDay({ notes }) — "engaged" | "tap_only" | "silent".
//   parseKindPrefixLines(free_text, kinds) — deterministic section scoping.
//   appendSatisfaction(totals, day, useful, opts?) — per-cadence sat series
//     (30-day window, 200-entry cap; same-(day, cadence) overwrites).
//   applyIntentKindObservations(kind_observations, accepted_intents) — uprank
//     prose = kind tick; kind-scoped downrank (no entity) = kind skip;
//     contradictions no-op; modify-only.
//   dedupIntents(intents) — weight intents (uprank/downrank/frequency) apply
//     once per (intent, kind, entity); duplicates reported in deduped[].

const { _clamp, _round } = require("./learn-from-checks-helper.js");
const { FREE_TEXT_PLACEHOLDERS } = require("./compose-feedback-capture-helper.js");

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
  "uprank", "downrank", "voice_correction", "coverage_gap", "frequency",
  "satisfaction",   // v0.101.0 — global sentiment; no kind; feeds satisfaction-series
  "other",
]);
const TARGET_RX = /^(learned_weights|microscope:[a-z][a-z_-]*|voice-proposals|coverage-queue|satisfaction-series)$/;

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

// v0.99.0 — schema 4: engagement-gated semantics. Wraps the V3 shape
// normalizer, then (one-time, gated on Number(schema_version) !== 4) applies
// the silence-reset migration: keep weight + ticks (real signal), ZERO skips
// (silence-contaminated), force warmup true (re-graduate on engaged days
// only). totals gain engaged_days[] + satisfaction[]; warmup_until retired
// (null) — graduation is engaged-day-count driven (evaluateWarmup arg 2).
function normalizeLearnedWeightsV4(raw) {
  const priorVersion = raw && typeof raw === "object" ? raw.schema_version : undefined;
  const v3 = normalizeLearnedWeightsV3(raw);
  const isMigration = Number(priorVersion) !== 4;
  const out = { schema_version: 4, engagements: {} };
  for (const [eid, eng] of Object.entries(v3.engagements)) {
    const per_kind = JSON.parse(JSON.stringify(eng.per_kind || {}));
    if (isMigration) {
      for (const kind of Object.keys(per_kind)) {
        per_kind[kind].skips = 0;
        per_kind[kind].warmup = true;
      }
    }
    const totals = JSON.parse(JSON.stringify(eng.totals || {}));
    if (!Array.isArray(totals.engaged_days)) totals.engaged_days = [];
    if (!Array.isArray(totals.satisfaction)) totals.satisfaction = [];
    totals.warmup_until = null;
    out.engagements[eid] = Object.assign({}, eng, { per_kind, totals });
  }
  return out;
}

// v0.101.0 — schema 5: per-cadence satisfaction. PURELY ADDITIVE on top of
// schema 4 — entries gain `cadence` (pre-5 entries default "eod-review", the
// only cadence that had a tap); NOTHING else changes (no skip-zeroing, no
// warmup reset, graduation untouched).
function normalizeLearnedWeightsV5(raw) {
  const priorVersion = raw && typeof raw === "object" ? raw.schema_version : undefined;
  // Already-5 input must NOT re-enter V4's silence-reset: V4's migration gate
  // is `Number(prior) !== 4`, so a literal 5 would re-zero skips (destructive
  // — v0.99.0 lesson 2 class). Stamp a deep COPY to 4 so V4 runs its
  // shape-normalize path only.
  const v4input = Number(priorVersion) === 5
    ? Object.assign(JSON.parse(JSON.stringify(raw)), { schema_version: 4 })
    : raw;
  const v4 = normalizeLearnedWeightsV4(v4input);
  const out = { schema_version: 5, engagements: {} };
  for (const [eid, eng] of Object.entries(v4.engagements)) {
    const totals = JSON.parse(JSON.stringify(eng.totals || {}));
    totals.satisfaction = (Array.isArray(totals.satisfaction) ? totals.satisfaction : [])
      .filter((e) => e && typeof e === "object" && e.day)
      .map((e) => (e.cadence ? e : Object.assign({}, e, { cadence: "eod-review" })));
    out.engagements[eid] = Object.assign({}, eng, { totals });
  }
  return out;
}

// v0.99.0 — engagement gate. A day contributes observations ONLY when the
// user demonstrably engaged. Input: notes[] of { rating, feedback } where
// rating = parseRatingCallout(md) | null and feedback = parseFeedbackCapture(md)
// (sentinel_version null when the note carries no capture sentinel).
// Returns "engaged" | "tap_only" | "silent".
function classifyEngagementDay(opts) {
  const o = opts || {};
  let engaged = false;
  let tapped = false;
  for (const note of (Array.isArray(o.notes) ? o.notes : [])) {
    const r = note && note.rating;
    const f = note && note.feedback;
    if (r && Array.isArray(r.observations) && r.observations.some((x) => x && x.ticked)) {
      engaged = true;
    }
    if (f && f.sentinel_version) {
      const anyTick = Object.values(f.ticks || {}).some(Boolean)
        || Object.values(f.downvotes || {}).some(Boolean);
      // "ambiguous" = user physically ticked 2+ boxes — that IS engagement.
      const anyKnob = Object.values(f.knobs || {}).some(
        (p) => p === "less" || p === "more" || p === "ambiguous");
      const text = typeof f.free_text === "string" ? f.free_text.trim() : "";
      const prose = text.length > 0 && !FREE_TEXT_PLACEHOLDERS.includes(text);
      if (anyTick || anyKnob || prose) engaged = true;
      if (f.satisfaction === true || f.satisfaction === false) tapped = true;
    }
  }
  return engaged ? "engaged" : (tapped ? "tap_only" : "silent");
}

// v0.99.0 — deterministic section scoping for prose. A line whose prefix
// case-insensitively matches a known kind is pre-bound to that kind BEFORE
// LLM intent extraction (the LLM classifies intent but cannot re-scope the
// kind). Everything else returns in `remainder` for the unmodified Step 3.6.
function parseKindPrefixLines(free_text, kinds) {
  const known = new Set((Array.isArray(kinds) ? kinds : []).map((k) => String(k).toLowerCase()));
  const scoped = [];
  const remainder = [];
  for (const line of String(free_text || "").split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s+(.+)$/);
    if (m && known.has(m[1].toLowerCase())) {
      scoped.push({ kind: m[1].toLowerCase(), text: m[2].trim(), line: line.trim() });
    } else if (line.trim()) {
      remainder.push(line);
    }
  }
  return { scoped, remainder: remainder.join("\n") };
}

// v0.101.0 — per-cadence satisfaction series (schema 5). Entries are
// { day, cadence, useful }; same-(day, cadence) re-log overwrites; window
// trims by DAY (default 30 days relative to the appended day; lexicographic
// YYYY-MM-DD compare), with a 200-entry belt-and-suspenders cap. Boolean-only
// (ambiguous dual-taps / no-taps are no-ops). cadence defaults to
// "eod-review" (the only cadence that tapped before v0.101.0).
function appendSatisfaction(totals, day, useful, opts) {
  const cap = (opts && opts.cap) || 200;
  const windowDays = (opts && opts.window_days) || 30;
  const cadence = (opts && opts.cadence) || "eod-review";
  const next = JSON.parse(JSON.stringify(totals || {}));
  if (!Array.isArray(next.satisfaction)) next.satisfaction = [];
  if (typeof useful !== "boolean") return next;
  const cutoff = new Date(new Date(`${day}T00:00:00Z`).getTime() - windowDays * 86400000)
    .toISOString().slice(0, 10);
  next.satisfaction = next.satisfaction.filter((e) =>
    e && e.day
    && !(e.day === day && (e.cadence || "eod-review") === cadence)
    && e.day >= cutoff);
  next.satisfaction.push({ day, cadence, useful });
  if (next.satisfaction.length > cap) next.satisfaction = next.satisfaction.slice(-cap);
  return next;
}

// v0.101.0 — kind-scoped prose drives kind observations symmetrically:
// uprank → that kind's tick; downrank WITHOUT a named entity → that kind's
// skip (an entity complaint must not skip the whole kind). Contradictory
// uprank+downrank on the same kind → no-op. Modify-only — never appends
// observations for unsurfaced kinds (their signal flows via the 8f
// kind-delta channel instead). Accepted + deduped intents only.
function applyIntentKindObservations(kind_observations, accepted_intents) {
  const intents = Array.isArray(accepted_intents) ? accepted_intents : [];
  const upranked = new Set(intents
    .filter((i) => i && i.intent === "uprank" && i.kind)
    .map((i) => String(i.kind).toLowerCase()));
  const downranked = new Set(intents
    .filter((i) => i && i.intent === "downrank" && i.kind && !i.entity)
    .map((i) => String(i.kind).toLowerCase()));
  return (Array.isArray(kind_observations) ? kind_observations : []).map((o) => {
    if (!o) return o;
    const k = String(o.kind).toLowerCase();
    const up = upranked.has(k);
    const down = downranked.has(k);
    if (up && down) return o;
    if (up) return Object.assign({}, o, { ticked: true });
    if (down) return Object.assign({}, o, { ticked: false });
    return o;
  });
}

// v0.101.0 — with five typing boxes per day, the same weight-moving complaint
// can arrive from multiple notes. Weight-channel intents (uprank / downrank /
// frequency) apply at most once per (intent, kind, entity) per reconciler run
// (= per day); duplicates are returned in `deduped` for [pending] audit
// logging. Non-weight intents (voice_correction, coverage_gap, satisfaction,
// other) pass through untouched — two distinct voice corrections are two
// proposals, and satisfaction same-cadence collisions are handled by
// appendSatisfaction's same-(day, cadence) overwrite.
const WEIGHT_INTENTS = Object.freeze(new Set(["uprank", "downrank", "frequency"]));
function dedupIntents(intents) {
  const applied = [];
  const deduped = [];
  const seen = new Set();
  for (const intent of (Array.isArray(intents) ? intents : [])) {
    if (!intent || typeof intent !== "object") continue;
    if (!WEIGHT_INTENTS.has(intent.intent)) { applied.push(intent); continue; }
    const key = [intent.intent, String(intent.kind || "").toLowerCase(), String(intent.entity || "").toLowerCase()].join("|");
    if (seen.has(key)) deduped.push(intent);
    else { seen.add(key); applied.push(intent); }
  }
  return { applied, deduped };
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
    if (intent.intent === "satisfaction" && typeof intent.useful !== "boolean") {
      result.rejected.push({ intent, reason: "satisfaction-requires-useful-boolean" });
      continue;
    }
    if (String(intent.proposed_target) === "satisfaction-series" && intent.intent !== "satisfaction") {
      result.rejected.push({ intent, reason: "satisfaction-series-target-requires-satisfaction-intent" });
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
  normalizeLearnedWeightsV4,
  normalizeLearnedWeightsV5,
  validateIntents,
  composeAuditEntry,
  classifyEngagementDay,
  parseKindPrefixLines,
  appendSatisfaction,
  applyIntentKindObservations,
  dedupIntents,
  _classifyEntity,
};
