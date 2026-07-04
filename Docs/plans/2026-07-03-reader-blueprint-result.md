# Reader blueprint — result

- **Date:** 2026-07-03
- **Version:** pipeline-assigned (`reader@0.1.0` new; workshop umbrella computed by the bumper)
- **Design + plan:** `Docs/plans/2026-07-03-reader-blueprint-{design,plan}.md`
- **Branch:** `cycle/reader-blueprint`

## What shipped

A NEW **`reader` blueprint** (`spice/reader/`) — a flat reading queue for web articles clipped from the browser via the official **Obsidian Web Clipper**. It is the "ingestion" north-star deferred by the wiki cycle, scoped down to its own tidy surface: capture-a-web-article → a flat queue → an AI TL;DR.

- **Two note types** (globally unique): `reader-hub` (the single root `spice/reader/Reader.md`, render-only chrome) + `reader-article` (flat leaves, never nested).
- **Status-is-frontmatter, not folder.** The lifecycle `unread → reading → archived` is the article's `status` field — advancing an article is a one-field `processFrontMatter` write, never a rename/move. The queue is ordered by **`captured_at` (ISO), NOT `mtime`** (landmine #23: `mtime` drifts on mobile / after sync).
- **Article frontmatter:** `type, title, url, author, site, published, captured_at (ISO), word_count (number), status, summary (AI TL;DR), tags[]`.
- **Global "Reader" nav button** (icon `book-open`, order 140, `openLink → spice/reader/Reader.md`) in the top nav row on every note.
- **Root hub** (`ReaderQueue`): `＋ New article` create row + a `doc-search` strip + glance pills (Unread / Reading / Archived) + status bands (Reading, Unread, then a trimmed Archived tail); each row opens the article note + carries an inline status toggle.
- **Article leaf** (`ReaderArticleActions` + `ReaderArticleView`): an action row (**Open source ↗** real `<a>` gated on a non-empty `url`, status-aware **Mark reading / Mark read / Back to…** buttons, **Reader hub** nav) above a presentation card (source-meta + "N min read" reading-time + a prominent **AI TL;DR** callout when `summary` is non-empty).
- **`/reader` command + `new-reader-article` skill + CLAUDE.md resolver row.**

### The Web Clipper capture flow

- Ships `platform/blueprints/reader/assets/reader-clip.json`, materialized to `spice/reader/reader-clip.json` (dest `{{module_directory}}/reader-clip.json`). It routes clips to `spice/reader/` (`behavior: create`, `noteNameFormat: {{title|safe_name}}`) with the house frontmatter, `{{highlights}}` + `{{content}}` body under `READER_HIGHLIGHTS` / `READER_CONTENT` markers, and the four `customjs-guard` chrome blocks.
- **`summary` + `tags` are Web Clipper Interpreter prompts** (`{{"…"}}` syntax) → the extension runs a local LLM over the page and fills the AI TL;DR + topical tags. **Recommended on a local Ollama** (private + free); the Interpreter can be pointed at any model or disabled (empty `summary` → the card omits the callout).
- **Import-once caveat:** the installer materializes the JSON into the vault but **cannot push it into a browser extension** — the user imports it once into the Web Clipper's template settings. `{{views_path}}` inside the clip's content format is **installer-substituted** (the `files[]` pipeline applies `substituteLenient` to the non-`.md` asset too, resolving the `customjs-guard` view path).

## Surfaces hit

- **New:** `platform/blueprints/reader/` — manifest, 2 templates (`Reader.md`, `Reader Article.md`), the `Reader Hub.md` content note, 3 helpers (`reader-queue.js`, `reader-article-actions.js`, `reader-article-view.js`), the `reader-clip.json` asset, `commands/reader.md`, `skills/new-reader-article/SKILL.md`.
- **Modified:** `platform/install.js` (`applyReaderScaffoldHeal` + pure `_healReaderChromeBody` + Node-side `_READER_CHROME`, invoked in the install sequence), `platform/schemas-index.json` (new `reader-rule-fragments` bundle), plus the manifest catalogue / subscription plumbing the pipeline manages.
- **No new mechanism** — reuses nav-buttons, entity-create, breadcrumb (ancestors mode), doc-search, cards, accent-button, section-label, render-safe, open-helpers, customjs-guard, platform-claude. (Contrast: wiki graduated `doc-search` + extended `breadcrumb`; reader touches neither.)
- **Tests:** NEW `platform/test/run-reader.js` (22 `HC-READER-*`) + seed `spice/reader/` (3 `reader-article` notes across statuses) + `HC-V0RDR-SEED-READER-1..4` in `run-seed-migrations.js`.

## Verification

- **`npm run release:preflight` — GREEN (exit 0)** across all harnesses.
- **`platform/test/run-reader.js` — 22/22 PASS** (`selectArticles` bucketing / counts / `captured_at`-desc sort / cold-safe; `statusTransitions` + `_nextStatusForward` per-state; `_humanDate` + `_readingMinutes` pure math; structural template + clip-JSON checks; bare-class loadability).
- **Seed coverage** — `HC-V0RDR-SEED-READER-1..4`: scaffolded hub exists with `ReaderQueue` chrome; all three seed articles survive with `type: reader-article`; all three statuses present; the entity-create registry carries the `reader-article` contribution.
- **`npm run lint-schemas` — 30 schemas, 0 issues** (the new `reader-rule-fragments` bundle validates).
- **Workshop dogfood self-install — exit 0** (`spice/reader/Reader.md` materialized, `type: reader-hub`).

## Lessons

- **A schema-registry entry is cheap insurance for a new blueprint.** The wiki blueprint shipped without a `schemas-index.json` entry; reader added `reader-rule-fragments` (a `rule-fragment-bundle` registering the 2 manifest `rule_fragments`) in the same cycle, so `lint-schemas` covers the new frontmatter contract from day one. Small improvement worth repeating for future blueprints.
- **Sort a mobile-facing queue by an explicit capture timestamp, never `mtime`.** Landmine #23: `mtime` is unreliable on mobile and after sync, so the ISO `captured_at` is the stable, portable sort key. `selectArticles` sorts every bucket by it.
- **Status-as-frontmatter beats folder-as-lifecycle for a flat queue.** Advancing an article is a one-field write (`processFrontMatter`), so there are no renames, no broken links, no folder-move races — the same folder-is-truth spirit as wiki/trips, reduced to a single field because the queue is intentionally flat.
- **The Web Clipper is import-once by construction.** The installer can write the template into the vault but can't reach into the browser extension; document the one-time import clearly so a fresh install isn't mistaken for a broken capture flow.

## Carry-forward / iteration items (deferred fast-follows)

- **Promote-to-wiki bridge** — move/relate a finished `reader-article` into `spice/wiki/` as standing reference (the reuse substrate — `doc-search` mechanism, folder-is-truth — is in place from the wiki cycle).
- **URL de-dup reconcile** — detect + fold a re-clip of an already-captured `url` (Web Clipper `behavior: create` will otherwise write a second note).
- **Optional `.base` power view** — an Obsidian Bases table/board view over the queue (filter by status/tags, sort by `captured_at`/`word_count`) as an opt-in alternative to the rendered hub.
- **Connection plane** — link a `reader-article` to a project / meeting / person (the cross-blueprint bidirectional-link idiom the wiki cycle also deferred).

## Deploy (manual, per-vault — a new blueprint is NOT auto-installed on consumers)

1. Let the release pipeline compute + ship the version (never admin-merge the release PR; unstick a BEHIND-wedge only via `gh pr update-branch`).
2. For each consumer that should have the reader (each subscribes a subset): add `{ "name": "reader", "version": "<pin>" }` to that vault's `ranch/platform-subscription.json`, then run `sauce update --force` **with the vault as the CWD** (SAUCE_VAULT is ignored — cwd-ancestor detection wins).
3. Verify `spice/reader/Reader.md` (`type: reader-hub`) materialized + drift is none, then **`Cmd+R`** in each Obsidian vault to pick up the new customJS classes.
4. Import `spice/reader/reader-clip.json` once into the browser's Obsidian Web Clipper (extension → templates → import), optionally point the Interpreter at a local Ollama, and clip.
