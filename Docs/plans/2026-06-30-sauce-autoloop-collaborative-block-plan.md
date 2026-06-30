# Sauce Autoloop — Collaborative Block/Unblock Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the loop attempt *anything* on the board, and when it can't proceed, write its questions into the card note + reconcile the user's reply next turn (block becomes a conversation).

**Architecture:** New pure `block-note.js` (`renderBlockedSection` / `parseBlockedResponse`); `select-card.js` drops the broad-scope *skip* for board cards (picks any non-checked Planning card, with an informational `broadHint`); the command's Phase A reconciles the Blocked column (read the reply → unblock if sufficient) and Phase C attempts-then-blocks-with-questions (gates A/B unchanged). Design: `2026-06-30-sauce-autoloop-collaborative-block-design.md`.

**Tech Stack:** Node ≥18 zero-dep CommonJS; the existing `run-autoloop-select.js` harness (in `release:preflight`).

## Scope
**In:** `block-note.js` + harness · `select-card.js` attempt-anything change · command Phase A (reconcile Blocked) + Phase C (attempt + block-with-questions). **Out (separate increment):** canary→auto-promote-all deploy; substrate.

Branch `feat/sauce-autoloop-collab-block` (created). Land via CI-gated auto-merge PR.

## File structure
| File | Status | Responsibility |
| --- | --- | --- |
| `scripts/autoloop/block-note.js` | Create | `renderBlockedSection` (in-card needs-input block) + `parseBlockedResponse` (read the user's reply). |
| `scripts/autoloop/select-card.js` | Modify | Drop broad-scope *skip* for board cards; add `broadHint`. |
| `platform/test/run-autoloop-select.js` | Modify | `BN-*` cases; update `SC-6`/`SC-7`/`SCH-4` to the attempt-anything behavior. |
| `.claude/commands/sauce-autoloop.md` | Modify | Phase A reconcile-Blocked; Phase C attempt + block-with-questions; drop "features out". |

---

## Task 1: `block-note.js` — the in-card block/reply helpers

**Files:** Create `scripts/autoloop/block-note.js`; Test `platform/test/run-autoloop-select.js`.

- [ ] **Step 1: Add failing BN-* assertions**

After the existing requires in `run-autoloop-select.js`, add:
```js
const { renderBlockedSection, parseBlockedResponse } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'block-note.js'));
```
Before the final summary block, insert:
```js
// ---- block-note (BN-*) ----
const blockSec = renderBlockedSection({ date: '2026-06-30', reason: 'convention conflict', needs: ['change the convention or drop the ask?', 'specify the target behavior'] });
ok('BN-1 section has the reason', blockSec.includes('convention conflict'));
ok('BN-2 section lists the needs', blockSec.includes('specify the target behavior'));
ok('BN-3 section has the response marker', blockSec.includes('**Your response:**'));
ok('BN-4 no section → hasSection false', parseBlockedResponse('just a normal card body').hasSection === false);
ok('BN-5 section + empty response → hasResponse false', parseBlockedResponse(blockSec).hasResponse === false);
const blockReplied = blockSec + '\nLet us change the convention — allow the separator here.\n';
ok('BN-6 section + reply → hasResponse true + text',
  (r => r.hasResponse === true && r.response.includes('change the convention'))(parseBlockedResponse(blockReplied)));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `Cannot find module '.../block-note.js'`.

- [ ] **Step 3: Create `scripts/autoloop/block-note.js`**

```js
#!/usr/bin/env node
/**
 * block-note — the autoloop's collaborative block/unblock helpers. Pure.
 * On block, the loop appends a "needs your input" section to the card note;
 * next turn it reads the user's reply under the marker to decide whether to
 * unblock. (No emoji in the header — icons-only house style.)
 *
 * Exports: renderBlockedSection, parseBlockedResponse
 */
'use strict';

const HEADER = '## Autoloop — blocked, needs your input';
const RESPONSE_MARKER = '**Your response:**';

function renderBlockedSection(o) {
  const { date, reason, needs = [] } = o || {};
  const needsList = (needs && needs.length) ? needs.map((n) => `- ${n}`).join('\n') : '- (none specified)';
  return [
    '',
    '---',
    HEADER,
    '',
    `**Blocked:** ${date}`,
    `**Why:** ${reason}`,
    '**What I need from you:**',
    needsList,
    '',
    RESPONSE_MARKER,
    '<!-- write your answer below this line; the loop reads it on its next pass and unblocks if it is enough -->',
    '',
  ].join('\n');
}

function parseBlockedResponse(cardBody) {
  const body = String(cardBody || '');
  const idx = body.lastIndexOf(HEADER);
  if (idx === -1) return { hasSection: false, hasResponse: false, response: '' };
  const section = body.slice(idx);
  const mi = section.indexOf(RESPONSE_MARKER);
  if (mi === -1) return { hasSection: true, hasResponse: false, response: '' };
  let after = section.slice(mi + RESPONSE_MARKER.length);
  after = after.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*---\s*$/gm, '');
  const response = after.trim();
  return { hasSection: true, hasResponse: response.length > 0, response };
}

module.exports = { renderBlockedSection, parseBlockedResponse };

if (require.main === module) {
  console.log(renderBlockedSection({ date: '1970-01-01', reason: 'demo', needs: ['q1', 'q2'] }));
  process.exit(0);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — BN-1..6 green.

- [ ] **Step 5: Commit** (force-add past `/Scripts/`)

```bash
git add -f scripts/autoloop/block-note.js
git add platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): block-note — in-card needs-input section + reply parser"
```

---

## Task 2: `select-card.js` — attempt anything (drop broad-scope skip)

**Files:** Modify `scripts/autoloop/select-card.js`; Test `platform/test/run-autoloop-select.js`.

- [ ] **Step 1: Update SC-6 / SC-7 / SCH-4 to the attempt-anything behavior**

In `run-autoloop-select.js`, **replace** the existing `SC-6` line:
```js
ok('SC-6 skips broad card, picks next', skipPick.action === 'work' && skipPick.card === 'Fix breadcrumb paren' && skipPick.skipped.length === 1);
```
with:
```js
ok('SC-6 broad-looking board card is PICKED (attempt-anything) with a broadHint',
  skipPick.action === 'work' && skipPick.card === 'Wiki area redesign' && !!skipPick.broadHint);
```
**Replace** the existing `SC-7` line:
```js
ok('SC-7 all broad -> no-eligible-work', selectCard({ boardMd: allBroad, loadBody }).action === 'no-eligible-work');
```
with:
```js
ok('SC-7 broad-only board still returns work (no pre-filter)', selectCard({ boardMd: allBroad, loadBody }).action === 'work');
```
**Replace** the existing `SCH-4` line:
```js
ok('SCH-4 chrome-inflated card eligible after strip (would be skipped raw)',
  selectCard({ boardMd: chromeBoard, loadBody: chromeLoad }).action === 'work');
```
with:
```js
ok('SCH-4 chrome-inflated card → broadHint null after strip (still picked)',
  (r => r.action === 'work' && r.broadHint === null)(selectCard({ boardMd: chromeBoard, loadBody: chromeLoad })));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL on SC-6 (old code skips the broad card / no `broadHint`).

- [ ] **Step 3: Update `selectCard` in `select-card.js`**

Find the `for (const card of ordered)` loop body and **replace** it:
```js
  for (const card of ordered) {
    if (checked.has(card)) { skipped.push({ card, reason: 'checked (done) in Planning' }); continue; }
    const body = loadBody ? stripCardChrome(loadBody(card) || '') : '';
    const scope = isBroadScope(`${card}\n${body}`);
    if (scope.broad) { skipped.push({ card, reason: scope.reason }); continue; }
    return {
      action: 'work', card, skipped,
      reason: rec === card ? 'recommended + in-scope' : 'first in-scope Planning card',
    };
  }
  return { action: 'no-eligible-work', reason: 'all Planning cards skipped (broad-scope or checked)', skipped };
```
with:
```js
  for (const card of ordered) {
    if (checked.has(card)) { skipped.push({ card, reason: 'checked (done) in Planning' }); continue; }
    // Attempt-anything: do NOT skip on broad scope — pick it and pass a hint so
    // Phase C can scope/block-with-questions if it really is too big.
    const body = loadBody ? stripCardChrome(loadBody(card) || '') : '';
    const scope = isBroadScope(`${card}\n${body}`);
    return {
      action: 'work', card, skipped, broadHint: scope.broad ? scope.reason : null,
      reason: rec === card ? 'recommended' : 'first Planning card (attempt-anything)',
    };
  }
  return { action: 'no-eligible-work', reason: 'all Planning cards are [x]-checked', skipped };
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — SC-6/7 + SCH-4 reflect attempt-anything; everything else green.

- [ ] **Step 5: Confirm against the REAL board** (it now picks the first card regardless of size)

Run:
```bash
node scripts/autoloop/select-card.js --board ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md --cards-root ~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks --json
```
Expected: `action: work` on the first Planning card (with a `broadHint` field, possibly null).

- [ ] **Step 6: Commit**

```bash
git add scripts/autoloop/select-card.js platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): selectCard attempts any board card (broad-scope is a hint, not a skip)"
```

---

## Task 3: command — Phase A reconcile-Blocked + Phase C attempt/block-with-questions

**Files:** Modify `.claude/commands/sauce-autoloop.md`.

- [ ] **Step 1: Add the reconcile-Blocked step to Phase A**

In `## Phase A — Orient + reconcile`, immediately AFTER the in-flight reconcile step (the `node scripts/autoloop/reconcile-inflight.js` block and its `idle → continue to Phase B`) and BEFORE the "Read the latest handoff" step, INSERT a new numbered step:
````markdown
3b. **Reconcile the Blocked column (collaborative unblock).** Read the board's `## Blocked` cards. For each (oldest first), read its card note `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<W>/board/<Card>/<Card>.md` and run:
   ```bash
   node -e "const{parseBlockedResponse}=require('./scripts/autoloop/block-note.js');const fs=require('fs');console.log(JSON.stringify(parseBlockedResponse(fs.readFileSync(process.argv[1],'utf8'))))" "<card path>"
   ```
   - `hasResponse: false` → the user hasn't answered yet; leave it Blocked, check the next.
   - `hasResponse: true` → READ the response. If it genuinely resolves the blocker (gives the design decision / clarifies scope / approves the convention change), **move the card Blocked → In Progress** (board + frontmatter `status: in_progress`), append a one-line `**User resolved:** <summary>` under the block section, and **this card is the turn's work** — go to Phase C with the user's guidance folded in. If the reply is ambiguous/insufficient, leave it Blocked and check the next. **One unblock per turn.**
   - If no Blocked card unblocks → continue to step 4 / Phase B.
````

- [ ] **Step 2: Rewrite Phase C step 3 (drop "features out") + the block path**

In `## Phase C`, replace step 3 (the implement rule) with:
````markdown
  3. Implement the card with conventional commits. **Attempt anything the card asks** — bug, feature, refactor, whatever. EVERY behavioral change still MUST ship a regression test that fails without it (that's how Gate B verifies it). If the work is genuinely too big for one bounded turn, or a card asks for something that conflicts with a documented platform convention (e.g. `project-blueprint-ui.md` / `note-chrome.md`), or it can't be verified, or it needs a design decision only the user can make — **do NOT force it and do NOT overturn a convention unilaterally.** Instead go to the **block-with-questions** path below. Commit the change (fix/feature + test) before gating.

  **Block-with-questions (when you can't proceed):** append the section from `node scripts/autoloop/block-note.js` — call `renderBlockedSection({date, reason, needs})` with a clear `reason` and a `needs` array of the specific questions/decisions — to the card note's body (`tasks/<W>/board/<Card>/<Card>.md`). Move the card to **Blocked** (board + frontmatter `status: blocked`). Write a handoff. **Exit.** (Next turn's Phase A reconcile will pick it back up once the user replies in the card.)
````

- [ ] **Step 3: Update the Deferred "Scout" note + any "features out" mention**

In the Deferred section, replace the Gate-B bullet's trailing "features remain out" with: "Gate B gates every change; the loop now *attempts* features too — what it can't verify or decide, it **blocks-with-questions** in the card." (Leave the canary/substrate bullets.)

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/sauce-autoloop.md
git commit -m "feat(autoloop): attempt-anything Phase C + block-with-questions in card + Phase A reconcile-Blocked"
```

---

## Task 4: full preflight + architecture-doc sync

- [ ] **Step 1:** Run `npm run release:preflight` → exit 0; `run-autoloop-select.js` reports its new count (prior 75 + BN-1..6 = **81/81**; SC-6/7 + SCH-4 changed, not added). Stop + report if an UNRELATED harness fails.
- [ ] **Step 2:** Edit the architecture reference: add a **§4e — collaborative block/unblock** subsection (attempt-anything + in-card needs-input + Phase A Blocked reconcile); note in §6 (the command phases) that Phase C now attempts features and blocks-with-questions, and Phase A reconciles Blocked. (Vault doc — no commit.)
- [ ] **Step 3:** `git status --short` → only the pre-existing breadcrumb untracked.

---

## Task 5: final review + CI-gated PR

- [ ] **Step 1:** whole-branch review (parseBlockedResponse robustness — empty/partial/multiple sections; the selectCard attempt-anything change doesn't regress the queue path; the command's block/unblock flow is coherent + fail-safe; gates A/B untouched).
- [ ] **Step 2:** push + auto-merge PR (after user confirm), then monitor the ship (BEHIND-aware).

---

## Self-review
- **Spec coverage:** `renderBlockedSection`/`parseBlockedResponse` (Task 1) · attempt-anything selectCard + broadHint (Task 2) · Phase A reconcile-Blocked + Phase C attempt/block-with-questions + drop-features-out (Task 3) · preflight + doc (Task 4) · review + ship (Task 5). All design components covered.
- **No placeholders:** full code/edits in every step.
- **Type consistency:** `renderBlockedSection({date, reason, needs[]})` → string; `parseBlockedResponse(body)` → `{hasSection, hasResponse, response}` used identically in harness + the command's `node -e`; `selectCard` now returns `{action:'work', card, skipped, broadHint, reason}` — `broadHint` consumed by the command's Phase C and asserted in SC-6/SCH-4; the queue path (`selectFromQueue`, still using `isBroadScope`) is untouched.
