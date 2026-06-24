# compute-release seed-pin sync (result)

**Date:** 2026-06-24
**Branch:** `fix/compute-release-seed-pin-sync` → PR → main
**Status:** shipped (Half 1). Half 2 (branch-protection) carried forward.

## What shipped

`compute-release.applyPlan` now mirrors per-component version bumps into the seed-vault subscription pins, so the auto-release pipeline can ship blueprint/mechanism bumps through `prepare-release` without `run-seed-migrations.js` skewing.

- **`scripts/release/compute-release.js`** — `applyPlan` gains a seed-vault subscription block right after the workshop `ranch` block: updates `platform/test/seed-vault/ranch/platform-subscription.json` per-item pins (by-name match against the bumped components). **Per-item ONLY** — the seed's `workshop_version` (intentionally frozen → drives migration coverage) and its installed state are left to the post-merge `rebaseline-seed` job.
- **`platform/test/run-release-bumper.js`** — write-path case extended: `HC-V0129-RELEASE-WRITE-I` (seed sub component pin bumps) + `HC-V0129-RELEASE-WRITE-J` (seed sub `workshop_version` untouched). Harness 43 → 45 asserts.

## Root cause

`platform/install.js:1307` reconciles subscription vs catalogue with an **exact-match** check (`target.version !== sub.version` → skip). `run-seed-migrations.js` installs into a copy of `platform/test/seed-vault/`, which carries its own `ranch/platform-subscription.json`. `compute-release` updated the workshop's ranch pins but not the seed's, so a blueprint bump left the seed pin lagging → finance skipped → install exit 1 → preflight red → `prepare-release` couldn't ship component bumps. (Manual cycles worked because a human bumped the seed pin; the v0.131.0 ship did exactly that as a workaround.)

## Verification

- **Unit (regression):** `run-release-bumper.js` 45/0 — WRITE-I/J lock the pin-sync + the per-item-only invariant. Confirmed RED before the fix (WRITE-I failed).
- **Integration repro (reversible, in worktree):**
  - *Bug:* bump catalogue finance 0.11.0→0.12.0 with no seed-sub edit → `run-seed-migrations` **EXIT 1** (`INSTALL-1 install exit code 0` fails, code=1).
  - *Fix:* `applyPlan(finance→0.12.0)` → seed sub finance synced to 0.12.0, seed sub `workshop_version` unchanged (0.117.3) → `run-seed-migrations` **EXIT 0** (INSTALL-1 + MIGRATE-PLAN-1 pass).
- **Whole-suite:** `npm run release:preflight` **EXIT 0** (run-seed-migrations green, finance 51/0 + 32/0, run-release-bumper 45/0).

## Manual smoke

N/A — release tooling only (no blueprint UI surface change).

## Carry-forward — Half 2 (branch-protection vs bot-opened release PR)

This fix makes `prepare-release`'s **preflight pass** on blueprint bumps. The release **PR** it opens is still `BLOCKED` by `main`'s branch protection (required `preflight (…)` Actions checks don't run on GITHUB_TOKEN-opened PRs; API-posted statuses don't satisfy app-pinned required checks). Options (maintainer's security-posture call, token-gated): **PAT-for-PR** (release PR triggers real CI → clean merge; needs a `RELEASE_PAT` secret + a `release.yml` change), **admin-merge convention** (owner merges bot PRs via admin override; bumps already preflight-validated), or **commit → tag-and-ship** (the v0.131.0 manual path). See the design doc § Half 2.

## Commits

- `docs(release): seed-pin sync design …`
- `docs(release): seed-pin sync implementation plan`
- `fix(release): compute-release mirrors per-item bumps into seed-vault subscription pins`
- `docs(release): seed-pin sync result doc`
