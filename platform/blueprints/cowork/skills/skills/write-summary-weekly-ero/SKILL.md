---
name: cowork:write-summary-weekly-ero
description: Compose the ERO weekly review summary note at spice/cowork/summaries/weekly/YYYY-Www.md and return its absolute path.
inputs:
  date: string
  vault_path: string
  week_start: string
  week_end: string
  month_name: string
  year: string
  hours: object
  hours_data: object
  projects: object
  project_movement: object
  threads: object
  meetings: object
  invoice: object
  next_week_events: object
  next_week_calendar: object
  ai_committee_status: string
outputs:
  summary_path: string
  markdown: string
tags: [cowork, write-summary]
---

# cowork:write-summary-weekly-ero

Authors a standalone ERO weekly review note covering hours, project movement, thread health, meetings, invoice check, and next-week preview. Dispatched by `cowork:ero-weekly` (Sunday evening). Cron-fired runs must produce identical section structure week-over-week.

## Inputs

- `date` (string, optional): today's date `YYYY-MM-DD`. Used as the `created` frontmatter stamp.
- `vault_path` (string, optional): absolute vault root override.
- `week_start` (string, required): ISO Monday of reviewed week.
- `week_end` (string, required): ISO Sunday of reviewed week.
- `month_name` (string, optional): month name for tag composition.
- `year` (string, optional): 4-digit year for tag composition.
- `hours` / `hours_data` (object, optional): `{ total_hours_week, hours_per_day, sessions, gap_days, ... }`.
- `projects` / `project_movement` (object, optional): from `cowork:gather-projects` (weekly) with delta vs prior week.
- `threads` (object, optional): from `cowork:gather-threads` (weekly-audit).
- `meetings` (object, optional): `[{ date, title, attendees[], outcomes, open_action_items[] }]` for the week.
- `invoice` (object, optional): from `cowork:invoice-prep`.
- `next_week_events` / `next_week_calendar` (object, optional): event list Mon-Fri next week.
- `ai_committee_status` (string, optional): short literal for the Next Week section.

## Outputs

- `summary_path` (string).
- `markdown` (string).

## Steps

1. Compute ISO week label `YYYY-Www`.
2. Set `summary_path = <vault_path>/spice/cowork/summaries/weekly/<YYYY-Www>.md`.
3. Ensure parent directory exists.
4. Render frontmatter: `type: cowork-summary-weekly-ero`, `created`, `week_start`, `week_end`, `tags: [cowork, ero, weekly-review]`, `cssclasses: [wide]`.
5. Render H1 `Weekly Review - Week of <Month DD, YYYY>`.
6. Render `[!info]` related-notes callout linking `[[Projects-Hub]]`, `[[Finance-Hub]]`, today's daily note.
7. Render fixed section sequence below.
8. Write file via Write tool (full replace).
9. Return `{ summary_path, markdown }`.

## Returns

Markdown body MUST contain these sections in this order, every run:

```markdown
## Week at a Glance
| Metric | Value |
| Hours logged / Sessions / Invoice running total / Cards completed / Threads resolved / Threads still open |

## Project Movement
| Project | Completed | New | In Progress | Blocked | Delta |
Prose paragraph per project with notable changes.

## Thread Health
| Status | Count | (Opened / Resolved / Still open / Stale >7 days)
Stale thread table with thread, age, recommendation.

## Meetings
| Date | Meeting | Key Outcome | Open Action Items |

## Invoice Check
[[YYYY-MM-Invoice]] - X hrs logged of ~Y expected ($X at $150/hr).
On pace / behind / ahead. Submission status if past 25th.

## Next Week
| Day | Event |
Upcoming deadlines: threads crossing 7d stale threshold + invoice due date.
Recommended focus: top 3 priorities.
```

## Errors

- If `summary_path` parent cannot be created, return `{ error: "fs-error:<reason>" }`.
- If any required input is missing, return `{ error: "missing-input:<key>" }`.
- Never skip a section - render heading with "Nothing notable" if empty.
- If no daily notes exist for the week, surface prominently in Week at a Glance.
