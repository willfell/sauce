# To-Do Blueprint Enhancements — Design Spec

**Date:** 2026-07-13
**Blueprint:** to-do
**Mechanism:** task-entity

---

## Problem

Six issues surfaced from daily use of the note-per-task to-do system:

1. **Priority-based ordering** — tasks render in arbitrary order within Today/Overdue bands; users want highest-priority tasks at the top. Undated tasks (created without a due date) are silently dropped from the daily view entirely.
2. **Trip tasks missing from the daily** — a task created from a trip's To-Do section (e.g. "Pack for Trip" in headspace) carries `trip_slug` frontmatter but never appears on the daily note. No trip-groups section exists (unlike the project-groups section).
3. **Recurring tasks section positioning** — the registry-based Recurring section is already correctly positioned under Today. No code change needed (confirmed with user).
4. **Ellipsis menu → inline icons** — the `⋯` dot-menu (via MenuPopover) should be replaced with two always-visible icons: wrench (edit) + trash (delete).
5. **Duplicate dividers at section boundaries** — `renderTaskRow`'s per-row `border-bottom` stacks with `SectionLabel.render()`'s leading `<hr>`, creating a double hairline at every section boundary.
6. **Task note improvements** — (a) no Done button on the task note itself; (b) two literal `---` separators in the task note chrome body are redundant.

---

## Root causes

### 1. Priority ordering + undated task drop

`TaskTodayList.buildBands` (`task-today-list.js`, line 93) has `if (!due) continue;` which drops every undated task from both bands. The sort within each band is due-date ascending only — no priority dimension exists.

### 2. Trip tasks invisible

Two compounding issues:
- `buildBands` excludes `project_slug` and `source==='meeting'` but has no `trip_slug` exclusion, so trip tasks with a due date would mix into Today/Overdue rather than their own section.
- The `!due` gate (root cause 1) drops trip tasks created without a due date (e.g. "Pack for Trip" has `due: ""`).
- No `ToDoDailyTripGroups` widget exists to render trip tasks in their own section.

### 3. Recurring — no change needed

`ToDoDailyRecurring` already renders directly under Today in the template. Confirmed: no code change required.

### 4. Dot-menu vs inline icons

`renderTaskRow` (line 418) branches on `hasPopover` — when `MenuPopover` is registered, it renders a single `⋯` button opening a popover (Open note / Edit / Delete). The legacy fallback renders two inline icons (pencil + trash). The user wants the two-icon pattern always, with wrench replacing pencil.

### 5. Double dividers

`renderTaskRow` row styling (line 284) includes `border-bottom: 1px solid var(--background-modifier-border-hover)`. Every section widget calls `SectionLabel.render(dv, { text })` without `top: true`, which draws a leading `<hr>`. At section boundaries the last row's border-bottom and the next section's `<hr>` stack into two visible hairlines.

### 6a. No Done button on TaskNoteView

`TaskNoteView.render()` (line 728-753) ends with a single full-width "Edit task" button. No mechanism to mark done without navigating away.

### 6b. Redundant `---` in task note chrome

`TaskEntity._chromeBody()` (line 272-287) and its fallback copy `TaskDialog._chromeBody()` (line 1599-1618) both emit:

```
TaskChromeBar block
---
TaskNoteView block
---
<!-- TASK_NOTES -->
```

The two `---` lines create redundant visual separators since TaskNoteView's card already handles its own spacing.

---

## Fixes

### Fix A — Priority sort + undated task inclusion

**File:** `platform/mechanisms/task-entity/task-today-list.js` — `buildBands` method.

1. Remove the `if (!due) continue;` gate (line 93). Undated tasks enter the Today band.
2. Add a priority rank map as a static or local constant:
   ```javascript
   const PRIO_RANK = { highest: 4, high: 3, medium: 2, low: 1 };
   // unset/empty → 0
   ```
3. Sort both bands: priority descending (highest first), then due-date ascending (undated last within same priority tier), then title alphabetically as tiebreaker.

**Migration:** None — rendering-only.

### Fix B — Trip tasks on the daily

**Files:**
- `platform/mechanisms/task-entity/task-today-list.js` — add `trip_slug` exclusion to `buildBands` (line 89-91, symmetric with `project_slug`).
- New `platform/blueprints/to-do/helpers/todo-daily-trip-groups.js` — mirrors `ToDoDailyUnassignedMeetings` pattern:
  - Queries `spice/tasks` for open tasks where `trip_slug` is set and `project_slug` is not set.
  - Groups by trip name (from `trip` frontmatter field).
  - Renders `SectionLabel.render(dv, { text: '<Trip Name> Tasks' })` per trip.
  - Renders `TaskTodayList.renderTaskRow(container, task, TD)` per task within each group.
- `platform/blueprints/to-do/templates/Today To-Do.md` — insert `ToDoDailyTripGroups` block after `ToDoDailyProjectGroups` and before `ToDoDailyUnassignedMeetings`.
- Blueprint manifest — register `ToDoDailyTripGroups` in `customjs_classes`.

**Migration:** `applyTodoDailyTripGroupsHeal` — scans existing daily notes (`spice/to-do/`) for the `ToDoDailyProjectGroups` sentinel, inserts the `ToDoDailyTripGroups` dataviewjs block after it when absent. Idempotent, backup-guarded, never-throw. Gated on trips blueprint being installed (presence of `TripSectionKinds` in manifest dependencies or a runtime check).

### Fix C — Recurring tasks

No change. The registry-based `ToDoDailyRecurring` section is already correctly positioned under Today in the daily template.

### Fix D — Inline wrench + trash icons

**File:** `platform/mechanisms/task-entity/task-today-list.js` — `renderTaskRow` action section (lines 418-511).

1. Remove the `hasPopover` branching entirely. Delete the MenuPopover code path.
2. Always render two inline icon buttons:
   - **Wrench** (edit): new SVG icon. Click calls `doEdit()` (opens `TaskDialog.open({ edit: path })`).
   - **Trash** (delete): existing `ICON.trash` SVG. Click calls `doDelete()` (calls `TaskDialog.confirmDelete(path)`).
3. Add the wrench SVG to the `ICON` constants block (lines 437-441). Replace the existing `edit` (pencil) entry with a wrench path.

**Migration:** None — rendering-only.

### Fix E — Remove per-row border-bottom

**File:** `platform/mechanisms/task-entity/task-today-list.js` — `renderTaskRow` row styling (line 284).

Remove `border-bottom: 1px solid var(--background-modifier-border-hover)` from the row's `style.cssText`. The `SectionLabel.render()` leading `<hr>` already provides visual separation between sections. Within a section, rows are visually distinct via padding and the card-like structure.

**Migration:** None — rendering-only.

### Fix F.1 — Done button on TaskNoteView

**File:** `platform/mechanisms/task-entity/task-note-view.js` — `render()` method, before the "Edit task" button block (line 728).

1. Add a "Mark done" button: full-width, green accent (`--color-green` background, white text), same sizing as "Edit task".
2. Click handler: calls `TaskDialog.markDone(filePath)`, then triggers `dataview:dataview-force-refresh-views` to re-render the card (pill flips to DONE, button hides).
3. Visibility: hidden when `status === 'done'` or `status === 'deleted'`. Only renders for open tasks.

**Migration:** None — rendering-only.

### Fix F.2 — Remove `---` from task note chrome body

**Files:**
- `platform/mechanisms/task-entity/task-entity.js` — `_chromeBody()` (line 272-287): remove both `'---\n'` lines.
- `platform/mechanisms/task-entity/task-dialog.js` — `_chromeBody()` (line 1599-1618): same removal (fallback copy).

**New chrome body (both locations):**
```javascript
static _chromeBody() {
    return '\n' +
        '```dataviewjs\n' +
        'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });\n' +
        '```\n' +
        '\n' +
        '```dataviewjs\n' +
        'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
        '```\n' +
        '\n' +
        '<!-- TASK_NOTES -->\n';
}
```

**Migration:** `applyTaskNoteChromeHeal` — scans `spice/tasks/*.md` (excluding `_trash/`, `_done/`), strips the two `---` lines:
- Pattern 1: `\n---\n\n```dataviewjs` → `\n\n```dataviewjs`
- Pattern 2: ````\n\n---\n\n<!-- TASK_NOTES -->` → ````\n\n<!-- TASK_NOTES -->`
Idempotent (second pass = no-op), backup to `.sauce-backup/tasks/<ts>/`, never-throw, per-file try/catch, counted in install history.

---

## Daily template section order (post-changes)

```
ToDoChromeBar
SectionLabel "Today" (top: true)
TaskTodayList                       ← priority-sorted, includes undated tasks
ToDoDailyRecurring                  ← registry-based recurring (unchanged)
ToDoDailyProjectGroups              ← per-project task buckets
ToDoDailyTripGroups                 ← NEW: per-trip task buckets
ToDoDailyUnassignedMeetings         ← unassigned meeting tasks
TaskDoneTodayList                   ← completed today
```

---

## Migration summary

| Fix | Migration | Type | Heal name |
|-----|-----------|------|-----------|
| A | No | Render-only | — |
| B | Yes | Insert dataviewjs block into existing dailies | `applyTodoDailyTripGroupsHeal` |
| C | No | No change | — |
| D | No | Render-only | — |
| E | No | Render-only | — |
| F.1 | No | Render-only | — |
| F.2 | Yes | Strip `---` from existing task notes | `applyTaskNoteChromeHeal` |

Both heals follow standard conventions: idempotent, backup-guarded, never-throw, counted in install history.

---

## Testing

All fixes land inside existing Node-test harness patterns:

- **Fix A:** `buildBands` cases asserting priority ordering within bands, undated tasks in Today band, correct sort (priority desc → due asc → title).
- **Fix B:** `buildBands` trip_slug exclusion test; `ToDoDailyTripGroups` rendering test with trip-bucketed tasks.
- **Fix D:** DOM-stub test asserting two action buttons (wrench + trash), no dot-menu/popover.
- **Fix E:** DOM-stub asserting no `border-bottom` on rendered rows.
- **Fix F.1:** DOM-stub asserting "Mark done" button renders for open tasks, hidden for done/deleted.
- **Fix F.2:** `_chromeBody()` output assertions (no `---`); heal idempotency test (second pass = zero writes).

---

## Out of scope

- **Recurrence-flagged task-note segregation** — individual task notes with `recurrence` frontmatter stay in their normal band (Today/Overdue/Project/Trip). Pulling them into a separate recurring-notes section is a separate design.
- **Subtasks** — creating/editing child tasks from within a parent is already functional; no changes in this cycle.
