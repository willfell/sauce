# Sauce Autoloop Turn 14 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** merged -> card closed — PR #91 MERGED, shipped in v0.146.0. Closed the card: board In Progress -> Completed ([x]); frontmatter status:done + completed_in_version:v0.146.0. This was the #3 (final) split of Project Hub Style Fixing — that entire user request is now fully shipped. The legacy ## Status / ## Workstreams H2 lines now heal out of pre-v0.109.0 project hubs on install; the user runs `sauce update` on headspace to clean their Sauce.md.
**Card:** Heal legacy Status and Workstreams headings in project hubs
**Version shipped:** v0.146.0

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To Do number on daily note to show to items for all]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[To Do number on daily note to show to items for all]]

## Notes
- DIRTY-TREE RECOVERY: at turn start the MAIN tree was dirty with ~17 regenerable ranch/ dogfood artifacts (materialized blueprint copies + bootstrap-last-install.log + 2 untracked ranch/scripts/project/*.js) — NOT user content (the user works in the consumer vault, not ranch/). These appeared between turn 13 and 14, so SOMETHING ran `node platform/install.js` with CWD=main repo and left artifacts (candidate: the 2h launchd autoloop job running a non-worktree path, or a stale pre-worktree leftover). I discarded them (git checkout -- ranch/ + git clean -fd ranch/) to unwedge Phase A step 2, then proceeded. WATCH: if this recurs, the launchd job / any non-worktree install path needs the same reset+clean the worktree turns already do (or to run in a worktree). Otherwise a healthy turn under the hardened skill. FOUR-FOR-FOUR: the users entire Project Hub Style Fixing request is now shipped end-to-end (divider keep=no-op; New Meeting button removed v0.142.2; Open Tasks->task note v0.145.1; legacy-H2 heal v0.146.0). Substrate: worktree+lock holding; only the reconcile merged-deadlock ledger remains unshipped (treat merged-but-already-closed as idle). Board: 4 Completed; 3 Planning (Editing To Do Items; Figure out New-Tab-Edit-Mode = likely a runtime/plugin block-with-questions; To Do number on daily note = recommended next); Workstreams in Projects need updating Blocked awaiting a reply.
