# Section Explorer — design

Date: 2026-07-08

## Problem

Wiki and the Project blueprint's Docs sub-feature independently render "a hub/section full of sections and pages" as a flat, vertically-stacked list of cards. Sections and pages carry no strong visual distinction (in the project blueprint's `SectionHub`, sub-sections and docs render as *identical* rows — same layout, differing only by a small inline SVG icon). `BeaconCards`, the shared card renderer both surfaces already use, has zero CSS classes or data hooks — everything is inline JS styling — so there's no shared visual language to extend today. Section management is also incomplete: you can move a page/doc between sections, but you cannot rename or delete a section, and there's no way to pin a quick-reference link at the top of a section.

## Scope

One new mechanism, **`section-explorer`**, consumed by all four existing render surfaces:

| Surface | File | Class | Note type(s) |
|---|---|---|---|
| Wiki hub + section | `platform/blueprints/wiki/helpers/wiki-tree.js` | `WikiTree` | `wiki-hub`, `wiki-section` |
| Project docs hub | `platform/blueprints/project/helpers/project-docs-index.js` | `ProjectDocsIndex` | `docs-hub` |
| Project section hub | `platform/blueprints/project/helpers/section-hub.js` | `SectionHub` | `section-hub` |

`wiki-page` leaves and project `doc-note` leaves are unaffected — only the four hub/section render surfaces above.

Out of scope for this cycle: `DocSearch`'s flat search-results grid (already correct, unaffected), `ChromeBar`/breadcrumb (stays exactly as-is, sits above this), reordering pages within a section beyond the existing Recent/A–Z toggle.

## Architecture

New mechanism at `platform/mechanisms/section-explorer/`, same shape as `chrome-bar` (v0.199.0 precedent — extract a shared primitive, then thin-adapter every consumer):

- **`SectionExplorer.render(dv, adapter)`** — entry point. Picks two-pane (desktop) vs mobile-drawer layout by container width (same width-detection convention `_mobilize`/`_styleLeafBtn` already use elsewhere in this codebase), wires the rail, the page pane, and the entrance animation.
- **`SectionExplorer.makeAdapter(config)`** — factory each blueprint's helper calls to build its adapter (mirrors `ChromeBar.makeAdapter`). `config` supplies: how to list immediate child sections (folder-is-truth walk), how to list immediate pages, the section/page target-path functions, and the icon set. The mechanism has no idea "wiki" or "project" exists.
- Internal render pieces:
  - `_renderRail(dv, adapter, sections)` — left column. Each row: folder icon, title, meta (`N sections · M docs · edited <ago>`, same Recent/A–Z toggle the existing `_renderSectionCards` already has), and an inline **⋯** (via `MenuPopover`) exposing Rename / Add link / Delete.
  - `_renderPagePane(dv, adapter, selectedSection)` — right column. Pinned-links row (if `links[]` non-empty) at the top, then the page grid via the *existing, untouched* `BeaconCards` (`layout:"stacked", columns:2`).
  - `_renderMobileDrawer(dv, adapter, sections)` — below the mobile width threshold, the rail collapses into a disclosure/accordion strip stacked above the page pane instead of a side column. Same inline ⋯ per row, tap instead of hover (mirrors `MenuPopover`'s existing bottom-sheet mobile mode).
- Reused as-is, untouched: `BeaconCards` (still just draws cards — no new responsibilities), `MenuPopover` (row ⋯ menu, danger-styled Delete row), `SectionLabel`, `DocSearch`, `ChromeBar` (breadcrumb/nav is a separate concern, unaffected).
- `WikiTree`, `ProjectDocsIndex`, and `SectionHub` are retired down to thin adapters: each builds its `config` (folder walk + icon set + note-type specifics) and calls `SectionExplorer.render(dv, adapter)`. No dual-maintenance — the old inline section/page card-rendering bodies are deleted once each adapter is proven (see Rollout).

## Data model

One new frontmatter field, `links: []`, allowed on `wiki-hub`, `wiki-section`, `docs-hub`, and `section-hub` note types. Shape mirrors the existing `ProjectLinksManager` pattern exactly (`{url, text}` entries, `text` defaults to `url`, duplicate `url` rejected) — the pure `addLink`/`updateLink`/`deleteLink` mutation logic is reused rather than reinvented, just retargeted at whichever hub/section note is currently open instead of a dedicated Link Hub note.

Registered in `platform/schemas-index.json` as a new frontmatter contract per `Docs/agent-guides/schemas.md` (exact contract-kind and note-type entries authored during implementation, following the `task-entity-frontmatter` precedent for shape).

No new field is needed for section naming or ordering — folder-is-truth stays true (name comes from the folder path + the hub note's existing `title` field; ordering stays the existing Recent/A–Z toggle, `dv.container.__wikiSectionSort`-equivalent state).

## CRUD operations

**Add link** — reuses `ProjectLinksManager`'s add/edit form (`_openForm`/`_openModal`) retargeted to write the *currently open* hub/section note's `links[]` via `processFrontMatter`. Rendered as a small pinned row above the page grid, only when non-empty (per the existing "empty output renders nothing" rule).

**Rename** — folder-is-truth stays true: rename = rename the folder + update the hub note's `title` field, using the exact `renameFile` mechanics `WikiMove`/`doc-move.js` already use (inbound links auto-update, no frontmatter position rewrite). Triggered from the rail row's inline ⋯.

**Delete** — blocked (grayed out, non-interactive) unless the section has zero immediate pages *and* zero immediate sub-sections (computed the same way `_immediateChildFolders`/`_immediatePages` already count today). No cascade, no silent data movement — forces an explicit Move first via the existing Move dialog. Uses Obsidian's normal file-manager delete (respects the user's system-trash-vs-vault-trash setting). Danger-styled row via `MenuPopover`'s existing `danger` row support.

## Layout, mobile, and animation

- **Desktop:** two-pane split — section rail on the left, page pane on the right.
- **Mobile:** rail collapses to an accordion/disclosure strip stacked above the page pane (no side-by-side panes on narrow viewports); inline ⋯ per row still available, tap-triggered.
- **Animation:** reuses the `sauce-home.css` vocabulary and CSS custom-property tokens (staggered fade + slight-rise for rail rows, a soft scale+blur reveal for the page pane) as the new mechanism's own small CSS asset — consistent with the rest of the vault, and the existing "natural state fully visible" convention means reduced-motion is automatically safe.

## Migration & rollout

**A. Body-marker heals.** Every existing `wiki-hub`/`wiki-section` note has a `[WikiChromeBar][WikiTree]` marker block; every `docs-hub` note has `[ProjectChromeBar][ProjectDocsIndex]`; every `section-hub` note has `[ProjectChromeBar][SectionHub]`. Swapping the second marker for the new adapter class is a body-marker replacement, same shape as `_healWikiChromeBody`:
- `_healWikiSectionExplorerBody` — swaps `WikiTree` → the wiki `SectionExplorer` adapter class. `WikiChromeBar` above it is untouched.
- `_healProjectSectionExplorerBody` — same swap for both `docs-hub` and `section-hub` bodies (their second marker becomes the project `SectionExplorer` adapter class; `ProjectChromeBar` above it untouched).

Both idempotent, backup-first, path+content-guarded (per the v0.200.2 collision lesson — never guard on path alone).

**B. Frontmatter heal.** Add `links: []` to any hub/section note missing it, across all four note types, using the same idempotent, backup-first, quote-strip-aware shape as the v0.178.5 frontmatter fix (that heal was bitten once by quoted values hiding real matches — the new heal's detection must not repeat that).

**C. Seed-vault regression coverage.** Add fixtures to `platform/test/seed-vault/` for pre-migration notes (old marker, no `links` field) across all four note types; run both heals; assert idempotency (second run is a no-op) and correctness (marker swapped, field added, existing body content preserved), per `Docs/agent-guides/migration-regression-net.md`'s per-cycle authoring loop.

**D. Build order.** The spec targets all four surfaces, but the mechanism is built and proven against **wiki** first (folder-is-truth is the simplest, best-understood case — one class, `WikiTree`, already dispatches both hub and section). Once its heal + seed-vault fixtures are fully green, the project adapter (covering both `ProjectDocsIndex` and `SectionHub`) is built reusing the proven mechanism. This mirrors exactly how `chrome-bar` shipped — wiki first (v0.200.0), then batched to the rest.

**E. Old renderer retirement.** `WikiTree`'s current inline section/page-card rendering body, and the equivalent portions of `ProjectDocsIndex`/`SectionHub`, are deleted once their adapter is proven — no long-term dual code path.

**F. Consumer subscription.** `section-explorer` is a *new* mechanism, not a version bump of an existing one — per prior experience (v0.185.0, v0.199.0), it is not auto-installed to consumer vaults. Each of `accuris`/`headspace`/`ero`'s `ranch/platform-subscription.json` needs the new entry added, then a scoped `sauce update --force` run per vault, per `Docs/agent-guides/build-test-verify.md` § Deploying a NEW mechanism/blueprint to consumers.

## Testing

Per-helper TDD (faithful DOM-stub tests, not hand-built HTML replicas — see the `RenderInlineLinks`/`renderTaskRow` precedent for why): render output, rail-row ⋯ wiring, and each CRUD mutation (`addLink`/`renameSection`-equivalent/delete-guard) get direct unit coverage against minimal Dataview/DOM/Obsidian-app stubs, plus the seed-vault regression pass described above. New behavioral harness added to `platform/test/run-*.js`, wired into `release:preflight`.

## Release process note

Per `Docs/agent-guides/build-test-verify.md`: merging the feature PR into `main` (once CI is green) is the only manual step. Version bump, the release PR, the git tag, the Homebrew tap patch, and the tap PR are **all fully automated** (`release.yml` → auto-merge → `tag-and-ship` → auto-merges the tap PR) — none of those get touched or merged by hand; they are verified, not performed.
