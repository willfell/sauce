---
type: time-log
month: <% tp.date.now("YYYY-MM") %>
date: <% tp.date.now("YYYY-MM") %>-01
total_hours: 0
entries: []
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
await dv.view("ranch/views/customjs-guard", { class: "InvoiceTimeLogEditor" });
```

