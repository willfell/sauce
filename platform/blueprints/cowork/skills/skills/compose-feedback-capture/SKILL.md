---
name: cowork:compose-feedback-capture
description: |
  Builds the Rail L body for the EOD review cadence (v0.98.1+). Replaces
  the v0.96.0 kind-checkbox rating callout for EOD only. Other 4 cadences
  use cowork:compose-body's rating-callout path unchanged.
helpers:
  - spice/cowork/helpers/compose-feedback-capture-helper.js
contract_version: v0.98.1
sentinel: "<!-- cowork:feedback-capture v=1 -->"
---

# cowork:compose-feedback-capture

This sub-skill is a thin shim around `compose-feedback-capture-helper.js`'s
`composeFeedbackCapture` export. Read the helper for the canonical
contract; this file orients an LLM that's about to invoke it.

## When invoked

By `compose-body-helper.js` (NOT by an orchestrator directly): when
`cadence === "eod-review"` AND `input.surfaced_items_by_kind` is
non-empty, `composeBody` calls `composeFeedbackCapture` instead of
the v0.96.0 `composeRatingCallout`. The other 4 cadences (morning,
midday, weekly, monthly) keep calling `composeRatingCallout` as today.

## Inputs

`composeFeedbackCapture(opts)` where `opts` is:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `cadence` | string | yes | Always `"eod-review"` in v0.98.1 |
| `day` | string | yes | ISO `YYYY-MM-DD` |
| `surfaced_items_by_kind` | object | yes | `{ [kind]: [{id, label}] }` — kind name lowercase; id is the canonical identifier (channel:thread, repo#PR, etc.); label is the user-visible string |
| `prior_md` | string \| null | no | Prior atomic-note markdown (full body) when re-firing; null on first fire. Triggers idempotent preservation of [x] ticks + knob position + free-text |
| `knob_positions` | string[] | yes | Always `["less", "same", "more"]` in v0.98.1 |

## Outputs

`{ rail_md, sentinel, item_id_registry, sidecar_observability }`:

- `rail_md`: the full Rail L body string (lead callout + per-kind sub-callouts + free-text block). To be appended to the atomic-note body by composeBody.
- `sentinel`: literal `<!-- cowork:feedback-capture v=1 -->`. Used by v0.98.2 reconciler grep.
- `item_id_registry`: `{ [itemId]: {kind, identifier, label} }` map. Compose-body uses this to pair item-IDs back to surfaced items for the `^item-<id>` block-ID emit on per-kind callouts.
- `sidecar_observability`: `{ sentinel_version, item_count, kinds_with_knobs, ambiguous_knobs }`. Passed to the sidecar `feedback_capture` field for v0.98.2 fast-path observability.

## Item-ID hash

`^item-<kind>-<7-char-sha1>` of `<kind>:<canonical_identifier>`. Day-stable;
cross-day-stable (channel IDs, PR numbers, story IDs are persistent identifiers).
Block-IDs render invisibly in Obsidian reading mode.

## Idempotent re-fire

When `prior_md` contains the `cowork:feedback-capture v=1` sentinel,
prior `[x]` state per item-ID + per knob position + free-text are
preserved verbatim. When `prior_md` contains only the legacy
`cowork:rating-block` sentinel (pre-v0.98.1 EOD), start fresh — no
migration of kind-level ticks to per-item ticks.

## See also

- `compose-body-helper.js` (parent invoker)
- `learn-from-checks-helper.js` (sibling: parseFeedbackCapture for v0.98.2 reconciler)
- `Docs/plans/2026-06-11-v0.98.1-questionnaire-capture-design.md` (full design)
