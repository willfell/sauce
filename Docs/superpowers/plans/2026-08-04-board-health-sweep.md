# Board-Health Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A report-only `board-health` coordinator verb whose five checks start from the board (not the ledger), closing the blind spot where a board member with no ledger record is unreachable by every existing check.

**Architecture:** One new command in `scripts/autoloop/codex-coordinator.js` reusing `canonicalEpicProjection`, `deriveEpicProjection`, `planEpicBindingHeal`, `parseBoard`, and Loop Station's frontmatter-only write discipline. Only check 1 (untracked members) is new logic. A launchd installer script (cowork-reconciler pattern) schedules it hourly per loop-bound repo.

**Tech Stack:** Node (no deps), existing coordinator helpers, `platform/test/run-codex-autoloop.js` harness, `platform/schemas-index.json` registry.

**Spec:** `Docs/superpowers/specs/2026-08-04-board-health-sweep-design.md` (approved — receipt shape, five checks, write rules, failure handling, ten `BH-*` tests are all defined there).

## Global Constraints

- Report-only: the verb NEVER auto-heals, never blocks, never changes completion semantics.
- Read-only is the default; only `--write-note` touches the vault. Zero writes when findings are unchanged.
- Sweep-level failure is loud: `ok: false` + stable code, never `no_op: true`. Silence must mean "checked and clean".
- Per-epic isolation: one throwing epic is a finding, not an abort.
- Never hand-version, hand-tag, or edit the tap; no `Co-authored-by: Claude` trailer; stage explicit files (never `git add -A`).
- PR title must be `feat(coordinator): …` — the squash title is the only conventional commit the bumper sees.
- Never run two copies of `run-codex-autoloop.js` concurrently.
- One branch, one PR, isolated to this workstream.

## Spec interpretations (decided here, flagged to the Director)

1. **Check 1 exempts pre-claim `planning` notes.** A literal set difference would report every unclaimed slice and make `no_op: true` unreachable on any non-empty ledgerless board — but the spec requires `no_op` to remain reachable in that state. So an untracked member is a finding only when its note's normalized status is `in_progress`, `parked`, `blocked`, or `completed` (work the ledger can't account for). `planning` with no record is the normal pre-claim state.
2. **`lane_divergence` membership:** an entry is emitted when the lanes disagree OR when the epic carries untracked-member findings (that is the "looked broken but was correct" case the spec requires agreement reporting for). A fully healthy epic emits nothing, keeping `no_op: true` reachable (spec: "`no_op: true` when every class is empty").
3. **The `BoardHealth` customjs renderer does not exist yet.** The scaffold body is the stock customjs-guard block per spec; until a renderer ships, the guard shows its standard "unavailable" hint and the data lives in frontmatter. Renderer is render-layer, deferred (consistent with spec's deferred list).

## File Structure

- Modify: `scripts/autoloop/codex-coordinator.js` — add `collectBoardHealth`, `buildBoardHealthPayload`, `validateBoardHealthPayload`, `writeBoardHealthNote`, `commandBoardHealth`; register in `STRICT_CLI_OPTIONS`, `main()`, usage string, exports.
- Modify: `platform/test/run-codex-autoloop.js` — one `BH` fixture-builder + ten `BH-*` test blocks (+ launchd render assertions).
- Create: `scripts/autoloop/board-health-launchd.js` — plist render + install per repo.
- Create: `Docs/install/board-health-launchd.plist.template`.
- Modify: `platform/schemas-index.json` — register `sauce.board-health.v1`.
- Modify: `Docs/agent-guides/delivery-board.md` — document the verb.
- Create at close: `Docs/plans/2026-08-04-v<X.Y.Z>-board-health-sweep-{design,plan,result}.md`, cycle-history/cycle-status/install/handoff updates.

## Interfaces (produced, used by all tasks)

```js
// receipt core (also the note payload minus caps):
// { project, ledger: 'present'|'empty'|'absent',
//   checked: { epics, slices, records },
//   findings: { untracked_members: [{epic, card, note_status, issue, remedy}],
//               unprojectable_epics: [{epic, error, remedy}],
//               binding_drift: {atlases, slices, orphan_lines, remedy} | {error, remedy},
//               lane_divergence: [{epic, derived, painted, agrees}],
//               projection_errors: [{card, phase, error}] } }
async function commandBoardHealth(ctx, args, deps = {})  // deps: boardPath, cardsRoot, readState, withLock, exists, readText, writeText, ensureDir
function collectBoardHealth(state, opts)                  // opts: boardPath, cardsRoot, ledger, exists, readText
function buildBoardHealthPayload(core)                    // caps lists at 20 + *_overflow_count; type/schema_version fields
function validateBoardHealthPayload(payload)              // {ok, errors}
function writeBoardHealthNote(payload, notePath, deps)    // {path, changed, scaffolded} | throws (caught into note_error)
```

---

### Task 1: Fixture builder + BH-UNTRACKED (red → green core collection: checks 1, 5, receipt envelope)

Test fixture builder (top of the BH section in `run-codex-autoloop.js`), modeled on BPX-HEAL's `scaffold`:

```js
// BH board-health: board-driven divergence sweep. Fixtures scaffold canonical
// epics exactly like BPX-HEAL so canonicalEpicProjection accepts them.
const bhScaffold = (root, { epics = {}, planning = [], progress = [], completed = [] } = {}) => {
  const projectRoot = path.join(root, 'spice', 'projects', 'test');
  const cardsRoot = path.join(projectRoot, 'tasks');
  const boardPath = path.join(projectRoot, 'project-board.md');
  const prefix = 'spice/projects/test';
  fs.mkdirSync(cardsRoot, { recursive: true });
  fs.writeFileSync(boardPath, liveBoard({ planning, progress, completed }));
  for (const [epic, spec] of Object.entries(epics)) {
    const boardDir = path.join(cardsRoot, epic, 'board');
    fs.mkdirSync(boardDir, { recursive: true });
    fs.mkdirSync(path.join(cardsRoot, epic, 'context', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(cardsRoot, epic, `${epic}.md`), [
      '---', 'type: epic', 'schema_version: 1.1.0',
      ...(spec.atlasLines || [
        `source_board: ${prefix}/project-board.md`, `kanban_board: ${prefix}/project-board.md`,
        `epic_board: ${prefix}/tasks/${epic}/board/${epic}-board.md`,
      ]),
      'status: planning', 'posture: claimable', '---', '', `${epic} atlas body`, '',
    ].join('\n'));
    const lanes = { 'In Planning': [], 'In Progress': [], 'Blocked': [], 'Completed': [], ...(spec.lanes || {}) };
    fs.writeFileSync(path.join(boardDir, `${epic}-board.md`), [
      '---', 'kanban-plugin: board', 'board_role: epic', `epic: "[[${epic}]]"`, '---', '',
      ...Object.entries(lanes).flatMap(([lane, names]) => [
        `## ${lane}`, ...names.map((n) => `- [${lane === 'Completed' ? 'x' : ' '}] [[${n}]]`), '',
      ]),
    ].join('\n'));
    for (const [name, status] of Object.entries(spec.slices || {})) {
      if (status === null) continue; // orphan board line: note deliberately absent
      fs.writeFileSync(path.join(boardDir, `${name}.md`), [
        '---', 'type: slice', 'schema_version: 1.1.0', `epic: "[[${epic}]]"`,
        `task_parent: ${prefix}/tasks/${epic}/${epic}.md`,
        `source_board: ${prefix}/tasks/${epic}/board/${epic}-board.md`,
        `kanban_board: ${prefix}/tasks/${epic}/board/${epic}-board.md`,
        `status: ${status}`, 'depends_on: []', '---', '', `${name} body`, '',
      ].join('\n'));
    }
  }
  return { projectRoot, cardsRoot, boardPath };
};
const bhDeps = (fx, extra = {}) => ({
  boardPath: fx.boardPath, cardsRoot: fx.cardsRoot,
  withLock: async (_c, _n, fn) => fn(), ...extra,
});
```

- [ ] **Step 1: Write the failing BH-UNTRACKED test** — the literal EM-4/5/6 shape: six completed board members, ledger knows three.

```js
// BH-UNTRACKED — the load-bearing blind-spot test: a board member with no
// ledger record must be reported. Fixture is literally EM-4/5/6: an epic whose
// board shows six slices complete while the ledger knows only three.
{
  const root = path.join(tmp, 'bh-untracked');
  const fx = bhScaffold(root, {
    progress: ['Retire ero loop'],
    epics: {
      'Retire ero loop': {
        lanes: { Completed: ['EM-1', 'EM-2', 'EM-3', 'EM-4', 'EM-5', 'EM-6'] },
        slices: { 'EM-1': 'completed', 'EM-2': 'completed', 'EM-3': 'completed', 'EM-4': 'completed', 'EM-5': 'completed', 'EM-6': 'completed' },
      },
    },
  });
  const state = emptyState();
  for (const name of ['EM-1', 'EM-2', 'EM-3']) {
    state.cards[name] = {
      card: name, phase: 'deployed', required_version: '0.233.0',
      vault_receipts: successfulVaultReceipts(),
    };
  }
  const receipt = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, { json: true },
    bhDeps(fx, { readState: () => state }));
  eq(receipt.action, 'board-health', 'BH-UNTRACKED reports the board-health action');
  eq(receipt.ok, true, 'BH-UNTRACKED succeeds');
  eq(receipt.no_op, false, 'BH-UNTRACKED divergence is never a no-op');
  eq(receipt.ledger, 'present', 'BH-UNTRACKED a populated ledger reads as present');
  eq(receipt.findings.untracked_members.map((f) => f.card), ['EM-4', 'EM-5', 'EM-6'],
    'BH-UNTRACKED reports exactly the board members the ledger has never heard of');
  eq(receipt.findings.untracked_members[0], {
    epic: 'Retire ero loop', card: 'EM-4', note_status: 'completed',
    issue: 'board member has no ledger record; a completed note is never counted done',
    remedy: 'investigate: work completed outside the rail',
  }, 'BH-UNTRACKED finding carries the epic, note status, issue, and non-mechanical remedy');
  eq(receipt.checked, { epics: 1, slices: 6, records: 3 }, 'BH-UNTRACKED counts what it checked');
  ok(!receipt.findings.untracked_members.some((f) => ['EM-1', 'EM-2', 'EM-3'].includes(f.card)),
    'BH-UNTRACKED tracked members are not reported');
}
```

- [ ] **Step 2: Run to verify it fails** — `node platform/test/run-codex-autoloop.js` → FAIL `commandBoardHealth is not a function`.
- [ ] **Step 3: Implement the minimal core** in `codex-coordinator.js` (after `commandHealEpicBindings`): `collectBoardHealth` + `commandBoardHealth` with checks 1 and 5, envelope per cli-kit, ledger tri-state (`present` = records exist; else `empty` if `ctx.statePath` exists; else `absent`), selector lock via injected `withLock`. Untracked rule: member absent from `state.cards` AND normalized note status in `{in_progress, parked, blocked, completed}`. Issue text: completed → `board member has no ledger record; a completed note is never counted done`; otherwise → ``board member has no ledger record; the note claims ${status} with no coordinator history``. Remedy (both): `investigate: work completed outside the rail`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(coordinator): board-health check 1+5 — board-driven untracked-member detection`.

### Task 2: BH-LEDGERLESS (explicit degradation)

- [ ] **Step 1: Failing test** — same fixture shape, empty `state.json` written to disk (so ledger reads `empty`), plus a variant with no state file at all (`absent`).

```js
// BH-LEDGERLESS — the sweep survives the failure it exists to catch: with an
// empty ledger checks 1–3 still report, checks 4–5 contribute nothing, and the
// receipt says so explicitly so "clean" can never mean "couldn't check".
{
  const root = path.join(tmp, 'bh-ledgerless');
  const fx = bhScaffold(root, {
    progress: ['Retire ero loop'],
    epics: { 'Retire ero loop': {
      lanes: { Completed: ['EM-4', 'EM-5', 'EM-6'] },
      slices: { 'EM-4': 'completed', 'EM-5': 'completed', 'EM-6': 'completed' },
    } },
  });
  const statePath = path.join(root, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(emptyState()));
  const receipt = await coordinator.commandBoardHealth({ root, statePath }, { json: true },
    bhDeps(fx, { readState: () => emptyState() }));
  eq(receipt.ledger, 'empty', 'BH-LEDGERLESS an empty ledger is named, not hidden');
  eq(receipt.checked.records, 0, 'BH-LEDGERLESS zero records checked is explicit');
  eq(receipt.findings.untracked_members.map((f) => f.card), ['EM-4', 'EM-5', 'EM-6'],
    'BH-LEDGERLESS check 1 needs no ledger');
  eq(receipt.findings.binding_drift, { atlases: 0, slices: 0, orphan_lines: 0, remedy: 'heal-epic-bindings --dry-run --json' },
    'BH-LEDGERLESS check 3 needs no ledger');
  eq(receipt.findings.lane_divergence, [], 'BH-LEDGERLESS check 4 is skipped, not failed');
  eq(receipt.findings.projection_errors, [], 'BH-LEDGERLESS check 5 is skipped, not failed');
  const absent = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'nope.json') }, { json: true },
    bhDeps(fx, { readState: () => emptyState() }));
  eq(absent.ledger, 'absent', 'BH-LEDGERLESS a missing state file reads as absent');
}
```

- [ ] **Step 2: red** (binding_drift not implemented yet → fail).
- [ ] **Step 3:** wire check 3 (`planEpicBindingHeal` counts + remedy, wrapped in try/catch → `{error, remedy}` on throw) and the `ledger !== 'present'` skip for checks 4–5.
- [ ] **Step 4: green.**
- [ ] **Step 5: Commit** `feat(coordinator): board-health explicit ledgerless degradation + binding-drift counts`.

### Task 3: BH-UNPROJECTABLE + BH-CONTAINMENT (check 2, per-epic isolation)

- [ ] **Step 1: Failing tests** — one epic with absolute atlas bindings (throws in `canonicalEpicProjection`), one healthy sibling, plus a parent-board member with no scaffold at all:

```js
// BH-UNPROJECTABLE / BH-CONTAINMENT — one throwing epic is a finding, not an
// abort; siblings are still fully checked.
{
  const root = path.join(tmp, 'bh-unprojectable');
  const fx = bhScaffold(root, {
    planning: ['Frozen Epic', 'Healthy Epic', 'Ghost Epic'],
    epics: {
      'Frozen Epic': {
        atlasLines: [
          `source_board: "${path.join(root, 'spice', 'projects', 'test', 'project-board.md')}"`,
          `kanban_board: "${path.join(root, 'spice', 'projects', 'test', 'project-board.md')}"`,
          'epic_board: "tasks/Frozen Epic/board/Frozen Epic-board.md"',
        ],
        lanes: { 'In Planning': ['FZ-1'], Completed: ['FZ-2'] },
        slices: { 'FZ-1': 'planning', 'FZ-2': 'completed' },
      },
      'Healthy Epic': { lanes: { 'In Planning': ['HE-1'] }, slices: { 'HE-1': 'planning' } },
    },
  });
  const receipt = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, { json: true },
    bhDeps(fx, { readState: () => emptyState() }));
  eq(receipt.findings.unprojectable_epics.map((f) => f.epic), ['Frozen Epic', 'Ghost Epic'],
    'BH-UNPROJECTABLE the throwing epic and the scaffold-less member are findings, not aborts');
  ok(/does not bind its canonical parent board/.test(receipt.findings.unprojectable_epics[0].error),
    'BH-UNPROJECTABLE carries the projection refusal verbatim');
  eq(receipt.findings.unprojectable_epics[0].remedy, 'heal-epic-bindings --dry-run --json',
    'BH-UNPROJECTABLE names the mechanical remedy');
  eq(receipt.checked.epics, 3, 'BH-CONTAINMENT every parent member is visited');
  eq(receipt.findings.untracked_members.map((f) => f.card), ['FZ-2'],
    'BH-CONTAINMENT check 1 still reaches members of an unprojectable epic');
  ok(receipt.findings.binding_drift.atlases >= 1, 'BH-CONTAINMENT check 3 still reports the frozen atlas drift');
}
```

- [ ] **Step 2: red** (unprojectable_epics missing).
- [ ] **Step 3:** implement the per-epic try/catch structure: outer catch for board-read failure, member enumeration + check 1 BEFORE projection, inner try for `canonicalEpicProjection` seeded with the first existing slice note; scaffold-less member → unprojectable with `error: 'board member has neither an epic scaffold nor a note'`.
- [ ] **Step 4: green.**
- [ ] **Step 5: Commit** `feat(coordinator): board-health per-epic containment + unprojectable-epic findings`.

### Task 4: BH-LANE (check 4)

- [ ] **Step 1: Failing test:**

```js
// BH-LANE — derived state vs painted lane, including the agreeing case: the
// "Retire ero_loop" shape looked broken but was correct, and only showing
// derived beside painted answers "wrong, or telling me something?".
{
  const root = path.join(tmp, 'bh-lane');
  const fx = bhScaffold(root, {
    planning: ['Stale Epic'], progress: ['Looks Broken Epic'],
    epics: {
      'Stale Epic': { lanes: { 'In Progress': ['ST-1'] }, slices: { 'ST-1': 'in_progress' } },
      'Looks Broken Epic': {
        lanes: { 'In Progress': ['LB-2'], Completed: ['LB-1'] },
        slices: { 'LB-1': 'completed', 'LB-2': 'in_progress' },
      },
    },
  });
  const state = emptyState();
  state.cards['ST-1'] = { card: 'ST-1', phase: 'implementing' };
  state.cards['LB-2'] = { card: 'LB-2', phase: 'implementing' };
  const receipt = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, { json: true },
    bhDeps(fx, { readState: () => state }));
  const byEpic = Object.fromEntries(receipt.findings.lane_divergence.map((f) => [f.epic, f]));
  eq(byEpic['Stale Epic'], { epic: 'Stale Epic', derived: 'active', painted: 'In Planning', agrees: false },
    'BH-LANE a stale parent lane is reported as disagreement');
  eq(byEpic['Looks Broken Epic'], { epic: 'Looks Broken Epic', derived: 'active', painted: 'In Progress', agrees: true },
    'BH-LANE an epic with untracked members reports its agreeing lane too');
  ok(!receipt.findings.lane_divergence.some((f) => f.agrees && f.epic === 'Stale Epic'),
    'BH-LANE entries are one per epic');
}
```

(`Looks Broken Epic` has untracked member LB-1 → lane entry emitted even though lanes agree.)

- [ ] **Step 2: red.**
- [ ] **Step 3:** implement check 4 inside the projection try-block: `deriveEpicProjection(surface, null, null)` → `epicProjectionMapping(lifecycle.state)`; painted from `boardCardLocation(parentRaw, epic)`; `agrees = painted.column === mapping.column && painted.checked === mapping.complete`; emit when `!agrees` or epic has untracked findings; only when `ledger === 'present'`.
- [ ] **Step 4: green.**
- [ ] **Step 5: Commit** `feat(coordinator): board-health lane divergence with agreement reporting`.

### Task 5: BH-NOOP + BH-READONLY

- [ ] **Step 1: Failing tests:**

```js
// BH-NOOP / BH-READONLY — a healthy board is a no-op, and without --write-note
// nothing in the vault is ever touched.
{
  const root = path.join(tmp, 'bh-noop');
  const fx = bhScaffold(root, {
    progress: ['Calm Epic'],
    epics: { 'Calm Epic': {
      lanes: { 'In Planning': ['CA-2'], 'In Progress': ['CA-1'] },
      slices: { 'CA-1': 'in_progress', 'CA-2': 'planning' },
    } },
  });
  const state = emptyState();
  state.cards['CA-1'] = { card: 'CA-1', phase: 'implementing' };
  let writes = 0;
  const receipt = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, { json: true },
    bhDeps(fx, { readState: () => state, writeText: () => { writes++; } }));
  eq(receipt.no_op, true, 'BH-NOOP a healthy fully-checked board is a no-op');
  eq(receipt.ledger, 'present', 'BH-NOOP healthy means checked, not unchecked');
  eq(receipt.findings, {
    untracked_members: [], unprojectable_epics: [],
    binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, remedy: 'heal-epic-bindings --dry-run --json' },
    lane_divergence: [], projection_errors: [],
  }, 'BH-NOOP every finding class is empty');
  eq(writes, 0, 'BH-READONLY the default invocation performs zero writes');
  ok(!fs.existsSync(path.join(fx.projectRoot, 'Board Health.md')),
    'BH-READONLY no vault note is created without --write-note');
}
```

- [ ] **Step 2: red** (no_op logic missing).
- [ ] **Step 3:** implement `no_op` = every list empty AND drift counts zero AND no drift error.
- [ ] **Step 4: green.**
- [ ] **Step 5: Commit** `feat(coordinator): board-health no_op semantics`.

### Task 6: BH-SCAFFOLD + BH-BODY (the vault note, Loop Station discipline)

- [ ] **Step 1: Failing tests:**

```js
// BH-SCAFFOLD / BH-BODY — Loop Station's proven write discipline, inherited
// verbatim: scaffold once, frontmatter-only thereafter, byte-identical no-op
// writes nothing, body-only notes fail closed without discarding findings.
{
  const root = path.join(tmp, 'bh-note');
  const fx = bhScaffold(root, {
    progress: ['Note Epic'],
    epics: { 'Note Epic': { lanes: { Completed: ['NT-1'] }, slices: { 'NT-1': 'completed' } } },
  });
  const notePath = path.join(fx.projectRoot, 'Board Health.md');
  const deps = bhDeps(fx, { readState: () => emptyState() });
  const first = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') },
    { json: true, 'write-note': true }, deps);
  eq(first.note.scaffolded, true, 'BH-SCAFFOLD an absent note is scaffolded once');
  ok(fs.existsSync(notePath), 'BH-SCAFFOLD the note lands beside the board');
  const raw = fs.readFileSync(notePath, 'utf8');
  ok(/class: "BoardHealth"/.test(raw), 'BH-SCAFFOLD body is the stock BoardHealth customjs-guard block');
  eq(testScalarField(raw, 'type'), 'board-health', 'BH-SCAFFOLD payload type is registered');
  eq(testScalarField(raw, 'schema_version'), '1.0.0', 'BH-SCAFFOLD payload carries its schema version');
  ok(!/checked_at|updated_at/.test(raw.split('---')[1]), 'BH-SCAFFOLD no timestamp field — rule 3 is load-bearing');

  const replay = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') },
    { json: true, 'write-note': true }, deps);
  eq(replay.note.changed, false, 'BH-SCAFFOLD same findings twice writes nothing');
  eq(fs.readFileSync(notePath, 'utf8'), raw, 'BH-NOOP unchanged findings leave the note byte-identical');

  // Body preservation: a user edit below the frontmatter survives a changed sweep.
  const customBody = `${raw}\nMy notes about this board.\n`;
  fs.writeFileSync(notePath, customBody);
  fs.writeFileSync(path.join(fx.cardsRoot, 'Note Epic', 'board', 'NT-2.md'),
    fs.readFileSync(path.join(fx.cardsRoot, 'Note Epic', 'board', 'NT-1.md'), 'utf8').replaceAll('NT-1', 'NT-2'));
  fs.writeFileSync(path.join(fx.cardsRoot, 'Note Epic', 'board', 'Note Epic-board.md'),
    fs.readFileSync(path.join(fx.cardsRoot, 'Note Epic', 'board', 'Note Epic-board.md'), 'utf8')
      .replace('- [x] [[NT-1]]', '- [x] [[NT-1]]\n- [x] [[NT-2]]'));
  const changed = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') },
    { json: true, 'write-note': true }, deps);
  eq(changed.note.changed, true, 'BH-BODY changed findings patch the frontmatter');
  const patched = fs.readFileSync(notePath, 'utf8');
  ok(patched.endsWith('My notes about this board.\n'), 'BH-BODY the body is preserved byte-for-byte');

  // Fail closed: body-only note (no frontmatter) is never rewritten.
  fs.writeFileSync(notePath, 'just a body, no frontmatter\n');
  const failed = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') },
    { json: true, 'write-note': true }, deps);
  eq(failed.ok, true, 'BH-BODY note failure does not fail the sweep');
  ok(/without frontmatter/.test(failed.note_error), 'BH-BODY a body-only note fails closed with a visible note_error');
  eq(failed.findings.untracked_members.length, 2, 'BH-BODY findings are never discarded by a note failure');
  eq(fs.readFileSync(notePath, 'utf8'), 'just a body, no frontmatter\n', 'BH-BODY the body-only note is untouched');
}
```

- [ ] **Step 2: red.**
- [ ] **Step 3:** implement `buildBoardHealthPayload` (type/schema_version/project/ledger/no_op/checked + capped lists with `*_overflow_count`, NO timestamp), `validateBoardHealthPayload`, `writeBoardHealthNote` (scaffold / frontmatter-patch / byte-identical no-write / throw on body-only), wire `--write-note` in `commandBoardHealth` with try/catch → `note` | `note_error`.
- [ ] **Step 4: green.**
- [ ] **Step 5: Commit** `feat(coordinator): Board Health vault note under Loop Station write discipline`.

### Task 7: BH-LOCKED (lock contention is a finding, not a crash)

- [ ] **Step 1: Failing test:**

```js
// BH-LOCKED — a held selector lock yields a clean skip receipt: a live loop
// session must never produce a spurious alarm, and hourly means soon.
{
  const root = path.join(tmp, 'bh-locked');
  const fx = bhScaffold(root, { epics: {} });
  let writes = 0;
  const locked = await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, { json: true },
    bhDeps(fx, {
      readState: () => emptyState(), writeText: () => { writes++; },
      withLock: async () => { const e = new Error('lock selector held by pid 123'); e.code = 'LOCKED'; throw e; },
    }));
  eq(locked.action, 'board-health', 'BH-LOCKED skip is still a board-health receipt');
  eq(locked.ok, true, 'BH-LOCKED a busy board is a clean exit');
  eq(locked.skipped, true, 'BH-LOCKED the receipt says it skipped');
  ok(/board busy/.test(locked.reason), 'BH-LOCKED the reason is plain');
  ok(!locked.findings, 'BH-LOCKED a skip carries no findings so it cannot read as "checked and clean"');
  eq(writes, 0, 'BH-LOCKED no write happens on a skip');
}
```

- [ ] **Step 2: red.** **Step 3:** catch `err.code === 'LOCKED'` around the lock call → `{action, ok: true, no_op: true, skipped: true, reason: 'selector lock held; board busy — skipped without checking', lock_owner}`. **Step 4: green.**
- [ ] **Step 5: Commit** `feat(coordinator): board-health clean skip under selector-lock contention`.

### Task 8: CLI wiring + refusals + schema registration

- [ ] **Step 1: Failing tests** — spawn-level: unknown option refused, missing `--json` refused, unreadable board → `ok:false` stable code (never `no_op`); schema entry present:

```js
// BH sweep-level failure is loud: unreadable board/cards-root refuses with a
// stable code; silence must mean "checked and clean", never "couldn't check".
{
  const root = path.join(tmp, 'bh-refusals');
  const fx = bhScaffold(root, { epics: {} });
  await assert.rejects(
    () => coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, {}, bhDeps(fx, { readState: () => emptyState() })),
    /requires --json/, 'BH refusal: --json is mandatory');
  let refusal = null;
  try {
    await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, { json: true },
      bhDeps({ boardPath: path.join(root, 'missing-board.md'), cardsRoot: fx.cardsRoot }, { readState: () => emptyState() }));
  } catch (err) { refusal = err; }
  eq(refusal && refusal.code, 'board_unreadable', 'BH refusal: unreadable board carries a stable code');
  let rootRefusal = null;
  try {
    await coordinator.commandBoardHealth({ root, statePath: path.join(root, 'state.json') }, { json: true },
      bhDeps({ boardPath: fx.boardPath, cardsRoot: root }, { readState: () => emptyState() }));
  } catch (err) { rootRefusal = err; }
  eq(rootRefusal && rootRefusal.code, 'cards_root_invalid', 'BH refusal: a non-project cards root carries a stable code');
  const schemaIndex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas-index.json'), 'utf8'));
  ok(schemaIndex.schemas.some((s) => s.id === 'sauce.board-health.v1'),
    'BH sauce.board-health.v1 is registered in the schema index');
}
```

- [ ] **Step 2: red.** **Step 3:** `STRICT_CLI_OPTIONS['board-health'] = ['json', 'write-note']`; dispatch in `main()`; usage string; exports (`commandBoardHealth`, `collectBoardHealth`, `buildBoardHealthPayload`, `validateBoardHealthPayload`); `refuse('board-health-refused', 'board_unreadable' | 'cards_root_invalid' | 'state_unreadable', …)`; add the `sauce.board-health.v1` entry to `platform/schemas-index.json` (source/validator `scripts/autoloop/codex-coordinator.js`, consumers `platform/test/run-codex-autoloop.js`). **Step 4: green** + `npm run lint-schemas` green.
- [ ] **Step 5: Commit** `feat(coordinator): board-health CLI wiring, loud refusal codes, schema registration`.

### Task 9: Launchd scheduling (hourly, per loop-bound repo)

- [ ] **Step 1: Failing test** — pure render assertions in `run-codex-autoloop.js`:

```js
// BH-LAUNCHD — hourly per-repo schedule via the cowork-reconciler pattern.
{
  const { renderBoardHealthPlist } = require('../../scripts/autoloop/board-health-launchd');
  const plist = renderBoardHealthPlist({
    user: 'tester', home: '/Users/tester', nodePath: '/usr/local/bin/node',
    coordinatorPath: '/opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js',
    repoPath: '/Users/tester/repo', slug: 'test-project',
  });
  ok(plist.includes('<string>board-health</string>') && plist.includes('<string>--write-note</string>')
    && plist.includes('<string>--json</string>'), 'BH-LAUNCHD runs the sweep with the note write');
  ok(plist.includes('<key>StartInterval</key>') && plist.includes('<integer>3600</integer>'), 'BH-LAUNCHD is hourly');
  ok(plist.includes('<string>/Users/tester/repo</string>'), 'BH-LAUNCHD cwd is the bound repo');
  ok(plist.includes('com.tester.sauce-board-health.test-project'), 'BH-LAUNCHD one label per repo');
  ok(!plist.includes('{{$'), 'BH-LAUNCHD no template token survives substitution');
}
```

- [ ] **Step 2: red.** **Step 3:** create `Docs/install/board-health-launchd.plist.template` ({{$user}}/{{$home}}/{{$node_path}}/{{$coordinator_path}}/{{$repo_path}}/{{$slug}}, StartInterval 3600, logs `~/Library/Logs/sauce-board-health.<slug>.{log,err}`, PATH env) and `scripts/autoloop/board-health-launchd.js` (`renderBoardHealthPlist` pure; `install(repoPath)` resolves slug from the repo's `.loop/config.json` via `loop-config.js` resolveBinding → `basename(dirname(board_path_abs))`, coordinator from `brew --prefix sauce` + `/libexec/scripts/autoloop/codex-coordinator.js`, node from `process.execPath`; writes plist + `launchctl unload/load -w`; CLI `node scripts/autoloop/board-health-launchd.js install [repoPath]`). **Step 4: green.**
- [ ] **Step 5: Commit** `feat(coordinator): hourly board-health launchd installer per loop-bound repo`.

### Task 10: Docs, preflight, ship

- [ ] Update `Docs/agent-guides/delivery-board.md` with a `board-health` paragraph (verb contract, five checks, read-only default, note discipline, launchd cadence).
- [ ] Cycle docs: `Docs/plans/2026-08-04-v<X.Y.Z>-board-health-sweep-design.md` (pointer to the approved spec), `-plan.md` (this file's content), `-result.md`; `Docs/cycle-history.md` section; `Docs/agent-guides/cycle-status.md`; `Docs/install.md` upgrading note; next-cycle handoff prompt. (Version placeholders resolved after `npm run release:plan` preview; the PR title governs the real bump.)
- [ ] `npm run release:preflight` GREEN (re-run once if only the sticky-notes flake reds).
- [ ] `npm run release:preflight-bumped` on a clean tree — GREEN.
- [ ] Conventional commits pushed on branch `feat/board-health-sweep`; PR against `main` titled `feat(coordinator): board-health sweep — board-driven divergence detection`; verify CI; merge (squash).
- [ ] Post-release: `brew upgrade sauce`; in `~/Documents/GitHub/egnyte-mcp` run the INSTALLED coordinator `board-health --json` → must surface EM-4/5/6 as untracked members (snapshot the board first; check mtimes for live writers before any `--write-note`). Then `node scripts/autoloop/deploy.js run`.
- [ ] Install the launchd job for the bound repos; verify one fire via its log.

## Self-Review

- Spec coverage: all five checks (T1 c1+c5, T2 c3, T3 c2, T4 c4), receipt shape (T1/T2), verb + read-only default (T5/T8), vault note + write rules 1–5 (T6), scheduling (T9), failure handling (T3 containment, T7 lock, T8 loud refusals, T6 note_error), all ten BH-* cases mapped: UNTRACKED→T1, LEDGERLESS→T2, UNPROJECTABLE+CONTAINMENT→T3, LANE→T4, NOOP→T5+T6, READONLY→T5, SCAFFOLD→T6, BODY→T6, LOCKED→T7.
- No placeholders; interfaces consistent (`commandBoardHealth(ctx, args, deps)` everywhere; `note`/`note_error` mutually exclusive).
- Types consistent: findings shapes match the spec receipt example verbatim.
