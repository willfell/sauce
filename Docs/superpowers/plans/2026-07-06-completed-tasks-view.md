# Completed Tasks View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsed "Completed today" section to the daily To-Do note and a new date-grouped, searchable "Completed Tasks" hub note showing all completed task-entity notes from `spice/tasks/_done/`.

**Architecture:** `TaskDoneTodayList` (new class in the `task-entity` mechanism) handles the daily collapsed section; `TaskDoneArchive` (new class in the `to-do` blueprint helpers) handles the searchable archive hub. Both query `spice/tasks/_done/`, parse notes via `TaskEntity.parseNote`, and render rows using `TaskTodayList.renderTaskRow`. Both manifests are updated to register the new classes and files.

**Tech Stack:** CustomJS bare classes (no trailing statements), Dataview `dv.pages()`, existing `TaskEntity`/`TaskTodayList`/`DocSearch`/`SectionLabel` cross-class calls, Node.js test harness (same pattern as `run-task-entity.js`).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `platform/mechanisms/task-entity/task-done-today-list.js` | Static `filterToday` + `render()` collapsed section for daily note |
| Create | `platform/blueprints/to-do/helpers/task-done-archive.js` | Static `groupByDate`/`filterByText` + `render()` archive hub |
| Create | `platform/blueprints/to-do/templates/Completed Tasks.md` | New hub note template |
| Modify | `platform/blueprints/to-do/templates/Today To-Do.md` | Append `TaskDoneTodayList` widget block |
| Modify | `platform/mechanisms/task-entity/manifest.json` | Register `TaskDoneTodayList` in `customjs_classes` + `files` |
| Modify | `platform/blueprints/to-do/manifest.json` | Register `TaskDoneArchive` in `customjs_classes` + `files` + new template entry |
| Modify | `platform/test/run-task-entity.js` | Add TDTL-1..4 + TDARCH-1..6 test suites |
| Modify | `platform/test/run-task-entity-render-guards.js` | Add cold-load render guard for `TaskDoneTodayList` |
| Modify | `platform/test/run-todo-render-guards.js` | Add cold-load render guard for `TaskDoneArchive` |

---

## Task 1: `TaskDoneTodayList` static helper — TDD

**Files:**
- Create: `platform/mechanisms/task-entity/task-done-today-list.js`
- Modify: `platform/test/run-task-entity.js`

- [ ] **Step 1: Add the failing TDTL tests to `platform/test/run-task-entity.js`**

Open `platform/test/run-task-entity.js`. Add this block immediately before the final `(async () => {` IIFE at the bottom of the file:

```js
// ---------- TDTL: TaskDoneTodayList static helpers ----------
function runTaskDoneTodayListTests() {
  const TaskDoneTodayListClass = loadClass(
    'mechanisms/task-entity/task-done-today-list.js', 'TaskDoneTodayList');
  const TDTL = new TaskDoneTodayListClass();

  ok('TDTL-1 filterToday returns tasks where completed_at === todayStr', () => {
    const tasks = [
      { title: 'A', completed_at: '2026-07-06' },
      { title: 'B', completed_at: '2026-07-06' },
      { title: 'C', completed_at: '2026-07-05' },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 2, 'expected 2 tasks, got ' + result.length);
    assert(result[0].title === 'A', 'first task title');
    assert(result[1].title === 'B', 'second task title');
  });

  ok('TDTL-2 filterToday excludes tasks completed on other dates', () => {
    const tasks = [
      { title: 'Yesterday', completed_at: '2026-07-05' },
      { title: 'Old', completed_at: '2026-06-01' },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 0, 'expected 0, got ' + result.length);
  });

  ok('TDTL-3 filterToday excludes tasks with null completed_at', () => {
    const tasks = [
      { title: 'NullDate', completed_at: null },
      { title: 'EmptyDate', completed_at: '' },
      { title: 'Today', completed_at: '2026-07-06' },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 1, 'expected 1, got ' + result.length);
    assert(result[0].title === 'Today', 'only Today task returned');
  });

  ok('TDTL-4 filterToday returns [] on null/empty input', () => {
    assert(TDTL.filterToday(null, '2026-07-06').length === 0, 'null input');
    assert(TDTL.filterToday([], '2026-07-06').length === 0, 'empty array');
    assert(TDTL.filterToday([{ title: 'X', completed_at: '2026-07-06' }], '').length === 0, 'empty todayStr');
    assert(TDTL.filterToday([{ title: 'X', completed_at: '2026-07-06' }], null).length === 0, 'null todayStr');
  });
}
```

Also add `runTaskDoneTodayListTests();` inside the IIFE, after `runReconcileTests();` and before `console.log(...)`.

- [ ] **Step 2: Run the test to confirm it fails (file doesn't exist yet)**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -20
```

Expected: error like `Cannot find module` or `FAIL TDTL-1`.

- [ ] **Step 3: Create `platform/mechanisms/task-entity/task-done-today-list.js` with the static helper**

```js
class TaskDoneTodayList {

    filterToday(parsedTasks, todayStr) { return TaskDoneTodayList.filterToday(parsedTasks, todayStr); }

    async render(dv) {
        // browser-side implementation added in Task 2
        if (!dv || !dv.container) return;
    }

    /**
     * Filter a list of parsed task objects to those completed on todayStr.
     * @param {object[]} parsedTasks — TaskEntity.parseNote output
     * @param {string} todayStr — 'YYYY-MM-DD'
     * @returns {object[]} tasks where completed_at === todayStr
     */
    static filterToday(parsedTasks, todayStr) {
        if (!Array.isArray(parsedTasks) || !todayStr) return [];
        return parsedTasks.filter(t => t && t.completed_at === todayStr);
    }
}
```

- [ ] **Step 4: Run tests to confirm TDTL-1..4 pass**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -E "TDTL|passed|failed"
```

Expected: `ok TDTL-1`, `ok TDTL-2`, `ok TDTL-3`, `ok TDTL-4`.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-done-today-list.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): TaskDoneTodayList.filterToday static helper + TDTL tests"
```

---

## Task 2: `TaskDoneTodayList` render() + render guard

**Files:**
- Modify: `platform/mechanisms/task-entity/task-done-today-list.js`
- Modify: `platform/test/run-task-entity-render-guards.js`

- [ ] **Step 1: Replace the stub render() with the full implementation**

Rewrite `platform/mechanisms/task-entity/task-done-today-list.js` in full:

```js
class TaskDoneTodayList {

    filterToday(parsedTasks, todayStr) { return TaskDoneTodayList.filterToday(parsedTasks, todayStr); }

    /**
     * Entry point invoked by customjs-guard: render(dv). Live-queries
     * spice/tasks/_done/ for tasks completed today and renders a native
     * <details>/<summary> collapsible section. Renders nothing if no tasks
     * were completed today. Cold-load safe — returns quietly if dependencies
     * are not yet registered. Dual-fire-safe via __renderGen counter.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__taskDoneTodayGen || 0) + 1;
        dv.container.__taskDoneTodayGen = myGen;
        const isStale = () => dv.container.__taskDoneTodayGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function' || !TTL || typeof TTL.renderTaskRow !== 'function') return;

        const today = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DD') : '';
        if (!today) return;

        let doneTasks = [];
        try {
            const raw = dv.pages('"spice/tasks/_done"').where(p =>
                p && p.type === 'task' && p.file && !p.file.path.includes('/_trash/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            doneTasks = TaskDoneTodayList.filterToday(arr.map(p => TE.parseNote(p)), today);
        } catch (_e) { return; }

        if (isStale()) return;
        if (!doneTasks.length) return;

        const details = dv.container.createEl('details');
        details.style.cssText = 'width: 100%; box-sizing: border-box; margin-top: 4px;';

        const summary = details.createEl('summary');
        summary.style.cssText = 'cursor: pointer; color: var(--text-muted); font-size: 0.85em; padding: 4px 0; user-select: none; list-style: none;';
        summary.textContent = `Completed (${doneTasks.length})`;

        const list = details.createEl('div');
        list.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-top: 4px;';

        for (const task of doneTasks) {
            try {
                TTL.renderTaskRow(list, task, null);
                // Pre-check the checkbox — done tasks show as checked.
                try {
                    const row = list.lastElementChild || list.lastChild;
                    const cb = row && row.querySelector && row.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = true;
                } catch (_e) {}
            } catch (_e) {}
        }
    }

    static filterToday(parsedTasks, todayStr) {
        if (!Array.isArray(parsedTasks) || !todayStr) return [];
        return parsedTasks.filter(t => t && t.completed_at === todayStr);
    }
}
```

- [ ] **Step 2: Add the cold-load render guard to `platform/test/run-task-entity-render-guards.js`**

Find the final `(async () => {` IIFE in `run-task-entity-render-guards.js`. Add these two guard calls before the `console.log` at the end:

```js
    // TaskDoneTodayList — cold-load: TE/TTL not registered, dv.pages empty
    await guard('TDTL-RENDER-1 TaskDoneTodayList.render() does not throw on cold-load (normal container)', async () => {
        const TaskDoneTodayListClass = loadWidget('platform/mechanisms/task-entity/task-done-today-list.js', 'TaskDoneTodayList');
        const w = new TaskDoneTodayListClass();
        const cont = makeEl(null);
        const dv = { container: cont, pages: () => emptyData(), current: () => null };
        global.window = { customJS: {}, moment: makeMoment() };
        await w.render(dv);   // must not throw
    });

    await guard('TDTL-RENDER-2 TaskDoneTodayList.render() returns early inside .markdown-embed', async () => {
        const TaskDoneTodayListClass = loadWidget('platform/mechanisms/task-entity/task-done-today-list.js', 'TaskDoneTodayList');
        const w = new TaskDoneTodayListClass();
        const cont = makeEl(() => ({ classList: { contains: () => true } }));
        const dv = { container: cont, pages: () => emptyData() };
        global.window = { customJS: {} };
        await w.render(dv);   // must not throw
    });
```

- [ ] **Step 3: Run the render guard tests**

```bash
node platform/test/run-task-entity-render-guards.js 2>&1 | grep -E "TDTL-RENDER|passed|failed"
```

Expected: `ok TDTL-RENDER-1`, `ok TDTL-RENDER-2`.

- [ ] **Step 4: Run full task-entity suite to confirm no regressions**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

Expected: all passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-done-today-list.js platform/test/run-task-entity-render-guards.js
git commit -m "feat(task-entity): TaskDoneTodayList render() + cold-load render guards"
```

---

## Task 3: Wire `TaskDoneTodayList` into manifest + `Today To-Do.md` template

**Files:**
- Modify: `platform/mechanisms/task-entity/manifest.json`
- Modify: `platform/blueprints/to-do/templates/Today To-Do.md`

- [ ] **Step 1: Register `TaskDoneTodayList` in the task-entity manifest**

In `platform/mechanisms/task-entity/manifest.json`:

1. Add `"TaskDoneTodayList"` to the `customjs_classes` array (after `"TaskProjectList"`).
2. Add a new entry to the `files` array:
   ```json
   {"source":"task-done-today-list.js","dest":"{{scripts_path}}/task-entity/task-done-today-list.js"}
   ```

The updated `customjs_classes` array should be:
```json
["TaskEntity","TaskDialog","TaskTodayList","TaskNoteView","TaskMeetingList","TaskProjectList","TaskDoneTodayList"]
```

The new entry goes at the end of the `files` array, after the `task-project-list.js` entry.

- [ ] **Step 2: Append the `TaskDoneTodayList` widget block to `Today To-Do.md`**

Open `platform/blueprints/to-do/templates/Today To-Do.md`. Append at the very end of the file:

````markdown

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TaskDoneTodayList" });
```
````

- [ ] **Step 3: Verify the manifest is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('platform/mechanisms/task-entity/manifest.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/task-entity/manifest.json "platform/blueprints/to-do/templates/Today To-Do.md"
git commit -m "feat(task-entity): register TaskDoneTodayList in manifest + wire into Today To-Do template"
```

---

## Task 4: `TaskDoneArchive` static helpers — TDD

**Files:**
- Create: `platform/blueprints/to-do/helpers/task-done-archive.js`
- Modify: `platform/test/run-task-entity.js`

- [ ] **Step 1: Add the failing TDARCH tests to `platform/test/run-task-entity.js`**

Add this block immediately before the final `(async () => {` IIFE (after `runTaskDoneTodayListTests` block you added in Task 1):

```js
// ---------- TDARCH: TaskDoneArchive static helpers ----------
function runTaskDoneArchiveTests() {
  const TaskDoneArchiveClass = loadClass(
    'blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
  const TDARCH = new TaskDoneArchiveClass();

  ok('TDARCH-1 groupByDate groups tasks by completed_at sorted desc', () => {
    const tasks = [
      { title: 'A', completed_at: '2026-07-04' },
      { title: 'B', completed_at: '2026-07-06' },
      { title: 'C', completed_at: '2026-07-06' },
      { title: 'D', completed_at: '2026-07-05' },
    ];
    const map = TDARCH.groupByDate(tasks);
    const keys = [...map.keys()];
    assert(keys[0] === '2026-07-06', 'first key is newest: ' + keys[0]);
    assert(keys[1] === '2026-07-05', 'second key: ' + keys[1]);
    assert(keys[2] === '2026-07-04', 'third key: ' + keys[2]);
    assert(map.get('2026-07-06').length === 2, '2 tasks on Jul 6');
  });

  ok('TDARCH-2 groupByDate drops tasks with null completed_at', () => {
    const tasks = [
      { title: 'A', completed_at: null },
      { title: 'B', completed_at: '' },
      { title: 'C', completed_at: '2026-07-06' },
    ];
    const map = TDARCH.groupByDate(tasks);
    assert(map.size === 1, 'only 1 date group: ' + map.size);
    assert(map.get('2026-07-06').length === 1, '1 task on Jul 6');
  });

  ok('TDARCH-3 groupByDate returns empty Map on null/empty input', () => {
    assert(TDARCH.groupByDate(null).size === 0, 'null input');
    assert(TDARCH.groupByDate([]).size === 0, 'empty array');
  });

  ok('TDARCH-4 filterByText returns tasks whose title includes text (case-insensitive)', () => {
    const tasks = [
      { title: 'Fix Dev CDC' },
      { title: 'Deploy staging' },
      { title: 'fix login bug' },
    ];
    const result = TDARCH.filterByText(tasks, 'fix');
    assert(result.length === 2, 'expected 2, got ' + result.length);
    assert(result[0].title === 'Fix Dev CDC', 'first match');
    assert(result[1].title === 'fix login bug', 'second match');
  });

  ok('TDARCH-5 filterByText returns all tasks when text is empty/blank', () => {
    const tasks = [{ title: 'A' }, { title: 'B' }];
    assert(TDARCH.filterByText(tasks, '').length === 2, 'empty string returns all');
    assert(TDARCH.filterByText(tasks, '   ').length === 2, 'blank string returns all');
    assert(TDARCH.filterByText(tasks, null).length === 2, 'null returns all');
  });

  ok('TDARCH-6 filterByText returns [] when no titles match', () => {
    const tasks = [{ title: 'Foo' }, { title: 'Bar' }];
    const result = TDARCH.filterByText(tasks, 'zzz-no-match');
    assert(result.length === 0, 'no matches');
  });
}
```

Also add `runTaskDoneArchiveTests();` inside the IIFE, after `runTaskDoneTodayListTests();`.

- [ ] **Step 2: Run tests to confirm TDARCH tests fail (file doesn't exist)**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -E "TDARCH|Error" | head -10
```

Expected: error loading file or `FAIL TDARCH-1`.

- [ ] **Step 3: Create `platform/blueprints/to-do/helpers/task-done-archive.js` with statics only**

```js
class TaskDoneArchive {

    groupByDate(parsedTasks) { return TaskDoneArchive.groupByDate(parsedTasks); }
    filterByText(parsedTasks, text) { return TaskDoneArchive.filterByText(parsedTasks, text); }

    async render(dv) {
        // browser-side implementation added in Task 5
        if (!dv || !dv.container) return;
    }

    /**
     * Group parsed task objects by their completed_at date string, sorted
     * newest-first. Tasks with null/empty completed_at are dropped.
     * @param {object[]} parsedTasks — TaskEntity.parseNote output
     * @returns {Map<string, object[]>} dateStr -> tasks[], sorted desc
     */
    static groupByDate(parsedTasks) {
        if (!Array.isArray(parsedTasks)) return new Map();
        const map = new Map();
        for (const t of parsedTasks) {
            if (!t || !t.completed_at) continue;
            if (!map.has(t.completed_at)) map.set(t.completed_at, []);
            map.get(t.completed_at).push(t);
        }
        return new Map([...map.entries()].sort((a, b) =>
            b[0] < a[0] ? -1 : b[0] > a[0] ? 1 : 0));
    }

    /**
     * Filter parsed tasks to those whose title includes text (case-insensitive).
     * Empty/blank text returns all tasks.
     * @param {object[]} parsedTasks
     * @param {string} text
     * @returns {object[]}
     */
    static filterByText(parsedTasks, text) {
        if (!Array.isArray(parsedTasks)) return [];
        if (!text || !text.trim()) return parsedTasks;
        const lower = text.toLowerCase();
        return parsedTasks.filter(t => t && t.title && t.title.toLowerCase().includes(lower));
    }
}
```

- [ ] **Step 4: Run tests to confirm TDARCH-1..6 pass**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -E "TDARCH|passed|failed"
```

Expected: `ok TDARCH-1` through `ok TDARCH-6`, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/task-done-archive.js platform/test/run-task-entity.js
git commit -m "feat(to-do): TaskDoneArchive static helpers (groupByDate, filterByText) + TDARCH tests"
```

---

## Task 5: `TaskDoneArchive` render() + render guard

**Files:**
- Modify: `platform/blueprints/to-do/helpers/task-done-archive.js`
- Modify: `platform/test/run-todo-render-guards.js`

- [ ] **Step 1: Replace the stub render() with the full implementation**

Rewrite `platform/blueprints/to-do/helpers/task-done-archive.js` in full:

```js
class TaskDoneArchive {

    groupByDate(parsedTasks) { return TaskDoneArchive.groupByDate(parsedTasks); }
    filterByText(parsedTasks, text) { return TaskDoneArchive.filterByText(parsedTasks, text); }

    /**
     * Entry point invoked by customjs-guard: render(dv). Renders a DocSearch
     * text-filter strip above a date-grouped list of all completed task notes.
     * Dependency chain: TaskEntity (parseNote) + TaskTodayList (renderTaskRow) +
     * DocSearch (search strip) + SectionLabel (date headers). Returns quietly if
     * any dependency is absent (cold-load safe). Dual-fire-safe via __renderGen.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__taskDoneArchiveGen || 0) + 1;
        dv.container.__taskDoneArchiveGen = myGen;
        const isStale = () => dv.container.__taskDoneArchiveGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const TE  = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        const DS  = window.customJS && window.customJS.DocSearch;
        const SL  = window.customJS && window.customJS.SectionLabel;
        if (!TE || typeof TE.parseNote !== 'function' ||
            !TTL || typeof TTL.renderTaskRow !== 'function' ||
            !DS  || typeof DS.render !== 'function' ||
            !SL  || typeof SL.render !== 'function') return;

        // Load all completed task notes once.
        let allTasks = [];
        try {
            const raw = dv.pages('"spice/tasks/_done"').where(p =>
                p && p.type === 'task' && p.file && !p.file.path.includes('/_trash/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            allTasks = arr.map(p => TE.parseNote(p));
        } catch (_e) {}

        if (isStale()) return;

        // Render results into ctx.resultsContainer (two-container DocSearch pattern).
        const renderResults = (ctx) => {
            const container = ctx.resultsContainer;
            while (container.firstChild) container.removeChild(container.firstChild);

            const filtered = ctx.hasActiveFilter
                ? TaskDoneArchive.filterByText(allTasks, ctx.text)
                : allTasks;

            if (!filtered.length) {
                const msg = ctx.hasActiveFilter ? 'No completed tasks match.' : 'No completed tasks yet.';
                const p = container.createEl('p', { text: msg });
                p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 8px 0;';
                return;
            }

            const groups = TaskDoneArchive.groupByDate(filtered);
            for (const [dateStr, tasks] of groups) {
                const label = (typeof window !== 'undefined' && window.moment)
                    ? window.moment(dateStr, 'YYYY-MM-DD').format('MMM D, YYYY')
                    : dateStr;
                // SectionLabel.render accepts a container element directly
                // (c = dv.container || dv — passes through when no .container prop).
                SL.render(container, { text: label });
                for (const task of tasks) {
                    try {
                        TTL.renderTaskRow(container, task, null);
                        // Pre-check checkbox for done tasks.
                        try {
                            const row = container.lastElementChild || container.lastChild;
                            const cb = row && row.querySelector && row.querySelector('input[type="checkbox"]');
                            if (cb) cb.checked = true;
                        } catch (_e) {}
                    } catch (_e) {}
                }
            }
        };

        const filterCtx = DS.render(dv, {
            scopePath: 'spice/tasks/_done',
            hideTags: true,
            persist: false,
            hideNativeSearch: true,
            onChange: renderResults,
        });

        if (isStale()) return;
        renderResults(filterCtx);
    }

    static groupByDate(parsedTasks) {
        if (!Array.isArray(parsedTasks)) return new Map();
        const map = new Map();
        for (const t of parsedTasks) {
            if (!t || !t.completed_at) continue;
            if (!map.has(t.completed_at)) map.set(t.completed_at, []);
            map.get(t.completed_at).push(t);
        }
        return new Map([...map.entries()].sort((a, b) =>
            b[0] < a[0] ? -1 : b[0] > a[0] ? 1 : 0));
    }

    static filterByText(parsedTasks, text) {
        if (!Array.isArray(parsedTasks)) return [];
        if (!text || !text.trim()) return parsedTasks;
        const lower = text.toLowerCase();
        return parsedTasks.filter(t => t && t.title && t.title.toLowerCase().includes(lower));
    }
}
```

- [ ] **Step 2: Add the cold-load render guard to `platform/test/run-todo-render-guards.js`**

Find the final `(async () => {` IIFE in `run-todo-render-guards.js`. Add these two guard calls before the `console.log` at the end:

```js
    // TaskDoneArchive — cold-load: TE/TTL/DS/SL not registered, dv.pages empty
    await guard('TDARCH-RENDER-1 TaskDoneArchive.render() does not throw on cold-load (normal container)', async () => {
        const TaskDoneArchiveClass = loadWidget('platform/blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
        const w = new TaskDoneArchiveClass();
        const cont = makeEl(null);
        const dv = { container: cont, pages: () => emptyData(), current: () => null };
        global.window = { customJS: {}, moment: makeMoment() };
        await w.render(dv);   // must not throw
    });

    await guard('TDARCH-RENDER-2 TaskDoneArchive.render() returns early inside .markdown-embed', async () => {
        const TaskDoneArchiveClass = loadWidget('platform/blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
        const w = new TaskDoneArchiveClass();
        const cont = makeEl(() => ({ classList: { contains: () => true } }));
        const dv = { container: cont, pages: () => emptyData() };
        global.window = { customJS: {} };
        await w.render(dv);   // must not throw
    });
```

- [ ] **Step 3: Run render guard tests**

```bash
node platform/test/run-todo-render-guards.js 2>&1 | grep -E "TDARCH-RENDER|passed|failed"
```

Expected: `ok TDARCH-RENDER-1`, `ok TDARCH-RENDER-2`.

- [ ] **Step 4: Run full task-entity suite to confirm no regressions**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

Expected: all passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/task-done-archive.js platform/test/run-todo-render-guards.js
git commit -m "feat(to-do): TaskDoneArchive render() + cold-load render guards"
```

---

## Task 6: Wire `TaskDoneArchive` into to-do manifest + `Completed Tasks.md` template

**Files:**
- Modify: `platform/blueprints/to-do/manifest.json`
- Create: `platform/blueprints/to-do/templates/Completed Tasks.md`

- [ ] **Step 1: Register `TaskDoneArchive` in the to-do blueprint manifest**

In `platform/blueprints/to-do/manifest.json`:

1. Add `"TaskDoneArchive"` to the end of the `customjs_classes` array (after `"TodayCaptureEditableList"`).

2. Add to the `files` array (after the `today-capture-editable-list.js` entry):
   ```json
   {"source":"helpers/task-done-archive.js","dest":"{{scripts_path}}/to-do/task-done-archive.js"}
   ```

3. Add to the `files` array (after the `Recurring Tasks.md` materialize_once entry):
   ```json
   {"source":"templates/Completed Tasks.md","dest":"{{module_directory}}/Completed Tasks.md","materialize_once":true}
   ```

- [ ] **Step 2: Create `platform/blueprints/to-do/templates/Completed Tasks.md`**

```markdown
---
type: to-do-hub
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoHubActions" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TaskDoneArchive" });
```
```

- [ ] **Step 3: Verify the manifest is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/to-do/manifest.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`.

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/to-do/manifest.json "platform/blueprints/to-do/templates/Completed Tasks.md"
git commit -m "feat(to-do): register TaskDoneArchive + Completed Tasks hub template in manifest"
```

---

## Task 7: Self-install + full preflight + push

**Files:**
- Self-install syncs `platform/` → `ranch/scripts/` and `ranch/templates/`

- [ ] **Step 1: Run self-install to sync workshop dogfood**

```bash
node platform/install.js --vault . --auto-approve 2>&1 | tail -20
```

Expected: `install complete` (or similar success message), exit 0.

- [ ] **Step 2: Verify the new files landed in `ranch/`**

```bash
ls ranch/scripts/task-entity/task-done-today-list.js && \
ls ranch/scripts/to-do/task-done-archive.js && \
ls "ranch/templates/Completed Tasks.md" && \
echo "all files present"
```

Expected: `all files present`.

- [ ] **Step 3: Run full preflight suite**

```bash
npm run release:preflight 2>&1 | tail -30
```

Expected: all green, exit 0.

- [ ] **Step 4: Stage and commit any self-install drift**

```bash
git status --short
```

If `ranch/scripts/task-entity/task-done-today-list.js`, `ranch/scripts/to-do/task-done-archive.js`, `ranch/templates/Completed Tasks.md`, or `ranch/templates/Today To-Do.md` appear as modified/untracked:

```bash
git add ranch/scripts/task-entity/task-done-today-list.js \
        ranch/scripts/to-do/task-done-archive.js \
        "ranch/templates/Completed Tasks.md" \
        "ranch/templates/Today To-Do.md"
git commit -m "chore(ranch): self-install sync — TaskDoneTodayList + TaskDoneArchive + Completed Tasks template"
```

- [ ] **Step 5: Push and open PR**

```bash
git push origin main
```

Then open a PR targeting `main` with title:

`feat(to-do): completed tasks view — collapsed daily section + searchable archive hub`

Body:
```
## Summary
- New `TaskDoneTodayList` widget: collapsed "Completed (N)" section at the bottom of Today To-Do notes showing tasks completed today
- New `TaskDoneArchive` widget: date-grouped, text-searchable archive of all completed tasks on a new Completed Tasks hub note
- Both use `spice/tasks/_done/` and the existing `TaskTodayList.renderTaskRow` shared renderer
- 10 new tests (TDTL-1..4, TDARCH-1..6), 4 new render guards (TDTL-RENDER-1..2, TDARCH-RENDER-1..2)

## Test plan
- [ ] `npm run release:preflight` green
- [ ] Self-install success (node platform/install.js --vault . --auto-approve)
- [ ] TDTL-1..4 pass (node platform/test/run-task-entity.js)
- [ ] TDARCH-1..6 pass (node platform/test/run-task-entity.js)
- [ ] TDTL-RENDER + TDARCH-RENDER guards pass
```
