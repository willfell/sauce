---
name: cowork:gather-finance-cc-today
description: Pull today's CC activity (settled + pending) for the midday tripwire, emit finance callout.
inputs:
  engagement_id: string
  date_today: string
  lookback_start: string
  timezone: string
  classify: boolean
  cards: object
  flag_threshold: number
outputs:
  markdown: string
  charges: list[object]
  top_merchant_today_total: number
  mtd_discretionary: number
  days_since_splurge_pre: number
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-finance-cc-today

Same shape as `cowork:gather-finance-yesterday` but bounded to *today* and limited to credit-card sources - designed for the midday tripwire job where same-day posts must be surfaced before rationalization sets in. Pulls Brex card expenses with both settled and pending statuses.

## Inputs

- `date_today` (string, required): today in `YYYY-MM-DD` form.
- `lookback_start` (string, optional, default `"06:00"`): local clock-time `HH:MM` at which the lookback window opens. Default `06:00` covers pre-7am posts that the morning briefing might have missed.
- `timezone` (string, optional, default `"America/Denver"`): IANA timezone.
- `classify` (boolean, optional, default `true`): when true, tag each charge `severity: "RED" | "YELLOW" | "GREEN"` per the cards classification (see `cards` input).
- `cards` (object, optional): `{ active: [string], locked: [string], ignore: [string] }` — card-name lists that drive the severity classifier. Charges on `locked` cards → RED. Charges on `active` cards in discretionary categories → YELLOW (or RED at `>= flag_threshold`). Charges on `ignore` cards are dropped from output. Defaults sourced from the resolved engagement record: `active: engagement.cc_active_cards`, `locked: engagement.cc_locked_cards`, `ignore: engagement.cc_ignored_cards` (engagement-type `personal` optional fields). Caller may override per invocation.
- `flag_threshold` (number, optional, default `200`): USD threshold for the `[!warning] Flagged` sub-block (and red severity escalation regardless of card).

## Outputs

- `markdown` (string): a single `> [!info]+ Today's credit card activity` callout, paste-ready.
- `charges` (list[object]): structured charges, each `{ time_local, merchant, amount_usd, category, card_last4, card_name, status, severity, transaction_id }`. The midday tripwire orchestrator filters this list to dispatch RED/YELLOW write-callout sub-skills.
- `top_merchant_today_total` (number): running top-merchant spend total today in dollars (highest cumulative-spend merchant on active cards).
- `mtd_discretionary` (number): month-to-date discretionary total.
- `days_since_splurge_pre` (number): days since last discretionary splurge, computed BEFORE today's charges.

## Steps

1. Compute window bounds: `start` = `{{date_today}}T{{lookback_start}}:00` in `timezone`; `end` = `now` in `timezone`. Convert both to UTC ISO-8601.
2. Call `mcp__claude_ai_Brex__list_expenses` with:
   - `purchased_at_start`: UTC ISO-8601 of `start`
   - `purchased_at_end`: UTC ISO-8601 of `end`
   - `expand[]`: `["merchant", "category", "card"]`
   - `limit`: `100`
3. Filter to records where `payment_method == "card"` (drop reimbursements / banking transfers).
4. Normalize each into `{ time_local, merchant, amount_usd, category, card_last4, status }` where `status` is `settled` or `pending` per Brex `payment_status`.
5. Compute:
   - `total_usd` = sum of `amount_usd`.
   - `by_category` = sum grouped by `category`, sorted descending.
   - `top3` = three records with largest `abs(amount_usd)`.
   - `flagged` = records where `abs(amount_usd) >= flag_threshold`.
6. If zero records, emit the empty-case callout (the orchestrator decides whether to suppress paste - see midday-tripwire prompt logic).
7. Otherwise compose per Returns. Append `(pending)` to the merchant cell for any record where `status == "pending"`.

## Returns

Non-empty case:

```markdown
> [!info]+ Today's credit card activity - [date_today], since [HH:MM]
> Total: **$[total_usd]** ([N_settled] settled, [N_pending] pending)
>
> **By category**
> | Category | Amount |
> |:--|--:|
> | [category] | $[sum] |
>
> **Top 3**
> | Time | Merchant | Amount | Card | Category |
> |:--|:--|--:|:--|:--|
> | [HH:MM] | [merchant] (pending) | $[amount] | x[last4] | [category] |
>
> > [!warning] Flagged ≥ $[flag_threshold] (N)
> > - **$[amount]** [merchant] on x[last4] ([category])
```

Empty case:

```markdown
> [!info]+ Today's credit card activity - [date_today]
> No credit card activity since [HH:MM].
```

## Errors

- **Brex MCP unavailable / not authenticated / API error:** return:
  ```markdown
  > [!warning]+ Finance unavailable
  > Brex MCP not connected. Re-authenticate via the Anthropic connectors UI.
  ```
- **Missing `date_today` or `timezone`:** return:
  ```markdown
  > [!warning]+ Finance unavailable
  > Missing `date_today` or `timezone` input - orchestrator must call cowork:date-context first.
  ```
- Never throw; always return a paste-ready callout string.
