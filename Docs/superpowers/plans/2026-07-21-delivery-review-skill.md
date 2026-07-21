# delivery:review Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `delivery:review` — the operator skill that triages the board's blockers, walks the Director through deciding each, and emits ratifiable Final Initial Design amendments (never touching a card), packaging by hand the blocker-clearing workflow.

**Architecture:** Split by the ratified law "deterministic software controls side effects; models perform bounded judgment." The **deterministic half** is two pure Node helpers in `scripts/autoloop/` (a ledger triage classifier and a ratification-flip mutator), each TDD'd by a zero-dep `platform/test/run-delivery-review.js` harness wired into `release:preflight`. The **bounded-judgment half** is `.claude/skills/delivery-review/SKILL.md` (the interactive brainstorm + amendment authoring prose) plus a thin `.claude/commands/delivery-review.md` entry. All four are plain git-tracked repo files; the two `.claude/` files stay OUT of the claude-surface registry so they never install into consumer vaults (precedent: `sauce-autoloop.md`).

**Tech Stack:** Node (zero-dep, CommonJS, `'use strict'`), the repo's `scripts/autoloop/*.js` pure-function-plus-CLI pattern, the `platform/test/run-*.js` `ok(label,cond)` harness pattern, Claude Code SKILL.md + slash-command markdown.

**Spec:** `~/notes/sauce/headspace-sauce/spice/projects/meta-board-loop-system-rnd/docs/delivery-skills/delivery-review Skill Specification.md`

**Venue note (read before executing):** This plan touches `scripts/autoloop/` and `platform/test/` — release-path workshop code. The ratified venue rule (`platform/mechanisms/platform-claude/skills/slice-plan/SKILL.md`) says release-path workshop work belongs to the coordinator loop, not inline execution. Resolve the venue at handoff (bottom of this plan) before writing code.

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `scripts/autoloop/delivery-review-triage.js` | Create | Pure classifier: `status --json` object + FID text → ranked actionable queue + no-action summary. Exports `isHostLineage`, `stemOf`, `hasDeployedSupersedingSibling`, `classifyCard`, `triage`, `parseProvisionalPending`. CLI prints JSON. |
| `scripts/autoloop/delivery-review-ratify.js` | Create | Pure FID mutators: `appendAmendment(fidText, block)` and `flipRatification(fidText, headingTitle, date)`. Exports both. CLI applies a flip to a file. |
| `platform/test/run-delivery-review.js` | Create | Zero-dep harness driving both helpers with fixtures. |
| `package.json` | Modify | Add `node platform/test/run-delivery-review.js` to the `release:preflight` chain (before `run-orphan-harnesses.js`). |
| `.claude/skills/delivery-review/SKILL.md` | Create | The interactive brainstorm + amendment-authoring skill body. |
| `.claude/commands/delivery-review.md` | Create | Thin slash-command entry that invokes the skill. |

---

## Task 1: Triage helper skeleton + host-lineage guard

**Files:**
- Create: `scripts/autoloop/delivery-review-triage.js`
- Test: `platform/test/run-delivery-review.js`

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-delivery-review.js`:

```javascript
#!/usr/bin/env node
/**
 * run-delivery-review — preflight harness for delivery:review deterministic
 * helpers (scripts/autoloop/delivery-review-triage.js + delivery-review-ratify.js).
 * Zero-dep.
 */
'use strict';
const path = require('path');
const T = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-review-triage.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

// DR-HOST-1: the ratified NEVER-list ids are host lineage.
for (const id of ['LH1', 'LH3b', 'A5 durable host, readiness', 'GA-OPS10a Consume', 'GA-OPS10b x', 'GA-OPS4b Transactional']) {
  ok(`DR-HOST-1 host lineage: ${id}`, T.isHostLineage(id) === true);
}
// DR-HOST-2: product/ops cards are NOT host lineage.
for (const id of ['GA-C1a Core design', 'ES2 Epic dashboard', 'GA-OPS11a Fresh-vault', 'GA-H1a Regenerate']) {
  ok(`DR-HOST-2 not host: ${id}`, T.isHostLineage(id) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-delivery-review.js`
Expected: FAIL — `Cannot find module '.../delivery-review-triage.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/autoloop/delivery-review-triage.js`:

```javascript
#!/usr/bin/env node
/**
 * delivery-review-triage — deterministic blocker classifier for delivery:review.
 * Pure functions over `codex-coordinator.js status --json` output + FID text.
 * No model, no side effects.
 *
 * Exports: isHostLineage, stemOf, hasDeployedSupersedingSibling, classifyCard,
 *          triage, parseProvisionalPending
 * CLI: node scripts/autoloop/delivery-review-triage.js --status <status.json> [--fid <FID.md>]
 */
'use strict';
const fs = require('fs');

// The ratified durable-host NEVER-list (FID § durable-host suspension) plus the
// direct-approval-gated cards. Matched against the card id/name prefix.
const HOST_LINEAGE = [
  /^LH\d/i,                       // LH1, LH2, LH3, LH3b, LH4
  /^A5\b/i,                       // original A5 durable host
  /^GA-OPS10[ab]\b/i,             // GA-OPS10a / GA-OPS10b
  /^GA-OPS4b\b/i,                 // transactional intake amendments
  /\bLoop host parent\b/i,
  /\bdurable host\b/i,
  /\blaunchd\b/i,
  /\beffect-authority engine\b/i,
];

function isHostLineage(cardName) {
  const s = String(cardName || '');
  return HOST_LINEAGE.some((re) => re.test(s));
}

module.exports = { isHostLineage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-delivery-review.js`
Expected: PASS — `10 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/delivery-review-triage.js platform/test/run-delivery-review.js
git commit -m "feat(delivery-review): triage skeleton + host-lineage guard"
```

---

## Task 2: Superseded-corpse detection (stem + deployed sibling)

**Files:**
- Modify: `scripts/autoloop/delivery-review-triage.js`
- Test: `platform/test/run-delivery-review.js`

- [ ] **Step 1: Write the failing test**

Append to `run-delivery-review.js` before the summary block:

```javascript
// DR-STEM-1: stemOf strips the trailing supersession suffix from the id token.
ok('DR-STEM-1 GA-C1a', T.stemOf('GA-C1a Core design tokens') === 'GA-C1');
ok('DR-STEM-1 GA-C9a2', T.stemOf('GA-C9a2 Icons (supersedes GA-C9a)') === 'GA-C9');
ok('DR-STEM-1 GA-OPS11a', T.stemOf('GA-OPS11a Fresh-vault bootstrap') === 'GA-OPS11');

// DR-CORPSE-1: a parked card whose deployed sibling supersedes it → corpse.
const tracked = [
  { card: 'GA-C1a Core design tokens', status: 'parked' },
  { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
  { card: 'GA-C2a ChromeBar adoption', status: 'parked' },
  { card: 'GA-C2b ChromeBar adoption (supersedes GA-C2a)', status: 'parked' },
];
ok('DR-CORPSE-1 C1a is a corpse (C1c deployed)',
  T.hasDeployedSupersedingSibling({ card: 'GA-C1a Core design tokens' }, tracked) === true);
ok('DR-CORPSE-2 C2a NOT a corpse (C2b also parked)',
  T.hasDeployedSupersedingSibling({ card: 'GA-C2a ChromeBar adoption' }, tracked) === false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-delivery-review.js`
Expected: FAIL — `T.stemOf is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `delivery-review-triage.js`, add before `module.exports`:

```javascript
// The first whitespace-delimited token is the card id (e.g. "GA-C9a2").
function idToken(cardName) {
  return String(cardName || '').trim().split(/\s+/)[0] || '';
}

// Strip a trailing supersession suffix: a lowercase letter + optional digits
// ("a", "b", "a2", "c"). "GA-C9a2" → "GA-C9"; "GA-OPS11a" → "GA-OPS11".
function stemOf(cardName) {
  const id = idToken(cardName);
  const m = id.match(/^(.*?)([a-z]\d*)$/);
  return m ? m[1] : id;
}

function isDeployed(status) {
  return status === 'deployed' || status === 'completed';
}

// A parked card X is a superseded corpse when some OTHER tracked card Y is
// deployed AND shares X's stem AND its name marks it as the successor
// ("supersedes" or "final value-review completion").
function hasDeployedSupersedingSibling(card, tracked) {
  const stem = stemOf(card.card);
  if (!stem) return false;
  const selfId = idToken(card.card);
  return (tracked || []).some((y) => {
    if (idToken(y.card) === selfId) return false;
    if (!isDeployed(y.status)) return false;
    if (stemOf(y.card) !== stem) return false;
    return /supersedes|final value-review completion/i.test(y.card);
  });
}

module.exports = { isHostLineage, stemOf, hasDeployedSupersedingSibling };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-delivery-review.js`
Expected: PASS — `15 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/delivery-review-triage.js platform/test/run-delivery-review.js
git commit -m "feat(delivery-review): superseded-corpse detection"
```

---

## Task 3: Full bucket classifier

**Files:**
- Modify: `scripts/autoloop/delivery-review-triage.js`
- Test: `platform/test/run-delivery-review.js`

- [ ] **Step 1: Write the failing test**

Append to `run-delivery-review.js` before the summary block:

```javascript
// DR-CLASS-1: each card lands in its bucket. ctx carries the tracked list +
// active id set (built by triage(); here passed directly).
const ctx = {
  activeIds: new Set(['ES1 Delivery epic-slice contract']),
  tracked: [
    { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
  ],
};
function cls(card) { return T.classifyCard(card, ctx); }

ok('DR-CLASS active', cls({ card: 'ES1 Delivery epic-slice contract', status: 'in_progress' }) === 'active');
ok('DR-CLASS host', cls({ card: 'LH1 launchd job authority', status: 'parked' }) === 'suspended-evidence');
ok('DR-CLASS direct-approval',
  cls({ card: 'GA-OPS4b Transactional', status: 'parked',
        resume_condition: 'Do not resume ... unless Will explicitly approves ...' }) === 'suspended-evidence');
ok('DR-CLASS corpse',
  cls({ card: 'GA-C1a Core design tokens', status: 'parked',
        resume_condition: 'Do not resume exhausted GA-C1a.' }) === 'superseded-corpse');
ok('DR-CLASS exhausted',
  cls({ card: 'GA-C2b ChromeBar (supersedes GA-C2a)', status: 'parked',
        resume_condition: 'unless Will completes the mandatory human value review after the lineage sole superseding child exhausted its post-repair correctness quorum' }) === 'exhausted-lineage');
ok('DR-CLASS single-gate',
  cls({ card: 'ES2 Epic dashboard', status: 'parked',
        resume_condition: 'Resume only after Will explicitly authorizes adding package.json to ES2 touch zones' }) === 'single-gate-block');
ok('DR-CLASS deadend blocked',
  cls({ card: 'GA-OPS11a2 Fresh-vault bootstrap', status: 'blocked',
        resume_condition: '' }) === 'coordinator-deadend');

// DR-CLASS done: a completed, non-corpse card is finished work, not actionable.
ok('DR-CLASS done', cls({ card: 'GA-S1a Wire and guard orphan harnesses', status: 'completed' }) === 'done');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-delivery-review.js`
Expected: FAIL — `T.classifyCard is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `delivery-review-triage.js`, add before `module.exports`:

```javascript
// resume_condition names Will's direct approval by name — never actionable.
function isDirectApproval(resume) {
  return /Will\b[^.]*\bexplicit(ly)?\b[^.]*\bapprov/i.test(String(resume || ''));
}

// Order matters: safety buckets (active, host, direct-approval, corpse) win
// before any "actionable" classification, so a NEVER-list card can never be
// surfaced as work.
function classifyCard(card, ctx) {
  const name = card.card;
  if (ctx.activeIds && ctx.activeIds.has(name)) return 'active';
  if (card.status === 'in_progress' || card.status === 'implementing' ||
      card.status === 'claimed' || card.status === 'feature_pr') return 'active';
  if (isDeployed(card.status)) return 'done';
  if (isHostLineage(name)) return 'suspended-evidence';
  if (isDirectApproval(card.resume_condition)) return 'suspended-evidence';
  if (hasDeployedSupersedingSibling(card, ctx.tracked)) return 'superseded-corpse';
  if (card.status === 'blocked') return 'coordinator-deadend';
  const resume = String(card.resume_condition || '');
  if (/\bvalue review\b/i.test(resume) && /\bexhaust/i.test(resume)) return 'exhausted-lineage';
  if (/Resume only after Will\b.*\bauthori/i.test(resume)) return 'single-gate-block';
  if (/\bvalue review\b/i.test(resume)) return 'exhausted-lineage';
  return 'single-gate-block';
}

module.exports = { isHostLineage, stemOf, hasDeployedSupersedingSibling, classifyCard };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-delivery-review.js`
Expected: PASS — `23 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/delivery-review-triage.js platform/test/run-delivery-review.js
git commit -m "feat(delivery-review): full bucket classifier with safety ordering"
```

---

## Task 4: `triage()` aggregate + ranking + no-action summary + provisional scan + CLI

**Files:**
- Modify: `scripts/autoloop/delivery-review-triage.js`
- Test: `platform/test/run-delivery-review.js`

- [ ] **Step 1: Write the failing test**

Append to `run-delivery-review.js` before the summary block:

```javascript
// DR-TRIAGE-1: full status object → actionable queue + no-action summary.
const status = {
  active: [{ card: 'ES1 Delivery epic-slice contract', status: 'in_progress' }],
  tracked: [
    { card: 'ES1 Delivery epic-slice contract', status: 'in_progress' },
    { card: 'LH1 launchd job authority', status: 'parked' },
    { card: 'GA-C1c Core design tokens (final value-review completion)', status: 'completed' },
  ],
  parked: [
    { card: 'LH1 launchd job authority', status: 'parked', resume_condition: 'do not resume host' },
    { card: 'GA-C1a Core design tokens', status: 'parked', resume_condition: 'exhausted GA-C1a' },
    { card: 'ES2 Epic dashboard', status: 'parked',
      resume_condition: 'Resume only after Will explicitly authorizes adding package.json to ES2 touch zones' },
    { card: 'GA-C2b ChromeBar (supersedes GA-C2a)', status: 'parked',
      resume_condition: 'Will completes the mandatory human value review after the lineage exhausted its post-repair quorum' },
  ],
  projection_problems: [],
};
const r = T.triage(status, '');
ok('DR-TRIAGE actionable excludes host+corpse',
  r.actionable.every((a) => a.bucket !== 'suspended-evidence' && a.bucket !== 'superseded-corpse'));
ok('DR-TRIAGE single-gate ranked above exhausted',
  r.actionable.findIndex((a) => a.bucket === 'single-gate-block') <
  r.actionable.findIndex((a) => a.bucket === 'exhausted-lineage'));
ok('DR-TRIAGE noAction counts frozen+superseded',
  r.noAction.frozen === 1 && r.noAction.superseded === 1);

// DR-PROV-1: PROVISIONALLY ACCEPTED headings are surfaced from FID text.
const fid = '## Foo — accepted 2026-07-20\ntext\n## Bar refresh — PROVISIONALLY ACCEPTED 2026-07-20\nmore\n';
ok('DR-PROV-1 finds provisional heading',
  T.parseProvisionalPending(fid).length === 1 && /Bar refresh/.test(T.parseProvisionalPending(fid)[0]));

// DR-DONE-1: triage() counts completed cards in noAction.done and never in actionable.
const doneStatus = {
  active: [],
  tracked: [{ card: 'GA-S1a Wire and guard orphan harnesses', status: 'completed' }],
  parked: [],
  projection_problems: [],
};
const dr = T.triage(doneStatus, '');
ok('DR-DONE-1 completed → noAction.done', dr.noAction.done === 1);
ok('DR-DONE-1 completed not in actionable', dr.actionable.every((a) => a.card !== 'GA-S1a Wire and guard orphan harnesses'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-delivery-review.js`
Expected: FAIL — `T.triage is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `delivery-review-triage.js`, add before `module.exports`:

```javascript
// Rank actionable buckets: ledger-distorting first, then top-priority unblocks,
// then value reviews.
const RANK = {
  'provisional-pending': 0,
  'coordinator-deadend': 1,
  'single-gate-block': 2,
  'exhausted-lineage': 3,
};

function parseProvisionalPending(fidText) {
  return String(fidText || '')
    .split('\n')
    .filter((line) => /^##\s+.*PROVISIONALLY ACCEPTED/i.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

function triage(status, fidText) {
  const activeIds = new Set((status.active || []).map((c) => c.card));
  const tracked = status.tracked || [];
  // Enrich each tracked card with its parked resume_condition (parked[] carries it).
  const parkedByName = new Map((status.parked || []).map((p) => [p.card, p]));
  const ctx = { activeIds, tracked };

  const actionable = [];
  const noAction = { frozen: 0, superseded: 0, done: 0, active: 0 };

  for (const t of tracked) {
    const enriched = { ...(parkedByName.get(t.card) || {}), ...t };
    const bucket = classifyCard(enriched, ctx);
    if (bucket === 'active') { noAction.active++; continue; }
    if (bucket === 'suspended-evidence') { noAction.frozen++; continue; }
    if (bucket === 'superseded-corpse') { noAction.superseded++; continue; }
    if (bucket === 'done') { noAction.done++; continue; }
    actionable.push({ card: t.card, bucket, resume_condition: enriched.resume_condition || '' });
  }

  // Coordinator projection-problem cards are deadends even when their status reads clean.
  for (const p of status.projection_problems || []) {
    if (!actionable.some((a) => a.card === p.card)) {
      actionable.push({ card: p.card, bucket: 'coordinator-deadend', resume_condition: p.error || '' });
    }
  }

  // Provisional-pending amendments (from FID) rank first.
  for (const heading of parseProvisionalPending(fidText)) {
    actionable.push({ card: heading, bucket: 'provisional-pending', resume_condition: '' });
  }

  actionable.sort((a, b) => (RANK[a.bucket] ?? 9) - (RANK[b.bucket] ?? 9));
  return { actionable, noAction };
}

module.exports = { isHostLineage, stemOf, hasDeployedSupersedingSibling, classifyCard, triage, parseProvisionalPending };
```

Then append the CLI at the very bottom of the file (after `module.exports`):

```javascript
if (require.main === module) {
  const args = process.argv.slice(2);
  const statusPath = args[args.indexOf('--status') + 1];
  const fidIdx = args.indexOf('--fid');
  const fidText = fidIdx >= 0 ? fs.readFileSync(args[fidIdx + 1], 'utf8') : '';
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  console.log(JSON.stringify(triage(status, fidText), null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-delivery-review.js`
Expected: PASS — `29 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/delivery-review-triage.js platform/test/run-delivery-review.js
git commit -m "feat(delivery-review): triage aggregate, ranking, provisional scan, CLI"
```

---

## Task 5: Ratification-flip helper (mutates the authority doc deterministically)

**Files:**
- Create: `scripts/autoloop/delivery-review-ratify.js`
- Modify: `platform/test/run-delivery-review.js`

- [ ] **Step 1: Write the failing test**

Add to the top of `run-delivery-review.js` (after the `T` require):

```javascript
const R = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-review-ratify.js'));
```

Append before the summary block:

```javascript
// DR-RATIFY-1: flip PROPOSED heading + warning callout to accepted + success callout.
const proposed = [
  '## ES2 touch-zone authorization — PROPOSED 2026-07-20',
  '',
  "> [!warning] PROPOSED — awaiting Will's ratification",
  '> body',
  '',
  '### Basis',
].join('\n');
const flipped = R.flipRatification(proposed, 'ES2 touch-zone authorization', '2026-07-21');
ok('DR-RATIFY-1 heading flipped',
  /## ES2 touch-zone authorization — accepted 2026-07-21/.test(flipped));
ok('DR-RATIFY-1 callout flipped',
  /> \[!success\] Ratified by Will — 2026-07-21/.test(flipped) && !/PROPOSED/.test(flipped));
// DR-RATIFY-2: an unrelated PROPOSED heading is untouched.
const two = proposed + '\n## Other — PROPOSED 2026-07-20\n';
ok('DR-RATIFY-2 only named heading flips',
  /## Other — PROPOSED 2026-07-20/.test(R.flipRatification(two, 'ES2 touch-zone authorization', '2026-07-21')));
// DR-RATIFY-3: appendAmendment adds a trailing block with one blank-line separator.
ok('DR-RATIFY-3 append',
  R.appendAmendment('# FID\nbody', '## New — PROPOSED 2026-07-21\nx').endsWith('\n\n## New — PROPOSED 2026-07-21\nx'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-delivery-review.js`
Expected: FAIL — `Cannot find module '.../delivery-review-ratify.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/autoloop/delivery-review-ratify.js`:

```javascript
#!/usr/bin/env node
/**
 * delivery-review-ratify — deterministic mutators for the Final Initial Design
 * authority doc. Pure string transforms; the CLI is the only writer.
 *
 * Exports: appendAmendment, flipRatification
 * CLI: node scripts/autoloop/delivery-review-ratify.js flip --fid <p> --heading "<title>" --date <YYYY-MM-DD>
 */
'use strict';
const fs = require('fs');

function appendAmendment(fidText, block) {
  return `${String(fidText).replace(/\s*$/, '')}\n\n${block}`;
}

// Flip exactly the one PROPOSED section whose heading title matches. The heading
// line is `## <title> — PROPOSED <date>`; the callout directly under it is
// `> [!warning] PROPOSED — awaiting Will's ratification`.
function flipRatification(fidText, headingTitle, date) {
  const lines = String(fidText).split('\n');
  const esc = headingTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^##\\s+${esc}\\s+—\\s+PROPOSED\\b.*$`);
  let i = lines.findIndex((l) => headingRe.test(l));
  if (i < 0) return fidText; // not found → no-op, never guess
  lines[i] = `## ${headingTitle} — accepted ${date}`;
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    if (/^>\s*\[!warning\]\s*PROPOSED/i.test(lines[j])) {
      lines[j] = `> [!success] Ratified by Will — ${date}`;
      break;
    }
  }
  return lines.join('\n');
}

module.exports = { appendAmendment, flipRatification };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'flip') {
    const fidPath = args[args.indexOf('--fid') + 1];
    const heading = args[args.indexOf('--heading') + 1];
    const date = args[args.indexOf('--date') + 1];
    const out = flipRatification(fs.readFileSync(fidPath, 'utf8'), heading, date);
    fs.writeFileSync(fidPath, out);
    console.log(JSON.stringify({ flipped: heading, date }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-delivery-review.js`
Expected: PASS — `33 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/delivery-review-ratify.js platform/test/run-delivery-review.js
git commit -m "feat(delivery-review): deterministic ratification-flip + append helpers"
```

---

## Task 6: Wire the harness into preflight (orphan-harness guard)

**Files:**
- Modify: `package.json` (the `release:preflight` script)

- [ ] **Step 1: Confirm the orphan guard currently fails without wiring**

Run: `node scripts/check-orphan-harnesses.js`
Expected: FAIL (or a report) listing `platform/test/run-delivery-review.js` as an unregistered orphan harness. (This is the guard that forces every harness into preflight.)

- [ ] **Step 2: Add the harness to the preflight chain**

In `package.json`, in the `release:preflight` value, insert ` && node platform/test/run-delivery-review.js` immediately BEFORE ` && node platform/test/run-orphan-harnesses.js && node scripts/check-orphan-harnesses.js`.

- [ ] **Step 3: Verify the orphan guard now passes**

Run: `node scripts/check-orphan-harnesses.js && node platform/test/run-orphan-harnesses.js`
Expected: PASS — no orphan reported.

- [ ] **Step 4: Run the new harness through npm to confirm wiring resolves**

Run: `node platform/test/run-delivery-review.js`
Expected: PASS — `33 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "test(delivery-review): register harness in release preflight"
```

---

## Task 7: The SKILL.md body (bounded-judgment orchestration)

**Files:**
- Create: `.claude/skills/delivery-review/SKILL.md`

This file is instructions, not code — its "test" is a structure checklist (Step 2). Write it to invoke the Task 1–5 helpers for all determinism and to own only the interactive brainstorm + authoring.

- [ ] **Step 1: Write the skill body**

Create `.claude/skills/delivery-review/SKILL.md`:

```markdown
---
name: delivery-review
description: The Director's exception-and-decide surface for the Sauce Delivery loop. Use when the board's "In Progress" is piling up, when asking "why is nothing moving on the board", "what's blocking the loop", "triage the parked cards", or when you want to work blockers to ratified fixes. Discovers what's actually blocking (vs frozen evidence), brainstorms each with you, and drafts ratifiable Final Initial Design amendments — never writes cards.
---

# delivery:review

The full-variant Sauce Delivery exception queue. Discover blockers, decide each with the Director, emit the ratifiable artifact the loop consumes. **Never writes cards, the board, or coordinator state** — the FID and loop-project docs are the only write targets. Full spec: `~/notes/sauce/headspace-sauce/spice/projects/meta-board-loop-system-rnd/docs/delivery-skills/delivery-review Skill Specification.md`.

## Paths

- Repo root: `/Users/willfellhoelter/projects/repos/sauce`
- Coordinator status: `/opt/homebrew/opt/node/bin/node /opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js status --json` (from repo root)
- FID (authority + write target): `/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md`
- Triage helper: `node scripts/autoloop/delivery-review-triage.js --status <status.json> --fid "<FID path>"`
- Ratify helper: `node scripts/autoloop/delivery-review-ratify.js flip --fid "<FID path>" --heading "<title>" --date <YYYY-MM-DD>`

## Phase 1 — Discover & triage (deterministic)

1. Run the coordinator status, save its JSON to a temp file.
2. Run the triage helper against that JSON + the FID. It returns `{ actionable: [{card, bucket, resume_condition}], noAction: {frozen, superseded, active} }`.
3. Present the no-action summary first, verbatim in spirit: "N cards show as In Progress; only the coordinator's active list is real work. X are frozen host evidence, Y are finished-and-superseded — neither needs you." This is mandatory; it is the antidote to the board-lies effect.
4. Present the ranked actionable queue.

## Phase 2 — Brainstorm each blocker (bounded judgment, one at a time)

For each actionable item in rank order:
1. Read its exact `resume_condition` and the newest session log under `spice/projects/sauce/docs/workflow-loops/*-run-loose-session.md` for named findings.
2. Check the terminal boundary: if the resume condition says the lineage is "permanently closed" / "no further supersession", offer only re-scope or shelve — never "attempt N+1".
3. Two-strike check: if this initiative already ended two consecutive sessions at a Will-gate with no deploy, flag it as an auto-suspend candidate instead of drafting a third gate.
4. Ask ONE `AskUserQuestion`: decision (fix/authorize · re-scope · shelve · defer), recommendation first, with the named findings and value-vs-cost in the option descriptions.
5. Capture the answer. Move to the next blocker.

## Phase 3 — Author the ratifiable artifact

Per decision, using the exact FID amendment format (`## <title> — PROPOSED <date>` + `> [!warning] PROPOSED — awaiting Will's ratification` + **Basis / Authorized work / Not authorized**):
- authorize → append a PROPOSED amendment (touch-zone add / final attempt with findings as binding named fixtures / machinery fix).
- heavy multi-lineage → write a value-review brief doc in `spice/projects/sauce/docs/workflow-loops/`.
- shelve → a short PROPOSED amendment moving the cards to Post-GA.
Append amendments by reading the FID, using the ratify helper's `appendAmendment` shape (one blank-line separator), and writing back. Never edit a card, the board, or coordinator state.

## Phase 4 — Ratify on the Director's word

Only when the Director says "ratify" for a named amendment, run the ratify helper to flip it. Never self-ratify.

## Phase 5 — Handoff

Phone-sized: now-accepted (+ card each unblocks), still-PROPOSED (+ one-line ratify prompt), shelved, next coordinator effect, and the "paste run-loose next" pointer. Link any brief written.

## NEVER

Write cards/board/coordinator state · surface host lineage (LH*, A5, GA-OPS10a/b, GA-OPS4b) as actionable · self-ratify · touch a card whose resume condition names Will's direct approval · offer "attempt N+1" past a terminal boundary · draft a third consecutive Will-gate for one initiative.
```

- [ ] **Step 2: Structure check (the file's verification)**

Run: `grep -c -E '^## Phase [1-5]' .claude/skills/delivery-review/SKILL.md`
Expected: `5` (all five phases present).

Run: `grep -c -E 'delivery-review-triage.js|delivery-review-ratify.js' .claude/skills/delivery-review/SKILL.md`
Expected: `>= 2` (the skill delegates determinism to both helpers, not to prose).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/delivery-review/SKILL.md
git commit -m "feat(delivery-review): interactive brainstorm + authoring skill body"
```

---

## Task 8: The thin slash-command entry

**Files:**
- Create: `.claude/commands/delivery-review.md`

- [ ] **Step 1: Write the command file**

Create `.claude/commands/delivery-review.md`:

```markdown
---
description: delivery:review — triage the board's blockers, brainstorm each, draft ratifiable FID amendments (never writes cards)
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, AskUserQuestion
---

# /delivery-review

Invoke the `delivery-review` skill: discover what is actually blocking the Sauce Delivery board (vs frozen evidence), brainstorm each blocker with the Director one at a time, and emit ratifiable Final Initial Design amendments the loop consumes. Never writes cards, the board, or coordinator state.

Run the `delivery-review` skill now and follow it exactly.
```

- [ ] **Step 2: Confirm both `.claude/` files stay out of the claude-surface registry (operator-only)**

Run: `grep -c 'delivery-review' ranch/claude-surface-registry.json`
Expected: `0` (like `sauce-autoloop.md` — plain operator files, never distributed to consumer vaults).

- [ ] **Step 3: Confirm the surface audit still passes (unregistered `.claude/` files are not drift)**

Run: `node platform/test/run-claude-surface.js && node platform/test/run-audit.js`
Expected: PASS both (the audit reconciles only registered contributions; the two new operator files are ignored).

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/delivery-review.md
git commit -m "feat(delivery-review): thin slash-command entry"
```

---

## Task 9: End-to-end verification against the live board

**Files:** none (verification only)

- [ ] **Step 1: Run the real triage against the live ledger**

```bash
cd /Users/willfellhoelter/projects/repos/sauce
/opt/homebrew/opt/node/bin/node /opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js status --json > /tmp/dr-status.json
node scripts/autoloop/delivery-review-triage.js --status /tmp/dr-status.json \
  --fid "/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md"
```

- [ ] **Step 2: Confirm the output matches the known-good breakdown**

Expected (as of the 2026-07-20 board state, adjust to current): `noAction.frozen` counts the host lineage (≈7), `noAction.superseded` counts the deployed-sibling corpses (≈8), and `actionable` contains the exhausted lineages + single-gate blocks + any deadends — and contains ZERO host-lineage cards. Eyeball that no `LH*`/`A5`/`GA-OPS10`/`GA-OPS4b` id appears in `actionable`. If any does, the safety ordering in Task 3 regressed — fix before proceeding.

- [ ] **Step 3: Run the full new harness once more**

Run: `node platform/test/run-delivery-review.js`
Expected: PASS — `33 passed, 0 failed`.

- [ ] **Step 4: Dry-run the skill end-to-end (no writes)**

Invoke `/delivery-review`, walk one blocker, and confirm: the no-action summary renders, one `AskUserQuestion` appears per blocker, and a PROPOSED amendment is drafted — but do NOT say "ratify" and confirm nothing is flipped and no card/board file changed (`git -C ~/notes/... status` on the vault, or check the FID diff shows only a PROPOSED append).

- [ ] **Step 5: Final commit (if any doc tweaks emerged)**

```bash
git add -A && git commit -m "test(delivery-review): live-board verification pass" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Triage taxonomy (spec §Phase 1) → Tasks 1–4 (`isHostLineage`, corpse, `classifyCard`, `triage`). ✓
- Interactive brainstorm (spec §Phase 2) → SKILL.md Phase 2 (Task 7). ✓
- Author artifact (spec §Phase 3) → SKILL.md Phase 3 + `appendAmendment` (Tasks 5, 7). ✓
- Ratify on word (spec §Phase 4) → `flipRatification` + SKILL.md Phase 4 (Tasks 5, 7). ✓
- Handoff (spec §Phase 5) → SKILL.md Phase 5 (Task 7). ✓
- Safety NEVER-list (spec §Safety) → Task 3 ordering + SKILL.md NEVER + Task 9 Step 2 assertion. ✓
- Packaging: repo `.claude/`, not registry (spec §Packaging) → Tasks 7, 8 + registry assertion. ✓
- Open Q1 (corpse detection fidelity) → Task 2 dual detection + Task 9 live check. ✓
- Open Q3 (provisional marker stability) → Task 4 `parseProvisionalPending` + DR-PROV-1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command + expected output. ✓

**Type consistency:** `triage(status, fidText)` returns `{actionable:[{card,bucket,resume_condition}], noAction:{frozen,superseded,active}}` — used identically in Task 4 tests, the CLI, Task 7 SKILL.md, and Task 9. `flipRatification(fidText, headingTitle, date)` and `appendAmendment(fidText, block)` signatures match across Task 5, the CLI, and Task 7. ✓
