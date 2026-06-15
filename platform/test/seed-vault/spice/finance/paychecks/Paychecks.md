---
type: paychecks-hub
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
// entity-create:paycheck — installer-managed; do not delete this comment
await customJS.FinanceHubActions.render(dv, {
  here: "paychecks",
  instance: "paycheck",
  defaultsPath: "spice/finance/Paycheck Defaults.md"
});
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "PaychecksCards" });
```
