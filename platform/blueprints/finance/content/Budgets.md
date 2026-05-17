---
type: budgets-hub
created_at: "2026-05-17T16:45:00-06:00"
tags:
  - finance-hub
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:budget — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "budget" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "BudgetsCards" });
```
