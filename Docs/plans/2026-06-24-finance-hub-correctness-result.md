---
purpose: Result doc for the finance hub-correctness cycle (finance 0.10.3 / workshop 0.130.0).
kind: result
date: 2026-06-24
blueprint: finance
finance_version: 0.10.3
workshop_version: 0.130.0
design: Docs/plans/2026-06-24-finance-hub-correctness-design.md
plan: Docs/plans/2026-06-24-finance-hub-correctness-plan.md
---

# v0.130.0 — finance hub correctness (finance 0.10.3)

Sub-project 1 of the "hub-as-brain" arc. Fixes the −$5,126 envelope the user saw on headspace's Finance hub + the two-payoff-dates inconsistency.

## What shipped

1. **`governed_from` + overage-carry fix (`FinanceMath.computePlanState`).** New `governed_from: "YYYY-MM"` field on the plan. The overage carry now applies **only governed → governed** (both the current and prior month ≥ `governed_from`) and compares the prior month's spend to its **own** plan (`max(0, priorSpent − priorPlanned)`), never to the current envelope. A pre-system baseline month no longer punishes the new envelope. `envelope.governed` + `envelope.governedFrom` added to the return.
2. **Payoff unification (`FinanceMath.debtTotals`).** `zeroDebtDate` now comes from `simulateAvalanche(debts, plannedAttack − Σ active minimums)` (rolls freed minimums) instead of the flat `balance/(attack−interest)` estimate. The FinanceHubSummary hero, DebtsHubSummary, and the Plan tile now all show the same accurate ~2029 date.
3. **Baseline framing.** FinancePlanDashboard B1 + PlanBand show "Baseline month — not scored against the envelope" (and suppress the over-flag) when `!governed`; the Plan tile appends " · baseline".

## Gates

`release:preflight` GREEN — run-finance-plan-state **45/0** (CARRY-1/2/3 governed-gated; NEW BASELINE-1..4, DEBTTOTALS-1..3), run-finance-plan-widgets **28/0** (NEW DASH-11), seed 229/229, `version-sync ok: 0.130.0`. Dogfood exit 0. CI green macOS + Ubuntu (PR #26).

**Real-data verification:** headspace `computePlanState(2026-06)` → envelope **+$2,949** (June < governed_from July → no carry), allocation Apple-targeted $950, payoff **~2029-09** unified across all surfaces.

## Lessons

- **Cross-month carry/penalty math must be aware of when the system started.** Silently penalizing ungoverned months produces alarming nonsense (a negative envelope) on real history. Gate on an explicit `governed_from`; compare a month's spend to its OWN plan.
- **Verify against REAL multi-month vault data.** 63 green single-month fixture asserts never exercised a baseline prior month; the bug only surfaced on the live ledger.

## Carry-forwards (the rest of the arc)

- **Sub-project 2 — Copilot actuals sync (G7).** Pull real category spend into the governed month's budget so "spent/left" is real, not typed. Its own brainstorm (shipped skill vs on-demand, mapping, write-back safety).
- **Sub-project 3 — seed + go live.** Create the governed month's budget from the envelope defaults, sync its actuals, run the cadence.
- The per-cycle allocation min-roll (from v0.128.1) still stands.

## Versioning note

Workshop 0.128.2 → **0.130.0**. 0.129.0 is claimed by the parallel auto-release-pipeline effort (PR #25, "awaiting Phase 1"); when that resumes it will need to renumber to ≥ 0.131.0 since 0.130.0 has shipped.

**Commits:** branch `cycle/finance-hub-correctness`; PR #26.
