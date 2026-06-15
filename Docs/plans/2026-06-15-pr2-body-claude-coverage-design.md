---
cycle_arc: v0.110.0 PR #2 follow-on — seed-harness coverage expansion (BODY-* + CLAUDE-* extension)
kind: design
status: APPROVED — ready for plan
predecessors:
  - Docs/plans/2026-06-14-v0.110.0-migration-regression-net-design.md
  - Docs/plans/2026-06-14-v0.110.0-migration-regression-net-plan.md
base_state:
  workshop_version_on_main: 0.110.2
  pr_branch: cycle/migration-regression-net
  pr_number: 2
  base_commit: e464166 (post-rebase + post-rebaseline)
target_artifacts:
  - platform/test/run-seed-migrations.js (extend in-place)
  - Docs/plans/2026-06-15-pr2-body-claude-coverage-design.md (THIS FILE)
out_of_scope:
  - HC-V0XYZ-SEED-MIGRATE-* backfills for past migrations (deferred — slice A from the handoff)
  - Plugin-data integrity asserts on .obsidian/ allowlist (slice D — deferred)
  - Negative tests (deliberate corruptions) (slice E — deferred)
  - Skip-version coverage via a v0.95 seed (slice F — deferred)
  - R-WIKI-1 pre-existing main flake in run-renderer.js (separate PR)
  - Branch protection on main (operator concern, not in PR)
---

# PR #2 coverage expansion — BODY-* + CLAUDE-* extension

## 0. Why this exists

PR #2 shipped the foundation seed-migration harness with 48 sub-asserts across 7 families (INSTALL/SHAPE/REGISTRIES/FM/PRESERVE/CLAUDE/IDEMP). Real-world failure modes the foundation does NOT cover:

1. **A widget class rename leaves a hub blank.** Existing FM-* asserts only check `type:` frontmatter — they confirm the hub note exists at the right type, but say nothing about whether the dataviewjs blocks inside the body still reference the actual widget classes a consumer's CustomJS engine would load. A rename like `BudgetsCards` → `BudgetsCardList` would pass FM-* but render an empty hub.
2. **A `claude_surface[]` regen silently drops a slash command.** Existing CLAUDE-* asserts confirm markers + populated content + outside-marker prose preserved, but say nothing about which specific rows must be present. A regression dropping `/install` from the resolvers table would pass CLAUDE-5 ("resolvers block populated" — checks for ANY of `/audit` OR `/cowork` — and that's it).

Both classes are silent failures: nothing crashes, install exits 0, but the consumer's vault has visibly-broken pieces only an AI session or a human Cmd+R notice.

## 1. Scope

**In scope:**
- New `HC-V01100-SEED-BODY-*` family: 17 sub-asserts, one per hub note in the seed. Each checks that the hub body (post-install) contains the unique class-name substring of the canonical primary widget for that hub.
- Extension to `HC-V01100-SEED-CLAUDE-*` family: 10 new sub-asserts (CLAUDE-7 through CLAUDE-16). 6 row-content asserts on the populated `resolvers` table; 4 row-content asserts on the populated `directory-map` table.
- Zero seed-vault edits. All assertions read existing seed content. Stays inside landmine #26's no-touch rule.
- Zero helper changes. `readNote` + `String.includes` covers everything.

**Out of scope (this PR):**
- A-MIGRATE backfills (no pre-migration seed edits).
- Plugin-data integrity (D), negative tests (E), skip-version seed (F).
- R-WIKI-1 main flake fix (separate PR — pre-existing in `run-renderer.js`).

**Net delta:** harness 48 → ~75 sub-asserts (+27 / +56%).

## 2. The two new sub-families

### 2a. `HC-V01100-SEED-BODY-*` — one per hub, primary widget class present

Each assert reads the hub note body post-install and checks that the unique class-name substring of the canonical primary widget appears. The check is a plain `body.includes(className)` — robust against shim-vs-direct call patterns (`class: "X"` in `customjs-guard` shim AND `customJS.X.render()` direct-call form both match).

| Tag | Note | Asserted class substring |
|---|---|---|
| BODY-1 | spice/finance/Finance.md | `FinanceHubCards` |
| BODY-2 | spice/finance/Budget Defaults.md | `BudgetDefaultsEditor` |
| BODY-3 | spice/finance/Debt Defaults.md | `DebtDefaultsEditor` |
| BODY-4 | spice/finance/Paycheck Defaults.md | `PaycheckDefaultsEditor` |
| BODY-5 | spice/finance/budgets/Budgets.md | `BudgetsCards` |
| BODY-6 | spice/finance/debts/Debts.md | `DebtsHubSummary` |
| BODY-7 | spice/finance/paychecks/Paychecks.md | `PaychecksCards` |
| BODY-8 | spice/finance/invoices/Invoices.md | `InvoicesCards` |
| BODY-9 | spice/cowork/Cowork.md | `CoworkHubNav` |
| BODY-10 | spice/cowork/Daily Hub.md | `CoworkDailyHubCards` |
| BODY-11 | spice/cowork/Weekly Hub.md | `CoworkWeeklyHubCards` |
| BODY-12 | spice/cowork/Monthly Hub.md | `CoworkMonthlyHubCards` |
| BODY-13 | spice/projects/Projects.md | `ProjectsHubCards` |
| BODY-14 | spice/people/People.md | `PeopleHubCards` |
| BODY-15 | spice/products/Products.md | `ProductsHubCards` |
| BODY-16 | spice/scratch/Scratch.md | `ScratchHubCards` |
| BODY-17 | spice/to-do/All-ToDos.md | `ToDoAllList` |

Class names were verified directly against the rebaselined seed (v0.110.2) prior to writing this design — the seed harness asserts these strings are the actual current widget references.

### 2b. `HC-V01100-SEED-CLAUDE-*` extension (CLAUDE-7 through CLAUDE-16)

Row-specific contents of the populated CLAUDE.md markered surfaces.

| Tag | Surface | Asserted substring |
|---|---|---|
| CLAUDE-7 | resolvers | `/install` |
| CLAUDE-8 | resolvers | `/cowork about` (sub-command pattern, validates space-in-command) |
| CLAUDE-9 | resolvers | `/cowork discover-people` |
| CLAUDE-10 | resolvers | `/daily` |
| CLAUDE-11 | resolvers | `/project` |
| CLAUDE-12 | resolvers | `/upgrade` |
| CLAUDE-13 | directory-map | `spice/resources/` |
| CLAUDE-14 | directory-map | `Runtime plumbing` (ranch row purpose-column content) |
| CLAUDE-15 | directory-map | `.claude/commands/` |
| CLAUDE-16 | directory-map | `.claude/skills/` |

Skills-index is intentionally NOT extended here — the seed's skills-index marker block is empty (header row only), and the platform-claude mechanism doesn't currently populate it. That's a separate workstream.

## 3. Implementation

Single file touched: `platform/test/run-seed-migrations.js`. Two edits:

1. **Extend the existing CLAUDE block** (between current CLAUDE-6 and the idempotency phase). Append CLAUDE-7..16 inside the existing `if (claudeMdExists)` guard. Re-uses the already-read `cm` variable.

2. **Insert a new BODY block** after the CLAUDE block, before the idempotency phase. Use a table-driven loop matching the existing FM-* pattern.

```js
// ===== HC-V01100-SEED-BODY-* — hub bodies reference canonical primary widget class =====
const bodyChecks = [
    ["spice/finance/Finance.md", "FinanceHubCards", "BODY-1"],
    ["spice/finance/Budget Defaults.md", "BudgetDefaultsEditor", "BODY-2"],
    // ... 15 more
];
for (const [relPath, classSubstr, tag] of bodyChecks) {
    let body = "";
    if (helpers.fileExists(vault, relPath)) {
        body = helpers.readNote(vault, relPath);
    }
    ok(
        `HC-V01100-SEED-${tag} ${relPath} body refs ${classSubstr}`,
        body.includes(classSubstr),
        `class missing`
    );
}
```

No helper additions. No seed edits. No new commands. No CI changes — `run-seed-migrations.js` is already wired into `release:preflight` and `ci.yml`.

## 4. Acceptance criteria

1. New BODY-1..17 and CLAUDE-7..16 sub-asserts pass locally on the rebaselined seed (75/75 green).
2. `npm run release:preflight` passes locally modulo the pre-existing `R-WIKI-1 docs-hub-template-body` flake in `run-renderer.js` (separately tracked).
3. CI passes on both `macos-latest` and `ubuntu-latest` on the same modulo basis as (2).
4. Naming follows existing conventions (`HC-V01100-SEED-<FAMILY>-<n>`).
5. Zero seed edits in this PR beyond the rebaseline (committed as a separate prior commit).
6. Zero helper-module changes.

## 5. Risks + mitigations

1. **Hub class names drift in a future cycle.** Mitigation: the seed's rebaseline loop forward-ratchets bodies; future BODY-* asserts must be updated when the seed is rebaselined and the new class name differs. Documented inline as a comment near the bodyChecks table.
2. **Plain `String.includes` false-positive on a class name appearing in unrelated prose.** Mitigation: class names like `BudgetsCards`, `CoworkDailyHubCards`, etc. are unique CamelCase identifiers — vanishingly unlikely to appear in markdown prose. False-negative is the actual concern (class renamed → fail), which is the intended failure mode.
3. **CLAUDE row checks too brittle if registry slug changes.** Mitigation: chose 10 high-leverage rows that have been stable across the last 10+ cycles. If any churn, the assert's failure surfaces the intentional registry change (rebaseline + update the table here).
4. **Increment to a PR that's already CI-red on a different flake.** Mitigation: R-WIKI-1 is documented as out-of-scope; reviewer can see the new asserts pass independently of it.

## 6. Post-merge follow-ups (deferred to maintainer)

- A-MIGRATE backfills for v0.107 + v0.108 finance cluster.
- Plugin-data integrity sweep.
- R-WIKI-1 fix on main (out-of-band).
- Workshop_version bump bookkeeping happens on main, not in this PR (existing convention).
