---
name: cowork:gather-cc-debt-snapshot
description: Snapshot all CC balances + utilization vs limits via Brex, compare to last snapshot, emit callout.
inputs:
  engagement_id: string
  date_today: string
  mode: string
  append_to_tracker: boolean
  week_range: object
  month_range: object
  prior_snapshot_path: string
  baseline_total_usd: number
  baseline_date: string
outputs:
  markdown: string
  total_usd: number
  on_pace: boolean
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-cc-debt-snapshot

Pulls every Brex-visible card limit + outstanding balance, computes per-card utilization, totals everything, and renders a `[!info]+ CC debt snapshot` callout. Optionally diffs against a prior snapshot and a fixed baseline so the daily note can show momentum on the debt-payoff arc.

> Note: Brex's `list_my_limits` surfaces only Brex-issued cards. Personal-card balances (Apple, Discover, Capital One, SCHEELS) are NOT in scope for this skill - those would require a Copilot Money MCP that does not currently exist in the Anthropic-managed catalog. # TODO(cycle): personal-card snapshot integration when a non-Brex card MCP lands. Until then this skill reports Brex-only totals and the orchestrator's prompt copy must reflect that scope.

## Inputs

- `date_today` (string, required): today in `YYYY-MM-DD` form.
- `mode` (string, optional, default `"daily"`): one of `"daily"` | `"weekly"` | `"monthly-close"`. Drives delta computation cadence and whether to append a row to the Credit Debt Payoff Tracker.
- `append_to_tracker` (boolean, optional, default `false` for `daily`, `true` for `weekly` / `monthly-close`): when true, append a Progress-log row to `spice/finance/debt/Credit Debt Payoff Tracker.md`.
- `week_range` (object, optional): `{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }` Mon..Sun used by `mode: "weekly"` for week-over-week deltas.
- `month_range` (object, optional): `{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }` first..last used by `mode: "monthly-close"` for opening/closing balance comparison.
- `prior_snapshot_path` (string, optional): vault-relative path (under `spice/cowork/snapshots/cc-debt/`) to the most recent prior snapshot JSON. If absent or unreadable, per-card delta cells render as `-`.
- `baseline_total_usd` (number, optional): a fixed baseline total to compare against (e.g., the date the user started a debt-payoff push). Omit to skip the baseline-delta line.
- `baseline_date` (string, optional): `YYYY-MM-DD` date corresponding to `baseline_total_usd`. Required if `baseline_total_usd` is provided.

## Outputs

- `markdown` (string): a single `> [!info]+ CC debt snapshot` callout, paste-ready.
- `total_usd` (number): aggregate CC debt total in dollars.
- `on_pace` (boolean): for `weekly` / `monthly-close` modes, true when paydown vs the previous period meets the `engagement.debt_weekly_target_usd` (`engagement.debt_monthly_target_usd`) target. Always `false` for `daily` mode.
- Side effect: writes today's snapshot JSON to `spice/cowork/snapshots/cc-debt/{{date_today}}.json` for tomorrow's diff. Schema: `{ "date": "YYYY-MM-DD", "cards": [{ "id", "name", "last4", "balance_usd", "limit_usd" }], "total_usd": <number> }`. When `append_to_tracker = true`, also appends one row to `spice/finance/debt/Credit Debt Payoff Tracker.md` Progress log.

## Steps

1. Call `mcp__claude_ai_Brex__list_cards` with `limit: 100` to enumerate all visible cards. Capture `id`, `last_four`, `card_name`, `status`.
2. Call `mcp__claude_ai_Brex__list_my_limits` with `limit: 100` to fetch each card's spend limit. Index responses by card `id`.
3. For each card compute `outstanding_balance_usd` from the limit response (`current_period_balance.amount` minor units → dollars). If a card has no balance field, treat as `0`.
4. Compute:
   - `total_usd` = sum of `outstanding_balance_usd` across cards.
   - `utilization_pct` per card = `balance / limit * 100` (skip if `limit == 0`).
   - `total_utilization_pct` = `total_balance / total_limit * 100`.
5. If `prior_snapshot_path` is provided and readable, parse the JSON and compute per-card `delta_usd = today_balance - prior_balance` and `total_delta_usd`.
6. If `baseline_total_usd` is provided, compute `baseline_delta_usd = total_usd - baseline_total_usd`.
7. Write today's snapshot JSON to `spice/cowork/snapshots/cc-debt/{{date_today}}.json` (orchestrator's filesystem tool of choice; this skill emits the path + payload - the orchestrator persists it).
8. Compose the callout per Returns and return it.

## Returns

```markdown
> [!info]+ CC debt snapshot - [date_today]
> Total: **$[total_usd]** across [N] cards · utilization **[total_utilization_pct]%**
> Δ vs last snapshot ([prior_date]): **±$[total_delta_usd]**
> Δ vs baseline ([baseline_date], $[baseline_total_usd]): **±$[baseline_delta_usd]**
>
> | Card | Balance | Limit | Util | Δ vs prior |
> |:--|--:|--:|--:|--:|
> | [name] x[last4] | $[balance] | $[limit] | [pct]% | ±$[delta] |
```

## Errors

- **Brex MCP unavailable / either list call fails:** return:
  ```markdown
  > [!warning]+ CC debt snapshot unavailable
  > Brex MCP not connected. Re-authenticate via the Anthropic connectors UI.
  ```
- **`prior_snapshot_path` provided but unreadable / malformed JSON:** proceed with rendering; render delta cells as `-` and append a single line:
  `> Note: prior snapshot at [prior_snapshot_path] missing or malformed; deltas omitted.`
- **`baseline_total_usd` provided without `baseline_date` (or vice versa):** omit the baseline-delta line and append:
  `> Note: baseline inputs incomplete; baseline delta omitted.`
- **Missing `date_today`:** return:
  ```markdown
  > [!warning]+ CC debt snapshot unavailable
  > Missing `date_today` input - orchestrator must call cowork:date-context first.
  ```
- Never throw; always return a paste-ready callout string.
