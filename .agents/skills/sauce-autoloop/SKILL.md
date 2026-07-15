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
5. Unless `--live` is explicit, call `claim --dry-run --json`, report, and stop. For `status`, report status and stop.
6. Resume the named/eligible active card before claiming fresh work. Otherwise call `claim --json`.

The coordinator may return `implement`, `fix-ci`, `waiting`, `deploy`, `complete`, `blocked`, `no-work`, or `at-capacity`.

## Implement

When the action is `implement`:

1. Work only in the returned worktree and branch.
2. Read the selected execution card in full. Enforce its `touch_zones`, `model_profile`, dependencies, and deployment map.
3. Verify every cited loader/helper/precedent before changing code.
4. Keep the slice to one coherent outcome. If it crosses an undeclared touch zone or adds another high-risk dimension, block with a proposed child card.
5. Add a regression test for every behavioral change. It must fail without the source change.
6. Run targeted tests, then:

   ```bash
   npm run release:preflight
   ```

7. Run workshop self-install when the slice touches manifests, installer behavior, materialized files, commands, skills, or consumer-facing helpers:

   ```bash
   node platform/install.js --vault . --auto-approve
   ```

8. From a clean committed worktree, run `npm run release:preflight-bumped` for component-changing work.
9. For behavioral source changes, run Gate B Layer 1:

   ```bash
   node scripts/autoloop/gate.js verify-adequacy --base origin/main --json
   ```

10. If Layer 1 is adequate, dispatch three **read-only** reviewers in separate contexts over `git diff origin/main...HEAD`: correctness, regression risk, and test adequacy. Do not dispatch parallel implementers. Treat missing/uncertain reviews as refutations; use `gateVerdict` from `scripts/autoloop/gate.js` and block when two or more refute.
11. Commit conventionally. Never edit versions, tags, release PRs, or the tap.
12. Push, open a PR against `main`, and arm squash auto-merge. Record it:

   ```bash
   node scripts/autoloop/codex-coordinator.js record-pr --card "<card>" --pr <number> --json
   ```

## Advance

After recording a PR, or when resuming any post-implementation phase, run:

```bash
node scripts/autoloop/codex-coordinator.js advance --card "<card>" --lease-seconds 600 --jsonl
```

Let the coordinator poll feature CI/merge, release PR/merge, tag, tap PR/merge, Homebrew, and the three vault receipts. Describe phase changes briefly; do not re-reason about unchanged polling output.

If it returns:

- `fix-ci`: inspect the named failures in the existing worktree, repair within scope, rerun every gate, push, and advance again if lease remains.
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
