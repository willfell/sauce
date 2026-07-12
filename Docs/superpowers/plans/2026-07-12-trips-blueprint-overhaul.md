# Trips Blueprint Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the `trips` blueprint up to current platform conventions — remove legacy chrome, add category/item packing lists, structured flights/stay entries, helpful links, a to-do↔trip link, and an atlas dashboard.

**Architecture:** Trips already renders via the shared `TripsChromeBar` (ChromeBar adapter). This overhaul (a) makes `TripNavButtons` a headless logic class so it can no longer double-render chrome, (b) scopes "New Section" to the atlas, (c) adds one shared `TripEntryList` CRUD helper (pure-logic static ops + form-modal render, patterned on `ProjectLinksManager`) reused by Packing/Flights/Stay, (d) adds a per-trip Links sidecar (patterned on project links), (e) wires the real `ToDoCreateTask` dialog with a gated Trip dropdown, and (f) adds a `TripDashboard` on the atlas. An extended `applyTripsConformanceHeal` forward-migrates existing notes.

**Tech Stack:** customJS helper classes (bare class expressions, no trailing statements), Dataview render blocks, Obsidian `app.fileManager.processFrontMatter`, Node behavioral harness (`platform/test/run-*.js`), `platform/install.js` heals, `platform/schemas-index.json` rule_fragments.

**Reference files to pattern from (read these before coding):**
- CRUD helper: `platform/blueprints/project/helpers/project-links-manager.js`, `project-links-panel.js`
- Chrome adapter: `platform/blueprints/trips/helpers/trips-chrome-bar.js`
- Section kinds SSOT: `platform/blueprints/trips/helpers/trip-section-kinds.js`
- Chrome heal precedent: `applyProjectChromeBarHeal` / `applyDailyHomeChromeBarHeal` in `platform/install.js`
- To-do dialog: `platform/blueprints/to-do/helpers/todo-create-task.js` (project dropdown ~L286–308, `_loadProjectList` ~L771–782)
- Existing trips tests: `platform/test/run-trips.js`, `run-trips-heal.js`, `run-trips-chrome-bar.js`

**customJS invariant:** every helper file MUST be a single bare `class X { ... }` expression with NO trailing statements (the loader evals `("+file+")`). Classes are stored as INSTANCES; `render`/handlers are instance methods, pure ops are `static`.

**Convention:** commit after every green task. Do NOT bump `manifest.json` version, `package.json`, pins, or tags — the release pipeline owns versioning.

---

### Task 1: Add `links` section kind + schema enum

**Files:**
- Modify: `platform/blueprints/trips/helpers/trip-section-kinds.js`
- Modify: `platform/blueprints/trips/manifest.json` (rule_fragment `section_kind` regex)
- Modify: `platform/schemas-index.json` (if it mirrors the enum — grep first)
- Modify: `platform/install.js` (`TRIP_SECTION_KINDS` Node mirror array)
- Test: `platform/test/run-trips.js` (extend existing)

- [ ] **Step 1: Write failing test** — in `run-trips.js`, add assertions that `new TripSectionKinds().all()` includes `{kind:"links", label:"Links"}` at order 5, `order("links") === 5`, `labelFor("links") === "Links"`, and `iconFor("links")` returns a non-empty `<svg`.

- [ ] **Step 2: Run** `node platform/test/run-trips.js` — Expected: FAIL (no links kind).

- [ ] **Step 3: Implement** — add to `all()` array after `notes`:
```js
{ kind: "links", label: "Links", legacy: "Trip Links" },
```
Add a `links` icon to `iconFor`'s `I` map (use a link/chain glyph):
```js
links: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
```
Update `manifest.json` rule_fragment regex `^(flights|stay|packing-list|to-do|notes|custom)$` → `^(flights|stay|packing-list|to-do|notes|links|custom)$`. Grep `platform/schemas-index.json` for the same regex and update if present. Update the `TRIP_SECTION_KINDS` array in `install.js` to include `links` (keep in lockstep per its comment).

- [ ] **Step 4: Run** `node platform/test/run-trips.js` && `npm run lint-schemas` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(trips): add links section kind + schema enum"`

---

### Task 2: Scope "New Section" to the atlas only

**Files:**
- Modify: `platform/blueprints/trips/helpers/trips-chrome-bar.js` (`_config().surfaceSpec`)
- Test: `platform/test/run-trips-chrome-bar.js`

- [ ] **Step 1: Write failing test** — assert `surfaceSpec({context:"trip-section"}).overflow` is empty `[]` and `.leaf === true`; assert `surfaceSpec({context:"trip"}).overflow` still contains a `new-section` entry.

- [ ] **Step 2: Run** `node platform/test/run-trips-chrome-bar.js` — Expected: FAIL (leaf still gets newSection).

- [ ] **Step 3: Implement** — in `surfaceSpec`, change the leaf branch so only the `trip` (atlas) context returns `overflow:[newSection]`; `trip-section`/`trip-board-card` return `overflow:[]`:
```js
if (ctx.context === "trip") {
  return { primary: null, overflow: [newSection], leaf: false };
}
// trip-section / trip-board-card — no create action on leaf surfaces
return { primary: null, overflow: [], leaf: true };
```

- [ ] **Step 4: Run** `node platform/test/run-trips-chrome-bar.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "fix(trips): offer New Section only on the trip atlas"`

---

### Task 3: Strip `TripNavButtons` to headless logic + fix section body

**Files:**
- Modify: `platform/blueprints/trips/helpers/trip-nav-buttons.js`
- Test: `platform/test/run-trips.js`

`TripNavButtons` must KEEP: `_createTrip`, `_createTripSection`, `_promptForTripDetails`, `_promptForSectionTitle`, `_sanitizeFilename`, `_isoWithTz`, `writeTpl` and any helpers those call. It must DELETE: `render()`, `detectContext()`, `_tripMenuEntries()`, `_openLauncher()`, `_buildOverlayRow()`, `_renderPill()` and any other launcher-overlay/DOM code (grep for `createEl`/`.trips-chrome-root`).

- [ ] **Step 1: Write failing test** — add a test that reads the *string body* produced by `_createTripSection` logic. Since it calls `app.vault.create`, instead assert on a new pure method `_sectionBody(title, tripName, tripSlug, isoTz)` (extract the template string into this method). Test: body contains `class: "TripsChromeBar"`, `section_kind: custom`, and contains **none** of `class: "Breadcrumb"`, `class: "SpaceNavButtons"`, `class: "TripNavButtons"`.

- [ ] **Step 2: Run** `node platform/test/run-trips.js` — Expected: FAIL (`_sectionBody` undefined / legacy blocks present).

- [ ] **Step 3: Implement** — extract the body into `_sectionBody(...)` returning:
```js
`---
type: trip-section
section_kind: custom
section: "${title}"
trip: "[[${this._sanitizeFilename(tripName)}]]"
trip_slug: ${tripSlug}
created_at: "${isoTz}"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripsChromeBar" });
\`\`\`
`
```
Have `_createTripSection` call `this._sectionBody(...)`. Delete `render()`/`detectContext()`/launcher methods. Then run `npm run test:customjs-loadable` (or `node platform/test/run-customjs-loadable.js`) to confirm the file still evals as one class expression.

- [ ] **Step 4: Run** `node platform/test/run-trips.js && node platform/test/run-customjs-loadable.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "refactor(trips): TripNavButtons headless; new sections use TripsChromeBar only"`

---

### Task 4: Extend `applyTripsConformanceHeal` to strip legacy chrome

**Files:**
- Modify: `platform/install.js` (`applyTripsConformanceHeal` + a new `_tripStripLegacyChrome` helper)
- Test: `platform/test/run-trips-heal.js`

- [ ] **Step 1: Write failing test** — given a note body containing a `Breadcrumb` guard block + a `SpaceNavButtons` block + a `TripsChromeBar` block, `_tripStripLegacyChrome(body)` returns a body with the Breadcrumb + SpaceNavButtons blocks removed and exactly one `TripsChromeBar` block. Given a body with NO `TripsChromeBar` block but a legacy `TripNavButtons` block, it replaces the legacy nav block(s) with a single `TripsChromeBar` block. Idempotent: running it twice equals running once.

- [ ] **Step 2: Run** `node platform/test/run-trips-heal.js` — Expected: FAIL (`_tripStripLegacyChrome` undefined).

- [ ] **Step 3: Implement** — add `_tripStripLegacyChrome(body)`:
```js
function _tripStripLegacyChrome(body) {
  const guard = 'ranch/views/customjs-guard';
  // Remove any dataviewjs guard block whose class is Breadcrumb/SpaceNavButtons/TripNavButtons.
  const legacyRe = /```dataviewjs\s*\n\s*await dv\.view\("[^"]*customjs-guard",\s*\{\s*class:\s*"(Breadcrumb|SpaceNavButtons|TripNavButtons)"[^}]*\}\s*\)\s*;?\s*\n```\n?/g;
  let out = body.replace(legacyRe, '');
  const chromeBlock = '```dataviewjs\nawait dv.view("' + guard + '", { class: "TripsChromeBar" });\n```\n';
  if (!/class:\s*"TripsChromeBar"/.test(out)) {
    // Insert one chrome block immediately after the frontmatter close.
    const m = out.match(/^---\n[\s\S]*?\n---\n/);
    if (m) out = m[0] + '\n' + chromeBlock + out.slice(m[0].length).replace(/^\n+/, '');
    else out = chromeBlock + out;
  }
  // Collapse >1 TripsChromeBar block to the first.
  let seen = false;
  out = out.replace(/```dataviewjs\s*\n\s*await dv\.view\("[^"]*customjs-guard",\s*\{\s*class:\s*"TripsChromeBar"[^}]*\}\s*\)\s*;?\s*\n```\n?/g, (mBlock) => {
    if (seen) return '';
    seen = true; return mBlock;
  });
  return out;
}
```
Wire it into `applyTripsConformanceHeal`'s per-note write path (call on the note body before writing, alongside the existing `.sauce-backup` + idempotent write). Export it on `module.exports` next to the other trip helpers so the harness can require it (match how `run-trips-heal.js` imports existing helpers).

- [ ] **Step 4: Run** `node platform/test/run-trips-heal.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(trips): heal strips legacy chrome to single TripsChromeBar"`

---

### Task 5: Shared `TripEntryList` CRUD helper

**Files:**
- Create: `platform/blueprints/trips/helpers/trip-entry-list.js`
- Create: `platform/test/run-trip-entry-list.js`
- Modify: `package.json` (add `"test:trip-entry-list": "node platform/test/run-trip-entry-list.js"`)
- Modify: `platform/blueprints/trips/manifest.json` (files[] + customjs_classes[])

`TripEntryList` provides static, unit-tested array ops over `[{...}]` frontmatter, plus an instance `render(dv, spec)` that draws rows + an Add form modal (pattern: `ProjectLinksManager`). `spec = { key, fields:[{name,label,placeholder}], group?, checkbox?, title(entry), subtitle(entry) }`.

- [ ] **Step 1: Write failing test** — `run-trip-entry-list.js` requires the class and asserts:
```js
const {addEntry, updateEntry, deleteEntry, toggleChecked, addCategory} = TripEntryList;
// addEntry appends a NEW array, trims strings, rejects fully-empty entry
let r = TripEntryList.addEntry([], {item:" socks ", category:"Clothing", checked:false});
assert(r.changed && r.list.length===1 && r.list[0].item==="socks");
// deleteEntry bad index no-op
assert(TripEntryList.deleteEntry([{a:1}], 5).changed===false);
// toggleChecked flips checked at index
r = TripEntryList.toggleChecked([{item:"x",checked:false}],0);
assert(r.list[0].checked===true);
// addCategory adds a placeholder-free category marker only if absent
r = TripEntryList.addCategory([{category:"A",item:"x"}], "A");
assert(r.changed===false); // dup category no-op
r = TripEntryList.addCategory([], "Toiletries");
assert(r.changed===true && r.list.some(e=>e.category==="Toiletries"));
```

- [ ] **Step 2: Run** `node platform/test/run-trip-entry-list.js` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** static ops (each returns `{list, changed, reason?}`, `list` always a new array):
```js
class TripEntryList {
  static _norm(entry) {
    const out = {};
    for (const k of Object.keys(entry || {})) {
      out[k] = typeof entry[k] === "string" ? entry[k].trim() : entry[k];
    }
    return out;
  }
  static addEntry(list, entry) {
    const l = Array.isArray(list) ? list.slice() : [];
    const e = TripEntryList._norm(entry);
    const meaningful = Object.keys(e).some(k => k !== "category" && k !== "checked" && e[k]);
    if (!meaningful) return { list: l, changed: false, reason: "empty" };
    l.push(e); return { list: l, changed: true };
  }
  static updateEntry(list, index, entry) {
    const l = Array.isArray(list) ? list.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l[index] = TripEntryList._norm(entry); return { list: l, changed: true };
  }
  static deleteEntry(list, index) {
    const l = Array.isArray(list) ? list.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l.splice(index, 1); return { list: l, changed: true };
  }
  static toggleChecked(list, index) {
    const l = Array.isArray(list) ? list.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l[index] = Object.assign({}, l[index], { checked: !l[index].checked }); return { list: l, changed: true };
  }
  static addCategory(list, category) {
    const l = Array.isArray(list) ? list.slice() : [];
    const c = String(category || "").trim();
    if (!c) return { list: l, changed: false, reason: "empty" };
    if (l.some(e => e && e.category === c)) return { list: l, changed: false, reason: "duplicate" };
    l.push({ category: c }); return { list: l, changed: true };
  }
  // instance render(dv, spec) — see Step 3b
}
```

- [ ] **Step 3b: Implement `render(dv, spec)` + modal** — pattern-match `ProjectLinksManager.render`/`_openForm`/`_openModal`/`_write` exactly (copy the modal/form scaffolding). Differences: read `dv.current()[spec.key]` for the array; write via `processFrontMatter(file, fm => fm[spec.key] = list)`; if `spec.group` truthy, render rows grouped by `category` with a leading category label; if `spec.checkbox` truthy, each row gets a checkbox calling `TripEntryList.toggleChecked` then `_write`; Add button opens a form built from `spec.fields`. For packing, the Add button offers two actions ("Add category" → prompt one text field → `addCategory`; "Add item" → form with a `category` `<select>` populated from existing distinct categories + item text). Use `customJS.AccentButton`, `customJS.SectionLabel.divider` (guarded), and the `.sauce-links-modal-overlay`-style overlay. Cold-load guard via `customJS.RenderSafe.page`.

- [ ] **Step 4: Run** `node platform/test/run-trip-entry-list.js && node platform/test/run-customjs-loadable.js` — Expected: PASS. Register in `manifest.json`: add `helpers/trip-entry-list.js` → `{{scripts_path}}/trips/trip-entry-list.js` in `files[]`, and `"TripEntryList"` in `customjs_classes[]`.

- [ ] **Step 5: Commit** — `git commit -am "feat(trips): TripEntryList shared CRUD helper"`

---

### Task 6: Wire Packing List template

**Files:**
- Modify: `platform/blueprints/trips/templates/Trip Packing List.md`

- [ ] **Step 1** (no unit test — template wiring; covered by render-guard + seed). Add a `packing_items: []` line to the frontmatter (after `created_at`). After the `TripsChromeBar` block append:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "TripEntryList", method: "render",
  args: [{ key: "packing_items", group: true, checkbox: true,
           fields: [{name:"category",label:"Category",placeholder:"Clothing"},
                    {name:"item",label:"Item",placeholder:"Socks"}],
           title: e => e.item, subtitle: e => e.category }]
});
```
```

- [ ] **Step 2: Run** `node platform/test/run-trips-render-guards.js` — Expected: PASS (no throw on cold-load). Add `Trip Packing List.md` to that guard test's template list if it enumerates templates.

- [ ] **Step 3: Commit** — `git commit -am "feat(trips): categorized packing list with add/check-off"`

---

### Task 7: Wire Flights template

**Files:**
- Modify: `platform/blueprints/trips/templates/Trip Flights.md`

- [ ] **Step 1** — add `flights: []` frontmatter; append after chrome:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "TripEntryList", method: "render",
  args: [{ key: "flights",
           fields: [{name:"airline",label:"Airline",placeholder:"Delta"},
                    {name:"flight_no",label:"Flight #",placeholder:"DL123"},
                    {name:"from",label:"From",placeholder:"DEN"},
                    {name:"to",label:"To",placeholder:"DTW"},
                    {name:"depart_at",label:"Departs",placeholder:"2026-08-01 09:00"},
                    {name:"arrive_at",label:"Arrives",placeholder:"2026-08-01 13:00"},
                    {name:"confirmation",label:"Confirmation",placeholder:"ABC123"}],
           title: e => (e.airline||"")+" "+(e.flight_no||""),
           subtitle: e => (e.from||"")+" → "+(e.to||"")+"  "+(e.depart_at||"") }]
});
```
```

- [ ] **Step 2: Run** `node platform/test/run-trips-render-guards.js` — Expected: PASS.

- [ ] **Step 3: Commit** — `git commit -am "feat(trips): structured flights entries"`

---

### Task 8: Wire Stay template

**Files:**
- Modify: `platform/blueprints/trips/templates/Trip Stay.md`

- [ ] **Step 1** — add `stays: []` frontmatter; append after chrome:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "TripEntryList", method: "render",
  args: [{ key: "stays",
           fields: [{name:"name",label:"Name",placeholder:"Beachside Resort"},
                    {name:"address",label:"Address",placeholder:"123 Ocean Dr"},
                    {name:"check_in",label:"Check-in",placeholder:"2026-08-01"},
                    {name:"check_out",label:"Check-out",placeholder:"2026-08-05"},
                    {name:"confirmation",label:"Confirmation",placeholder:"HTL999"}],
           title: e => e.name,
           subtitle: e => (e.check_in||"")+" → "+(e.check_out||"") }]
});
```
```

- [ ] **Step 2: Run** `node platform/test/run-trips-render-guards.js` — Expected: PASS.

- [ ] **Step 3: Commit** — `git commit -am "feat(trips): structured stay entries"`

---

### Task 9: Helpful Links section

**Files:**
- Create: `platform/blueprints/trips/templates/Trip Links.md`
- Create: `platform/blueprints/trips/helpers/trip-links-panel.js` (read-only render)
- Create: `platform/blueprints/trips/helpers/trip-links-manager.js` (add/manage)
- Create: `platform/test/run-trip-links.js`
- Modify: `package.json` (`"test:trip-links"`)
- Modify: `platform/blueprints/trips/manifest.json` (files[] + customjs_classes[] + files entry for the template)

- [ ] **Step 1: Write failing test** — `run-trip-links.js` mirrors project links tests: assert `TripLinksManager.addLink`, `updateLink`, `deleteLink` behave (dedup by url, text defaults to url, bad-index no-op). (Copy the assertions from the project links test if one exists.)

- [ ] **Step 2: Run** `node platform/test/run-trip-links.js` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** — copy `project-links-manager.js` → `trip-links-manager.js` and `project-links-panel.js` → `trip-links-panel.js`, renaming the classes to `TripLinksManager`/`TripLinksPanel` and changing the note-type guard from `links-hub` to `trip-section` + `section_kind === "links"`. Keep the static ops identical. Create `Trip Links.md`:
```
---
type: trip-section
section_kind: links
section: "Links"
trip: "[[{{NAME}}]]"
trip_slug: {{SLUG}}
created_at: "{{DATE}}"
links: []
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripLinksManager", method: "render" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripLinksPanel", method: "render" });
```
```
Register the template (`files[]` → `{{templates_path}}/Template, Trip Links.md`), the two helpers (`files[]`), and `"TripLinksPanel"`,`"TripLinksManager"` in `customjs_classes[]`.

- [ ] **Step 4: Run** `node platform/test/run-trip-links.js && node platform/test/run-customjs-loadable.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(trips): helpful links section"`

---

### Task 10: To-Do ↔ Trip link

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-create-task.js` (add gated Trip dropdown + `[trip::]` on submit + `_loadTripList`)
- Create: `platform/blueprints/trips/helpers/trip-todo-actions.js` (Add-task button + open-tasks query on the Trip To Do note)
- Modify: `platform/blueprints/trips/templates/Trip To Do.md`
- Modify: `platform/test/run-todo-dialog.js` (gated dropdown + field write) and `platform/blueprints/trips/manifest.json`
- Modify: `package.json` if a new test script is needed

- [ ] **Step 1: Write failing test** — in `run-todo-dialog.js`: (a) with `window.customJS.TripsChromeBar` present, the built form includes a Trip `<select>`; with it absent, no Trip select. (b) `_loadTripList()` scans `spice/trips` for `type==="trip"` and maps to `{slug,name}`. (c) submitting with a selected trip appends `[trip:: [[<Name>]]]` to the task line. Assert on the pure payload/line-builder (extract a `_appendTripField(line, tripName)` if needed to keep it testable).

- [ ] **Step 2: Run** `node platform/test/run-todo-dialog.js` — Expected: FAIL.

- [ ] **Step 3: Implement** — mirror the project dropdown: add `_loadTripList()` (copy `_loadProjectList`, swap `"spice/projects"`→`"spice/trips"`, `p.type==="project"`→`p.type==="trip"`, `p.project_slug`→`p.trip_slug`). Render the Trip `<select>` only when `window.customJS && window.customJS.TripsChromeBar`. On submit, if a trip is chosen, append `[trip:: [[${name}]]]` to the task line (same spot as `[project:: ...]`). Support an initial-state `preselectTripSlug` so the trip's Add-task button can pre-select. Create `trip-todo-actions.js`:
```js
class TripToDoActions {
  render(dv) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file || page.type !== "trip-section" || page.section_kind !== "to-do") return;
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;
    const TD = window.customJS && window.customJS.ToDoCreateTask;
    if (TD && customJS.SectionLabel && customJS.SectionLabel.divider) customJS.SectionLabel.divider(c);
    if (TD) {
      const row = c.createEl("div");
      row.style.cssText = "display:flex; justify-content:center; margin:0 auto; max-width:640px;";
      const plus = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
      const btn = customJS.AccentButton.render(row, { label: "Add task", icon: plus, onClick: () => {
        try { TD.open({ preselectTripSlug: page.trip_slug }); } catch (e) { new Notice("Could not open task dialog."); }
      }});
      if (btn && btn.style) { btn.style.minWidth = "128px"; btn.style.padding = "9px 14px"; }
    }
    // Open tasks linked to this trip.
    try {
      const name = page.trip;
      const rows = dv.pages().file.tasks
        .where(t => !t.completed && t.text && t.text.includes("[trip:: [[") && name && t.text.includes(String(name).replace(/^\[\[|\]\]$/g, "")));
      if (rows.length) { customJS.SectionLabel && customJS.SectionLabel.render && customJS.SectionLabel.render(c, { text: "Open tasks" }); dv.taskList(rows, false, c); }
    } catch (_e) {}
  }
}
```
Verify `ToDoCreateTask.open(opts)` accepts an options object; if it doesn't, add a thin `open(opts={})` seam that stores `preselectTripSlug` into initial state. Register `trip-todo-actions.js` + `"TripToDoActions"` in the manifest. Append its render block to `Trip To Do.md` after the chrome block.

- [ ] **Step 4: Run** `node platform/test/run-todo-dialog.js && node platform/test/run-customjs-loadable.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(trips): to-do↔trip link + Add task button (gated)"`

---

### Task 11: Trip Atlas dashboard

**Files:**
- Create: `platform/blueprints/trips/helpers/trip-dashboard.js`
- Create: `platform/test/run-trip-dashboard.js`
- Modify: `platform/blueprints/trips/templates/Trip Atlas.md`
- Modify: `package.json` (`"test:trip-dashboard"`), `platform/blueprints/trips/manifest.json`

- [ ] **Step 1: Write failing test** — assert static compute methods:
```js
// countdown: days from asOf to start; UTC-safe
assert(TripDashboard.countdown("2026-08-01","2026-08-05","2026-07-12").state==="upcoming");
assert(TripDashboard.countdown("2026-08-01","2026-08-05","2026-07-12").days===20);
assert(TripDashboard.countdown("2026-08-01","2026-08-05","2026-08-03").state==="in-progress");
assert(TripDashboard.countdown("2026-08-01","2026-08-05","2026-08-10").state==="complete");
// packingCounts: per-category {total,checked}
const pc = TripDashboard.packingCounts([{category:"A",item:"x",checked:true},{category:"A",item:"y",checked:false},{category:"B",item:"z",checked:false}]);
assert(pc.A.total===2 && pc.A.checked===1 && pc.B.total===1 && pc.B.checked===0);
```

- [ ] **Step 2: Run** `node platform/test/run-trip-dashboard.js` — Expected: FAIL.

- [ ] **Step 3: Implement** static + render:
```js
class TripDashboard {
  static _utc(s){ const m=String(s||"").slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null; }
  static countdown(start,end,asOf){
    const s=TripDashboard._utc(start), e=TripDashboard._utc(end), n=TripDashboard._utc(asOf);
    if(s==null||n==null) return {state:"unknown",days:null};
    const DAY=86400000;
    if(n<s) return {state:"upcoming",days:Math.round((s-n)/DAY)};
    if(e!=null&&n>e) return {state:"complete",days:Math.round((n-e)/DAY)};
    return {state:"in-progress",days:e!=null?Math.round((e-n)/DAY):0};
  }
  static packingCounts(items){
    const out={}; (Array.isArray(items)?items:[]).forEach(it=>{ if(!it||!it.item) return; const c=it.category||"Uncategorized"; out[c]=out[c]||{total:0,checked:0}; out[c].total++; if(it.checked) out[c].checked++; }); return out;
  }
  async render(dv){ /* read page start_date/end_date/location; find sibling packing note's packing_items via app.vault folder scan (pattern: TripSectionsCards); count open [trip::] tasks via dv.pages().file.tasks; draw a compact card. Cold-load guard via RenderSafe.page. never-throw. */ }
}
```
Implement `render` reading the atlas frontmatter + sibling packing note (folder scan by `trip_slug`, like `TripSectionsCards`) + open-task count. Insert the render block in `Trip Atlas.md` between the `TripsChromeBar` and `TripSectionsCards` blocks. Register helper + `"TripDashboard"` in manifest.

- [ ] **Step 4: Run** `node platform/test/run-trip-dashboard.js && node platform/test/run-customjs-loadable.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(trips): atlas dashboard (countdown, tasks, packing)"`

---

### Task 12: Install scaffolding, seed sentinels, docs, full suite

**Files:**
- Modify: `platform/install.js` (scaffold the new Links section when a trip is created, if trip-creation scaffolding is server-side; else confirm `_createTrip` in `trip-nav-buttons.js` seeds all 6 default sections — add Links there)
- Modify: `platform/test/seed-vault/**` (add sentinels for new templates + heal)
- Modify: `Docs/agent-guides/trips-blueprint.md`
- Modify: `CLAUDE.md` skills/trips references only if changed

- [ ] **Step 1** — ensure a new trip scaffolds a Links section. Locate where the 5 default sections are created (`_createTrip` in `trip-nav-buttons.js` iterating `TripSectionKinds.all()` or a server-side list) and confirm the added `links` kind now scaffolds automatically. If creation writes from templates, add `Template, Trip Links.md` to the list.

- [ ] **Step 2: Run** the trips seed/migration harness: `npm run test:seed && npm run test:seed-migrations` — add/adjust sentinels until green (new section templates present, heal strips legacy chrome). Expected: PASS.

- [ ] **Step 3** — refresh `Docs/agent-guides/trips-blueprint.md`: document the 6th section (Links), TripEntryList, TripDashboard, the to-do↔trip link + gating, and the ChromeBar-strip heal. Remove stale references to `TripNavButtons.render`/launcher.

- [ ] **Step 4: Run the full relevant suite:**
```bash
npm run test:trips-chrome-bar && node platform/test/run-trips.js && node platform/test/run-trips-heal.js \
 && node platform/test/run-trips-render-guards.js && node platform/test/run-trip-entry-list.js \
 && node platform/test/run-trip-links.js && node platform/test/run-trip-dashboard.js \
 && node platform/test/run-todo-dialog.js && npm run test:customjs-loadable \
 && npm run lint-schemas && npm run lint-note-chrome && npm run lint-cold-load
```
Expected: all PASS. Also run `npm test` (or the repo's aggregate) and fix any regressions.

- [ ] **Step 5: Commit** — `git commit -am "feat(trips): scaffold Links section, seed sentinels, docs refresh"`

---

## Notes for the executor

- After all tasks: run the repo preflight (see `Docs/agent-guides/build-test-verify.md`) before opening the PR.
- Do NOT bump versions/pins/tags — merge the feature PR to `main`; the pipeline computes semver, opens+auto-merges the release PR, tags, and ships to brew.
- If any `ToDoCreateTask.open` signature assumption in Task 10 is wrong, adapt the seam rather than duplicating the dialog.
