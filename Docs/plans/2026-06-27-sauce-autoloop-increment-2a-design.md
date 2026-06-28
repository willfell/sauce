# Sauce Autoloop — Increment 2a Design: in-flight state via reconciliation

**Date:** 2026-06-27
**Status:** Approved design — proceeding to implementation plan
**Scope:** Increment 2a only — fix the selection semantics so the loop can pick work. The **Scout** (self-discovery) is the *next* increment (2b), explicitly out of scope here.
**Companion:** [Increment 1 plan](2026-06-27-sauce-autoloop-increment-1-plan.md) · architecture reference (`~/notes/sauce/headspace-sauce/spice/projects/sauce/docs/workflow-loops/initial-brainstorm/Implementation Setup - Architecture.md`).

## Problem

Increment 1's `selectCard` blocks on a non-empty board "In Progress" column (`needs-attention`), borrowed from the human `/sauce-pipeline`. But the real `sauce-board.md` keeps **6 workstreams parked permanently in "In Progress"** (Projects Blueprint, Meetings Blueprint, …). So the loop returns `needs-attention` every fire and **never picks work** — in dry-run *and* live. The loop also accepts `[x]`-checked Planning cards as pickable.

## Decision (and why)

Researched against three crash-recovery domains that converge on one answer:
- **Kubernetes reconciliation** — level-triggered, not edge-triggered; after a crash, *read current state and reconcile*, never trust a stored "I think I'm in state X."
- **Durable-execution / agent recovery** — persist at logical steps; idempotency is a prerequisite for safe replay.
- **The dual-write problem** — you cannot keep two separate systems atomically consistent; pick **one source of truth and derive the rest** (event-sourcing: the log is truth, the DB is a projection).

**Therefore:** the loop's in-flight state is **derived from git + GitHub PR state, reconciled fresh every turn** (the system of record where the work actually lives and which cannot desync from reality). The **board is a human-visible projection** — the loop writes its status there for the operator, but never reads it back for correctness. A frontmatter marker is a *mirror*, never the authority. The branch name `autoloop/<card-slug>` is the **idempotency key**.

This beats "frontmatter-marker-as-source-of-truth" on all three operator criteria: **least collision** (one source, no dual-write desync), **fastest recovery** (two cheap queries reconstruct exact state — no journal/checkpoint to parse), **least error-prone long-term** (idempotent, level-triggered, no flag that can lie).

## Components

### 1. `reconcile-inflight.js` (NEW, pure, unit-tested)
`reconcileInFlight({branches, prs, lastHandoffCard}) → {status, card, nextAction}` where:
- **Inputs (injected — pure):** `branches` = array of local/remote branch names matching `autoloop/*`; `prs` = array of `{headRefName, state, number}` for `autoloop/*` PRs; `lastHandoffCard` = card name from the latest handoff (optional hint).
- **Status derivation (level-triggered):**
  - no `autoloop/*` branch AND no open `autoloop/*` PR → `{status:'idle', nextAction:'pick'}`
  - `autoloop/*` branch exists, no PR for it → `{status:'implementing', card:<slug>, nextAction:'resume-or-clean'}`
  - open `autoloop/*` PR → `{status:'pr-open', card:<slug>, number, nextAction:'wait'}`
  - most-recent `autoloop/*` PR merged → `{status:'merged', card:<slug>, nextAction:'close-card'}`
  - most-recent `autoloop/*` PR closed-unmerged → `{status:'failed', card:<slug>, nextAction:'block-card'}`
- Card slug is parsed from the branch/PR head ref (`autoloop/<slug>` → `<slug>`).

### 2. `selectCard` (MODIFIED, `scripts/autoloop/select-card.js`)
- **Remove** the "In Progress non-empty → needs-attention" rule entirely. In-flight detection now lives upstream in `reconcileInFlight`; the board's "In Progress" (your parked workstreams) is **never consulted** for the block decision and was never a Planning candidate anyway.
- Keep the existing `halt` / `no-work` / `no-eligible-work` / recommendation-first `work` behavior.
- Planning loop additionally **skips `[x]`/`[X]`-checked cards** (a checked Planning card is treated as done, not pickable).
- selectCard stays pure and needs **no new "busy" input** — the command only invokes it once `reconcileInFlight` reports `idle` (see Phase A). This keeps the division clean: `reconcileInFlight` owns "am I busy?", `selectCard` owns "what do I pick?".

### 3. Command Phase A (MODIFIED, `.claude/commands/sauce-autoloop.md`)
- Gather observed state: `git branch --list 'autoloop/*'` + `git branch -r --list 'origin/autoloop/*'`; `gh pr list --head 'autoloop/*' --state all --json headRefName,state,number`.
- Call `reconcileInFlight`; on `nextAction` ∈ {resume-or-clean, wait, close-card, block-card} handle the in-flight card (live mode), else `pick`.
- Pass `autoloopBusy = (status !== 'idle')` into selection.
- **Dry-run note:** dry-run never creates branches/PRs, so `reconcileInFlight` is always `idle` in dry-run → the loop always proceeds to pick + propose. This alone fixes the idle bug for the assessment window.

### 4. Board as projection (MODIFIED, command Phase C/D — live only)
- The loop still moves its card to In Progress and may stamp `autoloop_owned: true` **for operator visibility**. Correctness never depends on reading it back. If the marker disagrees with git/PR, git/PR wins and the next reconcile re-projects.

## Data flow (one live turn, including crash recovery)

```
Phase A: observe git branches + gh PRs ──► reconcileInFlight ──► status
  idle        ─► selectCard ─► pick from Planning (skip [x]) ─► implement on autoloop/<slug> ─► PR
  implementing─► resume the half-done branch OR discard it cleanly (branch = idempotency key)
  pr-open     ─► wait (write handoff, exit)
  merged      ─► close the card (projection) ─► then pick next
  failed      ─► mark card Blocked (projection) ─► then pick next
```

A crash anywhere leaves a *self-describing* artifact (a branch with/without a PR), which the next turn reads and reconciles — no lost state, no duplicate PRs.

## Error handling
- `gh`/`git` query failure in Phase A → treat as **unknown, fail-safe to `reconcile`/exit** (do NOT assume idle and start a second branch). Log + exit; next turn retries.
- Multiple `autoloop/*` branches (shouldn't happen — one card per turn) → `reconcileInFlight` picks the most recent and flags the rest for cleanup; the command surfaces it rather than guessing.

## Testing
- **Extend** `platform/test/run-autoloop-select.js` (one harness for all autoloop pure logic) covering: each `reconcileInFlight` status branch (idle / implementing / pr-open / merged / failed) + slug parsing + fail-safe on ambiguous input; `selectCard` skips `[x]`-checked Planning cards; a non-empty parked "In Progress" no longer blocks a Planning pick. Already wired into `release:preflight`.
- The old `SC-2` (in-progress → needs-attention) assertion is **replaced** by one asserting parked In Progress does NOT block; all other existing assertions stay green.

## Out of scope (later increments)
- **Scout / self-discovery (2b):** generating work into `autoloop-queue.md` when Planning is empty.
- **Gate B verifier (3), canary deploy (4), substrate hardening (5).**
- Full end-to-end *live* validation (no real `--live` PR is opened by this increment; we ship the logic + harness; live exercise comes when you flip the assessment window).
