# Sauce Autoloop Turn 21 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** merged -> card closed — PR #105 merged + shipped v0.148.0; card closed, #105 recorded in ledger -> reconcile idle
**Card:** daily-todo-count-external (PR #105)
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project buttons]]
- [[Daily Hub Scratch Notes]]
- [[Project Card Separator Fix]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Project hub Display tweaks]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]
- [[Editing To Do Items in a Project]]

## Recommended next
- **Card:** [[Project buttons]]

## Notes
- MERGED -> card closed. PR #105 (daily To-Do pill counts due/overdue project + meeting tasks) MERGED as 418c2d46 and SHIPPED in v0.148.0 (release #106). Closed the card: board In Progress -> Completed [x]; frontmatter status:done + completed_in_version:v0.148.0. LEDGER WORKING END-TO-END: recorded #105 -> ledger [77,80,88,91,101,103,105]; reconcile now returns idle (no re-fire). The merged-deadlock fix (#103) is proven in production: a terminal PR fired merged exactly once and the loop reached idle on its own. The update-branch-after-handoff ordering from turn 20 worked — #105 stayed current and auto-merged within the 20-min window. DEPLOY: not run this turn (merged branch exits before Phase A step 7). v0.148.0 now shipped; ERO is on 0.147.4. Next (idle) turn runs deploy: canary ERO -> 0.148.0, and promotes accuris + headspace once ERO soaks. User runs Cmd+R in Obsidian after install. SCHEDULE: 20-minute cron (d256894c). RECOMMENDED NEXT: next turn is idle -> Phase B selects fresh Planning. Planning: Project buttons, Daily Hub Scratch Notes, Project Card Separator Fix, Figure out New-Tab-Edit-Mode, Project hub Display tweaks. Blocked (need decomposition before autoloop can ship): Workstreams in Projects need updating; Editing To Do Items in a Project. STANDING SUBSTRATE GAP: the BEHIND cycle (handoff-push shoves open PRs behind, needs manual update-branch each wait turn) — durable fix is enabling GitHub 'auto-update head branches' or not pushing handoffs while a PR is open.
