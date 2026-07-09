# Subtasks + Task-Dialog Polish — Design Spec

**Date:** 2026-07-08
**Blueprint:** to-do
**Mechanism:** task-entity

---

## Problem

Two related asks, bundled because both touch the same dialog/note surfaces:

1. **Subtasks** (deferred from the 2026-07-08 to-do bug-fix cycle, and from the recurring-tasks cycle): "when you create a task, that with the task note that opens, you should be able to create tasks within that task note. That way a task can have sub tasks... a button within the note to go through and create tasks, allowing for the user to edit and delete them, and not show them as markdown tasks if possible."
2. **Dialog field + polish**: "there should only be an entry on the form for due, remove scheduled" + general visual/UX refinement of the create/edit task dialog.

---

## Part A — Due/Scheduled consolidation

### Current state

`TaskEntity`'s schema carries two independent date fields: `scheduled` (drives `TaskEntity.queryToday` / `TaskTodayList.buildBands` — whether a task shows in Today/Overdue) and `due` (a secondary, cosmetic deadline chip with no bucketing effect). The dialog shows both as separate date inputs. This is confusing: two dates, only one of which actually does anything structural.

### Decision

Collapse to **one field**, named `due`, which now drives everything `scheduled` used to. The `scheduled` frontmatter key is retired. This is a schema-level rename, not just a UI relabel — every reader of the old field, and every existing task note in every consumer vault, must move to the new key.

### Blast radius (confirmed by grep, this session)

Schema-owning files (must change):
- `platform/mechanisms/task-entity/task-entity.js` — `composeNote`/`parseNote` drop `due` as a separate empty-string field and repurpose it to carry what `scheduled` used to; `queryToday` reads `due` instead of `scheduled`. `nextOccurrence` itself is unaffected (it's a generic date-math helper; only the field TaskDialog rolls forward changes).
- `platform/mechanisms/task-entity/task-dialog.js` — one date field, not two; `_payloadFromState`/`_saveEdit`/`_markDone`'s roll-forward branch all write `due` instead of `scheduled`.
- `platform/mechanisms/task-entity/task-today-list.js` — `buildBands` buckets on `due`; `renderTaskRow`'s existing `due:` chip logic is UNCHANGED (still fine to show "due: 2026-07-08" even for a Today-band task — harmless redundancy, not worth the complexity of suppressing it contextually).
- `platform/mechanisms/task-entity/task-note-view.js` — `_fieldRows` collapses its separate `Scheduled`/`Due` rows into one `Due` row.
- `platform/blueprints/to-do/helpers/todo-all-list.js` — `groupByDate` buckets on `due`.
- `platform/blueprints/to-do/helpers/task-recurring-list.js` — `filterRecurring`'s sort key becomes `due`.
- `platform/install.js` — `applyRecurringTasksMigrationHeal` (shipped in v0.203.0) writes `scheduled:` in its hand-composed frontmatter; must write `due:` instead, and drop the now-redundant separate `due:` blank line it currently also writes.

**Explicitly out of scope** (verified they don't touch the `spice/tasks/*.md` schema — they operate on a different, independent raw-checkbox inline-field convention on daily/project-todo notes, not on task-entity notes): `today-capture-editable-list.js`, `todo-create-task.js`, `todo-leaf-actions.js`. These are legacy/parallel surfaces this cycle does not touch.

### New migration heal

A new install-time heal, `applyTaskDueScheduledRenameMigration`, walks every note under `spice/tasks/` (open, `_done/`, and `_trash/` — everywhere, since a task can be in any of the three folders) and, where a `scheduled:` key is present, copies its value into `due:` (only if `due` is currently blank — never clobber a value someone already put in `due` under the old dual-field system) and removes the `scheduled` key. Ungated (runs every install), idempotent (a note with no `scheduled` key is a no-op), one `.sauce-backup` snapshot per touched file, failure-loud history. This MUST run across all 3 consumer vaults' existing task notes (accuris/ero/headspace all have real tasks with `scheduled` set today) — without it, every existing task with a `scheduled` date would silently vanish from Today/Overdue the moment `queryToday` starts reading `due` instead.

### Testing

- `TaskEntity.composeNote`/`parseNote`: `due` round-trips; no `scheduled` key emitted.
- `TaskEntity.queryToday`: buckets on `due` (existing today/overdue test cases updated to set `due` instead of `scheduled`).
- `TaskTodayList.buildBands`: same.
- `ToDoAllList.groupByDate`: same.
- `TaskRecurringList.filterRecurring`: sorts by `due`.
- `TaskDialog._rollForwardDate`/`_markDone`: recurring roll-forward writes `due`.
- `TaskNoteView._fieldRows`: single `Due` row, no `Scheduled` row.
- New seed-vault fixture: a pre-existing task note (and a pre-existing recurring task note) with `scheduled:` set, no `due:` set; asserts post-install both notes have `due` populated from the old `scheduled` value and no `scheduled` key remains; idempotent on second install.

---

## Part B — Task dialog polish

### Field set + progressive disclosure

- **Always visible:** Title, Due.
- **Behind a "More options" toggle:** Priority, Project, Repeats, Notes, Links.
- **Create mode:** toggle starts collapsed (nothing to show yet).
- **Edit mode:** toggle auto-expands if the task being edited already has ANY of Priority/Project/Repeats/Notes/Links set — so existing data is never hidden by default. Starts collapsed only when editing a bare task with none of those set.
- The toggle is a subtle inline text control ("More options ▾" / "Less options ▴") directly below the Due field, not a separate dialog or modal-within-modal. Expanding/collapsing is a lightweight CSS transition (max-height + opacity), matching the existing hover-lift/press-scale button-affordance language already in this file — no new animation dependency.

### Visual refinement

Tightened spacing between field groups, consistent label treatment, and calmer visual hierarchy (Title reads as the clear primary input; Due secondary; everything else, once expanded, reads as a distinct "more" region — e.g. a subtle top border or background tint separating it from the core two fields). No new component library; this is CSS-only refinement of the existing inline-styled DOM the dialog already builds.

### Testing

DOM-construction/state-machine logic is testable as pure functions, mirroring the pattern already used for `_recurrenceValidity`:
- A new pure helper, `TaskDialog._moreOptionsShouldStartExpanded(state)` (or equivalent), returning true iff any of `priority`/`projectName`/`recurrence`/`notes`/`links.length` is non-empty — unit-testable without touching the DOM.
- Manual smoke pass (per the existing smoke-checklist convention) covers the actual expand/collapse interaction and visual polish, since that's inherently a rendered-DOM/visual concern outside the Node harness's reach.

---

## Part C — Subtasks

### Data model

A subtask is a **full task note** — a normal `spice/tasks/*.md` file created via the existing `TaskEntity`/`TaskDialog` machinery — carrying one new field: `parent_task` (a wikilink to the parent task's note, empty string when absent, following the schema's existing empty-string-not-omitted convention). No `subtasks: []` array on the parent; the parent's subtask list is a **live query** (`dv.pages('"spice/tasks"').where(t => t.parent_task links to this note)`), the same "child owns the pointer, parent live-queries" pattern already used for `project_slug` (child→project) and `source_note` (child→meeting). This avoids a duplicated, driftable list.

**One level of nesting only.** A task that already has `parent_task` set cannot itself be given subtasks (the "+ Add subtask" affordance is hidden on a subtask's own note). Keeps the model, the rendering, and the exclusion logic simple — no recursive tree UI, no cycle detection needed.

Schema addition: `parent_task` inserted into `TaskEntity`'s frontmatter schema right after `source_note` (adjacent to the other note-relationship fields).

### Where subtasks appear

- **Inside the parent's own note (`TaskNoteView`)** — new section, ordered after the existing DETAILS/SOURCE rows and before the full-width "Edit task" button: a "Subtasks" heading, a live list of child task rows (reusing `TaskTodayList.renderTaskRow` — same checkbox/edit/delete/badge behavior as every other task surface, so a subtask gets recurrence, priority, due dates, and the repeat badge for free), plus a lightweight "+ Add subtask" inline quick-add (mirrors the Home dashboard's existing `TaskDialog.createQuick` one-gesture pattern: type a title, hit enter/tap add, a new task note is created immediately with `parent_task` set to the current note, no full dialog round-trip required for the common case — the row's own `⋯`/edit affordance still opens the full dialog if more fields are needed).
- **Today/Overdue personal bands** — a subtask (any task with `parent_task` set) is **excluded**, matching the exact precedent `TaskTodayList.buildBands` already uses for `project_slug`- and `source==='meeting'`-owned tasks: it renders in its own dedicated section (the parent's Subtasks list) instead, so nothing is lost, nothing renders twice.
- **All-ToDos / Recurring index** — subtasks ARE included (matching how project-owned tasks already behave in `ToDoAllList` today), since these are flat, comprehensive views of every open task regardless of ownership.
- **Completed Tasks archive** — included, same reasoning.

### Parent/child lifecycle

- **No auto-completion cascade.** Completing every subtask does NOT automatically mark the parent done — the parent represents the whole unit of work, which the user completes explicitly. (A lightweight non-authoritative visual signal is included instead — see below — rather than hidden automation.)
- **A small "N/M subtasks done" progress indicator** renders on the parent's `TaskNoteView` Subtasks heading (e.g. "Subtasks · 2/5 done") — cheap, informative, and doesn't drive any behavior.
- **Deleting a parent never touches its children** (preserves the existing one-file-write invariant already documented extensively on `TaskDialog`: every gesture touches exactly one file). A deleted (trashed) parent's former subtasks simply become ordinary top-level tasks — their `parent_task` link now points at a trashed note, which the parent-lookup path treats as "no live parent" (rendered with no visible parent-context line, exactly like a task that was never a subtask). No orphan-cleanup heal needed; this is a natural, harmless degradation, not a broken state.
- **A subtask's own note** shows a small "Part of: [[Parent title]]" line (mirrors the existing "From <source_note>" pattern already used for meeting-sourced tasks), linking back to the parent.

### Testing

- `TaskEntity.composeNote`/`parseNote`: `parent_task` round-trips.
- New pure helper (name TBD at plan time, e.g. `TaskNoteView._subtaskProgressText(subtasks)`) — computes "N/M subtasks done" from a parsed-task array; pure, Node-testable.
- `TaskTodayList.buildBands`: a task with `parent_task` set is excluded from Today/Overdue, same test shape as the existing `project_slug`/meeting exclusion cases.
- `ToDoAllList`/`TaskRecurringList`: NOT excluded (positive-inclusion test).
- `TaskDialog`: new quick-add-subtask pure payload builder (mirrors `createQuick`'s existing shape, with `parent_task` stamped in) — unit-testable the same way `_payloadFromState` is.
- Manual smoke: the actual "+ Add subtask" gesture, the live subtask list rendering inside a real task note, and the progress indicator — DOM/render concerns outside the Node harness.

---

## Out of scope

- Recursive/nested subtasks beyond one level.
- Auto-completing a parent when all subtasks are done.
- An orphan-cleanup heal for subtasks whose parent was deleted (the graceful degradation described above is sufficient).
- Any change to `today-capture-editable-list.js` / `todo-create-task.js` / `todo-leaf-actions.js`'s independent raw-checkbox inline-field convention.
