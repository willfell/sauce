---
name: cowork:eod-review
description: Compose EOD callout (todo status, morning follow-up, tomorrow, late emails); patch into today's daily note.
schedule: Daily 7:00 PM MT (~2.5min jitter)
scope: life
tags: [cowork, orchestrator, life]
---

# cowork:eod-review

Closes the day by compiling completed/incomplete tasks, comparing against the morning briefing's flagged items, previewing tomorrow's calendar, surfacing late emails, and updating the active-threads ledger. Writes ONE `[!example]-` callout to today's daily note above `<!-- COWORK_CALLOUTS -->`. Re-run replaces the existing block in place.

## Pre-flight
1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian", "gmail", "google-calendar"] }`. If not `"ready"`, emit Notice `cowork:eod-review aborted -- <status>` and exit.
2. Use Skill `cowork:date-context` with `{}`. Capture `context` (today, tomorrow, daily_path, tomorrow_daily_path, tomorrow_weekday).
3. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather
4. Use Skill `cowork:gather-projects` with `{ scope: "life", filter: "today-status", today: context.today }`. Capture `{ completed, incomplete, kanban_in_progress, kanban_to_do, kanban_blocked }`.
5. Use Skill `cowork:gather-calendar` with `{ date_today: context.tomorrow, scope: "life", horizon: "today", timezone: "America/Denver" }`. Captures tomorrow's events.
6. Use Skill `cowork:gather-gmail` with `{ window: "newer_than:12h", filters: ["-category:promotions", "-category:social", "-category:updates", "-category:forums"] }`. Capture `{ markdown, action_required, fyi }`. Compute `late_emails` = emails arrived after morning-briefing run time.
7. Use Skill `cowork:gather-threads` with `{ date_today: context.today, mode: "eod-reconcile", scope: "life" }`. Capture `{ resolved_today, snoozed_today, still_open, auto_created_eod }`.
8. Compose `morning_followup` summary by reading the morning-briefing callout (the patch-daily-callouts sub-skill reads the daily note when invoked; alternatively the orchestrator infers from frontmatter set by daily-note action buttons): `{ flagged_transactions: { reviewed, pending }, unanswered_messages: { replied, still_unanswered }, threads: { resolved, snoozed, still_open } }`.

## Write
9. Use Skill `cowork:write-callout-eod-life` with `{ date: context.today, tomorrow_date: context.tomorrow, tomorrow_weekday: context.tomorrow_weekday, completed: <step 4.completed rendered as markdown>, carrying_over: <step 4.incomplete rendered as markdown>, morning_followup: <step 8 rendered as markdown>, threads_changes: <step 7 rendered as markdown>, tomorrow_calendar: <step 5.markdown>, late_emails: <step 6.markdown filtered to late window> }`. Capture `eod_markdown`.
10. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: context.daily_path, callouts: [{ id: "eod-review", body: <eod_markdown> }] }`. Idempotent replace-by-id; marker fallback handled by sub-skill.

## State
11. Use Skill `cowork:update-active-threads` with `{ scope: "life", phase: "eod-pass", date_today: context.today, writer: "cowork:eod-review", changes: { resolved: <step 7.resolved_today>, snoozed_to_open: <step 7.snoozed_today>, new_threads: <step 7.auto_created_eod> } }`.
12. Use Skill `cowork:update-weekly-snapshot` with `{ scope: "life", phase: "eod", date_today: context.today, writer: "cowork:eod-review", snapshot_data: { completed_count: <step 4.completed.length>, carryover_count: <step 4.incomplete.length>, threads_resolved_today: <step 7.resolved_today.length> } }`.

## Done
