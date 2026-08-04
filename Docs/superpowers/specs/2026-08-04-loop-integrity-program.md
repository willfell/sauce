# Loop integrity — program decomposition

**Date:** 2026-08-04 · **Status:** decomposition agreed · **Scope:** ~4 cycles

Origin: the v0.281.1 board-projection cycle surfaced two failures on the
`ero-egnyte-mcp` board and, in diagnosing them, several more. This document
groups them by **cause** rather than symptom, so the work splits into
independent workstreams instead of a to-do list. Each workstream is its own
cycle, its own session, its own PR.

**Read this first when starting any of the workstreams below.** It is the only
place the whole picture is written down.

## The three diseases

### A — One fact, two sources, nothing forcing agreement

| Instance | Evidence |
| --- | --- |
| Canonical path form computed independently by intake and coordinator | the v0.281.1 freeze: `projectPrefix` (intake) vs `physicalProjectPrefix` (coordinator) drifted |
| Ledger duplicated per-clone, no reconciliation | no clone on this machine has ever seen `EM-4/5/6`; "no record" is ambiguous between *never happened* and *happened elsewhere* |
| Board state vs ledger state, no stated authority | `Retire ero_loop`: board says all six slices complete, ledger knows three |
| Release bump computed locally vs by CI | v0.281.1 shipped as a patch; `release:plan` read branch commits, the bumper read the squashed PR title |

The v0.281.1 fix made intake **mirror** the coordinator. Mirroring is still
duplication — it removes today's drift without removing the ability to drift.

### B — The system prefers to continue quietly over stopping loudly

| Instance | Evidence |
| --- | --- |
| Projection throws swallowed into `projection_error` | board sat wrong for days; nothing surfaced it |
| `discard` degraded to a plausible-but-wrong target | fell back to the parent board, removed nothing, unlinked the note anyway → orphans |
| The only push-alarm rides the broken path | Loop Station repaints on transition; transitions were what was failing |
| Every check iterates the ledger | all 15 `Object.values(state.cards)` loops; a board member with no record is **unreachable**, not merely missed |

### C — No legitimate escape hatch, so work leaves the rail

| Instance | Evidence |
| --- | --- |
| Batch completion has no vocabulary | `EM-4/5/6` merged as PR #126 on branch `ero-loop-full-retirement`, 29 files, because per-slice was genuinely wrong for that change |
| Result is permanent, unreportable drift | untracked notes are demoted to `in_progress` forever; the epic can never roll up |
| Writers outside the lock | a live Codex session rewrote the ero board mid-diagnosis; the selector lock does not cover it |

## Workstreams

| # | Workstream | Treats | Size | Spec |
| --- | --- | --- | --- | --- |
| 1 | Board-health sweep — board-driven detection | B | small | [`2026-08-04-board-health-sweep-design.md`](2026-08-04-board-health-sweep-design.md) — **approved** |
| 2 | One source of truth | A | small–medium | not written |
| 3 | A rail that fits | C | medium | not written |
| 4 | Durable ledger | A + C | large, risky | not written |

### Order: 1 → 2 → 3 → 4

**1 first because it is the instrument.** Report-only, already specced, and it is
how we will know whether 2–4 worked. There is currently **no measurement** — the
sole reason any of this was found is that a human noticed a board looked wrong.

**2 before 3** because it is cheap and deletes a bug class outright rather than
managing it.

**3 after 1** because the sweep will report how often work actually leaves the
rail. Designing an escape hatch without that number is guessing: it may be rare
enough not to warrant a verb, or frequent enough to warrant real design.

**4 last, possibly never.** Largest and riskiest; 1–3 may shrink the problem
below the threshold that justifies it. Do not start here despite it being the
most fundamental.

### Workstream 2 — One source of truth (sketch)

- Extract canonical board/atlas/slice path derivation into the delivery
  mechanism; intake and coordinator both consume it. Delete the mirror.
- State the board-vs-ledger authority rule explicitly, and make every consumer
  obey the same one.
- CI gate recomputing the release bump from the **PR title** and failing when it
  differs from the branch's commits (see `build-test-verify.md` § What Claude
  does, added in v0.281.1).

### Workstream 3 — A rail that fits (sketch)

- Sanctioned out-of-band completion carrying provenance (PR number, merge SHA,
  reason) so a batch PR is a legitimate move rather than drift. **Changes
  completion semantics — needs its own brainstorm.**
- Cross-process write guard covering non-coordinator writers (live agent
  sessions, cross-machine sync).
- Batch-claim / variable slice granularity, so work like `EM-4/5/6` never needs
  to leave the rail in the first place. Possibly supersedes the escape hatch
  entirely — decide with the sweep's data.

### Workstream 4 — Durable ledger (sketch)

Replace local-per-clone `.git/sauce-autoloop/state.json` with something
vault-resident or reconstructable from evidence (boards + PRs + merge SHAs).
Removes the ambiguity underlying both the untracked-member class and much of
disease A. Large blast radius; every coordinator verb reads this state.

## Explicitly out of scope for the program

- `platform/test/run-sticky-notes-render-guards.js` flakiness — 3 of 6 runs fail
  on unmodified `main` (`PERF-7-HARNESS: asynchronous fixtures did not finish`).
  Inside `release:preflight`, so it can wedge `prepare-release`. Real, unrelated,
  its own cycle. See auto-memory `sticky-notes-harness-flake`.
- Tombstone residue in headspace `Loop Ops` (`GA-OPS18c`, `GA-OPS18g`) — the
  existing `reap` verb heals it.

## Standing constraints

Learned the hard way during v0.281.1; they apply to every workstream here.

- **Keep each cycle isolated.** One workstream, one branch, one PR. The
  v0.281.1 change stayed clean precisely because the sticky-notes flake was
  refused rather than folded in.
- **The PR title decides the release bump.** Squash-merge collapses the branch
  into one commit whose subject is the PR title; `release:plan` reports the
  pre-squash answer and cannot warn you.
- **Consumer vaults have live writers.** Check write activity and file overlap
  before any vault mutation, and snapshot first. The selector lock does not
  cover Codex sessions or Obsidian Sync.
- **Never hand-version, hand-tag, or edit the tap.** The pipeline owns all of it.
