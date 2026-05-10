---
name: cowork:morning-briefing
description: Compose four-callout morning block (briefing, finance, email, messages) + threads tail; patch into today's daily.
schedule: Daily 7:03 AM MT (~2.5min jitter)
scope: life
tags: [cowork, orchestrator, life]
---

# cowork:morning-briefing

Composes a four-callout morning block (Morning Briefing, Finance, Email, Messages) and an Open Threads tail, then patches them into today's daily note. The first four callouts go above the `<!-- COWORK_CALLOUTS -->` marker; Open Threads goes at the bottom of the file after `## Notes`. Aborts cleanly on MCP unavailability - never partially writes. Re-runs are idempotent: each callout is replaced if it already exists for today.

## Pre-flight
1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian", "gmail", "google-calendar", "brex", "imessage"] }`. If the return is not `"ready"`, emit Notice `cowork:morning-briefing aborted -- <status>` and exit. Do not write.
2. Use Skill `cowork:date-context` with `{}`. Capture the returned `context` object (`today`, `dddd`, `MM-Month`, `week_of`, `daily_path`, `yesterday_daily_path`, etc.). If `context.error` exists, emit Notice and exit.
3. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`. Creates the note from the daily blueprint template if missing.

## Gather
4. Use Skill `cowork:gather-weather` with `{ city: "{{home_city}}", days_ahead: 3 }`.
5. Use Skill `cowork:gather-calendar` with `{ date_today: context.today, scope: "life", horizon: "today+next-2-days", timezone: "America/Denver" }`.
6. Use Skill `cowork:gather-gmail` with `{ window: "newer_than:1d", filters: ["-category:promotions", "-category:social", "-category:updates", "-category:forums"] }`.
7. Use Skill `cowork:gather-imessage` with `{ window_days: 3, scope: "inner-circle-and-groups" }`.
8. Use Skill `cowork:gather-finance-yesterday` with `{ date_yesterday: context.yesterday, scope: "life", mode: "daily" }`.
9. Use Skill `cowork:gather-cc-debt-snapshot` with `{ date_today: context.today, mode: "daily" }`.
10. Use Skill `cowork:gather-projects` with `{ scope: "life", filter: "active", today: context.today, carry_over_from: context.yesterday_daily_path }`.
11. Use Skill `cowork:gather-threads` with `{ date_today: context.today, mode: "morning-surface", scope: "life" }`.

## Write
12. Use Skill `cowork:write-callout-finance` with `{ date: context.today, scope: "life", finance_yesterday: <step 8.markdown>, cc_debt_snapshot: <step 9.markdown> }`. Capture `finance_block`.
13. Use Skill `cowork:write-callout-morning-briefing-life` with `{ date: context.today, weekday: context.dddd, weather: <step 4.markdown>, calendar: <step 5.markdown>, gmail: <step 6.markdown>, imessage: <step 7.markdown>, threads_digest: <step 11.markdown>, finance_block: <finance_block>, tasks: <step 10 in-progress + todo + blocked rendered as markdown>, people: <step 10.people_nudges rendered as markdown>, patterns: <derived from steps 8/9/11 as markdown> }`. Capture `briefing_markdown`.
14. Compose the Open Threads tail callout. If `step 11.open_threads.length == 0`, set `tail_blocks = []`. Otherwise compose `> [!warning]- Open Threads (N)` containing the threads table from `step 11.open_threads`.
15. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: context.daily_path, callouts: [{ id: "morning-briefing", body: <briefing_markdown> }], tail_blocks: <tail_blocks from step 14> }`. The sub-skill handles marker location, idempotent replace-by-id, and `## Notes` fallback.

## State
16. Use Skill `cowork:update-active-threads` with `{ scope: "life", phase: "morning-pass", date_today: context.today, writer: "cowork:morning-briefing", changes: { new_threads: <step 11.new_threads>, snoozed_to_open: <step 11.snoozed_to_open>, surface_open: true } }`.
17. Use Skill `cowork:update-weekly-snapshot` with `{ scope: "life", phase: "morning", date_today: context.today, writer: "cowork:morning-briefing", snapshot_data: { week_of: context.week_of, wtd_spend: <step 8.total_usd>, cc_total: <step 9.total_usd>, journaled_today: false } }`.

## Done
