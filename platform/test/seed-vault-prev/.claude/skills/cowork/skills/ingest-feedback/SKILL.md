---
name: cowork:ingest-feedback
description: Deterministic feedback-ingest core for the nightly reconciler. Rolls per-item ticks/downvotes/knobs into entity + kind weight deltas; validates free-text intent extractions against the write-target allowlist; composes the feedback-deltas audit entry. Pure helper delegation; never throws.
inputs:
  parsed: object        # parseFeedbackCapture output (v=1 or v=2)
  registry: array       # sidecar feedback_capture.items[] — {item_id, kind, identifier, label}
  ambiguous_items: array
  intents: array        # LLM-extracted intent list (validated here, never trusted)
  free_text: string
outputs:
  entity_deltas: array
  kind_observations: array
  knob_deltas: array
  accepted: array       # validated intents safe to apply
  rejected: array
  pending: array
tags: [cowork, ingest, learned-weights, feedback-loop, pure-helper]
---

# cowork:ingest-feedback

Deterministic core of the v0.98.2 feedback loop. Pure delegation to
`ingest-feedback-helper.js` — no I/O, no MCP, no LLM judgment. The
reconcile-cowork orchestrator re-states this contract inline (pure-MCP at
fire time); any Node-capable session invokes the helper directly.
v0.99.0: all weight math is gated on `classifyEngagementDay` — engaged days run the full pipeline; tap-only days log satisfaction only; silent days write the audit line only.

## When invoked

From `reconcile-cowork` Steps 3.5 (rollup) + 3.6 (intent validation) +
4-5 (weight apply) + 5.5 (audit compose). Never invoked from the five
brief cadences.

## Deterministic contract

- `rollupFeedback({parsed, registry, ambiguous_items})` → `{entity_deltas,
  kind_observations, knob_deltas}`. Mattered tick → +0.05; didn't-like →
  −0.10; kind tick = ≥1 mattered in kind; knob less/more → ∓/±0.05;
  ambiguous items + knobs → no signal.
- Identity classification (first match wins): `person:<name>` → per_person;
  github `org/repo#N` → per_topic `org/repo`; ado `org/proj:<id>` →
  per_topic `org/proj`; chat `<chan>:<ts>` → per_channel `<chan>`; else
  per_topic by label.
- `applyEntityDeltas` / `applyKnobDeltas` / `applyDecay` / `applyFloorSet` —
  clamp [0.10, 3.00], banker's rounding 3 places. Decay is TOWARD 1.00:
  `w' = 1 + (w−1)×0.995`.
- `normalizeLearnedWeightsV3` — tolerates on-disk schema 2 (int) / missing
  version / legacy "1.1.0" / 3. Additive: entity maps + totals.feedback_ingested_days
  initialize empty; nothing existing is dropped.
- `validateIntents(intents, free_text)` — REJECT on: unknown intent,
  non-verbatim source_quote, target outside
  `learned_weights | microscope:<kind> | voice-proposals | coverage-queue`,
  kindless uprank/downrank/frequency. PENDING on: intent `other`, confidence
  `low`. Only `accepted` intents may be applied. The LLM proposes; this
  layer disposes.
- `composeAuditEntry({day, run_id, lines})` — `## <day> (run-id: <id>)`
  header + one `- [tag] ...` bullet per line.

## Failure modes

Helper functions never throw on malformed input — they skip the malformed
element and continue (mirrors learn-from-checks posture). An empty parse /
empty registry / empty intents list yields empty outputs: no signal → no
deltas → no writes.

## Harness testing

HC-V0982-INGEST-A1..A8 in `platform/test/run-helper-cases.js` pin: delta
values, knob re-clamp at ceiling, floor-set, decay-toward-1.00 (2.000→1.995,
0.500→0.502), 4-shape normalizer tolerance, the 6-case intent-validation
matrix, and the audit-entry golden format.
