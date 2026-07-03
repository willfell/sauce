---
purpose: Manual in-Obsidian smoke checklist for the trips blueprint.
load_when: Cycle close that touches trips' templates, helpers, chrome, naming, or the conformance heal.
---

# trips smoke checklist

## New trip creation

- [ ] Open `spice/trips/Trips.md` (hub) — `TripsHubCards` renders without console errors; trips grouped as Current / Upcoming / Past
- [ ] Click `+ New Trip`; enter a name with a space (e.g. "Test Trip 2026"), start date, end date, location → `Create`
- [ ] Verify the atlas was created at `spice/trips/test-trip-2026/Test Trip 2026.md` (collision-free name, not `Trip Atlas.md`)
- [ ] Verify 5 default section notes were created: `Test Trip 2026 — Flights.md`, `Test Trip 2026 — Stay.md`, `Test Trip 2026 — Packing List.md`, `Test Trip 2026 — To Do.md`, `Test Trip 2026 — Notes.md`
- [ ] Open the atlas — breadcrumb shows `Trips › Test Trip 2026` with `Trips` as a clickable link
- [ ] Atlas renders `TripSectionsCards`: Default Sections group lists Flights / Stay / Packing List / To Do / Notes in order, Trip Board card present
- [ ] `TripNavButtons` on atlas shows no PRIMARY button (already on atlas) + `Go to…` launcher pill spans full width
- [ ] Tap / click `Go to…` — launcher overlay opens; lists all 5 sections + Trip Board + `+ New Section` action at bottom
- [ ] On mobile (or narrow viewport): launcher is a bottom sheet with drag handle; Escape / backdrop tap closes it
- [ ] Open a section note (e.g. Flights) — breadcrumb shows `Trips › Test Trip 2026 › Flights` with both ancestors linked
- [ ] Section's `TripNavButtons` shows PRIMARY button `Test Trip 2026` (back to atlas) + `Go to…` pill; clicking PRIMARY opens the atlas
- [ ] Section frontmatter has canonical fields: `type: trip-section`, `section_kind: flights`, `section: "Flights"`, `trip: "[[Test Trip 2026]]"`, `trip_slug: test-trip-2026`, `created_at` (ISO+TZ format)

## Custom (+ New Section) flow

- [ ] From any trip note, open `Go to…` → click `+ New Section` → enter title "Honorees" → Create
- [ ] Section created at `spice/trips/test-trip-2026/Test Trip 2026 — Honorees.md`
- [ ] Section frontmatter has `section_kind: custom`, `section: "Honorees"`, correct `trip` + `trip_slug`
- [ ] Open Flights section → `Go to…` now lists "Honorees" below the 5 defaults (custom sections sort after defaults)
- [ ] Atlas `TripSectionsCards` shows "Honorees" in an Additional Sections group

## Hub card grouping

- [ ] Hub cards show trips in correct groups: one with today's date in range → Current Trip, future start date → Upcoming Trips, past end date → Past Trips
- [ ] Trips without `start_date` appear in Past Trips (not an error state)
- [ ] Cards display location subtitle and formatted date range meta

## Existing trip heal (pre-refactor notes)

> Test by temporarily creating a legacy-shaped trip folder manually or by checking an already-healed vault.

- [ ] Before heal: trip folder had `Trip Atlas.md` + `Trip Flights.md` etc. (generic basenames)
- [ ] After `sauce update` (runs install including `applyTripsConformanceHeal`): notes renamed to `<Trip Name>.md` + `<Trip Name> — <Section>.md`
- [ ] Backup exists at `.sauce-backup/trips/<slug>/<ts>/`
- [ ] Renamed section frontmatter contains `type: trip-section`, `section_kind`, `section`, `trip: "[[<atlas>]]"`, `trip_slug`
- [ ] Legacy `created:` field migrated to `created_at:` (ISO+TZ)
- [ ] `[[Trip Atlas]]` wikilinks in section notes repaired to `[[<Trip Name>]]`
- [ ] Breadcrumb block injected at top of each note (immediately after frontmatter)
- [ ] Hub `## All Trips` H2 converted to SectionLabel block
- [ ] Atlas `## Mentions` H2 converted to SectionLabel block (only if BacklinkPanel block present)
- [ ] Re-running `sauce update` a second time: no files written (idempotent)

## Console

- [ ] DevTools console empty of red errors after opening hub, atlas, and at least one section
- [ ] No `unavailable` guards rendered (all customJS classes loaded: `TripSectionKinds`, `TripsHubCards`, `TripNavButtons`, `TripSectionsCards`)

## Result-doc note

Paste "Manual smoke: COMPLETED on headspace" or "N/A — no UI change" into the cycle's result doc.
