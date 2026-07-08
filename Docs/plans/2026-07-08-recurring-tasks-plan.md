# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disconnected, broken raw-markdown recurring-task registry with a rolling-single-note recurrence field on the note-per-task model, so recurring tasks show up everywhere a normal task does.

**Architecture:** A new `recurrence` frontmatter field on `spice/tasks/*.md` notes (pure grammar string, reusing the existing `RecurrenceParser`). `TaskDialog`'s "done" action branches: a recurring task rolls its `scheduled` date forward instead of archiving. A new pure `TaskEntity.nextOccurrence` helper computes the roll target. A new to-do-blueprint query view (`TaskRecurringList` / `spice/to-do/Recurring.md`) replaces the old registry as the discovery surface. An install-time heal migrates each consumer's existing `Recurring Tasks.md` registry entries (including the ones broken by the checkbox bug) into real rolling task notes.

**Tech Stack:** Vanilla JS (CustomJS classes), Dataview (`dataviewjs` render blocks), Obsidian Templater installer (`platform/install.js`), Node test harnesses (`platform/test/run-*.js`).

**Design doc:** `Docs/plans/2026-07-08-recurring-tasks-design.md` — read it first for the full rationale (root cause, rejected alternatives, migration semantics for checked-off registry lines).

**Release note:** Per `Docs/agent-guides/build-test-verify.md` § Release workflow, **do NOT bump any version number by hand** anywhere in this plan (`manifest.json`, `package.json`, `platform-subscription.json` pins, the seed-vault pins). Conventional-commit messages (`feat(task-entity):`, `feat(to-do):`) are the only input the automated bumper needs; it computes and writes every version record after merge to `main`.

---

## File map

| File | Change |
|---|---|
| `platform/mechanisms/task-entity/task-entity.js` | Add `recurrence` to schema; add `nextOccurrence` pure helper |
| `platform/mechanisms/task-entity/task-dialog.js` | Add recurrence field to Create/Edit form; branch `_markDone` |
| `platform/mechanisms/task-entity/task-today-list.js` | Add repeat-icon badge to `renderTaskRow` |
| `platform/mechanisms/task-entity/task-note-view.js` | Add "Recurs" field row |
| `platform/blueprints/to-do/helpers/task-recurring-list.js` | **NEW** — query view listing open recurring tasks |
| `platform/blueprints/to-do/helpers/todo-chrome-bar.js` | Repoint "Recurring" nav button; new `to-do-recurring-list` detect branch |
| `platform/blueprints/to-do/templates/Recurring.md` | **NEW** — hosts `TaskRecurringList` |
| `platform/blueprints/to-do/manifest.json` | Register new class + new template file entry |
| `platform/install.js` | **NEW** `applyRecurringTasksMigrationHeal` |
| `platform/test/run-task-entity.js` | New `TE-*` / `TD-*` / `TTL-*` / `TNV-*` cases |
| `platform/test/seed-vault/spice/to-do/Recurring Tasks.md` | **NEW** pre-migration fixture (sanctioned seed edit) |
| `platform/test/run-seed-migrations.js` | New `HC-V0202-SEED-MIGRATE-RECURRING-*` family |

No version bumps, no manifest version edits — see the release note above.

---

### Task 1: `TaskEntity` — add `recurrence` to the schema

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js:300-332` (`composeNote`), `:339-370` (`parseNote`)
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

Add these two cases to `platform/test/run-task-entity.js` (append after the existing `composeNote`/`parseNote` cases — search the file for `ok('TE-` to find the right neighborhood):

```js
ok('TE-recur-1 composeNote emits recurrence (set + empty)', () => {
  const withRecur = TaskEntity.composeNote({ title: 'Feed the dogs', recurrence: 'every day', moment: fixedMoment });
  assert(withRecur.frontmatter.recurrence === 'every day', 'recurrence set: ' + withRecur.frontmatter.recurrence);
  const bare = TaskEntity.composeNote({ title: 'One-shot', moment: fixedMoment });
  assert(bare.frontmatter.recurrence === '', 'recurrence empty-string-not-omitted: ' + JSON.stringify(bare.frontmatter.recurrence));
  // Schema position: recurrence sits right after due, before priority.
  const keys = Object.keys(withRecur.frontmatter);
  assert(keys.indexOf('due') === keys.indexOf('recurrence') - 1, 'recurrence follows due: ' + keys.join(','));
  assert(keys.indexOf('recurrence') === keys.indexOf('priority') - 1, 'recurrence precedes priority: ' + keys.join(','));
});

ok('TE-recur-2 parseNote normalizes recurrence like priority (empty string, not null)', () => {
  const withRecur = TaskEntity.parseNote({ title: 'Feed the dogs', recurrence: 'every day', file: { path: 'spice/tasks/Feed the dogs.md' } });
  assert(withRecur.recurrence === 'every day', 'recurrence read back: ' + withRecur.recurrence);
  const bare = TaskEntity.parseNote({ title: 'One-shot', file: { path: 'spice/tasks/One-shot.md' } });
  assert(bare.recurrence === '', 'absent recurrence -> empty string: ' + JSON.stringify(bare.recurrence));
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TE-recur"
```

Expected: `FAIL TE-recur-1 ...` and `FAIL TE-recur-2 ...` (recurrence is `undefined`, not in the frontmatter object at all).

- [ ] **Step 3: Implement**

In `TaskEntity.composeNote` (`platform/mechanisms/task-entity/task-entity.js`), the frontmatter object currently reads:

```js
        const frontmatter = {
            type: 'task',
            title: p.title || '',
            status: p.status || 'open',
            scheduled: p.scheduled || '',
            due: p.due || '',
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

Change to insert `recurrence` right after `due`:

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

In `TaskEntity.parseNote`, the returned object currently reads:

```js
        return {
            title: p.title != null ? String(p.title) : '',
            status: p.status || 'open',
            scheduled: TaskEntity._toDateStr(p.scheduled),
            due: TaskEntity._toDateStr(p.due),
            priority: p.priority || '',
```

Add `recurrence` right after `due`:

```js
        return {
            title: p.title != null ? String(p.title) : '',
            status: p.status || 'open',
            scheduled: TaskEntity._toDateStr(p.scheduled),
            due: TaskEntity._toDateStr(p.due),
            recurrence: p.recurrence || '',
            priority: p.priority || '',
```

Also update the class doc-comment's payload shape note (near line 294) to mention `recurrence?` alongside `priority?`.

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TE-recur"
```

Expected: `ok TE-recur-1 ...` and `ok TE-recur-2 ...`

- [ ] **Step 5: Run the full harness to check nothing else broke**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

Expected: `0 failing` (or whatever the summary line format is — confirm no new failures vs. the pre-change baseline).

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): add recurrence field to the task note schema"
```

---

### Task 2: `TaskEntity` — `nextOccurrence` pure helper

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js` (add near `queryToday`, before `validatePayload`)
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

```js
ok('TE-recur-3 nextOccurrence finds the next matching date after fromDateStr', () => {
  // Simple predicate: matches every date whose day-of-month is even.
  const evenDayMatches = (dateStr) => {
    const day = parseInt(dateStr.slice(8, 10), 10);
    return day % 2 === 0;
  };
  const next = TaskEntity.nextOccurrence('every 2 days (test grammar)', '2026-07-08', null, evenDayMatches);
  assert(next === '2026-07-10', 'next even day after the 8th (itself even) is the 10th: ' + next);
});

ok('TE-recur-4 nextOccurrence never returns fromDateStr itself, even if it matches', () => {
  const alwaysMatches = () => true;
  const next = TaskEntity.nextOccurrence('every day', '2026-07-08', null, alwaysMatches);
  assert(next === '2026-07-09', 'strictly AFTER fromDateStr: ' + next);
});

ok('TE-recur-5 nextOccurrence returns null when the predicate never matches within the horizon', () => {
  const neverMatches = () => false;
  const next = TaskEntity.nextOccurrence('every leap-day-2400', '2026-07-08', null, neverMatches);
  assert(next === null, 'unsupported/never-matching grammar -> null: ' + next);
});

ok('TE-recur-6 nextOccurrence tolerates a missing/throwing matchesFn (never throws)', () => {
  let threw = false;
  try {
    const next = TaskEntity.nextOccurrence('every day', '2026-07-08', null, null);
    assert(next === null, 'no matchesFn -> null, not a throw: ' + next);
  } catch (_e) { threw = true; }
  assert(!threw, 'nextOccurrence must never throw');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TE-recur-[3-6]"
```

Expected: FAIL — `nextOccurrence` doesn't exist yet (`TypeError: TaskEntity.nextOccurrence is not a function`).

- [ ] **Step 3: Implement**

Add both an instance delegator (near the other delegators, line ~57, right after `validatePayload(payload)`) and the static method (right before `static validatePayload`, around line 396-400):

Instance delegator — in the "Instance delegators" block at the top of the class:

```js
    nextOccurrence(recurrence, fromDateStr, anchorDateStr, matchesFn) { return TaskEntity.nextOccurrence(recurrence, fromDateStr, anchorDateStr, matchesFn); }
```

Static method — insert directly above `static validatePayload(payload) {`:

```js
    /**
     * Walk forward day-by-day from the day AFTER `fromDateStr` (never returning
     * `fromDateStr` itself, even if it would match) looking for the first date
     * where `matchesFn(candidateDateStr, anchorDateStr)` returns true. Capped at
     * a 400-day horizon (mirrors `_uniqueName`'s collision-loop cap) so an
     * unsupported or never-firing grammar can't spin forever — returns `null` in
     * that case. `matchesFn` is INJECTED (not a hard dependency on
     * RecurrenceParser) so this pure core stays testable without a customJS
     * global; the browser-side caller (TaskDialog) closes over
     * `window.customJS.RecurrenceParser.matches`. A missing/throwing/non-function
     * `matchesFn` yields `null` — never throws.
     *
     * `fromDateStr` / `anchorDateStr` are plain `YYYY-MM-DD` strings. Date
     * arithmetic is done via `Date.UTC` (never local-zone getters) so this is
     * correct regardless of the host device's timezone (mirrors `_toDateStr`'s
     * UTC-safety rationale).
     */
    static nextOccurrence(recurrence, fromDateStr, anchorDateStr, matchesFn) {
        if (typeof matchesFn !== 'function') return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fromDateStr == null ? '' : fromDateStr));
        if (!m) return null;
        const startMs = Date.UTC(+m[1], +m[2] - 1, +m[3]);
        const DAY_MS = 86400000;
        const HORIZON_DAYS = 400;
        for (let i = 1; i <= HORIZON_DAYS; i++) {
            const d = new Date(startMs + i * DAY_MS);
            const p = (n) => String(n).padStart(2, '0');
            const candidate = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
            let fires = false;
            try { fires = !!matchesFn(candidate, anchorDateStr, recurrence); } catch (_e) { fires = false; }
            if (fires) return candidate;
        }
        return null;
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TE-recur-[3-6]"
```

Expected: 4x `ok`.

- [ ] **Step 5: Full harness**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-entity.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): add TaskEntity.nextOccurrence for rolling recurrence"
```

---

### Task 3: `TaskDialog` — recurrence field in Create/Edit form

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js`
- Test: `platform/test/run-task-entity.js`

This task wires a free-text recurrence field into the dialog. Because the dialog is DOM-heavy and the existing test harness only exercises `TaskDialog`'s **pure statics** (never the live `_render` DOM tree), this task's tests target the two new/changed pure statics: `_payloadFromState` (extended) and a new `_recurrenceValidity` helper. The actual field's on-screen behavior gets covered by the manual smoke pass in Task 12.

- [ ] **Step 1: Write the failing tests**

```js
ok('TD-recur-1 _payloadFromState carries recurrence through', () => {
  const state = { title: 'Feed the dogs', scheduled: '2026-07-08', due: '', priority: '', projectName: '', source: 'manual', source_note: '', links: [], recurrence: 'every day' };
  const payload = TaskDialog._payloadFromState(state);
  assert(payload.recurrence === 'every day', 'recurrence in payload: ' + payload.recurrence);
});

ok('TD-recur-2 _payloadFromState defaults recurrence to empty string', () => {
  const state = { title: 'One-shot', scheduled: '', due: '', priority: '', projectName: '', source: 'manual', source_note: '', links: [] };
  const payload = TaskDialog._payloadFromState(state);
  assert(payload.recurrence === '', 'no recurrence -> empty string: ' + JSON.stringify(payload.recurrence));
});

ok('TD-recur-3 _recurrenceValidity: empty is always valid', () => {
  const v = TaskDialog._recurrenceValidity('', () => false);
  assert(v.valid === true, 'empty recurrence is valid: ' + JSON.stringify(v));
});

ok('TD-recur-4 _recurrenceValidity: non-empty defers to isSupportedFn', () => {
  const supported = TaskDialog._recurrenceValidity('every Monday', () => true);
  assert(supported.valid === true, 'supported grammar is valid');
  const unsupported = TaskDialog._recurrenceValidity('every leap year', () => false);
  assert(unsupported.valid === false, 'unsupported grammar is invalid');
});

ok('TD-recur-5 _recurrenceValidity: a missing/throwing isSupportedFn defaults to valid (defensive)', () => {
  const missingFn = TaskDialog._recurrenceValidity('every day', null);
  assert(missingFn.valid === true, 'no isSupportedFn -> valid (never block submit on a cold-load parser): ' + JSON.stringify(missingFn));
  const throwingFn = TaskDialog._recurrenceValidity('every day', () => { throw new Error('boom'); });
  assert(throwingFn.valid === true, 'throwing isSupportedFn -> valid: ' + JSON.stringify(throwingFn));
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TD-recur"
```

Expected: FAIL — `_payloadFromState` doesn't read `state.recurrence`; `_recurrenceValidity` doesn't exist.

- [ ] **Step 3: Implement**

**3a.** Extend `_payloadFromState` (`platform/mechanisms/task-entity/task-dialog.js:937-954`). Current:

```js
    _payloadFromState(state) {
        const s = state || {};
        const payload = {
            title: s.title,
            scheduled: s.scheduled || '',
            due: s.due || '',
            priority: s.priority || '',
            source: s.source || 'manual',
            source_note: s.source_note || '',
            links: Array.isArray(s.links) ? s.links.slice() : [],
        };
```

Add `recurrence`:

```js
    _payloadFromState(state) {
        const s = state || {};
        const payload = {
            title: s.title,
            scheduled: s.scheduled || '',
            due: s.due || '',
            recurrence: s.recurrence || '',
            priority: s.priority || '',
            source: s.source || 'manual',
            source_note: s.source_note || '',
            links: Array.isArray(s.links) ? s.links.slice() : [],
        };
```

Also add an instance delegator: in the "Instance delegators" block near the top of the class (next to `renderNote`), add:

```js
    _payloadFromState(state) { return TaskDialog._payloadFromState(state); }
    _recurrenceValidity(recurrence, isSupportedFn) { return TaskDialog._recurrenceValidity(recurrence, isSupportedFn); }
```

Then convert the existing INSTANCE-only `_payloadFromState` method (currently defined once, at line ~937, as an instance method with no static counterpart — check by searching `_payloadFromState` in the file) into a STATIC, with the instance delegating to it (matching every other method's pattern in this file). Rename the current body to `static _payloadFromState(state) { ... }` and keep only the one-line delegator as the instance method.

**3b.** Add the new static `_recurrenceValidity`, placed near the other small static helpers (e.g. right after `_slugify`, around line 118-123):

```js
    /**
     * Validate a recurrence grammar string for the dialog's live-typing
     * feedback. Empty is ALWAYS valid (no recurrence). A non-empty value defers
     * to `isSupportedFn(value)` (normally `window.customJS.RecurrenceParser
     * .isSupported`, injected so this stays pure/testable). A missing or
     * throwing `isSupportedFn` — e.g. a cold-load before RecurrenceParser
     * registers — defaults to VALID rather than blocking submit; the dialog
     * should never brick task creation because a defensive dependency isn't
     * ready yet. Pure, never throws.
     */
    static _recurrenceValidity(recurrence, isSupportedFn) {
        const s = String(recurrence == null ? '' : recurrence).trim();
        if (!s) return { valid: true };
        if (typeof isSupportedFn !== 'function') return { valid: true };
        let supported;
        try { supported = !!isSupportedFn(s); } catch (_e) { return { valid: true }; }
        return supported ? { valid: true } : { valid: false, reason: 'unsupported recurrence grammar' };
    }
```

**3c.** Wire the field into the live dialog UI. In `_render` (`platform/mechanisms/task-entity/task-dialog.js`), the `state` object initialization (around line 527-542) currently ends with:

```js
            source: fm ? (fm.source || '') : (defaults.source || 'manual'),
            source_note: fm ? (fm.source_note || '') : (defaults.source_note || ''),
        };
```

Add `recurrence` to state:

```js
            source: fm ? (fm.source || '') : (defaults.source || 'manual'),
            source_note: fm ? (fm.source_note || '') : (defaults.source_note || ''),
            recurrence: fm ? (fm.recurrence || '') : '',
        };
```

Then, immediately after the "Due" field block (which ends around line 611 with `dueInput.onchange = () => { state.due = dueInput.value; updateSubmit(); };`) and BEFORE the "Priority chip row" `label('Priority')` block, insert a new field:

```js
        // Recurrence — free-text grammar (RecurrenceParser), validated live.
        // Empty = one-shot task (default). A supported grammar makes "Done"
        // roll the task's scheduled date forward instead of archiving it.
        label('Repeats (optional — e.g. "every day", "every Monday", "every 2 weeks on Friday")');
        const recurInput = host.createEl('input', { type: 'text' });
        recurInput.style.cssText = fieldCss;
        recurInput.value = state.recurrence;
        recurInput.placeholder = 'every day';
        const recurError = host.createEl('div');
        recurError.style.cssText = 'font-size:11px; color:var(--text-error,#e05561); margin-top:4px; display:none;';
        const isSupportedFn = () => {
            try {
                const RP = window.customJS && window.customJS.RecurrenceParser;
                return RP && typeof RP.isSupported === 'function' ? (v) => RP.isSupported(v) : null;
            } catch (_e) { return null; }
        };
        recurInput.oninput = () => {
            state.recurrence = recurInput.value;
            const v = TaskDialog._recurrenceValidity(state.recurrence, isSupportedFn());
            if (v.valid) {
                recurError.style.display = 'none';
            } else {
                recurError.textContent = 'Unrecognized repeat pattern — try "every day", "every Monday", "every 15th of month", or "every 2 weeks on Friday".';
                recurError.style.display = 'block';
            }
            updateSubmit();
        };
```

**3d.** Gate `updateSubmit` on recurrence validity too. Current (`platform/mechanisms/task-entity/task-dialog.js:908-915`):

```js
        const updateSubmit = () => {
            const TE = TaskDialog._taskEntity();
            const v = TE ? TE.validatePayload(buildPayload()) : { valid: !!(state.title && state.title.trim()) };
            saveBtn.disabled = !v.valid;
            // Mute the accent when Save is unavailable so the disabled state reads.
            saveBtn.style.opacity = v.valid ? '1' : '0.45';
            saveBtn.style.cursor = v.valid ? 'pointer' : 'not-allowed';
        };
```

Change to also require recurrence validity:

```js
        const updateSubmit = () => {
            const TE = TaskDialog._taskEntity();
            const v = TE ? TE.validatePayload(buildPayload()) : { valid: !!(state.title && state.title.trim()) };
            const rv = TaskDialog._recurrenceValidity(state.recurrence, isSupportedFn());
            const valid = v.valid && rv.valid;
            saveBtn.disabled = !valid;
            // Mute the accent when Save is unavailable so the disabled state reads.
            saveBtn.style.opacity = valid ? '1' : '0.45';
            saveBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
        };
```

**3e.** `_saveEdit` must persist recurrence on an existing task's frontmatter. In `_saveEdit` (`platform/mechanisms/task-entity/task-dialog.js:1064-1080`), inside the `processFrontMatter` mutator, add the line right after `fm.priority = payload.priority || '';`:

```js
            fm.recurrence = payload.recurrence || '';
```

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TD-recur"
```

Expected: 5x `ok`.

- [ ] **Step 5: Full harness + the CJS-load gate (this file is a bare class — a stray trailing statement breaks CustomJS loading)**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
node platform/test/run-customjs-loadable.js 2>&1 | grep -i "task-dialog"
```

Expected: harness green; `task-dialog.js` reported loadable.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): add recurrence field to the task dialog"
```

---

### Task 4: `TaskDialog` — branch `_markDone` for recurring tasks

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js:1101-1113`
- Test: `platform/test/run-task-entity.js`

Because `_markDone` is browser-only (reads `window.moment`, mutates via `app.fileManager.processFrontMatter`), this task tests the pure decision logic in isolation via a new static, then wires that static into `_markDone`.

- [ ] **Step 1: Write the failing tests**

```js
ok('TD-recur-6 _rollForwardDate: recurring task rolls from TODAY, not from stale scheduled', () => {
  // "every day" done late (scheduled 5th, actually completed on the 8th) rolls to the 9th.
  const matchesFn = (dateStr) => true; // "every day" always matches.
  const next = TaskDialog._rollForwardDate('every day', '2026-07-08', '2026-07-01', matchesFn);
  assert(next === '2026-07-09', 'rolls from today (8th) not from scheduled (5th): ' + next);
});

ok('TD-recur-7 _rollForwardDate returns null for an unsupported/never-matching grammar', () => {
  const next = TaskDialog._rollForwardDate('every leap year', '2026-07-08', '2026-07-01', () => false);
  assert(next === null, 'unsupported grammar -> null (caller falls back to archiving): ' + next);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TD-recur-[67]"
```

Expected: FAIL — `_rollForwardDate` doesn't exist.

- [ ] **Step 3: Implement**

Add the static (near `_recurrenceValidity`):

```js
    /**
     * Thin wrapper over TaskEntity.nextOccurrence for the "done" branch:
     * rolls forward from TODAY (not from the task's stale `scheduled`), so a
     * late completion doesn't create a backlog of overdue occurrences. Returns
     * the next `YYYY-MM-DD`, or `null` when the grammar is unsupported/never
     * fires (caller falls back to normal archiving). Pure, never throws.
     */
    static _rollForwardDate(recurrence, todayStr, anchorDateStr, matchesFn) {
        const TE = TaskDialog._taskEntity();
        if (TE && typeof TE.nextOccurrence === 'function') {
            return TE.nextOccurrence(recurrence, todayStr, anchorDateStr, matchesFn);
        }
        return null;
    }
```

Add an instance delegator next to the others:

```js
    _rollForwardDate(recurrence, todayStr, anchorDateStr, matchesFn) { return TaskDialog._rollForwardDate(recurrence, todayStr, anchorDateStr, matchesFn); }
```

Now rewrite `_markDone` (`platform/mechanisms/task-entity/task-dialog.js:1101-1113`). Current:

```js
    async _markDone(app, file) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
        const iso = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DDTHH:mm:ssZ')
            : new Date().toISOString();
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.status = 'done';
            fm.completed_at = iso;
        });
        await this._ensureFolder(app, 'spice/tasks/_done');
        await app.fileManager.renameFile(file, TaskDialog.donePath(file.path));
        try { new Notice('Task done'); } catch (_e) {}
    }
```

Replace with:

```js
    async _markDone(app, file) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
        // Read the CURRENT frontmatter (not the state object — markDone(path)
        // is also called directly from a row checkbox, with no open dialog) to
        // decide recurring vs. one-shot completion.
        let fm = null;
        try {
            const cache = app.metadataCache && typeof app.metadataCache.getFileCache === 'function'
                ? app.metadataCache.getFileCache(file) : null;
            fm = (cache && cache.frontmatter) || null;
        } catch (_e) { fm = null; }
        const recurrence = fm ? String(fm.recurrence || '').trim() : '';

        if (recurrence) {
            const todayStr = (typeof window !== 'undefined' && window.moment)
                ? window.moment().format('YYYY-MM-DD')
                : null;
            const anchorStr = fm && fm.created_at ? String(fm.created_at).slice(0, 10) : null;
            const RP = (typeof window !== 'undefined' && window.customJS && window.customJS.RecurrenceParser) || null;
            const matchesFn = (RP && typeof RP.matches === 'function' && typeof window !== 'undefined' && window.moment)
                ? (dateStr, anchorDateStr) => {
                    const dateMoment = window.moment(dateStr, 'YYYY-MM-DD');
                    const anchorMoment = anchorDateStr ? window.moment(anchorDateStr, 'YYYY-MM-DD') : null;
                    try { return RP.matches(recurrence, dateMoment, { registryCreatedAt: anchorMoment }); }
                    catch (_e) { return false; }
                }
                : null;
            const nextDate = todayStr ? TaskDialog._rollForwardDate(recurrence, todayStr, anchorStr, matchesFn) : null;
            if (nextDate) {
                // ROLL FORWARD — same file, never archived. Leaves status/priority/
                // project/links untouched; only scheduled advances and completed_at
                // clears (so the note never carries a stale "last time" stamp).
                await app.fileManager.processFrontMatter(file, (fmw) => {
                    fmw.scheduled = nextDate;
                    fmw.completed_at = '';
                });
                try { new Notice('Task rolled to ' + nextDate); } catch (_e) {}
                return;
            }
            // Grammar unsupported / never fires within the horizon — fall through
            // to normal one-shot archiving rather than silently doing nothing.
        }

        const iso = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DDTHH:mm:ssZ')
            : new Date().toISOString();
        await app.fileManager.processFrontMatter(file, (fm2) => {
            fm2.status = 'done';
            fm2.completed_at = iso;
        });
        await this._ensureFolder(app, 'spice/tasks/_done');
        await app.fileManager.renameFile(file, TaskDialog.donePath(file.path));
        try { new Notice('Task done'); } catch (_e) {}
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TD-recur-[67]"
```

Expected: 2x `ok`.

- [ ] **Step 5: Full harness**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
node platform/test/run-customjs-loadable.js 2>&1 | grep -i "task-dialog"
```

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): roll recurring tasks forward on done instead of archiving"
```

---

### Task 5: `TaskTodayList.renderTaskRow` — repeat-icon badge

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:379-387`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

This is DOM-construction logic; test it with a minimal `createEl`-shaped stub matching the pattern other DOM-stub tests in this file use (search `createEl` in `run-task-entity.js` for the existing stub helper — reuse it; if none exists, add this self-contained one):

```js
ok('TTL-recur-1 renderTaskRow shows a repeat badge iff task.recurrence is set', () => {
  // Minimal Obsidian-like DOM stub (createEl returns a chainable node with the
  // same shape TaskTodayList.renderTaskRow expects: createEl/addEventListener/style).
  function stubEl(tag) {
    const el = {
      tag, children: [], _text: '',
      style: {}, attrs: {},
      createEl(t, opts) { const c = stubEl(t); if (opts && opts.text != null) c._text = opts.text; if (opts && opts.cls) c.className = opts.cls; this.children.push(c); return c; },
      addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); },
    };
    return el;
  }
  const container = stubEl('div');
  const recurring = { title: 'Feed the dogs', path: 'spice/tasks/Feed the dogs.md', recurrence: 'every day' };
  TaskTodayList.renderTaskRow(container, recurring, null);
  const rowRecur = container.children[0];
  const findByClassDeep = (node, cls) => {
    if (node.className === cls) return node;
    for (const c of (node.children || [])) { const hit = findByClassDeep(c, cls); if (hit) return hit; }
    return null;
  };
  assert(!!findByClassDeep(rowRecur, 'sauce-task-today-recur-badge'), 'recurring row has the badge');

  const container2 = stubEl('div');
  const oneShot = { title: 'One-shot', path: 'spice/tasks/One-shot.md', recurrence: '' };
  TaskTodayList.renderTaskRow(container2, oneShot, null);
  const rowOneShot = container2.children[0];
  assert(!findByClassDeep(rowOneShot, 'sauce-task-today-recur-badge'), 'one-shot row has NO badge');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TTL-recur-1"
```

Expected: FAIL — no badge exists yet.

- [ ] **Step 3: Implement**

In `renderTaskRow` (`platform/mechanisms/task-entity/task-today-list.js`), the chips block currently reads (lines 379-387):

```js
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

Add the repeat badge right before the metadata chips (so it reads first, closest to the title):

```js
        // Repeat badge — a small icon (not a text chip) shown when the task has
        // a recurrence grammar set, so a recurring task is visually distinct at
        // a glance without opening the note.
        if (task && task.recurrence) {
            const badge = rightCluster.createEl('span', { cls: 'sauce-task-today-recur-badge' });
            badge.style.cssText = 'display:inline-flex; align-items:center; flex-shrink:0; color:var(--text-muted);';
            try { badge.setAttribute('title', 'Repeats: ' + task.recurrence); } catch (_e) {}
            badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
        }

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

Note: `badge.innerHTML = ...` requires the stub's `createEl` return value to tolerate an `innerHTML` assignment — the stub in Step 1 is a plain object, so this "just works" (assigns a property). No stub change needed.

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TTL-recur-1"
```

- [ ] **Step 5: Full harness**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): show a repeat-icon badge on recurring task rows"
```

---

### Task 6: `TaskNoteView` — "Recurs" field row

**Files:**
- Modify: `platform/mechanisms/task-entity/task-note-view.js:65-84`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

```js
ok('TNV-recur-1 _fieldRows includes a Repeats row iff recurrence is set', () => {
  const TaskNoteViewClass = loadClass('mechanisms/task-entity/task-note-view.js', 'TaskNoteView');
  const rows = TaskNoteViewClass._fieldRows({ scheduled: '2026-07-08', recurrence: 'every day' });
  const hit = rows.find(r => r.label === 'Repeats');
  assert(hit && hit.value === 'every day', 'Repeats row present with grammar text: ' + JSON.stringify(rows));

  const rowsNone = TaskNoteViewClass._fieldRows({ scheduled: '2026-07-08' });
  assert(!rowsNone.find(r => r.label === 'Repeats'), 'no recurrence -> no Repeats row: ' + JSON.stringify(rowsNone));
});
```

(If `run-task-entity.js` doesn't already `loadClass` `task-note-view.js`, add that load line near the top alongside the existing `TaskEntityClass` / `TaskDialogClass` loads: `const TaskNoteViewClass = loadClass('mechanisms/task-entity/task-note-view.js', 'TaskNoteView');` — reuse that top-level constant instead of re-loading inside the test if it already exists.)

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TNV-recur-1"
```

- [ ] **Step 3: Implement**

In `TaskNoteView._fieldRows` (`platform/mechanisms/task-entity/task-note-view.js:65-84`), current:

```js
        const sched = val(t.scheduled);
        const due = val(t.due);
        const prio = val(t.priority);
        let proj = val(t.project);
        const pm = /^\[\[([^\]]+)\]\]$/.exec(proj);
        if (pm) proj = pm[1];
        if (sched) rows.push({ label: 'Scheduled', value: sched });
        if (due) rows.push({ label: 'Due', value: due });
        if (prio) rows.push({ label: 'Priority', value: prio });
        if (proj) rows.push({ label: 'Project', value: proj });
        return rows;
```

Add a `recur` row right after `due`, keeping priority/project order unchanged:

```js
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

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TNV-recur-1"
```

- [ ] **Step 5: Full harness**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-note-view.js platform/test/run-task-entity.js
git commit -m "feat(task-entity): show a Repeats row on the task note card"
```

---

### Task 7: New `TaskRecurringList` query view (to-do blueprint)

**Files:**
- Create: `platform/blueprints/to-do/helpers/task-recurring-list.js`
- Modify: `platform/blueprints/to-do/manifest.json` (add class to `customjs_classes`, add template file entry — done together with Task 8/9's manifest edits to keep the manifest diff in one place; this task ADDS the class file only)
- Test: `platform/test/run-task-entity.js` (co-located — this file's pure statics are cheap to test alongside the other task-entity-family cases; no new test runner needed)

- [ ] **Step 1: Write the failing test**

```js
ok('TRL-1 filterRecurring keeps only open tasks with a non-empty recurrence, sorted by scheduled ascending', () => {
  const TaskRecurringListClass = loadClass('blueprints/to-do/helpers/task-recurring-list.js', 'TaskRecurringList');
  const tasks = [
    { title: 'B', status: 'open', scheduled: '2026-07-20', recurrence: 'every day' },
    { title: 'A', status: 'open', scheduled: '2026-07-09', recurrence: 'every Monday' },
    { title: 'No recurrence', status: 'open', scheduled: '2026-07-08', recurrence: '' },
    { title: 'Done recurring', status: 'done', scheduled: '2026-07-08', recurrence: 'every day' },
    { title: 'No date', status: 'open', scheduled: null, recurrence: 'every day' },
  ];
  const out = TaskRecurringListClass.filterRecurring(tasks);
  assert(out.length === 3, 'keeps the 3 open+recurring tasks (including the undated one): ' + out.length);
  assert(out[0].title === 'A' && out[1].title === 'B', 'sorted by scheduled ascending, dated first: ' + out.map(t => t.title).join(','));
  assert(out[2].title === 'No date', 'undated recurring task sorts last: ' + out.map(t => t.title).join(','));
});

ok('TRL-2 filterRecurring tolerates null/non-array input', () => {
  const TaskRecurringListClass = loadClass('blueprints/to-do/helpers/task-recurring-list.js', 'TaskRecurringList');
  assert(Array.isArray(TaskRecurringListClass.filterRecurring(null)), 'null -> []');
  assert(TaskRecurringListClass.filterRecurring(null).length === 0, 'null -> empty array');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TRL-"
```

Expected: FAIL — file doesn't exist yet (`loadClass` throws `ENOENT`).

- [ ] **Step 3: Implement**

Create `platform/blueprints/to-do/helpers/task-recurring-list.js`:

```js
/**
 * TaskRecurringList (CustomJS) — the "Recurring" index view (to-do blueprint).
 * Replaces the old spice/to-do/Recurring Tasks.md raw-markdown registry: lists
 * every OPEN task note under spice/tasks/ that has a `recurrence` grammar set,
 * sorted by `scheduled` ascending (undated recurring tasks sort last). Each
 * row opens its real task note via the shared TaskTodayList.renderTaskRow —
 * this is a READ-ONLY index; there is no manual-editing surface here (edit
 * happens on the task note itself, same as everywhere else).
 *
 * Dependency chain: TaskEntity (parseNote) + TaskTodayList (renderTaskRow) +
 * SectionLabel (heading). Mirrors ToDoAllList's structure (same query root,
 * same cold-load guards, same dual-fire-safe render-generation counter) minus
 * the DocSearch filter strip — this list is expected to be small.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the
 * whole file in `( ... )` and evals it as ONE expression; any trailer
 * (module.exports, if, ...) -> "Unexpected token" -> the class never
 * registers. To Node-test the statics, load via
 * `new Function(src + "; return TaskRecurringList;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskRecurringList.filterRecurring(parsedTasks) -> parsedTask[]
 *
 * Instance API (browser-side):
 *   TaskRecurringList.render(dv)   <- the customjs-guard entry point
 */
class TaskRecurringList {

    /**
     * Filter parsed tasks (TaskEntity.parseNote output, or any object shaped
     * `{ status, recurrence, scheduled, title }`) to open tasks with a
     * non-empty `recurrence`. Sorted by `scheduled` ascending; tasks with no
     * `scheduled` value sort LAST (treated as "after" any real date), tie-
     * broken by title (case-insensitive). Tolerates null/non-array input
     * (-> []). Never throws.
     */
    static filterRecurring(parsedTasks) {
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        const out = list.filter(t => t && t.status === 'open' && t.recurrence && String(t.recurrence).trim() !== '');
        out.sort((a, b) => {
            const as = a.scheduled || '';
            const bs = b.scheduled || '';
            if (as !== bs) {
                if (as === '') return 1;
                if (bs === '') return -1;
                return as < bs ? -1 : 1;
            }
            return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
        });
        return out;
    }

    /**
     * Entry point invoked by customjs-guard: render(dv). Cold-load safe (bails
     * quietly if RenderSafe / TaskEntity / TaskTodayList / SectionLabel aren't
     * registered yet); embeds-safe; dual-fire-safe via a render-generation
     * counter (matches ToDoAllList / TaskDoneArchive convention).
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__taskRecurringListGen || 0) + 1;
        dv.container.__taskRecurringListGen = myGen;
        const isStale = () => dv.container.__taskRecurringListGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const page = window.customJS && window.customJS.RenderSafe
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        const SL = window.customJS && window.customJS.SectionLabel;
        if (!TE || typeof TE.parseNote !== 'function'
            || !TTL || typeof TTL.renderTaskRow !== 'function'
            || !SL || typeof SL.render !== 'function') return;

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

        const recurring = TaskRecurringList.filterRecurring(allTasks);
        if (!recurring.length) {
            const p = dv.container.createEl('p', { text: 'No recurring tasks yet — set "Repeats" on a task to see it here.' });
            p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 8px 0;';
            return;
        }

        for (const task of recurring) {
            try { TTL.renderTaskRow(dv.container, task, null); } catch (_e) {}
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-task-entity.js 2>&1 | grep -A1 "TRL-"
```

- [ ] **Step 5: CJS-load gate**

```bash
node platform/test/run-customjs-loadable.js 2>&1 | grep -i "task-recurring-list"
```

Expected: reported loadable (this new file must be picked up automatically by whatever glob `run-customjs-loadable.js` uses over `platform/blueprints/*/helpers/*.js` — confirm it appears in the output; if the harness enumerates files explicitly rather than globbing, add the new path to that list).

- [ ] **Step 6: Full harness**

```bash
node platform/test/run-task-entity.js 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/to-do/helpers/task-recurring-list.js platform/test/run-task-entity.js
git commit -m "feat(to-do): add TaskRecurringList query view"
```

---

### Task 8: `Recurring.md` template + manifest wiring

**Files:**
- Create: `platform/blueprints/to-do/templates/Recurring.md`
- Modify: `platform/blueprints/to-do/manifest.json`

- [ ] **Step 1: Create the template**

Mirror `platform/blueprints/to-do/templates/All To-Dos.md` exactly, swapping the class and giving the page its own `type`:

```markdown
---
type: to-do-recurring-list
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "{{vault_identity_tag}}"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TaskRecurringList" });
```
```

(Match the exact fenced-block formatting of `All To-Dos.md` — two separate ` ```dataviewjs ` blocks, one blank line between them, no trailing content after the second closing fence besides a final newline.)

- [ ] **Step 2: Wire the manifest**

In `platform/blueprints/to-do/manifest.json`:

**2a.** Add `"TaskRecurringList"` to `customjs_classes` (alphabetical-ish placement matching the existing list's rough grouping — insert next to `"ToDoAllList"`):

```json
    "ToDoAllList",
    "TaskRecurringList",
```

**2b.** Add a new `files[]` entry for the helper (`task-recurring-list.js`, mirroring the `todo-all-list.js` entry's shape) — insert it next to that entry:

```json
    {
      "source": "helpers/todo-all-list.js",
      "dest": "{{scripts_path}}/to-do/todo-all-list.js"
    },
    {
      "source": "helpers/task-recurring-list.js",
      "dest": "{{scripts_path}}/to-do/task-recurring-list.js"
    },
```

**2c.** Add a new `files[]` entry for the template, matching `All To-Dos.md`'s destination shape (**no** `materialize_once` — this page is code-driven boilerplate the installer keeps in sync on every install, exactly like `All-ToDos.md`):

```json
    {
      "source": "templates/Recurring.md",
      "dest": "{{module_directory}}/Recurring.md"
    },
```

- [ ] **Step 3: Verify the manifest is still valid JSON + the schema lint passes**

```bash
node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/to-do/manifest.json','utf8')); console.log('valid JSON')"
npm run lint-schemas 2>&1 | tail -20
```

Expected: `valid JSON`; lint-schemas green (no new failures attributable to this manifest).

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/to-do/templates/Recurring.md platform/blueprints/to-do/manifest.json
git commit -m "feat(to-do): add the Recurring.md index page template"
```

---

### Task 9: `ToDoChromeBar` — repoint the "Recurring" nav button

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-chrome-bar.js`
- Test: none new (pure config-object diffing is awkward to unit-test meaningfully here; covered by the manual smoke pass in Task 12). If `run-task-entity.js` or a to-do-specific harness already asserts on `ToDoChromeBar._config()`'s shape, extend that assertion instead of skipping — check for an existing `ToDoChromeBar` test file first:

```bash
grep -rl "ToDoChromeBar" platform/test/*.js
```

If a harness like `run-todo-chrome-bar.js` exists (per the earlier grep in this cycle's investigation, it does), add cases there instead of skipping this task's tests. Read that file's existing pattern before adding.

- [ ] **Step 1: Write the failing tests**

Add to whichever harness `grep -rl "ToDoChromeBar" platform/test/*.js` reports (expected: `platform/test/run-todo-chrome-bar.js`) — first read its `loadClass`/`ok`/`assert` conventions (they mirror `run-task-entity.js`'s), then append:

```js
ok('TCB-recur-1 recurring dispatch opens the new Recurring.md index, not the raw registry', () => {
  const cfg = new ToDoChromeBarClass()._config();
  const opened = [];
  const fakeApp = { workspace: { openLinkText: (p) => opened.push(p) } };
  global.app = fakeApp;
  try {
    cfg.dispatch(null, { context: 'to-do' }, 'recurring');
  } finally { delete global.app; }
  assert(opened[0] === 'spice/to-do/Recurring.md', 'opens the new index page: ' + opened[0]);
});

ok('TCB-recur-2 detect() recognizes the new to-do-recurring-list page type', () => {
  const cfg = new ToDoChromeBarClass()._config();
  const ctx = cfg.detect(null, { type: 'to-do-recurring-list', file: { path: 'spice/to-do/Recurring.md' } });
  assert(ctx && ctx.context === 'to-do-recurring-list', 'detect returns the new context: ' + JSON.stringify(ctx));
  const spec = cfg.surfaceSpec(ctx);
  assert(spec.leaf === true, 'leaf surface (no create-button primary)');
  assert(spec.primary === null, 'no primary create button on a read-only index');
});
```

(Adapt variable names — `ToDoChromeBarClass`, `global.app` vs. whatever global the existing harness already uses for `app` — to match that file's established pattern; the assertions above are the important part, not the exact scaffolding.)

- [ ] **Step 2: Run to verify it fails**

```bash
node platform/test/run-todo-chrome-bar.js 2>&1 | grep -A1 "TCB-recur"
```

Expected: FAIL — `recurring` still opens `Recurring Tasks.md`; `to-do-recurring-list` isn't a recognized `detect()` type.

- [ ] **Step 3: Implement**

In `platform/blueprints/to-do/helpers/todo-chrome-bar.js`, the `detect` function (lines 23-30) currently reads:

```js
      detect: (dv, page) => {
        const t = page && page.type;
        if (t === "to-do") return { context: "to-do", path: (page.file && page.file.path) || "" };
        if (t === "to-do-hub") return { context: "to-do-hub", path: (page.file && page.file.path) || "" };
        if (t === "project-todo") return { context: "project-todo", path: (page.file && page.file.path) || "" };
        if (t === "to-do-recurring") return { context: "to-do-recurring", path: (page.file && page.file.path) || "" };
        return null;
      },
```

Add a branch for the new type (after `to-do-recurring`, keeping the old raw-registry type recognized too — the old file still exists as an inert backup and should still render SOME chrome if the user opens it manually):

```js
      detect: (dv, page) => {
        const t = page && page.type;
        if (t === "to-do") return { context: "to-do", path: (page.file && page.file.path) || "" };
        if (t === "to-do-hub") return { context: "to-do-hub", path: (page.file && page.file.path) || "" };
        if (t === "project-todo") return { context: "project-todo", path: (page.file && page.file.path) || "" };
        if (t === "to-do-recurring") return { context: "to-do-recurring", path: (page.file && page.file.path) || "" };
        if (t === "to-do-recurring-list") return { context: "to-do-recurring-list", path: (page.file && page.file.path) || "" };
        return null;
      },
```

In `surfaceSpec` (lines 31-68), the `to-do-recurring` branch (lines 57-66) currently reads:

```js
        if (ctx.context === "to-do-recurring") {
          return {
            primary: null,
            overflow: [
              { id: "all-todos", label: "All To-Dos", icon: ICON.list },
              { id: "completed-tasks", label: "Completed", icon: ICON.list },
            ],
            leaf: true,
          };
        }
        return { primary: null, overflow: [], leaf: false };
```

Add a new `to-do-recurring-list` branch right after it (same shape — it's a leaf index page with no primary create button):

```js
        if (ctx.context === "to-do-recurring") {
          return {
            primary: null,
            overflow: [
              { id: "all-todos", label: "All To-Dos", icon: ICON.list },
              { id: "completed-tasks", label: "Completed", icon: ICON.list },
            ],
            leaf: true,
          };
        }
        if (ctx.context === "to-do-recurring-list") {
          return {
            primary: null,
            overflow: [
              { id: "all-todos", label: "All To-Dos", icon: ICON.list },
              { id: "completed-tasks", label: "Completed", icon: ICON.list },
            ],
            leaf: true,
          };
        }
        return { primary: null, overflow: [], leaf: false };
```

Finally, in `dispatch` (lines 69-127), the `"recurring"` branch (lines 101-105) currently reads:

```js
        if (id === "recurring") {
          try { app.workspace.openLinkText("spice/to-do/Recurring Tasks.md", ""); }
          catch (e) { if (typeof Notice === "function") new Notice("Could not open Recurring Tasks: " + (e.message || e), 6000); }
          return;
        }
```

Change the target path to the new index page:

```js
        if (id === "recurring") {
          try { app.workspace.openLinkText("spice/to-do/Recurring.md", ""); }
          catch (e) { if (typeof Notice === "function") new Notice("Could not open Recurring: " + (e.message || e), 6000); }
          return;
        }
```

- [ ] **Step 4: Run to verify it passes**

```bash
node platform/test/run-todo-chrome-bar.js 2>&1 | grep -A1 "TCB-recur"
```

- [ ] **Step 5: Full harness + CJS-load gate**

```bash
node platform/test/run-todo-chrome-bar.js 2>&1 | tail -5
node platform/test/run-customjs-loadable.js 2>&1 | grep -i "todo-chrome-bar"
```

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-chrome-bar.js platform/test/run-todo-chrome-bar.js
git commit -m "feat(to-do): repoint the Recurring nav button at the new index page"
```

---

### Task 10: Migration heal — `applyRecurringTasksMigrationHeal`

**Files:**
- Modify: `platform/install.js`
- Test: covered by Task 11's seed-vault harness family (this heal's realistic behavior is exactly what the seed harness exists to verify end-to-end — a standalone unit test of the parsing regex would duplicate `ToDoDailyRecurring`'s own already-tested grammar, so this task's own "test" is the Task 11 seed fixture).

- [ ] **Step 1: Locate the call site**

Find where per-to-do-blueprint heals are invoked (the same list block read during this plan's research, around `platform/install.js:1261-1268`):

```bash
grep -n "await applyToDoBlueprintMigration\|await applyProjectTodoBackfill" platform/install.js
```

- [ ] **Step 2: Implement the heal**

Add this function near the other to-do-blueprint heals (e.g., right after `applyRecurringSentinelV070Migration`'s closing brace — search for `async function mergeDuplicateRecurringSections` to find the neighborhood):

```js
// applyRecurringTasksMigrationHeal — recurring-tasks note-per-task migration.
//
// Migrates every parseable entry in the legacy spice/to-do/Recurring
// Tasks.md registry into a real spice/tasks/*.md rolling recurring task
// note. Reads BOTH `- [ ] ...` (unchecked) AND `- [x] ...` (checked) lines —
// checking a registry line off was the OLD (broken) way a user tried to mark
// a day done under the pre-migration UI, not an intentional deactivation, so
// both forms migrate. UNGATED (runs every install) but fully idempotent: an
// entry with a task note ALREADY present at the same title is skipped, so
// repeat runs are a no-op. NEVER writes to or deletes the original registry
// file — it stays in place, untouched, as a passive backup. Never throws;
// every outcome is a failure-loud history entry.
async function applyRecurringTasksMigrationHeal(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "to-do") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const registryPath = "spice/to-do/Recurring Tasks.md";
  const registryExists = await adapter.exists(registryPath).catch(() => false);
  if (!registryExists) {
    history?.push({ event: "info", step: "recurring_tasks_migration_heal", name: "to-do",
      migrated: 0, skipped: 0, errors: [],
      reason: "no Recurring Tasks.md registry present",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  let registryContent;
  try { registryContent = await adapter.read(registryPath); }
  catch (e) {
    history?.push({ event: "error", step: "recurring_tasks_migration_heal", name: "to-do",
      reason: "could not read registry: " + (e && e.message),
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  const entries = _parseRecurringRegistry(registryContent);
  if (!entries.length) {
    history?.push({ event: "info", step: "recurring_tasks_migration_heal", name: "to-do",
      migrated: 0, skipped: 0, errors: [],
      reason: "registry has no parseable recurring entries",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  const tasksRoot = "spice/tasks";
  try { if (!(await adapter.exists(tasksRoot))) await adapter.mkdir(tasksRoot); } catch (_e) { /* tolerate */ }

  const nowIso = new Date().toISOString();
  const errors = [];
  let migrated = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.invalid) { skipped++; continue; }
    const filename = _sanitizeRecurringTitle(entry.title) + ".md";
    const path = tasksRoot + "/" + filename;
    let alreadyExists = false;
    try { alreadyExists = await adapter.exists(path); } catch (_e) { alreadyExists = false; }
    if (alreadyExists) { skipped++; continue; }

    const scheduled = _nextOccurrenceForHeal(entry.recurrence);
    const project = entry.project ? "[[" + entry.project + "]]" : "";
    const lines = [
      "---",
      "type: task",
      "title: " + entry.title,
      "status: open",
      "scheduled: " + (scheduled || ""),
      "due:",
      "recurrence: " + entry.recurrence,
      "priority: " + (entry.priority || ""),
      "project: " + project,
      "project_slug: " + (entry.projectSlug || ""),
      "source: migrated-from-registry",
      "source_note:",
      "links: []",
      "created_at: " + nowIso,
      "completed_at:",
      "---",
      "",
      "```dataviewjs",
      'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
      "```",
      "",
      "---",
      "",
      "```dataviewjs",
      'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });',
      "```",
      "",
      "---",
      "",
      "<!-- TASK_NOTES -->",
      "",
    ];
    try {
      await adapter.write(path, lines.join("\n"));
      migrated++;
    } catch (e) {
      errors.push({ title: entry.title, error: e && e.message });
    }
  }

  history?.push({ event: "info", step: "recurring_tasks_migration_heal", name: "to-do",
    migrated, skipped, errors,
    reason: migrated + " recurring task note(s) created from the legacy registry; " + skipped + " skipped (already migrated or unsupported grammar); registry left untouched at " + registryPath,
    git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
    completed_at: new Date().toISOString() });
}

// _parseRecurringRegistry — adapted from ToDoDailyRecurring.parseRegistryLine's
// grammar, EXTENDED to also match checked (`- [x] ...`) lines (see the design
// doc's "Checked-off lines" decision: a checked line was the user trying, and
// failing, to mark a day done — treat it the same as unchecked for migration
// purposes). Section-scoped the same way (`## Recurring Tasks` H2 OR the
// SectionLabel block form). Returns [{ title, recurrence, project, projectSlug,
// priority, invalid }]. Pure; never throws.
function _parseRecurringRegistry(content) {
  const lines = String(content == null ? "" : content).split("\n");
  let inSection = false;
  const entries = [];
  for (const line of lines) {
    if (/^## Recurring Tasks/.test(line) ||
      (/SectionLabel/.test(line) && /text:\s*["']Recurring Tasks["']/.test(line))) {
      inSection = true; continue;
    }
    if (inSection && (/^## /.test(line) ||
      (/SectionLabel/.test(line) && /text:\s*["']Last 7 days/.test(line)))) {
      inSection = false; continue;
    }
    if (!inSection) continue;
    // Match BOTH "- [ ] " and "- [x] " (case-insensitive on the x).
    const m = /^- \[([ xX])\] (.+)$/.exec(line);
    if (!m) continue;
    const rest = m[2];
    const fields = {};
    const fieldRe = /\[(\w+)::\s*([^\]]+(?:\]\][^\]]*)*)\]/g;
    let mm;
    while ((mm = fieldRe.exec(rest)) !== null) {
      let val = mm[2].trim();
      const wl = /^\[\[([^\]]+)\]\]$/.exec(val);
      if (wl) val = wl[1];
      fields[mm[1]] = val;
    }
    const title = rest.replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, "").trim();
    if (!title) continue;
    const recurrence = fields.recurrence || null;
    if (!recurrence) { entries.push({ title, invalid: true }); continue; }
    entries.push({
      title,
      recurrence,
      project: fields.project || null,
      projectSlug: fields.project ? _slugifyForHeal(fields.project) : null,
      priority: fields.priority || null,
      invalid: false,
    });
  }
  return entries;
}

function _slugifyForHeal(name) {
  return String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Human-readable filename base for a migrated task, same illegal-char strip as
// TaskEntity._sanitizeTitle (kept as a self-contained copy here since
// install.js runs in the Templater/Node context, not the browser customJS
// scope — no cross-import). Collisions are handled by the caller's
// `adapter.exists` pre-check (an existing note at that path is treated as
// "already migrated" and skipped, matching the idempotency contract).
function _sanitizeRecurringTitle(title) {
  const s = String(title == null ? "" : title)
    .replace(/[/\\:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return s === "" ? "Task" : s;
}

// _nextOccurrenceForHeal — a SELF-CONTAINED (no window/customJS dependency)
// reimplementation of the 4 supported RecurrenceParser grammar families,
// walking forward from TODAY (never returning today itself) so a freshly
// migrated task never lands already-overdue. Unsupported grammar -> null
// (the task note still gets created with `recurrence` set and an EMPTY
// `scheduled`, so it's visible on the new Recurring.md index for the user to
// fix by hand, rather than silently dropped). Mirrors
// ToDoDailyRecurring._fallbackRecurrenceMatch's grammar exactly.
function _nextOccurrenceForHeal(recurrence) {
  const g = String(recurrence == null ? "" : recurrence).trim().toLowerCase();
  if (!g.startsWith("every ")) return null;
  const tail = g.slice(6).trim();
  const dayMap = {
    sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5, saturday: 6, sat: 6,
  };
  const toDaySet = (text) => {
    const tokens = text.split(/[\s,]+/).filter(Boolean);
    if (!tokens.length) return null;
    const out = new Set();
    for (const t of tokens) {
      if (!Object.prototype.hasOwnProperty.call(dayMap, t)) return null;
      out.add(dayMap[t]);
    }
    return out;
  };
  const matches = (dow, dom) => {
    if (tail === "day") return true;
    if (tail === "weekday" || tail === "weekdays") return dow >= 1 && dow <= 5;
    if (tail === "weekend" || tail === "weekends") return dow === 0 || dow === 6;
    const m1 = tail.match(/^(\d{1,2})(?:st|nd|rd|th)? of (?:the )?month$/);
    if (m1) return dom === +m1[1];
    // "every N weeks on X" needs an anchor we don't have at migration time —
    // unsupported for the heal (falls through to the plain weekday-set check
    // below, which is WRONG for this family, so explicitly bail instead).
    if (/^\d+\s+weeks?\s+on\s+/.test(tail)) return false;
    const days = toDaySet(tail);
    return days ? days.has(dow) : false;
  };
  const startMs = Date.now();
  const DAY_MS = 86400000;
  for (let i = 1; i <= 400; i++) {
    const d = new Date(startMs + i * DAY_MS);
    if (matches(d.getUTCDay(), d.getUTCDate())) {
      const p = (n) => String(n).padStart(2, "0");
      return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
    }
  }
  return null;
}
```

Now add the call site. Right after the existing to-do heal chain (near `platform/install.js:1268`, immediately after `applyProjectTodoSectionReorderHeal`'s call, or — more precisely — right after the existing to-do-scoped calls at lines 1261-1264), insert:

```js
  await applyRecurringTasksMigrationHeal(tp, mech, variables, history, git);   // NEW recurring-tasks cycle — migrates legacy Recurring Tasks.md registry entries (checked + unchecked) into real rolling spice/tasks/*.md notes; ungated (idempotent via per-title exists-check), never touches/deletes the original registry
```

Confirm the exact variable name in scope at that call site (`mech` vs `manifest`) by reading the surrounding lines — mirror whatever the neighboring `applyToDoBlueprintMigration(tp, mech, variables, history, git)` call uses verbatim.

- [ ] **Step 3: Manual smoke against a throwaway copy of a live registry**

This heal touches real user data shapes; before trusting it, dry-run it against copies of the actual registry content found in this cycle's investigation (do NOT touch the real consumer vaults yet — that happens in Task 12's deploy step). Create a scratch script:

```bash
node -e "
const install = require('./platform/install.js');
" 2>&1 | head -5
```

(This just confirms `install.js` still loads without a syntax error after the edit — `install.js` exports a single `module.exports = async function (tp) {...}`, so a full manual invocation needs a real `tp`; the REAL verification of this heal's behavior is Task 11's seed-vault fixture, which exercises it end-to-end. This step is a cheap syntax sanity check only.)

- [ ] **Step 4: Commit**

```bash
git add platform/install.js
git commit -m "feat(to-do): migrate legacy Recurring Tasks.md registry entries into task notes"
```

---

### Task 11: Seed-vault fixture + `HC-V0202-SEED-MIGRATE-RECURRING-*` harness family

**Files:**
- Create: `platform/test/seed-vault/spice/to-do/Recurring Tasks.md` (sanctioned seed edit — new migration, per `Docs/agent-guides/migration-regression-net.md` § Per-cycle authoring loop)
- Modify: `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Add the pre-migration fixture**

Read `Docs/agent-guides/migration-regression-net.md` in full before touching the seed (already read during this plan's research — re-read if executing this task in a fresh context). Create `platform/test/seed-vault/spice/to-do/Recurring Tasks.md`:

```markdown
---
type: to-do-recurring
tags:
  - "seed"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Recurring Tasks", top: true }] });
```

- [ ] Water the plants [recurrence:: every day]
- [x] Take out trash [recurrence:: every Monday]

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Last 7 days of materialization" }] });
```

| Date | Title | Routed to |
| --- | --- | --- |
```

This mirrors the REAL shapes found live in this cycle's investigation: one unchecked entry ("Water the plants", matching accuris's shape) and one CHECKED entry ("Take out trash", matching headspace's broken "Pay Rent"/"Feed the dogs" shape) — the harness needs to see BOTH forms to verify the migration heal's "checked lines migrate too" behavior.

- [ ] **Step 2: Add the assert family**

In `platform/test/run-seed-migrations.js`, find the end of the existing assert families (search for the last `HC-V0` family in the file) and append a new one:

```js
// ===== HC-V0202-SEED-MIGRATE-RECURRING-* — applyRecurringTasksMigrationHeal =====
const waterTask = helpers.readNote(vault, "spice/tasks/Water the plants.md");
ok(
    "HC-V0202-SEED-MIGRATE-RECURRING-1 unchecked registry entry migrated to a task note",
    waterTask != null
);
if (waterTask != null) {
    const { frontmatter: waterFm } = helpers.parseFrontmatter(waterTask);
    ok(
        "HC-V0202-SEED-MIGRATE-RECURRING-2 migrated task carries the recurrence grammar",
        waterFm.recurrence === "every day"
    );
    ok(
        "HC-V0202-SEED-MIGRATE-RECURRING-3 migrated task is open with a scheduled date (not overdue-blank)",
        waterFm.status === "open" && typeof waterFm.scheduled === "string" && /^\d{4}-\d{2}-\d{2}$/.test(waterFm.scheduled)
    );
}

const trashTask = helpers.readNote(vault, "spice/tasks/Take out trash.md");
ok(
    "HC-V0202-SEED-MIGRATE-RECURRING-4 CHECKED registry entry ALSO migrated (the checkbox-kills-recurrence bug fix)",
    trashTask != null
);
if (trashTask != null) {
    const { frontmatter: trashFm } = helpers.parseFrontmatter(trashTask);
    ok(
        "HC-V0202-SEED-MIGRATE-RECURRING-5 checked-entry migration carries the recurrence grammar too",
        trashFm.recurrence === "every Monday"
    );
}

const registryStillThere = helpers.readNote(vault, "spice/to-do/Recurring Tasks.md");
ok(
    "HC-V0202-SEED-MIGRATE-RECURRING-6 original registry file left untouched (still exists)",
    registryStillThere != null && registryStillThere.includes("Water the plants")
);
```

- [ ] **Step 3: Local verification**

```bash
node platform/test/run-seed-migrations.js 2>&1 | grep -A1 "RECURRING"
```

Expected: all 6 new sub-asserts `ok`.

- [ ] **Step 4: Idempotency check (part of the existing IDEMP-* family, no new assert needed)**

```bash
node platform/test/run-seed-migrations.js 2>&1 | grep -i "IDEMP"
```

Expected: still green — running install twice must NOT create a second copy of "Water the plants.md" or "Take out trash.md" (the heal's `adapter.exists` pre-check is what guarantees this; if IDEMP fails here, the heal has a bug — do not proceed to Step 5 until this is green).

- [ ] **Step 5: Full local verification**

```bash
npm run release:preflight
```

Expected: fully green (all ~32+ harnesses).

- [ ] **Step 6: Commit**

```bash
git add "platform/test/seed-vault/spice/to-do/Recurring Tasks.md" platform/test/run-seed-migrations.js
git commit -m "test(to-do): add seed-vault coverage for the recurring-tasks migration heal"
```

---

### Task 12: Ship it — preflight, PR, CI, merge, release, tap, brew, deploy

This is the end-to-end release runbook, not a code task. Run every step; do not skip ahead on a red result — stop and fix instead. This task assumes the user has explicitly pre-authorized every write action below (merging the feature PR after CI green, merging the tap PR, deploying to accuris-sauce/ero-sauce/headspace-sauce) — see the design doc's origin conversation. If that authorization is not present when this plan is executed standalone, STOP and ask before merging or deploying.

- [ ] **Step 1: Final local preflight on the feature branch**

```bash
git status   # expect: clean
npm run release:preflight
```

Expected: fully green. Fix and re-commit before continuing if not.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: recurring tasks (rolling model, replaces broken registry)" --body "$(cat <<'EOF'
## Summary
- Replaces the disconnected, broken Recurring Tasks.md registry with a `recurrence` field on the note-per-task model
- Recurring tasks roll their `scheduled` date forward on completion instead of archiving (single rolling note, no per-occurrence file proliferation)
- New free-text recurrence field on the task dialog (create + edit), reusing the existing RecurrenceParser grammar
- New repeat-icon badge on task rows + a "Repeats" row on the task note card
- New Recurring.md live index page replaces the raw-markdown registry as the discovery surface
- Install-time heal migrates every consumer's existing registry entries (including headspace's checkbox-bug-broken entries) into real task notes; the original registry file is left untouched as a backup

See `Docs/plans/2026-07-08-recurring-tasks-design.md` for the full root-cause investigation and design rationale.

## Test plan
- [x] `npm run release:preflight` green locally
- [x] New seed-vault migration coverage (`HC-V0202-SEED-MIGRATE-RECURRING-*`)
- [ ] CI green on macOS + Ubuntu
EOF
)"
```

- [ ] **Step 3: Wait for CI, merge once green**

```bash
gh pr checks --watch
```

When both `preflight (macos-latest)` and `preflight (ubuntu-latest)` are green:

```bash
gh pr merge --squash --auto
```

If CI goes red instead: read the failure, fix on the branch, push, and re-watch — do not merge red.

- [ ] **Step 4: Wait for the automated release PR to auto-merge**

The bumper opens a standing release PR on merge to `main` and enables GitHub auto-merge on it — no manual action. Poll for it:

```bash
gh pr list --search "chore(release)" --state all --limit 5
```

Wait until the most recent `chore(release): vX.Y.Z` PR shows `MERGED`. This also triggers `tag-and-ship`, which tags `v<X.Y.Z>` and opens the homebrew-tap PR.

- [ ] **Step 5: Wait for the tap PR, merge it**

```bash
gh pr list --repo willfell/homebrew-sauce --state open --limit 5
```

`tag-and-ship` normally auto-merges the tap PR itself (`TAP_PR_TOKEN`). If it's still open after a few minutes, merge it explicitly (user has pre-authorized this):

```bash
gh pr merge --repo willfell/homebrew-sauce --squash --admin <PR_NUMBER>
```

- [ ] **Step 6: `brew upgrade sauce` locally**

```bash
brew update
brew upgrade sauce
sauce --version
```

Expected: the new version.

- [ ] **Step 7: Deploy to the 3 consumer vaults**

This is an already-subscribed mechanism/blueprint version bump (not a new component), so `--bump-pins` is sufficient — no `platform-subscription.json` hand-edits needed (per `Docs/agent-guides/build-test-verify.md` § Deploying a NEW mechanism, that hand-edit path is only for a *newly-added* component; `task-entity` and `to-do` are already subscribed everywhere).

```bash
cd /Users/willfellhoelter/notes/sauce/accuris-sauce
sauce update --bump-pins
sauce status

cd /Users/willfellhoelter/notes/sauce/ero-sauce
sauce update --bump-pins
sauce status

cd /Users/willfellhoelter/notes/sauce/headspace-sauce
sauce update --bump-pins
sauce status
```

Expected on each: exit 0, `Drift: none`, `git head` matching the workshop's new tag.

- [ ] **Step 8: Verify the migration heal actually ran against the real data found in this cycle's investigation**

```bash
grep -l "Water the plants" /dev/null 2>/dev/null; true   # no-op guard, ignore
ls "/Users/willfellhoelter/notes/sauce/accuris-sauce/spice/tasks/" | grep -i "test recurring\|another test recurring\|Monitor this Dashboard\|get your life together"
ls "/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/tasks/" | grep -i "Pay Rent\|Feed the dogs"
```

Expected: real task notes now exist under `spice/tasks/` for accuris's and headspace's registry entries (headspace's "Pay Rent" and "Feed the dogs" — the ones the checkbox bug had killed — should be present and OPEN). ero-sauce's registry was empty, so no output there is expected/correct.

- [ ] **Step 9: Cycle-close artifacts**

Per `Docs/agent-guides/build-test-verify.md` § Cycle-close artifacts, write (in the now-released workshop repo, on a fresh small commit to `main` or a follow-up PR — these are docs-only, low-risk):
1. `Docs/plans/2026-07-08-recurring-tasks-result.md` — what shipped, the exact version, surfaces touched, NEW lessons (the checkbox-kills-recurrence bug; the v0.8.0 live-render-has-no-completion-affordance finding), carry-forward items (Feature 2 — subtasks — still pending its own design session).
2. `Docs/cycle-history.md` — append the `## v<X.Y.Z> recurring-tasks CLOSED 2026-07-08` section.
3. `Docs/agent-guides/cycle-status.md` — bump the recorded workshop_version + mechanism/blueprint/harness pointers.
4. `Docs/install.md` — "Upgrading from vX.Y.Z" note (mentions the registry migration + the new Recurring.md page).

Fill in the actual shipped version number (from Step 4/6) rather than a placeholder.

- [ ] **Step 10: Report back**

Only after Steps 1-9 all show green/complete: summarize to the user what shipped, the version number, the vaults confirmed deployed, and the recovered task counts from Step 8.

---

## Out of scope (unchanged from the design doc)

- Subtasks within a task note — separate plan, from `Docs/plans/2026-07-08-subtasks-design.md` (to be written in a follow-up brainstorming session).
- Per-occurrence completion history for a recurring task.
- A structured (non-text) recurrence picker UI.
