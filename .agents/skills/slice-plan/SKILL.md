---
name: slice-plan
description: Write an implementation plan as an ordered chain of board card slices, then implement the slices in dependency order. Use when asked to plan a feature as cards, turn a spec into sequenced testable slices, or execute an existing sliced plan card by card.
---

# Slice Plan

Two modes. Announce which one you are in. PLAN writes the plan as cards on a board; IMPLEMENT executes those slices in order. Never start IMPLEMENT before PLAN's approval gate.

## PLAN mode — the plan IS the cards

1. Read the spec or requirement plus applicable guides. Record evidence as pinned `path:line` with a capture note; claims about mutable state name their snapshot.
2. Map the file structure first: which files each slice creates or modifies, one clear responsibility per file. Decomposition is locked here, not during implementation.
3. Right-size slices: each slice is the smallest unit that carries its own test cycle and produces an independently testable deliverable. On a delivery board, each slice must satisfy the execution-slice contract (bounded surfaces and files, one risky dimension, one regression harness).
4. Lay out the cards: ONE non-claimable parent (goal, architecture, global constraints with exact values copied verbatim) plus ordered slice children at `tasks/<parent>/<slice>/<slice>.md`. Order is encoded as `depends_on` chains — slice N+1 depends on slice N; parallel slices share the same predecessor. Prose never overrides the dependency graph.
5. Write each slice body as bite-sized checkbox steps (2–5 minutes each): write the failing test (real code in the card), run it to verify it fails (exact command, expected output), write the minimal implementation (real code), run to verify pass, commit (conventional message). Include an Interfaces block — consumes/produces with exact signatures, because a slice's implementer sees only their own card.
6. NO placeholders. "TBD", "handle edge cases", "similar to slice N", or steps without code are plan failures — fix them before applying.
7. Apply through the rail, never by hand: build a card-intake spec JSON → dry-run → review the full plan → `--apply` → prove `no_op: true` on rerun. Fresh IDs only; active, parked, and protected cards are immutable.
8. Self-review with fresh eyes: spec coverage (every requirement maps to a slice), placeholder scan, interface/type consistency across slices. Fix inline.
9. Gate: report the posture and the first eligible slice, then STOP for approval before implementing.

## IMPLEMENT mode — slices in order, each one green

1. Load the parent and slices; review critically. Concerns → raise them before starting.
2. VENUE check first: release-path workshop cards belong to the coordinator (`$sauce-autoloop`) — hand off and stop; never bypass its claims, gates, or receipts. Execute inline only for docs/vault work or repos without a coordinator.
3. Work in an isolated worktree. Never implement on main without explicit consent.
4. The loop: the next slice is the first In Planning slice whose `depends_on` are ALL completed → mark it in_progress (frontmatter and board) → follow its steps EXACTLY (test-first, run every verification, commit per slice) → mark completed → take the next. One slice at a time. No skipping ahead. Repairs happen inside the slice that broke.
5. A red slice never gets a sibling started. Blockers (failing verification, unclear step, missing dependency) → STOP and ask; never guess, never weaken a test to pass.
6. Done: every slice completed → summarize per-slice commits and test evidence, then hand back for review and merge per the repo's conventions.

## Rules

- The board is the plan: no shadow plan document that can drift from the cards.
- `depends_on` is the execution order; a slice with unmet dependencies is not eligible no matter what the prose says.
- Every slice ends with its tests green and a commit; partial slices are parked, not abandoned.
- Pinned evidence everywhere: source, capture time, locator.
