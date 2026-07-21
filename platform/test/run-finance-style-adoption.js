#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "../..");
const HELPERS = path.join(ROOT, "platform/blueprints/finance/helpers");
const VISUAL_PATH = path.join(ROOT, "platform/test/visual/finance-style-adoption.html");
const FILES = {
    nav: "finance-nav.js",
    hub: "finance-hub-cards.js",
    debts: "debts-cards.js",
    savings: "savings-cards.js",
    months: "months-cards.js",
    budgetSummary: "budget-summary.js",
    paycheckSummary: "paycheck-summary.js",
    monthlyOverview: "monthly-overview.js",
    debtBand: "paycheck-debt-band.js",
    planBand: "plan-band.js",
    status: "finance-status.js",
    debtSummary: "debt-summary.js",
    savingsSummary: "savings-summary.js",
    debtsHubSummary: "debts-hub-summary.js",
};

function source(name) {
    return fs.readFileSync(path.join(HELPERS, FILES[name]), "utf8");
}

function loadClass(name, className, env) {
    const names = Object.keys(env || {});
    const values = Object.values(env || {});
    return new Function(...names, `${source(name)}\n; return ${className};`)(...values);
}

class FakeElement {
    constructor(tagName, className = "") {
        this.tagName = String(tagName || "div").toUpperCase();
        this.className = className;
        this.children = [];
        this.parentElement = null;
        this.style = { cssText: "" };
        this.attrs = {};
        this.listeners = new Map();
        this.textContent = "";
        this.innerHTML = "";
        this.disabled = false;
        this.onclick = null;
        this.onmouseenter = null;
        this.onmouseleave = null;
        this.classList = {
            add: (...tokens) => {
                const set = new Set(this.className.split(/\s+/).filter(Boolean));
                for (const token of tokens) set.add(token);
                this.className = [...set].join(" ");
            },
            contains: (token) => this.className.split(/\s+/).includes(token),
        };
    }

    createEl(tagName, options = {}) {
        const child = new FakeElement(tagName, options.cls || "");
        if (options.text != null) child.textContent = String(options.text);
        if (options.attr) Object.assign(child.attrs, options.attr);
        return this.appendChild(child);
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (!this.parentElement) return;
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
    }

    addEventListener(type, listener) {
        const entries = this.listeners.get(type) || [];
        entries.push(listener);
        this.listeners.set(type, entries);
    }

    dispatch(type) {
        const event = { target: this, currentTarget: this, preventDefault: () => {} };
        for (const listener of this.listeners.get(type) || []) listener(event);
        if (type === "click" && typeof this.onclick === "function") this.onclick(event);
    }

    querySelector(selector) {
        if (selector.startsWith(":scope > .")) {
            const wanted = selector.slice(10);
            return this.children.find((child) => child.classList.contains(wanted)) || null;
        }
        if (selector.startsWith(".")) return this.walk().find((child) => child.classList.contains(selector.slice(1))) || null;
        return null;
    }

    closest() { return null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    walk() { return this.children.flatMap((child) => [child, ...child.walk()]); }
}

function dataArray(items) {
    const values = Array.from(items || []);
    values.where = (predicate) => dataArray(values.filter(predicate));
    values.array = () => Array.from(values);
    return values;
}

function dvFor(routes, current = {}) {
    const container = new FakeElement("div");
    return {
        container,
        current: () => current,
        pages: (query) => dataArray(routes[String(query).replaceAll('"', "")] || []),
        el: () => {},
    };
}

function classes(root, name) {
    return root.walk().filter((node) => node.classList.contains(name));
}

function sharedChromeViolations(sources) {
    const combined = Object.values(sources).join("\n");
    const failures = [];
    if (/\b(?:btn|button|editBtn)\.style\.cssText\s*=\s*[`"'][^\n]*(?:padding|border-radius|border:\s*1px)/i.test(combined)) failures.push("hand-rolled-button");
    if (/\b(?:aprBadge|chip|paceTag|statusTag|deltaPill|tierChip|pill|closed)\.style\.cssText\s*=\s*[`"'][^\n]*(?:padding|border-radius)/i.test(combined)) failures.push("hand-rolled-pill");
    if (/border(?:-top)?:\s*1px\s+solid\s+var\(--background-modifier-border\)/i.test(combined)) failures.push("legacy-hairline-token");
    return failures;
}

function chromeExecutable() {
    const candidates = [
        process.env.CHROME_BIN,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runChrome(executable, args) {
    const result = childProcess.spawnSync(executable, args, {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
    });
    assert.strictEqual(result.status, 0, `headless Chrome failed: ${result.stderr || result.error || "unknown error"}`);
    return result.stdout || "";
}

function markerData(html) {
    const tag = String(html).match(/<meta\s+id="fixture-results"[^>]*>/i)?.[0];
    assert(tag, "executed fixture emits its computed result marker");
    return Object.fromEntries([...tag.matchAll(/data-([a-z0-9-]+)="([^"]*)"/gi)].map((match) => [match[1], match[2]]));
}

function staticContract() {
    console.log("--- C6A-STATIC: manifest and shared-chrome source contract ---");
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/blueprints/finance/manifest.json"), "utf8"));
    assert(manifest.depends_on.some((dep) => dep.name === "styling" && dep.range === ">=0.3.0"), "Finance declares styling >=0.3.0");

    const sources = Object.fromEntries(Object.keys(FILES).map((name) => [name, source(name)]));
    assert.deepStrictEqual(sharedChromeViolations(sources), [], "owned sources contain no hand-rolled shared button, pill, or legacy-hairline chrome");
    assert(sources.nav.includes("sauce-action-row") && sources.nav.includes("--sauce-hairline"), "FinanceNav adopts action-row and hairline contracts");
    assert(sources.nav.includes("button.classList.add(\"sauce-btn\")"), "FinanceNav normalizes AccentButton output onto sauce-btn");
    assert(!sources.hub.includes("const btnStyle") && !sources.hub.includes("btn.onmouseenter"), "FinanceHubCards deletes the local button dialect");
    assert(sources.hub.includes('cls: "sauce-btn"'), "FinanceHubCards emits semantic buttons");
    assert(sources.debts.includes("dbt-apr-pill sauce-pill") && sources.debts.includes("dbt-paid-pill sauce-pill"), "debt badges use sauce-pill");
    assert(sources.savings.includes("sav-progress-pill sauce-pill"), "savings progress uses sauce-pill");
    for (const name of ["debts", "savings", "months"]) {
        assert(sources[name].includes("var(--sauce-hairline)"), `${name} cards use the shared hairline token`);
        assert(sources[name].includes("var(--sauce-radius-btn)"), `${name} cards use the shared radius token`);
    }
    for (const name of ["budgetSummary", "paycheckSummary", "monthlyOverview", "debtBand", "planBand", "status"]) {
        assert(sources[name].includes("var(--sauce-hairline)"), `${name} summary uses the shared hairline token`);
    }
    assert(sources.budgetSummary.includes("bs-closed-pill sauce-pill") && sources.budgetSummary.includes("bs-pace-pill sauce-pill"), "BudgetSummary emits semantic closed and pace pills");
    assert(sources.paycheckSummary.includes("ps-closed-pill sauce-pill") && sources.paycheckSummary.includes("ps-status-pill sauce-pill"), "PaycheckSummary emits semantic closed and progress pills");
    assert(sources.monthlyOverview.includes("mo-mom-pill sauce-pill"), "MonthlyOverview emits a semantic month-over-month pill");
    assert(sources.debtBand.includes("pdb-progress-pill sauce-pill") && sources.debtBand.includes("pdb-paydown-pill sauce-pill"), "PaycheckDebtBand emits semantic progress pills");
    assert(sources.status.includes("fs-status-pill sauce-pill"), "FinanceStatus emits a semantic status pill");
    for (const name of ["debtSummary", "savingsSummary", "debtsHubSummary"]) {
        assert(sources[name].includes("var(--sauce-hairline)"), `${name} uses the shared hairline token`);
    }
    assert(sources.debtSummary.includes("dbt-edit-btn sauce-btn") && sources.debtSummary.includes("dbt-delta-pill sauce-pill"), "DebtSummary emits semantic edit and delta controls");
    assert(sources.savingsSummary.includes("sav-edit-btn sauce-btn") && sources.savingsSummary.includes("sav-tier-chip sauce-pill") && sources.savingsSummary.includes("sav-delta-pill sauce-pill"), "SavingsSummary emits semantic edit, tier, and delta controls");
    assert(sources.debtsHubSummary.includes("dhs-kind-chip sauce-pill") && sources.debtsHubSummary.includes("dhs-card-progress-pill sauce-pill"), "DebtsHubSummary emits semantic kind and paydown pills");
    assert(!/(?:processFrontMatter|vault\.(?:create|modify|rename|delete)|adapter\.(?:write|remove))/.test([sources.debtSummary, sources.savingsSummary, sources.debtsHubSummary].join("\n")), "C6c summaries remain read-only");

    const buttonMutation = { ...sources, hub: `${sources.hub}\nbtn.style.cssText = "padding: 6px; border-radius: 6px;";` };
    assert(sharedChromeViolations(buttonMutation).includes("hand-rolled-button"), "button mutation turns the source guard red");
    const pillMutation = { ...sources, status: `${sources.status}\npill.style.cssText = "padding: 2px; border-radius: 999px;";` };
    assert(sharedChromeViolations(pillMutation).includes("hand-rolled-pill"), "pill mutation turns the source guard red");
    const hairlineMutation = { ...sources, months: sources.months.replace("var(--sauce-hairline)", "var(--background-modifier-border)") };
    assert(sharedChromeViolations(hairlineMutation).includes("legacy-hairline-token"), "legacy hairline mutation turns the source guard red");
}

async function behaviorContract() {
    console.log("--- C6A-BEHAVIOR: destinations, ordering, click paths, and semantic DOM ---");
    const opened = [];
    const app = {
        workspace: { openLinkText: (target) => opened.push(target) },
        vault: { getMarkdownFiles: () => [] },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };
    const accentButton = {
        render(parent, options) {
            const button = parent.createEl("button");
            button.innerHTML = `<span>${options.label}</span>`;
            button.style.cssText = "legacy button dialect";
            button.onmouseenter = () => {};
            button.onmouseleave = () => {};
            button.onclick = options.onClick;
            return button;
        },
    };

    const FinanceNav = loadClass("nav", "FinanceNav", { customJS: { AccentButton: accentButton }, app });
    const nav = new FinanceNav();
    const navRoot = new FakeElement("div");
    nav._renderCrossHub(navRoot, "hub-finance");
    const navButtons = navRoot.walk().filter((node) => node.tagName === "BUTTON");
    assert.strictEqual(navButtons.length, 6, "Finance hub excludes only its current destination");
    assert(navButtons.every((button) => button.classList.contains("sauce-btn")), "every nav button uses sauce-btn");
    assert(navButtons.every((button) => button.style.cssText === "" && button.onmouseenter === null && button.onmouseleave === null), "legacy AccentButton visual state is removed");
    navButtons.forEach((button) => button.dispatch("click"));
    assert.deepStrictEqual(opened.splice(0), [
        "spice/finance/budgets/Budgets.md",
        "spice/finance/paychecks/Paychecks.md",
        "spice/finance/invoices/Invoices.md",
        "spice/finance/debts/Debts.md",
        "spice/finance/months/Months.md",
        "spice/finance/savings/Savings.md",
    ], "Finance navigation destination order is unchanged");
    nav._hr(navRoot);
    assert(navRoot.children.at(-1).style.cssText.includes("var(--sauce-hairline)"), "Finance divider uses the shared hairline token");

    const FinanceHubCards = loadClass("hub", "FinanceHubCards", {
        customJS: {
            FinanceStatus: { derive: () => ({ label: "Done" }) },
            BudgetsCards: { render: async () => {} },
            PaychecksCards: { render: async () => {} },
            InvoicesCards: { render: async () => {} },
        },
        app,
    });
    const hubDv = dvFor({
        "spice/finance/budgets": [],
        "spice/finance/paychecks": [],
        "spice/finance/invoices": [],
    });
    await new FinanceHubCards().render(hubDv);
    const hubButtons = hubDv.container.walk().filter((node) => node.tagName === "BUTTON");
    assert.strictEqual(hubButtons.length, 3, "FinanceHubCards retains three area destinations");
    assert(hubButtons.every((button) => button.classList.contains("sauce-btn") && button.style.cssText === ""), "area destinations use CSS-owned sauce buttons");
    hubButtons.forEach((button) => button.dispatch("click"));
    assert.deepStrictEqual(opened.splice(0), [
        "spice/finance/budgets/Budgets.md",
        "spice/finance/paychecks/Paychecks.md",
        "spice/finance/invoices/Invoices.md",
    ], "FinanceHubCards click targets are unchanged");

    const DebtsCards = loadClass("debts", "DebtsCards", { app });
    const debtDv = dvFor({ "spice/finance/debts": [
        { type: "debt", name: "Low", current_balance: 100, apr: 9, kind: "loan", file: { name: "Debt-Low" } },
        { type: "debt", name: "High", current_balance: 900, apr: 22, kind: "credit-card", credit_limit: 1000, file: { name: "Debt-High" } },
    ] });
    await new DebtsCards().render(debtDv);
    const debtCards = classes(debtDv.container, "dbt-card");
    assert.strictEqual(debtCards[0].walk().find((node) => node.textContent === "High")?.textContent, "High", "debts remain balance-descending");
    assert.strictEqual(classes(debtDv.container, "sauce-pill").length, 3, "APR and paydown badges use semantic pills");
    debtCards[0].dispatch("click");
    assert.deepStrictEqual(opened.splice(0), ["Debt-High"], "debt click opens the same entity");

    const SavingsCards = loadClass("savings", "SavingsCards", { app });
    const savingsDv = dvFor({ "spice/finance/savings": [
        { type: "savings-account", name: "Small", current_balance: 50, target: 500, file: { name: "Savings-Small" } },
        { type: "savings-account", name: "Large", current_balance: 700, target: 1000, file: { name: "Savings-Large" } },
    ] });
    await new SavingsCards().render(savingsDv);
    const savingsCards = classes(savingsDv.container, "sav-card");
    assert.strictEqual(savingsCards[0].walk().find((node) => node.textContent === "Large")?.textContent, "Large", "savings remain balance-descending");
    assert.strictEqual(classes(savingsDv.container, "sauce-pill").length, 2, "every savings progress badge uses sauce-pill");
    savingsCards[0].dispatch("click");
    assert.deepStrictEqual(opened.splice(0), ["Savings-Large"], "savings click opens the same entity");

    const financeMath = {
        readPaychecksForMonth: () => [],
        readBudgetForMonth: () => null,
        monthIncome: () => 0,
        monthSpending: () => 0,
        monthDebtPaid: () => 0,
        fmtMoney: (value) => `$${Number(value).toFixed(2)}`,
    };
    const MonthsCards = loadClass("months", "MonthsCards", { customJS: { FinanceMath: financeMath }, app });
    const monthDv = dvFor({ "spice/finance/months": [
        { type: "month", month: "2026-01", file: { name: "Month-2026-01" } },
        { type: "month", month: "2026-03", file: { name: "Month-2026-03" } },
        { type: "month", month: "2026-02", file: { name: "Month-2026-02" } },
    ] });
    await new MonthsCards().render(monthDv);
    const monthCards = classes(monthDv.container, "fmc-card");
    assert.strictEqual(monthCards[0].walk().find((node) => node.textContent === "2026-03")?.textContent, "2026-03", "months remain newest-first");
    monthCards[0].dispatch("click");
    assert.deepStrictEqual(opened.splice(0), ["Month-2026-03"], "month click opens the same entity");

    console.log("--- C6B-BEHAVIOR: summary values, tones, ordering, and envelope boundary ---");
    const summaryWindow = { moment: () => ({ year: () => 2026, month: () => 6, date: () => 15 }) };
    const BudgetSummary = loadClass("budgetSummary", "BudgetSummary", { window: summaryWindow });
    const budgetSummary = new BudgetSummary();
    const budgetRoot = new FakeElement("div");
    budgetSummary._renderBand1(budgetRoot, 1000, 1120, 120, 12, "done");
    budgetSummary._renderBand2(budgetRoot, 1000, 1120, { year: 2026, month: 7, daysInMonth: 31 }, "in-progress");
    budgetSummary._renderBand3(budgetRoot, [
        { group: "Essential", planned: 800, actual: 700 },
        { group: "Optional", planned: 200, actual: 420 },
    ], ["Essential", "Optional"]);
    assert(classes(budgetRoot, "bs-closed-pill")[0]?.classList.contains("sauce-pill"), "BudgetSummary closed state uses sauce-pill");
    assert.strictEqual(classes(budgetRoot, "bs-pace-pill")[0]?.textContent, "Spending ahead of pace by 64 points", "BudgetSummary preserves its data-derived pace label");
    assert.deepStrictEqual(
        budgetRoot.walk().filter((node) => ["Essential", "Optional"].includes(node.textContent)).map((node) => node.textContent),
        ["Essential", "Optional"],
        "BudgetSummary preserves authored group ordering",
    );
    assert(budgetRoot.walk().some((node) => node.textContent === "$120.00 (+12.0%)"), "BudgetSummary preserves exact difference total");

    const PaycheckSummary = loadClass("paycheckSummary", "PaycheckSummary", { customJS: { FinanceMath: { depositTotals: () => [] } } });
    const paycheckSummary = new PaycheckSummary();
    const paycheckRoot = new FakeElement("div");
    paycheckSummary._renderBand1(paycheckRoot, 2000, 2000, 0, 2000, "done");
    paycheckSummary._renderBand2(paycheckRoot, 2, 2, 2000, 2000, "done");
    paycheckSummary._renderBand3(paycheckRoot, [
        { category: "Small", amount: 100, paid: false },
        { category: "Large", amount: 900, paid: true },
    ]);
    assert(classes(paycheckRoot, "ps-closed-pill")[0]?.classList.contains("sauce-pill"), "PaycheckSummary closed state uses sauce-pill");
    assert.strictEqual(classes(paycheckRoot, "ps-status-pill")[0]?.textContent, "All paid", "PaycheckSummary preserves its closed progress label");
    assert.deepStrictEqual(
        paycheckRoot.walk().filter((node) => ["Large", "Small"].includes(node.textContent)).map((node) => node.textContent),
        ["Large", "Small"],
        "PaycheckSummary preserves amount-descending category order",
    );
    assert(paycheckRoot.walk().some((node) => node.textContent === "$0.00"), "PaycheckSummary preserves the exact remaining total");

    const MonthlyOverview = loadClass("monthlyOverview", "MonthlyOverview", {});
    const monthlyOverview = new MonthlyOverview();
    const monthlyRoot = new FakeElement("div");
    const debts = [{
        current_balance: 800,
        balance_history: [{ date: "2026-07-01", balance: 1000 }, { date: "2026-07-31", balance: 800 }],
    }];
    monthlyOverview._renderBand1(monthlyRoot, 5000, 3000, 500, 1500, debts);
    monthlyOverview._renderBand2(monthlyRoot, "2026-07", debts);
    monthlyOverview._renderBand3(monthlyRoot, [{ paycheck_amount: 5000 }], debts, 5000);
    assert.strictEqual(classes(monthlyRoot, "mo-mom-pill")[0]?.textContent, "MoM ↓ $200.00", "MonthlyOverview preserves month-over-month direction and amount");
    assert(monthlyRoot.walk().some((node) => node.textContent === "+$1,500.00"), "MonthlyOverview preserves exact net cashflow");
    assert(monthlyRoot.walk().some((node) => node.textContent.includes("From 1 paycheck")), "MonthlyOverview preserves audit counts");

    const PaycheckDebtBand = loadClass("debtBand", "PaycheckDebtBand", { app });
    const debtBand = new PaycheckDebtBand();
    debtBand._resolveDebt = async () => ({ kind: "credit-card", credit_limit: 1000, current_balance: 250 });
    const debtBandRoot = new FakeElement("div");
    debtBand._renderHeader(debtBandRoot, 2, 1000, 750, 75);
    debtBand._renderRow(debtBandRoot, { item: "Apple", debt: "[[Debt-Apple]]", amount: 750, paid: true });
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(classes(debtBandRoot, "pdb-progress-pill")[0]?.textContent, "75%", "PaycheckDebtBand preserves header progress");
    assert.strictEqual(classes(debtBandRoot, "pdb-paydown-pill")[0]?.textContent, "75% paid", "PaycheckDebtBand preserves resolved paydown progress");
    debtBandRoot.walk().find((node) => node.textContent === "Apple")?.dispatch("click");
    assert.deepStrictEqual(opened.splice(0), ["Debt-Apple"], "PaycheckDebtBand preserves debt link target");

    let planCalls = 0;
    const planMath = {
        _coerceMonthString: (value) => value,
        computePlanState: (_dv, month) => {
            planCalls += 1;
            assert.strictEqual(month, "2026-07", "PlanBand passes through the current budget month");
            return { ok: true, envelope: { governed: true, effective: 900, planned: 1000, left: -100, over: 100, overageCarry: 0, base: 900 } };
        },
        fmtMoney: (value) => `$${Number(value).toFixed(2)}`,
    };
    const PlanBand = loadClass("planBand", "PlanBand", { customJS: { FinanceMath: planMath } });
    const planDv = dvFor({}, { type: "budget", month: "2026-07" });
    await new PlanBand().render(planDv);
    assert.strictEqual(planCalls, 1, "PlanBand delegates envelope computation exactly once to FinanceMath");
    assert(planDv.container.walk().some((node) => node.textContent.includes("OVER ENVELOPE by $100.00")), "PlanBand preserves the governed over-envelope warning");

    const today = {
        startOf() { return this; },
        isBefore(other, unit) { return unit === "month" ? "2026-07" < other.key : false; },
    };
    const FinanceStatus = loadClass("status", "FinanceStatus", { window: { moment: () => today } });
    const financeStatus = new FinanceStatus();
    financeStatus._toMoment = (value) => ({
        key: String(value).slice(0, 7),
        isValid: () => true,
        isBefore: (_other, unit) => unit === "month" && String(value).slice(0, 7) < "2026-07",
        isSame: (_other, unit) => unit === "month" && String(value).slice(0, 7) === "2026-07",
    });
    assert.deepStrictEqual(financeStatus.derive({ month: "2026-07" }, "budget"), { label: "In Progress", tone: "warn" }, "FinanceStatus preserves current-budget label and tone");
    financeStatus.derive = () => ({ label: "In Progress", tone: "warn" });
    const statusDv = dvFor({}, { type: "budget" });
    await financeStatus.renderBadge(statusDv, "budget");
    assert(classes(statusDv.container, "fs-status-pill")[0]?.classList.contains("sauce-pill"), "FinanceStatus emits its unchanged label through sauce-pill");
    assert(statusDv.container.walk().some((node) => node.textContent === "In Progress"), "FinanceStatus renders the unchanged status label");

    console.log("--- C6C-BEHAVIOR: debt, savings, and hub values, history, and delegation ---");
    class FixedDate extends Date {
        constructor(value) { super(value === undefined ? "2026-07-21T00:00:00Z" : value); }
    }
    app.vault.getAbstractFileByPath = (filePath) => ({ path: filePath });

    let debtPayoffCalls = 0;
    let debtEditFile = null;
    let debtHistory = null;
    const debtCustomJS = {
        FinanceMath: {
            projectedPayoff: () => {
                debtPayoffCalls += 1;
                return { killOrder: [{ slug: "Debt-Apple", date: "2026-10-01" }] };
            },
        },
        DebtConfigEditor: { render: async (file) => { debtEditFile = file; } },
    };
    const DebtSummary = loadClass("debtSummary", "DebtSummary", { customJS: debtCustomJS, app, Date: FixedDate });
    const debtSummary = new DebtSummary();
    debtSummary._renderSparkline = (_parent, values) => { debtHistory = values; };
    const debtSummaryDv = dvFor({}, {
        type: "debt",
        kind: "credit-card",
        current_balance: 800,
        credit_limit: 2000,
        apr: 24,
        planned_monthly_payment: 200,
        balance_history: [{ date: "2026-07-20", balance: 900 }, { date: "2026-06-20", balance: 1000 }],
        file: { name: "Debt-Apple", path: "spice/finance/debts/Debt-Apple.md" },
    });
    await debtSummary.render(debtSummaryDv);
    for (const value of ["$800.00", "24.00%", "$16.00", "$200.00", "3mo (2026-10-01)"]) {
        assert(debtSummaryDv.container.walk().some((node) => node.textContent === value), `DebtSummary preserves exact value ${value}`);
    }
    assert.strictEqual(debtPayoffCalls, 1, "DebtSummary uses FinanceMath projected-payoff precedence exactly once");
    assert.deepStrictEqual(debtHistory, [1000, 900], "DebtSummary converts newest-first balance history to chronological sparkline order without mutation");
    assert.strictEqual(classes(debtSummaryDv.container, "dbt-delta-pill")[0]?.textContent, "vs prior: $100.00", "DebtSummary preserves its prior-balance delta output");
    const debtEditButton = classes(debtSummaryDv.container, "dbt-edit-btn")[0];
    assert(debtEditButton?.classList.contains("sauce-btn"), "DebtSummary edit action uses sauce-btn");
    debtEditButton.dispatch("click");
    await Promise.resolve();
    assert.strictEqual(debtEditFile?.path, "spice/finance/debts/Debt-Apple.md", "DebtSummary preserves DebtConfigEditor delegation");

    let glideArgs = null;
    let savingsEditFile = null;
    let savingsHistory = null;
    const savingsCustomJS = {
        FinanceMath: {
            readPlan: () => ({ savings_glide: [{ tier: 2 }] }),
            glide: (balance, tiers) => {
                glideArgs = { balance, tiers };
                return { tier: 2, contribution: 150 };
            },
        },
        SavingsConfigEditor: { render: async (file) => { savingsEditFile = file; } },
    };
    const SavingsSummary = loadClass("savingsSummary", "SavingsSummary", { customJS: savingsCustomJS, app });
    const savingsSummary = new SavingsSummary();
    savingsSummary._renderSparkline = (_parent, values) => { savingsHistory = values; };
    const savingsSummaryDv = dvFor({}, {
        type: "savings-account",
        name: "Emergency Fund",
        current_balance: 600,
        target: 1000,
        balance_history: [{ date: "2026-07-20", balance: 550 }, { date: "2026-06-20", balance: 500 }],
        file: { name: "Savings-Emergency-Fund", path: "spice/finance/savings/Savings-Emergency-Fund.md" },
    });
    await savingsSummary.render(savingsSummaryDv);
    for (const value of ["Emergency Fund", "$600.00", "$1000.00", "Tier 2 · $150/mo", "To target: $400.00"]) {
        assert(savingsSummaryDv.container.walk().some((node) => node.textContent === value), `SavingsSummary preserves exact value ${value}`);
    }
    assert.deepStrictEqual(glideArgs, { balance: 600, tiers: [{ tier: 2 }] }, "SavingsSummary preserves FinanceMath glide inputs");
    assert.deepStrictEqual(savingsHistory, [500, 550], "SavingsSummary converts newest-first balance history to chronological sparkline order without mutation");
    assert.strictEqual(classes(savingsSummaryDv.container, "sav-delta-pill")[0]?.textContent, "vs prior: +$50.00", "SavingsSummary preserves its prior-balance delta output");
    assert(classes(savingsSummaryDv.container, "sav-tier-chip")[0]?.classList.contains("sauce-pill"), "SavingsSummary glide tier uses sauce-pill");
    const savingsEditButton = classes(savingsSummaryDv.container, "sav-edit-btn")[0];
    savingsEditButton.dispatch("click");
    await Promise.resolve();
    assert.strictEqual(savingsEditFile?.path, "spice/finance/savings/Savings-Emergency-Fund.md", "SavingsSummary preserves SavingsConfigEditor delegation");

    const debtPages = [
        { type: "debt", name: "Apple", kind: "credit-card", current_balance: 1200, credit_limit: 2000, apr: 20, file: { name: "Debt-Apple" } },
        { type: "debt", name: "Student", kind: "student-loan", current_balance: 800, apr: 10, file: { name: "Debt-Student" } },
    ];
    const hubMath = {
        projectedPayoff: () => ({ totalBalance: 2000, monthlyInterest: 26.67, plannedAttack: 500, weightedApr: 16, zeroDebtDate: "2027-01" }),
    };
    const DebtsHubSummary = loadClass("debtsHubSummary", "DebtsHubSummary", { customJS: { FinanceMath: hubMath }, app });
    const debtsHubDv = dvFor({ "spice/finance/debts": debtPages });
    await new DebtsHubSummary().render(debtsHubDv);
    for (const value of ["$2000.00", "$26.67", "$500.00", "16.00%", "2027-01"]) {
        assert(debtsHubDv.container.walk().some((node) => node.textContent === value), `DebtsHubSummary preserves exact value ${value}`);
    }
    const hubCards = classes(debtsHubDv.container, "dhs-card");
    assert.deepStrictEqual(hubCards.map((card) => classes(card, "dhs-card-name")[0]?.textContent), ["Apple", "Student"], "DebtsHubSummary preserves balance-descending card order");
    assert(classes(debtsHubDv.container, "dhs-kind-chip").every((chip) => chip.classList.contains("sauce-pill")), "DebtsHubSummary kind totals use sauce-pill");
    assert(classes(debtsHubDv.container, "dhs-card-progress-pill")[0]?.classList.contains("sauce-pill"), "DebtsHubSummary card progress uses sauce-pill");
    hubCards[0].dispatch("click");
    assert.deepStrictEqual(opened.splice(0), ["Debt-Apple"], "DebtsHubSummary preserves debt-card open behavior");
}

function visualContract() {
    console.log("--- C6ABC-VISUAL: execute cards and summaries at 1024/390 light/dark ---");
    const visual = fs.readFileSync(VISUAL_PATH, "utf8");
    assert(/<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1">/.test(visual), "fixture declares responsive viewport");
    assert(visual.includes("../../mechanisms/styling/assets/snippets/sauce-core.css"), "fixture loads shipped sauce-core CSS");
    const coreSelectorFork = /(?:^|[},]\s*|\n\s*)\.sauce-(?:btn|pill)\s*\{/m;
    assert(!coreSelectorFork.test(visual), "fixture does not fork core button or pill styling");
    assert(visual.includes('className = "sauce-action-row fixture-nav"'), "fixture exercises the responsive action row");
    assert(visual.includes('className = "sauce-btn"'), "fixture exercises semantic buttons");
    assert(visual.includes('className = "sauce-pill"'), "fixture exercises semantic pills");

    const executable = chromeExecutable();
    assert(executable, "a supported Chrome/Chromium binary is required for the visual contract");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-c6ab-visual-"));
    try {
        for (const theme of ["light", "dark"]) {
            for (const width of [1024, 390]) {
                const url = `${pathToFileURL(VISUAL_PATH).href}?theme=${theme}`;
                const common = [
                    "--headless=new",
                    "--no-sandbox",
                    "--disable-gpu",
                    "--hide-scrollbars",
                    "--allow-file-access-from-files",
                    "--force-prefers-reduced-motion",
                    "--run-all-compositor-stages-before-draw",
                    "--virtual-time-budget=1000",
                    `--window-size=${width},900`,
                ];
                const rendered = runChrome(executable, [...common, "--dump-dom", url]);
                const marker = markerData(rendered);
                assert.strictEqual(marker.theme, theme, `${theme}/${width}: requested theme rendered`);
                assert.strictEqual(marker["document-fits"], "true", `${theme}/${width}: document has no horizontal overflow`);
                assert.strictEqual(marker["controls-enabled"], "true", `${theme}/${width}: controls remain enabled`);
                assert.strictEqual(marker["controls-visible"], "true", `${theme}/${width}: controls have rendered geometry`);
                assert.strictEqual(marker["actions-clicked"], "true", `${theme}/${width}: every action remains clickable`);
                assert.strictEqual(marker.buttons, "9", `${theme}/${width}: all navigation and summary buttons render`);
                assert.strictEqual(marker["summary-buttons"], "2", `${theme}/${width}: debt and savings edit actions render`);
                assert.strictEqual(marker.pills, "17", `${theme}/${width}: all semantic status pills render`);
                assert.strictEqual(marker.cards, "5", `${theme}/${width}: debt, savings, and month cards render`);
                assert.strictEqual(marker.summaries, "7", `${theme}/${width}: all summary and band surfaces render`);
                assert.strictEqual(marker.progress, "4", `${theme}/${width}: summary progress tracks render`);
                assert.strictEqual(marker["summaries-fit"], "true", `${theme}/${width}: summaries do not clip or overflow (${marker["summary-overflow"] || "none"})`);
                assert.strictEqual(marker["tones-visible"], "true", `${theme}/${width}: summary status tones remain visible`);

                const first = path.join(temp, `${theme}-${width}-a.png`);
                const second = path.join(temp, `${theme}-${width}-b.png`);
                runChrome(executable, [...common, `--screenshot=${first}`, url]);
                runChrome(executable, [...common, `--screenshot=${second}`, url]);
                const firstBytes = fs.readFileSync(first);
                const secondBytes = fs.readFileSync(second);
                assert(firstBytes.length > 1000, `${theme}/${width}: screenshot is non-empty`);
                assert(firstBytes.subarray(1, 4).equals(Buffer.from("PNG")), `${theme}/${width}: screenshot is PNG`);
                assert.strictEqual(
                    crypto.createHash("sha256").update(firstBytes).digest("hex"),
                    crypto.createHash("sha256").update(secondBytes).digest("hex"),
                    `${theme}/${width}: repeated screenshot is deterministic`,
                );
            }
        }
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

(async () => {
    staticContract();
    await behaviorContract();
    visualContract();
    console.log("finance style adoption: PASS");
})().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
