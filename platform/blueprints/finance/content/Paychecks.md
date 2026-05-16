---
type: paychecks-hub
tags:
  - finance
  - paycheck
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:paycheck — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "paycheck" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "PaychecksCards" });
```
