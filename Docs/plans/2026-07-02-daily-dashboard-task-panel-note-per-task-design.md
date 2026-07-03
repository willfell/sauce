# Daily Dashboard task panel → note-per-task (design)

**Date:** 2026-07-02
**Component:** `daily` blueprint (`platform/blueprints/daily/helpers/space-daily-dashboard.js`)
**Status:** approved (brainstorm complete)

## Problem

`SpaceDailyDashboard` renders on the daily JOURNAL note (`spice/daily/…`). Its tasks
panel `getTasks()` reads **raw markdown checkboxes** via `page.file.tasks` from
`spice/to-do` notes, then folds in project + meeting `file.tasks` that are due-today or
overdue (`_countsTowardToday`, `_foldExternalTasks`, `_parseTaskDue`).

Since the note-per-task migration (shipped through v0.181.1), tasks are no longer markdown
checkboxes — every task is its own note under `spice/tasks/<title>.md` with structured
frontmatter (`type:task`, `status`, `scheduled`, `due`, `priority`, `project`,
`project_slug`, `source`, `source_note`, `created_at`, `completed_at`). Completing a task
MOVES it to `spice/tasks/_done/` (`status:done` + `completed_at`); delete moves it to
`spice/tasks/_trash/`. `page.file.tasks` is therefore empty → **the dashboard task panel
shows nothing**.

## Decision

The dashboard task panel becomes an **at-a-glance MIRROR**: open task-notes scheduled
TODAY + OVERDUE (all sources) as a compact read summary with `N Open / K Done` pills. Each
row clicks through to that task's NOTE. Keep the existing bullet-list rendering; swap only
the data source.

Resolved questions:
1. **Row-click target → open the task NOTE** (`app.workspace.openLinkText(task.path,"")`).
   The dashboard is a read-mostly mirror; the note itself carries `TaskNoteView` + an Edit
   button. Matches the old dashboard's click-through behavior.
2. **Done scope → done-TODAY only** — `_done/` notes whose `completed_at` DATE == today.
   All-done would grow unbounded with vault history (the old code even comments on this fear).
3. **Unify, don't fold → ONE query** over `spice/tasks`. Retire `_foldExternalTasks` /
   `_countsTowardToday` / `_parseTaskDue` (they key on the old inline-markdown `due::`/📅
   model that no longer exists).
4. **Overdue → included** (second bucket of the partition), rendered in the same flat list
   with a subtle "overdue" marker. Banding is on `scheduled` (not `due`), consistent with
   the TO-DO note's `TaskTodayList`.
5. **Empty state → keep existing conditional.** The Tasks `<details>` section only renders
   when `open>0 || done>0`; the outer `hasContent` guard already shows "No activity recorded
   yet" when meetings + activity are also empty. No new empty-state widget.

## Reused primitives (do NOT reimplement)

- `TaskEntity.parseNote(page)` → normalized task view (`{title,status,scheduled,due,priority,
  project,project_slug,source,source_note,links,created_at,completed_at,path}`), coercing
  Dataview Luxon dates + Link objects.
- `TaskEntity.queryToday(tasks, todayStr)` → `{today, overdue}`, **source-agnostic**
  (status `open` + `scheduled==today` / `scheduled<today`; future + unscheduled excluded).
  **Use this, NOT `TaskTodayList.buildBands`** — as of v0.181.1 `buildBands` excludes
  `project_slug`/`source==meeting` tasks (they render in the TO-DO note's own Project /
  Meeting sections). The dashboard wants ALL sources, so it binds to the source-agnostic
  core to stay decoupled from the TO-DO note's personal-only banding.
- `TaskEntity._toDateStr(v)` → `YYYY-MM-DD` from string / datetime / Luxon. Used for the
  `completed_at` date compare (`markDone` writes `YYYY-MM-DDTHH:mm:ssZ`).
- `TaskTodayList.renderInlineLinks(el, text, sourcePath)` → builds REAL `<a>` anchors for
  `[[wl]]` / `[md](url)` / bare URLs. Deterministic — does NOT use Obsidian's
  `MarkdownRenderer` (not a global in the customJS eval context; that path always fell back
  to raw text). Reused for the row title.

## Architecture

Single canonical file changes: `platform/blueprints/daily/helpers/space-daily-dashboard.js`
+ its tests. No CSS-snippet change (overdue marker is inline-styled). No version pins (the
release pipeline owns those).

### New pure static — the Node-testable seam

`getTasks()` today is an inline closure inside `render(dv)`. Extract the data-selection into
a new **pure static** `SpaceDailyDashboard.selectTasks(dv, todayStr, TE)`, mirroring the
file's own documented architecture ("the decision logic lives here as pure statics so it can
be regression-tested; getTasks() is just the dv adapter"). This is what makes a FAITHFUL
Node test possible — the retired fold helpers were statics for exactly this reason.

```
selectTasks(dv, todayStr, TE):
  guard: !TE.parseNote || !TE.queryToday  → { open: [], done: 0 }
         (cold-load / mechanism not registered: task panel hides; meetings+activity still render)
  toArr(q): dv.pages(q) → r.array() if fn else Array.from(r); any throw → []

  # Open — all sources, exclude _done/_trash
  openParsed = []
  for p of toArr('"spice/tasks"'):
      skip unless p.type=='task' && p.status=='open'
      skip unless p.file.path && !path.includes('/_trash/') && !path.includes('/_done/')
      openParsed.push(TE.parseNote(p))
  bands = TE.queryToday(openParsed, todayStr)         # source-agnostic today/overdue
  open  = [ ...bands.today   (each ⊕ _overdue:false),
            ...bands.overdue (each ⊕ _overdue:true) ]  # flat, today-first, overdue tagged

  # Done today — _done/ with completed_at date == today
  done = 0
  for p of toArr('"spice/tasks/_done"'):
      skip unless p.type=='task' && p.file.path && !path.includes('/_trash/')
      if TE._toDateStr(p.completed_at) === todayStr: done++

  return { open, done }
```

Filtering is done in plain JS AFTER `dv.pages()` (not via DataArray `.where`), so a
plain-array dv-stub exercises the real path. The `render()` closure becomes a thin adapter:

```
const getTasks = () =>
  SpaceDailyDashboard.selectTasks(dv, today, window.customJS && window.customJS.TaskEntity);
```

### Rendering (flat list, overdue marked, click → note)

Keep the `<ul>` bullet primitive + the `N Open / K Done` pills; `done` is now a NUMBER.
Consumers updated: `const { open: openTasks, done: doneCount } = getTasks()`; the three pill
branches, the `hasContent` gate, and the section-render condition use `doneCount` instead of
`doneTasks.length`.

Per row:
- a title `<span>` rendered via `window.customJS.TaskTodayList.renderInlineLinks(span,
  task.title, task.path)` (plain-text fallback when TTL isn't registered);
- when `task._overdue`, append a sibling `<span>` "overdue" tag (small, muted-red, inline
  style) AFTER the title span (so `renderInlineLinks` clearing the title span doesn't nuke it);
- `li.onclick` → `app.workspace.openLinkText(task.path, "")`, guarded to ignore clicks that
  land on an inner `<a>` (mirrors the existing guard).

Retire the now-dead `_renderTaskHTML` (its only caller was the old raw-markdown task list;
`renderInlineLinks` supersedes it and also handles bare URLs).

Retire unused config: `config.todoPaths`, `config.externalTaskPaths`.

## Testing (faithful — no hand-built HTML replicas)

The prior regression this must not repeat: a hand-built HTML replica hid a broken code path
(the `MarkdownRenderer` fallback). Tests exercise the ACTUAL functions.

- **`run-renderer.js` — new `selectTasks` case (dv-stub + REAL TaskEntity).** Load the
  genuine `TaskEntity` via `new Function(src + 'return TaskEntity')`; build a `fakeDv` whose
  `pages(q)` returns task-note-shaped pages keyed by query (`"spice/tasks"` vs
  `"spice/tasks/_done"`). Assert:
  - open = today + overdue across daily/project/meeting sources (all sources present);
  - overdue rows carry `_overdue:true`, today rows `_overdue:false`, today-first ordering;
  - future-scheduled + unscheduled open tasks excluded from both;
  - `_done/` and `_trash/` paths excluded from `open`;
  - done = count of `_done/` notes with `completed_at` DATE == today, including a
    datetime-form (`…T..Z`) match and a not-today non-match;
  - cold-load `TE = null` → `{ open: [], done: 0 }`.
- **`run-renderer.js` — render-level case:** with the DOM stub + a real `TaskTodayList`
  injected into the `customJS` stub, assert a task row's click opens `task.path` and the
  title span contains a real `<a>` when the title has a link.
- **Update `HC-V0843-A1`** (source-lint) to the new shape — `selectTasks` returns an `open`
  array + a `done` count (the old `const done = []` array assertion no longer holds). Pill
  call-site asserts (A2–A8) still hold (pill markup unchanged).
- **Retire** the `_parseTaskDue` / `_countsTowardToday` / `_foldExternalTasks` cases
  (`DD-A9` in `run-helper-cases.js`) and the `_renderTaskHTML` case
  (`REND-V01241-LINK-1` in `run-renderer.js`), since the helpers are removed.

Full gate: `node platform/test/run-helper-cases.js`, `node platform/test/run-renderer.js`,
`node platform/test/run-customjs-loadable.js` (CJS-LOAD bare-class invariant), then
`npm run release:preflight` and `npm run release:preflight-bumped` (clean tree). Sync the
canonical helper into the dogfood copy under `ranch/scripts/daily/` so `HC-V0842-A1`
(canonical ≡ dogfood byte-equal) stays green — run the workshop self-install
(`node platform/install.js --vault . --auto-approve`).

## Non-goals

- No change to `TaskTodayList` / `TaskEntity` / the TO-DO note.
- No change to the Meetings or Activity panels.
- No CSS-snippet change.
- Due-but-unscheduled tasks intentionally do NOT appear (banding is on `scheduled`, matching
  the TO-DO note — that consistency is the point of a mirror).

## Rollout

Isolated git worktree → PR titled `fix(daily): …` (touches only the `daily` component) →
CI green → merge → release pipeline auto-bumps/tags/ships to brew → deploy to accuris,
headspace, ero via `Scripts/autoloop/deploy.js run` (verify each reports `ok:true` at the
target version). No `Co-Authored-By` trailer. User must Cmd+R.
