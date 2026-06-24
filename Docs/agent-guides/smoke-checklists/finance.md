---
purpose: Manual in-Obsidian smoke checklist for the finance blueprint — the v0.10.0 planning / lever / allocation layer.
load_when: Cycle close that touches finance's template / dialog / widget surface; or verifying a finance deploy on a consumer vault.
status: load-bearing (v0.10.0) — walk on a deployed consumer vault (headspace) after Cmd+R.
---

# finance smoke checklist

Walk this on a **deployed consumer vault** (headspace) after `sauce update` + **Cmd+R**.
Headless harnesses (`run-finance-plan-state.js`, `run-finance-plan-widgets.js`, `run-seed-migrations.js`)
prove the math + that every widget renders without throwing — this checklist confirms the
*live* Obsidian behavior the harnesses can't reach (real DOM, modals, click handlers, your real data).

The expected numbers below assume the headspace Lever Protocol config: floor 9000, fixed 3851,
minimums 1330, attack 570, savings tier-1 300 → **envelope ≈ $2,949**, payoff ≈ mid-2029.
Adjust to your own plan if the numbers differ.

## 0. Setup — `spice/finance/Finance Plan.md`
- [ ] Open `Finance Plan.md`. Confirm the frontmatter carries your real numbers (income_floor 9000, fixed_living_monthly 3851, attack_above_minimums 570, the 3 savings_glide tiers, overflow 80/20, and the `attack_target_override` for the month-1 Apple bump). If it still shows `income_floor: 0`, fill it in first.

## 1. FinancePlanDashboard (on `Finance Plan.md`)
- [ ] **B1 Envelope** renders: Base / Effective / Planned / Spent / **Left** + status. Base ≈ **$2,949**. If a prior month overspent, a **Carry** cell appears and `effective = base − carry`.
- [ ] **Over-flag**: if your current Budget's planned total exceeds the effective envelope, a red **"⚠ OVER by $X"** band shows. (If not over, no band — correct.)
- [ ] **B2 Allocation**: one row per active debt (`min + attack = total`); the **target row is highlighted** — Apple while its balance ≥ $13,950 (the override), else Cap1 Platinum (highest APR). Others show `min (min)`. A **Savings** row shows the tier contribution + `Tier N`.
- [ ] **B3 Rollup**: total debt, `savings bal → target`, weighted APR, **zero-debt date** + months + kill order, a **what-if** line ("skip this month's attack → +N weeks"), and an **overflow** line *only if* a logged paycheck exceeds the floor.
- [ ] **Apply** → click `Apply to entities`. A confirm modal lists each debt's `planned_monthly_payment` **before → after** + the Paycheck Defaults Savings row. Click **Apply**.
  - [ ] Open a couple of `spice/finance/debts/Debt-*.md` → `planned_monthly_payment` now matches the allocation.
  - [ ] Open `spice/finance/Paycheck Defaults.md` → the Savings row `amount` = contribution ÷ pay_periods_per_month (e.g. 150).
  - [ ] Re-open the dashboard + click Apply again → modal says **"Nothing to change"** (idempotent).
- [ ] **Roll check** (optional): on a Debt note, set a card's `current_balance: 0` → Cmd+R the dashboard → the target rolls to the next-highest-APR active card automatically; the zero-debt date recomputes.

## 2. PlanBand (on any `spice/finance/budgets/<m>/Budget-<m>.md`)
- [ ] A compact band renders at the **top** of the Budget (above MonthlyOverview): `Envelope $X · Planned $Y · Left $Z`.
- [ ] If planned > effective envelope → a red **"⚠ OVER ENVELOPE by $X"** line. Left turns red when negative.
- [ ] A Budget for a month with **no plan filled** renders no PlanBand (degrade-gracefully) — not an error.

## 3. SavingsSummary + Edit balance (on `spice/finance/savings/Savings-Emergency-Fund.md`)
- [ ] Three bands: Name / Balance / Target + **progress bar** + a **Tier chip** (`Tier 1 · $300/mo`); a balance_history **sparkline** (or "no history yet"); "To target: $X" (or "Target reached").
- [ ] Click **"Edit balance"** → modal with Balance + Target inputs. Change Balance → **Save**.
  - [ ] The note's `balance_history[]` gains a prepended `{date, balance: <previous>, source: manual}`; `current_balance` + `last_updated` update; the sparkline + delta pill refresh (rising balance = green).
  - [ ] **Esc** cancels; **Enter** saves.

## 4. Savings hub + New Savings (on `spice/finance/savings/Savings.md`)
- [ ] `SavingsCards` grid renders one card per savings-account (balance + target-progress chip), sorted by balance DESC.
- [ ] The context row shows **`+ New Savings`** → click → name prompt (default "Emergency Fund") → creates `Savings-<slug>.md` with a SavingsSummary; empty-state reads "No savings accounts yet." when none.

## 5. Finance.md Plan tile + nav
- [ ] On `spice/finance/Finance.md`: a **Plan** tile shows `$X left` + `zero-debt <date>`; click → opens `Finance Plan.md`.
- [ ] **Savings** appears in the FinanceNav cross-hub row on every finance note (and is hidden when you're *on* a savings page).
- [ ] On `Finance Plan.md` the context row shows a **Finance Hub** link (config-plan mode).
- [ ] On a savings entity: **Savings Hub** button + **← Prev / Next →** sibling nav.

## 6. Console + acceptance
- [ ] DevTools console (Cmd+Opt+I) is **free of red errors** after Cmd+R on each surface above.
- [ ] **Acceptance:** the dashboard's envelope, per-card allocation, savings tier, and payoff date match what your hand-built Lever Protocol + Cadence produce. If every row matches, the native feature has replaced the manual system.

## Result-doc note
Paste "Manual smoke: COMPLETED on headspace <date>" (or list any deviations) into the cycle result doc.
