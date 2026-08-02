# loop:block-review + dependency-hygiene rails — design

**Date:** 2026-08-02
**Status:** approved (brainstorming), pending spec review
**Worktree:** `loop-block-review-dep-hygiene`

## Problem

The delivery board carries **silent dangling-dependency debt**: slice cards whose
`depends_on` names a card that does not exist on the board. An initial sweep of the
sauce board found **48 dangling deps across 10 epics**. Whole epics
(Row Actions and Entity Management, Vault Doctor) hang off foundation cards that were
never minted, so they can never become claimable — yet the coordinator reports them as
merely `blocked_by_dependencies`, indistinguishable from "queued behind the frontier."

Danglers are born two ways:

1. **Supersession rename (the dominant vector)** — a card `X` is superseded through the
   intake rail; at mint time the predecessor is **discarded** (board line + note deleted,
   tombstone only) via `node <coordinator> discard --superseded-by <successor>` from the
   intake receipt's `post_apply_instructions`. **Nothing in that path scans other cards
   whose `depends_on` names the predecessor**, so those pointers survive as references to
   a card that no longer exists. (e.g. `GA-R1a → GA-R1a2`, all `CSS-* → CSS-1` now
   `CSS-1b`.)
2. **Never-minted foundation** — intake mints a slice whose `depends_on` references a
   foundation card (`GA-M1`, `GA-I1`, `GA-C1/C3`, …) that was never created.

**Supersession chains are multi-hop.** The tombstone for `BL-4` says "superseded by
`BL-4b`", but `BL-4b` was itself discarded for `BL-4c`. Any repair must **follow the
chain to the live tail**, not just one hop.

### Two failure surfaces (both are honest reports of the same data rot)

1. **Coordinator eligibility.** `claim --dry-run` skips the dependent with
   `depends on discarded card X (superseded by Y)` (`discardedDependencyProblem`,
   coordinator ~1383). Worst case it **deadlocks a whole dependency chain** — e.g. `BL-5`
   depended on discarded `BL-4`, transitively blocking `BL-6` and the entire four-slice
   GraphView Visual Polish epic behind it.
2. **GraphView rendering.** At epic scope the pointers surface as `dangling_dependency`
   warnings ("depends on a card that doesn't exist"), which read as rendering bugs but
   are honest reports of the rot.

The coordinator's status meters (`frozen`/`waiting`/`parked`) and the frontier-first
`next` walk **do not traverse `depends_on` to check target existence**, so this debt is
invisible to `/loop:status` and `/loop:review`. The GraphView Blocking Lens
(`GraphInsights`, GV-R1) *does* traverse it and is the honest signal.

### Known occurrences (found + manually repaired 2026-08-02)

Four dead pointers across three cards, all fixed by hand by rewriting `depends_on` to the
live successor titles — proof the rot is real, and that manual repair does not scale:

| Dependent | Dead pointer | Live tail | Note |
| --- | --- | --- | --- |
| `BL-5` Stuck and dim-done filter toolbar | `BL-4` | `BL-4c` (deployed) | deadlocked GraphView Visual Polish |
| `PERF-9` Structural-refresh regression lint | `GA-P4b` | `GA-P4f` (parked tail) | 4-hop chain |
| `PERF-9` (same card) | `PERF-1` | `PERF-1h` | |
| `TD-2a` Revert daily dashboard sort | `GA-P1g` | `GA-P1g3` (deployed) | dep actually satisfied, unresolvable on paper |

Because these are already repaired, the honest board-wide count must be **re-measured
with the `GraphInsights` gather as implementation step 1** — the design-time scanner
over-counted (it mis-parsed quoted `"[[…]]"` wikilinks on the ero board).

### Root cause of the mis-diagnosis (why the meters lie here)

`depends_on` lives in **slice frontmatter**; In-Planning slices are **untracked** by the
coordinator. No existing coordinator verb (`amend-contract`, `amend-park`, `reconcile`)
touches an untracked slice's `depends_on`. So there is currently **no sanctioned path**
to repair a dangling dependency, and nothing that detects one at the status layer.

## Goals

- **Repair:** a sanctioned mechanism to clear/re-point dangling deps, unblocking epics
  so the executor moves them back to In Progress and continues.
- **Prevent:** close both birth vectors at the source — discard-time scan (supersession
  rename) + mint-time guard (never-minted).
- **Surface:** a `loop:block-review` skill that diagnoses, auto-fixes the provable
  cases, and escalates the judgment cases — for both the sauce board and the
  ero-egnyte-mcp board.
- **Distribute:** ship via the plugin (Claude) and brew (Codex/coordinator).

## Non-goals

- Reinventing dependency parsing/detection (reuse `GraphInsights`).
- Auto-minting foundation cards without a human decision.
- Changing how the coordinator claims/parks/deploys work.

## Design

### A. Detection — reuse `GraphInsights` (no bespoke parser)

The verb and skill call the **existing** canonical gather shipped by BL-1
("GraphInsights pure blocking analysis core") and GV-R1 ("honest gather filters archived
slices and stubs cross-epic danglings"). It normalizes every `depends_on` form
(`"[[Card]]"`, bare name, bracketed), filters archived/terminal cards, and reports
danglers + root-blockers + blast-radius. One source of truth, shared with the GraphView
lens. *(A throwaway scanner during design mis-parsed quoted wikilinks and inflated the
ero count — precisely the failure this reuse avoids.)*

### A′. Multi-hop supersession-tail resolver (shared primitive)

New coordinator helper `resolveSupersessionTail(dep, state)`: walk `record.superseded_by`
transitively from tombstone to tombstone until reaching a **non-discarded live tail**
(deployed/planned card) or a null terminus; guard against cycles. Reuses the existing
`deployedSupersedingSibling` / `hasDeployedSupersedingSibling` inference (~4166/4178).
`discardedDependencyProblem` (~1383) is upgraded to report the **live tail** rather than
the single immediate hop. This one primitive backs the discard-time scan, the verb, and
the eligibility message.

### B. `reconcile-dependencies` — new coordinator verb (one-time + ongoing audit/repair)

The **audit/repair for rot already present**, mirroring the ES4b-a (vault-wide drift
audit) / ES4b-r (coordinator-owned drift repair routing) precedent from the 2026-07-25
board-governance redesign. Amend-park discipline, operating on In-Planning slice
`depends_on` frontmatter.

- **Detect:** every `depends_on` entry resolving to a tombstone (via `dependencySatisfied`
  / `discardedDependencyProblem`), then `resolveSupersessionTail` to the live tail.
- **Actions:** `repoint` (rewrite dead name → live tail) · `clear` (when the live tail is
  itself terminal/deployed so the dep is already satisfied).
- **Provable-only classification (verb-enforced):**
  - tail is `deployed`/`discarded`-into-deployed → **clear**
  - tail is pending/planned → **repoint** to the tail
  - target completed/archived on the board → **clear**
  - never-minted / ambiguous (no tombstone, no superseder) → **refuse** with
    `needs-decision` (escalation)
- **Safety:**
  - dry-run plan by default; `--apply` to execute
  - compare-and-swap on a board-state signature (concurrent edit → abort)
  - appends an audit record per change (from→to, reason, fate) to a reconciliation log
  - **planning cards are rewritten; active/parked cards are reported, not touched**
    (those keep `amend-park`/`amend-contract`)
  - **never mints, never discards** — pure dependency-metadata repair
- **CLI shape (draft):**
  `node <coordinator> reconcile-dependencies [--card "<exact>"] [--all] --expected-signature <sig> --reason "<audit>" [--apply] --json`

### C. Prevention — stop new rot at the source

1. **Discard-time scan (primary prevention — coordinator `commandDiscard` core ~4014).**
   When discard runs with `--superseded-by <successor>` (the intake-supersession path),
   scan `cards_root` for **planning-status** cards whose `depends_on` names the
   predecessor, follow the chain to the live tail via `resolveSupersessionTail`, rewrite
   the wikilink, and **emit every rewrite in the discard receipt**. Active/parked
   dependents are **reported, not touched**. This kills the dominant birth vector at the
   exact moment the tombstone is created — no dependent ever survives pointing at a fresh
   corpse.
2. **Mint-time guard (card-intake, hard-refuse + external marker).** Intake refuses to
   mint a slice whose `depends_on` names a card that does not exist. Within-the-same-batch
   sibling forward-refs resolve as legitimate. An explicit `external:` / terminal marker
   is the only escape hatch for legitimately off-board deps. Closes the never-minted
   vector.

### D. `loop:block-review` skill (orchestrator)

Review-family, authorized to *drive* the verb (writer authority stays in the coordinator,
exactly as loop:run drives claim/park/resume).

1. Bind via `loop-config resolve` (refusal → `/loop:init`).
2. Gather via `GraphInsights` → dangling inventory + fate + root-blocker/blast-radius.
3. **Auto-fix provable:** drive `reconcile-dependencies --apply`; quote each receipt.
4. **Escalate judgment (one at a time, recommendation first):** never-minted +
   ambiguous danglers → mint the missing foundation via `/loop:intake` **or**
   confirm-clear. Never-minted foundation cards are decided **interactively per item**.
5. **Recompute + unblock:** trigger the coordinator's `reconcile` so any epic now fully
   resolvable flips `blocked_by_dependencies` → claimable and moves lane through the
   sanctioned writer (no hand-edited columns). Report which epics unblocked.
6. Never mints/discards/edits frontmatter itself.

### E. Rollout (this worktree)

The control-plane changes (A′, B, C) are **ops-flavored, heavy model profile** — they
touch the coordinator and intake rails, not a widget epic. When this work is itself minted
onto the board, it belongs in an ops epic (e.g. Loop Ops).

1. Implement A′ (tail resolver), B (verb), C (discard-time scan + mint guard), D (skill) +
   harnesses.
2. **Sauce board:** re-measure with `GraphInsights` (the 4 known occurrences are already
   hand-fixed), run block-review → auto-clear/repoint provable danglers; escalate each
   never-minted foundation for a mint-or-clear decision.
3. **Ero board:** supervised `observe_only` lift → block-review pass → provable repairs
   through the verb (full receipts) → restore `observe_only`. Ero's real danglers are
   mostly the supersession class (`EM-E1 → EM-E1a`).
4. **Plugin:** add `plugins/loop/skills/block-review/SKILL.md`; regenerate Codex routers
   (`gen-codex-routers.js`); update `Docs/agent-guides/loop-plugin.md` + skill-surface
   table + the `CLAUDE.md` router table.
5. **Release:** conventional commits → automatic pipeline bumps version + publishes brew
   → `brew upgrade` gives Codex the new verb + routers; `/plugin marketplace update`
   gives Claude the new skill.
6. **Verify:** `release:preflight` harnesses green; re-run block-review → zero provable
   danglers remain on either board.

### F. Testing

- `resolveSupersessionTail` harness: single-hop · multi-hop (`BL-4 → BL-4b → BL-4c`) ·
  cycle guard · null terminus.
- `reconcile-dependencies` harness: clear / repoint-to-tail / refuse-never-minted /
  CAS-abort / audit-record / report-not-touch on active+parked.
- **discard-time scan harness:** `discard --superseded-by` rewrites planning dependents to
  the live tail, emits rewrites in the receipt, and leaves active/parked reported-only.
- mint-time guard harness: refuse dangling mint · allow within-batch forward-ref · allow
  external marker.
- **Regression fixtures from the four known occurrences** (`BL-5→BL-4`, `PERF-9→GA-P4b`,
  `PERF-9→PERF-1`, `TD-2a→GA-P1g`) as executable proof the chain-follow lands the right
  tail.
- Codex router `--check` byte-determinism gate (new skill's router).
- `test:loop-plugin-surface` updated for the new skill.
- Seed-vault regression if the guards touch the migration harness surface.

### Verification (both failure surfaces must go quiet)

- Coordinator: `claim --dry-run` no longer skips any card with
  `depends on discarded card …`; no dependency chain deadlocks.
- GraphView: epic-scope render shows **zero** `dangling_dependency` warnings on the
  repaired boards.

## Touch zones

- `scripts/autoloop/codex-coordinator.js` — `resolveSupersessionTail` (new),
  `discardedDependencyProblem` (multi-hop upgrade), `commandDiscard` core (discard-time
  scan + receipt rewrites), `reconcile-dependencies` command (new).
- `.agents/skills/card-intake/scripts/card-intake.js` — mint-time guard; supersession
  post-apply already routes through the coordinator discard path (no separate intake
  repoint needed).
- `plugins/loop/skills/block-review/SKILL.md` (new) + Codex router regen.
- `Docs/agent-guides/loop-plugin.md`, `CLAUDE.md` router/skill tables.
- Harness files under `platform/test/`.

## Open items resolved in brainstorming

- Write authority → **new sanctioned coordinator verb** (not direct frontmatter edit).
- Autonomy → **auto-fix provable, escalate judgment**.
- Prevention → **repair skill + discard-time scan + mint-time guard** (both vectors).
- Discard-time hook location → **coordinator `commandDiscard` core** (where the tombstone
  is created), not a separate intake repoint.
- Multi-hop chains → **follow to the live tail** via `resolveSupersessionTail`.
- Guard strictness → **hard-refuse + external marker**.
- Never-minted default → **decide each interactively**.
- Ero repair → **supervised observe_only lift**.

## Risks / watch-items

- **Verb scope creep:** must refuse tracked/parked cards — dependency repair on in-flight
  work is `amend-*` territory, not this verb.
- **Mint guard false-positives:** within-batch forward-refs and the external marker must
  be honored or legitimate mints break.
- **Ero observe_only:** the lift must be restored even if the pass aborts (wrap in
  restore-on-exit).
- **Epic posture recompute:** unblocking must go through `reconcile`, never a hand-edited
  kanban column, or board drift reappears.
- **Multi-hop cycles:** `resolveSupersessionTail` must guard against a corrupt
  `superseded_by` cycle (visited-set + depth cap) rather than loop forever.
- **Discard-time scan cost:** scanning `cards_root` on every supersession discard must stay
  bounded (single pass, planning-status filter) so discard latency doesn't regress.
- **Read `Docs/agent-guides/delivery-board.md`** before implementing — it owns the
  tombstone-governance + intake-supersession contract this design extends.
