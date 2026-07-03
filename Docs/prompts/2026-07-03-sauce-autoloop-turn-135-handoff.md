# Sauce Autoloop Turn 135 — handoff

**Date:** 2026-07-03
**Mode:** live
**Outcome:** work — added TaskDialog.markDone/markDeleted instance coverage (TD-MD-1..5) + matrix regen 17/19->20/20; PR #285 open, auto-merge armed
**Card:** cov-mechanism-task-entity-customjs-behavioral
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Move Cross-Project]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]

### In Progress
- [[Cross-blueprint templating and render consistency audit]]
- [[Workstreams in Projects need updating]]
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]

### Blocked
- (empty)

## Recommended next
- **Card:** NONE

## Notes
- Deploy (Phase A step 3): action=deploy then verified none — all 3 vaults (ero/accuris/headspace) current at 0.185.2 (allOk).
- RECONCILE: idle (PR #277 already merged+reaped last turn). Blocked empty. Planning still dependency-blocked on Workstreams Hub Slice 2. Fell to Scout queue.
- WORK (queue item, category=test, fromQueue): cov-mechanism-task-entity-customjs-behavioral. Uncovered methods were TaskDialog.markDone + TaskDialog.markDeleted (the path-based one-tap complete/delete internals surface widgets call, e.g. TaskTodayList's row checkbox). Only the pure donePath/trashPath helpers had coverage (TD-4/5).
- FIX (PR #285, auto-merge armed SQUASH): added TD-MD-1..5 to run-task-entity.js driving both methods through an INSTANCE with a spying app — assert status=done+completed_at then move to _done via donePath; status=deleted then move to _trash via trashPath; cold-load {ok:false app unavailable} + unknown-path {ok:false task file not found} with no rename, never throws. run-task-entity 76/0. Regenerated coverage-matrix.json (deterministic): task-entity customjs_behavioral now 20/20. Queue item -> done (in the PR).
- GATES: Gate A preflight exit 0 + dogfood install exit 0. Gate B L1 = behavioral:false (test-only + generated matrix + queue excluded via gate.js splitDiff from PR #277) -> Gate B not required, no panel. PR opened from origin/main; update-branch'd past v0.186.0 + home feature (BEHIND -> BLOCKED, CI re-running); no file overlap.
- NEXT TURN: Phase A reconcile closes #285 (queue PR, no board card) once merged. Then idle -> Scout -> next genuine gap: task-entity widget_render (1/4), then wiki widget_render (0/3), trips widget_render (0/3). Handoff committed locally, NOT pushed (PR open, anti-BEHIND).
