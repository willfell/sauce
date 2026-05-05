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

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "BudgetNavButtons" });
```

```dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "budget");
```

# Budget — <% tp.date.now("YYYY-MM") %>

## Categories

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "BudgetCategoriesEditor" });
```

## Notes

