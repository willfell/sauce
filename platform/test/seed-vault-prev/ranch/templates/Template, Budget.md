---
type: budget
month: <% tp.date.now("YYYY-MM") %>
categories: []
groups: []
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
```

```dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "budget");
```

<!-- monthly-overview-v0.6.3 -->
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MonthlyOverview" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetSummary" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetCategoriesEditor" });
```

