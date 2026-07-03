# Trips Blueprint Conformance Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with a commit. Work in the worktree `.worktrees/trips-conformance` on branch `cycle/trips-conformance`.

**Goal:** Bring the `trips` blueprint into vault-wide conformance — breadcrumb chrome, `SectionLabel`-owned dividers, a primary+"Go to…" launcher nav, collision-free note naming, canonical frontmatter, a schema-registry entry, and canonical docs — healing all existing trips at install.

**Architecture:** Trip notes get collision-free names (atlas → `<Trip Name>.md`, sections → `<Trip Name> — <Section>.md`) with behavior driven by frontmatter (`section_kind`/`section`), not filenames. A new `TripSectionKinds` registry class is the single source of truth for the 5 default kinds (label + icon + order + legacy-basename mapping), consumed by both render helpers so they can never drift again. `TripNavButtons` is rewritten onto the shipped `SpaceNavButtons` launcher grammar. An idempotent, backup-first install heal (`applyTripsConformanceHeal`) renames existing notes, canonicalizes their frontmatter, and injects the breadcrumb block.

**Tech Stack:** CustomJS classes (bare-class-only, loaded via `eval`), Dataview, Obsidian vault adapter API (install.js, Node — no `parseYaml`), zero-dep Node test harnesses (`platform/test/run-*.js`).

**Reference precedents (READ before writing — quote contracts literally, do not paraphrase):**
- Launcher to port: `platform/mechanisms/nav-buttons/space-nav-buttons.js` — `_stylePill` (224), `_renderPill` (268), `_openLauncher` (282), `_buildOverlayRow` (352).
- Heal skeleton: `platform/install.js` — `applyWikiToDocsMigration` (1950); helpers `_copyDirRecursive` / `_rmDirRecursive` / `_migrationGated`; adapter (`exists`/`list`/`read`/`write`/`remove`); `.sauce-backup` + history-event posture.
- Breadcrumb: `platform/mechanisms/breadcrumb/breadcrumb.js` (`fm:` atom strips wikilinks via `_stripLink`, line 296; template resolution line 332). Manifest block precedent: `platform/blueprints/wiki/manifest.json`.
- `frontmatter_branch` rule shape: `platform/blueprints/project/manifest.json` (line ~671).
- Test harness style: `platform/test/run-trips.js` (`loadWidget`, stubs, `ok`/`okNoThrow`).
- Standards: `Docs/agent-guides/note-chrome.md`, `Docs/agent-guides/project-blueprint-ui.md`.
- Landmines: customjs bare-class-only (no trailing statements) — `Docs/landmines.md`; Dataview dates are Luxon; `.sauce-backup` before any heal write.

**Canonical data contracts (used across tasks — keep identical):**

Atlas frontmatter (unchanged shape; filename becomes `<Trip Name>.md`):
```yaml
type: trip
name: "Dave's Wedding"
created_at: "2026-01-09T00:00:00-07:00"
start_date: "2026-01-16T00:00:00-07:00"
end_date: "2026-01-18T00:00:00-07:00"
location: "Kansas City"
people: []
cssclasses:
  - wide
```

Section frontmatter (NEW canonical shape; filename `<Trip Name> — <Section>.md`):
```yaml
type: trip-section
section_kind: flights          # flights | stay | packing-list | to-do | notes | custom
section: "Flights"             # display label — nav button, cards, breadcrumb current
trip: "[[Dave's Wedding]]"     # canonical cross-ref → atlas (unique basename resolves)
trip_slug: daves-wedding       # folder slug — breadcrumb link path (STORED, never slugify-derived)
created_at: "2026-01-09T00:00:00-07:00"
```

Filename sanitize (atlas + section): replace `[\\/:*?"<>|]` with a space, collapse runs of whitespace to one, trim. Apostrophes and `—` are kept (legal on macOS/Obsidian). Section filename = `${sanitize(name)} — ${sectionLabel}.md`.

---

## Task 1: `TripSectionKinds` registry class + manifest wiring

**Files:**
- Create: `platform/blueprints/trips/helpers/trip-section-kinds.js`
- Modify: `platform/blueprints/trips/manifest.json` (add to `customjs_classes` + `files[]`)
- Test: `platform/test/run-trips.js` (add TSK-* cases)

- [ ] **Step 1: Write the failing test** — append inside the async IIFE of `platform/test/run-trips.js`, after the TC-8 block:

```js
    // ---------- TripSectionKinds registry (behavioral) ----------
    const TripSectionKinds = loadWidget('platform/blueprints/trips/helpers/trip-section-kinds.js', 'TripSectionKinds');
    const tsk = new TripSectionKinds();
    ok('TSK-1 all() has the 5 default kinds in order',
        tsk.all().map(k => k.kind).join(',') === 'flights,stay,packing-list,to-do,notes');
    ok('TSK-2 order() ranks defaults, custom last',
        tsk.order('flights') === 0 && tsk.order('notes') === 4 && tsk.order('custom') === 999);
    ok('TSK-3 labelFor maps kind → display',
        tsk.labelFor('packing-list') === 'Packing List' && tsk.labelFor('custom') === null);
    ok('TSK-4 kindFromLegacyBasename maps old names',
        tsk.kindFromLegacyBasename('Trip Flights') === 'flights'
        && tsk.kindFromLegacyBasename('Trip Packing List') === 'packing-list'
        && tsk.kindFromLegacyBasename('Honorees') === 'custom');
    ok('TSK-5 iconFor returns non-empty svg for every default kind + fallback',
        tsk.all().every(k => /<svg/.test(tsk.iconFor(k.kind))) && /<svg/.test(tsk.iconFor('custom')));
```

Also register the class in the shared `cjs` stub so later tests can rely on it — change the `const cjs = { ... }` block near line 83 to add:

```js
    TripSectionKinds: new (loadWidget('platform/blueprints/trips/helpers/trip-section-kinds.js', 'TripSectionKinds'))(),
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-trips.js`
Expected: FAIL — `Cannot find module` / file read error for `trip-section-kinds.js`.

- [ ] **Step 3: Write the class** — `platform/blueprints/trips/helpers/trip-section-kinds.js`. Bare class only, NO trailing statements (customjs `eval` load rule). Reuse the exact SVGs already in `trip-sections-cards.js` (plane / bed / suitcase / checkbox / file) but with `stroke="currentColor"` (not the hardcoded accent) so buttons can recolor on hover:

```js
class TripSectionKinds {
    // Single source of truth for the 5 default trip-section kinds. Consumed by
    // TripNavButtons + TripSectionsCards so label/icon/order can never drift.
    all() {
        return [
            { kind: "flights",      label: "Flights",      legacy: "Trip Flights" },
            { kind: "stay",         label: "Stay",         legacy: "Trip Stay" },
            { kind: "packing-list", label: "Packing List", legacy: "Trip Packing List" },
            { kind: "to-do",        label: "To Do",        legacy: "Trip To Do" },
            { kind: "notes",        label: "Notes",        legacy: "Trip Notes" },
        ];
    }
    order(kind) {
        const i = this.all().findIndex(k => k.kind === kind);
        return i === -1 ? 999 : i;
    }
    labelFor(kind) {
        const e = this.all().find(k => k.kind === kind);
        return e ? e.label : null;
    }
    kindFromLegacyBasename(basename) {
        const e = this.all().find(k => k.legacy === basename);
        return e ? e.kind : "custom";
    }
    iconFor(kind) {
        const I = {
            flights:        `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
            stay:           `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>`,
            "packing-list": `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
            "to-do":        `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
            notes:          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        };
        return I[kind] || I.notes;
    }
}
```

- [ ] **Step 4: Wire the manifest** — in `platform/blueprints/trips/manifest.json`, add `"TripSectionKinds"` to `customjs_classes` (first entry), and add to `files[]` (place next to the other helper entries):

```json
    {
      "source": "helpers/trip-section-kinds.js",
      "dest": "{{scripts_path}}/trips/trip-section-kinds.js"
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node platform/test/run-trips.js`
Expected: PASS — TSK-1..5 ok, existing TC/TRIPGUARD still ok, `N passed, 0 failed`.
Also run: `node platform/test/run-customjs-loadable.js` (the new class must be loadable) — Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/trips/helpers/trip-section-kinds.js platform/blueprints/trips/manifest.json platform/test/run-trips.js
git commit -m "feat(trips): add TripSectionKinds registry (single source for kind label/icon/order)"
```

---

## Task 2: Templates — canonical frontmatter + Breadcrumb + SectionLabel

**Files:**
- Modify: `platform/blueprints/trips/templates/Trip Atlas.md`
- Modify: `platform/blueprints/trips/templates/Trip Flights.md`, `Trip Stay.md`, `Trip Packing List.md`, `Trip To Do.md`, `Trip Notes.md`
- Modify: `platform/blueprints/trips/content/Trips.md`
- Test: manual structural grep (Step 5) — behavioral coverage of the create-flow is in Task 5.

Note: these templates are consumed by `_createTrip` (Task 5), which substitutes `{{NAME}}`, `{{SLUG}}`, `{{DATE}}`, `{{START_DATE}}`, `{{END_DATE}}`, `{{LOCATION}}`, and (NEW) `{{SECTION}}` / `{{SECTION_KIND}}`. Keep those tokens.

- [ ] **Step 1: Atlas template** — rewrite `Trip Atlas.md` so the chrome order is Breadcrumb → SpaceNavButtons → TripNavButtons → cards → Mentions (SectionLabel, not H2). No `---` between breadcrumb and nav:

```markdown
---
type: trip
name: "{{NAME}}"
created_at: "{{DATE}}"
start_date: "{{START_DATE}}"
end_date: "{{END_DATE}}"
location: "{{LOCATION}}"
people: []
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripSectionsCards" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Mentions" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "BacklinkPanel",
  method: "render",
  args: [{ entityType: "trip" }]
});
```
```

(NOTE: fix the pre-existing unquoted `start_date: {{START_DATE}}` / `end_date:` → quoted, matching the atlas that real trips carry.)

- [ ] **Step 2: Section templates** — rewrite each of the 5 section templates to the canonical frontmatter + chrome. Example for `Trip Flights.md` (repeat for the others, changing only `section` + `section_kind`):

```markdown
---
type: trip-section
section_kind: flights
section: "Flights"
trip: "[[{{NAME}}]]"
trip_slug: {{SLUG}}
created_at: "{{DATE}}"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
```
```

Per-file values: `Trip Stay.md` → `section_kind: stay` / `section: "Stay"`; `Trip Packing List.md` → `packing-list` / `"Packing List"`; `Trip To Do.md` → `to-do` / `"To Do"`; `Trip Notes.md` → `notes` / `"Notes"`. (Replaces the legacy `created: {{DATE}}` + `tags: [trip]` shape.)

- [ ] **Step 3: Hub content** — rewrite `content/Trips.md` chrome: Breadcrumb → SpaceNavButtons → TripNavButtons → SectionLabel "All Trips" (not `## All Trips`) → TripsHubCards:

```markdown
---
type: trips-hub
created_at: "2026-05-17T15:30:00-06:00"
tags:
  - trips-hub
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "All Trips" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripsHubCards" });
```
```

- [ ] **Step 4: Board template** — leave `Trip Board.md` + `Trip Board Card.md` UNCHANGED (kanban `## Column` exemption; out of breadcrumb scope). Verify no edits landed there.

- [ ] **Step 5: Structural verification**

Run:
```bash
grep -L 'class: "Breadcrumb"' platform/blueprints/trips/templates/"Trip Atlas.md" platform/blueprints/trips/templates/"Trip Flights.md" platform/blueprints/trips/content/Trips.md
grep -rn '^## ' platform/blueprints/trips/templates/"Trip Atlas.md" platform/blueprints/trips/content/Trips.md
grep -rn 'section_kind:' platform/blueprints/trips/templates/
```
Expected: first grep prints nothing (all three carry Breadcrumb); second prints nothing (no managed `## H2`); third lists all 5 section templates with the right kind.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/trips/templates platform/blueprints/trips/content
git commit -m "feat(trips): canonical section frontmatter + Breadcrumb/SectionLabel chrome in templates"
```

---

## Task 3: Manifest — breadcrumb block + frontmatter-branch rules

**Files:**
- Modify: `platform/blueprints/trips/manifest.json`

- [ ] **Step 1: Add the `breadcrumb` block** — top-level key (sibling of `rule_fragments`):

```json
  "breadcrumb": {
    "types": {
      "trips-hub": { "current": { "label": "lit:Trips" } },
      "trip": {
        "ancestors": [ { "label": "lit:Trips", "link": "spice/trips/Trips.md" } ],
        "current": { "label": "fm:name|file:basename" }
      },
      "trip-section": {
        "ancestors": [
          { "label": "lit:Trips", "link": "spice/trips/Trips.md" },
          { "label": "fm:trip", "link": "spice/trips/{fm:trip_slug}/{fm:trip}.md" }
        ],
        "current": { "label": "fm:section|file:basename" }
      }
    }
  }
```

- [ ] **Step 2: Convert rule_fragments to frontmatter-branch** — replace the existing atlas rule_fragment (`path_glob: spice/trips/*/Trip Atlas.md`) with a filename-independent branch over `spice/trips/*/*.md`, and ADD a `trip-section` branch. Keep the existing `Trips.md` cssclasses fragment as-is. New combined fragment:

```json
    {
      "target": "trips",
      "fragment": {
        "scope": { "path_glob": "spice/trips/*/*.md" },
        "extends": "_canonical-vocab",
        "frontmatter_branch": [
          {
            "when": { "frontmatter": { "type": "trip" } },
            "required_frontmatter": {
              "name": { "required": true, "type": "string" },
              "start_date": { "required": true, "type": "string", "matches": "^\\d{4}-\\d{2}-\\d{2}(T.*)?$" },
              "end_date": { "required": true, "type": "string", "matches": "^\\d{4}-\\d{2}-\\d{2}(T.*)?$" },
              "location": { "required": true, "type": "string" }
            }
          },
          {
            "when": { "frontmatter": { "type": "trip-section" } },
            "required_frontmatter": {
              "section_kind": { "required": true, "type": "string", "matches": "^(flights|stay|packing-list|to-do|notes|custom)$" },
              "section": { "required": true, "type": "string" },
              "trip": { "required": true, "type": "string" },
              "trip_slug": { "required": true, "type": "string" }
            }
          }
        ]
      }
    }
```

- [ ] **Step 3: Update the manifest `description`** — append a version note describing this cycle (breadcrumb adoption, collision-free naming, `TripSectionKinds`, launcher nav, heal). Do NOT bump `version` (the release pipeline does that). Mirror the prose style of the existing description.

- [ ] **Step 4: Validate JSON + rules**

Run:
```bash
node -e "require('./platform/blueprints/trips/manifest.json'); console.log('manifest parses')"
node platform/test/run-rule-schemas.js 2>/dev/null || node platform/test/run-rules.js 2>/dev/null || echo "(run whichever rules harness exists)"
```
Expected: manifest parses; rules harness green. (If a `run-breadcrumb*.js` harness exists, run it too.)

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/trips/manifest.json
git commit -m "feat(trips): declare breadcrumb block + frontmatter-branch rule fragments"
```

---

## Task 4: `TripNavButtons` — primary + "Go to…" launcher render

**Files:**
- Modify: `platform/blueprints/trips/helpers/trip-nav-buttons.js` (render paths only; create-flows in Task 5)
- Test: `platform/test/run-trips.js` (add NAV-* partition cases)

READ FIRST: `space-nav-buttons.js` lines 224–366 (the launcher). Port `_stylePill`, `_openLauncher`, `_buildOverlayRow` adapted so a menu entry is `{ label, icon, path }` and a row's `onclick` calls `app.workspace.openLinkText(entry.path, "")` (keep the trips convention — existing trips navigate this way).

- [ ] **Step 1: Write the failing test** — add a pure partition helper contract + test. In `trip-nav-buttons.js` you will add a method `_tripMenuEntries(ctx, currentPath)` returning `{ primary, entries }` where `primary` is the atlas button (or null when on atlas) and `entries` is the Go-to menu list (sibling sections ordered by `section_kind`, then Board if present, then a trailing `+ New Section` action entry `{ action: "new-section" }`). Add to `run-trips.js` after the TSK block:

```js
    // ---------- TripNavButtons launcher partition (behavioral) ----------
    // Stub folder children so _tripMenuEntries can enumerate sections without a vault.
    const navP = new TripNavButtons();
    navP._siblingsFor = () => ([
        { basename: "Dave's Wedding",            path: "spice/trips/daves-wedding/Dave's Wedding.md",            fm: { type: "trip", name: "Dave's Wedding" } },
        { basename: "Dave's Wedding — Notes",    path: "spice/trips/daves-wedding/Dave's Wedding — Notes.md",    fm: { type: "trip-section", section: "Notes",   section_kind: "notes" } },
        { basename: "Dave's Wedding — Flights",  path: "spice/trips/daves-wedding/Dave's Wedding — Flights.md",  fm: { type: "trip-section", section: "Flights", section_kind: "flights" } },
    ]);
    navP._boardPathIfExists = () => null;
    {
        const ctx = { context: "trip-section", slug: "daves-wedding", tripDir: "spice/trips/daves-wedding" };
        const { primary, entries } = navP._tripMenuEntries(ctx, "spice/trips/daves-wedding/Dave's Wedding — Flights.md");
        ok('NAV-1 primary points at the atlas', primary && primary.path.endsWith("Dave's Wedding.md"));
        ok('NAV-2 menu excludes current + orders by section_kind + ends with New Section',
            entries.map(e => e.label || e.action).join('|') === 'Notes|new-section',
            JSON.stringify(entries.map(e => e.label || e.action)));
    }
    {
        const ctxA = { context: "trip-atlas", slug: "daves-wedding", tripDir: "spice/trips/daves-wedding" };
        const { primary, entries } = navP._tripMenuEntries(ctxA, "spice/trips/daves-wedding/Dave's Wedding.md");
        ok('NAV-3 on atlas: no primary, menu lists both sections + New Section',
            primary === null && entries.map(e => e.label || e.action).join('|') === 'Flights|Notes|new-section',
            JSON.stringify([primary, entries.map(e => e.label || e.action)]));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-trips.js`
Expected: FAIL — `navP._tripMenuEntries is not a function`.

- [ ] **Step 3: Implement the partition + render.** In `trip-nav-buttons.js`:
  1. Add `_siblingsFor(ctx)` — reads `app.vault.getAbstractFileByPath(ctx.tripDir).children`, filters `.md`, returns `[{ basename, path, fm }]` where `fm = app.metadataCache.getFileCache(f)?.frontmatter || {}`. (Factored out so the test can stub it.)
  2. Add `_boardPathIfExists(ctx)` — returns `${ctx.tripDir}/board/${ctx.slug}-board.md` when it exists, else null.
  3. Add `_tripMenuEntries(ctx, currentPath)`:
     - `atlas` = the sibling whose `fm.type === "trip"`.
     - `primary` = (ctx.context !== "trip-atlas" && atlas && atlas.path !== currentPath) ? `{ label: atlas.basename, icon: this._icons().trip, path: atlas.path }` : `null`.
     - `sections` = siblings with `fm.type === "trip-section"`, excluding `currentPath`, sorted by `customJS.TripSectionKinds.order(fm.section_kind)` then `section` alpha; each mapped to `{ label: fm.section || basename, icon: customJS.TripSectionKinds.iconFor(fm.section_kind), path }`.
     - append Board entry `{ label: "Trip Board", icon: this._icons().board, path: boardPath }` when `_boardPathIfExists` and `boardPath !== currentPath`.
     - append `{ label: "New Section", action: "new-section", icon: <plus svg> }`.
     - return `{ primary, entries }`.
  4. Rewrite `_renderTripContext` + `_renderBoardContext` to: emit a `SectionLabel` "Trip" via `await dv.view` is not available here (helper has `root`, not `dv`) — instead render the label inline as the current code does BUT keep it (it is chrome, acceptable) OR call `customJS.SectionLabel.render` if it accepts a container. SIMPLEST + conformant: keep a single hairline + "Trip" muted label div (as today) — that is the SectionLabel visual; the note-chrome rule targets template `## H2`, not helper-drawn chrome. Then render `primary` (full-width button, reuse existing button style) and a `Go to…` pill (`_renderPill`) that opens `_openLauncher(evt, pill, entries, dv)`. The launcher row `onclick`: if `entry.action === "new-section"` call the New Section flow (Task 5 `_promptForSectionTitle` + `_createTripSection`); else `app.workspace.openLinkText(entry.path, "")`.
  5. Delete the old multi-row `buildRow` default/additional/atlas logic and the `_renderActionButton` "New Section" block on the atlas (now in the menu). Keep `_renderTripsHub` (New Trip) unchanged.

  Port `_stylePill` / `_openLauncher` / `_buildOverlayRow` from `space-nav-buttons.js` verbatim, changing only: (a) `_buildOverlayRow` row `onclick` to the trips dispatch above; (b) icon resolution to use the entry's inline `icon` string directly (no `customJS.Icons.resolve`). Keep the `document.body` overlay, mobile bottom-sheet/desktop-dropdown branch, and single `close()` teardown EXACTLY.

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-trips.js`
Expected: PASS — NAV-1..3 ok, TRIPGUARD render-guards still ok (render must not throw on cold load).
Run: `node platform/test/run-customjs-loadable.js` — Expected: 0 failed (no trailing statements introduced).

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/trips/helpers/trip-nav-buttons.js platform/test/run-trips.js
git commit -m "feat(trips): rewrite TripNavButtons on primary + Go-to launcher grammar"
```

---

## Task 5: `TripNavButtons` — create flows emit collision-free names + canonical frontmatter

**Files:**
- Modify: `platform/blueprints/trips/helpers/trip-nav-buttons.js` (`_createTrip`, `_createTripSection`, add `_sanitizeFilename`)
- Test: `platform/test/run-trips.js` (add CREATE-* cases with a recording vault stub)

- [ ] **Step 1: Write the failing test** — add after NAV cases:

```js
    // ---------- create-flow naming + frontmatter (behavioral) ----------
    {
        const written = {};
        const created = new Set();
        const savedVault = global.app.vault;
        global.app.vault = {
            getAbstractFileByPath: (p) => (p === 'ranch/templates/Template, Trip Flights.md'
                ? { path: p } : (created.has(p) ? { path: p } : null)),
            async createFolder(p) { created.add(p); },
            async create(p, body) { written[p] = body; created.add(p); },
            async read() { return '---\ntype: trip-section\nsection_kind: flights\nsection: "Flights"\ntrip: "[[{{NAME}}]]"\ntrip_slug: {{SLUG}}\ncreated_at: "{{DATE}}"\n---\n'; },
        };
        const navC = new TripNavButtons();
        const secPath = await navC._createTripSection('spice/trips/daves-wedding', 'Honorees', "Dave's Wedding", 'daves-wedding');
        ok('CREATE-1 custom section filename is trip-prefixed',
            secPath === "spice/trips/daves-wedding/Dave's Wedding — Honorees.md", secPath);
        ok('CREATE-2 custom section frontmatter is canonical (kind=custom + section + trip + trip_slug)',
            /type: trip-section/.test(written[secPath]) && /section_kind: custom/.test(written[secPath])
            && /section: "Honorees"/.test(written[secPath]) && /trip: "\[\[Dave's Wedding\]\]"/.test(written[secPath])
            && /trip_slug: daves-wedding/.test(written[secPath]), written[secPath]);
        ok('CREATE-3 sanitizeFilename strips illegal chars, keeps apostrophe',
            navC._sanitizeFilename('Q1: Kick/off "Trip"') === 'Q1 Kick off Trip'
            && navC._sanitizeFilename("Dave's Wedding") === "Dave's Wedding");
        global.app.vault = savedVault;
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-trips.js`
Expected: FAIL — `_sanitizeFilename is not a function` / wrong section path.

- [ ] **Step 3: Implement.**
  1. Add `_sanitizeFilename(name)`: `return String(name).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();`
  2. Rewrite `_createTripSection(tripDir, title, tripName, tripSlug)` — signature gains `tripName` + `tripSlug`. Compute `kind = customJS.TripSectionKinds.kindFromLegacyBasename("Trip " + title) === "custom" ? "custom" : ...` — simpler: for a user-created section always `kind = "custom"`, `section = title`. Filename = `${tripDir}/${this._sanitizeFilename(tripName)} — ${this._sanitizeFilename(title)}.md`. Body frontmatter:
     ```
     type: trip-section
     section_kind: custom
     section: "<title>"
     trip: "[[<sanitize(tripName)>]]"
     trip_slug: <tripSlug>
     created_at: "<isoWithTz>"
     ```
     followed by the Breadcrumb + SpaceNavButtons + TripNavButtons dataviewjs blocks (mirror the section template). Idempotent: if target exists, return it.
  3. Rewrite `_createTrip({name, slug, start_date, end_date, location})`:
     - atlas dest basename = `${this._sanitizeFilename(name)}.md` (was `Trip Atlas.md`).
     - each section dest basename = `${this._sanitizeFilename(name)} — <Label>.md`, where `<Label>` ∈ Flights/Stay/Packing List/To Do/Notes (from `customJS.TripSectionKinds.all()`), sourced from the matching template.
     - `subs(s)` gains `.replaceAll("{{SECTION}}", label).replaceAll("{{SECTION_KIND}}", kind)` — but templates already hardcode section/kind, so only `{{NAME}}`/`{{SLUG}}`/`{{DATE}}`/dates/location are needed; keep the existing subs plus ensure `{{NAME}}` in the section `trip: "[[{{NAME}}]]"` resolves to the sanitized name (pass `subs` the sanitized name for `{{NAME}}` in the wikilink? NO — `name` is the display name; the atlas basename must equal it for the wikilink to resolve. Since atlas basename = `sanitize(name)`, set the wikilink target to `sanitize(name)`. Implement by substituting `{{NAME}}` with `name` for display fields but `{{SLUG}}` for trip_slug; for the `trip:` wikilink use sanitize(name). Simplest: since sanitize(name)===name for normal names, substitute `{{NAME}}` → `this._sanitizeFilename(name)` everywhere in section templates (the `trip:` wikilink + nothing else uses NAME in sections). For the atlas template, `name:` frontmatter should keep the RAW display `name`. So use two substitution maps: atlas gets raw `name`; sections get `sanitize(name)`.)
     - Update the caller `_renderTripsHub` New Trip handler to open `atlasPath` (unchanged).
     - Update the New Section menu action (Task 4) to call `_createTripSection(ctx.tripDir, title, atlasBasename, ctx.slug)` — derive `atlasBasename` from the atlas sibling's `basename`.

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-trips.js`
Expected: PASS — CREATE-1..3 ok; all prior cases still ok.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/trips/helpers/trip-nav-buttons.js platform/test/run-trips.js
git commit -m "feat(trips): create-flows emit collision-free names + canonical section frontmatter"
```

---

## Task 6: `TripSectionsCards` — key on frontmatter, not basename

**Files:**
- Modify: `platform/blueprints/trips/helpers/trip-sections-cards.js`
- Test: covered by TRIPGUARD render-guard (cold-load no-throw) + a SECTIONS-* frontmatter-grouping case.

- [ ] **Step 1: Write the failing test** — add after CREATE cases; stub sibling enumeration:

```js
    // ---------- TripSectionsCards frontmatter grouping (behavioral) ----------
    {
        const TripSectionsCards = loadWidget('platform/blueprints/trips/helpers/trip-sections-cards.js', 'TripSectionsCards');
        const sc = new TripSectionsCards();
        const rows = sc._buildRows([
            { basename: "T — Notes",   path: "p/T — Notes.md",   fm: { type: "trip-section", section: "Notes",   section_kind: "notes" } },
            { basename: "T — Flights", path: "p/T — Flights.md", fm: { type: "trip-section", section: "Flights", section_kind: "flights" } },
            { basename: "T — Honorees",path: "p/T — Honorees.md",fm: { type: "trip-section", section: "Honorees",section_kind: "custom" } },
        ], null);
        ok('SECTIONS-1 defaults grouped + ordered by kind, custom in Additional',
            rows.filter(r => r.group === 'Default Sections').map(r => r.title).join('|') === 'Flights|Notes'
            && rows.filter(r => r.group === 'Additional Sections').map(r => r.title).join('|') === 'Honorees',
            JSON.stringify(rows.map(r => [r.group, r.title])));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-trips.js`
Expected: FAIL — `sc._buildRows is not a function`.

- [ ] **Step 3: Implement.** Refactor `TripSectionsCards.render` to build its card rows via a pure, testable `_buildRows(siblings, boardPath)`:
  - `siblings` = `[{ basename, path, fm }]` with `fm.type === "trip-section"`.
  - Each row: `{ title: fm.section || basename, path, kind: fm.section_kind, group: (fm.section_kind && fm.section_kind !== 'custom') ? 'Default Sections' : 'Additional Sections', icon: customJS.TripSectionKinds.iconFor(fm.section_kind) }`.
  - If `boardPath`, push `{ title: 'Trip Board', path: boardPath, group: 'Default Sections', icon: <board svg>, kind: '_board' }` sorted last within Default.
  - Sort Default by `TripSectionKinds.order(kind)` (board → after notes); Additional alpha by title.
  - `render()` collects siblings (via the same `app.vault...children` + `getFileCache` pattern), computes `boardPath`, calls `_buildRows`, then feeds `customJS.BeaconCards.render(dv, { pages: rows.map(...), layout: "stacked", group: r => r.group, title: r => r.title, icon: r => r.icon, target: r => r.path, sort: <preserve _buildRows order>, empty: "No sections yet. Use “Go to… → New Section” to add one." })`.
  - Keep the existing early-return path guard + RenderSafe usage.

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-trips.js`
Expected: PASS — SECTIONS-1 ok; TRIPGUARD `TripSectionsCards` cold-load still ok.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/trips/helpers/trip-sections-cards.js platform/test/run-trips.js
git commit -m "fix(trips): TripSectionsCards groups by section_kind frontmatter (fixes basename mismatch)"
```

---

## Task 7: Install heal — `applyTripsConformanceHeal`

**Files:**
- Modify: `platform/install.js` (add the function + wire the call near the other per-vault heals ~line 1231)

READ FIRST: `applyWikiToDocsMigration` (install.js:1950) for the exact adapter/backup/history/idempotency posture. install.js cannot use `parseYaml` — frontmatter is edited via regex on the leading `---` block.

- [ ] **Step 1: Implement `applyTripsConformanceHeal(tp, mech, variables, history, git)`.** Gate: `if (!mech || mech.name !== "trips") return;` then adapter presence + `if (!(await adapter.exists("spice/trips"))) return;`. For each trip folder under `spice/trips` (skip `Trips.md`, `attachments/`, and any `.sauce-backup`):
  1. **Backup once per trip** before any write: `_copyDirRecursive(adapter, tripDir, `.sauce-backup/trips/${slug}/${ts}`)`.
  2. **Locate the atlas**: the `.md` directly in `tripDir` whose leading-frontmatter `type:` is `trip` (regex `/^type:\s*trip\s*$/m` inside the first `---`…`---`). Read its `name:` (strip quotes); `atlasBase = sanitize(name)`.
  3. **Rename atlas** `Trip Atlas.md` (or whatever the type:trip file is named) → `${atlasBase}.md` if not already. Rename = read + write new + remove old (adapter has no rename). Idempotent: skip when source basename already equals `${atlasBase}`.
  4. **Sections**: for every other `.md` directly in `tripDir`:
     - `legacy = basename`; `kind = kindFromLegacyBasename(legacy)` where the mapping is the Node copy of `TripSectionKinds` (embed the same `{legacy→kind,label}` table — 5 rows — as a const in install.js; comment: "keep in lockstep with trip-section-kinds.js"). If `kind === "custom"`, `sectionLabel = legacy.replace(/^Trip\s+/, "")`; else `sectionLabel = labelFor(kind)`.
     - new basename = `${atlasBase} — ${sectionLabel}.md`; rename if different.
     - **Frontmatter canonicalize** in the (possibly renamed) file body: ensure `type: trip-section`, `section_kind: <kind>`, `section: "<sectionLabel>"`, `trip: "[[${atlasBase}]]"`, `trip_slug: ${slug}`, and migrate legacy `created:` → `created_at:` (keep the value; if only `created:` present, rename the key; ensure ISO — if it is `YYYY-MM-DD`, leave as-is, the rule regex accepts date-only for created_at? NO — created_at canonical requires ISO+TZ. If legacy `created` is date-only, synthesize `T00:00:00` + local offset via the same `_isoWithTz` logic, or set to the file's existing value if already ISO). Implement via regex helpers on the `---` block; if a key is absent, insert it; if present, replace its value.
  5. **Inject Breadcrumb block** as the FIRST dataviewjs block (above the SpaceNavButtons block) on the atlas + every section + the hub `Trips.md`, only when `class: "Breadcrumb"` is absent. Insert the fenced block immediately after the closing `---` of frontmatter.
  6. **H2 → SectionLabel** (managed only): in the hub, replace a line matching `/^##\s+All Trips\s*$/m` with the `SectionLabel {text:"All Trips"}` dataviewjs block; in the atlas, replace `/^##\s+Mentions\s*$/m` with `SectionLabel {text:"Mentions"}`. Never touch other `## ` lines (user content).
  7. **Link repair**: within the trip's own note bodies, rewrite `[[Trip Atlas]]` and `[[Trip Atlas|...]]` → `[[${atlasBase}]]` (best-effort; only exact `Trip Atlas` target).
  8. Per-trip `try/catch` → history `warning` on failure, `info` on success (mirror applyWikiToDocsMigration's event shape). Idempotent end-to-end: a second run finds new names + canonical frontmatter + breadcrumb present → no writes.
  9. Do NOT gate behind `_migrationGated` version constant unless the other current heals do — follow the ungated, idempotent posture (like `applyProjectTodoOwnedTasksHeal`).

- [ ] **Step 2: Wire the call** — add near line 1231 (the project heal cluster), AFTER `applyNoteChromeHeal`:

```js
  await applyTripsConformanceHeal(tp, mech, variables, history, git); // NEW — renames trip notes collision-free (atlas → <name>.md, sections → <name> — <section>.md), canonicalizes section frontmatter, injects Breadcrumb + SectionLabel chrome; per-trip .sauce-backup, idempotent, never throws.
```

Confirm `mech` is the trips manifest in that scope (match how sibling heals receive their manifest; if the loop variable differs, follow the exact pattern of the adjacent call).

- [ ] **Step 3: Test via self-install dogfood on a synthetic trip.** The workshop has no `spice/trips/` content, so build a throwaway fixture and run the heal path through a unit harness. Create `platform/test/run-trips-heal.js` (zero-dep) that:
  - writes a synthetic pre-refactor trip into an `os.tmpdir()` mkdtemp vault: `spice/trips/daves-wedding/Trip Atlas.md` (type:trip, name "Dave's Wedding"), `Trip Flights.md` (legacy `created:` + `tags:[trip]`), `Trip Notes.md`, and `spice/trips/Trips.md`;
  - constructs a minimal `tp` with a real fs-backed adapter (`exists/list/read/write/remove` over the tmp dir) + the trips manifest;
  - calls `applyTripsConformanceHeal`, then asserts: `Dave's Wedding.md` exists (atlas renamed), `Dave's Wedding — Flights.md` exists with `type: trip-section` + `section_kind: flights` + `section: "Flights"` + `trip: "[[Dave's Wedding]]"` + `trip_slug: daves-wedding` + `created_at:`, Breadcrumb block present on atlas+section+hub, `## All Trips` gone from the hub, `.sauce-backup/trips/daves-wedding/...` snapshot exists;
  - re-runs the heal and asserts NO further file writes (idempotent — capture write count).
  - To reuse `applyTripsConformanceHeal` from install.js, either `require('../install.js')` if it exports (check; install.js may not export — if not, load the function via the `run-customjs-loadable`-style `new Function` slice OR add a guarded `module.exports` at the very bottom of install.js behind `if (typeof module !== 'undefined' && require.main !== module)` — confirm this does not break the customjs/Templater load; install.js is Node-only so a bottom `module.exports` is safe, unlike customjs class files). Prefer adding a narrow export block.

Run: `node platform/test/run-trips-heal.js`
Expected: PASS — all asserts ok; second run writes 0 files.

- [ ] **Step 4: Wire the new harness into preflight** — add `run-trips-heal.js` to whatever aggregates `run-*.js` (it is auto-discovered by `release:preflight` if it lives in `platform/test/run-*.js`; confirm by running `npm run release:preflight` in Task 12).

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/run-trips-heal.js
git commit -m "feat(trips): applyTripsConformanceHeal — rename + canonicalize + breadcrumb for existing trips"
```

---

## Task 8: Schema registry entry

**Files:**
- Modify: `platform/schemas-index.json`

- [ ] **Step 1: Add a trips entry** — mirror the shape of an existing blueprint entry (id, source pointer to `platform/blueprints/trips/manifest.json`, consumers, notes). Document the three types: `trip` (atlas: name/start_date/end_date/location/people/created_at), `trip-section` (section_kind enum + section + trip + trip_slug + created_at), `trips-hub`. Reference `TripSectionKinds` as the section-kind SSOT.

- [ ] **Step 2: Lint**

Run: `npm run lint-schemas`
Expected: PASS (0 errors). If the linter cross-checks manifest ↔ index, resolve any mismatch it reports.

- [ ] **Step 3: Commit**

```bash
git add platform/schemas-index.json
git commit -m "docs(trips): register trips frontmatter contracts in schemas-index"
```

---

## Task 9: Seed-vault migration fixture

**Files:**
- Create: `platform/test/seed-vault/spice/trips/…` pre-refactor fixture (old names, legacy frontmatter, no breadcrumb)
- Verify: `platform/test/run-seed-migrations.js`

READ FIRST: `Docs/agent-guides/migration-regression-net.md` (seed-vault harness + portable-sentinel pattern).

- [ ] **Step 1: Add the fixture** — under `platform/test/seed-vault/`, add a `spice/trips/summer-trip/` with `Trip Atlas.md` (type:trip, name "Summer Trip"), `Trip Flights.md`, `Trip Packing List.md` (legacy `created:` frontmatter, no breadcrumb block), and `spice/trips/Trips.md` with a `## All Trips` heading. Add the trips subscription pin if the seed vault's `ranch/platform-subscription.json` gates which blueprints install (mirror how an existing blueprint is pinned there — the bumper owns the version value, so add the entry with the current trips version and let the pipeline reconcile).

- [ ] **Step 2: Add the portable sentinel** — in the seed harness's assertions (follow the existing per-blueprint sentinel pattern in `run-seed-migrations.js`), assert post-install: `spice/trips/summer-trip/Summer Trip.md` exists, `Summer Trip — Flights.md` exists with canonical frontmatter, breadcrumb present, `## All Trips` gone.

- [ ] **Step 3: Run the seed harness**

Run: `node platform/test/run-seed-migrations.js`
Expected: PASS. If it reports the seed baseline needs regeneration, do NOT blind-rebaseline (it over-heals fixtures — see build-test-verify § Seed rebaseline); instead ensure the fixture is genuinely pre-heal and the sentinel matches the heal output.

- [ ] **Step 4: Commit**

```bash
git add platform/test/seed-vault platform/test/run-seed-migrations.js
git commit -m "test(trips): seed-vault pre-refactor fixture + migration sentinel"
```

---

## Task 10: Canonical docs + router wiring

**Files:**
- Create: `Docs/agent-guides/trips-blueprint.md`
- Create: `Docs/agent-guides/smoke-checklists/trips.md`
- Modify: `CLAUDE.md` (add the guide to "Further reading"); confirm the `claude_surface`-managed router table need not change (skills index).

- [ ] **Step 1: Write `trips-blueprint.md`** — model on `wiki-blueprint.md`. Cover: note types (trip / trip-section / trips-hub / board) + folder-is-truth (`spice/trips/<slug>/`), collision-free naming invariant (`<Trip Name>.md`, `<Trip Name> — <Section>.md`) + WHY (ambiguous basenames), the `TripSectionKinds` registry as the section SSOT, the three render helpers (TripsHubCards / TripNavButtons launcher / TripSectionsCards), chrome (Breadcrumb ancestors-mode + SpaceNavButtons + primary/Go-to nav + SectionLabel), the `applyTripsConformanceHeal` heal, and the board's kanban exemption. Add a "Read before any trips work" line.

- [ ] **Step 2: Write `smoke-checklists/trips.md`** — mirror `smoke-checklists/project.md`: create a trip, verify collision-free names + breadcrumb trail + primary/Go-to nav (mobile bottom-sheet) + section cards + New Section flow + that an existing pre-refactor trip healed correctly.

- [ ] **Step 3: Wire the router** — in `CLAUDE.md`, add under "Further reading":

```markdown
- [`Docs/agent-guides/trips-blueprint.md`](Docs/agent-guides/trips-blueprint.md) — canonical trips reference: note types + folder-is-truth, collision-free naming, TripSectionKinds, the launcher nav + breadcrumb chrome, and the conformance heal. Read before any trips work.
```

(Edit only outside `claude-surface` marker regions.)

- [ ] **Step 4: Verify docs don't break lint** — run `npm run release:preflight` subset that touches docs if any (e.g. a claude-surface/audit check). At minimum: `node platform/install.js --vault . --auto-approve` self-install stays green (Task 12).

- [ ] **Step 5: Commit**

```bash
git add Docs/agent-guides/trips-blueprint.md Docs/agent-guides/smoke-checklists/trips.md CLAUDE.md
git commit -m "docs(trips): canonical trips-blueprint guide + smoke checklist + router entry"
```

---

## Task 11: Full verification + result doc

**Files:**
- Create: `Docs/plans/2026-07-02-trips-blueprint-conformance-refactor-result.md` (after green)

- [ ] **Step 1: Preflight**

Run: `npm run release:preflight`
Expected: whole-suite GREEN (includes run-trips, run-trips-heal, run-seed-migrations, run-customjs-loadable, note-chrome lint, check-version-sync).

- [ ] **Step 2: Bumped preflight** (clean tree required)

Run: `npm run release:preflight-bumped`
Expected: GREEN — no hardcoded version literal wedges `prepare-release`. (If it flags a version literal in a test, fix to read `VERSION_SNAPSHOT` — do NOT hardcode.)

- [ ] **Step 3: Self-install dogfood**

Run: `node platform/install.js --vault . --auto-approve`
Expected: completes; `platform-installed.json` history shows the trips heal step with no `error` events; no drift.

- [ ] **Step 4: Playwright visual** (deployed headspace vault, after ship — or against a local test vault now) — verify at ~390px light+dark: breadcrumb trail on a section, primary + Go-to launcher open/close + bottom-sheet on mobile, section cards grouping. Capture screenshots. (Non-gating per build-test-verify manual-smoke posture; record the vault tested in the result doc.)

- [ ] **Step 5: Write the result doc** (cycle-close artifact) — what shipped, surfaces hit, new lessons, carry-forward, commits. Also update `Docs/cycle-history.md` + `Docs/agent-guides/cycle-status.md` per the cycle-close list (versions are pipeline-computed; reference "vX.Y.Z (pipeline-computed)").

- [ ] **Step 6: Commit + push + PR**

```bash
git add Docs/plans/2026-07-02-trips-blueprint-conformance-refactor-result.md Docs/cycle-history.md Docs/agent-guides/cycle-status.md
git commit -m "docs(trips): cycle result + history + cycle-status"
git push -u origin cycle/trips-conformance
gh pr create --title "feat(trips): blueprint conformance refactor (breadcrumb + collision-free naming + launcher nav)" --body "<summary + test evidence + links to design/plan/result docs>"
```

Then: wait for CI green → merge the FEATURE PR → let the release pipeline auto-bump/tag/ship (nudge the release PR with `gh pr update-branch` only if it wedges BEHIND; NEVER hand-merge the release PR) → after the tag ships to brew, deploy to accuris + headspace + ero (`git fetch --tags` first; `deploy.js run`), verify each vault on the new version with no drift.

---

## Self-Review

**Spec coverage:** breadcrumb adoption (Task 3 + heal Task 7) ✓ · SectionLabel/button conformance (Tasks 2, 4, 6) ✓ · collision-free naming (Tasks 2, 5, 7) ✓ · `section_kind` SSOT fixing the drift bug (Tasks 1, 4, 6) ✓ · install heal for all existing trips (Task 7) ✓ · schema registry (Task 8) ✓ · seed fixture (Task 9) ✓ · canonical docs + router (Task 10) ✓ · content-org left alone (no task touches trip bodies except managed H2 + link repair) ✓ · board excluded from breadcrumb (Task 2 Step 4, Task 3) ✓.

**Placeholder scan:** every code step carries real code or a precise contract + named precedent; test steps carry exact assertions. The two "mirror the precedent" blocks (launcher port in Task 4, heal in Task 7) cite exact files+line ranges and enumerate every adaptation — acceptable for large boilerplate in an existing codebase, and each is anchored by executable tests.

**Type consistency:** `TripSectionKinds` methods (`all/order/labelFor/kindFromLegacyBasename/iconFor`) are used identically in Tasks 4/6/7. `_tripMenuEntries`/`_siblingsFor`/`_boardPathIfExists`/`_buildRows`/`_sanitizeFilename` names are consistent across their defining + testing tasks. Section frontmatter fields (`type/section_kind/section/trip/trip_slug/created_at`) are identical in templates (Task 2), create-flow (Task 5), heal (Task 7), rules (Task 3), and schema (Task 8).
