# Impl-3 — entity-create installer migration coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `installer_migration` on `mechanism/entity-create` (0.0 → 1.0) by covering 2 apply* fns via direct-invocation against a Legacy EntityCreate fixture under `spice/entity-create-legacy/`, following the established HC-V01190 pattern from impl-1 (project) + impl-2 (finance).

**Architecture:** New `runEntityCreateMigrateFamily()` in `platform/test/run-seed-migrations.js`. Uses the shared `makeFsAdapter(root)` helper. Adds 1 new `module.exports.applyNewEntityButtons` line in `platform/install.js` (`applyEntityCreateGuardMigration` is already exported).

**Tech Stack:** Node.js zero-dep.

**Design doc:** `Docs/plans/2026-06-16-test-coverage-impl-3-design.md` — read it first.

**Reference templates:** `runProjectMigrateFamily()` + `runFinanceMigrateFamily()` in `platform/test/run-seed-migrations.js`.

**Worktree:** `/Users/willfellhoelter/projects/repos/sauce-test-coverage` on `feature/test-coverage-arc`.

---

## Hard rules

1. Stay in the worktree.
2. Use `git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage` for git.
3. No emojis in committed files.
4. No Co-Authored-By Claude trailer.
5. `npm run release:preflight` must stay green throughout (currently 176/176).
6. Use the shared `makeFsAdapter(root)` helper.

---

## File Structure

### Created
- `platform/test/seed-vault/spice/entity-create-legacy/Legacy Hub.md`
- `platform/test/seed-vault/spice/entity-create-legacy/Legacy Detail.md`
- `platform/test/seed-vault/spice/entity-create-legacy/Already Guarded.md`

### Modified
- `platform/install.js` — add 1 `module.exports.applyNewEntityButtons` line
- `platform/test/run-seed-migrations.js` — append `runEntityCreateMigrateFamily()` function + 15 sub-asserts

---

## Phase 0 — Setup

### Task 0.1: Verify state + add export

- [ ] **Step 1: Confirm baseline**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage status
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage log --oneline -3
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -2
```

Expected: clean tree; top commit is impl-3 design; preflight 176/176.

- [ ] **Step 2: Add export to install.js**

Find the existing `module.exports.applyEntityCreateGuardMigration` line near line 12789. Just above OR just below it (adjacent), add:

```javascript
module.exports.applyNewEntityButtons = applyNewEntityButtons;
```

- [ ] **Step 3: Verify parse + preflight**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/install.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -2
```

Expected: parse OK; 176/176 still.

- [ ] **Step 4: Commit**

```
chore(impl-3): export applyNewEntityButtons for direct-invocation harness
```

---

## Phase 1 — Fixture authoring

### Task 1.1: Create 3 fixture files

- [ ] **Step 1: Write Legacy Hub.md**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/entity-create-legacy/Legacy Hub.md`:

```markdown
---
title: Legacy Hub
type: legacy-hub
created_at: 2026-01-01T00:00:00.000Z
---

# Legacy Hub

```dataviewjs
await customJS.EntityCreate.render(dv, { instance: "legacy-doc" });
```
```

- [ ] **Step 2: Write Legacy Detail.md**

```markdown
---
title: Legacy Detail
type: legacy-detail
created_at: 2026-01-01T00:00:00.000Z
---

# Legacy Detail

```dataviewjs
await customJS.EntityCreate.render(dv, { instance: "legacy-detail-create" });
```
```

- [ ] **Step 3: Write Already Guarded.md**

```markdown
---
title: Already Guarded
type: guarded
created_at: 2026-01-01T00:00:00.000Z
---

# Already Guarded

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "already-good" }] });
```
```

- [ ] **Step 4: Commit**

```
test(impl-3): entity-create-legacy fixtures (Legacy Hub, Legacy Detail, Already Guarded)
```

---

## Phase 2 — Harness extension

### Task 2.1: Add `runEntityCreateMigrateFamily()` skeleton + invocation

Append AFTER `runFinanceMigrateFamily()` in `platform/test/run-seed-migrations.js`:

```javascript

// ===== HC-V01190-EC-SEED-MIGRATE-* — entity-create mechanism installer migrations =====
//
// Direct-invocation pattern (mirrors HC-V01190-PROJ + HC-V01190-FIN). See impl-3 design.
// 2 entity-create apply* fns covered via the Legacy EntityCreate fixture at
// platform/test/seed-vault/spice/entity-create-legacy/.

const LEGACY_EC_DIR = "spice/entity-create-legacy";

async function runEntityCreateMigrateFamily() {
    const install = require("../install.js");
    const ecRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-ec-migrate-"));
    const ecVault = path.join(ecRoot, "vault");
    fs.mkdirSync(ecVault, { recursive: true });
    
    // Copy fixture into the tmp vault at the same path (guard migration walks spice/ recursively)
    const fixtureRoot = path.join(REPO_ROOT, "platform/test/seed-vault/spice/entity-create-legacy");
    fs.cpSync(fixtureRoot, path.join(ecVault, LEGACY_EC_DIR), { recursive: true });
    // Create ranch/ for registry writes
    fs.mkdirSync(path.join(ecVault, "ranch"), { recursive: true });
    
    const adapter = makeFsAdapter(ecVault);
    const tp = {
        app: {
            vault: { adapter, getMarkdownFiles: () => [] },
            metadataCache: { getFileCache: () => null }
        }
    };
    // Synthetic manifest for applyNewEntityButtons: declares 2 new_entity_buttons entries,
    // one with render_in: hub targeting Legacy Hub.md.
    const synthManifest = {
        name: "legacy-fixture-blueprint",
        version: "0.1.0",
        new_entity_buttons: [
            {
                id: "legacy-doc",
                label: "New Legacy Doc",
                icon: "file-plus",
                frontmatter_template: { type: "legacy-doc", title: "{{title}}" },
                folder_prefix: "spice/entity-create-legacy/docs/",
                render_in: { kind: "hub", target_path: "spice/entity-create-legacy/Legacy Hub.md" }
            },
            {
                id: "legacy-detail-create",
                label: "New Legacy Detail",
                icon: "file-plus",
                frontmatter_template: { type: "legacy-detail", title: "{{title}}" },
                folder_prefix: "spice/entity-create-legacy/details/"
            }
        ]
    };
    const variables = {};
    const history = [];
    const git = { branch: "feature/test-coverage-arc", commit: "test", dirty: false, tag: null };
    
    // Snapshot Already Guarded.md BEFORE migration runs (for B5 byte-identity)
    const alreadyGuardedBefore = fs.readFileSync(path.join(ecVault, LEGACY_EC_DIR, "Already Guarded.md"), "utf8");
    
    // Pass 1: invoke both migrations
    await install.applyNewEntityButtons(tp, synthManifest, variables, history, git);
    await install.applyEntityCreateGuardMigration(tp, synthManifest, variables, history, git);
    
    // ===== Asserts A1..A5, B1..B5, D1..D2 inline here (next steps) =====
    
    // Snapshot for idempotency (C family) — captured AFTER pass 1, before pass 2
    const ecHubAfterPass1 = fs.readFileSync(path.join(ecVault, LEGACY_EC_DIR, "Legacy Hub.md"), "utf8");
    const ecRegistryAfterPass1 = JSON.parse(fs.readFileSync(path.join(ecVault, "ranch/entity-create-registry.json"), "utf8"));
    const historyLenAfterPass1 = history.length;
    
    // Pass 2: invoke again for idempotency
    await install.applyNewEntityButtons(tp, synthManifest, variables, history, git);
    await install.applyEntityCreateGuardMigration(tp, synthManifest, variables, history, git);
    
    // ===== Asserts C1..C3 inline here (next step) =====
    
    // Cleanup
    if (process.env.KEEP_SEED_VAULT === "1") {
        console.log(`KEEP_SEED_VAULT=1 (HC-V01190-EC): ${ecRoot}`);
    } else {
        fs.rmSync(ecRoot, { recursive: true, force: true });
    }
}
```

Then chain it after `runFinanceMigrateFamily()` invocation.

- [ ] **Step 1: Append skeleton + chain**

- [ ] **Step 2: Parse + run (no asserts yet; just verify invocations don't throw)**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -3
```

If install throws on either invocation, debug fixture or synthetic manifest shape (likely culprit: `applyNewEntityButtons` expects manifest fields we missed; read its source again to verify).

- [ ] **Step 3: Commit skeleton**

```
test(impl-3): runEntityCreateMigrateFamily skeleton — invokes 2 entity-create apply* fns
```

### Task 2.2: Append sub-family A (applyNewEntityButtons asserts — 5)

Insert at the marker `// ===== Asserts A1..A5, B1..B5, D1..D2 inline here =====`:

```javascript
// ----- A: applyNewEntityButtons -----
const aRegistryPath = path.join(ecVault, "ranch/entity-create-registry.json");
ok(
    "HC-V01190-EC-SEED-MIGRATE-A1 entity-create-registry.json materialized",
    fs.existsSync(aRegistryPath)
);
const aRegistry = JSON.parse(fs.readFileSync(aRegistryPath, "utf8"));
ok(
    "HC-V01190-EC-SEED-MIGRATE-A2 registry has schema_version: 1",
    aRegistry.schema_version === 1
);
ok(
    "HC-V01190-EC-SEED-MIGRATE-A3 contributions keyed under synthetic manifest name",
    aRegistry.contributions && Array.isArray(aRegistry.contributions["legacy-fixture-blueprint"])
);
ok(
    "HC-V01190-EC-SEED-MIGRATE-A4 contribution has >= 2 entries",
    (aRegistry.contributions["legacy-fixture-blueprint"] || []).length >= 2
);
// A5 may need adjustment based on what the hub-kind injection emits.
// applyNewEntityButtons should mutate Legacy Hub.md to insert an AccentButton block
// for the legacy-doc entry. Verify the body contains some signal of the injection.
const aHubBody = fs.readFileSync(path.join(ecVault, LEGACY_EC_DIR, "Legacy Hub.md"), "utf8");
ok(
    "HC-V01190-EC-SEED-MIGRATE-A5 Legacy Hub.md has hub injection signal (AccentButton or registry-marker)",
    aHubBody.includes("AccentButton") || aHubBody.includes("entity-create") || aHubBody.includes("new-doc-button")
);
```

A5 is the most uncertain — read the `applyNewEntityButtons` source to understand exactly what it injects on hub-kind entries. Adjust the predicate accordingly.

Run + commit per family:

```
test(impl-3): HC-V01190-EC-SEED-MIGRATE-A family — 5 asserts (applyNewEntityButtons)
```

### Task 2.3: Append sub-family B (applyEntityCreateGuardMigration asserts — 5)

```javascript
// ----- B: applyEntityCreateGuardMigration -----
const bHubBody = fs.readFileSync(path.join(ecVault, LEGACY_EC_DIR, "Legacy Hub.md"), "utf8");
ok(
    "HC-V01190-EC-SEED-MIGRATE-B1 Legacy Hub.md no longer has direct customJS.EntityCreate.render call",
    !/customJS\.EntityCreate\.render\s*\(/.test(bHubBody)
);
ok(
    "HC-V01190-EC-SEED-MIGRATE-B2 Legacy Hub.md has guard form dv.view ranch/views/customjs-guard",
    bHubBody.includes('dv.view("ranch/views/customjs-guard"')
);
const bDetailBody = fs.readFileSync(path.join(ecVault, LEGACY_EC_DIR, "Legacy Detail.md"), "utf8");
ok(
    "HC-V01190-EC-SEED-MIGRATE-B3 Legacy Detail.md no longer has direct call (vault-walk reached it)",
    !/customJS\.EntityCreate\.render\s*\(/.test(bDetailBody)
);
ok(
    "HC-V01190-EC-SEED-MIGRATE-B4 Legacy Detail.md has guard form",
    bDetailBody.includes('dv.view("ranch/views/customjs-guard"')
);
const bAlreadyGuardedAfter = fs.readFileSync(path.join(ecVault, LEGACY_EC_DIR, "Already Guarded.md"), "utf8");
ok(
    "HC-V01190-EC-SEED-MIGRATE-B5 Already Guarded.md byte-identical to fixture (idempotent on already-guarded)",
    bAlreadyGuardedAfter === alreadyGuardedBefore
);
```

Run + commit:

```
test(impl-3): HC-V01190-EC-SEED-MIGRATE-B family — 5 asserts (applyEntityCreateGuardMigration)
```

### Task 2.4: Append sub-family D (history audit-trail — 2)

```javascript
// ----- D: history audit-trail -----
ok(
    "HC-V01190-EC-SEED-MIGRATE-D1 history records >= 2 events (one per migration)",
    history.length >= 2
);
const dHasErrors = history.some(h => Array.isArray(h.errors) && h.errors.length > 0);
ok(
    "HC-V01190-EC-SEED-MIGRATE-D2 no event has populated errors[]",
    !dHasErrors
);
```

Run + commit:

```
test(impl-3): HC-V01190-EC-SEED-MIGRATE-D family — 2 audit-trail asserts
```

### Task 2.5: Append sub-family C (idempotency on second pass — 3)

Insert at the marker `// ===== Asserts C1..C3 inline here =====`:

```javascript
// ----- C: idempotency on second invocation -----
const cHubAfterPass2 = fs.readFileSync(path.join(ecVault, LEGACY_EC_DIR, "Legacy Hub.md"), "utf8");
ok(
    "HC-V01190-EC-SEED-MIGRATE-C1 second invocation: Legacy Hub.md byte-identical pass 1 vs pass 2",
    ecHubAfterPass1 === cHubAfterPass2
);
const cRegistryAfterPass2 = JSON.parse(fs.readFileSync(path.join(ecVault, "ranch/entity-create-registry.json"), "utf8"));
const cContribPass1Len = (ecRegistryAfterPass1.contributions["legacy-fixture-blueprint"] || []).length;
const cContribPass2Len = (cRegistryAfterPass2.contributions["legacy-fixture-blueprint"] || []).length;
ok(
    "HC-V01190-EC-SEED-MIGRATE-C2 second invocation: contribution count unchanged (no duplicates)",
    cContribPass1Len === cContribPass2Len
);
// history grew, but the new events should be skip/no-op events (or just additional info events).
// We assert that no new event has errors[].
const cNewEvents = history.slice(historyLenAfterPass1);
const cNewHasErrors = cNewEvents.some(h => Array.isArray(h.errors) && h.errors.length > 0);
ok(
    "HC-V01190-EC-SEED-MIGRATE-C3 second invocation: no new history event has errors[]",
    !cNewHasErrors
);
```

Run + commit:

```
test(impl-3): HC-V01190-EC-SEED-MIGRATE-C family — 3 idempotency asserts
```

### Task 2.6: Final verification

```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -3
```

Expected: 191/191 green (was 176; +15 new asserts).

---

## Phase 3 — Audit refresh (controller-driven, post-execution)

These steps will be handled by the controller after Phase 2 completes:
- Regen matrix + render audit + re-apply override block
- Verify entity-create installer_migration axis lifted to ≥ 1.0
- Commit refresh

## Phase 4 — Cycle close (controller-driven)

- Write result doc
- Write post-impl-3 handoff (Phase 5 = arc close)

---

## Self-review

1. **Spec coverage**: design's 4 sub-families all implemented (Task 2.2 = A, 2.3 = B, 2.4 = D, 2.5 = C). All 15 asserts mapped.

2. **Placeholder scan**: A5 predicate is loosely-defined (3-way OR). The implementer should READ `applyNewEntityButtons` source to know what to actually assert. Documented as adjustment-point. No "TBD".

3. **Type consistency**: synthetic manifest `name: "legacy-fixture-blueprint"` consistent across A3, C2; `LEGACY_EC_DIR` constant used throughout; `aHubBody` / `bHubBody` / `cHubAfterPass2` letter-prefixed by sub-family.

4. **Idempotency snapshot timing**: snapshots taken AFTER pass 1, BEFORE pass 2 (`ecHubAfterPass1`, `ecRegistryAfterPass1`, `historyLenAfterPass1`). Asserts compare them to AFTER pass 2.

5. **`Already Guarded.md` snapshot**: taken BEFORE pass 1 (since the assert is "untouched throughout"). Variable `alreadyGuardedBefore`.

## Execution

Proceed with `superpowers:subagent-driven-development`.
