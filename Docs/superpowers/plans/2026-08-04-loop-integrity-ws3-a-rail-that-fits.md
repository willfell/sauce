# Loop integrity WS3 — a rail that fits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give out-of-band slice completion a sanctioned, provenance-carrying home (`adopt`), make `board-health` able to tell rail-leaving from cross-clone residue, and detect non-coordinator writers instead of pretending a repo-local lock excludes them.

**Architecture:** Three independent seams. (1) `delivery.topology.resolveSliceAuthority` gains a third source, `adopted`, so an evidence-backed completion is projectable without weakening `doneProven`. (2) A new coordinator verb `adopt` verifies a merge SHA against git and a PR against `gh`, then writes one ledger record. (3) Preimage hashing detects foreign writes — reported for card projection, fail-closed for the three bulk-rewrite verbs.

**Tech Stack:** Node (CommonJS, built-ins only in the delivery mechanism), `scripts/autoloop/codex-coordinator.js`, `scripts/autoloop/cli-kit.js`, hand-rolled assertion harnesses under `platform/test/` run via `npm run release:preflight`.

**Spec:** [`Docs/superpowers/specs/2026-08-04-loop-integrity-ws3-a-rail-that-fits-design.md`](../specs/2026-08-04-loop-integrity-ws3-a-rail-that-fits-design.md)

## Global Constraints

- **Branch:** `ws3-a-rail-that-fits`, already created off `main` with the spec committed. One workstream, one branch, one PR.
- **No vault writes in this cycle.** No task here writes to `~/obsidian/*`. All fixtures are temp dirs.
- **Never hand-version, hand-tag, or edit the tap.** The release pipeline owns all of it.
- **The PR title decides the release bump** under squash-merge. Run `npm run release:check-bump` before opening the PR. Highest expected bump for this cycle is `feat` (new `adopt` verb) → minor.
- **No `Co-authored-by: Claude` trailer** on any commit. Conventional-commit subjects only.
- `platform/mechanisms/delivery/scripts/delivery-topology.js` is **Node built-ins only** — it is loaded by restricted sandbox loaders. Do not add `require` calls to it.
- `platform/test/run-sticky-notes-render-guards.js` fails ~50% on unmodified `main` (`PERF-7-HARNESS`). If preflight goes red there, re-run to confirm the flake; do NOT fix it in this cycle.
- Capture suite exit codes directly — `npm run release:preflight > log 2>&1; echo $?`. Never pipe through `tail`; the pipeline exit code is tail's and a red suite reads as green.
- Staging under `scripts/`: tracked files need `git add -u`, new files need `git add -f` (landmine #30 — `/Scripts/` ignore case-folds onto `scripts/` on APFS).
- Every new refusal code is emitted through `cli-kit`'s `refuse(action, code, message)` **before any mutation**.
- Existing receipt keys are additive-only and must stay consumer-compatible.

---

## File Structure

| File | Disposition | Responsibility |
| --- | --- | --- |
| `platform/mechanisms/delivery/scripts/delivery-topology.js` | Modify | Adds the `adopted` source to `resolveSliceAuthority` and widens `assertProjectableStatus`. Stays built-ins-only. |
| `platform/test/run-delivery-topology.js` | Modify | Pins the adopted tier and the widened backstop. |
| `scripts/autoloop/codex-coordinator.js` | Modify | `adopt` verb, provenance classification in `collectBoardHealth`, `card_note_sha` in `projectCard`, `preimage_sha` in `planEpicBindingHeal` + apply guard. |
| `platform/test/run-codex-autoloop.js` | Modify | All coordinator-side assertions (AD-*, BHP-*, FW-*, CM-*). |
| `Docs/agent-guides/delivery-board.md` | Modify | `adopt` in § Coordinator operations; adopted tier in § Board vs ledger authority; § heal warning replaced by the enforced guard. |

No new files. The coordinator is already a single large module by established convention; adding a verb to it follows the pattern every other verb uses.

---

## Task 1: The `adopted` authority tier

**Files:**
- Modify: `platform/mechanisms/delivery/scripts/delivery-topology.js:54-73`
- Test: `platform/test/run-delivery-topology.js` (append before the final `console.log`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveSliceAuthority({ hasRecord, ledgerStatus, boardStatus, doneProven, boardIsSlice, adopted })` returning a frozen `{ status, doneProven, source, demoted }` where `source` is now `'ledger' | 'board' | 'adopted'`. `assertProjectableStatus(verdict)` throws unless a `completed` verdict has `doneProven === true` **or** `source === 'adopted'`. Tasks 2 and 3 rely on both.

- [ ] **Step 1: Write the failing test**

Append to `platform/test/run-delivery-topology.js`, immediately before the final `console.log(...)` line:

```js
// Adopted tier (WS3): an evidence-backed out-of-band completion is projectable
// WITHOUT ever claiming deployment proof. doneProven keeps its exact meaning.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'completed', boardStatus: 'completed', doneProven: false, boardIsSlice: true, adopted: true });
eq(v.status, 'completed', 'adopted completion does not demote');
eq(v.source, 'adopted', 'adopted completion reports the adopted source');
eq(v.doneProven, false, 'adopted is never proven done');
ok(!v.demoted, 'adopted completion is not flagged demoted');

// adopted only rescues `completed`; any other ledger status is untouched by it.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'in_progress', boardStatus: 'completed', doneProven: false, boardIsSlice: true, adopted: true });
eq(v.status, 'in_progress', 'adopted does not promote a non-completed ledger status');
eq(v.source, 'ledger', 'a non-completed adopted record still reports the ledger source');

// adopted requires a record: it can never rescue a bare board declaration.
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'completed', boardIsSlice: true, adopted: true });
eq(v.status, 'in_progress', 'adopted without a record cannot rescue a board declaration');
eq(v.source, 'board', 'adopted without a record still reports the board source');

// The backstop accepts adopted and still refuses unproven, unadopted completion.
topo.assertProjectableStatus({ status: 'completed', doneProven: false, source: 'adopted' });
throws(() => topo.assertProjectableStatus({ status: 'completed', doneProven: false, source: 'ledger' }),
  /projectable status invariant/, 'unproven ledger completion still fails the backstop');
count += 1;  // the bare accept-call above asserts by not throwing; `throws` counts itself
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node platform/test/run-delivery-topology.js; echo "exit=$?"
```

Expected: FAIL — the first new assertion reports `adopted completion does not demote` because `resolveSliceAuthority` currently ignores `adopted` and demotes the unproven `completed` to `in_progress`.

- [ ] **Step 3: Write minimal implementation**

In `platform/mechanisms/delivery/scripts/delivery-topology.js`, replace `resolveSliceAuthority` and `assertProjectableStatus` with:

```js
function resolveSliceAuthority({ hasRecord, ledgerStatus, boardStatus, doneProven, boardIsSlice, adopted } = {}) {
  if (hasRecord) {
    const proven = doneProven === true;
    const base = ledgerStatus;
    // An adopted record carries verified external provenance (PR + merge SHA)
    // instead of deployment receipts. It is projectable but NEVER proven done:
    // doneProven keeps meaning exactly "carries successful deployment receipts".
    if (adopted === true && base === 'completed') {
      return Object.freeze({ status: 'completed', doneProven: false, source: 'adopted', demoted: false });
    }
    const status = base === 'completed' && !proven ? 'in_progress' : base;
    return Object.freeze({ status, doneProven: proven, source: 'ledger', demoted: status !== base });
  }
  const base = boardStatus;
  const demoted = base === 'completed' && Boolean(boardIsSlice);
  const status = demoted ? 'in_progress' : base;
  return Object.freeze({ status, doneProven: false, source: 'board', demoted });
}

// Fail-closed backstop: a verdict projected as complete MUST be proven done or
// carry adopted provenance. Unreachable via resolveSliceAuthority; guards a
// future consumer bypassing it.
function assertProjectableStatus(verdict) {
  if (verdict && verdict.status === 'completed'
    && verdict.doneProven !== true && verdict.source !== 'adopted') {
    throw new Error('projectable status invariant: completed without proven deployment');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node platform/test/run-delivery-topology.js; echo "exit=$?"
node platform/test/run-codex-autoloop.js > /tmp/ws3-t1.log 2>&1; echo "exit=$?"; tail -1 /tmp/ws3-t1.log
node platform/test/run-card-intake.js; echo "exit=$?"
```

Expected: `DELIVERY-TOPOLOGY PASS (36 assertions)` (26 existing + 10 new: 8 `eq`, 1 `ok`, 1 `throws`, plus the manual `count += 1` for the bare accept-call), and the coordinator + card-intake harnesses unchanged and green — no existing caller passes `adopted`, so every current path is byte-identical.

- [ ] **Step 5: Commit**

```bash
git add -u platform/mechanisms/delivery/scripts/delivery-topology.js platform/test/run-delivery-topology.js
git commit -m "feat(delivery): adopted slice-authority tier for evidence-backed out-of-band completion"
```

---

## Task 2: `adopt` — operand validation and refusals

This task builds the verb's entire fail-closed perimeter with **no successful path yet**. Splitting the refusals from the write keeps the reviewer's gate meaningful: a reviewer can reject the perimeter while accepting the write, or vice versa.

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` — `STRICT_CLI_OPTIONS` (`:51`), new `commandAdopt` near `commandHealEpicBindings` (`:4493`), dispatch (`:7717`), usage string (`:7753`), `module.exports` (`:7758`)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: `resolveSliceAuthority` (Task 1) is not called here; Task 2 is pure validation.
- Produces: `commandAdopt(ctx, args, deps = {})`. `deps` seams, all optional: `readState`, `writeState`, `withLock`, `boardPath`, `cardsRoot`, `git` (a `(args, cwd) => string` shim over `sh('git', …)`), `prView` (`(repo, number, cwd) => object|null`). Task 3 adds the write path inside this same function.

- [ ] **Step 1: Write the failing test**

Append to `platform/test/run-codex-autoloop.js`, immediately before the final `console.log(...)` line. It reuses `bhScaffold` (defined at `:8313`) and `bhDeps` (`:8352`).

```js
// AD adopt: the sanctioned out-of-band completion. Every precondition refuses
// BEFORE any ledger write; the verb can only ratify a declaration already
// sitting unrecorded on the board, never invent one.
const adScaffold = (root) => bhScaffold(root, {
  progress: ['Retire ero loop'],
  epics: {
    'Retire ero loop': {
      lanes: { Completed: ['EM-4'], 'In Progress': ['EM-7'] },
      slices: { 'EM-4': 'completed', 'EM-7': 'in_progress' },
    },
  },
});
const AD_SHA = '9922ec4373e4a925829c7917912263e2c27a29e4';
const adGit = (calls = []) => (args) => {
  calls.push(args.join(' '));
  if (args[0] === 'cat-file') return '';
  if (args[0] === 'merge-base') return '';
  if (args[0] === 'rev-parse') return 'main';
  throw new Error(`unexpected git ${args.join(' ')}`);
};
const adPrView = (overrides = {}) => () => ({
  number: 126, state: 'MERGED', mergeCommit: { oid: AD_SHA }, ...overrides,
});
const adDeps = (fx, state, extra = {}) => bhDeps(fx, {
  readState: () => state,
  writeState: () => {},
  git: adGit(),
  prView: adPrView(),
  ...extra,
});
const adRefusal = async (fx, state, args, extra = {}) => {
  try {
    await coordinator.commandAdopt({ root: fx.projectRoot, statePath: path.join(fx.projectRoot, 'state.json') },
      { json: true, ...args }, adDeps(fx, state, extra));
  } catch (err) { return err; }
  return null;
};

{
  const root = path.join(tmp, 'ad-refusals');
  const fx = adScaffold(root);
  const base = { card: 'EM-4', pr: 126, 'merge-sha': AD_SHA, reason: 'batch PR' };

  // --json is mandatory before any read or write, exactly like every other
  // mutating verb.
  await assert.rejects(
    () => coordinator.commandAdopt({ root: fx.projectRoot, statePath: path.join(fx.projectRoot, 'state.json') },
      { ...base }, adDeps(fx, emptyState())),
    /requires --json/, 'AD-JSON refusal: --json is mandatory');

  // Unknown options are rejected by the shared CLI grammar before state access.
  let r = await adRefusal(fx, emptyState(), { ...base, apply: true });
  eq(r && r.code, 'unknown_option', 'AD-GRAMMAR rejects unknown options before reads or writes');

  // A card that already has a ledger record is NOT adoptable — that is what
  // stops adopt from becoming a general-purpose "mark it done" backdoor.
  const tracked = emptyState();
  tracked.cards['EM-4'] = { card: 'EM-4', phase: 'implementing' };
  r = await adRefusal(fx, tracked, base);
  eq(r && r.code, 'adopt_record_exists', 'AD-TRACKED a card with a record refuses');

  // Adoption ratifies a declaration; it never invents one.
  r = await adRefusal(fx, emptyState(), { ...base, card: 'EM-7' });
  eq(r && r.code, 'adopt_not_declared_complete', 'AD-DECLARED a non-completed note refuses');

  // A board member with no note at all cannot be adopted.
  r = await adRefusal(fx, emptyState(), { ...base, card: 'EM-404' });
  eq(r && r.code, 'adopt_card_not_found', 'AD-MISSING an unknown card refuses');

  // Provenance operands are structurally validated first.
  r = await adRefusal(fx, emptyState(), { ...base, 'merge-sha': 'deadbeef' });
  eq(r && r.code, 'adopt_sha_unreachable', 'AD-SHA-SHAPE a non-40-hex sha refuses');

  r = await adRefusal(fx, emptyState(), base, {
    git: (args) => { if (args[0] === 'cat-file') throw new Error('bad object'); return ''; },
  });
  eq(r && r.code, 'adopt_sha_unreachable', 'AD-SHA-ABSENT a sha git cannot resolve refuses');

  r = await adRefusal(fx, emptyState(), base, {
    git: (args) => { if (args[0] === 'merge-base') throw new Error('not an ancestor'); if (args[0] === 'rev-parse') return 'main'; return ''; },
  });
  eq(r && r.code, 'adopt_sha_unreachable', 'AD-SHA-UNMERGED a sha off the default branch refuses');

  r = await adRefusal(fx, emptyState(), base, { prView: adPrView({ state: 'OPEN' }) });
  eq(r && r.code, 'adopt_pr_not_merged', 'AD-PR-OPEN an unmerged PR refuses');

  r = await adRefusal(fx, emptyState(), base, {
    prView: adPrView({ mergeCommit: { oid: 'a'.repeat(40) } }),
  });
  eq(r && r.code, 'adopt_pr_mismatch', 'AD-PR-MISMATCH a PR whose merge commit is not the sha refuses');

  r = await adRefusal(fx, emptyState(), { ...base, reason: '   ' });
  eq(r && r.code, 'adopt_reason_required', 'AD-REASON an empty reason refuses');

  r = await adRefusal(fx, emptyState(), { card: 'EM-4', pr: 'nope', 'merge-sha': AD_SHA, reason: 'x' });
  eq(r && r.code, 'invalid_arguments', 'AD-PR-SHAPE a non-numeric --pr refuses');

  // Every refusal renders a valid ok:false envelope.
  eq(validateReceiptEnvelope(refusalReceipt(r.action, r.code, r.message)).ok, true,
    'AD refusals render a valid ok:false envelope');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t2.log 2>&1; echo "exit=$?"; tail -20 /tmp/ws3-t2.log
```

Expected: FAIL with `TypeError: coordinator.commandAdopt is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `scripts/autoloop/codex-coordinator.js`, add `adopt` to `STRICT_CLI_OPTIONS` (the frozen object at `:51`):

```js
  adopt: ['json', 'card', 'pr', 'merge-sha', 'reason'],
```

Add this function immediately after `commandHealEpicBindings` (which ends at `:4532`):

```js
// --- adopt (workstream 3 of the loop-integrity program).
// The sanctioned out-of-band completion. It exists because a real, sanctioned
// writer — KanbanStatusSync at vault boot — can complete any slice with one
// drag, and because a batch PR is sometimes genuinely the right shape for a
// change. Adoption gives that move verified provenance instead of leaving it
// as permanent, unreportable drift. It can ONLY ratify a declaration already
// sitting unrecorded on the board: a card with a ledger record refuses, and a
// note that does not declare completed refuses. Both guards are what keep this
// from being a general-purpose "mark it done" backdoor.
const ADOPT_SHA_RE = /^[0-9a-f]{40}$/;

function adoptProvenance(args, deps, cwd) {
  const runGit = deps.git || ((gitArgs) => sh('git', gitArgs, { cwd }));
  const sha = String(args['merge-sha'] || '').trim().toLowerCase();
  if (!ADOPT_SHA_RE.test(sha)) {
    refuse('adopt-refused', 'adopt_sha_unreachable', `--merge-sha must be a 40-hex commit sha (got "${args['merge-sha']}")`);
  }
  try { runGit(['cat-file', '-e', `${sha}^{commit}`], cwd); }
  catch (err) {
    refuse('adopt-refused', 'adopt_sha_unreachable', `merge sha ${sha} does not resolve in this repo: ${err.message}`);
  }
  let defaultBranch = 'main';
  try { defaultBranch = String(runGit(['rev-parse', '--abbrev-ref', 'origin/HEAD'], cwd) || '').trim() || 'origin/main'; }
  catch (_) { defaultBranch = 'origin/main'; }
  try { runGit(['merge-base', '--is-ancestor', sha, defaultBranch], cwd); }
  catch (err) {
    refuse('adopt-refused', 'adopt_sha_unreachable',
      `merge sha ${sha} is not an ancestor of ${defaultBranch}: ${err.message}`);
  }
  // gh is the second, independent tier. Its absence degrades the recorded
  // verification level; it never fails the verb and never passes silently as
  // full verification.
  const viewPr = deps.prView || prView;
  let pr = null;
  try { pr = viewPr(REPO, Number(args.pr), cwd); }
  catch (_) { return { sha, verified: 'git', default_branch: defaultBranch }; }
  if (!pr) return { sha, verified: 'git', default_branch: defaultBranch };
  if (pr.state !== 'MERGED') {
    refuse('adopt-refused', 'adopt_pr_not_merged', `PR ${args.pr} is ${pr.state}, not MERGED`);
  }
  const merged = String((pr.mergeCommit && pr.mergeCommit.oid) || '').toLowerCase();
  if (merged !== sha) {
    refuse('adopt-refused', 'adopt_pr_mismatch',
      `PR ${args.pr} merge commit ${merged || '(none)'} != --merge-sha ${sha}`);
  }
  return { sha, verified: 'git+gh', default_branch: defaultBranch, pr_url: pr.url || null };
}

async function commandAdopt(ctx, args, deps = {}) {
  requireOnlyOptions(args, 'adopt', STRICT_CLI_OPTIONS.adopt);
  if (args.json !== true) throw new Error('adopt requires --json for a machine-readable receipt');
  const card = args.card;
  const number = Number(args.pr);
  if (!card || !Number.isInteger(number)) {
    usage('adopt-refused', 'invalid_arguments', 'adopt requires --card and numeric --pr');
  }
  const reason = String(args.reason || '').trim();
  if (!reason) refuse('adopt-refused', 'adopt_reason_required', 'adopt requires a non-empty --reason');
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  const loadState = deps.readState || readState;
  const transitionLock = deps.withLock || withLock;
  return transitionLock(ctx, 'selector', async () => {
    const state = loadState(ctx);
    if (Object.prototype.hasOwnProperty.call(state.cards || {}, card)) {
      refuse('adopt-refused', 'adopt_record_exists',
        `card ${card} already has a ledger record; adopt only ratifies unrecorded board members`);
    }
    const notePath = findCard(cardsRoot, card);
    if (!notePath) {
      refuse('adopt-refused', 'adopt_card_not_found', `card ${card} has no note under ${cardsRoot}`);
    }
    const raw = fs.readFileSync(notePath, 'utf8');
    const noteStatus = delivery.normalizeStatus(scalarField(raw, 'status')) || 'planning';
    if (noteStatus !== 'completed') {
      refuse('adopt-refused', 'adopt_not_declared_complete',
        `card ${card} declares ${noteStatus}; adopt ratifies a completed declaration, it never invents one`);
    }
    adoptProvenance(args, deps, ctx.root);
    throw new Error('adopt write path lands in Task 3');
  });
}
```

Wire the dispatch. In `main()`, beside the `board-health` line (`:7717`):

```js
  else if (command === 'adopt') result = await commandAdopt(ctx, args);
```

Extend the usage string at `:7753` by inserting `adopt|` immediately before `board-health|`.

Add to `module.exports` (`:7758`), on the line that already exports `commandBoardHealth`:

```js
  commandBoardHealth, collectBoardHealth, commandAdopt, adoptProvenance,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t2.log 2>&1; echo "exit=$?"; tail -3 /tmp/ws3-t2.log
```

Expected: PASS. Every AD-* refusal assertion is green; no successful adopt exists yet, so nothing reaches the `Task 3` throw.

- [ ] **Step 5: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): adopt verb perimeter — verified provenance and fail-closed refusals"
```

---

## Task 3: `adopt` — the write path, replay, and epic roll-up

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` — `commandAdopt` (added in Task 2)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: `resolveSliceAuthority`'s `adopted` source (Task 1); `commandAdopt`'s perimeter (Task 2).
- Produces: a ledger record shape `{ card, phase: 'completed', adoption: { pr, merge_sha, reason, verified, adopted_at }, card_path, parent_card, slice, touch_zones, dependencies, deploy_subscriptions }`. Task 4 reads `record.adoption` to classify; Task 5's `projectCard` change writes `card_note_sha` onto it.

- [ ] **Step 1: Write the failing test**

Append to `platform/test/run-codex-autoloop.js`, after the AD-refusals block from Task 2:

```js
// AD-ADOPT — the successful path. One ledger record, verified provenance,
// permanently labeled `adopted`, and an epic that can finally roll up.
{
  const root = path.join(tmp, 'ad-adopt');
  const fx = adScaffold(root);
  const state = emptyState();
  const writes = [];
  const ctx = { root: fx.projectRoot, statePath: path.join(fx.projectRoot, 'state.json') };
  const receipt = await coordinator.commandAdopt(ctx,
    { json: true, card: 'EM-4', pr: 126, 'merge-sha': AD_SHA, reason: 'batch PR; per-slice was wrong here' },
    adDeps(fx, state, { writeState: (_c, _s, rec) => writes.push(rec), now: () => '2026-08-04T12:00:00.000Z' }));

  eq(receipt.action, 'adopt', 'AD-ADOPT reports the adopt action');
  eq(receipt.ok, true, 'AD-ADOPT succeeds');
  eq(receipt.no_op, false, 'AD-ADOPT a first adoption is never a no-op');
  eq(receipt.card, 'EM-4', 'AD-ADOPT names the adopted card');
  eq(receipt.adoption.pr, 126, 'AD-ADOPT records the PR number');
  eq(receipt.adoption.merge_sha, AD_SHA, 'AD-ADOPT records the merge sha');
  eq(receipt.adoption.reason, 'batch PR; per-slice was wrong here', 'AD-ADOPT records the reason verbatim');
  eq(receipt.adoption.verified, 'git+gh', 'AD-ADOPT records the full verification tier');
  eq(receipt.adoption.adopted_at, '2026-08-04T12:00:00.000Z', 'AD-ADOPT stamps the adoption');

  const record = state.cards['EM-4'];
  ok(record, 'AD-ADOPT writes exactly one ledger record');
  eq(record.phase, 'completed', 'AD-ADOPT the adopted record is completed');
  eq(record.adoption.verified, 'git+gh', 'AD-ADOPT provenance lives on the record, not only the receipt');
  eq(record.card_path, path.join(fx.cardsRoot, 'Retire ero loop', 'board', 'EM-4.md'),
    'AD-ADOPT binds the record to the resolved note path');
  eq(writes.length, 1, 'AD-ADOPT persists once');

  // The adopted record projects as complete — this is the whole point: the
  // epic can now roll up — while never claiming deployment proof.
  const verdict = deliveryTopology.resolveSliceAuthority({
    hasRecord: true, ledgerStatus: 'completed', boardStatus: 'completed',
    doneProven: coordinator.successfulDeploymentReceipts(record),
    boardIsSlice: true, adopted: Boolean(record.adoption),
  });
  eq(verdict.status, 'completed', 'AD-ADOPT an adopted record projects complete');
  eq(verdict.source, 'adopted', 'AD-ADOPT the adopted source is visible to every consumer');
  eq(verdict.doneProven, false, 'AD-ADOPT adoption never fabricates deployment proof');
}

// AD-REPLAY — literal replay is free; substituted operands refuse.
{
  const root = path.join(tmp, 'ad-replay');
  const fx = adScaffold(root);
  const state = emptyState();
  const ctx = { root: fx.projectRoot, statePath: path.join(fx.projectRoot, 'state.json') };
  const args = { json: true, card: 'EM-4', pr: 126, 'merge-sha': AD_SHA, reason: 'batch PR' };
  await coordinator.commandAdopt(ctx, { ...args }, adDeps(fx, state));
  const replay = await coordinator.commandAdopt(ctx, { ...args }, adDeps(fx, state));
  eq(replay.no_op, true, 'AD-REPLAY identical replay is a no-op');
  eq(replay.ok, true, 'AD-REPLAY identical replay still succeeds');

  let conflict = null;
  try {
    await coordinator.commandAdopt(ctx, { ...args, pr: 999 }, adDeps(fx, state, {
      prView: () => ({ number: 999, state: 'MERGED', mergeCommit: { oid: AD_SHA } }),
    }));
  } catch (err) { conflict = err; }
  eq(conflict && conflict.code, 'adopt_conflict', 'AD-REPLAY substituted operands refuse');
}

// AD-DEGRADE — a gh outage lowers the recorded verification tier. It never
// fails the verb and never passes silently as full verification.
{
  const root = path.join(tmp, 'ad-degrade');
  const fx = adScaffold(root);
  const state = emptyState();
  const receipt = await coordinator.commandAdopt(
    { root: fx.projectRoot, statePath: path.join(fx.projectRoot, 'state.json') },
    { json: true, card: 'EM-4', pr: 126, 'merge-sha': AD_SHA, reason: 'batch PR' },
    adDeps(fx, state, { prView: () => { throw new Error('gh: not authenticated'); } }));
  eq(receipt.adoption.verified, 'git', 'AD-DEGRADE a gh outage records the git-only tier');
  eq(state.cards['EM-4'].adoption.verified, 'git', 'AD-DEGRADE the degrade is durable on the record');
  eq(receipt.ok, true, 'AD-DEGRADE the verb still succeeds');
}
```

Add the topology require near the top of the harness, beside the existing `coordinatorModulePath` block:

```js
const deliveryTopology = require('../mechanisms/delivery/scripts/delivery-topology');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t3.log 2>&1; echo "exit=$?"; grep -m1 "adopt write path" /tmp/ws3-t3.log
```

Expected: FAIL with `adopt write path lands in Task 3`.

- [ ] **Step 3: Write minimal implementation**

In `commandAdopt`, replace the `throw new Error('adopt write path lands in Task 3');` line and add the replay check. The replay check must sit **before** the `adopt_record_exists` refusal, since an adopted card does have a record — replace the record-exists block with this pair:

```js
    const existing = (state.cards || {})[card];
    if (existing && existing.adoption) {
      const same = existing.adoption.pr === number
        && existing.adoption.merge_sha === String(args['merge-sha'] || '').trim().toLowerCase()
        && existing.adoption.reason === reason;
      if (!same) {
        refuse('adopt-refused', 'adopt_conflict',
          `card ${card} was adopted from PR ${existing.adoption.pr}; adopt accepts only literal replay`);
      }
      return successReceipt('adopt', { no_op: true, card, adoption: existing.adoption });
    }
    if (existing) {
      refuse('adopt-refused', 'adopt_record_exists',
        `card ${card} already has a ledger record; adopt only ratifies unrecorded board members`);
    }
```

…and replace the Task-2 throw with the write:

```js
    const provenance = adoptProvenance(args, deps, ctx.root);
    const now = deps.now || (() => new Date().toISOString());
    const persist = deps.writeState || writeState;
    const record = {
      card,
      parent_card: normalizeCardLink(scalarField(raw, 'epic')) || null,
      slice: scalarField(raw, 'slice') || card,
      phase: 'completed',
      card_path: notePath,
      touch_zones: listField(raw, 'touch_zones').map(normalizeZone),
      dependencies: parseDependsOn(raw).map(normalizeCardLink),
      deploy_subscriptions: deploymentField(raw) || null,
      adoption: {
        pr: number,
        merge_sha: provenance.sha,
        reason,
        verified: provenance.verified,
        adopted_at: now(),
      },
    };
    state.cards ||= {};
    state.cards[card] = record;
    persist(ctx, state, record);
    return successReceipt('adopt', {
      no_op: false, card, phase: record.phase, adoption: record.adoption,
      card_path: notePath, pr_url: provenance.pr_url || null,
    });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t3.log 2>&1; echo "exit=$?"; tail -3 /tmp/ws3-t3.log
node platform/test/run-delivery-topology.js; echo "exit=$?"
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): adopt writes one provenance-carrying ledger record"
```

---

## Task 4: `board-health` provenance classification

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js:4548-4560` (`untrackedMemberFinding`), `:4590-4596` (`untrackedCheck`), `:4672-4690` (findings assembly), `buildBoardHealthPayload` (`:4700+`)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: nothing from Tasks 1–3 (independent seam).
- Produces: each `untracked_members[]` entry gains `stamp: string|null` and `provenance: 'coordinator'|'foreign'`, and its `remedy` becomes class-specific. The receipt gains `untracked_members_by_provenance: { coordinator: number, foreign: number }`.

- [ ] **Step 1: Write the failing test**

Append to `platform/test/run-codex-autoloop.js`, after the AD-* blocks:

```js
// BHP board-health provenance: the aggregate untracked count is not a
// rail-leaving rate. A coordinator-format stamp with no record in THIS clone
// can only mean another clone's ledger holds it — legitimate, and not
// actionable here. A foreign stamp means something outside the rail wrote it,
// and THAT is what `adopt` exists for.
{
  const root = path.join(tmp, 'bhp-provenance');
  const projectRoot = path.join(root, 'spice', 'projects', 'test');
  const cardsRoot = path.join(projectRoot, 'tasks');
  const fx = bhScaffold(root, {
    progress: ['Mixed provenance'],
    epics: {
      'Mixed provenance': {
        lanes: { Completed: ['XC-1', 'FH-1', 'FH-2'] },
        slices: { 'XC-1': 'completed', 'FH-1': 'completed', 'FH-2': 'completed' },
      },
    },
  });
  const stamp = (name, value) => {
    const p = path.join(cardsRoot, 'Mixed provenance', 'board', `${name}.md`);
    const raw = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, value === null
      ? raw
      : raw.replace(/^status: completed$/m, `status: completed\nstatus_changed_at: ${value}`));
  };
  // Real shapes, both observed on live boards:
  stamp('XC-1', '2026-07-28T15:31:35.493Z');  // coordinator (GA-P1k)
  stamp('FH-1', '2026-07-31');                // KanbanStatusSync bare date (EM-4/5/6)
  stamp('FH-2', null);                        // no stamp at all (EM-5)

  const receipt = await coordinator.commandBoardHealth(
    { root, statePath: path.join(root, 'state.json') },
    { json: true },
    bhDeps({ boardPath: fx.boardPath, cardsRoot }, { readState: () => emptyState() }),
  );
  const byCard = Object.fromEntries(receipt.findings.untracked_members.map((f) => [f.card, f]));

  eq(byCard['XC-1'].provenance, 'coordinator', 'BHP an ISO-ms stamp is coordinator-written');
  eq(byCard['XC-1'].stamp, '2026-07-28T15:31:35.493Z', 'BHP the stamp is reported verbatim');
  eq(byCard['XC-1'].remedy, 'cross-clone: no action in this clone',
    'BHP a coordinator stamp with no local record is cross-clone residue, not drift');

  eq(byCard['FH-1'].provenance, 'foreign', 'BHP a bare-date stamp is foreign-written');
  eq(byCard['FH-1'].remedy, 'adopt', 'BHP foreign completions route to adopt');
  eq(byCard['FH-2'].provenance, 'foreign', 'BHP an absent stamp is foreign-written');
  eq(byCard['FH-2'].stamp, null, 'BHP an absent stamp reports null');

  eq(receipt.findings.untracked_members_by_provenance, { coordinator: 1, foreign: 2 },
    'BHP the receipt collapses the aggregate into a readable pair');
  eq(receipt.healthy, false, 'BHP classification is not a sixth check; health is unchanged');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t4.log 2>&1; echo "exit=$?"; grep -m1 "BHP" /tmp/ws3-t4.log
```

Expected: FAIL on `BHP an ISO-ms stamp is coordinator-written` — findings currently carry no `provenance` key, so the value is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `scripts/autoloop/codex-coordinator.js`, replace `untrackedMemberFinding` (`:4548`) and add the classifier above it:

```js
// The coordinator is the only writer that emits this exact stamp shape. A
// note carrying it with NO record in this clone can therefore only mean the
// record lives in another clone's ledger (local-per-clone state) — legitimate,
// and not actionable here. Any other shape, or none, means a writer outside
// the rail: KanbanStatusSync at vault boot, a retired project loop, a hand
// edit. That is the class `adopt` exists for.
const COORDINATOR_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ADOPT_REMEDY = 'adopt';
const CROSS_CLONE_REMEDY = 'cross-clone: no action in this clone';

function untrackedMemberProvenance(stamp) {
  return stamp && COORDINATOR_STAMP_RE.test(stamp) ? 'coordinator' : 'foreign';
}

function untrackedMemberFinding(epic, cardName, noteStatus, stamp = null) {
  const provenance = untrackedMemberProvenance(stamp);
  return {
    epic,
    card: cardName,
    note_status: noteStatus,
    stamp: stamp || null,
    provenance,
    issue: noteStatus === 'completed'
      ? 'board member has no ledger record; a completed note is never counted done'
      : `board member has no ledger record; the note claims ${noteStatus} with no coordinator history`,
    // Class-specific: cross-clone residue has no local remedy, and fabricating
    // ledger records for it is exactly the drift the reconciler exists to flag.
    // A foreign-written completion is what `adopt` ratifies.
    remedy: provenance === 'coordinator' ? CROSS_CLONE_REMEDY : ADOPT_REMEDY,
  };
}
```

In `collectBoardHealth`, replace the `untrackedCheck` closure (`:4590`):

```js
  const untrackedCheck = (epic, name, notePath) => {
    if (tracked(name) || !exists(notePath)) return;
    const raw = readText(notePath);
    const status = delivery.normalizeStatus(scalarField(raw, 'status')) || 'planning';
    if (BOARD_HEALTH_PROGRESS_STATUSES.has(status)) {
      untracked.push(untrackedMemberFinding(epic, name, status, scalarField(raw, 'status_changed_at')));
    }
  };
```

In the `findings` object (`:4672`), add the rollup immediately after `untracked_members`:

```js
    untracked_members_by_provenance: {
      coordinator: untracked.filter((f) => f.provenance === 'coordinator').length,
      foreign: untracked.filter((f) => f.provenance === 'foreign').length,
    },
```

The `healthy` computation iterates `Object.entries(findings)` and treats any non-empty value as unhealthy, so the new object key must be exempted exactly like `binding_drift`. Change that expression to:

```js
    healthy: driftClean && Object.entries(findings)
      .every(([key, value]) => key === 'binding_drift' || key === 'untracked_members_by_provenance' || !value.length),
```

In `buildBoardHealthPayload`, carry the rollup into the note payload — add after `untracked_members_overflow_count`:

```js
    untracked_members_by_provenance: core.findings.untracked_members_by_provenance,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t4.log 2>&1; echo "exit=$?"; tail -3 /tmp/ws3-t4.log
```

Expected: PASS. The pre-existing `BH-UNTRACKED` assertion at `:8393` does a deep-equal on a finding object and **will fail** until its expectation is extended with the two new keys. Update it to:

```js
  eq(receipt.findings.untracked_members[0], {
    epic: 'Retire ero loop', card: 'EM-4', note_status: 'completed',
    stamp: null, provenance: 'foreign',
    issue: 'board member has no ledger record; a completed note is never counted done',
    remedy: 'adopt',
  }, 'BH-UNTRACKED finding carries the epic, note status, stamp provenance, issue, and remedy');
```

- [ ] **Step 5: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): classify untracked board members by stamp provenance"
```

---

## Task 5: Foreign-write detection on card projection

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js:2621-2723` (`projectCard`)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: the ledger record shape from Task 3 (`opts.record`).
- Produces: `projectCard` writes `record.card_note_sha` (hex sha256 of the exact bytes it last wrote) and, on mismatch, `record.foreign_write = { detected_at, expected_sha, actual_sha }`. Its return value gains `foreign_write` (the same object, or `null`).

- [ ] **Step 1: Write the failing test**

Append to `platform/test/run-codex-autoloop.js`:

```js
// FW foreign-write detection. A repo-local lock cannot exclude KanbanStatusSync
// (Obsidian, at vault boot) or Obsidian Sync (another machine). So the
// coordinator does not pretend to exclude them — it detects them. For a
// TRACKED card this is report-only on purpose: adoption does not apply to a
// card that already has a record, and refusing here would wedge the autoloop
// on a cosmetic Obsidian edit.
{
  const root = path.join(tmp, 'fw-detect');
  const fx = bhScaffold(root, {
    progress: ['Detect epic'],
    epics: {
      'Detect epic': { lanes: { 'In Progress': ['FW-1'] }, slices: { 'FW-1': 'in_progress' } },
    },
  });
  const notePath = path.join(fx.cardsRoot, 'Detect epic', 'board', 'FW-1.md');
  const record = {
    card: 'FW-1', phase: 'implementing', card_path: notePath,
    touch_zones: ['a.js'], dependencies: [], deploy_subscriptions: null,
  };
  const state = emptyState();
  state.cards['FW-1'] = record;
  const opts = { record, state, cardsRoot: fx.cardsRoot, now: () => '2026-08-04T12:00:00.000Z' };

  // First projection has no prior sha to compare against: it establishes one.
  const first = coordinator.projectCard(notePath, fx.boardPath, 'FW-1', 'implementing', opts);
  eq(first.foreign_write, null, 'FW-1 a first projection cannot detect a foreign write');
  ok(/^[0-9a-f]{64}$/.test(record.card_note_sha), 'FW-1 projection records the sha of what it wrote');
  const established = record.card_note_sha;

  // Replay with the note untouched: no foreign write.
  const replay = coordinator.projectCard(notePath, fx.boardPath, 'FW-1', 'implementing', opts);
  eq(replay.foreign_write, null, 'FW-1 an untouched note reports no foreign write');
  eq(record.card_note_sha, established, 'FW-1 an unchanged note keeps its recorded sha');

  // Now simulate KanbanStatusSync: a bare-date stamp appended out of band.
  const tampered = fs.readFileSync(notePath, 'utf8').replace(/^status: /m, 'status_changed_at: 2026-08-04\nstatus: ');
  fs.writeFileSync(notePath, tampered);
  const detected = coordinator.projectCard(notePath, fx.boardPath, 'FW-1', 'implementing', opts);
  ok(detected.foreign_write, 'FW-1 a note changed behind the coordinator is detected');
  eq(detected.foreign_write.expected_sha, established, 'FW-1 the finding names the sha the coordinator wrote');
  eq(detected.foreign_write.detected_at, '2026-08-04T12:00:00.000Z', 'FW-1 the finding is stamped');
  ok(detected.foreign_write.actual_sha !== established, 'FW-1 the finding names the sha it actually found');
  eq(record.foreign_write.expected_sha, established, 'FW-1 the finding is durable on the record');
  ok(detected.changed !== undefined, 'FW-1 detection does not abort the projection');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t5.log 2>&1; echo "exit=$?"; grep -m1 "FW-1" /tmp/ws3-t5.log
```

Expected: FAIL on `FW-1 a first projection cannot detect a foreign write` — `projectCard`'s result has no `foreign_write` key, so it is `undefined`, not `null`.

- [ ] **Step 3: Write minimal implementation**

In `projectCard`, immediately after `const cardRaw = fs.readFileSync(resolvedCardPath, 'utf8');` (`:2625`), insert the detection:

```js
  // Cross-process write detection. The selector lock lives in this clone's
  // .git and cannot constrain KanbanStatusSync (Obsidian, at vault boot) or
  // Obsidian Sync (another machine) — writers that will never consult a lock.
  // So compare against the exact bytes this coordinator last wrote. For a
  // tracked card the finding is the deliverable: refusing here would wedge the
  // loop on a cosmetic edit, and `adopt` does not apply to a card with a record.
  const recordForSha = opts.record || null;
  const observedSha = sha256Text(cardRaw);
  let foreignWrite = null;
  if (recordForSha && recordForSha.card_note_sha && recordForSha.card_note_sha !== observedSha) {
    foreignWrite = {
      detected_at: (opts.now || (() => new Date().toISOString()))(),
      expected_sha: recordForSha.card_note_sha,
      actual_sha: observedSha,
    };
    recordForSha.foreign_write = foreignWrite;
  }
```

Then, in the write-commit section (`:2706`), record the sha of what was written and surface the finding. Replace:

```js
  if (cardNext !== cardRaw) writeText(resolvedCardPath, cardNext);
```

with:

```js
  if (cardNext !== cardRaw) writeText(resolvedCardPath, cardNext);
  if (recordForSha) recordForSha.card_note_sha = sha256Text(cardNext);
```

and add `foreign_write: foreignWrite,` to the `result` object literal (`:2711`), beside `card_changed`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t5.log 2>&1; echo "exit=$?"; tail -3 /tmp/ws3-t5.log
node platform/test/run-autoloop-select.js && node platform/test/run-autoloop-batch.js && node platform/test/run-autoloop-leases.js; echo "exit=$?"
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): detect non-coordinator card writes via recorded preimage"
```

---

## Task 6: Fail-closed concurrent-modification guard on `heal-epic-bindings`

`restructure` and `reconcile-metadata` already hash preimages for crash recovery; `heal-epic-bindings` has none, and it is the verb whose only protection today is a sentence in `delivery-board.md`. This task converts that prose into an enforced precondition.

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js:4441-4484` (`planEpicBindingHeal`), `:4505-4520` (apply loop in `commandHealEpicBindings`)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: every `planEpicBindingHeal` target (`atlases[]`, `slices[]`) and every `orphanLines[]` entry gains `preimage_sha` (hex sha256 of the bytes the plan was computed from). `commandHealEpicBindings --apply` refuses with code `concurrent_modification` when any target's on-disk bytes no longer hash to its `preimage_sha`.

- [ ] **Step 1: Write the failing test**

Append to `platform/test/run-codex-autoloop.js`:

```js
// CM concurrent-modification. delivery-board.md used to say "never run --apply
// against a board with a live loop session or an active cross-machine sync".
// A sentence is not a guard. The plan records what it read; apply refuses if
// anything moved underneath it.
{
  const root = path.join(tmp, 'cm-heal');
  const prefix = 'spice/projects/test';
  const fx = bhScaffold(root, {
    progress: ['Drifted epic'],
    epics: {
      'Drifted epic': {
        // Non-canonical atlas bindings, so the planner finds real drift.
        atlasLines: [
          'source_board: wrong/board.md', 'kanban_board: wrong/board.md',
          `epic_board: ${prefix}/tasks/Drifted epic/board/Drifted epic-board.md`,
        ],
        lanes: { 'In Progress': ['CM-1'] },
        slices: { 'CM-1': 'in_progress' },
      },
    },
  });
  const plan = coordinator.planEpicBindingHeal(fx.cardsRoot, fx.boardPath);
  ok(plan.atlases.length >= 1, 'CM the fixture presents real binding drift');
  ok(/^[0-9a-f]{64}$/.test(plan.atlases[0].preimage_sha),
    'CM the plan records the sha of every file it read');

  // Clean apply against an untouched tree succeeds.
  const cleanRoot = path.join(tmp, 'cm-heal-clean');
  const cleanFx = bhScaffold(cleanRoot, {
    progress: ['Drifted epic'],
    epics: {
      'Drifted epic': {
        atlasLines: [
          'source_board: wrong/board.md', 'kanban_board: wrong/board.md',
          `epic_board: ${prefix}/tasks/Drifted epic/board/Drifted epic-board.md`,
        ],
        lanes: { 'In Progress': ['CM-1'] },
        slices: { 'CM-1': 'in_progress' },
      },
    },
  });
  const applied = await coordinator.commandHealEpicBindings(
    { root: cleanRoot }, { json: true, apply: true },
    { boardPath: cleanFx.boardPath, cardsRoot: cleanFx.cardsRoot, withLock: async (_c, _n, fn) => fn() });
  eq(applied.ok, true, 'CM-CLEAN an untouched tree still applies');
  eq(applied.applied, true, 'CM-CLEAN reports it applied');

  // A second writer between plan and write is refused, with zero writes.
  const atlasPath = path.join(fx.cardsRoot, 'Drifted epic', 'Drifted epic.md');
  const before = fs.readFileSync(atlasPath, 'utf8');
  let refusal = null;
  try {
    await coordinator.commandHealEpicBindings(
      { root }, { json: true, apply: true },
      {
        boardPath: fx.boardPath, cardsRoot: fx.cardsRoot,
        withLock: async (_c, _n, fn) => fn(),
        // Simulate Obsidian Sync landing a change after the plan is computed.
        planHook: () => fs.writeFileSync(atlasPath, `${before}\nappended by another writer\n`),
      });
  } catch (err) { refusal = err; }
  eq(refusal && refusal.code, 'concurrent_modification',
    'CM-RACE a target changed after planning refuses');
  ok(/Drifted epic.md/.test(refusal.message), 'CM-RACE the refusal names the changed path');
  ok(/appended by another writer/.test(fs.readFileSync(atlasPath, 'utf8')),
    'CM-RACE the foreign write is left intact — the refusal wrote nothing');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t6.log 2>&1; echo "exit=$?"; grep -m1 "CM " /tmp/ws3-t6.log
```

Expected: FAIL on `CM the plan records the sha of every file it read` — `preimage_sha` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `planEpicBindingHeal`, record the sha of each file read. Change the atlas push:

```js
    if (Object.keys(atlasFields).length) {
      atlases.push({ epic, path: atlasPath, fields: atlasFields, preimage_sha: sha256Text(atlasRaw) });
    }
```

the orphan push:

```js
        orphanLines.push({ board: epicBoardPath, epic, card: name, preimage_sha: sha256Text(boardRaw) });
```

and the slice push:

```js
      if (Object.keys(sliceFields).length) {
        slices.push({ card: name, epic, path: notePath, fields: sliceFields, preimage_sha: sha256Text(sliceRaw) });
      }
```

In `commandHealEpicBindings`, insert the verification between the plan and the first write. Replace the `if (apply) {` block's opening with:

```js
    if (deps.planHook) deps.planHook();
    if (apply) {
      // The plan was computed from bytes on disk. If anything moved underneath
      // it — a live loop session, Obsidian Sync, a Codex session — apply is
      // refused with zero writes rather than silently clobbering the other
      // writer. This is the enforced form of what delivery-board.md used to
      // only warn about.
      const changed = [];
      for (const target of [...atlases, ...slices]) {
        if (sha256Text(fs.readFileSync(target.path, 'utf8')) !== target.preimage_sha) changed.push(target.path);
      }
      for (const board of new Set(orphanLines.map((o) => o.board))) {
        const expected = orphanLines.find((o) => o.board === board).preimage_sha;
        if (sha256Text(fs.readFileSync(board, 'utf8')) !== expected) changed.push(board);
      }
      if (changed.length) {
        refuse('heal-epic-bindings-refused', 'concurrent_modification',
          `targets changed after planning; another writer is active: ${[...new Set(changed)].join(', ')}`);
      }
```

Keep the existing write loops unchanged beneath it, and keep the existing closing brace.

The `planHook` seam is test-only and must be added to the `deps` destructuring the same way the other seams are — it is read directly off `deps`, so no further wiring is needed.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t6.log 2>&1; echo "exit=$?"; tail -3 /tmp/ws3-t6.log
```

Expected: PASS. The existing `BPX-HEAL` assertions exercise `planEpicBindingHeal`'s receipt shape; if any deep-equals a target object it must be extended with `preimage_sha`. Search `/tmp/ws3-t6.log` for `BPX` failures and update those expectations to include the key.

- [ ] **Step 5: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "fix(coordinator): refuse heal-epic-bindings --apply when a target moved after planning"
```

---

## Task 7: Extend the guard to `restructure` and `reconcile-metadata`

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` — `commandRestructure`, `commandRebindParkedMetadata`
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: the `concurrent_modification` refusal code established in Task 6.
- Produces: no new exported surface. Both verbs refuse with `concurrent_modification` when a target's on-disk bytes differ from the preimage their journal/spec recorded.

- [ ] **Step 1: Read the existing preimage machinery**

```bash
grep -n "preimage\|content-addressed\|intended" scripts/autoloop/codex-coordinator.js | sed -n '1,40p'
```

Both verbs already hash preimages for crash recovery. Identify, for each, the exact point where a recorded preimage is compared against disk, and whether a mismatch currently resumes forward (crash recovery) or aborts. The change is to distinguish the two cases: a target matching the *intended result* is a completed crash-recovery step and still resumes; a target matching **neither** preimage nor intended result is a second writer and must refuse `concurrent_modification` rather than the current generic third-state failure.

- [ ] **Step 2: Write the failing test**

Append to `platform/test/run-codex-autoloop.js`. Model the fixture on the existing `restructure` and `reconcile-metadata` blocks already in this harness — locate them with:

```bash
grep -n "commandRestructure\|commandRebindParkedMetadata" platform/test/run-codex-autoloop.js | head
```

For each verb, add one assertion pair: (a) a target in a third state — matching neither preimage nor intended bytes — refuses with `code === 'concurrent_modification'`, and (b) the refusal message names the changed path, and no target file was modified. Reuse the surrounding block's fixture builder verbatim rather than inventing a new one; the point of the test is the refusal code, not a new scaffold.

- [ ] **Step 3: Run test to verify it fails**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t7.log 2>&1; echo "exit=$?"; grep -m2 "concurrent_modification" /tmp/ws3-t7.log
```

Expected: FAIL — both verbs currently emit their own generic third-state failure, not `concurrent_modification`.

- [ ] **Step 4: Write minimal implementation**

At each verb's existing third-state branch, emit the shared code instead of the generic failure:

```js
      refuse('<verb>-refused', 'concurrent_modification',
        `targets changed after planning; another writer is active: ${changedPaths.join(', ')}`);
```

Preserve the crash-recovery branch exactly: a target whose bytes equal the *intended result* is a completed step and must still resume forward. Only the neither-preimage-nor-intended case becomes `concurrent_modification`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
node platform/test/run-codex-autoloop.js > /tmp/ws3-t7.log 2>&1; echo "exit=$?"; tail -3 /tmp/ws3-t7.log
```

Expected: PASS, with every pre-existing restructure and reconcile-metadata assertion still green — crash-recovery replay must be untouched.

- [ ] **Step 6: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "fix(coordinator): name concurrent writers in restructure and reconcile-metadata refusals"
```

---

## Task 8: Documentation and cycle close

**Files:**
- Modify: `Docs/agent-guides/delivery-board.md` — § Coordinator operations (`:49-69`), § Board vs ledger authority (`:71-80`)
- Create: `Docs/plans/2026-08-04-v0.283.0-ws3-a-rail-that-fits-result.md`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: no code surface.

- [ ] **Step 1: Document the `adopt` verb**

Add to § Coordinator operations, after the `board-health` paragraph:

> **`adopt --card <name> --pr <n> --merge-sha <40-hex> --reason <why> --json`** — the sanctioned out-of-band completion (loop-integrity workstream 3). It exists because `KanbanStatusSync` runs at vault boot in every consumer vault and can complete any slice with one drag, and because a batch PR is sometimes genuinely the right shape for a change (`EM-4/5/6`, PR #126). Adoption **ratifies a declaration already sitting unrecorded on the board** — a card with a ledger record refuses (`adopt_record_exists`) and a note not declaring `completed` refuses (`adopt_not_declared_complete`), which is what keeps it from being a general-purpose "mark it done" backdoor. Provenance is verified, not trusted: `--merge-sha` must resolve and be an ancestor of the default branch (`adopt_sha_unreachable`), and `--pr` must be `MERGED` with that exact merge commit (`adopt_pr_not_merged` / `adopt_pr_mismatch`). A `gh` outage degrades the recorded tier to `verified: "git"` — visible in the receipt and on the record, never silent. One ledger record is written, `phase: completed`, carrying `adoption: {pr, merge_sha, reason, verified, adopted_at}`. Literal replay is `no_op: true`; substituted operands refuse (`adopt_conflict`).

- [ ] **Step 2: Document the adopted tier**

Extend § Board vs ledger authority's numbered rules with a third:

> 3. **A ledger record carrying `adoption` → the adopted tier** (`source: 'adopted'`). Verified external provenance stands in for deployment receipts, so the slice is projectable and the epic can roll up — but `doneProven` stays `false` permanently. `doneProven` keeps meaning exactly "carries successful deployment receipts"; adoption never fabricates it. `assertProjectableStatus` accepts a `completed` verdict that is `doneProven` **or** `adopted`, and nothing else. The board still cannot mark itself done: only the coordinator can, and only with evidence.

- [ ] **Step 3: Replace the heal warning with the guard**

In the `heal-epic-bindings` paragraph, replace the closing sentence — "It takes the selector lock, but that boundary does **not** cover non-coordinator writers, so never run `--apply` against a board with a live loop session or an active cross-machine sync." — with:

> It takes the selector lock, but that boundary does **not** cover non-coordinator writers, so `--apply` now verifies every target's `preimage_sha` immediately before writing and refuses (`concurrent_modification`, naming the changed paths, zero writes) when anything moved after the plan was computed. `restructure` and `reconcile-metadata --apply` emit the same code for the same reason. A repo-local lock cannot constrain Obsidian or a cross-machine sync; detection is what replaces it.

- [ ] **Step 4: Run the full preflight**

```bash
npm run release:preflight > /tmp/ws3-preflight.log 2>&1; echo "exit=$?"; tail -20 /tmp/ws3-preflight.log
```

Expected: green. If `run-sticky-notes-render-guards.js` fails, re-run it alone to confirm the known ~50% flake — do NOT fix it in this cycle:

```bash
for i in 1 2 3; do node platform/test/run-sticky-notes-render-guards.js > /dev/null 2>&1; echo "run $i exit=$?"; done
```

- [ ] **Step 5: Verify the release bump before opening the PR**

```bash
npm run release:check-bump
```

The highest bump on this branch is `feat` (Tasks 1–5) → **minor**. The PR title must therefore be a `feat(...)` subject, since the squash-merge bumper reads the title, not the branch commits. Use:

`feat(coordinator): a rail that fits — adopt verb, provenance classification, foreign-write detection`

Expected: `ok: true` with `minor`/`minor`.

- [ ] **Step 6: Write the cycle-close result doc**

Create `Docs/plans/2026-08-04-v0.283.0-ws3-a-rail-that-fits-result.md` following the structure of `Docs/plans/2026-08-04-v0.282.1-ws2-one-source-of-truth-result.md`: what shipped, surfaces touched, spec interpretations, anything discovered and deliberately not changed, process notes, and carry-forward. Record explicitly:

- the sweep numbers from spec §1 (164 untracked → 64 cross-clone / 100 foreign; one shared-rail incident in four days),
- that batch-claim was deferred as unjustified by data and remains available as a later cycle,
- that the existing 164 findings were **not** healed,
- that `effectiveProjectionMapping` / `projectedRecordMapping` divergence and the sticky-notes flake remain open and untouched.

- [ ] **Step 7: Commit and open the PR**

```bash
git add -u Docs/agent-guides/delivery-board.md
git add Docs/plans/2026-08-04-v0.283.0-ws3-a-rail-that-fits-result.md
git commit -m "docs(delivery): document adopt, the adopted tier, and the concurrent-write guard"
git push -u origin ws3-a-rail-that-fits
gh pr create --title "feat(coordinator): a rail that fits — adopt verb, provenance classification, foreign-write detection" --body "<summary + the release:check-bump receipt>"
```

The `pr-title-bump` CI job gates the PR. Do not merge the release PR by hand; the pipeline owns it.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §3 adopted authority tier | Task 1 |
| §4.1 preconditions and refusals | Task 2 |
| §4.2 write, replay, gh degrade | Task 3 |
| §5 provenance classification | Task 4 |
| §6.1 card projection, report-only | Task 5 |
| §6.2 bulk verbs, fail closed | Tasks 6–7 |
| §7 error handling | Tasks 2, 6, 7 (every code emitted through `refuse` before mutation) |
| §8 testing and docs | Tasks 1–7 tests; Task 8 docs |
| §9 constraints | Global Constraints; Task 8 steps 4–5 |

No gaps.

**Type consistency:** `resolveSliceAuthority`'s `adopted` operand (Task 1) is supplied by consumers as `Boolean(record.adoption)`, matching the `adoption` object written in Task 3. `preimage_sha` is the same key name in Tasks 6 and 7. `card_note_sha` and `foreign_write` are used only in Task 5. `concurrent_modification` is the single shared code across Tasks 6 and 7. The `adopt-refused` action string is consistent across every refusal in Tasks 2 and 3.

**Known follow-on within the plan:** Tasks 4 and 6 both extend an existing deep-equal assertion (`BH-UNTRACKED`, `BPX-HEAL`). Each task's Step 4 says so explicitly rather than leaving the implementer to discover a mystery failure.
