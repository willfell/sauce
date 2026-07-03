---
purpose: Canonical reference for the `reader` blueprint — a flat reading-queue for web articles clipped via the official Obsidian Web Clipper. Note types, status-in-frontmatter (never a folder move), the three render helpers + their pure methods, chrome (Breadcrumb ancestors-mode + nav buttons + helper-owned dividers), doc-search, entity-create routing, the Web Clipper capture flow (Ollama TL;DR + import-once caveat), the scaffold heal, and the key decisions. Read before any reader work.
load_when: Touching the reader blueprint (spice/reader/), its helpers (ReaderQueue / ReaderArticleActions / ReaderArticleView), the reader-clip.json Web Clipper artifact, applyReaderScaffoldHeal, or debugging reader render/chrome/status behavior.
---

# Reader blueprint

A **flat reading queue for web articles** at `spice/reader/`. Articles are clipped from the browser via the official **Obsidian Web Clipper** browser extension into `spice/reader/` as flat leaf notes; the hub at `spice/reader/Reader.md` renders them as a status-grouped queue (Reading / Unread / Archived). The lifecycle (`unread → reading → archived`) lives entirely in each article's **frontmatter `status`** — never a folder move. New blueprint (`reader@0.1.0`); `module_directory: reader`. Reuses existing mechanisms only — no new mechanism shipped.

## The one-paragraph model

Two note types — `reader-hub` (the single root `spice/reader/Reader.md`, render-only chrome) and `reader-article` (zero-or-more flat leaves, never nested). **Status-is-frontmatter, not folder:** an article's position in the queue is its `status` field (`unread`/`reading`/`archived`), so advancing an article is a one-field frontmatter write, never a rename or move. Articles are ordered by **`captured_at` (an ISO string), NOT `mtime`** — landmine #23: `mtime` is unreliable on mobile / after a sync, so the clip time is the stable sort key. Every note renders the same chrome stack: `Breadcrumb` → `SpaceNavButtons` → (hub) `ReaderQueue` / (article) `ReaderArticleActions` → `ReaderArticleView`.

## Note types + frontmatter

```yaml
# reader-hub  (spice/reader/Reader.md — one per vault)
type: reader-hub
```

```yaml
# reader-article  (spice/reader/<Title>.md — flat leaf, never nested)
type: reader-article
title: "The Unix Philosophy Revisited"
url: "https://example.com/unix-philosophy"
author: "Jane Doe"
site: "example.com"
published: 2021-03-14           # YYYY-MM-DD (from the clip)
captured_at: "2026-07-03T09:12:00Z"   # ISO — the queue sort key
word_count: 2400               # number — drives reading-time estimate
status: unread                 # unread → reading → archived
summary: "AI TL;DR — a neutral 2-3 sentence summary."
tags: [reader-article, unix, philosophy]
```

Type values are globally unique (no collision with project `docs-hub`/wiki `wiki-hub`/trips `trips-hub`). Only `type`, `title`, `status`, `captured_at`, and `tags[]` are load-bearing for the queue; the rest (`url`/`author`/`site`/`published`/`word_count`/`summary`) enrich the article card and are populated by the Web Clipper.

## customJS helpers (`platform/blueprints/reader/helpers/`)

Each is a bare `class` written as ONE expression (customjs-guard registers it via `window.customJS.X`; any trailer → the class never registers). Pure static methods are Node-testable and never touch the DOM.

### `ReaderQueue` — the hub

`render(dv)` guards `reader-hub` (returns on embeds and on any other type), then draws, in order:

1. **`＋ New article` create row** — delegated to `ReaderArticleActions.renderCreateRow(dv)` (which delegates to `customJS.EntityCreate.create({ instance: 'reader-article', dv })`), wrapped in owned top+bottom hairlines. Cold-load-safe: if `ReaderArticleActions` isn't registered yet the row is skipped, not thrown.
2. **A `doc-search` strip** — `DocSearch.render(dv, { scopePath: spice/reader, recursive: false, entityType: 'reader-article', persist: false, onChange })`. Non-recursive (leaves are flat); `persist: false` (search always starts empty on each visit). Right after `DocSearch.render` the strip's top margin is normalized to `12px` so the gap matches the buttons↔divider gap (same trick the wiki hub uses).
3. **Glance pills** — `_renderGlancePills` draws up to three count pills (Unread orange, Reading accent, Archived muted); a zero-count pill is hidden; all-zero renders nothing.
4. **Status bands** — `_renderBand` renders **Reading**, then **Unread**, then a collapsed/trimmed **Archived** tail. Each article row is drawn by **`_renderArticleRow`**: a title link that OPENS the note via `openLinkText` (the same pattern the to-do `TaskTodayList` row uses) plus an inline status toggle.

The pure selector **`static selectArticles(dv)`** queries `dv.pages('"spice/reader"').where(p => p.type === 'reader-article')`, buckets by `status` into `{ reading, unread, archived }`, sorts each bucket by `captured_at` **descending** (newest clip first; a robust ISO/Dataview-`toISO` coercion handles both string and Dataview date values), and returns `{ reading, unread, archived, counts }`. Cold-safe: a missing/typeless `dv` returns the empty shape.

### `ReaderArticleActions` — the leaf action row

`render(dv)` guards `reader-article`, then draws ONE centered horizontal row (`_styleLeafBtn`, `flex: 1 1 0`, `max-width` centered) whose buttons stretch to fill the width:

```
[ Open source ↗ ]  [ Mark reading / Mark read / Back to unread … ]  [ Reader hub ]
```

- **Open source ↗** is a **real `<a>`** (target `_blank`), rendered ONLY when `url` is a non-empty string (otherwise the button is absent — no dead link).
- The **status buttons** are computed from the pure `statusTransitions(status)` → `[{ label, next }, …]`, so each state offers the right forward + back moves:
  - `unread` → *Mark reading* (→reading), *Mark read* (→archived)
  - `reading` → *Mark read* (→archived), *Back to unread* (→unread)
  - `archived` → *Back to reading* (→reading), *Mark unread* (→unread)
- Clicking a status button routes through `_setStatus(path, next)`, which writes the single `status` field via `app.fileManager.processFrontMatter` (this file only — mirrors the to-do `markDone` write). `_nextStatusForward(status)` is the pure "next forward status" helper.
- **Reader hub** navigates back to `spice/reader/Reader.md`.

`static renderCreateRow(dv)` (hosted by `ReaderQueue` on the hub, not on leaves) is the `＋ New article` entity-create button — it delegates to `customJS.EntityCreate.create({ instance: 'reader-article', dv })`.

### `ReaderArticleView` — the leaf card

`render(dv)` (async) draws the article's presentation card in its own body, below the action row:

- **Source meta** — author · site · a human `published` date (via the pure `_humanDate`) · the source URL.
- **Reading time** — `_readingMinutes(word_count)` (pure) → an "N min read" estimate; renders nothing when `word_count` is missing/zero.
- **AI TL;DR callout** — a prominent block rendered ONLY when `summary` is a non-empty string, labelled **AI TL;DR** (populated by the Web Clipper Interpreter — see below).
- Never throws out of `render` (cold-load safety).

Pure methods: `static _humanDate(value)` (Hinnant-style day-math, no `new Date` timezone traps — ported from the to-do `TaskNoteView._humanDate` with the relative-hint arm dropped) and `static _readingMinutes(words)` → `number | null`.

## Chrome

Every reader note renders the same chrome header (each a separate `dataviewjs` block calling `customjs-guard`):

```
hub:      Breadcrumb  →  SpaceNavButtons  →  ReaderQueue
article:  Breadcrumb  →  SpaceNavButtons  →  ReaderArticleActions  →  ReaderArticleView
```

**Breadcrumb** uses the shared `breadcrumb` mechanism's **`ancestors` mode** (flat) — the same mode as trips/project/meetings, NOT the wiki's `path_walk`. Because the queue is flat, no path-walk trail is needed, so **the reader ships NO breadcrumb-mechanism change**. The manifest declares:

- `reader-hub` → single crumb: `Reader` (current, `lit:Reader`, no link)
- `reader-article` → `Reader` (linked `spice/reader/Reader.md`) › `<title>` (current, from `fm:title|file:basename`)

**Dividers** are owned by the action helpers (hairlines), not the templates — the same helper-owned-divider grammar as wiki (never a literal `---`; `HC-READER-10*` asserts no literal `---` outside frontmatter in the templates + content note).

## Search — `doc-search` mechanism

The reuses the shared `doc-search` mechanism (the same one project + wiki consume). `ReaderQueue` calls `DocSearch.render(dv, { scopePath: spice/reader, recursive: false, entityType: 'reader-article', persist: false, onChange })`. Non-recursive because the leaves are flat; `persist: false` so search text is never remembered across visits. `onChange` re-renders the results via `_renderResults` (which branches on `ctx.hasActiveFilter`: typing switches from the browse view to a flat matching-articles grid via `DocSearch.matches(page, ctx)`).

## entity-create routing

The `＋ New article` button routes via the `new_entity_buttons[]` contribution (`instance: reader-article`): a new note lands in `{{module_directory}}/<Title>.md` (i.e. `spice/reader/<sanitized title>.md` — flat, `folder_prefix: {{module_directory}}`, `filename_prefix: {{prompts.title|sanitize-filename}}`) with the house frontmatter template (`type: reader-article`, `status: unread`, `captured_at: {{now.YYYY-MM-DDTHH:mm:ssZ}}`, empty `url`/`summary`, `tags: [reader-article]`) and the `Reader Article.md` body template (the full chrome stack). This is the "type it in by hand" path; the Web Clipper is the primary capture path.

## The Web Clipper capture flow (the primary intake)

The blueprint ships a Web Clipper template artifact `platform/blueprints/reader/assets/reader-clip.json`, materialized by the installer to `spice/reader/reader-clip.json` (its dest is `{{module_directory}}/reader-clip.json`). It is an **import-once** artifact: the installer writes it into the vault, but **cannot push it into a browser extension** — the user imports it once into the official [Obsidian Web Clipper](https://obsidian.md/clipper) extension's template settings, and clips thereafter route straight to `spice/reader/`.

What the template declares:

- **`behavior: "create"`**, **`path: "spice/reader"`**, **`noteNameFormat: "{{title|safe_name}}"`** — every clip becomes a flat `spice/reader/<Title>.md`.
- **House frontmatter properties** mapped from the clip's page variables: `type` (literal `reader-article`), `title` (`{{title}}`), `url` (`{{url}}`), `author` (`{{author}}`), `site` (`{{site}}`), `published` (`{{published|date:"YYYY-MM-DD"}}`), `captured_at` (`{{date}}`), `word_count` (`{{words}}`, number), `status` (literal `unread`).
- **An Interpreter TL;DR** — `summary` = `{{"a neutral 2-3 sentence summary of this article"}}` and `tags` = `{{"1-4 lowercase topical tags…"}}` are Web Clipper **Interpreter prompts** (the `{{"…"}}` syntax), so the extension runs a local LLM over the page and fills the `summary` (which the `ReaderArticleView` AI-TL;DR callout renders) + topical `tags`. **Recommended on a local Ollama** so clipping stays private + free; the Interpreter can be pointed at any configured model, or disabled (leaving `summary` empty — the card just omits the callout).
- **`noteContentFormat`** seeds the article body: the three/four `customjs-guard` chrome blocks (`Breadcrumb` / `SpaceNavButtons` / `ReaderArticleActions` / `ReaderArticleView`), then a `READER_HIGHLIGHTS` comment marker + `{{highlights}}`, then a `READER_CONTENT` comment marker + `{{content}}`. **`{{views_path}}` in this content format is substituted by the installer** — the `files[]` pipeline applies `substituteLenient` to non-`.md` files too, so the clip's `customjs-guard` view path is resolved to the vault's real `ranch/views` path before the JSON is written.

## Install heal — `applyReaderScaffoldHeal` (in `platform/install.js`)

Mirrors `applyHomeScaffoldHeal`. Called from the install sequence (installer step ~line 1252). Its job: guarantee `spice/reader/Reader.md` exists with correct chrome.

- **Missing** → scaffolds the singleton `spice/reader/Reader.md` (`type: reader-hub` + the `Breadcrumb` → `SpaceNavButtons` → `ReaderQueue` chrome, kept in lockstep with `content/Reader Hub.md` — the Node-side `_READER_CHROME` copy in install.js is the authority when scaffolding).
- **Present** → idempotently heals the chrome via the pure **`_healReaderChromeBody(raw)`**: the sentinel is `class: "ReaderQueue"` — if it's already in the body, the body is returned unchanged (a second pass writes ZERO files); otherwise the canonical chrome is injected. The **user's free-write below the `READER_CONTENT` marker is preserved.**
- **Backup:** a `.sauce-backup/reader/` snapshot before any write.
- **Error posture:** never throws — a failure pushes a `warning` event to history and the rest of the install continues.

## Schema

`platform/schemas-index.json` gained a **`reader-rule-fragments`** entry (`kind: "rule-fragment-bundle"`, `owner: { type: blueprint, name: reader }`) — a small improvement over the wiki blueprint, which shipped without a schema-registry entry. It registers the manifest's **2 `rule_fragments`**: `reader-hub` (path-exact `spice/reader/Reader.md`, `type == reader-hub`) and `reader-article` (glob `spice/reader/**/*.md`, `type` required string), both `extends: _canonical-vocab`, validated by the installer's validator mechanism. `npm run lint-schemas` → 30 schemas, 0 issues.

## Manifest surfaces

`customjs_classes`: ReaderQueue, ReaderArticleActions, ReaderArticleView. `depends_on`: nav-buttons, customjs-guard, cards, accent-button, entity-create, section-label, breadcrumb, doc-search, render-safe, open-helpers, platform-claude (all existing — no new mechanism). `nav_buttons[]`: the Reader button (icon `book-open`, order 140, `openLink → {{module_directory}}/Reader.md`). `new_entity_buttons[]`: `reader-article` (routed by `{{module_directory}}` folder-prefix). `breadcrumb.types[]`: reader-hub + reader-article (ancestors mode). `rule_fragments[]`: reader-hub + reader-article. `files[]`: 2 templates + the Reader Hub content note + 3 helpers + the `reader-clip.json` asset. `claude_surface[]`: `/reader` command + `new-reader-article` skill + resolver row.

## Tests

`platform/test/run-reader.js` (**22/22 PASS**, load-via-`new Function` per the behavioral-harness pattern; `HC-READER-*` labels): `selectArticles` bucketing / counts / `captured_at`-desc sort / cold-safe empty shape; `statusTransitions` + `_nextStatusForward` per-state; `ReaderArticleView._humanDate` + `_readingMinutes` pure math; structural template + clip-JSON checks (3 guarded chrome blocks, no literal `---` outside frontmatter, `{{views_path}}` present, house frontmatter properties); bare-class loadability (each helper is one expression). Seed coverage: 3 `reader-article` notes across all statuses under `platform/test/seed-vault/spice/reader/` + `HC-V0RDR-SEED-READER-1..4` in `run-seed-migrations.js` (the scaffolded hub exists with `ReaderQueue` chrome; all three articles survive with `type: reader-article`; all three statuses present; the entity-create registry carries the `reader-article` contribution). Full `npm run release:preflight` GREEN (exit 0); workshop dogfood self-install exit 0.

## Deploy note

**A NEW blueprint is not auto-installed on consumers** — each consumer subscribes a subset. To ship reader to a vault: add `{ "name": "reader", "version": "<pin>" }` to that vault's `ranch/platform-subscription.json`, then run `sauce update --force` with the **vault as the CWD** (SAUCE_VAULT is ignored; cwd-ancestor detection wins). **Class changes render only after `Cmd+R`** in each Obsidian vault.

## Key decisions / gotchas

- **Status is frontmatter, not folder.** Advancing an article (`unread → reading → archived`) is a one-field `processFrontMatter` write — never a rename/move. Do not encode the lifecycle in the folder tree; the leaves stay flat in `spice/reader/`.
- **Sort by `captured_at`, never `mtime`** (landmine #23). `mtime` drifts on mobile + after sync; the ISO clip time is the stable, portable sort key. `selectArticles` sorts every bucket by `captured_at` descending.
- **Flat, never nested.** `reader-article` leaves live directly in `spice/reader/`; the `doc-search` strip is non-recursive for that reason.
- **The Web Clipper artifact is import-once.** The installer materializes `reader-clip.json` into the vault but can't push it into the browser extension — the user imports it into the Web Clipper once. Don't expect the installer to "install" the clipper template into the browser.
- **`{{views_path}}` in the clip JSON is installer-substituted.** The `files[]` pipeline runs `substituteLenient` over the non-`.md` asset, so the clip's `customjs-guard` view path resolves to the vault's real `ranch/views` path.
- **Open source ↗ is a real `<a>`, gated on a non-empty `url`.** A hand-created (non-clipped) article with an empty `url` simply omits the button — no dead link.
- **The AI TL;DR callout only renders when `summary` is non-empty.** No summary (Interpreter off, or a manual create) → the card omits the callout; nothing breaks.
- **The scaffold heal is idempotent + non-throwing.** The `class: "ReaderQueue"` sentinel gates the chrome-injection; the `READER_CONTENT` marker preserves user free-write; a second install pass writes zero files.
- **No new mechanism.** Every dependency is an existing mechanism; the reader is a pure blueprint (contra wiki, which graduated `doc-search` + extended `breadcrumb`).
