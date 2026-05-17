---
type: paycheck
pay_period_start: <% tp.date.now("YYYY-MM-DD") %>
pay_period_end:
paycheck_amount: 0
expenses: []
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "PaycheckNavButtons" });
```

```dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "paycheck");
```

## Expenses

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "PaycheckExpensesEditor" });
```

