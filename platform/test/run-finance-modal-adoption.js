#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const MODAL_PATH = path.join(ROOT, "platform/mechanisms/modal/sauce-modal.js");
const BUDGET_PATH = path.join(ROOT, "platform/blueprints/finance/helpers/budget-defaults-editor.js");
const PAYCHECK_PATH = path.join(ROOT, "platform/blueprints/finance/helpers/paycheck-defaults-editor.js");
const VISUAL_PATH = path.join(ROOT, "platform/test/visual/finance-modal-adoption.html");
const plain = (value) => JSON.parse(JSON.stringify(value));

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName || "div").toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.style = { cssText: "" };
        this.attributes = {};
        this.listeners = new Map();
        this.className = "";
        this.textContent = "";
        this.value = "";
        this.disabled = false;
        this.isContentEditable = false;
        this.focused = false;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentNode = null;
        return child;
    }

    remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    addEventListener(type, listener) {
        const entries = this.listeners.get(type) || [];
        entries.push(listener);
        this.listeners.set(type, entries);
    }

    dispatch(type, event = {}) {
        event.target ||= this;
        event.currentTarget ||= this;
        for (const listener of this.listeners.get(type) || []) listener(event);
    }

    contains(target) {
        return target === this || this.children.some((child) => child.contains(target));
    }

    querySelector(selector) {
        if (selector === ":scope > .unused") return null;
        const candidates = this.walk();
        if (selector.startsWith(".")) {
            const wanted = selector.slice(1);
            return candidates.find((node) => node.className.split(/\s+/).includes(wanted)) || null;
        }
        const tags = selector.split(/[, ]/).map((part) => part.match(/^[a-z]+/i)?.[0]?.toUpperCase()).filter(Boolean);
        return candidates.find((node) => tags.includes(node.tagName) && !node.disabled) || null;
    }

    focus() { this.focused = true; }

    walk() {
        return this.children.flatMap((child) => [child, ...child.walk()]);
    }
}

class FakeDocument {
    constructor() {
        this.body = new FakeElement("body");
        this.listeners = new Map();
    }

    createElement(tagName) { return new FakeElement(tagName); }

    addEventListener(type, listener) {
        const entries = this.listeners.get(type) || [];
        entries.push(listener);
        this.listeners.set(type, entries);
    }

    removeEventListener(type, listener) {
        const entries = this.listeners.get(type) || [];
        this.listeners.set(type, entries.filter((entry) => entry !== listener));
    }

    key(key, target) {
        const event = {
            key,
            target,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
        };
        for (const listener of [...(this.listeners.get("keydown") || [])]) listener(event);
        return event;
    }
}

function loadHarness() {
    const document = new FakeDocument();
    const sandbox = {
        console,
        document,
        activeDocument: document,
        setTimeout: (fn) => fn(),
        clearTimeout: () => {},
        Date,
        Math,
        Promise,
        globalThis: null,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${fs.readFileSync(MODAL_PATH, "utf8")}\nthis.__SauceModal = SauceModal;`, sandbox);
    sandbox.customJS = { SauceModal: new sandbox.__SauceModal() };
    vm.runInContext(`${fs.readFileSync(BUDGET_PATH, "utf8")}\nthis.__BudgetDefaultsEditor = BudgetDefaultsEditor;`, sandbox);
    vm.runInContext(`${fs.readFileSync(PAYCHECK_PATH, "utf8")}\nthis.__PaycheckDefaultsEditor = PaycheckDefaultsEditor;`, sandbox);
    return {
        sandbox,
        document,
        modal: sandbox.customJS.SauceModal,
        budget: new sandbox.__BudgetDefaultsEditor(),
        paycheck: new sandbox.__PaycheckDefaultsEditor(),
    };
}

function mounted(document) {
    assert.strictEqual(document.body.children.length, 1, "exactly one SauceModal backdrop mounts");
    const backdrop = document.body.children[0];
    assert(backdrop.className.split(/\s+/).includes("sauce-modal-backdrop"), "shared backdrop class emitted");
    const modal = backdrop.walk().find((node) => node.className.split(/\s+/).includes("sauce-modal"));
    assert(modal, "shared modal class emitted");
    const buttons = backdrop.walk().filter((node) => node.tagName === "BUTTON");
    assert.strictEqual(buttons.length, 2, "shared footer owns cancel and submit buttons");
    assert(buttons.every((button) => button.className.split(/\s+/).includes("sauce-btn")), "every modal button uses sauce-btn");
    assert(buttons[1].className.split(/\s+/).includes("sauce-btn-accent") || buttons[1].className.split(/\s+/).includes("sauce-btn-danger"), "submit button has semantic tone");
    return { backdrop, modal, buttons, inputs: backdrop.walk().filter((node) => node.tagName === "INPUT"), selects: backdrop.walk().filter((node) => node.tagName === "SELECT") };
}

async function caseStaticContract() {
    console.log("--- C5A-STATIC: bounded sources use SauceModal and no legacy fixed overlay ---");
    const budget = fs.readFileSync(BUDGET_PATH, "utf8");
    const paycheck = fs.readFileSync(PAYCHECK_PATH, "utf8");
    for (const [name, source, opens] of [["budget", budget, 3], ["paycheck", paycheck, 2]]) {
        assert.strictEqual((source.match(/sauceModal\.open\s*\(/g) || []).length, opens, `${name} delegates every prompt surface`);
        assert(!/position:\s*fixed/i.test(source), `${name} has no legacy fixed overlay styling`);
        assert(!/document\.body\.(?:appendChild|removeChild)\s*\(/.test(source), `${name} does not mount or remove hand-rolled modal DOM`);
        assert(!/const\s+(?:overlay|dialog|cancelBtn|okBtn)\b/.test(source), `${name} has no legacy modal/button construction`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/blueprints/finance/manifest.json"), "utf8"));
    assert(manifest.depends_on.some((dep) => dep.name === "modal" && dep.range === ">=0.2.0"), "Finance declares modal >=0.2.0");
}

async function caseVisualFixtureContract() {
    console.log("--- C5A-VISUAL: maintained desktop/390 light/dark comparison fixture ---");
    const visual = fs.readFileSync(VISUAL_PATH, "utf8");
    assert(/<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1">/.test(visual), "fixture declares responsive viewport");
    assert(visual.includes("../../mechanisms/styling/assets/snippets/sauce-core.css"), "fixture loads shipped sauce-core CSS");
    assert(visual.includes('["light", "dark"]'), "fixture renders both accepted theme variants");
    assert(visual.includes('@media (max-width: 700px)'), "fixture carries a narrow-viewport comparison layout");
    assert(visual.includes('"paycheck-category-add-" + theme'), "fixture identifies Paycheck category-bearing add surface");
    assert(visual.includes('"trips-add-item-" + theme'), "fixture identifies Trips add-item reference");
    assert(visual.includes('dialog.className = "sauce-modal sauce-anim-pop"'), "both comparison surfaces use the shipped modal shell");
    assert(visual.includes('body.className = "sauce-modal-body"'), "both comparison surfaces use the shipped modal body");
    assert(visual.includes('footer.className = "sauce-modal-footer sauce-action-row"'), "both comparison surfaces use the responsive shipped footer");
    assert(visual.includes('save.className = "sauce-btn sauce-btn-accent"'), "both comparison surfaces expose an enabled semantic submit action");
    assert(!/\.sauce-modal\s*\{/.test(visual), "fixture does not fork modal-shell styling");
    assert(!/\.sauce-modal-footer\s*\{/.test(visual), "fixture does not fork modal-footer styling");
}

async function caseGroupSubmitAndConcurrency() {
    console.log("--- C5A-GROUP: Enter submit, validation, semantic buttons, single settlement ---");
    const h = loadHarness();
    let settlements = 0;
    const resultPromise = h.budget._promptForGroup(null, ["Existing"]).then((value) => { settlements += 1; return value; });
    const view = mounted(h.document);
    const input = view.inputs[0];
    h.document.key("Enter", input);
    assert.strictEqual(h.document.body.children.length, 1, "invalid Enter keeps dialog open");
    await Promise.resolve();
    input.value = "Housing";
    h.document.key("Enter", input);
    h.document.key("Enter", input);
    assert.strictEqual(await resultPromise, "Housing", "valid Enter preserves group result shape");
    assert.strictEqual(settlements, 1, "rapid repeated Enter settles once");
    assert.strictEqual(h.document.body.children.length, 0, "successful submit closes shared modal");
}

async function caseEscapeAndFailClosed() {
    console.log("--- C5A-CANCEL: Escape cancellation and missing/partial dependency fail closed ---");
    const h = loadHarness();
    const escapePromise = h.budget._promptForGroup("Housing", ["Housing"]);
    const view = mounted(h.document);
    h.document.key("Escape", view.inputs[0]);
    assert.strictEqual(await escapePromise, null, "Escape returns null");
    assert.strictEqual(h.document.body.children.length, 0, "Escape removes shared modal");

    h.sandbox.customJS.SauceModal = null;
    assert.strictEqual(await h.budget._promptForCategory(null, ["Core"]), null, "missing SauceModal returns null");
    assert.strictEqual(h.document.body.children.length, 0, "missing SauceModal mounts no DOM");
    h.sandbox.customJS.SauceModal = {};
    assert.strictEqual(await h.paycheck._promptForExpense(null), null, "partial SauceModal returns null");
    assert.strictEqual(h.document.body.children.length, 0, "partial SauceModal mounts no DOM");
}

async function caseBudgetShapes() {
    console.log("--- C5A-BUDGET-SHAPES: reassign and category callbacks remain exact ---");
    const h = loadHarness();
    const reassignPromise = h.budget._promptForReassign("Old", 2, [{ group: "New" }]);
    let view = mounted(h.document);
    view.selects[0].value = "New";
    await view.buttons[1].onclick({ target: view.buttons[1], currentTarget: view.buttons[1] });
    assert.strictEqual(await reassignPromise, "New", "reassign returns selected group string");

    const categoryPromise = h.budget._promptForCategory({ name: "Rent", group: "Core", planned: 1000 }, ["Core", "Extra"]);
    view = mounted(h.document);
    view.inputs[0].value = "Housing";
    view.inputs[1].value = "1250.5";
    view.selects[0].value = "Core";
    h.document.key("Enter", view.inputs[0]);
    assert.deepStrictEqual(plain(await categoryPromise), { name: "Housing", group: "Core", planned: 1250.5 }, "category shape unchanged");
}

async function casePaycheckShapes() {
    console.log("--- C5A-PAYCHECK-SHAPES: schedule and expense callbacks remain exact ---");
    const h = loadHarness();
    const schedulePromise = h.paycheck._promptForScheduleRow({ day: 15, amount: 2500 });
    let view = mounted(h.document);
    view.inputs[0].value = "16";
    view.inputs[1].value = "2600.25";
    h.document.key("Enter", view.inputs[0]);
    assert.deepStrictEqual(plain(await schedulePromise), { day: 16, amount: 2600.25 }, "schedule shape unchanged");

    h.paycheck._readBudgetDefaultCategoryNames = () => ["Bills", "Food"];
    const expensePromise = h.paycheck._promptForExpense({ item: "Rent", amount: 1000, category: "Bills", url: "https://example.test", deposit: 2 });
    view = mounted(h.document);
    const [item, amount, category, url, deposit] = view.inputs;
    item.value = "Mortgage";
    amount.value = "1500.75";
    category.value = "Bills";
    url.value = "https://bank.example";
    deposit.value = "2";
    h.document.key("Enter", item);
    assert.deepStrictEqual(plain(await expensePromise), {
        item: "Mortgage",
        amount: 1500.75,
        category: "Bills",
        url: "https://bank.example",
        deposit: 2,
    }, "expense shape unchanged");
}

(async () => {
    await caseStaticContract();
    await caseVisualFixtureContract();
    await caseGroupSubmitAndConcurrency();
    await caseEscapeAndFailClosed();
    await caseBudgetShapes();
    await casePaycheckShapes();
    console.log("finance modal adoption: PASS");
})().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
