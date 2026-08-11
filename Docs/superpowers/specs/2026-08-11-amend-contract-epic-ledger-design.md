# amend-contract epic-ledger blindness — design

**Date:** 2026-08-11
**Base:** v0.285.1 (`3f6fb748`)
**Status:** approved, ready to plan

## Problem

`amend-contract` refuses with `target board projection must be reconciled before amendment`
against a board that `status` reports, at the same instant, as having zero drift. No command
clears it, so a card that needs a contract amendment mid-flight is stuck.

Observed on the live finance board: `PVR-X1b` was parked wanting
`app/tests/ui/primitives.test.tsx` added to its `touch_zones`, could not be amended, and had
to be resumed without it.

## Root cause

`commandAmendContract` (`scripts/autoloop/codex-coordinator.js:3772`) calls:

```js
const boardProblem = projectionBoardDrift(boardRaw, record);
```

with no options, though `boardPath`, `state`, and `deps.cardsRoot` are all in scope.

`canonicalEpicProjection` (line 2176) ends with `state: opts.state || { cards: {} }`, so the
epic surface is built against an **empty ledger**. In `deriveEpicProjection` (line 2274), every
*sibling* slice then resolves `tracked === undefined` → `hasRecord: false`. Authority falls to
the slice note, and `resolveSliceAuthority`
(`platform/mechanisms/delivery/scripts/delivery-topology.js:54`) demotes any sibling whose note
says `status: completed`:

```js
const base = boardStatus;
const demoted = base === 'completed' && Boolean(boardIsSlice);
```

The demotion pushes a `legacyCompletionFinding`, `deriveEpicProjection` returns a non-empty
`findings`, and `projectionBoardDrift` returns it — the refusal.

`commandStatus` (line 6580) passes `{ boardPath, cardsRoot, state, allFindings: true }`, so the
same sibling resolves `hasRecord: true, doneProven: true` and no finding fires. Same card, same
instant, opposite verdicts.

### Why the finance board triggered it

`PVR-X1a` is `deployed` with `status: completed` on its note. The finance binding sets
`deploy_vaults: []`, so `successfulDeploymentReceipts` returns `VAULTS.every(...)` over an empty
array — vacuously `true`. With the real ledger X1a is proven done; with an empty one it is a
demoted legacy completion.

### Correction to the prior diagnosis

The handoff recorded this as "`amend-contract` checks the **project** board instead of the epic
sub-board." That is wrong. `projectionBoardDrift` builds the epic surface internally regardless
of opts (line 2839). `boardPath` and `cardsRoot` fall back to the same module globals in
production and are cosmetic here. **`state` is the load-bearing omission.**

## Blast radius (verified)

Every other path already supplies a ledger:

| Callsite | Passes state? |
| --- | --- |
| `codex-coordinator.js:2524` (audit) | yes — `{ state }` |
| `:2702` (`projectCard`, spreads `...opts`) | yes — all three callers (2812, 7061, 7104) pass `state` |
| `:2839` (`projectionBoardDrift`) | forwards `opts.state` |
| `:4437` | yes — `{ state, currentCard }` |
| `:5043` | yes — `{ state: { cards } }` |
| `:5809` (restructure precheck) | no — topology-only, never calls `deriveEpicProjection` |
| `:6048` (restructure verify) | no — topology-only, never calls `deriveEpicProjection` |
| `run-codex-autoloop.js:11755` (`AD-ADOPT`) | yes — `{ state }` |

`deriveEpicProjection` is the **sole** reader of `surface.state` (one hit, line 2287). Failing
closed there is therefore safe: the only affected callsite is the buggy one.

## Design

Three coordinated changes plus two hardening additions. One source file, one test file, one
skill file.

### 1. Fix the callsite

```js
const boardProblem = projectionBoardDrift(boardRaw, record, {
  boardPath, cardsRoot: deps.cardsRoot || CARDS_ROOT, state, allFindings: true,
});
```

### 2. Fail closed on a missing ledger

Intent is declared at each callsite rather than tracked in a line-number allowlist, which would
drift:

```js
// canonicalEpicProjection — AFTER the `type !== 'slice'` early return, so
// non-slice cards keep returning null harmlessly rather than throwing.
if (!opts.state && opts.topologyOnly !== true) {
  throw new Error('canonical epic projection requires an explicit ledger, or topologyOnly: true');
}
// ...and at the return
state: opts.state || null,
```

```js
// deriveEpicProjection, first statement
if (!surface.state) throw new Error('epic roll-up requires an explicit ledger');
```

The two restructure callsites (5809, 6048) gain `topologyOnly: true`. They read only
`surface.members`.

`projectionBoardDrift` already wraps `deriveEpicProjection` in try/catch, so a future omission
surfaces as a legible `canonical epic roll-up refusal: …` finding rather than an uncaught crash.

### 3. Name the cause in the refusal

The metadata refusal two lines above already includes its cause; the board-drift refusal computes
a fully-populated finding and discards every field. That opacity is why diagnosis was expensive.

`allFindings: true` makes the return `object | array`, so normalize before formatting:

```js
function describeBoardDriftFinding(finding) {
  const card = finding.card || '(unknown card)';
  if (finding.issue) return `${card}: ${finding.issue}`;
  return `${card}: board placement differs (expected ${finding.expected_column}/${finding.expected_checked}, `
    + `actual ${finding.actual_column}/${finding.actual_checked})`;
}
```

```js
if (boardProblem) {
  const findings = Array.isArray(boardProblem) ? boardProblem : [boardProblem];
  throw new Error('target board projection must be reconciled before amendment: '
    + findings.map(describeBoardDriftFinding).join('; '));
}
```

Finding shapes vary — `{card, phase, expected_column, actual_column, expected_checked,
actual_checked}` carries no `issue` field, so the formatter must handle both.

### 4. Structural guard (`EPIC-SURFACE-LEDGER`)

A source-level invariant test over `codex-coordinator.js`: walk every `canonicalEpicProjection(`
callsite and assert each passes either `state` or `topologyOnly: true`. Precedent for
source-level assertions in this harness is `run-codex-autoloop.js:4488`, which counts matches to
enforce a one-copy-only invariant.

This catches a callsite no test exercises, which the runtime fail-closed cannot.

### 5. Touch-zone completeness in `/loop:plan`

`plugins/loop/skills/plan/SKILL.md` slicing rule 1 currently reads *"which files each slice
creates or modifies."* That framing is how `PVR-X1b` lost `primitives.test.tsx`: the slice did
not create or modify it, it *asserted against* it.

- **Rule 1** — extend to files a slice creates, modifies, **or whose assertions it depends on**.
  A test file the slice extends is a touch zone even when the slice "only adds a case."
- **Mint step 1** — add a completeness check: every file named in a slice's acceptance tests must
  appear in that slice's `touch_zones`, or the slice is not mintable. Checkable mechanically
  against the spec JSON before the dry-run.

The gate lives in the skill, not the `intake` binary: the rail validates board *schema* and
cannot know which files a prose acceptance test will touch. The skill holds both the prose and
the zone list.

## Tests

`platform/test/run-codex-autoloop.js`, following `PARK-AUDIT-PROJECTION`'s both-directions
precedent. Baseline before any change: **2923 assertions, PASS**.

1. **`AMEND-EPIC-LEDGER` — the regression anchor.** Epic with two slices; sibling `deployed` with
   `status: completed` on its note; target card `implementing`. `amend-contract` **succeeds**.
   Must fail against unmodified source.
2. **Real drift still refuses**, and the message names the finding — asserted by regex, not exact
   string.
3. **Fail-closed unit.** `deriveEpicProjection` on a surface built without `state` throws.
4. **`EPIC-SURFACE-LEDGER`** — the source-level callsite guard from §4.

## Out of scope

- The `/loop:plan` completeness check is **skill prose plus a mint-time check**, not enforcement
  in the `intake` binary. Binary enforcement is a separate, larger slice.
- `state` does not become a required positional argument of `canonicalEpicProjection`. It would
  be a stronger guarantee but forces the restructure callers to source a ledger they have no use
  for, changing an 8-callsite signature to fix a 1-callsite bug.
- **§4b of the handoff** — the Director call on whether `app/tests/ui/primitives.test.tsx`
  belongs in `PVR-X1b`'s slice, and the finance-side amend + resume. Both blocked on this fix
  reaching brew; they are follow-on work in a different repo.
- `parkedAmendmentProblem` and the `projectionMetadataProblem` call above the bug. Both already
  thread correctly.

## Release

Conventional `fix:` commit. Versioning, tagging, pin sweeps, and the release PR are fully
automatic — hands off.
