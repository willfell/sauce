# Sauce Autoloop — Increment 3 Implementation Plan (Gate B verifier + bug-fix unlock)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gate B — a two-layer verifier (deterministic mutation check + 3-lens adversarial panel) that runs in live Phase C before a PR opens — so the loop can safely ship bug-fixes, not just docs/tests.

**Architecture:** `scripts/autoloop/gate.js` holds the pure decisions (`splitDiff`, `adequacyVerdict`, `gateVerdict`) + a dependency-injected `runAdequacyCheck` (testable without real git) + a CLI that wires real git/node for the mutation check (revert source → test must go RED → restore → GREEN). The command's Phase C runs Layer 1 (adequacy), then Layer 2 (a `Workflow` 3-lens panel), then `gateVerdict`. Design: `2026-06-28-sauce-autoloop-increment-3-design.md`.

**Tech Stack:** Node ≥18 zero-dep CommonJS; `child_process` + `git`/`node` for the CLI; the existing `run-autoloop-select.js` harness (in `release:preflight`).

## Scope
**In:** `gate.js` (pure decisions + DI orchestration + CLI) · command Phase C Gate B integration + 3-lens panel prompt + bug-fix unlock · harness + preflight + arch doc.
**Out (later):** 2c model bug-hunt · features as a category · canary (4) · substrate (5).

Branch `feat/sauce-autoloop-increment-3` (created). Land via CI-gated auto-merge PR.

## File structure
| File | Status | Responsibility |
| --- | --- | --- |
| `scripts/autoloop/gate.js` | Create | `splitDiff`, `adequacyVerdict`, `gateVerdict`, `runAdequacyCheck` (DI) + CLI (`verify-adequacy`). |
| `platform/test/run-autoloop-select.js` | Modify | `SD-*`, `AV-*`, `GV-*`, `RA-*` assertions. |
| `.claude/commands/sauce-autoloop.md` | Modify | Phase C: Gate A → Gate B (L1 then L2 panel) → PR; bug-fix unlock; the 3-lens panel prompt. |

---

## Task 1: `gate.js` — pure decisions + DI orchestration + CLI

**Files:** Create `scripts/autoloop/gate.js`; Test `platform/test/run-autoloop-select.js`.

- [ ] **Step 1: Add failing assertions to the harness**

After the existing requires in `run-autoloop-select.js`, add:
```js
const { splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'gate.js'));
```
Before the final summary block, insert:
```js
// ---- splitDiff (SD-*) ----
const sd = splitDiff(['scripts/autoloop/select-card.js', 'platform/test/run-foo.js', 'Docs/x.md', 'autoloop-queue.md']);
ok('SD-1 test file classified', sd.testFiles.length === 1 && sd.testFiles[0] === 'platform/test/run-foo.js');
ok('SD-2 source file classified', sd.sourceFiles.length === 1 && sd.sourceFiles[0] === 'scripts/autoloop/select-card.js');
ok('SD-3 docs + queue excluded from source', !sd.sourceFiles.some(f => /\.md$/.test(f) || f === 'autoloop-queue.md'));

// ---- adequacyVerdict (AV-*) ----
ok('AV-1 no test → inadequate', adequacyVerdict({ hasTest: false }).adequate === false);
ok('AV-2 passes without source → inadequate', adequacyVerdict({ hasTest: true, redWithoutSource: false, greenWithSource: true }).adequate === false);
ok('AV-3 fails with source → inadequate', adequacyVerdict({ hasTest: true, redWithoutSource: true, greenWithSource: false }).adequate === false);
ok('AV-4 red-without + green-with → adequate', adequacyVerdict({ hasTest: true, redWithoutSource: true, greenWithSource: true }).adequate === true);

// ---- gateVerdict (GV-*) ----
const adq = { adequate: true, reason: 'ok' };
ok('GV-1 inadequate → block regardless of votes', gateVerdict({ adequacy: { adequate: false, reason: 'x' }, votes: [{ refuted: false }, { refuted: false }, { refuted: false }] }).gate === 'block');
ok('GV-2 adequate + 0 refutes → pass', gateVerdict({ adequacy: adq, votes: [{ refuted: false }, { refuted: false }, { refuted: false }] }).gate === 'pass');
ok('GV-3 adequate + 1 refute → pass', gateVerdict({ adequacy: adq, votes: [{ refuted: true }, { refuted: false }, { refuted: false }] }).gate === 'pass');
ok('GV-4 adequate + 2 refutes → block', gateVerdict({ adequacy: adq, votes: [{ refuted: true }, { refuted: true }, { refuted: false }] }).gate === 'block');
ok('GV-5 null verdict counts as refuted', gateVerdict({ adequacy: adq, votes: [null, { refuted: true }, { refuted: false }] }).gate === 'block');

// ---- runAdequacyCheck (RA-*) ----
const order = [];
const mkRun = (passUnderRevert, passUnderRestore) => (t) => order[order.length - 1] === 'revert' ? passUnderRevert : passUnderRestore;
ok('RA-1 doc/test-only → behavioral:false adequate',
  runAdequacyCheck({ paths: ['Docs/x.md', 'platform/test/run-foo.js'], runTest: () => true, mutate: () => {} }).behavioral === false);
ok('RA-2 source but no test → inadequate',
  runAdequacyCheck({ paths: ['scripts/a.js'], runTest: () => true, mutate: () => {} }).adequate === false);
ok('RA-3 red-without + green-with → adequate',
  runAdequacyCheck({ paths: ['scripts/a.js', 'platform/test/run-foo.js'],
    mutate: (action) => order.push(action),
    runTest: () => order[order.length - 1] === 'restore' }).adequate === true);
ok('RA-4 restores on runTest throw (fail-closed)',
  (() => { const seen = []; const r = runAdequacyCheck({ paths: ['scripts/a.js', 'platform/test/run-foo.js'],
    mutate: (a) => seen.push(a), runTest: () => { throw new Error('boom'); } });
    return r.adequate === false && seen.filter(x => x === 'restore').length >= 1; })());
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `Cannot find module '.../gate.js'`.

- [ ] **Step 3: Create `scripts/autoloop/gate.js`**

```js
#!/usr/bin/env node
/**
 * gate.js — Gate B (the autoloop's verifier). Pure decisions + a
 * dependency-injected mutation-check orchestration; the CLI wires real
 * git/node. Runs in live Phase C before a PR opens.
 *
 * Exports: splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck
 * CLI: node scripts/autoloop/gate.js verify-adequacy [--base main] [--json]
 */
'use strict';

// Classify diff paths into the test files (regression harnesses) vs the source
// under test. Docs (.md) and the queue ledger are not behavioral source.
function splitDiff(paths) {
  const testFiles = [];
  const sourceFiles = [];
  for (const raw of paths || []) {
    const f = String(raw).trim();
    if (!f) continue;
    if (/^platform\/test\/run-.*\.js$/.test(f)) { testFiles.push(f); continue; }
    if (/\.md$/.test(f) || f === 'autoloop-queue.md') continue;
    sourceFiles.push(f);
  }
  return { testFiles, sourceFiles };
}

// Layer-1 decision: is the regression test adequate?
function adequacyVerdict(o) {
  const { hasTest, redWithoutSource, greenWithSource } = o || {};
  if (!hasTest) return { adequate: false, reason: 'behavioral change ships no regression test' };
  if (!redWithoutSource) return { adequate: false, reason: 'test PASSES without the source change — it does not exercise the fix' };
  if (!greenWithSource) return { adequate: false, reason: 'test FAILS with the change restored — the change is broken' };
  return { adequate: true, reason: 'test goes red without the change and green with it' };
}

// Final gate decision: adequate (Layer 1) AND < 2 of the panel refute (Layer 2).
// A null/undefined verdict counts as refuted (fail closed).
function gateVerdict(o) {
  const { adequacy, votes = [] } = o || {};
  if (!adequacy || adequacy.adequate !== true) {
    return { gate: 'block', reason: `Gate B L1 (adequacy): ${adequacy ? adequacy.reason : 'no adequacy result'}` };
  }
  const refutes = votes.filter((v) => !v || v.refuted === true).length;
  if (refutes >= 2) return { gate: 'block', reason: `Gate B L2 (panel): ${refutes}/${votes.length} lenses refuted` };
  return { gate: 'pass', reason: `adequate + ${refutes}/${votes.length} refutes` };
}

/**
 * Orchestrate the mutation check with injected effects (testable without git).
 * @param {object} o
 * @param {string[]} o.paths   diff file paths vs base
 * @param {(testPath:string)=>boolean} o.runTest  true if the test passes
 * @param {(action:'revert'|'restore', files:string[])=>void} o.mutate
 */
function runAdequacyCheck(o) {
  const { paths, runTest, mutate } = o || {};
  const { testFiles, sourceFiles } = splitDiff(paths);
  if (!sourceFiles.length) return { behavioral: false, adequate: true, reason: 'no source change (doc/test-only) — Gate B not required' };
  if (!testFiles.length) return { behavioral: true, ...adequacyVerdict({ hasTest: false }) };
  const allPass = () => testFiles.every((t) => runTest(t));
  let mutated = false, red = false, green = false, err = null;
  try {
    mutate('revert', sourceFiles); mutated = true;
    red = !allPass();
    mutate('restore', sourceFiles); mutated = false;
    green = allPass();
  } catch (e) { err = String((e && e.message) || e); }
  finally { if (mutated) { try { mutate('restore', sourceFiles); } catch (_) { /* best effort */ } } }
  if (err) return { behavioral: true, adequate: false, reason: `mutation-check error (fail-closed): ${err}` };
  return { behavioral: true, ...adequacyVerdict({ hasTest: true, redWithoutSource: red, greenWithSource: green }) };
}

module.exports = { splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck };

if (require.main === module) {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = {};
  for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v && !v.startsWith('--')) { args[k] = v; i++; } else args[k] = true; } }
  const sh = (c, a, opts = {}) => execFileSync(c, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  const out = (obj) => { console.log(JSON.stringify(obj, null, 2)); process.exit(0); };

  if (cmd !== 'verify-adequacy') { console.error('usage: gate.js verify-adequacy [--base main] [--json]'); process.exit(2); }
  const base = args.base || 'main';
  let paths = [];
  try { paths = sh('git', ['diff', '--name-only', `${base}...HEAD`]).split('\n').map((s) => s.trim()).filter(Boolean); } catch (_) {}
  const existsInBase = (f) => { try { sh('git', ['cat-file', '-e', `${base}:${f}`]); return true; } catch (_) { return false; } };
  const runTest = (t) => { try { sh('node', [t], { stdio: 'ignore' }); return true; } catch (_) { return false; } };
  const mutate = (action, files) => {
    if (action === 'revert') {
      for (const f of files) { if (existsInBase(f)) sh('git', ['checkout', base, '--', f]); else sh('git', ['rm', '-f', '--quiet', f]); }
    } else { sh('git', ['checkout', 'HEAD', '--', ...files]); }
  };
  out(runAdequacyCheck({ paths, runTest, mutate }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — SD/AV/GV/RA all green.

- [ ] **Step 5: Sanity-run the CLI** (on this branch the diff vs main is docs-only so far)

Run: `node scripts/autoloop/gate.js verify-adequacy --json`
Expected: `{"behavioral": false, "adequate": true, ...}` (only the design+plan `.md` differ from main → no source → Gate B not required). Confirms the CLI runs + classifies.

- [ ] **Step 6: Commit** (force-add past the `/Scripts/` gitignore)

```bash
git add -f scripts/autoloop/gate.js
git add platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): Gate B decisions (splitDiff/adequacyVerdict/gateVerdict) + mutation-check CLI"
```

---

## Task 2: command Phase C — Gate B + bug-fix unlock

**Files:** Modify `.claude/commands/sauce-autoloop.md`.

- [ ] **Step 1: Replace the Phase C `**Live:**` step 3 (the harness rule) and step 4 (Gate A)**

Find Phase C's `**Live:**` block. Replace step 3 and step 4 with:
````markdown
  3. Implement the card with conventional commits. **Bug-fixes are now allowed** (behavioral changes) — but EVERY behavioral change MUST ship a regression test in `platform/test/run-*.js` that fails without the fix. **Features remain out of scope** (don't implement a new feature autonomously). Commit the change (fix + test) before gating.
  4. **Gate A (deterministic suite):** run `npm run release:preflight` AND `node platform/install.js --vault . --auto-approve`. RED → discard the branch, card → Blocked, blocked handoff, **exit**.
  5. **Gate B Layer 1 (mutation check):** `node scripts/autoloop/gate.js verify-adequacy --json`.
     - `behavioral: false` → no source change (doc/test-only): **skip Gate B**, go to step 7 (open PR).
     - `adequate: false` → the regression test doesn't actually cover the change → discard the branch, card → Blocked (reason = the verdict), handoff, **exit**.
     - `adequate: true` → continue to Layer 2.
  6. **Gate B Layer 2 (3-lens adversarial panel):** dispatch a `Workflow` of **three** separate-context verifiers on `git diff main...HEAD`, each a distinct lens, each returning `{refuted: boolean, reason: string}`, each instructed to **default to `refuted: true` when uncertain**:
     - **correctness** — "Does this change do what the card title claims, with no logic error? Try to find a case where it's wrong."
     - **regression** — "Could this break existing behavior or other consumers? Find the regression."
     - **test-adequacy** — "Beyond red/green, does the new test assert the RIGHT thing (not a tautology that would pass for a wrong fix)?"
     Apply `gateVerdict({adequacy, votes})` (block if ≥2 refute; a missing/errored verdict counts as refuted). **block** → discard the branch, card → Blocked (reason = the gate reason + the refuting lenses), handoff, **exit**. **pass** → step 7.
  7. **Do NOT bump versions or tag.** Push the branch and open the CI-gated auto-merge PR (`git push -u origin autoloop/<id>`; `gh pr create --fill --base main`; `gh pr merge --auto --squash`). Record the Gate B result (adequacy + the 3 votes) in the handoff.
````

- [ ] **Step 2: Update the Deferred section's Gate B line**

Replace the `**Gate B — separate adversarial verifier (Increment 3):**` bullet with:
```markdown
- **Gate B — ✅ Increment 3:** live Phase C runs Layer 1 (mutation check: `gate.js verify-adequacy` — the regression test must go red without the fix) then Layer 2 (a 3-lens `Workflow` panel — correctness/regression/test-adequacy, block if ≥2 refute) before opening the PR. This unlocks **bug-fixes**; features remain out.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/sauce-autoloop.md
git commit -m "feat(autoloop): Phase C runs Gate B (mutation check + 3-lens panel); unlock bug-fixes"
```

---

## Task 3: full preflight + architecture-doc sync

- [ ] **Step 1: Run the full gate**

Run: `npm run release:preflight`
Expected: exit 0; `run-autoloop-select.js` reports its new count (prior 53 + SD-3 + AV-4 + GV-5 + RA-4 = **70/70** — recount from the added assertions). Stop + report if an UNRELATED harness fails.

- [ ] **Step 2: Architecture doc**

Edit `~/notes/sauce/headspace-sauce/spice/projects/sauce/docs/workflow-loops/initial-brainstorm/Implementation Setup - Architecture.md`: in §9 (gate stack), mark **Gate B = ✅ built (Increment 3)**; in §10, mark item 4 (Gate B) **RESOLVED**; add a §4d describing `gate.js` (the two layers + the mutation check + the 3-lens panel + the bug-fix unlock). (Vault doc — no commit.)

- [ ] **Step 3: Confirm clean tree** (`git status --short` → only the pre-existing breadcrumb untracked).

---

## Task 4: final review + CI-gated PR

- [ ] **Step 1:** whole-branch review (the mutation-check orchestration correctness + fail-safe restore; gateVerdict fail-closed; the panel prompt; no scope creep — features still out).
- [ ] **Step 2:** push + auto-merge PR (after user confirm), then monitor the 7-stage ship.

---

## Self-review
- **Spec coverage:** splitDiff + adequacyVerdict + gateVerdict + runAdequacyCheck (Task 1) · CLI mutation orchestration with new+modified source + fail-safe restore (Task 1 CLI) · command Phase C L1→L2→gate + bug-fix unlock + 3-lens panel prompt (Task 2) · preflight + doc (Task 3) · review + ship (Task 4). All design components covered.
- **No placeholders:** full code in every code step; `<id>` etc. are runtime values.
- **Type consistency:** `adequacyVerdict` returns `{adequate, reason}`; `gateVerdict` consumes `{adequacy, votes}` and returns `{gate, reason}`; `runAdequacyCheck` returns `{behavioral, adequate, reason}`; `splitDiff` returns `{testFiles, sourceFiles}` — all consistent across definition, harness, CLI, and the command's branch logic. `mutate('revert'|'restore', files)` + `runTest(path)→bool` signatures match between `runAdequacyCheck`, the RA-* stubs, and the CLI wiring.
