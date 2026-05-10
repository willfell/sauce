---
name: cowork:monthly-review
description: Compose monthly review (spending, goals, habits, projects, threads, debt-payoff); patch link callout; refresh ctx.
schedule: 1st of each month 8:00 AM MT (~2.5min jitter)
scope: life
tags: [cowork, orchestrator, life, monthly]
---

# cowork:monthly-review

First-of-month deep pass. Reviews the PREVIOUS month (the one that just ended). Creates a standalone monthly review note at `spice/cowork/summaries/monthly/<prev_month_yyyymm>.md`, patches a link callout into today's daily note, and refreshes `active-threads.md`, `weekly-snapshot.md`, `finance-goals.md`. The Credit Debt Payoff month-close is the authoritative reconciliation moment for the 2-year zero-CC-debt goal.

## Pre-flight
1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian", "google-calendar", "brex"] }`. If not `"ready"`, emit Notice `cowork:monthly-review aborted -- <status>` and exit.
2. Use Skill `cowork:date-context` with `{}`. Capture `context` -- critically `prev_month_start`, `prev_month_end`, `prev_month_label`, `prev_month_yyyymm`, plus today's `daily_path`.
3. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather
4. Use Skill `cowork:gather-finance-yesterday` with `{ date_yesterday: context.prev_month_end, scope: "life", mode: "full-month", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`. Returns: month total spend, MoM delta, top-5 merchants, spend-by-category table, budget adherence (compares against `spice/finance/budgets/Budget, <prev_month_yyyymm>.md` if present), paycheck-notes-found flags.
5. Use Skill `cowork:gather-cc-debt-snapshot` with `{ date_today: context.today, mode: "monthly-close", month_range: { start: context.prev_month_start, end: context.prev_month_end }, append_to_tracker: true }`. Sub-skill computes per-card paydown, 30-day balance trend, interest-paid total, on-track call, dispute-status update for any open disputes tracked in `spice/finance/debt/`, recurring-charge audit (cross-references `spice/boards/cards/*/Move recurring charges off credit cards to debit.md`). Appends a comprehensive row to the tracker's Progress log.
6. Use Skill `cowork:gather-calendar` with `{ date_today: context.today, scope: "life", horizon: "next-month", range_start: context.next_month_start, range_end: context.next_month_end, timezone: "America/Denver" }`.
7. Use Skill `cowork:gather-imessage` with `{ window_days: 31, scope: "inner-circle" }`.
8. Use Skill `cowork:gather-projects` with `{ scope: "life", filter: "monthly", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`. Returns daily-note count, journal-entry count, todo-note count, task-completion rate, side-quest status changes (`spice/boards/side-quests/`), and kanban movement.
9. Use Skill `cowork:gather-threads` with `{ date_today: context.today, mode: "monthly-audit", scope: "life", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
10. Forward-look stressors: scan `spice/trips/` for trips with `start_date` within the next 30-45 days, `spice/finance/budgets/` for known annual bills landing next month, and explicit "planned purchase" notes. Assemble the Forward look list. (This bullet is currently inline because no dedicated `cowork:gather-forward-stressors` sub-skill exists; v0.31.0 follow-up will lift it. The orchestrator MUST NOT use raw `mcp__obsidian__*` calls here - use either `cowork:gather-projects` extension or document this as a gap.) For v0.30.0 ship a placeholder list with a Notice if no scan path is wired.

## Write
11. Use Skill `cowork:write-summary-monthly-life` with `{ today: context.today, prev_month_label: context.prev_month_label, prev_month_yyyymm: context.prev_month_yyyymm, finance: <step 4>, cc_debt: <step 5>, next_month_calendar: <step 6>, people_pulse: <step 7>, projects: <step 8>, threads: <step 9>, forward_look_stressors: <step 10> }`. The sub-skill writes the summary note to `spice/cowork/summaries/monthly/<context.prev_month_yyyymm>.md` and returns `{ summary_path, markdown }`. The orchestrator does NOT write the summary file -- the sub-skill owns the write.
12. Compose the daily-note link callout inline as `> [!abstract]- Monthly Review\n> [[<summary_path basename>|Full Monthly Review -- <context.prev_month_label>]]`.
13. Use Skill `cowork:patch-daily-callouts` with `{ daily_path: context.daily_path, callouts: [{ id: "monthly-review", body: <link callout from step 12> }] }`. Idempotent replace-by-id.

## State
14. Use Skill `cowork:update-active-threads` with `{ scope: "life", phase: "monthly-refresh", date_today: context.today, writer: "cowork:monthly-review", changes: { archive_resolved_older_than_days: 14, audit_full: true, financial_state_refresh: { finance: <step 4 condensed>, cc_debt: <step 5 condensed> } } }`.
15. Use Skill `cowork:update-weekly-snapshot` with `{ scope: "life", phase: "monthly-reset", date_today: context.today, writer: "cowork:monthly-review", snapshot_data: { archive_previous_month: true, prev_month_yyyymm: context.prev_month_yyyymm } }`.
16. `spice/cowork/context/finance-goals.md` refresh (BALANCES_START / BUDGET_ANALYSIS_START): deferred to a follow-up `cowork:update-finance-goals` sub-skill (S2.B). For v0.30.0, emit a Notice listing balance changes; do NOT inline an MCP write.

## Done
