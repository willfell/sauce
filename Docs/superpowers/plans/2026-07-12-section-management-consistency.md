# Section Management Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring one shared, consistent section-management surface (collapsible move picker, in-place bulk-move, section-move, recursive/confirmed delete) to both the Wiki and Project blueprints via the shared `SectionExplorer` mechanism, and fix the multi-word breadcrumb duplication + Wiki tag-chip divergence.

**Architecture:** Fold new capability into the existing shared `SectionExplorer` mechanism that both blueprints already delegate to. Pure logic lands as **static** methods (Node-testable); runtime dialogs are instance methods reusing `SectionExplorer._openModal` chrome. Blueprint adapters gain a `move` block whose `rewriteOn{Doc,Section}Move` / `canAcceptSection` hooks encode the only real divergence (wiki = folder-is-truth no-op; project = frontmatter cascade + 2-level cap). Old per-blueprint move dialogs are unwired, not deleted.

**Tech Stack:** CustomJS helper classes (bare class expressions, no trailing statements, instance methods store as singletons; statics referenced by class name). Obsidian `app.fileManager.renameFile` / `processFrontMatter` / `trashFile`. Dataview `dv.pages`. Node behavioral harnesses under `platform/test/run-*.js` wired into `npm run release:preflight`.

### Landmines (read before touching any file)
- **customjs-no-trailing-statements:** every helper file is `("+file+")`-eval'd; the file MUST end as a bare class expression — no `module.exports`, no trailing `const`/`if`.
- **static-vs-instance:** `customJS.X` is an INSTANCE. Instance methods on the prototype; pure logic that tests call by class name (`SectionExplorer.foo(...)`) MUST be `static`.
- **worktree path:** all edits target `/Users/willfellhoelter/projects/repos/sauce/.claude/worktrees/bridge-cse_01UEwTgTj8Nnc37dToEfTXBk/…`. Verify `git branch --show-current` == the worktree branch before editing.
- **dv spread trap:** never `{ ...dv, container }` — rebuild `{ container, current: dv.current.bind(dv), pages: dv.pages.bind(dv) }`.
- **never-throw / cold-load:** every new method guards missing `customJS`/deps and returns a no-op rather than throwing.
- **dogfood before push:** `node platform/install.js --vault . --auto-approve` must pass.
- **do NOT** bump versions, tag, edit the tap, or merge the release PR — the pipeline is automatic.

---

## File map

**Modify (shared mechanisms):**
- `platform/mechanisms/breadcrumb/breadcrumb.js` — WS-A slug-compare fix (~line 217).
- `platform/mechanisms/section-explorer/section-explorer.js` — WS-C statics, WS-D picker, WS-E move/delete, WS-H select-mode.
- `platform/mechanisms/section-explorer/section-explorer.css` — WS-D/WS-H tree + select-mode styles.

**Modify (wiki blueprint):**
- `platform/blueprints/wiki/helpers/wiki-tree.js` — WS-B `hideTags`, WS-F `move` adapter block + rail move parity.
- `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` — WS-F section-hub `⋯` entries + Move dispatch → shared picker.

**Modify (project blueprint):**
- `platform/blueprints/project/helpers/section-hub.js` — WS-G `move` adapter block (cascade + cap).
- `platform/blueprints/project/helpers/project-chrome-bar.js` — WS-G section-hub `⋯` entries + Move dispatch → shared picker.
- `platform/blueprints/project/helpers/doc-leaf-actions.js` — WS-G leaf Move → shared picker (verify current call site).

**Create (tests):**
- `platform/test/run-v0NNN-section-management.js` — behavioral harness (all WS). Wire into `package.json` `release:preflight` after `run-smart-connections-bridge`.

**Inspect (may heal):**
- `platform/blueprints/wiki/helpers/*` template + `spice/wiki/.../*.md` for the WS-J duplicate add-link remnant.

---

## Task A: Breadcrumb multi-word slug fix (ask f)

**Files:**
- Modify: `platform/mechanisms/breadcrumb/breadcrumb.js` (`_buildPathWalkSegments`, `isSectionHub` calc)
- Test: `platform/test/run-v0NNN-section-management.js`

- [ ] **A1: Write failing test** — instantiate `Breadcrumb`, stub `dv` whose `current()` returns `{ title: "Ingredient List", file: { path: "spice/wiki/cooking/ingredient-list/Ingredient List.md" } }` and `pages()` returns the section-hub page for that folder. Registry entry uses `path_walk` (`root_dir:"spice/wiki", root_file:"Wiki.md", root_label:"Wiki"`). Assert `buildSegments(dv)` yields exactly one trailing crumb labelled "Ingredient List" (i.e. the folder segment for `ingredient-list` is skipped), and that the previous crumbs are `Wiki`, `Cooking`. Also assert a DOC inside that folder (`.../ingredient-list/Some Doc.md`) still renders `Wiki / Cooking / Ingredient List / Some Doc`.

- [ ] **A2: Run test, verify it FAILS** — `node platform/test/run-v0NNN-section-management.js` → the multi-word hub case shows two "Ingredient List" crumbs.

- [ ] **A3: Implement** — in `_buildPathWalkSegments`, change the self-hub detection from stem-vs-folder literal compare to slug compare:
```js
const isSectionHub = immediateFolder !== null
  && this._slugify(fileStem) === immediateFolder.toLowerCase();
```
(`_slugify` already exists on the class; folder segments are already lower-slug, so `.toLowerCase()` on the folder is belt-and-suspenders.)

- [ ] **A4: Run test, verify PASS.**

- [ ] **A5: Commit** — `git add platform/mechanisms/breadcrumb/breadcrumb.js platform/test/run-v0NNN-section-management.js && git commit -m "fix(breadcrumb): skip self-crumb for multi-word section hubs (slug compare)"`

---

## Task B: Wiki hide tag chips (ask a)

**Files:**
- Modify: `platform/blueprints/wiki/helpers/wiki-tree.js` (the `customJS.DocSearch.render(dv, {...})` call in `render`)
- Test: same harness (source-contract assert)

- [ ] **B1: Write failing test** — assert `wiki-tree.js` source contains `hideTags: true` inside the DocSearch options (regex over the file text). Fails today.

- [ ] **B2: Run, verify FAIL.**

- [ ] **B3: Implement** — add `hideTags: true,` to the DocSearch options object in `WikiTree.render` (alongside `scopePath, recursive, entityType, persist, onChange`).

- [ ] **B4: Run, verify PASS.**

- [ ] **B5: Commit** — `git commit -am "fix(wiki): hide tag-filter chips under search bar (match project)"`

---

## Task C: SectionExplorer shared pure statics (asks c/d/e/g core logic)

Fold the move/bulk/delete pure logic into `SectionExplorer` as **static** methods so both blueprints share one implementation and the harness tests it directly.

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: harness

Add these statics (mirroring the retired `WikiMove`/`DocMove`/`DocMoveDialog`/`DocBulkMoveActions` logic, now unified):

- [ ] **C1: `static _slugify(s)`** — `String(s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")`.

- [ ] **C2: `static sectionTargets(pages, opts)`** — `opts = { root, sectionType, labelOf(page)->string }`. Returns `[{ folder, label, depth }]`: root first (`{folder:root, label:opts.rootLabel||"(root)", depth:0}`), then every `page.type===sectionType` under `root+"/"`, `depth = folder.split("/").length - root.split("/").length`, sorted by `folder.localeCompare`. This unifies `WikiMove.sectionTargets` (root `spice/wiki`, type `wiki-section`) and `DocMoveDialog.sectionTargets` (root `<proj>/docs`, type `section-hub`).

- [ ] **C3: `static targetPath(targetFolder, currentPath)`** and **`static isNoop(targetFolder, currentPath)`** — copied verbatim from `WikiMove` (identical in both blueprints).

- [ ] **C4: `static planBulkMove(selectedPaths, targetFolder)`** — port `DocBulkMoveActions.planBulkMove`, but self-contained (use the statics above rather than a `docMove` instance): returns `{ moves:[{from,to}], skipped:[{path,reason}] }` with `already-there` / `no-dest` / `collision` reasons. Dedup destinations via a Set.

- [ ] **C5: `static subtreeDocCount(pages, folder, docType)`** — count `page.type===docType` whose folder `=== folder || startsWith(folder+"/")`. Used to gate recursive delete.

- [ ] **C6: `static childSectionFolders(pages, folder, sectionType)`** — the section-hub folders strictly under `folder` (for the delete-confirm "N empty sub-sections" count).

Each gets a focused unit test in the harness (targets ordering/labels for a wiki-shaped and a project-shaped `pages` array; planBulkMove skip reasons; subtreeDocCount 0 vs >0; slugify multi-word).

- [ ] **C-commit** — `git commit -am "feat(section-explorer): shared static move/bulk/delete pure logic"`

Each C-step follows write-test → run-fail → implement → run-pass. Keep them in one commit at the end of Task C.

---

## Task D: SectionExplorer collapsible move picker (asks c + d)

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (add `openMovePicker`)
- Modify: `platform/mechanisms/section-explorer/section-explorer.css`
- Test: harness (DOM-stub behavioral)

- [ ] **D1: Write failing behavioral test** — using the harness DOM stub (`createElement`/`appendChild`/`querySelector`/`style`), call `SectionExplorer.openMovePicker({ targets, currentFolder, title:"Move to section", onPick })` where `targets` is a 6-node tree (root + nested `yup/uh-huh/okay/...`). Assert: (1) on open, only depth-0 + depth-1 rows are visible AND the branch containing `currentFolder` is expanded; (2) a node with children renders a `▸`/`▾` toggle; (3) calling the exposed expand-all handler makes every row visible; (4) typing in the filter input flattens to matching rows; (5) clicking a target row invokes `onPick(folder)` and closes.

- [ ] **D2: Run, verify FAIL** (method undefined).

- [ ] **D3: Implement `openMovePicker`** using `_openModal("se-move-modal-overlay", (panel, close, doc) => {...})`:
  - Title via `_modalTitle`.
  - A header row: filter `<input>` (`_modalInput` style) + "Expand all" / "Collapse all" text buttons.
  - Build a parent→children index from `targets` (by folder-prefix/depth). Track `expanded` Set seeded with the ancestors of `currentFolder` (auto-expand current branch).
  - `renderTree()`: for each target in depth-first order, show the row only if all its ancestors are in `expanded` (or a filter query is active → flat matching list). Row: indent `depth*18px`, a `▸/▾` toggle span when it has children (click toggles `expanded` + `renderTree()`), the label, `cursor:pointer`. `currentFolder` row is greyed + non-clickable. Click → `close(); onPick(folder)`.
  - Filter `input` `oninput`: when non-empty, render the flat subset of targets whose label matches (case-insensitive), ignoring `expanded`; when cleared, restore the collapsed tree.
  - Expand-all → add every folder-with-children to `expanded`; Collapse-all → clear to just current-branch ancestors. Both call `renderTree()`.
  - Never-throw guard around the whole body.
  - Expose the internal handlers on the returned overlay (e.g. `overlay.__seExpandAll`, `overlay.__seRenderedFolders`) so the harness can drive/assert without real click events (mirror the `__seOpenedAt` test-seam precedent).

- [ ] **D4: Add CSS** — `.se-move-row`, `.se-move-toggle`, `.se-move-row.is-current`, `.se-move-header` in `section-explorer.css` (indent handled inline like the legacy dialog; hover via `--background-modifier-hover`).

- [ ] **D5: Run, verify PASS.**

- [ ] **D6: Commit** — `git commit -am "feat(section-explorer): collapsible tree move picker (collapsed by default, expand/collapse/filter)"`

---

## Task E: SectionExplorer move + recursive/confirmed delete (asks e/g runtime)

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js`
- Test: harness

- [ ] **E1: `applyDocMove(dv, file, destFolder, adapter)`** — TDD with an `app` stub (spy `renameFile` + `processFrontMatter`). `if (SectionExplorer.isNoop(destFolder, file.path)) return;` → `renameFile(file, targetPath)`; then if `adapter.move && adapter.move.rewriteOnDocMove`, resolve `const patch = adapter.move.rewriteOnDocMove(destFolder, file.path)` and, when non-null, `processFrontMatter` best-effort apply. Assert wiki adapter (rewrite→null) does renameFile only; project adapter applies `{section,sub_section}`.

- [ ] **E2: `moveSection(dv, section, destParentFolder, adapter)`** — `renameFile(folderFile, destParentFolder + "/" + _slugify(section.title))`; then apply `adapter.move.rewriteOnSectionMove(section, destParentFolder)` patch to the moved hub + children (best-effort). Wiki rewrite→null (folder move only). Test both.

- [ ] **E3: Recursive confirm delete** — replace `_openDeleteConfirm(dv, adapter, section)` body: guard `adapter.canDelete(section)`; compute `n = adapter.emptySubsectionCount ? adapter.emptySubsectionCount(section) : 0`; open a confirm modal (`_openModal` + `_modalTitle` + a body line + `_modalButtons(doc, panel, close, "Delete", onConfirm)` with the primary styled danger). Title/body: `n>0 ? "Delete '<t>' and N empty sub-section(s)? No docs will be lost." : "Delete '<t>'?"`. On confirm → `adapter.deleteSection(section)` (which trashes the folder recursively) then `close()`. Test: confirm invokes deleteSection; cancel does not.

- [ ] **E4: Wire rail-row `⋯`** — in `_renderRailRow`, add a `Move` entry (→ `this._openMovePickerForSection(dv, adapter, section)`) before Delete, and keep Rename/Add link/Delete. `_openMovePickerForSection` builds section targets via `adapter.move.enumerateSectionTargets(dv)` and calls `openMovePicker` → `onPick: (folder) => this.moveSection(dv, section, folder, adapter)`, filtered by `adapter.move.canAcceptSection`.

- [ ] **E5: Run all E tests, verify PASS.**

- [ ] **E6: Commit** — `git commit -am "feat(section-explorer): doc-move + section-move + recursive confirmed delete + rail Move"`

---

## Task F: SectionExplorer in-place select mode (ask e — bulk)

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`_renderPagePane`, new select-mode state)
- Modify: `platform/mechanisms/section-explorer/section-explorer.css`
- Test: harness

- [ ] **F1: Write failing test** — render page pane with 3 doc cards; call the exposed `enterSelectMode()`; assert each card gains a checkbox; check 2; assert the "Move N →" bar shows "Move 2 docs"; invoke its handler; assert `openMovePicker` opens and, on pick, `planBulkMove` is applied via `applyDocMove` per move (spy).

- [ ] **F2: Run, verify FAIL.**

- [ ] **F3: Implement** — `_renderPagePane` adds an "Edit / Select" toggle in the pane header (only when there are docs). Toggling on: re-render cards with a leading checkbox (`stopPropagation` so it doesn't open the note) + show a sticky `.se-select-bar` with a live "Move N →" button (disabled at 0). Button → `openMovePicker` (doc targets via `adapter.move.enumerateSectionTargets`, `canAcceptSection` not applied for docs) → `onPick`: `const {moves,skipped}=SectionExplorer.planBulkMove([...selected], folder); for (m of moves) await this.applyDocMove(dv, fileFor(m.from), folder, adapter);` then one summary `Notice`. Expose `enterSelectMode`/state on the pane node for tests.

- [ ] **F4: CSS** — `.se-select-bar`, `.se-doc-card.is-selectable`, checkbox spacing.

- [ ] **F5: Run, verify PASS.**

- [ ] **F6: Commit** — `git commit -am "feat(section-explorer): in-place Edit/Select mode for bulk doc move"`

---

## Task G: Wiki adapter + chrome wiring (ask h — wiki side)

**Files:**
- Modify: `platform/blueprints/wiki/helpers/wiki-tree.js` (`_buildConfig` → add `move` block)
- Modify: `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` (`surfaceSpec` overflow + `dispatch`)
- Test: harness (adapter source-contract + move-block behavior)

- [ ] **G1: Add `move` block to `WikiTree._buildConfig` return:**
```js
move: {
  root: "spice/wiki",
  sectionType: "wiki-section",
  rootLabel: "Wiki (root)",
  enumerateSectionTargets: (dv2) => {
    const raw = dv2.pages('"spice/wiki"');
    const arr = raw.array ? raw.array() : Array.from(raw);
    return customJS.SectionExplorer.sectionTargets(arr, { root: "spice/wiki", sectionType: "wiki-section", rootLabel: "Wiki (root)", labelOf: (p) => (p.title && String(p.title).trim()) || "" });
  },
  rewriteOnDocMove: () => null,     // folder-is-truth: no frontmatter
  rewriteOnSectionMove: () => null,
  canAcceptSection: () => true,     // arbitrary depth
},
```
Also add `emptySubsectionCount(section)` + change `canDelete` to `!!section.hubPath && customJS.SectionExplorer.subtreeDocCount(<subtree pages>, section.folder, "wiki-page") === 0` (query `dv.pages('"'+section.folder+'"')`).

- [ ] **G2: Wiki chrome overflow** — in `WikiChromeBar._config().surfaceSpec`, for `wiki-hub`/`wiki-section` add overflow entries `{id:"move-section",...}` (section only), `{id:"select-docs",...}`, `{id:"delete-section",...}` alongside `new-section`. In `dispatch`, route: `move` (leaf, unchanged intent) + `move-section` → `customJS.SectionExplorer._openMovePickerForSection(dv, adapter, currentSection)`; `select-docs` → `customJS.SectionExplorer.enterSelectMode(dv)`; `delete-section` → shared delete confirm. (Resolve the current section as a section descriptor from `dv.current()`.) Leaf `move` dispatch changes from `WikiLeafActions._openMoveDialog` → `customJS.SectionExplorer.openMovePicker(...)` with wiki doc targets + `applyDocMove`.

- [ ] **G3: Tests** — assert the wiki `move` block shape + that `rewriteOnDocMove()===null`; assert `canDelete` false when a wiki-page exists in subtree, true when empty.

- [ ] **G4: Run, verify PASS.**

- [ ] **G5: Commit** — `git commit -am "feat(wiki): adopt shared move picker/select/section-move/delete via SectionExplorer"`

---

## Task H: Project adapter + chrome wiring (ask h — project side)

**Files:**
- Modify: `platform/blueprints/project/helpers/section-hub.js` (`_buildConfig` → `move` block + cap + cascade)
- Modify: `platform/blueprints/project/helpers/project-chrome-bar.js` (overflow + dispatch)
- Modify: `platform/blueprints/project/helpers/doc-leaf-actions.js` (leaf Move → shared)
- Test: harness

- [ ] **H1: Add `move` block to `SectionHub._buildConfig`:**
  - `root: <project docs root>`, `sectionType: "section-hub"`, `rootLabel: "Docs (root)"`.
  - `enumerateSectionTargets(dv2)` → `SectionExplorer.sectionTargets` over `dv2.pages('"<docsRoot>"')`, `labelOf: (p)=> this._stripLink(p.section) || ...`.
  - `rewriteOnDocMove(destFolder, docPath)` → derive `{section, sub_section}` from `destFolder` relative to docsRoot (port `DocMoveDialog._destSection`); return `{ section, sub_section }`.
  - `rewriteOnSectionMove(section, destParentFolder)` → patch moved hub `parent_section` + `depth` + cascade children `parent_section` (reuse `_childHubsForRename`). Return the hub patch; children handled inside if the mechanism calls a provided `applySectionMoveCascade`. (Simpler: expose `rewriteOnSectionMove` returning `{hubPatch, childPatches:[{path,patch}]}` and have `moveSection` apply all.)
  - `canAcceptSection(section, destFolder)` → enforce 2-level cap: destination depth (relative to docsRoot) + (section has children ? 1 : 0) must be ≤ 2. Root (depth 0) always ok for a section that has children; a childless section may target depth-1 (becomes depth-2).
  - `emptySubsectionCount` + `canDelete` via `SectionExplorer.subtreeDocCount(..., "doc-note")`.

- [ ] **H2: Project chrome overflow** — in `ProjectChromeBar` (read its `surfaceSpec`/`dispatch`; mirror WS-G), add `move-section` / `select-docs` / `delete-section` for the `section-hub` surface, routing to the shared entry points. Keep New Doc / New Sub-Section / Move docs? Replace "Move docs" (old bulk dialog) with `select-docs` (shared in-place mode) OR keep both — **replace** to converge on the shared path.

- [ ] **H3: `doc-leaf-actions.js`** — change the single-doc Move handler to `customJS.SectionExplorer.openMovePicker(...)` with project doc targets + `applyDocMove`, instead of `DocMoveDialog._openMoveDialog`.

- [ ] **H4: Tests** — project `move` block: `rewriteOnDocMove` derives correct section/sub_section for depth-1 and depth-2 dests + root; `canAcceptSection` cap (childless nests, parent-with-children blocked from depth-1); `canDelete` gating on doc-note subtree count.

- [ ] **H5: Run, verify PASS.**

- [ ] **H6: Commit** — `git commit -am "feat(project): adopt shared move picker/select/section-move/delete via SectionExplorer (2-level cap preserved)"`

---

## Task I: Duplicate add-link inspection/heal (ask b)

**Files:**
- Inspect: wiki-page template + the cited note; Modify install heal only if a remnant is found.

- [ ] **I1: Inspect** — grep the wiki-page template and `spice/wiki/**` for a body-level links block or an `Add link` marker rendered outside `SectionExplorer.renderNoteLinks`. Read `WikiChromeBar._renderNoteLinks` call site to confirm single invocation.

- [ ] **I2:** If a stale body block exists on real notes → add an idempotent `.sauce-backup`-first heal in the wiki install path (mirror existing `_healWikiChromeBody` shape) that strips it; add a heal test. If nothing duplicates → record "verified single render, no heal needed" in the result doc and skip.

- [ ] **I3: Commit** (if heal added) — `git commit -am "fix(wiki): strip legacy duplicate add-link body remnant (guarded heal)"`

---

## Task J: Harness wiring, preflight, dogfood

- [ ] **J1** — Wire `run-v0NNN-section-management.js` into `package.json` `release:preflight` chain (after `run-smart-connections-bridge`, matching the existing single-line `&&` sequence). Rename `v0NNN` to the current cycle id once known (use `v0SEC` placeholder-free: derive from `npm run status` workshop version + patch — actually just name it `run-section-management.js` with no version prefix to avoid churn; confirm the glob `run-*.js` picks it up — preflight enumerates `run-*.js`, so any name works).
- [ ] **J2** — `npm run release:preflight` → whole suite GREEN.
- [ ] **J3** — `node platform/install.js --vault . --auto-approve` (workshop dogfood) → success.
- [ ] **J4** — `npm run release:preflight-bumped` on a clean tree → GREEN (catches the prepare-release wedge).
- [ ] **J5: Commit** any harness-wiring/package.json changes — `git commit -am "test(section-explorer): behavioral harness for shared section management"`.

---

## Task K: Ship

- [ ] **K1** — Push branch, open PR to `main` with a conventional-commit title (`feat(section-explorer): shared section management across wiki + project`) and a body summarizing WS-A..I. `git merge origin/main` (or rebase) first if BEHIND.
- [ ] **K2** — Wait for CI (`preflight (macos-latest)` + `preflight (ubuntu-latest)`) GREEN; merge the feature PR (squash).
- [ ] **K3** — Let the release pipeline run: it opens + auto-merges the release PR, tags `v<X.Y.Z>`, patches + auto-merges the tap PR. Monitor; do NOT hand-merge/tag.
- [ ] **K4** — `brew update && brew upgrade sauce`; confirm `sauce --version` == new version.
- [ ] **K5** — `node scripts/autoloop/deploy.js run` (brew-upgrade + `sauce update --bump-pins` + install per consumer) for accuris, headspace, ero; verify deployed signatures (the new SectionExplorer statics present in each vault's installed copy).
- [ ] **K6** — Report back with version, PR/release/tap links, and per-vault deploy confirmation.

---

## Self-review (coverage)

- (a) tag chips → Task B. (b) duplicate add-link → Task I. (c) move dialog → Task D. (d) collapsed trees → Task D. (e) section ⋯ Move + bulk Edit → Tasks E/F/G/H. (f) breadcrumb dupe → Task A. (g) delete section → Tasks C(sub­treeDocCount)/E. (h) both blueprints shared → Tasks C–H (single `SectionExplorer` path). Ship/deploy → Tasks J/K. No spec requirement is unmapped.
