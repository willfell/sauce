# Finance Month Cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / test-driven-development. Steps use `- [ ]` tracking.

**Goal:** Make a month simple to set up and operate: a Month-note cockpit (setup checklist + guardrails + Create Budget/Paycheck buttons), a Defaults-vs-month banner, and retirement of the dead `FinanceNavRow` injection — shipped through the release pipeline.

**Architecture:** New pure engine method `FinanceMath.monthSetupStatus` (display-only, envelope untouched) feeds a `MonthSetupChecklist` widget on the Month note. A `FinanceEditScopeBanner` widget surfaces Defaults-vs-month context. Three ungated snapshot-first heals inject the new blocks into existing notes + retire the nav-row injection (→ strip). Create buttons reuse `EntityCreate.create({instance, dv, presetPrompts:{month}})` — no entity-create change.

**Design ref:** `Docs/plans/2026-07-02-month-cockpit-design.md`.

**Resolved facts (from investigation):**
- `EntityCreate.create({ instance, dv, presetPrompts })` (platform/mechanisms/entity-create/entity-create.js:67) short-circuits prompts with `presetPrompts` and still runs `seed_from_defaults`. Budget + paycheck new_entity_buttons both use prompt key **`month`** (manifest.json:395/440). So `customJS.EntityCreate.create({ instance: "budget", dv, presetPrompts: { month } })` creates a fully-seeded `Budget-<month>` with no prompt.
- Month note `inline_body` (manifest ~line 622): SpaceNavButtons → FinanceNav → MonthDashboard → `## Notes`. Checklist injects **after the FinanceNav block, before MonthDashboard**.
- Precedents to mirror: widget = `helpers/budget-allocations-editor.js`; band-injection heal = `applyFinanceBudgetMonthlyBandInjection` + `_injectMonthlyBand` (install.js ~9170/9228); heal behavioral tests = the HC-FIN-BGR-* family in `run-helper-cases.js`; nav-retirement flips the seed-migration assertions in `run-seed-migrations.js` (grep `finance_defaults_nav_row`).
- Guardrail conventions: `FinanceMath._depositIndex` detects an expense's deposit (missing/invalid → coerced to 1 → counts as "untagged"); `FinanceMath.budgetAllocations(dv, month).totals` gives `{income, ...}` + is where reconcile (Σ allocated vs income) is read — **read-only, never summed into the envelope**.

**Constraints:** Work only in worktree `/Users/willfellhoelter/projects/repos/sauce/.worktrees/month-cockpit` on branch `feat/finance-month-cockpit`. Never switch branches / pull / stash. Never hand-version/tag/pin. customJS files = bare class only, no trailing statements (CJS-LOAD gate). New editors/widgets: render-safe instance methods, embed-dedup guard, NO write-on-render. Envelope-isolation invariant is sacroscript — the checklist is display-only.

---

### Task 1: `FinanceMath.monthSetupStatus(dv, monthKey)` (TDD)

**Files:** Modify `platform/blueprints/finance/helpers/finance-math.js`; Test: `platform/test/run-finance-plan-state.js` (has a `dv` stub + budget/paycheck factories).

- [ ] **Step 1 — failing tests.** Add cases asserting (using the harness's existing dv stub + factories):
  - no budget note for month → `status.budget.exists === false`.
  - paycheck with an expense lacking a valid `deposit` → `status.guardrails.untaggedDeposits.count >= 1` and the item name is listed.
  - allocations over income → `status.guardrails.reconcile.ok === false` and `deltaOver > 0`; under income → `ok === true`.
  - **envelope-isolation:** calling `monthSetupStatus` does not change any `computePlanState` envelope value (compute before/after, assert equal).
- [ ] **Step 2 — run, verify fail** (`monthSetupStatus is not a function`).
- [ ] **Step 3 — implement.** Add method (pure; no writes):
```js
monthSetupStatus(dv, monthKey) {
    const budget = this.readBudgetForMonth(dv, monthKey);
    const paychecks = this.readPaychecksForMonth(dv, monthKey);
    const paycheck = paychecks && paychecks.length ? paychecks[0] : null;
    const expenses = (paycheck && Array.isArray(paycheck.expenses)) ? paycheck.expenses : [];
    const deposits = (paycheck && Array.isArray(paycheck.deposits)) ? paycheck.deposits : [];
    // untagged = expense whose `deposit` is missing/invalid (would silently fall to check 1)
    const untagged = expenses.filter(e => {
        const raw = e && e.deposit;
        const n = Number(raw);
        return !(Number.isInteger(n) && n >= 1 && n <= Math.max(1, deposits.length));
    }).map(e => (e && e.item) ? String(e.item) : "(unnamed)");
    let reconcile = { income: 0, totalAllocated: 0, ok: true, deltaOver: 0 };
    try {
        const alloc = this.budgetAllocations(dv, monthKey);
        const t = (alloc && alloc.totals) ? alloc.totals : {};
        const income = Number(t.income) || 0;
        const totalAllocated = (Number(t.fixed)||0) + (Number(t.debt)||0) + (Number(t.savings)||0) + (Number(t.discretionary)||0);
        reconcile = { income, totalAllocated, ok: totalAllocated <= income + 0.01, deltaOver: Math.max(0, totalAllocated - income) };
    } catch (_e) { /* no plan/budget yet — leave defaults */ }
    const paidCount = expenses.filter(e => e && e.paid === true).length;
    const status = {
        month: monthKey,
        budget: { exists: !!budget },
        paycheck: { exists: !!paycheck, depositsMaterialized: deposits.length > 0, expenseCount: expenses.length },
        guardrails: {
            untaggedDeposits: { count: untagged.length, items: untagged },
            reconcile,
        },
        bills: { paidCount, total: expenses.length, pct: expenses.length ? Math.round((paidCount / expenses.length) * 100) : 0 },
    };
    status.ready = status.budget.exists && status.paycheck.exists
        && status.paycheck.depositsMaterialized
        && status.guardrails.untaggedDeposits.count === 0
        && status.guardrails.reconcile.ok;
    return status;
}
```
(Confirm the exact totals keys returned by `budgetAllocations().totals` while implementing; adjust the sum accordingly. If a `totals.discretionary`/`totals.fixed` shape differs, use what the engine actually returns — do NOT recompute the envelope.)
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** `feat(finance): FinanceMath.monthSetupStatus (display-only month health)`.

---

### Task 2: `MonthSetupChecklist` widget (TDD)

**Files:** Create `platform/blueprints/finance/helpers/month-setup-checklist.js`; register in `platform/blueprints/finance/manifest.json` (`files[]` + `claude_surface`/customjs list beside `budget-allocations-editor.js`); Test: extend `platform/test/run-render-safe.js` + `platform/test/run-renderer.js` (mirror how `BudgetAllocationsEditor` is instantiated).

- [ ] **Step 1 — failing render-safe test** (class instantiates, `render(dv)` guarded against embed + missing current file, no throw on empty vault).
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement** (bare class, no trailing statements). `async render(dv)`:
  - embed-dedup: `if (dv.container.closest(".markdown-embed")) return;`
  - read `const cur = dv.current(); const month = cur && cur.month ? String(cur.month) : null;` (coerce a Luxon/Date month via `customJS.FinanceMath._coerceMonthString` if present — see [[lesson_dataview_frontmatter_dates_are_luxon]]).
  - `const st = customJS.FinanceMath.monthSetupStatus(dv, month);`
  - render rows with ✓ / ⚠ / ✗ (use Lucide SVGs via `customJS.Icons` if available, else text glyphs — NO emoji per house style): Budget created (fix: "Create Budget" button when absent) · Paycheck created (button when absent) · Deposits materialized · Deposit tags (⚠ "N expenses default to check 1: …") · Reconcile to income (⚠ "over by $X") · Bills checked off (progress `paidCount/total`).
  - Create buttons via `customJS.AccentButton.render(container, { label: "Create Budget", icon, onClick: () => customJS.EntityCreate.create({ instance: "budget", dv, presetPrompts: { month } }) })` (and `"paycheck"`). Only shown when the entity is absent.
  - Fix-links: open the budget/paycheck note via `app.workspace.openLinkText(path, "")` or a link.
  - No write-on-render.
- [ ] **Step 4 — run render-safe + CJS-LOAD** (`node platform/test/run-customjs-loadable.js`) — class must load.
- [ ] **Step 5 — commit** `feat(finance): MonthSetupChecklist widget (cockpit health + create buttons)`.

---

### Task 3: `FinanceEditScopeBanner` widget (TDD)

**Files:** Create `platform/blueprints/finance/helpers/finance-edit-scope-banner.js`; register in manifest; Test: run-render-safe.js.

- [ ] **Step 1 — failing render-safe test.**
- [ ] **Step 2 — verify fail.**
- [ ] **Step 3 — implement** (bare class): `async render(dv)` — embed-dedup guard; read `cur.type`; render a single muted line:
  - `type` is `budget`/`paycheck` (has `month`): `"Editing " + month + " only — edit Defaults to change every month."`
  - `type` endsWith `-defaults`: `"Template for every new month — changes seed future months, not existing ones."`
  - else: render nothing. Style with `var(--text-muted)`, small font. No writes.
- [ ] **Step 4 — run render-safe + CJS-LOAD.**
- [ ] **Step 5 — commit** `feat(finance): FinanceEditScopeBanner widget (Defaults-vs-month context)`.

---

### Task 4: Install heals — inject blocks + retire nav-row injection (TDD)

**Files:** Modify `platform/install.js` (new heals near `applyFinanceBudgetMonthlyBandInjection`; call sites in `applyFinanceMigrations`; exports); Modify `platform/blueprints/finance/manifest.json` inline_body for month + budget + paycheck + the 3 Defaults scaffolds; Modify `platform/test/run-helper-cases.js` + `platform/test/run-seed-migrations.js`.

- [ ] **Step 1 — failing behavioral tests** (mirror HC-FIN-BGR-* invocation style — `require("../install")`, call the pure transforms):
  - `_injectMonthChecklist(body)` inserts the `MonthSetupChecklist` block (marker `<!-- month-setup-checklist -->`) above the MonthDashboard block; idempotent (second call no-op); anchored.
  - `_injectEditScopeBanner(body)` inserts the banner block (marker `<!-- finance-edit-scope -->`) after the FinanceNav block; idempotent.
  - `_stripDefaultsNavRow(body)` removes a `FinanceNavRow` dataviewjs block; idempotent; leaves FinanceNav.
  - heal exports present + invoked in `applyFinanceMigrations`; `applyFinanceDefaultsNavRowInjection` call REMOVED; all three new heals ungated (no version gate) + snapshot-first (`.sauce-backup`).
  - Flip the existing `finance_defaults_nav_row` seed-migration assertions in `run-seed-migrations.js` to expect the block STRIPPED (not injected).
- [ ] **Step 2 — verify fail.**
- [ ] **Step 3 — implement** pure transforms + async heals mirroring `applyFinanceBudgetMonthlyBandInjection`/`_injectMonthlyBand` (snapshot-first, marker-guarded, per-file failure-loud, ungated). Remove the `await applyFinanceDefaultsNavRowInjection(...)` call from `applyFinanceMigrations`; add `applyFinanceDefaultsNavRowRetirement` (strip) in its place; add `applyFinanceMonthChecklistInjection` + `applyFinanceEditScopeBannerInjection`. Add the new blocks to the manifest inline_body strings so fresh notes are born with them. Add all new exports.
- [ ] **Step 4 — run helper-cases + seed-migrations, verify pass.**
- [ ] **Step 5 — commit** `feat(finance): inject Month cockpit + edit-scope banner; retire FinanceNavRow injection`.

---

### Task 5: Manifest surface + full preflight + self-install

**Files:** `platform/blueprints/finance/manifest.json` (ensure both new widgets are in `files[]` + `claude_surface` + any customjs-contract list); verify only otherwise.

- [ ] **Step 1** — confirm both new `.js` widgets have `files[]` copy entries (`{{scripts_path}}/finance/...`) + appear in the finance `claude_surface`/customjs registration (grep how `budget-allocations-editor.js` is registered; match it). Add to `run-customjs-contract.js` expectations if that test enumerates finance classes.
- [ ] **Step 2 — full preflight:** `npm run release:preflight 2>&1 | tail -25` → green (exit 0). Fix any failure (systematic-debugging). Pay attention to `lint-cold-load`, `lint-note-chrome`, `run-customjs-loadable`, `run-customjs-contract`.
- [ ] **Step 3 — self-install:** `node platform/install.js --vault . --auto-approve 2>&1 | tail -15` → exit 0. Then restore any dogf-install churn: `git checkout -- . && git clean -fd ranch/` (scoped to ranch/, preserve Docs/); delete any `.bak`.
- [ ] **Step 4 — preflight-bumped:** ensure `git status --porcelain` clean (commit the plan+design docs if needed), then `npm run release:preflight-bumped 2>&1 | tail -15` → green.
- [ ] **Step 5 — commit** any remaining registration `chore(finance): register Month cockpit widgets in blueprint surface` (if not already committed).

---

## Self-Review
- **Spec coverage:** monthSetupStatus (T1) · MonthSetupChecklist + create buttons + guardrails + fix-links (T2) · edit-scope banner (T3) · 3 heals + template updates + nav retirement (T4) · surface registration + gates (T5). ✓
- **Envelope isolation:** T1 reads `budgetAllocations().totals` read-only + a before/after `computePlanState` equality assertion. ✓
- **Placeholders:** T1 notes "confirm totals keys while implementing" — a verify-in-code instruction, not a gap; all novel code shown. Mechanical widgets/heals reference exact precedents.
- **Names consistent:** `monthSetupStatus`, `MonthSetupChecklist`, `FinanceEditScopeBanner`, `_injectMonthChecklist`, `_injectEditScopeBanner`, `_stripDefaultsNavRow`, `applyFinanceMonthChecklistInjection`, `applyFinanceEditScopeBannerInjection`, `applyFinanceDefaultsNavRowRetirement`, markers `<!-- month-setup-checklist -->` / `<!-- finance-edit-scope -->`.
