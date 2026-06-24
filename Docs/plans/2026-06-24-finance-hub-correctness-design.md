---
purpose: Sub-project 1 of the "hub-as-brain" arc — make FinancePlanDashboard correct against real multi-month data. governed_from baseline gating + overage-carry fix + payoff-date unification. Fixes the −$5,126 envelope on headspace.
kind: design
date: 2026-06-24
blueprint: finance
finance_version_target: 0.10.3
workshop_version_target: 0.130.0
predecessors:
  - Docs/plans/2026-06-22-v0.10.0-finance-planning-layer-design.md
note: v0.129.0 is reserved by the parallel auto-release-pipeline effort (PR #25); this cycle releases as 0.130.0.
---

# Finance hub correctness — governed_from + carry fix + payoff unification (finance 0.10.3)

## Why

The planning layer (v0.10.x) computes correctly against a single clean month but misbehaves against the **real** headspace ledger, which mixes pre-system baseline months with the new envelope. On `Finance.md` the Plan tile shows **−$5,126.53 left** and the hero/​tile disagree on the payoff date (2031-03 vs 2029-10). Both are bugs, not data problems.

This is sub-project **1** of the user's three-part roadmap (1: hub correctness · 2: Copilot actuals sync · 3: go live on a governed month). Sub-projects 2 and 3 get their own design.

## The two bugs (root cause)

1. **Overage carry penalizes ungoverned months.** `computePlanState` computes `overageCarry = max(0, priorSpent − base)` — last month's *spend* vs *this month's new envelope*. May 2026 was a pre-system month ($11,024 spent / $6,353 planned); against the $2,949 envelope that's a bogus $8,075 "overage" → effective envelope −$5,126. May's $11k is a baseline, not an envelope overage.
2. **Hero payoff ignores the minimum-roll.** `FinanceMath.debtTotals.zeroDebtDate` uses a flat `balance / (attack − interest)` estimate (→ 2031-03) while the planning dashboard uses the accurate avalanche simulation that rolls freed minimums (→ 2029-10). Two payoff dates on one screen.

## Decisions (from brainstorm)

- **Q1:** Preserve pre-system months as real baselines; don't rewrite history. Mark them ungoverned so the carry/scorecard ignores them.
- **Q2:** Mark governance with a single `governed_from: "YYYY-MM"` date on `Finance Plan.md`. Months ≥ it are governed (scored, carry applies); months before are baselines (carry ignores).
- **(b):** Unify *all three* payoff surfaces (hero, Debts hub, Plan tile) onto the accurate avalanche date.

## The three fixes

### (a) `governed_from` + carry fix — `FinanceMath.computePlanState`

Add `governed_from` to the plan schema (optional `YYYY-MM`). New engine logic:

```js
const governedFrom = this._coerceMonthString(plan.governed_from);          // "2026-07" | null
const isGoverned = (m) => !!(governedFrom && m && this._coerceMonthString(m) >= governedFrom);
// ... prevKey / prevBudget / priorSpent as today ...
const priorPlanned = (prevBudget && Array.isArray(prevBudget.categories))
    ? prevBudget.categories.reduce((s, c) => s + num(c && c.planned), 0) : 0;
// Carry flows ONLY governed → governed, and against the prior month's OWN plan:
const carryApplies = incomeFloor > 0 && isGoverned(monthKey) && isGoverned(prevKey) && prevBudget && priorPlanned > 0;
const overageCarry = carryApplies ? Math.max(0, priorSpent - priorPlanned) : 0;
const effective = base - overageCarry;
```

Add `governed: isGoverned(monthKey)` to the returned `envelope` object so views can frame baseline vs scored.

**Effect:** with `governed_from: "2026-07"`, June/May (< July) → no carry → envelope back to **+$2,949**. Once a governed July closes, August carries July's real overage (spend − July's $2,949 plan). If `governed_from` is unset → nothing governed → no carry (safe default).

### (b) Payoff unification — `FinanceMath.debtTotals`

Replace the flat `zeroDebtDate` estimate with the avalanche simulation (which already rolls freed minimums, finance 0.10.1). `plannedAttack` is the total outlay (Σ `planned_monthly_payment`), so attack-above-minimums = `plannedAttack − Σ active minimums`:

```js
const minsSum = debts.reduce((s, d) => s + ((Number(d.current_balance) || 0) > 0 ? (Number(d.min_payment) || 0) : 0), 0);
const zeroDebtDate = this.simulateAvalanche(debts, Math.max(0, plannedAttack - minsSum)).zeroDebtDate;
```

Every consumer of `debtTotals` (FinanceHubSummary hero, DebtsHubSummary, the Plan tile already uses `computePlanState`) now shows the same accurate ~2029 date. `debtTotals` becomes `this`-dependent — fine, it's always called as `customJS.FinanceMath.debtTotals(...)`.

### (c) Baseline framing — `FinancePlanDashboard` + `PlanBand` + Finance.md Plan tile

When `envelope.governed === false`:
- **Dashboard B1 / PlanBand:** suppress the red "OVER ENVELOPE" flag; render a muted **"baseline month — not scored against the envelope"** note instead. The envelope/allocation still render (they don't depend on governance).
- **Plan tile:** append a muted "· baseline" to the sub-line.

## Schema / scaffold / rule_fragment

- `Finance Plan.md` gains optional `governed_from`. The scaffold template (`install.js FINANCE_PLAN_TEMPLATE`) ships it as a commented/`null` default (`governed_from: null`), so a fresh vault has no governed months until the user sets it.
- finance-plan `rule_fragment`: add `governed_from` as `{ required: false, type: "string" }` (no `matches` to keep it lenient; null allowed).

## Tests

- `run-finance-plan-state.js`:
  - **CARRY-UNGOVERNED:** prior month not governed (or no `governed_from`) → `overageCarry === 0`, `effective === base`.
  - **CARRY-GOVERNED:** `governed_from` set, both months governed, prior overspent its own plan → carry = `priorSpent − priorPlanned`; `envelope.governed === true`.
  - **BASELINE:** current month < `governed_from` → `envelope.governed === false`.
  - Existing CARRY-1/2 updated to set `governed_from` so they still exercise the carry path.
- `run-finance-plan-widgets.js`: a DEBTTOTALS-PAYOFF assert that `debtTotals(headspaceDebts).zeroDebtDate` is the avalanche date (~2029, months 34–44), not the flat ~2031.

## Deployed plan files

Add `governed_from: "2026-07"` to the live `Finance Plan.md` on headspace + ero + barebones (the engine defaults to no-carry without it; setting it makes July the first governed month per the design).

## Versioning + release

finance 0.10.2 → **0.10.3** (PATCH: 2 bug fixes + 1 additive optional field); workshop 0.128.2 → **0.130.0** (0.129.0 reserved for the parallel auto-release PR #25). Full chain: PR → CI → tag v0.130.0 → tap → brew → re-deploy headspace/ero/barebones. Per landmine #24, bump the finance catalogue row too; seed subscription finance → 0.10.3.

## Out of scope (sub-projects 2 + 3)

Copilot actuals sync (G7); seeding/creating the governed month's budget; any history rewrite. The dashboard here still reads typed actuals until sub-project 2 lands the Copilot pull.
