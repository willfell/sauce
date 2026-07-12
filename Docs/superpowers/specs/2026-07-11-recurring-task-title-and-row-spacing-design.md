# Recurring-Task Title Corruption + Row Separator Design Spec

**Date:** 2026-07-11
**Blueprint:** to-do
**Mechanism:** task-entity

---

## Problem

Three issues reported against `spice/to-do/2026/07-July/ToDo-2026-07-11` (headspace vault) and `spice/tasks/`:

1. **Mobile row spacing** — task rows on the daily list have no visual separator between them; on a phone the rows read as one dense, undifferentiated block. Clarified with the user: the ask is specifically a separator between each task row.

2. **Recurring tasks show as open with a corrupted title** — `spice/tasks/Pay Rent ✅ 2026-07-06.md` and `spice/tasks/Feed the dogs ✅ 2026-06-17.md` both carry `title: <Name> ✅ <date>` in frontmatter (and thus the same string baked into the filename, since `TaskEntity.taskFilename` derives the filename from the title). Both are `status: open`, `recurrence: every day`, with `due` one day behind "today". They render on the daily list as regular OPEN rows — but the "✅ <date>" text embedded in the title makes them visually look "already completed", which is what led the user to believe they'd been marked done and shouldn't still be showing.

## Root cause (traced to source)

`platform/install.js`'s `_parseRecurringRegistry` (used by `applyRecurringTasksMigrationHeal`, the one-time converter from the legacy `spice/to-do/Recurring Tasks.md` registry into note-per-task files) extracts a registry line's title by stripping only `[field:: value]` inline-field annotations:

```javascript
const title = rest.replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, "").trim();
```

The legacy registry supported BOTH unchecked (`- [ ] ...`) and checked (`- [x] ...`) lines (this parser is explicitly "EXTENDED to also match checked... lines" per its own comment, unlike the still-active `ToDoDailyRecurring.parseRegistryLine`, which only ever matches `- [ ] ...` and therefore never encounters this data). A checked legacy line evidently carried a manually-typed "✅ &lt;date&gt;" completion annotation as part of its own plain text (a common personal habit-tracking convention, not a structured `[field:: value]`) — e.g. `- [x] Pay Rent ✅ 2026-07-06 [recurrence:: every day]`. The title-extraction regex has no knowledge of this convention, so "✅ 2026-07-06" survives into `entry.title` verbatim, and from there into the newly-created note's `title` frontmatter and filename.

This is a one-time migration-parsing bug: `created_at: 2026-07-08` on both affected notes confirms they were created three days ago by exactly this migration heal (`source: migrated-from-registry`). The tasks' underlying open/due/recurrence state is otherwise correct and unaffected — only the `title` string is corrupted.

## Solution

### 1. Row separator (mobile spacing)

`TaskTodayList.renderTaskRow` (`platform/mechanisms/task-entity/task-today-list.js`) already sets `border: 1px solid transparent;` on every row (a no-op placeholder, never colored). Add a real `border-bottom` hairline — using `var(--background-modifier-border-hover)` (not the plain `--background-modifier-border`, which the project has already found to read as near-invisible on dark themes — see the existing project-divider precedent) — and give the row a touch more bottom padding so the divider doesn't sit flush against wrapped chip content. This is the single shared row renderer used by every task surface (daily, project, meeting, subtask list), so the fix lands everywhere task rows render, not just the daily.

### 2. Prevent future title corruption

Add a shared pure helper `_stripCompletionEmojiSuffix(title)` in `platform/install.js`: strips a trailing `✅ <YYYY-MM-DD>` annotation (with optional surrounding whitespace) from a title string; a title without that suffix passes through unchanged. Apply it at the ONE place a registry line's title is computed in `_parseRecurringRegistry`, so any vault that still has an un-migrated `Recurring Tasks.md` with old-format checked-and-annotated lines produces clean titles from now on.

### 3. Heal the two already-corrupted notes (and any others like them)

Extend `applyTaskNoteHeal` (`platform/install.js`) — the existing, already-shipped, ungated, idempotent per-file heal for `spice/tasks/` top-level notes — with a third condition alongside its existing "rename ugly filename" / "inject missing chrome" jobs: **clean a corrupted title**. For each task note, compute `cleanTitle = _stripCompletionEmojiSuffix(rawTitle)`; if it differs from `rawTitle`:
- Rewrite the `title:` line inside the note's frontmatter block (scoped to the frontmatter delimiters only, never touching the user's free-text body) to the clean value.
- Route the note through the SAME rename path the heal already uses for ugly-timestamp filenames (`_sanitizeTaskTitleForFilename(cleanTitle) + ".md"`, deduped against existing top-level task notes via the heal's existing `_uniqueName` helper) — the sanitize call itself is generalized to always use the (already-clean-if-unaffected) `cleanTitle` rather than `rawTitle`, so both this case and the existing ugly-filename case share one code path.
- `.sauce-backup` snapshot before write (existing convention, reused as-is).

Idempotent: a note whose title has no trailing "✅ &lt;date&gt;" is untouched (no read-modify-write). Ungated — runs every install, matching this heal's existing posture.

This is a data-corruption cleanup, not a behavior change: once titles are clean, these two tasks behave exactly like any other daily "every day" recurring task — they'll correctly stop showing in Today/Overdue once marked done (which advances `due` past today), and reappear only once `due` is today or earlier again.

---

## Architecture

### Modified files

| File | Change |
|------|--------|
| `platform/mechanisms/task-entity/task-today-list.js` | `renderTaskRow`'s row style gains a real `border-bottom` hairline divider + a touch more bottom padding. |
| `platform/install.js` | New `_stripCompletionEmojiSuffix(title)` helper. `_parseRecurringRegistry`'s title extraction applies it. `applyTaskNoteHeal` gains a third heal condition (title cleanup + matching rename), sharing its existing backup/rename/dedupe infrastructure. |

No new files, no frontmatter schema changes (the `title` field already exists; this only cleans its value), no new heal function (extends the existing one, matching the project's established "extend the generic table/function" pattern from the prior cycle).

---

## Testing

Extended in `platform/test/run-task-entity.js` (row-style test) and `platform/test/run-seed-migrations.js` (heal + registry-parse tests, alongside the existing `HC-TASKHEAL-SEED-*` / recurring-registry-heal coverage in that same file).

| ID | Test |
|----|------|
| RTR-DIV-1 | `renderTaskRow`'s row element carries a real (non-transparent) `border-bottom` color |
| STRIP-EMOJI-1 | `_stripCompletionEmojiSuffix` strips a trailing `✅ YYYY-MM-DD` (with/without extra whitespace) |
| STRIP-EMOJI-2 | `_stripCompletionEmojiSuffix` leaves a title with no such suffix unchanged |
| HC-REGISTRY-TITLE-1 | `_parseRecurringRegistry` produces a clean title for a checked legacy line carrying a manually-typed `✅ <date>` annotation |
| HC-TASKHEAL-TITLE-1 | `applyTaskNoteHeal` cleans a corrupted `title:` frontmatter field and renames the file to match |
| HC-TASKHEAL-TITLE-2 | `applyTaskNoteHeal` is idempotent — a second pass on an already-clean title is a no-op |
| HC-TASKHEAL-TITLE-3 | `applyTaskNoteHeal`'s title-cleanup rename dedupes against an existing same-named note (` 2` suffix) |

---

## Out of scope

- Any change to the recurring roll-forward math itself (`TaskDialog._rollForwardDate` / `_markDone`) — traced and confirmed correct; the reported "shows as open" symptom is fully explained by the corrupted title, not a roll-forward bug.
- Cleaning up corrupted titles inside `_done/` or `_trash/` task notes (the heal's existing top-level-only scope is preserved, matching its established posture).
- A general mobile-responsive redesign of the row layout beyond adding the requested separator.
