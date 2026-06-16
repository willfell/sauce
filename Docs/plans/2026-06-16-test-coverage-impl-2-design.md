---
arc: test-coverage-arc
phase: phase-3-impl-2
surface: blueprint/finance
axis: installer_migration
archetype: seed-migrate
target_file: platform/test/run-seed-migrations.js
status: ready-for-plan
---

# Impl-2 — finance blueprint installer migration coverage

## Goal

Close the `installer_migration` gap on `blueprint/finance` by covering all 20 finance `apply*` functions in `platform/install.js` via direct-invocation against a synthetic Legacy Finance fixture, following the HC-V01190-PROJ pattern established in impl-1.

## Inventory (20 apply* functions)

Grouped by sub-area:

### Group A — Hub/Defaults scaffolding (3 fns)
- `applyFinanceDefaultsScaffolding` (v0.107.0) — create Budget/Paycheck Defaults notes
- `applyFinanceHubFrontmatterHeal` (v0.115.1) — repair corrupted hub frontmatter
- `applyFinanceHubsRepair` (v0.110.0) — rewrite stale pre-CF-3 hub bodies to canonical shape

### Group B — Debt sub-area (3 fns)
- `applyFinanceDebtScaffolding` (v0.108.0) — create Debts folder + hub + Defaults; auto-scaffold Debt-*.md from defaults entries
- `applyFinancePaycheckDefaultsDebtLinking` (v0.108.0) — link CC payment rows to Debt entities
- `applyFinancePaycheckDefaultsDebtBackfill` (v0.114.0) — two-phase backfill: existing items get debt links; orphans appended

### Group C — Budget sub-area (4 fns)
- `applyFinanceBudgetBodyMigration` (v0.107.0) — inject BudgetSummary block; strip Categories heading
- `applyFinanceBudgetMonthlyBandInjection` (v0.110.3) — inject MonthlyOverview block above BudgetSummary
- `applyFinanceBudgetGroupSeed` (v0.108.0) — seed groups[] from defaults; reassign Unassigned categories
- `applyFinanceCategoriesGroupBackfill` (v0.107.0) — backfill categories[] group assignments to "Unassigned"

### Group D — Paycheck sub-area (2 fns)
- `applyFinancePaycheckBodyMigration` (v0.107.0) — inject PaycheckSummary block; strip Expenses heading
- `applyFinancePaycheckDebtBandInjection` (v0.112.0) — inject PaycheckDebtBand block

### Group E — Months sub-area (1 fn)
- `applyFinanceMonthsScaffolding` (v0.112.0) — create Months folder + hub

### Group F — Navigation/canonical migrations (5 fns)
- `applyFinanceNavRowMigration` (v0.108.0) — rewrite direct-call `customJS.{Budget,Paycheck,Invoice}NavButtons` → `FinanceNavRow`
- `applyFinanceNavRowGuardFormMigration` (v0.110.3) — rewrite guard-form same class names → `FinanceNavRow`
- `applyFinanceUnifiedNavMigration` (v0.111.0) — vault-wide: `FinanceHubActions`/`FinanceNavRow` → unified `FinanceNav`
- `applyFinanceDefaultsNavRowInjection` (v0.110.3) — inject `FinanceNavRow` block after SpaceNavButtons on Defaults notes
- `applyFinanceTopHubNavRowDedup` (v0.110.3) — strip `FinanceHubActions` from `Finance.md`

### Group G — Invoice + orchestration (2 fns)
- `applyFinanceInvoiceWorkspaceNavInjection` (v0.115.2) — inject `InvoiceWorkspaceNav` on Invoice-*.md
- `applyFinanceMigrations` (v0.107.0+, dispatcher) — orchestration entry point that calls 17 of the above in order

**Note**: `applyFinanceMigrations` is verified via invocation of its sub-fns; we won't add a dedicated assert.

**Note**: the audit script's count of 23 includes 3 fns we exclude from this inventory (likely internal `_injectXyz` helpers matched by name-body heuristic). Closing 20/20 substantive migrations lifts the axis to ≥ 0.87.

## Architecture

Same direct-invocation pattern as `runProjectMigrateFamily()` (impl-1):

1. Add a new function `runFinanceMigrateFamily()` in `platform/test/run-seed-migrations.js`
2. Build a tmp vault from a `Legacy Finance/` fixture sub-directory  
3. Invoke each apply* via the install.js exports (need to add 19 new exports — applyFinanceMigrations is the entry point we DON'T need)
4. Sub-asserts grouped A through G match the inventory groups
5. After group-by-group invocation, assert post-state per each migration's contract
6. Run a second invocation for idempotency checks (Group H, separate sub-family)

Use the new shared `makeFsAdapter(root)` helper (extracted at `eda356fe`).

## Seed-vault extensions

New fixture root: `platform/test/seed-vault/spice/finance-legacy/`

**Why a separate sub-dir** (not `spice/finance/Legacy.*` inside the existing finance area): the existing finance hub + defaults are at post-migration shape. Co-locating pre-migration fixtures inside the same tree would (a) confuse `applyFinanceHubsRepair`'s detection logic and (b) corrupt the existing Sample finance for other assertions. A separate sub-tree (which the test harness migrates explicitly) keeps the two clean. The harness will mirror the directory structure: the tmp vault's `spice/finance/` is constructed from the fixture's `spice/finance-legacy/` so all install code sees the canonical path.

Or simpler: the harness creates the tmp vault by copying ONLY the finance-legacy fixture into the tmp at `spice/finance/`, plus minimal scaffold (ranch/, .obsidian/) needed by install.js. This avoids the seed-vault commingling concern.

### Files to author under `platform/test/seed-vault/spice/finance-legacy/`

| Path | Purpose | Triggers |
|---|---|---|
| `Finance.md` | Hub note at pre-migration shape (with FinanceHubActions block + corrupted frontmatter) | #14, #15, #19 |
| `Budget Defaults.md` | Defaults note missing FinanceNavRow block | #18 |
| `Paycheck Defaults.md` | Defaults with CC payment row lacking `debt:` link + missing FinanceNavRow block | #10, #11, #18 |
| `Debt Defaults.md` | Defaults with 2 debt entries (CardA, CardB); Debt-CardA.md exists separately but Debt-CardB.md missing (triggers #2 auto-scaffold) | #2, #18 |
| `budgets/Budget-2026-01.md` | Budget note with: no `groups[]`, no `groups: []` field, no BudgetSummary block, no MonthlyOverview, no FinanceNavRow, "## Categories" heading, one category with `group: "Unassigned"` | #4, #5, #6, #7, #15 |
| `paychecks/Paycheck-2026-01-15.md` | Paycheck with: no PaycheckSummary block, no PaycheckDebtBand, no FinanceNavRow, "## Expenses" heading | #8, #9, #15 |
| `debts/Debt-CardA.md` | Existing debt entity (so backfill #11 can match it as orphan-to-link) | (none directly; reference for #11) |
| `invoices/Invoice-2026-Jan.md` | Invoice with no `InvoiceWorkspaceNav` block + legacy `InvoiceNavButtons` direct call in body | #12, #16 |
| `debts/Debts.md` | Debts hub note (pre-shape, body lacks `FinanceNav` reference) | #15 |
| `budgets/Budgets.md` | Budgets hub note (same pre-shape) | #15 |
| `paychecks/Paychecks.md` | Paychecks hub note (same pre-shape) | #15 |

Also: a Budget-2026-02.md fixture for `applyFinanceNavRowMigration` containing a dataviewjs block with `customJS.BudgetNavButtons.render(dv)` direct call — triggers #12 separately from the guard-form #13.

### Pre-migration content sketches

Bodies authored in the plan; only the load-bearing shape signals captured here:

- **Finance.md**: frontmatter has `tags: [finance, finance]` (duplicate, triggers #14 hub-frontmatter-heal); body contains old `customJS.FinanceHubActions.render(dv, ...)` direct call (triggers #15 hub repair + #19 dedup)
- **Budget-2026-01.md**: frontmatter `groups: []` (empty for #5 seed) + one `categories[]` entry with `group: "Unassigned"` + no `__group_seed_migrated` marker; body has `## Categories` heading (#6 strips); no MonthlyOverview marker (#7)
- **Paycheck-2026-01-15.md**: frontmatter; body has `## Expenses` heading + no PaycheckSummary marker (#8); no PaycheckDebtBand marker (#9)
- **Paycheck Defaults.md**: frontmatter has `expenses[]` with one entry `{item: "Card A payment", amount: 100}` (no `debt:` field — triggers #10 link) and NO entry for Debt-CardA (triggers #11 backfill append-row)
- **Invoice-2026-Jan.md**: body has `customJS.InvoiceNavButtons.render(dv)` (triggers #12) + no InvoiceWorkspaceNav block (triggers #16)

## Asserts added

New sub-family `HC-V01190-FIN-SEED-MIGRATE-*` in run-seed-migrations.js's new `runFinanceMigrateFamily()` function. Counts per sub-family:

| Sub-family | Migration coverage | Asserts |
|---|---|---|
| A — hub/defaults scaffolding | #1 + #14 + #15 | 6 |
| B — debt | #2 + #10 + #11 | 9 |
| C — budget | #6 + #7 + #4 + #5 | 8 |
| D — paycheck | #8 + #9 | 4 |
| E — months | #3 | 2 |
| F — nav | #12 + #13 + #17 + #18 + #19 | 10 |
| G — invoice + orchestration | #16 (with #20 verified via post-state) | 3 |
| H — idempotency | second invocation byte-identity sample | 6 |
| I — history accumulator | audit-trail contract | 2 |

**Target total: 50 sub-asserts** (impl-2 = ~3.3× impl-1 by count; reasonable given 4× the surface area).

Sub-asserts per migration are tight-scoped — one to assert "marker present", one to assert "anti-pattern absent", one to assert any side-effect on a downstream file (e.g. defaults updated).

## install.js export additions

Add 19 new `module.exports.applyFinance*` lines (the 19 finance apply* fns excluding the orchestrator). Pure-additive. Brew-distributed installs unaffected because the exports are no-op outside Node.

## Composite-lift target

Pre-impl-2 finance composite: 0.629 (rebased v0.120.0 matrix; verify with regen).

Math: finance has 5 applicable axes (cust 0.42, mig 0.0, ms 1.0, tpl 1.0, wid 0.38, smk 1.0 — actually 6 axes; let me recount). Per the rebased matrix entry from the audit doc:

- cust 0.42 (19/45)
- mig 0.00 (0/23)
- ms 1.00
- tpl 1.00 (15/15)
- wid 0.38 (10/26)
- smk 1.00

6 applicable axes. Mean = (0.42 + 0.00 + 1.00 + 1.00 + 0.38 + 1.00) / 6 = 3.80 / 6 = **0.633**.

If impl-2 lifts mig from 0 to ~0.87 (20/23 if the audit denominator stays at 23), new mean = (0.42 + 0.87 + 1.00 + 1.00 + 0.38 + 1.00) / 6 = 4.67 / 6 = **0.778**.

**Delta: +0.145.** Within rounding of the +0.15 design target. Achievable.

If the rubric's denominator is actually 20 (matching our inventory count), the lift is to 1.0 on the axis, mean = 4.80 / 6 = **0.800**, delta +0.17 — above target. We'll measure post-impl.

## Risks + mitigations

- **Fixture authoring effort**: 11+ files at precise pre-migration shapes. Large. Mitigation: author them in batches grouped by sub-family (Group A files together, then B, etc.) and run the harness incrementally to detect shape errors before they cascade.
- **Migration interdependencies**: #15 (hubs repair) depends on hub files existing, which are created in part by #1 (defaults scaffolding) — but #1 only creates Defaults notes, not hubs. The hub files (Finance.md, Budgets.md, etc.) must exist in the fixture. Mitigation: confirmed in fixture spec above.
- **#17 (UnifiedNavMigration) vault-wide sweep**: runs `walkDir` over the entire vault. If our tmp vault has stray markdown files outside `spice/finance/`, #17 will scan them. Mitigation: keep the tmp vault minimal — only finance + minimal ranch.
- **install.js exports collision**: 19 exports adjacent to project + recurring exports. Mitigation: trivial — adjacent block, no semantic conflict.
- **applyFinanceUnifiedNavMigration non-standard signature** `(tp, mech, variables, history, git)` — passes `mech` not `manifest`. Our test harness must construct the right call. Mitigation: read the signature and call with the matching argument.

## Out of scope

- Widget render axis on finance (12+ widgets uncovered; defer to v0.120.x)
- New behavioral runner; extending existing harness
- Schema additions
- Consumer deploy / brew tap
- Rubric library changes

## Done criteria

1. `spice/finance-legacy/` fixture committed (11+ files)
2. 19 new `module.exports.applyFinance*` lines in install.js
3. ~50 new `HC-V01190-FIN-SEED-MIGRATE-*` asserts in run-seed-migrations.js, all green
4. `npm run release:preflight` exit 0 (was 126/126; target ~176/176)
5. `node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js` shows finance's installer_migration axis lifted from 0.0 to ≥ 0.87
6. Result doc `Docs/plans/2026-06-16-test-coverage-impl-2-result.md` written
7. Handoff prompt `Docs/prompts/2026-06-16-post-impl-2-handoff.md` written, naming impl-3 (entity-create) as next phase
