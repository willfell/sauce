---
arc: test-coverage-arc
phase: phase-4-impl-3
status: closed
closed_at: 2026-06-16
surface: mechanism/entity-create
axis: installer_migration
archetype: seed-migrate
target_file: platform/test/run-seed-migrations.js
---

# Impl-3 result — entity-create mechanism installer migrations

## What landed

### Pre-impl-3 prep
- Rebased onto v0.120.1 main (4 new commits absorbed: v0.120.1 PATCH + cycle-history backfill)
- Lockfile refreshed for v0.120.1

### Seed-vault fixtures (commit b11f2f87)
3 files under `platform/test/seed-vault/spice/entity-create-legacy/`:
- `Legacy Hub.md` — direct-call EntityCreate render (triggers guard migration)
- `Legacy Detail.md` — direct-call EntityCreate (different instance; verifies vault-walk recursion)
- `Already Guarded.md` — already in guard form (idempotency test target)

### Harness extension (commit 1b641944 + per-sub-family commits)
- `runEntityCreateMigrateFamily()` function in `platform/test/run-seed-migrations.js`
- Both entity-create apply* fns directly invoked
- 15 sub-asserts in HC-V01190-EC-SEED-MIGRATE-*:
  - A1-A5 (5): applyNewEntityButtons — registry shape + verify-mode history event
  - B1-B5 (5): applyEntityCreateGuardMigration — direct->guard rewrite + already-guarded byte-identity
  - C1-C3 (3): idempotency — second invocation byte-identity + no duplicate contributions
  - D1-D2 (2): history audit-trail — >=2 events + no populated errors[]

### install.js exports (commit c997c4e7)
Pure-additive `module.exports.applyNewEntityButtons` line. `applyEntityCreateGuardMigration` was already exported.

## Composite lift
- Pre-impl-3 entity-create composite: 0.778 (rebased v0.120.1 baseline)
- Post-impl-3 entity-create composite: 0.983
- Delta: **+0.205** (well above the +0.15 target)
- installer_migration axis: 0.0 → 1.0 (1/1 covered — audit denominator was 1, not 2 as design expected; applyNewEntityButtons matched a different surface or didn't match at all in the rubric's name-based attribution)

Entity-create's priority_score dropped from 2.00 to 0.08 — completely off the leaderboard. Composite of 0.983 is the highest-scoring mechanism in the matrix.

## Preflight
- exit 0, **191/191 green** (was 176/176 pre-impl-3; +15 new asserts)

## Plan-vs-implementation deviations

5 deviations, all source-verified per the v0.94.0 "verify helpers before design" rule:

1. **A5 predicate rewritten (load-bearing)**: Plan A5 was a 3-way OR checking Hub body text for AccentButton/entity-create/new-doc-button. Reading `applyNewEntityButtons` (install.js:3083) + `injectAccentButtonBlock` (install.js:3531) revealed the function is **VERIFY-ONLY since v0.49.0**: it does NOT edit the hub file. It only pushes a history event (entity_create_block_verified or entity_create_block_missing). Plan's A5 would have always failed. Replaced with: assert history contains a row with step in {entity_create_block_verified, entity_create_block_missing}, target === "spice/entity-create-legacy/Legacy Hub.md", instance === "legacy-doc". With our fixture (no sentinel comment in dataviewjs fence), action is `missing_skip_inject`.

2. **Synthetic manifest shape corrected (load-bearing)**: Plan used `folder_prefix` at top-level + omitted `prompts`. Reading `resolveEntityCreateEntry` (install.js:3368) showed required keys: id (regex), label, prompts: [] (Array required), destination.folder_prefix + destination.filename_prefix (nested), frontmatter_template (object). Built compliant manifest.

3. **`Notice` shim required**: Plan didn't mention. `applyNewEntityButtons` + `injectAccentButtonBlock` construct `new Notice(...)` on validation warnings. Added `global.Notice = global.Notice || class Notice {...};` at family entry with `prevNotice` restore in `finally` (matches `run-install.js` shim approach).

4. **A4 tightened**: Plan said `>= 2`. Made it `=== 2` since manifest declares exactly 2 entries — stricter contract.

5. **Skeleton try/finally**: Used `try { ... } finally { fs.rmSync(...) }` pattern matching finance/project + `helpers.copyDir` instead of `fs.cpSync`.

## Lessons / discoveries

### 1. v0.94.0 "verify helpers before design" reinforced twice in one cycle
A5 predicate (verify-only semantics) + synthetic manifest shape (nested destination object + required prompts array) were BOTH plan errors that source-reading caught early. The impl-2 production bug discovery + impl-3 verify-mode discovery both confirm: the design phase MUST include reading the migration source, not just naming it.

### 2. Notice shim is a missing recipe-element
`applyNewEntityButtons` (and likely others) use Notice for validation warnings. Other migrate families (project, finance) don't trip it because their fixtures don't hit validation paths. Carry-forward: codify the Notice shim in the direct-invocation recipe documentation.

### 3. Audit denominator can be 1
The rubric attributed 1 finance apply* fn to entity-create (denominator = 1, not 2 as the design expected). Covering 1/1 lifts to 1.0 trivially. The 2nd fn (`applyNewEntityButtons`) is presumably matched to a different surface by the rubric's name-based heuristic (the function name doesn't contain "entity-create" as a substring). Adjusts axisweight calculation slightly but doesn't change the conclusion: impl-3 closed the gap.

### 4. Direct-invocation pattern is now battle-tested
HC-V01174 (v0.117.4 to-do) + HC-V01190-PROJ (impl-1) + HC-V01190-FIN (impl-2) + HC-V01190-EC (impl-3) = 4 instances of the pattern. It's now the standard recipe. Document it in `Docs/agent-guides/migration-regression-net.md` as v1.1.0 work.

## Carry-forwards

### To arc-close (Phase 5)
- Open mega-PR
- Document the arc's full deliverables in arc-result.md
- Worktree teardown after PR merges

### To v0.120.x cycles
- **Production bug**: applyFinancePaycheckDefaultsDebtBackfill phase-1 idempotency marker missing (from impl-2).
- **Latent install-order bug** in project (from impl-1): sections-migration before close-repair causes silent skip on malformed-FM projects.

### To v1.1.0 rubric revision
- Codify direct-invocation pattern + Notice shim recipe in `Docs/agent-guides/migration-regression-net.md`.
- Tighten `scoreInstallerMigration` heuristic to skip helper underscores OR verify against orchestrator dispatch.
- Read picks-override from a sidecar JSON file.
- Recognize cowork-smoke's structural-assert pattern.
- Patch substring-collision false positives.

### To v0.120.x (additional gap-closing cycles)
- Widget render gap: 7 to-do + 5 scratch + 1 meetings + 3 products + 11 project + 12 finance widgets uncovered.
- customjs-guard installer migrations (2 load-bearing migrations only tested at manifest level).
- platform-claude integration_smoke (end-to-end install → CLAUDE.md flow not exercised).
- Behavioral runner for SpaceDailyDashboard.
