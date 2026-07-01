# Sauce Autoloop Turn 22 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** unblock+implement+PR — user-resolved blocker -> implemented editable Owned Tasks on project To-Do notes; Gates A+B green; PR #108 open, auto-merge pending
**Card:** Editing To Do Items in a Project
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project buttons]]
- [[Daily Hub Scratch Notes]]
- [[Project Card Separator Fix]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Project hub Display tweaks]]

### In Progress
- [[Editing To Do Items in a Project]]

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[Project buttons]]

## Notes
- Reconcile: in-flight idle. Collaborative-unblock: TWO Blocked cards had user responses. Card 1 'Workstreams in Projects need updating' — reply resolves design INTENT (source-of-truth = the workstream note; remove from hub; nav button; careful migration) but the block note itself flags it a multi-surface re-architecture that must be SLICED, its UI is Obsidian-runtime (not Node-testable), and one sub-decision (repurpose Map vs a new note) is still soft. Left BLOCKED — needs a deliberately-authored slicing plan (human/plan pass), not one bounded autoloop turn. Card 2 'Editing To Do Items in a Project' — reply ('attention to detail these migrations... confirmed') cleanly approved the mapped fix. TAKEN as this turn's work. Implemented: project-todo Owned Tasks now render the daily-hub TodayCaptureEditableList (functional checkbox + pencil). task-interactions ownedTasks anchor/inject/find + appendTask-below-marker; TodayCaptureEditableList.render(dv,opts) anchor param; manifest + applyProjectTodoBackfill scaffold born-editable; ungated idempotent .sauce-backup heal for existing notes anchoring BOTH the SectionLabel and the '## Owned Tasks' H2 forms. Gate A: preflight 142/142 + dogfood install exit 0 (new heal step runs clean; workshop has no project-todo notes so it healed 0). Gate B L1: mutation adequate. Gate B L2: 3-lens panel PASS both runs (1/3 refuted). Round-1 regression (dialog _insertLineUnderSection landed project tasks ABOVE the marker => invisible) FIXED + tested (DLG-OWNED-*). Round-2 correctness (heal missed the '## Owned Tasks' H2 form) FIXED + tested (PT-HEAL-h2-*). Did NOT re-run a 3rd full panel for the mechanical H2 extension — deterministic gates cover it. PR #108 open on branch autoloop/editing-todo-in-project; auto-merge (squash) ARMED, waits on macOS+Ubuntu CI. Worktree reset clean after dogfood install; ranch/ dogfood churn NOT committed (the release pipeline regenerates it). Follow-ups: (a) Card 1 workstreams re-arch needs a slicing plan before it is actionable. (b) Pre-existing cosmetic: project-todo manifest inline_body still uses '## Owned Tasks' / '## From Meetings' H2 (note-chrome), untouched here; the heal now tolerates it. (c) Deploy step (Phase A7 canary->promote) skipped this turn because the unblock path short-circuits to Phase C; it runs next idle turn.
