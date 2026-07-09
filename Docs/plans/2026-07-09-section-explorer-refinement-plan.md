# Section Explorer Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the project-docs "docs not showing" singleton stale-ctx bug and land the visual/UX refinement pass (rail header row with relocated sort toggle, stacked title/meta rail rows, page-pane group label, empty-state suppression) on the shared `section-explorer` mechanism.

**Architecture:** All rendering changes land in `platform/mechanisms/section-explorer/section-explorer.js` + `.css` (shared — both Wiki and Project docs pick them up). The bug fix is a deletion of the `this._currentCtx`/`Object.assign` restore mechanism in the two Project adapters (`section-hub.js`, `project-docs-index.js`) — `WikiTree` never had it and works. One new optional adapter config field, `pageLabel` (defaults `"Docs"`; wiki sets `"Pages"`). No new mechanism, no frontmatter changes, no heals, no manifest version edits (the release bumper owns versions).

**Tech Stack:** CustomJS (vanilla ES class, Obsidian DOM APIs), Dataview, plain-assert Node test harness (`node platform/test/run-section-explorer.js`), CSS snippet shipped via manifest `snippets[]`.

**Design doc:** `Docs/plans/2026-07-09-section-explorer-refinement-design.md`

---

## File Structure

| File | Change |
|---|---|
| `platform/blueprints/project/helpers/section-hub.js` | BUG FIX: delete the `_currentCtx` restore mechanism (lines ~73-74, ~81-83). |
| `platform/blueprints/project/helpers/project-docs-index.js` | BUG FIX: delete the `_currentCtx` restore mechanism (lines ~160-161, ~169-171). |
| `platform/mechanisms/section-explorer/section-explorer.js` | Rail header row (`Sections` label + relocated toggle), stacked title/meta rows, page-pane label via `pageLabel`, empty-state suppression, `pageLabel` in `makeAdapter`. |
| `platform/mechanisms/section-explorer/section-explorer.css` | Styles for `.se-rail-header`, `.se-group-label`, stacked `.se-rail-row`, pane label spacing. |
| `platform/blueprints/wiki/helpers/wiki-tree.js` | `_buildConfig` returns `pageLabel: "Pages"`. |
| `platform/test/run-section-explorer.js` | Extended with new tests (stale-ctx regression, header row, stacked rows, pane label, suppression). |

Group labels are rendered by the mechanism itself as `.se-group-label` divs (styled like `SectionLabel` in CSS) — NOT by calling `customJS.SectionLabel` — so the mechanism's dependency set (`menu-popover`, `cards`) is unchanged.

**Landmine reminders for every task:** helper files MUST stay bare class expressions with NO trailing statements (customJS loader evals the whole file as one expression). Never edit anything between `claude-surface` markers. Never touch version fields — the release pipeline bumps them.

---

### Task 1: BUG FIX — singleton stale `_currentCtx` hijacks later renders' resultsContainer

`SectionHub`/`ProjectDocsIndex` are customJS singletons (one instance reused for every note). `DocSearch.render()` creates a fresh `resultsContainer` per call, but `Object.assign(filterCtx, this._currentCtx)` overwrites it with the container from the LAST search interaction anywhere in the vault → docs render into a detached, invisible node ("no docs"). `WikiTree` has no such mechanism and works.

**Files:**
- Modify: `platform/blueprints/project/helpers/project-docs-index.js` (lines ~160-161, ~169-171)
- Modify: `platform/blueprints/project/helpers/section-hub.js` (lines ~73-74, ~81-83)
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing regression test**

Append to `platform/test/run-section-explorer.js` (before `process.exit`). It uses the existing `makeDomStub`, `makeClassShapedDv`, and `loadClass` helpers already defined in the file:

```js
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

  // Render #2 on note B (fresh containers). All browse content must land under
  // note B's own DOM — nothing may leak into the stale ctx's container.
  const { container: containerB, els: elsB } = makeDomStub();
  const curB = { file: { path: "spice/projects/bbb/docs/Docs.md", folder: "spice/projects/bbb/docs" }, type: "docs-hub" };
  pdi.render(makeClassShapedDv(containerB, pagesFor("bbb"), curB));

  const rowsInB = elsB.filter((e) => e.className === "se-rail-row");
  const rowsInStale = staleStub.els.filter((e) => e.className === "se-rail-row");
  assert.strictEqual(rowsInStale.length, 0, "no rail rows may render into the PRIOR render's stale resultsContainer");
  assert.strictEqual(rowsInB.length, 1, "render #2's rail rows must land in ITS OWN resultsContainer — got " + rowsInB.length + " (stale-_currentCtx hijack)");
  delete global.customJS;
});
```

Note: `pdi.render` is async (its source is `async render(dv)`), but everything on the no-filter browse path executes synchronously before the first `await`, so the synchronous assertions above are safe — this matches how the existing `"REGRESSION: ProjectDocsIndex.render with a class-shaped dv..."` test already calls it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: the new test FAILS with `render #2's rail rows must land in ITS OWN resultsContainer — got 0 (stale-_currentCtx hijack)` (the stale ctx swallowed render #2's output). All pre-existing tests still PASS.

- [ ] **Step 3: Delete the restore mechanism in `project-docs-index.js`**

In `platform/blueprints/project/helpers/project-docs-index.js`, change the `onChange` callback (~line 160):

```js
      onChange: (c) => {
        this._currentCtx = c;
        c.resultsContainer.empty();
        this._renderTerminal(dv, docsFolder, c);
      },
```

to:

```js
      onChange: (c) => {
        c.resultsContainer.empty();
        this._renderTerminal(dv, docsFolder, c);
      },
```

and DELETE these lines (~169-171) entirely:

```js
    if (this._currentCtx) {
      Object.assign(filterCtx, this._currentCtx);
    }
```

- [ ] **Step 4: Delete the restore mechanism in `section-hub.js`**

In `platform/blueprints/project/helpers/section-hub.js`, change the `onChange` callback (~line 72):

```js
      onChange: (ctx) => {
        this._currentCtx = ctx;
        ctx.resultsContainer.empty();
        this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, ctx);
      },
```

to:

```js
      onChange: (ctx) => {
        ctx.resultsContainer.empty();
        this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, ctx);
      },
```

and DELETE these lines (~81-83) entirely:

```js
    if (this._currentCtx) {
      Object.assign(filterCtx, this._currentCtx);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, exit 0. Also confirm no `_currentCtx` references remain: `grep -rn "_currentCtx" platform/blueprints/` → no output.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/project/helpers/project-docs-index.js platform/blueprints/project/helpers/section-hub.js platform/test/run-section-explorer.js
git commit -m "fix(project): stale singleton search ctx hijacked later renders' resultsContainer (docs invisibly rendered)"
```

---

### Task 2: Rail header row — "Sections" label + relocated Recent/A–Z toggle

The toggle currently renders at the TOP of `_renderRail`'s DOM but is styled/positioned as a plain strip; the user wants a proper header row: "Sections" label left, toggle pills right, above the row list. This also delivers the rail half of the group-header ask.

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`_renderRail`)
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

Append to `run-section-explorer.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: both new tests FAIL (`expected a se-rail-header row`). All prior tests PASS.

- [ ] **Step 3: Implement — replace `_renderRail` in `section-explorer.js`**

Replace the whole `_renderRail` method with:

```js
  _renderRail(dv, adapter, ctx, sections, root) {
    if (!Array.isArray(sections) || sections.length === 0) return;
    const rail = root.createEl("div", { cls: "se-rail" });

    // Header row: "Sections" group label (left) + Recent/A–Z toggle (right).
    const header = rail.createEl("div", { cls: "se-rail-header" });
    header.createEl("span", { cls: "se-group-label", text: "Sections" });

    const sortRecent = (list) => [...list].sort((a, b) => (b.maxMtime || 0) - (a.maxMtime || 0));
    const sortAlpha = (list) => [...list].sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const cardsWrap = rail.createEl("div", { cls: "se-rail-cards" });

    const paint = (mode) => {
      cardsWrap.empty();
      const ordered = mode === "alpha" ? sortAlpha(sections) : sortRecent(sections);
      for (const section of ordered) this._renderRailRow(dv, adapter, ctx, section, cardsWrap);
    };

    if (sections.length >= 2) {
      const toggle = header.createEl("div", { cls: "se-rail-toggle" });
      const modes = [{ key: "recent", label: "Recent" }, { key: "alpha", label: "A–Z" }];
      let current = "recent";
      const pills = [];
      const paintActive = () => {
        for (const p of pills) p.el.classList.toggle("is-active", p.key === current);
      };
      for (const m of modes) {
        const pill = toggle.createEl("span", { cls: "se-rail-toggle-pill" });
        pill.textContent = m.label;
        pill.onclick = () => { current = m.key; paintActive(); paint(current); };
        pills.push({ key: m.key, el: pill });
      }
      paintActive();
    }
    paint("recent");
  }
```

(Only two structural changes vs. current code: the header row is created first with the label in it, and the toggle is created inside `header` instead of directly on `rail`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): rail header row — Sections label + relocated sort toggle"
```

---

### Task 3: Stacked rail-row layout — title on its own line, meta below

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`_renderRailRow`)
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: FAIL (`expected a se-rail-main stacking block inside the row`).

- [ ] **Step 3: Implement — update `_renderRailRow`**

In `_renderRailRow`, replace the title/meta creation (keep the row creation, `row.onclick`, and the whole `dots` block exactly as they are):

```js
  _renderRailRow(dv, adapter, ctx, section, host) {
    const row = host.createEl("div", { cls: "se-rail-row" });
    const iconHtml = adapter.icons.folder || "";
    // Stacked layout: title on its own line, meta below it — long section
    // names truncate instead of colliding with the counts.
    const main = row.createEl("div", { cls: "se-rail-main" });
    const title = main.createEl("span", { cls: "se-rail-title" });
    title.innerHTML = iconHtml + `<span class="se-rail-title-text">${this._escape(section.title)}</span>`;
    const meta = main.createEl("span", { cls: "se-rail-meta" });
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
```

- [ ] **Step 4: Run tests — the OLD meta-position test may need its finder updated**

Run: `node platform/test/run-section-explorer.js`
The pre-existing test `"rail rows show meta (doc/section counts) and re-sort on toggle click"` locates the title via `rows[0].children.includes(e)` — the title is now nested one level deeper. Update that assertion in place:

```js
  // OLD:
  // const firstTitle = els.find((e) => e.className === "se-rail-title" && rows[0].children.includes(e));
  // NEW (title now nests inside the se-rail-main stacking block):
  const firstMain = rows[0].children.find((c) => c.className === "se-rail-main");
  const firstTitle = firstMain && firstMain.children.find((c) => c.className === "se-rail-title");
```

Then run again. Expected: all PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): stacked rail rows — title over meta, no more same-line collision"
```

---

### Task 4: Page-pane group label (`pageLabel`) + wiki "Pages"

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`makeAdapter`, `_renderPagePane`)
- Modify: `platform/blueprints/wiki/helpers/wiki-tree.js` (`_buildConfig`)
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: both FAIL (`expected a pane group label` / `pageLabel` undefined).

- [ ] **Step 3: Implement**

In `makeAdapter`, add one field to the returned object (after `rootClass`):

```js
      pageLabel: config.pageLabel || "Docs",
```

In `_renderPagePane`, insert the label between the links row and the BeaconCards call (links row logic unchanged above it):

```js
    if (typeof customJS === "undefined" || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") return;
    pane.createEl("div", { cls: "se-group-label se-pane-label", text: adapter.pageLabel || "Docs" });
    const proxyDv = this._makeProxyDv(dv, pane);
```

In `wiki-tree.js` `_buildConfig`, add to the returned config object (after `rootClass: "se-root",`):

```js
            pageLabel: "Pages",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/blueprints/wiki/helpers/wiki-tree.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): page-pane group label (Docs default, wiki says Pages)"
```

---

### Task 5: Empty-state suppression — no "Nothing here yet." box when sections exist

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`render`, `_renderPagePane`)
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing tests**

```js
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
    getLinks: () => [{ url: "https://example.com", text: "Guide" }],
    icons: { folder: "<svg/>", file: "<svg/>", dots: "<svg/>" },
    rootClass: "se-root",
  });
  se.render(dv, adapter);
  assert.strictEqual(calls.length, 0, "BeaconCards must NOT be called (would print 'Nothing here yet.')");
  assert.strictEqual(els.filter((e) => e.className === "se-page-pane").length, 0, "no page pane element at all");
  assert.strictEqual(els.filter((e) => e.className === "se-links-row").length, 0, "links row suppressed too");
  assert.strictEqual(els.filter((e) => e.className === "se-group-label se-pane-label").length, 0, "pane label suppressed too");
  delete global.customJS;
});

failures += !run("genuinely empty leaf (0 sections AND 0 pages) still shows the pane with the empty-state message", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const calls = [];
  global.customJS = { BeaconCards: { render: (d, o) => calls.push(o) } };
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
  assert.strictEqual(calls.length, 1, "BeaconCards still called — its built-in empty message communicates the real 'nothing here'");
  assert.deepStrictEqual(calls[0].pages, [], "called with zero pages");
  delete global.customJS;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-section-explorer.js`
Expected: first new test FAILS (`BeaconCards must NOT be called` — currently called once). Second may already pass; that's fine (it pins the behavior).

- [ ] **Step 3: Implement — gate the pane in `render()`**

In `render()`, replace the pane-creation tail:

```js
    const sections = adapter.listSections(dv, ctx);
    this._renderRail(dv, adapter, ctx, sections, root);

    // Empty-state suppression: with zero pages at this level but real
    // sections in the rail, an empty page pane (and its "Nothing here yet."
    // box) is pure noise — the rail IS the content. A genuinely empty leaf
    // (no sections either) keeps the pane so the empty state still speaks.
    const pages = adapter.listPages(dv, ctx, null);
    const pageCount = Array.isArray(pages) ? pages.length : (pages && pages.length) || 0;
    if (pageCount === 0 && Array.isArray(sections) && sections.length > 0) return;

    const pane = root.createEl("div", { cls: "se-page-pane" });
    this._renderPagePane(dv, adapter, ctx, null, pages, pane);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, exit 0. (Earlier tests that pass both sections AND pages, or pages only, are unaffected; the Task 2/3 rail tests pass sections with zero pages and never assert on the pane.)

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): suppress empty page pane when sections exist (kills redundant 'Nothing here yet.')"
```

---

### Task 6: CSS — header row, group labels, stacked rows

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.css`

No Node-testable behavior; verified visually at Task 7. The CSS ships via the manifest's `snippets[]` (already correct since v0.208.1 — do NOT touch the manifest).

- [ ] **Step 1: Apply the CSS changes**

In `section-explorer.css`:

**(a)** Replace the `.se-rail-toggle` block (currently `margin-bottom: 6px`) and add header/label rules directly above it:

```css
/* Header row: "Sections" group label left, sort toggle right. */
.se-rail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  margin-bottom: 6px;
}

/* Shared group-label treatment (rail "Sections", pane "Docs"/"Pages") —
 * mirrors SectionLabel's small-caps muted look without depending on it. */
.se-group-label {
  font-size: 0.78em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  white-space: nowrap;
}

.se-rail-toggle {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
```

**(b)** Replace the `.se-rail-row`, `.se-rail-title`, `.se-rail-meta` blocks with the stacked layout:

```css
.se-rail-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s var(--se-ease), border-color 0.15s var(--se-ease), transform 0.15s var(--se-ease);
}
.se-rail-row:hover {
  background: var(--background-secondary-alt, var(--background-secondary));
  border-color: var(--interactive-accent);
  transform: translateY(-1px);
}
/* Stacked main block: title line over meta line. */
.se-rail-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
.se-rail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 600;
  color: var(--text-normal);
}
.se-rail-title svg { flex-shrink: 0; }
.se-rail-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.se-rail-meta {
  font-size: 0.78em;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Indent under the title text, past the 16px icon + 8px gap. */
  padding-left: 24px;
}
```

**(c)** Add pane-label spacing (near the `.se-links-row` block):

```css
.se-pane-label {
  margin-bottom: 2px;
}
```

**(d)** Keep everything else (animations, `.se-mobile`, reduced-motion) unchanged.

- [ ] **Step 2: Sanity-check the full suite still passes (CSS can't break JS, but cheap)**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.css
git commit -m "feat(section-explorer): CSS for rail header, group labels, stacked rows"
```

---

### Task 7: Visual verification (Playwright HTML harness) + full preflight

Per the vault's lesson (`lesson_verify_chrome_visually_with_playwright_harness`): chrome/CSS changes get verified visually with a faithful HTML replica before shipping — code review alone has missed layout bugs repeatedly.

**Files:**
- Create (throwaway, NOT committed): `/tmp/se-harness/index.html`

- [ ] **Step 1: Build a faithful harness**

Create `/tmp/se-harness/index.html` containing: (1) the FULL contents of `platform/mechanisms/section-explorer/section-explorer.css` inline in a `<style>` tag, plus dark-theme Obsidian CSS variable stand-ins:

```css
:root {
  --background-primary: #1e1e1e; --background-secondary: #262626;
  --background-secondary-alt: #2e2e2e; --background-modifier-border: #3a3a3a;
  --background-modifier-hover: #333; --interactive-accent: #7c6ae6;
  --text-normal: #dcddde; --text-muted: #999; --text-faint: #666;
  --text-on-accent: #fff;
}
body { background: var(--background-primary); color: var(--text-normal); font-family: -apple-system, sans-serif; padding: 24px; }
```

and (2) static DOM matching EXACTLY what the new `_renderRail`/`_renderRailRow`/`_renderPagePane` emit (same classes, same nesting): a `.se-root` with a `.se-rail` (header row with `.se-group-label` "Sections" + `.se-rail-toggle` with two pills one `.is-active`; 3 `.se-rail-row`s each with `.se-rail-main` > `.se-rail-title` (inline svg + `.se-rail-title-text`, one with a very long name like "Microservice Deployment Standardization And Rollout") + `.se-rail-meta` ("2 sections · 14 docs"), plus `.se-rail-dots`) and a `.se-page-pane` with `.se-links-row` (2 `.se-link-chip`s), a `.se-group-label.se-pane-label` "Docs", and a 2-column grid of 4 stand-in cards (`background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 10px; padding: 14px 16px;`).

Also add a second copy of the whole `.se-root` further down the page with class `se-root se-mobile` to preview the mobile stack.

- [ ] **Step 2: Serve + screenshot at desktop and mobile widths**

```bash
cd /tmp/se-harness && python3 -m http.server 8931 &
```

Use the Playwright MCP browser: navigate to `http://localhost:8931`, screenshot at default width, then `browser_resize` to 390×844 and screenshot again. Verify visually: header row reads clearly (label left, pills right); long title truncates with ellipsis before the dots; meta sits under the title, indented past the icon; pane label present; nothing overlapping. Fix CSS + re-screenshot if anything looks off, then kill the server.

- [ ] **Step 3: Run the full release preflight**

```bash
npm run release:preflight
```

Expected: exit 0 (this includes `run-section-explorer.js`, all lint gates, seed migrations, and every other harness). If any unrelated test fails, STOP and report — do not "fix" unrelated failures silently.

- [ ] **Step 4: Commit any CSS adjustments from Step 2**

```bash
git add platform/mechanisms/section-explorer/section-explorer.css
git commit -m "fix(section-explorer): visual polish from harness verification" # only if changes were made
```

---

### Task 8: PR → CI → merge (automatic pipeline — hands off versions/tags)

- [ ] **Step 1: Sync with origin/main and push the branch**

```bash
git fetch origin && git merge origin/main   # resolve conflicts if any, re-run node platform/test/run-section-explorer.js after
git push -u origin HEAD
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(section-explorer): UX refinement — rail header, stacked rows, pane labels, empty-state suppression + project docs stale-ctx fix" --body "$(cat <<'EOF'
## Summary
- **BUG FIX**: project docs/section hubs rendered docs into a stale, detached resultsContainer after any search interaction (singleton `_currentCtx` restore in SectionHub/ProjectDocsIndex overwrote each render's fresh DocSearch ctx) — deleted the mechanism, matching WikiTree's working pattern. Regression-tested.
- Rail header row: "Sections" group label + the Recent/A–Z sort toggle relocated from below the list to the header.
- Rail rows now stack title over meta (long names truncate instead of colliding with counts).
- Page pane gains a group label ("Docs" default; wiki says "Pages" via new optional adapter `pageLabel`).
- Empty page pane fully suppressed when sections exist (kills the redundant "Nothing here yet." box on hubs); genuinely-empty leaves keep the message.

Design: `Docs/plans/2026-07-09-section-explorer-refinement-design.md`
Plan: `Docs/plans/2026-07-09-section-explorer-refinement-plan.md`

## Test plan
- `node platform/test/run-section-explorer.js` — 21 → 28 tests, incl. singleton stale-ctx regression
- `npm run release:preflight` green
- Playwright HTML harness screenshots (desktop + 390px mobile)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI green, then merge the FEATURE PR (and only it)**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Do NOT touch the release PR the bumper opens afterward — it auto-merges. Never hand-edit versions, tags, or the tap.

---

### Task 9: Release watch + deploy to the 3 consumer vaults

- [ ] **Step 1: Wait for the automatic release to ship**

Watch for the auto-opened release PR to merge, the tag to land, and the brew tap PR to auto-merge (per `Docs/agent-guides/build-test-verify.md` the whole chain is automatic — verified, not performed). Poll:

```bash
gh pr list --state all --limit 5        # release PR appears + merges
gh release list --limit 3               # new tag ships
```

- [ ] **Step 2: Upgrade brew + deploy to each vault**

```bash
brew update && brew upgrade sauce
sauce --version   # confirm the new version
for v in accuris-sauce headspace-sauce ero-sauce; do
  bash -c "cd /Users/willfellhoelter/notes/sauce/$v && sauce update --bump-pins"
done
```

(NEVER run `sauce update` from the workshop worktree — cwd-vault detection would self-install it.)

- [ ] **Step 3: Verify deployment landed**

For each vault, confirm the deployed files carry the new code:

```bash
for v in accuris-sauce headspace-sauce ero-sauce; do
  grep -l "se-rail-header" "/Users/willfellhoelter/notes/sauce/$v/ranch/scripts/section-explorer/section-explorer.js" \
    && grep -L "_currentCtx" "/Users/willfellhoelter/notes/sauce/$v/ranch/scripts/project/section-hub.js" \
    && grep -c "se-rail-main" "/Users/willfellhoelter/notes/sauce/$v/.obsidian/snippets/sauce-section-explorer.css"
done
```

Expected: `se-rail-header` present in each vault's mechanism JS, `_currentCtx` ABSENT from each section-hub.js (`grep -L` prints the path when the pattern is missing), and the CSS snippet contains `se-rail-main`. Note: confirm the snippet's actual on-disk name first (`ls /Users/willfellhoelter/notes/sauce/accuris-sauce/.obsidian/snippets/ | grep -i section`) — use whatever name the manifest's `snippets[]` entry declares.

- [ ] **Step 4: Report completion**

Summarize: PR #, released version, deploy status per vault, and remind the user to Cmd+R each vault.
