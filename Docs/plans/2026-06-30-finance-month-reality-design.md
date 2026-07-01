# Finance "month reality" — design

**Date:** 2026-06-30
**Blueprint:** finance (currently 0.12.0)
**Scope:** three cohesive corrections so the finance model matches how the user actually lives it.

## Problem

Three gaps surfaced while the user set up July:

1. **Paycheck→month attribution is wrong for straddling checks.** A paycheck is attributed to the month its `pay_period_start` falls in. The user is paid on the 1st and 15th; the check paying July's bills covers June 15→July 1, so it lands in **June** instead of July. Both monthly checks should wire to the month they're *paid in*.
2. **The monthly budget hides two-thirds of the money.** The July budget shows a $2,950 discretionary envelope with no visibility into the ~$1,900 debt outlay or $300 savings. The user wants the full ~$9k picture in the budget.
3. **The expense editors have a stale-cache bug + a data-loss bug.** Deleting/editing a paycheck (or budget) row via the `×`/edit UI re-renders from Dataview's lagging `dv.current()` cache, so the row *appears* not to delete — and repeated clicks delete *different* underlying rows (index cascade). Separately, editing a debt-linked row strips its `[[Debt-…]]` link because the edit dialog replaces the row object with only its editable fields.

## Decisions (from brainstorm)

- **D1 — attribute by `pay_period_end`.** No new schema field; maps exactly to the 1st/15th cadence (each pay period ends on a pay date). Fallback to `pay_period_start` when `pay_period_end` is absent (legacy safety).
- **D2 — budget debt/savings are two *views*, not a merged pot.** Budget = planned allocation; paycheck = actual paid (✓). The Month dashboard reconciles planned vs paid vs measured-balance-drop. Debt/savings planned numbers must **never** enter the discretionary-envelope sum.
- **D3 — live-derived with per-row override (refinement of "editable rows").** The budget's Debt/Savings sections render **live** from the debt entities' `planned_monthly_payment` + the plan's savings contribution. Editing a row **pins an override** into `debt_allocations[]` / `savings_allocations[]` on the budget. This delivers the approved behavior (auto-filled, editable per month, source-changes-flow-to-future-months) with no seed-at-creation mechanism, no install-time frontmatter migration, and no seed-vault churn. It follows the codebase's "live render beats materialize-once for derived views" lesson.

## Architecture

Three independent workstreams, one blueprint minor bump, one PR.

### Workstream 1 — attribution (`pay_period_end`)

- `FinanceMath.readPaychecksForMonth` (finance-math.js:37) — match `pay_period_end`'s month, fallback to `pay_period_start`. This is the single attribution source; `computePlanState` and `MonthDashboard` already route through it.
- `MonthlyOverview` (monthly-overview.js:106) — the one widget that filters paychecks independently; migrate its income filter to the same `pay_period_end`-first rule so budget-note income agrees with everything else.
- Month dashboard paycheck rows label with the pay date (`pay_period_end`).
- **Contract updates:** `run-helper-cases.js` assertion `V01103-MO-READS-3` (line ~13013) pins `pay_period_start` on monthly-overview — rewrite to accept the end-first rule. Behavioral harness `run-v01103-monthly-overview.js` stubs `pay_period_start` — extend its fixtures with an end date and assert end-based attribution. Schema-registry note `finance-monthly-overview-page-read` — update the prose describing the filter field.
- **New coverage:** `readPaychecksForMonth` currently has zero behavioral tests. Add cases to `run-finance-plan-state.js` (its `dv` stub already serves `spice/finance/paychecks` and its `paycheck()` factory sets both dates): a check with start `2026-06-28` / end `2026-07-02` attributes to `2026-07`; a legacy check with only `pay_period_start` still attributes by start.

### Workstream 2 — budget debt/savings sections (live + override)

- **Schema:** budget `rule_fragments` block (manifest.json ~672–697) gains optional `debt_allocations` + `savings_allocations` (`required: false, type: array`). Budget frontmatter template + manifest `inline_body` gain `debt_allocations: []` / `savings_allocations: []`. `schemas-index.json` `finance-rule-fragments` note updated (and the stale "10 rule_fragments" count corrected).
- **Engine:** new `FinanceMath.budgetAllocations(dv, monthKey)` → merges the plan's live per-debt allocation (`computePlanState().allocation`, i.e. min+attack routed to the avalanche target) and savings contribution with the budget's stored overrides. Returns `{ debt: [{slug, name, plannedLive, override, planned, source}], savings: [...], totals: {debt, savings, fixed, discretionary, income} }` — `planned = override ?? plannedLive`; `source ∈ "override" | "plan"`. Falls back to debt-entity `planned_monthly_payment` when no plan.
- **New widget `BudgetAllocationsEditor`** (budget-allocations-editor.js): renders a compact full-picture line (Income → Fixed → Debt → Savings → Discretionary) atop an editable **Debt** section and **Savings** section. Each row shows the live/override planned amount; clicking edits and **materializes an override** into the respective array (using the fixed render-from-authoritative + merge patterns from WS3). Registered in the finance customjs surface exactly as `budget-categories-editor.js` is.
- **Body injection heal `applyFinanceBudgetAllocationsBandInjection`** (install.js): ungated, marker-guarded body injection that adds the `BudgetAllocationsEditor` dataviewjs block to existing budget notes lacking it — mirrors `applyFinanceBudgetMonthlyBandInjection` (7617). New budgets get the block from the template/`inline_body`; this heal covers pre-existing budgets across vaults. Placed after `applyFinanceBudgetMonthlyBandInjection` in the `applyFinanceMigrations` ordered block (~5826) and exported near 14542.
- **Month dashboard reconciliation:** `_renderDebtChanges` (month-dashboard.js:183) gains a **planned** column sourced from the budget's `budgetAllocations`, so each debt row reads `planned (budget) · paid (paycheck) · measured drop`. Savings similar.
- **Envelope math untouched:** `computePlanState.planned` and every budget `categories.reduce` keep summing `categories[]` only. New arrays are never summed into discretionary. A test asserts the envelope is unaffected by `debt_allocations`.

### Workstream 3 — editor fixes

Applied to `PaycheckExpensesEditor`, `BudgetCategoriesEditor`, `BudgetDefaultsEditor`, and the new `BudgetAllocationsEditor`:

- **Render-from-authoritative.** Each mutate flow captures the freshly-written array inside the `_mutate` callback and passes it to `render(dv, override)`; `render` prefers the override over `dv.current()`. Kills the stuck-row symptom *and* the index-cascade (UI always reflects true post-write state with correct indices).
- **Merge-on-edit.** `_editFlow` / `_editCategoryFlow` use `Object.assign({}, current, result)` instead of `list[index] = result`, preserving `debt` links and any other non-dialog fields.
- **Coverage:** `run-renderer.js` already instantiates `BudgetCategoriesEditor` / `PaycheckExpensesEditor` (FF4/FF5) with a `customJS.FinanceFrontmatter.update` seam and a frozen `dv.current()`. Add cases: after a delete flow, the re-render reflects the shorter array even though `dv.current()` is frozen (proves render-from-authoritative); after an edit flow on a debt-linked row, the `debt` field survives (proves merge).

## Data flow (WS2)

```
debt entities (planned_monthly_payment)  ┐
Finance Plan (attack, savings glide)     ┼─► FinanceMath.computePlanState ─► live allocation
budget.debt_allocations[] (overrides)    ┘                                        │
budget.savings_allocations[] (overrides) ─────────────────────────────────────────┤
                                                                                   ▼
                                              FinanceMath.budgetAllocations(dv, monthKey)
                                                                                   │
                                        ┌──────────────────────────────────────────┤
                                        ▼                                          ▼
                          BudgetAllocationsEditor (edit → write override)   MonthDashboard (planned col)
```

## Testing

- Preflight (`npm run release:preflight`) must stay whole-suite green.
- New/updated behavioral cases: `run-finance-plan-state.js` (attribution), `run-renderer.js` (editor fixes), and a new `budgetAllocations` case (in `run-finance-plan-state.js` or `run-finance-plan-widgets.js`) covering live/override merge + envelope-isolation.
- Updated source-contract + behavioral: `run-helper-cases.js` `V01103-MO-READS-3`, `run-v01103-monthly-overview.js`.
- `npm run lint-schemas` green (schema-registry note update).
- `npm run release:preflight-bumped` on a clean tree before merge (component bump).
- Workshop self-install (`node platform/install.js --vault . --auto-approve`) green before push.
- **No new install-time frontmatter migration** ⇒ no seed-vault fixture or `HC-SEED-MIGRATE` family required. The one new heal is a body injection (like PlanBand's), optionally asserted against the seed's `Budget-2026-05` in `run-seed-migrations.js`.

## Non-goals / YAGNI

- No new `pay_date` field (D1 reuses `pay_period_end`).
- No seed-at-creation of allocation arrays (live fallback covers it).
- No editable debt/savings inside `BudgetSummary` (asserted read-only) — editing lives in the new editor.
- No change to how debt payments are tracked on paychecks (they remain the actual-paid ledger).

## Risks

- **Attribution re-buckets existing paychecks** across all consumer vaults. Mitigated: only checks whose end-month differs from start-month move, which is the intended correction; fallback preserves legacy checks lacking `pay_period_end`.
- **`monthly-overview` assertion coupling** — the pinned `pay_period_start` assertion must be rewritten in the same commit or preflight breaks.
- **Write-on-edit re-entrancy** in the new editor — reuse the existing editors' embed-dedup + `_mutate` guards; no write-on-render.
