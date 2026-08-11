# loop:block-review + dependency-hygiene rails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop supersession/never-minted `depends_on` rot from silently blocking the board — repair the existing rot, prevent new rot at discard time, and ship a `loop:block-review` skill that heals + reports.

**Architecture:** Three node-side coordinator additions (a multi-hop supersession-tail resolver, a format-preserving `depends_on` rewriter, and a `reconcile-dependencies` verb), one discard-time dependents-scan hooked into `discardCardCore`, one strengthened intake mint-guard, and one plugin skill (`block-review`) that orchestrates the verb and reports via the Obsidian GraphView signal. Node-side detection reuses the coordinator's own primitives (`parseDependsOn`, `discardedDependencyProblem`, `deployedSupersedingSibling`); `GraphInsights`/`GraphLayout` remain the Obsidian-runtime verification surface, not a node dependency.

**Tech Stack:** Node.js (CommonJS), the sauce coordinator (`scripts/autoloop/codex-coordinator.js`), the card-intake rail (`.agents/skills/card-intake/scripts/card-intake.js`), the loop plugin (`plugins/loop/`), plain-JS test harnesses under `platform/test/` asserted with `assert` + `eq`/`ok` counters.

## Global Constraints

- **Writer authority (non-negotiable):** the coordinator is the only operational writer; card-intake the only planning writer. The new verb + discard-time scan live IN the coordinator; the skill only orchestrates them. Never hand-edit boards/cards from the skill.
- **Active/parked cards are reported, never rewritten** — dependency repair on in-flight work stays `amend-park`/`amend-contract` territory.
- **Multi-hop:** every repair follows the supersession chain to the live tail via `resolveSupersessionTail`, never a single hop. Cycle guard mandatory (visited-set).
- **Conventional commits only.** Never touch versions/tags/release PRs by hand — the release pipeline is automatic (see `Docs/agent-guides/build-test-verify.md`).
- **Read `Docs/agent-guides/delivery-board.md` before Phase A** — it owns tombstone-governance + intake-supersession contracts this extends.
- **Name normalization:** all card-name comparisons go through `normalizeCardLink` (coordinator) / `normalizeIdentity` (delivery lib) so `"[[Card]]"` and bare `Card` collapse. Never string-compare raw frontmatter.
- **Coordinator test harness:** `platform/test/run-codex-autoloop.js` (no standalone `test:*`; runs inside `release:preflight`). Intake tests: `platform/test/run-card-intake.js` (`npm run test:card-intake`, also in preflight).

---

## File Structure

- `scripts/autoloop/codex-coordinator.js` — MODIFY: add `resolveSupersessionTail`, upgrade `discardedDependencyProblem` to multi-hop, add `rewriteDependsOn`, add discard-time scan inside `discardCardCore`, add `commandReconcileDependencies` + CLI wiring + exports.
- `platform/test/run-codex-autoloop.js` — MODIFY: new assertion blocks for A1–A4.
- `.agents/skills/card-intake/scripts/card-intake.js` — MODIFY: strengthen the mint guard at ~489-494.
- `platform/test/run-card-intake.js` — MODIFY: assertions for B1.
- `plugins/loop/skills/block-review/SKILL.md` — CREATE: the skill body.
- `platform/test/run-loop-plugin-surface.js` — MODIFY: add `'block-review'` to `EXPECTED_SKILLS`.
- `.agents/skills/loop-block-review/SKILL.md` + `.agents/skills/loop-block-review/agents/openai.yaml` — CREATE (generated): committed Codex routers.
- `Docs/agent-guides/loop-plugin.md` — MODIFY: skill-surface table row + prose skill list.

---

## Phase A — Coordinator: primitives, verb, discard-time scan

### Task A1: `resolveSupersessionTail` + multi-hop `discardedDependencyProblem`

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` (near `discardedDependencyProblem`, ~1382-1387; add to `module.exports` ~6822-6853)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Produces: `resolveSupersessionTail(dep, state)` → `{ tail: string, hops: string[], deadEnd: boolean, cycle: boolean }`. `tail` is the first NON-discarded name reached by following `state.cards[name].superseded_by` (or the last name if the walk runs out); `hops` is the ordered list of tombstone names traversed (excluding the tail); `deadEnd` is true when the walk terminated at a discarded record with no successor (the tail is itself still a tombstone → not a valid repoint target); `cycle` true if a `superseded_by` loop was detected. A live tail (`deadEnd:false, cycle:false`) is always a valid repoint target regardless of its phase (deployed/planned/claimed) — `dependencySatisfied` already treats a deployed dep as satisfied, so repointing to it never blocks.
- Produces: upgraded `discardedDependencyProblem(dep, state)` — message now names the live tail: `depends on discarded card ${dep} (superseded by ${tail})` when a tail differs from the immediate hop.

- [ ] **Step 1: Write the failing tests**

Add near the other coordinator-unit assertions in `platform/test/run-codex-autoloop.js`:

```js
// A1 resolveSupersessionTail — multi-hop chain to the live tail
{
  const state = emptyState();
  state.cards['BL-4'] = { card: 'BL-4', phase: 'discarded', superseded_by: 'BL-4b' };
  state.cards['BL-4b'] = { card: 'BL-4b', phase: 'discarded', superseded_by: 'BL-4c' };
  state.cards['BL-4c'] = { card: 'BL-4c', phase: 'deployed' };
  const r = coordinator.resolveSupersessionTail('BL-4', state);
  eq(r.tail, 'BL-4c', 'A1 follows BL-4 → BL-4b → BL-4c to the live tail');
  eq(r.hops, ['BL-4', 'BL-4b'], 'A1 records the traversed tombstones');
  eq(r.deadEnd, false, 'A1 a deployed live tail is a valid repoint target');
  eq(r.cycle, false, 'A1 no cycle on a clean chain');

  // single hop, pending tail
  const s2 = emptyState();
  s2.cards['GA-R1a'] = { card: 'GA-R1a', phase: 'discarded', superseded_by: 'GA-R1a2' };
  s2.cards['GA-R1a2'] = { card: 'GA-R1a2', phase: 'claimed' };
  const r2 = coordinator.resolveSupersessionTail('GA-R1a', s2);
  eq(r2.tail, 'GA-R1a2', 'A1 single hop lands on the pending successor');
  eq(r2.deadEnd, false, 'A1 pending tail is a valid repoint target');

  // cycle guard
  const s3 = emptyState();
  s3.cards['X'] = { card: 'X', phase: 'discarded', superseded_by: 'Y' };
  s3.cards['Y'] = { card: 'Y', phase: 'discarded', superseded_by: 'X' };
  const r3 = coordinator.resolveSupersessionTail('X', s3);
  eq(r3.cycle, true, 'A1 detects a superseded_by cycle instead of looping');

  // dead end: a discarded card with no successor
  const s4 = emptyState();
  s4.cards['Z'] = { card: 'Z', phase: 'discarded', superseded_by: null };
  const r4 = coordinator.resolveSupersessionTail('Z', s4);
  eq(r4.tail, 'Z', 'A1 a successor-less tombstone is its own tail');
  eq(r4.deadEnd, true, 'A1 a discarded-with-no-successor tail is a dead end (not repointable)');

  // multi-hop message on discardedDependencyProblem
  eq(coordinator.discardedDependencyProblem('BL-4', state),
    'depends on discarded card BL-4 (superseded by BL-4c)',
    'A1 problem message names the live tail, not the immediate hop');
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node platform/test/run-codex-autoloop.js`
Expected: FAIL — `coordinator.resolveSupersessionTail is not a function`.

- [ ] **Step 3: Implement `resolveSupersessionTail` and upgrade the message**

Insert after `discardedDependencyProblem` (~line 1387) and update that function:

```js
function resolveSupersessionTail(dep, state) {
  const cards = (state && state.cards) || {};
  const hops = [];
  const seen = new Set();
  let name = normalizeCardLink(dep);
  while (true) {
    if (seen.has(name)) return { tail: hops[hops.length - 1] || name, hops, deadEnd: false, cycle: true };
    const record = cards[name];
    if (!record || record.phase !== 'discarded') {
      // reached a live/unknown node — it is a valid repoint target
      return { tail: name, hops, deadEnd: false, cycle: false };
    }
    const next = record.superseded_by ? normalizeCardLink(record.superseded_by) : null;
    if (!next) return { tail: name, hops, deadEnd: true, cycle: false }; // discarded, no successor
    seen.add(name);
    hops.push(name);
    name = next;
  }
}

function discardedDependencyProblem(dep, state) {
  const record = state.cards && state.cards[dep];
  if (!record || record.phase !== 'discarded') return null;
  const resolved = resolveSupersessionTail(dep, state);
  const successor = resolved.tail && resolved.tail !== dep ? ` (superseded by ${resolved.tail})` : '';
  return `depends on discarded card ${dep}${successor}`;
}
```

Add both to `module.exports` (the block at ~6822-6853): `resolveSupersessionTail,` alongside the existing `discardedDependencyProblem,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node platform/test/run-codex-autoloop.js`
Expected: PASS (ends `CODEX-AUTOLOOP PASS (<n> assertions)`).

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): multi-hop supersession-tail resolver for dangling deps"
```

---

### Task A2: `rewriteDependsOn` — format-preserving frontmatter rewriter

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` (near `patchFrontmatter`, ~1751; add to exports)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Produces: `rewriteDependsOn(raw, fromName, toNameOrNull)` → `{ text: string, changed: boolean }`. Rewrites occurrences of `fromName` inside the note's `depends_on` frontmatter: replaced with `toNameOrNull` when non-null, or removed when null. Reads any input form via `parseDependsOn` and re-serializes to canonical block-list form (`depends_on:` + `  - "[[Name]]"` lines, or `depends_on: []` when empty) — input inline/bare forms are normalized, not preserved. Name matching is via `normalizeCardLink` so wikilink/bare both match. No-op (`changed:false`, `text === raw` byte-identical) when `fromName` isn't present.

- [ ] **Step 1: Write the failing tests**

```js
// A2 rewriteDependsOn — repoint and clear, format-preserving
{
  const block = ['---', 'type: slice', 'depends_on:', '  - "[[BL-4]]"', '  - "[[Other]]"', '---', 'body'].join('\n');
  const rp = coordinator.rewriteDependsOn(block, 'BL-4', 'BL-4c');
  ok(rp.changed, 'A2 block-list repoint reports changed');
  ok(/\[\[BL-4c\]\]/.test(rp.text) && !/\[\[BL-4\]\]/.test(rp.text.replace(/BL-4c/g, '')),
    'A2 block-list repoint swaps BL-4 → BL-4c and keeps Other');
  ok(/\[\[Other\]\]/.test(rp.text), 'A2 block-list repoint preserves the sibling dep');

  const cleared = coordinator.rewriteDependsOn(block, 'BL-4', null);
  ok(cleared.changed && !/\[\[BL-4\]\]/.test(cleared.text.replace(/BL-4c/g, '')),
    'A2 clear removes the BL-4 line');
  ok(/\[\[Other\]\]/.test(cleared.text), 'A2 clear keeps the sibling dep');

  const inline = ['---', 'depends_on: ["[[BL-4]]","[[Other]]"]', '---', 'body'].join('\n');
  const inlineRp = coordinator.rewriteDependsOn(inline, 'BL-4', 'BL-4c');
  ok(inlineRp.changed && /\[\[BL-4c\]\]/.test(inlineRp.text), 'A2 inline-array repoint swaps the name');

  const bare = ['---', 'depends_on:', '  - BL-4', '---', 'body'].join('\n');
  const bareRp = coordinator.rewriteDependsOn(bare, 'BL-4', 'BL-4c');
  ok(bareRp.changed, 'A2 bare-name form matches via normalization');

  const absent = coordinator.rewriteDependsOn(block, 'NOT-PRESENT', 'X');
  ok(!absent.changed && absent.text === block, 'A2 absent dep is a no-op');
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node platform/test/run-codex-autoloop.js`
Expected: FAIL — `coordinator.rewriteDependsOn is not a function`.

- [ ] **Step 3: Implement `rewriteDependsOn`**

Reuse the existing `parseDependsOn` (imported from `select-card.js`) to read the current list, recompute, and re-serialize as a block list (the human-authored default). Insert near `patchFrontmatter`:

```js
function rewriteDependsOn(raw, fromName, toNameOrNull) {
  const from = normalizeCardLink(fromName);
  const to = toNameOrNull == null ? null : normalizeCardLink(toNameOrNull);
  const current = parseDependsOn(raw); // normalized names
  if (!current.includes(from)) return { text: raw, changed: false };
  const next = [];
  for (const name of current) {
    if (name !== from) { if (!next.includes(name)) next.push(name); continue; }
    if (to && !next.includes(to)) next.push(to);
  }
  const serialized = next.length
    ? ['depends_on:', ...next.map((n) => `  - "[[${n}]]"`)]
    : ['depends_on: []'];
  const text = patchFrontmatterBlocks(raw, { depends_on: serialized });
  return { text, changed: true };
}
```

Add `rewriteDependsOn,` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node platform/test/run-codex-autoloop.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): format-preserving depends_on rewriter"
```

---

### Task A3: discard-time dependents scan in `discardCardCore`

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` — `discardCardCore` (~4016-4122), inserting after the ledger persist (~line 4078)
- Test: `platform/test/run-codex-autoloop.js` (extend the discard section, ~7932+)

**Interfaces:**
- Consumes: `resolveSupersessionTail` (A1), `rewriteDependsOn` (A2), `findCard`, `parseDependsOn`, `normalizeCardLink`.
- Produces: `discardCardCore` receipt gains `dependency_rewrites: [{ card, from, to|null, path }]` (planning dependents that were rewritten) and `dependency_reports: [{ card, from, phase }]` (active/parked dependents named but untouched). Only runs when `operands.supersededBy` is set.

- [ ] **Step 1: Write the failing test**

Extend the discard harness. Build a board with the predecessor plus two dependents — one planning (rewritten), one active (reported):

```js
// A3 discard-time scan rewrites planning dependents to the live tail
{
  const root = path.join(tmp, 'a3-discard-scan');
  const cardsRoot = path.join(root, 'spice', 'projects', 'test', 'tasks');
  fs.mkdirSync(cardsRoot, { recursive: true });
  const boardPath = path.join(root, 'spice', 'projects', 'test', 'project-board.md');
  fs.writeFileSync(boardPath, liveBoard({ progress: ['BL-4'], planning: ['BL-5'] }));
  const predPath = path.join(cardsRoot, 'BL-4.md');
  const depPath = path.join(cardsRoot, 'BL-5.md');
  const activePath = path.join(cardsRoot, 'BL-6.md');
  fs.writeFileSync(predPath, ['---', 'kanban_column: In Progress', 'status: parked', 'depends_on: []', '---', 'x'].join('\n'));
  fs.writeFileSync(depPath, ['---', 'type: slice', 'status: in-planning', 'depends_on:', '  - "[[BL-4]]"', '---', 'x'].join('\n'));
  fs.writeFileSync(activePath, ['---', 'type: slice', 'status: claimed', 'depends_on:', '  - "[[BL-4]]"', '---', 'x'].join('\n'));
  const state = emptyState();
  state.cards['BL-4'] = { card: 'BL-4', phase: 'parked', card_path: predPath, gate_receipt: passingReceipt(DISCARD_HEAD) };
  state.cards['BL-4b'] = { card: 'BL-4b', phase: 'discarded', superseded_by: 'BL-4c' };
  state.cards['BL-4c'] = { card: 'BL-4c', phase: 'deployed' };
  state.cards['BL-6'] = { card: 'BL-6', phase: 'claimed', card_path: activePath };
  const deps = {
    readState: () => state,
    writeState: () => {},
    withLock: async (_c, _n, fn) => fn(),
    boardPath, cardsRoot, worktreeExists: () => false,
    sh: () => '', now: () => '2026-08-02T00:00:00.000Z',
    projectLoopStation: (_c, _s, u) => ({ action: 'loop-station-projected', no_op: false, updated_on: u }),
  };
  const receipt = await commandDiscard({ root }, {
    card: 'BL-4', 'superseded-by': 'BL-4b', reason: 'superseded to BL-4c chain', json: true,
  }, deps);
  eq(receipt.dependency_rewrites, [{ card: 'BL-5', from: 'BL-4', to: 'BL-4c', path: depPath }],
    'A3 planning dependent BL-5 is repointed to the live tail BL-4c');
  ok(/\[\[BL-4c\]\]/.test(fs.readFileSync(depPath, 'utf8')), 'A3 BL-5 note now points at BL-4c on disk');
  eq(receipt.dependency_reports, [{ card: 'BL-6', from: 'BL-4', phase: 'claimed' }],
    'A3 active dependent BL-6 is reported, not touched');
  ok(/\[\[BL-4\]\]/.test(fs.readFileSync(activePath, 'utf8')), 'A3 BL-6 note is left untouched');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-codex-autoloop.js`
Expected: FAIL — `receipt.dependency_rewrites` is `undefined`.

- [ ] **Step 3: Implement the scan**

Add a helper and call it inside `discardCardCore` right after `persist(ctx, state, target);` (~line 4078), before board/note removal. The tail is resolved from the SUCCESSOR named on the tombstone (`supersededBy`), chased to its live tail:

```js
function scanDependentsForDiscard(card, supersededBy, state, cardsRoot, d) {
  const rewrites = [];
  const reports = [];
  const predecessor = normalizeCardLink(card);
  // Repoint dependents to the successor's own live tail (always repoint, never clear).
  const resolved = resolveSupersessionTail(supersededBy, state);
  const repointable = !resolved.cycle && !resolved.deadEnd;
  const target = resolved.tail;
  const stack = [cardsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.name.endsWith('.md')) continue;
      const depName = ent.name.replace(/\.md$/, '');
      if (normalizeCardLink(depName) === predecessor) continue; // skip the predecessor's own note
      const raw = fs.readFileSync(full, 'utf8');
      if (!parseDependsOn(raw).includes(predecessor)) continue;
      const record = state.cards[depName];
      const phase = record ? record.phase : null;
      const inFlight = record && (phase === 'claimed' || phase === 'implementing' || phase === 'parked');
      if (inFlight || !repointable) {
        reports.push({ card: depName, from: predecessor, phase }); // active/parked or unrepointable → report only
        continue;
      }
      const rewritten = rewriteDependsOn(raw, predecessor, target);
      if (rewritten.changed) {
        d.writeText(full, rewritten.text);
        rewrites.push({ card: depName, from: predecessor, to: target, path: full });
      }
    }
  }
  return { rewrites, reports };
}
```

Then in `discardCardCore`, capture and attach (only when superseding):

```js
  let dependencyScan = { rewrites: [], reports: [] };
  if (supersededBy) {
    dependencyScan = scanDependentsForDiscard(card, supersededBy, state, cardsRoot, d);
  }
```

…and spread into the returned receipt object:

```js
    ...(dependencyScan.rewrites.length ? { dependency_rewrites: dependencyScan.rewrites } : {}),
    ...(dependencyScan.reports.length ? { dependency_reports: dependencyScan.reports } : {}),
```

Note `d.writeText` is the injected atomic writer already in `resolveDiscardDeps`; `cardsRoot` is `d.cardsRoot`. Guard against re-scanning the predecessor's own note (skip `depName === card`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-codex-autoloop.js`
Expected: PASS. Also confirm the existing `BGR-DISCARD-HAPPY` assertions still pass (no `superseded-by` chain there means an empty scan — no receipt keys added).

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): rewrite dangling dependents at discard time"
```

---

### Task A4: `reconcile-dependencies` verb (one-time audit/repair)

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` — new `commandReconcileDependencies`; dispatch (~6793-6816); usage string (~6817); `module.exports`. (NOT added to `STRICT_CLI_OPTIONS` — like `discard`, it validates its own operands so `--all` without `--card` is allowed.)
- Test: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: `resolveSupersessionTail`, `rewriteDependsOn`, `parseDependsOn`, `discardedDependencyProblem`, `withLock`.
- Produces: `commandReconcileDependencies(ctx, args, deps={})`. Args: `--card "<exact>"` OR `--all`; `--reason "<audit>"` (required); `--apply` (default dry-run); `--json` (required); optional `--clear "<exact dead-dep name>"` (Director-authorized explicit clear). Receipt: `{ action, ok, no_op, apply, plan: [{ card, from, to, classification }], reports: [{ card, from, phase }], needs_decision: [{ card, from }] }`. Auto classification is `repoint` (dead pointer whose chain resolves to a live tail → repoint to it). `needs_decision` holds dead pointers with no usable tail (dead-end tombstone, cycle, or never-minted) — never auto-repaired; escalated. When `--clear <name>` is supplied, any scoped dependent carrying that exact dead pointer gets it REMOVED (classification `clear`, `to: null`) instead of repoint/needs-decision — this is the ONLY path that clears, and it exists for the Director-confirmed obsolete case. Active/parked dependents → `reports`, never planned. Under `--apply`, writes rewrites via the injected writer under the selector lock; dry-run writes nothing.

- [ ] **Step 1: Write the failing test**

```js
// A4 reconcile-dependencies — classify + apply across mixed fates
{
  const root = path.join(tmp, 'a4-reconcile');
  const cardsRoot = path.join(root, 'spice', 'projects', 'test', 'tasks');
  fs.mkdirSync(cardsRoot, { recursive: true });
  const boardPath = path.join(root, 'spice', 'projects', 'test', 'project-board.md');
  fs.writeFileSync(boardPath, liveBoard({ planning: ['DEP-repoint', 'DEP-deployed', 'DEP-orphan'] }));
  const mk = (name, dep) => {
    const p = path.join(cardsRoot, `${name}.md`);
    fs.writeFileSync(p, ['---', 'type: slice', 'status: in-planning', 'depends_on:', `  - "[[${dep}]]"`, '---', 'x'].join('\n'));
    return p;
  };
  const pRepoint = mk('DEP-repoint', 'GA-R1a');    // superseded → pending GA-R1a2
  const pDeployed = mk('DEP-deployed', 'BL-4');     // superseded → deployed BL-4c (still repoint)
  const pOrphan = mk('DEP-orphan', 'GA-M1');        // never minted
  const state = emptyState();
  state.cards['GA-R1a'] = { card: 'GA-R1a', phase: 'discarded', superseded_by: 'GA-R1a2' };
  state.cards['GA-R1a2'] = { card: 'GA-R1a2', phase: 'planned' };
  state.cards['BL-4'] = { card: 'BL-4', phase: 'discarded', superseded_by: 'BL-4c' };
  state.cards['BL-4c'] = { card: 'BL-4c', phase: 'deployed' };
  const deps = {
    readState: () => state, writeText: (p, t) => fs.writeFileSync(p, t),
    withLock: async (_c, _n, fn) => fn(), boardPath, cardsRoot,
    now: () => '2026-08-02T00:00:00.000Z',
  };
  // dry-run: plan only, no writes
  const dry = await coordinator.commandReconcileDependencies({ root }, {
    all: true, reason: 'heal supersession rot', json: true,
  }, deps);
  eq(dry.apply, false, 'A4 dry-run by default');
  ok(/\[\[GA-R1a\]\]/.test(fs.readFileSync(pRepoint, 'utf8')), 'A4 dry-run writes nothing');
  const byCard = Object.fromEntries(dry.plan.map((p) => [p.card, p]));
  eq(byCard['DEP-repoint'].classification, 'repoint', 'A4 pending tail ⇒ repoint');
  eq(byCard['DEP-repoint'].to, 'GA-R1a2', 'A4 repoint targets the live tail');
  eq(byCard['DEP-deployed'].classification, 'repoint', 'A4 deployed tail ⇒ still repoint');
  eq(byCard['DEP-deployed'].to, 'BL-4c', 'A4 repoint targets the deployed live tail');
  eq(dry.needs_decision, [{ card: 'DEP-orphan', from: 'GA-M1' }], 'A4 never-minted ⇒ needs-decision');

  // apply
  const applied = await coordinator.commandReconcileDependencies({ root }, {
    all: true, reason: 'heal supersession rot', apply: true, json: true,
  }, deps);
  ok(applied.apply === true && applied.no_op === false, 'A4 apply executes');
  ok(/\[\[GA-R1a2\]\]/.test(fs.readFileSync(pRepoint, 'utf8')), 'A4 apply repoints the pending tail on disk');
  ok(/\[\[BL-4c\]\]/.test(fs.readFileSync(pDeployed, 'utf8')), 'A4 apply repoints the deployed tail on disk');
  ok(/\[\[GA-M1\]\]/.test(fs.readFileSync(pOrphan, 'utf8')), 'A4 never-minted left untouched for escalation');

  // Director-authorized explicit clear of the never-minted dep
  const cleared = await coordinator.commandReconcileDependencies({ root }, {
    card: 'DEP-orphan', clear: 'GA-M1', reason: 'director confirms GA-M1 obsolete', apply: true, json: true,
  }, deps);
  const clearedPlan = cleared.plan.find((p) => p.card === 'DEP-orphan');
  eq(clearedPlan.classification, 'clear', 'A4 --clear classifies as clear');
  eq(clearedPlan.to, null, 'A4 --clear has no target');
  ok(/depends_on: \[\]/.test(fs.readFileSync(pOrphan, 'utf8')), 'A4 --clear removes the confirmed-obsolete dep on disk');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-codex-autoloop.js`
Expected: FAIL — `coordinator.commandReconcileDependencies is not a function`.

- [ ] **Step 3: Implement the command**

```js
async function commandReconcileDependencies(ctx, args, deps = {}) {
  if (args.json !== true) throw new Error('reconcile-dependencies requires --json');
  const single = args.card ? normalizeCardLink(String(args.card)) : null;
  const all = args.all === true;
  const reason = Array.isArray(args.reason) ? '' : String(args.reason || '').trim();
  if (single === null && !all) throw new Error('reconcile-dependencies requires --card or --all');
  if (single !== null && all) throw new Error('reconcile-dependencies accepts --card or --all, not both');
  if (!reason) throw new Error('reconcile-dependencies requires a non-empty --reason');
  const apply = args.apply === true;
  const clearName = args.clear ? normalizeCardLink(String(args.clear)) : null;
  const loadState = deps.readState || readState;
  const writeText = deps.writeText || atomicWriteText;
  const lock = deps.withLock || withLock;
  const cardsRoot = deps.cardsRoot || CARDS_ROOT;
  return lock(ctx, 'selector', async () => {
    const state = loadState(ctx);
    const plan = [];
    const reports = [];
    const needsDecision = [];
    const stack = [cardsRoot];
    while (stack.length) {
      const dir = stack.pop();
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { stack.push(full); continue; }
        if (!ent.name.endsWith('.md')) continue;
        const depName = ent.name.replace(/\.md$/, '');
        if (single && depName !== single) continue;
        let raw = fs.readFileSync(full, 'utf8');
        const record = state.cards[depName];
        const phase = record ? record.phase : null;
        const inFlight = record && (phase === 'claimed' || phase === 'implementing' || phase === 'parked');
        for (const ref of parseDependsOn(raw)) {
          // Director-authorized explicit clear takes precedence over any auto-classification.
          if (clearName && ref === clearName) {
            if (inFlight) { reports.push({ card: depName, from: ref, phase }); continue; }
            plan.push({ card: depName, from: ref, to: null, classification: 'clear', path: full });
            if (apply) { const w = rewriteDependsOn(raw, ref, null); if (w.changed) { raw = w.text; writeText(full, raw); } }
            continue;
          }
          if (state.cards[ref] && state.cards[ref].phase !== 'discarded') continue; // live dep, fine
          if (!state.cards[ref]) { needsDecision.push({ card: depName, from: ref }); continue; } // never-minted
          if (inFlight) { reports.push({ card: depName, from: ref, phase }); continue; }
          const resolved = resolveSupersessionTail(ref, state);
          if (resolved.cycle || resolved.deadEnd) { needsDecision.push({ card: depName, from: ref }); continue; }
          const to = resolved.tail;
          plan.push({ card: depName, from: ref, to, classification: 'repoint', path: full });
          if (apply) { const w = rewriteDependsOn(raw, ref, to); if (w.changed) { raw = w.text; writeText(full, raw); } }
        }
      }
    }
    return successReceipt('reconcile-dependencies', {
      apply, no_op: apply ? plan.length === 0 : true, reason,
      plan: plan.map(({ path: _p, ...rest }) => rest),
      reports, needs_decision: needsDecision,
    });
  });
}
```

Wire it:
- dispatch (~6793-6816): `else if (command === 'reconcile-dependencies') result = await commandReconcileDependencies(ctx, args);`
- usage string (~6817): append `|reconcile-dependencies` after `reconcile`.
- `module.exports`: add `commandReconcileDependencies,`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-codex-autoloop.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-codex-autoloop.js
git commit -m "feat(coordinator): reconcile-dependencies audit/repair verb"
```

---

## Phase B — Intake: strengthen the mint guard

### Task B1: `external:` escape hatch (existing guard already refuses missing/discarded deps)

**Files:**
- Modify: `.agents/skills/card-intake/scripts/card-intake.js` (`validateCard` shape check ~373-374; `validateSpec` resolution guard ~489-494; `renderCard` `depends_on` serialization)
- Test: `platform/test/run-card-intake.js`

**Design note — the discarded-dep case is ALREADY covered.** The existing resolution guard refuses any dependency that neither appears earlier in the same batch nor resolves on disk via `findCard`. A discarded card's note is DELETED at discard time (`discardCardCore` `fs.unlinkSync`), so a mint depending on a discarded (or never-minted) card already fails with `"<title>: dependency does not resolve: <name>"`. There is therefore **no need — and no clean way — to couple intake to coordinator status**: `codex-coordinator.js status --json` exposes no per-name `cards` map (only truncated `discarded_recent`), so a status-based tombstone check would be dead code. B1's only genuinely new capability is the `external:` marker, plus the `renderCard` fix that lets it round-trip.

**Interfaces:**
- Consumes: existing `linkName`, `findCard`.
- Produces: a dependency written as `external:<free text>` is accepted verbatim and NEVER resolved — honored in the `validateCard` shape check, the `validateSpec` resolution guard, AND `renderCard` (rendered through unwrapped, not `[[external:…]]`). The pre-existing "dependency does not resolve" guard is left intact and continues to refuse mints on missing/discarded/never-minted deps.

- [ ] **Step 1: Write the failing tests**

In `platform/test/run-card-intake.js`, construct spec objects inline in the SAME style as the adjacent dependency-validation tests (there are no `mkSpec`/`mkCard` helpers — read the existing `'unresolved dependency is refused'` test for the exact shape and the `run(spec, apply, deps)` signature). No `readCoordinatorStatus` mock is needed.

```js
// B1 external: marker is accepted without resolution (construct spec inline per existing tests)
//   card depends_on: ['external:upstream vendor SDK'] ⇒ run(spec, false) ⇒ res.ok === true
// B1 a dep that does not resolve on disk (a discarded/never-minted card) is still refused
//   card depends_on: ['[[GA-P4b Gesture write lint]]'] with no such note under cards_root
//   ⇒ res.ok === false AND res.errors includes /does not resolve/
// B1 external: round-trips through renderCard unwrapped
//   render the minted card and assert its depends_on line contains `external:upstream vendor SDK`
//   and NOT `[[external:` (ordinary deps still render as [[Name]])
```

Fill each in with the harness's real inline spec construction and its `ok`/`eq` assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:card-intake`
Expected: FAIL — the `external:` marker currently errors as an invalid (non-wikilink) dependency and/or renders as `[[external:…]]`.

- [ ] **Step 3: Implement**

At the shape check (~373-374), allow the `external:` prefix:

```js
  if (!Array.isArray(card.depends_on)) errors.push(`${card.title}: depends_on must be an array`);
  else for (const dep of card.depends_on) {
    if (typeof dep === 'string' && /^external:/.test(dep)) continue; // explicit off-board dep
    if (!linkName(dep)) errors.push(`${card.title}: dependencies must be wikilinks or external:<text>`);
  }
```

At the resolution guard (~489-494), skip externals but leave the existing resolution logic UNCHANGED (do NOT add any coordinator-status coupling):

```js
  const order = new Map(cards.map((card, index) => [card.title, index]));
  for (const card of cards) for (const dep of card.depends_on || []) {
    if (typeof dep === 'string' && /^external:/.test(dep)) continue; // never resolved
    const name = linkName(dep);
    if (order.has(name) && order.get(name) > order.get(card.title)) errors.push(`${card.title}: dependency appears after dependent`);
    else if (!order.has(name) && !findCard(spec.cards_root, name)) errors.push(`${card.title}: dependency does not resolve: ${name}`);
  }
```

In `renderCard`, where `depends_on` entries are serialized, pass an `external:` entry through unwrapped instead of wrapping it in `[[…]]` (ordinary bare names still get `[[${item}]]`):

```js
  // depends_on serialization: external markers pass through verbatim; ordinary names are wikilinked
  ...depends_on.map((item) => (/^external:/.test(item) ? item : `[[${item}]]`))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:card-intake`
Expected: PASS (`… PASS`), with no regression to the existing `'unresolved dependency is refused'` case.

- [ ] **Step 5: Commit**

```bash
git add ".agents/skills/card-intake/scripts/card-intake.js" platform/test/run-card-intake.js
git commit -m "feat(intake): external dep marker; existing resolution guard covers discarded deps"
```

---

## Phase C — Skill + plugin surface

### Task C1: author `plugins/loop/skills/block-review/SKILL.md`

**Files:**
- Create: `plugins/loop/skills/block-review/SKILL.md`

**Interfaces:**
- Frontmatter `name: block-review`; `description` must contain the literal `Use when` and be >40 chars (LP-3). Body must contain the string `loop:block-review` (LP-3 slash-surface), a `## Bind` section calling `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json` (LP-5), and — because it drives a write path — the string `observe_only` (refuse when set).

- [ ] **Step 1: Write the skill body**

```markdown
---
name: block-review
description: Heal and report dangling depends_on rot on the bound board. Use when asking "why is this epic blocked", "what's silently blocking the board", "unblock the board", "clean up dead dependencies", or after a supersession leaves dead pointers. Auto-fixes provable danglers through the coordinator and escalates never-minted foundations.
---

# loop:block-review

Find and heal `depends_on` rot on whatever board this repo is bound to: pointers to
cards that no longer exist (superseded/discarded) or never existed (never-minted
foundations). Provable cases are repaired through the coordinator's
`reconcile-dependencies` verb; judgment cases are escalated to the Director one at a
time. The coordinator is the only writer — this skill orchestrates it, never hand-edits
cards or boards.

## Bind

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json`; refusal → `/loop:init`, stop. Refuse if `config.policy.observe_only` unless the Director explicitly authorizes a supervised lift for this pass.
2. `<coordinator>` = `config.coordinator`. Export `config.env` on every command; cwd = repo root.

## Phase 1 — Detect

1. `node <coordinator> status --json` → save to a temp file. Read `board_drift` and `projection_problems`.
2. `node <coordinator> reconcile-dependencies --all --reason "block-review scan" --json` (dry-run; writes nothing). This returns `plan` (provable repoints to the live tail), `reports` (active/parked dependents — untouched), and `needs_decision` (never-minted/dead-end/cycle).
3. The honest Director-facing signal is Obsidian GraphView at epic scope: `dangling_dependency` warnings there must reach zero when this is done.

## Phase 2 — Auto-fix the provable set

1. If `plan` is non-empty, apply: `node <coordinator> reconcile-dependencies --all --reason "<audit>" --apply --json`. Quote each repoint from the receipt.
2. Re-`status`; for any epic whose slices are now all resolvable, run `node <coordinator> reconcile --card "<epic>" --json` so its posture flips `blocked_by_dependencies` → claimable and its lane moves through the sanctioned writer. Never hand-edit a kanban column.

## Phase 3 — Escalate the judgment set (one at a time)

For each `needs_decision` item, ask ONE question, recommendation first: **mint** the missing foundation via `/loop:intake`, or **confirm-clear** (the dep is obsolete/folded elsewhere → run `node <coordinator> reconcile-dependencies --card "<dependent>" --clear "<dead dep>" --reason "<director confirmation>" --apply --json`). Never mint or clear a judgment item without the Director's word.

## Phase 4 — Handoff

Phone-sized: danglers found, provable repairs applied (repoint/clear counts), epics unblocked, judgment items and their decisions, and the residual `needs_decision` count. Confirm both surfaces are quiet: `claim --dry-run` no longer skips on `depends on discarded card …`, and GraphView shows zero `dangling_dependency` warnings.

## NEVER

Hand-edit cards/boards/coordinator state · rewrite active or parked dependents (report them) · mint or clear a judgment item without the Director's decision · run against an `observe_only` board without an explicit supervised lift.
```

- [ ] **Step 2: Commit**

```bash
git add "plugins/loop/skills/block-review/SKILL.md"
git commit -m "feat(loop): add block-review skill body"
```

---

### Task C2: register the skill in the surface (harness + routers + docs)

**Files:**
- Modify: `platform/test/run-loop-plugin-surface.js:22` (`EXPECTED_SKILLS`)
- Create (generated): `.agents/skills/loop-block-review/SKILL.md`, `.agents/skills/loop-block-review/agents/openai.yaml`
- Modify: `Docs/agent-guides/loop-plugin.md` (table ~67-76, prose list ~8)

- [ ] **Step 1: Update `EXPECTED_SKILLS` (alphabetical)**

In `platform/test/run-loop-plugin-surface.js:22`:

```js
const EXPECTED_SKILLS = ['block-review', 'brainstorm', 'execute', 'init', 'intake', 'plan', 'review', 'run', 'status'];
```

- [ ] **Step 2: Run the surface harness to verify it fails on stale routers**

Run: `node platform/test/run-loop-plugin-surface.js`
Expected: LP-3 skill-set now matches (dir exists), but LP-5 passes only if the body has the resolver + `observe_only` strings (it does). Then run `node platform/test/run-loop-codex-routers.js` — expect LR-5 FAIL (`routers_stale`, the new router isn't committed yet).

- [ ] **Step 3: Regenerate + stage the Codex routers**

Run: `node plugins/loop/scripts/gen-codex-routers.js --repo . --json`
Expected: `written` includes `loop-block-review/SKILL.md` and `loop-block-review/agents/openai.yaml`.

- [ ] **Step 4: Add the agent-guide table row + prose**

In `Docs/agent-guides/loop-plugin.md` skill-surface table, add:

```markdown
| `/loop:block-review` | `$loop-block-review` | detect + heal dangling depends_on rot; auto-fix provable, escalate never-minted |
```

And update the prose skill list at `loop-plugin.md:8` to include `block-review`.

- [ ] **Step 5: Run both plugin harnesses to verify they pass**

Run: `node platform/test/run-loop-plugin-surface.js && node platform/test/run-loop-codex-routers.js`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/test/run-loop-plugin-surface.js ".agents/skills/loop-block-review" "Docs/agent-guides/loop-plugin.md"
git commit -m "feat(loop): register block-review in plugin surface + codex routers"
```

---

### Task C3: full preflight gate

- [ ] **Step 1: Run the aggregated preflight**

Run: `npm run release:preflight`
Expected: PASS end-to-end (this chains `run-codex-autoloop.js`, `run-card-intake.js`, `run-loop-plugin-surface.js`, `run-loop-codex-routers.js`, and the rest). Fix any regression before proceeding.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A && git commit -m "test: green release preflight for dependency-hygiene rails"
```

---

## Phase D — Apply to the boards + release

> These are supervised operational tasks, not TDD units. Each ends with a verification gate.

### Task D1: heal the sauce board

- [ ] **Step 1: Measure the honest count.** From the repo root with `config.env` exported, run `node <coordinator> reconcile-dependencies --all --reason "block-review sauce scan" --json`. Record `plan`/`reports`/`needs_decision`.
- [ ] **Step 2: Cross-check the Obsidian signal.** Open the sauce Loop Station GraphView at project scope; note the `dangling_dependency` warning count as the human-facing baseline.
- [ ] **Step 3: Apply provable repairs.** `node <coordinator> reconcile-dependencies --all --reason "<audit>" --apply --json`. Quote the receipt.
- [ ] **Step 4: Reconcile affected epics.** For each epic now fully resolvable, `node <coordinator> reconcile --card "<epic>" --json` (replay to `no_op: true`).
- [ ] **Step 5: Escalate never-minted, one at a time** (interactively with the Director): mint the foundation via `/loop:intake` or confirm-clear per item.
- [ ] **Step 6: Verify both surfaces quiet.** `node <coordinator> claim --dry-run --json` skips nothing with `depends on discarded card …`; GraphView shows zero `dangling_dependency` warnings.

### Task D2: heal the ero-egnyte-mcp board (supervised observe_only lift)

- [ ] **Step 1: Confirm the binding.** In the egnyte-mcp repo, `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json`; confirm `policy.observe_only: true` and the ero board path.
- [ ] **Step 2: Dry-run under observe_only.** Detection is read-only — run `reconcile-dependencies --all --reason "ero scan" --json` (no `--apply`) to inventory ero's danglers (mostly the `EM-E1 → EM-E1a` supersession class).
- [ ] **Step 3: Supervised lift.** With the Director's explicit authorization, temporarily set `policy.observe_only: false` in ero's `.loop/config.json`; **wrap the apply in restore-on-exit** so observe_only is restored even if the pass aborts.
- [ ] **Step 4: Apply + reconcile** exactly as D1 steps 3-4 against the ero board.
- [ ] **Step 5: Restore observe_only** and confirm read skills still work / write skills refuse.
- [ ] **Step 6: Verify** ero GraphView shows zero `dangling_dependency` warnings.

### Task D3: release + distribute

- [ ] **Step 1: Merge the branch to `main`** via PR (conventional commits already in place). Do NOT bump versions/tags by hand.
- [ ] **Step 2: Let the automatic release pipeline** publish the new brew build (coordinator verb + discard-time scan + intake guard) and the plugin update (new skill + routers).
- [ ] **Step 3: Codex pickup** — `brew upgrade willfell/sauce/sauce`; confirm the installed coordinator answers `reconcile-dependencies` and `.agents/skills/loop-block-review/` is present in bound repos after `gen-codex-routers` (already committed).
- [ ] **Step 4: Claude pickup** — `/plugin marketplace update sauce`; confirm `/loop:block-review` is available in a fresh session.
- [ ] **Step 5: Post-release smoke.** Run `/loop:block-review` (dry-run) against the sauce board; expect zero provable danglers remaining.

---

## Self-Review

**Spec coverage:** A′ tail resolver → A1. `reconcile-dependencies` verb → A4. Discard-time scan → A3. `rewriteDependsOn` primitive → A2. Mint guard (strengthen + external marker) → B1. `block-review` skill → C1. Plugin/router/docs surface → C2. Preflight → C3. Sauce + ero board repair → D1/D2. Release/distribution → D3. Both failure-surface verifications → D1.6/D2.6. All spec sections map to a task.

**Placeholder scan:** the only literal `placeholder` token is the explicitly-flagged anchor line in A2 Step 1, with a written instruction to delete it before commit. No TBD/TODO/"handle edge cases" remain.

**Type consistency:** `resolveSupersessionTail` return shape (`{tail,hops,terminal,cycle}`) is used identically in A3 (`scanDependentsForDiscard`) and A4 (`commandReconcileDependencies`). `rewriteDependsOn` return (`{text,changed}`) used identically in A3 and A4. Receipt keys (`dependency_rewrites`/`dependency_reports` in discard; `plan`/`reports`/`needs_decision` in the verb) are consistent between implementation and tests.

**Deviations from spec, surfaced:** (1) The spec's compare-and-swap `--expected-signature` is realized via the coordinator's existing **selector lock** (planning cards have no worktree HEAD to anchor a SHA-CAS); the dry-run→apply two-step plus the lock provide the concurrency guard. (2) The mint-time guard already existed; B1 strengthens rather than adds it. (3) Per the Director's ruling, the auto path is **repoint-to-live-tail-always** (deployed tail included) — there is no automatic `clear`; the spec's `clear` classification is realized only as the Director-authorized `--clear` mode. All three are intentional and noted.
