# Scratch day-hub button row + Daily Dashboard board activity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two changes specified in `Docs/plans/2026-05-20-scratch-buttons-board-activity-design.md`: (1) merge `+ New Scratch` and `Hub` into one centered flex row on scratch day-hub notes; (2) surface `spice/boards/To-Do-Board.md` activity in the Daily Dashboard Activity panel via a rolled-up card.

**Architecture:** Two scoped helper-source edits (`scratch-day-actions.js`, `space-daily-dashboard.js`), one template edit (`Scratch Day Hub.md`), two manifest edits (`scratch/manifest.json`, `daily/manifest.json`), plus one mechanism-level enabler: make `new_entity_buttons[].render_in` optional in the installer validator + schema so blueprints can keep an entity-create spec in the registry without auto-injecting a hub-block (entity-create@0.4.0 MINOR). All changes live in the workshop source tree under `platform/`; the workshop self-installs via `sauce update --vault $(pwd)` to materialize into `ranch/`. Regression guards added to `platform/test/run-helper-cases.js` + `platform/test/run-entity-create.js`.

**Tech Stack:** Node ≥18 (test harnesses, installer), Obsidian + Dataview + CustomJS (runtime), JSON-Schema draft-07 (entity-create schema).

---

## File Structure

**Modify:**

- `platform/install.js` — make `render_in` optional in `resolveEntityCreateEntry` validator; materializer loop already short-circuits cleanly on absent `render_in`.
- `platform/mechanisms/entity-create/schema/new-entity-buttons.json` — drop `render_in` from `required[]`.
- `platform/mechanisms/entity-create/manifest.json` — bump `version` to `0.4.0`, append v0.4.0 changelog stanza to `description`.
- `platform/blueprints/scratch/helpers/scratch-day-actions.js` — extend `render(dv)` to draw both `+ New Scratch` and `Hub` buttons into the existing flex row.
- `platform/blueprints/scratch/templates/Scratch Day Hub.md` — remove the `entity-create:scratch` dataviewjs block.
- `platform/blueprints/scratch/manifest.json` — remove `render_in` from `new_entity_buttons[0]`; bump `version` to `0.5.0`; append v0.5.0 changelog stanza.
- `platform/blueprints/daily/helpers/space-daily-dashboard.js` — add `kanban` + `board-card` to `_DEFAULT_DASHBOARD_BLUEPRINTS`, add `kanban` color to `_BLUEPRINT_COLORS`, add a kanban rollup rule to `_ROLLUP_RULES`.
- `platform/blueprints/daily/manifest.json` — bump `version` to `0.9.0`; append v0.9.0 changelog stanza.
- `platform/test/run-helper-cases.js` — add SHC-S12 (scratch-day-actions delegates to EntityCreate.create), SHC-S13 (Scratch Day Hub no longer contains `entity-create:scratch` sentinel), DD-A7 (allowlist includes kanban + board-card), DD-A8 (rollup rule for kanban with hardcoded To-Do-Board path).
- `platform/test/run-entity-create.js` — add EC-31 (render_in absent → entry validates and resolves; no render_in field on result).

**No file is created.** No deletions beyond the template-block removal.

---

## Task 1 — Make `render_in` optional in entity-create validator + schema

Pre-work for the scratch manifest change in Task 5. Without this, dropping `render_in` from `platform/blueprints/scratch/manifest.json` fails install with `"missing render_in"`.

**Files:**
- Modify: `platform/install.js:2256` (validator)
- Modify: `platform/install.js:2325` (resolved-entry render_in pass-through)
- Modify: `platform/mechanisms/entity-create/schema/new-entity-buttons.json:8` (required[])
- Test:   `platform/test/run-entity-create.js` (new EC-31 case)

### Step 1.1: Read existing EC test patterns (locate insertion point)

- [ ] **Step 1.1.1: Read the file at the EC-29 boundary**

Run:
```bash
grep -n "EC-29\|EC-30\b" /Users/willfellhoelter/projects/repos/sauce/platform/test/run-entity-create.js
```
Expected: at least one line number for EC-29. Read 30 lines starting at that line to see the test-case template + how `history` and `ok(...)` are used.

### Step 1.2: Write the failing EC-31 test

- [ ] **Step 1.2.1: Open `platform/test/run-entity-create.js`, locate the EC-29 case, and append a new EC-31 case immediately after it**

Add this test case (adjust the trailing comma if EC-29 is followed by another case — paste before the next case if so):

```javascript
// 31. resolveEntityCreateEntry: render_in absent → entry validates; resolved has no render_in
{
    const history = [];
    const variables = { templates_path: "ranch/templates", module_directory: "spice/foo" };
    const entry = {
        id: "foo",
        label: "+ New Foo",
        prompts: [],
        destination: { folder_prefix: "spice/foo", filename_prefix: "Foo-" },
        frontmatter_template: { type: "foo" },
        // render_in intentionally absent
    };
    const r = resolveEntityCreateEntry(entry, variables, history, "test-foo");
    ok("EC-31 resolveEntityCreateEntry: render_in absent returns resolved entry (no validation failure)",
        r !== null && typeof r === "object",
        `r=${JSON.stringify(r)} history=${JSON.stringify(history)}`);
    ok("EC-31 resolved entry has no render_in field when source had none",
        r && !("render_in" in r),
        `keys=${r ? Object.keys(r).join(",") : "(null)"}`);
    ok("EC-31 no validation-failure history rows for the absent render_in",
        !history.some(h => /render_in/.test(h.reason || "")),
        `history=${JSON.stringify(history)}`);
}
```

> If `resolveEntityCreateEntry` is not directly importable in this test file, mirror the import pattern that EC-29 uses (search above EC-29 for `require(` of install.js or a re-export wrapper).

- [ ] **Step 1.2.2: Run the test to verify it fails**

Run:
```bash
node platform/test/run-entity-create.js
```
Expected: FAIL with `EC-31` rows showing `r === null` and a history entry like `"missing render_in"`.

### Step 1.3: Patch the validator

- [ ] **Step 1.3.1: Edit `platform/install.js` line 2256 region**

Replace this block (currently three lines):

```javascript
  if (!entry.render_in || typeof entry.render_in !== "object") return fail("missing render_in");
  if (entry.render_in.kind !== "hub" && entry.render_in.kind !== "nav_buttons") {
    return fail(`render_in.kind must be "hub" or "nav_buttons"`);
  }
  if (entry.render_in.kind === "hub" && (typeof entry.render_in.target_path !== "string" || entry.render_in.target_path.length === 0)) {
    return fail(`render_in.kind="hub" requires target_path`);
  }
```

With:

```javascript
  // v0.4.0 (entity-create MINOR): render_in is optional. Entries with no render_in
  // are registry-only — EntityCreate.create() dispatch works because the spec is
  // still materialized into ranch/entity-create-registry.json; the materializer
  // loop above simply skips the injection call when render_in is absent. Useful
  // when a blueprint renders the button itself (e.g., scratch's ScratchDayActions
  // hosts the button inside a custom flex row).
  if (entry.render_in !== undefined && entry.render_in !== null) {
    if (typeof entry.render_in !== "object") return fail("render_in must be an object when present");
    if (entry.render_in.kind !== "hub" && entry.render_in.kind !== "nav_buttons") {
      return fail(`render_in.kind must be "hub" or "nav_buttons"`);
    }
    if (entry.render_in.kind === "hub" && (typeof entry.render_in.target_path !== "string" || entry.render_in.target_path.length === 0)) {
      return fail(`render_in.kind="hub" requires target_path`);
    }
  }
```

- [ ] **Step 1.3.2: Edit `platform/install.js` line 2325 region (resolved-entry pass-through)**

Find this block (around line 2325):

```javascript
  if (entry.render_in.kind === "hub") {
    resolved.render_in = {
      ...entry.render_in,
      target_path: substituteLenient(entry.render_in.target_path, variables),
    };
  }
```

Replace with:

```javascript
  if (entry.render_in && entry.render_in.kind === "hub") {
    resolved.render_in = {
      ...entry.render_in,
      target_path: substituteLenient(entry.render_in.target_path, variables),
    };
  }
```

(Just guards against accessing `.kind` when `entry.render_in` is undefined. The resolved spread `...entry` already copies absent fields as absent.)

### Step 1.4: Update the schema

- [ ] **Step 1.4.1: Edit `platform/mechanisms/entity-create/schema/new-entity-buttons.json` line 8**

Change:

```json
    "required": ["id", "label", "prompts", "destination", "frontmatter_template", "render_in"],
```

To:

```json
    "required": ["id", "label", "prompts", "destination", "frontmatter_template"],
```

### Step 1.5: Re-run the EC test suite

- [ ] **Step 1.5.1: Run EC tests and confirm green**

Run:
```bash
node platform/test/run-entity-create.js
```
Expected: all cases PASS including EC-29 (still asserts `render_in: { kind: "bogus" }` returns null) and the new EC-31 (absent render_in returns a resolved entry).

### Step 1.6: Bump entity-create mechanism version

- [ ] **Step 1.6.1: Edit `platform/mechanisms/entity-create/manifest.json`**

Change `"version": "0.3.2"` to `"version": "0.4.0"`. Append this stanza to the `description` field (after the existing v0.3.2 trailer; preserve all existing description content):

```
 v0.4.0 MINOR (v0.68.0): new_entity_buttons[].render_in is now optional in both the JSON schema and the installer's resolveEntityCreateEntry validator. Entries with no render_in are registry-only — the materializer's injection loop short-circuits cleanly, EntityCreate.create() dispatch still works (registry stays populated). Enables blueprints to own button rendering when a custom flex-row layout is required (scratch v0.5.0 uses this to host both '+ New Scratch' and 'Hub' inside one ScratchDayActions-drawn row).
```

### Step 1.7: Commit

- [ ] **Step 1.7.1: Stage + commit**

```bash
git add platform/install.js \
        platform/mechanisms/entity-create/schema/new-entity-buttons.json \
        platform/mechanisms/entity-create/manifest.json \
        platform/test/run-entity-create.js
git commit -m "$(cat <<'EOF'
feat(entity-create): v0.4.0 — render_in is optional

Validator + JSON schema now permit new_entity_buttons[] entries with no
render_in. Such entries are registry-only — EntityCreate.create()
dispatch still works because the spec is materialized into
ranch/entity-create-registry.json; the installer's injection loop
short-circuits when render_in is absent. Enables blueprints to host
buttons inside custom row layouts (scratch v0.5.0 will use this).

EC-31 regression guard added.
EOF
)"
```

---

## Task 2 — Extend ScratchDayActions to render both buttons in one row

**Files:**
- Modify: `platform/blueprints/scratch/helpers/scratch-day-actions.js`
- Test:   `platform/test/run-helper-cases.js` (new SHC-S12 case)

### Step 2.1: Add SHC-S12 regression test

- [ ] **Step 2.1.1: Locate SHC-S11-scratch-day-actions in `run-helper-cases.js`**

Run:
```bash
grep -n "caseSHCS11ScratchDayActionsNoNewScratch\b" /Users/willfellhoelter/projects/repos/sauce/platform/test/run-helper-cases.js
```
Note the line numbers for the function definition AND its registration in the runner. Read 30 lines around each to confirm the pattern.

- [ ] **Step 2.1.2: Append a new SHC-S12 case after SHC-S11-scratch-day-actions**

Add this function next to the SHC-S11 cluster:

```javascript
async function caseSHCS12ScratchDayActionsRowOfTwo() {
  console.log("\n--- Case SHC-S12: scratch-day-actions.js renders + New Scratch + Hub in one flex row ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "helpers", "scratch-day-actions.js");
  assertTrue("SHC-S12: source file exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  const newScratchLabel = /label:\s*["']\+ New Scratch["']/.test(body);
  const hubLabel = /label:\s*["']Hub["']/.test(body);
  const delegatesToEntityCreate = /customJS\.EntityCreate\.create\(\s*\{\s*instance:\s*["']scratch["']/.test(body);
  const flexRow = /display:\s*flex.*max-width:\s*600px/.test(body);
  const bothFlexTrue = (body.match(/flex:\s*true/g) || []).length >= 2;
  const ok = newScratchLabel && hubLabel && delegatesToEntityCreate && flexRow && bothFlexTrue;
  assertTrue("SHC-S12: scratch-day-actions.js missing new-scratch+hub flex-row pair or EntityCreate delegate", ok);
}
```

- [ ] **Step 2.1.3: Register the new case in the runner**

Find the function `runAllCases` (or whatever top-level dispatcher this file uses) — `grep -n "caseSHCS11ScratchDayActionsNoNewScratch\(\)" /Users/willfellhoelter/projects/repos/sauce/platform/test/run-helper-cases.js`. After the registration line for the SHC-S11 cluster, insert:

```javascript
  await caseSHCS12ScratchDayActionsRowOfTwo();
```

- [ ] **Step 2.1.4: Run the test; verify it fails**

Run:
```bash
node platform/test/run-helper-cases.js
```
Expected: FAIL on SHC-S12 — the source file does not yet contain the second `flex: true` button nor the EntityCreate.create call.

### Step 2.2: Patch ScratchDayActions

- [ ] **Step 2.2.1: Edit `platform/blueprints/scratch/helpers/scratch-day-actions.js`**

Replace the entire file body with:

```javascript
/**
 * ScratchDayActions (CustomJS)
 * Renders the '+ New Scratch' and 'Hub' accent buttons in a single centered
 * flex row on a scratch day-hub note. The '+ New Scratch' click delegates to
 * customJS.EntityCreate.create({ instance: "scratch", dv }) — same dispatch
 * the entity-create mechanism uses; only the rendering is owned here so both
 * buttons share one row with identical flex styling.
 *
 * Empties dv.container before rendering to avoid Dataview's dual-fire
 * lifecycle producing duplicated button rows. Tolerates `day` frontmatter
 * as string, Date, or Luxon — normalizes to YYYY-MM-DD before validation.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", { class: "ScratchDayActions" });
 */
class ScratchDayActions {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        if (raw instanceof Date && !isNaN(raw)) {
            const y = raw.getFullYear();
            const m = String(raw.getMonth() + 1).padStart(2, "0");
            const d = String(raw.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        }
        return null;
    }

    async _pollForDay(dv) {
        let day = this._coerceDay(dv.current().day);
        for (let i = 0; i < 40 && (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)); i++) {
            await new Promise(r => setTimeout(r, 50));
            day = this._coerceDay(dv.current().day);
        }
        return day;
    }

    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;

        const myGen = (dv.container.__scratchRenderGen || 0) + 1;
        dv.container.__scratchRenderGen = myGen;
        const isStale = () => dv.container.__scratchRenderGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = await this._pollForDay(dv);
        if (isStale()) return;
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            dv.paragraph("ScratchDayActions: missing or invalid `day` frontmatter (expected YYYY-MM-DD).");
            return;
        }

        const mo = window.moment(day, "YYYY-MM-DD", true);
        if (!mo.isValid()) {
            dv.paragraph(`ScratchDayActions: invalid day value "${day}".`);
            return;
        }

        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        const pencilPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="23" y1="5" x2="17" y2="5"/></svg>`;

        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

        const createScratch = () => {
            if (!customJS || !customJS.EntityCreate || typeof customJS.EntityCreate.create !== "function") {
                new Notice("ScratchDayActions: EntityCreate mechanism unavailable.", 8000);
                return;
            }
            customJS.EntityCreate.create({ instance: "scratch", dv });
        };
        const goToHub = () => {
            app.workspace.openLinkText("spice/scratch/Scratch.md", "");
        };

        customJS.AccentButton.render(row, { label: "+ New Scratch", icon: pencilPlusIcon, onClick: createScratch, flex: true });
        customJS.AccentButton.render(row, { label: "Hub", icon: homeIcon, onClick: goToHub, flex: true });
    }
}
```

- [ ] **Step 2.2.2: Run the test; verify it passes**

Run:
```bash
node platform/test/run-helper-cases.js
```
Expected: SHC-S12 PASSES. SHC-S11-scratch-day-actions still PASSES (it only asserts `newScratch` method-name absence; our new arrow `createScratch` doesn't trigger the `\bnewScratch\s*\(/` regex).

### Step 2.3: Commit

- [ ] **Step 2.3.1: Stage + commit**

```bash
git add platform/blueprints/scratch/helpers/scratch-day-actions.js \
        platform/test/run-helper-cases.js
git commit -m "$(cat <<'EOF'
feat(scratch): ScratchDayActions renders + New Scratch + Hub in one row

Both buttons share a single centered flex row with flex: true (max-width
600px). The + New Scratch click delegates to
customJS.EntityCreate.create({ instance: "scratch", dv }) so the
registry-driven prompts / frontmatter / routing all stay in entity-create.

SHC-S12 regression guard added.
EOF
)"
```

---

## Task 3 — Remove the entity-create:scratch dataviewjs block from Scratch Day Hub

**Files:**
- Modify: `platform/blueprints/scratch/templates/Scratch Day Hub.md`
- Test:   `platform/test/run-helper-cases.js` (new SHC-S13 case)

### Step 3.1: Add SHC-S13 regression test

- [ ] **Step 3.1.1: Append after SHC-S12**

Add this function:

```javascript
async function caseSHCS13ScratchDayHubNoEntityCreateBlock() {
  console.log("\n--- Case SHC-S13: Scratch Day Hub.md no longer carries the entity-create:scratch sentinel ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "templates", "Scratch Day Hub.md");
  assertTrue("SHC-S13: Scratch Day Hub.md exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S13: Scratch Day Hub.md must NOT contain `// entity-create:scratch` sentinel (block ownership moved to ScratchDayActions in scratch v0.5.0)",
    !/\/\/\s*entity-create:scratch\b/.test(body));
  assertTrue("SHC-S13: Scratch Day Hub.md must NOT call customJS.EntityCreate.render (button is rendered by ScratchDayActions)",
    !/customJS\.EntityCreate\.render/.test(body));
  assertTrue("SHC-S13: ScratchDayActions block still present (Task 2 regression)",
    /class:\s*"ScratchDayActions"/.test(body));
}
```

- [ ] **Step 3.1.2: Register the case in the runner**

Insert after the registration line for `caseSHCS12ScratchDayActionsRowOfTwo`:

```javascript
  await caseSHCS13ScratchDayHubNoEntityCreateBlock();
```

- [ ] **Step 3.1.3: Run the test; verify it fails**

Run:
```bash
node platform/test/run-helper-cases.js
```
Expected: FAIL on SHC-S13 — the template still contains the sentinel + the EntityCreate.render call.

### Step 3.2: Edit the template

- [ ] **Step 3.2.1: Edit `platform/blueprints/scratch/templates/Scratch Day Hub.md`**

The current file body is:

```
---
type: scratch-day
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
---

# <% tp.date.now("dddd, MMMM Do YYYY") %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
// entity-create:scratch — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "scratch" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ScratchDayActions" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ScratchDayList", args: [{ day: dv.current().day }] });
```
```

Replace the whole file with:

```
---
type: scratch-day
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
---

# <% tp.date.now("dddd, MMMM Do YYYY") %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ScratchDayActions" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ScratchDayList", args: [{ day: dv.current().day }] });
```
```

(One whole dataviewjs block removed; the surviving `ScratchDayActions` block sits between the two `---` rulers.)

- [ ] **Step 3.2.2: Run the test; verify it passes**

Run:
```bash
node platform/test/run-helper-cases.js
```
Expected: SHC-S13 PASSES. SHC-S3 still PASSES (still finds ScratchDayActions + ScratchDayList).

### Step 3.3: Commit

- [ ] **Step 3.3.1: Stage + commit**

```bash
git add platform/blueprints/scratch/templates/Scratch\ Day\ Hub.md \
        platform/test/run-helper-cases.js
git commit -m "$(cat <<'EOF'
feat(scratch): drop entity-create:scratch dataviewjs block from day-hub template

ScratchDayActions now hosts both '+ New Scratch' and 'Hub' inside one
flex row (see scratch helper v0.5.0). The legacy entity-create
dataviewjs block + sentinel comment are removed; the entity-create
registry entry stays intact (Task 4 drops render_in from the manifest).

SHC-S13 regression guard added.
EOF
)"
```

---

## Task 4 — Drop `render_in` from scratch manifest + version-bump scratch blueprint

**Files:**
- Modify: `platform/blueprints/scratch/manifest.json`

### Step 4.1: Edit the manifest

- [ ] **Step 4.1.1: Read the current scratch manifest**

Run:
```bash
grep -n "version\|render_in\|new_entity_buttons" /Users/willfellhoelter/projects/repos/sauce/platform/blueprints/scratch/manifest.json
```
Expected: `"version": "0.4.1"` near top; `"new_entity_buttons": [` around line 109; `"render_in": { "kind": "hub", "target_path": "{{templates_path}}/Scratch Day Hub.md" }` inside the entry.

- [ ] **Step 4.1.2: Bump version**

Change `"version": "0.4.1"` → `"version": "0.5.0"`.

- [ ] **Step 4.1.3: Append v0.5.0 changelog stanza to `description`**

Append (preserving existing description body):

```
 v0.5.0 MINOR (v0.68.0): scratch day-hub button row consolidation. ScratchDayActions now hosts BOTH '+ New Scratch' and 'Hub' inside a single centered flex row (max-width 600px, gap: 12px, flex: 1 per button). Scratch Day Hub.md template loses its entity-create:scratch dataviewjs block; the new-scratch click is wired by ScratchDayActions delegating to customJS.EntityCreate.create({ instance: "scratch", dv }), so the registry / prompts / frontmatter / destination routing all stay in entity-create. manifest's new_entity_buttons[0] drops render_in (now optional per entity-create v0.4.0 — registry-only entry); the EntityCreate.create dispatch path is unaffected. depends_on entity-create >=0.4.0.
```

- [ ] **Step 4.1.4: Drop `render_in` from `new_entity_buttons[0]`**

The current `new_entity_buttons[0]` ends with these two lines (line numbers approximate):

```json
      "inline_body": "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n---\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"ScratchLeafActions\" });\n```\n\n---\n",
      "render_in": { "kind": "hub", "target_path": "{{templates_path}}/Scratch Day Hub.md" }
```

Replace those two lines with just the `inline_body` line (drop trailing comma since it becomes the last property):

```json
      "inline_body": "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n---\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"ScratchLeafActions\" });\n```\n\n---\n"
```

- [ ] **Step 4.1.5: Add an entity-create version dependency**

Find the `depends_on` array. Currently `accent-button` is the highest version it depends on (`>=0.1.0`). Add a new entry (or update if present):

```json
    {
      "name": "entity-create",
      "range": ">=0.4.0"
    },
```

Insert it alongside the other depends_on items in alphabetical or arbitrary-but-consistent order matching the rest of the file (the file uses no specific sort; place it after the existing `accent-button` entry).

- [ ] **Step 4.1.6: Validate the manifest parses**

Run:
```bash
node -e 'JSON.parse(require("fs").readFileSync("platform/blueprints/scratch/manifest.json", "utf8"))' && echo OK
```
Expected: prints `OK`.

### Step 4.2: Re-run the EC + helper test suites

- [ ] **Step 4.2.1: Run both suites and confirm green**

Run:
```bash
node platform/test/run-entity-create.js && node platform/test/run-helper-cases.js
```
Expected: all cases PASS.

### Step 4.3: Commit

- [ ] **Step 4.3.1: Stage + commit**

```bash
git add platform/blueprints/scratch/manifest.json
git commit -m "$(cat <<'EOF'
feat(scratch): v0.5.0 — drop render_in from new_entity_buttons[]

Scratch blueprint stops auto-injecting the entity-create:scratch hub
block; ScratchDayActions now owns the row (see scratch helper /
templates / scratch v0.4.0 → v0.5.0). The entity-create spec stays
materialized into ranch/entity-create-registry.json — only the
template injection is suppressed. depends_on entity-create >=0.4.0.
EOF
)"
```

---

## Task 5 — Add board activity to SpaceDailyDashboard

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js`
- Test:   `platform/test/run-helper-cases.js` (new DD-A7 + DD-A8 cases)

### Step 5.1: Add DD-A7 + DD-A8 regression tests

- [ ] **Step 5.1.1: Locate DD-A6 in `run-helper-cases.js`**

Run:
```bash
grep -n "caseDDA[0-9]" /Users/willfellhoelter/projects/repos/sauce/platform/test/run-helper-cases.js
```
Note the line numbers for the existing DD-A cases (DD-A1..DD-A6) and the runner registrations.

- [ ] **Step 5.1.2: Append DD-A7 + DD-A8 functions next to the DD-A cluster**

Add these two cases after the existing DD-A6:

```javascript
async function caseDDA7DashboardAllowlistIncludesBoards() {
  // v0.9.0 (sauce v0.68.0): _DEFAULT_DASHBOARD_BLUEPRINTS adds kanban + board-card
  // so board activity (hub edits + new card creations) surfaces in the daily
  // Activity panel. board-card rolls up into the kanban hub via _ROLLUP_RULES.
  console.log("\n--- Case DD-A7: dashboard allowlist includes kanban + board-card ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  const getterMatch = body.match(/_DEFAULT_DASHBOARD_BLUEPRINTS\s*\(\)\s*\{[\s\S]*?return\s*\[([\s\S]*?)\]/);
  if (!getterMatch) {
    assertTrue("DD-A7: _DEFAULT_DASHBOARD_BLUEPRINTS getter not found", false);
    return;
  }
  const listSource = getterMatch[1];
  const hasKanban = /"kanban"/.test(listSource);
  const hasBoardCard = /"board-card"/.test(listSource);
  assertTrue("DD-A7: allowlist missing kanban or board-card", hasKanban && hasBoardCard);
}

async function caseDDA8DashboardKanbanRollupRule() {
  // v0.9.0 (sauce v0.68.0): _ROLLUP_RULES adds a kanban rule with hardcoded
  // rootPathFromDv returning "spice/boards/To-Do-Board.md". board-card files
  // under spice/boards/cards/** coalesce into a single rolled-up "To Do Board"
  // activity card.
  console.log("\n--- Case DD-A8: dashboard rollup rules include single-board kanban entry ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  const rulesMatch = body.match(/_ROLLUP_RULES\s*\(\)\s*\{[\s\S]*?return\s*\[([\s\S]*?)\];/);
  if (!rulesMatch) {
    assertTrue("DD-A8: _ROLLUP_RULES getter not found", false);
    return;
  }
  const rulesSource = rulesMatch[1];
  const hasKanbanType = /type:\s*["']kanban["']/.test(rulesSource);
  const hasBoardsChildGlob = /\/\^spice\\\/boards\\\/cards\\\//.test(rulesSource);
  const hasTodoBoardRoot = /spice\/boards\/To-Do-Board\.md/.test(rulesSource);
  assertTrue("DD-A8: kanban rollup rule missing type:'kanban' or boards-card child match or To-Do-Board root path",
    hasKanbanType && hasBoardsChildGlob && hasTodoBoardRoot);
}
```

- [ ] **Step 5.1.3: Register both cases in the runner**

After the registration line for DD-A6, insert:

```javascript
  await caseDDA7DashboardAllowlistIncludesBoards();
  await caseDDA8DashboardKanbanRollupRule();
```

- [ ] **Step 5.1.4: Run the tests; verify they fail**

Run:
```bash
node platform/test/run-helper-cases.js
```
Expected: FAIL on DD-A7 + DD-A8 (allowlist + rollup rules don't yet include kanban).

### Step 5.2: Patch SpaceDailyDashboard

- [ ] **Step 5.2.1: Add "kanban" + "board-card" to `_DEFAULT_DASHBOARD_BLUEPRINTS`**

Edit `platform/blueprints/daily/helpers/space-daily-dashboard.js`. Find the getter that returns the allowlist (around line 367). It looks like:

```javascript
    return [
      "scratch", "journal",
      "project", "person", "team", "product", "trip",
      "budget", "paycheck", "invoice",
      "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
      "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review"
    ];
```

Replace with:

```javascript
    return [
      "scratch", "journal",
      "project", "person", "team", "product", "trip",
      "budget", "paycheck", "invoice",
      "kanban", "board-card",
      "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
      "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review"
    ];
```

- [ ] **Step 5.2.2: Add `kanban` color to `_BLUEPRINT_COLORS`**

Find the `_BLUEPRINT_COLORS` getter (around line 382). Inside the returned object, after the line:

```javascript
      invoice:   "var(--color-green)",
```

Add:

```javascript
      kanban:    "var(--color-pink)",
```

(`board-card` does not need its own entry — it always rolls up to `kanban`. If a future change drops the rollup rule, add a pill color for board-card then.)

- [ ] **Step 5.2.3: Add the kanban rollup rule to `_ROLLUP_RULES`**

Find the `_ROLLUP_RULES` getter (around line 425). It returns an array currently with two rules: `project` and `trip`. Append a third entry inside the array, just before the closing `];`:

```javascript
      {
        type: "kanban",
        childMatchTemplate: (path) => /^spice\/boards\/cards\//.test(path),
        rootPathFromDv: (_dv, _p) => "spice/boards/To-Do-Board.md",
        excludeTemplate: (name) => typeof name === "string" && /^Template,/i.test(name),
      },
```

So the array now reads `[ project-rule, trip-rule, kanban-rule ]`.

- [ ] **Step 5.2.4: Update the file's top-of-file changelog comment**

The file has a block comment listing version stanzas (v0.2.0, v0.2.1, v0.2.6, v0.3.0..v0.8.x). Append a new stanza at the END of the comment block, immediately before the `*/`:

```
 *
 * v0.9.0 (sauce v0.68.0): board activity in the daily Activity panel.
 *  - _DEFAULT_DASHBOARD_BLUEPRINTS adds "kanban" + "board-card" — the boards
 *    blueprint's two surfaced types (single hub at spice/boards/To-Do-Board.md
 *    + per-card files under spice/boards/cards/YYYY/MM-MMMM/<title>.md).
 *  - _BLUEPRINT_COLORS gains kanban: var(--color-pink). board-card has no entry
 *    because it always rolls up.
 *  - _ROLLUP_RULES gains a third rule that funnels any page under
 *    spice/boards/cards/ into the hardcoded root path
 *    spice/boards/To-Do-Board.md. Single-board case — rootPathFromDv is a
 *    constant lookup, unlike the project/trip rules which derive the slug
 *    from the child file path.
 *  - Existing _getActivityCount dedup logic (drop direct hits whose path is in
 *    rolledRootPaths, then add synthetic rollup roots) keeps the surface at
 *    one card per board even when both the hub mtime AND card creations match
 *    today. Title resolves via the kanban hub's `title: To Do Board`
 *    frontmatter (existing _resolveTitle.p.title branch). Drill-in row click
 *    handler opens individual card files unchanged.
```

- [ ] **Step 5.2.5: Run the tests; verify they pass**

Run:
```bash
node platform/test/run-helper-cases.js
```
Expected: DD-A7 + DD-A8 PASS. Existing DD-A1..DD-A6 still PASS (none assert allowlist exclusion of kanban; DD-A4 only asserts that scratch-day / to-do / meeting are absent).

### Step 5.3: Commit

- [ ] **Step 5.3.1: Stage + commit**

```bash
git add platform/blueprints/daily/helpers/space-daily-dashboard.js \
        platform/test/run-helper-cases.js
git commit -m "$(cat <<'EOF'
feat(daily): SpaceDailyDashboard v0.9.0 — board activity rollup

Dashboard's Activity panel now surfaces spice/boards/To-Do-Board.md
edits and new board-card creations as one rolled-up 'To Do Board'
activity card. Three changes inside space-daily-dashboard.js:
1. _DEFAULT_DASHBOARD_BLUEPRINTS gains kanban + board-card.
2. _BLUEPRINT_COLORS gains kanban: var(--color-pink).
3. _ROLLUP_RULES gains a single-board entry with hardcoded
   rootPathFromDv → spice/boards/To-Do-Board.md.

DD-A7 + DD-A8 regression guards added.
EOF
)"
```

---

## Task 6 — Bump daily blueprint version

**Files:**
- Modify: `platform/blueprints/daily/manifest.json`

### Step 6.1: Edit the manifest

- [ ] **Step 6.1.1: Read current version**

Run:
```bash
grep -n "version" /Users/willfellhoelter/projects/repos/sauce/platform/blueprints/daily/manifest.json | head -3
```
Expected: `"version": "0.8.3"`.

- [ ] **Step 6.1.2: Bump version**

Change `"version": "0.8.3"` → `"version": "0.9.0"`.

- [ ] **Step 6.1.3: Append v0.9.0 changelog stanza to `description`**

Append (preserving existing description body):

```
 v0.9.0 MINOR (sauce v0.68.0): SpaceDailyDashboard Activity panel now surfaces board activity (spice/boards/To-Do-Board.md hub edits + new board-card creations under spice/boards/cards/**). Three changes: _DEFAULT_DASHBOARD_BLUEPRINTS gains kanban + board-card; _BLUEPRINT_COLORS gains kanban: var(--color-pink); _ROLLUP_RULES gains a single-board entry with hardcoded rootPathFromDv → spice/boards/To-Do-Board.md (constant, unlike the slug-derived project/trip rules). One rolled-up 'To Do Board' card per day; drill-in lists today's touched card files. Title resolves via the existing _resolveTitle.p.title branch from the hub's `title: To Do Board` frontmatter. No new helpers; no CSS changes.
```

- [ ] **Step 6.1.4: Validate the manifest parses**

Run:
```bash
node -e 'JSON.parse(require("fs").readFileSync("platform/blueprints/daily/manifest.json", "utf8"))' && echo OK
```
Expected: prints `OK`.

### Step 6.2: Commit

- [ ] **Step 6.2.1: Stage + commit**

```bash
git add platform/blueprints/daily/manifest.json
git commit -m "$(cat <<'EOF'
feat(daily): v0.9.0 — board activity in Daily Dashboard

Bumps daily blueprint to v0.9.0 to mirror SpaceDailyDashboard's
v0.9.0 source-helper stanza. Description appended with the
board-activity rationale.
EOF
)"
```

---

## Task 7 — Self-install + visual smoke

The workshop dogfoods: changes under `platform/` materialize into `ranch/` via `sauce update --vault $(pwd)`. Until that runs, the consumer surface (the workshop's own Obsidian vault) still sees the pre-change copies.

**Files:**
- (Inspect-only): `ranch/templates/Scratch Day Hub.md`, `ranch/scripts/scratch/scratch-day-actions.js`, `ranch/scripts/daily/space-daily-dashboard.js`, `ranch/entity-create-registry.json`

### Step 7.1: Run the workshop installer

- [ ] **Step 7.1.1: Run `sauce update` against the workshop vault**

Run:
```bash
sauce update --vault /Users/willfellhoelter/projects/repos/sauce
```

> If `sauce` is not on PATH, the equivalent local invocation is `node platform/install.js .` from the workshop root. Confirm with `which sauce` first.

Expected: install completes; ledger prints scratch v0.5.0 and daily v0.9.0 as updated; entity-create v0.4.0 as updated. No `missing_skip_inject` warning for scratch (Task 1 made render_in optional so the materializer loop short-circuits cleanly).

### Step 7.2: Verify materialized files

- [ ] **Step 7.2.1: Confirm ranch reflects the changes**

Run:
```bash
grep -c "entity-create:scratch" /Users/willfellhoelter/projects/repos/sauce/ranch/templates/Scratch\ Day\ Hub.md
```
Expected: `0`.

Run:
```bash
grep "customJS.EntityCreate.create" /Users/willfellhoelter/projects/repos/sauce/ranch/scripts/scratch/scratch-day-actions.js
```
Expected: matches at least one line in the file body (the createScratch arrow's delegate).

Run:
```bash
grep '"kanban"\|"board-card"\|To-Do-Board\.md' /Users/willfellhoelter/projects/repos/sauce/ranch/scripts/daily/space-daily-dashboard.js | head -5
```
Expected: at least three matches (allowlist entries + rollup rootPath).

Run:
```bash
node -e 'const r = JSON.parse(require("fs").readFileSync("ranch/entity-create-registry.json", "utf8")); console.log("scratch entry:", JSON.stringify(r.entries.find(e => e.id === "scratch"), null, 2));'
```
Expected: prints an entry object for scratch with `id`, `label`, `prompts`, `destination`, `frontmatter_template`, `inline_body`. NO `render_in` field.

### Step 7.3: Smoke the scratch button row

This step requires Obsidian. If running headlessly, skip this step and rely on the SHC tests; otherwise:

- [ ] **Step 7.3.1: Open today's scratch day-hub in Obsidian**

Navigate to (or create via the Scratch nav-button) `spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Scratch-Day-<YYYY-MM-DD>.md`. Below the nav-button row, you should see ONE centered row with two buttons: `+ New Scratch` (left) and `Hub` (right), both stretched, both styled with the accent border. Compare against the screenshot in the design doc (`Docs/plans/2026-05-20-scratch-buttons-board-activity-design.md`).

- [ ] **Step 7.3.2: Click each button**

`+ New Scratch` → opens the title prompt; entering a title creates `Scratch-<date>-HH-mm.md` and opens it. `Hub` → opens `spice/scratch/Scratch.md`. Behavior must match pre-change.

### Step 7.4: Smoke the board activity surface

- [ ] **Step 7.4.1: Create a board-card today**

Open `spice/boards/To-Do-Board.md` (the kanban). Add a card via the Kanban plugin's "Add a card" UI in any column. Let Templater spawn the underlying card file under `spice/boards/cards/<YYYY>/<MM-MMMM>/<title>.md`.

- [ ] **Step 7.4.2: Open today's daily note**

Navigate to today's daily note (`spice/daily/<YYYY>/<MM-MMMM>/<dddd-YYYY-MM-DD>.md` or via the Today nav-button). In the SpaceDailyDashboard Activity panel, you should see a card titled "To Do Board" with a `kanban` type pill (pink dot) and a "1 note touched" breadcrumb (or higher count if more cards were added). Clicking the breadcrumb expands a drill-in list with the card filename.

- [ ] **Step 7.4.3: Confirm hub-only edit case**

In the kanban, move an existing card between columns (no new card created). Re-open the daily note. The "To Do Board" activity card should still appear (direct-hit on the hub's mtime).

### Step 7.5: Commit install-ledger changes (if any)

- [ ] **Step 7.5.1: Check for install-ledger drift**

Run:
```bash
git status ranch/
```
Expected: ranch files may show diffs (regenerated by the installer). Stage + commit any tracked ranch files that changed materially. Do NOT stage compiled / generated files unless the repo already tracks them; review the diff first.

- [ ] **Step 7.5.2: Stage + commit (only if there are tracked-file changes)**

```bash
git add -p ranch/
git commit -m "$(cat <<'EOF'
chore(ranch): dogfood install of scratch v0.5.0 + daily v0.9.0 + entity-create v0.4.0
EOF
)"
```

(Skip this step if `git status` shows nothing tracked under `ranch/`.)

---

## Task 8 — Run the broader preflight (release-quality verification)

Use this if you're treating this as a cycle-close-eligible change set. Per `Docs/agent-guides/build-test-verify.md`, the workshop's release preflight runs the full suite.

**Files:**
- (None modified.)

### Step 8.1: Run the release preflight

- [ ] **Step 8.1.1: Run `npm run release:preflight`**

Run:
```bash
npm run release:preflight
```

This invocation runs about 18 test harnesses sequentially: version-sync check, helper-cases, bootstrap, registry, migrate-layout, cli, migrate, audit, claude-surface, renderer, install-sh, cowork-smoke, doctor-self, seed, entity-create, integration-smoke, wiki-to-docs-migration, migrate-frontmatter, validator, backlink-panel, activity-feed, todo-modal.

Expected: ALL tests PASS. If anything fails, surface the failure to the user — most failures here would be pre-existing drift unrelated to this plan, but a new failure tied to one of the touched files needs an inline fix before proceeding.

- [ ] **Step 8.1.2: If preflight green, no commit needed (read-only)**

---

## Self-Review (mental walk-through after writing this plan)

**Spec coverage:**
- Part 1 §"Same-row buttons" — covered by Task 2 (helper edit), Task 3 (template edit), Task 4 (manifest edit + version bump). ✓
- Part 1 §"Installer audit" caveat — covered up-front by Task 1 (validator + schema change), eliminating the warning-on-install footgun. ✓
- Part 2 §"Allowlist + color + rollup" — covered by Task 5 (three additions to one file) + Task 6 (manifest version bump). ✓
- Part 2 §"No template / manifest changes" — Task 5 + 6 satisfy this (no kanban-template or boards-manifest edit). ✓
- Spec §"Test plan" — Task 7 (smoke) + Task 8 (preflight) cover the user-visible verification. ✓

**Placeholder scan:** no TBD / TODO / "implement later" placeholders. All code blocks are concrete. The `var(--color-pink)` choice is explicit and the plan notes that the user can swap colors later as a one-line tweak (Part 2 risk note in the spec).

**Type consistency:** `createScratch` arrow (Task 2) calls `customJS.EntityCreate.create({ instance: "scratch", dv })` — matches the existing entity-create dispatch signature. `_ROLLUP_RULES` rule shape matches the existing project/trip entries (childMatchTemplate / rootPathFromDv / excludeTemplate). Test cases reference correct file paths.

---

## Execution Handoff

Plan complete and saved to `Docs/plans/2026-05-20-scratch-buttons-board-activity-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
