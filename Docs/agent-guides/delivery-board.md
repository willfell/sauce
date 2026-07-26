---
purpose: The epic-centric delivery board topology and its discard governance — two-level boards, the `discarded` terminal state with tombstones, supersession at mint time, and the coordinator's reap / restructure / cutover operations plus the retroactive digest.
load_when: Touching the sauce delivery board, coordinator lifecycle code, card-intake supersession, the triage/digest skills, or reasoning about why a card/branch/worktree disappeared.
---

# Delivery board & discard governance

> Authoritative sources: `Docs/superpowers/specs/2026-07-25-board-governance-redesign-design.md` (design spec) and `Docs/superpowers/plans/2026-07-25-board-governance-redesign.md` (implementation plan). This guide orients; read those for rationale and full clause text. Code of record: `scripts/autoloop/codex-coordinator.js`, `platform/mechanisms/delivery/scripts/delivery-contract.js`, `scripts/autoloop/delivery-status-digest.js`, `scripts/autoloop/delivery-review-triage.js`.

## Two-level board topology

The parent board (`sauce-board.md`) holds **only epics** plus triage and history:

- **In Planning** — drag-ordered epic priority queue; drag order is the Director's one standing input.
- **In Progress / Blocked** — *derived*: the coordinator paints the epic's line from its slice rollup (`epicProjectionMapping`). Never hand-maintain these lanes.
- **Discovered** — triage inbox of one-line findings.
- **Post-GA / Completed / Archive** — deliberately frozen work and history.

Each epic owns the canonical scaffold `tasks/<Epic>/{<Epic>.md (atlas, type: epic), board/<Epic>-board.md, context/{pack.md,runs/.keep,lessons/.keep,decisions/.keep}}`. Slices live flat in the epic's `board/` with globally unique titles, `type: slice`, and exact `epic`/`task_parent`/`source_board`/`kanban_board` backlinks plus the Delivery execution contract fields. When cutover is enabled, status and claim share one authoritative two-level selector: the frontier slice of the highest-priority eligible epic, resolved only from the slice file beside that exact epic board (`selectCoordinatorCandidate` → `resolveEpicBoardSet`). The epic atlas is never parsed as an execution card, and a same-title note elsewhere cannot satisfy the board line.

Card-intake resolves `brew --prefix sauce` and reads that installed coordinator's status fresh on every planning pass. Post-cutover direct execution targets an existing canonical epic and changes only its slice note plus epic board; new roadmap parents create the full canonical scaffold and put only epic lines on the parent board. Unexpected partial-scaffold bytes fail before writes, while matching intended bytes resume idempotently. Flat execution intake is refused except for the existing one-line `Discovered (autoloop)` bug-triage route. Absent/disabled cutover retains the legacy flat planner and selector unchanged.

Before dry-run or apply can succeed, every epic root, board directory, context directory, scaffold component, and slice target must resolve as a regular non-symlink physical descendant of `cards_root`. The complete plan is validated before its first mutation, so a symlinked partial scaffold cannot redirect atlas, board, context, or slice writes outside the project.

The epic atlas renders an **EpicDashboard** rollup fed by `deriveEpicLifecycle` (delivery-contract.js). Bucket semantics: `completed→done`, `in_progress→active`, `parked→waiting`, `blocked→blocked`, `discarded→excluded entirely`, else `planned`. **Waiting rolls up like blocked** — a parked slice is a short-lived concurrency/deploy wait, never progress, and a claimable sibling must not hide it.

## The `discarded` terminal state

Dead work is **removed, not curated**: board line and card note deleted, worktree pruned, `codex-autoloop/*` branch deleted (guarded — never a branch with a recorded feature PR or a live worktree checkout). What survives is a **tombstone** in the coordinator ledger: `{discarded_at, discard_reason, superseded_by, final_head (40-hex or null), carried_fixtures[]}`.

Tombstones are invisible machine state — never projected to a board, never counted in a rollup, retained forever. They guarantee:

1. The name can never be reused or re-claimed (`selectClaimCandidate` checks the ledger).
2. A `depends_on` pointing at a discarded card **fails loudly** — never silently satisfied.
3. `status --json` can answer "what happened to X".

**Deletion of a card note or board line is sanctioned ONLY through coordinator `discard`/`reap`.** Hand-deleting produces drift the reconciler will flag. Discard refuses deployed or active in-flight work — only parked/blocked/failed/cancelled (or untracked residue) is discardable. Replays must be literal: identical operands return `no_op: true`; different operands throw.

## Supersession = discard at mint

When a superseding sibling X2 is minted, the predecessor X is discarded at mint time — no park-as-evidence, no rename-in-lane. The learning-preservation guarantee moved to intake: **card-intake refuses a superseding spec whose `binding_fixtures` do not cover every name in `carried_findings`** (each finding name must appear as an exact, case-sensitive token in at least one fixture's name or description; refusal codes `supersede_coverage_missing` / `supersede_missing_fields`). The valid-spec receipt carries `post_apply_instructions: [{discard: …}]` — intake never touches coordinator state; the loop executes the instruction via `coordinator discard --superseded-by <successor> --carried-fixture <fixture>`. Learning's canonical homes: committed fixtures in the successor, FID policy tables, epic `context/` notes, git history.

## Coordinator operations

All four require `--json` (refused before any read or write) and run under the selector lock.

**`discard --card <name> --reason <why> [--superseded-by <successor>] [--carried-fixture <f>]... --json`** — the per-card path described above. Receipt: tombstone fields plus `board_line_removed`, `note_deleted`, `worktree_removed`, branch receipt (`deleted` or `retained_unsafe_to_delete` with reason), and an epic-projection receipt when the card sat on an epic board.

**`reap --json [--also <name>]...`** — idempotent bulk backstop. Discards superseded corpses inferred from the ledger (settled card whose deployed stem-sibling names itself the successor — the inference now lives in the coordinator; the triage skill's old copy is gone), discards settled planning containers ("(decomposed → …)" stubs whose children are all tombstoned/completed), strips surviving stub annotations, removes duplicate card lines and tombstone residue lines/notes across the parent board and every epic board. `--also` names ride the same discard core and are validated up front so a typo never aborts mid-batch. On a settled board the receipt is `no_op: true` — replay is free.

**`restructure --spec <map.json> --json`** — the sanctioned flat→epic migration. The spec is `{project_root, board, epics: [{epic, members[]}]}` with duplicate/unsafe-name refusals. A durable intent journal is written **before** the first mutation; every write is content-addressed (preimage hash + intended bytes), so a crashed pass resumes forward only where targets match the recorded preimage or intended result and fails closed on any third state. Member notes move into the epic's `board/`, frontmatter is rewritten to the slice binding (body byte-identical), and the parent board's member lines collapse to one epic line. Completed replay: `no_op: true`, zero vault writes.

**`cutover --json [--require-card <name>]... [--chain-prefix <prefix>]` / `cutover --off --reason <why> --json`** — receipt-gated, reversible epic-intake flag. Enable requires three deterministic receipts: the declared ES chain terminal-complete in the ledger (a prefix matching zero cards fails — no vacuous pass), the migration harness still registered in `package.json`, and ≥3 consecutive clean full reconciles. Any red returns `cutover-refused` listing every unmet criterion, zero writes. Every flip appends to `cutover_history` (bounded to 20) so digests can report flips between reads. Consumers must read `status --json` → `cutover.enabled` **fresh** — absent or `false` both mean pre-cutover.

**`reconcile-metadata --parked-rebind --reason <why> --dry-run --json` / `reconcile-metadata --parked-rebind --reason <why> --spec <receipt.json> --apply --json`** — finite post-cutover repair for the eight named parked records whose saved Delivery contract still points at the legacy `Priorities for GA` epic while their canonical slice notes already point at their physical epic. Dry-run refuses unless the live parked metadata finding set is exactly those eight and each difference is epic-only, then emits a content-addressed spec. Apply requires that exact spec, reason, card preimage SHA, intended byte-identical card SHA, and old/new epic pair for every target. One atomic ledger write rebinds only `delivery_contract.epic` and appends the audit while preserving the complete serialized state envelope, including top-level `updated_at`; it does not rewrite cards, boards, projections, branches, worktrees, gates, reviews, dependencies, phases, or resume conditions. A completed run accepts only literal replay of the identical successful apply request and returns `no_op: true`; missing, extra, active, completed, mixed, third-state, or substituted input refuses before writes.

## The retroactive digest

Nothing waits on a human; instead `delivery:status` reports what happened **since you last looked**: discards (with reasons/successors), cutover flips, and `SELF-RATIFIED <date>` FID amendment headings. `scripts/autoloop/delivery-status-digest.js` keeps its own marker file `.delivery-digest-last-seen` beside the coordinator state file; a normal read updates the marker after a successful render, `--peek` renders without updating it. Over-inclusion is the deliberate safe side (timestamp-less discards and same-day amendments always show). Known gap: ceilings-hit and decompositions are specced digest feeds but `status --json` does not expose them yet. `delivery:review` walks the digest and surfaces perimeter items; its triage classifier (`delivery-review-triage.js`) has no superseded-corpse bucket anymore — parked classifies only as genuine concurrency/deploy waits or Director-visible escalations.

## Read these next

- Governance clauses, constitution, perimeter rule → the design spec (§3) named at the top.
- Cleanup pass ordering (reconcile → reap → restructure → cutover → reconcile) → spec §4.
- Intake mechanics for supersede/epic-native routing → `.agents/skills/card-intake/SKILL.md`.
- Release/deploy chain the slices ride → [build-test-verify.md](build-test-verify.md).
