---
name: cowork:invoice-prep
description: Aggregate the month's billable hours from daily-note Time Logs; patch the invoice note + return submission summary.
inputs:
  month: string
  rate: number
outputs:
  invoice_path: string
  hours: number
  amount: number
  line_items: list[object]
  gaps: list[string]
  summary_markdown: string
tags: [cowork, ero, invoice, finance]
---

# cowork:invoice-prep

Compiles the month's invoice from EOD Time Log entries, cross-references the invoice kanban board, patches the invoice note's frontmatter + summary, and returns a structured payload the ero-eod / ero-weekly / ero-monthly orchestrators can fold into their callouts. FAT: the orchestrator never reads raw daily notes for hours.

## Inputs
- `month`: target month in `YYYY-MM` form (e.g. `2026-05`). Caller supplies; do not infer from system clock.
- `rate`: hourly rate in dollars. Defaults to `{{ero_hourly_rate_usd}}` if absent (consumer-configured ERO rate). Caller may override.

## Outputs
- `invoice_path`: vault-relative path to the invoice note.
- `hours`: total billable hours for the month (sum of all session entries).
- `amount`: `hours * rate` rounded to two decimals.
- `line_items`: list of `{ date, description, hours }` objects, sorted ascending by date.
- `gaps`: list of human-readable strings describing weeks with zero logged sessions (so the user can verify nothing was missed).
- `summary_markdown`: pre-rendered `## Invoice Summary` block ready to embed in the invoice note OR in an EOD/weekly/monthly callout.

## Steps
1. Compute the invoice path: `spice/finance/<YYYY-MM>/<YYYY-MM>-Invoice.md`. (Example: `spice/finance/2026-05/2026-05-Invoice.md`.) If missing, create it with the canonical invoice frontmatter:
   ```yaml
   ---
   type: invoice
   month: 2026-05
   date: 2026-05-01
   hours: 0
   amount: 0
   rate: {{ero_hourly_rate_usd}}
   tags: [invoice, finance]
   ---
   ```
   Use `mcp__obsidian__write_note` for the create case.
2. List daily notes for the month via `mcp__obsidian__list_directory` against `spice/daily/<YYYY>/<MM>-<MonthName>/`. Compute `<MonthName>` from `<MM>` (01→January, 02→February, etc.) - do NOT take month-name as input; derive deterministically. If the directory is missing, return immediately with `hours: 0`, `line_items: []`, and a `gaps` entry naming the missing month folder.
3. For each daily note in the month, read it via `mcp__obsidian__read_note`. Search inside any `[!note]- EOD Review` callout (parent collapsed) for a `[!abstract]+ Time Log` sub-callout containing a Markdown table of the form:
   ```
   | Session | Hours | Work |
   |:--|--:|:--|
   | Afternoon | 3.0 | Knowledge Search API debugging |
   ```
   Parse each non-header table row. For each row capture `(date_from_filename, hours_float, description_string)`. Tolerate variants: a `Morning` / `Afternoon` / `Evening` session label is fine; the `Hours` column is authoritative. Skip rows whose Hours cell is non-numeric or empty.
4. Cross-reference the invoice kanban board at `spice/finance/<YYYY-MM>/<YYYY-MM>-board.md` if it exists. Read every card note linked from the board's `In Progress` and `Completed` lanes (cards live at `spice/finance/<YYYY-MM>/cards/<Card Name>.md`). If a card note describes work hours not present in any daily-note Time Log, append a synthetic line item with `description = "<Card Name>"` and a flag `from_kanban: true`. This handles the case where the user logged hours on a kanban card but skipped the daily-note Time Log.
5. Sum all hours. Compute `amount = round(hours * rate, 2)`. Render `summary_markdown`:
   ```markdown
   ## Invoice Summary

   > [!summary] <MonthName> <YYYY> Invoice
   > **Hours:** <H> hrs | **Rate:** $<rate>/hr | **Total:** $<amount>

   ### Line Items

   | Date | Description | Hours |
   |:--|:--|--:|
   | 2026-05-04 | Knowledge Search API debugging | 3.0 |
   | | **Total** | **<H>** |

   ### Submission Checklist

   - [ ] Review line items for accuracy
   - [ ] Confirm total hours match session logs
   - [ ] Submit invoice via Brex
   - [ ] Notify {{ero_ap_email}}
   - [ ] Update invoice note frontmatter once confirmed
   ```
   Format hours with one decimal place. Format amount with thousands separator + two decimals.
6. Patch the invoice note via `mcp__obsidian__update_frontmatter` (set `hours`, `amount`, `rate`) AND `mcp__obsidian__patch_note` to replace any existing `## Invoice Summary` section with the freshly rendered `summary_markdown`. If no `## Invoice Summary` heading exists, append the block to the note body.
7. Compute gaps: for each ISO calendar week that overlaps the target month, count line_items dated within that week. Emit a string per week with zero entries: `"Week of <YYYY-MM-DD> (Mon..Sun): no logged sessions - verify"`. The orchestrator surfaces these to the user.

## Returns
```json
{
  "invoice_path": "spice/finance/2026-05/2026-05-Invoice.md",
  "hours": 24.5,
  "amount": 3675.00,
  "line_items": [
    { "date": "2026-05-04", "description": "Knowledge Search API debugging", "hours": 3.0 },
    { "date": "2026-05-07", "description": "Egnyte connector validation re-test", "hours": 4.5 }
  ],
  "gaps": [ "Week of 2026-05-18 (Mon..Sun): no logged sessions -- verify" ],
  "summary_markdown": "## Invoice Summary\n\n> [!summary] May 2026 Invoice\n> ..."
}
```

## Errors
- Missing daily-note month directory: return `{ ..., hours: 0, line_items: [], gaps: ["spice/daily/<YYYY>/<MM>-<MonthName>/ not found - no daily notes for the month"] }`. Do NOT abort.
- Per-day parse error (malformed Time Log table): skip that day, append a `gaps` entry naming the date.
- Invoice-note write error: return the computed payload anyway (orchestrator can still surface hours), but populate `gaps` with a `"failed to patch invoice note: <reason>"` entry so the user sees the failure.
- This sub-skill never raises. Math errors → return `hours: 0` with a gap entry explaining the failure. The user must see SOMETHING in the EOD/weekly/monthly callout, even on a bad month.

## Template variables

- `{{ero_ap_email}}` is substituted at install time from the consumer's `platform-config.json` variables block.
- `{{ero_hourly_rate_usd}}` is substituted at install time from the consumer's `platform-config.json` variables block.
