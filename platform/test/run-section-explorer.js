"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SRC = fs.readFileSync(
  path.join(__dirname, "../mechanisms/section-explorer/section-explorer.js"),
  "utf8"
);

function loadClass() {
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  const factory = new Function("module", "exports", SRC + "\nmodule.exports = SectionExplorer;");
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
      querySelectorAll() { return []; },
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
  assert.deepStrictEqual(labels, ["Rename", "Add link", "Delete"]);
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
  global.customJS = { DocSearch: { matches: () => true }, SectionLabel: { render: () => {}, divider: () => {} } };
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
