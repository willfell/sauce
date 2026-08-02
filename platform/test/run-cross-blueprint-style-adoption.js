#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "../..");
const PROJECT = path.join(ROOT, "platform/blueprints/project/helpers");
const MODAL = path.join(ROOT, "platform/mechanisms/modal/sauce-modal.js");
const SECTION_EXPLORER = path.join(ROOT, "platform/mechanisms/section-explorer/section-explorer.js");
const PROJECT_CHROME_BAR = path.join(PROJECT, "project-chrome-bar.js");
const ACCENT_BUTTON = path.join(ROOT, "platform/mechanisms/accent-button/accent-button.js");
const SECTION_LABEL = path.join(ROOT, "platform/mechanisms/section-label/section-label.js");
const SAUCE_CORE_CSS = path.join(ROOT, "platform/mechanisms/styling/assets/snippets/sauce-core.css");
const VISUAL = path.join(ROOT, "platform/test/visual/cross-blueprint-style-adoption.html");
const MUTATION = process.env.C7A_MUTATION || "";
const MUTATION_CHILD = process.env.C7A_MUTATION_CHILD === "1";
const FILES = {
    nav: "project-nav-buttons.js",
    docs: "project-docs-index.js",
    section: "section-hub.js",
    links: "project-links-manager.js",
    leaf: "doc-leaf-actions.js",
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function source(name) {
    const raw = fs.readFileSync(path.join(PROJECT, FILES[name]), "utf8");
    if (!MUTATION) return raw;
    const mutations = {
        "button-adoption": ["nav", 'btn.classList.add("sauce-btn")', 'btn.classList.add("legacy-btn")'],
        "action-row": ["links", 'const row = c.createEl("div", { cls: "sauce-action-row" });', 'const row = c.createEl("div", { cls: "legacy-action-row" });'],
        "modal-delegation": ["links", '? globalThis.customJS.SauceModal : null', '? null : null'],
        "destination": ["nav", 'path: `${projectDir}/docs/Docs.md`', 'path: `${projectDir}/docs/Wrong.md`'],
        "mutation-delegate": ["leaf", "fm.section = patch.section;", 'fm.section = "wrong";'],
        "single-fire": ["links", "if (submitting) return false;", "if (false) return false;"],
        "r7a2-docs-delegate": ["docs", "return customJS.SectionExplorer.renderActionRow(dv, [", "return null && customJS.SectionExplorer.renderActionRow(dv, ["],
        "r7a2-docs-order": ["docs", '{ kind: "entity", instance: "doc-note" },\n      { kind: "entity", instance: "section-hub" },', '{ kind: "entity", instance: "section-hub" },\n      { kind: "entity", instance: "doc-note" },'],
        "r7a2-section-presets": ["section", "section: sectionName,", 'section: "Wrong",'],
        "r7a2-section-callback": ["section", "this._renderMoveDocsButton(dv, row)", "this._renderMoveDocsButton(null, row)"],
    };
    const [target, before, after] = mutations[MUTATION] || [];
    if (name !== target) return raw;
    assert(before && raw.includes(before), `mutation ${MUTATION} must match its production seam`);
    return raw.replace(before, after);
}
function classTokens(node) { return String(node.className || "").split(/\s+/).filter(Boolean); }

class FakeElement {
    constructor(tagName, className = "") {
        this.tagName = String(tagName || "div").toUpperCase();
        this.className = className;
        this.children = [];
        this.parentNode = null;
        this.parentElement = null;
        this.style = { cssText: "" };
        this.attributes = {};
        this.listeners = new Map();
        this.textContent = "";
        this.innerHTML = "";
        this.value = "";
        this.disabled = false;
        this.isContentEditable = false;
        this.focused = false;
        this.classList = {
            add: (...tokens) => {
                const set = new Set(classTokens(this));
                tokens.forEach((token) => set.add(token));
                this.className = [...set].join(" ");
            },
            contains: (token) => classTokens(this).includes(token),
        };
    }
    appendChild(child) { child.parentNode = this; child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentNode = null; child.parentElement = null;
        return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    createEl(tagName, options = {}) {
        const child = new FakeElement(tagName, options.cls || "");
        if (options.text != null) child.textContent = String(options.text);
        if (options.attr) Object.assign(child.attributes, options.attr);
        return this.appendChild(child);
    }
    createDiv(options = {}) { return this.createEl("div", options); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(type, listener) {
        const entries = this.listeners.get(type) || [];
        entries.push(listener); this.listeners.set(type, entries);
    }
    dispatch(type, event = {}) {
        event.target ||= this; event.currentTarget ||= this;
        event.preventDefault ||= () => { event.defaultPrevented = true; };
        for (const listener of this.listeners.get(type) || []) listener(event);
        if (type === "click" && typeof this.onclick === "function") return this.onclick(event);
    }
    click() { return this.dispatch("click", { target: this }); }
    focus() { this.focused = true; }
    contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
    closest() { return null; }
    empty() { this.children = []; }
    walk() { return this.children.flatMap((child) => [child, ...child.walk()]); }
    querySelectorAll(selector) {
        if (selector === "button") return this.walk().filter((node) => node.tagName === "BUTTON");
        if (selector.startsWith(".")) return this.walk().filter((node) => classTokens(node).includes(selector.slice(1)));
        return [];
    }
    querySelector(selector) {
        if (selector.startsWith(":scope > .")) {
            const wanted = selector.slice(10);
            return this.children.find((node) => classTokens(node).includes(wanted)) || null;
        }
        if (selector.startsWith(".")) return this.walk().find((node) => classTokens(node).includes(selector.slice(1))) || null;
        const tags = selector.split(/[, ]/).map((part) => part.match(/^[a-z]+/i)?.[0]?.toUpperCase()).filter(Boolean);
        return this.walk().find((node) => tags.includes(node.tagName) && !node.disabled) || null;
    }
}

class FakeDocument {
    constructor() { this.body = new FakeElement("body"); this.listeners = new Map(); }
    createElement(tagName) { return new FakeElement(tagName); }
    querySelector(selector) { return this.body.querySelector(selector); }
    addEventListener(type, listener) {
        const entries = this.listeners.get(type) || [];
        entries.push(listener); this.listeners.set(type, entries);
    }
    removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
    }
    key(key, target) {
        const event = { key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const listener of [...(this.listeners.get("keydown") || [])]) listener(event);
        return event;
    }
}

function loadHarness() {
    const document = new FakeDocument();
    const notices = [];
    const sandbox = {
        console, document, activeDocument: document, Date, Math, Promise,
        setTimeout: (fn) => fn(), clearTimeout: () => {},
        Notice: function Notice(message) { notices.push(String(message)); },
        globalThis: null, window: null,
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${fs.readFileSync(MODAL, "utf8")}\nthis.__SauceModal = SauceModal;`, sandbox);
    sandbox.customJS = {
        SauceModal: new sandbox.__SauceModal(),
        AccentButton: {
            render(parent, options) {
                const button = parent.createEl("button");
                button.innerHTML = `<span>${options.label}</span>`;
                button.textContent = options.label;
                button.style.cssText = "legacy button geometry";
                button.onmouseenter = () => {};
                button.onmouseleave = () => {};
                button.onclick = options.onClick;
                return button;
            },
        },
        SectionLabel: { divider(parent) { (parent.container || parent).createEl("div", { cls: "fixture-divider" }); } },
        RenderSafe: {
            page: (dv) => (dv && typeof dv.current === "function" ? dv.current() : null),
            async mutate(opts) {
                if (opts.optimistic) await opts.optimistic();
                try { return { ok: true, value: await opts.write() }; }
                catch (error) { if (opts.revert) await opts.revert(error); return { ok: false, error }; }
            },
            async mutateStructure(opts) {
                let receipt;
                try {
                    receipt = await opts.apply();
                    return { ok: true, value: await opts.write(), receipt };
                } catch (error) {
                    if (receipt !== undefined) await opts.rollback(receipt, error);
                    return { ok: false, error, receipt };
                }
            },
        },
    };
    vm.runInContext(`${fs.readFileSync(SECTION_EXPLORER, "utf8")}\nthis.__SectionExplorer = SectionExplorer;`, sandbox);
    sandbox.customJS.SectionExplorer = new sandbox.__SectionExplorer();
    for (const [name, className] of [
        ["nav", "ProjectNavButtons"], ["docs", "ProjectDocsIndex"], ["section", "SectionHub"],
        ["links", "ProjectLinksManager"], ["leaf", "DocLeafActions"],
    ]) {
        vm.runInContext(`${source(name)}\nthis.__${className} = ${className};`, sandbox);
    }
    return {
        sandbox, document, notices,
        nav: new sandbox.__ProjectNavButtons(), docs: new sandbox.__ProjectDocsIndex(),
        section: new sandbox.__SectionHub(), links: new sandbox.__ProjectLinksManager(),
        leaf: new sandbox.__DocLeafActions(),
    };
}

function buttons(root) { return [root, ...root.walk()].filter((node) => node.tagName === "BUTTON"); }
function mounted(document) {
    assert.strictEqual(document.body.children.length, 1, "exactly one shared backdrop mounts");
    const backdrop = document.body.children[0];
    assert(classTokens(backdrop).includes("sauce-modal-backdrop"), "real SauceModal backdrop mounted");
    assert(backdrop.walk().some((node) => classTokens(node).includes("sauce-modal")), "real SauceModal shell mounted");
    return { backdrop, buttons: buttons(backdrop), inputs: backdrop.walk().filter((node) => node.tagName === "INPUT") };
}

function staticContract() {
    console.log("--- C7A-STATIC: current dependencies and shared ownership ---");
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/blueprints/project/manifest.json"), "utf8"));
    assert(manifest.depends_on.some((dep) => dep.name === "modal" && dep.range === ">=0.2.0"), "Project declares modal >=0.2.0");
    assert(manifest.depends_on.some((dep) => dep.name === "styling" && dep.range === ">=0.3.0"), "Project declares styling >=0.3.0");
    const sources = Object.fromEntries(Object.keys(FILES).map((name) => [name, source(name)]));
    const combined = Object.values(sources).join("\n");
    const harnessSource = fs.readFileSync(__filename, "utf8");
    assert(!/\bnew\s+WebSocket\s*\(/.test(harnessSource), "exact viewport proof does not require the Node 21+ global WebSocket API");
    assert(harnessSource.includes("net.createConnection") && harnessSource.includes("clientFrame"), "exact viewport proof uses only the supported Node built-in CDP transport");
    assert(!/_mobilize|_styleLeafBtn/.test(combined), "all four duplicated responsive sizing helpers are deleted");
    for (const name of ["nav", "links", "leaf"]) {
        assert(sources[name].includes("sauce-action-row"), `${name} adopts sauce-action-row`);
        assert(sources[name].includes("sauce-btn"), `${name} adopts sauce-btn`);
    }
    const explorer = fs.readFileSync(SECTION_EXPLORER, "utf8");
    assert(explorer.includes("async renderActionRow(dv, actions"), "SectionExplorer publishes the shared action-row renderer");
    for (const name of ["docs", "section"]) {
        assert(sources[name].includes("customJS.SectionExplorer.renderActionRow"), `${name} delegates to SectionExplorer action-row ownership`);
        assert(!sources[name].includes("for (const btn of"), `${name} removes its local final-button normalization loop`);
        assert(!sources[name].includes("await customJS.EntityCreate.render"), `${name} removes direct EntityCreate dispatch`);
        assert(!sources[name].includes('createEl("div", { cls: "sauce-action-row" })'), `${name} removes its local action-row shell`);
        assert(!sources[name].includes("for (let i = 0; i < 40"), `${name} removes its local EntityCreate cold-load poll`);
    }
    console.log("--- R7A-CURRENT-SOURCE: exactly two delegates; ProjectChromeBar stays outside the extraction ---");
    const actionRowCallers = fs.readdirSync(PROJECT)
        .filter((name) => name.endsWith(".js"))
        .filter((name) => fs.readFileSync(path.join(PROJECT, name), "utf8").includes("SectionExplorer.renderActionRow"))
        .sort();
    assert.deepStrictEqual(actionRowCallers, ["project-docs-index.js", "section-hub.js"], "current source has exactly the two ratified production callers");
    assert(!fs.readFileSync(PROJECT_CHROME_BAR, "utf8").includes("SectionExplorer.renderActionRow"), "ProjectChromeBar remains outside the extraction; no stale third caller is recreated");
    for (const name of ["links", "leaf"]) {
        assert(!/position:\s*fixed/i.test(sources[name]), `${name} contains no raw fixed modal shell`);
        assert(!/document\.body\.(?:appendChild|removeChild)/.test(sources[name]), `${name} never mounts hand-rolled modal DOM`);
    }
    for (const method of ["_promptForTitle", "_openWorkstreamPicker"]) {
        const start = sources.nav.indexOf(`${method}(`);
        const body = sources.nav.slice(start, sources.nav.indexOf("\n    }", start) + 6);
        assert(body.includes("globalThis.customJS") && body.includes("SauceModal"), `${method} resolves the real global SauceModal`);
        assert(!body.includes("document.createElement"), `${method} does not construct a raw overlay`);
    }
    assert(sources.links.includes("globalThis.customJS.SauceModal") && sources.leaf.includes("globalThis.customJS.SauceModal"), "link and doc move dialogs resolve real global SauceModal");

}

async function actionRowContract() {
    console.log("--- C7A-ACTIONS: ordered actions, semantic DOM, and exact delegates ---");
    const h = loadHarness();
    const legacy = h.sandbox.customJS.AccentButton.render(new FakeElement("div"), { label: "X", onClick: () => {} });
    h.nav._adoptButton(legacy);
    assert(classTokens(legacy).includes("sauce-btn") && legacy.style.cssText === "", "ProjectNavButtons strips legacy visual state");
    assert.strictEqual(legacy.onmouseenter, null); assert.strictEqual(legacy.onmouseleave, null);

    const opened = [];
    h.sandbox.app = {
        vault: { getAbstractFileByPath: (target) => target === "spice/projects/sauce/Sauce.md" ? { path: target } : null },
        workspace: { getLeaf: () => ({ openFile: (file) => opened.push(file.path) }), openLinkText: (target) => opened.push(target) },
    };
    h.nav._openNavTarget("spice/projects/sauce/Sauce.md");
    h.nav._openNavTarget("spice/projects/sauce/docs/Docs.md");
    assert.deepStrictEqual(opened, ["spice/projects/sauce/Sauce.md", "spice/projects/sauce/docs/Docs.md"], "absolute destination and cold-cache fallback are unchanged");
    assert.deepStrictEqual(plain(h.nav._partitionButtons([
        { label: "Project" }, { label: "Map" }, { label: "Docs" }, { label: "To-Do" }, { label: "Helpful Links" },
    ])), {
        core: [{ label: "Project" }, { label: "Docs" }],
        overflow: [{ label: "Map" }, { label: "To-Do" }, { label: "Helpful Links" }],
    }, "legacy destination partition and order are unchanged");
    assert.deepStrictEqual(plain(h.docs._actionRowSpec()), [
        { id: "doc-note", kind: "entity" }, { id: "section-hub", kind: "entity" }, { id: "move-docs", kind: "move" },
    ], "Docs actions retain exact order");

    const creates = [];
    const bulkMoveDvs = [];
    h.sandbox.customJS.EntityCreate = { render: async (dv, opts) => {
        creates.push({ instance: opts.instance, presetPrompts: opts.presetPrompts });
        const button = dv.container.createEl("button", { text: opts.instance });
        button.style.cssText = "legacy entity geometry";
        button.onmouseenter = () => {}; button.onmouseleave = () => {};
    } };
    h.sandbox.customJS.DocBulkMoveActions = { _onBulkMove: (receivedDv) => { bulkMoveDvs.push(receivedDv); } };
    const docsDv = {
        container: new FakeElement("div"),
        current: () => ({ file: { folder: "spice/projects/sauce/docs" } }),
        pages: () => [], el: () => {}, header: () => {}, paragraph: () => {},
    };
    await h.docs.renderActionRow(docsDv);
    const docsRow = docsDv.container.querySelector(".sauce-action-row");
    assert(docsRow, "Docs renders the shared action row");
    assert(buttons(docsRow).every((button) => classTokens(button).includes("sauce-btn") && button.style.cssText === ""), "Docs normalizes every entity/action button");
    await buttons(docsRow)[2].click();
    assert.deepStrictEqual(plain(creates), [
        { instance: "doc-note" }, { instance: "section-hub" },
    ], "Docs preserves exact entity order without inventing presets");
    assert.strictEqual(bulkMoveDvs.length, 1);
    assert.strictEqual(bulkMoveDvs[0], docsDv, "Docs Move callback preserves the exact originating dv identity");

    const atlas = { path: "spice/projects/sauce/Sauce.md", basename: "Sauce", name: "Sauce" };
    const map = { path: "spice/projects/sauce/Project Map.md", basename: "Project Map", name: "Project Map" };
    const doc = { path: "spice/projects/sauce/docs/Decision.md", basename: "Decision", name: "Decision" };
    const todo = { path: "spice/projects/sauce/Sauce To-Do.md", basename: "Sauce To-Do", name: "Sauce To-Do" };
    const links = { path: "spice/projects/sauce/Links Hub.md", basename: "Links Hub", name: "Links Hub" };
    const board = { path: "spice/projects/sauce/sauce-board.md", basename: "sauce-board", name: "sauce-board" };
    const docsHub = { path: "spice/projects/sauce/docs/Docs.md", basename: "Docs", name: "Docs" };
    const files = [atlas, map, doc, todo, links, board, docsHub];
    const fmByPath = new Map([
        [atlas.path, { type: "project", workstreams: [] }], [map.path, { type: "map" }],
        [doc.path, { type: "doc-note" }], [todo.path, { type: "project-todo" }], [links.path, { type: "links-hub" }],
    ]);
    const renderedOpened = [];
    h.sandbox.app = {
        isMobile: false,
        vault: {
            getFiles: () => files,
            getAbstractFileByPath: (target) => files.find((file) => file.path === target) || null,
        },
        metadataCache: { getFileCache: (file) => ({ frontmatter: fmByPath.get(file.path) || {} }) },
        workspace: {
            getLeaf: () => ({ openFile: (file) => renderedOpened.push(file.path) }),
            openLinkText: (target) => renderedOpened.push(target),
        },
    };
    const navDv = { container: new FakeElement("div"), current: () => ({ type: "doc-note", file: doc }) };
    await h.nav.render(navDv);
    const renderedRow = navDv.container.querySelector(".sauce-action-row");
    const renderedButtons = buttons(renderedRow);
    assert.deepStrictEqual(renderedButtons.map((button) => button.textContent), ["Sauce", "Project Board", "Docs", "More"], "actual ProjectNavButtons.render preserves core order and More");
    for (const button of renderedButtons.slice(0, 3)) await button.click();
    const more = renderedButtons[3];
    const overflowLabels = [];
    for (let index = 0; index < 3; index += 1) {
        await more.click();
        const overlay = h.document.body.querySelector(".pnb-more-overlay");
        assert(overlay, "actual More delegate mounts its production menu");
        const rows = overlay.querySelectorAll("button");
        if (index === 0) overflowLabels.push(...rows.map((row) => row.innerHTML.match(/<span[^>]*>([^<]+)<\/span>$/)?.[1] || ""));
        await rows[index].click();
    }
    assert.deepStrictEqual(overflowLabels, ["Map", "To-Do", "Helpful Links"], "actual More menu preserves overflow order");
    assert.deepStrictEqual(renderedOpened, [atlas.path, board.path, docsHub.path, map.path, todo.path, links.path], "actual render clicks preserve every absolute Project destination");

    creates.length = 0;
    const sectionDv = {
        container: new FakeElement("div"), current: () => ({}),
        pages: () => [], el: () => {}, header: () => {}, paragraph: () => {},
    };
    await h.section._renderActionRow(sectionDv, {}, 1, "sauce", "knowledge", "Knowledge");
    const sectionRow = sectionDv.container.querySelector(".sauce-action-row");
    assert(buttons(sectionRow).every((button) => classTokens(button).includes("sauce-btn") && button.style.cssText === ""), "SectionHub normalizes every action");
    assert.deepStrictEqual(plain(creates), [
        { instance: "doc-note", presetPrompts: { section: "Knowledge", section_slug: "knowledge", sub_section: "", sub_section_slug: "" } },
        { instance: "sub-section-hub", presetPrompts: { parent_slug: "knowledge" } },
    ], "depth-1 SectionHub preserves exact create order and presets");
    await buttons(sectionRow)[2].click();
    assert.strictEqual(bulkMoveDvs.length, 2, "depth-1 SectionHub preserves the Move docs callback");
    assert.strictEqual(bulkMoveDvs[1], sectionDv, "depth-1 Move callback preserves the exact originating dv identity");

    creates.length = 0;
    const subSectionDv = {
        container: new FakeElement("div"), current: () => ({}),
        pages: () => [], el: () => {}, header: () => {}, paragraph: () => {},
    };
    await h.section._renderActionRow(subSectionDv, { parent_section: "[[Knowledge]]" }, 2, "sauce", "decisions", "Decisions");
    const subSectionRow = subSectionDv.container.querySelector(".sauce-action-row");
    assert.deepStrictEqual(plain(creates), [
        { instance: "doc-note", presetPrompts: { section: "Knowledge", section_slug: "knowledge", sub_section: "Decisions", sub_section_slug: "decisions" } },
    ], "depth-2 SectionHub preserves exact doc presets and hides New Sub-Section");
    assert.deepStrictEqual(buttons(subSectionRow).map((button) => button.textContent), ["doc-note", "Move docs"], "depth-2 action order remains New Doc then Move docs");
    await buttons(subSectionRow)[1].click();
    assert.strictEqual(bulkMoveDvs.length, 3, "depth-2 SectionHub preserves the Move docs callback");
    assert.strictEqual(bulkMoveDvs[2], subSectionDv, "depth-2 Move callback preserves the exact originating dv identity");
}

async function modalContract() {
    console.log("--- C7A-MODALS: real shell, validation, single-fire, cancel, and mutations ---");
    const h = loadHarness();
    const writes = [];
    const renames = [];
    let currentLinks = [];
    const existingPaths = new Set([
        "spice/projects/sauce/Links Hub.md",
        "spice/projects/sauce/tasks/Card.md",
        "spice/projects/sauce/docs/knowledge/Old.md",
        "spice/projects/sauce/docs/collision/Old.md",
    ]);
    h.sandbox.app = {
        vault: {
            getAbstractFileByPath: (target) => existingPaths.has(target) ? { path: target } : null,
            getMarkdownFiles: () => [],
        },
        workspace: { getActiveFile: () => ({ path: "spice/projects/sauce/docs/knowledge/Old.md" }) },
        fileManager: {
            processFrontMatter: async (file, mutate) => {
                const fm = file.fm || {};
                mutate(fm); file.fm = fm;
                writes.push({ path: file.path, fm: JSON.parse(JSON.stringify(fm)) });
            },
            renameFile: async (file, target) => { renames.push([file.path, target]); file.path = target; },
        },
    };
    const dv = { container: new FakeElement("div"), current: () => ({ type: "links-hub", file: { path: "spice/projects/sauce/Links Hub.md" }, links: currentLinks }) };
    await h.links.render(dv);
    const actionRow = dv.container.querySelector(".sauce-action-row");
    assert(actionRow && buttons(actionRow).every((button) => classTokens(button).includes("sauce-btn")), "link actions use shared classes");

    await buttons(actionRow)[0].click();
    let modal = mounted(h.document);
    modal.inputs[0].value = "https://example.com"; modal.inputs[1].value = "Example";
    await Promise.all([modal.buttons.at(-1).click(), modal.buttons.at(-1).click()]);
    assert.strictEqual(writes.length, 1, "double Save produces one link write");
    assert.deepStrictEqual(writes[0].fm.links, [{ url: "https://example.com", text: "Example" }], "add mutation is unchanged");
    assert.strictEqual(h.document.body.children.length, 0, "successful submit closes through SauceModal");
    console.log("  link add/save single-fire: PASS");

    writes.length = 0;
    h.links._openForm({ title: "Keyboard link", url: "", text: "" }, async ({ url, text }) => {
        writes.push({ url, text }); return true;
    });
    modal = mounted(h.document); modal.inputs[0].value = "https://keyboard.example"; modal.inputs[1].value = "Keyboard";
    h.document.key("Enter", modal.inputs[0]);
    modal.inputs[0].dispatch("keydown", { key: "Enter", isComposing: false });
    assert(modal.inputs[1].focused && writes.length === 0 && h.document.body.children.length === 1, "URL Enter stays local and focuses Link text without submitting");
    h.document.key("Enter", modal.inputs[1]);
    modal.inputs[1].dispatch("keydown", { key: "Enter", isComposing: false });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(writes, [{ url: "https://keyboard.example", text: "Keyboard" }], "Link-text Enter submits exactly once through the local guard");
    assert.strictEqual(h.document.body.children.length, 0, "Link-text Enter closes through SauceModal");

    const cancelled = h.links._openForm({ title: "Add link", url: "", text: "" }, async () => true);
    assert(cancelled); modal = mounted(h.document); await modal.buttons[0].click();
    assert.strictEqual(h.document.body.children.length, 0, "Cancel closes once through the shared shell");
    console.log("  link cancel: PASS");

    currentLinks = [{ url: "https://old.example", text: "Old" }];
    await buttons(actionRow)[1].click();
    modal = mounted(h.document);
    const edit = modal.backdrop.walk().find((node) => node.textContent === "Edit");
    await edit.click();
    assert.strictEqual(h.document.body.children.length, 1, "Edit replaces Manage with exactly one form modal");
    modal = mounted(h.document); modal.inputs[0].value = "https://new.example"; modal.inputs[1].value = "New";
    await modal.buttons.at(-1).click();
    assert.deepStrictEqual(writes.at(-1).fm.links, [{ url: "https://new.example", text: "New" }], "edit mutation is unchanged");
    console.log("  link edit: PASS");

    writes.length = 0;
    await buttons(actionRow)[1].click();
    modal = mounted(h.document);
    const remove = modal.backdrop.walk().find((node) => node.textContent === "Delete");
    await Promise.all([remove.click(), remove.click()]);
    assert.strictEqual(writes.length, 1, "double Delete produces one link write");
    assert.deepStrictEqual(writes[0].fm.links, [], "delete mutation is unchanged");
    console.log("  link delete single-fire: PASS");

    const titlePromise = h.nav._promptForTitle("spice/projects/sauce/tasks/T/notes");
    modal = mounted(h.document); modal.inputs[0].value = "Decision";
    await modal.buttons.at(-1).click();
    assert.strictEqual(await titlePromise, "Decision", "title submit returns the exact title");
    const cancelPromise = h.nav._promptForTitle("spice/projects/sauce/tasks/T/notes");
    modal = mounted(h.document); await modal.buttons[0].click();
    assert.strictEqual(await cancelPromise, null, "title cancel resolves null");
    console.log("  title submit/cancel: PASS");

    writes.length = 0;
    const picker = h.nav._openWorkstreamPicker([
        { id: "one", name: "One" }, { id: "two", name: "Two", description: "Second" },
    ], "one", "spice/projects/sauce/tasks/Card.md", null, { file: { path: "spice/projects/sauce/tasks/Card.md" }, workstream: "one" });
    assert(picker); modal = mounted(h.document);
    const two = modal.backdrop.walk().find((node) => node.tagName === "BUTTON" && node.walk().some((child) => child.textContent === "Two"));
    await Promise.all([two.click(), two.click()]);
    assert.strictEqual(writes.length, 1, "double workstream click produces one write");
    assert.strictEqual(writes[0].fm.workstream, "two", "workstream assignment delegate is unchanged");
    writes.length = 0;
    h.nav._openWorkstreamPicker([{ id: "one", name: "One" }], "", "spice/projects/sauce/tasks/Card.md", null, { file: { path: "spice/projects/sauce/tasks/Card.md" } });
    modal = mounted(h.document); await modal.buttons.find((button) => button.textContent === "Cancel").click();
    assert.strictEqual(writes.length, 0, "workstream Cancel suppresses every mutation");
    console.log("  workstream single-fire: PASS");

    h.sandbox.customJS.DocMove = {
        sectionTargets: () => [
            { label: "Collision", folder: "spice/projects/sauce/docs/collision", section: "Collision", subSection: "" },
            { label: "Notes", folder: "spice/projects/sauce/docs/notes", section: "Notes", subSection: "" },
        ],
        isSameLocation: () => false,
        targetPath: (folder) => `${folder}/Old.md`,
        rewriteSection: (_fm, section, subSection) => ({ section, sub_section: subSection }),
    };
    h.leaf._listSectionHubs = () => [
        { section: "Collision", file: { path: "spice/projects/sauce/docs/collision/Collision.md" }, depth: 1 },
        { section: "Notes", file: { path: "spice/projects/sauce/docs/notes/Notes.md" }, depth: 1 },
    ];
    const moveDv = { current: () => ({ file: { path: "spice/projects/sauce/docs/knowledge/Old.md" } }) };
    h.leaf._onMove(moveDv);
    modal = mounted(h.document); await modal.buttons.find((button) => button.textContent === "Cancel").click();
    assert.strictEqual(renames.length, 0, "doc-move Cancel suppresses rename and frontmatter mutation");
    h.leaf._onMove(moveDv);
    modal = mounted(h.document);
    const collision = modal.backdrop.walk().find((node) => node.tagName === "BUTTON" && node.textContent === "Collision");
    await collision.click();
    assert.strictEqual(renames.length, 0, "collision rejects before rename");
    assert.strictEqual(h.document.body.children.length, 1, "collision keeps the shared modal open for recovery");
    const target = modal.backdrop.walk().find((node) => node.tagName === "BUTTON" && node.textContent === "Notes");
    await Promise.all([target.click(), target.click()]);
    assert.strictEqual(renames.length, 1, "a post-collision retry works and double destination click produces one rename");
    assert.deepStrictEqual(renames, [["spice/projects/sauce/docs/knowledge/Old.md", "spice/projects/sauce/docs/notes/Old.md"]], "doc destination is unchanged");
    assert.deepStrictEqual(writes.at(-1).fm, { section: "Notes", sub_section: "" }, "doc frontmatter rewrite is unchanged");
    console.log("  doc move: PASS");

    const realModal = h.sandbox.customJS.SauceModal;
    h.sandbox.customJS.SauceModal = null;
    const missingTitle = h.nav._promptForTitle("spice/projects/sauce/tasks/T/notes");
    assert.strictEqual(h.links._openModal({ title: "No", build: () => { throw new Error("must not build"); } }), null);
    assert.strictEqual(h.leaf._openModal({ title: "No", build: () => { throw new Error("must not build"); } }), null);
    assert.strictEqual(h.nav._openWorkstreamPicker([], "", "x"), null);
    assert.strictEqual(await missingTitle, null, "title prompt fails closed with a settled null result");
    assert.strictEqual(h.document.body.children.length, 0, "missing dependency fails closed before any DOM mounts");
    h.sandbox.customJS.SauceModal = realModal;
    const warmRetry = h.nav._promptForTitle("spice/projects/sauce/tasks/T/notes");
    modal = mounted(h.document); await modal.buttons[0].click();
    assert.strictEqual(await warmRetry, null, "a warm retry works after the missing-modal failure");
    assert.strictEqual(h.document.body.children.length, 0, "warm retry leaves no modal DOM after cancel");
}

function chromeExecutable() {
    return [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
        .filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null;
}
function runChrome(executable, args) {
    const result = childProcess.spawnSync(executable, args, { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    assert.strictEqual(result.status, 0, `headless Chrome failed: ${result.stderr || result.error || "unknown error"}`);
    return result.stdout || "";
}
function markerData(html) {
    const tag = String(html).match(/<meta\s+id="fixture-results"[^>]*>/i)?.[0];
    assert(tag, "executed fixture emits results");
    return Object.fromEntries([...tag.matchAll(/data-([a-z0-9-]+)="([^"]*)"/gi)].map((match) => [match[1], match[2]]));
}
function pngDimensions(buffer) {
    assert(buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "capture is a non-empty PNG");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", () => resolve(true)));
    if (await Promise.race([exited, wait(5000).then(() => false)])) return;
    child.kill("SIGTERM");
    if (await Promise.race([exited, wait(5000).then(() => false)])) return;
    child.kill("SIGKILL");
    await Promise.race([exited, wait(5000)]);
}
async function removeTreeWithRetry(target) {
    let lastError;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try { fs.rmSync(target, { recursive: true, force: true }); return; }
        catch (error) {
            if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
            lastError = error;
            await wait(100);
        }
    }
    throw lastError;
}
function createCdpTarget(port, url) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: "127.0.0.1", port, method: "PUT",
            path: `/json/new?${encodeURIComponent(url)}`,
        }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8");
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`Chrome creates a DevTools target (${response.statusCode}): ${body}`));
                    return;
                }
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        });
        request.on("error", reject);
        request.end();
    });
}
function clientFrame(text, opcode = 1) {
    const payload = Buffer.from(text);
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
        header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length <= 0xffff) {
        header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2);
    } else {
        header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
    return Buffer.concat([header, mask, masked]);
}
function connectCdpSocket(endpoint) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(endpoint);
        const key = crypto.randomBytes(16).toString("base64");
        const expectedAccept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
        const stream = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
        let buffer = Buffer.alloc(0);
        let handshaken = false;
        let fragmented = [];
        const messageListeners = new Set();
        const client = {
            send(text) { stream.write(clientFrame(text)); },
            onMessage(listener) { messageListeners.add(listener); },
            close() { if (!stream.destroyed) { stream.write(clientFrame("", 8)); stream.end(); } },
        };
        const consumeFrames = () => {
            while (buffer.length >= 2) {
                const first = buffer[0]; const second = buffer[1];
                const fin = !!(first & 0x80); const opcode = first & 0x0f; const masked = !!(second & 0x80);
                let length = second & 0x7f; let offset = 2;
                if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
                else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
                const maskOffset = masked ? 4 : 0;
                if (buffer.length < offset + maskOffset + length) return;
                const mask = masked ? buffer.subarray(offset, offset + 4) : null;
                const payload = Buffer.from(buffer.subarray(offset + maskOffset, offset + maskOffset + length));
                buffer = buffer.subarray(offset + maskOffset + length);
                if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
                if (opcode === 8) { stream.end(); continue; }
                if (opcode === 9) { stream.write(clientFrame(payload, 10)); continue; }
                if (opcode === 1 || opcode === 0) fragmented.push(payload);
                if (fin && (opcode === 1 || opcode === 0)) {
                    const message = Buffer.concat(fragmented).toString("utf8"); fragmented = [];
                    for (const listener of messageListeners) listener(message);
                }
            }
        };
        stream.on("connect", () => {
            stream.write([
                `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
                `Host: ${parsed.host}`, "Upgrade: websocket", "Connection: Upgrade",
                `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13", "", "",
            ].join("\r\n"));
        });
        stream.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (!handshaken) {
                const boundary = buffer.indexOf("\r\n\r\n");
                if (boundary < 0) return;
                const header = buffer.subarray(0, boundary).toString("utf8");
                buffer = buffer.subarray(boundary + 4);
                if (!/^HTTP\/1\.1 101\b/m.test(header) || !header.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)) {
                    reject(new Error(`Chrome DevTools WebSocket handshake failed: ${header}`)); stream.destroy(); return;
                }
                handshaken = true; resolve(client);
            }
            consumeFrames();
        });
        stream.on("error", reject);
    });
}
async function exactViewportCapture(executable, url, width, height) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-r7a2-cdp-"));
    const chrome = childProcess.spawn(executable, [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
        "--allow-file-access-from-files", "--force-prefers-reduced-motion",
        "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });
    let socket;
    let sendCommand;
    try {
        const portFile = path.join(profile, "DevToolsActivePort");
        for (let attempt = 0; attempt < 100 && !fs.existsSync(portFile); attempt += 1) await wait(50);
        assert(fs.existsSync(portFile), "Chrome publishes its DevTools endpoint");
        const port = fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0];
        const target = await createCdpTarget(port, url);
        socket = await connectCdpSocket(target.webSocketDebuggerUrl);
        let nextId = 0;
        const pending = new Map();
        socket.onMessage((data) => {
            const message = JSON.parse(data);
            if (!message.id || !pending.has(message.id)) return;
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result || {});
        });
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++nextId;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        });
        sendCommand = send;
        await send("Page.enable");
        await send("Runtime.enable");
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await send("Page.navigate", { url });
        let marker = null;
        for (let attempt = 0; attempt < 200 && !marker; attempt += 1) {
            const evaluation = await send("Runtime.evaluate", {
                expression: `(()=>{const m=document.querySelector("#fixture-results");return m?Object.fromEntries(Object.entries(m.dataset)):null})()`,
                returnByValue: true,
            });
            marker = evaluation.result?.value || null;
            if (!marker) await wait(50);
        }
        assert(marker, "exact-viewport fixture emits results");
        const first = Buffer.from((await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false })).data, "base64");
        const second = Buffer.from((await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false })).data, "base64");
        return { marker, first, second };
    } finally {
        if (sendCommand) {
            const gracefulClose = sendCommand("Browser.close").catch(() => {});
            await Promise.race([gracefulClose, wait(1000)]);
        }
        if (socket) socket.close();
        await stopChild(chrome);
        await removeTreeWithRetry(profile);
    }
}
function actionRowVisualFixture() {
    const fileUrl = (file) => pathToFileURL(file).href;
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${fileUrl(SAUCE_CORE_CSS)}">
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--size-4-2:8px}
body.theme-light{--background-primary:#fff;--background-secondary:#f4f4f6;--background-modifier-border:#dedee3;--background-modifier-border-hover:#c8c8ce;--background-modifier-hover:rgba(0,0,0,.06);--text-normal:#202124;--text-muted:#65666b;--interactive-accent:#6d5ce8;--interactive-accent-hover:#5e4fd0;--text-on-accent:#fff}
body.theme-dark{--background-primary:#1d1e20;--background-secondary:#28292c;--background-modifier-border:#3b3c40;--background-modifier-border-hover:#4b4d52;--background-modifier-hover:rgba(255,255,255,.08);--text-normal:#e6e6e8;--text-muted:#a3a4aa;--interactive-accent:#8a7cf0;--interactive-accent-hover:#9c90f5;--text-on-accent:#fff}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--background-secondary);color:var(--text-normal)}main{width:min(100%,980px);margin:auto;padding:16px}.surface{min-width:0;width:100%;margin-bottom:14px;padding:14px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-primary)}.label{margin-bottom:8px;color:var(--text-muted);font-size:12px;font-weight:700}.mount{min-width:0;width:100%}
@media(max-width:700px){main{padding:10px}}
</style></head><body><main>
<section class="surface"><div class="label">ProjectDocsIndex.renderActionRow</div><div id="docs" class="mount"></div></section>
<section class="surface"><div class="label">SectionHub depth 1</div><div id="section" class="mount"></div></section>
<section class="surface"><div class="label">SectionHub depth 2</div><div id="subsection" class="mount"></div></section>
</main>
<script src="${fileUrl(SECTION_EXPLORER)}"></script><script src="${fileUrl(ACCENT_BUTTON)}"></script><script src="${fileUrl(SECTION_LABEL)}"></script><script src="${fileUrl(path.join(PROJECT, FILES.docs))}"></script><script src="${fileUrl(path.join(PROJECT, FILES.section))}"></script>
<script>(async()=>{
const theme=new URLSearchParams(location.search).get("theme")==="dark"?"dark":"light";document.body.className="theme-"+theme;window.Notice=function(){};
Element.prototype.createEl=function(tag,options={}){const el=document.createElement(tag);if(options.cls)el.className=options.cls;if(options.text!=null)el.textContent=String(options.text);this.appendChild(el);return el};
let moves=0;const moveDvs=[];const labels={"doc-note":"New Doc","section-hub":"New Section","sub-section-hub":"New Sub-Section"};window.customJS={SectionExplorer:new SectionExplorer(),AccentButton:new AccentButton(),SectionLabel:new SectionLabel(),EntityCreate:{render:async(dv,options)=>{const button=dv.container.createEl("button",{text:labels[options.instance]});button.style.cssText="width:999px";button.onmouseenter=()=>{};button.onmouseleave=()=>{}}},DocBulkMoveActions:{_onBulkMove:(dv)=>{moves+=1;moveDvs.push(dv)}}};
const docsDv={container:document.getElementById("docs"),current:()=>({file:{folder:"spice/projects/sauce/docs"}})};await new ProjectDocsIndex().renderActionRow(docsDv);
const sectionDv={container:document.getElementById("section")};const section=new SectionHub();await section._renderActionRow(sectionDv,{},1,"sauce","knowledge","Knowledge");
const subDv={container:document.getElementById("subsection")};await section._renderActionRow(subDv,{parent_section:"[[Knowledge]]"},2,"sauce","decisions","Decisions");
const rows=[...document.querySelectorAll(".sauce-action-row")];const buttons=[...document.querySelectorAll(".sauce-action-row .sauce-btn")];buttons.filter((button)=>button.textContent.trim()==="Move docs").forEach((button)=>button.click());
const inside=(child,parent)=>{const c=child.getBoundingClientRect(),p=parent.getBoundingClientRect();return c.left>=p.left-.5&&c.right<=p.right+.5&&c.width>0&&c.height>0};
const docsButtons=[...document.querySelectorAll("#docs .sauce-btn")];const rowCount=new Set(docsButtons.map((button)=>Math.round(button.getBoundingClientRect().top))).size;const narrowWrap=innerWidth===390&&rowCount===2;
const marker=document.createElement("meta");marker.id="fixture-results";marker.dataset.theme=theme;marker.dataset.viewportWidth=String(innerWidth);marker.dataset.viewportHeight=String(innerHeight);marker.dataset.actualHelpers=String(customJS.SectionExplorer instanceof SectionExplorer&&new ProjectDocsIndex() instanceof ProjectDocsIndex&&section instanceof SectionHub);marker.dataset.documentFits=String(document.documentElement.scrollWidth<=innerWidth);marker.dataset.rowsFit=String(rows.length===3&&rows.every((row)=>row.scrollWidth<=row.clientWidth&&inside(row,row.parentElement)));marker.dataset.buttonsFit=String(buttons.length===8&&buttons.every((button)=>inside(button,button.closest(".sauce-action-row"))));marker.dataset.narrowWrap=String(narrowWrap);marker.dataset.wideSingleRow=String(innerWidth===1024&&rowCount===1);marker.dataset.order=buttons.map((button)=>button.textContent.trim()).join("|");marker.dataset.callbacks=String(moves===3&&moveDvs[0]===docsDv&&moveDvs[1]===sectionDv&&moveDvs[2]===subDv);document.head.appendChild(marker);
})().catch((error)=>{const marker=document.createElement("meta");marker.id="fixture-results";marker.dataset.error=String(error&&error.stack||error);document.head.appendChild(marker)});</script></body></html>`;
}
async function visualContract() {
    console.log("--- C7A-VISUAL: deterministic 1024/390 light/dark Project fixture ---");
    const html = fs.readFileSync(VISUAL, "utf8");
    assert(html.includes("../../mechanisms/styling/assets/snippets/sauce-core.css"), "fixture loads shipped sauce-core CSS");
    assert(html.includes("../../mechanisms/modal/sauce-modal.js"), "fixture loads shipped SauceModal");
    assert(html.includes("../../blueprints/project/helpers/project-nav-buttons.js"), "fixture loads shipped ProjectNavButtons");
    assert(html.includes("../../blueprints/project/helpers/project-links-manager.js"), "fixture loads shipped ProjectLinksManager");
    assert(!/<button[^>]+class=["'][^"']*sauce-btn/i.test(html), "fixture does not hand-author shared buttons");
    assert(!/(?:^|\n)\s*\.sauce-(?:btn|action-row|modal)\s*\{/m.test(html), "fixture does not fork shared component CSS");
    const executable = chromeExecutable();
    assert(executable, "Chrome is required for the visual contract");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-c7a-visual-"));
    try {
        const actionFixture = path.join(temp, "actual-action-row-callers.html");
        fs.writeFileSync(actionFixture, actionRowVisualFixture());
        for (const theme of ["light", "dark"]) for (const width of [1024, 390]) {
            const url = `${pathToFileURL(VISUAL).href}?theme=${theme}`;
            const common = ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--force-prefers-reduced-motion", "--run-all-compositor-stages-before-draw", "--virtual-time-budget=1000", `--window-size=${width},900`];
            const marker = markerData(runChrome(executable, [...common, "--dump-dom", url]));
            assert(!marker.error, `executed fixture is error-free: ${marker.error || ""}`);
            assert.strictEqual(marker.theme, theme); assert.strictEqual(marker["document-fits"], "true");
            assert.strictEqual(marker["surfaces-fit"], "true"); assert.strictEqual(marker["controls-visible"], "true");
            assert.strictEqual(marker["actual-helpers"], "true"); assert.strictEqual(marker["actions-clicked"], "true");
            assert.strictEqual(marker["nav-labels"], "Sauce|Project Board|Docs|More");
            assert.strictEqual(marker["overflow-labels"], "Map|To-Do|Helpful Links");
            assert.strictEqual(marker.destinations, "spice/projects/sauce/Sauce.md|spice/projects/sauce/sauce-board.md|spice/projects/sauce/docs/Docs.md|spice/projects/sauce/Project Map.md|spice/projects/sauce/Sauce To-Do.md|spice/projects/sauce/Links Hub.md");
            assert.strictEqual(marker.rows, "2"); assert.strictEqual(marker.buttons, "6");
            assert.strictEqual(marker.modals, "1"); assert.strictEqual(marker["modal-title"], "Add link");
            const first = path.join(temp, `${theme}-${width}-a.png`); const second = path.join(temp, `${theme}-${width}-b.png`);
            runChrome(executable, [...common, `--screenshot=${first}`, url]); runChrome(executable, [...common, `--screenshot=${second}`, url]);
            const a = fs.readFileSync(first); const b = fs.readFileSync(second);
            assert(a.length > 1000 && a.subarray(1, 4).equals(Buffer.from("PNG")), "screenshot is a non-empty PNG");
            assert.strictEqual(crypto.createHash("sha256").update(a).digest("hex"), crypto.createHash("sha256").update(b).digest("hex"), `${theme}/${width} screenshot is deterministic`);

            const actionUrl = `${pathToFileURL(actionFixture).href}?theme=${theme}`;
            const exact = await exactViewportCapture(executable, actionUrl, width, 900);
            const actionMarker = exact.marker;
            assert(!actionMarker.error, `actual action-row callers are error-free: ${actionMarker.error || ""}`);
            assert.strictEqual(actionMarker.theme, theme); assert.strictEqual(actionMarker.actualHelpers, "true");
            assert.strictEqual(Number(actionMarker.viewportWidth), width, `DevTools viewport is exactly ${width}px`);
            assert.strictEqual(Number(actionMarker.viewportHeight), 900, "DevTools viewport is exactly 900px tall");
            assert.strictEqual(actionMarker.documentFits, "true"); assert.strictEqual(actionMarker.rowsFit, "true");
            assert.strictEqual(actionMarker.buttonsFit, "true");
            if (width === 390) assert.strictEqual(actionMarker.narrowWrap, "true", "the exact 390px Docs row wraps to two lines");
            else assert.strictEqual(actionMarker.wideSingleRow, "true", "the exact 1024px Docs row stays on one line");
            assert.strictEqual(actionMarker.order, "New Doc|New Section|Move docs|New Doc|New Sub-Section|Move docs|New Doc|Move docs");
            assert.strictEqual(actionMarker.callbacks, "true");
            assert.deepStrictEqual(pngDimensions(exact.first), { width, height: 900 }, `PNG IHDR is exactly ${width}x900`);
            assert.deepStrictEqual(pngDimensions(exact.second), { width, height: 900 }, `repeat PNG IHDR is exactly ${width}x900`);
            assert.strictEqual(crypto.createHash("sha256").update(exact.first).digest("hex"), crypto.createHash("sha256").update(exact.second).digest("hex"), `${theme}/${width} exact-viewport action-row screenshot is deterministic`);
        }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function behavioralMutationContract() {
    console.log("--- C7A2-BEHAVIORAL-MUTATIONS: each executable regression turns the suite red ---");
    const mutations = {
        "button-adoption": "ProjectNavButtons strips legacy visual state",
        "action-row": "link actions use shared classes",
        "modal-delegation": "exactly one shared backdrop mounts",
        "destination": "actual render clicks preserve every absolute Project destination",
        "mutation-delegate": "doc frontmatter rewrite is unchanged",
        "single-fire": "double Save produces one link write",
        "r7a2-docs-delegate": "Docs renders the shared action row",
        "r7a2-docs-order": "Docs preserves exact entity order",
        "r7a2-section-presets": "depth-1 SectionHub preserves exact create order and presets",
        "r7a2-section-callback": "depth-1 Move callback preserves the exact originating dv identity",
    };
    for (const [mutation, expected] of Object.entries(mutations)) {
        const result = childProcess.spawnSync(process.execPath, [__filename], {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 30000,
            maxBuffer: 8 * 1024 * 1024,
            env: { ...process.env, C7A_MUTATION: mutation, C7A_MUTATION_CHILD: "1" },
        });
        const output = `${result.stdout || ""}\n${result.stderr || ""}`;
        assert.notStrictEqual(result.status, 0, `${mutation} mutation must make the behavioral suite red`);
        assert(output.includes(expected), `${mutation} must fail its discriminating fixture (${expected})`);
    }
}

(async () => {
    if (!MUTATION_CHILD) staticContract();
    await actionRowContract();
    await modalContract();
    if (!MUTATION_CHILD) {
        await visualContract();
        behavioralMutationContract();
    }
    console.log(`cross-blueprint style adoption C7a${MUTATION_CHILD ? ` mutation ${MUTATION}` : ""}: PASS`);
})().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
