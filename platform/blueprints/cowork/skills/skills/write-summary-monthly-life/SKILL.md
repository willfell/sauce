---
name: cowork:write-summary-monthly-life
description: Compose the life monthly review summary note at spice/cowork/summaries/monthly/YYYY-MM.md and return its absolute path.
inputs:
  today: string
  vault_path: string
  month: string
  prev_month_label: string
  prev_month_yyyymm: string
  finance: object
  finance_data: object
  cc_debt: object
  debt_tracker: object
  next_month_calendar: object
  people_pulse: object
  relationships: object
  projects: object
  habits_data: object
  threads: object
  forward_look_stressors: object
outputs:
  summary_path: string
  markdown: string
tags: [cowork, write-summary]
---

# cowork:write-summary-monthly-life

Authors the deepest life-side review of the cycle: month-close spending, goal progress, habits, relationships, projects, thread health, plus the credit-debt-payoff month-close subsection. Dispatched by `cowork:monthly-review` on the 1st of each month covering the prior month.

## Inputs

- `today` (string, optional): today's date `YYYY-MM-DD`. Used for `created` frontmatter and link-callout dates.
- `vault_path` (string, optional): life vault root override.
- `month` (string, optional): `YYYY-MM` of the reviewed (prior) month. (Alias: `prev_month_yyyymm`.)
- `prev_month_label` (string, optional): human label like `April 2026`. Used in H1 and link-callout text.
- `prev_month_yyyymm` (string, optional): same as `month`; preferred shape from orchestrator dispatch.
- `finance` / `finance_data` (object, optional): `{ totals_by_category[], top_5_merchants[], cc_balances_open_close[], interest_paid, mom_delta_pct, budget_adherence }`.
- `cc_debt` / `debt_tracker` (object, optional): per-card paydown, interest, recurring-charge audit, dispute status.
- `next_month_calendar` (object, optional): event list for next 30 days.
- `people_pulse` / `relationships` (object, optional): inner-circle contact map.
- `projects` (object, optional): side quests + kanban movement + journal/todo counts.
- `habits_data` (object, optional): daily-note / journal / todo counts and task completion rate.
- `threads` (object, optional): `{ opened_this_month, resolved_this_month, still_open[], avg_lifespan_days, longest_running }`.
- `forward_look_stressors` (object, optional): forward-look list for the Credit Debt Payoff Month Close section.

## Outputs

- `summary_path` (string).
- `markdown` (string).

## Steps

1. Set `summary_path = <vault_path>/spice/cowork/summaries/monthly/<month>.md` (e.g., `2026-05.md`).
2. Ensure parent directory exists (`spice/cowork/summaries/monthly/`).
3. Render frontmatter: `type: cowork-summary-monthly-life`, `created: <today YYYY-MM-DD>`, `month: <YYYY-MM>`, `tags: [cowork, life, monthly-review]`, `cssclasses: [wide, row-alt]`.
4. Render H1 `Monthly Review - <Month YYYY>`.
5. Render fixed section sequence below.
6. Write via Write tool (full replace).
7. Return `{ summary_path, markdown }`.

## Returns

Markdown body MUST contain these sections in this order, every run:

```markdown
## Month at a Glance
| Metric | Value | (Total spent / vs last month / CC balance change / Days journaled / Daily notes / Threads resolved / Threads open)

## Spending Summary
| Category | This Month | Last Month | Delta |
Top 5 merchants table.
Budget adherence notes (this month's budget vs actual per category).

## Goal Progress
- Credit card payoff trajectory
- Savings rate
- Budget adherence summary
- Emergency fund progress

### Credit Debt Payoff - Month Close
**On-track call:** ahead / on track / behind by $X,XXX
| Card | Opening | Closing | Net Δ | New charges | Payments | Interest |
Month's interest paid (with prior-month comparison).
Category drivers (top 5 credit-card-only).
Recurring-charge audit (should-have-moved subs / new unplanned / reactivated overdue).
Open disputes (with stale flags at 30+ days).
Forward look (next-month stressors).
Month's story (one sentence).

## Habits
- Journaling N/total
- Daily notes N/total
- Todo engagement + tasks completed vs created
- 2026 Atlas goals qualitative check

## Relationships
| Name | Messages | Last Contact |
Anyone going cold (30+ days).
Key relationship events this month.

## Projects and Quests
- Side quest status changes
- Kanban board movement
- Items completed vs added

## Thread Health
- Opened / Resolved / Still open (with ages)
- Longest-running thread
- Average resolution time

## Month Ahead
- Next month calendar preview
- Known deadlines, milestones, trips
- Recommended focus areas

## Honest Take
2-3 sentences. Was this a good month? One thing to change. Weight debt-payoff blockers heavily on a miss.
```

## Errors

- If `summary_path` parent cannot be created, return `{ error: "fs-error:<reason>" }`.
- If a data source is unavailable, render the section header and note the gap inline; never skip the section.
- If finance data is unavailable, flag prominently - financial data is the most critical section.
