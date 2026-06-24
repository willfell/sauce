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

        // no-plan degrade: current is the plan page but NOT in pages → ok:false
        const dv2 = makeDv(DEBTS, PLAN);
        const w2 = new Dash();
        let degErr = null;
        try { await w2.render(dv2); } catch (e) { degErr = e; }
        ok("HC-V0128-WIDGET-DASH-10 no-plan degrade renders setup prompt", degErr === null && /Set up your Finance Plan/.test(treeText(dv2.container)), degErr && degErr.message);

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

        console.log(`\nrun-finance-plan-widgets.js: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    }
})();
