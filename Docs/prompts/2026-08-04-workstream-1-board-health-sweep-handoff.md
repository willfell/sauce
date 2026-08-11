# Next-session prompt — loop-integrity workstream 1

Copy the block below into a fresh Claude Code session in
`/Users/willfell/Documents/GitHub/sauce`.

---

Implement **workstream 1 of the loop-integrity program**: the board-health sweep.

START BY READING (both are on `main`; if PR #759 hasn't merged yet they're on
branch `design/board-health-sweep`):

- `Docs/superpowers/specs/2026-08-04-loop-integrity-program.md` — the program
  decomposition: three root diseases, four workstreams, why the sweep is first.
- `Docs/superpowers/specs/2026-08-04-board-health-sweep-design.md` — **the
  approved spec for this workstream.** Design is settled; do not re-brainstorm
  it. If you think something in it is wrong, say so before writing code.
- `Docs/agent-guides/build-test-verify.md` — release workflow. Versioning,
  tagging, and the tap are AUTOMATIC. Never hand-version, never hand-tag, never
  add a `Co-authored-by: Claude` trailer.
- `Docs/agent-guides/delivery-board.md` — coordinator verbs and the projection
  contract, including `heal-epic-bindings` (shipped v0.281.1).

Follow `superpowers:writing-plans` to produce the implementation plan, then
`superpowers:test-driven-development` — failing test first, watched red → green,
for every one of the ten `BH-*` cases in the spec.

## What you are building

A `board-health` coordinator verb whose checks start from the **board, not the
ledger**. That inversion is the entire point: all 15 existing
`Object.values(state.cards)` checks in `codex-coordinator.js` iterate the ledger,
so a board member with no ledger record is *unreachable* by every one of them.
That blind spot is why three completed slices (`EM-4/5/6`) sat unreported and why
a board froze for days without an alarm.

Five checks, three of which need no ledger at all. Report-only — it never
auto-heals. Writes one `Board Health.md` per project using Loop Station's write
discipline. The spec has the full receipt shape, the five checks, the write
rules, the failure handling, and the ten test cases.

`BH-UNTRACKED` and `BH-LEDGERLESS` are the load-bearing tests — they encode the
actual blind spot, so a future refactor that reintroduces ledger-first iteration
fails immediately. Use the real `EM-4/5/6` shape as the `BH-UNTRACKED` fixture.

## Reuse, don't reimplement

`canonicalEpicProjection`, `planEpicBindingHeal`, and `projectionBoardDrift` all
exist in `scripts/autoloop/codex-coordinator.js` and cover four of the five
checks. Only check 1 (untracked board members) is new logic — a set difference
between board members and `state.cards`. Loop Station
(`projectLoopStation` / `sauce.loop-station.v1`) is the precedent for the vault
note; `platform/mechanisms/cowork-reconciler/launchd-installer.js` for
scheduling.

## Verify and ship (same close-out as v0.281.1)

- `npm run release:preflight` AND `npm run release:preflight-bumped` (clean
  tree) — both GREEN.
- Cycle docs under `Docs/plans/` (design → plan → result). Preview the version
  with `npm run release:plan`, but see the PR-title warning below.
- Conventional commits; push; PR against `main`; merge after CI.
- After release: `brew upgrade sauce`, then verify the INSTALLED verb reports
  correctly against the live `ero-egnyte-mcp` board — it should surface
  `EM-4/5/6` as untracked members. Then
  `node scripts/autoloop/deploy.js run`.
- Keep this cycle ISOLATED to its own branch/PR.

## Traps that already bit (v0.281.1)

1. **The PR title decides the release bump.** Squash-merge collapses the branch
   into one commit whose subject is the PR title — that is the only conventional
   commit the bumper sees. A branch with `feat(...)` behind a PR titled
   `fix(...)` releases as a patch. `npm run release:plan` reads the branch's
   commits and reports the *pre-squash* answer, so it will not warn you. This
   workstream adds a verb → the PR title must be `feat(...)`.
2. **Consumer vaults have live writers.** A Codex session rewrote the
   `ero-egnyte-mcp` board mid-diagnosis. Before any vault write: check recent
   mtimes, check file overlap with what you intend to touch, and snapshot first.
   The selector lock does NOT cover non-coordinator writers. This is exactly why
   the sweep's zero-writes-when-unchanged rule is load-bearing, not an
   optimization.
3. **`platform/test/run-sticky-notes-render-guards.js` is flaky on `main`** — 3
   of 6 runs fail with `PERF-7-HARNESS: asynchronous fixtures did not finish`. It
   is inside `release:preflight` and can wedge `prepare-release`. NOT yours; do
   not fold a fix into this cycle. If preflight goes red there, re-run and
   confirm it is the flake before investigating.
4. **Do not run two copies of `run-codex-autoloop.js` at once.** It creates git
   worktrees in the real repo; concurrent runs corrupt each other's fixtures.

## State at handoff

- Workshop `v0.281.1` shipped, tagged, published, deployed to all 3 vaults.
- `heal-epic-bindings` shipped and already run: 29 notes healed across
  `ero-sauce` and `headspace-sauce`; every affected epic projects N/N.
  `accuris-sauce` was clean.
- Known-open, deliberately not fixed: the sticky-notes flake (above), and
  tombstone residue in headspace `Loop Ops` (`GA-OPS18c` / `GA-OPS18g` — the
  existing `reap` verb heals it).
