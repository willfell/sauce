# Subtask Completion Bug Fix + Subtask Progress Badges — Design Spec

**Date:** 2026-07-11
**Blueprint:** to-do
**Mechanism:** task-entity

---

## Problem

**Bug:** In `spice/tasks/<Parent>` (e.g. Groceries), marking a subtask Done in the parent task's SUBTASKS section leaves the checkbox visibly re-appearing unchecked, and clicking it again throws a "task file not found" error.

**Root cause:** `TaskNoteView`'s SUBTASKS query (`task-note-view.js`) fetches every child task whose `parent_task` points at the current note, but — unlike every other task surface (daily, project, meeting lists) — it does **not** filter to `status === 'open'`. Sequence:

1. User clicks Done on a subtask row → `TaskDialog.markDone(path)` writes `status: done` and moves the file to `spice/tasks/_done/`.
2. Obsidian's Dataview auto-refresh re-renders the parent task's card (any vault write triggers this for all active DataviewJS views).
3. The SUBTASKS query re-runs with no status filter, so the just-completed subtask (still under `spice/tasks/`) is fetched again and re-rendered as an unchecked open row.
4. Clicking it a second time calls `markDone` on the stale original path, which no longer exists (file already moved) → `{ ok: false, reason: 'task file not found' }` → error Notice.

**Feature request:** Surface subtask progress ("N/M subtasks done") as a badge on the parent task's row wherever task rows render — not just inside the parent task's own note.

---

## Solution

### 1. Bug fix — `task-note-view.js` SUBTASKS query

Split the query result into two:
- `allSubtasks` (open + done, excludes `_trash/`) — unchanged, used for `_subtaskProgressText`'s N/M count.
- `openSubtasks = allSubtasks.filter(t => t.status === 'open')` — **new**, used for the rendered checkbox rows.

Only `openSubtasks` is passed to the `TTL.renderTaskRow` loop. This matches the `status === 'open'` filtering convention already used by the daily builder, `TaskProjectList`, and `TaskMeetingList`. One-line query filter (mirrors the other surfaces' `if (p.status !== 'open') return false;`) + a variable split. No schema change, no migration.

### 2. Centralized subtask-count helper — `TaskEntity.subtaskCountsByParent(dv)`

New static method on `TaskEntity` (`task-entity.js`):

```
TaskEntity.subtaskCountsByParent(dv) → { [parentBasename]: { done, total } }
```

- One query over `spice/tasks` (excludes `_trash/`, mirrors the bug-fix exclusion convention).
- Groups children by `parent_task` (resolved via `TaskEntity._linkText`, same as the existing SUBTASKS query).
- For each parent basename with ≥1 child: `total` = all non-trashed children, `done` = children with `status === 'done'`.
- Parents with zero children are simply absent from the returned map (no zero-entries).
- Pure aside from the `dv` query call; tolerates missing/malformed pages (never throws).

This becomes the single implementation of "how do we count a task's subtasks" — replacing the inline query currently duplicated only in `task-note-view.js`, and preventing the bug's root cause (a second inline copy drifting out of the `status==='open'` convention) from recurring elsewhere.

### 3. Row rendering — new chip in `TaskTodayList.renderTaskRow`

`renderTaskRow` stays dependency-free (no `dv` access — callers attach data before calling it, per its existing design). Callers set `task.subtask_count = counts[basename] || null` before invoking it.

In the chip row (alongside project/priority/due), when `task.subtask_count` is present and `total > 0`, render one more chip: `"{done}/{total} subtasks"`. No chip when a task has no subtasks (the common case).

### 4. Wiring — each call site computes counts once per render

All render call sites that build task lists and call `renderTaskRow` call `TaskEntity.subtaskCountsByParent(dv)` once at the top of their render, then attach the per-task count before the row loop:

- Daily builder (`task-today-list.js` — wherever `buildBands`/`queryToday` assembles rows)
- `TaskProjectList` (`task-project-list.js`)
- `TaskMeetingList` (`task-meeting-list.js`)
- `TaskNoteView`'s own SUBTASKS section (`task-note-view.js`) — also switches its progress-text computation to read from the same helper's counts (for this one parent) instead of its own inline `allSubtasks` count, so there is exactly one counting implementation in the codebase.

---

## Architecture

### Modified files

| File | Change |
|------|--------|
| `platform/mechanisms/task-entity/task-note-view.js` | Bug fix: split `allSubtasks`/`openSubtasks`, filter rendered rows to open only. Switch progress-text count to use the new helper. |
| `platform/mechanisms/task-entity/task-entity.js` | New static `TaskEntity.subtaskCountsByParent(dv)`. |
| `platform/mechanisms/task-entity/task-today-list.js` | `renderTaskRow` gains the subtask-count chip; daily row-building call site computes + attaches counts. |
| `platform/mechanisms/task-entity/task-project-list.js` | Computes + attaches counts before its `renderTaskRow` loop. |
| `platform/mechanisms/task-entity/task-meeting-list.js` | Computes + attaches counts before its `renderTaskRow` loop. |

No new files, no frontmatter/schema changes, no migration.

---

## Testing

Extended in the existing `platform/test/run-task-entity.js` harness (no new test runner).

| ID | Test |
|----|------|
| TN-SUB-1 | SUBTASKS section renders only `status === 'open'` children as rows (regression test for the bug) |
| TN-SUB-2 | Progress text (`_subtaskProgressText` equivalent count) still includes done children even though rows exclude them |
| SCP-1 | `subtaskCountsByParent` groups children by `parent_task` and counts `done`/`total` correctly |
| SCP-2 | `subtaskCountsByParent` excludes `_trash/` children from both counts |
| SCP-3 | `subtaskCountsByParent` returns `{}` when no tasks have children (no zero-entries for childless parents) |
| SCP-4 | `subtaskCountsByParent` tolerates null/malformed pages without throwing |
| RTR-SUB-1 | `renderTaskRow` renders the "{done}/{total} subtasks" chip when `task.subtask_count.total > 0` |
| RTR-SUB-2 | `renderTaskRow` renders no subtask chip when `task.subtask_count` is absent or `total === 0` |

---

## Out of scope

- Sub-subtasks / nesting beyond one level (existing design constraint, unchanged).
- Any visual redesign of the chip row beyond adding one more chip in the existing style.
- Making the subtask-count badge clickable/navigable (it's a read-only indicator).
- Retroactively backfilling or migrating any existing task notes (no schema change).
