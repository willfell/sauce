---
name: cowork:gather-finance-yesterday
description: Pull yesterday's Brex card+banking transactions, summarize, emit Yesterday's finance callout.
inputs:
  engagement_id: string
  date_yesterday: string
  mode: string
  week_range: object
  month_range: object
  include_invoice_pulse: boolean
  timezone: string
  flag_threshold: number
outputs:
  markdown: string
  total_usd: number
  invoice_path: string
  hours_logged: number
  amount_logged: number
  invoice_submitted: boolean
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-finance-yesterday

Aggregates yesterday's Brex card expenses and banking transactions into a normalized `[!info]+` callout: total spend, per-category breakdown, top three transactions by absolute amount, and a flagged-charges sub-block for any single transaction at or above `flag_threshold`.

## Inputs

- `engagement_id` (string, required): id of the engagement this gather runs for. Resolves engagement record (used for `hourly_rate_usd`, `invoice_cadence`, optional card lists). Type-gated: returns the unavailable callout for engagements whose `render_aspects.finance_block != "include"`.
- `date_yesterday` (string, required): target day in `YYYY-MM-DD` form. Caller computes via `cowork:date-context`.
- `mode` (string, optional, default `"daily"`): one of `"daily"` | `"full-week"` | `"full-month"`. `full-week` widens the query window to `week_range` and emits per-category week-over-week deltas. `full-month` widens to `month_range` and emits month-over-month deltas + budget adherence.
- `week_range` (object, optional): `{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }` Mon..Sun. Required when `mode = "full-week"`.
- `month_range` (object, optional): `{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }` first..last. Required when `mode = "full-month"`.
- `include_invoice_pulse` (boolean, optional, default `false`): when true (typically when `engagement.type == "consulting"`), additionally read `spice/finance/<YYYY-MM>/<YYYY-MM>-Invoice.md` and surface invoice path / hours-logged / amount / submission status. Used by morning-briefing for consulting engagements.
- `timezone` (string, optional, default `"America/Denver"`): IANA timezone used to bound the day window.
- `flag_threshold` (number, optional, default `200`): USD threshold; transactions whose absolute amount is at or above this raise a `[!warning]` Flagged sub-block.

## Outputs

- `markdown` (string): a single `> [!info]+` callout, paste-ready (title varies by mode).
- `total_usd` (number): aggregate spend for the queried window.
- `invoice_path` (string, work-scope only): vault-relative path to the current month's invoice when `include_invoice_pulse = true`.
- `hours_logged` (number, work-scope only): hours logged on the invoice so far.
- `amount_logged` (number, work-scope only): dollars logged on the invoice so far.
- `invoice_submitted` (boolean, work-scope only): true when the invoice frontmatter `submitted` flag is set.

## Steps

1. Compute window bounds: `start` = `{{date_yesterday}}T00:00:00` in `timezone`; `end` = `{{date_yesterday}}T23:59:59` in `timezone`. Convert to UTC ISO-8601 for the API arguments.
2. Call `mcp__claude_ai_Brex__list_expenses` with arguments:
   - `purchased_at_start`: UTC ISO-8601 of `start`
   - `purchased_at_end`: UTC ISO-8601 of `end`
   - `expand[]`: `["merchant", "category", "department", "user"]`
   - `limit`: `100`
3. Call `mcp__claude_ai_Brex__list_banking_transactions` with the same window (`posted_at_start` / `posted_at_end`) for non-card outflows.
4. Normalize each record into `{ merchant, amount_usd, category, source }` where `source` is `card` or `banking`. Convert amounts from minor units to dollars when needed.
5. Compute:
   - `total_usd` = sum of all `amount_usd`.
   - `by_category` = sum grouped by `category`, sorted descending.
   - `top3` = three records with largest `abs(amount_usd)`.
   - `flagged` = records where `abs(amount_usd) >= flag_threshold`.
6. If both API calls return zero records, emit the empty-case callout.
7. Otherwise compose the callout per Returns and return it.

## Returns

Non-empty case:

```markdown
> [!info]+ Yesterday's finance - [date_yesterday]
> Total spend: **$[total_usd]**
>
> **By category**
> | Category | Amount |
> |:--|--:|
> | [category] | $[sum] |
>
> **Top 3**
> | Merchant | Amount | Category |
> |:--|--:|:--|
> | [merchant] | $[amount] | [category] |
>
> > [!warning] Flagged ≥ $[flag_threshold] (N)
> > - **$[amount]** [merchant] ([category])
```

Empty case:

```markdown
> [!info]+ Yesterday's finance - [date_yesterday]
> No transactions recorded.
```

## Errors

- **Brex MCP unavailable / not authenticated / API error on either endpoint:** return:
  ```markdown
  > [!warning]+ Finance unavailable
  > Brex MCP not connected. Re-authenticate via the Anthropic connectors UI.
  ```
- **Missing `date_yesterday` or `timezone`:** return:
  ```markdown
  > [!warning]+ Finance unavailable
  > Missing `date_yesterday` or `timezone` input - orchestrator must call cowork:date-context first.
  ```
- Never throw; always return a paste-ready callout string.
