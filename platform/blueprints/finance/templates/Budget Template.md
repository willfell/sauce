---
type: budget
month: <% tp.date.now("YYYY-MM") %>
categories: []
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetNavButtons" });
```

```dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "budget");
```

## Categories

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetCategoriesEditor" });
```

