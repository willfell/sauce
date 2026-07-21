#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "../..");
const PROJECT = path.join(ROOT, "platform/blueprints/project/helpers");
const MODAL = path.join(ROOT, "platform/mechanisms/modal/sauce-modal.js");
const VISUAL = path.join(ROOT, "platform/test/visual/cross-blueprint-style-adoption.html");
const FILES = {
    nav: "project-nav-buttons.js",
    docs: "project-docs-index.js",
    section: "section-hub.js",
    links: "project-links-manager.js",
    leaf: "doc-leaf-actions.js",
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function source(name) { return fs.readFileSync(path.join(PROJECT, FILES[name]), "utf8"); }
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
        RenderSafe: { page: (dv) => dv.current() },
    };
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
    assert(!/_mobilize|_styleLeafBtn/.test(combined), "all four duplicated responsive sizing helpers are deleted");
    for (const name of ["nav", "docs", "section", "links", "leaf"]) {
        assert(sources[name].includes("sauce-action-row"), `${name} adopts sauce-action-row`);
        assert(sources[name].includes("sauce-btn"), `${name} adopts sauce-btn`);
    }
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

    const mutated = `${combined}\n_styleLeafBtn(btn) { btn.style.padding = '9px'; }`;
    assert(/_mobilize|_styleLeafBtn/.test(mutated), "legacy sizing mutation turns the guard red");
    const rawModal = `${sources.links}\noverlay.style.cssText = 'position: fixed'`;
    assert(/position:\s*fixed/i.test(rawModal), "raw modal mutation turns the guard red");
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
    let bulkMoves = 0;
    h.sandbox.customJS.EntityCreate = { render: async (dv, opts) => {
        creates.push(opts.instance);
        const button = dv.container.createEl("button", { text: opts.instance });
        button.style.cssText = "legacy entity geometry";
        button.onmouseenter = () => {}; button.onmouseleave = () => {};
    } };
    h.sandbox.customJS.DocBulkMoveActions = { _onBulkMove: () => { bulkMoves += 1; } };
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
    assert.deepStrictEqual(creates, ["doc-note", "section-hub"]); assert.strictEqual(bulkMoves, 1);

    creates.length = 0;
    const sectionDv = {
        container: new FakeElement("div"), current: () => ({}),
        pages: () => [], el: () => {}, header: () => {}, paragraph: () => {},
    };
    await h.section._renderActionRow(sectionDv, {}, 1, "sauce", "knowledge", "Knowledge");
    const sectionRow = sectionDv.container.querySelector(".sauce-action-row");
    assert(buttons(sectionRow).every((button) => classTokens(button).includes("sauce-btn") && button.style.cssText === ""), "SectionHub normalizes every action");
    assert.deepStrictEqual(creates, ["doc-note", "sub-section-hub"], "SectionHub preserves create ordering");
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
    ], "one", "spice/projects/sauce/tasks/Card.md");
    assert(picker); modal = mounted(h.document);
    const two = modal.backdrop.walk().find((node) => node.tagName === "BUTTON" && node.walk().some((child) => child.textContent === "Two"));
    await Promise.all([two.click(), two.click()]);
    assert.strictEqual(writes.length, 1, "double workstream click produces one write");
    assert.strictEqual(writes[0].fm.workstream, "two", "workstream assignment delegate is unchanged");
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
    assert.strictEqual(h.links._openModal({ title: "No", build: () => { throw new Error("must not build"); } }), null);
    assert.strictEqual(h.leaf._openModal({ title: "No", build: () => { throw new Error("must not build"); } }), null);
    assert.strictEqual(h.nav._openWorkstreamPicker([], "", "x"), null);
    assert.strictEqual(h.document.body.children.length, 0, "missing dependency fails closed before any DOM mounts");
    h.sandbox.customJS.SauceModal = realModal;
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
function visualContract() {
    console.log("--- C7A-VISUAL: deterministic 1024/390 light/dark Project fixture ---");
    const html = fs.readFileSync(VISUAL, "utf8");
    assert(html.includes("../../mechanisms/styling/assets/snippets/sauce-core.css"), "fixture loads shipped sauce-core CSS");
    assert(!/(?:^|\n)\s*\.sauce-(?:btn|action-row|modal)\s*\{/m.test(html), "fixture does not fork shared component CSS");
    const executable = chromeExecutable();
    assert(executable, "Chrome is required for the visual contract");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-c7a-visual-"));
    try {
        for (const theme of ["light", "dark"]) for (const width of [1024, 390]) {
            const url = `${pathToFileURL(VISUAL).href}?theme=${theme}`;
            const common = ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--force-prefers-reduced-motion", "--run-all-compositor-stages-before-draw", "--virtual-time-budget=1000", `--window-size=${width},900`];
            const marker = markerData(runChrome(executable, [...common, "--dump-dom", url]));
            assert.strictEqual(marker.theme, theme); assert.strictEqual(marker["document-fits"], "true");
            assert.strictEqual(marker["surfaces-fit"], "true"); assert.strictEqual(marker["controls-visible"], "true");
            assert.strictEqual(marker["actions-clicked"], "true"); assert.strictEqual(marker.rows, "3");
            assert.strictEqual(marker.buttons, "9"); assert.strictEqual(marker.modals, "2");
            const first = path.join(temp, `${theme}-${width}-a.png`); const second = path.join(temp, `${theme}-${width}-b.png`);
            runChrome(executable, [...common, `--screenshot=${first}`, url]); runChrome(executable, [...common, `--screenshot=${second}`, url]);
            const a = fs.readFileSync(first); const b = fs.readFileSync(second);
            assert(a.length > 1000 && a.subarray(1, 4).equals(Buffer.from("PNG")), "screenshot is a non-empty PNG");
            assert.strictEqual(crypto.createHash("sha256").update(a).digest("hex"), crypto.createHash("sha256").update(b).digest("hex"), `${theme}/${width} screenshot is deterministic`);
        }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

(async () => {
    staticContract();
    await actionRowContract();
    await modalContract();
    visualContract();
    console.log("cross-blueprint style adoption C7a: PASS");
})().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
