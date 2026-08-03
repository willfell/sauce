---
name: run
description: One bounded autonomous turn of the delivery loop against the bound board — claim or resume through CI, release, and deployment, driven entirely by the coordinator. Use when asked to run, resume, inspect, dry-run, pause, or recover the loop for this repo, or to run the loop engine unattended. Deterministic scripts own operational state; model context is spent only on implementation, repair, and review.
---

# loop:run

Drive whatever board this repo is bound to. Let deterministic scripts own operational state; spend model context only on implementation, repair, and review. This is the run-loose engine as a skill: same laws, config-driven paths.

The universal start prompt is IDENTICAL for every bound repo:

```text
Use $loop-run --live. Start NOW — do not stop after acknowledging.
```

Everything that used to vary by prompt comes from the binding and this skill: scope from `config.run_scope`, deploy posture from `policy.deploy_vaults`, gates/quorum/receipts from the laws below. Acknowledging the plan without acting is a violation — the first action of a live run is always resolve + status.

## Bind

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json`; refusal → `/loop:init`, stop. Refuse if `config.policy.observe_only`.
2. `<coordinator>` = `config.coordinator` (the INSTALLED coordinator from the binding — never a repo-local copy unless the binding says so); `<gate>` = sibling `gate.js`. Export `config.env` on every call; cwd = repo root.
3. If the binding names a FID (`config.fid_abs`), read it before acting — newest amendments win; its constitution binds absolutely.

## Inputs

Infer the mode from the prompt. Default to `dry-run`; only `--live` (or an explicitly autonomous session) authorizes mutations:

- `run --live`: resume eligible active work first, otherwise claim — resume/claim receipts return `lease_token`; pass `--lease-token <token>` on every subsequent coordinator verb for that card. Resuming an active card is a side-effect-free attach; `lease_held` means another session owns it — take a different card, never work around the refusal. Then KEEP GOING per `config.run_scope`:
  - `board` (default): after each `complete` + reconcile, take the next eligible slice in coordinator/board order, epic by epic, until `status.next` is `no-work` (report `first_blocker` and stop) or a ceiling/halt applies.
  - `epic`: finish the current epic (all its eligible slices), then stop with the receipt.
  - `turn`: one bounded claim-or-resume turn, then stop.
- `resume <card>` / `park <card>`: operate only on that card, only through the coordinator verbs.
- `status`: read-only; do not claim.
- `dry-run` (default): read-only claim and release/deploy plan.
- `recover`: inspect interrupted state; never delete dirty work automatically.

Deploy posture is the binding's, never the prompt's: `policy.deploy_vaults: []` (merge-only) means a slice completes when its feature PR merges with green checks — there is no release/tag/tap/brew/deploy chain, never wait for one. Absent/non-empty `deploy_vaults` means the full deploy-bound chain runs through `advance`. The coordinator's receipts already encode the right chain — trust them over any prompt text.

## Orient and repair (every turn)

1. `node <coordinator> status --json`. If `halted`, stop — never remove the halt file without an explicit user request.
2. Read `projection_problems` and `board_drift` even when no card is active. Repair every UNAMBIGUOUS drift by single-card reconcile (`reconcile --card "<exact name>" --json`, replay to `no_op: true`); log ambiguous ones and leave them.
3. Resume any parked card whose recorded resume condition is already satisfied — quote the satisfying artifact in the receipt.
4. Read `status.next` before any live action: `claim` → name the slice + profile; `no-work` → report `first_blocker`, never claim; `at-capacity` → resume one of the cards listed in `next.resumable` (they are unleased or stale), never claim another; `all-work-leased` → every active card is owned by a live session — report the leased cards + soonest expiry and STOP; never touch a leased card's worktree.

## Execute (the slice path)

Claim → isolated worktree → implement within `touch_zones` (regression test that fails without the change; conventional `fix:`/`feat:` commit; never touch versions/tags/release PRs/tap) → `node <gate> verify-adequacy --base origin/main --json` → three read-only reviews in separate contexts (correctness, regression-risk, test-adequacy), each recorded via `record-review --lease-token <token>` with exact heads, sequential, stop-at-first-refutation → `verify-gates --lease-token <token>` → push + PR + `record-pr --lease-token <token>` → `advance --lease-token <token> --lease-seconds 600 --jsonl` through CI/merge/release/deploy/reconcile per the binding's `execution_mode` and deploy list. On `complete`, reconcile and continue to the next eligible slice.

Refutation → ONE same-card repair, full quorum rerun. Second refutation → supersede at mint via `/loop:intake` (carried findings + binding fixtures) and execute the returned discard through the coordinator. Coordinator return values (`parked`, `fix-ci`, `verify-gates`, `refresh-feature`, `waiting`, `deploy`, `complete`, `completion-projection-failed`, `blocked-external`, `needs-inspection`) are handled exactly as the coordinator prescribes — its receipt, not intuition, is authoritative.

## Laws (bindings inherit them; the FID is the authority)

- The coordinator and intake are the ONLY writers. Never hand-edit boards, cards, or coordinator state.
- Receipts decide truth: the board is a projection; git/PR ancestry + the ledger are authoritative.
- Batch policy may strengthen, never weaken; hard ceilings on distinct cards and hours are never reset by resume.
- Data-safety findings always block. Out-of-threat-model findings are recorded accepted limitations, never refutations — when the FID says so.
- Never idle while claimable work exists; never invent work when the frontier is drained — report `first_blocker` and stop at a durable point.
- Session log: when the binding's project keeps workflow-loop logs (`<project_root>/docs/workflow-loops/`), append one line per state change as you go.

## Final receipt

Phone-sized: card/slice + phase; feature PR, release PR, tag, tap PR when known; installed/target versions; per-vault receipts (per the binding's deploy list); exact blocker or resume condition; next eligible slice + model profile.

Read [references/operations.md](references/operations.md) only when recovery, release attribution, subscription deployment, or concurrency behavior needs explanation.
