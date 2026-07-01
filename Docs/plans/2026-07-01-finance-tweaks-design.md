# Finance tweaks (post-monthly-paycheck) — design

**Date:** 2026-07-01 · **Blueprint:** finance (0.15.0) · Small approved follow-up (3 tweaks).

## Requests (user, live on the July monthly paycheck + budget)

1. **Expense table grouped by check.** The paycheck expense list should show all check-1 (deposit 1) expenses first, then check-2 (deposit 2). Currently insertion order.
2. **Deposit date display.** The deposits header shows `2026-07-01T00:00:00.000-06:00` (Dataview parsed the deposit `date` into a DateTime; the widget renders it raw). Show a clean `2026-07-01`.
3. **Itemize fixed bills in the budget's full-picture.** The budget's reconcile-to-income waterfall (`BudgetAllocationsEditor`) shows `Fixed` as a lump from the plan's `fixed_living_monthly`. Itemize it (rent, utilities, insurance, …) from the month's paycheck so the user sees literally what they pay out of pocket, alongside Debt + Savings + Discretionary reconciling to income. **Decision (user-approved):** keep the discretionary Planned/Actual/Variance + over-envelope flag exactly as-is (discretionary-only) — do NOT turn fixed/debt/savings into editable discretionary categories. The full-picture is a read-only reconciliation; the whole-month "green" is `Total allocated ≤ income`.

## Design

### #1 — paycheck-expenses-editor.js: display order by deposit
Render expense rows sorted by `_depositIndex` (ascending, stable within a deposit preserving original order). Edit/delete/move flows MUST keep operating on the ORIGINAL `expenses[]` index — build `[{exp, origIndex}]`, sort by deposit, render in sorted order passing `origIndex` to the flows. A light per-deposit group label (the deposit's clean date) may separate the groups. Legacy (no `deposits`) notes render unchanged.

### #2 — clean deposit dates everywhere they render
Coerce `deposit.date` via `customJS.FinanceMath._coerceDateString(...)` → `YYYY-MM-DD` before display. Fix in `FinanceMath.depositTotals` (return coerced `date`), in the paycheck editor's deposits header, and any other deposit-date render (`paycheck-summary`, `month-dashboard` per-deposit rows). Ensure `_depositTagLabel` (ordinal from date) coerces first so it still derives the day from a DateTime.

### #3 — itemize fixed bills in the budget full-picture
- New `FinanceMath.fixedBillsForMonth(dv, monthKey)` → reads the month's paycheck(s) (`readPaychecksForMonth`), returns the expenses that are neither debt-linked (`!_debtKey(e.debt)`) nor savings (`category !== "Savings"`, case-insensitive) as `{ items: [{item, amount}], total }`. Empty when no paycheck.
- `FinanceMath.budgetAllocations` gains a `fixed` breakdown: `totals.fixed` prefers the itemized paycheck sum when a paycheck exists (literal out-of-pocket), else falls back to the plan `fixed_living_monthly`; expose `fixed: [{item, amount}]` for display.
- `BudgetAllocationsEditor` renders a read-only **Fixed** section (itemized rows) above Debt + Savings; the reconcile-to-income waterfall's `Fixed` line uses the same total. Discretionary envelope math (`computePlanState`) is UNTOUCHED — it keeps using the plan `fixed_living_monthly`; only the display/reconciliation itemizes.

## Testing
Preflight whole-suite green; lint-schemas; self-install; preflight-bumped. New coverage: expense rows render check-1 group before check-2 while edit/delete still hit the right original index; deposit dates render as `YYYY-MM-DD` (not the ISO timestamp); `fixedBillsForMonth` excludes debt+savings; `budgetAllocations.totals.fixed` = itemized sum when a paycheck exists, plan fallback otherwise; the Fixed section renders itemized rows.

## Non-goals
- No change to the discretionary envelope / PlanBand / over-flag (Option A). No editable fixed/debt/savings budget categories. No schema change.
