# SectionExplorer Move-Section + Select-Docs Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two runtime SectionExplorer bugs — Move Section ENOENT crash, and Select Docs silent no-op — by making `moveSection` async + path-remapping, and replacing the fragile in-place select-mode pane flip with a modal doc picker.

**Architecture:** `moveSection` (mechanism) becomes `async`: it builds the patch plan before the rename, awaits the folder rename, then remaps every old-folder path to the new folder and only patches frontmatter on real `TFile`s (never fabricated `{path}` objects). Select-docs becomes a modal picker (`openSelectDocsPicker`) that enumerates direct docs dv-independently via `pagesUnder` (metadataCache, mobile-safe), lists them with checkboxes in the existing `_openModal` chassis, and moves the checked set through the existing `openMovePicker` → `planBulkMove` → `applyDocMove` flow. Both chrome bars rewire their `select-docs` dispatch to the new method using their existing `{adapter, section}` resolvers.

**Tech Stack:** customJS (Obsidian, plain-JS class instances, never-throw), Node `assert`-based test runners in `platform/test/`, `npm run` preflight scripts.

**Design spec:** `docs/superpowers/specs/2026-07-13-sectionexplorer-move-select-fix-design.md`

---

## Background the implementer needs

- **customJS quirk:** the file defines `class SectionExplorer {…}`; customJS stores an **instance**. Statics are referenced by the class name (`SectionExplorer.planBulkMove(...)`) which is in lexical scope inside the class body. Every method is `never-throw` (wrapped in `try/catch (_e) {}`) and cold-load-safe.
- **`pagesUnder(rootFolder)`** (static, `section-explorer.js:124`) enumerates markdown files under a folder via `app.metadataCache` — dv-independent, so it is safe to call at dispatch/click time on mobile (unlike a captured `dv.pages()`). Returns Dataview-page-like objects: `{ type, title, section, sub_section, depth, links, file: { path, folder, name } }`.
- **`_openModal(className, buildFn)`** (`section-explorer.js:~461`) mounts an overlay+panel, calls `buildFn(panel, close, doc)`. In tests, `doc` is `makeDocStub()` (`run-section-explorer.js:352`) whose `createElement(tag)` returns **bare nodes with `appendChild` but NO `createEl`**. Therefore the modal body must be built with `doc.createElement(...)` + `appendChild(...)`, **not** `pane.createEl(...)`. (In real Obsidian `createEl` exists on the prototype, but we build with `createElement` for test parity — same pattern `openMovePicker` uses.)
- **`_modalTitle(doc, panel, text)`** and **`_modalButtons(doc, panel, close, primaryLabel, onPrimary)`** are existing helpers; `_modalButtons` returns `{ cancel, primary }` (both `doc.createElement("button")`).
- **`planBulkMove(selectedPaths, targetFolder)`** (static, `section-explorer.js:~79`) returns `{ moves: [{from,to}], skipped: [{path,reason}] }`.
- **`applyDocMove(dv, {path}, destFolder, adapter)`** (`section-explorer.js:784`) moves one doc (works today — leave untouched).
- **Chrome-bar resolvers:** `WikiChromeBar._wikiAdapterAndSection(dv)` (`wiki-chrome-bar.js:53`) returns `{ adapter, section }` on **any** wiki surface (hub or section) — `section.folder` is the current note's folder (root `spice/wiki` on the hub). `ProjectChromeBar._projAdapterAndSection(dv)` (`project-chrome-bar.js:615`) returns `{ SE, adapter, section }` and only fires on `type === "section-hub"` (the only project surface that offers `select-docs`).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `platform/mechanisms/section-explorer/section-explorer.js` | shared navigator + move/select logic | rewrite `moveSection` (async); add `openSelectDocsPicker`; delete `enterSelectMode`, `_enterSelectModeOnPane`, and the pane `__seCtx`/`__seEnterSelectMode` stashes |
| `platform/mechanisms/section-explorer/section-explorer.css` | mechanism styles | drop `.se-select-bar` / `.se-select-move-btn` (dead once select mode is modal) |
| `platform/blueprints/project/helpers/section-hub.js` | project move block | add `docType: "doc-note"` to the `move` block |
| `platform/blueprints/wiki/helpers/wiki-tree.js` | wiki move block | add `docType: "wiki-page"` to the `move` block |
| `platform/blueprints/project/helpers/project-chrome-bar.js` | project dispatch | `select-docs` → `openSelectDocsPicker` |
| `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` | wiki dispatch | `select-docs` → `openSelectDocsPicker` |
| `platform/test/run-section-explorer.js` | mechanism tests | replace `enterSelectMode` test; add async `moveSection` test + `openSelectDocsPicker` test |
| `platform/test/run-wiki-chrome-bar.js` | wiki dispatch test | update `select-docs` dispatch assertion |
| `platform/test/run-project-chrome-bar.js` | project dispatch test | update `select-docs` dispatch assertion |

---

## Task 1: Add `docType` to both move blocks

**Files:**
- Modify: `platform/blueprints/project/helpers/section-hub.js` (the `move:` block, near line 242-245)
- Modify: `platform/blueprints/wiki/helpers/wiki-tree.js` (the `move:` block, near line 232-237)

- [ ] **Step 1: Add `docType` to the project move block**

In `section-hub.js`, find the `move` block header (currently starts with `root: docsRoot,` / `sectionType: "section-hub",` / `rootLabel: "Docs (root)",`). Add a `docType` line:

```js
      move: {
        root: docsRoot,
        sectionType: "section-hub",
        docType: "doc-note",
        rootLabel: "Docs (root)",
```

- [ ] **Step 2: Add `docType` to the wiki move block**

In `wiki-tree.js`, find the `move` block (contains `enumerateSectionTargets`, `rewriteOnDocMove: () => null`, `rewriteOnSectionMove: () => null`, `canAcceptSection: () => true`). Add `docType: "wiki-page"` alongside its `root`/`sectionType` keys. Concretely, locate the object literal that holds those keys and add:

```js
        docType: "wiki-page",
```

(Place it next to the existing `sectionType` key in that same `move` object. If the wiki move block does not currently set `root`/`sectionType` inline, add `docType: "wiki-page"` as a sibling of `enumerateSectionTargets`.)

- [ ] **Step 3: Verify nothing broke**

Run: `node platform/test/run-section-explorer.js && node platform/test/run-wiki.js`
Expected: all PASS (adding a key is additive; `makeAdapter` forwards the whole `move` block).

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/project/helpers/section-hub.js platform/blueprints/wiki/helpers/wiki-tree.js
git commit -m "feat(section-explorer): expose docType on wiki+project move blocks"
```

---

## Task 2: Rewrite `moveSection` async (Bug 2 — ENOENT)

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js:807-839`
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

Append this async test near the other move/section tests in `run-section-explorer.js`. It registers into `ASYNC_TESTS` (the file runs those in an async tail before `process.exit`). It builds a fake vault whose `renameFile` moves a folder + all descendants in a path map, and whose `processFrontMatter` **throws ENOENT for any file object not currently in the map** — exactly reproducing the bug when the old code passes fabricated `{path}` objects or stale old paths.

```js
ASYNC_TESTS.push({ name: "moveSection: awaits rename, remaps hub+child to NEW paths, never reads OLD paths (ENOENT bug)", fn: async () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();

  // Fake vault: map of path -> file object. A folder rename moves the folder
  // and every descendant path (old prefix -> new prefix).
  const OLD = "spice/projects/p/docs/a";
  const HUB = OLD + "/A.md";
  const CHILD = OLD + "/sub/Sub.md";
  const map = new Map([
    [OLD, { path: OLD, __folder: true }],
    [HUB, { path: HUB }],
    [OLD + "/sub", { path: OLD + "/sub", __folder: true }],
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
    assert.strictEqual(renameCalls[0].to, "spice/projects/p/docs/b/a", "renamed to slug of title under dest");
    const paths = fmWrites.map((w) => w.path).sort();
    assert.deepStrictEqual(paths, [
      "spice/projects/p/docs/b/a/A.md",
      "spice/projects/p/docs/b/a/sub/Sub.md",
    ], "hub + child patched at their NEW paths");
    assert.ok(fmWrites.every((w) => w.path.indexOf(OLD) !== 0), "no patch applied at an OLD path");
  } finally { global.app = prevApp; }
}});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-section-explorer.js 2>&1 | grep -i "moveSection: awaits"`
Expected: FAIL — the current synchronous `moveSection` fabricates `{ path }` for the (not-yet-present) hub and reads the OLD child path, so `processFrontMatter` throws ENOENT and/or patches land at wrong/old paths.

- [ ] **Step 3: Rewrite `moveSection`**

Replace `section-explorer.js:807-839` (the entire `moveSection(dv, section, destParentFolder, adapter) { … }` method) with:

```js
  // Move a section folder under destParentFolder. ASYNC: builds the patch plan
  // BEFORE the rename (child paths are still valid), awaits the folder rename so
  // the vault index reflects new paths, then remaps every old-folder path to the
  // new folder and patches frontmatter only on real TFiles resolved from the
  // vault — never on a fabricated { path } object (that read the old/renamed
  // path off disk → ENOENT). Wiki → null plan (folder-only).
  async moveSection(dv, section, destParentFolder, adapter) {
    try {
      if (!section || !section.folder) return;
      const oldFolder = String(section.folder).replace(/\/+$/, "");
      const newFolder = String(destParentFolder).replace(/\/+$/, "") + "/" + SectionExplorer._slugify(section.title);
      let folderFile = null;
      try { folderFile = app.vault.getAbstractFileByPath(oldFolder); } catch (_e) { folderFile = null; }
      if (!folderFile) return; // can't move a folder we can't resolve to a real file
      const mv = adapter && adapter.move;
      // Build the plan while child paths still point at the OLD folder.
      let plan = null;
      if (mv && typeof mv.rewriteOnSectionMove === "function") {
        try { plan = mv.rewriteOnSectionMove(section, destParentFolder); } catch (_e) { plan = null; }
      }
      try { await app.fileManager.renameFile(folderFile, newFolder); } catch (_e) { return; }
      if (!plan) return;
      // Old-folder prefix → new-folder prefix (only for paths under oldFolder).
      const remap = (p) => {
        const s = String(p == null ? "" : p);
        return (s === oldFolder || s.indexOf(oldFolder + "/") === 0) ? newFolder + s.slice(oldFolder.length) : s;
      };
      if (plan.hubPatch && section.hubPath) {
        try {
          const hubFile = app.vault.getAbstractFileByPath(remap(section.hubPath));
          if (hubFile) await app.fileManager.processFrontMatter(hubFile, (fm) => Object.assign(fm, plan.hubPatch));
        } catch (_e) { /* best-effort */ }
      }
      for (const cp of (plan.childPatches || [])) {
        try {
          if (!cp || !cp.path) continue;
          const cf = app.vault.getAbstractFileByPath(remap(cp.path));
          if (cf) await app.fileManager.processFrontMatter(cf, (fm) => Object.assign(fm, cp.patch || {}));
        } catch (_e) { /* best-effort */ }
      }
    } catch (_e) { /* never-throw */ }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-section-explorer.js 2>&1 | grep -i "moveSection: awaits"`
Expected: PASS.

- [ ] **Step 5: Run the whole mechanism suite**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS (no regressions; `_openMovePickerForSection`'s `onPick` calls `moveSection` fire-and-forget, which is fine for an async method).

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "fix(section-explorer): async moveSection with path remap fixes ENOENT on section move"
```

---

## Task 3: Add `openSelectDocsPicker`, remove in-place select mode (Bug 1)

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (add `openSelectDocsPicker`; delete `enterSelectMode` at `:873-890` and `_enterSelectModeOnPane` at `:892-938`; remove pane stashes in `_renderPagePane` `:270-275` and `_renderRecentPane` `:240-243`)
- Test: `platform/test/run-section-explorer.js`

- [ ] **Step 1: Write the failing test**

In `run-section-explorer.js`, **delete** the existing synchronous test titled `"enterSelectMode: finds .se-page-pane in note view even OUTSIDE dv.container …"` (it asserts a method we are removing). Replace it with this test for the new modal picker. It stubs `pagesUnder` via `global.app`, drives the modal through `makeDocStub()`, and spies `openMovePicker`/`applyDocMove` to assert the move flow:

```js
failures += !run("openSelectDocsPicker: lists direct docs as checkboxes; Move applies planBulkMove → applyDocMove for the checked set", () => {
  const SectionExplorer = loadClass();
  const se = new SectionExplorer();
  const doc = makeDocStub();

  // Direct docs under the folder + one doc in a sub-folder (must be excluded).
  const FOLDER = "spice/projects/p/docs/a";
  const prevApp = global.app;
  global.app = {
    vault: {
      getMarkdownFiles: () => ([
        { path: FOLDER + "/One.md", name: "One.md" },
        { path: FOLDER + "/Two.md", name: "Two.md" },
        { path: FOLDER + "/sub/Deep.md", name: "Deep.md" },
      ]),
    },
    metadataCache: {
      getFileCache: (f) => ({ frontmatter: { type: "doc-note", title: f.name.replace(/\.md$/, "") } }),
    },
  };

  // Spy the downstream move flow.
  const moveCalls = [];
  se.openMovePicker = (opts) => { se.__lastMoveOpts = opts; };
  se.applyDocMove = (dv, file, dest) => { moveCalls.push({ from: file.path, dest }); };

  const adapter = { move: { docType: "doc-note", root: FOLDER, enumerateSectionTargets: () => ([{ folder: "spice/projects/p/docs/b", label: "B", depth: 1 }]) } };
  const section = { folder: FOLDER };

  se.openSelectDocsPicker({}, adapter, section);

  // Modal mounted with exactly the two DIRECT docs as checkbox rows.
  const overlay = doc.body.children[0];
  assert.ok(overlay, "modal overlay mounted");
  const panel = overlay.children[0];
  const list = panel.children.find((c) => c.className === "se-select-list");
  assert.ok(list, "select list present");
  const rows = list.children.filter((c) => c.className === "se-select-row");
  assert.strictEqual(rows.length, 2, "only the 2 direct docs are listed (sub-folder doc excluded)");

  // Check both boxes, then fire the primary "Move" button.
  const checks = rows.map((r) => r.children.find((c) => c.className === "se-select-check"));
  checks.forEach((cb) => { cb.checked = true; cb.onchange(); });
  const primary = panel.children.find((c) => c.className && String(c.className).indexOf("se-modal-btn-primary") >= 0);
  assert.ok(primary, "primary Move button present");
  assert.strictEqual(primary.disabled, false, "Move enabled once docs are checked");
  primary.onclick();

  // openMovePicker was opened; drive its onPick to a destination.
  assert.ok(se.__lastMoveOpts && typeof se.__lastMoveOpts.onPick === "function", "openMovePicker opened with onPick");
  se.__lastMoveOpts.onPick("spice/projects/p/docs/b");

  const moved = moveCalls.map((m) => m.from).sort();
  assert.deepStrictEqual(moved, [FOLDER + "/One.md", FOLDER + "/Two.md"], "both checked docs moved");
  assert.ok(moveCalls.every((m) => m.dest === "spice/projects/p/docs/b"), "moved to the picked destination");

  global.app = prevApp;
  delete global.document;
});
```

Note: `makeDocStub()` sets `global.document`; call it (as above via `const doc = makeDocStub()`) before invoking. The `se-modal-btn-primary` node is created by `_modalButtons` via `doc.createElement("button")` with `className = "se-modal-btn se-modal-btn-primary"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-section-explorer.js 2>&1 | grep -i "openSelectDocsPicker"`
Expected: FAIL — `se.openSelectDocsPicker is not a function`.

- [ ] **Step 3: Add `openSelectDocsPicker`**

Insert this method into `section-explorer.js` immediately **before** the `// ── In-place select mode (Task F)` comment block (i.e. just before the current `enterSelectMode`):

```js
  // ── Select docs (modal picker) ────────────────────────────────────────────
  // Bulk-select docs directly under this surface and move the checked set.
  // Replaces the old in-place pane flip (enterSelectMode), which mutated a pane
  // owned by a DIFFERENT dataviewjs block than the chrome bar dispatching the
  // click, and silently no-op'd. Enumeration is dv-independent (pagesUnder →
  // metadataCache), so it is mobile-safe at dispatch time.
  openSelectDocsPicker(dv, adapter, section) {
    try {
      const mv = adapter && adapter.move;
      if (!mv) return;
      const folder = (section && section.folder) ? String(section.folder) : String(mv.root || "");
      if (!folder) return;
      const docType = mv.docType;
      // Direct doc children of this folder only (matches the page pane's scope).
      let docs = [];
      try {
        docs = SectionExplorer.pagesUnder(folder).filter((p) =>
          p && p.type === docType && p.file && p.file.folder === folder);
      } catch (_e) { docs = []; }
      const cards = docs.map((p) => this._docCardModel(p));
      const selected = new Set();
      this._openModal("se-select-modal-overlay", (panel, close, doc) => {
        this._modalTitle(doc, panel, "Select docs to move");
        const list = doc.createElement("div");
        list.className = "se-select-list";
        list.style.cssText = "max-height:55vh;overflow-y:auto;margin-bottom:12px;";
        panel.appendChild(list);
        if (cards.length === 0) {
          const empty = doc.createElement("div");
          empty.className = "se-select-empty";
          empty.textContent = "No docs here to move.";
          empty.style.cssText = "color:var(--text-muted);font-size:0.92em;padding:8px 2px;";
          list.appendChild(empty);
        }
        let moveBtn = null;
        const refresh = () => {
          if (!moveBtn) return;
          const n = selected.size;
          moveBtn.textContent = n ? ("Move " + n + " doc" + (n === 1 ? "" : "s") + " →") : "Move docs →";
          moveBtn.disabled = n === 0;
          try { moveBtn.style.opacity = n ? "1" : "0.5"; } catch (_e) { /* stub */ }
        };
        for (const c of cards) {
          const row = doc.createElement("label");
          row.className = "se-select-row";
          row.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;color:var(--text-normal);";
          const cb = doc.createElement("input");
          try { cb.type = "checkbox"; } catch (_e) { /* stub */ }
          cb.className = "se-select-check";
          cb.onchange = () => { if (cb.checked) selected.add(c.path); else selected.delete(c.path); refresh(); };
          const name = doc.createElement("span");
          name.className = "se-select-title";
          name.textContent = c.title || c.path;
          name.style.cssText = "flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          row.appendChild(cb);
          row.appendChild(name);
          list.appendChild(row);
        }
        const btns = this._modalButtons(doc, panel, close, "Move docs →", () => {
          if (selected.size === 0) return;
          close();
          let targets = [];
          try { targets = (typeof mv.enumerateSectionTargets === "function") ? (mv.enumerateSectionTargets(dv) || []) : []; } catch (_e) { targets = []; }
          this.openMovePicker({
            targets,
            currentFolder: folder,
            title: "Move docs to section",
            onPick: (dest) => {
              const { moves, skipped } = SectionExplorer.planBulkMove([...selected], dest);
              for (const m of moves) this.applyDocMove(dv, { path: m.from }, dest, adapter);
              try {
                const bits = ["Moved " + moves.length + " doc" + (moves.length === 1 ? "" : "s")];
                if (skipped.length) bits.push(skipped.length + " skipped");
                if (typeof Notice === "function") new Notice(bits.join("; "), 5000);
              } catch (_e) { /* notice best-effort */ }
            },
          });
        });
        moveBtn = btns && btns.primary;
        refresh();
      });
    } catch (_e) { /* never-throw */ }
  }
```

- [ ] **Step 4: Delete the old in-place select mode + pane stashes**

1. Delete the entire `enterSelectMode(dv) { … }` method (`section-explorer.js:873-890`) including its `// ── In-place select mode (Task F)` comment header.
2. Delete the entire `_enterSelectModeOnPane(pane) { … }` method (`section-explorer.js:892-938`).
3. In `_renderPagePane` (`:266-277`), remove the stash block so it reads:

```js
  _renderPagePane(dv, adapter, ctx, section, pages, pane) {
    this._renderLinksRow(adapter, section || ctx, pane);
    pane.createEl("div", { cls: "se-group-label se-pane-label", text: adapter.pageLabel || "Docs" });
    const cards = (Array.isArray(pages) ? pages : Array.from(pages || [])).map((p) => this._docCardModel(p));
    this._renderDocCards(pane, adapter, cards);
  }
```

4. In `_renderRecentPane` (`:236-245`), remove the `try { pane.__seCtx = …; pane.__seEnterSelectMode = …; } catch (_e) {}` block so it reads:

```js
  _renderRecentPane(dv, adapter, ctx, recent, pane) {
    this._renderLinksRow(adapter, ctx, pane);
    pane.createEl("div", { cls: "se-group-label se-pane-label", text: "Recently updated" });
    const cards = (Array.isArray(recent) ? recent : Array.from(recent || [])).map((p) => this._docCardModel(p));
    this._renderDocCards(pane, adapter, cards);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node platform/test/run-section-explorer.js`
Expected: all PASS, including the new `openSelectDocsPicker` test. Confirm no test still references `enterSelectMode`:
Run: `grep -c "enterSelectMode" platform/test/run-section-explorer.js`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/run-section-explorer.js
git commit -m "fix(section-explorer): modal select-docs picker replaces fragile in-place pane flip"
```

---

## Task 4: Rewire both chrome-bar dispatches + tests

**Files:**
- Modify: `platform/blueprints/wiki/helpers/wiki-chrome-bar.js:144-150`
- Modify: `platform/blueprints/project/helpers/project-chrome-bar.js:540-546`
- Test: `platform/test/run-wiki-chrome-bar.js`, `platform/test/run-project-chrome-bar.js`

- [ ] **Step 1: Update the wiki dispatch**

Replace the `if (id === "select-docs")` block in `wiki-chrome-bar.js` with:

```js
        // Bulk select docs → modal picker (mechanism-owned, mobile-safe).
        if (id === "select-docs") {
          try {
            const a = this._wikiAdapterAndSection(dv);
            if (a && customJS.SectionExplorer && typeof customJS.SectionExplorer.openSelectDocsPicker === "function") {
              customJS.SectionExplorer.openSelectDocsPicker(dv, a.adapter, a.section);
            }
          } catch (_e) { /* never-throw */ }
          return;
        }
```

- [ ] **Step 2: Update the project dispatch**

Replace the `case "select-docs":` block in `project-chrome-bar.js` with:

```js
        case "select-docs": {
          const a = this._projAdapterAndSection(dv);
          if (!a) { missing("SectionExplorer"); return; }
          if (typeof a.SE.openSelectDocsPicker === "function") { a.SE.openSelectDocsPicker(dv, a.adapter, a.section); return; }
          missing("SectionExplorer");
          return;
        }
```

- [ ] **Step 3: Update the wiki dispatch test**

In `run-wiki-chrome-bar.js`, the `select-docs` dispatch is covered by `WCB-DISPATCH-4` (~line 123) and the SE stub sets `enterSelectMode` (~line 99). Change the SE stub method and the assertion:

- Where the SE stub object is built (line ~99), replace `enterSelectMode: (dv) => calls.push({ enterSelectMode: !!dv }),` with:

```js
      openSelectDocsPicker: (dv, adapter, section) => calls.push({ selectDocs: !!dv, hasSection: !!section }),
```

- Ensure the instance's resolver returns something. Immediately before the `select-docs` dispatch calls in the test (there are two: ~line 115 and ~line 140), stub the resolver on the instance under test. Find where the WikiChromeBar instance is created in that test (the object whose `_config()`/`dispatch` is exercised) and add:

```js
  inst._wikiAdapterAndSection = () => ({ adapter: { move: { docType: "wiki-page" } }, section: { folder: "spice/wiki/cooking" } });
```

(Use the actual instance variable name in that test — likely `inst` or `wcb`. If the dispatch is invoked as `cfg.dispatch(...)` where `cfg = inst._config()`, the arrow `dispatch` closes over `inst`, so stubbing `inst._wikiAdapterAndSection` is what the handler calls.)

- Replace the `WCB-DISPATCH-4` assertion body with:

```js
  ok('WCB-DISPATCH-4 select-docs → SectionExplorer.openSelectDocsPicker(dv, adapter, section)',
    calls.some((c) => c.selectDocs === true && c.hasSection === true));
```

- [ ] **Step 4: Update the project dispatch test**

In `run-project-chrome-bar.js`, `PCB-DISPATCH-11` (~line 478-485) stubs `cjs.SectionExplorer.enterSelectMode`. Replace that block with one that stubs the resolver + new method:

```js
  // PCB-DISPATCH-11 — select-docs → SectionExplorer.openSelectDocsPicker(dv, adapter, section).
  {
    const calls = [];
    cjs.SectionExplorer.openSelectDocsPicker = (d, adapter, section) => calls.push({ d: !!d, section: !!section });
    inst._projAdapterAndSection = () => ({ SE: cjs.SectionExplorer, adapter: { move: { docType: "doc-note" } }, section: { folder: "spice/projects/p/docs/a" } });
    runDispatch(cjs, {}, () => inst._dispatch(dv, { context: 'section-hub' }, 'select-docs'));
    ok('PCB-DISPATCH-11 select-docs calls SectionExplorer.openSelectDocsPicker once with dv+section',
      calls.length === 1 && calls[0].d === true && calls[0].section === true);
  }
```

(Use the real instance variable name from that test in place of `inst` if different — it is whatever `._dispatch(...)` is called on.)

- [ ] **Step 5: Run both chrome-bar suites**

Run: `node platform/test/run-wiki-chrome-bar.js && node platform/test/run-project-chrome-bar.js`
Expected: all PASS. Then confirm no lingering references:
Run: `grep -rc "enterSelectMode" platform/ | grep -v ":0"`
Expected: no output (zero matches anywhere under `platform/`).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/wiki/helpers/wiki-chrome-bar.js platform/blueprints/project/helpers/project-chrome-bar.js platform/test/run-wiki-chrome-bar.js platform/test/run-project-chrome-bar.js
git commit -m "fix(section-explorer): route wiki+project select-docs to the modal picker"
```

---

## Task 5: CSS cleanup

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.css`

- [ ] **Step 1: Find dead select-bar rules**

Run: `grep -n "se-select-bar\|se-select-move-btn" platform/mechanisms/section-explorer/section-explorer.css`
Expected: matches for the old in-place select bar (now removed from JS).

- [ ] **Step 2: Remove those rule blocks**

Delete the CSS rule blocks for `.se-select-bar` and `.se-select-move-btn` (and any combined selectors that reference only those). Leave all other `.se-*` rules intact. The new modal rows use inline styles, so no CSS additions are required.

- [ ] **Step 3: Sync the dogfood CSS copy if one exists**

Run: `grep -rl "se-select-bar" . 2>/dev/null | grep -v node_modules`
If a deployed dogfood copy is listed (e.g. under `.obsidian/`), the installer regenerates it — do NOT hand-edit deployed copies. If ONLY the workshop `platform/.../section-explorer.css` matched originally, nothing else to do.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/section-explorer/section-explorer.css
git commit -m "chore(section-explorer): drop dead in-place select-bar CSS"
```

---

## Task 6: Full preflight + green gate

**Files:** none (verification only)

- [ ] **Step 1: Run the section/wiki/project test suites**

Run: `node platform/test/run-section-explorer.js && node platform/test/run-wiki-chrome-bar.js && node platform/test/run-project-chrome-bar.js && node platform/test/run-wiki.js`
Expected: all PASS.

- [ ] **Step 2: Run the repo preflight (whatever `package.json` defines)**

Run: `npm test --silent || npm run preflight --silent`
(Use whichever script the repo defines; check `package.json` `scripts`. If a `preflight`/`test`/`ci` script exists, run it. It must exit 0.)
Expected: exit 0, all suites green (includes seed-vault migration harness).

- [ ] **Step 3: Confirm the working tree is clean and the branch has all commits**

Run: `git status --short && git log --oneline origin/main..HEAD`
Expected: clean tree; commit list shows the design-doc, plan, and the 5 feature commits (Tasks 1–5).

- [ ] **Step 4: No further commit** (verification task).

---

## Self-review notes (author)

- **Spec coverage:** Fix 1 → Task 2; Fix 2 (`openSelectDocsPicker`) → Task 3; call-site rewiring → Task 4; `docType` on move blocks → Task 1; CSS cleanup → Task 5; tests → Tasks 2/3/4; ship prep → Task 6. All spec sections covered.
- **Deviation from spec (intentional):** the spec suggested reusing `_renderDocCards({select})` inside the modal. The modal panel is built with `doc.createElement` (no `createEl` in the test stub), so the modal renders its own lightweight checkbox rows instead. Same UX intent, cleaner test surface, no change to the shared `_renderDocCards` signature. The now-dormant `select` branch of `_renderDocCards` is left in place (minimal-diff; harmless).
- **Type consistency:** `openSelectDocsPicker(dv, adapter, section)` everywhere; reads `adapter.move.docType` / `adapter.move.root` / `adapter.move.enumerateSectionTargets`; `moveSection` stays `(dv, section, destParentFolder, adapter)` and is now `async`; `planBulkMove(paths, dest)` and `applyDocMove(dv, {path}, dest, adapter)` unchanged.
- **No placeholders:** every code + test block is complete. The only "find the instance variable name" note (Task 4 tests) is a mechanical local lookup, not a design gap.

## Ship (after all tasks green — handled outside this plan by the operator)

Push branch → open PR to `main` → wait for CI green → merge → automated release pipeline bumps semver, opens + auto-merges the release PR, tags, ships to brew → tap PR opens → merge tap PR → `brew update && brew upgrade sauce` → deploy to accuris, headspace, ero via `sauce update --force` (cwd = each vault). No migration/heal. Never hand-version or hand-merge the release PR.
