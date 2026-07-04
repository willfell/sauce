# Reader blueprint — design

- **Date:** 2026-07-03
- **Topic:** New `reader` blueprint — capture + read web articles via the official Obsidian Web Clipper
- **Version:** pipeline-assigned (new component `reader@0.1.0`; consumers of shared mechanisms bump per touch)
- **Status:** approved (brainstorm → design), ready for plan
- **Design/plan family:** `Docs/plans/2026-07-03-reader-blueprint-{design,plan,result}.md`

## 1. Goal & motivation

Make **capturing and reading web articles** first-class in the vault. Today the wiki is nearly empty because there is no content inflow — pages are hand-typed stubs and nobody links them. The binding constraint is *getting substantial content in*, not connecting what's already there.

The Reader blueprint gives *what you read* a real home: **clip an article with the official Obsidian Web Clipper → it lands as a rich `reader-article` note in `spice/reader/` with source metadata, highlights, and an AI TL;DR → read it → mark it `reading`/`archived`**. A `reader-hub` renders the reading queue. Later (fast-follow, out of scope here) an article becomes the raw fuel a wiki page is synthesized from ("promote to wiki").

This is deliberately modeled on Andrej Karpathy's LLM-Wiki separation of `raw/` (immutable captured sources) from compiled/synthesized pages: the Reader is the vault's `raw/` reading layer; the wiki stays the synthesis layer.

## 2. Scope

**In (v1 — this cycle):**
- New `reader` blueprint owning `spice/reader/` (module-directory invariant, landmine #11).
- Two note types: `reader-hub` (single root `spice/reader/Reader.md`) and `reader-article` (flat leaves).
- `status` lifecycle in frontmatter — `unread → reading → archived` — never a folder move.
- Reader hub renders three queues (Reading / Unread / Archived) + glance pills + `doc-search` + a `＋ New article` manual-capture button. Native customjs (`ReaderQueue`), consistent with every blueprint, testable in the Node harness, works on any Obsidian version.
- Article note chrome: breadcrumb (ancestors mode) → `SpaceNavButtons` → `ReaderArticleActions` (open-source + status-toggle row) → `ReaderArticleView` (source-meta + AI TL;DR card) → highlights region → content marker.
- A shipped, versioned **Web Clipper template** (`reader-clip.json`) that routes clips into `spice/reader/` with house frontmatter, `{{highlights}}`, and an **Interpreter TL;DR** (local-Ollama default, graceful if unconfigured). Materialized into the vault + documented; imported once by the user.
- Nav button, `/reader` slash command, `new-reader-article` skill, schema-registry entry, install heal (`applyReaderScaffoldHeal`), seed-vault coverage, behavioral harness (`run-reader.js`), agent guide.

**Out (deferred fast-follows):**
- Promote-to-wiki bridge (article → seeds a synthesized, back-linked wiki page).
- URL-dedup reconcile (Web Clipper has no native dedup; we ship `url` frontmatter as the dedup key + a future reconcile view).
- Topic/section folder routing; per-site typed article kinds.
- An optional Obsidian `.base` "power view" on the hub (additive, users on 1.9+). Noted, not built.
- Connection plane (backlinks/related/linkify) — the original spearhead, revisited once Reader supplies content.

## 3. Architecture — reuse strategy

Reader is a **flat entity-store blueprint** (like `to-do`/task + `home`), NOT a folder-hierarchy blueprint (like wiki). The hub queries `spice/reader` by `status` frontmatter; nothing nests.

Reuse (declared in `depends_on`, no new mechanisms required):
- `nav-buttons` — Reader nav button (`order: 140`, after wiki's 135) + `SpaceNavButtons` on every note.
- `breadcrumb` — **`ancestors` mode** (flat: `Reader / <title>`), already shipped; no mechanism change. (Wiki needed `path_walk` for arbitrary depth; Reader does not.)
- `entity-create` — `＋ New article` dialog → `reader-article` note with `frontmatter_template` (url/status/tags) routed to `spice/reader/`.
- `doc-search` — the hub search strip (title + tag), reused verbatim.
- `cards`, `section-label`, `accent-button`, `render-safe`, `open-helpers`, `customjs-guard`, `platform-claude` — chrome + render primitives, same as wiki.

New code, all customjs bare classes under `platform/blueprints/reader/helpers/`:
- `ReaderQueue` (hub queues + glance pills + create button + search).
- `ReaderArticleActions` (leaf action row: open-source, status toggle, hub nav).
- `ReaderArticleView` (leaf meta + AI TL;DR card).

No new mechanism is introduced (keeps blast radius small; the only version bumps are `reader@0.1.0` + patch bumps on any shared mechanism whose range we widen — expected: none, we pin existing ranges).

## 4. Data model

**Folder-is-truth-lite:** the folder (`spice/reader/`) holds the hub + all articles; `status` and metadata are frontmatter so state changes never move files.

### `reader-hub` (one per vault, `spice/reader/Reader.md`)
```yaml
type: reader-hub
title: Reader
dir: spice/reader
created_at: "<ISO8601>"
tags: [reader-hub]
```

### `reader-article` (one per clipped/created article)
| field | source (Web Clipper var) | purpose |
|---|---|---|
| `type` | fixed | `reader-article` |
| `title` | `{{title}}` | note title = basename |
| `url` | `{{url}}` | canonical source + dedup key |
| `author` | `{{author}}` | byline (optional) |
| `site` | `{{site}}` / `{{domain}}` | publication (optional) |
| `published` | `{{published\|date:"YYYY-MM-DD"}}` | original date (optional) |
| `captured_at` | `{{date}}` | when clipped |
| `word_count` | `{{words}}` | drives reading-time (words/200) |
| `status` | default `unread` | `unread` \| `reading` \| `archived` |
| `summary` | Interpreter `{{"…"}}` | AI TL;DR (may be empty) |
| `tags[]` | Interpreter / manual | topical tags (real tags, finally) + `reader-article` structural tag |

Status lifecycle: `unread` (default on capture) → `reading` (opened / in progress) → `archived` (done). Toggled by `ReaderArticleActions` buttons and hub-row quick-toggle, written via `app.fileManager.processFrontMatter` (atomic, preserves body). `selectArticles(dv)` buckets by `status` and returns counts for the glance pills. Unknown/absent `status` is treated as `unread` (source-agnostic, cold-load safe).

## 5. Surfaces (what the user sees)

**Nav:** a `Reader` button (icon `book-open`, `order: 140`) in `SpaceNavButtons`, opening `spice/reader/Reader.md`.

**`Reader.md` hub (top → bottom):**
1. Breadcrumb — `Reader` (root crumb, unlinked on hub).
2. `SpaceNavButtons`.
3. `ReaderQueue`:
   - Action row: `＋ New article` (entity-create) on its own full-width readable row.
   - Glance pills: `Unread N · Reading N · Archived N` (zeros hidden).
   - `doc-search` strip (title + tag; browse↔search auto-switch like wiki).
   - **Reading** band (in-progress, top), **Unread** band (newest `captured_at` first), **Archived** band (collapsed count + recent). Each row: title → opens the note; source-meta subtitle (site · author · ~N min); a one-click status-toggle control.

**`reader-article` note (top → bottom):**
1. Breadcrumb — `Reader / <title>` (ancestors mode; root linked to `Reader.md`).
2. `SpaceNavButtons`.
3. `ReaderArticleActions` — full-width row: `[Open source ↗]` (web link, new tab) · `[Mark reading]` / `[Mark read]` (status-aware) · `[Reader hub]`.
4. `ReaderArticleView` — card: title + status pill (right); DETAILS (author · site · published · ~N min read, humanized); the **AI TL;DR** rendered prominently. Whole card / each field hidden gracefully when empty (no bare "undefined").
5. `<!-- READER_HIGHLIGHTS -->` region — clipped `{{highlights}}`.
6. `<!-- READER_CONTENT -->` marker — the article body + the user's own notes (heal-preserved).

Chrome obeys note-chrome grammar: no `## H2`, no literal `---` between chrome blocks (helper-owned leading hairline / `SectionLabel.divider`), every dataviewjs block via `customjs-guard`.

## 6. Rendering primitives & new classes

- **`ReaderQueue.render(dv)`** — guard `cur.type === "reader-hub"`. Best-effort renders the create button (entity-create) + `doc-search` in its own container (same-block gap control, mirroring `WikiTree`). Pure static `ReaderQueue.selectArticles(dv)` → `{ reading:[], unread:[], archived:[], counts:{unread,reading,archived} }` queried from `dv.pages('"spice/reader"')` filtered `type === "reader-article"`, sorted by `captured_at` desc. Rows via a shared `_renderArticleRow` (title-open + subtitle + status toggle). Search mode reuses `doc-search`'s `hasActiveFilter` → flat results grid.
- **`ReaderArticleActions.render(dv)`** — guard `cur.type === "reader-article"`. Full-width action row (accent + quiet buttons, `_mobilize` 2-up on phones). Open-source uses a real `<a target=_blank>` only when `url` present. Status buttons call `_setStatus(path, next)` → `processFrontMatter`.
- **`ReaderArticleView.render(dv)`** — guard `reader-article`. Meta+summary card; `_humanDate` (pure Hinnant day-math, no `new Date()` in the hot path per prior task-note precedent) for "published"; reading-time = `Math.max(1, round(word_count/200))`. Renders `summary` as a callout/blockquote; hides DETAILS grid when all fields empty.

All three are bare `class` bodies (no `module.exports`; loadable by `run-customjs-loadable` — landmines #1–#5), invoked only through `dv.view("{{views_path}}/customjs-guard", { class: "…" })`.

## 7. Manifest wiring (`platform/blueprints/reader/manifest.json`)

Mirrors `wiki`'s manifest structure. Blocks:
- `name: reader`, `version: 0.1.0`, `kind: blueprint`, `module_directory: reader`, `skills_dir: .claude/skills/reader`, `description`.
- `depends_on[]` — nav-buttons, customjs-guard, cards, accent-button, entity-create, section-label, breadcrumb, doc-search, render-safe, open-helpers, platform-claude (ranges pinned to currently-shipped versions; no widening).
- `breadcrumb.types` — **ancestors mode** for `reader-hub` (`ancestors: []`, `current: lit:Reader`) and `reader-article` (`ancestors: [{label: lit:Reader, link: spice/reader/Reader.md}]`, `current: fm:title|file:basename`).
- `customjs_classes: ["ReaderQueue","ReaderArticleActions","ReaderArticleView"]`.
- `files[]` — templates (`Reader.md`, `Reader Article.md`), content (`content/Reader Hub.md` → `spice/reader/Reader.md`), helpers → `{{scripts_path}}/reader/*.js`, and the Web Clipper asset → `spice/reader/reader-clip.json` (import-once artifact; harmless non-markdown file under the module dir).
- `claude_surface[]` — `commands/reader.md` → `.claude/commands/reader.md`; `skills/new-reader-article/SKILL.md` → `{{skills_dir}}/new-reader-article/SKILL.md`; a `claude_md_row` resolver row `Reader | spice/reader | /reader`.
- `nav_buttons[]` — `{ id: reader-hub, label: Reader, icon: book-open, order: 140, action: openLink → {{module_directory}}/Reader.md }`.
- `new_entity_buttons[]` — `+ New article`: prompt `title` (required, safe-filename); destination `folder_prefix: {{module_directory}}`, `filename_prefix: {{prompts.title|sanitize-filename}}`; `frontmatter_template` seeds `type: reader-article`, `title`, `status: unread`, `captured_at`, `tags: [reader-article]`, empty `url/summary`; `body_template: Reader Article.md`.
- `rule_fragments[]` — `reader-hub` (`path_glob: spice/reader/Reader.md`, type equals `reader-hub`) + `reader-article` (`path_glob: spice/reader/*.md`, type present).

Registration (outside the blueprint dir):
- `platform/manifest.json` `blueprints[]` — `{ name: reader, version: 0.1.0, path: blueprints/reader }`.
- `ranch/platform-subscription.json` `blueprints[]` — `{ name: reader, version: 0.1.0 }` (workshop dogfood self-subscription).
- `platform/test/seed-vault/ranch/platform-subscription.json` — same pin (so `run-seed-migrations` exercises it).
- `platform/schemas-index.json` — a `rule-fragment-bundle` entry owned by blueprint `reader`.

## 8. Templates

- `templates/Reader.md` (hub) — frontmatter (`type: reader-hub`, title Reader, dir, created_at, tags) + three chrome blocks: Breadcrumb / SpaceNavButtons / **ReaderQueue**.
- `content/Reader Hub.md` — byte-equivalent to the hub template with a concrete `created_at` (the shipped root note).
- `templates/Reader Article.md` (leaf) — no frontmatter (entity-create/clipper injects it); chrome: Breadcrumb / SpaceNavButtons / **ReaderArticleActions** / **ReaderArticleView** + `<!-- READER_HIGHLIGHTS -->` + `<!-- READER_CONTENT -->` markers.

All dataviewjs blocks go through `customjs-guard`; no literal `---`.

## 9. Slash command + skill

- `commands/reader.md` → `.claude/commands/reader.md`. `# /reader — Reader` with: open hub, new article, find by status, and **Web Clipper setup** (how to import `reader-clip.json` + configure Ollama for the TL;DR).
- `skills/new-reader-article/SKILL.md` → `{{skills_dir}}/new-reader-article/SKILL.md`. Opens with the pre-write vault-identity self-check (STOP if consumer-vault markers present), then how to create an article note (button or clipper).
- Manifest `claude_surface[]` declares both + the resolver row.

## 10. Install-time heal (`applyReaderScaffoldHeal`)

In `platform/install.js`, mirroring `applyHomeScaffoldHeal`:
- Guard adapter → ensure `spice/reader/` → if `Reader.md` missing, scaffold it (frontmatter + chrome, no backup) and return.
- Else read → pure `_healReaderChromeBody(before)` (sentinel guard: `if (/class:\s*"ReaderQueue"/.test(raw)) return raw;`; preserve user content below the `READER_CONTENT` marker) → if changed, backup to `.sauce-backup/reader/…` then write.
- try/catch pushes `step: reader_scaffold_heal` history; never throws (landmine: heals must not break install).
- Call site: after `applyHomeScaffoldHeal` in the singleton-heal sequence (`platform/install.js` ~`:1250`).

Existing article notes are NOT force-migrated in v1 (there are none in the wild); the heal only scaffolds the hub + is idempotent. A future article-chrome conformance heal follows the `applyNoteChromeHeal` pattern if needed.

## 11. Web Clipper capture (the `reader-clip.json` artifact)

Shipped as a blueprint asset (materialized to `spice/reader/reader-clip.json`), imported once by the user into the extension (the installer cannot push into a browser extension — documented boundary). Template shape:
- `behavior: create`; `path: spice/reader`; `noteNameFormat: {{title|safe_name}}`.
- `properties[]` — the §4 schema with correct types (`text`/`date`/`number`/`multitext`), `status` default `unread`, `type: reader-article`.
- `noteContentFormat` — seeds frontmatter is handled by properties; body seeds the `customjs-guard` render calls (Breadcrumb / SpaceNavButtons / ReaderArticleActions / ReaderArticleView) + `<!-- READER_HIGHLIGHTS -->\n{{highlights}}` + `<!-- READER_CONTENT -->\n{{content}}`. **Never emits literal `---` dividers**; chrome is helper-rendered at view time.
- `triggers` — `schema:@Article` + common article URL patterns (auto-select).
- **Interpreter** — `summary` property value = `{{"a neutral 2–3 sentence summary of this article"}}`; `tags` augmented by `{{"1–4 lowercase topical tags, comma separated"}}`. Recommend **Ollama** (local, no API key, private — matches the self-contained ethos). Graceful: unconfigured interpreter ⇒ empty `summary`/no extra tags ⇒ note still renders.

Because the template's frontmatter IS the §4 schema, the plan will note we could later generate `reader-clip.json` from the schema so they never drift (not built in v1).

## 12. Testing strategy

1. **`platform/test/run-reader.js`** (scaffold via `npm run scaffold-harness`) — load-instantiate-assert:
   - `ReaderQueue.selectArticles` buckets unread/reading/archived correctly + counts + `captured_at` desc sort + unknown-status→unread + cold-load empty-vault safety.
   - `ReaderArticleView._humanDate` / reading-time math (pure).
   - `ReaderArticleActions._setStatus` computes the correct next-status transitions (pure part).
   - Structural: templates + `content/Reader Hub.md` carry the three/four chrome blocks, no literal `---`, markers present.
   - Wire `node platform/test/run-reader.js` into `package.json` `release:preflight` chain.
2. **Seed vault** — add `platform/test/seed-vault/spice/reader/` (Reader.md hub + 2–3 sample `reader-article` notes across statuses) + subscription pin; add `HC-V0XYZ-SEED-READER-*` asserts to `run-seed-migrations` (install exit 0, hub scaffolded, articles queryable).
3. **`npm run lint-schemas`** green (new registry entry well-formed).
4. **`npm run release:preflight`** whole-suite GREEN; **workshop dogfood** self-install; **`npm run release:preflight-bumped`** on a clean tree (catch a release wedge before merge).

## 13. Release & deploy plan

- Conventional commits only (`feat(reader): …`, `test(reader): …`, `docs(reader): …`, plus `feat(install): applyReaderScaffoldHeal`, `chore(nav-buttons)/(schemas)` as touched). **No hand-versioning/tagging/pin-sweeping** — the pipeline computes `reader@0.1.0` + umbrella semver from the commits.
- Branch `cycle/reader-blueprint` → PR → CI (preflight macos + ubuntu) green → **merge the feature PR**. The release pipeline then opens the release PR (auto-merges on green), tags `vX.Y.Z`, patches + auto-merges the homebrew tap PR, ships to brew. Do NOT touch the release/tap PRs.
- **New-blueprint deploy (manual, per landmine/lesson):** after the tag ships + `brew upgrade sauce`, add `{ name: reader, version }` to each consumer vault's `ranch/platform-subscription.json`, then `cd <vault> && sauce update --force` (PATH incl `/opt/homebrew/bin`; cwd-ancestor detection wins). Verify artifacts landed + drift none on accuris, headspace, ero.

## 14. Risks & mitigations

- **Web Clipper templates are import-once** (installer can't push into a browser extension) → ship the JSON into the vault + document import in `/reader` + the agent guide.
- **No native dedup** (re-clip ⇒ 2nd note) → ship `url` as the dedup key; a reconcile view is a deferred fast-follow.
- **Interpreter cost/latency + provider setup** → default to local Ollama, scope context, keep `summary` optional/graceful.
- **Autoloop churn / BEHIND treadmill** (an active `sauce-30m-loop` keeps shipping) → isolated worktree off fresh `origin/main`; `git merge origin/main` before PR; zero-overlap PR; admin-merge only if a non-release green zero-overlap PR is wedged behind release churn (never the release PR).
- **`file.mtime` unreliable on mobile** (landmine #23) → order queues by `captured_at` frontmatter, not `mtime`.
- **New helper cold-load** (landmines #1–#5) → customjs-guard only; compute click-time options lazily; harness loads each class to prove loadability.

## 15. Success criteria

- `reader` blueprint installs cleanly on the workshop dogfood + all three consumer vaults (drift none).
- Reader nav button opens `spice/reader/Reader.md`; hub renders the three queues + glance pills + search + `＋ New article`.
- A clipped (or manually created) article lands as a valid `reader-article` with correct chrome, source-meta card, highlights, and (if AI configured) a TL;DR; status toggles work from both the note and the hub row.
- `npm run release:preflight` whole-suite GREEN incl. `run-reader` + `lint-schemas`; bumped-state preflight green; seed migrations green.
- Shipped via the automatic pipeline; deployed to accuris + headspace + ero; user Cmd+R to see it.
