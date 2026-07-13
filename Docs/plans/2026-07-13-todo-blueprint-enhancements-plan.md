# To-Do Blueprint Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 to-do blueprint issues: priority sorting, trip-task daily integration, inline wrench+trash icons, duplicate dividers, Done button on task notes, and chrome `---` removal.

**Architecture:** All rendering changes land in `task-today-list.js` (mechanism) and `task-note-view.js` (mechanism). One new helper `todo-daily-trip-groups.js` (blueprint). Two install heals in `install.js`. Tests extend `run-task-entity.js`.

**Tech Stack:** CustomJS (bare class pattern), Dataview live queries, Node test harness (`ok`/`assert`/`loadClass` pattern).

**Spec:** `Docs/plans/2026-07-13-todo-blueprint-enhancements-design.md`

---

### Task 1: Fix A — Priority sort + undated task inclusion in buildBands

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:76-119`
- Modify: `platform/test/run-task-entity.js` (append new test cases)

- [ ] **Step 1: Write failing tests for priority sorting and undated tasks**

Append to `platform/test/run-task-entity.js`:

```javascript
// ---------- buildBands: priority ordering + undated tasks ----------

ok('BB-PRIO-1 undated open tasks enter Today band', () => {
  const TTLClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
  const TTL = new TTLClass();
  const tasks = [
    { status: 'open', due: '', title: 'No date task', priority: 'medium' },
    { status: 'open', due: '2026-07-13', title: 'Today task', priority: 'low' },
  ];
  const bands = TTL.buildBands(tasks, '2026-07-13');
  assert(bands.today.length === 2, 'both tasks in today: ' + bands.today.length);
  assert(bands.overdue.length === 0, 'no overdue');
});

ok('BB-PRIO-2 today band sorted by priority descending then due then title', () => {
  const TTLClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
  const TTL = new TTLClass();
  const tasks = [
    { status: 'open', due: '2026-07-13', title: 'Low A', priority: 'low' },
    { status: 'open', due: '2026-07-13', title: 'Highest B', priority: 'highest' },
    { status: 'open', due: '2026-07-13', title: 'High C', priority: 'high' },
    { status: 'open', due: '', title: 'Medium no-date', priority: 'medium' },
    { status: 'open', due: '2026-07-13', title: 'No prio', priority: '' },
  ];
  const bands = TTL.buildBands(tasks, '2026-07-13');
  const titles = bands.today.map(t => t.title);
  assert(titles[0] === 'Highest B', 'highest first: ' + JSON.stringify(titles));
  assert(titles[1] === 'High C', 'high second: ' + JSON.stringify(titles));
  assert(titles[2] === 'Medium no-date', 'medium third (undated): ' + JSON.stringify(titles));
  assert(titles[3] === 'Low A', 'low fourth: ' + JSON.stringify(titles));
  assert(titles[4] === 'No prio', 'unset last: ' + JSON.stringify(titles));
});

ok('BB-PRIO-3 overdue band sorted by priority descending then due ascending', () => {
  const TTLClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
  const TTL = new TTLClass();
  const tasks = [
    { status: 'open', due: '2026-07-11', title: 'Old low', priority: 'low' },
    { status: 'open', due: '2026-07-12', title: 'Recent high', priority: 'high' },
    { status: 'open', due: '2026-07-10', title: 'Oldest high', priority: 'high' },
  ];
  const bands = TTL.buildBands(tasks, '2026-07-13');
  const titles = bands.overdue.map(t => t.title);
  assert(titles[0] === 'Oldest high', 'high+oldest first: ' + JSON.stringify(titles));
  assert(titles[1] === 'Recent high', 'high+recent second: ' + JSON.stringify(titles));
  assert(titles[2] === 'Old low', 'low last: ' + JSON.stringify(titles));
});

ok('BB-PRIO-4 trip_slug tasks excluded from buildBands', () => {
  const TTLClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
  const TTL = new TTLClass();
  const tasks = [
    { status: 'open', due: '2026-07-13', title: 'Personal', priority: 'medium' },
    { status: 'open', due: '2026-07-13', title: 'Trip task', priority: 'high', trip_slug: 'destin-florida' },
    { status: 'open', due: '', title: 'Trip no date', priority: 'low', trip_slug: 'nyc' },
  ];
  const bands = TTL.buildBands(tasks, '2026-07-13');
  assert(bands.today.length === 1, 'only personal task: ' + bands.today.length);
  assert(bands.today[0].title === 'Personal', 'personal kept');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node platform/test/run-task-entity.js 2>&1 | tail -20`
Expected: `FAIL BB-PRIO-1`, `FAIL BB-PRIO-2`, `FAIL BB-PRIO-3`, `FAIL BB-PRIO-4`

- [ ] **Step 3: Implement priority sort + undated inclusion + trip_slug exclusion**

In `platform/mechanisms/task-entity/task-today-list.js`, replace lines 76-119 (`buildBands` method) with:

```javascript
    static buildBands(parsedTasks, todayStr) {
        const PRIO_RANK = { highest: 4, high: 3, medium: 2, low: 1 };
        const prioOf = (t) => PRIO_RANK[String(t.priority || '').toLowerCase()] || 0;

        const today = [];
        const overdue = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            if (t.project_slug && String(t.project_slug).trim() !== '') continue;
            if (t.source === 'meeting') continue;
            if (t.parent_task && String(t.parent_task).trim() !== '') continue;
            if (t.trip_slug && String(t.trip_slug).trim() !== '') continue;
            const due = t.due;
            if (!due) { today.push(t); continue; }
            if (due === todayStr) today.push(t);
            else if (due < todayStr) overdue.push(t);
        }
        const sortBand = (arr) => {
            arr.sort((a, b) => {
                const pa = prioOf(a), pb = prioOf(b);
                if (pa !== pb) return pb - pa;
                const ad = a.due || '', bd = b.due || '';
                if (ad !== bd) {
                    if (ad === '') return 1;
                    if (bd === '') return -1;
                    return ad < bd ? -1 : 1;
                }
                return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
            });
        };
        sortBand(overdue);
        sortBand(today);
        return { today: today, overdue: overdue };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-task-entity.js 2>&1 | tail -20`
Expected: `ok BB-PRIO-1`, `ok BB-PRIO-2`, `ok BB-PRIO-3`, `ok BB-PRIO-4` and all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): priority-based ordering + undated tasks in Today band + trip_slug exclusion"
```

---

### Task 2: Fix D — Replace dot-menu with wrench + trash inline icons

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:436-511`

- [ ] **Step 1: Replace the ICON.edit SVG with a wrench and remove the MenuPopover branch**

In `platform/mechanisms/task-entity/task-today-list.js`, replace the `ICON` block and the `hasPopover` branching (lines 436-511). Change the `edit` SVG to a wrench, remove `open` and `dots` (no longer needed), and replace the entire `if (hasPopover) { ... } else { ... }` with just the two-icon pattern:

Replace:
```javascript
        const svg = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
        const ICON = {
            edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
            trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
            open: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
            dots: svg('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
        };
```

With:
```javascript
        const svg = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
        const ICON = {
            wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
            trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
        };
```

Then replace the entire `if (hasPopover) { ... } else { ... }` block (lines 483-511) with just:
```javascript
        const editBtn = mkActionBtn('sauce-task-action-edit', 'Edit task', ICON.wrench, false);
        editBtn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} doEdit(); });
        const delBtn = mkActionBtn('sauce-task-action-delete', 'Delete task', ICON.trash, true);
        delBtn.addEventListener('click', async (ev) => { try { ev.stopPropagation(); } catch (_e) {} await doDelete(); });
```

- [ ] **Step 2: Run existing tests to confirm no regression**

Run: `node platform/test/run-task-entity.js 2>&1 | tail -5`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js
git commit -m "feat(task-entity): replace dot-menu with inline wrench + trash icons"
```

---

### Task 3: Fix E — Remove per-row border-bottom

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:284`

- [ ] **Step 1: Remove border-bottom from renderTaskRow row styling**

In `platform/mechanisms/task-entity/task-today-list.js` line 284, change:
```javascript
        row.style.cssText = 'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 4px 6px 8px; border-radius: 4px; border: 1px solid transparent; border-bottom: 1px solid var(--background-modifier-border-hover); width: 100%; box-sizing: border-box;';
```
To:
```javascript
        row.style.cssText = 'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 4px 6px 8px; border-radius: 4px; border: 1px solid transparent; width: 100%; box-sizing: border-box;';
```

- [ ] **Step 2: Run existing tests**

Run: `node platform/test/run-task-entity.js 2>&1 | tail -5`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js
git commit -m "fix(task-entity): remove per-row border-bottom to eliminate duplicate dividers"
```

---

### Task 4: Fix F.1 — Done button on TaskNoteView

**Files:**
- Modify: `platform/mechanisms/task-entity/task-note-view.js:727-753`

- [ ] **Step 1: Add "Mark done" button before the "Edit task" button**

In `platform/mechanisms/task-entity/task-note-view.js`, insert the following block BEFORE line 728 (`// ----- Full-width primary "Edit task" button -----`):

```javascript
            // ----- Full-width "Mark done" button (OPEN tasks only) -----
            if (status === 'open') {
                drawDivider();
                const doneBtn = card.createEl('button', { text: 'Mark done' });
                doneBtn.style.cssText = [
                    'width:100%', 'box-sizing:border-box', 'min-height:38px',
                    'padding:9px 14px', 'border-radius:var(--radius-s, 4px)',
                    'border:1px solid var(--color-green, #4c9a5a)',
                    'background:var(--color-green, #4c9a5a)',
                    'color:var(--text-on-accent, #fff)', 'cursor:pointer',
                    'font-size:0.95em', 'font-weight:600',
                ].join(';') + ';';
                doneBtn.addEventListener('mouseenter', () => {
                    try { doneBtn.style.opacity = '0.85'; } catch (_e) {}
                });
                doneBtn.addEventListener('mouseleave', () => {
                    try { doneBtn.style.opacity = '1'; } catch (_e) {}
                });
                doneBtn.addEventListener('click', async () => {
                    try {
                        const TD = window.customJS && window.customJS.TaskDialog;
                        if (TD && typeof TD.markDone === 'function' && filePath) {
                            doneBtn.disabled = true;
                            doneBtn.textContent = 'Marking done…';
                            await TD.markDone(filePath);
                            try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
                            try {
                                if (window.app && window.app.commands && typeof window.app.commands.executeCommandById === 'function') {
                                    window.app.commands.executeCommandById('dataview:dataview-force-refresh-views');
                                }
                            } catch (_e) {}
                        }
                    } catch (e) {
                        doneBtn.disabled = false;
                        doneBtn.textContent = 'Mark done';
                        try { new Notice('Could not complete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
                    }
                });
            }
```

- [ ] **Step 2: Run existing tests**

Run: `node platform/test/run-task-entity.js 2>&1 | tail -5`
Expected: All tests pass (TaskNoteView static tests are unaffected).

- [ ] **Step 3: Commit**

```bash
git add platform/mechanisms/task-entity/task-note-view.js
git commit -m "feat(task-entity): add Done button on TaskNoteView for open tasks"
```

---

### Task 5: Fix F.2 — Remove `---` from chrome body + migration heal

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js:272-287`
- Modify: `platform/mechanisms/task-entity/task-dialog.js:1599-1618`
- Modify: `platform/install.js` (append heal function + call it)
- Modify: `platform/test/run-task-entity.js` (append test cases)

- [ ] **Step 1: Write failing test for _chromeBody output**

Append to `platform/test/run-task-entity.js`:

```javascript
// ---------- _chromeBody: no --- separators ----------

ok('CB-1 TaskEntity._chromeBody has no --- separators', () => {
  const body = TaskEntity._chromeBody();
  const lines = body.split('\n');
  const hrLines = lines.filter(l => l.trim() === '---');
  assert(hrLines.length === 0, 'should have 0 --- lines, got ' + hrLines.length);
  assert(body.includes('TaskChromeBar'), 'has TaskChromeBar');
  assert(body.includes('TaskNoteView'), 'has TaskNoteView');
  assert(body.includes('<!-- TASK_NOTES -->'), 'has TASK_NOTES marker');
});

ok('CB-2 TaskDialog._chromeBody has no --- separators', () => {
  const body = TaskDialog._chromeBody();
  const lines = body.split('\n');
  const hrLines = lines.filter(l => l.trim() === '---');
  assert(hrLines.length === 0, 'should have 0 --- lines, got ' + hrLines.length);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node platform/test/run-task-entity.js 2>&1 | grep -E 'CB-[12]'`
Expected: `FAIL CB-1`, `FAIL CB-2`

- [ ] **Step 3: Update _chromeBody in TaskEntity**

In `platform/mechanisms/task-entity/task-entity.js`, replace lines 272-287:

```javascript
    static _chromeBody() {
        return '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });\n' +
            '```\n' +
            '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
            '```\n' +
            '\n' +
            '<!-- TASK_NOTES -->\n';
    }
```

- [ ] **Step 4: Update _chromeBody in TaskDialog**

In `platform/mechanisms/task-entity/task-dialog.js`, find the `_chromeBody()` method (around line 1599) and replace its return statement with the same body (no `---` lines):

```javascript
        return '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });\n' +
            '```\n' +
            '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
            '```\n' +
            '\n' +
            '<!-- TASK_NOTES -->\n';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node platform/test/run-task-entity.js 2>&1 | grep -E 'CB-[12]'`
Expected: `ok CB-1`, `ok CB-2`

- [ ] **Step 6: Add applyTaskNoteChromeHrHeal to install.js**

Find the last heal call in `platform/install.js` (search for `applyTaskNote` or `applyReaderScaffoldHeal`). Add a new call after the existing task-note heal:

```javascript
await applyTaskNoteChromeHrHeal(tp, installedNow.history, git);
```

Then add the heal function itself (append near the other heal functions):

```javascript
async function applyTaskNoteChromeHrHeal(tp, history, git) {
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const ROOT = 'spice/tasks';
    if (!(await adapter.exists(ROOT))) return;

    const listing = await adapter.list(ROOT);
    const files = (listing.files || []).filter(f =>
      f.endsWith('.md') && !f.includes('/_trash/') && !f.includes('/_done/'));
    if (!files.length) return;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let healed = 0;

    for (const fp of files) {
      try {
        const before = await adapter.read(fp);
        // Pattern 1: ---\n\n```dataviewjs (between chrome blocks)
        // Pattern 2: ```\n\n---\n\n<!-- TASK_NOTES --> (after TaskNoteView)
        let after = before;
        after = after.replace(/\n---\n\n```dataviewjs/g, '\n\n```dataviewjs');
        after = after.replace(/```\n\n---\n\n<!-- TASK_NOTES -->/g, '```\n\n<!-- TASK_NOTES -->');
        if (after === before) continue;

        const backupDir = '.sauce-backup/tasks-chrome-hr/' + ts;
        try { await adapter.mkdir(backupDir); } catch (_e) {}
        const basename = fp.substring(fp.lastIndexOf('/') + 1);
        try { await adapter.write(backupDir + '/' + basename, before); } catch (_e) {}

        await adapter.write(fp, after);
        healed++;
        history?.push({
          event: 'info', step: 'task_note_chrome_hr_heal', name: 'task-entity',
          action: 'stripped_hr', target: fp,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString()
        });
      } catch (_e) { /* per-file, never throw */ }
    }
  } catch (_e) { /* top-level, never throw */ }
}
```

- [ ] **Step 7: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/mechanisms/task-entity/task-dialog.js platform/install.js platform/test/run-task-entity.js
git commit -m "fix(task-entity): remove --- separators from task note chrome + install heal"
```

---

### Task 6: Fix B — New ToDoDailyTripGroups helper + template + manifest

**Files:**
- Create: `platform/blueprints/to-do/helpers/todo-daily-trip-groups.js`
- Modify: `platform/blueprints/to-do/manifest.json`
- Modify: `platform/blueprints/to-do/templates/Today To-Do.md`
- Modify: `platform/install.js` (append heal for existing dailies)
- Modify: `platform/test/run-task-entity.js` (append test cases)

- [ ] **Step 1: Create the ToDoDailyTripGroups helper**

Create `platform/blueprints/to-do/helpers/todo-daily-trip-groups.js`:

```javascript
/**
 * ToDoDailyTripGroups (CustomJS) — live-render aggregator for the
 * trip-linked tasks section in today's daily note. Surfaces open task-notes
 * that carry a trip_slug (source: trip), grouped by trip name.
 *
 * Empty section → renders nothing.
 *
 * BARE CLASS ONLY — no trailing statements.
 */
class ToDoDailyTripGroups {

    async render(dv) {
        if (dv && dv.container && dv.container.closest && dv.container.closest('.markdown-embed')) return;
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || cur.type !== 'to-do') return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function' || !TTL || typeof TTL.renderTaskRow !== 'function') return;

        let parsed;
        try {
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/'));
            parsed = raw.map(p => TE.parseNote(p)).array
                ? raw.map(p => TE.parseNote(p)).array()
                : Array.from(raw).map(p => TE.parseNote(p));
        } catch (_e) { return; }

        const tasks = parsed.filter(t =>
            t && String(t.trip_slug == null ? '' : t.trip_slug).trim() !== ''
            && String(t.project_slug == null ? '' : t.project_slug).trim() === '');
        if (!tasks.length) return;

        const byTrip = new Map();
        for (const t of tasks) {
            const slug = String(t.trip_slug).trim();
            if (!byTrip.has(slug)) byTrip.set(slug, []);
            byTrip.get(slug).push(t);
        }

        const TD = window.customJS && window.customJS.TaskDialog;
        const SL = window.customJS && window.customJS.SectionLabel;

        for (const [slug, tripTasks] of byTrip) {
            const label = tripTasks[0] && tripTasks[0].trip
                ? String(tripTasks[0].trip).replace(/^\[\[/, '').replace(/\]\]$/, '').split('/').pop()
                : slug;

            if (SL) {
                SL.render(dv, { text: label + ' Tasks' });
            } else {
                const h = dv.container.createEl('div');
                h.textContent = String(label + ' TASKS').toUpperCase();
                h.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:10px 0 6px; font-weight:600;';
            }

            for (const t of tripTasks) {
                try { TTL.renderTaskRow(dv.container, t, TD); } catch (_e) {}
            }
        }
    }
}
```

- [ ] **Step 2: Register in the to-do blueprint manifest**

In `platform/blueprints/to-do/manifest.json`:

1. Add `"ToDoDailyTripGroups"` to the `customjs_classes` array (after `"ToDoDailyUnassignedMeetings"`).
2. Add a files entry:
```json
{
  "source": "helpers/todo-daily-trip-groups.js",
  "dest": "{{scripts_path}}/to-do/todo-daily-trip-groups.js"
}
```

- [ ] **Step 3: Update the daily template**

In `platform/blueprints/to-do/templates/Today To-Do.md`, insert a new dataviewjs block AFTER `ToDoDailyProjectGroups` and BEFORE `ToDoDailyUnassignedMeetings`:

```markdown
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoDailyTripGroups" });
``​`
```

- [ ] **Step 4: Add applyTodoDailyTripGroupsHeal to install.js**

Find the heal call site in `platform/install.js` and add after the chrome-hr heal:

```javascript
await applyTodoDailyTripGroupsHeal(tp, installedNow.history, git);
```

Then add the heal function:

```javascript
async function applyTodoDailyTripGroupsHeal(tp, history, git) {
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;

    const SENTINEL = 'ToDoDailyTripGroups';
    const ANCHOR = 'ToDoDailyProjectGroups';
    const BLOCK = '\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ToDoDailyTripGroups" });\n```\n';

    const TODO_ROOT = 'spice/to-do';
    if (!(await adapter.exists(TODO_ROOT))) return;

    const walk = async (dir) => {
      const listing = await adapter.list(dir);
      let mds = (listing.files || []).filter(f => f.endsWith('.md'));
      for (const sub of (listing.folders || [])) {
        mds = mds.concat(await walk(sub));
      }
      return mds;
    };
    const allMds = await walk(TODO_ROOT);
    const dailies = allMds.filter(f => /ToDo-\d{4}-\d{2}-\d{2}\.md$/.test(f));
    if (!dailies.length) return;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let healed = 0;

    for (const fp of dailies) {
      try {
        const before = await adapter.read(fp);
        if (before.includes(SENTINEL)) continue;
        if (!before.includes(ANCHOR)) continue;

        const anchorBlock = '{ class: "ToDoDailyProjectGroups" });\n```';
        const idx = before.indexOf(anchorBlock);
        if (idx < 0) continue;

        const insertAt = idx + anchorBlock.length;
        const after = before.slice(0, insertAt) + '\n' + BLOCK + before.slice(insertAt);

        const backupDir = '.sauce-backup/daily-trip-groups/' + ts;
        try { await adapter.mkdir(backupDir); } catch (_e) {}
        const basename = fp.substring(fp.lastIndexOf('/') + 1);
        try { await adapter.write(backupDir + '/' + basename, before); } catch (_e) {}

        await adapter.write(fp, after);
        healed++;
        history?.push({
          event: 'info', step: 'daily_trip_groups_heal', name: 'to-do',
          action: 'injected_trip_groups', target: fp,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString()
        });
      } catch (_e) { /* per-file, never throw */ }
    }
  } catch (_e) { /* top-level, never throw */ }
}
```

- [ ] **Step 5: Run all tests**

Run: `node platform/test/run-task-entity.js 2>&1 | tail -5`
Expected: All tests pass.

Run: `npm run preflight 2>&1 | tail -30` (if available)
Expected: Preflight green.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-daily-trip-groups.js platform/blueprints/to-do/manifest.json "platform/blueprints/to-do/templates/Today To-Do.md" platform/install.js
git commit -m "feat(to-do): add ToDoDailyTripGroups section for trip-linked tasks on daily note"
```

---

### Task 7: Bump version + final preflight + seed-vault sync

**Files:**
- Modify: `platform/blueprints/to-do/manifest.json` (version bump)
- Modify: `platform/mechanisms/task-entity/manifest.json` (version bump)
- Run: preflight + seed-vault harness

- [ ] **Step 1: Bump component versions**

In `platform/mechanisms/task-entity/manifest.json`, bump the `version` field (minor bump for new features).

In `platform/blueprints/to-do/manifest.json`, bump the `version` field (minor bump for new helper).

**NOTE:** Do NOT bump `workshop_version` in `package.json` or any consumer pins — the release pipeline handles this automatically.

- [ ] **Step 2: Run full preflight**

Run: `npm run preflight 2>&1 | tail -40`
Expected: All checks pass (customjs-loadable, test harnesses, seed-vault).

- [ ] **Step 3: Run seed-vault harness**

Run: `node platform/test/run-helper-cases.js 2>&1 | tail -20`
Expected: All helper cases pass.

- [ ] **Step 4: Run task-entity tests one final time**

Run: `node platform/test/run-task-entity.js`
Expected: 0 failures.

- [ ] **Step 5: Commit version bumps**

```bash
git add platform/mechanisms/task-entity/manifest.json platform/blueprints/to-do/manifest.json
git commit -m "chore(to-do): bump task-entity + to-do versions for enhancement cycle"
```

---

### Task 8: PR + merge + release + deploy

- [ ] **Step 1: Push branch and create PR**

```bash
git push -u origin worktree-bridge-cse_01RqKenFdH4ZnnDfQoc58xUR
gh pr create --title "feat(to-do): priority sort, trip tasks, inline icons, Done button, divider fixes" --body "$(cat <<'EOF'
## Summary
- Priority-based ordering in daily to-do (highest→lowest within Today + Overdue bands)
- Undated tasks now appear in Today band (were silently dropped)
- Trip-linked tasks get their own daily section (ToDoDailyTripGroups)
- Replaced dot-menu with inline wrench (edit) + trash (delete) icons
- Fixed duplicate dividers at section boundaries
- Added "Mark done" button on TaskNoteView
- Removed redundant --- separators from task note chrome
- Two install heals: strip chrome HR + inject trip-groups block into existing dailies

## Test plan
- [ ] `node platform/test/run-task-entity.js` — all pass
- [ ] `npm run preflight` — green
- [ ] Open a daily note in Obsidian → tasks ordered by priority
- [ ] Trip task ("Pack for Trip" in headspace) appears in its own section
- [ ] Wrench + trash icons visible on every task row
- [ ] No duplicate dividers between sections
- [ ] Task note shows "Mark done" button for open tasks
- [ ] Task note has no --- separators around the view block

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI to pass, then merge**

Monitor CI. Once green:
```bash
gh pr merge --squash --auto
```

- [ ] **Step 3: Wait for release PR + tap PR**

The release pipeline auto-opens a release PR. Once it auto-merges and tags, a tap PR opens on the brew-tap repo. Merge the tap PR:
```bash
gh pr list --repo willfell/homebrew-tap --state open
gh pr merge <tap-pr-number> --repo willfell/homebrew-tap --squash
```

- [ ] **Step 4: Update brew + deploy to all 3 consumer vaults**

```bash
brew update && brew upgrade sauce

cd /Users/willfellhoelter/notes/sauce/accuris-sauce && sauce update --bump-pins
cd /Users/willfellhoelter/notes/sauce/headspace-sauce && sauce update --bump-pins
cd /Users/willfellhoelter/notes/sauce/ero-sauce && sauce update --bump-pins
```

Verify each vault: `sauce status` should show `drift: none`.
