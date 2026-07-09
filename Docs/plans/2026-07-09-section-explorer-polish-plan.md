# Section Explorer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty hub pane with recently-updated docs, give doc cards their own visual identity (mechanism-owned cards replace BeaconCards in the pane), let long rail titles wrap, add rail air, and ship the mandatory leaf-note pinned-links feature (`SectionExplorer.renderNoteLinks` hooked from both chrome bars — zero body migration).

**Architecture:** All rendering lands in `platform/mechanisms/section-explorer/section-explorer.js` + `.css`. Adapters gain an optional `listRecent(dv, ctx) -> [{title, path, mtime, where}]`. Leaf links render via `renderNoteLinks(dv)` called from `WikiChromeBar.render`/`ProjectChromeBar.render` after the bar, gated by note type — existing notes light up with no heal. Blueprint manifests declare the now-real `depends_on: section-explorer` (RANGE only — never touch version numbers; the release pipeline owns them).

**Tech Stack:** CustomJS, Dataview, plain-assert Node harness (`node platform/test/run-section-explorer.js`), Obsidian `processFrontMatter`.

**Design doc:** `Docs/plans/2026-07-09-section-explorer-polish-design.md`

**Landmines (every task):** helper files stay bare class expressions, NO trailing statements. Never edit claude-surface marker regions. Never touch `version:` fields anywhere. `rtk` shell wrapper: prefix `command ` if find/diff misbehave.

---

## File Structure

| File | Change |
|---|---|
| `platform/mechanisms/section-explorer/section-explorer.js` | `_renderDocCards` (own cards + empty state, replaces BeaconCards in pane), recent mode, `pageLabel`/"Recently updated" switching, `renderNoteLinks` + `_noteSelfAdapter`. |
| `platform/mechanisms/section-explorer/section-explorer.css` | `.se-doc-grid/.se-doc-card/.se-doc-icon/.se-doc-body/.se-doc-title/.se-doc-sub`, pane left divider, rail gap 12px, 2-line title clamp, `.se-note-links/.se-note-link-card/.se-note-link-add`. |
| `platform/blueprints/wiki/helpers/wiki-tree.js` | `listRecent` in `_buildConfig`; DELETE the hub-only Recently-Updated grid from `_renderResults`. |
| `platform/blueprints/project/helpers/project-docs-index.js` | `listRecent` in `_buildConfig`. |
| `platform/blueprints/project/helpers/section-hub.js` | `listRecent` in `_buildConfig`. |
| `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` | Call `renderNoteLinks` after the bar on `wiki-page`. |
| `platform/blueprints/project/helpers/project-chrome-bar.js` | Call `renderNoteLinks` after the bar on `doc-note`. |
| `platform/blueprints/wiki/manifest.json` + `platform/blueprints/project/manifest.json` | Append `{ "name": "section-explorer", "range": ">=0.3.0" }` to `depends_on`. |
| `platform/schemas-index.json` | Update `section-explorer-links-frontmatter` entry: notes mention wiki-page/doc-note; consumers += the two chrome-bar helpers. |
| `platform/test/run-section-explorer.js` | Rewrite pane tests (BeaconCards → `se-doc-card`), add recent-mode/doc-card/note-links/chrome-hook tests. |

---

### Task 1: Mechanism-owned doc cards — `_renderDocCards` replaces BeaconCards in the pane

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Rewrite the pane tests that assert BeaconCards, add doc-card tests**

In `platform/test/run-section-explorer.js`:

**(a)** REWRITE the existing test `"page pane renders BeaconCards.render with the section's pages"` to:

```js
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
```

**(b)** REWRITE the existing test `"genuinely empty leaf (0 sections AND 0 pages) still shows the pane empty-state message"` — the empty box is now mechanism-owned markup, not BeaconCards:

```js
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
```

**(c)** Also REWRITE the two other pane tests that currently stub `BeaconCards` for pane rendering — `"pinned links render above the page grid, and render nothing when empty"`, `"javascript: link renders as a chip with NO href/onclick (unsafe scheme blocked)"`, `"https: link gets a real safe anchor (href + target=_blank + rel=noopener)"`, `"page pane renders a group label above the grid — default 'Docs', adapter-overridable to 'Pages'"` — keep every assertion, just delete their `global.customJS = { BeaconCards... }` setup lines and matching `delete global.customJS` where no other stub is needed (or set `global.customJS = {}`). IMPORTANT: those tests currently pass zero pages AND zero sections — with the new empty-leaf behavior the pane still renders (label + links row + empty box), so their existing assertions keep holding; the "page pane renders a group label" test asserts the label with `pages` non-empty already.

- [ ] **Step 2: Run to verify the rewritten tests fail**

Run: `node platform/test/run-section-explorer.js`
Expected: FAIL on "page pane renders mechanism-owned doc cards" (`BeaconCards must NOT be called` — currently 1 call) and on the empty-leaf rewrite (`expected the mechanism-owned empty-state box`).

- [ ] **Step 3: Implement — replace the BeaconCards tail of `_renderPagePane` with own cards**

In `section-explorer.js`, replace `_renderPagePane`'s grid section (everything from the `if (typeof customJS === "undefined" || !customJS.BeaconCards ...)` guard down through the `customJS.BeaconCards.render(...)` call) with:

```js
    pane.createEl("div", { cls: "se-group-label se-pane-label", text: adapter.pageLabel || "Docs" });
    const cards = (Array.isArray(pages) ? pages : Array.from(pages || [])).map((p) => this._docCardModel(p));
    this._renderDocCards(pane, adapter, cards);
```

and add three new methods:

```js
  // Normalize a Dataview page into the doc-card model {title, path, mtime, where}.
  _docCardModel(p) {
    return {
      title: (p && p.title) || (p && p.file && p.file.name) || "",
      path: (p && p.file && p.file.path) || "",
      mtime: (p && p.file && p.file.mtime && p.file.mtime.ts) || 0,
      where: null,
    };
  }

  // Mechanism-owned doc cards — the pane's visual language lives here (not in
  // BeaconCards) so docs read distinctly from rail section rows: each card
  // carries a bordered accent icon BADGE (the "this is a document" mark),
  // where rail rows use a flat inline folder icon.
  _renderDocCards(pane, adapter, cards) {
    if (!Array.isArray(cards) || cards.length === 0) {
      const empty = pane.createEl("div", { cls: "se-doc-empty" });
      empty.textContent = "Nothing here yet.";
      return;
    }
    const grid = pane.createEl("div", { cls: "se-doc-grid" });
    for (const c of cards) {
      const card = grid.createEl("div", { cls: "se-doc-card" });
      const icon = card.createEl("span", { cls: "se-doc-icon" });
      icon.innerHTML = adapter.icons.file || "";
      const body = card.createEl("div", { cls: "se-doc-body" });
      const title = body.createEl("div", { cls: "se-doc-title" });
      title.textContent = c.title;
      const sub = body.createEl("div", { cls: "se-doc-sub" });
      sub.textContent = this._docCardSub(c);
      card.onclick = () => {
        if (c.path) { try { app.workspace.openLinkText(c.path, "", false); } catch (_e) { /* never-throw */ } }
      };
    }
  }

  // "in <section> · 2 hours ago" (recent mode) / "edited 2 hours ago" (docs mode).
  _docCardSub(c) {
    let ago = "";
    try {
      if (c.mtime && typeof window !== "undefined" && window.moment) ago = window.moment(c.mtime).fromNow();
    } catch (_e) { /* cosmetic */ }
    if (c.where) return ago ? ("in " + c.where + " · " + ago) : ("in " + c.where);
    return ago ? ("edited " + ago) : "";
  }
```

Note the pane label line moves out of the BeaconCards guard (it must render even when `customJS` is entirely absent now — the doc cards no longer depend on it). Delete the now-unused `_makeProxyDv` from section-explorer.js ONLY IF nothing else in the file uses it (grep first — if `render`/anything still uses it, leave it).

- [ ] **Step 4: Run tests to verify green**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, exit 0. If the suppression test ("empty page pane is SUPPRESSED...") fails, it should not — suppression fires before `_renderPagePane`; investigate before proceeding.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): mechanism-owned doc cards replace BeaconCards in the pane"
```

---

### Task 2: Recent mode — `listRecent` fills the pane when a hub has no root docs

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing tests**

```js
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
```

Also UPDATE the existing v0.209.0 suppression test `"empty page pane is SUPPRESSED entirely when sections exist..."` — its adapter has no `listRecent`, so it keeps passing unchanged; verify, don't modify.

- [ ] **Step 2: Run to verify failures**

Run: `node platform/test/run-section-explorer.js`
Expected: first test FAILS ("pane must render in recent mode" — currently suppressed); third FAILS only if implementation order differs (it should pass pre-change); second PASSES (pins current behavior).

- [ ] **Step 3: Implement**

In `makeAdapter`, add after `pageLabel`:

```js
      listRecent: config.listRecent ? ((dv, ctx) => config.listRecent(dv, ctx) || []) : null,
```

In `render()`, replace the suppression block:

```js
    const pages = adapter.listPages(dv, ctx, null);
    const pageCount = Array.isArray(pages) ? pages.length : (pages && pages.length) || 0;
    if (pageCount === 0 && Array.isArray(sections) && sections.length > 0) {
      // No docs at this level, but real sections in the rail — fill the pane
      // with recently-updated docs from the subtree when the adapter provides
      // them; otherwise (no listRecent / nothing recent) suppress the pane.
      const recent = adapter.listRecent ? adapter.listRecent(dv, ctx) : [];
      if (!Array.isArray(recent) || recent.length === 0) return;
      const pane = root.createEl("div", { cls: "se-page-pane" });
      this._renderRecentPane(dv, adapter, ctx, recent, pane);
      return;
    }

    const pane = root.createEl("div", { cls: "se-page-pane" });
    this._renderPagePane(dv, adapter, ctx, null, pages, pane);
```

New method:

```js
  // Recent mode — a hub/section with zero direct docs shows the subtree's
  // recently-updated docs instead of an empty pane. Links row still renders
  // (the hub's own pinned links stay reachable), then the recent card grid.
  _renderRecentPane(dv, adapter, ctx, recent, pane) {
    this._renderLinksRow(adapter, ctx, pane);
    pane.createEl("div", { cls: "se-group-label se-pane-label", text: "Recently updated" });
    this._renderDocCards(pane, adapter, recent);
  }
```

Extract the links-row block from `_renderPagePane` into a shared `_renderLinksRow(adapter, target, pane)` (identical logic: `adapter.getLinks(target)`, `se-links-row`, `se-link-chip`, `_isSafeUrl`) and call it from both `_renderPagePane` (passing `section || ctx`) and `_renderRecentPane` (passing `ctx`).

- [ ] **Step 4: Run tests**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): recent mode — listRecent fills the pane when a hub has no root docs"
```

---

### Task 3: Wire `listRecent` into all three adapters; delete WikiTree's own Recently-Updated grid

**Files:**
- Modify: `platform/blueprints/wiki/helpers/wiki-tree.js`
- Modify: `platform/blueprints/project/helpers/project-docs-index.js`
- Modify: `platform/blueprints/project/helpers/section-hub.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing tests**

```js
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
    pages: (q) => { const arr = pages.slice(); arr.array = () => arr; return arr; },
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
```

- [ ] **Step 2: Run to verify failures**

Run: `node platform/test/run-section-explorer.js`
Expected: all four FAIL (`listRecent` undefined; "Recently updated" still present in wiki-tree.js).

- [ ] **Step 3: Implement**

**wiki-tree.js** — add to the config object returned by `_buildConfig` (after `pageLabel: "Pages",`); note `scopePath` is already in the method's closure:

```js
            // Recent mode for the pane: recent wiki-pages across THIS scope's
            // subtree (hub = whole wiki; section = its own subtree), each tagged
            // with the section it lives in. Replaces the hub-only grid WikiTree
            // used to draw below SectionExplorer.
            listRecent: (dv2, ctx) => {
                try {
                    const rawPages = dv2.pages('"' + ctx.scopePath + '"');
                    const all = rawPages.array ? rawPages.array() : Array.from(rawPages);
                    const sectionByFolder = {};
                    for (const p of all) {
                        if (p && p.type === "wiki-section" && p.file && p.file.path) {
                            const f = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                            sectionByFolder[f] = (p.title && String(p.title).trim()) || p.file.path.slice(p.file.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
                        }
                    }
                    return this._recentPages(all, 8).map((p) => {
                        const f = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                        const where = (f && f !== ctx.scopePath) ? (sectionByFolder[f] || f.slice(f.lastIndexOf("/") + 1)) : "";
                        return {
                            title: p.title || p.file.name,
                            path: p.file.path,
                            mtime: (p.file.mtime && p.file.mtime.ts) || 0,
                            where: where || null,
                        };
                    });
                } catch (_e) { return []; }
            },
```

Then DELETE the entire `if (cur.type === "wiki-hub") { ... }` Recently-Updated block from `_renderResults` (the block starting with the `// Recently updated — hub only.` comment through its closing brace). If `_makeProxyDv` and/or the `proxyDv` local in `_renderResults` become unused for the browse path, keep them ONLY if the search path still uses them (it does — `_renderSearchResults(dv, proxyDv, ...)`); just delete the dead hub block.

**project-docs-index.js** — add to `_buildConfig`'s returned config (after `rootClass`):

```js
      // Recent mode: recent doc-notes across the whole docs subtree, each
      // tagged with its section-hub display title.
      listRecent: (dv2) => {
        try {
          const rawPages = dv2.pages(`"${docsFolder}"`);
          const all = rawPages.array ? rawPages.array() : Array.from(rawPages);
          const sectionByFolder = {};
          for (const p of all) {
            if (p && p.type === "section-hub" && p.file && p.file.path) {
              const f = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
              const label = this._stripLink(p.section) || (p.file.name ? String(p.file.name).replace(/\.md$/, "") : "");
              if (label) sectionByFolder[f] = label;
            }
          }
          return all
            .filter((p) => p && p.type === "doc-note" && p.file && p.file.path)
            .sort((a, b) => ((b.file.mtime && b.file.mtime.ts) || 0) - ((a.file.mtime && a.file.mtime.ts) || 0))
            .slice(0, 8)
            .map((p) => {
              const f = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
              return {
                title: p.title || p.file.name,
                path: p.file.path,
                mtime: (p.file.mtime && p.file.mtime.ts) || 0,
                where: (f !== docsFolder ? (sectionByFolder[f] || f.slice(f.lastIndexOf("/") + 1)) : null),
              };
            });
        } catch (_e) { return []; }
      },
```

**section-hub.js** — same shape, scoped to the section (add after `rootClass` in its `_buildConfig` config; `sectionPath` is in closure):

```js
      // Recent mode: recent doc-notes across THIS section's subtree.
      listRecent: (dv2) => {
        try {
          const rawPages = dv2.pages(`"${sectionPath}"`);
          const all = rawPages.array ? rawPages.array() : Array.from(rawPages);
          const sectionByFolder = {};
          for (const p of all) {
            if (p && p.type === "section-hub" && p.file && p.file.path) {
              const f = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
              const label = this._stripLink(p.section) || (p.file.name ? String(p.file.name).replace(/\.md$/, "") : "");
              if (label) sectionByFolder[f] = label;
            }
          }
          return all
            .filter((p) => p && p.type === "doc-note" && p.file && p.file.path)
            .sort((a, b) => ((b.file.mtime && b.file.mtime.ts) || 0) - ((a.file.mtime && a.file.mtime.ts) || 0))
            .slice(0, 8)
            .map((p) => {
              const f = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
              return {
                title: p.title || p.file.name,
                path: p.file.path,
                mtime: (p.file.mtime && p.file.mtime.ts) || 0,
                where: (f !== sectionPath ? (sectionByFolder[f] || f.slice(f.lastIndexOf("/") + 1)) : null),
              };
            });
        } catch (_e) { return []; }
      },
```

- [ ] **Step 4: Run tests**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS. The two class-shaped-dv REGRESSION tests must still pass (WikiTree one previously relied on the hub grid NOT interfering — re-check it doesn't assert on Recently-Updated).

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/wiki/helpers/wiki-tree.js platform/blueprints/project/helpers/project-docs-index.js platform/blueprints/project/helpers/section-hub.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): listRecent adapters — wiki/docs-hub/section-hub recent docs; retire WikiTree's own grid"
```

---

### Task 4: `renderNoteLinks` — leaf-note pinned links + Add-link button

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing tests**

```js
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
  const good = cards.find((c) => c.textContent.includes("Grafana"));
  assert.strictEqual(good.href, "https://grafana.example.com");
  assert.strictEqual(good.target, "_blank");
  assert.ok(String(good.rel).includes("noopener"));
  const evil = cards.find((c) => c.textContent.includes("evil"));
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
```

- [ ] **Step 2: Run to verify failures**

Run: `node platform/test/run-section-explorer.js`
Expected: `TypeError: se.renderNoteLinks is not a function` (×3) and `se._noteSelfAdapter is not a function`.

- [ ] **Step 3: Implement — add to `section-explorer.js`**

```js
  // ── renderNoteLinks — pinned links on a LEAF note (wiki-page / doc-note).
  // Called by WikiChromeBar/ProjectChromeBar right after the bar renders, so
  // every existing note gets the feature with zero body migration. Renders the
  // note's frontmatter links[] as clickable cards plus an always-present
  // "＋ Add link" pill that reuses the existing add-link modal, writing back to
  // THIS note via processFrontMatter (creates the links key on first write).
  renderNoteLinks(dv) {
    try {
      const container = (dv && dv.container) ? dv.container : dv;
      if (!container || typeof container.createEl !== "function") return;
      // RenderSafe overlays partial cold-load pages when available (v0.200.1).
      let page = null;
      try {
        if (typeof customJS !== "undefined" && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function") {
          page = customJS.RenderSafe.page(dv);
        }
      } catch (_e) { page = null; }
      if (!page) { try { page = dv.current ? dv.current() : null; } catch (_e) { page = null; } }
      if (!page || !page.file || !page.file.path) return;

      const strip = container.createEl("div", { cls: "se-note-links" });
      const links = Array.isArray(page.links) ? page.links : [];
      const linkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
      for (const link of links) {
        if (!link || !link.url) continue;
        const a = strip.createEl("a", { cls: "se-note-link-card" });
        a.innerHTML = linkIcon + `<span class="se-note-link-text">${this._escape(link.text || link.url)}</span>`;
        if (this._isSafeUrl(link.url)) {
          a.href = link.url;
          a.target = "_blank";
          a.rel = "noopener";
        }
      }
      const add = strip.createEl("span", { cls: "se-note-link-add" });
      add.textContent = "＋ Add link";
      const noteAdapter = this._noteSelfAdapter(page);
      add.onclick = () => this._openAddLinkForm(dv, noteAdapter, null);
    } catch (_e) { /* never-throw */ }
  }

  // Self-adapter for the CURRENT note — the minimal getLinks/writeLinks surface
  // _openAddLinkForm needs, bound to this note's own frontmatter.
  _noteSelfAdapter(page) {
    const notePath = page.file.path;
    return {
      getLinks: () => (Array.isArray(page.links) ? page.links : []),
      writeLinks: (_target, links) => {
        try {
          const f = app.vault.getAbstractFileByPath(notePath);
          if (!f) return Promise.resolve();
          return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
        } catch (_e) { return Promise.resolve(); }
      },
    };
  }
```

Note `_openAddLinkForm(dv, adapter, section)` already calls `adapter.getLinks(section)` / `adapter.writeLinks(section, links)` — the self-adapter ignores the `section` arg, so no mechanism change is needed there.

- [ ] **Step 4: Run tests**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "feat(section-explorer): renderNoteLinks — pinned links + Add-link on leaf notes"
```

---

### Task 5: Chrome-bar hooks (wiki-page / doc-note) + manifests + schema entry

**Files:**
- Modify: `platform/blueprints/wiki/helpers/wiki-chrome-bar.js`
- Modify: `platform/blueprints/project/helpers/project-chrome-bar.js`
- Modify: `platform/blueprints/wiki/manifest.json`, `platform/blueprints/project/manifest.json`
- Modify: `platform/schemas-index.json`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing tests**

```js
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
  const bar = new WikiChromeBar();
  const mk = (type) => ({ container: { createEl: () => ({}) }, current: () => ({ type, file: { path: "p.md" } }) });
  bar.render(mk("wiki-page"));
  assert.strictEqual(calls.length, 1, "wiki-page must trigger renderNoteLinks");
  bar.render(mk("wiki-hub"));
  bar.render(mk("wiki-section"));
  assert.strictEqual(calls.length, 1, "hubs/sections must NOT trigger renderNoteLinks");
  delete global.customJS;
});

failures += !run("ProjectChromeBar.render calls SectionExplorer.renderNoteLinks on doc-note only", async () => {
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
  const bar = new ProjectChromeBar();
  const mk = (type, path2) => ({ container: { createEl: () => ({}) }, current: () => ({ type, file: { path: path2, folder: path2.slice(0, path2.lastIndexOf("/")) } }) });
  await bar.render(mk("doc-note", "spice/projects/foo/docs/knowledge/D.md"));
  assert.strictEqual(calls.length, 1, "doc-note must trigger renderNoteLinks");
  await bar.render(mk("docs-hub", "spice/projects/foo/docs/Docs.md"));
  await bar.render(mk("section-hub", "spice/projects/foo/docs/k/K.md"));
  assert.strictEqual(calls.length, 1, "hubs must NOT trigger renderNoteLinks");
  delete global.customJS;
});

failures += !run("wiki + project blueprint manifests declare depends_on section-explorer", () => {
  for (const bp of ["wiki", "project"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, `../blueprints/${bp}/manifest.json`), "utf8"));
    const dep = (manifest.depends_on || []).find((d) => d.name === "section-explorer");
    assert.ok(dep, bp + " manifest must depend on section-explorer");
    assert.ok(dep.range, bp + " dep must declare a range");
  }
});
```

Note the async test: change the harness `run(name, fn)` helper minimally so it awaits promises — replace its body with:

```js
function run(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      // Async test: resolve synchronously via deasync-free trick — collect and
      // check at exit. Simpler: make run async-aware by returning the promise.
      return r.then(() => { console.log("PASS " + name); return true; })
              .catch((e) => { console.log("FAIL " + name + " — " + e.message); return false; });
    }
    console.log("PASS " + name);
    return true;
  } catch (e) {
    console.log("FAIL " + name + " — " + e.message);
    return false;
  }
}
```

That makes `run` return a Promise for async fns — which breaks `failures += !run(...)` arithmetic. AVOID the complication: make the ProjectChromeBar test synchronous instead — `bar.render(...)` returns a promise but the hook must fire BEFORE the first await-on-ChromeBar returns; to keep it simple, call `bar.render(...)` and then assert inside `.then` is NOT needed if the implementation calls renderNoteLinks synchronously before awaiting ChromeBar.render. Implement the hook so `renderNoteLinks` is invoked synchronously (before `await customJS.ChromeBar.render(...)` resolves — i.e., place the hook AFTER the `await` completes... which is async). SIMPLEST CORRECT SHAPE: place the hook BEFORE the `await` in `ProjectChromeBar.render` — links strip renders above the bar? No: order matters visually (bar first, links under it).

**Resolution (do exactly this):** keep the hook AFTER the await in `ProjectChromeBar.render`, and write the test with a manual promise-drain: since `run()` is sync, do:

```js
failures += !run("ProjectChromeBar.render calls SectionExplorer.renderNoteLinks on doc-note only", () => {
  const src = fs.readFileSync(path.join(__dirname, "../blueprints/project/helpers/project-chrome-bar.js"), "utf8");
  const factory = new Function("module", "exports", src + "\nmodule.exports = ProjectChromeBar;");
  const mod = { exports: {} };
  factory(mod, mod.exports);
  const ProjectChromeBar = mod.exports;
  const calls = [];
  global.customJS = {
    ChromeBar: { makeAdapter: (c) => c, render: () => {} },   // render returns undefined — await resolves on the microtask queue
    SectionExplorer: { renderNoteLinks: (dv) => calls.push(dv) },
  };
  const bar = new ProjectChromeBar();
  const mk = (type, path2) => ({ container: { createEl: () => ({}) }, current: () => ({ type, file: { path: path2, folder: path2.slice(0, path2.lastIndexOf("/")) } }) });
  const drain = () => new Promise((r) => setImmediate(r));
  // Synchronous harness + async render: kick all three renders, then assert
  // after the microtask/macrotask queue drains, via a self-managed flag the
  // outer sync test can read — use execSync-free busy assertion:
  let done = false; let err = null;
  (async () => {
    try {
      await bar.render(mk("doc-note", "spice/projects/foo/docs/knowledge/D.md"));
      await drain();
      assert.strictEqual(calls.length, 1, "doc-note must trigger renderNoteLinks");
      await bar.render(mk("docs-hub", "spice/projects/foo/docs/Docs.md"));
      await bar.render(mk("section-hub", "spice/projects/foo/docs/k/K.md"));
      await drain();
      assert.strictEqual(calls.length, 1, "hubs must NOT trigger renderNoteLinks");
    } catch (e) { err = e; }
    done = true;
  })();
  require("deasync-loop"); // ← NOT AVAILABLE. See below.
});
```

`deasync` is not available. **Final resolution — restructure the harness tail instead (do exactly this):** move `process.exit` behind an async main. At the bottom of `run-section-explorer.js`, replace:

```js
process.exit(failures > 0 ? 1 : 0);
```

with:

```js
// Async tail — a handful of tests exercise async render paths (ProjectChromeBar).
// They queue themselves here; everything above stays synchronous.
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
```

and declare `const ASYNC_TESTS = [];` near the top (after `let failures = 0;`). The ProjectChromeBar test is then registered as:

```js
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
```

(The WikiChromeBar test stays synchronous — its `render` is not async.) NOTE: if `ProjectChromeBar._adapter()`/`detect` needs more page fields than the `mk` stub provides, extend the stub minimally until `render` reaches the post-bar hook (read the real `_adapter`/`detect` first; the hook itself must be independent of detect succeeding — implement it to run for `doc-note` even if ChromeBar's own render bails, by reading the page type directly in `render`).

- [ ] **Step 2: Run to verify failures**

Run: `node platform/test/run-section-explorer.js`
Expected: WikiChromeBar test FAILS (0 calls), ProjectChromeBar async test FAILS, manifest test FAILS (no dep entries).

- [ ] **Step 3: Implement**

**wiki-chrome-bar.js `render`:**

```js
  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      const result = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
      this._renderNoteLinks(dv);
      return result;
    } catch (_e) { /* never throw */ }
  }

  // Leaf-note pinned links (v0.210): wiki-page notes get their links[] strip +
  // "＋ Add link" pill right under the bar, via the shared SectionExplorer
  // helper. Cold-load-guarded; hubs/sections render theirs in the explorer pane.
  _renderNoteLinks(dv) {
    try {
      let page = null;
      try { page = dv && dv.current ? dv.current() : null; } catch (_e) { page = null; }
      if (!page || page.type !== "wiki-page") return;
      if (typeof customJS === "undefined" || !customJS.SectionExplorer
        || typeof customJS.SectionExplorer.renderNoteLinks !== "function") return;
      customJS.SectionExplorer.renderNoteLinks(dv);
    } catch (_e) { /* never throw */ }
  }
```

**project-chrome-bar.js `render`:** same pattern, gated on `page.type === "doc-note"`, after the awaited bar:

```js
  async render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.render !== "function") return;
      const result = await customJS.ChromeBar.render(dv, this._adapter());
      this._renderNoteLinks(dv);
      return result;
    } catch (_e) { /* never throw */ }
  }

  // Leaf-note pinned links (v0.210): doc-notes get their links[] strip +
  // "＋ Add link" pill right under the bar via the shared SectionExplorer helper.
  _renderNoteLinks(dv) {
    try {
      let page = null;
      try { page = dv && dv.current ? dv.current() : null; } catch (_e) { page = null; }
      if (!page || page.type !== "doc-note") return;
      if (typeof customJS === "undefined" || !customJS.SectionExplorer
        || typeof customJS.SectionExplorer.renderNoteLinks !== "function") return;
      customJS.SectionExplorer.renderNoteLinks(dv);
    } catch (_e) { /* never throw */ }
  }
```

**Manifests:** append to BOTH `platform/blueprints/wiki/manifest.json` and `platform/blueprints/project/manifest.json` `depends_on` arrays (range only — do NOT touch any `version:` fields):

```json
    {
      "name": "section-explorer",
      "range": ">=0.3.0"
    }
```

**schemas-index.json:** in the `section-explorer-links-frontmatter` entry, append `"platform/blueprints/wiki/helpers/wiki-chrome-bar.js"` and `"platform/blueprints/project/helpers/project-chrome-bar.js"` to `consumers[]`, and extend the `notes` string to state that v0.210 extends the contract to leaf types `wiki-page` and `doc-note` (rendered via `SectionExplorer.renderNoteLinks`, `links` key created lazily on first write — no backfill heal).

- [ ] **Step 4: Run tests + schema lint**

Run: `node platform/test/run-section-explorer.js` → all PASS.
Run: `node scripts/lint-schemas.js` → exit 0.
Run: `node scripts/check-version-sync.js` → exit 0 (ranges only, no version edits).

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/wiki/helpers/wiki-chrome-bar.js platform/blueprints/project/helpers/project-chrome-bar.js platform/blueprints/wiki/manifest.json platform/blueprints/project/manifest.json platform/schemas-index.json platform/test/run-section-explorer.js
git commit -m "feat(wiki,project): leaf-note pinned links via chrome-bar hook + depends_on section-explorer"
```

---

### Task 6: CSS — doc cards, pane divider, rail air, title wrap, note-links strip

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.css`

- [ ] **Step 1: Apply the CSS**

**(a)** Rail air: `.se-rail-cards { gap: 4px }` → `gap: 12px`.

**(b)** Title wrap — replace `.se-rail-title-text`:

```css
.se-rail-title-text {
  font-size: 0.95em;
  line-height: 1.3;
  white-space: normal;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

**(c)** Doc cards + pane divider (add after the `.se-pane-label` rule):

```css
/* ── Doc cards — the pane's own card language. The bordered accent icon badge
 * is the "this is a document" identity mark; section rows use a flat inline
 * folder icon, so the two read differently at a glance. ─────────────────── */
.se-doc-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 8px;
}
.se-root.se-mobile .se-doc-grid { grid-template-columns: 1fr; }

.se-doc-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  transition: transform 0.15s var(--se-ease), box-shadow 0.15s var(--se-ease), border-color 0.15s var(--se-ease);
}
.se-doc-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.18);
  border-color: var(--interactive-accent);
}
.se-doc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid var(--background-modifier-border);
  color: var(--interactive-accent);
  background: var(--background-primary);
}
.se-doc-icon svg { width: 15px; height: 15px; }
.se-doc-body { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
.se-doc-title {
  font-weight: 600;
  color: var(--text-normal);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.se-doc-sub {
  font-size: 0.78em;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.se-doc-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-faint);
  font-style: italic;
  border: 1px dashed var(--background-modifier-border);
  border-radius: 8px;
  margin-top: 8px;
}

/* Desktop rail | pane separation. */
@media (min-width: 721px) {
  .se-root:not(.se-mobile) > .se-page-pane {
    border-left: 1px solid var(--background-modifier-border);
    padding-left: 18px;
  }
}
```

**(d)** Note-links strip (leaf notes; classes render OUTSIDE .se-root, so these rules are top-level in the snippet — fine, they're all `se-`-prefixed):

```css
/* ── Leaf-note pinned links (renderNoteLinks) ────────────────────────────── */
.se-note-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 10px 0 4px 0;
}
.se-note-link-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 0.85em;
  font-weight: 500;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  color: var(--text-normal);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.se-note-link-card svg { color: var(--interactive-accent); flex-shrink: 0; }
.se-note-link-card[href]:hover {
  background: var(--background-modifier-hover);
  border-color: var(--interactive-accent);
}
.se-note-link-card:not([href]) { color: var(--text-faint); cursor: default; }
.se-note-link-add {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 0.8em;
  font-weight: 500;
  color: var(--text-muted);
  border: 1px dashed var(--background-modifier-border);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.se-note-link-add:hover {
  color: var(--text-normal);
  border-color: var(--interactive-accent);
}
```

Note: `--se-ease` is defined on `.se-root` — the doc-card rules live under `.se-root` descendants so it resolves; the `.se-note-*` rules use plain `ease` (they render outside `.se-root`).

- [ ] **Step 2: Suite still green**

Run: `node platform/test/run-section-explorer.js` → all PASS.

- [ ] **Step 3: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.css
git commit -m "feat(section-explorer): CSS — doc-card identity, pane divider, rail air, 2-line titles, note-links strip"
```

---

### Task 7: Visual harness verification + full preflight

Same procedure as the v0.209.0 cycle (build a faithful static HTML replica in `/tmp/se-harness2/`, inline the FULL new CSS + dark-theme var stand-ins, serve via `python3 -m http.server 8932`, Playwright-screenshot desktop + 390×844):

- [ ] **Step 1:** Harness DOM must include: rail with a LONG title row ("Microservice Deployment Standardization" — verify it WRAPS to 2 lines, no ellipsis mid-word at typical rail width), 12px row gaps visible, pane with left divider + "Recently updated" label + 4 `se-doc-card`s (icon badge + title + "in Knowledge · 2 hours ago" subs), plus a standalone `.se-note-links` strip (2 link cards + the dashed "＋ Add link" pill) to preview the leaf-note feature. Include a second `.se-root.se-mobile` copy.
- [ ] **Step 2:** LOOK at the screenshots. Verify: doc cards read clearly distinct from rail rows (badge + border + shadow vs flat rows); divider visible; wrap works; air feels right. Adjust the REAL CSS if not, rebuild, re-shoot. Kill the server.
- [ ] **Step 3:** `npm run release:preflight` (600000ms timeout) → exit 0. STOP + report if an unrelated test fails.
- [ ] **Step 4:** Commit any CSS polish as `fix(section-explorer): visual polish from harness verification`.

---

### Task 8: PR → CI green → merge

- [ ] `git fetch origin && git merge origin/main --no-edit` (re-run the suite if anything merged), `git push -u origin feature/section-explorer-polish`.
- [ ] `gh pr create` — title `feat(section-explorer): recent-docs pane, doc-card identity, rail polish + leaf-note pinned links`; body summarizing the five changes (recent pane replaces suppression + WikiTree grid move; mechanism-owned doc cards; title wrap + rail air; renderNoteLinks via chrome bars, zero migration; manifests depends_on + schema contract extension) with the design/plan doc paths and the test plan; end with the Claude Code attribution footer.
- [ ] `gh pr checks <n> --watch` until green (verify with `rtk proxy gh pr checks <n> | cat` that every check is pass/skipping), then `gh pr merge <n> --squash`. Do NOT touch the release PR.

---

### Task 9: Release watch + deploy + verify

- [ ] Watch for the auto release PR (`release/next`) to open and merge, then the tag: `git ls-remote --tags origin "v0.2*" | tail -2`. Then the tap PR auto-merge: `rtk proxy gh pr list -R willfell/homebrew-sauce --state all --limit 2 | cat`.
- [ ] `brew update && brew upgrade sauce` (verify new version in the upgrade output).
- [ ] `bash -c "cd /Users/willfellhoelter/notes/sauce/<vault> && /opt/homebrew/bin/sauce update --bump-pins"` for accuris-sauce, headspace-sauce, ero-sauce — each must end `clean run — exit 0`. NEVER run from the workshop worktree.
- [ ] Verify per vault: `grep -c "renderNoteLinks" ranch/scripts/section-explorer/section-explorer.js` ≥1; `grep -c "listRecent" ranch/scripts/wiki/wiki-tree.js` ≥1; `grep -c "_renderNoteLinks" ranch/scripts/wiki/wiki-chrome-bar.js` ≥1 and same for `ranch/scripts/project/project-chrome-bar.js`; `grep -c "se-doc-card" .obsidian/snippets/sauce-section-explorer.css` ≥1; `grep -c "Recently updated" ranch/scripts/wiki/wiki-tree.js` = 0.
- [ ] Report: PR #, version, deploy + verify status per vault, Cmd+R reminder.
