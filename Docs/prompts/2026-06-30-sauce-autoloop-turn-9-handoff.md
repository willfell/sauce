# Sauce Autoloop Turn 9 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** implemented -> PR opened — Fixed ProjectOpenTasks: open-task cards now link to the TASK NOTE (<folder>/tasks/<Name>/<Name>.md, parsed from the cards wikilink, alias-aware) instead of always the board; falls back to the board for orphan cards. Regression POT-B-1 (target resolves task-note path; red-without/green-with) + POT-B-2 (board-fallback guard). Gate A green (preflight + install exit 0), Gate B L1 adequate, L2 panel passed (1/3 refute, below the >=2 block threshold; the lone refute was a mislabeled boolean whose own reason said "No regression"). PR #88 open, auto-merge armed.
**Card:** Open Tasks links should open the task note
**Version shipped:** (pending release)

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Heal legacy Status and Workstreams headings in project hubs]]
- [[To Do number on daily note to show to items for all]]

### In Progress
- [[Open Tasks links should open the task note]]

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[Heal legacy Status and Workstreams headings in project hubs]]

## Notes
- Ran under the hardened skill: acquired the turn lock, implemented ENTIRELY in an isolated git worktree (.worktrees/autoloop-open-tasks-task-note, branch off origin/main), removed the worktree after opening the PR — NO branch-switch of the main tree, so the turn-7 concurrency collision cannot recur. Phase A deadlock-as-idle worked cleanly: reconcile returned merged #80 but Project Hub Style Fixing was already Completed -> treated as idle -> proceeded to select. This closes the #4 split of Project Hub Style Fixing; the remaining split is #3 [[Heal legacy Status and Workstreams headings in project hubs]] (recommended next — the users emphatic ask: literal ## Status/## Workstreams H2s in pre-v0.109.0 hubs like their Sauce.md; needs a heal mirroring applyDocNoteBreadcrumbMarkerCleanup: strip the two H2 lines, idempotent, fence-aware, .sauce-backup, type:project scope). REMAINING SUBSTRATE GAP: the reconcile merged-deadlock ledger is still unshipped (grep of reconcile-inflight.js shows no ledger) — each turn after a merge must keep treating merged-but-already-closed as idle; the reconciled-PR ledger is the last hardening item. PR #88 was BEHIND at open (worktree based on an earlier origin/main); resolved via push-handoff-then-update-branch. Workstreams in Projects need updating remains Blocked awaiting a reply.
