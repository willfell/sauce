---
name: cowork:monthly-review
description: Engagement-aware monthly review. Composes a standalone monthly summary note for one engagement (reviews the PREVIOUS month) plus a link callout in today's daily note. Phrasings = "monthly review for <engagement>", "<engagement> monthly", "monthly summary for <engagement>".
schedule: Cron-driven per enabled (engagement, monthly) pair (typically 1st of month for personal + consulting)
scope: shared
tags: [cowork, orchestrator, monthly, engagement-aware]
---

# cowork:monthly-review

First-of-month deep pass for one engagement. Reviews the PREVIOUS month. Creates a standalone monthly review note at `spice/cowork/summaries/monthly/<engagement.id>/<prev_month_yyyymm>.md`, patches a link callout into today's daily note under `## Monthly — <engagement.label>`, and refreshes `active-threads.md` + `weekly-snapshot.md`. For finance-tracking engagements, the Credit Debt Payoff month-close is the authoritative reconciliation moment for the zero-CC-debt goal.

## Inputs

```
{
  engagement_id: string
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:monthly-review aborted -- <status>` and exit.
2. **Resolve engagement.** Read vault-config.md; look up engagement by id; load type manifest; capture `engagement` + `render_aspects`.
3. Use Skill `cowork:date-context` with `{}`. Capture `context` — critically `prev_month_start`, `prev_month_end`, `prev_month_label`, `prev_month_yyyymm`, plus today's `daily_path`.
4. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. If `render_aspects.finance_block == "include"`: use Skill `cowork:gather-finance-yesterday` with `{ engagement_id, date_yesterday: context.prev_month_end, mode: "full-month", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
6. If `render_aspects.finance_block == "include"`: use Skill `cowork:gather-cc-debt-snapshot` with `{ engagement_id, date_today: context.today, mode: "monthly-close", month_range: { start: context.prev_month_start, end: context.prev_month_end }, append_to_tracker: true }`.
7. Use Skill `cowork:gather-calendar` with `{ engagement_id, date_today: context.today, horizon: "next-month", range_start: context.next_month_start, range_end: context.next_month_end, timezone: "America/Denver" }`.
8. Use Skill `cowork:gather-imessage` with `{ engagement_id, window_days: 31, scope: "inner-circle" }` (gated: personal-only).
9. Use Skill `cowork:gather-projects` with `{ engagement_id, filter: "monthly", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
10. Use Skill `cowork:gather-threads` with `{ engagement_id, date_today: context.today, mode: "monthly-audit", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
11. Forward-look stressors (inline scan): `spice/trips/` (next 30-45 days), `spice/finance/budgets/` (annual bills next month), explicit "planned purchase" notes. Assemble the Forward look list. (Currently inline; planned `cowork:gather-forward-stressors` sub-skill carry.)
12. If `render_aspects.invoice_prep == "include"` AND `engagement.invoice_cadence == "monthly"`: use Skill `cowork:write-summary-invoice-prep` with `{ engagement, date_today: context.today, mode: "monthly", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`. Capture `invoice_block`.
13. If `render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`: use Skill `cowork:write-summary-fte-status` with `{ engagement, date_today: context.today, mode: "monthly" }`. Capture `fte_status_block`.

## Write

14. Use Skill `cowork:write-summary-monthly` with `{ engagement, render_aspects, today: context.today, prev_month_label: context.prev_month_label, prev_month_yyyymm: context.prev_month_yyyymm, finance: <step 5 or null>, cc_debt: <step 6 or null>, next_month_calendar: <step 7>, people_pulse: <step 8 or null>, projects: <step 9>, threads: <step 10>, forward_look_stressors: <step 11>, invoice_block: <step 12 or "">, fte_status_block: <step 13 or ""> }`. The sub-skill writes the summary note to `spice/cowork/summaries/monthly/<engagement.id>/<prev_month_yyyymm>.md` and returns `{ summary_path, markdown }`.
15. Compose the daily-note link callout: `> [!abstract]- Monthly Review — <engagement.label> <prev_month_label>\n> [[<summary_path basename>|Full Monthly Review]]`.
16. Use Skill `cowork:patch-daily-callouts` with `{ engagement_id, daily_path: context.daily_path, callouts: [{ id: "monthly-review", body: <link callout> }] }`.

## State

17. Use Skill `cowork:update-active-threads` with `{ engagement_id, phase: "monthly-refresh", date_today: context.today, writer: "cowork:monthly-review", changes: { archive_resolved_older_than_days: 14, audit_full: true, financial_state_refresh: <step 5 and 6 condensed or null> } }`.
18. Use Skill `cowork:update-weekly-snapshot` with `{ engagement_id, phase: "monthly-reset", date_today: context.today, writer: "cowork:monthly-review", snapshot_data: { archive_previous_month: true, prev_month_yyyymm: context.prev_month_yyyymm } }`.

## Done
