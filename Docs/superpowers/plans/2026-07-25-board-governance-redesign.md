# Board & Governance Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo-convention override:** this workshop's release pipeline is fully automatic (conventional commits → merge to main → bumper → tag → tap → brew). NEVER hand-version, tag, or merge the release PR. Every code task below is also a valid release-backed slice: its header carries the execution contract (touch zones, depends_on) so it can be minted via `card-intake` and driven by the loop instead of executed inline. Task order = dependency order.

**Goal:** Ship the epic-centric board + zero-authorization governance decided in `Docs/superpowers/specs/2026-07-25-board-governance-redesign-design.md`: a `discarded` terminal state with tombstones, an idempotent `reap`, discard-at-mint supersession, the one-shot flat→epic restructure, deterministic ES5 cutover, digest/skill updates, and the rewritten run-loose prompt.

**Architecture:** Contract first (schema + rollup buckets), then coordinator (discard verb → reap → restructure → cutover), then intake enforcement, then read-side skills, then docs/prompt, then the post-deploy cleanup runbook. The coordinator remains the only board writer; every new write op is ledger-first, atomic, idempotent, and `no_op:true` on replay.

**Tech Stack:** Node (no deps) coordinator + contract; custom `platform/test/run-*.js` harnesses; Obsidian Kanban markdown boards; card-intake skill scripts.

---

## File map

| File | Role in this plan |
| --- | --- |
| `platform/mechanisms/delivery/data/delivery-schema.json` | `discarded` status enum + alias (Task 1) |
| `platform/mechanisms/delivery/scripts/delivery-contract.js` | `sliceStatus` + `deriveEpicLifecycle` bucket changes (Task 1) |
| `platform/test/run-delivery-contract.js` | Contract fixtures (Task 1) |
| `scripts/autoloop/codex-coordinator.js` | `discarded` phase, tombstones, `removeBoardCard`, `commandDiscard`, `commandReap`, `commandRestructure`, `commandCutover` (Tasks 2, 3, 5, 6) |
| `platform/test/run-codex-autoloop.js` | Coordinator fixtures (Tasks 2, 3, 5, 6) |
| `.agents/skills/card-intake/scripts/card-intake.js` + `SKILL.md` | Finding-coverage on supersede; epic-native default (Task 4) |
| `platform/test/run-card-intake.js` | Intake fixtures (Task 4) |
| `platform/test/seed-vault/spice/projects/…` | Restructure migration fixture (Task 5) |
| `scripts/autoloop/delivery-review-triage.js`, `delivery-status-digest.js` | Tombstone/digest read-side (Task 7) |
| Headspace vault: FID, run-loose prompt, Board Glossary | Docs deliverables (Tasks 0, 8) |
| `Docs/agent-guides/` + `CLAUDE.md` | Workshop guide + router line (Task 8) |

Verification commands used throughout (standalone node runners): `node platform/test/run-delivery-contract.js`, `node platform/test/run-codex-autoloop.js`, `node platform/test/run-card-intake.js`, plus `npm run lint-schemas` after any schema change and full preflight before each PR (see `Docs/agent-guides/build-test-verify.md`).

---

### Task 0: FID amendment draft (docs-only; Will's single ratification)

**Files:**
- Modify: headspace `spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md` (append-only)

- [ ] **Step 1: Append the amendment** titled `## Board & governance redesign — epic-centric board, discarded terminal state, zero-authorization — PROPOSED 2026-07-25`, with a `> [!warning] PROPOSED — awaiting Will's ratification` callout. Body = a condensed transcription of the spec: the six brainstorm decisions table; §1 board model; §2 discard/tombstone/reap; §3 governance (generalized ES machinery, self-ratifying Design Fallback + design quorum, the five-clause constitution, deterministic cutover, kill authority, digest, perimeter rule); §4 one-shot cleanup; §7 superseded-clauses list verbatim; §8 release reality. Link the spec file path as the full design.
- [ ] **Step 2: Will flips the heading to accepted.** This is the ONE human act in the whole plan. Everything below is implementable before ratification (it's ordinary release-backed code), but the cleanup pass (Task 9) and the governance/prompt switchover (Task 8) MUST NOT run until the heading reads accepted.

### Task 1: Contract — `discarded` status + `waiting` rollup bucket

**Slice contract:** touch zones `platform/mechanisms/delivery`, `platform/test/run-delivery-contract.js`, `platform/schemas-index.json`; depends_on: none; deploy_subscriptions: empty (mechanism already subscribed everywhere).

- [ ] **Step 1: Write failing fixtures** in `platform/test/run-delivery-contract.js`, following the file's existing fixture pattern (each fixture = build slice array → call API → assert):

```js
// BGR-CONTRACT-DISCARDED-EXCLUDED: discarded slices vanish from rollup entirely
{
  const lifecycle = deriveEpicLifecycle([
    { status: 'completed' },
    { status: 'discarded' },
    { status: 'discarded' },
  ]);
  assert.strictEqual(lifecycle.state, 'done', 'BGR-CONTRACT-DISCARDED-EXCLUDED state');
  assert.strictEqual(lifecycle.counts.done, 1);
  assert.strictEqual('discarded' in lifecycle.counts, false, 'discarded never counted');
}
// BGR-CONTRACT-PARKED-IS-WAITING: parked no longer counts as active
{
  const lifecycle = deriveEpicLifecycle([{ status: 'parked' }, { status: 'planning' }]);
  assert.strictEqual(lifecycle.counts.waiting, 1, 'parked -> waiting bucket');
  assert.strictEqual(lifecycle.counts.active, 0, 'parked is NOT active');
  assert.strictEqual(lifecycle.state, 'blocked', 'waiting rolls up like blocked');
}
// BGR-CONTRACT-ALL-DISCARDED-IS-PLANNED: an epic whose every slice was discarded
{
  const lifecycle = deriveEpicLifecycle([{ status: 'discarded' }]);
  assert.strictEqual(lifecycle.state, 'planned', 'empty-after-discard epic is planned, not done');
}
// BGR-CONTRACT-STATUS-ENUM: schema accepts discarded
{
  const result = validateSlice({ ...validSliceFixture, status: 'discarded' });
  assert.strictEqual(result.ok, true, 'BGR-CONTRACT-STATUS-ENUM');
}
```

- [ ] **Step 2: Run to verify failure.** `node platform/test/run-delivery-contract.js` → expected: the four BGR-CONTRACT fixtures FAIL (unknown status / active-count mismatch).
- [ ] **Step 3: Implement.** In `delivery-schema.json`: add `"discarded"` to the `status` enum (line ~11) and to `status_aliases` (identity mapping). In `delivery-contract.js`: `sliceStatus` (L444-449) returns `'discarded'` for raw `discarded`; `deriveEpicLifecycle` (L451-485): skip `discarded` slices before counting (`slices = slices.filter(s => sliceStatus(s) !== 'discarded')`); change the L457 branch so `parked` increments `counts.waiting` (new bucket, init 0) instead of `counts.active`, and the state derivation treats `waiting > 0` exactly like `blocked > 0`. Keep `in_progress → active` unchanged. Bump the delivery registry minor version per its versioning convention; update `platform/schemas-index.json` accordingly.
- [ ] **Step 4: Verify.** `node platform/test/run-delivery-contract.js` → all pass, including every pre-existing fixture (any old fixture asserting parked-as-active must be MIGRATED to the new law, not deleted — cite this plan in the fixture comment). `npm run lint-schemas` → clean.
- [ ] **Step 5: Check consumers.** `node platform/test/run-epic-dashboard.js` and `node platform/test/run-codex-autoloop.js` → EpicDashboard renders the new `waiting` count (add a `waiting` chip mirroring the blocked chip style if the dashboard enumerates buckets explicitly); coordinator `deriveEpicProjection` compiles unchanged (it delegates to the contract).
- [ ] **Step 6: Commit.** `git add -A platform/ && git commit -m "feat(delivery): discarded status excluded from rollup; parked counts as waiting not active"`

### Task 2: Coordinator — `discarded` phase, tombstones, `commandDiscard`

**Slice contract:** touch zones `scripts/autoloop/codex-coordinator.js`, `platform/test/run-codex-autoloop.js`; depends_on: Task 1 deployed; deploy_subscriptions: empty.

- [ ] **Step 1: Write failing fixtures** in `platform/test/run-codex-autoloop.js` (use the harness's existing temp-vault board builders):

```text
BGR-DISCARD-HAPPY            discard --card X --superseded-by X2 --reason "…" --json on a parked tracked card:
                             ledger phase becomes 'discarded' with tombstone fields
                             {discarded_at, discard_reason, superseded_by, final_head, carried_fixtures[]};
                             X's board line REMOVED from its lane; X's card note file DELETED;
                             exit 0 with machine-readable receipt.
BGR-DISCARD-REPLAY-NOOP      literal replay of the identical discard → {no_op:true}, zero writes.
BGR-DISCARD-ACTIVE-REFUSED   discard of the active claim or any in-flight phase (claimed…deploying) refuses, zero writes.
BGR-DISCARD-TOMBSTONE-UNCLAIMABLE  a board line hand-added with a tombstoned name is never selected by claim.
BGR-DISCARD-DEP-FAILS-LOUD   dependencySatisfied(dep=tombstoned card) → explicit 'depends on discarded card' error,
                             NEVER satisfied, NEVER falls through to the Completed-checkbox fallback.
BGR-DISCARD-PROJECTION-NULL  projectionMapping('discarded') === null; reconcile of a tombstone is a no-op (no
                             projection_error stamped for missing board line — absence IS the correct projection).
BGR-DISCARD-BRANCH-GUARD     branch delete refused when the record has an open PR or the branch is checked out in a
                             worktree; discard still completes (branch flagged in receipt as retained_unsafe_to_delete).
BGR-DISCARD-EPIC-ROLLUP      discarding a canonical epic slice reprojects the epic: the discarded slice disappears
                             from the epic board and the atlas/parent rollup recomputes without it.
```

- [ ] **Step 2: Run to verify failure.** `node platform/test/run-codex-autoloop.js` → new fixtures FAIL (`unknown command discard`).
- [ ] **Step 3: Implement, ledger-first.** In `codex-coordinator.js`:
  - Add `'discarded'` to `TERMINAL` (L45). `projectionMapping` returns `null` for it (like `failed`/`cancelled` today).
  - New `removeBoardCard(boardRaw, card)` — the mirror of `moveBoardCard` (L910-924): locate the line via the same `boardCardLocation` helper, splice it out, return the new raw; throw if absent ONLY when the caller demands presence (discard treats absence as already-done for idempotency).
  - New `commandDiscard(opts)` (register beside `commandPark`, ~L2207): require `--json` (GA-OPS10 F2 precedent); acquire the card gate lock; refuse active/in-flight phases; write the ledger record first (`phase:'discarded'`, tombstone fields; `final_head` = record's preserved HEAD if any); then board-line removal via `removeBoardCard` + `atomicWriteText`; then card-note deletion (`fs.unlinkSync` after an lstat regular-file + path-containment check inside the project tasks root — reuse the ES4a realpath-containment helpers); then `git worktree remove --force` if the record's worktree exists, and branch deletion guarded per BGR-DISCARD-BRANCH-GUARD. For canonical epic slices, run the existing epic reprojection (`projectCard` path) for one surviving tracked sibling — or, when none exists, the untracked-sibling reconcile route (L2628-2694) — so the rollup recomputes.
  - `dependencySatisfied` (L559-565): if `state.cards[dep].phase === 'discarded'` → return the explicit failure finding (no checkbox fallback).
  - `commandStatus`: add `discarded_total` and a `discarded_recent[]` (last 10 tombstones: name, discarded_at, superseded_by, reason) to the JSON.
- [ ] **Step 4: Verify.** `node platform/test/run-codex-autoloop.js` → all green including the full pre-existing suite.
- [ ] **Step 5: Commit.** `git commit -am "feat(autoloop): discarded terminal phase with tombstones and sanctioned board/note/branch removal"`

### Task 3: Coordinator — idempotent `reap`

**Slice contract:** touch zones `scripts/autoloop/codex-coordinator.js`, `platform/test/run-codex-autoloop.js`; depends_on: Task 2; deploy_subscriptions: empty.

- [ ] **Step 1: Write failing fixtures:**

```text
BGR-REAP-CORPSES        a board with parked X (stem 'ES9a') + deployed 'ES9a2 … (supersedes ES9a)' → reap discards X
                        (superseded_by='ES9a2'); a parked card with NO deployed successor is untouched.
BGR-REAP-STEM-EXACT     stem matching is token-exact: 'ES4a' matches 'ES4a …' not 'ES4a2 …' (port stemOf + the
                        deployed-sibling inference from delivery-review-triage.js:39-62 INTO the coordinator; the
                        triage skill will consume the coordinator's answer in Task 7).
BGR-REAP-STUBS          In Planning line '- [ ] [[Parent]] (decomposed → [[C1]] → [[C2]])' → annotation stripped,
                        line becomes '- [ ] [[Parent]]'; a parent whose children are ALL tombstoned/completed and
                        which is itself a non-claimable planning container is discarded outright.
BGR-REAP-DUPES          two lines targeting the same wikilink in one board → first kept, second removed.
BGR-REAP-EXPLICIT-LIST  reap --also '<name>' discards an explicitly named parked/closed card (drives the host-evidence
                        and shelved-lineage list from the spec; refuses names with active phases).
BGR-REAP-NOOP           reap on a settled board → {no_op:true}, zero writes, exit 0.
```

- [ ] **Step 2: Run to verify failure.** Expected: `unknown command reap`.
- [ ] **Step 3: Implement** `commandReap(opts)`: single pass under the global selector lock — (1) compute corpse set from ledger + board (ported inference), (2) `commandDiscard` each (reusing its idempotent core; batch receipt), (3) strip `(decomposed → …)` suffixes with a function replacer (NEVER string `$` replacement — landmine `lesson_string_replace_dollar_specials`), (4) dedupe lines, (5) process `--also` names. Emit one JSON receipt listing every action; replay → `no_op:true`.
- [ ] **Step 4: Verify + commit.** Full suite green. `git commit -am "feat(autoloop): idempotent reap — bulk discard of superseded corpses, stub annotations, duplicate lines"`

### Task 4: Intake — finding-coverage on supersede + discard-at-mint

**Slice contract:** touch zones `.agents/skills/card-intake`, `platform/test/run-card-intake.js`, `scripts/autoloop/codex-coordinator.js` (mint hook only); depends_on: Task 2; deploy_subscriptions: empty.

- [ ] **Step 1: Write failing fixtures** in `platform/test/run-card-intake.js`:

```text
BGR-INTAKE-SUPERSEDE-COVERAGE   a spec with supersedes:'X' + carried_findings:['F1','F2'] but binding_fixtures
                                covering only F1 → REFUSED before any write, machine-readable error naming F2.
BGR-INTAKE-SUPERSEDE-DISCARDS   apply of a valid superseding spec emits a post-apply instruction block
                                {discard: {card:'X', superseded_by:'X2'}} in its receipt; the run-loose flow (and
                                Task 9 runbook) executes it via coordinator discard. (Intake itself never touches
                                coordinator state — preserve that boundary.)
BGR-INTAKE-SUPERSEDE-NOOP       literal replay of the applied spec → no_op:true (existing discipline, new fields
                                covered by the replay hash).
```

- [ ] **Step 2–4: Fail → implement → verify.** In `card-intake.js`: superseding specs gain required `carried_findings[]` + `binding_fixtures[]`; validation asserts every finding name appears in at least one fixture name/description (exact token match); receipt gains the discard instruction. Update `SKILL.md`: supersede recipe + the epic-native default (post-cutover, new medium/heavy work MUST target an epic board; flat creation reserved for Discovered one-liners).
- [ ] **Step 5: Commit.** `git commit -am "feat(card-intake): superseding specs must bind carried findings as fixtures; receipts instruct predecessor discard"`

### Task 5: Restructure — flat→epic migration tooling + seed fixture

**Slice contract:** touch zones `scripts/autoloop/codex-coordinator.js`, `platform/test/run-codex-autoloop.js`, `platform/test/seed-vault/spice/projects/…`; depends_on: Tasks 2-3 (uses discard + reap primitives), ES2d scaffolding (deployed); deploy_subscriptions: empty.

- [ ] **Step 1: Author the seed-vault fixture** (migration-regression net, per `Docs/agent-guides/migration-regression-net.md`): a flat fixture project with a parent board holding 6 flat planning cards in 2 families, 1 corpse pair, 1 stub-annotated parent — the miniature of the live sauce board.
- [ ] **Step 2: Write failing fixtures:**

```text
BGR-RESTRUCTURE-HAPPY    restructure --spec map.json (spec: [{epic:'Family A', members:['Card 1','Card 2']}, …]) →
                         epic scaffolds created (atlas + board_role:epic board + context dirs, via the ES2d
                         scaffolding path); each member note MOVED to tasks/<Epic>/board/<Card>.md; frontmatter
                         rewritten to the slice schema (type:slice, epic/task_parent backlinks, source_board=epic
                         board, status preserved, body byte-preserved below frontmatter); parent-board member lines
                         replaced by one epic line per epic in In Planning (original relative order of first
                         members preserved).
BGR-RESTRUCTURE-TRACKED  a member with a ledger record keeps its exact ledger key (card name unchanged) and its
                         phase; reconcile after restructure → zero drift, zero projection errors.
BGR-RESTRUCTURE-REFUSES  a member name absent from the board, or present twice, or an epic name colliding with an
                         existing note → refuse before any write.
BGR-RESTRUCTURE-NOOP     literal replay → no_op:true.
BGR-RESTRUCTURE-E2E      seed fixture: reap → restructure → full reconcile ×2 → second reconcile reports zero drift
                         and no_op; ES4b-a drift audit reports clean.
```

- [ ] **Step 3–4: Fail → implement → verify.** `commandRestructure` composes existing primitives: ES2d scaffold creation, `removeBoardCard`/board line insertion, atomic multi-file writes with the guarded roll-forward discipline (durable intent journal before first mutation; resume-forward on the recorded preimage; fail closed on any third state — same pattern the intake transaction uses). Run the E2E fixture twice.
- [ ] **Step 5: Commit.** `git commit -am "feat(autoloop): restructure command — sanctioned flat-to-epic board migration with no_op replay"`

### Task 6: Deterministic ES5 cutover

**Slice contract:** touch zones `scripts/autoloop/codex-coordinator.js`, `platform/test/run-codex-autoloop.js`, `.agents/skills/card-intake` (flag consumption); depends_on: Task 5; deploy_subscriptions: empty.

- [ ] **Step 1: Write failing fixtures:**

```text
BGR-CUTOVER-CRITERIA   cutover --json verifies receipts: every ES-chain card's ledger phase is deployed/completed
                       with three-vault receipts; the migration E2E fixture harness is registered in package.json;
                       reconcile_clean_streak >= 3 in coordinator state (a counter incremented by each full
                       reconcile that finds zero drift, reset on any drift). All true → writes cutover:{enabled:true,
                       enabled_at, receipts} into coordinator state; any false → refuses listing the unmet criterion.
BGR-CUTOVER-REVERSIBLE cutover --off flips it back (records reason); intake behavior follows the flag both ways.
BGR-CUTOVER-NOOP       replay when already enabled → no_op:true.
```

- [ ] **Step 2–4: Fail → implement → verify.** Flag lives in coordinator state (single source; card-intake reads it via `status --json`). Digest entry emitted on every flip (consumed in Task 7).
- [ ] **Step 5: Commit.** `git commit -am "feat(autoloop): receipt-gated reversible epic-intake cutover flag"`

### Task 7: Read-side — triage, digest, retroactive review surface

**Slice contract:** touch zones `scripts/autoloop/delivery-review-triage.js`, `scripts/autoloop/delivery-status-digest.js`, their harness coverage, `.claude/skills/delivery-status`, `.claude/skills/delivery-review`; depends_on: Tasks 2, 6; deploy_subscriptions: empty.

- [ ] **Step 1: Write failing fixtures** (triage/digest classifier tests on a post-reap `status --json` shape):

```text
BGR-DIGEST-SINCE-LAST   digest reads/writes .delivery-digest-last-seen (timestamp in the coordinator state dir);
                        "since you last looked" section lists: discards (name, one-line reason), cutover flips,
                        ceilings hit, and SELF-RATIFIED FID amendments (parse FID headings matching
                        /— SELF-RATIFIED \d{4}/ newer than last-seen; path from existing config).
BGR-TRIAGE-NO-CORPSES   the superseded-corpse bucket is GONE; tombstones never classify; parked classifies only as
                        genuine waits (concurrency/deploy) or escalations per the new governance.
```

- [ ] **Step 2–4: Fail → implement → verify.** Update both `SKILL.md`s: delivery-status gains the digest section; delivery-review reorients from "draft ratifiable FID amendments" to "walk the retroactive digest; surface perimeter items only".
- [ ] **Step 5: Commit.** `git commit -am "feat(delivery): retroactive-review digest; triage drops superseded-corpse bucket"`

### Task 8: Docs + governance switchover (after Task 0 ratification)

**Files:** headspace `spice/projects/sauce/docs/prompts/run loose prompt.md`; headspace `spice/projects/sauce/docs/roadmap/Board Glossary.md` (new); `Docs/agent-guides/delivery-board.md` (new); `CLAUDE.md` router line.

- [ ] **Step 1: Write the sauce Board Glossary** — adapt ERO's (`ero-sauce/spice/projects/ero-egnyte-mcp/docs/roadmap/Board Glossary.md`) verbatim structure: topology, lanes, card anatomy, evidence conventions, who-does-what; sauce-specific: coordinator is the writer, receipts chain, discard/tombstone semantics, the perimeter rule.
- [ ] **Step 2: Rewrite the run-loose prompt.** Replace the PRE-AUTHORIZATIONS block's per-family carve-outs with universal law. New skeleton (full text to be finalized against the ratified amendment):

```text
RUN-LOOSE SESSION (THE ENGINE). Orient, repair, execute continuously until a hard stop.
PHASE 0: read FID (newest wins); coordinator status --json; repair unambiguous drift by
exact-card reconcile; session log; resume any satisfied-parked card first.
PHASE 1 (loop): claim = frontier slice of the top In Planning EPIC (read its epic board;
epics never claim). Full path per slice: worktree → implement → tests → Gate B → three
lenses → PR → CI → release → brew → three-vault deploy → reconcile → receipts.
UNIVERSAL LAW (all families): implementation refutation → one repair → auto-supersede
(mint discards predecessor; carried findings become binding fixtures — intake enforces).
Single-writer threat-model bound applies. Absolute ceiling: 5 siblings, non-resetting →
AUTO-DECOMPOSE into sub-slices (double-ceiling or indivisible = architecture stop →
DESIGN FALLBACK). Design Fallback SELF-RATIFIES: draft the FID amendment, pass the design
quorum (direction-fit, soundness, bounded-risk), mark SELF-RATIFIED <date>, continue;
it enters the retroactive digest. Cannot touch the CONSTITUTION (one law; Gate B + three
lenses + receipts; perimeter rule; host stays suspended — Will-initiated only).
Not-worth-finishing (quorum judges cost > value): DISCARD with justification → digest.
NEVER IDLE: prefer the top-priority epic; pull any claimable slice from any epic rather
than stall. PERIMETER: prepare but never fire public publication, new credential scopes,
or spending. Never hand-edit boards/cards; coordinator + card-intake are the only writers.
HARD STOPS: genuinely drained frontier (nothing claimable/decomposable/resumable in ANY
epic); ambiguous authority failing closed; usage window. Final report: phone-sized, digest
first.
```

- [ ] **Step 3: Write `Docs/agent-guides/delivery-board.md`** (epic topology, discard semantics, reap/restructure/cutover commands, digest) and add the router line to `CLAUDE.md`'s Further-reading list.
- [ ] **Step 4: Commit** workshop docs: `git commit -am "docs(agent-guides): delivery board topology and discard governance guide"`. Vault docs save in Obsidian (no repo commit).

### Task 9: The cleanup pass (post-deploy runbook — run once, after Tasks 1-7 are DEPLOYED via brew and Task 0 is accepted)

- [ ] **Step 1: Take the turn lock.** Verify no autoloop session is live (`.autoloop-lock`), and disable the scheduled loop for the window.
- [ ] **Step 2: Baseline.** `coordinator status --json` → zero projection problems, zero drift. Any drift: fix by exact-card reconcile first.
- [ ] **Step 3: Reap.** `coordinator reap --json` (first with `--dry-run` if implemented, inspect the receipt: expect ~50 corpse discards, 34 stub strips, dupes) then apply; replay → `no_op:true`. Then `reap --also` the host-evidence + shelved-lineage names from spec §2 (GA-OPS4b, A5, LH1, LH3, LH3b, GA-OPS10a, GA-OPS10b, GA-C2a, GA-C2b, GA-C9a, GA-C9a2, GA-C9a3, GA-F3a, ES2, ES2b).
- [ ] **Step 4: Restructure.** Author `restructure-spec.json` mapping the ~90 flat planning cards into the family epics (spec §1 table is the guide; Executor judgment on boundaries). `coordinator restructure --spec … --json`; replay → `no_op:true`.
- [ ] **Step 5: Cutover.** `coordinator cutover --json` → enabled (its criteria are green by construction).
- [ ] **Step 6: Final.** Full reconcile ×2 (second = zero drift, no_op); ES4b-a audit clean; release the turn lock; re-enable the loop; regenerate cycle-status; verify the board visually in Obsidian (epics-only In Planning, empty In Progress, clean lanes).

---

## Self-review (run after writing — done 2026-07-25)

- **Spec coverage:** §1→Tasks 1/5/8; §2→Tasks 2/3/4; §3→Tasks 0/6/7/8 (generalized machinery + self-ratify live in the FID amendment + prompt, which is where governance lives — no code change needed for the quorum itself since reviews are model-run); §4→Task 9; §5→Tasks 4/7/8; §6→every task's fixtures; §7/§8→Tasks 0/9 ordering. No gaps.
- **Placeholder scan:** fixture blocks are contracts (names + exact expected behavior) rather than full harness code where the harness's temp-vault builders must be reused — the builders exist in the named files; each fixture states its assertion precisely. Prompt text in Task 8 is explicitly a skeleton pending the ratified amendment wording. Acceptable; no TBDs remain.
- **Type consistency:** `commandDiscard`/`commandReap`/`commandRestructure`/`commandCutover`, `removeBoardCard`, tombstone field names, and the `waiting` bucket are used consistently across Tasks 1-7 and the Task 9 runbook.
