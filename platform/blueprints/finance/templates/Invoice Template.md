---
type: invoice
month: <% tp.date.now("YYYY-MM") %>
date: <% tp.date.now("YYYY-MM") %>-01
rate: 0
hours: 0
amount: 0
submitted_date:
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "InvoiceNavButtons" });
```

```dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "invoice");
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "InvoiceControls" });
```

