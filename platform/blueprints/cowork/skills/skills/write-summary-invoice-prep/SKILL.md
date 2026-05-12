---
name: cowork:write-summary-invoice-prep
description: Consulting-type-only invoice prep. Aggregates hours + line items from daily Session End sections across the invoice period and writes the invoice note frontmatter (hours + amount) plus a markdown summary block for embedding in weekly / monthly summaries.
inputs:
  engagement: object
  date_today: string
  mode: string
  month_range: object
  week_range: object
outputs:
  invoice_path: string
  hours_logged: number
  amount_logged: number
  markdown: string
tags: [cowork, write-summary, invoice, engagement-aware]
---

# cowork:write-summary-invoice-prep

Consulting-engagement-only sub-skill. RENAMED from `cowork:invoice-prep` in v0.31.0. Gated: caller MUST verify `engagement.type == "consulting"` before invocation; this skill early-exits with Notice `cowork:write-summary-invoice-prep — engagement '<id>' is not consulting-type; skipping` if invoked against a non-consulting engagement.

Aggregates hours and line items from `## Session End` sections in the period's daily notes, updates the invoice note frontmatter (`hours` + `amount`), and returns a markdown summary block suitable for embedding in `cowork:write-summary-weekly` or `cowork:write-summary-monthly` output.

## Inputs

- `engagement` (object, required) — must have `type == "consulting"`. Uses `engagement.hourly_rate_usd`, `engagement.ap_email`, `engagement.invoice_cadence`, `engagement.primary_client`.
- `date_today` (string, required) — `YYYY-MM-DD`.
- `mode` (string, required) — `"weekly"` | `"monthly"` | `"on-demand"`.
- `month_range` (object, optional) — `{ start: YYYY-MM-DD, end: YYYY-MM-DD }`. Required when `mode == "monthly"`.
- `week_range` (object, optional) — `{ start: YYYY-MM-DD, end: YYYY-MM-DD }`. Required when `mode == "weekly"` AND `engagement.invoice_cadence == "weekly"`.

## Outputs

- `invoice_path` (string) — absolute path to the invoice note that was updated (or null if none found).
- `hours_logged` (number) — sum of hours across the period.
- `amount_logged` (number) — `hours_logged * engagement.hourly_rate_usd`.
- `markdown` (string) — summary block ready for embedding.

## Steps

1. Gate: if `engagement.type != "consulting"`, return early with empty payload + Notice.
2. Resolve target invoice note path based on `mode`:
   - `monthly`: `<vault>/spice/finance/<prev_month_yyyymm>/<prev_month_yyyymm>-Invoice.md` (where `<prev_month_yyyymm>` is derived from `month_range.start`).
   - `weekly`: `<vault>/spice/finance/<YYYY-MM-week>/<YYYY-MM-week>-Invoice.md` (deriving week-folder from `week_range`). If the vault doesn't use weekly invoice folders, fall back to the month folder with a `weekly` suffix.
3. Walk `<vault>/spice/daily/<YYYY>/<MM-Month>/` for every daily note whose `date` falls in the period. Extract the `### Time Log` subsection from each note's `## Session End` callout. Aggregate hours + line items.
4. Update the invoice note frontmatter via `mcp__obsidian__update_frontmatter`:
   - `hours: <hours_logged>`
   - `amount: <amount_logged>`
   - `tags: [invoice, finance, <engagement.id>]`
5. Compose the summary markdown block:
   ```markdown
   > [!tip]+ Invoice posture — {{engagement.primary_client}}
   > **Hours logged ({{period}}):** {{hours_logged}}
   > **Amount:** ${{amount_logged}} at ${{engagement.hourly_rate_usd}}/hr
   > **Invoice note:** [[<invoice_path basename>|<period label>]]
   > **AP contact:** {{engagement.ap_email}}
   ```
6. Return `{ invoice_path, hours_logged, amount_logged, markdown }`.

## Errors

- `engagement.hourly_rate_usd` missing: hard-fail; this is a required consulting field.
- No daily notes found in period: return `{ hours_logged: 0, amount_logged: 0, markdown: "> [!warning]+ No daily notes found in invoice period. Verify date range." }`.
- Invoice note missing at expected path: emit Notice `cowork:write-summary-invoice-prep — invoice note not found at <path>; skipping frontmatter update` and still return aggregated hours in markdown.
