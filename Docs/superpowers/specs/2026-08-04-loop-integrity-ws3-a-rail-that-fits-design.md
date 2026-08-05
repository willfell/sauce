# Loop integrity — workstream 3 — a rail that fits

**Date:** 2026-08-04 · **Status:** design approved · **Program:** workstream 3 of 4
(disease C) · **Predecessor:** [`2026-08-04-loop-integrity-program.md`](2026-08-04-loop-integrity-program.md)

Workstream 3 treats disease C: *no legitimate escape hatch, so work leaves the
rail*. The program doc's sketch was explicit that this workstream changes
completion semantics and needed its own brainstorm. This is it.

---

## 1. What the sweep actually found

The program doc ordered workstream 1 first precisely so that 3 could be sized
from data. `board-health --json` was run against all three loop-bound repos.

| board | epics | slices | records | untracked members |
| --- | ---: | ---: | ---: | ---: |
| `sauce` (headspace) | 20 | 183 | 124 | 75 |
| `ero-egnyte-mcp` (ero) | 35 | 124 | 54 | 88 |
| `planner-agent-integration` (ero) | 3 | 15 | 14 | 1 |

164 aggregate, and — as the workstream 2 result doc warned — unusable as a rate.
Each finding was classified by **who wrote its `status_changed_at`**, since the
coordinator emits `…THH:MM:SS.mmmZ` and nothing else does:

| class | n | meaning |
| --- | ---: | --- |
| coordinator-stamped, before this clone's ledger epoch | 64 | cross-clone residue from the 2026-07-31 machine migration. Legitimate. |
| coordinator-stamped, after the epoch | 0 | no anomalies |
| foreign-stamped (bare date or other shape) | 99 | written by something that is not the coordinator |
| no stamp at all | 1 | `EM-5` |

Of the 100 foreign: 85 are the pre-retirement `ero_loop` era on egnyte, 11 are
sauce's pre-shared-rail era (latest 2026-07-26), 1 is an `in_progress` note (not
a completion), and 3 are `EM-4/5/6` — stamped `2026-07-31`, merged as PR #126 on
2026-08-03.

**Frequency verdict.** Under the current shared rail (2026-08-01 onward),
out-of-band completion has occurred once, covering three slices, in four days.
That sample cannot size a verb. Frequency alone does not justify the escape
hatch, and it emphatically does not justify batch-claim.

### 1.1 The finding that does justify the work

`platform/mechanisms/kanban-status-sync/kanban-status-sync.js:120` —
`KanbanStatusSyncInit` runs at **vault boot in all three consumer vaults**,
discovers every note carrying `kanban-plugin: board`, and rewrites `status`,
`status_prev`, and `status_changed_at` (bare date) through
`processFrontMatter` whenever a card's column changed. The delivery epic boards
do carry `kanban-plugin: board`.

So dragging a slice card into *Completed* in Obsidian is a completion the ledger
never sees, produced by shipped, sanctioned platform code, on a path the
coordinator's repo-local `.git/sauce-autoloop/locks` cannot observe. The bare-date
signature on all 100 foreign stamps is this mechanism's signature.

This is not the rare batch-PR event the program doc predicted. It is an
always-on, one-gesture leak in every vault. **Director's decision: legitimize
it.** The gesture is one the Director uses deliberately; the correct response is
to give it provenance, not to forbid it.

### 1.2 The instrument cannot yet do its job

`board-health` emits one undifferentiated
`remedy: "investigate: work completed outside the rail"` for all 164 findings.
The classification table above required a throwaway script. The instrument that
workstream 3 was to be sized by cannot do the sizing; fixing that is in scope.

---

## 2. Scope

| # | Item | Disposition |
| --- | --- | --- |
| 1 | Sanctioned out-of-band completion carrying provenance | **In** — the `adopt` verb (§4) |
| 1b | Provenance classification in `board-health` | **In** — new; makes candidates findable (§5) |
| 2 | Cross-process write guard for non-coordinator writers | **In** — detect-at-write, not locking (§6) |
| 3 | Batch-claim / variable slice granularity | **Deferred** — one incident in four days; building it now is prediction, not measurement |

Explicitly out of scope: healing the existing 164 findings (`adopt` is the tool;
running it 100 times is an operational call, and pre-shared-rail residue may be
better left as history); the `effectiveProjectionMapping` /
`projectedRecordMapping` demotion divergence surfaced by workstream 2 (still
surfaced, still untouched); the sticky-notes harness flake (`PERF-7-HARNESS`).

---

## 3. Authority model — the `adopted` tier

Workstream 2 established one rule in one implementation
(`delivery.topology.resolveSliceAuthority`): a slice is *proven done* only via
successful deployment receipts, and a board `completed` is a declaration that
can never prove itself. An adopted completion has no deployment receipts, so it
needs a third named source rather than a weakening of the second.

```js
resolveSliceAuthority({ hasRecord, ledgerStatus, boardStatus, doneProven, boardIsSlice, adopted })
```

- `hasRecord && adopted === true && ledgerStatus === 'completed'`
  → `{ status: 'completed', doneProven: false, source: 'adopted', demoted: false }`
- every other case: today's rules, byte-for-byte unchanged.

`doneProven` keeps meaning exactly "carries successful deployment receipts". An
adopted slice is `doneProven: false` permanently. Only the projectability
backstop widens:

```js
function assertProjectableStatus(verdict) {
  if (verdict && verdict.status === 'completed'
      && verdict.doneProven !== true && verdict.source !== 'adopted') {
    throw new Error('projectable status invariant: completed without proven deployment');
  }
}
```

The invariant that matters survives: **the board still cannot mark itself done.**
Only the coordinator can, and only by recording verified external evidence. The
epic rolls up; the ledger record, every receipt, the retroactive digest, and
`board-health` all keep saying `adopted`, permanently and unerasably — the
distinction between gate-verified and human-asserted completion is never lost,
because the ledger is the only record that exists.

---

## 4. The `adopt` verb

```
codex-coordinator.js adopt --card <exact name> --pr <n> --merge-sha <40-hex> --reason <why> --json
```

A mutating coordinator verb: `--json` required and refused before any read or
write, runs under the selector lock, shared `cli-kit` receipt grammar, unknown
option names rejected before workshop or state access.

### 4.1 Preconditions — all fail closed before any write

1. **The card is an untracked board member** — its note exists and the ledger
   holds no record for it. A card that already has a record refuses
   (`adopt_record_exists`); use the normal rail, `park`, or `reconcile`. This is
   what prevents `adopt` from becoming a general-purpose "mark it done" backdoor:
   it can only ratify a declaration already sitting on the board unrecorded.
2. **The note declares `completed`** — otherwise `adopt_not_declared_complete`.
   Adoption ratifies a declaration; it never invents one.
3. **`--merge-sha`** is 40-hex, exists (`git cat-file -e`), and is an ancestor of
   the default branch (`git merge-base --is-ancestor`) — else
   `adopt_sha_unreachable`.
4. **`--pr`** resolves via `gh pr view --json state,mergeCommit` to `MERGED` with
   `mergeCommit.oid === --merge-sha` — else `adopt_pr_not_merged` /
   `adopt_pr_mismatch`.
5. **`--reason`** is non-empty — else `adopt_reason_required`.

When `gh` is absent or unauthenticated the verb degrades to git-only
verification and records `provenance_verified: "git"` rather than `"git+gh"`.
The degrade is visible in the receipt and in the ledger record — never silent.

### 4.2 Write

One ledger record for the card: `phase: 'completed'`, plus
`adoption: { pr, merge_sha, reason, verified, adopted_at }` and the contract
fields derivable from the note (`card_path`, `epic`, `slice`, `touch_zones`,
`deploy_subscriptions`). Then the standard epic projection refresh, so the epic
can finally roll up.

Literal replay of an identical successful adopt returns `no_op: true`. Different
operands against an already-adopted card refuse (`adopt_conflict`).

### 4.3 The motivating case

```
adopt --card "EM-4 Retire ero_loop execution path for loop-run and coordinator advance" \
      --pr 126 --merge-sha 9922ec4373e4a925829c7917912263e2c27a29e4 \
      --reason "batch PR; per-slice was genuinely wrong for this change" --json
```

run three times, once per slice. `EM-4/5/6` stop being permanent unreportable
drift and become a recorded, evidence-backed, visibly-adopted completion.

---

## 5. `board-health` provenance classification

`untrackedMemberFinding` gains `stamp` and `provenance`, derived from the note's
`status_changed_at`, and its `remedy` becomes class-specific:

| stamp shape | `provenance` | meaning | `remedy` |
| --- | --- | --- | --- |
| `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` | `coordinator` | a coordinator wrote it and this clone has no record → the record lives in **another clone's ledger** | `cross-clone: no action in this clone` |
| any other shape, or absent | `foreign` | written outside the rail (`KanbanStatusSync`, a retired loop, a hand edit) | `adopt` |

The inference is sound because a coordinator run on *this* clone always leaves a
record; coordinator-format stamp with no record can only mean another clone
wrote it. The classifier is pinned by test against both observed real shapes —
the ISO-ms form (`GA-P1k`) and the bare-date form `KanbanStatusSync` writes.

The receipt gains `untracked_members_by_provenance: { coordinator: n, foreign: n }`
so the aggregate collapses to a readable pair. `healthy` is unchanged: this is
classification, not a sixth check. The `Board Health.md` payload carries the new
fields under the same write discipline (zero bytes written when unchanged).

---

## 6. Cross-process write guard

Locking was rejected on the merits. A vault-resident advisory lock cannot work
here: `KanbanStatusSync` runs inside Obsidian at boot and Obsidian Sync writes
from another machine — neither will ever consult it, and a stale lock silently
disables the kanban sync. Locking cannot constrain writers that do not
cooperate, which is exactly why this leak exists. The guard therefore
**detects** rather than excludes.

### 6.1 Card projection — report, never block

`projectCard` (`scripts/autoloop/codex-coordinator.js:2621`) is the single
card-note write chokepoint: it reads `cardRaw` and writes `cardNext` at `:2708`.
It stores `sha256(cardNext)` on the ledger record as `card_note_sha`.

On the next projection for a record carrying `card_note_sha`, if
`sha256(cardRaw)` differs, a foreign writer touched the note in between. The
coordinator records
`foreign_write: { detected_at, expected_sha, actual_sha }`, surfaces it in the
projection receipt and in `board-health`, and **projects anyway**.

Blocking here would be wrong: adoption does not apply to a tracked card, and a
cosmetic Obsidian edit — a typo fix in a card body, a tag added — would wedge
the autoloop mid-flight. The coordinator remains authoritative for tracked
cards; the finding is the deliverable.

### 6.2 Bulk verbs — fail closed

`heal-epic-bindings --apply`, `restructure`, and `reconcile-metadata --apply`
re-read every target immediately before writing and refuse
(`concurrent_modification`, naming the changed paths) when the bytes differ from
what the plan or spec was computed against.

`restructure` and `reconcile-metadata` already hash preimages for crash
recovery; this extends that machinery to cover a *second writer* rather than
only a crashed self. `heal-epic-bindings` gets it new — and it is the verb whose
documented warning in `Docs/agent-guides/delivery-board.md` § Coordinator
operations ("never run `--apply` against a board with a live loop session or an
active cross-machine sync") becomes an enforced precondition instead of a
sentence a human has to remember at the right moment.

---

## 7. Error handling

Every new refusal is a stable `cli-kit` code emitted before any mutation:
`adopt_record_exists`, `adopt_not_declared_complete`, `adopt_sha_unreachable`,
`adopt_pr_not_merged`, `adopt_pr_mismatch`, `adopt_reason_required`,
`adopt_conflict`, `concurrent_modification`. A `gh` outage degrades the
verification tier and is reported; it never fails the verb and never silently
passes as full verification. A `foreign_write` detection is a finding, never an
exception. Existing receipt keys stay additive-only and consumer-compatible.

## 8. Testing

Test-driven, red→green per task, against the existing harnesses.

- `platform/test/run-delivery-topology.js` — the `adopted` tier;
  `assertProjectableStatus` accepting `adopted` while still throwing on an
  unproven `completed`; every existing assertion unchanged.
- `platform/test/run-codex-autoloop.js` — `adopt` happy path; each of the seven
  refusals; replay `no_op`; the `gh`-unavailable degrade; epic roll-up after
  adoption; provenance classification against both real stamp shapes;
  `foreign_write` detected and reported without blocking;
  `concurrent_modification` on all three bulk verbs.
- Fixtures modeled on the real `EM-4/5/6` / PR #126 case rather than invented
  shapes.
- `Docs/agent-guides/delivery-board.md` — `adopt` added to § Coordinator
  operations, the adopted tier to § Board vs ledger authority, and the § 59
  prose warning replaced by the enforced guard.

## 9. Constraints honored

- One workstream, one branch (`ws3-a-rail-that-fits`), one PR.
- `npm run release:check-bump` dogfooded before the PR is opened; the PR title
  decides the bump under squash-merge.
- **No vault writes in this cycle at all** — the live-writer hazard does not
  arise. `board-health --write-note` remains the only vault writer and is not
  invoked by this work.
- No hand-versioning, no hand-tags, no tap edits.
- `platform/test/run-sticky-notes-render-guards.js` remains flaky on `main`
  (~50%); re-run to confirm the flake, do not fold a fix into this cycle.
