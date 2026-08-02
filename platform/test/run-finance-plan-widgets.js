#!/usr/bin/env node
/*
 * run-finance-plan-widgets.js — RENDER harness for the v0.10.0 finance planning widgets.
 * The source-contract harness (run-helper-cases) + engine harness (run-finance-plan-state)
 * verify text + math; this LOADS each widget, INSTANTIATES it, and calls render() against
 * minimal Obsidian DOM / Dataview / app / customJS stubs — catching runtime crashes (undefined
 * access, bad API calls, wrong DOM) that only manifest as a thrown error in a real vault.
 * Family: HC-V0128-WIDGET-*.
 */
const fs = require("fs");
const path = require("path");
const HELPERS = path.join(__dirname, "../blueprints/finance/helpers");

let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) { pass++; } else { fail++; console.error(`  FAIL ${label}${detail ? " — " + detail : ""}`); } };

// ---- Obsidian element stub (mirrors run-v0109-projects-overhaul.js makeEl) ----
function makeEl(tagName) {
    const el = {
        tagName: String(tagName || "div").toUpperCase(),
        style: { cssText: "" },
        _text: "",
        get textContent() { return this._text; },
        set textContent(v) { this._text = String(v); },
        innerHTML: "",
        className: "",
        children: [],
        parentElement: null,
        attrs: {},
        createEl(tag, opts = {}) {
            const c = makeEl(tag);
            if (opts.text != null) c.textContent = String(opts.text);
            if (opts.cls != null) { c.attrs.cls = opts.cls; c.className = opts.cls; }
            if (opts.attr != null) Object.assign(c.attrs, opts.attr);
            c.parentElement = this; this.children.push(c); return c;
        },
        createSpan(opts) { return this.createEl("span", opts || {}); },
        appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
        removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
        remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } },
        addEventListener() {}, removeEventListener() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        closest() { return null; },
        empty() { this.children = []; this.innerHTML = ""; this._text = ""; },
        focus() {},
        setAttribute(k, v) { this.attrs[k] = v; },
    };
    return el;
}
function treeText(el) {
    let s = (el._text || "") + " " + (el.innerHTML || "");
    for (const c of (el.children || [])) s += " " + treeText(c);
    return s;
}
function findInTree(el, pred) { if (pred(el)) return el; for (const c of (el.children || [])) { const h = findInTree(c, pred); if (h) return h; } return null; }

// ---- Dataview DataArray + dv stub ----
function makeDA(items) {
    const arr = (items || []).slice();
    arr.where = (fn) => makeDA(arr.filter(fn));
    arr.array = () => arr.slice();
    return arr;
}
function makeDv(pages, current) {
    const container = makeEl("div");
    return {
        container,
        current: () => current || null,
        pages: (q) => {
            const scope = String(q || "").replace(/"/g, "");
            return makeDA(pages.filter(p => { const fp = (p.file && p.file.path) || ""; return scope === "" || fp === scope || fp.startsWith(scope + "/"); }));
        },
    };
}
function loadClass(filename, className, env) {
    const src = fs.readFileSync(path.join(HELPERS, filename), "utf8");
    const names = Object.keys(env || {}); const vals = Object.values(env || {});
    return new Function(...names, `${src}\n; return ${className};`)(...vals);
}

// ---- shared stubs ----
const FinanceMath = loadClass("finance-math.js", "FinanceMath", {});
const fm = new FinanceMath();
let lastWrite = null;
const customJS = {
    FinanceMath: fm,
    FinanceFrontmatter: { async update(file, mutator) { const f = {}; mutator(f); lastWrite = { file, f }; } },
    SavingsConfigEditor: { async render() { /* opened modal stub */ } },
    AccentButton: { render(parent, opts) { const b = parent.createEl("button", { text: opts && opts.label }); return b; } },
    EntityCreate: { async render() {} },
};
const appStub = {
    vault: { getAbstractFileByPath: (p) => ({ path: p, name: p.split("/").pop().replace(/\.md$/, "") }) },
    workspace: { openLinkText() {} },
    metadataCache: { getFileCache: (file) => ({ frontmatter: (file && file._fm) || {} }) },
};
const documentStub = { body: makeEl("body"), createElement: (t) => makeEl(t) };
const NoticeStub = function () {};
const env = { customJS, app: appStub, document: documentStub, Notice: NoticeStub, window: { customJS } };

// ---- fixtures (headspace-like) ----
function debt(name, bal, apr, min) { return { type: "debt", name, current_balance: bal, apr, min_payment: min, planned_monthly_payment: min, file: { path: `spice/finance/debts/Debt-${name}.md`, name: `Debt-${name}` } }; }
const PLAN = {
    type: "finance-plan", income_floor: 9000, fixed_living_monthly: 3851, attack_above_minimums: 570,
    pay_periods_per_month: 2, roll_freed_savings_to_attack: true,
    savings_glide: [{ under: 1500, monthly: 300 }, { under: 3500, monthly: 150 }, { at_or_above: 3500, monthly: 0 }],
    overflow: { attack_pct: 80, flex_pct: 20 }, avalanche_order_by: "apr",
    governed_from: "2020-01", // governed so the over-envelope flag renders in the widget tests
    attack_target_override: { debt: "[[Debt-Apple-Card]]", until_balance_below: 13950 },
    file: { path: "spice/finance/Finance Plan.md", name: "Finance Plan" },
};
const DEBTS = [debt("Cap1-Platinum", 7643.93, 28.74, 285), debt("Discover-It", 15839.84, 24.74, 430), debt("SCHEELS-Signature", 11704.69, 24.24, 235), debt("Apple-Card", 14551.55, 22.74, 380)];
const SAV = { type: "savings-account", name: "Emergency Fund", current_balance: 639.94, target: 5000, balance_history: [{ date: "2026-06-22", balance: 639.94, source: "manual" }, { date: "2026-05-22", balance: 400, source: "manual" }], file: { path: "spice/finance/savings/Savings-Emergency-Fund.md", name: "Savings-Emergency-Fund" } };
// The dashboard computes the month from new Date() internally, so the budget/paycheck
// fixtures must carry the CURRENT month for the dashboard to read them (date-robust).
const _NOW = new Date();
const NOW_MONTH = `${_NOW.getFullYear()}-${String(_NOW.getMonth() + 1).padStart(2, "0")}`;
const BUDGET = { type: "budget", month: NOW_MONTH, categories: [{ group: "D", name: "All", planned: 3120, actual: 1200 }], file: { path: `spice/finance/budgets/${NOW_MONTH}/Budget-${NOW_MONTH}.md`, name: `Budget-${NOW_MONTH}` } };
const PAYCHECK = { type: "paycheck", pay_period_start: `${NOW_MONTH}-01`, paycheck_amount: 9000, expenses: [], file: { path: `spice/finance/paychecks/${NOW_MONTH}-01/Paycheck-${NOW_MONTH}-01.md`, name: `Paycheck-${NOW_MONTH}-01` } };
const ALL = [PLAN, ...DEBTS, SAV, BUDGET, PAYCHECK];

(async () => {
    // ===== HC-V0128-WIDGET-DASH-* — FinancePlanDashboard =====
    const Dash = loadClass("finance-plan-dashboard.js", "FinancePlanDashboard", env);
    const w = new Dash();
    const dv = makeDv(ALL, PLAN);
    {
        try { await w.render(dv); ok("HC-V0128-WIDGET-DASH-1 renders without throwing", true); }
        catch (e) { ok("HC-V0128-WIDGET-DASH-1 renders without throwing", false, (e && e.message) + " | " + ((e && e.stack || "").split("\n")[1] || "")); }
        const txt = treeText(dv.container);
        ok("HC-V0128-WIDGET-DASH-2 shows DISCRETIONARY ENVELOPE", /DISCRETIONARY ENVELOPE/.test(txt));
        ok("HC-V0128-WIDGET-DASH-3 shows ALLOCATION + Apply button", /THIS CYCLE'S ALLOCATION/.test(txt) && /Apply to entities/.test(txt));
        ok("HC-V0128-WIDGET-DASH-4 shows envelope $2,949", /2,949/.test(txt));
        ok("HC-V0128-WIDGET-DASH-5 shows zero-debt date", /Zero-debt date/.test(txt));
        ok("HC-V0128-WIDGET-DASH-6 over-flag at planned 3120 > envelope", /OVER by/.test(txt));

        // Apply path (called directly since addEventListener is a no-op stub)
        const ps = fm.computePlanState(dv, "2026-07");
        let applyErr = null;
        try { await w._confirmAndApply(dv, ps); } catch (e) { applyErr = e; }
        ok("HC-V0128-WIDGET-DASH-7 _confirmAndApply builds modal without throwing", applyErr === null, applyErr && applyErr.message);
        const modalTxt = treeText(documentStub.body);
        ok("HC-V0128-WIDGET-DASH-8 Apply modal shows the diff + Apply", /Apply allocation to entities/.test(modalTxt));
        // _writeAll directly
        let writeErr = null;
        try { await w._writeAll(ps.applyPlan.debtTargets.map(t => ({ kind: "debt", slug: t.slug, before: 0, after: t.planned_monthly_payment }))); } catch (e) { writeErr = e; }
        ok("HC-V0128-WIDGET-DASH-9 _writeAll writes via FinanceFrontmatter without throwing", writeErr === null, writeErr && writeErr.message);

        // A later entity rejection compensates every earlier successful write
        // from authoritative pre-write frontmatter, never the potentially stale
        // Dataview values displayed by the confirmation modal.
        const originalUpdate = customJS.FinanceFrontmatter.update;
        const stored = { "Debt-First": 100, "Debt-Second": 200 };
        let rejectedSecond = false;
        customJS.FinanceFrontmatter.update = async (file, mutator) => {
            const slug = file.path.split("/").pop().replace(/\.md$/, "");
            if (slug === "Debt-Second" && !rejectedSecond) {
                rejectedSecond = true;
                throw new Error("fixture second write rejected");
            }
            const state = { planned_monthly_payment: stored[slug] };
            await mutator(state);
            stored[slug] = state.planned_monthly_payment;
        };
        let compensated = false;
        try {
            await w._writeAll([
                { kind: "debt", slug: "Debt-First", before: 1, after: 150 },
                { kind: "debt", slug: "Debt-Second", before: 2, after: 250 },
            ]);
        } catch (_e) {
            compensated = stored["Debt-First"] === 100 && stored["Debt-Second"] === 200;
        } finally {
            customJS.FinanceFrontmatter.update = originalUpdate;
        }
        ok("PERF3-FINANCE-COMPENSATION restores authoritative pre-write values, not stale Dataview snapshots", compensated);

        // Presence is part of the receipt: if a field did not exist before the
        // successful write, compensation must delete it rather than materialize
        // the stale modal value.
        const records = { "Debt-First": {}, "Debt-Second": { planned_monthly_payment: 200 } };
        rejectedSecond = false;
        customJS.FinanceFrontmatter.update = async (file, mutator) => {
            const slug = file.path.split("/").pop().replace(/\.md$/, "");
            if (slug === "Debt-Second" && !rejectedSecond) {
                rejectedSecond = true;
                throw new Error("fixture second write rejected");
            }
            await mutator(records[slug]);
        };
        let absenceRestored = false;
        try {
            await w._writeAll([
                { kind: "debt", slug: "Debt-First", before: 999, after: 150 },
                { kind: "debt", slug: "Debt-Second", before: 200, after: 250 },
            ]);
        } catch (_e) {
            absenceRestored = !Object.prototype.hasOwnProperty.call(records["Debt-First"], "planned_monthly_payment");
        } finally {
            customJS.FinanceFrontmatter.update = originalUpdate;
        }
        ok("PERF3-FINANCE-COMPENSATION restores authoritative field absence", absenceRestored);

        // no-plan degrade: current is the plan page but NOT in pages → ok:false
        const dv2 = makeDv(DEBTS, PLAN);
        const w2 = new Dash();
        let degErr = null;
        try { await w2.render(dv2); } catch (e) { degErr = e; }
        ok("HC-V0128-WIDGET-DASH-10 no-plan degrade renders setup prompt", degErr === null && /Set up your Finance Plan/.test(treeText(dv2.container)), degErr && degErr.message);

        // baseline framing: an ungoverned month shows the "Baseline month" note, not the over-flag
        const PLAN_NG = Object.assign({}, PLAN, { governed_from: null });
        const dvNG = makeDv([PLAN_NG, ...DEBTS, SAV, BUDGET, PAYCHECK], PLAN_NG);
        let ngErr = null;
        try { await new Dash().render(dvNG); } catch (e) { ngErr = e; }
        const ngTxt = treeText(dvNG.container);
        ok("HC-V0128-WIDGET-DASH-11 ungoverned month → 'Baseline month' note, no over-flag", ngErr === null && /Baseline month/.test(ngTxt) && !/OVER by/.test(ngTxt), ngErr && ngErr.message);

        // ===== PlanBand =====
        const PB = loadClass("plan-band.js", "PlanBand", env);
        const pbDv = makeDv(ALL, BUDGET);
        let pbErr = null;
        try { await new PB().render(pbDv); } catch (e) { pbErr = e; }
        ok("HC-V0128-WIDGET-PLANBAND-1 renders on a budget without throwing", pbErr === null, pbErr && pbErr.message);
        const pbTxt = treeText(pbDv.container);
        ok("HC-V0128-WIDGET-PLANBAND-2 shows Envelope + Left", /Envelope/.test(pbTxt) && /Left/.test(pbTxt));
        ok("HC-V0128-WIDGET-PLANBAND-3 over-envelope flag present", /OVER ENVELOPE/.test(pbTxt));
        // no-plan budget → renders nothing
        const pbDv2 = makeDv([BUDGET], BUDGET);
        let pbErr2 = null;
        try { await new PB().render(pbDv2); } catch (e) { pbErr2 = e; }
        ok("HC-V0128-WIDGET-PLANBAND-4 no-plan budget renders nothing (no throw)", pbErr2 === null && pbDv2.container.children.length === 0, pbErr2 && pbErr2.message);

        // ===== SavingsSummary =====
        const SS = loadClass("savings-summary.js", "SavingsSummary", env);
        const ssDv = makeDv(ALL, SAV);
        let ssErr = null;
        try { await new SS().render(ssDv); } catch (e) { ssErr = e; }
        ok("HC-V0128-WIDGET-SAVSUM-1 renders on savings-account without throwing", ssErr === null, ssErr && ssErr.message);
        const ssTxt = treeText(ssDv.container);
        ok("HC-V0128-WIDGET-SAVSUM-2 shows balance + target + Edit balance", /639\.94/.test(ssTxt) && /Edit balance/.test(ssTxt));
        ok("HC-V0128-WIDGET-SAVSUM-3 shows glide tier chip", /Tier 1/.test(ssTxt));

        // ===== SavingsCards =====
        const SC = loadClass("savings-cards.js", "SavingsCards", env);
        const scDv = makeDv(ALL, { type: "savings-hub", file: { path: "spice/finance/savings/Savings.md" } });
        let scErr = null;
        try { await new SC().render(scDv); } catch (e) { scErr = e; }
        ok("HC-V0128-WIDGET-SAVCARDS-1 renders hub grid without throwing", scErr === null, scErr && scErr.message);
        ok("HC-V0128-WIDGET-SAVCARDS-2 shows the Emergency Fund card", /Emergency Fund/.test(treeText(scDv.container)));
        // empty-state
        const scDv2 = makeDv([], { type: "savings-hub", file: { path: "spice/finance/savings/Savings.md" } });
        let scErr2 = null;
        try { await new SC().render(scDv2); } catch (e) { scErr2 = e; }
        ok("HC-V0128-WIDGET-SAVCARDS-3 empty-state renders (no throw)", scErr2 === null && /No savings accounts yet/.test(treeText(scDv2.container)), scErr2 && scErr2.message);

        // ===== SavingsConfigEditor (modal) =====
        const SCE = loadClass("savings-config-editor.js", "SavingsConfigEditor", env);
        let sceErr = null;
        const file = { path: SAV.file.path, name: "Savings-Emergency-Fund", _fm: { name: "Emergency Fund", current_balance: 639.94, target: 5000 } };
        try { await new SCE().render(file, { onSave: () => {} }); } catch (e) { sceErr = e; }
        ok("HC-V0128-WIDGET-SCE-1 modal renders without throwing", sceErr === null, sceErr && sceErr.message);

        // ===== FinanceNav mode detection (the edited 6 spots) =====
        const FN = loadClass("finance-nav.js", "FinanceNav", env);
        const nav = new FN();
        ok("HC-V0128-WIDGET-NAV-1 detects hub-savings", nav._detectMode("spice/finance/savings/Savings.md", undefined) === "hub-savings");
        ok("HC-V0128-WIDGET-NAV-2 detects entity-savings", nav._detectMode("x", "savings-account") === "entity-savings");
        ok("HC-V0128-WIDGET-NAV-3 detects config-plan (by type)", nav._detectMode("x", "finance-plan") === "config-plan");
        ok("HC-V0128-WIDGET-NAV-4 detects config-plan (by path)", nav._detectMode("spice/finance/Finance Plan.md", undefined) === "config-plan");
        ok("HC-V0128-WIDGET-NAV-5 _hereKey savings", nav._hereKey("hub-savings") === "savings" && nav._hereKey("entity-savings") === "savings");
        ok("HC-V0128-WIDGET-NAV-6 piggy-bank icon defined", typeof nav._icon("piggy-bank") === "string" && nav._icon("piggy-bank").includes("<svg"));

        // ===== HC-V0128-WIDGET-FRESH-* — actuals freshness badge =====
        // Budget synced "yesterday" relative to real now → must read "live" regardless of CI clock.
        const _y = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const SYNCED_BUDGET = { type: "budget", month: NOW_MONTH, actuals_synced_at: _y,
            categories: [{ group: "D", name: "All", planned: 3120, actual: 1200 }],
            file: { path: `spice/finance/budgets/${NOW_MONTH}/Budget-${NOW_MONTH}.md`, name: `Budget-${NOW_MONTH}` } };

        // MonthDashboard on a governed month note
        const MD = loadClass("month-dashboard.js", "MonthDashboard", env);
        const monthPage = { type: "month", month: NOW_MONTH, file: { path: `spice/finance/months/Month-${NOW_MONTH}.md`, name: `Month-${NOW_MONTH}` } };
        const mdDv = makeDv([PLAN, ...DEBTS, SYNCED_BUDGET, PAYCHECK, monthPage], monthPage);
        let mdErr = null;
        try { await new MD().render(mdDv); } catch (e) { mdErr = e; }
        ok("HC-V0128-WIDGET-FRESH-1 MonthDashboard renders without throwing", mdErr === null, mdErr && mdErr.message);
        ok("HC-V0128-WIDGET-FRESH-2 MonthDashboard shows live badge", /live ·/.test(treeText(mdDv.container)), mdErr && mdErr.message);

        // ===== HC-V0630-WIDGET-MONTH-PLANNED-* — Debt Changes shows planned (budget) per debt row =====
        // The month's budget carries a debt_allocations override; a paycheck pays that debt.
        // Each debt row should read `planned {budget} · paydown {paid} · measured drop {drop}`.
        const MD2 = loadClass("month-dashboard.js", "MonthDashboard", env);
        const plannedBudget = {
            type: "budget", month: NOW_MONTH,
            categories: [{ group: "D", name: "All", planned: 3120, actual: 1200 }],
            debt_allocations: [{ slug: "Debt-Apple-Card", planned: 350 }],
            savings_allocations: [],
            file: { path: `spice/finance/budgets/${NOW_MONTH}/Budget-${NOW_MONTH}.md`, name: `Budget-${NOW_MONTH}` },
        };
        const paidPaycheck = {
            type: "paycheck", pay_period_start: `${NOW_MONTH}-01`, pay_period_end: `${NOW_MONTH}-01`, paycheck_amount: 9000,
            expenses: [{ item: "Apple Card Payment", amount: 400, category: "Credit Payment", paid: true, debt: "[[Debt-Apple-Card]]" }],
            file: { path: `spice/finance/paychecks/${NOW_MONTH}-01/Paycheck-${NOW_MONTH}-01.md`, name: `Paycheck-${NOW_MONTH}-01` },
        };
        const monthPage2 = { type: "month", month: NOW_MONTH, file: { path: `spice/finance/months/Month-${NOW_MONTH}.md`, name: `Month-${NOW_MONTH}` } };
        const md2Dv = makeDv([PLAN, ...DEBTS, plannedBudget, paidPaycheck, monthPage2], monthPage2);
        let md2Err = null;
        try { await new MD2().render(md2Dv); } catch (e) { md2Err = e; }
        ok("HC-V0630-WIDGET-MONTH-PLANNED-1 MonthDashboard renders without throwing", md2Err === null, md2Err && md2Err.message);
        const md2Txt = treeText(md2Dv.container);
        ok("HC-V0630-WIDGET-MONTH-PLANNED-2 debt row shows planned (budget) figure + paydown",
            /planned \$350\.00/.test(md2Txt) && /paydown \$400\.00/.test(md2Txt), md2Txt.slice(0, 800));

        // ===== HC-V0PAY-WIDGET-MDASH-DEPOSIT-* — month-keyed paycheck renders one row PER DEPOSIT =====
        // A single month-keyed paycheck with two deposits ($4500 + $4500) tagged
        // Rent→deposit1 / Apple→deposit2. MonthDashboard Paycheck Totals should
        // render one row per DEPOSIT (its date + income), income total = Σ deposits.
        const MD3 = loadClass("month-dashboard.js", "MonthDashboard", env);
        const monthlyPaycheck = {
            type: "paycheck", month: NOW_MONTH,
            deposits: [{ date: `${NOW_MONTH}-01`, amount: 4500 }, { date: `${NOW_MONTH}-15`, amount: 4500 }],
            expenses: [
                { item: "Rent", amount: 2200, category: "Rent", deposit: 1, paid: false },
                { item: "Apple", amount: 950, category: "Credit Payment", debt: "[[Debt-Apple-Card]]", deposit: 2, paid: true },
            ],
            file: { path: `spice/finance/paychecks/${NOW_MONTH}/Paycheck-${NOW_MONTH}.md`, name: `Paycheck-${NOW_MONTH}` },
        };
        const monthPage3 = { type: "month", month: NOW_MONTH, file: { path: `spice/finance/months/Month-${NOW_MONTH}.md`, name: `Month-${NOW_MONTH}` } };
        const md3Dv = makeDv([PLAN, ...DEBTS, BUDGET, monthlyPaycheck, monthPage3], monthPage3);
        let md3Err = null;
        try { await new MD3().render(md3Dv); } catch (e) { md3Err = e; }
        ok("HC-V0PAY-WIDGET-MDASH-DEPOSIT-1 MonthDashboard renders monthly paycheck without throwing", md3Err === null, md3Err && md3Err.message);
        const md3Txt = treeText(md3Dv.container);
        // income total = Σ deposits = $9,000.00
        ok("HC-V0PAY-WIDGET-MDASH-DEPOSIT-2 income total sums deposits ($9,000.00)", /Income \$9,000\.00/.test(md3Txt), md3Txt.slice(0, 800));
        // one row per deposit → both deposit dates present
        ok("HC-V0PAY-WIDGET-MDASH-DEPOSIT-3 renders a row for deposit 1's date + amount",
            new RegExp(`${NOW_MONTH}-01 — \\$4,500\\.00`).test(md3Txt), md3Txt.slice(0, 800));
        ok("HC-V0PAY-WIDGET-MDASH-DEPOSIT-4 renders a row for deposit 2's date + amount",
            new RegExp(`${NOW_MONTH}-15 — \\$4,500\\.00`).test(md3Txt), md3Txt.slice(0, 800));
        // pluralization counts deposits (2), not notes (1)
        ok("HC-V0PAY-WIDGET-MDASH-DEPOSIT-5 header pluralizes on deposit count (2 deposits)",
            /2 deposits/.test(md3Txt), md3Txt.slice(0, 800));

        // ===== HC-V0PAY-WIDGET-MDASH-LEGACY-* — a legacy per-check note keeps its single-row label =====
        const MD4 = loadClass("month-dashboard.js", "MonthDashboard", env);
        const legacyPaycheck = {
            type: "paycheck", pay_period_start: `${NOW_MONTH}-10`, pay_period_end: `${NOW_MONTH}-10`, paycheck_amount: 3200,
            expenses: [], file: { path: `spice/finance/paychecks/${NOW_MONTH}-10/Paycheck-${NOW_MONTH}-10.md`, name: `Paycheck-${NOW_MONTH}-10` },
        };
        const monthPage4 = { type: "month", month: NOW_MONTH, file: { path: `spice/finance/months/Month-${NOW_MONTH}.md`, name: `Month-${NOW_MONTH}` } };
        const md4Dv = makeDv([PLAN, ...DEBTS, BUDGET, legacyPaycheck, monthPage4], monthPage4);
        let md4Err = null;
        try { await new MD4().render(md4Dv); } catch (e) { md4Err = e; }
        ok("HC-V0PAY-WIDGET-MDASH-LEGACY-1 MonthDashboard renders legacy paycheck without throwing", md4Err === null, md4Err && md4Err.message);
        const md4Txt = treeText(md4Dv.container);
        ok("HC-V0PAY-WIDGET-MDASH-LEGACY-2 legacy note keeps single-row label (pay date + amount)",
            new RegExp(`${NOW_MONTH}-10 — \\$3,200\\.00`).test(md4Txt), md4Txt.slice(0, 800));
        ok("HC-V0PAY-WIDGET-MDASH-LEGACY-3 legacy header pluralizes on note count (1 paycheck)",
            /1 paycheck\b/.test(md4Txt), md4Txt.slice(0, 800));

        // FinanceHubSummary Budget tile
        const FHS = loadClass("finance-hub-summary.js", "FinanceHubSummary", env);
        const finPage = { type: "finance-hub", file: { path: "spice/finance/Finance.md", name: "Finance" } };
        const fhsDv = makeDv([PLAN, ...DEBTS, SYNCED_BUDGET, PAYCHECK, finPage], finPage);
        let fhsErr = null;
        try { await new FHS().render(fhsDv); } catch (e) { fhsErr = e; }
        ok("HC-V0128-WIDGET-FRESH-3 FinanceHubSummary renders without throwing", fhsErr === null, fhsErr && fhsErr.message);
        ok("HC-V0128-WIDGET-FRESH-4 FinanceHubSummary Budget tile shows live badge", /live ·/.test(treeText(fhsDv.container)), fhsErr && fhsErr.message);

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

        console.log(`\nrun-finance-plan-widgets.js: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    }
})();
