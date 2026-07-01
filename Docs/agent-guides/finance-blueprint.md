---
purpose: Canonical reference for the finance blueprint — entities + data model, the FinanceMath engine, the Finance Plan (lever protocol), every widget, the month workflow, install heals, and the load-bearing invariants. Read before any finance work.
load_when: Designing or debugging anything in platform/blueprints/finance/, touching a finance frontmatter schema, the FinanceMath engine, a finance widget, a finance install heal, or a consumer vault's spice/finance/ notes.
---

# Finance blueprint

The finance blueprint (`platform/blueprints/finance/`, installs under `spice/finance/`) is a personal-finance system: budgeting, semi-monthly paychecks, debt payoff (avalanche), savings glide, monthly reconciliation, and consulting invoices. It is the most complex blueprint in the workshop (~35 CustomJS classes + a shared engine + ~25 install heals). This guide is the map; the code is the source of truth (the manifest `description` prose is version-lagged — trust the code).

**Version at last doc pass:** finance `0.16.0`. `depends_on`: `nav-buttons >=2.5.2`, `cards >=0.2.3`, `customjs-guard >=1.0.0`, `accent-button >=0.1.0`, `convenience >=0.1.0`, `entity-create >=0.7.0`.

## The mental model (read this first)

Three layers, and one invariant that everything else protects:

1. **The Finance Plan** (`Finance Plan.md`, one singleton) = your **steady-state policy**: income floor, fixed living, debt-attack size, savings glide, avalanche order. It changes rarely. The `FinancePlanDashboard` computes the whole plan-state live and can "Apply to entities."
2. **The three Defaults notes** (`Budget Defaults.md`, `Paycheck Defaults.md`, `Debt Defaults.md`) = **templates** that seed every new entity. Edit once; every future month scaffolds from them.
3. **Per-month snapshots** (`Budget-YYYY-MM.md`, `Paycheck-YYYY-MM.md`, `Month-YYYY-MM.md`) = **editable copies** seeded from the defaults. Editing a month's snapshot is *inherently* a one-month change; next month re-scaffolds from the (untouched) defaults. This is how one-off adjustments work — you edit the month, not the defaults.

**THE ENVELOPE-ISOLATION INVARIANT (never break this):** the budget's discretionary **Planned / Actual / Variance** and the over-envelope flag are computed from `budget.categories[]` **only**. Debt payments, savings contributions, and fixed bills are **display-only** — they appear in the budget's full-picture reconciliation and on the paycheck, but they are *never* summed into the discretionary envelope. Folding them into `categories[]` would falsely flag the budget "over" by ~$6k every month. The over-flag text literally says "trim a **discretionary** category." Guarded across `computePlanState`, `BudgetSummary`, `MonthlyOverview`, `PlanBand`, and `BudgetAllocationsEditor`.

Two engineering patterns this blueprint standardized (apply them to new finance work):
- **Live-derived + materialize-on-edit** — derived views (debt/savings allocations, deposits) render live from the source and only *write* when the user edits (materializing an override), rather than snapshotting at creation. Beats materialize-once for anything derived.
- **Render-from-authoritative + merge-on-edit** — editor flows re-render from the array they just wrote (not the lagging `dv.current()` Dataview cache), and edit merges (`Object.assign({}, current, result)`) rather than replacing (which would strip fields like `debt` links). Every finance editor uses this; a new one must too.

## Entities + data model

All under `spice/finance/`. Schemas are enforced by `manifest.json` `rule_fragments[]` and authored by `new_entity_buttons[].frontmatter_template`. `balance_history[]` (debt + savings) is stored **newest-first**.

| type | path / filename | key frontmatter |
|---|---|---|
| `finance-plan` | `Finance Plan.md` (singleton) | `income_floor`(req), `fixed_living_monthly`, `attack_above_minimums`, `pay_periods_per_month`(≈2), `roll_freed_savings_to_attack`, `savings_glide[]`, `overflow{attack_pct,flex_pct}`, `governed_from`("YYYY-MM"), `attack_target_override{debt,until_balance_below}` |
| `budget-defaults` | `Budget Defaults.md` | `groups[]`(strings), `categories[]` = `{group,name,planned}` (no actual) |
| `paycheck-defaults` | `Paycheck Defaults.md` | `expenses[]` = `{item,amount,category,url?,deposit(1-based),debt?}`; `deposit_schedule[]` = `{day,amount}` (the check calendar) |
| `debt-defaults` | `Debt Defaults.md` | `debts[]` = `{kind,name,current_balance,credit_limit?,apr,min_payment,planned_monthly_payment,url?}` |
| `budget` | `budgets/YYYY-MM/Budget-YYYY-MM.md` | `month`(req), `groups[]`, `categories[]`=`{name,planned,actual,group}` **(the envelope's only input)**, `debt_allocations[]`=`{slug,planned}`, `savings_allocations[]`=`{name,planned}` (overrides; display-only), optional `actuals_synced_at`/`actuals_source` |
| `paycheck` | `paychecks/YYYY-MM/Paycheck-YYYY-MM.md` | `month`(req), `deposits[]`=`{date,amount}` (the checks; Σ = income), `expenses[]`=`{item,amount,category,url?,debt?,paid,deposit(1-based index into deposits)}`. LEGACY per-check notes have `pay_period_start`/`paycheck_amount` + no `deposits[]` → archived. |
| `debt` | `debts/Debt-<Name>.md` | `kind`(req), `name`(req), `current_balance`(req), `apr`, `min_payment`, `credit_limit?`(CC), `planned_monthly_payment`, `balance_history[]`=`{date,balance,source}`, `url?` |
| `savings-account` | `savings/Savings-<Name>.md` | `name`(req), `current_balance`(req), `target`, `balance_history[]`, `last_updated` |
| `month` | `months/Month-YYYY-MM.md` | `month`(req) only — pure reconciliation view; a `## Notes` free-text body |
| `invoice` | `invoices/YYYY-MM/Invoice-YYYY-MM.md` | `month`(req), `date`(req), `rate`, `hours`, `amount`(=round(rate*hours,2)), `submitted_date`. Sidecars in the same folder: `Time-Log-YYYY-MM.md` (`entries[]`) + `board/Board-YYYY-MM.md` (kanban) |
| hubs | `Finance.md`, `budgets/Budgets.md`, `paychecks/Paychecks.md`, `debts/Debts.md`, `months/Months.md`, `savings/Savings.md`, `invoices/Invoices.md` | `type: *-hub`, `tags:[finance-hub]`; each embeds `SpaceNavButtons` + `FinanceNav` + a cards/summary widget. Non-Finance hubs carry a `// entity-create:<X>` marker **above** the FinanceNav block (drives the "+ New" button; must LEAD the block or dataviewjs throws). |

### Scaffolds (`new_entity_buttons[]`)
Each renders a "+ New X" button on its hub via the `entity-create` mechanism. `+ New Budget/Paycheck/Invoice/Month` prompt for a **month**; `+ New Debt` prompts name+kind; `+ New Savings` prompts name.
- **Budget** seeds `categories` from Budget Defaults (`per_item_set:{actual:0}`, carries `groups`).
- **Paycheck** seeds `expenses` from Paycheck Defaults (`per_item_set:{paid:false}`) and — the one notable mechanism — **`resolve_wikilinks`** resolves each row's `debt:[[Debt-X]]` and merges the debt entity's `planned_monthly_payment`→`amount` + `url` at scaffold time, so CC-payment rows auto-fill from the debt.
- **Invoice** emits `extra_files`: a Time-Log + a kanban Board.

## The FinanceMath engine (`helpers/finance-math.js`)

The single aggregation engine; pure math + Dataview reads, no rendering. Every widget routes through it. Key methods:

- **`computePlanState(dv, monthKey)`** — the keystone. One read of plan + debts + savings + paycheck + budget → `{ok, inputs, envelope, savings, attack, allocation, payoff, overflow, whatIf, applyPlan}`. See "Lever protocol" below.
- **`budgetAllocations(dv, monthKey)`** — the budget full-picture VIEW: merges the plan's live per-debt allocation + savings contribution + itemized fixed bills with the budget's `debt_allocations`/`savings_allocations` overrides. Returns `{fixed:[items], debt:[{slug,name,plannedLive,override,planned,source}], savings:[…], totals:{debt,savings,fixed,income,discretionary}}`. **Never enters the envelope.**
- **`projectedPayoff(dv, monthKey)`** — the ONE canonical payoff source (plan → entities → none precedence). `{totalBalance, monthlyInterest, plannedAttack, weightedApr, zeroDebtDate, months, killOrder, source}`; `killOrder[].slug === Debt file.name`. Hero, Debts hub, and per-debt all route here so they agree.
- **`simulateAvalanche(debts, attackTotal, opts?)`** — month-by-month payoff sim; holds total monthly outlay constant (freed minimums roll to the target); `opts.overrideKey/overrideBelow` (forced target), `opts.skipFirstMonthAttack` (what-if). Non-convergence → `months: Infinity`.
- **`readPaychecksForMonth(dv, monthKey)`** — month-keyed reader; matches `month` (legacy fallback `pay_period_end`→`start`); **excludes `/_archive/`**; de-dupes legacy vs monthly (drops legacy when a monthly note exists that month).
- **`depositTotals(paycheck)`** → `[{date,amount,assigned,leftover}]` per deposit (`assigned` = Σ expenses tagged to it); dates coerced to `YYYY-MM-DD`.
- **`fixedBillsForMonth(dv, monthKey)`** → `{items:[{item,amount}], total}` = paycheck expenses that are neither debt-linked nor `category=savings`. Display-only for the budget full-picture.
- **`monthIncome`** (Σ deposits, legacy `paycheck_amount` fallback), **`monthExpensesTotal`**, **`monthSpending(budget)`** (Σ categories.actual), **`monthDebtPaid`** (Σ `paid:true`+`debt` expenses), **`debtPaidByDebt`** (Map by debt).
- **`measuredMovement(debts, monthKey)`** (opening vs closing balance from `balance_history[]`) + **`reconcile(paydownApplied, measuredMovement)`** → `{paydownApplied, measuredDrop, interestAndCharges}`.
- **`debtTotals`, `glide(balance, tiers)`, `actualsFreshness`, `fmtMoney`, `readDebts/readSavings/readPlan/readBudgetForMonth`**, and coercers `_coerceDateString`/`_coerceMonthString`, `_depositIndex`, `_debtKey` (normalizes string OR Dataview Link object).

### Lever protocol (`computePlanState`)
`envelope.base = income_floor − fixed_living_monthly − Σ active minimums − attackTotal − savingsContribution`, where `attackTotal = attack_above_minimums + freed` (`freed` = the tier-1 savings amount the glide dropped, rolled into attack when `roll_freed_savings_to_attack`). **Overage carry**: governed month with a governed prior month → `overageCarry = max(0, priorSpent − priorPlanned)` (prior's OWN plan). `effective = base − overageCarry`; `over = planned > effective ? planned−effective : 0` (only when `governed_from` ≤ month; baseline months never scored). Savings via `glide(balance, savings_glide)`; avalanche ranks by APR desc (unless `attack_target_override` still applies); `payoff`/`whatIf` via `simulateAvalanche`; `overflow` only when actual income > floor. `applyPlan` feeds `FinancePlanDashboard`'s "Apply to entities" (writes each debt's `planned_monthly_payment` + the Paycheck Defaults Savings row).

## Widgets (by area)

- **Shared:** `FinanceMath` (engine), `FinanceFrontmatter` (all writes via `processFrontMatter`), `FinanceStatus` (status pills). Nav: **`FinanceNav`** (current, context-aware, all hubs+entities) supersedes the legacy `FinanceNavRow` + `FinanceHubActions`.
- **Top hub:** `FinanceHubSummary` (Finance.md landing: debt hero + plan/budget/paycheck/invoice tiles).
- **Budget:** `BudgetSummary` (read-only Planned/Actual/Diff from categories), `BudgetCategoriesEditor` (edit categories), **`BudgetAllocationsEditor`** (editable debt/savings overrides + read-only reconcile-to-income full-picture + itemized Fixed), `BudgetDefaultsEditor`, `BudgetsCards`, `MonthlyOverview` (income/spend/debt/net band), **`PlanBand`** (the over-envelope flag — consumer face of the invariant).
- **Paycheck:** `PaycheckSummary`, **`PaycheckExpensesEditor`** (per-deposit grouping, materializes `deposits[]` from `deposit_schedule`, move-bill-between-checks, groups expenses by check), `PaycheckDefaultsEditor` (expenses + deposit_schedule), `PaycheckDebtBand`, `PaychecksCards` (excludes `_archive/`).
- **Debt:** `DebtSummary` (per-debt bands + sparkline + payoff), `DebtsHubSummary`, `DebtsCards`, `DebtConfigEditor` (modal; auto-snapshots prior balance), `DebtDefaultsEditor`.
- **Savings:** `SavingsSummary` (target + glide tier + sparkline), `SavingsCards`, `SavingsConfigEditor` (modal; auto-snapshot).
- **Month:** **`MonthDashboard`** (Budget Analysis / Paycheck Totals / Debt Changes reconciliation), `MonthsCards`.
- **Plan:** **`FinancePlanDashboard`** (envelope / allocation / rollup / payoff / what-if / "Apply to entities").
- **Invoice:** `InvoicesCards`, `InvoiceControls` (rate/amount/submitted), `InvoiceTimeLogEditor` (entries → propagates hours+amount to the invoice), `InvoiceWorkspaceNav`.

## Workflow — how a month works

**One-time:** set the **Finance Plan**; fill the **three Defaults**; create **Debts** + **Savings** (balances edited via the modal editors, which auto-snapshot into `balance_history[]`).

**Each month:** `+ New Budget` (seeds discretionary categories) · `+ New Paycheck` (seeds expenses + deposit calendar; tag each expense to a deposit, check off `paid`) · `+ New Month` (pure reconciliation view).

**Reconciliation (what equals what):** paycheck **deposits = income**; **`paid:true`+`debt` expenses = debt paydown**; budget **`categories[]` = planned/actual discretionary**; **`BudgetAllocationsEditor` = full-picture reconcile-to-income** (Income → Fixed · Debt · Savings · Discretionary → Total allocated; "green" = Total allocated ≤ income); **`MonthDashboard` = planned vs paid vs measured** (measured from `balance_history[]`).

## Install heals (`platform/install.js`, orchestrated by `applyFinanceMigrations`)

**Scaffolding (ungated, create-if-absent, never overwrite user content):** `applyFinance{Defaults,Debt,Months,Plan,Savings}Scaffolding`. **Backfill/inject (ungated, marker-guarded, `.sauce-backup` snapshot):** budget group seed, band injections (`MonthlyOverview`, `BudgetAllocations`, `PaycheckDebtBand`, `PlanBand`), defaults debt-linking/backfill, `applyFinanceMonthsEntityCreateSentinel` (marker-leads-the-block fix), and **`applyFinancePaycheckArchiveLegacy`** (moves legacy per-check notes → `paychecks/_archive/`). **Version-GATED one-time reshapers** (only for pre-existing legacy content): `*BodyMigration` (0.107.0), `*NavRowMigration`/`GuardForm` (0.108.0/0.110.3), `HubFrontmatterHeal` (0.115.1), `HubsRepair` (0.110.0), `UnifiedNavMigration` (0.111.0). Gate rule (landmine): gate ONLY reshapers of legacy content; NEVER gate backfill/ensure/inject/repair.

## Recent evolution (finance 0.12 → 0.16, this arc)

- **0.12 correctness pass** — `projectedPayoff` unified payoff; credit_limit scaffold.
- **0.13 month-reality** (v0.150.0) — paychecks attribute by pay date; budget gains live debt/savings sections (`budgetAllocations` + `BudgetAllocationsEditor`); editor data-loss fixes (render-from-authoritative + merge-on-edit).
- **0.13.1 Months.md eval fix** — `entity-create:month` marker must LEAD the FinanceNav dataviewjs block (a trailing `//` comment eats Dataview's injected closing brace → eval error).
- **0.14 reconcile-to-income** — budget full-picture became a waterfall summing to a bold "Total allocated" vs income.
- **0.15 monthly paycheck** (v0.157.0) — the big one: paycheck went **per-check → per-month** (`month` + `deposits[]` + per-expense `deposit` tag); per-deposit editor + materialize + move-between-checks; archive heal for legacy notes. Backward-compatible transition (prefer-new-fallback-legacy + cutover-via-archive) kept the suite green.
- **0.16 tweaks** — group paycheck expenses by check; clean deposit dates; itemize fixed bills in the budget full-picture (envelope untouched).

## Load-bearing invariants + gotchas
- **Envelope isolation** (above) — the #1 rule.
- **`entity-create:<X>` markers must LEAD their FinanceNav block** (trailing → dataviewjs eval error).
- **customJS files: bare class only, no trailing statements** (the loader `eval`s the whole file as one expression) — see [`../landmines.md`] / the CJS-LOAD gate.
- **New editors:** render-from-authoritative + merge-on-edit, never write on a plain render, embed-dedup guard.
- **`FinanceFrontmatter.update` is the only write path** (wraps `processFrontMatter`).
- **`_debtKey`** must handle both a `"[[Debt-X]]"` string and a Dataview Link object.
- Legacy paycheck notes coexist (backward-compat readers) but are archived + excluded from rollups; `readPaychecksForMonth` de-dupes.

## Related
- [`architecture.md`](architecture.md) — mechanisms vs blueprints, installer, `claude_surface[]`.
- [`schemas.md`](schemas.md) — the schema registry (`platform/schemas-index.json`) + `lint-schemas`.
- [`build-test-verify.md`](build-test-verify.md) — preflight, release, deploy.
- [`vault-paths.md`](vault-paths.md) — workshop + consumer vault paths.
- Cycle docs: `Docs/plans/2026-06-30-finance-month-reality-*`, `2026-07-01-monthly-paycheck-*`, `2026-07-01-finance-tweaks-*`.
