# Monthly Paycheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `paycheck` entity from per-check into one month-keyed note holding `deposits: [{date, amount}]` + an `expenses[]` list where each expense carries a `deposit` index, so each bill is tied to the check that actually pays it.

**Architecture:** Month-keyed paycheck (like the budget). `deposits[]` = the month's income events; each `expenses[]` row has a `deposit` (1-based index). The editor renders per-deposit columns with Assigned/Leftover subtotals and lets you move a bill between checks. Month rollup reads the one monthly note; old per-check notes are ignored by the rollup and archived. Paycheck Defaults gains a `deposit_schedule` + per-expense `deposit` so new months scaffold pre-split.

**Tech Stack:** Node headless install harnesses; Obsidian customJS classes (Dataview-rendered); regex-YAML mutation in `platform/install.js`; conventional commits (pipeline computes versions — never hand-edit versions/tags/pins).

**Ground rules (every task):**
- Work in `/Users/willfellhoelter/projects/repos/sauce/.worktrees/monthly-paycheck`. TDD: failing test → RED → implement → GREEN → commit.
- Conventional commits, **no `Co-Authored-By: Claude` trailer**. Stage explicit files, never `git add -A`.
- Never bump versions/manifest version/package.json/pins. No version literals in tests — read `VERSION_SNAPSHOT.components.finance`.
- **Line numbers drift — re-grep before every edit.** Prefer anchoring on unique code strings.
- Do NOT `git checkout`/`stash`/`rebase`/switch branches — shared worktree HEAD; only `git add` + `git commit`.

---

## Shared contract (used across tasks)

`FinanceMath` gains a deposit coercion helper — implement in Task 2, referenced everywhere:
```js
// 1-based deposit index for an expense; missing/invalid → 1 (first check).
_depositIndex(exp, depositCount) {
    const n = Math.trunc(Number(exp && exp.deposit));
    if (!isFinite(n) || n < 1) return 1;
    if (depositCount && n > depositCount) return depositCount;
    return n;
}
// A note is the NEW monthly format iff it has a deposits[] array.
_isMonthlyPaycheck(p) { return !!(p && Array.isArray(p.deposits)); }
```
New monthly paycheck frontmatter shape (canonical):
```yaml
type: paycheck
month: "2026-07"
deposits:
  - { date: "2026-07-01", amount: 4500 }
  - { date: "2026-07-15", amount: 4500 }
expenses:
  - { item: Rent, amount: 2200, category: Rent, deposit: 1, paid: false }
```

## File structure
- **Modify helpers:** `finance-math.js`, `paycheck-expenses-editor.js`, `paycheck-summary.js`, `paycheck-defaults-editor.js`, `month-dashboard.js`, `monthly-overview.js`.
- **Modify platform:** `manifest.json` (paycheck rule_fragment + "+ New Paycheck" button + Paycheck Defaults shape), `content/Paycheck Defaults.md` (source: add `deposit_schedule` + per-expense `deposit`), `install.js` (archive heal), `schemas-index.json`.
- **Modify tests:** `run-finance-plan-state.js`, `run-renderer.js`, `run-helper-cases.js`, `run-v01103-monthly-overview.js`, `run-seed-migrations.js`; seed fixtures under `platform/test/seed-vault/spice/finance/paychecks/`.

---

## Task 1: Schema + scaffold + defaults (wiring)

**Files:** `platform/blueprints/finance/manifest.json`, `platform/blueprints/finance/content/Paycheck Defaults.md`, `platform/schemas-index.json`

- [ ] **Step 1: Paycheck rule_fragment → month-keyed.** Re-grep the paycheck `rule_fragments` entry (search `spice/finance/paychecks`). Change `required_frontmatter` to require `month` (`type: string, matches: "^\\d{4}-\\d{2}$"`) + `deposits` (`required: false, type: array`) instead of `pay_period_start`/`pay_period_end` (keep those as `required: false` for legacy/archived notes). Change `naming_pattern` to `^Paycheck-\\d{4}-\\d{2}\\.md$`.

- [ ] **Step 2: "+ New Paycheck" button → month prompt.** Re-grep the paycheck `new_entity_buttons[]` entry. Change its `prompts` to prompt for `month` (like the budget button — copy the budget button's month prompt verbatim). Set dest to `spice/finance/paychecks/{{prompts.month}}` / `Paycheck-{{prompts.month}}`. `frontmatter_template`: `type: paycheck`, `month: "{{prompts.month}}"`, `deposits: []`, `expenses: []`. Keep `seed_from_defaults` (source Paycheck Defaults `expenses`, `resolve_wikilinks` for debt) and add nothing that computes dates (deposits are materialized on first render — Task 3).

- [ ] **Step 3: Paycheck Defaults source shape.** There is NO `content/Paycheck Defaults.md`; the create-if-absent source is the constant `FINANCE_PAYCHECK_DEFAULTS_CONTENT` in `platform/install.js` (re-grep — ~line 5527). Add a `deposit_schedule` to its frontmatter (expenses stays `[]`; users add their own with per-expense `deposit` via the defaults editor, Task 5):
```yaml
type: paycheck-defaults
deposit_schedule:
  - { day: 1, amount: 0 }
  - { day: 15, amount: 0 }
expenses: []
```
The deposit-materialize (Task 3) reads `deposit_schedule`; if a vault's Paycheck Defaults lacks it, the editor falls back to a default `[{day:1,amount:0},{day:15,amount:0}]` — so NO backfill heal is needed for existing Paycheck Defaults.

- [ ] **Step 4: Schema note.** In `schemas-index.json`, update the `finance-rule-fragments` + `finance-new-entity-buttons` notes to describe month-keyed paycheck + `deposits[]` + per-expense `deposit` + `deposit_schedule`.

- [ ] **Step 5: Verify + commit.** `npm run lint-schemas` (0 issues) and `node platform/install.js --vault . --auto-approve` (self-install exit 0; manifest parses).
```bash
git add platform/blueprints/finance/manifest.json platform/install.js platform/schemas-index.json
git commit -m "feat(finance): paycheck entity is month-keyed with deposits[] + per-expense deposit tag (schema + scaffold)"
```

---

## Task 2: FinanceMath — deposit-aware month reads

**Files:** `platform/blueprints/finance/helpers/finance-math.js`; test `platform/test/run-finance-plan-state.js`

- [ ] **Step 1: Failing tests** in `run-finance-plan-state.js` (match the file's `ok(...)`/`makeDv` conventions; a monthly paycheck stub has `deposits` + `month` + `expenses[].deposit`):
```js
// Monthly-format paycheck: readPaychecksForMonth reads by `month`; monthIncome sums deposits.
{
  const mp = { type:"paycheck", month:"2026-07", deposits:[{date:"2026-07-01",amount:4500},{date:"2026-07-15",amount:4500}],
    expenses:[{item:"Rent",amount:2200,category:"Rent",deposit:1,paid:false},{item:"Apple",amount:950,category:"Credit Payment",debt:"[[Debt-Apple-Card]]",deposit:2,paid:true}],
    file:{ path:"spice/finance/paychecks/2026-07/Paycheck-2026-07.md", name:"Paycheck-2026-07" } };
  const dv = makeDv({ paychecks:[mp] });
  const got = fm.readPaychecksForMonth(dv, "2026-07");
  ok("MP-1 monthly paycheck read by month", got.length === 1);
  ok("MP-2 monthIncome sums deposits", fm.monthIncome(got) === 9000);
  ok("MP-3 monthExpensesTotal sums expenses", fm.monthExpensesTotal(got) === 3150);
  ok("MP-4 monthDebtPaid counts paid+debt", fm.monthDebtPaid(got) === 950);
}
// Legacy per-check note (no deposits[]) is NOT summed by the monthly rollup.
{
  const legacy = { type:"paycheck", pay_period_start:"2026-07-01", pay_period_end:"2026-07-15", paycheck_amount:4500, expenses:[], file:{ path:"spice/finance/paychecks/_archive/Paycheck-2026-07-01.md", name:"Paycheck-2026-07-01" } };
  const dv = makeDv({ paychecks:[legacy] });
  ok("MP-5 legacy per-check note ignored by monthly rollup", fm.readPaychecksForMonth(dv, "2026-07").length === 0);
}
```

- [ ] **Step 2: Run RED.** `node platform/test/run-finance-plan-state.js` → MP-1/MP-2/MP-5 fail.

- [ ] **Step 3: Implement.** Add `_depositIndex` + `_isMonthlyPaycheck` (Shared contract). Rewrite `readPaychecksForMonth` to read monthly-format notes by `month`, excluding `_archive/`:
```js
readPaychecksForMonth(dv, monthKey) {
    try {
        return dv.pages('"spice/finance/paychecks"').where(p => {
            if (!p || p.type !== "paycheck") return false;
            if (p.file && typeof p.file.path === "string" && p.file.path.includes("/_archive/")) return false;
            if (!this._isMonthlyPaycheck(p)) return false; // ignore legacy per-check notes in the monthly rollup
            const m = this._coerceMonthString(p.month);
            return m === monthKey;
        }).array();
    } catch (_e) { return []; }
}
```
Change `monthIncome` to sum deposits (fallback to `paycheck_amount` for legacy):
```js
monthIncome(paychecks) {
    return paychecks.reduce((s, p) => {
        if (Array.isArray(p.deposits)) return s + p.deposits.reduce((d, x) => d + (Number(x && x.amount) || 0), 0);
        return s + (typeof p.paycheck_amount === "number" ? p.paycheck_amount : 0);
    }, 0);
}
```
Leave `monthExpensesTotal`, `monthDebtPaid`, `debtPaidByDebt` reading `expenses[]` (unchanged — they already sum `expenses`). Add a `depositTotals(paycheck)` helper returning per-deposit `{assigned, leftover}` for the widgets:
```js
depositTotals(paycheck) {
    const deposits = Array.isArray(paycheck && paycheck.deposits) ? paycheck.deposits : [];
    const expenses = Array.isArray(paycheck && paycheck.expenses) ? paycheck.expenses : [];
    const assigned = deposits.map(() => 0);
    for (const e of expenses) {
        const idx = this._depositIndex(e, deposits.length) - 1;
        if (idx >= 0 && idx < assigned.length) assigned[idx] += (Number(e && e.amount) || 0);
    }
    return deposits.map((d, i) => ({ date: d && d.date, amount: Number(d && d.amount) || 0, assigned: assigned[i], leftover: (Number(d && d.amount) || 0) - assigned[i] }));
}
```

- [ ] **Step 4: Run GREEN.** `node platform/test/run-finance-plan-state.js`. Add `"depositTotals"`, `"_depositIndex"` to the FinanceMath API method list in `run-helper-cases.js` (re-grep the `methods` array); run `node platform/test/run-helper-cases.js`.

- [ ] **Step 5: Commit.**
```bash
git add platform/blueprints/finance/helpers/finance-math.js platform/test/run-finance-plan-state.js platform/test/run-helper-cases.js
git commit -m "feat(finance): FinanceMath reads month-keyed paychecks with deposits[] (monthIncome sums deposits, depositTotals per-check)"
```

---

## Task 3: PaycheckExpensesEditor — per-deposit view + materialize

**Files:** `platform/blueprints/finance/helpers/paycheck-expenses-editor.js`; test `platform/test/run-renderer.js`

- [ ] **Step 1: Failing tests** in `run-renderer.js` (mirror the existing FF paycheck-editor tests; stub `customJS.FinanceMath.depositTotals` + a monthly paycheck `dv.current()`):
  - **DEP-MAT:** render a paycheck whose `deposits: []` and `month: "2026-07"` with a stubbed `customJS.FinanceMath` exposing a `readPlan`/defaults path returning `deposit_schedule:[{day:1,amount:4500},{day:15,amount:4500}]`; assert `FinanceFrontmatter.update` was called once writing `deposits` = `[{date:"2026-07-01",amount:4500},{date:"2026-07-15",amount:4500}]`, and a SECOND render with deposits already present writes nothing (idempotent).
  - **DEP-RENDER:** render a paycheck with 2 deposits + expenses tagged deposit 1/2; assert the root shows both deposit dates, a per-row deposit tag, and Assigned/Leftover subtotals (use stubbed `depositTotals`).
  - **DEP-MOVE:** invoke the move-flow (stub the picker to return deposit 2) on a deposit-1 row; assert `expenses[i].deposit` written = 2 and the re-render reflects it (render-from-authoritative).

- [ ] **Step 2: Run RED.** `node platform/test/run-renderer.js`.

- [ ] **Step 3: Implement.** In `paycheck-expenses-editor.js`:
  - `render(dv, override)` reads `page = dv.current()`; if `Array.isArray(page.deposits) && page.deposits.length === 0`, call `await this._materializeDeposits(file, dv, page)` (reads `deposit_schedule` from Paycheck Defaults via `customJS.FinanceFrontmatter.read("spice/finance/Paycheck Defaults.md")` or `customJS.FinanceMath.readPaycheckDefaults(dv)`; builds `deposits = schedule.map(s => ({ date: monthKey + "-" + String(s.day).padStart(2,"0"), amount: s.amount }))`; writes once via `_mutate`; then re-render). Guard with an instance `this._materializing` flag + only when empty (no write loop).
  - Render a deposits header (date + editable amount per deposit) using `customJS.FinanceMath.depositTotals(page)` for Assigned/Leftover.
  - Each expense row shows a deposit tag (ordinal from its deposit's date, e.g. "1st"/"15th") + is clickable to a move-flow (`_moveFlow(file, dv, index, exp)` → a small picker of the deposits → writes `exp.deposit` via merge → `render(dv, next)`).
  - Reuse the fixed render-from-authoritative + `Object.assign({}, current, result)` merge patterns already in this file. Add/Edit flows keep the row's `deposit` (default 1 for new rows).

- [ ] **Step 4: Run GREEN.** `node platform/test/run-renderer.js`.

- [ ] **Step 5: Commit.**
```bash
git add platform/blueprints/finance/helpers/paycheck-expenses-editor.js platform/test/run-renderer.js
git commit -m "feat(finance): paycheck editor renders per-deposit columns, materializes deposits from schedule, moves bills between checks"
```

---

## Task 4: PaycheckSummary + MonthDashboard + MonthlyOverview

**Files:** `paycheck-summary.js`, `month-dashboard.js`, `monthly-overview.js`; tests `run-renderer.js` / `run-finance-plan-widgets.js` / `run-v01103-monthly-overview.js`

- [ ] **Step 1: Failing tests.** For each widget, a case that a monthly paycheck (deposits + tagged expenses) renders per-deposit income/assigned; and that `MonthlyOverview` income = Σ deposits for the month.

- [ ] **Step 2: RED.** Run the three harnesses.

- [ ] **Step 3: Implement.**
  - `paycheck-summary.js`: header line uses `customJS.FinanceMath.depositTotals(page)` — show each deposit's income + assigned + leftover, and a combined total (Σ deposits vs Σ expenses).
  - `month-dashboard.js` `_renderPaycheckTotals`: re-grep; instead of one row per note, render one row per deposit across the month's monthly note(s): `date — income — assigned`. Income total = `customJS.FinanceMath.monthIncome(paychecks)`.
  - `monthly-overview.js`: re-grep BOTH `_readPaychecks` (retarget to `p.month === monthKey`, exclude `/_archive/`, require `deposits[]`) AND `_sumIncome` (sum `deposits[].amount`, fallback `paycheck_amount`).
  - **Secondary paycheck-reading widgets (all read `pay_period_start`/`paycheck_amount` today — re-grep each):**
    - `finance-hub-summary.js` "latest paycheck" tile (~243-254): sort/pick the latest by `month` (not `pay_period_start`); income from `deposits[]`.
    - `finance-status.js` paycheck status branch (~48-65): derive status from `month`/deposits instead of `pay_period_start`.
    - `paychecks-cards.js` sort + subtitle (~15/22/31-34): sort by `month`; subtitle shows deposits/month total.
    - `finance-nav-row.js` (~119) + `finance-nav.js` (~230): `sortKey` off `pay_period_start` → `month`.
  - **Schema notes:** in `schemas-index.json` update the MonthlyOverview note (re-grep ~line 242) from `(p.pay_period_end || p.pay_period_start).startsWith(monthKey)` → `p.month === monthKey`, and the computePlanState note (~254) if income sourcing wording changes.

- [ ] **Step 4: GREEN + Step 5: Commit.**
```bash
git add platform/blueprints/finance/helpers/paycheck-summary.js platform/blueprints/finance/helpers/month-dashboard.js platform/blueprints/finance/helpers/monthly-overview.js platform/blueprints/finance/helpers/finance-hub-summary.js platform/blueprints/finance/helpers/finance-status.js platform/blueprints/finance/helpers/paychecks-cards.js platform/blueprints/finance/helpers/finance-nav-row.js platform/blueprints/finance/helpers/finance-nav.js platform/schemas-index.json platform/test/run-renderer.js platform/test/run-finance-plan-widgets.js platform/test/run-v01103-monthly-overview.js
git commit -m "feat(finance): all paycheck-reading widgets read per-deposit income + month-keyed sort/status"
```

---

## Task 5: PaycheckDefaultsEditor — deposit field + schedule editor

**Files:** `paycheck-defaults-editor.js`; test `run-renderer.js`

- [ ] **Step 1: Failing tests.** Editing a default expense preserves/sets its `deposit` (merge-on-edit, extra field survives); a deposit_schedule editor renders + edits the `deposit_schedule[]` (add/edit day+amount).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** Add a `deposit` control (1/2 toggle or number) to the default-expense modal; the resolve object includes `deposit`. Merge-on-edit preserves it. Add a small `deposit_schedule` section (day + amount rows) writing `fm.deposit_schedule`. Use render-from-authoritative.
- [ ] **Step 4: GREEN + Step 5: Commit.**
```bash
git add platform/blueprints/finance/helpers/paycheck-defaults-editor.js platform/test/run-renderer.js
git commit -m "feat(finance): Paycheck Defaults editor sets per-expense deposit + deposit_schedule"
```

---

## Task 6: Archive heal for legacy per-check notes

**Files:** `platform/install.js`; seed fixtures + `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Seed regression.** Add a legacy per-check fixture `platform/test/seed-vault/spice/finance/paychecks/2026-05/Paycheck-2026-05-01.md` (`type: paycheck`, `pay_period_start`/`pay_period_end`, NO `deposits[]`). Add a new family `HC-V0XXX-SEED-MIGRATE-PAYCHECK-ARCHIVE-*` asserting post-install: the file is gone from its original path and present under `spice/finance/paychecks/_archive/` (and a `.sauce-backup` snapshot exists). Run RED.

- [ ] **Step 2: Implement heal** `applyFinancePaycheckArchiveLegacy` in `install.js` — mirror an adjacent finance heal's snapshot/history conventions (re-grep `applyFinanceBudgetGroupSeed`). Walk `spice/finance/paychecks/**/Paycheck-*.md`; for each note that is `type: paycheck`, has `pay_period_start`, and NO `deposits:` array, and is NOT already under `_archive/`: snapshot to `.sauce-backup`, write a copy to `spice/finance/paychecks/_archive/<basename>`, remove the original (`adapter.remove`/`adapter.trashSystem` — re-grep how the installer deletes/moves a file; if none, write-then-`adapter.remove`). Idempotent (skip if already archived). Register in `applyFinanceMigrations` (ungated) + `module.exports`.

- [ ] **Step 3: GREEN.** `node platform/test/run-seed-migrations.js`.

- [ ] **Step 4: Commit.**
```bash
git add platform/install.js platform/test/seed-vault/spice/finance/paychecks platform/test/run-seed-migrations.js
git commit -m "feat(finance): archive legacy per-check paycheck notes to paychecks/_archive/ (ungated heal)"
```

---

## Task 7: Update attribution assertions for the month-keyed model

**Files:** `run-helper-cases.js`, `run-v01103-monthly-overview.js`, `run-finance-plan-state.js`

- [ ] **Step 1.** Re-grep every assertion pinning `pay_period_start`/`pay_period_end` in these files (esp. `V01103-MO-READS-3`). Rewrite them to assert the month-keyed reads (`readPaychecksForMonth` reads by `month` + `deposits[]`; MonthlyOverview income sums `deposits`). Any `pay_period_*` fixture that must remain is a legacy/archived case only.
- [ ] **Step 2.** `node platform/test/run-helper-cases.js` + `node platform/test/run-v01103-monthly-overview.js` + `node platform/test/run-finance-plan-state.js` all 0-fail.
- [ ] **Step 3: Commit.**
```bash
git add platform/test/run-helper-cases.js platform/test/run-v01103-monthly-overview.js platform/test/run-finance-plan-state.js
git commit -m "test(finance): month-keyed paycheck attribution assertions"
```

---

## Task 8: Full verification

- [ ] `npm run release:preflight` → whole-suite 0-fail.
- [ ] `npm run lint-schemas` → 0 issues.
- [ ] `node platform/install.js --vault . --auto-approve` → exit 0.
- [ ] Clean tree, then `npm run release:preflight-bumped` → PASS.
- [ ] Fix any red in place; re-run before PR.

---

## Self-review (author)
- **Spec coverage:** data model → T1/T2; pay schedule + defaults pre-assign → T1/T5; widget per-deposit view + materialize + move → T3; Month/Budget integration → T2/T4; transition archive → T6; assertions → T7; gate → T8.
- **Type consistency:** `_depositIndex(exp, count)`, `_isMonthlyPaycheck(p)`, `depositTotals(paycheck)→[{date,amount,assigned,leftover}]`, `deposits:[{date,amount}]`, `expenses[].deposit:int` — used identically across T2/T3/T4.
- **No version literals** in tests; new methods added to the API list, not pinned.
