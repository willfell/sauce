---
purpose: Canonical reference for the `trips` blueprint — a per-trip folder-is-truth ecosystem under spice/trips/. Note types, collision-free naming, TripSectionKinds (5 default sections), the render helpers (TripsChromeBar chrome + hosted section Add actions, TripEntryList CRUD incl. multi-leg flights v2, TripLinks on the atlas, TripDashboard), the task-note↔trip link (TaskDialog + TaskTripList), upcoming-trips on the daily/home, and the conformance + chrome-strip + v2 heals. Read before any trips work.
load_when: Touching the trips blueprint (spice/trips/), its helpers, TripSectionKinds, TripsChromeBar, TripEntryList, TripLinks, TripDashboard, the task-entity TaskTripList, the headless TripNavButtons, TripsHubCards, TripSectionsCards, the conformance/chrome-strip/v2 heals, or debugging trips render/chrome/naming behavior.
---

# Trips blueprint

A **per-trip folder-is-truth ecosystem** at `spice/trips/`. Each trip lives in its own slug-named folder containing an atlas note (the trip homepage) plus **five default section notes (Flights, Stay, Packing List, To Do, Notes)** and an optional kanban board sub-folder. Helpful links live in a `links: []` array on the **atlas** (there is no separate Links section). The hub at `spice/trips/Trips.md` lists all trips as BeaconCards grouped by temporal status. `module_directory: trips`. Headspace-only subscription (the only consumer vault subscribed to trips).

## The one-paragraph model

Three note types — `trips-hub` (the single root `spice/trips/Trips.md`), `trip` (one atlas per trip, the folder homepage), `trip-section` (zero-or-more per trip: Flights, Stay, Packing List, To Do, Notes, custom). **Folder-is-truth: the slug folder IS the trip.** Frontmatter carries identity (`type`, `section_kind`, `section`, `trip`, `trip_slug`) — never structural position — so sections auto-discover each other via the folder, moves are just file renames, and adding a custom section gets automatic nav coverage without any registry update. Every note renders a single **`TripsChromeBar`** block above its content — the bar owns the breadcrumb, launcher nav, **and the section/atlas Add actions** (primary right of the compass + a `⋯` overflow, no in-body Add buttons). `TripNavButtons` is **headless** (creation logic only, no render).

## Note types + frontmatter

```yaml
# trips-hub  (spice/trips/Trips.md — one per vault)
type: trips-hub
cssclasses:
  - wide
```

```yaml
# trip  (spice/trips/<slug>/<Trip Name>.md — one per trip)
type: trip
name: "Dave's Wedding"
created_at: "2026-05-01T09:00:00-07:00"
start_date: "2026-08-14"
end_date: "2026-08-17"
location: "Nashville, TN"
people: []
links: []                    # helpful links live on the atlas (TripLinks)
cssclasses:
  - wide
```

```yaml
# trip-section  (spice/trips/<slug>/<Trip Name> — <Section>.md)
type: trip-section
section_kind: flights        # enum — see TripSectionKinds below
section: "Flights"           # display label
trip: "[[Dave's Wedding]]"   # wikilink → atlas basename
trip_slug: daves-wedding     # folder slug (for Breadcrumb link resolution)
created_at: "2026-05-01T09:00:00-07:00"
```

Type values are globally unique (no collision with project's `docs-hub`/`section-hub` or wiki's `wiki-hub`/`wiki-section`).

## Collision-free naming (the headline change)

**Before this refactor** every trip folder had identical generic basenames — `Trip Atlas.md`, `Trip Flights.md`, `Trip Packing List.md` — making Obsidian wikilinks ambiguous, the graph muddy, and the quick-switcher full of duplicates (`[[Trip Packing List]]` could resolve to any trip).

**After:** filenames are globally unique and tied to the trip's display name:

- **Atlas:** `<Trip Name>.md` — e.g. `Dave's Wedding.md`
- **Sections:** `<Trip Name> — <Section>.md` — e.g. `Dave's Wedding — Flights.md`, `Dave's Wedding — Packing List.md`

The em-dash separator (`—` U+2014) is literal. Both parts are sanitized via `_sanitizeFilename` (strips `\ / : * ? " < > |`, collapses whitespace). **Behavior is driven by frontmatter, not filenames** — the type, section_kind, and trip fields are authoritative; the filename is a human-readable consequence.

The `_createTrip` flow in `TripNavButtons` enforces this: the atlas is written to `${tripDir}/${atlasBase}.md`, and each section to `${tripDir}/${atlasBase} — ${label}.md`. It **iterates `customJS.TripSectionKinds.all()`** and writes `Template, Trip ${label}.md` per kind, so a new trip is always scaffolded with all five default sections (Flights, Stay, Packing List, To Do, Notes) — adding a kind to the SSOT + a matching template is all that's needed to scaffold a new default section. There is **no `Trip Links` template** (links live on the atlas via `links: []`), so no Links section is scaffolded. Custom sections created via "+ New Section" follow the same pattern: `${tripDir}/${atlasBase} — ${title}.md`.

## `TripSectionKinds` — the section single source of truth

`platform/blueprints/trips/helpers/trip-section-kinds.js` (runtime: `customJS.TripSectionKinds`) is the **SSOT for the 5 default section kinds**. `TripNavButtons` (scaffolding) and `TripSectionsCards` (atlas cards) consume it — this prevents the label/icon/order drift that existed before the refactor when the helpers maintained independent lists.

The `section_kind` enum values (with legacy-basename mappings for the heal):

| `section_kind` | Label | Legacy basename |
|---|---|---|
| `flights` | Flights | Trip Flights |
| `stay` | Stay | Trip Stay |
| `packing-list` | Packing List | Trip Packing List |
| `to-do` | To Do | Trip To Do |
| `notes` | Notes | Trip Notes |
| `custom` | *(any)* | *(not from legacy)* |

There is **no `links` kind** — helpful links moved to the atlas `links: []` array (see `TripLinks` below). The v2 heal retires any pre-existing `section_kind: links` note.

Key methods: `all()` → full list in order, `order(kind)` → sort index (999 for unknown), `labelFor(kind)`, `kindFromLegacyBasename(basename)` → `"custom"` if no match, `iconFor(kind)` → inline SVG.

`install.js` embeds a Node-side copy (`TRIP_SECTION_KINDS`) kept in lockstep with the class (install.js cannot load customJS classes). **If you update the enum, update both files.**

## Render helpers (`platform/blueprints/trips/helpers/`)

### `TripsHubCards`

Renders the full trip list on the hub as a **BeaconCards `layout:"row"` grid** with inline SVG plane icon, location subtitle, and date range meta. Groups: **Current Trip** (today is between start and end), **Upcoming Trips** (start is in the future), **Past Trips** (everything else). Sort: Current → Upcoming (ascending start date) → Past (descending, most recent first). Notes with no `start_date` fall into Past. The hub also renders a `+ New Trip` action button (via `TripNavButtons._renderTripsHub`).

### `TripsChromeBar` — the single chrome bar (breadcrumb + nav)

`TripsChromeBar` is the **one block every trip note (hub, atlas, section, board, board-card) renders above content**. It owns the entire chrome: the ancestors-mode **breadcrumb trail**, the **launcher nav** (a full-width PRIMARY button back to the atlas when off-atlas, and a "Go to…" launcher pill), **and the per-surface Add actions**. Context is detected from `file.path`: `spice/trips/Trips.md` → hub; `spice/trips/<slug>/<name>.md` with `type: trip` → atlas; same path different type → section; `.../board/<slug>-board.md` → board; `.../board/<card>.md` → card.

**Chrome-bar-hosted Add actions.** Every Add gesture lives on the bar — a **primary action to the right of the compass** plus a `⋯` **overflow menu**; there are **no in-body Add buttons**. The action set is context-specific: the atlas offers Add Link / Manage Links (→ `TripLinks.openAdd` / `openManage`); the To Do section offers Add task (→ `TaskDialog` pre-selecting this trip); the structured sections (Flights / Stay / Packing List) surface their add form via `TripEntryList`; and every off-hub surface offers `+ New Section` (→ `TripNavButtons._createTripSection`).

The **Go-to launcher** is a `document.body` overlay — a **full-width bottom sheet on mobile** (drag handle, 72 vh, safe-area inset) and an **anchored dropdown on desktop** (300 px, below the pill). It lists sibling sections ordered by `TripSectionKinds.order(section_kind)` then alphabetically, then the Trip Board (if it exists), then a `+ New Section` action. Selecting `+ New Section` prompts for a title and calls `TripNavButtons._createTripSection` → `<atlasBase> — <title>.md` with canonical `trip-section` frontmatter and a single `TripsChromeBar` block. A single `close()` teardown handles backdrop-tap, Escape, and re-tap toggle so no keydown listener leaks.

### `TripNavButtons` — headless (creation logic only)

`TripNavButtons` **no longer renders any chrome**. It is a headless helper holding the creation flows only: `_promptForTripDetails` / `_createTrip` (the `+ New Trip` dialog + full section scaffold), and `_promptForSectionTitle` / `_createTripSection` (the `+ New Section` flow, invoked by `TripsChromeBar`'s launcher). `_createTrip` iterates `customJS.TripSectionKinds.all()` and writes one section per kind, so a new trip gets all five defaults (Flights, Stay, Packing List, To Do, Notes) — no Links section (links live on the atlas). New section notes it writes carry **only** a single `TripsChromeBar` block — never legacy `Breadcrumb` / `SpaceNavButtons` / `TripNavButtons` render blocks.

### `TripEntryList` — shared structured-entry CRUD

`platform/blueprints/trips/helpers/trip-entry-list.js` is a **shared CRUD helper** that powers the structured sections — **Packing List** (grouped: categories + checkable items), **Flights**, and **Stay**. `render(dv, spec)` reads a frontmatter array (e.g. `packing_items`, `flights`, `stays`), renders rows with per-row edit/delete plus a **typed** add/edit form (each field declares a `type` — `text` / `date` / `time` / `select` / `link`), and persists edits back to frontmatter. In grouped mode (packing) it renders "Add category" / "Add item" controls and tracks each row's absolute source index so edits/deletes target the right entry. Static ops (`addCategory`, entry filters) are class statics; `render` + handlers are instance methods. The section templates instantiate it with different specs — no per-section CRUD code is duplicated.

**Flights v2 (multi-leg).** Each `flights` entry is one **leg** carrying a `direction` (`Outbound` / `Return`, a `select`), airline / flight #, from / to, typed **date + time** fields (`depart_date`, `depart_time`, `boarding_time`), gate, seat, confirmation, and a **per-leg booking `link`**. `TripEntryList` groups the rendered rows by direction so a multi-leg itinerary reads as Outbound-then-Return.

### `TripLinks` — helpful links on the atlas

`platform/blueprints/trips/helpers/trip-links.js` owns links, which live in the **atlas** (`type: trip`) `links: []` frontmatter array of `{ url, text }` entries — there is **no separate Links section**. One class owns all three concerns: static `addLink` / `updateLink` / `deleteLink` mutation ops (a verbatim port of `ProjectLinksManager`, unit-tested in Node); instance `openAdd(dv)` / `openManage(dv)` add / edit / delete modals wired to the atlas chrome bar (read + write the current note's `links` via `app.fileManager.processFrontMatter`); and instance `render(dv)` — the read-only clickable link grid drawn on the atlas body.

### `TripSectionsCards`

Renders a **BeaconCards `layout:"stacked"` grid** on the atlas, grouped **Default Sections** (known `section_kind`) / **Additional Sections** (`section_kind: custom`). Within Default Sections, cards sort by `TripSectionKinds.order()` with the Trip Board appended last. Additional Sections sort alphabetically. Reads siblings from the live vault folder (not a Dataview query) so newly created sections appear immediately after `Cmd+R`.

### `TripDashboard` — atlas summary

`TripDashboard.render(dv)` renders a summary strip on the atlas: a **countdown** (`countdown(start, end, asOf)` → days-until / in-progress / past) with **human-readable dates** (e.g. `Aug 14 – Aug 17`, not raw ISO), **packing progress** (`packingCounts(items)` → checked/total, scanned from the sibling packing-list note's `packing_items`), and an **open-task count**. Pure statics (`countdown`, `packingCounts`) are unit-tested; `render` does the folder scan + task query.

## Task-note ↔ trip link (TaskDialog + TaskTripList)

Trip tasks are **first-class task notes** (`spice/tasks/`), not inline dataview fields. `TaskDialog` renders a **Trip `<select>`** and writes `trip` (`[[<Trip Name>]]`) + `trip_slug` frontmatter on the task note. `TaskTripList` (a **`task-entity` mechanism** class, `platform/mechanisms/task-entity/task-trip-list.js`) reads those fields and renders the trip's tasks — it is mounted by the `Trip To Do.md` template so a trip's To-Do section lists its linked tasks, and the same tasks also surface on the daily. The chrome bar's **Add task** action on the To-Do surface opens `TaskDialog` pre-selecting that trip. The Trip `<select>` is **gated on the trips blueprint being installed** (the presence of `window.customJS.TripsChromeBar`); trip-less vaults never render it and the link is a safe no-op. The **v1 inline `[trip:: [[…]]]` field is retired** — no scaffolding, template, or dialog writes it.

## Upcoming trips on the daily / home

`SpaceDailyDashboard.selectUpcomingTrips(dv, todayStr, horizonDays = 14)` selects `type: trip` atlas notes whose `start_date` falls within `[today, today + horizon]` (UTC-safe via `_utcDay`; soonest-first; already-begun and beyond-horizon dropped; never throws). The daily/home dashboard renders these as an **"Upcoming trips"** panel. Missing `spice/trips` (accuris, ero) renders nothing. **Dogfood invariant:** the canonical `platform/blueprints/daily/helpers/space-daily-dashboard.js` and the ranch copy `ranch/scripts/daily/space-daily-dashboard.js` must stay byte-identical (guarded by `HC-V0842-A1` in preflight).

## Chrome

Every trip note (hub, atlas, section, board) renders a **single `TripsChromeBar` `dataviewjs` block** (calling `customjs-guard`) above its content — the bar owns both the breadcrumb and the nav. There is **no** separate `Breadcrumb` / `SpaceNavButtons` / `TripNavButtons` render block; the `_tripStripLegacyChrome` heal (below) forward-migrates any existing note off the old three-block stack.

The breadcrumb inside the bar uses the shared `breadcrumb` mechanism's **`ancestors` mode** (not `path_walk`). The manifest declares per-type breadcrumb atoms:

- `trips-hub` → single crumb: `Trips` (no link, current)
- `trip` → `Trips` (linked `spice/trips/Trips.md`) › `<name>` (current, from `fm:name|file:basename`)
- `trip-section` → `Trips` (linked) › `<Trip Name>` (linked via `spice/trips/{fm:trip_slug}/{fm:trip}.md`) › `<Section>` (current, from `fm:section|file:basename`)

The `trip_slug` + `trip` frontmatter fields are what make the middle crumb resolvable — both are required on every section note.

**SectionLabel** replaces managed `## H2` headings. The hub's `## All Trips` and the atlas's `## Mentions` are both converted to `SectionLabel` blocks by the install heal (and are absent from new-create templates, which emit `SectionLabel` blocks directly).

**Board exemption:** the kanban board at `spice/trips/<slug>/board/<slug>-board.md` (type `kanban`) keeps its `## Column` headings (kanban columns must be H2 in Obsidian's kanban plugin). The board is **outside the breadcrumb scope** — its `type: kanban` would collide with the project board type and it is not in the breadcrumb registry. `TripsChromeBar` handles nav on the board via the same primary + Go-to launcher, so the board still has full nav coverage.

## Install heals — `applyTripsConformanceHeal` + `_tripStripLegacyChrome` (in `platform/install.js`)

An **ungated backfill** (runs every install; not version-gated per the migration-lifecycle rule, because it renames real user notes). Migrates pre-refactor trips that used generic folder-wide basenames (`Trip Atlas.md`, `Trip Flights.md`, etc.) to the collision-free canonical shape, and forward-migrates chrome to a single `TripsChromeBar`.

**What it does, per trip folder:**

1. Locates the atlas by scanning top-level `.md` files for `type: trip` + a `name:` field.
2. Computes the canonical atlas basename (`_tripSanitize(name)`) and builds a rename plan.
3. For each non-atlas `.md` in the folder: reads existing `section_kind` + `section` from frontmatter (idempotent — already-canonical notes are authoritative), or falls back to `_tripKindFromLegacy(basename)` for the first-migration pass.
4. Applies per-note transforms: `_tripMigrateCreatedAt` (legacy `created:` → `created_at:`, coerces date-only to ISO+TZ), `_tripStripLoneTripTag` (removes lone `tags: [trip]` block), `_tripSetFmKey` (replace-or-insert canonical `type`/`section_kind`/`section`/`trip`/`trip_slug` fields), **`_tripStripLegacyChrome`** (see below), `_tripRepairAtlasLinks` (`[[Trip Atlas]]` → `[[<atlasBase>]]`).
5. Hub: injects Breadcrumb, converts `## All Trips` → SectionLabel. Atlas: chrome-strips to a single `TripsChromeBar`, converts `## Mentions` → SectionLabel (only when a BacklinkPanel block is also present).

**v2 heal additions (same ungated backfill):**

- **`_tripEnsureAtlasLinks(body)`** — ensures the trip atlas frontmatter carries a `links: []` key (v2 moves links onto the atlas). No-op when a `links:` key is already present.
- **Orphan Links-section retirement** — any `section_kind: links` note (the retired v1 Links section) is **backed up and removed** rather than renamed; its links have moved to the atlas array. Counted separately (`retire[]`) in the per-trip plan.
- **`_tripBoardCardChrome(body)`** — bare `type: trip-board-card` notes (v1 board cards had no chrome) get **exactly one `TripsChromeBar`** block, reusing `_tripStripLegacyChrome`'s inject-if-missing + de-dupe logic. Only acts on `trip-board-card` notes; anything else is returned unchanged.

**`_tripStripLegacyChrome(body)`** is the chrome-migration primitive (pure, idempotent, never throws; mirrors `applyProjectChromeBarHeal`'s posture). It strips every legacy standalone chrome guard block (`Breadcrumb` / `SpaceNavButtons` / `TripNavButtons` — the "double breadcrumb" bug when they coexist with a `TripsChromeBar`), ensures **exactly one** `TripsChromeBar` block exists (injected right after the frontmatter when absent), and de-dupes any extra `TripsChromeBar` blocks. It supersedes the old `_tripInjectBreadcrumb` for atlas/section notes.

**Backup posture:** one `_copyDirRecursive` into `.sauce-backup/trips/<slug>/<ts>/` **before any write**, only when the plan is non-empty. Hub backed up individually to `.sauce-backup/trips/Trips.md.<ts>`.

**Idempotency contract:** a second run writes ZERO files. All change-detection is existence/substring/regex-based against the already-canonical state: canonical filenames already match, a single `class: "TripsChromeBar"` present with no legacy blocks, `section_kind` present, `## All Trips` / `## Mentions` headings already converted → all transforms are no-ops.

**Error posture:** per-trip `try/catch` → pushes a `warning` event to history and continues to the next trip. A failed trip never blocks other trips or the rest of the install.

## Manifest surfaces

`customjs_classes`: TripSectionKinds, TripsHubCards, TripNavButtons, TripSectionsCards, TripDashboard, TripsChromeBar, TripEntryList, **TripLinks** (single class; no `TripLinksPanel` / `TripLinksManager` / `TripToDoActions`). `depends_on`: nav-buttons, customjs-guard, cards, convenience, backlink-panel, render-safe, **chrome-bar (>=0.3.0)**. `nav_buttons[]`: the Trips button (`openLink → spice/trips/Trips.md`, order 110). `breadcrumb.types[]`: trips-hub + trip + trip-section + trip-board-card (ancestors mode). The `section_kind` rule regex is `^(flights|stay|packing-list|to-do|notes|custom)$` — **no `links`**. `TaskTripList` is a `task-entity` mechanism class, not a trips class.

## Key decisions / gotchas

- **Folder-is-truth, not filename-as-type.** The `type` frontmatter field determines note behavior; the filename is a human-readable consequence. Do not derive type from filename.
- **`TripSectionKinds` is the SSOT (5 kinds, no `links`).** Never hardcode section labels or icons in `TripNavButtons` or `TripSectionsCards` — always go through `customJS.TripSectionKinds`. The Node-side copy in install.js must be kept in lockstep. To add a default section, add a kind here **and** ship a matching `Template, Trip <Label>.md` (mapped in the manifest `files[]`) — `_createTrip` iterates `all()` and scaffolds one section per kind. Links are **not** a section — they live on the atlas (`TripLinks`, `links: []`).
- **`TripsChromeBar` owns chrome; `TripNavButtons` is headless.** No trip note renders `Breadcrumb` / `SpaceNavButtons` / `TripNavButtons` blocks anymore — just one `TripsChromeBar`. `TripNavButtons` holds only the creation flows (`_createTrip` / `_createTripSection`). The `_tripStripLegacyChrome` heal migrates any surviving legacy-chrome note.
- **`section_kind: custom`** is the catch-all for user-created extra sections (e.g. "Honorees", "Restaurants"). `TripSectionKinds.order("custom")` returns 999, so custom sections always sort after the five defaults.
- **The "Go to…" launcher teardown is single-path.** All dismiss paths (backdrop, Escape, re-tap) route through the one `close()` closure that also removes the keydown listener. Do not add a second teardown path or the listener will leak.
- **Atlas link in section frontmatter is the basename, not a path.** `trip: "[[Dave's Wedding]]"` — just the basename, no folder prefix. The breadcrumb resolution uses `{fm:trip_slug}/{fm:trip}.md` to build the full path.
- **Task↔trip link is gated on `window.customJS.TripsChromeBar`.** The `TaskDialog` Trip `<select>` + the chrome-bar "Add task" action only render when trips is installed; trip-less vaults no-op. Trip tasks are task notes carrying `trip`/`trip_slug` frontmatter (rendered by `TaskTripList`), **not** the retired v1 inline `[trip::]` field.
- **Board is out of breadcrumb scope.** Its `type: kanban` clashes with the project kanban type; do not add it to the breadcrumb registry. `TripsChromeBar` gives it nav coverage instead.
- **Headspace-only.** The trips blueprint is subscribed only in headspace. Deployments to accuris or ero do NOT include trips.
- **Class changes render only after `Cmd+R`** in Obsidian after each brew upgrade.
