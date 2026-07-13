# Section & Doc Management — Robustness + UX (issues a–e)

**Date:** 2026-07-13
**Status:** Approved (design)
**Scope:** One combined design → one PR → one release.
**Surfaces:** `section-explorer` mechanism (shared wiki + project), `project` blueprint (`section-hub.js`, `project-chrome-bar.js`), project install heal.

## Problem

Five related issues in the shared section/doc browsing + move UI:

- **(a)** No per-doc actions. Individual doc cards in a wiki/section hub have no `⋯` menu — you can't rename, move, delete, or add a link to a single doc from the hub.
- **(b)** Doc labels leak `.md`. The Select-docs bulk picker (and doc-card title fallback) render the raw filename including the `.md` extension.
- **(c)** *Primary bug.* Navigating into a nested sub-section hub shows **zero docs** even when docs physically live in its folder. Moving docs "up to a parent then back" is the only workaround.
- **(d)** The Move-section dialog is cramped and opens collapsed (only the current branch expanded), so you can't see the tree at a glance.
- **(e)** The Docs **atlas root** (`Docs.md`) `⋯` menu has no "Select docs" — you must navigate into a section to bulk-select/move.

## Root cause — issue (c)

`SectionHub._buildConfig` (`section-hub.js:227-231`) rebuilds a depth-2 hub's folder path from **frontmatter**, not from the file's real location:

```
sectionPath = docsRoot / _slugify(parent_section) / section_slug
```

Live headspace repro — `spice/projects/sauce/docs/misc/misc-subsection/Misc-Subsection.md`:

```yaml
section: Misc-Subsection
parent_section: Misc-Subsection   # should be "Misc"
section_slug: misc-subsection
depth: 2
```

→ computes `spice/projects/sauce/docs/misc-subsection/misc-subsection` (a folder that does not exist). `listPages` filters `p.file.folder === sectionPath` → **0 matches** → true-empty-leaf → "Nothing here yet." `Misc.md`'s "Recently updated" still works because Dataview folder queries are recursive from the *real* `misc/` root.

The `+ New Sub-Section` entity template sets `parent_section` correctly (`[[{{current_file.frontmatter.section}}]]` → `[[Misc]]`); the live note's bad value came from ad-hoc creation. The lesson is architectural: **the renderer must not trust a frontmatter display-name to reconstruct a path the note already knows.**

## Design

### (c) Folder-is-truth path derivation + heal

**Renderer fix.** In `section-hub.js`, derive the section's folder from `cur.file.folder` (the note's actual on-disk folder) instead of reconstructing from `parent_section`/`section_slug`. Apply everywhere a path is currently reconstructed:

- `_buildConfig` → `sectionPath` (both depth-1 and depth-2 use `cur.file.folder`; depth-1 already equals the reconstruction, so this is a no-op there and a fix at depth-2).
- `render()` search-strip `scopePath` (same derivation).
- `_renderResults` recursive scope path (same).
- The `_buildConfig.docsRoot` derivation stays as-is (walk up from folder to the project's `docs` root, or keep the existing `spice/projects/${projectSlug}/docs` literal — `projectSlug` is reliable).

This makes depth-2 hubs immune to `parent_section` drift from any cause (bad creation, future section moves). Wiki is already folder-is-truth and unaffected.

*Rejected:* heal-only (rewrite `parent_section`, keep reconstruction) — leaves the fragility; re-breaks on the next stale field.

**Install heal (`applyDepth2ParentSectionHeal`).** A never-throw, idempotent, backup-guarded install step that, for each project's `docs/` tree, finds every `type: section-hub` note with `depth: 2` and rewrites its `parent_section` to the **actual parent folder's** section-hub `section` display-name (read from the parent folder's `*.md` section-hub, matched by folder path). Skips notes already correct. Repairs the live headspace note and any latent cases across all vaults. Wired into the project blueprint's install alongside existing heals.

### (a) Per-doc `⋯` menu

Add a `⋯` element to each doc card in `SectionExplorer._renderDocCards`, mirroring the section-row pattern (`_renderRailRow`, lines ~410-436) — same `MenuPopover.open(entries, { anchor })` and `_openModal` chassis, same `.se-rail-dots`-style affordance (new `.se-doc-dots` class, same visual language).

Entries (in order): **Rename · Move · Add link · Delete**.

- **Rename** → `_openRenameDocDialog`: prompt for a new title, rename the file via `app.fileManager.renameFile` (basename only, preserve folder + `.md`). Optionally sync a `title` frontmatter field if present. Generic; no blueprint logic.
- **Move** → reuse `openMovePicker` seeded from the adapter's `move` block, then `applyDocMove(dv, file, destFolder, adapter)`. Honors project frontmatter rewrite and wiki folder-only automatically (both already supported).
- **Add link** → `_openAddLinkForDoc`: reuse the existing add-link form, but target the **doc's own** frontmatter `links[]` (read via `app.metadataCache`, write via `app.fileManager.processFrontMatter`). Added links surface on that doc's own note through the existing `renderNoteLinks`. Per user confirmation: attaches to the doc, not the section hub.
- **Delete** → `_openDeleteDocConfirm`: danger-styled confirm modal (reusing the chassis), then `app.fileManager.trashFile` (recoverable trash, not hard delete).

All four are generic file operations, so the wiki blueprint gains the same per-doc menu with no wiki-specific code. Move is the only one that consults `adapter.move`.

**Adapter contract:** no new required keys. Rename/Delete/Add-link act on the file directly inside the mechanism. `makeAdapter` continues to forward `move`. (If a blueprint ever needs to veto a doc delete/rename, an optional `canDeleteDoc`/`canRenameDoc` hook can be added later — YAGNI for now.)

### (b) Trim `.md`

- `_docCardModel` (section-explorer.js ~293): title fallback `p.file.name` → strip trailing `.md` (`String(name).replace(/\.md$/, "")`).
- Select-docs row (`openSelectDocsPicker`, ~945): fallback `c.title || c.path` → `c.title || basename-without-.md`.

Covers every doc-label surface.

### (d) Move dialog — spacious + default-expanded

In `SectionExplorer.openMovePicker`:

- Replace `let expanded = branchSeed()` with a full-expand seed: populate `expanded` with every folder that `hasChildren()` (equivalent to `doExpandAll()` at open). The current-branch highlight still applies.
- Spacing: wider panel (raise the modal max-width), taller list (`max-height: 55vh` → `62vh`), roomier rows (`.se-move-row` padding `7px 10px` → `9px 12px`), slightly larger indent-per-depth, and a clearer current-selection style. Adjust in `section-explorer.css` `.se-move-*` and the inline styles in `openMovePicker`.

No behavior change beyond initial expansion state + visual spacing.

### (e) "Select docs" at Docs atlas root

- Add `{ id: "select-docs", label: "Select docs", icon: ICON.move }` to the `docs-hub` overflow spec in `ProjectChromeBar._surfaceSpec` (keep `new-section` and `move-docs`).
- `_projAdapterAndSection` currently bails unless `cur.type === "section-hub"`. Add a docs-root branch (or a sibling `_docsRootAdapter(dv)`): when `cur.type` is the docs atlas (`docs-hub`/`project` atlas shape) at `Docs.md`, build the docs-root SectionHub config (a minimal config exposing the `move` block with `root = docsRoot`) and return `{ SE, adapter, section: null }`.
- The `select-docs` dispatch then calls `openSelectDocsPicker(dv, adapter, null)`, which already enumerates docs at the root folder via `pagesUnder(root)`.

## Testing strategy

Bar: **the exact broken state reproduces red, the fix turns it green, in Node — no Obsidian round-trip.** Extend existing harnesses in place (no new suite files unless a harness lacks a home for a case).

1. **(c) killer test** — `run-project-doc-move` (or `run-section-explorer`): build a depth-2 hub whose `parent_section` === its own `section` (the exact bug). Assert `_buildConfig`'s `sectionPath` === the real folder and `listPages` returns the docs. Red on current code, green after folder-is-truth.
2. **Heal test** — seed-vault migration harness: seed a broken depth-2 hub → run `applyDepth2ParentSectionHeal` → assert `parent_section` matches the parent folder's section name; idempotent on 2nd pass; untouched when already correct.
3. **(a)** — DOM-stub cases in `run-section-explorer`: doc `⋯` → Rename/Delete/Add-link call the right spied `app.*` API; Move invokes `applyDocMove`/`adapter.move`; Add-link writes `links[]` to the doc file.
4. **(b)** — assert no `.md` in `_docCardModel` title and in select-docs row labels.
5. **(d)** — assert `openMovePicker` opens with every `hasChildren` folder present in `expanded`. Optional Playwright HTML harness to eyeball spacing/expansion before ship (per `lesson_verify_chrome_visually_with_playwright_harness`).
6. **(e)** — `run-project-chrome-bar`: `docs-hub` spec includes `select-docs`; docs-root dispatch builds an adapter and calls `openSelectDocsPicker(_, _, null)`.

Regression: `run-section-explorer`, `run-project-doc-move`, `run-wiki`, `run-wiki-chrome-bar`, `run-project-chrome-bar`, `run-breadcrumb` stay green. Full `preflight` + `preflight-bumped`.

## Non-goals

- No change to wiki's folder-is-truth model (already correct).
- No hard-delete of docs (trash only).
- No redesign of the section-row menu (reused as-is).
- No blueprint-manifest surgery for the retired legacy move dialogs (already unwired).

## Components touched (version bumps computed by the auto-pipeline)

- `section-explorer` mechanism (a, b, d + doc-action plumbing).
- `project` blueprint (`section-hub.js` folder-is-truth; `project-chrome-bar.js` e; install heal c).
- `section-explorer.css` (a dots, d spacing).
