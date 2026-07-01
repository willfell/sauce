#!/usr/bin/env node
/*
 * run-finance-plan-state.js — behavioral harness for FinanceMath.computePlanState (finance v0.10.0).
 * Loads finance-math.js into a sandbox, instantiates, exercises the allocation engine against
 * minimal Dataview stubs. Asserts the lever/glide/overflow/avalanche/what-if contract that
 * replaces the headspace hand-built system. Family: HC-V0128-PLANSTATE-*.
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
    path.join(__dirname, "../blueprints/finance/helpers/finance-math.js"), "utf8");
// eslint-disable-next-line no-eval
const FinanceMath = eval(`(function () { ${SRC}\n; return FinanceMath; })()`);
const fm = new FinanceMath();

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`  FAIL ${label}`); } };
const near = (a, b, eps = 0.5) => Math.abs(Number(a) - Number(b)) <= eps;

// ---- fixture builders ----
function debt(name, balance, apr, min) {
    return { type: "debt", name, current_balance: balance, apr, min_payment: min, planned_monthly_payment: min,
        file: { path: `spice/finance/debts/Debt-${name}.md`, name: `Debt-${name}` } };
}
const HEADSPACE_DEBTS = [
    debt("Cap1-Platinum", 7643.93, 28.74, 285),
    debt("Discover-It", 15839.84, 24.74, 430),
    debt("SCHEELS-Signature", 11704.69, 24.24, 235),
    debt("Apple-Card", 14551.55, 22.74, 380),
];
function savingsAcct(balance, target) {
    return { type: "savings-account", name: "Emergency Fund", current_balance: balance, target,
        file: { path: "spice/finance/savings/Savings-Emergency-Fund.md", name: "Savings-Emergency-Fund" } };
}
function budget(monthKey, plannedTotal) {
    // single category carrying the whole planned total keeps the sum exact
    return { type: "budget", month: monthKey, categories: [{ group: "Discretionary", name: "All", planned: plannedTotal, actual: 0 }],
        file: { path: `spice/finance/budgets/${monthKey}/Budget-${monthKey}.md`, name: `Budget-${monthKey}` } };
}
function paycheck(start, amount) {
    return { type: "paycheck", pay_period_start: start, pay_period_end: start, paycheck_amount: amount, expenses: [],
        file: { path: `spice/finance/paychecks/${start}/Paycheck-${start}.md`, name: `Paycheck-${start}` } };
}
function plan(overrides) {
    return Object.assign({
        type: "finance-plan",
        income_floor: 9000,
        fixed_living_monthly: 3851,
        attack_above_minimums: 570,
        pay_periods_per_month: 2,
        roll_freed_savings_to_attack: true,
        savings_glide: [
            { under: 1500, monthly: 300 },
            { under: 3500, monthly: 150 },
            { at_or_above: 3500, monthly: 0 },
        ],
        overflow: { attack_pct: 80, flex_pct: 20 },
        lever_order: ["discretionary", "savings", "attack"],
        avalanche_order_by: "apr",
        file: { path: "spice/finance/Finance Plan.md", name: "Finance Plan" },
    }, overrides || {});
}
function arr(a) { return { where: (fn) => arr(a.filter(fn)), array: () => a }; }
function makeDv(cfg) {
    const planPage = cfg.plan === null ? null : plan(cfg.plan);
    const debts = cfg.debts || [];
    const savings = cfg.savings || [];
    const budgets = cfg.budgets || [];
    const paychecks = cfg.paychecks || [];
    const all = [].concat(planPage ? [planPage] : [], debts, savings, budgets, paychecks);
    const byPath = {
        '"spice/finance"': all,
        '"spice/finance/debts"': debts,
        '"spice/finance/savings"': savings,
        '"spice/finance/budgets"': budgets,
        '"spice/finance/paychecks"': paychecks,
    };
    return { pages: (p) => arr(byPath[p] || []) };
}

// ===== HC-V0128-PLANSTATE-BASE-* — headspace baseline (month-1 Apple override active) =====
{
    const dv = makeDv({
        plan: { attack_target_override: { debt: "[[Debt-Apple-Card]]", until_balance_below: 13950 } },
        debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 9000)],
    });
    const ps = fm.computePlanState(dv, "2026-07");
    ok("HC-V0128-PLANSTATE-BASE-1 ok", ps.ok === true);
    ok("HC-V0128-PLANSTATE-BASE-2 envelope.base 2949", near(ps.envelope.base, 2949));
    ok("HC-V0128-PLANSTATE-BASE-3 minimums 1330", near(ps.inputs.minimums, 1330));
    ok("HC-V0128-PLANSTATE-BASE-4 savings tier1/300", ps.savings.tier === 1 && near(ps.savings.contribution, 300));
    ok("HC-V0128-PLANSTATE-BASE-5 attack.total 570", near(ps.attack.total, 570));
    ok("HC-V0128-PLANSTATE-BASE-6 envelope.left = effective - 0", near(ps.envelope.left, ps.envelope.effective));
    const apple = ps.allocation.find(a => a.slug === "Debt-Apple-Card");
    const cap1 = ps.allocation.find(a => a.slug === "Debt-Cap1-Platinum");
    ok("HC-V0128-PLANSTATE-BASE-7 override targets Apple", apple && apple.isTarget === true && near(apple.total, 950));
    ok("HC-V0128-PLANSTATE-BASE-8 Cap1 min-only", cap1 && cap1.isTarget === false && near(cap1.total, 285));
    ok("HC-V0128-PLANSTATE-BASE-9 overflow null at floor", ps.overflow === null);
    ok("HC-V0128-PLANSTATE-BASE-10 payoff converges", isFinite(ps.payoff.months) && ps.payoff.months > 0 && ps.payoff.months < 600);
    ok("HC-V0128-PLANSTATE-BASE-11 zeroDebtDate iso", /^\d{4}-\d{2}-\d{2}$/.test(ps.payoff.zeroDebtDate));
    ok("HC-V0128-PLANSTATE-BASE-12 applyPlan savingsPerCheck 150", near(ps.applyPlan.savingsPerCheck, 150));
    ok("HC-V0128-PLANSTATE-BASE-13 whatIf finite", isFinite(ps.whatIf.skipAttackThisMonth.weeksSlipped) && ps.whatIf.skipAttackThisMonth.weeksSlipped >= 0);
    // Avalanche rolls freed minimums (total outlay held constant) → payoff ~39mo on the
    // $49.7k/$1900 headspace shape. A regression to the no-roll model jumps to ~53mo.
    ok("HC-V0128-PLANSTATE-BASE-14 payoff rolls freed minimums (~34-44 mo, not ~53)",
        ps.payoff.months >= 34 && ps.payoff.months <= 44, `got ${ps.payoff.months}`);
}

// ===== HC-V0128-PLANSTATE-TIER-* — glide tiers + freed-rolls-to-attack keeps envelope constant =====
function tierCase(balance) {
    const dv = makeDv({ plan: {}, debts: HEADSPACE_DEBTS, savings: [savingsAcct(balance, 5000)],
        budgets: [budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 9000)] });
    return fm.computePlanState(dv, "2026-07");
}
{
    const t1 = tierCase(1499);
    ok("HC-V0128-PLANSTATE-TIER-1 <1500 → tier1/300", t1.savings.tier === 1 && near(t1.savings.contribution, 300));
    ok("HC-V0128-PLANSTATE-TIER-2 tier1 freed 0 attack 570", near(t1.attack.freed, 0) && near(t1.attack.total, 570));
    ok("HC-V0128-PLANSTATE-TIER-3 tier1 envelope 2949", near(t1.envelope.base, 2949));
    const t2 = tierCase(1500);
    ok("HC-V0128-PLANSTATE-TIER-4 1500 → tier2/150", t2.savings.tier === 2 && near(t2.savings.contribution, 150));
    ok("HC-V0128-PLANSTATE-TIER-5 tier2 freed 150 attack 720", near(t2.attack.freed, 150) && near(t2.attack.total, 720));
    ok("HC-V0128-PLANSTATE-TIER-6 tier2 envelope STILL 2949", near(t2.envelope.base, 2949));
    const t3 = tierCase(3500);
    ok("HC-V0128-PLANSTATE-TIER-7 3500 → tier3/0", t3.savings.tier === 3 && near(t3.savings.contribution, 0));
    ok("HC-V0128-PLANSTATE-TIER-8 tier3 freed 300 attack 870", near(t3.attack.freed, 300) && near(t3.attack.total, 870));
    ok("HC-V0128-PLANSTATE-TIER-9 tier3 envelope STILL 2949", near(t3.envelope.base, 2949));
}

// ===== HC-V0128-PLANSTATE-ROLL-* — paid-off card rolls target to next avalanche debt =====
{
    const rolled = HEADSPACE_DEBTS.map(d => d.file.name === "Debt-Cap1-Platinum" ? Object.assign({}, d, { current_balance: 0 }) : d);
    const dv = makeDv({ plan: {}, debts: rolled, savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 9000)] });
    const ps = fm.computePlanState(dv, "2026-07");
    const target = ps.allocation.find(a => a.isTarget);
    ok("HC-V0128-PLANSTATE-ROLL-1 Cap1 absent (paid off)", !ps.allocation.find(a => a.slug === "Debt-Cap1-Platinum"));
    ok("HC-V0128-PLANSTATE-ROLL-2 target rolled to Discover (next APR)", target && target.slug === "Debt-Discover-It");
    ok("HC-V0128-PLANSTATE-ROLL-3 minimums drop to 1045", near(ps.inputs.minimums, 1045));
}

// ===== HC-V0128-PLANSTATE-UNDERWATER-* — planned > effective flags over =====
{
    const dv = makeDv({ plan: {}, debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-07", 3120)], paychecks: [paycheck("2026-07-01", 9000)] });
    const ps = fm.computePlanState(dv, "2026-07");
    ok("HC-V0128-PLANSTATE-UNDERWATER-1 over 171", near(ps.envelope.over, 171));
    ok("HC-V0128-PLANSTATE-UNDERWATER-2 status over", ps.envelope.status === "over");
}

// ===== HC-V0128-PLANSTATE-OVERFLOW-* — income above floor → 80/20 split =====
{
    const dv = makeDv({ plan: {}, debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 10000)] });
    const ps = fm.computePlanState(dv, "2026-07");
    ok("HC-V0128-PLANSTATE-OVERFLOW-1 surplus 1000", ps.overflow && near(ps.overflow.surplus, 1000));
    ok("HC-V0128-PLANSTATE-OVERFLOW-2 toAttack 800", near(ps.overflow.toAttack, 800));
    ok("HC-V0128-PLANSTATE-OVERFLOW-3 toFlex 200", near(ps.overflow.toFlex, 200));
}

// ===== HC-V0128-PLANSTATE-CARRY-* — GOVERNED prior-month overspend shrinks effective envelope =====
{
    const prior = budget("2026-06", 2949); prior.categories[0].actual = 3100; // overspent its OWN $2949 plan by 151
    const dv = makeDv({ plan: { governed_from: "2026-06" }, debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [prior, budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 9000)] });
    const ps = fm.computePlanState(dv, "2026-07");
    ok("HC-V0128-PLANSTATE-CARRY-1 governed overageCarry 151 (spent − prior plan)", near(ps.envelope.overageCarry, 151));
    ok("HC-V0128-PLANSTATE-CARRY-2 effective = base − carry", near(ps.envelope.effective, ps.envelope.base - 151));
    ok("HC-V0128-PLANSTATE-CARRY-3 month flagged governed", ps.envelope.governed === true);
}

// ===== HC-V0128-PLANSTATE-BASELINE-* — pre-governed months must NOT carry (the −$5,126 bug) =====
{
    // May = pre-system baseline: planned $6,353, spent $11,024 (real old budget). governed_from July.
    const may = budget("2026-06", 6353.75); may.categories[0].actual = 11024.5;
    const dv = makeDv({ plan: { governed_from: "2026-07" }, debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [may, budget("2026-07", 0)], paychecks: [] });
    const ps = fm.computePlanState(dv, "2026-07");
    ok("HC-V0128-PLANSTATE-BASELINE-1 ungoverned prior → carry 0", ps.envelope.overageCarry === 0);
    ok("HC-V0128-PLANSTATE-BASELINE-2 effective = base (no bogus penalty)", near(ps.envelope.effective, ps.envelope.base));
    // current month BEFORE governed_from → not governed
    const dvB = makeDv({ plan: { governed_from: "2026-08" }, debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 9000)] });
    const psB = fm.computePlanState(dvB, "2026-07");
    ok("HC-V0128-PLANSTATE-BASELINE-3 month < governed_from → governed:false", psB.envelope.governed === false);
    // no governed_from at all → nothing governed, no carry
    const dvC = makeDv({ plan: {}, debts: HEADSPACE_DEBTS, savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-06", 2949), budget("2026-07", 2949)], paychecks: [] });
    const psC = fm.computePlanState(dvC, "2026-07");
    ok("HC-V0128-PLANSTATE-BASELINE-4 no governed_from → governed:false + carry 0", psC.envelope.governed === false && psC.envelope.overageCarry === 0);
}

// ===== HC-V0128-DEBTTOTALS-* — payoff unified onto the avalanche sim (not the flat estimate) =====
{
    const dtDebts = [
        { type: "debt", name: "Cap1-Platinum", current_balance: 7643.93, apr: 28.74, min_payment: 285, planned_monthly_payment: 855, file: { name: "Debt-Cap1-Platinum" } },
        { type: "debt", name: "Discover-It", current_balance: 15839.84, apr: 24.74, min_payment: 430, planned_monthly_payment: 430, file: { name: "Debt-Discover-It" } },
        { type: "debt", name: "SCHEELS", current_balance: 11704.69, apr: 24.24, min_payment: 235, planned_monthly_payment: 235, file: { name: "Debt-SCHEELS" } },
        { type: "debt", name: "Apple", current_balance: 14551.55, apr: 22.74, min_payment: 380, planned_monthly_payment: 380, file: { name: "Debt-Apple" } },
    ];
    const dt = fm.debtTotals(dtDebts);
    const sim = fm.simulateAvalanche(dtDebts, 1900 - 1330); // attack-above-mins = 570
    ok("HC-V0128-DEBTTOTALS-1 zeroDebtDate iso", /^\d{4}-\d{2}-\d{2}$/.test(dt.zeroDebtDate));
    ok("HC-V0128-DEBTTOTALS-2 debtTotals payoff == avalanche sim (unified)", dt.zeroDebtDate === sim.zeroDebtDate);
    ok("HC-V0128-DEBTTOTALS-3 payoff ~34-44 mo (rolled, not flat ~57)", sim.months >= 34 && sim.months <= 44, `got ${sim.months}`);
}

// ===== HC-V0128-PLANSTATE-DEGRADE-* — degrade gracefully =====
{
    const noPlan = fm.computePlanState(makeDv({ plan: null, debts: HEADSPACE_DEBTS }), "2026-07");
    ok("HC-V0128-PLANSTATE-DEGRADE-1 no-plan → ok:false", noPlan.ok === false && noPlan.reason === "no-plan");

    const noDebts = fm.computePlanState(makeDv({ plan: {}, debts: [], savings: [savingsAcct(639.94, 5000)],
        budgets: [budget("2026-07", 2949)], paychecks: [paycheck("2026-07-01", 9000)] }), "2026-07");
    ok("HC-V0128-PLANSTATE-DEGRADE-2 no-debts → allocation []", Array.isArray(noDebts.allocation) && noDebts.allocation.length === 0);
    ok("HC-V0128-PLANSTATE-DEGRADE-3 no-debts → payoff '—'", noDebts.payoff.zeroDebtDate === "—");

    const noFloor = fm.computePlanState(makeDv({ plan: { income_floor: 0 }, debts: HEADSPACE_DEBTS,
        savings: [savingsAcct(639.94, 5000)], budgets: [budget("2026-07", 3120)], paychecks: [] }), "2026-07");
    ok("HC-V0128-PLANSTATE-DEGRADE-4 floor 0 → over suppressed", noFloor.envelope.over === 0 && noFloor.envelope.status === "ok");
}

// ===== HC-V0128-FRESH-* — actualsFreshness badge math =====
{
    const NOW = Date.parse("2026-07-20T00:00:00Z");
    const govBudgetLive  = { type: "budget", month: "2026-07", actuals_synced_at: "2026-07-18T09:00:00Z", categories: [] };
    const govBudgetStale = { type: "budget", month: "2026-07", actuals_synced_at: "2026-06-25T09:00:00Z", categories: [] };
    const govBudgetTyped = { type: "budget", month: "2026-07", categories: [] };
    ok("HC-V0128-FRESH-1 recent sync → live",   fm.actualsFreshness(govBudgetLive,  "2026-07", "2026-07", NOW).state === "live");
    ok("HC-V0128-FRESH-2 old sync → stale",     fm.actualsFreshness(govBudgetStale, "2026-07", "2026-07", NOW).state === "stale");
    ok("HC-V0128-FRESH-3 no sync stamp → typed", fm.actualsFreshness(govBudgetTyped, "2026-07", "2026-07", NOW).state === "typed");
    ok("HC-V0128-FRESH-4 baseline month → none", fm.actualsFreshness(govBudgetLive, "2026-06", "2026-07", NOW).state === "none");
    ok("HC-V0128-FRESH-5 no budget → none",      fm.actualsFreshness(null,           "2026-07", "2026-07", NOW).state === "none");
    ok("HC-V0128-FRESH-6 live label carries date", /2026-07-18/.test(fm.actualsFreshness(govBudgetLive, "2026-07", "2026-07", NOW).label));
}

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

// ===== HC-V0630-ATTR-* — readPaychecksForMonth attributes by pay_period_end (start fallback) =====
{
    // A check straddling the June/July boundary attributes to the month it is PAID (end).
    const straddling = { type: "paycheck", pay_period_start: "2026-06-28", pay_period_end: "2026-07-02",
        paycheck_amount: 4500, expenses: [],
        file: { path: "spice/finance/paychecks/2026-06-28/Paycheck-2026-06-28.md", name: "Paycheck-2026-06-28" } };
    const dv = makeDv({ paychecks: [straddling] });
    const july = fm.readPaychecksForMonth(dv, "2026-07");
    const june = fm.readPaychecksForMonth(dv, "2026-06");
    ok("HC-V0630-ATTR-1 straddling check attributes to July (by end) not June",
        july.length === 1 && june.length === 0);

    // Legacy check with only pay_period_start still attributes by start.
    const legacy = { type: "paycheck", pay_period_start: "2026-06-15", paycheck_amount: 4500, expenses: [],
        file: { path: "spice/finance/paychecks/2026-06-15/Paycheck-2026-06-15.md", name: "Paycheck-2026-06-15" } };
    const dvLegacy = makeDv({ paychecks: [legacy] });
    ok("HC-V0630-ATTR-2 legacy check (no end) falls back to start-month",
        fm.readPaychecksForMonth(dvLegacy, "2026-06").length === 1);
}

// ===== HC-V0630-BA-* — FinanceMath.budgetAllocations merges live plan alloc + per-row overrides =====
{
    const dv = makeDv({
        plan: {},
        debts: [debt("Apple-Card", 14000, 22.74, 380), debt("Discover-It", 3000, 25, 100)],
        savings: [savingsAcct(640, 5000)],
        budgets: [{
            type: "budget", month: "2026-07", categories: [],
            debt_allocations: [{ slug: "Debt-Apple-Card", planned: 350 }], savings_allocations: [],
            file: { path: "spice/finance/budgets/2026-07/Budget-2026-07.md", name: "Budget-2026-07" },
        }],
    });
    const a = fm.budgetAllocations(dv, "2026-07");
    const apple = a.debt.find(d => d.slug === "Debt-Apple-Card");
    const disc = a.debt.find(d => d.slug === "Debt-Discover-It");
    ok("HC-V0630-BA-1 overridden debt row uses the override",
        apple && apple.planned === 350 && apple.source === "override");
    ok("HC-V0630-BA-2 non-overridden debt row uses the live plan value",
        disc && disc.planned > 0 && disc.source === "plan");
    ok("HC-V0630-BA-3 savings row present with live contribution",
        a.savings.length >= 1 && a.savings[0].planned > 0);
    ok("HC-V0630-BA-4 totals expose debt + discretionary",
        typeof a.totals.debt === "number" && typeof a.totals.discretionary === "number");
}

// HC-V0630-BA-ISOLATE — envelope isolation: a debt_allocations override is a VIEW
// only; it must never move the discretionary envelope (which stays categories[]-only
// in computePlanState). Design.md §Architecture promised this test.
{
    const baseCfg = {
        plan: {},
        debts: [debt("Apple-Card", 14000, 22.74, 380), debt("Discover-It", 3000, 25, 100)],
        savings: [savingsAcct(640, 5000)],
    };
    const noOv = makeDv(Object.assign({}, baseCfg, { budgets: [{
        type: "budget", month: "2026-07", categories: [],
        file: { path: "spice/finance/budgets/2026-07/Budget-2026-07.md", name: "Budget-2026-07" },
    }] }));
    const withOv = makeDv(Object.assign({}, baseCfg, { budgets: [{
        type: "budget", month: "2026-07", categories: [],
        debt_allocations: [{ slug: "Debt-Apple-Card", planned: 100 }], savings_allocations: [],
        file: { path: "spice/finance/budgets/2026-07/Budget-2026-07.md", name: "Budget-2026-07" },
    }] }));
    const dNo = fm.budgetAllocations(noOv, "2026-07").totals.discretionary;
    const dOv = fm.budgetAllocations(withOv, "2026-07").totals.discretionary;
    ok("HC-V0630-BA-ISOLATE-1 debt override does not change the discretionary envelope",
        dNo === dOv && typeof dNo === "number");
}

console.log(`\nrun-finance-plan-state.js: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
