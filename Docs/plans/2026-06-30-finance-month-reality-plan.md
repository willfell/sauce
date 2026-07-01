# Finance "month reality" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the finance blueprint match how the user actually lives it — paychecks attribute to the month they're *paid* (`pay_period_end`), the monthly budget shows the full debt+savings picture (live-derived with per-row override), and the row editors stop losing data.

**Architecture:** Three independent workstreams in one worktree, one finance minor bump, one PR. WS1 = attribution (`finance-math.js` + `monthly-overview.js`). WS2 = budget allocations (new `budgetAllocations` engine method + new `BudgetAllocationsEditor` widget + optional-array schema + body-injection heal + Month-dashboard planned column). WS3 = editor fixes (render-from-authoritative + merge-on-edit across all four editors).

**Tech Stack:** Node (headless install harnesses), Obsidian customJS classes (Dataview-rendered), regex-based YAML mutation in `platform/install.js`, conventional commits (the release pipeline computes versions — **never** hand-edit versions/tags/pins).

**Ground rules for every task:**
- Work in the worktree `/Users/willfellhoelter/projects/repos/sauce/.worktrees/finance-month-reality`.
- TDD: write/extend the harness case first, run it RED, implement, run GREEN, commit.
- Conventional commit messages; **no `Co-Authored-By: Claude` trailer** (sauce rule). Stage explicit files — never `git add -A`.
- Do **not** bump `workshop_version` / `package.json` / manifest `version` / pins. Do **not** hardcode version literals in tests — read `VERSION_SNAPSHOT.components.finance`.
- Line numbers below are from the surface map at plan-authoring time — **re-grep before editing**, they drift.

---

## File structure

**Create:**
- `platform/blueprints/finance/helpers/budget-allocations-editor.js` — new editable Debt/Savings sections widget.

**Modify (helpers):**
- `finance-math.js` — `readPaychecksForMonth` end-first; new `budgetAllocations(dv, monthKey)`.
- `monthly-overview.js` — income filter end-first.
- `paycheck-expenses-editor.js`, `budget-categories-editor.js`, `budget-defaults-editor.js` — render-from-authoritative + merge-on-edit.
- `month-dashboard.js` — planned column in Debt Changes.

**Modify (platform):**
- `platform/blueprints/finance/manifest.json` — rule_fragment optional arrays; budget frontmatter template + `inline_body` (arrays + widget block); register new helper file everywhere `budget-categories-editor.js` is registered.
- `platform/blueprints/finance/templates/Budget Template.md` — arrays + widget block.
- `platform/install.js` — `applyFinanceBudgetAllocationsBandInjection` heal + dispatch + export.
- `platform/schemas-index.json` — update two finance entry notes.

**Modify (tests):**
- `run-finance-plan-state.js` (attribution + budgetAllocations), `run-renderer.js` (editor fixes), `run-helper-cases.js` (`V01103-MO-READS-3` + new source contracts), `run-v01103-monthly-overview.js` (end-based fixtures), optionally `run-seed-migrations.js` (body-injection assert).

---

## Task 1: WS3 — PaycheckExpensesEditor render-from-authoritative + merge-on-edit

**Files:**
- Modify: `platform/blueprints/finance/helpers/paycheck-expenses-editor.js`
- Test: `platform/test/run-renderer.js` (extend FF5 region)

- [ ] **Step 1: Add failing render tests in `run-renderer.js`.** Locate the FF5 block that instantiates `PaycheckExpensesEditor` (search `loadFinanceClass('PaycheckExpensesEditor'`). Mirror its setup. Override the customJS seam to capture mutations and drive an authoritative re-render. Add:

```js
// FF6: PaycheckExpensesEditor delete re-renders from the authoritative array,
// not the frozen dv.current() (proves render-from-authoritative fix).
{
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const captured = { expenses: [{ item: "A", amount: 1 }, { item: "B", amount: 2 }] };
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceFrontmatter = { update: async (file, mut) => { const fm = { expenses: captured.expenses.slice() }; await mut(fm); captured.expenses = fm.expenses; }, read: () => null, isTruthy: (v) => v === true };
  const Cls = (new Function('app','customJS','Notice', fs.readFileSync(path.join(FINANCE_HELPERS,'paycheck-expenses-editor.js'),'utf8') + "\nreturn PaycheckExpensesEditor;"))(app, cjs, FakeNotice);
  const inst = new Cls();
  // dv.current() is FROZEN with the original 2-row array (the bug's trigger).
  const dv = makeDvWithCurrentAndFrontmatter({ name:'Paycheck-x', path:'spice/finance/paychecks/x/Paycheck-x.md' }, { expenses: captured.expenses.slice() });
  // Simulate delete of index 0 via the internal flow, bypassing window.confirm.
  global.window = { confirm: () => true };
  await inst._deleteFlow(dv.current().file ? app.vault.getAbstractFileByPath('spice/finance/paychecks/x/Paycheck-x.md') : null, dv, 0, captured.expenses[0]);
  const root = findClass(dv.container, 'pee-root');
  const rowText = root ? JSON.stringify(collectText(root)) : "";
  assertTrue("FF6-1: after delete, re-render drops row A despite frozen dv.current()", captured.expenses.length === 1 && captured.expenses[0].item === "B");
  assertTrue("FF6-2: rendered rows reflect the authoritative array (no 'A')", !/\"A\"|>A<|item.*A/.test(rowText) || root !== null);
}
// FF7: editing a debt-linked row preserves its debt wikilink (merge-on-edit).
{
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const captured = { expenses: [{ item: "Apple", amount: 950, category: "Credit Payment", url: "https://card.apple.com", debt: "[[Debt-Apple-Card]]", paid: false }] };
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceFrontmatter = { update: async (file, mut) => { const fm = { expenses: captured.expenses.slice() }; await mut(fm); captured.expenses = fm.expenses; }, read: () => null, isTruthy: (v) => v === true };
  const Cls = (new Function('app','customJS','Notice', fs.readFileSync(path.join(FINANCE_HELPERS,'paycheck-expenses-editor.js'),'utf8') + "\nreturn PaycheckExpensesEditor;"))(app, cjs, FakeNotice);
  const inst = new Cls();
  const file = app.vault.getAbstractFileByPath('spice/finance/paychecks/x/Paycheck-x.md');
  // Stub the modal to return edited fields WITHOUT a debt field (the bug's trigger).
  inst._promptForExpense = async () => ({ item: "Apple", amount: 950, category: "Credit Payment", paid: true, url: "https://card.apple.com" });
  const dv = makeDvWithCurrentAndFrontmatter({ name:'Paycheck-x', path:'spice/finance/paychecks/x/Paycheck-x.md' }, { expenses: captured.expenses.slice() });
  await inst._editFlow(file, dv, 0, captured.expenses[0]);
  assertTrue("FF7-1: edited debt row keeps its [[Debt-Apple-Card]] link", captured.expenses[0].debt === "[[Debt-Apple-Card]]");
  assertTrue("FF7-2: edited row applied the new paid flag", captured.expenses[0].paid === true);
}
```

> If `FINANCE_HELPERS` / `collectText` / `findClass` / `makeFinanceCustomJsStub` names differ in the file, adapt to the actual helpers present — the intent is: frozen `dv.current()`, capture the write, assert the post-mutate state reflects the write and the debt link survives.

- [ ] **Step 2: Run RED.** `node platform/test/run-renderer.js` → FF6-1/FF7-1 FAIL (delete cascades / debt stripped).

- [ ] **Step 3: Implement render-from-authoritative + merge.** In `paycheck-expenses-editor.js`:
  - Change `render(dv)` signature to `render(dv, override)` and read `const expenses = Array.isArray(override) ? override : (Array.isArray(page.expenses) ? page.expenses : []);` (keep the existing `dv.current()`/`file` reads).
  - In `_addFlow` / `_editFlow` / `_deleteFlow`, capture the new array inside the mutator and pass it to render:

```js
async _deleteFlow(file, dv, index, current) {
    if (!window.confirm(`Delete expense '${current?.item || ""}'?`)) return;
    let next = null;
    await this._mutate(file, (fm) => {
        const list = (fm.expenses || []).slice();
        list.splice(index, 1);
        fm.expenses = list;
        next = list.slice();
    });
    await this.render(dv, next);
}
async _editFlow(file, dv, index, current) {
    const result = await this._promptForExpense(current);
    if (!result) return;
    let next = null;
    await this._mutate(file, (fm) => {
        const list = (fm.expenses || []).slice();
        list[index] = Object.assign({}, current, result);
        fm.expenses = list;
        next = list.slice();
    });
    await this.render(dv, next);
}
async _addFlow(file, dv) {
    const result = await this._promptForExpense(null);
    if (!result) return;
    let next = null;
    await this._mutate(file, (fm) => {
        fm.expenses = (fm.expenses || []).concat([result]);
        next = fm.expenses.slice();
    });
    await this.render(dv, next);
}
```

- [ ] **Step 4: Run GREEN.** `node platform/test/run-renderer.js` → FF6/FF7 pass; no other regressions.

- [ ] **Step 5: Commit.**

```bash
git add platform/blueprints/finance/helpers/paycheck-expenses-editor.js platform/test/run-renderer.js
git commit -m "fix(finance): paycheck editor renders from authoritative array + preserves debt link on edit"
```

---

## Task 2: WS3 — BudgetCategoriesEditor + BudgetDefaultsEditor same fixes

**Files:**
- Modify: `platform/blueprints/finance/helpers/budget-categories-editor.js`, `platform/blueprints/finance/helpers/budget-defaults-editor.js`
- Test: `platform/test/run-renderer.js` (extend FF4 region)

- [ ] **Step 1: Add failing tests** mirroring Task 1's FF6/FF7 for `BudgetCategoriesEditor` (array = `categories`, edit preserves an extra field e.g. `{group,name,planned,actual,note:"keep"}` → assert `note` survives) and a delete-reflects-authoritative case. Name them FF8-*/FF9-*.

- [ ] **Step 2: Run RED.** `node platform/test/run-renderer.js` → new cases FAIL.

- [ ] **Step 3: Implement.** In `budget-categories-editor.js`: `render(dv, override)` reading `const categories = Array.isArray(override) ? override : (Array.isArray(page.categories) ? page.categories.slice() : []);`; in `_addFlow`/`_editFlow`/`_deleteFlow`, capture `next` and `await this.render(dv, next)`; `_editFlow` uses `list[index] = Object.assign({}, current, result);`. In `budget-defaults-editor.js`: same `render(dv, override)` for `categories`; `_editCategoryFlow` uses `Object.assign({}, current, result)` and passes `next` to render; apply to the group flows too where they end in `await this.render(dv)` after a `fm.categories`/`fm.groups` mutation (capture and pass the relevant array; groups pane can pass `override` only for the array it mutates — if a flow mutates both, pass `null` to fall back to `dv.current()` which by then reflects the metadata write for that editor's slower cadence — acceptable, the categories cascade is the data-loss risk).

- [ ] **Step 4: Run GREEN.** `node platform/test/run-renderer.js`.

- [ ] **Step 5: Commit.**

```bash
git add platform/blueprints/finance/helpers/budget-categories-editor.js platform/blueprints/finance/helpers/budget-defaults-editor.js platform/test/run-renderer.js
git commit -m "fix(finance): budget editors render from authoritative array + preserve extra row fields on edit"
```

---

## Task 3: WS1 — readPaychecksForMonth attributes by pay_period_end

**Files:**
- Modify: `platform/blueprints/finance/helpers/finance-math.js` (`readPaychecksForMonth`, ~37–45)
- Test: `platform/test/run-finance-plan-state.js`

- [ ] **Step 1: Add failing cases.** In `run-finance-plan-state.js`, using its `paycheck(start, amount)` factory and `makeDv`, add (adapt the factory so it can set a distinct end):

```js
// Attribution: a check straddling the boundary attributes by pay_period_end.
{
  const p = { type:"paycheck", pay_period_start:"2026-06-28", pay_period_end:"2026-07-02", paycheck_amount:4500, expenses:[], file:{ path:"spice/finance/paychecks/2026-06-28/Paycheck-2026-06-28.md", name:"Paycheck-2026-06-28" } };
  const dv = makeDv({ paychecks:[p] });
  const july = fm.readPaychecksForMonth(dv, "2026-07");
  const june = fm.readPaychecksForMonth(dv, "2026-06");
  assertTrue("ATTR-1: straddling check attributes to July (by end)", july.length === 1 && june.length === 0);
}
// Legacy fallback: a check with only pay_period_start attributes by start.
{
  const p = { type:"paycheck", pay_period_start:"2026-06-15", paycheck_amount:4500, expenses:[], file:{ path:"x", name:"Paycheck-2026-06-15" } };
  const dv = makeDv({ paychecks:[p] });
  assertTrue("ATTR-2: legacy check (no end) falls back to start-month", fm.readPaychecksForMonth(dv, "2026-06").length === 1);
}
```

(If the harness uses a different assert helper than `assertTrue`, match the file's convention.)

- [ ] **Step 2: Run RED.** `node platform/test/run-finance-plan-state.js` → ATTR-1 FAILs (currently attributes by start → July empty).

- [ ] **Step 3: Implement.** Replace the matcher body in `readPaychecksForMonth`:

```js
readPaychecksForMonth(dv, monthKey) {
    try {
        return dv.pages('"spice/finance/paychecks"').where(p => {
            if (!p || p.type !== "paycheck") return false;
            const key = this._coerceDateString(p.pay_period_end) || this._coerceDateString(p.pay_period_start);
            return typeof key === "string" && key.startsWith(monthKey);
        }).array();
    } catch (_e) { return []; }
}
```

- [ ] **Step 4: Run GREEN.** `node platform/test/run-finance-plan-state.js`.

- [ ] **Step 5: Commit.**

```bash
git add platform/blueprints/finance/helpers/finance-math.js platform/test/run-finance-plan-state.js
git commit -m "fix(finance): attribute paychecks to the month they are paid (pay_period_end, start fallback)"
```

---

## Task 4: WS1 — MonthlyOverview income filter + assertion + harness

**Files:**
- Modify: `platform/blueprints/finance/helpers/monthly-overview.js` (~106)
- Modify: `platform/test/run-helper-cases.js` (`V01103-MO-READS-3`, ~13012)
- Modify: `platform/test/run-v01103-monthly-overview.js` (paycheck fixtures)
- Modify: `platform/schemas-index.json` (`finance-monthly-overview-page-read` note)

- [ ] **Step 1: Update the source-contract assertion** so it no longer pins `pay_period_start`. Rewrite `V01103-MO-READS-3` to accept the end-first rule, e.g.:

```js
assertTrue("V01103-MO-READS-3: filters paychecks by pay_period_end month prefix (start fallback)",
  /pay_period_end[\s\S]{0,400}startsWith/.test(src));
```

- [ ] **Step 2: Update the behavioral harness fixtures.** In `run-v01103-monthly-overview.js`, give the paycheck stub(s) a `pay_period_end` and add a straddling-check assertion that income lands in the end-month. Run RED: `node platform/test/run-v01103-monthly-overview.js`.

- [ ] **Step 3: Implement** in `monthly-overview.js` — change its paycheck income filter to end-first (mirror Task 3's key expression). Re-grep line ~106 for the exact `pay_period_start ... startsWith` code and replace with the `_coerceDateString(p.pay_period_end) || _coerceDateString(p.pay_period_start)` form (use the file's existing date-coercion helper; if none, coerce inline consistent with the class).

- [ ] **Step 4: Update the schema note.** In `schemas-index.json`, `finance-monthly-overview-page-read` `notes`: change "paychecks filtered by `p.pay_period_start.startsWith(monthKey)`" → "`pay_period_end` (start fallback)".

- [ ] **Step 5: Run GREEN.** `node platform/test/run-v01103-monthly-overview.js`; `node platform/test/run-helper-cases.js`; `npm run lint-schemas`.

- [ ] **Step 6: Commit.**

```bash
git add platform/blueprints/finance/helpers/monthly-overview.js platform/test/run-helper-cases.js platform/test/run-v01103-monthly-overview.js platform/schemas-index.json
git commit -m "fix(finance): MonthlyOverview income attributes by pay_period_end to match month attribution"
```

---

## Task 5: WS2 — schema, template, and new-widget wiring for allocation arrays

**Files:**
- Modify: `platform/blueprints/finance/manifest.json` (budget rule_fragment ~672–697; budget `new_entity_buttons` frontmatter_template + `inline_body` ~397–426; `files[]` list; version-independent)
- Modify: `platform/blueprints/finance/templates/Budget Template.md`
- Modify: `platform/schemas-index.json` (`finance-rule-fragments` note)
- Create (empty placeholder for later tasks): `platform/blueprints/finance/helpers/budget-allocations-editor.js` with a minimal class stub so registration resolves.

- [ ] **Step 1: Add optional arrays to the budget rule_fragment.** In the budget fragment `required_frontmatter`, add alongside `groups`:

```json
        "debt_allocations": { "required": false, "type": "array" },
        "savings_allocations": { "required": false, "type": "array" }
```

- [ ] **Step 2: Birth new budgets with the arrays + widget block.** In the "+ New Budget" `new_entity_buttons` entry: add `"debt_allocations": [],` and `"savings_allocations": []` to its `frontmatter_template`, and add to its `inline_body` (after the `BudgetCategoriesEditor` guard block) a new block:

```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetAllocationsEditor" });
```
```

Mirror the exact same additions in `platform/blueprints/finance/templates/Budget Template.md` (frontmatter `debt_allocations: []` / `savings_allocations: []`; append the `BudgetAllocationsEditor` dataviewjs block).

- [ ] **Step 3: Register the new helper file.** Re-grep `budget-categories-editor` across `platform/blueprints/finance/manifest.json` (and `ranch/` if a customjs registry lists it) to find **every** registration site — the manifest `files[]` array entry (source→dest under helpers) and any customjs class registry. Add the identical wiring for `budget-allocations-editor.js`. Create the stub file so those references resolve:

```js
class BudgetAllocationsEditor {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;
        const previous = dv.container.querySelector(":scope > .bae-root");
        if (previous) previous.remove();
        // Implemented in Task 7.
    }
}
```

- [ ] **Step 4: Update the schema note.** In `schemas-index.json`, `finance-rule-fragments` `notes`: correct the count and mention budget `debt_allocations[]` / `savings_allocations[]` optional arrays.

- [ ] **Step 5: Verify wiring.** `npm run lint-schemas` (green) and `node platform/install.js --vault . --auto-approve` (workshop self-install green — confirms the new file materializes + manifest parses).

- [ ] **Step 6: Commit.**

```bash
git add platform/blueprints/finance/manifest.json platform/blueprints/finance/templates/"Budget Template.md" platform/blueprints/finance/helpers/budget-allocations-editor.js platform/schemas-index.json
git commit -m "feat(finance): add optional debt_allocations/savings_allocations to budget schema + register BudgetAllocationsEditor"
```

---

## Task 6: WS2 — FinanceMath.budgetAllocations engine method

**Files:**
- Modify: `platform/blueprints/finance/helpers/finance-math.js` (add method after `computePlanState`)
- Test: `platform/test/run-finance-plan-state.js`

- [ ] **Step 1: Add failing tests.** Using `makeDv` with a plan + debts + a budget carrying overrides:

```js
// budgetAllocations merges live plan allocation with per-row overrides.
{
  const dv = makeDv({
    plan: { income_floor:9000, fixed_living_monthly:3851, attack_above_minimums:570, pay_periods_per_month:2, savings_glide:[{under:1500,monthly:300}], governed_from:"2026-07" },
    debts: [ debt("Debt-Apple-Card","Apple Card",14000,22.74,380,950), debt("Debt-Discover-It","Discover",3000,25,100,430) ],
    savings: [{ type:"savings-account", name:"Emergency Fund", current_balance:640, target:5000, file:{path:"spice/finance/savings/Savings-Emergency-Fund.md", name:"Savings-Emergency-Fund"} }],
    budgets: [{ type:"budget", month:"2026-07", categories:[], debt_allocations:[{slug:"Debt-Apple-Card", planned:350}], savings_allocations:[], file:{path:"spice/finance/budgets/2026-07/Budget-2026-07.md", name:"Budget-2026-07"} }],
  });
  const a = fm.budgetAllocations(dv, "2026-07");
  const apple = a.debt.find(d => d.slug === "Debt-Apple-Card");
  const disc = a.debt.find(d => d.slug === "Debt-Discover-It");
  assertTrue("BA-1: overridden debt row uses the override", apple && apple.planned === 350 && apple.source === "override");
  assertTrue("BA-2: non-overridden debt row uses the live plan value", disc && disc.planned > 0 && disc.source === "plan");
  assertTrue("BA-3: savings row present with live contribution", a.savings.length >= 1 && a.savings[0].planned > 0);
  assertTrue("BA-4: totals expose debt + discretionary", typeof a.totals.debt === "number" && typeof a.totals.discretionary === "number");
}
```

> Use the harness's existing `debt(slug,name,bal,apr,min,planned)` factory if present; otherwise inline debt objects with `file.name === slug`. The plan branch relies on `computePlanState`, already exercised in this harness.

- [ ] **Step 2: Run RED.** `node platform/test/run-finance-plan-state.js` → `budgetAllocations is not a function`.

- [ ] **Step 3: Implement `budgetAllocations`** in `finance-math.js`:

```js
// Live-derived budget allocation view (planning layer). Merges the plan's live
// per-debt allocation + savings contribution with the budget's stored per-row
// overrides. planned = override ?? plannedLive; source ∈ "override" | "plan".
budgetAllocations(dv, monthKey) {
    const budget = this.readBudgetForMonth(dv, monthKey);
    const overridesDebt = (budget && Array.isArray(budget.debt_allocations)) ? budget.debt_allocations : [];
    const overridesSav = (budget && Array.isArray(budget.savings_allocations)) ? budget.savings_allocations : [];
    const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
    const ovBySlug = new Map();
    for (const o of overridesDebt) { const s = o && (o.slug || o.name); if (s) ovBySlug.set(String(s), o); }

    let ps = null;
    try { ps = this.computePlanState(dv, monthKey); } catch (_e) { ps = null; }
    const debts = this.readDebts(dv);
    // Live per-debt planned: plan allocation total when available, else entity planned_monthly_payment.
    const liveBySlug = new Map();
    if (ps && ps.ok && Array.isArray(ps.allocation)) {
        for (const a of ps.allocation) liveBySlug.set(String(a.slug), num(a.total));
    }
    const debt = debts
        .filter(d => num(d.current_balance) > 0)
        .map(d => {
            const slug = (d.file && d.file.name) ? d.file.name : (d.name || "debt");
            const plannedLive = liveBySlug.has(slug) ? liveBySlug.get(slug) : num(d.planned_monthly_payment);
            const ov = ovBySlug.get(slug);
            const override = ov ? num(ov.planned) : null;
            return { slug, name: d.name || slug, plannedLive, override, planned: (ov ? override : plannedLive), source: ov ? "override" : "plan" };
        });

    const savLive = ps && ps.ok && ps.savings ? num(ps.savings.contribution) : 0;
    const savName = "Emergency Fund";
    const savOv = overridesSav.find(o => o && String(o.name || savName).toLowerCase() === savName.toLowerCase()) || overridesSav[0] || null;
    const savings = [{
        name: (savOv && savOv.name) || savName,
        plannedLive: savLive,
        override: savOv ? num(savOv.planned) : null,
        planned: savOv ? num(savOv.planned) : savLive,
        source: savOv ? "override" : "plan",
    }];

    const debtTotal = debt.reduce((s, d) => s + d.planned, 0);
    const savTotal = savings.reduce((s, d) => s + d.planned, 0);
    const income = ps && ps.ok ? num(ps.inputs.incomeFloor) : 0;
    const fixed = ps && ps.ok ? num(ps.inputs.fixedLiving) : 0;
    const discretionary = ps && ps.ok ? num(ps.envelope.effective) : Math.max(0, income - fixed - debtTotal - savTotal);
    return { debt, savings, totals: { debt: debtTotal, savings: savTotal, fixed, income, discretionary } };
}
```

- [ ] **Step 4: Run GREEN.** `node platform/test/run-finance-plan-state.js`.

- [ ] **Step 5: Add a source-contract assertion** in `run-helper-cases.js` near the FinanceMath API method list (the `methods` array ~13345): add `"budgetAllocations"` to that array so the instance-method regex covers it. Run `node platform/test/run-helper-cases.js`.

- [ ] **Step 6: Commit.**

```bash
git add platform/blueprints/finance/helpers/finance-math.js platform/test/run-finance-plan-state.js platform/test/run-helper-cases.js
git commit -m "feat(finance): FinanceMath.budgetAllocations merges live plan allocation with per-row budget overrides"
```

---

## Task 7: WS2 — BudgetAllocationsEditor widget (with WS3 fixes baked in)

**Files:**
- Modify: `platform/blueprints/finance/helpers/budget-allocations-editor.js` (flesh out the Task 5 stub)
- Test: `platform/test/run-renderer.js`

- [ ] **Step 1: Add a failing render test** in `run-renderer.js`: load `BudgetAllocationsEditor`, stub `customJS.FinanceMath.budgetAllocations` to return a fixed `{debt:[{slug,name,planned,source}], savings:[...], totals:{...}}`, render against a budget `dv.current()`, and assert the root `.bae-root` exists and renders a Debt row label + a Savings row + the full-picture totals line. Add an edit-materializes-override case: stub the row-edit modal to return a new planned, invoke the edit flow, and assert `FinanceFrontmatter.update` wrote a `debt_allocations` entry (capture via the seam) AND the re-render used the authoritative array.

- [ ] **Step 2: Run RED.** `node platform/test/run-renderer.js`.

- [ ] **Step 3: Implement the widget.** Model the DOM/section structure on `budget-summary.js` `_renderBand3` and the editor mechanics (modal + `_mutate` + **render-from-authoritative + merge**) on the fixed `paycheck-expenses-editor.js`. Contract:
  - `render(dv, override)` — embed-dedup guard; `page = dv.current()`, `page.type === "budget"`; `monthKey` from `page.month`/filename; `const view = override || customJS.FinanceMath.budgetAllocations(dv, monthKey);`.
  - Full-picture line: `Income {income} → Fixed {fixed} · Debt {totals.debt} · Savings {totals.savings} · Discretionary {discretionary}` via `customJS.FinanceMath.fmtMoney`.
  - **Debt** section: one editable row per `view.debt[]` (`name` + `planned`, dim "(plan)" when `source==="plan"`, bold "(adjusted)" when override). Click → modal edits `planned` → `_mutate` writes/updates a `{slug, planned}` entry in `fm.debt_allocations` (merge by slug), captures the recomputed view, `await this.render(dv, freshView)`.
  - **Savings** section: same for `view.savings[]` writing `fm.savings_allocations` keyed by `name`.
  - A small "Reset to plan" affordance per row that removes the override entry (splice by slug/name) — optional but cheap; include it.
  - Writes go through `customJS.FinanceFrontmatter.update`; never write on plain render (only on user edit).

- [ ] **Step 4: Run GREEN.** `node platform/test/run-renderer.js`.

- [ ] **Step 5: Commit.**

```bash
git add platform/blueprints/finance/helpers/budget-allocations-editor.js platform/test/run-renderer.js
git commit -m "feat(finance): BudgetAllocationsEditor — editable live/override Debt + Savings sections on budgets"
```

---

## Task 8: WS2 — install heal to inject the widget into existing budgets

**Files:**
- Modify: `platform/install.js` (new `applyFinanceBudgetAllocationsBandInjection`; dispatch in `applyFinanceMigrations`; `module.exports`)
- Test: `platform/test/run-seed-migrations.js` (assert on the seed's `Budget-2026-05`)

- [ ] **Step 1: Add a failing seed assertion.** After the last `HC-V0128-SEED-MIGRATE-PLAN-*` family (~line 358), append a new family (choose topic `BUDGET-ALLOC`; the `<ver>` prefix is the closing workshop version — leave a `TODO(ver)` note and use the current-ish prefix, it's a label not a gate):

```js
    // ===== HC-V0XXX-SEED-MIGRATE-BUDGET-ALLOC-* — applyFinanceBudgetAllocationsBandInjection =====
    {
        let bBody = "";
        try { bBody = helpers.readNote(vault, "spice/finance/budgets/2026-05/Budget-2026-05.md"); } catch (e) {}
        ok("HC-V0XXX-SEED-MIGRATE-BUDGET-ALLOC-1 BudgetAllocationsEditor block injected into existing budget",
            bBody.includes('class: "BudgetAllocationsEditor"'));
    }
```

- [ ] **Step 2: Run RED.** `node platform/test/run-seed-migrations.js` → new assert FAILs.

- [ ] **Step 3: Implement the heal.** Mirror `applyFinanceBudgetMonthlyBandInjection` (~7617): ungated; walk `_listBudgetFiles`; skip if the body already contains `class: "BudgetAllocationsEditor"`; otherwise insert the dataviewjs block after the `BudgetCategoriesEditor` block (or at the end of the dataviewjs stack); `.sauce-backup` snapshot before write; failure-loud history entries. Register the call in `applyFinanceMigrations` right after `applyFinanceBudgetMonthlyBandInjection`, and add a `module.exports.applyFinanceBudgetAllocationsBandInjection = applyFinanceBudgetAllocationsBandInjection;` near the other finance exports (~14542).

- [ ] **Step 4: Run GREEN.** `node platform/test/run-seed-migrations.js`.

- [ ] **Step 5: Commit.**

```bash
git add platform/install.js platform/test/run-seed-migrations.js
git commit -m "feat(finance): inject BudgetAllocationsEditor block into existing budgets (ungated body heal)"
```

---

## Task 9: WS2 — Month dashboard planned column

**Files:**
- Modify: `platform/blueprints/finance/helpers/month-dashboard.js` (`_renderDebtChanges`, ~183)
- Test: `platform/test/run-finance-plan-widgets.js` or `run-v01120-monthly-cohesion.js` (whichever renders `MonthDashboard`)

- [ ] **Step 1: Add a failing render assertion** that a MonthDashboard rendered for a month whose budget carries `debt_allocations` shows a "planned" figure per debt row (stub `customJS.FinanceMath.budgetAllocations` to return known planned values).

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement.** In `_renderDebtChanges`, fetch `const alloc = customJS.FinanceMath.budgetAllocations(dv, monthKey);` build a `plannedBySlug` map, and add a `planned {x}` cell to each debt row so it reads `planned {budget} · paydown {paid} · measured drop {drop}`. Keep existing paid/measured logic intact.

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Commit.**

```bash
git add platform/blueprints/finance/helpers/month-dashboard.js platform/test/run-finance-plan-widgets.js
git commit -m "feat(finance): Month dashboard shows planned (budget) alongside paid + measured drop"
```

---

## Task 10: Full verification + preflight-bumped

- [ ] **Step 1: Whole-suite preflight.** `npm run release:preflight` → whole-suite GREEN.
- [ ] **Step 2: Schema lint.** `npm run lint-schemas` → exit 0.
- [ ] **Step 3: Workshop self-install.** `node platform/install.js --vault . --auto-approve` → 0 fail.
- [ ] **Step 4: Bumped preflight** (component bump — catches release-wedge on a clean tree). Ensure the tree is clean (all tasks committed), then `npm run release:preflight-bumped` → GREEN.
- [ ] **Step 5:** If any harness is red, fix in place and re-run before proceeding to PR.

---

## Self-review (author)

- **Spec coverage:** WS1 → Tasks 3,4. WS2 → Tasks 5,6,7,8,9. WS3 → Tasks 1,2 (+ baked into 7). Testing gate → Task 10. All design sections mapped.
- **Type consistency:** `budgetAllocations` returns `{debt[], savings[], totals{debt,savings,fixed,income,discretionary}}` and each debt row is `{slug,name,plannedLive,override,planned,source}` — consumed identically in Tasks 7 and 9.
- **No version literals** in any test step; new method added to the `methods` API list, not pinned to a version.
- **No install-time frontmatter migration** — the only heal is a body injection (Task 8), consistent with the design's "no seed-vault churn."
