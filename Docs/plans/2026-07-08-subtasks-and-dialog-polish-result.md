# Subtasks + Task-Dialog Polish — Result

**Shipped:** workshop v0.207.0 (2026-07-09). `task-entity` 0.9.0 → 0.10.0, `to-do` 0.20.0 → 0.21.0.

**PR:** #379 (feature) → auto-release PR #382 (v0.207.0) → homebrew tap PR #358 (auto-merged).

---

## What shipped

**Part A — Due/Scheduled consolidation.** The task schema's redundant `scheduled` (drove Today/Overdue bucketing) and `due` (cosmetic-only secondary date) fields collapse into one `due` field. Every reader across `TaskEntity`, `TaskDialog`, `TaskTodayList`, `TaskNoteView`, `ToDoAllList`, `TaskRecurringList`, and the prior cycle's `applyRecurringTasksMigrationHeal` updated in lockstep. New `applyTaskDueScheduledRenameMigration` install-time heal (ungated, idempotent) renames the key on every existing task note across every consumer vault.

**Part B — Task dialog polish.** Progressive disclosure: Title + Due always visible; Priority/Project/Repeats/Notes/Links collapse behind a "More options" toggle that auto-expands in edit mode when the task already has data in any of those fields.

**Part C — Subtasks.** New `parent_task` field. A subtask is a full task note (same `TaskEntity`/`TaskDialog` machinery as any other task) linked to its parent. New live "Subtasks" section on the parent's `TaskNoteView` card (reuses `TaskTodayList.renderTaskRow`), inline quick-add, progress indicator, "Part of" backlink on the child, and exclusion from the personal Today/Overdue bands (still shows in All-ToDos/Recurring/Completed).

## Testing

All 11 code/test tasks landed via TDD, each independently re-verified after every subagent dispatch (not just trusting the report):
- `run-task-entity.js`: 155/155 passing at cycle close (TE-sub-1/2, TD-sub-1, TTL-sub-1, TNV-sub-1/2, TD-polish-1/2/3, plus every updated `scheduled`→`due` fixture across the whole suite).
- `run-customjs-loadable.js`: clean throughout (no bare-class trailing-statement regressions).
- `run-seed-migrations.js`: new `HC-V0205-SEED-MIGRATE-DUE-1/2/3` family, 470/470.
- Full `npm run release:preflight`: green — but only after fixing two gaps my own verification caught that the plan's tests didn't cover (see below).

## Process notes

- One implementer subagent (Task 10, first attempt) was rate-limited mid-run and made zero changes; caught via git-status verification and retried successfully — same failure mode seen in the prior recurring-tasks cycle.
- PR #379 hit a 4-round "BEHIND" treadmill — v0.204.2, v0.205.0, v0.206.0, and a section-explorer feature cycle all landed to `main` while this PR's checks were running. Each round: fetched + merged `origin/main`, re-ran full preflight (green every time, git auto-merged cleanly with no real conflicts), pushed, re-watched CI, until GitHub's `mergeStateStatus` cleared.
- **Two real, out-of-plan-scope bugs found and fixed by my own post-implementation verification**, not by anything the plan itself specified:
  1. Running `npm run release:preflight` in full (not just the harnesses each subagent was told to check) surfaced `run-renderer.js` (`SELTASK-1`/`HC-COUNTS`, the Home dashboard's task-count tests) and `run-todo-all-list.js` (a separate mock-harness test file) still referencing the retired `scheduled` field in test fixtures. Neither file was caught by the original design doc's blast-radius grep — a real gap in that research pass (I only checked `space-home.js`, which correctly delegates to `TaskEntity`, but missed `space-daily-dashboard.js` and the dedicated `run-todo-all-list.js` test file). Fixed directly: both were test-fixture-only issues, the actual production code already delegated correctly to `TaskEntity`.
  2. The seed-vault coverage added specifically to exercise the rename heal end-to-end (Task 7) caught a real regex bug in `applyTaskDueScheduledRenameMigration`: `\s*` in `/^due:\s*(.*)$/m` crossed the newline into the next frontmatter line whenever a key's own value was blank, so a genuinely-empty `due:` was misread as already-set and the migration silently skipped copying the `scheduled` value over — exactly the shape of the seed fixture used to test it. Narrowed to `[ \t]*` (same-line-only whitespace).
- This confirms the value of both (a) always running the FULL preflight suite rather than trusting individually-green harnesses, and (b) writing real seed-vault fixtures that exercise a migration end-to-end rather than only unit-testing its pieces.

## Verified live

- **accuris-sauce, ero-sauce, headspace-sauce:** `sauce update --bump-pins` clean on all three, `Drift: none`. Confirmed via direct grep that **zero task notes anywhere in any of the three vaults still carry a `scheduled:` key** — the migration heal ran successfully against real production data.
- headspace-sauce's recurring tasks ("Pay Rent", "Feed the dogs" — resurrected in the prior cycle) now correctly carry `due:` instead of `scheduled:`, confirming the rename heal composed correctly against the recurring-tasks heal's own output too.

## Carry-forward

- The prior cycle's known cosmetic bug (migrated task titles from checked-off registry lines retain a trailing `✅ YYYY-MM-DD` artifact) is unaffected by this cycle and remains open — low priority, cosmetic only.
- No manual/browser-level smoke test was performed on the actual dialog expand/collapse animation or the live Subtasks section rendering — both are DOM/visual concerns outside the Node harness's reach. Recommend a manual smoke pass in a real vault (per `Docs/agent-guides/smoke-checklists/`) before considering the UI polish fully validated, though the underlying decision logic (`_moreOptionsShouldStartExpanded`, `_subtaskProgressText`, the subtask-query filter) is fully unit-tested.
- Per the design doc: no recursive/nested subtasks beyond one level; no auto-completion cascade; no orphan-cleanup heal for subtasks whose parent was deleted (accepted graceful-degradation trade-off).
