---
title: Sticky Notes rewrite (scratch blueprint rename + overhaul)
date: 2026-07-08
status: approved
---

# Sticky Notes rewrite

## Purpose

The `scratch` blueprint is one of the most-used blueprints in daily consumer-vault workflows, but it has three concrete friction points the user hit directly:

1. Naming is misleading — "Scratch" doesn't communicate what the notes are for as clearly as "Sticky Notes" would.
2. Only one leaf note can be created per minute — the leaf filename timestamp only carries `HH-mm` resolution, so a second create within the same minute hits `entity-create`'s collision guard and just re-opens the first note.
3. A leaf note's title is invisible at a glance — you land on a note named `Scratch-2026-07-07-09-15.md` with no rendered title, so multiple open tabs/notes are indistinguishable.

Additionally, there's no way to browse or search across *all* sticky notes at once — only per-day, via the day-hub.

This is a full rename + feature cycle, not a patch: `scratch` → `sticky-notes` end-to-end (types, folder, filenames, classes, command, icon), plus the three fixes above.

## Scope

### 1. Full rename: scratch → sticky-notes

| Old | New |
|---|---|
| `module_directory: scratch` | `sticky-notes` |
| Blueprint name `scratch` | `sticky-notes` |
| Types `scratch` / `scratch-day` / `scratch-hub` | `sticky-note` / `sticky-day` / `sticky-hub` |
| Folder `spice/scratch/` | `spice/sticky-notes/` |
| Hub file `Scratch.md` | `Sticky.md` |
| Day-hub file `Scratch-Day-<date>.md` | `Sticky-Day-<date>.md` |
| Leaf file `Scratch-<date>-<time>.md` | `Sticky-<date>-<time>.md` |
| Classes `ScratchDayActions`, `ScratchLeafActions`, `ScratchHubActions`, `ScratchDayList`, `ScratchHubCards`, `ScratchChromeBar`, `ScratchDayMigrate`, `ScratchDayMigrateInit` | `StickyDayActions`, `StickyLeafActions`, `StickyHubActions`, `StickyDayList`, `StickyHubCards`, `StickyChromeBar`, `StickyDayMigrate`, `StickyDayMigrateInit` |
| Command `/scratch`, skill `new-scratch` | `/sticky-notes`, `new-sticky-note` |
| Nav-button label "Scratch", icon `scratch` | label "Sticky Notes", icon `sticky-note` |
| Rule fragment targets `scratch` / `scratch-day-hub`, globs `Scratch-2*.md` / `Scratch-Day-*.md` | `sticky-note` / `sticky-day-hub`, `Sticky-2*.md` / `Sticky-Day-*.md` |
| Breadcrumb registry types `scratch` / `scratch-day` | `sticky-note` / `sticky-day` |

**New icon**: vendor a `sticky-note` Tier-1 SVG in `platform/mechanisms/icons/icons.js` (lucide `sticky-note` glyph — a square with a folded corner). Used by the nav-button; replaces the current `scratch` (magic-wand-shaped) icon for this blueprint. The old `scratch` Tier-1 entry can stay (unused, harmless) or be removed if nothing else references it — confirm at implementation time via a grep before removing.

**Install migration** (`platform/install.js`): new `applyScratchToStickyNotesMigration`, backup-guarded (writes to `.sauce-backup` like other structural migrations), idempotent (a vault with no `spice/scratch/**` is a no-op; a vault already fully on `spice/sticky-notes/**` is a no-op).

Steps, for any vault still carrying `spice/scratch/**`:
1. Move the directory `spice/scratch` → `spice/sticky-notes` (the `YYYY/MM-MMMM/YYYY-MM-DD` sub-structure is untouched — only the top-level folder name changes).
2. Rename every file inside: `Scratch.md`→`Sticky.md`, `Scratch-Day-<date>.md`→`Sticky-Day-<date>.md`, `Scratch-<date>-<time>.md`→`Sticky-<date>-<time>.md` (existing leaves keep whatever timestamp precision they already have — 2-token `HH-mm`; only newly-created leaves after this ships get 3-token `HH-mm-ss`, see below).
3. Rewrite frontmatter `type:` on every renamed file (`scratch`→`sticky-note`, `scratch-day`→`sticky-day`, `scratch-hub`→`sticky-hub`) and the day-hub's `day_link:` field (its embedded `[[Scratch-Day-...]]` wikilink target).
4. Vault-wide link rewrite: scan every markdown file for `[[Scratch...`/`[[spice/scratch/...` references and repoint them to the corresponding `Sticky...`/`spice/sticky-notes/...` path — same plain-regex approach `install.js` already uses for other structural/note-chrome migrations (this runs headless in Node, not through Obsidian's `app.fileManager`).
5. Seed-vault coverage: extend `platform/test/seed-vault` with the pre-migration `spice/scratch/**` shape (reuse/extend the existing `spice/scratch/2026-06-14-test-scratch.md` fixture) and add an `HC-V0XYZ-SEED-MIGRATE-STICKY-*` assert family to `platform/test/run-seed-migrations.js` per the standard per-cycle migration-authoring loop (`Docs/agent-guides/migration-regression-net.md`).

### 2. Timing fix — more than one sticky note per minute

`new_entity_buttons[].destination.filename_date_pattern` for the `scratch`→`sticky-note` entry changes from `HH-mm` to `HH-mm-ss`, giving one-per-second granularity (effectively unlimited for manual clicking within a minute).

The leaf rule-fragment `naming_pattern` loosens to accept both the legacy 2-token and new 3-token timestamp shapes, so pre-migration files (still `HH-mm`) keep validating without a rename:
```
^Sticky-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d{2})?\.md$
```

### 3. Title banner on the leaf note

The leaf (`sticky-note`) template renders a banner immediately below the chrome bar, showing the note's `title` frontmatter as a heading. Owned by `StickyLeafActions` (folded in — no new class) so it renders in the same block as the existing action row, avoiding an extra inter-block gap.

- Non-empty `title` → renders as a heading-styled line.
- Empty `title` → renders "Untitled sticky note — click to name" in muted text.
- Click anywhere on the banner opens a small overlay prompt (same modal shape `EntityCreate`'s title prompt already uses) pre-filled with the current title; submit writes the new value via `app.fileManager.processFrontMatter` and the banner re-renders.

This directly replaces "stuck looking at a title of Scratch-2026-07-07-09-15" with either the real title or an obvious call-to-action.

### 4. All Sticky Notes view (hub)

`StickyHubCards` (the global hub's content renderer) gains a small **Days | All** segmented toggle rendered above its card area. Toggle state lives on `dv.container.__stickyHubMode` (survives re-render, same technique as the wiki blueprint's Recent/A–Z section-sort toggle) so it isn't lost on Dataview's dual-fire re-renders.

- **Days** (default, current behavior unchanged): one card per day with ≥1 sticky note, latest-edited-first.
- **All**: swaps the content area to a flat, recursive list of every sticky note across every day, newest-edited-first, fronted by the `doc-search` mechanism's strip UI:
  ```js
  customJS.DocSearch.render(dv, {
    scopePath: "spice/sticky-notes",
    recursive: true,
    entityType: "sticky-note",
    persist: false,
    hideTags: true,          // sticky notes don't currently carry a tags-facet UI
    onChange: (ctx) => { /* re-filter + re-render results */ }
  });
  ```
  - Title matching reuses `DocSearch.matches(page, ctx)` (case-insensitive substring on `file.name`).
  - **Content matching is new**: for any candidate that fails the title match, the helper does an async body-substring scan via `app.vault.cachedRead` and includes it if the search text appears in the body. This keeps the change scoped to the sticky-notes helper rather than altering `DocSearch.matches()`'s synchronous contract (which other consumers — wiki, project — rely on staying sync for use inside `dv.pages().where()`).
  - Each result card shows title (or "Untitled sticky note"), the day it belongs to, and an "edited X ago" meta; clicking opens the leaf note directly (not its day-hub).
  - No active filter text renders every sticky note (still flat/recursive, still newest-first) — "All" without typing is itself a valid state ("browse everything"), not just a search entry point.

## Testing

- Rename every `run-scratch*.js` harness file to `run-sticky-notes*.js` (or new names matching the class renames) and update every assertion string/class-name reference (`SHC-S1` version literal, etc.).
- New coverage for: HH-mm-ss filename generation + loosened naming-pattern regex (both token shapes), title-banner render + click-to-rename round-trip, Days/All toggle state persistence across re-render, All-view content-match (title-miss/body-hit case), and the install migration (seed-vault family above).
- Manual Cmd+R smoke per `Docs/agent-guides/smoke-checklists/scratch.md` (renamed to `sticky-notes.md`), since chrome/dialog rendering isn't covered by the headless harnesses.

## Out of scope

- No change to the underlying day-folder structure (`YYYY/MM-MMMM/YYYY-MM-DD`) — only the top-level folder and filename prefixes rename.
- No tag/label system for sticky notes beyond what already exists (this cycle doesn't add a tags-based filter to the All view; `hideTags: true` is deliberate).
- Not retrofitting existing leaf filenames to 3-token timestamps — the migration renames the prefix only, keeping whatever timestamp precision each file already has.
