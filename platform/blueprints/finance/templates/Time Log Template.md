---
type: time-log
month: <% tp.date.now("YYYY-MM") %>
date: <% tp.date.now("YYYY-MM") %>-01
total_hours: 0
entries: []
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - finance
  - time-log
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

