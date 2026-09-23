---
type: sauce-graph
status: idle
---

# Delivery slice

The coordinator's slice pipeline expressed as a graph: claim → implement → adequacy → three review lenses → verify-gates → PR → advance through CI, release, tag, tap, brew, and deploy → complete. The coordinator stays the only board writer; every coordinator call is a `shell` node and the graph only sequences them. Refutation budgets and the supersession stop are edges, not prose.

Run it from a bound repo with `sauce run <this note> --var coordinator=<coordinator.js> --var gate=<gate.js> --follow`. `vars` below are defaults a `--var` overrides.

```sauce
vars:
  coordinator: /opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js
  gate: /opt/homebrew/opt/sauce/libexec/scripts/autoloop/gate.js
  wait_seconds: 300
  adequacy_command: node ${vars.gate} verify-adequacy --base origin/main --cwd ${vars.worktree} --json
  pr_command: cd ${vars.worktree} && git push -u origin ${vars.branch} && { gh pr view --json number,url 2>/dev/null || { gh pr create --fill >/dev/null && gh pr view --json number,url; }; }
nodes:
  - id: claim
    type: shell
    run: node ${vars.coordinator} claim --json
    capture: json
    outcome_from: action
    vars_from: { card: card, lease_token: lease_token, worktree: worktree, branch: branch }
  - id: implement
    type: agent
    worker: claude-code
    cwd: ${vars.worktree}
    prompt: |
      You are implementing the delivery slice "${vars.card}" in this worktree.
      Read the card note the coordinator claimed for it, stay inside its
      touch_zones, write the regression test that fails without the change
      first, make it pass, and commit with a conventional fix:/feat: message.
      Never touch versions, tags, release PRs, or the Homebrew tap, and never
      edit the board, a card note, or coordinator state: the coordinator is
      the only writer of those.
  - id: adequacy
    type: judge
    run: ${raw:vars.adequacy_command}
  - id: lens-correctness
    type: agent
    worker: claude-code
    isolate: none
    cwd: ${vars.worktree}
    prompt: |
      Read-only review of the diff on this branch against origin/main for the
      slice "${vars.card}". Lens: correctness. Does the change do what the card
      says, and nothing it does not say? Outcome pass or refute, one paragraph.
  - id: record-correctness
    type: shell
    run: node ${vars.coordinator} record-review --card ${vars.card} --lens correctness --verdict ${result.lens-correctness.outcome} --summary ${result.lens-correctness.summary} --head "$(cd ${vars.worktree} && git rev-parse HEAD)" --lease-token ${vars.lease_token} --json
    outcome: ${result.lens-correctness.outcome}
  - id: lens-regression
    type: agent
    worker: claude-code
    isolate: none
    cwd: ${vars.worktree}
    prompt: |
      Read-only review of the diff on this branch against origin/main for the
      slice "${vars.card}". Lens: regression risk. What existing behavior could
      this break, and is that covered? Outcome pass or refute, one paragraph.
  - id: record-regression
    type: shell
    run: node ${vars.coordinator} record-review --card ${vars.card} --lens regression --verdict ${result.lens-regression.outcome} --summary ${result.lens-regression.summary} --head "$(cd ${vars.worktree} && git rev-parse HEAD)" --lease-token ${vars.lease_token} --json
    outcome: ${result.lens-regression.outcome}
  - id: lens-adequacy
    type: agent
    worker: claude-code
    isolate: none
    cwd: ${vars.worktree}
    prompt: |
      Read-only review of the diff on this branch against origin/main for the
      slice "${vars.card}". Lens: test adequacy. Does the new test fail without
      the change and pass with it, and does it cover the card's acceptance
      criteria? Outcome pass or refute, one paragraph.
  - id: record-adequacy
    type: shell
    run: node ${vars.coordinator} record-review --card ${vars.card} --lens test-adequacy --verdict ${result.lens-adequacy.outcome} --summary ${result.lens-adequacy.summary} --head "$(cd ${vars.worktree} && git rev-parse HEAD)" --lease-token ${vars.lease_token} --json
    outcome: ${result.lens-adequacy.outcome}
  - id: verify-gates
    type: shell
    run: node ${vars.coordinator} verify-gates --card ${vars.card} --lease-token ${vars.lease_token} --json
    capture: json
    outcome_from: action
  - id: pr
    type: shell
    run: ${raw:vars.pr_command}
    capture: json
    vars_from: { pr: number, pr_url: url }
  - id: record-pr
    type: shell
    run: node ${vars.coordinator} record-pr --card ${vars.card} --pr ${vars.pr} --lease-token ${vars.lease_token} --json
    capture: json
  - id: advance
    type: shell
    run: node ${vars.coordinator} advance --card ${vars.card} --lease-token ${vars.lease_token} --lease-seconds 600 --json
    capture: json
    outcome_from: action
  - id: wait
    type: shell
    run: sleep ${vars.wait_seconds}
  - id: fix-ci
    type: agent
    worker: claude-code
    cwd: ${vars.worktree}
    prompt: |
      CI failed on the feature PR for "${vars.card}". Read the failing checks
      named in the handoff context, fix the cause in this worktree, keep the
      regression test honest, and commit. Never edit the board, a card note,
      or coordinator state. Outcome pass when CI should be green.
  - id: refresh
    type: agent
    worker: claude-code
    cwd: ${vars.worktree}
    prompt: |
      The feature PR for "${vars.card}" is behind origin/main. Rebase this
      branch onto origin/main, resolve conflicts without widening scope, run
      the tests, and push. Never edit the board, a card note, or coordinator
      state. Outcome pass when the branch is current.
  - id: supersession-depth
    type: shell
    run: node ${vars.coordinator} supersession-depth --card ${vars.card} --json
    capture: json
    outcome_from: status
  - id: supersede
    type: human
    ask: Second refutation on this slice. Supersede it via /mayo:intake (carried findings + binding fixtures) and discard the predecessor?
  - id: depth-exceeded
    type: end
    outcome: supersession-depth-exceeded
  - id: done
    type: end
    outcome: done
  - id: no-work
    type: end
    outcome: no-work
  - id: at-capacity
    type: end
    outcome: at-capacity
  - id: all-work-leased
    type: end
    outcome: all-work-leased
  - id: halted
    type: end
    outcome: halted-by-coordinator
  - id: blocked
    type: end
    outcome: blocked
  - id: blocked-external
    type: end
    outcome: blocked-external
  - id: needs-inspection
    type: end
    outcome: needs-inspection
  - id: deploy-failed
    type: end
    outcome: deploy-failed
  - id: projection-failed
    type: end
    outcome: completion-projection-failed
  - id: superseded
    type: end
    outcome: superseded
  - id: parked-on-dependency
    type: end
    outcome: parked-on-dependency
edges:
  - { from: claim, to: implement, on: implement }
  - { from: claim, to: no-work, on: no-work }
  - { from: claim, to: at-capacity, on: at-capacity }
  - { from: claim, to: all-work-leased, on: all-work-leased }
  - { from: claim, to: halted, on: halted }
  - { from: claim, to: blocked, on: blocked }
  - { from: implement, to: adequacy }
  - { from: adequacy, to: lens-correctness, on: pass }
  - { from: adequacy, to: implement, on: fail, max: 1, budget: repair }
  - { from: adequacy, to: supersession-depth, on: exhausted }
  - { from: lens-correctness, to: record-correctness, on: always }
  - { from: record-correctness, to: lens-regression, on: pass }
  - { from: record-correctness, to: implement, on: refute, max: 1, budget: repair }
  - { from: record-correctness, to: supersession-depth, on: exhausted }
  - { from: lens-regression, to: record-regression, on: always }
  - { from: record-regression, to: lens-adequacy, on: pass }
  - { from: record-regression, to: implement, on: refute, max: 1, budget: repair }
  - { from: record-regression, to: supersession-depth, on: exhausted }
  - { from: lens-adequacy, to: record-adequacy, on: always }
  - { from: record-adequacy, to: verify-gates, on: pass }
  - { from: record-adequacy, to: implement, on: refute, max: 1, budget: repair }
  - { from: record-adequacy, to: supersession-depth, on: exhausted }
  - { from: verify-gates, to: pr, on: gates-passed }
  - { from: verify-gates, to: implement, on: fail, max: 1, budget: repair }
  - { from: verify-gates, to: supersession-depth, on: exhausted }
  - { from: pr, to: record-pr }
  - { from: record-pr, to: advance }
  - { from: advance, to: advance, on: phase-change, max: 40, budget: phase-change }
  - { from: advance, to: wait, on: waiting, max: 200 }
  - { from: wait, to: advance }
  - { from: advance, to: fix-ci, on: fix-ci, max: 2 }
  - { from: fix-ci, to: verify-gates }
  - { from: advance, to: refresh, on: refresh-feature, max: 3 }
  - { from: refresh, to: verify-gates }
  - { from: advance, to: verify-gates, on: verify-gates, max: 2 }
  - { from: advance, to: implement, on: needs-implementation, max: 1, budget: reimplement }
  - { from: advance, to: advance, on: deploy, max: 10, budget: deploy }
  - { from: advance, to: done, on: complete }
  - { from: advance, to: projection-failed, on: completion-projection-failed }
  - { from: advance, to: blocked, on: blocked }
  - { from: advance, to: blocked-external, on: blocked-external }
  - { from: advance, to: needs-inspection, on: needs-inspection }
  - { from: advance, to: deploy-failed, on: deploy-failed }
  - { from: supersession-depth, to: supersede, on: ok }
  - { from: supersession-depth, to: depth-exceeded, on: at-limit }
  - { from: supersession-depth, to: depth-exceeded, on: fail }
  - { from: supersede, to: superseded, on: pass }
  - { from: advance, to: parked-on-dependency, on: parked }
  - { from: advance, to: halted, on: halted }
  - { from: advance, to: needs-inspection, on: exhausted }
```
