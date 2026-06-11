---
name: cowork:compose-feedback-capture
description: Compose or re-compose the Rail L questionnaire+capture block for an EOD review note. Emits per-item ticks, 3-position frequency knobs, and a tagged fenced feedback block. Idempotent re-fire preserves prior tick/knob state.
inputs:
  cadence: string
  surfaced_items_by_kind: object
  prior_md: string
outputs:
  rail_md: string
  sidecar_observability: object
  status: string
tags: [cowork, compose, eod-review, questionnaire, feedback-capture]
---

# cowork:compose-feedback-capture

> stub — full skill body ships in v0.98.1 S2+

Compose the Rail L questionnaire+capture block for EOD review.
See `helpers/compose-feedback-capture-helper.js` for the underlying
`composeFeedbackCapture` and `parseFeedbackCapture` exports.
