---
name: cowork:write-callout-morning-briefing-ero
description: Compose ero work-vault morning briefing as multi-callout block (projects, threads, invoice posture).
inputs:
  date: string
  weekday: string
  month_name: string
  is_monday: boolean
  is_25th_or_later: boolean
  calendar: string
  gmail: string
  projects: string
  threads_digest: string
  invoice_status: string
outputs:
  markdown: string
tags: [cowork, write-callout]
---

# cowork:write-callout-morning-briefing-ero

Composition-only sub-skill for the ero (work) daily note. Stitches normalized gather-skill fragments into a deterministic multi-callout block. Monday triggers the optional Week Ahead sub-callout. No MCP calls.

## Inputs

- `date` (string, required) - absolute `YYYY-MM-DD`.
- `weekday` (string, required) - full English weekday.
- `month_name` (string, optional) - full month name (e.g., `May`). Used in invoice/Week Ahead substitution.
- `is_monday` (boolean, required) - when true, include the Week Ahead sub-callout.
- `is_25th_or_later` (boolean, optional, default `false`) - when true and `invoice_status` is non-empty, append the literal warning line `> > [!warning] Invoice prep will run at EOD` inside the Invoice callout.
- `calendar` (string, optional) - markdown fragment from `cowork:gather-calendar` filtered to ero scope.
- `gmail` (string, optional) - markdown fragment from `cowork:gather-gmail` filtered to ero scope.
- `projects` (string, optional) - markdown fragment from `cowork:gather-projects`. Active-projects table + per-project In-Progress / Blocked detail with wikilinked card notes.
- `threads_digest` (string, optional) - markdown fragment from `cowork:gather-threads` filtered to ero scope.
- `invoice_status` (string, optional) - single-line summary like `[[YYYY-MM-Invoice|Month YYYY Invoice]] - X hrs logged ($X at ${{ero_hourly_rate_usd}}/hr).`

## Outputs

- `markdown` (string) - concatenated multi-callout block.

## Steps

1. Substitute `{{DATE}}` and `{{WEEKDAY}}` into the literal template.
2. If `is_monday` is true, render the Week Ahead callout slot; otherwise omit that callout entirely (no empty wrapper).
3. Empty optional inputs render as `> Nothing notable.` inside their callout (brand-voice rule).
4. Render `invoice_status` inside the Invoice callout. If `is_25th_or_later = true` (or, as a fallback, `date` day-of-month is `>= 25`) AND `invoice_status` is non-empty, append the literal warning line `> > [!warning] Invoice prep will run at EOD` inside the Invoice callout.
5. Concatenate callouts with one blank line between each. Return `{ markdown }`.

## Returns

Literal output shape (deterministic order, wikilinks for note refs, 24-hour times):

```markdown
> [!abstract]+ {{DATE}} ero morning - {{WEEKDAY}}

> [!example]+ Schedule
{{CALENDAR}}

(MONDAY ONLY)
> [!info]+ Week ahead
> Surfaces ERO events through Friday and any AI Committee meeting this week.

> [!info]+ Inbox (ero scope)
{{GMAIL}}

> [!example]+ Projects
{{PROJECTS}}

> [!warning]+ Open threads
{{THREADS_DIGEST}}

> [!tip]+ Invoice
> {{INVOICE_STATUS}}

> [!todo]+ {{DATE}}: Action items
> - [ ] Unblock any project card flagged in Projects above
> - [ ] Address oldest open thread first
> - [ ] If invoice prep is flagged, review hours before EOD job runs
```

Each `{{...}}` slot is replaced with the input's full markdown content. Caller-side gather skills already return `> `-prefixed line shape.

## Errors

- All inputs missing: emit the abstract header + a single `> [!warning]+ Gather degraded` callout listing which inputs were empty. Always emit something at the anchor.
- `is_monday` missing or non-boolean: default to `false` and proceed.
- Invoice status empty AND day >= 25: emit `> [!warning]+ Invoice` with the literal text `> Invoice status not gathered. Run gather-projects manually before EOD.`.
