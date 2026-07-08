# Recurring Tasks — Design Spec

**Date:** 2026-07-08
**Blueprint:** to-do
**Mechanism:** task-entity

---

## Problem

User complaint (verbatim): "Recurring tasks are, I believe not working anymore. The form for making a task isn't showing it, and there should be."

Deferred out of the 2026-07-08 to-do bug-fix cycle (see `2026-07-08-todo-blueprint-bug-fixes-design.md` § Out of scope) as needing its own design session.

---

## Root cause (confirmed live, in accuris-sauce / ero-sauce / headspace-sauce)

Recurring tasks are a completely separate system from the note-per-task model, and it predates it:

- `spice/to-do/Recurring Tasks.md` is a raw-markdown registry: `- [ ] Title [recurrence:: every X] [project:: [[Name]]] [priority:: high]`.
- `ToDoDailyRecurring.render()` (v0.8.0, live-render, no writes) reads that registry on every daily-note render and draws matching entries as plain, non-interactive rows directly into the daily note. They never become `spice/tasks/*.md` notes, so they're invisible to Completed Tasks, All-ToDos, project views, and the Home dashboard counts.
- `TaskDialog` (`platform/mechanisms/task-entity/task-dialog.js`) has zero recurrence-related code. The "+ New Task" dialog has no path to recurrence at all — the only recurrence entry point is a "Recurring" nav button that just opens the raw registry file for manual markdown editing (a deliberate v0.120.0 decision, per an inline comment, that the dialog round-trip "added friction without value" — made before the note-per-task migration existed).
- **Compounding bug found live:** `ToDoDailyRecurring.parseRegistryLine` only matches unchecked lines (`^- \[ \] `). The v0.8.0 daily-note row has no completion affordance at all (its `onclick` just navigates to the registry page) — so a user who checks a registry line off, expecting to mark "today done," instead **permanently kills that recurring entry** (the parser stops seeing it, forever). headspace's live registry has exactly this: "Pay Rent" and "Feed the dogs" are both checked off and therefore dead.

---

## Design

Retire the registry system. Recurrence becomes a first-class field on the existing note-per-task model, using a **rolling single note** per recurring task (not one note spawned per occurrence): completing it doesn't archive it, it advances `scheduled` to the next matching date and clears `completed_at`. No file proliferation; matches how Things/Todoist-style recurring tasks behave. Trade-off accepted: no per-occurrence completion history for a recurring task (only its current state is visible) — the same trade-off the current registry already has.

### 1. Data model — `TaskEntity`

New frontmatter key `recurrence` (string, empty when absent, same convention as `scheduled`/`due`), inserted into the canonical schema right after `due`:

```
type, title, status, scheduled, due, recurrence, priority, project, project_slug, source, source_note, links, created_at, completed_at
```

- `TaskEntity.composeNote` — accepts `payload.recurrence`, emits `recurrence: p.recurrence || ''`.
- `TaskEntity.parseNote` — `recurrence: p.recurrence || ''` (matches the `priority` field's empty-string convention, not `blankToNull`).
- Anchor date for the "every N weeks on X" recurrence family is the task's own `created_at` (already exists on every task note) — no new anchor field needed.
- New pure helper `TaskEntity.nextOccurrence(recurrence, fromDateStr, anchorDateStr)`: walks forward day-by-day starting at `fromDateStr + 1`, calling `RecurrenceParser.matches` (injected, not a hard dependency — see below) against a capped horizon (400 days, mirroring the existing `_uniqueName` collision-loop cap pattern) and returns the first matching `YYYY-MM-DD`, or `null` if the grammar is unsupported/never matches within the horizon.

`TaskEntity` stays free of a hard dependency on `RecurrenceParser` (the "pure core" the class's own header comment describes) — `nextOccurrence` takes a `matchesFn(dateStr) -> boolean` predicate as a parameter; the browser-side caller (`TaskDialog`) closes over `window.customJS.RecurrenceParser.matches` when calling it. `TaskEntity.validatePayload` does NOT validate recurrence grammar (stays a pure string field there) — grammar validation is a `TaskDialog`-side, browser-only concern (see below), matching where the equivalent check already lives today (`RecurrenceParser.isSupported`, consumed defensively via `window.customJS`).

### 2. Completion behavior — `TaskDialog`

The "done" action branches on the task's `recurrence`:

- **Recurring** (`recurrence` non-empty): compute the next occurrence via `TaskEntity.nextOccurrence(recurrence, todayStr, createdAtDateStr, matchesFn)`, where `todayStr` is the actual current date (not the task's `scheduled`) — so a late completion rolls forward from *today*, not from the stale scheduled date, avoiding a pile-up of backlogged occurrences after a gap. `processFrontMatter` sets `scheduled` to the computed date and clears `completed_at`; `status` stays `open`; the file is never renamed/archived.
- **Non-recurring**: unchanged — `status: done`, stamp `completed_at`, rename into `_done/`.

Deleting a recurring task deletes the whole series (existing delete path, unchanged) — there is no per-occurrence delete in the rolling model.

### 3. Dialog UI — `TaskDialog`

One new free-text field (not a tab) on both Create and Edit forms, labeled to match the existing registry grammar (e.g. "every day", "every Monday", "every 2 weeks on Friday"). Validated live against `window.customJS.RecurrenceParser.isSupported(value)` (defensive — a missing/throwing parser instance does not block submit, mirroring `ToDoDailyRecurring`'s existing defensive pattern); a non-empty, unsupported value shows an inline error and blocks submit. Empty is always valid (no recurrence).

Editable both directions: clearing the field on an existing recurring task turns it back into a normal one-shot task (next "done" archives to `_done/` as usual); adding it to an existing one-shot task makes it start rolling on next completion.

### 4. Visual indicator — shared `renderTaskRow`

A small repeat-icon badge next to the title, shown whenever `task.recurrence` is truthy, using the same visual language as the existing priority pill. Since `renderTaskRow` is shared across `TaskTodayList`, `TaskProjectList`, and `TaskMeetingList`, this one change covers Today/Overdue/project/meeting surfaces.

### 5. Recurring index page

The "Recurring" nav button (`ToDoChromeBar` dispatch id `"recurring"`) stops opening the raw registry file. It now opens a new live query view, `spice/to-do/Recurring.md`, listing every open task with `recurrence` set (queried from `spice/tasks/`, excluding `_trash/`), sorted by `scheduled` ascending. Each row opens its real task note (reuses `renderTaskRow`). No manual-editing surface remains — this is a read-only index, matching `All-ToDos.md`'s existing pattern.

The legacy `spice/to-do/Recurring Tasks.md` file is left in place, untouched, after migration (passive backup — not deleted, not auto-emptied). `ToDoDailyRecurring`'s live-render-into-daily-note code path is retired (no longer invoked from the daily template); the class's static parse/materialize helpers stay in the codebase for migration-heal reuse (see below) and existing harness regression coverage — consistent with how prior cycles have kept "backwards-compat shim" methods around rather than deleting working, tested code.

### 6. Migration heal

A new install-time heal (naming TBD at plan time, following the `apply<X>Heal` convention) runs per consumer vault:

1. Read `spice/to-do/Recurring Tasks.md` if present.
2. Parse registry lines using an adapted form of `ToDoDailyRecurring.parseRegistryLine`'s grammar (`- [ ] Title [recurrence:: ...] [project:: [[...]]] [priority:: ...]`), **extended to also match checked lines** (`- [x] ...`) — checking a line off was almost certainly the user attempting (and failing) to mark a day done under the old broken UI, not an intentional deactivation, so both forms are treated as "migrate this."
3. For each valid, supported-grammar entry not already migrated (idempotency key: same title + recurrence already present as a `spice/tasks/*.md` task), create a rolling task note via `TaskEntity.composeNote` with `recurrence` set, `scheduled` computed via `TaskEntity.nextOccurrence` from today forward (so a freshly-migrated task doesn't land already-overdue), carrying over `project`/`priority` where present.
4. Never write to or delete the original registry file — it stays as an inert backup.
5. Never-throws, failure-loud history entry per the installer's existing safety-mechanic conventions (additive, idempotent, logged).

This heal, run once per vault at the version bump that ships this feature, brings accuris's and headspace's real registry entries (including headspace's checked-off "Pay Rent" / "Feed the dogs") back to life as working recurring tasks. ero's empty registry is a no-op.

---

## Testing

Follows the existing Node-test harness pattern (`platform/test/run-task-entity.js` and siblings):

- `TaskEntity.nextOccurrence`: cases for each `RecurrenceParser` grammar family (daily, weekday-set, weekday/weekend block, day-of-month, every-N-weeks-on-day with an anchor), including the "late completion rolls from today, not from the stale scheduled date" case, and the "unsupported grammar / never matches within horizon → null" case.
- `TaskEntity.composeNote`/`parseNote`: recurrence field round-trips.
- `TaskDialog` done-action branch: a DOM-stub test asserting a recurring task's frontmatter after "done" (scheduled advanced, completed_at cleared, status still open, no rename) vs. a non-recurring task's (unchanged existing behavior).
- `TaskDialog` recurrence field validation: supported/unsupported grammar cases, empty-is-valid case.
- `renderTaskRow`: badge renders iff `recurrence` is truthy.
- Recurring index view: pure selector test (filter to open + recurrence-set, sort by scheduled).
- Migration heal: a fixture-driven test against the exact live registry shapes found in accuris/ero/headspace (including the checked-off headspace lines), asserting idempotency (running twice produces the same task notes, no duplicates) and that the original registry file is untouched.

---

## Out of scope

- Subtasks within a task note — separate design spec (`2026-07-08-subtasks-design.md`).
- Per-occurrence history/audit for recurring tasks (accepted trade-off of the rolling-single-note model).
- A structured (non-text) recurrence picker UI — deferred; free-text grammar reuses the existing parser as-is.
