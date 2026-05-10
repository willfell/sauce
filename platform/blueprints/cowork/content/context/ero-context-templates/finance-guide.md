---
type: scheduled-context
---

# Finance System Guide (ero scope)

> [!info] How invoicing works for this client
> Read by `cowork:ero-monthly` and `cowork:skills/invoice-prep`. The invoice path conventions below MUST match the consumer's actual finance blueprint shape.

## Structure

Invoices live in `spice/finance/<YYYY-MM>/`. Each invoice month has:

- `<YYYY-MM>-Invoice.md` -- invoice note with frontmatter: `type: invoice`, `month`, `date` (first of month), `hours`, `amount`, tags: `[invoice, finance]`.
- `<YYYY-MM>-board.md` -- kanban board with card notes for each work item (when used).
- `<YYYY-MM>-Time-Log.md` -- (optional) per-day time aggregation for the month.

The Finance Hub is at `spice/finance/Finance.md`.

---

## Frontmatter (invoice)

```yaml
---
type: invoice
month: "{{example_invoice_month_label}}"
date: {{example_invoice_first_of_month}}
hours: 0
amount: 0
tags:
  - invoice
  - finance
---
```

---

## Submission Process

1. Compile hours and line items from `## Session End` sections in daily notes (`spice/daily/<YYYY>/<MM-Month>/`) under the `### Time Log` subsection.
2. Update `hours` and `amount` fields in the invoice note frontmatter.
3. Submit via {{ero_billing_platform}}.
4. Notify {{ero_ap_email}}.

---

## Rate

{{ero_hourly_rate_usd}}/hr -- multiply total hours by {{ero_hourly_rate_usd}} to get the invoice amount.

---

## Finding Hours

Hours are captured in `## Session End` sections in daily notes. The `cowork:skills/invoice-prep` sub-skill walks `spice/daily/<YYYY>/<MM-Month>/` for the current month and aggregates the `### Time Log` rows into the invoice frontmatter.

---

## Billing thresholds + cadence

- **Invoice cadence:** {{ero_invoice_cadence}}.
- **Minimum billing increment:** {{ero_min_billing_increment}}.
- **Billing threshold:** {{ero_billing_threshold_notes}}.
