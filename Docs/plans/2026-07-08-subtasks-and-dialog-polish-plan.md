# Subtasks + Task-Dialog Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the task schema's redundant `scheduled`/`due` date fields into one `due` field, polish the create/edit task dialog with progressive disclosure, and add a subtasks relationship (full task notes linked to a parent via `parent_task`).

**Architecture:** Part A renames `scheduled` → `due` across the whole task-entity mechanism + to-do blueprint, with a new install-time heal migrating every existing task note in every consumer vault. Part B reworks `TaskDialog`'s form into a two-tier layout (Title+Due always visible; everything else behind a "More options" toggle). Part C adds a `parent_task` field + a live-queried "Subtasks" section in `TaskNoteView`, reusing the existing `TaskTodayList.renderTaskRow` and `TaskDialog.createQuick` machinery.

**Tech Stack:** Vanilla JS (CustomJS classes), Dataview (`dataviewjs`), Obsidian Templater installer (`platform/install.js`), Node test harnesses.

**Design doc:** `Docs/plans/2026-07-08-subtasks-and-dialog-polish-design.md`.

**Release note:** Per `Docs/agent-guides/build-test-verify.md` § Release workflow, do NOT bump any version number by hand anywhere. Conventional-commit messages (`feat(task-entity):`, `feat(to-do):`) are the only input the automated bumper needs.

---

## File map

| File | Change |
|---|---|
| `platform/mechanisms/task-entity/task-entity.js` | Drop `scheduled`; `queryToday`/`validatePayload` read `due`; add `parent_task` field |
| `platform/mechanisms/task-entity/task-dialog.js` | One date field; progressive disclosure; `due`-only writes; subtask quick-add |
| `platform/mechanisms/task-entity/task-today-list.js` | `buildBands` reads `due`; excludes `parent_task`-owned tasks |
| `platform/mechanisms/task-entity/task-note-view.js` | Drop Scheduled row; new Subtasks section + "Part of" line |
| `platform/blueprints/to-do/helpers/todo-all-list.js` | `groupByDate` reads `due` |
| `platform/blueprints/to-do/helpers/task-recurring-list.js` | `filterRecurring` sorts by `due` |
| `platform/install.js` | Update `applyRecurringTasksMigrationHeal`; new `applyTaskDueScheduledRenameMigration` |
| `platform/test/run-task-entity.js` | Updated + new test cases throughout |
| `platform/test/seed-vault/spice/tasks/*.md` | New pre-migration fixture(s) for the rename heal |
| `platform/test/run-seed-migrations.js` | New assert family for the rename heal |

---

### Task 1: `TaskEntity` — consolidate `scheduled` into `due`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Update existing tests that reference `scheduled`**

Search `platform/test/run-task-entity.js` for every test that sets `scheduled` on a payload passed to `composeNote`, or asserts on `.scheduled` from `parseNote`/`queryToday` output, and change those to use `due` instead. Do this BEFORE changing the implementation so you can watch these tests go red for the right reason (they'll fail because `due` isn't wired yet, not because of a typo). Specifically:
- Any `TaskEntity.composeNote({..., scheduled: 'YYYY-MM-DD', ...})` call → `due: 'YYYY-MM-DD'`.
- Any assertion on `result.frontmatter.scheduled` → `result.frontmatter.due`.
- Any assertion on `parsed.scheduled` → `parsed.due`.
- `TaskEntity.queryToday` test cases (search for `ok('TE-` tests calling `queryToday`) — change their fixture objects' `scheduled` key to `due`.

- [ ] **Step 2: Run to verify these now fail**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -30
```

Expected: several failures (the ones you just edited) — `TaskEntity` still emits/reads `scheduled`, not `due`, so `due` round-trips as empty/wrong.

- [ ] **Step 3: Implement — `composeNote`**

Current frontmatter object:

```js
        const frontmatter = {
            type: 'task',
            title: p.title || '',
            status: p.status || 'open',
            scheduled: p.scheduled || '',
            due: p.due || '',
            recurrence: p.recurrence || '',
            priority: p.priority || '',
            project: project,
            project_slug: projectSlug,
            source: p.source || '',
            source_note: p.source_note || '',
            links: links,
            created_at: createdAt,
            completed_at: p.completed_at || '',
        };
```

Replace with (drop `scheduled`; `due` is now the one date field; `parent_task` added per Task 10 later — do NOT add it yet, this task is Due/Scheduled only):

```js
        const frontmatter = {
            type: 'task',
            title: p.title || '',
            status: p.status || 'open',
            due: p.due || '',
            recurrence: p.recurrence || '',
            priority: p.priority || '',
            project: project,
            project_slug: projectSlug,
            source: p.source || '',
            source_note: p.source_note || '',
            links: links,
            created_at: createdAt,
            completed_at: p.completed_at || '',
        };
```

Update the doc-comment above `composeNote` (currently `* payload = { title, status?, scheduled?, due?, recurrence?, priority?, ...`) to drop `scheduled?`.

- [ ] **Step 4: Implement — `parseNote`**

Current:

```js
        return {
            title: p.title != null ? String(p.title) : '',
            status: p.status || 'open',
            scheduled: TaskEntity._toDateStr(p.scheduled),
            due: TaskEntity._toDateStr(p.due),
            recurrence: p.recurrence || '',
            priority: p.priority || '',
```

Replace with:

```js
        return {
            title: p.title != null ? String(p.title) : '',
            status: p.status || 'open',
            due: TaskEntity._toDateStr(p.due),
            recurrence: p.recurrence || '',
            priority: p.priority || '',
```

- [ ] **Step 5: Implement — `queryToday`**

Current:

```js
    static queryToday(tasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(tasks) ? tasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            const sched = t.scheduled;
            if (!sched) continue;
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            // sched > todayStr (future) → excluded from both buckets.
        }
        return { today: today, overdue: overdue };
    }
```

Replace with:

```js
    static queryToday(tasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(tasks) ? tasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            const due = t.due;
            if (!due) continue;
            if (due === todayStr) today.push(t);
            else if (due < todayStr) overdue.push(t);
            // due > todayStr (future) → excluded from both buckets.
        }
        return { today: today, overdue: overdue };
    }
```

Update the doc-comment above it (currently describes `scheduled`) to describe `due` instead.

- [ ] **Step 6: Implement — `validatePayload`**

Current:

```js
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (payload.scheduled && !DATE_RE.test(payload.scheduled)) {
            return { valid: false, reason: 'invalid scheduled date' };
        }
        if (payload.due && !DATE_RE.test(payload.due)) {
            return { valid: false, reason: 'invalid due date' };
        }
        return { valid: true };
```

Replace with:

```js
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (payload.due && !DATE_RE.test(payload.due)) {
            return { valid: false, reason: 'invalid due date' };
        }
        return { valid: true };
```

- [ ] **Step 7: Run to verify tests pass**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

Expected: back to fully green (same pass count as before Step 1, since you only renamed the field the existing cases exercise).

- [ ] **Step 8: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/test/run-task-entity.js
git commit -m "feat(task-entity)!: consolidate scheduled into due on the task schema

BREAKING CHANGE: the task-entity schema no longer has a separate 'scheduled'
field. TaskEntity.queryToday now buckets Today/Overdue by 'due'. A migration
heal (later task) renames the key on every existing task note."
```

Note the `!` and `BREAKING CHANGE:` footer — this is a genuine breaking schema change for anyone reading raw task-note frontmatter, even though the migration heal makes it transparent to end users. The bumper reads this to compute a MAJOR-equivalent bump for `task-entity` (it's currently pre-1.0, so per semver-with-`feat!`-once-≥1.0 rules this still lands as a MINOR — that's fine, just use the correct commit grammar so the classification is accurate either way).

---

### Task 2: `TaskDialog` — one Due field, `due`-only writes

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Update existing tests referencing `scheduled`**

Search `platform/test/run-task-entity.js` for every `TD-*` test that builds a `state` object with a `scheduled` key, or asserts `payload.scheduled`, and update to `due`. This includes the `TD-recur-6`/`TD-recur-7` tests for `_rollForwardDate` (those don't reference `scheduled` directly — leave them) and any `_payloadFromState`/`defaultsForSurface` tests.

- [ ] **Step 2: Run to verify these fail**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -30
```

- [ ] **Step 3: Implement — `defaultsForSurface`**

Current:

```js
    static defaultsForSurface(opts) {
        const o = opts || {};
        switch (o.surface) {
            case 'daily':
                return { scheduled: o.today || '', source: 'daily' };
```

Replace with:

```js
    static defaultsForSurface(opts) {
        const o = opts || {};
        switch (o.surface) {
            case 'daily':
                return { due: o.today || '', source: 'daily' };
```

Update the doc-comment above it (`*   daily   → { scheduled: today, source: "daily" }`) to say `due` instead.

- [ ] **Step 4: Implement — form state init (in `_render`)**

Current:

```js
        const state = {
            title: fm ? (fm.title || '') : '',
            scheduled: fm ? (fm.scheduled || '') : (defaults.scheduled || ''),
            due: fm ? (fm.due || '') : '',
            priority: fm ? (fm.priority || '') : (defaults.priority || ''),
```

Replace with:

```js
        const state = {
            title: fm ? (fm.title || '') : '',
            due: fm ? (fm.due || '') : (defaults.due || ''),
            priority: fm ? (fm.priority || '') : (defaults.priority || ''),
```

- [ ] **Step 5: Implement — remove the Scheduled input field**

Current (Scheduled block immediately followed by the Due block):

```js
        // Scheduled
        label('Scheduled (optional)');
        const schedInput = host.createEl('input', { type: 'date' });
        schedInput.style.cssText = dateCss;
        schedInput.value = state.scheduled;
        schedInput.onchange = () => { state.scheduled = schedInput.value; updateSubmit(); };

        // Due
        label('Due (optional)');
        const dueInput = host.createEl('input', { type: 'date' });
        dueInput.style.cssText = dateCss;
        dueInput.value = state.due;
        dueInput.onchange = () => { state.due = dueInput.value; updateSubmit(); };
```

Replace with (Scheduled block deleted entirely; Due keeps its exact same wiring):

```js
        // Due
        label('Due (optional)');
        const dueInput = host.createEl('input', { type: 'date' });
        dueInput.style.cssText = dateCss;
        dueInput.value = state.due;
        dueInput.onchange = () => { state.due = dueInput.value; updateSubmit(); };
```

- [ ] **Step 6: Implement — `_payloadFromState`**

Current:

```js
    static _payloadFromState(state) {
        const s = state || {};
        const payload = {
            title: s.title,
            scheduled: s.scheduled || '',
            due: s.due || '',
```

Replace with:

```js
    static _payloadFromState(state) {
        const s = state || {};
        const payload = {
            title: s.title,
            due: s.due || '',
```

- [ ] **Step 7: Implement — `createQuick`**

Current:

```js
    async createQuick(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        const title = String((opts && opts.title) || '').trim();
        if (!app || !title) return;
        const payload = {
            title,
            scheduled: (opts && opts.today) || '',
            source: (opts && opts.source) || 'daily',
            links: [],
        };
        await this._create(app, payload, '');
    }
```

Replace with:

```js
    async createQuick(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        const title = String((opts && opts.title) || '').trim();
        if (!app || !title) return;
        const payload = {
            title,
            due: (opts && opts.today) || '',
            source: (opts && opts.source) || 'daily',
            links: [],
        };
        await this._create(app, payload, '');
    }
```

Update the doc-comment above it (`typed title (scheduled = today, ...`) to say `due = today`.

- [ ] **Step 8: Implement — `_saveEdit`**

Current `processFrontMatter` mutator:

```js
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.title = payload.title;
            fm.scheduled = payload.scheduled || '';
            fm.due = payload.due || '';
            fm.priority = payload.priority || '';
```

Replace with:

```js
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.title = payload.title;
            fm.due = payload.due || '';
            fm.priority = payload.priority || '';
```

- [ ] **Step 9: Implement — `_markDone`'s roll-forward branch**

Current:

```js
            if (nextDate) {
                // ROLL FORWARD — same file, never archived. Leaves status/priority/
                // project/links untouched; only scheduled advances and completed_at
                // clears (so the note never carries a stale "last time" stamp).
                await app.fileManager.processFrontMatter(file, (fmw) => {
                    fmw.scheduled = nextDate;
                    fmw.completed_at = '';
                });
```

Replace with:

```js
            if (nextDate) {
                // ROLL FORWARD — same file, never archived. Leaves status/priority/
                // project/links untouched; only due advances and completed_at
                // clears (so the note never carries a stale "last time" stamp).
                await app.fileManager.processFrontMatter(file, (fmw) => {
                    fmw.due = nextDate;
                    fmw.completed_at = '';
                });
```

- [ ] **Step 10: Run to verify tests pass**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
node platform/test/run-customjs-loadable.js 2>&1 | tail -5
```

- [ ] **Step 11: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): drop the Scheduled field from the task dialog, Due drives everything"
```

---

### Task 3: `TaskTodayList.buildBands` — read `due`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Update existing tests**

Search `run-task-entity.js` for `buildBands` test fixtures setting `scheduled` — change to `due`.

- [ ] **Step 2: Run to verify they fail**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -20
```

- [ ] **Step 3: Implement**

Current `buildBands` (relevant excerpt):

```js
            if (t.project_slug && String(t.project_slug).trim() !== '') continue; // shown in its Project section
            if (t.source === 'meeting') continue;                                 // shown in Meeting Tasks
            const sched = t.scheduled;
            if (!sched) continue;
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            // sched > todayStr (future) → excluded from both bands.
        }
        // Overdue: oldest/most-overdue scheduled date first — the task that's been
        // sitting longest surfaces at the top. Tie-broken by title (case-insensitive).
        overdue.sort((a, b) => {
            const as = a.scheduled || '';
            const bs = b.scheduled || '';
```

Replace with:

```js
            if (t.project_slug && String(t.project_slug).trim() !== '') continue; // shown in its Project section
            if (t.source === 'meeting') continue;                                 // shown in Meeting Tasks
            const due = t.due;
            if (!due) continue;
            if (due === todayStr) today.push(t);
            else if (due < todayStr) overdue.push(t);
            // due > todayStr (future) → excluded from both bands.
        }
        // Overdue: oldest/most-overdue due date first — the task that's been
        // sitting longest surfaces at the top. Tie-broken by title (case-insensitive).
        overdue.sort((a, b) => {
            const as = a.due || '';
            const bs = b.due || '';
```

Note: the `today.sort` block right below (which already sorts by `a.due`/`b.due` — this was the SECONDARY chip-sort within Today, already reading `due` before this change) is UNCHANGED — leave it exactly as-is.

Update the doc-comment above `buildBands` (mentions `scheduled` twice) to say `due`.

- [ ] **Step 4: Run to verify tests pass**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): TaskTodayList.buildBands buckets Today/Overdue by due"
```

---

### Task 4: `TaskNoteView` — drop the Scheduled row

**Files:**
- Modify: `platform/mechanisms/task-entity/task-note-view.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Update existing tests**

Search `run-task-entity.js` for `_fieldRows` tests asserting a `Scheduled` row — remove those assertions (there should be no more `Scheduled` label ever produced).

- [ ] **Step 2: Run to verify the assertion you removed is now moot (nothing to verify red here — this is a deletion, not a new behavior; skip ahead)**

- [ ] **Step 3: Implement — `_fieldRows`**

Current:

```js
    static _fieldRows(task) {
        const t = task || {};
        const rows = [];
        const val = (v) => {
            if (v == null) return '';
            const s = String(v).trim();
            return s;
        };
        const sched = val(t.scheduled);
        const due = val(t.due);
        const recur = val(t.recurrence);
        const prio = val(t.priority);
        let proj = val(t.project);
        const pm = /^\[\[([^\]]+)\]\]$/.exec(proj);
        if (pm) proj = pm[1];
        if (sched) rows.push({ label: 'Scheduled', value: sched });
        if (due) rows.push({ label: 'Due', value: due });
        if (recur) rows.push({ label: 'Repeats', value: recur });
        if (prio) rows.push({ label: 'Priority', value: prio });
        if (proj) rows.push({ label: 'Project', value: proj });
        return rows;
```

Replace with:

```js
    static _fieldRows(task) {
        const t = task || {};
        const rows = [];
        const val = (v) => {
            if (v == null) return '';
            const s = String(v).trim();
            return s;
        };
        const due = val(t.due);
        const recur = val(t.recurrence);
        const prio = val(t.priority);
        let proj = val(t.project);
        const pm = /^\[\[([^\]]+)\]\]$/.exec(proj);
        if (pm) proj = pm[1];
        if (due) rows.push({ label: 'Due', value: due });
        if (recur) rows.push({ label: 'Repeats', value: recur });
        if (prio) rows.push({ label: 'Priority', value: prio });
        if (proj) rows.push({ label: 'Project', value: proj });
        return rows;
```

- [ ] **Step 4: Implement — the `render()` method's task-object build + DETAILS section**

Current task-object build (inside `render`):

```js
            const task = {
                title: str(parsed ? parsed.title : page.title),
                status: str((parsed && parsed.status) || page.status || 'open'),
                scheduled: str(parsed ? parsed.scheduled : page.scheduled),
                due: str(parsed ? parsed.due : page.due),
```

Replace with:

```js
            const task = {
                title: str(parsed ? parsed.title : page.title),
                status: str((parsed && parsed.status) || page.status || 'open'),
                due: str(parsed ? parsed.due : page.due),
```

Current `hasScheduled`/`hasDue` + the Scheduled row block inside the DETAILS section:

```js
            const hasScheduled = !!task.scheduled;
            const hasDue = !!task.due;
```

Replace with:

```js
            const hasDue = !!task.due;
```

Then find and DELETE this entire block (the Scheduled row renderer — Due's block right after it stays untouched, exactly as it is):

```js
                // Scheduled — human date + muted relative hint.
                if (hasScheduled) {
                    addRow('Scheduled', (wrap) => {
                        const h = TaskNoteView._humanDate(task.scheduled, todayStr);
                        wrap.createEl('span', { text: h.text || task.scheduled });
                        if (h.relative) {
                            const rel = wrap.createEl('span', { text: ' (' + h.relative + ')' });
                            rel.style.cssText = 'color:var(--text-muted); font-size:0.9em;';
                        }
                    });
                }

```

(Delete only this block, including its trailing blank line, so the "Due — human date..." comment and block that immediately follows it become the first row builder in the DETAILS section.)

- [ ] **Step 5: Run tests**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -10
node platform/test/run-customjs-loadable.js 2>&1 | tail -5
```

Expected: green — `_fieldRows` no longer emits a `Scheduled` row.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-note-view.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): drop the Scheduled row from the task note card"
```

---

### Task 5: `ToDoAllList.groupByDate` + `TaskRecurringList.filterRecurring` — read `due`

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-all-list.js`
- Modify: `platform/blueprints/to-do/helpers/task-recurring-list.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Update existing tests**

Search `run-task-entity.js` for `groupByDate` and `filterRecurring` test fixtures using `scheduled` — change to `due`.

- [ ] **Step 2: Run to verify they fail**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -20
```

- [ ] **Step 3: Implement — `todo-all-list.js`'s `groupByDate`**

Current:

```js
    static groupByDate(parsedTasks, todayStr) {
        const overdue = [];
        const today = [];
        const future = [];
        const noDate = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t) continue;
            const sched = t.scheduled;
            if (!sched) { noDate.push(t); continue; }
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            else future.push(t);
        }
        overdue.sort((a, b) => (a.scheduled < b.scheduled ? -1 : a.scheduled > b.scheduled ? 1 : 0));
        future.sort((a, b) => (a.scheduled < b.scheduled ? -1 : a.scheduled > b.scheduled ? 1 : 0));
        const futureByDate = new Map();
        for (const t of future) {
            if (!futureByDate.has(t.scheduled)) futureByDate.set(t.scheduled, []);
            futureByDate.get(t.scheduled).push(t);
        }
        return { overdue, today, future, futureByDate, noDate };
    }
```

Replace with:

```js
    static groupByDate(parsedTasks, todayStr) {
        const overdue = [];
        const today = [];
        const future = [];
        const noDate = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t) continue;
            const due = t.due;
            if (!due) { noDate.push(t); continue; }
            if (due === todayStr) today.push(t);
            else if (due < todayStr) overdue.push(t);
            else future.push(t);
        }
        overdue.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
        future.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
        const futureByDate = new Map();
        for (const t of future) {
            if (!futureByDate.has(t.due)) futureByDate.set(t.due, []);
            futureByDate.get(t.due).push(t);
        }
        return { overdue, today, future, futureByDate, noDate };
    }
```

Update the doc-comment above it (mentions `scheduled` 4 times) to say `due`.

- [ ] **Step 4: Implement — `task-recurring-list.js`'s `filterRecurring`**

Current:

```js
        const out = list.filter(t => t && t.status === 'open' && t.recurrence && String(t.recurrence).trim() !== '');
        out.sort((a, b) => {
            const as = a.scheduled || '';
            const bs = b.scheduled || '';
```

Replace with:

```js
        const out = list.filter(t => t && t.status === 'open' && t.recurrence && String(t.recurrence).trim() !== '');
        out.sort((a, b) => {
            const as = a.due || '';
            const bs = b.due || '';
```

Update the doc-comment above `filterRecurring` and the class-level doc-comment (both mention `scheduled`) to say `due`.

- [ ] **Step 5: Run tests**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-all-list.js platform/blueprints/to-do/helpers/task-recurring-list.js platform/test/run-task-entity.js
git commit -m "feat(to-do): ToDoAllList + TaskRecurringList read due instead of scheduled"
```

---

### Task 6: `install.js` — update the recurring-tasks heal + add the rename migration

**Files:**
- Modify: `platform/install.js`
- Test: covered by Task 7's seed-vault fixture

- [ ] **Step 1: Update `applyRecurringTasksMigrationHeal`'s composed frontmatter**

Find `applyRecurringTasksMigrationHeal` in `platform/install.js` (shipped in the recurring-tasks cycle). Its hand-composed frontmatter lines currently include:

```js
      "scheduled: " + (scheduled || ""),
      "due:",
```

Replace with:

```js
      "due: " + (scheduled || ""),
```

(Keep the local variable named `scheduled` inside that function if you like — it's just a local var holding the computed next-occurrence date; only the FRONTMATTER KEY it's written under changes from `scheduled:` to `due:`, and the separate blank `due:` line is removed since there's now only one date key.)

- [ ] **Step 2: Add the new rename-migration heal**

Add this function near `applyRecurringTasksMigrationHeal` (right after its closing brace, or right after its helper functions — keep it in the same neighborhood):

```js
// applyTaskDueScheduledRenameMigration — schema consolidation.
//
// TaskEntity's schema retired the separate `scheduled` field (queryToday /
// buildBands / groupByDate now all bucket Today/Overdue by `due` alone).
// This heal walks every note under spice/tasks/ (open root + _done/ +
// _trash/ — a task can live in any of the three) and, where a `scheduled:`
// key is present, copies its value into `due:` ONLY IF `due` is currently
// blank (never clobber a value someone already had in `due` under the old
// dual-field system), then removes the `scheduled` key entirely. Ungated
// (runs every install), idempotent (a note with no `scheduled` key is a
// no-op), one `.sauce-backup` snapshot per touched file, failure-loud
// history. Critical correctness note: without this heal, every existing
// task with a `scheduled` date silently vanishes from Today/Overdue the
// moment queryToday starts reading `due` instead.
async function applyTaskDueScheduledRenameMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "task-entity") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const roots = ["spice/tasks", "spice/tasks/_done", "spice/tasks/_trash"];
  const files = [];
  for (const root of roots) {
    const exists = await adapter.exists(root).catch(() => false);
    if (!exists) continue;
    let listing;
    try { listing = await adapter.list(root); } catch (_e) { continue; }
    for (const f of (listing.files || [])) {
      if (/\.md$/i.test(f)) files.push(f);
    }
  }

  if (!files.length) {
    history?.push({ event: "info", step: "task_due_scheduled_rename_migration", name: "task-entity",
      renamed: 0, skipped: 0, errors: [],
      reason: "no task notes found under spice/tasks/",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let renamed = 0;
  let skipped = 0;
  const errors = [];

  for (const path of files) {
    let content;
    try { content = await adapter.read(path); }
    catch (e) { errors.push({ path, error: e && e.message }); continue; }

    const schedMatch = /^scheduled:\s*(.*)$/m.exec(content);
    if (!schedMatch) { skipped++; continue; }
    const schedValue = schedMatch[1].trim();

    const dueMatch = /^due:\s*(.*)$/m.exec(content);
    const dueIsBlank = !dueMatch || dueMatch[1].trim() === "";

    let updated = content;
    if (dueIsBlank && schedValue) {
      // Move the scheduled value into due (only when due is currently blank).
      if (dueMatch) {
        updated = updated.replace(/^due:\s*.*$/m, "due: " + schedValue);
      } else {
        // No due key at all (very old note) — insert one right after the
        // scheduled line so we don't have to guess at overall key order.
        updated = updated.replace(/^scheduled:\s*.*$/m, (m) => m + "\ndue: " + schedValue);
      }
    }
    // Always strip the scheduled line itself, whether or not we moved its value.
    updated = updated.replace(/^scheduled:\s*.*\n?/m, "");

    if (updated === content) { skipped++; continue; }

    try {
      const backupDir = ".sauce-backup/" + ts + "/" + path.split("/").slice(0, -1).join("/");
      const backupPath = ".sauce-backup/" + ts + "/" + path;
      if (typeof adapter.mkdir === "function") {
        try { await adapter.mkdir(backupDir); } catch (_e) { /* tolerate */ }
      }
      try { await adapter.write(backupPath, content); } catch (_e) { /* tolerate */ }
      await adapter.write(path, updated);
      renamed++;
    } catch (e) {
      errors.push({ path, error: e && e.message });
    }
  }

  history?.push({ event: "info", step: "task_due_scheduled_rename_migration", name: "task-entity",
    renamed, skipped, errors,
    reason: renamed + " task note(s) migrated from scheduled to due; " + skipped + " already-clean or no-op",
    git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
    completed_at: new Date().toISOString() });
}
```

- [ ] **Step 3: Wire the call site**

Find where task-entity-scoped heals are invoked (search `mech.name === "task-entity"` gate patterns, or find the mechanism-processing loop; task-entity currently has no per-mechanism heal calls of its own yet in this file — search for where OTHER mechanism-scoped heals are invoked, e.g. search `await apply` calls gated on `mech.name === "chrome-bar"` or similar single-mechanism heals, to find the right neighborhood in the install flow). Add:

```js
  await applyTaskDueScheduledRenameMigration(tp, mech, variables, history, git);   // NEW subtasks-and-dialog-polish cycle — renames scheduled -> due on every existing task note (open + _done/ + _trash/); ungated, idempotent, .sauce-backup before write. MUST run before any consumer relies on TaskEntity.queryToday's due-only bucketing.
```

placed in the same general call-sequence area as the to-do-blueprint heals from the previous cycle (`applyRecurringTasksMigrationHeal` and neighbors) — confirm by reading the surrounding 10-20 lines for the exact variable name in scope (likely `mech`, matching the established convention from the previous cycle's call site).

- [ ] **Step 4: Verify syntax + no regressions**

```bash
node -c platform/install.js && echo "syntax OK"
node platform/test/run-helper-cases.js 2>&1 | tail -5
node platform/test/run-bootstrap.js 2>&1 | tail -5
node platform/test/run-seed-migrations.js 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add platform/install.js
git commit -m "feat(task-entity): migrate scheduled to due on every existing task note"
```

---

### Task 7: Seed-vault coverage for the rename migration

**Files:**
- Modify or create: a `platform/test/seed-vault/spice/tasks/*.md` fixture with a pre-migration `scheduled:` key
- Modify: `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Check for an existing seed task note to reuse**

```bash
ls platform/test/seed-vault/spice/tasks/ 2>&1
grep -rl "^scheduled:" platform/test/seed-vault/spice/tasks/ 2>/dev/null
```

If a seed task note already exists with a `scheduled:` key and no (or blank) `due:` key, use it directly for this test (no new fixture needed — skip to Step 2). If none exists, create one: `platform/test/seed-vault/spice/tasks/Seed Migration Task.md`:

```markdown
---
type: task
title: Seed Migration Task
status: open
scheduled: 2026-06-14
due:
recurrence:
priority:
project:
project_slug:
source: manual
source_note:
links: []
created_at: "2026-06-14T09:00:00-06:00"
completed_at:
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });
```

---

<!-- TASK_NOTES -->
```

(This is a sanctioned seed edit for a new migration, per `Docs/agent-guides/migration-regression-net.md` § Per-cycle authoring loop.)

- [ ] **Step 2: Add the assert family**

In `platform/test/run-seed-migrations.js`, append (after the existing `HC-V0202-SEED-MIGRATE-RECURRING-*` family from the prior cycle):

```js
// ===== HC-V0205-SEED-MIGRATE-DUE-* — applyTaskDueScheduledRenameMigration =====
let migTask = null;
try { migTask = helpers.readNote(vault, "spice/tasks/Seed Migration Task.md"); } catch (_e) { migTask = null; }
ok(
    "HC-V0205-SEED-MIGRATE-DUE-1 seed task note with scheduled+blank-due migrated",
    migTask != null
);
if (migTask != null) {
    const { frontmatter: migFm } = helpers.parseFrontmatter(migTask);
    ok(
        "HC-V0205-SEED-MIGRATE-DUE-2 due now carries the old scheduled value",
        migFm.due === "2026-06-14"
    );
    ok(
        "HC-V0205-SEED-MIGRATE-DUE-3 scheduled key no longer present",
        !/^scheduled:/m.test(migTask)
    );
}
```

Adapt the field/lookup calling convention to whatever this file's actual existing pattern is (already confirmed in the prior cycle: `readNote` throws on a missing file, wrap in try/catch with the variable pre-initialized to `null`).

- [ ] **Step 3: Verify**

```bash
node platform/test/run-seed-migrations.js 2>&1 | grep -i "DUE-"
node platform/test/run-seed-migrations.js 2>&1 | grep -i IDEMP
```

Expected: 3 new asserts green; IDEMP family still green (second install doesn't re-add a `scheduled` key or duplicate anything).

- [ ] **Step 4: Full local verification**

```bash
npm run release:preflight 2>&1 | tail -40
```

- [ ] **Step 5: Commit**

```bash
git add platform/test/seed-vault/spice/tasks/ platform/test/run-seed-migrations.js
git commit -m "test(task-entity): add seed-vault coverage for the scheduled-to-due rename"
```

---

### Task 8: `TaskDialog` — progressive disclosure + visual polish

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

```js
ok('TD-polish-1 _moreOptionsShouldStartExpanded: false when no optional field is set', () => {
  const state = { priority: '', projectName: '', recurrence: '', notes: '', links: [] };
  assert(TaskDialog._moreOptionsShouldStartExpanded(state) === false, 'bare state -> collapsed');
});

ok('TD-polish-2 _moreOptionsShouldStartExpanded: true when ANY optional field is set', () => {
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: 'high', projectName: '', recurrence: '', notes: '', links: [] }) === true, 'priority set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: 'Connectors', recurrence: '', notes: '', links: [] }) === true, 'project set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: '', recurrence: 'every day', notes: '', links: [] }) === true, 'recurrence set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: '', recurrence: '', notes: 'some notes', links: [] }) === true, 'notes set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: '', recurrence: '', notes: '', links: ['[[A]]'] }) === true, 'links set -> expanded');
});

ok('TD-polish-3 _moreOptionsShouldStartExpanded tolerates a missing/null state', () => {
  assert(TaskDialog._moreOptionsShouldStartExpanded(null) === false, 'null state -> collapsed, never throws');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TD-polish"
```

- [ ] **Step 3: Implement the pure helper**

Add near `_recurrenceValidity`:

```js
    /**
     * Decide whether the dialog's "More options" section should start
     * EXPANDED: true iff any of Priority/Project/Repeats/Notes/Links already
     * has a value. Create mode always passes an all-blank state (nothing to
     * show yet) so this naturally returns false there. Pure, never throws.
     */
    static _moreOptionsShouldStartExpanded(state) {
        const s = state || {};
        if (s.priority && String(s.priority).trim()) return true;
        if (s.projectName && String(s.projectName).trim()) return true;
        if (s.recurrence && String(s.recurrence).trim()) return true;
        if (s.notes && String(s.notes).trim()) return true;
        if (Array.isArray(s.links) && s.links.length > 0) return true;
        return false;
    }
```

Add the instance delegator next to the others:

```js
    _moreOptionsShouldStartExpanded(state) { return TaskDialog._moreOptionsShouldStartExpanded(state); }
```

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TD-polish"
```

- [ ] **Step 5: Wire progressive disclosure into `_render`**

This step restructures the field layout. In `_render`, AFTER the Due field block (from Task 2, Step 5) and BEFORE the Priority chip row, insert the "More options" toggle + a collapsible container, then MOVE the existing Priority/Project/Notes/Links/Repeats field-building code (everything from `label('Priority')` through the end of the Links `try {...} catch` block) INSIDE that container instead of directly into `host`.

Concretely: change every one of those existing blocks' parent from `host` to a new `moreBox` element. The exact blocks to re-parent (their internal code is UNCHANGED — only the first `host.createEl(...)`/`label(...)` call inside each needs its target container swapped from `host` to `moreBox`, and `label(...)`'s own helper needs a variant that targets an arbitrary container):

First, generalize the `label` helper (currently hardcoded to `host`):

```js
        const label = (text) => {
            const el = host.createEl('div', { text });
            el.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:0.07em; font-weight:600; color:var(--text-muted, #999); margin-top:16px; margin-bottom:6px;';
            return el;
        };
```

Replace with a version that accepts an optional container (defaulting to `host` so any call site you DON'T update still works unchanged):

```js
        const label = (text, container) => {
            const el = (container || host).createEl('div', { text });
            el.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:0.07em; font-weight:600; color:var(--text-muted, #999); margin-top:16px; margin-bottom:6px;';
            return el;
        };
```

Right after the Due field block, insert the toggle + collapsible container:

```js
        // ----- More options toggle (progressive disclosure) -----
        // Everything below (Repeats, Priority, Project, Notes, Links) lives
        // inside moreBox, which starts collapsed in create mode and starts
        // EXPANDED in edit mode when the task already has any of those fields
        // set (so existing data is never hidden by default).
        const moreToggleRow = host.createDiv();
        moreToggleRow.style.cssText = 'margin-top:14px;';
        const moreToggle = moreToggleRow.createEl('button', { text: 'More options ▾' });
        moreToggle.style.cssText = 'display:inline-flex; align-items:center; gap:4px; padding:2px 0; border:none; background:transparent; color:var(--text-muted,#999); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; cursor:pointer;';
        try { moreToggle.setAttribute('type', 'button'); } catch (_e) {}

        const moreBox = host.createDiv();
        moreBox.style.cssText = 'overflow:hidden; max-height:0; opacity:0; transition:max-height 180ms ease, opacity 140ms ease; border-top:1px solid var(--background-modifier-border,#333); margin-top:0;';

        let moreExpanded = false;
        const setMoreExpanded = (expanded) => {
            moreExpanded = expanded;
            if (expanded) {
                moreBox.style.maxHeight = '2000px';
                moreBox.style.opacity = '1';
                moreBox.style.borderTopWidth = '1px';
                moreBox.style.marginTop = '10px';
                moreToggle.textContent = 'Less options ▴';
            } else {
                moreBox.style.maxHeight = '0';
                moreBox.style.opacity = '0';
                moreBox.style.borderTopWidth = '0';
                moreBox.style.marginTop = '0';
                moreToggle.textContent = 'More options ▾';
            }
        };
        moreToggle.onclick = () => setMoreExpanded(!moreExpanded);
```

Then change the following existing calls (Priority chip row, Project dropdown, Notes textarea, Links section) to target `moreBox` instead of `host`:

- `label('Priority');` → `label('Priority', moreBox);`
- `const chipRow = host.createDiv();` → `const chipRow = moreBox.createDiv();`
- `label('Project (optional)');` → `label('Project (optional)', moreBox);`
- `const projSelect = host.createEl('select');` → `const projSelect = moreBox.createEl('select');`
- `label('Notes (optional)');` → `label('Notes (optional)', moreBox);`
- `const notesInput = host.createEl('textarea');` → `const notesInput = moreBox.createEl('textarea');`
- `label('Links (optional)');` → `label('Links (optional)', moreBox);`
- `const chipsBox = host.createDiv();` → `const chipsBox = moreBox.createDiv();`
- `const linkRow = host.createDiv();` → `const linkRow = moreBox.createDiv();`
- `const inserterBox = host.createDiv();` → `const inserterBox = moreBox.createDiv();`

ALSO move the Repeats field (from Task-entity's recurring-tasks cycle: `label('Repeats ...')` through `recurInput`/`recurError`/`isSupportedFn`/`recurInput.oninput`) inside `moreBox` too — change its `label('Repeats (optional...')` call to `label('Repeats (optional — e.g. "every day", "every Monday", "every 2 weeks on Friday")', moreBox);` and its `host.createEl('input', ...)`/`host.createEl('div')` calls to `moreBox.createEl(...)`.

Finally, at the END of the field-building code (right before the `// ----- Footer -----` comment), call:

```js
        setMoreExpanded(TaskDialog._moreOptionsShouldStartExpanded(state));
```

- [ ] **Step 6: Manual verification (not covered by the Node harness — DOM/visual)**

Since this restructures the live-DOM `_render` method, there is no Node-level assertion for the actual expand/collapse rendering (the harness only tests the pure `_moreOptionsShouldStartExpanded` decision). Confirm by reading the edited file that every re-parented block's OWN internal logic (event handlers, variable references) is untouched — only the CONTAINER each block's first element attaches to changed. Note this as a manual-smoke item for later (opening the dialog in a real vault).

- [ ] **Step 7: Run tests + CJS-load gate**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -10
node platform/test/run-customjs-loadable.js 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): progressive disclosure in the task dialog (More options toggle)"
```

---

### Task 9: `TaskEntity` — `parent_task` field

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

```js
ok('TE-sub-1 composeNote emits parent_task (set + empty)', () => {
  const child = TaskEntity.composeNote({ title: 'Write intro', parent_task: '[[Ship the report]]', moment: fixedMoment });
  assert(child.frontmatter.parent_task === '[[Ship the report]]', 'parent_task set: ' + child.frontmatter.parent_task);
  const bare = TaskEntity.composeNote({ title: 'Top-level', moment: fixedMoment });
  assert(bare.frontmatter.parent_task === '', 'parent_task empty-string-not-omitted: ' + JSON.stringify(bare.frontmatter.parent_task));
  const keys = Object.keys(child.frontmatter);
  assert(keys.indexOf('source_note') === keys.indexOf('parent_task') - 1, 'parent_task follows source_note: ' + keys.join(','));
});

ok('TE-sub-2 parseNote normalizes parent_task via _linkText (Link object -> basename)', () => {
  const linkObj = { path: 'spice/tasks/Ship the report.md', display: null };
  const parsed = TaskEntity.parseNote({ title: 'Write intro', parent_task: linkObj, file: { path: 'spice/tasks/Write intro.md' } });
  assert(parsed.parent_task === 'Ship the report', 'coerced to basename: ' + parsed.parent_task);
  const bare = TaskEntity.parseNote({ title: 'Top-level', file: { path: 'spice/tasks/Top-level.md' } });
  assert(bare.parent_task === '', 'absent parent_task -> empty string: ' + JSON.stringify(bare.parent_task));
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TE-sub"
```

- [ ] **Step 3: Implement — `composeNote`**

Current (after Task 1's edit):

```js
            source: p.source || '',
            source_note: p.source_note || '',
            links: links,
```

Replace with:

```js
            source: p.source || '',
            source_note: p.source_note || '',
            parent_task: p.parent_task || '',
            links: links,
```

- [ ] **Step 4: Implement — `parseNote`**

Current (after Task 1's edit):

```js
            source_note: p.source_note != null ? TaskEntity._linkText(p.source_note) : null,
```

Add right after it:

```js
            parent_task: p.parent_task != null ? TaskEntity._linkText(p.parent_task) : '',
```

(Note: `source_note` normalizes to `null` when absent per the existing convention right above it, but `parent_task` should normalize to `''` per the design doc's empty-string-not-omitted convention — matching `recurrence`/`priority`'s pattern, not `source_note`'s. This is deliberate: `parent_task` is read directly as a plain string for "is this a subtask" checks (`if (task.parent_task)`), so empty-string is the more convenient falsy value than `null` for that call site.)

- [ ] **Step 5: Run to verify they pass**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TE-sub"
```

- [ ] **Step 6: Full harness**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): add parent_task field for subtasks"
```

---

### Task 10: `TaskTodayList.buildBands` — exclude subtasks

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

```js
ok('TTL-sub-1 buildBands excludes a task with parent_task set (shown in its parent Subtasks section instead)', () => {
  const tasks = [
    { title: 'Top-level today', status: 'open', due: '2026-07-08', parent_task: '' },
    { title: 'Subtask today', status: 'open', due: '2026-07-08', parent_task: 'Ship the report' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  assert(bands.today.length === 1 && bands.today[0].title === 'Top-level today', 'subtask excluded from Today: ' + JSON.stringify(bands.today));
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TTL-sub-1"
```

- [ ] **Step 3: Implement**

Current (after Task 3's edit):

```js
            if (t.project_slug && String(t.project_slug).trim() !== '') continue; // shown in its Project section
            if (t.source === 'meeting') continue;                                 // shown in Meeting Tasks
            const due = t.due;
```

Replace with:

```js
            if (t.project_slug && String(t.project_slug).trim() !== '') continue; // shown in its Project section
            if (t.source === 'meeting') continue;                                 // shown in Meeting Tasks
            if (t.parent_task && String(t.parent_task).trim() !== '') continue;   // shown in its parent's Subtasks section
            const due = t.due;
```

Update the doc-comment above `buildBands` to mention the new exclusion alongside the existing project/meeting ones.

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TTL-sub-1"
```

- [ ] **Step 5: Full harness**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): exclude subtasks from the personal Today/Overdue bands"
```

---

### Task 11: `TaskNoteView` — Subtasks section

**Files:**
- Modify: `platform/mechanisms/task-entity/task-note-view.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests for the pure progress-text helper**

```js
ok('TNV-sub-1 _subtaskProgressText: "N/M subtasks done" from a parsed-task array', () => {
  const subtasks = [
    { title: 'A', status: 'done' },
    { title: 'B', status: 'open' },
    { title: 'C', status: 'done' },
  ];
  assert(TaskNoteViewClass._subtaskProgressText(subtasks) === '2/3 subtasks done', 'progress text: ' + TaskNoteViewClass._subtaskProgressText(subtasks));
});

ok('TNV-sub-2 _subtaskProgressText tolerates empty/null input', () => {
  assert(TaskNoteViewClass._subtaskProgressText([]) === '', 'empty array -> empty string');
  assert(TaskNoteViewClass._subtaskProgressText(null) === '', 'null -> empty string, never throws');
});
```

(Use whichever constant name — `TaskNoteViewClass` or `TaskNoteView` — this file's existing tests already use for the loaded class; confirm by reading the top of `run-task-entity.js` where `task-note-view.js` is loaded, per Task 6 of the recurring-tasks cycle.)

- [ ] **Step 2: Run to verify they fail**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TNV-sub"
```

- [ ] **Step 3: Implement the pure helper**

Add near `_fieldRows`:

```js
    /**
     * Build the "N/M subtasks done" progress string from a parsed-task array
     * (TaskEntity.parseNote output for each child). Empty/null input -> ''
     * (caller skips rendering the line entirely). Pure, never throws.
     */
    static _subtaskProgressText(subtasks) {
        const list = Array.isArray(subtasks) ? subtasks : [];
        if (!list.length) return '';
        const done = list.filter(t => t && t.status === 'done').length;
        return done + '/' + list.length + ' subtasks done';
    }
```

Add the instance delegator next to `_fieldRows`'s:

```js
    _subtaskProgressText(subtasks) { return TaskNoteView._subtaskProgressText(subtasks); }
```

- [ ] **Step 4: Run to verify they pass**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TNV-sub"
```

- [ ] **Step 5: Implement the live Subtasks section in `render()`**

In `render()`, find the LINKS section (the code that renders `task.links` as clickable entries — search for where `task.links` is iterated) and the full-width "Edit task" button that follows it. Insert a new Subtasks section BETWEEN them (after LINKS, before the Edit button):

```js
            // ----- SUBTASKS (only meaningful when NOT itself a subtask — one
            // level of nesting only, per design) -----
            const isSubtask = !!(task.parent_task || (parsed && parsed.parent_task));
            if (!isSubtask && filePath) {
                let subtasks = [];
                try {
                    const raw = dv.pages('"spice/tasks"').where(p =>
                        p && p.type === 'task'
                        && p.file && p.file.path
                        && !p.file.path.includes('/_trash/')
                        && TE && typeof TE.parseNote === 'function'
                        && (() => {
                            try {
                                const pt = TE._linkText ? TE._linkText(p.parent_task) : String(p.parent_task || '');
                                const thisBase = filePath.split('/').pop().replace(/\.md$/i, '');
                                return pt === thisBase;
                            } catch (_e) { return false; }
                        })());
                    const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
                    subtasks = arr.map(p => TE.parseNote(p));
                } catch (_e) { subtasks = []; }

                drawDivider();
                const subHeadRow = card.createEl('div');
                subHeadRow.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; gap:8px;';
                const subLabel = subHeadRow.createEl('div', { text: 'SUBTASKS' });
                subLabel.style.cssText = 'font-size:0.68em; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);';
                const progressText = TaskNoteView._subtaskProgressText(subtasks);
                if (progressText) {
                    const prog = subHeadRow.createEl('span', { text: progressText });
                    prog.style.cssText = 'font-size:0.78em; color:var(--text-muted);';
                }

                const subList = card.createEl('div');
                subList.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
                const TTL = window.customJS && window.customJS.TaskTodayList;
                if (TTL && typeof TTL.renderTaskRow === 'function') {
                    for (const st of subtasks) {
                        try { TTL.renderTaskRow(subList, st, null); } catch (_e) {}
                    }
                }

                // Inline quick-add — mirrors TaskDialog.createQuick's one-gesture
                // shape, with parent_task stamped to THIS note.
                const addRow = card.createEl('div');
                addRow.style.cssText = 'display:flex; gap:8px; margin-top:2px;';
                const addInput = addRow.createEl('input', { type: 'text' });
                addInput.placeholder = '+ Add subtask…';
                addInput.style.cssText = 'flex:1 1 auto; min-width:0; box-sizing:border-box; padding:6px 10px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:13px;';
                const thisBasename = filePath.split('/').pop().replace(/\.md$/i, '');
                const doAdd = async () => {
                    const title = String(addInput.value || '').trim();
                    if (!title) return;
                    const TD = window.customJS && window.customJS.TaskDialog;
                    if (!TD || typeof TD.createQuick !== 'function') return;
                    try {
                        await TD.createQuick({ title, parent_task: '[[' + thisBasename + ']]' });
                        addInput.value = '';
                        try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
                        try { app.commands && app.commands.executeCommandById && app.commands.executeCommandById('dataview:dataview-force-refresh-views'); } catch (_e) {}
                    } catch (_e) { /* best-effort */ }
                };
                addInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); doAdd(); } });
            }

```

- [ ] **Step 6: Extend `TaskDialog.createQuick` to accept `parent_task`**

In `platform/mechanisms/task-entity/task-dialog.js`, `createQuick` currently reads (after Task 2's edit):

```js
    async createQuick(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        const title = String((opts && opts.title) || '').trim();
        if (!app || !title) return;
        const payload = {
            title,
            due: (opts && opts.today) || '',
            source: (opts && opts.source) || 'daily',
            links: [],
        };
        await this._create(app, payload, '');
    }
```

Replace with:

```js
    async createQuick(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        const title = String((opts && opts.title) || '').trim();
        if (!app || !title) return;
        const payload = {
            title,
            due: (opts && opts.today) || '',
            source: (opts && opts.source) || 'daily',
            parent_task: (opts && opts.parent_task) || '',
            links: [],
        };
        await this._create(app, payload, '');
    }
```

Add a Node test:

```js
ok('TD-sub-1 createQuick-shaped payload carries parent_task through composeNote', () => {
  const composed = TaskEntity.composeNote({ title: 'Write intro', parent_task: '[[Ship the report]]', due: '', source: 'daily', links: [], moment: fixedMoment });
  assert(composed.frontmatter.parent_task === '[[Ship the report]]', 'parent_task in composed frontmatter: ' + composed.frontmatter.parent_task);
});
```

(This exercises the same payload shape `createQuick` builds, without needing a live `window`/`app` — `createQuick` itself is browser-only and already covered by the manual smoke pass.)

- [ ] **Step 7: Add a "Part of: [[Parent]]" line on a subtask's own note**

Still in `render()`, find the SOURCE line (renders "From <source_note>" when `task.source_note` is set — search for that existing block) and add a parallel block right after it:

```js
            // "Part of" — a subtask's own note links back to its parent.
            if (isSubtask) {
                const partOfLine = card.createEl('div');
                partOfLine.style.cssText = 'font-size:0.85em; color:var(--text-muted);';
                partOfLine.createSpan({ text: 'Part of: ' });
                const parentBase = task.parent_task || (parsed && parsed.parent_task) || '';
                const link = partOfLine.createEl('a', { text: parentBase });
                link.classList.add('internal-link');
                link.style.cssText = 'color:var(--link-color, var(--text-accent)); cursor:pointer; text-decoration:none;';
                link.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    try {
                        if (window.app && window.app.workspace && typeof window.app.workspace.openLinkText === 'function') {
                            window.app.workspace.openLinkText(parentBase, filePath || '', false);
                        }
                    } catch (_e) { /* open best-effort */ }
                });
            }
```

Read the existing SOURCE-line block first to match its exact styling/placement convention (indentation, `card.createEl` usage, `filePath` variable name) before inserting — the code above is illustrative of shape, adapt variable names to match what's actually in scope at that point in `render()`.

- [ ] **Step 8: Update the `task` object build to include `parent_task`**

Current (after Task 4's edit):

```js
            const task = {
                title: str(parsed ? parsed.title : page.title),
                status: str((parsed && parsed.status) || page.status || 'open'),
                due: str(parsed ? parsed.due : page.due),
```

Add `parent_task` to this object:

```js
            const task = {
                title: str(parsed ? parsed.title : page.title),
                status: str((parsed && parsed.status) || page.status || 'open'),
                due: str(parsed ? parsed.due : page.due),
                parent_task: str(parsed ? parsed.parent_task : page.parent_task),
```

- [ ] **Step 9: Run tests + CJS-load gate**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -10
node platform/test/run-customjs-loadable.js 2>&1 | tail -5
```

- [ ] **Step 10: Commit**

```bash
git add platform/mechanisms/task-entity/task-note-view.js platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): add a live Subtasks section + quick-add to the task note card"
```

---

### Task 12: Ship it — preflight, PR, CI, merge, release, tap, brew, deploy

Same runbook shape as the recurring-tasks cycle. Run every step; do not skip ahead on a red result.

- [ ] **Step 1: Final local preflight**

```bash
git status
npm run release:preflight
```

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: subtasks + task-dialog polish (due/scheduled consolidation)" --body "$(cat <<'EOF'
## Summary
- Consolidates the task schema's scheduled/due fields into a single due field (with an install-time migration heal renaming every existing task note)
- Progressive disclosure in the create/edit task dialog: Title + Due always visible, everything else behind a "More options" toggle (auto-expands in edit mode when already populated)
- New subtasks: a parent_task field + a live "Subtasks" section on the task note card, with inline quick-add and a progress indicator; subtasks are excluded from the personal Today/Overdue bands (shown in their parent instead) but included in All-ToDos/Recurring/Completed

See Docs/plans/2026-07-08-subtasks-and-dialog-polish-design.md for the full design rationale.

## Test plan
- [x] npm run release:preflight green locally
- [x] New seed-vault migration coverage for the scheduled->due rename
- [ ] CI green on macOS + Ubuntu
EOF
)"
```

- [ ] **Step 3: Watch CI, merge once green**

```bash
gh pr checks <PR_NUMBER> --watch
```

Once green:

```bash
gh pr merge <PR_NUMBER> --squash --auto
```

- [ ] **Step 4: Handle the BEHIND treadmill (expected — other autonomous cycles land to main concurrently)**

If `gh pr view <PR_NUMBER> --json mergeStateStatus` shows `BEHIND` after checks pass:

```bash
git fetch origin
git merge origin/main --no-edit
npm run release:preflight
git push
```

Re-watch CI, repeat until it merges.

- [ ] **Step 5: Wait for the automated release PR, then the tap PR**

```bash
gh pr list --search "chore(release)" --state all --limit 5
gh pr list --repo willfell/homebrew-sauce --state open --limit 5
```

Merge the tap PR manually only if it hasn't auto-merged after a few minutes.

- [ ] **Step 6: `brew upgrade sauce`**

```bash
brew update
brew upgrade sauce
```

- [ ] **Step 7: Deploy to the 3 consumer vaults**

```bash
cd /Users/willfellhoelter/notes/sauce/accuris-sauce && sauce update --bump-pins && sauce status
cd /Users/willfellhoelter/notes/sauce/ero-sauce && sauce update --bump-pins && sauce status
cd /Users/willfellhoelter/notes/sauce/headspace-sauce && sauce update --bump-pins && sauce status
```

Expected on each: exit 0, `Drift: none`.

- [ ] **Step 8: Verify the rename migration actually ran against real data**

```bash
grep -L "^scheduled:" /Users/willfellhoelter/notes/sauce/accuris-sauce/spice/tasks/*.md 2>/dev/null | wc -l
grep -l "^scheduled:" /Users/willfellhoelter/notes/sauce/accuris-sauce/spice/tasks/*.md 2>/dev/null
```

Expected: the second command returns NOTHING (no task note anywhere in the vault still carries a `scheduled:` key after the heal ran). Repeat for ero-sauce and headspace-sauce.

- [ ] **Step 9: Cycle-close artifacts**

Write `Docs/plans/2026-07-08-subtasks-and-dialog-polish-result.md`, append to `Docs/cycle-history.md`, update `Docs/agent-guides/cycle-status.md`, per `Docs/agent-guides/build-test-verify.md` § Cycle-close artifacts. Use the actual shipped version number, not a placeholder.

- [ ] **Step 10: Report back**

Only after Steps 1-9 all show green/complete.

---

## Out of scope (unchanged from the design doc)

- Recursive/nested subtasks beyond one level.
- Auto-completing a parent when all subtasks are done.
- An orphan-cleanup heal for subtasks whose parent was deleted.
- Any change to `today-capture-editable-list.js` / `todo-create-task.js` / `todo-leaf-actions.js`.
