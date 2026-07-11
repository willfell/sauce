# Task Note Chrome + Completed-Subtask History — Design Spec

**Date:** 2026-07-11
**Blueprint:** to-do
**Mechanism:** task-entity

---

## Problem

Two gaps reported by the user after the subtask-progress-fix cycle shipped, both observed on `spice/tasks/Groceries` (and its subtask `spice/tasks/tmp-subtask`):

1. **No visibility into completed subtasks.** The SUBTASKS section (fixed last cycle to only render `status === 'open'` children) now correctly stops showing done subtasks as open rows — but that means there's no way to see *what's already been done* on a task, only what's still open. There's no history.

2. **No breadcrumb / nav-button chrome on task notes.** Every other adopted-blueprint note (the daily `to-do` note, meetings, sticky-notes, wiki, project, trips, reader, people, etc.) renders the shared `<Blueprint>ChromeBar` bar (breadcrumb left, `Go ▾` / primary / `⋯` right) via `platform/mechanisms/chrome-bar/`. Task notes (`type: task`) — both top-level tasks like `Groceries` and subtasks like `tmp-subtask` — still carry the OLD, pre-ChromeBar chrome: a bare `SpaceNavButtons` block with no breadcrumb at all. This is the one `type:`-based note surface left un-migrated.

---

## Solution

### 1. Completed-subtask history — collapsible "Completed" list

In `TaskNoteView`'s SUBTASKS section (`platform/mechanisms/task-entity/task-note-view.js`), after the existing open-subtask row list and the `+ Add subtask` input, add a collapsible `<details>` block (mirrors the existing `TaskDoneTodayList` convention — same open-by-default `<details>`/`<summary>` shape, same "reuse `TaskTodayList.renderTaskRow` then pre-check the checkbox via `querySelector` afterward" technique) listing every subtask in `allSubtasks` (the already-fetched, unfiltered list — open + done, excludes `_trash/`) whose `status === 'done'`. Summary text: `Completed (N)`. Rendered only when there is at least one done subtask (no empty "Completed (0)" clutter). Each row: title click still opens that subtask's note; the checkbox is pre-checked but functionally identical to `TaskDoneTodayList`'s rows (clicking it again is the same pre-existing edge case that already exists there — out of scope to change here).

### 2. Task-note chrome — adopt the shared ChromeBar + breadcrumb

**New helper — `TaskChromeBar`** (`platform/mechanisms/task-entity/task-chrome-bar.js`), built via `customJS.ChromeBar.makeAdapter(config)` (the same factory every other blueprint's `<X>ChromeBar` uses). Task notes are pure leaf entities — no primary action (creation happens via the daily's "+ New Task" / the SUBTASKS section's own "+ Add subtask" input, editing via the card's own "Edit task" button) and no overflow menu. Config: `detect` matches `page.type === 'task'`; `surfaceSpec` returns `{ primary: null, overflow: [], leaf: true }`; `dispatch` is a no-op; `destinations` returns `[]` (no "This task" cross-links — the card's own SOURCE/Part-of/SUBTASKS sections already cover all task-to-task navigation); `rootClass`/`btnClass` follow the `task-chrome-*` naming convention every sibling adapter uses.

**Breadcrumb declaration** — `task-entity`'s `manifest.json` gains a `breadcrumb.types.task` block:
```json
"task": {
  "ancestors": [
    { "label": "lit:To-Do" },
    { "when": { "fm:parent_task": "present" }, "label": "fm:parent_task", "link": "spice/tasks/{fm:parent_task}.md" }
  ],
  "current": { "label": "fm:title|file:basename" }
}
```
A top-level task (`Groceries`) renders `To-Do / Groceries`. A subtask (`tmp-subtask`, `parent_task: [[Groceries]]`) renders `To-Do / Groceries / tmp-subtask` — the conditional ancestor only appears when `parent_task` is set (mirrors trips' `trip-section` → `trip` ancestor pattern exactly).

**New-note wiring** — `TaskEntity._chromeBody()` (`platform/mechanisms/task-entity/task-entity.js`) swaps its bare `SpaceNavButtons` dataviewjs block for a `TaskChromeBar` block. `ChromeBar.render` renders the breadcrumb itself (reading the registry entry above), so no separate `Breadcrumb` block is needed. Every task note created from this point forward (including subtasks, created via `TaskDialog.createQuick({..., parent_task})` from the SUBTASKS section's inline input) gets correct chrome automatically.

**Existing-note heal** — task notes are `type:`-keyed (not tag-based), so the EXISTING generic heal machinery in `platform/install.js` covers them with three small additions, reusing 100% of the already-shipped `_healChromeBarMigration` transform (no new bespoke heal function):
- `"spice/tasks"` added to `applyNoteChromeHeal`'s `roots` array.
- `"task"` added to the type-allowlist that gates which notes the heal touches.
- `"task": "TaskChromeBar"` added to `_healNoteChromeBody`'s `CHROME_BAR_MAP`.

This is the same idiomatic path every prior ChromeBar-adoption cycle (to-do, meetings, wiki, trips, reader, people, products, teams, journal, boards, finance) took — no new heal function, just three additions to existing generic tables. `.sauce-backup` snapshot before write, idempotent (`_healChromeBarMigration` short-circuits when `TaskChromeBar` is already present), never throws — inherited for free from the shared function.

**Manifest dependency** — `task-entity`'s `manifest.json` adds `depends_on` entries for `chrome-bar` (`>=0.3.0`) and `breadcrumb` (`>=0.1.0`), matching the ranges `to-do` already declares for the same mechanisms. Both are already subscribed in all three consumer vaults (transitively required by `to-do`), so no consumer subscription-file edits are needed.

---

## Architecture

### New files

| File | Class | Location |
|------|-------|----------|
| `task-chrome-bar.js` | `TaskChromeBar` | `platform/mechanisms/task-entity/` |

### Modified files

| File | Change |
|------|--------|
| `platform/mechanisms/task-entity/task-note-view.js` | Adds the collapsible "Completed" subtask history section. |
| `platform/mechanisms/task-entity/task-entity.js` | `_chromeBody()` swaps `SpaceNavButtons` → `TaskChromeBar`. |
| `platform/mechanisms/task-entity/manifest.json` | New `customjs_classes` entry, new `depends_on` entries (chrome-bar, breadcrumb), new `breadcrumb.types.task` block. |
| `platform/install.js` | `applyNoteChromeHeal`'s `roots` + type-allowlist + `_healNoteChromeBody`'s `CHROME_BAR_MAP` each gain a `task` entry. |

No frontmatter/schema changes, no new note types, no migration beyond the existing generic chrome heal picking up `spice/tasks/`.

---

## Testing

Extended in the existing `platform/test/run-task-entity.js` harness, plus `platform/test/run-install-sh.js`/the install-heal test surface where `_healChromeBarMigration`/`applyNoteChromeHeal` already have coverage.

| ID | Test |
|----|------|
| TNV-DONE-1 | SUBTASKS section renders a "Completed (N)" details block listing only `status === 'done'` subtasks, each row's checkbox pre-checked |
| TNV-DONE-2 | No "Completed" block rendered when there are zero done subtasks |
| TCB-1 | `TaskChromeBar._config().detect` matches `type: 'task'` pages, returns `null` for others |
| TCB-2 | `surfaceSpec()` returns `{ primary: null, overflow: [], leaf: true }` |
| TCB-3 | `destinations()` returns `[]` |
| INST-HEAL-TASK-1 | `_healChromeBarMigration` applied with `type: "task"`, `barClass: "TaskChromeBar"` strips a `SpaceNavButtons` block and inserts `TaskChromeBar` right after frontmatter (reusing the existing pure-function test pattern already used for `"meeting"`/`"to-do"` in this harness) |
| INST-HEAL-TASK-2 | The heal is idempotent — a body already containing `TaskChromeBar` is returned unchanged |

---

## Out of scope

- Any primary/overflow action on `TaskChromeBar` (e.g. a "+ New Task" button) — task creation stays where it already lives (daily nav button, SUBTASKS inline input).
- Un-checking / un-completing a subtask from the "Completed" history list (same pre-existing `TaskDoneTodayList` limitation, not addressed here).
- Sub-subtasks / nesting beyond one level (existing design constraint, unchanged).
- Rule-4 (`no literal --- between chrome blocks`) conformance for task notes — task-entity keeps its existing `---`-separated ChromeBar/TaskNoteView shape; that lint rule is currently scoped to the `project` blueprint only.
