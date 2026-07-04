# Sauce Autoloop Turn 156 — handoff

**Date:** 2026-07-04
**Mode:** live
**Outcome:** work — NEW runHomeScaffoldHealFamily covers applyHomeScaffoldHeal (a genuine untested home heal); installer_migration 1/1; PR #320 open
**Card:** cov-blueprint-home-installer-migration
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
- SCHEDULER: fired by the 4h cron 06e2d66b (session-only). Halt: touch .autoloop-halt / CronDelete 06e2d66b.
- Deploy (Phase A step 3): action=none, all 3 vaults current at 0.193.0 (allOk).
- RECONCILE: idle. WORK (queue item, category=test): cov-blueprint-home-installer-migration (0/1). GENUINE gap (NOT an artifact) — applyHomeScaffoldHeal is a home-specific install heal (scaffold+heal spice/home/Home.md) that was untested anywhere. BUILT.
- FIX (PR #320, auto-merge armed SQUASH): NEW runHomeScaffoldHealFamily in run-seed-migrations.js (HC-HOME-SCAFFOLD-1..2, 10 asserts) drives the real exported applyHomeScaffoldHeal against a throwaway fs-adapter vault — scaffold-when-missing (type:home + SpaceHome/SpaceNavButtons chrome + idempotent) + heal-when-unhealthy (rebuild chrome, preserve user free-write below HOME_CHROME_END marker, .sauce-backup first, idempotent). run-seed-migrations 461/461. Matrix regen: home installer_migration 1/1. Queue item -> done (in PR).
- GATES: Gate A preflight exit 0 (10 HC-HOME-SCAFFOLD) + install exit 0. Gate B L1 = behavioral:false (test-only; run-seed-migrations.js already in preflight) -> not required.
- NEXT (cron) TURN: Phase A reconcile closes #320 once merged. Remaining queue: cov-blueprint-home-widget-render (GENUINE render-guard -> build), bug-meetings-hub-cards-cold-load-guard (category:bug -> BEHAVIORAL cold-load-guard fix + re-add MeetingsHubCards to run-meetings-render-guards.js, gated by Gate B). Session: 10 coverage PRs (9 merged + #320 open) + 1 real bug filed. Handoff committed locally, NOT pushed (PR open).
