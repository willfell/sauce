# Sauce Autoloop Turn 132 — handoff

**Date:** 2026-07-02
**Mode:** live
**Outcome:** work — phantom coverage gap from stale coverage-matrix snapshot — regenerated matrix (7/15 -> 20/20) + gate.js splitDiff exclusion + SD-6/7; PR #277 open, auto-merge armed
**Card:** cov-blueprint-project-installer-migration
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
- Deploy (Phase A step 3): action=none, target=0.184.4, all 3 vaults (ero/accuris/headspace) ok at 0.184.4 — nothing behind. RECONCILE: idle (no in-flight PR). Blocked column empty. selectCard: no-eligible-work (Planning Slices 3-6 dependency-blocked on Slice 2, parked In Progress). Fell to Scout queue.
- WORK (queue item, category=test, fromQueue): cov-blueprint-project-installer-migration. FINDING: PHANTOM gap. The 8 project installer_migration heals are ALREADY covered by runProjectInstallerMigrationCoverageFamily (run-seed-migrations.js, landed PR #256) with faithful before/after + idempotency asserts — but coverage-matrix.json was last regenerated in PR #224 (before #256), so the Scout re-proposed the stale 7/15 gap every idle turn.
- FIX (PR #277, auto-merge armed SQUASH): (1) regenerated platform/test/coverage-matrix.json via regen-coverage-matrix.js — deterministic (re-run yields zero further diff); project installer_migration now 20/20, whole matrix reflects coverage landed since #224. (2) gate.js splitDiff now excludes platform/test/coverage-matrix.json from behavioral source (mirrors package.json/queue exclusion) so a generated-snapshot refresh is not miscounted as an untested behavioral change. (3) run-autoloop-select.js SD-6/SD-7 lock it (red without the fix, green with).
- GATES: Gate A preflight NPMEXIT=0 + dogfood install exit 0. Gate B L1 verify-adequacy --base origin/main = {behavioral:true, adequate:true}. Gate B L2 3-lens panel = pass, 0/3 refutes (correctness/regression/test-adequacy all cleared with grounded verification). PR opened from origin/main; update-branch'd past v0.184.6 + 2 features (mergeState BEHIND is API lag; no file overlap).
- QUEUE: cov-blueprint-project-installer-migration -> status:done (note: already covered by #256; stale snapshot). The 4 other Scout appends stay proposed and ARE genuine post-regen gaps: task-entity customjs_behavioral (17/19), task-entity widget_render (1/4), wiki widget_render (0/3), trips widget_render (0/3). Queue resolution committed to main via this handoff (NOT in PR #277 — PR carries platform code only).
- NOTE for next turn: PR #277 is a queue PR (no board card) — Phase A reconcile closes it (record ledger + reap branch) once merged+shipped. Handoff committed locally, NOT pushed this turn (open PR, per anti-BEHIND rule).
