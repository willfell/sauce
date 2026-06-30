# Sauce Autoloop Turn 8 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** merged -> card closed — PR #80 (remove New Meeting button) MERGED, shipped in v0.142.2. Closed the card: board In Progress -> Completed ([x]); frontmatter status:done + completed_in_version:v0.142.2. The card shipped piece #2 (button removal); its other asks live as #3 [[Heal legacy Status and Workstreams headings in project hubs]] + #4 [[Open Tasks links should open the task note]].
**Card:** Project Hub Style Fixing
**Version shipped:** v0.142.2

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Heal legacy Status and Workstreams headings in project hubs]]
- [[Open Tasks links should open the task note]]
- [[To Do number on daily note to show to items for all]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[Open Tasks links should open the task note]]

## Notes
- FIRST turn under the HARDENED skill: acquired the single-turn lock (turn-lock.js acquire -> acquired:true, not stale; will release in Phase E) — the concurrency fix I flagged in turn 7 SHIPPED as #82 feat(autoloop): worktree + single-turn lock (v0.143.0), so overlapping turns now no-op on the lock and every change runs in an isolated .worktrees/ worktree instead of branch-switching the shared tree. The model bug-hunt Scout (#84, Increment 2c-1) also shipped. So two of the three substrate gaps are CLOSED. STILL OPEN: the reconcile merged-deadlock (grep of reconcile-inflight.js shows NO ledger/reconciled tracking) — next turn reconcile will again return merged for #80 (now the most-recent terminal autoloop PR) but Project Hub Style Fixing is now Completed, so treat merged-but-already-closed as IDLE and proceed to Phase B (recommended next = the bounded Open-Tasks-link card). The reconciled-PR ledger is the last substrate gap worth closing. Board: Project Hub Style Fixing + Board Note Template Fix both Completed; Workstreams in Projects need updating remains Blocked awaiting a reply; 5 Planning cards including 2 split from this card + the users new "To Do number on daily note" card.
