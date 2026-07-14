# Project Dashboard & Hub Upgrades — Design

**Date:** 2026-07-13
**Blueprint:** `project`
**Status:** approved (brainstorm), pending plan

## Problem

Four issues on the project blueprint's dashboard + hub:

1. **Dashboard "Open tasks"** parses raw `- [ ]` checkbox lines from `<slug>-board.md` and `<Project> To-Do.md` — a second, divergent task source that ignores the note-per-task model everything else uses.
2. **Dashboard "Recent meetings"** shows only note name + relative time — no attendees, no notes/open-task pills, unlike `SpaceDailyDashboard`.
3. **Projects hub sort** ("Last edited ⇄ A–Z") appears broken. Root cause: the working+tested toggle exists in blueprint source (`platform/blueprints/project/helpers/projects-hub-cards.js`, v1.52.0) but this vault's dogfood copy (`ranch/scripts/project/projects-hub-cards.js`) is the stale pre-toggle version — never redeployed.
4. **No archive.** No way to set a project inactive and hide it from `Projects.md`. No board-lane breakdown on the dashboard.

## Design

### 1. Dashboard — Open Tasks (task-notes only)

Replace `ProjectDashboard._openTasks` (raw regex parse of board + to-do files) with the same query `TaskProjectList` uses: `spice/tasks` pages where `type==='task' && status==='open' && project_slug===<this project>`, excluding meeting-sourced tasks and `_trash/`/`_done/`. Drop the board-file/To-Do-file regex read for open-tasks entirely. Cap unchanged (6). Row click still opens the task note. Owned-tasks freeform bullets are **not** included — task notes are the single source of truth.

### 2. Dashboard — Recent Meetings (SpaceDailyDashboard parity)

Port `SpaceDailyDashboard._enrichMeeting` enrichment (attendees, `hasNotes`, `openTasks`) and its badge logic verbatim into `ProjectDashboard._renderRecentGroups`'s meeting branch:
- Subtitle: attendees comma-joined, truncated to 3 with `+N`.
- Badges: `"Notes"` accent-outline when `hasNotes`; `"N open"` warn-outline when `openTasks > 0`.
- No new badge type. No pill when a meeting has no notes and no open tasks (matches existing convention).

### 3. Dashboard — Board Stats Row (4 lanes, compact)

New compact row **below** the existing docs/board/todo/map/meetings tile row. Reads the project's `<slug>-board.md` kanban lanes (`## In Planning`, `## In Progress`, `## Blocked`, `## Completed`) and counts cards per lane (`- [ ]` and `- [x]` lines under each header). Renders 4 icon+count chips:

`📝 Planning N · ⚡ In Progress N · ⛔ Blocked N · ✅ Completed N`

Zero-count chips dropped silently (per `project-blueprint-ui.md` §6 meta-line convention). Icons keep the row tight; row wraps on mobile via existing `_mobilize`-style flex-wrap.

### 4. Projects Hub — Sort Toggle Fix (deploy the built version)

Deploy the newer `platform/blueprints/project/helpers/projects-hub-cards.js` into this vault's dogfood copy. That version already has the working, tested toggle (`_readSortMode`/`_writeSortMode`, `localStorage` key `sauce.projects-hub.sort`, `_sortProjects`, `_renderSortToggle`, scoped `_rebuildGrid()`). Keep it simplified — the retired status-chips and Group-by dropdown stay retired.

### 5. Projects Hub — Archived Status + Toggle

Three coordinated pieces:

**a. Schema** — `platform/blueprints/project/manifest.json`: add `archived` to the `status` enum → `^(idea|planning|in-progress|blocked|superseded|cancelled|done|archived)$`. Add optional `pre_archive_status` field (string, same enum minus `archived`) used to restore on unarchive. Existing `done`/`superseded`/`cancelled` projects keep showing normally — only `archived` is hidden by default.

**b. Archive / Unarchive commands** — via `ProjectCommandsInit`, add to the project hub `⋯` overflow menu:
- **Archive project**: stash current `status` into `pre_archive_status`, set `status: archived`, `status_changed_at: <today>`.
- **Unarchive project**: restore `status` from `pre_archive_status` (fallback `idea` if absent), clear `pre_archive_status`, set `status_changed_at: <today>`.

**c. Hub filter + toggle** — `ProjectsHubCards` filters out `status==='archived'` by default. New **"Show archived"** pill button in the same control row as the sort toggle (single left-aligned row above the grid), persisted via `localStorage` key `sauce.projects-hub.show-archived`, **default off**. Reuses `_rebuildGrid()` for scoped re-render.

Control row: `[ Sort: Last edited ⇄ ]  [ Show archived: Off ⇄ ]` — pill style matching `se-rail-toggle-pill`.

## Testing

- `platform/test/run-projects-hub-cards.js`: new `PHC-ARCH-*` (archived hidden by default / shown when toggle on) + `_readShowArchived`/`_writeShowArchived` round-trip.
- `platform/test/run-project-dashboard.js` (create if absent): open-tasks-via-TaskProjectList query, meeting-badge port, board-lane counts.
- `npm run lint-schemas` after the manifest enum change.
- `npm run status` / release preflight before PR.

## Deployment

Automatic release pipeline (conventional commits → bumper → auto-merge release PR → tag → brew). `project` blueprint version bumps (dashboard + hub + schema + commands). `task-entity` reused, not modified. After release: `sauce update --force` (or `--bump-pins`) per consumer + dogfood so the live `Projects.md` finally shows the toggles.

## Non-goals

- No status-chip / Group-by revival.
- No new meeting "done/green" badge — exact SpaceDailyDashboard parity only.
- No changes to the note-per-task model or `TaskEntity` query semantics.
