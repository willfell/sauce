# Sauce Autoloop Turn 10 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** wait (pr-open) — PR #88 (open-tasks task-note link fix) open, auto-merge pending. Up-to-date (mergeState BLOCKED, not BEHIND): ubuntu preflight GREEN, macOS preflight + CodeQL still IN_PROGRESS. Reconcile = pr-open -> wait. Pushed this handoff to main then ran gh pr update-branch 88 (turn-5 workaround) so the branch stays current and auto-merges once the re-run checks pass.
**Card:** Open Tasks links should open the task note
**Version shipped:** (no release this turn)

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
- Clean pr-open wait turn under the hardened skill (lock acquired+released; no worktree needed — no implementation). #88 will merge when macOS preflight + CodeQL go green; next turn reconciles merged -> closes the card. Workshop now 0.145.0 (releases kept shipping). Substrate status: lock + worktree isolation WORKING (no collisions since turn 7); the reconcile merged-deadlock ledger remains the one unshipped hardening item (treat merged-but-already-closed as idle). Board unchanged: Open Tasks card In Progress (PR #88); Project Hub Style Fixing + Board Note Template Fix Completed; Workstreams in Projects need updating Blocked awaiting a reply; recommended next = the #3 legacy-H2 heal (the users emphatic Sauce.md ask).
