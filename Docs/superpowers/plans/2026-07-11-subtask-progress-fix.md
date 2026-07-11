# Subtask Completion Bug Fix + Subtask Progress Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the task-entity SUBTASKS-section bug where a completed subtask's checkbox reappears (unchecked) and errors on a second click, and add an "N/M subtasks done" badge to every task-row surface (daily, project, meeting, and the subtask list itself).

**Architecture:** One-line query filter fix in `task-note-view.js` (the bug); one new pure grouping helper + thin `dv`-query wrapper on `TaskEntity` (`_groupSubtaskCounts` / `subtaskCountsByParent`); one new optional chip in the shared `TaskTodayList.renderTaskRow`; three call sites (daily, project, meeting) wired to compute counts once per render and attach them to each task before drawing rows.

**Tech Stack:** CustomJS (Obsidian), Dataview (`dv.pages`), Node test harness (`platform/test/run-task-entity.js`), vanilla JS (bare classes, no build step).

**Spec:** `docs/superpowers/specs/2026-07-11-subtask-progress-fix-design.md`

**Note on scope vs. the spec:** the spec says `TaskNoteView`'s progress-text computation should "switch to use the new helper." Task 3 below keeps `task-note-view.js`'s existing local query for its own `_subtaskProgressText(allSubtasks)` call (it already fetches the full non-trashed child list locally to derive `openSubtasks`, so calling the new vault-wide `subtaskCountsByParent` there too would just be a second, redundant query with no behavior change). The new helper is used by the three surfaces that do NOT already have that list: daily, project, meeting. This preserves the spec's actual intent — one correct, shared definition of "how do we count a task's subtasks" — without adding a needless duplicate query.

---

### Task 1: `TaskEntity.subtaskCountsByParent` — pure grouping + dv wrapper

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

Add these tests to `platform/test/run-task-entity.js`, immediately after the existing `TNV-sub-2` test block (search for `TNV-sub-2 _subtaskProgressText tolerates empty/null input`):

```javascript
// ---------- TaskEntity.subtaskCountsByParent (SCP-*) ----------
//
// Pure grouping core: given an array of ALREADY-PARSED tasks (parseNote
// output — parent_task already coerced to a basename string, '' when unset),
// group by parent_task and count { done, total }. Parents with zero children
// are simply absent from the map (no zero-entries) so callers can do a plain
// `counts[basename] || null` presence check.

ok('SCP-1 _groupSubtaskCounts groups children by parent_task and counts done/total', () => {
  const tasks = [
    { parent_task: 'Groceries', status: 'open' },
    { parent_task: 'Groceries', status: 'done' },
    { parent_task: 'Groceries', status: 'done' },
    { parent_task: 'Errands', status: 'open' },
  ];
  const counts = TaskEntity._groupSubtaskCounts(tasks);
  assert(deepEq(counts.Groceries, { done: 2, total: 3 }), 'Groceries: 2/3, got ' + JSON.stringify(counts.Groceries));
  assert(deepEq(counts.Errands, { done: 0, total: 1 }), 'Errands: 0/1, got ' + JSON.stringify(counts.Errands));
});

ok('SCP-2 _groupSubtaskCounts ignores tasks with no parent_task (not subtasks)', () => {
  const tasks = [
    { parent_task: '', status: 'open' },
    { parent_task: null, status: 'done' },
    { parent_task: 'Groceries', status: 'open' },
  ];
  const counts = TaskEntity._groupSubtaskCounts(tasks);
  assert(Object.keys(counts).length === 1, 'only Groceries present, got ' + JSON.stringify(counts));
  assert(deepEq(counts.Groceries, { done: 0, total: 1 }), 'Groceries: 0/1');
});

ok('SCP-3 _groupSubtaskCounts returns {} for null/non-array/empty input', () => {
  assert(deepEq(TaskEntity._groupSubtaskCounts(null), {}), 'null -> {}');
  assert(deepEq(TaskEntity._groupSubtaskCounts([]), {}), 'empty -> {}');
  assert(deepEq(TaskEntity._groupSubtaskCounts('not an array'), {}), 'non-array -> {}');
});

ok('SCP-4 _groupSubtaskCounts tolerates malformed entries without throwing', () => {
  const tasks = [null, undefined, { status: 'open' }, { parent_task: 'X' }, { parent_task: 'X', status: 'done' }];
  let counts;
  assert((() => { counts = TaskEntity._groupSubtaskCounts(tasks); return true; })(), 'never throws');
  assert(deepEq(counts.X, { done: 1, total: 2 }), 'X: 1/2 (missing status treated as open), got ' + JSON.stringify(counts.X));
});

ok('SCP-5 subtaskCountsByParent is a function (class + instance) and delegates to _groupSubtaskCounts', () => {
  assert(typeof TaskEntityClass.subtaskCountsByParent === 'function', 'static on the class');
  assert(typeof TaskEntity.subtaskCountsByParent === 'function', 'delegator on the instance');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL — `TaskEntity._groupSubtaskCounts is not a function` (SCP-1 through SCP-4), and SCP-5 fails because `subtaskCountsByParent` doesn't exist yet.

- [ ] **Step 3: Implement `_groupSubtaskCounts` and `subtaskCountsByParent`**

In `platform/mechanisms/task-entity/task-entity.js`, add an instance delegator next to the other delegators (after the `_chromeBody()` delegator line, so it's `_chromeBody() { ... }` then the two new lines):

```javascript
    _groupSubtaskCounts(parsedTasks) { return TaskEntity._groupSubtaskCounts(parsedTasks); }
    subtaskCountsByParent(dv) { return TaskEntity.subtaskCountsByParent(dv); }
```

Then add the two static methods. Place `_groupSubtaskCounts` right after `queryToday` (after its closing brace, before `nextOccurrence`), and `subtaskCountsByParent` right after `_groupSubtaskCounts`:

```javascript
    /**
     * Group an array of ALREADY-PARSED tasks (parseNote output, or any object
     * with `{ parent_task, status }`) by `parent_task` and count how many are
     * done vs. total. A task with no `parent_task` (empty string or nullish —
     * not a subtask) is skipped entirely. A parent with zero children is
     * simply ABSENT from the returned map (no zero-entries), so callers do a
     * plain `counts[basename] || null` presence check. Missing/malformed
     * `status` is treated as "open" (matches parseNote's own default). Pure,
     * null/non-array-tolerant (→ {}); never throws.
     */
    static _groupSubtaskCounts(parsedTasks) {
        const counts = {};
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t) continue;
            const parent = String(t.parent_task == null ? '' : t.parent_task).trim();
            if (!parent) continue;
            if (!counts[parent]) counts[parent] = { done: 0, total: 0 };
            counts[parent].total += 1;
            if ((t.status || 'open') === 'done') counts[parent].done += 1;
        }
        return counts;
    }

    /**
     * Live-query wrapper around `_groupSubtaskCounts`: fetches every task note
     * under `spice/tasks/` (open AND done — a subtask's total shouldn't shrink
     * once it's completed — excluding only the recoverable `_trash/`), parses
     * each via `parseNote`, and groups by parent. This is the SINGLE shared
     * definition of "how many subtasks does this task have, and how many are
     * done" for every surface that doesn't already hold the full child list
     * locally (daily, project, meeting task rows). Guarded — a missing/broken
     * `dv` or a cold-load query failure yields `{}`, never throws.
     */
    static subtaskCountsByParent(dv) {
        try {
            if (!dv || typeof dv.pages !== 'function') return {};
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.file && p.file.path
                && !p.file.path.includes('/_trash/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            const parsed = arr.map(p => TaskEntity.parseNote(p));
            return TaskEntity._groupSubtaskCounts(parsed);
        } catch (_e) {
            return {};
        }
    }
```

Also update the class docstring's "Static API" list (near the top of the file) to add:

```
 *   TaskEntity._groupSubtaskCounts(parsedTasks)  → { [parentBasename]: {done,total} }
 *   TaskEntity.subtaskCountsByParent(dv)          → { [parentBasename]: {done,total} }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node platform/test/run-task-entity.js`
Expected: PASS — all SCP-1 through SCP-5 tests pass, and the full file still reports the prior "ok N passed" count plus 5.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): add TaskEntity.subtaskCountsByParent for shared N/M subtask counting"
```

---

### Task 2: Fix the SUBTASKS-list bug in `task-note-view.js`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-note-view.js:630-668`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

This bug lives entirely inside the SUBTASKS section's browser-side `render(dv)` method, which (per this file's own existing test convention — see the "render(dv) methods are not tested" note in the harness) has no dv-stub test today. Rather than introduce a first-of-its-kind dv-stub test for this one method, pin the fix at the SOURCE-TEXT level (the same "regex over source" pattern `run-helper-cases.js` and this harness already use elsewhere for source-stable contracts). Add this test to `platform/test/run-task-entity.js`, right after the last `TNV-sub-*` test:

```javascript
// TNV-sub-3. Regression test for the "subtask checkbox reappears / double-click
// errors" bug: the SUBTASKS section's live query fetched ALL non-trashed
// children (open + done) and rendered EVERY one of them as a checkbox row. A
// completed subtask (moved to _done/ but still under spice/tasks/) would
// therefore be re-fetched and re-rendered unchecked on Dataview's next
// auto-refresh, and a second click called markDone on the now-stale path,
// throwing "task file not found". Fix: split the fetched list into
// `allSubtasks` (unfiltered — feeds the N/M progress count, unchanged) and
// `openSubtasks` (status === 'open' — the ONLY thing passed to the row-render
// loop). Source-text assertion (this method's dv dependency has no dv-stub
// test in this harness; see TaskTodayList/TaskProjectList/TaskMeetingList
// render() for the same convention).
ok('TNV-sub-3 SUBTASKS section renders only status===open children as rows (regression)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'task-entity', 'task-note-view.js'), 'utf8');
  const m = /if\s*\(!isSubtask\s*&&\s*filePath\)\s*\{([\s\S]*?)\n\s+\}\s*catch\s*\(_e\)\s*\{\s*\/\*\s*SUBTASKS section best-effort/;
  const sectionMatch = m.exec(src);
  assert(sectionMatch, 'SUBTASKS section block found in task-note-view.js');
  const section = sectionMatch[1];
  assert(/openSubtasks\s*=\s*allSubtasks\.filter/.test(section),
    'openSubtasks must be derived by filtering allSubtasks (status===open), got section:\n' + section);
  assert(/for\s*\(const st of openSubtasks\)/.test(section),
    'the row-render loop must iterate openSubtasks, not the unfiltered list');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL — `SUBTASKS section block found in task-note-view.js` assertion fails, or the `openSubtasks` assertions fail (the current source has no `openSubtasks` variable).

- [ ] **Step 3: Implement the fix**

In `platform/mechanisms/task-entity/task-note-view.js`, replace the SUBTASKS section (currently lines 630-668 — the block from `if (!isSubtask && filePath) {` through the `for (const st of subtasks) { ... }` loop's closing brace):

```javascript
            if (!isSubtask && filePath) {
                try {
                    const thisBasename = filePath.split('/').pop().replace(/\.md$/i, '');
                    let allSubtasks = [];
                    try {
                        const raw = dv.pages('"spice/tasks"').where(p => {
                            if (!p || p.type !== 'task' || !p.file || !p.file.path) return false;
                            if (p.file.path.includes('/_trash/')) return false;
                            let pt = '';
                            try {
                                const TE2 = window.customJS && window.customJS.TaskEntity;
                                pt = (TE2 && typeof TE2._linkText === 'function') ? TE2._linkText(p.parent_task) : String(p.parent_task || '');
                            } catch (_e) { pt = ''; }
                            return pt === thisBasename;
                        });
                        const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
                        const TEsub = window.customJS && window.customJS.TaskEntity;
                        allSubtasks = (TEsub && typeof TEsub.parseNote === 'function') ? arr.map(p => TEsub.parseNote(p)) : [];
                    } catch (_e) { allSubtasks = []; }
                    // FIX: only OPEN subtasks are rendered as rows. Without this
                    // filter, a just-completed subtask (moved to _done/, but still
                    // under spice/tasks/ so still fetched above) reappears unchecked
                    // on Dataview's next auto-refresh, and a second click calls
                    // markDone on the now-stale path — "task file not found" error.
                    // allSubtasks (open + done) still feeds the N/M progress count
                    // below, which is correct as-is.
                    const openSubtasks = allSubtasks.filter(t => t && t.status === 'open');

                    drawDivider();
                    const subHeadRow = card.createEl('div');
                    subHeadRow.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; gap:8px;';
                    const subLabel = subHeadRow.createEl('div', { text: 'SUBTASKS' });
                    subLabel.style.cssText = 'font-size:0.68em; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);';
                    const progressText = TaskNoteView._subtaskProgressText(allSubtasks);
                    if (progressText) {
                        const prog = subHeadRow.createEl('span', { text: progressText });
                        prog.style.cssText = 'font-size:0.78em; color:var(--text-muted);';
                    }

                    const subList = card.createEl('div');
                    subList.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
                    const TTL = window.customJS && window.customJS.TaskTodayList;
                    if (TTL && typeof TTL.renderTaskRow === 'function') {
                        for (const st of openSubtasks) {
                            try { TTL.renderTaskRow(subList, st, null); } catch (_e) {}
                        }
                    }
```

Leave the `+ Add subtask` input block (everything from `const addRow = card.createEl('div');` onward, through the section's closing `} catch (_e) { /* SUBTASKS section best-effort — never break the card */ }`) unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-task-entity.js`
Expected: PASS — `TNV-sub-3` passes.

- [ ] **Step 5: Verify the CustomJS load gate still accepts the file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS (this file must still parse as a single bare-class expression — no trailing statements were introduced).

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-note-view.js platform/test/run-task-entity.js
git commit -m "fix(task-entity): SUBTASKS section only renders open children, fixing reappearing-checkbox double-click error"
```

---

### Task 3: Subtask-count chip in `TaskTodayList.renderTaskRow`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:392-401` (chip block)
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

Add these tests right after the existing `RTR-2` test block:

```javascript
// RTR-SUB-1/2. Subtask-count chip: renderTaskRow reads an OPTIONAL
// `task.subtask_count = { done, total }` (attached by the CALLER — daily /
// project / meeting render() via TaskEntity.subtaskCountsByParent — never
// queried by renderTaskRow itself, which stays dv-free per its existing
// design). When present and total > 0, render one more chip
// "{done}/{total} subtasks" with cls 'sauce-task-today-subtask-chip' so tests
// (and nothing else) can find it. Absent or total===0 → no chip.
ok('RTR-SUB-1 renderTaskRow renders the subtask-count chip when subtask_count.total > 0', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'Groceries', path: 'spice/tasks/Groceries.md', subtask_count: { done: 2, total: 5 } };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  const chip = findByClsAttr(row, 'sauce-task-today-subtask-chip');
  assert(chip, 'subtask chip exists');
  assert(chip.textContent === '2/5 subtasks', 'chip text is "2/5 subtasks", got ' + chip.textContent);
});

ok('RTR-SUB-2 renderTaskRow renders no subtask chip when subtask_count is absent or total is 0', () => {
  const container1 = makeRowStubEl('div');
  const row1 = TaskTodayList.renderTaskRow(container1, { title: 'No subtasks', path: 'spice/tasks/X.md' }, null);
  assert(!findByClsAttr(row1, 'sauce-task-today-subtask-chip'), 'no chip when subtask_count absent');

  const container2 = makeRowStubEl('div');
  const row2 = TaskTodayList.renderTaskRow(container2, { title: 'Zero total', path: 'spice/tasks/Y.md', subtask_count: { done: 0, total: 0 } }, null);
  assert(!findByClsAttr(row2, 'sauce-task-today-subtask-chip'), 'no chip when total is 0');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL — `RTR-SUB-1` fails because `findByClsAttr` returns `null` for `'sauce-task-today-subtask-chip'` (chip doesn't exist yet).

- [ ] **Step 3: Implement the chip**

In `platform/mechanisms/task-entity/task-today-list.js`, find the chip block (the `addChip` helper and its calls, currently):

```javascript
        const chips = rightCluster.createEl('div', { cls: 'sauce-task-today-chips' });
        chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center; justify-content: flex-end; flex-shrink: 0;';
        const addChip = (label) => {
            const chip = chips.createEl('span', { text: label });
            chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
        };
        if (task && task.project) addChip(TaskTodayList._projectChipText(task.project));
        if (task && task.priority) addChip(String(task.priority));
        if (task && task.due) addChip('due: ' + task.due);
```

Replace it with (adds an optional `cls` param to `addChip` and one new chip call):

```javascript
        const chips = rightCluster.createEl('div', { cls: 'sauce-task-today-chips' });
        chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center; justify-content: flex-end; flex-shrink: 0;';
        const addChip = (label, cls) => {
            const chip = chips.createEl('span', { text: label, cls: cls });
            chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
        };
        if (task && task.project) addChip(TaskTodayList._projectChipText(task.project));
        if (task && task.priority) addChip(String(task.priority));
        if (task && task.due) addChip('due: ' + task.due);
        // Subtask-progress chip — OPTIONAL, attached by the caller (daily /
        // project / meeting render() via TaskEntity.subtaskCountsByParent), NOT
        // queried here (renderTaskRow stays dv-free by design). Shown only when
        // the task actually has ≥1 subtask.
        if (task && task.subtask_count && task.subtask_count.total > 0) {
            addChip(task.subtask_count.done + '/' + task.subtask_count.total + ' subtasks', 'sauce-task-today-subtask-chip');
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node platform/test/run-task-entity.js`
Expected: PASS — `RTR-SUB-1` and `RTR-SUB-2` pass, and all prior tests (including `RTR-2`, which calls `addChip` indirectly and doesn't pass a `cls`) still pass — `createEl(t, o)` in every DOM stub already tolerates `o.cls` being `undefined`.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): renderTaskRow shows an optional N/M subtasks chip"
```

---

### Task 4: Wire the daily list to compute + attach subtask counts

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:129-176` (the `render(dv)` method)

- [ ] **Step 1: Implement the wiring**

In `platform/mechanisms/task-entity/task-today-list.js`, inside `async render(dv)`, find:

```javascript
        const bands = TaskTodayList.buildBands(parsed, today);
```

Replace it with:

```javascript
        // Attach an optional subtask-count summary to each task BEFORE banding
        // it — one shared vault-wide query (TaskEntity.subtaskCountsByParent),
        // not a per-row query, so N tasks cost one extra dv.pages() call, not N.
        const subtaskCounts = (typeof TE.subtaskCountsByParent === 'function') ? TE.subtaskCountsByParent(dv) : {};
        for (const t of parsed) {
            const basename = t && t.path ? t.path.split('/').pop().replace(/\.md$/i, '') : '';
            t.subtask_count = subtaskCounts[basename] || null;
        }

        const bands = TaskTodayList.buildBands(parsed, today);
```

This has no new Node-testable surface (it's inside the un-tested `render(dv)` browser entry point, matching this file's existing convention — see `_renderRow`/`render` which also have no dv-stub tests). Correctness for this task is verified by Task 6's manual/CJS-load checks and, ultimately, real-vault verification during deploy.

- [ ] **Step 2: Verify the CustomJS load gate still accepts the file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 3: Run the full task-entity suite once more**

Run: `node platform/test/run-task-entity.js`
Expected: PASS (no behavior inside `buildBands` or `renderTaskRow` changed by this task — this only adds a call inside `render(dv)`).

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js
git commit -m "feat(task-entity): wire the daily list to show subtask-progress chips"
```

---

### Task 5: Wire the project list to compute + attach subtask counts

**Files:**
- Modify: `platform/mechanisms/task-entity/task-project-list.js:76-120` (the `render(dv)` method)

- [ ] **Step 1: Implement the wiring**

In `platform/mechanisms/task-entity/task-project-list.js`, inside `async render(dv)`, find:

```javascript
        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-project' });
```

Insert immediately before it:

```javascript
        // Attach an optional subtask-count summary to each task — one shared
        // vault-wide query, not a per-row query (mirrors TaskTodayList.render).
        const subtaskCounts = (typeof TE.subtaskCountsByParent === 'function') ? TE.subtaskCountsByParent(dv) : {};
        for (const t of parsed) {
            const basename = t && t.path ? t.path.split('/').pop().replace(/\.md$/i, '') : '';
            t.subtask_count = subtaskCounts[basename] || null;
        }

```

- [ ] **Step 2: Verify the CustomJS load gate still accepts the file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 3: Run the full task-entity suite once more**

Run: `node platform/test/run-task-entity.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/task-entity/task-project-list.js
git commit -m "feat(task-entity): wire the project task list to show subtask-progress chips"
```

---

### Task 6: Wire the meeting list to compute + attach subtask counts

**Files:**
- Modify: `platform/mechanisms/task-entity/task-meeting-list.js:64-103` (the `render(dv)` method)

- [ ] **Step 1: Implement the wiring**

In `platform/mechanisms/task-entity/task-meeting-list.js`, inside `async render(dv)`, find:

```javascript
        const mine = parsed.filter(t => TaskMeetingList._matches(t, meetingBasename));

        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-meeting' });
```

Replace it with:

```javascript
        const mine = parsed.filter(t => TaskMeetingList._matches(t, meetingBasename));

        // Attach an optional subtask-count summary to each task — one shared
        // vault-wide query, not a per-row query (mirrors TaskTodayList.render).
        const subtaskCounts = (typeof TE.subtaskCountsByParent === 'function') ? TE.subtaskCountsByParent(dv) : {};
        for (const t of mine) {
            const basename = t && t.path ? t.path.split('/').pop().replace(/\.md$/i, '') : '';
            t.subtask_count = subtaskCounts[basename] || null;
        }

        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-meeting' });
```

- [ ] **Step 2: Verify the CustomJS load gate still accepts the file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 3: Run the full task-entity suite once more**

Run: `node platform/test/run-task-entity.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/task-entity/task-meeting-list.js
git commit -m "feat(task-entity): wire the meeting task list to show subtask-progress chips"
```

---

### Task 7: Full preflight + PR

**Files:** none (verification + git/gh only)

- [ ] **Step 1: Run the full preflight suite**

Run: `npm run release:preflight`
Expected: PASS — whole-suite green bar (all harnesses, including `run-task-entity.js` and `run-customjs-loadable.js`).

- [ ] **Step 2: Self-install dogfood check**

Run: `node platform/install.js --vault . --auto-approve`
Expected: succeeds with no errors (workshop dogfoods every release).

- [ ] **Step 3: Push the branch**

```bash
git push -u origin worktree-bridge-cse_01ExEnjh1qLzBJx2KRN89Mzi
```

(This worktree's branch is already checked out — no need to create a new one.)

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "fix(task-entity): subtask completion bug + N/M subtask-progress chips" --body "$(cat <<'EOF'
## Summary
- Fixes a bug where marking a subtask Done in a parent task's SUBTASKS section left the checkbox reappearing unchecked, and a second click threw a "task file not found" error — root cause was a missing `status === 'open'` filter on that section's live query (the one surface that lacked it).
- Adds an "N/M subtasks done" progress chip to every task-row surface (daily, project, meeting, and the subtask list itself) via a new shared `TaskEntity.subtaskCountsByParent(dv)` helper.

## Test plan
- [x] `npm run release:preflight` green
- [x] `node platform/install.js --vault . --auto-approve` (workshop self-install/dogfood)
- [ ] CI green on this PR (macos-latest + ubuntu-latest)

Design spec: docs/superpowers/specs/2026-07-11-subtask-progress-fix-design.md
EOF
)"
```

---

## After this plan: release + deploy (not plan tasks — orchestration steps)

Per `Docs/agent-guides/build-test-verify.md`, once the PR above is open:

1. Wait for CI (`ci.yml`, `pull_request` trigger) to go green on both `macos-latest` and `ubuntu-latest`.
2. Merge the PR once required checks pass (squash merge via `gh pr merge --squash`) — do NOT bypass CI.
3. The release pipeline takes over automatically on `main`: it computes the version bump from the commit types (`fix(task-entity):` + `feat(task-entity):` in this PR), opens a standing release PR, and auto-merges it once its own checks pass. Do not hand-edit versions, tags, or merge the release PR.
4. After the release PR auto-merges, `tag-and-ship` tags `v<X.Y.Z>` and opens/auto-merges the Homebrew tap PR (`willfell/homebrew-sauce`).
5. Once the tap PR is merged, deploy to the three consumer vaults. `task-entity` is an EXISTING mechanism all three vaults already subscribe to (this is a version bump, not a new-component deploy — no subscription-file edits needed): run `node scripts/autoloop/deploy.js run` (brew-upgrades + `sauce update --bump-pins` per vault), or manually `brew upgrade sauce && (cd <vault> && sauce update --bump-pins)` for accuris, headspace, and ero.
6. Verify the deployed version matches the newly-tagged version in each vault (e.g. check `platform/manifest.json` or run `sauce audit` in each vault), and specifically verify in the `headspace` vault that `spice/tasks/Groceries` no longer shows the reappearing-checkbox bug.
