# Loop-integrity Workstream 2 — One source of truth · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give three duplicated facts — canonical project-path derivation, board-vs-ledger slice authority, and the release bump — exactly one physical implementation, with every consumer routed through it.

**Architecture:** Extract the shared facts into `platform/mechanisms/delivery/scripts/delivery-topology.js` (exposed as `delivery.topology.*`), which both the coordinator (via `select-card`'s `delivery` re-export) and card-intake (direct require) already reach. Add a `scripts/release/check-title-bump.js` CI gate that reuses the existing release library. TDD each item; the 2683-assertion `run-codex-autoloop.js` and `run-card-intake.js` are the regression oracle for the pure extractions.

**Tech Stack:** Node.js, built-ins only (house rule). Zero new dependencies.

## Global Constraints

- **Ships as a patch.** Every commit ≤ patch: extractions are `refactor(...)`, the authority single-sourcing is `fix(delivery):`, the CI gate is `ci(release):`, docs are `docs(...)`. **No `feat(...)` commit may appear on this branch** — the item-3 gate this PR introduces compares the PR-title bump against the branch bump and would fail on a `feat`. PR title carries `fix`/`refactor` → patch.
- **Behavior-preserving where stated.** Item 1 and the item-2 routing of `deriveEpicProjection`/`noteProjectionMapping` must not change any observable projection; the existing harness proves it.
- **Do NOT hand-version / hand-tag / edit the tap / add `Co-authored-by: Claude`.** The pipeline owns versions; `manifest.json` version fields are bumped by the release bumper — never hand-edit `"version"`.
- **Staging under `scripts/`:** tracked files `git add -u`; NEW files `git add -f` (landmine #30 — `/Scripts/` gitignore case-folds onto `scripts/` on APFS). `.agents/`, `platform/`, `Docs/` stage normally.
- **Consumer-vault safety:** this cycle writes only workshop repo files. No consumer-vault writes; `board-health --json` is read-only.
- **Node built-ins only** in `delivery-topology.js` (matches `delivery-contract.js`).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `platform/mechanisms/delivery/scripts/delivery-topology.js` | The shared facts: `physicalProjectPrefix`, `canonicalWorkspacePath`, `epicBindingPaths`, `parentBoardRef`, `resolveSliceAuthority`, `assertProjectableStatus` | **Create** |
| `platform/mechanisms/delivery/index.js` | Re-export topology under `.topology` | Modify |
| `platform/mechanisms/delivery/manifest.json` | Materialize the new script into consumer vaults | Modify (add `files[]` entry; NOT the version) |
| `scripts/autoloop/codex-coordinator.js` | Consume shared topology; single-source the authority rule + assertion | Modify |
| `.agents/skills/card-intake/scripts/card-intake.js` | Consume shared topology; delete `physicalProjectPrefix` mirror | Modify |
| `scripts/release/check-title-bump.js` | PR-title-vs-branch bump gate | **Create** |
| `platform/test/run-delivery-topology.js` | Unit tests for the shared module | **Create** |
| `platform/test/run-release-title-gate.js` | Unit tests for the bump gate | **Create** |
| `package.json` | `release:check-bump` script + wire both new harnesses into `release:preflight` | Modify |
| `.github/workflows/ci.yml` | `pr-title-bump` job (applied via the Director's temporary workflow-scoped token) | Modify |
| `Docs/agent-guides/delivery-board.md` | State the board-vs-ledger authority rule | Modify |

---

## Task 1: Create `delivery-topology.js` — path derivation + validator

**Files:**
- Create: `platform/mechanisms/delivery/scripts/delivery-topology.js`
- Create: `platform/test/run-delivery-topology.js`
- Modify: `platform/mechanisms/delivery/index.js`

**Interfaces:**
- Produces:
  - `physicalProjectPrefix(cardsRoot, fsImpl?) → {prefix, root}` — throws `'canonical cards root is outside spice/projects'` / `'canonical cards root is not one project directly under spice/projects'`. `prefix` is `spice/projects/<slug>` (posix), `root` is the absolute project dir.
  - `canonicalWorkspacePath(value, expected) → boolean`
  - `epicBindingPaths(prefix, epic) → {atlasRef, boardRef}` where `atlasRef = <prefix>/tasks/<epic>/<epic>.md`, `boardRef = <prefix>/tasks/<epic>/board/<epic>-board.md` (posix).
  - `parentBoardRef(prefix, parentBoardBasename) → string` = `<prefix>/<basename>` (posix).
- Consumed by: Tasks 3, 4 (coordinator), Task 5 (intake).

- [ ] **Step 1: Write the failing test** — `platform/test/run-delivery-topology.js`

```js
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const topo = require('../mechanisms/delivery/scripts/delivery-topology');

let count = 0;
const ok = (c, m) => { assert.ok(c, m); count += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); count += 1; };
const throws = (fn, re, m) => { assert.throws(fn, re, m); count += 1; };

// physicalProjectPrefix: a canonical cards root resolves to one project prefix.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-'));
const projRoot = path.join(tmp, 'spice', 'projects', 'demo');
const cardsRoot = path.join(projRoot, 'tasks');
fs.mkdirSync(cardsRoot, { recursive: true });
const pp = topo.physicalProjectPrefix(cardsRoot);
eq(pp.prefix, 'spice/projects/demo', 'prefix is project-relative posix');
eq(pp.root, fs.realpathSync(projRoot), 'root is the physical project dir');

// A cards root outside spice/projects throws.
const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-bad-'));
fs.mkdirSync(path.join(bad, 'tasks'), { recursive: true });
throws(() => topo.physicalProjectPrefix(path.join(bad, 'tasks')),
  /outside spice\/projects/, 'non-canonical root throws');

// canonicalWorkspacePath: exact match, no traversal, project-relative only.
ok(topo.canonicalWorkspacePath('spice/projects/demo/tasks/E/E.md',
  'spice/projects/demo/tasks/E/E.md'), 'exact match passes');
ok(!topo.canonicalWorkspacePath('/abs/path', '/abs/path'), 'absolute rejected');
ok(!topo.canonicalWorkspacePath('a/../b', 'a/../b'), 'traversal rejected');
ok(!topo.canonicalWorkspacePath('x', 'y'), 'mismatch rejected');

// epicBindingPaths + parentBoardRef.
const b = topo.epicBindingPaths('spice/projects/demo', 'Epic One');
eq(b.atlasRef, 'spice/projects/demo/tasks/Epic One/Epic One.md', 'atlasRef');
eq(b.boardRef, 'spice/projects/demo/tasks/Epic One/board/Epic One-board.md', 'boardRef');
eq(topo.parentBoardRef('spice/projects/demo', 'demo-board.md'),
  'spice/projects/demo/demo-board.md', 'parentBoardRef');

console.log(`DELIVERY-TOPOLOGY PASS (${count} assertions)`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-delivery-topology.js`
Expected: FAIL — `Cannot find module '.../delivery-topology'`.

- [ ] **Step 3: Create `delivery-topology.js`**

Copy `physicalProjectPrefix` and `canonicalWorkspacePath` **verbatim** from `scripts/autoloop/codex-coordinator.js` (lines 2048-2066 as of this branch), adding an `fsImpl` seam to `physicalProjectPrefix`, then add the two ref builders:

```js
'use strict';
// Shared "one source of truth" for the delivery board's canonical topology:
// project-path derivation, the workspace-path validator, and the board-vs-ledger
// slice authority rule. Both the coordinator (via select-card's delivery
// re-export) and card-intake consume this module so a single fact has a single
// implementation. Node built-ins only (mirrors delivery-contract.js).
const path = require('path');

// The vault-relative project prefix + physical root, derived from the ON-DISK
// cards root. The canonical throwing authority: canonicalEpicProjection
// validates against it and heal-epic-bindings writes from it, so what the
// contract demands and what the heal writes cannot drift.
function physicalProjectPrefix(cardsRoot, fsImpl) {
  const fs = fsImpl || require('fs');
  const projectRoot = path.dirname(fs.realpathSync(cardsRoot)).replace(/\\/g, '/');
  const marker = '/spice/projects/';
  const markerAt = projectRoot.lastIndexOf(marker);
  if (markerAt < 0) throw new Error('canonical cards root is outside spice/projects');
  const relative = projectRoot.slice(markerAt + 1);
  if (!/^spice\/projects\/[^/]+$/.test(relative)) {
    throw new Error('canonical cards root is not one project directly under spice/projects');
  }
  return { prefix: relative, root: projectRoot };
}

// True iff `value` is exactly `expected`, is workspace-relative (not absolute,
// no drive letter), and contains no empty / '.' / '..' segment.
function canonicalWorkspacePath(value, expected) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  const parts = raw.split('/');
  return Boolean(raw) && !raw.startsWith('/') && !/^[A-Za-z]:\//.test(raw)
    && !parts.some((part) => !part || part === '.' || part === '..')
    && raw === expected;
}

// The canonical vault-relative atlas + board refs for one epic under a prefix.
function epicBindingPaths(prefix, epic) {
  return {
    atlasRef: path.posix.join(prefix, 'tasks', epic, `${epic}.md`),
    boardRef: path.posix.join(prefix, 'tasks', epic, 'board', `${epic}-board.md`),
  };
}

// The canonical vault-relative reference to a parent board from its basename.
function parentBoardRef(prefix, parentBoardBasename) {
  return path.posix.join(prefix, parentBoardBasename);
}

module.exports = {
  physicalProjectPrefix,
  canonicalWorkspacePath,
  epicBindingPaths,
  parentBoardRef,
};
```

- [ ] **Step 4: Re-export from the delivery index** — `platform/mechanisms/delivery/index.js`

```js
'use strict';

// Stable public consumer API. A3 may change consumers, never this import path.
module.exports = require('./scripts/delivery-contract');
module.exports.topology = require('./scripts/delivery-topology');
```

- [ ] **Step 5: Run to verify it passes**

Run: `node platform/test/run-delivery-topology.js`
Expected: `DELIVERY-TOPOLOGY PASS (13 assertions)`.

- [ ] **Step 6: Verify the index re-export**

Run: `node -e "const d=require('./platform/mechanisms/delivery'); console.log(typeof d.topology.physicalProjectPrefix, typeof d.CONTRACT_VERSION)"`
Expected: `function string` (topology present AND the pure contract surface intact).

- [ ] **Step 7: Commit**

```bash
git add platform/mechanisms/delivery/scripts/delivery-topology.js platform/mechanisms/delivery/index.js platform/test/run-delivery-topology.js
git commit -m "refactor(delivery): extract canonical project-path derivation into shared topology"
```

---

## Task 2: Materialize the new script + wire the harness

**Files:**
- Modify: `platform/mechanisms/delivery/manifest.json`
- Modify: `package.json`

**Why:** `index.js` now `require`s `./scripts/delivery-topology.js`. The manifest materializes the delivery mechanism into consumer vaults; without the new file listed, a vault's `index.js` require would break on a partial copy. The version field is left alone (bumper owns it).

- [ ] **Step 1: Add the `files[]` entry** — in `manifest.json`, after the `scripts/delivery-schema-cli.js` entry, add:

```json
    {
      "source": "scripts/delivery-topology.js",
      "dest": "{{content_path}}/delivery/scripts/delivery-topology.js"
    },
```

- [ ] **Step 2: Wire `run-delivery-topology.js` into preflight** — in `package.json`'s `release:preflight` chain, immediately after `node platform/test/run-delivery-contract.js`, insert:

```
 && node platform/test/run-delivery-topology.js
```

- [ ] **Step 3: Verify self-install still succeeds (manifest well-formed + materializes)**

Run: `node platform/install.js --vault . --auto-approve`
Expected: exits 0; `ls platform/mechanisms/delivery/scripts/delivery-topology.js` present in the materialized surface. (Dogfood catches manifest entry-order / path drift — build-test-verify.md.)

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/delivery/manifest.json package.json
git commit -m "refactor(delivery): materialize shared topology script + wire preflight harness"
```

---

## Task 3: Coordinator consumes shared path derivation

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js`

**Interfaces:**
- Consumes: `delivery.topology.physicalProjectPrefix`, `.canonicalWorkspacePath`, `.epicBindingPaths`, `.parentBoardRef` (Task 1). `delivery` is already imported from `./select-card`.

**Regression oracle:** `run-codex-autoloop.js` (2683 assertions) — behavior must be identical.

- [ ] **Step 1: Add local aliases near the top-of-file helpers** (after the `delivery` destructure at line ~22), so call sites stay short:

```js
const {
  physicalProjectPrefix, canonicalWorkspacePath, epicBindingPaths, parentBoardRef,
} = delivery.topology;
```

- [ ] **Step 2: Delete the two local definitions** — remove `function physicalProjectPrefix(cardsRoot) {...}` (lines ~2056-2066) and `function canonicalWorkspacePath(value, expected) {...}` (lines ~2048-2054). The aliases now resolve them.

- [ ] **Step 3: Replace the inline `expected*` builders in `canonicalEpicProjection`** — lines ~2192-2199 currently:

```js
  const expectedParentBoardPath = path.posix.join(projectPrefix, path.basename(parentBoardPath));
  ...
  const expectedAtlasPath = path.posix.join(projectPrefix, 'tasks', epic, `${epic}.md`);
  const expectedBoardPath = path.posix.join(projectPrefix, 'tasks', epic, 'board', `${epic}-board.md`);
```

become:

```js
  const expectedParentBoardPath = parentBoardRef(projectPrefix, path.basename(parentBoardPath));
  ...
  const { atlasRef: expectedAtlasPath, boardRef: expectedBoardPath } = epicBindingPaths(projectPrefix, epic);
```

(`projectPrefix` here is the local `const projectPrefix = physicalProject.prefix;` already at line 2191 — unchanged.)

- [ ] **Step 4: Replace the heal builder in `canonicalEpicBindings`** — lines ~4448-4453:

```js
  const { prefix } = physicalProjectPrefix(cardsRoot);
  return {
    parentBoard: parentBoardRef(prefix, path.basename(parentBoardPath)),
    atlas: epicBindingPaths(prefix, epic).atlasRef,
    board: epicBindingPaths(prefix, epic).boardRef,
  };
```

- [ ] **Step 5: Run the full coordinator harness (regression oracle)**

Run: `node platform/test/run-codex-autoloop.js`
Expected: `CODEX-AUTOLOOP PASS (2683 assertions)` — unchanged.

- [ ] **Step 6: Run the intake + delivery harnesses (nothing else regressed)**

Run: `node platform/test/run-card-intake.js && node platform/test/run-delivery-contract.js && node platform/test/run-delivery-topology.js`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js
git commit -m "refactor(coordinator): consume shared delivery topology; drop local prefix derivation"
```

---

## Task 4: Single-sourced board-vs-ledger authority + enforcement

**Files:**
- Modify: `platform/mechanisms/delivery/scripts/delivery-topology.js`
- Modify: `platform/test/run-delivery-topology.js`
- Modify: `scripts/autoloop/codex-coordinator.js`

**Interfaces:**
- Produces (topology):
  - `resolveSliceAuthority({ hasRecord, ledgerStatus, boardStatus, doneProven, boardIsSlice }) → {status, doneProven, source, demoted}` — frozen. Rule:
    - `hasRecord` → `source:'ledger'`, `base = ledgerStatus`, `proven = !!doneProven`; if `base === 'completed' && !proven` → `status:'in_progress'` (`demoted:true`), else `status:base`.
    - else → `source:'board'`, `base = boardStatus`, `proven:false`; if `base === 'completed' && boardIsSlice` → `status:'in_progress'` (`demoted:true`), else `status:base`.
    - `doneProven` in the return is `hasRecord ? proven : false`.
  - `assertProjectableStatus(verdict) → void` — throws `'projectable status invariant: completed without proven deployment'` if `verdict.status === 'completed' && verdict.doneProven !== true`. Unreachable in correct code (resolver never returns that combination); it is the fail-closed backstop against a future consumer bypassing the resolver.

**Scope note (surfaced, not silently changed):** `effectiveProjectionMapping` (coordinator ~1955) and `projectedRecordMapping` (~1968) implement a *narrower, canonical-slice-gated* variant of the same demotion and are intentionally **out of scope** here — routing them through this resolver would change behavior for completed non-slice records. Their divergence from `noteProjectionMapping` (unconditional ledger demotion) is a **discovered finding** for the result doc, not a fix in this cycle.

- [ ] **Step 1: Write failing tests** — append to `platform/test/run-delivery-topology.js` before the final `console.log`:

```js
// resolveSliceAuthority — ledger wins when present.
let v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'in_progress', boardStatus: 'completed', doneProven: false, boardIsSlice: true });
eq(v.source, 'ledger', 'record present => ledger source');
eq(v.status, 'in_progress', 'ledger in_progress wins over board completed');
eq(v.doneProven, false, 'not proven');

// Ledger completed WITH receipts is done.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'completed', boardStatus: 'planning', doneProven: true, boardIsSlice: true });
eq(v.status, 'completed', 'proven completed stays completed');
eq(v.doneProven, true, 'proven');
ok(!v.demoted, 'not demoted');

// Ledger completed WITHOUT receipts demotes.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'completed', boardStatus: 'planning', doneProven: false, boardIsSlice: true });
eq(v.status, 'in_progress', 'unproven ledger completion demotes');
ok(v.demoted, 'demoted flagged');

// No record: board slice declaration cannot assert done.
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'completed', boardIsSlice: true });
eq(v.source, 'board', 'no record => board source');
eq(v.status, 'in_progress', 'board slice completed demotes');
eq(v.doneProven, false, 'board never proves done');

// No record, non-slice: board status taken at face value (no demotion).
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'completed', boardIsSlice: false });
eq(v.status, 'completed', 'non-slice board completed not demoted');

// No record, board in_progress: pass-through.
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'blocked', boardIsSlice: true });
eq(v.status, 'blocked', 'board non-completed passes through');

// assertProjectableStatus: throws on the impossible-in-correct-code combination.
throws(() => topo.assertProjectableStatus({ status: 'completed', doneProven: false }),
  /projectable status invariant/, 'completed-without-proof assertion fires');
// ...and accepts valid verdicts.
topo.assertProjectableStatus({ status: 'completed', doneProven: true });
topo.assertProjectableStatus({ status: 'in_progress', doneProven: false });
count += 2;
```

- [ ] **Step 2: Run to verify failure**

Run: `node platform/test/run-delivery-topology.js`
Expected: FAIL — `resolveSliceAuthority is not a function`.

- [ ] **Step 3: Implement in `delivery-topology.js`** (add functions + exports):

```js
// The board-vs-ledger slice authority rule, in one place. The ledger wins when
// a record exists; the board slice frontmatter is a declaration only and can
// never assert "done"; a completed status without proven deployment demotes to
// in_progress. Callers supply already-normalized statuses + the doneProven
// signal so this stays free of coordinator phase/receipt vocabulary.
function resolveSliceAuthority({ hasRecord, ledgerStatus, boardStatus, doneProven, boardIsSlice } = {}) {
  if (hasRecord) {
    const proven = doneProven === true;
    const base = ledgerStatus;
    const status = base === 'completed' && !proven ? 'in_progress' : base;
    return Object.freeze({ status, doneProven: proven, source: 'ledger', demoted: status !== base });
  }
  const base = boardStatus;
  const demoted = base === 'completed' && Boolean(boardIsSlice);
  const status = demoted ? 'in_progress' : base;
  return Object.freeze({ status, doneProven: false, source: 'board', demoted });
}

// Fail-closed backstop: a verdict projected as complete MUST be proven done.
// Unreachable via resolveSliceAuthority; guards a future consumer bypassing it.
function assertProjectableStatus(verdict) {
  if (verdict && verdict.status === 'completed' && verdict.doneProven !== true) {
    throw new Error('projectable status invariant: completed without proven deployment');
  }
}
```

Add `resolveSliceAuthority` and `assertProjectableStatus` to `module.exports`.

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-delivery-topology.js`
Expected: `DELIVERY-TOPOLOGY PASS (28 assertions)`.

- [ ] **Step 5: Route `deriveEpicProjection` through the resolver** — replace the per-slice branch logic (coordinator ~2278-2301) with one resolver call. Add the aliases at Step 1 of Task 3's alias block: extend it to include `resolveSliceAuthority, assertProjectableStatus`. Then the `slices` map body becomes:

```js
  const slices = cards.map((name) => {
    const tracked = surface.state.cards && surface.state.cards[name];
    const slicePath = path.join(path.dirname(surface.boardPath), `${name}.md`);
    if (!fs.existsSync(slicePath)) throw new Error(`epic slice ${name} note is missing`);
    const sliceRaw = fs.readFileSync(slicePath, 'utf8');
    const dependencies = tracked && Array.isArray(tracked.dependencies)
      ? tracked.dependencies.map(normalizeCardLink) : parseDependsOn(sliceRaw).map(normalizeCardLink);
    const decorate = (status) => ({
      card: name,
      status,
      cross_epic_dependency: dependencies.some((dependency) => !siblings.has(dependency)),
    });
    // The live claim's status overrides the ledger phase for that one card.
    const hasRecord = name === currentCard || Boolean(tracked && projectionMapping(tracked.phase));
    const ledgerStatus = name === currentCard
      ? currentStatus
      : (tracked && projectionMapping(tracked.phase) ? projectionMapping(tracked.phase).status : null);
    const boardStatus = delivery.normalizeStatus(scalarField(sliceRaw, 'status') || 'planning')
      || (scalarField(sliceRaw, 'status') || 'planning');
    const verdict = resolveSliceAuthority({
      hasRecord,
      ledgerStatus,
      boardStatus,
      doneProven: successfulDeploymentReceipts(tracked),
      boardIsSlice: true,
    });
    assertProjectableStatus(verdict);
    if (verdict.demoted && verdict.status === 'in_progress'
      && (name === currentCard ? currentStatus === 'completed'
        : (verdict.source === 'ledger' ? true : true))) {
      findings.push(legacyCompletionFinding(surface, name, verdict.source === 'ledger' ? tracked : null));
    }
    return decorate(verdict.status);
  });
```

**Careful correctness note for the implementer:** the *only* observable outputs are (a) the decorated `status` string per slice and (b) which `legacyCompletionFinding`s get pushed (and with what `record`). The original pushes a finding exactly when a `completed` source is demoted: current-card completed+no-receipts (record=tracked), tracked completed+no-receipts (record=tracked), board completed (record=null). The resolver's `demoted` flag captures all three; emit `legacyCompletionFinding(surface, name, verdict.source === 'ledger' ? tracked : null)` **iff `verdict.demoted`**. Simplify Step 5's `if` to:

```js
    if (verdict.demoted) {
      findings.push(legacyCompletionFinding(surface, name, verdict.source === 'ledger' ? tracked : null));
    }
```

- [ ] **Step 6: Run the coordinator harness (behavior must be identical)**

Run: `node platform/test/run-codex-autoloop.js`
Expected: `CODEX-AUTOLOOP PASS (2683 assertions)`. If any assertion fails, the resolver mapping diverged from the original three-branch logic — diff the failing case, do NOT edit the test.

- [ ] **Step 7: Route `noteProjectionMapping` through the resolver** — coordinator ~2305-2325. Replace body with:

```js
function noteProjectionMapping(raw, record = null) {
  const statusMap = {
    planning: { column: 'In Planning', complete: false, status: 'planning' },
    in_progress: { column: 'In Progress', complete: false, status: 'in_progress' },
    parked: { column: 'In Progress', complete: false, status: 'parked' },
    blocked: { column: 'Blocked', complete: false, status: 'blocked' },
    completed: { column: 'Completed', complete: true, status: 'completed' },
  };
  const tracked = record && projectionMapping(record.phase);
  const boardStatus = delivery.normalizeStatus(scalarField(raw, 'status')) || 'planning';
  const verdict = resolveSliceAuthority({
    hasRecord: Boolean(tracked),
    ledgerStatus: tracked ? tracked.status : null,
    boardStatus,
    doneProven: successfulDeploymentReceipts(record),
    boardIsSlice: scalarField(raw, 'type') === 'slice',
  });
  assertProjectableStatus(verdict);
  return statusMap[verdict.status];
}
```

**Correctness note:** original returns `projectionMapping('implementing')` on demotion = `{column:'In Progress',status:'in_progress',complete:false}`, identical to `statusMap.in_progress`. The ledger branch previously returned `tracked` (the phase mapping object). `tracked.status` ∈ {in_progress, parked, blocked, completed} — all keys of `statusMap`, and `statusMap[tracked.status]` equals `tracked` for each (verify: `parked`→In Progress/parked/false ✓; `blocked`→Blocked/blocked/false ✓; `completed`→Completed/completed/true, reached only when proven ✓). Board branch parity holds by the same map.

- [ ] **Step 8: Run the coordinator harness again**

Run: `node platform/test/run-codex-autoloop.js`
Expected: `CODEX-AUTOLOOP PASS (2683 assertions)`.

- [ ] **Step 9: Commit**

```bash
git add -u scripts/autoloop/codex-coordinator.js
git add platform/mechanisms/delivery/scripts/delivery-topology.js platform/test/run-delivery-topology.js
git commit -m "fix(delivery): single enforced resolver for board-vs-ledger slice authority"
```

---

## Task 5: Card-intake consumes shared topology; delete the mirror

**Files:**
- Modify: `.agents/skills/card-intake/scripts/card-intake.js`

**Regression oracle:** `run-card-intake.js`.

- [ ] **Step 1: Delete intake's `physicalProjectPrefix`** (lines ~149-163) and replace with a thin non-throwing wrapper over the shared authority:

```js
// Non-throwing wrapper over the shared canonical authority
// (delivery.topology.physicalProjectPrefix). Returns '' for a non-vault /
// fixture root instead of throwing, so fixtures keep legacy caller-derived
// behavior; the canonical logic itself is no longer duplicated here.
function safePhysicalProjectPrefix(cardsRoot) {
  if (!cardsRoot) return '';
  try { return delivery.topology.physicalProjectPrefix(cardsRoot).prefix; }
  catch (_) { return ''; }
}
```

- [ ] **Step 2: Update `projectPrefix`** (lines ~171-177) to call the wrapper:

```js
function projectPrefix(spec) {
  return safePhysicalProjectPrefix(spec.cards_root)
    || (() => {
      const source = normalizePath(spec.source_board || '');
      return source && !path.isAbsolute(source) ? path.posix.dirname(source) : '';
    })();
}
```

- [ ] **Step 3: Update `parentBoardRef`** (lines ~183-188) to use the shared builder:

```js
function parentBoardRef(spec) {
  const prefix = safePhysicalProjectPrefix(spec.cards_root);
  const board = normalizePath(spec.board_path || '');
  if (prefix && board) return delivery.topology.parentBoardRef(prefix, path.posix.basename(board));
  return spec.source_board || spec.board_path;
}
```

- [ ] **Step 4: Update `epicRoute`** (lines ~190-201) so `atlas_ref`/`board_ref` come from the shared builder when a canonical prefix resolves, preserving the `prefix === '.'`/'' fallback for fixtures:

```js
function epicRoute(spec, epic) {
  const prefix = projectPrefix(spec);
  const canonical = prefix && prefix !== '.' ? delivery.topology.epicBindingPaths(prefix, epic) : null;
  const relative = (...parts) => normalizePath(path.posix.join(prefix === '.' ? '' : prefix, 'tasks', epic, ...parts));
  return {
    epic,
    root: path.join(spec.cards_root, epic),
    atlas_path: path.join(spec.cards_root, epic, `${epic}.md`),
    board_path: path.join(spec.cards_root, epic, 'board', `${epic}-board.md`),
    atlas_ref: canonical ? canonical.atlasRef : relative(`${epic}.md`),
    board_ref: canonical ? canonical.boardRef : relative('board', `${epic}-board.md`),
  };
}
```

**Correctness note:** for a canonical vault root `epicBindingPaths(prefix, epic)` equals the old `relative(...)` output (both `<prefix>/tasks/<epic>/...`); the fallback path preserves fixture behavior for `prefix===''`.

- [ ] **Step 5: Run the intake harness**

Run: `node platform/test/run-card-intake.js`
Expected: PASS (unchanged assertion count).

- [ ] **Step 6: Run the slice-plan + integration harnesses intake feeds**

Run: `node platform/test/run-slice-plan.js && node platform/test/run-codex-autoloop.js`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add .agents/skills/card-intake/scripts/card-intake.js
git commit -m "refactor(card-intake): consume shared delivery topology; delete physicalProjectPrefix mirror"
```

---

## Task 6: PR-title bump gate — script + harness + npm target

**Files:**
- Create: `scripts/release/check-title-bump.js`
- Create: `platform/test/run-release-title-gate.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `computePlan`, `getCommits`, `loadManifest` from `scripts/release/compute-release.js`; `parseCommit`, `bumpLevel` from `scripts/release/lib/conventional.js`.
- Produces: `checkTitleBump({ title, commits, manifest }) → {ok, titleLevel, branchLevel, reason}` (pure, testable) + a CLI wrapper.

- [ ] **Step 1: Write the failing harness** — `platform/test/run-release-title-gate.js`:

```js
'use strict';
const assert = require('assert');
const { checkTitleBump } = require('../../scripts/release/check-title-bump');

let count = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); count += 1; };

// Minimal manifest stub: pre-1.0 umbrella, one component owning scripts/release.
const manifest = {
  workshop_version: '0.282.0',
  blueprints: [],
  mechanisms: [{ name: 'release', path: 'scripts/release', version: '0.1.0' }],
};
const commit = (message, files) => ({ hash: 'x', message, files });

// v0.281.1 scenario: a feat commit behind a fix-titled PR => mismatch => fail.
let r = checkTitleBump({
  title: 'fix(loop): tidy things',
  commits: [commit('feat(release): add a verb', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, false, 'feat branch + fix title mismatches');
eq(r.branchLevel, 'minor', 'branch bump is minor');
eq(r.titleLevel, 'patch', 'title bump is patch');

// Agreement: refactor branch + refactor title => patch/patch => pass.
r = checkTitleBump({
  title: 'refactor(release): extract helper',
  commits: [commit('refactor(release): extract helper', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, true, 'agreeing patch/patch passes');

// Non-conventional title => fail loudly (bumper would read none).
r = checkTitleBump({
  title: 'tidy up the release code',
  commits: [commit('fix(release): x', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, false, 'non-conventional title fails');
eq(r.titleLevel, 'none', 'unparseable title => none');

// feat! on a pre-1.0 umbrella => minor; matching feat! title passes.
r = checkTitleBump({
  title: 'feat(release)!: breaking change',
  commits: [commit('feat(release)!: breaking change', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, true, 'breaking pre-1.0 minor agrees');
eq(r.branchLevel, 'minor', 'pre-1.0 breaking => minor');

console.log(`RELEASE-TITLE-GATE PASS (${count} assertions)`);
```

- [ ] **Step 2: Run to verify failure**

Run: `node platform/test/run-release-title-gate.js`
Expected: FAIL — `Cannot find module '.../check-title-bump'`.

- [ ] **Step 3: Implement `scripts/release/check-title-bump.js`**

```js
#!/usr/bin/env node
'use strict';
// PR-title bump gate. Recomputes the release bump two ways and fails when they
// disagree: (a) from the branch's individual commits (what the pre-squash
// bumper sees pre-merge) and (b) from the PR title (the ONLY conventional
// commit the squash-merge bumper actually reads). Catches the v0.281.1 incident
// where a feat branch shipped as a patch behind a fix-titled PR.
const path = require('path');
const { computePlan, getCommits, loadManifest } = require('./compute-release.js');
const { parseCommit, bumpLevel } = require('./lib/conventional.js');

function checkTitleBump({ title, commits, manifest }) {
  const isPre1 = String(manifest.workshop_version).startsWith('0.');
  const parsedTitle = parseCommit(String(title || '').trim());
  const titleLevel = parsedTitle ? bumpLevel(parsedTitle, isPre1) : 'none';
  const branchLevel = computePlan(commits, manifest).workshop.level;
  const ok = Boolean(parsedTitle) && titleLevel === branchLevel;
  const reason = !parsedTitle
    ? `PR title is not a conventional-commit header: "${title}"`
    : (ok ? 'title bump matches branch bump'
      : `PR title bump (${titleLevel}) != branch-commit bump (${branchLevel}); `
        + 'the squash-merge bumper reads the TITLE — fix the title before merge');
  return { ok, titleLevel, branchLevel, reason };
}

module.exports = { checkTitleBump };

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const title = getArg('--title') || process.env.PR_TITLE || '';
  const base = getArg('--base') || 'main';
  const manifest = loadManifest();
  const commits = getCommits(`${base}..HEAD`);
  const result = checkTitleBump({ title, commits, manifest });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error(`\n✗ ${result.reason}`);
    process.exit(1);
  }
  console.log(`\n✓ ${result.reason}`);
}
```

**Verify before running:** confirm `compute-release.js` exports `loadManifest`, `computePlan`, `getCommits` (it does — module.exports line ~204). `loadManifest()` reads `platform/manifest.json` from `REPO_ROOT`; `getCommits(range)` runs `git log` in `REPO_ROOT`.

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-release-title-gate.js`
Expected: `RELEASE-TITLE-GATE PASS (9 assertions)`.

- [ ] **Step 5: Add npm target + wire harness** — in `package.json`:
  - `scripts`: add `"release:check-bump": "node scripts/release/check-title-bump.js"`.
  - `release:preflight` chain: after `node platform/test/run-release-bumper.js`, insert `&& node platform/test/run-release-title-gate.js`.

- [ ] **Step 6: Live dogfood against this very branch** (proves the gate passes for a patch-titled branch)

Run: `node scripts/release/check-title-bump.js --title "fix(delivery): one source of truth for board paths and slice authority" --base main`
Expected: JSON with `"ok": true`, `"branchLevel": "patch"`, `"titleLevel": "patch"`, exit 0. (If `branchLevel` is `minor`, a `feat` commit leaked onto the branch — find and reword it; the branch must be patch-clean.)

- [ ] **Step 7: Commit**

```bash
git add -f scripts/release/check-title-bump.js
git add platform/test/run-release-title-gate.js package.json
git commit -m "ci(release): gate PR-title bump against branch-commit bump"
```

---

## Task 7: Workflow YAML (applied with the Director's temporary token)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Note:** Claude's OAuth cannot push `.github/workflows/*`. This task is staged in the branch but the **push happens using the Director's temporary workflow-scoped token** (they provide it, it's used for one push, then deleted). Because `pull_request` runs the base branch's workflow definition, the gate protects PRs opened *after* this lands on `main`; this PR self-verifies via Task 6 Step 6.

- [ ] **Step 1: Read the current `ci.yml`** to match its `on:`/`jobs:` shape, runner, checkout action version, and Node setup. Do not guess — mirror the existing preflight job's structure.

- [ ] **Step 2: Add a `pr-title-bump` job** on `pull_request`, e.g.:

```yaml
  pr-title-bump:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Gate PR-title bump against branch commits
        run: node scripts/release/check-title-bump.js --title "$PR_TITLE" --base "origin/$BASE_REF"
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
          BASE_REF: ${{ github.base_ref }}
```

(Match the exact `checkout`/`setup-node` versions already used in `ci.yml`. `fetch-depth: 0` is required so `origin/<base>..HEAD` resolves.)

- [ ] **Step 3: Local YAML sanity** (no secrets needed)

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');require('assert').ok(/pr-title-bump/.test(s));console.log('yaml job present')"`
Expected: `yaml job present`. (Full YAML lint deferred to CI once pushed.)

- [ ] **Step 4: Stage but coordinate the push** — commit locally; the actual `git push` of this workflow file uses the Director's temporary token (see the Handoff section). Do not push the branch with Claude's default credentials if it contains the workflow file — the push will be rejected for missing `workflow` scope.

```bash
git add .github/workflows/ci.yml
git commit -m "ci(release): run PR-title bump gate on pull_request"
```

---

## Task 8: Document the authority rule + cycle-close artifacts

**Files:**
- Modify: `Docs/agent-guides/delivery-board.md`
- Modify: `Docs/agent-guides/cycle-status.md`, `Docs/cycle-history.md`, `Docs/landmines.md` (history), `Docs/install.md`
- Create: `Docs/plans/2026-08-04-v<X.Y.Z>-ws2-one-source-of-truth-result.md`, `Docs/prompts/2026-08-04-post-v<X.Y.Z>-next-cycle-handoff.md`

- [ ] **Step 1: Add a "Board vs ledger authority" subsection** to `delivery-board.md` stating rules 1–2 and naming `delivery.topology.resolveSliceAuthority` / `assertProjectableStatus` as the single implementation, plus the `physicalProjectPrefix`/`epicBindingPaths` single-sourcing. Follow the guide's callout/prose conventions.

- [ ] **Step 2: Write the result doc** — surfaces touched, the `effectiveProjectionMapping` divergence discovery (record-only, canonical-slice-gated — deliberately NOT changed), the workflow-token step, spec interpretations, and the commit list. Fill `<X.Y.Z>` only after the bump is known (do NOT hand-pick it — read it from `npm run release:plan` at close, patch-level expected).

- [ ] **Step 3: Update cycle-status + cycle-history + landmines history + install.md** per build-test-verify.md § Cycle-close artifacts.

- [ ] **Step 4: Commit**

```bash
git add Docs/
git commit -m "docs(delivery): state board-vs-ledger authority rule; ws2 cycle-close artifacts"
```

---

## Task 9: Full verification before PR

- [ ] **Step 1: board-health divergence snapshot — before/after are equal**

Run (at branch tip): `node scripts/autoloop/codex-coordinator.js board-health --json > /tmp/ws2-bh-after.json`. Compare the divergence class COUNTS to a snapshot taken from `main` at the same board (`git stash`/second checkout or run against the same bound board pre-change). Expected: identical divergence classes — the refactor changed no projection.

- [ ] **Step 2: Full preflight**

Run: `npm run release:preflight`
Expected: whole-suite GREEN. If `run-sticky-notes-render-guards.js` fails, re-run it in isolation (known ~50% flake, `PERF-7-HARNESS`); do NOT fold a fix in. All else must be green first try.

- [ ] **Step 3: Bumped-state preflight (clean tree)**

Run: `npm run release:preflight-bumped`
Expected: GREEN (proves `prepare-release` won't wedge; the new harnesses read the version snapshot SSOT, not literals).

- [ ] **Step 4: Confirm branch bump is patch**

Run: `npm run release:plan`
Expected: workshop bump = **patch**. If minor, a `feat` leaked — reword before opening the PR.

- [ ] **Step 5: Self-install dogfood**

Run: `node platform/install.js --vault . --auto-approve`
Expected: exits 0, no history errors.

---

## Execution Handoff

**Push protocol for Task 7:** the branch push that includes `.github/workflows/ci.yml` must use the Director's temporary workflow-scoped token. Sequence: land Tasks 1–6 + 8–9 first, push the branch normally (no workflow file yet), open the PR; then apply Task 7's commit and push it with the temporary token; the Director deletes the token afterward.

**PR title (decides the bump):** `fix(delivery): one source of truth for board paths and slice authority` — a **patch**. The item-3 gate will (once live) require the branch to be patch-clean; Task 9 Step 4 confirms it before opening.

## Self-Review (against the spec)

- **Item 1** — Tasks 1–3 (topology extraction + coordinator) + Task 5 (intake mirror deleted). ✓
- **Item 2** — Task 4 (`resolveSliceAuthority` + `assertProjectableStatus`, routed through `deriveEpicProjection` + `noteProjectionMapping`; board-health check 4 covered transitively via `deriveEpicProjection`) + Task 8 Step 1 (documented). `effectiveProjectionMapping`/`projectedRecordMapping` explicitly scoped out and surfaced. ✓
- **Item 3** — Task 6 (script + harness + npm) + Task 7 (workflow). ✓
- **Patch discipline / gate self-consistency** — Global Constraints + Task 9 Step 4. ✓
- **board-health before/after** — Task 9 Step 1. ✓
- **No placeholders:** all code steps carry real code; `<X.Y.Z>` in Task 8 is deliberately deferred (the bumper owns it) and explicitly instructed to be read, not invented. ✓
