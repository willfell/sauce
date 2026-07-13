# Trips Batch Fixes — Design + Plan

**Date:** 2026-07-12
**Blueprint:** `trips` (+ `task-entity` for the trip-link fix)
**Working example:** Destin Florida trip (headspace).

Five user-reported defects, each root-caused against live vault data + source.

## Fix 1 — Packing rows render blank + phantom rows (CRITICAL)

**Root cause:** `TripEntryList._row` sets the row title via `spec.title ? spec.title(entry) : ""`. The packing template mounts `render(dv,{key:"packing_items",kind:"packing",group:true,checkbox:true})` — **no `title` fn** — so every item renders blank. Separately, "Add category" stores a placeholder entry `{category:"Clothing"}` (no `item`), which the grouped render draws as an extra blank row.

**Fix:**
- Kind-aware title/subtitle: `_rowTitle(spec,entry)` → `spec.title?.(entry)` else stay→`entry.name`, else `entry.item||entry.name`. `_rowSubtitle(spec,entry)` → `spec.subtitle?.(entry)` else stay→`_fmtDate(check_in) → _fmtDate(check_out)`, else "".
- Grouped (packing) render: collect categories in first-seen order (including placeholder-only categories so an empty category still shows its header), but only render entries **with a non-empty `item`** as rows. Placeholder category entries are markers, not rows.

**Tests:** `_rowTitle`/`_rowSubtitle` for packing + stay; a grouped-bucket helper `_packingBuckets(items)` → `[{category, rows:[{entry,absIndex}]}]` that drops item-less entries but keeps empty categories.

## Fix 2 — Add item focus → item field

**Root cause:** `_openForm` focuses the first control (the category `<select>`), not the item text box.

**Fix:** on open, focus the first **text/url/number** input (skip `<select>`); falls back to the first control. For packing add-item this lands on the item field; for flights add it lands on airline (sensible).

## Fix 3 — Flight "in N days" inconsistent for same-date legs

**Root cause:** `_flightStatus`'s future branch uses `_humanDelta(d - nowMs)` which rounds raw ms to days, so two legs on the same date at different times round differently (3 vs 4).

**Fix:** add `_daysUntilDate(dateVal, nowMs)` = calendar-day diff between the leg's `depart_date` and the local "today" (both mapped to the UTC-midnight scheme). In `_flightStatus`, when not yet boarding/departed: if `_daysUntilDate >= 1` show `in N day(s)` (calendar-based, so same-date legs match); else fall back to `_humanDelta` for hours/minutes.

**Tests:** `_daysUntilDate` (same-date legs → same count; today → 0); `_flightStatus` two same-date legs at 09:39 and 13:39 with a fixed `nowMs` → identical "in N days".

## Fix 4 — Clear Outbound/Return separation

**Root cause:** group headers are tiny muted `SectionLabel`s, so the two directions look squished.

**Fix:** replace the flights group header with a prominent styled header — accent-tinted, larger, `✈ Outbound` / `Return`, with generous top spacing + a hairline divider before each group after the first. Purely presentational in the flights branch of `render`.

## Fix 5 — Trip To-Do task not linked (CRITICAL, projects-parity)

**Root cause:** the bar's `add-task` calls `TaskDialog.open({surface:"trip", trip:{name: ctx.tripName, slug: ctx.tripSlug}})`, but `detect` sets `tripName: page.name` — and a **section note has no `name`** (only the atlas does); it has `trip: "[[Destin Florida]]"`. So `tripName` is null, and `TaskDialog._payloadFromState` only writes trip when `tripName` is truthy → the created task note gets empty `trip_slug` → `TaskTripList` (correctly mounted on the To-Do note) finds nothing. (Confirmed: `spice/tasks/Start Packing.md` has empty `trip`/`trip_slug`, `source: trip`.)

**Fix (two layers, projects-parity):**
- `trips-chrome-bar.js` `detect`: `tripName: page.name || _linkText(page.trip) || null` (strip `[[…]]`). Now section notes yield the real trip name.
- `task-dialog.js` `_payloadFromState`: write trip when **`tripName || tripSlug`** is present: `payload.trip = { name: tripName || tripSlug, slug: (tripSlug||'').trim() || _slugify(tripName) }`. Defense-in-depth so a slug-only context still links.

Result: creating a task from a trip's To-Do writes a `spice/tasks/*.md` note with `trip_slug`, which shows in the daily AND the trip To-Do via `TaskTripList` — exactly like a project task.

**Tests:** extend `run-task-dialog`/`run-task-entity` — payload with `tripSlug` only (no name) still yields `payload.trip.slug`; `run-trips-chrome-bar` — `detect` derives `tripName` from `page.trip` wikilink when `page.name` absent.

## Deploy courtesy
Patch the existing live `spice/tasks/Start Packing.md` (set `trip: "[[Destin Florida]]"`, `trip_slug: destin-florida`) during deploy verification so the user's already-created task shows in the trip To-Do.

## Non-goals
No migration heal (fresh trips). No timers. No version/pin/tag hand-edits.

## Files
- `platform/blueprints/trips/helpers/trip-entry-list.js` — Fixes 1-4.
- `platform/blueprints/trips/helpers/trips-chrome-bar.js` + `platform/mechanisms/task-entity/task-dialog.js` — Fix 5.
- Tests: `run-trip-entry-list.js`, `run-trips-chrome-bar.js`, `run-task-entity.js`/`run-task-dialog.js`.
- `Docs/agent-guides/trips-blueprint.md` — brief note.

## Task order (sequential; trip-entry-list.js shared)
1. Packing render (title/subtitle + skip placeholders) + tests.
2. Add-item focus.
3. Flight day-count consistency + tests.
4. Flight group separation.
5. Trip-link fix (bar detect + TaskDialog payload) + tests.
6. Docs + full suite + dogfood + preflight.
