---
title: Deploy-confidence substrate — seeded integration smoke + CI matrix + release gate
date: 2026-05-12
target_version: v0.38.0
preceded_by: v0.37.0 (scratch blueprint, just landed)
defers: v0.34.0-originally-planned (sauce-claude-cohesion-wave-3) → re-planned for after this substrate exists
status: design — pre-plan
---

# Deploy-confidence substrate — design

## Why

The v0.36.x cycles shipped Homebrew distribution (workshop pantry out of synced vaults; `~/.sauce/vaults.json` registry; brew tap auto-bump on tag push). Distribution is *plumbed* end-to-end. What's missing is **deploy confidence** — automated assurance that a real-data vault survives `brew upgrade sauce && sauce reinstall`. Today's CI gate is a single macOS job that bootstraps an empty vault and exits; nothing exercises blueprint runtime against representative content. The `test-vault` consumer was migrated 2026-05-08 with pre-v0.27.0 mechanism versions and has been frozen since — illustrating exactly the drift class users will hit and we're not catching.

This cycle builds the substrate for closing that gap: per-blueprint seed contributions (so we can deterministically regenerate a "loaded" vault), a `sauce seed` CLI verb that materializes them, an integration smoke harness that bootstraps + seeds + audits a fresh vault, and CI / release-gate wiring so PRs and tag pushes block on this new gate.

The cycle deliberately stops at the **bootstrap + seed + audit-clean** bar. Heavier bars (Obsidian-API rendering verification; previous-tag → HEAD upgrade-survival) are real value but layered on top of the same substrate in follow-on cycles. "Keep it very low for now, just an initial start" — user, this conversation.

## Goals

1. Per-blueprint seed contributions live alongside other blueprint surface (`platform/blueprints/<bp>/seed/`). Each blueprint owns its seed contribution; module-directory invariant (landmine #11) preserved.
2. `sauce seed [--vault] [--blueprint] [--reset] [--anchor-date] [--dry-run]` CLI verb dispatches per-blueprint seeds. Used by CI, by humans (re-seed `test-vault` to view in Obsidian), and by blueprint authors.
3. Deterministic output — same seeded vault byte-identical across runs at the same `--anchor-date`. Fixed RNG seed; sorted frontmatter; normalized line endings.
4. `--reset` safety gate — refuses to run against vaults lacking `vault_kind: "test"` marker in `ranch/platform-config.json`. Prevents accidental destruction of real consumer data.
5. `run-integration-smoke.js` harness: fresh vault → bootstrap → seed → audit clean → post-condition assertions. Wired into `release:preflight`, `ci.yml`, and `release.yml`.
6. `ci.yml` upgraded to a `[macos-latest, ubuntu-latest]` matrix; both runners run preflight + smoke on every PR.
7. `release.yml` gains a `preflight` job; `bump-tap` becomes `needs: preflight`. Tag pushes against red code do not ship a formula bump.
8. `Docs/use.md` documents the new release-process gate sequence + recommended GitHub branch-protection settings (one-time UI flip).
9. Pilot blueprint coverage: `project` (α declarative), `daily` (β programmatic), `meetings` (α declarative). Together exercise both seed kinds and the cross-blueprint-reference shape.

## Non-goals

- **No Obsidian-API rendering verification** (bar iii). Templater/Dataview rendering correctness via a Node-side Obsidian stub is its own cycle. Existing `run-renderer.js` covers nav-button rendering only; expanding it is real work, deferred.
- **No upgrade-survival smoke** (bar iv). Two-tag matrix (previous tag → HEAD) is real value but adds checkout/install overhead; deferred to v0.38.x or later.
- **No multi-vault matrix.** Smoke runs against a fresh `mkdtemp` vault per CI run. Running smoke against `barebones` and `test-vault` as additional matrix axes is deferred.
- **No nightly cron.** Bar iv would warrant a nightly; bar ii doesn't.
- **No pre-commit hook.** User has the discipline; tooling is overhead.
- **No automated branch-protection setup.** Repo settings are per-account, not in-repo. Documented in use.md; user flips on manually.
- **No remaining 7 blueprints in cycle 1** (boards, cowork, journal, people, to-do, trips, finance). Each becomes a one-stage follow-on cycle (~50 lines per blueprint, no new mechanism code). The `meetings` seed will produce dangling wikilinks to non-seeded `people`; accepted for cycle 1 since audit-bar-ii doesn't fail on dangling wikilinks.
- **No version-bump bot, no release-notes generator, no rollback automation.** Manual gates documented; tooling deferred.

## Architecture

### On-disk layout (workshop, not shipped to consumers)

```
platform/
├── seeder/                          NEW — workshop-only library; never installed into consumers
│   ├── seeder.js                    Public API: seedVault(vaultPath, opts) → { notesCreated, blueprints, warnings }
│   ├── declarative.js               Walks blueprint seed.json, materializes notes
│   ├── programmatic.js              Loads blueprint seed.js exports, invokes seed(ctx)
│   └── helpers.js                   writeNote / substituteTemplate / ensureDir / fixedRng / loadAnchorDate
├── cli/
│   ├── cmd-seed.js                  NEW — verb dispatcher; mirrors cmd-reinstall shape
│   └── (existing)
└── blueprints/
    ├── project/
    │   ├── manifest.json
    │   ├── templates/, scripts/, views/, rules/   (existing)
    │   └── seed/                    NEW per-blueprint dir; parallels existing top-levels
    │       └── seed.json            Declarative (α)
    ├── daily/
    │   └── seed/
    │       └── seed.js              Programmatic (β)
    └── meetings/
        └── seed/
            └── seed.json            Declarative (α)
```

Seed code never lands in consumer vaults. `sauce seed` resolves the workshop pantry via the existing `resolve-sauce-dir.js` (same path the bin shim uses for everything else).

### Seed declaration formats

**α — `seed.json` (declarative):**

```json
{
  "schema_version": 1,
  "kind": "declarative",
  "notes": [
    {
      "path": "{{module_directory}}/{{slug}}/Project.md",
      "vars": { "slug": "Acme-Migration", "title": "Acme Migration", "status": "active" },
      "frontmatter": { "type": "project", "status": "{{status}}", "started": "2026-04-15" },
      "body_template": "templates/Project.md"
    }
  ]
}
```

`vars` are substituted via `substituteLenient` (existing helper) into both `path` and `frontmatter` values. `body_template` is resolved against the blueprint's own `templates/` dir; rendered with the same `vars` plus a small set of stock variables (`now`, `today`, `anchor_date`).

**β — `seed.js` (programmatic):**

```js
module.exports = {
  schema_version: 1,
  kind: "programmatic",
  seed(ctx) {
    // ctx = { vaultPath, moduleDir, anchorDate, helpers, rng, daysAgo, writeNote }
    for (let i = 0; i < 30; i++) {
      const date = ctx.daysAgo(i);
      ctx.writeNote({
        path: `${ctx.moduleDir}/${date.format("MM-MMMM")}/${date.format("YYYY-MM-DD")}.md`,
        frontmatter: { date: date.format("YYYY-MM-DD"), wakeup: ctx.helpers.jitterTime("07:30", 15, ctx.rng) },
        body: ctx.helpers.renderTemplate("Daily.md", { date })
      });
    }
    return { notesCreated: 30 };
  }
};
```

`ctx.rng` is a deterministic seeded RNG (Mulberry32 or similar; seed = SHA256(`"sauce-test-vault-v1:" + blueprint + ":" + anchor_date`)).

### Determinism guarantees

- Fixed RNG seed per (blueprint, anchor_date) — re-running with the same args produces byte-identical output.
- `--anchor-date` defaults to today (`new Date().toISOString().slice(0,10)`); CI passes a fixed value (e.g., `2026-05-12`) so harness output is stable across days.
- `writeNote()` sorts frontmatter keys alphabetically, uses `\n` line endings, and quotes ambiguous YAML values (date-shaped strings, `true`/`false`-shaped strings) per the v0.16.0 platform values list.

### Module-directory invariant compliance

Every seed write is rooted at the calling blueprint's `module_directory` (substituted from its manifest). `helpers.writeNote()` enforces — throws if the resolved path doesn't start with the calling blueprint's module dir. No blueprint can write into another blueprint's directory through the seeder.

### Idempotency / reset semantics

- Default mode: additive. Only writes notes that don't exist; existing notes are skipped (counted as "skipped" in stdout).
- `--reset` mode: deletes `<vault>/spice/<bp_module>/` for each blueprint being seeded, then re-seeds. **Refuses** unless target vault has `vault_kind: "test"` in `ranch/platform-config.json` (NEW field, default absent — backwards-compatible: vaults without the field behave as production-marked).

### CLI surface

```
sauce seed [--vault <path>] [--blueprint <name>...] [--reset] [--anchor-date YYYY-MM-DD] [--dry-run]
```

- `--vault <p>` explicit, OR resolved from `~/.sauce/vaults.json` single-registered-vault rule (errors if multiple registered without `--vault`).
- `--blueprint <name>` repeatable; default = every subscribed blueprint with a `seed/` dir in workshop.
- `--anchor-date` overrides today; mostly used by the smoke harness.
- `--dry-run` walks + prints planned writes; never touches disk.
- `--reset` precondition: `vault_kind:"test"` marker required.

**Exit codes:** 0 success / 1 validation failure / 2 unsafe-op refused / 3 runtime write error.

**Stdout shape (machine-grep-able):**
```
sauce seed: vault=/Users/.../test-vault anchor=2026-05-12
[project   ]  3 notes created, 0 skipped
[daily     ] 30 notes created, 0 skipped
[meetings  ]  4 notes created, 0 skipped
total: 37 notes across 3 blueprints (0 warnings)
```

## Integration smoke harness

`platform/test/run-integration-smoke.js` — bar-ii harness, ~20 sub-asserts.

**One run:**

1. `mkdtemp` fresh vault dir.
2. `sauce bootstrap --vault <tmp> --non-interactive --no-register`.
3. `sauce seed --vault <tmp> --anchor-date 2026-05-12` (additive mode — fresh vault, no `--reset` needed).
4. `sauce audit --vault <tmp>` — must exit 0 with 0 errors AND 0 warnings.
5. Assert post-conditions:
   - File-count-per-blueprint matches expected (`3` / `30` / `4`).
   - `<tmp>/ranch/platform-installed.json` mechanism + blueprint versions match `platform/manifest.json`.
   - Each seeded note parses as valid markdown with parseable frontmatter (existing helper from `run-helper-cases.js`).
6. `~/.sauce/vaults.json` invariant: snapshot before bootstrap, assert byte-identical after smoke (the `--no-register` opt-out actually opts out).
7. `rm -rf <tmp>` (always, unless `KEEP_SMOKE_VAULT=1`).

**Failure mode:** print failing command's stdout/stderr verbatim, temp vault path, env hint to keep vault for inspection. Exit 1.

**Runs in:** under 30 seconds end-to-end.

**Wired into:** `release:preflight` (last step) + `ci.yml` (both runners) + `release.yml` (first job, blocks `bump-tap`).

## CI changes

**`ci.yml`:**
- Convert single macos-latest job to `strategy.matrix.os: [macos-latest, ubuntu-latest]`.
- Both runners run the existing harness chain plus `node platform/test/run-integration-smoke.js`.
- Keep brew-install-smoke step macOS-only via `if: matrix.os == 'macos-latest'` (Homebrew on Linux is a separate code path; deferred).
- Same node 20.

**`release.yml`:**
- Prepend `preflight` job: `npm install --omit=dev` + `npm run release:preflight`.
- Existing `bump-tap` job gains `needs: preflight`.
- Tag-pushed-against-red: tag exists, no tap PR opens, no formula bumps.

## Pilot blueprint coverage

| Blueprint | Kind | Notes |
|---|---|---|
| `project` | α (declarative) | 3 projects: `Acme-Migration` (active), `North-Star-Refactor` (planning), `Q1-2026-Audit` (archived). Each renders the standard `Project.md` + nested `tasks/<task>/` per the blueprint's per-entity sub-folder pattern. |
| `daily` | β (programmatic) | 30 daily notes back from `--anchor-date`, routed `MM-MMMM/YYYY-MM-DD.md`. RNG-driven small variations in frontmatter (wakeup ±15min, mood from {good, neutral, busy}); byte-stable across runs at the same anchor. |
| `meetings` | α (declarative) | 4 meetings: 2 with attendees referencing not-yet-seeded `people` (dangling wikilinks; audit-bar-ii doesn't fail on these — accepted), 1 standalone, 1 recurring. |

## Release process formalization (`Docs/use.md`)

Two new subsections:

**"Releasing a version" — gate sequence:**

1. Bump `workshop_version` in `platform/manifest.json` + `package.json` `version` (lockstep — `scripts/check-version-sync.js` helper enforces in `release:preflight`).
2. Local `npm run release:preflight` — must exit 0.
3. Commit + push to `main`.
4. Wait for `ci.yml` green.
5. Annotated tag `v.X.Y.Z`.
6. `release.yml` runs preflight as first job; on green, opens tap PR.
7. Merge tap PR.
8. Local `brew upgrade sauce` to verify.

**"Recommended branch protection (one-time GitHub UI setup)":**

- Required status checks: `ci / brew-install-smoke (macos-latest)`, `ci / brew-install-smoke (ubuntu-latest)`.
- Require branches up-to-date before merging.
- Require linear history.
- Restrict pushes to `main` to your account.

## Testing strategy

| Harness | New / changed | Coverage |
|---|---|---|
| `run-seed.js` (NEW) | NEW | declarative + programmatic loaders, RNG determinism, module-dir guard, --reset safety gate, --dry-run, blueprint filtering. ~25-30 sub-asserts. |
| `run-integration-smoke.js` (NEW) | NEW | bootstrap → seed → audit clean post-conditions + registry-unchanged invariant. ~22 sub-asserts. |
| `run-cli.js` | extended | + S-cases for `sauce seed` verb dispatch parity with other verbs (~5-8 new sub-asserts). |
| `run-bootstrap.js` | unchanged | (already covers `vault_kind` field passthrough — verify; if not, add 1-2 sub-asserts) |
| `run-renderer.js` | unchanged | not exercised by seed. |
| `run-cowork-smoke.js` | unchanged | independent. |

`release:preflight` chains the new harnesses last (after `run-doctor-self.js`). Whole-suite total grows ~1145 → ~1195 sub-asserts (+50 across new harnesses + extensions).

## Risks / known issues

1. **Dangling wikilinks in meetings seed.** Cycle-1 meetings refers to `people` that aren't seeded. Audit-bar-ii doesn't fail on dangling wikilinks; accepted. Adding `people` seed is a one-stage follow-on (~50 lines).
2. **Smoke runtime drift.** Bar-ii smoke is ~30s; if it grows past ~2 minutes, PR cycle time suffers. Cap at 60s budget enforced via test timeout.
3. **`vault_kind:"test"` field is new.** Adds one field to `platform-config.json`; backwards-compatible (default absent = production-marked). No migration needed for existing vaults — they continue working without `--reset` access.
4. **Workshop dogfood adds 37 notes to test-vault.** Test-vault gets `vault_kind:"test"` set in S12; first `sauce seed --reset` re-creates the seeded content. Existing test-vault content (the 2026-05-08 migration snapshot) stays — `--reset` only nukes `spice/project/`, `spice/daily/`, `spice/meetings/` (the 3 pilot blueprints), not the whole vault.
5. **Linux CI may surface latent macOS-only assumptions.** Path separators, line endings, case-sensitivity. Mitigation: harnesses already use `path.join` and `os.tmpdir()`; first Linux run may catch one-off bugs to fix in S9.
6. **Tag-pushed-against-red is a soft fail.** Tag exists in repo even if `release.yml`/`preflight` is red, but no formula bumps. User must `git tag -d v.X.Y.Z && git push --delete origin v.X.Y.Z` to clean up. Documented in use.md as recovery procedure.
7. **`bump-tap` job change is breaking for in-flight tags.** Any tag pushed during S10 deploy window goes through the new gate. Mitigate by landing S10 on a quiet day.

## Open questions / followups

- Should `sauce seed` support a `--include-people-seed` convenience to seed the people blueprint as a dependency of meetings? Out of scope cycle 1; revisit when people-seed lands.
- Does `sauce audit --claude-surface` need to be invoked separately in the smoke, or does plain `sauce audit` cover it? Verify in S5; default to invoking both flavors if unclear.

## Cycle decomposition (provisional — writing-plans skill refines)

13 stages, target version `v0.38.0`:

| S | Theme |
|---|---|
| S1 | `platform/seeder/` library + helpers + `run-seed.js` (declarative-only) |
| S2 | `cmd-seed.js` + CLI wiring |
| S3 | Programmatic seed (β) support — RNG, anchor-date |
| S4 | `vault_kind:"test"` marker + `--reset` safety gate |
| S5 | `run-integration-smoke.js` |
| S6 | `project` α-seed |
| S7 | `daily` β-seed |
| S8 | `meetings` α-seed |
| S9 | `ci.yml` linux+matrix + smoke wired |
| S10 | `release.yml` preflight gate + `scripts/check-version-sync.js` |
| S11 | `Docs/use.md` release-process + branch-protection sections |
| S12 | Workshop dogfood: re-seed `test-vault`; bump `workshop_version` 0.37.0 → 0.38.0 + reconcile `package.json` version drift (currently 0.36.1) |
| S13 | Cycle close: cycle-history archive, CLAUDE.md status, tag `v0.38.0`, validate release pipeline end-to-end |

## How this composes with future cycles

- **v0.39.x — bar iii (renderer-stub upgrade).** Extends `run-renderer.js` to cover Dataview view compilation + Templater template rendering against seeded notes. Reuses the seed substrate from this cycle.
- **v0.40.x — bar iv (upgrade-survival).** Smoke runs twice: at `git checkout v0.38.0` pantry, then at HEAD. Catches drift across versions. Reuses everything below it.
- **Remaining blueprint seed coverage.** One small cycle each for `boards`, `cowork`, `journal`, `people`, `to-do`, `trips`, `finance`, `scratch`. ~50 lines per blueprint, no new mechanism code.
- **Cohesion wave 3 (originally v0.34.0, now v0.41.x or later).** Lands *after* this substrate exists, so wave-3 changes get full integration coverage automatically.
