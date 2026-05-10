---
name: cowork:write-summary-weekly-life
description: Compose the life weekly review summary note at spice/cowork/summaries/weekly/YYYY-Www.md and return its absolute path.
inputs:
  date: string
  vault_path: string
  week_start: string
  week_end: string
  week_range: string
  finance: object
  finance_data: object
  cc_debt: object
  calendar: object
  email_metrics: object
  people_pulse: object
  people: object
  projects: object
  vault_activity: object
  threads: object
outputs:
  summary_path: string
  markdown: string
tags: [cowork, write-summary]
---

# cowork:write-summary-weekly-life

Authors a standalone weekly review note covering spending, habits, side quests, thread health, people pulse, next-week preview, and an honest take. Dispatched by `cowork:weekly-review` (Sundays). Output is deterministic so cron-fired runs produce identical section structure week-over-week.

## Inputs

- `date` (string, optional): today's date `YYYY-MM-DD`. When provided, used as the `created` frontmatter stamp.
- `vault_path` (string, optional): absolute vault root override. Defaults to active vault.
- `week_start` (string, optional): ISO Monday of reviewed week (`YYYY-MM-DD`). Required if neither `week_range` is provided.
- `week_end` (string, optional): ISO Sunday of reviewed week.
- `week_range` (string, optional): `"<start>..<end>"` shorthand (alternative to `week_start` + `week_end`).
- `finance` / `finance_data` (object, optional): `{ totals_by_category[], cc_balances[], interest_mtd, debt_paydown_delta }` from `cowork:gather-finance-yesterday` aggregated across the week.
- `cc_debt` (object, optional): from `cowork:gather-cc-debt-snapshot` weekly mode.
- `calendar` (object, optional): next-week + past-week event list from `cowork:gather-calendar`.
- `email_metrics` (object, optional): weekly email counts.
- `people_pulse` / `people` (object, optional): inner-circle contact map.
- `projects` / `vault_activity` (object, optional): from `cowork:gather-projects` (weekly filter).
- `threads` (object, optional): from `cowork:gather-threads` (weekly-audit) plus `{ opened_this_week, resolved_this_week, stale[] }`.

## Outputs

- `summary_path` (string): absolute path written.
- `markdown` (string): the full note body that was written.

## Steps

1. Compute ISO week label `YYYY-Www` from `week_start` (zero-padded week number).
2. Set `summary_path = <vault_path>/spice/cowork/summaries/weekly/<YYYY-Www>.md`.
3. Ensure parent directory exists (`spice/cowork/summaries/weekly/`).
4. Render frontmatter: `type: cowork-summary-weekly-life`, `created: <today YYYY-MM-DD>`, `week_start`, `week_end`, `tags: [cowork, weekly-review, life]`, `cssclasses: [wide, row-alt]`.
5. Render H1 title `Weekly Review - Week of <Month DD, YYYY>` (hyphen; brand voice forbids em dash).
6. Render fixed section sequence below as `## Headers` with the `[!info]` / `[!abstract]` callouts as specified in `## Returns`.
7. Write file via Write tool (full replace; idempotent re-runs overwrite).
8. Return `{ summary_path, markdown }`.

## Returns

Markdown body MUST contain these sections in this order, every run:

```markdown
## Week at a Glance
| Metric | Value |
| Total spent / CC balance Δ / Days journaled / Days with todo / Open loops / Key events |

## Financial Review
- Spending by category table (this week, last week, Δ%)
- Week-over-week total
- Top 3 problem categories
- Credit card balance table (last week, now, change)
- Interest charges MTD
- Debt payoff progress (one sentence + weekly Δ vs ~${{life_debt_weekly_target_usd}}/week target)

## Habit Check
- Journaling streak / daily-note streak / todo engagement
- Task velocity (created / completed / carried-over / open)
- 2026 Atlas goals qualitative check

## Side Quests and Projects
- Status per active side quest
- Items stuck / completed this week

## Thread Health
- Opened / Resolved / Still open / Stale (>7 days) counts
- Stale thread table with recommendations

## People Pulse
- Inner circle contact summary
- Anyone to reach out to

## Next Week Preview
- Calendar Mon-Sun
- Upcoming deadlines from active-threads
- Recommended focus areas

## Honest Take
2-3 sentences. Was this a good week? One thing to do differently next week.
```

## Errors

- If `summary_path` parent cannot be created, return `{ error: "fs-error:<reason>" }` and do not write.
- If any required input is missing, return `{ error: "missing-input:<key>" }`.
- Never silently skip a section - render the heading with "Nothing notable" beneath it if data is empty.
