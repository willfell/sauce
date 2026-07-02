---
purpose: Canonical reference for the `wiki` blueprint — a standalone, arbitrary-depth, folder-is-truth knowledge base. Note types, the render helpers, chrome (breadcrumb path_walk + nav buttons + dividers), search, the Move tree dialog, the install heal, and the key decisions. Read before any wiki work.
load_when: Touching the wiki blueprint (spice/wiki/), its helpers, the breadcrumb path_walk mode, the doc-search mechanism, or debugging wiki render/chrome/move behavior.
---

# Wiki blueprint

A **standalone, project-independent, arbitrary-depth knowledge base** at `spice/wiki/`. It fills the gap the project blueprint's project-bound docs structurally can't hold — cross-project standing reference (glossaries, cheatsheets, cross-cutting topics). Shipped v0.163.0; polished through v0.177.x (mobile, move-tree, spacing). `module_directory: wiki`.

## The one-paragraph model

Three note types — `wiki-hub` (the single root `spice/wiki/Wiki.md`), `wiki-section` (a section hub in every folder, any depth), `wiki-page` (a leaf note). **Folder-is-truth: the folder path IS the hierarchy.** Frontmatter carries identity only (`type`, `title`, `created_at`, `tags[]`) — never structural position — so nesting is arbitrary, moves are just file renames, and the tree can never disagree with the folders. Every note renders the same chrome stack: `Breadcrumb` → `SpaceNavButtons` → a wiki action row → (hub/section only) `WikiTree`. Navigation is bidirectional: breadcrumb + explicit buttons go UP/home; cards + search go DOWN/across.

## Note types + frontmatter

```yaml
# wiki-hub  (spice/wiki/Wiki.md — one per vault)
type: wiki-hub
title: Wiki
dir: spice/wiki        # create-routing convenience only (see entity-create below)
tags: [wiki-hub]
```
```yaml
# wiki-section  (<folder>/<Title>.md, any depth)
type: wiki-section
title: "EMS"
dir: spice/wiki/ems    # this note's own folder (create-routing)
tags: [wiki-section]
```
```yaml
# wiki-page  (any leaf .md)
type: wiki-page
title: "VPC Peering Runbook"
tags: [wiki-page, networking]   # free tags power DocSearch
```

Type values are globally unique (no collision with project's `docs-hub`/`section-hub`/`doc-note`). Breadcrumb registry types must be globally unique — these satisfy that.

## customJS helpers (`platform/blueprints/wiki/helpers/`)

- **`WikiTree`** — renders the hub + every section note (dispatch on `dv.current().type`). **First calls `customJS.WikiHubActions.render(dv)` (best-effort, guarded) to draw the create/nav buttons at the top of its OWN container**, then instantiates the `DocSearch` strip (`persist: false` — wiki search is NOT remembered across visits), then `_renderResults` renders into `ctx.resultsContainer` via a `_makeProxyDv` shim. Rendering the buttons + search + cards in this single block is what lets it control the buttons↔search spacing (they used to be a separate `WikiHubActions` dataviewjs block + a `---`, which Obsidian spaced apart). Right after `DocSearch.render` it **normalizes the shared strip's top margin to `12px`** (`dv.container.querySelector(".doc-search-strip")`) so the gap above the search bar is IDENTICAL to the wiki-buttons↔divider gap. Three card lists: **Sections** (immediate child folders) render via **`_renderSectionCards`** as full-width **`layout: "row"`** cards — title on the left, rich `meta` on the right (`N sections · M docs · edited <ago>`) — **sorted by last-edited (`maxMtime` desc) by default with a `Recent | A–Z` toggle** (the mode lives on `dv.container.__wikiSectionSort` so it survives search re-renders; toggling re-sorts only these cards; a single section renders without a toggle). This is the ONE Sections renderer, so the toggle is consistent on the hub AND every section/sub-section; `sort: () => 0` keeps our pre-sorted order. BeaconCards' row layout stacks title-over-meta on `app.isMobile`. **Pages** (immediate pages) and, on the hub only, **Recently updated** (top-8 wiki-pages across the whole wiki, each tagged `in <section> · <ago>`) render as a **`layout: "stacked", columns: 2`** grid — the detail shows via **`subtitle`** (a muted second line), NOT `meta`, because **BeaconCards only renders `meta` in row layout** (in stacked cards `meta` is silently dropped — a real footgun). Pure, unit-tested helpers: `_immediateChildFolders(scopePath, pages)` (returns `{folder, title, hubPath, pageCount, subSectionCount, maxMtime}` — `pageCount` is recursive, `subSectionCount` counts immediate sub-section folders, `maxMtime` is the last edit of any note in the subtree; captures each child's real section-hub note so cards link to it, not a reconstructed slug), `_immediatePages`, `_recentPages`. Empty output renders nothing.
- **`WikiHubActions`** — the one-row action button block on hub + section notes. **Not a standalone dataviewjs block anymore — `WikiTree` calls it** (so the buttons render in the same block as the search bar). Renders a top `<hr>` divider (between the global nav row and the wiki buttons) AND a **bottom `<hr>`** (between the buttons and the search bar) — each with `12px` breathing room so the buttons aren't squished against the nav or the search. Between the dividers, `AccentButton`s: on a **section**, `[<section-name-of-parent>] [Wiki]` nav first, then `[+ New Section] [+ New Page]`; on the **hub**, just the two create buttons (it IS home). Create delegates to `customJS.EntityCreate.create({ instance, dv })`. `_mobilize(btn)` gives each button a min-width + ~half-row flex-basis so a phone wraps them 2-up instead of truncating.
- **`WikiLeafActions`** — the action row on wiki-page leaves. Renders a top `<hr>`, then **ONE centered row whose buttons stretch to fill the width evenly** — `[   Wiki   ] [   <section-name>   ] [   Move   ]` each `flex: 1` in a `max-width: 640px; margin: 0 auto` row — then a **bottom `<hr>`**. The leaf owns BOTH dividers, so the page template carries no trailing `---`. Buttons are sized by `_styleLeafBtn` (`flex: 1 1 0`, readable, `overflow:hidden`). Move-options are computed **lazily on click** (never at render) so a cold-loading `WikiMove` can't throw and blank the row. The Move dialog is an **indented tree** (see below).
- **`WikiMove`** — pure move logic. `sectionTargets(pages)` returns `[{folder, label, depth}]` in **depth-first tree order** (a lexical folder-path sort puts each parent immediately before its children; `depth` = folders under `spice/wiki`, root = 0). `targetPath` / `isNoop` / `async move(dv, folder)` → `app.fileManager.renameFile` (inbound links auto-update; no frontmatter rewrite — folder-is-truth).

## Chrome

- **Breadcrumb** uses the shared `breadcrumb` mechanism's **`path_walk` mode** (additive, wiki-only). The wiki manifest declares `breadcrumb.types.{wiki-hub,wiki-section,wiki-page}.path_walk = { root_label:"Wiki", root_dir:"spice/wiki", root_file:"Wiki.md" }`. `Breadcrumb._renderPathWalk` builds the trail from the file's folder path: root crumb → one crumb per intermediate folder (each resolved to its real section-hub note via `dv.pages` for the display title + link) → the current page (unlinked). Skips a self-crumb when the note IS its own section hub. Renders **prominent + mobile-legible** (`font-size: 1em`, non-muted, `.wiki-breadcrumb`) — ancestors-mode breadcrumbs (project/meetings) keep their compact style.
- **`SpaceNavButtons`** (nav-buttons mechanism) renders the global vault nav grid, incl. the **Wiki** nav button (`nav_buttons[]` in the manifest, `openLink → spice/wiki/Wiki.md`).
- **Dividers** are owned by the action helpers (`<hr>`), NOT the templates. Do not re-add `---` to the templates. Every separator + button row carries **~one line break of breathing room** — `12px` vertical margins on the dividers, `0` on the rows, so gaps stay a consistent single-line-break (not squished, not the big cross-block gap). On hub/section notes this only works because `WikiTree` renders `WikiHubActions` inline: two adjacent dataviewjs blocks always get an Obsidian inter-block gap no `<hr>` can close, so the ONLY way to control the buttons↔search spacing precisely is to render them in the same block.

## Search — `doc-search` mechanism

`DocSearch` graduated from the project blueprint to the shared `doc-search` mechanism at v0.163.0 (both `project` + `wiki` depend on it). `WikiTree` calls `customJS.DocSearch.render(dv, { scopePath, recursive:true, entityType:"wiki-page", persist:false, onChange })`. `persist:false` is deliberate — wiki search text is cleared when you leave a note (nothing in localStorage). `DocSearch.matches(page, ctx)` is the pure text+tag predicate consumers filter with (it matches on `file.name` — which for wiki pages IS the title — plus tags).

**Search is recursive & mode-switching (v0.180.x).** `_renderResults` branches on `ctx.hasActiveFilter`: with an **empty** box it renders the normal **browse** view (sections + this folder's docs + hub recently-updated); as soon as you **type**, it switches to **search** mode via `_renderSearchResults` — a flat `Results (N)` grid of EVERY matching `wiki-page` in the current note's **whole subtree**, recursively (the `dv.pages('"<scopePath>"')` query already returns the full subtree, so search naturally scopes to "the folder you're in and everything below it"). Each result card's subtitle is the section trail relative to the search root (`_sectionTrail` → `in <section> / <sub-section>`, using each folder's section-hub display title, falling back to the slug; a hit directly in the current folder reads `here`). Sorted most-recent-first (`sort: () => 0` preserves it). Clearing the box returns to browse (and the `Recent | A–Z` section-sort choice on `dv.container` survives the round-trip).

## The Move dialog (tree)

`WikiLeafActions._openMoveDialog` renders a custom overlay with an **indented tree list** of `sectionTargets` (minus the current folder): each row is indented by `depth*18px` with a `└` connector for nested sections, so the section → sub-section hierarchy is visible; clicking a row moves the note straight into that folder. (Replaced the old flat `<select>` at v0.177.1.)

## entity-create routing

Create buttons route by the **`{{current_file.folder}}`** substitution token (added to the entity-create mechanism at v0.163.0) — a new note lands in the *current note's real folder*, so nesting works from any hub/section regardless of a `dir` frontmatter field. `wiki-section` create → `<folder>/<slug>/<Name>.md`; `wiki-page` create → `<folder>/<Title>.md`.

## Install heal — `_healWikiChromeBody` (in `platform/install.js`)

`applyNoteChromeHeal` includes `spice/wiki`; wiki notes route through `_healWikiChromeBody(body, type)` — content-idempotent, backup-on-write. It (1) on hub/section notes, collapses everything between the `SpaceNavButtons` block and the `WikiTree` block — a legacy standalone `WikiHubActions` block, any legacy stacked `entity-create:wiki-*` blocks, AND the `---` divider — down to a single blank line (since `WikiTree` now renders the buttons; this also prevents a duplicate button row); (2) injects the full chrome header (breadcrumb + nav + the right action block — `WikiTree` for hub/section, `WikiLeafActions` for pages) into a bare/hand-made wiki note with no nav; (3) injects a breadcrumb when nav is present but a breadcrumb is missing; (4) strips the legacy template `---` immediately after a `wiki-page`'s `WikiLeafActions` block (the leaf renders its own bottom divider); (5) hub/section safety net — appends a `WikiTree` block if somehow none remains. Every heal is a no-op on already-correct notes.

## Manifest surfaces

`customjs_classes`: WikiTree, WikiMove, WikiLeafActions, WikiHubActions. `depends_on`: nav-buttons, customjs-guard, cards, accent-button, entity-create, section-label, breadcrumb, doc-search, render-safe, open-helpers, platform-claude. `nav_buttons[]`: the Wiki button (icon `journal` — `book-open` is not in the icons registry). `new_entity_buttons[]`: `wiki-section` + `wiki-page` (routed by `{{current_file.folder}}`). `rule_fragments[]`: wiki-hub + wiki-section. `claude_surface[]`: `/wiki` command + `new-wiki-page` skill + resolver row.

## Tests

`platform/test/run-wiki.js` (behavioral, load-via-`new Function`): WikiTree pure helpers + hubPath resolution, WikiMove targets/depth/tree-order, WikiLeafActions nav row + lazy-move no-throw, WikiHubActions one-row + section nav, recent-cards + section meta, persist-off, note icon, tree move-list, tight dividers. `run-breadcrumb.js` BC-WIKI-* covers path_walk. `run-seed-migrations.js` SEED-MIGRATE-WIKI-* covers the heal + registries against the seed wiki tree.

## Deploy note

**All three consumers are brew-only** (`workshop_relative_path = /opt/homebrew/opt/sauce/libexec`), NOT local-clone. Ship = let the pipeline tag+bottle, then `brew upgrade sauce` → per vault ensure `wiki` + `doc-search` are in `ranch/platform-subscription.json` (a new blueprint is not added by `--bump-pins` alone) → `sauce update --bump-pins`. **Class changes render only after `Cmd+R` in each Obsidian vault.**

## Key decisions / gotchas

- Folder-is-truth: never encode hierarchy in frontmatter. `dir` is a create-routing convenience only; render + move read the actual folder.
- BeaconCards navigates via **`target`** (→ openLinkText), NOT `link`; section card entries are plain objects (no `.file.path`), so a `link:` opt silently no-ops.
- Compute move-options / any WikiMove-dependent work lazily on click — never at render — so cold-load can't blank the row.
- Dividers live in the helpers, not the templates. Search does not persist. Breadcrumb path_walk is prominent (wiki-only).
