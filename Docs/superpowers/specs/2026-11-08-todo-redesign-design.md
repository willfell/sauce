# To-Do redesign: create, sort, reschedule, and find what's done

Status: approved direction (design canvas reviewed 2026-11-08); this document fixes the details.
Canvas: https://claude.ai/artifact/LQrmXpdQP1Gf3u2HpwnzQD (top row = current, bottom row = proposed).

## Why

The to-do blueprint is the most-used surface in the consumer vaults. Usage in the accuris vault
(272 task notes: 236 done, 24 trashed, 17 open) shows where it rubs:

- `due` is the do-date. `scheduled` is set on 0 of 272 tasks and the dialog never exposes it.
  10 of 17 open tasks sit on the same Monday: work is pushed to "next Monday" one task at a time
  through Edit → date picker → Save.
- Tasks are dossiers. 12 of 17 open tasks carry 3–50 KB of notes below `<!-- TASK_NOTES -->`;
  opening the note is the primary action, yet rows give no hint a note has content.
- Sorting collapses to A–Z: 80% of tasks have no priority, 63% no project, and there is no manual
  order.
- Stale work never leaves: three tasks are 84–118 days overdue and ride along with last week's.
- Completions arrive in bursts (4–6 within a minute). Home shows done only as a count; the
  Completed hub searches titles only, and its grouping keys on the raw `completed_at` timestamp
  (see Bugs) so headers do not group by day.
- Creating a configured task from Home is impossible: Home's `+` only takes a bare title
  (`TaskDialog.createQuick`); the full dialog needs a trip to the daily note. The full dialog is
  taller than a laptop modal (Save scrolls away) and takes ~9 interactions for a
  priority + project + next-Monday task.

## Goals

1. One-gesture path from Home to the full task dialog; no title-only quick add.
2. A dialog that configures a task in ≤ 4 interactions without scrolling on a laptop.
3. Rescheduling to next Monday is one click, per task and in bulk.
4. Sorting that means something when most tasks lack priority: manual order + smart fallback.
5. Done work is visible the same day (Home + daily) and findable later (by range, project, text).
6. Stale and undated work has a home that is not Today.

## Non-goals

- No new task storage model. Note-per-task under `spice/tasks/` (`_done/`, `_trash/`) stays.
- No calendar/time-blocking, no reminders/notifications, no recurrence redesign (the Repeats
  picker keeps its current grammar and UI, just relocated).
- `scheduled` is not revived. `due` remains the single date.
- Meeting/project/trip task lists (`TaskMeetingList`, `TaskProjectList`, `TaskTripList`) are not
  restyled beyond what they inherit from the shared row (`TaskTodayList.renderTaskRow`).

## Anti-goals (fail even if it technically works)

- A NEW gesture write that bypasses `RenderSafe.mutate` / `mutateStructure` (gesture-write lint
  must stay green; no allowlist additions for user gestures). Existing write paths (mark done,
  reschedule-to-tomorrow, dialog save/delete, recurring roll-forward) keep their current
  mechanics; re-plumbing them onto RenderSafe is out of scope. New writes (reopen, rank renumber,
  bulk-bar fan-out wrapper, week-strip drop, Backlog/Pick-date row actions) use `RenderSafe.mutate`.
- A row that becomes more cluttered at rest. New actions show on hover/focus on desktop; on
  mobile they live behind the row's existing tap targets plus one overflow (`⋯`) menu.
- Losing existing data: tasks without the new `rank` field, with blank `due`, or with legacy
  `scheduled` must render and sort without error.
- Filters that silently reset (today's per-day reset of `ToDoDailyFilterView` state is a bug for
  this purpose; see Daily view).

## Constraints (repo rules that shape the how)

- CustomJS classes are BARE CLASS ONLY, instance methods precede statics, every render is
  cold-load guarded (`Docs/landmines.md` #1–#5, `code-conventions.md`).
- Gesture writes go through `customJS.RenderSafe.mutate` / `mutateStructure`.
- Schema changes register in `platform/schemas-index.json` (`task-entity-frontmatter`).
- No version bumps by hand; conventional commits; PR title carries the highest type (`feat`).
- Workshop holds no personal content: fixtures use invented task titles, not accuris data.
- Mobile Obsidian is a real client: every layout must work at phone width; drag-and-drop is a
  desktop enhancement with a non-drag equivalent.

---

## Design

### 1. Shared semantics (task-entity mechanism, `TaskEntity` pure helpers)

All date math is pure and takes `todayStr` (YYYY-MM-DD) as input; only render entry points read
the clock.

| Helper | Contract |
|---|---|
| `nextMonday(todayStr)` | The Monday strictly after today (Mon → following Mon; Sun → next day). |
| `tomorrow(todayStr)` | today + 1. |
| `bucketOf(task, todayStr, staleDays=30)` | `'done'` if status done; else `'backlog'` if no `due`; `'today'` if due == today; `'overdue'` if 1 ≤ days late < staleDays; `'stale'` if days late ≥ staleDays; `'upcoming'` otherwise. |
| `daysLate(task, todayStr)` | integer ≥ 0. |
| `compareSmart(a, b, todayStr)` | tasks with a numeric `rank` first (ascending); then priority (highest → none); then days late (desc); then `created_at` (asc); then title. |
| `compareBy(mode)` | `smart` · `manual` (rank asc, unranked last by created) · `priority` · `due` (soonest, blank last) · `oldest` (created asc) · `touched` (file mtime desc). |
| `parseTitleShortcuts(text, todayStr, projects)` | Pulls only a trailing run of tokens (so "Prep Monday standup" keeps its title): `today`, `tomorrow`, `next mon` / `mon`…`sun` (next occurrence), `!low` `!medium` `!high` `!highest`, `#Project` (case-insensitive match against project names, spaces allowed via `#"Two Words"` or nearest prefix match). Returns `{ title, due?, priority?, project? }` with tokens removed. Unmatched `#x` stays in the title. |

**Backlog = personal undated open tasks.** A task is in Backlog when it is open, has no `due`, and
has no `project_slug`, no `trip_slug`, no `parent_task`, and `source !== 'meeting'` (undated
project/trip/meeting/sub-tasks already live on their own surfaces and stay there). This is the
daily view's existing "No date" scope, renamed and narrowed; Home's `queryToday` already excludes
undated tasks, so no Today surface changes. `TaskTodayList.buildBands` (used only by legacy
pre-filter-view to-do notes) is left untouched. The dialog's When default is Today only for the
`daily`, `home` and `manual` surfaces; `project`, `meeting` and `trip` surfaces keep today's
defaults from `TaskDialog.defaultsForSurface` (no date).

**New optional frontmatter: `rank`** (number). Written only by manual reordering. Cleared (set to
`''`) whenever `due` changes through any reschedule path (row actions, bulk bar, week-strip drop,
dialog edit) so yesterday's order never jumps ahead of today's priorities. `composeNote` does not
emit it; `parseNote` normalizes blank/non-numeric to `null`. Registered in the
`task-entity-frontmatter` schema entry.

**Reopen** (new, `TaskDialog.reopen(path)`): status → open, `completed_at` → `''`, move
`_done/<file>` back to `spice/tasks/<file>` (collision-safe via `_uniqueName`). Used by Undo on
Done-today rows and Reopen in the Done log. Recurring tasks: reopening a rolled-forward recurrence
is out of scope; Undo is offered only when the done row's note lives in `_done/`.

### 2. Shared task row (`TaskTodayList.renderTaskRow`)

At rest: drag handle (manual-order contexts only), checkbox, priority bar (3 px, colour by
priority; replaces the daily view's separate dot), title, then chips: notes-size chip (only when
the body below `<!-- TASK_NOTES -->` exceeds ~200 chars; label `N KB notes` or `notes`), project
chip, and a contextual age chip (`7 days` red for overdue, `since Aug 4` amber for stale).

On hover/focus (desktop) or via `⋯` (mobile): `→ Tomorrow`, `→ Mon <d>` (next Monday, new),
Edit, `⋯` (Backlog, Pick date…, Delete). Clicking the title opens the task note (unchanged).

The notes size is computed without a file read: `file.stat.size` (from
`app.vault.getAbstractFileByPath(path)`) minus the frontmatter end offset
(`app.metadataCache.getFileCache(file).frontmatterPosition.end.offset`) minus
`TaskEntity._chromeBody().length`, floored at 0. Missing file/cache → no chip.

`rescheduleTomorrow` generalizes to `reschedule(row, task, newDue, viewedDay)` with the same
in-flight guard, optimistic row removal and rollback; it also clears `rank`.

### 3. Home (`SpaceHome`, home blueprint)

- Header right side: **New task** (accent button) → `TaskDialog.open({ surface: 'daily' })` in
  create mode (When defaults to Today). **Capture ▾** menu keeps Meeting, Sticky Note, Article, Journal, Trip (the existing
  `_captureSpec()` entries and dispatch). The inline "Jot a task…" input and its
  `createQuick` path are removed from Home (`createQuick` itself stays for other callers).
- Glance line unchanged, plus `N backlog` when > 0 (links to the daily view's Backlog tab).
- The tasks panel is rendered by `SpaceDailyDashboard`, which today uses its own private bullet
  rows (`space-daily-dashboard.js` ~631–683). It switches to the shared
  `TaskTodayList.renderTaskRow` (falling back to the existing plain rows if TaskTodayList is not
  registered). The new sectioned panel renders only when the viewed date equals the real today
  (Home with `asOf: today`, or today's daily note); past and future daily notes keep the current
  panel unchanged, so no write action ever acts relative to a non-today date. Up next lists all
  sources (personal, project, meeting, trip), matching `queryToday`. The panel becomes:
  1. **Up next** — today's tasks, Smart sort, drag to reorder (desktop).
  2. **Overdue · N** — 1–29 days late, with **Move all to today**.
  3. **Stale · N** — ≥ 30 days late, rows dimmed, inline **Backlog** / **Pick a date**, header
     **Triage** opens the daily view on the Overdue tab.
  4. **Done today · N** — struck-through rows with completion time and **Undo**; footer link
     **Open done log**.
  Sort/Group controls on Home are a compact `Sort: Smart ▾` / `Group: None ▾` pair sharing the
  daily view's persisted preference.

### 4. Task dialog (`TaskDialog._render`, create + edit)

Layout: header (`New task` / `Edit task`, close), body in two columns ≥ 720 px wide, stacked
below. Footer pinned (never scrolls away); body scrolls internally if needed.

- **Left column**: large title input (autofocus in create mode) with live shortcut parsing — as
  tokens are recognized they are removed from the title on submit and reflected in the right
  column immediately; hint line under the title. Notes textarea (flex). Row of quiet buttons:
  `＋ Link note`, `＋ Web link`, `Subtask of…` (existing link inserters + parent picker; links
  render as chips as today).
- **Right column**:
  - **When**: `Today` · `Tomorrow` · `Next Mon` · `Pick date…` (reveals the native date input
    inline) · `No date`. Caption shows the resolved date ("Due Mon Nov 16") or "goes to the
    backlog". Default Today in create mode; edit mode selects whichever matches the task's due
    (or Pick with the date shown).
  - **Priority**: five buttons None/Low/Medium/High/Highest with colour swatch; keys `0`–`4`
    when focus is not in a text field.
  - **Project**: type-to-filter input over the vault's project list + up to 6 recent-project
    chips (most frequent among tasks created in the last 30 days, ties by recency); clicking the
    selected chip clears it.
  - **Repeats**: the existing recurrence picker, collapsed to a single `Doesn't repeat ▾` button
    that expands in place.
- **Footer**: left `Open the note after creating` checkbox (create mode; persisted per device in
  localStorage, default on). Right: `Create & add another` (create mode: saves, clears title +
  notes, keeps When/Priority/Project, refocuses title) and primary `Create task` / `Save` with
  `⌘↵` / `Ctrl↵`. Edit mode keeps the existing left-group actions (Open, Done, Delete).

All of today's validation, recurrence grammar, edit hydration and save paths are kept; only the
layout and the new controls change. Saves clear `rank` when `due` changed.

### 5. Daily view (`ToDoDailyFilterView`, to-do blueprint)

- **Week strip** (Mon–Fri of the current week, plus Sat/Sun cells only when they hold tasks):
  each cell shows open count; today highlighted. Desktop: dropping a row on a cell reschedules it
  (clears rank). Clicking a cell switches to the This week tab scrolled to that day.
- **Tabs** (replace scope pills): `Today` · `This week` · `Overdue · N` (overdue + stale, stale
  rows dimmed below a divider) · `Backlog · N` · `All open`. `Done` toggle is removed; done work
  always shows in the Done today section below the list on the Today tab.
- **Sort ▾** menu: Smart, My order, Priority, Due date, Oldest first, Last touched — each with a
  one-line description. **Group ▾**: None, Project, Priority, Due day. Choice persists across
  days (state no longer keyed by note date; key `sauce-todo-filter:prefs:v2`; the old per-day
  blob is ignored).
- **Select** button toggles selection mode: selection squares appear left of checkboxes; a
  floating bar shows `N selected · → Tomorrow · → Next Mon · Priority ▾ · Project ▾ · Backlog ·
  Mark done`. Each bulk action applies per task through the same row-level mutate paths
  (sequential, one RenderSafe mutation per task, partial failure leaves failed rows selected
  with a Notice).
- **Manual order**: in Smart or My order with Group = None, rows in Today show a drag handle.
  Dropping renumbers the visible Today list (`rank` 1..n, writes only changed tasks). Mobile:
  `⋯ → Move up / Move down`.
- **Done today** section at the bottom (same row shape as Home).

### 6. Done log (`TaskDoneArchive`, to-do blueprint; hub note title stays "Completed Tasks")

- Range presets: Today · Yesterday · This week · Last week (default) · This month · Pick
  range…; header shows `N done <range>, across M projects`.
- Two summary panels: per-day bars for the range (≤ 31 bars; ranges longer than 31 days bar by
  week) and per-project counts.
- Search input matches title **and** notes body. Body search reads `_done/` files lazily with
  `app.vault.cachedRead` only when the query is ≥ 3 chars, caching per path+mtime for the
  session. Filters: Project ▾, Source ▾ (daily/meeting/project/trip/manual).
- List grouped by local completion **date** (bug fix), newest day first, rows show project chip,
  completion time, **Reopen**.
- **Copy as standup**: copies Markdown for the current range+filters:
  `**<Day>**` then `- <title> (<project>)` lines; Notice on copy.

### 7. Bugs fixed along the way

- `TaskDoneArchive.groupByDate` keys on the raw `completed_at` value (a Luxon DateTime or full
  ISO string), so groups are per-timestamp, not per-day. Key on the local `YYYY-MM-DD`.
- A task can be `status: open` with a stale `completed_at` (observed in a consumer vault). Reopen
  clears it; `parseNote` ignores `completed_at` for open tasks.

---

## Decisions made without asking (check these)

1. Backlog is personal undated tasks only (§1); it is the existing "No date" scope renamed.
   New tasks from Home/daily default to Today; project/meeting/trip dialogs keep no-date defaults.
2. Stale threshold is 30 days late, a constant (`TaskEntity.STALE_DAYS`), not a setting.
3. `rank` resets whenever a task is rescheduled.
4. "Next Mon" from a Monday means the following Monday (7 days).
5. Bulk actions are sequential per-task mutations, not a batch transaction.
6. Drag-and-drop (reorder, week-strip drop) is desktop-only; mobile gets menu equivalents.
7. Recent projects = most frequent in tasks created in the last 30 days.
8. "Copy as standup" is included (inferred: work vault, bursty completions); it is small and
   self-contained, so cutting it later costs nothing.
9. The Completed Tasks hub keeps its path and title; only the renderer changes, so links and
   chrome-bar buttons keep working.
10. Recurring completions stay invisible to Done today / Done log / standup: completing a
    recurring task rolls `due` forward in place and never reaches `_done/`, and recording those
    completions would need new storage (a non-goal). Recurring use is rare (1 of 272 tasks in the
    reference vault).
11. Existing task write paths are not moved onto RenderSafe (see Anti-goals); only new writes are.
12. The sectioned Home/daily panel renders only for today's date; past/future daily notes keep
    the current panel.
13. Title shortcuts apply in create mode only. In edit mode an existing title such as "Prep for
    Friday" would otherwise lose its last word and move its date on the first keystroke.
14. The task row's ⋯ menu uses the shared `MenuPopover` primitive rather
    than Obsidian's `Menu` global, which is not reliably reachable from CustomJS.

## Left to the builder

- Exact CSS (match existing `sauce-*` tokens and `var(--…)` Obsidian variables; the canvas is
  the visual reference, not a pixel spec).
- Harness split: extend existing harnesses (`run-task-entity.js`, `run-todo-dialog.js`,
  `run-todo-daily-filter-view.js`, `run-home.js`, `run-daily-dashboard.js`) or add a new
  behavioral harness per slice; register any new `run-*.js` in `preflight-manifest.json`.
- Slice order and PR shape (one PR with slice commits is acceptable).

## Delivery slices (suggested order)

1. Task-entity semantics: pure helpers, `rank`, reopen, buckets, schema entry, groupByDate fix.
2. Shared row: next-Monday action, notes chip, priority bar, age chips, generalized reschedule.
3. Task dialog redesign.
4. Home: New task button + Capture menu; dashboard panel sections (Up next / Overdue / Stale /
   Done today).
5. Daily view: tabs, sort/group menus, persisted prefs, Done today, selection + bulk bar,
   manual order, week strip.
6. Done log.
