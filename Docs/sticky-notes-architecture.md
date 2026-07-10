---
title: Sticky Notes blueprint architecture
date: 2026-05-13
status: living
applies_to: sticky-notes@0.9.0
---

# Sticky Notes blueprint architecture

> [!abstract] Purpose
> Engineering reference for the `sticky-notes` blueprint: a per-day capture surface where each note is a small "sticky" — a leaf note living under a day-hub, all under a global hub. This doc is the workshop-side companion to the user-facing command reference.

The user-facing description lives in [[platform/blueprints/sticky-notes/commands/sticky-notes.md]]. This doc is the workshop-side engineering reference.

---

## File layout at runtime

> [!info] Three note kinds, one shared folder per day
> Each consumer vault ends up with this shape under `spice/sticky-notes/`:
> ```
> spice/sticky-notes/
> ├── Sticky.md                                       # Global hub (type: sticky-hub)
> └── 2026/05-May/2026-05-13/
>     ├── Sticky-Day-2026-05-13.md                    # Day-hub (type: sticky-day)
>     ├── Sticky-2026-05-13-09-15-42.md               # Leaf sticky note (type: sticky-note)
>     └── Sticky-2026-05-13-11-42-08.md               # Leaf sticky note (type: sticky-note)
> ```
>
> The `YYYY/MM-MMMM/YYYY-MM-DD` day sub-structure is stable; only the top-level folder and file prefixes carry the `Sticky`/`Sticky-Day-` naming. Newly-created leaves use `HH-mm-ss` (one-per-second) filenames; leaves migrated from the legacy `scratch` blueprint keep their 2-token `HH-mm` timestamp and still validate (see the rule fragments below).

---

## Helper classes

> [!example]- Five CustomJS classes; each is single-method
> | Class | File | Surface | Role |
> |---|---|---|---|
> | `StickyChromeBar` | `helpers/sticky-chrome-bar.js` | all (hub / day-hub / leaf) | Renders the shared `ChromeBar` for the blueprint (Go ▾ launcher + primary + `⋯`). On a leaf (`sticky-note`) context it also renders the click-to-rename title banner. |
> | `StickyDayList` | `helpers/sticky-day-list.js` | day-hub | Lists today's leaf sticky notes; title (or first-line preview) + "edited X ago"; mtime DESC |
> | `StickyHubCards` | `helpers/sticky-hub-cards.js` | global hub | **Days \| All** toggle. Days: one BeaconCards row card per day with sticky notes, latest first. All: a flat searchable list of every sticky note (title + content) fronted by the `doc-search` strip. |
> | `StickyDayMigrate` | `helpers/sticky-day-migrate.js` | (background) | Re-derives day frontmatter for existing sticky-note day-hubs; path-filtered to `spice/sticky-notes/`. |
> | `StickyDayMigrateInit` | `helpers/sticky-day-migrate-init.js` | (startup) | CustomJS startup entry that registers the `sticky-day-migrate:resync-now` Obsidian command. |

The three legacy action classes `ScratchDayActions` / `ScratchLeafActions` / `ScratchHubActions` were **DROPPED** in the v0.9.0 rewrite: templates now invoke only the ChromeBar (since the chrome-bar adoption), so the day/leaf/hub action rows those classes rendered no longer have a template caller. The rename migration's note-body heal strips their legacy blocks from any pre-migration notes.

All helpers route through `customjs-guard` (`ranch/views/customjs-guard`) which polls `window.customJS` for up to 2s before invoking the named class.

---

## Nav-button mechanics

> [!info] The Sticky Notes nav-button is the universal entry point
> The blueprint's `nav_buttons[]` declares exactly one entry (id `sticky-day-hub`, label "Sticky Notes", icon `sticky-note`) that's appended to `SpaceNavButtons` on every note. Clicking it:
>
> 1. Renderer computes target path: `spice/sticky-notes/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Sticky-Day-<YYYY-MM-DD>.md`
> 2. `app.vault.getAbstractFileByPath(target)` checks existence
> 3. If exists: `app.workspace.openLinkText(target, "")` — no creation, just open
> 4. If absent: `Templater.create_new_note_from_template(<Sticky Day Hub.md>, folder, filename, true)` — creates from template + opens
>
> The nav-button uses `template_source: "Sticky Day Hub.md"` and `filename_prefix: "Sticky-Day-"`. Today's day-hub is opened-or-created; leaves are created from the day-hub or the `+ New Sticky Note` entity-create button.

---

## v0.9.0 — rename + features

> [!note] The v0.9.0 rewrite renamed the blueprint end-to-end and shipped three features.

### Rename map (scratch → sticky-notes)

| Concern | Old | New |
|---|---|---|
| Blueprint / catalogue | `scratch` @ 0.8.0 | `sticky-notes` @ **0.9.0** |
| `module_directory` | `scratch` (`spice/scratch/`) | `sticky-notes` (`spice/sticky-notes/`) |
| Types | `scratch` / `scratch-day` / `scratch-hub` | `sticky-note` / `sticky-day` / `sticky-hub` |
| Hub file | `Scratch.md` | `Sticky.md` |
| Day-hub file | `Scratch-Day-<date>.md` | `Sticky-Day-<date>.md` |
| Leaf file | `Scratch-<date>-<HH-mm>.md` | `Sticky-<date>-<HH-mm-ss>.md` (new creates; migrated files keep 2-token time) |
| Classes kept | ScratchChromeBar, ScratchDayList, ScratchHubCards, ScratchDayMigrate, ScratchDayMigrateInit | StickyChromeBar, StickyDayList, StickyHubCards, StickyDayMigrate, StickyDayMigrateInit |
| Classes dropped | ScratchDayActions, ScratchLeafActions, ScratchHubActions | (deleted — templates only invoke the ChromeBar) |
| Command / skill | `/scratch`, `new-scratch` | `/sticky-notes`, `new-sticky-note` |
| Nav button | id `scratch-day-hub`, label "Scratch", icon `scratch` | id `sticky-day-hub`, label "Sticky Notes", icon `sticky-note` |
| entity-create instance | `scratch` | `sticky-note` |
| CSS / DOM | `scratch-chrome-root`, `__scratchRenderGen` | `sticky-chrome-root`, `__stickyRenderGen`; new `sticky-title-banner` |

### Feature 1 — HH-mm-ss leaf filenames

The `+ New Sticky Note` entity-create button's `filename_date_pattern` moved from `HH-mm` to `HH-mm-ss`, giving one-per-second granularity so multiple sticky notes can be created within the same minute without colliding on `entity-create`'s filename-collision guard. Pre-migration leaves that still carry a 2-token `HH-mm` name keep validating via the optional-seconds token in the leaf naming pattern (see rule fragments).

### Feature 2 — click-to-rename title banner

On a leaf (`sticky-note`) context, `StickyChromeBar` renders a title banner immediately below the chrome bar:

- `StickyChromeBar._maybeRenderBanner(dv)` — resolves the page via `RenderSafe.page(dv)`, bails unless `page.type === "sticky-note"`, then calls `_renderTitleBanner`.
- `StickyChromeBar._renderTitleBanner(container, page, file)` — dedupes across Dataview dual-fire re-renders (removes any prior `.sticky-title-banner`), then appends one banner. Non-empty `title` renders as a heading-styled line; empty renders "Untitled sticky note — click to name" in muted italic.
- Clicking the banner calls `StickyChromeBar._openRenameDialog(file, current, onDone)` — a small overlay modal pre-filled with the current title. Save writes the new value via `app.fileManager.processFrontMatter(file, (fm) => { fm.title = v; })` and re-renders the banner text in place.

This replaces "stuck looking at a title of `Sticky-2026-07-07-09-15.md`" with either the real title or an obvious call-to-action.

### Feature 3 — hub Days | All toggle + searchable All view

`StickyHubCards` gains a **Days | All** segmented toggle above its card area. Toggle state lives on `dv.container.__stickyHubMode` so it survives Dataview's dual-fire re-renders (same technique as the wiki blueprint's section-sort toggle).

- `StickyHubCards._renderToggle(dv, mode)` — the two-pill toggle; clicking a pill flips `__stickyHubMode` and re-renders.
- **Days** (default): unchanged per-day card behavior.
- **All**: `StickyHubCards._renderAll(dv, isStale)` swaps the content area to a flat, recursive, newest-first list of every sticky note, fronted by the `doc-search` mechanism's strip UI (`DocSearch.render` with `scopePath: "spice/sticky-notes"`, `recursive: true`, `entityType: "sticky-note"`, `hideTags: true`). Results render INTO the strip's `ctx.resultsContainer` via a proxy-`dv` shim (the `WikiTree._makeProxyDv` pattern) so `BeaconCards.render` writes into the chosen element.
- `StickyHubCards._matchesFilter(page, needle, body)` — matches on title, filename, AND body content. Title/filename are matched synchronously; body content is matched via an async `app.vault.cachedRead` scan (kept scoped to this helper rather than altering `DocSearch.matches()`'s synchronous contract). An empty filter matches everything (browse-everything is a valid state). Clicking a result opens the leaf note directly, not its day-hub.

### Install migration — `applyScratchToStickyNotesMigration` (platform/install.js)

One-time, existence-gated (runs only when `spice/scratch` is present), idempotent, `.sauce-backup`-snapshotted. Gated on `manifest.name === "sticky-notes"` and runs in the per-item pipeline **before** the per-vault `applyNoteChromeHeal` block. For any vault still carrying `spice/scratch/**`:

1. Back up the tree to `.sauce-backup/sticky-notes-rename/<ts>/`.
2. Move `spice/scratch` → `spice/sticky-notes`, renaming every file (`_stickyRenameFor`: `Scratch.md`→`Sticky.md` at root, `Scratch-Day-`→`Sticky-Day-`, `Scratch-`→`Sticky-`) and rewriting its body via `_rewriteScratchToStickyBody` (anchored rewrites only: `type:` lines, `ScratchChromeBar`/`ScratchDayList`/`ScratchHubCards`/`ScratchDayMigrate` class idents, `[[Scratch-…` links, `spice/scratch/…` paths, tags-block type tokens, `entity-create:scratch`). Skip-if-dest-exists so the fresh install's hub (`spice/sticky-notes/Sticky.md`) wins over a migrated one.
3. Vault-wide sweep: rewrite `[[Scratch…`/`spice/scratch/…` cross-refs in every other markdown file (skipping `.sauce-backup/`, `.trash/`, `spice/sticky-notes/`).
4. Prune orphaned scratch-era installer artifacts (each existence-guarded, backed up, own try/catch): `ranch/scripts/scratch/`, `ranch/templates/Scratch.md` + `Scratch Day Hub.md`, `ranch/rules/scratch.json` + `scratch-day-hub.json`, `.claude/commands/scratch.md`, `.claude/skills/scratch/`; the `"scratch"` keys in the nav-buttons / entity-create / breadcrumb / claude-surface registries; the `ScratchDayMigrateInit` entry in customjs `startupScriptNames`; the `spice/scratch` folder-template in templater `data.json`; and the `"scratch"` `blueprints[]` entry in `ranch/platform-installed.json`. The same install run writes the new `"sticky-notes"` keys through the normal per-item steps — disjoint keys, order-independent.

History events: one `info` summary (`moved N notes, rewrote M cross-refs, pruned K artifacts`) plus a `warning` per caught failure.

**Heal routing:** the note-chrome heal's `CHROME_BAR_MAP` and type allowlist add `sticky-note` / `sticky-day` / `sticky-hub` (all mapping to `StickyChromeBar`) while KEEPING the `scratch` trio (belt-and-suspenders for a vault where migration partially failed — a stray un-migrated note heals to a class that actually exists); the heal `roots` add `spice/sticky-notes` and keep `spice/scratch`.

---

## v0.40.x lessons learned

> [!warning] Six bugs surfaced in real-vault usage; each is now codified as a defensive pattern.
> **Note:** these lessons predate the v0.9.0 rename — the class names below (`ScratchDayList`, `__scratchRenderGen`, etc.) have since been renamed `Scratch*`→`Sticky*` / `__scratchRenderGen`→`__stickyRenderGen`. The defensive patterns themselves are unchanged and timeless.

### 1. YAML date auto-parsing (v0.40.3 fix)

Obsidian's frontmatter parser auto-coerces unquoted `YYYY-MM-DD` and `YYYY-MM` values to Date objects.

**Symptom:** `dv.current().day` returned a Date, not a string. Regex `/^\d{4}-\d{2}-\d{2}$/` failed. Helpers showed "missing or invalid day frontmatter" on every day-hub.

**Fix:** Quote the values in templates (`day: "<% tp.date.now('YYYY-MM-DD') %>"`). Defensive `_coerceDay(raw)` shim in every helper that touches `day`:
```js
_coerceDay(raw) {
    if (typeof raw === "string") return raw.slice(0, 10);
    if (raw && typeof raw.toISODate === "function") return raw.toISODate();
    if (raw instanceof Date && !isNaN(raw)) { /* format YYYY-MM-DD */ }
    return null;
}
```

**Generalization:** Any blueprint whose frontmatter carries a date-shaped value must quote it AND tolerate Date/Luxon on read.

### 2. `customjs-guard` requires `args` to be an Array (v0.40.1 fix)

`view.js:25-26` strictly validates: `args === undefined || Array.isArray(cfg.args)`. Object args fall through and render `customjs-guard: args must be an array`.

**Symptom:** `ScratchDayList` invoked with `args: { day: ... }` (an object) silently broke. The v0.37.0 day-index template had this latent bug; it never fired because the day-index file was never created (other v0.37.0 bug masking this one).

**Fix:** Wrap args in an array. `customjs-guard` spreads `target.call(klass, dv, ...args)` so `args: [{ day: ... }]` arrives as `render(dv, { day: ... })`:
```dataviewjs
await dv.view("...", { class: "ScratchDayList", args: [{ day: dv.current().day }] });
```

### 3. AccentButton mechanism is inline-styled, not class-based (v0.40.1 fix)

The `accent-button` mechanism's `AccentButton.render(parent, opts)` applies styling via `btn.style.cssText`, not via a `beacon-accent-button` CSS class. The class name doesn't exist anywhere.

**Symptom:** Manually writing `dv.container.createEl("button", { text: "...", cls: "beacon-accent-button" })` produced a bare browser default button with no accent styling.

**Fix:** Always use `customJS.AccentButton.render(container, { label, icon, onClick, flex })`. Icon is required (inline SVG HTML, `currentColor` stroke).

### 4. Glob `*` doesn't exclude hyphens (v0.40.0 S3 fix)

`platform/audit/rule-runner.js:_compileGlob` converts `*` → `[^/]*` (no hyphen exclusion). Two scope globs that look disjoint can overlap.

**Symptom:** Leaf fragment's path_glob `Scratch-*.md` matched day-hub filename `Scratch-Day-2026-05-13.md` because `Day-2026-...` is `[^/]*`-compatible. Audit fired false-positive `type` and `naming_pattern` violations on every day-hub.

**Fix:** Narrow the leaf glob to a digit-prefixed shape: `Scratch-2*.md`. The leaf filename starts `Scratch-YYYY-...` with YYYY beginning `2`; day-hub starts `Scratch-D`. Disjoint by first character after the hyphen. Works until year 3000. (Post-rename the same shape applies to `Sticky-2*.md`.)

### 5. Templater lifecycle race during file creation (v0.40.6 fix)

When the nav-button creates a day-hub via `Templater.create_new_note_from_template`:
1. File is written with raw `<%* tp.date.now(...) %>` placeholders.
2. Dataview fires `dataviewjs` blocks. `dv.current().day` is `undefined` or the raw template string.
3. Helper hits "missing day frontmatter" branch and renders an error.
4. Templater processes `~50-200ms` later, frontmatter resolves to real dates.
5. Dataview re-renders. Error disappears.

**Symptom:** Brief flash of "missing day frontmatter" error during first-time day-hub creation.

**Fix:** Poll `dv.current().day` for up to 2s in helpers that depend on it. Mirrors `customjs-guard`'s `wait-for-customJS` pattern:
```js
async _pollForDay(dv) {
    let day = this._coerceDay(dv.current().day);
    for (let i = 0; i < 40 && (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)); i++) {
        await new Promise(r => setTimeout(r, 50));
        day = this._coerceDay(dv.current().day);
    }
    return day;
}
```

If the frontmatter never resolves (genuinely broken note), the error still surfaces after 2s.

### 6. Dataview dual-fire creates duplicate UI during render (v0.40.7 fix)

Dataview can re-fire the same `dataviewjs` block while an earlier render call is still mid-`await`. Both invocations empty the container, but timing skew means each appends output before the next empty fires.

**Symptom:** Brief flash of duplicate buttons or duplicate "No scratches for this day yet" message.

**Fix:** Stamp `dv.container.__scratchRenderGen` at render start, check `isStale()` after every `await`:
```js
async render(dv, args) {
    const myGen = (dv.container.__scratchRenderGen || 0) + 1;
    dv.container.__scratchRenderGen = myGen;
    const isStale = () => dv.container.__scratchRenderGen !== myGen;

    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const day = await this._pollForDay(dv);
    if (isStale()) return;

    // ... more async work + checks ...

    if (isStale()) return;
    await customJS.BeaconCards.render(dv, { ... });
}
```

Stale renders return without appending. Only the latest-stamped render reaches the actual UI write. (Post-rename this generation stamp is `__stickyRenderGen`.)

---

## Schema invariants

> [!todo] Catalogue + ledger lockstep
> - [ ] `platform/blueprints/sticky-notes/manifest.json` `version` is source of truth.
> - [ ] `platform/manifest.json` catalogue entry `blueprints[sticky-notes].version` matches.
> - [ ] `ranch/platform-subscription.json` workshop pin matches.
> - [ ] `ranch/platform-installed.json` ledger (auto-managed; written by installer) reflects installed version.
> - [ ] `platform/test/run-helper-cases.js` SHC-S1 assertion hardcodes the version literal — must bump when manifest bumps.

Per CLAUDE.md non-negotiables: bump the version on **any** change to source files (including helper bodies, templates, claude_surface artifacts).

---

## Rule fragments

> [!info] Two disjoint fragments
>
> **`sticky-note`** — `spice/sticky-notes/**/Sticky-2*.md`
> - `required_frontmatter`: `created` (string), `type` ≡ `"sticky-note"`, `day` (string)
> - `naming_pattern`: `^Sticky-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d{2})?\.md$` (the optional `(-\d{2})?` seconds token accepts both the new 3-token `HH-mm-ss` names and legacy 2-token `HH-mm` migrated names)
>
> **`sticky-day-hub`** — `spice/sticky-notes/**/Sticky-Day-*.md`
> - `required_frontmatter`: `created` (string), `type` ≡ `"sticky-day"`, `day` (string)
> - `naming_pattern`: `^Sticky-Day-\d{4}-\d{2}-\d{2}\.md$`
>
> The leaf glob's `2*` prefix is intentional (see "v0.40.x lesson #4").

The global hub at `spice/sticky-notes/Sticky.md` (type: `sticky-hub`) is not currently covered by a rule fragment.

---

## How leaf sticky notes are created today

> [!info] Two paths
>
> **A. User clicks + New Sticky Note** — the `entity-create` `sticky-note` button opens a title-prompt overlay, then writes the leaf directly (frontmatter with `type: sticky-note`, `created_at`, `day`, `title`, `day_link`) with an `HH-mm-ss` filename, and opens it. The leaf's title banner (rendered by `StickyChromeBar`) makes the title editable in place afterward.
>
> **B. Programmatic via `new-sticky-note` skill** — see `skills/new-sticky-note/SKILL.md`. Builds the body in JS, writes directly. Same shape as path A but without UI.

Path A is the canonical UX path. Path B is an escape hatch.

---

## Cycle history (most recent first)

| Tag | Summary |
|---|---|
| `v0.9.0` (sticky-notes) | Full rename scratch→sticky-notes (types/files/classes/command/icon); HH-mm-ss leaf filenames; click-to-rename title banner; hub Days\|All toggle + searchable All view; `applyScratchToStickyNotesMigration` install migration |
| `v0.40.7` | Render-generation guard against Dataview dual-fire (lesson #6) |
| `v0.40.6` | Templater-race poll for `day` frontmatter (lesson #5) |
| `v0.40.5` | Title-prompt overlay dialog; ScratchHubCards Date tolerance; arrow dedup on Back-to-Day |
| `v0.40.4` | Render-flash idempotency; HR layout; ScratchLeafActions + ScratchHubActions; ScratchDayList rewrite |
| `v0.40.3` | YAML date quoting + `_coerceDay` shim (lesson #1); ScratchDayActions inline-replaces ScratchNewButton |
| `v0.40.2` | SHC-S1 version-assert fix (preflight gate) |
| `v0.40.1` | `customjs-guard` args wrapped in Array (lesson #2); AccentButton via `customJS.AccentButton.render` (lesson #3); `scratch` ICONS entry on nav-buttons mechanism |
| `v0.40.0` | Day-hub redesign — `Scratch-Day-YYYY-MM-DD.md` replaces day-index; nav-button opens-or-creates; ScratchHubCards target path fix; rule fragment narrowing (lesson #4) |
| `v0.37.0` | Initial scratch blueprint shipped |
