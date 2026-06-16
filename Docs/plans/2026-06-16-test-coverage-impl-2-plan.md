# Impl-2 — finance installer migration coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is structured by sub-family (A-I) following the design's grouping. Each sub-family is one task.

**Goal:** Close `installer_migration` on `blueprint/finance` (0.0 → ≥ 0.87) by covering 20 finance apply* fns via direct-invocation against a Legacy Finance fixture under `spice/finance-legacy/`, mirroring the HC-V01190-PROJ-SEED-MIGRATE-* pattern from impl-1.

**Architecture:** New `runFinanceMigrateFamily()` in `platform/test/run-seed-migrations.js`. Uses the shared `makeFsAdapter(root)` extracted at commit `eda356fe`. Adds 19 `module.exports.applyFinance*` lines in `platform/install.js` (pure additive).

**Tech Stack:** Node.js zero-dep. Same toolchain as impl-1.

**Design doc:** `Docs/plans/2026-06-16-test-coverage-impl-2-design.md` — read it first. Inventory table + sub-family groupings live there.

**Reference template:** `runProjectMigrateFamily()` in `platform/test/run-seed-migrations.js` (committed at `8a2f3b74` + polished at `ea31dae8` + refactored at `eda356fe`).

**Worktree:** `/Users/willfellhoelter/projects/repos/sauce-test-coverage` on `feature/test-coverage-arc`.

---

## Hard rules

1. Stay in the worktree.
2. Use `git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage` for git.
3. No emojis in committed files.
4. No Co-Authored-By Claude trailer.
5. `npm run release:preflight` must stay green throughout (currently 126/126).
6. Use the shared `makeFsAdapter(root)` helper — do NOT duplicate the adapter.

---

## File Structure

### Created
- `platform/test/seed-vault/spice/finance-legacy/` — fixture tree (~11 files)
  - `Finance.md`, `Budget Defaults.md`, `Paycheck Defaults.md`, `Debt Defaults.md`
  - `budgets/Budgets.md`, `budgets/Budget-2026-01.md`, `budgets/Budget-2026-02.md`
  - `paychecks/Paychecks.md`, `paychecks/Paycheck-2026-01-15.md`
  - `debts/Debts.md`, `debts/Debt-CardA.md`
  - `invoices/Invoice-2026-Jan.md`

### Modified
- `platform/install.js` — add 19 `module.exports.applyFinance*` lines next to the existing exports (pure additive)
- `platform/test/run-seed-migrations.js` — append `runFinanceMigrateFamily()` function + 50 sub-asserts; chain after `runProjectMigrateFamily()`

---

## Phase 0 — Setup

### Task 0.1: Verify state + add install.js exports

**Files:**
- Modify: `platform/install.js` (add 19 lines)

- [ ] **Step 1: Confirm baseline**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage status
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage log --oneline -3
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -2
```

Expected: clean, top commit is impl-2 design, preflight 126/126.

- [ ] **Step 2: Add 19 finance exports to install.js**

Find the existing `module.exports.applyFinance*` block near line 12790. The pattern is:

```javascript
module.exports.applyFinanceMonthsScaffolding = applyFinanceMonthsScaffolding;
module.exports.applyFinancePaycheckDebtBandInjection = applyFinancePaycheckDebtBandInjection;
module.exports._injectPaycheckDebtBand = _injectPaycheckDebtBand;
```

Three exports already exist for finance. Add the remaining 16 (some may already be there — check before adding; pattern is alphabetical inside the finance block):

```javascript
// v0.119.0 impl-2 — finance blueprint installer migrations (for run-seed-migrations.js
// HC-V01190-FIN-SEED-MIGRATE-* direct-invocation family). Pure additive.
module.exports.applyFinanceBudgetBodyMigration = applyFinanceBudgetBodyMigration;
module.exports.applyFinanceBudgetGroupSeed = applyFinanceBudgetGroupSeed;
module.exports.applyFinanceBudgetMonthlyBandInjection = applyFinanceBudgetMonthlyBandInjection;
module.exports.applyFinanceCategoriesGroupBackfill = applyFinanceCategoriesGroupBackfill;
module.exports.applyFinanceDebtScaffolding = applyFinanceDebtScaffolding;
module.exports.applyFinanceDefaultsNavRowInjection = applyFinanceDefaultsNavRowInjection;
module.exports.applyFinanceDefaultsScaffolding = applyFinanceDefaultsScaffolding;
module.exports.applyFinanceHubFrontmatterHeal = applyFinanceHubFrontmatterHeal;
module.exports.applyFinanceHubsRepair = applyFinanceHubsRepair;
module.exports.applyFinanceInvoiceWorkspaceNavInjection = applyFinanceInvoiceWorkspaceNavInjection;
module.exports.applyFinanceNavRowGuardFormMigration = applyFinanceNavRowGuardFormMigration;
module.exports.applyFinanceNavRowMigration = applyFinanceNavRowMigration;
module.exports.applyFinancePaycheckBodyMigration = applyFinancePaycheckBodyMigration;
module.exports.applyFinancePaycheckDefaultsDebtBackfill = applyFinancePaycheckDefaultsDebtBackfill;
module.exports.applyFinancePaycheckDefaultsDebtLinking = applyFinancePaycheckDefaultsDebtLinking;
module.exports.applyFinanceTopHubNavRowDedup = applyFinanceTopHubNavRowDedup;
module.exports.applyFinanceUnifiedNavMigration = applyFinanceUnifiedNavMigration;
```

(That's 17 new exports — applyFinanceMonthsScaffolding and applyFinancePaycheckDebtBandInjection are already exported per the existing block.)

If any of these function names don't exist in install.js (verify with grep), remove from the export list — the inventory was sourced from the design doc and may have drift.

- [ ] **Step 3: Verify install.js still parses + preflight still green**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/install.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -2
```

Expected: parse OK; 126/126 still.

- [ ] **Step 4: Commit**

```
chore(impl-2): export 17 finance apply* fns for direct-invocation harness
```

Pure additive. Behavior unchanged.

---

## Phase 1 — Fixture authoring

Build the Legacy Finance fixture under `platform/test/seed-vault/spice/finance-legacy/`. Each task creates one logical group of files.

### Task 1.1: Hub + Defaults fixtures

**Files:**
- Create: `platform/test/seed-vault/spice/finance-legacy/Finance.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/Budget Defaults.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/Paycheck Defaults.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/Debt Defaults.md`

- [ ] **Step 1: Write Finance.md (pre-shape for #14 + #15 + #19)**

```markdown
---
title: Finance
type: finance-hub
tags: [finance, finance]
created_at: 2026-01-01T00:00:00.000Z
---

# Finance

```dataviewjs
customJS.FinanceHubActions.render(dv, {here: "finance"});
```

```dataviewjs
customJS.FinanceHubSummary.render(dv);
```
```

Note: `tags: [finance, finance]` has the duplicate that triggers #14 (frontmatter heal). The `FinanceHubActions(here:"finance")` block triggers #19 (top-hub dedup). The body lacks the canonical `class: "FinanceNav"` reference triggering #15 (hubs repair).

- [ ] **Step 2: Write Budget Defaults.md (pre-shape for #18)**

```markdown
---
title: Budget Defaults
type: budget-defaults
created_at: 2026-01-01T00:00:00.000Z
groups: []
categories: []
---

# Budget Defaults

```dataviewjs
customJS.SpaceNavButtons.render(dv);
```
```

Note: no `FinanceNavRow` block after SpaceNavButtons — triggers #18.

- [ ] **Step 3: Write Paycheck Defaults.md (pre-shape for #10 + #11 + #18)**

```markdown
---
title: Paycheck Defaults
type: paycheck-defaults
created_at: 2026-01-01T00:00:00.000Z
expenses:
  - item: "Card A payment"
    amount: 100
    url: "https://example.com/cardA"
---

# Paycheck Defaults

```dataviewjs
customJS.SpaceNavButtons.render(dv);
```
```

Notes:
- expense item "Card A payment" matches the CC_NAME_RE pattern (likely matches "card" or "credit") + has no `debt:` — triggers #10 (link to Debt-CardA)
- Has `url:` field — triggers #10 (strip url)
- Debt-CardA.md will exist in the fixture but NOT referenced by name in any other expense row — triggers #11 (orphan backfill should not duplicate)
- No FinanceNavRow block — triggers #18

- [ ] **Step 4: Write Debt Defaults.md (pre-shape for #2 + #18)**

```markdown
---
title: Debt Defaults
type: debt-defaults
created_at: 2026-01-01T00:00:00.000Z
debts:
  - name: CardA
    kind: credit-card
    balance: 1000
    apr: 0.18
    min: 25
    planned_monthly_payment: 100
  - name: CardB
    kind: credit-card
    balance: 2000
    apr: 0.20
    min: 50
    planned_monthly_payment: 150
---

# Debt Defaults

```dataviewjs
customJS.SpaceNavButtons.render(dv);
```
```

Note: Debt-CardA.md exists (will be authored in Task 1.4); Debt-CardB.md does NOT — triggers #2 to auto-scaffold from this defaults list. No FinanceNavRow — triggers #18.

- [ ] **Step 5: Commit**

```
test(impl-2): finance-legacy hub + defaults fixtures (#14, #15, #18, #19, #2, #10, #11)
```

### Task 1.2: Sub-area hub fixtures

**Files:**
- Create: `platform/test/seed-vault/spice/finance-legacy/budgets/Budgets.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/paychecks/Paychecks.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/debts/Debts.md`

These three are sub-area hubs at pre-#15 shape (no FinanceNav reference). All have the same shape:

- [ ] **Step 1: Write Budgets.md**

```markdown
---
title: Budgets
type: budgets-hub
created_at: 2026-01-01T00:00:00.000Z
---

# Budgets

(Pre-#15 fixture — hub body lacks FinanceNav reference.)
```

- [ ] **Step 2: Write Paychecks.md and Debts.md** — same shape, swap type to `paychecks-hub` / `debts-hub`.

- [ ] **Step 3: Commit**

```
test(impl-2): finance-legacy sub-area hubs (Budgets, Paychecks, Debts) pre-#15 shape
```

### Task 1.3: Budget + Paycheck entity fixtures

**Files:**
- Create: `platform/test/seed-vault/spice/finance-legacy/budgets/Budget-2026-01.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/budgets/Budget-2026-02.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/paychecks/Paycheck-2026-01-15.md`

- [ ] **Step 1: Write Budget-2026-01.md (pre-shape for #4, #5, #6, #7)**

```markdown
---
title: Budget 2026-01
type: budget
month: "2026-01"
created_at: 2026-01-01T00:00:00.000Z
groups: []
categories:
  - name: Groceries
    group: "Unassigned"
    planned: 500
    actual: 0
---

# Budget 2026-01

## Categories

```dataviewjs
customJS.SpaceNavButtons.render(dv);
```
```

Notes: 
- empty `groups: []` → #5 seeds from defaults
- "Unassigned" category → #5 reassigns to matched group
- "## Categories" heading → #6 strips
- no `<!-- budget-summary-... -->` marker → #6 inserts BudgetSummary block
- no `<!-- monthly-overview-... -->` marker → #7 inserts MonthlyOverview band

- [ ] **Step 2: Write Budget-2026-02.md (pre-shape for #12 direct-call NavButtons)**

```markdown
---
title: Budget 2026-02
type: budget
month: "2026-02"
created_at: 2026-02-01T00:00:00.000Z
groups: []
categories: []
---

# Budget 2026-02

```dataviewjs
customJS.BudgetNavButtons.render(dv);
```
```

Note: legacy `BudgetNavButtons` direct-call → triggers #12 (rewrite to FinanceNavRow).

- [ ] **Step 3: Write Paycheck-2026-01-15.md (pre-shape for #8 + #9)**

```markdown
---
title: Paycheck 2026-01-15
type: paycheck
date: "2026-01-15"
created_at: 2026-01-15T00:00:00.000Z
expenses: []
---

# Paycheck 2026-01-15

## Expenses

```dataviewjs
customJS.SpaceNavButtons.render(dv);
```
```

Notes:
- "## Expenses" heading → #8 strips
- no PaycheckSummary marker → #8 inserts
- no PaycheckDebtBand marker → #9 inserts

- [ ] **Step 4: Commit**

```
test(impl-2): finance-legacy budget + paycheck entity fixtures (#4-9, #12)
```

### Task 1.4: Debt + Invoice entity fixtures

**Files:**
- Create: `platform/test/seed-vault/spice/finance-legacy/debts/Debt-CardA.md`
- Create: `platform/test/seed-vault/spice/finance-legacy/invoices/Invoice-2026-Jan.md`

- [ ] **Step 1: Write Debt-CardA.md (reference for #11)**

```markdown
---
title: Debt CardA
type: debt
name: CardA
kind: credit-card
balance: 1000
credit_limit: 3000
apr: 0.18
min: 25
planned_monthly_payment: 100
url: "https://example.com/cardA"
opened: "2025-01-01"
balance_history: []
created_at: 2026-01-01T00:00:00.000Z
---

# Debt CardA
```

Note: this exists so that #11 (debt backfill phase 1) can word-overlap-match it to "Card A payment" in Paycheck Defaults. Phase 2 of #11 (orphan append) would append a row for any Debt-*.md NOT referenced — Debt-CardB will be auto-scaffolded by #2 then must be matched/referenced separately. Watch test outcomes carefully.

- [ ] **Step 2: Write Invoice-2026-Jan.md (pre-shape for #12 + #16)**

```markdown
---
title: Invoice 2026 Jan
type: invoice
month: "2026-01"
created_at: 2026-01-01T00:00:00.000Z
---

# Invoice 2026-Jan

```dataviewjs
customJS.InvoiceNavButtons.render(dv);
```
```

Notes:
- legacy `InvoiceNavButtons` direct call → #12 rewrite
- no InvoiceWorkspaceNav block → #16 inject

- [ ] **Step 3: Commit**

```
test(impl-2): finance-legacy debt + invoice entity fixtures (#11, #12, #16)
```

---

## Phase 2 — Harness extension

### Task 2.1: Add `runFinanceMigrateFamily()` skeleton

**Files:**
- Modify: `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Locate insertion point**

The existing `runProjectMigrateFamily()` ends around line 850 (per the polish commit). Find where its `.then` chain returns or where the harness's final summary lives. The new function chains after.

- [ ] **Step 2: Write the skeleton**

Append (the actual asserts are appended one sub-family at a time in subsequent tasks):

```javascript

// ===== HC-V01190-FIN-SEED-MIGRATE-* — finance blueprint installer migrations =====
//
// Direct-invocation pattern (mirrors HC-V01190-PROJ family). See impl-2 design doc.
// 20 finance apply* fns covered via the Legacy Finance fixture at
// platform/test/seed-vault/spice/finance-legacy/.
//
// Production install order (install.js applyFinanceMigrations): debt-scaffolding ->
// defaults-scaffolding -> hub-frontmatter-heal -> hubs-repair -> ... -> nav migrations
// -> orchestrator (applyFinanceMigrations). The test invokes the sub-fns directly
// in the same order to validate each contract in isolation. Idempotency tested by
// invoking twice.

const LEGACY_FIN_DIR = "spice/finance-legacy";

async function runFinanceMigrateFamily() {
    const install = require("../install.js");
    const finRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-fin-migrate-"));
    const finVault = path.join(finRoot, "vault");
    fs.mkdirSync(finVault, { recursive: true });
    // Copy the finance-legacy fixture into the tmp vault at spice/finance/ (canonical path)
    const fixtureRoot = path.join(REPO_ROOT, "platform/test/seed-vault/spice/finance-legacy");
    fs.cpSync(fixtureRoot, path.join(finVault, "spice", "finance"), { recursive: true });
    
    const adapter = makeFsAdapter(finVault);
    const tp = {
        app: {
            vault: { adapter, getMarkdownFiles: () => [] },
            metadataCache: { getFileCache: () => null }
        }
    };
    const manifest = { name: "finance", version: "0.9.2" };
    const variables = {};
    const history = [];
    const git = { branch: "feature/test-coverage-arc", commit: "test", dirty: false, tag: null };
    
    // Pass 1: invoke each migration in production order
    await install.applyFinanceHubFrontmatterHeal(tp, manifest, variables, history, git);
    await install.applyFinanceDefaultsScaffolding(tp, manifest, variables, history, git);
    await install.applyFinanceMonthsScaffolding(tp, manifest, variables, history, git);
    await install.applyFinanceDebtScaffolding(tp, manifest, variables, history, git);
    await install.applyFinancePaycheckDefaultsDebtLinking(tp, manifest, variables, history, git);
    await install.applyFinancePaycheckDefaultsDebtBackfill(tp, manifest, variables, history, git);
    await install.applyFinanceCategoriesGroupBackfill(tp, manifest, variables, history, git);
    await install.applyFinanceBudgetGroupSeed(tp, manifest, variables, history, git);
    await install.applyFinanceBudgetBodyMigration(tp, manifest, variables, history, git);
    await install.applyFinanceBudgetMonthlyBandInjection(tp, manifest, variables, history, git);
    await install.applyFinancePaycheckBodyMigration(tp, manifest, variables, history, git);
    await install.applyFinancePaycheckDebtBandInjection(tp, manifest, variables, history, git);
    await install.applyFinanceHubsRepair(tp, manifest, variables, history, git);
    await install.applyFinanceNavRowMigration(tp, manifest, variables, history, git);
    await install.applyFinanceNavRowGuardFormMigration(tp, manifest, variables, history, git);
    await install.applyFinanceDefaultsNavRowInjection(tp, manifest, variables, history, git);
    await install.applyFinanceTopHubNavRowDedup(tp, manifest, variables, history, git);
    await install.applyFinanceInvoiceWorkspaceNavInjection(tp, manifest, variables, history, git);
    await install.applyFinanceUnifiedNavMigration(tp, manifest, variables, history, git);
    
    // Helpers reused across sub-families
    const readFin = (rel) => fs.readFileSync(path.join(finVault, LEGACY_FIN_DIR, rel), "utf8");
    const existsFin = (rel) => fs.existsSync(path.join(finVault, LEGACY_FIN_DIR, rel));
    
    // ===== A1..A6 (hub/defaults) inserted in Task 2.2 =====
    // ===== B1..B9 (debt) inserted in Task 2.3 =====
    // ===== C1..C8 (budget) inserted in Task 2.4 =====
    // ===== D1..D4 (paycheck) inserted in Task 2.5 =====
    // ===== E1..E2 (months) inserted in Task 2.6 =====
    // ===== F1..F10 (nav) inserted in Task 2.7 =====
    // ===== G1..G3 (invoice + orchestrator) inserted in Task 2.8 =====
    // ===== H1..H6 (idempotency) inserted in Task 2.9 =====
    // ===== I1..I2 (history) inserted in Task 2.10 =====
    
    // Cleanup
    if (process.env.KEEP_SEED_VAULT === "1") {
        console.log(`KEEP_SEED_VAULT=1 (HC-V01190-FIN): ${finRoot}`);
    } else {
        fs.rmSync(finRoot, { recursive: true, force: true });
    }
}
```

Path mapping: the harness expects fixtures at `spice/finance-legacy/` but copies them to `spice/finance/` in the tmp vault so install code sees canonical paths. Adjust `LEGACY_FIN_DIR` if the install code requires `spice/finance` (the canonical path inside the tmp vault).

Actually re-read: in install.js, the migration code probably reads from `spice/finance/`. So `LEGACY_FIN_DIR` in the harness for the read-back asserts should be `spice/finance` (where files end up post-copy), NOT `spice/finance-legacy`. Fix the constant:

```javascript
const LEGACY_FIN_DIR = "spice/finance";  // canonical path in the TMP vault (sourced from spice/finance-legacy/ in seed)
```

- [ ] **Step 3: Chain the new family**

Wherever `runProjectMigrateFamily()` is invoked (likely chained in a `.then`), add `.then(() => runFinanceMigrateFamily())`. Confirm by grep + read.

- [ ] **Step 4: Parse + run (no asserts yet, just exercise the invocation chain)**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -3
```

Expected: parse OK; all existing 126 asserts still pass (we haven't added any asserts yet, just invocation). If install throws on any of the 17 invocations, the fixture pre-shape is wrong OR the call signature is wrong (especially #17 unified-nav which uses `mech` not `manifest`).

- [ ] **Step 5: Commit skeleton**

```
test(impl-2): runFinanceMigrateFamily skeleton — invokes 17 finance apply* fns
```

### Tasks 2.2 - 2.10: Sub-family assert blocks

Append one sub-family at a time. After each, re-run the harness and confirm asserts pass before moving on.

**Sub-family A (hub/defaults), 6 asserts:**

- [ ] **A1**: `Finance.md` no longer has `tags: [finance, finance]` (heal)
- [ ] **A2**: `Finance.md` body no longer has `FinanceHubActions(here:"finance")` (top-hub dedup)
- [ ] **A3**: `Finance.md` body has `FinanceNav` reference (hubs repair)
- [ ] **A4**: `Budgets.md` body has `FinanceNav` reference (hubs repair)
- [ ] **A5**: `Debts.md` body has `FinanceNav` reference (hubs repair)
- [ ] **A6**: `Paychecks.md` body has `FinanceNav` reference (hubs repair)

**Sub-family B (debt), 9 asserts:**

- [ ] **B1**: `debts/Debt-CardB.md` exists post-#2 (auto-scaffolded)
- [ ] **B2**: `debts/Debt-CardA.md` still exists (not overwritten by #2)
- [ ] **B3**: `Paycheck Defaults.md` `expenses[0]` has `debt:` field referencing "Debt-CardA" (post #10)
- [ ] **B4**: `Paycheck Defaults.md` `expenses[0]` no longer has `url:` (stripped by #10)
- [ ] **B5**: `Paycheck Defaults.md` frontmatter has `__debt_links_migrated: v0.108.0` marker
- [ ] **B6**: `Paycheck Defaults.md` `expenses[]` includes an entry for Debt-CardB (post #11 phase 2: orphan append)
- [ ] **B7**: `Debt Defaults.md` `debts[]` is unchanged in length post #2 (no duplicates added)
- [ ] **B8**: `Debt-CardB.md` frontmatter has `kind: credit-card` matching Debt Defaults entry
- [ ] **B9**: `Debt-CardB.md` frontmatter has `planned_monthly_payment: 150`

**Sub-family C (budget), 8 asserts:**

- [ ] **C1**: `Budget-2026-01.md` frontmatter has `groups[]` populated (post #5)
- [ ] **C2**: `Budget-2026-01.md` frontmatter has `__group_seed_migrated: v0.108.0` marker
- [ ] **C3**: `Budget-2026-01.md` body has `<!-- budget-summary-` marker (post #6)
- [ ] **C4**: `Budget-2026-01.md` body has `<!-- monthly-overview-` marker (post #7)
- [ ] **C5**: `Budget-2026-01.md` body no longer has `## Categories` heading (stripped by #6)
- [ ] **C6**: `Budget-2026-01.md` frontmatter `categories[0].group` no longer "Unassigned" (reassigned by #5; will be "Unassigned" or matched name — accept presence of any non-Unassigned group as success, but verify post-fixture authoring)
- [ ] **C7**: `Budget-2026-02.md` body no longer has `customJS.BudgetNavButtons` (post #12 rewrite)
- [ ] **C8**: `Budget-2026-02.md` body has `customJS.FinanceNavRow` OR `customJS.FinanceNav` (#12 rewrite + #17 unification — whichever ends up canonical)

**Sub-family D (paycheck), 4 asserts:**

- [ ] **D1**: `Paycheck-2026-01-15.md` body has `<!-- paycheck-summary-` marker (post #8)
- [ ] **D2**: `Paycheck-2026-01-15.md` body has `<!-- paycheck-debt-band-` marker (post #9)
- [ ] **D3**: `Paycheck-2026-01-15.md` body no longer has `## Expenses` heading (stripped by #8)
- [ ] **D4**: `Paycheck-2026-01-15.md` body still contains its title line `# Paycheck 2026-01-15` (no over-stripping)

**Sub-family E (months), 2 asserts:**

- [ ] **E1**: `months/` directory exists (post #3)
- [ ] **E2**: `months/Months.md` exists (post #3 hub scaffold)

**Sub-family F (nav), 10 asserts:**

- [ ] **F1**: `Budget-2026-02.md` no longer has `BudgetNavButtons` direct call (#12)
- [ ] **F2**: `Invoice-2026-Jan.md` no longer has `InvoiceNavButtons` direct call (#12)
- [ ] **F3**: Any file containing legacy `FinanceHubActions` is gone (#17 unified-nav vault-wide; verify by recursive scan)
- [ ] **F4**: Any file containing legacy `FinanceNavRow` class — there should still be SOME if #17 collapses both to FinanceNav... actually verify against #17 actual behavior. If #17 unifies to FinanceNav, then FinanceNavRow class references should be gone too. Adjust assert based on observed post-state.
- [ ] **F5**: `Budget Defaults.md` body has `FinanceNavRow` block injected after SpaceNavButtons (post #18)... wait, #17 may then unify it to FinanceNav. Asserts must respect the chain. Final state on Budget Defaults: contains `FinanceNav` reference somewhere (either FinanceNavRow injected then unified to FinanceNav).
- [ ] **F6**: `Paycheck Defaults.md` body same as F5 (contains `FinanceNav` somewhere)
- [ ] **F7**: `Debt Defaults.md` body same (contains `FinanceNav`)
- [ ] **F8**: `Finance.md` body does NOT contain `FinanceHubActions` (post #19 dedup + #17)
- [ ] **F9**: `Finance.md` body contains `FinanceNav` (post hubs-repair)
- [ ] **F10**: Any vault file containing `BudgetNavButtons`, `PaycheckNavButtons`, or `InvoiceNavButtons` class names (in `class:` guard form OR direct-call) is gone

**Sub-family G (invoice + orchestrator), 3 asserts:**

- [ ] **G1**: `Invoice-2026-Jan.md` body has `<!-- invoice-workspace-nav-` marker (post #16)
- [ ] **G2**: `Invoice-2026-Jan.md` body has `InvoiceWorkspaceNav` reference (canonical)
- [ ] **G3**: `history.length >= 17` (all 17 sub-fns logged an event)

**Sub-family H (idempotency), 6 asserts:**

After Pass 1, snapshot the state, then run Pass 2 (invoke all 17 again), then assert:

- [ ] **H1**: `Budget-2026-01.md` byte-identical pass 1 vs pass 2
- [ ] **H2**: `Paycheck-2026-01-15.md` byte-identical
- [ ] **H3**: `Finance.md` byte-identical
- [ ] **H4**: `Paycheck Defaults.md` byte-identical
- [ ] **H5**: `Debt Defaults.md` byte-identical (debts[] not duplicated)
- [ ] **H6**: `Debt-CardA.md` byte-identical (#2 not re-scaffolded)

**Sub-family I (history audit-trail), 2 asserts:**

- [ ] **I1**: All history events have `errors: []` (or no errors field)
- [ ] **I2**: At least 17 distinct `step` values present in history

For each sub-family task (2.2 through 2.10):
- Use the EXACT design grouping above
- Variable prefixing: `a1FinBody`, `b1Debt`, `c1BudgetFm`, etc.
- After appending, run `node platform/test/run-seed-migrations.js` and confirm passing
- Commit per sub-family with message: `test(impl-2): HC-V01190-FIN-SEED-MIGRATE-X family — N asserts` (X = letter, N = count)

If any assert fails: debug the fixture pre-shape OR the migration's expected post-shape. The implementer may need to read the relevant `applyFinance*` source body in install.js. Adjust the assert (e.g., F5 may need adjustment based on whether #17 unifies FinanceNavRow → FinanceNav universally) OR adjust the fixture (e.g., add a missing field that the migration expects).

### Task 2.11: Final harness commit (consolidation if needed)

After all sub-families pass:
- [ ] Verify `node platform/test/run-seed-migrations.js 2>&1 | tail -3` shows ~50 new asserts (count varies based on adjustments made during execution).
- [ ] Verify `npm run release:preflight 2>&1 | tail -3` exits 0.

If consolidation needed, commit any final polish:
```
test(impl-2): HC-V01190-FIN-SEED-MIGRATE-* family complete — ~50 sub-asserts green
```

---

## Phase 3 — Audit refresh

### Task 3.1: Regen matrix + render audit

```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js
```

Verify finance lift:
```bash
node -e 'const m = require("/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json"); const e = m.entries.find(x => x.name === "finance"); console.log("finance mig:", e.axes.installer_migration.score, "(" + e.axes.installer_migration.covered + "/" + e.axes.installer_migration.total + ")"); console.log("composite:", e.composite_score?.toFixed(3));'
```

Expected: mig score ≥ 0.87; composite around 0.78.

### Task 3.2: Re-apply override picks section

Same procedure as impl-1 Phase 3 Task 3.2 Step 3 — the renderer always writes the default picks stub, manually re-apply the override block (updated to reflect impl-2 closure).

### Task 3.3: Commit refresh

```
audit(refresh): post-impl-2 — finance installer_migration 0.0 -> X.XX, composite +0.XX
```

---

## Phase 4 — Cycle close

### Task 4.1: Write result doc

`Docs/plans/2026-06-16-test-coverage-impl-2-result.md` — follow the same template as impl-1's result doc:
- What landed (fixtures + harness + exports + per-sub-family counts)
- Composite lift (before/after/delta)
- Preflight count
- Plan-vs-impl deviations (if any during execution — likely fixture adjustments for #17 unified-nav, #11 backfill)
- Lessons / discoveries
- Carry-forwards (especially: extract helper if any new dupes; v0.120.x carries)

Commit: `docs(impl-2): result doc — finance installer_migration X.XX, composite +0.XX`

### Task 4.2: Write post-impl-2 handoff

`Docs/prompts/2026-06-16-post-impl-2-handoff.md` — same template as post-impl-1. Names impl-3 (entity-create) as next. Lists post-impl-2 carry-forwards.

Commit: `docs(handoff): post-impl-2 handoff with impl-3 (entity-create) picks`

### Task 4.3: Final preflight verification

```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -3
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage log --oneline main..HEAD | wc -l
```

Report final test count + commit count above main.

---

## Self-review

1. **Spec coverage**: every section of impl-2 design.md is implemented:
   - 20 apply* fns invoked → Phase 2 Task 2.1 skeleton invokes 17 (the 3 omitted are: applyFinanceMigrations [orchestrator — not needed], applyFinanceUnifiedNavMigration [already in list], ... wait let me recount).

   Recount the invocation list in Phase 2 Task 2.1 Step 2: heal, defaults-scaff, months-scaff, debt-scaff, paycheck-debt-link, paycheck-debt-backfill, categories-group-backfill, budget-group-seed, budget-body, budget-monthly-band, paycheck-body, paycheck-debt-band, hubs-repair, nav-row, nav-row-guard, defaults-nav-row, top-hub-dedup, invoice-workspace-nav, unified-nav = 19 invocations. Good.

   Excludes: `applyFinanceMigrations` (orchestrator wrapper) — verified by sub-fn coverage. Total: 19 of 20 invoked directly; the 20th is the orchestrator.

2. **Placeholder scan**: assert wording has explicit pass/fail logic; no "TBD". Some fixture content is approximate (frontmatter field exact value tolerances) but the asserts are concrete.

3. **Type consistency**:
   - `LEGACY_FIN_DIR` constant declared once, used throughout
   - `tp`, `manifest`, `variables`, `history`, `git` consistently shaped to match install.js call signatures
   - `applyFinanceUnifiedNavMigration` uses `mech` parameter; ensure that the invocation in Task 2.1 Step 2 passes `manifest` (renamed to mech in the fn body) — this works because JS doesn't care about parameter names; the call signature shape just needs the right ordering.

4. **Idempotency in Task 2.9 (sub-family H)**: snapshots are taken AFTER pass 1, then pass 2 runs, then comparisons. The implementer needs to insert the pass-2-invoke block AFTER capturing snapshots and BEFORE the H asserts.

5. **Migrations interdependencies**: the call order in Task 2.1 Step 2 mirrors `applyFinanceMigrations` orchestration order. Don't reorder without checking — some migrations depend on others having run (e.g., #15 hubs-repair needs `Finance.md` etc to be present and stale, which they are in our fixture).

## Execution

Proceed directly with `superpowers:subagent-driven-development` per the user's "don't report back until done" directive.
