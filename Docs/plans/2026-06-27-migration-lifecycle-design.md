# Cycle A — migration lifecycle (design, 2026-06-27)

> ## ⚠️ EXECUTION FINDING (2026-06-27) — extraction blocked by test coupling; gate proven feasible
>
> Tasks 1–6 of the plan were executed on branch `cycle/migration-lifecycle` (preserved in git
> reflog), then **reverted to this docs-only state**. What we learned:
>
> - **The GATE works and is behavior-correct.** The 41 heals were copied verbatim into an ordered
>   `platform/install-migrations.js` registry with `introduced_in`/`scope` metadata + a gated
>   `runMigrations`. Wiring it (replacing the per-item heal call block with one `runMigrations(ctx)`)
>   produced a **byte-identical seed install** (a new golden-master harness: install seed → normalize
>   install-generated timestamps → sha256 every note → 159 notes identical). Scope correctness was
>   the subtle part: heals gate by **directory existence, not `manifest.name`** — only the finance
>   sub-heals (via the `applyFinanceMigrations` aggregator's `name!=="finance"` guard) and the
>   project heals with an explicit name-guard are blueprint-scoped; the other ~11 ran per-item and
>   are `scope:"global"`. With that, the gate is proven correct.
>
> - **The EXTRACTION (physically removing the heals from install.js) is a much larger project than
>   this design scoped.** The heals are NOT internal dead code — they are the **directly-tested API
>   surface of 6 harnesses** (`run-seed-migrations`, `run-helper-cases`, `run-wiki-to-docs-migration`,
>   `run-v0127-project-hub-heal`, `run-project-activity-panels-heal`, `run-v0109-projects-overhaul`),
>   which `require("../install.js")` and invoke the functions positionally. Worse, `run-helper-cases`
>   asserts install.js's **exact structure** (~20 assertions): function existence, the literal
>   `await applyX(` call sites, call **adjacency/order**, `module.exports.applyX = applyX` lines, and
>   even extracts heal **body content** to inspect it. Removing the heals / their call block breaks
>   all of these. So extraction = "extract heals **+ rewrite the migration test infrastructure**."
>
> - **Decision deferred to the user** (see post-finding options): (A) commit to the full extraction
>   incl. migrating the 6 harnesses + re-pointing ~20 `run-helper-cases` structural assertions to the
>   registry; (B) ship the GATE only this cycle via a minimal in-place mechanism (per-function
>   early-return keyed on a module-level prior-version) that keeps install.js's structure + all
>   harness assertions intact — delivers the per-vault skip win without the test rewrite; or (C)
>   split: ship the gate now (B), do the extraction as its own dedicated cycle (A) later. The
>   registry + golden-master work from this attempt is reusable for whichever path.
>
> ## ⚠️ SECOND FINDING (2026-06-27) — the version-gate premise is FALSE for backfill/ensure heals
>
> The user chose option (B) gate-only. It was implemented in-place cleanly (module-level
> prior-version + `_migrationGated(introducedIn)` + an early-return in each of 35 heals; seed
> prior-version `0.0.0`; `run-helper-cases` 3732/0, seed 236/236, dogfood exit 0 — code in reflog,
> commits `33ce4fdc`/`ce58fe88`). But `run-integration-smoke` (DOCS-INT-1..3) went RED, exposing a
> **fundamental semantic flaw in the gate's premise**:
>
> - The gate assumes "vault's prior version ≥ `introduced_in` ⇒ the heal already ran on all relevant
>   content, so skip." **That holds only for ONE-TIME migrations that reshape PRE-EXISTING content**
>   (e.g. `applyToDoBlueprintMigration` v0.3.3→v0.4.0 body reshape; `applyWikiToDocsMigration`) — once
>   done, new content is born in the new shape via templates, so the heal never needs to re-run.
> - It is **WRONG for the large class of BACKFILL / ENSURE / INJECT / REPAIR / CLEANUP heals** that
>   handle content which can be ADDED at any later time: `applyDocsBackfill` (Docs.md per project),
>   `applyProjectTodoBackfill`, `applyProjectNameBackfill`, the finance `*BandInjection`/`*Backfill`,
>   `applyOrphanedHelperCleanup` (cleans files left by EACH manifest change), etc. A vault already at
>   v0.135 can still gain a NEW project/budget whose Docs.md / To-Do.md / band was never created — so
>   these heals MUST run on every install. Gating them silently breaks newly-added content (DOCS-INT
>   proved it: a current-version vault's new projects never got `docs/Docs.md`).
>
> So a correct gate needs each heal classified **`migration_kind: "once"` (safe to version-gate) vs
> `"ensure"` (must always run)** — careful per-heal + per-template analysis, only partly covered by
> the test suite (a mis-classified "ensure"→"once" is LATENT consumer breakage tests may not catch).
>
> **CONCLUSION:** migration-lifecycle is materially subtler than the arc framed it. BOTH halves have
> real obstacles — extraction is blocked by deep test coupling, and the gate is only safe for the
> subset of heals that are true one-time reshapers. **Recommendation:** re-approach as a dedicated
> cycle that (1) classifies every heal `once`/`ensure` (the `"ensure"` ones get NO gate — they're the
> cheap existence-check ones anyway, so little perf is lost), (2) gates only the `"once"` reshapers
> (the expensive note-walkers), (3) validates the classification against the full suite + a new
> "new-content-on-current-vault" regression, and THEN optionally tackles extraction. Reverted to this
> clean docs-only state pending that decision.

> Sub-project 2 of the hardening arc (`2026-06-26-hardening-arc-design.md`). Gives the
> note-content migration/heal family a **per-vault version-gate** (skip a heal once the vault
> is provably past it) AND **extracts** those heals out of the 14.6k-LOC `install.js` monolith
> into an ordered migration registry. User decisions: gate + extract together, in one cycle;
> per-vault skip only (no archival/deletion — every heal stays in the registry forever so any
> vault, even a restored old backup, still upgrades cleanly).

## Problem

`install.js` is 14,616 LOC with ~30 perpetual note-content heals (`applyFinance*`, `applyProject*`,
`applyNoteChromeHeal`, `applyToDoBlueprintMigration`, …). They avoid *re-doing* work via per-note
idempotency markers, but every heal still **walks every note on every install, forever**, to check
a marker for a migration that finished cycles ago — and each new cycle adds another perpetual heal,
growing the monolith. There is no version-gate and no structural home for the heal family.

## Approach (registry-as-data + one gated runner)

Replace the ~30 scattered `await apply*()` calls with a single `runMigrations(ctx, { scope })` that
iterates an **ordered migration registry**, applying the gate per entry. Each heal moves into its own
registry module — so *extract* and *gate* are the same refactor. (Rejected: gate-in-place with no
extraction — user wants the monolith shrunk; manifest-declared-per-blueprint migrations — touches
every manifest + the installer's item model, too large a blast radius.)

## Design

### 1. The gate signal

At install start the installer already loads the consumer's existing `platform-installed.json`.
Capture once:

```js
const priorVersion = (installed && typeof installed.workshop_version === "string")
  ? installed.workshop_version : null;   // version the vault was LAST installed at; null on fresh/legacy
```

A migration **runs** iff `priorVersion === null` **or** `semverLt(priorVersion, m.introduced_in)`.
It **skips** only when `priorVersion` is valid semver `>= m.introduced_in` (the heal provably already
ran on a prior install at/after the version it shipped in). **Fail-safe:** any uncertainty
(null/unparseable prior version) → run. A wrong *run* is a harmless idempotent no-op; a wrong *skip*
is an unmigrated vault — so the gate only ever skips on certainty.

`semverLt` is a tiny pure comparator (numeric major.minor.patch; 4-segment tolerated, e.g.
`0.105.0.2` → compare segment-wise). Lives in the registry module, unit-tested.

### 2. Registry module interface — `platform/install-migrations/<name>.js`

```js
module.exports = {
  name: "finance-paycheck-body-migration",   // kebab; stable id used in history + tests
  introduced_in: "0.107.0",                  // version this heal first SHIPPED (from the call-site comment)
  scope: "finance",                          // blueprint/mechanism name the heal targets, or "global"
  async run(ctx) { /* the verbatim heal body; ctx = { tp, manifest, variables, history, git, priorVersion } */ },
};
```

`platform/install-migrations/index.js` exports the **ordered** array (`module.exports = [ require("./…"), … ]`).
**Order is load-bearing** — several heals depend on a prior one (e.g. `wiki-to-docs-migration` MUST run
before `docs-backfill`; `project-sections-migration` before `project-sections-hub-migration`;
`finance-hub-frontmatter-heal` before the body repair). The registry array preserves the exact current
call order, per scope.

### 3. Scope classification (the correctness crux — enumerated, not inferred)

Three buckets. The implementation plan carries the full per-function table with `introduced_in`; the
classification rule:

- **Migrations → extract + gate (~30).** Read/rewrite note bodies or walk the vault's notes/files
  (`adapter.read`/`vault.modify`/`processFrontMatter` over many notes). The expensive perpetual walkers —
  the whole point. Examples: `applyNoteChromeHeal` (v0.124.0), `applyToDoBlueprintMigration` (v0.116.0),
  every body/nav/band `applyFinance*Migration`/`*Injection`/`*Heal`/`*Repair`/`*Backfill`,
  `applyProjectSections*Migration`, `applyEntityCreateGuardMigration` (v0.110.1),
  `applyCustomJsGuardMigration` (v0.110.2), `applyWikiToDocsMigration` (v0.52.0), `applyDocsBackfill` (v0.50.0).
- **Scaffolding → extract, leave UNGATED (~6).** Cheap create-if-absent structure seeders
  (`applyFinance{Defaults,Debt,Months,Plan,Savings}Scaffolding`, `applyFinanceBudgetGroupSeed`). Fresh
  vaults need them; existence-check is cheap; gating adds wrong-skip risk for negligible gain. They move
  into the registry (for cohesion) with `introduced_in: null` meaning "always run" (the runner treats
  null introduced_in as ungated).
- **Config-writers → leave in `install.js` untouched (~20).** `.obsidian/` writers + per-item
  materialization (`applyTemplaterHotkeys`, `applyVendoredThemes`, `applyAppSettings`, `applyNavButtons`,
  `applyNewEntityButtons`, `applyBreadcrumb`, `applyRuleFragment`, `applyLocalShadows`, `applyPreInstall`,
  `applySnippets`, `applyStyleSettings`, `applyAppearance`, `applyHotkeys`, `applyCommunityPluginData`,
  `applyCorePluginSettings`, `applyCustomJs*`, `applyExternalPlugin*`, `applyVaultDefaultPaths`,
  `applyTemplaterFolder*`/`Startup*`, `applySlashCommanderBindings`). Run every install by design; not
  migrations; out of scope.

### 4. The gated runner + call-site replacement

A single function in `install.js`:

```js
async function runMigrations(ctx, scope) {
  for (const m of MIGRATIONS) {
    if (m.scope !== scope) continue;
    const gated = m.introduced_in != null;
    if (gated && ctx.priorVersion && !semverLt(ctx.priorVersion, m.introduced_in)) {
      ctx.history.push({ step: "migration", name: m.name, action: "skipped_version_gated",
        prior_version: ctx.priorVersion, introduced_in: m.introduced_in, ...ctx.git });
      continue;
    }
    try { await m.run(ctx); }
    catch (e) { ctx.history.push({ step: "migration", name: m.name, action: "error",
      message: String(e && e.message || e), ...ctx.git }); }
  }
}
```

The per-blueprint heal block in `installItem` (lines ~1151–1171) and `applyFinanceMigrations`
(~5669–5689) become `await runMigrations(ctx, "<blueprint>")` calls at the same points. The heal
functions' internal `if (manifest.name !== "finance") return` guards are preserved inside the moved
bodies (belt-and-suspenders; the `scope` filter already handles it).

### 5. `introduced_in` determination

Read from the inline call-site comment (`// NEW vX.Y.Z`) — present on 35 of them. For any without a
hint, `git log -S"<fn name>" --reverse` → first commit → its release version. Where still uncertain,
set `introduced_in` **low** (the vault's earliest plausible version, e.g. the blueprint's first ship)
so it always runs — never risk a wrong-skip.

### 6. Verification (this touches the installer every vault depends on — heavy net)

- **Behavior-preservation (the primary gate): `run-seed-migrations` stays GREEN unchanged.** The seed
  vault ships a committed `ranch/platform-installed.json` whose `workshop_version` is **`0.120.1`** —
  *higher* than most heals' `introduced_in`, which would make the gate skip ~25 of ~30 heals and turn
  the net red. **Required seed edit:** set the committed seed `installed.workshop_version` to **`"0.0.0"`**
  (the worst-case "legacy vault, pre-everything" the regression net exists to exercise) so the gate runs
  EVERY migration — exactly as today — and the existing per-heal assertions must all still pass. The
  harness copies the seed to a tmpdir before installing, so the committed fixture edit is safe and the
  post-install `workshop_version` assertion (HC-V01100-SEED-INSTALL-6, post-install value) is unaffected.
  If a single assertion changes, the extraction changed behavior. **Plus a golden-master diff:** capture the
  full materialized seed-vault tree + the `platform-installed.json` history *steps* before the refactor;
  after, assert the materialized note bodies are byte-identical (history may gain `step: "migration"`
  envelope entries — assert the SET of heals that ran is identical).
- **Gate-skips test (new):** a harness that installs onto a fixture whose `installed.workshop_version`
  is HIGH (past every `introduced_in`) and asserts the gated migrations are skipped (history
  `action: "skipped_version_gated"`) while scaffolding + config-writers still run.
- **`semverLt` unit test:** including the 4-segment case (`0.105.0.2`), equal versions, and null.
- Existing nets: workshop dogfood self-install (must stay exit 0), full `release:preflight`,
  `release:preflight-bumped` before merge (this cycle bumps the workshop + any blueprint whose heal
  moved — keep version assertions snapshot-clean).
- **No consumer-visible change for an up-to-date vault:** all 4 consumers are at 0.135.0, so on their
  next `--bump-pins` the gate will SKIP every pre-0.135 migration (they already ran) — a pure speedup,
  identical materialized result. Verify on one consumer post-deploy that drift stays none.

### 7. Staging (reviewable even in one cycle — one commit per step)

1. **Foundation:** `semverLt` + the empty registry + `runMigrations` + `priorVersion` capture wired,
   with ZERO migrations moved yet (registry empty → no behavior change). Golden-master captured here.
2. **Finance family** (~20 functions): move into `platform/install-migrations/finance/*.js`, replace
   `applyFinanceMigrations`'s body with `runMigrations(ctx, "finance")`. seed-net + golden-master green.
3. **Project + docs family** (~10): same. Green.
4. **to-do + global family** (note-chrome, entity-create/customjs guard, orphaned-helper, to-do): same. Green.
5. **Gate-skips harness + semverLt unit test + dogfood + full preflight + preflight-bumped.**
6. **PR** — push, CI green, rebased on main. Stop. No merge by hand (auto-pipeline ships it).

## Risks + mitigations

- **Wrong `introduced_in` → wrong skip → unmigrated vault.** Mitigated by fail-safe (null/uncertain →
  run) + setting uncertain values low + the gate-skips test only asserting skips for versions we set.
- **Extraction changes behavior (lost ordering / dropped guard / closure-captured helper).** Mitigated
  by per-family staging with `run-seed-migrations` + golden-master byte-identical after EACH family, and
  moving bodies **verbatim** (no logic edits during the move). Many heals call module-level helpers
  (`_relocateActionItemsMarker`, regexes, constants) — those helpers move WITH the family or stay
  exported from a shared `platform/install-migrations/_shared.js` the modules require.
- **`ctx` shape drift.** The 51 dominant-signature heals map cleanly to `ctx`; the few outliers
  (`workshopPath`/`targetPath`) are config-writers and stay out. Any migration needing an extra arg gets
  it added to `ctx` (documented).

## Out of scope

- Archival/deletion of heals (user chose skip-only). The `introduced_in` metadata makes a future
  archival policy a pure addition.
- The 28k-entry `platform-installed.json` history bloat (a separate cleanup; noted, not addressed).
- Config-writers + per-item materialization (not migrations).
- Any consumer-vault deploy beyond verifying drift:none on one vault.
