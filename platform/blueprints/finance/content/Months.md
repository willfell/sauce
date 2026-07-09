---
type: months-hub
created_at: "2026-06-15T18:00:00-06:00"
tags:
  - finance-hub
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "FinanceChromeBar" });
```

```dataviewjs
// entity-create:month — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "FinanceNav" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "MonthsCards" });
```
