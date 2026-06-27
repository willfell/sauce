# Sauce Autoloop — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a non-interactive `/sauce-autoloop` command that runs exactly ONE bounded autonomous turn against the project board and exits — picking the top eligible card via a deterministic, unit-tested selector (with a scope-safety heuristic + kill-switch), and operating in a first-class `--dry-run` mode for a "start slow, assess" rollout.

**Architecture:** Thin orchestrator prompt (`.claude/commands/sauce-autoloop.md`) + tested deterministic helpers (`scripts/autoloop/*.js`). The prompt owns the model-driven parts (implement the card); the scripts own everything deterministic (card selection, scope heuristic, handoff rendering, halt check) and are gated by a behavioral harness wired into `release:preflight`. One invocation = one turn = exit; cadence is owned by an external scheduler, never an internal re-loop. This dogfoods the very flow the autoloop automates: build it on a branch → PR → CI-gated auto-merge.

**Tech Stack:** Node.js (zero-dep, `>=18`, CommonJS) for helpers + harness; Markdown for the command prompt; `git` + `gh` 2.83 for the feature-branch/PR/auto-merge path; the existing `npm run release:preflight` (32-harness chain) as the deterministic gate.

---

## Scope of THIS increment (and what it explicitly defers)

**In scope (Increment 1):**
- The `/sauce-autoloop` command (non-interactive, one-turn-and-exit).
- Deterministic selector: halt-check → In-Progress guard → no-work → recommendation-first pick → broad-scope skip.
- Handoff renderer (reuses the human pipeline's Phase E format).
- A behavioral harness for the deterministic core, wired into `release:preflight`.
- `--dry-run` mode (select + propose + write a dry-run handoff; NO implementation, NO PR).
- The usage/cadence knobs (`--max-turns`, model override, cheap idle-exit) documented + wired into the headless invocation.

**Deferred (later increments — do NOT build here):**
- **Increment 2 — Scout:** self-discovery when the board is empty. (Inc 1 exits cheaply on `no-work`.)
- **Increment 3 — Gate B:** the separate adversarial verifier agent + "no-behavioral-change-without-a-harness" enforcement. (Inc 1 uses Gate A only: `release:preflight` + dogfood.)
- **Increment 4 — Canary deploy:** ERO `sauce update` + promotion surface for accuris/headspace.
- **Increment 5 — Substrate hardening:** the launchd plist, `caffeinate`, fail-closed auth check, structured logging, daily-turn budget enforcement, kill-switch UX. (Inc 1 ships a *minimal* documented plist for the dry-run assessment window only.)

---

## Cadence & usage model (per the "start slow / don't burn usage" constraint)

These are design invariants every task below must respect:

1. **One turn per process.** The command does Phase A→E once, then exits. It MUST NOT call `ScheduleWakeup` or otherwise re-loop in-session. (This is the single biggest difference from `/sauce-pipeline`, which re-fires every 270s.)
2. **External cadence ≈ every 2 hours.** A `launchd` job (or `/loop 2h`) fires the process. Inc 1 ships the plist in dry-run; full scheduler hardening is Increment 5.
3. **Cheap idle-exit.** If the selector returns `halt` / `no-work` / `needs-attention` / `no-eligible-work`, the turn exits BEFORE any model-heavy work — a near-zero-cost tick.
4. **Cheaper model for routine turns.** The headless invocation defaults to `--model claude-sonnet-4-6`; Opus is an opt-in escalation for hard cards. (Your interactive sessions are unaffected.)
5. **Bounded turn.** `--max-turns 40` caps a single turn's agent loop.
6. **Dry-run first.** The rollout schedules `--dry-run` for a few days so you can assess selection quality + cost before a single real PR is opened.

---

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `scripts/autoloop/select-card.js` | Create | Pure deterministic selector + scope heuristic + board parser. Exports `selectCard`, `isBroadScope`, `parseBoard`, `recommendedFrom`. CLI: `--board --handoff --halt --cards-root --json`. |
| `scripts/autoloop/render-handoff.js` | Create | Pure handoff-markdown renderer (Phase E format). Exports `renderHandoff`. CLI for ad-hoc use. |
| `platform/test/run-autoloop-select.js` | Create | Zero-dep behavioral harness for the two helpers. |
| `package.json` | Modify | Add `test:autoloop`; append it to the `release:preflight` chain. |
| `.claude/commands/sauce-autoloop.md` | Create | The non-interactive one-turn orchestrator prompt. |
| `sauce-autoloop.plist.sample` (repo root, Inc 1 minimal) | Create | A documented launchd sample (dry-run, every 2h) for the assessment window. NOT auto-loaded. |

All implementation happens on branch `feat/sauce-autoloop-increment-1`, landed via a CI-gated auto-merge PR (dogfooding the target flow). **Do NOT manually bump versions or tag** — the release pipeline owns that on merge.

---

## Task 1: `isBroadScope()` — the scope-safety heuristic

**Files:**
- Create: `scripts/autoloop/select-card.js`
- Test: `platform/test/run-autoloop-select.js`

- [ ] **Step 1: Write the failing harness (scope cases only for now)**

Create `platform/test/run-autoloop-select.js`:

```js
#!/usr/bin/env node
/**
 * run-autoloop-select — preflight harness for the Sauce Autoloop deterministic
 * helpers (scripts/autoloop/select-card.js + render-handoff.js). Zero-dep.
 */
'use strict';
const path = require('path');
const { isBroadScope, parseBoard, recommendedFrom, selectCard } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'select-card.js'));
const { renderHandoff } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'render-handoff.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

// ---- isBroadScope (AB-*) ----
ok('AB-1 "audit the project blueprint" is broad', isBroadScope('audit the project blueprint').broad === true);
ok('AB-2 "redesign navigation" is broad', isBroadScope('Redesign navigation').broad === true);
ok('AB-3 "fix breadcrumb paren bug" is NOT broad', isBroadScope('fix breadcrumb paren bug').broad === false);
ok('AB-4 empty text is NOT broad', isBroadScope('').broad === false);
ok('AB-5 >1200 char body is broad', isBroadScope('x'.repeat(1300)).broad === true);

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `Cannot find module '.../scripts/autoloop/select-card.js'`.

- [ ] **Step 3: Create `scripts/autoloop/select-card.js` with `isBroadScope` (+ stubs for the rest)**

```js
#!/usr/bin/env node
/**
 * select-card — deterministic work selector for the Sauce Autoloop.
 * Pure functions over board markdown; no model, no side effects.
 *
 * Exports: selectCard, isBroadScope, parseBoard, recommendedFrom
 * CLI: node scripts/autoloop/select-card.js --board <p> --handoff <p> [--halt <p>] [--cards-root <p>] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Broad-scope heuristic: signals multi-cycle work the autonomous loop must NOT
// pick (it would run unbounded). Deterministic mirror of the human pipeline's
// Phase B scope sanity-check.
const BROAD_PATTERNS = [
  /\baudit\b/i, /\bredesign\b/i, /\broadmap\b/i, /\boverhaul\b/i,
  /\beverything\b/i, /\ball (blueprints|mechanisms|vaults)\b/i,
  /\bmigrat(e|ion) (all|every)\b/i, /\bfigure out\b/i,
];

function isBroadScope(text) {
  if (!text) return { broad: false, reason: null };
  for (const re of BROAD_PATTERNS) {
    if (re.test(text)) return { broad: true, reason: `matched ${re}` };
  }
  if (text.length > 1200) return { broad: true, reason: 'body > 1200 chars' };
  return { broad: false, reason: null };
}

function parseBoard(md) { return { 'In Planning': [], 'In Progress': [], 'Blocked': [], 'Completed': [] }; }
function recommendedFrom(handoffMd) { return null; }
function selectCard(opts) { return { action: 'no-work', reason: 'not implemented' }; }

module.exports = { selectCard, isBroadScope, parseBoard, recommendedFrom };

if (require.main === module) { console.log('select-card CLI not yet implemented'); process.exit(0); }
```

- [ ] **Step 4: Run to verify scope tests pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — `Tests: 5/5`.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/sauce-autoloop-increment-1
git add scripts/autoloop/select-card.js platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): add isBroadScope scope-safety heuristic + harness"
```

---

## Task 2: `parseBoard()` + `recommendedFrom()` — board parsing

**Files:**
- Modify: `scripts/autoloop/select-card.js`
- Test: `platform/test/run-autoloop-select.js`

- [ ] **Step 1: Add failing parse cases to the harness**

Insert before the final `console.log('')` block in `run-autoloop-select.js`:

```js
// ---- parseBoard + recommendedFrom (PB-*) ----
const BOARD = [
  '# Sauce Board', '',
  '## In Planning', '- [ ] [[Fix breadcrumb paren]]', '- [ ] [[Add render harness|harness]]', '',
  '## In Progress', '',
  '## Blocked', '- [ ] [[Wiki area redesign]]', '',
  '## Completed', '- [[Old card]] — v0.135.0', '',
].join('\n');
const cols = parseBoard(BOARD);
ok('PB-1 In Planning has 2 cards', cols['In Planning'].length === 2, JSON.stringify(cols['In Planning']));
ok('PB-2 parses plain wikilink', cols['In Planning'][0] === 'Fix breadcrumb paren');
ok('PB-3 strips alias', cols['In Planning'][1] === 'Add render harness');
ok('PB-4 In Progress empty', cols['In Progress'].length === 0);
ok('PB-5 Blocked has 1', cols['Blocked'].length === 1);
ok('PB-6 recommendedFrom finds card', recommendedFrom('## Recommended next\n- **Card:** [[Add render harness]]') === 'Add render harness');
ok('PB-7 recommendedFrom null when absent', recommendedFrom('## Board snapshot\nnothing') === null);
```

- [ ] **Step 2: Run to verify failure**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL on PB-1..PB-7 (stubs return empty).

- [ ] **Step 3: Implement `parseBoard` + `recommendedFrom`**

Replace the two stubs in `select-card.js`:

```js
// Parse a kanban-ish board markdown into columns → arrays of card link names.
function parseBoard(md) {
  const cols = { 'In Planning': [], 'In Progress': [], 'Blocked': [], 'Completed': [] };
  let cur = null;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { const name = h[1].trim(); cur = Object.prototype.hasOwnProperty.call(cols, name) ? name : null; continue; }
    if (!cur) continue;
    const m = raw.match(/^\s*-\s*(?:\[[ xX]?\]\s*)?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (m) cols[cur].push(m[1].trim());
  }
  return cols;
}

// Extract the "Recommended next" card name from a handoff markdown, if present.
function recommendedFrom(handoffMd) {
  if (!handoffMd) return null;
  const m = String(handoffMd).match(/##\s*Recommended next[\s\S]*?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/i);
  return m ? m[1].trim() : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — `Tests: 12/12`.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/select-card.js platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): parse board columns + recommended-next handoff card"
```

---

## Task 3: `selectCard()` — the decision function

**Files:**
- Modify: `scripts/autoloop/select-card.js`
- Test: `platform/test/run-autoloop-select.js`

- [ ] **Step 1: Add failing selectCard cases**

Insert before the final summary block:

```js
// ---- selectCard (SC-*) ----
const bodies = {
  'Fix breadcrumb paren': 'Small render fix for a stray paren.',
  'Add render harness': 'Add a behavioral harness for X.',
  'Wiki area redesign': 'Redesign the entire wiki area across all blueprints.',
};
const loadBody = (c) => bodies[c] || '';
ok('SC-1 halt wins', selectCard({ haltExists: true, boardMd: BOARD, loadBody }).action === 'halt');
ok('SC-2 in-progress → needs-attention',
  selectCard({ boardMd: BOARD.replace('## In Progress', '## In Progress\n- [ ] [[Busy card]]'), loadBody }).action === 'needs-attention');
ok('SC-3 empty planning → no-work',
  selectCard({ boardMd: '## In Planning\n\n## In Progress\n', loadBody }).action === 'no-work');
const pick = selectCard({ boardMd: BOARD, loadBody });
ok('SC-4 picks first in-scope planning card', pick.action === 'work' && pick.card === 'Fix breadcrumb paren', JSON.stringify(pick));
const recPick = selectCard({ boardMd: BOARD, handoffMd: '## Recommended next [[Add render harness]]', loadBody });
ok('SC-5 recommendation-first', recPick.action === 'work' && recPick.card === 'Add render harness');
const broadBoard = '## In Planning\n- [ ] [[Wiki area redesign]]\n- [ ] [[Fix breadcrumb paren]]\n## In Progress\n';
const skipPick = selectCard({ boardMd: broadBoard, loadBody });
ok('SC-6 skips broad card, picks next', skipPick.action === 'work' && skipPick.card === 'Fix breadcrumb paren' && skipPick.skipped.length === 1);
const allBroad = '## In Planning\n- [ ] [[Wiki area redesign]]\n## In Progress\n';
ok('SC-7 all broad → no-eligible-work', selectCard({ boardMd: allBroad, loadBody }).action === 'no-eligible-work');
```

- [ ] **Step 2: Run to verify failure**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL on SC-1..SC-7 (stub returns `no-work`).

- [ ] **Step 3: Implement `selectCard`**

Replace the `selectCard` stub in `select-card.js`:

```js
/**
 * selectCard — decide what (if anything) this turn should work on.
 * @param {object} o
 * @param {boolean} o.haltExists  kill-switch sentinel present?
 * @param {string}  o.boardMd     project board markdown
 * @param {string}  [o.handoffMd] latest handoff markdown (for recommendation)
 * @param {(card:string)=>string} [o.loadBody] returns a card's body text
 * @returns {{action:string, card?:string, reason:string, skipped?:Array, cards?:string[]}}
 */
function selectCard(o) {
  const { haltExists, boardMd, handoffMd, loadBody } = o || {};
  if (haltExists) return { action: 'halt', reason: 'kill-switch sentinel present' };
  const cols = parseBoard(boardMd);
  if (cols['In Progress'].length) {
    return { action: 'needs-attention', reason: 'In Progress non-empty', cards: cols['In Progress'] };
  }
  const planning = cols['In Planning'];
  if (!planning.length) return { action: 'no-work', reason: 'Planning column empty' };
  const rec = recommendedFrom(handoffMd);
  const ordered = rec && planning.includes(rec)
    ? [rec, ...planning.filter((c) => c !== rec)]
    : planning.slice();
  const skipped = [];
  for (const card of ordered) {
    const body = loadBody ? (loadBody(card) || '') : '';
    const scope = isBroadScope(`${card}\n${body}`);
    if (scope.broad) { skipped.push({ card, reason: scope.reason }); continue; }
    return {
      action: 'work', card, skipped,
      reason: rec === card ? 'recommended + in-scope' : 'first in-scope Planning card',
    };
  }
  return { action: 'no-eligible-work', reason: 'all Planning cards are broad-scope', skipped };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — `Tests: 19/19`.

- [ ] **Step 5: Wire the CLI (body-loading + JSON output)**

Replace the `if (require.main === module)` block:

```js
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) { const key = k.slice(2); const v = argv[i + 1]; if (v && !v.startsWith('--')) { a[key] = v; i++; } else a[key] = true; }
  }
  return a;
}

function cliLoadBody(cardsRoot) {
  return (card) => {
    if (!cardsRoot) return '';
    // tasks/<W>/board/<Card>/<Card>.md — glob by basename match, one level of workstream.
    try {
      const fname = `${card}.md`;
      const stack = [cardsRoot];
      while (stack.length) {
        const dir = stack.pop();
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) stack.push(p);
          else if (ent.name === fname) return fs.readFileSync(p, 'utf8');
        }
      }
    } catch (_) { /* fall through */ }
    return '';
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };
  const result = selectCard({
    haltExists: args.halt ? fs.existsSync(args.halt) : false,
    boardMd: args.board ? read(args.board) : '',
    handoffMd: args.handoff ? read(args.handoff) : '',
    loadBody: cliLoadBody(args['cards-root']),
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.action}${result.card ? ': ' + result.card : ''} — ${result.reason}`);
  process.exit(0);
}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/autoloop/select-card.js platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): selectCard decision fn (halt/in-progress/no-work/pick/scope-skip) + CLI"
```

---

## Task 4: `render-handoff.js` — handoff markdown renderer

**Files:**
- Create: `scripts/autoloop/render-handoff.js`
- Test: `platform/test/run-autoloop-select.js`

- [ ] **Step 1: Add failing renderHandoff cases**

Insert before the summary block:

```js
// ---- renderHandoff (RH-*) ----
const ho = renderHandoff({
  roundN: 7, date: '2026-06-27', mode: 'dry-run',
  outcome: { action: 'work', card: 'Fix breadcrumb paren' },
  board: parseBoard(BOARD),
  recommendedNext: 'Add render harness',
});
ok('RH-1 has title with round', /Sauce Autoloop Turn 7/.test(ho));
ok('RH-2 names the card', ho.includes('Fix breadcrumb paren'));
ok('RH-3 marks dry-run', /dry-run/i.test(ho));
ok('RH-4 lists In Planning section', ho.includes('### In Planning'));
ok('RH-5 carries recommended next', ho.includes('Add render harness'));
```

- [ ] **Step 2: Run to verify failure**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `Cannot find module '.../render-handoff.js'`.

- [ ] **Step 3: Create `scripts/autoloop/render-handoff.js`**

```js
#!/usr/bin/env node
/**
 * render-handoff — deterministic Sauce Autoloop handoff markdown.
 * Pure: state in → markdown string out. Mirrors /sauce-pipeline Phase E.
 * Exports: renderHandoff
 */
'use strict';

function listCol(board, name) {
  const arr = (board && board[name]) || [];
  return arr.length ? arr.map((c) => `- [[${c}]]`).join('\n') : '- (empty)';
}

/**
 * @param {object} o
 * @param {number} o.roundN
 * @param {string} o.date            ISO YYYY-MM-DD
 * @param {string} o.mode            'dry-run' | 'live'
 * @param {object} o.outcome         { action, card?, reason?, version? }
 * @param {object} o.board           parseBoard() result (post-turn)
 * @param {string} [o.recommendedNext]
 * @param {string} [o.notes]
 */
function renderHandoff(o) {
  const { roundN, date, mode, outcome, board, recommendedNext, notes } = o || {};
  const card = outcome && outcome.card ? outcome.card : '(none)';
  const ver = outcome && outcome.version ? outcome.version : '(no release this turn)';
  return [
    `# Sauce Autoloop Turn ${roundN} — handoff`,
    '',
    `**Date:** ${date}`,
    `**Mode:** ${mode}`,
    `**Outcome:** ${outcome ? outcome.action : 'unknown'}${outcome && outcome.reason ? ' — ' + outcome.reason : ''}`,
    `**Card:** ${card}`,
    `**Version shipped:** ${ver}`,
    '',
    '## Board snapshot (after this turn)',
    '',
    '### In Planning', listCol(board, 'In Planning'), '',
    '### In Progress', listCol(board, 'In Progress'), '',
    '### Blocked', listCol(board, 'Blocked'), '',
    '## Recommended next',
    `- **Card:** ${recommendedNext ? `[[${recommendedNext}]]` : 'NONE'}`,
    '',
    '## Notes',
    `- ${notes || 'none'}`,
    '',
  ].join('\n');
}

module.exports = { renderHandoff };

if (require.main === module) {
  console.log(renderHandoff({ roundN: 0, date: '1970-01-01', mode: 'dry-run', outcome: { action: 'no-work' }, board: {} }));
  process.exit(0);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — `Tests: 24/24`.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/render-handoff.js platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): deterministic handoff renderer + tests"
```

---

## Task 5: Wire the harness into `release:preflight`

**Files:**
- Modify: `package.json:9-42`

- [ ] **Step 1: Add the `test:autoloop` script**

In `package.json` `scripts`, after the `"test:render-safe"` line, add:

```json
    "test:autoloop": "node platform/test/run-autoloop-select.js",
```

- [ ] **Step 2: Append the harness to the `release:preflight` chain**

At the very end of the `"release:preflight"` value (after `... && node platform/test/run-release-bumper.js`), append:

```
 && node platform/test/run-autoloop-select.js
```

- [ ] **Step 3: Run the standalone script + the full chain**

Run: `npm run test:autoloop`
Expected: PASS — `Tests: 24/24`.

Run: `npm run release:preflight`
Expected: the full chain runs to completion, exit 0 (GREEN). If anything unrelated is red, STOP and surface it — do not "fix" unrelated harnesses in this increment.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "test(autoloop): wire run-autoloop-select into release:preflight"
```

---

## Task 6: The `/sauce-autoloop` command prompt

**Files:**
- Create: `.claude/commands/sauce-autoloop.md`

This file is a prompt, not code — it has no unit test. It is validated by Task 7 (dogfood persistence + a dry-run turn). Write it to mirror `/sauce-pipeline`'s phase structure but **non-interactive + one-turn-and-exit + dry-run-aware**.

- [ ] **Step 1: Create `.claude/commands/sauce-autoloop.md`**

````markdown
---
description: Sauce Autoloop — ONE non-interactive autonomous turn against the board, then exit
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, Agent, Workflow
argument-hint: "[--dry-run] (default) | --live"
---

# /sauce-autoloop

Run **exactly ONE** bounded autonomous turn of the Sauce loop, then **exit**. This command
NEVER calls `ScheduleWakeup` and NEVER re-loops in-session — cadence is owned by the external
scheduler (≈ every 2h). Full design: `Docs/plans/2026-06-27-sauce-autoloop-increment-1-plan.md`
and the findings doc at `~/notes/sauce/headspace-sauce/spice/projects/sauce/docs/workflow-loops/initial-brainstorm/Init.md`.

**Mode:** Default is **dry-run** (select + propose + write a dry-run handoff; NO implementation,
NO commits, NO PR). Pass `--live` to enable the implement→gate→PR path. During the assessment
window, stay in dry-run.

**Repo + path facts** (same as `/sauce-pipeline`):
- Workshop repo: `~/projects/repos/sauce/`
- Project board: `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md`
- Cards root: `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/`
- Kill-switch sentinel: `~/projects/repos/sauce/.autoloop-halt` (if present → halt)
- Handoff archive: `~/projects/repos/sauce/Docs/prompts/sauce-autoloop-*-handoff.md`

---

## Phase A — Orient + gate (autonomous)

1. **Halt check.** If `~/projects/repos/sauce/.autoloop-halt` exists, print "autoloop halted by sentinel" and **exit** (no handoff, no further work).
2. Run `npm run status` (workshop survey) and confirm a clean tree on `main` (or resume branch). If the tree is dirty with someone else's work, print the state and **exit** (do not stomp).
3. Find the latest handoff: `ls -t ~/projects/repos/sauce/Docs/prompts/sauce-autoloop-*-handoff.md | head -1`. Read it if present.

## Phase B — Select (deterministic, NO AskUserQuestion)

1. Call the selector:
   ```bash
   node scripts/autoloop/select-card.js \
     --board ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md \
     --handoff "<latest handoff or omit>" \
     --halt ~/projects/repos/sauce/.autoloop-halt \
     --cards-root ~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks \
     --json
   ```
2. Branch on `action`:
   - `halt` / `no-work` / `no-eligible-work` / `needs-attention` → write a dry-run handoff via `render-handoff.js` (Phase E), print one line, **exit cheaply** (no model-heavy work). For `needs-attention`, the handoff names the stuck In-Progress card(s) for the human.
   - `work` → proceed with `result.card`.

## Phase C — Implement (only if `--live`; in dry-run, PROPOSE only)

- **Dry-run:** emit a single short paragraph — "Intended approach for `<card>`" (≤120 words) derived from the card body — into the handoff's Notes. Do NOT edit any workshop file. Skip to Phase E.
- **Live:**
  1. Move the card to In Progress on the three surfaces (board, workstream sub-board, card frontmatter) — same edits as `/sauce-pipeline` Phase B step 7.
  2. `git checkout -b autoloop/<card-slug>`.
  3. Implement the card with conventional commits. **Hard rule:** any behavioral change to a mechanism/blueprint MUST ship a new/strengthened `platform/test/run-*.js` harness (scaffold via `npm run scaffold-harness`). (Gate B — the separate verifier — arrives in Increment 3; until then this rule is self-enforced + reviewed on the PR.)
  4. **Gate A:** run `npm run release:preflight` AND `node platform/install.js --vault . --auto-approve`. If either is RED → discard the branch (`git checkout main && git branch -D autoloop/<card-slug>`), move the card to Blocked, write a blocked handoff, **exit**.
  5. **Do NOT bump versions or tag.** Push the branch and open a CI-gated auto-merge PR:
     ```bash
     git push -u origin autoloop/<card-slug>
     gh pr create --fill --base main --head autoloop/<card-slug>
     gh pr merge --auto --squash
     ```
     The PR auto-merges only when the `ci` required checks (macOS + Ubuntu `release:preflight`) are green; the release pipeline then bumps/tags/ships. This turn does NOT wait for the merge.

## Phase D — Close (live only)

- Leave the card In Progress with a status note "PR open, auto-merge pending"; the NEXT turn's Phase A reconciles (merged+shipped → Completed; CI failed/PR closed → Blocked). (Synchronous close + canary deploy arrive in Increment 4.)

## Phase E — Handoff + EXIT

1. Determine turn number N = (count of existing `sauce-autoloop-*-handoff.md`) + 1.
2. Render the handoff:
   ```bash
   node scripts/autoloop/render-handoff.js   # or call renderHandoff() inline with the gathered state
   ```
   Write it to `~/projects/repos/sauce/Docs/prompts/<YYYY-MM-DD>-sauce-autoloop-turn-N-handoff.md`.
3. **Live only:** commit + push the handoff to `main` (`docs(prompts): autoloop turn N handoff`). **Dry-run:** leave it as an uncommitted local artifact (or commit on the branch if one exists) — do not push noise to main during the assessment window.
4. **EXIT.** Do NOT call `ScheduleWakeup`. The external scheduler fires the next turn.

## Usage / cost guardrails (always)

- One card per turn. Cheap idle-exit on non-`work` actions.
- Headless invocation defaults to a cheaper model + bounded turns (see the plan's "Headless invocation").
- If you ever feel the turn ballooning past the card's scope, STOP, write a blocked handoff, and exit — small diffs only.
````

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/sauce-autoloop.md
git commit -m "feat(autoloop): non-interactive /sauce-autoloop one-turn command (dry-run default)"
```

---

## Task 7: Dogfood persistence + a dry-run turn (validation)

**Files:** none created; this is verification.

- [ ] **Step 1: Confirm the dogfood install does NOT clobber the command**

Run: `node platform/install.js --vault . --auto-approve`
Then: `test -f .claude/commands/sauce-autoloop.md && echo PRESENT`
Expected: `PRESENT` (the installer only manages `install/upgrade/bootstrap.md`; workshop-local commands persist).

- [ ] **Step 2: Run the selector against the real board**

Run:
```bash
node scripts/autoloop/select-card.js \
  --board ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md \
  --cards-root ~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks --json
```
Expected: valid JSON with an `action` of `work` / `no-work` / `no-eligible-work` / `needs-attention`. Sanity-check the chosen card matches what you'd expect a human to pick.

- [ ] **Step 3: Run ONE dry-run turn by hand**

In an interactive Claude Code session: `/sauce-autoloop --dry-run`
Expected: it orients, selects deterministically, writes a dry-run handoff with an "Intended approach" paragraph, and exits — touching NO workshop files and opening NO PR.

- [ ] **Step 4: Commit any handoff/notes the dry-run produced (branch only) — do NOT push to main yet.**

---

## Task 8: Minimal dry-run scheduler for the assessment window

**Files:**
- Create: `sauce-autoloop.plist.sample` (repo root)

This is the *minimal* cadence artifact so the loop "runs every couple hours" in dry-run during assessment. Full substrate hardening (auth fail-closed, logging, daily budget, kill-switch UX) is Increment 5.

- [ ] **Step 1: Create `sauce-autoloop.plist.sample`** (clone of the finance cron shape)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- Sauce Autoloop — DRY-RUN assessment scheduler. Fires every 2h.
     Install:  cp sauce-autoloop.plist.sample ~/Library/LaunchAgents/com.will.sauce-autoloop.plist
               launchctl load ~/Library/LaunchAgents/com.will.sauce-autoloop.plist
     Halt:     touch ~/projects/repos/sauce/.autoloop-halt   (or launchctl unload …)
     Stays DRY-RUN until you flip --live after the assessment window. -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.will.sauce-autoloop</string>
  <key>WorkingDirectory</key><string>/Users/willfellhoelter/projects/repos/sauce</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>caffeinate -i claude -p "/sauce-autoloop --dry-run" --permission-mode acceptEdits --allowedTools "Bash,Read,Write,Edit,Glob,Grep,Skill,Agent" --model claude-sonnet-4-6 --max-turns 40 >> /Users/willfellhoelter/projects/repos/sauce/.autoloop.log 2>&1</string>
  </array>
  <key>StartInterval</key><integer>7200</integer>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
```

- [ ] **Step 2: Add `.autoloop.log` + `.autoloop-halt` to `.gitignore`**

Append to `.gitignore`:
```
.autoloop.log
.autoloop-halt
```

- [ ] **Step 3: Commit**

```bash
git add sauce-autoloop.plist.sample .gitignore
git commit -m "chore(autoloop): minimal dry-run launchd sample + ignore runtime artifacts"
```

- [ ] **Step 4: Open the increment-1 PR (dogfood the flow)**

```bash
git push -u origin feat/sauce-autoloop-increment-1
gh pr create --fill --base main
gh pr merge --auto --squash
```
Expected: CI runs `release:preflight` on macOS + Ubuntu; the PR auto-merges only on green. Watch with `gh pr checks --watch`.

---

## Validation & rollout (the "start slow, assess" window)

1. All 24 harness assertions green + full `release:preflight` green (Tasks 3–5).
2. Dogfood install leaves the command in place (Task 7).
3. One manual dry-run turn produces a sane handoff (Task 7).
4. Increment-1 PR merges green (Task 8).
5. **Assessment window (a few days):** load the dry-run plist (Task 8). Every ~2h it selects + proposes at near-zero cost. Review `.autoloop.log` + the dry-run handoffs for: (a) did it pick what you'd pick? (b) did the scope heuristic skip the right things? (c) what did each tick cost? Tune `BROAD_PATTERNS` / the model / `StartInterval` as needed.
6. **Go-live decision (Increment 2+):** only after the dry-run window looks right do we flip `--live` and build Scout + the adversarial verifier + canary deploy.

---

## Self-review notes

- **Spec coverage:** selector (halt/in-progress/no-work/pick/scope-skip) ✔ Tasks 1–3 · handoff ✔ Task 4 · preflight wiring ✔ Task 5 · non-interactive one-turn command ✔ Task 6 · dry-run-first + cadence/usage knobs ✔ Tasks 6 & 8 · dogfood persistence ✔ Task 7.
- **No placeholders:** every code + command step shows full content; no "TBD"/"add error handling".
- **Type consistency:** `selectCard` returns `{action, card?, reason, skipped?, cards?}` used consistently in the harness, CLI, and command prompt; `parseBoard` column keys (`'In Planning'` etc.) match across `selectCard`, `renderHandoff`, and the harness fixtures; helper names (`isBroadScope`, `parseBoard`, `recommendedFrom`, `selectCard`, `renderHandoff`) are identical at definition, export, require, and call sites.
- **Deferred-scope honesty:** Scout (Inc 2), adversarial verifier + no-harness-no-merge enforcement (Inc 3), canary deploy + synchronous close (Inc 4), and substrate hardening (Inc 5) are explicitly OUT and labeled where the command stubs them.
