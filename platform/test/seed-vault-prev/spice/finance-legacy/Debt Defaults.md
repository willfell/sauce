---
type: debt-defaults
debts:
  - name: Apple Card
    kind: credit-card
    current_balance: 1000
    credit_limit: 3000
    apr: 0.18
    min_payment: 25
    planned_monthly_payment: 100
  - name: Discover it
    kind: credit-card
    current_balance: 2000
    credit_limit: 5000
    apr: 0.20
    min_payment: 50
    planned_monthly_payment: 150
cssclasses: [wide]
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "DebtDefaultsEditor" });
```
