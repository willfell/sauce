---
name: card-intake
description: Turn raw Sauce requirements, bugs, themes, or roadmap batches into evidence-backed board-ready parents and execution children. Use when asked to intake, plan, decompose, prioritize, roadmap, scout, or prepare Sauce work for $sauce-autoloop, including GA exceptions and Post-GA routing.
---

# Card Intake

Prepare work; never implement or claim it. Default to read-only discovery and ask only for a material choice that repository/vault evidence cannot answer safely.

## Start

1. Resolve the workshop root with Git and read its `AGENTS.md` plus applicable guides.
2. Locate and read the project board, roadmap doc, named requirement/research notes, and directly involved source/tests. Record evidence as `path:line`; a named research/scout artifact may substitute only when it contains those references.
3. Run coordinator status. Treat every active or parked card as immutable and pass their names to the planner as `protected_cards`. Never edit coordinator state.
4. Read `[[Loop System with Codex]]` §Execution-slice contract. Link it from cards; do not copy it.
5. Load the Delivery public contract from `platform/mechanisms/delivery/index.js`. New execution cards use its current version, enums, normalization, policy derivation, and validator; never duplicate that semantic core in this skill.

## Choose depth and route

Capture the desired outcome in one sentence, then classify it as exactly one of:

- `bug`: require reproduction plus file evidence; route to `Discovered (autoloop)` for triage.
- `direct_execution`: one independently releasable execution card.
- `parent_children`: keep a non-claimable parent at tasks root and prepare nested execution children only for that parent.
- `roadmap_theme`: update/create the appropriate `docs/roadmap` note, place dependency-ordered parents in `In Planning` or `Post-GA` as appropriate, and prepare only the first In Planning parent's children.
- `ga_exception`: record the exception in `[[Priorities for GA]]`, then use direct or parent/child shape.
- `post_ga`: place the parent in `Post-GA`; do not decompose it until it becomes the one-parent lookahead.

If basic scope lacks file evidence, name a scout artifact and stop with `awaiting_user_decision`; do not create a claimable execution card.

Select completion mode:

- `release`: eligible only with full execution metadata and explicit `headspace`, `accuris`, and `ero` deployment arrays. Empty arrays mean no subscription additions.
- `docs_only`: set `execution_mode: docs_only`, `release_required: false`, and `deployment_required: false`; route to `Docs Only`, never `In Planning`. The current coordinator is release-only.

Choose `heavy` iff the slice has a new mechanism, shared abstraction, schema, migration/heal, loader change, multi-blueprint surface, or high-regression refactor. Otherwise choose `standard`.

## Build and validate the plan

Create a temporary JSON spec for `scripts/card-intake.js`. Set `project_root` to the existing board's directory, `evidence_roots` to the narrow source/vault roots needed to verify `path:line`, and `link_roots` to the narrow folders needed to resolve emitted wikilinks. Use the script's exported/CLI validation as the low-freedom safety rail:

```bash
node .agents/skills/card-intake/scripts/card-intake.js --spec <spec.json> --json
node .agents/skills/card-intake/scripts/card-intake.js --spec <spec.json> --apply --json
```

Every execution card must include exact touch zones, wikilink-list dependencies, three-vault deployment settings, acceptance tests, applicable guides, trap warnings, and one Delivery-normalized lifecycle status. Evidence claims must pin `source_identity`, `captured_at`, `revision`, `locator`, and `claim`. Execution children live at `tasks/<parent>/<child>/<child>.md`; parents remain at `tasks/<parent>/<parent>.md`.

Before `--apply`, inspect the dry-run plan. Refuse any plan that:

- would alter an In Progress, parked, protected, or live-claimed card;
- lacks evidence, resolved dependencies, deployment map, or concrete acceptance tests;
- makes a parent claimable, places an execution child at root, or decomposes more than the next parent;
- inserts dependency order backwards, uses a non-normalized status, or makes docs-only coordinator-eligible.

The validator stamps `schema_version`, derives a policy that cannot weaken `supervised_only`, and validates through the Delivery public API. Use its atomic/idempotent apply only after validation. Never hand-edit a generated marker region. Re-run the same spec and require `no_op: true`. Remove the temporary spec afterward.

## Supersede a predecessor card

Supersession discards the predecessor at mint time (board line + note deleted; tombstone only), so its learning must be carried by the successor or the successor is unmintable. On an execution card, set:

- `supersedes`: the predecessor card title (execution cards only).
- `carried_findings`: non-empty array of finding names carried forward from the predecessor.
- `binding_fixtures`: non-empty array of fixtures binding those findings — plain strings (same shape as `acceptance_tests`) or `{name, description}` objects.

Coverage rule: every carried finding name must appear as an exact token in at least one binding fixture's name or description (names match case-sensitively), else the spec is refused before any write (`supersede_coverage_missing`, naming each uncovered finding). Missing or empty `carried_findings`/`binding_fixtures` refuse with `supersede_missing_fields` — superseding with zero findings is a contradiction; supersession exists to carry findings forward.

The receipt for a valid superseding spec includes `post_apply_instructions: [{discard: {card, superseded_by}}]`. Intake NEVER touches coordinator state — it only instructs; the run-loose flow / discard runbook executes the instruction via `coordinator discard --superseded-by <successor> --carried-fixture <fixture>`.

Epic-native default: post-cutover (`coordinator status --json` reports `cutover.enabled` true), new medium/heavy work MUST target an epic board; flat creation is reserved for Discovered-lane one-liners.

The cutover flag is receipt-gated and reversible (`coordinator cutover`), so never cache it: read `coordinator status --json` → `cutover.enabled` fresh at planning time (absent or `enabled: false` both mean pre-cutover).

## Finish

1. Resolve every emitted wikilink to a file.
2. Run coordinator status and its eligibility dry-run after apply. Treat that result—not the planner's candidate—as authoritative. Do not claim.
3. Report one posture: `claimable`, `blocked_by_dependencies`, `docs_only`, or `awaiting_user_decision`.
4. When claimable, name the exact next card and `standard`/`heavy` profile. For roadmaps, also name later parents left intentionally undecomposed.
