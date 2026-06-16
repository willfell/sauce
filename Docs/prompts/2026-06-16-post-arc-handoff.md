---
arc_closed: test-coverage-arc
worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
branch: feature/test-coverage-arc
pr_url: <to-be-filled-after-Task-5.4>
---

# Post-arc handoff

## Where you are

Arc closed. PR opened (see `pr_url` in frontmatter).

Worktree stays alive until PR merges. After merge:

```bash
git -C /Users/willfellhoelter/projects/repos/sauce worktree remove /Users/willfellhoelter/projects/repos/sauce-test-coverage
```

(Run from the main checkout; the worktree path won't be valid cwd after removal.)

## What this arc shipped

- See `Docs/plans/2026-06-16-test-coverage-arc-result.md` for full deliverables.
- Headline: 81 new sub-asserts; 3 surfaces lifted; preflight 126 → 191; 2 production bugs discovered; direct-invocation migrate-family pattern now battle-tested 4 times.

## Re-running the audit later

```bash
cd /Users/willfellhoelter/projects/repos/sauce  # or wherever main is checked out post-merge
node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js
```

- Updates `platform/test/coverage-matrix.json` + `Docs/plans/2026-06-16-test-coverage-audit.md`.
- Qualitative notes from the 30-agent fan-out are preserved across re-runs (patch applied in this arc).
- The "Picks for this arc" section in the audit markdown is auto-overwritten by the renderer to the default 3-line stub. Manual re-apply needed until v1.1.0 promotes picks-override to a sidecar JSON. Reference the arc-close override block in `Docs/plans/2026-06-16-test-coverage-audit.md` (committed at the arc-close commit) when re-applying.

## Follow-on cycles in the queue (from carry-forwards)

### v0.120.x (real production-relevant bugs + remaining test gaps)

| Item | Source | Notes |
|---|---|---|
| Production bug: `applyFinancePaycheckDefaultsDebtBackfill` phase-1 idempotency marker missing | impl-2 discovery | Real, reproducible. Phase-1 re-injects `debt:` on every install pass against items mangled by phase-2's orphan-append. |
| Latent install-order bug: `applyProjectSectionsMigration` runs before `applyProjectSectionsCloseRepair` | impl-1 discovery | A project with malformed `-"[[--]]"` YAML close silently skips `sections[]` injection. |
| Widget render gap: ~38 widgets uncovered across 6 blueprints/mechanisms | audit | 7 to-do + 5 scratch + 1 meetings + 3 products + 11 project + 12 finance |
| customjs-guard installer migrations only manifest-tested | audit | 2 load-bearing v0.110.x+ migrations |
| platform-claude integration_smoke gap | audit | End-to-end install → CLAUDE.md flow not exercised |
| Behavioral runner for `SpaceDailyDashboard` (daily blueprint) | audit | Architectural mismatch requires full dataviewjs stub |

### v1.1.0 rubric revision

- Codify direct-invocation pattern + Notice shim recipe in `Docs/agent-guides/migration-regression-net.md`.
- Tighten `scoreInstallerMigration` denominator (phantom helper-fn matches inflate by ~3 on finance, miss applyNewEntityButtons on entity-create).
- Recognize cowork-smoke's structural-assert pattern (would lift cowork composite from 0.4 to ~0.85).
- Patch substring-collision false positives in `scoreIntegrationSmoke` (`daily`, `trips`, `teams`).
- Read picks-override from a sidecar JSON file (eliminate manual re-apply after every render).

## Pointers

- Arc design: `Docs/plans/2026-06-16-test-coverage-arc-design.md`
- Arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
- Audit: `Docs/plans/2026-06-16-test-coverage-audit.md`
- Per-cycle results: `Docs/plans/2026-06-16-test-coverage-impl-{1,2,3}-result.md`
- Templates (now battle-tested 4 times): `runProjectMigrateFamily()` + `runFinanceMigrateFamily()` + `runEntityCreateMigrateFamily()` in `platform/test/run-seed-migrations.js`
- Shared helper: `makeFsAdapter(root)` in `platform/test/run-seed-migrations.js`
- Preflight: `npm run release:preflight` (was 126/126 pre-arc, now 191/191)
