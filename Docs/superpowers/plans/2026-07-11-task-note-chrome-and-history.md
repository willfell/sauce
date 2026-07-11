# Task Note Chrome + Completed-Subtask History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Completed" subtask-history list to the parent task note's SUBTASKS section, and adopt the shared `ChromeBar` + breadcrumb chrome on every task note (parent and subtask alike), matching every other adopted-blueprint surface.

**Architecture:** One new collapsible block reusing the existing `TaskDoneTodayList` pre-check convention (task-note-view.js). One new `TaskChromeBar` helper built via `ChromeBar.makeAdapter` (leaf-only, no primary/overflow) wired into `TaskEntity._chromeBody()` for new notes. A `breadcrumb.types.task` manifest declaration (with a conditional `parent_task` ancestor for subtasks) and three small additions to `platform/install.js`'s already-shipped generic chrome-heal tables (`roots`, type-allowlist, `CHROME_BAR_MAP`) to retrofit existing task notes — no new heal function, reusing `_healChromeBarMigration` exactly as every prior ChromeBar-adoption cycle did.

**Tech Stack:** CustomJS (Obsidian), Dataview, `platform/install.js` (Templater-driven installer), Node test harness (`platform/test/run-task-entity.js`, a new `platform/test/run-task-chrome-bar-heal.js`).

**Spec:** `docs/superpowers/specs/2026-07-11-task-note-chrome-and-history-design.md`

---

### Task 1: Completed-subtask history in `task-note-view.js`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-note-view.js:695` (insertion point, just after the `+ Add subtask` keydown listener, still inside the same `if (!isSubtask && filePath) { try { ... } catch` block)
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

Add this test to `platform/test/run-task-entity.js`, right after the existing `TNV-sub-3` test:

```javascript
// TNV-DONE-1/2. Completed-subtask history: the SUBTASKS section renders a
// collapsible "Completed (N)" <details> block listing every subtask whose
// status is 'done' (from allSubtasks, the unfiltered open+done list — NOT
// openSubtasks, which only feeds the open rows above it), each row's
// checkbox pre-checked (mirrors TaskDoneTodayList's exact convention:
// render via the shared renderTaskRow, then set cb.checked = true via
// querySelector afterward, since renderTaskRow always starts unchecked).
// Rendered ONLY when there is at least one done subtask — no empty
// "Completed (0)" clutter. Source-text assertion (this method's dv
// dependency has no dv-stub test in this harness; see TNV-sub-3 for the
// same convention).
ok('TNV-DONE-1 SUBTASKS section renders a Completed(N) details block from done subtasks only when non-empty', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'task-entity', 'task-note-view.js'), 'utf8');
  const m = /if\s*\(!isSubtask\s*&&\s*filePath\)\s*\{([\s\S]*?)\n\s+\}\s*catch\s*\(_e\)\s*\{\s*\/\*\s*SUBTASKS section best-effort/;
  const sectionMatch = m.exec(src);
  assert(sectionMatch, 'SUBTASKS section block found in task-note-view.js');
  const section = sectionMatch[1];
  assert(/doneSubtasks\s*=\s*allSubtasks\.filter/.test(section),
    'doneSubtasks must be derived by filtering allSubtasks (status===done), got section:\n' + section);
  assert(/if\s*\(doneSubtasks\.length\)/.test(section),
    'the Completed block must be gated on doneSubtasks.length (no empty block)');
  assert(/for\s*\(const st of doneSubtasks\)/.test(section),
    'the Completed row loop must iterate doneSubtasks');
  assert(/cb\.checked\s*=\s*true/.test(section),
    'each Completed row must have its checkbox pre-checked (mirrors TaskDoneTodayList)');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL — the current source has no `doneSubtasks` variable.

- [ ] **Step 3: Implement the "Completed" block**

In `platform/mechanisms/task-entity/task-note-view.js`, immediately after this line (the `+ Add subtask` keydown listener):

```javascript
                    addInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); doAdd(); } });
```

and BEFORE the section's closing:

```javascript
                } catch (_e) { /* SUBTASKS section best-effort — never break the card */ }
```

insert:

```javascript

                    // ----- Completed subtasks — collapsible history (mirrors
                    // TaskDoneTodayList's exact convention: reuse the shared
                    // renderTaskRow for a uniform row, then pre-check the
                    // checkbox afterward since renderTaskRow always starts
                    // unchecked). Uses allSubtasks (unfiltered — open+done),
                    // NOT openSubtasks, so a completed subtask shows up here
                    // instead of vanishing with no trace. Rendered only when
                    // there's at least one done subtask — no empty clutter.
                    const doneSubtasks = allSubtasks.filter(t => t && t.status === 'done');
                    if (doneSubtasks.length) {
                        const doneDetails = card.createEl('details');
                        doneDetails.setAttribute('open', '');
                        doneDetails.style.cssText = 'width:100%; box-sizing:border-box; margin-top:6px;';
                        const doneSummary = doneDetails.createEl('summary');
                        doneSummary.style.cssText = 'cursor:pointer; user-select:none; list-style:none; font-size:0.68em; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted); font-weight:600;';
                        doneSummary.textContent = 'Completed (' + doneSubtasks.length + ')';
                        const doneList = doneDetails.createEl('div');
                        doneList.style.cssText = 'display:flex; flex-direction:column; gap:2px; margin-top:4px;';
                        if (TTL && typeof TTL.renderTaskRow === 'function') {
                            for (const st of doneSubtasks) {
                                try {
                                    const row = TTL.renderTaskRow(doneList, st, null);
                                    const cb = row && row.querySelector && row.querySelector('input[type="checkbox"]');
                                    if (cb) cb.checked = true;
                                } catch (_e) {}
                            }
                        }
                    }
```

Note: `TTL` is already declared earlier in this same block (`const TTL = window.customJS && window.customJS.TaskTodayList;`, right before the open-subtask row loop) — reuse it, do not redeclare.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-task-entity.js`
Expected: PASS — `TNV-DONE-1` passes.

- [ ] **Step 5: Verify the CustomJS load gate still accepts the file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-note-view.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): show completed subtasks in a collapsible history list"
```

---

### Task 2: `TaskChromeBar` helper

**Files:**
- Create: `platform/mechanisms/task-entity/task-chrome-bar.js`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

Add these tests to `platform/test/run-task-entity.js`, near the top where other class loaders are declared (look for `const TaskNoteViewClass = loadClass(...)`) — add a sibling loader:

```javascript
const TaskChromeBarClass = loadClass('mechanisms/task-entity/task-chrome-bar.js', 'TaskChromeBar');
const TaskChromeBar = new TaskChromeBarClass();
```

Then add these tests anywhere after that (e.g. right after the SCP-* tests):

```javascript
// ---------- TaskChromeBar (TCB-*) ----------
//
// Task notes are pure leaf entities in the ChromeBar model: no primary
// action (creation/editing happen elsewhere on the card), no overflow menu,
// no cross-links ("This task" section) since the card's own SOURCE / Part-of
// / SUBTASKS sections already cover task-to-task navigation.

ok('TCB-1 detect() matches type:task pages, returns null for others', () => {
  const config = TaskChromeBar._config();
  const ctx = config.detect(null, { type: 'task', file: { path: 'spice/tasks/Groceries.md' } });
  assert(ctx && ctx.context === 'task', 'detects a task page');
  assert(ctx.path === 'spice/tasks/Groceries.md', 'carries the page path');
  assert(config.detect(null, { type: 'meeting' }) === null, 'non-task type -> null');
  assert(config.detect(null, null) === null, 'null page -> null');
});

ok('TCB-2 surfaceSpec() is a nav-only leaf: no primary, no overflow', () => {
  const config = TaskChromeBar._config();
  const spec = config.surfaceSpec({ context: 'task' });
  assert(spec.primary === null, 'no primary action');
  assert(Array.isArray(spec.overflow) && spec.overflow.length === 0, 'no overflow actions');
  assert(spec.leaf === true, 'leaf surface');
});

ok('TCB-3 destinations() returns no cross-links', () => {
  const config = TaskChromeBar._config();
  assert(deepEq(config.destinations(null, { context: 'task' }), []), 'no This-task section');
});

ok('TCB-4 dispatch() never throws for any id', () => {
  const config = TaskChromeBar._config();
  let threw = false;
  try { config.dispatch(null, { context: 'task' }, 'anything'); } catch (_e) { threw = true; }
  assert(!threw, 'dispatch is a safe no-op');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL — `mechanisms/task-entity/task-chrome-bar.js` doesn't exist yet, so `loadClass` throws.

- [ ] **Step 3: Create the class**

Create `platform/mechanisms/task-entity/task-chrome-bar.js`:

```javascript
/**
 * TaskChromeBar (CustomJS) — task-entity's ChromeBar adapter config. Renders
 * the shared breadcrumb + Go ▾ bar on `type: task` notes (both top-level
 * tasks and their subtasks) via customJS.ChromeBar.makeAdapter(this._config()),
 * the same factory every other blueprint's <X>ChromeBar uses.
 *
 * Task notes are pure LEAF entities in the ChromeBar model: no primary
 * action (task creation lives in the daily's "+ New Task" nav button and the
 * SUBTASKS section's own "+ Add subtask" input; editing lives in the card's
 * own "Edit task" button) and no overflow menu. No "This task" cross-links
 * either — the card's own SOURCE / Part-of / SUBTASKS sections already cover
 * every task-to-task navigation need. Breadcrumb rendering itself is handled
 * entirely by ChromeBar.render reading task-entity's manifest breadcrumb.types.task
 * registry entry — this class supplies no breadcrumb logic of its own.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the
 * whole file in `( ... )` and evals it as ONE expression; any trailer
 * (module.exports, if, ...) → "Unexpected token" → the class never
 * registers. To Node-test the statics, load via
 * `new Function(src + "\nreturn TaskChromeBar;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskChromeBar._config() → { detect, surfaceSpec, dispatch, destinations, rootClass, btnClass }
 *
 * Instance API (browser-side):
 *   TaskChromeBar.render(dv) ← the customjs-guard entry point
 */
class TaskChromeBar {

    // ---------- Instance delegator (customJS stores INSTANCES) ----------

    _config() { return TaskChromeBar._config(); }

    // ---------- Static pure helper ----------

    /**
     * The adapter config consumed by ChromeBar.makeAdapter. `detect` matches
     * any `type: task` page (both top-level tasks and subtasks — they're
     * indistinguishable at this layer; the breadcrumb registry is what draws
     * the extra ancestor for a subtask, via its own parent_task predicate).
     * Pure; never throws.
     */
    static _config() {
        return {
            detect: (dv, page) => {
                if (page && page.type === 'task') {
                    return { context: 'task', path: (page.file && page.file.path) || '' };
                }
                return null;
            },
            surfaceSpec: () => ({ primary: null, overflow: [], leaf: true }),
            dispatch: () => {},
            destinations: () => [],
            rootClass: 'task-chrome-root',
            btnClass: (v) => 'task-chrome-btn task-chrome-btn-' + v,
        };
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Delegates entirely
     * to the shared ChromeBar mechanism. Cold-load safe (optional-chained
     * customJS lookups) and never throws.
     */
    render(dv) {
        try {
            if (!window.customJS || !window.customJS.ChromeBar
                || typeof window.customJS.ChromeBar.makeAdapter !== 'function'
                || typeof window.customJS.ChromeBar.render !== 'function') return;
            return window.customJS.ChromeBar.render(dv, window.customJS.ChromeBar.makeAdapter(TaskChromeBar._config()));
        } catch (_e) { /* never throw */ }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node platform/test/run-task-entity.js`
Expected: PASS — `TCB-1` through `TCB-4` pass.

- [ ] **Step 5: Verify the CustomJS load gate accepts the new file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-chrome-bar.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): add TaskChromeBar leaf-only ChromeBar adapter"
```

---

### Task 3: Manifest — register the class, add deps, declare the breadcrumb

**Files:**
- Modify: `platform/mechanisms/task-entity/manifest.json`

- [ ] **Step 1: Add the new class to `customjs_classes`**

In `platform/mechanisms/task-entity/manifest.json`, find the `customjs_classes` array (currently `["TaskEntity", "TaskDialog", "TaskTodayList", "TaskNoteView", "TaskMeetingList", "TaskProjectList", "TaskDoneTodayList"]`) and add `"TaskChromeBar"` to it.

- [ ] **Step 2: Add the two new dependencies**

Find `depends_on` (currently `[{ "name": "customjs-guard", "range": ">=1.0.0" }]`) and add two more entries, matching the ranges the `to-do` blueprint already declares for the same mechanisms:

```json
{ "name": "chrome-bar", "range": ">=0.3.0" },
{ "name": "breadcrumb", "range": ">=0.1.0" }
```

- [ ] **Step 3: Add the breadcrumb declaration**

Add a top-level `"breadcrumb"` key (sibling of `depends_on`/`customjs_classes`):

```json
"breadcrumb": {
    "types": {
        "task": {
            "ancestors": [
                { "label": "lit:To-Do" },
                { "when": { "fm:parent_task": "present" }, "label": "fm:parent_task", "link": "spice/tasks/{fm:parent_task}.md" }
            ],
            "current": { "label": "fm:title|file:basename" }
        }
    }
}
```

- [ ] **Step 4: Validate the manifest is still valid JSON and passes schema lint**

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/mechanisms/task-entity/manifest.json', 'utf8')); console.log('valid JSON')"`
Expected: prints `valid JSON`, no throw.

Run: `node scripts/lint-schemas.js`
Expected: PASS (no new schema violations).

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/manifest.json
git commit -m "feat(task-entity): register TaskChromeBar, depend on chrome-bar+breadcrumb, declare task breadcrumb type"
```

---

### Task 4: Wire `TaskEntity._chromeBody()` to use `TaskChromeBar`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js` (`_chromeBody()` static method)
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (`_chromeBody()`'s fallback copy, used only when `TaskEntity` is unavailable — see Step 3b)
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Update the existing test**

There is already a test named `CB-1` in `platform/test/run-task-entity.js` (search for `'CB-1 _chromeBody emits SpaceNavButtons`) that hardcodes the old expectation. Read it, then rewrite its assertions in place (keep the name `CB-1`, just fix what it checks) to:

```javascript
ok('CB-1 _chromeBody emits TaskChromeBar + HR + TaskNoteView + HR + marker in order (no bare SpaceNavButtons)', () => {
  const body = TaskEntity._chromeBody();
  assert(body.includes('class: "TaskChromeBar"'), '_chromeBody must invoke TaskChromeBar');
  assert(!body.includes('class: "SpaceNavButtons"'), '_chromeBody must no longer invoke the legacy bare SpaceNavButtons');
  assert(body.includes('class: "TaskNoteView"'), '_chromeBody still invokes TaskNoteView');
  assert(body.includes('<!-- TASK_NOTES -->'), '_chromeBody still carries the TASK_NOTES marker');
  assert(body.indexOf('TaskChromeBar') < body.indexOf('TaskNoteView'), 'TaskChromeBar renders before TaskNoteView');
});
```

Leave the adjacent `CB-2` test (`TaskDialog._chromeBody fallback is byte-identical to TaskEntity._chromeBody`) untouched — it will keep passing once Step 3's edits land in both files, since it compares the two at test-run time rather than hardcoding either body.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL — current `_chromeBody()` still emits `SpaceNavButtons`.

- [ ] **Step 3: Implement the change**

**3a.** In `platform/mechanisms/task-entity/task-entity.js`, find `_chromeBody()`:

```javascript
    static _chromeBody() {
        return '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '<!-- TASK_NOTES -->\n';
    }
```

Replace it with (only the first dataviewjs block's class name changes):

```javascript
    static _chromeBody() {
        return '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '<!-- TASK_NOTES -->\n';
    }
```

Update the doc-comment right above `_chromeBody()` — it currently says "SpaceNavButtons gives vault-global nav; the TaskNoteView widget renders the clean task card." Change it to say `TaskChromeBar gives the shared breadcrumb + Go ▾ nav bar (see task-entity's manifest breadcrumb.types.task declaration); the TaskNoteView widget renders the clean task card.`

**3b.** `platform/mechanisms/task-entity/task-dialog.js` carries its OWN fallback copy of this exact string, used only when `TaskEntity` isn't reachable (`static _chromeBody()`, the block after `return TE._chromeBody();` fails/is unavailable) — its own doc-comment says it must stay "in lockstep with TaskEntity._chromeBody". Find:

```javascript
        return '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '<!-- TASK_NOTES -->\n';
    }
}
```

Change only the class name on the same line as Step 3a: `"SpaceNavButtons"` → `"TaskChromeBar"`. This is what keeps `CB-2`'s byte-identity assertion (`TaskDialog._chromeBody() === TaskEntity._chromeBody()`) passing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-task-entity.js`
Expected: PASS — `CB-1` and `CB-2` both pass.

- [ ] **Step 5: Verify the CustomJS load gate still accepts both files**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): new task notes render TaskChromeBar instead of bare SpaceNavButtons"
```

---

### Task 5: Heal existing task notes — wire `install.js`'s generic chrome-heal tables

**Files:**
- Modify: `platform/install.js`
- Test: `platform/test/run-task-chrome-bar-heal.js` (new file)

- [ ] **Step 1: Write the failing test file**

Create `platform/test/run-task-chrome-bar-heal.js`:

```javascript
#!/usr/bin/env node
'use strict';

// run-task-chrome-bar-heal.js — unit harness for task-entity's ChromeBar-heal
// wiring: _healNoteChromeBody / _healChromeBarMigration as PURE string
// transforms (no DOM, no fs) against synthetic `type: task` note bodies.
// Mirrors the assertion style of run-chrome-bar-cycle3-heal.js /
// run-meetings-hub-chrome-bar-heal.js. Prints "N passed, M failed"; exits 0
// iff M === 0.

const install = require('../install.js');
const _healNoteChromeBody = install._healNoteChromeBody;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---- top-level task note: bare SpaceNavButtons, no Breadcrumb block (the
// actual current shape TaskEntity._chromeBody() emits pre-fix) ----
{
  const before = `---
type: task
title: "Groceries"
status: open
due: ""
recurrence: ""
priority: ""
project: ""
project_slug: ""
source: ""
source_note: ""
parent_task: ""
links: []
created_at: "2026-07-11T09:00:00-06:00"
completed_at: ""
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });
\`\`\`

---

<!-- TASK_NOTES -->
`;
  const after = _healNoteChromeBody(before, 'task');
  ok('TASK-HEAL-1: task note heal inserts TaskChromeBar', after.includes('class: "TaskChromeBar"'));
  ok('TASK-HEAL-2: task note heal strips the legacy bare SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('TASK-HEAL-3: task note heal leaves TaskNoteView + the TASK_NOTES marker intact', after.includes('class: "TaskNoteView"') && after.includes('<!-- TASK_NOTES -->'));
  const again = _healNoteChromeBody(after, 'task');
  ok('TASK-HEAL-4: idempotent — a second heal pass is a no-op', again === after);
}

// ---- subtask note: same shape, parent_task set (heal doesn't care — it's
// keyed on type, not parent_task) ----
{
  const before = `---
type: task
title: "tmp-subtask"
status: open
due: ""
recurrence: ""
priority: ""
project: ""
project_slug: ""
source: ""
source_note: ""
parent_task: "[[Groceries]]"
links: []
created_at: "2026-07-11T10:00:00-06:00"
completed_at: ""
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });
\`\`\`

---

<!-- TASK_NOTES -->
`;
  const after = _healNoteChromeBody(before, 'task');
  ok('TASK-HEAL-5: subtask note heal also inserts TaskChromeBar', after.includes('class: "TaskChromeBar"'));
  ok('TASK-HEAL-6: subtask note heal also strips SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node platform/test/run-task-chrome-bar-heal.js`
Expected: FAIL — `_healNoteChromeBody(before, 'task')` currently returns the body unchanged (no `"task"` entry in `CHROME_BAR_MAP`), so `TASK-HEAL-1`/`TASK-HEAL-5` fail.

- [ ] **Step 3: Wire the three table additions in `platform/install.js`**

**3a.** Find the `CHROME_BAR_MAP` object (search for `const CHROME_BAR_MAP = {`). Add a `"task"` entry — anywhere in the object, e.g. right after the `"meeting": "MeetingChromeBar",` line:

```javascript
    "task": "TaskChromeBar",
```

**3b.** Find `applyNoteChromeHeal`'s `roots` array (search for `const roots = ["spice/meetings"`). Add `"spice/tasks"`:

```javascript
  const roots = ["spice/meetings", "spice/scratch", "spice/sticky-notes", "spice/to-do", "spice/people", "spice/wiki", "spice/projects", "spice/trips", "spice/reader", "spice/products", "spice/teams", "spice/journal", "spice/boards", "spice/finance", "spice/tasks"];
```

**3c.** In the same function, find the type-allowlist (search for `if (!["meeting", "scratch", "scratch-day"`). Add `"task"` to the list:

```javascript
        if (!["meeting", "scratch", "scratch-day", "scratch-hub", "sticky-note", "sticky-day", "sticky-hub", "to-do", "to-do-hub", "project-todo", "to-do-recurring", "person", "task", ...WIKI_TYPES, ...CYCLE3_TYPES, ...CYCLE4_TYPES].includes(type)) continue;
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `node platform/test/run-task-chrome-bar-heal.js`
Expected: `6 passed, 0 failed`, exit 0.

- [ ] **Step 5: Wire the new test file into `npm run release:preflight`**

In `package.json`, find the `release:preflight` script string and add `&& node platform/test/run-task-chrome-bar-heal.js` at the end (after the last `&& node platform/test/run-<name>.js` entry), following the exact same `&&`-chained pattern every other harness uses.

- [ ] **Step 6: Run the full task-entity suite + customjs-loadable gate once more**

Run: `node platform/test/run-task-entity.js`
Expected: PASS (unaffected by this task's changes — install.js is a separate file).

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add platform/install.js platform/test/run-task-chrome-bar-heal.js package.json
git commit -m "fix(task-entity): heal existing task notes onto TaskChromeBar via the shared chrome-heal tables"
```

---

### Task 6: Full preflight + PR

**Files:** none (verification + git/gh only)

- [ ] **Step 1: Run the full preflight suite**

Run: `npm run release:preflight`
Expected: PASS — whole-suite green bar, including the new `run-task-chrome-bar-heal.js`.

- [ ] **Step 2: Self-install dogfood check**

Run: `node platform/install.js --vault . --auto-approve`
Expected: succeeds with no NEW errors. (A pre-existing, unrelated `section-explorer` dependency skip for `project`/`wiki` may still appear — that is expected and unrelated, per the prior cycle's finding. Discard any self-install-materialized file drift afterward — do not commit it; the PR diff must stay scoped to this task's 5 commits.)

- [ ] **Step 3: Confirm the branch is up to date with `origin/main`**

```bash
git fetch origin main
git log --oneline origin/main..HEAD   # this branch's new commits
git log --oneline HEAD..origin/main   # anything new on main since this branch started
```

If `origin/main` has moved, merge it in (`git merge origin/main --no-edit`) and re-run `npm run release:preflight` to confirm it's still green post-merge.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin worktree-task-note-chrome-and-history
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat(task-entity): completed-subtask history + task-note ChromeBar/breadcrumb chrome" --body "$(cat <<'EOF'
## Summary
- Adds a collapsible "Completed (N)" subtask-history list to the parent task note's SUBTASKS section, so completed subtasks are visible instead of just disappearing.
- Task notes (and subtasks) now render the shared breadcrumb + `Go ▾` ChromeBar chrome, matching every other adopted-blueprint note surface — via a new leaf-only `TaskChromeBar` adapter, a `breadcrumb.types.task` manifest declaration, and three additions to the already-shipped generic chrome-heal tables in `install.js` (no new heal function).

## Test plan
- [x] `npm run release:preflight` green
- [x] `node platform/install.js --vault . --auto-approve` (workshop self-install/dogfood)
- [ ] CI green on this PR (macos-latest + ubuntu-latest)

Design spec: docs/superpowers/specs/2026-07-11-task-note-chrome-and-history-design.md
Implementation plan: docs/superpowers/plans/2026-07-11-task-note-chrome-and-history.md
EOF
)"
```

---

## After this plan: review, release, deploy (not plan tasks — orchestration steps)

Same sequence as the prior subtask-progress-fix cycle (`Docs/agent-guides/build-test-verify.md`):

1. Dispatch a final holistic code-reviewer subagent over the whole diff (all 5 code commits) before merge.
2. Wait for CI (`ci.yml`) green on both `macos-latest` and `ubuntu-latest`, then merge the PR (squash).
3. The release pipeline auto-bumps the version from the commit types, opens and auto-merges the release PR — do not hand-edit versions/tags or merge the release PR yourself.
4. After the release PR merges, wait for `tag-and-ship` to tag `v<X.Y.Z>` and auto-merge the Homebrew tap PR.
5. `brew upgrade sauce`, then deploy to accuris, headspace, and ero via `sauce update --bump-pins` in each vault (task-entity is an EXISTING, already-subscribed mechanism — this is a version bump, not a new-component deploy).
6. Verify the deployed version and the actual fix live in at least one vault: `spice/tasks/Groceries` and `spice/tasks/tmp-subtask` both show breadcrumb + `Go ▾` chrome, and Groceries' SUBTASKS section shows a "Completed" history list once a subtask has been marked done.
