# delivery:status Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `delivery:status` — the read-only glance that renders the board's real state (exception count, no-action summary, active claim, recent releases) by reusing the shipped `delivery-review-triage.js`, and introduce the portability path-resolver seam every later `delivery:` skill will use.

**Architecture:** Deterministic core in two small pure Node helpers — `delivery-paths.js` (env-overridable project paths + coordinator-present detection) and `delivery-status-digest.js` (composes the triage output + active claim + releases into a render-ready digest). Both TDD'd by `platform/test/run-delivery-status.js`, wired into `release:preflight`. Bounded-judgment layer is `.claude/skills/delivery-status/SKILL.md` (variant-aware, renders the digest) + a thin `/delivery-status` command. All operator-only, out of the claude-surface registry.

**Tech Stack:** Node (zero-dep, CommonJS, `'use strict'`), the `scripts/autoloop/*.js` pure-fn-plus-CLI pattern, the `platform/test/run-*.js` `ok(label,cond)` harness pattern, Claude Code SKILL.md + slash-command markdown.

**Design:** `~/notes/sauce/headspace-sauce/spice/projects/meta-board-loop-system-rnd/docs/delivery-skills/Delivery Family Buildout — Complete-the-Loop Subset.md`

**Venue note:** Touches `scripts/autoloop/` + `platform/test/` (release-path). Per the ratified venue rule this belongs to the coordinator loop; Will authorized a direct worktree+PR build for the delivery: family tranche (same override as delivery:review). Confirm at handoff.

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `scripts/autoloop/delivery-paths.js` | Create | Env-overridable project paths (repoRoot/coordinator/fid/statePath) + `coordinatorPresent()`. The portability seam. Exports `deliveryPaths`, `coordinatorPresent`, `DEFAULTS`. |
| `scripts/autoloop/delivery-status-digest.js` | Create | Pure `buildDigest(status, fidText, releases)` (reuses `delivery-review-triage.js`) + `headline(digest)`. CLI prints the digest JSON. |
| `platform/test/run-delivery-status.js` | Create | Zero-dep harness for both helpers. |
| `package.json` | Modify | Add the harness to `release:preflight` before the orphan-harness guard. |
| `.claude/skills/delivery-status/SKILL.md` | Create | Variant-aware read-only glance body. |
| `.claude/commands/delivery-status.md` | Create | Thin slash-command entry. |

---

## Task 1: delivery-paths.js — portability path resolver

**Files:**
- Create: `scripts/autoloop/delivery-paths.js`
- Test: `platform/test/run-delivery-status.js`

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-delivery-status.js`:

```javascript
#!/usr/bin/env node
/**
 * run-delivery-status — preflight harness for delivery:status deterministic
 * helpers (delivery-paths.js + delivery-status-digest.js). Zero-dep.
 */
'use strict';
const path = require('path');
const P = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-paths.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

// DP-1: empty env → defaults.
const d = P.deliveryPaths({});
ok('DP-1 default repoRoot', d.repoRoot === P.DEFAULTS.repoRoot);
ok('DP-1 default coordinator', d.coordinator === P.DEFAULTS.coordinator);
ok('DP-1 default fid', d.fid === P.DEFAULTS.fid);

// DP-2: env overrides win.
const o = P.deliveryPaths({ DELIVERY_REPO_ROOT: '/x', DELIVERY_COORDINATOR: '/c', DELIVERY_FID: '/f', DELIVERY_STATE: '/s' });
ok('DP-2 override repoRoot', o.repoRoot === '/x');
ok('DP-2 override coordinator', o.coordinator === '/c');
ok('DP-2 override fid', o.fid === '/f');

// DP-3: coordinatorPresent uses injected fs, true if either path exists.
const fsYes = { existsSync: (p) => p === '/c' };
const fsNo = { existsSync: () => false };
ok('DP-3 present when coordinator exists', P.coordinatorPresent({ coordinator: '/c', statePath: '/s' }, fsYes) === true);
ok('DP-3 absent when neither exists', P.coordinatorPresent({ coordinator: '/c', statePath: '/s' }, fsNo) === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:', failures.join(', ')); process.exit(1); }
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-delivery-status.js`
Expected: FAIL — `Cannot find module '.../delivery-paths.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/autoloop/delivery-paths.js`:

```javascript
#!/usr/bin/env node
/**
 * delivery-paths — resolve delivery: family project paths. Env overrides let one
 * skill body serve multiple projects; defaults target this Sauce workshop machine.
 * The portability seam for the delivery: family. No side effects.
 *
 * Exports: deliveryPaths, coordinatorPresent, DEFAULTS
 */
'use strict';

const DEFAULTS = {
  repoRoot: '/Users/willfellhoelter/projects/repos/sauce',
  coordinator: '/opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js',
  fid: '/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md',
  statePath: '/Users/willfellhoelter/projects/repos/sauce/.git/sauce-autoloop/state.json',
};

function deliveryPaths(env) {
  env = env || process.env;
  return {
    repoRoot: env.DELIVERY_REPO_ROOT || DEFAULTS.repoRoot,
    coordinator: env.DELIVERY_COORDINATOR || DEFAULTS.coordinator,
    fid: env.DELIVERY_FID || DEFAULTS.fid,
    statePath: env.DELIVERY_STATE || DEFAULTS.statePath,
  };
}

// Full-variant (Sauce) has the coordinator installed OR a local state file.
function coordinatorPresent(paths, fsImpl) {
  const fs = fsImpl || require('fs');
  return fs.existsSync(paths.coordinator) || fs.existsSync(paths.statePath);
}

module.exports = { deliveryPaths, coordinatorPresent, DEFAULTS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node platform/test/run-delivery-status.js`
Expected: `<N> passed, 0 failed` (0 failed is the gate).

- [ ] **Step 5: Commit**

```bash
git add -f scripts/autoloop/delivery-paths.js
git add platform/test/run-delivery-status.js
git commit -m "feat(delivery): portability path resolver + coordinator detection"
```

---

## Task 2: delivery-status-digest.js — buildDigest + headline

**Files:**
- Create: `scripts/autoloop/delivery-status-digest.js`
- Modify: `platform/test/run-delivery-status.js`

- [ ] **Step 1: Write the failing test**

Add to the top of `run-delivery-status.js` (after the `P` require):

```javascript
const D = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'delivery-status-digest.js'));
```

Append before the summary block:

```javascript
// Digest fixture: one active claim, one actionable single-gate, plus no-action buckets.
const STATUS = {
  active: [{ card: 'ES2 Epic dashboard', phase: 'implementing' }],
  tracked: [
    { card: 'ES2 Epic dashboard', phase: 'implementing', status: 'implementing' },
    { card: 'GA-S1a done thing', status: 'completed' },
    { card: 'LH1 launchd authority', status: 'parked', resume_condition: 'do not resume host' },
    { card: 'ES3 gate', status: 'parked', resume_condition: 'Resume only after Will explicitly authorizes the flag' },
  ],
  parked: [
    { card: 'LH1 launchd authority', status: 'parked', resume_condition: 'do not resume host' },
    { card: 'ES3 gate', status: 'parked', resume_condition: 'Resume only after Will explicitly authorizes the flag' },
  ],
  projection_problems: [],
};
const dig = D.buildDigest(STATUS, '', ['v0.251.0', 'v0.250.0']);
ok('DS-1 exceptionCount = actionable length', dig.exceptionCount === 1);
ok('DS-2 noAction frozen/done', dig.noAction.frozen === 1 && dig.noAction.done === 1);
ok('DS-3 activeClaim from status.active[0]', dig.activeClaim && dig.activeClaim.card === 'ES2 Epic dashboard');
ok('DS-4 releases carried', dig.releases[0] === 'v0.251.0');

// DS-5: no active claim → activeClaim null.
const dig2 = D.buildDigest({ active: [], tracked: [], parked: [], projection_problems: [] }, '', []);
ok('DS-5 null activeClaim when none', dig2.activeClaim === null);

// DS-6: headline mentions the exception count and active card.
const h = D.headline(dig);
ok('DS-6 headline exception count', /1 need you/.test(h));
ok('DS-6 headline active card', /active: ES2 Epic dashboard/.test(h));
const h2 = D.headline(dig2);
ok('DS-6 headline zero → walk away', /walk away/.test(h2) && /active: none/.test(h2));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-delivery-status.js`
Expected: FAIL — `Cannot find module '.../delivery-status-digest.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/autoloop/delivery-status-digest.js`:

```javascript
#!/usr/bin/env node
/**
 * delivery-status-digest — compose the read-only board glance for delivery:status.
 * Reuses delivery-review-triage.js; adds the active claim and a releases feed.
 * Pure functions; the CLI is the only I/O.
 *
 * Exports: buildDigest, headline
 * CLI: node scripts/autoloop/delivery-status-digest.js --status <status.json> [--fid <FID.md>] [--releases v1,v2,...]
 */
'use strict';
const fs = require('fs');
const triage = require('./delivery-review-triage.js');

function buildDigest(status, fidText, releases) {
  const t = triage.triage(status, fidText);
  const active = (status.active && status.active[0]) || null;
  return {
    exceptionCount: t.actionable.length,
    noAction: t.noAction,
    activeClaim: active ? { card: active.card, phase: active.phase } : null,
    actionable: t.actionable,
    releases: releases || [],
  };
}

function headline(d) {
  const na = d.noAction;
  const active = d.activeClaim ? d.activeClaim.card : 'none';
  const excl = d.exceptionCount === 0
    ? '0 need you — walk away'
    : `${d.exceptionCount} need you`;
  return `${excl} · ${na.frozen} frozen / ${na.superseded} superseded / ${na.done} done · active: ${active}`;
}

module.exports = { buildDigest, headline };

if (require.main === module) {
  const args = process.argv.slice(2);
  const statusPath = args[args.indexOf('--status') + 1];
  const fidIdx = args.indexOf('--fid');
  const fidText = fidIdx >= 0 ? fs.readFileSync(args[fidIdx + 1], 'utf8') : '';
  const relIdx = args.indexOf('--releases');
  const releases = relIdx >= 0 ? String(args[relIdx + 1] || '').split(',').filter(Boolean) : [];
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const d = buildDigest(status, fidText, releases);
  console.log(JSON.stringify({ ...d, headline: headline(d) }, null, 2));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node platform/test/run-delivery-status.js`
Expected: `<N> passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add -f scripts/autoloop/delivery-status-digest.js
git add platform/test/run-delivery-status.js
git commit -m "feat(delivery): status digest (exception count, no-action, active, releases)"
```

---

## Task 3: Wire the harness into preflight

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm the orphan guard flags it**

Run: `node scripts/check-orphan-harnesses.js`
Expected: it reports `run-delivery-status.js` as unregistered (via stdout).

- [ ] **Step 2: Add to the preflight chain**

In `package.json`, in `release:preflight`, insert ` && node platform/test/run-delivery-status.js` immediately BEFORE ` && node platform/test/run-orphan-harnesses.js && node scripts/check-orphan-harnesses.js`.

- [ ] **Step 3: Confirm the guard passes**

Run: `node scripts/check-orphan-harnesses.js && node platform/test/run-orphan-harnesses.js`
Expected: PASS — no orphan reported.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "test(delivery-status): register harness in release preflight"
```

---

## Task 4: SKILL.md — the read-only glance (variant-aware)

**Files:**
- Create: `.claude/skills/delivery-status/SKILL.md`

- [ ] **Step 1: Write the skill body**

Create `.claude/skills/delivery-status/SKILL.md`:

```markdown
---
name: delivery-status
description: Read-only glance at the Sauce Delivery board. Use when asking "how's the board", "what's the status", "how many things need me", "is the loop working", or for a phone-sized digest of exceptions/progress. Shows the exception count, the no-action summary (frozen/superseded/done), the active claim, and recent releases. Never writes anything.
---

# delivery:status

The read-only glance. Answers "is it working, and does it need me?" in one screen. Pairs with `delivery:review` (which decides the exceptions this surfaces). **Writes nothing.** Full design: `~/notes/sauce/headspace-sauce/spice/projects/meta-board-loop-system-rnd/docs/delivery-skills/Delivery Family Buildout — Complete-the-Loop Subset.md`.

## Steps

1. Resolve paths: `node -e "console.log(JSON.stringify(require('./scripts/autoloop/delivery-paths.js').deliveryPaths()))"` (from the repo root). Env vars DELIVERY_REPO_ROOT / DELIVERY_COORDINATOR / DELIVERY_FID / DELIVERY_STATE override the defaults.
2. Variant check: `require('./scripts/autoloop/delivery-paths.js').coordinatorPresent(paths)`.
   - **Coordinator present (Sauce)** → continue.
   - **Coordinator absent (lightweight repo)** → say "lightweight board status not yet implemented (v1 is full-variant only)" and stop. Do NOT fabricate a digest.
3. Capture the coordinator status: run `<coordinator> status --json` (the resolved coordinator path) into a temp file.
4. Gather recent releases: `git tag --sort=-creatordate | grep '^v' | head -5` (comma-join).
5. Build the digest: `node scripts/autoloop/delivery-status-digest.js --status <tmp> --fid "<fid>" --releases <v1,v2,...>`.
6. Render phone-sized, read-only, in this order:
   - **Headline** (the digest's `headline`): "N need you · X frozen / Y superseded / Z done · active: <card>".
   - **Needs you** — if exceptionCount > 0, list the actionable cards (bucket + card); else "Nothing needs you — walk away."
   - **Active** — the active claim line (card + phase), or "idle".
   - **Recent releases** — the releases list.
   - One-liner pointer: "Run /delivery-review to work the blockers."
7. Never write, never ratify, never touch a card/board/FID. This skill only reads.
```

- [ ] **Step 2: Structure check**

Run: `grep -c -E 'delivery-status-digest.js|delivery-paths.js' .claude/skills/delivery-status/SKILL.md`
Expected: `>= 2` (delegates data to the helpers).

Run: `grep -c 'Never write' .claude/skills/delivery-status/SKILL.md`
Expected: `>= 1` (read-only contract stated).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/delivery-status/SKILL.md
git commit -m "feat(delivery-status): read-only glance skill body"
```

---

## Task 5: The thin slash-command entry

**Files:**
- Create: `.claude/commands/delivery-status.md`

- [ ] **Step 1: Write the command file**

Create `.claude/commands/delivery-status.md`:

```markdown
---
description: delivery:status — read-only glance at the Sauce Delivery board (exceptions, no-action summary, active claim, recent releases)
allowed-tools: Read, Bash, Glob, Grep, Skill
---

# /delivery-status

Invoke the `delivery-status` skill: a phone-sized, read-only digest of the Sauce Delivery board — how many things need you, what's frozen/superseded/done, the active claim, and recent releases. Writes nothing.

Run the `delivery-status` skill now and follow it exactly.
```

- [ ] **Step 2: Confirm operator-only (out of registry) + audits pass**

Run: `grep -c 'delivery-status' ranch/claude-surface-registry.json`
Expected: `0`.

Run: `node platform/test/run-claude-surface.js && node platform/test/run-audit.js`
Expected: PASS both.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/delivery-status.md
git commit -m "feat(delivery-status): thin slash-command entry"
```

---

## Task 6: End-to-end verification against the live board

**Files:** none (verification only)

- [ ] **Step 1: Run the real digest**

```bash
cd /Users/willfellhoelter/projects/repos/sauce
/opt/homebrew/opt/node/bin/node /opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js status --json > /tmp/ds-status.json 2>/dev/null
REL=$(git tag --sort=-creatordate | grep '^v' | head -5 | paste -sd, -)
node scripts/autoloop/delivery-status-digest.js --status /tmp/ds-status.json \
  --fid "/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md" \
  --releases "$REL"
```

- [ ] **Step 2: Confirm the digest matches reality**

Expected: `exceptionCount` equals the number of actionable blockers `delivery:review` would show (cross-check by eye against the current board — ES2/GA-C6d/exhausted lineages), `noAction` shows the frozen/superseded/done counts, `activeClaim` matches the coordinator's active list (or null when idle), `releases` lists the latest `v*` tags, and `headline` reads sensibly. No file was written (`git status` clean).

- [ ] **Step 3: Full harness once more**

Run: `node platform/test/run-delivery-status.js`
Expected: `<N> passed, 0 failed`.

- [ ] **Step 4: Final commit (if any doc tweak emerged)**

```bash
git add -A && git commit -m "test(delivery-status): live-board verification" --allow-empty
```

---

## Self-Review

**Spec coverage (vs the Buildout design §delivery:status + §cross-cutting):**
- Exception count / no-action summary / active claim / releases → Task 2 `buildDigest` + `headline`. ✓
- Reuses `delivery-review-triage.js` (no rebuild) → Task 2 requires it. ✓
- Variant detection + portability config seam → Task 1 `delivery-paths.js` + Task 4 variant branch. ✓
- Read-only (never writes) → Task 4 SKILL.md contract + Task 6 clean-tree check. ✓
- Operator-only, out of registry → Tasks 4/5 + registry assertion. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; run steps show exact commands. Assertion totals are checked via the harness's printed `0 failed` gate rather than a hardcoded count (avoids miscounting). ✓

**Type consistency:** `buildDigest(status, fidText, releases)` → `{exceptionCount, noAction, activeClaim, actionable, releases}` used identically in Task 2 tests, the CLI, Task 4 SKILL.md, and Task 6. `deliveryPaths(env)` → `{repoRoot, coordinator, fid, statePath}` and `coordinatorPresent(paths, fsImpl)` match across Task 1, Task 4, and the CLI. ✓
