# Board & governance redesign for the Sauce delivery loop — design spec

**Date:** 2026-07-25
**Status:** Approved in brainstorm by Will (Director); awaiting spec review
**Supersedes on ratification:** the FID clauses named in §7 (this spec is drafted to become the basis of one append-only Final Initial Design amendment)

## 0. The two north stars

1. **Eliminate "superseded"/evidence as a board concept.** Dead work is removed — card, note, branch, worktree — not curated. The learning survives as committed test fixtures, FID policy tables, and git history; the corpse survives nowhere.
2. **Zero human authorization.** Every standing gate (value reviews, ceilings-as-escalations, cutover ratification, design ratification) is replaced by deterministic receipts or in-session self-ratification with retroactive review. The Director sets policy in the FID at leisure; the loop never waits.

Direction decisions made in the 2026-07-25 brainstorm (all Will's):

| Fork | Decision |
| --- | --- |
| Corpse depth | **Tombstone**: board line + card note deleted; ledger keeps a tiny invisible terminal record |
| Git evidence | **Delete all** dead-lineage branches/worktrees, including suspended host evidence |
| FID authority | **Self-ratify + design quorum**: Design Fallback never waits; retroactive digest |
| Migration | **One-shot restructure**: reap + flat→epic regroup + cutover in one sanctioned pass |
| Kill authority | **Self-discard + digest**: the loop may kill not-worth-finishing work; resurrection = one intake |
| Human minimum | **Perimeter rule**: zero gates inside sauce↔tap↔vaults; outward actions are Will-initiated only |

## 1. Board model — sauce adopts the ERO epic-centric topology

### Parent board (`sauce-board.md`)

Holds **only epics** plus triage and history. Lanes:

- **In Planning** — drag-ordered epic priority queue. Drag order is the Director's one standing input.
- **In Progress** / **Blocked** — derived: painted by the coordinator from the epic's slice rollup (`epicProjectionMapping`), never hand-maintained.
- **Discovered** — triage inbox of one-line findings with resolution pointers (ERO convention).
- **Post-GA** — real cards deliberately frozen.
- **Completed** / **Archive** — history, kept as-is (44 completed + 89 archived flat cards remain; history is not junk). Collapsed by default.

### Epics

The ~90 flat In-Planning cards regroup into ~8–10 **family epics**, minted via `card-intake` (`roadmap_theme`-style, create-only). Family boundaries are Executor judgment; guidance:

| Epic (working name) | Absorbs |
| --- | --- |
| Core Styling Adoption | GA-C family remainder (C4b, C5b/c, C6d2, C7b/c/d, C8b–e, C10a, C9b/c) |
| Shared-Mechanism Dedup | GA-R family (R1b, R2b1/2, R3b/c, R5, R6, R8, R9) |
| Row Actions & Entity Management | GA-M1–M6 |
| Feature Polish | GA-F1b, F2a/b, F4, F5, GA-F3 lineage remainder |
| Harness & Docs Hygiene | GA-H1–H9 remainder, GA-D5a/D6, GA-H5a/b, H6, H7 |
| Perf & Instant Updates | GA-P1–P4 |
| Vault Doctor | GA-I1/I2 |
| Loop Ops | GA-OPS12b + future control-plane slices |
| Epics & Slices bridge (existing) | ES remainder (ES5) until closed |
| Visual Regression | GA-V1b (or fold into Harness & Docs Hygiene) |

Each epic gets the canonical scaffold: `spice/projects/sauce/tasks/<Epic>/{<Epic>.md (atlas, type: epic), board/<Epic>-board.md (board_role: epic), context/{pack.md,runs,lessons,decisions}}`, EpicDashboard on the atlas, slices flat in `board/` with `type: slice`, `epic`/`task_parent` backlinks, and the Delivery execution contract (`model_profile`, `touch_zones`, `depends_on`, `deploy_subscriptions`).

Flat planning cards become slices: note **moved** into the owning epic's `board/`, frontmatter rewritten to the slice schema by the sanctioned migration; content (outcome, acceptance, evidence) preserved. Tracked ledger identities are preserved (the ledger key is the card name, which does not change).

### Contract fix riding along

`deriveEpicLifecycle` (delivery-contract.js:457) stops counting `parked` as **active**. New bucket semantics: `completed→done`, `in_progress→active`, `parked→waiting` (rolls up like blocked for epic state), `blocked→blocked`, `discarded→excluded entirely`, else `planned`. Under the new governance, parked only ever means a short-lived concurrency or deploy wait.

### Decoder ring

A **sauce Board Glossary** doc (adapted from ERO's) at `spice/projects/sauce/docs/roadmap/Board Glossary.md`, plus an agent-guide section in the workshop (`Docs/agent-guides/`) so every future session understands the topology.

## 2. Killing "superseded" — the `discarded` terminal disposition

### Coordinator: new phase `discarded`

- Wires the reserved slot in `TERMINAL` (codex-coordinator.js:45). `projectionMapping('discarded')` → **removal semantics**: the discard operation deletes the card's board line and the card note (the coordinator is the sanctioned writer), prunes its worktree, deletes its `codex-autoloop/*` branch (guard: never a branch with an open PR or an active claim), and stamps the ledger record with tombstone fields: `discarded_at`, `discard_reason`, `superseded_by` (nullable), `final_head` (40-hex), `carried_fixtures[]`.
- **Tombstones are invisible machine state**: never projected to any board, never counted in any rollup, retained forever. They exist so (a) the name cannot be reused or re-claimed (`selectClaimCandidate` guard already checks `state.cards[name]`), (b) a `depends_on` pointing at a discarded card **fails loudly** (never satisfied, never silently checkbox-satisfied), and (c) `status --json` can answer "what happened to X".

### Supersession flow change

When the loop mints superseding sibling X2, the coordinator **discards X at mint time** (no park-as-evidence, no rename-in-lane). The learning-preservation guarantee moves to intake: **`card-intake` refuses a superseding contract whose binding fixtures do not cover every named finding of the predecessor.** The learning's canonical homes are: committed red/green fixtures in the successor (enforced), FID policy tables (for policy-level lessons), epic `context/runs/` + `context/lessons/` notes (for attempt narrative, ERO-style), and git history (for everything else).

### `reap` — idempotent bulk discard

A coordinator operation that:

1. Detects superseded corpses by the deterministic inference currently in `delivery-review-triage.js` (`hasDeployedSupersedingSibling`: stem match + deployed/completed sibling + supersedes-pattern name), **moved into the coordinator**, and discards them (~50 cards, including the ES4a×13, ES4b×5, ES2c×9 chains and GA-* predecessors).
2. Strips the 34 "(decomposed → …)" stub annotations from In Planning parent lines and removes duplicate card ids (two `ES4` cards, stale ES2d–g planning copies).
3. Discards the suspended host-lineage evidence (GA-OPS4b, original A5, LH1/LH3/LH3b, GA-OPS10a/GA-OPS10b) and the exhausted shelved lineages (GA-C2a/b, GA-C9a/a2/a3). Their refutation learning is already permanent in the FID's fixture tables (e.g. LH-SPLIT-R1–R7). **The host initiative remains suspended regardless** — suspension is policy, not a card; reopening remains Will-initiated (§3).
4. Is idempotent and replayable (`no_op: true` on a settled board), so corpse drift never re-accumulates: every future supersession self-cleans at mint time, and `reap` is the backstop.

### Downstream consumers

- `delivery-review-triage.js`: the `superseded-corpse` bucket disappears (nothing left to classify); parked classification simplifies to genuine waits.
- `delivery-status-digest.js`: reports discards from tombstones ("noAction" becomes "discarded since last look").
- `delivery-schema.json`: `status` enum + `discarded`; schemas-index bump; the one-time board reshaping runs under the migration-lifecycle gate (one-time reshapers are gated; the standing reap is not a migration).

## 3. Zero-authorization governance

One Will ratification adopts this design as an FID amendment. After it lands:

### 3.1 The ES machinery generalizes to every family

Auto-continuation on implementation-level refutations (repair → auto-supersede, no value review), the single-writer threat-model bound, the absolute non-resetting 5-sibling ceiling, auto-decompose at ceiling, and double-ceiling → Design Fallback apply to **all** families, not just ES. The two-strike initiative rule and all mandatory human value reviews are retired. (GA-F3a2's pending value review dissolves immediately under this policy.)

### 3.2 The Design Fallback always self-ratifies

- On an architecture-level refutation (or a double-ceiling), the loop runs the Design Fallback: gather evidence, research read-only, draft the FID amendment with named fixtures.
- The draft must pass a **design quorum** — three sequential adversarial lenses on the design itself: **direction-fit** (contradicts no standing law, stays in perimeter, preserves the constitution), **soundness** (answers every refutation point with a testable fixture), **bounded-risk** (no new side-effect class, threat boundary unchanged or narrowed). Stop at first refutation → redraft (bounded attempts; a design that cannot pass its own quorum routes to discard-or-decompose, never to a human wait).
- On quorum pass the amendment is marked **SELF-RATIFIED <date>** and the session continues immediately under it. The PROPOSED-and-wait state no longer exists.
- Every self-ratified amendment enters the **retroactive digest** (§3.5). Will may reject any at leisure: rejection spawns a corrective card through normal intake; shipped work stands per its receipts.

### 3.3 The constitution — the immutable core only Will edits

Self-ratification can never amend:

1. The one law (human sets direction; deterministic software owns side effects; models do bounded judgment; receipts decide truth).
2. Gate B + the three review lenses + receipts-decide-truth (the quality kernel). Bounded bars may tune *scope* per ratified patterns; the kernel itself is fixed.
3. The perimeter rule (§3.6).
4. Host reopening is Will-initiated (the durable-host suspension stands; no loop authority may reopen, design for, or touch the host initiative).
5. This constitution clause itself.

### 3.4 Deterministic gates replace named human gates

- **ES5 cutover**: flips automatically when its receipts exist — ES chain deployed, seed-vault migration fixture green in CI, N (default 3) consecutive zero-drift full reconciles. Reversible by design (flag off restores legacy intake), which is why it needs no human yes. (Under the one-shot restructure, the flip happens at cleanup step 4.)
- **Not-worth-finishing work self-discards** (Director-granted kill authority): at a double-ceiling where the design quorum judges cost > value, or for residuals no bounded bar can ship, the loop discards the item with a one-paragraph justification + receipts in the digest. Resurrection is one intake command.
- **Economics**: ceilings, budgets, and usage-window stops remain deterministic as today.

### 3.5 The retroactive digest

`delivery-status` gains a "**since you last looked**" section: self-ratified amendments, discards (with justifications), cutover flips, ceilings hit, decompositions. Reading it is optional; nothing ever waits on it. `delivery-review` reorients from "draft ratifiable amendments" to "walk the digest + surface perimeter items."

### 3.6 The perimeter rule — the entire irreducible human surface

Inside the perimeter (the sauce workshop repo, homebrew-sauce tap, and Will's three vaults) the loop has zero gates. Outside it the loop **prepares but never fires**: public publication / community-plugin submission / GA announcement, new credential scopes or write targets beyond sauce + homebrew-sauce, and anything spending money. These are Will-initiated projects, not gates the loop waits at.

### 3.7 The quality bar does not move

Gate B, the three sequential lenses, bounded bars, receipts, exact-HEAD binding, and the release chain are unchanged. The ES4a evidence says the bar was over-strong, not weak; this redesign changes only **who the machine asks when the bar's verdict is in** (nobody), plus one strengthening: intake-time enforcement that superseding contracts bind all carried findings as fixtures (§2).

## 4. The cleanup — sanctioned, ordered, loop-safe

All code ships through the normal pipeline (feature PR → CI → release → brew → vault deploy). The board goes clean **after** the release lands, in one pass:

1. **Baseline reconcile** — zero drift required before any removal.
2. **`reap`** — corpses, stubs, dupes discarded; worktrees pruned; branches deleted (guarded).
3. **Restructure** — mint family epics via create-only `card-intake`; migrate flat planning cards to slices (note moves + frontmatter rewrite); `no_op: true` replay required.
4. **Cutover** — ES5 flag flips (its receipts now exist by construction).
5. **Final reconcile** — zero drift; write the sauce Board Glossary; regenerate cycle-status.

The pass runs under the existing single-flight autoloop turn lock so a scheduled loop turn cannot interleave (the shared-tree overlap lesson). Every step is idempotent and individually replayable. Obsidian closed only during the bounded board-write windows, reopened immediately (standing rule).

## 5. Loop-agent understanding — prompt and skills

- **run-loose prompt**: rewritten shorter. The ES-only carve-outs become universal law stated once (auto-continue, threat-model bound, ceiling, auto-decompose, discard, self-ratify + digest). Board language becomes two-level: claim = the frontier slice of the top In-Planning epic, read from that epic's board; `resolveEpicBoardSet`/two-level selection is the claim path. PRE-AUTHORIZATIONS collapses to a few lines. HARD STOPS reduce to: genuinely drained frontier (no claimable, decomposable, or resumable work in ANY family), ambiguous authority failing closed, usage-window exhaustion.
- **card-intake**: epic-native default post-cutover (new work = slice under an epic; new themes = new epic); enforces finding-coverage on supersede (§2); flat-card creation only for Discovered-lane one-liners.
- **delivery-status / delivery-review**: read tombstones + digest (§3.5).
- **Docs**: sauce Board Glossary; a `Docs/agent-guides/` section for the epic topology + discard/self-ratify governance; CLAUDE.md router line.

## 6. Testing

- **Coordinator**: fixtures for `discarded` (projection removal, tombstone fields, claim-guard on tombstone, depends_on-on-tombstone fails loudly, branch-delete guards, reap idempotency + `no_op: true` on settled board, stub/dupe stripping, discard-at-mint supersession).
- **Contract**: `deriveEpicLifecycle` bucket changes (parked=waiting, discarded=excluded) with red/green fixtures; schema enum bump fixtures.
- **Intake**: superseding-contract finding-coverage refusal fixture; epic-native intake fixtures; flat→slice migration fixtures in seed-vault (the migration-regression net).
- **Skills**: triage/digest classifier fixtures on a post-reap ledger shape.
- **End-to-end**: seed-vault board restructure replay — flat fixture board → reap → epics → zero drift, run twice, second run `no_op: true`.

## 7. FID clauses this supersedes (on ratification)

- All mandatory human value-review requirements and the two-strike initiative rule (replaced by §3.1).
- The "Bounded provisional ratification" six-condition test and the PROPOSED-awaiting-Will state (replaced by §3.2; the design quorum is the new qualification).
- "Preserved parked evidence" / "immutable preserved branch" clauses for superseded and closed lineages, including host-lineage evidence retention (replaced by §2; the host **suspension itself stands** and enters the constitution).
- ES5's "cutover only after Will's separate explicit authorization" (replaced by §3.4) and the "bulk migration remains forbidden / legacy drain" clause (replaced by §4's one-shot restructure).
- The parked→In Progress projection mapping and parked-counts-as-active rollup (replaced by §1/§2).
- The ES-only scoping of auto-continuation, threat-model bound, ceiling, and auto-decompose (generalized by §3.1).

Unchanged and reaffirmed: the one law, Gate B + three lenses, receipts chain, release pipeline automation, touch-zone concurrency locking, single-writer threat model, the never-idle rule, and the durable-host suspension.

## 8. Release/versioning reality

Coordinator + contract + intake + skills changes are ordinary release-backed work: they land as slices (under the Loop Ops epic or a dedicated "Board & Governance Redesign" epic — Executor's call), each through the full quorum and release chain. The cleanup pass (§4) runs only after the enabling release deploys to the workshop via brew. Nothing in this spec is hand-applied to the live board.
