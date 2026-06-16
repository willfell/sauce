# Impl-1 — project installer migration coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `installer_migration` axis on `blueprint/project` by adding a `Legacy Project` seed-vault fixture at pre-migration shape plus 15 `HC-V01190-PROJ-SEED-MIGRATE-*` sub-asserts in `platform/test/run-seed-migrations.js` covering all 5 untested project apply* functions.

**Architecture:** All asserts live in the existing migration regression net (`run-seed-migrations.js`). Pre-migration fixtures live in `platform/test/seed-vault/spice/projects/Legacy Project/`. Asserts run post-install and verify each migration's contract was applied. Idempotency asserts verify second install is a clean no-op on already-migrated state.

**Tech Stack:** Node.js (zero-dep, matching the existing harness style). Bash for git + preflight.

**Design doc:** `Docs/plans/2026-06-16-test-coverage-impl-1-design.md` — read it before starting. The seed-vault extension shape, the 15 asserts, and the rebaseline concern all live there.

**Worktree:** `/Users/willfellhoelter/projects/repos/sauce-test-coverage` on `feature/test-coverage-arc`. All commands MUST target this path. The main checkout is unrelated.

---

## Hard rules

1. Stay in the worktree. All paths absolute-prefixed with `/Users/willfellhoelter/projects/repos/sauce-test-coverage/`.
2. Use `git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage` for git commands.
3. No emojis in committed files.
4. No Co-Authored-By Claude trailer in commits.
5. `npm run release:preflight` must exit 0 before this impl is considered closed.
6. Run from the worktree (`cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && ...`).

---

## File Structure

### Created
- `platform/test/seed-vault/spice/projects/Legacy Project/Legacy Project.md` — project hub note at pre-migration shape
- `platform/test/seed-vault/spice/projects/Legacy Project/docs/Docs.md` — pre-#2 Docs hub (no ProjectDocsIndex)
- `platform/test/seed-vault/spice/projects/Legacy Project/docs/Old Note.md` — pre-#1 flat doc-note
- `platform/test/seed-vault/spice/projects/Legacy Project/docs/Custom Section/Custom Note.md` — pre-#1 custom subfolder doc-note
- `platform/test/seed-vault/spice/projects/Legacy Project/docs/Custom Section/Bad Link Note.md` — pre-#4 doc-note with empty project wikilink

### Modified
- `platform/test/run-seed-migrations.js` — append `HC-V01190-PROJ-SEED-MIGRATE-*` family after the existing `HC-V01174-*` block

### Not modified (verified-no-touch)
- `scripts/rebaseline-seed.js` — design risk says this might wipe the fixture. Per the design's risk analysis, after arc close + rebaseline the Legacy Project moves to post-migration shape; asserts check post-state so they still pass on a no-op install. No script change required.
- `platform/install.js` — migrations already exist; we are testing them, not changing them.

---

## Phase 0 — Verify state

### Task 0.1: Confirm starting state

**Files:** none (read-only)

- [ ] **Step 1: Confirm branch + worktree clean**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage status
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage log --oneline -3
```

Expected: branch `feature/test-coverage-arc`, working tree clean, top commit is the impl-1 design.

- [ ] **Step 2: Confirm `Legacy Project/` does not yet exist**

Run:
```bash
ls /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/projects/ 2>&1
```

Expected: only `Projects.md`. No `Legacy Project/` directory.

- [ ] **Step 3: Confirm install.js apply* functions exist**

Run:
```bash
grep -n "^async function applyProject\|^async function applyEmptyProject" /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/install.js | head -10
```

Expected: 5 matches — `applyProjectSectionsMigration`, `applyProjectSectionsHubMigration`, `applyProjectSectionsCloseRepair`, `applyEmptyProjectWikilinkRepair`, `applyProjectTodoBackfill`.

---

## Phase 1 — Seed-vault fixture authoring

### Task 1.1: Create `Legacy Project.md` (project hub note, pre-shape for #1 + #3)

**Files:**
- Create: `platform/test/seed-vault/spice/projects/Legacy Project/Legacy Project.md`

- [ ] **Step 1: Write the file**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/projects/Legacy Project/Legacy Project.md` with the following exact contents (intentionally malformed frontmatter close `-"[[--]]"` to trigger migration #3, and no `sections:` field to trigger migration #1's section-registration step):

```markdown
---
title: Legacy Project
type: project
created_at: 2026-01-01T00:00:00.000Z
status: active
-"[[--]]"

# Legacy Project

(Pre-migration fixture — see HC-V01190-PROJ-SEED-MIGRATE-* family in run-seed-migrations.js.)

```dataviewjs
customJS.ProjectNavButtons.render(dv);
```
```

Note: the bottom code block fences are intentional in the file body. They start a dataviewjs block.

- [ ] **Step 2: Verify file content**

Run:
```bash
head -7 "/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/projects/Legacy Project/Legacy Project.md"
```

Expected: shows the YAML frontmatter ending with `-"[[--]]"` on line 6.

### Task 1.2: Create `docs/Docs.md` (pre-shape for #2)

**Files:**
- Create: `platform/test/seed-vault/spice/projects/Legacy Project/docs/Docs.md`

- [ ] **Step 1: Write the file**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/projects/Legacy Project/docs/Docs.md` with these exact contents (no `customJS.ProjectDocsIndex.render` — that's what migration #2 injects):

```markdown
---
title: Docs
type: docs-hub
project: "[[Legacy Project]]"
created_at: 2026-01-01T00:00:00.000Z
---

# Docs

(Pre-migration fixture — see HC-V01190-PROJ-SEED-MIGRATE-B* in run-seed-migrations.js.)

```dataviewjs
customJS.ProjectDocsCards.render(dv);
```
```

### Task 1.3: Create `docs/Old Note.md` (pre-shape for #1 flat doc)

**Files:**
- Create: `platform/test/seed-vault/spice/projects/Legacy Project/docs/Old Note.md`

- [ ] **Step 1: Write the file**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/projects/Legacy Project/docs/Old Note.md` with these exact contents (no `section:` field — migration #1 detects flat layout and moves this into `docs/knowledge/`):

```markdown
---
title: Old Note
type: doc-note
project: "[[Legacy Project]]"
created_at: 2026-01-01T00:00:00.000Z
---

# Old Note

(Pre-migration fixture for applyProjectSectionsMigration — flat layout.)
```

### Task 1.4: Create `docs/Custom Section/Custom Note.md` (pre-shape for #1 custom subfolder)

**Files:**
- Create: `platform/test/seed-vault/spice/projects/Legacy Project/docs/Custom Section/Custom Note.md`

- [ ] **Step 1: Write the file**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/projects/Legacy Project/docs/Custom Section/Custom Note.md` with these exact contents (section as string, not wikilink — migration #2 converts to wikilink):

```markdown
---
title: Custom Note
type: doc-note
project: "[[Legacy Project]]"
section: "Custom Section"
created_at: 2026-01-01T00:00:00.000Z
---

# Custom Note

(Pre-migration fixture for applyProjectSectionsHubMigration — string-section becomes wikilink.)
```

### Task 1.5: Create `docs/Custom Section/Bad Link Note.md` (pre-shape for #4)

**Files:**
- Create: `platform/test/seed-vault/spice/projects/Legacy Project/docs/Custom Section/Bad Link Note.md`

- [ ] **Step 1: Write the file**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/seed-vault/spice/projects/Legacy Project/docs/Custom Section/Bad Link Note.md` with these exact contents (empty `project: "[[]]"` — migration #4 rewrites to `"[[Legacy Project]]"`):

```markdown
---
title: Bad Link Note
type: doc-note
project: "[[]]"
section: "Custom Section"
created_at: 2026-01-01T00:00:00.000Z
---

# Bad Link Note

(Pre-migration fixture for applyEmptyProjectWikilinkRepair.)
```

### Task 1.6: Stage + commit fixtures

**Files:** all 5 created above

- [ ] **Step 1: Stage**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add "platform/test/seed-vault/spice/projects/Legacy Project/"
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage status --short
```

Expected: 5 new files staged under `platform/test/seed-vault/spice/projects/Legacy Project/`.

- [ ] **Step 2: Commit**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "test(impl-1): Legacy Project seed-vault fixture for project migration coverage

Pre-migration shape fixtures for the 5 project apply* migrations:
- Legacy Project.md — malformed frontmatter close (#3 trigger) + no sections (#1)
- docs/Docs.md — no ProjectDocsIndex call (#2 trigger)
- docs/Old Note.md — flat doc-note (#1 trigger: move into knowledge/)
- docs/Custom Section/Custom Note.md — string section (#2 trigger: wikilink conversion)
- docs/Custom Section/Bad Link Note.md — empty project wikilink (#4 trigger)

To-Do.md intentionally absent (#5 trigger: applyProjectTodoBackfill creates it).

Asserts come next in HC-V01190-PROJ-SEED-MIGRATE-* family extension to
run-seed-migrations.js."
```

Expected: commit succeeds, files added.

---

## Phase 2 — Harness extension

### Task 2.1: Locate the insertion point in run-seed-migrations.js

**Files:** none (investigation)

- [ ] **Step 1: Find the last HC family block**

Run:
```bash
grep -n "HC-V01174" /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js | tail -3
```

Expected: shows where the v0.117.4 family ends. The new family should append after this block, before the final summary/exit code.

- [ ] **Step 2: Find the closing summary block**

Run:
```bash
grep -n "summary\|console.log.*pass\|process.exit\|^// ====" /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js | tail -10
```

Expected: shows the closing `// =====` family header pattern and the final pass/fail summary.

### Task 2.2: Append the new HC family with sub-family A asserts (sections migration, 3 asserts)

**Files:**
- Modify: `platform/test/run-seed-migrations.js` (append family after last existing family, before summary)

- [ ] **Step 1: Read the harness helper functions in scope**

Run:
```bash
grep -n "^function ok\|^const helpers\|^const vault\b\|helpers\.\(readNote\|parseFrontmatter\|fileExists\)" /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js | head -20
```

Confirm: `ok(label, condition)` is the assert helper; `helpers.readNote(vault, relPath)` reads a file; `helpers.parseFrontmatter(text)` returns `{frontmatter, body}`; `vault` is the tmp dir containing the post-install seed.

- [ ] **Step 2: Append the sub-family A block**

Append to `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js` AFTER the last existing HC family and BEFORE the closing summary block. Use Edit tool to find the appropriate insertion point. Append this exact block:

```javascript

// ===== HC-V01190-PROJ-SEED-MIGRATE-* — project blueprint installer migrations =====
//
// Asserts on 5 project apply* migrations against the Legacy Project fixture at
// platform/test/seed-vault/spice/projects/Legacy Project/. See impl-1 design doc.

const LEGACY_PROJ_DIR = "spice/projects/Legacy Project";

// ----- A: applyProjectSectionsMigration -----
const aOldNoteInKnowledge = fs.existsSync(path.join(vault, LEGACY_PROJ_DIR, "docs/knowledge/Old Note.md"));
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-A1 Old Note moved into docs/knowledge/",
    aOldNoteInKnowledge
);
const aOldNoteFlatGone = !fs.existsSync(path.join(vault, LEGACY_PROJ_DIR, "docs/Old Note.md"));
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-A2 flat docs/Old Note.md removed by sections migration",
    aOldNoteFlatGone
);
const aLegacyProjFm = helpers.parseFrontmatter(
    helpers.readNote(vault, `${LEGACY_PROJ_DIR}/Legacy Project.md`)
).frontmatter;
const aSections = Array.isArray(aLegacyProjFm.sections) ? aLegacyProjFm.sections : [];
const aSectionsHasAll = ["Knowledge", "Notes", "Custom Section"].every(want =>
    aSections.some(s => String(s).includes(want))
);
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-A3 sections[] registered Knowledge + Notes + Custom Section",
    aSectionsHasAll
);
```

- [ ] **Step 3: Verify parse**

Run:
```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
```

Expected: parse OK.

- [ ] **Step 4: Run the harness alone**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -10
```

Expected: all asserts pass (existing v0.110.0 + v0.117.4 + v0.119.0 families plus new A1/A2/A3). If A1, A2, or A3 fails, the issue is fixture pre-shape — debug before continuing.

### Task 2.3: Append sub-family B asserts (sections-hub migration, 4 asserts)

**Files:**
- Modify: `platform/test/run-seed-migrations.js` (append after sub-family A)

- [ ] **Step 1: Append sub-family B**

After the sub-family A block, append:

```javascript

// ----- B: applyProjectSectionsHubMigration -----
const bKnowledgeHubExists = fs.existsSync(path.join(vault, LEGACY_PROJ_DIR, "docs/Knowledge.md"));
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-B1 Knowledge.md section-hub materialized",
    bKnowledgeHubExists
);
const bCustomHubExists = fs.existsSync(path.join(vault, LEGACY_PROJ_DIR, "docs/Custom Section.md"));
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-B2 Custom Section.md section-hub materialized",
    bCustomHubExists
);
const bDocsBody = helpers.readNote(vault, `${LEGACY_PROJ_DIR}/docs/Docs.md`);
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-B3 Docs.md body rewired to customJS.ProjectDocsIndex.render",
    bDocsBody.includes("customJS.ProjectDocsIndex.render")
);
const bCustomNoteFm = helpers.parseFrontmatter(
    helpers.readNote(vault, `${LEGACY_PROJ_DIR}/docs/Custom Section/Custom Note.md`)
).frontmatter;
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-B4 Custom Note section: string converted to wikilink",
    String(bCustomNoteFm.section || "").includes("[[") && String(bCustomNoteFm.section).includes("Custom Section")
);
```

- [ ] **Step 2: Verify + run**

Run:
```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -8
```

Expected: B1-B4 all pass.

### Task 2.4: Append sub-family C assert (close-repair, 1 assert)

**Files:**
- Modify: `platform/test/run-seed-migrations.js` (append after sub-family B)

- [ ] **Step 1: Append sub-family C**

```javascript

// ----- C: applyProjectSectionsCloseRepair -----
const cLegacyBody = helpers.readNote(vault, `${LEGACY_PROJ_DIR}/Legacy Project.md`);
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-C1 malformed frontmatter close repaired (no -\"[[--]]\")",
    !cLegacyBody.includes('-"[[--]]"')
);
```

- [ ] **Step 2: Verify + run**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -6
```

Expected: C1 passes.

### Task 2.5: Append sub-family D assert (empty-wikilink-repair, 1 assert)

**Files:**
- Modify: `platform/test/run-seed-migrations.js` (append after sub-family C)

- [ ] **Step 1: Append sub-family D**

```javascript

// ----- D: applyEmptyProjectWikilinkRepair -----
const dBadLinkFm = helpers.parseFrontmatter(
    helpers.readNote(vault, `${LEGACY_PROJ_DIR}/docs/Custom Section/Bad Link Note.md`)
).frontmatter;
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-D1 empty project wikilink rewritten to [[Legacy Project]]",
    String(dBadLinkFm.project || "").includes("Legacy Project") && !String(dBadLinkFm.project).includes("[[]]")
);
```

- [ ] **Step 2: Verify + run**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -6
```

Expected: D1 passes.

### Task 2.6: Append sub-family E asserts (todo-backfill, 2 asserts)

**Files:**
- Modify: `platform/test/run-seed-migrations.js` (append after sub-family D)

- [ ] **Step 1: Append sub-family E**

```javascript

// ----- E: applyProjectTodoBackfill -----
const eTodoPath = path.join(vault, LEGACY_PROJ_DIR, "Legacy Project To-Do.md");
const eTodoExists = fs.existsSync(eTodoPath);
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-E1 Legacy Project To-Do.md backfilled",
    eTodoExists
);
const eTodoBody = eTodoExists ? fs.readFileSync(eTodoPath, "utf8") : "";
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-E2 backfilled to-do body uses ToDoDailyProjectGroups",
    eTodoBody.includes("ToDoDailyProjectGroups")
);
```

- [ ] **Step 2: Verify + run**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -6
```

Expected: E1, E2 pass.

### Task 2.7: Append sub-family F asserts (idempotency, 4 asserts)

**Files:**
- Modify: `platform/test/run-seed-migrations.js` (append after sub-family E)

Idempotency is already exercised by the existing `IDEMP-*` block which runs a SECOND install. The F asserts run inside that block — they validate per-project no-op behavior on the Legacy Project. Need to find the second-install block.

- [ ] **Step 1: Identify the existing second-install block**

Run:
```bash
grep -n "IDEMP\|second install\|reInstall\|runInstall" /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js | head -10
```

Confirm: there's an existing second-install run with `IDEMP-1..5` asserts, and a `vault2` (or similar) variable for the post-second-install state.

- [ ] **Step 2: Append F asserts inside the IDEMP block, AFTER the existing IDEMP-* asserts**

If `vault2` is the post-second-install vault path, append (otherwise use whatever variable the existing code uses):

```javascript

// ----- F: idempotency on Legacy Project (extends IDEMP-* coverage) -----
const fOldNoteStill = fs.existsSync(path.join(vault2, LEGACY_PROJ_DIR, "docs/knowledge/Old Note.md"));
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-F1 second install: Old Note still in knowledge/ (no second move)",
    fOldNoteStill
);
const fNoBakHubs = !fs.existsSync(path.join(vault2, LEGACY_PROJ_DIR, "docs/Knowledge.md.bak"))
    && !fs.existsSync(path.join(vault2, LEGACY_PROJ_DIR, "docs/Custom Section.md.bak"));
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-F2 second install: no .bak files from section-hub re-materialization",
    fNoBakHubs
);
const fLegacyBefore = fs.readFileSync(path.join(vault, LEGACY_PROJ_DIR, "Legacy Project.md"), "utf8");
const fLegacyAfter = fs.readFileSync(path.join(vault2, LEGACY_PROJ_DIR, "Legacy Project.md"), "utf8");
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-F3 second install: Legacy Project.md byte-identical (close-repair idempotent)",
    fLegacyBefore === fLegacyAfter
);
const fTodoBefore = fs.readFileSync(path.join(vault, LEGACY_PROJ_DIR, "Legacy Project To-Do.md"), "utf8");
const fTodoAfter = fs.readFileSync(path.join(vault2, LEGACY_PROJ_DIR, "Legacy Project To-Do.md"), "utf8");
ok(
    "HC-V01190-PROJ-SEED-MIGRATE-F4 second install: To-Do.md byte-identical (backfill skip-if-exists)",
    fTodoBefore === fTodoAfter
);
```

- [ ] **Step 3: Verify + run**

```bash
node -c /Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/run-seed-migrations.js
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node platform/test/run-seed-migrations.js 2>&1 | tail -10
```

Expected: F1-F4 all pass; total of 15 new HC-V01190-PROJ-SEED-MIGRATE-* asserts green.

### Task 2.8: Commit harness extension

**Files:** `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Commit**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add platform/test/run-seed-migrations.js
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "test(impl-1): HC-V01190-PROJ-SEED-MIGRATE-* family — 15 sub-asserts

Covers 5 project apply* migrations against the Legacy Project fixture:
- A1-A3: applyProjectSectionsMigration (flat -> knowledge/ + sections[] registered)
- B1-B4: applyProjectSectionsHubMigration (section hubs + Docs.md rewire + wikilink convert)
- C1:    applyProjectSectionsCloseRepair (malformed frontmatter -> ---)
- D1:    applyEmptyProjectWikilinkRepair ([[]] -> [[Legacy Project]])
- E1-E2: applyProjectTodoBackfill (To-Do.md backfilled + canonical body)
- F1-F4: idempotency on second install (no double-move, no .bak, byte-identical)

Lifts blueprint/project installer_migration axis from 0.0 to ~1.0."
```

Expected: commit succeeds.

---

## Phase 3 — Verification

### Task 3.1: Run full release:preflight

**Files:** none (verification)

- [ ] **Step 1: Run preflight**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -10
```

Expected: exit 0, all tests passing (was 95/95 pre-impl; should be 110/110 with the 15 new asserts).

If any non-impl-1 assert fails: investigate, fix, re-commit. If any impl-1 assert fails: debug fixture or migration order assumption.

### Task 3.2: Refresh coverage matrix + audit

**Files:**
- Modify: `platform/test/coverage-matrix.json`
- Modify: `Docs/plans/2026-06-16-test-coverage-audit.md`

- [ ] **Step 1: Regen + render**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js
```

Expected: both scripts run clean. Note: re-apply the "Picks for this arc (manual override...)" section to the audit md since the renderer always writes the default picks section. Use the same override text from the current audit doc; just re-paste it.

- [ ] **Step 2: Verify project's installer_migration axis lift**

Run:
```bash
node -e 'const m = require("/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json"); const e = m.entries.find(x => x.name === "project"); console.log("project installer_migration:", e.axes.installer_migration.score, "(" + e.axes.installer_migration.covered + "/" + e.axes.installer_migration.total + ")"); console.log("project composite:", e.composite_score.toFixed(3));'
```

Expected: `installer_migration: 1` (was 0.0); covered/total = 5/5; composite up from ~0.617 to ~0.717.

- [ ] **Step 3: Re-apply the override picks section in the audit doc**

Open `Docs/plans/2026-06-16-test-coverage-audit.md`. Find the "## Picks for this arc" section. The renderer regenerates it as the default 3-line stub. Replace with the override block we maintain (refer to the version committed at `0409b1d8`'s state). The override text is preserved in qualitative recommendations but the "Picks for this arc" section needs manual re-application:

Find:
```
## Picks for this arc

- **impl-1**: rank-1 above
- **impl-2**: rank-2 above
- **impl-3**: rank-3 above

If two ranks above belong to the same blueprint, impl-2 = next distinct blueprint OR next gap on the same blueprint when the design's `out of scope` allows — pick whichever maximizes total composite lift.
```

Replace with the same override section already committed at `0409b1d8`. Use `git show 0409b1d8:Docs/plans/2026-06-16-test-coverage-audit.md | tail -40` to see the canonical override block, then paste it in.

- [ ] **Step 4: Commit refresh**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add platform/test/coverage-matrix.json Docs/plans/2026-06-16-test-coverage-audit.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "audit(refresh): post-impl-1 matrix + audit — project installer_migration 0.0 -> 1.0"
```

Expected: commit succeeds.

---

## Phase 4 — Cycle close

### Task 4.1: Write result doc

**Files:**
- Create: `Docs/plans/2026-06-16-test-coverage-impl-1-result.md`

- [ ] **Step 1: Write the result doc**

Create with these contents (substitute `<X>` placeholders with actual measurements after Task 3.2):

```markdown
---
arc: test-coverage-arc
phase: phase-2-impl-1
status: closed
closed_at: 2026-06-16
surface: blueprint/project
axis: installer_migration
archetype: seed-migrate
target_file: platform/test/run-seed-migrations.js
---

# Impl-1 result — project blueprint installer migrations

## What landed
- Seed-vault fixture: `platform/test/seed-vault/spice/projects/Legacy Project/` (5 files at pre-migration shape)
- Harness extension: 15 new sub-asserts in `platform/test/run-seed-migrations.js`
  - HC-V01190-PROJ-SEED-MIGRATE-A1..A3 (sections migration)
  - HC-V01190-PROJ-SEED-MIGRATE-B1..B4 (sections-hub migration)
  - HC-V01190-PROJ-SEED-MIGRATE-C1 (close-repair)
  - HC-V01190-PROJ-SEED-MIGRATE-D1 (empty-wikilink-repair)
  - HC-V01190-PROJ-SEED-MIGRATE-E1..E2 (to-do backfill)
  - HC-V01190-PROJ-SEED-MIGRATE-F1..F4 (idempotency)

## Composite lift
- Pre-impl-1 project composite: <fill-in>
- Post-impl-1 project composite: <fill-in>
- Delta: +<fill-in> (installer_migration axis 0.0 -> 1.0)

The +0.10 lift is short of the design's +0.15 heuristic; documented as calibrated outcome, not failure. A single axis fix can't lift composite by 0.15 unless multiple axes were near-zero; project had only one near-zero axis.

## Preflight
- exit 0, <N>/<N> green

## Lessons / discoveries
- (fill in during execution)

## Carry-forwards
- impl-2 picks up next: finance / installer_migration / seed-migrate (23 untested apply* fns)
- rebaseline-seed.js post-arc behavior: Legacy Project will move to post-migration shape on rebaseline. Asserts will still pass (they check post-state); no script change required.
- Whatever surprises showed up during impl (fill in)
```

- [ ] **Step 2: Commit**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/plans/2026-06-16-test-coverage-impl-1-result.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(impl-1): result doc — project installer_migration 0.0 -> 1.0, 15 asserts green"
```

### Task 4.2: Write post-impl-1 handoff prompt

**Files:**
- Create: `Docs/prompts/2026-06-16-post-impl-1-handoff.md`

- [ ] **Step 1: Write the handoff**

Create with these contents:

```markdown
---
phase_closed: phase-2-impl-1
phase_next: phase-3-impl-2
worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
branch: feature/test-coverage-arc
arc_design: Docs/plans/2026-06-16-test-coverage-arc-design.md
arc_plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
audit_doc: Docs/plans/2026-06-16-test-coverage-audit.md
audit_matrix: platform/test/coverage-matrix.json
impl_1_design: Docs/plans/2026-06-16-test-coverage-impl-1-design.md
impl_1_plan: Docs/plans/2026-06-16-test-coverage-impl-1-plan.md
impl_1_result: Docs/plans/2026-06-16-test-coverage-impl-1-result.md
---

# Resume here — Phase 2 (impl-1) closed, Phase 3 (impl-2) next

## Where you are
- Worktree: `/Users/willfellhoelter/projects/repos/sauce-test-coverage`
- Branch: `feature/test-coverage-arc`
- Just closed: Phase 2 — impl-1 (project installer_migration)
- Current preflight: exit 0, <N>/<N> green
- Workshop version: 0.119.0 (no bump in this arc)

## What just shipped (impl-1)
- See impl-1-result.md for full deliverables + lessons

## Top-3 picks status
- impl-1: blueprint/project / installer_migration / seed-migrate — DONE
- impl-2: blueprint/finance / installer_migration / seed-migrate — NEXT
- impl-3: mechanism/entity-create / installer_migration / seed-migrate — QUEUED

## What's next — Phase 3 (impl-2)
- Open the arc plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
- Jump to Phase 3 section
- Instantiate with: SURFACE=blueprint/finance, AXIS=installer_migration, ARCHETYPE=seed-migrate, TARGET_FILE=platform/test/run-seed-migrations.js
- Skill to invoke first: brainstorming OR (since the gap is well-bounded — 23 finance apply* fns) write design inline like impl-1
- Then writing-plans -> impl-2 plan
- Then subagent-driven-development to execute
- Phase 4 (impl-3 / entity-create) follows the same pattern

## Hard constraints
- Stay in the worktree
- No per-phase PRs (one giant PR at arc close)
- Re-read arc-design.md if anything feels ambiguous
- Pause for user review between phases — but execute the full phase before pausing
- No emojis in committed files
- No Co-Authored-By Claude trailer

## Carry-forwards
- Audit doc "Picks for this arc" section needs MANUAL re-apply after every regen+render (renderer writes the default 3-line stub). Address in v1.1.0 rubric revision by promoting the override to a sidecar JSON the renderer reads.
- impl-2 fixture authoring will be larger (23 fns); allocate accordingly. Likely break into a Legacy Finance Hub fixture covering 5+ migrations and incremental smaller fixtures for the remaining.
- impl-3 (entity-create) is smaller (2 fns); should fit in the same shape as impl-1.

## Pointers
- Arc design: Docs/plans/2026-06-16-test-coverage-arc-design.md
- Arc plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
- Audit: Docs/plans/2026-06-16-test-coverage-audit.md
- Preflight: npm run release:preflight
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/prompts/2026-06-16-post-impl-1-handoff.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(handoff): post-impl-1 handoff with impl-2 (finance) picks"
```

### Task 4.3: Final state confirmation

**Files:** none

- [ ] **Step 1: Confirm clean state + commit count**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage status
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage log --oneline main..HEAD | wc -l
```

Expected: clean working tree; commit count = pre-impl + 4 commits (1 fixture, 1 harness, 1 audit refresh, 2 docs = 5).

- [ ] **Step 2: Final preflight**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight 2>&1 | tail -3
```

Expected: exit 0, <N>/<N> green.

---

## Self-review

1. **Spec coverage**: every section of impl-1-design.md is implemented:
   - "Seed-vault extensions" → Tasks 1.1-1.5
   - "Asserts added" sub-families A-F → Tasks 2.2-2.7
   - "Composite-lift target" measurement → Task 3.2
   - "Risks + mitigations" (rebaseline-seed.js) → covered by design analysis; no script change needed; documented in handoff carry-forwards
   - "Done criteria" → all 8 checked by Tasks 3.1, 3.2, 4.1, 4.2

2. **Placeholder scan**: `<fill-in>` markers appear ONLY in result doc placeholders that get populated at execution time from real measurements — acceptable. No "TBD" / "implement later" elsewhere.

3. **Type consistency**:
   - Variable names: `aLegacyProjFm`, `bDocsBody`, `bCustomNoteFm`, `cLegacyBody`, `dBadLinkFm`, `eTodoPath`, `eTodoBody`, `fOldNoteStill`, etc. — letter-prefixed by sub-family for grep-ability; no clashes
   - Helper function calls: `helpers.parseFrontmatter`, `helpers.readNote`, `fs.existsSync`, `fs.readFileSync` — used consistently
   - Constant: `LEGACY_PROJ_DIR` defined once in Task 2.2, referenced in every sub-family

4. **Idempotency block (Task 2.7)**: depends on the existing harness's `vault2` variable for the second-install state. Task 2.7 Step 1 verifies this; if the variable is named differently (e.g. `secondInstallVault`), the implementer must use that name.

## Execution

I'll proceed directly with `superpowers:subagent-driven-development` per the arc's strict-phase-gating model and the user's "don't report back until done" directive.
