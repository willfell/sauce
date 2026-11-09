# To-Do Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tasks faster to create, sort, reschedule and review: full dialog from Home, a two-column dialog, next-Monday moves, smart/manual sorting, stale + backlog buckets, done-today lists and a searchable done log.

**Architecture:** Pure date/sort/bucket logic lands in `TaskEntity` (task-entity mechanism) and is consumed by the shared row (`TaskTodayList.renderTaskRow`), the dialog (`TaskDialog`), Home (`SpaceHome` + `SpaceDailyDashboard`), the daily view (`ToDoDailyFilterView`) and the done log (`TaskDoneArchive`). New writes go through `customJS.RenderSafe.mutate`; existing write paths are reused unchanged.

**Tech Stack:** Obsidian CustomJS bare classes (plain JS, no modules), Dataview, zero-dep Node harnesses under `platform/test/`.

**Spec:** `Docs/superpowers/specs/2026-11-08-todo-redesign-design.md` (read it first; this plan does not restate its UI copy).

## Global Constraints

- Every CustomJS file is a BARE CLASS ONLY: no trailing statements; each instance method that cross-class callers use precedes its static and delegates to it (`foo(a) { return X.foo(a); }`). Harnesses load via `new Function(src + "; return X;")()` and call through an instance.
- Cold-load safe: every `render(dv)` returns quietly when `window.customJS` dependencies, `dv.container`, or the current page are missing; never throws out of render. Read `Docs/landmines.md` #1–#5 before writing render code.
- Only render entry points read the clock (`window.moment()`); every helper takes `todayStr` (`YYYY-MM-DD`).
- New gesture writes use `customJS.RenderSafe.mutate(...)` (frontmatter) or `mutateStructure(...)` (row insert/remove with receipt + rollback). Do not add entries to `scripts/lint-gesture-writes-allowlist.json`.
- Existing write paths (`TaskDialog.markDone`, `_markDone`, dialog save/delete, `TaskTodayList.rescheduleTomorrow` mechanics) are reused, not rewritten onto RenderSafe.
- `STALE_DAYS = 30`. Next Monday from a Monday = +7 days.
- Backlog = open, no `due`, no `project_slug`, no `trip_slug`, no `parent_task`, `source !== 'meeting'`.
- `rank` is optional numeric frontmatter; written only by manual reorder; set to `''` whenever `due` changes through any path.
- Fixtures use invented titles/projects (no consumer-vault content in the workshop).
- Conventional commits; never bump versions, tags or pins by hand. No `Co-authored-by: Claude` / `Claude-Session:` trailers (repo rule, `build-test-verify.md`). The last commit on the branch must be `feat(...)`.
- Stage explicit paths (never `git add -A`). Tracked files under `scripts/` need `git add -f`.
- Any new `platform/test/run-*.js` is registered in `platform/test/preflight-manifest.json` as `{ "id": "<id>", "cmd": ["node", "platform/test/run-<name>.js"], "lane": "parallel" }` (orphan check fails otherwise).
- Use `/usr/bin/git` (bare `git` is refused in this worktree session).

## Review Focus

1. **Legacy/partial task data**: `due` as a Luxon DateTime, missing `created_at`, unknown priority string, `rank: "abc"`, `status: open` with a stale `completed_at` must sort/bucket without throwing and land in a sensible bucket. → Task 1 test `RD-E-LEGACY`.
2. **Day boundary**: `completed_at: 2026-11-06T23:30:00-07:00` groups under Nov 6 in the done log and counts as "done today" only on Nov 6 local. → Task 9 test `RD-DL-TZ`, Task 1 test `RD-E-DONEDAY`.
3. **Shortcut false positives**: "Prep Monday standup notes", "Fix #1 priority bug", "Email Tom tomorrow about X" must keep their titles intact; only a trailing run of tokens is parsed. → Task 1 test `RD-E-SC-SAFE`.
4. **Double gestures**: two quick clicks on → Next Mon, Reopen, or a bulk action must write once per task. → Task 2 test `RD-W-INFLIGHT`.
5. **Phone width**: dialog columns stack and the bulk bar wraps below 720 px; no horizontal scroll. → Task 5 test `RD-D-NARROW`, Task 8 test `RD-DV-BULK-WRAP`.

---

### Task 1: TaskEntity semantics (pure)

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js` (new statics + instance delegates; `parseNote`)
- Modify: `platform/schemas-index.json` (`task-entity-frontmatter` notes: add optional `rank`)
- Create: `platform/test/run-todo-redesign-entity.js`; register id `todo-redesign-entity` in `platform/test/preflight-manifest.json`

**Interfaces — Produces** (all static on `TaskEntity` with instance delegates):
- `STALE_DAYS` → `30` (static getter)
- `addDays(dateStr, n) -> string`, `tomorrow(todayStr) -> string`, `nextMonday(todayStr) -> string`
- `daysLate(task, todayStr) -> number` (0 when not overdue / no due)
- `isBacklog(task) -> boolean`
- `bucketOf(task, todayStr) -> 'done'|'backlog'|'undated'|'today'|'overdue'|'stale'|'upcoming'` (`'undated'` = no due but not backlog, i.e. project/trip/meeting/subtask)
- `completedDay(task) -> string|null` — local `YYYY-MM-DD` of `completed_at` (accepts ISO string or object with `toFormat`/`toISODate`)
- `compareBy(mode, todayStr) -> (a, b) => number`; modes `smart|manual|priority|due|oldest|touched`; unknown → `smart`
- `parseTitleShortcuts(text, todayStr, projectNames) -> { title, due?, priority?, project? }`
- `notesBytes(statSize, frontmatterEndOffset) -> number` = `max(0, statSize - frontmatterEndOffset - TaskEntity._chromeBody().length)`
- `parseNote(page)` additionally returns `rank` (finite number or `null`) and `mtime` (`page.file.mtime` as epoch ms or `null`), and returns `completed_at: null` when status is open.

- [ ] **Step 1: Write the failing tests** in `run-todo-redesign-entity.js` using the `ok`/`assert`/`loadClass` pattern from `platform/test/run-task-entity.js:17-23` and an instance (`new TaskEntityClass()`):

```js
const T = '2026-11-09'; // Monday
ok('RD-E-DATES', () => {
  assert(TE.tomorrow(T) === '2026-11-10');
  assert(TE.nextMonday(T) === '2026-11-16');            // Monday → following Monday
  assert(TE.nextMonday('2026-11-08') === '2026-11-09'); // Sunday → next day
  assert(TE.nextMonday('2026-11-13') === '2026-11-16'); // Friday
  assert(TE.addDays('2026-12-31', 1) === '2027-01-01');
  assert(TE.STALE_DAYS === 30);
});
ok('RD-E-BUCKETS', () => {
  const b = (t) => TE.bucketOf(Object.assign({ status: 'open' }, t), T);
  assert(b({ due: T }) === 'today');
  assert(b({ due: '2026-11-02' }) === 'overdue');       // 7 late
  assert(b({ due: '2026-10-11' }) === 'overdue');       // 29 late
  assert(b({ due: '2026-10-10' }) === 'stale');         // 30 late
  assert(b({ due: '2026-11-30' }) === 'upcoming');
  assert(b({ due: '' }) === 'backlog');
  assert(b({ due: '', project_slug: 'alpha' }) === 'undated');
  assert(b({ due: '', source: 'meeting' }) === 'undated');
  assert(b({ due: '', parent_task: 'Parent' }) === 'undated');
  assert(b({ due: '', trip_slug: 'x' }) === 'undated');
  assert(TE.bucketOf({ status: 'done', due: T }, T) === 'done');
  assert(TE.daysLate({ status: 'open', due: '2026-11-02' }, T) === 7);
});
ok('RD-E-SMART', () => {
  const tasks = [
    { title: 'c none old',  priority: '',     due: T, created_at: '2026-10-01T09:00:00-07:00' },
    { title: 'b high',      priority: 'high', due: T, created_at: '2026-11-05T09:00:00-07:00' },
    { title: 'a ranked 2',  priority: '',     due: T, rank: 2 },
    { title: 'z ranked 1',  priority: 'low',  due: T, rank: 1 },
    { title: 'd none late', priority: '',     due: '2026-11-01', created_at: '2026-11-06T09:00:00-07:00' },
  ];
  const order = tasks.slice().sort(TE.compareBy('smart', T)).map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['z ranked 1', 'a ranked 2', 'b high', 'd none late', 'c none old']), order.join(' | '));
});
ok('RD-E-MODES', () => { /* priority: highest>high>medium>low>none; due: soonest, blank last;
  oldest: created_at asc, missing last; touched: mtime desc, missing last; manual: rank asc then created asc;
  'bogus' behaves as smart */ });
ok('RD-E-LEGACY', () => {
  const weird = [
    { title: 'luxon', due: { toFormat: () => '2026-11-02' }, status: 'open' },
    { title: 'nocreated', due: T, status: 'open', priority: 'urgent' },
    { title: 'badrank', due: T, status: 'open', rank: 'abc' },
  ];
  weird.slice().sort(TE.compareBy('smart', T));                 // must not throw
  assert(TE.bucketOf(weird[0], T) === 'overdue');
  const parsed = TE.parseNote({ type: 'task', title: 'x', status: 'open', completed_at: '2026-11-05T10:00:00-07:00', rank: 'abc', file: { path: 'spice/tasks/x.md', mtime: { ts: 5 } } });
  assert(parsed.completed_at === null && parsed.rank === null);
});
ok('RD-E-DONEDAY', () => {
  assert(TE.completedDay({ completed_at: '2026-11-06T23:30:00-07:00' }) === '2026-11-06');
  assert(TE.completedDay({ completed_at: { toISODate: () => '2026-11-06' } }) === '2026-11-06');
  assert(TE.completedDay({ completed_at: '' }) === null);
});
ok('RD-E-SC', () => {
  const P = ['SCI', 'Content Registry', 'EMS'];
  const r = TE.parseTitleShortcuts('Size the paging condition next mon !high #SCI', T, P);
  assert(r.title === 'Size the paging condition' && r.due === '2026-11-16' && r.priority === 'high' && r.project === 'SCI');
  assert(TE.parseTitleShortcuts('Ship it tomorrow', T, P).due === '2026-11-10');
  assert(TE.parseTitleShortcuts('Ship it fri', T, P).due === '2026-11-13');
  assert(TE.parseTitleShortcuts('Ship it #"content registry"', T, P).project === 'Content Registry');
  assert(TE.parseTitleShortcuts('Ship it #ems', T, P).project === 'EMS');
});
ok('RD-E-SC-SAFE', () => {
  const P = ['SCI'];
  for (const s of ['Prep Monday standup notes', 'Fix #1 priority bug', 'Email Tom tomorrow about X', 'Look at #unknownproj']) {
    const r = TE.parseTitleShortcuts(s, T, P);
    assert(r.title === s && !r.due && !r.priority && !r.project, s);
  }
});
ok('RD-E-NOTESBYTES', () => {
  const chrome = TE._chromeBody().length;
  assert(TE.notesBytes(400 + chrome + 5000, 400) === 5000);
  assert(TE.notesBytes(100, 400) === 0);
});
```

Fill `RD-E-MODES` with one assertion per mode listed in its comment.

- [ ] **Step 2: Run** `node platform/test/run-todo-redesign-entity.js`. Expected: FAIL (`TE.tomorrow is not a function`).

- [ ] **Step 3: Implement** the Interfaces above in `task-entity.js`. Notes:
  - Date math with plain UTC `Date` on `YYYY-MM-DD` (`Date.UTC`, `getUTCDay`) so no wall-clock/TZ reads; `_toDateStr` already normalizes Luxon/strings, so reuse it.
  - Shortcut parsing scans tokens from the END only, stopping at the first non-token word. Tokens: `today`, `tomorrow`, `next mon` (two words, also `next monday`), weekday names `mon..sun` / full names (next occurrence strictly after today), `!low|!medium|!high|!highest`, `#Name` / `#"Two Words"` matched case-insensitively against `projectNames` (exact match first, then unique prefix). A `#x` with no match stops the scan and stays in the title.
  - Priority rank: `highest 4, high 3, medium 2, low 1, other 0`.
  - `parseNote` keeps every existing key; add `rank`, `mtime`; null out `completed_at` when status is open.

- [ ] **Step 4: Update** the `task-entity-frontmatter` entry `notes` in `platform/schemas-index.json` to list optional `rank` (number; written by manual reorder; blanked on reschedule). Run `npm run lint-schemas`. Expected: PASS.

- [ ] **Step 5: Register** the harness in `preflight-manifest.json`; run the new harness and `node platform/test/run-task-entity.js`. Expected: both PASS.

- [ ] **Step 6: Commit** `feat(task-entity): add bucket, sort and date helpers for the to-do redesign`

---

### Task 2: New task writes — reschedule(any date), reopen, rank, backlog

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js` (generalize `rescheduleTomorrow` at ~:191)
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (new `reopen`, `setFields`)
- Create: `platform/test/run-todo-redesign-writes.js`; register id `todo-redesign-writes`

**Interfaces:**
- Consumes: `TaskEntity.tomorrow/nextMonday/_uniqueName`.
- Produces:
  - `TaskTodayList.reschedule(row, task, newDue, viewedDay, TDref) -> Promise<{ok, due?, no_op?, reason?}>` — the existing `rescheduleTomorrow` body generalized to an explicit `newDue` (`''` = move to backlog); also writes `rank: ''`. `rescheduleTomorrow(row, task, viewedDay, TDref)` becomes `reschedule(row, task, TaskEntity.tomorrow(base), viewedDay, TDref)` with today's base-date logic unchanged.
  - `TaskDialog.reopen(path) -> Promise<{ok, path?, reason?}>` — via `RenderSafe.mutate`: frontmatter `status: 'open'`, `completed_at: ''`, then `app.fileManager.renameFile` from `spice/tasks/_done/<f>` to `spice/tasks/<unique f>`. Refuses (`{ok:false, reason:'not-done'}`) when the path is not under `_done/`. In-flight guard per path.
  - `TaskDialog.setFields(path, fields) -> Promise<{ok, reason?}>` — `RenderSafe.mutate` frontmatter write of exactly `fields` (used for rank, priority, project from bulk/drag); when `fields` contains `due`, also sets `rank: ''` unless `rank` is in `fields`.
  - Every dialog save that changes `due` writes `rank: ''`.

- [ ] **Step 1: Write failing tests** with the app/RenderSafe stubs used by `runTomorrowActionTests` in `platform/test/run-task-entity.js` (copy the stub builders, do not import):
  - `RD-W-RESCHED`: `reschedule(row, {path, due:'2026-11-09', status:'open', rank:3}, '2026-11-16', '2026-11-09', TD)` writes `due:'2026-11-16'` and `rank:''`; `newDue:''` writes `due:''`.
  - `RD-W-TOMORROW-COMPAT`: existing `rescheduleTomorrow` still produces the same due as before for a Friday task viewed Friday (`2026-11-14`… use 2026-11-13 → 2026-11-14).
  - `RD-W-REOPEN`: done file `spice/tasks/_done/A.md` → frontmatter status open, completed_at '', renamed to `spice/tasks/A.md`; with `spice/tasks/A.md` already existing → `spice/tasks/A 2.md`; non-`_done` path → `{ok:false, reason:'not-done'}`; the write went through the RenderSafe stub's `mutate` (record calls).
  - `RD-W-SETFIELDS`: `setFields(p, {due:'2026-11-16'})` writes `{due, rank:''}`; `setFields(p, {rank:2})` writes only `{rank:2}`.
  - `RD-W-INFLIGHT`: two concurrent `reopen(p)` / two concurrent `reschedule(...)` on the same path perform one write each.
- [ ] **Step 2: Run** `node platform/test/run-todo-redesign-writes.js` → FAIL.
- [ ] **Step 3: Implement** the Interfaces.
- [ ] **Step 4: Run** the new harness, `node platform/test/run-task-entity.js`, `node scripts/lint-gesture-writes.js` → all PASS.
- [ ] **Step 5: Commit** `feat(task-entity): add reopen, field writes and any-date reschedule`

---

### Task 3: Shared task row

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js` (`renderTaskRow` ~:557–830)
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js` (drop `decorateRow` priority dot use; the row owns the bar now)
- Test: extend `platform/test/run-todo-redesign-writes.js` (section `RD-ROW-*`) using the DOM stub from `run-task-entity.js` `runRowActionTests`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `reschedule`, `setFields`.
- Produces: `renderTaskRow(container, task, TDref, options)` with new `options`:
  - `viewedDay` (existing), `todayStr` (defaults to `window.moment().format('YYYY-MM-DD')`)
  - `dragHandle: boolean` → leading `.sauce-task-drag` element, `draggable=true`, `dataset.path`
  - `selectable: boolean`, `selected: boolean`, `onSelect(task, checked)` → leading `.sauce-task-select` checkbox (`aria-label="Select task"`)
  - `showAge: boolean` (default true) → `.sauce-task-age` chip: `N days` (class `is-overdue`) for overdue, `since Mon D` (class `is-stale`) for stale
  - `onRescheduled(task, newDue)` callback after a successful reschedule
  - Row always renders: `.sauce-task-prio-bar.is-<highest|high|medium|low|none>`; `.sauce-task-notes` chip when `TaskEntity.notesBytes(...) > 200`, text `N KB notes` (`Math.round(bytes/1024)`, min 1) — computed from `app.vault.getAbstractFileByPath(path).stat.size` and `app.metadataCache.getFileCache(file).frontmatterPosition.end.offset`; any missing piece → no chip
  - Actions (open tasks): `→ Tomorrow` (existing), new `.sauce-task-action-nextmon` with `aria-label="Move to next Monday"` and visible label `→ Mon <D>`, Edit, and `.sauce-task-action-more` (`aria-label="More actions"`) opening an Obsidian `Menu` with `Move to backlog` (→ `reschedule(..., '')`), `Pick date…` (native date input popover → `reschedule`), `Move up` / `Move down` (only when `options.onMove` is given; calls `options.onMove(task, -1|+1)`), `Delete` (existing delete flow). The standalone trash button moves into this menu.
  - Hover/focus reveal: actions container gets class `sauce-task-actions` hidden at rest on desktop (`.is-mobile` / `@media (hover: none)` keeps them visible).
- [ ] **Step 1: Failing tests** `RD-ROW-NEXTMON` (click → `reschedule` called with `2026-11-16` when today is `2026-11-09`), `RD-ROW-NOTES` (stat 5600 / fm end 400 / chrome length → chip `5 KB notes`; stat missing → no chip), `RD-ROW-PRIO` (bar class per priority), `RD-ROW-AGE` (overdue 7 → `7 days`; stale → `since Oct 10`), `RD-ROW-MENU` (menu items present; Move up/down only with `onMove`), `RD-ROW-SELECT` (`selectable` renders checkbox; toggling calls `onSelect`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** new harness + `run-task-entity.js` + `run-todo-daily-filter-view.js` + `run-task-trip-list.js` + `run-project-todo-owned-tasks.js` → PASS (update existing assertions that pinned the old trash button or the priority dot; keep each update minimal and say why in the commit body).
- [ ] **Step 5: Commit** `feat(task-entity): next-Monday, notes size and age on the shared task row`

---

### Task 4: Dialog pure helpers

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (statics + instance delegates)
- Test: extend `platform/test/run-todo-dialog.js` (section `RD-DH-*`)

**Interfaces — Produces:**
- `TaskDialog.whenOptions(todayStr) -> [{key:'today'|'tomorrow'|'nextmon'|'pick'|'none', label, due}]` — labels `Today`, `Tomorrow`, `Next Mon`, `Pick date…`, `No date`; `due` is the resolved date (`''` for none, `null` for pick).
- `TaskDialog.whenKeyForDue(due, todayStr) -> key` — `''`→`none`, today/tomorrow/nextMonday → their key, anything else → `pick`.
- `TaskDialog.whenCaption(key, due) -> string` — `Due Mon Nov 16` (format `ddd MMM D` computed without moment) / `No date: goes to the backlog` / `Pick a date`.
- `TaskDialog.recentProjects(parsedTasks, todayStr, limit=6) -> string[]` — project display names among tasks with `created_at` within 30 days, by count desc then most recent `created_at`.
- `TaskDialog.defaultsForSurface({surface:'home', today})` → same as `daily` (`{ due: today, source: 'daily' }`).
- [ ] **Step 1: Failing tests** `RD-DH-WHEN` (Monday 2026-11-09: options' dues `2026-11-09`, `2026-11-10`, `2026-11-16`, `null`, `''`), `RD-DH-KEY` (5 cases incl. `2026-11-20`→`pick`), `RD-DH-CAPTION` (`whenCaption('nextmon','2026-11-16') === 'Due Mon Nov 16'`), `RD-DH-RECENT` (fixture of 8 tasks over 40 days with ties → exact expected array), `RD-DH-HOME`.
- [ ] **Step 2–4:** run `node platform/test/run-todo-dialog.js` (FAIL → implement → PASS).
- [ ] **Step 5: Commit** `feat(task-entity): add when/recent-project helpers for the task dialog`

---

### Task 5: Dialog layout

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (`_render`, ~:627–1180; keep `_payloadFromState`, save/edit/done/delete paths)
- Test: extend `platform/test/run-todo-dialog.js` (section `RD-D-*`, using its existing modal/DOM stubs)

**Interfaces:**
- Consumes: Task 1 `parseTitleShortcuts`, Task 4 helpers, existing `_loadProjectList(app)`.
- Produces: DOM contract (classes the tests and CSS rely on): `.sauce-task-dialog-cols` (two children `.sauce-task-dialog-left`, `.sauce-task-dialog-right`), `.sauce-task-when` buttons with `data-key`, `.sauce-task-prio` buttons with `data-prio`, `.sauce-task-project-search` input + `.sauce-task-project-chip` buttons, `.sauce-task-repeat-toggle`, footer `.sauce-task-open-after` checkbox, `.sauce-task-add-another`, primary `.sauce-task-save`.
- Behaviour (spec §4): When default from `defaultsForSurface` (`today` key for daily/home/manual with `opts.today`; `none` for project/meeting/trip); Pick reveals an inline `<input type=date>`; priority keys `0`–`4` when focus is not in an input/textarea; project chip toggles; search filters `_loadProjectList` names (case-insensitive substring, max 8 results); title shortcuts applied on every input event to the right column and stripped on submit; `Create & add another` saves then clears title+notes, keeps when/priority/project, refocuses title; `⌘↵`/`Ctrl↵` submits from anywhere in the dialog; open-after-create preference in `localStorage['sauce-task-dialog:open-after']` (default `'1'`, try/catch guarded) — when off, create does not open the note; edit mode starts with the Repeats section expanded when a recurrence exists (keep `_moreOptionsShouldStartExpanded` semantics for recurrence/links/notes); injected CSS includes `@media (max-width: 720px)` stacking `.sauce-task-dialog-cols` to one column; footer is outside the scrolling body.
- [ ] **Step 1: Failing tests** `RD-D-COLS`, `RD-D-WHEN-DEFAULT` (daily → today selected; project → none), `RD-D-WHEN-PICK` (click nextmon → payload due `2026-11-16`), `RD-D-PRIO-KEY` (keydown `3` on dialog body → high), `RD-D-SHORTCUT` (title `X next mon !high #Alpha` → right column reflects; payload title `X`), `RD-D-ADD-ANOTHER` (two creates, second keeps project, title cleared), `RD-D-OPEN-AFTER` (pref `'0'` → no open call), `RD-D-CMDENTER`, `RD-D-EDIT-HYDRATE` (edit task due 2026-11-20 → `pick` selected and date input shows it; save with changed due writes `rank:''`), `RD-D-NARROW` (CSS text contains the 720px rule stacking the columns).
- [ ] **Step 2–4:** FAIL → implement → `run-todo-dialog.js`, `run-task-entity.js` (dialog sections), `scripts/lint-gesture-writes.js` PASS. Update existing dialog assertions that pinned the old `More options ▾` layout, one per obsolete behaviour.
- [ ] **Step 5: Commit** `feat(task-entity): two-column task dialog with quick dates and shortcuts`

---

### Task 6: Home header

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js` (~:488–700 header + capture), `platform/blueprints/home/helpers/sauce-home.css`
- Test: `platform/test/run-home.js` (replace capture-input sections; keep render guards)

**Interfaces:**
- Consumes: `TaskDialog.open({ surface: 'home', today })` (Task 4 default).
- Produces: header right cluster `.sauce-home-new-task` (accent button, label `New task`) and `.sauce-home-capture-toggle` (label `Capture`) opening a dropdown of `_captureSpec()` buttons (unchanged keys/dispatch). The "Jot a task…" input, its `createQuick` path, optimistic preview and capture pending-state are removed from Home. Glance chips gain `backlog` (`N backlog`, after `done`) when > 0, computed from the dashboard's task data via `TaskEntity.isBacklog`; clicking it opens today's to-do note (existing navigation helper used by the chrome bar) — the daily view reads `?tab` from nowhere, so instead write `localStorage['sauce-todo-filter:prefs:v2'].tab = 'backlog'` (Task 8 key) before navigating.
- [ ] **Step 1: Failing tests** `HOME-NEWTASK` (one `.sauce-home-new-task`; click → `TaskDialog.open` called with `{surface:'home', today}`), `HOME-CAPTURE-MENU` (toggle reveals Meeting/Sticky Note/Article/Journal/Trip in that order), `HOME-NO-JOT` (no `.sauce-home-capture-input` anywhere; `createQuick` never called), `HOME-GLANCE-BACKLOG`.
- [ ] **Step 2–4:** FAIL → implement → `node platform/test/run-home.js`, `run-home-render-guards.js`, `run-home-chrome-bar.js` PASS. Remove obsolete HOME-RENDER-8/inline-capture assertions (they encode the removed feature).
- [ ] **Step 5: Commit** `feat(home): New task button opens the full dialog; captures move to a menu`

---

### Task 7: Today panel (Home + today's daily note)

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js` (`selectTasks` ~:176, task panel ~:600–720)
- Test: `platform/test/run-daily-dashboard.js` (new section `RD-P-*`)

**Interfaces:**
- Consumes: Task 1 (`bucketOf`, `compareBy`, `completedDay`, `isBacklog`), Task 2 (`reschedule`, `reopen`, `setFields`), Task 3 `renderTaskRow` options.
- Produces:
  - `SpaceDailyDashboard.selectTasks(dv, todayStr, TE)` additionally returns `stale: []`, `doneToday: []` (parsed `_done/` tasks with `completedDay === todayStr`, newest first), `backlog: number`; `overdue` now holds only `overdue` bucket.
  - `SpaceDailyDashboard.isLivePanel(viewedDay, todayStr) -> boolean` (equal).
  - When live: sections `Up next` (today tasks sorted by the shared sort pref `prefs.sort`, default `smart`; rows `dragHandle` when sort is `smart|manual`; drop renumbers via `setFields(path,{rank:i+1})` for changed rows only), `Overdue · N` with `Move all to today` (sequential `reschedule(..., todayStr)`), `Stale · N` (rows dimmed `.is-stale`, each with inline `Backlog` (→ `reschedule(..., '')`) and `Pick a date` buttons, header `Triage` opens today's to-do note with prefs tab `overdue`), `Done today · N` (struck rows, time `HH:mm`, `Undo` → `reopen`), footer link `Open done log` → Completed Tasks hub path used by `ToDoChromeBar`. Rows via `TaskTodayList.renderTaskRow`; if TaskTodayList is missing, fall back to the existing bullet renderer.
  - When not live: the current panel, byte-for-byte behaviour (existing tests stay green).
  - Sort/Group controls (`Sort: <mode> ▾`, `Group: <mode> ▾`) read/write the Task 8 prefs key.
- [ ] **Step 1: Failing tests** `RD-P-LIVE-GATE` (past date → old panel markup; today → sections), `RD-P-SECTIONS` (fixture with today/overdue 7/stale 40/done-today/backlog → counts and order of section labels), `RD-P-DONE-UNDO` (Undo calls `reopen` with the `_done/` path), `RD-P-MOVEALL` (2 overdue → 2 `reschedule` calls with todayStr), `RD-P-RANK-DROP` (simulate drop of row 3 to index 0 → `setFields` calls only for moved rows with ranks 1..n), `RD-P-ALL-SOURCES` (a project task due today appears in Up next).
- [ ] **Step 2–4:** FAIL → implement → `run-daily-dashboard.js`, `run-home.js`, `scripts/lint-gesture-writes.js` PASS.
- [ ] **Step 5: Commit** `feat(daily): sectioned today panel with stale, done-today and undo`

---

### Task 8: Daily view — tabs, sort, group, persistence, done today

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js`
- Test: `platform/test/run-todo-daily-filter-view.js` (replace scope-pill/date-keyed-state sections; keep render guards)

**Interfaces:**
- Consumes: Task 1, Task 3.
- Produces:
  - `PREFS_KEY = 'sauce-todo-filter:prefs:v2'`; state `{ tab:'today'|'week'|'overdue'|'backlog'|'all', sort: compareBy modes, group:'none'|'project'|'priority'|'due' }`, default `{tab:'today', sort:'smart', group:'none'}`; not keyed by date; legacy `sauce-todo-filter:state` ignored.
  - `ToDoDailyFilterView.selectTab(tasks, tab, todayStr)` — today: bucket today; week: open tasks due Mon..Sun of today's ISO week (excluding overdue/stale); overdue: overdue then stale (stale after a divider); backlog: `isBacklog`; all: all open.
  - `ToDoDailyFilterView.groupTasks(tasks, group, todayStr) -> [{label, tasks}]` — project (existing `groupByProject` semantics, `No project` last), priority (Highest..None), due (`Mon Nov 9` labels, `No date` last).
  - Render: tab bar with counts on Overdue/Backlog, `Sort ▾` and `Group ▾` as Obsidian `Menu`s with the spec's one-line descriptions, list, then `Done today · N` (Today tab only).
- [ ] **Step 1: Failing tests** `RD-DV-TABS` (fixture → titles per tab), `RD-DV-WEEK` (Monday 2026-11-09 → includes due 11-13, excludes 11-16 and overdue), `RD-DV-PREFS` (written prefs survive a different note date; legacy key ignored; corrupt JSON → defaults), `RD-DV-GROUP` (three group modes exact labels/order), `RD-DV-SORT` (each mode uses `TaskEntity.compareBy`), `RD-DV-DONE` (Done today section only on Today tab).
- [ ] **Step 2–4:** FAIL → implement → `run-todo-daily-filter-view.js`, `run-todo-render-guards.js` PASS.
- [ ] **Step 5: Commit** `feat(to-do): daily view tabs, smart sort, grouping and persistent filters`

---

### Task 9: Daily view — selection, bulk bar, manual order, week strip

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js`
- Test: `platform/test/run-todo-daily-filter-view.js` (section `RD-DV-SEL-*`)

**Interfaces:**
- Consumes: Task 2 `reschedule`, `setFields`, `TaskDialog.markDone`; Task 3 row options.
- Produces:
  - `Select` toggle button; selection set keyed by path; floating `.sauce-todo-bulkbar` (`N selected`, `→ Tomorrow`, `→ Next Mon`, `Priority ▾`, `Project ▾`, `Backlog`, `Mark done`), `flex-wrap: wrap` and full-width below 720px. `ToDoDailyFilterView.runBulk(paths, action, deps) -> Promise<{done:string[], failed:string[]}>` runs sequentially; failed paths stay selected; one Notice summarizing failures.
  - Manual order: Today tab, sort `smart|manual`, group `none` → rows get `dragHandle` and `onMove`; drop/move renumbers visible rows (`rank` 1..n, writes only changed).
  - `ToDoDailyFilterView.weekStrip(tasks, todayStr) -> [{date, label, count, isToday}]` (Mon–Fri always, Sat/Sun only if count > 0); cells accept drops (`reschedule` to that date); click sets tab `week`.
  - `ToDoDailyFilterView.renumber(orderedPaths, rankByPath) -> [{path, rank}]` (pure; only changed).
- [ ] **Step 1: Failing tests** `RD-DV-SEL-BULK` (3 selected → Next Mon → 3 reschedule calls; one rejects → it stays selected), `RD-DV-BULK-WRAP` (bar CSS has `flex-wrap: wrap` and the 720px rule), `RD-DV-RENUMBER` (`['a','b','c']` with ranks `{a:1,c:2}` → `[{b,2},{c,3}]`), `RD-DV-STRIP` (counts per day; weekend cell only when populated; today flagged), `RD-DV-MOVE` (`onMove(task,-1)` on second row → renumber writes).
- [ ] **Step 2–4:** FAIL → implement → harness + `scripts/lint-gesture-writes.js` PASS.
- [ ] **Step 5: Commit** `feat(to-do): bulk actions, manual ordering and week strip on the daily view`

---

### Task 10: Done log

**Files:**
- Modify: `platform/blueprints/to-do/helpers/task-done-archive.js`
- Test: `platform/test/run-task-entity.js` `runTaskDoneArchiveTests` (update) or a new section in `run-todo-redesign-writes.js`

**Interfaces:**
- Consumes: `TaskEntity.completedDay`, `TaskDialog.reopen`, `TaskTodayList.renderTaskRow`.
- Produces (pure statics):
  - `groupByDate(tasks) -> Map<'YYYY-MM-DD', task[]>` keyed by `completedDay`, newest day first, newest first within a day (bug fix).
  - `rangeFor(preset, todayStr) -> {from, to}` for `today|yesterday|this-week|last-week|this-month` (weeks Mon–Sun).
  - `summarize(tasks, from, to) -> { total, projects: [{name, n}] (desc, 'No project' last), bars: [{label, n}] }` — daily bars when span ≤ 31 days, else weekly.
  - `filterTasks(tasks, {text, project, source, bodies}) ` — text matches title or `bodies[path]` (case-insensitive) when `text.length >= 3`.
  - `standupMarkdown(groups) -> string` — `**Fri Nov 6**\n- Title (Project)\n…` blank line between days; no project → no parens.
  - Render: range pills (default `last-week`), header `N done <range label>, across M projects`, bars + project panel, search + Project ▾ + Source ▾ (`daily|meeting|project|trip|manual`), grouped list with time + `Reopen`, `Copy as standup` (`navigator.clipboard.writeText`, Notice). Body text loaded lazily with `app.vault.cachedRead` for `_done/` files only when the query is ≥ 3 chars, cached by `path+mtime`.
- [ ] **Step 1: Failing tests** `RD-DL-GROUP` (three tasks on 11-06 at different times → one group of 3), `RD-DL-TZ` (`2026-11-06T23:30:00-07:00` → `2026-11-06`), `RD-DL-RANGE` (Monday 2026-11-09: last-week = 11-02..11-08; this-month = 11-01..11-30), `RD-DL-SUM`, `RD-DL-FILTER` (body match only at ≥3 chars), `RD-DL-STANDUP` (exact string).
- [ ] **Step 2–4:** FAIL → implement → `run-task-entity.js`, `run-todo-all-list.js` PASS.
- [ ] **Step 5: Commit** `feat(to-do): done log with ranges, project totals, body search and standup copy`

---

### Task 11: Whole-branch verification

- [ ] **Step 1:** `node platform/install.js --vault . --auto-approve` (workshop dogfood) → exits 0, no errors in output.
- [ ] **Step 2:** `npm run lint-schemas && node scripts/lint-gesture-writes.js` → PASS.
- [ ] **Step 3:** `npm run release:preflight` → `PASS — preflight (N/N)` with N = 185 + new harnesses.
- [ ] **Step 4:** `/usr/bin/git status --short` shows no stray files; `/usr/bin/git log origin/main..HEAD --format=%B | grep -i "co-authored-by: claude\|claude-session"` prints nothing.
- [ ] **Step 5:** Confirm HEAD subject starts with `feat(`; if the last commit is not `feat`, the fix lands in a commit whose subject is `feat(to-do): …`.
