---
name: cowork:write-callout-tripwire-yellow
description: Compose yellow-severity midday tripwire callout for active-card discretionary spend near threshold; softer than red.
inputs:
  date: string
  charges: string
  scheels_today_total: string
  mtd_discretionary: string
  days_since_last_splurge: string
outputs:
  markdown: string
tags: [cowork, write-callout]
---

# cowork:write-callout-tripwire-yellow

Composition-only sub-skill. Emits the yellow-severity midday tripwire - softer nudge for SCHEELS (active daily-driver) discretionary spend that's approaching but not crossing the red threshold. No MCP calls.

## Threshold context (informational, not enforced here)

Yellow triggers, evaluated by orchestrator from `cowork:gather-finance-cc-today`:

- SCHEELS charge `>= $50` in a discretionary category (Restaurants, Clothing, Door Dash, Travel Substances, Travel Misc, Misc Shopping, Alcohol/Bud/Misc, Nicotine, Snacks).
- SCHEELS daily running total `>= $100` regardless of category.
- Month-to-date discretionary spend in any category `>= 75%` of monthly target.

If neither yellow nor red threshold is met, orchestrator skips both tripwire skills entirely. If red is met, orchestrator dispatches red skill (red wins). This skill is dispatched only when yellow is met and red is not.

## Inputs

- `date` (string, required) - absolute `YYYY-MM-DD`.
- `charges` (string, required) - markdown table fragment from `cowork:gather-finance-cc-today` showing today's SCHEELS discretionary charges. `> `-prefixed.
- `scheels_today_total` (string, required) - formatted dollar amount like `$XX.XX` (no `> ` prefix; embedded mid-line).
- `mtd_discretionary` (string, optional) - short literal like `Restaurants/Clothing/Door Dash month-to-date: $XXX vs budget $400.`.
- `days_since_last_splurge` (string, optional) - short literal like `4 days clean before this charge.`.

## Outputs

- `markdown` (string) - single warning callout block.

## Steps

1. Substitute `{{DATE}}` and `{{SCHEELS_TODAY_TOTAL}}` into the body.
2. Render `charges` table verbatim.
3. Append `mtd_discretionary` and `days_since_last_splurge` lines if present; omit each line individually if empty.
4. Return `{ markdown }`.

## Returns

Literal output shape (single outer `[!warning]+` callout, softer tone than red, still direct):

```markdown
> [!warning]+ Yellow tripwire - Discretionary spend
>
> Today's SCHEELS running total: **{{SCHEELS_TODAY_TOTAL}}**. Active-card discipline is "pay off in full each cycle" - track this against the month's discretionary budget.
>
{{CHARGES}}
>
> {{MTD_DISCRETIONARY_OR_OMITTED}}
> {{DAYS_SINCE_LAST_SPLURGE_OR_OMITTED}}
>
> Cook tonight. Skip the second drink. The streak is a lever - don't break it for one impulse.
```

The two `_OR_OMITTED` slots are dropped along with their entire `> ` line if their input is empty.

## Errors

- `charges` empty: hard-fail. A yellow tripwire with no rows is incoherent.
- `scheels_today_total` empty: substitute `unknown` and proceed. The callout still has informational value.
- `date` missing: hard-fail.
