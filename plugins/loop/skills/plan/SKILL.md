---
name: plan
description: Write an implementation plan AS board schema — an epic plus ordered, contracted slices minted through the sanctioned intake rail on the bound board. Use when turning a spec, proposal, or requirement into sequenced testable slices, when asked to "plan this as cards", or after /loop:brainstorm produces a proposal. Prompts for the work-item id prefix and the board priority position before minting.
---

# loop:plan

The plan IS the cards. This skill does what a writing-plans discipline does — decompose into ordered, independently-testable slices with zero placeholders — except the plan is emitted in the board schema and minted through the card-intake rail. Nothing here hand-edits a board.

## Bind and orient

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json`; refusal → `/loop:init`, stop. If `config.policy.observe_only` is true, refuse (bind-and-observe repo).
2. `<coordinator>` = `config.coordinator`; `<intake>` = `dirname(<coordinator>)/../../.agents/skills/card-intake/scripts/card-intake.js`; env from `config.env` on every call.
3. Read the input: a `/loop:brainstorm` proposal (preferred), a spec, or a raw requirement. Raw requirements with no evidence → run the brainstorm discipline first or gather `path:line` evidence now.
4. `node <coordinator> status --json` — protected cards, `cutover.enabled`, live touch zones.

## Decompose

1. Map the file structure first: which files each slice creates or modifies, one clear responsibility per file. Decomposition is locked here, not during implementation.
2. Right-size: each slice is the smallest unit carrying its own test cycle and an independently releasable deliverable, satisfying the execution-slice contract (bounded surfaces, one risky dimension, one regression harness).
3. Order via `depends_on` chains — slice N+1 depends on slice N; parallel slices share a predecessor. Prose never overrides the dependency graph.
4. Each slice body: bite-sized checkbox steps (failing test with real code → verify fail with exact command → minimal implementation → verify pass → conventional commit), plus an Interfaces block (consumes/produces, exact signatures — a slice's implementer sees only their own card).
5. NO placeholders. "TBD", "handle edge cases", "similar to slice N" are plan failures — fix before minting.

## Prompt the Director (always, before minting)

Ask BOTH, as one question each:

1. **Id prefix** — offer `config.id_prefix` as the default (e.g. `GA` → slices `GA-X1a…`); the chosen prefix names every slice in this epic.
2. **Board priority position** — where in In Planning the epic ranks: `top` (next thing the loop works), `bottom` (queued last), or `after <existing epic>`. Show the current In Planning order from the board so the choice is informed.

## Mint through the rail

1. Build the intake spec JSON bound to the config (`project_root`/`board_path`/`cards_root` from the resolve receipt, `protected_cards` from status, `evidence_roots`/`link_roots` narrow, **`epic_native: true` when `config.board_topology` is `epic` — the default; this guarantees the canonical epic shape (atlas with dashboard + epic board + clean parent-board line) even on a fresh ledger with no cutover history**). Epic + slices with full execution contracts: touch zones, dependency wikilinks, deployment map for every id in `config.policy.deploy_subscriptions`, acceptance tests, guides, traps, normalized status, batch policy from `config.policy`.
2. `node <intake> --spec <spec.json> --json` (dry-run) → review the ENTIRE plan against the refusal list (never alters protected cards; no claimable epic; no backwards dependencies; no placeholder acceptance tests).
3. Present the dry-run summary and get explicit approval.
4. `node <intake> --spec <spec.json> --apply --json` → replay for `no_op: true` → remove the spec file.
5. **Position the epic**: intake appends within In Planning. If the Director chose other than `bottom`, attempt `node <coordinator> restructure --spec <map.json> --json` (dry-run first) to place the epic at the requested rank; if the coordinator refuses the reorder, report honestly: "epic minted at the bottom of In Planning — drag it to <position> (board drag-order is your standing input)."
6. **Review the graph** — open the minted epic's atlas: its GraphView renders the slice dependency graph you just authored (depends_on as solid edges, queue order ghosted, wait reasons on blocked/parked chips). A fast visual check that the decomposition matches intent before execution.

## Execute or wait — the Director's choice

Ask ONE final question: **"Execute now or leave for the loop?"**

- **Execute now** → hand off to `/loop:execute` in this session (sub-agent per slice, full quorum).
- **Leave for the loop** → report the posture (`claimable` / `blocked_by_dependencies`), the first eligible slice + model profile, and stop. The loop picks it up on its next turn.

## Rules

- The board is the plan: no shadow plan document that can drift from the cards (a brainstorm proposal is design history, not the plan).
- Fresh titles only; active, parked, and protected cards are immutable; supersessions go through the intake supersede fields (`supersedes`/`carried_findings`/`binding_fixtures`), never rename-in-lane.
- Apply through the rail, replay to `no_op: true`, never hand-edit.
