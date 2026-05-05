---
type: paycheck
pay_period_start: <% tp.date.now("YYYY-MM-DD") %>
pay_period_end:
paycheck_amount: 0
expenses: []
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - finance
  - paycheck
cssclasses:
  - wide
---

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

# Paycheck

## Expenses

(Add expenses to frontmatter `expenses: []` as `{item, amount, category, paid, url?}`)

## Notes

