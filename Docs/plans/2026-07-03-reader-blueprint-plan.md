# Reader blueprint — implementation plan

- **Design:** [`2026-07-03-reader-blueprint-design.md`](2026-07-03-reader-blueprint-design.md)
- **Branch / worktree:** `cycle/reader-blueprint` @ `.worktrees/reader-blueprint` (off `origin/main` = 0.191.0)
- **Version:** pipeline-assigned (`reader@0.1.0` new; no mechanism range widening intended)
- **Precedent to mirror (read before authoring):** `platform/blueprints/wiki/` (manifest, helpers, templates, commands, skills), `platform/blueprints/trips/manifest.json` (ancestors breadcrumb), `platform/blueprints/home/` (flat hub + quick-capture + `applyHomeScaffoldHeal` in `platform/install.js`), `platform/blueprints/to-do/` (task status toggle via `processFrontMatter`), `platform/test/run-wiki.js` + `run-trips.js` (harness), `platform/schemas-index.json` (finance rule-fragment-bundle entry).

**Execution model:** subagent-driven, one implementer per stage, orchestrator reviews between stages. Each subagent works in `.worktrees/reader-blueprint`, reads the cited precedent, and does NOT bump versions/tags/pins (pipeline owns those). Conventional commits, no Claude co-author trailer, stage explicit files (never `git add -A`).

---

## Stage A — Blueprint scaffold: manifest, templates, content, registration

### Task A1: `platform/blueprints/reader/manifest.json`
**Read first:** `platform/blueprints/wiki/manifest.json` (full) + `platform/blueprints/trips/manifest.json` breadcrumb block + `ranch/nav-buttons-registry.json`.
- [ ] Copy wiki's manifest structure. Set `name: reader`, `version: 0.1.0`, `kind: blueprint`, `module_directory: reader`, `skills_dir: .claude/skills/reader`, a `description`.
- [ ] `depends_on[]`: nav-buttons, customjs-guard, cards, accent-button, entity-create, section-label, breadcrumb, doc-search, render-safe, open-helpers, platform-claude — each `range` pinned to the **currently-shipped** version on `origin/main` (grep `platform/manifest.json`; do NOT widen).
- [ ] `breadcrumb.types` in **ancestors mode**:
  - `reader-hub`: `{ "ancestors": [], "current": { "label": "lit:Reader" } }`
  - `reader-article`: `{ "ancestors": [ { "label": "lit:Reader", "link": "spice/reader/Reader.md" } ], "current": { "label": "fm:title|file:basename" } }`
- [ ] `customjs_classes: ["ReaderQueue","ReaderArticleActions","ReaderArticleView"]`.
- [ ] `nav_buttons[]`: `{ "id": "reader-hub", "label": "Reader", "icon": "book-open", "order": 140, "action": { "type": "openLink", "target": "{{module_directory}}/Reader.md" } }`.
- [ ] `new_entity_buttons[]` — `+ New article`: prompt `title` (string, required, validate safe-filename); destination `folder_prefix: {{module_directory}}`, `filename_prefix: {{prompts.title|sanitize-filename}}`; `frontmatter_template`: `type: reader-article`, `title: {{prompts.title}}`, `status: unread`, `url: ""`, `summary: ""`, `captured_at: {{now.YYYY-MM-DDTHH:mm:ssZ}}`, `tags: ["reader-article"]`; `body_template: Reader Article.md`. (Match wiki's exact prompt/destination field names.)
- [ ] `files[]`: `templates/Reader.md`→`{{templates_path}}/Reader.md`; `templates/Reader Article.md`→`{{templates_path}}/Reader Article.md`; `content/Reader Hub.md`→`{{module_directory}}/Reader.md`; each helper→`{{scripts_path}}/reader/<file>.js`; `assets/reader-clip.json`→`{{module_directory}}/reader-clip.json`.
- [ ] `claude_surface[]`: command `commands/reader.md`→`.claude/commands/reader.md`; skill `skills/new-reader-article/SKILL.md`→`{{skills_dir}}/new-reader-article/SKILL.md`; `claude_md_row` resolver `{ topic: Reader, path: {{module_directory}}, command: /reader }`.
- [ ] `rule_fragments[]`: `reader-hub` (scope `path_glob: spice/reader/Reader.md`, `extends: _canonical-vocab`, required `type` equals `reader-hub`) + `reader-article` (scope `path_glob: spice/reader/*.md`, required `type` present/string). Mirror wiki's two fragments exactly.
- **Verify:** `node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/reader/manifest.json','utf8'))"` parses.

### Task A2: templates + content note
**Read first:** `platform/blueprints/wiki/templates/Wiki.md`, `.../Wiki Page.md`, `.../content/Wiki Hub.md`.
- [ ] `templates/Reader.md` — frontmatter (`type: reader-hub`, `title: Reader`, `dir: spice/reader`, `created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"`, `tags: [reader-hub]`) + 3 guarded blocks: Breadcrumb / SpaceNavButtons / ReaderQueue.
- [ ] `content/Reader Hub.md` — byte-equivalent to the template but a concrete ISO `created_at` (this is the shipped `spice/reader/Reader.md`).
- [ ] `templates/Reader Article.md` — NO frontmatter; guarded blocks Breadcrumb / SpaceNavButtons / ReaderArticleActions / ReaderArticleView, then `\n[//]: # (READER_HIGHLIGHTS)\n` region, then `\n[//]: # (READER_CONTENT)\n`. Use the exact marker-comment style used by home (`[//]: # (HOME_CHROME_END)` — confirm the literal in `platform/install.js`).
- **Verify:** no literal `---` between chrome blocks; every dataviewjs block uses `dv.view("{{views_path}}/customjs-guard", { class: "…" })`.

### Task A3: registration (workshop catalogue + subscriptions)
- [ ] `platform/manifest.json` `blueprints[]` += `{ "name": "reader", "version": "0.1.0", "path": "blueprints/reader" }` (keep array ordering/style consistent).
- [ ] `ranch/platform-subscription.json` `blueprints[]` += `{ "name": "reader", "version": "0.1.0" }`.
- [ ] `platform/test/seed-vault/ranch/platform-subscription.json` `blueprints[]` += same pin.
- **Verify:** all three JSONs parse; `node scripts/check-version-sync.js` still passes (reader is new so no drift).

### Task A4: claude surface bodies
- [ ] `commands/reader.md` — `# /reader — Reader` with sections: **Open** (hub), **New article** (button), **Find** (by status/title), **Web Clipper setup** (import `spice/reader/reader-clip.json`, configure Ollama for TL;DR). Mirror `commands/wiki.md` tone/length.
- [ ] `skills/new-reader-article/SKILL.md` — open with the pre-write vault-identity self-check (copy wiki's `new-wiki-page` skill header verbatim, adapt body).
- **Commit:** `feat(reader): blueprint scaffold — manifest, templates, content, registration, claude surface`

---

## Stage B — Reader helpers (render logic)
**Read first:** `platform/blueprints/wiki/helpers/wiki-tree.js` (render + pure selection + row + search-mode), `wiki-leaf-actions.js` (action row + `_mobilize` + lazy click options), `platform/blueprints/to-do/helpers/*` (status toggle via `app.fileManager.processFrontMatter`; the `renderTaskRow` open-note pattern via `app.workspace.getLeaf().openFile` to dodge the doubled-path cold-cache bug), `platform/mechanisms/doc-search/doc-search.js` (DocSearch.render signature + `hasActiveFilter`). All helpers are **bare `class` bodies, no `module.exports`** (landmines #1–#5), invoked only via customjs-guard.

### Task B1: `helpers/reader-queue.js` — `ReaderQueue`
- [ ] `static selectArticles(dv)` — pure: query `dv.pages('"spice/reader"')`, filter `p.type === "reader-article"`, bucket by `status` (`reading`/`archived`/else→`unread`), sort each by `captured_at` desc, return `{ reading, unread, archived, counts:{unread,reading,archived} }`. Cold-load safe (no pages → empty buckets, zero counts).
- [ ] `render(dv)` — guard `dv.current()?.type === "reader-hub"`. In its own container: best-effort `EntityCreate` `＋ New article` button row (via customjs; match wiki's `WikiHubActions` create-button call) + `DocSearch.render(dv, { scopePath:"spice/reader", recursive:false, entityType:"reader-article", persist:false, onChange })`. Glance pills (`Unread N · Reading N · Archived N`, zeros hidden; reuse `.sauce-section-*-pill` classes). Browse mode → Reading/Unread/Archived bands via `_renderArticleRow`; search mode (`ctx.hasActiveFilter`) → flat results grid.
- [ ] `_renderArticleRow(dv, page)` — title link opens the note (`app.workspace.getLeaf(false).openFile(file)`), source-meta subtitle (`site · author · ~N min`), and a status-toggle control (cycles unread→reading→archived) writing frontmatter.

### Task B2: `helpers/reader-article-actions.js` — `ReaderArticleActions`
- [ ] `render(dv)` — guard `reader-article`. Full-width action row (`max-width:640` centered, `_mobilize` 2-up), owned leading/trailing hairline per note-chrome. Buttons: `Open source ↗` (real `<a target=_blank rel=noopener>` only if `url`), status-aware `Mark reading`/`Mark read` (+ `Back to unread` when archived), `Reader hub` (openLink to `spice/reader/Reader.md`).
- [ ] `async _setStatus(path, next)` — `app.fileManager.processFrontMatter(file, fm => { fm.status = next; })`; pure `_nextStatus(cur)` transition helper (unit-tested).

### Task B3: `helpers/reader-article-view.js` — `ReaderArticleView`
- [ ] `render(dv)` — guard `reader-article`. Card: title + right-aligned status pill; DETAILS grid (author · site · published(humanized) · `~N min read` from `word_count`); `summary` rendered as a prominent callout/blockquote. Hide the whole card if every field empty; hide each row when its field is empty (no `undefined`).
- [ ] `_humanDate(iso)` pure (Hinnant day-math, no `new Date()` in hot path — copy task-note precedent); `_readingMinutes(words)` = `Math.max(1, Math.round(words/200))`.
- **Commit:** `feat(reader): ReaderQueue + ReaderArticleActions + ReaderArticleView render helpers`

---

## Stage C — Web Clipper artifact
### Task C1: `assets/reader-clip.json`
**Read first:** design §11 + the Web Clipper template schema (behavior/path/noteNameFormat/properties/noteContentFormat/triggers/context).
- [ ] Author `reader-clip.json`: `behavior: create`, `path: spice/reader`, `noteNameFormat: {{title|safe_name}}`; `properties[]` = the §4 schema with correct types + `status` default `unread` + `type: reader-article`; `noteContentFormat` = the four guarded render calls + `[//]: # (READER_HIGHLIGHTS)\n{{highlights}}` + `[//]: # (READER_CONTENT)\n{{content}}` (NO literal `---`); `triggers: ["schema:@Article"]`; Interpreter `summary` = `{{"a neutral 2-3 sentence summary of this article"}}`, `tags` augmented by `{{"1-4 lowercase topical tags, comma separated"}}`.
- [ ] Ensure the `files[]` entry (A1) materializes it to `spice/reader/reader-clip.json`.
- **Verify:** JSON parses; body has no `---`; properties types valid.
- **Commit:** `feat(reader): ship Web Clipper reader-clip.json capture template`

---

## Stage D — Schema registry + install heal
### Task D1: `platform/schemas-index.json`
**Read first:** the finance `rule-fragment-bundle` entry.
- [ ] Add `{ id: "reader-rule-fragments", kind: "rule-fragment-bundle", owner: {type: blueprint, name: reader}, source: "platform/blueprints/reader/manifest.json", validator: "platform/install.js", consumers: [...helpers...], notes: "2 rule_fragments (reader-hub, reader-article)" }`.
- **Verify:** `npm run lint-schemas` green.

### Task D2: `applyReaderScaffoldHeal` in `platform/install.js`
**Read first:** `applyHomeScaffoldHeal` + `_healHomeChromeBody` + the singleton-heal call sequence (~`:1248`).
- [ ] Add `_READER_CHROME` const (the hub body: the 3 guarded blocks) + `_healReaderChromeBody(raw)` (sentinel: `if (/class:\s*"ReaderQueue"/.test(raw)) return raw;`; preserve content below `READER_CONTENT` marker if present; idempotent).
- [ ] Add `async function applyReaderScaffoldHeal(tp, history, git)` — ensure `spice/reader/`; if `Reader.md` missing → scaffold (fm + `_READER_CHROME`, no backup); else read → transform → if changed backup to `.sauce-backup/reader/Reader.md.<ts>` then write; try/catch `step: reader_scaffold_heal`; never throws.
- [ ] Call it right after `applyHomeScaffoldHeal(...)` in the singleton-heal sequence.
- **Verify:** `node -c platform/install.js`; dry idempotency (running the pure transform twice is a fixed point).
- **Commit:** `feat(install): applyReaderScaffoldHeal + reader schema-registry entry`

---

## Stage E — Seed vault + behavioral harness
### Task E1: seed-vault coverage
**Read first:** `platform/test/seed-vault/spice/wiki/` layout + `platform/test/run-seed-migrations.js` assert style.
- [ ] Create `platform/test/seed-vault/spice/reader/Reader.md` (hub) + 3 `reader-article` notes: one `unread`, one `reading`, one `archived` (with url/site/author/summary/word_count/captured_at populated).
- [ ] Add `HC-V0XYZ-SEED-READER-*` asserts to `run-seed-migrations.js`: install exit 0, `spice/reader/Reader.md` present with `ReaderQueue` chrome, the 3 articles queryable by `type`+`status`.

### Task E2: `platform/test/run-reader.js`
**Read first:** `platform/test/run-wiki.js` (loader + pure asserts) + `run-trips.js` (dv/app/DOM stubs). Optionally scaffold via `npm run scaffold-harness -- v0XYZ reader` then fill.
- [ ] Load `ReaderQueue`/`ReaderArticleActions`/`ReaderArticleView` via the `new Function(src+"\nreturn Class;")()` loader (proves loadability).
- [ ] Assert: `selectArticles` bucketing + counts + `captured_at` desc + unknown-status→unread + empty-vault safety; `_nextStatus` transitions; `_humanDate`/`_readingMinutes` math; structural checks on templates + `content/Reader Hub.md` (chrome blocks present, no `---`, markers present).
- [ ] Wire `&& node platform/test/run-reader.js` into `package.json` `release:preflight` (near `run-wiki`/`run-home`).
- **Commit:** `test(reader): behavioral harness (run-reader) + seed-vault migration coverage`

---

## Stage F — Docs
### Task F1: agent guide
- [ ] `Docs/agent-guides/reader-blueprint.md` — canonical reference (note types, folder-is-truth-lite + status frontmatter, the 3 helpers, chrome/breadcrumb ancestors, doc-search, entity-create routing, the Web Clipper capture flow + Ollama TL;DR, the scaffold heal). Add a one-line pointer row to `CLAUDE.md`'s Further-reading list (outside marker regions — safe to hand-edit prose there).
- **Commit:** `docs(reader): agent guide for the reader blueprint`

---

## Stage G — Verification gate (before PR)
- [ ] **G1:** `npm run release:preflight` → whole-suite GREEN (incl. `run-reader`, `run-seed-migrations`, `lint-schemas`).
- [ ] **G2:** workshop dogfood — `node platform/install.js --vault . --auto-approve` → exit 0, `spice/reader/Reader.md` scaffolded, no error history.
- [ ] **G3:** clean tree → `npm run release:preflight-bumped` → GREEN (catch a release wedge before merge). Restores tree.
- [ ] **G4:** cycle-close artifacts — `Docs/plans/2026-07-03-reader-blueprint-result.md`, append `Docs/cycle-history.md`, `Docs/prompts/2026-07-03-post-reader-blueprint-next-cycle-handoff.md`, `Docs/install.md` Upgrading section. (`cycle-status.md` refresh is fine to include.)
- **Commit:** `docs(reader): cycle-close artifacts (result, cycle-history, handoff)`

---

## Stage H — PR, CI, merge, ship, deploy
- [ ] **H1:** `git merge origin/main` (reconcile autoloop churn); re-run G1 if merge touched anything; `git push -u origin cycle/reader-blueprint`; `gh pr create` (title `feat(reader): reader blueprint — Web Clipper capture + reading queue`, body summarizing surfaces + testing).
- [ ] **H2:** wait for CI (`preflight (macos-latest)` + `preflight (ubuntu-latest)`) GREEN → **merge the FEATURE PR** (squash). If wedged behind release-PR churn and it's a zero-overlap green PR, admin-merge is acceptable (never the release PR).
- [ ] **H3:** the release pipeline auto-opens the release PR → auto-merges on green → tags `vX.Y.Z` → patches + auto-merges the homebrew tap PR → brew serves it. Monitor; do NOT hand-merge release/tap PRs. Confirm the tag + `brew upgrade sauce` picks up the new version.
- [ ] **H4:** deploy the NEW blueprint to consumers — for each of `accuris`, `headspace`, `ero`: add `{ name: reader, version: <shipped> }` to `<vault>/ranch/platform-subscription.json` `blueprints[]`, then `cd <vault> && sauce update --force` (PATH incl `/opt/homebrew/bin`). Verify `spice/reader/Reader.md` + helpers landed + `sauce status` drift none. (`Scripts/autoloop/deploy.js` only bumps already-subscribed pins — it will NOT add reader; the per-vault subscribe + `--force` is required. `git fetch --tags` first if using deploy.js for the brew step.)
- **Report** only after all three vaults show the reader blueprint installed + drift none.

---

## Self-review notes (author)
- Ancestors breadcrumb (not path_walk) chosen because Reader is flat — no breadcrumb-mechanism change needed.
- No new mechanism ⇒ smallest blast radius; only `reader@0.1.0` is new; shared mechanisms are depended-on, not modified.
- Status is frontmatter, ordered by `captured_at` (not `mtime` — landmine #23 mobile).
- Web Clipper template is an import-once artifact (installer can't push to a browser extension) — materialized into the vault + documented.
- All render helpers bare-class + customjs-guard-only (landmines #1–#5); harness loads each to prove loadability.
- No hand-versioning/tagging/pin-sweeping (pipeline owns it); deploy is the only manual post-merge step (new blueprint not auto-installed on consumers).
