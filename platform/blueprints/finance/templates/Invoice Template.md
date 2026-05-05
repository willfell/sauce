---
type: invoice
month: <% tp.date.now("YYYY-MM") %>
date: <% tp.date.now("YYYY-MM") %>-01
hours: 0
amount: 0
submitted_date:
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - finance
  - invoice
cssclasses:
  - wide
---

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "InvoiceNavButtons" });
```

# Invoice — <% tp.date.now("YYYY-MM") %>

| Field | Value |
|-------|-------|
| **Month** | `= this.month` |
| **Hours** | `= this.hours` |
| **Amount** | `= "$" + this.amount` |

## Notes

