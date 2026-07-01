# Sauce Autoloop Turn 19 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** unblocked + implemented -> PR opened — daily To-Do pill now counts due/overdue project + meeting tasks; Gate B correctness catch fixed pre-merge; auto-merge armed
**Card:** To Do number on daily note ... for all (PR #105)
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project buttons]]
- [[Daily Hub Scratch Notes]]
- [[Project Card Separator Fix]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Project hub Display tweaks]]

### In Progress
- [[To Do number on daily note to show to items for all]]

### Blocked
- [[Workstreams in Projects need updating]]
- [[Editing To Do Items in a Project]]

## Recommended next
- **Card:** [[Project buttons]]

## Notes
- FORWARD PROGRESS turn (loop unwedged + reschedule 2h->10m). Reconcile = idle (ledger fix live on main). Processed the Blocked column: the user answered all 3 blocked cards. Unblocked + implemented card 2. CARD 2 SHIPPED-TO-PR: To Do number on daily note ... for all -> PR #105 (feat(daily): count due/overdue project + meeting tasks in the daily To-Do pill). SpaceDailyDashboard gains pure Node-testable statics (_parseTaskDue for due::/[due::]/emoji with a \b boundary so overdue:: doesn't false-match; _countsTowardToday today-or-overdue ISO compare; _foldExternalTasks -> OPEN due/overdue external tasks only) + a GUARDED dual-export; getTasks is a thin dv adapter walking spice/projects + spice/meetings/notes. Done count stays scoped to today's to-do note (external notes have no completion date). Ranch dogfood copy kept byte-identical (HC-V0842-A1). Gate A preflight green + install clean; Gate B L1 adequate; Gate B L2 panel 1/3 refute (correctness: Done over-counted historical completed external tasks + regex boundary) -> BOTH FIXED post-panel + pinned by DD-A9 (15 sub-asserts). Card left In Progress; next turn reconciles merged -> Completed. CARD 1 (Workstreams re-architecture) LEFT BLOCKED: the user's reply resolves design intent but it is a multi-surface epic (workstream data source-of-truth MOVES to a new/pre-existing note, manager relocates, nav button, cross-vault migration with 'intense attention to detail') with residual ambiguity (reuse Map note vs new note) + mostly Obsidian-runtime (untestable) -> not a safe single bounded turn; needs a decomposition plan. CARD 3 (Editing To Do Items in a Project) LEFT BLOCKED: user 'confirmed' but it's a big content-mutating, Obsidian-runtime editing feature over real task notes -> not a bounded/verifiable single turn. DEPLOY (Phase A step 7): canary -> ERO deployed to 0.147.4 (was 0.147.2), ok:true. 0.147.4 carries the shipped lock-liveness (#101) + reconciled-ledger (#103). Next turn PROMOTES accuris + headspace to 0.147.4 once ERO soaks. User runs Cmd+R in Obsidian after promote. SCHEDULE: /loop cadence changed 2h -> every 10 minutes (cron a2c3fc50). Safe now: the fixed single-turn lock no-ops overlapping fires and turns run in isolated worktrees. RECOMMENDED NEXT: reconcile card 2 (PR #105 merged -> Completed), then pick fresh Planning. Planning now: Project buttons, Daily Hub Scratch Notes, Project Card Separator Fix, Figure out New-Tab-Edit-Mode, Project hub Display tweaks (user-added mid-turn). Cards 1 + 3 need decomposition/scoping before they're autoloop-shippable.
