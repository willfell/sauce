---
name: execute
description: Drive a freshly minted epic to done in THIS session — sub-agent per slice with the full quorum — instead of waiting for the loop to pick it up. Use when the Director says "execute it now", "drive this epic here", "don't wait for the loop", typically right after /loop:plan mints. Every gate, lens, and receipt of the unattended loop applies; nothing is weakened by being interactive.
---

# loop:execute

In-session epic execution. Identical governance to the unattended loop — the coordinator owns claims/receipts/board writes, Gate B and the three sequential review lenses run per slice, receipts decide truth — the only difference is that the Director is present and the work happens now.

<HARD-GATE>
The full quorum is non-negotiable: Gate B adequacy, then correctness → regression-risk → test-adequacy reviews, sequential, in SEPARATE sub-agent contexts, stop-at-first-refutation, recorded via the coordinator with exact heads. Being interactive weakens nothing.
</HARD-GATE>

## Bind and orient

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json`; refusal → `/loop:init`, stop. Refuse if `config.policy.observe_only`.
2. `<coordinator>` = `config.coordinator`; `<gate>` = sibling `gate.js`; env from `config.env` on every coordinator/gate call; cwd = repo root.
3. `node <coordinator> status --json`. If another card is active, at-capacity rules apply — resume it or stop; never run two writers.

## The slice loop

For each eligible slice of the target epic, in coordinator order (its eligibility answer is authoritative — never hand-pick):

1. **Claim**: `node <coordinator> claim --json` (dry-run first if the Director wants a preview). Work ONLY in the returned worktree and branch.
2. **Implement (sub-agent)**: dispatch ONE implementation sub-agent into the worktree with the slice card as its brief. It enforces `touch_zones`, `model_profile`, dependencies, deployment map; verifies every cited loader/helper before changing code; adds a regression test that fails without the source change; commits with a release-triggering `fix:`/`feat:` title. Never edits versions, tags, release PRs, or the tap.
3. **Gate B**: `node <gate> verify-adequacy --base origin/main --json` in the worktree.
4. **Quorum (three read-only sub-agents, sequential)**: correctness, then regression-risk, then test-adequacy — each a SEPARATE context reviewing `git diff origin/main...HEAD`, each verdict recorded immediately:

   ```bash
   node <coordinator> record-review --card "<card>" --lens <lens> --verdict <pass|refuted> --summary "<specific finding>" --json
   ```

   Uncertain evidence is a refutation. Stop at the first refutation.
5. **Refutation path**: ONE same-card repair, which invalidates the entire quorum — rerun Gate B and all three lenses from scratch. A second refutation → supersede via `/loop:intake` (`supersedes` + `carried_findings` + `binding_fixtures`) and execute the returned discard instruction through the coordinator; never a third patch.
6. **Verify-gates + PR**: `node <coordinator> verify-gates --card "<card>" --json` (full preflight at exact head), then push, open the PR against main with the same conventional title, and `node <coordinator> record-pr --card "<card>" --pr <n> --json`. Never arm auto-merge yourself.
7. **Advance**: `node <coordinator> advance --card "<card>" --lease-seconds 600 --jsonl` — the coordinator polls CI/merge/release/deploy per the binding's `execution_mode` and deploy list. On `complete`, `node <coordinator> reconcile --card "<card>" --json`, then take the next eligible slice.
8. **Blockers**: park only through the coordinator with explicit `--depends-on` + `--resume-condition`; `fix-ci` → repair in the worktree and rerun the quorum; `blocked-external` → report the URL, no manual release escape hatches.

## Ceilings and honesty

Batch ceilings apply in-session exactly as unattended (distinct-card and time budgets; `batch_policy` respected — a `supervised_only` slice REQUIRES this interactive mode, a `stop_after` slice ends the run after completion). Report each slice's receipt phone-sized as it lands: card, phase, PRs, versions, vault receipts, next slice.

## NEVER

Skip or reorder lenses · implement and review in the same context · hand-edit boards/cards/coordinator state · weaken a test to pass · continue past a second refutation · bypass claim for "just a quick fix".
