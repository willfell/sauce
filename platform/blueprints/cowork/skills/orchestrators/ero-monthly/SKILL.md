---
name: cowork:ero-monthly
description: ERO month-close review (hours, projects, threads, meetings, invoice); writes monthly summary, refreshes context.
schedule: 1st of month 8:00 AM MT
scope: work
tags: [cowork, ero, orchestrator, monthly]
---

# cowork:ero-monthly

ERO work-scope month-close review covering the month that JUST ENDED. Produces a standalone summary at `spice/cowork/summaries/monthly/<prev_month_yyyymm>.md` (canonical YYYY-MM shape), finalizes the previous month's invoice via the invoice-prep sub-skill (canonical month-close), patches a link callout into today's daily note, and refreshes context files.

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian", "google-calendar"] }`. If not `"ready"`, emit Notice `cowork:ero-monthly aborted -- <status>` and exit.
2. Use Skill `cowork:date-context` with `{}`. Capture `{ today, dddd, MM-Month, YYYY, daily_path, prev_month_start, prev_month_end, prev_month_label, prev_month_yyyymm }` plus derived `month_name`, `month_num`, `prev_month_num`, `prev_month_name`, `prev_month_year`, `next_month_start`, `next_month_end`. The "previous month" is the review's subject -- running on 2026-06-01 reviews 2026-05.
3. Use Skill `cowork:ensure-daily-note` with `{ date: <today>, weekday: <dddd>, month_name: <month_name>, path: <daily_path> }`. On failure, emit Notice and exit.

## Gather

1. Use Skill `cowork:gather-projects` with `{ scope: "work", filter: "monthly", month_range: { start: <prev_month_start>, end: <prev_month_end> }, thresholds: { blocked_age_days: 3, stale_card_days: 5 } }`. Capture `{ projects, thread_triggers, daily_count, journal_count, todo_count, task_velocity }`.
2. Hours-and-sessions month roll-up: same pattern as ero-weekly Gather step 2. The month-window Time Log traversal is owned by the gather-projects monthly extension (orchestrator MUST NOT inline `mcp__obsidian__list_directory`). Capture `hours_data = { total_hours_month, hours_per_week, sessions, gap_weeks, days_with_logged_work, weekday_count_in_month }`.
3. Use Skill `cowork:gather-threads` with `{ date_today: <today>, mode: "monthly-audit", scope: "work", auto_create: <thread_triggers>, month_range: { start: <prev_month_start>, end: <prev_month_end> } }`. Capture `{ opened_this_month, resolved_this_month, still_open, stale_over_7d, longest_running, average_resolution_days }`.
4. Meetings month roll-up: same pattern as ero-weekly Gather step 4. Pass `meetings: <gather extension payload>` and surface a Notice if the extension is not yet wired.
5. Use Skill `cowork:invoice-prep` with `{ month: "<prev_month_year>-<prev_month_num>", rate: {{ero_hourly_rate_usd}} }`. This is the AUTHORITATIVE month-close invoice run. Capture the full payload.
6. Use Skill `cowork:gather-calendar` with `{ date_today: <today>, scope: "work", horizon: "next-month", range_start: <next_month_start>, range_end: <next_month_end>, timezone: "America/Denver" }`. Capture `{ next_month_events, recurring_holds, ai_committee_meetings }`.
7. Project movement vs prior month: read the previous monthly summary at `spice/cowork/summaries/monthly/<prev_prev_month_yyyymm>.md` if it exists. The summary read for delta computation is performed by the same gather-projects monthly extension (the orchestrator MUST NOT inline `mcp__obsidian__read_note`). If the prior monthly summary is missing, the gather-projects payload marks all deltas as `"first month"`.

## Write

1. Use Skill `cowork:write-summary-monthly-ero` with `{ date: <today>, prev_month_start: <prev_month_start>, prev_month_end: <prev_month_end>, prev_month_name: <prev_month_name>, prev_month_year: <prev_month_year>, month: "<prev_month_year>-<prev_month_num>", hours: <hours_data>, projects: <Gather step 1.projects with mom_delta>, threads: <Gather step 3>, meetings: <Gather step 4>, invoice: <Gather step 5>, next_month_events: <Gather step 6.next_month_events>, ai_committee_meetings: <Gather step 6.ai_committee_meetings> }`. The sub-skill writes the summary note to `spice/cowork/summaries/monthly/<prev_month_yyyymm>.md` and returns `{ summary_path, markdown }`. The orchestrator does NOT write the summary file -- the sub-skill owns the write.
2. Compose the daily-note link callout: `> [!abstract]- Monthly Review\n> [[<summary_path basename>|Full Monthly Review -- <prev_month_name> <prev_month_year>]]`.
3. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: <daily_path>, callouts: [{ id: "monthly-review", body: <link callout> }] }`. Idempotent replace-by-id.

## State

1. Use Skill `cowork:update-active-threads` with `{ scope: "work", phase: "monthly-pass", date_today: <today>, writer: "cowork:ero-monthly", changes: { archive_resolved_older_than_days: 14, validate_open_threads: true, surface_open: false, audit_full: true } }`.
2. Use Skill `cowork:update-active-projects` with `{ phase: "monthly-pass", date_today: <today>, writer: "cowork:ero-monthly", changes: { projects: <Gather step 1.projects> } }`.
3. Use Skill `cowork:update-weekly-snapshot` with `{ scope: "work", phase: "monthly-reset", date_today: <today>, writer: "cowork:ero-monthly", snapshot_data: { archive_previous_month: true, prev_month_yyyymm: <prev_month_yyyymm>, hours: <hours_data>, project_movement: <Gather step 1.projects>, threads: <Gather step 3>, meetings: <Gather step 4> } }`.

## Done

Emit Notice `cowork:ero-monthly complete -- <prev_month_name> <prev_month_year>` with: `<total_hours>h / $<amount>, <N projects active>, <N resolved>/<N opened>/<N still open>, summary at <summary_path>, invoice <submitted|pending>`.
