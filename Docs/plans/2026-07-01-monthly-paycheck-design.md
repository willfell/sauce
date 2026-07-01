# Monthly paycheck — design

**Date:** 2026-07-01
**Blueprint:** finance (currently 0.14.1)
**Scope:** redesign the `paycheck` entity from per-check to per-month, with per-expense deposit assignment.

## Problem

The user is paid semi-monthly (1st + 15th). The 1st check covers rent + fixed bills; credit-card/debt payments come from the 15th check. But **Paycheck Defaults dumps every monthly obligation onto whichever paycheck you scaffold**, so the July-1 paycheck falsely shows a $950 Apple payment that won't happen until the 15th. The model has no concept of "which check pays this," and juggling two separate per-check notes per month is confusing and makes the month rollup awkward.

## Decisions (from brainstorm)

- **D1 — one monthly paycheck note** keyed by `month` (like the budget), holding `deposits: [{date, amount}]` and one `expenses[]` list where each expense carries a `deposit` index (which check pays it). Chosen over two-fixed-sections and two-notes-plus-rollup.
- **D2 — clean cutover + archive.** Monthly notes going forward; old per-check notes are ignored by the month rollup and moved to `paychecks/_archive/` (never deleted). The user re-creates July as one monthly note.

## Architecture

One cohesive cycle. The paycheck entity changes shape; scaffold, defaults, editor, summary, month integration, and a migration heal all follow.

### Data model — the monthly paycheck note

`paychecks/2026-07/Paycheck-2026-07.md`:
```yaml
type: paycheck
month: "2026-07"
deposits:
  - { date: "2026-07-01", amount: 4500 }
  - { date: "2026-07-15", amount: 4500 }
expenses:
  - { item: Rent,       amount: 2200, category: Rent,           deposit: 1, paid: false }
  - { item: Apple Card, amount: 950,  category: Credit Payment, debt: "[[Debt-Apple-Card]]", deposit: 2, paid: false }
  # …each expense carries `deposit` = 1-based index into deposits[]
```
- `deposit` is a 1-based index into `deposits[]`. A missing/invalid `deposit` is coerced to **1** (first check) for totals + display, so partially-tagged or legacy rows never crash the widget.
- Naming: `Paycheck-YYYY-MM.md` under `paychecks/YYYY-MM/`. Naming pattern + `month` regex mirror the budget entity.

### Pay schedule + defaults pre-assignment

- **Paycheck Defaults** gains a `deposit_schedule: [{day: 1, amount: 4500}, {day: 15, amount: 4500}]` — the recurring shape of the month's deposits (day-of-month + typical amount).
- Each **default expense** gains a `deposit` field (1 or 2). The user sets it once — fixed bills → 1, cards + savings → 2 — so every new monthly paycheck scaffolds **pre-split correctly**.

### Scaffold behavior

The "+ New Paycheck" button prompts for a **month** (not start/end dates) and creates `Paycheck-{{month}}.md`:
- `expenses[]` seeds from Paycheck Defaults as today (incl. `resolve_wikilinks` pulling debt `planned_monthly_payment`/`url`), now carrying each default's `deposit` tag.
- `deposits[]` seeds from the Defaults `deposit_schedule` for that month. Because entity-create is static substitution and can't compute `date` from `day + month`, the note is born with `deposits: []` and the editor **materializes the deposits once on first render** from `deposit_schedule` + the note's `month` (day → `YYYY-MM-DD`, amount copied), then they're user-editable per month. Guarded: writes only when `deposits` is empty, embed-deduped, in-flight guard (no repeated writes).

### The widget (PaycheckExpensesEditor → per-deposit view)

- A deposits header: one column per deposit (date + amount), editable (amount varies per month).
- The `expenses[]` list renders with a per-row **deposit tag** (e.g. "1st"/"15th" derived from the deposit's date), clickable to move an expense between checks (an override of the `deposit` field — reuses the fixed render-from-authoritative + merge-on-edit pattern).
- Per-deposit subtotals: **Assigned** (Σ that deposit's expenses) and **Leftover** (`deposit.amount − assigned`); plus a combined month total (Σ deposits vs Σ expenses).
- Debt rows keep their `[[Debt-…]]` link + auto-filled amount. No stale-row bugs (built on the fixed editor).

### Month + Budget integration

- Attribution simplifies: `readPaychecksForMonth(dv, monthKey)` reads the **new-format** note(s) by `month` field (a monthly note has `deposits[]`). The `pay_period_end` matcher is retained only as a fallback for archived/legacy notes (which the rollup otherwise ignores).
- `monthIncome` = Σ `deposits[].amount`. `monthExpensesTotal` = Σ `expenses[].amount`. `monthDebtPaid` / `debtPaidByDebt` = paid+`debt` expenses (unchanged logic, same `expenses[]`).
- `MonthDashboard` "Paycheck Totals" shows a per-deposit breakdown (each check's income + assigned) instead of per-note rows.
- `MonthlyOverview` income filter reads the monthly note's `deposits[]`.
- Budget reconciliation (planned vs paid, the `budgetAllocations` view) is unchanged — the paycheck stays the "actual paid" side.

### Transition — clean cutover + archive

- **Functional cutover:** the month rollup reads only new-format notes (`deposits[]` present); old per-check notes (`pay_period_start`, no `deposits[]`) are not summed. This is the correctness guarantee — independent of any file move.
- **Tidiness heal (ungated, snapshot-guarded, idempotent):** move old-format paycheck notes into `paychecks/_archive/` (copy + remove original; `.sauce-backup` first; skip if already archived or already new-format). The rollup query excludes `_archive/`.
- The user's current `Paycheck-2026-07-01.md` (old format) is archived by this heal; the user creates one monthly `Paycheck-2026-07.md`.

## Data flow

```
Paycheck Defaults (deposit_schedule + expenses[].deposit)
        │ scaffold (+ first-render deposit materialize)
        ▼
Paycheck-YYYY-MM.md  { deposits[], expenses[].deposit }
        │
        ├─► PaycheckExpensesEditor (per-deposit columns, move-between-checks, subtotals)
        └─► FinanceMath.readPaychecksForMonth → monthIncome/Expenses/DebtPaid
                    │
                    ▼
              MonthDashboard (per-deposit Paycheck Totals) + Budget reconciliation
```

## Testing

- Preflight whole-suite green; `lint-schemas` green; `preflight-bumped` green; workshop self-install green.
- New behavioral coverage: `readPaychecksForMonth` reads month-keyed `deposits[]` notes; `monthIncome` sums deposits; a legacy per-check note (pay_period_start, no deposits) is NOT summed by the rollup. Editor: deposit materialize-on-first-render (writes once, idempotent); move-an-expense-between-deposits writes the `deposit` field + re-renders authoritatively; per-deposit subtotals compute.
- Update/replace the `pay_period_*` attribution assertions (`run-helper-cases` `V01103-MO-READS-3`, `run-v01103-monthly-overview`, `run-finance-plan-state`) for the month-keyed model.
- Seed regression: add a legacy per-check fixture + assert the archive heal moves it to `_archive/` and the rollup ignores it; add a new-format monthly fixture and assert the rollup reads it.

## Non-goals / YAGNI

- No support for >2 deposits config UI beyond what `deposit_schedule` naturally allows (the array handles N; the scaffold uses whatever the schedule defines).
- No auto-migration/merge of old per-check notes into monthly notes (clean cutover + archive instead — D2).
- No change to the budget, plan, savings, or debt entities.

## Risks

- **Breaking schema change** for the paycheck entity (per-check → per-month). Mitigated by the format-filter (rollup reads new-format only) + archive of old notes; nothing is deleted.
- **First-render deposit materialize** is a write-on-render side effect — must be strictly guarded (only when `deposits` empty, embed-dedup, in-flight flag) to avoid write loops; covered by an idempotency test.
- **Attribution assertions** pinned to `pay_period_*` must be updated in the same cycle or preflight/prepare-release wedges.
- Archive heal moves files in the user's vault — snapshot-guarded, idempotent, copy-before-remove.
