# To-do scope bar correction and restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five shipped defects in the daily to-do note's filter surface — make `All` mean all, make scope single-select so a pill never refuses a click, make priority visible, key persistence to the note's date, and remove the duplicate sort control from Home — then restyle the toggles to the count-pill geometry.

**Architecture:** `ToDoDailyFilterView` is a bare CustomJS class evaluated as one expression. Its pure statics (`selectByScope`, `sortTasks`, `groupByProject`, state helpers) are unit-tested directly by loading the file through `new Function`; its `render` is exercised against a hand-rolled DOM shim. Every change below is made to the pure statics first and wired into `render` last, so each task has a real test before it has an implementation.

**Tech Stack:** Plain ES2020 JavaScript, no build step, no bundler. Node's built-in `assert` and a bespoke `ok()/okAsync()` harness — no test framework. CSS is hand-authored in a single snippet file parsed by a custom rule-extractor in the test.

**Spec:** `Docs/superpowers/specs/2026-08-31-todo-scope-bar-design.md`

## Global Constraints

- **Bare class only.** `todo-daily-filter-view.js` is evaluated by CustomJS as a single expression. The file must contain exactly one `class` declaration and end with `}` — no `module.exports`, no trailing statements, no top-level `const`. `run-todo-daily-filter-view.js` asserts `SOURCE.trim().endsWith('}')`.
- **No comments in config, manifest, or infrastructure files.** JSON, YAML, and manifest files get no explanatory comments. Rationale goes in the test or the commit message. JavaScript and CSS are code and are commented normally, matching the density of the surrounding file.
- **No manual versioning.** Do not edit `package.json` version, tag, or touch release pins. The release pipeline is fully automatic.
- **All three harnesses are already registered** in `platform/test/preflight-manifest.json` (ids `todo-daily-filter-view`, `daily-dashboard`, `sauce-core-css`). Do not edit that manifest.
- **Retain the `SpaceDailyDashboard` comparator statics** — `compareTasksByDue`, `compareTasksByPriority`, `normalizeTaskSortMode`, `sortTasks`. `ToDoDailyFilterView.sortTasks` delegates to them through `customJS`.
- **Every commit** ends with these two trailers:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
  ```

- **Branch:** `fix/todo-scope-bar-correction`, worktree at `.claude/worktrees/todo-scope-bar`, based on `origin/main` @ `49856dbb`.
- **Run a single harness with:** `node platform/test/<name>.js` from the repo root. Exit code 0 means pass; the harness prints `N passed, M failed`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `platform/blueprints/to-do/helpers/todo-daily-filter-view.js` | The filter view: state model, selection, sorting, grouping, control-bar rendering | Modify — Tasks 1–4 |
| `platform/test/run-todo-daily-filter-view.js` | Unit + render coverage for the above | Modify — Tasks 1–4 |
| `platform/mechanisms/styling/assets/snippets/sauce-core.css` | Shared toggle-pill primitive, group and divider rules, priority dot | Modify — Task 5 |
| `platform/test/run-sauce-core-css.js` | Exact-geometry contract for the pill primitive | Modify — Task 5 |
| `platform/blueprints/daily/helpers/space-daily-dashboard.js` | Home / daily dashboard; owns the task comparators | Modify — Task 6 |
| `platform/test/run-daily-dashboard.js` | Home dashboard coverage | Modify — Task 6 |

`ranch/scripts/**` is installer output, not source. Never hand-edit it; Task 7 regenerates it.

---

## Task 1: State model — single scope, independent Done, note-date key

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js:9-61`
- Test: `platform/test/run-todo-daily-filter-view.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ToDoDailyFilterView.SCOPE_KEYS → string[]` — exactly `['today','overdue','upcoming','no-date','all']`. Note `'done'` is **gone**.
  - `ToDoDailyFilterView.DEFAULT_SCOPE → 'today'`
  - `ToDoDailyFilterView._defaultState(date: string) → State`
  - `ToDoDailyFilterView._normalizeState(value: unknown, date: string) → State`
  - `ToDoDailyFilterView.readState(storage, date: string) → State`
  - `ToDoDailyFilterView.writeState(storage, state, date: string) → State`
  - where `State = { scope: string, includeDone: boolean, sort: 'due'|'priority', groupByProject: boolean, date: string }`

`DEFAULT_SCOPES` (plural) is **deleted**. Task 4 removes its last reference.

- [ ] **Step 1: Write the failing test**

In `platform/test/run-todo-daily-filter-view.js`, delete the test named `TV3-STATE guarded storage round-trips canonical client-only state` entirely and add these two in its place:

```js
  ok('SB-STATE single-select scope round-trips and rejects junk', () => {
    const View = loadClass({});
    const D = '2026-08-11';
    const storage = makeStorage();
    assert.deepStrictEqual(View.SCOPE_KEYS, ['today', 'overdue', 'upcoming', 'no-date', 'all']);
    assert.strictEqual(View.DEFAULT_SCOPE, 'today');
    assert(!View.SCOPE_KEYS.includes('done'), "'done' is no longer a scope");

    assert.deepStrictEqual(View.readState(storage, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });

    const written = View.writeState(storage, {
      scope: 'all', includeDone: true, sort: 'priority', groupByProject: true,
    }, D);
    assert.deepStrictEqual(written,
      { scope: 'all', includeDone: true, sort: 'priority', groupByProject: true, date: D });
    assert.deepStrictEqual(View.readState(storage, D), written);

    // Unrecognised scope falls back to today; non-booleans are false.
    assert.deepStrictEqual(
      View._normalizeState({ scope: 'nonsense', includeDone: 'yes', sort: 'sideways', groupByProject: 1, date: D }, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });

    // Bad JSON and hostile storage both degrade to the default.
    storage.data.set(View.STORAGE_KEY, '{bad json');
    assert.deepStrictEqual(View.readState(storage, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.deepStrictEqual(View.readState(throwing, D),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: D });
    assert.doesNotThrow(() => View.writeState(throwing, written, D));
  });

  ok('SB-STATE state is keyed to the note date and legacy blobs are discarded', () => {
    const View = loadClass({});
    const storage = makeStorage();
    View.writeState(storage, { scope: 'all', includeDone: true, sort: 'priority', groupByProject: true }, '2026-08-11');

    // Same note: restored.
    assert.strictEqual(View.readState(storage, '2026-08-11').scope, 'all');
    // Different note: default, and the stored blob is left alone until written.
    assert.deepStrictEqual(View.readState(storage, '2026-08-12'),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: '2026-08-12' });

    // A pre-existing v0.288.0 blob has no `date` key at all and is discarded whole,
    // including its sort and grouping — not partially carried forward.
    storage.data.set(View.STORAGE_KEY,
      JSON.stringify({ scopes: ['upcoming', 'no-date'], sort: 'priority', groupByProject: true }));
    assert.deepStrictEqual(View.readState(storage, '2026-08-11'),
      { scope: 'today', includeDone: false, sort: 'due', groupByProject: false, date: '2026-08-11' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: FAIL on both `SB-STATE` tests. The first fails at the `SCOPE_KEYS` deep-equal (`'done'` is still present); the second fails because `readState` ignores its second argument.

- [ ] **Step 3: Write minimal implementation**

In `todo-daily-filter-view.js`, replace lines 9–61 (from `static get STORAGE_KEY()` through the end of `writeState`) with:

```js
    static get STORAGE_KEY() { return 'sauce-todo-filter:state'; }
    static get DEFAULT_SCOPE() { return 'today'; }
    static get SCOPE_KEYS() { return ['today', 'overdue', 'upcoming', 'no-date', 'all']; }

    static _defaultState(date) {
        return {
            scope: ToDoDailyFilterView.DEFAULT_SCOPE,
            includeDone: false,
            sort: 'due',
            groupByProject: false,
            date: String(date == null ? '' : date),
        };
    }

    static _normalizeState(value, date) {
        const wanted = String(date == null ? '' : date);
        if (!value || typeof value !== 'object') return ToDoDailyFilterView._defaultState(wanted);
        // A blob written before the scope bar correction carries `scopes[]` and no
        // `date` key. Discard it whole rather than guessing which single scope an
        // array of scopes meant.
        if (typeof value.date !== 'string' || value.date !== wanted) {
            return ToDoDailyFilterView._defaultState(wanted);
        }
        const scope = String(value.scope == null ? '' : value.scope).trim().toLowerCase();
        return {
            scope: ToDoDailyFilterView.SCOPE_KEYS.includes(scope)
                ? scope
                : ToDoDailyFilterView.DEFAULT_SCOPE,
            includeDone: value.includeDone === true,
            sort: String(value.sort || '').trim().toLowerCase() === 'priority' ? 'priority' : 'due',
            groupByProject: value.groupByProject === true,
            date: wanted,
        };
    }

    static storage() {
        try { return typeof window !== 'undefined' ? window.localStorage : null; }
        catch (_e) { return null; }
    }

    static readState(storage, date) {
        try {
            if (!storage || typeof storage.getItem !== 'function') {
                return ToDoDailyFilterView._defaultState(date);
            }
            const raw = storage.getItem(ToDoDailyFilterView.STORAGE_KEY);
            if (!raw) return ToDoDailyFilterView._defaultState(date);
            return ToDoDailyFilterView._normalizeState(JSON.parse(raw), date);
        } catch (_e) {
            return ToDoDailyFilterView._defaultState(date);
        }
    }

    static writeState(storage, state, date) {
        const normalized = ToDoDailyFilterView._normalizeState(
            { ...(state || {}), date: String(date == null ? '' : date) },
            date,
        );
        try {
            if (storage && typeof storage.setItem === 'function') {
                storage.setItem(ToDoDailyFilterView.STORAGE_KEY, JSON.stringify(normalized));
            }
        } catch (_e) { /* local preference persistence is best-effort */ }
        return normalized;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: both `SB-STATE` tests PASS. Other tests still fail — `TV3-SCOPE`, `TV4-DONE` and `TV3-RENDER` reference `DEFAULT_SCOPES` and the old `selectByScope` signature. That is expected; Tasks 2 and 4 fix them.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-daily-filter-view.js platform/test/run-todo-daily-filter-view.js
git commit -F - <<'EOF'
fix(todo): key filter state to the note date and make scope single-select

The scopes array let a click empty the selection, which _normalizeState read
as "use defaults" and answered by restoring Today + Overdue. A pill that
turned itself back on read as a pill that did nothing. A single-select scope
cannot be empty, so the snap-back branch is deleted rather than repaired.

One storage key was also shared by every to-do note forever, so a fresh day
restored a filter chosen days earlier without saying so. State now carries
the note's own date and is discarded on mismatch.

Blobs written before this change carry scopes[] and no date key. They are
discarded whole rather than mapped forward: there is no honest single-scope
reading of ['today','overdue'], and a filter preference is cheap to re-express.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
EOF
```

---

## Task 2: Selection rule — `All` means all

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js` — the `selectByScope` static
- Test: `platform/test/run-todo-daily-filter-view.js`

**Interfaces:**
- Consumes: `ToDoDailyFilterView.SCOPE_KEYS` and `DEFAULT_SCOPE` from Task 1.
- Produces: `ToDoDailyFilterView.selectByScope(tasks, scope: string, includeDone: boolean, todayIso: string) → task[]`. The signature changes from four arguments `(tasks, scopeSet, todayIso)` to four `(tasks, scope, includeDone, todayIso)`. Task 4 is the only caller.

- [ ] **Step 1: Write the failing test**

Delete the two tests named `TV3-SCOPE multi-select adds Upcoming and gates No date behind no-date or All` and `TV4-DONE is off by default and includes only tasks completed today when enabled`, and replace the test named `TV3-SCOPE default Today+Overdue selects exactly the intended open tasks` with:

```js
  ok('SB-SCOPE each single scope selects exactly its own open tasks', () => {
    const View = loadClass({});
    const titles = (scope, includeDone) =>
      View.selectByScope(TASKS, scope, includeDone === true, TODAY).map((task) => task.title);

    assert.deepStrictEqual(titles('today'), ['Today low']);
    assert.deepStrictEqual(titles('overdue'), ['Overdue high']);
    assert.deepStrictEqual(titles('upcoming'), ['Upcoming highest']);
    assert.deepStrictEqual(titles('no-date'), ['No date medium']);
    assert.deepStrictEqual(titles('all'),
      ['Today low', 'Overdue high', 'Upcoming highest', 'No date medium']);

    // An unrecognised scope resolves to today rather than selecting nothing.
    assert.deepStrictEqual(titles('nonsense'), ['Today low']);
  });

  ok('SB-DONE is an independent include, and All + Done reaches older completions', () => {
    const View = loadClass({});
    const titles = (scope, includeDone) =>
      View.selectByScope(TASKS, scope, includeDone === true, TODAY).map((task) => task.title);

    // Off by default on every scope.
    for (const scope of View.SCOPE_KEYS) {
      assert(!titles(scope).some((title) => title.startsWith('Done')),
        `scope ${scope} leaked a done task with includeDone false`);
    }

    // A date scope adds only today's completions.
    assert.deepStrictEqual(titles('today', true), ['Today low', 'Done today']);
    assert(!titles('today', true).includes('Done yesterday'));

    // This is the defect: All + Done must reach a completion older than today.
    assert.deepStrictEqual(titles('all', true),
      ['Today low', 'Overdue high', 'Upcoming highest', 'No date medium', 'Done today', 'Done yesterday']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: FAIL on both. `SB-SCOPE` fails because the current `selectByScope` treats its second argument as a Set and its third as `todayIso`, so every call selects nothing. `SB-DONE` fails on the final assertion — `Done yesterday` is missing.

- [ ] **Step 3: Write minimal implementation**

Replace the whole `selectByScope` static with:

```js
    static selectByScope(tasks, scope, includeDone, todayIso) {
        const raw = String(scope == null ? '' : scope).trim().toLowerCase();
        const key = ToDoDailyFilterView.SCOPE_KEYS.includes(raw)
            ? raw
            : ToDoDailyFilterView.DEFAULT_SCOPE;
        const all = key === 'all';
        const today = String(todayIso || '');
        return (Array.isArray(tasks) ? tasks : []).filter((task) => {
            if (!task) return false;
            const status = String(task.status || 'open').toLowerCase();
            if (status === 'done') {
                // Completion is an independent include, evaluated for its own sake —
                // never an early return that the `all` widening cannot reach.
                if (!includeDone) return false;
                if (all) return true;
                if (!task.completed_at) return false;
                const completed = task.completed_at;
                if (typeof completed === 'object' && typeof completed.toFormat === 'function') {
                    return completed.toFormat('yyyy-MM-dd') === today;
                }
                return String(completed).slice(0, 10) === today;
            }
            if (status !== 'open') return false;
            if (all) return true;
            const due = task.due == null ? '' : String(task.due).trim();
            if (!due) return key === 'no-date';
            if (due === today) return key === 'today';
            if (due < today) return key === 'overdue';
            return key === 'upcoming';
        });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: `SB-SCOPE` and `SB-DONE` PASS. `TV3-RENDER` still fails — Task 4 rewires `render`.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-daily-filter-view.js platform/test/run-todo-daily-filter-view.js
git commit -F - <<'EOF'
fix(todo): let All reach every task instead of only the open ones

selectByScope evaluated its done branch and returned before it ever reached
`if (all) return true`, so "All" meant "all open" and "Done" meant "completed
today". No combination of the six pills could surface a task completed before
today, which is why All read as broken.

Completion is now an independent include evaluated for its own sake, and the
`all` widening reaches both sides. All + Done returns every task ever.

The previous suite asserted the defective set as correct; that expectation is
replaced rather than extended.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
EOF
```

---

## Task 3: Priority dot

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js` — add two statics after `groupByProject`
- Test: `platform/test/run-todo-daily-filter-view.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ToDoDailyFilterView.priorityLevel(task) → 'highest'|'high'|'medium'|'low'|'none'`
  - `ToDoDailyFilterView.decorateRow(row, task) → element|null` — inserts a `span.sauce-task-priority-dot.is-<level>` into the row and returns it.

`decorateRow` targets `.sauce-task-today-titlegroup`, created by `TaskTodayList.renderTaskRow` at `platform/mechanisms/task-entity/task-today-list.js:557`. The dot goes **after** the checkbox wrapper (`.sauce-task-today-cbwrap`) when one exists. `renderTaskRow` itself is not modified — it is the shared row renderer for Home, project, meeting and trip lists, and decorating locally holds the blast radius at this one surface.

- [ ] **Step 1: Write the failing test**

First, the DOM shim needs `querySelector` and `insertBefore`. In `makeElement`, add these two methods immediately after the existing `removeChild` method:

```js
    insertBefore(child, ref) {
      const index = ref == null ? this.children.length : this.children.indexOf(ref);
      const at = index < 0 ? this.children.length : index;
      const existing = this.children.indexOf(child);
      if (existing >= 0) this.children.splice(existing, 1);
      child.parentNode = this;
      this.children.splice(at > this.children.length ? this.children.length : at, 0, child);
      return child;
    },
    querySelector(selector) {
      const want = String(selector).replace(/^\./, '');
      return descendants(this).find((node) =>
        String(node.className).split(/\s+/).includes(want)) || null;
    },
```

and add a `nextSibling` getter immediately after the existing `firstChild` getter:

```js
    get nextSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      return siblings[siblings.indexOf(this) + 1] || null;
    },
```

Then add this test immediately after the `SB-DONE` test:

```js
  ok('SB-PRIORITY classifies every level and lands the dot after the checkbox', () => {
    const View = loadClass({});

    assert.strictEqual(View.priorityLevel({ priority: 'highest' }), 'highest');
    assert.strictEqual(View.priorityLevel({ priority: '  High  ' }), 'high');
    assert.strictEqual(View.priorityLevel({ priority: 'MEDIUM' }), 'medium');
    assert.strictEqual(View.priorityLevel({ priority: 'low' }), 'low');
    assert.strictEqual(View.priorityLevel({ priority: '' }), 'none');
    assert.strictEqual(View.priorityLevel({ priority: 'urgent' }), 'none');
    assert.strictEqual(View.priorityLevel({}), 'none');
    assert.strictEqual(View.priorityLevel(null), 'none');

    // Real row shape: row > titlegroup > [cbwrap, title]
    const row = makeElement('div', 'sauce-task-today-row');
    const group = row.createEl('div', { cls: 'sauce-task-today-titlegroup' });
    const cbwrap = group.createEl('div', { cls: 'sauce-task-today-cbwrap' });
    const title = group.createEl('span', { cls: 'sauce-task-today-title', text: 'Retire Atlas' });

    const dot = View.decorateRow(row, { priority: 'high' });
    assert(dot, 'decorateRow returned nothing');
    assert.deepStrictEqual(String(dot.className).split(/\s+/).sort(),
      ['is-high', 'sauce-task-priority-dot']);
    assert.strictEqual(dot.attributes['aria-hidden'], 'true');
    assert.deepStrictEqual(group.children, [cbwrap, dot, title],
      'dot must sit between the checkbox and the title');

    // An unset priority still renders a dot, so every row keeps the same
    // left edge and the column does not ragged out.
    const bare = makeElement('div', 'sauce-task-today-row');
    bare.createEl('div', { cls: 'sauce-task-today-titlegroup' });
    assert(String(View.decorateRow(bare, {}).className).includes('is-none'));

    // A row without the expected structure degrades to no dot, never a throw.
    assert.doesNotThrow(() => View.decorateRow(makeElement('div', 'x'), { priority: 'low' }));
    assert.strictEqual(View.decorateRow(null, { priority: 'low' }), null);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: FAIL `SB-PRIORITY` with `View.priorityLevel is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `todo-daily-filter-view.js`, add both statics immediately after the `groupByProject` static:

```js
    static priorityLevel(task) {
        const known = ['highest', 'high', 'medium', 'low'];
        const raw = String(task && task.priority || '').trim().toLowerCase();
        return known.includes(raw) ? raw : 'none';
    }

    /**
     * Decorate a row produced by TaskTodayList.renderTaskRow with a priority
     * dot. Deliberately NOT done inside renderTaskRow: that method is shared by
     * the Home, project, meeting and trip lists, and only this surface offers a
     * Priority sort that the dot exists to explain. Every guard degrades to no
     * dot rather than throwing, so a future change to the row's internals
     * cannot break the list.
     */
    static decorateRow(row, task) {
        if (!row || typeof row.querySelector !== 'function') return null;
        let group = null;
        try { group = row.querySelector('.sauce-task-today-titlegroup'); } catch (_e) { group = null; }
        if (!group || typeof group.createEl !== 'function') return null;
        const dot = group.createEl('span', {
            cls: `sauce-task-priority-dot is-${ToDoDailyFilterView.priorityLevel(task)}`,
        });
        if (typeof dot.setAttribute === 'function') dot.setAttribute('aria-hidden', 'true');
        try {
            const cbWrap = group.querySelector('.sauce-task-today-cbwrap');
            if (cbWrap && typeof group.insertBefore === 'function') {
                group.insertBefore(dot, cbWrap.nextSibling);
            }
        } catch (_e) { /* append order is an acceptable fallback */ }
        return dot;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: `SB-PRIORITY` PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-daily-filter-view.js platform/test/run-todo-daily-filter-view.js
git commit -F - <<'EOF'
feat(todo): give each task row a priority dot

Only 11 of roughly 170 task notes in a live vault carry a priority, and no row
rendered any priority signal. So Due and Priority produced the same order most
of the time, and on the occasions they differed nothing on screen explained the
change. A sort whose effect is invisible reads as broken whether or not it ran.

The dot is added by decorating the row TaskTodayList.renderTaskRow returns
rather than by editing renderTaskRow, which is the shared row renderer for the
Home, project, meeting and trip lists. Only this surface offers the Priority
sort the dot exists to explain.

An unset priority renders a hollow dot rather than nothing, so every row keeps
the same left edge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
EOF
```

---

## Task 4: Control bar — four groups, note date, wired render

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js` — the `render` method
- Test: `platform/test/run-todo-daily-filter-view.js`

**Interfaces:**
- Consumes: `readState`/`writeState`/`SCOPE_KEYS` (Task 1), `selectByScope` (Task 2), `decorateRow` (Task 3).
- Produces:
  - `ToDoDailyFilterView.noteDate(page) → string` — extracts `YYYY-MM-DD` from a `ToDo-YYYY-MM-DD` filename, or `''`.
  - Rendered DOM: four `.sauce-pill-group` elements in order — scopes, done, sort, group — and two `.sauce-todo-filter-sep` dividers, inside `.sauce-todo-filter-controls`, followed by `.sauce-todo-filter-rule`.

Button count changes from 9 to 9 (five scopes + Done + Due + Priority + By Project). The grouping changes from 2 groups to 4.

- [ ] **Step 1: Write the failing test**

Add the `noteDate` test immediately after `SB-PRIORITY`:

```js
  ok('SB-NOTEDATE reads the date from the note filename, not the clock', () => {
    const View = loadClass({});
    assert.strictEqual(View.noteDate({ file: { name: 'ToDo-2026-08-31' } }), '2026-08-31');
    assert.strictEqual(View.noteDate({ file: { name: 'ToDo-2026-08-31.md' } }), '2026-08-31');
    assert.strictEqual(View.noteDate({ file: { name: 'Some Other Note' } }), '');
    assert.strictEqual(View.noteDate({ file: {} }), '');
    assert.strictEqual(View.noteDate(null), '');
  });
```

Then replace the whole `TV3-RENDER paints one flat ul, shared pills, live rows, and persisted interactions` test with:

```js
  await okAsync('SB-RENDER paints four pill groups and persists every interaction', async () => {
    const storage = makeStorage();
    const rendered = [];
    let clockReads = 0;
    const windowShim = {
      localStorage: storage,
      moment: () => { clockReads += 1; return { format: () => TODAY }; },
      customJS: {
        RenderSafe: { page: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }) },
        TaskEntity: { parseNote(page) { return { ...page, path: page.file.path }; } },
        TaskTodayList: {
          renderTaskRow(container, task) {
            rendered.push(task.title);
            const row = container.createEl('div', { cls: 'sauce-task-today-row' });
            const group = row.createEl('div', { cls: 'sauce-task-today-titlegroup' });
            group.createEl('div', { cls: 'sauce-task-today-cbwrap' });
            group.createEl('span', { cls: 'sauce-task-today-title', text: task.title });
            return row;
          },
        },
        TaskDialog: {},
        SectionLabel: {
          render(dvLike, opts) {
            return dvLike.container.createEl('div', { cls: 'sauce-section-label', text: opts.text });
          },
        },
        SpaceDailyDashboard: {
          compareTasksByDue(a, b) {
            return String(a.due || '9999-99-99').localeCompare(String(b.due || '9999-99-99'));
          },
          compareTasksByPriority(a, b) {
            const rank = { highest: 4, high: 3, medium: 2, low: 1 };
            return (rank[b.priority] || 0) - (rank[a.priority] || 0) || this.compareTasksByDue(a, b);
          },
        },
      },
    };
    const View = loadClass(windowShim);
    const root = makeElement();
    const dv = {
      container: root,
      current: () => ({ type: 'to-do', file: { name: `ToDo-${TODAY}` } }),
      pages: () => dataArray(TASKS),
    };
    await new View().render(dv);

    assert.strictEqual(clockReads, 1, 'render reads the live clock exactly once');
    assert.strictEqual(byClass(root, 'sauce-pill-group').length, 4, 'scopes, done, sort, group');
    assert.strictEqual(byClass(root, 'sauce-todo-filter-sep').length, 2);
    assert.strictEqual(byClass(root, 'sauce-todo-filter-rule').length, 1);
    assert.strictEqual(byClass(root, 'sauce-todo-daily-filter-list').length, 1);

    const buttons = descendants(root).filter((node) => node.tagName === 'BUTTON');
    assert.deepStrictEqual(buttons.map((b) => b.textContent),
      ['Today', 'Overdue', 'Upcoming', 'No date', 'All', 'Done', 'Due', 'Priority', 'By Project']);
    assert(buttons.every((b) => String(b.className).split(/\s+/).includes('sauce-pill-toggle')));

    // Default is Today alone — not Today + Overdue.
    assert.deepStrictEqual(rendered, ['Today low']);
    assert.strictEqual(byClass(root, 'sauce-task-priority-dot').length, 1);

    const find = (label) => buttons.find((b) => b.textContent === label);

    // Scope is single-select: choosing Overdue deselects Today.
    await find('Overdue').fire('click');
    assert(String(find('Overdue').className).includes('is-active'));
    assert(!String(find('Today').className).includes('is-active'));
    assert.strictEqual(rendered[rendered.length - 1], 'Overdue high');

    // Clicking the active scope again keeps it active — it can never empty.
    await find('Overdue').fire('click');
    assert(String(find('Overdue').className).includes('is-active'));
    assert.strictEqual(View.readState(storage, TODAY).scope, 'overdue');

    // Done is independent of scope.
    await find('All').fire('click');
    await find('Done').fire('click');
    assert(String(find('Done').className).includes('is-active'));
    assert(String(find('All').className).includes('is-active'));
    assert.deepStrictEqual(View.readState(storage, TODAY), {
      scope: 'all', includeDone: true, sort: 'due', groupByProject: false, date: TODAY,
    });
    assert(rendered.slice(-6).includes('Done yesterday'), 'All + Done reaches older completions');

    await find('Priority').fire('click');
    assert.strictEqual(View.readState(storage, TODAY).sort, 'priority');

    await find('By Project').fire('click');
    assert(String(find('By Project').className).includes('is-active'));
    assert.strictEqual(byClass(root, 'sauce-todo-filter-project-label').length, 2);
    assert.strictEqual(View.readState(storage, TODAY).groupByProject, true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: FAIL `SB-NOTEDATE` (`View.noteDate is not a function`) and FAIL `SB-RENDER` (four groups expected, two found).

- [ ] **Step 3: Write minimal implementation**

Add the `noteDate` static immediately after `decorateRow`:

```js
    static noteDate(page) {
        const name = page && page.file && page.file.name;
        const match = /ToDo-(\d{4}-\d{2}-\d{2})/.exec(String(name == null ? '' : name));
        return match ? match[1] : '';
    }
```

Then, inside `render`, replace everything from `const storage = ToDoDailyFilterView.storage();` down to the end of the method with:

```js
        const storage = ToDoDailyFilterView.storage();
        // Persistence is keyed to the note's own date so opening another day never
        // silently restores a filter chosen on a different one. Scope arithmetic
        // below still resolves against the live clock, not this date.
        const noteDate = ToDoDailyFilterView.noteDate(page);
        let state = ToDoDailyFilterView.readState(storage, noteDate);

        const root = dv.container.createEl('div', { cls: 'sauce-todo-daily-filter-view' });
        root.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%;';

        const controls = root.createEl('div', { cls: 'sauce-todo-filter-controls' });
        const scopeGroup = controls.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-scopes' });
        scopeGroup.setAttribute('role', 'group');
        scopeGroup.setAttribute('aria-label', 'Filter tasks by date scope');

        const rightSide = controls.createEl('div', { cls: 'sauce-todo-filter-right' });
        const doneGroup = rightSide.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-done' });
        doneGroup.setAttribute('role', 'group');
        doneGroup.setAttribute('aria-label', 'Include completed tasks');
        rightSide.createEl('div', { cls: 'sauce-todo-filter-sep' }).setAttribute('aria-hidden', 'true');
        const sortGroup = rightSide.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-sort' });
        sortGroup.setAttribute('role', 'group');
        sortGroup.setAttribute('aria-label', 'Sort tasks');
        rightSide.createEl('div', { cls: 'sauce-todo-filter-sep' }).setAttribute('aria-hidden', 'true');
        const groupGroup = rightSide.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-group' });
        groupGroup.setAttribute('role', 'group');
        groupGroup.setAttribute('aria-label', 'Group tasks');

        root.createEl('div', { cls: 'sauce-todo-filter-rule' }).setAttribute('aria-hidden', 'true');

        const listHost = root.createEl('div', { cls: 'sauce-todo-daily-filter-list-host' });
        listHost.style.cssText = 'display:flex; flex-direction:column; gap:8px; width:100%;';

        const scopeButtons = {};
        const sortButtons = {};
        let doneButton = null;
        let groupButton = null;
        const setPill = (button, active) => {
            button.className = `sauce-pill-toggle${active ? ' is-active' : ''}`;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        };
        const updateButtons = () => {
            for (const key of ToDoDailyFilterView.SCOPE_KEYS) {
                setPill(scopeButtons[key], state.scope === key);
            }
            setPill(doneButton, state.includeDone);
            for (const key of ['due', 'priority']) setPill(sortButtons[key], state.sort === key);
            setPill(groupButton, state.groupByProject);
        };

        const dashboard = CJS.SpaceDailyDashboard || null;
        const TD = CJS.TaskDialog || null;
        const makeList = (parent) => {
            const list = parent.createEl('ul', { cls: 'sauce-todo-daily-filter-list' });
            list.style.cssText = 'display:flex; flex-direction:column; gap:0; margin:0; padding:0; list-style:none; width:100%;';
            return list;
        };
        const renderRows = (list, rows) => {
            for (const task of rows) {
                try {
                    const row = TTL.renderTaskRow(list, task, TD);
                    ToDoDailyFilterView.decorateRow(row, task);
                    if (task.status === 'done' && row && typeof row.querySelector === 'function') {
                        const checkbox = row.querySelector('input[type="checkbox"]');
                        if (checkbox) checkbox.checked = true;
                    }
                } catch (_e) { /* isolate bad notes */ }
            }
        };
        const renderList = () => {
            while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
            const selected = ToDoDailyFilterView.selectByScope(
                tasks, state.scope, state.includeDone, todayIso);
            const sorted = ToDoDailyFilterView.sortTasks(selected, state.sort, dashboard);
            if (!sorted.length) {
                const list = makeList(listHost);
                const empty = list.createEl('li', { cls: 'sauce-todo-filter-empty', text: 'No tasks in this scope.' });
                empty.style.cssText = 'color:var(--text-muted); font-size:0.85em; font-style:italic; padding:6px 0;';
                return;
            }
            if (!state.groupByProject) {
                renderRows(makeList(listHost), sorted);
                return;
            }
            const SL = CJS.SectionLabel || null;
            for (const group of ToDoDailyFilterView.groupByProject(sorted)) {
                const section = listHost.createEl('div', { cls: 'sauce-todo-filter-project-group' });
                const label = section.createEl('div', { cls: 'sauce-todo-filter-project-label' });
                if (SL && typeof SL.render === 'function') {
                    try { SL.render({ ...dv, container: label }, { text: group.label }); }
                    catch (_e) { label.textContent = group.label; }
                } else {
                    label.textContent = group.label;
                    label.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); font-weight:600;';
                }
                renderRows(makeList(section), group.tasks);
            }
        };

        const commit = (next) => {
            state = ToDoDailyFilterView.writeState(storage, next, noteDate);
            updateButtons();
            renderList();
        };
        const onClick = (handler) => (event) => {
            try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
            handler();
        };

        const scopeLabels = {
            today: 'Today', overdue: 'Overdue', upcoming: 'Upcoming',
            'no-date': 'No date', all: 'All',
        };
        for (const key of ToDoDailyFilterView.SCOPE_KEYS) {
            const button = scopeGroup.createEl('button', { text: scopeLabels[key] });
            scopeButtons[key] = button;
            button.setAttribute('type', 'button');
            // Single-select: choosing a scope replaces the previous one. There is no
            // deselect, so a click can never empty the selection.
            button.addEventListener('click', onClick(() => commit({ ...state, scope: key })));
        }

        doneButton = doneGroup.createEl('button', { text: 'Done' });
        doneButton.setAttribute('type', 'button');
        doneButton.addEventListener('click', onClick(
            () => commit({ ...state, includeDone: !state.includeDone })));

        for (const key of ['due', 'priority']) {
            const button = sortGroup.createEl('button', { text: key === 'due' ? 'Due' : 'Priority' });
            sortButtons[key] = button;
            button.setAttribute('type', 'button');
            button.addEventListener('click', onClick(() => commit({ ...state, sort: key })));
        }

        groupButton = groupGroup.createEl('button', { text: 'By Project' });
        groupButton.setAttribute('type', 'button');
        groupButton.addEventListener('click', onClick(
            () => commit({ ...state, groupByProject: !state.groupByProject })));

        updateButtons();
        renderList();
```

Also delete the now-unused inline `controls.style.cssText` line if the editor left one behind — spacing moves to CSS in Task 5.

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-todo-daily-filter-view.js`
Expected: ALL tests PASS, including `TV3-LOAD`, `TV4-GROUP`, `TV4-TEMPLATE`, `TV3-SORT` and `TV3-COLD`, which are unchanged. Confirm the summary line reads `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-daily-filter-view.js platform/test/run-todo-daily-filter-view.js
git commit -F - <<'EOF'
feat(todo): split the filter bar into four labelled groups

Six pills in one group made scope, completion, sort and grouping read as one
undifferentiated row, which is why the right-hand pills were not recognisable
as sort order at all. They are now four groups — scope, include, sort, group —
separated by hairline dividers, with a rule closing the bar off from the list
it governs.

Scope pills are single-select and carry aria-pressed; the Done switch is
independent of them. Rows are decorated with a priority dot as they render.

Persistence is keyed to the note's date, parsed from the ToDo-YYYY-MM-DD
filename. Scope arithmetic still resolves against the live clock: binding it
to the note's date would turn an older note into a frozen historical view,
which is a larger change than this one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
EOF
```

---

## Task 5: Pill geometry, dividers, and the dot's CSS

**Files:**
- Modify: `platform/mechanisms/styling/assets/snippets/sauce-core.css:185-220`
- Test: `platform/test/run-sauce-core-css.js:230-255` and `:477-478`

**Interfaces:**
- Consumes: the class names emitted in Tasks 3 and 4 — `.sauce-task-priority-dot.is-<level>`, `.sauce-todo-filter-controls`, `.sauce-todo-filter-right`, `.sauce-todo-filter-sep`, `.sauce-todo-filter-rule`.
- Produces: no JS interface.

The active state moves from a solid accent fill to a tinted fill so an active pill stops out-weighing the task titles it filters — the same reasoning that made the section-count pills tinted.

- [ ] **Step 1: Write the failing test**

In `platform/test/run-sauce-core-css.js`, change the two geometry assertions (currently at lines 232–234) to:

```js
  assert.strictEqual(minHeight, 19, "toggle min-height must remain the intended lean 19px");
  assert.deepStrictEqual(padding.slice(1).map(Number), [1, 12],
    "toggle padding must remain the intended lean 1px 12px");
```

Replace the three-entry active-state contract loop (currently the block asserting `background: var(--interactive-accent, #7c3aed)`) with:

```js
  for (const contract of [
    "border-color: var(--interactive-accent, #7c3aed)",
    "background: color-mix(in srgb, var(--interactive-accent, #7c3aed) 14%, transparent)",
    "color: var(--interactive-accent, #7c3aed)",
    "box-shadow: 0 0 8px color-mix(in srgb, var(--interactive-accent, #7c3aed) 30%, transparent)",
  ]) {
    assert.ok(active.declarations.includes(contract), "toggle active state lost " + contract);
  }
  assert.ok(!active.declarations.includes("background: var(--interactive-accent"),
    "active toggle must be tinted, not a solid accent block");
```

Update the degenerate-value negative fixtures (currently at lines 477–478) to:

```js
    ["min-height: 19px", "min-height: 0px", "degenerate height"],
    ["padding: 1px 12px", "padding: 0px 0px", "degenerate padding"],
```

And add this new test immediately before the `run-sauce-core-css` summary line. Note the house wrapper here is `test(name, fn)` — **not** `ok()` — and the pill rules live in `css` (the `sauce-core.css` contents), not `theme`:

```js
test("SB-CSS priority dot, control layout, and dividers are bound", () => {
  const all = rules(css);
  const dot = all.find((rule) => rule.selector === ".sauce-task-priority-dot");
  assert.ok(dot, "missing .sauce-task-priority-dot base rule");
  for (const contract of ["width: 7px", "height: 7px", "border-radius: 50%", "flex-shrink: 0"]) {
    assert.ok(dot.declarations.includes(contract), "priority dot lost " + contract);
  }
  for (const level of ["highest", "high", "medium", "low", "none"]) {
    assert.ok(all.some((rule) => rule.selector === `.sauce-task-priority-dot.is-${level}`),
      `missing priority dot level: ${level}`);
  }
  for (const selector of [
    ".sauce-todo-filter-controls",
    ".sauce-todo-filter-right",
    ".sauce-todo-filter-sep",
    ".sauce-todo-filter-rule",
  ]) {
    assert.ok(all.some((rule) => rule.selector === selector), `missing layout rule: ${selector}`);
  }
});
```

Note also that `assertTogglePillContract(source)` at line 211 is called four times — once with the real `css` at line 449, and three times with deliberately weakened fixtures at 457, 468 and 486 that assert the contract *rejects* degenerate values. The fixture strings you edit above are the ones the call at 486 mutates; if the geometry values in the fixture no longer match the real CSS, that negative test stops proving anything.

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-sauce-core-css.js`
Expected: FAIL — `toggle min-height must remain the intended lean 19px` (finds 20), plus the missing dot and layout selectors.

- [ ] **Step 3: Write minimal implementation**

In `sauce-core.css`, change the two toggle rules to:

```css
body .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 19px;
  padding: 1px 12px;
  border: 1px solid var(--sauce-hairline);
  border-radius: var(--sauce-radius-pill);
  background: var(--background-primary, #fff);
  color: var(--text-muted, #666);
  font: inherit;
  font-size: 0.8em;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
```

Leave the remainder of that rule (cursor, transition, and so on) exactly as it is. Then replace the `.is-active` rule with:

```css
body .sauce-pill-toggle.is-active.sauce-pill-toggle.sauce-pill-toggle {
  border-color: var(--interactive-accent, #7c3aed);
  background: color-mix(in srgb, var(--interactive-accent, #7c3aed) 14%, transparent);
  color: var(--interactive-accent, #7c3aed);
  box-shadow: 0 0 8px color-mix(in srgb, var(--interactive-accent, #7c3aed) 30%, transparent);
}
```

Append these rules immediately after the `:focus-visible` toggle rule:

```css
.sauce-todo-filter-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--size-4-2, 8px);
  width: 100%;
}

.sauce-todo-filter-right {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2, 8px);
}

.sauce-todo-filter-sep {
  width: 1px;
  align-self: stretch;
  min-height: 16px;
  background: var(--sauce-hairline);
}

.sauce-todo-filter-rule {
  height: 1px;
  width: 100%;
  background: var(--sauce-hairline);
}

.sauce-task-priority-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: center;
}

.sauce-task-priority-dot.is-highest {
  background: var(--color-red);
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-red) 55%, transparent);
}

.sauce-task-priority-dot.is-high {
  background: var(--color-red);
}

.sauce-task-priority-dot.is-medium {
  background: var(--color-orange);
}

.sauce-task-priority-dot.is-low {
  background: var(--text-muted, #666);
}

.sauce-task-priority-dot.is-none {
  background: transparent;
  border: 1.5px solid color-mix(in srgb, var(--text-muted, #666) 45%, transparent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-sauce-core-css.js && node platform/test/run-modal.js`
Expected: both PASS, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/styling/assets/snippets/sauce-core.css platform/test/run-sauce-core-css.js
git commit -F - <<'EOF'
style(core): widen the toggle pill and tint its active state

At min-height 20px against 8px of horizontal padding, short labels like All,
Due and Done rendered nearly circular. The pill now takes the geometry of the
section-count pills it sits beside — 19px tall, 12px of horizontal padding,
0.8em — so the box follows the label instead of the label rattling inside a
fixed box.

The active state moves from a solid accent fill to a 14% tint with a hairline
glow, for the same reason the count pills were built tinted: an active filter
should not be the heaviest element on a note whose subject is the task list
underneath it.

Adds the control-bar layout, the group dividers, the rule closing the bar off
from the list, and the five priority dot levels.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
EOF
```

---

## Task 6: Remove the duplicate sort control from Home

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js:114-116`, `:157-185`, `:623-640`, `:659-672`, `:749-750`, `:770-786`
- Test: `platform/test/run-daily-dashboard.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SpaceDailyDashboard.compareTasksByDue`, `compareTasksByPriority`, `normalizeTaskSortMode` and `sortTasks` all keep their current signatures and remain public. `_TASK_SORT_STORAGE_KEY`, `readTaskSortMode`, `writeTaskSortMode` and `taskSortStorage` are removed.

- [ ] **Step 1: Write the failing test**

This harness has its own conventions that differ from the others: `assert(cond, msg)` is a **custom counting function**, not Node's `assert` — there is no `assert.ok` or `assert.strictEqual` here. The counters are `pass`/`fail`, not `passed`/`failed`. The source is already read into `SDD_SRC` at line 20, so do not re-read it.

Add this inside the async IIFE, immediately before the final `console.log` summary line:

```js
  await ok('SB-HOME sort control removed, comparators and count pills retained', async () => {
    for (const gone of [
      'sauce-daily-dashboard:task-sort-mode',
      'sauce-daily-task-sort',
      'readTaskSortMode',
      'writeTaskSortMode',
      'taskSortStorage',
      'updateSortButtonState',
    ]) {
      assert(!SDD_SRC.includes(gone),
        `Home must no longer carry its own sort control: found ${gone}`);
    }

    // The to-do note delegates to these through customJS. Removing them with the
    // control would silently drop ToDoDailyFilterView onto its private fallbacks.
    for (const kept of [
      'static compareTasksByDue',
      'static compareTasksByPriority',
      'static normalizeTaskSortMode',
      'static sortTasks',
    ]) {
      assert(SDD_SRC.includes(kept), `ToDoDailyFilterView depends on ${kept}`);
    }

    // The glance affordances stay.
    for (const kept of ['sauce-section-open-pill', 'sauce-section-done-pill']) {
      assert(SDD_SRC.includes(kept), `Home lost its count pill: ${kept}`);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-daily-dashboard.js`
Expected: non-zero exit. Because `assert` here counts rather than throws, the line to look for is `  FAIL Home must no longer carry its own sort control: found sauce-daily-dashboard:task-sort-mode` in the output, and a non-zero `fail` count in the summary — **not** a thrown stack trace.

- [ ] **Step 3: Write minimal implementation**

In `space-daily-dashboard.js`:

1. Delete the `_TASK_SORT_STORAGE_KEY` getter (lines 114–116).
2. Delete `readTaskSortMode`, `writeTaskSortMode` and `taskSortStorage` (lines 157–185). Keep `compareTasksByDue`, `compareTasksByPriority`, `normalizeTaskSortMode` and `sortTasks` exactly as they are.
3. Delete the `let taskSortControl = null;` declaration and the whole `renderRight:` property from the `_renderSection` options object, so the call reads:

```js
      const tasksBody = this._renderSection(container, {
        accent: "cyan",
        iconHtml: icons.checkSquare,
        titleHtml: '<span class="sauce-section-title-link">Tasks</span>',
        rightHtml: tasksRightHtml,
        defaultOpen: true,
        stateKey: "sauce-daily-dashboard:tasks",
        sectionState,
      });
```

4. Delete this entire run from the top of the task-list block — the two storage lines, the comment above them, the `sortControl` alias, the `sortButtons` map, and the whole `updateSortButtonState` arrow function including its body and closing `};`:

```js
        const taskSortStorage = SpaceDailyDashboard.taskSortStorage();
        let taskSortMode = SpaceDailyDashboard.readTaskSortMode(taskSortStorage);

        // Client-only sort control. The preference never enters the vault:
        // localStorage is the sole persistence rail and every access is guarded.
        const sortControl = taskSortControl;

        const sortButtons = {};
        const updateSortButtonState = () => {
          for (const mode of ["due", "priority"]) {
            const active = mode === taskSortMode;
            const button = sortButtons[mode];
            button.setAttribute("aria-pressed", active ? "true" : "false");
            button.className = `sauce-pill-toggle${active ? " is-active" : ""}`;
          }
        };
```

The next surviving line in that block is `const taskLists = tasksBody.createEl("div");`.

5. Change the two `sortTasks` calls to a fixed mode:

```js
          const sortedOpen = SpaceDailyDashboard.sortTasks(openTasks, "due");
          const sortedOverdue = SpaceDailyDashboard.sortTasks(overdueTasks, "due");
```

6. Delete this entire button-construction loop and the `updateSortButtonState();` call directly beneath it:

```js
        for (const mode of ["due", "priority"]) {
          const button = sortControl.createEl("button");
          sortButtons[mode] = button;
          button.className = "sauce-pill-toggle";
          button.textContent = mode === "due" ? "Due" : "Priority";
          button.setAttribute("type", "button");
          button.setAttribute("aria-label", `Sort daily tasks by ${mode}`);
          button.addEventListener("click", (event) => {
            try { event.preventDefault(); } catch (_e) {}
            try { event.stopPropagation(); } catch (_e) {}
            taskSortMode = SpaceDailyDashboard.writeTaskSortMode(taskSortStorage, mode);
            updateSortButtonState();
            renderTaskLists();
          });
        }
        updateSortButtonState();
        renderTaskLists();
```

leaving exactly one line where all of that stood:

```js
        renderTaskLists();
```

- [ ] **Step 4: Regenerate the installed mirror, then run the tests**

`run-daily-dashboard.js:210` asserts `SDD_SRC === SDD_MIRROR_SRC` — the source must be byte-identical to `ranch/scripts/daily/space-daily-dashboard.js`. Editing the source alone therefore fails this harness on a check that has nothing to do with your change. Regenerate the mirror first:

```bash
node platform/install.js . \
  && node platform/test/run-daily-dashboard.js \
  && node platform/test/run-home.js \
  && node platform/test/run-renderer.js
```

Expected: all three PASS. `run-home.js` and `run-renderer.js` both exercise the dashboard and will catch a mis-scoped deletion.

Confirm the installer touched nothing under `platform/`:

```bash
git status --short platform/
```

Expected: only `space-daily-dashboard.js` and `run-daily-dashboard.js`, both of which you edited.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/daily/helpers/space-daily-dashboard.js platform/test/run-daily-dashboard.js ranch/scripts/daily/space-daily-dashboard.js
git commit -F - <<'EOF'
refactor(daily): drop Home's duplicate task sort control

Home carried its own Due/Priority control backed by its own storage key,
independent of the one on the to-do note, over an overlapping set of tasks.
Two unrelated sort states across two surfaces is why neither read as working.

Home is a glance surface. The count pills and the move-to-tomorrow calendar
stay, because those are a summary and a quick action rather than
configuration; the to-do note now owns all filtering and ordering.

The comparator statics are deliberately retained even though Home no longer
offers a choice between them: ToDoDailyFilterView resolves them through
customJS, so deleting them with the control would drop the to-do note onto
its private fallback comparators without any test noticing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
EOF
```

---

## Task 7: Full preflight and dogfood install

**Files:**
- Modify: `ranch/scripts/**` (installer output — regenerated, never hand-edited)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: a green preflight and a self-installed workshop vault.

- [ ] **Step 1: Run the three directly affected harnesses**

Run:

```bash
node platform/test/run-todo-daily-filter-view.js \
  && node platform/test/run-sauce-core-css.js \
  && node platform/test/run-daily-dashboard.js
```

Expected: each prints `0 failed`.

- [ ] **Step 2: Run the full preflight**

Run: `npm run release:preflight`
Expected: exit 0. It is manifest-driven and concurrent, so read the failure summary at the end rather than the first red line in the scroll.

If `run-sticky-notes-render-guards` fails, re-run it alone — it has a recorded history of flaking, though it passed 6/6 on 2026-08-11:

```bash
node platform/test/run-sticky-notes-render-guards.js
```

- [ ] **Step 3: Regenerate the installed copies**

Run: `node platform/install.js .`
Expected: `ranch/scripts/to-do/todo-daily-filter-view.js`, `ranch/scripts/daily/space-daily-dashboard.js` and the CSS snippet are rewritten from `platform/`. Confirm no source file under `platform/` was modified by the installer:

```bash
git status --short platform/
```

Expected: empty.

- [ ] **Step 4: Verify the installed copy matches source**

Run:

```bash
diff platform/blueprints/to-do/helpers/todo-daily-filter-view.js \
     ranch/scripts/to-do/todo-daily-filter-view.js && echo IDENTICAL
```

Expected: `IDENTICAL`.

- [ ] **Step 5: Commit**

```bash
git add ranch/
git commit -F - <<'EOF'
chore(dogfood): reinstall the workshop vault after the scope bar correction

Regenerated installer output only. No hand edits under ranch/.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFYGhpMDAQDQe8ToLrGoGu
EOF
```

---

## Verification checklist

Before opening a PR, confirm each of these by running the command and reading the output — not by assuming:

- [ ] `node platform/test/run-todo-daily-filter-view.js` → `0 failed`
- [ ] `node platform/test/run-sauce-core-css.js` → `0 failed`
- [ ] `node platform/test/run-daily-dashboard.js` → `0 failed`
- [ ] `node platform/test/run-home.js` → `0 failed`
- [ ] `npm run release:preflight` → exit 0
- [ ] `git status --short platform/` after `node platform/install.js .` → empty
- [ ] `grep -rn "DEFAULT_SCOPES" platform/` → no hits (the plural constant is fully retired)
- [ ] `grep -rn "task-sort-mode" platform/` → no hits

## Spec requirements not implemented here

These are recorded in the spec's Out of scope section and are **not** part of this plan. Do not do them:

- Closing the parked `Daily To-Do Sort Surface Correction` epic in the headspace vault.
- Pruning stale `.worktrees/codex-autoloop-*` directories.
- Rebinding scope arithmetic to the note's date rather than the wall clock.
- Backfilling `priority` across existing task notes.
