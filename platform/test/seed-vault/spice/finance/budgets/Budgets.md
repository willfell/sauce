---
type: budgets-hub
created_at: "2026-05-17T16:45:00-06:00"
tags:
  - finance-hub
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:budget — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "FinanceHubActions", args: [{
  here: "budgets",
  instance: "budget",
  defaultsPath: "spice/finance/Budget Defaults.md"
}] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetsCards" });
```
