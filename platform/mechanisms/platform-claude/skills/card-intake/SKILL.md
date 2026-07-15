---
name: card-intake
description: Turn raw Sauce requirements, bugs, themes, or roadmap batches into evidence-backed board-ready parents and execution children. Use when asked to intake, plan, decompose, prioritize, roadmap, scout, or prepare Sauce work for the Codex loop, including GA exceptions and Post-GA routing.
---

# Card Intake

Prepare work; never implement or claim it. Default to read-only discovery and ask only for a material choice that repository/vault evidence cannot answer safely.

## Start

1. Resolve the workshop and project roots. Read their router files and applicable guides.
2. Read the board, roadmap, named requirement/research notes, directly involved source, and tests. Record `path:line` evidence; a named research/scout artifact substitutes only when it contains those references.
3. Run coordinator status. Treat active and parked cards as immutable. Never edit coordinator state.
4. Read `[[Loop System with Codex]]` §Execution-slice contract. Link it from cards; do not copy it.

## Classify and route

Capture the outcome in one sentence, then choose exactly one:

- `bug`: require reproduction plus file evidence; route to `Discovered (autoloop)`.
- `direct_execution`: create one independently releasable execution card.
- `parent_children`: retain a non-claimable parent at tasks root; place children under `tasks/<parent>/<child>/<child>.md`.
- `roadmap_theme`: update/create the appropriate `docs/roadmap` note, add dependency-ordered parents to `In Planning` or `Post-GA` as appropriate, and prepare only the first In Planning parent's children.
- `ga_exception`: record the exception in `[[Priorities for GA]]`, then use direct or parent/child shape.
- `post_ga`: place the parent in `Post-GA`; do not decompose it before it becomes the one-parent lookahead.

If basic scope lacks file evidence, name a scout artifact and stop as `awaiting_user_decision`; never create a claimable execution card.

Select completion mode:

- `release`: require full execution metadata and explicit `headspace`, `accuris`, and `ero` deployment arrays. Empty arrays add no subscriptions.
- `docs_only`: set `execution_mode: docs_only`, `release_required: false`, and `deployment_required: false`; route to `Docs Only`, never `In Planning`. The current coordinator is release-only.

Choose `heavy` iff work adds a mechanism, shared abstraction, schema, migration/heal, loader change, multi-blueprint surface, or high-regression refactor. Otherwise choose `standard`.

## Author safely

Every execution card requires exact touch zones, wikilink-list dependencies, deployment settings, acceptance tests, applicable guides, trap warnings, and one status from `planning|in_progress|blocked|parked|completed`. Keep parents non-claimable and visible in Planning with their child annotation.

Before writing, set `project_root` to the existing board's directory and keep all mutation paths inside it. Provide narrow `evidence_roots` for real `path:line` validation and `link_roots` for emitted links. Refuse any action that would:

- alter In Progress, parked, protected, or live-claimed work;
- omit evidence, dependencies, deployment map, applicable guides, or concrete tests;
- place a child at tasks root, decompose later roadmap parents, reverse dependency order, or make docs-only coordinator-eligible;
- touch generated router marker regions or the coordinator ledger.

When available, resolve the installed workshop path and dry-run its deterministic validator:

```bash
node <workshop>/.agents/skills/card-intake/scripts/card-intake.js --spec <temporary-spec.json> --json
node <workshop>/.agents/skills/card-intake/scripts/card-intake.js --spec <temporary-spec.json> --apply --json
```

Inspect the plan before apply. Re-run the same spec and require `no_op: true`; then remove it. If the validator is unavailable, preserve the same constraints and make atomic, minimal edits.

## Finish

Resolve every emitted wikilink. Run coordinator status and its eligibility dry-run after apply, treating that result—not the planner candidate—as authoritative. Do not claim. Report exactly one posture: `claimable`, `blocked_by_dependencies`, `docs_only`, or `awaiting_user_decision`. When claimable, name the exact card and `standard`/`heavy` profile; for roadmaps, name later parents intentionally left undecomposed.
