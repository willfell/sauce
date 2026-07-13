# SectionExplorer — Move-Section + Select-Docs Fix

**Date:** 2026-07-13
**Status:** Approved (design)
**Scope:** Two runtime bugs remaining after v0.220.0/v0.220.1 shared section management (SectionExplorer).

## Problem

Two SectionExplorer features are broken at runtime (unit tests pass because they exercise stubs, not the real dispatch/vault path — same class of gap as the mobile `dv.pages()` lesson):

1. **Select docs** — clicking "Select docs" in the ⋯ overflow (wiki or project) does nothing. No visual change, no console error.
2. **Move section** — moving a section hub to a new destination renames the folder, then `processFrontMatter` crashes with **ENOENT** trying to read a file at the OLD (now-renamed) path.

## Root causes (confirmed against source)

### Bug 2 — `moveSection` (`platform/mechanisms/section-explorer/section-explorer.js:807`)

Three compounding faults:

1. **`app.fileManager.renameFile(...)` is async and never awaited** (line 814). Every subsequent `processFrontMatter` races the folder rename.
2. **Fabricated `{ path }` fallback objects.** When `getAbstractFileByPath` returns `null` (normal, right after an un-awaited rename), the code falls back to a bare `{ path }` literal. `processFrontMatter` on a non-`TFile` reads that path off disk → ENOENT.
3. **Child-patch paths are stale (OLD folder).** `rewriteOnSectionMove` (`platform/blueprints/project/helpers/section-hub.js:271`) builds `childPatches` from `_childHubsForRename` → `pagesUnder(section.folder)`, i.e. *pre-rename* paths. After the parent folder is renamed those children live under the NEW folder, so `getAbstractFileByPath(OLD)` → null → `{ path: OLD }` → **ENOENT at the old path** (the reported symptom).

Contrast: `applyDocMove` (doc move — which *works*) survives because it falls back to the real in-hand `file` `TFile`, whose `.path` Obsidian mutates in place on rename. Section move has no such handle for the children.

### Bug 1 — `enterSelectMode` (`section-explorer.js:873`)

Wiring is correct (wiki `wiki-chrome-bar.js:147`, project `project-chrome-bar.js:543` both call `enterSelectMode(dv)`, which exists). The failure is runtime: `enterSelectMode` flips the hub's *already-rendered* `.se-page-pane` in place via `pane.empty()` + rebuild — but that pane is owned by a **different dataview block** than the ChromeBar that dispatches the click. This cross-block, DOM-stash, in-place-mutation pattern either targets a stale/detached container at dispatch time or is clobbered by dataview's next re-render, so the user sees nothing. Same fragility class as the mobile dispatch-time `dv.pages()` lesson.

## Design

### Fix 1 — `moveSection`: async + prefix-remap + skip-null

Rewrite `moveSection` to:

1. **Build the patch plan before the rename** (`mv.rewriteOnSectionMove(section, dest)` — child paths are still valid old paths at this moment).
2. **`await app.fileManager.renameFile(folderFile, newFolder)`** so the vault index reflects new paths before any lookup. Bail (`return`) if the old folder can't be resolved to a real file, or the rename throws.
3. **Prefix-remap** every path old→new: `remap(p) = newFolder + p.slice(oldFolder.length)`, guarded to only remap paths that actually start with `oldFolder`. Apply to `section.hubPath` and each `childPatches[].path`.
4. **Resolve each remapped path via `getAbstractFileByPath` and skip when null** — never fabricate `{ path }`. `await processFrontMatter` only on real `TFile`s.

`never-throw` wrapper stays. `applyDocMove` (doc move) is left untouched — it works today and is out of scope (YAGNI).

Sketch:

```js
async moveSection(dv, section, destParentFolder, adapter) {
  try {
    if (!section || !section.folder) return;
    const oldFolder = String(section.folder).replace(/\/+$/, "");
    const newFolder = String(destParentFolder).replace(/\/+$/, "") + "/" + SectionExplorer._slugify(section.title);
    let folderFile = null;
    try { folderFile = app.vault.getAbstractFileByPath(oldFolder); } catch (_e) { folderFile = null; }
    if (!folderFile) return; // can't move a folder we can't resolve
    const mv = adapter && adapter.move;
    let plan = null;
    if (mv && typeof mv.rewriteOnSectionMove === "function") {
      try { plan = mv.rewriteOnSectionMove(section, destParentFolder); } catch (_e) { plan = null; }
    }
    try { await app.fileManager.renameFile(folderFile, newFolder); } catch (_e) { return; }
    if (!plan) return;
    const remap = (p) => {
      const s = String(p || "");
      return (s.indexOf(oldFolder) === 0) ? newFolder + s.slice(oldFolder.length) : s;
    };
    if (plan.hubPatch && section.hubPath) {
      const hf = app.vault.getAbstractFileByPath(remap(section.hubPath));
      if (hf) { try { await app.fileManager.processFrontMatter(hf, (fm) => Object.assign(fm, plan.hubPatch)); } catch (_e) { /* best-effort */ } }
    }
    for (const cp of (plan.childPatches || [])) {
      if (!cp || !cp.path) continue;
      const cf = app.vault.getAbstractFileByPath(remap(cp.path));
      if (cf) { try { await app.fileManager.processFrontMatter(cf, (fm) => Object.assign(fm, cp.patch || {})); } catch (_e) { /* best-effort */ } }
    }
  } catch (_e) { /* never-throw */ }
}
```

### Fix 2 — Select docs: modal picker (replaces in-place pane flip)

Retire the cross-block `enterSelectMode` pane mutation. New method `openSelectDocsPicker(dv, adapter, section)`:

1. Enumerate the surface's **direct** docs dv-independently via `SectionExplorer.pagesUnder(folder)` (metadataCache, mobile-safe — same source the move picker already trusts), filtered to direct children of the folder and the blueprint's doc type. `folder` = `section.folder` or, on a root hub, `adapter.move.root`.
2. Reuse `_openModal` + `_renderDocCards(panel, adapter, cards, { selected, onToggle })` (the card renderer already has checkbox mode) to render the checklist inside the modal panel.
3. Footer **"Move N →"** button (disabled at 0, live label). On click: close this modal and call the existing `openMovePicker({ targets: move.enumerateSectionTargets(dv), … })`, then `planBulkMove` → `applyDocMove` per move + the `Notice` summary (lifted verbatim from today's `_enterSelectModeOnPane` moveBtn).

**Call sites:** both chrome bars swap `SE.enterSelectMode(dv)` → resolve `{adapter, section}` via their existing `_projAdapterAndSection` / `_wikiAdapterAndSection` helper and call `SE.openSelectDocsPicker(dv, adapter, section)`.

**Deletions:** `enterSelectMode`, `_enterSelectModeOnPane`, and the `pane.__seCtx` / `pane.__seEnterSelectMode` stashes in `_renderPagePane` and `_renderRecentPane` (dead once select-mode is modal). Drop `.se-select-bar` from `section-explorer.css` if it becomes unused.

**Doc type:** add `docType` to each blueprint's `move` block — project `"doc-note"`, wiki `"wiki-page"` (confirmed: `wiki-tree.js:110`). `openSelectDocsPicker` reads `adapter.move.docType`.

### Tests (would have caught both)

- **Bug 2** (`platform/test/run-section-explorer.js`): fake `app` whose `renameFile` mutates an old→new path map and whose `processFrontMatter` **throws ENOENT if the path isn't in the map**. Assert: after `await moveSection`, hub + every child patched at NEW paths, zero lookups at old paths, no throw. Stub-with-real-filesystem-semantics.
- **Bug 1** (`platform/test/run-section-explorer.js`): DOM-stub `openSelectDocsPicker` against a doc stub + stubbed `pagesUnder` → assert N checkboxes, toggling updates the Move-button label/disabled, and Move invokes `openMovePicker` → `planBulkMove` → `applyDocMove`.
- Update `platform/test/run-wiki-chrome-bar.js` / `platform/test/run-project-chrome-bar.js` for the new `select-docs` dispatch (now `openSelectDocsPicker`).

## Files touched

- `platform/mechanisms/section-explorer/section-explorer.js` — `moveSection` rewrite; add `openSelectDocsPicker`; delete `enterSelectMode` / `_enterSelectModeOnPane` / pane stashes.
- `platform/mechanisms/section-explorer/section-explorer.css` — drop `.se-select-bar` if unused.
- `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` — `select-docs` dispatch → `openSelectDocsPicker`.
- `platform/blueprints/wiki/helpers/wiki-tree.js` — add `docType` to move block.
- `platform/blueprints/project/helpers/project-chrome-bar.js` — `select-docs` dispatch → `openSelectDocsPicker`.
- `platform/blueprints/project/helpers/section-hub.js` — add `docType` to move block.
- `platform/test/run-section-explorer.js`, `platform/test/run-wiki-chrome-bar.js`, `platform/test/run-project-chrome-bar.js` — new/updated cases.

## Non-goals

- No change to `applyDocMove` (doc move works today).
- No note-body migration / install heal — both fixes are pure dispatch-time behavior; no frontmatter or note content changes on existing vaults.
- No manual versioning/tagging/release-PR merge — the automated pipeline owns that. Mechanism + umbrella semver bump automatically from conventional commits.

## Ship

Conventional commits to `main` → automated release pipeline (per-component + umbrella semver, auto-merging release PR, tag, brew) → tap PR → `brew` update → `deploy.js` / `sauce update --force` to accuris, headspace, ero. Dogfood self-install verified. No migration.
