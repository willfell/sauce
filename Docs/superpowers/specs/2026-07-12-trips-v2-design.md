# Trips Blueprint v2 — Design

**Date:** 2026-07-12
**Blueprint:** `trips` (+ shared `task-entity` mechanism, `daily`/`home` blueprints)
**Builds on:** v0.215.x trips overhaul. Working examples: `bussin` + `destin` trips in `headspace-sauce`.

## Problem

The v1 overhaul shipped the feature surfaces but several fall short of the platform's standard and the user's intent:

1. **Add buttons live in the note body** (below the nav). They must move onto the chrome bar — a primary button right of the compass, secondary actions in ⋯ — for every section (flights, packing, stay, to-do) and the atlas (links). No action buttons below the nav anywhere in the blueprint.
2. **Trip to-do tasks don't behave like project tasks.** v1 wrote an inline `[trip:: [[..]]]` field via `ToDoCreateTask`, so the task landed only as a daily line, was not filed under the trip, and did not appear in the trip's To-Do. Projects use the `task-entity` note model (`spice/tasks/*.md` with `project_slug`, rendered by `TaskProjectList`). Trips must do the same with `trip_slug`.
3. **Packing "Add item" shows Category twice** and free-types the category.
4. **Links** deserve to live on the trip hub (atlas), not a standalone section note.
5. **Dashboard dates render as epoch millis** (`1783922400000 → …`).
6. **Flight/stay date + time entry is free-text** — needs real calendar + time pickers.
7. **Flights are single, thin.** Need multiple legs (2 each way), grouped by direction, with rich per-leg detail (airline, airports, depart date/time, boarding time, gate, seat, confirmation) and a link.
8. **Trip board cards are bare** — no breadcrumb/chrome (unlike project task-board cards).
9. **Upcoming trips aren't surfaced** on the daily/home note.

## Architecture

### A. Chrome-hosted section actions
`TripsChromeBar.detect` adds `sectionKind` (from `page.section_kind`) to the context. `surfaceSpec` switches on `context` + `sectionKind` to return a per-section **primary** button (right of compass) and **overflow** entries (⋯):

| Surface | primary | overflow |
| --- | --- | --- |
| `trip` (atlas) | `add-link` "Add link" | `manage-links`, `new-section` |
| section `flights` | `add-flight` "Add flight" | — |
| section `stay` | `add-stay` "Add stay" | — |
| section `packing-list` | `add-packing-item` "Add item" | `add-packing-category` "Add category" |
| section `to-do` | `add-task` "Add task" | — |
| section `notes`/`custom`/other | none | — |
| `trip-board-card` | none | — |

`dispatch(dv, ctx, id)` routes each id to the owning helper's method (e.g. `add-flight` → `TripEntryList` flight-add; `add-task` → `TaskDialog.open({surface:"trip", trip:{name,slug}})`; `add-link` → trip links add). The section helpers keep rendering **read-only lists** in the note body but **no longer render button rows** — the bar owns all actions. Mirrors `ProjectChromeBar._surfaceSpec`/`_dispatch` (docs-hub `new-doc`, links-hub `add-link`, project `new-task`).

To reach a helper's add flow from `dispatch`, each helper exposes a callable method that opens its form modal given `dv` (and, for flights/packing, the field spec). `TripEntryList` gains `openAdd(dv, spec)` / `openAddCategory(dv, spec)` used by both the bar dispatch and (for edit/delete) row controls that remain in-body on each list row.

### B. Trip tasks = real task notes (projects parity)
The shared `task-entity` mechanism learns generic trip linkage, additive and parallel to project linkage:
- `TaskEntity.composeNote` frontmatter gains `trip: ''` (link-valued display) and `trip_slug: ''` (plain-string filter key), right after `project_slug`. `parseNote` coerces `trip` via `_linkText`, keeps `trip_slug` a plain string.
- `TaskDialog.open(opts)` accepts `opts.trip = {name, slug}` (parallel to `opts.project`); `_create` and `_saveEdit` write `trip`/`trip_slug` when present.
- New `TaskTripList` (clone of `TaskProjectList`) renders on the Trip To Do note: queries `spice/tasks` for `type==='task' && status==='open' && trip_slug===ourSlug && source!=='meeting'`, renders rows via `TaskTodayList.renderTaskRow`. Pure `_matches(task, tripSlug)` for unit tests.
- The Trip To Do template mounts `TaskChromeBar`-style chrome + a `SectionLabel("Trip Tasks")` + `TaskTripList`. The bar's `add-task` opens `TaskDialog` with the trip preselected.
- The old inline `[trip:: [[..]]]` path in `ToDoCreateTask` (v1) is removed (both the Trip select and `_appendTripField`), since trips now use the note model. `TripToDoActions` (v1's in-body button) is retired.

Because a task note carries `trip_slug`, it appears in the daily (via `SpaceDailyDashboard.selectTasks` scanning `spice/tasks`) AND the trip To-Do (via `TaskTripList`) with zero extra writes — exactly like projects. `TaskProjectList` is unaffected (trip-only tasks have empty `project_slug`).

Schema: bump `task-entity` schema; add `trip`/`trip_slug` to its rule_fragment as optional strings. Seed migration is a no-op for existing task notes (fields simply absent/empty; additive).

### C. Links on the atlas; Links section dropped
- Remove the `links` section kind from `TripSectionKinds`, the `Trip Links.md` template, `TripLinksPanel`/`TripLinksManager` classes, and the `links` schema enum value.
- Add link storage to the atlas: `links: []` frontmatter on `Trip Atlas.md`. A read-only `TripLinksView` renders a link grid on the atlas body (below the dashboard). Add/Manage live on the atlas nav bar (`add-link` primary, `manage-links` overflow) using the same static link ops (kept as `TripLinks` static helpers).
- Heal: `applyTripsConformanceHeal` removes an orphan `Links` section note from each trip (backup-first) and ensures the atlas carries `links: []`.

### D. Typed forms
`TripEntryList`'s form builder accepts a field `type`: `text` (default), `date` (`<input type="date">`), `time` (`<input type="time">`), `select` (`options` array), `link` (`<input type="url">`). Date/time inputs use the task-dialog iOS-safe `dateCss` (`-webkit-appearance:none; max-width:100%`). Edit reopens the same typed form.

### E. Flights v2
`flights: [{ direction, airline, flight_no, from, to, depart_date, depart_time, boarding_time, gate, seat, confirmation, link }]`. `direction` is a `select` (`Outbound`/`Return`). Add-flight opens the typed form (date + time pickers, url link). The Flights note renders legs **grouped under Outbound / Return** `SectionLabel`s, each a detail card:
```
✈ Delta DL2235 · Outbound
DEN → ATL   depart Aug 1, 1:00 PM · board 12:30 PM · gate B24 · seat 14C
confirmation ABC123 · [Manage booking ↗]
```
Empty state hidden. Edit/Delete per row remain in-body row controls; only the "Add flight" trigger is on the bar.

### F. Stay v2
`stays: [{ name, address, check_in, check_out, confirmation, link }]` with `date` pickers for check-in/out and a per-stay link. Detail card shows name, address, `check_in → check_out` (human dates), confirmation, link. Add on the bar.

### G. Packing fix
Add-item form = one **category `select`** auto-selecting the first existing category (no second Category field) + item text. "Add category" is the ⋯ overflow action (single text field). Grouped checkbox rows unchanged (absolute-index preserved).

### H. Dashboard dates
`TripDashboard` gains `_fmtDate(v)` normalizing a Dataview date value (Date/luxon/epoch/ISO string) to `MMM D, YYYY`; the dates stat renders `Aug 1 – Aug 5, 2026`. Countdown/task/packing logic unchanged.

### I. SpaceHome upcoming trips
`SpaceDailyDashboard` gains a pure `selectUpcomingTrips(dv, todayStr, horizonDays=14)` querying `spice/trips` for `type==='trip'` with `start_date` within the window (UTC-safe), sorted soonest-first, returning `[{name, path, daysAway}]`. `render` shows an "Upcoming trips" panel ("Bussin — in 6 days") when non-empty. Gated: no `spice/trips` → empty → nothing renders (accuris/ero unaffected). SpaceHome picks it up through the existing dashboard block.

### J. Board card chrome
- Add a `trip-board-card` breadcrumb type to the trips manifest (ancestors: `lit:Trips`→hub, then `fm:trip`→`spice/trips/{fm:trip_slug}/{fm:trip}.md`; current `file:basename`).
- The Trip Board Card template writes `trip`/`trip_slug` frontmatter at create time (its Templater block derives them from the board path) + the `TripsChromeBar` block — so a card gets a real breadcrumb + chrome. Mirrors project task-board-card.
- Heal backfills existing bare trip board cards (inject chrome + frontmatter, backup-first, idempotent).

## Testing

Behavioral harness:
- `task-entity`: `composeNote`/`parseNote` round-trip trip fields; existing project tests still green.
- `TaskTripList._matches(task, tripSlug)`: slug-equal + non-meeting; excludes project-only tasks.
- `TripEntryList`: typed-field form (date/time/select/link render), packing single-category add-item, flight direction grouping (`_groupByDirection`), absolute-index edit/delete.
- `TripsChromeBar.surfaceSpec`: per-section primary/overflow ids; leaf sections (notes/board-card) have no add; atlas has add-link.
- `TripDashboard._fmtDate`: Date/epoch/ISO → `MMM D, YYYY`.
- `SpaceDailyDashboard.selectUpcomingTrips`: 14-day UTC window, sort, gating (empty when no trips).
- Heals: Links-section removal + atlas `links: []`; board-card backfill; idempotent 2nd pass; `.sauce-backup` written.
- Seed sentinels + task-entity schema bump; `lint-schemas`, `lint-note-chrome`, `lint-cold-load` green.

## Migration / heals (all `.sauce-backup`-first, idempotent, never-throw)
- `applyTripsConformanceHeal` extended: drop orphan `Links` section note; ensure atlas `links: []`; backfill bare board cards with chrome + `trip`/`trip_slug`; keep the v1 legacy-chrome strip.
- Templates updated: Trip Atlas (dashboard date fmt + links view), Trip Flights/Stay/Packing/To Do (chrome-hosted actions, typed forms), Trip Board Card (chrome + fm). Trip Links template removed.

## Non-goals
- No datetime-local (two adjacent date+time inputs — the established iOS-safe pattern).
- No changes to `TaskProjectList`/project behavior beyond the additive schema fields.
- No hand-versioning — the release pipeline owns semver/tags/tap.

## Files (indicative)
- `platform/mechanisms/task-entity/`: `task-entity.js` (+trip fields), `task-dialog.js` (+trip opt), new `task-trip-list.js`; schema bump.
- `platform/blueprints/trips/helpers/`: `trips-chrome-bar.js` (section actions), `trip-entry-list.js` (typed forms, flight grouping, packing fix, headless add methods), `trip-section-kinds.js` (−links), `trip-dashboard.js` (`_fmtDate`), new `trip-links.js` (static ops + `TripLinksView`); remove `trip-links-panel.js`/`trip-links-manager.js`/`trip-todo-actions.js`.
- `platform/blueprints/trips/templates/`: Atlas, Flights, Stay, Packing List, To Do, Board Card updated; Trip Links removed.
- `platform/blueprints/daily/helpers/space-daily-dashboard.js`: `selectUpcomingTrips` + panel.
- `platform/blueprints/trips/manifest.json`: `trip-board-card` breadcrumb, customjs_classes (+TaskTripList? no — task-entity owns it), section enum (−links), files list.
- `platform/blueprints/to-do/helpers/todo-create-task.js`: remove v1 trip select + `_appendTripField`.
- `platform/install.js`: heal extensions + `TRIP_SECTION_KINDS` (−links).
- `Docs/agent-guides/trips-blueprint.md`: refresh.
