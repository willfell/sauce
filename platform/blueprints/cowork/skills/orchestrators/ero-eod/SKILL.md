---
name: cowork:ero-eod
description: ERO weekday EOD review (wrap-up, time logging, threads, invoice update); adds invoice prep on the 25th+.
schedule: Weekday 6:02 PM MT (~2.5min jitter)
scope: work
tags: [cowork, ero, orchestrator, eod]
---

# cowork:ero-eod

ERO work-scope EOD review. Writes one collapsed `[!example]- EOD Review` callout into today's daily note after the morning briefing block, manages active-thread lifecycle (resolve / open / snooze), updates the invoice's running hours, and on the 25th-or-later runs the full invoice-prep aggregation.

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ "required": ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:ero-eod aborted -- <status>` and exit. No writes.
2. Use Skill `cowork:date-context` with `{}`. Capture `{ today, dddd, tomorrow, tomorrow_weekday, MM-Month, YYYY, daily_path }` plus derived `month_name`, `month_num`, `is_25th_or_later`.
3. Use Skill `cowork:ensure-daily-note` with `{ date: <today>, weekday: <dddd>, month_name: <month_name>, path: <daily_path> }`. On `status` other than `"exists"` / `"created"`, emit Notice and exit.

## Gather

1. Use Skill `cowork:gather-projects` with `{ scope: "work", filter: "today-status", today: <today>, thresholds: { blocked_age_days: 3, stale_card_days: 5 } }`. Capture `{ projects, thread_triggers, completed, incomplete }`. Diff against the morning briefing's project state via `cowork:update-active-projects` read snapshot if needed (sub-skill exposes the read path); the orchestrator does NOT inline raw `mcp__obsidian__*` reads.
2. Use Skill `cowork:gather-threads` with `{ date_today: <today>, mode: "eod-reconcile", scope: "work", auto_create: <thread_triggers>, auto_resolve_hints: <projects.completed_today_cards> }`. Capture `{ open_threads, resolved_today, new_threads, snoozed_to_open, markdown }`.
3. Determine session hours: rely on the daily note's `[!abstract]+ Time Log` table (set explicitly during the day). The orchestrator does NOT inline reads; instead pass `time_log_present: false` to the writer and let `cowork:write-callout-eod-ero` render the unmissable Fill-This-In placeholder. (Future v0.31.0: a dedicated `cowork:gather-time-log` sub-skill will own the parse.)
4. If `is_25th_or_later`, use Skill `cowork:invoice-prep` with `{ month: "<YYYY>-<month_num>", rate: {{ero_hourly_rate_usd}} }`. Capture the full payload `{ invoice_path, hours, amount, line_items, gaps, summary_markdown }`.

## Write

1. Use Skill `cowork:write-callout-eod-ero` with `{ date: <today>, tomorrow_date: <tomorrow>, tomorrow_weekday: <tomorrow_weekday>, weekday: <dddd>, month_name: <month_name>, is_25th_or_later: <is_25th_or_later>, completed: <Gather step 1.completed rendered as markdown>, time_log: "", threads_changes: <Gather step 2.markdown>, followups: <Gather step 1.followups rendered as markdown>, invoice_summary: <Gather step 4.summary_markdown or ""> }`. Capture `callout_markdown`.
2. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: <daily_path>, callouts: [{ id: "eod-review", body: <callout_markdown> }] }`. Idempotent replace-by-id; marker fallback handled by sub-skill.
3. If `is_25th_or_later` is false: invoice-prep was not run. The frontmatter update on the running invoice note is owned by `cowork:invoice-prep` when invoked at month-close. For mid-month hour bumps, the user updates the Time Log in the daily note manually; no orchestrator-level invoice mutation is performed here. (v0.31.0 follow-up: introduce `cowork:update-invoice-running-hours` for this gap.)

## State

1. Use Skill `cowork:update-active-threads` with `{ scope: "work", phase: "eod-pass", date_today: <today>, writer: "cowork:ero-eod", changes: { new_threads: <Gather step 2.new_threads>, snoozed_to_open: <Gather step 2.snoozed_to_open>, resolved: <Gather step 2.resolved_today>, surface_open: false } }`.

## Done

Emit Obsidian Notice `cowork:ero-eod complete -- <today>` listing: `<N resolved>, <N new>, <N still open>` and on `is_25th_or_later` add ` -- invoice prep ran ($<amount>)`.
