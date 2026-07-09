# Recurrence Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the task dialog's free-text "Repeats" grammar field with a structured picker (frequency dropdown + contextual day-of-week / day-of-month controls) that composes the same `RecurrenceParser` grammar string the backend already understands.

**Architecture:** Two new pure statics on `RecurrenceParser` (`describe`) and `TaskDialog` (`_composeRecurrenceGrammar`, `_recurrenceStateFromDescribe`, `_recurrencePickerValid`, `_ordinalSuffix`) do all the string-building/parsing logic and are fully Node-testable. The dialog's `_render` method is rewired to use them — the frontmatter schema, `RecurrenceParser.matches`/`isSupported`, `TaskEntity.nextOccurrence`, and the install heal are untouched.

**Tech Stack:** CustomJS bare classes (Obsidian), plain DOM (no framework), Node `run-*.js` harnesses (zero test-runner dependency, `assert`/`ok` pattern).

---

### Task 1: `RecurrenceParser.describe()` — public reverse-mapping API

**Files:**
- Modify: `platform/blueprints/to-do/helpers/recurrence-parser.js:36` (instance delegators) and after line 89 (`isSupported`, before the `_parse` internal section)
- Test: `platform/test/run-recurrence-parser.js`

- [ ] **Step 1: Write the failing tests**

Append to `platform/test/run-recurrence-parser.js`, right before the `// ===== INSTANCE path` section (before line 143's `(() => {`):

```javascript
// ===== describe() — public reverse-mapping for the dialog's picker UI — RP-37..RP-46 =====
ok('RP-37 describe("every day") -> {kind: daily}',
    JSON.stringify(RecurrenceParser.describe('every day')) === JSON.stringify({ kind: 'daily' }));
ok('RP-38 describe("every weekday") -> {kind: weekday-block}',
    JSON.stringify(RecurrenceParser.describe('every weekday')) === JSON.stringify({ kind: 'weekday-block' }));
ok('RP-39 describe("every weekend") -> {kind: weekend-block}',
    JSON.stringify(RecurrenceParser.describe('every weekend')) === JSON.stringify({ kind: 'weekend-block' }));
ok('RP-40 describe("every 15th of month") -> {kind: day-of-month, day: 15}',
    JSON.stringify(RecurrenceParser.describe('every 15th of month')) === JSON.stringify({ kind: 'day-of-month', day: 15 }));
ok('RP-41 describe("every Mon Wed Fri") -> {kind: weekday-set, days: [1,3,5]} (sorted)',
    JSON.stringify(RecurrenceParser.describe('every Fri Mon Wed')) === JSON.stringify({ kind: 'weekday-set', days: [1, 3, 5] }));
ok('RP-42 describe("every 2 weeks on Friday") -> {kind: every-n-weeks-on-day, weeks: 2, days: [5]}',
    JSON.stringify(RecurrenceParser.describe('every 2 weeks on Friday')) === JSON.stringify({ kind: 'every-n-weeks-on-day', weeks: 2, days: [5] }));
ok('RP-43 describe("") -> null', RecurrenceParser.describe('') === null);
ok('RP-44 describe(null) -> null', RecurrenceParser.describe(null) === null);
ok('RP-45 describe("garbage") -> null', RecurrenceParser.describe('garbage') === null);
ok('RP-46 instance describe() agrees with static',
    JSON.stringify(new RecurrenceParser().describe('every day')) === JSON.stringify(RecurrenceParser.describe('every day')));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node platform/test/run-recurrence-parser.js`
Expected: `FAIL RP-37 ...` through `RP-46` (TypeError: `RecurrenceParser.describe is not a function`), other tests still pass.

- [ ] **Step 3: Implement `describe()`**

In `platform/blueprints/to-do/helpers/recurrence-parser.js`, add the instance delegator at line 36 (right after `isSupported`, before `matches`):

```javascript
    describe(grammar) { return RecurrenceParser.describe(grammar); }

```

Then add the static, right after the `isSupported` static (after line 89, before the `// ---------- Internal: pure parse to a structured form ----------` comment at line 91):

```javascript
    /**
     * Reverse-map a grammar string into a plain, JSON-serializable shape for
     * UI consumers (the dialog's structured recurrence picker):
     *   { kind: 'daily' }
     *   { kind: 'weekday-block' }               (every weekday)
     *   { kind: 'weekend-block' }                (every weekend)
     *   { kind: 'day-of-month', day: 1..31 }
     *   { kind: 'weekday-set', days: [0..6] }    (days sorted Sun..Sat)
     *   { kind: 'every-n-weeks-on-day', weeks: N, days: [0..6] }
     *   null                                     (empty / unsupported grammar)
     * A thin, public wrapper over the internal _parse() — days come back as a
     * sorted array (not a Set) so this round-trips through JSON. Pure, never
     * throws (delegates entirely to _parse's own guards).
     */
    static describe(grammar) {
        const parsed = RecurrenceParser._parse(grammar);
        if (!parsed) return null;
        const out = { kind: parsed.kind };
        if (parsed.days instanceof Set) out.days = Array.from(parsed.days).sort((a, b) => a - b);
        if (typeof parsed.weeks === 'number') out.weeks = parsed.weeks;
        if (typeof parsed.day === 'number') out.day = parsed.day;
        return out;
    }

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-recurrence-parser.js`
Expected: `Tests: 46/46`

- [ ] **Step 5: Verify the bare-class loader still accepts the file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: no new failures (RecurrenceParser already registers; this only adds methods to it).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/to-do/helpers/recurrence-parser.js platform/test/run-recurrence-parser.js
git commit -m "feat: RecurrenceParser.describe() — reverse-map a grammar string for UI pickers"
```

---

### Task 2: `TaskDialog._composeRecurrenceGrammar()` + `_ordinalSuffix()`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (add near the other pure static helpers, e.g. right after `_slugify` — currently ends around line 127)
- Modify: `platform/mechanisms/task-entity/task-dialog.js:59` (instance delegators — add after `_moreOptionsShouldStartExpanded`)
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

Append to `platform/test/run-task-entity.js`, right after the existing `TD-polish-3` block (after line 520's closing `});`):

```javascript
// ---------- TaskDialog._composeRecurrenceGrammar (pure) ----------
//
// Builds the RecurrenceParser grammar string from the picker's structured
// state: { days: [0..6], weeks: N, dayOfMonth: 1..31 }. Days are deduped +
// sorted Sun..Sat so click order never affects the composed string.

ok('CRG-1 none -> empty string', () => {
  assert(TaskDialog._composeRecurrenceGrammar('none', {}) === '', 'none -> ""');
});

ok('CRG-2 daily -> "every day"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('daily', {}) === 'every day');
});

ok('CRG-3 weekday -> "every weekday"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekday', {}) === 'every weekday');
});

ok('CRG-4 monthly with dayOfMonth=15 -> "every 15th of month"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 15 }) === 'every 15th of month');
});

ok('CRG-5 monthly ordinal suffixes: 1st/2nd/3rd/4th/11th/21st', () => {
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 1 }) === 'every 1st of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 2 }) === 'every 2nd of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 3 }) === 'every 3rd of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 4 }) === 'every 4th of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 11 }) === 'every 11th of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 21 }) === 'every 21st of month');
});

ok('CRG-6 monthly with missing/invalid dayOfMonth -> empty string', () => {
  assert(TaskDialog._composeRecurrenceGrammar('monthly', {}) === '', 'no dayOfMonth -> ""');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 0 }) === '', '0 out of range -> ""');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 32 }) === '', '32 out of range -> ""');
});

ok('CRG-7 weekly single day, weeks=1 -> "every Mon"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [1], weeks: 1 }) === 'every Mon');
});

ok('CRG-8 weekly multi-day sorted regardless of input order -> "every Mon Wed Fri"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [5, 1, 3], weeks: 1 }) === 'every Mon Wed Fri');
});

ok('CRG-9 weekly with weeks>1 -> "every N weeks on ..."', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [5], weeks: 2 }) === 'every 2 weeks on Fri');
});

ok('CRG-10 weekly with weeks=1 (explicit) omits the "N weeks on" wrapper', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [0, 6], weeks: 1 }) === 'every Sun Sat');
});

ok('CRG-11 weekly with zero days -> empty string (guards against "every ")', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [], weeks: 1 }) === '');
  assert(TaskDialog._composeRecurrenceGrammar('weekly', {}) === '', 'missing days array -> ""');
});

ok('CRG-12 weekly de-dupes repeated day values', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [1, 1, 1], weeks: 1 }) === 'every Mon');
});

ok('CRG-13 round-trips through RecurrenceParser.matches for every composed kind', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const RP = new RecurrenceParserClass();
  const mon = { day: () => 1, date: () => 15 };
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('daily', {}), mon) === true, 'daily fires');
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('weekday', {}), mon) === true, 'weekday fires on Mon');
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('weekly', { days: [1], weeks: 1 }), mon) === true, 'weekly Mon fires on Mon');
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 15 }), mon) === true, 'monthly 15th fires on the 15th');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node platform/test/run-task-entity.js`
Expected: `FAIL CRG-1 ...` through `CRG-13` (TypeError: `TaskDialog._composeRecurrenceGrammar is not a function`), everything else still passes.

- [ ] **Step 3: Implement `_composeRecurrenceGrammar()` + `_ordinalSuffix()`**

In `platform/mechanisms/task-entity/task-dialog.js`, add right after `_slugify` (currently ends at line 127, right before the `_recurrenceValidity` docstring at line 129):

```javascript
    /**
     * Compose a RecurrenceParser grammar string from the dialog's structured
     * picker state. `freq` is one of 'none' | 'daily' | 'weekday' | 'weekly' |
     * 'monthly'; `opts.days` is an array of 0(Sun)..6(Sat), `opts.weeks` is the
     * "every N weeks" interval (weekly only, N<=1 omits the wrapper),
     * `opts.dayOfMonth` is 1..31 (monthly only). Days are de-duped, filtered to
     * 0..6, and sorted Sun..Sat so click order never affects the output — the
     * composed string is deterministic. Weekly with zero valid days, or
     * monthly with an out-of-range/missing day, both return "" (never a
     * malformed "every " with nothing after it). Pure, never throws.
     */
    static _composeRecurrenceGrammar(freq, opts) {
        const o = opts || {};
        switch (freq) {
            case 'daily':
                return 'every day';
            case 'weekday':
                return 'every weekday';
            case 'monthly': {
                const day = parseInt(o.dayOfMonth, 10);
                if (!Number.isInteger(day) || day < 1 || day > 31) return '';
                return 'every ' + day + TaskDialog._ordinalSuffix(day) + ' of month';
            }
            case 'weekly': {
                const raw = Array.isArray(o.days) ? o.days : [];
                const uniq = Array.from(new Set(raw.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
                if (uniq.length === 0) return '';
                const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const dayNames = uniq.map((d) => DOW_NAMES[d]).join(' ');
                const weeks = parseInt(o.weeks, 10);
                if (Number.isInteger(weeks) && weeks > 1) return 'every ' + weeks + ' weeks on ' + dayNames;
                return 'every ' + dayNames;
            }
            case 'none':
            default:
                return '';
        }
    }

    /** English ordinal suffix for a day-of-month number (1st, 2nd, 3rd, 4th..11th..21st..). */
    static _ordinalSuffix(n) {
        const v = n % 100;
        if (v >= 11 && v <= 13) return 'th';
        switch (n % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }

```

Also add the instance delegators at line 59 (right after `_moreOptionsShouldStartExpanded`'s delegator):

```javascript
    _composeRecurrenceGrammar(freq, opts) { return TaskDialog._composeRecurrenceGrammar(freq, opts); }
    _ordinalSuffix(n) { return TaskDialog._ordinalSuffix(n); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-task-entity.js`
Expected: all `CRG-*` pass, total pass count increased by 13, no prior test regressed.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat: TaskDialog._composeRecurrenceGrammar — build grammar string from picker state"
```

---

### Task 3: `TaskDialog._recurrenceStateFromDescribe()` + `_recurrencePickerValid()`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (add right after the new `_ordinalSuffix`, before the `_recurrenceValidity` docstring at line 129)
- Modify: `platform/mechanisms/task-entity/task-dialog.js:59` (instance delegators)
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing tests**

Append to `platform/test/run-task-entity.js`, right after the `CRG-13` block:

```javascript
// ---------- TaskDialog._recurrenceStateFromDescribe (pure) ----------
//
// Reverse-maps RecurrenceParser.describe()'s output into the picker's initial
// UI state, for edit-mode hydration.

ok('RSD-1 null (no recurrence) -> freq none, all blank', () => {
  const s = TaskDialog._recurrenceStateFromDescribe(null);
  assert(s.freq === 'none' && s.days.length === 0 && s.weeks === 1 && s.dayOfMonth === null, JSON.stringify(s));
});

ok('RSD-2 {kind: daily} -> freq daily', () => {
  assert(TaskDialog._recurrenceStateFromDescribe({ kind: 'daily' }).freq === 'daily');
});

ok('RSD-3 {kind: weekday-block} -> freq weekday', () => {
  assert(TaskDialog._recurrenceStateFromDescribe({ kind: 'weekday-block' }).freq === 'weekday');
});

ok('RSD-4 {kind: weekend-block} -> freq weekly, days [0,6]', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'weekend-block' });
  assert(s.freq === 'weekly' && JSON.stringify(s.days) === JSON.stringify([0, 6]), JSON.stringify(s));
});

ok('RSD-5 {kind: day-of-month, day: 15} -> freq monthly, dayOfMonth 15', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'day-of-month', day: 15 });
  assert(s.freq === 'monthly' && s.dayOfMonth === 15, JSON.stringify(s));
});

ok('RSD-6 {kind: weekday-set, days: [1,3,5]} -> freq weekly, weeks 1', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'weekday-set', days: [1, 3, 5] });
  assert(s.freq === 'weekly' && JSON.stringify(s.days) === JSON.stringify([1, 3, 5]) && s.weeks === 1, JSON.stringify(s));
});

ok('RSD-7 {kind: every-n-weeks-on-day, weeks: 2, days: [5]} -> freq weekly, weeks 2', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'every-n-weeks-on-day', weeks: 2, days: [5] });
  assert(s.freq === 'weekly' && s.weeks === 2 && JSON.stringify(s.days) === JSON.stringify([5]), JSON.stringify(s));
});

// ---------- TaskDialog._recurrencePickerValid (pure) ----------
//
// Gates Save: the only structurally-invalid picker state is Weekly with zero
// days selected (would silently compose to "" — i.e. "doesn't repeat", not
// what picking Weekly implied).

ok('RPV-1 non-weekly freq is always valid', () => {
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'none' }) === true);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'daily' }) === true);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekday' }) === true);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'monthly', recurrenceDayOfMonth: null }) === true);
});

ok('RPV-2 weekly with at least one day is valid', () => {
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekly', recurrenceDays: [1] }) === true);
});

ok('RPV-3 weekly with zero days is invalid', () => {
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekly', recurrenceDays: [] }) === false);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekly' }) === false, 'missing recurrenceDays -> invalid');
});

ok('RPV-4 tolerates a missing/null state', () => {
  assert(TaskDialog._recurrencePickerValid(null) === true, 'null state -> valid (freq defaults away from weekly)');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node platform/test/run-task-entity.js`
Expected: `FAIL RSD-1 ...` through `RPV-4` (TypeErrors — both statics don't exist yet).

- [ ] **Step 3: Implement both statics**

In `platform/mechanisms/task-entity/task-dialog.js`, add right after `_ordinalSuffix` (added in Task 2), before the existing `_recurrenceValidity` docstring:

```javascript
    /**
     * Reverse-map RecurrenceParser.describe()'s output into the picker's
     * initial UI state — { freq, days, weeks, dayOfMonth } — for hydrating
     * the dialog when editing a task that already has a recurrence. A `null`
     * input (no recurrence, or an unsupported/legacy grammar) maps to
     * freq: 'none' with everything blank, never throws.
     */
    static _recurrenceStateFromDescribe(described) {
        const BLANK = { freq: 'none', days: [], weeks: 1, dayOfMonth: null };
        if (!described) return BLANK;
        switch (described.kind) {
            case 'daily':
                return Object.assign({}, BLANK, { freq: 'daily' });
            case 'weekday-block':
                return Object.assign({}, BLANK, { freq: 'weekday' });
            case 'weekend-block':
                return Object.assign({}, BLANK, { freq: 'weekly', days: [0, 6] });
            case 'day-of-month':
                return Object.assign({}, BLANK, { freq: 'monthly', dayOfMonth: described.day || null });
            case 'weekday-set':
                return Object.assign({}, BLANK, { freq: 'weekly', days: Array.isArray(described.days) ? described.days.slice() : [] });
            case 'every-n-weeks-on-day':
                return Object.assign({}, BLANK, {
                    freq: 'weekly',
                    days: Array.isArray(described.days) ? described.days.slice() : [],
                    weeks: described.weeks || 1,
                });
            default:
                return BLANK;
        }
    }

    /**
     * Gate for Save: the only structurally-invalid picker state is Weekly
     * with zero days toggled (which would silently compose to "" — i.e.
     * "doesn't repeat" — contradicting the user's choice of Weekly). Every
     * other frequency is always valid. Pure, never throws.
     */
    static _recurrencePickerValid(state) {
        const s = state || {};
        if (s.recurrenceFreq !== 'weekly') return true;
        return Array.isArray(s.recurrenceDays) && s.recurrenceDays.length > 0;
    }

```

Add the instance delegators right after `_ordinalSuffix`'s delegator (added in Task 2):

```javascript
    _recurrenceStateFromDescribe(described) { return TaskDialog._recurrenceStateFromDescribe(described); }
    _recurrencePickerValid(state) { return TaskDialog._recurrencePickerValid(state); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-task-entity.js`
Expected: all `RSD-*`/`RPV-*` pass, total pass count increased by 11.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat: TaskDialog edit-mode hydration + picker validity gate for recurrence"
```

---

### Task 4: Rewire the dialog's Repeats UI + delete the free-text path

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (several spots — see below)
- Test: `platform/test/run-task-entity.js`

This task deletes the old free-text field entirely (no fallback/shim — nothing else in the codebase calls `_recurrenceValidity` or reads `recurError`; confirmed by `grep -rn "_recurrenceValidity\|recurError" platform/` returning only the 3 call sites this task removes) and replaces it with the structured picker, wiring the four new statics from Tasks 1-3.

- [ ] **Step 1: Confirm nothing else references the code being deleted**

Run: `grep -rn "_recurrenceValidity\|recurError" /Users/willfellhoelter/projects/repos/sauce/.claude/worktrees/bridge-cse_01BsjDJDRLgTtUg27iTBYVgC/platform/`
Expected: only the 3 in-file occurrences inside `task-dialog.js` (the static definition at line 139, its instance delegator at line 57, and the two call sites at lines 711 and 1021) — nothing in any other file.

- [ ] **Step 2: Delete the `_recurrenceValidity` static and its instance delegator**

Remove line 57 (`_recurrenceValidity(recurrence, isSupportedFn) { return TaskDialog._recurrenceValidity(recurrence, isSupportedFn); }`) entirely.

Remove the whole `_recurrenceValidity` static — the full doc comment + method body currently at lines 129-146 (from `/**\n     * Validate a recurrence grammar string...` through the closing `    }` right before `_moreOptionsShouldStartExpanded`'s docstring).

- [ ] **Step 3: Replace the free-text Repeats block with the structured picker**

Find this exact block in `_render` (currently starting with the `// Recurrence — free-text grammar` comment, right after `setMoreExpanded`/`moreBox` are created, and ending right before the `// Priority chip row` comment):

```javascript
        // Recurrence — free-text grammar (RecurrenceParser), validated live.
        // Empty = one-shot task (default). A supported grammar makes "Done"
        // roll the task's due date forward instead of archiving it.
        label('Repeats (optional — e.g. "every day", "every Monday", "every 2 weeks on Friday")', moreBox);
        const recurInput = moreBox.createEl('input', { type: 'text' });
        recurInput.style.cssText = fieldCss;
        recurInput.value = state.recurrence;
        recurInput.placeholder = 'every day';
        const recurError = moreBox.createEl('div');
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

Replace it with:

```javascript
        // Repeats — structured picker (dropdown + contextual day-of-week /
        // day-of-month controls). Composes the SAME RecurrenceParser grammar
        // string the backend already understands (TaskEntity.nextOccurrence,
        // _markDone's roll-forward) — no schema change, this is purely a
        // front-end grammar builder. state.recurrence stays the source of
        // truth written to frontmatter; state.recurrenceFreq/Days/Weeks/
        // DayOfMonth are picker-only UI state, recomposed on every change.
        label('Repeats (optional)', moreBox);
        {
            const described = (() => {
                try {
                    const RP = window.customJS && window.customJS.RecurrenceParser;
                    return RP && typeof RP.describe === 'function' ? RP.describe(state.recurrence) : null;
                } catch (_e) { return null; }
            })();
            const initial = TaskDialog._recurrenceStateFromDescribe(described);
            state.recurrenceFreq = initial.freq;
            state.recurrenceDays = initial.days;
            state.recurrenceWeeks = initial.weeks;
            state.recurrenceDayOfMonth = initial.dayOfMonth;
        }

        const recurSelect = moreBox.createEl('select');
        recurSelect.style.cssText = fieldCss;
        const RECUR_OPTIONS = [
            { value: 'none', text: "Doesn't repeat" },
            { value: 'daily', text: 'Every day' },
            { value: 'weekly', text: 'Weekly' },
            { value: 'weekday', text: 'Every weekday' },
            { value: 'monthly', text: 'Monthly' },
        ];
        for (const ro of RECUR_OPTIONS) {
            const opt = recurSelect.createEl('option', { text: ro.text });
            opt.value = ro.value;
            if (ro.value === state.recurrenceFreq) opt.selected = true;
        }

        const recurSubBox = moreBox.createDiv();
        recurSubBox.style.cssText = 'margin-top:8px;';
        const recurError = moreBox.createEl('div');
        recurError.style.cssText = 'font-size:11px; color:var(--text-error,#e05561); margin-top:4px; display:none;';

        const recomposeRecurrence = () => {
            state.recurrence = TaskDialog._composeRecurrenceGrammar(state.recurrenceFreq, {
                days: state.recurrenceDays,
                weeks: state.recurrenceWeeks,
                dayOfMonth: state.recurrenceDayOfMonth,
            });
            const valid = TaskDialog._recurrencePickerValid(state);
            recurError.style.display = valid ? 'none' : 'block';
            recurError.textContent = valid ? '' : 'Pick at least one day for a weekly repeat.';
            updateSubmit();
        };

        const dayChipCss = 'flex:0 0 34px; box-sizing:border-box; text-align:center; padding:6px 0; border-radius:var(--radius-s,6px); font-size:12px; line-height:1; cursor:pointer; transition:background 120ms ease, color 120ms ease, border-color 120ms ease;';
        const dayChipOff = dayChipCss + ' border:1px solid var(--background-modifier-border,#444); background:transparent; color:var(--text-muted,#999);';
        const dayChipOn = dayChipCss + ' border:1px solid var(--interactive-accent,#6a6abf); background:var(--interactive-accent,#6a6abf); color:var(--text-on-accent,#fff); font-weight:600;';
        const DOW_LABELS = [
            { n: 0, l: 'S' }, { n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' },
            { n: 4, l: 'T' }, { n: 5, l: 'F' }, { n: 6, l: 'S' },
        ];

        const renderRecurSubBox = () => {
            recurSubBox.empty();
            if (state.recurrenceFreq === 'weekly') {
                const dayRow = recurSubBox.createDiv();
                dayRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
                for (const d of DOW_LABELS) {
                    const on = state.recurrenceDays.indexOf(d.n) >= 0;
                    const btn = dayRow.createEl('div', { text: d.l });
                    btn.style.cssText = on ? dayChipOn : dayChipOff;
                    btn.onclick = () => {
                        const idx = state.recurrenceDays.indexOf(d.n);
                        if (idx >= 0) state.recurrenceDays.splice(idx, 1);
                        else state.recurrenceDays.push(d.n);
                        renderRecurSubBox();
                        recomposeRecurrence();
                    };
                }
                const weeksRow = recurSubBox.createDiv();
                weeksRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:8px;';
                const weeksLabel = weeksRow.createEl('span', { text: 'Every' });
                weeksLabel.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
                const weeksInput = weeksRow.createEl('input', { type: 'number' });
                weeksInput.style.cssText = 'width:52px; box-sizing:border-box; padding:5px 6px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:12px;';
                weeksInput.min = '1';
                weeksInput.max = '12';
                weeksInput.value = String(state.recurrenceWeeks || 1);
                weeksInput.onchange = () => {
                    const n = parseInt(weeksInput.value, 10);
                    state.recurrenceWeeks = Number.isInteger(n) && n >= 1 && n <= 12 ? n : 1;
                    weeksInput.value = String(state.recurrenceWeeks);
                    recomposeRecurrence();
                };
                const weeksLabel2 = weeksRow.createEl('span', { text: 'week(s)' });
                weeksLabel2.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
            } else if (state.recurrenceFreq === 'monthly') {
                const domRow = recurSubBox.createDiv();
                domRow.style.cssText = 'display:flex; align-items:center; gap:8px;';
                const domLabel = domRow.createEl('span', { text: 'On day' });
                domLabel.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
                const domInput = domRow.createEl('input', { type: 'number' });
                domInput.style.cssText = 'width:60px; box-sizing:border-box; padding:5px 6px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:12px;';
                domInput.min = '1';
                domInput.max = '31';
                if (state.recurrenceDayOfMonth) domInput.value = String(state.recurrenceDayOfMonth);
                domInput.onchange = () => {
                    const n = parseInt(domInput.value, 10);
                    state.recurrenceDayOfMonth = (Number.isInteger(n) && n >= 1 && n <= 31) ? n : null;
                    recomposeRecurrence();
                };
                const domLabel2 = domRow.createEl('span', { text: 'of the month' });
                domLabel2.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
            }
        };
        renderRecurSubBox();

        recurSelect.onchange = () => {
            const opt = recurSelect.options[recurSelect.selectedIndex];
            state.recurrenceFreq = (opt && opt.value) || 'none';
            renderRecurSubBox();
            recomposeRecurrence();
        };
```

- [ ] **Step 4: Update `updateSubmit` to gate on the new picker validity instead of the old grammar-string validity**

Find (currently lines 1018-1027):

```javascript
        const updateSubmit = () => {
            const TE = TaskDialog._taskEntity();
            const v = TE ? TE.validatePayload(buildPayload()) : { valid: !!(state.title && state.title.trim()) };
            const rv = TaskDialog._recurrenceValidity(state.recurrence, isSupportedFn());
            const valid = v.valid && rv.valid;
            saveBtn.disabled = !valid;
            // Mute accent when Save unavailable so disabled state reads.
            saveBtn.style.opacity = valid ? '1' : '0.45';
            saveBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
        };
```

Replace with:

```javascript
        const updateSubmit = () => {
            const TE = TaskDialog._taskEntity();
            const v = TE ? TE.validatePayload(buildPayload()) : { valid: !!(state.title && state.title.trim()) };
            const valid = v.valid && TaskDialog._recurrencePickerValid(state);
            saveBtn.disabled = !valid;
            // Mute accent when Save unavailable so disabled state reads.
            saveBtn.style.opacity = valid ? '1' : '0.45';
            saveBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
        };
```

- [ ] **Step 5: Run the CustomJS loadability + full task-entity suite**

Run: `node platform/test/run-customjs-loadable.js && node platform/test/run-task-entity.js`
Expected: both green — `run-customjs-loadable.js` confirms the bare-class file still parses as one expression (no stray trailing statement from the edit); `run-task-entity.js` confirms nothing regressed (all `TD-*`/`CRG-*`/`RSD-*`/`RPV-*` still pass).

- [ ] **Step 6: Add a DOM-stub integration test for edit-mode hydration**

Append to `platform/test/run-task-entity.js`, after the `RPV-4` block from Task 3 — this exercises `_recurrenceStateFromDescribe` + `_composeRecurrenceGrammar` together the way `_render` wires them, without needing a full DOM (the picker's own DOM wiring is covered by the unit tests above; this confirms the two functions compose correctly end-to-end for a round-trip):

```javascript
// ---------- Recurrence picker round-trip (describe -> hydrate -> recompose) ----------
//
// Simulates opening the edit dialog on a task with an existing recurrence:
// RecurrenceParser.describe() parses it, _recurrenceStateFromDescribe()
// hydrates the picker state, and _composeRecurrenceGrammar() rebuilds the
// IDENTICAL grammar string with no user interaction — confirms the picker
// never silently mutates an existing recurring task's schedule just by
// opening and re-saving it unchanged.

ok('RRT-1 round-trips "every 2 weeks on Friday" unchanged (short day name)', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const grammar = 'every 2 weeks on Friday';
  const described = RecurrenceParserClass.describe(grammar);
  const hydrated = TaskDialog._recurrenceStateFromDescribe(described);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  // Recomposition always emits the short 3-letter day name (DOW_NAMES), so
  // the round-trip is grammar-EQUIVALENT (both fire on the same dates via
  // RecurrenceParser.matches), not necessarily byte-identical to the input.
  assert(recomposed === 'every 2 weeks on Fri', 'recomposed: ' + recomposed);
});

ok('RRT-2 round-trips "every 15th of month" unchanged', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const grammar = 'every 15th of month';
  const described = RecurrenceParserClass.describe(grammar);
  const hydrated = TaskDialog._recurrenceStateFromDescribe(described);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  assert(recomposed === grammar, 'recomposed: ' + recomposed);
});

ok('RRT-3 round-trips "every weekday" unchanged', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const grammar = 'every weekday';
  const described = RecurrenceParserClass.describe(grammar);
  const hydrated = TaskDialog._recurrenceStateFromDescribe(described);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  assert(recomposed === grammar, 'recomposed: ' + recomposed);
});

ok('RRT-4 round-trips an empty/no-recurrence task unchanged', () => {
  const hydrated = TaskDialog._recurrenceStateFromDescribe(null);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  assert(recomposed === '', 'recomposed: ' + recomposed);
});
```

Run: `node platform/test/run-task-entity.js`
Expected: `RRT-1` through `RRT-4` pass; total pass count increased by 4.

- [ ] **Step 7: Commit**

```bash
git add platform/mechanisms/task-entity/task-dialog.js platform/test/run-task-entity.js
git commit -m "feat: replace free-text Repeats field with a structured recurrence picker"
```

---

### Task 5: Full preflight + ship it

**Files:** none (verification + release runbook only)

- [ ] **Step 1: Run the full preflight suite**

Run: `npm run release:preflight`
Expected: green, no regressions. If `run-renderer.js`, `run-todo-all-list.js`, or any other harness unexpectedly fails on an unrelated pre-existing issue, investigate before proceeding — do not skip failures.

- [ ] **Step 2: Push the branch and open the PR**

```bash
git push -u origin feature/recurrence-picker
gh pr create --title "feat: structured recurrence picker (dropdown + day/month controls)" --body "$(cat <<'EOF'
## Summary
- Replaces the task dialog's free-text "Repeats" grammar field with a structured picker: a frequency dropdown (Doesn't repeat / Every day / Weekly / Every weekday / Monthly) plus contextual controls (day-of-week toggle buttons + an "every N week(s)" stepper for Weekly; a day-of-month field for Monthly).
- The stored `recurrence` frontmatter value is UNCHANGED — still the same `RecurrenceParser` grammar string. The picker is purely a front-end builder for that string (new `TaskDialog._composeRecurrenceGrammar`) plus a new public `RecurrenceParser.describe()` for edit-mode reverse-mapping. Zero schema change, zero migration, zero risk to any vault's existing recurring tasks.
- Deletes the old free-text validation path (`_recurrenceValidity`, the inline error message, live-typing grammar validation) — replaced by `TaskDialog._recurrencePickerValid`, which is structurally simpler (the only invalid state left is Weekly with zero days toggled).

## Test plan
- [x] `node platform/test/run-recurrence-parser.js` — RP-37..RP-46 (new `describe()` coverage)
- [x] `node platform/test/run-task-entity.js` — CRG-*/RSD-*/RPV-*/RRT-* (compose/hydrate/validity/round-trip)
- [x] `node platform/test/run-customjs-loadable.js` — bare-class loader still accepts both files
- [x] `npm run release:preflight` — full suite green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch CI, handle the BEHIND treadmill**

Poll `gh pr checks <PR-number>` and `gh pr view <PR-number> --json mergeStateStatus`. If `mergeStateStatus` is `BEHIND` (other autonomous cycles landed to `main` while checks ran — normal in this repo), run:

```bash
git fetch origin && git merge origin/main --no-edit && npm run release:preflight && git push
```

Repeat until `mergeStateStatus` is `CLEAN` and all checks are green, then merge:

```bash
gh pr merge <PR-number> --squash
```

- [ ] **Step 4: Wait for the automated release PR, then the homebrew tap PR**

The release pipeline auto-computes the version bump, opens a release PR, and auto-merges it once its own CI is green — do not merge it by hand. After it merges, a homebrew tap PR opens and auto-merges the same way. Poll with `gh pr list --search "is:pr is:merged" --limit 5` / `gh pr list` on both `sauce` and the tap repo until both have merged, noting the new version number from the release PR title (e.g. `chore(release): vX.Y.Z`).

- [ ] **Step 5: Deploy to all 3 consumer vaults**

```bash
brew upgrade sauce
for v in accuris-sauce ero-sauce headspace-sauce; do
  bash -c "cd /Users/willfellhoelter/notes/sauce/$v && sauce update --bump-pins"
done
```

Expected: each prints `Drift: none` (or heals cleanly) at the new version.

- [ ] **Step 6: Verify live**

Manually confirm (or grep) that the new dialog code is present in each consumer vault's installed `task-dialog.js`/`recurrence-parser.js` (e.g. `grep -l "_composeRecurrenceGrammar" /Users/willfellhoelter/notes/sauce/*/ranch/mechanisms/task-entity/task-dialog.js` or wherever the installer places mechanism files — check the actual installed path via `sauce update`'s own output or `platform/install.js`'s destination mapping). Since this cycle touches no frontmatter schema and no install heal, there is nothing to migrate on existing recurring tasks — their `recurrence` string is read by the SAME `RecurrenceParser`, unchanged.

- [ ] **Step 7: Write cycle-close docs**

Create `Docs/plans/2026-07-09-recurrence-picker-result.md` following the shape of `Docs/plans/2026-07-08-subtasks-and-dialog-polish-result.md` (shipped version, PR numbers, what shipped, testing summary, process notes, verified-live, carry-forward). Prepend an entry to `Docs/cycle-history.md` and update the "Current" section of `Docs/agent-guides/cycle-status.md`, demoting the prior entry to "previous" — matching the exact pattern used for the two prior cycles this session.

```bash
git add Docs/plans/2026-07-09-recurrence-picker-result.md Docs/cycle-history.md Docs/agent-guides/cycle-status.md
git commit -m "docs: cycle-close artifacts for recurrence-picker cycle"
git push
```

If `main` has moved again, this docs-only push may also need a merge+push round before its own (likely trivial/no-CI-required) PR can merge — follow the same BEHIND-treadmill procedure as Step 3, opening a small `gh pr create` for it if the branch already has open-PR conventions from prior cycles (check how the two prior cycles' docs commits landed — directly to a PR, or as a follow-up docs-only PR — and match that).
