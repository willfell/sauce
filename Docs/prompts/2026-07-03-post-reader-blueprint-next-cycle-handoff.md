# Next-cycle handoff — after reader blueprint (vX.Y.Z — pipeline-assigned)

## What just shipped
The **`reader` blueprint** (`spice/reader/`) — a flat reading queue for web articles clipped from the browser via the official **Obsidian Web Clipper**. Two globally-unique note types (`reader-hub` = the render-only root `spice/reader/Reader.md`; `reader-article` = flat leaves, never nested). The lifecycle `unread → reading → archived` lives in the article's frontmatter **`status`** (advancing is a one-field `processFrontMatter` write, never a folder move), and the queue sorts by **`captured_at` (ISO), NOT `mtime`** (landmine #23). Three helpers — `ReaderQueue` (hub queue), `ReaderArticleActions` (leaf status controls), `ReaderArticleView` (leaf card + AI TL;DR callout). Ancestors-mode breadcrumb (no breadcrumb-mechanism change). Ships an import-once Web Clipper artifact `reader-clip.json` with an Interpreter TL;DR (recommended on local Ollama). NO new mechanism — pure reuse (nav-buttons, entity-create, breadcrumb, doc-search, cards, accent-button, section-label, render-safe, open-helpers, customjs-guard, platform-claude). See `Docs/plans/2026-07-03-reader-blueprint-{design,plan,result}.md` + `Docs/agent-guides/reader-blueprint.md`.

## State
- Branch `cycle/reader-blueprint`; full `npm run release:preflight` GREEN (exit 0); `run-reader.js` 22/22; `lint-schemas` 30 schemas 0 issues; workshop dogfood self-install exit 0.
- New: `platform/blueprints/reader/` (manifest, 2 templates, `Reader Hub.md` content, 3 helpers, `reader-clip.json` asset, command, skill). Modified: `platform/install.js` (`applyReaderScaffoldHeal` + `_healReaderChromeBody` + Node-side `_READER_CHROME`), `platform/schemas-index.json` (`reader-rule-fragments`).
- New tests: `run-reader.js` (22 `HC-READER-*`); seed `spice/reader/` (3 articles across statuses) + `HC-V0RDR-SEED-READER-1..4`.
- Version is **pipeline-assigned** — do NOT hand-bump/tag/sweep. `reader@0.1.0` is new.

## Post-merge / deploy checklist
1. Let the release pipeline compute + ship the version (never admin-merge the release PR; unstick a BEHIND-wedge only via `gh pr update-branch`).
2. Deploy to consumers (a new blueprint is NOT auto-installed): for each subscribing vault, **add `{ "name": "reader", "version": "<pin>" }` to its `ranch/platform-subscription.json`**, then run `sauce update --force` **with the vault as the CWD** (SAUCE_VAULT is ignored — cwd-ancestor detection wins). Verify `spice/reader/Reader.md` (`type: reader-hub`) materialized + drift is none, then **`Cmd+R`**.
3. Import `spice/reader/reader-clip.json` once into the browser's Obsidian Web Clipper (extension → templates → import); optionally point the Interpreter at a local Ollama; clip a page and confirm it lands in `spice/reader/` with the AI TL;DR filled.
4. Post-merge, on `main`: `npm run regen-cycle-status`, and (reviewed) seed rebaseline if ratcheting forward.

## Top iteration candidates (deferred fast-follows)
1. **Promote-to-wiki bridge** — move/relate a finished `reader-article` into `spice/wiki/` as standing reference (the `doc-search` mechanism + folder-is-truth substrate is already in place from the wiki cycle).
2. **URL de-dup reconcile** — detect + fold a re-clip of an already-captured `url` (Web Clipper `behavior: create` otherwise writes a second note).
3. **Optional `.base` power view** — an Obsidian Bases table/board over the queue (filter by status/tags, sort by `captured_at`/`word_count`) as an opt-in alternative to the rendered hub.
4. **Connection plane** — link a `reader-article` to a project / meeting / person (the cross-blueprint bidirectional-link idiom the wiki cycle also deferred).

## Landmine refresh
- **Sort a mobile-facing queue by an explicit capture timestamp, never `mtime`** (landmine #23) — `mtime` drifts on mobile/after sync; `selectArticles` sorts each bucket by ISO `captured_at`.
- **The Web Clipper template is import-once by construction** — the installer materializes the JSON into the vault but can't reach the browser extension; a fresh install with an empty queue is not a broken capture flow, it just means the one-time import hasn't happened yet.
- **A new blueprint should register its frontmatter contract in `schemas-index.json` in the same cycle** — reader added `reader-rule-fragments` (wiki had none). Do this for future blueprints.
- **`{{views_path}}` inside a non-`.md` asset is installer-substituted** — the `files[]` pipeline applies `substituteLenient` to assets too, so the clip's `customjs-guard` view path resolves at install.
