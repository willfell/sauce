---
type: time-log
month: <% tp.date.now("YYYY-MM") %>
date: <% tp.date.now("YYYY-MM") %>-01
total_hours: 0
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - finance
  - time-log
cssclasses:
  - wide
---

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "InvoiceNavButtons" });
```

# Time Log

| Date | Start | End | Hours | Description |
|------|-------|-----|------:|-------------|

## Totals

| | |
|---|---:|
| **Total Hours** | `= this.total_hours` |
