---
purpose: How to build, test, and verify changes in the Sauce workshop. Preflight harnesses, release workflow, brew-tap chain, dogfood, debugging failed installs.
load_when: Running preflight, cutting a release, brew-tap workflow, dogfooding the workshop, debugging a failed install.
---

# Build, test, verify

## Preflight (canonical)

```bash
npm run release:preflight
```

Runs `scripts/check-version-sync.js` first (gates workshop_version vs `platform/manifest.json` vs `package.json`), then every harness in `platform/test/run-*.js`. Whole-suite GREEN is the bar — any harness failure on a fresh checkout means something regressed.

Current count: **32 load-bearing harnesses** (whole-suite GREEN preserved v0.21.0 → current). See [cycle-status.md](cycle-status.md) for the exact catalogue and per-cycle sub-assert deltas.

**Per-cycle behavioral harness pattern.** Where `run-helper-cases.js` asserts source-text contracts via regex (cheap, fast, source-stable), per-cycle behavioral harnesses LOAD each helper into a sandboxed scope, INSTANTIATE it, and exercise its methods against minimal Dataview / DOM / Obsidian app stubs. Use this when the cycle ships a new shared primitive (e.g. `SectionLabel` v0.109.0) or non-trivial render dispatch (e.g. `Breadcrumb` type branches v0.109.0) where a regression would manifest as wrong DOM rather than wrong source text. Reference impl: [`platform/test/run-v0109-projects-overhaul.js`](../../platform/test/run-v0109-projects-overhaul.js) covers SectionLabel render, Breadcrumb type branches + path fallback, ProjectMeetingsPanel._enrichMeeting parse correctness, ProjectDocsIndex section sort algorithm, applyDocNoteBreadcrumbMarkerCleanup edge cases, and Template, Project.md structural integrity. Wired into `release:preflight` after `run-smart-connections-bridge`; runs on every PR + push to `main` via `ci.yml` and on every annotated tag via `release.yml`.

Individual run:

```bash
node platform/test/run-bootstrap.js
node platform/test/run-cli.js
node platform/test/run-install-sh.js
node platform/test/run-helper-cases.js
node platform/test/run-renderer.js
# ... see platform/test/run-*.js
```

## Self-install (workshop dogfood)

The workshop is its own first consumer. Self-install runs against the workshop directory, using its own `Docs/Meta/platform-config.json` / `platform-subscription.json`. **Before promoting any mechanism / blueprint version to consumers, the workshop's own self-install must succeed.** If workshop self-test fails, do NOT push the update.

```bash
node platform/install.js --vault . --auto-approve   # self-install at workshop root
sauce install                 # equivalent via CLI (after brew install)
```

The platform non-negotiable: workshop dogfoods every release **and every push** (~4 seconds, ~82 history entries; catches manifest entry order, materialization paths, and path-resolution drift that preflight misses).

## CLI

```bash
sauce install        # install (or re-install) all subscribed mechanisms + blueprints
sauce audit          # read-only audit (claude_surface alignment, entity-create wiring, drift detection)
sauce upgrade        # interactive upgrade of a single blueprint/mechanism
sauce bootstrap      # one-shot vault scaffold for a fresh consumer
sauce migrate --from <path>   # migrate legacy source vault into Sauce shape (READ-ONLY against source per landmine #20)
```

`sauce audit` is read-only against the audited vault (landmine #21). `sauce migrate` is read-only against the source vault (landmine #20).

## Release workflow

Single-branch direct-push to `origin/main`. No feature branches, no PR review (for now).

1. Cycle stage commits: bundle per-stage work into one commit each, conventional-commits format (`feat(installer,validator): v0.X.Y patch S1 — ...`). Use HEREDOC for multiline messages.
2. Push to `origin/main` after each commit. No staging.
3. At cycle close: bump `workshop_version` in `platform/manifest.json` AND `package.json`. After `brew upgrade sauce` distributes the new release, run `sauce update --bump-pins` from inside each consumer vault to auto-update `ranch/platform-subscription.json` (replaces the previous manual `vim ranch/platform-subscription.json` step — lockstep enforced by `check-version-sync.js`). See `/install` for full `--bump-pins` flag reference. Two related pin-sweep requirements: (a) per landmine #16, every `workshop_version` bump implies a sweep across `HC-V0*-VERSION-*` assertions in `run-helper-cases.js` + `run-bootstrap.js` plus fixture `cowork_version` / `sauce_version` strings; (b) per landmine #20, `scheduled-job-contract.json#contract_version` mirrors the cowork blueprint version exactly. The workshop's own `ranch/platform-subscription.json` requires manual edit at the same stage (no `sauce update --bump-pins` runs on the workshop itself).
4. Annotated git tag `v<X.Y.Z>` at HEAD — **REQUIRES user approval** per the ask-before-acting list.
5. `release.yml` GitHub Action fires on tag: runs preflight + `bump-tap` chain that auto-bumps `Formula/sauce.rb` in `willfell/homebrew-sauce` via PR.
6. Tap PR merge → `brew upgrade sauce` picks up the new release.

Don't sign as Claude (no `Co-authored-by: Claude` trailer). Don't skip hooks (`--no-verify`) unless explicitly requested. Don't force-push or rewrite history on `origin/main` without explicit approval — see [asking-before-acting.md](asking-before-acting.md).

## Branch + PR workflow (preferred from v0.110.0)

Direct-push to `origin/main` remains possible (admin override) but the preferred path for any cycle that touches mechanisms, blueprints, or migrations is now feature-branch + PR + CI gate.

### Branch + PR mechanics

1. Branch off `origin/main`: `git switch -c cycle/v0.X.Y-<topic>` (or use a worktree under `.worktrees/`).
2. Cycle stages commit normally; push to the branch instead of main: `git push -u origin cycle/v0.X.Y-<topic>`.
3. Open a PR (`gh pr create`). The existing `.github/workflows/ci.yml` triggers on `pull_request: branches: [main]` and runs `npm run release:preflight` on `macos-latest` + `ubuntu-latest`. The 23rd harness `platform/test/run-seed-migrations.js` runs as part of that chain.
4. CI red → merge blocked (once branch protection is on; see below).
5. Merge to main via the PR.
6. Post-merge cycle-close on main directly: `workshop_version` bump (per § Cycle-close artifacts), tag, rebaseline (see § Seed-vault rebaseline below).

### Seed-vault rebaseline (cycle close)

The migration-regression harness runs against a checked-in synthetic seed vault under `platform/test/seed-vault/`. After every cycle that ships migrations or schema changes, the seed should be ratcheted forward to represent the just-released state:

```
npm run seed:prev         # archive current seed -> seed-vault-prev/
npm run seed:rebaseline   # run install on a copy of seed; write result back
git commit -am "chore(seed): rebaseline to v0.X.Y"
```

The `seed-vault-prev/` snapshot is the one-cycle-back safety net referenced in landmine #26. Dry-run mode (`node scripts/rebaseline-seed.js --dry-run`) prints the diff without writing — useful for previewing what install would change.

### Branch protection setup (one-time, manual; user approval required)

The repo currently allows direct-push to main. To enforce the PR-gated path, set a branch-protection rule on `main` requiring the CI checks before merge. This is a manual step (per `asking-before-acting.md` § Git, this requires user approval):

```
gh api -X PUT repos/willfell/sauce/branches/main/protection \
  --field required_status_checks[strict]=true \
  --field 'required_status_checks[contexts][]=preflight (macos-latest)' \
  --field 'required_status_checks[contexts][]=preflight (ubuntu-latest)' \
  --field enforce_admins=false \
  --field required_pull_request_reviews=null \
  --field restrictions=null
```

Run this once when the project is ready to enforce the PR gate. Until then, the PR workflow remains the *recommended* but not *enforced* path.

## Cycle-close artifacts

Every cycle close MUST produce (canonical list from `Docs/prompts/SESSION-START.md`):

1. `Docs/plans/<YYYY-MM-DD>-v<X.Y.Z>-<topic>-result.md` — what shipped, surfaces hit, NEW lessons, carry-forward items, commits.
2. `Docs/plans/<YYYY-MM-DD>-v<X.Y.Z>-<topic>-plan.md` — implementation plan (created during cycle).
3. `Docs/plans/<YYYY-MM-DD>-v<X.Y.Z>-<topic>-design.md` — design doc (created during cycle).
4. **`Docs/cycle-history.md`** — append a new `## v<X.Y.Z> <topic> CLOSED <YYYY-MM-DD>` section with the cycle summary.
5. **`Docs/agent-guides/cycle-status.md`** — update workshop_version + mechanism + blueprint + harness pointers.
6. `Docs/install.md` — Upgrading-from-vX.Y.Z section.
7. `Docs/landmines.md` — history block updates (#12 + others as relevant).
8. `Docs/prompts/<YYYY-MM-DD>-post-v<X.Y.Z>-next-cycle-handoff.md` — NEXT cycle's onboarding doc (always written; never optional).
9. Annotated git tag `v<X.Y.Z>` (USER APPROVAL gate).

**Important:** items 4 and 5 replace what used to be a single CLAUDE.md `## Status (live)` edit. CLAUDE.md itself does NOT need touching for status updates anymore — its markered surfaces are regenerated by `platform-claude` automatically, and outside-marker prose is hand-authored and stable across cycles.

## Debugging a failed install

1. Read `Docs/landmines.md` first — most failure modes have a documented trap.
2. Then `Docs/how.md` § Installer mechanics for the canonical model.
3. The installer is failure-loud: every error appears in `platform-installed.json`'s history and the console. Don't suppress; investigate.
4. Common traps (see landmines for full detail): malformed JSON in `.obsidian/` allowlisted paths · mid-substitution literal `{{...}}` that escaped substitution · cross-blueprint write into another module's `module_directory` · `customjs.X` constructor-vs-singleton confusion.

## Writing HC cases

When authoring a new harness case that calls `gather-from-served-by-helper.js`'s `gatherFromServedBy({ ..., dry_run_answers })`:

- The `dry_run_answers.agent_markdown` field MUST be **≥ 80 characters**. The helper's `md.length < 80` floor is a structural guard against accidentally-empty agent outputs — fixtures under that floor return `failed:bad-output` even when every other field is well-formed.
- The markdown MUST start with `> [!example]+ <kind_title>\n` (per the helper's prefix check).
- Plausible-looking 4-line fixtures (`> [!example]+ <kind>\n> - bullet one\n> - bullet two\n> - bullet three`) can land under 80 chars depending on bullet lengths — count carefully. Adding one more grounded bullet (`> - <fourth grounded line>`) is the canonical fix and typically pushes the body to ~100-110 chars.

This caveat surfaced as FLN-v79-3 during the v0.79.0 cycle (HC-V0790-B3 / D1 fixtures were initially 78 chars; padded to 106). Apply this rule when writing any new HC case that exercises `gatherFromServedBy`.

## Anti-patterns (see `Docs/prompts/SESSION-START.md` for the canonical list)

- Don't pre-emptively bump versions before the cycle closes.
- Don't `git add -A` — stage explicit files (v0.23.0 lesson; reaffirmed v0.26.0).
- Don't dispatch parallel implementer subagents on coupled tasks.
- Don't paraphrase API contracts in subagent prompts — quote literally.
- Don't author new manifests without diffing against canonical precedent.
- Don't trust "mirror v0.X.0 precedent" without reading the cited file.

## Cycle lessons (load-bearing)

Durable principles distilled from recent cycles' result docs. Each entry cites its origin cycle for traceability. Read at the start of any cycle that involves a refactor, a new helper, or a contract change. Bug-specific lessons (one-off frontmatter parser bugs, particular sub-skill prose fixes) belong in `Docs/cycle-history.md` — this section is for the cross-cycle principles.

### Design + planning

- **Verify helper behavior before the design asserts it.** Grep + read the helper, including its LOADING context (subprocess-spawning vs in-process; workshop-path resolution; vault-path source). v0.93.3 designed against `applyExternalPlugins` install behavior that didn't exist (helper was warning-only); v0.94.0 reinforced twice — `installer.runInstall` is subprocess-spawning (not in-process; needs an in-process shim for mocking), and `bootstrap-lib` resolution breaks under templater copy because `__dirname` becomes the ranch path, not platform/. One grep + one read of the helper file pre-design closes this trap.

- **TDD against the real path, not just adjacent paths.** Distinguish what a test EXERCISES from what it COULD exercise. v0.93.3 lesson: `runBootstrap` end-to-end with `skipInstaller: true` exercises `phaseFetchPlugins` but NOT `applyExternalPlugins`; a true regression net for the install-time path requires invoking `platform/install.js` end-to-end on a synthetic existing vault.

- **Phantom plan steps signal stale assumptions.** Verify scripts and files exist before authoring plan steps that invoke them. v0.95.0 plan referenced `Scripts/regenerate-claude-surface-registry.js` — a script that doesn't exist (registry regen happens inside `platform/install.js`'s Templater context, not as a standalone). One `ls` of the cited path would have caught it.

### Refactor cycle patterns

- **Sub-skill contracts evolve under refactor pressure.** Reserve a slot or two for "I forgot one" extensions during design. v0.95.0 designed a 10-key `plan-dispatch` contract; mid-execution it grew to 12 keys (`effective_hard_rules` added during S1.5.1 for `gather-from-served-by`; `tripwire_aspects` added during S1.5.2 for `midday-tripwire`). Both were organic discoveries as orchestrators consumed the result tree. Design with extension room.

- **Defense-in-depth surfaces resist slimming.** Line targets in design docs must account for the defense floor. v0.95.0 designed 5 orchestrators slimming from ~330 to ~150 lines each; actual outcome was 192-237 lines because verify / write-guard / verbal-commitment surfaces are load-bearing (HC-V0911-WRITE-GUARD-* / HC-V0912-FM-* / HC-V0911-COMMIT-*). The cohesion goal is achieved at the higher floor; just don't over-promise the line delta in design docs.

- **Test-quality drift can mask cohesion regressions.** When refactoring shared prose into a new structural owner, audit prose-lint assertions in the SAME stage — not at preflight discovery time. v0.95.0 S1.5 surfaced 41 pre-existing test failures asserting against prose that the refactor legitimately MOVED. Right fix: re-route the assertions to read the orchestrator + new sub-skill as a combined corpus, OR accept dual patterns (`plan.X` vs `prefs.X`). Preserving the stale prose is the wrong fix.

- **Mid-execution scope expansion needs explicit surfacing.** Three cycles reinforced (v0.93.3 lesson 5.6; v0.94.0 lesson 5; v0.95.0 lesson 5). Document any contract addition / scope adjustment in the commit message AND the touched-skill body. Subagents may quietly merge clearly-needed work that the plan attributes to a later stage — v0.94.0 S1.4 silently included `ranch/platform-subscription.json` lockstep when preflight caught the drift. Plans should make these dependencies explicit (e.g., "S1.4 MUST also bump ranch lockstep or preflight fails").

### Release hygiene

- **Per-cycle VERSION pin sweep is mandatory at S1.4b.** Every `workshop_version` / blueprint bump implies a sweep across `HC-V0*-VERSION-*` assertions in `run-helper-cases.js` + `run-bootstrap.js`, fixture `cowork_version` / `sauce_version` strings, and `scheduled-job-contract.json#contract_version` per landmine #20. Standard hygiene — add to every plan as an explicit S1.4b-equivalent step (v0.93.3 lesson: this was implicit and got missed; v0.95.0 codified the stage label).

- **`ranch/platform-subscription.json` lockstep is required for workshop dogfood.** Manual edit (no `sauce update --bump-pins` runs on the workshop itself); install correctly refuses to "downgrade" a mechanism whose subscription pins to an older version. Land at the same stage as the `workshop_version` bump.

- **Workshop dogfood is a useful contract verifier.** Run before EVERY push (not just cycle close). ~4 seconds, ~82 history entries; catches manifest entry order, materialization paths, and path-resolution drift that preflight misses. v0.95.0 S2 caught a `claude_surface[]` entry-order issue that preflight passed.

### Test hygiene

- **Be defensive about path resolution + explicit about test cleanup.** Tests that resolve paths via fallback can leak artifacts when the fallback lands on the workshop root. v0.94.0 RED-state runs left stale `mechanisms/test-epi*` directories (path leak before S1.2's `bootstrap-lib` fallback fixed the resolution). Pattern: prefer explicit path arguments over `__dirname`-derived guessing; use `os.tmpdir()` + `fs.mkdtempSync()` for transient fixtures; clean up at the end of every test scope.

- **`gatherFromServedBy` HC cases need ≥ 80-char `agent_markdown`.** See § Writing HC cases above for the canonical fix pattern. Surfaced as FLN-v79-3.

## Installer helper history (reference)

Historical schema and installer-mechanic changes (v0.4.2 BREAKING + ADDITIVE, v0.5.0 `openLink` substitution, etc.) are recorded in their respective `Docs/cycle-history.md` sections. Read those instead of trusting any inline summary here — the cycle log is the source of truth for "what changed when."
