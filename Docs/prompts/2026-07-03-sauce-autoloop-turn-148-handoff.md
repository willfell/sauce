# Sauce Autoloop Turn 148 — handoff

**Date:** 2026-07-03
**Mode:** live
**Outcome:** dismiss — rubric grep-artifact (2nd of class) — applyDocNote* tested in run-v0109/run-wiki-to-docs, applyBreadcrumb generic aggregator; dismissed w/ durable coverage-rubric.js fix recommended as a dedicated card
**Card:** cov-mechanism-breadcrumb-installer-migration
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
- Deploy (Phase A step 3): action=none, all 3 vaults current at 0.190.0 (allOk).
- RECONCILE: idle. Queue top eligible = breadcrumb-installer-migration.
- WORK (queue item, category=test): cov-mechanism-breadcrumb-installer-migration (1/3) -> DISMISSED (no PR). 2nd rubric-artifact dismissal of the same class as scratch. applyDocNoteBreadcrumbMarkerCleanup is genuinely tested (run-v0109 CLN-B-0..5 + run-wiki-to-docs 3 calls) but scoreInstallerMigration only scans run-seed-migrations.js. applyBreadcrumb is a generic install-time registry aggregator (manifest.breadcrumb -> ranch/breadcrumb-registry.json) run for every mechanism, exercised by every full-install test; crediting it here would need exporting it from install.js + full Gate B for marginal value.
- PATTERN / RECOMMENDATION: the installer_migration axis systematically under-credits functions tested OUTSIDE run-seed-migrations.js and mis-attributes generic install primitives (applyRuleFragment/applyAppSettings/applyBreadcrumb) to blueprint surfaces. The DURABLE FIX is a coverage-rubric.js change (scoreInstallerMigration: also scan run-helper-cases.js/run-v0109/run-wiki-to-docs; drop generic-primitive attribution) + a run-coverage-rubric.js CRUB assert. That is a BEHAVIORAL change (not a test-category queue item) and a measurement-system change (higher risk), so it should be a DEDICATED card the user prioritizes, not an autoloop test-item. It would clear the whole remaining installer_migration tail at once.
- FLUSH: no open PR -> pushed handoff 148 + dismissal to origin/main.
- NEXT TURN: only 1 proposed item left (cov-blueprint-meetings-installer-migration — likely the same artifact class -> dismiss). After it drains, Scout re-derives from the matrix (remaining installer_migration axes: daily/nav-buttons/customjs-guard/wiki) -> expect a few more same-class dismissals, THEN the queue empties -> loop transitions to the model bug-hunt path (Phase B step 4) which finds genuine behavioral bugs (real value resumes). Planning still dep-blocked on Workstreams Hub Slice 2.
