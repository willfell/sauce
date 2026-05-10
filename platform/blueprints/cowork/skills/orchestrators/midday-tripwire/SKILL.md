---
name: cowork:midday-tripwire
description: Detect today's locked-card or discretionary CC charges since morning; append tripwire callout to today's daily note.
schedule: Daily 1:00 PM MT (~2.5min jitter)
scope: life
tags: [cowork, orchestrator, life, finance]
---

# cowork:midday-tripwire

Real-time mid-day check for credit-card charges that violate the active payoff plan. Pulls today's CC transactions, classifies each as RED (locked-card charge), YELLOW (active-card discretionary >= $50), or GREEN (necessity or under $50). Writes ONLY when at least one RED or YELLOW exists -- silent otherwise. Idempotent on re-run via `transaction_id` dedupe.

## Pre-flight
1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian", "brex"] }`. If the return is not `"ready"`, exit silently. The morning briefing already covers the daily picture; a transient outage at 1pm should not pollute the daily note.
2. Use Skill `cowork:date-context` with `{}`. Capture `context` (today, daily_path, dddd). If `context.error`, exit silently.
3. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather
4. Use Skill `cowork:gather-finance-cc-today` with `{ date_today: context.today, lookback_start: "06:00", timezone: "America/Denver", classify: true, cards: { active: {{life_cc_active_cards}}, locked: {{life_cc_locked_cards}}, ignore: {{life_cc_ignored_cards}} } }`. Capture `{ markdown, charges, top_merchant_today_total, mtd_discretionary, days_since_splurge_pre }`.
5. Read today's daily note (via `cowork:patch-daily-callouts` dry-read OR a single MCP read by patch-daily-callouts during step 8) and extract the set of `transaction_id`s already surfaced under existing tripwire callouts. Filter `step 4.charges` to drop any RED/YELLOW with a `transaction_id` already present. (Note: the patch sub-skill performs its own idempotency check by callout ID; this filter applies to per-charge dedupe.)

## Decide
6. Partition filtered charges into `red_charges = [c for c in charges if c.severity == "RED"]` and `yellow_charges = [c for c in charges if c.severity == "YELLOW"]`. If both lists are empty: exit silently. Do NOT write a "nothing happened" callout.

## Write
7. Build the callouts list:
   - If `red_charges.length > 0`: Use Skill `cowork:write-callout-tripwire-red` with `{ date: context.today, charges: <red_charges rendered as markdown table>, trigger_reason: "Locked card charged" }`. Capture `red_md`.
   - If `yellow_charges.length > 0`: Use Skill `cowork:write-callout-tripwire-yellow` with `{ date: context.today, charges: <yellow_charges rendered as markdown table>, top_merchant_today_total: "$<step 4.top_merchant_today_total>", mtd_discretionary: "Discretionary month-to-date: $<step 4.mtd_discretionary>.", days_since_last_splurge: "<step 4.days_since_splurge_pre> days clean before this charge." }`. Capture `yellow_md`.
8. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: context.daily_path, callouts: [{ id: "tripwire-red", body: <red_md or "" > }, { id: "tripwire-yellow", body: <yellow_md or ""> }] }`. Empty bodies are skipped by the sub-skill. The sub-skill places these immediately above `<!-- COWORK_CALLOUTS -->` (after the Finance callout if present); on marker absence it falls back to `## Notes` with a Notice.

## State
9. No thread-file or weekly-snapshot mutation. Tripwire is intentionally write-only at the daily-note layer; severity escalations roll into the morning briefing's auto-create thread logic on the next day.

## Done
