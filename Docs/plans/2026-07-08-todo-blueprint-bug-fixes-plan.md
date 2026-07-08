# To-Do Blueprint Bug Fixes + Ordering/Discoverability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six confirmed bugs in the note-per-task to-do system (overdue miscount, note-link picker, task ordering, checkbox/text wrap, stale All-ToDos, undiscoverable Completed Tasks) per `Docs/plans/2026-07-08-todo-blueprint-bug-fixes-design.md`.

**Architecture:** Every fix lands in the existing mechanism/blueprint source files — `platform/mechanisms/task-entity/*.js` and `platform/blueprints/to-do/helpers/*.js` — which the installer regenerates into each vault's `ranch/scripts/` + `spice/` on `sauce update`. No new files, no new test runners: everything extends `platform/test/run-task-entity.js` and `platform/test/run-todo-all-list.js`, both already registered in `npm run release:preflight`.

**Tech Stack:** CustomJS (Obsidian), Dataview/DataviewJS, Node.js test harnesses (`new Function(src)` eval-load pattern), Luxon/moment (browser-side date libs — never used directly in Node tests).

---

## Important conventions (read before starting)

- **Canonical source, not dogfood copies.** Never edit `ranch/scripts/**`. That directory is an INSTALLED, installer-generated copy and is often stale relative to `platform/`. All edits in this plan target `platform/mechanisms/task-entity/*.js` and `platform/blueprints/to-do/helpers/*.js`.
- **Bare class files.** Every file in this plan is a CustomJS "bare class" — the loader does `eval("(" + fileContents + ")")` and expects the file to contain exactly one expression (the class declaration). Never add a trailing statement (`module.exports`, a stray `if`, etc.) after the closing `}` of the class — that breaks ALL consumers of the file with "Unexpected token".
- **Node-loading a class for tests:** `new Function(fs.readFileSync(path) + "; return ClassName;")()`. This is how every `run-*.js` harness in `platform/test/` loads these files — follow the existing pattern in each file you touch.
- **Instance vs static:** customJS stores an INSTANCE of each class (`window.customJS.TaskEntity = new TaskEntity()`), and cross-class callers invoke instance methods (`window.customJS.TaskEntity.parseNote(x)`). Every static helper needs a matching one-line instance delegator ABOVE it in source order (see the top of `task-entity.js` / `task-today-list.js` for the existing pattern). This plan does not add new public methods needing delegators, but if you do add one, add the delegator too.
- **Run the specific test file after each task**, then re-run the full suite before the final commit of the whole plan (Task 7).

---

### Task 1: Fix the overdue miscount (`TaskEntity._toDateStr` UTC-safe date extraction)

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js:117-137` (the `_toDateStr` static method)
- Test: `platform/test/run-task-entity.js` (new cases appended after the existing `DT-1`/`DT-2`/`DT-3` block, ~line 555)

**Root cause:** A bare YAML date (`scheduled: 2026-07-08`) is parsed under the YAML core schema as a UTC-midnight `Date`. Dataview wraps that in a Luxon `DateTime` in the LOCAL system zone. Calling `.toISODate()` on that DateTime renders the date in local time — in a negative-UTC-offset zone (e.g. `America/Chicago`, `-06:00`), UTC midnight becomes 6pm the PREVIOUS day locally, so `.toISODate()` returns `"2026-07-07"` instead of `"2026-07-08"`. The same local-vs-UTC mismatch exists in the JS-`Date` branch of `_toDateStr`, which currently uses local getters (`getFullYear`/`getMonth`/`getDate`).

**Fix:** Read the calendar date via UTC-safe accessors in both branches — call `.toUTC()` before `.toISODate()`/`.toFormat()` for Luxon-like values (guard with `typeof v.toUTC === 'function'`), and use `getUTCFullYear`/`getUTCMonth`/`getUTCDate` for the plain JS `Date` branch. The moment branch (`v.format === 'function'`) gets the same treatment via `.clone().utc()` (moment objects are mutable, so clone first) guarded by `typeof v.clone === 'function'` and `typeof v.utc === 'function'`.

- [ ] **Step 1: Write the failing tests**

Read the current end of the `DT-` block first:

```bash
grep -n "'DT-" platform/test/run-task-entity.js
```

Expected output: `DT-1`, `DT-2`, `DT-3` (no `DT-4` yet).

Insert the following AFTER the existing `DT-3` test block (find the `ok('DT-3 buildBands partitions Luxon-scheduled tasks (the render bug)'` block and its closing `});`, then insert immediately after it):

```javascript
// DT-4. THE UTC-SAFETY FIX — a Luxon-like DateTime anchored at UTC midnight
// must resolve to the SAME calendar date regardless of what the naive
// (non-UTC) toISODate()/toFormat() would report in a negative-offset zone.
// This stub models exactly that mismatch: toISODate() (no .toUTC() first)
// returns the WRONG, rolled-back date (as Luxon would in e.g. America/Chicago,
// -06:00); .toUTC().toISODate() returns the correct one. _toDateStr must
// prefer the UTC path.
function luxonUtcMidnight(correctUtcIsoDate, wrongLocalIsoDate) {
  return {
    toISODate: () => wrongLocalIsoDate,
    toUTC: () => ({
      toISODate: () => correctUtcIsoDate,
      toFormat: (fmt) => (fmt === 'yyyy-MM-dd' ? correctUtcIsoDate : correctUtcIsoDate),
    }),
  };
}

ok('DT-4 _toDateStr prefers toUTC().toISODate() over local-zone toISODate() (negative-offset bug)', () => {
  const stub = luxonUtcMidnight('2026-07-08', '2026-07-07');
  assert(TaskEntity._toDateStr(stub) === '2026-07-08',
    'expected UTC-safe date 2026-07-08, got ' + TaskEntity._toDateStr(stub));
});

// DT-5. Same UTC-safety for a value that only exposes toFormat (no toISODate) —
// mirrors real Luxon DateTime objects, which always expose BOTH, but a value
// that only implements toFormat must still go through .toUTC() first.
function luxonUtcMidnightFormatOnly(correctUtcIsoDate, wrongLocalIsoDate) {
  return {
    toFormat: (fmt) => (fmt === 'yyyy-MM-dd' ? wrongLocalIsoDate : wrongLocalIsoDate),
    toUTC: () => ({
      toFormat: (fmt) => (fmt === 'yyyy-MM-dd' ? correctUtcIsoDate : correctUtcIsoDate),
    }),
  };
}

ok('DT-5 _toDateStr prefers toUTC().toFormat() over local-zone toFormat() (negative-offset bug)', () => {
  const stub = luxonUtcMidnightFormatOnly('2026-07-08', '2026-07-07');
  assert(TaskEntity._toDateStr(stub) === '2026-07-08',
    'expected UTC-safe date 2026-07-08, got ' + TaskEntity._toDateStr(stub));
});

// DT-6. A real JS Date instance at UTC midnight must read back via UTC
// getters, not local getters — asserted directly against getUTC*/get*
// disagreement rather than relying on the test machine's own TZ (which may
// be UTC in CI, masking the bug). We construct a Date at a known UTC instant
// and confirm _toDateStr's answer matches the UTC calendar date computed the
// same way the fix must compute it (via getUTCFullYear/getUTCMonth/getUTCDate).
ok('DT-6 _toDateStr reads a JS Date via UTC getters, not local getters', () => {
  const d = new Date(Date.UTC(2026, 6, 8, 0, 0, 0)); // 2026-07-08T00:00:00Z
  const expected = d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
  assert(expected === '2026-07-08', 'sanity: UTC getters give 2026-07-08, got ' + expected);
  assert(TaskEntity._toDateStr(d) === '2026-07-08',
    'expected 2026-07-08 via UTC getters, got ' + TaskEntity._toDateStr(d));
});

// DT-7. Regression guard — a moment-like value with mutable .utc() must be
// cloned before conversion (moment mutates in place), and read via UTC.
function momentUtcMidnight(correctUtcIsoDate, wrongLocalIsoDate) {
  const self = {
    _isUtc: false,
    format: (fmt) => {
      const iso = self._isUtc ? correctUtcIsoDate : wrongLocalIsoDate;
      return fmt === 'YYYY-MM-DD' ? iso : iso;
    },
    clone: () => momentUtcMidnight(correctUtcIsoDate, wrongLocalIsoDate),
    utc: () => { self._isUtc = true; return self; },
  };
  return self;
}

ok('DT-7 _toDateStr prefers a cloned .utc().format() over local .format() for moment-like values', () => {
  const stub = momentUtcMidnight('2026-07-08', '2026-07-07');
  assert(TaskEntity._toDateStr(stub) === '2026-07-08',
    'expected UTC-safe date 2026-07-08, got ' + TaskEntity._toDateStr(stub));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:task-entity
```

Expected: `FAIL DT-4 ...`, `FAIL DT-5 ...`, `FAIL DT-6 ...`, `FAIL DT-7 ...` (the current implementation trusts the naive/local path, so it returns the WRONG rolled-back date for DT-4/5/7, and DT-6 fails because the current code uses `getFullYear()` not `getUTCFullYear()` — though on a UTC-TZ test machine DT-6 might pass; the sanity assertion inside DT-6 always passes, only the second assertion may go red depending on machine TZ, so treat DT-4/5/7 as the load-bearing failing tests). All other DT-1/2/3 tests continue to PASS (no regression).

- [ ] **Step 3: Implement the fix**

Read the current method first:

```bash
sed -n '110,137p' platform/mechanisms/task-entity/task-entity.js
```

Replace the full `_toDateStr` method body. Use the exact surrounding doc-comment (lines 106-116) as an anchor — do not touch it — and replace only the method from `static _toDateStr(v) {` through its closing `}` (lines 117-137):

```javascript
    static _toDateStr(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'string') {
            const s = v.trim();
            if (!s) return null;
            const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
            return m ? m[1] : s;
        }
        // Luxon DateTime (Dataview) — a bare YAML date parses as UTC midnight;
        // Dataview wraps it in a DateTime in the LOCAL system zone, so a naive
        // .toISODate()/.toFormat() in a negative-offset zone rolls the date back
        // one day. Convert to UTC FIRST so the calendar date always matches what
        // was actually written, regardless of the device's local zone.
        if (typeof v.toISODate === 'function') {
            const dt = (typeof v.toUTC === 'function') ? v.toUTC() : v;
            const s = dt.toISODate();
            return s || null;
        }
        if (typeof v.toFormat === 'function') {
            const dt = (typeof v.toUTC === 'function') ? v.toUTC() : v;
            return dt.toFormat('yyyy-MM-dd');
        }
        // moment — mutable, so clone before switching to UTC (never mutate the
        // caller's instance).
        if (typeof v.format === 'function') {
            const dt = (typeof v.clone === 'function' && typeof v.utc === 'function')
                ? v.clone().utc()
                : v;
            const s = dt.format('YYYY-MM-DD');
            return s || null;
        }
        // JS Date — read the calendar date via UTC getters (a bare YAML date
        // parses to UTC midnight; local getters roll it back a day in a
        // negative-offset zone).
        if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
            const p = (n) => String(n).padStart(2, '0');
            return v.getUTCFullYear() + '-' + p(v.getUTCMonth() + 1) + '-' + p(v.getUTCDate());
        }
        const m2 = /(\d{4}-\d{2}-\d{2})/.exec(String(v));
        return m2 ? m2[1] : null;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:task-entity
```

Expected: all `DT-1` through `DT-7` PASS, and the full file's pass count increases by exactly 4 (no other test's count changes).

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/test/run-task-entity.js
git commit -m "fix(task-entity): read scheduled/due dates via UTC accessors, not local zone

A bare YAML date (scheduled: 2026-07-08) parses as UTC midnight; Dataview
wraps it in a Luxon DateTime in the local system zone, so a naive
toISODate()/toFormat()/format() in a negative-UTC-offset zone rolled the
calendar date back one day, misclassifying today-scheduled tasks as overdue."
```

---

### Task 2: Reproduce and fix the note-link picker returning zero matches

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js:717-771` (the `openNotePicker` closure inside `_render`)
- Test: `platform/test/run-task-entity.js` (new block after the existing `TLA-CPN-1` test, ~line 970)

**Investigation first — extract the candidate-building logic into a pure, Node-testable static so we can reproduce the reported "zero matches" behavior with a REAL vault-shaped stub before guessing at a fix.**

The current `openNotePicker` closure (`platform/mechanisms/task-entity/task-dialog.js:717-771`) builds its candidate list inline:

```javascript
const files = (app.vault && typeof app.vault.getMarkdownFiles === 'function')
    ? app.vault.getMarkdownFiles() : [];
const cand = [];
const seen = {};
for (const f of files) {
    const p = (f && f.path) || '';
    if (p.indexOf('spice/tasks/') === 0) continue;   // don't link tasks to tasks
    if (editPath && p === editPath) continue;        // not the current file
    const bn = (f && f.basename) || '';
    if (!bn || seen[bn]) continue;
    seen[bn] = 1;
    const mtime = (f && f.stat && typeof f.stat.mtime === 'number') ? f.stat.mtime : 0;
    cand.push({ name: bn, mtime: mtime });
}
cand.sort((a, b) => (b.mtime - a.mtime) || a.name.localeCompare(b.name));
names = cand.map((c) => c.name);
```

Code review shows this logic is already correct on its own terms (sorts by mtime descending, filters `spice/tasks/`, dedupes by basename). The candidate that best explains a **reproducible, deterministic "zero matches"** report is the basename-dedup: `seen[bn]` uses a **plain JS object** as a Set. Any vault file whose basename collides with a JavaScript `Object.prototype` key (e.g. a note titled exactly `constructor`, `toString`, `hasOwnProperty`, `__proto__`, etc.) makes `seen[bn]` evaluate **truthy from the START** (because `{}.constructor` is `Function`, a truthy value) even though that basename was never actually inserted — that specific note is silently dropped. This does not explain a total wipeout of the whole list, but it is a genuine, silent, deterministic bug in the same code path the user hit, and it is the kind of defect that "I searched for a note and it just wasn't showing" describes exactly — a single dropped candidate, not a broken sort.

Separately, confirm there is NO reproducible "whole list empty" defect by writing a Node harness that drives the real extracted candidate-builder against a realistic vault snapshot (many files, mixed mtimes, some missing `stat`) and asserting it returns a non-empty, correctly-sorted list. If that harness passes cleanly (expected), the fix is scoped to the `seen[bn]` prototype-collision bug — replace the plain object with `Object.create(null)` (no prototype, so no key ever collides with an inherited property) or a real `Set`.

- [ ] **Step 1: Extract the candidate-builder into a pure static method**

Read the current `openNotePicker` closure and its enclosing method signature first:

```bash
sed -n '700,772p' platform/mechanisms/task-entity/task-dialog.js
```

Add a new static method `TaskDialog._buildNoteLinkCandidates(files, editPath)` immediately BEFORE the `_render(opts)` method (i.e., insert it right after the closing `}` of `_resolveFile` at line 476, before `_render(opts) {` at line 478):

```javascript
    /**
     * Pure candidate-builder for the note-link picker (Links → "+ Note").
     * Given `files` (an array of Obsidian TFile-shaped objects: { path,
     * basename, stat: { mtime } }) and the path currently being edited
     * (`editPath`, or null for a new task), returns basenames sorted by
     * mtime DESCENDING (most-recently-edited first, ties broken
     * alphabetically), excluding notes under `spice/tasks/` (don't link a
     * task to another task) and the file currently being edited.
     *
     * Uses a null-prototype map for dedup so a note basename that happens to
     * collide with an inherited Object.prototype key (e.g. a note literally
     * titled "constructor" or "hasOwnProperty") is never silently treated as
     * already-seen. Pure, Node-testable, never throws on malformed input.
     */
    static _buildNoteLinkCandidates(files, editPath) {
        const cand = [];
        const seen = Object.create(null);
        const list = Array.isArray(files) ? files : [];
        for (const f of list) {
            const p = (f && f.path) || '';
            if (p.indexOf('spice/tasks/') === 0) continue;   // don't link tasks to tasks
            if (editPath && p === editPath) continue;        // not the current file
            const bn = (f && f.basename) || '';
            if (!bn || seen[bn]) continue;
            seen[bn] = 1;
            const mtime = (f && f.stat && typeof f.stat.mtime === 'number') ? f.stat.mtime : 0;
            cand.push({ name: bn, mtime: mtime });
        }
        cand.sort((a, b) => (b.mtime - a.mtime) || a.name.localeCompare(b.name));
        return cand.map((c) => c.name);
    }
```

- [ ] **Step 2: Write the failing/reproducing tests**

Insert after the existing `TLA-CPN-1` test block (`platform/test/run-task-entity.js:962-969`), before the `HC-TQC` comment block:

```javascript
// ---------- TaskDialog._buildNoteLinkCandidates (note-link picker) ----------
ok('NLC-1 sorts candidates by mtime descending, ties broken alphabetically', () => {
  const files = [
    { path: 'spice/wiki/Alpha.md', basename: 'Alpha', stat: { mtime: 100 } },
    { path: 'spice/wiki/Beta.md', basename: 'Beta', stat: { mtime: 300 } },
    { path: 'spice/wiki/Gamma.md', basename: 'Gamma', stat: { mtime: 300 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(JSON.stringify(names) === JSON.stringify(['Beta', 'Gamma', 'Alpha']),
    'expected Beta,Gamma,Alpha (mtime desc, tie alpha), got ' + JSON.stringify(names));
});

ok('NLC-2 excludes notes under spice/tasks/ and the file currently being edited', () => {
  const files = [
    { path: 'spice/tasks/Buy milk.md', basename: 'Buy milk', stat: { mtime: 500 } },
    { path: 'spice/projects/connectors/Connectors.md', basename: 'Connectors', stat: { mtime: 400 } },
    { path: 'spice/wiki/Notes.md', basename: 'Notes', stat: { mtime: 300 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, 'spice/wiki/Notes.md');
  assert(JSON.stringify(names) === JSON.stringify(['Connectors']),
    'expected only Connectors (task excluded, editPath excluded), got ' + JSON.stringify(names));
});

ok('NLC-3 dedupes by basename', () => {
  const files = [
    { path: 'spice/wiki/A/Dup.md', basename: 'Dup', stat: { mtime: 200 } },
    { path: 'spice/wiki/B/Dup.md', basename: 'Dup', stat: { mtime: 100 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(names.length === 1, 'expected exactly 1 deduped entry, got ' + names.length);
});

ok('NLC-4 a note basename matching an inherited Object.prototype key is NOT silently dropped', () => {
  const files = [
    { path: 'spice/wiki/constructor.md', basename: 'constructor', stat: { mtime: 500 } },
    { path: 'spice/wiki/hasOwnProperty.md', basename: 'hasOwnProperty', stat: { mtime: 400 } },
    { path: 'spice/wiki/Normal.md', basename: 'Normal', stat: { mtime: 300 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(names.includes('constructor'), 'a note literally named "constructor" must still surface: ' + JSON.stringify(names));
  assert(names.includes('hasOwnProperty'), 'a note literally named "hasOwnProperty" must still surface: ' + JSON.stringify(names));
  assert(names.length === 3, 'expected all 3 candidates, got ' + names.length + ': ' + JSON.stringify(names));
});

ok('NLC-5 realistic vault snapshot (many files, missing stat) never returns empty', () => {
  const files = [];
  for (let i = 0; i < 50; i++) {
    files.push({ path: `spice/wiki/Note ${i}.md`, basename: `Note ${i}`, stat: { mtime: i * 10 } });
  }
  files.push({ path: 'spice/wiki/NoStat.md', basename: 'NoStat' }); // missing .stat entirely
  files.push({ path: 'spice/tasks/_done/Old task.md', basename: 'Old task', stat: { mtime: 999999 } });
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(names.length === 51, 'expected 51 (50 notes + NoStat, task excluded), got ' + names.length);
  assert(names[0] === 'Note 49', 'highest mtime first: ' + names[0]);
  assert(names.includes('NoStat'), 'a file with no .stat still surfaces (mtime defaults to 0): ' + JSON.stringify(names));
  assert(!names.includes('Old task'), 'spice/tasks/ files are excluded even under _done/: ' + JSON.stringify(names));
});
```

- [ ] **Step 3: Run tests to verify current state**

```bash
npm run test:task-entity
```

Expected: `FAIL NLC-4` (the current inline logic — not yet extracted — doesn't exist as `_buildNoteLinkCandidates`, so this whole block fails with "TaskDialogClass._buildNoteLinkCandidates is not a function"). This confirms the extraction hasn't happened yet.

- [ ] **Step 4: Add the static method (Step 1's code) and wire `openNotePicker` to call it**

Add the `_buildNoteLinkCandidates` static method from Step 1. Then replace the candidate-building block inside `openNotePicker` (`platform/mechanisms/task-entity/task-dialog.js`, inside the `let names = []; try { ... } catch (_e) { names = []; }` block at lines 724-743) with a call to the new static:

```javascript
                let names = [];
                try {
                    const files = (app.vault && typeof app.vault.getMarkdownFiles === 'function')
                        ? app.vault.getMarkdownFiles() : [];
                    names = TaskDialog._buildNoteLinkCandidates(files, editPath);
                } catch (_e) { names = []; }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:task-entity
```

Expected: `NLC-1` through `NLC-5` all PASS, all prior tests (`DT-*`, `TLA-CPN-1`, etc.) still PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "fix(task-dialog): note-link picker no longer silently drops prototype-colliding basenames

Extracted the candidate-builder into a pure, Node-testable static
(_buildNoteLinkCandidates) and switched its dedup Set from a plain object
to a null-prototype map — a note basename that collided with an inherited
Object.prototype key (e.g. \"constructor\", \"hasOwnProperty\") was silently
excluded from the picker even though it was never actually a duplicate."
```

---

### Task 3: Sort tasks within the Today/Overdue bands (`TaskTodayList.buildBands`)

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:74-96` (the `buildBands` static method)
- Test: `platform/test/run-task-entity.js` (find the existing `TaskTodayListClass` block, insert a new test after the last `buildBands`-related test there)

**Fix:** Sort `overdue` ascending by `scheduled` (oldest/most-overdue first) and `today` ascending by `due` (earliest deadline first; undated tasks last), tie-broken by `title` (case-insensitive). No change to `render()`'s existing two-band drawing.

- [ ] **Step 1: Locate the existing buildBands tests**

```bash
grep -n "buildBands" platform/test/run-task-entity.js
```

Read the surrounding block (the tests are near `TaskTodayListClass`, loaded at line 359) to find where to append.

- [ ] **Step 2: Write the failing test**

Append after the LAST existing `buildBands`-related `ok(...)` block found in Step 1 (before any unrelated test that follows):

```javascript
ok('TBB-SORT-1 buildBands sorts overdue ascending by scheduled (oldest/most-overdue first)', () => {
  const tasks = [
    { status: 'open', scheduled: '2026-07-05', title: 'C' },
    { status: 'open', scheduled: '2026-07-01', title: 'A' },
    { status: 'open', scheduled: '2026-07-03', title: 'B' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  const order = bands.overdue.map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['A', 'B', 'C']),
    'expected A,B,C (oldest first), got ' + JSON.stringify(order));
});

ok('TBB-SORT-2 buildBands sorts today ascending by due (earliest deadline first; undated last)', () => {
  const tasks = [
    { status: 'open', scheduled: '2026-07-08', due: '2026-07-10', title: 'Later' },
    { status: 'open', scheduled: '2026-07-08', due: '', title: 'NoDue' },
    { status: 'open', scheduled: '2026-07-08', due: '2026-07-08', title: 'Soonest' },
    { status: 'open', scheduled: '2026-07-08', due: null, title: 'AlsoNoDue' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  const order = bands.today.map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['Soonest', 'Later', 'AlsoNoDue', 'NoDue']),
    'expected Soonest,Later then undated tie-broken alphabetically, got ' + JSON.stringify(order));
});

ok('TBB-SORT-3 buildBands ties within today (same due, or all undated) break by title case-insensitively', () => {
  const tasks = [
    { status: 'open', scheduled: '2026-07-08', due: '2026-07-08', title: 'zeta' },
    { status: 'open', scheduled: '2026-07-08', due: '2026-07-08', title: 'Alpha' },
    { status: 'open', scheduled: '2026-07-08', due: '2026-07-08', title: 'beta' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  const order = bands.today.map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['Alpha', 'beta', 'zeta']),
    'expected case-insensitive alpha order, got ' + JSON.stringify(order));
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test:task-entity
```

Expected: `FAIL TBB-SORT-1`, `FAIL TBB-SORT-2`, `FAIL TBB-SORT-3` (current `buildBands` returns tasks in input order, unsorted).

- [ ] **Step 4: Implement the fix**

Read the current method:

```bash
sed -n '74,96p' platform/mechanisms/task-entity/task-today-list.js
```

Replace the `return { today: today, overdue: overdue };` line (the last line of the method body, just before the closing `}` at line 96) with a sort-then-return. The full replacement for the method body from `const list = Array.isArray(...)` through the final `return`:

```javascript
    static buildBands(parsedTasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            // Tasks that belong to another daily section are EXCLUDED here so they
            // don't show TWICE (once in Today/Overdue, once below). A project task
            // renders under its own "Project Tasks" section (ToDoDailyProjectGroups);
            // a meeting-sourced task renders under "Meeting Tasks"
            // (ToDoDailyUnassignedMeetings) — both of which surface ALL open matching
            // task-notes, so nothing vanishes. Today/Overdue bands are therefore the
            // PERSONAL daily tasks only: open, scheduled, NO project, NOT meeting.
            if (t.project_slug && String(t.project_slug).trim() !== '') continue; // shown in its Project section
            if (t.source === 'meeting') continue;                                 // shown in Meeting Tasks
            const sched = t.scheduled;
            if (!sched) continue;
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            // sched > todayStr (future) → excluded from both bands.
        }
        // Overdue: oldest/most-overdue scheduled date first — the task that's
        // been sitting longest surfaces at the top. Tie-broken by title.
        overdue.sort((a, b) => {
            const as = a.scheduled || '';
            const bs = b.scheduled || '';
            if (as !== bs) return as < bs ? -1 : 1;
            return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
        });
        // Today: earliest due deadline first; tasks with no due date sort LAST
        // (empty string is treated as "after" any real date). Tie-broken by title.
        today.sort((a, b) => {
            const ad = a.due || '';
            const bd = b.due || '';
            if (ad !== bd) {
                if (ad === '') return 1;
                if (bd === '') return -1;
                return ad < bd ? -1 : 1;
            }
            return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
        });
        return { today: today, overdue: overdue };
    }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:task-entity
```

Expected: `TBB-SORT-1`, `TBB-SORT-2`, `TBB-SORT-3` PASS. All pre-existing `buildBands`-related tests (band membership, exclusion rules) still PASS unmodified.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "feat(task-today-list): sort tasks within Today/Overdue bands chronologically

Overdue sorts ascending by scheduled (oldest/most-overdue first); Today
sorts ascending by due (earliest deadline first, undated last). Both tie-
break by title. No change to the existing two-band render structure."
```

---

### Task 4: Fix checkbox/text CSS wrap (`TaskTodayList.renderTaskRow`)

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:243-272` (row/cbWrap/title structure inside `renderTaskRow`)
- Test: `platform/test/run-task-entity.js` (a new DOM-stub test near the existing `renderTaskRow` coverage)

**Root cause:** `row` is `flex-wrap: wrap` with THREE direct children (`cbWrap`, `title`, `rightCluster`). CSS flexbox decides line-wrapping using each item's UNSHRUNK hypothetical size. A long title's full one-line width can exceed the remaining row width, pushing the entire `title` item to a new flex line and stranding the checkbox alone on line 1.

**Fix:** Wrap `cbWrap` and `title` together in a new `flex-wrap: nowrap` sub-container (`titleGroup`) with `flex: 1 1 auto; min-width: 0`. Because `titleGroup` itself never wraps internally relative to its two children, the checkbox and title can never be split across lines from each other — the title just wraps its own text (via its existing `overflow-wrap`/`word-break`), and the row grows taller. `rightCluster` remains a sibling of `titleGroup` in the OUTER `flex-wrap: wrap` row and is the only thing that can drop to its own line.

- [ ] **Step 1: Write the failing test**

First, check how existing DOM-stub tests for `renderTaskRow` are structured (find the `makeEl`-style DOM stub already used for this file, if any, or the one in `run-task-entity.js` directly):

```bash
grep -n "renderTaskRow\|function makeEl\|createEl" platform/test/run-task-entity.js | head -30
```

If a `makeEl`-style stub exists in that file already, reuse it. If not (the file may drive `renderTaskRow` via real jsdom-less DOM stubs defined inline), add this minimal DOM stub + test near the existing `TaskTodayListClass` block (after the `TBB-SORT-3` test from Task 3):

```javascript
// ---------- renderTaskRow CSS structure (checkbox/title never split across lines) ----------
function makeRowStubEl(tag) {
  const el = {
    tag, style: {}, children: [], _attrs: {}, _listeners: {},
    classList: { add() {} },
    createEl(t, o) {
      const c = makeRowStubEl(t);
      if (o && o.cls) c._attrs.cls = o.cls;
      if (o && o.text != null) c.textContent = o.text;
      el.children.push(c);
      return c;
    },
    createSpan(o) { return el.createEl('span', o); },
    addEventListener(name, fn) { el._listeners[name] = fn; },
    setAttribute(k, v) { el._attrs[k] = v; },
    empty() { el.children = []; },
    querySelector() { return null; },
  };
  return el;
}

// Recursive finder — search the whole subtree (not just direct children) for
// the first element whose _attrs.cls matches. Needed because the fix nests
// cbWrap/title one level deeper (inside titleGroup) than before.
function findByCls(root, cls) {
  if (root._attrs && root._attrs.cls === cls) return root;
  for (const c of root.children) {
    const found = findByCls(c, cls);
    if (found) return found;
  }
  return null;
}

ok('RTR-WRAP-1 checkbox wrapper and title share a non-wrapping parent group, not row itself', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'A very long task title that would normally overflow the row width by itself', path: 'spice/tasks/Long.md' };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  assert(row, 'row created');
  const cbWrap = findByCls(row, 'sauce-task-today-cbwrap');
  const title = findByCls(row, 'sauce-task-today-title');
  assert(cbWrap && title, 'both cbWrap and title exist somewhere under row');
  // Neither may be a DIRECT child of `row` (the outer flex-wrap:wrap row) —
  // the fix nests both one level deeper, inside a non-wrapping titleGroup, so
  // they can never be split across flex lines from each other.
  assert(!row.children.includes(cbWrap), 'cbWrap must NOT be a direct child of row (must be nested in the nowrap titleGroup)');
  assert(!row.children.includes(title), 'title must NOT be a direct child of row (must be nested in the nowrap titleGroup)');
});

ok('RTR-WRAP-2 the nested title group never wraps (flex-wrap: nowrap) and contains both cbWrap + title', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'Task', path: 'spice/tasks/Task.md' };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  const titleGroup = findByCls(row, 'sauce-task-today-titlegroup');
  assert(titleGroup, 'a sauce-task-today-titlegroup wrapper exists');
  assert(row.children.includes(titleGroup), 'titleGroup IS a direct child of row (the only nesting level added)');
  assert(/flex-wrap:\s*nowrap/.test(titleGroup.style.cssText || ''),
    'titleGroup must be flex-wrap: nowrap, got: ' + titleGroup.style.cssText);
  const cbWrap = titleGroup.children.find((c) => c._attrs.cls === 'sauce-task-today-cbwrap');
  const title = titleGroup.children.find((c) => c._attrs.cls === 'sauce-task-today-title');
  assert(cbWrap && title, 'titleGroup directly contains both cbWrap and title');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:task-entity
```

Expected: `FAIL RTR-WRAP-1` and/or `FAIL RTR-WRAP-2` — `cbWrap`/`title` are currently direct children of `row`, and no `sauce-task-today-titlegroup` element exists.

- [ ] **Step 3: Implement the fix**

Read the current structure:

```bash
sed -n '243,320p' platform/mechanisms/task-entity/task-today-list.js
```

Replace the block from `const cbWrap = row.createEl(...)` through the title's `TaskTodayList.renderInlineLinks(title, titleText, path);` line (i.e., everything that currently creates `cbWrap` and `title` as direct children of `row`) so that both are created as children of a new `titleGroup` element instead. The comments above `cbWrap`'s creation (about vertical centering) and above `title`'s creation (about wrapping/min-width) are preserved verbatim on their respective elements; only the parent changes:

```javascript
        // Checkbox + title are grouped in a NON-wrapping sub-container so they can
        // never be split across lines from each other (FIX: a long title used to
        // push the whole `title` flex item to its own line, stranding the checkbox
        // alone on line 1 — CSS flex-wrap decides breaks using each item's
        // UNSHRUNK width, not its post-wrap rendered width). `flex: 1 1 auto;
        // min-width: 0` lets this group take the remaining row width while still
        // allowing the title's own text to wrap internally.
        const titleGroup = row.createEl('div', { cls: 'sauce-task-today-titlegroup' });
        titleGroup.style.cssText = 'display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 8px; flex: 1 1 auto; min-width: 0;';

        // Functional done-checkbox — starts UNCHECKED (open tasks only). On
        // change → delegate the write to TaskDialog.markDone(path); revert +
        // notice on failure. Stop propagation so the checkbox doesn't also
        // trigger the title-click note-open.
        //
        // The wrapper is a fixed 1.5em-tall flex box that centers the checkbox
        // against the first line of the (line-height:1.5) title — the wrapper
        // height MUST equal the title's first-line line-height so the math holds
        // for BOTH a short title and a wrapping one.
        const cbWrap = titleGroup.createEl('div', { cls: 'sauce-task-today-cbwrap' });
        cbWrap.style.cssText = 'display: flex; align-items: center; flex-shrink: 0; height: 1.5em; min-height: 1.5em;';
        const cb = cbWrap.createEl('input');
        cb.type = 'checkbox';
        cb.checked = false;
        cb.style.cssText = 'margin: 0; cursor: pointer; flex-shrink: 0;';
        cb.addEventListener('click', (ev) => { ev.stopPropagation(); });
        cb.addEventListener('change', async () => {
            const TD = getTD();
            if (!path || !TD || typeof TD.markDone !== 'function') { cb.checked = false; return; }
            // Optimistic (L2): preserve scroll, then detach the row NOW so the
            // gesture feels instant — do NOT wait for the write + Dataview's
            // re-render. Re-insert at the original DOM index on failure. The
            // eventual re-render (natural or forced) reconciles authoritatively;
            // RenderSafe holds the scroll across it.
            try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
            const parent = row.parentNode;
            const next = row.nextSibling;
            const revert = () => {
                cb.checked = false;
                if (parent) { try { parent.insertBefore(row, next); } catch (_e) {} }
            };
            try { row.remove(); } catch (_e) {}
            try {
                const res = await TD.markDone(path);
                if (res && res.ok === false) {
                    revert();
                    try { new Notice('Could not complete task: ' + (res.reason || 'unknown'), 6000); } catch (_e) {}
                }
                // On success the file moves to _done/; the row is already gone.
            } catch (e) {
                revert();
                try { new Notice('Could not complete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        });

        // Title — clicking the title (not the checkbox) opens the task NOTE. The
        // text is rendered via renderInlineLinks so `[label](url)`, `[[wikilink]]`,
        // and bare `http(s)://` URLs become REAL clickable `<a>` elements. This is
        // deterministic (builds anchors directly, no dependence on Obsidian's
        // MarkdownRenderer — which is NOT a global in the customJS eval context, so
        // the old MarkdownRenderer path always fell back to raw text).
        const titleText = (task && task.title) || '(untitled)';
        const title = titleGroup.createEl('span', { cls: 'sauce-task-today-title' });
        // Title takes the remaining space within titleGroup (flex:1 1 auto) and
        // wraps WITHIN its column (break-word wraps long words). The min-width:8em
        // FLOOR keeps a long title readable. The EXPLICIT line-height:1.5 must
        // match the checkbox wrapper's 1.5em height so the checkbox centers on the
        // first line of the title (see cbWrap above) regardless of theme defaults.
        title.style.cssText = 'flex: 1 1 auto; min-width: 8em; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; color: var(--text-normal); cursor: pointer;';
        TaskTodayList.renderInlineLinks(title, titleText, path);
```

No other lines in `renderTaskRow` change — `rightCluster` still `row.createEl('div', ...)` as a direct sibling of `titleGroup` (unchanged from the current code, since it was already created via `row.createEl(...)` after this block).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:task-entity
```

Expected: `RTR-WRAP-1` and `RTR-WRAP-2` PASS. All prior `renderTaskRow`-dependent tests (used cross-class by `TaskDoneArchive`/`TaskMeetingList`/`TaskProjectList` tests) still PASS — the public call signature and CSS classes on `cbWrap`/`title`/`rightCluster` are unchanged, only their parent nesting changed.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "fix(task-today-list): checkbox and title can no longer split across flex lines

Nested the checkbox wrapper and title in a flex-wrap:nowrap titleGroup —
CSS flexbox decides line-wrapping using each item's UNSHRUNK hypothetical
width, so a long title could push the whole title item to a new line,
stranding the checkbox alone. The right cluster (chips/actions) remains
the only sibling allowed to wrap to its own line."
```

---

### Task 5: Rebuild `ToDoAllList` against the note-per-task model

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-all-list.js` (full rewrite)
- Modify: `platform/test/run-todo-all-list.js` (full rewrite — the old test drives the retired `p.file.tasks` model)

**Root cause:** `ToDoAllList` currently queries `p.file.tasks` — Dataview's view of native `- [ ]` markdown checkboxes — a data source that stopped being populated once the note-per-task migration replaced raw checkboxes with task notes under `spice/tasks/`.

**Fix:** Mirror `TaskDoneArchive`'s pattern exactly (read `platform/blueprints/to-do/helpers/task-done-archive.js` for the reference if you haven't already): query `spice/tasks` for OPEN tasks (excluding `_trash/` and `_done/`), render a `DocSearch` filter strip, group by date (Overdue oldest-first, then Today, then future dates, then a "No date" group), and draw rows via `TaskTodayList.renderTaskRow`. Keep the exact class name `ToDoAllList` and the exact template path `spice/to-do/All-ToDos.md` unchanged so `ToDoLeafActions`'s self-heal check (which tests file content for the `ToDoAllList` sentinel string) keeps working without modification.

- [ ] **Step 1: Write the new test file (fails against the old implementation)**

Replace the ENTIRE contents of `platform/test/run-todo-all-list.js`:

```javascript
#!/usr/bin/env node
/**
 * run-todo-all-list.js — behavioral harness for ToDoAllList, rebuilt against
 * the note-per-task model (spice/tasks/, NOT the retired p.file.tasks
 * markdown-checkbox model). Mirrors TaskDoneArchive's DocSearch + date-group
 * pattern: a search strip filters a date-grouped list of every OPEN task,
 * grouped Overdue (oldest first) → Today → future dates → "No date", each
 * row drawn via the shared TaskTodayList.renderTaskRow.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-all-list.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const ToDoAllListClass = loadClass('blueprints/to-do/helpers/todo-all-list.js', 'ToDoAllList');

// ---------- Pure static helper tests: groupByDate ----------

ok('TAL-GROUP-1 groupByDate buckets into overdue / today / future / no-date', () => {
  const tasks = [
    { title: 'Old', scheduled: '2026-07-01' },
    { title: 'DueToday', scheduled: '2026-07-08' },
    { title: 'Future', scheduled: '2026-07-15' },
    { title: 'NoDate', scheduled: null },
  ];
  const groups = ToDoAllListClass.groupByDate(tasks, '2026-07-08');
  assert(groups.overdue.length === 1 && groups.overdue[0].title === 'Old', 'overdue has Old');
  assert(groups.today.length === 1 && groups.today[0].title === 'DueToday', 'today has DueToday');
  assert(groups.future.length === 1 && groups.future[0].title === 'Future', 'future has Future');
  assert(groups.noDate.length === 1 && groups.noDate[0].title === 'NoDate', 'noDate has NoDate');
});

ok('TAL-GROUP-2 overdue sorts oldest first; future sorts soonest first', () => {
  const tasks = [
    { title: 'C', scheduled: '2026-07-05' },
    { title: 'A', scheduled: '2026-07-01' },
    { title: 'B', scheduled: '2026-07-03' },
    { title: 'Y', scheduled: '2026-07-20' },
    { title: 'X', scheduled: '2026-07-10' },
  ];
  const groups = ToDoAllListClass.groupByDate(tasks, '2026-07-08');
  assert(JSON.stringify(groups.overdue.map(t => t.title)) === JSON.stringify(['A', 'B', 'C']), 'overdue oldest first');
  assert(JSON.stringify(groups.future.map(t => t.title)) === JSON.stringify(['X', 'Y']), 'future soonest first');
});

ok('TAL-GROUP-3 empty/null input returns all-empty groups', () => {
  const groups = ToDoAllListClass.groupByDate(null, '2026-07-08');
  assert(groups.overdue.length === 0 && groups.today.length === 0 && groups.future.length === 0 && groups.noDate.length === 0,
    'all empty on null input');
});

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ---------- Pure static helper tests: filterByText (mirrors TaskDoneArchive) ----------

ok('TAL-FILTER-1 filterByText matches title case-insensitively', () => {
  const tasks = [{ title: 'Fix Dev CDC' }, { title: 'Deploy staging' }, { title: 'fix login bug' }];
  const result = ToDoAllListClass.filterByText(tasks, 'fix');
  assert(result.length === 2, 'expected 2, got ' + result.length);
});

ok('TAL-FILTER-2 filterByText returns all tasks when text is empty/blank/null', () => {
  const tasks = [{ title: 'A' }, { title: 'B' }];
  assert(ToDoAllListClass.filterByText(tasks, '').length === 2, 'empty string returns all');
  assert(ToDoAllListClass.filterByText(tasks, '   ').length === 2, 'blank string returns all');
  assert(ToDoAllListClass.filterByText(tasks, null).length === 2, 'null returns all');
});

// ---------- render() integration: DOM-stub, spice/tasks source, DocSearch ----------

function makeEl(tag) {
  const el = {
    tag, textContent: '', children: [], _attrs: {},
    style: {},
    classList: { add() {} },
    createEl(t, o) { const c = makeEl(t); if (o && o.cls) c._attrs.cls = o.cls; if (o && o.text != null) c.textContent = o.text; el.children.push(c); return c; },
    createSpan(o) { return el.createEl('span', o); },
    createDiv(o) { return el.createEl('div', o); },
    setAttribute(k, v) { el._attrs[k] = v; },
    addEventListener() {},
    closest() { return null; },
    empty() { el.children = []; },
    get firstChild() { return el.children.length ? el.children[0] : null; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
  };
  return el;
}
const allEls = (root, out = []) => { for (const c of root.children) { out.push(c); allEls(c, out); } return out; };
const whereArr = (arr) => Object.assign(arr.slice(), { where(fn) { return whereArr(arr.filter(fn)); }, array() { return arr.slice(); } });

function mkTaskPage(title, scheduled, status) {
  return { type: 'task', status: status || 'open', title, scheduled, due: null, priority: '', project: null, project_slug: null, source: null, source_note: null, links: [], created_at: null, completed_at: null, file: { path: `spice/tasks/${title}.md` } };
}

async function runRender(pages) {
  const container = makeEl('div');
  const sectionLabelCalls = [];
  const renderTaskRowCalls = [];
  let searchOnChange = null;
  const dv = {
    container,
    current: () => ({ type: 'to-do-hub' }),
    pages: (_q) => whereArr(pages),
  };
  global.window = {
    moment: () => ({ format: () => '2026-07-08' }),
    customJS: {
      RenderSafe: { page: (_dv) => ({ type: 'to-do-hub' }) },
      TaskEntity: {
        parseNote: (p) => ({ title: p.title, scheduled: p.scheduled, due: p.due, status: p.status, path: p.file.path, project_slug: null, source: null }),
      },
      TaskTodayList: {
        renderTaskRow: (c, task) => { renderTaskRowCalls.push(task.title); return c.createEl('div', { cls: 'row', text: task.title }); },
      },
      SectionLabel: { render: (c, o) => { sectionLabelCalls.push(o && o.text); } },
      DocSearch: {
        render: (_dv, opts) => {
          searchOnChange = opts.onChange;
          const resultsContainer = container.createEl('div', { cls: 'results' });
          const ctx = { resultsContainer, hasActiveFilter: false, text: '' };
          return ctx;
        },
      },
    },
  };
  global.app = { workspace: { openLinkText() {} } };
  const src = fs.readFileSync(SRC, 'utf8');
  const Cls = new Function(`${src}\nreturn ToDoAllList;`)();
  const inst = new Cls();
  await inst.render(dv);
  return { container, sectionLabelCalls, renderTaskRowCalls, searchOnChange };
}

(async () => {
  const pages = [
    mkTaskPage('OldOverdue', '2026-07-01'),
    mkTaskPage('DueToday', '2026-07-08'),
    mkTaskPage('Tomorrow', '2026-07-09'),
    mkTaskPage('Undated', null),
    mkTaskPage('AlreadyDone', '2026-07-01', 'done'),
  ];

  const { sectionLabelCalls, renderTaskRowCalls } = await runRender(pages);

  ok('TAL-RENDER-1 renders without throwing', true);
  ok('TAL-RENDER-2 emits section labels for Overdue, Today, and future date groups',
    sectionLabelCalls.some(l => /overdue/i.test(l)) &&
    sectionLabelCalls.some(l => /today/i.test(l) || l === '2026-07-08'));
  ok('TAL-RENDER-3 draws a row for every OPEN task (done task excluded)',
    renderTaskRowCalls.includes('OldOverdue') && renderTaskRowCalls.includes('DueToday') &&
    renderTaskRowCalls.includes('Tomorrow') && renderTaskRowCalls.includes('Undated') &&
    !renderTaskRowCalls.includes('AlreadyDone'));

  const allPass = results.every(([, p]) => p);
  console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
  process.exit(allPass ? 0 : 1);
})();
```

- [ ] **Step 2: Run to verify it fails against the current implementation**

```bash
npm run test:todo-all-list
```

Expected: FAIL — `ToDoAllListClass.groupByDate` and `ToDoAllListClass.filterByText` don't exist yet on the current (old) implementation; the render-integration test also fails since the old code queries `p.file.tasks`, not `spice/tasks`.

- [ ] **Step 3: Rewrite `todo-all-list.js`**

Replace the ENTIRE contents of `platform/blueprints/to-do/helpers/todo-all-list.js`:

```javascript
/**
 * ToDoAllList (CustomJS) — renders EVERY open task-note under spice/tasks/
 * (excluding _trash/ and _done/), with a DocSearch text-filter strip above a
 * date-grouped list: Overdue (oldest first) → Today → future dates (soonest
 * first) → "No date". Mirrors TaskDoneArchive's pattern exactly (same
 * dependency chain, same two-container DocSearch shape), rendering each row
 * via the shared TaskTodayList.renderTaskRow so behavior (checkbox, edit,
 * delete, title-click) matches every other task surface.
 *
 * Rebuilt from the retired p.file.tasks (native markdown-checkbox) model —
 * that data source stopped being populated once note-per-task replaced raw
 * checkboxes with task notes, which is why the old view froze at whatever
 * date last had literal checkbox lines.
 *
 * Class name (ToDoAllList) and hosting template path
 * (spice/to-do/All-ToDos.md) are UNCHANGED so ToDoLeafActions' self-heal
 * check (which tests file content for the ToDoAllList sentinel string)
 * keeps working without modification.
 *
 * Embeds-safe (returns early in markdown-embed contexts). Dual-fire-safe via
 * the __toDoAllRenderGen counter pattern other helpers use.
 */
class ToDoAllList {

    groupByDate(parsedTasks, todayStr) { return ToDoAllList.groupByDate(parsedTasks, todayStr); }
    filterByText(parsedTasks, text) { return ToDoAllList.filterByText(parsedTasks, text); }

    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__toDoAllRenderGen || 0) + 1;
        dv.container.__toDoAllRenderGen = myGen;
        const isStale = () => dv.container.__toDoAllRenderGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const page = window.customJS && window.customJS.RenderSafe
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE  = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        const DS  = window.customJS && window.customJS.DocSearch;
        const SL  = window.customJS && window.customJS.SectionLabel;
        if (!TE || typeof TE.parseNote !== 'function' ||
            !TTL || typeof TTL.renderTaskRow !== 'function' ||
            !DS  || typeof DS.render !== 'function' ||
            !SL  || typeof SL.render !== 'function') return;

        const todayStr = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DD')
            : '';

        // Load every OPEN task note once (excluding _trash/ and _done/).
        let allTasks = [];
        try {
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            allTasks = arr.map(p => TE.parseNote(p));
        } catch (_e) { allTasks = []; }

        if (isStale()) return;

        // Render results into ctx.resultsContainer (two-container DocSearch pattern,
        // matching TaskDoneArchive).
        const renderResults = (ctx) => {
            const container = ctx.resultsContainer;
            while (container.firstChild) container.removeChild(container.firstChild);

            const filtered = ctx.hasActiveFilter
                ? ToDoAllList.filterByText(allTasks, ctx.text)
                : allTasks;

            if (!filtered.length) {
                const msg = ctx.hasActiveFilter ? 'No tasks match.' : 'No open tasks — all clear. ✅';
                const p = container.createEl('p', { text: msg });
                p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 8px 0;';
                return;
            }

            const groups = ToDoAllList.groupByDate(filtered, todayStr);
            const renderGroup = (label, tasks) => {
                if (!tasks.length) return;
                SL.render(container, { text: label });
                for (const task of tasks) {
                    try { TTL.renderTaskRow(container, task, null); } catch (_e) {}
                }
            };
            renderGroup('Overdue', groups.overdue);
            renderGroup('Today', groups.today);
            for (const [dateStr, tasks] of groups.futureByDate) {
                const label = (typeof window !== 'undefined' && window.moment)
                    ? window.moment(dateStr, 'YYYY-MM-DD').format('MMM D, YYYY')
                    : dateStr;
                renderGroup(label, tasks);
            }
            renderGroup('No date', groups.noDate);
        };

        const filterCtx = DS.render(dv, {
            scopePath: 'spice/tasks',
            hideTags: true,
            persist: false,
            hideNativeSearch: true,
            onChange: renderResults,
        });

        if (isStale()) return;
        renderResults(filterCtx);
    }

    /**
     * Partition parsed OPEN tasks relative to `todayStr` (YYYY-MM-DD) into:
     *   overdue     — scheduled < todayStr, sorted ascending (oldest first)
     *   today       — scheduled === todayStr
     *   future      — scheduled > todayStr, sorted ascending (soonest first)
     *   futureByDate — future tasks grouped into a Map<dateStr, tasks[]>,
     *                  iteration order ascending by date (for per-date
     *                  SectionLabel groups in render())
     *   noDate      — scheduled is null/empty
     * Pure, Node-testable; tolerates null/non-array input (all-empty result).
     */
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

    /** Case-insensitive title substring filter (mirrors TaskDoneArchive.filterByText). */
    static filterByText(parsedTasks, text) {
        if (!Array.isArray(parsedTasks)) return [];
        if (!text || !text.trim()) return parsedTasks;
        const lower = text.toLowerCase();
        return parsedTasks.filter(t => t && t.title && t.title.toLowerCase().includes(lower));
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:todo-all-list
```

Expected: all `TAL-GROUP-*`, `TAL-FILTER-*`, `TAL-RENDER-*` PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-all-list.js platform/test/run-todo-all-list.js
git commit -m "fix(todo-all-list): rebuild against the note-per-task model

ToDoAllList queried p.file.tasks (native markdown checkboxes), a data
source that stopped being populated once note-per-task replaced raw
checkboxes with task notes — this is why the view froze at whatever date
last had literal checkbox lines. Now mirrors TaskDoneArchive: DocSearch
filter strip over spice/tasks, date-grouped (Overdue/Today/future/No date),
rows drawn via the shared TaskTodayList.renderTaskRow."
```

---

### Task 6: Add the "Completed" nav button to `ToDoLeafActions`

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-leaf-actions.js` (add one button + its handler)
- Test: `platform/test/run-task-entity.js` (append after the existing `TLA-CPN-1` test / the `NLC-*` tests from Task 2)

**Fix:** Add a "Completed" `AccentButton` next to "All" (hidden on `project-todo`, same as "All"), opening `spice/to-do/Completed Tasks.md` via the same lightweight create-if-missing pattern `openAllToDos` already uses.

- [ ] **Step 1: Read the current file to find the exact insertion points**

```bash
grep -n "openAllToDos\|listIcon\|AccentButton.render(row" platform/blueprints/to-do/helpers/todo-leaf-actions.js
```

- [ ] **Step 2: Write the failing test**

Append to `platform/test/run-task-entity.js` after the `NLC-*` tests added in Task 2 (or after `TLA-CPN-1` if Task 2 hasn't landed yet — either position is fine, this task is independent):

```javascript
// ---------- ToDoLeafActions "Completed" button (Task 6) ----------
ok('TLA-COMPLETED-1 ToDoLeafActions exposes an openCompletedTasks handler that creates the archive note', async () => {
  const created = [];
  let opened = null;
  global.window = { moment: () => ({ format: () => '2026-07-08T09:00:00-0600' }) };
  global.app = {
    vault: {
      getAbstractFileByPath: () => null,
      create: async (p, body) => { created.push({ path: p, body }); return { path: p }; },
    },
    workspace: { openLinkText: (p) => { opened = p; } },
  };
  const inst = new ToDoLeafActionsClass();
  await inst.openCompletedTasks();
  assert(created.length === 1, 'exactly one vault.create: got ' + created.length);
  assert(created[0].path === 'spice/to-do/Completed Tasks.md', 'creates at spice/to-do/Completed Tasks.md: ' + created[0].path);
  assert(/TaskDoneArchive/.test(created[0].body), 'template body references TaskDoneArchive: ' + created[0].body);
  assert(opened === 'spice/to-do/Completed Tasks.md', 'opens the note after ensuring it exists');
});

ok('TLA-COMPLETED-2 openCompletedTasks does NOT overwrite an existing well-formed note', async () => {
  const modified = [];
  let opened = null;
  const existingBody = '---\ntype: to-do-hub\n---\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "TaskDoneArchive" });\n```\n';
  global.window = { moment: () => ({ format: () => '2026-07-08T09:00:00-0600' }) };
  global.app = {
    vault: {
      getAbstractFileByPath: () => ({ path: 'spice/to-do/Completed Tasks.md' }),
      read: async () => existingBody,
      modify: async (f, body) => { modified.push(body); },
    },
    workspace: { openLinkText: (p) => { opened = p; } },
  };
  const inst = new ToDoLeafActionsClass();
  await inst.openCompletedTasks();
  assert(modified.length === 0, 'existing well-formed note is left alone: got ' + modified.length + ' modify calls');
  assert(opened === 'spice/to-do/Completed Tasks.md', 'still opens the note');
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test:task-entity
```

Expected: `FAIL TLA-COMPLETED-1` / `FAIL TLA-COMPLETED-2` — `openCompletedTasks` doesn't exist yet on `ToDoLeafActionsClass`.

- [ ] **Step 4: Implement the button + handler**

Add a new instance method `openCompletedTasks()` to the `ToDoLeafActions` class — insert it as a new method (any position inside the class body is fine; place it directly after the `render(dv)` method's closing `}`, i.e. after the line `if (wantDividers) host.createEl('hr').style.cssText = DIVIDER;` and the method's closing `}`, but BEFORE the class's own final closing `}`):

```javascript
    /**
     * Open (creating if missing) the Completed Tasks archive note — mirrors
     * openAllToDos's lightweight create-if-missing pattern exactly. Uses the
     * module-level `app` (browser-side; both openAllToDos and this method run
     * inside render()'s closures where `app` is the Obsidian global, but this
     * is also invoked directly in tests via `new ToDoLeafActionsClass()`, so
     * resolve `app` defensively from window/global here too).
     */
    async openCompletedTasks() {
        const appRef = (typeof window !== 'undefined' && window.app)
            || (typeof globalThis !== 'undefined' && globalThis.app)
            || (typeof app !== 'undefined' ? app : null);
        if (!appRef) return;
        const path = 'spice/to-do/Completed Tasks.md';
        const file = appRef.vault.getAbstractFileByPath(path);
        const body = [
            '---',
            'type: to-do-hub',
            `created_at: "${window.moment().format('YYYY-MM-DDTHH:mm:ssZZ')}"`,
            'cssclasses:',
            '  - wide',
            '---',
            '',
            '```dataviewjs',
            'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
            '```',
            '',
            '```dataviewjs',
            'await dv.view("ranch/views/customjs-guard", { class: "ToDoHubActions" });',
            '```',
            '',
            '```dataviewjs',
            'await dv.view("ranch/views/customjs-guard", { class: "TaskDoneArchive" });',
            '```',
            '',
        ].join('\n');
        try {
            if (!file) {
                await appRef.vault.create(path, body);
            } else {
                const content = await appRef.vault.read(file);
                if (!content.trim() || !/^---\s*$/m.test(content) || !/TaskDoneArchive/.test(content)) {
                    await appRef.vault.modify(file, body);
                    new Notice('Completed Tasks.md was empty or missing the aggregator block — restored from template.', 6000);
                }
            }
        } catch (e) {
            console.warn('[ToDoLeafActions] could not (re)write Completed Tasks.md', e);
        }
        appRef.workspace.openLinkText(path, '');
    }
```

The test's global.app resolution note: the test file sets `global.app = {...}` (a Node global) and `global.window = { moment: ... }` (no `.app` on window), matching the third fallback branch (`typeof app !== 'undefined' ? app : null`) — this works because `new Function(...)` in the test's `loadClass` executes in a scope where Node's `global.app` is visible as the bare identifier `app` (same mechanism the rest of `task-dialog.js` already relies on elsewhere in this codebase's Node tests).

Then wire the new "Completed" button into `render(dv)`, right after the existing "All" button line (`if (noteType !== 'project-todo') { customJS.AccentButton.render(row, { label: 'All', ... }); }`):

```javascript
        if (noteType !== 'project-todo') {
            customJS.AccentButton.render(row, { label: 'All', icon: listIcon, onClick: openAllToDos, flex: true });
            customJS.AccentButton.render(row, { label: 'Completed', icon: listIcon, onClick: () => this.openCompletedTasks(), flex: true });
        }
```

(Reuses the existing `listIcon` SVG constant already defined earlier in `render()` — no new icon asset needed.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:task-entity
```

Expected: `TLA-COMPLETED-1` and `TLA-COMPLETED-2` PASS. `TLA-CPN-1` (and Task 2's `NLC-*`, if already landed) still PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-leaf-actions.js platform/test/run-task-entity.js
git commit -m "feat(todo-leaf-actions): add Completed nav button to the daily/project to-do chrome

TaskDoneArchive + spice/to-do/Completed Tasks.md already existed (shipped
2026-07-06) but nothing linked to them. Adds a 'Completed' AccentButton next
to 'All', using the same create-if-missing pattern as openAllToDos."
```

---

### Task 7: Full-suite verification + preflight

**Files:** none (verification only)

- [ ] **Step 1: Run the full task-entity + todo-all-list suites together**

```bash
npm run test:task-entity && npm run test:todo-all-list
```

Expected: both exit 0, zero failures.

- [ ] **Step 2: Run the full release preflight**

```bash
npm run release:preflight
```

Expected: exits 0. This runs every registered harness (90+ files), including schema lint, cold-load lint, and every `run-*.js` — confirms Tasks 1-6 introduced no regressions anywhere else in the workshop (e.g. `run-task-entity-render-guards.js`, `run-todo-render-guards.js`, `run-todo-dialog.js`, `run-todo-carryover.js` all touch adjacent to-do/task-entity code paths).

If anything fails, fix it before proceeding — do not skip ahead with a red preflight.

- [ ] **Step 3: Confirm no unintended file changes**

```bash
git status --short
git diff --stat main
```

Expected: only the files touched in Tasks 1-6 (plus the design doc commit already on this branch from before Task 1) show up in the diff — no accidental edits to `ranch/scripts/**`, `spice/**`, or unrelated mechanisms/blueprints.

- [ ] **Step 4: Push the branch and open the PR**

```bash
git push -u origin cycle/todo-blueprint-fixes
gh pr create --title "fix(to-do): overdue miscount, note-link picker, task ordering, CSS wrap, All-ToDos, Completed nav" --body "$(cat <<'EOF'
## Summary
- Fixes 6 confirmed bugs in the note-per-task to-do system (see Docs/plans/2026-07-08-todo-blueprint-bug-fixes-design.md for root-cause detail):
  1. Overdue miscount — TaskEntity._toDateStr now reads dates via UTC accessors, not local zone (bare YAML dates parse as UTC midnight; local rendering in a negative-offset zone rolled the calendar date back a day).
  2. Note-link picker — extracted the candidate-builder into a pure static and switched its dedup Set to a null-prototype map (a note basename colliding with an inherited Object.prototype key, e.g. "constructor", was silently dropped).
  3. Task ordering — TaskTodayList.buildBands now sorts Overdue ascending by scheduled and Today ascending by due.
  4. Checkbox/text CSS wrap — nested the checkbox + title in a flex-wrap:nowrap group so a long title can no longer strand the checkbox on its own line.
  5. All-ToDos — rebuilt against spice/tasks (note-per-task), mirroring TaskDoneArchive's DocSearch + date-group pattern; the old view queried a retired markdown-checkbox data source.
  6. Completed Tasks — added a "Completed" nav button (the archive view already existed, shipped 2026-07-06, but nothing linked to it).

## Test plan
- [x] npm run test:task-entity (all new + existing cases pass)
- [x] npm run test:todo-all-list (rebuilt suite passes)
- [x] npm run release:preflight (full suite green)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for CI, then merge**

Poll `gh pr checks <PR-number>` until both `preflight (macos-latest)` and `preflight (ubuntu-latest)` report success. Then:

```bash
gh pr merge --squash --auto
```

(`--auto` merges automatically once required checks pass, in case they're still running.)

---

## Out of scope (unchanged from the design doc)

- Recurring tasks (create-dialog surfacing).
- Subtasks within a task note (parent/child task relationship).

Both need their own design session.
