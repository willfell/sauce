---
purpose: Comprehensive snapshot of the finance blueprint after the v0.108.0 → v0.111.2 arc, plus the v0.112.0 handoff prompt covering paycheck↔debt visual enrichment + the new monthly sub-area.
kind: state + handoff
date: 2026-06-15
predecessors:
  - Docs/plans/2026-06-15-v0.108.0-finance-debt-and-cohesion-design.md
  - Docs/plans/2026-06-15-v0.108.0-finance-debt-and-cohesion-result.md
target_artifacts:
  - Docs/plans/2026-06-15-v0.112.0-monthly-cohesion-design.md (next session)
  - Docs/plans/2026-06-15-v0.112.0-monthly-cohesion-plan.md (next session)
---

# Finance blueprint — comprehensive state snapshot (v0.111.2)

## What this document is

A consolidated state-of-the-blueprint reference covering everything shipped 2026-06-13 → 2026-06-15 across the v0.108.0 / v0.110.x / v0.111.x cycles, plus the handoff for the next cycle (v0.112.0) which adds paycheck↔debt visual enrichment and the new Months sub-area.

Read this FIRST in the next session. It carries the complete context for the work ahead.

---

## Part 1 — Where the finance blueprint is today (v0.7.1 at workshop v0.111.2)

### 1.1 Versions

| Pin | Version |
|---|---|
| workshop | `0.111.2` |
| finance blueprint | `0.7.1` |
| entity-create mechanism | `0.7.2` |
| cowork blueprint | `0.40.2` |

### 1.2 Sub-areas

`spice/finance/` contains five sub-areas, all using the same flat-entity-or-folder layout:

| Sub-area | Hub | Entity shape | Defaults file |
|---|---|---|---|
| Budgets | `budgets/Budgets.md` | flat per-month `Budget-<YYYY-MM>.md` | `Budget Defaults.md` (groups + categories) |
| Paychecks | `paychecks/Paychecks.md` | per-pay-period folder + `Paycheck-<YYYY-MM-DD>.md` | `Paycheck Defaults.md` (expenses) |
| Invoices | `invoices/Invoices.md` | per-month folder + Invoice + Time-Log + Board sidecars | (none) |
| Debts (v0.108.0) | `debts/Debts.md` | flat per-debt `Debt-<Name>.md` | `Debt Defaults.md` (debts[]) |
| (queued) **Months** | `months/Months.md` | flat per-month `Month-<YYYY-MM>.md` | (none — pure aggregation) |

### 1.3 Widgets (CustomJS classes) — 21 currently shipping

Shared / cross-cutting:
- `FinanceStatus`, `FinanceFrontmatter`, `FinanceHubCards`
- `FinanceHubActions` (legacy, superseded by FinanceNav but kept for backcompat)
- `FinanceNavRow` (legacy, superseded by FinanceNav but kept for backcompat)
- **`FinanceNav` (v0.111.0)** — the canonical context-aware nav primitive

Budgets: `BudgetsCards`, `BudgetDefaultsEditor`, `BudgetCategoriesEditor`, `BudgetSummary`, `MonthlyOverview` (v0.110.3)

Paychecks: `PaychecksCards`, `PaycheckDefaultsEditor`, `PaycheckExpensesEditor`, `PaycheckSummary`

Invoices: `InvoicesCards`, `InvoiceControls`, `InvoiceTimeLogEditor`

Debts (v0.108.0): `DebtsCards`, `DebtDefaultsEditor`, `DebtConfigEditor`, `DebtSummary`, `DebtsHubSummary`

### 1.4 FinanceNav layout (v0.111.0 + v0.111.2)

Notes contain ONE line:

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
```

The class detects mode from `dv.current()` and renders:

- **Finance.md (top hub)** — `---` · centered row [Budgets · Paychecks · Invoices · Debts] each with icons · `---`
- **Sub-hubs (Budgets/Paychecks/Invoices/Debts)** — `---` · centered cross-hub row (hides current) · `---` · centered context row [+ New X | X Defaults] · `---`
- **Entity notes (Budget-*, Paycheck-*, Invoice-*, Debt-*)** — `---` · cross-hub row · `---` · [Sub-area Hub | Prev | Next] · `---`

All buttons carry icons (wallet, calculator, coins, file-text, credit-card, settings, chevron-left/right). All rows are flex with `justify-content: center`.

### 1.5 Entity-create flow

The finance manifest declares 4 `new_entity_buttons[]` entries: budget, paycheck, invoice, debt. The entity-create mechanism (v0.7.2) materializes them into `ranch/entity-create-registry.json`. FinanceNav delegates `+ New X` to `customJS.EntityCreate.render(shim, { instance: "X" })`.

Paycheck's `seed_from_defaults` carries `resolve_wikilinks` (v0.7.1+) — when a Paycheck Defaults expense row has `debt: "[[Debt-X]]"`, the scaffold pulls `planned_monthly_payment` → `amount` and `url` → `url` from the linked debt entity. **Already in place; v0.112.0 will surface this visually.**

### 1.6 Installer migrations

`applyFinanceMigrations` orchestrator (in `platform/install.js`) runs:

1. `applyFinanceDefaultsScaffolding` (v0.5.0)
2. `applyFinanceDebtScaffolding` (v0.6.0; extended in v0.110.0 to auto-scaffold entities from defaults)
3. `applyFinanceCategoriesGroupBackfill` (v0.5.1 / CF-1)
4. `applyFinanceBudgetGroupSeed` (v0.6.0 / CF-3 polish)
5. `applyFinanceBudgetBodyMigration` (v0.5.2 / CF-2)
6. `applyFinancePaycheckBodyMigration` (v0.5.3 / CF-3)
7. `applyFinancePaycheckDefaultsDebtLinking` (v0.6.0)
8. `applyFinanceNavRowMigration` (v0.6.0)
9. `applyFinanceHubsRepair` (v0.6.1; templates updated to FinanceNav in v0.111.1)
10. `applyFinanceBudgetMonthlyBandInjection` (v0.6.3 / MonthlyOverview)

Top-level (not finance-scoped):
- `applyOrphanedHelperCleanup` (v0.110.0)
- `applyEntityCreateGuardMigration` (v0.110.1)
- `applyCustomJsGuardMigration` (v0.110.2)
- **`applyFinanceUnifiedNavMigration` (v0.111.0)** — collapses FinanceHubActions + FinanceNavRow → single-line FinanceNav

All migrations follow established posture: headless-safe (`adapter.read`/`adapter.write`, no `processFrontMatter`), append-only, marker-guarded, `.sauce-backup/<timestamp>/` snapshots, per-file failure-loud, idempotent.

### 1.7 Schemas (post-v0.108.0)

**Paycheck** (`spice/finance/paychecks/<YYYY-MM-DD>/Paycheck-<YYYY-MM-DD>.md`):
```yaml
type: paycheck
pay_period_start: "2026-06-01"
pay_period_end: "2026-06-15"
paycheck_amount: 3200
expenses:
  - { item: "Rent", amount: 1100, category: "Rent", paid: false }
  - { item: "Apple Card payment", amount: 380, category: "Debt", debt: "[[Debt-Apple-Card]]", url: "...", paid: false }
```

**Debt** (`spice/finance/debts/Debt-<Name>.md`):
```yaml
type: debt
kind: "credit-card"
name: "Apple Card"
current_balance: 15292.97
credit_limit: 15500
apr: 22.74
min_payment: 380
planned_monthly_payment: 380
url: "..."
opened_date: 2024-03-15
last_updated: "2026-06-15"
balance_history:
  - { date: "2026-06-15", balance: 15400.00, source: "install-seed" }
```

**Budget** (`spice/finance/budgets/<YYYY-MM>/Budget-<YYYY-MM>.md`):
```yaml
type: budget
month: "2026-07"
groups: ["Essential", "Neutral", "Extra"]
categories:
  - { group: "Essential", name: "Rent", planned: 1100, actual: 0 }
```

### 1.8 Known good state right now

- **Both consumer vaults** (headspace + accuris) on workshop v0.111.2.
- **Headspace** has Debts hub with 6 seeded debt entities (Apple Card, Discover, Cap1 Platinum, Cap1 Quicksilver, SCHEELS Signature, Brex Card) from `Credit Debt Payoff Tracker.md` + Copilot Money MCP.
- **Paycheck-2026-06-01.md** just created on headspace via the new entity-create flow — user reports it works great. This is the proof-point for the paycheck↔debt glue.

---

## Part 2 — The v0.108.0 → v0.111.2 arc, summarized

### v0.108.0 (debt sub-area MINOR)
- NEW `debts/` sub-area + 6 widgets + 4 installer migrations + paycheck↔debt link (`expenses[*].debt` wikilink + `resolve_wikilinks` on seed_from_defaults).
- Out-of-order tag (landed AFTER v0.109.0 chronologically; the brief assumed it'd ship first).

### v0.110.0 (installer healing MINOR)
- `applyFinanceHubsRepair` heals stale pre-CF-3 hub bodies.
- `applyOrphanedHelperCleanup` deletes obsolete NavButton files + `.bak` siblings.
- `applyFinanceDebtScaffolding` extended to auto-iterate Debt Defaults and create-if-absent per-debt entities.
- Project blueprint template sentinels (entity-create:doc-note / section-hub / sub-section-hub).

### v0.110.1 / 0.110.2 / 0.110.3 (cold-load race PATCHes)
- v0.110.1: `applyEntityCreateGuardMigration` rewrites direct `customJS.EntityCreate.render(dv,...)` calls in vault notes to `customjs-guard` form. FinanceHubActions polls window.customJS.EntityCreate. Source content templates updated.
- v0.110.2: generalized to `applyCustomJsGuardMigration` (rewrites ANY direct `customJS.X.render(dv,...)` call).
- v0.110.3: MonthlyOverview widget shipped on `Budget-<YYYY-MM>.md` (income/spending/debt cohesion math).

### v0.110.4 / 0.110.5 (CustomJS parse-error PATCHes)
- v0.110.4: `entity-create.js` module-level helpers moved INSIDE the class; `cowork-lens-shift-cards.js` leading `"use strict"` removed. Caught by NEW `caseV01104CustomJsClassFilesAreClean`.
- v0.110.5: cowork-lens-shift-cards.js trailing `if (typeof module ...)` block removed. CustomJS only accepts ONE top-level construct (class), with NOTHING after the closing brace. Tests now use IIFE-eval to load the class.

### v0.111.0 / 0.111.1 / 0.111.2 (unified nav MINOR + polish PATCHes)
- v0.111.0: **`FinanceNav`** — the one context-aware nav class. `applyFinanceUnifiedNavMigration` collapses every existing `FinanceHubActions` and `FinanceNavRow` invocation to single-line `FinanceNav`. Source templates + manifest inline_body all use the single-line form.
- v0.111.1: `applyFinanceHubsRepair` templates updated to emit FinanceNav (was still using FinanceHubActions). Tag bump for cross-machine reproducibility via brew.
- v0.111.2 (this session): **FinanceNav adds icons + centered layout**. **FinanceHubCards removed from Finance.md** (FinanceNav alone is the top hub experience now). **Bug fix**: debt entry's `name` prompt was `type: "text"` but `_EC_PROMPT_TYPES` only allows `["string", "date", "month", "number", "select"]` → entire entry was silently rejected → `customJS.EntityCreate: no spec for "debt"` error. Changed `"text"` to `"string"`.

---

## Part 3 — v0.112.0 handoff (next-session prompt)

You're picking up the finance blueprint cycle. Workshop is at **v0.111.2** on `main`. Both consumer vaults (headspace + accuris) deployed and verified. The unified FinanceNav layout is shipped and the user is happy with it. Now we add the next two pieces.

## What's being asked for

Two interlocking new capabilities:

### A. Paycheck↔debt visual enrichment

When a user creates a new paycheck (`Paycheck-<YYYY-MM-DD>.md`), the existing `seed_from_defaults.resolve_wikilinks` already pulls `planned_monthly_payment` + `url` from each linked debt entity. **What's missing is the visual surface that explains "what hit the debt books in this paycheck."**

User's words: *"how do I incorporate my debt configuration into it, so that there is another section that covers what was spent on debt wise, with it being automatically configured, with it's own set of statistics within the dashboard"*

Concretely:
- A new band/section ON the Paycheck note showing:
  - Debt rows from `expenses[]` where `debt:` is set (already visible in `PaycheckExpensesEditor` as a chip — needs to be elevated).
  - Stats: total debt-paydown for this paycheck (Σ debt-linked expense amounts where `paid: true`), per-debt breakdown.
  - Snapshot of each linked debt's current balance + planned attack from the debt entity (refreshed at render time).
- Could be a NEW widget `PaycheckDebtBand` rendered between `PaycheckSummary` and `PaycheckExpensesEditor`.

### B. NEW Months sub-area

User's words: *"a new section for Months or something that will track, for a given month: Debt changes, Paychecks (bringing in both for the month), Budget data ... a new section (as in new button), click to get to the monthly hubs, list of cards show up based off of if there is date data for that month ... clicking on it provides the list of cards to see the paychecks for that month, the budget, and adds a dashboard that takes data from all of them"*

Concretely:
- `spice/finance/months/Months.md` — new hub. Lists `Month-<YYYY-MM>.md` cards (one per month that has data).
- `spice/finance/months/Month-<YYYY-MM>.md` — per-month entity. Three sections:
  - **Budget Analysis** — references `Budget-<YYYY-MM>.md`; shows planned/actual deltas, per-group rollup.
  - **Paycheck Totals** — sums `paycheck_amount` and `Σ expenses[*].amount` across all `Paycheck-<YYYY-MM-*>.md` for that month.
  - **Debt changes** — sums debt-linked expense amounts (where `paid: true`) for the month; correlates with each debt entity's `balance_history[]` MoM delta if available.
- FinanceNav extended: new hub mode `hub-months` with `+ New Month` (auto-derived from current date) + Month entity-mode (prev/next sibling).

### What's ALREADY in place to support this

- Paycheck `expenses[*].debt` wikilink: **shipped v0.108.0** ✓
- entity-create `seed_from_defaults.resolve_wikilinks`: **shipped v0.7.1** ✓
- `PaycheckExpensesEditor` debt-link chip + locked amount/url cells: **shipped v0.108.0** ✓
- `balance_history[]` schema with `source: install-seed | manual | skill`: **shipped v0.108.0** ✓
- `MonthlyOverview` band on `Budget-<YYYY-MM>.md` (income vs spending vs debt-paydown): **shipped v0.110.3** — already does most of the math the Month-<YYYY-MM>.md note needs. v0.112.0 may rebuild on this primitive.
- `FinanceNav` context-aware nav: **shipped v0.111.0** — extending it for `hub-months` + `entity-month` is a one-line per case addition.

### Versioning

- Workshop: 0.111.2 → **0.112.0** MINOR (new sub-area, new widgets, new migrations).
- Finance: 0.7.1 → **0.8.0** MINOR.
- entity-create: 0.7.2 unchanged (no schema changes needed; debt entry's `select` prompt for `kind` already works).
- cowork: 0.40.2 unchanged.

### Open design questions (brainstorm BEFORE coding)

1. **Month entity scaffolding** — same `+ New Month` flow as Budget (prompt for month, scaffold create-if-absent)? Or auto-iterate `Budget-*` files in `applyFinanceMonthsScaffolding`?
2. **MonthlyOverview band vs Month entity** — keep MonthlyOverview on Budget-*.md AND also have it on Month-<YYYY-MM>.md? Or move it entirely to Month-<YYYY-MM>.md and have Budget-*.md show only budget-specific summary?
3. **PaycheckDebtBand widget shape** — three-band (totals / per-debt rows / footer) like existing summaries? Or simpler one-row "this paycheck moved $X across N debts" callout?
4. **Click-through from MonthsCards** — cards link to `Month-<YYYY-MM>.md`. What's on the LANDING — is it a static list of paycheck/budget/debt cards, or an aggregated dashboard at the top with cards below?
5. **MoM debt delta source** — pull from `balance_history[]` snapshots (only present when user has been editing) OR computed from "sum of debt-linked paid expenses minus monthly interest"?
6. **Cards on Months hub** — show ALL months with any data, even if only one of paycheck/budget/debt exists? Or only show "complete" months?

### Versioning + rollout pattern

Follow the established stage-flow (used v0.107.0 onward):

```
S0  verify-before-asserts (read MonthlyOverview, PaycheckSummary, FinanceNav, applyFinanceHubsRepair patterns)
S1  entity-create extension (if any — likely none)
S2  installer migrations:
    - applyFinanceMonthsScaffolding (create-if-absent: months/ + Months.md + Month-<YYYY-MM>.md per existing Budget)
    - extend applyFinanceHubsRepair template dict with months/Months.md entry
    - extend applyFinanceUnifiedNavMigration to handle hub-months / entity-month if needed
S3  NEW widgets:
    - MonthsCards (per-month mini-cards on Months hub)
    - MonthDashboard (three-section: Budget Analysis / Paycheck Totals / Debt Changes)
    - PaycheckDebtBand (paycheck-side debt-rollup section)
S4  entity-editor extensions:
    - Paycheck Template body extended with PaycheckDebtBand dataviewjs block
    - FinanceNav extended for hub-months + entity-month modes
S5  manifests + content + VERSION sweep:
    - finance 0.7.1 → 0.8.0
    - workshop 0.111.2 → 0.112.0
    - new_entity_buttons[] += month entry
    - rule_fragments += months + month-defaults (if defaults file ships)
S6  workshop self-install + harness
S7  push + tag + brew bump + dev-sync deploy + cycle-close artifacts
```

### House rules (non-negotiable, carried from prior cycles)

- **No Claude commit trailer** (per `Docs/agent-guides/build-test-verify.md`).
- **No emojis** in code, callouts, commit messages.
- **CustomJS class file invariant**: ONE class declaration per file, NO `"use strict"`, NO module-level functions, NOTHING after the closing brace. Enforced by `caseV01104CustomJsClassFilesAreClean`.
- **Installer migrations use `adapter.read` + regex YAML mutation + `adapter.write`** — never `processFrontMatter` (Obsidian-runtime-only).
- **`.sauce-backup/<timestamp>/` snapshot before any installer write.**
- **Per-file failure-loud + idempotent for every migration.**
- **One-line FinanceNav usage everywhere** — DON'T re-introduce `FinanceHubActions` or `FinanceNavRow` direct invocations on new templates.
- **Tag + brew + dev-sync at end of cycle** — `scripts/dev-sync.sh` is the one-command deploy helper.

### Vault paths (this machine)

| Vault | Path |
|---|---|
| Workshop | `/Users/willfellhoelter/projects/repos/sauce` |
| barebones | `/Users/willfellhoelter/notes/sauce/barebones` |
| headspace | `/Users/willfellhoelter/notes/sauce/headspace-sauce` |
| accuris | `/Users/willfellhoelter/notes/sauce/accuris-sauce` |
| brew tap | `/Users/willfellhoelter/projects/repos/homebrew-sauce` |

Consumers point at the workshop via `workshop_relative_path` (local-clone via symlink). See `Docs/agent-guides/vault-paths.md` § "Consumer workshop resolution".

### Reference docs to read FIRST

1. **This file** — full state snapshot + carry-forwards.
2. `Docs/plans/2026-06-15-v0.108.0-finance-debt-and-cohesion-result.md` — what the debt sub-area cycle actually shipped.
3. `Docs/agent-guides/cycle-status.md` § Current — live version pins + the most recent cycle.
4. `Docs/agent-guides/code-conventions.md` + `Docs/agent-guides/build-test-verify.md` — the non-negotiables.

### Starting move

Invoke `superpowers:brainstorming` and resolve the 6 open design questions above. Recommended scope split:
- **A — Both A + B in v0.112.0 MINOR** (PaycheckDebtBand + full Months sub-area). Big cycle but coherent.
- **B — Just Months sub-area in v0.112.0; PaycheckDebtBand in v0.112.1 PATCH**. Smaller landing, validation first.
- **C — Just PaycheckDebtBand in v0.112.0; Months sub-area in v0.113.0 MINOR**. Quick win first.

Recommended default: **B** — the Months sub-area is the load-bearing new capability the user described in detail; PaycheckDebtBand can ride along as a fast-follow once the data shape is settled.

Confirm scope, brainstorm, design, plan, execute, deploy, close.

---

## Part 4 — Carry-forwards from this arc

- **`sauce update --bump-pins` install-spawn-subprocess race** — new migrations sometimes don't fire via the brew CLI dispatch chain (see v0.110.2 + v0.111.1 sessions). Manual `node` one-liner heals correctly. Worth a v0.112.x or v0.113.x cycle to investigate the require-cache / spawn-subprocess flow.
- **`FinanceHubActions` + `FinanceNavRow` deprecation** — still in `customjs_classes[]` + `files[]` for backcompat. After a soak period, delete in v0.113.0+.
- **`gather-cc-debt-snapshot` cowork skill composability** — `balance_history[].source` enum reserves `"skill"` slot. v0.113.x+: extend skill to append snapshots to debt entities.
- **Brew tap formula maintenance** — establish a pattern. Currently each tag = manual PR + merge + `brew upgrade`. Could be automated via GitHub Action.

---

End of state snapshot + handoff.
