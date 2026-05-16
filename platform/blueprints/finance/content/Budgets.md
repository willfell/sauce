---
type: budgets-hub
tags:
  - finance
  - budget
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
