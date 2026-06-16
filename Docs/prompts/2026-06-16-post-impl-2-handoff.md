---
phase_closed: phase-3-impl-2
phase_next: phase-4-impl-3
worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
branch: feature/test-coverage-arc
arc_design: Docs/plans/2026-06-16-test-coverage-arc-design.md
arc_plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
audit_doc: Docs/plans/2026-06-16-test-coverage-audit.md
audit_matrix: platform/test/coverage-matrix.json
impl_1_design: Docs/plans/2026-06-16-test-coverage-impl-1-design.md
impl_1_plan: Docs/plans/2026-06-16-test-coverage-impl-1-plan.md
impl_1_result: Docs/plans/2026-06-16-test-coverage-impl-1-result.md
impl_2_design: Docs/plans/2026-06-16-test-coverage-impl-2-design.md
impl_2_plan: Docs/plans/2026-06-16-test-coverage-impl-2-plan.md
impl_2_result: Docs/plans/2026-06-16-test-coverage-impl-2-result.md
---

# Resume here — Phase 3 (impl-2) closed, Phase 4 (impl-3) next

## Where you are
- Worktree: `/Users/willfellhoelter/projects/repos/sauce-test-coverage`
- Branch: `feature/test-coverage-arc` (no PR until arc close)
- Just closed: Phase 3 — impl-2 (finance installer_migration; 20/23 covered)
- Current preflight: exit 0, 176/176 green
- Workshop version: 0.120.0 (no bump in this arc)

## What just shipped (impl-2)
- See `Docs/plans/2026-06-16-test-coverage-impl-2-result.md` for full deliverables
- Finance's `installer_migration` axis: 0.0 → 0.87
- Finance composite: 0.629 → 0.783 (**+0.154**, exceeds the +0.15 target)
- 50 new asserts (HC-V01190-FIN-SEED-MIGRATE-A1..I2)
- New shared helper: `makeFsAdapter(root)` at module-level of run-seed-migrations.js (impl-1 carry-forward closed)
- Production bug discovered: `applyFinancePaycheckDefaultsDebtBackfill` phase-1 idempotency marker missing (filed for v0.120.x)

## Top-3 picks status (post-impl-2)
- **impl-1**: blueprint/project — DONE (composite 0.755)
- **impl-2**: blueprint/finance — DONE (composite 0.783)
- **impl-3**: mechanism/entity-create / installer_migration / seed-migrate — NEXT (rank-1 of remaining real gaps; deterministic rank-2 behind cowork rubric noise)

## What's next — Phase 4 (impl-3)
1. Open the arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
2. Jump to Phase 4 section
3. Instantiate with: SURFACE=mechanism/entity-create, AXIS=installer_migration, ARCHETYPE=seed-migrate, TARGET_FILE=platform/test/run-seed-migrations.js
4. Reference both `runProjectMigrateFamily()` and `runFinanceMigrateFamily()` as templates
5. Two apply* fns: `applyNewEntityButtons` + `applyEntityCreateGuardMigration`
6. Skill: skip brainstorming (well-bounded). Write impl-3 design + plan inline like impl-1/2. Then `superpowers:subagent-driven-development` to execute.
7. impl-3 is the SMALLEST of the three cycles — expect ~10-15 sub-asserts total.

## Hard constraints (don't violate)
- Stay in the worktree
- No per-phase PRs (one giant PR at arc close)
- Re-read arc-design.md if anything feels ambiguous
- Pause for user review between phases (execute the full phase first, then report)
- No emojis in committed files
- No Co-Authored-By Claude trailer
- `npm run release:preflight` must exit 0 before each phase closes

## Carry-forwards (cumulative through impl-2)
- **Audit doc "Picks for this arc" section** needs MANUAL re-apply after every regen+render (renderer writes the default 3-line stub). Promote override to sidecar JSON in v1.1.0.
- **Production bug**: `applyFinancePaycheckDefaultsDebtBackfill` phase-1 idempotency marker missing.
- **Rubric denominator noise**: phantom apply* counts inflate denominators (finance 20 real vs 23 counted). Tighten v1.1.0.
- **Update `Docs/agent-guides/migration-regression-net.md`** with the direct-invocation recipe codified by HC-V01174 + HC-V01190 (proj + fin).
- **Latent install-order bug** discovered in impl-1: project sections-migration before close-repair.

## Pointers
- Arc design: `Docs/plans/2026-06-16-test-coverage-arc-design.md`
- Arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
- Audit: `Docs/plans/2026-06-16-test-coverage-audit.md`
- impl-1 result: `Docs/plans/2026-06-16-test-coverage-impl-1-result.md`
- impl-2 result: `Docs/plans/2026-06-16-test-coverage-impl-2-result.md`
- Templates: `runProjectMigrateFamily()` + `runFinanceMigrateFamily()` in `platform/test/run-seed-migrations.js`
- Preflight: `npm run release:preflight` (must stay green at each phase close)
