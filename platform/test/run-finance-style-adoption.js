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
        for (const listener of this.listeners.get(type) || []) listener({ target: this, currentTarget: this });
        if (type === "click" && typeof this.onclick === "function") this.onclick({ target: this, currentTarget: this });
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
    if (/\b(?:btn|button)\.style\.cssText\s*=\s*[`"'][^\n]*(?:padding|border-radius|border:\s*1px)/i.test(combined)) failures.push("hand-rolled-button");
    if (/\b(?:aprBadge|chip)\.style\.cssText\s*=\s*[`"'][^\n]*(?:padding|border-radius)/i.test(combined)) failures.push("hand-rolled-pill");
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

    const buttonMutation = { ...sources, hub: `${sources.hub}\nbtn.style.cssText = "padding: 6px; border-radius: 6px;";` };
    assert(sharedChromeViolations(buttonMutation).includes("hand-rolled-button"), "button mutation turns the source guard red");
    const pillMutation = { ...sources, savings: `${sources.savings}\nchip.style.cssText = "padding: 2px; border-radius: 999px;";` };
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
}

function visualContract() {
    console.log("--- C6A-VISUAL: execute 1024/390 light/dark browser fixture ---");
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
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-c6a-visual-"));
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
                assert.strictEqual(marker.buttons, "7", `${theme}/${width}: all seven Finance destinations render`);
                assert.strictEqual(marker.pills, "4", `${theme}/${width}: all semantic status pills render`);
                assert.strictEqual(marker.cards, "5", `${theme}/${width}: debt, savings, and month cards render`);

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
