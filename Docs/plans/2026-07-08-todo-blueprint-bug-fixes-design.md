# To-Do Blueprint Bug Fixes + Ordering/Discoverability — Design Spec

**Date:** 2026-07-08
**Blueprint:** to-do
**Mechanism:** task-entity

---

## Problem

Six issues surfaced from daily use of the note-per-task to-do system:

1. The Home command center's glance chips miscount overdue vs. today tasks — tasks scheduled for today are showing up as overdue.
2. The note-link picker in the task-create dialog (Links → "+ Note") returns zero matches when searching for a note that should match.
3. The daily `Today To-Do` note's task list has no chronological order within its Today/Overdue groups.
4. Long task titles wrap below the done-checkbox instead of staying beside it.
5. `spice/to-do/All-ToDos.md` shows stale data (frozen at June 3rd) and queries a data model that no longer applies.
6. The existing Completed Tasks archive (shipped 2026-07-06) has no nav button pointing to it, so it isn't discoverable.

Two related requests — recurring tasks and subtasks-within-a-task-note — are **out of scope** for this spec; they are substantial enough to need their own design sessions (see Out of scope).

---

## Root causes (confirmed by code + a live task note)

### 1. Overdue miscount — bare YAML date coercion

`TaskEntity._toDateStr` (`platform/mechanisms/task-entity/task-entity.js`) trusts `v.toISODate()` on any Date-like value Dataview hands back for the `scheduled` frontmatter field.

Task notes write bare, unquoted dates, e.g.:

```yaml
scheduled: 2026-07-08
```

(confirmed by reading a live task note in the accuris vault — `TaskDialog.renderNote`'s `_yamlScalar` only quotes values containing a YAML-hostile character; a plain ISO date has none, so it's emitted bare.)

A bare `YYYY-MM-DD` YAML scalar is parsed under the YAML core schema as a **UTC-midnight Date**, not a string. When Dataview wraps that in a Luxon `DateTime` in the local system zone and `.toISODate()` is called, a negative UTC offset (confirmed: the note's `created_at` carries `-06:00`) rolls the date back one calendar day — `2026-07-08` becomes `"2026-07-07"`.

`TaskEntity.queryToday`'s string comparison (`sched < todayStr`) is then working correctly on now-wrong data: it buckets a today-scheduled task as overdue.

### 2. Note-link picker — sort/filter logic is correct; bug is elsewhere

`TaskDialog.openNotePicker` (`platform/mechanisms/task-entity/task-dialog.js`) already:
- sorts candidates by `mtime` descending (most-recently-edited first), tie-broken alphabetically
- filters by case-insensitive substring match on basename, live on every keystroke

Confirmed with the user: the picker returns **zero matches**, not wrong-order matches. Candidates for the actual defect:
- the `p.indexOf('spice/tasks/') === 0` exclusion (skips any note under `spice/tasks/`, intended to stop linking a task to another task) dropping more than intended
- `app.vault.getMarkdownFiles()` returning an emptier list than expected in this dialog's execution context

This needs reproduction before a fix (see Investigation approach below), not a guessed patch.

### 3. Task ordering — grouping already exists; only the internal order is missing

`TaskTodayList.buildBands` (`platform/mechanisms/task-entity/task-today-list.js`) already partitions parsed tasks into `{ today, overdue }`, and `render()` already draws them as two separate visual bands (Today first, then "Overdue / Carryover" only when non-empty). What's missing is a secondary chronological sort *within* each band — tasks currently render in whatever order `dv.pages()` yields.

### 4. Checkbox/text wrap — CSS flex line-breaking bug

`TaskTodayList.renderTaskRow` (`task-today-list.js`) lays out one `flex-wrap: wrap` row with three siblings: the checkbox wrapper, the title span, and a right cluster (chips + action icons). CSS flexbox decides line-wrapping using each item's *unshrunk* hypothetical main-axis size — for a long title, that's its full one-line text width, not its word-wrapped width. When that width exceeds the remaining space on the row, the **entire title item** is pushed to a new flex line, stranding the checkbox alone on line 1. This matches the reported symptom exactly.

### 5. All-ToDos — querying an obsolete data model

`ToDoAllList` (`platform/blueprints/to-do/helpers/todo-all-list.js`) queries `p.file.tasks` — Dataview's view of native `- [ ]` markdown checkboxes inside daily notes. That data source stopped being populated once the note-per-task migration replaced raw markdown checkboxes with `TaskTodayList`-rendered task notes, which explains the view being frozen at whatever date last had literal checkbox lines (June 3rd).

### 6. Completed Tasks — feature exists, isn't discoverable

`TaskDoneArchive` + `spice/to-do/Completed Tasks.md` already exist and work exactly as requested (date-grouped cards, search strip, metadata) — shipped per `Docs/superpowers/specs/2026-07-06-completed-tasks-view-design.md`. `ToDoLeafActions` (`platform/blueprints/to-do/helpers/todo-leaf-actions.js`) has "New Task", "Recurring", and "All" buttons, but nothing links to it.

---

## Fixes

### 1. `TaskEntity._toDateStr` — UTC-safe date extraction

Change the Date/Luxon branches of `_toDateStr` to extract the calendar date using **UTC getters** rather than trusting the value's local-zone rendering. A bare YAML date's only well-defined meaning is UTC midnight, so reading it back via UTC fields is correct regardless of which local zone the vault's device happens to be in, and regardless of whether Dataview hands back a Luxon `DateTime`, a plain JS `Date`, or (for a string that was properly quoted) a string that never enters this branch at all.

This is a pure-function change. No migration is needed — every existing task note is read correctly the moment this ships, without rewriting any files.

### 2. Note-link picker — reproduce, then fix

Investigation approach (via `systematic-debugging`):
1. Build a minimal reproduction of `openNotePicker`'s candidate-building loop against a real vault snapshot (or a Node-side stub of `app.vault.getMarkdownFiles()`) to see exactly where the candidate list goes empty.
2. Confirm whether the `spice/tasks/` exclusion, the basename dedup, or the vault API itself is at fault.
3. Fix the specific defect found; add a regression test that would have caught it.

### 3. `TaskTodayList.buildBands` — sort within each band

Before returning, sort:
- `overdue` ascending by `scheduled` (oldest/most-overdue surfaces first)
- `today` ascending by `due` (earliest deadline first; tasks with no `due` sort last), tie-broken by `title`

No change to `render()`'s band structure — it already draws Today then Overdue/Carryover as separate groups.

### 4. `TaskTodayList.renderTaskRow` — nested nowrap group

Restructure the row: wrap the checkbox and title in a nested `flex-wrap: nowrap` sub-container (`flex: 1 1 auto; min-width: 0`), which can never be split across lines relative to each other — a long title just wraps its own text internally and the row grows taller. The right cluster (chips/actions) remains a sibling of that group in the OUTER `flex-wrap: wrap` row, and is the only thing that can drop to its own line when space is tight — matching the layout intent already described in the existing code comments.

### 5. `ToDoAllList` — rebuild against the note-per-task model

Rewrite to query `spice/tasks` (open tasks only, excluding `_trash/`/`_done/`), mirroring `TaskDoneArchive`'s existing pattern:
- `DocSearch` filter strip at the top
- date-grouped sections: Overdue (oldest first), Today, future dates, then a "No date" group
- rows rendered via the shared `TaskTodayList.renderTaskRow` for visual/behavioral consistency with every other task surface (checkbox, title-click-to-open, edit/delete)

Same class name (`ToDoAllList`) and template path (`spice/to-do/All-ToDos.md`) — only the internals change, so `ToDoLeafActions`'s existing self-heal check (which tests file content for the `ToDoAllList` sentinel) keeps working unmodified.

### 6. "Completed" nav button

Add a new `AccentButton` next to "All" in `ToDoLeafActions`, opening `spice/to-do/Completed Tasks.md`, following the same lightweight create-if-missing pattern the "All" button already uses (write the canonical template body referencing `TaskDoneArchive` if the file is absent or missing its aggregator block).

---

## Testing

All six fixes land inside the existing Node-test harness pattern (`platform/test/run-task-entity.js` and siblings) — no new runner needed:

- `_toDateStr`: new cases for a Luxon-`DateTime`-like stub anchored at UTC midnight, exercised assuming a negative-offset system zone; confirm the result is unaffected by local zone.
- Note-link picker: a regression test for whatever the reproduction step (fix #2) finds.
- `buildBands`: cases asserting `overdue` sorts ascending by `scheduled` and `today` sorts ascending by `due` (undated last).
- `renderTaskRow`: a DOM-stub test asserting the checkbox and title share a non-wrapping parent, and a long title does not detach the checkbox from line 1.
- `ToDoAllList`: new pure selector(s) mirroring `TaskDoneArchive.groupByDate`/`filterByText`, tested the same way.
- `ToDoLeafActions`: a test confirming the new "Completed" button opens/creates `spice/to-do/Completed Tasks.md`.

---

## Out of scope

- **Recurring tasks** — the create-dialog's "Recurring" tab currently just opens the `Recurring Tasks.md` registry directly rather than surfacing a recurrence field on individual tasks; whether that's broken or a deliberate past decision needs its own investigation and design session.
- **Subtasks within a task note** — creating/editing/deleting child tasks from within a parent task's `TaskNoteView`, without falling back to markdown checkboxes, is a new relationship model (parent/child tasks) that needs its own design session.
