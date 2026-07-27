---
name: intake
description: Turn raw requirements, bugs, themes, or roadmap batches into evidence-backed board-ready epics and execution slices on the bound board. Use when asked to intake, plan, decompose, prioritize, roadmap, scout, or prepare work for the loop, including supersessions that carry findings forward. Never implements or claims work.
---

# loop:intake

Prepare work on the bound board; never implement or claim it. Default to read-only discovery and ask only for a material choice that repository/vault evidence cannot answer safely. This is the sanctioned planning rail: the card-intake script is the ONLY planning writer, the coordinator the only operational writer — this skill hand-edits nothing.

## Bind

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json` from the repo root; refusal → `/loop:init`, stop. If `config.policy.observe_only` is true, refuse: this binding is bind-and-observe.
2. `<coordinator>` = `config.coordinator` (env from `config.env` on every call). The intake script ships beside the coordinator's repo tree: `<intake> = dirname(<coordinator>)/../../.agents/skills/card-intake/scripts/card-intake.js` — verify it exists; if not, name the path and stop.
3. Run `node <coordinator> status --json`. Treat every active or parked card as immutable; pass their names to the planner as `protected_cards`. Read `cutover.enabled` FRESH from this status — never cache it.

## Ground in evidence

1. Read the bound board (`config.board_path_abs`), the project's roadmap doc if one exists under `config.project_root_abs/docs/`, the named requirement/research notes, and directly involved source/tests. Record evidence as `path:line`; a named research/scout artifact may substitute only when it contains those references.
2. Load the Delivery public contract from the workshop's `platform/mechanisms/delivery/index.js` (sibling tree of the coordinator). New execution cards use its current version, enums, normalization, policy derivation, and validator; never duplicate that semantic core in prose.

## Choose depth and route

Capture the desired outcome in one sentence, then classify it as exactly one of: `bug` (require reproduction + file evidence; route to the Discovered lane), `direct_execution` (one independently releasable slice on an existing epic), `parent_children` / `roadmap_theme` (epic scaffold + dependency-ordered slices; decompose only the first In Planning epic), or a frozen-lane placement per the board's conventions. If basic scope lacks file evidence, name a scout artifact and stop with `awaiting_user_decision` — do not create a claimable slice.

Completion mode: `release` requires full execution metadata and an explicit deployment array for every vault id in `config.policy.deploy_subscriptions` (empty arrays mean no subscription additions; an empty deploy_subscriptions list means merge-only completion). `docs_only` sets `execution_mode: docs_only`, `release_required: false`, `deployment_required: false`. Model profile: `heavy` iff the slice has a new mechanism, shared abstraction, schema, migration/heal, loader change, multi-surface reach, or high-regression refactor; else `standard`. Batch policy defaults from `config.policy.batch_policy`.

## Build and validate the plan

Create a temporary JSON spec for the intake script. Bind it to the config: `project_root` = `config.project_root_abs`, `board_path` = `config.board_path_abs`, `cards_root` = `config.cards_root_abs`; set `evidence_roots` to the narrow source/vault roots needed to verify `path:line`, and `link_roots` to the narrow folders needed to resolve emitted wikilinks.

```bash
node <intake> --spec <spec.json> --json          # dry-run
node <intake> --spec <spec.json> --apply --json  # only after the dry-run is reviewed
```

Every slice must include exact touch zones, wikilink-list dependencies, the full deployment map, acceptance tests, applicable guides, trap warnings, and one Delivery-normalized lifecycle status. Evidence claims pin `source_identity`, `captured_at`, `revision`, `locator`, `claim`.

Before `--apply`, inspect the dry-run plan. Refuse any plan that: would alter an In Progress, parked, protected, or live-claimed card; lacks evidence, resolved dependencies, deployment map, or concrete acceptance tests; makes an epic claimable, places a slice outside its epic board, or decomposes more than the next epic; inserts dependency order backwards, uses a non-normalized status, or makes docs-only coordinator-eligible. Apply only after validation, replay for `no_op: true`, then remove the spec.

## Supersede a predecessor

Supersession discards the predecessor at mint time (board line + note deleted; tombstone only), so its learning must be carried by the successor or the successor is unmintable. On the superseding slice set `supersedes` (predecessor title), non-empty `carried_findings`, and non-empty `binding_fixtures` covering every carried finding name exactly (the script refuses otherwise: `supersede_coverage_missing` / `supersede_missing_fields`). The receipt includes `post_apply_instructions: [{discard: {card, superseded_by}}]` — intake never touches coordinator state; the loop executes the discard via `node <coordinator> discard --superseded-by <successor> --carried-fixture <fixture>`.

## Epic-native placement (post-cutover)

When `cutover.enabled` is true: direct slices name an existing epic and land at `tasks/<Epic>/board/<Slice>.md` (epic-board line only; parent board byte-identical); new themes become canonical epic scaffolds (`tasks/<Epic>/{<Epic>.md, board/<Epic>-board.md, context/{pack.md,runs/,lessons/,decisions/}}`); every slice binds exact `epic`, `task_parent`, `source_board`, `kanban_board`; titles are globally unique; every target must be a regular non-symlink physical descendant of `cards_root`.

## Finish

1. Resolve every emitted wikilink to a file.
2. Run coordinator status and its eligibility dry-run after apply; that result — not the planner's candidate — is authoritative. Do not claim.
3. Report one posture: `claimable`, `blocked_by_dependencies`, `docs_only`, or `awaiting_user_decision`, plus the exact next slice and its model profile when claimable.
