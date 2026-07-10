# Section Explorer — polish pass (recent-docs pane, doc-card identity, rail air, note links) — design

Date: 2026-07-09

## Problem

v0.209.0 confirmed working on all vaults (screenshots reviewed). Five finishing touches requested for daily-use quality:

1. **Hub pane is wasted space.** The wiki hub (`spice/wiki/Wiki.md`) and project docs hubs (`.../docs/Docs.md`) have no root-level docs, so the pane region right of the section rail is empty (v0.209.0 suppresses it), while wiki's "Recently updated" grid sits below everything. Fill the pane with recently-updated docs instead, with clear separation from the rail.
2. **Doc cards vs section rows look too similar.** Both read as generic dark cards.
3. **Long section titles ellipsize hard** ("Microservice Deployment St…"). Should wrap/shrink naturally.
4. **Rail rows need more air** (~8px more vertical gap).
5. **MANDATORY: pinned links on every leaf doc.** Every `wiki-page` and project `doc-note` gets an "Add link" button at the top plus the saved links displayed as clickable cards parked at the top of the doc — same spirit as project links.

## Changes

### 1. Recently-updated docs fill the pane (replaces v0.209.0 suppression + WikiTree's own grid)

New optional adapter config `listRecent(dv, ctx) -> [{title, path, mtime, where}]` (already sorted desc, capped at 8 by the adapter). Pane logic in `SectionExplorer.render`/`_renderPagePane` becomes:

- `pages > 0` → normal: links row → "Docs"/"Pages" label → doc grid (unchanged order).
- `pages == 0 && sections > 0` → **recent mode**: pane renders with label **"Recently updated"** and cards from `listRecent` (each subtitled `in <section> · <ago>`). If `listRecent` is absent or returns empty, fall back to v0.209.0 suppression (no pane).
- `pages == 0 && sections == 0` (genuinely empty leaf) → pane with the empty-state message (unchanged behavior, now mechanism-owned markup).

Adapters:
- **wiki-tree.js**: `listRecent` ports the hub's existing "Recently updated" logic (recent `wiki-page`s across `spice/wiki`, `sectionOf` subtitle) into the config; the hub-only grid below SectionExplorer in `_renderResults` is **deleted** (moved, not duplicated). Sections (non-hub) get subtree-recent too (recent pages under their own folder) — same helper, scoped to `ctx.scopePath`.
- **project-docs-index.js** + **section-hub.js**: `listRecent` = recent `doc-note`s under the docs folder / section subtree, `where` via the existing `sectionByFolder`-style lookup (reuse `_sectionTrail`-adjacent logic: immediate-folder display title).

### 2. Mechanism-owned doc cards (BeaconCards leaves the pane)

`_renderPagePane` stops calling `BeaconCards` and renders its own cards — the mechanism owns its whole visual language, giving full CSS control for the doc-vs-section distinction:

- `.se-doc-grid` — 2-col grid desktop, 1-col on `.se-mobile`.
- `.se-doc-card` — click → `app.workspace.openLinkText(path, "")`. Contains:
  - `.se-doc-icon` — small rounded-square badge, accent-tinted background (`color-mix`-free: `rgba` via `--interactive-accent` + low-opacity trick is theme-unsafe, so use a bordered badge: transparent bg, 1px accent-muted border, accent icon) holding the file SVG. This badge is the "it's a document" identity mark — section rows keep their inline flat folder icon.
  - `.se-doc-body` — `.se-doc-title` (600 weight) + `.se-doc-sub` (muted; "edited 2h ago" in docs mode, "in <section> · 2h ago" in recent mode).
- Desktop separation: `.se-page-pane` gains `border-left: 1px solid var(--background-modifier-border); padding-left: 18px` (rail | pane divider). Not applied on `.se-mobile` (stacked).
- Empty-state box markup moves into the mechanism (same look as BeaconCards' message: dashed border, "Nothing here yet.").

`BeaconCards` itself is untouched and remains in use by the search-results paths and everything else in the vault. Card data shape is normalized in the mechanism: `listPages` results map to `{title: p.title || p.file.name, path: p.file.path, mtime: p.file.mtime?.ts, where: null}`; `listRecent` already returns that shape.

### 3. Rail title wrap

`.se-rail-title-text`: replace single-line ellipsis with a 2-line clamp (`display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; overflow-wrap:anywhere;`) at `font-size: 0.95em; line-height: 1.3`. Titles that still exceed two lines clamp with ellipsis; typical long titles wrap.

### 4. Rail air

`.se-rail-cards { gap: 4px }` → `gap: 12px`.

### 5. Leaf-note pinned links — `SectionExplorer.renderNoteLinks(dv)` via the chrome bars (zero body migration)

**Key architectural call: no template changes, no body heal.** `WikiChromeBar` and `ProjectChromeBar` already render on every existing + future `wiki-page`/`doc-note` (they're the only block in those bodies). Each adapter's `render(dv)` calls `customJS.SectionExplorer.renderNoteLinks(dv)` after the bar, gated by note type (`wiki-page` for wiki; `doc-note` for project), guarded cold-load-safe (no-op if SectionExplorer missing). Result: the feature lights up on every existing note instantly, with no migration, no template edit, no seed fixtures.

`renderNoteLinks(dv)`:
- Resolves the current page via `customJS.RenderSafe.page(dv)` when available (mobile cold-load lesson), falling back to `dv.current()`.
- Reads `page.links` (missing/empty tolerated).
- Renders a `.se-note-links` strip into `dv.container`: one `.se-note-link-card` per link (link SVG icon + text; safe-scheme handling identical to the existing chips — `_isSafeUrl`, `target=_blank`, `rel=noopener`, unsafe schemes render as dead text) + a trailing `.se-note-link-add` pill ("＋ Add link", always present — this is the "button at the top").
- "＋ Add link" opens the EXISTING `_openAddLinkForm` modal with a self-adapter for the current note: `getLinks` reads the note's frontmatter links, `writeLinks` uses `app.fileManager.processFrontMatter` on the current file (creates `links` key if absent). Dataview re-renders the block on the metadata change, so the new card appears without manual refresh.
- Never-throw; renders nothing but the add pill when there are zero links.

Frontmatter: `links: []` on `wiki-page`/`doc-note` created lazily on first write — **no backfill heal** (hundreds of leaf notes; touching them for an empty key is churn without benefit). `platform/schemas-index.json`'s `section-explorer-links-frontmatter` contract entry is updated: allowed note types now include `wiki-page` and `doc-note`; consumers gain `wiki-chrome-bar.js`, `project-chrome-bar.js`.

Blueprint manifests: `wiki` and `project` blueprints now genuinely depend on `section-explorer` (their chrome bars call it) — add `depends_on: section-explorer` to both blueprint manifests (this also closes the known punch-list gap; version RANGES only, no version bumps — the pipeline owns versions).

## Out of scope

Search-results rendering (still BeaconCards), BeaconCards itself, ChromeBar mechanism, link edit/delete on leaf notes (add-only, matching the section add-link affordance), frontmatter backfill heals.

## Files touched

| File | Change |
|---|---|
| `platform/mechanisms/section-explorer/section-explorer.js` | Mechanism-owned doc cards + empty state; recent mode (`listRecent`, "Recently updated" label); `renderNoteLinks` + note self-adapter. |
| `platform/mechanisms/section-explorer/section-explorer.css` | Doc-card/badge/grid styles, pane left divider, rail gap 12px, 2-line title clamp, note-links strip styles. |
| `platform/blueprints/wiki/helpers/wiki-tree.js` | `listRecent` in config; delete the hub-only Recently-Updated grid from `_renderResults`. |
| `platform/blueprints/project/helpers/project-docs-index.js` | `listRecent` in config. |
| `platform/blueprints/project/helpers/section-hub.js` | `listRecent` in config. |
| `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` | Call `renderNoteLinks` after the bar on `wiki-page`. |
| `platform/blueprints/project/helpers/project-chrome-bar.js` | Call `renderNoteLinks` after the bar on `doc-note`. |
| `platform/blueprints/wiki/manifest.json`, `platform/blueprints/project/manifest.json` | Add `depends_on: section-explorer` (range only). |
| `platform/schemas-index.json` | Extend the links contract entry (types + consumers). |
| `platform/test/run-section-explorer.js` | Update pane tests (BeaconCards → `se-doc-card`), add recent-mode, doc-card shape, `renderNoteLinks` (render + add-link write + safe-scheme + cold-load) tests, chrome-bar hook tests. |

## Testing

Node harness TDD as before. Existing tests asserting `BeaconCards.render` from the pane are REWRITTEN to assert `se-doc-card` elements (the behavior intentionally changed). New: recent-mode rendering + fallback suppression, doc-card normalization, `renderNoteLinks` (chips + add pill + write path via processFrontMatter spy + unsafe-scheme + missing-links tolerance), WikiChromeBar/ProjectChromeBar gating (leaf types only). Playwright HTML harness re-verification (desktop + 390px): doc-card vs rail-row distinction, pane divider, title wrap, rail air, note-links strip. Full `npm run release:preflight`.

## Rollout

PR → CI → automatic release/tap/brew (hands off versions/tags) → `brew upgrade sauce` → `sauce update --bump-pins` in accuris/headspace/ero → grep-verify deployed code. User Cmd+R.
