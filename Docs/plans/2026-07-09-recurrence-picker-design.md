# Recurrence Picker — Design

**Problem:** The task dialog's "Repeats" field is a raw free-text box (`RecurrenceParser` grammar, e.g. `"every day"`, `"every Mon Wed Fri"`, `"every 15th of month"`) with a placeholder and a live-validity error message. Typing the exact grammar correctly is mediocre UX, especially on mobile. The user wants a structured picker: a frequency dropdown with contextual follow-up controls (day-of-week toggle buttons for weekly, a day-of-month control for monthly), matching how apps like Reminders/Calendar do recurrence.

## Storage format — unchanged

`recurrence` stays the same grammar string. The picker becomes a *builder* for that string; `RecurrenceParser`, `TaskEntity.nextOccurrence`, and the install heal are untouched. Zero schema change, zero migration risk to the 3 vaults' live recurring tasks.

## Dropdown → contextual controls → composed grammar

| Dropdown option | Contextual controls | Composed grammar (examples) |
|---|---|---|
| Doesn't repeat (default) | — | `""` |
| Every day | — | `"every day"` |
| Weekly | day-of-week toggle buttons (Sun–Sat, multi-select, at least one required) + a small "every N week(s)" stepper (default 1) | `"every Mon Wed Fri"` (N=1) or `"every 2 weeks on Friday"` (N=2) |
| Every weekday | — (implicit Mon–Fri) | `"every weekday"` |
| Monthly | day-of-month number input (1–31) | `"every 15th of month"` |

The Weekly "every N week(s)" stepper isn't explicitly requested but is included so every existing grammar family (including `every-n-weeks-on-day`) has a home in the new picker — this guarantees any existing recurring task can be **opened and re-edited** without landing on an unrepresentable state. It's a single small number input (`min="1" max="12"`, default `1`) always rendered alongside the day toggles when Weekly is selected — not conditionally hidden — so there's no extra show/hide state to manage; at the default of 1 it's just a quiet, easy-to-ignore control.

`every weekend` (Sat+Sun) is not a separate dropdown option — a user wanting that just selects Weekly and toggles Sat + Sun (N=1), which composes to `"every Sat Sun"`, functionally identical to the `weekend-block` grammar kind (both fire only on Sat/Sun). Likewise `weekday-set` covering Mon–Fri exactly is functionally identical to `weekday-block`; "Every weekday" is kept as its own dropdown item purely because the user explicitly asked for it as a one-tap convenience, not because the grammar needs a separate UI branch.

## Reverse mapping (edit mode)

New public static: `RecurrenceParser.describe(grammar)` → `{ kind, days, weeks, day } | null`, a thin wrapper around the existing (previously-internal) `_parse`. The dialog uses this to hydrate the picker's initial dropdown selection + control values when editing a task that already has a `recurrence` value. A `null` result (empty string, or an unsupported/legacy grammar somehow saved outside the picker) maps the dropdown to "Doesn't repeat" — never throws, never blocks the dialog from opening.

## Dialog changes

Replace the current `label(...) + recurInput + recurError` block (task-dialog.js:696-719) with:

1. A `<select>` for the dropdown (5 options above), driving `state.recurrenceFreq`.
2. A contextual sub-box that swaps its contents based on `state.recurrenceFreq`:
   - Weekly → 7 toggle buttons (Sun..Sat, matching the existing chip-button visual language already used for Priority) + a small "every ___ week(s)" number stepper.
   - Monthly → a single `<input type="number" min="1" max="31">`.
   - Daily / Every weekday / Doesn't repeat → empty (no sub-box).
3. `state.recurrence` (the composed grammar string) is derived from `state.recurrenceFreq` + the contextual state on every interaction, via a new pure static `TaskDialog._composeRecurrenceGrammar(freq, {days, weeks, dayOfMonth})`.

Because the picker can only produce grammar the parser already understands, almost all invalid-recurrence states become structurally impossible (no more `recurError` message, no more free-text `_recurrenceValidity` gating — that function and its live-typing validation path are deleted as dead weight). The one remaining invalid state is Weekly with zero days toggled (composes to `""`, i.e. silently "doesn't repeat" — not what the user asked for by picking Weekly). `updateSubmit` gates on a new pure static `TaskDialog._recurrencePickerValid(state)` — true unless `state.recurrenceFreq === 'weekly'` and `state.recurrenceDays` is empty — replacing the old grammar-string validity check.

**Edit-mode hydration:** on dialog open, `state.recurrenceFreq`/contextual state are derived once from `RecurrenceParser.describe(fm.recurrence)` (falling back to "Doesn't repeat" for `null`/empty). This governs the initial dropdown selection and pre-toggled day buttons / pre-filled day-of-month / pre-filled week-interval.

**"More options" auto-expand:** `_moreOptionsShouldStartExpanded` currently checks `s.recurrence` truthy — unchanged, since `state.recurrence` (the composed string) is still populated whenever a non-"doesn't repeat" frequency is chosen.

## Testing

- `RecurrenceParser.describe()` — one Node test per grammar kind (daily, weekday-set, weekday-block, weekend-block, day-of-month, every-n-weeks-on-day) plus `null` for unsupported/empty input.
- `TaskDialog._composeRecurrenceGrammar()` — pure unit tests: each frequency + control combination → exact expected grammar string; Weekly with zero days selected → `""` (guards against composing `"every "` with nothing after it).
- `TaskDialog._recurrencePickerValid()` — true for every freq except Weekly-with-zero-days, which is false.
- A DOM-stub test (matching the existing `RTR`/`TD-polish` style already in `run-task-entity.js`) verifying: selecting "Weekly" reveals the day-toggle row; selecting "Monthly" reveals the day-of-month input; toggling a day updates `state.recurrence`; opening the edit dialog on a task with `recurrence: "every 2 weeks on Friday"` pre-selects Weekly, toggles Friday, and sets the week-stepper to 2.
- Full `npm run release:preflight` before PR, as with prior cycles.

## Out of scope (explicitly deferred by the user to a later cycle)

- Hover-revealed subtask open/done count pill on task rows.
- Hover-revealed inline Edit button on task rows (replacing "⋯ → Edit").

Neither is touched in this cycle.
