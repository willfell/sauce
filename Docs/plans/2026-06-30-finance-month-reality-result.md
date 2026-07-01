# Finance "month reality" — result

**Date:** 2026-06-30
**Blueprint:** finance (bump computed by the release pipeline — minor, feature-level).
**Design + plan:** `2026-06-30-finance-month-reality-{design,plan}.md`.

## What shipped

Three cohesive corrections so the finance model matches how the user lives it.

### WS1 — paychecks attribute to the month they're *paid*
`FinanceMath.readPaychecksForMonth` and `MonthlyOverview`'s income filter now key on `pay_period_end` (falling back to `pay_period_start` for legacy checks). A check spanning June 15→July 1 now lands in **July**, so both the 1st and 15th checks wire to their pay month.

### WS2 — the budget shows the full picture (live + override)
- New `FinanceMath.budgetAllocations(dv, monthKey)` merges the plan's **live** per-debt allocation (min+attack routed to the avalanche target) + savings contribution with the budget's stored per-row overrides. Returns `{ debt[], savings[], totals{debt,savings,fixed,income,discretionary} }`; `planned = override ?? plannedLive`, `source ∈ "override"|"plan"`.
- New `BudgetAllocationsEditor` widget renders a full-picture line (Income → Fixed · Debt · Savings · Discretionary) atop editable **Debt** and **Savings** sections. Rows show live plan values by default; editing a row **materializes an override** into `debt_allocations[]`/`savings_allocations[]`; a per-row "Reset to plan" removes it.
- Budget schema gains optional `debt_allocations`/`savings_allocations` arrays (rule_fragment + template + new-budget `inline_body`). The discretionary-envelope math is **untouched** — it still sums only `categories[]`, so debt/savings never inflate the envelope.
- Ungated body-injection heal `applyFinanceBudgetAllocationsBandInjection` adds the widget block to existing budgets across vaults.
- Month dashboard's Debt Changes now reads `planned (budget) · paydown (paycheck) · measured drop`, closing the plan-vs-actual loop.

### WS3 — editor data-loss fixes (paycheck + both budget editors + new widget)
- **Render-from-authoritative:** editors re-render from the array they just wrote, not the lagging `dv.current()` — kills the "row won't delete" symptom *and* the index-cascade that silently deleted the wrong rows.
- **Merge-on-edit:** `_editFlow` uses `Object.assign({}, current, result)` — a debt-linked row keeps its `[[Debt-…]]` link (and any other non-dialog field) on edit.

## Surfaces hit
`finance-math.js`, `monthly-overview.js`, `month-dashboard.js`, `paycheck-expenses-editor.js`, `budget-categories-editor.js`, `budget-defaults-editor.js`, new `budget-allocations-editor.js`, `manifest.json`, `Budget Template.md`, `install.js`, `schemas-index.json`; tests `run-renderer.js`, `run-finance-plan-state.js`, `run-finance-plan-widgets.js`, `run-helper-cases.js`, `run-v01103-monthly-overview.js`, `run-seed-migrations.js`.

## Verification
`release:preflight` 0-fail whole-suite; `lint-schemas` clean; workshop self-install exit 0; `release:preflight-bumped` PASS (no release wedge).

## Lessons / carry-forward
- **Live-derived + materialize-on-edit beat snapshot-at-creation** for the budget allocations — dodged an entity-create seed extension, an install-time frontmatter migration, and all seed-vault churn. Reaffirms the "live render beats materialize-once for derived views" principle.
- **Editor signature changes ripple into source-contract assertions.** WS3's `render(dv)`→`render(dv, override)` tripped `HC-V01070-BDE-1`'s strict `/render\(\s*dv\s*\)/` pin; loosened to `/render\(\s*dv\b/`. When you change a widget's render signature, grep `run-helper-cases.js` for the sibling `async render(dv)` pins.
- **Two paycheck filter sites**, not one — `readPaychecksForMonth` *and* `monthly-overview.js`. Centralizing attribution fully is a future cleanup (route MonthlyOverview through the helper).
- **Follow-ups (deferred, need post-release version):** `cycle-status.md` regen, `install.md` upgrade section, next-cycle handoff doc.
