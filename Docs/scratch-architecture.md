---
title: Scratch blueprint architecture
date: 2026-05-13
status: living
applies_to: scratch@0.2.7
---

# Scratch blueprint architecture

> [!abstract] Purpose
> Single-sheet reference for the scratch blueprint's runtime architecture and the lessons surfaced during the v0.40.x patch series. Reading this before extending scratch (or before designing a similarly-shaped blueprint) should save the next person from re-discovering the same six bugs.

The user-facing description lives in [[platform/blueprints/scratch/commands/scratch.md]]. This doc is the workshop-side engineering reference.

---

## File layout at runtime

> [!info] Three note kinds, one shared folder per day
> Each consumer vault ends up with this shape under `spice/scratch/`:
> ```
> spice/scratch/
> ├── Scratch.md                                       # Global hub (type: scratch-hub)
> └── 2026/05-May/2026-05-13/
>     ├── Scratch-Day-2026-05-13.md                    # Day-hub (type: scratch-day)
>     ├── Scratch-2026-05-13-09-15.md                  # Leaf scratch (type: scratch)
>     └── Scratch-2026-05-13-11-42.md                  # Leaf scratch (type: scratch)
> ```

The day-hub filename is `Scratch-Day-YYYY-MM-DD.md`. **Collision-free with the daily blueprint** (which uses `dddd-YYYY-MM-DD.md` like `Tuesday-2026-05-13.md`). The pre-v0.40.0 day-index filename was identical to the daily filename — wikilinks resolved ambiguously and clicking "Back to day" sent users to the wrong file.

---

## Helper classes

> [!example]- Six CustomJS classes; each is single-method
> | Class | File | Surface | Role |
> |---|---|---|---|
> | `ScratchDayActions` | `helpers/scratch-day-actions.js` | day-hub | Two-button row: **+ New Scratch** (overlay dialog → write leaf) + **Hub** (navigate to global hub) |
> | `ScratchLeafActions` | `helpers/scratch-leaf-actions.js` | leaf scratch | Two-button row: **Back to Day** (navigate to day-hub) + **Hub** |
> | `ScratchHubActions` | `helpers/scratch-hub-actions.js` | global hub | One-button: **Today** (open-or-create today's day-hub) |
> | `ScratchDayList` | `helpers/scratch-day-list.js` | day-hub | Lists today's leaf scratches; title (or first-line preview) + "edited X ago"; mtime DESC |
> | `ScratchHubCards` | `helpers/scratch-hub-cards.js` | global hub | One BeaconCards row card per day with leaf scratches, latest first |
> | `ScratchNewButton` | `helpers/scratch-new-button.js` | (legacy) | Pre-v0.2.2; retained for back-compat |

All helpers route through `customjs-guard` (`ranch/views/customjs-guard`) which polls `window.customJS` for up to 2s before invoking the named class.

---

## Nav-button mechanics

> [!info] The Scratch nav-button is the universal entry point
> The scratch blueprint's `nav_buttons[]` declares exactly one entry that's appended to `SpaceNavButtons` on every note. Clicking it:
>
> 1. Renderer computes target path: `spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Scratch-Day-<YYYY-MM-DD>.md`
> 2. `app.vault.getAbstractFileByPath(target)` checks existence
> 3. If exists: `app.workspace.openLinkText(target, "")` — no creation, just open
> 4. If absent: `Templater.create_new_note_from_template(<Scratch Day Hub.md>, folder, filename, true)` — creates from template + opens
>
> The open-if-exists branch is **renderer-side and dormant for blueprints whose filenames have a fine-grained time suffix** (every click is unique → always creates). It activates for day-hub because the filename has only date granularity — second click on the same day finds the file and opens it.

---

## v0.40.x lessons learned

> [!warning] Six bugs surfaced in real-vault usage; each is now codified as a defensive pattern.

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

**Fix:** Narrow the leaf glob to a digit-prefixed shape: `Scratch-2*.md`. The leaf filename starts `Scratch-YYYY-...` with YYYY beginning `2`; day-hub starts `Scratch-D`. Disjoint by first character after the hyphen. Works until year 3000.

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

Stale renders return without appending. Only the latest-stamped render reaches the actual UI write.

---

## Schema invariants

> [!todo] Catalogue + ledger lockstep
> - [ ] `platform/blueprints/scratch/manifest.json` `version` is source of truth.
> - [ ] `platform/manifest.json` catalogue entry `blueprints[scratch].version` matches.
> - [ ] `ranch/platform-subscription.json` workshop pin matches.
> - [ ] `ranch/platform-installed.json` ledger (auto-managed; written by installer) reflects installed version.
> - [ ] `platform/test/run-helper-cases.js` SHC-S1 assertion hardcodes the version literal — must bump when manifest bumps.

Per CLAUDE.md non-negotiables: bump the version on **any** change to source files (including helper bodies, templates, claude_surface artifacts).

---

## Rule fragments

> [!info] Two disjoint fragments
>
> **`scratch`** — `spice/scratch/**/Scratch-2*.md`
> - `required_frontmatter`: `created` (string), `type` ≡ `"scratch"`, `day` (string)
> - `naming_pattern`: `^Scratch-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.md$`
>
> **`scratch-day-hub`** — `spice/scratch/**/Scratch-Day-*.md`
> - `required_frontmatter`: `created` (string), `type` ≡ `"scratch-day"`, `day` (string)
> - `naming_pattern`: `^Scratch-Day-\d{4}-\d{2}-\d{2}\.md$`
>
> The leaf glob's `2*` prefix is intentional (see "v0.40.x lesson #4").

The global hub at `spice/scratch/Scratch.md` (type: `scratch-hub`) is not currently covered by a rule fragment.

---

## How leaf scratches are created today (v0.40.5+)

> [!info] Two paths
>
> **A. User clicks + New Scratch on day-hub** — `ScratchDayActions._openTitleDialog(onSubmit)` opens an overlay modal. User types a title. Submit handler:
> 1. Builds the leaf body inline (frontmatter + dataviewjs blocks + empty body section).
> 2. Calls `app.vault.create(filepath, body)` directly. **Bypasses Templater entirely.** This guarantees the title is atomically present in frontmatter at file-creation time.
> 3. Opens the new file via `app.workspace.openLinkText`.
>
> **B. User creates a note in `spice/scratch/` via Obsidian's "New note" UI** — Templater's folder-template wiring (`templater_folder_templates[]` in manifest) auto-applies `ranch/templates/Scratch.md`. No title prompt. `ScratchDayList` falls back to body-preview for the card title.
>
> **C. Programmatic via `new-scratch` skill** — see `skills/new-scratch/SKILL.md`. Builds the body in JS, writes directly. Same shape as path A but without UI.

Path A is the canonical UX path. Paths B + C are escape hatches.

---

## Open follow-ups

> [!warning] Not blockers, but worth a future patch
> - **Hub overwrite policy.** `spice/scratch/Scratch.md` is `skip-if-exists` on install. If a consumer deletes it and re-creates an empty file (frontmatter missing → "invalid properties" warning), the only repair is `rm + sauce update`. A future patch could detect "stub file with frontmatter < N bytes" and overwrite.
> - **Leaf-scratch title prompt is mandatory.** No "skip" path in the overlay dialog. If a user just wants to start typing immediately, they have to type a placeholder title first. Acceptable per current design but worth revisiting.
> - **Mobile button overflow on extremely narrow widths.** `flex-wrap: wrap` lets the two buttons stack vertically on small screens; visual smoke-tested OK on iOS Obsidian. iPad portrait is fine.
> - **Stale `ranch/rules/scratch.json` accumulation.** Pre-v0.40.0 install runs left duplicated rule_fragments in this file (`applyRuleFragment` is push-only, no dedup). Existing consumer vaults need a one-time cleanup; new installs are clean.

---

## Cycle history (most recent first)

| Tag | Summary |
|---|---|
| `v0.40.7` | Render-generation guard against Dataview dual-fire (lesson #6) |
| `v0.40.6` | Templater-race poll for `day` frontmatter (lesson #5) |
| `v0.40.5` | Title-prompt overlay dialog; ScratchHubCards Date tolerance; arrow dedup on Back-to-Day |
| `v0.40.4` | Render-flash idempotency; HR layout; ScratchLeafActions + ScratchHubActions; ScratchDayList rewrite |
| `v0.40.3` | YAML date quoting + `_coerceDay` shim (lesson #1); ScratchDayActions inline-replaces ScratchNewButton |
| `v0.40.2` | SHC-S1 version-assert fix (preflight gate) |
| `v0.40.1` | `customjs-guard` args wrapped in Array (lesson #2); AccentButton via `customJS.AccentButton.render` (lesson #3); `scratch` ICONS entry on nav-buttons mechanism |
| `v0.40.0` | Day-hub redesign — `Scratch-Day-YYYY-MM-DD.md` replaces day-index; nav-button opens-or-creates; ScratchHubCards target path fix; rule fragment narrowing (lesson #4) |
| `v0.37.0` | Initial scratch blueprint shipped |
