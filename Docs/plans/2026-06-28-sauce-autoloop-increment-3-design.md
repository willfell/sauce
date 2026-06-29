# Sauce Autoloop — Increment 3 Design: Gate B (adversarial verifier) + bug-fix unlock

**Date:** 2026-06-28
**Status:** Approved design — proceeding to implementation plan
**Scope:** Increment 3 — Gate B, the two-layer verifier that runs in live Phase C before a PR opens, plus unlocking **bug-fixes** as a shippable category. Builds on 2b (v0.139.0).
**Companion:** [2b design](2026-06-28-sauce-autoloop-increment-2b-design.md) · architecture reference (`~/notes/.../Implementation Setup - Architecture.md`).

> **Implementation note (post-build):** both layers were unified into a single `scripts/autoloop/gate.js` (not a separate `verify-adequacy.js`). Below, references to `verify-adequacy.js` / `verify-adequacy` mean the `gate.js verify-adequacy` subcommand.

## Problem
Through 2b the loop ships **safe categories only** (docs/tests) because nothing independently verifies a behavioral change. Gate A (`release:preflight` + dogfood) proves the suite is green, but a *plausible-but-wrong* fix can pass a green-but-shallow test. To let the loop safely ship **bug-fixes**, we need a separate verifier that (a) proves the regression test actually exercises the fix, and (b) adversarially refutes the change.

## Decisions (from brainstorm)
- **Verifier rigor:** perspective-diverse **3-lens panel** (correctness / regression / test-adequacy); block if ≥2 refute.
- **Envelope unlock:** **safe + bug-fixes** (each ships a regression test that goes red without the fix + survives the panel). **Features stay deferred.**
- **Deterministic spine first:** the highest-value check is mutation-style — *revert the source, the new test must go red* — no model judgment, can't be fooled.

## Architecture (two layers, deterministic spine + model panel)

### Layer 1 — `verify-adequacy.js` (NEW; deterministic mutation check; CLI + pure decision)
Proves the change's regression test covers it.
- Compute the diff vs `main`; split into **test files** (`platform/test/run-*.js`) and **source files** (everything else, excluding docs/plan `.md`).
- If the change has NO test file → adequacy `fail` (behavioral change with no test).
- `git stash push -- <source files>` (keep the test), run each new/changed test file → **must exit non-zero (RED)**; `git stash pop`; run again → **must exit zero (GREEN)**.
- Pure `adequacyVerdict({hasTest, redWithoutSource, greenWithSource})` → `{adequate: bool, reason}`. The stash/run/restore orchestration is the CLI (impure); the decision is pure + harness-tested. Always restores the stash (even on error — fail-safe).

### Layer 2 — the 3-lens panel (model; only if Layer 1 adequate)
Three separate-context verifiers dispatched on the diff (via `Workflow`), each a distinct lens, each prompted to **refute** (default refuted-if-uncertain), returning `{refuted: bool, reason}`:
- **correctness** — does the change do what the card/title claims, without logic errors?
- **regression** — could this break existing behavior / other consumers?
- **test-adequacy (judgment)** — beyond Layer 1's mechanical red/green, does the test assert the *right* thing (not a trivial tautology)?

### Gate decision — `gateVerdict` (NEW; pure, harness-tested)
`gateVerdict({adequacy, votes}) → {gate: 'pass'|'block', reason}`:
- `block` if `adequacy.adequate === false` (Layer 1 failed) — never reaches the panel cost in that case (the command runs Layer 1 first).
- else `block` if `votes.filter(v => v.refuted).length >= 2`.
- else `pass`.

### Command Phase C integration (live only)
After Gate A green:
1. Run Layer 1: `node scripts/autoloop/verify-adequacy.js --json`. If `adequate: false` → **block** (discard branch, card → Blocked with the reason, handoff, exit).
2. Run Layer 2: dispatch the 3-lens panel (`Workflow`) on `git diff main...HEAD`; collect 3 `{refuted, reason}` verdicts.
3. `gateVerdict` → `block` (≥2 refute) → discard branch, card → Blocked, handoff, exit. `pass` → open the CI-gated auto-merge PR. Record the gate result (adequacy + votes summary) in the handoff.

### The unlock (bug-fixes)
Phase C's "Hard rule: any behavioral change MUST ship a harness" is now **enforced by Gate B Layer 1** (no adequate test → blocked). The loop may now pick + implement **bug-fix** cards (behavioral changes), not just docs/tests. **Features remain out** (too large to verify safely autonomously).

## Data flow (live Phase C, behavioral change)
```
implement on autoloop/<id> (fix + regression test)
 → Gate A: release:preflight + dogfood  (green?)
 → Gate B L1 (verify-adequacy): stash source → new test RED? → restore → GREEN?   (adequate?)
 → Gate B L2 (panel): 3 lenses refute the diff → votes
 → gateVerdict(adequacy, votes): pass → PR ; block → discard branch, card→Blocked, handoff
```

## Error handling
- `verify-adequacy` MUST restore the stash on any error/exception (fail-safe; never leave the tree mutated). On orchestration failure → `adequate: false` (fail closed; don't ship unverified).
- A panel verifier that errors/returns null → counts as **refuted** (fail closed — an unrun lens is not a pass).
- Dry-run never runs Gate B (no branch/change).

## Testing
- Extend `platform/test/run-autoloop-select.js` (or a sibling): `gateVerdict` (adequate+0/1/2/3 refutes; inadequate→block regardless of votes; null-verdict→refuted) and `adequacyVerdict` (hasTest false→inadequate; red-without/green-with→adequate; not-red→inadequate). Plus a `verify-adequacy.js --self-test` that exercises the stash/run/restore on a tiny synthetic fixture and asserts restore. Wired into `release:preflight`.

## Out of scope (later)
- **2c** — the bounded model bug-hunt (Scout source) — independent; can come before or after.
- **Features** as a shippable category (never auto, or a much-later increment).
- **Canary deploy (4), substrate hardening (5), meta-learning (6).**
