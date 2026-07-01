# Sauce Autoloop Turn 50 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** reconcile:merged -> closed Project Doc Updating — PR #139 (DocMove phase 1) merged (update-branch unstick from turn 49 worked). Moved 'Project Doc Updating' In Progress -> Completed (completed_in_version v0.156.0), recorded #139 (ledger 16). Reconcile now idle.
**Card:** Project Doc Updating
**Version shipped:** v0.156.0

## Board snapshot (after this turn)

### In Planning
- [[Project Links Wiring]]
- [[Project Doc Updating Wiring]]
- [[Project Doc Move Cross-Project]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Project Links Wiring]]

## Notes
- Deploy (Phase A step 3): action=none, bottle 0.155.0, all 3 vaults current at 0.155.0. Main manifest is 0.156.0 (DocMove bump) but NOT tagged/shipped yet; DocMove is a pure helper with NO consumer yet (phase-2 wiring pending), so the unshipped 0.156.0 is cosmetic — nothing user-facing waits on it. RELEASE CHURN (flagged, not urgent): main=0.156.0, latest tag=v0.155.0, open release PR #142 'chore(release): v0.157.0' with auto-merge armed + CI IN_PROGRESS (not the BEHIND wedge — just checks running; it'll auto-merge when green). Each autoloop handoff push to main re-triggers/re-bumps a release PR, so tag/ship keeps deferring one version behind. NOT poked this turn (CI-pending, not stuck). DURABLE FIX still needed (user/pipeline): release.yml auto-update-branch or reduce handoff-to-main churn; see turn-48/49 handoffs. Session recap: [[Project Links]] (links mechanism, shipped+LIVE 0.155.0 all vaults) and [[Project Doc Updating]] (DocMove pure helper, merged, ships in 0.156.0) both COMPLETE. Three phase-2 follow-up cards in Planning: Project Links Wiring, Project Doc Updating Wiring, Project Doc Move Cross-Project. NEXT TURN (idle): Phase A Blocked reconcile — 'Figure out Why Opening up a New Tab always opens up in Edit Mode' (no reply) + 'To do tasks daily and other' ('-', insufficient) both stay Blocked -> Phase B selects 'Project Links Wiring' from Planning (recommended next). NOTE: that card is a LARGE phase-2 feature (Link Hub note + button + hub display + add/delete/modify dialogs + installer scaffolding) — expect it to be scoped/split or block-with-questions if it balloons.
