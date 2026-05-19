---
name: cowork:weekly-review
description: Engagement-aware weekly review. Composes a standalone weekly summary note for one engagement plus a link callout in today's daily note. Phrasings = "weekly review for <engagement>", "<engagement> weekly", "weekly summary for <engagement>".
schedule: Cron-driven per enabled (engagement, weekly) pair (typically Sundays for personal; Fridays for w2-fte / consulting)
scope: shared
tags: [cowork, orchestrator, weekly, engagement-aware]
---

# cowork:weekly-review

End-of-week deep pass for one engagement. Creates a standalone weekly summary note at `spice/cowork/summaries/weekly/<engagement.id>/<YYYY-Www>.md`, then patches a link callout into today's daily note under `## Weekly — <engagement.label>`. Refreshes `active-threads.md` + `weekly-snapshot.md` for this engagement's slice. Idempotent: re-runs replace the summary file content and the daily-note link callout.

## Inputs

```
{
  engagement_id: string
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:weekly-review aborted -- <status>` and exit.
2. **Resolve engagement.** Read vault-config.md; look up engagement by id; load type manifest; capture `engagement` + `render_aspects`.
3. Use Skill `cowork:date-context` with `{}`. Capture `context` (today, dddd, week_of, week_range, week_start, week_end, daily_path, iso_week_label).
4. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. If `render_aspects.finance_block == "include"`: use Skill `cowork:gather-finance-yesterday` with `{ engagement_id, date_yesterday: context.today, mode: "full-week", week_range: { start: context.week_start, end: context.week_end } }`.
6. If `render_aspects.finance_block == "include"`: use Skill `cowork:gather-cc-debt-snapshot` with `{ engagement_id, date_today: context.today, mode: "weekly", append_to_tracker: true, week_range: { start: context.week_start, end: context.week_end } }`.
7. Use Skill `cowork:gather-calendar` with `{ engagement_id, date_today: context.today, horizon: "next-week", range_start: context.next_week_start, range_end: context.next_week_end, timezone: "America/Denver" }`.
8. Use Skill `cowork:gather-gmail` with `{ engagement_id, window: "newer_than:7d" }`.
9. Use Skill `cowork:gather-imessage` with `{ engagement_id, window_days: 7, scope: "inner-circle" }` (gated: skipped when engagement.type != "personal").
10. Use Skill `cowork:gather-projects` with `{ engagement_id, filter: "weekly", week_range: { start: context.week_start, end: context.week_end } }`.
11. Use Skill `cowork:gather-threads` with `{ engagement_id, date_today: context.today, mode: "weekly-audit", week_range: { start: context.week_start, end: context.week_end } }`.
12. If `render_aspects.invoice_prep == "include"`: use Skill `cowork:write-summary-invoice-prep` with `{ engagement, date_today: context.today, mode: "weekly" }` IF `engagement.invoice_cadence` indicates weekly invoicing. Capture `invoice_block` (markdown). Else `invoice_block = ""`.
13. If `render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`: use Skill `cowork:write-summary-fte-status` with `{ engagement, date_today: context.today, mode: "weekly" }`. Capture `fte_status_block`. Else `fte_status_block = ""`.

## Write

14. **Read prompt body** via `mcp__obsidian__get_file_contents` at `spice/cowork/prompts/weekly-review.md`. Strip frontmatter; capture body as `prompt_body` (or empty when missing).
15. **Compose run-note body** per `prompt_body` instructions interpolating week-summary gather outputs. When empty: `warning = "empty_prompt"`. Otherwise `warning = null`.
16. Use Skill `cowork:write-run-note-weekly-review` with `{ engagement, week: context.iso_week, year: context.year, body: run_body, prompt_source: "spice/cowork/prompts/weekly-review.md", warning }`. Capture `status`. If `status` starts with `"failed:"`, emit Notice `cowork:weekly-review aborted -- write failed: <status>` and exit.

## State

17. Use Skill `cowork:update-active-threads` with `{ engagement_id, phase: "weekly-refresh", date_today: context.today, writer: "cowork:weekly-review", changes: { archive_resolved_older_than_days: 14, stale_recommendations: <step 11.stale_over_7d>, snoozed_to_open: <step 11.snoozed_to_open>, financial_state_refresh: <step 5 and 6 condensed or null> } }`.
18. Use Skill `cowork:update-weekly-snapshot` with `{ engagement_id, phase: "weekly-close", date_today: context.today, writer: "cowork:weekly-review", snapshot_data: { week_of: context.week_of, archive_to_previous: true, totals: { ...condensed metrics... } } }`.

## Done
