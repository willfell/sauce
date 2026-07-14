---
phase_closed: phase-2-impl-1
phase_next: phase-3-impl-2
worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
branch: feature/test-coverage-arc
arc_design: Docs/plans/2026-06-16-test-coverage-arc-design.md
arc_plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
audit_doc: Docs/plans/2026-06-16-test-coverage-audit.md
audit_matrix: platform/test/coverage-matrix.json
impl_1_design: Docs/plans/2026-06-16-test-coverage-impl-1-design.md
impl_1_plan: Docs/plans/2026-06-16-test-coverage-impl-1-plan.md
impl_1_result: Docs/plans/2026-06-16-test-coverage-impl-1-result.md
---

# Resume here — Phase 2 (impl-1) closed, Phase 3 (impl-2) next

## Where you are
- Worktree: `/Users/willfellhoelter/projects/repos/sauce-test-coverage` (stays alive across sessions)
- Branch: `feature/test-coverage-arc` (no PR until arc close)
- Just closed: Phase 2 — impl-1 (project installer_migration; 5/5 migrations now covered)
- Current preflight: exit 0, 111/111 green
- Workshop version: 0.119.0 (no bump in this arc)

## What just shipped (impl-1)
- See `Docs/plans/2026-06-16-test-coverage-impl-1-result.md` for full deliverables
- Project's `installer_migration` axis: 0.0 → 1.0
- Project composite: 0.617 → 0.755 (+0.14, within rounding of the +0.15 design target)
- 16 new asserts (HC-V01190-PROJ-SEED-MIGRATE-A1..G1)
- New patterns established: direct-invocation via install.js exports (mirrors HC-V01174 pattern); both impl-2 + impl-3 will use this

## Top-3 picks status (post-impl-1)
- **impl-1**: blueprint/project / installer_migration / seed-migrate — DONE (composite 0.755, priority dropped to 1.37; out of top-3 going forward)
- **impl-2**: blueprint/finance / installer_migration / seed-migrate — NEXT (rank-2; 23 untested apply* fns; this is the biggest of the three)
- **impl-3**: mechanism/entity-create / installer_migration / seed-migrate — QUEUED (rank-3; 2 apply* fns; smallest of the three)

## What's next — Phase 3 (impl-2)
1. Open the arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
2. Jump to Phase 3 section
3. Instantiate with: SURFACE=blueprint/finance, AXIS=installer_migration, ARCHETYPE=seed-migrate, TARGET_FILE=platform/test/run-seed-migrations.js
4. Read `runProjectMigrateFamily()` in `platform/test/run-seed-migrations.js` as a TEMPLATE — impl-2 follows the same pattern (tmp vault from fixture → direct-invoke apply* → assert post-state + idempotency + history)
5. Author a `Legacy Finance Vault` (or similar) fixture with pre-migration shapes covering the 23 finance migrations. Likely need 2-3 fixture subdirectories (legacy debt section, legacy paycheck, legacy budget, legacy months) due to scope.
6. Skill: skip brainstorming (well-bounded). Write impl-2 design + plan inline like impl-1. Then `superpowers:subagent-driven-development` to execute.
7. Phase 4 (impl-3 / entity-create) follows the same pattern. Should be the smallest cycle.

## Hard constraints (don't violate)
- Stay in the worktree
- No per-phase PRs (one giant PR at arc close)
- Re-read arc-design.md if anything feels ambiguous
- Pause for user review between phases (execute the full phase first, then report)
- No emojis in committed files
- No Co-Authored-By Claude trailer
- `npm run release:preflight` must exit 0 before each phase closes

## Carry-forwards
- **Audit doc "Picks for this arc" section** needs MANUAL re-apply after every regen+render (renderer writes the default 3-line stub). Promote override to sidecar JSON in v1.1.0 rubric revision.
- **Extract `makeFsAdapter(root)` helper** in run-seed-migrations.js — there are now two near-duplicate adapter shims (one in `runMigrateFamily()`, one in `runProjectMigrateFamily()`). impl-2 and impl-3 will each add another if not factored.
- **Update `Docs/agent-guides/migration-regression-net.md`** with the direct-invocation recipe codified by HC-V01174 + HC-V01190.
- **Latent install-order bug** discovered in impl-1: in production order, a project with malformed YAML close would silently skip sections[] injection. Filed for v0.120.x.
- **regen-coverage-matrix.js qualitative preservation** — patched in this arc; existing prior matrix's qualitative notes survive subsequent re-runs.

## Pointers
- Arc design: `Docs/plans/2026-06-16-test-coverage-arc-design.md`
- Arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
- Audit: `Docs/plans/2026-06-16-test-coverage-audit.md`
- impl-1 result: `Docs/plans/2026-06-16-test-coverage-impl-1-result.md`
- Template for impl-2 + impl-3: see `runProjectMigrateFamily()` in `platform/test/run-seed-migrations.js`
- Preflight: `npm run release:preflight` (must stay green at each phase close)
