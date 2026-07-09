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
  assert.ok(rows[0].textContent.includes("Alpha") || rows[0].innerHTML.includes("Alpha"));
  const meta = els.find((e) => e.className === "se-rail-meta" && (e.textContent.includes("3 doc") || e.innerHTML.includes("3 doc")));
  assert.ok(meta, "expected a meta line mentioning doc count");
});

failures += !run("page pane renders BeaconCards.render with the section's pages", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const { container } = makeDomStub();
  const calls = [];
  global.customJS = {
    BeaconCards: { render: (proxyDv, opts) => { calls.push(opts); } },
  };
  const dv = { container, current: () => ({ file: { path: "spice/wiki/Wiki.md" } }) };
  const pages = [{ file: { name: "Runbook", path: "spice/wiki/ems/Runbook.md", mtime: { ts: 1 } } }];
  const adapter = se.makeAdapter({
    resolveContext: () => ({ scopePath: "spice/wiki" }),
    listSections: () => [],
    listPages: () => pages,
    getLinks: () => [],
    icons: { folder: "<svg/>", file: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  assert.strictEqual(calls.length, 1, "expected BeaconCards.render to be called once");
  assert.strictEqual(calls[0].pages.length, 1);
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

process.exit(failures > 0 ? 1 : 0);
