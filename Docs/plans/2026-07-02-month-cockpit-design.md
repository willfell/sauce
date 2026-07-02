# Finance Month Cockpit — design

**Date:** 2026-07-02 · **Blueprint:** finance (0.16.x) · **Sub-project #3 of 4** in the finance "make it make sense" glue refactor.

## Context

Part of the four-part refactor: #1 Stabilize (shipped, v0.170.0), #2 model/naming (data-only, done in headspace), **#3 setup & operating ergonomics** (this doc), #4 actuals loop. #3 makes a month **simple to set up and operate** and guards against silent misconfiguration.

Chosen shape (user-approved): **Option A — Month cockpit** on the Month note, with **Option "one PLACE, three buttons"** for the scaffold (reuse existing seeding; don't re-architect entity-create). The small **dead-nav-injection retirement** (deferred from #1C) rides in this same cycle so the eventual deploy lands clean.

## Problem

- A month takes **three separate "+ New" clicks** (Budget → Paycheck → Month), each from a different hub.
- **Silent misconfiguration**: an untagged paycheck expense quietly defaults to check 1 (the Apple trap); a non-reconciling allocation isn't flagged.
- The **Defaults-vs-month** mental model (edit the template vs edit this month) is nowhere surfaced in the UI.
- No **at-a-glance "is this month set up right?"** view.
- Separately: `applyFinanceDefaultsNavRowInjection` (install.js) ungated-re-injects the **superseded** `FinanceNavRow` into the three Defaults notes on every install (a dead second nav row; `FinanceNav` supersedes it).

## Decisions

- **D1 — the Month note becomes the operational home.** A new `MonthSetupChecklist` widget renders month health + fix-links + the two create-buttons. The Month note keeps its existing `MonthDashboard` (reconciliation) below.
- **D2 — one PLACE, three buttons (not true one-click).** The cockpit surfaces **Create Budget** + **Create Paycheck** actions (current month pre-filled) beside the checklist, reusing the existing `entity-create` seeded scaffolds unchanged. No entity-create mechanism change. ("+ New Month" itself is unchanged; the Month note is created first, then the cockpit drives budget+paycheck creation.)
- **D3 — guardrails are display-only.** All checks route through a new pure `FinanceMath.monthSetupStatus`; **envelope math (`computePlanState`, `categories[].reduce`) is untouched** — the checklist never folds debt/savings/fixed into the discretionary envelope (envelope-isolation invariant preserved).
- **D4 — retire the dead-nav injection.** Remove the `applyFinanceDefaultsNavRowInjection` call + convert it to a **strip** (remove any `FinanceNavRow` block from the three Defaults notes). Ungated, snapshot-first, idempotent. Existing injection tests updated to assert the strip.

## Architecture / components

### Engine — `FinanceMath.monthSetupStatus(dv, monthKey)`
Pure aggregation (no rendering), routes through existing readers. Returns:
```
{
  month,
  budget:   { exists, path },
  paycheck: { exists, path, depositsMaterialized, expenseCount },
  guardrails: {
    untaggedDeposits: { count, items: [item names] },   // expenses missing a valid `deposit`
    reconcile: { income, totalAllocated, ok, deltaOver },// from budgetAllocations; ok = allocated <= income
  },
  bills: { paidCount, total, pct },                       // paycheck expenses paid:true / total
  ready: boolean                                          // all required rows green
}
```
- `untaggedDeposits` reuses the `_depositIndex` coercion logic to detect expenses whose `deposit` is absent/invalid (would silently fall to check 1).
- `reconcile` reuses `budgetAllocations(dv, monthKey).totals` (income vs total allocated) — **read-only**.
- Never mutates; never sums into the envelope.

### Widget — `MonthSetupChecklist` (helpers/month-setup-checklist.js)
On the Month note, above `MonthDashboard`. Renders:
- **Setup rows** with ✓ / ⚠ / ✗: Budget created · Paycheck created · Deposits materialized · Every expense deposit-tagged · Allocations reconcile to income · Bills checked off (progress).
- **Fix-links** per row: open the budget note / open the paycheck (jump to its editor) / etc.
- **Create buttons** when absent: "Create Budget" / "Create Paycheck" (current month pre-filled) — delegate to the existing `entity-create` seeded scaffold for that month (see Risk R1).
- customJS conventions: bare class only (no trailing statements — CJS-LOAD gate), `async render(dv)`, embed-dedup guard, render-safe instance methods, no write-on-render.

### Guardrails surfacing
- Primary: the checklist ⚠ rows (untagged deposits, non-reconcile).
- Secondary (small): `PaycheckExpensesEditor` shows an inline "⚠ N untagged (default to check 1)" note near the deposit header. No behavior change — informational.

### Defaults-vs-month — `FinanceEditScopeBanner` (helpers/finance-edit-scope-banner.js)
Tiny widget detecting the current note by `type` frontmatter:
- month snapshot (`budget` / `paycheck` with a `month`): *"Editing {month} only — edit Defaults to change every month."*
- defaults (`*-defaults`): *"Template for every new month — changes here seed future months, not existing ones."*
Rendered at the top of Budget/Paycheck editors + the Defaults notes (via inline_body + heal).

### Install heals (ungated, snapshot-first, marker-guarded, per-file failure-loud)
- `applyFinanceMonthChecklistInjection` — inject the `MonthSetupChecklist` dataviewjs block into existing Month notes, above `MonthDashboard` (anchor: MonthDashboard block → FinanceNav block → frontmatter close). Mirrors `applyFinanceBudgetMonthlyBandInjection`.
- `applyFinanceEditScopeBannerInjection` — inject the banner block into existing Budget/Paycheck/Defaults notes.
- `applyFinanceDefaultsNavRowRetirement` (replaces the injection) — strip any `FinanceNavRow` dataviewjs block from the three Defaults notes; remove the `applyFinanceDefaultsNavRowInjection` call from `applyFinanceMigrations`.
- New-entity templates (`inline_body`) for month/budget/paycheck gain the new blocks so fresh notes are born with them.

## Data flow
```
Defaults (budget/paycheck) ──seed──► Budget-YYYY-MM / Paycheck-YYYY-MM
        │                                     │
        │                                     ▼
        │                     FinanceMath.monthSetupStatus(dv, month)  ◄── budgetAllocations, depositTotals (read-only)
        │                                     │
        ▼                                     ▼
Month-YYYY-MM ──► MonthSetupChecklist (health + fix-links + Create Budget/Paycheck) ──► entity-create scaffolds
                                              │
                                              ▼
                                        MonthDashboard (reconciliation, unchanged)
```

## Testing (TDD)
- **Engine:** `monthSetupStatus` unit cases (new `run-finance-*` harness or extend `run-finance-plan-state.js`): missing budget/paycheck; untagged-expense count; reconcile ok vs over; bills progress; **envelope-unaffected assertion**.
- **Widgets:** render-safe + embed-dedup + no-write-on-render (extend `run-renderer.js` / `run-render-safe.js`); CJS-LOAD gate (`run-customjs-loadable.js`) picks up the new classes automatically.
- **Heals:** behavioral cases (like HC-FIN-BGR-*) — checklist/banner injection idempotent + anchored; nav-retirement strips FinanceNavRow + is idempotent + updates the old injection tests.
- **Seed-vault:** add/adjust a Month fixture asserting checklist injection; assert the nav-retirement strips a planted FinanceNavRow from a Defaults fixture.
- **Gates:** full `release:preflight` green; `lint-schemas`, `lint-cold-load`, `lint-note-chrome` green; self-install; `preflight-bumped`.

## Migrations
Three ungated, snapshot-first, marker-guarded heals (checklist inject, banner inject, nav retirement) — all **repairs/injections, not legacy reshapers → ungated** (gate landmine). Headspace: nav strip already applied by hand → the retirement heal is a no-op there; the checklist/banner injections add the new blocks.

## Non-goals / YAGNI
- No true one-click all-three scaffold (D2) — no entity-create change.
- No envelope/PlanBand/over-flag change; no schema change to budget/paycheck/month frontmatter.
- No change to `MonthDashboard` reconciliation logic.
- Not building #4 (actuals) — the checklist shows "bills checked off," not Copilot actuals.

## Risks
- **R1 — cockpit "Create Budget/Paycheck" invocation.** The cockpit must trigger the `entity-create` seeded scaffold for a *known* month (no prompt). If entity-create can't be invoked programmatically with a pre-filled month, fallback: the button deep-links to the hub's "+ New X" (still one place to start). Resolve in planning by reading the `entity-create` mechanism; do NOT re-implement seeding in the widget.
- **R2 — note-chrome compliance.** New blocks must obey the note-chrome standard (no stray `## H2`, correct nav grammar). Run `lint-note-chrome`.
- **R3 — injection anchor drift** across vaults with varied Month-note bodies — mirror the proven anchor-priority pattern from `applyFinanceBudgetMonthlyBandInjection`; per-file failure-loud.
- **R4 — retiring `applyFinanceDefaultsNavRowInjection` has existing test coverage** — those source-inspection tests must be flipped to assert the strip, in the same commit, or preflight breaks.
