---
date: 2026-07-02
phase: design
status: approved
target_cycle: trips v0.5.0 (MINOR) — pipeline-computed
blueprint: trips
scope: headspace-only
related:
  - ../agent-guides/note-chrome.md
  - ../agent-guides/project-blueprint-ui.md
  - ../agent-guides/wiki-blueprint.md
  - ../agent-guides/schemas.md
  - ../agent-guides/migration-regression-net.md
  - ../landmines.md
---

# Design — Trips blueprint conformance refactor (v0.5.0)

> [!abstract] Goal
> Bring the `trips` blueprint into line with the vault-wide standards the other structural blueprints already follow: breadcrumb chrome, `SectionLabel`-owned dividers, conformant buttons, collision-free note naming, canonical frontmatter, a schema-registry entry, and canonical docs. Ship as one MINOR cycle to headspace (the only vault that subscribes to trips), healing all 8 existing trips.

> [!info] Why this design exists
> Trips predates the note-chrome arc and never adopted it. It is **not** an "adopted" blueprint (no `breadcrumb` manifest block), hand-rolls its own nav chrome (`<hr>` + a "Trip" label `<div>` instead of `SectionLabel`), uses horizontal-scroll button rows that violate the button rules, and — most importantly — every trip ships **identically-named notes** (`Trip Atlas.md`, `Trip Flights.md`, `Trip Packing List.md`, …) so `[[Trip Packing List]]` is ambiguous, the graph is muddy, and quick-switcher shows 8 identical entries. Two of its helpers even disagree on section basenames (`TripNavButtons` keys on `"Trip Flights"`; `TripSectionsCards` keys on `"Flights"`), so section grouping/icons are already partly broken.

## Decisions locked during brainstorming

1. **Per-trip nav layout:** a full-width primary button back to the Trip Atlas + a single **"Go to…" dropdown** for every other area — reusing the shipped `SpaceNavButtons` launcher grammar (NOT multiple rows, NOT a hybrid).
2. **Deliverables:** breadcrumb adoption + install heal; `SectionLabel` + button conformance; canonical docs. Trip *content organization* (how older trips pack content into the Atlas body) is out of scope — freeform user content is left exactly as-is.
3. **Collision-free naming scheme:** trip-name-prefixed, with a `section_kind` frontmatter field driving label/icon/order so filenames stay decoupled from behavior (mirrors the projects blueprint's `frontmatter_branch` approach).
4. **Section filename separator:** ` — ` (em dash, spaces). Cosmetic only — affects quick-switcher/graph, not button labels.
5. **Link repair in heal:** best-effort internal `[[Trip Atlas]]`-style link repair is in scope.

## 1. Collision-free naming + data model

| Note | Before | After |
| --- | --- | --- |
| Atlas | `spice/trips/<slug>/Trip Atlas.md` | `spice/trips/<slug>/<Trip Name>.md` |
| Section | `spice/trips/<slug>/Trip Flights.md` | `spice/trips/<slug>/<Trip Name> — Flights.md` |
| Board | `spice/trips/<slug>/board/<slug>-board.md` | *unchanged* (already slug-unique) |

- Atlas detection stays `type: trip` (already filename-independent). `<Trip Name>.md` sanitizes filename-illegal characters (`/ : \ | ...`) while frontmatter `name` keeps the raw display name.
- Section notes get canonicalized, fully filename-independent frontmatter:

```yaml
type: trip-section
section_kind: flights          # flights | stay | packing-list | to-do | notes | custom
section: "Flights"             # display label (nav button, breadcrumb current, cards)
trip: "[[Dave's Wedding]]"     # canonical cross-ref → atlas; resolves uniquely post-rename
trip_slug: daves-wedding       # actual folder slug (STORED, not derived — slugify("Dave's Wedding")="dave-s-wedding" ≠ real folder)
created_at: "2026-01-09T00:00:00-07:00"   # canonical ISO+TZ (replaces legacy `created:`)
```

- `section_kind` → **icon + sort order**. `section` → **label**. Custom user sections: `section_kind: custom`, sorted after the five defaults, alphabetically by `section`.
- The canonical map lives in ONE place shared by nav + cards:
  `flights→Flights, stay→Stay, packing-list→Packing List, to-do→To Do, notes→Notes`, each with its Lucide icon.

## 2. Per-trip nav — primary + "Go to…" launcher

`TripNavButtons` rewritten to reuse the `SpaceNavButtons` v2.9.0 launcher grammar: overlay appended to `document.body` (never clipped by the note container), full-width bottom-sheet on mobile / anchored dropdown on desktop, closed by backdrop-tap / Escape / re-tap (single `close()` — no listener leak).

Chrome band headed by `SectionLabel { text: "Trip" }` (owns its own hairline — replaces the hand-rolled `<hr>` + label `<div>`).

| Context | Rendered nav |
| --- | --- |
| **Section / board note** | `[ ← <Trip Name> ]` full-width primary → atlas, then `[ Go to… ▾ ]` (all other sections + Trip Board; current self-excluded) |
| **Atlas** | `[ Go to… ▾ ]` full-width (sections + Trip Board) |
| **Hub** (`Trips.md`) | unchanged `+ New Trip` action button (existing create-flow dialog kept) |

- **`+ New Section`** is the last item inside the Go to… menu (visually separated), available from any trip note — not just the atlas.
- Buttons obey the button rules: `flex-wrap: wrap` + `text-overflow: ellipsis`/`overflow: hidden`/`white-space: nowrap`/`min-width: 0`; hover mutates individual style props (never rebuilds `cssText`).
- Menu entries: label = `fm:section` (fallback stripped-prefix basename), icon = map[`section_kind`] || fallback, order = default-kind order then custom alpha. Board synthesized from `board/<slug>-board.md` when present.

## 3. Breadcrumb + chrome conformance

New `breadcrumb` block in `platform/blueprints/trips/manifest.json` (ancestors-mode — trips are flat, and `path_walk`'s folder-hub resolver is hardcoded to `type === "wiki-section"`, so it is not reusable here):

```json
"breadcrumb": {
  "types": {
    "trips-hub":    { "current": { "label": "lit:Trips" } },
    "trip":         { "ancestors": [ { "label": "lit:Trips", "link": "spice/trips/Trips.md" } ],
                      "current": { "label": "fm:name|file:basename" } },
    "trip-section": { "ancestors": [ { "label": "lit:Trips", "link": "spice/trips/Trips.md" },
                                     { "label": "fm:trip",   "link": "{fm:trip}" } ],
                      "current": { "label": "fm:section|file:basename" } }
  }
}
```

- `trip` crumb link `"{fm:trip}"` emits the bare wikilink target — resolves uniquely once names are collision-free (the whole point of §1). No slug derivation, so apostrophe-slug mismatches can't break it.
- Trails: hub → `Trips`; atlas → `Trips › Dave's Wedding`; section → `Trips › Dave's Wedding › Flights`.
- `type` values `trip` / `trip-section` / `trips-hub` are globally unique in the breadcrumb registry today (verified — no collision with meeting/scratch/to-do/project/wiki).
- **Board + board-card are out of breadcrumb scope**: `Trip Board.md` is `type: kanban` (collides with the project board type under first-match-wins dispatch) and keeps its kanban `## Column` headings per the documented kanban exemption. The nav helper already handles their back-navigation.

Chrome order on every trip note: **Breadcrumb → `SpaceNavButtons` → `TripNavButtons` → content**. No `---` between breadcrumb and nav (one chrome unit). Hub `## All Trips` and atlas `## Mentions` H2 → `SectionLabel`. **User freeform body H2s** (Flight Information tables, Hotel Information, etc.) are left untouched — they are content, not chrome.

## 4. Cards + hub fixes

- `TripSectionsCards` rewritten to key on `section_kind`/`section` frontmatter instead of basename. This fixes the existing latent bug (its `DEFAULT_ORDER = ["Flights", …]` never matched real basenames `"Trip Flights"`, so defaults were mis-grouped as "Additional Sections" with fallback icons).
- `TripsHubCards` already filters by `p.type === "trip"` and titles by `p.name || p.file.name`, so the atlas rename requires no change there.

## 5. Migration — `applyTripsConformanceHeal` (platform/install.js)

Per-trip, **backup-first** (`.sauce-backup/<slug>/<ts>/`), **idempotent**, per-trip `try/catch`, history events, **fails loud but never throws** — mirroring `applyWikiToDocsMigration` (project v0.52.0) and its CLI-adapter `fs.rmSync` fallback. For each `spice/trips/<slug>/`:

1. Locate the atlas (`type: trip`). Rename `Trip Atlas.md` → sanitized `<name>.md`. Rename each section `Trip <X>.md` → `<name> — <X>.md`.
2. Inject/repair section frontmatter: `type: trip-section`, `section_kind` (derived from old basename: `Trip Flights`→`flights`, `Trip Packing List`→`packing-list`, …, else `custom`), `section` (display), `trip` (`[[<name>]]`), `trip_slug`, and migrate legacy `created:` → canonical `created_at:`.
3. Inject the `Breadcrumb` dataviewjs block as the first chrome block on atlas + sections + hub (idempotency proxy: `class: "Breadcrumb"` substring — no visible marker comments).
4. Convert managed hub `## All Trips` / atlas `## Mentions` H2 → `SectionLabel` invocation (fence-aware; never touches user body H2s).
5. Best-effort repair of internal `[[Trip Atlas]]` / old-basename links → new atlas/section names (within the trip's own notes; skip ambiguous cross-trip links).

Idempotency: re-running finds files already renamed (new name exists) + frontmatter already canonical + breadcrumb block present → no-ops. Runtime helpers (nav/cards/breadcrumb) auto-upgrade on Cmd+R regardless; the heal only does what runtime can't (on-disk renames, frontmatter, breadcrumb injection).

## 6. Docs, schema registry, rules, tests

- **New** `Docs/agent-guides/trips-blueprint.md` — canonical reference (note types + folder-is-truth, the three helpers, the launcher chrome, the naming/collision invariant, the `section_kind` map, the heal). Modeled on `wiki-blueprint.md` / `finance-blueprint.md`. Wire it into the CLAUDE.md "Further reading" router.
- **New** `Docs/agent-guides/smoke-checklists/trips.md` (mirrors the meetings/project/scratch smoke checklists).
- **Schema registry:** add a `platform/schemas-index.json` entry for trips (atlas `trip` + `trip-section` + `trips-hub` contracts); `npm run lint-schemas` green.
- **Rule fragments:** update `manifest.json` rule_fragments to frontmatter-branch (type discrimination) so audit + hub-cards filters stay filename-independent (projects `frontmatter_branch` precedent); add a `trip-section` fragment requiring `type` + `section_kind` + `section` + `trip`.
- **Templates:** `Template, Trip Atlas.md` → dest `<Trip Name>.md` is set at create time; section templates gain canonical frontmatter + Breadcrumb block + `SectionLabel`. `_createTrip` / `_createTripSection` in the nav helper updated to emit new filenames + frontmatter.
- **Tests:** extend `platform/test/run-trips.js` (naming, `section_kind` map, launcher `_partition`, breadcrumb chain resolution, frontmatter canonicalization). Add a **seed-vault migration fixture** (`platform/test/seed-vault/`) with a pre-refactor trip (old names, legacy `created:`, no breadcrumb) and a portable sentinel asserting the heal renames + canonicalizes + injects chrome. Run `run-trips.js` + seed harness green before ship.

## 7. Build / ship posture

- Built in an **isolated git worktree** (`.worktrees/…`) to avoid the autoloop shared-tree corruption trap.
- Preflight (`node --check` + CJS-loadable + note-chrome lint + schema lint + run-trips + seed harness) green.
- Playwright-verified at phone width (≈390px) in light + dark: breadcrumb trail, primary + Go to… launcher (open/close/overflow), section cards grouping.
- **No hand-versioning.** Conventional commits; the release pipeline computes the trips MINOR bump (0.4.0 → 0.5.0) + umbrella semver, opens the auto-merging release PR, tags, and ships to brew.
- Deploy to headspace (only subscriber); user Cmd+R. Verify no drift (`npm run status` / audit).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Mass rename (~48 files across 8 trips) corrupts/loses a note | Backup-first `.sauce-backup` snapshot before any write; per-trip try/catch; seed-vault fixture proves the rename before it touches real data. |
| Atlas rename orphans an inbound `[[Trip Atlas]]` link | Step 5 best-effort repair; and inbound links were already ambiguous (8 identical basenames), so few reliable ones exist. |
| `type: kanban` breadcrumb collision if board added to registry | Board explicitly excluded from breadcrumb scope. |
| Heal re-run doubles frontmatter / stacks breadcrumb blocks | Idempotency proxies (new-name-exists, `class: "Breadcrumb"` substring, `type: trip-section` present). |
| Filename separator/illegal chars | Sanitize atlas + section filenames; frontmatter keeps raw display strings; labels come from `fm:section`, never the filename. |

## Out of scope

- Reorganizing how trips distribute content between the Atlas body and section notes.
- Board / board-card breadcrumb chrome.
- Any non-headspace vault (trips is headspace-only).
- Cross-trip link disambiguation for links that were already ambiguous before the refactor.
