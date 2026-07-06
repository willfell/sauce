# Completed Tasks View — Design Spec

**Date:** 2026-07-06  
**Blueprint:** to-do  
**Mechanism:** task-entity  

---

## Problem

When a task-entity note is marked done, it moves to `spice/tasks/_done/` and disappears from every surface. There is no way to see what was completed today, no archive view, and no search over completed tasks.

---

## Solution

Two new surfaces (Option C):

1. **Collapsed "Completed" section on the daily `Today To-Do` note** — shows tasks completed today, collapsed by default, expands on tap.
2. **New `Completed Tasks` hub note** — date-grouped archive of all completed tasks with a text search strip.

---

## Architecture

### New files

| File | Class | Location |
|------|-------|----------|
| `task-done-today-list.js` | `TaskDoneTodayList` | `platform/mechanisms/task-entity/` |
| `task-done-archive.js` | `TaskDoneArchive` | `platform/blueprints/to-do/helpers/` |
| `Completed Tasks.md` | — | `platform/blueprints/to-do/templates/` |

### Modified files

| File | Change |
|------|--------|
| `platform/blueprints/to-do/templates/Today To-Do.md` | Append `TaskDoneTodayList` widget block at bottom |

---

## Component: `TaskDoneTodayList`

**Location:** `platform/mechanisms/task-entity/task-done-today-list.js`

**Purpose:** Renders a collapsed section on the daily `Today To-Do` note listing tasks completed today.

### Behaviour

- Queries `spice/tasks/_done/` via `dv.pages('"spice/tasks/_done"')`.
- Parses each page with `TaskEntity.parseNote(page)`.
- Filters to tasks where `parsed.completed_at === todayStr` (`window.moment().format('YYYY-MM-DD')`).
- If count is 0, renders nothing (no empty toggle shown).
- If count > 0, renders a native `<details>/<summary>` element.
  - Summary text: `"Completed (N)"`.
  - Rows rendered inside `<details>` using `TaskTodayList.renderTaskRow` — checkbox pre-checked, title click opens the task note.
- No `SectionLabel` header above the `<details>` element — the summary serves as the label.
- Positioned as the last widget on the daily note template.

### Static pure helpers (Node-testable)

```
TaskDoneTodayList.filterToday(parsedTasks, todayStr) → task[]
```

- Returns tasks where `completed_at === todayStr`.
- Tolerates null/non-array input (returns `[]`).
- Never throws.

### Cold-load safety

- Resolves page via `RenderSafe.page(dv)` where needed.
- Bails quietly if `TaskEntity` or `TaskTodayList` not yet registered.
- Dual-fire-safe via `__renderGen` counter pattern.

---

## Component: `TaskDoneArchive`

**Location:** `platform/blueprints/to-do/helpers/task-done-archive.js`

**Purpose:** Renders a date-grouped, searchable archive of all completed tasks on the `Completed Tasks` hub note.

### Behaviour

- Queries all of `spice/tasks/_done/`.
- Parses each page with `TaskEntity.parseNote(page)`.
- Default view (no filter): groups tasks into a `Map<dateStr, task[]>` sorted desc (newest date first).
- Each date group: `SectionLabel` with human-readable date (`moment(dateStr).format('MMM D, YYYY')`), then task rows using `TaskTodayList.renderTaskRow` (checked checkbox, title opens note).
- Tasks with `null` `completed_at` are dropped.
- If `_done/` is empty: renders `"No completed tasks yet."`.

### Search

- `DocSearch` strip at the top (`hideTags: true`, `persist: false`, `hideNativeSearch: true`).
- When a filter is active: flatten all tasks, filter by `title.toLowerCase().includes(filterText.toLowerCase())`, re-group matching tasks by date (empty date groups dropped).
- No results: renders `"No completed tasks match."` in the results container.

### Static pure helpers (Node-testable)

```
TaskDoneArchive.groupByDate(parsedTasks) → Map<dateStr, task[]>
  - Keys sorted desc.
  - Drops tasks with null completed_at.
  - Tolerates null/non-array input.

TaskDoneArchive.filterByText(parsedTasks, text) → task[]
  - Case-insensitive title match.
  - Empty/blank text returns all tasks.
  - Tolerates null/non-array input.
```

### Cold-load safety

Same pattern as `TaskDoneTodayList`.

---

## Template: `Completed Tasks.md`

```
type: to-do-hub
cssclasses: [wide]
```

Chrome:
1. `SpaceNavButtons`
2. `ToDoHubActions`
3. `TaskDoneArchive` widget

---

## Template patch: `Today To-Do.md`

Append at the bottom:

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TaskDoneTodayList" });
```

---

## Row display

Both surfaces use `TaskTodayList.renderTaskRow` unmodified:
- Checkbox pre-checked (same visual as open tasks, no greying or strikethrough).
- Title click opens the task note via `app.workspace.openLinkText`.
- Edit/delete icons remain visible (task notes are still editable after completion).

---

## Testing

Added to the existing `platform/test/run-task-entity.js` harness. No new test runner.

### `TaskDoneTodayList` suite (`TDTL-*`)

| ID | Test |
|----|------|
| TDTL-1 | `filterToday` returns tasks where `completed_at === todayStr` |
| TDTL-2 | `filterToday` excludes tasks completed on other dates |
| TDTL-3 | `filterToday` excludes tasks with `null` `completed_at` |
| TDTL-4 | `filterToday` returns `[]` on null/empty input |

### `TaskDoneArchive` suite (`TDARCH-*`)

| ID | Test |
|----|------|
| TDARCH-1 | `groupByDate` groups tasks by `completed_at`, sorted desc |
| TDARCH-2 | `groupByDate` drops tasks with `null` `completed_at` |
| TDARCH-3 | `groupByDate` returns empty Map on null/empty input |
| TDARCH-4 | `filterByText` returns tasks whose title includes text (case-insensitive) |
| TDARCH-5 | `filterByText` returns all tasks when text is empty/blank |
| TDARCH-6 | `filterByText` returns `[]` when no titles match |

---

## Out of scope

- Date range filtering on the archive (text search only for v1).
- Undoing completion (restoring a task from `_done/` back to `spice/tasks/`).
- Grouping by project on the archive (date grouping only for v1).
