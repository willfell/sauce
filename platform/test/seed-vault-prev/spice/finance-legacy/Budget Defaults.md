---
type: budget-defaults
groups:
  - Essentials
  - Discretionary
categories:
  - name: Groceries
    group: Essentials
  - name: Dining
    group: Discretionary
cssclasses: [wide]
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetDefaultsEditor" });
```
