# Project Blueprint — Button & Navigation Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh subagent per task + two-stage review) or superpowers:test-driven-development inline. Steps use `- [ ]` checkboxes. Design: `Docs/plans/2026-07-03-project-blueprint-button-nav-refactor-design.md`.

**Goal:** Collapse the project blueprint's 4–5 chrome tiers into a single breadcrumb-driven bar — one `MenuPopover` primitive powering a unified `Go ▾` launcher (replacing both nav rows), one visible primary action + `⋯` per hub, zero-chrome leaves, per-row task actions cut from three controls to two, and a command mirror.

**Architecture:** One new shared mechanism `menu-popover` (`MenuPopover.open`) — the DRY extraction of the overlay code currently triplicated across SpaceNavButtons / ProjectNavButtons / TripNavButtons. One new project helper `ProjectChromeBar` renders the whole bar (breadcrumb segments + primary + `Go ▾` + `⋯`) from a declarative per-`type` config, delegating actions to the EXISTING helper methods (EntityCreate, DocMoveDialog, ProjectLinksManager, ProjectWorkstreamManager, TaskDialog). `Breadcrumb` gains an additive `buildSegments(dv)` seam. `TaskTodayList.renderTaskRow` swaps pencil+trash for one `⋯`. A `ProjectCommandsInit` startup script registers Obsidian commands. An idempotent `applyProjectChromeBarHeal` migrates existing notes.

**Tech Stack:** customJS classes (pure-Node behavioral harnesses via `loadClass`/`new Function`), Dataview, Obsidian `app.commands`, install.js heals. **Non-negotiables:** every source edit under `platform/` mirrors to its `ranch/scripts/**` dogfood copy; every helper is cold-load-safe and never-throws; new tests append to the `release:preflight` chain in `package.json`.

**Copy map (source → deployed dogfood copy — edit BOTH):**

| Source (tests read this) | Deployed copy (runtime reads this) |
|---|---|
| `platform/mechanisms/menu-popover/menu-popover.js` | `ranch/scripts/menu-popover/menu-popover.js` |
| `platform/mechanisms/breadcrumb/breadcrumb.js` | `ranch/scripts/breadcrumb/breadcrumb.js` |
| `platform/blueprints/project/helpers/project-chrome-bar.js` | `ranch/scripts/project/project-chrome-bar.js` |
| `platform/blueprints/project/helpers/project-commands-init.js` | `ranch/scripts/project/project-commands-init.js` |
| `platform/mechanisms/task-entity/task-today-list.js` | `ranch/scripts/task-entity/task-today-list.js` |

Confirm each deployed path in Task 0 by reading `platform/blueprints/*/manifest.json` `files[]` (the `{{scripts_path}}` dest); `scripts_path` = `ranch/scripts` in this workshop vault. Use `node scripts/dev-sync.js` if present (see Task 0) else `cp` explicitly.

---

## Task 0: Baseline, copy-map, and sync tooling

**Files:** none modified (investigation + baseline).

- [ ] **Step 1: Confirm the deployed-copy paths.** Read `platform/blueprints/project/manifest.json` `files[]` and `platform/mechanisms/task-entity/manifest.json` `files[]`; record the exact `dest` for each file in the copy map. Confirm `scripts_path` resolves to `ranch/scripts`.
- [ ] **Step 2: Find the sync helper.** `ls scripts/ | grep -i sync`; if `dev-sync.js` exists, read its usage. Otherwise plan to `cp` source→dest per the copy map after each task.
- [ ] **Step 3: Green baseline.** Run `npm run test:project-nav && npm run test:task-entity && npm run test:section-label && node platform/test/run-breadcrumb.js && npm run lint-note-chrome`. Expected: all PASS (baseline already verified: 9/9, 94/0, 5/5, 34/34, lint clean).
- [ ] **Step 4: No commit** (investigation only).

---

## Task 1: `MenuPopover` mechanism — the shared popup primitive

The DRY extraction of the desktop-dropdown / mobile-bottom-sheet overlay that SpaceNavButtons `_openLauncher` (space-nav-buttons.js:309–373), ProjectNavButtons `_openMoreMenu` (project-nav-buttons.js:219–291), and TripNavButtons `_openLauncher` (trip-nav-buttons.js:228–292) each duplicate. Powers `Go ▾`, hub `⋯`, and per-row `⋯`.

**Files:**
- Create: `platform/mechanisms/menu-popover/menu-popover.js`
- Create: `platform/mechanisms/menu-popover/manifest.json`
- Create test: `platform/test/run-menu-popover.js`
- Deployed copy: `ranch/scripts/menu-popover/menu-popover.js`

**Interface:**
```js
class MenuPopover {
  // Opens a popup list of actionable rows. Returns the overlay element (with __navClose attached).
  // entries: [{ label, icon?, onSelect(), danger?, sublabel? }]  — sections via { section: "This project" }
  // opts: { anchor?, doc?, isMobile?, title? }
  //   anchor  = trigger element for desktop getBoundingClientRect positioning
  //   doc     = document (default global document) — tests inject a stub
  //   isMobile= force layout; default derives from doc.body.clientWidth <= 600 (guarded)
  // Behavior: single close() teardown removes overlay AND the capture-phase Escape listener
  //   (no listener leak); dismiss on backdrop tap / Escape / re-open toggle; row click → close()+onSelect().
  static open(entries, opts = {}) { /* ... */ }
  static _isMobile(doc) { /* clientWidth <= 600, guarded, default false */ }
  static _partitionSections(entries) { /* group by preceding {section} marker → [{section, rows}] */ }
}
```

Model the overlay/panel/teardown code EXACTLY on space-nav-buttons.js:315–369 (mobile branch 335–342 with the 40×4 handle bar + `env(safe-area-inset-bottom)`; desktop branch 343–351 with the viewport-clamped `getBoundingClientRect` positioning; `close()`/`onKey` teardown 357–362). Rows: reuse the AccentButton-free row builder (icon `<span>` + label `<span>`), `danger:true` colors the label `var(--text-error)`. Append to `opts.doc.body` (default `document.body`).

- [ ] **Step 1: Write failing tests** `platform/test/run-menu-popover.js` using the `loadClass`/`new Function` harness (mirror run-section-label.js DOM stubs). Cases:
  - `MP-1` `_isMobile` returns false for wide stub, true for `clientWidth:390`.
  - `MP-2` `_partitionSections([{section:'This project'},{label:'Board'},{section:'Vault'},{label:'Home'}])` → `[{section:'This project',rows:[Board]},{section:'Vault',rows:[Home]}]`.
  - `MP-3` `open(entries,{doc:stub, anchor:stub})` appends ONE overlay to `stub.body`; overlay has `__navClose`.
  - `MP-4` row click invokes that entry's `onSelect` exactly once AND calls `__navClose` (overlay removed).
  - `MP-5` Escape key handler removed after close (assert `stub.removeEventListener` called with the same fn) — the no-leak invariant.
  - `MP-6` re-`open` with same anchor toggles closed (second call removes prior overlay, adds none) — mirror the toggle guard.
- [ ] **Step 2: Run — expect FAIL** `node platform/test/run-menu-popover.js` → "MenuPopover is not defined".
- [ ] **Step 3: Implement** `menu-popover.js` per the interface, porting the overlay code from space-nav-buttons.js:309–373 verbatim in structure, generalized to take `entries`/`opts`.
- [ ] **Step 4: Write the manifest** `platform/mechanisms/menu-popover/manifest.json` modeled on `platform/mechanisms/section-label/manifest.json` (name `menu-popover`, kind `mechanism`, `customjs_classes:["MenuPopover"]`, `files:[{source:"menu-popover.js",dest:"{{scripts_path}}/menu-popover/menu-popover.js"}]`, no `depends_on`). Match the exact field shape of an existing simple mechanism manifest.
- [ ] **Step 5: Run — expect PASS** `node platform/test/run-menu-popover.js` → all green.
- [ ] **Step 6: Sync + register test.** `cp` source→`ranch/scripts/menu-popover/menu-popover.js`. Append `&& node platform/test/run-menu-popover.js` to `release:preflight` in `package.json`. Add a `"test:menu-popover": "node platform/test/run-menu-popover.js"` script.
- [ ] **Step 7: Commit** `git commit -am "feat(menu-popover): shared desktop-dropdown/mobile-sheet popup primitive"`

---

## Task 2: `Breadcrumb.buildSegments(dv)` — additive trail seam

ProjectChromeBar renders the breadcrumb on the left of its bar, so it needs the resolved segments as data (not rendered HTML). Add an additive method that returns what `render` would draw, without changing `render`'s behavior.

**Files:**
- Modify: `platform/mechanisms/breadcrumb/breadcrumb.js` (add `buildSegments`; refactor `render` to consume it)
- Test: `platform/test/run-breadcrumb.js` (append `BC-SEG-*`)
- Deployed copy: `ranch/scripts/breadcrumb/breadcrumb.js`

**Interface:**
```js
// Returns [{ label, link|null }] for the current page's type entry (ancestors [+ current]),
// resolving atoms/chains exactly as render() does today. Returns [] when no type entry / cold load.
async buildSegments(dv) { /* extract the resolution logic from render() lines 38–82 */ }
```

- [ ] **Step 1: Write failing tests** append `BC-SEG-1..3` to run-breadcrumb.js reusing the existing registry-stub + `dv.current()` stub already in that file. Assert `buildSegments` returns the same labels/links the existing `BC-*` render cases already exercise for a project doc-note, a section-hub, and the projects-hub root (`[]` or single crumb).
- [ ] **Step 2: Run — expect FAIL** `node platform/test/run-breadcrumb.js` → "buildSegments is not a function".
- [ ] **Step 3: Implement** — extract the ancestors/current resolution (breadcrumb.js:52–82) into `buildSegments(dv)` returning the segment array; rewrite `render(dv)` to call `buildSegments` then emit the existing `project-breadcrumb` HTML joined by ` / ` (byte-identical output — the existing `BC-*` cases must still pass).
- [ ] **Step 4: Run — expect PASS** `node platform/test/run-breadcrumb.js` → 34 prior + new all green.
- [ ] **Step 5: Sync.** `cp`→`ranch/scripts/breadcrumb/breadcrumb.js`.
- [ ] **Step 6: Commit** `git commit -am "feat(breadcrumb): buildSegments seam (render output unchanged)"`

---

## Task 3: `ProjectChromeBar` — per-surface config + bar render

The single chrome renderer. One `dv.view` call per template replaces Breadcrumb + SpaceNavButtons + ProjectNavButtons + the action-row helper.

**Files:**
- Create: `platform/blueprints/project/helpers/project-chrome-bar.js`
- Test: `platform/test/run-project-chrome-bar.js`
- Deployed copy: `ranch/scripts/project/project-chrome-bar.js`

**Design.** Reuse ProjectNavButtons `detectContext(filePath, dv)` verbatim (copy the method in, or `require`-free duplicate the 34–171 logic) to get `{ context, projectSlug, projectDir, ... }`. A pure `_surfaceSpec(context)` returns the declarative config:

```js
// Pure, Node-testable. Returns { primary, overflow, leaf }.
//   primary: { id, label, icon } | null      — the single visible ＋ button (hubs only)
//   overflow: [{ id, label, icon, danger? }] — the ⋯ menu action ids
//   leaf: boolean                            — true → no primary, no action ⋯ (nav-only bar)
_surfaceSpec(context) {
  switch (context) {
    case 'projects-hub':  return { primary:{id:'new-project',label:'New Project',icon:ICON.plus}, overflow:[{id:'sort',label:'Sort A–Z / Recent',icon:ICON.sort}], leaf:false };
    case 'project-hub':   return { primary:{id:'new-task',label:'New Task',icon:ICON.plus}, overflow:[{id:'new-doc',label:'New Doc',icon:ICON.docs}], leaf:false };
    case 'docs-hub':      return { primary:{id:'new-doc',label:'New Doc',icon:ICON.plus}, overflow:[{id:'new-section',label:'New Section',icon:ICON.docs},{id:'move-docs',label:'Move docs',icon:ICON.move}], leaf:false };
    case 'section-hub':   return { primary:{id:'new-doc',label:'New Doc',icon:ICON.plus}, overflow:[{id:'new-subsection',label:'New Sub-Section',icon:ICON.docs},{id:'move-docs',label:'Move docs',icon:ICON.move}], leaf:false };
    case 'project-map':   return { primary:{id:'add-workstream',label:'Add workstream',icon:ICON.plus}, overflow:[{id:'remove-workstream',label:'Remove workstream',icon:ICON.minus,danger:true}], leaf:false };
    case 'task-hub':      return { primary:{id:'new-note',label:'New Note',icon:ICON.plus}, overflow:[{id:'task-board',label:'Create/Open Board',icon:ICON.board}], leaf:false };
    case 'links-hub':     return { primary:{id:'add-link',label:'Add link',icon:ICON.plus}, overflow:[{id:'manage-links',label:'Manage links',icon:ICON.gear}], leaf:false };
    case 'doc-note':      return { primary:null, overflow:[{id:'move-docs',label:'Move',icon:ICON.move}], leaf:true };
    case 'project-board': case 'task-board': case 'task-board-card': case 'task-note': default:
                          return { primary:null, overflow:[], leaf:true };
  }
}
```

`render(dv)` builds a single flex container `display:flex; align-items:center; gap:10px; flex-wrap:wrap` with:
- **Left:** breadcrumb segments from `customJS.Breadcrumb.buildSegments(dv)` (fallback: skip if unavailable) rendered as `/`-joined links (reuse the `project-breadcrumb` styling).
- **Right (pushed via `margin-left:auto` wrapper):** `_navEntries(dv,ctx)` → `Go ▾` pill (opens `MenuPopover` with "This project" + "Vault" sections); then, when `!leaf`, the `primary` AccentButton; then, when `overflow.length`, a `⋯` button (opens `MenuPopover` with the overflow entries). Each control ≥44px tall.

`_navEntries(dv, ctx)` builds the launcher entries:
- **This project** section: Board / Docs / Map / To-Do / Links resolved from `ctx.projectDir`/`projectSlug` (mirror the paths ProjectNavButtons already computes; self-current omitted).
- **Vault** section: read `ranch/nav-buttons-registry.json` (same file SpaceNavButtons reads via `_loadRegistry`) and list the pinned vault destinations (Home/Daily/Meetings/Scratch/All Projects) as `openLink` entries.

`_dispatch(dv, ctx, id)` maps action ids to EXISTING helpers (Task 4).

- [ ] **Step 1: Write failing tests** `platform/test/run-project-chrome-bar.js` (loadClass harness). Pure cases first:
  - `PCB-SPEC-1..9` `_surfaceSpec(ctx)` returns the exact primary/overflow/leaf shape above for each context (assert `leaf===true` for doc-note/task-note/boards/cards; `primary.id` for each hub).
  - `PCB-NAV-1` `_navEntries` with a stub `ctx`+stubbed registry returns entries containing a `{section:'This project'}` marker followed by Board/Docs/Map and a `{section:'Vault'}` marker followed by ≥1 vault entry.
  - `PCB-RENDER-1` `render(dv)` on a stub (doc-note) creates exactly: breadcrumb container + a `Go ▾` control + a `⋯` control, and NO primary button (leaf). (stub `customJS.Breadcrumb.buildSegments`, `customJS.MenuPopover.open`, `customJS.AccentButton.render`.)
  - `PCB-RENDER-2` `render(dv)` on a stub (docs-hub) creates a primary labelled "New Doc" + `⋯` + `Go ▾`.
- [ ] **Step 2: Run — expect FAIL** → "ProjectChromeBar is not defined".
- [ ] **Step 3: Implement** `project-chrome-bar.js`: copy `detectContext` from project-nav-buttons.js:34–171, `_surfaceSpec`, `_navEntries`, `_dispatch` (stub dispatch → `new Notice` for now; wired in Task 4), `render`. Cold-load guard via `customJS.RenderSafe.page(dv)` (mirror doc-leaf-actions.js:54). Define `ICON` from project-nav-buttons.js:547–555 + plus/minus/gear/sort/move glyphs already in the helpers.
- [ ] **Step 4: Run — expect PASS**.
- [ ] **Step 5: Sync.** `cp`→`ranch/scripts/project/project-chrome-bar.js`.
- [ ] **Step 6: Commit** `git commit -am "feat(project): ProjectChromeBar — unified breadcrumb-driven chrome bar (config + render)"`

---

## Task 4: Wire `ProjectChromeBar._dispatch` to existing action helpers

Reuse the modal/dialog logic that already exists — do NOT reimplement it.

**Files:** Modify `platform/blueprints/project/helpers/project-chrome-bar.js` (fill `_dispatch`); Test: append `PCB-DISPATCH-*`.

**Mapping (each id → existing call, all cold-load guarded):**
```
new-project      → customJS.EntityCreate.render(<proxy row>, { instance:'project' })   // or the projects-hub create path
new-task         → new (customJS.TaskDialog)().open({ surface:'project', project:<slug/name> })   // confirm ctor/singleton in task-dialog.js
new-doc          → customJS.EntityCreate.render(<proxy>, { instance:'doc-note', presetPrompts:{…} })  // presets per section-hub.js:100–120
new-section      → customJS.EntityCreate.render(<proxy>, { instance:'section-hub' })
new-subsection   → customJS.EntityCreate.render(<proxy>, { instance:'sub-section-hub', presetPrompts:{ parent_slug:<sectionSlug> } })
move-docs (hub)  → customJS.DocBulkMoveActions._onBulkMove(dv)
move-docs (leaf) → customJS.DocMoveDialog._openMoveDialog(dv, <currentPath>)  (fallback DocLeafActions._onMove)
add-link         → customJS.ProjectLinksManager._onAdd(dv)
manage-links     → customJS.ProjectLinksManager._onManage(dv)
add-workstream   → customJS.ProjectWorkstreamManager: expose addWorkstream (see note)
remove-workstream→ customJS.ProjectWorkstreamManager: expose removeWorkstream (see note)
new-note (task)  → ProjectNavButtons task-note create path (reuse _promptForTitle+_createTaskNote) — call customJS.ProjectNavButtons helper methods
task-board       → customJS.ProjectNavButtons._createTaskBoard(projectDir, taskFolder) / open if exists
sort             → toggle ProjectsHubCards sort (reuse its existing toggle)
```

**Note — workstream/task-note handlers are currently nested closures inside `render()`.** Refactor `project-workstream-manager.js` to expose `addWorkstream(dv)` / `removeWorkstream(dv)` as instance methods (extract the closures at lines 120–177 into methods that take `dv`; the existing `render` calls the methods). Same for the task-note create/board closures in project-nav-buttons.js if not already callable — extract to instance methods `createTaskNote(dv)` / `openOrCreateBoard(dv)`. These extractions are pure moves (no behavior change) and keep the old buttons working until templates change (Task 7).

- [ ] **Step 1: Write failing tests** `PCB-DISPATCH-1..N`: stub each `customJS.<Helper>` with a spy; assert `_dispatch(dv,ctx,id)` calls the mapped spy exactly once with the expected args (e.g. `move-docs` on a doc-note calls `DocMoveDialog._openMoveDialog` with the current path; `add-link` calls `ProjectLinksManager._onAdd`).
- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** `_dispatch`; extract the workstream + task-note closures to methods (update their `render` call-sites to the new methods; re-run `test:workstreams-analysis`, `test:project-nav` to confirm no regression).
- [ ] **Step 4: Run — expect PASS** (new dispatch tests + existing nav/workstream tests).
- [ ] **Step 5: Sync** all three touched files → `ranch/scripts/project/`.
- [ ] **Step 6: Commit** `git commit -am "feat(project): ProjectChromeBar action dispatch reuses existing helpers"`

---

## Task 5: Per-row task actions — single `⋯` (3 controls → 2)

**Files:** Modify `platform/mechanisms/task-entity/task-today-list.js` (`renderTaskRow` L359–420 — the pencil+trash block); Test: `platform/test/run-task-entity.js` (append `RTR-DOTS-*`); Deployed copy `ranch/scripts/task-entity/task-today-list.js`.

**Change.** Replace the two icon buttons (EDIT pencil → `TD.open({edit})`, DELETE trash → `TD.confirmDelete`) with ONE `⋯` button in the same fixed 1.5em-tall right cluster. Clicking `⋯` opens `MenuPopover.open` with entries:
```
{ label:'Open note', icon:ICON.open,  onSelect:()=>app.workspace.openLinkText(path,'',false) }
{ label:'Edit',      icon:ICON.edit,  onSelect:()=>TD.open({ edit:path }) }
{ label:'Delete',    icon:ICON.trash, danger:true, onSelect:async()=>{ const r=await TD.confirmDelete(path); if(r&&r.ok) row.remove(); } }
```
Guard: if `customJS.MenuPopover` is unavailable (cold load), fall back to the current pencil+trash inline icons (keep the old code behind the guard so nothing regresses on cold load). Checkbox (L267–301), title + `renderInlineLinks` (L303–339), and chips (L341–357) are UNCHANGED.

- [ ] **Step 1: Write failing test** `RTR-DOTS-1`: real `renderTaskRow` with a DOM stub + `customJS.MenuPopover` spy → assert the row renders exactly ONE trailing action control (the `⋯`), not two; `RTR-DOTS-2`: clicking `⋯` calls `MenuPopover.open` once with 3 entries whose labels are `['Open note','Edit','Delete']`; `RTR-DOTS-3`: the Delete entry's `onSelect` calls `TD.confirmDelete(path)`; `RTR-DOTS-4` (cold-load): with `customJS.MenuPopover` undefined, the row falls back to two inline icons (pencil+trash) — no throw.
- [ ] **Step 2: Run — expect FAIL** `node platform/test/run-task-entity.js` → new cases fail (still two icons).
- [ ] **Step 3: Implement** the `⋯` + MenuPopover wiring with the cold-load fallback; define `ICON.open` (external-link glyph from task-dialog) alongside the existing EDIT/TRASH svg strings.
- [ ] **Step 4: Run — expect PASS** — new cases green AND all existing `RTR-*`/`RACT`/`TDCD` cases still pass (94 baseline).
- [ ] **Step 5: Sync** → `ranch/scripts/task-entity/task-today-list.js`.
- [ ] **Step 6: Commit** `git commit -am "feat(task-entity): per-row single ⋯ menu (Open/Edit/Delete) replaces pencil+trash"`

---

## Task 6: `ProjectCommandsInit` — command mirror

**Files:** Create `platform/blueprints/project/helpers/project-commands-init.js`; Test `platform/test/run-project-commands.js`; Deployed copy `ranch/scripts/project/project-commands-init.js`.

Model EXACTLY on `platform/mechanisms/kanban-status-sync/kanban-status-sync-init.js:32–71` (`invoke()` → `_registerCommands()` → `app.commands.addCommand({id,name,callback})`, idempotent `_registered` guard, all guarded/never-throw). Commands (resolve current project from `app.workspace.getActiveFile()` via ProjectChromeBar.detectContext):
```
sauce-project:new-task, :new-doc, :move-doc, :add-workstream, :add-link,
sauce-project:go-board, :go-docs, :go-map, :go-todo, :go-links
```
Each callback delegates to the SAME `ProjectChromeBar._dispatch` / nav paths (single source of truth). Register via `customjs_startup_scripts` (Task 8).

- [ ] **Step 1: Write failing test** `PCI-1`: stub `app.commands.addCommand` spy; `new ProjectCommandsInit().invoke()` registers the 10 command ids above (assert count + ids); `PCI-2`: second `invoke()` is a no-op (idempotent); `PCI-3`: missing `app.commands` → no throw.
- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** per the kanban-status-sync pattern.
- [ ] **Step 4: Run — expect PASS**. Register test in `release:preflight` + `test:project-commands` script.
- [ ] **Step 5: Sync** → `ranch/scripts/project/project-commands-init.js`.
- [ ] **Step 6: Commit** `git commit -am "feat(project): ProjectCommandsInit — nav+create command mirror"`

---

## Task 7: Rewrite project templates to the single chrome bar

**Files:** Modify each template under `platform/blueprints/project/templates/` — deployed copies under `ranch/…/templates` per manifest `files[]` (sync both).

For every surface template, replace the top chrome stack (the three `dv.view(... {class:"Breadcrumb"})`, `{class:"SpaceNavButtons"}`, `{class:"ProjectNavButtons"}` blocks AND the per-surface action-row block — `ProjectDocsIndex.renderActionRow`, `SectionHub` action row, `DocLeafActions`, `ProjectLinksManager`, `ProjectWorkstreamManager`) with ONE block:
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
```
Per the extraction report, the templates + their `type` are: Project.md (project), Docs Hub.md (docs-hub), Section Hub.md (section-hub), Doc Note.md (doc-note), Links Hub.md (links-hub), Project Map.md (map), Kanban Card.md (task-hub), Task Note.md (task-note), Project Board.md (kanban), Task Board.md (kanban), Task Board Card.md (task-board-card), Projects.md (projects-hub). Kanban board templates keep their `## Column` headings (obsidian-kanban) — only swap the chrome header. Content widgets below (ProjectStatusWidget, ProjectActivityPanel, ProjectMeetingsPanel, ProjectLinksPanel, ProjectWorkstreams display, search strips, EntityCreate markers for docs) STAY. The docs/section search strip stays as its own block below the bar.

- [ ] **Step 1** For each template, edit the chrome header to the single ProjectChromeBar block; keep the `// entity-create:*` installer markers intact (ProjectChromeBar dispatches New Doc through EntityCreate, but the marker comments are installer-managed — leave them).
- [ ] **Step 2: Update note-chrome lint expectations.** Run `npm run lint-note-chrome`; the adopted-template scan now sees ProjectChromeBar instead of the old trio. Update `scripts/lint-note-chrome.js` allow-list / expected-chrome for project templates if it asserts specific classes (read it first; adjust the project entries only).
- [ ] **Step 3: Run** `npm run lint-note-chrome` → clean; `npm run test:project-nav` still green (ProjectNavButtons not yet deleted).
- [ ] **Step 4: Sync** every edited template → its `ranch` copy.
- [ ] **Step 5: Commit** `git commit -am "feat(project): templates render the single ProjectChromeBar (retire stacked chrome)"`

---

## Task 8: Manifest wiring

**Files:** Modify `platform/blueprints/project/manifest.json`; `platform/mechanisms/task-entity/manifest.json`; `platform/blueprints/project/manifest.json` `depends_on`.

- [ ] **Step 1** Project manifest: add `ProjectChromeBar`, `ProjectCommandsInit` to `customjs_classes[]`; add both source→dest pairs to `files[]`; add `"ProjectCommandsInit"` to `customjs_startup_scripts[]`; add `{ name:"menu-popover", version:"^<v>" }` to `depends_on[]`.
- [ ] **Step 2** task-entity manifest: add `{ name:"menu-popover", ... }` to `depends_on[]` (per-row `⋯` uses it).
- [ ] **Step 3** Register the new `menu-popover` mechanism in whatever top-level component index the installer reads (grep how `section-label` is listed as an installable mechanism — e.g. a `platform/components.json` / seed subscription; mirror it). Add `menu-popover` there.
- [ ] **Step 4: Do NOT touch versions.** Leave every `version` field alone — the release bumper computes them. (CLAUDE.md: hand-editing versions is the pipeline's job.)
- [ ] **Step 5: Run** `npm run lint-schemas && npm run test:customjs-loadable` → new classes resolve; manifest schema valid.
- [ ] **Step 6: Commit** `git commit -am "chore(project): manifest wiring for ProjectChromeBar + ProjectCommandsInit + menu-popover dep"`

---

## Task 9: `applyProjectChromeBarHeal` — migrate existing notes

**Files:** Modify `platform/install.js` (add heal fn + wire into the chain ~1235); Test `platform/test/run-project-chrome-bar-heal.js` (seed-note based, mirror run-doc-leaf-actions-heal.js).

Model EXACTLY on `applyProjectMeetingsPanelHeal` (install.js:2509–2708) and `applyProjectChromeDividerHeal`. For every `.md` under `spice/projects/**` whose frontmatter `type` is a project surface: if the body still contains the old chrome trio (`class: "SpaceNavButtons"` + `class: "ProjectNavButtons"`), replace that stacked header (through the old action-row block) with the single ProjectChromeBar block. Idempotency guard: skip if body already contains `class: "ProjectChromeBar"`. `.sauce-backup/${ts}/…` snapshot before write; per-file try/catch; `history` info/warning/summary events with `step:"project_chrome_bar_heal"`; never throw. Gate with `_migrationGated` on the introducing version if appropriate.

- [ ] **Step 1: Write failing test** using a seed fixture note carrying the OLD chrome trio; assert after heal the note contains exactly one `ProjectChromeBar` block and zero `SpaceNavButtons`/`ProjectNavButtons`, backup written, second run is a no-op (idempotent).
- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** the heal + wire into the invocation chain (after `applyProjectChromeDividerHeal`).
- [ ] **Step 4: Run — expect PASS**; also `npm run test:seed && npm run test:migration-gate`.
- [ ] **Step 5: Register test** in `release:preflight`.
- [ ] **Step 6: Commit** `git commit -am "feat(install): applyProjectChromeBarHeal migrates existing project chrome"`

---

## Task 10: Retire ProjectNavButtons + guide/lint updates

**Files:** `platform/blueprints/project/helpers/project-nav-buttons.js` (neuter render, keep extracted helper methods used by ProjectChromeBar/commands), the four action-row helpers (keep their modal/dispatch methods, remove now-dead button-row renderers ONLY if no longer referenced), `Docs/agent-guides/note-chrome.md`, `Docs/agent-guides/project-blueprint-ui.md`.

- [ ] **Step 1** Confirm via grep that no template still calls `ProjectNavButtons`/`renderActionRow`/`DocLeafActions.render`/`ProjectLinksManager.render`/`ProjectWorkstreamManager.render` as a chrome block. Where a helper's `render` is now unused, leave the class + its action methods (dispatch reuses them) but delete the dead button-row body, OR leave as-is if still referenced by the heal fallback. Prefer minimal deletion; do not remove methods ProjectChromeBar `_dispatch` calls.
- [ ] **Step 2** Update `note-chrome.md` + `project-blueprint-ui.md`: document the new grammar (breadcrumb-driven single bar: breadcrumb + `Go ▾` + primary + `⋯`; zero-chrome leaves; per-row `⋯`). Mark the old "core-nav + More▾ + action rows" section as superseded for the project blueprint.
- [ ] **Step 3** Update any lint (`lint-note-chrome.js`) rules that asserted the old project chrome classes.
- [ ] **Step 4: Run** the full project + chrome test subset: `npm run test:project-nav && npm run test:project-chrome-bar && npm run lint-note-chrome && npm run test:links && npm run test:project-doc-move && npm run test:workstreams-analysis`.
- [ ] **Step 5: Commit** `git commit -am "refactor(project): retire stacked nav chrome; docs+lint reflect breadcrumb-driven bar"`

---

## Task 11: Sync sweep + full source↔ranch parity check

- [ ] **Step 1** For every file touched, diff source vs `ranch` copy; ensure identical. `node scripts/dev-sync.js` if it exists, else `cp` per copy map.
- [ ] **Step 2** `git status` — confirm no stray/untracked files; `git add -A` the ranch copies.
- [ ] **Step 3: Commit** `git commit -am "chore(project): sync source→ranch dogfood copies"`

---

## Task 12: Visual validation harness (internal gate)

**Files:** `platform/test/visual/project-chrome-bar.html` (throwaway harness — do NOT ship in manifest).

- [ ] **Step 1** Build a faithful HTML replica: exact AccentButton CSS (accent-button.js:54), MenuPopover mobile-sheet + desktop-dropdown CSS, ProjectChromeBar flex layout, per-row `⋯` cluster, breadcrumb styling, with FAINT dark-theme `--background-modifier-*` vars. Render: (a) project hub, (b) docs hub, (c) doc-note leaf, (d) a task list row set.
- [ ] **Step 2** `python3 -m http.server` in the harness dir (Playwright MCP blocks `file://`); navigate at 390px and 1024px, light + dark; screenshot each.
- [ ] **Step 3** Self-review the screenshots against acceptance criteria: ≤1 primary + `Go ▾` + `⋯`; no second nav row; leaves nav-only; per-row 2 controls; nothing clips at 390px; targets ≥44px. Fix CSS in the real helpers if the shot reveals clipping/misalignment (re-run the affected Node tests after any helper change).
- [ ] **Step 4: Commit** `git commit -am "test(project): visual harness for the chrome-bar refactor"` (harness kept for future regressions; excluded from manifest `files[]`).

---

## Task 13: Full preflight + code review

- [ ] **Step 1** `npm run release:preflight` — the entire gate must be green (all ~95 test files + lints + version-sync). Fix any red.
- [ ] **Step 2** Invoke superpowers:requesting-code-review on the branch diff; address findings (verify each per receiving-code-review before applying).
- [ ] **Step 3** Re-run `npm run release:preflight` after review fixes → green.
- [ ] **Step 4: Commit** any fixes.

---

## Task 14: Ship (handled by the orchestrator, not a subagent)

- [ ] Push branch; `git merge origin/main` (avoid the BEHIND treadmill); resolve; re-run preflight.
- [ ] Open PR; wait for green CI; merge the FEATURE PR. **Do NOT merge the auto-release PR** — the bumper opens it and it auto-merges.
- [ ] Wait for the release pipeline → tag → brew tap PR; merge the tap PR per `Docs/agent-guides/build-test-verify.md` § brew-tap chain.
- [ ] `git fetch --tags` then `brew upgrade sauce` (or `deploy.js`); ensure `menu-popover` + project changes are subscribed for accuris/headspace/ero (add to each `ranch/platform-subscription.json` if a new mechanism isn't auto-pulled as a dep — see `lesson_new_blueprint_needs_consumer_subscription`).
- [ ] `bash -c 'cd <vault> && sauce update --force'` for each of accuris, headspace, ero; verify deployed ProjectChromeBar signature live.
- [ ] Report back.

---

## Self-review (author checklist)

- **Spec coverage:** unified bar (T3/T7), Go▾ replaces both nav rows (T3 `_navEntries`), one primary + ⋯ (T3 `_surfaceSpec`), zero-chrome leaves (T3 `leaf`), per-row 3→2 (T5), command mirror (T6), pure-custom/no-plugin (all), heal (T9), guides (T10), visual gate (T12). ✔
- **Symbol consistency:** `MenuPopover.open(entries,opts)`, `Breadcrumb.buildSegments(dv)`, `ProjectChromeBar._surfaceSpec/_navEntries/_dispatch/render`, `ProjectCommandsInit.invoke/_registerCommands` — used identically across tasks. ✔
- **No placeholders:** every task has files, test ids, exact existing patterns to model, and a commit. Mechanical steps (heal/manifest/templates/sync) cite the exact existing code to copy. ✔
- **Risk:** heal mutates real notes → backup+idempotent+never-throw+seed-tested (T9); SpaceNavButtons untouched (only un-called on project surfaces) so other blueprints unaffected; MenuPopover cold-load fallback in renderTaskRow (T5) prevents regression.
