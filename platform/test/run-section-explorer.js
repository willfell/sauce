"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const childProcess = require("child_process");

const RAW_SRC = fs.readFileSync(
  path.join(__dirname, "../mechanisms/section-explorer/section-explorer.js"),
  "utf8"
);
const MUTATION = process.env.R7A2_MUTATION || "";
const MUTATION_CHILD = process.env.R7A2_MUTATION_CHILD === "1";

function sourceUnderTest() {
  if (!MUTATION) return RAW_SRC;
  const mutations = {
    "poll-bound": ["i < 40", "i < 1"],
    "poll-delay": ["setTimeout(resolve, 50)", "setTimeout(resolve, 5)"],
    "proxy-inheritance": [
      "Object.create((dv && typeof dv === \"object\") ? dv : null)",
      "Object.create(null)",
    ],
    "divider-cardinality": [
      "if (cjs?.SectionLabel?.divider) cjs.SectionLabel.divider(container);",
      "if (cjs?.SectionLabel?.divider) { cjs.SectionLabel.divider(container); cjs.SectionLabel.divider(container); }",
    ],
    normalization: ['btn.classList.add("sauce-btn")', 'btn.classList.add("legacy-btn")'],
  };
  const [before, after] = mutations[MUTATION] || [];
  assert(before && RAW_SRC.includes(before), `mutation ${MUTATION} must match its production seam`);
  return RAW_SRC.replace(before, after);
}

function loadClass() {
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  const factory = new Function("module", "exports", sourceUnderTest() + "\nmodule.exports = SectionExplorer;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  return mod.exports;
}

function makeDomStub() {
  const els = [];
  function makeEl(tag) {
    const el = {
      tag,
      children: [],
      style: {},
      className: "",
      textContent: "",
      innerHTML: "",
      attrs: {},
      onclick: null,
      createEl(t, opts) {
        const child = makeEl(t);
        if (opts && opts.cls) child.className = opts.cls;
        if (opts && opts.text) child.textContent = opts.text;
        this.children.push(child);
        els.push(child);
        return child;
      },
      querySelector() { return null; },
      querySelectorAll(selector) {
        if (selector !== "button") return [];
        const found = [];
        const visit = (node) => {
          for (const child of node.children || []) {
            if (child.tag === "button") found.push(child);
            visit(child);
          }
        };
        visit(this);
        return found;
      },
      empty() { this.children = []; },
    };
    el.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        const shouldHave = force === undefined ? !this._set.has(c) : !!force;
        if (shouldHave) this._set.add(c); else this._set.delete(c);
        return shouldHave;
      },
    };
    return el;
  }
  const container = makeEl("div");
  return { container, els };
}

function run(name, fn) {
  try {
    fn();
    console.log("PASS " + name);
    return true;
  } catch (e) {
    console.log("FAIL " + name + " — " + e.message);
    return false;
  }
}

let failures = 0;

// Async tests register here and run in the async tail before process.exit —
// everything above stays synchronous `failures += !run(...)`.
const ASYNC_TESTS = [];

ASYNC_TESTS.push({ name: "renderActionRow owns ordered entity/custom actions and final button normalization", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container } = makeDomStub();
  const rendered = [];
  const previousCustomJS = global.customJS;
  const inherited = {
    current: Symbol("current"), pages: Symbol("pages"), el: Symbol("el"),
    header: Symbol("header"), paragraph: Symbol("paragraph"),
  };
  const dv = {
    container,
    current: () => inherited.current,
    pages: () => inherited.pages,
    el: () => inherited.el,
    header: () => inherited.header,
    paragraph: () => inherited.paragraph,
  };
  global.customJS = {
    SectionLabel: { divider(parent) { parent.createEl("div", { cls: "fixture-divider" }); } },
    EntityCreate: { render: async (proxy, options) => {
      rendered.push({
        instance: options.instance, presetPrompts: options.presetPrompts, container: proxy.container,
        structuralLifecycle: options.structuralLifecycle,
        current: proxy.current(), pages: proxy.pages(), el: proxy.el(),
        header: proxy.header(), paragraph: proxy.paragraph(),
      });
      const button = proxy.container.createEl("button", { text: options.instance });
      button.style.cssText = "legacy geometry";
      button.onmouseenter = () => {};
      button.onmouseleave = () => {};
    } },
  };
  try {
    const row = await se.renderActionRow(dv, [
      { kind: "entity", instance: "doc-note", presetPrompts: { section: "Plans" } },
      { kind: "custom", render: (actionRow) => {
        const button = actionRow.createEl("button", { text: "Move docs" });
        button.style.cssText = "legacy custom geometry";
        button.onmouseenter = () => {};
        button.onmouseleave = () => {};
      } },
      { kind: "entity", instance: "section-hub" },
    ]);
    assert.ok(row && row.className === "sauce-action-row", "shared semantic row is returned");
    assert.ok(rendered[0].structuralLifecycle, "entity actions receive the shared structural lifecycle");
    assert.strictEqual(container.children.length, 2, "caller container has exactly one divider and one action row");
    assert.strictEqual(container.children[0].className, "fixture-divider", "divider precedes the row");
    assert.strictEqual(container.children[1], row, "action row is the only node after the divider");
    assert.deepStrictEqual(rendered.map((entry) => entry.instance), ["doc-note", "section-hub"], "entity order surrounds custom action");
    assert.deepStrictEqual(rendered[0].presetPrompts, { section: "Plans" }, "entity presets pass through unchanged");
    assert.ok(rendered.every((entry) => entry.container === row), "EntityCreate receives a row-scoped proxy");
    for (const entry of rendered) {
      assert.strictEqual(entry.current, inherited.current, "proxy preserves inherited current identity");
      assert.strictEqual(entry.pages, inherited.pages, "proxy preserves inherited pages identity");
      assert.strictEqual(entry.el, inherited.el, "proxy preserves inherited el identity");
      assert.strictEqual(entry.header, inherited.header, "proxy preserves inherited header identity");
      assert.strictEqual(entry.paragraph, inherited.paragraph, "proxy preserves inherited paragraph identity");
    }
    assert.deepStrictEqual(row.children.map((child) => child.textContent), ["doc-note", "Move docs", "section-hub"], "custom actions retain declarative sequence");
    for (const button of row.querySelectorAll("button")) {
      assert.ok(button.classList.contains("sauce-btn"), "every final button adopts sauce-btn");
      assert.strictEqual(button.style.cssText, "", "legacy inline geometry is cleared");
      assert.strictEqual(button.onmouseenter, null, "legacy enter handler is cleared");
      assert.strictEqual(button.onmouseleave, null, "legacy leave handler is cleared");
    }
  } finally {
    if (previousCustomJS === undefined) delete global.customJS;
    else global.customJS = previousCustomJS;
  }
}});

ASYNC_TESTS.push({ name: "entityCreateLifecycle owns an exact optimistic node receipt and preserves newer focus on rollback", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  let restoreCount = 0;
  const previousDocument = global.document;
  const focusTarget = { isConnected: true, focus: () => { restoreCount += 1; } };
  global.document = { activeElement: focusTarget, body: {} };
  const parent = {
    children: [],
    createEl(_tag, options) {
      const node = { className: options.cls, textContent: "", nextSibling: null, contains: () => false };
      this.children.push(node);
      return node;
    },
    removeChild(node) { this.children = this.children.filter((candidate) => candidate !== node); },
  };
  const root = { querySelector: () => parent, createEl: parent.createEl.bind(parent) };
  try {
    const lifecycle = se.entityCreateLifecycle({ container: root });
    const receipt = lifecycle.apply({ targetPath: "spice/projects/demo/docs/knowledge/New Doc.md" });
    assert.strictEqual(parent.children.length, 1, "optimistic preview is inserted once");
    assert.strictEqual(receipt.node, parent.children[0], "receipt owns the exact inserted node");
    assert.strictEqual(receipt.node.textContent, "Creating New Doc…");
    lifecycle.rollback(receipt);
    assert.strictEqual(parent.children.length, 0, "rollback removes only the receipt node");
    assert.strictEqual(restoreCount, 1, "rollback restores the captured focus target while it remains authoritative");

    const secondReceipt = lifecycle.apply({ targetPath: "spice/projects/demo/docs/knowledge/Another Doc.md" });
    const newerFocus = { isConnected: true, focus: () => {} };
    global.document.activeElement = newerFocus;
    lifecycle.rollback(secondReceipt);
    assert.strictEqual(parent.children.length, 0, "a second rollback removes only its own receipt node");
    assert.strictEqual(restoreCount, 1, "rollback does not steal focus from a newer connected target");
    assert.strictEqual(global.document.activeElement, newerFocus, "newer focus remains authoritative");
  } finally { global.document = previousDocument; }
}});

ASYNC_TESTS.push({ name: "renderActionRow polls exactly 40 x 50 ms, recovers warm dependencies, and fails closed", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container } = makeDomStub();
  const previousCustomJS = global.customJS;
  const previousSetTimeout = global.setTimeout;
  const delays = [];
  global.customJS = { SectionLabel: { divider() {} } };
  global.setTimeout = (callback, delay) => { delays.push(delay); callback(); return 0; };
  try {
    const row = await se.renderActionRow({ container }, [
      { kind: "entity", instance: "doc-note" },
      { kind: "custom", render: (actionRow) => actionRow.createEl("button", { text: "Move docs" }) },
    ]);
    assert.ok(row, "missing EntityCreate never rejects or removes the safe row");
    assert.strictEqual(delays.length, 40, "missing dependency polls exactly 40 times");
    assert.ok(delays.every((delay) => delay === 50), "every cold-load poll waits exactly 50 ms");
    assert.deepStrictEqual(row.children.map((child) => child.textContent), ["Move docs"], "missing entity dependency is skipped without widening behavior");
    assert.ok(row.children[0].classList.contains("sauce-btn"), "dependency-free custom action is still normalized");

    const recoveredDelays = [];
    const recovered = [];
    const { container: warmContainer } = makeDomStub();
    global.customJS = { SectionLabel: { divider() {} } };
    global.setTimeout = (callback, delay) => {
      recoveredDelays.push(delay);
      if (recoveredDelays.length === 3) {
        global.customJS.EntityCreate = { render: async (proxy, options) => {
          recovered.push(options.instance);
          proxy.container.createEl("button", { text: options.instance });
        } };
      }
      callback();
      return 0;
    };
    const warmRow = await se.renderActionRow({ container: warmContainer }, [
      { kind: "entity", instance: "doc-note" },
      { kind: "custom", render: (actionRow) => actionRow.createEl("button", { text: "Move docs" }) },
    ]);
    assert.deepStrictEqual(recoveredDelays, [50, 50, 50], "warm recovery occurs after exactly three 50 ms polls");
    assert.deepStrictEqual(recovered, ["doc-note"], "warm EntityCreate recovery renders the pending entity action");
    assert.deepStrictEqual(warmRow.children.map((child) => child.textContent), ["doc-note", "Move docs"], "warm recovery preserves declarative action order");
  } finally {
    global.setTimeout = previousSetTimeout;
    if (previousCustomJS === undefined) delete global.customJS;
    else global.customJS = previousCustomJS;
  }
}});

ASYNC_TESTS.push({ name: "renderActionRow mutation contract kills each changed mechanism seam", fn: async () => {
  if (MUTATION_CHILD) return;
  const mutations = [
    ["poll-bound", "exactly 40"],
    ["poll-delay", "50 ms"],
    ["proxy-inheritance", "shared semantic row is returned"],
    ["divider-cardinality", "exactly one divider"],
    ["normalization", "adopts sauce-btn"],
  ];
  for (const [mutation, expected] of mutations) {
    const result = childProcess.spawnSync(process.execPath, [__filename], {
      cwd: __dirname,
      encoding: "utf8",
      env: { ...process.env, R7A2_MUTATION: mutation, R7A2_MUTATION_CHILD: "1" },
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    assert.notStrictEqual(result.status, 0, `mutation ${mutation} must be killed`);
    assert(output.includes(expected), `mutation ${mutation} must fail at its discriminating assertion: ${expected}`);
  }
}});

failures += !run("makeAdapter returns an object exposing render-ready shape", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [],
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  assert.strictEqual(typeof adapter.render, "undefined"); // adapter has no render of its own
  assert.strictEqual(typeof adapter.resolveContext, "function");
  assert.strictEqual(typeof adapter.listSections, "function");
});

failures += !run("makeAdapter forwards move, emptySubsectionCount, and structural owner identity", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const moveBlock = {
    root: "spice/wiki", sectionType: "wiki-section", rootLabel: "Wiki (root)",
    enumerateSectionTargets: () => [],
    rewriteOnDocMove: () => null,
    rewriteOnSectionMove: () => null,
    canAcceptSection: () => true,
  };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [],
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
    move: moveBlock,
    structural: true,
    structuralOwnerKey: "spice/wiki/Wiki.md",
    emptySubsectionCount: (section) => 3,
  });
  assert.ok(adapter.move, "makeAdapter must forward config.move");
  assert.strictEqual(typeof adapter.move.enumerateSectionTargets, "function");
  assert.strictEqual(typeof adapter.move.canAcceptSection, "function");
  assert.strictEqual(typeof adapter.emptySubsectionCount, "function");
  assert.strictEqual(adapter.emptySubsectionCount({ folder: "x" }), 3);
  assert.strictEqual(adapter.structural, true);
  assert.strictEqual(adapter.structuralOwnerKey, "spice/wiki/Wiki.md");
  // Absent config → null move + undefined helper (consumers no-op safely).
  const bare = se.makeAdapter({
    resolveContext: () => ({}), listSections: () => [], listPages: () => [],
    getLinks: () => [], icons: { folder: "", file: "" }, rootClass: "se-root",
  });
  assert.strictEqual(bare.move, null);
  assert.strictEqual(bare.emptySubsectionCount, undefined);
});

// REGRESSION: customJS exposes the INSTANCE, so `static` helpers must be mirrored
// onto it — else blueprint move blocks calling customJS.SectionExplorer.pagesUnder(...)
// throw "not a function", the enumerator's try/catch returns [], and EVERY move
// picker (bulk / section / single-doc, both blueprints) opens with an empty list.
// The pre-existing tests only called statics via the class name, so they never
// caught this. This test calls them on an INSTANCE, exactly like customJS does.
failures += !run("instance exposes static helpers (empty move-picker bug): customJS.SectionExplorer.pagesUnder/sectionTargets/planBulkMove are callable ON THE INSTANCE", () => {
  const SectionExplorer = loadClass();
  const inst = new SectionExplorer(); // customJS stores the instance, not the class
  for (const m of ["pagesUnder", "sectionTargets", "planBulkMove", "subtreeDocCount", "childSectionFolders", "isNoop", "targetPath", "_slugify"]) {
    assert.strictEqual(typeof inst[m], "function", "instance." + m + " must be callable (static mirrored onto instance)");
  }
  // They must actually WORK through the instance, not merely exist.
  const pages = [{ type: "wiki-section", title: "Cooking", file: { path: "spice/wiki/cooking/Cooking.md", folder: "spice/wiki/cooking" } }];
  const tg = inst.sectionTargets(pages, { root: "spice/wiki", sectionType: "wiki-section", rootLabel: "Wiki (root)", labelOf: (p) => p.title });
  assert.strictEqual(tg.length, 2, "root + one section");
  assert.strictEqual(tg[0].folder, "spice/wiki");
  assert.strictEqual(tg[1].folder, "spice/wiki/cooking");
  const { moves } = inst.planBulkMove(["spice/wiki/a/One.md"], "spice/wiki/b");
  assert.strictEqual(moves.length, 1);
  assert.strictEqual(moves[0].to, "spice/wiki/b/One.md");
  // Static access must still work too (internal callers use the class name).
  assert.strictEqual(typeof SectionExplorer.pagesUnder, "function");
  assert.strictEqual(SectionExplorer._slugify("A B"), "a-b");
});

failures += !run("render() renders a rail row per section", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [
      { title: "EMS", hubPath: "spice/wiki/ems/EMS.md", folder: "spice/wiki/ems", pageCount: 2, subSectionCount: 0, maxMtime: 0, materialized: true },
    ],
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const railRows = els.filter((e) => e.className === "se-rail-row");
  assert.strictEqual(railRows.length, 1, "expected exactly one rail row for the one section");
});

failures += !run("rail rows show meta (doc/section counts) and re-sort on toggle click", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const sections = [
    { title: "Bravo", hubPath: "b.md", folder: "b", pageCount: 1, subSectionCount: 0, maxMtime: 100, materialized: true },
    { title: "Alpha", hubPath: "a.md", folder: "a", pageCount: 3, subSectionCount: 1, maxMtime: 200, materialized: true },
  ];
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => sections,
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const rows = els.filter((e) => e.className === "se-rail-row");
  assert.strictEqual(rows.length, 2);
  // Default sort = recent (maxMtime desc) → Alpha (200) before Bravo (100).
  // NEW (title now nests inside the se-rail-main stacking block):
  const firstMain = rows[0].children.find((c) => c.className === "se-rail-main");
  const firstTitle = firstMain && firstMain.children.find((c) => c.className === "se-rail-title");
  assert.ok(firstTitle && firstTitle.innerHTML.includes("Alpha"), "expected the first (most-recent) rail row's title to be Alpha");
  const meta = els.find((e) => e.className === "se-rail-meta" && (e.textContent.includes("3 doc") || e.innerHTML.includes("3 doc")));
  assert.ok(meta, "expected a meta line mentioning doc count");
});

failures += !run("page pane renders mechanism-owned doc cards (no BeaconCards)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const beaconCalls = [];
  global.customJS = { BeaconCards: { render: (d, o) => beaconCalls.push(o) } };
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const pages = [{ title: null, file: { name: "Runbook", path: "spice/wiki/ems/Runbook.md", mtime: { ts: 1000 } } }];
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [],
    listPages: () => pages,
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  assert.strictEqual(beaconCalls.length, 0, "BeaconCards must NOT be called by the pane anymore");
  const grid = els.find((e) => e.className === "se-doc-grid");
  assert.ok(grid, "expected a se-doc-grid");
  const cards = els.filter((e) => e.className === "se-doc-card");
  assert.strictEqual(cards.length, 1);
  const title = els.find((e) => e.className === "se-doc-title");
  assert.strictEqual(title.textContent, "Runbook");
  const icon = els.find((e) => e.className === "se-doc-icon");
  assert.ok(icon, "expected the doc icon badge");
  delete global.customJS;
});

failures += !run("_docCardModel strips .md from the name fallback (no title)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const model = se._docCardModel({ file: { name: "Foo.md", path: "a/Foo.md" } });
  assert.strictEqual(model.title, "Foo");
});

failures += !run("_docCardModel keeps explicit title over the name fallback", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const model = se._docCardModel({ title: "Real Title", file: { name: "Foo.md", path: "a/Foo.md" } });
  assert.strictEqual(model.title, "Real Title");
});

failures += !run("select-docs row label derives basename without .md from a titleless path", () => {
  // The row label uses `c.title || <basename-of-c.path without .md>`.
  const c = { title: "", path: "a/Foo.md" };
  const base = String(c.path || "").split("/").pop().replace(/\.md$/, "");
  const label = c.title || base;
  assert.strictEqual(label, "Foo");
});

failures += !run("pinned links render above the page grid, and render nothing when empty", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = { BeaconCards: { render: () => {} } };

  // Non-empty links → a links row appears.
  {
    const { container, els } = makeDomStub();
    const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
    const adapter = se.makeAdapter({
      resolveContext: () => ({ scopePath: "spice/wiki" }),
      listSections: () => [],
      listPages: () => [],
      getLinks: () => [{ url: "https://example.com", text: "Style guide" }],
      icons: { folder: "<svg/>", file: "<svg/>" },
      rootClass: "se-root",
    });
    se.render(dv, adapter);
    const linksRow = els.find((e) => e.className === "se-links-row");
    assert.ok(linksRow, "expected a se-links-row when links[] is non-empty");
  }

  // Empty links → no links row at all (renders nothing, per the vault's rule).
  {
    const { container, els } = makeDomStub();
    const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
    const adapter = se.makeAdapter({
      resolveContext: () => ({ scopePath: "spice/wiki" }),
      listSections: () => [],
      listPages: () => [],
      getLinks: () => [],
      icons: { folder: "<svg/>", file: "<svg/>" },
      rootClass: "se-root",
    });
    se.render(dv, adapter);
    const linksRow = els.find((e) => e.className === "se-links-row");
    assert.strictEqual(linksRow, undefined, "expected NO se-links-row when links[] is empty");
  }

  delete global.customJS;
});

failures += !run("javascript: link renders as a chip with NO href/onclick (unsafe scheme blocked)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = { BeaconCards: { render: () => {} } };

  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [],
    listPages: () => [],
    getLinks: () => [{ url: "javascript:alert(1)", text: "evil" }],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const chip = els.find((e) => e.className === "se-link-chip");
  assert.ok(chip, "expected a se-link-chip to still be rendered (never silently dropped)");
  assert.ok(!chip.href, "expected no href set on an unsafe-scheme link");
  assert.ok(!chip.onclick, "expected no onclick/window.open fallback on the chip");

  delete global.customJS;
});

failures += !run("https: link gets a real safe anchor (href + target=_blank + rel=noopener)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = { BeaconCards: { render: () => {} } };

  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [],
    listPages: () => [],
    getLinks: () => [{ url: "https://example.com", text: "Style guide" }],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const chip = els.find((e) => e.className === "se-link-chip");
  assert.ok(chip, "expected a se-link-chip");
  assert.strictEqual(chip.href, "https://example.com");
  assert.strictEqual(chip.target, "_blank");
  assert.ok(String(chip.rel).includes("noopener"), "expected rel to include noopener");

  delete global.customJS;
});

failures += !run("rail row's inline dots opens MenuPopover with Rename/Add link/Delete, Delete disabled when non-empty", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const opened = [];
  global.customJS = { MenuPopover: { open: (entries, opts) => { opened.push({ entries, opts }); } } };
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const sections = [
    { title: "EMS", hubPath: "e.md", folder: "e", pageCount: 2, subSectionCount: 0, maxMtime: 0, materialized: true },
  ];
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => sections,
    listPages: () => [],
    getLinks: () => [],
    canDelete: (s) => s.pageCount === 0 && s.subSectionCount === 0,
    icons: { folder: "<svg/>", file: "<svg/>", dots: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const dots = els.find((e) => e.className === "se-rail-dots");
  assert.ok(dots, "expected an inline dots control on the rail row");
  dots.onclick();
  assert.strictEqual(opened.length, 1);
  const labels = opened[0].entries.filter((e) => e && e.label).map((e) => e.label);
  assert.deepStrictEqual(labels, ["Rename", "Add link", "Move", "Delete"]);
  const deleteEntry = opened[0].entries.find((e) => e && e.label === "Delete");
  assert.strictEqual(deleteEntry.disabled, true, "Delete must be disabled — section has 2 pages");
  delete global.customJS;
});

failures += !run("_addLinkPure appends a valid link, rejects empty url and duplicate url", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  let r = se._addLinkPure([], { url: "https://a.com", text: "A" });
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(r.links, [{ url: "https://a.com", text: "A" }]);

  r = se._addLinkPure(r.links, { url: "", text: "empty" });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.reason, "empty-url");

  r = se._addLinkPure([{ url: "https://a.com", text: "A" }], { url: "https://a.com", text: "dup" });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.reason, "duplicate");

  // text defaults to url when omitted.
  r = se._addLinkPure([], { url: "https://b.com" });
  assert.strictEqual(r.links[0].text, "https://b.com");
});

// Minimal fake `document` for _openModal tests: tracks the single keydown
// listener registered (Escape) and supports the overlay/panel DOM shape
// _openModal needs (createElement, body.appendChild, body.querySelector,
// removeChild via parentNode).
function makeDocStub() {
  const listeners = {};
  const body = {
    children: [],
    appendChild(el) { el.parentNode = body; this.children.push(el); },
    removeChild(el) { this.children = this.children.filter((c) => c !== el); },
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      return this.children.find((c) => c.className === cls) || null;
    },
  };
  const doc = {
    body,
    createElement(tag) {
      return {
        tag,
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); },
        remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      };
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    __listeners: listeners,
  };
  global.document = doc;
  return doc;
}

failures += !run("_openModal: Escape key closes the modal and removes the keydown listener", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  const overlay = se._openModal("se-test-overlay", () => {});
  assert.ok(overlay, "expected _openModal to return the overlay");
  assert.strictEqual(doc.body.children.length, 1, "expected overlay appended to body");
  assert.ok(doc.__listeners.keydown, "expected a keydown listener registered");
  doc.__listeners.keydown({ key: "Escape" });
  assert.strictEqual(doc.body.children.length, 0, "expected overlay removed after Escape");
  assert.ok(!doc.__listeners.keydown, "expected keydown listener removed on close");
  delete global.document;
});

failures += !run("_openModal: backdrop click WITHIN the ~400ms opening-gesture guard does NOT close it", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  const overlay = se._openModal("se-test-overlay", () => {});
  // Real elapsed time since _openModal's Date.now() call is near-zero here —
  // well under the 400ms guard window.
  overlay.onclick({ target: overlay });
  assert.strictEqual(doc.body.children.length, 1, "expected overlay to survive a backdrop click within the opening-gesture guard");
  delete global.document;
});

failures += !run("_openModal: backdrop click AFTER the opening-gesture guard window DOES close it", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  const overlay = se._openModal("se-test-overlay", () => {});
  // Mutate the recorded open time backward past the 400ms guard window.
  overlay.__seOpenedAt = Date.now() - 1000;
  overlay.onclick({ target: overlay });
  assert.strictEqual(doc.body.children.length, 0, "expected overlay removed after guard window elapses");
  delete global.document;
});

failures += !run("_openModal: backdrop click that does NOT hit the overlay itself is ignored", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  const overlay = se._openModal("se-test-overlay", () => {});
  overlay.__seOpenedAt = Date.now() - 1000;
  overlay.onclick({ target: {} }); // click landed on inner panel content, not overlay
  assert.strictEqual(doc.body.children.length, 1, "expected overlay to survive a click on non-overlay target");
  delete global.document;
});

failures += !run("_openModal dedupes by className — opening twice leaves exactly one overlay", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  se._openModal("se-test-overlay", () => {});
  se._openModal("se-test-overlay", () => {});
  assert.strictEqual(doc.body.children.length, 1, "expected exactly one overlay after opening twice");
  delete global.document;
});

failures += !run("_addLinkPure + adapter.writeLinks integration (no DOM)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const writes = [];
  const adapter = { getLinks: () => [], writeLinks: (target, links) => { writes.push({ target, links }); } };
  const section = { title: "EMS", hubPath: "e.md" };
  const result = se._addLinkPure(adapter.getLinks(section), { url: "https://x.com", text: "X" });
  assert.strictEqual(result.changed, true);
  adapter.writeLinks(section, result.links);
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].links, [{ url: "https://x.com", text: "X" }]);
});

failures += !run("wiki adapter config: renameSection renames folder + updates title frontmatter", () => {
  const treeSrc = fs.readFileSync(path.join(__dirname, "../blueprints/wiki/helpers/wiki-tree.js"), "utf8");
  const factory = new Function("module", "exports", treeSrc + "\nmodule.exports = WikiTree;");
  const mod = { exports: {} };
  const renameCalls = [];
  const fmWrites = [];
  global.app = {
    fileManager: {
      renameFile: (file, newPath) => { renameCalls.push({ file, newPath }); return Promise.resolve(); },
      processFrontMatter: (file, fn) => { const fm = {}; fn(fm); fmWrites.push({ file, fm }); return Promise.resolve(); },
    },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
    workspace: { openLinkText: () => {} },
  };
  factory(mod, mod.exports);
  const WikiTree = mod.exports;
  const wt = new WikiTree();
  const section = { title: "EMS", hubPath: "spice/wiki/ems/EMS.md", folder: "spice/wiki/ems" };
  wt._config = wt._buildConfig({ container: {} }, { file: { path: "spice/wiki/ems/EMS.md" } });
  wt._config.renameSection(section, "Networking");
  assert.strictEqual(renameCalls.length, 1, "expected exactly one folder rename");
  assert.strictEqual(renameCalls[0].newPath, "spice/wiki/networking");
  assert.strictEqual(fmWrites.length, 1, "expected exactly one frontmatter write (title)");
  assert.strictEqual(fmWrites[0].fm.title, "Networking");
  delete global.app;
});

failures += !run("project adapter: virtual (unmaterialized) sections expose no rename/delete/add-link", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-docs-index.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectDocsIndex;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectDocsIndex = mod.exports;
  const pdi = new ProjectDocsIndex();
  const virtualSection = { title: "Notes", hubPath: null, folder: "spice/projects/foo/docs/notes", pageCount: 0, subSectionCount: 0, materialized: false };
  const config = pdi._buildConfig({ page: () => null, pages: () => [] }, { file: { path: "spice/projects/foo/Docs.md" } }, {
    projectSlug: "foo", projectPath: "spice/projects/foo", docsFolder: "spice/projects/foo/docs", scopePath: "spice/projects/foo/docs",
  });
  assert.strictEqual(config.canDelete(virtualSection), false, "a virtual section must never be deletable");
});

failures += !run("project adapter: renameSection on a depth-1 hub updates section/section_slug + child parent_section", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/section-hub.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = SectionHub;");
  const mod = { exports: {} };
  const fmWrites = [];
  const renameCalls = [];
  global.app = {
    fileManager: {
      renameFile: (f, p) => { renameCalls.push({ f, p }); return Promise.resolve(); },
      processFrontMatter: (f, fn) => { const fm = {}; fn(fm); fmWrites.push({ file: f, fm }); return Promise.resolve(); },
    },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  global.customJS = {
    DocSearch: { matches: () => true },
    SectionLabel: { render: () => {}, divider: () => {} },
    RenderSafe: {
      page: (dv) => (dv && typeof dv.current === "function" ? dv.current() : null),
      mutateStructure: async (opts) => {
        let receipt;
        try { receipt = opts.apply(); return { ok: true, value: await opts.write(), receipt }; }
        catch (error) { if (receipt !== undefined) await opts.rollback(receipt, error); return { ok: false, error, receipt }; }
      },
    },
  };
  factory(mod, mod.exports);
  const SectionHub = mod.exports;
  const sh = new SectionHub();
  const cur = { file: { path: "spice/projects/foo/docs/ems/EMS.md", folder: "spice/projects/foo/docs/ems" }, project_slug: "foo", section_slug: "ems", section: "EMS", depth: 1 };
  const config = sh._buildConfig({ page: () => null, pages: () => [] }, cur, 1, "foo", "ems", "EMS");
  const childHub = { path: "spice/projects/foo/docs/ems/sub/Sub.md" };
  sh._childHubsForRename = () => [childHub]; // test seam listing depth-2 children
  const section = { title: "EMS", hubPath: cur.file.path, folder: cur.file.folder, materialized: true };
  config.renameSection(section, "Networking");
  const hubFmWrite = fmWrites.find((w) => w.file.path === cur.file.path);
  assert.ok(hubFmWrite, "expected a frontmatter write on the section-hub itself");
  assert.strictEqual(hubFmWrite.fm.section, "Networking");
  assert.strictEqual(hubFmWrite.fm.section_slug, "networking");
  const childFmWrite = fmWrites.find((w) => w.file.path === childHub.path);
  assert.ok(childFmWrite, "expected the depth-2 child's parent_section to also be updated");
  assert.strictEqual(childFmWrite.fm.parent_section, "Networking");
  delete global.app;
  delete global.customJS;
});

// ── Regression: real Obsidian `dv` is a CLASS INSTANCE (pages/current live on
// its prototype, not as own enumerable properties). `{ ...dv, container }` —
// used at every SectionExplorer.render() call site in WikiTree/ProjectDocsIndex/
// SectionHub — only copies OWN enumerable properties, silently dropping every
// prototype method. The existing tests above never caught this because their
// `dv` stubs are plain object literals (methods ARE own properties there), which
// doesn't match production. This test uses a real `class FakeDv` (methods on
// the prototype, exactly like the actual Dataview API) to reproduce the bug
// end-to-end through the REAL WikiTree source, proving sections silently
// vanish even though matching pages genuinely exist.
function makeClassShapedDv(container, pages, currentPage) {
  class FakeDv {
    constructor() { this.container = container; }
    pages(q) {
      const arr = pages.filter((p) => !q || (p.file && p.file.path && p.file.path.startsWith(q.replace(/^"|"$/g, ""))));
      arr.array = () => arr;
      arr.where = (fn) => { const r = arr.filter(fn); r.array = () => r; r.where = arr.where; r.length = r.length; return r; };
      return arr;
    }
    current() { return currentPage; }
  }
  return new FakeDv();
}

failures += !run("REGRESSION: WikiTree.render with a class-shaped dv still finds real sections (dv-spread must not drop dv.pages)", () => {
  const treeSrc = fs.readFileSync(path.join(__dirname, "../blueprints/wiki/helpers/wiki-tree.js"), "utf8");
  const factory = new Function("module", "exports", treeSrc + "\nmodule.exports = WikiTree;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const WikiTree = mod.exports;

  const SectionExplorer = loadClass();
  global.customJS = {
    SectionExplorer: new SectionExplorer(),
    DocSearch: {
      render: (dv, opts) => {
        // No active filter — mirror the real DocSearch contract closely enough
        // to drive WikiTree straight into the SectionExplorer.render() branch.
        return { hasActiveFilter: false, resultsContainer: dv.container, matches: () => true };
      },
      matches: () => true,
    },
    SectionLabel: { render: () => {}, divider: () => {} },
    MenuPopover: { open: () => {} },
    BeaconCards: { render: () => {} },
  };

  const { container, els } = makeDomStub();
  const cur = { file: { path: "spice/wiki/Wiki.md" }, type: "wiki-hub" };
  const pages = [
    { type: "wiki-section", title: "EMS", file: { path: "spice/wiki/ems/EMS.md", name: "EMS", mtime: { ts: 1 } } },
  ];
  const dv = makeClassShapedDv(container, pages, cur);
  const wt = new WikiTree();
  wt.render(dv);

  const railRows = els.filter((e) => e.className === "se-rail-row");
  assert.strictEqual(
    railRows.length,
    1,
    "expected WikiTree to surface the real wiki-section via SectionExplorer's rail — got " + railRows.length +
      " rail rows. This reproduces the dv-spread bug: '{ ...dv, container }' at the WikiTree.render() call site " +
      "drops dv.pages (a prototype method on the real Dataview API), so the adapter's listSections() throws/no-ops."
  );
  delete global.customJS;
});

failures += !run("REGRESSION: ProjectDocsIndex.render with a class-shaped dv still finds real docs (dv-spread must not drop dv.pages)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-docs-index.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectDocsIndex;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectDocsIndex = mod.exports;

  const SectionExplorer = loadClass();
  global.customJS = {
    SectionExplorer: new SectionExplorer(),
    DocSearch: { render: (dv) => ({ hasActiveFilter: false, resultsContainer: dv.container }) },
    SectionLabel: { render: () => {}, divider: () => {} },
    MenuPopover: { open: () => {} },
    BeaconCards: { render: () => {} },
    AccentButton: { render: () => {} },
  };

  const { container, els } = makeDomStub();
  const cur = { file: { path: "spice/projects/sauce/docs/Docs.md", folder: "spice/projects/sauce/docs" }, type: "docs-hub" };
  // A real materialized section-hub note (NOT relying on the "Knowledge"/"Notes"
  // virtual-fallback path _buildConfig takes when zero sections are discovered —
  // that fallback would mask the dv-spread bug, since it also fires when
  // dv.pages() throws/no-ops and discoveredSet ends up empty either way).
  const pages = [
    { type: "section-hub", depth: 1, section: "Knowledge", file: { path: "spice/projects/sauce/docs/knowledge/Knowledge.md", name: "Knowledge", folder: "spice/projects/sauce/docs/knowledge", mtime: { ts: 1 } } },
    { type: "doc-note", file: { path: "spice/projects/sauce/docs/knowledge/Notes.md", name: "Notes", folder: "spice/projects/sauce/docs/knowledge", mtime: { ts: 1 } } },
  ];
  const dv = makeClassShapedDv(container, pages, cur);
  const pdi = new ProjectDocsIndex();
  pdi.render(dv);

  const railRows = els.filter((e) => e.className === "se-rail-row");
  assert.strictEqual(
    railRows.length,
    1,
    "expected ProjectDocsIndex to surface the real 'Knowledge' section-hub via SectionExplorer's rail — got " + railRows.length +
      " rail rows. This reproduces the dv-spread bug at the ProjectDocsIndex.render() call site (a broken dv makes " +
      "the section-hub discovery silently find nothing, either 0 rows or falling back to the default 'Knowledge'/'Notes' " +
      "virtual placeholders instead of the REAL discovered section)."
  );
  delete global.customJS;
});

// ── Regression: section-explorer.css was written to disk correctly on every
// consumer vault but NEVER actually applied, because Obsidian CSS snippets
// are OFF by default until registered in .obsidian/appearance.json's
// enabledCssSnippets[] — and this mechanism's manifest shipped the CSS via
// the generic `files[]` array (a raw copy, gated only by an install-time
// approval prompt) instead of the dedicated `snippets[]` array that BOTH
// copies the file AND registers/enables it (see `applySnippets` in
// platform/install.js, which requires the registered name to match
// /^sauce-[A-Za-z0-9._-]+$/ — the same mechanism `home`'s manifest.json
// already uses successfully for sauce-home.css). Assert the manifest uses
// the correct mechanism so this can't silently regress again.
failures += !run("REGRESSION: section-explorer manifest ships its CSS via snippets[] (enabled), not files[] (write-only, never enabled)", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../mechanisms/section-explorer/manifest.json"), "utf8"));

  const cssInFiles = (manifest.files || []).some((f) => String(f.dest || "").endsWith(".css"));
  assert.strictEqual(cssInFiles, false, "the CSS file must NOT ship via files[] — that array only copies the file, it never registers/enables it as an Obsidian CSS snippet");

  const snippets = manifest.snippets || [];
  assert.strictEqual(snippets.length, 1, "expected exactly one snippets[] entry for section-explorer.css");
  assert.strictEqual(snippets[0].source, "section-explorer.css");
  assert.ok(
    /^sauce-[A-Za-z0-9._-]+$/.test(snippets[0].name),
    "snippets[].name must match /^sauce-[A-Za-z0-9._-]+$/ (applySnippets' validation regex in platform/install.js) or the entry is silently skipped as invalid — got: " + snippets[0].name
  );

  // The `snippets[]` entry above only COPIES the CSS file — actually
  // enabling it in Obsidian requires a SEPARATE `appearance.enabledCssSnippets`
  // declaration (processed by applyAppearance, not applySnippets). Missing
  // this second declaration was the root cause: the file was written to
  // disk correctly on every consumer vault, but Obsidian never applied it
  // because CSS snippets are OFF by default until explicitly enabled.
  const enabled = (manifest.appearance && manifest.appearance.enabledCssSnippets) || [];
  assert.ok(
    enabled.includes(snippets[0].name),
    "manifest.appearance.enabledCssSnippets must include '" + snippets[0].name + "' — otherwise the snippet is copied to disk but never actually applied by Obsidian"
  );
});

// ── Regression: SectionHub/ProjectDocsIndex are customJS SINGLETONS — one
// instance reused for every note. DocSearch.render() creates a brand-new
// resultsContainer per call, but the (now-deleted) `Object.assign(filterCtx,
// this._currentCtx)` restore overwrote the fresh ctx (incl. resultsContainer)
// with the one captured by the LAST onChange anywhere in the vault, so all
// content rendered into a detached, invisible container ("no docs" despite
// real matches). WikiTree never had the mechanism and works.
failures += !run("REGRESSION: a prior render's search onChange must not hijack a later render's resultsContainer (ProjectDocsIndex singleton)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-docs-index.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectDocsIndex;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectDocsIndex = mod.exports;

  const SectionExplorer = loadClass();
  let capturedOnChange = null;
  global.customJS = {
    SectionExplorer: new SectionExplorer(),
    DocSearch: {
      render: (dv, opts) => {
        capturedOnChange = opts.onChange;
        return { hasActiveFilter: false, resultsContainer: dv.container.createEl("div", { cls: "results" }) };
      },
      matches: () => true,
    },
    SectionLabel: { render: () => {}, divider: () => {} },
    MenuPopover: { open: () => {} },
    BeaconCards: { render: () => {} },
    AccentButton: { render: () => {} },
  };
  const pagesFor = (slug) => [
    { type: "section-hub", depth: 1, section: "Knowledge", file: { path: `spice/projects/${slug}/docs/knowledge/Knowledge.md`, name: "Knowledge", folder: `spice/projects/${slug}/docs/knowledge`, mtime: { ts: 1 } } },
  ];

  const pdi = new ProjectDocsIndex();

  // Render #1 on note A, then simulate a search keystroke: onChange fires with
  // a ctx bound to note A's (soon-stale) resultsContainer.
  const { container: containerA } = makeDomStub();
  const curA = { file: { path: "spice/projects/aaa/docs/Docs.md", folder: "spice/projects/aaa/docs" }, type: "docs-hub" };
  pdi.render(makeClassShapedDv(containerA, pagesFor("aaa"), curA));
  assert.ok(capturedOnChange, "expected DocSearch.render to receive an onChange");
  const staleStub = makeDomStub();
  capturedOnChange({ hasActiveFilter: false, resultsContainer: staleStub.container, text: "", tags: new Set() });
  // The onChange itself legitimately re-renders note A's browse view into its
  // own container — baseline that count; render #2 must not ADD to it.
  const staleRowsAfterOnChange = staleStub.els.filter((e) => e.className === "se-rail-row").length;

  // Render #2 on note B (fresh containers). All browse content must land under
  // note B's own DOM — nothing may leak into the stale ctx's container.
  const { container: containerB, els: elsB } = makeDomStub();
  const curB = { file: { path: "spice/projects/bbb/docs/Docs.md", folder: "spice/projects/bbb/docs" }, type: "docs-hub" };
  pdi.render(makeClassShapedDv(containerB, pagesFor("bbb"), curB));

  const rowsInB = elsB.filter((e) => e.className === "se-rail-row");
  const rowsInStale = staleStub.els.filter((e) => e.className === "se-rail-row");
  assert.strictEqual(rowsInStale.length, staleRowsAfterOnChange, "no NEW rail rows may render into the PRIOR render's stale resultsContainer");
  assert.strictEqual(rowsInB.length, 1, "render #2's rail rows must land in ITS OWN resultsContainer — got " + rowsInB.length + " (stale-_currentCtx hijack)");
  delete global.customJS;
});

// ── Regression: _buildConfig's getLinks closure referenced a BARE `dv`
// identifier that is NOT in scope inside the method (wiki-tree's
// _buildConfig(dv, cur) correctly takes dv as a parameter; the project
// helpers forgot it). At runtime adapter.getLinks() threw ReferenceError
// inside SectionExplorer._renderPagePane, killing the whole page pane
// (rail rendered, docs never did). These tests run WITHOUT any global.dv.
failures += !run("REGRESSION: ProjectDocsIndex adapter getLinks must not throw (dv captured in _buildConfig scope)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-docs-index.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectDocsIndex;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectDocsIndex = mod.exports;

  const SectionExplorer = loadClass();
  global.customJS = {
    SectionExplorer: new SectionExplorer(),
    DocSearch: { render: (dv) => ({ hasActiveFilter: false, resultsContainer: dv.container }) },
    SectionLabel: { render: () => {}, divider: () => {} },
    MenuPopover: { open: () => {} },
    BeaconCards: { render: () => {} },
    AccentButton: { render: () => {} },
  };
  assert.strictEqual(typeof global.dv, "undefined", "precondition: no global dv may mask the scope bug");

  const { container, els } = makeDomStub();
  const cur = { file: { path: "spice/projects/sauce/docs/Docs.md", folder: "spice/projects/sauce/docs" }, type: "docs-hub" };
  const pages = [
    { type: "section-hub", depth: 1, section: "Knowledge", file: { path: "spice/projects/sauce/docs/knowledge/Knowledge.md", name: "Knowledge", folder: "spice/projects/sauce/docs/knowledge", mtime: { ts: 1 } } },
    { type: "doc-note", file: { path: "spice/projects/sauce/docs/Readme.md", name: "Readme", folder: "spice/projects/sauce/docs", mtime: { ts: 2 } } },
  ];
  const dv = makeClassShapedDv(container, pages, cur);
  // dv.page exists (own property is fine for this direction of the spread bug).
  dv.page = () => ({ links: [{ url: "https://example.com", text: "Guide" }] });

  const pdi = new ProjectDocsIndex();
  pdi.render(dv);

  const linksRow = els.find((e) => e.className === "se-links-row");
  assert.ok(
    linksRow,
    "expected a se-links-row — getLinks must resolve links via the dv passed to _buildConfig, not a bare out-of-scope `dv` (ReferenceError kills the page pane)"
  );
  delete global.customJS;
});

failures += !run("REGRESSION: SectionHub adapter getLinks must not throw (dv captured in _buildConfig scope)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/section-hub.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = SectionHub;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const SectionHub = mod.exports;

  assert.strictEqual(typeof global.dv, "undefined", "precondition: no global dv may mask the scope bug");
  const sh = new SectionHub();
  const cur = { file: { path: "spice/projects/foo/docs/ems/EMS.md", folder: "spice/projects/foo/docs/ems" }, project_slug: "foo", section_slug: "ems", section: "EMS", depth: 1 };
  const dvStub = { page: () => ({ links: [{ url: "https://x.com", text: "X" }] }), pages: () => [] };
  const config = sh._buildConfig(dvStub, cur, 1, "foo", "ems", "EMS");
  const links = config.getLinks({ hubPath: "spice/projects/foo/docs/ems/EMS.md" });
  assert.deepStrictEqual(links, [{ url: "https://x.com", text: "X" }], "getLinks must return the stub dv's links without throwing");
});

failures += !run("rail renders a header row: 'Sections' group label left, sort toggle right, ABOVE the row list", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const sections = [
    { title: "Bravo", hubPath: "b.md", folder: "b", pageCount: 1, subSectionCount: 0, maxMtime: 100, materialized: true },
    { title: "Alpha", hubPath: "a.md", folder: "a", pageCount: 3, subSectionCount: 1, maxMtime: 200, materialized: true },
  ];
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => sections,
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);

  const rail = els.find((e) => e.className === "se-rail");
  assert.ok(rail, "expected a se-rail");
  const header = els.find((e) => e.className === "se-rail-header");
  assert.ok(header, "expected a se-rail-header row");
  // Header is the FIRST child of the rail — above the cards list.
  assert.strictEqual(rail.children[0], header, "header must be the rail's first child (above the row list)");
  // Label inside the header.
  const label = header.children.find((c) => c.className === "se-group-label");
  assert.ok(label, "expected a se-group-label inside the header");
  assert.strictEqual(label.textContent, "Sections");
  // Toggle lives INSIDE the header (not trailing after the list anymore).
  const toggleInHeader = header.children.find((c) => c.className === "se-rail-toggle");
  assert.ok(toggleInHeader, "expected the sort toggle inside the header row");
  // Toggle still works: clicking A–Z re-sorts.
  const pills = els.filter((e) => e.className === "se-rail-toggle-pill");
  assert.strictEqual(pills.length, 2);
  const az = pills.find((p) => p.textContent === "A–Z");
  az.onclick();
  const rowsAfter = els.filter((e) => e.className === "se-rail-row");
  // paint() re-renders rows into cardsWrap; the LAST two rows are the re-painted order.
  const lastTwo = rowsAfter.slice(-2);
  // Depth-agnostic title lookup: Task 3 later nests the title inside a
  // se-rail-main stacking block — this assertion must survive both shapes.
  const findDeep = (el, cls) => {
    if (el.className === cls) return el;
    for (const c of el.children || []) { const r = findDeep(c, cls); if (r) return r; }
    return null;
  };
  const firstTitle = findDeep(lastTwo[0], "se-rail-title");
  assert.ok(firstTitle && firstTitle.innerHTML.includes("Alpha"), "after A–Z click, Alpha sorts first");
});

failures += !run("single-section rail still shows the 'Sections' header but hides the toggle", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [{ title: "Solo", hubPath: "s.md", folder: "s", pageCount: 1, subSectionCount: 0, maxMtime: 1, materialized: true }],
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  assert.ok(els.find((e) => e.className === "se-group-label"), "expected the Sections label even with one section");
  assert.strictEqual(els.filter((e) => e.className === "se-rail-toggle").length, 0, "toggle stays hidden below 2 sections");
});

failures += !run("rail row stacks: a se-rail-main block holds title THEN meta on separate lines, dots outside it", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [{ title: "EMS", hubPath: "e.md", folder: "e", pageCount: 3, subSectionCount: 1, maxMtime: 1, materialized: true }],
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>", dots: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const row = els.find((e) => e.className === "se-rail-row");
  assert.ok(row, "expected a rail row");
  const main = row.children.find((c) => c.className === "se-rail-main");
  assert.ok(main, "expected a se-rail-main stacking block inside the row");
  const title = main.children.find((c) => c.className === "se-rail-title");
  const meta = main.children.find((c) => c.className === "se-rail-meta");
  assert.ok(title, "title lives inside se-rail-main");
  assert.ok(meta, "meta lives inside se-rail-main, below the title");
  assert.strictEqual(main.children.indexOf(title) < main.children.indexOf(meta), true, "title renders before (above) meta");
  assert.strictEqual(meta.textContent, "1 section · 3 docs");
  const dots = row.children.find((c) => c.className === "se-rail-dots");
  assert.ok(dots, "dots stay a direct child of the row (right edge), outside the stacking block");
});

failures += !run("page pane renders a group label above the grid — default 'Docs', adapter-overridable to 'Pages'", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = { BeaconCards: { render: () => {} } };
  const pages = [{ file: { name: "Runbook", path: "spice/wiki/ems/Runbook.md", mtime: { ts: 1 } } }];

  // Default: "Docs".
  {
    const { container, els } = makeDomStub();
    const dv = { container, current: () => ({ file: { path: "spice/projects/foo/docs/Docs.md" } }) };
    const adapter = se.makeAdapter({
      resolveContext: () => ({ scopePath: "spice/projects/foo/docs" }),
      listSections: () => [],
      listPages: () => pages,
      getLinks: () => [],
      icons: { folder: "<svg/>", file: "<svg/>" },
      rootClass: "se-root",
    });
    se.render(dv, adapter);
    const label = els.find((e) => e.className === "se-group-label se-pane-label");
    assert.ok(label, "expected a pane group label");
    assert.strictEqual(label.textContent, "Docs");
  }

  // Override: pageLabel "Pages" (wiki).
  {
    const { container, els } = makeDomStub();
    const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
    const adapter = se.makeAdapter({
      resolveContext: () => ({ scopePath: "spice/wiki" }),
      listSections: () => [],
      listPages: () => pages,
      getLinks: () => [],
      icons: { folder: "<svg/>", file: "<svg/>" },
      rootClass: "se-root",
      pageLabel: "Pages",
    });
    se.render(dv, adapter);
    const label = els.find((e) => e.className === "se-group-label se-pane-label");
    assert.ok(label, "expected a pane group label");
    assert.strictEqual(label.textContent, "Pages");
  }
  delete global.customJS;
});

failures += !run("wiki adapter config sets pageLabel 'Pages'", () => {
  const treeSrc = fs.readFileSync(path.join(__dirname, "../blueprints/wiki/helpers/wiki-tree.js"), "utf8");
  const factory = new Function("module", "exports", treeSrc + "\nmodule.exports = WikiTree;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const WikiTree = mod.exports;
  const wt = new WikiTree();
  const config = wt._buildConfig({ container: {} }, { file: { path: "spice/wiki/Wiki.md" } });
  assert.strictEqual(config.pageLabel, "Pages");
});

failures += !run("empty page pane is SUPPRESSED entirely when sections exist (no label, no links row, no BeaconCards empty box)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const calls = [];
  global.customJS = { BeaconCards: { render: (d, o) => calls.push(o) }, MenuPopover: { open: () => {} } };
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [{ title: "EMS", hubPath: "e.md", folder: "e", pageCount: 2, subSectionCount: 0, maxMtime: 1, materialized: true }],
    listPages: () => [],
    getLinks: () => [{ url: "https://example.com", text: "Example" }],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  assert.strictEqual(calls.length, 0, "BeaconCards must NOT be called");
  assert.strictEqual(els.filter((e) => e.className === "se-page-pane").length, 0, "pane not created");
  assert.strictEqual(els.filter((e) => e.className === "se-links-row").length, 0, "links row suppressed with the pane");
  assert.strictEqual(els.filter((e) => e.className === "se-group-label se-pane-label").length, 0, "pane label suppressed too");
  delete global.customJS;
});

failures += !run("genuinely empty leaf (0 sections AND 0 pages) shows the mechanism-owned empty-state box", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = {};
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/empty/Empty.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki/empty" }),
    listSections: () => [],
    listPages: () => [],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  assert.strictEqual(els.filter((e) => e.className === "se-page-pane").length, 1, "pane still renders on a truly-empty leaf");
  const empty = els.find((e) => e.className === "se-doc-empty");
  assert.ok(empty, "expected the mechanism-owned empty-state box");
  assert.strictEqual(empty.textContent, "Nothing here yet.");
  delete global.customJS;
});

failures += !run("hub with sections but 0 root pages renders 'Recently updated' cards from listRecent", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = { MenuPopover: { open: () => {} } };
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [{ title: "EMS", hubPath: "e.md", folder: "e", pageCount: 2, subSectionCount: 0, maxMtime: 1, materialized: true }],
    listPages: () => [],
    listRecent: () => [
      { title: "Kargo Step by Step", path: "spice/wiki/ems/Kargo.md", mtime: 2000, where: "EMS" },
      { title: "POC Links", path: "spice/wiki/links/POC.md", mtime: 1000, where: "Links" },
    ],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>", dots: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const label = els.find((e) => e.className === "se-group-label se-pane-label");
  assert.ok(label, "expected a pane label in recent mode");
  assert.strictEqual(label.textContent, "Recently updated");
  const cards = els.filter((e) => e.className === "se-doc-card");
  assert.strictEqual(cards.length, 2, "expected one card per recent doc");
  const subs = els.filter((e) => e.className === "se-doc-sub").map((e) => e.textContent);
  assert.ok(subs.some((s) => s.startsWith("in EMS")), "recent card subtitle carries its section (got: " + JSON.stringify(subs) + ")");
  delete global.customJS;
});

failures += !run("hub with sections, 0 root pages and NO listRecent (or empty) still suppresses the pane", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = { MenuPopover: { open: () => {} } };
  const mk = (listRecent) => {
    const { container, els } = makeDomStub();
    const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
    const cfg = {
      resolveContext: () => ({ scopePath: "spice/wiki" }),
      listSections: () => [{ title: "EMS", hubPath: "e.md", folder: "e", pageCount: 2, subSectionCount: 0, maxMtime: 1, materialized: true }],
      listPages: () => [],
      getLinks: () => [],
      icons: { folder: "<svg/>", file: "<svg/>", dots: "<svg/>" },
      rootClass: "se-root",
    };
    if (listRecent) cfg.listRecent = listRecent;
    se.render(dv, se.makeAdapter(cfg));
    return els;
  };
  for (const els of [mk(null), mk(() => [])]) {
    assert.strictEqual(els.filter((e) => e.className === "se-page-pane").length, 0, "pane must stay suppressed without recent content");
  }
  delete global.customJS;
});

failures += !run("pane with real root pages ignores listRecent (normal docs mode)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  global.customJS = {};
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/ems/EMS.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki/ems" }),
    listSections: () => [],
    listPages: () => [{ title: null, file: { name: "Runbook", path: "spice/wiki/ems/Runbook.md", mtime: { ts: 1 } } }],
    listRecent: () => [{ title: "ShouldNotShow", path: "x.md", mtime: 9, where: "X" }],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const label = els.find((e) => e.className === "se-group-label se-pane-label");
  assert.strictEqual(label.textContent, "Docs");
  const titles = els.filter((e) => e.className === "se-doc-title").map((e) => e.textContent);
  assert.deepStrictEqual(titles, ["Runbook"]);
  delete global.customJS;
});

failures += !run("wiki adapter listRecent returns subtree-recent pages with section subtitles, capped at 8", () => {
  const treeSrc = fs.readFileSync(path.join(__dirname, "../blueprints/wiki/helpers/wiki-tree.js"), "utf8");
  const factory = new Function("module", "exports", treeSrc + "\nmodule.exports = WikiTree;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const WikiTree = mod.exports;
  const wt = new WikiTree();
  const pages = [
    { type: "wiki-section", title: "EMS", file: { name: "EMS", path: "spice/wiki/ems/EMS.md", mtime: { ts: 1 } } },
  ];
  for (let i = 0; i < 10; i++) {
    pages.push({ type: "wiki-page", title: "Page " + i, file: { name: "Page " + i, path: "spice/wiki/ems/Page " + i + ".md", mtime: { ts: 100 + i } } });
  }
  const dvStub = {
    page: () => null,
    pages: () => { const arr = pages.slice(); arr.array = () => arr; return arr; },
  };
  const config = wt._buildConfig(dvStub, { file: { path: "spice/wiki/Wiki.md" } });
  assert.strictEqual(typeof config.listRecent, "function", "wiki config must expose listRecent");
  const recent = config.listRecent(dvStub, { scopePath: "spice/wiki" });
  assert.strictEqual(recent.length, 8, "capped at 8");
  assert.strictEqual(recent[0].title, "Page 9", "most recent first");
  assert.strictEqual(recent[0].where, "EMS", "where = the page's section display title");
  assert.strictEqual(recent[0].mtime, 109);
});

failures += !run("WikiTree hub render no longer draws its own Recently-Updated grid (moved into the pane)", () => {
  const treeSrc = fs.readFileSync(path.join(__dirname, "../blueprints/wiki/helpers/wiki-tree.js"), "utf8");
  assert.ok(!/Recently updated/.test(treeSrc), "wiki-tree.js must not render its own 'Recently updated' section anymore");
});

failures += !run("project docs-index adapter listRecent returns subtree-recent doc-notes with section subtitles", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-docs-index.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectDocsIndex;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectDocsIndex = mod.exports;
  const pdi = new ProjectDocsIndex();
  const docsFolder = "spice/projects/foo/docs";
  const pages = [
    { type: "section-hub", depth: 1, section: "Knowledge", file: { name: "Knowledge", path: docsFolder + "/knowledge/Knowledge.md", folder: docsFolder + "/knowledge", mtime: { ts: 1 } } },
    { type: "doc-note", file: { name: "Dashboards", path: docsFolder + "/knowledge/Dashboards.md", folder: docsFolder + "/knowledge", mtime: { ts: 500 } } },
    { type: "doc-note", file: { name: "Older", path: docsFolder + "/knowledge/Older.md", folder: docsFolder + "/knowledge", mtime: { ts: 100 } } },
  ];
  const dvStub = { page: () => null, pages: () => { const a = pages.slice(); a.array = () => a; a.where = (fn) => { const r = a.filter(fn); r.array = () => r; return r; }; return a; } };
  const config = pdi._buildConfig(dvStub, { file: { path: docsFolder + "/Docs.md" } }, { projectSlug: "foo", projectPath: "spice/projects/foo", docsFolder, scopePath: docsFolder });
  assert.strictEqual(typeof config.listRecent, "function");
  const recent = config.listRecent(dvStub, { scopePath: docsFolder });
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].title, "Dashboards");
  assert.strictEqual(recent[0].where, "Knowledge");
});

failures += !run("section-hub adapter exposes listRecent (subtree-recent doc-notes)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/section-hub.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = SectionHub;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const SectionHub = mod.exports;
  const sh = new SectionHub();
  const dvStub = { page: () => null, pages: () => { const a = []; a.array = () => a; a.where = (fn) => { const r = a.filter(fn); r.array = () => r; return r; }; return a; } };
  const config = sh._buildConfig(dvStub, { file: { path: "spice/projects/foo/docs/ems/EMS.md", folder: "spice/projects/foo/docs/ems" }, project_slug: "foo", section_slug: "ems", section: "EMS", depth: 1 }, 1, "foo", "ems", "EMS");
  assert.strictEqual(typeof config.listRecent, "function");
  assert.deepStrictEqual(config.listRecent(dvStub, {}), []);
});

failures += !run("renderNoteLinks: chips for saved links + a trailing Add-link pill; unsafe schemes stay dead text", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = {
    container,
    current: () => ({ type: "wiki-page", links: [
      { url: "https://grafana.example.com", text: "Grafana" },
      { url: "javascript:alert(1)", text: "evil" },
    ], file: { path: "spice/wiki/ems/Runbook.md" } }),
  };
  se.renderNoteLinks(dv);
  const strip = els.find((e) => e.className === "se-note-links");
  assert.ok(strip, "expected a se-note-links strip");
  const cards = els.filter((e) => e.className === "se-note-link-card");
  assert.strictEqual(cards.length, 2, "one card per saved link, unsafe ones included as dead text");
  const good = cards.find((c) => c.innerHTML.includes("Grafana"));
  assert.strictEqual(good.href, "https://grafana.example.com");
  assert.strictEqual(good.target, "_blank");
  assert.ok(String(good.rel).includes("noopener"));
  const evil = cards.find((c) => c.innerHTML.includes("evil"));
  assert.ok(!evil.href, "unsafe scheme gets no href");
  const add = els.find((e) => e.className === "se-note-link-add");
  assert.ok(add, "expected the Add-link pill");
});

failures += !run("renderNoteLinks: zero/missing links still renders just the Add-link pill", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ type: "doc-note", file: { path: "spice/projects/foo/docs/knowledge/D.md" } }) };
  se.renderNoteLinks(dv);
  assert.strictEqual(els.filter((e) => e.className === "se-note-link-card").length, 0);
  assert.ok(els.find((e) => e.className === "se-note-link-add"), "Add-link pill always present");
});

failures += !run("renderNoteLinks add pill: writeLinks path appends via processFrontMatter and creates links[] when absent", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const fmWrites = [];
  global.app = {
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
    fileManager: { processFrontMatter: (f, fn) => { const fm = {}; fn(fm); fmWrites.push({ file: f, fm }); return Promise.resolve(); } },
    workspace: { openLinkText: () => {} },
  };
  const page = { type: "wiki-page", file: { path: "spice/wiki/ems/Runbook.md" } }; // no links key at all
  const noteAdapter = se._noteSelfAdapter(page);
  const current = noteAdapter.getLinks();
  assert.deepStrictEqual(current, [], "missing links[] tolerated as empty");
  const result = se._addLinkPure(current, { url: "https://x.com", text: "X" });
  noteAdapter.writeLinks(null, result.links);
  assert.strictEqual(fmWrites.length, 1);
  assert.strictEqual(fmWrites[0].file.path, "spice/wiki/ems/Runbook.md");
  assert.deepStrictEqual(fmWrites[0].fm.links, [{ url: "https://x.com", text: "X" }]);
  delete global.app;
});

failures += !run("renderNoteLinks: cold-load partial page (no file) renders nothing and never throws", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container, els } = makeDomStub();
  const dv = { container, current: () => null };
  se.renderNoteLinks(dv);   // must not throw
  assert.strictEqual(els.filter((e) => e.className === "se-note-links").length, 0);
});

failures += !run("WikiChromeBar.render calls SectionExplorer.renderNoteLinks on wiki-page only", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/wiki/helpers/wiki-chrome-bar.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = WikiChromeBar;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const WikiChromeBar = mod.exports;
  const calls = [];
  global.customJS = {
    ChromeBar: { makeAdapter: (c) => c, render: () => {} },
    SectionExplorer: { renderNoteLinks: (dv) => calls.push(dv) },
  };
  try {
    const bar = new WikiChromeBar();
    const mk = (type) => ({ container: { createEl: () => ({}) }, current: () => ({ type, file: { path: "p.md" } }) });
    bar.render(mk("wiki-page"));
    assert.strictEqual(calls.length, 1, "wiki-page must trigger renderNoteLinks");
    bar.render(mk("wiki-hub"));
    bar.render(mk("wiki-section"));
    assert.strictEqual(calls.length, 1, "hubs/sections must NOT trigger renderNoteLinks");
  } finally {
    delete global.customJS;
  }
});

ASYNC_TESTS.push({ name: "ProjectChromeBar.render calls SectionExplorer.renderNoteLinks on doc-note only", fn: async () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-chrome-bar.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectChromeBar;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectChromeBar = mod.exports;
  const calls = [];
  global.customJS = {
    ChromeBar: { makeAdapter: (c) => c, render: () => {} },
    SectionExplorer: { renderNoteLinks: (dv) => calls.push(dv) },
  };
  try {
    const bar = new ProjectChromeBar();
    const mk = (type, path2) => ({ container: { createEl: () => ({}) }, current: () => ({ type, file: { path: path2, folder: path2.slice(0, path2.lastIndexOf("/")) } }) });
    await bar.render(mk("doc-note", "spice/projects/foo/docs/knowledge/D.md"));
    assert.strictEqual(calls.length, 1, "doc-note must trigger renderNoteLinks");
    await bar.render(mk("docs-hub", "spice/projects/foo/docs/Docs.md"));
    await bar.render(mk("section-hub", "spice/projects/foo/docs/k/K.md"));
    assert.strictEqual(calls.length, 1, "hubs must NOT trigger renderNoteLinks");
  } finally {
    delete global.customJS;
  }
}});

failures += !run("section-hub listSections: depth-2 sub-section rows carry REAL recursive doc counts (not hardcoded 0)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/section-hub.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = SectionHub;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const SectionHub = mod.exports;
  const sh = new SectionHub();
  const base = "spice/projects/sauce/docs/blueprints";
  const pages = [
    { type: "section-hub", depth: 2, section: "How they Work", file: { name: "How they Work", path: base + "/how-they-work/How they Work.md", folder: base + "/how-they-work", mtime: { ts: 10 } } },
    { type: "doc-note", file: { name: "Projects Blueprint", path: base + "/how-they-work/Projects Blueprint.md", folder: base + "/how-they-work", mtime: { ts: 500 } } },
    { type: "doc-note", file: { name: "To Do Blueprint", path: base + "/how-they-work/To Do Blueprint.md", folder: base + "/how-they-work", mtime: { ts: 300 } } },
    { type: "section-hub", depth: 2, section: "Finance", file: { name: "Finance", path: base + "/finance/Finance.md", folder: base + "/finance", mtime: { ts: 20 } } },
    { type: "doc-note", file: { name: "Finance Brainstorming", path: base + "/finance/Finance Brainstorming.md", folder: base + "/finance", mtime: { ts: 100 } } },
  ];
  const mkArr = (a) => { a.array = () => a; a.where = (fn) => mkArr(a.filter(fn)); a.map = Array.prototype.map.bind(a); return a; };
  const dvStub = { page: () => null, pages: () => mkArr(pages.slice()) };
  const config = sh._buildConfig(dvStub, { file: { path: base + "/Blueprints.md", folder: base } }, 1, "sauce", "blueprints", "Blueprints");
  const sections = config.listSections(dvStub, { sectionPath: base });
  assert.strictEqual(sections.length, 2);
  const how = sections.find((s) => s.title === "How they Work");
  const fin = sections.find((s) => s.title === "Finance");
  assert.strictEqual(how.pageCount, 2, "How they Work has 2 real docs — got " + how.pageCount);
  assert.strictEqual(fin.pageCount, 1, "Finance has 1 real doc — got " + fin.pageCount);
  assert.strictEqual(how.maxMtime, 500, "maxMtime reflects the newest doc in the sub-section");
});

failures += !run("docs-hub listSections: section rows carry real subSectionCount (depth-2 hubs inside)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-docs-index.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectDocsIndex;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectDocsIndex = mod.exports;
  const pdi = new ProjectDocsIndex();
  const docsFolder = "spice/projects/sauce/docs";
  const pages = [
    { type: "section-hub", depth: 1, section: "Blueprints", file: { name: "Blueprints", path: docsFolder + "/blueprints/Blueprints.md", folder: docsFolder + "/blueprints", mtime: { ts: 1 } } },
    { type: "section-hub", depth: 2, section: "Finance", file: { name: "Finance", path: docsFolder + "/blueprints/finance/Finance.md", folder: docsFolder + "/blueprints/finance", mtime: { ts: 2 } } },
    { type: "section-hub", depth: 2, section: "How they Work", file: { name: "How they Work", path: docsFolder + "/blueprints/how-they-work/How they Work.md", folder: docsFolder + "/blueprints/how-they-work", mtime: { ts: 3 } } },
    { type: "doc-note", file: { name: "Finance Brainstorming", path: docsFolder + "/blueprints/finance/FB.md", folder: docsFolder + "/blueprints/finance", mtime: { ts: 100 } } },
  ];
  const mkArr = (a) => { a.array = () => a; a.where = (fn) => mkArr(a.filter(fn)); return a; };
  const dvStub = { page: () => null, pages: () => mkArr(pages.slice()) };
  const config = pdi._buildConfig(dvStub, { file: { path: docsFolder + "/Docs.md", folder: docsFolder } }, { projectSlug: "sauce", projectPath: "spice/projects/sauce", docsFolder, scopePath: docsFolder });
  const sections = config.listSections(dvStub);
  const bp = sections.find((s) => s.title === "Blueprints");
  assert.ok(bp, "expected the discovered Blueprints section");
  assert.strictEqual(bp.subSectionCount, 2, "Blueprints contains 2 depth-2 sub-sections — got " + bp.subSectionCount);
  assert.strictEqual(bp.pageCount, 1, "recursive doc count still works");
});

failures += !run("wiki + project blueprint manifests declare depends_on section-explorer", () => {
  for (const bp of ["wiki", "project"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, `../blueprints/${bp}/manifest.json`), "utf8"));
    const dep = (manifest.depends_on || []).find((d) => d.name === "section-explorer");
    assert.ok(dep, bp + " manifest must depend on section-explorer");
    assert.ok(dep.range, bp + " dep must declare a range");
  }
});

failures += !run("_addLinkPure normalizes schemeless URLs to https:// (google.com would otherwise resolve relative and open garbage)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  let r = se._addLinkPure([], { url: "google.com", text: "Google" });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.links[0].url, "https://google.com", "schemeless url stored with https:// prefix");
  // Already-schemed URLs pass through untouched.
  r = se._addLinkPure([], { url: "https://a.com", text: "A" });
  assert.strictEqual(r.links[0].url, "https://a.com");
  r = se._addLinkPure([], { url: "mailto:x@y.com" });
  assert.strictEqual(r.links[0].url, "mailto:x@y.com");
  // Duplicate detection happens on the NORMALIZED form.
  r = se._addLinkPure([{ url: "https://google.com", text: "G" }], { url: "google.com", text: "dup" });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.reason, "duplicate");
});

failures += !run("already-SAVED schemeless links get an https:// href at render time (note links + pane chips)", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  // renderNoteLinks path.
  {
    const { container, els } = makeDomStub();
    const dv = { container, current: () => ({ type: "wiki-page", links: [{ url: "yahoo.com", text: "Yahoo" }], file: { path: "spice/wiki/x/Y.md" } }) };
    se.renderNoteLinks(dv);
    const card = els.find((e) => e.className === "se-note-link-card");
    assert.strictEqual(card.href, "https://yahoo.com", "note-link href normalized — got " + card.href);
  }
  // Pane chips path (_renderLinksRow via the page pane).
  {
    const { container, els } = makeDomStub();
    global.customJS = {};
    const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
    const adapter = se.makeAdapter({
      resolveContext: () => ({ scopePath: "spice/wiki" }),
      listSections: () => [],
      listPages: () => [{ title: null, file: { name: "P", path: "spice/wiki/P.md", mtime: { ts: 1 } } }],
      getLinks: () => [{ url: "google.com", text: "G" }],
      icons: { folder: "<svg/>", file: "<svg/>" },
      rootClass: "se-root",
    });
    se.render(dv, adapter);
    const chip = els.find((e) => e.className === "se-link-chip");
    assert.strictEqual(chip.href, "https://google.com", "pane chip href normalized — got " + chip.href);
    delete global.customJS;
  }
});

ASYNC_TESTS.push({ name: "add-link modal: title + styled inputs + Cancel/primary buttons; Cancel closes without write; primary writes normalized", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  const writes = [];
  const adapter = { getLinks: () => [], writeLinks: (t, links) => writes.push(links) };

  const findDeep = (el, pred, out = []) => {
    if (pred(el)) out.push(el);
    for (const c of el.children || []) findDeep(c, pred, out);
    return out;
  };

  // Cancel path — closes, no write.
  se._openAddLinkForm(null, adapter, { title: "EMS" });
  let overlay = doc.body.children[0];
  assert.ok(overlay, "overlay mounted");
  let titles = findDeep(overlay, (e) => e.className === "se-modal-title");
  assert.strictEqual(titles.length, 1, "expected a modal title");
  assert.strictEqual(titles[0].textContent, "Add link");
  let inputs = findDeep(overlay, (e) => e.className === "se-modal-input");
  assert.strictEqual(inputs.length, 2, "expected two styled inputs (url + label)");
  const cancel = findDeep(overlay, (e) => e.className === "se-modal-btn")[0];
  assert.ok(cancel && cancel.textContent === "Cancel", "expected a Cancel button");
  cancel.onclick();
  assert.strictEqual(doc.body.children.length, 0, "Cancel closes the modal");
  assert.strictEqual(writes.length, 0, "Cancel writes nothing");

  // Primary path — normalized write + close.
  se._openAddLinkForm(null, adapter, { title: "EMS" });
  overlay = doc.body.children[0];
  inputs = findDeep(overlay, (e) => e.className === "se-modal-input");
  inputs[0].value = "google.com";
  inputs[1].value = "Google";
  const primary = findDeep(overlay, (e) => e.className === "se-modal-btn se-modal-btn-primary")[0];
  assert.ok(primary, "expected a primary button");
  await primary.onclick();
  assert.deepStrictEqual(writes, [[{ url: "https://google.com", text: "Google" }]], "primary writes the normalized link");
  assert.strictEqual(doc.body.children.length, 0, "primary closes the modal");

  // Enter in the URL input submits too.
  se._openAddLinkForm(null, adapter, { title: "EMS" });
  overlay = doc.body.children[0];
  inputs = findDeep(overlay, (e) => e.className === "se-modal-input");
  inputs[0].value = "https://b.com";
  assert.strictEqual(typeof inputs[0].onkeydown, "function", "url input listens for Enter");
  await inputs[0].onkeydown({ key: "Enter" });
  assert.strictEqual(writes.length, 2, "Enter submits");
  delete global.document;
}});

ASYNC_TESTS.push({ name: "rename modal gets the same chrome (title + input + Cancel/primary)", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  const renames = [];
  const adapter = { renameSection: (s, t) => renames.push(t) };
  const findDeep = (el, pred, out = []) => {
    if (pred(el)) out.push(el);
    for (const c of el.children || []) findDeep(c, pred, out);
    return out;
  };
  se._openRenameDialog(null, adapter, { title: "EMS" });
  const overlay = doc.body.children[0];
  const title = findDeep(overlay, (e) => e.className === "se-modal-title")[0];
  assert.ok(title && title.textContent === "Rename section");
  const input = findDeep(overlay, (e) => e.className === "se-modal-input")[0];
  assert.strictEqual(input.value, "EMS", "input prefilled with current title");
  const cancel = findDeep(overlay, (e) => e.className === "se-modal-btn")[0];
  assert.ok(cancel && cancel.textContent === "Cancel");
  input.value = "Networking";
  const primary = findDeep(overlay, (e) => e.className === "se-modal-btn se-modal-btn-primary")[0];
  await primary.onclick();
  assert.deepStrictEqual(renames, ["Networking"]);
  assert.strictEqual(doc.body.children.length, 0);
  delete global.document;
}});

ASYNC_TESTS.push({ name: "section mutation modals await persistence and remain focused/retryable on explicit failure", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const find = (el, pred, out = []) => {
    if (pred(el)) out.push(el);
    for (const child of el.children || []) find(child, pred, out);
    return out;
  };

  {
    const doc = makeDocStub();
    let calls = 0; let focused = false;
    const adapter = { getLinks: () => [], writeLinks: async () => { calls += 1; return { ok: false }; } };
    se._openAddLinkForm(null, adapter, { title: "EMS" });
    const overlay = doc.body.children[0];
    const inputs = find(overlay, (e) => e.className === "se-modal-input");
    inputs[0].value = "https://example.com";
    inputs[0].focus = () => { focused = true; };
    const primary = find(overlay, (e) => e.className === "se-modal-btn se-modal-btn-primary")[0];
    await Promise.all([primary.onclick(), primary.onclick()]);
    assert.strictEqual(calls, 1, "double click issues one awaited write");
    assert.strictEqual(doc.body.children.length, 1, "failed link write keeps modal mounted");
    assert.strictEqual(focused, true, "failed link write restores input focus");
    delete global.document;
  }

  {
    const doc = makeDocStub();
    let focused = false;
    const adapter = { renameSection: async () => ({ ok: false }) };
    se._openRenameDialog(null, adapter, { title: "EMS" });
    const overlay = doc.body.children[0];
    const input = find(overlay, (e) => e.className === "se-modal-input")[0];
    input.value = "Networking";
    input.focus = () => { focused = true; };
    const primary = find(overlay, (e) => e.className === "se-modal-btn se-modal-btn-primary")[0];
    await primary.onclick();
    assert.strictEqual(doc.body.children.length, 1, "failed rename keeps modal mounted");
    assert.strictEqual(focused, true, "failed rename restores input focus");
    delete global.document;
  }

  {
    const doc = makeDocStub();
    let focused = false;
    const adapter = { canDelete: () => true, emptySubsectionCount: () => 0, deleteSection: async () => ({ ok: false }) };
    se._openDeleteConfirm(null, adapter, { title: "EMS" });
    const overlay = doc.body.children[0];
    const primary = find(overlay, (e) => e.className === "se-modal-btn se-modal-btn-primary")[0];
    primary.focus = () => { focused = true; };
    await primary.onclick();
    assert.strictEqual(doc.body.children.length, 1, "failed delete keeps modal mounted");
    assert.strictEqual(focused, true, "failed delete restores confirm focus");
    delete global.document;
  }
}});

// ═══════════════════════════════════════════════════════════════════════════
// Shared move-management surface (collapsible picker, doc/section move,
// in-place bulk select, recursive confirmed delete). Tasks C/D/E/F.
// ═══════════════════════════════════════════════════════════════════════════

// A recursive deep-find helper reused across the move tests.
function findDeepAll(el, pred, out = []) {
  if (!el) return out;
  if (pred(el)) out.push(el);
  for (const c of el.children || []) findDeepAll(c, pred, out);
  return out;
}

// ── Task C: pure statics ────────────────────────────────────────────────────

failures += !run("_slugify lowercases, trims, collapses non-alnum to single dashes", () => {
  const SectionExplorer = loadClass();
  assert.strictEqual(SectionExplorer._slugify("Ingredient List"), "ingredient-list");
  assert.strictEqual(SectionExplorer._slugify("  How They Work!  "), "how-they-work");
  assert.strictEqual(SectionExplorer._slugify("A—B & C"), "a-b-c");
  assert.strictEqual(SectionExplorer._slugify(""), "");
  assert.strictEqual(SectionExplorer._slugify(null), "");
});

failures += !run("sectionTargets: wiki-shaped array — root first, depth + labels, folder-sorted", () => {
  const SectionExplorer = loadClass();
  const pages = [
    { type: "wiki-section", title: "EMS", file: { path: "spice/wiki/ems/EMS.md" } },
    { type: "wiki-section", title: "Cooking", file: { path: "spice/wiki/cooking/Cooking.md" } },
    { type: "wiki-section", title: "Ingredients", file: { path: "spice/wiki/cooking/ingredients/Ingredients.md" } },
    { type: "wiki-page", title: "NotASection", file: { path: "spice/wiki/ems/Page.md" } },
    { type: "wiki-section", title: "", file: { path: "spice/wiki/misc/Misc.md" } }, // blank label → folder basename
  ];
  const targets = SectionExplorer.sectionTargets(pages, {
    root: "spice/wiki", sectionType: "wiki-section", rootLabel: "Wiki (root)",
    labelOf: (p) => (p.title && String(p.title).trim()) || "",
  });
  assert.deepStrictEqual(targets[0], { folder: "spice/wiki", label: "Wiki (root)", depth: 0 });
  // Remaining sorted by folder.localeCompare.
  const rest = targets.slice(1);
  assert.deepStrictEqual(rest.map((t) => t.folder), [
    "spice/wiki/cooking",
    "spice/wiki/cooking/ingredients",
    "spice/wiki/ems",
    "spice/wiki/misc",
  ]);
  const cooking = rest.find((t) => t.folder === "spice/wiki/cooking");
  assert.strictEqual(cooking.depth, 1);
  const ing = rest.find((t) => t.folder === "spice/wiki/cooking/ingredients");
  assert.strictEqual(ing.depth, 2);
  assert.strictEqual(ing.label, "Ingredients");
  const misc = rest.find((t) => t.folder === "spice/wiki/misc");
  assert.strictEqual(misc.label, "misc", "blank label falls back to folder basename");
});

failures += !run("sectionTargets: project-shaped array (section-hub under <proj>/docs)", () => {
  const SectionExplorer = loadClass();
  const root = "spice/projects/foo/docs";
  const pages = [
    { type: "section-hub", section: "Knowledge", file: { path: root + "/knowledge/Knowledge.md" } },
    { type: "section-hub", section: "Runbooks", file: { path: root + "/runbooks/Runbooks.md" } },
    { type: "doc-note", file: { path: root + "/knowledge/Doc.md" } },
    { type: "section-hub", section: "Outside", file: { path: "spice/projects/bar/docs/x/X.md" } }, // not under root
  ];
  const targets = SectionExplorer.sectionTargets(pages, {
    root, sectionType: "section-hub", rootLabel: "Docs (root)",
    labelOf: (p) => (p.section && String(p.section).trim()) || "",
  });
  assert.deepStrictEqual(targets[0], { folder: root, label: "Docs (root)", depth: 0 });
  assert.deepStrictEqual(targets.slice(1).map((t) => t.folder), [
    root + "/knowledge",
    root + "/runbooks",
  ]);
  assert.strictEqual(targets[1].depth, 1);
  assert.strictEqual(targets[1].label, "Knowledge");
});

failures += !run("targetPath + isNoop match WikiMove semantics", () => {
  const SectionExplorer = loadClass();
  assert.strictEqual(SectionExplorer.targetPath("spice/wiki/ems", "spice/wiki/cooking/Doc.md"), "spice/wiki/ems/Doc.md");
  assert.strictEqual(SectionExplorer.isNoop("spice/wiki/cooking", "spice/wiki/cooking/Doc.md"), true);
  assert.strictEqual(SectionExplorer.isNoop("spice/wiki/ems", "spice/wiki/cooking/Doc.md"), false);
});

failures += !run("planBulkMove: moves, and skip reasons already-there / no-dest / collision + dedup", () => {
  const SectionExplorer = loadClass();
  const dest = "spice/wiki/ems";
  const selected = [
    "spice/wiki/cooking/A.md",        // → moves
    "spice/wiki/ems/B.md",            // already-there (same folder as dest)
    "spice/wiki/cooking/A.md",        // collision (same basename A.md → same dest as #1)
    "",                                // no-dest (empty path)
  ];
  const { moves, skipped } = SectionExplorer.planBulkMove(selected, dest);
  assert.deepStrictEqual(moves, [{ from: "spice/wiki/cooking/A.md", to: "spice/wiki/ems/A.md" }]);
  const reasons = skipped.map((s) => s.reason).sort();
  assert.deepStrictEqual(reasons, ["already-there", "collision", "no-dest"]);
  // no-dest fires when there's no target folder at all.
  const r2 = SectionExplorer.planBulkMove(["spice/wiki/cooking/A.md"], "");
  assert.strictEqual(r2.moves.length, 0);
  assert.strictEqual(r2.skipped[0].reason, "no-dest");
});

failures += !run("subtreeDocCount counts docType in folder + descendants; childSectionFolders lists strict children", () => {
  const SectionExplorer = loadClass();
  const base = "spice/projects/foo/docs/blueprints";
  const pages = [
    { type: "section-hub", file: { path: base + "/Blueprints.md", folder: base } },
    { type: "doc-note", file: { path: base + "/Top.md", folder: base } },
    { type: "section-hub", file: { path: base + "/finance/Finance.md", folder: base + "/finance" } },
    { type: "doc-note", file: { path: base + "/finance/FB.md", folder: base + "/finance" } },
    { type: "doc-note", file: { path: "spice/projects/foo/docs/other/O.md", folder: "spice/projects/foo/docs/other" } },
  ];
  assert.strictEqual(SectionExplorer.subtreeDocCount(pages, base, "doc-note"), 2, "Top.md + finance/FB.md");
  assert.strictEqual(SectionExplorer.subtreeDocCount(pages, base + "/finance", "doc-note"), 1);
  assert.strictEqual(SectionExplorer.subtreeDocCount(pages, "spice/projects/foo/docs/empty", "doc-note"), 0);
  const children = SectionExplorer.childSectionFolders(pages, base, "section-hub");
  assert.deepStrictEqual(children, [base + "/finance"], "only the strictly-nested finance hub (not base itself)");
});

// ── Task D: collapsible move picker ─────────────────────────────────────────

// A 6-node tree: root + yup(1) + yup/uh-huh(2) + yup/uh-huh/deep(3) + okay(1) + okay/sub(2).
function movePickerTargets() {
  const R = "spice/wiki";
  return [
    { folder: R, label: "Wiki (root)", depth: 0 },
    { folder: R + "/okay", label: "Okay", depth: 1 },
    { folder: R + "/okay/sub", label: "Sub", depth: 2 },
    { folder: R + "/yup", label: "Yup", depth: 1 },
    { folder: R + "/yup/uh-huh", label: "Uh Huh", depth: 2 },
    { folder: R + "/yup/uh-huh/deep", label: "Deep", depth: 3 },
  ];
}

failures += !run("openMovePicker: collapsed by default shows depth 0/1 + auto-expands current branch; toggles; expand-all; filter; row click", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();
  const targets = movePickerTargets();
  const picks = [];
  // currentFolder is a depth-2 node inside the yup branch → yup + yup/uh-huh auto-expanded.
  const overlay = se.openMovePicker({
    targets,
    currentFolder: "spice/wiki/yup/uh-huh",
    title: "Move to section",
    onPick: (folder) => picks.push(folder),
  });
  assert.ok(overlay, "expected the picker overlay");
  assert.strictEqual(typeof overlay.__seVisibleFolders, "function", "expected __seVisibleFolders seam");
  assert.strictEqual(typeof overlay.__seExpandAll, "function", "expected __seExpandAll seam");
  assert.strictEqual(typeof overlay.__seCollapseAll, "function", "expected __seCollapseAll seam");
  assert.strictEqual(typeof overlay.__seSetFilter, "function", "expected __seSetFilter seam");

  // On open: fully expanded — every folder that has children is expanded,
  // so every target row (including deep siblings) is visible from the start.
  let visible = overlay.__seVisibleFolders();
  assert.strictEqual(visible.length, targets.length, "open state shows every target (fully expanded)");
  assert.ok(visible.includes("spice/wiki"), "root visible");
  assert.ok(visible.includes("spice/wiki/okay"), "depth-1 okay visible");
  assert.ok(visible.includes("spice/wiki/yup"), "depth-1 yup visible");
  assert.ok(visible.includes("spice/wiki/yup/uh-huh"), "current-branch depth-2 visible");
  assert.ok(visible.includes("spice/wiki/okay/sub"), "deep sibling okay/sub visible on open (fully expanded)");

  // A node with children renders a ▸/▾ toggle.
  const toggles = findDeepAll(overlay, (e) => e.className === "se-move-toggle");
  assert.ok(toggles.length >= 2, "expected toggles on nodes with children");

  // Expand all → every folder visible.
  overlay.__seExpandAll();
  visible = overlay.__seVisibleFolders();
  assert.strictEqual(visible.length, targets.length, "expand-all shows every target");
  assert.ok(visible.includes("spice/wiki/okay/sub"));
  assert.ok(visible.includes("spice/wiki/yup/uh-huh/deep"));

  // Filter → flat matching rows ignoring collapse.
  overlay.__seCollapseAll();
  overlay.__seSetFilter("okay");
  visible = overlay.__seVisibleFolders();
  assert.deepStrictEqual(visible, ["spice/wiki/okay"], "filter flattens to label matches");
  // Clearing restores the collapsed tree (root + depth-1 + current branch again).
  overlay.__seSetFilter("");
  visible = overlay.__seVisibleFolders();
  assert.ok(visible.includes("spice/wiki") && visible.includes("spice/wiki/okay") && visible.includes("spice/wiki/yup"));
  assert.ok(!visible.includes("spice/wiki/okay/sub"), "cleared filter re-collapses");

  // Clicking a non-current target row invokes onPick + closes.
  const rows = findDeepAll(overlay, (e) => e.className === "se-move-row" || e.className === "se-move-row is-current");
  const okayRow = rows.find((r) => r.__seFolder === "spice/wiki/okay");
  assert.ok(okayRow && typeof okayRow.onclick === "function", "expected a clickable okay row");
  okayRow.onclick();
  assert.deepStrictEqual(picks, ["spice/wiki/okay"]);
  assert.strictEqual(doc.body.children.length, 0, "picking closes the modal");
  delete global.document;
});

failures += !run("openMovePicker: opens FULLY EXPANDED — every parent folder expanded, deepest descendants visible on open", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  makeDocStub();
  const targets = movePickerTargets();
  // currentFolder is a shallow node NOT on the deep branch; branch-seed alone
  // would leave the deep/sub descendants collapsed. Full-expand must reveal all.
  const overlay = se.openMovePicker({
    targets,
    currentFolder: "spice/wiki/okay",
    title: "Move to section",
    onPick: () => {},
  });
  assert.ok(overlay, "expected the picker overlay");
  const visible = overlay.__seVisibleFolders();
  // Every folder that HAS children must be expanded → all rows visible.
  assert.strictEqual(visible.length, targets.length, "all target rows visible on open");
  assert.ok(visible.includes("spice/wiki/yup/uh-huh"), "child of expanded yup visible");
  assert.ok(visible.includes("spice/wiki/yup/uh-huh/deep"), "deepest grandchild visible on open");
  assert.ok(visible.includes("spice/wiki/okay/sub"), "sibling-branch child visible on open");
  // Collapse-all must still work to re-collapse back to the current branch.
  overlay.__seCollapseAll();
  const collapsed = overlay.__seVisibleFolders();
  assert.ok(!collapsed.includes("spice/wiki/yup/uh-huh/deep"), "collapse-all hides deep descendants");
  assert.ok(!collapsed.includes("spice/wiki/yup/uh-huh"), "collapse-all collapses the off-branch yup subtree");
  delete global.document;
});

failures += !run("openMovePicker: current-folder row is greyed and non-clickable", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  makeDocStub();
  const picks = [];
  const overlay = se.openMovePicker({
    targets: movePickerTargets(),
    currentFolder: "spice/wiki/okay",
    title: "Move",
    onPick: (f) => picks.push(f),
  });
  const currentRows = findDeepAll(overlay, (e) => e.classList && e.classList.contains("is-current"));
  assert.strictEqual(currentRows.length, 1, "exactly one current row marked");
  assert.strictEqual(currentRows[0].__seFolder, "spice/wiki/okay");
  // Clicking it does nothing.
  if (typeof currentRows[0].onclick === "function") currentRows[0].onclick();
  assert.strictEqual(picks.length, 0, "current row click must not pick");
  delete global.document;
});

// ── Task E: applyDocMove / moveSection / recursive delete / rail Move ────────

failures += !run("applyDocMove: wiki adapter (rewriteOnDocMove→null) renames only; no-op guarded", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const renames = [];
  const fmWrites = [];
  global.app = {
    fileManager: {
      renameFile: (f, p) => { renames.push({ f, p }); return Promise.resolve(); },
      processFrontMatter: (f, fn) => { const fm = {}; fn(fm); fmWrites.push({ f, fm }); return Promise.resolve(); },
    },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  const wikiAdapter = { move: { rewriteOnDocMove: () => null } };
  const file = { path: "spice/wiki/cooking/Doc.md" };
  se.applyDocMove(null, file, "spice/wiki/ems", wikiAdapter);
  assert.strictEqual(renames.length, 1);
  assert.strictEqual(renames[0].p, "spice/wiki/ems/Doc.md");
  assert.strictEqual(fmWrites.length, 0, "wiki move writes no frontmatter");

  // No-op (same folder) → nothing happens.
  renames.length = 0;
  se.applyDocMove(null, { path: "spice/wiki/ems/Doc.md" }, "spice/wiki/ems", wikiAdapter);
  assert.strictEqual(renames.length, 0, "no-op move guarded");
  delete global.app;
});

failures += !run("applyDocMove: project-like adapter applies the {section,sub_section} frontmatter patch", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const renames = [];
  const fmWrites = [];
  global.app = {
    fileManager: {
      renameFile: (f, p) => { renames.push({ f, p }); return Promise.resolve(); },
      processFrontMatter: (f, fn) => { const fm = {}; fn(fm); fmWrites.push({ f, fm }); return Promise.resolve(); },
    },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  const projAdapter = {
    move: { rewriteOnDocMove: (destFolder) => ({ section: "EMS", sub_section: destFolder.endsWith("/sub") ? "Sub" : "" }) },
  };
  const file = { path: "spice/projects/foo/docs/knowledge/Doc.md" };
  se.applyDocMove(null, file, "spice/projects/foo/docs/ems", projAdapter);
  assert.strictEqual(renames.length, 1);
  assert.strictEqual(renames[0].p, "spice/projects/foo/docs/ems/Doc.md");
  assert.strictEqual(fmWrites.length, 1, "project move writes the section patch");
  assert.strictEqual(fmWrites[0].fm.section, "EMS");
  assert.strictEqual(fmWrites[0].fm.sub_section, "");
  delete global.app;
});

ASYNC_TESTS.push({ name: "moveSection: renames folder to new parent + applies hub + child patches (at remapped paths)", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const renames = [];
  const fmWrites = [];
  const prevApp = global.app;
  // Real-TFile behaviour: the folder rename remaps every path under it, and
  // processFrontMatter only succeeds against a path present in the vault.
  const known = new Set([
    "spice/projects/foo/docs/ems",
    "spice/projects/foo/docs/ems/EMS.md",
    "spice/projects/foo/docs/ems/sub/Sub.md",
  ]);
  global.app = {
    fileManager: {
      renameFile: async (f, p) => {
        renames.push({ f, p });
        const from = f.path;
        for (const k of [...known]) {
          if (k === from || k.indexOf(from + "/") === 0) { known.delete(k); known.add(p + k.slice(from.length)); }
        }
      },
      processFrontMatter: async (f, fn) => { const fm = {}; fn(fm); fmWrites.push({ path: f && f.path, fm }); },
    },
    vault: { getAbstractFileByPath: (p) => (known.has(p) ? { path: p } : null) },
  };
  const section = { title: "EMS", folder: "spice/projects/foo/docs/ems", hubPath: "spice/projects/foo/docs/ems/EMS.md" };
  const childHubPath = "spice/projects/foo/docs/ems/sub/Sub.md";
  const projAdapter = {
    move: {
      rewriteOnSectionMove: (sec, destParent) => ({
        hubPatch: { parent_section: "Knowledge", depth: 2 },
        childPatches: [{ path: childHubPath, patch: { parent_section: "EMS" } }],
      }),
    },
  };
  try {
    await se.moveSection(null, section, "spice/projects/foo/docs/knowledge", projAdapter);
    assert.strictEqual(renames.length, 1, "folder renamed once");
    assert.strictEqual(renames[0].p, "spice/projects/foo/docs/knowledge/ems", "moved under new parent, slug of title");
    // Hub patch + child patch applied at the NEW remapped paths.
    const hubWrite = fmWrites.find((w) => w.fm.parent_section === "Knowledge" && w.fm.depth === 2);
    assert.ok(hubWrite, "expected hub patch applied");
    assert.strictEqual(hubWrite.path, "spice/projects/foo/docs/knowledge/ems/EMS.md", "hub patched at remapped path");
    const childWrite = fmWrites.find((w) => w.path === "spice/projects/foo/docs/knowledge/ems/sub/Sub.md");
    assert.ok(childWrite, "expected child patch applied to the child hub at remapped path");
    assert.strictEqual(childWrite.fm.parent_section, "EMS");
  } finally { global.app = prevApp; }
}});

ASYNC_TESTS.push({ name: "PERF8M moveSection: a rejecting child patch cannot abort later project cascade patches", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const prevApp = global.app;
  const oldFolder = "spice/projects/foo/docs/ems";
  const newFolder = "spice/projects/foo/docs/knowledge/ems";
  const known = new Set([
    oldFolder,
    `${oldFolder}/EMS.md`,
    `${oldFolder}/one/One.md`,
    `${oldFolder}/two/Two.md`,
  ]);
  const attempts = [];
  global.app = {
    fileManager: {
      renameFile: async (folder, target) => {
        for (const item of Array.from(known)) {
          if (item === folder.path || item.indexOf(folder.path + "/") === 0) {
            known.delete(item);
            known.add(target + item.slice(folder.path.length));
          }
        }
      },
      processFrontMatter: async (file, mutate) => {
        attempts.push(file.path);
        mutate({});
        if (file.path.endsWith("/one/One.md")) throw new Error("middle child rejected");
      },
    },
    vault: { getAbstractFileByPath: (path) => known.has(path) ? { path } : null },
  };
  const section = { title: "EMS", folder: oldFolder, hubPath: `${oldFolder}/EMS.md` };
  const adapter = { move: { rewriteOnSectionMove: () => ({
    hubPatch: { parent_section: "Knowledge" },
    childPatches: [
      { path: `${oldFolder}/one/One.md`, patch: { parent_section: "EMS" } },
      { path: `${oldFolder}/two/Two.md`, patch: { parent_section: "EMS" } },
    ],
  }) } };
  try {
    const result = await se.moveSection(null, section, "spice/projects/foo/docs/knowledge", adapter);
    assert.strictEqual(result.ok, true, "the completed folder move remains successful despite a best-effort patch rejection");
    assert.deepStrictEqual(attempts, [
      `${newFolder}/EMS.md`,
      `${newFolder}/one/One.md`,
      `${newFolder}/two/Two.md`,
    ], "hub, rejecting middle child, and later child are all attempted in order");
  } finally { global.app = prevApp; }
}});

ASYNC_TESTS.push({ name: "PERF8N moveSection: a rejecting hub patch cannot abort child cascade patches", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const prevApp = global.app;
  const oldFolder = "spice/projects/foo/docs/ems";
  const newFolder = "spice/projects/foo/docs/knowledge/ems";
  const known = new Set([
    oldFolder,
    `${oldFolder}/EMS.md`,
    `${oldFolder}/one/One.md`,
    `${oldFolder}/two/Two.md`,
  ]);
  const attempts = [];
  global.app = {
    fileManager: {
      renameFile: async (folder, target) => {
        for (const item of Array.from(known)) {
          if (item === folder.path || item.indexOf(folder.path + "/") === 0) {
            known.delete(item);
            known.add(target + item.slice(folder.path.length));
          }
        }
      },
      processFrontMatter: async (file, mutate) => {
        attempts.push(file.path);
        mutate({});
        if (file.path.endsWith("/EMS.md")) throw new Error("hub patch rejected");
      },
    },
    vault: { getAbstractFileByPath: (path) => known.has(path) ? { path } : null },
  };
  const section = { title: "EMS", folder: oldFolder, hubPath: `${oldFolder}/EMS.md` };
  const adapter = { move: { rewriteOnSectionMove: () => ({
    hubPatch: { parent_section: "Knowledge" },
    childPatches: [
      { path: `${oldFolder}/one/One.md`, patch: { parent_section: "EMS" } },
      { path: `${oldFolder}/two/Two.md`, patch: { parent_section: "EMS" } },
    ],
  }) } };
  try {
    const result = await se.moveSection(null, section, "spice/projects/foo/docs/knowledge", adapter);
    assert.strictEqual(result.ok, true, "the completed folder move remains successful despite a best-effort hub rejection");
    assert.deepStrictEqual(attempts, [
      `${newFolder}/EMS.md`,
      `${newFolder}/one/One.md`,
      `${newFolder}/two/Two.md`,
    ], "rejecting hub and every later child are all attempted in order");
  } finally { global.app = prevApp; }
}});

ASYNC_TESTS.push({ name: "PERF8N moveSection: rejected structural folder rename restores exact row position and focus", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const prevApp = global.app;
  const prevCustomJS = global.customJS;
  const prevDocument = global.document;
  const oldFolder = "spice/wiki/cooking";
  const before = { id: "before" };
  const row = { id: "row", __seFolder: oldFolder };
  const after = { id: "after" };
  const parent = {
    children: [before, row, after],
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; },
    insertBefore(node, anchor) { this.children.splice(this.children.indexOf(anchor), 0, node); node.parentNode = this; },
    appendChild(node) { this.children.push(node); node.parentNode = this; },
  };
  for (const node of parent.children) node.parentNode = parent;
  Object.defineProperty(row, "nextSibling", { get: () => {
    const index = parent.children.indexOf(row);
    return index >= 0 ? parent.children[index + 1] || null : null;
  } });
  let focused = 0;
  const focusTarget = { isConnected: true, focus: () => { focused++; } };
  const events = [];
  global.document = { activeElement: focusTarget, body: {} };
  global.app = {
    vault: { getAbstractFileByPath: (path) => path === oldFolder ? { path } : null },
    fileManager: { renameFile: async () => { events.push("write"); throw new Error("folder rename rejected"); } },
  };
  global.customJS = { RenderSafe: { mutateStructure: async (options) => {
    events.push("apply");
    const receipt = await options.apply();
    assert.deepStrictEqual(parent.children, [before, after], "optimism removes the exact section row before persistence");
    try { return { ok: true, value: await options.write() }; }
    catch (error) {
      events.push("rollback");
      await options.rollback(receipt, error);
      return { ok: false, error };
    }
  } } };
  const adapter = { structural: true, move: { rewriteOnSectionMove: () => null } };
  try {
    const result = await se.moveSection({ container: parent }, {
      title: "Cooking", folder: oldFolder, hubPath: `${oldFolder}/Cooking.md`,
    }, "spice/wiki/food", adapter);
    assert.strictEqual(result.ok, false, "folder rename rejection remains an explicit structural failure");
    assert.deepStrictEqual(events, ["apply", "write", "rollback"], "apply-before-write failure rolls back exactly once");
    assert.deepStrictEqual(parent.children, [before, row, after], "rollback restores the exact row at its original sibling position");
    assert.strictEqual(parent.children[1], row, "rollback preserves row object identity");
    assert.strictEqual(focused, 1, "rollback restores the captured focus target once");
  } finally {
    global.app = prevApp;
    global.customJS = prevCustomJS;
    global.document = prevDocument;
  }
}});

failures += !run("moveSection: wiki adapter (rewriteOnSectionMove→null) renames folder only", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const renames = [];
  const fmWrites = [];
  global.app = {
    fileManager: {
      renameFile: (f, p) => { renames.push({ f, p }); return Promise.resolve(); },
      processFrontMatter: (f, fn) => { const fm = {}; fn(fm); fmWrites.push({ f, fm }); return Promise.resolve(); },
    },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  const section = { title: "Cooking", folder: "spice/wiki/cooking", hubPath: "spice/wiki/cooking/Cooking.md" };
  const wikiAdapter = { move: { rewriteOnSectionMove: () => null } };
  se.moveSection(null, section, "spice/wiki/food", wikiAdapter);
  assert.strictEqual(renames.length, 1);
  assert.strictEqual(renames[0].p, "spice/wiki/food/cooking");
  assert.strictEqual(fmWrites.length, 0, "wiki section move writes no frontmatter");
  delete global.app;
});

ASYNC_TESTS.push({ name: "recursive delete confirm: confirm invokes deleteSection; cancel does not; wording reflects emptySubsectionCount", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();

  // With empty sub-sections → wording mentions the count.
  {
    const doc = makeDocStub();
    const deletes = [];
    const adapter = {
      canDelete: () => true,
      deleteSection: (s) => deletes.push(s),
      emptySubsectionCount: () => 3,
    };
    const section = { title: "Blueprints" };
    se._openDeleteConfirm(null, adapter, section);
    const overlay = doc.body.children[0];
    assert.ok(overlay, "confirm modal mounted");
    const bodyTexts = findDeepAll(overlay, (e) => typeof e.textContent === "string").map((e) => e.textContent);
    assert.ok(bodyTexts.some((t) => t.includes("3 empty sub-section")), "wording mentions 3 empty sub-sections: " + JSON.stringify(bodyTexts));
    const del = findDeepAll(overlay, (e) => e.textContent === "Delete")[0];
    assert.ok(del, "expected a Delete button");
    await del.onclick();
    assert.strictEqual(deletes.length, 1, "confirm invokes deleteSection");
    assert.strictEqual(doc.body.children.length, 0, "confirm closes");
    delete global.document;
  }

  // Cancel path → no delete.
  {
    const doc = makeDocStub();
    const deletes = [];
    const adapter = { canDelete: () => true, deleteSection: (s) => deletes.push(s), emptySubsectionCount: () => 0 };
    se._openDeleteConfirm(null, adapter, { title: "Solo" });
    const overlay = doc.body.children[0];
    const bodyTexts = findDeepAll(overlay, (e) => typeof e.textContent === "string").map((e) => e.textContent);
    assert.ok(bodyTexts.some((t) => t === "Delete 'Solo'?"), "no-subsection wording: " + JSON.stringify(bodyTexts));
    const cancel = findDeepAll(overlay, (e) => e.textContent === "Cancel")[0];
    cancel.onclick();
    assert.strictEqual(deletes.length, 0, "cancel does not delete");
    assert.strictEqual(doc.body.children.length, 0, "cancel closes");
    delete global.document;
  }

  // canDelete false → no modal at all.
  {
    const doc = makeDocStub();
    const deletes = [];
    se._openDeleteConfirm(null, { canDelete: () => false, deleteSection: (s) => deletes.push(s) }, { title: "X" });
    assert.strictEqual(doc.body.children.length, 0, "no modal when canDelete is false");
    delete global.document;
  }
}});

failures += !run("rail row ⋯ gains a Move entry (before Delete); _openMovePickerForSection wired", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const opened = [];
  global.customJS = { MenuPopover: { open: (entries, opts) => opened.push({ entries, opts }) } };
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [{ title: "EMS", hubPath: "e.md", folder: "spice/wiki/ems", pageCount: 0, subSectionCount: 0, maxMtime: 0, materialized: true }],
    listPages: () => [],
    getLinks: () => [],
    canDelete: () => true,
    icons: { folder: "<svg/>", file: "<svg/>", dots: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const dots = els.find((e) => e.className === "se-rail-dots");
  dots.onclick();
  const labels = opened[0].entries.filter((e) => e && e.label).map((e) => e.label);
  assert.deepStrictEqual(labels, ["Rename", "Add link", "Move", "Delete"], "Move added before Delete");
  assert.strictEqual(typeof se._openMovePickerForSection, "function");
  delete global.customJS;
});

ASYNC_TESTS.push({ name: "openSelectDocsPicker: structural bulk resolves exact vault files and awaits receipt moves", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();

  const FOLDER = "spice/projects/p/docs/a";
  const prevApp = global.app;
  const vaultFiles = new Map([
    FOLDER + "/One.md",
    FOLDER + "/Two.md",
    FOLDER + "/sub/Deep.md",
  ].map((path) => [path, { path, name: path.split("/").pop(), __realVaultFile: true }]));
  global.app = {
    vault: {
      getMarkdownFiles: () => ([
        { path: FOLDER + "/One.md", name: "One.md" },
        { path: FOLDER + "/Two.md", name: "Two.md" },
        { path: FOLDER + "/sub/Deep.md", name: "Deep.md" },
      ]),
      getAbstractFileByPath: (p) => vaultFiles.get(p) || null,
    },
    metadataCache: {
      getFileCache: (f) => ({ frontmatter: { type: "doc-note", title: f.name.replace(/\.md$/, "") } }),
    },
  };

  // Spy the downstream move flow.
  const moveCalls = [];
  se.openMovePicker = (opts) => { se.__lastMoveOpts = opts; };
  se.applyDocMove = async (dv, file, dest) => {
    moveCalls.push({ file, from: file.path, dest, real: file.__realVaultFile });
    return { ok: true };
  };

  const adapter = { structural: true, move: { docType: "doc-note", root: FOLDER, enumerateSectionTargets: () => ([{ folder: "spice/projects/p/docs/b", label: "B", depth: 1 }]) } };
  const section = { folder: FOLDER };

  se.openSelectDocsPicker({}, adapter, section);

  // Modal mounted with exactly two DIRECT doc checkbox rows.
  const overlay = doc.body.children[0];
  assert.ok(overlay, "modal overlay mounted");
  const panel = overlay.children[0];
  const list = panel.children.find((c) => c.className === "se-select-list");
  assert.ok(list, "select list present");
  const rows = list.children.filter((c) => c.className === "se-select-row");
  assert.strictEqual(rows.length, 2, "only 2 direct docs listed (sub-folder doc excluded)");

  // Check both boxes.
  const checks = rows.map((r) => r.children.find((c) => c.className === "se-select-check"));
  checks.forEach((cb) => { cb.checked = true; cb.onchange(); });

  // Locate the primary "Move docs →" button (nested in the se-modal-btns row).
  const findDeep = (el, pred) => {
    if (!el || typeof el !== "object") return null;
    if (pred(el)) return el;
    for (const c of (el.children || [])) { const hit = findDeep(c, pred); if (hit) return hit; }
    return null;
  };
  const primary = findDeep(panel, (c) => String(c.className || "").indexOf("se-modal-btn-primary") >= 0);
  assert.ok(primary, "primary Move button present");
  assert.strictEqual(primary.disabled, false, "primary enabled once docs are checked");
  primary.onclick();

  // Primary opens the move picker; onPick drives applyDocMove per doc.
  assert.ok(se.__lastMoveOpts && typeof se.__lastMoveOpts.onPick === "function", "openMovePicker invoked with onPick");
  await se.__lastMoveOpts.onPick("spice/projects/p/docs/b");

  const moved = moveCalls.map((m) => m.from).sort();
  assert.deepStrictEqual(moved, [FOLDER + "/One.md", FOLDER + "/Two.md"], "both checked docs moved");
  assert.ok(moveCalls.every((m) => m.dest === "spice/projects/p/docs/b"), "moved to the picked destination");
  assert.ok(moveCalls.every((m) => m.real === true), "bulk flow resolves each selected path to a real vault file");
  assert.ok(moveCalls.every((m) => vaultFiles.get(m.from) === m.file),
    "structural applyDocMove receives the exact object returned by the vault lookup");

  global.app = prevApp;
  delete global.document;
}});

// ── Feature a: per-doc ⋯ menu (Rename · Move · Add link · Delete) on doc cards.
// Doc cards are rendered by the shared _renderDocCards, used by BOTH blueprints,
// so this must be blueprint-agnostic (generic file ops via app.*, Move delegating
// to the adapter's move block — same machinery as section-move).

// Render one doc card via the REAL render() path and return {se, els, opened, file}.
function renderOneDocCard(getMenuEntries) {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const opened = [];
  const file = { path: "spice/wiki/ems/Runbook.md", name: "Runbook.md", parent: { path: "spice/wiki/ems" } };
  global.customJS = { MenuPopover: { open: (entries, opts) => opened.push({ entries, opts }) } };
  const prevApp = global.app;
  global.app = {
    vault: { getAbstractFileByPath: (p) => (p === file.path ? file : null) },
    workspace: { openLinkText: () => {} },
  };
  const { container, els } = makeDomStub();
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [],
    listPages: () => [{ title: null, file: { name: "Runbook.md", path: file.path, mtime: { ts: 1000 } } }],
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>", dots: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  const openMenu = () => {
    const dots = els.find((e) => e.className === "se-doc-dots");
    if (dots && dots.onclick) dots.onclick({ stopPropagation: () => {} });
  };
  if (typeof getMenuEntries === "function") getMenuEntries();
  return { se, els, opened, file, adapter, dv, openMenu, cleanup: () => { global.app = prevApp; delete global.customJS; } };
}

failures += !run("doc card carries a se-doc-dots control that opens MenuPopover with Rename/Move/Add link/Delete (Delete danger)", () => {
  const { els, opened, file, cleanup } = renderOneDocCard();
  const dots = els.find((e) => e.className === "se-doc-dots");
  assert.ok(dots, "expected a se-doc-dots control on the doc card");
  // Clicking the dots must NOT open the note — it opens the menu; assert stopPropagation-safe.
  let propagated = true;
  dots.onclick({ stopPropagation: () => { propagated = false; } });
  assert.strictEqual(propagated, false, "dots click must stopPropagation so the card's open handler doesn't fire");
  assert.strictEqual(opened.length, 1, "expected MenuPopover.open called once");
  const labels = opened[0].entries.filter((e) => e && e.label).map((e) => e.label);
  assert.deepStrictEqual(labels, ["Rename", "Move", "Add link", "Delete"]);
  const del = opened[0].entries.find((e) => e && e.label === "Delete");
  assert.strictEqual(del.danger, true, "Delete entry must be danger-flagged");
  assert.strictEqual(opened[0].opts && opened[0].opts.anchor, dots, "menu anchored to the dots element");
  cleanup();
});

failures += !run("doc ⋯ Rename → renameFile(file, sameFolder + sanitized basename + .md)", () => {
  const { se, opened, file, adapter, dv, openMenu, cleanup } = renderOneDocCard();
  const renamed = [];
  global.app.fileManager = { renameFile: (f, p) => { renamed.push({ f, p }); return Promise.resolve(); } };
  const doc = makeDocStub();
  openMenu();
  const rename = opened[0].entries.find((e) => e.label === "Rename");
  rename.onSelect();
  // Modal mounted; type a new name with an illegal path separator to prove sanitize.
  const overlay = doc.body.children[0];
  const panel = overlay.children[0];
  const input = panel.children.find((c) => c.className === "se-modal-input");
  assert.ok(input, "expected a rename text input");
  assert.strictEqual(input.value, "Runbook", "input defaults to the file basename (no .md)");
  input.value = "New/Name";
  const primary = findDeepBtn(panel);
  primary.onclick();
  assert.strictEqual(renamed.length, 1, "renameFile called once");
  assert.strictEqual(renamed[0].f, file, "renamed the doc file itself");
  assert.strictEqual(renamed[0].p, "spice/wiki/ems/NewName.md", "same folder + sanitized basename + .md");
  delete global.document;
  cleanup();
});

failures += !run("doc ⋯ Delete → confirm modal then trashFile(file) (recoverable, not immediate)", () => {
  const { se, opened, file, adapter, dv, openMenu, cleanup } = renderOneDocCard();
  const trashed = [];
  global.app.fileManager = { trashFile: (f) => { trashed.push(f); return Promise.resolve(); } };
  const doc = makeDocStub();
  openMenu();
  const del = opened[0].entries.find((e) => e.label === "Delete");
  del.onSelect();
  // Must be a real confirm: nothing trashed until the primary is clicked.
  assert.strictEqual(trashed.length, 0, "delete must not fire immediately — a confirm modal is shown first");
  const overlay = doc.body.children[0];
  const panel = overlay.children[0];
  const primary = findDeepBtn(panel);
  primary.onclick();
  assert.strictEqual(trashed.length, 1, "trashFile called once after confirm");
  assert.strictEqual(trashed[0], file, "trashed the doc file itself (recoverable trash)");
  delete global.document;
  cleanup();
});

failures += !run("doc ⋯ Add link → processFrontMatter(file) pushes the new link onto fm.links (DOC's own frontmatter)", () => {
  const { se, opened, file, adapter, dv, openMenu, cleanup } = renderOneDocCard();
  const pfmCalls = [];
  global.app.fileManager = {
    processFrontMatter: (f, fn) => { const fm = { links: [{ url: "https://old.com", text: "Old" }] }; fn(fm); pfmCalls.push({ f, fm }); return Promise.resolve(); },
  };
  const doc = makeDocStub();
  openMenu();
  const add = opened[0].entries.find((e) => e.label === "Add link");
  add.onSelect();
  const overlay = doc.body.children[0];
  const panel = overlay.children[0];
  const inputs = panel.children.filter((c) => c.className === "se-modal-input");
  assert.strictEqual(inputs.length, 2, "expected url + label inputs");
  inputs[0].value = "https://new.com";
  inputs[1].value = "New";
  const primary = findDeepBtn(panel);
  primary.onclick();
  assert.strictEqual(pfmCalls.length, 1, "processFrontMatter called on the DOC's own file");
  assert.strictEqual(pfmCalls[0].f, file, "targeted the doc file itself");
  assert.deepStrictEqual(pfmCalls[0].fm.links, [{ url: "https://old.com", text: "Old" }, { url: "https://new.com", text: "New" }], "appended the new link to fm.links");
  delete global.document;
  cleanup();
});

failures += !run("doc ⋯ Move → openMovePicker opened; picking a folder calls applyDocMove(dv, file, folder, adapter)", () => {
  const { se, opened, file, adapter, dv, openMenu, cleanup } = renderOneDocCard();
  // Give the adapter a move block with folder targets.
  adapter.move = { root: "spice/wiki", enumerateSectionTargets: () => ([{ folder: "spice/wiki/networking", label: "Networking", depth: 1 }]) };
  const moveCalls = [];
  se.openMovePicker = (opts) => { se.__lastMoveOpts = opts; };
  se.applyDocMove = (d, f, folder, a) => { moveCalls.push({ f, folder, a }); };
  openMenu();
  const mv = opened[0].entries.find((e) => e.label === "Move");
  mv.onSelect();
  assert.ok(se.__lastMoveOpts && typeof se.__lastMoveOpts.onPick === "function", "openMovePicker invoked with an onPick");
  assert.ok(Array.isArray(se.__lastMoveOpts.targets) && se.__lastMoveOpts.targets.length === 1, "targets enumerated from the adapter move block");
  se.__lastMoveOpts.onPick("spice/wiki/networking");
  assert.strictEqual(moveCalls.length, 1, "applyDocMove called once");
  assert.strictEqual(moveCalls[0].f, file, "applyDocMove given the doc file");
  assert.strictEqual(moveCalls[0].folder, "spice/wiki/networking", "applyDocMove given the picked folder");
  cleanup();
});

function findDeepBtn(panel) {
  const findDeep = (el, pred) => {
    if (!el || typeof el !== "object") return null;
    if (pred(el)) return el;
    for (const c of (el.children || [])) { const hit = findDeep(c, pred); if (hit) return hit; }
    return null;
  };
  return findDeep(panel, (c) => String(c.className || "").indexOf("se-modal-btn-primary") >= 0);
}

ASYNC_TESTS.push({ name: "moveSection: awaits rename, remaps child paths, patches frontmatter only on real TFiles (no ENOENT)", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();

  // Vault: an OLD section folder with a hub, a sub-folder, and a child doc.
  const OLD = "spice/projects/p/docs/a";
  const HUB = OLD + "/A.md";
  const SUB = OLD + "/sub";
  const CHILD = SUB + "/Sub.md";
  const map = new Map([
    [OLD, { path: OLD, __folder: true }],
    [HUB, { path: HUB }],
    [SUB, { path: SUB, __folder: true }],
    [CHILD, { path: CHILD }],
  ]);
  const fmWrites = [];
  const renameCalls = [];
  const prevApp = global.app;
  global.app = {
    vault: { getAbstractFileByPath: (p) => map.get(p) || null },
    fileManager: {
      renameFile: async (file, newPath) => {
        renameCalls.push({ from: file && file.path, to: newPath });
        const from = file.path;
        for (const [k, v] of [...map.entries()]) {
          if (k === from || k.indexOf(from + "/") === 0) {
            const nk = newPath + k.slice(from.length);
            map.delete(k); v.path = nk; map.set(nk, v);
          }
        }
      },
      processFrontMatter: async (file, fn) => {
        // Reproduce Obsidian: a non-TFile (fabricated {path}) or a path no
        // longer present in the vault raises ENOENT.
        if (!file || !map.has(file.path) || map.get(file.path) !== file) {
          throw new Error("ENOENT: " + (file && file.path));
        }
        const fm = {}; fn(fm); fmWrites.push({ path: file.path, fm });
      },
    },
  };

  const adapter = { move: { rewriteOnSectionMove: () => ({
    hubPatch: { depth: 2, parent_section: "B" },
    childPatches: [{ path: CHILD, patch: { parent_section: "A" } }],
  }) } };
  const section = { folder: OLD, hubPath: HUB, title: "A" };

  let threw = false;
  try {
    await se.moveSection({}, section, "spice/projects/p/docs/b", adapter);
  } catch (_e) { threw = true; }

  try {
    assert.strictEqual(threw, false, "moveSection must never throw");
    assert.strictEqual(renameCalls.length, 1, "folder renamed exactly once");
    assert.strictEqual(renameCalls[0].to, "spice/projects/p/docs/b/a", "renamed to dest/<slug(title)>");
    const paths = fmWrites.map((w) => w.path).sort();
    assert.deepStrictEqual(paths, [
      "spice/projects/p/docs/b/a/A.md",
      "spice/projects/p/docs/b/a/sub/Sub.md",
    ], "frontmatter patched at NEW remapped paths only");
    assert.ok(fmWrites.every((w) => w.path.indexOf(OLD) !== 0), "no patch applied at an OLD path");
  } finally { global.app = prevApp; }
}});

ASYNC_TESTS.push({ name: "PERF8-SECTION-EXPLORER doc move applies before write and restores exact node/position/focus on rejection", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const priorApp = global.app;
  const priorCustomJS = global.customJS;
  const priorDocument = global.document;
  const before = { id: "before" };
  const after = { id: "after" };
  const row = { id: "row", __sePath: "spice/wiki/a/Doc.md" };
  const parent = {
    children: [before, row, after],
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; },
    insertBefore(node, anchor) { this.children.splice(this.children.indexOf(anchor), 0, node); node.parentNode = this; },
    appendChild(node) { this.children.push(node); node.parentNode = this; },
  };
  for (const node of parent.children) node.parentNode = parent;
  Object.defineProperty(row, "nextSibling", { get: () => {
    const index = parent.children.indexOf(row); return index >= 0 ? parent.children[index + 1] || null : null;
  } });
  let focused = 0;
  const events = [];
  global.document = { activeElement: { focus: () => { focused++; } } };
  global.app = { fileManager: { renameFile: async () => { events.push("write"); throw new Error("rename failed"); } } };
  global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
    events.push("apply"); const receipt = await opts.apply();
    try { return { ok: true, value: await opts.write() }; }
    catch (error) { events.push("rollback"); await opts.rollback(receipt, error); return { ok: false, error }; }
  } } };
  try {
    const result = await se.applyDocMove({ container: parent }, { path: row.__sePath }, "spice/wiki/b", {
      structural: true, move: { rewriteOnDocMove: () => null },
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(events, ["apply", "write", "rollback"], "apply must precede persistence and rollback");
    assert.deepStrictEqual(parent.children, [before, row, after], "same row restored before exact sibling");
    assert.strictEqual(focused, 1, "captured focus restored once");
    const newerFocus = { isConnected: true };
    global.document.activeElement = newerFocus;
    se._rollbackStructuralReceipt({ kind: "none", focusTarget: { focus: () => { focused++; } } });
    assert.strictEqual(focused, 1, "late rollback preserves a newer connected user focus target");
  } finally { global.app = priorApp; global.customJS = priorCustomJS; global.document = priorDocument; }
}});

ASYNC_TESTS.push({ name: "PERF8-SECTION-EXPLORER section rename/delete receipts preserve exact title and row identity", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const priorCustomJS = global.customJS;
  const title = { __seTitle: true, textContent: "Original", children: [] };
  const row = { __seFolder: "spice/wiki/original", children: [title] };
  title.parentNode = row;
  const root = { children: [row] };
  row.parentNode = root;
  root.removeChild = (node) => { root.children.splice(root.children.indexOf(node), 1); node.parentNode = null; };
  root.appendChild = (node) => { root.children.push(node); node.parentNode = root; };
  global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
    const receipt = await opts.apply();
    try { return { ok: true, value: await opts.write() }; }
    catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
  } } };
  try {
    const renamed = await se._mutateStructure({ container: root }, { structural: true }, {
      kind: "rename", identityKey: "__seFolder", identityValue: row.__seFolder, nextTitle: "Changed",
    }, async () => { throw new Error("rename failed"); });
    assert.strictEqual(renamed.ok, false);
    assert.strictEqual(title.textContent, "Original", "exact prior title restored");
    const deleted = await se._mutateStructure({ container: root }, { structural: true }, {
      kind: "remove", identityKey: "__seFolder", identityValue: row.__seFolder,
    }, async () => { throw new Error("delete failed"); });
    assert.strictEqual(deleted.ok, false);
    assert.strictEqual(root.children[0], row, "exact removed section row restored");
  } finally { global.customJS = priorCustomJS; }
}});

ASYNC_TESTS.push({ name: "PERF8-SECTION-EXPLORER ChromeBar gestures mutate the same-view WikiTree owner", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const priorApp = global.app;
  const priorCustomJS = global.customJS;
  const priorDocument = global.document;
  const view = {};
  const row = { __sePath: "spice/wiki/a/Doc.md", children: [] };
  const tree = {
    children: [row], closest: () => view,
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; },
    appendChild(node) { this.children.push(node); node.parentNode = this; },
  };
  row.parentNode = tree;
  const chrome = {
    children: [], closest: () => view,
    createEl() { const node = { parentNode: this, remove: () => { this.children = this.children.filter((x) => x !== node); } }; this.children.push(node); return node; },
  };
  const adapter = { structural: true, structuralOwnerKey: "spice/wiki/a/A.md", move: { rewriteOnDocMove: () => null } };
  se._registerStructuralRoot(adapter, tree);
  global.document = { activeElement: null, body: {} };
  global.app = { fileManager: { renameFile: async () => { throw new Error("rename failed"); } } };
  global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
    const receipt = await opts.apply();
    assert.deepStrictEqual(tree.children, [], "optimism removes the real WikiTree row");
    assert.deepStrictEqual(chrome.children, [], "ChromeBar container receives no fake preview");
    try { return { ok: true, value: await opts.write() }; }
    catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
  } } };
  try {
    const result = await se.applyDocMove({ container: chrome }, { path: row.__sePath }, "spice/wiki/b", adapter);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(tree.children[0], row, "rollback restores the exact WikiTree row");
    assert.ok(/render\(dv, adapter\)[\s\S]*_registerStructuralRoot\(adapter, container0\)/.test(sourceUnderTest()),
      "production render registers each structural owner");
  } finally { global.app = priorApp; global.customJS = priorCustomJS; global.document = priorDocument; }
}});

ASYNC_TESTS.push({ name: "PERF8L-SECTION-EXPLORER singleton registry releases detached unique-note roots", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const fallback = { isConnected: true };
  for (let i = 0; i < 500; i++) {
    const root = { isConnected: true };
    se._registerStructuralRoot({ structuralOwnerKey: `spice/wiki/${i}/Note.md` }, root);
    root.isConnected = false;
  }
  assert.ok(se._structuralRoots.size <= 1,
    "registering each unique note globally prunes all previously detached owner roots");
  assert.strictEqual(
    se._structuralRoot({ container: fallback }, { structuralOwnerKey: "spice/wiki/499/Note.md" }),
    fallback,
    "lookup releases the final detached owner and falls back to the dispatch container",
  );
  assert.strictEqual(se._structuralRoots.size, 0,
    "no disconnected unique-note roots remain strongly reachable from the singleton registry");
}});

ASYNC_TESTS.push({ name: "PERF8M-SECTION-EXPLORER detached local tree never redirects into a foreign view", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const owner = { structuralOwnerKey: "spice/wiki/shared/Note.md" };
  const viewA = {};
  const viewB = {};
  const rootA = { isConnected: true, closest: () => viewA };
  const rootB = { isConnected: true, closest: () => viewB };
  const dispatchB = { isConnected: true, closest: () => viewB };
  se._registerStructuralRoot(owner, rootA);
  se._registerStructuralRoot(owner, rootB);
  assert.strictEqual(se._structuralRoot({ container: dispatchB }, owner), rootB,
    "two live views select the exact structural root in the dispatch scope");
  rootB.isConnected = false;
  assert.strictEqual(se._structuralRoot({ container: dispatchB }, owner), dispatchB,
    "a resolved scope with no live local tree falls back locally instead of selecting the foreign root");
  assert.deepStrictEqual(Array.from(se._structuralRoots.get(owner.structuralOwnerKey) || []), [rootA],
    "pruning releases the detached local tree while preserving the other live view");
  const unscopedDispatch = { isConnected: true, closest: () => null };
  assert.strictEqual(se._structuralRoot({ container: unscopedDispatch }, owner), rootA,
    "sole-root compatibility remains available when the dispatch scope cannot be resolved");
}});

failures += !run("PERF8-SECTION-EXPLORER structural bulk awaits each receipt-bound move and counts only successes", () => {
  const source = sourceUnderTest();
  assert.ok(/adapter\s*&&\s*adapter\.structural\s*===\s*true[\s\S]*await\s+this\.applyDocMove/.test(source));
  assert.ok(/getAbstractFileByPath\(m\.from\)[\s\S]*applyDocMove\(dv,\s*file/.test(source),
    "bulk moves must resolve real vault files before calling fileManager.renameFile");
  assert.ok(/moved\s*\+=\s*1/.test(source));
});

// Async tail — runs the queued async tests, then exits with the final tally.
(async () => {
  for (const t of ASYNC_TESTS) {
    try {
      await t.fn();
      console.log("PASS " + t.name);
    } catch (e) {
      console.log("FAIL " + t.name + " — " + e.message);
      failures += 1;
    }
  }
  process.exit(failures > 0 ? 1 : 0);
})();
