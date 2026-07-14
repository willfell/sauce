---
phase_closed: phase-1-audit
phase_next: phase-2-impl-1
worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
branch: feature/test-coverage-arc
arc_design: Docs/plans/2026-06-16-test-coverage-arc-design.md
arc_plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
audit_doc: Docs/plans/2026-06-16-test-coverage-audit.md
audit_matrix: platform/test/coverage-matrix.json
---

# Resume here — Phase 1 closed, Phase 2 (impl-1) next

## Where you are
- Worktree: `/Users/willfellhoelter/projects/repos/sauce-test-coverage` (stays alive across sessions)
- Branch: `feature/test-coverage-arc` (long-lived, rebased onto v0.119.0 main; no PR until arc close)
- Just closed: Phase 1 — audit (rebased onto v0.119.0)
- Current preflight: exit 0, 95/95 green (was 89/89 pre-rebase; v0.119.0 added asserts)
- Workshop version: 0.119.0 (rebase absorbed v0.118.1 → v0.119.0 + project 1.22.2 + to-do 0.7.0 + 35 harnesses)
- The `regen-coverage-matrix.js` script now preserves qualitative notes across re-runs (no need to re-fan-out 30 agents each Phase)

## What just shipped (Phase 1)
- `scripts/regen-coverage-matrix.js` — re-runnable audit script
- `scripts/lib/coverage-rubric.js` — per-axis pure scorers
- `scripts/render-coverage-audit.js` — markdown renderer
- `platform/test/blast-radius-seed.json` — hand-curated tiers per surface (31 entries; cowork-reconciler dangling since it has no manifest)
- `platform/test/coverage-matrix.json` — 30 surfaces scored (cowork-reconciler skipped: no manifest.json)
- `Docs/plans/2026-06-16-test-coverage-audit.md` — human audit (319 lines: composite scorecard + per-surface deep dive + ranked queue + override-documented picks)
- Worktree `npm install` ran (ajv etc. now resolvable inside the worktree)

## Top-3 picks (override-documented after qualitative validation)

All three are priority 2.00, same axis (installer_migration), same archetype (seed-migrate), same target file (platform/test/run-seed-migrations.js). They form a coherent triple extending the seed migration regression net.

- **impl-1**: `blueprint/project` / `installer_migration` / `seed-migrate` → `platform/test/run-seed-migrations.js`
  - 5 untested `apply*` migrations: `applyProjectSectionsMigration`, `applyProjectSectionsHubMigration`, `applyProjectSectionsCloseRepair`, `applyEmptyProjectWikilinkRepair`, `applyProjectTodoBackfill`
  - Static source-checks exist in `run-helper-cases.js` but no functional validation against vault adapters

- **impl-2**: `blueprint/finance` / `installer_migration` / `seed-migrate` → `platform/test/run-seed-migrations.js`
  - 23 untested `apply*` migrations across defaults / debts / paychecks / months / budgets scaffolding + healing

- **impl-3**: `mechanism/entity-create` / `installer_migration` / `seed-migrate` → `platform/test/run-seed-migrations.js`
  - 2 untested `apply*` migrations: `applyNewEntityButtons` (registry materialization) + `applyEntityCreateGuardMigration` (vault-wide rewrite)
  - Run on every install; high blast radius; zero seed coverage today

## Picks NOT chosen + why

- **cowork** (deterministic rank-1, customjs_behavioral 0.0): qualitative-validated as rubric noise. `run-cowork-smoke.js` has 954 asserts validating all 9 customjs classes via structural patterns; the deterministic grep heuristic doesn't match. True coverage is much higher than 0.0 suggests. Fixing the rubric heuristic is v1.1.0 carry-forward, not arc work.
- **daily** (deterministic rank-4, customjs_behavioral 0.0): real gap, but `SpaceDailyDashboard.render()` requires a behavioral runner with full dataviewjs surface stub. Architecturally expensive; not the highest-ROI work for this arc. Queue for v0.120.x.

## What's next — Phase 2 (impl-1)

1. Open the arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
2. Jump to Phase 2 section
3. Instantiate the parameters with:
   - `{IMPL_N}` = `1`
   - `{SURFACE}` = `blueprint/project`
   - `{AXIS}` = `installer_migration`
   - `{ARCHETYPE}` = `seed-migrate`
   - `{TARGET_FILE}` = `platform/test/run-seed-migrations.js`
4. Skill to invoke first: `superpowers:brainstorming` to refine the impl-1 sub-design
5. The brainstorm should produce `Docs/plans/2026-06-16-test-coverage-impl-1-design.md`
6. Then `superpowers:writing-plans` → `Docs/plans/2026-06-16-test-coverage-impl-1-plan.md`
7. Then `superpowers:subagent-driven-development` to execute

## Hard constraints (don't violate)
- Stay in the worktree: `/Users/willfellhoelter/projects/repos/sauce-test-coverage`
- Don't open per-phase PRs — one giant PR at arc close
- Re-read `arc-design.md` if anything feels ambiguous
- Pause for user review between phases
- No emojis in committed files
- No Co-Authored-By Claude trailer
- Use `git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage` for git commands

## Carry-forwards from Phase 1 (for v1.1.0 rubric revision or v0.120.x cycles)

- **Rubric heuristic v1.1.0**: teach the scorer to recognize cowork-smoke's structural-assert pattern (would lift cowork composite from 0.4 to ~0.85)
- **Substring-collision false positives** in `scoreIntegrationSmoke`: `daily` matches multiple unrelated test files; `trips` matches `midday-tripwire`; `teams` matches cowork MCP variant. Patch to use word-boundary or class-name matching.
- **Behavioral runner for daily**: `SpaceDailyDashboard.render()` requires a full dataviewjs stub (out-of-scope here)
- **Widget render gap on to-do**: 7 widgets uncovered in run-renderer.js
- **customjs-guard installer migrations**: 2 load-bearing v0.110.x+ migrations only tested at manifest level
- **Meetings + scratch + products + people widget gaps**: each has at least one untested widget render path
- **`recentIncidents` regex**: only matches PATCH version (Z >= 1); misses fixes that land mid-MINOR (carry-forward from Task 1.1 code review)
- **JSON matrix write is not atomic** (no `.tmp` + rename pattern); deferred per code review
- **`scoreManifestSchema` schema_ratio always equals schema_owned**: vacuous; needs real lookup. Deferred per code review.
- **`.gitignore` `/Scripts/` rule case-collides with `scripts/` on macOS**: required `git add -f` for new script files. Latent footgun; consider moving the workshop-root Scripts ignore to a path-specific pattern.

## Pointers
- Arc design: `Docs/plans/2026-06-16-test-coverage-arc-design.md`
- Arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
- Audit doc: `Docs/plans/2026-06-16-test-coverage-audit.md`
- Audit matrix: `platform/test/coverage-matrix.json`
- Audit regen: `node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js`
- Preflight (must pass green at each phase close): `npm run release:preflight`
