# Trips Blueprint Overhaul — Design

**Date:** 2026-07-12
**Blueprint:** `trips` (headspace-only)
**Working example:** the "Destin" trip in `headspace-sauce`

## Problem

The trips blueprint lags the current platform conventions (as set by the up-to-date `wiki` and `project` blueprints). Six concrete gaps:

1. **Double breadcrumb / legacy chrome** on trip notes — a canonical `TripsChromeBar` coexists with stale `Breadcrumb`/`SpaceNavButtons`/`TripNavButtons` render blocks.
2. **Packing List has no add-mechanism** — the template is chrome-only. Need category + item add/check-off.
3. **"New Section" is broken and over-offered** — `_createTripSection` bakes legacy chrome into new custom sections, and the action shows on every surface including leaf section notes.
4. **To Do section is immature** — no "Add Task" affordance; no way to link a to-do task to a Trip (parallel to Project linking) that surfaces in the daily to-do note.
5. **No Helpful Links** — trips lack the per-entity links feature the project blueprint has.
6. **No structured schema / dashboard** — flights/stay are unstructured; the atlas has no at-a-glance summary (countdown, tasks left, packing progress).

## Architecture (cross-cutting)

- **`TripNavButtons` → headless logic class.** Delete `render()`, `detectContext()`, and the DOM-guarded launcher-overlay code. It retains only the creation logic that `TripsChromeBar` delegates to: `_createTrip`, `_createTripSection`, `_promptForTripDetails`, `_promptForSectionTitle`, and helpers. This removes the double-render risk at the source rather than relying on the fragile `.trips-chrome-root` DOM guard.
- **`_createTripSection` body fixed.** New custom sections are created with a single `TripsChromeBar` block only — no `Breadcrumb`/`SpaceNavButtons`/`TripNavButtons` blocks. Matches the clean section templates.
- **`applyTripsConformanceHeal` extended** (not a new heal) to strip legacy chrome blocks from existing trip notes and guarantee exactly one `TripsChromeBar` block — mirroring `applyProjectChromeBarHeal`. Idempotent, `.sauce-backup`-first, never-throws. Runs at its existing position in the trips heal chain.
- **`TripSectionKinds` gains a `links` entry** (6th default kind: flights, stay, packing-list, to-do, notes, **links**), so the per-trip Links sidecar is a normal default section listed by `TripSectionsCards` and scaffolded on trip creation.
- **Soft dependency trips → to-do.** The "Add Task" button and the `ToDoCreateTask` Trip dropdown are gated on runtime `window.customJS` class presence (`ToDoCreateTask` / `TripsChromeBar` truthy-checks) — the codebase's established "is X installed" precedent — **not** a hard `depends_on`. This keeps version coordination out of the picture and lets accuris/ero never see a Trip field.

## Issue 3 — New Section scope

Remove `new-section` from the overflow spec on `trip-section` / `trip-board-card` surfaces. It remains only on the **trip atlas** (`ctx.context === "trip"`), next to where `TripSectionsCards` already lists sections. Matches how wiki/project scope "create child" to the hub level. (`TripsChromeBar._config().surfaceSpec`: leaf section contexts return `overflow: []`.)

## Issue 2/6 — Shared CRUD helper `TripEntryList`

One reusable class (patterned on `ProjectLinksManager`'s static-mutation + form-modal approach) drives Packing List, Flights, and Stay. Parameterized by a field schema. Pure mutation logic is static and unit-tested; rendering + modals use `customJS.AccentButton`.

- **Packing List** — `packing_items: [{category, item, checked}]` on `Trip Packing List.md`. Renders grouped by category, each item a checkbox row (toggling writes `checked`). "Add" button offers **Add category** (creates an empty category bucket) and **Add item** (category `<select>` + item text). Edit/delete per row.
- **Flights** — `flights: [{airline, flight_no, depart_at, arrive_at, from, to, confirmation}]` on `Trip Flights.md`. Add-entry form modal; rows with edit/delete.
- **Stay** — `stays: [{name, address, check_in, check_out, confirmation}]` on `Trip Stay.md`. Add-entry form modal; rows with edit/delete.

All three write via `app.fileManager.processFrontMatter`. Empty state hidden (no label/divider) matching `ProjectLinksPanel`.

## Issue 5 — Helpful Links

New `Trip Links.md` template: `type: trip-section`, `section_kind: links`, `section: "Links"`, `links: []`. Rendering/mutation via `TripLinksPanel` + `TripLinksManager`, inlined from the project links pattern (deliberately NOT depending on the shared `links` mechanism, matching the project blueprint's documented "Option B" decision). The Links sidecar is scaffolded as a default section on new trips. It is not mirrored onto the atlas (the dashboard shows task/packing counts only, not links).

## Issue 4 — To Do integration

- **`TripToDoActions`** helper on `Trip To Do.md`: renders an "＋ Add Task" `AccentButton` at the top (gated on `customJS.ToDoCreateTask`). Clicking opens the real `ToDoCreateTask` dialog with this trip pre-selected in the Trip dropdown. Below the button, a live Dataview query lists open tasks whose text carries `[trip:: [[<ThisTrip>]]]`.
- **`ToDoCreateTask` dialog** gains a **Trip** dropdown, populated by scanning `spice/trips/*` for `type:trip` notes (mirrors the existing project folder-scan). The Trip control is shown only when `window.customJS.TripsChromeBar` is present, so vaults without trips never see it. On submit it appends `[trip:: [[<Trip Name>]]]` to the task line (mirrors `[project:: [[Name]]]`) — the task still lands in the vault's daily to-do note.

## Issue 6 — Dashboard `TripDashboard`

New block on `Trip Atlas.md`, ordered `TripsChromeBar → TripDashboard → TripSectionsCards → Mentions`. Displays:
- **Countdown** — days until `start_date` (UTC-safe date math); "in progress" between start/end; "complete" after end.
- **Trip info** — `start_date`–`end_date`, `location`.
- **Tasks left** — count of open tasks carrying `[trip:: [[ThisTrip]]]`.
- **Packing progress** — per-category unchecked/total counts read from the packing note's `packing_items[]`.

Compute logic is static + unit-tested; rendering is a compact card. Never-throws / cold-load-safe via `RenderSafe.page`.

## Schema / lint

`platform/schemas-index.json` rule_fragments updated: `section_kind` enum extended to include `links`. New optional-shape guidance (arrays of objects) documented but not hard-required per-field beyond existing required keys. `npm run lint-schemas` must pass.

## Testing

Behavioral harness (`platform/test/`):
- `TripEntryList` — add/edit/delete/toggle, add-category, add-item, dedup.
- `TripDashboard.compute*` — countdown states (before/during/after, UTC-safe), task count, packing per-category counts.
- `_createTripSection` — asserts single `TripsChromeBar` block, zero legacy chrome markers.
- `applyTripsConformanceHeal` — strips legacy chrome, leaves exactly one `TripsChromeBar`, idempotent on 2nd pass, `.sauce-backup` written.
- `TripLinksManager` — add/update/delete, URL dedup.
- To-do Trip dropdown gating — present only when `TripsChromeBar` exists; `[trip::]` field written on submit.

Seed-vault sentinels for the new/updated section templates + heal migration.

## Non-goals

- No hard trips→to-do dependency.
- No migration of legacy body-content into the new structured arrays (users re-enter flights/stay/packing; heal only fixes chrome).
- Manifest/version bumps + release/tag/tap/brew are the automatic pipeline's job, not hand-edited here.

## Files touched (indicative)

- `platform/blueprints/trips/helpers/`: `trip-nav-buttons.js` (strip render), `trips-chrome-bar.js` (surfaceSpec leaf), `trip-section-kinds.js` (+links), new `trip-entry-list.js`, `trip-dashboard.js`, `trip-links-panel.js`, `trip-links-manager.js`, `trip-todo-actions.js`.
- `platform/blueprints/trips/templates/`: `Trip Packing List.md`, `Trip Flights.md`, `Trip Stay.md`, `Trip To Do.md`, `Trip Atlas.md`, new `Trip Links.md`.
- `platform/blueprints/trips/manifest.json`: new files, `customjs_classes`, `section_kind` enum, breadcrumb `links` (reuses `trip-section`).
- `platform/blueprints/to-do/helpers/todo-create-task.js`: Trip dropdown (gated).
- `platform/install.js`: `applyTripsConformanceHeal` chrome-strip; scaffold Links section; `TRIP_SECTION_KINDS` mirror (+links).
- `platform/schemas-index.json`: `section_kind` enum.
- `Docs/agent-guides/trips-blueprint.md`: refresh for ChromeBar + new features.
- `platform/test/`: new harness specs + seed sentinels.
