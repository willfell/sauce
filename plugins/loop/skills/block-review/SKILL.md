---
name: block-review
description: Heal and report dangling depends_on rot on the bound board. Use when asking "why is this epic blocked", "what's silently blocking the board", "unblock the board", "clean up dead dependencies", or after a supersession leaves dead pointers. Auto-fixes provable danglers through the coordinator and escalates never-minted foundations.
---

# loop:block-review

Find and heal `depends_on` rot on whatever board this repo is bound to: pointers to
cards that no longer exist (superseded/discarded) or never existed (never-minted
foundations). Provable cases are repaired through the coordinator's
`reconcile-dependencies` verb; judgment cases are escalated to the Director one at a
time. The coordinator is the only writer — this skill orchestrates it, never hand-edits
cards or boards.

## Bind

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json`; refusal → `/loop:init`, stop. Refuse if `config.policy.observe_only` unless the Director explicitly authorizes a supervised lift for this pass.
2. `<coordinator>` = `config.coordinator`. Export `config.env` on every command; cwd = repo root.

## Phase 1 — Detect

1. `node <coordinator> status --json` → save to a temp file. Read `board_drift` and `projection_problems`.
2. `node <coordinator> reconcile-dependencies --all --reason "block-review scan" --json` (dry-run; writes nothing). This returns `plan` (provable repoints to the live tail), `reports` (active/parked dependents — untouched), and `needs_decision` (never-minted/dead-end/cycle).
3. The honest Director-facing signal is Obsidian GraphView at epic scope: `dangling_dependency` warnings there must reach zero when this is done.

## Phase 2 — Auto-fix the provable set

1. If `plan` is non-empty, apply: `node <coordinator> reconcile-dependencies --all --reason "<audit>" --apply --json`. Quote each repoint from the receipt.
2. Re-`status`; for any epic whose slices are now all resolvable, run `node <coordinator> reconcile --card "<epic>" --json` so its posture flips `blocked_by_dependencies` → claimable and its lane moves through the sanctioned writer. Never hand-edit a kanban column.

## Phase 3 — Escalate the judgment set (one at a time)

For each `needs_decision` item, ask ONE question, recommendation first: **mint** the missing foundation via `/loop:intake`, or **confirm-clear** (the dep is obsolete/folded elsewhere → run `node <coordinator> reconcile-dependencies --card "<dependent>" --clear "<dead dep>" --reason "<director confirmation>" --apply --json`). Never mint or clear a judgment item without the Director's word.

## Phase 4 — Handoff

Phone-sized: danglers found, provable repairs applied (repoint/clear counts), epics unblocked, judgment items and their decisions, and the residual `needs_decision` count. Confirm both surfaces are quiet: `claim --dry-run` no longer skips on `depends on discarded card …`, and GraphView shows zero `dangling_dependency` warnings.

## NEVER

Hand-edit cards/boards/coordinator state · rewrite active or parked dependents (report them) · mint or clear a judgment item without the Director's decision · run against an `observe_only` board without an explicit supervised lift.
