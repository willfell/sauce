# Section management consistency across Wiki + Project — design

**Date:** 2026-07-12
**Status:** Approved (design), pre-implementation
**Blueprints touched:** wiki, project (+ shared mechanisms `section-explorer`, `breadcrumb`, `doc-search`)

## Problem

A batch of Wiki bugs/requests, with a hard requirement that fixes land in the **shared
module** both Wiki and Project use, so behavior stays consistent across both blueprints:

- (a) Real `#tag` filter chips render under the Wiki search bar; look like stray placeholders.
- (b) A possible duplicate "add a link" affordance on a doc note (above + below the nav).
- (c) The Move dialog is a confusing fully-expanded section tree.
- (d) Trees should load **collapsed** by default except the current branch, with expand/collapse.
- (e) A section hub's `⋯` only offers "add a new section"; it should also offer **Move section**
  and an **Edit / bulk-select** mode to move several docs at once.
- (f) On a multi-word section hub (e.g. `Ingredient List.md`) the breadcrumb renders the
  section name **twice** (first clickable, second not).
- (g) Add **Delete Section** to the `⋯` — disabled if any doc exists anywhere in the subtree;
  confirmed + recursive when only empty sub-sections remain.
- (h) All of the above must be brought to **both** blueprints via the shared module(s).

## Architecture findings (why this design is shaped this way)

- **The section browser is already shared.** `WikiTree` (wiki) and `SectionHub` (project) each
  build a config object and delegate to `customJS.SectionExplorer.makeAdapter(config)` →
  `SectionExplorer.render(dv, adapter)`. The mechanism owns the rail, the doc-card page pane,
  pinned links, and the per-row `⋯` menu (**Rename / Add link / Delete**, Delete already
  `disabled` unless the section is empty). So tree/rename/delete are consistent *by construction*.
- **Move is the one thing not shared, and it is already duplicated by copy.** Wiki has
  `WikiLeafActions._openMoveDialog` + `WikiMove`. Project has `DocMoveDialog` (whose header
  comment literally says it "Mirrors the SHIPPED, TESTED wiki pattern") + `DocMove` +
  `DocBulkMoveActions`. Two near-identical fully-expanded `└`-connector trees plus a third
  bespoke bulk dialog with a `<select>`.
- **Move semantics legitimately diverge:** wiki move = pure `app.fileManager.renameFile`
  (folder-is-truth, no frontmatter); project move = `renameFile` + rewrite `section` /
  `sub_section` frontmatter to match the destination folder. This is the *only* real
  blueprint-specific part of a move.
- **Breadcrumb (f) is a shared-mechanism bug.** `Breadcrumb._buildPathWalkSegments` computes
  `isSectionHub = fileStem.toLowerCase() === immediateFolder.toLowerCase()`. For
  `Ingredient List.md` in folder `ingredient-list`, `"ingredient list" !== "ingredient-list"`
  (space vs slug hyphen) → the self-crumb skip fails → the section renders once as a resolved
  intermediate crumb and again as the current-page crumb. Single-word "Recipes" slugs cleanly
  and works. **Trigger = multi-word section names, not emptiness.**
- **Tag chips (a) are a one-flag divergence.** Project passes `hideTags: true` to
  `DocSearch.render`; Wiki does not, so Wiki shows real tag-filter chips.

## Decision: extend `SectionExplorer` as the single shared home

Fold the move picker, in-place bulk-select, section-move, and the recursive/confirmed delete
into the existing `SectionExplorer` mechanism, which **both blueprints already depend on**. This
avoids introducing a new mechanism (no new per-vault subscription / `--bump-pins` plumbing) and
is cohesive: the section navigator owns section + doc management. Tested *pure* logic
(`sectionTargets` / `targetPath` / `planBulkMove` / destination-section derivation) folds in as
**static** methods so the Node harness still exercises it without a live vault.

Blueprint adapters (built in `WikiTree._buildConfig` and `SectionHub._buildConfig`) gain a small
`move` block:

```
move: {
  root,                              // "spice/wiki"  |  "<project>/docs"
  enumerateSections(dv, ctx),        // section-hub pages under root (for target list)
  rewriteOnDocMove(destFolder) -> patch|null,   // wiki: null; project: {section, sub_section}
  rewriteOnSectionMove(section, destParentFolder) -> patch|null,  // wiki: null; project: cascade
  canAcceptSection(section, destFolder) -> bool, // project 2-level cap; wiki: always true
}
```

**Retire:** `WikiMove`, `DocMoveDialog`, and the bespoke modal inside `DocBulkMoveActions`.
Keep their pure helpers by folding equivalent statics into `SectionExplorer` (so existing Node
tests re-point at the shared statics rather than deleting coverage). `DocLeafActions` /
`WikiLeafActions` / the ChromeBar overflow dispatch route into the shared entry points instead of
their own dialogs.

## Components

### 1. Shared move picker — collapsible tree (asks c + d)

`SectionExplorer.openMovePicker({ targets, currentFolder, title, onPick })`:

- `targets` = depth-ordered `[{ folder, label, depth, parent }]` from the unified
  `SectionExplorer.sectionTargets(pages, { root, labelOf, depthOf })`.
- Renders **collapsed by default**; only the branch containing `currentFolder` is auto-expanded.
- `▸ / ▾` toggle on any node that has children; a header row with **Collapse all** /
  **Expand all** and a **filter box** (typing flattens to matching rows regardless of collapse
  state; clearing restores the collapsed tree).
- The current location row is disabled/greyed (no-op guard).
- One dialog serves single-doc, bulk, and section moves (title + target set differ per caller).
- Reuses `SectionExplorer._openModal` chrome (the existing 400ms ghost-click backdrop guard,
  single Escape/backdrop teardown) so mobile self-dismiss (lesson: mobile ghost-click) can't
  regress.

### 2. Single-doc move (both blueprints)

Leaf `⋯ → Move` (ChromeBar overflow) → `openMovePicker` with doc targets → on pick,
`SectionExplorer.applyDocMove(file, destFolder, adapter)` = `renameFile` + (project only)
`processFrontMatter` applying `adapter.move.rewriteOnDocMove(destFolder)`. Wiki behavior is
byte-identical to today minus the always-expanded tree.

### 3. Bulk move = in-place select mode (ask e; chosen UX = select mode on the hub)

- The page pane gains an **"Edit / Select"** toggle. In select mode each `.se-doc-card` shows a
  checkbox and a sticky **"Move N →"** bar appears.
- "Move N →" opens the **same** `openMovePicker` → `SectionExplorer.planBulkMove(selected, target)`
  (dedup / collision / already-there skips — folded from `DocBulkMoveActions.planBulkMove`, kept
  Node-tested) → batch `applyDocMove` per doc, one summary `Notice`.
- Because the page pane is shared, **Wiki gains bulk-move for the first time**, identical to
  Project. Select mode applies to the current section's direct docs; docs living in
  sub-sections are selected from their own section (documented, not a regression).

### 4. Move a whole section (ask e)

- New `⋯ → Move section` on the section's own ChromeBar `⋯`, **and** on each child row's `⋯` in
  the rail. Uses `openMovePicker` with **section** targets → `renameFile(folder, dest/slug)` +
  `adapter.move.rewriteOnSectionMove` cascade.
- **Project 2-level cap constraint (inherent, surfaced not hidden):** project docs cap at
  section (depth-1) → sub-section (depth-2). `canAcceptSection` filters targets so a project
  section *with* sub-sections can only move to root level, and a childless one may nest one
  level; anything that would create depth-3 is not offered. **Wiki has no cap** (folder-is-truth,
  arbitrary depth) so all targets are legal. The asymmetry is a real domain constraint, not a
  bug; the picker simply shows fewer legal targets for projects.
- Project section-move cascade patches the moved hub's `parent_section` (+ `depth`/`section_slug`
  as needed) and each child hub's `parent_section`, reusing the existing
  `SectionHub._childHubsForRename` cascade pattern.

### 5. Delete section — recursive + confirmed (ask g)

- `canDelete` changes from "0 direct pages AND 0 subsections" → **"0 docs anywhere in the
  subtree"** (recursive doc count == 0). An empty leaf *or* a section whose sub-sections are all
  empty becomes deletable; any doc in the subtree → disabled/greyed (unchanged for that case).
- `SectionExplorer._openDeleteConfirm` gains a **real confirm modal** (today it deletes with no
  prompt, no recursion): *"Delete '<Section>' and N empty sub-section(s)? No docs will be lost."*
  On confirm → recursively `trashFile` the folder (Obsidian's folder trash removes descendants).
  A leaf section with no sub-sections keeps the same confirm with `N = 0` wording collapsed to
  *"Delete '<Section>'?"*.
- The recursive-empty check is a shared pure helper `SectionExplorer.subtreeDocCount(dv, folder)`
  so both blueprints gate identically.

### 6. Breadcrumb duplicate on multi-word sections (ask f)

- Fix in the shared `breadcrumb` mechanism: compare **slugified** stem to the folder segment —
  `_slugify(fileStem) === immediateFolder` (both slug space). `_slugify` already exists on the
  class.
- Add a Node regression asserting a multi-word section hub (`Ingredient List.md` in
  `ingredient-list/`) yields a single trailing crumb, and that a doc *inside* such a section is
  unaffected. Fixes every path_walk consumer (Wiki today).

### 7. Tag chips under the Wiki search bar (ask a)

- Add `hideTags: true` to `WikiTree`'s `DocSearch.render` call — one line, aligns Wiki to
  Project (which already hides them). Removal chosen over adding chips to Project because the
  ask is to remove them and Project's hidden state is the consistency target.

### 8. Duplicate "add a link" (ask b)

- The ChromeBar renders leaf links once via `SectionExplorer.renderNoteLinks`; a second one
  implies a legacy body/marker remnant on that specific note. Implementation step: inspect the
  real note (`spice/wiki/cooking/recipes/Croissant Putting.md` in headspace, plus the wiki-page
  template). If a stale body block/marker is found, add a targeted **`.sauce-backup`-first,
  idempotent** heal that strips it; if nothing renders it twice, close as already-fixed and note
  the verification in the result doc. No code path is intended to render links twice.

### 9. Section `⋯` surface parity (ask e umbrella)

Both blueprints' ChromeBar overflow, on a **section hub** surface, gains (routing into the
shared `SectionExplorer` entry points, dispatched via existing `WikiChromeBar` / `ProjectChromeBar`
`dispatch`):

- **Move section** → `openMovePicker` (section targets).
- **Select docs (Edit)** → toggles the page pane's select mode.
- **Delete section** → shared confirm/recursive delete (disabled unless subtree doc count 0).

Existing create actions (New Page/Section, New Doc/Sub-Section) stay. Child-section rows in the
rail keep Rename / Add link / Delete and additionally get **Move** for parity.

## Data flow

```
ChromeBar ⋯ (section hub)  ─┐
rail row ⋯ (child section) ─┼─► SectionExplorer.openMovePicker ─► onPick ─► applyDocMove / moveSection
page-pane "Move N →"       ─┘                                                   │
                                                                                ▼
                                              adapter.move.rewriteOn{Doc,Section}Move (wiki: null | project: fm patch)
```

## Error handling

- Every new `SectionExplorer` method is never-throw + cold-load-safe (matches existing mechanism
  contract): a not-yet-loaded dependency is a no-op, not a throw.
- Frontmatter rewrites are best-effort try/catch (the file move already succeeded) — mirrors
  `DocMoveDialog.move`.
- Move no-ops (same folder) and duplicate-destination collisions are skipped and surfaced in the
  summary `Notice`, never silently dropped.
- URL/link safety in the shared links row is unchanged (`SAFE_URL_SCHEMES`).

## Testing

Extend the Node behavioral harness (`platform/test/run-*.js`, wired into `release:preflight`):

- `SectionExplorer.sectionTargets` unification: depth ordering + labels for both a wiki root and
  a project docs root.
- `planBulkMove`: dedup / collision / already-there skip parity (re-point existing
  `DocBulkMoveActions` assertions at the shared static).
- `canAcceptSection`: project 2-level cap (childless section may nest; section-with-children may
  not; wiki always true).
- `subtreeDocCount` gating recursive delete (empty subtree deletable; any doc → not).
- Breadcrumb slug fix: multi-word section hub yields one trailing crumb; doc inside unaffected.

Collapsible-tree DOM behavior (expand/collapse/filter) is verified via a behavioral harness that
instantiates the picker against DOM stubs (mirrors existing `run-v0109-*` behavioral pattern).

## Migration / heals

- Breadcrumb (6): none — pure render fix.
- Delete/move (2–5): none — behavioral only.
- Add-link remnant (8): a guarded `.sauce-backup`-first heal **only if** a stale body block is
  found on inspection; otherwise none.
- No template structural changes are required; the ChromeBar overflow additions are code-side.

## Distribution

No new mechanism or blueprint → standard release. Changed files live under existing subscriptions
(`section-explorer`, `breadcrumb`, `wiki`, `project`). Consumer deploy is
`scripts/autoloop/deploy.js run` (brew-upgrade + `sauce update --bump-pins` + install) to
accuris, headspace, ero — no manual per-vault subscription edits needed.

## Out of scope (YAGNI)

- A bulk **tree**-select destination beyond the shared collapsible picker.
- Cross-project / cross-wiki moves (moves stay within one root).
- Lifting the project 2-level docs cap (deliberate domain constraint).
- Reworking `doc-search` beyond the one `hideTags` flag.
