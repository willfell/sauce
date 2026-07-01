# Sauce Autoloop Turn 25 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** deploy-canary + pr-open (wait) — canary-deployed 0.149.1 to ERO; PR #112 open, CI green, auto-merge pending (mergeState recomputing after base advanced)
**Card:** project-buttons
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Daily Hub Scratch Notes]]
- [[Project Card Separator Fix]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Project hub Display tweaks]]

### In Progress
- [[Project buttons]]

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[Daily Hub Scratch Notes]]

## Notes
- Deploy (Phase A3, now runs every live turn before reconcile — the PR #111 substrate fix): action=canary -> ERO 0.149.0 -> 0.149.1 (ok:true, allOk). NOTE prod (accuris + headspace) still lags: a new release has shipped almost every turn (0.149.0, 0.149.1), so ERO keeps re-canarying to the newest instead of prod promoting to a soaked version. Prod promotes once releases pause for a turn (canary holds a full turn). Not stuck — expected one-action-per-turn soak. Reconcile: pr-open — PR #112 (project-buttons / AccentButton label truncation, turn 24) is still OPEN. CI is GREEN (preflight macos + ubuntu pass, CodeQL analyze pass); auto-merge armed; mergeState UNKNOWN = GitHub transiently recomputing mergeability after release #113 (v0.149.1) advanced base. It will update-branch + squash-merge now that main is stable. This turn = wait (one reconcile action). 0.149.1 shipped the #111 fix(autoloop) (deploy-every-turn), NOT #112. #112 ships in the next release once it merges. Blocked column unchanged: 'Workstreams in Projects need updating' still parked (design-directional but needs a human-authored slicing plan; not self-advanceable). Next turn: reconcile #112 (merged -> close project-buttons card to Completed + record in ledger; or still pr-open -> wait again).
