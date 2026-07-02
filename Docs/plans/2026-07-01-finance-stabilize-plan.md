# Finance Stabilize (code fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the finance install heals from corrupting inline-flow budget categories, and add a repair heal that cleans existing `group: Unassigned` damage across all vaults.

**Architecture:** Two pure string-transforms in `platform/install.js`: (1) `_backfillBudgetGroupsFromText` learns to **skip** inline flow-mapping category items instead of splicing a block `group:` line beneath them; (2) a new `_repairMalformedBudgetGroups` strips the stray `group: Unassigned` line already spliced under flow-map items. A new ungated, snapshot-first, marker-guarded heal `applyFinanceBudgetMalformedGroupRepair` wires the repair into the install run. TDD: both transforms are exported and unit-tested by direct invocation (upgrading the existing source-regex tests to behavioral).

**Tech Stack:** Node.js (headless installer; no Obsidian runtime), `platform/install.js`, `platform/test/run-helper-cases.js` (behavioral cases via `require("../install")`), `platform/test/run-seed-migrations.js` (seed-vault regression), `npm run release:preflight`.

**Design ref:** `Docs/plans/2026-07-01-finance-stabilize-design.md`. Data repairs (July budget, Apple deposit tag, nav strip, .bak cleanup) are already applied to headspace — this plan is the shippable code half only.

**Isolation:** Execute in a dedicated git worktree (autoloop cron shares the main tree — see `Docs/landmines.md` / the cron-overlap lesson). Do NOT hand-version/tag/pin; the release pipeline owns versioning.

---

### Task 1: Export the two pure transforms for behavioral testing

**Files:**
- Modify: `platform/install.js` (exports block, ~16166 — beside `module.exports.applyFinanceCategoriesGroupBackfill`)

- [ ] **Step 1: Add the export for `_backfillBudgetGroupsFromText`**

In the `module.exports` block, immediately after the line:
```js
    module.exports.applyFinanceCategoriesGroupBackfill = applyFinanceCategoriesGroupBackfill;
```
add:
```js
    module.exports._backfillBudgetGroupsFromText = _backfillBudgetGroupsFromText;
```

- [ ] **Step 2: Verify install.js still loads**

Run: `node -e "require('./platform/install.js'); console.log('loads OK')"`
Expected: `loads OK`

- [ ] **Step 3: Commit**

```bash
git add platform/install.js
git commit -m "refactor(finance): export _backfillBudgetGroupsFromText for behavioral tests"
```

---

### Task 2: Make the backfill skip inline flow-mapping items (TDD)

**Files:**
- Test: `platform/test/run-helper-cases.js` (add behavioral cases near the existing `caseV01070Fcgb*` group)
- Modify: `platform/install.js:9146-9183` (the `categories:` walk inside `_backfillBudgetGroupsFromText`)

- [ ] **Step 1: Write the failing behavioral test**

In `platform/test/run-helper-cases.js`, add a new case function (follow the file's existing `async function caseXXX()` + `assertTrue` style; `installer` is obtained via `require(path.join(WORKSHOP, "platform/install.js"))` as at line ~13380):

```js
async function caseFinBgrBackfillSkipsFlowMap() {
  console.log("\n--- Case HC-FIN-BGR-1: backfill skips inline flow-mapping categories ---");
  const installer = require(path.join(WORKSHOP, "platform/install.js"));
  const body = [
    "---",
    "type: budget",
    "month: 2026-08",
    "categories:",
    '  - {"group":"Lifestyle","name":"Golf","planned":30,"actual":0}',
    '  - {"group":"Travel","name":"Travel","planned":100,"actual":0}',
    "groups:",
    "  - Lifestyle",
    "  - Travel",
    "---",
    "",
    "body",
  ].join("\n");
  const out = installer._backfillBudgetGroupsFromText(body);
  assertTrue("HC-FIN-BGR-1: flow-map body is NOT touched", out.touched === false);
  assertTrue("HC-FIN-BGR-1: no stray 'group: Unassigned' inserted",
    !/\n    group: Unassigned/.test(out.body));
  assertTrue("HC-FIN-BGR-1: original flow-map rows intact",
    /\{"group":"Lifestyle","name":"Golf"/.test(out.body) &&
    /\{"group":"Travel","name":"Travel"/.test(out.body));
}
```

Also add a regression case proving block-style legacy backfill is UNCHANGED:

```js
async function caseFinBgrBackfillStillBackfillsBlock() {
  console.log("\n--- Case HC-FIN-BGR-2: backfill still adds Unassigned to block items lacking a group ---");
  const installer = require(path.join(WORKSHOP, "platform/install.js"));
  const body = [
    "---",
    "type: budget",
    "month: 2026-08",
    "categories:",
    "  - name: Groceries",
    "    planned: 550",
    "    actual: 0",
    "groups: []",
    "---",
    "",
  ].join("\n");
  const out = installer._backfillBudgetGroupsFromText(body);
  assertTrue("HC-FIN-BGR-2: block item without group is backfilled", out.touched === true);
  assertTrue("HC-FIN-BGR-2: 'group: Unassigned' inserted for block item",
    /\n    group: Unassigned/.test(out.body));
}
```

Register both in the runner list beside the existing `caseV01070Fcgb*` calls (grep `caseV01070Fcgb3AppendOnlyGuard` in the file to find the registration/dispatch site and add the two new calls the same way).

- [ ] **Step 2: Run the test to verify HC-FIN-BGR-1 FAILS**

Run: `node platform/test/run-helper-cases.js 2>&1 | grep -E "HC-FIN-BGR-1|FAIL" | head`
Expected: HC-FIN-BGR-1 assertions FAIL (current code splices `    group: Unassigned` under the flow-map item, so `touched === true` and a stray line is present).

- [ ] **Step 3: Implement the flow-map skip**

In `platform/install.js`, inside `_backfillBudgetGroupsFromText`, within the `if (isItemStart(fmLines[i])) {` branch (currently line ~9151), add a flow-map guard **before** the `hasGroup` computation. Locate:
```js
        if (isItemStart(fmLines[i])) {
          // Collect item's continuation lines.
          const itemStartIdx = i;
          let j = i + 1;
          while (j < fmLines.length && isItemContinuation(fmLines[j])) j++;
```
and insert immediately after the `while (j ...) j++;` line:
```js
          // Inline flow-mapping items (e.g. `- {"group":"…","name":"…"}`) carry
          // their group INSIDE the braces; the line-scan below cannot see it and
          // would splice a stray `    group: Unassigned` beneath the row, producing
          // malformed frontmatter. Skip flow-map items entirely — the scaffold and
          // BudgetCategoriesEditor always write `group` inside the flow-map, so
          // there is nothing to backfill.
          if (/^  - \{/.test(fmLines[itemStartIdx])) {
            i = j;
            continue;
          }
```

- [ ] **Step 4: Run the tests to verify both pass**

Run: `node platform/test/run-helper-cases.js 2>&1 | grep -E "HC-FIN-BGR-1|HC-FIN-BGR-2" `
Expected: all HC-FIN-BGR-1 and HC-FIN-BGR-2 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/run-helper-cases.js
git commit -m "fix(finance): group backfill skips inline flow-mapping categories (no more stray 'Unassigned')"
```

---

### Task 3: New `_repairMalformedBudgetGroups` pure transform (TDD)

**Files:**
- Test: `platform/test/run-helper-cases.js`
- Modify: `platform/install.js` (add the function next to `_backfillBudgetGroupsFromText`, ~line 9189; add its export beside Task 1's)

- [ ] **Step 1: Write the failing behavioral test**

Add to `platform/test/run-helper-cases.js`:

```js
async function caseFinBgrRepairStripsStray() {
  console.log("\n--- Case HC-FIN-BGR-3: repair strips stray 'group: Unassigned' under a flow-map ---");
  const installer = require(path.join(WORKSHOP, "platform/install.js"));
  const corrupt = [
    "---",
    "type: budget",
    "month: 2026-07",
    "categories:",
    '  - {"group":"Variable Essentials","name":"Groceries","planned":550,"actual":0}',
    "    group: Unassigned",
    '  - {"group":"Lifestyle","name":"Golf","planned":30,"actual":0}',
    "    group: Unassigned",
    "groups:",
    "  - Variable Essentials",
    "  - Lifestyle",
    "---",
    "",
  ].join("\n");
  const out = installer._repairMalformedBudgetGroups(corrupt);
  assertTrue("HC-FIN-BGR-3: repair reports touched", out.touched === true);
  assertTrue("HC-FIN-BGR-3: stray lines removed", !/\n    group: Unassigned/.test(out.body));
  assertTrue("HC-FIN-BGR-3: flow-map rows preserved",
    /\{"group":"Variable Essentials","name":"Groceries"/.test(out.body) &&
    /\{"group":"Lifestyle","name":"Golf"/.test(out.body));
  // Idempotent: second pass is a no-op.
  const out2 = installer._repairMalformedBudgetGroups(out.body);
  assertTrue("HC-FIN-BGR-3: idempotent (second pass no-op)", out2.touched === false);
}

async function caseFinBgrRepairLeavesCleanNotes() {
  console.log("\n--- Case HC-FIN-BGR-4: repair no-ops on clean notes (block + flow) ---");
  const installer = require(path.join(WORKSHOP, "platform/install.js"));
  const cleanBlock = [
    "---","type: budget","month: 2026-06","categories:",
    "  - group: Lifestyle","    name: Golf","    planned: 30","    actual: 0",
    "---","",
  ].join("\n");
  const cleanFlow = [
    "---","type: budget","month: 2026-08","categories:",
    '  - {"group":"Lifestyle","name":"Golf","planned":30,"actual":0}',
    "---","",
  ].join("\n");
  assertTrue("HC-FIN-BGR-4: clean block untouched", installer._repairMalformedBudgetGroups(cleanBlock).touched === false);
  assertTrue("HC-FIN-BGR-4: clean flow untouched", installer._repairMalformedBudgetGroups(cleanFlow).touched === false);
  // A legitimately block-Unassigned row (not under a flow-map) must NOT be stripped.
  const legitBlockUnassigned = [
    "---","type: budget","month: 2026-03","categories:",
    "  - name: Mystery","    group: Unassigned","    planned: 10","    actual: 0",
    "---","",
  ].join("\n");
  assertTrue("HC-FIN-BGR-4: legit block Unassigned preserved",
    installer._repairMalformedBudgetGroups(legitBlockUnassigned).touched === false);
}
```

Register the two cases in the runner list beside Task 2's.

- [ ] **Step 2: Run to verify FAIL**

Run: `node platform/test/run-helper-cases.js 2>&1 | grep -E "HC-FIN-BGR-3|HC-FIN-BGR-4|TypeError|is not a function" | head`
Expected: FAIL — `installer._repairMalformedBudgetGroups is not a function`.

- [ ] **Step 3: Implement `_repairMalformedBudgetGroups` + export it**

In `platform/install.js`, immediately after `_backfillBudgetGroupsFromText` returns (after its closing `}` ~line 9189), add:

```js
// _repairMalformedBudgetGroups — pure string transform on Budget-*.md body.
// Undoes the pre-fix corruption where the group backfill spliced a stray
// `    group: Unassigned` line directly beneath an inline flow-mapping category
// item (which already carries its group inside the braces). Removes ONLY a
// `    group: Unassigned` line that immediately follows a `  - { … "group" … }`
// flow-map item. Never touches legitimate block-style `group: Unassigned`.
// Returns { body, touched, repaired }. Idempotent; never throws on malformed YAML.
function _repairMalformedBudgetGroups(body) {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { body, touched: false, repaired: 0 };

  const fmLines = fmMatch[1].split("\n");
  const out = [];
  let repaired = 0;
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    out.push(line);
    // Flow-map category item that already carries a group inside the braces.
    if (/^  - \{.*["']?group["']?\s*:/.test(line)) {
      // Drop a stray `    group: Unassigned` immediately beneath it.
      if (i + 1 < fmLines.length && /^    group:\s*Unassigned\s*$/.test(fmLines[i + 1])) {
        i += 1; // skip the stray line (do not push)
        repaired += 1;
      }
    }
  }
  if (repaired === 0) return { body, touched: false, repaired: 0 };
  const newFm = out.join("\n");
  const newBody = body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  return { body: newBody, touched: true, repaired };
}
```

Add the export beside Task 1's:
```js
    module.exports._repairMalformedBudgetGroups = _repairMalformedBudgetGroups;
```

- [ ] **Step 4: Run to verify PASS**

Run: `node platform/test/run-helper-cases.js 2>&1 | grep -E "HC-FIN-BGR-3|HC-FIN-BGR-4"`
Expected: all HC-FIN-BGR-3 / HC-FIN-BGR-4 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/run-helper-cases.js
git commit -m "feat(finance): add _repairMalformedBudgetGroups transform (strips stray Unassigned under flow-maps)"
```

---

### Task 4: Wire `applyFinanceBudgetMalformedGroupRepair` heal into the install run

**Files:**
- Modify: `platform/install.js` — new async heal (near `applyFinanceCategoriesGroupBackfill`, ~9385), call site in `applyFinanceMigrations` (after line 6432), export (~16166)

- [ ] **Step 1: Write the failing integration test**

Add to `platform/test/run-helper-cases.js`:

```js
async function caseFinBgrHealWiredAndUngated() {
  console.log("\n--- Case HC-FIN-BGR-5: repair heal exported, called, ungated, snapshot-first ---");
  const installer = require(path.join(WORKSHOP, "platform/install.js"));
  assertTrue("HC-FIN-BGR-5: heal exported",
    typeof installer.applyFinanceBudgetMalformedGroupRepair === "function");
  const src = fs.readFileSync(path.join(WORKSHOP, "platform/install.js"), "utf8");
  assertTrue("HC-FIN-BGR-5: heal invoked in applyFinanceMigrations",
    /await\s+applyFinanceBudgetMalformedGroupRepair\(/.test(src));
  const m = src.match(/async\s+function\s+applyFinanceBudgetMalformedGroupRepair\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assertTrue("HC-FIN-BGR-5: heal body matched", m !== null);
  if (m) {
    assertTrue("HC-FIN-BGR-5: snapshot before write (.sauce-backup)", /\.sauce-backup/.test(m[1]));
    assertTrue("HC-FIN-BGR-5: marker-guarded", /__budget_malformed_group_repaired/.test(m[1]));
    assertTrue("HC-FIN-BGR-5: ungated (no version-gate compare)", !/VERSION_SNAPSHOT|semverGte|isVersionAtLeast/.test(m[1]));
  }
}
```

Register it in the runner list.

- [ ] **Step 2: Run to verify FAIL**

Run: `node platform/test/run-helper-cases.js 2>&1 | grep -E "HC-FIN-BGR-5"`
Expected: FAIL — heal not exported / not invoked.

- [ ] **Step 3: Implement the heal**

In `platform/install.js`, after `applyFinanceCategoriesGroupBackfill` (ends ~9385), add. It mirrors that function's walk + snapshot conventions, adds a per-file marker guard, and calls `_repairMalformedBudgetGroups`:

```js
// applyFinanceBudgetMalformedGroupRepair — ungated, snapshot-first, marker-guarded,
// idempotent repair of the pre-fix corruption (stray `    group: Unassigned` spliced
// under inline flow-mapping category items). Runs on every install so every vault
// self-heals; per-file failure-loud. Mirrors applyFinanceCategoriesGroupBackfill.
async function applyFinanceBudgetMalformedGroupRepair(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const budgetsRoot = "spice/finance/budgets";
  if (!(await adapter.exists(budgetsRoot))) return;

  const budgetFiles = [];
  try {
    const top = await adapter.list(budgetsRoot);
    for (const folder of (top.folders || [])) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/Budget-\d{4}-\d{2}\.md$/.test(fp)) budgetFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud */ }
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_budget_malformed_group_repair", name: "finance",
      reason: `list failed: ${e.message}`, git_commit: git.commit, git_tag: git.tag,
      git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }
  if (budgetFiles.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = `.sauce-backup/${ts}/spice/finance/budgets`;
  let touchedFiles = 0, repairedRows = 0;
  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      if (/__budget_malformed_group_repaired:/.test(body)) continue; // idempotency marker
      const result = _repairMalformedBudgetGroups(body);
      if (!result.touched) continue;
      // Snapshot before write.
      try {
        const rel = fp.substring(budgetsRoot.length);
        const backupPath = backupRoot + rel;
        const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
        if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
        await adapter.write(backupPath, body);
      } catch (e) {
        history?.push({ event: "warning", step: "finance_budget_malformed_group_repair", name: "finance",
          path: fp, reason: `snapshot failed: ${e.message}`, git_commit: git.commit,
          git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      }
      // Append the marker so the repair is one-shot per file.
      let out = result.body;
      out = out.replace(/^(---\n[\s\S]*?)\n---/, `$1\n__budget_malformed_group_repaired: v0.16\n---`);
      await adapter.write(fp, out);
      touchedFiles += 1;
      repairedRows += result.repaired;
      history?.push({ event: "info", step: "finance_budget_malformed_group_repair", name: "finance",
        path: fp, repaired: result.repaired, git_commit: git.commit, git_tag: git.tag,
        git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_budget_malformed_group_repair", name: "finance",
        path: fp, reason: e.message, git_commit: git.commit, git_tag: git.tag,
        git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }
  history?.push({ event: "info", step: "finance_budget_malformed_group_repair", name: "finance",
    summary: { touchedFiles, repairedRows, scanned: budgetFiles.length },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}
```

Add the call in `applyFinanceMigrations` immediately after line 6432 (`await applyFinanceCategoriesGroupBackfill(...)`):
```js
  await applyFinanceBudgetMalformedGroupRepair(tp, manifest, variables, history, git);   // NEW — repairs pre-fix stray Unassigned
```

Add the export beside the others (~16166):
```js
    module.exports.applyFinanceBudgetMalformedGroupRepair = applyFinanceBudgetMalformedGroupRepair;
```

- [ ] **Step 4: Run to verify PASS + install.js loads**

Run: `node -e "require('./platform/install.js')" && node platform/test/run-helper-cases.js 2>&1 | grep -E "HC-FIN-BGR-5"`
Expected: install.js loads; HC-FIN-BGR-5 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/run-helper-cases.js
git commit -m "feat(finance): applyFinanceBudgetMalformedGroupRepair install heal (ungated, snapshot-first)"
```

---

### Task 5: Seed-vault regression + full preflight + PR

**Files:**
- Possibly modify: `platform/test/seed-vault/` (add/adjust an inline-flow budget fixture) + `platform/test/run-seed-migrations.js`
- Verify only: whole preflight suite

- [ ] **Step 1: Add a seed-vault regression (if the harness supports a per-cycle fixture)**

Read `Docs/agent-guides/migration-regression-net.md` first. If a finance budget fixture exists in `platform/test/seed-vault/spice/finance/budgets/`, add an inline-flow category row + a planted stray `    group: Unassigned` to one budget fixture and add an assertion in `run-seed-migrations.js` that after migration the stray line is gone and the flow-map row survives (portable-sentinel pattern). If the seed harness has no finance-budget fixture, SKIP this step (the behavioral cases in Tasks 2–4 cover the transforms) and note the skip in the result doc.

- [ ] **Step 2: Run the targeted suites**

Run:
```bash
node platform/test/run-helper-cases.js 2>&1 | tail -5
node platform/test/run-seed-migrations.js 2>&1 | tail -5
```
Expected: both report all-pass (no FAIL lines).

- [ ] **Step 3: Full preflight**

Run: `npm run release:preflight 2>&1 | tail -20`
Expected: whole suite green (exit 0). Fix any breakage before proceeding.

- [ ] **Step 4: Workshop self-install (dogfood) is clean + non-corrupting**

Run: `node platform/install.js --vault . --auto-approve 2>&1 | tail -20`
Then confirm the workshop's own finance budgets (if any under `spice/finance/budgets/`) have zero stray lines:
```bash
grep -rc "    group: Unassigned" spice/finance/budgets/ 2>/dev/null || echo "no budgets or zero strays"
```
Expected: install exits 0; no stray `group: Unassigned` lines.

- [ ] **Step 5: Preflight-bumped on a clean tree**

Run: `git status --porcelain` (expect clean after commits), then `npm run release:preflight-bumped 2>&1 | tail -20`
Expected: green (finance PATCH bump computed by the pipeline; do NOT hand-edit versions).

- [ ] **Step 6: Push branch + open PR**

```bash
git push -u origin <branch>
gh pr create --title "fix(finance): stop group backfill corrupting inline-flow budget categories + repair heal" \
  --body "Sub-project #1 (Stabilize) of the finance glue refactor. Flow-map-aware group backfill (D1) + ungated snapshot-first repair heal (D2). Data repairs already applied to headspace. Spec: Docs/plans/2026-07-01-finance-stabilize-design.md"
```
Expected: PR opened; CI runs. After green CI, request adversarial diff review before merge (per the session workflow).

---

## Self-Review

**Spec coverage:**
- D1 (flow-map-aware backfill) → Task 2. ✓
- D2 (repair heal) → Tasks 3 (transform) + 4 (heal). ✓
- D3 (no schema/serialization change) → no schema task; confirmed by preflight `lint-schemas` in Task 5. ✓
- Testing (TDD transforms, integration, seed regression, gates) → Tasks 2–5. ✓
- Migrations (ungated, marker-guarded, snapshot-first, idempotent) → Task 4 + HC-FIN-BGR-5 assertions. ✓

**Placeholder scan:** Task 5 Step 1 is conditional (seed fixture may not exist) with an explicit skip + document instruction — not a placeholder; all code steps contain full code.

**Type/name consistency:** `_backfillBudgetGroupsFromText`, `_repairMalformedBudgetGroups`, `applyFinanceBudgetMalformedGroupRepair`, marker `__budget_malformed_group_repaired`, and `{touched, repaired}` return shape are used consistently across Tasks 1–5.
