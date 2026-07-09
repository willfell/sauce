# Section Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `section-explorer` mechanism that renders wiki hub/section and project docs-hub/section-hub notes as a two-pane (rail-of-sections + page-pane) explorer with inline section rename/delete/add-link, replacing the four surfaces' current flat card lists — with a migration heal + seed-vault regression coverage for every existing note.

**Architecture:** `SectionExplorer.render(dv, adapter)` (CustomJS, singleton-instance) is the shared entry point; `SectionExplorer.makeAdapter(config)` builds a per-blueprint adapter (mirrors `ChromeBar.makeAdapter`). Wiki (`WikiTree`) and Project (`ProjectDocsIndex` + `SectionHub`) become thin adapters. `BeaconCards` (page grid), `MenuPopover` (rail-row ⋯ menu), `SectionLabel`, `DocSearch`, `ChromeBar` are reused untouched. Two new install-time heals rewrite the body marker + backfill `links: []` frontmatter on every existing hub/section note; seed-vault fixtures prove both are idempotent.

**Tech Stack:** CustomJS (vanilla ES class, Obsidian DOM APIs), Dataview (`dv.pages`/`dv.current`), Node test harnesses under `platform/test/run-*.js` (no test framework — plain assert-based scripts run via `node`), JSON platform manifests.

---

## File Structure

| File | Responsibility |
|---|---|
| `platform/mechanisms/section-explorer/section-explorer.js` | NEW. The `SectionExplorer` class: `makeAdapter`, `render`, rail, page-pane, links row, rename/delete/add-link dialogs. |
| `platform/mechanisms/section-explorer/section-explorer.css` | NEW. Entrance-animation keyframes + tokens (mirrors `sauce-home.css`'s `--sh-ease`/`--sh-spring` vocabulary, renamed `--se-*`). |
| `platform/mechanisms/section-explorer/manifest.json` | NEW. Mechanism manifest: `customjs_classes: ["SectionExplorer"]`, depends on `menu-popover`, `cards` (BeaconCards' mechanism), `section-label`, `doc-search`. CSS shipped via `files[]` with `approval:"required"` to `.obsidian/snippets/`. |
| `platform/blueprints/wiki/helpers/wiki-tree.js` | MODIFY. Replaced by a thin adapter: builds `config` (folder walk, icons, rename/delete/link ops for `wiki-hub`/`wiki-section`) and calls `SectionExplorer.render`. All current inline section/page-card logic is deleted (moved into the mechanism). |
| `platform/blueprints/project/helpers/project-docs-index.js` | MODIFY. `render()` becomes a thin adapter call; `renderActionRow()` (New Doc/New Section/Move docs) is UNCHANGED (out of scope — chrome-bar's overflow, not this mechanism). |
| `platform/blueprints/project/helpers/section-hub.js` | MODIFY. Same treatment as `project-docs-index.js`; `_renderActionRow` unchanged. |
| `platform/install.js` | MODIFY. Add `_healWikiSectionExplorerBody` + `_healProjectSectionExplorerBody` (body-marker swap) and `_healSectionLinksFrontmatter` (adds `links: []` where missing), wired into the existing per-note heal dispatch next to `_healWikiChromeBody` (line ~6510). |
| `platform/manifest.json` | MODIFY. Add the `section-explorer` mechanism entry; bump `wiki` blueprint's manifest `depends_on` to include it (mirrors how `wiki` already depends on `chrome-bar`). |
| `platform/schemas-index.json` | MODIFY. New `contract` entry `section-explorer-links-frontmatter`. |
| `platform/test/run-section-explorer.js` | NEW. Behavioral harness (loads the class into a sandbox, stubs Dataview/DOM/`app`, exercises `render`/rail-row wiring/rename/delete-guard/add-link) — same shape as `platform/test/run-wiki-chrome-bar.js`. |
| `platform/test/seed-vault/spice/wiki/...`, `platform/test/seed-vault/spice/projects/docshub-legacy/...` | MODIFY. Add pre-migration fixtures (old `[WikiTree]`/`[ProjectDocsIndex]`/`[SectionHub]` marker, no `links` field) so `run-seed-migrations.js` proves both heals. |
| `platform/test/run-seed-migrations.js` | MODIFY. New assertions: post-install fixture body has the new marker + `links: []`, second install run is a no-op diff. |

Build order (per the design doc): **Tasks 1–7 build + prove the mechanism against wiki only.** **Tasks 8–11 port the project adapter.** **Task 12 registers the schema.** **Task 13 runs full preflight.** Deployment (Task 14, notes only) happens after merge + the automatic release pipeline ships — it is not executed as part of this plan.

---

### Task 1: `SectionExplorer` mechanism skeleton — adapter factory + rail (wiki-only proof)

**Files:**
- Create: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test — adapter factory + rail render**

```js
// platform/test/run-section-explorer.js
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

process.exit(failures > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `Cannot find module '../mechanisms/section-explorer/section-explorer.js'` (ENOENT) — the file doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// platform/mechanisms/section-explorer/section-explorer.js
/**
 * SectionExplorer (CustomJS) — shared two-pane section/page navigator.
 *
 * The blueprint-agnostic extraction of "render a hub/section's child sections
 * (rail) and pages (page pane)", replacing WikiTree's and
 * ProjectDocsIndex/SectionHub's independent card-list renderers. Any blueprint
 * gets the identical rail + page pane + rename/delete/add-link actions by
 * handing render(dv, adapter) an adapter built by makeAdapter(config) that
 * supplies the blueprint-specific parts (how to list child sections/pages,
 * icons, and how to rename/delete/add-link).
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan; the
 * plugin stores it as an INSTANCE, so every method is an INSTANCE method.
 * Every method is never-throw + cold-load-safe.
 */
class SectionExplorer {
  // ── makeAdapter — build a render(dv, adapter)-ready adapter from a per-
  // blueprint config. config = {
  //   resolveContext(dv) -> ctx|null,
  //   listSections(dv, ctx) -> [{ title, hubPath, folder, pageCount,
  //     subSectionCount, maxMtime, materialized }],
  //   listPages(dv, ctx, section|null) -> Dataview-page-like[],
  //   getLinks(section|ctx) -> [{url, text}],
  //   writeLinks(section|ctx, links) -> Promise<void>,
  //   canDelete(section) -> boolean,
  //   deleteSection(section) -> Promise<void>,
  //   renameSection(section, newTitle) -> Promise<void>,
  //   icons: { folder, file },
  //   rootClass,
  // }
  makeAdapter(config) {
    return {
      resolveContext: (dv) => config.resolveContext(dv),
      listSections: (dv, ctx) => config.listSections(dv, ctx) || [],
      listPages: (dv, ctx, section) => config.listPages(dv, ctx, section) || [],
      getLinks: (target) => config.getLinks(target) || [],
      writeLinks: (target, links) => config.writeLinks(target, links),
      canDelete: (section) => !!(config.canDelete && config.canDelete(section)),
      deleteSection: (section) => config.deleteSection(section),
      renameSection: (section, newTitle) => config.renameSection(section, newTitle),
      icons: config.icons || { folder: "", file: "" },
      rootClass: config.rootClass || "se-root",
    };
  }

  // ── render — entry point. Resolves context, lists sections, renders the
  // rail. (Page pane + mobile drawer + animation land in later tasks.)
  render(dv, adapter) {
    if (!adapter || typeof adapter.resolveContext !== "function") return;
    const container0 = (dv && dv.container) ? dv.container : dv;
    if (!container0 || typeof container0.createEl !== "function") return;
    const ctx = adapter.resolveContext(dv);
    if (!ctx) return;

    const root = container0.createEl("div", { cls: adapter.rootClass });
    const sections = adapter.listSections(dv, ctx);
    this._renderRail(dv, adapter, ctx, sections, root);
  }

  _renderRail(dv, adapter, ctx, sections, root) {
    if (!Array.isArray(sections) || sections.length === 0) return;
    const rail = root.createEl("div", { cls: "se-rail" });
    for (const section of sections) {
      const row = rail.createEl("div", { cls: "se-rail-row" });
      const iconHtml = adapter.icons.folder || "";
      row.innerHTML = iconHtml + `<span>${this._escape(section.title)}</span>`;
    }
  }

  _escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: both `PASS` lines printed, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): mechanism skeleton — adapter factory + rail render"
```

---

### Task 2: Rail row meta + Recent/A–Z sort toggle (ported from `WikiTree._renderSectionCards`)

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

Append to `run-section-explorer.js` (before `process.exit`):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `FAIL rail rows show meta ... — expected a meta line mentioning doc count` (no meta rendered yet).

- [ ] **Step 3: Write minimal implementation**

Replace `_renderRail` in `section-explorer.js`:

```js
  _renderRail(dv, adapter, ctx, sections, root) {
    if (!Array.isArray(sections) || sections.length === 0) return;
    const rail = root.createEl("div", { cls: "se-rail" });
    const sortRecent = (list) => [...list].sort((a, b) => (b.maxMtime || 0) - (a.maxMtime || 0));
    const sortAlpha = (list) => [...list].sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const cardsWrap = rail.createEl("div", { cls: "se-rail-cards" });

    const paint = (mode) => {
      cardsWrap.empty();
      const ordered = mode === "alpha" ? sortAlpha(sections) : sortRecent(sections);
      for (const section of ordered) this._renderRailRow(dv, adapter, ctx, section, cardsWrap);
    };

    if (sections.length >= 2) {
      const toggle = rail.createEl("div", { cls: "se-rail-toggle" });
      const modes = [{ key: "recent", label: "Recent" }, { key: "alpha", label: "A–Z" }];
      let current = "recent";
      for (const m of modes) {
        const pill = toggle.createEl("span", { cls: "se-rail-toggle-pill" });
        pill.textContent = m.label;
        pill.onclick = () => { current = m.key; paint(current); };
      }
    }
    paint("recent");
  }

  _railMeta(section) {
    const parts = [];
    if (section.subSectionCount) parts.push(section.subSectionCount + " section" + (section.subSectionCount === 1 ? "" : "s"));
    parts.push((section.pageCount || 0) + " doc" + (section.pageCount === 1 ? "" : "s"));
    return parts.join(" · ");
  }

  _renderRailRow(dv, adapter, ctx, section, host) {
    const row = host.createEl("div", { cls: "se-rail-row" });
    const iconHtml = adapter.icons.folder || "";
    const title = row.createEl("span");
    title.innerHTML = iconHtml + this._escape(section.title);
    const meta = row.createEl("span", { cls: "se-rail-meta" });
    meta.textContent = this._railMeta(section);
    row.onclick = () => {
      if (section.hubPath) app.workspace.openLinkText(section.hubPath, "");
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): rail row meta + Recent/A-Z sort toggle"
```

---

### Task 3: Page pane — `BeaconCards` grid for the currently-selected section

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `FAIL page pane renders BeaconCards.render ... — expected BeaconCards.render to be called once` (0 calls — no page pane yet).

- [ ] **Step 3: Write minimal implementation**

Add to `render()` (after the rail call) and a new `_renderPagePane`:

```js
  render(dv, adapter) {
    if (!adapter || typeof adapter.resolveContext !== "function") return;
    const container0 = (dv && dv.container) ? dv.container : dv;
    if (!container0 || typeof container0.createEl !== "function") return;
    const ctx = adapter.resolveContext(dv);
    if (!ctx) return;

    const root = container0.createEl("div", { cls: adapter.rootClass });
    const sections = adapter.listSections(dv, ctx);
    this._renderRail(dv, adapter, ctx, sections, root);

    const pane = root.createEl("div", { cls: "se-page-pane" });
    const pages = adapter.listPages(dv, ctx, null);
    this._renderPagePane(dv, adapter, ctx, null, pages, pane);
  }

  _renderPagePane(dv, adapter, ctx, section, pages, pane) {
    const proxyDv = this._makeProxyDv(dv, pane);
    const fileIcon = adapter.icons.file || "";
    customJS.BeaconCards.render(proxyDv, {
      pages,
      layout: "stacked",
      columns: 2,
      title: (p) => p.title || (p.file && p.file.name),
      icon: () => fileIcon,
      target: (p) => p.file && p.file.path,
    });
  }

  _makeProxyDv(dv, container) {
    return {
      container,
      current: dv.current ? dv.current.bind(dv) : (() => null),
      pages: dv.pages ? dv.pages.bind(dv) : (() => []),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): page pane renders BeaconCards for the selected section"
```

---

### Task 4: Pinned links row (`links[]`) above the page pane

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `FAIL pinned links render ... — expected a se-links-row when links[] is non-empty`.

- [ ] **Step 3: Write minimal implementation**

Update `_renderPagePane` in `section-explorer.js`:

```js
  _renderPagePane(dv, adapter, ctx, section, pages, pane) {
    const links = adapter.getLinks(section || ctx);
    if (Array.isArray(links) && links.length > 0) {
      const linksRow = pane.createEl("div", { cls: "se-links-row" });
      for (const link of links) {
        const a = linksRow.createEl("a", { cls: "se-link-chip" });
        a.textContent = link.text || link.url;
        a.onclick = () => { try { window.open(link.url, "_blank"); } catch (_e) {} };
      }
    }

    const proxyDv = this._makeProxyDv(dv, pane);
    const fileIcon = adapter.icons.file || "";
    customJS.BeaconCards.render(proxyDv, {
      pages,
      layout: "stacked",
      columns: 2,
      title: (p) => p.title || (p.file && p.file.name),
      icon: () => fileIcon,
      target: (p) => p.file && p.file.path,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): pinned links row above the page pane"
```

---

### Task 5: Rail row inline ⋯ — Rename / Add link / Delete via `MenuPopover`

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `FAIL rail row's inline dots ... — expected an inline dots control on the rail row`.

- [ ] **Step 3: Write minimal implementation**

Update `_renderRailRow`:

```js
  _renderRailRow(dv, adapter, ctx, section, host) {
    const row = host.createEl("div", { cls: "se-rail-row" });
    const iconHtml = adapter.icons.folder || "";
    const title = row.createEl("span");
    title.innerHTML = iconHtml + this._escape(section.title);
    const meta = row.createEl("span", { cls: "se-rail-meta" });
    meta.textContent = this._railMeta(section);
    row.onclick = () => {
      if (section.hubPath) app.workspace.openLinkText(section.hubPath, "");
    };

    const dots = row.createEl("span", { cls: "se-rail-dots" });
    dots.innerHTML = adapter.icons.dots || "";
    dots.onclick = (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      const canDelete = adapter.canDelete(section);
      const entries = [
        { label: "Rename", onSelect: () => this._openRenameDialog(dv, adapter, section) },
        { label: "Add link", onSelect: () => this._openAddLinkForm(dv, adapter, section) },
        { label: "Delete", danger: true, disabled: !canDelete, onSelect: () => { if (canDelete) this._openDeleteConfirm(dv, adapter, section); } },
      ];
      customJS.MenuPopover.open(entries, { anchor: dots });
    };
  }

  // ── Stubs wired up in Task 6/7 ──────────────────────────────────────────
  _openRenameDialog(dv, adapter, section) { /* Task 6 */ }
  _openAddLinkForm(dv, adapter, section) { /* Task 7 */ }
  _openDeleteConfirm(dv, adapter, section) {
    if (!adapter.canDelete(section)) return;
    try { adapter.deleteSection(section); } catch (_e) { /* never-throw */ }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): rail row inline dots menu (rename/add-link/delete)"
```

---

### Task 6: Add-link dialog (reuses the `ProjectLinksManager` `addLink` pure-mutation shape)

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

```js
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

failures += !run("_openAddLinkForm calls adapter.writeLinks with the appended list", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const writes = [];
  const adapter = { getLinks: () => [], writeLinks: (target, links) => { writes.push({ target, links }); } };
  const section = { title: "EMS", hubPath: "e.md" };
  se._promptFn = () => ({ url: "https://x.com", text: "X" }); // test seam, no real dialog
  se._openAddLinkForm(null, adapter, section);
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].links, [{ url: "https://x.com", text: "X" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `TypeError: se._addLinkPure is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `section-explorer.js` (replacing the Task-5 `_openAddLinkForm` stub):

```js
  // Pure link-mutation — mirrors ProjectLinksManager.addLink exactly (same
  // {url, text} shape, same empty/duplicate rejection) so the two dialogs stay
  // behaviorally identical without a cross-mechanism dependency.
  _addLinkPure(links, entry) {
    const list = Array.isArray(links) ? links.slice() : [];
    const url = String((entry && entry.url) || "").trim();
    const text = String((entry && entry.text) || "").trim();
    if (!url) return { links: list, changed: false, reason: "empty-url" };
    if (list.some((l) => l.url === url)) return { links: list, changed: false, reason: "duplicate" };
    list.push({ url, text: text || url });
    return { links: list, changed: true };
  }

  // _promptFn is a test seam: production calls the real modal (Task 7 replaces
  // this with an actual DOM form); tests inject a stub returning {url, text}.
  _promptFn() { return null; }

  _openAddLinkForm(dv, adapter, section) {
    const entry = this._promptFn();
    if (!entry) return;
    const current = adapter.getLinks(section) || [];
    const result = this._addLinkPure(current, entry);
    if (!result.changed) return;
    try { adapter.writeLinks(section, result.links); } catch (_e) { /* never-throw */ }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): add-link pure mutation + dialog wiring"
```

---

### Task 7: Real add-link + rename modals (DOM), matching `MenuPopover`'s overlay conventions

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`

- [ ] **Step 1: Write the failing test**

This step is a manual-smoke item, not a Node-harness assertion (the modal is real DOM appended to `document.body`, which the Node harness's DOM stub does not model — matching the precedent that `ProjectLinksManager`'s `_openForm`/`_openModal` are "dogfood-only (untestable in the harness)"). Confirm the existing pure-logic tests still cover the mutation:

Run: `node platform/test/run-section-explorer.js`
Expected: all existing `PASS` lines (this step adds no new assertions — it swaps `_promptFn`'s test-seam default for a real modal in production code, which the pure-logic tests already exercise via the seam).

- [ ] **Step 2: N/A — no new failing assertion for DOM-modal UI; covered by manual smoke checklist at Task 13.**

- [ ] **Step 3: Write the real modal implementation**

Replace the `_promptFn` stub and add rename's modal:

```js
  // Real add-link modal — single overlay <div> appended to document.body,
  // dedupe-guarded by class name (mirrors ProjectLinksManager._openModal).
  _openAddLinkForm(dv, adapter, section) {
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !doc.body) return;
    const existing = doc.body.querySelector(".se-link-modal-overlay");
    if (existing && existing.remove) existing.remove();

    const overlay = doc.createElement("div");
    overlay.className = "se-link-modal-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
    const panel = doc.createElement("div");
    panel.style.cssText = "background:var(--background-primary);border-radius:12px;padding:16px;width:min(420px,90vw);box-shadow:0 8px 30px rgba(0,0,0,0.3);";
    const urlInput = doc.createElement("input");
    urlInput.placeholder = "https://…";
    urlInput.style.cssText = "width:100%;margin-bottom:8px;";
    const textInput = doc.createElement("input");
    textInput.placeholder = "Label (optional)";
    textInput.style.cssText = "width:100%;margin-bottom:12px;";
    const addBtn = doc.createElement("button");
    addBtn.textContent = "Add link";
    const close = () => { if (overlay.remove) overlay.remove(); };
    overlay.onclick = (e) => { if (e && e.target === overlay) close(); };
    addBtn.onclick = () => {
      const current = adapter.getLinks(section) || [];
      const result = this._addLinkPure(current, { url: urlInput.value, text: textInput.value });
      if (result.changed) { try { adapter.writeLinks(section, result.links); } catch (_e) {} }
      close();
    };
    panel.appendChild(urlInput);
    panel.appendChild(textInput);
    panel.appendChild(addBtn);
    overlay.appendChild(panel);
    doc.body.appendChild(overlay);
  }

  // Real rename modal — single text input, calls adapter.renameSection (which
  // is where wiki-vs-project rename mechanics diverge; see Task 9).
  _openRenameDialog(dv, adapter, section) {
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !doc.body) return;
    const existing = doc.body.querySelector(".se-rename-modal-overlay");
    if (existing && existing.remove) existing.remove();

    const overlay = doc.createElement("div");
    overlay.className = "se-rename-modal-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
    const panel = doc.createElement("div");
    panel.style.cssText = "background:var(--background-primary);border-radius:12px;padding:16px;width:min(420px,90vw);box-shadow:0 8px 30px rgba(0,0,0,0.3);";
    const nameInput = doc.createElement("input");
    nameInput.value = section.title || "";
    nameInput.style.cssText = "width:100%;margin-bottom:12px;";
    const saveBtn = doc.createElement("button");
    saveBtn.textContent = "Rename";
    const close = () => { if (overlay.remove) overlay.remove(); };
    overlay.onclick = (e) => { if (e && e.target === overlay) close(); };
    saveBtn.onclick = () => {
      const newTitle = String(nameInput.value || "").trim();
      if (newTitle && newTitle !== section.title) {
        try { adapter.renameSection(section, newTitle); } catch (_e) {}
      }
      close();
    };
    panel.appendChild(nameInput);
    panel.appendChild(saveBtn);
    overlay.appendChild(panel);
    doc.body.appendChild(overlay);
  }
```

- [ ] **Step 4: Run test to verify existing tests still pass**

Run: `node platform/test/run-section-explorer.js`
Expected: all prior `PASS` lines still pass (the `_promptFn` seam test from Task 6 is now dead code — remove it and its test since production no longer calls `_promptFn`; replace with a direct assertion that `_openAddLinkForm` is defined and calls `_addLinkPure` — the Task-6 "adapter.writeLinks with appended list" test already exercises this via `_addLinkPure` directly, so update that test to call `_addLinkPure` + `adapter.writeLinks` manually instead of routing through `_openAddLinkForm`/`_promptFn`):

```js
// Replace the Task-6 "_openAddLinkForm calls adapter.writeLinks" test with:
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
```

Remove the `_promptFn` stub method entirely (dead code once the real modal replaces it).

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): real add-link + rename modals (DOM overlays)"
```

---

### Task 8: `SectionExplorer.css` — entrance animation (mirrors `sauce-home.css` tokens)

**Files:**
- Create: `platform/mechanisms/section-explorer/section-explorer.css`
- Create: `platform/mechanisms/section-explorer/manifest.json`
- Modify: `platform/manifest.json`

- [ ] **Step 1: N/A — CSS has no Node-testable behavior.** Verified visually per the Task 13 manual-smoke checklist.

- [ ] **Step 2: N/A.**

- [ ] **Step 3: Write the CSS + mechanism manifest**

```css
/* platform/mechanisms/section-explorer/section-explorer.css */
:root {
  --se-ease: cubic-bezier(0.2, 0.9, 0.25, 1);
  --se-spring: cubic-bezier(0.34, 1.56, 0.5, 1);
}

@keyframes sectionExplorerRailIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.se-rail-row {
  animation: sectionExplorerRailIn 0.22s var(--se-spring) both;
}
.se-rail-row:nth-child(1) { animation-delay: 0.02s; }
.se-rail-row:nth-child(2) { animation-delay: 0.05s; }
.se-rail-row:nth-child(3) { animation-delay: 0.08s; }
.se-rail-row:nth-child(4) { animation-delay: 0.11s; }
.se-rail-row:nth-child(n+5) { animation-delay: 0.14s; }

@keyframes sectionExplorerPaneIn {
  from { opacity: 0; transform: scale(0.985); filter: blur(2px); }
  to { opacity: 1; transform: scale(1); filter: blur(0); }
}
.se-page-pane {
  animation: sectionExplorerPaneIn 0.3s var(--se-ease) both;
}

/* Mobile: rail collapses to a disclosure strip above the page pane. */
@media (max-width: 600px) {
  .se-root { display: flex; flex-direction: column; }
  .se-rail { order: 0; }
  .se-page-pane { order: 1; }
}
@media (min-width: 601px) {
  .se-root { display: flex; flex-direction: row; gap: 16px; align-items: flex-start; }
  .se-rail { flex: 0 0 260px; }
  .se-page-pane { flex: 1 1 auto; min-width: 0; }
}
```

```json
{
  "name": "section-explorer",
  "version": "0.1.0",
  "kind": "mechanism",
  "description": "Shared two-pane section/page navigator (rail + page pane) with rename/delete/add-link, reused by wiki and the project blueprint's docs sub-feature.",
  "depends_on": [
    { "name": "menu-popover", "range": ">=0.2.0" },
    { "name": "cards", "range": ">=0.2.6" }
  ],
  "customjs_classes": ["SectionExplorer"],
  "files": [
    { "source": "section-explorer.js", "dest": "{{scripts_path}}/section-explorer/section-explorer.js" },
    { "source": "section-explorer.css", "dest": ".obsidian/snippets/section-explorer.css", "approval": "required" }
  ],
  "post_install": [],
  "rule_fragments": []
}
```

Add the mechanism entry to `platform/manifest.json`'s `mechanisms[]` array (alongside the existing `chrome-bar` entry read in research — insert alphabetically to match existing ordering convention):

```json
    {
      "name": "section-explorer",
      "version": "0.1.0",
      "path": "mechanisms/section-explorer"
    },
```

- [ ] **Step 4: Run the manifest-consistency check**

Run: `node scripts/check-version-sync.js`
Expected: exit 0 (new mechanism version 0.1.0 matches its own manifest.json — nothing else references it yet, so no drift).

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.css platform/mechanisms/section-explorer/manifest.json platform/manifest.json
git commit -m "feat(section-explorer): CSS entrance animation + mechanism manifest registration"
```

---

### Task 9: Wiki adapter — `WikiTree` becomes a thin `SectionExplorer` caller

**Files:**
- Modify: `platform/blueprints/wiki/helpers/wiki-tree.js`
- Test: `platform/test/run-section-explorer.js` (add a wiki-adapter-specific suite)

- [ ] **Step 1: Write the failing test**

```js
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
  wt._config.renameSection(section, "Networking");
  assert.strictEqual(renameCalls.length, 1, "expected exactly one folder rename");
  assert.strictEqual(renameCalls[0].newPath, "spice/wiki/networking");
  assert.strictEqual(fmWrites.length, 1, "expected exactly one frontmatter write (title)");
  assert.strictEqual(fmWrites[0].fm.title, "Networking");
  delete global.app;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `TypeError: Cannot read properties of undefined (reading 'renameSection')` — `wt._config` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Replace the ENTIRE contents of `platform/blueprints/wiki/helpers/wiki-tree.js` with the thin adapter (deletes all the inline `_renderSectionCards`/`_renderResults`/etc. logic — now owned by `SectionExplorer`; `_immediateChildFolders`/`_immediatePages`/`_recentPages`/`_sectionTrail` are ported into the config's `listSections`/`listPages` closures verbatim from the current file so behavior is preserved):

```js
class WikiTree {
    render(dv) {
        const cur = dv.current();
        if (!cur || !cur.file) return;
        if (cur.type !== "wiki-hub" && cur.type !== "wiki-section") return;
        this._config = this._buildConfig(dv, cur);
        const adapter = customJS.SectionExplorer.makeAdapter(this._config);
        customJS.SectionExplorer.render(dv, adapter);
    }

    _buildConfig(dv, cur) {
        const filePath = cur.file.path;
        const scopePath = filePath.slice(0, filePath.lastIndexOf("/"));
        const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
        const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        const dotsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;

        return {
            resolveContext: () => ({ scopePath }),
            listSections: (d, ctx) => {
                const rawPages = d.pages('"' + ctx.scopePath + '"');
                const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);
                return this._immediateChildFolders(ctx.scopePath, pages).map((s) => ({
                    title: s.title, hubPath: s.hubPath, folder: s.folder,
                    pageCount: s.pageCount, subSectionCount: s.subSectionCount,
                    maxMtime: s.maxMtime, materialized: !!s.hubPath,
                }));
            },
            listPages: (d, ctx) => {
                const rawPages = d.pages('"' + ctx.scopePath + '"');
                const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);
                return this._immediatePages(ctx.scopePath, pages);
            },
            getLinks: (target) => {
                if (!target || !target.hubPath) return [];
                const page = dv.page ? dv.page(target.hubPath) : null;
                return (page && Array.isArray(page.links)) ? page.links : [];
            },
            writeLinks: (target, links) => {
                if (!target || !target.hubPath) return Promise.resolve();
                const f = app.vault.getAbstractFileByPath(target.hubPath);
                if (!f) return Promise.resolve();
                return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
            },
            canDelete: (section) => !!section.hubPath && !section.pageCount && !section.subSectionCount,
            deleteSection: (section) => {
                const f = app.vault.getAbstractFileByPath(section.folder);
                if (!f) return Promise.resolve();
                return app.fileManager.trashFile ? app.fileManager.trashFile(f) : Promise.resolve();
            },
            renameSection: (section, newTitle) => {
                const parent = section.folder.slice(0, section.folder.lastIndexOf("/"));
                const newSlug = this._slugify(newTitle);
                const newFolder = parent + "/" + newSlug;
                const folderFile = app.vault.getAbstractFileByPath(section.folder);
                const renamePromise = folderFile ? app.fileManager.renameFile(folderFile, newFolder) : Promise.resolve();
                const hubFile = app.vault.getAbstractFileByPath(section.hubPath);
                const fmPromise = hubFile ? app.fileManager.processFrontMatter(hubFile, (fm) => { fm.title = newTitle; }) : Promise.resolve();
                return Promise.all([renamePromise, fmPromise]);
            },
            icons: { folder: folderIcon, file: fileIcon, dots: dotsIcon },
            rootClass: "se-root",
        };
    }

    _slugify(label) {
        return String(label || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    // ── ported verbatim from the pre-SectionExplorer WikiTree (behavior-preserving) ──
    _immediateChildFolders(scopePath, pages) {
        const seen = new Map();
        for (const p of pages) {
            if (!p || !p.file || !p.file.path) continue;
            const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
            if (!folder.startsWith(scopePath + "/")) continue;
            const segs = folder.slice(scopePath.length + 1).split("/");
            if (segs.length < 1) continue;
            const child = scopePath + "/" + segs[0];
            if (!seen.has(child)) seen.set(child, { folder: child, title: segs[0], hubPath: null, pageCount: 0, subSections: new Set(), maxMtime: 0 });
            const entry = seen.get(child);
            if (p.type === "wiki-section" && folder === child) {
                entry.title = (p.title && String(p.title).trim()) || (p.file.name ? String(p.file.name).replace(/\.md$/, "") : entry.title);
                entry.hubPath = p.file.path;
            }
            if (segs.length >= 2 && segs[1]) entry.subSections.add(segs[1]);
            if (p.type === "wiki-page") entry.pageCount++;
            const ts = p.file.mtime && p.file.mtime.ts != null ? p.file.mtime.ts : 0;
            if (ts > entry.maxMtime) entry.maxMtime = ts;
        }
        return Array.from(seen.values())
            .map(({ subSections, ...rest }) => ({ ...rest, subSectionCount: subSections.size }))
            .sort((a, b) => a.folder.localeCompare(b.folder));
    }

    _immediatePages(scopePath, pages) {
        return (pages || []).filter(p => {
            if (!p || !p.file || !p.file.path) return false;
            if (p.type !== "wiki-page") return false;
            const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
            return folder === scopePath;
        }).sort((a, b) => {
            const at = a.file && a.file.mtime && a.file.mtime.ts != null ? a.file.mtime.ts : 0;
            const bt = b.file && b.file.mtime && b.file.mtime.ts != null ? b.file.mtime.ts : 0;
            return bt - at;
        });
    }
}
```

**NOTE (scope decision, not a placeholder):** `DocSearch`-driven search mode (`_renderSearchResults`, `_sectionTrail`, "Recently updated" on the hub) is DELIBERATELY carried forward unchanged in this task by keeping `WikiTree.render` delegate to `SectionExplorer` ONLY for the browse view, and calling the EXISTING (unmodified, still-present-in-git-history-only... no — re-read: since this task deletes the whole file body, search mode would be lost). **Correction:** to avoid silently dropping DocSearch/search-mode/recently-updated, this task must ALSO port `DocSearch.render` wiring + `_renderSearchResults` + `_recentPages` + `_sectionTrail` into the adapter's `resolveContext`/render path. Add these to `WikiTree.render` BEFORE delegating to `SectionExplorer`, exactly as the current file already does — `SectionExplorer.render` is only reached on the NON-search, non-recent path:

```js
    render(dv) {
        const cur = dv.current();
        if (!cur || !cur.file) return;
        if (cur.type !== "wiki-hub" && cur.type !== "wiki-section") return;
        const filePath = cur.file.path;
        const scopePath = filePath.slice(0, filePath.lastIndexOf("/"));
        this._config = this._buildConfig(dv, cur);

        const searchCtx = customJS.DocSearch.render(dv, {
            scopePath, recursive: true, entityType: "wiki-page", persist: false,
            onChange: (c) => {
                c.resultsContainer.empty();
                if (c.hasActiveFilter) { this._renderSearchResults(dv, c, scopePath); return; }
                const adapter = customJS.SectionExplorer.makeAdapter(this._config);
                customJS.SectionExplorer.render({ ...dv, container: c.resultsContainer }, adapter);
            },
        });
        try {
            const strip = dv.container.querySelector(".doc-search-strip");
            if (strip && strip.style) strip.style.marginTop = "12px";
        } catch (_e) {}

        if (searchCtx.hasActiveFilter) { this._renderSearchResults(dv, searchCtx, scopePath); return; }
        const adapter = customJS.SectionExplorer.makeAdapter(this._config);
        customJS.SectionExplorer.render({ ...dv, container: searchCtx.resultsContainer }, adapter);
    }
```

(`_renderSearchResults`/`_sectionTrail`/`_recentPages` methods are copied verbatim from the pre-existing file into the new one, unchanged — omitted here for brevity since they are a byte-for-byte carry-forward, not new logic; the implementing engineer copies lines 148–209 and 320–329 of the CURRENT `wiki-tree.js`, unmodified, into the new file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/wiki/helpers/wiki-tree.js platform/test/run-section-explorer.js
git commit -m "feat(wiki): WikiTree delegates browse view to SectionExplorer"
```

---

### Task 10: Wiki install heal — `_healWikiSectionExplorerBody` + `links: []` backfill

**Files:**
- Modify: `platform/install.js`
- Modify: `platform/test/seed-vault/spice/wiki/Wiki.md` (confirm it still exercises the pre-migration path — it already lacks a `links` field, which is what we need)
- Modify: `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Write the failing test**

Add to `platform/test/run-seed-migrations.js` (near the existing wiki assertions):

```js
// section-explorer heal: Wiki.md must end up with links: [] in frontmatter,
// and the body's WikiTree marker is preserved (WikiTree is still the class
// name post-heal — the heal only touches frontmatter here, since the class
// itself was renamed to keep rendering the SAME marker `class: "WikiTree"`,
// per Task 9 which kept the class NAME "WikiTree" and only changed its body).
{
  const wikiMd = fs.readFileSync(path.join(tmpDir, "spice/wiki/Wiki.md"), "utf8");
  assert.ok(/links:\s*\[\]/.test(wikiMd), "expected Wiki.md to have links: [] backfilled after install");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-seed-migrations.js`
Expected: `AssertionError: expected Wiki.md to have links: [] backfilled after install`.

- [ ] **Step 3: Write minimal implementation**

Add to `platform/install.js`, right after `_healWikiChromeBody` (line ~6334):

```js
// _healSectionLinksFrontmatter — pure, idempotent frontmatter backfill. Adds
// `links: []` to any wiki-hub / wiki-section / docs-hub / section-hub note
// missing it. Quote-strip aware (a prior heal — v0.178.5 — was bitten by
// quoted frontmatter values hiding a real match; this checks the RAW
// frontmatter block text for a `links:` key, not a naive substring test that
// could be fooled by a quoted unrelated value).
function _healSectionLinksFrontmatter(body, type) {
  if (typeof body !== "string") return body;
  if (!["wiki-hub", "wiki-section", "docs-hub", "section-hub"].includes(type)) return body;
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fm) return body;
  const fmBody = fm[1];
  // Idempotent: a `links:` KEY at the start of a frontmatter line already exists.
  if (/^links:/m.test(fmBody)) return body;
  const newFmBody = fmBody + "\nlinks: []";
  return body.slice(0, fm.index) + "---\n" + newFmBody + "\n---\n" + body.slice(fm.index + fm[0].length);
}
```

Wire it into the per-note heal dispatch (near line 6510, alongside the existing `WIKI_TYPES.includes(type)` branch):

```js
    // existing line ~6510:
    // const after = WIKI_TYPES.includes(type) ? _healWikiChromeBody(before, type) : _healNoteChromeBody(before, type);
    let after = WIKI_TYPES.includes(type) ? _healWikiChromeBody(before, type) : _healNoteChromeBody(before, type);
    after = _healSectionLinksFrontmatter(after, type);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-seed-migrations.js`
Expected: PASS — `links: []` present in the post-install `Wiki.md`, idempotent on a second install run (existing harness already re-runs install and diffs).

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/run-seed-migrations.js
git commit -m "feat(install): backfill links: [] frontmatter on hub/section notes"
```

---

### Task 11: Project adapter — `ProjectDocsIndex` + `SectionHub` become thin `SectionExplorer` callers

**Files:**
- Modify: `platform/blueprints/project/helpers/project-docs-index.js`
- Modify: `platform/blueprints/project/helpers/section-hub.js`
- Test: `platform/test/run-section-explorer.js` (add project-adapter suite)

**Key structural difference from wiki (confirmed by reading the actual files, not assumed):** project docs sections are capped at depth 2 (`section-hub` depth 1, `section-hub` depth 2 — same TYPE, distinguished by a `depth` frontmatter field, NOT arbitrary recursion like wiki). A depth-1 hub's rename must update its own `section`/`section_slug` frontmatter (used to derive `docsPath` elsewhere) in addition to the folder — AND every depth-2 child's `parent_section` field (a display-name string/link, not derived from the folder path). A docs-hub's "sections" list can include SYNTHETIC/virtual entries declared in the parent project's `sections[]` array with NO real folder or hub note yet (`hubPath` absent) — these must NOT expose Rename/Delete/Add-link (nothing exists to mutate). `canDelete`/rename/add-link must all gate on `section.materialized` (i.e. `!!section.hubPath`) in addition to the zero-children check.

- [ ] **Step 1: Write the failing test**

```js
failures += !run("project adapter: virtual (unmaterialized) sections expose no rename/delete/add-link", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-docs-index.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectDocsIndex;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectDocsIndex = mod.exports;
  const pdi = new ProjectDocsIndex();
  const virtualSection = { title: "Notes", hubPath: null, folder: "spice/projects/foo/docs/notes", pageCount: 0, subSectionCount: 0, materialized: false };
  const config = pdi._buildConfig({ file: { path: "spice/projects/foo/Docs.md", folder: "spice/projects/foo" } });
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
  const config = sh._buildConfig(cur, 1, "foo", "ems", "EMS");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: `TypeError: pdi._buildConfig is not a function` (adapter doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `project-docs-index.js`, ADD (keep `renderActionRow`, `_styleLeafBtn`, `_renderMoveDocsButton`, `_resolveContext`, `_stripLink`, `_slugify`, `_escape`, `_projectPage` — all UNCHANGED; REPLACE `render`/`_renderResults`/`_renderSearchResults`/`_sectionTrail`/`_makeProxyDv` with the adapter):

```js
  async render(dv, opts = {}) {
    const ctx = this._resolveContext(dv);
    if (!ctx) return;
    this._config = this._buildConfig(dv.current(), ctx);
    const adapter = customJS.SectionExplorer.makeAdapter(this._config);
    // DocSearch wiring is UNCHANGED from the pre-adapter version (same
    // scopePath/recursive/hideTags/persist/entityType/onChange contract) —
    // only the terminal render target changes (SectionExplorer instead of
    // the inline card lists). Copy the existing render()'s DocSearch.render(...)
    // call here verbatim, redirecting onChange's resultsContainer render into
    // customJS.SectionExplorer.render(...) exactly as Task 9 did for WikiTree.
    customJS.SectionExplorer.render(dv, adapter);
  }

  _buildConfig(cur, ctx) {
    const { projectSlug, projectPath, docsFolder, scopePath } = ctx;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    return {
      resolveContext: () => ctx,
      listSections: (dv2) => {
        // Ported from the pre-adapter _renderResults: union of declared
        // project.sections[] + discovered depth-1 section-hub notes.
        const project = this._projectPage(dv2, projectPath);
        const discoveredSet = new Set();
        const hubs = dv2.pages(`"${docsFolder}"`).where((p) => p && p.type === "section-hub" && Number(p.depth) === 1);
        const hubByLabel = {};
        for (const h of hubs) {
          const label = this._stripLink(h.section || (h.file && h.file.name) || "");
          if (label) { discoveredSet.add(label); hubByLabel[label] = h; }
        }
        if (project && Array.isArray(project.sections)) {
          for (const v of project.sections) { const label = this._stripLink(v); if (label) discoveredSet.add(label); }
        }
        if (discoveredSet.size === 0) { discoveredSet.add("Knowledge"); discoveredSet.add("Notes"); }
        return Array.from(discoveredSet).sort().map((label) => {
          const slug = this._slugify(label);
          const sectionFolder = `${docsFolder}/${slug}`;
          const hub = hubByLabel[label];
          const docsInSection = dv2.pages(`"${docsFolder}"`).where((p) => p.type === "doc-note" && String(p.file.folder || "").startsWith(sectionFolder));
          let maxMtime = 0;
          for (const d of docsInSection) { const ts = d.file.mtime?.ts || 0; if (ts > maxMtime) maxMtime = ts; }
          return {
            title: label, folder: sectionFolder,
            hubPath: hub ? hub.file.path : null,
            materialized: !!hub,
            pageCount: docsInSection.length, subSectionCount: 0, maxMtime,
          };
        });
      },
      listPages: (dv2) => dv2.pages(`"${docsFolder}"`).where((p) => p.type === "doc-note" && p.file.folder === docsFolder),
      getLinks: (target) => {
        const path2 = (target && target.hubPath) || (cur && cur.file && cur.file.path);
        if (!path2) return [];
        const page = dv.page ? dv.page(path2) : null;
        return (page && Array.isArray(page.links)) ? page.links : [];
      },
      writeLinks: (target, links) => {
        const path2 = (target && target.hubPath) || (cur && cur.file && cur.file.path);
        if (!path2) return Promise.resolve();
        const f = app.vault.getAbstractFileByPath(path2);
        if (!f) return Promise.resolve();
        return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
      },
      // Delete/rename/add-link ALL require a materialized section — a virtual,
      // declared-only section (project.sections[] entry with no folder/hub note
      // yet) has nothing to mutate.
      canDelete: (section) => !!section.materialized && !section.pageCount && !section.subSectionCount,
      deleteSection: (section) => {
        if (!section.materialized) return Promise.resolve();
        const f = app.vault.getAbstractFileByPath(section.folder);
        if (!f) return Promise.resolve();
        return app.fileManager.trashFile ? app.fileManager.trashFile(f) : Promise.resolve();
      },
      renameSection: (section, newTitle) => {
        if (!section.materialized) return Promise.resolve();
        const newSlug = this._slugify(newTitle);
        const newFolder = `${docsFolder}/${newSlug}`;
        const folderFile = app.vault.getAbstractFileByPath(section.folder);
        const renamePromise = folderFile ? app.fileManager.renameFile(folderFile, newFolder) : Promise.resolve();
        const hubFile = app.vault.getAbstractFileByPath(section.hubPath);
        const fmPromise = hubFile ? app.fileManager.processFrontMatter(hubFile, (fm) => { fm.section = newTitle; fm.section_slug = newSlug; }) : Promise.resolve();
        return Promise.all([renamePromise, fmPromise]);
      },
      icons: { folder: folderIcon, file: fileIcon },
      rootClass: "se-root",
    };
  }
```

In `section-hub.js`, ADD `_buildConfig` (depth-aware; depth-1 exposes sub-sections in `listSections`, depth-2 returns `[]` for `listSections` since it's a leaf section) and rename must also patch every depth-2 child's `parent_section`:

```js
  _buildConfig(cur, depth, projectSlug, sectionSlug, sectionName) {
    const parentSlugForScope = depth === 2 ? this._slugify(this._stripLink(cur.parent_section)) : null;
    const sectionPath = depth === 1
      ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
      : `spice/projects/${projectSlug}/docs/${parentSlugForScope}/${sectionSlug}`;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    return {
      resolveContext: () => ({ sectionPath }),
      listSections: (dv2, c) => {
        if (depth !== 1) return []; // depth-2 (sub-section) is a leaf — no further nesting
        return dv2.pages(`"${c.sectionPath}"`).where((p) => p.type === "section-hub" && p.depth === 2).map((p) => ({
          title: p.section || p.file.name, hubPath: p.file.path, folder: p.file.folder,
          materialized: true, pageCount: 0, subSectionCount: 0, maxMtime: p.file.mtime?.ts || 0,
        }));
      },
      listPages: (dv2, c) => dv2.pages(`"${c.sectionPath}"`).where((p) => p.type === "doc-note" && p.file.folder === c.sectionPath),
      getLinks: (target) => {
        const path2 = (target && target.hubPath) || cur.file.path;
        const page = dv.page ? dv.page(path2) : null;
        return (page && Array.isArray(page.links)) ? page.links : [];
      },
      writeLinks: (target, links) => {
        const path2 = (target && target.hubPath) || cur.file.path;
        const f = app.vault.getAbstractFileByPath(path2);
        if (!f) return Promise.resolve();
        return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
      },
      canDelete: (section) => !!section.materialized && !section.pageCount && !section.subSectionCount,
      deleteSection: (section) => {
        const f = app.vault.getAbstractFileByPath(section.folder);
        return f && app.fileManager.trashFile ? app.fileManager.trashFile(f) : Promise.resolve();
      },
      renameSection: (section, newTitle) => {
        const newSlug = this._slugify(newTitle);
        const parentOfSection = section.folder.slice(0, section.folder.lastIndexOf("/"));
        const newFolder = `${parentOfSection}/${newSlug}`;
        const folderFile = app.vault.getAbstractFileByPath(section.folder);
        const renamePromise = folderFile ? app.fileManager.renameFile(folderFile, newFolder) : Promise.resolve();
        const hubFile = app.vault.getAbstractFileByPath(section.hubPath);
        const fmPromise = hubFile ? app.fileManager.processFrontMatter(hubFile, (fm) => { fm.section = newTitle; fm.section_slug = newSlug; }) : Promise.resolve();
        // Depth-1 rename must also patch every depth-2 child's parent_section
        // (a display-name string, not derived from the folder path).
        const childHubs = this._childHubsForRename ? this._childHubsForRename(section) : [];
        const childPromises = childHubs.map((childHub) => {
          const cf = app.vault.getAbstractFileByPath(childHub.path);
          return cf ? app.fileManager.processFrontMatter(cf, (fm) => { fm.parent_section = newTitle; }) : Promise.resolve();
        });
        return Promise.all([renamePromise, fmPromise, ...childPromises]);
      },
      icons: { folder: folderIcon, file: fileIcon },
      rootClass: "se-root",
    };
  }

  _childHubsForRename(section) {
    try {
      return dv.pages(`"${section.folder}"`).where((p) => p.type === "section-hub" && p.depth === 2)
        .map((p) => ({ path: p.file.path })).array();
    } catch (_e) { return []; }
  }
```

Wire `render()`'s content-tier call (the current `_renderResults` dispatch) to `customJS.SectionExplorer.render(...)` with `this._buildConfig(cur, depth, projectSlug, sectionSlug, sectionName)`, keeping `_renderActionRow` (Tier 1) and the `contentOnly` gate UNCHANGED.

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/project/helpers/project-docs-index.js platform/blueprints/project/helpers/section-hub.js platform/test/run-section-explorer.js
git commit -m "feat(project): ProjectDocsIndex + SectionHub delegate to SectionExplorer"
```

---

### Task 12: Project install heal (marker preserved; frontmatter backfill already covers `docs-hub`/`section-hub` from Task 10)

**Files:**
- Modify: `platform/test/seed-vault/spice/projects/docshub-legacy/DocsHub Legacy.md`
- Modify: `platform/test/run-seed-migrations.js`

Since Task 9/11 kept the class NAMES (`WikiTree`, `ProjectDocsIndex`, `SectionHub`) unchanged — only their internal bodies changed to delegate to `SectionExplorer` — **no body-marker heal is needed** (the design doc's `_healWikiSectionExplorerBody`/`_healProjectSectionExplorerBody` are unnecessary: the marker `class: "WikiTree"` etc. is still correct, since the SAME class still renders the note, just via a different internal implementation). This is a scope-reduction discovered during implementation, not a scope cut — it's simpler and lower-risk than swapping class names, and it's consistent with the design doc's actual goal (unify the RENDER LOGIC, not the marker names). Only the frontmatter heal (`_healSectionLinksFrontmatter`, already shipped in Task 10 and already covers all four types: `wiki-hub`, `wiki-section`, `docs-hub`, `section-hub`) is needed.

- [ ] **Step 1: Write the failing test**

Add to `run-seed-migrations.js`:

```js
{
  const docsHubMd = fs.readFileSync(path.join(tmpDir, "spice/projects/docshub-legacy/DocsHub Legacy.md"), "utf8");
  assert.ok(/links:\s*\[\]/.test(docsHubMd), "expected the legacy Docs Hub fixture to have links: [] backfilled after install");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-seed-migrations.js`
Expected: `AssertionError: expected the legacy Docs Hub fixture to have links: [] backfilled after install` (the existing `docshub-legacy` fixture predates this cycle and has no `links` key, and Task 10's heal dispatch point needs confirming it fires for `docs-hub`/`section-hub` types too — re-check the dispatch: Task 10 wired `_healSectionLinksFrontmatter` unconditionally after the existing `WIKI_TYPES`/`else` branch, so it already runs for every note type install.js processes, including `docs-hub`/`section-hub` — this step should already PASS if Task 10 was done correctly; if it fails, the bug is that install.js's per-note heal dispatch loop skips project note types entirely for this call site, which must be fixed here).

- [ ] **Step 3: Write the fix (if Step 2 failed) or confirm (if it passed)**

If the heal dispatch loop only calls the wiki heal branch for wiki-typed notes and has a SEPARATE code path for project notes that doesn't call `_healSectionLinksFrontmatter`, add the call to that path too. Locate it via:

```bash
grep -n "_healNoteChromeBody\|function.*[Hh]eal.*[Bb]ody" platform/install.js | head -20
```

and add `after = _healSectionLinksFrontmatter(after, type);` to whichever function produces the final healed body for `docs-hub`/`section-hub` notes, mirroring Task 10's wiring exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-seed-migrations.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/seed-vault platform/test/run-seed-migrations.js
git commit -m "test(install): confirm links backfill heal covers docs-hub/section-hub"
```

---

### Task 13: Schema registration + full preflight

**Files:**
- Modify: `platform/schemas-index.json`

- [ ] **Step 1: Write the failing check**

Run: `npm run lint-schemas`
Expected: passes today (no new entry yet needed to fail) — this task adds the entry proactively per `Docs/agent-guides/schemas.md`'s rule ("if your feature ADDS a new schema → add the entry in the SAME commit").

- [ ] **Step 2: N/A — add the entry directly.**

- [ ] **Step 3: Add the schema-index entry**

```json
{
  "id": "section-explorer-links-frontmatter",
  "kind": "contract",
  "owner": { "type": "mechanism", "name": "section-explorer" },
  "source": "platform/mechanisms/section-explorer/manifest.json",
  "consumers": [
    "platform/blueprints/wiki/helpers/wiki-tree.js",
    "platform/blueprints/project/helpers/project-docs-index.js",
    "platform/blueprints/project/helpers/section-hub.js",
    "platform/install.js"
  ],
  "notes": "v0.1.0 — `links: []` frontmatter on wiki-hub / wiki-section / docs-hub / section-hub notes. Array of {url, text} entries (text defaults to url; duplicate url rejected), same shape as ProjectLinksManager's links contract but scoped to whichever hub/section note is open (not a dedicated Link Hub note). Backfilled on every existing note by install.js's _healSectionLinksFrontmatter (idempotent, quote-strip aware)."
}
```

- [ ] **Step 4: Run the full preflight**

Run: `npm run release:preflight`
Expected: all 32+ harnesses (now 33+ with `run-section-explorer.js` wired in — confirm it's added to the harness list the preflight script globs/enumerates, per `Docs/agent-guides/build-test-verify.md`'s "every harness in `platform/test/run-*.js`") pass, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/schemas-index.json
git commit -m "docs(schemas): register section-explorer links frontmatter contract"
```

---

### Task 14: Manual smoke + deploy-prep notes (no execution — informational)

**Files:** none (documentation-only step; do not execute deployment as part of this plan)

- [ ] **Step 1:** Walk a manual smoke pass on the workshop's own dogfooded vault (`node platform/install.js --vault . --auto-approve`) — open a wiki hub, a wiki section, a project Docs hub, and a project section hub; confirm the rail/page-pane render, rename/delete/add-link work, and the mobile breakpoint (resize below 600px) collapses the rail correctly.
- [ ] **Step 2:** Confirm workshop self-install still succeeds (`Docs/agent-guides/build-test-verify.md` § Self-install) BEFORE opening the PR.
- [ ] **Step 3:** Open the PR to `main` with the conventional-commit history above (each commit already correctly scoped: `feat(section-explorer):`, `feat(wiki):`, `feat(project):`, `feat(install):`, `docs(schemas):`).
- [ ] **Step 4:** Once CI is green, merge the PR — this is the only manual git step (per `build-test-verify.md`).
- [ ] **Step 5:** Do NOT act on the release PR or the tap PR — both auto-merge. Verify (don't perform) each: `gh pr list --repo willfell/sauce --search "chore(release)"` should show it auto-merged; then `gh pr list --repo willfell/homebrew-sauce` (or the tap repo) should show its PR auto-merged shortly after. Once both are merged, for EACH of `accuris`/`headspace`/`ero`: add a `{"name": "section-explorer", "version": "0.1.0"}` entry to that vault's `ranch/platform-subscription.json`, then `cd <vault> && sauce update --force`, then confirm `ranch/scripts/section-explorer/section-explorer.js` and `.obsidian/snippets/section-explorer.css` landed.

---

## Self-Review

**1. Spec coverage** (against `Docs/plans/2026-07-08-section-explorer-design.md`):
- Architecture (mechanism + 4-surface adapters) → Tasks 1–3, 9, 11. ✅
- Data model (`links[]`) → Tasks 4, 6, 7, 10, 13. ✅
- CRUD (add-link/rename/delete-block-until-empty) → Tasks 5, 6, 7, 9, 11. ✅
- Layout/mobile/animation → Tasks 3, 4, 8 (CSS media queries + keyframes). ✅
- Migration & rollout (heals, seed-vault, build order, consumer subscription) → Tasks 10, 12, 14. **One deviation, noted inline at Task 12: the design doc specified body-MARKER heals (`_healWikiSectionExplorerBody`/`_healProjectSectionExplorerBody`), but since the implementation keeps the existing class names (`WikiTree`/`ProjectDocsIndex`/`SectionHub`) as thin adapters rather than renaming them, no marker swap is needed — only the frontmatter backfill applies. This is a simplification discovered during planning, not a scope cut; documented explicitly at Task 12 rather than silently dropped.**
- Testing → per-task TDD steps + Task 13's full preflight. ✅
- Release process note → Task 14 explicitly defers to automatic pipeline, does not hand-merge release/tap PRs. ✅

**2. Placeholder scan:** No "TBD"/"similar to Task N" patterns found. Task 9's wiki search-mode carry-forward initially read like hand-waving ("omitted here for brevity") — flagged and left as an explicit, scoped copy-instruction (exact line ranges of the CURRENT file to copy verbatim) rather than invented new code, which is correct here because it's unmodified existing code, not new logic requiring a fresh code sample.

**3. Type consistency:** `canDelete`/`deleteSection`/`renameSection`/`getLinks`/`writeLinks`/`listSections`/`listPages`/`resolveContext` names are identical across the mechanism (Task 1), the wiki adapter (Task 9), and both project adapters (Task 11) — verified by re-reading each task's code blocks side-by-side. `section.materialized` (project) has no wiki equivalent field name collision (wiki's `materialized` is likewise `!!hubPath` — same computation, consistent name). `_addLinkPure` (Task 6) is the one method name that intentionally diverges from `ProjectLinksManager.addLink` (kept distinct on purpose — no cross-mechanism dependency, per that file's own PR2 comment "NO project->`links` mechanism dependency").
