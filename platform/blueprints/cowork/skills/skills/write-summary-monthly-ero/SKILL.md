---
name: cowork:write-summary-monthly-ero
description: Compose ERO monthly summary note (hours, projects, invoicing, threads, client recap) at summaries/monthly/YYYY-MM.md.
inputs:
  date: string
  vault_path: string
  month: string
  prev_month_start: string
  prev_month_end: string
  prev_month_name: string
  prev_month_year: string
  hours: object
  hours_data: object
  projects: object
  project_movement: object
  threads: object
  meetings: object
  invoice: object
  client_recap: object
  next_month_events: object
  next_month_calendar: object
  ai_committee_meetings: object
outputs:
  summary_path: string
  markdown: string
tags: [cowork, write-summary]
---

# cowork:write-summary-monthly-ero

Authors the deepest ERO-side review of the cycle: month-close hours, billable summary, invoice status, project movement, thread health, client recap, and next-month outlook. Dispatched by `cowork:ero-monthly` on the 1st of each month covering the prior month. New in v0.30.0 - derived from the weekly-ero shape extended to a 30-day window.

## Inputs

- `date` (string, optional): today's date `YYYY-MM-DD`. Used for `created` frontmatter and link-callout dates.
- `vault_path` (string, optional): ERO vault root override.
- `month` (string, optional): `YYYY-MM` of the reviewed (prior) month. Composed from `prev_month_year-prev_month_num` if absent.
- `prev_month_start` / `prev_month_end` (string, optional): explicit `YYYY-MM-DD` bounds.
- `prev_month_name` (string, optional): full month name, e.g. `April`.
- `prev_month_year` (string, optional): 4-digit year of reviewed month.
- `hours` / `hours_data` (object, optional): `{ total_hours_month, hours_per_week, sessions, gap_weeks, days_with_logged_work, weekday_count_in_month, target_hours }`.
- `projects` / `project_movement` (object, optional): from `cowork:gather-projects` with month-over-month delta.
- `threads` (object, optional): `{ opened_this_month, resolved_this_month, still_open[], avg_lifespan_days, longest_running }`.
- `meetings` (object, optional): `[{ date, title, attendees[], outcomes, open_action_items[] }]` for the month.
- `invoice` (object, optional): from `cowork:invoice-prep` (canonical month-close run).
- `client_recap` (object, optional): `{ key_deliverables[], stakeholder_touchpoints[], outstanding_blockers[] }`.
- `next_month_events` / `next_month_calendar` (object, optional): event list for next 30 days.
- `ai_committee_meetings` (object, optional): AI Committee schedule next month for Month Ahead section.

## Outputs

- `summary_path` (string).
- `markdown` (string).

## Steps

1. Set `summary_path = <vault_path>/spice/cowork/summaries/monthly/<month>.md`.
2. Ensure parent directory exists (`spice/cowork/summaries/monthly/`).
3. Render frontmatter: `type: cowork-summary-monthly-ero`, `created: <today YYYY-MM-DD>`, `month: <YYYY-MM>`, `tags: [cowork, ero, monthly-review]`, `cssclasses: [wide]`.
4. Render H1 `ERO Monthly Review - <Month YYYY>`.
5. Render `[!info]` related-notes callout linking `[[Projects-Hub]]`, `[[Finance-Hub]]`, the month's invoice note, and the client hub.
6. Render fixed section sequence below.
7. Write via Write tool (full replace).
8. Return `{ summary_path, markdown }`.

## Returns

Markdown body MUST contain these sections in this order, every run:

```markdown
## Month at a Glance
| Metric | Value | (Hours logged / Sessions / Total billable $ / Cards completed / Threads resolved / Threads open)

## Monthly Billable Summary
- Total hours: X.X / target Y.Y (delta)
- Total billable: $X,XXX at ${{ero_hourly_rate_usd}}/hr
- Hours by week (table: W1 / W2 / W3 / W4 / W5)
- Gaps: weeks below pace

## Invoice Status
[[YYYY-MM-Invoice]] - submitted / paid status.
- Submitted: <date or "not yet submitted; X days past 25th cutoff">
- Paid: <date or "outstanding">
- Brex link captured
- {{ero_ap_email}} notification status

## Project Movement
| Project | Completed | New | In Progress | Blocked | MoM Delta |
Prose paragraph per project: notable wins, blockers, what's ahead.

## Thread Health
- Opened / Resolved / Still open / Average resolution time
- Longest-running open thread
- Stale threads carrying into next month with recommendations

## Meetings
- Total meetings this month: N
- Key outcomes table (top 5 by impact)
- Outstanding action items rolled forward

## Client Recap
- Key deliverables shipped this month
- Stakeholder touchpoints (named stakeholders from {{ero_stakeholders}}, etc.)
- Outstanding blockers crossing into next month

## Month Ahead
- Next month calendar preview (key meetings, deadlines)
- Invoice cycle (next submission target)
- Recommended focus: top 3 priorities

## Honest Take
2-3 sentences. Was this a good month for ERO? One thing to change. Was the hour target hit?
```

## Errors

- If `summary_path` parent cannot be created, return `{ error: "fs-error:<reason>" }`.
- If `hours_data` is unavailable, flag prominently in Monthly Billable Summary and Invoice Status - these are the load-bearing sections for ERO.
- Never skip a section - render the heading with "Nothing notable" beneath it if data is empty.
