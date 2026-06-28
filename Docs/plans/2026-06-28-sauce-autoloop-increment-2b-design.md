# Sauce Autoloop — Increment 2b Design: the Scout (self-discovery)

**Date:** 2026-06-28
**Status:** Approved design — proceeding to implementation plan
**Scope:** Increment 2b — the Scout: when the board is drained, discover safe work and queue it so the loop never goes idle. Builds on 2a (v0.137.0).
**Companion:** [2a design](2026-06-27-sauce-autoloop-increment-2a-design.md) · architecture reference (`~/notes/sauce/headspace-sauce/spice/projects/sauce/docs/workflow-loops/initial-brainstorm/Implementation Setup - Architecture.md`).

## Problem
After 2a, the loop picks work from the board — but when the board's "In Planning" is empty (or all-broad/all-checked), `selectCard` returns `no-work`/`no-eligible-work` and the loop just exits. To "get better over time" hands-off, it needs a **Scout** that self-discovers improvements and queues them.

## Decisions (from brainstorm)
- **Sources:** test/harness coverage gaps · doc drift/stale references · bug-hunting + landmine hardening.
- **Output caution:** **safe categories only** — docs, tests/harnesses, mechanical guards. NEVER a feature or behavioral fix.
- **Reconciliation of "bug-hunting" × "safe-only":** a found bug → a proposed **regression harness** (a test pinning it), a landmine → a **guard test/lint**. The loop builds the test suite *around* weak spots; the actual fix waits for the verifier (Inc 3).
- **Dedup grounded in git** (same principle as 2a): "done" = a matching `autoloop/<id>` shipped (derived from git history), not a stored flag. The board/queue are projections; git is authoritative.

## Architecture (deterministic spine + one bounded model pass)

### 1. `scout-signals.js` (NEW — deterministic gatherer; pure core + CLI; harness-tested)
Cheap, runs every drain. Emits candidate items grounded in real signals:
- **Coverage gaps** — parse `scripts/render-coverage-audit.js` output → item `{category:'test', title:'Add harness for <path>'}`.
- **Doc drift** — scan `Docs/**/*.md` for broken wikilinks / refs to files that no longer exist → `{category:'doc', title:'Fix stale ref in <doc>'}`.
- **Landmine-guard gaps** — parse `Docs/landmines.md` entries; for each, check whether a guard harness exists (heuristic: a `platform/test/run-*.js` referencing the landmine id/keyword); if none → `{category:'test', title:'Add guard harness for landmine #N'}`.
- Pure functions take *injected* inputs (audit output string, file lists, landmines text); the CLI does the I/O. Same DI pattern as `select-card`/`reconcile-inflight`.

### 2. Bounded model bug-hunt pass (command-driven; runs ONLY when the deterministic queue is empty)
A capped Scout agent reads recent code and writes **safe** items only (found bug → proposed regression harness). Caps: ≤ N proposals/run, only fires on empty deterministic queue (so it runs rarely). Not unit-tested (model), validated by dry-run.

### 3. `autoloop-queue.md` (NEW — git-tracked, repo root)
Structured + parseable. One item per block:
```
- id: cov-projectnavbuttons-render
  title: Add render harness for ProjectNavButtons cold-load path
  category: test
  source: render-coverage-audit
  rationale: <path> has no behavioral harness
  status: proposed
```
`id` is the dedup key and maps to the work branch `autoloop/<id>`.

### 4. `parseQueue` + selection integration (`select-card.js` extension; pure, harness-tested)
- `parseQueue(md) → [{id, title, category, source, rationale, status}]` (open items = `status: proposed`).
- New `selectFromQueue({queueMd, loadBody?, shippedIds})` → applies the existing scope heuristic + dedup (`shippedIds` derived from git) → returns the top eligible item as `{action:'work', card:<id>, fromQueue:true}` or `no-work`.
- The **command Phase B** flow: board `idle` → `selectCard` on the board → if `work`, proceed. If `no-work`/`no-eligible-work` → consult queue (`selectFromQueue`); if a queue item is eligible → it's the turn's work. If queue empty → run the deterministic gatherer (write items) → re-read → pick; still nothing → run the bounded model bug-hunt (if caps allow) → re-read → pick; still nothing → `no-work`, exit.

### 5. Dedup (`shippedIds`, derived from git — pure consumer)
A helper gathers shipped/the-in-flight autoloop ids from git (`git log --grep 'autoloop/'` + branch/PR slugs via the existing reconcile data) and the current queue; the Scout skips proposing any id already shipped or queued. The pure dedup/filter is testable with injected `shippedIds`.

## Data flow (one drained turn)
```
board idle ─► selectCard(board) ─► work? ─► yes: proceed
                                  └─ no-work/no-eligible ─► selectFromQueue(queue, shippedIds)
                                        ├─ eligible item ─► work (card = id, fromQueue)
                                        └─ empty ─► scout-signals (deterministic) writes items ─► re-read ─► pick
                                                      └─ still empty ─► bounded model bug-hunt (capped) ─► re-read ─► pick
                                                            └─ nothing ─► no-work, exit
```

## Error handling
- Gatherer sub-signal failure (e.g., `render-coverage-audit` errors) → skip that signal, continue with the others (best-effort; never crash the turn).
- Malformed `autoloop-queue.md` → `parseQueue` returns only well-formed blocks; the command logs the count skipped.
- Model bug-hunt cap exceeded or disabled → skip it; `no-work` is a valid, cheap outcome.

## Testing
- Extend `platform/test/run-autoloop-select.js` (or a sibling `run-autoloop-scout.js`): `parseQueue` (well-formed/malformed), `selectFromQueue` (eligible/deduped/scope-skip/empty), each `scout-signals` pure detector (coverage/doc-drift/landmine-guard) against fixtures, and dedup with injected `shippedIds`. Wired into `release:preflight`.

## Out of scope (later)
- **Gate B verifier (Inc 3)** — unlocks the Scout proposing *fixes*, not just tests.
- Canary deploy (Inc 4), substrate hardening (Inc 5), meta-learning (Inc 6).
- Any non-safe category (features/behavioral fixes) — never proposed by 2b.
