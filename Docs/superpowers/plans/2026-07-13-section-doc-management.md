# Section & Doc Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make section/doc management robust and complete — fix the nested sub-section "empty hub" bug, add per-doc actions, trim `.md`, spacious/expanded move dialog, and root-level Select-docs.

**Architecture:** `section-hub.js` switches to folder-is-truth path derivation (kills the frontmatter-reconstruction bug class). An idempotent install heal repairs existing `parent_section` drift. The shared `section-explorer` mechanism gains a per-doc `⋯` menu, `.md` trimming, and an expand-all spacious move dialog. `project-chrome-bar.js` wires Select-docs into the Docs atlas root.

**Tech Stack:** CustomJS classes (bare class expressions, no imports/exports), Obsidian `app.fileManager`/`app.vault`/`app.metadataCache`, Dataview, Node test harnesses under `platform/test/` (`npm run run-*`), install heals in `platform/install.js`.

**Conventions (read before starting):** `Docs/agent-guides/code-conventions.md`, `Docs/agent-guides/project-blueprint-ui.md`, `Docs/agent-guides/note-chrome.md`, `Docs/agent-guides/migration-regression-net.md`. Never hand-edit version pins/manifests (auto-pipeline owns them). CustomJS files MUST stay a single bare class expression — no trailing statements.

---

## File Structure

- `platform/blueprints/project/helpers/section-hub.js` — Task 1 (folder-is-truth). Modify `render` scopePath, `_buildConfig` sectionPath, `_renderResults` scopePath.
- `platform/install.js` — Task 2 (new `applyDepth2ParentSectionHeal`, wired in the project heals block near line 1286, mirroring `applyDocsHubModernizeHeal`).
- `platform/mechanisms/section-explorer/section-explorer.js` — Tasks 3 (`.md` trim), 4 (expand-all), 5 (per-doc menu).
- `platform/mechanisms/section-explorer/section-explorer.css` — Tasks 4 (spacing), 5 (`.se-doc-dots`).
- `platform/blueprints/project/helpers/project-chrome-bar.js` — Task 6 (docs-root Select-docs).
- Harnesses: `platform/test/run-project-doc-move.*`, `platform/test/run-section-explorer.*`, `platform/test/run-project-chrome-bar.*`, plus the seed-vault migration net for the heal.

Find each harness's real filename first: `ls platform/test | grep -i "section-explorer\|doc-move\|chrome-bar"`.

---

## Task 1: (c) Folder-is-truth path derivation in section-hub.js

**Files:**
- Modify: `platform/blueprints/project/helpers/section-hub.js` (`render` ~line 57, `_buildConfig` ~line 228, `_renderResults` ~line 192)
- Test: the section-hub/doc-move harness (`platform/test/run-project-doc-move.*` — confirm exact name)

- [ ] **Step 1: Write the failing test.** Add a case that constructs a depth-2 section-hub page object with the exact live bug — `parent_section` equal to its own `section`, but a real `file.folder` under the true parent:

```js
// Depth-2 hub whose parent_section is WRONG (self-referential), file lives in real folder.
const cur = {
  type: "section-hub", depth: 2,
  project_slug: "sauce", section: "Misc-Subsection", section_slug: "misc-subsection",
  parent_section: "Misc-Subsection", // BUG: should be "Misc"
  file: { name: "Misc-Subsection.md", folder: "spice/projects/sauce/docs/misc/misc-subsection",
          path: "spice/projects/sauce/docs/misc/misc-subsection/Misc-Subsection.md" },
};
const SH = new SectionHub();
const cfg = SH._buildConfig(fakeDv, cur, 2, "sauce", "misc-subsection", "Misc-Subsection");
assert.equal(cfg.sectionPath, "spice/projects/sauce/docs/misc/misc-subsection");
```

- [ ] **Step 2: Run to verify it fails.** Run the harness (e.g. `npm run run-project-doc-move`). Expected: FAIL — current code yields `spice/projects/sauce/docs/misc-subsection/misc-subsection`.

- [ ] **Step 3: Implement folder-is-truth.** In `_buildConfig`, replace the reconstruction:

```js
// OLD:
// const parentSlugForScope = depth === 2 ? this._slugify(this._stripLink(cur.parent_section)) : null;
// const sectionPath = depth === 1 ? `...docs/${sectionSlug}` : `...docs/${parentSlugForScope}/${sectionSlug}`;
// NEW (folder-is-truth — the note already knows where it lives):
const sectionPath = String(
  (cur.file && cur.file.folder != null)
    ? cur.file.folder
    : cur.file.path.slice(0, cur.file.path.lastIndexOf("/"))
);
```

Apply the identical derivation to `render`'s `scopePath` (~line 57) and `_renderResults`'s `scopePath` (~line 192). Remove now-unused `parentSlugForScope` locals in those scopes. Leave `docsRoot`, `projectSlug`, and the depth-based EntityCreate presets untouched.

- [ ] **Step 4: Run to verify it passes,** plus a depth-1 non-regression assertion (`cfg.sectionPath === "spice/projects/sauce/docs/misc"` for a depth-1 `Misc.md` at `.../docs/misc`). Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add platform/blueprints/project/helpers/section-hub.js platform/test/<harness>
git commit -m "fix(section-hub): derive section path from real folder, not parent_section frontmatter"
```

---

## Task 2: (c) Install heal — repair drifted parent_section

**Files:**
- Modify: `platform/install.js` (new `applyDepth2ParentSectionHeal`, wired near line 1286 after `applyTripsConformanceHeal`; mirror `applyDocsHubModernizeHeal`'s signature/backup/idempotency/never-throw shape)
- Test: seed-vault migration net (`Docs/agent-guides/migration-regression-net.md`; add a broken depth-2 hub fixture under `platform/test/seed-vault/` and a portable sentinel)

- [ ] **Step 1: Read the pattern.** Read `applyDocsHubModernizeHeal` and `applyTripsConformanceHeal` in `platform/install.js` for the exact `(tp, mech, variables, history, git)` signature, backup mechanism, dry-run/idempotency guard, and never-throw wrapper.

- [ ] **Step 2: Write the failing migration test.** Add a seed-vault fixture: a project `docs/` tree with a depth-1 `misc/Misc.md` (`section: Misc`) and a depth-2 `misc/misc-subsection/Misc-Subsection.md` whose `parent_section: Misc-Subsection` (wrong). Assert post-heal `parent_section === "Misc"`; assert a correct hub is left untouched; assert a 2nd pass is a no-op. Run the seed-vault harness — Expected: FAIL (heal doesn't exist).

- [ ] **Step 3: Implement `applyDepth2ParentSectionHeal`.** For each project `docs/` subtree: enumerate `type: section-hub` notes with `depth === 2`; for each, compute its parent folder (`folder` minus last segment), find that folder's `type: section-hub` note, read its `section` display-name; if the depth-2 note's `parent_section` (stripped of `[[ ]]`) !== that name, rewrite `parent_section` to `[[<name>]]` via `app`-equivalent frontmatter write used by sibling heals (match how `applyDocsHubModernizeHeal` writes). Backup before write; skip when already correct; never throw.

- [ ] **Step 4: Wire it** after `applyTripsConformanceHeal(...)` (~line 1286):

```js
await applyDepth2ParentSectionHeal(tp, mech, variables, history, git); // NEW — folder-is-truth parent_section repair
```

- [ ] **Step 5: Run to verify PASS** (heal fixes the broken fixture, leaves correct ones, idempotent). Then commit.

```bash
git add platform/install.js platform/test/seed-vault/** platform/test/<seed-harness>
git commit -m "feat(project-install): heal drifted depth-2 parent_section (folder-is-truth)"
```

---

## Task 3: (b) Trim `.md` from doc labels

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`_docCardModel` ~line 293; `openSelectDocsPicker` row title ~line 945)
- Test: `platform/test/run-section-explorer.*`

- [ ] **Step 1: Failing test.** Assert `_docCardModel({ file: { name: "Foo.md", path: "a/Foo.md" } }).title === "Foo"` and that a select-docs card built from a titleless page renders label without `.md`.

- [ ] **Step 2: Run — Expected FAIL** (`.md` present).

- [ ] **Step 3: Implement.** In `_docCardModel`, strip the extension from the name fallback:

```js
const rawName = (p && p.file && p.file.name) || "";
title: (p && p.title) || String(rawName).replace(/\.md$/, "") || "",
```

In `openSelectDocsPicker`, change the row fallback so a missing title uses the basename without extension:

```js
const base = String(c.path || "").split("/").pop().replace(/\.md$/, "");
name.textContent = c.title || base;
```

- [ ] **Step 4: Run — Expected PASS.**

- [ ] **Step 5: Commit.**

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/test/<harness>
git commit -m "fix(section-explorer): trim .md from doc-card + select-docs labels"
```

---

## Task 4: (d) Move dialog — default-expanded + spacious

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`openMovePicker`, `branchSeed` ~line 659)
- Modify: `platform/mechanisms/section-explorer/section-explorer.css` (`.se-move-list`, `.se-move-row`)
- Test: `platform/test/run-section-explorer.*`

- [ ] **Step 1: Failing test.** Drive `openMovePicker` with a target set containing nested folders (a parent with children) via the existing DOM-stub harness; assert every folder for which `hasChildren(folder)` is true appears in the rendered/`expanded` set at open (no collapsed parents). Expected: FAIL (only current branch seeded).

- [ ] **Step 2: Run — Expected FAIL.**

- [ ] **Step 3: Implement expand-all seed.** Replace `let expanded = branchSeed();` with a seed over all parents:

```js
const expandAllSeed = () => {
  const set = new Set();
  for (const folder of byFolder.keys()) {
    if (hasChildren(folder)) set.add(folder);
  }
  return set;
};
let expanded = expandAllSeed();
```

Keep `branchSeed`/`hasChildren`/`doExpandAll`/`doCollapseAll` and the current-selection highlight intact (Collapse-all still works).

- [ ] **Step 4: Spacing.** In `section-explorer.css`: `.se-move-list { max-height: 62vh; }`, `.se-move-row { padding: 9px 12px; }`. In `openMovePicker` inline styles, widen the panel (raise its max-width, e.g. `min(560px, 92vw)`) and bump the depth indent step from `18` to `20`. Verify no test asserts the old literals; update any that do.

- [ ] **Step 5: Run — Expected PASS.** Optional: build a Playwright HTML replica (per `lesson_verify_chrome_visually_with_playwright_harness`) served via `python3 -m http.server`, screenshot at 390px + desktop, confirm expanded + roomy. Commit.

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/mechanisms/section-explorer/section-explorer.css platform/test/<harness>
git commit -m "feat(section-explorer): move picker opens fully expanded + more spacious"
```

---

## Task 5: (a) Per-doc `⋯` menu on doc cards

**Files:**
- Modify: `platform/mechanisms/section-explorer/section-explorer.js` (`_renderDocCards` ~line 309; new `_openRenameDocDialog`, `_openAddLinkForDoc`, `_openDeleteDocConfirm`; reuse `_openModal`, `openMovePicker`, `applyDocMove`, `MenuPopover`)
- Modify: `platform/mechanisms/section-explorer/section-explorer.css` (new `.se-doc-dots`, mirror `.se-rail-dots`)
- Test: `platform/test/run-section-explorer.*`

- [ ] **Step 1: Read the reuse pattern.** Read `_renderRailRow`'s dots/MenuPopover block (~lines 410-436), `_openRenameDialog`, `_openAddLinkForm`, `_openDeleteConfirm`, `_openModal`, and `applyDocMove` so the doc variants mirror them exactly.

- [ ] **Step 2: Failing tests (DOM-stub, drive the REAL functions).** In `run-section-explorer`, add cases asserting: a rendered doc card contains a `.se-doc-dots` element; selecting **Rename** calls `app.fileManager.renameFile` with the new basename (spied); **Delete** (after confirm) calls `app.fileManager.trashFile` (spied); **Add link** writes `links` via `app.fileManager.processFrontMatter` on the **doc's own** file; **Move** invokes `applyDocMove`/opens the move picker. Expected: FAIL (no dots on doc cards).

- [ ] **Step 3: Run — Expected FAIL.**

- [ ] **Step 4: Implement.** In `_renderDocCards`, after building each card, append a dots span and wire a MenuPopover mirroring the section-row set:

```js
const dots = card.createEl("span", { cls: "se-doc-dots" });
dots.innerHTML = (adapter.icons && adapter.icons.dots) || "";
dots.onclick = (ev) => {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const file = app.vault.getAbstractFileByPath(model.path);
  const entries = [
    { label: "Rename", onSelect: () => this._openRenameDocDialog(dv, adapter, file) },
    { label: "Move", onSelect: () => this._openMovePickerForDoc(dv, adapter, file) },
    { label: "Add link", onSelect: () => this._openAddLinkForDoc(dv, adapter, file) },
    { label: "Delete", danger: true, onSelect: () => this._openDeleteDocConfirm(dv, adapter, file) },
  ];
  customJS.MenuPopover.open(entries, { anchor: dots });
};
```

Add the helper methods (all never-throw, all reusing `_openModal`):
- `_openRenameDocDialog(dv, adapter, file)` — prompt new title (default = current basename); on confirm `app.fileManager.renameFile(file, <folder>/<sanitized>.md)`.
- `_openMovePickerForDoc(dv, adapter, file)` — build folder targets from `adapter.move.enumerateSectionTargets(dv)` (fall back to root when absent); on pick `this.applyDocMove(dv, file, folder, adapter)`.
- `_openAddLinkForDoc(dv, adapter, file)` — reuse the add-link form UI; write to the DOC's own frontmatter `links[]` via `app.fileManager.processFrontMatter(file, fm => { fm.links = [...(fm.links||[]), newLink]; })`.
- `_openDeleteDocConfirm(dv, adapter, file)` — danger confirm modal; on confirm `app.fileManager.trashFile(file)`.

Ensure `adapter.icons.dots` is populated (project config already defines `dotsIcon`; pass it through `makeAdapter`/config if not already on `icons`).

- [ ] **Step 5: CSS.** Add `.se-doc-dots` mirroring `.se-rail-dots` (24×24, muted, hover bg). Keep the card's existing open-on-click; dots `stopPropagation` prevents it.

- [ ] **Step 6: Run — Expected PASS.** Commit.

```bash
git add platform/mechanisms/section-explorer/section-explorer.js platform/mechanisms/section-explorer/section-explorer.css platform/test/<harness>
git commit -m "feat(section-explorer): per-doc ⋯ menu — rename / move / add link / delete"
```

---

## Task 6: (e) "Select docs" at the Docs atlas root

**Files:**
- Modify: `platform/blueprints/project/helpers/project-chrome-bar.js` (`_surfaceSpec` `docs-hub` case ~line 282-285; `_projAdapterAndSection` ~line 616, or new `_docsRootAdapter`)
- Test: `platform/test/run-project-chrome-bar.*`

- [ ] **Step 1: Failing tests.** Assert `_surfaceSpec("docs-hub").overflow` contains an entry `{ id: "select-docs" }`; assert that on a `Docs.md` (docs atlas root) the `select-docs` dispatch resolves an adapter (non-null) and calls `openSelectDocsPicker(dv, adapter, null)` (spy `SectionExplorer.openSelectDocsPicker`). Expected: FAIL.

- [ ] **Step 2: Run — Expected FAIL.**

- [ ] **Step 3: Add the menu entry.** In `_surfaceSpec`'s `docs-hub` case, append after `move-docs`:

```js
{ id: "select-docs", label: "Select docs", icon: ICON.move },
```

- [ ] **Step 4: Docs-root adapter path.** `_projAdapterAndSection` bails unless `cur.type === "section-hub"`. Add a docs-root branch: when `cur` is the Docs atlas (detect via `cur.type === "docs-hub"`/atlas shape at a `.../docs/Docs.md` path), build a minimal docs-root config exposing the `move` block with `root = spice/projects/<slug>/docs` and the same `rewriteOnDocMove`/`enumerateSectionTargets` as `SectionHub._buildConfig`, then return `{ SE, adapter, section: null }`. Factor the shared `move`-block builder out of `_buildConfig` if practical, else duplicate the small block. The existing `select-docs` dispatch (`a.SE.openSelectDocsPicker(dv, a.adapter, a.section)`) then works unchanged with `section === null`.

- [ ] **Step 5: Run — Expected PASS.** Commit.

```bash
git add platform/blueprints/project/helpers/project-chrome-bar.js platform/test/<harness>
git commit -m "feat(project-chrome-bar): Select docs action at the Docs atlas root"
```

---

## Task 7: Full verification + preflight

- [ ] **Step 1: Run every touched harness green.**

```bash
npm run run-section-explorer && npm run run-project-doc-move && npm run run-project-chrome-bar && npm run run-wiki && npm run run-wiki-chrome-bar && npm run run-breadcrumb
```

Expected: all pass, zero failures.

- [ ] **Step 2: Seed-vault regression** (heal net) green.

- [ ] **Step 3: Full preflight** (matches CI):

```bash
npm run preflight
```

- [ ] **Step 4: Preflight-bumped** (version-pin dry run) per `Docs/agent-guides/build-test-verify.md`.

- [ ] **Step 5: Final review commit** if any fixups. Do NOT hand-edit version pins/manifests — the auto-pipeline bumps `section-explorer` + `project` on merge.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** (a) Task 5; (b) Task 3; (c) Tasks 1+2; (d) Task 4; (e) Task 6; testing Task 7. All covered.
- **Placeholders:** none — every code step shows the change; `<harness>` = the real filename resolved in Task 0 `ls`.
- **Type consistency:** `sectionPath` derivation identical across the 3 section-hub sites; doc-menu helpers named consistently (`_openRenameDocDialog`/`_openMovePickerForDoc`/`_openAddLinkForDoc`/`_openDeleteDocConfirm`); `select-docs` id matches the existing dispatch.
- **Wiki safety:** folder-is-truth touches only `section-hub.js`; wiki already folder-is-truth. Per-doc menu / `.md` trim / move dialog are mechanism-level → wiki inherits with no wiki-specific code.
