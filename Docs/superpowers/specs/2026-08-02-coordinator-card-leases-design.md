# Coordinator card leases — design

**Date:** 2026-08-02
**Problem:** Two concurrent `$loop-run --live` Codex chats both resumed the same active card (TV-1c on the ero-egnyte-mcp board) and duplicated hours of review/verification work. Worse than wasted tokens: `gate.js verify-adequacy` temporarily removes source changes from the card worktree to prove tests go red, so two sessions sharing one card worktree can corrupt each other's runs.

**Root cause:** Coordinator state is correctly shared across worktrees (state resolves via `git rev-parse --git-common-dir`, so Codex worktrees and the canonical checkout read one `state.json`), and the existing locks (`state-write`, `selector`, per-card gate under `withLock`/`withCardGateLock`) make each coordinator command atomic — but nothing owns the hours-long span *between* commands. Active cards carry no session ownership, and the run skill's deterministic rule ("at-capacity → resume one, never claim another") routes every concurrent chat to the *same* first-in-queue active card. The existing `turn-lock.js` whole-turn mutex is only wired into the legacy `/sauce-autoloop` fat command, not the loop plugin.

**Decisions (user-confirmed):**
1. Concurrent chats should work **different cards** (per-card leases), not serialize or queue.
2. Stale-lease policy: **generous TTL (~2 h) + manual `break-lease` verb**.
3. Enforcement depth: **lease token required on every pipeline verb**, fail-closed.

---

## 1. Data model

Each active card record in `state.json` gains an optional `lease` object:

```json
{
  "lease": {
    "token": "<32-hex random>",
    "acquired_at": "<ISO>",
    "renewed_at": "<ISO>",
    "holder": { "host": "<os.hostname()>", "label": "<optional free text>" }
  }
}
```

- A lease is **live** iff `now − renewed_at < LEASE_TTL_MS` (default 2 h). Otherwise **stale**.
- Absent `lease` field = unleased. Existing state needs **no migration** — old records are simply unleased. Terminal-phase records never carry a live lease (cleared on completion/park/terminal transitions).
- Future-skewed `renewed_at` (negative age, clock jump) counts as stale, mirroring `turn-lock.js` semantics.
- All lease reads/writes happen inside the existing `withCardGateLock` + state-write lock — already race-safe.
- **Time-based expiry only.** Pid-liveness (which `turn-lock.js` uses) is useless here: every coordinator invocation is a fresh short-lived node process, so the recorded pid is always dead moments later. This is why the TTL is generous rather than aggressive.
- Schema registry: add/extend the coordinator learned-state entry in `platform/schemas-index.json` for the lease shape (kind `learned-state-schema`), same commit that introduces it.

## 2. Verb behavior

### Acquisition — `claim` / `resume`
- Both verbs acquire the lease on success and include `lease_token` (plus `lease: {acquired_at, expires_in_ms}`) in their JSON receipt.
- `resume` on a card with a **live** lease held by someone else → refusal, exit non-zero, code `lease_held`, receipt naming holder host/label, lease age, time-to-expiry, and the remedy: other unleased active cards, `claim` eligibility, or `break-lease` guidance.
- `resume --lease <token>` with the **matching** token → renew + normal no-op/idempotent-replay semantics preserved.
- `resume` on a card with a **stale** lease → takeover: mint new token, append audit line `lease_superseded_stale` (with the superseded holder + age).

### Pipeline verbs — token required
`record-review`, `verify-gates`, `record-pr`, `advance`, `deploy`, `park`, `amend-contract`, `consume-ratification` on a leased card require `--lease <token>`:
- Missing token → refusal `lease_required`; wrong token → refusal `lease_mismatch`. Both receipts carry the exact remedy text (resume the card to obtain the token, or break-lease if the holder is known-dead).
- Matching token → verb proceeds and **renews** the lease (`renewed_at = now`). A turn that keeps making progress never expires mid-run; the verb *before* a 40-minute test suite renews it, and 2 h covers the gap.
- Unleased card + pipeline verb → verb proceeds (back-compat for supervised/manual operation) but acquires **no** lease; receipts note `lease: none`.
- Stale lease + pipeline verb with the old token → refusal `lease_stale` (the holder must re-resume to take over cleanly).
- Verbs that end active work release the lease on success: `park` clears it as the card leaves the active set, and `advance` clears it when the card reaches a terminal/completed phase. A parked or completed card is never leased.

### Supervised operator verbs — bypass + clear
`discard`, `reap`, `restructure`, `reconcile`, `reconcile-metadata`, `reconcile-dependencies`, `cutover`, `recover`, `recover-deployed`, `amend-park`, `backfill-ratifications` ignore the lease, and any verb that removes/terminalizes the card clears it, appending audit line `lease_cleared_supervised`. A lease must never wedge supervision.

### New verb — `break-lease`
`break-lease --card "<exact>" --reason "<text>" --json`: clears the lease, appends an audit record (holder it broke, age, reason). Never touches receipts, worktrees, or card phase. Idempotent: breaking an unleased card is a `no_op: true` success.

## 3. Selection — `status` / `status.next`

- `status` reports per active card: `lease: { held, stale, age_ms, expires_in_ms, holder }` (or `null`).
- Resume candidates for `next` are **unleased-or-stale active cards only**.
- All active cards live-leased + below capacity → `next: claim`.
- All active cards live-leased + at capacity → new terminal `next` value **`all-work-leased`**, carrying the leased cards + soonest expiry, so a chat can report and stop cleanly.
- `select-card.js` (pure selector) and `batch-runner.js` consume the same projection; batch-runner never claims (A4), so it needs no token — only projection compatibility.

## 4. Skill + runner surface

- `plugins/loop/skills/run/SKILL.md`: the turn keeps `lease_token` from its claim/resume receipt and passes `--lease` on every pipeline verb. Selection rule becomes: "resume an unleased active card; else claim if under capacity; else report `all-work-leased` and stop." Sub-agent review contexts never need the token — recording stays in the main context.
- `plugins/loop/skills/execute/SKILL.md`: same token threading for its coordinator verbs.
- Legacy `.claude/commands/sauce-autoloop.md`: same threading note (it already parses claim receipts; turn-lock usage there is unchanged — leases are complementary).
- Ships through the normal automated release; every bound repo gets it on `brew upgrade sauce`. No per-repo configuration; no `.loop/config.json` change.

## 5. Testing + error handling

New harness `platform/test/run-autoloop-leases.js`, wired into `release:preflight` alongside the other autoloop harnesses, covering at minimum:
1. `claim` acquires a lease and returns the token in the receipt.
2. `resume` on a live-leased card refuses with `lease_held`; receipt names holder + expiry + remedies.
3. Same-token `resume` renews and stays idempotent.
4. Each pipeline verb refuses with `lease_required` / `lease_mismatch` (and `lease_stale`) as specified.
5. Token-authenticated verb renews `renewed_at`.
6. Stale-lease takeover on `resume` appends `lease_superseded_stale`.
7. `break-lease` clears + audits; unleased break is `no_op`.
8. `status` projection: lease fields, `all-work-leased`, claim-when-under-capacity.
9. Supervised verbs bypass and clear (`lease_cleared_supervised`).
10. Unleased-card pipeline verbs still work tokenless (back-compat).

All refusals use the existing `cli-kit` refusal-receipt style (JSON, exact remedy text, non-zero exit) so a confused chat self-corrects from the receipt alone.

## Out of scope (YAGNI)

Heartbeat daemons; cross-machine coordination (state is local-per-clone by design); epic-level leases; wiring `turn-lock.js` into the plugin (leases supersede it for this problem); changes to board files or board-writer authority (leases live only in `state.json`).
