// platform/blueprints/cowork/helpers/learn-from-checks-helper.js
//
// Rail L per-kind preference learning. Pure data — no MCP calls, no LLM.
//
// Exports:
//   updateWeights(prev_per_kind, observations, opts?) — design §5.3 update
//     formula with decay=0.98, lr=0.15, smoothing=5, clamp=[0.10, 3.00].
//     Clamps pre-existing weights even with no observations.
//   evaluateWarmup(per_kind_state, days_since_first, opts?) — graduates
//     kinds out of warmup at days >= warmup_days AND ticks+skips >= warmup_observations.
//   parseRatingCallout(markdown) — extracts ticks from `> [!todo]+ Was today useful?`
//     block, gated on `<!-- cowork:rating-block ... -->` sentinel.
//   scanAtomicNotes({ dir, engagement_id?, since_day? }) — walks atomic-note
//     dir, cross-references .cowork.json sidecars (engagement_id filter when
//     provided), returns { observations, notes_scanned, notes_with_any_tick }.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = Object.freeze({
  decay: 0.98,
  lr: 0.15,
  smoothing: 5,
  clamp_min: 0.10,
  clamp_max: 3.00,
  warmup_days: 7,
  warmup_observations: 7,
  weight_deviation_threshold: 0.20,
  must_surface_backstop_days: 14,
});

const _clamp = (n, min, max) => Math.max(min, Math.min(max, n));
// Banker's rounding (round-half-to-even) at the given decimal place. The
// design hand-math (Docs/plans/2026-06-08-v0.96.0-cowork-rethought-1-design.md
// §5.3) treats `0.8205 → 0.820` — round-half-to-even reproduces that. JS's
// native Math.round(820.5) yields 821 instead.
const _round = (n, places = 3) => {
  const f = 10 ** places;
  const x = n * f;
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    return (floor % 2 === 0 ? floor : floor + 1) / f;
  }
  return Math.round(x) / f;
};

function updateWeights(prev_per_kind, observations, opts) {
  const cfg = Object.assign({}, DEFAULTS, opts || {});
  const next = {};

  // Carry forward any pre-existing per-kind state verbatim. We deliberately
  // do NOT pre-clamp the input weight — HC-L-5 (input 5.00, ticked, expects
  // exact 3.00) requires the formula to apply to the un-clamped value
  // (5.00*0.98 + 0.025 = 4.925) and only clamping post-formula yields 3.00.
  // A pre-clamp would have produced 3.00*0.98+0.025 = 2.965.
  for (const [kind, state] of Object.entries(prev_per_kind || {})) {
    next[kind] = Object.assign({}, state, {
      ticks: Number(state.ticks || 0),
      skips: Number(state.skips || 0),
      warmup: state.warmup === undefined ? true : !!state.warmup,
    });
  }

  // Group observations by kind.
  const counts = new Map();
  for (const obs of (observations || [])) {
    if (!obs || !obs.kind) continue;
    const c = counts.get(obs.kind) || { ticks: 0, skips: 0 };
    if (obs.ticked) c.ticks += 1;
    else c.skips += 1;
    counts.set(obs.kind, c);
  }

  // Apply update formula (design §5.3) per kind that has observations.
  const today = new Date().toISOString().slice(0, 10);
  for (const [kind, c] of counts) {
    const prev = next[kind] || { weight: 1.00, ticks: 0, skips: 0, warmup: true };
    const w_old = typeof prev.weight === "number" ? prev.weight : 1.00;
    const numerator = c.ticks - 0.5 * c.skips;
    const denominator = c.ticks + c.skips + cfg.smoothing;
    const w_raw = w_old * cfg.decay + cfg.lr * (numerator / denominator);
    const w_clamped = _clamp(w_raw, cfg.clamp_min, cfg.clamp_max);
    next[kind] = Object.assign({}, prev, {
      weight: _round(w_clamped, 3),
      ticks: (prev.ticks || 0) + c.ticks,
      skips: (prev.skips || 0) + c.skips,
      last_updated: today,
    });
  }

  return next;
}

function evaluateWarmup(per_kind_state, days_since_first, opts) {
  const cfg = Object.assign({}, DEFAULTS, opts || {});
  const out = {};
  for (const [kind, state] of Object.entries(per_kind_state || {})) {
    const observations = (state.ticks || 0) + (state.skips || 0);
    const graduate = state.warmup === true
      && days_since_first >= cfg.warmup_days
      && observations >= cfg.warmup_observations;
    out[kind] = Object.assign({}, state, {
      warmup: graduate ? false : (state.warmup === undefined ? true : !!state.warmup),
    });
  }
  return out;
}

// Sentinel comment may live inside a callout (prefixed `> `) or as a bare HTML
// comment line. Match it anywhere in the markdown.
const RATING_SENTINEL_RX = /<!--\s*cowork:rating-block\s+schema=([\d.]+)\s+cadence=([\w-]+)\s+day=(\d{4}-\d{2}-\d{2})\s*-->/;
// Callout checkbox line — tolerates leading `> ` from blockquote nesting.
const CHECKBOX_LINE_RX = /^>\s*-\s*\[([ xX])\]\s+(.+?)\s*$/;
// Heading line of the rating callout.
const RATING_HEADER_RX = /^>\s*\[!todo\][+-]?\s+Was today useful/i;

function parseRatingCallout(markdown) {
  if (!markdown || typeof markdown !== "string") return null;
  const sentinelMatch = markdown.match(RATING_SENTINEL_RX);
  if (!sentinelMatch) return null;

  const lines = markdown.split("\n");
  const observations = [];
  let inCallout = false;
  for (const line of lines) {
    if (RATING_HEADER_RX.test(line)) {
      inCallout = true;
      continue;
    }
    if (!inCallout) continue;
    // Inside the callout block. Stop when we leave the blockquote (a non-`>`
    // non-empty line) — but blank `>` lines inside the callout are fine.
    if (!line.startsWith(">") && line.trim().length > 0) break;
    const m = line.match(CHECKBOX_LINE_RX);
    if (m) {
      observations.push({
        kind: m[2].trim().toLowerCase(),
        ticked: m[1].toLowerCase() === "x",
      });
    }
  }

  return {
    schema_version: sentinelMatch[1],
    cadence: sentinelMatch[2],
    day: sentinelMatch[3],
    observations,
  };
}

function scanAtomicNotes(opts) {
  const o = opts || {};
  const dir = o.dir || o.atomic_notes_dir;
  const engagement_id = o.engagement_id || null;
  const since_day = o.since_day || null;

  const result = { observations: [], notes_scanned: 0, notes_with_any_tick: 0 };
  if (!dir || !fs.existsSync(dir)) return result;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith(".md")) continue;
    const fullPath = path.join(dir, name);

    let md;
    try { md = fs.readFileSync(fullPath, "utf8"); } catch (_) { continue; }

    const parsed = parseRatingCallout(md);
    if (!parsed) continue;

    if (since_day && parsed.day && parsed.day < since_day) continue;

    // Sidecar (.cowork.json) carries engagement_id when present. Filter only
    // when the caller asked for a specific engagement AND the sidecar declares
    // a different one — silent on missing sidecars (pre-Rail-L notes).
    if (engagement_id) {
      const sidecarPath = fullPath.replace(/\.md$/, ".cowork.json");
      if (fs.existsSync(sidecarPath)) {
        try {
          const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
          if (sidecar && sidecar.engagement_id && sidecar.engagement_id !== engagement_id) {
            continue;
          }
        } catch (_) { /* ignore malformed sidecar */ }
      }
    }

    result.notes_scanned += 1;
    const hadAnyTick = parsed.observations.some((t) => t.ticked);
    if (hadAnyTick) result.notes_with_any_tick += 1;

    for (const t of parsed.observations) {
      result.observations.push({ kind: t.kind, ticked: t.ticked });
    }
  }

  return result;
}

module.exports = {
  DEFAULTS,
  updateWeights,
  evaluateWarmup,
  parseRatingCallout,
  scanAtomicNotes,
  _clamp,
  _round,
};
