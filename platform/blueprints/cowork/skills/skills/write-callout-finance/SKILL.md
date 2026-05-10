---
name: cowork:write-callout-finance
description: Compose finance callout (yesterday transactions + credit-debt payoff snapshot) for life-vault morning/midday flows.
inputs:
  date: string
  scope: string
  finance_yesterday: string
  cc_debt_snapshot: string
  flagged_block: string
outputs:
  markdown: string
tags: [cowork, write-callout]
---

# cowork:write-callout-finance

Composition-only sub-skill that produces the standard finance callout block. Used by morning briefing and (on demand) by midday flows. Inputs are already-normalized; this skill stitches them into a deterministic shape. No MCP calls. No threshold logic - that lives in tripwire skills.

## Inputs

- `date` (string, required) - absolute `YYYY-MM-DD`. The callout reports yesterday's activity but is filed under `date` (today).
- `scope` (string, optional, default `"life"`) - one of `"life"` | `"work"`. Currently informational; reserved for future ero-variant differentiation.
- `finance_yesterday` (string, optional) - markdown fragment from `cowork:gather-finance-yesterday`. Transactions table + week-to-date table.
- `cc_debt_snapshot` (string, optional) - markdown fragment from `cowork:gather-cc-debt-snapshot`. Per-card balances, target-card focus row, days-since-splurge counter.
- `flagged_block` (string, optional) - pre-rendered nested-warning fragment for flagged transactions (locked-card charges, large charges, etc.). Caller decides whether to populate.

## Outputs

- `markdown` (string) - single multi-line callout block (one outer `[!info]+ Finance` wrapper with sub-sections divided by `> ---`).

## Steps

1. Substitute `{{DATE}}` into the title.
2. If `finance_yesterday` is empty, render `> No transactions yesterday.` in that sub-section.
3. If `cc_debt_snapshot` is empty, render `> Credit-debt tracker unavailable. See spice/finance/debt/Credit Debt Payoff Tracker.md.` in that sub-section.
4. If `flagged_block` is non-empty, render it directly under the transactions sub-section before the `> ---` divider; otherwise omit the flagged sub-callout entirely.
5. Return `{ markdown }`.

## Returns

Literal output shape (single outer callout, sub-sections separated by `> ---`, all lines `> `-prefixed):

```markdown
> [!info]+ Finance - yesterday
>
> **Transactions through {{DATE}} - 1 day**
>
{{FINANCE_YESTERDAY}}
>
{{FLAGGED_BLOCK_OR_OMITTED}}
>
> ---
>
> **Credit-debt payoff (focused attack on Cap1 Platinum)**
>
{{CC_DEBT_SNAPSHOT}}
```

Where `{{FINANCE_YESTERDAY}}` and `{{CC_DEBT_SNAPSHOT}}` are the input markdown fragments; gather skills return `> `-prefixed lines. `{{FLAGGED_BLOCK_OR_OMITTED}}` is a nested warning callout when populated, else the entire `> ` line containing it is removed (no orphan dividers).

## Errors

- Both `finance_yesterday` and `cc_debt_snapshot` empty: still emit the outer `[!info]+ Finance` wrapper with a single line `> Finance gather skills returned no data. Investigate Copilot MCP connectivity.` Never silently disappear - the user reads this section every morning and a missing block is a strong signal.
- `date` missing: hard-fail. The "yesterday" framing is meaningless without an anchor date.
