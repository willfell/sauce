# Sauce Autoloop Turn 147 — handoff

**Date:** 2026-07-03
**Mode:** live
**Outcome:** dismiss — grep-artifact false gap — applyRuleFragment/applyAppSettings are generic primitives already tested in run-helper-cases.js; rubric only scans run-seed-migrations.js; dismissed with durable-fix note (no PR)
**Card:** cov-blueprint-scratch-installer-migration
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
- Deploy (Phase A step 3): action=none, all 3 vaults current at 0.189.1 (allOk).
- RECONCILE: idle. Blocked empty. Planning dependency-blocked on Workstreams Hub Slice 2. Queue top eligible = scratch-installer-migration.
- WORK (queue item, category=test, fromQueue): cov-blueprint-scratch-installer-migration (2/4) -> DISMISSED (no PR). The 2 'uncovered' fns are applyRuleFragment + applyAppSettings — GENERIC installer primitives, NOT scratch-specific migrations (rubric mis-attributes them to scratch via the module_directory string match). BOTH are already genuinely tested in run-helper-cases.js (applyRuleFragment HC-RF1/2/3 array-support; applyAppSettings AS1-AS5 create/override/preserve/malformed/backup). scoreInstallerMigration only scans run-seed-migrations.js, so it under-credits them. Adding duplicate seed tests = metric-gaming, so dismissed with a note.
- DURABLE FIX (flagged for a future BEHAVIORAL turn, not done here): teach scripts/lib/coverage-rubric.js scoreInstallerMigration to also credit run-helper-cases.js (mirrors the PR #224 scoreWidgetRender dynamic-scan fix) AND/OR stop attributing generic install primitives (applyRuleFragment/applyAppSettings/applyNoteChromeHeal/applyNewEntityButtons) to a blueprint surface. That is a coverage-rubric.js change requiring Gate B + a run-coverage-rubric.js CRUB assert — bigger than a test-category queue item, so left for the user/a dedicated card.
- FLUSH: no open autoloop PR this turn -> pushed deferred handoff 147 (+ the dismissal queue edit) to origin/main via pull --rebase.
- NEXT TURN: idle -> Scout -> next tail items (breadcrumb/meetings/daily/nav-buttons/customjs-guard/wiki installer_migration + single customjs_behavioral axes). EXPECT more grep-artifact dismissals like this one — assess each: genuine seed-migration coverage vs already-tested-elsewhere / generic-primitive mis-attribution.
