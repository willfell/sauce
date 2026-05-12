---
name: cowork:eod-review
description: Engagement-aware end-of-day review. Composes the EOD callout (todo status, morning follow-up, tomorrow preview, late emails) for one engagement and patches it into today's daily note. Phrasings = "eod for <engagement>", "<engagement> eod review", "give me today's eod for <engagement>".
schedule: Cron-driven per enabled (engagement, eod) pair
scope: shared
tags: [cowork, orchestrator, eod, engagement-aware]
---

# cowork:eod-review

Closes the day for one engagement. Compiles completed/incomplete tasks, compares against the morning briefing's flagged items, previews tomorrow's calendar, surfaces late emails, and updates the active-threads ledger. Writes one `[!example]-` callout to today's daily note under `## EOD — <engagement.label>` within the `<!-- COWORK_CALLOUTS -->` block. Re-run replaces the block in place.

## Inputs

```
{
  engagement_id: string
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:eod-review aborted -- <status>` and exit.
2. **Resolve engagement.** Read vault-config.md; look up engagement by id; load type manifest; capture `engagement` + `render_aspects`.
3. Use Skill `cowork:date-context` with `{}`. Capture `context` (today, tomorrow, daily_path, tomorrow_daily_path, tomorrow_weekday).
4. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. Use Skill `cowork:gather-projects` with `{ engagement_id, filter: "today-status", today: context.today }`. Capture completed / incomplete / kanban buckets.
6. Use Skill `cowork:gather-calendar` with `{ engagement_id, date_today: context.tomorrow, horizon: "today", timezone: "America/Denver" }`.
7. Use Skill `cowork:gather-gmail` with `{ engagement_id, window: "newer_than:12h" }`. Compute `late_emails` = emails arrived after morning-briefing run time.
8. Use Skill `cowork:gather-threads` with `{ engagement_id, date_today: context.today, mode: "eod-reconcile" }`.
9. Compose `morning_followup` summary by reading the matching `## Morning — <engagement.label>` block in today's daily note: `{ flagged_transactions, unanswered_messages, threads: { resolved, snoozed, still_open } }`.

## Write

10. Use Skill `cowork:write-callout-eod-review` with `{ engagement, render_aspects, date: context.today, tomorrow_date: context.tomorrow, tomorrow_weekday: context.tomorrow_weekday, completed: <step 5.completed as md>, carrying_over: <step 5.incomplete as md>, morning_followup: <step 9 as md>, threads_changes: <step 8 as md>, tomorrow_calendar: <step 6.markdown>, late_emails: <step 7.markdown filtered to late window> }`. Capture `eod_markdown`. Internal type-branch picks the per-type callout shape (e.g. wellness prompts for personal-type only).
11. Use Skill `cowork:patch-daily-callouts` with `{ engagement_id, daily_path: context.daily_path, callouts: [{ id: "eod-review", body: <eod_markdown> }] }`.

## State

12. Use Skill `cowork:update-active-threads` with `{ engagement_id, phase: "eod-pass", date_today: context.today, writer: "cowork:eod-review", changes: { resolved: <step 8.resolved_today>, snoozed_to_open: <step 8.snoozed_today>, new_threads: <step 8.auto_created_eod> } }`.
13. Use Skill `cowork:update-weekly-snapshot` with `{ engagement_id, phase: "eod", date_today: context.today, writer: "cowork:eod-review", snapshot_data: { completed_count: <step 5.completed.length>, carryover_count: <step 5.incomplete.length>, threads_resolved_today: <step 8.resolved_today.length> } }`.

## Done
