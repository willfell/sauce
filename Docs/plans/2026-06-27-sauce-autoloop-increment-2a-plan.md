# Sauce Autoloop — Increment 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autoloop pick work again by deriving in-flight state from git/PR (reconciliation) instead of blocking on the board's parked "In Progress" workstreams, and skip `[x]`-checked Planning cards.

**Architecture:** A new pure `reconcileInFlight` derives status (`idle|implementing|pr-open|merged|failed`) from *observed* git branches + GitHub PRs (the system of record); the command runs it in Phase A and only invokes `selectCard` when `idle`. `selectCard` drops its board-"In Progress" guard and skips checked Planning cards. The board becomes a human-visible projection, never the source of truth. Design: `2026-06-27-sauce-autoloop-increment-2a-design.md`.

**Tech Stack:** Node ≥18, zero-dep CommonJS; `child_process` for the reconcile CLI's `git`/`gh` gathering; the existing `run-autoloop-select.js` harness (already wired into `release:preflight`).

---

## Scope
**In:** `reconcileInFlight` (+ CLI), `selectCard` changes (drop In-Progress guard, skip `[x]`), command Phase A reconcile wiring, harness extensions. **Out (later):** Scout/self-discovery (2b), Gate B verifier (3), canary (4), substrate (5), and any real `--live` PR exercise (we ship logic + tests; live runs when you flip the assessment window).

## File structure
| File | Status | Responsibility |
| --- | --- | --- |
| `scripts/autoloop/reconcile-inflight.js` | Create | Pure `reconcileInFlight` + `slugFromRef`; CLI gathers git/gh and prints status JSON (fail-safe). |
| `scripts/autoloop/select-card.js` | Modify | Add `parsePlanningChecked`; drop In-Progress guard; skip `[x]` cards. |
| `platform/test/run-autoloop-select.js` | Modify | Replace `SC-2`; add `PC-*`, `SC-8`, `RI-*`. |
| `.claude/commands/sauce-autoloop.md` | Modify | Phase A: reconcile-then-gate; reconcile actions (live vs dry-run). |

Branch: `feat/sauce-autoloop-increment-2a` (already created). Land via CI-gated auto-merge PR.

---

## Task 1: `reconcileInFlight` (pure) + CLI

**Files:** Create `scripts/autoloop/reconcile-inflight.js`; Test `platform/test/run-autoloop-select.js`.

- [ ] **Step 1: Add failing RI assertions to the harness**

Near the top of `run-autoloop-select.js`, after the existing requires, add:
```js
const { reconcileInFlight, slugFromRef } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'reconcile-inflight.js'));
```
Before the final `console.log('')` summary block, insert:
```js
// ---- reconcileInFlight (RI-*) ----
ok('RI-1 slugFromRef strips local prefix', slugFromRef('autoloop/fix-x') === 'fix-x');
ok('RI-2 slugFromRef strips remote prefix', slugFromRef('origin/autoloop/fix-x') === 'fix-x');
ok('RI-3 idle when nothing in flight', reconcileInFlight({}).status === 'idle');
ok('RI-4 open PR → pr-open/wait',
  (r => r.status === 'pr-open' && r.nextAction === 'wait' && r.card === 'fix-x')
  (reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'OPEN', number: 5 }] })));
ok('RI-5 bare branch → implementing/resume-or-clean',
  (r => r.status === 'implementing' && r.nextAction === 'resume-or-clean' && r.card === 'fix-x')
  (reconcileInFlight({ branches: ['autoloop/fix-x'] })));
ok('RI-6 merged PR → merged/close-card',
  (r => r.status === 'merged' && r.nextAction === 'close-card')
  (reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'MERGED', number: 5 }] })));
ok('RI-7 closed PR → failed/block-card',
  (r => r.status === 'failed' && r.nextAction === 'block-card')
  (reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'CLOSED', number: 5 }] })));
ok('RI-8 open beats older merged (most recent by number)',
  reconcileInFlight({ prs: [
    { headRefName: 'autoloop/a', state: 'MERGED', number: 4 },
    { headRefName: 'autoloop/b', state: 'OPEN', number: 5 }] }).card === 'b');
ok('RI-9 branch whose PR merged is NOT bare (→ merged, not implementing)',
  reconcileInFlight({ branches: ['autoloop/fix-x'],
    prs: [{ headRefName: 'autoloop/fix-x', state: 'MERGED', number: 5 }] }).status === 'merged');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `Cannot find module '.../reconcile-inflight.js'`.

- [ ] **Step 3: Create `scripts/autoloop/reconcile-inflight.js`**

```js
#!/usr/bin/env node
/**
 * reconcile-inflight — derive the autoloop's in-flight status from OBSERVED
 * git + GitHub PR state (the system of record). Level-triggered, idempotent.
 * Pure function: observed facts in → {status, card, nextAction} out.
 * The CLI does the impure git/gh gathering, then calls the pure function.
 *
 * Exports: reconcileInFlight, slugFromRef
 */
'use strict';

// 'autoloop/fix-x' or 'origin/autoloop/fix-x' → 'fix-x'
function slugFromRef(ref) {
  if (!ref) return null;
  const m = String(ref).match(/(?:^|\/)autoloop\/(.+)$/);
  return m ? m[1].trim() : null;
}

/**
 * @param {object} o
 * @param {string[]} [o.branches] branch names matching autoloop/* (local and/or remote)
 * @param {Array<{headRefName:string,state:string,number:number}>} [o.prs] autoloop/* PRs, any state
 * @returns {{status:string, card:(string|null), nextAction:string, number?:number, extra?:string[]}}
 */
function reconcileInFlight(o) {
  const { branches = [], prs = [] } = o || {};
  const branchSlugs = [...new Set(branches.map(slugFromRef).filter(Boolean))];
  const prRecs = prs
    .map((p) => ({ slug: slugFromRef(p.headRefName), state: String(p.state || '').toUpperCase(), number: Number(p.number) || 0 }))
    .filter((p) => p.slug);

  // 1. Any OPEN autoloop PR wins (highest number = most recent).
  const open = prRecs.filter((p) => p.state === 'OPEN').sort((a, b) => b.number - a.number);
  if (open.length) {
    return { status: 'pr-open', card: open[0].slug, number: open[0].number, nextAction: 'wait',
      ...(open.length > 1 ? { extra: open.slice(1).map((p) => p.slug) } : {}) };
  }

  // 2. A branch with no PR at all → mid-implementation (crashed before PR, or in progress).
  const prSlugs = new Set(prRecs.map((p) => p.slug));
  const bare = branchSlugs.filter((s) => !prSlugs.has(s));
  if (bare.length) {
    return { status: 'implementing', card: bare[0], nextAction: 'resume-or-clean',
      ...(bare.length > 1 ? { extra: bare.slice(1) } : {}) };
  }

  // 3. No open PR, no bare branch → judge by the most-recent PR's terminal state.
  if (prRecs.length) {
    const recent = prRecs.slice().sort((a, b) => b.number - a.number)[0];
    if (recent.state === 'MERGED') return { status: 'merged', card: recent.slug, number: recent.number, nextAction: 'close-card' };
    return { status: 'failed', card: recent.slug, number: recent.number, nextAction: 'block-card' };
  }

  // 4. Nothing in flight.
  return { status: 'idle', card: null, nextAction: 'pick' };
}

module.exports = { reconcileInFlight, slugFromRef };

if (require.main === module) {
  const { execFileSync } = require('child_process');
  const sh = (cmd, args) => {
    try { return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch (_) { return null; }
  };
  const clean = (out) => (out || '').split('\n').map((s) => s.replace(/^[*+]?\s*/, '').trim()).filter(Boolean);
  const branches = [...clean(sh('git', ['branch', '--list', 'autoloop/*'])),
                    ...clean(sh('git', ['branch', '-r', '--list', 'origin/autoloop/*']))];
  // gh is authoritative for PR state. If it fails, do NOT assume idle — fail safe to halt.
  const prJson = sh('gh', ['pr', 'list', '--state', 'all', '--limit', '30', '--json', 'headRefName,state,number']);
  if (prJson === null) {
    console.log(JSON.stringify({ status: 'unknown', card: null, nextAction: 'halt', reason: 'gh query failed — not assuming idle' }));
    process.exit(0);
  }
  let prs = [];
  try { prs = JSON.parse(prJson); } catch (_) { prs = []; }
  console.log(JSON.stringify(reconcileInFlight({ branches, prs }), null, 2));
  process.exit(0);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — RI-1..RI-9 green (total count rises by 9). If any fail, fix the CODE (tests encode the spec).

- [ ] **Step 5: Sanity-check the CLI against this repo**

Run: `node scripts/autoloop/reconcile-inflight.js`
Expected: JSON. On this branch there are no `autoloop/*` branches/PRs, so `{"status":"idle",...}` (or `"unknown"` if `gh` is unauthenticated — that's the correct fail-safe).

- [ ] **Step 6: Commit** (note the `/Scripts/` gitignore landmine — force-add the new file)

```bash
git add -f scripts/autoloop/reconcile-inflight.js
git add platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): reconcileInFlight — derive in-flight state from git/PR (idempotent)"
```

---

## Task 2: `selectCard` — drop In-Progress guard, skip `[x]` cards

**Files:** Modify `scripts/autoloop/select-card.js`; Test `platform/test/run-autoloop-select.js`.

- [ ] **Step 1: Update the harness (replace SC-2, add PC-* + SC-8)**

In `run-autoloop-select.js`, **replace** the existing `SC-2` line:
```js
ok('SC-2 in-progress -> needs-attention',
  selectCard({ boardMd: BOARD.replace('## In Progress', '## In Progress\n- [ ] [[Busy card]]'), loadBody }).action === 'needs-attention');
```
with:
```js
ok('SC-2 parked In Progress does NOT block a Planning pick',
  selectCard({ boardMd: BOARD.replace('## In Progress', '## In Progress\n- [ ] [[Parked workstream]]'), loadBody }).action === 'work');
```
Then, after the existing `SC-7` line, add:
```js
// ---- parsePlanningChecked + checked-skip (PC-*, SC-8) ----
ok('PC-1 finds an [x]-checked Planning card',
  parsePlanningChecked('## In Planning\n- [x] [[Done card]]\n- [ ] [[Active]]\n## In Progress\n').has('Done card'));
ok('PC-2 unchecked card not in the set',
  parsePlanningChecked('## In Planning\n- [ ] [[Active]]\n').has('Active') === false);
ok('PC-3 checked card in In Progress is NOT a Planning-checked',
  parsePlanningChecked('## In Planning\n\n## In Progress\n- [x] [[Elsewhere]]\n').has('Elsewhere') === false);
const checkedBoard = '## In Planning\n- [x] [[Done card]]\n- [ ] [[Fix breadcrumb paren]]\n## In Progress\n';
ok('SC-8 skips [x]-checked Planning card, picks next',
  selectCard({ boardMd: checkedBoard, loadBody }).card === 'Fix breadcrumb paren');
```
Also update the require at the top to pull in `parsePlanningChecked`:
```js
const { isBroadScope, parseBoard, recommendedFrom, selectCard, parsePlanningChecked } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'select-card.js'));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `parsePlanningChecked is not a function`, plus `SC-2` (old behavior) and `SC-8`.

- [ ] **Step 3: Add `parsePlanningChecked` and update `selectCard` in `select-card.js`**

Add this function (next to `parseBoard`):
```js
// Names of cards in the "In Planning" column that are [x]/[X]-checked (treated
// as done, not pickable). Scoped to In Planning only.
function parsePlanningChecked(md) {
  const set = new Set();
  let inPlanning = false;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { inPlanning = h[1].trim() === 'In Planning'; continue; }
    if (!inPlanning) continue;
    const m = raw.match(/^\s*-\s*\[[xX]\]\s*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (m) set.add(m[1].trim());
  }
  return set;
}
```
In `selectCard`, **delete** this block (the In-Progress guard):
```js
  const cols = parseBoard(boardMd);
  if (cols['In Progress'].length) {
    return { action: 'needs-attention', reason: 'In Progress non-empty', cards: cols['In Progress'] };
  }
  const planning = cols['In Planning'];
```
and **replace** it with:
```js
  const cols = parseBoard(boardMd);
  const planning = cols['In Planning'];
```
Then, inside `selectCard`, just before the `for (const card of ordered)` loop, add:
```js
  const checked = parsePlanningChecked(boardMd);
```
and inside that loop, as the FIRST statement of the loop body, add:
```js
    if (checked.has(card)) { skipped.push({ card, reason: 'checked (done) in Planning' }); continue; }
```
Finally, update the exports line to include `parsePlanningChecked`:
```js
module.exports = { selectCard, isBroadScope, parseBoard, recommendedFrom, parsePlanningChecked };
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — all assertions green (SC-2 now asserts non-blocking; PC-1..3 + SC-8 pass). If red, fix the code.

- [ ] **Step 5: Run the standalone harness + confirm count**

Run: `npm run test:autoloop`
Expected: `Tests: N/N` with N = prior 24 + 9 (RI) + 3 (PC) + 1 (SC-8) = **37/37** (SC-2 replaced, not added). If the number differs, recount the added assertions — do not “fix” by deleting tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/autoloop/select-card.js platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): selectCard ignores parked In Progress + skips [x]-checked Planning cards"
```

---

## Task 3: Command Phase A — reconcile-then-gate

**Files:** Modify `.claude/commands/sauce-autoloop.md`.

This is prose (no unit test); validated by Task 4's preflight + a manual dry-run.

- [ ] **Step 1: Replace the Phase A section**

Find the current `## Phase A — Orient + gate (autonomous)` section (its 3 numbered steps) and replace the WHOLE section with:

````markdown
## Phase A — Orient + reconcile (autonomous)

1. **Halt check.** If `~/projects/repos/sauce/.autoloop-halt` exists, print "autoloop halted by sentinel" and **exit** (no handoff).
2. Run `npm run status`; confirm a clean tree on `main` (or a resume branch). If the working tree has uncommitted changes you didn't create, print the state and **exit** (do not stomp).
3. **Reconcile in-flight state from git/PR (the source of truth):**
   ```bash
   node scripts/autoloop/reconcile-inflight.js
   ```
   Branch on `status`:
   - `unknown` → print "could not determine in-flight state (gh/git failed)" and **exit** (fail-safe — never assume idle; next fire retries).
   - `pr-open` → write a handoff ("card `<card>` — PR #`<number>` open, auto-merge pending"), **exit**.
   - `implementing` → **live:** resume the `autoloop/<card>` branch if its work is recoverable, else discard it cleanly (`git checkout main && git branch -D autoloop/<card>` and delete the remote) and move the card back to Planning; write a handoff; **exit**. **dry-run:** note it in a handoff and **exit** (no writes).
   - `merged` → **live:** close the card on the board (projection — move to Completed, set `completed_in_version`); write a handoff; **exit**. **dry-run:** note + **exit**.
   - `failed` → **live:** move the card to Blocked (projection) with the PR number; write a handoff; **exit**. **dry-run:** note + **exit**.
   - `idle` → continue to Phase B.

   (One reconcile action per turn — closing/blocking/waiting IS the turn's work; the next turn, now `idle`, picks fresh.)
4. Read the latest handoff (`ls -t ~/projects/repos/sauce/Docs/prompts/*sauce-autoloop*-handoff.md 2>/dev/null | head -1`) for the `Recommended next` card.
````

- [ ] **Step 2: Update Phase B's intro note (parked In Progress no longer relevant)**

In `## Phase B — Select`, the selector is only reached when `idle`. Confirm the bash block does NOT pass `--halt` (already removed in Inc 1). Replace the Phase B opening line `## Phase B — Select (deterministic, NO AskUserQuestion)` body's first sentence by adding, right after that heading:
```markdown
Reached only when Phase A's reconcile returned `idle`. `selectCard` ignores the board's "In Progress" (your parked workstreams) and skips `[x]`-checked Planning cards — it picks only fresh, unchecked Planning work.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/sauce-autoloop.md
git commit -m "feat(autoloop): command Phase A reconciles in-flight state before selecting"
```

---

## Task 4: Full preflight + architecture-doc sync

**Files:** none new; runs the gate + updates the reference doc.

- [ ] **Step 1: Run the full preflight gate**

Run: `npm run release:preflight`
Expected: exit 0 (GREEN), with `run-autoloop-select.js` reporting `Tests: 37/37` near the end. If a harness UNRELATED to autoloop fails, stop and report (do not fix unrelated).

- [ ] **Step 2: Update the architecture reference doc's §10 finding + §3.2/§3.4**

Edit `~/notes/sauce/headspace-sauce/spice/projects/sauce/docs/workflow-loops/initial-brainstorm/Implementation Setup - Architecture.md`: in §10, mark items 1 (In-Progress semantics) and 2 (checked Planning cards) **RESOLVED in Increment 2a** with a one-line note pointing at `reconcileInFlight` + `parsePlanningChecked`; add a short "§3.5 reconcile-inflight.js" subsection describing the git/PR-source-of-truth model. (This doc lives in the vault, not git — no commit.)

- [ ] **Step 3: Commit any workshop changes** (none expected beyond Tasks 1–3) and confirm clean tree:

```bash
git status --short   # expect only the pre-existing untracked breadcrumb handoff
```

---

## Task 5: Final review + CI-gated PR

- [ ] **Step 1:** Dispatch a whole-branch code review (spec compliance + the reconcile edge cases + fail-safe behavior). Address findings.
- [ ] **Step 2:** Push + open the auto-merge PR (after the user confirms, same as Increment 1):
```bash
git push -u origin feat/sauce-autoloop-increment-2a
gh pr create --base main --title "feat(autoloop): increment 2a — reconcile in-flight via git/PR; ignore parked In Progress" --body "<summary>"
gh pr merge --auto --squash
```
- [ ] **Step 3:** Monitor the release pipeline to a shipped `v0.x.0` (same 7-stage checklist as Increment 1).

---

## Self-review
- **Spec coverage:** reconcileInFlight (Task 1) · selectCard drop-guard + checked-skip (Task 2) · command Phase A reconcile + dry-run/live split (Task 3) · harness extensions (Tasks 1–2) · preflight + doc sync (Task 4) · review + ship (Task 5). All design components covered.
- **No placeholders:** every code/edit step shows full content; the only `<summary>`/`<...>` are PR-body/handoff free-text written at runtime.
- **Type consistency:** `reconcileInFlight` returns `{status, card, nextAction, number?, extra?}` used identically in harness + command; `status` values (`idle|implementing|pr-open|merged|failed|unknown`) and `nextAction` values (`pick|resume-or-clean|wait|close-card|block-card|halt`) match across the function, the harness, and the command's Phase A branch list; `parsePlanningChecked` returns a `Set` (`.has()`) consistently in the helper, `selectCard`, and the `PC-*` tests; `slugFromRef('autoloop/x') → 'x'` consistent everywhere.
