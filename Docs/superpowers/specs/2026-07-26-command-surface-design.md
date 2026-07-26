# Command surface — every loop action through a CLI verb — design spec

**Date:** 2026-07-26
**Status:** Designed by Will's delegate under the Standing delegation of ratification (FID 2026-07-25); mechanical/CLI design class — no constitution-class item touched
**Builds on:** `2026-07-25-board-governance-redesign-design.md` (discard law, supersede-at-mint, digest), `2026-07-26-operator-experience-design.md` (GA-OPS15a–19a: Loop Station, ratification inbox, `consume-ratification`), FID "the one law"
**Slices:** minted into the LIVE Loop Ops epic via card-intake (§8); this spec is the design source of record

## 0. The goal (Will's direction, verbatim intent)

*"Agents who utilize the system will be utilizing the command line no matter what part of the process they're at."*

Every side-effectful action anywhere in the loop lifecycle goes through a **command** with a machine receipt. Today side effects split between real commands (the coordinator's 18 verbs, card-intake) and **prose conventions** in the run-loose prompt (session logs, supersede sequences, FID self-ratification heading flips, digest entries, design-fallback artifacts). End state: a complete, consistent, deterministic CLI for 100% of side-effectful actions, heavy per-verb unit-test coverage in the repo's established fixture families, and prose prompts that shrink to *judgment between commands*. This finishes the one law: **deterministic software controls side effects; models do bounded judgment; receipts decide truth.**

## 1. The action matrix

Every lifecycle action the run-loose v2 engine prompt + FID ask an agent to perform, diffed against the existing command surface (research: five-lane fan-out over the FID, run-loose v2, Board Glossary, `scripts/autoloop/*`, card-intake, `platform/mechanisms/delivery`, the test harnesses, and the agent guides).

**Headline: 31 lifecycle actions. 17 already run through commands. 6 are bounded judgment and stay that way. 8 are prose conventions to convert — closing them takes 3 new/extended verbs plus an envelope-conformance pass, not a rewrite.**

Legend: ✅ = command exists today · ◪ = partial (command exists, orchestration/recording is prose) · ✍ = prose convention (gap) · 🧠 = judgment (stays with the model).

| # | Action (phase) | Today | Proposed | Receipt | Locks | Fixture families (§6) |
|---|---|---|---|---|---|---|
| A1 | Read FID (orient) | 🧠 read | stays | — | — | — |
| A2 | Board status (orient) | ✅ `status --json` | keep | `action:status` | selector (read) | F1 F5 |
| A3 | Drift repair (orient) | ✅ `reconcile --card` | keep | `action:reconciled`, `results[]` | selector + card-gate | F1 F3 F5 F6 |
| A4 | **Session-log append** | ✍ freeform note | **NEW `session-log` verbs** (§5.2) | `action:logged`, `no_op` | log-file lock | F1 F2 F3 F5 F12 |
| A5 | Resume parked card | ✅ `resume` | keep + envelope conformance (§5.4) | `action:implement` / refusal receipt | selector + card-gate | F1 F2 F4 F5 |
| A6 | Card claim (frontier slice) | ✅ `claim` | keep | `action:implement` | selector | F1 F2 F4 F5 |
| A7 | Worktree creation | ✅ inside `claim` | keep | in claim receipt | selector | (covered by claim) |
| A8 | Implementation | 🧠 worker | stays — "a worker result is a proposal, never a receipt" | — | — | — |
| A9 | Focused tests | ✅ npm harnesses | keep; receipt lands via `verify-gates` | `gate_receipt` | card-gate | (existing) |
| A10 | Gate B run + record | ✅ `verify-gates` (runs `gate.js` + preflight + records `gate_receipt`) | keep — **already one verb** | `action:gates-passed` | card-gate | (existing, 990-assert harness) |
| A11 | Three review lenses | 🧠 reasoning ◪ recording via `record-review` | keep; conformance: `no_op` on literal replay, exact-head `--expected-head` binding, `--accepted-limitation` recording (§5.4) | `action:review-recorded` | card-gate | F1 F2 F3 F5 |
| A12 | Feature PR open + record | ✅ `gh` + `record-pr` | keep + envelope conformance | `action:recorded` | card-gate | F1 F2 F5 |
| A13 | CI wait | ✅ `advance` (lease/poll streaming) | keep | `action:waiting/phase-change` | card-gate | (existing) |
| A14 | Release chain (release→tag→tap→brew) | ✅ `advance` / `deploy` | keep | phase receipts | card-gate, homebrew-promotion | (existing) |
| A15 | Three-vault deploy receipts | ✅ `deploy` | keep | `vault_receipts{}` + receipt files | homebrew-promotion | (existing) |
| A16 | Post-deploy reconcile | ✅ `reconcile --card` | keep | `results[]`, `reconcile_clean_streak` | selector + card-gate | (existing) |
| A17 | Phone-sized receipt log | ✍ freeform | `session-log append --kind receipt` | `action:logged` | log-file lock | (with A4) |
| A18 | One same-card repair | 🧠 worker | stays | — | — | — |
| A19 | Auto-supersede (mint successor) | ◪ `card-intake` mints; sequence is prose | intake keeps mint authority; **NEW coordinator `supersede`** executes the park→verify-mint→discard tail as ONE transaction (§5.1) | `action:superseded`, `no_op` | selector + both card-gates | F1 F2 F3 F4 F5 F6 F7 |
| A20 | Discard + tombstone | ✅ `discard --json` | keep | `action:discarded`, tombstone | selector + card-gate | (existing) |
| A21 | Park-for-supersession sequence | ✍ 4-step prose ordering across `park`/intake/`discard` | absorbed by `supersede` (§5.1) | one receipt | one lock scope | (with A19) |
| A22 | Auto-decompose at ceiling | ◪ `card-intake` sub-slice mint; ceiling detection prose | intake keeps; ceiling observation lands in `status --json` ceilings feed (§5.5) | intake receipt + status feed | — | F1 F5 F8 |
| A23 | Design fallback: FID amendment draft + self-ratify flip | ✍ freeform FID write + heading edit | content 🧠; **EXTENDED ratify CLI**: `scaffold-amendment`, `record-design-review`, `self-ratify` (§5.3) | `action:self-ratified`, `no_op` | fid-write lock | F1 F2 F3 F5 F12 |
| A24 | Delegate ratification (PROPOSED → accepted (delegate)) | ◪ `delivery-review-ratify flip` exists | extend: `propose --for-delegate`, `accept --delegate` (§5.3) | `action:flipped`, `no_op` | fid-write lock | F1 F2 F3 F5 |
| A25 | Auto-widen touch zones | ✅ `amend-contract` | keep | `action:contract-amended`, `no_op` | selector + card-gate | (existing) |
| A26 | Accepted-limitation record | ✍ prose in card evidence | `record-review --accepted-limitation` flag (§5.4) | in review receipt | card-gate | F1 F5 |
| A27 | Digest updates | ◪ digest reads `status --json`; ceilings/decompositions feeds missing | feeds completed by GA-OPS16a/17a + ceilings feed (§5.5); nothing new to write — receipts land in state, status projects them | digest object | — | (existing + F5) |
| A28 | Reap (bulk discard) | ✅ `reap --json` | keep | `action:reaped`, `no_op` | selector + card-gates | (existing) |
| A29 | Restructure | ✅ `restructure --json --spec` | keep | intent-journal receipts | selector | (existing) |
| A30 | Cutover flip | ✅ `cutover --json` | keep | `action:cutover`, `no_op` | selector | (existing) |
| A31 | Hard-stop final report | 🧠 prose report | stays; `session-log close --reason` records the stop machine-readably (§5.2) | `action:log-closed` | log-file lock | (with A4) |

## 2. Topology decision: constellation, unified by a shared grammar

**Decision: keep the constellation (coordinator + intake + digest/ratify scripts), unify with a shared grammar kit. Do NOT merge everything into one entrypoint.**

Justification:
- **Fewest surprises for existing receipts.** The coordinator's 18 verbs have a 990-assertion harness asserting exact receipt shapes; the constitution names "the coordinator (discard/reap/restructure/cutover/reconcile) and card-intake" as *the only writers*. A mega-merge would churn every receipt consumer (digest, triage, skills, run-loose) for zero behavior gain.
- **Writer authority is already law, keep it physical.** Three writers, three domains, never forked:
  - **Coordinator** — the ONLY board/ledger/state writer. Every new verb that touches board, card frontmatter, or `state.json` lives IN it (`supersede`).
  - **card-intake** — the ONLY planning writer (mint/scaffold). Unchanged.
  - **delivery-review-ratify** — the ONLY FID writer (it already is, per its own banner). The self-ratification machinery extends it, never the coordinator.
  - Session log is none of these (a vault session note) → a small standalone `session-log.js` in the constellation.
- **One new shared module carries the grammar** (§3): `scripts/autoloop/cli-kit.js` — parseArgs (the coordinator's accumulate-into-array parser promoted to shared), the receipt envelope, machine refusal, exit codes. Existing scripts adopt it additively.

## 3. The uniform grammar contract

Research found four different arg parsers, three `--json` regimes, two receipt-envelope dialects (`action`-primary vs `ok`-primary), snake_case vs kebab-case flags, and three spellings of dry-run. The contract, binding for every NEW verb and adopted **additively** (old keys preserved) by existing ones:

1. **`--json` required first for every mutating verb** — refusal (`exit 1`, machine-parseable) before any read, lock, or write. Read-only verbs always emit JSON; `--json` accepted as a no-op there. (Extends the discard/reap/restructure/cutover rule to park/resume/record-review/record-pr in §5.4.)
2. **Receipt envelope** (registered schema, §7): `{ action, ok, no_op, …verb-specific }`. `action` stays the primary discriminator (coordinator dialect wins — most consumers); `ok:true` is added additively so `ok`-primary consumers (intake/delivery API) converge. Multi-item verbs use `results[]` (the `reconcile` shape).
3. **Machine refusal**: `{ action:'error'|'<verb>-refused', ok:false, code:'<STABLE_CODE>', message, reconcile? }`. Every refusal carries a stable `code` (the intake `supersede_coverage_missing` precedent, generalized). Refusal before write, always; zero-write proven by fixture F2.
4. **Literal replay**: every mutating verb — identical operands → `no_op:true` with zero writes (byte-stability proven, F3); different operands on a settled target → refusal, never partial apply.
5. **Exit codes**: `0` success (incl. `no_op`), `1` refusal/failure, `2` usage. (Existing `3`s grandfathered until touched.)
6. **Flags**: kebab-case; repeatable flags accumulate to arrays; `--dry-run`/`--apply` is the only dry-run spelling (deploy's `--dry` and batch-runner's snake_case get aliases when their files are next touched — not churned proactively).
7. **Locking**: board/state writes under `withLock(ctx,'selector')` + `withCardGateLock` per the coordinator idiom; non-coordinator writers use a single mkdir lock named for their file domain (`fid-write`, `session-log`). Never a second lock namespace over coordinator state.
8. **Landmines carried**: `maxBuffer: 64MB` on every git/gh shell-out; `git add -f scripts/…` for new files; `atomicWrite`; physical-descendant + no-symlink checks on every resolved write path (F7); portable sentinels in committed fixtures.

## 4. What stays judgment (never commands)

Implementation itself; the one same-card repair; review-lens **reasoning** (commands record verdicts, they don't produce them); design **content** (amendment prose, spec authoring); slice-boundary choices at decompose; the final report's narrative. Commands *record and effect*; models *think*. The prompt's role shrinks to sequencing judgment between verbs (§9).

## 5. New and extended verbs — per-verb specs

### 5.1 `codex-coordinator.js supersede` (NEW — the highest-value conversion)

Replaces the most error-prone prose ritual: the 4-step park→mint→discard-at-mint ordering (FID "Park-for-supersession", bootstrap-lineage precedent). Intake keeps mint authority (create-only, own dry-run/apply/no_op); `supersede` executes the coordinator-side tail as one transaction.

- **Invocation**: `supersede --card <predecessor> --superseded-by <successor> --reason "…" [--carried-fixture <name>]… --json`
- **Preconditions (refuse before write, stable codes)**: `--json` first; successor exists on-board as a minted unclaimed slice (`supersede_successor_missing`); successor's `supersedes` frontmatter names the predecessor (`supersede_binding_mismatch`); predecessor is active/exhausted or already parked-for-supersession; no open feature PR on predecessor branch (`discard_open_pr`).
- **Transaction (one selector-lock scope, durable intent journal like `restructure`)**: (1) park predecessor with resume condition exactly `superseded at mint by <successor>` + `depends_on` successor (skip if already so parked — crash-resume); (2) discard predecessor via the existing `discardCardCore` (tombstone `superseded_by`, board line + note + worktree + branch); (3) receipt proves the tombstone before the successor is claimable.
- **Receipt**: `{ action:'superseded', ok, no_op, card, superseded_by, tombstone{…}, park{…}, discard{…} }`. Literal replay on a settled lineage → `no_op:true`.
- **Locks**: selector + card-gate on both cards. **Fixtures**: F1 F2 F3 F4 F5 F6 (crash between park and discard resumes forward) F7.

### 5.2 `scripts/autoloop/session-log.js` (NEW small CLI)

The run-loose session log ("one line per state change, written as you go") becomes structured appends with receipts. Writes ONE note per session under headspace `spice/projects/sauce/docs/workflow-loops/` (path via `delivery-paths.js`, env-overridable for tests).

- **Verbs**: `open --session <slug> --engine <rev> --json` (creates the note with frontmatter `type: loop-session-log`, refuses if it exists non-identically) · `append --session <slug> --kind <state-change|receipt|lesson|wait|ambiguity> --card <name>? --line "…" --json` (appends a timestamped structured line; identical literal re-append → `no_op:true`) · `close --session <slug> --reason <drained|ambiguous-authority|usage-window> --json`.
- **Receipt**: `{ action:'log-opened'|'logged'|'log-closed', ok, no_op, session, path, entry_count }`.
- **Locks**: mkdir lock `session-log` beside the note. **Fixtures**: F1 F2 F3 F5 F12 (+ frontmatter schema registered, §7).
- Non-goal: it never parses or projects board state — it is an append-only human-audit surface; `status --json` remains truth.

### 5.3 `delivery-review-ratify.js` extensions (the FID writer grows; stays the ONLY FID writer)

Design-fallback machinery: content is judgment; the artifact writes become verbs.

- **`scaffold-amendment --fid <p> --heading "…" --body-file <draft.md> --status proposed|for-delegate --json`** — appends the amendment section with the correct governance heading suffix (`PROPOSED` / `PROPOSED (for delegate ratification)`); refuses on duplicate heading (`amendment_heading_exists`); literal replay `no_op:true`.
- **`record-design-review --fid <p> --heading "…" --lens direction-fit|soundness|bounded-risk --verdict pass|refute --summary "…" --json`** — records the design-quorum lens verdict into a receipts sidecar beside the FID (`.fid-ratification-receipts.json`, registered schema §7); enforces lens order and stop-at-first-refutation; the sidecar is what `self-ratify` consumes.
- **`self-ratify --fid <p> --heading "…" --date <YYYY-MM-DD> --json`** — flips the heading to `— SELF-RATIFIED <date>` ONLY when the sidecar shows all three lenses `pass` (refusal `design_quorum_incomplete`); replay `no_op:true`. The existing `flip` verb is kept and re-pointed through the same core; a `--delegate` variant emits `— accepted <date> (delegate)` and validates the four delegate conditions are attested in the receipt.
- **Guardrail (constitution untouched)**: the tool refuses any heading inside the FID constitution section (`constitution_immutable`) — deterministic enforcement of what today is prose discipline.
- **Digest**: self-ratified flips already surface via triage/digest reading the FID; the sidecar adds machine timestamps. **Fixtures**: F1 F2 F3 F5 F12; zero-write proof on every refusal.

### 5.4 Envelope conformance on existing verbs (additive, no consumer breaks)

- `park`, `resume`, `record-review`, `record-pr`: require `--json` (mutating verbs); add `ok` + `no_op` (literal replay: re-recording an identical review/PR/park is `no_op:true`, today it throws or double-appends); stable refusal codes.
- `record-review`: `--expected-head <40hex>` binding (refuse `head_mismatch` when the worktree HEAD moved — closes the gap between "recorded against current HEAD" and "bound to the HEAD the reviewer actually reviewed"); `--accepted-limitation --bound <bar-name>` records the FID single-writer-bound limitation machine-readably in the review record.
- `claim`, `recover`: add `ok` (additive).
- Receipt-envelope keys never removed or renamed — only added. The 990-assertion harness is extended, existing assertions untouched.

### 5.5 `status --json` ceilings feed (small, rides GA-OPS16a/17a work)

`next`/`status` already count skips; add `ceilings[]` (lineages at N/5 superseding siblings, from tombstone `superseded_by` chains) so digest + Loop Station surface approach-to-ceiling and decompose events without prose bookkeeping. Fold into the GA-OPS17a Loop Station projection zone — sequenced via `depends_on`, not duplicated.

## 6. Test bar — "lots of unit tests" defined

Per-verb **named fixture families** in the repo's established style (assert-backed `ok`/`eq` straight-line harness for coordinator verbs; named-scenario counter style for standalone CLIs; every label carries a stable `<EPIC>-<VERB>-<FAMILY>` prefix):

F1 happy apply (exact `changed_paths`) · **F2 refusal-before-write + zero-write proof (MANDATORY per mutating verb)** · **F3 literal-replay `no_op:true` + byte-equality (MANDATORY per mutating verb)** · F4 lock contention/stale ladder · F5 receipt deep-equality + negative token probes · F6 crash/resume at every barrier (stateful verbs) · F7 physical containment/symlink escape (any resolved write path) · F8 shared-corpus valid/invalid · F9 schema/historical compatibility · F10 idempotent state fixtures + portable sentinels · F11 surface/manifest registration · F12 asserted fixture cleanup.

Minimum bars: read-only verb F1 F2 F5 F12; mutating stateless F1–F5 F12 (+F7 if path-resolving); mutating stateful all F1–F7 F9 F12. Precedents to cite per family live in `run-codex-autoloop.js` (`BGR-DISCARD-*`, `ES4-DUAL-NOOP`, `ES4-CONTAINMENT-MATRIX`, `metadataCrashHarness`) and `run-card-intake.js` (`tempCase`, `physicalRefusal`, supersede-governance battery). Every slice's harness joins the `release:preflight` chain; whole-suite GREEN is the gate.

## 7. Schema registry additions

Same-commit `platform/schemas-index.json` entries (lint-schemas green): `autoloop-cli-receipt-envelope` (the §3 envelope, owner workshop) · `loop-session-log-note` (§5.2 frontmatter) · `fid-ratification-receipts` (§5.3 sidecar). The coordinator `state.json` schema registration is deliberately deferred to GA-OPS17a's `sauce.loop-station.v1` work — not duplicated here.

## 8. Slice decomposition (minted into the LIVE Loop Ops epic)

Dependency-ordered, PR-sized, `model_profile: heavy` (control-plane), no vault deploy (workshop tooling; FULL test adequacy — the render-slice bar does not apply). Sequenced behind the in-flight queue where zones collide: GA-OPS16a/17a/19a and GA-OPS20a all touch `codex-coordinator.js` + `run-codex-autoloop.js` + digest.

| Slice | Surface | Touch zones | depends_on |
|---|---|---|---|
| **GA-OPS21a** Shared CLI grammar kit + envelope conformance | `cli-kit.js` (new); additive `ok`/`no_op`/refusal-codes/`--json` on park/resume/record-review/record-pr (+`--expected-head`, `--accepted-limitation`); envelope schema registered | `scripts/autoloop/cli-kit.js`, `codex-coordinator.js`, `platform/test/run-codex-autoloop.js`, `platform/schemas-index.json`, `Docs/agent-guides/delivery-board.md` | GA-OPS19a, GA-OPS20a |
| **GA-OPS22a** Transactional `supersede` verb | §5.1 in the coordinator; intent journal; crash-resume | `codex-coordinator.js`, `run-codex-autoloop.js`, `Docs/agent-guides/delivery-board.md` | GA-OPS21a |
| **GA-OPS23a** Session-log CLI | §5.2 new script + note schema | `scripts/autoloop/session-log.js` (new), `platform/test/run-session-log.js` (new), `package.json`, `platform/schemas-index.json`, `.github` untouched | GA-OPS21a |
| **GA-OPS24a** FID ratification verbs | §5.3 ratify CLI extensions + receipts sidecar schema | `scripts/autoloop/delivery-review-ratify.js`, `platform/test/run-delivery-review.js`, `platform/schemas-index.json`, `Docs/agent-guides/delivery-board.md` | GA-OPS21a |
| **GA-OPS25a** Ceilings feed in status + digest | §5.5; `ceilings[]` in `status --json`; digest line | `codex-coordinator.js`, `delivery-status-digest.js`, `run-codex-autoloop.js` | GA-OPS17a, GA-OPS22a |

Migration order rationale: the grammar kit first (everything cites it); supersede next (highest-value prose ritual, most data-safety exposure); session-log and ratify verbs parallel-eligible after the kit (disjoint zones); ceilings feed last (rides the Loop Station projection).

## 9. Appendix — run-loose prompt v3 sketch (NOT deployed; activates only after §8 ships)

The engine prompt collapses to thin command orchestration. Shape (abridged):

> **Orient**: `status --json` → `reconcile --card <x>` per unambiguous drift → `session-log open`.
> **Execute** (loop): `claim` → implement (judgment) → focused tests → `verify-gates` → three lenses: think, then `record-review --lens <l> --verdict <v> --expected-head <sha>` (stop at first refute; one repair, judgment; rerun) → `gh pr create` + `record-pr` → `advance` → `deploy` → `reconcile --card` → `session-log append --kind receipt`.
> **Exhaustion**: author successor spec (judgment) → `card-intake --apply` → `supersede --card <old> --superseded-by <new>` → continue. Ceiling: decompose spec (judgment) → `card-intake` → `supersede`.
> **Design fallback**: draft body (judgment) → `scaffold-amendment` → three design lenses: think, then `record-design-review` each → `self-ratify` (or `--for-delegate` + hard-stop addressed to the delegate).
> **Hard stop**: `session-log close --reason <r>` → final report (judgment, phone-sized).
> Everything else in v2 — universal law, constitution, bounded bars — persists by reference, no longer as action instructions.

Prose shrinks from ~116 lines of ritual to judgment between verbs; every side effect above is a receipt.
