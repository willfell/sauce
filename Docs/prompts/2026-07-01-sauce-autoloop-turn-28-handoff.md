# Sauce Autoloop Turn 28 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** pr-open (wait) — unstuck #117 mergeability — #117 was stuck mergeable:UNKNOWN for 2 turns; ran gh pr update-branch -> now MERGEABLE, CI re-running, auto-merge armed
**Card:** project-workstreams-dedicated-hub-plan
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Daily Hub Scratch Notes]]
- [[Project Card Separator Fix]]
- [[Project hub Display tweaks]]
- [[Project Links]]
- [[Project Doc Updating]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- (empty)

## Recommended next
- **Card:** [[Once #117 merges (next-turn reconcile -> idle), pick a fresh Planning card ([[Project Card Separator Fix]] is top); also promote the workstreams plan slices to Planning cards.]]

## Notes
- deploy (Phase A step 3): action=canary — ERO (ero-sauce) upgraded 0.150.1 -> 0.151.0, ok:true (deployed), allOk:true. accuris + headspace promote to 0.151.0 a later turn (one-action-per-turn canary soak). New shipped release 0.151.0 appeared this turn.

reconcile: pr-open — PR #117 (project-workstreams-dedicated-hub-plan) was STUCK at mergeable:UNKNOWN across two turns (~30 min) despite all required checks green + auto-merge armed. Root cause: its branch was based on a now-stale main (pre-0.151.0 releases) and GitHub never recomputed mergeability. Fix: ran `gh pr update-branch 117` (non-destructive 'Update branch'; cannot conflict — doc-only new file). Now mergeable:MERGEABLE, mergeState:BLOCKED (freshly re-triggered CI pending), auto-merge still armed -> it will merge when preflight (macos+ubuntu) goes green.

This is still a WAIT turn (no new card work). Next turn's reconcile should see #117 merged and record it in the ledger (substrate PR, no board card).

Board grew: user added Planning cards [[Project Links]], [[Project Doc Updating]], [[To do tasks daily and other]]. These become selectable once #117 clears (reconcile returns idle). The workstreams epic stays parked in In Progress.

Standing follow-up: promote the workstreams plan slices (Docs/plans/2026-07-01-project-workstreams-dedicated-hub-plan.md) to individual Planning cards so the loop implements them (selector skips In-Progress).
