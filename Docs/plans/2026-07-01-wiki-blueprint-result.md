# Wiki blueprint — result

- **Date:** 2026-07-01
- **Version:** v0.162.0 (pipeline-computed; wiki 0.2.0 + doc-search 0.2.0 + breadcrumb 0.2.0 + project 1.32.1)
- **Design + plan:** `Docs/plans/2026-07-01-wiki-blueprint-{design,plan}.md`
- **Branch:** `cycle/wiki-blueprint`

## What shipped

A standalone, project-independent, arbitrary-depth **`wiki` blueprint** (`spice/wiki/`) — the home for cross-project standing knowledge that the project blueprint's docs (bound to a project) structurally can't hold.

- **Three note types** (globally-unique; no collision with project `doc-*`): `wiki-hub` (root `spice/wiki/Wiki.md`), `wiki-section` (a section hub in every folder, any depth), `wiki-page` (leaf).
- **Folder-is-truth:** the folder path *is* the hierarchy; frontmatter carries identity only (`type` / `title` / `created_at` / `tags[]`, plus a create-routing `dir`). Arbitrary depth, trivial moves, no structural-frontmatter drift.
- **Global "Wiki" nav button** (`openLink` → `spice/wiki/Wiki.md`) in the top nav row on every note.
- **Root hub** (`WikiTree` hub mode): global DocSearch strip + top-level section cards + "Recently updated" roll-up + loose root pages.
- **Section hub** (`WikiTree` section mode, any depth): scoped DocSearch + immediate sub-section cards + page list + `+ New Sub-section` / `+ New Page` (folder-relative → arbitrary nesting).
- **Wiki page** (`WikiLeafActions`): a **Move** button (relocates a page/section into another section folder via `app.fileManager.renameFile`, links auto-update).
- **`/wiki` command + `new-wiki-page` skill + CLAUDE.md resolver row.**

### Cross-cutting

- **`DocSearch` graduated to a shared `doc-search` mechanism** (relocated verbatim; class name unchanged). `project` now `depends_on doc-search` and dropped its local copy; `wiki` consumes the same mechanism. Exact precedent: the `section-label` (v0.122.0) + `breadcrumb` (v0.123.0) graduations. Wizard fresh-vault default subscription gained `doc-search`.
- **`breadcrumb` mechanism gained an additive `path_walk` mode** so arbitrary-depth wiki trails are expressible while keeping the shared `Breadcrumb` class + note-chrome-lint conformance. The installer's `applyBreadcrumb` validator was extended to accept `path_walk` entries alongside `ancestors[]`.

## Surfaces hit

- New: `platform/mechanisms/doc-search/` (+ manifest, catalogue entry). New: `platform/blueprints/wiki/` (manifest, 3 templates, root-hub content note, 3 helpers, command, skill).
- Modified: `platform/mechanisms/breadcrumb/breadcrumb.js` (+`_renderPathWalk`), `platform/install.js` (breadcrumb validator accepts `path_walk`), `platform/blueprints/project/manifest.json` (drop DocSearch, add dep), `platform/bootstrap-lib/wizard.js` (default sub), `platform/schemas-index.json`, `platform/manifest.json` (catalogue), workshop + seed `platform-subscription.json`.
- Tests: NEW `run-wiki.js` (12), NEW `run-doc-search.js` (9), extended `run-breadcrumb.js` (+4 `BC-WIKI-*`), seed `SEED-MIGRATE-WIKI-*` family (+7 → 288), repointed the DocSearch contract asserts in `run-helper-cases.js` + `run-v0127-project-hub-heal.js` to the mechanism, bumped mechanism-count assertions 24→25.

## Verification

- `npm run release:preflight` — GREEN (all harnesses, merged with origin/main v0.161.1).
- `npm run release:preflight-bumped` — GREEN (bumped state won't wedge prepare-release).
- Workshop dogfood install — exit 0, `spice/wiki/Wiki.md` materialized (`type: wiki-hub`).
- Final adversarial review — see § Review.

## Lessons

- **A mechanism graduation must also repoint the SOURCE-TEXT test harnesses.** `run-helper-cases.js` had ~9 `HC-*-DS-*` cases + `MAN-1` reading DocSearch from the old project path (and asserting project *ships* it); `run-v0127-project-hub-heal.js` too. The plan under-specified this; full preflight caught it. When relocating a file that harnesses read, grep `platform/test/` for the old path in the same cycle.
- **Catalogue-count assertions (`mechanism count = N`) are legitimate hand-updates** (not version pins) — adding a mechanism bumps them (24→25). Distinct from the retired VERSION-pin sweep.
- **Hub content-files are deliberately NOT `materialize_once`** (Scratch/Finance/People/Projects/Cowork hubs all `false`) — they're render-only chrome that should refresh on install; only genuine user-content files get `materialize_once`. The design doc's §10 note was over-cautious; the wiki hub correctly follows the hub convention.
- **`origin/main` advanced under the worktree** (autoloop shipped v0.161.0/0.161.1 mid-cycle). Merged main into the branch, resolved the single `package.json` `release:preflight`-chain conflict (kept both main's `run-workstreams-analysis` and my `run-doc-search`/`run-wiki`), re-ran preflight green. Isolated worktree kept the build clean throughout.

## Carry-forward / iteration items

- **Breadcrumb intermediate-crumb polish:** `path_walk` originally used the raw folder slug (`infra`) for intermediate crumb labels + link basenames; resolved to use each section hub's display title + real path (so trails read "Wiki / Infra / AWS / …" and links resolve on case-sensitive FS). [If this was deferred, it is the top iteration item.]
- **Deferred (separate specs):** (1) ingestion — Obsidian Web Clipper capture + LLM/search pass; (2) project correlation — relate/move a wiki-page into a project (bidirectional links); (3) MOC auto-index generator.
- **Deploy:** consumers ero → headspace → accuris need `wiki` + `doc-search` added to each `ranch/platform-subscription.json` (a new blueprint is not added by `--bump-pins` alone), then `sauce update --bump-pins && sauce install`, then `Cmd+R`.
