# Finance Correctness Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four finance-system correctness gaps — `credit_limit` missing from the new-debt scaffold, three+ divergent payoff dates, coach-vs-badge "spent" drift, and stale repo meta — without changing the envelope/glide/avalanche math.

**Architecture:** A new `FinanceMath.projectedPayoff(dv, monthKey)` becomes the single canonical payoff source (plan-aware → entity → none precedence); every hub/per-debt payoff callsite routes to it. The scaffold and coach edits are localized; housekeeping regenerates derived docs.

**Tech Stack:** Obsidian customJS widgets (vanilla JS), node behavioral-harness tests (`platform/test/run-finance-plan-*.js`), manifest JSON, the auto-release pipeline (conventional commits only — no manual versioning).

---

## Working location

All work happens in the worktree:
`/Users/willfellhoelter/projects/repos/sauce/.worktrees/finance-correctness-pass`
on branch `cycle/finance-correctness-pass`. Paths below are relative to that root unless absolute.

## Conventions & guardrails (read once)

- **No manual versioning.** Do **not** edit `workshop_version`, `package.json` versions, per-component manifest `version`, seed-vault pins, or `ranch` pins; do **not** create tags or touch the release PR. Write `fix(finance):` / `test(finance):` / `docs:` conventional commits. The pipeline computes semver and ships.
- **No Claude commit trailer** in this repo (build-test-verify rule). Plain commit messages.
- **Do NOT hand-edit the seed-vault helper copies** under `platform/test/seed-vault/ranch/scripts/finance/`. They are a manual post-merge rebaseline artifact and are *already* behind source (e.g. `finance-math.js` there predates the planning layer) while preflight stays green — there is no source==seed equality assertion. On-branch `seed:rebaseline` is a known trap. If a seed test (`run-seed.js` / `run-seed-migrations.js`) goes red after these edits, STOP and reassess — do not rebaseline to make it pass.
  - *(This supersedes the design doc's "propagate to seed-vault copies" line, which was written before this was verified.)*
- **Verify before claiming done.** Each task ends by running the named command and confirming the printed pass count.

---

## Task 1: `credit_limit` in the new-debt scaffold (Fix 1)

**Files:**
- Test: `platform/test/run-finance-plan-state.js` (append a block before the final `console.log`)
- Modify: `platform/blueprints/finance/manifest.json` (the `new_entity_buttons[]` entry with `id: "debt"`, `frontmatter_template`)

- [ ] **Step 1: Write the failing test**

In `platform/test/run-finance-plan-state.js`, immediately **before** the final line
`console.log(\`\nrun-finance-plan-state.js: ${pass} passed, ${fail} failed\`);`, insert:

```js
// ===== HC-V0627-SCAFFOLD-* — new-debt scaffold carries credit_limit (Fix 1) =====
{
    const manifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, "../blueprints/finance/manifest.json"), "utf8"));
    const debtBtn = (manifest.new_entity_buttons || []).find(e => e && e.id === "debt");
    ok("HC-V0627-SCAFFOLD-1 debt new_entity_button exists",
        !!debtBtn, `ids=${(manifest.new_entity_buttons || []).map(e => e && e.id).join(",")}`);
    ok("HC-V0627-SCAFFOLD-2 debt scaffold includes credit_limit:0",
        !!debtBtn && debtBtn.frontmatter_template && debtBtn.frontmatter_template.credit_limit === 0,
        `got ${debtBtn && debtBtn.frontmatter_template && JSON.stringify(debtBtn.frontmatter_template.credit_limit)}`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-finance-plan-state.js`
Expected: FAIL line `FAIL HC-V0627-SCAFFOLD-2 debt scaffold includes credit_limit:0 — got undefined`, exit 1.

- [ ] **Step 3: Add `credit_limit` to the scaffold**

In `platform/blueprints/finance/manifest.json`, in the `new_entity_buttons[]` entry whose
`frontmatter_template.type` is `"debt"`, add `"credit_limit": 0` between `"min_payment": 0,`
and `"planned_monthly_payment": 0,`. The block becomes:

```json
        "type": "debt",
        "kind": "{{prompts.kind}}",
        "name": "{{prompts.name}}",
        "current_balance": 0,
        "apr": 0,
        "min_payment": 0,
        "credit_limit": 0,
        "planned_monthly_payment": 0,
        "balance_history": [],
        "created_at": "{{now.YYYY-MM-DDTHH:mm:ssZ}}",
        "cssclasses": [
          "wide"
        ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-finance-plan-state.js`
Expected: PASS; summary line `run-finance-plan-state.js: 53 passed, 0 failed` (was 51; +2). Exit 0.

- [ ] **Step 5: Confirm valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/finance/manifest.json','utf8')); console.log('manifest JSON ok')"`
Expected: `manifest JSON ok`

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/finance/manifest.json platform/test/run-finance-plan-state.js
git commit -m "fix(finance): new-debt scaffold seeds credit_limit so CC paydown chip renders"
```

---

## Task 2: `FinanceMath.projectedPayoff` — the canonical payoff source (Fix 2a)

**Files:**
- Test: `platform/test/run-finance-plan-state.js`
- Modify: `platform/blueprints/finance/helpers/finance-math.js` (add a method on the `FinanceMath` class)

- [ ] **Step 1: Write the failing tests**

In `platform/test/run-finance-plan-state.js`, **before** the final `console.log`, insert:

```js
// ===== HC-V0627-PAYOFF-* — projectedPayoff: one canonical source (Fix 2a) =====
{
    // Plan present + finite payoff → source "plan", equals computePlanState.payoff.
    const dvPlan = makeDv({
        plan: {}, debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 9000)],
    });
    const ps = fm.computePlanState(dvPlan, "2026-07");
    const ppPlan = fm.projectedPayoff(dvPlan, "2026-07");
    ok("HC-V0627-PAYOFF-1 plan branch → source plan", ppPlan.source === "plan", `got ${ppPlan.source}`);
    ok("HC-V0627-PAYOFF-2 plan branch zeroDebtDate == computePlanState",
        ppPlan.zeroDebtDate === ps.payoff.zeroDebtDate, `${ppPlan.zeroDebtDate} vs ${ps.payoff.zeroDebtDate}`);
    ok("HC-V0627-PAYOFF-3 killOrder slug matches a debt file.name",
        Array.isArray(ppPlan.killOrder) && ppPlan.killOrder.length > 0 &&
        ppPlan.killOrder.every(k => /^Debt-/.test(k.slug)));
    ok("HC-V0627-PAYOFF-4 carries money figures", ppPlan.totalBalance > 0 && ppPlan.weightedApr > 0);

    // No plan → source "entities", equals debtTotals.
    const dvNoPlan = makeDv({ plan: null, debts: HEADSPACE_DEBTS });
    const dt = fm.debtTotals(HEADSPACE_DEBTS);
    const ppEnt = fm.projectedPayoff(dvNoPlan, "2026-07");
    ok("HC-V0627-PAYOFF-5 no-plan → source entities", ppEnt.source === "entities", `got ${ppEnt.source}`);
    ok("HC-V0627-PAYOFF-6 entity branch zeroDebtDate == debtTotals",
        ppEnt.zeroDebtDate === dt.zeroDebtDate, `${ppEnt.zeroDebtDate} vs ${dt.zeroDebtDate}`);

    // No debts → source "none".
    const dvNoDebts = makeDv({ plan: null, debts: [] });
    const ppNone = fm.projectedPayoff(dvNoDebts, "2026-07");
    ok("HC-V0627-PAYOFF-7 no-debts → source none + dash",
        ppNone.source === "none" && ppNone.zeroDebtDate === "—", `${ppNone.source}/${ppNone.zeroDebtDate}`);
}
```

> Note: `HEADSPACE_DEBTS` uses `planned_monthly_payment: min` (the fixture builder), so `debtTotals` sees attack == minimums (no extra), giving a finite entity-branch payoff. `makeDv({plan:{}})` yields a full default plan via the `plan()` fixture builder.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node platform/test/run-finance-plan-state.js`
Expected: FAIL — `fm.projectedPayoff is not a function` surfaces as failing `HC-V0627-PAYOFF-*` lines (or a thrown error), exit 1.

- [ ] **Step 3: Implement `projectedPayoff`**

In `platform/blueprints/finance/helpers/finance-math.js`, add this method to the `FinanceMath`
class. Place it immediately **after** the `debtTotals(debts) { ... }` method (it depends on
`debtTotals`, `readDebts`, `computePlanState`, `simulateAvalanche`, all defined on the class):

```js
    // One canonical payoff source so every widget agrees. Precedence:
    //   plan-aware (computePlanState honors floor + attack + freed savings + override)
    //   → entity-planned (debtTotals + sim over each debt's planned_monthly_payment)
    //   → none (no debts with a balance).
    // Returns the money figures + canonical { zeroDebtDate, months, killOrder, source }.
    // killOrder[].slug === the Debt note's file.name (e.g. "Debt-Apple-Card").
    projectedPayoff(dv, monthKey) {
        const debts = this.readDebts(dv);
        const totals = this.debtTotals(debts);
        const base = {
            totalBalance: totals.totalBalance,
            monthlyInterest: totals.monthlyInterest,
            plannedAttack: totals.plannedAttack,
            weightedApr: totals.weightedApr,
        };
        const active = debts.filter(d => (Number(d.current_balance) || 0) > 0);
        if (active.length === 0) {
            return Object.assign(base, { zeroDebtDate: "—", months: Infinity, killOrder: [], source: "none" });
        }
        // Plan branch — prefer the plan-aware payoff when a finite plan payoff exists.
        let ps = null;
        try { ps = this.computePlanState(dv, monthKey); } catch (_e) { ps = null; }
        if (ps && ps.ok && ps.payoff && isFinite(ps.payoff.months)) {
            return Object.assign(base, {
                zeroDebtDate: ps.payoff.zeroDebtDate,
                months: ps.payoff.months,
                killOrder: ps.payoff.killOrder || [],
                source: "plan",
            });
        }
        // Entity branch — same inputs debtTotals uses: planned attack minus active minimums.
        const minsSum = active.reduce((s, d) => s + (Number(d.min_payment) || 0), 0);
        const sim = this.simulateAvalanche(debts, Math.max(0, totals.plannedAttack - minsSum));
        return Object.assign(base, {
            zeroDebtDate: sim.zeroDebtDate,
            months: sim.months,
            killOrder: sim.killOrder || [],
            source: "entities",
        });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-finance-plan-state.js`
Expected: PASS; summary `run-finance-plan-state.js: 60 passed, 0 failed` (53 + 7). Exit 0.

- [ ] **Step 5: Cold-load lint stays clean**

Run: `node scripts/lint-cold-load.js`
Expected: `ok lint-cold-load: <N> file(s) scanned; no violations.`

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/finance/helpers/finance-math.js platform/test/run-finance-plan-state.js
git commit -m "feat(finance): projectedPayoff — single canonical payoff source (plan→entity→none)"
```

---

## Task 3: Route the Finance hub hero + Debts hub through `projectedPayoff` (Fix 2b)

**Files:**
- Test: `platform/test/run-finance-plan-widgets.js`
- Modify: `platform/blueprints/finance/helpers/finance-hub-summary.js:55-72` (hero)
- Modify: `platform/blueprints/finance/helpers/debts-hub-summary.js:34-52` (Band-1 totals)

- [ ] **Step 1: Write the failing test**

In `platform/test/run-finance-plan-widgets.js`, **before** the final
`console.log(\`\nrun-finance-plan-widgets.js: ...\`)` (inside the async IIFE), insert:

```js
        // ===== HC-V0627-WIDGET-PAYOFF-* — hub hero + Debts hub agree, via projectedPayoff =====
        const HERO_FHS = loadClass("finance-hub-summary.js", "FinanceHubSummary", env);
        const DHS = loadClass("debts-hub-summary.js", "DebtsHubSummary", env);
        const _now = new Date();
        const NM = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;
        const expected = fm.projectedPayoff(makeDv(ALL, null), NM).zeroDebtDate;
        ok("HC-V0627-WIDGET-PAYOFF-0 expected date is iso (sanity)", /^\d{4}-\d{2}-\d{2}$/.test(expected), expected);

        const heroPage = { type: "finance-hub", file: { path: "spice/finance/Finance.md", name: "Finance" } };
        const heroDv = makeDv([...ALL, heroPage], heroPage);
        let heroErr = null;
        try { await new HERO_FHS().render(heroDv); } catch (e) { heroErr = e; }
        ok("HC-V0627-WIDGET-PAYOFF-1 hero renders without throwing", heroErr === null, heroErr && heroErr.message);
        ok("HC-V0627-WIDGET-PAYOFF-2 hero shows the canonical zero-debt date",
            treeText(heroDv.container).includes(expected), `expected ${expected}`);

        const debtsHubPage = { type: "debt-hub", file: { path: "spice/finance/debts/Debts.md", name: "Debts" } };
        const dhsDv = makeDv([...ALL, debtsHubPage], debtsHubPage);
        let dhsErr = null;
        try { await new DHS().render(dhsDv); } catch (e) { dhsErr = e; }
        ok("HC-V0627-WIDGET-PAYOFF-3 Debts hub renders without throwing", dhsErr === null, dhsErr && dhsErr.message);
        ok("HC-V0627-WIDGET-PAYOFF-4 Debts hub shows the SAME zero-debt date as the hero",
            treeText(dhsDv.container).includes(expected), `expected ${expected}`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-finance-plan-widgets.js`
Expected: FAIL `HC-V0627-WIDGET-PAYOFF-4` (Debts hub still uses the naive `Math.ceil`, so its date differs from the plan-aware hero), exit 1.

- [ ] **Step 3: Route the hero through `projectedPayoff`**

In `platform/blueprints/finance/helpers/finance-hub-summary.js`, in `_renderHero(root, dv)`,
replace line 72:

```js
        const totals = customJS.FinanceMath.debtTotals(debts);
```

with:

```js
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const totals = customJS.FinanceMath.projectedPayoff(dv, monthKey);
```

(Everything downstream — `totals.totalBalance`, `totals.zeroDebtDate`, `totals.weightedApr`,
`totals.plannedAttack`, `totals.monthlyInterest` — is unchanged: `projectedPayoff` returns the
same field names.)

- [ ] **Step 4: Route the Debts hub Band-1 totals through `projectedPayoff`**

In `platform/blueprints/finance/helpers/debts-hub-summary.js`, replace the block at lines
34-52 (from `// ----- Compute totals -----` through the `zeroDate` computation, i.e. the
inline reduces and the naive `Math.ceil` payoff):

```js
        // ----- Compute totals -----
        const totalBal = debts.reduce((s, d) => s + (Number(d.current_balance) || 0), 0);
        const totalInterest = debts.reduce((s, d) =>
            s + ((Number(d.current_balance) || 0) * (Number(d.apr) || 0) / 100 / 12), 0);
        const totalPlanned = debts.reduce((s, d) => s + (Number(d.planned_monthly_payment) || 0), 0);

        // Weighted-avg APR = Σ(balance * apr) / Σ(balance)
        const weightedAprNumer = debts.reduce((s, d) =>
            s + (Number(d.current_balance) || 0) * (Number(d.apr) || 0), 0);
        const wAvgApr = totalBal > 0 ? weightedAprNumer / totalBal : 0;

        let zeroDate = "—";
        const principalAttack = totalPlanned - totalInterest;
        if (principalAttack > 0 && totalBal > 0) {
            const months = Math.ceil(totalBal / principalAttack);
            const d = new Date();
            d.setMonth(d.getMonth() + months);
            zeroDate = d.toISOString().slice(0, 10);
        }
```

with:

```js
        // ----- Compute totals (canonical payoff source so this hub == the Finance hub) -----
        const _now = new Date();
        const _monthKey = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;
        const pp = customJS.FinanceMath.projectedPayoff(dv, _monthKey);
        const totalBal = pp.totalBalance;
        const totalInterest = pp.monthlyInterest;
        const totalPlanned = pp.plannedAttack;
        const wAvgApr = pp.weightedApr;
        const zeroDate = pp.zeroDebtDate;
```

(The `mk(...)` calls at lines 69-73 already read `totalBal` / `totalInterest` / `totalPlanned`
/ `wAvgApr` / `zeroDate`, and Bands 2-3 still use the `debts` array read at line 23 — leave
those untouched.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node platform/test/run-finance-plan-widgets.js`
Expected: PASS; summary `run-finance-plan-widgets.js: 37 passed, 0 failed` (32 + 5). Exit 0.

- [ ] **Step 6: Cold-load lint + render-safe stay clean**

Run: `node scripts/lint-cold-load.js && node platform/test/run-render-safe.js`
Expected: `no violations` + `run-render-safe: 5 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/finance/helpers/finance-hub-summary.js platform/blueprints/finance/helpers/debts-hub-summary.js platform/test/run-finance-plan-widgets.js
git commit -m "fix(finance): Finance hub hero + Debts hub read projectedPayoff so payoff dates agree"
```

---

## Task 4: `DebtSummary` per-debt payoff from the avalanche killOrder (Fix 2c)

**Files:**
- Test: `platform/test/run-finance-plan-widgets.js`
- Modify: `platform/blueprints/finance/helpers/debt-summary.js:58-67` (the payoff block)

- [ ] **Step 1: Write the failing test**

In `platform/test/run-finance-plan-widgets.js`, **before** the final `console.log`, insert
(after the Task-3 block):

```js
        // ===== HC-V0627-WIDGET-DEBTSUM-* — per-debt payoff comes from the killOrder =====
        const DSUM = loadClass("debt-summary.js", "DebtSummary", env);
        const applePage = DEBTS.find(d => d.file.name === "Debt-Apple-Card");
        const ko = fm.projectedPayoff(makeDv(ALL, null), NM).killOrder.find(k => k.slug === "Debt-Apple-Card");
        ok("HC-V0627-WIDGET-DEBTSUM-0 killOrder has Apple (sanity)", !!ko && /^\d{4}-\d{2}-\d{2}$/.test(ko.date), JSON.stringify(ko));
        const dsumDv = makeDv([...ALL], applePage);
        let dsumErr = null;
        try { await new DSUM().render(dsumDv); } catch (e) { dsumErr = e; }
        ok("HC-V0627-WIDGET-DEBTSUM-1 DebtSummary renders without throwing", dsumErr === null, dsumErr && dsumErr.message);
        ok("HC-V0627-WIDGET-DEBTSUM-2 per-debt payoff shows the killOrder date",
            treeText(dsumDv.container).includes(ko.date), `expected ${ko && ko.date}`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-finance-plan-widgets.js`
Expected: FAIL `HC-V0627-WIDGET-DEBTSUM-2` (DebtSummary still shows the isolation date, not the killOrder date), exit 1.

- [ ] **Step 3: Implement the killOrder lookup**

In `platform/blueprints/finance/helpers/debt-summary.js`, replace lines 58-67 (the
`if (principalAttack <= 0) { ... } else { ...naive payoff... }` block):

```js
        if (principalAttack <= 0) {
            const warnEl = b1.createEl("div");
            warnEl.textContent = "Increase planned monthly attack — below interest";
            warnEl.style.cssText = "flex: 1 0 100%; font-size: 0.85em; color: #dc2626; margin-top: 4px;";
        } else {
            const months = Math.ceil(balance / principalAttack);
            const eta = new Date();
            eta.setMonth(eta.getMonth() + months);
            mk("PROJECTED PAYOFF", `${months}mo (${eta.toISOString().slice(0, 10)})`);
        }
```

with:

```js
        // Per-debt payoff comes from the canonical avalanche kill order (accounts for the roll
        // of freed minimums), not this card in isolation. Fall back to the isolation estimate
        // only when this debt isn't in the kill order (e.g. no plan + below-interest).
        const _now = new Date();
        const _monthKey = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;
        let _ko = null;
        try {
            const _pp = customJS.FinanceMath.projectedPayoff(dv, _monthKey);
            _ko = (_pp && Array.isArray(_pp.killOrder))
                ? _pp.killOrder.find(k => k.slug === (page.file && page.file.name)) : null;
        } catch (_e) { _ko = null; }
        if (_ko && _ko.date) {
            const eta = new Date(_ko.date + "T00:00:00Z");
            const today = new Date();
            const months = Math.max(0,
                (eta.getUTCFullYear() - today.getFullYear()) * 12 + (eta.getUTCMonth() - today.getMonth()));
            mk("PROJECTED PAYOFF", `${months}mo (${_ko.date})`);
        } else if (principalAttack <= 0) {
            const warnEl = b1.createEl("div");
            warnEl.textContent = "Increase planned monthly attack — below interest";
            warnEl.style.cssText = "flex: 1 0 100%; font-size: 0.85em; color: #dc2626; margin-top: 4px;";
        } else {
            const months = Math.ceil(balance / principalAttack);
            const eta = new Date();
            eta.setMonth(eta.getMonth() + months);
            mk("PROJECTED PAYOFF", `${months}mo (${eta.toISOString().slice(0, 10)})`);
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-finance-plan-widgets.js`
Expected: PASS; summary `run-finance-plan-widgets.js: 40 passed, 0 failed` (37 + 3). Exit 0.

- [ ] **Step 5: Cold-load lint stays clean**

Run: `node scripts/lint-cold-load.js`
Expected: `no violations.`

- [ ] **Step 6: Update the DebtSummary header comment**

In `debt-summary.js`, update the `Math:` comment block (around lines 13-16) so it documents the
new behavior — replace the `payoffMonths = Math.ceil(...)` line with:

```js
 *   payoff: per-debt date from FinanceMath.projectedPayoff().killOrder (avalanche roll),
 *           with isolation Math.ceil(balance / (planned - monthlyInterest)) as fallback.
```

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/finance/helpers/debt-summary.js platform/test/run-finance-plan-widgets.js
git commit -m "fix(finance): per-debt payoff date follows the avalanche kill order, not isolation"
```

---

## Task 5: Coach reads synced budget actuals once governed (Fix 3 — local skill)

**Files (user-global, OUTSIDE the repo/worktree):**
- Modify: `/Users/willfellhoelter/.claude/skills/finance/references/map.md`
- Audit/align: `/Users/willfellhoelter/.claude/skills/finance/references/{status,weekly-check,reconcile,monthly-plan}.md`

> This skill is not part of the sauce release pipeline. There are no node tests; verification is
> re-reading + a consistency check across the guides. Do NOT commit these into the sauce repo.

- [ ] **Step 1: Confirm whether the skill dir is its own git repo**

Run: `git -C /Users/willfellhoelter/.claude/skills/finance rev-parse --is-inside-work-tree 2>/dev/null || echo "not a git repo"`
Note the result — if it's a repo, commit there at the end of this task; if not, edits stand as plain files.

- [ ] **Step 2: Add the freshness-conditional branch to `map.md`**

In `/Users/willfellhoelter/.claude/skills/finance/references/map.md`, in the "Computing the
discretionary envelope" section, immediately **after** the existing `**Critical:**` paragraph
(the one ending "...no next-month overage penalty applies to a month the system didn't
govern."), append a new paragraph:

```markdown
**Once a governed month is synced, trust the budget.** For a **governed** month
(`month >= governed_from`) whose `Budget-<month>.md` has `actuals_source: copilot` **and** a
fresh `actuals_synced_at` (within 8 days — the same window the hub's "live" badge uses), the
budget `categories[].actual` fields **are** authoritative: read "spent" from them, because that
is exactly what the on-hub freshness badge shows and reading Copilot live would disagree.
**Otherwise** (ungoverned month, `actuals_source` not `copilot`, or a stale/absent
`actuals_synced_at`) compute "spent" from the Copilot categories as above — and say which
source you used so the number is never ambiguous.
```

- [ ] **Step 3: Align the route guides**

For each of `status.md`, `weekly-check.md`, `reconcile.md`, `monthly-plan.md` in
`/Users/willfellhoelter/.claude/skills/finance/references/`: read it; wherever it tells the
coach to compute "spent"/actuals from Copilot (and to ignore the budget `actual` fields), add a
one-line pointer so it does not contradict `map.md`:

```markdown
> Source of "spent": for a governed month with a fresh `actuals_source: copilot` sync, read the
> budget `actual` fields (matches the hub badge); otherwise read Copilot live. See `map.md`.
```

Only add the pointer where a "spent"/actuals instruction already exists — do not invent new
sections. If a guide has no such instruction, leave it unchanged and note that in Step 4.

- [ ] **Step 4: Verify consistency**

Run: `grep -rn "actuals_synced_at\|actuals_source\|budget .*actual\|Copilot categories" /Users/willfellhoelter/.claude/skills/finance/references/`
Confirm every guide that mentions a "spent" source now points at the same freshness-conditional
rule. List which guides were edited and which had no relevant instruction.

- [ ] **Step 5: Commit (only if Step 1 said it's a git repo)**

```bash
# Only if /Users/willfellhoelter/.claude/skills/finance is a git work tree:
git -C /Users/willfellhoelter/.claude/skills/finance add references/
git -C /Users/willfellhoelter/.claude/skills/finance commit -m "docs(finance-coach): trust synced budget actuals on governed months (match hub badge)"
```

If it is not a git repo, state that the edits are saved as plain files and no commit was made.

---

## Task 6: Housekeeping — cycle-status + untracked handoff doc (Fix 6)

**Files:**
- Modify (generated): `Docs/agent-guides/cycle-status.md`, `Docs/cycle-history.md`
- Resolve: `Docs/prompts/2026-06-17-breadcrumb-mechanism-handoff.md` (untracked)

- [ ] **Step 1: Regenerate cycle-status**

Run: `node scripts/regen-cycle-status.js 2>&1 | tail -20` (or `npm run` the equivalent if the
package script differs — check `node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>/cycle|status/.test(k)).join(','))"` first).
Expected: the script rewrites `Docs/agent-guides/cycle-status.md` to workshop `0.135.0` + current catalogue. Inspect the diff:

Run: `git diff --stat Docs/agent-guides/cycle-status.md Docs/cycle-history.md`

- [ ] **Step 2: Sanity-check the regenerated content**

Run: `grep -n "Workshop version\|0.135.0\|0.131.0" Docs/agent-guides/cycle-status.md | head`
Expected: shows `0.135.0`, no stale `0.131.0` "Current" pointer. If the script does not exist or
does not update the version line, hand-edit only the stale `**Workshop version:**` / "Most
recent cycle" pointer lines to match `npm run status` output — do NOT touch any version *pins*.

- [ ] **Step 3: Resolve the untracked handoff doc**

Run: `head -40 Docs/prompts/2026-06-17-breadcrumb-mechanism-handoff.md`
Decide:
- If it is a genuine handoff/reference doc (matches the other `Docs/prompts/*` files in kind),
  `git add` it (commit in Step 4).
- If it is stale scratch with no lasting value, remove it: `git rm -f --quiet --ignore-unmatch Docs/prompts/2026-06-17-breadcrumb-mechanism-handoff.md` (it is untracked, so plain `rm` is fine) — but **only after** reporting its gist and confirming with the user, since deletion is irreversible.

Default if uncertain: **keep it** (commit it). Deleting needs an explicit OK.

- [ ] **Step 4: Commit**

```bash
git add Docs/agent-guides/cycle-status.md Docs/cycle-history.md
# plus: git add Docs/prompts/2026-06-17-breadcrumb-mechanism-handoff.md  (if keeping)
git commit -m "docs: refresh cycle-status to 0.135.0 + resolve untracked breadcrumb handoff"
```

---

## Task 7: Full preflight + finish the branch

- [ ] **Step 1: Run the full release preflight**

Run: `npm run release:preflight 2>&1 | tail -40`
Expected: every harness prints `0 failed`; final command exits 0. Pay attention to
`run-finance-plan-state` (60 passed), `run-finance-plan-widgets` (40 passed), `run-seed`,
`run-seed-migrations`, `lint-cold-load`, `lint-schemas`, `check-version-sync`.

- [ ] **Step 2: If `run-seed`/`run-seed-migrations` fail**

Do NOT rebaseline on-branch. Re-read the failure: if it references a finance helper the seed
copy lacks, STOP and report — the seed-copy strategy needs a decision, not an on-branch
rebaseline. (Per the guardrails, source helper edits should not break these because there is no
source==seed equality assertion; a failure here is a signal something else is wrong.)

- [ ] **Step 3: Confirm the working tree is clean and on the right branch**

Run: `git -C /Users/willfellhoelter/projects/repos/sauce/.worktrees/finance-correctness-pass status --short && git branch --show-current`
Expected: clean tree (or only intended changes), branch `cycle/finance-correctness-pass`.

- [ ] **Step 4: Verify no manual versioning crept in**

Run: `git diff main --stat | grep -iE "package\.json|workshop_version|manifest\.json.*version|subscription|ranch" || echo "no version/pin files touched (good)"`
Expected: the only `manifest.json` change is the `credit_limit` scaffold line (no `version`
field change). If a `version`/pin/`package.json` shows up, revert it — the pipeline owns it.

- [ ] **Step 5: Hand off via finishing-a-development-branch**

Invoke the `superpowers:finishing-a-development-branch` skill to choose how to integrate
(PR vs merge to `main`). Per repo convention this cycle merges to `main` as conventional
commits and the auto-release pipeline takes over (computes semver, opens + auto-merges the
release PR, tags, ships to brew). Confirm with the user before pushing/merging.

---

## Self-review (completed by plan author)

- **Spec coverage:** Fix 1 → Task 1. Fix 2a → Task 2. Fix 2b → Task 3. Fix 2c → Task 4. Fix 3 → Task 5. Fix 6 → Task 6. Tests/preflight/shipping → woven through + Task 7. ✓
- **Seed-vault note:** plan explicitly corrects the spec's "propagate to seed" line with the verified no-equality-assertion reality. ✓
- **Type/name consistency:** `projectedPayoff` returns `{ totalBalance, monthlyInterest, plannedAttack, weightedApr, zeroDebtDate, months, killOrder, source }` in Task 2; Tasks 3-4 consume exactly those names; `killOrder[].slug`/`.date` consistent with `simulateAvalanche` (finance-math.js:293) and `page.file.name`. ✓
- **No placeholders:** every code/edit step shows full before/after; every run step has an exact command + expected output. ✓
- **Expected counts** (51 baseline → +2 Task1 → +7 Task2 = 60 state; 32 baseline → +5 Task3 → +3 Task4 = 40 widgets) are arithmetic estimates; the real gate is `0 failed`, not the exact total.
