# Sticky + Journal — leaf-note title, ⋯ actions, hub cleanup

**Date:** 2026-07-13
**Blueprints:** `sticky-notes` (0.10.2 → 0.11.0), `journal` (0.4.2 → 0.5.0)
**Mechanisms touched:** none (SectionExplorer.renderNoteLinks is reused via its existing public entry point)
**Scope:** four inter-related visual + interaction fixes on both blueprints, plus install heals for existing consumer hubs

## Problem

Four connected complaints on the sticky-notes and journal blueprints:

1. **Leaf-note title styling is out of taste.** Both bars render the current note's title/basename as a bold, large heading (`font-size: 1.35em; font-weight: 700`) — visually loud and inconsistent with the rest of the vault chrome grammar (which uses the `SectionLabel`-style muted uppercase label with a hairline divider).
2. **Hub notes show the title twice.** Obsidian's native "Show inline title" appearance setting renders the filename-derived title above the note body. Both hub templates (`Journal Hub.md`, `Sticky Hub.md`) additionally include a literal `# Journal` / `# Sticky Notes` H1 in the body, producing a redundant second heading. Every other adopted blueprint hub omits this H1; sticky/journal are outliers.
3. **Hub view defaults to "Days" tab.** Both hubs open on the day-grouped view. The user wants the flat "All" list as the default.
4. **Leaf notes lack useful direct actions.** Sticky and journal leaves currently only support click-to-rename via the title banner. The user wants a real ⋯ menu with:
   - Change title (rename via the existing dialog)
   - Delete note (with confirm; redirect to the hub)
   - Add link (sticky only — parity with wiki/project docs' `SectionExplorer.renderNoteLinks` pattern)
   - Move to another day (sticky only — day-based folder move + frontmatter.day update)

Existing consumer vaults must be migrated so old notes look the same as new ones.

## Non-Goals

- No cross-blueprint mechanism extraction (banner/rename/delete are inlined per bar — YAGNI at two consumers).
- No breadcrumb changes for `journal-hub` / `sticky-hub`. Per `Docs/agent-guides/note-chrome.md` §3, top-level hubs render no trail by design.
- No changes to the sticky-note folder structure or filename convention. The move-day action moves the file across day folders but preserves the filename (which encodes the original creation instant, not the assigned day).
- Journal does not get an "Add link" or "Move day" action (explicit user requirement).
- No promotion of `journal-hub` / `sticky-hub` to the note-chrome heal scope list.

## Architecture

### Leaf-note anatomy after the change

```
┌─────────────────────────────────────────┐
│ [⌂] [Go ▾] [primary] [⋯]                │  ← chrome bar (existing)
├─────────────────────────────────────────┤
│ NOTE TITLE FROM FRONTMATTER             │  ← new SectionLabel-style banner
│ ─────────────────────────────────────── │  ← hairline BELOW the label
│ [🔗 pinned-link-1] [🔗 link-2] [＋ Add]  │  ← se-note-links (sticky only)
│                                         │
│ Note body content...                    │  ← body
```

Journal is identical minus the `.se-note-links` row.

### Component boundaries

- `StickyChromeBar` — restyles the existing title banner (§S1), calls `SectionExplorer.renderNoteLinks(dv)` (§S2), extends overflow menu with `rename` / `add-link` / `move-day` / `delete` (§S3), grows two new dialogs `_openMoveDayDialog` + `_openDeleteDialog` (§S4).
- `JournalChromeBar` — gains a title banner mirroring StickyChromeBar's (§J1), extends overflow menu with `rename` / `delete` (§J2), grows `_openRenameDialog` + `_openDeleteDialog` (§J3).
- `StickyHubCards` / `JournalHubCards` — one-line default-mode flip (§H1).
- `Sticky Hub.md` / `Journal Hub.md` templates — remove literal `# H1` line (§H2).
- `platform/install.js` — add `applyStickyHubTitleHeal` + `applyJournalHubTitleHeal` install steps (§M1).

## Detailed Design

### §S1 — Sticky title banner restyle

`StickyChromeBar._headingStyle(hasTitle)` is deleted. `_renderTitleBanner(container, page, file)` is rewritten:

- Text resolution:
  1. If `page.title` is a non-empty string after `.trim()`, use it.
  2. Else use `page.file.name` (filename stem — Obsidian's `.file.name` already strips `.md`).
  3. Else use placeholder text `"Untitled — click to name"` (italic).
- Label element style (matches `SectionLabel.render()`):
  ```
  font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted); font-weight: 600; margin: 4px 0 6px 0;
  cursor: pointer;
  ```
  Placeholder variant drops uppercase + letter-spacing, adds `font-style: italic`.
- Hairline BELOW the label (matches `SectionLabel.divider` idea, tuned tighter for leaf chrome):
  ```
  border: none; border-top: 1px solid var(--background-modifier-border-hover);
  margin: 0 0 12px 0;
  ```
- Click handler: existing `_openRenameDialog` (unchanged behavior).

Dedupe rule preserved: `container.querySelectorAll(".sticky-title-banner").forEach(e => e.remove())` before creating.

### §S2 — Pinned-links row (sticky only)

At the tail of `StickyChromeBar.render`, after `_maybeRenderBanner(dv)`, add:

```js
if (customJS && customJS.SectionExplorer && typeof customJS.SectionExplorer.renderNoteLinks === "function") {
  try { customJS.SectionExplorer.renderNoteLinks(dv); } catch (_e) { /* never-throw */ }
}
```

This produces the identical `.se-note-links` strip (link cards + `＋ Add link` pill) rendered on wiki/project doc-notes. Reads/writes `frontmatter.links[]` via `SectionExplorer._noteSelfAdapter`. Reuses the existing add-link modal.

Only invoked on `sticky-note` context (guarded by the same detect that gates `_maybeRenderBanner` — banner already skips hub/day contexts).

Dependency: `sticky-notes` manifest gains `{name: "section-explorer", range: ">=X.Y.Z"}` (current workshop version).

### §S3 — Sticky ⋯ menu

Extend `_config().surfaceSpec` for `sticky-note`:

```js
overflow: [
  { id: "rename",   label: "Change title…",         icon: ICON.pencilPlus },
  { id: "add-link", label: "Add link…",             icon: ICON.link },
  { id: "move-day", label: "Move to another day…",  icon: ICON.today },
  { id: "delete",   label: "Delete sticky note…",   icon: ICON.trash, destructive: true },
]
```

(Existing `back-day` + `hub` entries stay if `ChromeBar` allows both `overflow` and navigation entries — otherwise they migrate into `destinations`.)

Add three new `ICON` entries: `link`, `trash`, and reuse `pencilPlus` for rename.

Dispatch handlers in `_config().dispatch`:

- `rename` → resolve `file` from ctx.path, call `this._openRenameDialog(file, currentTitle, onDone)`. `onDone` is a no-op (the banner re-renders on the next dv view invalidation).
- `add-link` → resolve `page` via `RenderSafe.page(dv)`, call `customJS.SectionExplorer._openAddLinkForm(dv, customJS.SectionExplorer._noteSelfAdapter(page), null)`. This is the same call chain the `＋ Add link` pill uses inside `renderNoteLinks`. If SectionExplorer isn't loaded, `Notice` + no-op.
- `move-day` → `this._openMoveDayDialog(dv, ctx)` (see §S4).
- `delete` → `this._openDeleteDialog(file, "spice/sticky-notes/Sticky.md", "sticky note")` (see §S4).

### §S4 — New dialogs (sticky)

**`_openMoveDayDialog(dv, ctx)`** — inline modal parity with `_openRenameDialog`:

- Body: label "Move to day", `<input type="date" value={currentDay}>`, Cancel + Save.
- On Save:
  1. Validate `newDay` matches `YYYY-MM-DD`; if invalid, keep dialog open, Notice.
  2. If `newDay === currentDay`, close dialog, no-op.
  3. Compute `newFolder = "spice/sticky-notes/" + moment(newDay).format("YYYY/MM-MMMM") + "/" + newDay`.
  4. Ensure `newFolder` exists (`app.vault.createFolder`, tolerating "already exists").
  5. Ensure the destination day-hub exists (`Sticky-Day-{newDay}.md`). If missing, invoke the same templater path used by `_openToday` (folder-first + `create_new_note_from_template("ranch/templates/Sticky Day Hub.md")`). Best-effort; if templater is unavailable, Notice + continue (the sticky note still gets moved).
  6. `await app.fileManager.processFrontMatter(file, fm => { fm.day = newDay; })`.
  7. `await app.fileManager.renameFile(file, newFolder + "/" + file.name)` — filename unchanged.
  8. `app.workspace.openLinkText(newFolder + "/" + file.name, "")` so Obsidian re-renders under the new path.
- Never-throw; each step tolerates partial failure with a Notice.

**`_openDeleteDialog(file, hubPath, entityLabel)`** — inline confirm modal:

- Body: heading "Delete this {entityLabel}?", subtitle "This cannot be undone.", Cancel + destructive "Delete" button (`background: var(--interactive-accent)` swapped for a red-tinted `background: var(--color-red)` fallback: `var(--interactive-normal)`).
- On confirm:
  1. `await app.vault.delete(file)`.
  2. `app.workspace.openLinkText(hubPath, "")`.
- Never-throw.

### §J1 — Journal title banner

`JournalChromeBar` gains a `_maybeRenderBanner(dv)` + `_renderTitleBanner(container, page, file)` mirroring §S1. Same fallback logic, same styles, same rename dialog wiring. Detect gate: only on `journal-entry` context.

### §J2 — Journal ⋯ menu

Extend `_config().surfaceSpec` for `journal-entry` context:

```js
overflow: [
  { id: "rename", label: "Change title…", icon: ICON.pencilPlus },
  { id: "delete", label: "Delete journal entry…", icon: ICON.trash, destructive: true },
]
```

(Plus existing `back-day` + `hub` if present.)

### §J3 — Journal dialogs

Port `_openRenameDialog` from StickyChromeBar (byte-parity — this is the acknowledged inline duplication YAGNI). Add `_openDeleteDialog(file, "spice/journal/Journal.md", "journal entry")` mirroring §S4's delete variant.

### §H1 — Hub default toggle

`sticky-hub-cards.js` line 47:
```diff
- return container && container.__stickyHubMode === "all" ? "all" : "days";
+ return container && container.__stickyHubMode === "days" ? "days" : "all";
```

Same one-line change in `journal-hub-cards.js` for `__journalHubMode`.

### §H2 — Hub H1 removal (templates)

`platform/blueprints/journal/templates/Journal Hub.md`:
```diff
  ---
  type: journal-hub
  ---
-
- # Journal

  ```dataviewjs
  await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```

Same shape for `platform/blueprints/sticky-notes/templates/Sticky Hub.md` (remove `# Sticky Notes` + its surrounding blank lines).

Final template shape: frontmatter block → single blank line → two dataviewjs blocks.

### §M1 — Install heals for existing hubs

`platform/install.js` gains `applyStickyHubTitleHeal(vaultRoot)` and `applyJournalHubTitleHeal(vaultRoot)`, dispatched from the top-level install flow parallel to existing hub heals (e.g. `applyMeetingsHubChromeBarHeal` from memory).

Behavior:

- Locate `spice/sticky-notes/Sticky.md` / `spice/journal/Journal.md`.
- Frontmatter guard: only proceed if `type: sticky-hub` / `type: journal-hub`.
- Line-level heal: remove any line matching `/^# (Sticky Notes|Journal)\s*$/` and any adjacent blank line collapsing that leaves `\n\n\n` runs down to `\n\n`.
- Idempotent: if no H1 line matches, no-op.
- Backup: write `.sauce-backup` next to the file with the pre-heal contents.
- Never-throw; log via existing install-log helper.

Runs on every `sauce update` — so a consumer that installed pre-v0.11.0 gets healed on their next update.

### §V — Version bumps

- `sticky-notes/manifest.json` → `0.11.0`; add `section-explorer` dep.
- `journal/manifest.json` → `0.5.0`.
- Umbrella workshop version bumped by the release pipeline.

Component-level bumps are per-component semantic — Minor because new user-visible features are added and no existing behavior is broken.

## Data Flow

Move-day walk (sticky):

```
user clicks "Move to another day…" ─► _openMoveDayDialog(dv, ctx)
                                        │
                                        ├─ prompt for newDay
                                        ├─ compute newFolder
                                        ├─ createFolder(newFolder)  [tolerate exists]
                                        ├─ ensure Sticky-Day-{newDay}.md  [templater]
                                        ├─ processFrontMatter(file, fm.day = newDay)
                                        ├─ renameFile(file, newFolder + file.name)
                                        └─ openLinkText(new path)
```

Delete walk (both):

```
user clicks "Delete …" ─► _openDeleteDialog(file, hubPath, entityLabel)
                            │
                            ├─ confirm modal
                            ├─ vault.delete(file)
                            └─ openLinkText(hubPath)
```

## Error Handling

- All new dialogs use `try/catch` around the outer body so a mid-op failure never throws into the DataviewJS renderer.
- `Notice` (Obsidian toast) surfaces user-facing failure with a specific message per step ("Move failed — folder create denied", etc.).
- `renderNoteLinks` invocation is guarded — if SectionExplorer is missing, the pinned-links row is silently absent.
- Heals are `.sauce-backup`-first + idempotent — safe to re-run on already-migrated hubs.

## Testing

- **Bar rendering tests** — extend the existing StickyChromeBar / JournalChromeBar behavioral harnesses with DOM-stub assertions:
  - Banner text: frontmatter.title vs. filename fallback vs. placeholder.
  - Banner style attributes present.
  - Hairline is BELOW the label (child order assertion).
  - Overflow menu includes the new IDs in the expected order.
- **Dispatch tests** — mock `app.fileManager` / `app.vault` and assert:
  - Rename → dialog opens, Save writes `fm.title`.
  - Add-link → invokes `SectionExplorer._openAddLinkForm` with a self-adapter.
  - Move-day → walks the six-step sequence, tolerating "folder exists".
  - Delete → confirmation gate, then `vault.delete` + `openLinkText(hubPath)`.
- **Hub cards tests** — assert `_mode(container)` returns `"all"` when the flag is unset.
- **Heal tests** — feed a live-shape hub with the literal H1 line, assert:
  - `.sauce-backup` written.
  - Output has no `^# (Sticky Notes|Journal)$` line.
  - Idempotent re-run leaves the healed file unchanged.

Seed-vault regression net: extend `platform/test/seed-vault/` fixtures with a legacy-shape journal hub + sticky hub so the heal fires in the seed run.

## Release + Deploy

Standard workshop release:

1. Merge feature PR to `main`.
2. Release pipeline computes per-component bumps + umbrella version, opens release PR, auto-merges on CI green, tags, ships to brew tap.
3. Tap PR auto-merges.
4. `brew update && brew upgrade sauce` on the deploy host.
5. `sauce update --bump-pins` in each of the three consumer vaults (accuris, headspace, ero).
6. Verify banner + ⋯ menu + heals via live vault inspection.
