# Sticky Notes Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full rename of the `scratch` blueprint to `sticky-notes` (types, folder, filenames, classes, command, icon) plus three features: per-second leaf filenames (multi-create within a minute), a click-to-rename title banner on leaf notes, and a searchable "All" view on the hub — with an install migration that converts every existing consumer vault.

**Architecture:** The blueprint directory renames wholesale (`platform/blueprints/scratch` → `platform/blueprints/sticky-notes`) with 5 of 8 helper classes kept (3 legacy action classes dropped — templates only use the ChromeBar since the chrome-bar adoption). A new `applyScratchToStickyNotesMigration` in `platform/install.js` moves `spice/scratch/**` → `spice/sticky-notes/**`, renames files, rewrites frontmatter/links/class-refs vault-wide, and prunes every orphaned installer artifact (old ranch scripts/templates/rules, registry entries keyed `"scratch"`, the `ScratchDayMigrateInit` customjs startup entry, the old templater folder-template, `.claude` command/skill). Cross-blueprint consumers (daily dashboard, home quick-capture, nav-buttons pinned sources, activity-feed) switch to the new type/instance ids.

**Tech Stack:** Node.js (headless installer + test harnesses), Obsidian CustomJS/Dataview helpers, existing sauce mechanisms (chrome-bar, entity-create, doc-search, icons, cards, nav-buttons).

**Spec:** `Docs/plans/2026-07-08-sticky-notes-rewrite-design.md` (approved).

---

## Context for a zero-context engineer

- This repo (**the workshop**) ships **mechanisms** (cross-cutting code) and **blueprints** (note-type bundles) that consumer Obsidian vaults install via a Templater-driven installer (`platform/install.js`). The workshop also self-installs as its own consumer ("dogfood") — so `ranch/`, `spice/`, `.claude/commands|skills` at repo root are *installed artifacts* that must be updated in lockstep (Task 9).
- **Read these before starting:** `Docs/agent-guides/code-conventions.md` (five non-negotiables), `Docs/agent-guides/architecture.md`, `Docs/agent-guides/migration-regression-net.md` (for Task 8), `Docs/landmines.md`.
- **Never** hand-bump `workshop_version`, `package.json` version, or tag releases — the release pipeline does that. Authoring a NEW component's initial version (sticky-notes@0.9.0) is fine; that's authoring, not bumping.
- Preflight gate: `npm run release:preflight` (long chain of `node platform/test/run-*.js` + lint scripts). CI runs it on macOS + Ubuntu.
- Helper classes are **CustomJS instances**: no class-level statics reachable at runtime, no `MarkdownRenderer` global, args to `customjs-guard` must be an Array. See `Docs/scratch-architecture.md` "v0.40.x lessons learned" — every defensive pattern there (dual-fire render generation, `_coerceDay`, `_pollForDay`) must survive the rename.

## Naming SSOT (every task uses exactly these)

| Concern | Old | New |
|---|---|---|
| Blueprint name / catalogue entry | `scratch` @ 0.8.0, `blueprints/scratch` | `sticky-notes` @ **0.9.0**, `blueprints/sticky-notes` |
| `module_directory` | `scratch` (→ `spice/scratch/`) | `sticky-notes` (→ `spice/sticky-notes/`) |
| Note types | `scratch` / `scratch-day` / `scratch-hub` | `sticky-note` / `sticky-day` / `sticky-hub` |
| Hub file | `spice/scratch/Scratch.md` | `spice/sticky-notes/Sticky.md` |
| Day-hub file | `Scratch-Day-<YYYY-MM-DD>.md` | `Sticky-Day-<YYYY-MM-DD>.md` |
| Leaf file | `Scratch-<date>-<HH-mm>.md` | `Sticky-<date>-<HH-mm-ss>.md` (new creates; migrated files keep 2-token time) |
| Classes kept (5) | ScratchChromeBar, ScratchDayList, ScratchHubCards, ScratchDayMigrate, ScratchDayMigrateInit | StickyChromeBar, StickyDayList, StickyHubCards, StickyDayMigrate, StickyDayMigrateInit |
| Classes DROPPED (3) | ScratchDayActions, ScratchLeafActions, ScratchHubActions | (deleted — templates only invoke the ChromeBar; the install heal strips legacy blocks from old notes) |
| Helper files | `helpers/scratch-*.js` → `{{scripts_path}}/scratch/` | `helpers/sticky-*.js` → `{{scripts_path}}/sticky-notes/` |
| Templates | `Scratch.md`, `Scratch Day Hub.md`, `Scratch Hub.md` | `Sticky Note.md`, `Sticky Day Hub.md`, `Sticky Hub.md` |
| Command / skill | `/scratch`, `new-scratch`, `skills_dir .claude/skills/scratch` | `/sticky-notes`, `new-sticky-note`, `.claude/skills/sticky-notes` |
| Nav button | id `scratch-day-hub`, label "Scratch", icon `scratch` | id `sticky-day-hub`, label "Sticky Notes", icon `sticky-note`, order 130 (unchanged) |
| entity-create instance | `scratch` | `sticky-note` |
| Rule fragments | targets `scratch` / `scratch-day-hub` | targets `sticky-note` / `sticky-day-hub`; leaf glob `Sticky-2*.md`; leaf naming `^Sticky-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d{2})?\.md$`; day naming `^Sticky-Day-\d{4}-\d{2}-\d{2}\.md$` |
| CSS / DOM | `scratch-chrome-root`, `scratch-chrome-btn*`, `__scratchRenderGen` | `sticky-chrome-root`, `sticky-chrome-btn*`, `__stickyRenderGen`; new `sticky-title-banner` |
| Obsidian command | `scratch-day-migrate:resync-now` | `sticky-day-migrate:resync-now` |
| CLAUDE.md resolver row | Scratch / spice/scratch / /scratch | Sticky Notes / spice/sticky-notes / /sticky-notes |
| Test harnesses | run-scratch.js, run-scratch-render-guards.js, run-scratch-chrome-bar.js, run-scratch-migrate.js | run-sticky-notes.js, run-sticky-notes-render-guards.js, run-sticky-notes-chrome-bar.js, run-sticky-notes-migrate.js (+ NEW run-sticky-notes-rename-migration.js) |

### DO-NOT-TOUCH list (the word "scratch" that is NOT this blueprint)

- `platform/mechanisms/nav-buttons/space-nav-buttons.js` `.scratch/nav-button-pending-args.json` scratchpad dot-dir (lines ~566-594) — an unrelated IPC scratchpad. Leave every occurrence of `.scratch/` alone.
- `platform/bootstrap-lib/wizard.js` example vault paths like `"scratch/11"` (~line 89-119) — sample directory names, unrelated. (But DO check its default-blueprint set — Task 6 step 7.)
- `Docs/landmines.md` line ~315 `~/scratch/my-edit.js` — a home-dir path example.
- `Docs/cycle-history.md`, `Docs/plans/2026-05-*.md`, `Docs/prompts/*` — historical records. Never rewrite history docs.
- `platform/test/seed-vault-prev/**` — frozen prior-cycle snapshot. Never edit.
- `platform/install.js` legacy strip lists (`LEGACY_CLASSES`, the `hasLegacyAction` regex, `_stripDividersAroundActionBlock(out, 'ScratchDayActions')`) keep the OLD `Scratch*` class names — they exist to strip legacy blocks from old note bodies. Task 7 adds new-type routing *alongside*, it does not rename these.
- `install.js` comments describing history (v0.124.0 etc.) — leave.

---

## Execution ground rules

- Work happens on branch `feature/sticky-notes-rewrite` created from `origin/main` in this worktree; cherry-pick the design-doc + plan commits from the current worktree branch first.
- TDD per task; run the named harnesses after each step. Full `npm run release:preflight` is Task 11.
- Commit after every task (conventional commits, scope `sticky-notes` for blueprint work; `feat!`/BREAKING not needed — 0.x line).
- Subagents MUST verify `git branch --show-current` = `feature/sticky-notes-rewrite` and edit files under THIS worktree's absolute path (`.../worktrees/bridge-cse_015dAGeqNZZUeiu3VgQwrsrA/`) — see auto-memory lessons about edits landing on main / wrong tree.

---

### Task 1: Branch setup

**Files:** none (git only)

- [ ] **Step 1:** `git fetch origin && git checkout -b feature/sticky-notes-rewrite origin/main`
- [ ] **Step 2:** Cherry-pick the design-doc commit from the worktree branch (`git log --oneline --all -- 'Docs/plans/2026-07-08-sticky-notes-rewrite-design.md'` to find it): `git cherry-pick d984616e` (and the plan-doc commit once it exists).
- [ ] **Step 3:** `node platform/test/run-scratch.js && node platform/test/run-helper-cases.js` — expect PASS (clean baseline before touching anything).

### Task 2: Blueprint directory rename (mechanical core)

**Files:**
- Rename dir: `platform/blueprints/scratch` → `platform/blueprints/sticky-notes`
- Rename+edit: all 5 kept helpers, 3 templates, `commands/scratch.md`→`commands/sticky-notes.md`, `skills/new-scratch/SKILL.md`→`skills/new-sticky-note/SKILL.md`, `manifest.json`
- Delete: `helpers/scratch-day-actions.js`, `helpers/scratch-leaf-actions.js`, `helpers/scratch-hub-actions.js`
- Modify: `platform/manifest.json` (catalogue entry), `platform/test/fixtures/component-versions.snapshot.json`, `platform/mechanisms/icons/icons.js`, `platform/rules/_canonical-vocab.json`, `platform/cli/cmd-migrate-frontmatter.js`

- [ ] **Step 1:** `git mv platform/blueprints/scratch platform/blueprints/sticky-notes`, then `git mv` each helper/template/command/skill file per the SSOT table; `git rm` the 3 dropped action helpers.
- [ ] **Step 2:** Rewrite each kept helper: apply the SSOT renames (class name, `spice/sticky-notes`, `Sticky-Day-`, `Sticky.md`, `sticky-chrome-root`, `__stickyRenderGen`, `ranch/templates/Sticky Day Hub.md`, Notice/console strings, doc-comments). In `sticky-day-migrate.js`: path filter `f.path.startsWith("spice/sticky-notes/")`; keep `_extractDateFromPath` unchanged (its regexes are prefix-agnostic). In `sticky-day-migrate-init.js`: command id `sticky-day-migrate:resync-now`, name `"Sauce: Re-migrate sticky-note day frontmatter"`. **Do not change any logic** — pure rename in this task (features come in Tasks 4-5).
- [ ] **Step 3:** Rewrite templates:

`templates/Sticky Note.md` (leaf; was `Scratch.md`):
```md
---
type: sticky-note
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
time: "<% tp.date.now("HH:mm") %>"
day_link: "[[Sticky-Day-<% tp.date.now('YYYY-MM-DD') %>]]"
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "StickyChromeBar" });
```
```

`templates/Sticky Day Hub.md`: same as current `Scratch Day Hub.md` with `type: sticky-day`, `StickyChromeBar`, `StickyDayList`.
`templates/Sticky Hub.md`: `type: sticky-hub`, H1 `# Sticky Notes`, `StickyChromeBar`, `StickyHubCards`.

- [ ] **Step 4:** Rewrite `manifest.json` — name `sticky-notes`, version `0.9.0`, `module_directory: "sticky-notes"`, `skills_dir: ".claude/skills/sticky-notes"`, fresh short description (rename + planned features; drop the accreted changelog), `depends_on` unchanged PLUS `{ "name": "doc-search", "range": ">=0.1.0" }`, `customjs_classes` = the 5 new names, `customjs_startup_scripts: ["StickyDayMigrateInit"]`, `files[]` with new source/dest names (`{{scripts_path}}/sticky-notes/…`, `{{templates_path}}/Sticky Note.md` etc., hub dest `{{module_directory}}/Sticky.md`), `claude_surface[]` (command `sticky-notes.md`, skill `new-sticky-note`, resolver row topic "Sticky Notes" command "/sticky-notes"), `nav_buttons[]` (SSOT: id/label/icon; `template_source: "Sticky Day Hub.md"`, `filename_prefix: "Sticky-Day-"`), `new_entity_buttons[]` (id `sticky-note`, label `+ New Sticky Note`, prompt label "Sticky note title (optional)", destination `folder_prefix: "spice/sticky-notes/{{current_file.frontmatter.day|today}}-routed"`, `filename_prefix: "Sticky-{{current_file.frontmatter.day|today}}-"`, **`filename_date_pattern: "HH-mm-ss"`**, frontmatter_template type `sticky-note` + `created_at`/`day`/`title` as today, inline_body invoking `StickyChromeBar`), `templater_folder_templates` (folder `{{module_directory}}` → `{{templates_path}}/Sticky Note.md`), `rule_fragments` per SSOT (leaf naming pattern **with optional `(-\d{2})?` seconds token**), `breadcrumb.types` `sticky-note` + `sticky-day` (labels `lit:Sticky Notes`; day-hub link `spice/sticky-notes/{path:2}/{path:3}/{path:4}/Sticky-Day-{path:4}.md`; leaf current `fm:time|file:basename`).
- [ ] **Step 5:** `platform/manifest.json` catalogue: replace the scratch entry with `{ "name": "sticky-notes", "version": "0.9.0", "path": "blueprints/sticky-notes" }`. `component-versions.snapshot.json`: rename key `scratch` → `sticky-notes: "0.9.0"`.
- [ ] **Step 6:** `icons.js` Tier-1: ADD (keep `scratch`):
```js
"sticky-note": `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/></svg>`,
```
(lucide `sticky-note`, folded-corner square; matches 15×15 stroke aesthetic). Bump `icons` manifest is NOT needed by hand — the bumper handles versioning from the commit touching `platform/mechanisms/icons/`.
- [ ] **Step 7:** `_canonical-vocab.json` `discriminator_tags`: add `sticky-note`, `sticky-day` (KEEP `scratch`, `scratch-day` — legacy tag stripping). `cmd-migrate-frontmatter.js` `PATH_TO_TYPE`: add `"sticky-notes": "sticky-note"` (keep the `"scratch"` row — legacy source-vault migration).
- [ ] **Step 8:** Verify: `grep -rn "Scratch\|scratch" platform/blueprints/sticky-notes/` returns ZERO hits. `node platform/test/run-customjs-loadable.js` passes (5 classes load).
- [ ] **Step 9:** Commit `feat(sticky-notes): rename scratch blueprint to sticky-notes (types, files, classes, icon, HH-mm-ss filenames)`.

### Task 3: Rename the blueprint's test harnesses

**Files:**
- Rename+edit: `platform/test/run-scratch.js`→`run-sticky-notes.js`, `run-scratch-render-guards.js`→`run-sticky-notes-render-guards.js`, `run-scratch-chrome-bar.js`→`run-sticky-notes-chrome-bar.js`, `run-scratch-migrate.js`→`run-sticky-notes-migrate.js`
- Modify: `platform/test/run-helper-cases.js` (SHC-S1..S6 block, ~lines 4331-4400), `package.json` (`release:preflight` script: the four run-scratch* entries)

- [ ] **Step 1:** `git mv` the four harnesses; inside each update require paths (`platform/blueprints/sticky-notes/helpers/sticky-*.js`), class names, assertion ids (keep the `HC-V0841-*` historical family names but update strings that name classes/paths), and expected literals (`spice/sticky-notes`, `Sticky-Day-`, `sticky-chrome-root`, dispatch target `spice/sticky-notes/Sticky.md`, command id). `run-sticky-notes-chrome-bar.js` asserts the adapter config: contexts `sticky-hub`/`sticky-day`/`sticky-note`, rootClass `sticky-chrome-root`.
- [ ] **Step 2:** Rewrite SHC-S1..S6 in `run-helper-cases.js`: manifest path `platform/blueprints/sticky-notes/manifest.json`, `m.name === "sticky-notes"`, `VERSION_SNAPSHOT.components["sticky-notes"]`, `module_directory === "sticky-notes"`; SHC-S2 → `templates/Sticky Note.md` (`type: sticky-note`, back-link `Sticky-Day-` prefix); SHC-S3 → `Sticky Day Hub.md` (`type: sticky-day`, invokes StickyChromeBar + StickyDayList); SHC-S4 → `Sticky Hub.md` (`type: sticky-hub`, StickyHubCards); SHC-S5/S6 → renamed helper files/classes. Scan the REST of run-helper-cases.js for any other `scratch` mention (63 matches pre-rename) and fix each (e.g. dependency-graph or files[] path assertions).
- [ ] **Step 3:** `package.json`: replace the four `run-scratch*` invocations with the new names.
- [ ] **Step 4:** Run: `node platform/test/run-sticky-notes.js && node platform/test/run-sticky-notes-render-guards.js && node platform/test/run-sticky-notes-chrome-bar.js && node platform/test/run-sticky-notes-migrate.js && node platform/test/run-helper-cases.js` — all PASS.
- [ ] **Step 5:** Commit `test(sticky-notes): rename scratch harnesses + SHC-S* to sticky-notes`.

### Task 4: Feature — title banner on leaf notes (in StickyChromeBar)

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js`
- Test: `platform/test/run-sticky-notes-chrome-bar.js`

The leaf template renders ONLY `StickyChromeBar`, so the banner lives there: after `ChromeBar.render` returns, on `sticky-note` context, append a title banner below the bar.

- [ ] **Step 1: Failing tests** (append to run-sticky-notes-chrome-bar.js; use the harness's existing `loadClass` + DOM-stub style — mirror `run-todo-markdown-render.js` RTR-3's faithful-DOM approach if a fuller stub is needed):
```js
// STCB-BANNER-1: _bannerText falls back correctly
ok("STCB-BANNER-1a title used", inst._bannerText({ title: "Grocery list" }) === "Grocery list");
ok("STCB-BANNER-1b empty title → placeholder", inst._bannerText({ title: "  " }) === null);
ok("STCB-BANNER-1c missing title → placeholder", inst._bannerText({}) === null);
// STCB-BANNER-2: renderTitleBanner appends one .sticky-title-banner, dedupes on re-render
// (build a minimal container stub with createEl/querySelectorAll; call inst._renderTitleBanner(containerStub, page, fileStub) twice; assert exactly one banner node)
```
- [ ] **Step 2:** Run `node platform/test/run-sticky-notes-chrome-bar.js` — expect the new assertions FAIL (methods undefined).
- [ ] **Step 3: Implement.** In `StickyChromeBar`:
```js
render(dv) {
  try {
    if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
      || typeof customJS.ChromeBar.render !== "function") return;
    const out = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    this._maybeRenderBanner(dv);
    return out;
  } catch (_e) { /* never throw */ }
}

_maybeRenderBanner(dv) {
  try {
    const page = customJS.RenderSafe.page(dv);
    if (!page || page.type !== "sticky-note") return;
    const file = app.vault.getAbstractFileByPath((page.file && page.file.path) || "");
    this._renderTitleBanner(dv.container, page, file);
  } catch (_e) {}
}

_bannerText(page) {
  const t = page && page.title != null ? String(page.title).trim() : "";
  return t.length > 0 ? t : null;
}

_renderTitleBanner(container, page, file) {
  // Dedupe across Dataview dual-fire re-renders.
  try { container.querySelectorAll(".sticky-title-banner").forEach((e) => e.remove()); } catch (_e) {}
  const banner = container.createEl("div", { cls: "sticky-title-banner" });
  banner.style.cssText = "margin: 10px auto 2px; max-width: 640px; cursor: pointer;";
  const text = this._bannerText(page);
  const h = banner.createEl("div", { text: text || "Untitled sticky note — click to name" });
  h.style.cssText = text
    ? "font-size: 1.35em; font-weight: 700; color: var(--text-normal); line-height: 1.3;"
    : "font-size: 1.1em; font-weight: 500; color: var(--text-muted); font-style: italic;";
  banner.title = "Click to rename";
  banner.addEventListener("click", () => this._openRenameDialog(file, text || "", (newTitle) => {
    h.textContent = newTitle || "Untitled sticky note — click to name";
    h.style.cssText = newTitle
      ? "font-size: 1.35em; font-weight: 700; color: var(--text-normal); line-height: 1.3;"
      : "font-size: 1.1em; font-weight: 500; color: var(--text-muted); font-style: italic;";
  }));
}

_openRenameDialog(file, current, onDone) {
  if (!file || !app.fileManager || typeof app.fileManager.processFrontMatter !== "function") return;
  const overlay = document.body.createEl("div");
  overlay.style.cssText = "position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;";
  const box = overlay.createEl("div");
  box.style.cssText = "background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; width: min(420px, 90vw); display: flex; flex-direction: column; gap: 10px;";
  box.createEl("div", { text: "Sticky note title" }).style.cssText = "font-weight: 600;";
  const input = box.createEl("input", { type: "text", value: current });
  input.style.cssText = "padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
  const row = box.createEl("div");
  row.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
  const close = () => overlay.remove();
  const save = async () => {
    const v = input.value.trim();
    try { await app.fileManager.processFrontMatter(file, (fm) => { fm.title = v; }); } catch (_e) {}
    close();
    if (typeof onDone === "function") onDone(v);
  };
  const cancelBtn = row.createEl("button", { text: "Cancel" });
  cancelBtn.addEventListener("click", close);
  const saveBtn = row.createEl("button", { text: "Save" });
  saveBtn.style.cssText = "background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer;";
  saveBtn.addEventListener("click", save);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") close(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  setTimeout(() => input.focus(), 0);
}
```
Adjust to match how the test stub exposes `createEl` (Obsidian's `createEl` exists on elements; the stub must provide it — copy the stub pattern from `run-scratch-render-guards.js`'s predecessor or `run-todo-markdown-render.js`).
- [ ] **Step 4:** Run the harness — new assertions PASS; earlier assertions still PASS.
- [ ] **Step 5:** Commit `feat(sticky-notes): title banner with click-to-rename on leaf notes`.

### Task 5: Feature — Days | All toggle + searchable All view (StickyHubCards)

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-hub-cards.js`
- Test: `platform/test/run-sticky-notes.js`

- [ ] **Step 1: Failing tests** (append; drive REAL methods with dv/customJS stubs — the repo's non-negotiable is faithful tests over replicas):
```js
// STHC-ALL-1: _matchesFilter — title hit, filename hit, body hit, miss
const hc = new StickyHubCards();
ok("STHC-ALL-1a title match", hc._matchesFilter({ title: "Grocery run" , file:{name:"Sticky-2026-07-08-09-15-00.md"}}, "grocery", ""));
ok("STHC-ALL-1b filename match", hc._matchesFilter({ file:{name:"Sticky-2026-07-08-09-15-00.md"}}, "07-08", ""));
ok("STHC-ALL-1c body match", hc._matchesFilter({ file:{name:"x.md"}}, "kubernetes", "notes about Kubernetes upgrade"));
ok("STHC-ALL-1d miss", !hc._matchesFilter({ title:"a", file:{name:"b.md"}}, "zzz", "body"));
ok("STHC-ALL-1e empty filter matches", hc._matchesFilter({ file:{name:"b.md"}}, "", ""));
// STHC-ALL-2: _mode defaults to "days", survives via container property
// STHC-ALL-3: render in "all" mode lists every sticky-note across days newest-first
//   (dv stub: pages() returns 3 sticky-note pages across 2 days with mtimes; BeaconCards stub captures opts;
//    assert 3 items, sort newest-first, meta contains the day)
```
- [ ] **Step 2:** Run — FAIL (methods missing).
- [ ] **Step 3: Implement.** Reshape `StickyHubCards.render(dv)`:
```js
async render(dv) {
  if (dv.container.closest(".markdown-embed")) return;
  const myGen = (dv.container.__stickyRenderGen || 0) + 1;
  dv.container.__stickyRenderGen = myGen;
  const isStale = () => dv.container.__stickyRenderGen !== myGen;
  while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

  const mode = this._mode(dv.container);
  this._renderToggle(dv, mode);
  if (mode === "all") await this._renderAll(dv, isStale);
  else await this._renderDays(dv, isStale);
}

_mode(container) { return container.__stickyHubMode === "all" ? "all" : "days"; }

_renderToggle(dv, mode) {
  const row = dv.container.createEl("div");
  row.style.cssText = "display: flex; gap: 6px; justify-content: center; margin: 4px 0 10px;";
  const mk = (key, label) => {
    const b = row.createEl("button", { text: label });
    const active = mode === key;
    b.style.cssText = "padding: 4px 14px; border-radius: 12px; border: 1px solid var(--background-modifier-border); cursor: pointer; font-size: 0.85em;"
      + (active ? "background: var(--interactive-accent); color: var(--text-on-accent);"
                : "background: var(--background-secondary); color: var(--text-muted);");
    b.addEventListener("click", () => {
      if (this._mode(dv.container) === key) return;
      dv.container.__stickyHubMode = key;
      this.render(dv); // full re-render; generation stamp handles staleness
    });
  };
  mk("days", "Days");
  mk("all", "All");
}
```
`_renderDays` = the existing per-day card body (unchanged logic, minus the container-emptying it used to own — now done in `render`). `_renderAll`:
```js
async _renderAll(dv, isStale) {
  const bodyCache = new Map(); // path → body (per render pass)
  const readBody = async (p) => {
    if (bodyCache.has(p)) return bodyCache.get(p);
    let body = "";
    try { body = await app.vault.cachedRead(app.vault.getAbstractFileByPath(p)); } catch (_e) {}
    bodyCache.set(p, body);
    return body;
  };

  const renderResults = async (ctx) => {
    const gen = (dv.container.__stickyAllGen || 0) + 1;
    dv.container.__stickyAllGen = gen;
    const stale = () => dv.container.__stickyAllGen !== gen || isStale();
    const pages = dv.pages('"spice/sticky-notes"').where((p) => p.type === "sticky-note");
    const needle = (ctx && ctx.text ? ctx.text : "").toLowerCase();
    const items = [];
    for (const s of pages) {
      const body = needle ? await readBody(s.file.path) : "";
      if (stale()) return;
      if (!this._matchesFilter(s, needle, body)) continue;
      let title = (s.title && String(s.title).trim()) || "";
      if (!title) title = this._extractPreviewFromBody(await readBody(s.file.path)) || s.file.name;
      items.push({ file: s.file, _title: title, _day: this._coerceDay(s.day) || "",
                   _mtime: (s.file.mtime && s.file.mtime.ts) || 0 });
    }
    if (stale()) return;
    ctx.resultsContainer.empty ? ctx.resultsContainer.empty() : (ctx.resultsContainer.innerHTML = "");
    await customJS.BeaconCards.render({ container: ctx.resultsContainer, ...dv, container: ctx.resultsContainer }, { /* see note below */ });
  };

  if (customJS.DocSearch && typeof customJS.DocSearch.render === "function") {
    const ctx = customJS.DocSearch.render(dv, {
      scopePath: "spice/sticky-notes", recursive: true, entityType: "sticky-note",
      persist: false, hideTags: true, hideNativeSearch: false,
      placeholder: "Search sticky notes (title + content)…",
      onChange: (c) => { renderResults(c); },
    });
    await renderResults(ctx);
  }
}

_matchesFilter(page, needle, body) {
  if (!needle) return true;
  const title = (page && page.title ? String(page.title) : "").toLowerCase();
  const name = (page && page.file && page.file.name ? page.file.name : "").toLowerCase();
  return title.includes(needle) || name.includes(needle) || (body || "").toLowerCase().includes(needle);
}
```
**Implementation notes for the engineer:** (a) `DocSearch.render` returns a ctx with a `resultsContainer` — cards must render INTO that container, not `dv.container`; the proven pattern is `WikiTree._makeProxyDv` (`platform/blueprints/wiki/helpers/wiki-tree.js`) which wraps `dv` so `BeaconCards.render` writes into a chosen element — copy that shim instead of the inline spread hack sketched above. (b) `_extractPreviewFromBody` moves from `sticky-day-list.js` — duplicate it (3 helpers ≤15 lines; cross-class private calls between customJS instances are allowed via `customJS.StickyDayList._extractPreviewFromBody` but keeping a private copy avoids load-order coupling). (c) BeaconCards opts for the All list: `layout: "row"`, `title: (p) => p._title`, `meta: (p) => day + "edited X ago"` spans, `target: (p) => p.file.path`, `sort: (a,b) => b._mtime - a._mtime`, `empty: "No sticky notes match."`. (d) Empty filter shows ALL notes (browse-everything is a valid state).
- [ ] **Step 4:** Run `node platform/test/run-sticky-notes.js` — PASS.
- [ ] **Step 5:** Commit `feat(sticky-notes): hub Days|All toggle with title+content search (doc-search strip)`.

### Task 6: Cross-blueprint + mechanism consumers

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js`, `platform/blueprints/home/helpers/space-home.js`, `platform/blueprints/home/commands/home.md`, `platform/blueprints/home/manifest.json` (if it names scratch), `platform/mechanisms/nav-buttons/space-nav-buttons.js`, `platform/mechanisms/activity-feed/activity-feed.js`, `platform/blueprints/cowork/helpers/cowork-hub-nav.js` (comment), `platform/blueprints/project/helpers/project-chrome-bar.js` (comment), `platform/mechanisms/chrome-bar/chrome-bar.js` (if it pins sources), `scripts/lint-note-chrome.js`, `platform/bootstrap-lib/wizard.js` (default blueprint set only)
- Test: `platform/test/run-activity-feed.js`, `platform/test/run-daily-dashboard.js`, `platform/test/run-home.js`, `platform/test/run-nav-launcher` targets (whatever `npm run test:nav-launcher` maps to)

- [ ] **Step 1:** `space-daily-dashboard.js`: `_DEFAULT_DASHBOARD_BLUEPRINTS` `"scratch"` → `"sticky-note"`; `groupOrderBottom: ["sticky-note"]`; `ascendingGroups: ["sticky-note"]`; `_BLUEPRINT_COLORS` key `scratch` → `sticky-note` (same orange). Check how activity-feed derives the group LABEL from the type key — if the raw type string renders as the group header, add/extend whatever label map exists so it displays "Sticky Notes" (grep activity-feed.js for label/display handling; if none exists, the header shows "sticky-note" — in that case add a `groupLabels` opt only if the mechanism already supports one; do NOT invent a new mechanism feature in this task, note it in the commit body instead).
- [ ] **Step 2:** `activity-feed.js` `_DEFAULT_BLUEPRINTS`: `"scratch"`, `"scratch-day"` → `"sticky-note"`, `"sticky-day"`.
- [ ] **Step 3:** `space-home.js`: capture button `{ key: "sticky-note", label: "＋ Sticky Note", … }` (keep the pencil svg), dispatch `EntityCreate.create({ instance: "sticky-note", dv })`; update comments. `home/commands/home.md` quick-capture text. Grep `platform/blueprints/home/manifest.json` for `scratch` (soft capture-target references) and update to `sticky-notes`/`sticky-note` to match.
- [ ] **Step 4:** `space-nav-buttons.js` `PINNED_SOURCES = ["home", "to-do", "sticky-notes", "project", "meetings"]` (registry is keyed by blueprint SOURCE name). Update the two comments naming Scratch in the pinned row. Grep `platform/mechanisms/chrome-bar/chrome-bar.js` for `scratch`/pinned-source handling and apply the same source-name change if present.
- [ ] **Step 5:** `scripts/lint-note-chrome.js`: adopted-blueprint list `scratch` → `sticky-notes` (grep lines ~8, 207 — it keys on blueprints declaring a `breadcrumb` manifest block, so this may auto-resolve; verify by running it).
- [ ] **Step 6:** Comment-only fixes: `cowork-hub-nav.js` line 7 ("Mirrors ScratchDayActions aesthetic" → reference AccentButton row aesthetic), `project-chrome-bar.js` line ~376 pinned list comment (`home/to-do/sticky-notes/…`).
- [ ] **Step 7:** `bootstrap-lib/wizard.js`: if the DEFAULT blueprint subscription set contains `"scratch"`, change to `"sticky-notes"`. Do NOT touch the `"scratch/11"` example vault paths.
- [ ] **Step 8:** Update the paired tests: `run-activity-feed.js` fixtures using `type: "scratch"` → `sticky-note` (AF-V070 closed-state cases etc.), `run-daily-dashboard.js` SELTASK/activity fixtures if they name scratch, `run-home.js` capture-button assertions (label + instance id), nav-launcher tests asserting pinned order.
- [ ] **Step 9:** Run: `node platform/test/run-activity-feed.js && node platform/test/run-daily-dashboard.js && node platform/test/run-home.js && npm run test:nav-launcher && node scripts/lint-note-chrome.js` — all PASS.
- [ ] **Step 10:** Commit `feat(sticky-notes): repoint daily/home/nav-buttons/activity-feed consumers to sticky-note types`.

### Task 7: install.js — rename migration + heal-map updates

**Files:**
- Modify: `platform/install.js`
- Test: NEW `platform/test/run-sticky-notes-rename-migration.js` (+ add to `package.json` preflight after `run-sticky-notes-migrate.js`)

**Read first:** `applyWikiToDocsMigration` (install.js:1980-2146, the closest precedent: existence-gated, `.sauce-backup`, `_copyDirRecursive`/`_rmDirRecursive`, per-entry history events) and `platform/test/run-wiki-to-docs-migration.js` (harness precedent: extracts pure functions via regex/`new Function`, adapter stub for the driver).

- [ ] **Step 1: Failing tests.** Create `run-sticky-notes-rename-migration.js` covering the pure pieces first:
```js
// SNRM-1: _rewriteScratchToStickyBody
//  1a type: scratch → sticky-note; 1b type: scratch-day → sticky-day; 1c type: scratch-hub → sticky-hub
//  1d quoted forms (type: "scratch") too; 1e day_link "[[Scratch-Day-2026-06-17]]" → "[[Sticky-Day-2026-06-17]]"
//  1f class refs ScratchChromeBar/ScratchDayList/ScratchHubCards → Sticky*
//  1g "spice/scratch/Scratch.md" → "spice/sticky-notes/Sticky.md" (hub path BEFORE generic)
//  1h generic "spice/scratch/" → "spice/sticky-notes/"; 1i wikilink [[Scratch-2026-06-17-14-30]] → [[Sticky-...]]
//  1j tags block scratch/scratch-day → sticky-note/sticky-day; 1k idempotent (2nd pass byte-equal)
//  1l unrelated content untouched (a body with the word "scratchpad" in prose stays intact —
//     rewrites are anchored: type-lines, class idents, [[Scratch- links, spice/scratch/ paths)
// SNRM-2: _stickyRenameFor(basename, isRoot)
//  2a ("Scratch.md", true) → "Sticky.md"; 2b ("Scratch-Day-2026-06-17.md") → "Sticky-Day-2026-06-17.md"
//  2c ("Scratch-2026-06-17-14-30.md") → "Sticky-2026-06-17-14-30.md"; 2d ("2026-06-14-test-scratch.md") → unchanged
// SNRM-3: driver against an adapter stub (in-memory fs map): given a fake vault with
//  spice/scratch/{Scratch.md, 2026/06-June/2026-06-17/{Scratch-Day-2026-06-17.md, Scratch-2026-06-17-14-30.md}},
//  ranch/scripts/scratch/*.js, ranch/templates/Scratch.md + "Scratch Day Hub.md", ranch/rules/scratch.json +
//  scratch-day-hub.json, .claude/commands/scratch.md, .claude/skills/scratch/new-scratch/SKILL.md,
//  registries with "scratch" keys, customjs data.json with ScratchDayMigrateInit, templater data.json with
//  the spice/scratch folder-template, a daily note linking [[Scratch-2026-06-17-14-30]]:
//  3a old tree gone, new tree complete with renamed files + rewritten types
//  3b outside-tree link rewritten; 3c ranch/scripts/scratch gone; 3d rules gone; 3e templates gone
//  3f registry "scratch" keys pruned (nav-buttons/entity-create/breadcrumb/claude-surface contributions)
//  3g customjs startupScriptNames has no ScratchDayMigrateInit; 3h templater folder_templates has no spice/scratch
//  3i .claude/commands/scratch.md + skills/scratch dir gone; 3j .sauce-backup contains pre-move copies
//  3k second run: zero writes (idempotent — spice/scratch absent short-circuits)
//  3l platform-installed.json blueprints[] has no "scratch" entry after prune
```
- [ ] **Step 2:** Run it — FAIL (functions don't exist).
- [ ] **Step 3: Implement in install.js.** Add near `applyWikiToDocsMigration`:
```js
// applyScratchToStickyNotesMigration — v0.9.0 sticky-notes rename. One-time,
// existence-gated (spice/scratch present), idempotent, .sauce-backup'd.
// Runs in the per-item pipeline gated on manifest.name === "sticky-notes",
// BEFORE the per-vault applyNoteChromeHeal block. Moves + renames the tree,
// rewrites frontmatter/class-refs/links vault-wide, prunes every orphaned
// scratch-era installer artifact (files, registries, customjs startup entry,
// templater folder-template, claude_surface files, installed-ledger entry).
function _stickyRenameFor(basename, isRoot) {
  if (isRoot && basename === "Scratch.md") return "Sticky.md";
  if (/^Scratch-Day-/.test(basename)) return basename.replace(/^Scratch-Day-/, "Sticky-Day-");
  if (/^Scratch-/.test(basename)) return basename.replace(/^Scratch-/, "Sticky-");
  return basename;
}

function _rewriteScratchToStickyBody(body) {
  if (typeof body !== "string") return body;
  let out = body;
  // frontmatter types (order: longest first)
  out = out.replace(/^type:\s*["']?scratch-day["']?\s*$/m, "type: sticky-day");
  out = out.replace(/^type:\s*["']?scratch-hub["']?\s*$/m, "type: sticky-hub");
  out = out.replace(/^type:\s*["']?scratch["']?\s*$/m, "type: sticky-note");
  // tags blocks (bullet + inline-flow), mirror _rewriteWikiToDocsBody
  out = out.replace(/(\btags\s*:[\s\S]*?)(["']?)scratch-day\2/g, "$1$2sticky-day$2");
  out = out.replace(/(\btags\s*:[\s\S]*?)(["']?)scratch\2(?!-)/g, "$1$2sticky-note$2");
  // customJS class refs
  out = out.replace(/ScratchChromeBar/g, "StickyChromeBar");
  out = out.replace(/ScratchDayList/g, "StickyDayList");
  out = out.replace(/ScratchHubCards/g, "StickyHubCards");
  out = out.replace(/ScratchDayMigrate/g, "StickyDayMigrate");
  // paths + links (hub-specific BEFORE generic)
  out = out.replace(/spice\/scratch\/Scratch\.md/g, "spice/sticky-notes/Sticky.md");
  out = out.replace(/Scratch-Day-/g, "Sticky-Day-");
  out = out.replace(/spice\/scratch/g, "spice/sticky-notes");
  out = out.replace(/ranch\/templates\/Scratch Day Hub\.md/g, "ranch/templates/Sticky Day Hub.md");
  out = out.replace(/\[\[Scratch-(\d)/g, "[[Sticky-$1");
  out = out.replace(/\[\[Scratch\]\]/g, "[[Sticky]]");
  out = out.replace(/entity-create:scratch/g, "entity-create:sticky-note");
  return out;
}
```
Driver skeleton (`async function applyScratchToStickyNotesMigration(tp, manifest, variables, history, git)`):
1. Gate: `manifest.name !== "sticky-notes"` → return; adapter guard like wiki migration.
2. If `await adapter.exists("spice/scratch")`:
   a. Backup the tree: `_copyDirRecursive(adapter, "spice/scratch", ".sauce-backup/sticky-notes-rename/<ts>/spice/scratch")`.
   b. Walk it (recursive list); for every file compute the new path (`spice/sticky-notes/<same-sub-path>/<_stickyRenameFor(basename, atRoot)>`), `mkdir -p` parents (reuse the segment-walk mkdir idiom at install.js:951), write `_rewriteScratchToStickyBody(body)`, count.
   c. `_rmDirRecursive(adapter, "spice/scratch")`.
   d. Vault-wide sweep: `_listAllMarkdownRecursive(adapter, "")` — skip paths starting `.sauce-backup/`, `.trash/`, `spice/sticky-notes/`; for each, `after = _rewriteScratchToStickyBody(before)`; write only when changed (count).
3. Prune orphaned artifacts (each guarded by existence + backed up before delete; each its own try/catch):
   - files: `ranch/scripts/scratch/` (whole dir — content-guard each `.js` contains `class Scratch` before deleting; back up then `_rmDirRecursive`), `ranch/templates/Scratch.md`, `ranch/templates/Scratch Day Hub.md`, `ranch/rules/scratch.json`, `ranch/rules/scratch-day-hub.json`, `.claude/commands/scratch.md`, `.claude/skills/scratch/` (dir).
   - registries: for each of `ranch/nav-buttons-registry.json` (top-level key `"scratch"`), `ranch/entity-create-registry.json`, `ranch/breadcrumb-registry.json`, `ranch/claude-surface-registry.json` (all keyed under `contributions` by source name — INSPECT the actual shape in code before writing; nav-buttons is a bare dict keyed by source): delete the `"scratch"` key if present, rewrite file. (The same install run writes the `"sticky-notes"` keys through the normal per-item steps — pruning `"scratch"` never collides.)
   - `.obsidian/plugins/customjs/data.json`: remove `"ScratchDayMigrateInit"` from `startupScriptNames` (the normal `customjs_startup_scripts` step adds `StickyDayMigrateInit`).
   - `.obsidian/plugins/templater-obsidian/data.json`: remove any `folder_templates` entry whose `folder === "spice/scratch"`.
   - `ranch/platform-installed.json`: remove the `blueprints[]` entry named `"scratch"` (read-modify-write; the live `installed` object in the main flow is separate — this file-level prune is enough because the ledger is re-written from `installedNow` at the end; ALSO splice `"scratch"` out of the in-memory ledger if reachable — check how `installed.blueprints` flows and do whichever the harness proves works; assert via SNRM-3l).
4. History events: one `info` summary (`moved N notes, rewrote M cross-refs, pruned K artifacts`), `warning` per caught failure. Full git fields on every push (copy the idiom from `applyWikiToDocsMigration`).
5. Wire the call in the per-item pipeline next to `applyWikiToDocsMigration` (install.js ~line 1238): `await applyScratchToStickyNotesMigration(tp, mech, variables, history, git); // NEW sticky-notes rename — must run in per-item phase, before the per-vault applyNoteChromeHeal`.
- [ ] **Step 4: Heal-map/type-list updates** (same file, separate concern — new types must route through existing heals):
   - `CHROME_BAR_MAP` (~line 6035): ADD `"sticky-hub": "StickyChromeBar", "sticky-day": "StickyChromeBar", "sticky-note": "StickyChromeBar"`; CHANGE the three old scratch keys' value to `"StickyChromeBar"` too (a stray un-migrated note should heal to the class that actually exists).
   - Type allowlist (~line 6516): add `"sticky-note", "sticky-day", "sticky-hub"` (keep the scratch trio).
   - `roots` (~line 6494): add `"spice/sticky-notes"` (keep `"spice/scratch"` — a vault mid-migration-failure still gets healed).
   - Step-7 divider strip (~line 6026): add `if (type === 'sticky-day') out = _stripDividersAroundActionBlock(out, 'ScratchDayActions');` — NO. Post-migration bodies no longer say ScratchDayActions. Instead leave the existing `scratch-day` line untouched and skip adding a sticky-day line (migrated bodies already went through class-ref rewrite; legacy divider cases are covered pre-migration by the old type). Document this reasoning in a one-line comment.
- [ ] **Step 5:** Run `node platform/test/run-sticky-notes-rename-migration.js` — PASS. Add it to `package.json` preflight (after `run-sticky-notes-migrate.js`).
- [ ] **Step 6:** Commit `feat(install): scratch→sticky-notes rename migration + heal routing for sticky types`.

### Task 8: Seed-vault + migration regression net

**Files:**
- Modify: `platform/test/seed-vault/ranch/platform-subscription.json` (swap `{"name":"scratch",…}` → `{"name":"sticky-notes","version":"0.9.0"}` — sanctioned: mirrors the manual consumer-deploy step; the seed's `spice/scratch/**` tree stays EXACTLY as-is, it IS the pre-migration input)
- Modify: `platform/test/run-seed-migrations.js` (new assert family + fix now-stale families)

- [ ] **Step 1:** Append family (after the newest existing family; run `node platform/test/run-seed-migrations.js` FIRST to see the current pass baseline):
```js
// ===== HC-SEED-MIGRATE-STICKY-* — applyScratchToStickyNotesMigration =====
assert("HC-SEED-MIGRATE-STICKY-1 spice/scratch gone", !fs.existsSync(path.join(vault, "spice/scratch")));
assert("HC-SEED-MIGRATE-STICKY-2 hub renamed + typed",
  helpers.readNote(vault, "spice/sticky-notes/Sticky.md").includes("type: sticky-hub"));
assert("HC-SEED-MIGRATE-STICKY-3 user note moved intact",
  helpers.readNote(vault, "spice/sticky-notes/2026-06-14-test-scratch.md") !== null);
assert("HC-SEED-MIGRATE-STICKY-4 leaf renamed + typed",
  helpers.readNote(vault, "spice/sticky-notes/2026/06-June/2026-06-17/Sticky-2026-06-17-14-30.md").includes("type: sticky-note"));
assert("HC-SEED-MIGRATE-STICKY-5 day-hub renamed + typed",
  helpers.readNote(vault, "spice/sticky-notes/2026/06-June/2026-06-17/Sticky-Day-2026-06-17.md").includes("type: sticky-day"));
assert("HC-SEED-MIGRATE-STICKY-6 helper scripts swapped",
  !fs.existsSync(path.join(vault, "ranch/scripts/scratch"))
  && fs.existsSync(path.join(vault, "ranch/scripts/sticky-notes/sticky-chrome-bar.js")));
assert("HC-SEED-MIGRATE-STICKY-7 rules swapped",
  !fs.existsSync(path.join(vault, "ranch/rules/scratch.json"))
  && fs.existsSync(path.join(vault, "ranch/rules/sticky-note.json")));
assert("HC-SEED-MIGRATE-STICKY-8 nav registry pruned",
  !("scratch" in JSON.parse(fs.readFileSync(path.join(vault, "ranch/nav-buttons-registry.json"), "utf8"))));
assert("HC-SEED-MIGRATE-STICKY-9 claude surface swapped",
  !fs.existsSync(path.join(vault, ".claude/commands/scratch.md"))
  && fs.existsSync(path.join(vault, ".claude/commands/sticky-notes.md")));
assert("HC-SEED-MIGRATE-STICKY-10 customjs startup swapped",
  (() => { const d = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian/plugins/customjs/data.json"), "utf8"));
           return !d.startupScriptNames.includes("ScratchDayMigrateInit")
                && d.startupScriptNames.includes("StickyDayMigrateInit"); })());
```
(Adapt assert/read helper names to the harness's actual API — read `helpers/seed-vault-helpers.js` first.)
- [ ] **Step 2:** Fix now-stale existing families: `PRESERVE-2` (the scratch user note is INTENTIONALLY moved — repoint to `spice/sticky-notes/2026-06-14-test-scratch.md` and assert content preserved modulo the anchored rewrites; if the note contains none of the rewrite anchors, byte-equal still holds — check the fixture), `FM-*` Scratch.md row (→ Sticky.md sticky-hub), `SHAPE-*` if it lists spice/scratch. IDEMP families should pass as-is (migration self-gates on the moved dir); if IDEMP-3 flags registry/data.json churn, extend `KNOWN_MUTABLE` ONLY if the second run legitimately rewrites them — prefer fixing idempotency.
- [ ] **Step 3:** `node platform/test/run-seed-migrations.js` — PASS (all families).
- [ ] **Step 4:** Commit `test(seed): sticky-notes rename migration family + preserved-note repoint`.

### Task 9: Workshop dogfood migration (hand-applied, scoped)

The workshop self-installs; its installed artifacts must match what the installer would now produce. Inventory (verified): `spice/scratch/Scratch.md` (only file), `ranch/scripts/scratch/` (8 files incl. legacy `scratch-new-button.js`), `ranch/templates/Scratch.md` + `Scratch Day Hub.md`, `ranch/rules/scratch.json` + `scratch-day-hub.json`, `.claude/commands/scratch.md`, `.claude/skills/scratch/new-scratch/`, registries with `"scratch"` keys, `.obsidian/plugins/customjs/data.json` startup `ScratchDayMigrateInit`, `.obsidian/plugins/templater-obsidian/data.json` folder-template `spice/scratch`, `ranch/platform-subscription.json` pin `scratch@0.8.0`, root `CLAUDE.md` marker rows (resolver "Scratch", skills index).

**Files:** all of the above.

- [ ] **Step 1:** `git mv spice/scratch spice/sticky-notes && git mv spice/sticky-notes/Scratch.md spice/sticky-notes/Sticky.md`; rewrite its body via the same transforms (type sticky-hub, StickyChromeBar/StickyHubCards, H1 "# Sticky Notes").
- [ ] **Step 2:** `git rm -r ranch/scripts/scratch ranch/templates/Scratch.md 'ranch/templates/Scratch Day Hub.md' ranch/rules/scratch.json ranch/rules/scratch-day-hub.json .claude/commands/scratch.md .claude/skills/scratch`; then copy the NEW installed shapes: `ranch/scripts/sticky-notes/*.js` (5 helpers, contents identical to blueprint sources), `ranch/templates/Sticky Note.md` + `Sticky Day Hub.md` (with `{{views_path}}` → `ranch/views` substituted — compare how the old installed templates differ from blueprint sources and mirror exactly), `ranch/rules/sticky-note.json` + `sticky-day-hub.json` (mirror the shape of the old rule files with new values), `.claude/commands/sticky-notes.md`, `.claude/skills/sticky-notes/new-sticky-note/SKILL.md`.
- [ ] **Step 3:** Registries: in `ranch/nav-buttons-registry.json` rename key `"scratch"` → `"sticky-notes"` with the new entry values (id/label/icon/template_source/filename_prefix per SSOT); same source-key + value updates in `ranch/entity-create-registry.json`, `ranch/breadcrumb-registry.json`, `ranch/claude-surface-registry.json` (inspect shapes; entries mirror the new manifest blocks). `ranch/platform-subscription.json`: `{"name":"sticky-notes","version":"0.9.0"}`. `.obsidian/plugins/customjs/data.json`: startup entry → `StickyDayMigrateInit`. `.obsidian/plugins/templater-obsidian/data.json`: folder-template → `{"folder":"spice/sticky-notes","template":"ranch/templates/Sticky Note.md"}`.
- [ ] **Step 4:** Root `CLAUDE.md` marker regions: update the Scratch resolver row to `| Sticky Notes | spice/sticky-notes | /sticky-notes |` (these regions are installer-managed; we're writing exactly what the installer would write — precedent: v0.196.1 scoped hand-edit instead of full self-install). Keep row alphabetical position consistent with how the installer sorts (check neighboring rows).
- [ ] **Step 5:** `node platform/test/run-claude-surface.js && node platform/test/run-helper-cases.js` — PASS (helper-cases cross-checks catalogue/manifest/ranch-pin/snapshot agreement).
- [ ] **Step 6:** Commit `chore(dogfood): migrate workshop vault artifacts to sticky-notes`.

### Task 10: Docs

**Files:**
- Rename+edit: `Docs/scratch-architecture.md` → `Docs/sticky-notes-architecture.md`; `Docs/agent-guides/smoke-checklists/scratch.md` → `sticky-notes.md`
- Modify: `Docs/getting-started.md` (2 mentions), `Docs/agent-guides/note-chrome.md` (current-state adopted-blueprint lists + type-uniqueness example), `Docs/landmines.md` (ONLY current-state lists, e.g. the adopted-blueprint enumeration ~line 482; leave historical "Surfaced: v0.124.0" prose)

- [ ] **Step 1:** `sticky-notes-architecture.md`: update frontmatter (`applies_to: sticky-notes@0.9.0`), file-layout tree, helper table (5 classes; note the 3 dropped action classes + why), nav-button target, rule fragments, naming SSOT, add a "v0.9.0 rename + features" section (rename map, HH-mm-ss, title banner, Days|All search, the install migration + prune list). Keep the "v0.40.x lessons learned" section verbatim (timeless defensive patterns) with a one-line note that class names have since renamed.
- [ ] **Step 2:** Smoke checklist rewrite: open hub → Days/All toggle → All search (title hit + body hit) → Today → + New Sticky Note twice within a minute (two files, HH-mm-ss) → leaf banner shows title → click banner → rename → banner + day-list title update → migrated legacy note opens clean.
- [ ] **Step 3:** getting-started + note-chrome + landmines current-state edits per file list above.
- [ ] **Step 4:** Commit `docs(sticky-notes): architecture + smoke checklist + guide updates`.

### Task 11: Full preflight + straggler sweep

- [ ] **Step 1:** `grep -rn -i "scratch" platform/ scripts/ package.json ranch/ spice/ .claude/commands .claude/skills CLAUDE.md --exclude-dir=node_modules | grep -v -e seed-vault-prev -e "\.scratch/" -e scratch-new-button` — every remaining hit must be justifiable against the DO-NOT-TOUCH list (seed-vault pre-migration fixtures under `platform/test/seed-vault/spice/scratch/` + its `ranch/*scratch*` copies are EXPECTED — they're the migration input; install.js legacy strip lists are EXPECTED). Fix anything else.
- [ ] **Step 2:** `npm run release:preflight` — iterate to green. Expected trouble spots: `run-renderer.js` / `run-integration-smoke.js` / `run-coverage-rubric.js` (blueprint↔test-file name mapping), `run-install.js`, `lint-cold-load.js` (new banner/search code must pass cold-load rules — no bare `dv.current().file.x`; we used `RenderSafe.page`), `run-content-token-leaks.js` (new templates), `scripts/lint-schemas.js` (manifest shape).
- [ ] **Step 3:** Commit fixes (`test: preflight stragglers for sticky-notes rename`).

### Task 12: PR → CI → merge → release → tap → brew → deploy

- [ ] **Step 1:** Push branch; `gh pr create` (base `main`) titled `feat: sticky-notes blueprint — rename scratch + per-second creates + title banner + searchable All view`, body per `.github/pull_request_template.md`. Before creating: `git fetch origin && git merge origin/main` (autoloop churn — resolve if any).
- [ ] **Step 2:** Watch CI (`gh pr checks --watch`). Fix reds; merge ONLY when green (squash-merge; admin-merge past the release-PR BEHIND treadmill only if checks are green and diff-overlap is zero — established precedent).
- [ ] **Step 3:** Release pipeline runs automatically on main: bumper computes sticky-notes 0.9.0→0.10.0-ish + umbrella minor, opens `chore(release)` PR that auto-merges, tags, bumps the brew tap. Wait for: release PR merged → tag exists → tap PR opened. Merge the tap PR if it doesn't auto-merge (`gh pr list -R <tap repo>` — find the tap repo via `git -C $(brew --repo)/Library/Taps ...` or `brew tap` listing; deploy.js `bottleVersion()` shows the polling pattern).
- [ ] **Step 4:** `brew update && brew upgrade sauce`; verify `/opt/homebrew/opt/sauce/libexec/platform/manifest.json` carries the new workshop_version + sticky-notes entry.
- [ ] **Step 5:** Per consumer vault (accuris `/Users/willfellhoelter/notes/sauce/accuris-sauce`, headspace `.../headspace-sauce`, ero `.../ero-sauce`): FIRST verify `ranch/platform-config.json` `workshop_relative_path` (memory says brew libexec; vault-paths.md stale). Edit `ranch/platform-subscription.json`: remove the `scratch` entry, add `{"name":"sticky-notes","version":"<released version from brewed catalogue>"}`; confirm `doc-search` is present (it is — wiki dependency). Then `bash -c 'cd <vault> && PATH=/opt/homebrew/bin:$PATH sauce update --bump-pins'` (new-component lesson: hand-add before update; never run from the workshop cwd).
- [ ] **Step 6:** Verify per vault: `spice/scratch` absent; `spice/sticky-notes/` populated (Sticky.md + renamed day trees); `ranch/scripts/sticky-notes/` present, `ranch/scripts/scratch/` gone; registries have `sticky-notes` key and no `scratch` key; customjs startup swapped; `.sauce-backup/sticky-notes-rename/` snapshot exists; installer exit 0. Spot-read one migrated leaf (type sticky-note, day_link `[[Sticky-Day-…]]`).
- [ ] **Step 7:** `node scripts/autoloop/deploy.js run` (or its verify mode) to confirm all three vaults report the shipped version — memory precedent "deploy.js allOk".
- [ ] **Step 8:** Report back to the user: shipped version, per-vault verification, note that Obsidian needs Cmd+R in each vault, and any follow-ups.

---

## Self-review notes (resolved inline)

- **Banner home**: design doc said "fold into StickyLeafActions" — that class is retired from templates by the chrome-bar adoption, so the banner lives in StickyChromeBar (leaf context). Design intent (banner below chrome on every leaf) preserved.
- **Old leaf filenames**: migration renames prefix only; 2-token `HH-mm` names remain valid via the optional-seconds naming pattern.
- **Bumper compatibility**: new catalogue entry authored at 0.9.0; commits touching `platform/blueprints/sticky-notes/` attribute correctly by path prefix; snapshot fixture hand-renamed now, regenerated by the bumper at release; seed pins auto-bumped by `compute-release --write`.
- **Registry prune vs re-add ordering**: prune deletes key `"scratch"`; the same install writes key `"sticky-notes"` — disjoint keys, order-independent.
- **`spice/scratch` kept in heal roots + legacy strip lists**: belt-and-suspenders for a vault where migration partially failed; heals are idempotent no-ops otherwise.
