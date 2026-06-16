---
purpose: Design for v0.116.0 — to-do blueprint MINOR expansion. Promotes the current barebones daily-note workspace (v0.3.3) into a routed five-section daily-note with auto-carryover, recurrence materialization, per-project To-Do notes, and live aggregation of project + meeting tasks. Builds a thin sauce layer on top of obsidian-tasks-plugin (already foundational + dataview-format via convenience@0.4.1); no new third-party dependency.
load_when: Implementing v0.116.0, or any later cycle that touches the to-do blueprint, the project blueprint's project-todo extra_files entry, the recurrence parser, ToDoCreateTask dialog, or the daily-note section renderers.
status: brainstorm-complete (2026-06-15 evening, immediately after v0.115.0 finance B ship); awaiting implementation-plan execution.
cycle: v0.116.0
predecessor: v0.115.4 (workshop) + PR #2 merged (`f591008` migration regression net foundation, 2026-06-15 evening). Reverify HEAD + preflight green + workshop_version pin at execution start. Predecessor lineage: v0.115.0 finance B → v0.115.1 / v0.115.2 / v0.115.3 / v0.115.4 PATCHes → PR #2 merge.
informs: v0.116.x dialog/recurrence polish; v0.117.0 (carry-forwards — Tasks-plugin checkbox-click delegation, drag-to-reorder, mobile dialog layout)
vision: integrated daily workspace where today's note is the single home for everything you've committed to do today — owned, recurring, project-routed, and meeting-borne — without losing single-source-of-truth in the originating file.
---

# v0.116.0 — to-do blueprint expansion (MINOR)

## Problem

The to-do blueprint v0.3.3 (shipped at workshop v0.63.3, dogfooded through v0.115.0) is the date-routed daily task workspace. Today's note (`spice/to-do/YYYY/MM-MMMM/ToDo-YYYY-MM-DD.md`) is two dataviewjs blocks and free-form Markdown — user types `- [ ]` lines under the blocks, optionally migrates unfinished tasks to tomorrow via the `Migrate` modal, and reviews the backlog in `All-ToDos.md`. The blueprint depends on `nav-buttons`, `customjs-guard`, `accent-button`. Five customjs classes (`ToDoLeafActions`, `ToDoHubActions`, `ToDoAllList`, `ToDoMigrateModal`, `ToDoMigrateInit`). No project or meeting integration.

**Gaps the user surfaced** (brainstorm input, 2026-06-15):

1. Clicking the To Do nav button creates a bare note. There is no automatic backlog routing — old open tasks accumulate in old daily notes and only become visible through the hub's passive aggregation.
2. There is no structured concept of "what should appear on today's note" — no Recurring section, no per-project section, no meeting section, no Carryover section.
3. There is no dialog for creating a task with metadata. The user types raw `- [ ]` lines or uses the Tasks plugin's `Cmd+Shift+T` edit-task modal (which only edits existing lines).
4. There is no per-project task workspace. Project hub bodies + docs can carry `- [ ]` lines, but nothing pulls them together; SpaceDailyDashboard surfaces them via the vault-wide tasks panel but does not group by project.
5. Recurring / scheduled / day-of-month tasks have no representation. Tasks plugin's `[recurrence:: …]` regenerates a task on completion, but does not "appear on every Wednesday's daily note" — that semantic does not exist anywhere in the platform.
6. Meeting bodies already carry `- [ ]` lines and meeting notes already extract an open-task count (`MeetingsHubCards`, `ProjectMeetingsPanel` ports of `SpaceDailyDashboard._enrichMeeting`). But those tasks never surface in the daily-note workspace — only as a count badge on a meeting card.

The substrate for solving this is already in place:

- **`obsidian-tasks-plugin` is a foundational plugin** in `platform/manifest.json:13-23`. The `convenience` mechanism sets `taskFormat=dataview` so the plugin emits + parses inline-field syntax (`[due:: 2026-06-22]`, `[recurrence:: every Wednesday]`, etc.) compatible with Dataview's `p.file.tasks` index.
- **`SpaceDailyDashboard` already vault-walks `p.file.tasks`** to surface open tasks under the dashboard's tasks panel. Aggregation pipes exist.
- **`MeetingsHubCards` already extracts open-task count** from meeting bodies (regex `/\- \[ \]/g`).
- **`ProjectMeetingsPanel` (project v1.21.0) ports the same `_enrichMeeting` helper** — meetings on the project hub already surface `N open` badges.
- **`platform/schemas-index.json` (v0.113.0)** is the canonical registry for frontmatter contracts.

What's missing is sectioning, the dialog, the recurrence engine, and the per-project + meeting routing. v0.116.0 ships exactly that.

## Approach

Workshop MINOR cycle bundling one to-do blueprint MINOR + one project blueprint MINOR + new helpers, new templates, two new installer steps, four new test harnesses. No third-party dependency added (obsidian-tasks-plugin is already foundational); no mechanism bumps required.

| Surface | Before | After | Bump kind |
| --- | --- | --- | --- |
| `to-do` blueprint | 0.3.3 | **0.4.0** | MINOR (new note types + helpers + dialog + carryover + recurrence) |
| `project` blueprint | 1.21.2 | **1.22.0** | MINOR (project-todo `extra_files`, `ProjectNavButtons` branch, `ProjectsHubCards` task-pill) |
| `platform/manifest.json` workshop_version | 0.115.4 | **0.116.0** | workshop MINOR |
| `package.json` version | 0.115.4 | **0.116.0** | lockstep |
| `ranch/platform-subscription.json` workshop_version | 0.115.4 | **0.116.0** | lockstep |
| New customjs classes | 5 (existing) | 3 existing kept + 6 NEW + 2 RETIRED = 9 registered | additive net |
| New note types | `to-do`, `to-do-hub` | + `project-todo`, + `to-do-recurring` | additive |
| New templates | `Today To-Do.md`, `All To-Dos.md` | + `Project To-Do.md`, + `Recurring Tasks.md` | additive |
| New installer steps | (existing project + finance steps) | + `applyToDoBlueprintMigration`, + `applyProjectTodoBackfill` | additive (project-blueprint-owned) |
| Schema registry entries | existing | + `project-todo`, + `to-do-recurring` | additive |
| Rule fragments | `to-do` scope | + `project-todo` scope, + `to-do-recurring` scope | additive |
| Retired classes | n/a | `ToDoMigrateModal`, `ToDoMigrateInit` deleted; `sauce:to-do-migrate` command unregistered; `applyOrphanedHelperCleanup` cleans `*.js` orphans | retirement via cross-cutting helper |

### Why workshop MINOR (not PATCH)

The to-do blueprint grows two new public note types + a new authoring dialog + a new recurrence registry. The project blueprint grows a new `extra_files[]` entry + a new ProjectNavButtons branch. Both are new public surfaces with consumer-vault impact; MINOR is correct per sauce convention.

### Why to-do MINOR (not PATCH)

New customjs classes (5 NEW), new templates (2 NEW), new note types (2 NEW), new schemas (2 NEW), new manifest fields (no), new rule fragments (2 NEW). The retirement of the Migrate-to-tomorrow modal is in-cycle (cleaner than carrying it forward as dead code). MINOR per the convention used in to-do v0.3.0 (v0.63.0 — All-ToDos + Migrate added).

### Why project MINOR (not PATCH)

`+ New Project` flow scaffolds a new file (`<Name> To-Do.md`); `ProjectNavButtons` grows a new context branch (a new public button per project); `ProjectsHubCards` grows a new card-meta pill. All visible to consumers. MINOR per the project v1.16.0 / v1.21.0 cadence.

### Why no third-party plugin added

The brainstorm considered Task Genius (Adriz1er/Obsidian-Task-Genius — quick-capture panel, status cycling, progress bars). Useful, but: (a) Tasks plugin already gives us 100% of the syntax we need; (b) Task Genius is desktop-only with no Obsidian mobile path; (c) the dialog UX is something we want sauce to own (matches the engagement-create / new-task surfaces already in the platform). Decision: stay tight to the foundational plugin set.

## Data model + storage

### Note types touched

| Type | Path | Status | Owns |
|---|---|---|---|
| `to-do` (daily) | `spice/to-do/<YYYY>/<MM-MMMM>/ToDo-YYYY-MM-DD.md` | existing v0.3.3 — body reshaped | Today's Capture + Carryover + materialized Recurring + live-aggregated Project / Meeting tasks |
| `to-do-hub` (All-ToDos) | `spice/to-do/All-ToDos.md` | existing — unchanged | Backlog view |
| `project-todo` (NEW) | `spice/projects/<slug>/<Project Name> To-Do.md` | new | Per-project "Owned Tasks" + live-aggregated "From Meetings" + live-aggregated "Recurring (this project)" |
| `to-do-recurring` (NEW) | `spice/to-do/Recurring Tasks.md` | new — 1 per vault | Recurring task templates + last-7-days materialization log |

### Task syntax — single source of truth

Every task line uses obsidian-tasks-plugin's dataview-format inline-field syntax (already enforced by `convenience` mechanism's `taskFormat=dataview`):

```
- [ ] Brief meeting-tasks rollup spec [priority:: high] [due:: 2026-06-22]
- [ ] Ship v0.116.0 [scheduled:: 2026-06-15]
- [ ] Take out trash [recurrence:: every Wednesday] [project:: [[Sauce]]] [priority:: medium]
```

**Sauce-defined extensions** to Tasks plugin's inline-field vocabulary:

| Field | Used by | Form | Notes |
|---|---|---|---|
| `[project:: [[Name]]]` | Daily aggregator + recurrence materializer | Wikilink to a `type: project` note | Optional. Routes a task to a project sub-section in the daily. |
| `[from:: [[ToDo-2026-06-14]]]` | Carryover writer | Wikilink to the source daily note | Provenance — written by carryover, never user-typed. |
| `[recurring_from:: [[Recurring Tasks]]]` | Recurrence materializer | Wikilink to the registry | Provenance — written when materializing, never user-typed. |

Tasks plugin ignores unknown inline fields; sauce helpers read them. No double-write contract: each field has exactly one writer.

### Frontmatter schemas (NEW types)

**`project-todo`:**

```yaml
type: project-todo
project: "[[Sauce]]"
project_slug: sauce
created_at: "2026-06-15T16:00:00-06:00"
tags:
  - "headspace"          # vault_identity_tag substituted at install
cssclasses:
  - wide
```

**`to-do-recurring`:**

```yaml
type: to-do-recurring
created_at: "2026-06-15T16:00:00-06:00"
tags:
  - "headspace"
cssclasses:
  - wide
```

Both adopt canonical-vocab (`created_at` ISO+TZ; no legacy `created:`); both schemas register in `platform/schemas-index.json`.

### Filename + slug conventions

- `project-todo` filename: `<Project Name> To-Do.md` (mirrors `HUB_NOTE_FILENAME_STYLE = "name"` used by project hub notes). Native Obsidian tab title reads "Sauce To-Do."
- `to-do-recurring` filename: `Recurring Tasks.md` (fixed, one per vault). Lives at `spice/to-do/Recurring Tasks.md`.
- All-ToDos.md is unchanged at `spice/to-do/All-ToDos.md`.

### Materialization contract

Recurring registry lines carry `[recurrence:: …]`; materialized daily-note copies do **not**. This prevents Tasks plugin from spawning a duplicate next-instance when the user checks off the materialized copy in their daily. Provenance is preserved on the copy via `[recurring_from:: [[Recurring Tasks]]]`.

## Daily-note rendering + carryover

### Body shape (v0.4.0)

Five dataviewjs blocks under the frontmatter. The user's free-form `- [ ]` capture lines live between `## Today's Capture` and the first dataviewjs block after Capture (the carryover block):

```markdown
[frontmatter]

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoLeafActions" });
```

## Today's Capture

(user-typed - [ ] lines go here)

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyRecurring" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyUnassignedMeetings" });
```
```

Empty sections render nothing (consistent with v0.106.0.1 empty-state policy across project blueprint).

### Section semantics

| Section | Helper | Source | Materialized vs. live |
|---|---|---|---|
| Today's Capture | (no helper — plain markdown) | User-typed | n/a — checkbox lines are stored in this daily |
| Carryover (from YYYY-MM-DD) | `ToDoDailyCarryover` | Yesterday's daily (most-recent prior within 7d window) | **Materialized once** on daily-note open (sentinel-gated). Source daily-note's matching lines are deleted. |
| Recurring Today | `ToDoDailyRecurring` | `spice/to-do/Recurring Tasks.md` | **Materialized once** on daily-note open. Source registry unchanged. |
| Open Project Tasks (per project) | `ToDoDailyProjectGroups` | Per-project To-Do notes (`Owned Tasks` section) + meetings filtered by `project:` | **Live render** — rendered as `☐ <text> <small>(from File.md)</small>` link rows. Clicking the row navigates to source via `openLinkText`. Live-rendered rows are NOT toggleable in v0.4.0 (user checks the box in the source file). See carry-forwards. |
| Meeting Tasks (unassigned) | `ToDoDailyUnassignedMeetings` | Meeting notes with no `project:` frontmatter | **Live render** — same row shape + navigation semantics. |

### Carryover algorithm (`ToDoDailyCarryover`)

Auto-fires on render when the sentinel `<!-- carryover-from-YYYY-MM-DD -->` is absent.

1. Compute previous daily filename via `moment(today).subtract(1, 'day')`. Walk back up to 7 days if absent. If none found within window, no-op + write a `<!-- carryover-from-(none) -->` sentinel.
2. Read prior file. Re-use `parseTasks()` (extracted as a static helper into a new `task-parser.js` from the v0.3.3 `todo-migrate-modal.js`) to extract unchecked top-level blocks (with indented children).
3. **Filter out** blocks whose top line carries `[project:: …]`. Those tasks are project-routed; aggregation will surface them via the project's section. Carryover-moving them would create double-rendering. They stay in the source.
4. Atomically: `vault.modify` prior file → strip the blocks. `vault.modify` today's daily → insert `## Carryover (from YYYY-MM-DD)` heading + migrated blocks **immediately AFTER the `ToDoDailyCarryover` dataviewjs block** (i.e. between that block and the `ToDoDailyRecurring` block). Prefix each migrated top-line with `[from:: [[ToDo-YYYY-MM-DD]]]` for provenance. The heading + lines are persisted text in the daily file (not a live render).
5. Write `<!-- carryover-from-YYYY-MM-DD -->` sentinel into today's daily. Idempotent — re-firing is a no-op.

### Retirement of Migrate-to-tomorrow modal

The v0.3.x `ToDoMigrateModal` + `ToDoMigrateInit` are deleted. The `sauce:to-do-migrate` palette command unregisters on v0.116.0 install. The "move this task to a specific future day" use case is now served by `[scheduled:: YYYY-MM-DD]` on the task line (Tasks plugin already surfaces scheduled tasks on their target day; sauce daily-note rendering surfaces them under the appropriate project section or unassigned-meeting section per the task's other metadata).

`platform/test/run-todo-modal.js` is renamed `run-task-parser.js` (covers the extracted parseTasks helper) + cases TM-3 / TM-4 / TM-5 (the tomorrow-target migration cases) are dropped.

## Recurrence engine

### Registry storage

`spice/to-do/Recurring Tasks.md` body is a plain `- [ ]` list under `## Recurring Tasks`. Each line uses Tasks-plugin recurrence grammar + optional sauce-defined `[project::]`:

```markdown
## Recurring Tasks

- [ ] Take out trash [recurrence:: every Wednesday] [priority:: medium]
- [ ] Weekly review [recurrence:: every Sunday]
- [ ] Pay rent [recurrence:: every 1st of month] [priority:: highest]
- [ ] Standup [recurrence:: every weekday] [project:: [[Headspace]]]
- [ ] Weekly sauce status post [recurrence:: every Friday] [project:: [[Sauce]]]

## Last 7 days of materialization

| Date | Title | Routed to |
| --- | --- | --- |
| 2026-06-15 | Standup | ToDo-2026-06-15.md (Headspace) |
| 2026-06-14 | (none — Pay rent not 1st) | — |
| 2026-06-12 | Weekly sauce status post | ToDo-2026-06-12.md (Sauce) |
```

Registry lines are templates — never directly checked off. Both the dialog and the materializer enforce this: the dialog writes only into the `## Recurring Tasks` section; the materializer never modifies the registry's checkbox state. A documentation help-line in the registry body explicitly warns the user.

### Supported recurrence grammar (v0.4.0 subset)

| Frequency | Grammar | Materializes on |
|---|---|---|
| Daily | `every day` | every day |
| Weekday-set | `every Monday`, `every Mon Wed Fri`, `every weekday`, `every weekend` | matching weekday(s) |
| Monthly day-of | `every 1st of month`, `every 15th of month` | matching day-of-month |
| Every-N-weeks-on-day | `every 2 weeks on Monday` | matching weekday, when `(today - registry_created_at) % (N × 7) == 0` |

Anything else (custom cron, `every other day`, holiday rules) is **out of scope for v0.4.0**; the dialog's Recurring tab hides those options; the parser rejects + warns.

### Materialization algorithm (`ToDoDailyRecurring`)

Fires on render when sentinel `<!-- recurring-materialized-YYYY-MM-DD -->` is absent.

1. Read `spice/to-do/Recurring Tasks.md`. If file absent, no-op + sentinel. Parse each `- [ ]` line in the `## Recurring Tasks` section into `{title, recurrence, project?, priority?}`.
2. For each entry, evaluate the recurrence predicate against today's date (filename-derived, not wallclock — back-dated daily creations behave correctly).
3. For matching entries:
   - Strip `[recurrence:: …]` from the line. **(Critical — prevents Tasks plugin from spawning a duplicate next-instance when the user checks the materialized copy.)**
   - Append `[recurring_from:: [[Recurring Tasks]]]` for provenance.
   - Route:
     - `[project::]` set → insert into matching project's sub-section under "Open Project Tasks" (the `ToDoDailyProjectGroups` helper's anchor — a marker comment `<!-- project-group-anchor-<slug> -->` inside the project sub-section).
     - Else → insert into "Recurring Today" section.
4. Write a row to the `## Last 7 days of materialization` table in the registry (oldest rows drop when length > 50).
5. Write `<!-- recurring-materialized-YYYY-MM-DD -->` sentinel. Re-firing is a no-op.

### Recurrence parser (`RecurrenceParser`)

Pure Node-testable helper exported as `RecurrenceParser.matches(grammar: string, dateMoment) → bool`. Lives at `platform/blueprints/to-do/helpers/recurrence-parser.js`. Fixture covers all 4 supported families + invalid rejections.

### Race + concurrent-edit safety

Materializer reads + writes today's daily atomically (one `vault.read` + one `vault.modify` pair). If the sentinel arrives mid-flight (re-render fires twice in a tab refresh storm), the second writer detects the sentinel and no-ops. Render-gen counter (existing `__toDoRenderGen` pattern from `ToDoAllList`) guards against stale-render DOM writes.

## New Task dialog (`ToDoCreateTask`)

### Invocation surfaces

- **Inline action-bar** on `type: to-do` daily notes + `type: project-todo` notes. Three AccentButtons: `+ New Task`, `+ Recurring`, `All To-Dos`. Action-bar is rendered by the (extended) `ToDoLeafActions` helper.
- **Palette commands** (registered by `ToDoCreateTaskInit` startup script):
  - `Sauce: New task` — opens dialog, One-shot tab + Today's daily destination preselected.
  - `Sauce: New recurring task` — opens dialog, Recurring tab preselected.

### Context-aware defaults

When invoked from the inline action-bar:
- On a daily note → One-shot tab, Destination = Today's daily.
- On `<Sauce> To-Do.md` (a `project-todo` note) → One-shot tab, Destination = Project, Project preselected from the note's `project_slug` frontmatter.
- On `Recurring Tasks.md` → Recurring tab preselected.

### Form architecture (tabbed — locked from brainstorm)

```
+----------------------------------+
| + New Task                       |
+----------------------------------+
| [One-shot task] [Recurring task] |  ← tabs
+----------------------------------+
| Title:        [_________]        |
| Destination:  [Today's daily ▼]  |  (one-shot only)
|               [Sauce ▼]          |  (when Destination = Project)
| Frequency:    [Weekly ▼]         |  (recurring only)
| On:           [Sunday ▼]         |  (recurring only)
| Project:      [(none) ▼]         |  (recurring only — optional)
| Priority:     [N][L][M][H][↑↑]   |
| Due:          [____________]     |  (one-shot only, optional)
| Scheduled:    [____________]     |  (one-shot only, optional)
+----------------------------------+
|              [Cancel] [Create]   |
+----------------------------------+
```

### Field validation

- **Title** — required, trimmed, non-empty.
- **Destination** — required on One-shot.
- **Frequency + On** — required on Recurring; pair must produce a parseable recurrence string (`RecurrenceParser.matches` test-evaluates against today + tomorrow to verify the grammar is well-formed before submit).
- **Due / Scheduled** — optional; ISO date format from `<input type="date">`.
- **Priority** — defaults "none"; no Tasks-plugin field written when "none."

Submit button disabled until valid.

### Write paths (`ToDoCreateTask.submit(payload)`)

| Destination | File | Insert under | Line emitted |
|---|---|---|---|
| Today's daily (One-shot) | Today's `ToDo-YYYY-MM-DD.md` (creates via Templater if missing — reuses nav-button path) | `## Today's Capture` (after last existing line) | `- [ ] <title> [priority:: …] [due:: …] [scheduled:: …]` |
| Project X (One-shot) | `spice/projects/<x_slug>/<X> To-Do.md` (creates from template if missing) | `## Owned Tasks` (after last existing line) | `- [ ] <title> [project:: [[X]]] [priority:: …] [due:: …] [scheduled:: …]` |
| Recurring registry | `spice/to-do/Recurring Tasks.md` (creates from template if missing) | `## Recurring Tasks` | `- [ ] <title> [recurrence:: <grammar>] [project:: [[X]]] [priority:: …]` |

All write paths use `app.fileManager.processFrontMatter` only when creating; checkbox-line writes use `vault.read` + body splice + `vault.modify` (preserves frontmatter + other content).

### Keyboard

- `Tab` cycles fields (browser default).
- Title autofocused on open.
- `Enter` from title commits when valid; `Cmd+Enter` from anywhere commits.
- `Esc` dismisses.
- Priority chip row: left/right arrow + Space.

`Cmd+Enter` conflict check: vanilla Obsidian uses `Cmd+Enter` to follow a link in source-mode or to toggle a list item state. Inside a modal overlay, Obsidian's hotkey dispatch is suppressed (the overlay captures keydown). Safe to overload.

### Project-list source

Dialog runs at click time, so it queries Dataview directly (NOT entity-create's `options_source`, which is install-time-baked into button HTML). Inside `ToDoCreateTask._loadProjectList()`: `dv.pages('"spice/projects"').where(p => p.type === "project").map(p => ({ slug: p.project_slug ?? slugify(p.file.name), name: p.file.name, link: p.file.link })).array()`. Prepend a `(none)` sentinel. The conceptual contract matches meetings v0.8.0's `options_source: "all_projects"` (same source set), different evaluation timing.

## Cross-blueprint integration

### Project blueprint (v1.21.2 → v1.22.0)

- **`ProjectNavButtons`** gains a new context branch: when a project has `<Name> To-Do.md` at `spice/projects/<slug>/<Name> To-Do.md`, render a `To-Do` button on the project hub / map / board / docs / task-note rows. When AT the project-todo note, self-hide it (same pattern as existing branches). Detection: file existence check via `app.vault.getAbstractFileByPath`.
- **`ProjectsHubCards`** (Projects.md) — each project card gains an optional `N open` task pill in the right-side meta strip (next to existing `N/M tasks` kanban count). Pulls from the project's `<Name> To-Do.md` `## Owned Tasks` section count via `dv.page`. Renders nothing when project-todo note doesn't exist or count is 0 (empty-state policy).
- **Project creation** — `new_entity_buttons[]` for `project` gains a new `extra_files[]` entry: `{{prompts.name}} To-Do.md` from `Template, Project To-Do.md`. Fresh projects scaffold the to-do note built-in.
- **Existing projects** — `applyProjectTodoBackfill` installer step (project-blueprint-owned) walks `spice/projects/*/`, creates `<Name> To-Do.md` from template for each project where it's absent. Idempotent (skip-if-exists). Reports `created_count` + `skipped_count`.

### Meetings blueprint (v0.8.0 — no manifest change)

- No manifest changes. Existing meeting note bodies accept `- [ ]` task lines as today. Existing regex extraction in `MeetingsHubCards` (`/\- \[ \]/g` count) stays as-is.
- **Aggregation contract** — `ToDoDailyProjectGroups` reads each meeting note's `project:` frontmatter. If set, the meeting's open tasks render under the matched project's sub-section. If unset, they render under `ToDoDailyUnassignedMeetings`.
- **Source-of-truth invariant** — meeting-borne tasks live in the meeting body. Aggregator renders them; click navigates to source file (`openLinkText`). Sauce never copies meeting tasks into another file.

### Daily blueprint (no change)

`SpaceDailyDashboard` continues to vault-walk `p.file.tasks` for the dashboard's tasks panel. The v0.4.0 to-do daily-note is **parallel + complementary** — the dashboard panel is the "across-everything" view; the to-do daily is the "today's focused work" view. Both surface the same underlying tasks (the daily-blueprint version is collapsed by default already).

### Dependency bumps

| Mechanism | Range | Note |
|---|---|---|
| `customjs-guard` | `>=1.0.0` | unchanged |
| `nav-buttons` | `>=2.7.0` | unchanged |
| `accent-button` | `>=0.1.0` | unchanged |
| `cards` | `>=0.2.6` | unchanged (project + new ProjectsHubCards pill) |
| `entity-create` | `>=0.5.0` | unchanged (`options_source: "all_projects"` already shipped at v0.5.0; meetings v0.8.0 already uses it) |

No mechanism bumps required. v0.116.0 is blueprint-scope only.

## Installer + manifest deltas

### `to-do` manifest (v0.4.0)

```json
{
  "name": "to-do",
  "version": "0.4.0",
  "kind": "blueprint",
  "module_directory": "to-do",
  "customjs_classes": [
    "ToDoHubActions",
    "ToDoLeafActions",
    "ToDoAllList",
    "ToDoDailyCarryover",
    "ToDoDailyRecurring",
    "ToDoDailyProjectGroups",
    "ToDoDailyUnassignedMeetings",
    "ToDoCreateTask",
    "ToDoCreateTaskInit"
  ],
  "customjs_startup_scripts": ["ToDoCreateTaskInit"],
  "depends_on": [
    { "name": "nav-buttons", "range": ">=2.2.0" },
    { "name": "customjs-guard", "range": ">=1.0.0" },
    { "name": "accent-button", "range": ">=0.1.0" },
    { "name": "entity-create", "range": ">=0.5.0" }
  ],
  "files": [
    { "source": "templates/Today To-Do.md", "dest": "{{templates_path}}/Today To-Do.md" },
    { "source": "templates/All To-Dos.md", "dest": "{{module_directory}}/All-ToDos.md" },
    { "source": "templates/Project To-Do.md", "dest": "{{templates_path}}/Project To-Do.md" },
    { "source": "templates/Recurring Tasks.md", "dest": "{{module_directory}}/Recurring Tasks.md" },
    { "source": "helpers/todo-leaf-actions.js", "dest": "{{scripts_path}}/to-do/todo-leaf-actions.js" },
    { "source": "helpers/todo-hub-actions.js", "dest": "{{scripts_path}}/to-do/todo-hub-actions.js" },
    { "source": "helpers/todo-all-list.js", "dest": "{{scripts_path}}/to-do/todo-all-list.js" },
    { "source": "helpers/todo-daily-carryover.js", "dest": "{{scripts_path}}/to-do/todo-daily-carryover.js" },
    { "source": "helpers/todo-daily-recurring.js", "dest": "{{scripts_path}}/to-do/todo-daily-recurring.js" },
    { "source": "helpers/todo-daily-project-groups.js", "dest": "{{scripts_path}}/to-do/todo-daily-project-groups.js" },
    { "source": "helpers/todo-daily-unassigned-meetings.js", "dest": "{{scripts_path}}/to-do/todo-daily-unassigned-meetings.js" },
    { "source": "helpers/todo-create-task.js", "dest": "{{scripts_path}}/to-do/todo-create-task.js" },
    { "source": "helpers/todo-create-task-init.js", "dest": "{{scripts_path}}/to-do/todo-create-task-init.js" },
    { "source": "helpers/recurrence-parser.js", "dest": "{{scripts_path}}/to-do/recurrence-parser.js" },
    { "source": "helpers/task-parser.js", "dest": "{{scripts_path}}/to-do/task-parser.js" }
  ],
  "rule_fragments": [
    { "target": "to-do", "fragment": { "scope": { "path_glob": "spice/to-do/**/ToDo-*.md" }, ... } },
    { "target": "to-do-recurring", "fragment": { "scope": { "path_glob": "spice/to-do/Recurring Tasks.md" }, "extends": "_canonical-vocab", "required_frontmatter": { "type": { "required": true, "type": "string", "equals": "to-do-recurring" } } } }
  ]
}
```

(`todo-migrate-modal.js` and `todo-migrate-init.js` are deleted; the cross-cutting `applyOrphanedHelperCleanup` installer step from v0.110.0 removes the orphans on install.)

### `project` manifest (v1.22.0)

- `new_entity_buttons[0].extra_files[]` gains:
  ```json
  { "dest": "spice/projects/{{prompts.slug}}/{{prompts.name}} To-Do.md", "source_template": "Project To-Do.md" }
  ```
- `customjs_classes[]` unchanged (`ProjectNavButtons` extension is internal to its branch logic).
- `rule_fragments[]` gains:
  ```json
  { "target": "project-todo", "fragment": { "scope": { "path_glob": "spice/projects/*/* To-Do.md" }, "extends": "_canonical-vocab", "required_frontmatter": { "type": { "equals": "project-todo" }, "project": { "type": "string" }, "project_slug": { "type": "string" } } } }
  ```

### New installer steps

- **`applyToDoBlueprintMigration`** (to-do-owned) — walks `spice/to-do/<YYYY>/<MM-MMMM>/ToDo-*.md`. For each:
  1. Detect v0.3.3 body shape (2 dataviewjs blocks under frontmatter, no `ToDoDailyCarryover` marker).
  2. If detected, reshape body to v0.4.0 (5 dataviewjs blocks). User's typed `- [ ]` lines under the v0.3.3 dataviewjs blocks become the `## Today's Capture` section content. Edge case: if the v0.3.3 file had a manually-added `## Tasks` heading, those tasks are also absorbed into Capture (the heading is dropped); a manually-added `## Notes` section is preserved in place as free text.
  3. Idempotent via body-substring check (`'class: "ToDoDailyCarryover"'`).
  4. Reports `migrated_count` + `already_current_count` + `absorbed_tasks_heading_count` in install history. `.sauce-backup` snapshot before write.
- **`applyProjectTodoBackfill`** (project-owned) — walks `spice/projects/*/`. For each project (detected via the hub `<Name>.md` with `type: project` frontmatter):
  1. Compute expected `<Name> To-Do.md` path.
  2. If absent, create from `Template, Project To-Do.md`.
  3. Idempotent (skip-if-exists). Reports `created_count` + `skipped_count`.

Both steps integrate into `install.js` runInstall() after `applyDocNoteBreadcrumbMarkerCleanup` and before `applyOrphanedHelperCleanup`.

### Schema-registry deltas (`platform/schemas-index.json`)

Two new entries:

```json
{
  "type": "project-todo",
  "name": "Project To-Do",
  "scope_glob": "spice/projects/*/* To-Do.md",
  "frontmatter_schema": {
    "type": { "required": true, "equals": "project-todo" },
    "project": { "required": true, "type": "string" },
    "project_slug": { "required": true, "type": "string" },
    "created_at": { "required": true, "type": "iso-tz" }
  },
  "owner": "project blueprint"
},
{
  "type": "to-do-recurring",
  "name": "Recurring Tasks Registry",
  "scope_glob": "spice/to-do/Recurring Tasks.md",
  "frontmatter_schema": {
    "type": { "required": true, "equals": "to-do-recurring" },
    "created_at": { "required": true, "type": "iso-tz" }
  },
  "owner": "to-do blueprint"
}
```

`npm run lint-schemas` covers both. v0.113.0 schema-registry tooling is the validator.

## Test plan

| Harness | Scope | Pass target |
|---|---|---|
| `run-task-parser.js` (renamed from `run-todo-modal.js`) | Static `parseTasks()` extraction (used by carryover + dialog write-paths). Cases TM-1 / TM-2 / TM-6 / TM-7 from v0.3.3 carry forward; TM-3 / TM-4 / TM-5 (tomorrow-target migration) are dropped with the modal. | 4 / 0 |
| `run-recurrence-parser.js` (NEW) | `RecurrenceParser.matches()` across 4 supported grammar families + invalid rejections. 24 cases. | 24 / 0 |
| `run-todo-carryover.js` (NEW) | Yesterday-only carryover: 7-day-window walk, project-task skip, atomic write, sentinel idempotency. 8 cases. | 8 / 0 |
| `run-todo-materialize.js` (NEW) | Registry → daily routing: project-routed vs. Recurring Today, materialization-log row appending, sentinel idempotency. 10 cases. | 10 / 0 |
| `run-todo-dialog.js` (NEW) | Dialog payload → checkbox line serializer. Field validation. Tab switch state. 12 cases. | 12 / 0 |
| `run-v0116-todo-overhaul.js` (NEW behavioral harness) | Loads each new helper into sandboxed scope, instantiates, exercises against minimal Dataview + DOM + Obsidian-app stubs. Sections: `CARR-B-1..5` carryover; `REC-B-1..5` recurrence; `PG-B-1..5` project groups; `UM-B-1..3` unassigned meetings; `DLG-B-1..5` dialog; `TPL-B-1..3` template integrity. ~30 cases. | 30 / 0 |
| `run-helper-cases.js` (EXISTING) | Source-text contracts. v0.116.0 adds `V0116-TODO-*` families (~30 cases) — manifest shape, customjs_classes[] coverage, retirement of ToDoMigrateModal references, version-pin lineage patterns. | net +30 |
| `run-install.js` (EXISTING) | Full install lifecycle dogfood against workshop. Verifies orphan cleanup of `todo-migrate-modal.js` + `todo-migrate-init.js` after install. | exit 0 |
| `run-renderer.js` (EXISTING) | Visual + nav-button rendering. New cases: ToDoLeafActions 3-button row, ProjectNavButtons To-Do branch, ProjectsHubCards N-open pill. | exit 0 |

Total new test cases v0.116.0: ~117 net add. Total preflight cases at v0.116.0 close: existing 3064 + 117 = ~3181.

`npm run lint-schemas` runs as part of preflight (added v0.113.0). Both new schema entries lint clean.

### Seed-migrations integration (gated on PR #2 merged)

PR #2 (`cycle/migration-regression-net`) ships `platform/test/run-seed-migrations.js` + `platform/test/seed-vault/` + the per-cycle authoring loop documented in `Docs/agent-guides/migration-regression-net.md`. The intended sequencing for v0.116.0 implementation is: ship the in-flight finance work → merge PR #2 → start v0.116.0. Under that sequencing, v0.116.0 ships **two migrations** (`applyToDoBlueprintMigration` + `applyProjectTodoBackfill`), so the cycle **MUST extend the seed-vault and add an `HC-V0116-SEED-MIGRATE-*` assert family** per the testing mechanism's per-cycle authoring loop (canonical reference: `Sauce Testing.md` §10.4 / landmine #26).

**Seed-vault hand-edits (per landmine #26 — pre-migration shape; targets `platform/test/seed-vault/spice/...`):**

- 2-3 `spice/to-do/<YYYY>/<MM-MMMM>/ToDo-YYYY-MM-DD.md` files at v0.3.3 body shape:
  - 1 with the canonical 2-block + free-form `- [ ]` layout
  - 1 with a manually-added `## Tasks` heading (edge case — verifies absorption)
  - 1 with a manually-added `## Notes` section in addition to `- [ ]` lines (preservation edge case)
- 1 `spice/to-do/All-ToDos.md` already at the unchanged v0.3.x shape (verifies no false migration triggers; the v0.4.0 cycle does NOT touch the hub)
- 2 existing project folders without `<Name> To-Do.md` (e.g. "Sauce", "Headspace") — exercises backfill create-path
- 1 existing project WITH a pre-existing `<Name> To-Do.md` — exercises skip-if-exists
- 1 existing project's hub note carrying a manually-typed `- [ ]` line in the body — verifies the "manual hub task NOT pulled into daily / NOT relocated" invariant (project-todo is the canonical task source per Section 5)

**`HC-V0116-SEED-MIGRATE-*` assert family (~14 sub-asserts):**

| Sub-family | Count | Covers |
|---|---|---|
| `SEED-MIGRATE-TODO-RESHAPE-*` | 4 | All v0.3.3 daily notes detected + reshaped to 5-block v0.4.0 body; user-typed `- [ ]` lines preserved as Capture content; `## Tasks` heading absorbed; `## Notes` preserved verbatim |
| `SEED-MIGRATE-TODO-BACKUP-*` | 2 | `.sauce-backup/<ts>/` snapshots exist for each migrated daily note (backup-before-write invariant) |
| `SEED-MIGRATE-PROJ-TODO-CREATE-*` | 2 | `applyProjectTodoBackfill` created `<Name> To-Do.md` for each project lacking one; frontmatter matches `project-todo` schema |
| `SEED-MIGRATE-PROJ-TODO-SKIP-*` | 1 | Project that already had a `<Name> To-Do.md` was NOT overwritten (byte-equal pre/post) |
| `SEED-MIGRATE-ORPHAN-*` | 2 | `applyOrphanedHelperCleanup` removed `ranch/scripts/to-do/todo-migrate-modal.js` + `todo-migrate-init.js`; absent from post-install file tree |
| `SEED-MIGRATE-PRESERVE-*` | 1 | The project-hub manually-typed `- [ ]` line byte-equal pre/post (not pulled into daily; not relocated) |
| `SEED-MIGRATE-IDEMP-*` | 2 | Second `node platform/install.js` exit 0; history grew; no unexpected adds/changes/removes; sentinels respected |

Family wires into `run-seed-migrations.js` per PR #2's authoring pattern (assertion-helper choice + `withTempVault` scaffold), `HC-V0116-*` namespace.

**Total preflight cases at v0.116.0 close (with PR #2 merged, post-`f591008`):** existing main HEAD baseline (incl. PR #2's seed-foundation 48 + BODY-* / CLAUDE-* 16 ≈ 64 seed sub-asserts) + this cycle's ~117 v0.116.0 contracts + ~14 seed-migrate = roughly +131 net add over current main. Numbers track when the chain actually runs.

**If PR #2 is NOT merged before v0.116.0** — drop this sub-section from the implementation plan; the ~117 cases above stand alone and ship the cycle. Carry seed-migrate integration to v0.116.x once PR #2 lands. The implementation plan's preconditions check MUST verify `platform/test/run-seed-migrations.js` exists in `main` HEAD before claiming this sub-section is in scope.

## Rollout posture

1. Workshop ship: tag `v0.116.0` on `main` → `release.yml` runs preflight → bumps `Formula/sauce.rb` in brew tap PR.
2. Brew tap merge → `brew upgrade sauce` on consumer machines.
3. Per-vault: `sauce update --bump-pins` + `sauce install`. Installer fires `applyToDoBlueprintMigration` (existing daily notes get the 5-block body) + `applyProjectTodoBackfill` (each existing project gets a `<Name> To-Do.md` scaffold) + `applyOrphanedHelperCleanup` (removes the two retired JS files).
4. Post-install smoke (every consumer vault): open today's to-do; verify all 5 sections render (empty sections render nothing); click `+ New Task`; create one task into Today; create one into a project; create one Recurring; verify recurring fires into the next daily-note open.
5. **Post-cycle seed rebaseline (only if PR #2 was merged before this cycle):** `npm run seed:prev && npm run seed:rebaseline` forward-ratchets `platform/test/seed-vault/` from v0.115.x state to v0.116.0 state. Bookkeeping commit `chore(seed): rebaseline to v0.116.0`. Per `Sauce Testing.md` §10.4 step 5. Skip cleanly if PR #2 hasn't landed yet.
6. Dogfood result doc: `Docs/plans/2026-06-{NN}-v0.116.0-todo-blueprint-expansion-result.md` — captures what shipped, what stuck, what carried forward.

## Out-of-scope for v0.116.0 (carry-forwards)

- **Tasks-plugin checkbox-click delegation** — clicking a recurring task's checkbox in the daily-note's aggregated view (vs. opening source) should route through the Tasks plugin's `Toggle Done` to handle recurrence regeneration. v0.4.0 ships direct-write; users get the recurrence-regeneration behavior only when they click in the source registry's daily-note copy (where the line lives, not the aggregated render). Post-install notice flags this. Carry to v0.117.0.
- **Drag-to-reorder within sections** — sections are append-only in v0.4.0. Manual user edits (delete + re-add) work but no built-in reorder.
- **Batch-edit dialog** — multi-select + bulk priority / due-date / project change. Single-task dialog only in v0.4.0.
- **Mobile-optimized dialog layout** — dialog mockup is desktop-first; mobile rendering will likely overflow. Validate post-install; carry mobile pass to v0.117.x.
- **Recurrence-anchor field** — every-2-weeks anchors to `registry_created_at`. If a user wants the cycle to start from a specific date (e.g. "every 2 weeks starting 2026-07-01"), they have no way to express this. Add `[anchor:: YYYY-MM-DD]` in a future cycle.
- **Holiday + timezone-DST edges** — not handled. `every weekday` includes federal holidays. DST-shift days behave per `moment()` defaults.
- **Custom cron grammar** — explicitly excluded from v0.4.0 vocabulary.
- **`ProjectsHubCards N open` pill — auto-refresh** — pill reads `dv.page` on render; no live-watch. If a user adds a task to a project-todo note, the Projects.md pill updates only on next render. Acceptable for v0.4.0.
- **`SectionLabel` not declared in `customjs_classes[]`** carry-forward from project v1.21.2 is unrelated to to-do; not addressed here.

## Pointers

- v0.3.3 reference: `Docs/agent-guides/build-test-verify.md` (preflight + behavioral harness scaffolding); `platform/blueprints/to-do/` (current source).
- Project blueprint reference: `Docs/agent-guides/project-blueprint-ui.md` (Section 11 — render primitives + ordering + spacing); blueprint v1.21.2 implementation at `platform/blueprints/project/helpers/`.
- Schema registry: `Docs/agent-guides/schemas.md` (v0.113.0 Stage A); `platform/schemas-index.json`.
- Architecture guide: `Docs/agent-guides/architecture.md`.
- Brainstorm decisions: this document's frontmatter purpose-line + section ordering A locked from `.superpowers/brainstorm/9667-1781562973/content/daily-section-order.html` (capture-first); dialog locked from `new-task-dialog.html` (tabbed B); registry locked from `new-note-types.html` (Tasks-plugin syntax in plain MD).
