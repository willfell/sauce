---
name: cowork:write-callout-eod-ero
description: Compose ero work-vault EOD callout (project moves, time log, threads, tomorrow plan, invoice flag on 25th+).
inputs:
  date: string
  tomorrow_date: string
  tomorrow_weekday: string
  weekday: string
  month_name: string
  is_25th_or_later: boolean
  is_invoice_window: boolean
  completed: string
  time_log: string
  threads_changes: string
  followups: string
  invoice_summary: string
outputs:
  markdown: string
tags: [cowork, write-callout]
---

# cowork:write-callout-eod-ero

Composition-only sub-skill for the ero daily note's end-of-day wrap-up. Stitches normalized state-skill fragments into a deterministic single-callout block. The Time Log sub-section is the most important - its placeholder must be unmissable when hours are unconfirmed. No MCP calls.

## Inputs

- `date` (string, required) - absolute `YYYY-MM-DD` (today).
- `tomorrow_date` (string, required) - absolute `YYYY-MM-DD`.
- `tomorrow_weekday` (string, required) - full English weekday for `tomorrow_date`.
- `weekday` (string, optional) - full English weekday for `date` (today). Used in header substitution.
- `month_name` (string, optional) - full month name (e.g., `May`). Used in invoice slot.
- `is_25th_or_later` (boolean, optional) - alias for `is_invoice_window`. When provided, drives the Invoice Ready callout the same as `is_invoice_window`.
- `is_invoice_window` (boolean, required if `is_25th_or_later` absent) - true when day-of-month `>= 25` AND the current month's invoice has not been marked submitted. Drives the Invoice Ready callout.
- `completed` (string, optional) - markdown bullet list of project-card moves to Done, action items addressed today, etc. Wikilinks for note refs.
- `time_log` (string, optional) - markdown table fragment with Session / Hours / Work columns plus a `**Month total:** X hrs / $X` summary line. If empty AND `is_invoice_window` is true, this skill emits the unmissable placeholder per the brand-voice ERO eod precedent.
- `threads_changes` (string, optional) - markdown fragment from `cowork:gather-threads` showing today's resolved / new / still-open thread counts and ids.
- `followups` (string, optional) - markdown bullet list of items needing action tomorrow or blocked on others. Names people, links cards. Acts as "Start Here Tomorrow" anchor.
- `invoice_summary` (string, optional) - when `is_invoice_window` is true, markdown fragment from `cowork:invoice-prep` describing the compiled invoice. Otherwise ignored.

## Outputs

- `markdown` (string) - single multi-line callout block.

## Steps

1. Substitute `{{DATE}}`, `{{TOMORROW_DATE}}`, `{{TOMORROW_WEEKDAY}}` into the template.
2. If `time_log` is empty: render the literal Fill-This-In nested warning callout (see Returns) so the user cannot miss it.
3. If `is_invoice_window` is false: omit the Invoice Ready sub-callout entirely.
4. If `is_invoice_window` is true AND `invoice_summary` is empty: render `> > [!warning] Invoice prep ran but returned empty. Run cowork:invoice-prep manually.` in the invoice slot.
5. Empty optional inputs render `> Nothing notable.` inside their sub-section.
6. Return `{ markdown }`.

## Returns

Literal output shape (single outer `[!example]+` callout, sub-sections separated by `> ---`, time-log placeholder unmissable when hours unconfirmed):

```markdown
> [!example]+ {{DATE}} ero EOD
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
{{FOLLOWUPS}}
>
> ---
>
> **Invoice ready for review** (only when is_invoice_window)
{{INVOICE_SUMMARY}}

> [!todo]+ {{TOMORROW_DATE}}: Start here
> - [ ] Open the first item in Follow-ups above
> - [ ] Confirm hours-logged matches the time log when starting work
```

Time-log placeholder rendered when `time_log` is empty:

```markdown
> > [!warning] Fill this in
> > **[X] hrs** - replace with actual hours and a one-line work description.
> > Update the [[YYYY-MM-Invoice|invoice]] once confirmed.
```

The trailing `[!todo]+ Start here` callout always emits - it seeds the next morning's first move.

## Errors

- All inputs empty AND `is_invoice_window` false: still emit the outer wrapper with `> No vault activity detected today. Update manually if work was done outside the vault.` plus the Time Log placeholder plus the trailing Start-here `[!todo]+`.
- `date` / `tomorrow_date` / `tomorrow_weekday` missing: hard-fail. The header anchors the entire block.
- `is_invoice_window` not boolean: default to `false`.
