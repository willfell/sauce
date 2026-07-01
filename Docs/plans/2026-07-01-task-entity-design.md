# Task-entity — design

**Date:** 2026-07-01
**New mechanism:** `task-entity` (cross-cutting; consumed by to-do, project, meetings blueprints)
**Scope of this doc:** whole arc designed; **Phase 1 (daily to-do) specified in full**, phases 2–4 outlined.
**Origin:** headspace board card `spice/projects/sauce/tasks/To do tasks daily and other` (Blocked → this design), plus the 2026-07-01 brainstorm.

## Problem

Tasks today are raw `- [ ]` markdown lines living inside note bodies, fenced by sentinel markers
(`TODAY_CAPTURE_MARKER` in the daily, `ACTION_ITEMS_MARKER` in meetings, `OWNED_TASKS_MARKER` in
projects). When you tick or edit a task, a widget (`TodayCaptureEditableList` + the `task-interactions`
write path) **reads the whole note, mutates it in memory, and writes the whole note back**.

The user hit **data loss on mobile**: opened a daily note on the phone *before it finished syncing*
(so the on-disk copy genuinely had fewer tasks), interacted with one task, and the widget wrote that
stale, smaller version back — erasing the tasks that hadn't landed yet. Root cause is a **whole-note
read→modify→write over a stale/partial file**; a class of Obsidian mobile sync-conflict data loss.

Secondary wants (from brainstorm): create/edit/**delete** any task from a **dialog** on every surface
(daily, project, meeting), never hand-edit markdown; tasks created in a project or meeting **map to the
project and show up in the daily**; edit any task from anywhere.

## Decisions (from brainstorm — all four approved)

- **D1 — note-per-task.** Every task becomes its own tiny note with frontmatter; surfaces **live-query**
  them. Chosen over (a) keep-markdown-+-write-guard (only *reduces* the wipe — a stale on-disk file
  still writes stale) and (b) hybrid notes-for-durable/markdown-for-jots (two models). Note-per-task
  makes the wipe **structurally impossible**: no surface stores a task list, and every gesture writes
  **exactly one file**, so editing/ticking one task can never touch another, and separate files sync
  independently without whole-note conflicts.
- **D2 — scheduled-date + carryover drives the daily.** Each task has a `scheduled` "do-on" date;
  quick-capture defaults it to **today** (jotting stays instant). Today's daily = a live query of
  `status: open` split into **Today** (`scheduled == today`) + **Overdue/Carryover** (`scheduled < today`).
  Chosen over capture-day-roll-forward (piles up) and explicit-today-toggle (too manual).
- **D3 — recoverable delete.** "Delete" moves the task file to `spice/tasks/_trash/` (status flips to
  `deleted`); it vanishes from every list instantly but is restorable. Hard-delete only by emptying trash.
  Matches the user's loss-aversion — no gesture can destroy data outright.
- **D4 — one reusable `task-entity` mechanism, rolled out surface-by-surface, daily first** (where the
  pain is). Each phase is its own cycle → spec → plan → ship, dogfooded + seed-proven before touching
  real vaults.

## Architecture

A new **`task-entity` mechanism** owns: the task-note schema + store, the `TaskDialog` (the only
create/edit/delete UI), a Node-testable compose/parse core, and the live-query widgets. The to-do,
project, and meetings blueprints subscribe to it and render its widgets. `render-safe` provides
cold-load safety; the existing `TaskParser` is reused by the migration to read legacy inline fields.

### Data model — the task note

Flat store, filename is a **stable id** (never the title), so editing text never renames/moves the file:

```
spice/tasks/
  task-20260701-142233-7f3a.md      ← one task, one file
  _trash/                            ← recoverable delete (D3)
  _done/                             ← completed tasks archive here (keeps active queries small)
```

`spice/tasks/task-20260701-142233-7f3a.md`:
```yaml
type: task
title: Call Shirley Septic about trash can replacement
status: open            # open | done | deleted
scheduled: 2026-07-01   # "do-on" date → drives the daily (D2). Capture defaults to today.
due: 2026-06-30         # optional hard deadline
priority: high          # optional: low | medium | high | highest
project: "[[Sauce]]"     # optional wikilink → the project mapping
project_slug: sauce      # optional; denormalized for cheap query/grouping
source: meeting          # where it was born: daily | project | meeting | manual
source_note: "[[2026-07-01 Standup]]"   # optional backlink to origin
created_at: 2026-07-01T14:22:33-06:00
completed_at:            # set when marked done
```
- Note **body** is optional freeform detail. Task *state* is the frontmatter only — never hand-edited.
- A missing/blank `scheduled` = "unscheduled" (shows in its project's *someday* group, not the daily).
- Filename stem `task-<YYYYMMDD>-<HHmmss>-<4hex>`; the 4-hex suffix (derived from title+timestamp, not
  `Math.random`) guarantees uniqueness without collision even on same-second captures.

### The `task-entity` mechanism layout

```
platform/mechanisms/task-entity/
  manifest.json
  task-entity.js          # TaskEntity: pure compose/parse core (Node-testable statics)
  task-dialog.js          # TaskDialog: the create/edit/delete overlay (bare class; instance API)
  task-today-list.js      # TaskTodayList: daily live-query widget (Today + Overdue bands)
  README.md
```
- **TaskEntity** (pure, Node-testable — mirrors `ToDoCreateTask.serializePayloadToLine` posture):
  - `composeNote(payload) → { path, frontmatter, body }` — payload → task-note (with defaults + id).
  - `taskFilename(payload, now) → "task-…​.md"` — stable id stem.
  - `parseNote(page) → task` — Dataview page → normalized task object (coerce/validate).
  - `queryToday(pages, todayStr) → { today, overdue }` — pure partition for the daily.
  - `validatePayload(payload) → { valid, reason }`.
- **TaskDialog** (bare CustomJS class per `lesson_customjs_no_trailing_statements` — NO trailing
  statements; instance delegators for cross-class calls): the `document.body.createDiv` overlay evolved
  from `ToDoCreateTask.open` (already mobile-capable DOM). Fields: title · scheduled · due · priority ·
  project · notes. Buttons: **Save · ✓ Done · 🗑 Delete · Cancel**. Modes: `create` (smart defaults by
  origin surface) and `edit` (hydrated from an existing task file).
  - **Every operation writes exactly one file:** create = `vault.create(path, note)`; edit =
    `vault.process(taskFile, …)` on the task's own file; delete = move to `_trash/` + `status: deleted`;
    done = flip `status`/`completed_at` in the one file. **No operation ever reads or rewrites a
    surface note** → the wipe is impossible by construction.
- **TaskTodayList** (bare CustomJS class): the daily widget. Queries `dv.pages` for `type: task,
  status: open`, partitions via `TaskEntity.queryToday`, renders **Today** + **Overdue/Carryover**
  bands. Each row: a functional done-checkbox, title, project/priority/due chips, tap-anywhere →
  `TaskDialog.open({ edit: filePath })`. `+ New Task` button → `TaskDialog.open({ scheduled: today })`.
  Cold-load-guarded via `render-safe`.

### Phase 1 — daily to-do (this cycle, in full)

1. **Mechanism** `task-entity` with `TaskEntity` + `TaskDialog` + `TaskTodayList` (above).
2. **to-do blueprint** subscribes to `task-entity`; the daily template (`Today To-Do.md`) drops
   `TodayCaptureEditableList` / `ToDoDailyCarryover` and renders `TaskTodayList` instead. `ToDoLeafActions`
   `+ New Task` routes to `TaskDialog`. The old `TodayCaptureEditableList` + `task-interactions` write
   path are **retired for the daily surface** (the exact code that caused the wipe — deleted here).
   `ToDoDailyRecurring`, `ToDoDailyProjectGroups`, `ToDoDailyUnassignedMeetings` stay for now (they
   already render live and aren't the wipe path; they fold in during phases 2–4).
3. **Migration** (one-time reshaper → **version-gated** per the migration-lifecycle gate;
   `install-migrations`-style, `migration_kind: "once"`): `applyDailyTasksToEntityMigration`.
   - Walks the vault's **daily notes**; for each **open** (`- [ ]`) line under `TODAY_CAPTURE_MARKER` and
     the Carryover section, parses it with the existing `TaskParser` (preserving due/project/priority),
     and **creates one task-note** (`source: daily`, `scheduled` = the line's `due` if present else the
     daily's own date; carryover/overdue naturally falls into the Overdue band).
   - **Non-destructive & idempotent:** writes a full **`.sauce-backup`** of each daily note *before*
     removing its migrated lines; a per-line `migrated_to::` marker + a per-note sentinel make re-runs
     no-ops; completed (`- [x]`) lines and historical dailies' done tasks are **left untouched**.
   - **Bounded:** only OPEN tasks in dailies are migrated; nothing is deleted; worst case = restore a
     `.sauce-backup`.
4. **Schema:** register `task` in `platform/schemas-index.json` (contract on `type: task`,
   `path_glob spice/tasks/**`); `npm run lint-schemas` green.
5. **Nav/surface wiring:** `claude_surface[]` + manifest + new-entity-button conventions as needed
   (pipeline owns version pins).

### Phases 2–4 (outlined — each its own brainstorm→spec→cycle)

- **Phase 2 — projects.** `TaskProjectList` widget (query `project_slug == this`, grouped
  scheduled/overdue/someday) on `<Name> To-Do.md`; `+ New Task` defaults `project = this`. Migration
  reshapes `OWNED_TASKS_MARKER` lines → task-notes. `ToDoDailyProjectGroups` reads task-notes.
- **Phase 3 — meetings.** `TaskMeetingList` (query `source_note == this meeting`) replaces the Action
  Items markdown; `MeetingLeafActions +New Task` → `TaskDialog` (stamps `source_note` + inherits
  project). Migration reshapes `ACTION_ITEMS_MARKER` lines. `ToDoDailyUnassignedMeetings` reads task-notes.
- **Phase 4 — recurring (fold-in).** Recurring becomes a recurring task-note with a `recurrence` rule;
  the daily query expands the day's instance. Retires the `Recurring Tasks.md` template flow. Lowest
  urgency (already wipe-safe).

## Data flow (Phase 1)

```
TaskDialog (create: scheduled=today)         TaskDialog (edit / done / delete)
        │ vault.create one file                       │ one-file write to the task's own file
        ▼                                              ▼
spice/tasks/task-….md  { type: task, status, scheduled, project, … }
        │
        └─► TaskTodayList (dv.pages type:task, status:open → Today + Overdue bands, tap→dialog)
        (later) ─► TaskProjectList / TaskMeetingList (same files, different queries)
```

## Testing

- **Node-testable core:** `TaskEntity.composeNote` / `taskFilename` (stable, collision-free) /
  `parseNote` (coercion of blank/invalid fields) / `queryToday` (Today vs Overdue partition, boundary
  dates) / `validatePayload`. New `platform/test/run-task-entity.js`.
- **customJS-load gate:** `TaskDialog`, `TaskTodayList`, `TaskEntity` must pass `run-customjs-loadable.js`
  (bare class, no trailing statements) and the customjs-contract gate.
- **Seed regression (`run-seed-migrations`):** add seed fixtures — a daily with open TODAY_CAPTURE +
  Carryover lines (with due/project/priority) → assert the migration (a) creates matching task-notes with
  correct `scheduled`/`project`/`priority`, (b) writes a `.sauce-backup`, (c) is idempotent on re-run
  (no dup task-notes), (d) leaves `- [x]` and historical dailies untouched. Seed `workshop_version` `0.0.0`.
- **Schema:** `lint-schemas` green with the new `task` contract.
- **Whole-suite:** `release:preflight` + `release:preflight-bumped` green; workshop dogfood self-install
  exit 0; integration smoke green.
- **Post-deploy verification (self, before handing back):** on each real vault, confirm task-notes
  materialized from the vault's open daily tasks, `.sauce-backup` files exist, `sauce status` drift:none,
  and no open task went missing (count reconciliation: legacy open lines in → task-notes out).

## Migration safety (the user's #1 concern) — summary

- No surface stores a task list → wipe impossible by construction.
- Every dialog gesture writes exactly one file.
- Delete is recoverable (`_trash/`).
- Migration **backs up before touching** (`.sauce-backup`), is idempotent + version-gated, and is
  **proven on the synthetic seed vault before any real vault** — the real-vault deploy is earned.
- Rolled out daily-first; a bad phase only ever touches one surface. Old wipe-path code deleted per surface.

## Non-goals / YAGNI

- No third-party plugin (Obsidian Tasks / TaskNotes) — the model is built natively on `entity-create`
  conventions + customJS, no dependency shipped to consumers.
- Phase 1 does **not** touch project/meeting/recurring surfaces (their markdown keeps working until their
  phase); no cross-phase big-bang.
- No sub-tasks, no dependency graph, no notifications (future, if ever).
- Historical **completed** tasks in old dailies are not migrated (harmless archival markdown).

## Risks

- **Breaking storage change** (markdown → notes) for the daily surface. Mitigated by daily-first rollout,
  `.sauce-backup`, seed-proof-first, and leaving other surfaces' markdown intact until their phase.
- **Migration correctness** (a mis-parse drops a task). Mitigated by reusing the proven `TaskParser`,
  count reconciliation in verification, non-destructive backup, and idempotency.
- **customJS load traps** (`lesson_customjs_no_trailing_statements`) — bare classes only; enforced by the
  CJS-LOAD preflight gate.
- **Mobile dialog styling** — the overlay is DOM (mobile-capable) but needs fixed-position/viewport care;
  verified during dogfood.
- **Query performance** with many task-notes — Dataview handles thousands of pages; `_done/` archive keeps
  the active `status: open` set small.
```