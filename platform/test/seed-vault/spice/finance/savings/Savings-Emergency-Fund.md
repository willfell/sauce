---
type: savings-account
name: "Emergency Fund"
target: 5000
current_balance: 0
last_updated: "2026-06-24"
balance_history:
  - { date: 2026-06-24, balance: 0, source: install-seed }
created_at: "2026-06-24T15:58:43Z"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
```

<!-- savings-summary-v0.10.0 -->
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SavingsSummary" });
```
