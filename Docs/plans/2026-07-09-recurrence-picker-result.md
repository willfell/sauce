# Recurrence Picker — Result

**Shipped:** workshop v0.208.0 (2026-07-09). `task-entity` bumped for `TaskDialog`'s new statics; `to-do` bumped for `RecurrenceParser.describe()`.

**PR:** #388 (feature) → auto-release PR #390 (v0.208.0) → homebrew tap PR #362 (auto-merged).

---

## What shipped

User feedback after seeing the live v0.207.0 dialog: the free-text "Repeats" field ("every day", "every Monday", ...) was mediocre UX — the user wanted a structured picker like Reminders/Calendar: a frequency dropdown with contextual follow-up controls.

**Replaced** the free-text field with:

| Dropdown option | Contextual controls |
|---|---|
| Doesn't repeat | — |
| Every day | — |
| Weekly | Sun–Sat day-toggle buttons (multi-select) + an "every N week(s)" stepper (1–12, default 1) |
| Every weekday | — |
| Monthly | a day-of-month number field (1–31) |

**Storage format is unchanged** — `recurrence` is still the same `RecurrenceParser` grammar string ("every day", "every Mon Wed Fri", "every 2 weeks on Friday", "every 15th of month"). The picker is purely a front-end grammar builder:

- New public `RecurrenceParser.describe(grammar)` — reverse-maps a grammar string into `{kind, days, weeks, day}` for edit-mode hydration.
- New `TaskDialog._composeRecurrenceGrammar(freq, {days, weeks, dayOfMonth})` — builds the grammar string from picker state (deterministic: days de-duped + sorted Sun..Sat regardless of click order).
- New `TaskDialog._recurrenceStateFromDescribe(described)` — the inverse, hydrating the picker's initial dropdown/day-toggle/stepper state when editing an existing recurring task.
- New `TaskDialog._recurrencePickerValid(state)` replaces the old free-text `_recurrenceValidity` — the only structurally-invalid state left is Weekly with zero days toggled (would silently compose to `""`).

Zero schema change, zero migration, zero risk to any vault's existing recurring tasks — `RecurrenceParser.matches`, `TaskEntity.nextOccurrence`, and the install heal are all untouched.

## Testing

- `run-recurrence-parser.js`: RP-37..RP-46 (new `describe()` — one case per grammar kind + instance/static parity + null/empty/garbage).
- `run-task-entity.js`: CRG-1..13 (`_composeRecurrenceGrammar`, including ordinal suffixes and a round-trip through `RecurrenceParser.matches`), RSD-1..7 (`_recurrenceStateFromDescribe`), RPV-1..4 (`_recurrencePickerValid`), RRT-1..4 (full describe→hydrate→recompose round-trip, confirming re-opening and re-saving an existing recurring task never silently changes its schedule).
- Deleted the 3 obsolete tests for the removed `_recurrenceValidity`.
- `run-customjs-loadable.js`: clean (bare-class loader still accepts both edited files).
- Full `npm run release:preflight`: green.

## Process notes

- Executed directly (TDD, no subagent dispatch) — the plan was five tightly-scoped, mostly-pure-function tasks confined to two files, small enough that subagent-per-task overhead wasn't worth it.
- One real bug caught by my own tests during implementation: `RecurrenceParser.describe()`'s key order (`{kind, days, weeks}`) didn't match one test's `JSON.stringify` comparison order (`{kind, weeks, days}`) — a test-authoring mismatch, not a logic bug, fixed by aligning the static's key-insertion order.
- PR #388 hit a 3-round "BEHIND" treadmill (v0.207.2, v0.207.3, and an unrelated section-explorer fix all landed to `main` mid-flight) — each round: fetch + merge `origin/main` (all three merges were clean, no real conflicts, all touched unrelated files), re-run full preflight (green every time), push, re-watch CI.
- One CI run on the first push showed a `FAIL: TD-CLI-2` in `run-integration-smoke.js` that did not reproduce on an immediate local re-run in isolation, and disappeared after the first BEHIND-treadmill merge — treated as a flake (unrelated to this cycle's files) rather than investigated further, since it never recurred across three subsequent clean CI passes.

## Verified live

- **accuris-sauce, ero-sauce, headspace-sauce:** `sauce update --bump-pins` clean on all three (0 content overwrites, 0 pre-install deletes). Confirmed via direct grep that the installed `task-dialog.js` (`ranch/scripts/task-entity/task-dialog.js`) contains `_composeRecurrenceGrammar` and the installed `recurrence-parser.js` (`ranch/scripts/to-do/recurrence-parser.js`) contains the new `describe(grammar)` method on all three vaults.
- No frontmatter migration was needed or run — existing recurring tasks' `recurrence` strings are read by the same `RecurrenceParser`, unchanged.

## Carry-forward

Per the user's explicit sequencing ("focus on the recurring... let's think about the other stuff"), two items remain deliberately unstarted, pending the user's go-ahead on a future cycle:

- A hover-revealed subtle pill on task rows (`TaskTodayList.renderTaskRow`) showing open/done subtask counts for tasks that have subtasks.
- A hover-revealed inline Edit button on task rows, replacing the current "⋯ → Edit" two-click flow.
