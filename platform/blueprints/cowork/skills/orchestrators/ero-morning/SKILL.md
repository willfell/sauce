---
name: cowork:ero-morning
description: ERO weekday morning briefing (calendar, project board, threads, invoice pulse); writes one callout into the daily note.
schedule: Weekday 7:08 AM MT (~8min jitter)
scope: work
tags: [cowork, ero, orchestrator, morning]
---

# cowork:ero-morning

ERO work-scope morning briefing. Reads calendar + project boards + active threads + invoice state, writes one collapsed `[!abstract]+ Morning Briefing` callout into today's daily note at the `<!-- COWORK_CALLOUTS -->` anchor, and refreshes `active-projects.md` + `active-threads.md`. Monday cadence adds a Week Ahead sub-callout.

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ "required": ["obsidian", "google-calendar"] }`. If the return is not `"ready"`, emit Notice `cowork:ero-morning aborted -- <status>` and exit. No writes.
2. Use Skill `cowork:date-context` with `{}`. Capture `{ today: <date>, dddd: <weekday>, MM-Month: <month_folder>, YYYY: <year>, daily_path }` plus the derived `month_name` (split from `MM-Month`), `month_num` (split from `MM-Month`), `is_monday` (true when `dddd == "Monday"`), and `is_25th_or_later` (true when day-of-month >= 25).
3. Use Skill `cowork:ensure-daily-note` with `{ date: <date>, weekday: <weekday>, month_name: <month_name>, path: <daily_path> }`. If the returned `status` is not `"exists"` or `"created"`, emit Notice `cowork:ero-morning aborted -- daily note unavailable` and exit.

## Gather

1. Use Skill `cowork:gather-calendar` with `{ date_today: <date>, scope: "work", horizon: <if is_monday then "next-week" else "today">, range_start: <if is_monday then this_monday else null>, range_end: <if is_monday then next_friday else null>, timezone: "America/Denver" }`. Capture `{ today_events, week_ahead_events?, ai_committee_status?, markdown }`.
2. Use Skill `cowork:gather-projects` with `{ scope: "work", thresholds: { blocked_age_days: 3, stale_card_days: 5 } }`. Capture `{ projects, thread_triggers }`.
3. Use Skill `cowork:gather-threads` with `{ date_today: <date>, mode: "morning-surface", scope: "work", auto_create: <thread_triggers from step 2> }`. Capture `{ open_threads, snoozed_to_open, new_threads, markdown }`.
4. Use Skill `cowork:gather-finance-yesterday` with `{ date_yesterday: <date - 1d>, scope: "work", mode: "daily", include_invoice_pulse: true }`. Capture `{ invoice_path, hours_logged, amount_logged, invoice_submitted }`.

## Write

1. Use Skill `cowork:write-callout-morning-briefing-ero` with `{ date: <date>, weekday: <weekday>, month_name: <month_name>, is_monday: <is_monday>, is_25th_or_later: <is_25th_or_later>, calendar: <Gather step 1.markdown>, gmail: "", projects: <projects rendered as markdown>, threads_digest: <Gather step 3.markdown>, invoice_status: "[[<invoice_path basename>|<month_name> <year> Invoice]] -- <hours_logged> hrs logged ($<amount_logged> at $150/hr)." }`. Capture the returned `markdown` as `callout_markdown`.
2. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: <daily_path>, callouts: [{ id: "morning-briefing", body: <callout_markdown> }] }`. The sub-skill handles marker location, idempotent replace-by-id, and `## Notes` fallback.

## State

1. Use Skill `cowork:update-active-threads` with `{ scope: "work", phase: "morning-pass", date_today: <date>, writer: "cowork:ero-morning", changes: { new_threads: <Gather step 3.new_threads>, snoozed_to_open: <Gather step 3.snoozed_to_open>, resolved: [], surface_open: true } }`. The sub-skill rewrites `spice/cowork/context/active-threads.md` and stamps `updated` + `updated_by: cowork:ero-morning`.
2. Use Skill `cowork:update-active-projects` with `{ phase: "morning-pass", date_today: <date>, writer: "cowork:ero-morning", changes: { projects: <Gather step 2.projects> } }`. The sub-skill rewrites `## Current Projects` from the gather payload, preserves `## Reading Project Status`, and stamps `updated` + `updated_by`.

## Done

Emit Obsidian Notice `cowork:ero-morning complete -- <date>` listing the counts: `<N events>, <N projects>, <N open threads>, invoice <hours>h/$<amount>`.
