---
name: cowork:write-callout-eod-review
description: Engagement-aware EOD callout composition. Stitches normalized state-skill markdown fragments into one deterministic [!example]+ EOD callout. Internal branch on engagement.type selects the section layout. No MCP calls.
inputs:
  engagement: object
  render_aspects: object
  date: string
  tomorrow_date: string
  tomorrow_weekday: string
  completed: string
  carrying_over: string
  morning_followup: string
  threads_changes: string
  tomorrow_calendar: string
  late_emails: string
  time_log: string
  invoice_summary: string
outputs:
  markdown: string
tags: [cowork, write-callout, engagement-aware]
---

# cowork:write-callout-eod-review

Composition-only sub-skill for the EOD wrap-up. Stitches pre-rendered state-skill fragments into a deterministic single-callout block under `## EOD — <engagement.label>`. Section layout is type-branched: personal-type emphasizes carry-over + morning-followup + threads; consulting-type emphasizes time-log + invoice-window; w2-fte-type emphasizes completed + threads + tomorrow-prep.

## Inputs

- `engagement` (object, required) — engagement record.
- `render_aspects` (object, required) — engagement-type render-aspects map (drives Invoice section gating).
- `date`, `tomorrow_date`, `tomorrow_weekday` (string, required) — absolute dates + weekday.
- `completed`, `carrying_over`, `morning_followup`, `threads_changes`, `tomorrow_calendar`, `late_emails` — pre-rendered markdown fragments. Each line begins with `> `.
- `time_log` — required for consulting-type only; markdown table with Session / Hours / Work columns + summary line.
- `invoice_summary` — used only when consulting-type AND day-of-month `>= 25` (or `engagement.invoice_cadence == "weekly"` AND tomorrow is invoice-day). Rendered by upstream `cowork:write-summary-invoice-prep` when consumed.

## Outputs

- `markdown` (string) — single multi-line callout block.

## Steps

1. Substitute `{{DATE}}`, `{{TOMORROW_DATE}}`, `{{TOMORROW_WEEKDAY}}`, `{{ENGAGEMENT_LABEL}}` into the template selected by `engagement.type`.
2. For each empty optional input slot, render the brand-voice fallback `> Nothing notable.` inside its sub-section. Omit entire sub-sections (incl. `> ---` divider) that are conditional and empty (e.g. morning_followup, threads_changes, late_emails).
3. Type-branch on `engagement.type`:
   - **`personal`** → Completed / Carrying over / Morning follow-up / Thread changes / Tomorrow preview / Late emails / Tomorrow setup `[!todo]+`.
   - **`w2-fte`** → Completed / Thread changes / Tomorrow preview / Follow-ups / Start-here `[!todo]+`. No carrying-over (tasks live in the project blueprint); no morning-followup (FTE morning doesn't flag finance).
   - **`consulting`** → Completed / **Time log** (unmissable placeholder when empty) / Thread changes / Follow-ups / Invoice-ready (when in invoice window) / Start-here `[!todo]+`.
4. For consulting-type: when `time_log` empty, render the literal Fill-This-In nested warning callout (see Returns). When `invoice_summary` empty in invoice window, render the warn line. Use `render_aspects.invoice_prep == "include"` AND day-of-month >= 25 (or `engagement.invoice_cadence == "weekly"` AND tomorrow is invoice-day) as the invoice-window predicate.
5. Always emit the trailing `[!todo]+` tomorrow-setup callout (variant text per type).
6. Return `{ markdown }`.

## Returns

### personal shape

```markdown
> [!example]+ {{DATE}} EOD — {{ENGAGEMENT_LABEL}}
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
> **Tomorrow — {{TOMORROW_DATE}} {{TOMORROW_WEEKDAY}}**
{{TOMORROW_CALENDAR}}
>
> ---
>
> **Late emails** (omitted if empty)
{{LATE_EMAILS}}

> [!todo]+ {{TOMORROW_DATE}}: Tomorrow setup — {{ENGAGEMENT_LABEL}}
> - [ ] Open the carry-over list above first thing
> - [ ] Confirm tomorrow's calendar before 09:00
```

### w2-fte shape

```markdown
> [!example]+ {{DATE}} EOD — {{ENGAGEMENT_LABEL}}
>
> **Completed today**
{{COMPLETED}}
>
> ---
>
> **Thread changes**
{{THREADS_CHANGES}}
>
> ---
>
> **Tomorrow — {{TOMORROW_DATE}} {{TOMORROW_WEEKDAY}}**
{{TOMORROW_CALENDAR}}

> [!todo]+ {{TOMORROW_DATE}}: Start here — {{ENGAGEMENT_LABEL}}
> - [ ] Open the first follow-up before standup
> - [ ] Triage Action-Required emails from late-window
```

### consulting shape

```markdown
> [!example]+ {{DATE}} EOD — {{ENGAGEMENT_LABEL}}
>
> **Completed today**
{{COMPLETED}}
>
> ---
>
> **Time log**
{{TIME_LOG_OR_PLACEHOLDER}}
>
> ---
>
> **Thread changes**
{{THREADS_CHANGES}}
>
> ---
>
> **Follow-ups for {{TOMORROW_DATE}} {{TOMORROW_WEEKDAY}}**
{{CARRYING_OVER}}
>
> ---
>
> **Invoice ready for review** (only when in invoice window)
{{INVOICE_SUMMARY}}

> [!todo]+ {{TOMORROW_DATE}}: Start here — {{ENGAGEMENT_LABEL}}
> - [ ] Open the first item in Follow-ups above
> - [ ] Confirm hours-logged matches the time log when starting work
```

Time-log placeholder (rendered when `time_log` is empty for consulting-type):

```markdown
> > [!warning] Fill this in
> > **[X] hrs** — replace with actual hours and a one-line work description.
> > Update the [[YYYY-MM-Invoice|invoice]] once confirmed.
```

## Errors

- `engagement` or `render_aspects` missing: hard-fail.
- `engagement.type` unknown: hard-fail with Notice `cowork:write-callout-eod-review — unknown engagement.type '<type>'`.
- All optional inputs empty: still emit the outer wrapper with `> No state changes detected today. Update manually if work was done outside the vault.` plus the trailing Start-here callout.
- `date` / `tomorrow_date` / `tomorrow_weekday` missing: hard-fail.
