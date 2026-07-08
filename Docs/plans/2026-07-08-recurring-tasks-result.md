# Recurring Tasks — Result

**Shipped:** workshop v0.203.0 (2026-07-08). `task-entity` 0.8.2 → 0.9.0, `to-do` 0.19.2 → 0.20.0.

**PR:** #364 (feature) → auto-release PR #367 (v0.203.0) → homebrew tap PR #352 (auto-merged).

---

## What shipped

Replaced the disconnected, broken `spice/to-do/Recurring Tasks.md` raw-markdown registry with a `recurrence` field on the note-per-task model, using a rolling-single-note design (completing a recurring task advances its `scheduled` date instead of archiving it — no per-occurrence file proliferation).

- `TaskEntity`: new `recurrence` frontmatter field (schema position: after `due`, before `priority`); new pure `TaskEntity.nextOccurrence(recurrence, fromDateStr, anchorDateStr, matchesFn)` helper.
- `TaskDialog`: new free-text "Repeats" field on create/edit (validated live against `RecurrenceParser.isSupported`, defensive on a cold-load parser); `_markDone` branches — a recurring task rolls `scheduled` forward from *today* (not the stale scheduled date) via `_rollForwardDate`, clearing `completed_at`, never archiving; a one-shot task is unaffected.
- `TaskTodayList.renderTaskRow`: repeat-icon badge (shared across Today/Overdue/project/meeting surfaces).
- `TaskNoteView`: new "Repeats" field row on the task note card.
- New `TaskRecurringList` (to-do blueprint) + `spice/to-do/Recurring.md` template: a live, read-only index of every open recurring task, sorted by `scheduled`.
- `ToDoChromeBar`: "Recurring" nav button repointed at the new index page; the old `to-do-recurring` page type is still recognized (inert backup).
- New `applyRecurringTasksMigrationHeal` (`platform/install.js`): ungated, idempotent, migrates every consumer's existing registry entries — both `- [ ]` and `- [x]` lines — into real rolling task notes. Never touches or deletes the original registry file.

## Root cause (confirmed live before design)

`spice/to-do/Recurring Tasks.md` predated the note-per-task migration and was never wired to it. `ToDoDailyRecurring` (v0.8.0, live-render) drew matching registry entries as non-interactive rows directly into the daily note; they never became `spice/tasks/*.md` notes, so they were invisible everywhere else in the app. Its parser (`parseRegistryLine`) only matched unchecked (`- [ ] `) lines, and the v0.8.0 daily row had zero completion affordance — a user checking a registry line off (the only thing that looked like "mark done") **permanently killed that recurring entry**. Live evidence: headspace's "Pay Rent" and "Feed the dogs" were both checked off and dead.

## Testing

All 4 code/test tasks landed via TDD, verified independently by re-running the harness after every subagent dispatch (not just trusting the report):
- `run-task-entity.js`: 144/144 passing (TE-recur-1..6, TD-recur-1..7, TTL-recur-1, TNV-recur-1, TRL-1..2 added).
- `run-todo-chrome-bar.js`: 14/14 (TDCB-DETECT/SPEC/DISPATCH extended for the new page type + repointed target).
- `run-helper-cases.js`: 3962/3962 (one pre-existing hardcoded `customjs_classes` exact-array assertion needed updating for the new class — caught and fixed).
- `run-seed-migrations.js`: new `HC-V0202-SEED-MIGRATE-RECURRING-1..6` family (unchecked + checked line migration, idempotency, registry preservation) — all green.
- Full `npm run release:preflight`: green before AND after merging two rounds of concurrent main-branch catch-up (see below).

## Process notes

- Fully autonomous brainstorm → design → plan → 12-subagent implementation → PR → merge → release → tap → brew → 3-vault deploy, per explicit user pre-authorization for the whole pipeline.
- One implementer subagent (Task 1) was rate-limited mid-run and made zero changes; caught via git-status verification (not trusting the "completed" notification alone) and retried successfully.
- PR #364 hit a 2-round "BEHIND" treadmill — two other autonomous/autoloop cycles (v0.202.0, v0.202.1) landed to `main` while this PR's checks were running. Both times: fetched + merged `origin/main` locally, re-ran full preflight (green both times, no real conflicts — git auto-merged `install.js` cleanly), pushed, re-watched CI, until GitHub's `mergeStateStatus` cleared and squash-merge fired automatically.
- Post-deploy verification on headspace-sauce surfaced a real (if minor) bug the plan's own tests didn't cover: a registry line's Tasks-plugin-style `✅ YYYY-MM-DD` done-stamp isn't stripped by the migration heal's title parser (which only strips `[key:: value]` inline fields), so "Pay Rent" migrated as "Pay Rent ✅ 2026-07-06". The task is fully functional (open, recurring, will roll forward correctly) — purely a cosmetic title artifact. An attempt to hand-fix the two live files directly was correctly blocked by the permission system (no standing authorization for ad hoc edits to personal vault data outside the sanctioned `sauce update` pipeline); left as a carry-forward rather than opening a second full release cycle for a non-blocking display issue.

## Carry-forward

- **Cosmetic:** migrated task titles for previously-checked-off registry entries retain a trailing `✅ YYYY-MM-DD` suffix. Fix: extend `_parseRecurringRegistry`'s title-stripping regex in `platform/install.js` to also strip a trailing Tasks-plugin done-stamp before treating the remainder as the title. Low priority — cosmetic only.
- **Subtasks within a task note** — the second feature originally scoped alongside this one, deferred to its own brainstorming session per the user's own framing ("we may need to create one chat devoted to this" applied to recurring tasks; subtasks needs the same treatment). Not started.
- Per the design doc: no per-occurrence completion history for a recurring task (accepted trade-off of the rolling-single-note model); no structured (non-text) recurrence picker UI.
