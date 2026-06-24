---
type: debt
kind: credit-card
name: Apple Card
current_balance: 1000
credit_limit: 3000
apr: 0.18
min_payment: 25
planned_monthly_payment: 100
url: "https://example.com/applecard"
opened_date: "2025-01-01"
last_updated: "2026-01-01"
balance_history:
  - { date: "2026-01-01", balance: 1000, source: install-seed }
created_at: "2026-01-01T00:00:00.000Z"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
```

<!-- debt-summary-v0.6.0 -->
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "DebtSummary" });
```
