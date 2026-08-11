# amend-contract epic-ledger blindness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `amend-contract` stops refusing epic-native cards on a zero-drift board, and the class of bug that caused it becomes unrepresentable.

**Architecture:** `commandAmendContract` builds its epic surface with an empty ledger, so completed sibling slices get demoted and produce a phantom drift finding. Thread the real ledger through, make a missing ledger fail closed instead of defaulting to `{ cards: {} }`, name the finding in the refusal, and add a source-level guard plus a `/loop:plan` authoring rule.

**Tech Stack:** Node.js (CommonJS, no test framework — `platform/test/run-codex-autoloop.js` is a straight-line script using `ok`/`eq`/`assert.rejects` helpers).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-11-amend-contract-epic-ledger-design.md`. Read it first.
- Base is v0.285.1. Baseline before any change: `npm run test:codex-autoloop` → **2923 assertions, PASS**.
- Conventional commits. `fix:` on the coordinator change so the release pipeline ships it.
- **Never** hand-edit versions, tags, pins, the release PR, or the tap — the bumper is fully automatic.
- No comments in config/manifest files. Code comments follow the surrounding file's density (the coordinator comments heavily on *why*, and that is the local idiom — match it).
- Everything lands in the current worktree, branch `worktree-fix-amend-contract-epic-blind-drift`.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `scripts/autoloop/codex-coordinator.js` | coordinator | Modify — ledger contract, callsite fix, refusal message |
| `platform/test/run-codex-autoloop.js` | coordinator harness | Modify — 3 new test groups |
| `plugins/loop/skills/plan/SKILL.md` | `/loop:plan` skill body | Modify — touch-zone completeness rule |

---

### Task 1: Make a missing ledger fail closed

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js:2177` (guard), `:2251` (return), `:2275` (roll-up), `:5809` + `:6048` (topology-only callers)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `canonicalEpicProjection(cardRaw, cardPath, parentBoardPath, cardsRoot, opts)` now **requires** `opts.state` (a ledger object with a `cards` map) **or** `opts.topologyOnly === true`. `surface.state` is `null` when built topology-only. `deriveEpicProjection(surface, currentCard, currentStatus)` throws on a `null` `surface.state`. Task 2 and Task 3 both depend on this contract.

- [ ] **Step 1: Write the failing test**

Add near the `AD-ADOPT` block (which already builds a surface via `makeEpicProjectionFixture`), around `platform/test/run-codex-autoloop.js:11760`:

```js
// EPIC-LEDGER-FAIL-CLOSED — a surface built without an explicit ledger must
// refuse to roll up rather than silently treating every sibling as untracked
// (which demotes completed siblings and invents drift). See
// docs/superpowers/specs/2026-08-11-amend-contract-epic-ledger-design.md.
{
  const fx = makeEpicProjectionFixture('ledger-fail-closed');
  const noteRaw = fs.readFileSync(fx.cardPath, 'utf8');
  assert.throws(
    () => coordinator.canonicalEpicProjection(noteRaw, fx.cardPath, fx.parentBoardPath, fx.cardsRoot, {}),
    /requires an explicit ledger/,
    'EPIC-LEDGER-FAIL-CLOSED canonicalEpicProjection refuses a stateless build',
  );
  const topology = coordinator.canonicalEpicProjection(
    noteRaw, fx.cardPath, fx.parentBoardPath, fx.cardsRoot, { topologyOnly: true },
  );
  ok(topology && topology.members.includes('A1'),
    'EPIC-LEDGER-FAIL-CLOSED topologyOnly still reads members');
  eq(topology.state, null, 'EPIC-LEDGER-FAIL-CLOSED topologyOnly carries no ledger');
  assert.throws(
    () => coordinator.deriveEpicProjection(topology, null, null),
    /requires an explicit ledger/,
    'EPIC-LEDGER-FAIL-CLOSED the roll-up refuses a stateless surface',
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:codex-autoloop`
Expected: FAIL — `canonicalEpicProjection` currently returns a surface with `state: { cards: {} }` instead of throwing.

- [ ] **Step 3: Write minimal implementation**

In `canonicalEpicProjection`, insert **after** the `type !== 'slice'` early return at line 2177 (so non-slice cards keep returning `null` harmlessly):

```js
  if (scalarField(cardRaw, 'type') !== 'slice') return null;
  // A ledger is the authority for sibling slice status. Defaulting it to an
  // empty map made every sibling look untracked, which demoted any completed
  // sibling and invented drift no command could clear. Callers that only need
  // topology (members/paths) say so explicitly instead.
  if (!opts.state && opts.topologyOnly !== true) {
    throw new Error('canonical epic projection requires an explicit ledger, or topologyOnly: true');
  }
```

Change the return at line 2251:

```js
    cardsRoot: root, physicalBoardDir, state: opts.state || null,
```

In `deriveEpicProjection`, as the first statement at line 2275:

```js
function deriveEpicProjection(surface, currentCard, currentStatus) {
  if (!surface.state) throw new Error('epic roll-up requires an explicit ledger');
```

Mark the two topology-only callers. Line 5809:

```js
    const surface = canonicalEpicProjection(
      fs.readFileSync(firstTarget, 'utf8'), firstTarget, boardPath, cardsRoot,
      { currentCard: members[0], topologyOnly: true },
    );
```

Line 6048:

```js
      surface = canonicalEpicProjection(
        fs.readFileSync(firstMove.to, 'utf8'), firstMove.to, journal.board, journal.cards_root,
        { currentCard: firstMove.card, topologyOnly: true },
      );
```

- [ ] **Step 4: Run the full suite**

Run: `npm run test:codex-autoloop`
Expected: PASS. Assertion count rises from 2923 by the 4 new assertions.

If anything else fails, a callsite you have not marked is building a stateless surface — find it and decide whether it needs a real ledger (fix the caller) or is topology-only (mark it). Do not silence the guard.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "fix(coordinator): require an explicit ledger to build an epic surface"
```

---

### Task 2: Thread the ledger into amend-contract and name the refusal

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js:3771-3773` and a new helper beside `projectionBoardDrift`
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: Task 1's ledger contract.
- Produces: `describeBoardDriftFinding(finding) -> string`. Module-internal; no export needed.

- [ ] **Step 1: Write the failing test**

The existing `makeAmendFixture` builds a card with **no `type: slice`**, so it never builds an epic surface — which is exactly why this bug shipped untested. You must build an **epic-native** amend fixture.

Add a `makeEpicAmendFixture(opts = {})` helper near `makeAmendFixture` (~line 5341) that combines the two existing patterns:

- Epic topology exactly as `makeEpicProjectionFixture` builds it (line 3422): `spice/projects/test/` project root, `tasks/Epic A/` epic root with `Epic A.md` atlas, `board/Epic A-board.md`, and a `context/runs/` directory. All four are required by `canonicalEpicProjection`.
- **Target slice `A1`** — `type: slice`, `kanban_column: In Progress`, `status: in_progress`, plus the execution-contract frontmatter `makeAmendFixture` writes (`touch_zones`, `deploy_subscriptions`, `model_profile`, `execution_mode`, `batch_policy`). Ledger record `phase: 'implementing'` with `branch`, `worktree`, `card_path`, `projection_reconciled_at`.
- **Sibling slice `A2`** — this is the trigger. Note says `status: completed`; it sits in the epic board's `## Completed` column checked (`- [x] [[A2]]`). Ledger record:

```js
state.cards.A2 = {
  card: 'A2', phase: 'adopted', parent_card: 'Epic A',
  card_path: path.join(epicBoardDir, 'A2.md'),
  adoption: { pr: 4, merge_sha: 'abc123', reason: 'shipped outside the loop', verified: 'git', adopted_at: '2026-08-01T00:00:00.000Z' },
};
```

Use `adoption` rather than `phase: 'deployed'` + `vault_receipts`: `resolveSliceAuthority`'s adopted tier returns `completed` without needing deployment receipts, so the fixture does not have to model `VAULTS`.

- Atlas and parent board must already agree with the derived roll-up, or an unrelated finding masks the test. With `A1` in progress the lifecycle is `active`: atlas `status: active`, `posture: claimable`, and `[[Epic A]]` unchecked in the parent board's `## In Progress`. Reuse `assertEpicProjectionConverged` (line 3472) as the reference for what converged looks like.
- Reuse `makeAmendFixture`'s `deps` block verbatim (`readState`/`writeState`/`withLock`/`worktreeExists`/`sh` stubs, `boardPath`, `cardsRoot`, `now`) and its `args` shape, retargeted to card `A1`. Note `deps.boardPath` must be the **parent** board path — `projectionBoardDrift` derives the epic board itself.

The helper must return at least: `{ root, cardsRoot, parentBoardPath, epicBoardPath, atlasPath, cardPath, worktree, state, args, deps }`. `epicBoardPath` is used by the drift-direction assertion below.

Then the assertions:

```js
// AMEND-EPIC-LEDGER — amend-contract must judge board drift against the real
// ledger. Building the epic surface statelessly demoted the completed sibling
// A2 to a legacy completion and refused an amendment on a board that `status`
// reported, at the same instant, as clean.
{
  const fx = makeEpicAmendFixture();
  const result = await commandAmendContract({ root: fx.root }, fx.args, fx.deps);
  eq(result.action, 'contract-amended',
    'AMEND-EPIC-LEDGER an epic-native card amends against a converged epic surface');
  ok(result.touch_zones.includes('platform/manifest.json'),
    'AMEND-EPIC-LEDGER the requested zone lands in the amended contract');
}

// The opposite direction: real drift still refuses, and the refusal now names
// the finding instead of discarding it.
{
  const drifted = makeEpicAmendFixture();
  const board = fs.readFileSync(drifted.epicBoardPath, 'utf8');
  fs.writeFileSync(drifted.epicBoardPath, board.replace('- [ ] [[A1]]', '- [x] [[A1]]'));
  await assert.rejects(
    () => commandAmendContract({ root: drifted.root }, drifted.args, drifted.deps),
    /target board projection must be reconciled before amendment: A1: /,
    'AMEND-EPIC-LEDGER real drift still refuses and the refusal names the finding',
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:codex-autoloop`
Expected: FAIL on the first block — `amend-contract` throws `target board projection must be reconciled before amendment` because `A2` is demoted against the empty ledger.

Expect to iterate on fixture convergence here. If the failure names an *epic surface* or *atlas* mismatch rather than the sibling demotion, the fixture is not converged yet — fix the atlas/parent-board/column state until the only remaining failure is the demotion, then proceed. A quick way to see the finding: temporarily call `coordinator.projectionBoardDrift(boardRaw, record, { boardPath, cardsRoot, state, allFindings: true })` and print it.

- [ ] **Step 3: Write minimal implementation**

Add the formatter immediately after `projectionBoardDrift` ends (line 2896):

```js
// Board-drift findings come in two shapes: most carry a prose `issue`, but the
// plain column/checked mismatch carries only expected/actual fields. A refusal
// that names neither is a dead end for the operator.
function describeBoardDriftFinding(finding) {
  const card = finding.card || '(unknown card)';
  if (finding.issue) return `${card}: ${finding.issue}`;
  return `${card}: board placement differs (expected ${finding.expected_column}/${finding.expected_checked}, `
    + `actual ${finding.actual_column}/${finding.actual_checked})`;
}
```

Replace lines 3771-3773:

```js
    const boardProblem = projectionBoardDrift(boardRaw, record, {
      boardPath, cardsRoot: deps.cardsRoot || CARDS_ROOT, state, allFindings: true,
    });
    if (boardProblem) {
      const findings = Array.isArray(boardProblem) ? boardProblem : [boardProblem];
      throw new Error('target board projection must be reconciled before amendment: '
        + findings.map(describeBoardDriftFinding).join('; '));
    }
```

`allFindings: true` makes the return `object | array`; the normalization is load-bearing, not defensive.

- [ ] **Step 4: Run the full suite**

Run: `npm run test:codex-autoloop`
Expected: PASS.

Existing amend tests that assert on the old bare refusal string will need their matcher widened — the message is now a prefix. Update the matcher, never the behavior.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "fix(coordinator): judge amend-contract board drift against the real ledger"
```

---

### Task 3: Guard the callsite class in the harness

**Files:**
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: Task 1's `topologyOnly` opt.
- Produces: nothing.

Runtime fail-closed only fires on a path a test exercises. This catches a stateless callsite nobody has run.

- [ ] **Step 1: Write the test**

Place beside the existing source-level invariant at line 4487, which is the precedent for this style:

```js
// EPIC-SURFACE-LEDGER — every construction of an epic surface must declare its
// ledger intent. Landmine #33: gate every copy, not just the one in the bug
// report. Runtime fail-closed cannot catch a callsite no test exercises.
{
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/autoloop/codex-coordinator.js'), 'utf8');
  const callsites = [];
  const needle = 'canonicalEpicProjection(';
  for (let index = source.indexOf(needle); index !== -1; index = source.indexOf(needle, index + 1)) {
    if (/[\w.]/.test(source[index - 1] || '')) continue;          // skip `function canonicalEpicProjection(`
    let depth = 0;
    let end = index + needle.length - 1;
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')' && --depth === 0) break;
    }
    callsites.push({
      line: source.slice(0, index).split('\n').length,
      args: source.slice(index, end + 1),
    });
  }
  ok(callsites.length >= 6, 'EPIC-SURFACE-LEDGER finds the epic-surface callsites');
  const stateless = callsites.filter((site) => !/\bstate\b/.test(site.args) && !/topologyOnly:\s*true/.test(site.args));
  eq(stateless.map((site) => site.line), [],
    'EPIC-SURFACE-LEDGER every epic-surface callsite passes a ledger or declares topologyOnly');
}
```

The character-before check skips property access (`coordinator.canonicalEpicProjection(`). It does **not** skip the `function canonicalEpicProjection(` definition, whose preceding character is a space. That is harmless — the definition's argument text contains `opts = {}` and would be reported as stateless. So explicitly skip it:

```js
    if (source.slice(Math.max(0, index - 9), index) === 'function ') continue;
```

Confirm empirically in Step 2 rather than trusting either claim: print `callsites.map((s) => s.line)` once and check the list against `grep -n 'canonicalEpicProjection(' scripts/autoloop/codex-coordinator.js`.

- [ ] **Step 2: Run and verify it passes and actually bites**

Run: `npm run test:codex-autoloop`
Expected: PASS.

Then prove it is not vacuous — temporarily strip `topologyOnly: true` from the line 5809 callsite, re-run, and confirm `EPIC-SURFACE-LEDGER` fails naming that line. Restore it.

- [ ] **Step 3: Commit**

```bash
git add platform/test/run-codex-autoloop.js
git commit -m "test(coordinator): assert every epic-surface callsite declares its ledger intent"
```

---

### Task 4: Touch-zone completeness in `/loop:plan`

**Files:**
- Modify: `plugins/loop/skills/plan/SKILL.md:19` (slicing rule 1) and `:34` (mint step 1)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

`PVR-X1b` was minted declaring `SyncBadge.tsx`, `sync-badge.test.tsx`, and `home.test.tsx`, but its implementation asserts against `app/tests/ui/primitives.test.tsx`. The slice did not *create or modify* that file in the author's model — it *asserted against* it. That under-declaration is what forced the amendment this plan unblocks.

- [ ] **Step 1: Extend slicing rule 1**

Replace line 19:

```markdown
1. Map the file structure first: which files each slice creates, modifies, or whose assertions it depends on — one clear responsibility per file. A test file a slice extends or asserts against is a touch zone even when the slice "only adds a case". Decomposition is locked here, not during implementation.
```

- [ ] **Step 2: Add the completeness check to mint step 1**

Append to the end of the sentence at line 34, after `batch policy from `config.policy``:

```markdown
   Before the dry-run, check touch-zone completeness: every file named in a slice's acceptance tests must appear in that slice's `touch_zones`. A slice that asserts against a file it does not declare is not mintable — widen the zones or move the assertion. The rail validates board schema and cannot infer file paths from prose, so this check lives here, where the acceptance text and the zone list are both in hand.
```

- [ ] **Step 3: Verify the skill body still parses as a valid skill**

Run: `npm run test:loop-plugin-surface && npm run test:loop-codex-routers`
Expected: PASS. These are the suites that cover the loop skill surface and the generated Codex routers — `test:codex-autoloop` does not.

Also confirm no marker regions were disturbed:

```bash
git diff plugins/loop/skills/plan/SKILL.md
```

Expected: exactly two changed hunks, both prose.

- [ ] **Step 4: Commit**

```bash
git add plugins/loop/skills/plan/SKILL.md
git commit -m "docs(loop): require touch-zone completeness when planning slices"
```

---

### Task 5: Full verification and PR

- [ ] **Step 1: Run the complete preflight**

Run: `npm run release:preflight`
Expected: PASS. This is a concurrent manifest, not a chain — read the summary for per-check status rather than assuming the first failure is the only one.

- [ ] **Step 2: Confirm the assertion count moved**

Run: `npm run test:codex-autoloop`
Expected: PASS, assertion count > 2923.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin worktree-fix-amend-contract-epic-blind-drift
gh pr create --title "fix(coordinator): judge amend-contract board drift against the real ledger" --body "$(cat <<'EOF'
## Problem

`amend-contract` refused with `target board projection must be reconciled before amendment` on a board that `status` reported, at the same instant, as having zero drift. No command could clear it, so any epic-native card needing a mid-flight contract amendment was stuck.

## Root cause

`commandAmendContract` called `projectionBoardDrift(boardRaw, record)` with no options, though `boardPath`, `state`, and `deps.cardsRoot` were all in scope. `canonicalEpicProjection` defaulted `state` to `{ cards: {} }`, so every *sibling* slice resolved `hasRecord: false`, authority fell to the slice note, and `resolveSliceAuthority` demoted any sibling whose note said `status: completed` — producing a `legacyCompletionFinding` that `commandStatus` (which passes the real ledger) never sees.

Note this corrects an earlier diagnosis that blamed a project-vs-epic board mixup. `projectionBoardDrift` builds the epic surface internally regardless of opts; `boardPath`/`cardsRoot` fall back to the same globals in production. **`state` was the load-bearing omission.**

## Changes

- Thread `{ boardPath, cardsRoot, state, allFindings: true }` into the drift check.
- `canonicalEpicProjection` now **requires** an explicit ledger or `topologyOnly: true`; `deriveEpicProjection` refuses a stateless surface. The two restructure callers that only read `surface.members` declare `topologyOnly`.
- The refusal now names its finding, matching the metadata refusal directly above it, which already did.
- `/loop:plan` requires touch-zone completeness at mint — a slice must declare every file its acceptance tests assert against. Under-declaration is what forced the amendment that exposed this.

## Tests

- `AMEND-EPIC-LEDGER` — an epic-native card with a completed sibling amends successfully; real drift still refuses and the refusal names the finding. Fails against unmodified source.
- `EPIC-LEDGER-FAIL-CLOSED` — a stateless surface refuses to roll up.
- `EPIC-SURFACE-LEDGER` — source-level guard: every epic-surface callsite passes a ledger or declares `topologyOnly`. Catches a callsite no test exercises (landmine #33).

Existing `amend-contract` tests used a card with no `type: slice`, so they never built an epic surface — which is why this shipped.

Design: `docs/superpowers/specs/2026-08-11-amend-contract-epic-ledger-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014a3imPb1mJQPVCUkpsX3Xj
EOF
)"
```

- [ ] **Step 4: Watch CI to green**

```bash
gh pr checks --watch
```

Expected: all checks pass. If a check fails, read the log, fix the cause, push, and re-watch. Do not merge — the release pipeline owns that.
