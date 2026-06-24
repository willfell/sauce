---
purpose: Implementation plan for the finance hub-correctness cycle (finance 0.10.3 / workshop 0.130.0) — governed_from + carry fix + payoff unification. Pairs with the design of the same date.
kind: plan
date: 2026-06-24
blueprint: finance
finance_version_target: 0.10.3
workshop_version_target: 0.130.0
design: Docs/plans/2026-06-24-finance-hub-correctness-design.md
---

# Implementation plan — finance hub correctness (finance 0.10.3)

Small, single-surface (FinanceMath + 3 thin views). Built directly + verified by harness.

## S1 — Engine (`FinanceMath`)
- `computePlanState`: add `governed_from` read + `isGoverned(m)`; overage carry now `max(0, priorSpent − priorPlanned)` and only when `incomeFloor>0 && isGoverned(monthKey) && isGoverned(prevKey) && prevBudget && priorPlanned>0`. Add `governed` + `governedFrom` to the returned `envelope`.
- `debtTotals.zeroDebtDate`: compute via `this.simulateAvalanche(debts, plannedAttack − Σ active minimums)` instead of the flat `balance/(attack−interest)` estimate.

## S2 — Views (baseline framing)
- `FinancePlanDashboard` B1: over-flag only when `governed`; else a muted "Baseline month — not scored" note.
- `PlanBand`: same gating + baseline note.
- `FinanceHubSummary` Plan tile: append " · baseline" when not governed.

## S3 — Schema / scaffold
- `install.js FINANCE_PLAN_TEMPLATE`: ship `governed_from: null`.
- rule_fragment: NO change — `governed_from` is an additive optional field; the validator allows undeclared fields (and a `null` default would warn under a `type:string` rule). Documented deviation from the design.

## S4 — Tests
- `run-finance-plan-state.js`: CARRY-1/2/3 now set `governed_from` (still 151); NEW BASELINE-1..4 (ungoverned prior → carry 0; month < governed_from → governed:false; no governed_from → governed:false + carry 0); NEW DEBTTOTALS-1..3 (debtTotals payoff == simulateAvalanche, ~34–44 mo). → 45/0.
- `run-finance-plan-widgets.js`: PLAN fixture gains `governed_from` (over-flag tests need a governed month); NEW DASH-11 (ungoverned → "Baseline month" note, no over-flag). → 28/0.

## S5 — Version (landmines #16/#24)
- finance 0.10.2→0.10.3; workshop 0.128.2→**0.130.0** (0.129.0 reserved for the parallel auto-release PR #25); catalogue row; package.json; ranch + seed subscriptions. VERSION-range sweep: widen workshop regexes to `|129|130`; `HC-V0127-VERSION-A` → `/^0\.130\.\d+$/`.

## S6 — Gates + deploy
- `release:preflight` GREEN; dogfood exit 0.
- PR → CI → merge → tag v0.130.0 → tap → brew → `sauce update --bump-pins` on headspace/ero/barebones (accuris has no finance).
- Set `governed_from: "2026-07"` on the live `Finance Plan.md` of headspace/ero/barebones (the engine no-carries without it; this makes July the first governed month).

## Verification (real data)
headspace `computePlanState(2026-06)` → envelope **+$2,949** (June < governed_from July → no carry), payoff **~2029-09** unified across hero/Debts-hub/tile.
