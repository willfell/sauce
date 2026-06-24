# compute-release seed-pin sync (design)

**Date:** 2026-06-24
**Status:** approved (analysis confirmed) — implementing
**Topic:** Fix the auto-release pipeline so `prepare-release` can ship **blueprint/mechanism** bumps. `compute-release.js` must mirror per-component version bumps into the seed-vault subscription pins, or `run-seed-migrations.js` skews and preflight fails.

## Problem (the decisive finding)

`prepare-release` runs `compute-release.js --write` then `npm run release:preflight`. A component (e.g. finance) bump makes preflight fail at `run-seed-migrations.js` — so the pipeline cannot ship any blueprint/mechanism bump. (Confirmed in the v0.131.0 ship, worked around manually via a `chore(release)` commit → `tag-and-ship`.)

## Root cause (confirmed in code)

The installer reconciles the consumer's subscription against the workshop catalogue with an **exact-match** check — `platform/install.js:1307`:

```js
if (target.version !== sub.version) {
  skipped.push({ name: sub.name,
    reason: `subscription pins ${sub.name}@${sub.version} but workshop has ${target.version}` });
}
```

`target` = catalogue entry (`platform/manifest.json`), `sub` = subscription pin. **Any** mismatch (even a patch) → the item is **skipped**, not installed.

`run-seed-migrations.js` installs the workshop into a copy of `platform/test/seed-vault/`, which carries its **own** `ranch/platform-subscription.json`. `compute-release.applyPlan` updates these version records:

1. `platform/manifest.json` (catalogue) — workshop_version + per-component
2. `platform/<path>/manifest.json` (per-component manifests)
3. `ranch/platform-subscription.json` (the **workshop's own** pins)
4. `package.json`
5. `platform/test/fixtures/component-versions.snapshot.json`

It does **not** touch `platform/test/seed-vault/ranch/platform-subscription.json`. So a blueprint bump moves the catalogue to (say) finance 0.11.0 while the seed's subscription still pins 0.10.x → `target.version !== sub.version` → finance **skipped** in the seed install → finance never installed/migrated → the finance SEED assertions fail → preflight red → `prepare-release` fails.

**Why the manual cycle works:** the human bumps the seed pin too. (origin/main's seed pin is already finance 0.11.0 — the v0.131.0 ship did it by hand.) compute-release simply never automated that one record.

## Evidence: the seed's intentional version shape

Observed on origin/main:

| Record | finance | workshop_version |
| --- | --- | --- |
| catalogue (`platform/manifest.json`) | 0.11.0 | 0.131.0 |
| seed **subscription** pin | **0.11.0** (tracks catalogue) | **0.117.3** (frozen) |
| seed **installed** state (`platform-installed.json`) | 0.9.2 (old) | (old) |

Two invariants this reveals, which the fix MUST respect:

1. **Per-item subscription pins track the catalogue.** They must equal the catalogue per-item or the install skips them (line 1307). This is the record compute-release must sync.
2. **The seed's `workshop_version` (sub + installed) is intentionally frozen/old.** The skip check is per-item and never reads `workshop_version`; the staleness is what makes the install actually *run migrations* (old installed state → current catalogue). Bumping it risks under-running version-gated migrations and is unnecessary. **Leave it.**

## Fix (Half 1 — the decisive fix; this PR)

In `applyPlan`, after the existing workshop-`ranch` update, mirror the bumped per-item versions into the seed-vault subscription — **per-item pins ONLY**, never `workshop_version`:

```js
// seed-vault subscription pins — per-item ONLY. The installer's skip check is
// per-item (install.js:1307), so a component bump must move the seed's matching
// pin too or run-seed-migrations skews + skips it. Leave the seed's
// workshop_version (intentionally frozen → drives migration coverage) and its
// installed state alone (the post-merge rebaseline-seed job owns those).
const seedSubPath = path.join(root, "platform/test/seed-vault/ranch/platform-subscription.json");
if (fs.existsSync(seedSubPath)) {
    const seed = JSON.parse(fs.readFileSync(seedSubPath, "utf8"));
    for (const arr of [seed.blueprints || [], seed.mechanisms || []]) {
        for (const c of arr) if (toByName[c.name]) c.version = toByName[c.name];
    }
    writeJson(seedSubPath, seed);
}
```

Only components the seed actually subscribes to get touched (by-name match); components not in the seed sub are left alone (and aren't skipped, since the installer only reconciles subscribed items). Umbrella-only releases (no component change) → `toByName` empty → no seed-pin change.

**Not in scope of the bumper (unchanged):** the seed's installed content + `workshop_version` are rebaselined by the post-merge `rebaseline-seed` job, never on-branch (the v0.124.0 landmine). This fix is a *pin* sync, not a content rebaseline — distinct, and safe on-branch (it's exactly what the manual cycle does).

## Tests

- **Regression (unit):** extend `platform/test/run-release-bumper.js`'s write-path case with a `platform/test/seed-vault/ranch/platform-subscription.json` fixture carrying a component pin + a frozen `workshop_version`. After `applyPlan`, assert: (a) the seed component pin bumped to the new version, (b) the seed `workshop_version` is **unchanged**. Locks the per-item-only contract against regression.
- **Repro + fix (integration, worktree):** artificially bump one component's catalogue version with no seed-pin change → `run-seed-migrations.js` fails with the `subscription pins … but workshop has …` skip. Then run `compute-release.js --write` (with the fix) → seed pin moves → `run-seed-migrations` green.
- **Whole-suite:** `npm run release:preflight` green (no version bump in the PR → no real skew introduced; the fix is preventive for future bumps).

## Half 2 — branch-protection vs the bot-opened release PR (analysis; NOT this PR)

Even after Half 1, the release PR that `prepare-release` opens is `BLOCKED`: `main`'s branch protection requires the `preflight (macos-latest)` + `preflight (ubuntu-latest)` Actions check-runs (pinned to `app_id 15368`), but a PR opened by the default `GITHUB_TOKEN` does not trigger Actions, so those checks never appear. API-posted commit statuses don't satisfy an app-pinned required check (verified).

This is a **separate** concern from the seed bug, affects **every** release (not just blueprint bumps), and has a working manual workaround (the `chore(release)` commit → `tag-and-ship` path used for v0.131.0). Options, with trade-offs:

| Option | Effect | Cost |
| --- | --- | --- |
| **PAT-for-PR (recommended for hands-off)** | `prepare-release` opens the release PR with a `RELEASE_PAT` → the PR triggers real CI → it merges cleanly (no admin) | Reintroduces one long-lived secret; needs a `release.yml` change (workflow-scope push → user-deployed) |
| **Admin-merge convention** | Owner merges each bot PR via admin override; bumps are already preflight-validated in `prepare-release` | One admin click per release; branch protection intact |
| **commit → tag-and-ship** | Keep the v0.131.0 manual path; skip the release-PR gate | Manual `chore(release)` commit per release; no auto release PR |

Why Half 2 is **out of this PR:** it requires a `release.yml` change (Claude's OAuth scope can't push workflow YAML) **and** a secret/branch-protection decision that is the maintainer's security-posture call. It is staged as a follow-up with the ready-to-apply artifact + the token step, not bundled into this pushable, mergeable fix.

## Rollout

1. **This PR (Half 1):** `applyPlan` seed-pin sync + regression test + docs. Opened via normal push → CI runs on it → clean merge. Once on `main`, the deployed workflow's next `prepare-release` uses the fixed script → blueprint bumps preflight-pass.
2. **Post-merge validation:** confirm a live `prepare-release` run succeeds + the regression/repro pass.
3. **Half 2 (follow-up, token-gated):** maintainer picks PAT-for-PR vs admin-merge vs commit→tag-and-ship; I deploy the chosen artifact.
