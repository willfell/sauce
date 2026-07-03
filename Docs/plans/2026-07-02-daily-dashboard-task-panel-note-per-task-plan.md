# Daily Dashboard task panel → note-per-task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap `SpaceDailyDashboard`'s task panel data source from raw markdown checkboxes (`page.file.tasks`) to the note-per-task task-notes under `spice/tasks/`, so the panel again shows an at-a-glance mirror of open tasks scheduled today + overdue (all sources) with an `N Open / K Done` summary.

**Architecture:** Extract the panel's data selection into a new pure static `SpaceDailyDashboard.selectTasks(dv, todayStr, TE)` (the Node-testable seam), delegating the today/overdue partition to the source-agnostic `TaskEntity.queryToday` and the row title to `TaskTodayList.renderInlineLinks`. `render()`'s `getTasks` becomes a thin adapter. Retire the obsolete raw-markdown fold helpers (`_parseTaskDue`/`_countsTowardToday`/`_foldExternalTasks`/`_renderTaskHTML`) and their tests.

**Tech Stack:** Vanilla JS CustomJS class (Obsidian + Dataview), Node zero-dep test harnesses (`platform/test/run-*.js`).

**Design doc:** `Docs/plans/2026-07-02-daily-dashboard-task-panel-note-per-task-design.md`

**Working tree:** git worktree `.worktrees/daily-dashboard-task-notes` on branch `fix/daily-dashboard-task-notes` (off `origin/main` @ v0.181.1). Run all commands from the worktree root.

---

## File Structure

- **Modify** `platform/blueprints/daily/helpers/space-daily-dashboard.js` — add `selectTasks` static; rewire `render()`'s `getTasks` closure + task-list rendering; remove `_parseTaskDue`, `_countsTowardToday`, `_foldExternalTasks`, `_renderTaskHTML`, `config.todoPaths`, `config.externalTaskPaths`.
- **Modify** `platform/test/run-renderer.js` — add faithful `testSelectTasksNotePerTask`; update `HC-V0843-A1`; remove `testRendV01241Link1` (`_renderTaskHTML`).
- **Modify** `platform/test/run-helper-cases.js` — remove the `DD-A9` fold-helper block.
- **Regenerate (do not hand-edit)** `ranch/scripts/daily/space-daily-dashboard.js` — the workshop dogfood copy; re-materialized by `node platform/install.js --vault . --auto-approve` (Task 3) to stay byte-equal (`HC-V0842-A1`).

---

## Task 1: Add the `selectTasks` static + its faithful data test

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js`
- Test: `platform/test/run-renderer.js`

- [ ] **Step 1: Write the failing test**

In `platform/test/run-renderer.js`, add this function (place it near the other `daily`-group test functions, e.g. just before `testRendV067Time1`):

```javascript
// SELTASK-1 — faithful test of the note-per-task data seam. Loads the REAL
// SpaceDailyDashboard + TaskEntity classes and drives SpaceDailyDashboard.selectTasks
// through a plain-array dv-stub returning task-note-shaped pages. Exercises the ACTUAL
// selection path (not a hand-built replica) — the class of bug this file exists to catch.
async function testSelectTasksNotePerTask() {
  const fs = require("fs");
  const path = require("path");
  const sddSrc = fs.readFileSync(path.resolve(__dirname,
    "../../platform/blueprints/daily/helpers/space-daily-dashboard.js"), "utf8");
  const teSrc = fs.readFileSync(path.resolve(__dirname,
    "../../platform/mechanisms/task-entity/task-entity.js"), "utf8");
  const SDD = new Function(`${sddSrc}\nreturn SpaceDailyDashboard;`)();
  const TaskEntity = new Function(`${teSrc}\nreturn TaskEntity;`)();
  const TE = new TaskEntity(); // customJS stores INSTANCES; delegators call the statics

  const today = "2026-07-02";
  const pagesByQuery = {
    '"spice/tasks"': [
      { type: "task", status: "open", scheduled: "2026-07-02", title: "daily today", source: "daily",   file: { path: "spice/tasks/daily-today.md" } },
      { type: "task", status: "open", scheduled: "2026-07-02", title: "proj today",  source: "project", project_slug: "connectors", file: { path: "spice/tasks/proj-today.md" } },
      { type: "task", status: "open", scheduled: "2026-06-30", title: "mtg overdue", source: "meeting",  file: { path: "spice/tasks/mtg-overdue.md" } },
      { type: "task", status: "open", scheduled: "2026-07-05", title: "future",       file: { path: "spice/tasks/future.md" } },
      { type: "task", status: "open", scheduled: "",           title: "someday",      file: { path: "spice/tasks/someday.md" } },
      { type: "task", status: "done", scheduled: "2026-07-02", title: "leaked done",  file: { path: "spice/tasks/_done/leaked.md" } },
      { type: "task", status: "open", scheduled: "2026-07-02", title: "trashed",      file: { path: "spice/tasks/_trash/trashed.md" } },
      { type: "note", status: "open", scheduled: "2026-07-02", title: "not a task",   file: { path: "spice/tasks/note.md" } },
    ],
    '"spice/tasks/_done"': [
      { type: "task", status: "done", completed_at: "2026-07-02T09:15:00-06:00", title: "done today dt",   file: { path: "spice/tasks/_done/a.md" } },
      { type: "task", status: "done", completed_at: "2026-07-02",                title: "done today date", file: { path: "spice/tasks/_done/b.md" } },
      { type: "task", status: "done", completed_at: "2026-07-01T23:00:00-06:00", title: "done yesterday",  file: { path: "spice/tasks/_done/c.md" } },
      { type: "task", status: "done", completed_at: "",                          title: "done no date",    file: { path: "spice/tasks/_done/d.md" } },
      { type: "task", status: "done", completed_at: "2026-07-02",                title: "trashed done",    file: { path: "spice/tasks/_done/_trash/e.md" } },
    ],
  };
  const fakeDv = { pages: (q) => pagesByQuery[q] || [] };

  let ok = true;
  const check = (label, cond) => { if (!cond) { ok = false; console.log(`  FAIL: SELTASK-1 ${label}`); } };

  const res = SDD.selectTasks(fakeDv, today, TE);
  const titles = res.open.map((t) => t.title);

  check("open has exactly the 3 today/overdue tasks", res.open.length === 3);
  check("all sources present (project + meeting NOT filtered out)",
    titles.indexOf("proj today") >= 0 && titles.indexOf("mtg overdue") >= 0 && titles.indexOf("daily today") >= 0);
  check("today band rendered first (2 today, then overdue)",
    res.open[0].scheduled === "2026-07-02" && res.open[1].scheduled === "2026-07-02" && res.open[2].scheduled === "2026-06-30");
  check("today rows tagged _overdue:false", res.open[0]._overdue === false && res.open[1]._overdue === false);
  check("overdue row tagged _overdue:true", res.open[2]._overdue === true);
  check("future excluded", titles.indexOf("future") < 0);
  check("unscheduled excluded", titles.indexOf("someday") < 0);
  check("_trash excluded from open", titles.indexOf("trashed") < 0);
  check("_done leak excluded from open", titles.indexOf("leaked done") < 0);
  check("non-task type excluded", titles.indexOf("not a task") < 0);
  check("done == 2 (today incl datetime form; excl yesterday/no-date/trashed)", res.done === 2);

  const cold = SDD.selectTasks(fakeDv, today, null);
  check("cold-load (no TE) → empty open + zero done", cold.open.length === 0 && cold.done === 0);

  return ok;
}
```

Register it in the `daily`/`all` results block (find the block that pushes `REND-V067-TIME-1` etc. and add the line):

```javascript
      results.push(['SELTASK-1 selectTasks note-per-task data seam', await testSelectTasksNotePerTask()]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-renderer.js daily`
Expected: FAIL — `SELTASK-1` errors/red because `SpaceDailyDashboard.selectTasks` is not a function yet.

- [ ] **Step 3: Add the `selectTasks` static**

In `platform/blueprints/daily/helpers/space-daily-dashboard.js`, insert this method immediately BEFORE `async render(dv) {` (right after the closing `}` of `_foldExternalTasks`, which stays for now):

```javascript
  /**
   * Note-per-task migration: SELECT the task-notes for the dashboard's at-a-glance
   * task panel. Pure + Node-testable (dv-stub + a real TaskEntity ref) — the
   * render() `getTasks` closure is just the adapter passing the live dv +
   * customJS.TaskEntity. Returns { open, done }:
   *   open — parsed task objects (TaskEntity.parseNote), today-first then overdue,
   *          each tagged `_overdue`. Partitioned by TaskEntity.queryToday, which is
   *          SOURCE-AGNOSTIC (scheduled==today | scheduled<today; future + unscheduled
   *          excluded). We use queryToday, NOT TaskTodayList.buildBands, because
   *          buildBands drops project_slug/source==meeting tasks (they render in the
   *          TO-DO note's own sections) — the dashboard mirror wants ALL sources.
   *   done — count of _done/ task-notes whose completed_at DATE == today (done-TODAY
   *          only; all-done would grow unbounded with vault history).
   * Filtering is done in plain JS AFTER dv.pages() (not via DataArray .where) so a
   * plain-array dv-stub exercises the real path. No TE (cold load / mechanism not
   * registered) → { open: [], done: 0 }; the panel simply hides. Never throws.
   */
  static selectTasks(dv, todayStr, TE) {
    if (!TE || typeof TE.parseNote !== "function" || typeof TE.queryToday !== "function") {
      return { open: [], done: 0 };
    }
    const toArr = (q) => {
      try {
        const r = dv.pages(q);
        if (!r) return [];
        if (typeof r.array === "function") return r.array();
        return Array.from(r);
      } catch (_e) { return []; }
    };

    // Open — all sources, excluding the _done/ + _trash/ archives.
    const openParsed = [];
    for (const p of toArr('"spice/tasks"')) {
      if (!p || p.type !== "task" || p.status !== "open") continue;
      const path = p.file && p.file.path;
      if (!path || path.includes("/_trash/") || path.includes("/_done/")) continue;
      openParsed.push(TE.parseNote(p));
    }
    const bands = TE.queryToday(openParsed, todayStr);
    const open = [];
    for (const t of bands.today)   open.push(Object.assign({}, t, { _overdue: false }));
    for (const t of bands.overdue) open.push(Object.assign({}, t, { _overdue: true }));

    // Done today — _done/ notes with completed_at date == today.
    let done = 0;
    for (const p of toArr('"spice/tasks/_done"')) {
      if (!p || p.type !== "task") continue;
      const path = p.file && p.file.path;
      if (!path || path.includes("/_trash/")) continue;
      if (TE._toDateStr(p.completed_at) === todayStr) done++;
    }

    return { open, done };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-renderer.js daily`
Expected: PASS — `SELTASK-1 selectTasks note-per-task data seam` green, no `FAIL: SELTASK-1` lines. (Other `daily`-group tests still green; `REND-V01241-LINK-1` still green — `_renderTaskHTML` untouched this task.)

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/daily/helpers/space-daily-dashboard.js platform/test/run-renderer.js
git commit -m "test(daily): faithful selectTasks note-per-task data seam + static"
```

---

## Task 2: Rewire `render()` to `selectTasks`; swap rendering; retire the raw-markdown helpers

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js`
- Modify: `platform/test/run-renderer.js` (update `HC-V0843-A1`; remove `testRendV01241Link1`)
- Modify: `platform/test/run-helper-cases.js` (remove `DD-A9`)

- [ ] **Step 1: Replace the `config` object — drop the retired paths**

Find:

```javascript
    const config = {
      meetingsPath: "spice/meetings/notes",
      todoPaths: ["spice/to-do"],
      // Card "To Do number ... for all": project + meeting notes whose tasks
      // (due today or overdue) also feed the daily To-Do count.
      externalTaskPaths: ["spice/projects", "spice/meetings/notes"]
    };
```

Replace with:

```javascript
    const config = {
      meetingsPath: "spice/meetings/notes",
    };
```

- [ ] **Step 2: Replace the `getTasks` closure with the `selectTasks` adapter**

Find the whole `const getTasks = () => { … };` block (the closure that loops `config.todoPaths` + `config.externalTaskPaths`) and replace it with:

```javascript
    // Note-per-task migration: the panel mirrors open task-NOTES scheduled today +
    // overdue (all sources) + a done-today count. Data selection lives in the pure
    // static selectTasks (Node-tested via SELTASK-1); this closure is just the dv
    // adapter that passes the live customJS.TaskEntity.
    const getTasks = () => {
      const TE = (typeof customJS !== "undefined" && customJS) ? customJS.TaskEntity : null;
      return SpaceDailyDashboard.selectTasks(dv, today, TE);
    };
```

- [ ] **Step 3: Update the destructure + `hasContent` gate**

Find:

```javascript
    const { open: openTasks, done: doneTasks } = getTasks();
```

Replace with:

```javascript
    const { open: openTasks, done: doneCount } = getTasks();
```

Find:

```javascript
    const hasContent = meetings.length > 0 || openTasks.length > 0 || doneTasks.length > 0 || activityCount > 0;
```

Replace with:

```javascript
    const hasContent = meetings.length > 0 || openTasks.length > 0 || doneCount > 0 || activityCount > 0;
```

- [ ] **Step 4: Update the pills block (done is now a count)**

Find:

```javascript
    if (openTasks.length > 0 || doneTasks.length > 0) {
```

Replace with:

```javascript
    if (openTasks.length > 0 || doneCount > 0) {
```

Find:

```javascript
      let tasksRightHtml;
      if (openTasks.length > 0 && doneTasks.length > 0) {
        tasksRightHtml =
          `<span class="sauce-section-open-pill">${openTasks.length} Open</span>` +
          `<span class="sauce-section-done-pill">${doneTasks.length} Done</span>`;
      } else if (openTasks.length > 0) {
        tasksRightHtml = `<span class="sauce-section-open-pill">${openTasks.length} Open</span>`;
      } else {
        tasksRightHtml = `<span class="sauce-section-done-pill">${doneTasks.length} Done</span>`;
      }
```

Replace with:

```javascript
      let tasksRightHtml;
      if (openTasks.length > 0 && doneCount > 0) {
        tasksRightHtml =
          `<span class="sauce-section-open-pill">${openTasks.length} Open</span>` +
          `<span class="sauce-section-done-pill">${doneCount} Done</span>`;
      } else if (openTasks.length > 0) {
        tasksRightHtml = `<span class="sauce-section-open-pill">${openTasks.length} Open</span>`;
      } else {
        tasksRightHtml = `<span class="sauce-section-done-pill">${doneCount} Done</span>`;
      }
```

- [ ] **Step 5: Replace the task-list rendering (renderInlineLinks + overdue marker + click → note)**

Find the whole `if (openTasks.length > 0) { … }` block that builds the `<ul>` (the one whose `<li>` does `li.innerHTML = this._renderTaskHTML(task.text)` and wires wikilink anchors). Replace it with:

```javascript
      // v0.13.1: body iterates open tasks only. Done tasks are surfaced via the
      // header count; their notes stay in spice/tasks/_done/.
      if (openTasks.length > 0) {
        const tasksList = tasksBody.createEl("ul");
        tasksList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";

        // Deterministic inline-link renderer from the task-entity mechanism — real
        // <a> for [[wl]] / [md](url) / bare URLs (task titles can carry links). NOT
        // MarkdownRenderer (absent in the customJS eval context → raw text). Falls
        // back to plain text if TaskTodayList isn't registered yet (cold load).
        const TTL = (typeof customJS !== "undefined" && customJS) ? customJS.TaskTodayList : null;

        for (const task of openTasks) {
          const li = tasksList.createEl("li");
          li.style.cssText = "margin: 6px 0; font-size: 0.9em; cursor: pointer; word-break: break-word; overflow-wrap: anywhere;";

          const titleSpan = li.createEl("span");
          const titleText = (task && task.title) || "(untitled)";
          if (TTL && typeof TTL.renderInlineLinks === "function") {
            TTL.renderInlineLinks(titleSpan, titleText, task.path);
          } else {
            titleSpan.textContent = titleText;
          }

          // Overdue marker — appended AFTER the title span (renderInlineLinks clears
          // its target element, so a sibling tag survives the rebuild).
          if (task && task._overdue) {
            const tag = li.createEl("span");
            tag.textContent = "overdue";
            tag.style.cssText = "margin-left: 6px; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-red, #e05252);";
          }

          // Row click → open the task NOTE (read-mostly mirror; the note carries its
          // own edit affordance). Ignore clicks that land on an inner <a> so opening
          // a title link doesn't ALSO navigate to the note.
          li.onclick = (e) => {
            if (e.target && (e.target.tagName === "A" || (e.target.closest && e.target.closest("a")))) return;
            if (task && task.path) app.workspace.openLinkText(task.path, "");
          };
        }
      }
```

- [ ] **Step 6: Delete the retired static helpers**

Delete the three static methods `_parseTaskDue`, `_countsTowardToday`, and `_foldExternalTasks` (the contiguous block from the `// Pull an ISO date …` comment above `static _parseTaskDue(text) {` through the closing `}` of `_foldExternalTasks`). Also delete the now-stale lead-in comment block just above them that begins `// Card "To Do number on daily note …"` and describes "external" tasks feeding the pill.

- [ ] **Step 7: Delete the retired `_renderTaskHTML` method**

Delete the entire `_renderTaskHTML(text) { … }` method (its JSDoc `/** v0.5.1 … */` through the method's closing `}`), near the end of the class. Nothing calls it after Step 5.

- [ ] **Step 8: Update `HC-V0843-A1` in `run-renderer.js`**

Find:

```javascript
    assertTrue("HC-V0843-A1 getTasks still splits open/done",
      /const\s+open\s*=\s*\[\]/.test(sddSrc) && /const\s+done\s*=\s*\[\]/.test(sddSrc),
      "v0.84.1 open/done split must remain; pill rendering depends on the two arrays");
```

Replace with:

```javascript
    assertTrue("HC-V0843-A1 selectTasks is the note-per-task data seam returning { open, done }",
      /static\s+selectTasks\s*\(/.test(sddSrc) && /return\s*\{\s*open\s*,\s*done\s*\}/.test(sddSrc),
      "selectTasks must select task-notes and return an open list + a done count (pills read openTasks.length + doneCount)");

    assertTrue("HC-V0843-A1b selectTasks queries spice/tasks (open) + _done (done-today) via queryToday",
      /"spice\/tasks"/.test(sddSrc) && /"spice\/tasks\/_done"/.test(sddSrc) && /queryToday/.test(sddSrc),
      "selectTasks must query spice/tasks + spice/tasks/_done and partition open tasks via the source-agnostic TaskEntity.queryToday");

    assertTrue("HC-V0843-A1c task rows render via TaskTodayList.renderInlineLinks + open the note",
      /renderInlineLinks/.test(sddSrc) && /openLinkText\(task\.path/.test(sddSrc),
      "task rows must render titles via the canonical inline-link renderer and click through to the task note (task.path)");
```

- [ ] **Step 9: Remove the `_renderTaskHTML` test (`REND-V01241-LINK-1`) from `run-renderer.js`**

Delete the `testRendV01241Link1` function definition AND its registration line:

```javascript
      results.push(['REND-V01241-LINK-1 _renderTaskHTML balanced-paren scan for link URLs', await testRendV01241Link1()]);
```

- [ ] **Step 10: Remove the `DD-A9` fold-helper block from `run-helper-cases.js`**

Delete the `DD-A9` block — every assertion referencing `_parseTaskDue`, `_countsTowardToday`, or `_foldExternalTasks` (the contiguous case, including its `console.log("\n--- Case DD-A9 …")` header if present and the `D._parseTaskDue(...)` / `D._countsTowardToday(...)` / `D._foldExternalTasks(...)` assert lines). Leave the surrounding `DD-A*` cases intact.

- [ ] **Step 11: Run the affected harnesses**

Run: `node platform/test/run-renderer.js && node platform/test/run-helper-cases.js && node platform/test/run-customjs-loadable.js`
Expected: all three GREEN. `SELTASK-1`, `HC-V0843-A1/A1b/A1c` pass; no reference to removed helpers remains; CJS-LOAD confirms the class still registers (bare-class invariant intact — no trailing statements added).

- [ ] **Step 12: Commit**

```bash
git add platform/blueprints/daily/helpers/space-daily-dashboard.js platform/test/run-renderer.js platform/test/run-helper-cases.js
git commit -m "fix(daily): dashboard task panel reads note-per-task task-notes"
```

---

## Task 3: Re-materialize the workshop dogfood copy (byte-equality)

**Files:**
- Regenerate: `ranch/scripts/daily/space-daily-dashboard.js` (via self-install; do NOT hand-edit)

- [ ] **Step 1: Run the workshop self-install (dogfood)**

Run: `node platform/install.js --vault . --auto-approve`
Expected: install succeeds (~4s, no errors in output). It re-materializes `ranch/scripts/daily/space-daily-dashboard.js` from the updated canonical helper.

- [ ] **Step 2: Confirm canonical ≡ dogfood**

Run: `diff platform/blueprints/daily/helpers/space-daily-dashboard.js ranch/scripts/daily/space-daily-dashboard.js && echo "BYTE-EQUAL"`
Expected: prints `BYTE-EQUAL` (no diff).

- [ ] **Step 3: Confirm `HC-V0842-A1` passes**

Run: `node platform/test/run-renderer.js 2>&1 | grep -E "HC-V0842-A1|SELTASK-1"`
Expected: both show `PASS`.

- [ ] **Step 4: Commit (only if the dogfood copy changed)**

```bash
git add ranch/scripts/daily/space-daily-dashboard.js
git commit -m "chore(daily): re-materialize dashboard dogfood copy after note-per-task swap"
```

(If `git status --porcelain ranch/scripts/daily/space-daily-dashboard.js` is empty, the install left it byte-equal already — skip this commit. Also check `git status --porcelain` for any OTHER files the self-install touched, e.g. `platform-installed.json`; stage + commit those in this same commit if present, since dogfood state is expected to advance.)

---

## Task 4: Full preflight + bumped-state validation

**Files:** none (verification only)

- [ ] **Step 1: Full local preflight**

Run: `npm run release:preflight`
Expected: whole-suite GREEN (all 32+ harnesses). If `run-seed-migrations` is the ONLY red and the diff is unrelated to this change, stop and report — do NOT rebaseline the seed (it's a manual, reviewed action).

- [ ] **Step 2: Bumped-state preflight (catches release-PR wedges)**

Ensure the tree is clean first: `git status --porcelain` → empty.
Run: `npm run release:preflight-bumped`
Expected: GREEN on the bumped tree, then it hard-restores the working tree. This proves `prepare-release` won't wedge after merge.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin fix/daily-dashboard-task-notes
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "fix(daily): dashboard task panel reads note-per-task task-notes" \
  --body "$(cat <<'EOF'
Swaps `SpaceDailyDashboard`'s task panel data source from raw markdown checkboxes (`page.file.tasks`, now always empty post note-per-task migration) to the task-notes under `spice/tasks/`.

- New pure static `SpaceDailyDashboard.selectTasks(dv, today, TE)` — the Node-testable seam. Open = task-notes scheduled today + overdue across ALL sources (via source-agnostic `TaskEntity.queryToday`, deliberately NOT `TaskTodayList.buildBands` which is personal-only). Done = `_done/` notes completed today.
- Row titles render via `TaskTodayList.renderInlineLinks` (real anchors; no MarkdownRenderer). Overdue rows marked. Row click opens the task NOTE.
- Retires the obsolete raw-markdown fold helpers (`_parseTaskDue`/`_countsTowardToday`/`_foldExternalTasks`/`_renderTaskHTML`) + their tests.
- Faithful `SELTASK-1` test drives the real `selectTasks` through a dv-stub + real `TaskEntity`.

Design + plan: `Docs/plans/2026-07-02-daily-dashboard-task-panel-note-per-task-{design,plan}.md`.
EOF
)"
```

- [ ] **Step 5: Report the PR number + CI status** back to the orchestrator (do not merge here — merge is driven by the orchestrator after CI is green).

---

## Self-Review (author checklist — completed)

- **Spec coverage:** selectTasks (Q3 unify), queryToday all-sources (Q4 overdue + all-sources), done-today count (Q2), row click → note (Q1), flat list + overdue marker (Q4 layout), conditional section (Q5 empty state), retire fold helpers + `_renderTaskHTML`, faithful test, dogfood sync, preflight + bumped. All mapped.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- **Type consistency:** `selectTasks(dv, todayStr, TE) → { open: [<parsed ⊕ _overdue>], done: <number> }`; `render()` destructures `{ open: openTasks, done: doneCount }`; pills + `hasContent` + section-condition all use `doneCount` (number) and `openTasks.length`. `_overdue` flag consumed by the render loop. Names consistent across tasks.
