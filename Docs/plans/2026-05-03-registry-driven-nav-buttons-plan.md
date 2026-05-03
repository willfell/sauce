# Registry-Driven Nav-Buttons Implementation Plan (v0.1.1)

> **For the implementing agent:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Refactor `SpaceNavButtons` from a kitchen-sink class with hardcoded accuris paths into a thin renderer over an installer-aggregated registry; add a `createFromTemplate` action so first-click on the project blueprint's "Board" button materializes a working Dataview-driven kanban from a blueprint-shipped template.

**Architecture:** Each mechanism / blueprint manifest declares `nav_buttons[]`. The installer aggregates declarations into `Docs/Meta/nav-buttons-registry.json` namespaced under `contributions.<source>` (mirrors `rule_fragments`). `SpaceNavButtons` v2.0.0 is a thin renderer reading that registry. Two action types in v0.1.1: `openLink` and `createFromTemplate`. Subscription-aware pruning makes the registry self-cleaning.

**Tech Stack:** Templater user scripts (Node desktop), Obsidian Vault API, Dataview (renderer), CustomJS (class registration), JSON for all metadata. No git commits this cycle — each implementer files an execution log to `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T<task>-<slug>.md`.

**Source of truth for design:** `Docs/plans/2026-05-03-registry-driven-nav-buttons-design.md`. Read that first. Code sketches there are normative.

**Stage gates:** S1 → S2 → S3 → S4. Workshop self-install must remain green at every stage close. Bootstrap copies (`platformInstall.js` × 3) re-synced any time `platform/install.js` changes.

---

## Pre-flight

- [ ] Read `Docs/plans/2026-05-03-registry-driven-nav-buttons-design.md` end-to-end.
- [ ] Read `Docs/landmines.md` (non-negotiable, especially #6, #7, #8).
- [ ] Read `Docs/plans/2026-05-02-nav-buttons-and-project-blueprint-design.md` (Stage 1 hardenings C2/C4/E1/E3/L2 — your error-handling posture must match).
- [ ] Confirm working directory is `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault` (per CLAUDE.md identity check).
- [ ] Create execution-log directory: `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/`.

---

## Stage 1 — Installer extensions

> Goal: `platform/install.js` gains `applyNavButtons`, `content_path` variable, subscription-aware pruning, registry malformed-JSON hardening. No mechanism / blueprint behavioral change yet. `workshop_version` 0.3.0 → 0.4.0.

### Task 1.1: Add `content_path` substitution variable

**Files:**
- Modify: `platform/install.js` — substitution map + `paths` object construction
- Modify: `Docs/Meta/platform-config.json` (workshop) — add `variables.content_path`

**Step 1.1.1:** Open `platform/install.js`. Find the substitution variable map (where `rules_path`, `templates_path`, `commands_path` are wired). Add `content_path` alongside them with the same shape. Default value when unspecified in config: `"Docs/Meta/Content"`.

**Step 1.1.2:** Open `Docs/Meta/platform-config.json` in workshop. Add `"content_path": "Docs/Meta/Content"` under `variables`.

**Step 1.1.3:** Verify by running workshop self-install (Templater → Open Insert Template → `_install-platform`). Expected: install runs green; no behavioral change since no item declares files using `{{content_path}}` yet.

**Step 1.1.4:** Log execution → `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T1.1-content-path-variable.md`. Include: lines changed in install.js, the platform-config.json diff, install-run output snippet.

---

### Task 1.2: Implement `applyNavButtons` + `validateAndResolve`

**Files:**
- Modify: `platform/install.js` — add the two functions; call `applyNavButtons` from the install loop after `applyRuleFragment`

**Step 1.2.1:** Read the design doc's `applyNavButtons` and `validateAndResolve` code sketch (Section "Installer changes"). Implement verbatim, adapted to install.js's existing helper conventions (`readJsonOrEmpty`, `writeJson`, `new Notice`, history push).

**Step 1.2.2:** In the install loop, after the `applyRuleFragment(item, manifest, paths, history)` call, add `applyNavButtons(item, manifest, paths, history)`. Same try/finally semantics — failures here record history, do not throw.

**Step 1.2.3:** Verify in workshop self-install. Expected: install runs green; `Docs/Meta/nav-buttons-registry.json` does NOT yet exist (no item declares `nav_buttons[]`).

**Step 1.2.4:** Log → `T1.2-applyNavButtons.md`.

---

### Task 1.3: Add subscription-aware pruning

**Files:**
- Modify: `platform/install.js` — add pruning step at the tail of the install loop

**Step 1.3.1:** Read the design doc's pruning code sketch. Implement at the end of the install loop, inside the existing try/finally so it runs even on per-item failures.

**Step 1.3.2:** Verify in workshop self-install. Expected: install runs green; pruning is a no-op since registry doesn't exist yet.

**Step 1.3.3:** Log → `T1.3-subscription-pruning.md`.

---

### Task 1.4: Re-sync bootstrap copies of `platformInstall.js`

**Files:**
- Copy `platform/install.js` → `Docs/Meta/Templater/platformInstall.js` (poc-vault)
- Copy `platform/install.js` → `../tmp-acc-vault/Docs/Meta/Templater/platformInstall.js`
- Copy `platform/install.js` → `../tmp-test-barebones-vault/Docs/Meta/Templater/platformInstall.js`

**Step 1.4.1:** Use `cp -p` or equivalent. Three files must be byte-identical to the source.

**Step 1.4.2:** Verify each via `diff platform/install.js <runtime-copy>` → no output.

**Step 1.4.3:** Log → `T1.4-bootstrap-copies.md`. Include the three diff exit codes.

---

### Task 1.5: Bump `workshop_version` 0.3.0 → 0.4.0 (ASK FIRST)

**Files:**
- Modify: `platform/manifest.json` — `workshop_version`

**Step 1.5.1:** **Pause and confirm with the user before editing.** CLAUDE.md non-negotiable: ask before bumping `workshop_version`. The design doc pre-approves this in S1 but each implementer must still surface the moment.

**Step 1.5.2:** Edit the field after confirmation.

**Step 1.5.3:** Log → `T1.5-workshop-version-bump.md`.

---

### Task 1.6: S1 dogfood — workshop self-install green

**Files:**
- Run: `tp.user.platformInstall(tp)` in workshop via `_install-platform` template

**Step 1.6.1:** Reload Templater user scripts (Settings → Templater → User Script Functions → Reload).

**Step 1.6.2:** Trigger install. Expected outcome: console / Notice shows installer ran; `platform-installed.json` history has zero new error entries; `Docs/Meta/nav-buttons-registry.json` does NOT exist.

**Step 1.6.3:** Re-run install (idempotency check). Expected: zero new file writes (every item already at current version).

**Step 1.6.4:** Log → `T1.6-S1-workshop-dogfood.md`. Include the captured Notice text and `platform-installed.json` history tail.

---

### Task 1.7: S1 negative test — malformed registry doesn't clobber

**Files:**
- Temp: hand-write malformed `Docs/Meta/nav-buttons-registry.json` (workshop)

**Step 1.7.1:** Write `{ "schema_version": 1, "contributions":` (truncated) to `Docs/Meta/nav-buttons-registry.json`.

**Step 1.7.2:** Run workshop self-install. Expected: install completes; Notice surfaces "nav-buttons-registry.json malformed" (or equivalent — but no contributor to attribute since workshop has no `nav_buttons[]` items yet). The malformed file is **not** clobbered.

**Step 1.7.3:** Verify file body unchanged: `cat Docs/Meta/nav-buttons-registry.json` still shows truncated JSON.

**Step 1.7.4:** Restore: delete the file. Re-run install. Expected: green.

**Step 1.7.5:** Log → `T1.7-S1-malformed-registry-negative.md`.

> [!info] S1 close gate
> All seven tasks logged. Workshop self-install green. `workshop_version` is 0.4.0. Bootstrap copies in sync. Promote to S2.

---

## Stage 2 — nav-buttons mechanism v2.0.0

> Goal: full rewrite of `space-nav-buttons.js` as a thin renderer over the registry. Drops the kitchen-sink config, drops `detectNoteType`, drops prev/next, drops kanban-card sniffing. Workshop drops the project subscription so workshop renders nothing post-S2.

### Task 2.1: Rewrite `space-nav-buttons.js`

**Files:**
- Replace: `platform/mechanisms/nav-buttons/space-nav-buttons.js`

**Step 2.1.1:** Read the design doc's v2.0.0 SpaceNavButtons sketch (Section "Stage 2"). Implement it as the full new file body.

**Step 2.1.2:** Carry forward from the v1.0.0 file:
- The grid styling (`vault-nav` div, `flex` rows, `btnBase` cssText)
- The mobile row split (`isMobile = app.isMobile; rowCount = isMobile ? 3 : 2`)
- The hover-state handlers

Do NOT carry forward:
- `config = {...}` block (lines 51-65 of v1.0.0)
- `detectNoteType()` (lines 33-42)
- prev/next day arrow rendering (lines 173-221)
- `isKanbanCard` injection (lines 148-152)
- `createFromTemplate` helper (replaced by `dispatchAction.createFromTemplate` flow)

**Step 2.1.3:** Add the `ICONS` map. Include at minimum: `board`. Add `daily`, `todo`, `meetings`, `summary`, `projects`, `planning`, `plus` for forward-compatibility (future blueprints will reference them by name).

**Step 2.1.4:** Add `dispatchAction(btn)` exported off the class or inline as an async helper. Implement `openLink` and `createFromTemplate` per the design sketch.

**Step 2.1.5:** Lint your work — no top-level statements (the file is a CustomJS class body), `class SpaceNavButtons { ... }` is the only top-level form.

**Step 2.1.6:** Log → `T2.1-nav-buttons-rewrite.md`. Include the line count delta vs v1.0.0 (expect ~50% reduction).

---

### Task 2.2: Bump nav-buttons manifest 1.0.0 → 2.0.0

**Files:**
- Modify: `platform/mechanisms/nav-buttons/manifest.json`

**Step 2.2.1:** Update `version: "1.0.0"` → `"2.0.0"`. Update description to: `"Thin renderer over Docs/Meta/nav-buttons-registry.json. Each blueprint/mechanism declares nav_buttons[]; installer aggregates."`.

**Step 2.2.2:** `nav_buttons[]` field stays empty (the renderer is not itself a contributor).

**Step 2.2.3:** Log → `T2.2-nav-buttons-manifest-bump.md`.

---

### Task 2.3: Update workshop manifest

**Files:**
- Modify: `platform/manifest.json` — `mechanisms[]` entry for nav-buttons

**Step 2.3.1:** Bump nav-buttons mechanism entry's `version: "1.0.0"` → `"2.0.0"`.

**Step 2.3.2:** Log → `T2.3-workshop-manifest-update.md`.

---

### Task 2.4: Update workshop subscription (drop project, bump nav-buttons)

**Files:**
- Modify: `Docs/Meta/platform-subscription.json` (workshop)

**Step 2.4.1:** Bump the nav-buttons subscription entry to `2.0.0`.

**Step 2.4.2:** **Remove the `project` entry from `blueprints[]`.** Workshop is renderer-dogfood-only; project lives in barebones.

**Step 2.4.3:** Log → `T2.4-workshop-subscription-update.md`. Include the before/after JSON.

---

### Task 2.5: S2 dogfood — workshop self-install green

**Files:**
- Run: workshop `_install-platform`

**Step 2.5.1:** Reload Templater user scripts (the renderer rewrite does NOT change Templater scripts, but reload anyway for hygiene).

**Step 2.5.2:** Reload CustomJS (Settings → Community plugins → toggle CustomJS off/on, OR Command Palette → "CustomJS: Reload").

**Step 2.5.3:** Run install. Expected: nav-buttons@2.0.0 lands at `Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js`; `installed.json` records 2.0.0; pruning removes any stale `contributions.project` entry from registry (if present from earlier sessions); registry is empty `{ schema_version: 1, contributions: {} }` or absent.

**Step 2.5.4:** Open any note in workshop. Add a dataviewjs block:
```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```
Expected: nothing renders (zero contributions). No error chip. No console error.

**Step 2.5.5:** Log → `T2.5-S2-workshop-dogfood.md`.

---

### Task 2.6: S2 negative test — malformed registry produces error chip

**Files:**
- Temp: hand-write malformed `Docs/Meta/nav-buttons-registry.json` in workshop

**Step 2.6.1:** Write `{ "schema_version": 1, "contributions": [BAD JSON` to the registry path.

**Step 2.6.2:** Reload the dataviewjs block. Expected: a single error chip / div with text including "registry parse error" and the JSON.parse exception message.

**Step 2.6.3:** Restore: delete the file. Re-render. Expected: nothing renders, no error.

**Step 2.6.4:** Log → `T2.6-S2-malformed-registry-runtime-negative.md`.

---

### Task 2.7: S2 negative test — unknown action.type surfaces Notice

**Files:**
- Temp: hand-write a synthetic registry with a contribution declaring `action.type: "fake"`

**Step 2.7.1:** Write to workshop registry:
```json
{
  "schema_version": 1,
  "contributions": {
    "test": [{ "id": "fake", "label": "Fake", "icon": "board", "order": 100, "action": { "type": "fake" } }]
  }
}
```

**Step 2.7.2:** Reload the dataviewjs block. Expected: one button labeled "Fake" renders.

**Step 2.7.3:** Click it. Expected: Notice "nav-buttons: unknown action.type \"fake\" from test".

**Step 2.7.4:** Restore: delete the file or empty `contributions`.

**Step 2.7.5:** Log → `T2.7-S2-unknown-action-negative.md`.

> [!info] S2 close gate
> All seven tasks logged. Workshop renders nothing (renderer correct over empty registry). Both negative tests pass. Promote to S3.

---

## Stage 3 — project blueprint v0.2.0

> Goal: project blueprint declares one button (Board) and ships a Dataview-driven kanban template.

### Task 3.1: Write the kanban template body

**Files:**
- Create: `platform/blueprints/project/content/kanban-board.md`

**Step 3.1.1:** Mirror the design doc's sketch. Body:

````markdown
---
type: project-board
tags:
  - "{{vault_identity_tag}}"
  - board
---

# To-Do Board

```dataviewjs
const grouped = dv.pages('"boards/planning"')
  .where(p => p.type === "project")
  .groupBy(p => p.status || "active");

if (grouped.length === 0) {
  dv.paragraph("_No projects yet. Run `/new-project` to create one._");
} else {
  for (const grp of grouped) {
    dv.header(2, grp.key);
    for (const p of grp.rows) {
      dv.paragraph(`- [[${p.file.path}|${p.file.name}]]`);
    }
  }
}
```
````

**Step 3.1.2:** `{{vault_identity_tag}}` is intended to substitute at install time via lenient body substitution — confirm this works by visually inspecting the materialized barebones copy in S4.

**Step 3.1.3:** Log → `T3.1-kanban-template.md`.

---

### Task 3.2: Update project manifest

**Files:**
- Modify: `platform/blueprints/project/manifest.json`

**Step 3.2.1:** Bump `version: "0.1.0"` → `"0.2.0"`.

**Step 3.2.2:** Update `depends_on.nav-buttons.range` from `">=1.0.0"` → `">=2.0.0"`.

**Step 3.2.3:** Append to `files[]`:
```json
{ "source": "content/kanban-board.md", "dest": "{{content_path}}/project/kanban-board.md" }
```

**Step 3.2.4:** Add new top-level `nav_buttons[]` field. **`template_source` is a basename only** — the installer prepends `${content_path}/${source-name}/` automatically; a directory prefix here would produce a doubled-segment path (`Docs/Meta/Content/project/content/kanban-board.md`).

```json
"nav_buttons": [
  {
    "id": "board",
    "label": "Board",
    "icon": "board",
    "order": 100,
    "action": {
      "type": "createFromTemplate",
      "target": "boards/To-Do-Board.md",
      "template_source": "kanban-board.md"
    }
  }
]
```

**Step 3.2.5:** Log → `T3.2-project-manifest-update.md`.

---

### Task 3.3: Update workshop manifest

**Files:**
- Modify: `platform/manifest.json` — `blueprints[]` entry for project

**Step 3.3.1:** Bump project blueprint entry's `version: "0.1.0"` → `"0.2.0"`.

**Step 3.3.2:** Log → `T3.3-workshop-manifest-project-bump.md`.

---

### Task 3.4: S3 dogfood — workshop self-install green

> Workshop is NOT subscribed to project anymore (per T2.4). This dogfood validates the manifest change doesn't break anything; it does NOT install project anywhere.

**Files:**
- Run: workshop `_install-platform`

**Step 3.4.1:** Reload Templater user scripts.

**Step 3.4.2:** Run install. Expected: green; project NOT installed (workshop not subscribed); registry empty; no errors.

**Step 3.4.3:** Log → `T3.4-S3-workshop-dogfood.md`.

---

### Task 3.5: S3 negative test — malformed nav_buttons entry per-entry skip

**Files:**
- Temp: edit workshop's project manifest in-place to inject a bad entry

**Step 3.5.1:** **Workshop doesn't subscribe to project. To test this we need a vault that does.** Defer this test to barebones in S4. Skip for S3 close. Log: `T3.5-S3-deferred-to-S4.md` noting why.

> [!info] Why deferred
> The malformed-nav_buttons-entry path can only fire when a subscribed item is being installed. Workshop won't install project. Barebones will, in S4 — perform the negative test there.

---

### Task 3.6: S3 negative test — depends_on.nav-buttons<2.0.0 forces project skip

**Files:**
- Temp: edit workshop's `Docs/Meta/platform-subscription.json` to add project@0.2.0 with a constructed scenario

> [!info] How to force this without breaking workshop
> Workshop dropped project. To test the dep-resolver scenario without re-subscribing, use a transient subscription override:
> 1. Add `{ "name": "project", "version": "0.2.0" }` to `blueprints[]` temporarily.
> 2. **Edit the workshop manifest's project entry to claim `depends_on.nav-buttons.range: ">=3.0.0"`** (an unsatisfiable range against the workshop's installed nav-buttons@2.0.0).
> 3. Run install. Expected: project skipped with reason "dep nav-buttons@2.0.0, need range >=3.0.0".
> 4. Restore manifest range to `">=2.0.0"` AND remove project from subscription.

**Step 3.6.1:** Apply transient changes per above.

**Step 3.6.2:** Run install. Expected: history records `{ event: "skip", name: "project", reason: "depends on nav-buttons@2.0.0, need >=3.0.0" }` (or the C2-hardened equivalent).

**Step 3.6.3:** Restore manifest + subscription. Re-run install to verify clean state.

**Step 3.6.4:** Log → `T3.6-S3-version-range-negative.md`.

> [!info] S3 close gate
> Six tasks logged (one deferred to S4). Workshop self-install still green. Promote to S4.

---

## Stage 4 — barebones regression sweep

> Goal: re-install in barebones; verify both surprises are closed; verify the three deferred Stage 4 (v0.1.0) smoke tests still pass on the new versions.

### Task 4.1: Update barebones subscription

**Files:**
- Modify: `../tmp-test-barebones-vault/Docs/Meta/platform-subscription.json`

**Step 4.1.1:** Bump nav-buttons → 2.0.0; bump project → 0.2.0.

**Step 4.1.2:** If the file lacks a `content_path` declaration in `variables`, add `"content_path": "Docs/Meta/Content"`.

**Step 4.1.3:** Log → `T4.1-barebones-subscription.md`.

---

### Task 4.2: Run platformInstall in barebones (HUMAN STEP)

**Files:**
- Run in Obsidian: barebones `_install-platform` template

**Step 4.2.1:** Open barebones in Obsidian on macOS.

**Step 4.2.2:** Reload Templater user scripts. Reload CustomJS.

**Step 4.2.3:** Trigger install. Approve any gates that fire.

**Step 4.2.4:** Capture Notice output. Expected final Notice: `platformInstall: complete.`.

**Step 4.2.5:** Log → `T4.2-barebones-install-run.md`. Include captured Notice text and `platform-installed.json` tail.

---

### Task 4.3: Verify install state

**Files:**
- Inspect: `../tmp-test-barebones-vault/Docs/Meta/...`

**Step 4.3.1:** Confirm files present:
- `Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js` (byte-matches workshop v2.0.0 source via `diff`)
- `Docs/Meta/Content/project/kanban-board.md` (byte-matches workshop source post-substitution)
- `Docs/Meta/nav-buttons-registry.json` exists with one entry under `contributions.project`

**Step 4.3.2:** Confirm `Docs/Meta/platform-installed.json` has nav-buttons@2.0.0 and project@0.2.0 with fresh `installed_at`.

**Step 4.3.3:** Inspect kanban-board.md — verify `{{vault_identity_tag}}` substituted to `"barebones"` (lenient body substitution — confirms Stage 4 v0.1.0 hardening still works).

**Step 4.3.4:** Log → `T4.3-barebones-install-state.md`.

---

### Task 4.4: Smoke test — registry-driven nav (closes Surprise 1)

**Files:**
- Inspect in Obsidian (barebones)

**Step 4.4.1:** Open any note in barebones (or create a scratch one).

**Step 4.4.2:** Add:
```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

**Step 4.4.3:** Expected: **exactly one button renders, labeled "Board"**, with the board icon. No prev/next arrows. No other buttons.

**Step 4.4.4:** Log → `T4.4-smoke-registry-nav.md`. Include screenshot or DOM-inspector excerpt.

---

### Task 4.5: Smoke test — lazy scaffold (closes Surprise 2)

**Files:**
- Click the Board button

**Step 4.5.1:** Click Board. Expected:
- `boards/To-Do-Board.md` materializes (folder + file created).
- File body matches `Docs/Meta/Content/project/kanban-board.md` exactly.
- Note opens in the active pane.
- Dataview block renders with `_No projects yet. Run /new-project to create one._` (since no projects exist).

**Step 4.5.2:** Click Board again (already exists). Expected: opens the same file; does NOT create a new file or throw an error.

**Step 4.5.3:** Log → `T4.5-smoke-lazy-scaffold.md`.

---

### Task 4.6: Smoke test — /new-project + board update

**Files:**
- Run `/new-project` in barebones

**Step 4.6.1:** Trigger the `/new-project` slash command.

**Step 4.6.2:** Provide a project name when prompted (e.g., "test-project-alpha").

**Step 4.6.3:** Expected: new note at `boards/planning/test-project-alpha/test-project-alpha.md` with required frontmatter (`type: project`, `tags: ["project", "barebones"]`, `status: active`).

**Step 4.6.4:** Re-open `boards/To-Do-Board.md`. Expected: Dataview block now shows a `## active` section with `- [[boards/planning/test-project-alpha/test-project-alpha|test-project-alpha]]` listed.

**Step 4.6.5:** Log → `T4.6-smoke-new-project-board-update.md`.

---

### Task 4.7: Smoke test — validator + audit walker still work

**Files:**
- Run `tp.user.validate(tp)` and `tp.user.audit(tp)` in barebones

**Step 4.7.1:** Open the new project note. Run `tp.user.validate(tp)`. Expected: Notice "PASS" or equivalent (rule.json compliance).

**Step 4.7.2:** Delete a required tag (e.g., remove `"barebones"` from frontmatter `tags`). Re-run validate. Expected: FAIL with the missing field reported.

**Step 4.7.3:** Restore the tag.

**Step 4.7.4:** Run `tp.user.audit(tp)`. Expected: an audit report file written under the audit-walker's configured destination (per audit mechanism's manifest).

**Step 4.7.5:** Log → `T4.7-smoke-validator-audit.md`.

---

### Task 4.8: Negative test deferred from S3 — malformed nav_buttons entry

**Files:**
- Temp: edit barebones's just-installed project manifest copy? **No — manifest is in workshop, not consumer.**

> [!info] Test mechanic
> The malformed-`nav_buttons[]`-entry path fires during `applyNavButtons` when reading the **workshop's** manifest. Since barebones reads from workshop on install, we test by transiently editing `platform/blueprints/project/manifest.json` (workshop) to inject one bad entry.

**Step 4.8.1:** In workshop, edit project manifest's `nav_buttons[]`: add a second entry missing `id`:
```json
{ "label": "Bad", "icon": "board", "order": 200, "action": { "type": "openLink", "target": "missing.md" } }
```

**Step 4.8.2:** Run barebones install.

**Step 4.8.3:** Expected: Notice "nav-buttons: invalid declaration in project (missing id/label/action)". Registry still gets the valid Board entry. History records a warning for the bad entry.

**Step 4.8.4:** Restore workshop project manifest. Re-run barebones install.

**Step 4.8.5:** Log → `T4.8-S4-malformed-entry-negative.md`.

---

### Task 4.9: Idempotency check

**Files:**
- Run barebones install a second time

**Step 4.9.1:** Re-run `_install-platform` in barebones with no changes.

**Step 4.9.2:** Expected: every item already at current version → zero new file writes; `platform-installed.json` history grows by zero entries; registry unchanged.

**Step 4.9.3:** Log → `T4.9-S4-idempotency.md`.

---

### Task 4.10: Write S4 result writeup

**Files:**
- Create: `Docs/plans/2026-05-03-registry-driven-nav-buttons-result.md`

**Step 4.10.1:** Mirror the structure of `2026-05-02-...-handoff.md`:
- Status: closed (or open with explicit follow-ups).
- What's installed and verified working table.
- Surprise 1 closure evidence.
- Surprise 2 closure evidence.
- Any new landmines surfaced (especially the five flagged in the design doc — confirm they held or update).
- Disposition for accuris migration (still future work; sketch path).

**Step 4.10.2:** Log → `T4.10-result-writeup.md` referencing the result file.

> [!info] v0.1.1 close gate
> All ten S4 tasks logged. Both surprises closed. Validator + audit + new-project still pass. Result writeup filed. v0.1.1 done.

---

## Cross-cutting reminders for every task

- [ ] Every change to `platform/install.js` requires re-syncing the three `platformInstall.js` runtime copies (poc-vault, tmp-acc-vault, tmp-test-barebones-vault). Do NOT skip.
- [ ] Every dogfood install must capture the resulting `platform-installed.json:history` tail in the execution log.
- [ ] Surface every Notice text verbatim in the execution log — it's the only artifact of how the user-facing failure path actually rendered.
- [ ] If any negative test does NOT produce its expected error → STOP, log the divergence, surface to user before proceeding.
- [ ] If workshop self-install is RED at any stage close → STOP, do not promote.

---

## Plan complete and saved to `Docs/plans/2026-05-03-registry-driven-nav-buttons-plan.md`.
