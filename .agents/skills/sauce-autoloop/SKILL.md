---
name: sauce-autoloop
description: Run or resume one bounded Sauce board execution slice from claim through CI, automated release, Homebrew promotion, and verified deployment to headspace, Accuris, and ERO. Use when the user asks to run, resume, inspect, dry-run, pause, or recover the Sauce Codex loop or invokes $sauce-autoloop from a local/Remote Sauce project task.
---

# Sauce Autoloop

Run one resumable Sauce turn. Let deterministic scripts own operational state; spend model context only on implementation, repair, and review.

## Inputs

Infer the mode from the prompt. Default to `dry-run`; only `--live` authorizes mutations:

- `run --live`: resume eligible active work first, otherwise claim one card.
- `resume <card>`: operate only on that card.
- `park <card>`: park only that claimed pre-PR card with explicit prerequisites and a resume condition.
- `status`: read-only; do not claim or mutate.
- `dry-run` (default): read-only claim and release/deploy plan.
- `recover`: inspect interrupted state; never delete dirty work automatically.

Use a 600-second polling lease unless the user specifies a shorter one. Never exceed ten minutes without returning a durable resume receipt.

## Start

1. Resolve the workshop root with Git. Do not assume the current task is in the main checkout.
2. Read the root `AGENTS.md` and applicable guides named by the selected card.
3. Run:

   ```bash
   node scripts/autoloop/codex-coordinator.js status --json
   ```

4. If status reports `halted`, stop. Do not remove `.autoloop-halt` without an explicit user request.
5. Read `projection_problems` and `board_drift` even when no card is active. A
   deployed card with a projection problem is not active work, but it is not a
   clean completion report either; reconcile it without redeploying.
6. Read `status.next` before recommending any live action:
   - `claim`: name the eligible card and its model profile. Only this result may lead to a `run --live` recommendation.
   - `no-work`: report `first_blocker` and tell the user to prepare the next card. Never recommend `run --live`.
   - `at-capacity`: name the active cards and recommend resuming one of them. Never claim another card.
7. Unless `--live` is explicit, call `claim --dry-run --json` to show the full read-only plan, report, and stop. In `status` mode, the compact `status.next` result is sufficient; do not claim.
8. Resume the named/eligible active card before claiming fresh work. A parked card
   is never an implicit resume target: report its prerequisites and resume
   condition and stop. Otherwise call `claim --json`.

The coordinator may return `implement`, `fix-ci`, `waiting`, `deploy`, `complete`, `blocked`, `no-work`, or `at-capacity`.

## Park and resume

Never hand-edit shared coordinator state or card dependency metadata. Park only
claimed pre-PR work through the coordinator, naming every prerequisite explicitly:

```bash
node scripts/autoloop/codex-coordinator.js park \
  --card "<card>" \
  --depends-on "<prerequisite card>" \
  --resume-condition "<exact non-empty condition>" \
  --json
```

Repeat `--depends-on` for multiple prerequisites. Park preserves the branch,
worktree, implementation, and historical receipts, but removes the card from
capacity and touch-zone conflict calculations. A failed metadata projection is a
saved reconciliation problem; repair it with `reconcile --card "<card>"` before
attempting resume.

Resume only through the explicit command:

```bash
node scripts/autoloop/codex-coordinator.js resume --card "<card>" --json
```

Resume refuses missing, malformed, self-referential, or unmet dependencies and a
second active child of the same normalized parent. Tracked prerequisites require
`deployed` state plus successful required-vault receipts; the untracked fallback is
a checked `Completed` entry. A parked sibling does not block resume or a new claim.
A successful resume preserves implementation, reports whether `origin/main`
advanced, and never merges, rebases, pushes, or force-pushes. It invalidates every
old review and combined gate receipt, so rerun Gate B, all three reviews, and
`verify-gates` before opening or advancing a PR.

## Supervised pre-PR contract amendment

`amend-contract` is the only supported way to repair the touch zones or deployment
map of an already tracked clean pre-PR card. It is a direct supervised operator
command, never an unattended selector action, and it does not claim, resume,
merge, rebase, push, or modify the target worktree:

```bash
node scripts/autoloop/codex-coordinator.js amend-contract \
  --card "<exact tracked card>" \
  --expected-head "<exact 40-character target HEAD>" \
  --expected-origin-main "<exact 40-character origin/main>" \
  --reason "<non-empty audit reason>" \
  --add-touch-zone "<additive zone>" \
  --expected-deployment '{"headspace":[],"accuris":[],"ero":[]}' \
  --desired-deployment '{"headspace":[],"accuris":[],"ero":[]}' \
  --json
```

Repeat `--add-touch-zone` when needed. Existing zones remain ordered and can never
be removed. The desired deployment map accepts only normalized, deduplicated
`mechanism:name` or `blueprint:name` entries. The structurally exact expected map
is a compare-and-swap operand and may quote an existing legacy bare entry only so
that entry can be repaired; it is never written as desired state.

The command refuses untracked, dirty, missing-worktree, stale-revision,
post-feature-PR, non-release, non-`supervised_only`, projection-drifted, malformed, or
active-zone-conflicting targets. A real change appends an audit record, snapshots
and invalidates reviews plus the combined gate receipt, persists authority before
card projection, and leaves projection failure for `reconcile --card`. An
identical replay after reconciliation returns `no_op: true` without rewriting the
card or receipts.

## Implement

When the action is `implement`:

1. Work only in the returned worktree and branch.
2. Read the selected execution card in full. Enforce its `touch_zones`, `model_profile`, dependencies, and deployment map.
3. Verify every cited loader/helper/precedent before changing code.
4. Keep the slice to one coherent outcome. If it crosses an undeclared touch zone or adds another high-risk dimension, block with a proposed child card.
5. Add a regression test for every behavioral change. It must fail without the source change. Run the targeted test for fast feedback.
6. Commit the clean slice with a release-triggering `fix:` or `feat:` title. Never edit versions, tags, release PRs, or the tap.
7. For behavioral source changes, run Gate B Layer 1:

   ```bash
   node scripts/autoloop/gate.js verify-adequacy --base origin/main --json
   ```

8. If Layer 1 is adequate, dispatch three **read-only** reviewers in separate contexts over `git diff origin/main...HEAD`: correctness, regression risk, and test adequacy. Do not dispatch parallel implementers. Record each returned verdict; uncertain evidence is a refutation:

   ```bash
   node scripts/autoloop/codex-coordinator.js record-review --card "<card>" --lens correctness --verdict pass --summary "<specific finding>" --json
   node scripts/autoloop/codex-coordinator.js record-review --card "<card>" --lens regression-risk --verdict pass --summary "<specific finding>" --json
   node scripts/autoloop/codex-coordinator.js record-review --card "<card>" --lens test-adequacy --verdict pass --summary "<specific finding>" --json
   ```

9. Let the coordinator fetch the current `origin/main`, use this card's shared review/gate/PR/advance lock, rerun adequacy, full preflight, isolated workshop self-install, and bumped preflight, then save one receipt tied to the exact head and base commits:

   ```bash
   node scripts/autoloop/codex-coordinator.js verify-gates --card "<card>" --json
   ```

   Any new commit invalidates the reviews and combined receipt. Repeat steps 7–9 after a fix.
10. Push and open the PR against `main`, using the same `fix:` or `feat:` title. Do not arm auto-merge yourself. Record it only after `verify-gates` passes:

   ```bash
   node scripts/autoloop/codex-coordinator.js record-pr --card "<card>" --pr <number> --json
   ```

The coordinator refuses a missing, failed, noncanonical, or stale gate receipt. Reviews close after the feature PR merges. If an older run already armed auto-merge, the coordinator disables that request until the current head/base receipt and GitHub CI are green. A merged PR without a valid exact-head receipt stops at `needs-inspection`.

## Advance

After recording a PR, or when resuming any post-implementation phase, run:

```bash
node scripts/autoloop/codex-coordinator.js advance --card "<card>" --lease-seconds 600 --jsonl
```

Let the coordinator poll feature CI/merge, release PR/merge, tag, tap PR/merge, Homebrew, and the three vault receipts. Describe phase changes briefly; do not re-reason about unchanged polling output.

## Receipt-bound deployed recovery

Use `recover-deployed` only for a supervised card stranded in `blocked` or a
post-PR phase whose code already shipped. It is never a parked-card resume path.
Dry-run first with the exact preserved feature HEAD, then apply the identical
request and replay it literally:

```bash
node scripts/autoloop/codex-coordinator.js recover-deployed \
  --card "<card>" --expected-head "<40-hex HEAD>" \
  --reason "<audit reason>" --dry-run --json
node scripts/autoloop/codex-coordinator.js recover-deployed \
  --card "<card>" --expected-head "<40-hex HEAD>" \
  --reason "<audit reason>" --apply --json
```

The coordinator itself verifies the merged feature PR's exact head, the merged
release, the current tap formula tag and merged tap PR, installed Homebrew
ancestry, and three vault ledgers. Non-empty subscription additions additionally
require existing green deployment receipts. A successful transition is journaled,
projects `deployed`, preserves branch/worktree/review/gate history, and returns
`no_op: true` on literal replay.

Historical card-only metadata drift uses `reconcile-metadata`, never whole-card
reconciliation. Run its dry-run, pass the returned `card_sha256` back as
`--expected-card-sha256` with `--apply`, then replay that successful apply
literally with the same original hash and reason. The command refuses active
and parked cards, never writes the board, and fails closed if the mismatch would
require anything beyond its narrow ledger-owned metadata fields. A saved
projection error never bypasses that scope check; it is cleared only after the
bounded repair succeeds.

```bash
node scripts/autoloop/codex-coordinator.js reconcile-metadata \
  --card "<card>" --dry-run --json
node scripts/autoloop/codex-coordinator.js reconcile-metadata \
  --card "<card>" --expected-card-sha256 "<dry-run sha256>" \
  --reason "<audit reason>" --apply --json
```

If it returns:

- `parked`: stop. Report dependencies, the exact resume condition, and the
  explicit `resume --card` command; never bypass it or treat the card as normal
  implementation.
- `fix-ci`: inspect the named failures in the existing worktree, repair within scope, commit, repeat reviews plus `verify-gates`, push, and advance again if lease remains.
- `verify-gates`: the PR head changed or its receipt is incomplete. Repeat reviews plus `verify-gates`; do not arm or merge it.
- `refresh-feature`: update the existing feature branch from `origin/main`, resolve only in-scope conflicts, rerun every gate, push, and advance again. Never force-push.
- `waiting`: return the saved phase and resume condition.
- `deploy`: run the coordinator's deploy command; do not hand-edit consumer subscriptions beyond the card's explicit map.
- `complete`: run `reconcile --card "<card>" --json`, verify it succeeds, then
  report deployment and projection receipts.
- `completion-projection-failed`: deployment and vault receipts succeeded but
  board/card projection did not. Preserve every deployment receipt, run the
  single-card reconciliation command, and report both truths until it passes.
- `blocked-external`: report the workflow/PR URL. Never use a manual release escape hatch.
- `needs-inspection`: preserve all files and ask for direction.

## Board and completion

Git/PR ancestry and the shared ledger are authoritative; the board is a
projection. `Completed` and `Archive` are separate lanes. Never treat a checked
or unchecked Archive entry as dependency completion. A tracked dependency is
satisfied only by `phase: deployed` plus successful required-vault receipts;
report a missing checked Completed entry as board drift without rejecting that
authoritative deployment. An untracked dependency requires a checked Completed
entry.

Reconcile one tracked card or every tracked card with:

```bash
node scripts/autoloop/codex-coordinator.js reconcile --card "<card>" --json
node scripts/autoloop/codex-coordinator.js reconcile --json
```

Reconciliation projects `implementing`, `blocked`, and `deployed` into the board
and card frontmatter, plus `parked` dependency/resume metadata into its existing
In Progress card. It never claims, implements, releases, deploys, rolls up a
parent, or changes saved vault receipts. It is idempotent: a second
clean run reports `no_op: true`. Recovery uses this command after inspecting
saved `projection_problems`; do not retry deployment when receipts are already
successful.

Do not commit operational handoffs to `main`. Coordinator state and receipts live under the shared Git common directory.

## Final receipt

Keep the final response phone-sized and include:

- card/slice and phase;
- feature PR, release PR, tag, and tap PR when known;
- Homebrew target/installed version;
- headspace, Accuris, and ERO receipts;
- exact blocker or resume condition;
- next eligible card and `standard`/`heavy` model profile.

Read [references/operations.md](references/operations.md) only when recovery, release attribution, subscription deployment, or concurrency behavior needs explanation.
