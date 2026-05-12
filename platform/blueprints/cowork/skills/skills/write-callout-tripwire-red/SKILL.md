---
name: cowork:write-callout-tripwire-red
description: Compose red-severity midday tripwire callout for locked-card or large-charge events; assertive, action-first.
inputs:
  date: string
  charges: string
  trigger_reason: string
outputs:
  markdown: string
tags: [cowork, write-callout]
---

# cowork:write-callout-tripwire-red

Composition-only sub-skill. Emits the loud, short red-severity tripwire callout. The orchestrator decides red vs yellow before dispatch - this skill assumes the red threshold has already been crossed and renders accordingly. No MCP calls.

## Threshold context (informational, not enforced here)

Red triggers, evaluated by orchestrator from `cowork:gather-finance-cc-today`:

- Any charge of any amount on a card marked `locked` in `spice/finance/debt/Credit Debt Payoff Tracker.md` (locked-card list configured via `engagement.cc_locked_cards` in the resolved engagement record).
- Any single charge `>= $200` on any card.
- Any locked-card balance ticking up by `> $5` vs yesterday's snapshot when not attributable to interest.

Yellow vs red distinction lives in the orchestrator. If the orchestrator dispatches this skill, the red threshold has been met.

## Inputs

- `date` (string, required) - absolute `YYYY-MM-DD`.
- `charges` (string, required) - markdown table fragment from `cowork:gather-finance-cc-today`. One row per offending charge with columns Time, Merchant, Amount, Card, Category. Caller-side `> `-prefixed.
- `trigger_reason` (string, required) - short literal label like `Locked card charged` or `Large charge posted` or `Locked card balance ticked up`. Substituted into the callout title.

## Outputs

- `markdown` (string) - single danger callout block.

## Steps

1. Substitute `{{DATE}}` and `{{TRIGGER_REASON}}` into the title.
2. Render `charges` table verbatim inside the callout body.
3. Append the canonical Options block: three concrete actions the user can take in the next hour.
4. Return `{ markdown }`.

## Returns

Literal output shape (single outer `[!danger]+` callout, no nested callouts, action-first body):

```markdown
> [!danger]+ Red tripwire - {{TRIGGER_REASON}}
>
> A charge posted that breaks the focused-attack discipline. Course-correct now while it's still cheap.
>
{{CHARGES}}
>
> **Options:**
> - Return the item if returnable. Take 5 minutes.
> - Move any recurring/auto-pay off this card if it's a subscription charge.
> - Pay the exact charge amount to the card today and treat the locked card as a charge card.
>
> Course-correct now while it's still cheap.
```

## Errors

- `charges` empty: hard-fail. A red tripwire with no charge rows is incoherent - do not emit. Return empty string and let the orchestrator log the dispatch error.
- `trigger_reason` empty: default to `Locked card activity` and proceed.
- `date` missing: hard-fail.
