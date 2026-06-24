---
purpose: Brainstorm input for the next finance-blueprint cycle — a native "planning / lever / envelope" layer that binds a month's spend to income, models priority-ordered levers, runs the savings glide path + overflow rule, and reduces the manual weekly/monthly ritual. Driven by a real consumer vault (Will / headspace) where the same system was just implemented by hand as process + config.
kind: brainstorm-input
date: 2026-06-22
blueprint: finance
current_version: 0.9.2
workshop_version: 0.125.0
predecessors:
  - Docs/plans/2026-06-15-finance-platform-state-and-v0112-handoff.md
  - platform/blueprints/finance/manifest.json
real_world_driver_docs:
  - /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/onboarding/Current Lay of the Land.md
  - /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/onboarding/Build-Out Plan.md
  - /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/knowledge/Lever Protocol.md
  - /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/knowledge/Cadence.md
  - spice/projects/sauce/docs/blueprints/how-they-work/Finance Blueprint.md  (mirrored in the consumer vault)
---

# Finance Blueprint — Planning / Lever / Envelope Layer (brainstorm input)

## How to use this doc

This is the **starting context for a brainstorming session** on the finance blueprint's next cycle (target: a `v0.10.0` MINOR). Read it, then run `superpowers:brainstorming` against it. It captures: why now (a real user), what the blueprint does today, the precise functionality gaps, seed design directions for each, the hard constraints, and the open questions a brainstorm must resolve. Do **not** treat the seed directions as decisions — they are raw material.

---

## 1. Why now — a real user already runs this by hand

The finance blueprint is deployed in the **headspace** consumer vault. Its owner (Will) has ~$49,740 in credit-card debt at a ~24.6% blended APR (~$1,022/mo interest) on ~$9,000/mo net income, and was going into every month with no plan — overspending on the same cards he was paying down, so balances never moved.

In a 2026-06-22 working session we designed and **implemented an accountability system entirely as process + config** on top of the existing blueprint:

- **One bridge number:** `income − fixed − card-minimums − savings − attack = discretionary envelope`. For Will: `$9,000 − $3,851 − $1,330 − $300 − $570 = $2,950`.
- **The Budget note IS the envelope** — only the variable (Copilot-tracked) categories, summing to $2,950. Fixed + debt + savings live on the paycheck/debt-entity side.
- **Three ordered levers:** discretionary → savings → debt-attack (last, emergency-only). Overspend reduces *next month's* envelope, never debt/savings.
- **Savings glide path:** tiered dial by emergency-fund balance ($300/mo until $1,500 → taper → $0 at $3,500).
- **Overflow rule:** income over the floor → 80% avalanche / 20% flex.
- **Avalanche** set via each debt entity's `planned_monthly_payment`.
- **Cadence:** 30-min monthly plan, 5-min weekly check, month-end reconcile.

**The point of this brainstorm:** everything smart in that system currently lives in a human's head and four markdown docs. The blueprint can't compute the envelope, can't flag an underwater plan, can't run the glide path, can't sync actuals, and can't show the lever trade-offs. We want to **move that intelligence into the blueprint** so it's reusable across vaults and stops depending on Will's discipline. The full real-world implementation (numbers, decisions, file paths) is in the four `real_world_driver_docs` above — they are the concrete spec of "what good looks like."

---

## 2. What the blueprint does today (v0.9.2)

Source: `platform/blueprints/finance/` (manifest + `content/` + `templates/` + 29 `helpers/*.js` CustomJS classes). Full mechanics: the Finance Blueprint how-it-works doc (`real_world_driver_docs`).

Relevant existing surface:
- **Budgets:** `Budget-<YYYY-MM>.md`, `categories[].{group,name,planned,actual}`, `groups[]`. Widgets `BudgetSummary` (planned/actual/diff + pace) and `BudgetCategoriesEditor`. Seeds from `Budget Defaults.md`.
- **Paychecks:** `expenses[].{item,amount,category,paid,debt?}`. `PaycheckSummary`, `PaycheckExpensesEditor`, `PaycheckDebtBand`. Debt rows pull `amount` from the linked debt's `planned_monthly_payment` at scaffold time (`resolve_wikilinks`).
- **Debts:** `current_balance`, `apr`, `min_payment`, `planned_monthly_payment`, `balance_history[]`. `DebtSummary`/`DebtsHubSummary` compute monthly interest, payoff months, weighted APR, projected zero-debt date.
- **Months:** read-only `MonthDashboard` reconciliation (Budget analysis + Paycheck totals + Debt changes: "paid $X · dropped $Y · $Z to interest").
- **MonthlyOverview** (on every Budget): Income (Σ paychecks) · Spending (Σ actuals) · Debt paydown · Net cashflow — **but after the fact, and it never forms a forward envelope or flags plan > income.**
- **FinanceMath** (instance methods): `debtTotals`, `monthIncome`, `monthSpending`, `monthDebtPaid`, `measuredMovement`, `reconcile`, payoff math. **This is the home for any new shared formula.**
- **Cowork glue (planned, not built):** `gather-cc-debt-snapshot` skill to write `balance_history[]` with `source:"skill"`. The `skill` enum slot is already reserved.
- **Existing carry-forward in the manifest/how-it-works doc:** *"Budget should account for debt and link to that month's paychecks"* — this brainstorm is that carry-forward, scoped up.

---

## 3. The functionality gaps (each = a thing we did by hand the blueprint can't do)

| # | Gap | Process workaround today | Why it matters |
|---|---|---|---|
| G1 | **Income-bound envelope** — compute `income − fixed − savings − attack` and bind the budget to it | computed by hand; budget total set manually to $2,950 | the core of "stop spending more than you make" — without it the budget is just planned-vs-actual, blind to income |
| G2 | **Underwater-plan flag** | eyeballed | the original budget was $11,583 vs $9,000 and nothing warned | 
| G3 | **Lever model + overage carry** — ordered levers; overspend auto-reduces next month's envelope | manual note in Month reconcile | makes the system self-correct instead of silently re-borrowing |
| G4 | **Savings glide path** — tiered savings dial by emergency-fund balance | manual tier tracking | automates "fund both, then tilt, then all-debt" |
| G5 | **Overflow rule** — income over floor → split to attack | manual | turns lumpy extra income into payoff acceleration automatically |
| G6 | **What-if payoff projection** — move a lever, see the payoff-date delta | computed in a one-off analysis | makes the cost of pulling the debt lever visible at decision time |
| G7 | **Copilot → budget actuals sync** — pull category actuals (and balances) from the finance app | fully manual weekly check + manual Copilot mirror | the single biggest "make it not manual" win |
| G8 | **Envelope budget shape** as a first-class concept | done by convention (variable-only budget) | so other vaults get the envelope framing out of the box |

---

## 4. Seed design directions (raw material — not decisions)

- **A central `Finance Plan.md` config (likely the keystone).** A new `type: finance-plan` file holding the inputs every gap needs: `income_floor`, `savings_target` + glide tiers, `attack_above_minimums`, `lever_order`, `overflow_rule`. The envelope = `income_floor − Σ(fixed paycheck items) − Σ(card minimums) − savings(current tier) − attack`. One source of truth the widgets read.
- **A `PlanBand` / `BudgetEnvelope` widget** at the top of the Budget note: shows the envelope math, "planned vs envelope" with a red flag if categories[].planned exceeds the envelope (G1+G2+G8). Read-only, embed-deduped, FinanceMath-backed.
- **Overage carry (G3):** at month close, `MonthDashboard` computes `actual − envelope`; if positive, writes/suggests a `carry: -$X` into next month's plan so the next envelope auto-shrinks. Keep it suggestion-first (don't silently mutate).
- **Glide path (G4):** `Finance Plan` holds tiers; the savings contribution is derived from the current emergency-fund balance. Needs an emergency-fund balance source — a tracked savings "account" entity, a Copilot goal, or a manual field.
- **Overflow (G5):** when `MonthlyOverview` sees income > floor, surface the surplus + suggested split per the rule.
- **What-if (G6):** parametric payoff on `DebtsHubSummary` — a small control (or just a table) showing payoff date at attack = current ± deltas. FinanceMath already has the formula; expose it parametrically.
- **Copilot sync (G7):** a cowork skill (`gather-budget-actuals`) that reads the finance app via MCP and writes `categories[].actual` on the current Budget, paired with `gather-cc-debt-snapshot` for `balance_history[]`. This is where "manual weekly check" disappears. Note the real driver uses Copilot Money MCP (read-only); design the skill against a generic "finance source" interface.

---

## 5. Hard constraints (from the blueprint's architecture)

- **CustomJS = instance methods** (`customJS.X.method`), never static. New math goes in **FinanceMath**; no widget re-implements a formula.
- **Installer migrations must be headless-safe:** `adapter.read`/`adapter.write` + regex/YAML mutation (never `processFrontMatter`), marker-guarded for idempotency, `.sauce-backup/<ts>/` snapshot per write, per-file failure-loud (never abort the install).
- **Backcompat:** existing Budget/Paycheck/Debt/Month notes must keep working; new fields additive; new widgets injected append-only with anchor-priority + marker comments.
- **Widgets:** single async `render(dv[,opts])`, embed-dedup via `dv.container.closest(".markdown-embed")`, hardcoded status colors (green `#16a34a` / amber `#b45309` / red `#dc2626`).
- **Versioning:** new sub-feature → finance MINOR (`v0.10.0`); ship the design/plan/result triplet in `Docs/plans/` and bump pins in `platform/manifest.json` + `ranch/platform-subscription.json`.
- **Don't break the consumer vault:** headspace is live on this blueprint with real data; any migration must be safe against the exact files described in the driver docs.

---

## 6. Open questions for the brainstorm

1. **Where do the plan inputs live?** A new `Finance Plan.md` config vs. new fields on `Budget Defaults.md` vs. a `months/` plan entity. (Keystone decision.)
2. **Envelope: derived or editable?** Is the budget a read-only envelope computed from the plan, or an editable budget validated against the plan with a flag?
3. **Widget vs cowork skill split.** How much is in-vault compute (widgets/FinanceMath) vs MCP sync (cowork skills)? What's the minimum to make the weekly check disappear?
4. **Emergency-fund + income sources.** Manual fields, a tracked account entity, or live MCP? The glide path and overflow rule both need a current balance + an income floor.
5. **Lever enforcement strength.** Suggestion-only (write a recommended carry) vs auto-mutation of next month's envelope. Where's the line that stays trustworthy?
6. **MVP scope for v0.10.0.** Likely: `Finance Plan` config + `PlanBand` envelope/flag (G1+G2+G8). Probable fast-follow: glide path + overflow (G4+G5), then the Copilot sync skill (G7), then what-if + overage carry (G6+G3). Confirm the cut.
7. **Generalization.** The driver is one debt-heavy personal vault. What about a vault with no debt, or variable income, or multiple income floors? Keep the envelope math degrade-gracefully.

---

## 7. Success criteria for the eventual feature

- A fresh vault can define a plan once and get an **income-bound envelope** that **flags an underwater month before it happens**.
- The **savings glide path** and **overflow rule** run from config, not memory.
- The **weekly check is mostly automated** (actuals + balances synced from the finance app).
- Pulling the **debt lever shows its payoff-date cost** at decision time.
- The headspace vault's hand-built system (the driver docs) can be **replaced by the native feature** with no loss of fidelity — that's the acceptance test.

---

**Next step:** run `superpowers:brainstorming` against this doc (in the sauce repo) to produce `Docs/plans/2026-06-22-v0.10.0-finance-planning-layer-design.md`. Keep the headspace driver docs open as the concrete "what good looks like."
