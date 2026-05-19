---
name: cowork:midday-tripwire
description: Engagement-aware midday CC tripwire. Detects today's locked-card or discretionary CC charges since morning for one engagement and appends a tripwire callout to today's daily note. Personal-engagement only (gated by render_aspects.finance_block). Phrasings = "midday tripwire for <engagement>", "<engagement> midday check", "midday cc check".
schedule: Cron-driven per enabled (engagement, midday) pair (typically only personal-type engagements enable midday)
scope: shared
tags: [cowork, orchestrator, midday, finance, engagement-aware]
---

# cowork:midday-tripwire

Real-time mid-day check for credit-card charges that violate the active payoff plan, scoped to a single engagement. Pulls today's CC transactions for the engagement's finance scope, classifies each as RED (locked-card charge), YELLOW (active-card discretionary >= threshold), or GREEN. Writes ONLY when at least one RED or YELLOW exists — silent otherwise. Idempotent on re-run via `transaction_id` dedupe.

Skipped (early-exit silently) for engagements whose `render_aspects.finance_block != "include"`.

## Inputs

```
{
  engagement_id: string   // required
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If not `"ready"`, exit silently.
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up `engagement` by id. If not found, exit silently. Load engagement-type manifest; capture `render_aspects`. If `render_aspects.finance_block != "include"`, exit silently (engagement doesn't track finance — tripwire is a no-op).
3. Use Skill `cowork:date-context` with `{}`. If `context.error`, exit silently.
4. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. Use Skill `cowork:gather-finance-cc-today` with `{ engagement_id, date_today: context.today, lookback_start: "06:00", timezone: "America/Denver", classify: true, cards: { active: engagement.cc_active_cards, locked: engagement.cc_locked_cards, ignore: engagement.cc_ignored_cards } }`. Capture `{ markdown, charges, top_merchant_today_total, mtd_discretionary, days_since_splurge_pre }`.
6. Read today's daily note (via `patch-daily-callouts` dry-read OR a single MCP read) and extract `transaction_id`s already surfaced in the current `(midday, engagement_id)` block. Filter `step 5.charges` to drop dedupes.

## Decide

7. Partition filtered charges into `red_charges` (severity == RED) and `yellow_charges` (severity == YELLOW). If both empty: exit silently. Do NOT write a "nothing happened" callout.

## Write

8. If `red_charges.length > 0`: use Skill `cowork:write-callout-tripwire-red` with `{ engagement, date: context.today, charges: <red_charges as md table>, trigger_reason: "Locked card charged" }`. Capture `red_md`.
9. If `yellow_charges.length > 0`: use Skill `cowork:write-callout-tripwire-yellow` with `{ engagement, date: context.today, charges: <yellow_charges as md table>, top_merchant_today_total: "$<step 5.top_merchant_today_total>", mtd_discretionary: "Discretionary month-to-date: $<step 5.mtd_discretionary>.", days_since_last_splurge: "<step 5.days_since_splurge_pre> days clean before this charge." }`. Capture `yellow_md`.
10. Use Skill `cowork:patch-daily-callouts` with `{ engagement_id, daily_path: context.daily_path, callouts: [{ id: "tripwire-red", body: <red_md or ""> }, { id: "tripwire-yellow", body: <yellow_md or ""> }] }`. Tripwire callouts nest under the `## Midday — <engagement.label>` H2 within the `%% COWORK_CALLOUTS %%` block.

## State

11. No thread-file or weekly-snapshot mutation. Tripwire is intentionally write-only at the daily-note layer; escalations roll into the morning briefing's thread-create logic on the next day.

## Done
