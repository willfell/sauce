---
name: cowork:weekly-review
description: Compose weekly summary (spending, habits, projects, threads, people, next-week); patch link callout; refresh ctx.
schedule: Sundays 6:00 PM MT (~2.5min jitter)
scope: life
tags: [cowork, orchestrator, life, weekly]
---

# cowork:weekly-review

Sunday end-of-week deep pass. Creates a standalone weekly summary note at `spice/cowork/summaries/weekly/<YYYY-Www>.md`, then patches a link callout into today's daily note. Refreshes `active-threads.md`, `weekly-snapshot.md`, and `finance-goals.md`. Idempotent: re-runs replace the summary file content and the daily-note link callout.

## Pre-flight
1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian", "gmail", "google-calendar", "brex", "imessage"] }`. If not `"ready"`, emit Notice `cowork:weekly-review aborted -- <status>` and exit.
2. Use Skill `cowork:date-context` with `{}`. Capture `context` (today, dddd, week_of, week_range, week_start, week_end, daily_path, iso_week_label).
3. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather
4. Use Skill `cowork:gather-finance-yesterday` with `{ date_yesterday: context.today, scope: "life", mode: "full-week", week_range: { start: context.week_start, end: context.week_end } }`. Returns per-category spend table this-week vs last-week, week-over-week total, top problem categories, current CC balance table, interest-this-month-so-far, debt-payoff trajectory.
5. Use Skill `cowork:gather-cc-debt-snapshot` with `{ date_today: context.today, mode: "weekly", append_to_tracker: true, week_range: { start: context.week_start, end: context.week_end } }`. Sub-skill appends a row to `spice/finance/debt/Credit Debt Payoff Tracker.md` Progress log and returns `{ markdown, total_usd, on_pace }`.
6. Use Skill `cowork:gather-calendar` with `{ date_today: context.today, scope: "life", horizon: "next-week", range_start: context.next_week_start, range_end: context.next_week_end, timezone: "America/Denver" }`.
7. Use Skill `cowork:gather-gmail` with `{ window: "newer_than:7d", filters: ["-category:promotions", "-category:social", "-category:updates", "-category:forums"] }`.
8. Use Skill `cowork:gather-imessage` with `{ window_days: 7, scope: "inner-circle" }`.
9. Use Skill `cowork:gather-projects` with `{ scope: "life", filter: "weekly", week_range: { start: context.week_start, end: context.week_end } }`. Returns daily/journal/todo counts + kanban completed-this-week + side-quest movement (under `spice/boards/side-quests/`) + task velocity.
10. Use Skill `cowork:gather-threads` with `{ date_today: context.today, mode: "weekly-audit", scope: "life", week_range: { start: context.week_start, end: context.week_end } }`.

## Write
11. Use Skill `cowork:write-summary-weekly-life` with `{ date: context.today, week_start: context.week_start, week_end: context.week_end, finance: <step 4>, cc_debt: <step 5>, calendar: <step 6>, email_metrics: <step 7>, people_pulse: <step 8>, projects: <step 9>, threads: <step 10> }`. The sub-skill writes the summary note to `spice/cowork/summaries/weekly/<YYYY-Www>.md` and returns `{ summary_path, markdown }`. The orchestrator does NOT write the summary file - the sub-skill owns the write.
12. Compose the daily-note link callout inline as `> [!abstract]- Weekly Review\n> [[<summary_path basename>|Full Weekly Review]]`.
13. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: context.daily_path, callouts: [{ id: "weekly-review", body: <link callout from step 12> }] }`. Idempotent replace-by-id.

## State
14. Use Skill `cowork:update-active-threads` with `{ scope: "life", phase: "weekly-refresh", date_today: context.today, writer: "cowork:weekly-review", changes: { archive_resolved_older_than_days: 14, stale_recommendations: <step 10.stale_over_7d>, snoozed_to_open: <step 10.snoozed_to_open>, financial_state_refresh: { finance: <step 4 condensed>, cc_debt: <step 5 condensed> } } }`.
15. Use Skill `cowork:update-weekly-snapshot` with `{ scope: "life", phase: "weekly-close", date_today: context.today, writer: "cowork:weekly-review", snapshot_data: { week_of: context.week_of, archive_to_previous: true, totals: { wtd_spend: <step 4.total_usd>, cc_total: <step 5.total_usd>, journaled_days: <step 9.journal_count>, daily_note_days: <step 9.daily_count>, todo_days: <step 9.todo_count>, threads_opened: <step 10.opened_this_week.length>, threads_resolved: <step 10.resolved_this_week.length> } } }`.
16. Refresh `spice/cowork/context/finance-goals.md` (BALANCES_START / BUDGET_ANALYSIS_START markers). This is currently a documented gap - defer to a follow-up `cowork:update-finance-goals` sub-skill (S2.B follow-up). For v0.30.0, surface as a Notice if balances shifted >$500 vs the prior weekly snapshot; do NOT inline an MCP write.

## Done
