---
type: debts-hub
created_at: "2026-06-15T03:30:00-06:00"
tags:
  - finance-hub
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "FinanceChromeBar" });
```

```dataviewjs
// entity-create:debt — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "FinanceNav" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "DebtsHubSummary" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "DebtsCards" });
```
