---
type: budget
budget_month: <% tp.date.now("YYYY-MM") %>
categories: []
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - finance
  - budget
cssclasses:
  - wide
---

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

# Budget — <% tp.date.now("YYYY-MM") %>

## Categories

| Name | Planned | Actual |
|------|--------:|-------:|

## Notes

