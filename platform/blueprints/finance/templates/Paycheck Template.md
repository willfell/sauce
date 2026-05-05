---
type: paycheck
pay_period_start: <% tp.date.now("YYYY-MM-DD") %>
pay_period_end:
paycheck_amount: 0
expenses: []
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - finance
  - paycheck
cssclasses:
  - wide
---

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "PaycheckNavButtons" });
```

```dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "paycheck");
```

## Expenses

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "PaycheckExpensesEditor" });
```

