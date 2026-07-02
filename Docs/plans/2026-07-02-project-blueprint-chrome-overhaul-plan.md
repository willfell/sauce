# Project Blueprint Chrome / Button / Breadcrumb Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the project blueprint's chrome (helper-owned hairline dividers, core-nav + More overflow, full-width action rows, simple docs search, wiki-style move dialog, responsive links grid, universal breadcrumbs) and migrate every existing project file across headspace/ero/accuris.

**Architecture:** Mirror the already-shipped, already-tested **wiki blueprint** pattern (helper-owned dividers, `WikiMove` tree dialog, `persist:false` `doc-search`, template `---` removal + install heal, `path_walk`-style breadcrumbs). Introduce one shared `SectionLabel.divider()` primitive as the single source of the "happy medium" spacing; extend `lint-note-chrome` to enforce it; reshape project templates + helpers to the grammar; heal existing notes at install.

**Tech Stack:** CustomJS helper classes (bare-class, no trailing statements — landmine #`customjs-no-trailing-statements`), Dataview/dataviewjs, Node self-test harnesses (`npm run test:*`, `npm run release:preflight`), install-time heals in `platform/install.js` (`.sauce-backup`-first, idempotent, per-note try/catch, fail-loud-never-throw), seed-vault migration sentinels.

**Reference (read before implementing any UI/heal task):**
- Spec: `Docs/plans/2026-07-02-project-blueprint-chrome-overhaul-design.md`
- Wiki precedent guide: `Docs/agent-guides/wiki-blueprint.md`
- Wiki helpers to mirror: `platform/blueprints/wiki/helpers/{wiki-move.js,wiki-leaf-actions.js,wiki-hub-actions.js,wiki-tree.js}`
- Wiki chrome heal precedent: `_healWikiChromeBody` in `platform/install.js`
- Grammar docs to update: `Docs/agent-guides/note-chrome.md`, `Docs/agent-guides/project-blueprint-ui.md`
- Non-negotiables: `Docs/agent-guides/code-conventions.md`, `Docs/landmines.md`

**Conventions every task obeys:**
- CustomJS helper files are a **bare class only** — no `module.exports`, no trailing `if`/statement (breaks the `customjs-loadable` loader). Node-test statics via `new Function(src + "\nreturn X;")`.
- Every UI task ends with a Playwright visual check at 360px + desktop, light + dark, before its commit is considered done (batched at the end of each workstream is acceptable).
- Commit messages are conventional (`feat(project): …`, `fix(project): …`, `docs(project): …`). **Never** hand-edit versions/tags/manifests/`ranch` pins — the release pipeline owns those.
- Run the relevant `npm run test:*` after each code change; run `npm run release:preflight` before opening any PR.

---

## File Structure

**Create:**
- `platform/blueprints/project/helpers/doc-move-dialog.js` — `DocMoveDialog` (project port of `WikiMove` + `WikiLeafActions._openMoveDialog`): section/sub-section depth-tree builder + modal + `renameFile` + `section`/`sub_section` frontmatter rewrite.
- `platform/test/fixtures/lint-note-chrome/` new fixtures for the divider rule (pass + fail).

**Modify (mechanisms):**
- `platform/mechanisms/section-label/section-label.js` — add `divider()` method (S1 primitive).
- `platform/mechanisms/doc-search/doc-search.js` — add `hideNativeSearch` option.

**Modify (project helpers):**
- `helpers/project-nav-buttons.js` — core (Project·Board·Docs + `Task:X`) + **More ▾** overflow (Map·To-Do·Helpful Links); leading hairline.
- `helpers/projects-hub-cards.js` — remove status chips / group-by / recently-active; last-edited default + A–Z toggle (persisted); full-width centered New Project row.
- `helpers/project-status-widget.js` — tight (no leading hairline / margins).
- `helpers/project-activity-panel.js`, `helpers/project-open-tasks.js` — type icons + doc section labels on cards.
- `helpers/project-docs-index.js`, `helpers/section-hub.js` — S3 order (project buttons → action row → search → list); simple search (`hideTags`, `hideNativeSearch`, `persist:false`); wire Move → `DocMoveDialog`.
- `helpers/project-links-manager.js`, `helpers/project-links-panel.js` — full-width action row; responsive links card grid.
- `helpers/doc-leaf-actions.js`, `helpers/doc-bulk-move.js` — route Move through `DocMoveDialog`.
- Retire the hub Workstreams surface: remove `ProjectWorkstreamManager` from the hub template; fold its add/remove into `helpers/project-workstreams.js` (Map view).

**Modify (project templates):**
- `templates/Project.md` — drop `ProjectWorkstreamManager`; tight status; no literal `---`/blank-line chrome gaps.
- `templates/Docs Hub.md`, `templates/Section Hub.md`, `templates/Doc Note.md`, `templates/Links Hub.md`, `templates/Project Map.md`, `templates/Task Note.md` — remove literal `---` chrome dividers (helpers now own them).
- `templates/Kanban Card.md`, `templates/Task Board Card.md` — add `Breadcrumb` + stable `type` to the final body; grammar-conform button rows.
- `platform/blueprints/to-do/templates/Project To-Do.md` (+ `to-do` `ToDoLeafActions` helper) — hairline between project buttons and to-do actions; New Task + Recurring one full-width row.

**Modify (manifests / heals / docs):**
- `platform/blueprints/project/manifest.json` — register `doc-move-dialog.js` in `files[]`; confirm breadcrumb `type` coverage (add any missing).
- `platform/install.js` — new/extended heals (WS9).
- `Docs/agent-guides/note-chrome.md`, `Docs/agent-guides/project-blueprint-ui.md`, root `CLAUDE.md` router.
- `platform/test/seed-vault/**` — migration sentinels for the new heals.

---

## WS0 — Shared divider primitive + lint gate (FOUNDATION — do first)

**Files:**
- Modify: `platform/mechanisms/section-label/section-label.js`
- Test: `platform/test/run-render-safe.js` sibling OR the section-label harness (see Step 2 — locate the existing section-label test; if none, add `platform/test/run-section-label.js` and wire `test:section-label` in `package.json`).
- Modify: `scripts/lint-note-chrome.js`
- Create: `platform/test/fixtures/lint-note-chrome/{pass,fail}/project-divider-*.md`

### Task 0.1: `SectionLabel.divider()` primitive

- [ ] **Step 1: Write the failing test.** Locate the section-label test harness (`grep -rl "SectionLabel" platform/test`). If one exists, add this case; else create `platform/test/run-section-label.js` that loads the class via `new Function(src + "\nreturn SectionLabel;")` and a jsdom/`createEl` stub. Assert:

```js
// Given a container stub that records createEl('hr') + cssText
const sl = new SectionLabel();
const hr = sl.divider(fakeDv);              // fakeDv.container.createEl records the hr
assert(hr.tagName.toLowerCase() === 'hr');
assert(/border-top:\s*1px solid var\(--background-modifier-border\)/.test(hr.style.cssText));
assert(/margin:\s*8px 0/.test(hr.style.cssText));   // the standard gap (see note)
```

> **Gap value:** spec proposes 10px; the wiki "breathing room" fix landed 2px top+bottom. Use **`margin: 8px 0`** as the starting value (single hairline ≈ 8px each side), then confirm/tune against Playwright screenshots in WS-visual before final. Keep the number in ONE place (this method) so tuning is a one-line change.

- [ ] **Step 2: Run the test, verify it fails** (`divider` undefined). Run: `node platform/test/run-section-label.js` → Expected FAIL.

- [ ] **Step 3: Implement.** Append to the `SectionLabel` class body (BEFORE the closing brace; keep it a bare class — no trailing statements):

```js
  /**
   * Standalone chrome hairline — the canonical divider owned by helpers.
   * Replaces literal markdown `---` between chrome tiers so spacing is uniform
   * and tunable in one place. See Docs/agent-guides/note-chrome.md §divider.
   * @param dv Dataview-like (real dv or proxyDv shim) — needs .container, OR a container.
   * @returns the created <hr> element.
   */
  divider(dv) {
    const c = (dv && dv.container) || dv;
    const hr = c.createEl("hr");
    hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0;";
    return hr;
  }
```

- [ ] **Step 4: Run the test, verify it passes.** Run: `node platform/test/run-section-label.js` → Expected PASS.

- [ ] **Step 5: Verify the loader still accepts the file.** Run: `npm run test:customjs-loadable` → Expected PASS (bare class intact).

- [ ] **Step 6: Commit.**

```bash
git add platform/mechanisms/section-label/section-label.js platform/test/run-section-label.js package.json
git commit -m "feat(section-label): add divider() chrome-hairline primitive"
```

### Task 0.2: `lint-note-chrome` — forbid literal `---` chrome dividers in project templates

- [ ] **Step 1: Write fail + pass fixtures.** Create:
  - `platform/test/fixtures/lint-note-chrome/fail/project-divider-fail.md` — a template with `type: doc-note` frontmatter that renders `Breadcrumb`, `SpaceNavButtons`, then a bare `---` line, then a dataviewjs chrome block (the pattern being outlawed).
  - `platform/test/fixtures/lint-note-chrome/pass/project-divider-pass.md` — same chrome with NO literal `---` between blocks.

- [ ] **Step 2: Add a Rule 4 to `lint-note-chrome.js`.** Insert a `checkNoLiteralChromeDivider(content)` that: skips kanban boards (`isKanbanBoard`); walks lines tracking fence depth (reuse the fence logic from `checkNoHeadings`); flags a thematic-break line (`/^-{3,}\s*$/`) that appears **outside** frontmatter and outside code fences AND is adjacent (within 1 non-blank line) to a `class: "` dataviewjs chrome call. Wire it into `lintContent`. Add its self-test expectation. Full function:

```js
// Rule 4: no literal `---` chrome divider. Helpers own dividers via
// SectionLabel.divider(); a bare thematic-break between/adjacent to chrome
// dataviewjs blocks is the outlawed pattern (see note-chrome.md §divider).
function checkNoLiteralChromeDivider(content) {
    const violations = [];
    if (isKanbanBoard(content)) return violations;
    const lines = content.split('\n');
    // Compute the frontmatter line span to exclude the YAML `---` fences.
    let fmEnd = -1;
    if (lines[0] && lines[0].trim() === '---') {
        for (let j = 1; j < lines.length; j++) { if (lines[j].trim() === '---') { fmEnd = j; break; } }
    }
    let fenceDepth = 0;
    const isChrome = (s) => typeof s === 'string' && s.includes('class: "') && s.includes('customjs-guard');
    for (let i = 0; i < lines.length; i++) {
        if (i <= fmEnd) continue;                         // inside frontmatter
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line)) { fenceDepth = fenceDepth === 0 ? 1 : 0; continue; }
        if (fenceDepth !== 0) continue;
        if (!/^-{3,}\s*$/.test(line)) continue;           // not a thematic break
        // adjacency: nearest non-blank neighbor above or below is a chrome block fence
        let up = i - 1; while (up >= 0 && lines[up].trim() === '') up--;
        let dn = i + 1; while (dn < lines.length && lines[dn].trim() === '') dn++;
        const near = [lines[up - 1], lines[up], lines[dn], lines[dn + 1]].filter(Boolean);
        if (near.some(isChrome) || (lines[up] && lines[up].trim() === '```') || (lines[dn] && lines[dn].trim().startsWith('```'))) {
            violations.push({ line: i + 1, message: 'literal `---` chrome divider not allowed — helpers own dividers via SectionLabel.divider().' });
        }
    }
    return violations;
}
```

  Add `...checkNoLiteralChromeDivider(content),` to `lintContent`'s return array.

> **Scope guard:** This rule flags ALL adopted templates. Because WS-templates removes every literal chrome `---` from project templates in the same cycle, run the full `npm run lint-note-chrome` at the END of the template tasks — not before. If a non-project adopted template (meetings/scratch/to-do) still carries a legitimate chrome `---` that this cycle is NOT rewriting, narrow the rule to project templates only by passing the blueprint name into `opts` and gating Rule 4 on `opts.blueprint === 'project'`. Decide this by running the gate after WS-templates and reading the violations.

- [ ] **Step 3: Run the self-test, verify pass/fail fixtures behave.** Run: `node scripts/lint-note-chrome.js --self-test` → Expected: pass fixture clean, fail fixture flagged.

- [ ] **Step 4: Commit.**

```bash
git add scripts/lint-note-chrome.js platform/test/fixtures/lint-note-chrome
git commit -m "feat(lint): forbid literal --- chrome dividers in adopted templates"
```

---

## WS3 — Nav-button consolidation (`project-nav-buttons.js`)

**Files:** Modify `platform/blueprints/project/helpers/project-nav-buttons.js`; Test `platform/test/` nav-button harness (`grep -rl ProjectNavButtons platform/test` → extend it; else add `run-project-nav-buttons.js` + `test:project-nav`).

**Contract:**
- Partition the built `buttons[]` (currently assembled at lines ~499–540) into **core** and **overflow**:
  - Core (in order, self-hide current): `Task: <X>` (when nested) · `<Project name>` · `Project Board` · `Docs`.
  - Overflow (More ▾): `Map` · `To-Do` · `Helpful Links` (only those that exist for the project). **Map is always overflow** and must be present whenever a map note exists (D2/D3).
- Render: one flex row = core AccentButtons + a trailing `More ▾` AccentButton. `More ▾` opens a `document.body` overlay/menu listing the overflow entries (mirror the nav-buttons Go-to launcher: `_openLauncher`/bottom-sheet on mobile, dropdown on desktop; single `close()` listener — no keydown leak, per the nav-launcher lesson). Suppress the `More ▾` button entirely when overflow is empty.
- The row renders a **leading hairline** via `customJS.SectionLabel.divider(dvContainer)` as its first element (S2). Remove any reliance on a template `---` above it.
- Preserve `_openNavTarget` (doubled-path guard), `_isMapNote`, `detectContext`, and the kanban-card workstream picker unchanged.

### Task 3.1: pure partition function (TDD)

- [ ] **Step 1: Failing test.** Extend the nav harness. Load the class via `new Function`. Assert a pure `_partitionButtons(buttons)` splits by label into `{core, overflow}`:

```js
const nav = new ProjectNavButtons();
const built = [
  {label:'Task: Foo'}, {label:'MyProj'}, {label:'Project Board'},
  {label:'Docs'}, {label:'Map'}, {label:'To-Do'}, {label:'Helpful Links'}
];
const {core, overflow} = nav._partitionButtons(built);
assert.deepEqual(core.map(b=>b.label), ['Task: Foo','MyProj','Project Board','Docs']);
assert.deepEqual(overflow.map(b=>b.label), ['Map','To-Do','Helpful Links']);
```

- [ ] **Step 2: Run, verify FAIL** (`_partitionButtons` undefined). Run: `node platform/test/<nav-harness>.js`.

- [ ] **Step 3: Implement `_partitionButtons`.** Classify by a stable predicate: overflow = label is exactly `Map`, `To-Do`, or `Helpful Links`; core = everything else, preserving input order. Keep it a pure method (no DOM). (Read the current button-build block first; the labels are produced at lines ~501/504/507/510/517/534 + `_linksHubButton`.)

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit.** `git commit -m "feat(project): partition nav buttons into core + overflow"`

### Task 3.2: render core row + More ▾ overlay

- [ ] **Step 1:** In `render()`, after building `buttons[]`, call `_partitionButtons`, render `core` as AccentButtons into the flex row (leading hairline via `SectionLabel.divider` first), then if `overflow.length` render a `More ▾` AccentButton whose `onClick` opens `_openMoreMenu(overflow)`.
- [ ] **Step 2:** Implement `_openMoreMenu(entries)` mirroring the nav-launcher overlay (`document.body` overlay; mobile bottom-sheet / desktop dropdown; each row calls `_openNavTarget(entry.path)` then `close()`; overlay-click + single Escape listener close, removed on close).
- [ ] **Step 3:** Manual/загрузка check: `npm run test:customjs-loadable` PASS; nav harness PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat(project): core nav row + More overflow menu (Map/To-Do/Links)"`

---

## WS1 — Projects hub (`projects-hub-cards.js` + `content/Projects.md`)

**Files:** Modify `platform/blueprints/project/helpers/projects-hub-cards.js`; Test the hub harness (`grep -rl ProjectsHubCards platform/test`).

**Contract:**
- **Remove:** the status-chip filter bar, the group-by selector, and the "Recently active" strip (and their helper code paths).
- **Sort:** default `latestMtime` desc ("last edited"). Add a single toggle control **Last edited ⇄ A–Z**. Persist choice in `localStorage` key `sauce.projects-hub.sort` (values `mtime` | `alpha`); default `mtime` when absent. On toggle, re-sort + re-render the card grid only.
- **New Project:** render the `EntityCreate` `project` button in its **own full-width, centered row** with a `SectionLabel.divider` above and below, no blank lines. (Row: `display:flex; justify-content:center;` button `width:100%` or `flex:1 1 100%`.)
- Keep the BeaconCards grid + the DocSearch filter, but pass `persist:false` and `hideNativeSearch:true` (text-only, empty on return) to match WS4.

### Task 1.1: pure sort function (TDD)

- [ ] **Step 1: Failing test.** Assert a pure `_sortProjects(pages, mode)`:

```js
const hub = new ProjectsHubCards();
const pages = [{file:{name:'Beta', mtime:200}}, {file:{name:'alpha', mtime:100}}];
assert.deepEqual(hub._sortProjects(pages,'mtime').map(p=>p.file.name), ['Beta','alpha']);
assert.deepEqual(hub._sortProjects(pages,'alpha').map(p=>p.file.name), ['alpha','Beta']); // case-insensitive
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `_sortProjects`** (mtime desc; alpha = `localeCompare` case-insensitive on display name). Pure, no DOM.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(project): hub sort by last-edited/alpha (pure)"`

### Task 1.2: strip status/group-by/recently-active + wire toggle + New Project row

- [ ] **Step 1:** Read the current `projects-hub-cards.js` render. Delete the status chip bar, group-by selector, and Recently-active strip blocks. Render: New Project row (divider-bracketed, full-width centered) → search strip (persist:false, hideNativeSearch) → sort toggle → card grid (via `_sortProjects` + BeaconCards). Toggle handler reads/writes localStorage + re-renders the grid container only.
- [ ] **Step 2:** `npm run test:customjs-loadable` PASS; hub harness PASS.
- [ ] **Step 3: Commit.** `git commit -m "feat(project): strip hub status/group-by/recently-active; add sort toggle + full-width New Project row"`

---

## WS2 — Project note (`templates/Project.md` + status/activity/open-tasks helpers)

**Files:** Modify `templates/Project.md`, `helpers/project-status-widget.js`, `helpers/project-activity-panel.js`, `helpers/project-open-tasks.js`.

### Task 2.1: drop Workstreams from the hub template

- [ ] **Step 1:** In `templates/Project.md`, remove the `ProjectWorkstreamManager` dataviewjs block. Ensure no literal `---`/blank-line chrome gaps remain (helpers own dividers). Final order: Breadcrumb, SpaceNavButtons, ProjectNavButtons, ProjectStatusWidget, ProjectActivityPanel, ProjectOpenTasks, ProjectMeetingsPanel, ProjectLinksPanel.
- [ ] **Step 2: Commit.** `git commit -m "feat(project): remove Workstreams section from project hub template"`

### Task 2.2: tight status widget

- [ ] **Step 1:** In `project-status-widget.js`, ensure the widget renders **no leading hairline** and minimal top/bottom margin (hug under the nav buttons). Read the current render; remove any SectionLabel/`hr`/margin that creates a gap.
- [ ] **Step 2:** `npm run test:customjs-loadable` PASS.
- [ ] **Step 3: Commit.** `git commit -m "fix(project): tighten status widget spacing under nav"`

### Task 2.3: type icons + doc section labels on activity/open-task cards

- [ ] **Step 1: Failing test.** In the activity/open-tasks harness (`grep -rl ProjectActivityPanel platform/test`), assert the card meta/icon selection is a pure function `_cardIcon(entry)` / `_cardMeta(entry)`:

```js
const p = new ProjectActivityPanel();
assert.equal(p._kind({type:'meeting'}), 'meeting');
assert.equal(p._kind({type:'doc-note', section:'Workflow Loops'}), 'doc');
assert.equal(p._kind({type:'task-note'}), 'task');
assert.equal(p._cardMeta({type:'doc-note', section:'Workflow Loops'}), 'doc · Workflow Loops');
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `_kind`/`_cardMeta` (pure) + use the existing SVG icon set (copy the `icons` object shape from `project-nav-buttons.js`: meeting→a calendar/users glyph, doc→`icons.docs`, task→`icons.task`). Render the icon inline before each card title; append the section meta for docs. Do the same in `project-open-tasks.js` (task icon).
- [ ] **Step 4: Run, verify PASS** + `test:customjs-loadable` PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(project): type icons + doc section labels on activity/open-task cards"`

---

## WS-Workstreams — consolidate management into the Map note

**Files:** Modify `helpers/project-workstreams.js` (Map view), `helpers/project-workstream-manager.js` (source of add/remove logic).

### Task W.1: move add/remove workstream controls onto the Map

- [ ] **Step 1:** Read both helpers. Port the Add/Remove workstream affordances from `ProjectWorkstreamManager` into `ProjectWorkstreams` (the Map-note renderer) so the Map is the single management surface. Keep the frontmatter mutation logic identical (workstreams[] array).
- [ ] **Step 2:** Confirm `ProjectWorkstreamManager` is no longer referenced by any template (it was removed from `Project.md` in WS2.1). Leave the file in place if other code references it; otherwise mark for WS9 heal cleanup. Do NOT delete a shipped helper without confirming zero references (`grep -rn ProjectWorkstreamManager platform`).
- [ ] **Step 3:** `npm run test:workstreams-analysis` + `test:workstream-source` PASS; `test:customjs-loadable` PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat(project): consolidate workstream management onto the Map note"`

---

## WS4 — Docs hub + section hubs (search reorder + simple search)

**Files:** Modify `platform/mechanisms/doc-search/doc-search.js`, `helpers/project-docs-index.js`, `helpers/section-hub.js`, `templates/Docs Hub.md`, `templates/Section Hub.md`.

### Task 4.1: `doc-search` `hideNativeSearch` option (TDD)

- [ ] **Step 1: Failing test.** In `platform/test/run-doc-search.js` (the `test:doc-search` harness), assert that with `hideNativeSearch:true` the strip contains an `input` but **no** `button`:

```js
const ctx = new DocSearch().render(fakeDv, {scopePath:'x', hideNativeSearch:true});
// fakeDv records created elements; assert no <button> was created in the strip
assert.equal(strip.querySelectorAll('button').length, 0);
assert.equal(strip.querySelectorAll('input').length, 1);
```

- [ ] **Step 2: Run, verify FAIL.** Run: `npm run test:doc-search`.
- [ ] **Step 3: Implement.** In `doc-search.js render()`, read `const hideNativeSearch = opts.hideNativeSearch === true;` and guard the `nativeBtn` block (lines 62–73) with `if (!hideNativeSearch) { … }`. Additive; default false → existing callers unchanged.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(doc-search): hideNativeSearch option (bare text-only strip)"`

### Task 4.2: reorder Docs hub to S3 + simple search + Move wiring

- [ ] **Step 1:** In `project-docs-index.js`, render in S3 order: (project buttons come from `ProjectNavButtons` in the template) → **action row** (New Doc · New Section · Move docs) as one full-width row (S4 layout) each bracketed by `SectionLabel.divider` → **search** (`DocSearch.render` with `hideTags:true, hideNativeSearch:true, persist:false`) with a leading divider → **list**. Wire the "Move docs" button to open `DocMoveDialog` (WS5). Remove the dashboard chip row if it conflicts with the requested minimal layout (confirm with the spec: spec lists nav/buttons/search/list — the chip row is not in the requested structure → remove it).
- [ ] **Step 2:** In `templates/Docs Hub.md`, drop the literal `---` and the `EntityCreate`/`DocBulkMoveActions` standalone blocks if `project-docs-index.js` now renders the action row itself; else keep entity-create markers but ensure order. Remove blank-line chrome gaps.
- [ ] **Step 3:** `npm run test:customjs-loadable` + `test:doc-search` PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat(project): S3 order + simple search on Docs hub"`

### Task 4.3: same for Section Hub (depth 1 + 2)

- [ ] **Step 1:** Apply the identical S3 order + simple-search config to `section-hub.js` and `templates/Section Hub.md`. Section action row = New Doc · New Sub-Section · Move docs.
- [ ] **Step 2:** `test:customjs-loadable` + `test:doc-search` PASS.
- [ ] **Step 3: Commit.** `git commit -m "feat(project): S3 order + simple search on section hubs"`

---

## WS5 — Move-docs tree dialog (`doc-move-dialog.js`)

**Files:** Create `platform/blueprints/project/helpers/doc-move-dialog.js`; register in `manifest.json` `files[]`; Test `platform/test/run-project-doc-move.js` (extend `test:project-doc-move`); wire from `doc-leaf-actions.js` + `doc-bulk-move.js` + WS4 action rows.

### Task 5.1: pure section-tree builder (TDD, mirror `WikiMove.sectionTargets`)

- [ ] **Step 1: Failing test.** Assert depth-ordered targets:

```js
const dm = new DocMoveDialog();
const pages = [
  {type:'section-hub', file:{path:'spice/projects/p/docs/a/A.md'}, title:'A', depth:1},
  {type:'section-hub', file:{path:'spice/projects/p/docs/a/b/B.md'}, title:'B', depth:2},
];
const t = dm.sectionTargets(pages, 'spice/projects/p');
// root ("Docs") first, then A (depth 1), then its child B (depth 2)
assert.deepEqual(t.map(x=>x.label), ['Docs (root)','A','B']);
assert.deepEqual(t.map(x=>x.depth), [0,1,2]);
```

- [ ] **Step 2: Run, verify FAIL.** Run: `npm run test:project-doc-move`.
- [ ] **Step 3: Implement `sectionTargets(pages, projectDir)`** mirroring `WikiMove.sectionTargets`: root `{folder: projectDir+'/docs', label:'Docs (root)', depth:0}`; filter `type==='section-hub'` under `projectDir/docs`; folder = path up to last `/`; depth = folder segments − `(projectDir/docs)` segments; label prefers `title`; lexical sort by folder path (parents before children). Also `targetPath(folder, cur)` and `isNoop(folder, cur)` mirrors.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(project): DocMoveDialog section-tree builder (mirror WikiMove)"`

### Task 5.2: modal + move + frontmatter rewrite

- [ ] **Step 1:** Implement `_openMoveDialog(dv, currentPath)` mirroring `WikiLeafActions._openMoveDialog` (indented overlay, `└` connectors, depth×18px indent, cancel). On pick: `await this.move(dv, folder)`.
- [ ] **Step 2:** Implement `move(dv, targetFolder)`: `app.fileManager.renameFile(activeFile, targetPath)` (noop guard), THEN update the doc's `section` / `sub_section` frontmatter to match the destination folder's section-hub via `app.fileManager.processFrontMatter` (derive section/sub-section labels from the destination path; clear `sub_section` when moving to a depth-1 section). Keep `renameFile` + `processFrontMatter` in that order.
- [ ] **Step 3:** Register the file in `manifest.json` `files[]` (`helpers/doc-move-dialog.js` → `{{scripts_path}}/project/doc-move-dialog.js`). Point `doc-leaf-actions.js` "Move" + `doc-bulk-move.js` at `DocMoveDialog`; retire the old flat `DocMove` picker (keep the class if still referenced; else mark WS9 cleanup).
- [ ] **Step 4:** `npm run test:project-doc-move` + `test:customjs-loadable` + `lint-schemas` PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(project): wiki-style Move tree dialog + section frontmatter rewrite"`

---

## WS6 — Helpful Links (`Links Hub`)

**Files:** Modify `templates/Links Hub.md`, `helpers/project-links-manager.js`, `helpers/project-links-panel.js`; Test `platform/test/run-links.js` (`test:links`).

### Task 6.1: full-width action row + responsive card grid

- [ ] **Step 1: Failing test.** In `test:links`, assert the panel builds a grid container with the responsive template and one card per link (pure `_renderGrid`/data shape):

```js
const panel = new ProjectLinksPanel();
const cards = panel._linkCards([{url:'https://a.com',text:'A'},{url:'https://b.com',text:'B'}]);
assert.equal(cards.length, 2);
assert.equal(cards[0].text, 'A'); assert.equal(cards[0].host, 'a.com');
```

- [ ] **Step 2: Run, verify FAIL.** Run: `npm run test:links`.
- [ ] **Step 3: Implement.** `project-links-panel.js`: render links into a grid `display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:10px;` — each card an anchor (title + host). Add pure `_linkCards(links)` (dedupe by url; derive host). `project-links-manager.js`: render Add link · Manage links as one full-width action row (S4), bracketed by `SectionLabel.divider`. `templates/Links Hub.md`: drop literal `---`/blank-line gaps.
- [ ] **Step 4: Run, verify PASS** + `test:customjs-loadable` PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(project): full-width link actions + responsive links grid"`

---

## WS7 — Breadcrumb coverage (board card notes)

**Files:** Modify `templates/Kanban Card.md`, `templates/Task Board Card.md`, confirm `manifest.json` breadcrumb `types`.

### Task 7.1: breadcrumb + type on promoted board cards

- [ ] **Step 1:** Read `templates/Kanban Card.md`. Its final body writes SpaceNavButtons + ProjectNavButtons but no Breadcrumb and stamps no stable `type`. Add: a `Breadcrumb` dataviewjs block as the FIRST rendered block of the final body, and ensure the promoted note's frontmatter carries `type: task-note` (matching the existing `task-note` breadcrumb block in the manifest) so the trail resolves via `fm:project_name` + Board ancestor. Mirror the ordering rule (Breadcrumb before SpaceNavButtons) so `lint-note-chrome` Rule 2 passes.
- [ ] **Step 2:** Same audit for `Task Board Card.md`. (Board notes themselves — `kanban-plugin:` — stay exempt.)
- [ ] **Step 3:** Verify every project `type` that renders chrome has a manifest breadcrumb block (`project, project-todo, links-hub, docs-hub, section-hub, doc-note, map, kanban, task-note` — all present per manifest). Add any gap found.
- [ ] **Step 4:** `npm run lint-note-chrome` PASS (breadcrumb-first ordering); `test:customjs-loadable` PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(project): breadcrumbs + stable type on promoted board card notes"`

---

## WS8 — Board-card + project-todo button/separator audit

**Files:** Modify `templates/Kanban Card.md`, `templates/Task Board Card.md`, `platform/blueprints/to-do/templates/Project To-Do.md`, `to-do` `ToDoLeafActions` helper.

### Task 8.1: grammar-conform board cards

- [ ] **Step 1:** In the Kanban/Task-Board-Card final bodies, ensure `ProjectNavButtons` renders its own leading divider (WS3) and there is no literal `---`/blank-line chrome gap. No template `---`.
- [ ] **Step 2: Commit.** `git commit -m "fix(project): grammar-conform board-card button chrome"`

### Task 8.2: project-todo full-width action row

- [ ] **Step 1:** Read `Project To-Do.md` + the `to-do` `ToDoLeafActions` helper (renders the New Task / Recurring buttons). Ensure: a `SectionLabel.divider` between the project buttons (`ProjectNavButtons`) and the to-do actions; **New Task + Recurring in ONE full-width row** (S4: `flex:1 1 0; min-width:96px`), bracketed by dividers, no blank lines. Remove the literal template gaps.
- [ ] **Step 2:** `npm run test:todo-dialog` (+ any to-do harness touching leaf actions) PASS; `test:customjs-loadable` PASS.
- [ ] **Step 3: Commit.** `git commit -m "feat(to-do): full-width New Task + Recurring row with divider grammar"`

---

## WS9 — Migrations (heals across headspace/ero/accuris)

**Files:** Modify `platform/install.js`; add seed sentinels under `platform/test/seed-vault/`.

**Posture (every heal):** per-vault, idempotent, `.sauce-backup` snapshot before any write, per-note try/catch, fails loud but never throws. Anchor on class-invocation substrings, NEVER on display markers. Follow `_healWikiChromeBody` (template `---` removal) + `applyProjectNavButtonsSeparatorGap` (blank-line collapse) as the reference implementations.

### Task 9.1: chrome-divider heal (strip literal `---` + blank-line gaps)

- [ ] **Step 1: Seed sentinel.** In `platform/test/seed-vault/`, add a project note (each affected type) carrying the OLD literal-`---` chrome so the migration harness proves the heal. (See `Docs/agent-guides/migration-regression-net.md` for the sentinel pattern.)
- [ ] **Step 2: Implement `applyProjectChromeDividerHeal(vaultPath)`** in `install.js`: walk `spice/projects/**`, for `type ∈ {project, project-todo, docs-hub, section-hub, doc-note, map, kanban, task-note, links-hub}`, remove thematic-break `---` lines adjacent to `class: "…customjs-guard` chrome blocks and collapse blank-line gaps between chrome blocks (mirror `_healWikiChromeBody`'s `---`-strip + the blank-collapse from `applyProjectNavButtonsSeparatorGap`). `.sauce-backup` first; idempotent (second run no-op); per-note try/catch. Register it in the install run order after the existing project heals.
- [ ] **Step 3:** `npm run test:seed` + `test:seed-migrations` PASS (heal fires once, second install no-op).
- [ ] **Step 4: Commit.** `git commit -m "feat(install): heal strips literal --- chrome dividers on existing project notes"`

### Task 9.2: hub Workstreams-block removal heal

- [ ] **Step 1: Seed sentinel** with a `type:project` note carrying the old `ProjectWorkstreamManager` block.
- [ ] **Step 2: Implement `applyProjectHubWorkstreamRemovalHeal`** — remove the `ProjectWorkstreamManager` dataviewjs block from `type:project` hubs (+ collapse the resulting gap). `.sauce-backup`; idempotent; per-note try/catch.
- [ ] **Step 3:** `test:seed` + `test:seed-migrations` PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat(install): heal removes Workstreams block from existing project hubs"`

### Task 9.3: Docs/Links action-row reshape + board-card breadcrumb heals

- [ ] **Step 1: Seed sentinels** for an old-shape Docs.md, an old-shape Links Hub, and a promoted board-card note lacking a breadcrumb/type.
- [ ] **Step 2: Implement** `applyDocsHubActionRowHeal`, `applyLinksHubActionRowHeal` (reshape existing bodies to S3 order — extend `applyDocsHubButtonRepair` rather than duplicate where it already anchors Docs.md), and `applyBoardCardBreadcrumbHeal` (inject Breadcrumb + `type:task-note` into promoted card notes lacking them). Same posture.
- [ ] **Step 3:** `test:seed` + `test:seed-migrations` PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat(install): heal Docs/Links action rows + board-card breadcrumbs"`

---

## WS-visual — Playwright visual verification (before PR)

- [ ] Load a dogfood project surface set in Obsidian (or the seed vault rendered): hub `Projects.md`, a project note, `Docs.md`, a section hub, a doc note, `Links Hub`, a promoted board card, a project-todo note.
- [ ] Screenshot each at **360px** and **desktop**, **light + dark**. Confirm: no "…" truncation; one hairline per boundary (no doubles / no squish); status tight; action rows full-width; links grid responsive; search is bare text-only + empty; Move shows the indented tree; breadcrumbs present on board cards.
- [ ] Tune the `SectionLabel.divider` gap value (8px start) if the screenshots read too tight/loose; it's one line.
- [ ] Record screenshots in the PR description.

---

## WS10 — Documentation

### Task 10.1: rewrite the grammar docs

- [ ] **Step 1:** Rewrite `Docs/agent-guides/note-chrome.md` §1 (chrome grammar), §2 (SectionLabel), §5 (button rules): document the **leading-hairline ownership** rule, the `SectionLabel.divider()` primitive + gap value, the **action-row** layout (S4), the **core-nav + More overflow** pattern, and **universal breadcrumb coverage**. Note the reversal of the old "no `---`, SectionLabel owns dividers only between content" rule.
- [ ] **Step 2:** Update `Docs/agent-guides/project-blueprint-ui.md` §2 (section ordering — drop Workstreams from hub; Map holds workstreams) + §3 (spacing rules → helper-owned hairline, no literal `---`).
- [ ] **Step 3:** Add a one-line pointer in the root `CLAUDE.md` "What not to do"/router so all-blueprint future work follows the grammar (retrofit others later).
- [ ] **Step 4: Commit.** `git commit -m "docs: standardize chrome divider/button/breadcrumb grammar"`

---

## Ship

- [ ] `npm run release:preflight` GREEN (all harnesses + all lint gates).
- [ ] Open a **non-release** PR from `feature/project-chrome-overhaul`. Conventional `feat(project): …` title.
- [ ] If the autoloop stales the branch BEHIND: `gh pr update-branch`; if it stays wedged and the branch has ZERO file-overlap with the base delta and CI is green, `gh pr merge <n> --squash --admin` (NEVER the release PR). Per the autoloop-pr-deadlock lessons.
- [ ] After merge → release pipeline ships to brew → deploy + self-verify on ero (canary) then headspace + accuris (`drift:none`, doctor 0-fail). User must Cmd+R.

---

## Self-review checklist (author, before handoff)

- Spec coverage: WS1 hub ✔, WS2 project note ✔, WS3 nav ✔, WS4 docs search ✔, WS5 move ✔, WS6 links ✔, WS7 breadcrumbs ✔, WS8 board/to-do ✔, WS9 migrations ✔, WS10 docs ✔, standard S1–S6 ✔ (WS0), workstream→Map ✔.
- Type consistency: `SectionLabel.divider(dv)`, `_partitionButtons`, `_sortProjects`, `DocMoveDialog.sectionTargets/targetPath/isNoop/move`, `DocSearch {hideTags,hideNativeSearch,persist}` — names used consistently across tasks.
- No silent caps: heals touch ALL matching notes (no top-N).
