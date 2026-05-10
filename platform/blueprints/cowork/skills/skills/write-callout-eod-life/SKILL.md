---
name: cowork:write-callout-eod-life
description: Compose life-vault EOD callout (completed today, carry-over, thread changes since morning, tomorrow preview).
inputs:
  date: string
  tomorrow_date: string
  tomorrow_weekday: string
  completed: string
  carrying_over: string
  morning_followup: string
  threads_changes: string
  tomorrow_calendar: string
  late_emails: string
outputs:
  markdown: string
tags: [cowork, write-callout]
---

# cowork:write-callout-eod-life

Composition-only sub-skill for the life daily note's end-of-day wrap-up. Stitches normalized state-skill fragments into a deterministic single-callout block. No MCP calls. No data lookups.

## Inputs

- `date` (string, required) - absolute `YYYY-MM-DD` (today).
- `tomorrow_date` (string, required) - absolute `YYYY-MM-DD`.
- `tomorrow_weekday` (string, required) - full English weekday for `tomorrow_date`.
- `completed` (string, optional) - markdown bullet list of `- [x]` items from today's todo + boards Done lane.
- `carrying_over` (string, optional) - markdown bullet list of `- [ ]` items still open. Each row may include the date the item first appeared.
- `morning_followup` (string, optional) - short markdown block summarizing whether morning-briefing flagged items were addressed (flagged transactions reviewed, unanswered messages replied, threads resolved).
- `threads_changes` (string, optional) - markdown fragment from `cowork:gather-threads` showing today's thread state delta (resolved / new / snoozed / still open).
- `tomorrow_calendar` (string, optional) - markdown table fragment from `cowork:gather-calendar` scoped to tomorrow.
- `late_emails` (string, optional) - markdown fragment from `cowork:gather-gmail` scoped to the post-morning window.

## Outputs

- `markdown` (string) - single multi-line callout block (one outer `[!example]+ EOD` wrapper with sub-sections divided by `> ---`).

## Steps

1. Substitute `{{DATE}}`, `{{TOMORROW_DATE}}`, `{{TOMORROW_WEEKDAY}}` into the template.
2. For each empty optional input, render the brand-voice fallback `> Nothing notable.` inside its sub-section.
3. Omit `morning_followup`, `threads_changes`, and `late_emails` sub-sections entirely (including their `> ---` dividers) when their inputs are empty - these are conditional and a missing one should not leave a hole.
4. Always render Completed, Carrying Over, and Tomorrow sub-sections even if empty (they anchor the structure).
5. Return `{ markdown }`.

## Returns

Literal output shape (single outer `[!example]+` callout, sub-sections separated by `> ---`):

```markdown
> [!example]+ {{DATE}} EOD
>
> **Completed**
{{COMPLETED}}
>
> ---
>
> **Carrying over to {{TOMORROW_DATE}}**
{{CARRYING_OVER}}
>
> ---
>
> **Morning follow-up** (omitted if empty)
{{MORNING_FOLLOWUP}}
>
> ---
>
> **Thread changes since morning** (omitted if empty)
{{THREADS_CHANGES}}
>
> ---
>
> **Tomorrow - {{TOMORROW_DATE}} {{TOMORROW_WEEKDAY}}**
{{TOMORROW_CALENDAR}}
>
> ---
>
> **Late emails** (omitted if empty)
{{LATE_EMAILS}}

> [!todo]+ {{TOMORROW_DATE}}: Tomorrow setup
> - [ ] Open the carry-over list above first thing
> - [ ] Confirm tomorrow's calendar before 09:00
```

The trailing `[!todo]+` callout is always emitted - it seeds the next morning's intent.

## Errors

- All inputs empty: still emit the outer `[!example]+ EOD` wrapper with a single line `> No state changes detected. Was anything done today?` plus the trailing tomorrow-setup `[!todo]+`. Brand-voice keeps it direct.
- `date` / `tomorrow_date` / `tomorrow_weekday` missing: hard-fail. The header anchors the entire block.
