# 2026-05-20 — Scratch day-hub button row + Daily Dashboard board activity

Two scoped fixes to the Sauce workshop.

## Goals

1. **Same-row scratch buttons.** On a scratch day-hub note, render `+ New Scratch` and `Hub` as two equally-styled accent buttons in one centered, evenly-spaced flex row (visually consistent with the nav-button row above).
2. **Board activity in Daily Dashboard.** Surface `spice/boards/To-Do-Board.md` activity (kanban hub edits + new board-card creations) as one rolled-up activity card per day in the dashboard's Activity panel.

## Non-goals

- No granular "card moved to Done" / "card moved between columns" events. The kanban plugin writes column state to one file with no per-event timestamps; detecting moves vs creations vs marks-done requires snapshotting prior kanban state, which is out of scope.
- No new abstraction over entity-create for shared button rows. Scoped to scratch only; other blueprints' entity-create rendering stays unchanged.

---

## Part 1 — Scratch day-hub button row

### Current state

`ranch/templates/Scratch Day Hub.md` contains two adjacent `dataviewjs` blocks:

```
```dataviewjs
// entity-create:scratch — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "scratch" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ScratchDayActions" });
```
```

- `entity-create:scratch` (block 1) is installer-materialized from `platform/blueprints/scratch/manifest.json` → `new_entity_buttons[].render_in: { kind: "hub", target_path: "{{templates_path}}/Scratch Day Hub.md" }`. It renders the `+ New Scratch` button directly into `dv.container` via `customJS.AccentButton.render(dv.container, {...})` — no flex row, default `inline-flex`.
- `ScratchDayActions` (block 2) is a hand-authored helper at `ranch/scripts/scratch/scratch-day-actions.js`. It builds a centered flex row with `max-width: 600px; gap: 12px; justify-content: center; align-items: stretch; flex-wrap: wrap;` and renders the `Hub` button into that row with `flex: true` (which appends `flex: 1; min-width: 0`).

Result: the two buttons stack vertically in separate `<div class="block-language-dataviewjs">` siblings, with mismatched widths (compact `+ New Scratch` vs. full-width `Hub`).

### Target state

Both buttons render into the SAME flex row, with `flex: true`, in order: `+ New Scratch` → `Hub`. Both stretch equally; the row stays centered with `max-width: 600px`.

### Changes

1. **`ranch/scripts/scratch/scratch-day-actions.js`** — extend `ScratchDayActions.render(dv)` to render two `AccentButton`s into the existing `row` div. Day-coercion + stale-render guards stay as-is.

   ```javascript
   // Inside render(dv), after the existing row creation and stale guards:
   const pencilPlusIcon = `<svg ...>`; // copy from entity-create / legacy scratch-new-button glyph

   const createScratch = () => customJS.EntityCreate.create({ instance: "scratch", dv });
   const goToHub = () => app.workspace.openLinkText("spice/scratch/Scratch.md", "");

   customJS.AccentButton.render(row, { label: "+ New Scratch", icon: pencilPlusIcon, onClick: createScratch, flex: true });
   customJS.AccentButton.render(row, { label: "Hub", icon: homeIcon, onClick: goToHub, flex: true });
   ```

   - `createScratch` delegates to the same `EntityCreate.create()` dispatch path entity-create uses today. Registry-driven prompts, frontmatter template, destination routing, and `_canonical-vocab` rule fragments are unchanged.
   - The pencil-plus icon SVG is identical to the one in `entity-create.js` (via `customJS.Icons.resolve("pencil-plus")`). Either inline the SVG or call `customJS.Icons.resolve("pencil-plus")` and fall back to the plus glyph. Plan step picks the lighter option.

2. **`ranch/templates/Scratch Day Hub.md`** (and the matching template source under `platform/blueprints/scratch/templates/Scratch Day Hub.md`) — drop the `entity-create:scratch` dataviewjs block, leaving only the `ScratchDayActions` invocation between the `---` rulers:

   ```
   ---

   ```dataviewjs
   await dv.view("ranch/views/customjs-guard", { class: "ScratchDayActions" });
   ```

   ---
   ```

3. **`platform/blueprints/scratch/manifest.json`** — in `new_entity_buttons[]`, remove the `render_in` field from the `scratch` entry (or set to `null`). The registry materialization (which writes the spec to `ranch/entity-create-registry.json`) stays intact; only the dataviewjs block injection into the template is suppressed.

   **Plan-time verification required.** Confirm the installer's `new_entity_buttons` materializer treats `render_in: null` / absent `render_in` as "registry-only, no template injection". If it doesn't, the fallback is to keep `render_in` present but extend the materializer to skip injection when the target template file in `files[]` has no `entity-create:<id>` marker comment (idempotent re-runs over a clean template should be no-ops).

4. **Manifest bookkeeping.**
   - Bump `platform/blueprints/scratch/manifest.json` version per the workshop's semver convention (likely `0.5.0` MINOR — a behavior-changing template revision).
   - Append to the `description` field a short v0.5.0 changelog entry summarizing the row consolidation.
   - `customjs_classes`, `depends_on`, `files`, `rule_fragments`, `templater_folder_templates`, `nav_buttons` stay unchanged.

### Risks

- Installer regenerating the dropped entity-create block on next `/install`. Mitigated by step 3 verification.
- `ScratchDayActions` now depends on `customJS.EntityCreate` being loaded at click time. Both classes are loaded via `customjs-guard`, which serializes class load, so this is safe at runtime. If `EntityCreate` is somehow missing, the click fails silently — plan step adds a defensive null-check + `new Notice(...)` mirroring entity-create's own missing-Templater notice.
- No regression risk to other blueprints (meetings, projects, finance, people) — they keep their own dataviewjs entity-create blocks. Scratch is the only blueprint with a wrapping helper that owns its surrounding row.

---

## Part 2 — Board activity in the Daily Dashboard Activity panel

### Current state

`ranch/scripts/daily/space-daily-dashboard.js` powers the dashboard rendered on the daily note via:

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard" });
```

The Activity panel filters all vault pages by their `type:` frontmatter against the `_DEFAULT_DASHBOARD_BLUEPRINTS` getter, then applies rollup rules (`_ROLLUP_RULES`) to coalesce descendants into parent hub cards. Two existing rules: `project` (rolls up `spice/projects/<slug>/**` into the project hub) and `trip` (rolls up `spice/trips/<slug>/**` into the trip hub).

Boards blueprint produces two relevant types but neither is in the allowlist:
- `type: kanban` — single hub note at `spice/boards/To-Do-Board.md` (materialized by `platform/blueprints/boards/content/To-Do-Board.md`). `mtime` updates on every kanban-plugin save (column rearrange, card mark-complete, card add).
- `type: board-card` — per-card notes spawned under `spice/boards/cards/YYYY/MM-MMMM/<title>.md` via Templater (template at `platform/blueprints/boards/templates/Template, Board Card.md`). Each card file has `created_at` populated at spawn time.

### Target state

Activity panel shows ONE rolled-up "To Do Board" card any day the kanban hub was edited or new cards were created. Card title comes from the hub's `title:` frontmatter ("To Do Board"). Type pill shows `kanban` with a distinct color. Meta line shows hub mtime + "N notes touched" breadcrumb; clicking the breadcrumb reveals a drill-in list of today's card files (existing `_renderDrillInList` behavior, no new code).

### Changes (all in `ranch/scripts/daily/space-daily-dashboard.js`)

1. **`_DEFAULT_DASHBOARD_BLUEPRINTS`** — append `"kanban"` and `"board-card"` to the allowlist array.

2. **`_BLUEPRINT_COLORS`** — append `kanban: "var(--color-pink)"` (or a free distinct theme variable; plan step inventories which `--color-*` vars are unused by current entries and picks one).

3. **`_ROLLUP_RULES`** — append a third rule, hardcoded to the single-board root path:

   ```javascript
   {
     type: "kanban",
     childMatchTemplate: (path) => /^spice\/boards\/cards\//.test(path),
     rootPathFromDv: (_dv, _p) => "spice/boards/To-Do-Board.md",
     excludeTemplate: (name) => typeof name === "string" && /^Template,/i.test(name),
   },
   ```

   - `rootPathFromDv` is constant (single board), unlike project/trip rules which derive the slug from the child path.
   - The `Template, Board Card.md` lives at `ranch/templates/`, not under `spice/boards/cards/`, so `excludeTemplate` is defensive (belt-and-suspenders) but harmless.

4. **`_resolveTitle`** — no change. The kanban hub's `title: To Do Board` frontmatter is already picked up by the existing `p.title` branch.

5. **`_renderActivityMeta`** — no change. The rolled-up card receives `_isRollUp: true` + `_rollUpChildren: N` + `_rollUpChildrenPages: [...]` from ActivityFeed's coalescing pass, which already drives the breadcrumb + drill-in. The drill-in list rows link to individual card files via `app.workspace.openLinkText`.

6. **Version bump.** Update the `@version` comment header at the top of `space-daily-dashboard.js` with a new vN.M.0 stanza summarizing the board-activity surface. Consistency with the file's existing changelog discipline.

### Edge cases (all handled by existing dedup logic in `_getActivityCount`)

- Hub edited but no new cards today → hub matches allowlist via `kanban` + `includeMtime: true` → direct hit; no rollup descendants → one direct-hit card survives. ✓
- New cards created but hub mtime is outside the day → cards match rollup `childMatch`; hub added to `rolledUpRoots` via the children's in-window `created_at`. Direct hit set is empty for kanban. One synthetic rollup card. ✓
- Both → hub appears in direct hits AND in `rolledUpRoots`; survivors filter drops it from direct hits (via `rolledRootPaths.has(p.file.path)`); rollup adds it back once. One card. ✓
- Pre-existing `board-card` notes (created prior day, edited today via `includeMtime`) → they're in window, rollup matches them → hub goes into `rolledUpRoots`. ✓

### Risks

- **Color clash.** If the picked `--color-*` variable matches an existing entry (e.g., team=pink), the segmented Activity accent stripe could read ambiguously. Plan step audits the palette before picking.
- **Rollup over-coalescing.** The board-card path glob (`/^spice\/boards\/cards\//`) is narrow and bounded by the boards blueprint's known materialization path; no risk of catching non-board files.
- **Drill-in row labels.** Existing `_renderDrillInList` computes the rel path by stripping the root file's dirname. For boards, root is `spice/boards/To-Do-Board.md` → rootDir becomes `spice/boards/`. Card files at `spice/boards/cards/YYYY/MM-MMMM/<title>.md` render as `cards/YYYY/MM-MMMM/<title>`. Readable; matches the convention used for project/trip drill-ins.
- No regression to projects, trips, scratch, journal, finance, cowork, or meeting activity surfaces. Three rules in `_ROLLUP_RULES` are evaluated by the existing per-page loop in `_buildRollupRules` / `_getActivityCount`; order doesn't matter for board-card paths (mutually exclusive with project/trip globs).

---

## Implementation order

1. Part 1 changes (scratch day-hub button row) — touches `scratch-day-actions.js`, `Scratch Day Hub.md` template (both `ranch/templates/` and `platform/blueprints/scratch/templates/`), `scratch/manifest.json`.
2. Verify installer behavior for `new_entity_buttons[].render_in` removal. If installer regenerates the deleted block, patch the materializer.
3. Part 2 changes (board activity) — touches `space-daily-dashboard.js` only.
4. Bump `space-daily-dashboard.js` header changelog. Bump `scratch` manifest version + description.
5. Smoke: open a scratch day-hub, verify two-button row. Open today's daily note after adding a board card or touching the kanban hub, verify the rolled-up "To Do Board" Activity card appears with a drill-in.
6. Cycle-close artifacts per `Docs/agent-guides/build-test-verify.md`.

## Test plan

- **Scratch button row visual.** Open `spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Scratch-Day-<YYYY-MM-DD>.md`. Confirm one centered row with `+ New Scratch` (left) and `Hub` (right), both stretched, gap-separated. Click each; verify `+ New Scratch` opens the title prompt and creates a `Scratch-<date>-HH-mm.md`, and `Hub` opens `spice/scratch/Scratch.md`.
- **Installer idempotence.** Run `/install` after the manifest change. Confirm the `entity-create:scratch` dataviewjs block does NOT reappear in the template, and `ranch/entity-create-registry.json` still contains the `scratch` instance spec.
- **Board activity surface.** Add a kanban card to `spice/boards/To-Do-Board.md`; let Templater spawn the card file. Open today's daily note. Confirm Activity panel shows a "To Do Board" card with type pill = `kanban`, breadcrumb shows "1 note touched", drill-in expands to the new card file row.
- **Board hub-only edit.** Move an existing card between columns in the kanban without creating new cards. Confirm Activity panel surfaces one "To Do Board" card (hub direct-hit path).
- **No regression.** Open a daily note on a day with project/trip/scratch/journal activity. Confirm those rollups still render correctly and the board card sits alongside them without disturbing ordering.

## Out of scope (future work)

- Per-event semantics (created vs moved vs done) inside a single board.
- Multi-board support (extending `rootPathFromDv` to handle additional boards if/when a second kanban hub is added under `spice/boards/`).
- Direct linking from the rolled-up "To Do Board" card to a specific column in the kanban.
