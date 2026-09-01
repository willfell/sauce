# To-do scope bar — correction and restyle — design

- **Date:** 2026-08-31
- **Workshop version at authoring:** 0.288.0
- **Status:** awaiting Director review
- **Origin:** the Director reported that the accuris daily to-do note showed only two tasks, that "All" appeared not to work, and that the toggle pills read as too tall and too narrow. Investigation found four shipped logic defects plus a duplicated sort surface on Home.

## Problem

The daily to-do note (`spice/to-do/YYYY/MM-Month/ToDo-YYYY-MM-DD.md`) mounts `ToDoDailyFilterView`, which renders a scope/sort control bar over one flat task list.

The surface is **not** mis-deployed. All four `tv-*` slices landed on `origin/main` and shipped as v0.287.0 and v0.288.0, and the installed copy at `~/obsidian/accuris-sauce/ranch/scripts/to-do/todo-daily-filter-view.js` is byte-identical to `origin/main`. The `Daily To-Do Sort Surface Correction` epic in the headspace vault is still `blocked`/`parked` with cards TD-2a and TD-2b, but the `tv-*` epic superseded it without closing it — that stale epic is what made the surface look broken at the board level. See [Out of scope](#out-of-scope).

What is actually wrong is the shipped logic.

### Defect 1 — "All" cannot show everything

`platform/blueprints/to-do/helpers/todo-daily-filter-view.js:76` — `selectByScope` evaluates the `done` branch and returns before it ever reaches `if (all) return true`:

```js
if (status === 'done') {
    if (!scopes.has('done') || !task.completed_at) return false;
    // ... returns true only when completed_at is TODAY
}
if (status !== 'open') return false;
const due = task.due == null ? '' : String(task.due).trim();
if (all) return true;
```

Consequences:

| Selection | Actual result |
| --- | --- |
| `All` | every **open** task; no completed task, ever |
| `Done` | tasks completed **today** only |
| `All` + `Done` | every open task, plus today's completions |

No combination of the six pills surfaces a task completed before today. The Director's report that "clicking All doesn't work" is this defect: `All` genuinely does less than its label claims.

This is locked into the current test suite at `platform/test/run-todo-daily-filter-view.js:175`, which asserts the `['all','done']` result set under the defective semantics. That assertion is wrong and moves with the fix.

### Defect 2 — deselecting the last scope silently re-selects two others

Scopes are an additive array. The click handler removes a scope that is already present:

```js
const index = next.indexOf(key);
if (index >= 0) next.splice(index, 1); else next.push(key);
```

When that empties the array, `writeState` → `_normalizeState` applies:

```js
if (!scopes.length) return ToDoDailyFilterView._defaultState();  // ['today','overdue']
```

So turning off your only active scope turns **Today + Overdue** back on. The pill visibly refuses the click. This is the second half of "the buttons don't necessarily work".

### Defect 3 — Due and Priority are indistinguishable

`compareTasksByPriority` ranks `highest|high|medium|low` and falls through to `compareTasksByDue` on a tie. In the accuris vault only 11 task notes carry a priority value against roughly 159 that are blank or empty-string, and **no row renders any priority signal**.

The consequence is not merely that the two sorts often agree. It is that when they *do* differ, nothing on screen explains why the order changed. A sort control whose effect is invisible reads as broken whether or not it ran.

### Defect 4 — one global, permanent filter state

```js
static get STORAGE_KEY() { return 'sauce-todo-filter:state'; }
```

One `localStorage` key is shared by every to-do note and never expires. Opening a fresh day's note silently restores whatever was last clicked on any other day. The Director's "only 2 items showing" was `Today`-only + `By Project` persisted from an earlier session — the surface was working exactly as instructed, by an instruction given days earlier and never surfaced.

### Defect 5 — Home carries a second, independent sort surface

`platform/blueprints/daily/helpers/space-daily-dashboard.js:623` builds its own control:

```js
taskSortControl.className = "sauce-daily-task-sort sauce-pill-group";
```

backed by a separate key, `sauce-daily-dashboard:task-sort-mode` (`space-daily-dashboard.js:115`). Two independent sort states govern overlapping task sets on two surfaces, with no relationship between them. Home is a glance surface; sort configuration does not belong on it.

### Visual

`.sauce-pill-toggle` in `platform/mechanisms/styling/assets/snippets/sauce-core.css:192` is `min-height: 20px; padding: 1px 8px; font-size: 0.76em` with a full pill radius and a **solid** accent fill when active. On short labels (`All`, `Due`, `Done`) the generous vertical box against tight horizontal padding renders nearly circular, and the solid fill makes an active pill the heaviest element on the note. There is also no rule separating the control bar from the list it governs.

## Decisions

Four decisions were taken with the Director against a live prototype before this spec was written.

1. **Scope becomes single-select**, with `Done` split out as an independent include-completed switch.
2. **Keep both sort modes and make priority visible** — each row gains a priority dot so a Priority reorder has an on-screen reason. `By Project` moves out of the sort group, because grouping is not sorting.
3. **Persistence is keyed to the note's own date.** A note for another day opens on its natural default.
4. **Home loses the sort control only.** Count pills and the per-row move-to-tomorrow calendar stay.

Geometry: **option B, count-pill match** — the toggles adopt the geometry and tinted treatment of the existing `2 Open / 5 Done` section-count pills.

## Design

### State shape

```
{ scope: 'today'|'overdue'|'upcoming'|'no-date'|'all',
  includeDone: boolean,
  sort: 'due'|'priority',
  groupByProject: boolean,
  date: 'YYYY-MM-DD' }
```

`scope` replaces the `scopes[]` array; `includeDone` replaces the `'done'` array member; `date` is new. `SCOPE_KEYS` drops `'done'` and now enumerates only the five mutually exclusive date scopes.

`_normalizeState` coerces an unrecognised `scope` to `'today'` and any non-boolean to `false`. It can no longer encounter an empty selection, so the snap-back branch that caused **defect 2** is deleted rather than repaired.

**Legacy blobs are discarded, not migrated.** A stored value carrying the old `scopes[]` shape has no `date` field; `_normalizeState` returns the default for it. This is deliberate: a filter preference is cheap to re-express and the alternative is a mapping table that must decide what `['today','overdue']` means under single-select. The surface self-heals on first open.

### Selection rule

`selectByScope(tasks, scope, includeDone, todayIso)`. The `done` early-return is removed; completion is evaluated as an include, and `all` widens both sides:

| `scope` | `includeDone` | Result |
| --- | --- | --- |
| `today` | false | open, `due === today` |
| `overdue` | false | open, `due < today` |
| `upcoming` | false | open, `due > today` |
| `no-date` | false | open, no `due` |
| `all` | false | **every open task**, regardless of `due` |
| any date scope | true | the above, **plus** tasks completed today |
| `all` | true | **every task ever**, open and completed |

### Persistence

The single `STORAGE_KEY` is retained, with `date` carried inside the blob. Per-date keys were rejected: they accumulate one `localStorage` entry per day opened, without bound.

The note's date is parsed from its filename (`ToDo-(\d{4}-\d{2}-\d{2})`) via `RenderSafe.page(dv)`. On read, a stored `date` that does not match the current note's date yields the default state.

**Scope arithmetic continues to use the wall clock, not the note date.** Opening 2026-08-31's note on 2026-09-02 still resolves `Today` against 09-02. Only persistence is note-date-keyed. Rebinding scope math to the note's date is a larger semantic change — it would make an old note a frozen historical view — and is not in this scope.

### Priority indicator

The dot is added in `ToDoDailyFilterView.renderRows`, decorating the row that `TaskTodayList.renderTaskRow` returns — **not** inside `renderTaskRow` itself.

That method is the shared row renderer for Home, project, meeting and trip lists. Decorating locally holds the blast radius at exactly one surface and follows the seam the helper already uses to check done-state checkboxes. The decoration is guarded so a future structural change in `renderTaskRow` degrades to no dot rather than throwing.

A 7px dot, using the same token family the section-count pills already draw from:

| Priority | Fill | Treatment |
| --- | --- | --- |
| `highest` | `var(--color-red)` | filled, plus `0 0 6px` glow at 55% |
| `high` | `var(--color-red)` | filled |
| `medium` | `var(--color-orange)` | filled |
| `low` | `var(--text-muted)` | filled |
| unset | transparent | 1.5px ring, `--text-muted` at 45% — sorts last |

### Control bar layout

```
┌ scope (single-select) ──────────────────┐   ┌ Done ┐ │ ┌ sort ┐ │ ┌ group ┐
│ Today  Overdue  Upcoming  No date  All  │   │ Done │ │ │Due Pri│ │ │By Proj│
└─────────────────────────────────────────┘   └──────┘ │ └───────┘ │ └───────┘
─────────────────────────────────────────────────────────────────────────────
  ● Retire Atlas                                        due: 2026-08-31  🗓 🔧 🗑
```

Three right-hand groups separated by hairline dividers, so "include", "sort" and "group" read as three distinct concerns rather than one undifferentiated row of six pills. A hairline rule closes the bar off from the list beneath it.

### Geometry

`.sauce-pill-toggle` moves to the section-count-pill geometry:

| Property | Was | Becomes |
| --- | --- | --- |
| `min-height` | `20px` | `19px` |
| `padding` | `1px 8px` | `1px 12px` |
| `font-size` | `0.76em` | `0.80em` |
| `letter-spacing` | — | `0.02em` |
| active `background` | solid `--interactive-accent` | `color-mix(in srgb, var(--interactive-accent) 14%, transparent)` |
| active `color` | `--text-on-accent` | `--interactive-accent` |
| active `box-shadow` | — | `0 0 8px color-mix(in srgb, var(--interactive-accent) 30%, transparent)` |

Border, radius, and the focus-visible outline are unchanged. The active state moves from solid to tinted so an active pill stops out-weighing the task titles it filters — the same reason the count pills were built tinted.

### Home

Remove from `space-daily-dashboard.js`: the `taskSortControl` element, its `renderRight` hook, the sort-button block and `updateSortButtonState`, and the `taskSortStorage` / `readTaskSortMode` / `writeTaskSortMode` trio with the `sauce-daily-dashboard:task-sort-mode` key.

**Retain `compareTasksByDue`, `compareTasksByPriority`, `normalizeTaskSortMode` and `sortTasks`.** `ToDoDailyFilterView.sortTasks` delegates to these statics through `CJS.SpaceDailyDashboard`; deleting them silently drops the to-do note onto its private fallback comparators. Home calls `sortTasks` with a fixed `'due'`.

Count pills and the per-row calendar button stay.

## Testing

| Harness | Change |
| --- | --- |
| `platform/test/run-todo-daily-filter-view.js` | Rewrite for the new state shape. One case per row of the selection table, explicitly including `all` + `includeDone` returning a completion older than today — the case the current suite asserts backwards at line 175. Cases for legacy-blob discard, note-date mismatch yielding default, and single-select never emptying. |
| `platform/test/run-sauce-core-css.js` | Retarget the exact-geometry assertions at lines 230–234 and the degenerate-value negative fixtures at 477–478 to the new values. Extend the active-state contract from solid fill to the tinted triple. Bind the priority-dot rules. |
| `platform/test/run-daily-dashboard.js` | Assert no sort control renders in the Tasks panel and that the `sauce-daily-dashboard:task-sort-mode` key is never written. Assert the comparator statics survive. |
| `platform/test/run-seed-migrations.js` | Only if the `Today To-Do` template changes; the mount contract is unchanged, so no template edit is currently expected. |

Per the repository convention, the rationale behind each retained invariant lives in these assertions and in the commit messages — not in comments in the CSS or manifest files.

## Out of scope

- **Closing the parked `Daily To-Do Sort Surface Correction` epic.** It sits `blocked` in the headspace vault with TD-2a and TD-2b parked behind a `resume_condition`, superseded in substance by the `tv-*` epic. It should be tombstoned through the board's own supersession rail, not edited as a side effect of this work.
- **Pruning stale worktrees.** Roughly 35 `.worktrees/codex-autoloop-*` directories and 9 prunable temp worktrees remain from earlier autoloop cycles. Unrelated to this change; needs its own confirmation.
- **Rebinding scope arithmetic to the note's date.** See [Persistence](#persistence).
- **Backfilling `priority` across existing task notes.** The dot renders an unset priority as a hollow ring; no data migration is required for the control to be honest.
