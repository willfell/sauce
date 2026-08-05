# Loop integrity — Workstream 2: One source of truth

**Date:** 2026-08-04 · **Status:** approved · **Workstream:** loop-integrity program #2 (treats disease A — "one fact, two sources, nothing forcing agreement") · **Ships as:** patch

> Read [`2026-08-04-loop-integrity-program.md`](2026-08-04-loop-integrity-program.md) first — it is the only place the whole picture is written down. This spec covers workstream 2 alone.

## The disease

Disease A: a single fact is computed independently in two places, and nothing forces the two answers to agree. Three instances are in scope here:

1. **Canonical path derivation.** "Where does epic *X*'s atlas/board live, project-relative" is computed by the coordinator (`physicalProjectPrefix` + inline `expected*Path` in `canonicalEpicProjection`, the throwing *authority*) **and** mirrored in intake (`physicalProjectPrefix`/`projectPrefix`/`parentBoardRef`/`epicRoute`, a non-throwing copy added in v0.281.1). The v0.281.1 fix made intake *mirror* the coordinator; mirroring removes today's drift without removing the ability to drift.
2. **Board vs ledger authority.** When a slice's board-declared status disagrees with the coordinator ledger, which wins? The rule already holds implicitly inside `deriveEpicProjection` but is unwritten and re-implemented per consumer.
3. **Release bump: local vs CI.** `release:plan` reads the branch's individual commits; the bumper reads the squashed PR title. v0.281.1 shipped a new CLI verb as a patch because the two disagreed and nothing checked.

The cure is the same for all three: **one physical implementation of the fact, every consumer routed through it.**

## Non-goals

- **No durable/shared ledger** (workstream 4). The local-per-clone ledger stays; this workstream does not touch its storage.
- **No auto-healing or new remediation verbs.** `heal-epic-bindings` / `reconcile` remain the remedies.
- **No change to what board-health reports.** Divergence classes must be provably unchanged before/after (verified with `board-health --json`).
- **The sticky-notes harness flake is not folded in** (`PERF-7-HARNESS`; re-run rule applies, its own cycle).

---

## Item 1 — Canonical path derivation, one physical implementation

### New shared module

`platform/mechanisms/delivery/scripts/delivery-topology.js` — an fs-touching module (the pure `delivery-contract.js` stays pure), exposed on the delivery mechanism as `delivery.topology.*`. Both consumers already hold the mechanism object (`select-card.js` → coordinator; `card-intake.js` directly), so `delivery.topology.*` reaches both.

Exports:

| Function | Signature | Behavior |
| --- | --- | --- |
| `physicalProjectPrefix` | `(cardsRoot, fsImpl?) → {prefix, root}` | The canonical **throwing** authority, moved verbatim from the coordinator. `fsImpl` optional for test injection; defaults to `require('fs')`. |
| `canonicalWorkspacePath` | `(value, expected) → boolean` | The shared path-shape validator, moved from the coordinator. |
| `epicBindingPaths` | `(prefix, epic) → {atlasRef, boardRef}` | Project-relative posix refs: `<prefix>/tasks/<epic>/<epic>.md` and `<prefix>/tasks/<epic>/board/<epic>-board.md`. |
| `parentBoardRef` | `(prefix, parentBoardBasename) → string` | `<prefix>/<basename>`, posix. |

The delivery index (`platform/mechanisms/delivery/index.js`) re-exports it under a `topology` namespace so the pure-contract surface is unchanged and the fs-touching surface is clearly separated.

### Coordinator changes (`scripts/autoloop/codex-coordinator.js`)

- Delete local `physicalProjectPrefix` and `canonicalWorkspacePath`; import from `delivery.topology`.
- In `canonicalEpicProjection`, build `expectedParentBoardPath` / `expectedAtlasPath` / `expectedBoardPath` from `parentBoardRef` / `epicBindingPaths` instead of inline `path.posix.join`.
- `heal-epic-bindings` (the `planEpicBindingHeal` path) uses the same shared functions — so **what `canonicalEpicProjection` validates, what `heal-epic-bindings` writes, and what intake mints are literally one function.**

Behavior is byte-identical; this is a pure extraction. Test-pinned by the existing `run-codex-autoloop.js` (2683 assertions) staying green.

### Intake changes (`.agents/skills/card-intake/scripts/card-intake.js`)

- **Delete** intake's `physicalProjectPrefix` mirror.
- Keep a thin `safePhysicalProjectPrefix(cardsRoot)` that calls `delivery.topology.physicalProjectPrefix` and catches the throw, returning `''` — intake's *legitimate* fixture/non-vault tolerance, not a re-implementation of the canonical logic.
- `projectPrefix` keeps its intake-specific `source_board` fallback (for absolute/absent inputs from the skill body) but sources the canonical prefix from `safePhysicalProjectPrefix`.
- `parentBoardRef` and `epicRoute`'s `atlas_ref`/`board_ref` are built from `delivery.topology.parentBoardRef` / `epicBindingPaths`.

Net: the *canonical derivation* has exactly one physical implementation. What survives in intake is only its fixture-tolerance wrapper and the source_board fallback — both intake-specific, neither a mirror.

---

## Item 2 — Board-vs-ledger authority: one enforced resolver

### The rule (as it already holds, now stated)

For any slice, resolving "what is this slice's status, and is it *proven done*":

1. **A ledger record present → the ledger wins** (`source: 'ledger'`). `doneProven` iff the record carries successful deployment receipts.
2. **No ledger record → the board slice frontmatter is a *declaration only*** (`source: 'board'`). A board-declared `completed` is **never** `doneProven` — the board cannot mark itself done.

This is exactly what `deriveEpicProjection` does today (ledger `trackedMapping` wins; a receiptless `completed` is demoted to `in_progress` and emits a `legacyCompletionFinding`). It is written nowhere and re-derived in `deriveEpicProjection`, `noteProjectionMapping`, and board-health check 4.

### New shared resolver

`delivery.topology.resolveSliceAuthority({ sliceRaw, record, normalizeStatus, hasDeployReceipts })` → frozen `{ status, doneProven, source }`.

- `normalizeStatus` and `hasDeployReceipts` are injected (the coordinator owns `successfulDeploymentReceipts` and `delivery.normalizeStatus`); the resolver stays free of coordinator internals.
- Encodes rules 1–2 above; a receiptless `completed` returns `status: 'in_progress'` (the demotion) with `doneProven: false`.

`deriveEpicProjection`, `noteProjectionMapping`, and board-health check 4 route their board-vs-ledger decision through this one function. The `legacyCompletionFinding` emission stays in the coordinator (it is a projection concern), driven by the resolver's `source`/`doneProven`.

### Enforcement (the assertion)

`delivery.topology.assertProjectableStatus(verdict, lane)` — a fail-closed backstop that **throws** if a caller tries to paint a *complete* lane (`Completed`, `epicProjectionMapping(...).complete === true`) while `verdict.doneProven === false`.

- Correct callers can never trigger it: the resolver already downgraded receiptless-completed before a lane is chosen.
- It guards the **contract** — a future consumer re-implementing the rule wrong — **not drift data**. A receiptless-completed slice on a real board is expected drift the system handles gracefully (finding + demotion), and this assertion does not change that.
- Therefore board-health's "one throwing epic is a finding, not an abort" posture and the loop's graceful degradation are untouched. The throw is unreachable in correct code = a true invariant assertion.
- Test-pinned with a synthetic misuse (a verdict with `doneProven:false` handed to a complete lane must throw) and a positive case (agreeing verdict projects cleanly).

### Documentation

State rules 1–2 explicitly in `Docs/agent-guides/delivery-board.md` under a new "Board vs ledger authority" heading, citing `resolveSliceAuthority` as the one implementation.

---

## Item 3 — CI gate: PR-title bump vs branch commits

### The gate

New `scripts/release/check-title-bump.js`. Reuses the existing release library wholesale:

- **Branch answer** = `computePlan(getCommits('origin/<base>..HEAD'), manifest).workshop.level` — exactly the pre-squash level the bumper would compute over the branch commits.
- **Title answer** = `bumpLevel(parseCommit(title), manifest.workshop_version.startsWith('0.'))`.
- Exits non-zero with a readable diff when the two differ, **or** when the title is not a conventional-commit header (a non-parseable title is itself a failure — the bumper would read `none`).

This is precisely the v0.281.1 catch: branch `feat` (minor) behind a PR titled `fix` (patch) → `minor !== patch` → fail.

Inputs: `--title "<t>"` (falls back to `PR_TITLE` env, then the GitHub event payload) and `--base <ref>` (defaults `main`).

### Local dogfood + harness

- npm target `release:check-bump` runs the script locally.
- New harness `platform/test/run-release-title-gate.js`: the v0.281.1 mismatch scenario (fail), an agreeing scenario (pass), a non-conventional-title scenario (fail), and a `feat!`-pre-1.0 scenario (breaking → minor for the pre-1.0 umbrella). Wired into `release:preflight`.

### Workflow YAML

A `pr-title-bump` job on `pull_request` in `.github/workflows/ci.yml` (or a small dedicated `pr-title-bump.yml`) that runs:

```
node scripts/release/check-title-bump.js --title "${{ github.event.pull_request.title }}" --base "origin/${{ github.base_ref }}"
```

Pushed to the branch using the Director's **temporary workflow-scoped token** (Claude's OAuth cannot push `.github/workflows/*`). Because `pull_request` runs the **base branch's** workflow definition, the gate begins protecting PRs opened *after* this lands on `main`; **this** PR self-verifies via the npm target + harness, which exercise the identical code path.

---

## Process & guardrails

- **TDD per item** (`superpowers:test-driven-development`): red → green → commit per behavior.
- `board-health --json` snapshot **before and after** the whole change, proving the divergence classes are unchanged (the workstream-1 instrument).
- **Commit plan, all ≤ patch** so the item-3 gate this PR introduces would itself pass, and the chosen patch bump is honest:
  - `refactor(delivery): extract canonical project-path derivation into shared topology`
  - `refactor(coordinator): consume shared delivery topology; drop local prefix derivation`
  - `refactor(card-intake): consume shared delivery topology; delete physicalProjectPrefix mirror`
  - `fix(delivery): single enforced resolver for board-vs-ledger slice authority`
  - `ci(release): gate PR-title bump against branch-commit bump`
  - `docs(delivery): state board-vs-ledger authority rule` + cycle-close docs
  - Highest bump = `patch` (from the `refactor`/`fix` commits touching the delivery mechanism). **PR title carries `fix`/`refactor` → patch → the new gate agrees.**
- `release:preflight` + `release:preflight-bumped` green before merge.
- One branch, one PR. No hand-versioning, no hand-tags, no `Co-authored-by: Claude` trailer.

## Success criteria

- [ ] `delivery.topology.*` is the only implementation of project-path derivation; intake's mirror is deleted; `run-codex-autoloop.js` + `run-card-intake.js` green.
- [ ] `resolveSliceAuthority` is the only board-vs-ledger reconciliation; `assertProjectableStatus` throws on contract misuse (test-pinned); board-health divergence classes unchanged.
- [ ] `check-title-bump.js` + `run-release-title-gate.js` green; the v0.281.1 scenario fails the gate; workflow YAML applied and gating future PRs.
- [ ] Full `release:preflight` + `release:preflight-bumped` green; PR title bump = patch, gate agrees.
