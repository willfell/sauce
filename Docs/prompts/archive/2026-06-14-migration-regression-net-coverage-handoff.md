# Next session — extend migration-regression coverage

You're continuing work on PR #2 (branch `cycle/migration-regression-net`) — the foundation cycle for the seed-vault migration regression net. PR is **open and green on CI** at the time of this handoff; the foundation 48 sub-asserts cover install + shape + frontmatter + preservation + claude-surface + idempotency, but very little of the *substance* of past migrations is actually exercised yet.

Your job: **brainstorm and add more assertion coverage on this branch before merge**, then push, watch CI, iterate. Add more failure modes the harness should catch.

---

## Read first (small set, in this order)

1. `Docs/agent-guides/migration-regression-net.md` — how the system works, the sentinel pattern, the per-cycle authoring loop, the 7 existing assert families. Operator manual.
2. `Docs/plans/2026-06-14-v0.110.0-migration-regression-net-design.md` — the spec. Section 5 (assertions) and Section 11 (acceptance criteria) anchor what shipped.
3. `Docs/plans/2026-06-14-v0.110.0-migration-regression-net-plan.md` — the plan that just got executed.
4. `Docs/landmines.md` §26 — sanctioned hand-edits to `seed-vault/` (the new entries you'll be making count as sanctioned).
5. `platform/test/run-seed-migrations.js` — the harness itself. Append new families at the bottom of the `withTempVault` block; mirror the existing style.
6. `platform/test/helpers/seed-vault-helpers.js` — assertion helpers (`parseFrontmatter`, `snapshotTree`, `diffSnapshots`, etc.). Extend as needed; keep zero-dep.

---

## State (at handoff)

- Branch: `cycle/migration-regression-net` (worktree at `.worktrees/migration-regression-net`).
- HEAD: `a3d13f3` (after the CI-portability fix). Rebased on top of v0.109.0 (`a2857b6`).
- PR: https://github.com/willfell/sauce/pull/2 — open, MERGEABLE, CI green.
- Workshop version: 0.109.0 on main. This PR does not bump (post-merge bookkeeping).
- Harness: 48/48 green locally + on macOS + Ubuntu CI.
- Seed: 376 files / ~2.9 MB. `workshop_relative_path = "__SEED_REPO_ROOT__"` (portable sentinel).

---

## Where coverage is thin — pick from this list

These are the areas where the foundation cycle deliberately stayed shallow. The user explicitly wants "a lot of coverage." Brainstorm what's high-value:

### A. Past migrations — backfill `HC-V0XYZ-SEED-MIGRATE-*` families

The foundation cycle has zero MIGRATE-* asserts because there are no in-flight migrations to test. But there's a backlog of recent migrations that *could* be retroactively covered:

- **v0.108.0** — `applyFinanceDebtScaffolding`, `applyFinanceBudgetGroupSeed`, `applyFinancePaycheckDefaultsDebtLinking`, `applyFinanceNavRowMigration`.
- **v0.107.0** — `applyFinanceMigrations` orchestrator (`applyFinanceDefaultsScaffolding`, `applyFinanceCategoriesGroupBackfill`).
- **v0.103.0** — `applyProjectSectionsHubMigration` (huge — 5-step migration; perfect target).
- **v0.102.0** — `applyProjectSectionsMigration`, `applyVaultDefaultPaths`.
- **v0.101.1** — `applyDocsHubButtonRepair`.

For each: add pre-migration-shape data to the seed (sanctioned hand-edits per landmine #26), then add `HC-V0XYZ-SEED-MIGRATE-*` asserts that the migration applied. The `.sauce-backup/<ts>/` snapshot existence + the marker comment (e.g. `__group_seed_migrated: v0.108.0`) + the actual transform (e.g. `groups[]` backfilled, `section:` rewritten to wikilink) are all assertable.

### B. Hub-note body shape (beyond frontmatter)

Current `FM-*` asserts only check `type:`. Hub notes have a lot more contract:
- Every finance hub body should contain its expected `dataviewjs` block with the right CustomJS class name. E.g. `Budget-*.md` must contain `customJS.BudgetSummary.render(dv)`; `Debts.md` must contain `customJS.DebtsHubSummary.render(dv)`.
- `Cowork.md` body should contain the nav-button table.
- `CLAUDE.md` markered surfaces should contain expected rows (the populated resolvers block has specific commands like `/audit`, `/install`, `/cowork`).

### C. Per-blueprint cross-checks

- `ranch/platform-installed.json.blueprints[]` should have an entry for every subscribed blueprint, at the matching pin. Cross-reference the workshop manifest catalogue (landmine #24).
- `ranch/platform-subscription.json` should reference only blueprints that exist in `platform/blueprints/`.
- Materialized claude-surface files (`.claude/commands/*.md`, `.claude/skills/<bp>/<skill>/SKILL.md`) should match what `ranch/claude-surface-registry.json` declares.

### D. Plugin-data integrity

The 18-path `.obsidian/` plugin-data allowlist (landmine #12) is the most foot-gun-prone surface. The harness could assert:
- `customjs/data.json.jsFolder` points at `ranch/scripts/`.
- `templater-obsidian/data.json` has Templater configured correctly.
- `dataview/data.json` has the expected user-property includes.
- `obsidian-tasks-plugin/data.json` schema.
- All `.sauce-backup` files are valid JSON.

### E. Negative tests (deliberate corruptions)

Right now the harness only tests the happy path. Negative coverage would be huge:
- Mutate `ranch/platform-config.json` to be malformed JSON → assert install fails loud (not silently).
- Delete `ranch/platform-subscription.json` → assert install fails loud.
- Symlink a sanctioned path to a non-existent target → assert install handles gracefully.
- Insert a `.sauce-backup` from a too-old version into `.obsidian/plugins/customjs/` → assert install doesn't blow it away unprompted.

### F. Skip-version coverage (the user's stated concern)

The foundation harness checks "v0.108.0 → current install" path. To exercise skip-version explicitly:
- Add a `seed-vault-v0.95.0/` directory holding a frozen state at v0.95.0. Run the harness against THAT seed too (separate phase). Asserts that every migration in the v0.95.0→current chain applies cleanly.
- Or programmatically degrade the v0.108.0 seed to pre-v0.108 schema (e.g. strip `groups[]` from budget notes, downgrade `section: "[[Knowledge]]"` to `section: "Knowledge"`) — closer to a synthetic skip but proves the migration chain.

### G. CI hardening

- Add a workflow-dispatch CI run that uses `KEEP_SEED_VAULT=1` and uploads the post-install tmp vault as an artifact (debugging aid when CI fails).
- Add a check that the seed itself stays under a size cap (e.g. fail if `du -sh platform/test/seed-vault/` exceeds 10 MB; protects against accidental binary commits).
- Cross-platform path-case test: run on Windows runner (`windows-latest`) — currently untested.

---

## Process

Use the brainstorming skill BEFORE writing any code. Walk the user through which of A-G (or combinations) feel highest leverage. The user wants depth, not breadth-for-breadth's-sake — pick areas where a *real* class of bug would have been caught.

Once a slice is chosen:

1. Read the relevant migration source in `platform/install.js` (look for `applyXxx` functions; grep for the cycle version label).
2. Read any helper-cases that already cover the migration via single-file fixtures (`platform/test/run-helper-cases.js` has lots).
3. Decide the *pre-migration-shape* input data to add to the seed. Hand-edit `platform/test/seed-vault/` (sanctioned per landmine #26).
4. Add the assert family to `run-seed-migrations.js`. Follow the `HC-V0XYZ-SEED-MIGRATE-<topic>-<n>` naming convention.
5. Run locally: `node platform/test/run-seed-migrations.js`. Iterate to green.
6. Run full preflight locally: `npm run release:preflight`.
7. Commit per-family (or per-cycle-being-backfilled) with conventional-commits format.
8. Push; watch CI; iterate if red.

---

## Hard rules

- **Don't bump `workshop_version` in this PR.** Cycle-close bookkeeping happens on main post-merge, per the existing convention.
- **No Claude commit trailer.** Per `feedback_no_claude_commit_trailer.md` memory.
- **No emojis.** Anywhere.
- **Zero-dep harness.** Node built-ins only. No npm install for the harness or helpers.
- **Sanctioned seed edits only.** See landmine #26. When in doubt, prefer adding new pre-migration-shape notes over modifying existing ones.
- **Force-push with `--force-with-lease` only.** Plain `--force` forbidden.
- **Rebase off `origin/main` periodically** — other sessions ship PRs to main too. If you find drift, `git fetch && git rebase origin/main` and force-with-lease push.

---

## Recommended starting move

Open with the brainstorming skill. Walk through A-G with the user. Get them to pick 1-2 starting areas (probably A — backfilling MIGRATE asserts — is the highest-leverage; B and D are next). Then execute incrementally with intermediate CI runs.

End state for the next session: PR #2 has substantially more coverage merged in, ready for the user's review-and-merge. Don't merge for them — that's the user's gate.
