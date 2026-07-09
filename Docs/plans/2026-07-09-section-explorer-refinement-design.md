# Section Explorer — visual/UX refinement pass — design

Date: 2026-07-09

## Problem

`section-explorer` (the shared rail + page-pane mechanism used by Wiki hub/section and the Project blueprint's Docs sub-feature) shipped and is confirmed working structurally across all 3 consumer vaults (brew v0.208.1). This is a refinement pass on top of that confirmed-working baseline, addressing concrete UX friction reported after real usage, plus one genuine bug found via code + live-vault tracing.

## Scope

All changes land in the existing shared mechanism (`platform/mechanisms/section-explorer/`) plus two bug-fix deletions in the Project blueprint's adapters. No new mechanism, no new frontmatter fields, no new install heals, no manifest/schema changes.

Out of scope for this cycle (deferred, by user decision): the outstanding technical-debt punch list from the original implementation cycle (`MenuPopover` disabled-state styling, rename-cascade race documentation, fire-and-forget async in rename/delete, icon SVG duplication across files, missing `depends_on: section-explorer` manifest declarations).

## Root cause: docs not appearing in a project docs section

Verified against real vault data (`accuris-sauce`'s `spice/projects/global-k8s/docs/opensearch-multi-region/`): the folder genuinely contains 15 `doc-note` files directly in it, with `file.folder` matching the section-hub's computed `sectionPath` exactly. The query logic in `SectionHub`/`ProjectDocsIndex`'s `listPages` (`p.file.folder === sectionPath`) is structurally correct and mirrors `WikiTree`'s already-working equivalent.

The actual bug: `SectionHub.render` and `ProjectDocsIndex.render` (but *not* `WikiTree.render`) contain this pattern:

```js
const filterCtx = customJS.DocSearch.render(dv, {
  ...
  onChange: (ctx) => { this._currentCtx = ctx; ... },
});
...
if (this._currentCtx) {
  Object.assign(filterCtx, this._currentCtx);
}
```

`SectionHub`/`ProjectDocsIndex` are customJS singletons — confirmed via `ranch/views/customjs-guard/view.js`, which dispatches via `window.customJS?.[className]` — one shared instance is reused for *every* section-hub/docs-hub note in the vault. `DocSearch.render()` creates a brand-new `resultsContainer` DOM element on every call. The `Object.assign` line unconditionally overwrites the current render's fresh `filterCtx` (including its `resultsContainer`) with whatever `this._currentCtx` was left over from the *last* search interaction anywhere in the vault — a different section, a different project, even a stale render of the same note. Once that has happened once in a session, every subsequent hub/section note's docs render into a detached, invisible container: reads as "no docs" even though the query found real matches. `WikiTree` never implemented this restore mechanism, which is exactly why wiki works and project docs don't.

**Fix:** delete the `this._currentCtx` / `Object.assign(filterCtx, this._currentCtx)` mechanism from both `section-hub.js` and `project-docs-index.js`, matching `WikiTree`'s simpler pattern. `DocSearch`'s `persist:false` already means search starts empty on every visit, so there is no legitimate state worth restoring across renders.

## Changes

### 1. Rail header row (toggle placement + "Sections" label)

Combines two user asks into one component. `_renderRail` gains a header row, placed above the section-row list and below the search strip (replacing the current bottom-of-rail toggle):

- Left: a `SectionLabel`-style **"Sections"** text label.
- Right: the existing Recent/A–Z sort toggle pills (unchanged behavior, just relocated).

### 2. Rail row title/meta stacking

`_renderRailRow` changes from same-line `<title><meta>` to two stacked lines:

- Line 1: bold section title, full width, ellipsis-truncates on overflow.
- Line 2: smaller muted meta line (`N sections · M docs`), directly below.

Applies identically on mobile — stacking already reads cleanly at narrow widths, no separate mobile treatment needed.

### 3. Page-pane "Docs"/"Pages" header

`_renderPagePane` gains a `SectionLabel`-style header above the `BeaconCards` grid. Header text comes from a new adapter config field, `pageLabel` (optional; defaults to `"Docs"`). Wiki's `_buildConfig` sets `pageLabel: "Pages"`; the Project adapters (`SectionHub`, `ProjectDocsIndex`) leave it unset and get the default `"Docs"`.

Render order within the page pane, top to bottom: pinned-links row (if `links[]` non-empty) → the new header → the `BeaconCards` grid (or the empty-state message, per the suppression rule below).

### 4. Empty-state suppression

In `_renderPagePane`:

- If `pages.length === 0 && sections.length > 0`: skip the header, the pinned-links row, and `BeaconCards` entirely. There's nothing to show at this level, and (for the wiki hub specifically) the separate "Recently updated" grid immediately below already surfaces real content — a redundant "Nothing here yet." box directly above it added no value.
- If `pages.length === 0 && sections.length === 0` (a genuinely empty leaf — no sub-sections, no docs): keep the header + `BeaconCards`'s existing empty-state message (`"Nothing here yet."`) — this is a real "nothing here" case and should still say so.
- If `pages.length > 0`: render normally (header + grid), regardless of section count.

This logic is generic (keyed only on `pages.length`/`sections.length`), so it applies uniformly to all four render surfaces (wiki hub, wiki section, project docs-hub, project section-hub) without any per-blueprint branching in the shared mechanism.

## Files touched

| File | Change |
|---|---|
| `platform/mechanisms/section-explorer/section-explorer.js` | Rail header row (toggle + "Sections" label), stacked title/meta in `_renderRailRow`, page-pane header + empty-state suppression in `_renderPagePane`, new `pageLabel` adapter config field (optional, defaults `"Docs"`). |
| `platform/mechanisms/section-explorer/section-explorer.css` | Styling for the new rail header row, stacked title/meta rows, and page-pane header — mobile-safe via existing `.se-mobile`/`app.isMobile` convention. |
| `platform/blueprints/wiki/helpers/wiki-tree.js` | `_buildConfig` sets `pageLabel: "Pages"`. |
| `platform/blueprints/project/helpers/section-hub.js` | Delete the `this._currentCtx`/`Object.assign` restore mechanism. |
| `platform/blueprints/project/helpers/project-docs-index.js` | Delete the `this._currentCtx`/`Object.assign` restore mechanism. |
| `platform/test/run-section-explorer.js` | Extended (not replaced): new tests for the rail header row, stacked title/meta DOM shape, page-pane header + `pageLabel` default/override, empty-state suppression logic. New regression test loading `section-hub.js`/`project-docs-index.js` directly, simulating a prior render's `onChange` firing, then asserting a second render's `BeaconCards.render` call receives that render's own fresh `resultsContainer` (not a stale one) — proves the docs-not-showing bug is fixed and stays fixed. |

## Testing

Node-harness TDD throughout, same shape as the existing `run-section-explorer.js` suite (DOM-stub `createEl`/`querySelector`, `global.customJS` stubs for `BeaconCards`/`MenuPopover`/`SectionLabel`). No new install heal, so no new seed-vault fixtures needed. `run-seed-migrations.js` is unaffected.

## Rollout

Standard PR → CI → automatic release pipeline (per `Docs/agent-guides/build-test-verify.md`) — no manual version bumps, tags, or merges. After the release ships to brew: `brew upgrade sauce`, then `sauce update --force` (or `--bump-pins` if the mechanism version bump requires it) against each of `accuris-sauce`, `headspace-sauce`, `ero-sauce`, verified live.
