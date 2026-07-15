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
5. Read `status.next` before recommending any live action:
   - `claim`: name the eligible card and its model profile. Only this result may lead to a `run --live` recommendation.
   - `no-work`: report `first_blocker` and tell the user to prepare the next card. Never recommend `run --live`.
   - `at-capacity`: name the active cards and recommend resuming one of them. Never claim another card.
6. Unless `--live` is explicit, call `claim --dry-run --json` to show the full read-only plan, report, and stop. In `status` mode, the compact `status.next` result is sufficient; do not claim.
7. Resume the named/eligible active card before claiming fresh work. Otherwise call `claim --json`.

The coordinator may return `implement`, `fix-ci`, `waiting`, `deploy`, `complete`, `blocked`, `no-work`, or `at-capacity`.

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

9. Let the coordinator fetch the current `origin/main`, lock this card's gate run, rerun adequacy, full preflight, isolated workshop self-install, and bumped preflight, then save one receipt tied to the exact head and base commits:

   ```bash
   node scripts/autoloop/codex-coordinator.js verify-gates --card "<card>" --json
   ```

   Any new commit invalidates the reviews and combined receipt. Repeat steps 7–9 after a fix.
10. Push and open the PR against `main`, using the same `fix:` or `feat:` title. Do not arm auto-merge yourself. Record it only after `verify-gates` passes:

   ```bash
   node scripts/autoloop/codex-coordinator.js record-pr --card "<card>" --pr <number> --json
   ```

The coordinator refuses a missing, failed, noncanonical, or stale gate receipt. If an older run already armed auto-merge, it disables that request until the current head/base receipt and GitHub CI are green. A merged PR without a valid exact-head receipt stops at `needs-inspection`.

## Advance

After recording a PR, or when resuming any post-implementation phase, run:

```bash
node scripts/autoloop/codex-coordinator.js advance --card "<card>" --lease-seconds 600 --jsonl
```

Let the coordinator poll feature CI/merge, release PR/merge, tag, tap PR/merge, Homebrew, and the three vault receipts. Describe phase changes briefly; do not re-reason about unchanged polling output.

If it returns:

- `fix-ci`: inspect the named failures in the existing worktree, repair within scope, commit, repeat reviews plus `verify-gates`, push, and advance again if lease remains.
- `verify-gates`: the PR head changed or its receipt is incomplete. Repeat reviews plus `verify-gates`; do not arm or merge it.
- `refresh-feature`: update the existing feature branch from `origin/main`, resolve only in-scope conflicts, rerun every gate, push, and advance again. Never force-push.
- `waiting`: return the saved phase and resume condition.
- `deploy`: run the coordinator's deploy command; do not hand-edit consumer subscriptions beyond the card's explicit map.
- `complete`: reconcile board/card projection, report receipts, and stop.
- `blocked-external`: report the workflow/PR URL. Never use a manual release escape hatch.
- `needs-inspection`: preserve all files and ask for direction.

## Board and completion

Git/PR ancestry is authoritative; the board is a projection. An execution card becomes Completed only after all required vault receipts pass. A parent roadmap card becomes Completed only after every child is deployed.

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
