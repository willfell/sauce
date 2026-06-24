---
type: finance-plan
income_floor: 0
fixed_living_monthly: 0
attack_above_minimums: 0
pay_periods_per_month: 2
roll_freed_savings_to_attack: true
savings_glide:
  - { at_or_above: 0, monthly: 0 }
overflow: { attack_pct: 80, flex_pct: 20 }
lever_order: [discretionary, savings, attack]
avalanche_order_by: apr
created_at: "2026-06-24T01:22:50.825Z"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinancePlanDashboard" });
```
