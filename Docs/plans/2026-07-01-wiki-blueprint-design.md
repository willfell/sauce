# Wiki blueprint — design

- **Date:** 2026-07-01
- **Topic:** `wiki` — a standalone, project-independent, arbitrary-depth docs/knowledge blueprint
- **Version:** pipeline-assigned (new blueprint `wiki@0.1.0` + new mechanism `doc-search@0.1.0`; umbrella `workshop_version` bump computed by the release bumper — NOT hand-set here)
- **Status:** approved (data model + reuse strategy approved in brainstorm 2026-07-01)

## 1. Goal & motivation

The `project` blueprint already ships a real docs hierarchy (`docs/Docs.md` hub → section-hubs → sub-sections → `doc-note` leaves), but **every doc is structurally bound to a project** via required `project` / `project_slug` frontmatter. Project-independent standing knowledge — link glossaries, command cheatsheets, cross-project topics (e.g. AccurIAM, Content-Registry), general reference — has **no home** in the current platform. In the accuris vault this content is stranded in the legacy pre-Sauce `old/Docs/` + `old/MOCs/` folders, never migrated, because no project can own it.

`wiki` fills that hole: a first-class, cross-project knowledge base with a hub, arbitrary-depth sections, search, and move — reusing the platform's chrome conventions (breadcrumb, section-label, nav-buttons, entity-create) and graduating the one genuinely-shared primitive (`DocSearch`) into a mechanism both `project` and `wiki` consume.

## 2. Scope

**In (v1 — this cycle):**
- New `wiki` blueprint owning `spice/wiki/`.
- Three note types: `wiki-hub` (root), `wiki-section` (folder hub, any depth), `wiki-page` (leaf).
- A global **Wiki** nav button in the top nav row.
- Root hub: global search + top-level section cards + recent-updates roll-up + loose root pages.
- Section hub (any depth): scoped search + immediate children (sub-section cards + page list) + create buttons.
- Wiki page: chrome (breadcrumb + nav) + a **Move** action.
- Create dialogs: `+ New Section` / `+ New Page` (folder-relative, so nesting is arbitrary).
- **Move within wiki** (relocate a page or section into another section folder).
- Graduate `DocSearch` → shared `doc-search` mechanism; repoint `project` to consume it.
- Full test coverage (see §11).

**Out (explicitly deferred to follow-on specs):**
- **Ingestion** — Obsidian Web Clipper capture flow + LLM/search pass over dumped content.
- **Project correlation** — relate / move a `wiki-page` into a project (bidirectional links); move a project doc out to the wiki.
- **MOC auto-index** — formalized "index note that queries a tag/type" generator (the `old/MOCs/` idiom).

These build cleanly on top of the v1 substrate and are called out so v1 stays a single, tight implementation plan.

## 3. Architecture — reuse strategy (Hybrid "C", approved)

- **Graduate ONLY `DocSearch`** to a shared `doc-search` mechanism. It is already entity-agnostic (takes an `entityType` opt), stable, and identical for both consumers. Exact precedent: `section-label` (v0.122.0) and `breadcrumb` (v0.123.0) graduations — promote the file to `mechanisms/<name>/`, register in the catalogue, add `depends_on`, drop the project-local copy, add the wizard default-subscription entry, index in schemas.
- **Build the arbitrary-depth tree renderer FRESH** in the `wiki` blueprint (`WikiTree`). The project's `SectionHub` is hard-wired to `depth: 1|2` + `parent_section` and cannot express arbitrary depth; a path-based recursive renderer is a genuinely different shape, so it lives in `wiki` and does not disturb project's proven section rendering.
- **`WikiMove`** stays wiki-local (folder-based; project's `DocMove` is frontmatter-section-based and project-specific).
- **`breadcrumb` mechanism gets an additive `path_walk` mode** (see §6.3) so wiki's arbitrary-depth trail is expressible while keeping note-chrome-lint conformance (breadcrumb-first + shared `Breadcrumb` class + manifest declaration). Gated behind a per-type registry flag; existing fixed-arity types are untouched.

Net mechanism churn: one graduation (`doc-search`) + one additive mode (`breadcrumb.path_walk`). Both are additive/low-risk and covered by existing + new harnesses.

## 4. Data model

### 4.1 Folder-is-truth (the key departure from project docs)

The project blueprint encodes hierarchy in frontmatter (`section`, `sub_section`, `parent_section`, `depth: 1|2`) — which is exactly what caps it at two levels. **`wiki` treats the folder path as the source of truth.** A page's place in the tree *is* its folder. Frontmatter carries only identity (`type`, `title`, `created_at`, `tags[]`), never structural position. This buys:

- **Arbitrary depth for free** — `spice/wiki/infra/aws/networking/vpc/…` nests as deep as desired; every folder with a `<Name>.md` section-hub is a section, every other `.md` is a page.
- **Trivial moves** — moving a doc is moving the file; there is no `depth`/`parent_section` frontmatter to rewrite and keep consistent.
- **No frontmatter drift** — the tree cannot disagree with the folder structure because the folder *is* the tree.

### 4.2 Note types

| Type | File location | Role |
|---|---|---|
| `wiki-hub` | `spice/wiki/Wiki.md` (one per vault) | Root. Global search + top-level section cards + recent-updates + loose root pages. |
| `wiki-section` | `<folder>/<Folder>.md` at any depth | Section hub. Renders its own immediate children (sub-sections + pages). |
| `wiki-page` | any other `.md` leaf | The document itself. Minimal chrome + content + Move action. |

**Section-hub naming rule:** a folder `spice/wiki/infra/aws/` is a section iff it contains a note whose basename matches the folder's title (slug-insensitive) carrying `type: wiki-section`. Convention: the section-hub note is named after the folder's display title (e.g. `AWS.md`). The installer/create flow always materializes the `<Folder>.md` hub when a section is created, so this invariant holds by construction; a heal (see §10) backfills any folder that has pages but no hub note (defensive — should not occur for wiki-native content).

### 4.3 Frontmatter schemas

```yaml
# wiki-hub (one per vault)
type: wiki-hub
created_at: "<ISO-8601>"
tags: [wiki-hub]
```
```yaml
# wiki-section (one per folder)
type: wiki-section
title: "Infra"                 # display name (folder title)
created_at: "<ISO-8601>"
tags: [wiki-section]
```
```yaml
# wiki-page (leaf)
type: wiki-page
title: "VPC Peering Runbook"
created_at: "<ISO-8601>"
tags: [wiki-page, networking, aws]   # free tags power DocSearch
```

Type values `wiki-hub` / `wiki-section` / `wiki-page` are globally unique (no collision with project's `docs-hub` / `section-hub` / `doc-note`). Breadcrumb registry types are first-match-wins and must be globally unique — these satisfy that.

## 5. Surfaces (what the user sees)

### 5.1 Top nav button — "Wiki"
A global nav-button contribution (`nav_buttons[]` in the wiki manifest) renders a **Wiki** button in the `SpaceNavButtons` row on every note (like Scratch / To-Do). Action: `openLink` → `spice/wiki/Wiki.md` (the root hub is installed as a content file, so it always exists). This is the "new button on the nav bar at the top" the user asked for — one tap from anywhere into the wiki.

### 5.2 Root hub — `spice/wiki/Wiki.md` (`type: wiki-hub`)
Rendered top-to-bottom:
1. `Breadcrumb` (renders just `Wiki`).
2. `SpaceNavButtons`.
3. `EntityCreate` buttons: `+ New Section`, `+ New Page` (both create at the wiki root).
4. `DocSearch` strip — **global**: `scopePath: spice/wiki`, `recursive: true`, `entityType: wiki-page`. Text + tag chips + scoped Obsidian-search button, localStorage-persisted. This is the "search mechanism within it."
5. `WikiTree` (hub mode): top-level **section cards** (each: page+subsection count, last-updated, most-recent child) sorted by recency; then a **Recently updated** roll-up (N most-recently-edited pages across the whole wiki); then any **loose pages** living directly at the root.

### 5.3 Section hub — `<folder>/<Folder>.md` (`type: wiki-section`, any depth)
1. `Breadcrumb` (path-walk trail: `Wiki / … / <this section>`).
2. `SpaceNavButtons`.
3. `EntityCreate` buttons: `+ New Sub-section`, `+ New Page` — both create **inside the current folder** (folder-relative destination → arbitrary depth falls out naturally).
4. `DocSearch` strip — **scoped**: `scopePath: <this folder>`, `recursive: true`, `entityType: wiki-page`.
5. `WikiTree` (section mode): immediate **sub-section cards**, then immediate **pages** (list, mtime-desc), each filtered through the live `DocSearch` context. `SectionLabel` separates "Sub-sections" / "Pages" (only when both present).

### 5.4 Wiki page — leaf (`type: wiki-page`)
1. `Breadcrumb` (path-walk trail to the page).
2. `SpaceNavButtons`.
3. `WikiLeafActions`: a **Move** button (opens the move dialog, §6.4). (Backlinks panel optional/deferred — reuse `backlink-panel` mechanism if cheap.)
4. `---` then the user's content.

## 6. Rendering primitives & new classes

### 6.1 `doc-search` mechanism (graduated)
- Relocate `platform/blueprints/project/helpers/doc-search.js` → `platform/mechanisms/doc-search/doc-search.js` verbatim (class name stays `DocSearch`; callers `customJS.DocSearch.*` unchanged).
- Add `platform/mechanisms/doc-search/manifest.json` (`name: doc-search`, `version: 0.1.0`, `files[]` installs the class to the mechanism scripts path, mirroring how `section-label` / `breadcrumb` mechanisms install).
- Register `{name: doc-search, version: 0.1.0, path: mechanisms/doc-search}` in `platform/manifest.json` `mechanisms[]`.
- `project` manifest: drop `doc-search.js` from `files[]`, drop `DocSearch` from `customjs_classes`, add `depends_on: doc-search >=0.1.0`.
- `wiki` manifest: `depends_on: doc-search >=0.1.0`.
- `platform/bootstrap-lib/wizard.js`: add `doc-search` to the fresh-vault default mechanism subscription (project is default-subscribed and now depends on it — the `wizard.DEFAULT_MECHANISMS_CHECKED` lag trap).
- `schemas-index.json`: re-owner any existing doc-search-related entry to the mechanism; add a helper-read-contract entry if warranted.

### 6.2 `WikiTree` (new, wiki-local, recursive/path-based)
One customJS class rendering both hub mode (`wiki-hub`) and section mode (`wiki-section`), dispatching on `dv.current().type`. Path-based: enumerates immediate child folders (each with a `<Folder>.md` → a section card) and immediate child pages, from the current note's folder. Uses the `proxyDv` shim pattern (forward `current`/`pages` to real `dv`, mint `el`/`header` onto the `DocSearch.resultsContainer`) so results re-render on filter change without rebuilding the search strip. Reuses `cards`/`accent-button` mechanisms for card rendering; `SectionLabel` for group headers. Empty output renders nothing (convention).

### 6.3 `breadcrumb` path-walk mode (additive mechanism change)
Extend `platform/mechanisms/breadcrumb/breadcrumb.js` so a registry type may declare `"path_walk": { "root_label": "Wiki", "root_dir": "{{module_directory}}", "hub_basename_matches_folder": true }` instead of a fixed `ancestors[]`. In that mode `Breadcrumb.render` splits the current file's path under `root_dir`, emits `root_label` linked to `<root_dir>/Wiki.md`, then one linked crumb per folder segment (linking each to that folder's `<Folder>.md` section-hub), then the current page (plain). This keeps: breadcrumb-first, the shared `Breadcrumb` class in templates, and a `breadcrumb` manifest declaration — so `lint-note-chrome` stays green. Existing fixed-arity types are unaffected (mode is opt-in per type). Covered by extending `run-breadcrumb.js`.

*Fallback if planning finds this too invasive against the real `breadcrumb.js` / `lint-note-chrome.js`:* a wiki-local `WikiBreadcrumb` class reusing breadcrumb CSS, with a `lint-note-chrome` allowance. The plan resolves this against the actual lint source before writing code; the additive-mode path is preferred.

### 6.4 `WikiMove` + `WikiLeafActions` (new, wiki-local)
- `WikiMove`: pure-ish logic — enumerate all `wiki-section` folders in `spice/wiki/` as move targets; move the active file into the chosen folder via Obsidian `fileManager.renameFile` (so inbound links auto-update); no frontmatter rewrite needed (folder-is-truth). Precedent shape: project's `doc-move.js`, simplified.
- `WikiLeafActions`: renders the Move button on a `wiki-page` (and optionally a "Move section" on a `wiki-section`), wired to `WikiMove`. Static helper methods for the move logic so a behavioral harness can exercise them headlessly (browser modal is dogfood-only).

### 6.5 Reused mechanisms (dependencies)
`nav-buttons`, `customjs-guard`, `entity-create`, `section-label`, `breadcrumb`, `accent-button`, `cards`, `render-safe`, `open-helpers`, `icons`, and the new `doc-search`. (Backlink-panel optional.)

### 6.6 customJS classes owned by `wiki`
`WikiTree`, `WikiMove`, `WikiLeafActions`. (Plus possibly `WikiHubMigrateInit` startup class only if a heal is needed — see §10; prefer none.)

## 7. Manifest wiring (`platform/blueprints/wiki/manifest.json`)

Authored by diffing against `blueprints/scratch/manifest.json` + `blueprints/project/manifest.json` (canonical precedent — never author a manifest from memory). Key blocks:

- `name: wiki`, `version: 0.1.0`, `kind: blueprint`, `module_directory: wiki`, `skills_dir: .claude/skills/wiki`.
- `depends_on[]`: the §6.5 list with `>=` ranges matching current catalogue versions.
- `breadcrumb.types`: `wiki-hub`, `wiki-section`, `wiki-page` (hub uses a trivial ancestors trail; section + page use `path_walk`).
- `customjs_classes`: `WikiTree`, `WikiMove`, `WikiLeafActions`.
- `nav_buttons[]`: one **Wiki** button (`openLink` → `{{module_directory}}/Wiki.md`, an `order` slotting near Scratch/To-Do, `icon` a Lucide name e.g. `book-open` / `library`).
- `new_entity_buttons[]`: `wiki-section` (prompt: section name; destination = current file's folder + slug; materializes `<Name>.md` section-hub) and `wiki-page` (prompt: title; destination = current file's folder; materializes a page). Both use `render_in` to inject onto the hub + section templates at `entity-create:*` sentinels. Folder-relative destination (derive from `current_file`) is what enables arbitrary depth from any hub.
- `files[]`: templates (`Wiki.md` root hub, `Section Hub.md`, `Wiki Page.md`) → `{{templates_path}}/…`; helpers (`wiki-tree.js`, `wiki-move.js`, `wiki-leaf-actions.js`) → `{{scripts_path}}/wiki/…`; content (`Wiki.md` root hub note) → `{{module_directory}}/Wiki.md`.
- `claude_surface[]`: `/wiki` command (`commands/wiki.md`), a `new-wiki-page` skill, and `claude_md_row` resolver row (`Wiki` → `{{module_directory}}` → `/wiki`).
- `rule_fragments[]`: `wiki-hub`, `wiki-section`, `wiki-page` (path globs under `spice/wiki/**`, required frontmatter, naming/type asserts). Indexed in `schemas-index.json`.

## 8. Templates

All templates follow note-chrome: `Breadcrumb` → `SpaceNavButtons` → (entity-create marker / content). No `## H2`, no `---` between breadcrumb and nav, SectionLabel owns section dividers, dataviewjs blocks via `ranch/views/customjs-guard`.

- `Wiki.md` (root hub content note + template): breadcrumb, nav, `entity-create:wiki-section` + `entity-create:wiki-page` markers, `WikiTree`.
- `Section Hub.md`: breadcrumb, nav, `entity-create:wiki-section` + `entity-create:wiki-page` markers, `WikiTree`.
- `Wiki Page.md`: breadcrumb, nav, `WikiLeafActions`, `---`.

## 9. Slash command + skill
- `/wiki` command (`commands/wiki.md`): navigate — open the root hub, create a section/page, find a page by title/tag. Mirrors `/scratch` / `/project` command shape.
- `.claude/skills/wiki/new-wiki-page/SKILL.md`: create a new wiki page (respecting the pre-write self-check). Mirrors `scratch/new-scratch`.

## 10. Install-time migration / heal

`wiki` is brand-new: there is **no pre-existing consumer content** to migrate, so no reshaper is needed (and per the migration-lifecycle gate, one-time reshapers must be version-gated — we simply have none). The only install-time actions:
- Materialize `spice/wiki/Wiki.md` root hub if absent (standard content-file install; `materialize_once` on the hub so user edits are never clobbered — the `materialize_once` landmine).
- The `doc-search` graduation needs **no note heal**: project's existing `doc-note` notes call `customJS.DocSearch` which still resolves to the same class name, now provided by the mechanism. Verify via the seed-migration harness (project docs still render + search).
- Optional defensive heal `WikiSectionHubBackfill` (a folder with pages but no `<Folder>.md`): include ONLY if cheap and covered; otherwise deferred (wiki-native content always creates the hub by construction).

## 11. Testing strategy (heavy — a core requirement of this cycle)

1. **`run-wiki.js`** (new behavioral harness, wired into `release:preflight`): load `WikiTree`, `WikiMove`, `WikiLeafActions` into the sandbox; assert — WikiTree hub vs section dispatch, immediate-child enumeration (folders→section cards, files→pages), recency sort, empty-renders-nothing; WikiMove target enumeration + destination-path computation + no-op on same-folder; WikiLeafActions button presence + move wiring. Scaffold via `npm run scaffold-harness -- v0XXX wiki`.
2. **`run-doc-search.js`** (new): the graduated mechanism in isolation — `render()` strip survives keystrokes (permanent strip + transient results), `matches()` text + tag AND-logic, tag-count, localStorage persistence, `entityType` scoping. Plus a **parity assert** that project's docs surface still consumes it (project `ProjectDocsIndex`/`SectionHub` load with `DocSearch` resolved from the mechanism).
3. **`run-breadcrumb.js`** (extend): `path_walk` mode — root label + per-segment crumbs + current page for a synthetic `spice/wiki/a/b/Page.md`; existing fixed-arity types still pass.
4. **Seed-vault migration family** `HC-V0XXX-SEED-MIGRATE-WIKI-*`: extend the seed with (a) a `spice/wiki/` tree (hub + nested sections + pages) subscribed via seed `platform-subscription.json`, and (b) a pre-graduation project docs state, asserting post-install that `spice/wiki/Wiki.md` exists with `type: wiki-hub`, nested section-hubs + pages materialize, project docs still render, and idempotency holds. Rebaseline is post-merge/manual per the seed protocol.
5. **Lint gates** (already in preflight — must stay green): `lint-note-chrome` (breadcrumb-first + no `## H2` + manifest decl for the new types), `lint-cold-load` (all wiki dataviewjs callsites render-safe), `lint-display-markers` (no display-marker keying), `lint-schemas` (rule_fragments + any new schema indexed), `check-version-sync`.
6. **`run-customjs-loadable.js`**: the 3 new class files + the relocated `doc-search.js` load as bare classes (the "no trailing statements" landmine) — auto-discovered by the loader scan.
7. **Workshop dogfood**: add `wiki` + `doc-search` to the workshop `ranch/platform-subscription.json`; `node platform/install.js --vault . --auto-approve` must succeed (catches manifest entry order + materialization paths).
8. **`release:preflight-bumped`** on a clean tree before merge (catches a `prepare-release` wedge from the new component versions).

## 12. Release & deploy plan

1. Land the work on `cycle/wiki-blueprint` via **conventional commits** (`feat(wiki):`, `feat(doc-search):`, `refactor(project):`, `feat(breadcrumb):`, `test(...)`, `docs(plans):`). No hand-versioning, no tags, no pin sweeps.
2. Open the PR → CI (`release:preflight` on macOS + Ubuntu) must go green.
3. Merge the **feature** PR to `main`. The auto-release pipeline computes versions (new `wiki` + `doc-search` + umbrella bump), opens + auto-merges the **release** PR, tags `v<X.Y.Z>`, ships to brew. **Never** admin-merge the release PR; unstick a BEHIND-wedge only via `gh pr update-branch`.
4. After the release lands on `main`, pull it into the local workshop clone.
5. **Deploy to consumers** (they resolve to this local clone): for `ero-sauce` → `headspace-sauce` → `accuris-sauce`, **add `wiki` (+ `doc-search`) to each `ranch/platform-subscription.json`** (a new blueprint is not added by `--bump-pins` alone — the transitive-add trap), then `sauce update --bump-pins` + `sauce install`, then `sauce status` → expect `drift: none` and matching git head. Verify `spice/wiki/Wiki.md` materialized with `type: wiki-hub` in each.

## 13. Risks & mitigations

- **`doc-search` graduation breaks project docs** — mitigate: verbatim relocation (class name unchanged), seed-migration parity assert, workshop dogfood, `run-doc-search.js` + existing project harnesses.
- **Wizard default-subscription lag** — mitigate: add `doc-search` to `DEFAULT_MECHANISMS_CHECKED` in the same commit (known trap; fresh-vault CI catches it).
- **`prepare-release` wedge from new component version literals** — mitigate: version assertions read the snapshot SSOT; run `release:preflight-bumped` pre-merge.
- **Breadcrumb path-walk vs lint-note-chrome** — mitigate: resolve the additive-mode-vs-wiki-local decision against the real lint source during planning before writing code.
- **Autoloop cron collision on `main` / release pipeline** — mitigate: isolated worktree for the build; at merge/pipeline time, watch for a concurrent release PR and reconcile (BEHIND-wedge via `update-branch`, never admin-merge the release PR).
- **customJS trailing-statement load failure** — mitigate: bare-class files only; `run-customjs-loadable.js` gate.

## 14. Success criteria

- `release:preflight` green (all harnesses incl. new `run-wiki.js`, `run-doc-search.js`, extended `run-breadcrumb.js`, seed-migration WIKI family).
- Feature PR merged; pipeline ships a new `v<X.Y.Z>` with `wiki` + `doc-search` in the catalogue.
- `ero-sauce`, `headspace-sauce`, `accuris-sauce` all on the shipped version with `spice/wiki/` materialized, `drift: none`.
- A user can, from any note: tap **Wiki** → land on the hub → create a section → nest a sub-section → create a page → search across the wiki → move a page between sections — with breadcrumb + nav chrome consistent with the rest of the vault.
