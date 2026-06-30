# Sauce Autoloop Turn 15 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** blocked (needs your input) — Selected the users daily-pill card. Investigated the count logic (SpaceDailyDashboard.getTasks, space-daily-dashboard.js:150-168 — counts only today’s spice/to-do note tasks) and the available cross-source aggregator (ToDoDailyProjectGroups: project To-Do notes + linked meeting tasks). Expanding the pill to projects/other areas is a genuine DESIGN DECISION, not a bounded bug: project & meeting tasks have NO inherent today-date (Kanban cards are persistent; due::/📅 optional + rarely set), so counting them could mean all-open-tasks-in-the-vault OR due-today-only (which would count almost no project tasks) — the choice changes what the pill MEANS and is user-facing. Blocked-with-questions in the card (3 concrete questions: which sources, what date scope, how to count Done). Card In Planning -> Blocked.
**Card:** To Do number on daily note to show to items for all
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]
- [[To Do number on daily note to show to items for all]]

## Recommended next
- **Card:** [[Editing To Do Items in a Project]]

## Notes
- Clean block-with-questions under the hardened skill (lock acquired+released; no worktree — assessment only; deadlock-as-idle handled at the top: merged #91 already-Completed -> idle -> selected). A reusable aggregator (ToDoDailyProjectGroups) already collects project + meeting tasks, so once the user answers the scope/date questions the implementation is small (extend getTasks’ getTasks closure to fold in the aggregator, gated by the chosen date filter). Two cards now Blocked awaiting Wills in-card replies: Workstreams in Projects need updating (longstanding) + this To Do pill card. Remaining fresh Planning: Editing To Do Items in a Project (recommended next), Figure out Why Opening up a New Tab always opens up in Edit Mode (a third-party-plugin runtime investigation — likely another block-with-questions or hard to do autonomously). Substrate healthy (worktree+lock holding; reconcile merged-deadlock ledger + non-worktree-install-dirties-main-tree remain the two tracked operational gaps). NOTE: the entire Project Hub Style Fixing arc shipped across turns 4-14 (v0.142.0 -> v0.146.0).
