---
name: cowork:ero-weekly
description: ERO Sunday weekly review (hours, projects, threads, meetings, invoice, next-week); summary note, refreshes context.
schedule: Sundays 6:00 PM MT
scope: work
tags: [cowork, ero, orchestrator, weekly]
---

# cowork:ero-weekly

ERO work-scope weekly aggregation. Produces a standalone summary note at `spice/cowork/summaries/weekly/<YYYY-Www>.md` (canonical ISO-week shape), patches a link callout into today's daily note, and refreshes all three living context files (`active-projects.md`, `active-threads.md`, `weekly-snapshot.md`). Deepest context update of the week.

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian", "google-calendar"] }`. If not `"ready"`, emit Notice `cowork:ero-weekly aborted -- <status>` and exit.
2. Use Skill `cowork:date-context` with `{}`. Capture `{ today, dddd, MM-Month, YYYY, week_start, week_end, week_of, daily_path }` plus derived `month_name`, `month_num`, `next_week_start`, `next_week_end`. `week_start` is the Monday of the week ending today (Sunday).
3. Use Skill `cowork:ensure-daily-note` with `{ date: <today>, weekday: <dddd>, month_name: <month_name>, path: <daily_path> }`. On failure, emit Notice and exit.

## Gather

1. Use Skill `cowork:gather-projects` with `{ scope: "work", filter: "weekly", week_range: { start: <week_start>, end: <week_end> }, thresholds: { blocked_age_days: 3, stale_card_days: 5 } }`. Capture `{ projects, thread_triggers, daily_count, journal_count, todo_count, task_velocity }`.
2. Hours-and-sessions roll-up: a dedicated `cowork:gather-time-log` sub-skill is a v0.31.0 follow-up (orchestrator must NOT inline `mcp__obsidian__list_directory`). For v0.30.0 surface as the per-day Time Log payload returned by `cowork:gather-projects` weekly mode (the gather sub-skill is widened to traverse daily notes for the week and parse Time Log tables alongside the project counts). Capture `hours_data = { total_hours_week, hours_per_day, sessions, gap_days }` from the gather-projects extension.
3. Use Skill `cowork:gather-threads` with `{ date_today: <today>, mode: "weekly-audit", scope: "work", auto_create: <thread_triggers>, week_range: { start: <week_start>, end: <week_end> } }`. Capture `{ opened_this_week, resolved_this_week, still_open, stale_over_7d, snoozed_to_open }`.
4. Meetings roll-up: same pattern as Gather step 2 -- the meetings traversal is owned by the gather-projects weekly extension (or a future `cowork:gather-meetings` sub-skill, v0.31.0). For v0.30.0 the orchestrator passes the `meetings` payload through unchanged; if the extension is not yet wired, pass `meetings: []` and surface a Notice. Do NOT inline `mcp__obsidian__list_directory`.
5. Use Skill `cowork:invoice-prep` with `{ month: "<YYYY>-<month_num>", rate: {{ero_hourly_rate_usd}} }`. Capture the full payload.
6. Use Skill `cowork:gather-calendar` with `{ date_today: <today>, scope: "work", horizon: "next-week", range_start: <next_week_start>, range_end: <next_week_end>, timezone: "America/Denver" }`. Capture `{ next_week_events, ai_committee_status }`.
7. Threads-crossing-thresholds: from `still_open` (step 3), compute which threads will pass the 7-day stale threshold during `[next_week_start ... next_week_end]`. Output a list of `{ thread_id, will_cross_on_date, current_age_days }` for the Next Week section.

## Write

1. Use Skill `cowork:write-summary-weekly-ero` with `{ date: <today>, week_start: <week_start>, week_end: <week_end>, month_name: <month_name>, year: <YYYY>, hours: <hours_data>, projects: <Gather step 1.projects>, threads: <Gather step 3 + crossing list>, meetings: <Gather step 4>, invoice: <Gather step 5>, next_week_events: <Gather step 6.next_week_events>, ai_committee_status: <Gather step 6.ai_committee_status> }`. The sub-skill writes the summary note to `spice/cowork/summaries/weekly/<YYYY-Www>.md` and returns `{ summary_path, markdown }`. The orchestrator does NOT write the summary file -- the sub-skill owns the write.
2. Compose the daily-note link callout: `> [!abstract]- Weekly Review\n> [[<summary_path basename>|Full Weekly Review]]`.
3. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: <daily_path>, callouts: [{ id: "weekly-review", body: <link callout> }] }`. Idempotent replace-by-id.

## State

1. Use Skill `cowork:update-active-threads` with `{ scope: "work", phase: "weekly-pass", date_today: <today>, writer: "cowork:ero-weekly", changes: { snoozed_to_open: <Gather step 3.snoozed_to_open>, resolved: [], archive_resolved_older_than_days: 14, validate_open_threads: true, surface_open: false } }`.
2. Use Skill `cowork:update-active-projects` with `{ phase: "weekly-pass", date_today: <today>, writer: "cowork:ero-weekly", changes: { projects: <Gather step 1.projects> } }`.
3. Use Skill `cowork:update-weekly-snapshot` with `{ scope: "work", phase: "weekly-close", date_today: <today>, writer: "cowork:ero-weekly", snapshot_data: { week_of: <next_week_start>, hours: <hours_data>, project_movement: <Gather step 1.projects>, threads: <Gather step 3>, meetings: <Gather step 4> } }`.

## Done

Emit Notice `cowork:ero-weekly complete -- week <week_start>..<week_end>` with: `<total_hours>h, <N projects active>, <N resolved>/<N opened>/<N still open>, summary at <summary_path>`.
