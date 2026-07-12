# Trips Flights + Dashboard Overhaul — Design

**Date:** 2026-07-12
**Blueprint:** `trips` (helpers `trip-entry-list.js`, `trip-dashboard.js`)
**Working example:** `Destin Florida` trip in `headspace-sauce` (2 outbound legs DEN→ATL→VPS).

## Problem

The v2 flights + dashboard surfaces work but fall short:

1. **Editing a flight opens an empty dialog** (only a "Save" button, no fields).
2. **`boarding_time` is a manual field** — it should be auto-calculated (40 min before departure).
3. **No arrival time** — can't compute duration or layover.
4. **Flights display is thin** — no layover, no duration, no gate-forward day-of-travel info, no live "in N min til depart", no delay handling. The user wants to be rewarded for entering rich data.
5. **Dashboard is a bare stat row** — should be a real dashboard pulling flight/stay/packing data when present.

Multi-leg per direction already works (each entry is a leg with `direction`); no change needed there.

## Root cause: the edit bug

`TripEntryList.render(dv, spec)` is mounted by the template with `args:[{key:"flights", kind:"flights"}]` — **no `fields`**. Each row's Edit button calls `_onEdit(dv, spec, i, entry)`, which builds the form from `spec.fields` → empty → only "Save" renders. Add-from-bar works only because the chrome bar passes `fields` explicitly.

**Fix:** a `_fieldsFor(spec)` resolver returns `spec.fields` when present, else derives from `spec.kind`:
`flights`→`_flightFields()`, `stay`→`_stayFields()`, `packing`→`_packingItemFields(cats)`. Both `_onAdd` (row/bar) and `_onEdit` use it. The render path is now self-sufficient — edit works from the note without the bar supplying fields.

## Flight schema (`_flightFields`)

Remove `boarding_time`. Add `arrival_date` (date), `arrival_time` (time), `delay_minutes` (number). Final ordered legs:

`direction` (select Outbound/Return), `airline`, `flight_no`, `from`, `to`, `depart_date` (date), `depart_time` (time), `arrival_date` (date), `arrival_time` (time), `gate`, `seat`, `confirmation`, `delay_minutes` (number, default blank=0), `link` (url).

Backward-compatible: an old leg with `boarding_time` and no arrival still renders — boarding is recomputed from depart, duration/layover are omitted when arrival is absent, and the stale `boarding_time` value is ignored.

## Pure flight math (statics on `TripEntryList`, unit-tested with injected `now`)

All time math is pure and takes explicit inputs; no test reads the wall clock.

- `_toMin(timeStr)` → minutes since midnight from `"HH:MM"` (tolerant, null on blank).
- `_legDepartMs(leg)` / `_legArriveMs(leg)` → epoch ms from `depart_date`+`depart_time` (and arrival_*), UTC-safe via a shared `_dayMs(dateVal)` that slices ISO/Date/epoch to Y-M-D; returns null when the parts are missing.
- `_delayMin(leg)` → integer from `delay_minutes` (blank/NaN → 0).
- `_effDepartMs(leg)` = `_legDepartMs + delay*60000`; `_effArriveMs(leg)` = `_legArriveMs + delay*60000`.
- `_boardingMin(leg)` = effective-depart-minutes − 40 (wraps within the day for display only); rendered as `"HH:MM"`.
- `_durationMin(leg)` = `(effArrive − effDepart)/60000` when both present, else null; `_fmtDur(min)` → `"Xh Ym"` / `"Ym"`.
- `_layoverMin(prev, next)` = `(_effDepartMs(next) − _effArriveMs(prev))/60000`, only when `prev.direction === next.direction` and `prev.to === next.from` and both times resolve; else null.
- `_flightStatus(leg, nowMs)` → `{label, tone}`:
  - `nowMs >= effArrive` → `{"Landed","muted"}` (only if arrival known)
  - `nowMs >= effDepart` → `{"In air","accent"}` (or `"Departed"` when no arrival)
  - `nowMs >= boardingMs` → `{"Boarding","warn"}`
  - else → `{"in " + humanDelta(effDepart − now), "accent"}` (e.g. `in 4 min`, `in 2 hr`, `in 3 days`); returns `null` when depart unknown.
- Delay badge: when `_delayMin > 0`, a `Delayed N min` pill; layover/duration/status all already read effective times, so they cascade automatically.

## Flight card render

Per direction group (Outbound/Return, existing `_groupByDirection`), for each leg in order:
- **Row 1:** `✈ <airline> <flight_no>` · direction badge · live `_flightStatus` pill (right).
- **Row 2:** `FROM → TO`.
- **Row 3 (times):** `Depart <effective date, time>` · `Arrive <effective>` · `Board <auto HH:MM>` · duration.
- **Row 4 (day-of):** gate, seat, confirmation, `Delayed N min` badge (if any), link.
- **Between consecutive connecting legs** (same direction, `prev.to === next.from`): a **layover chip** — `⏱ Layover at <airport> — <_fmtDur(_layoverMin)>` (recomputes under delay). If `prev.to !== next.from`, show a neutral `Connection` chip without a computed time.
Empty/missing values are omitted, never shown as blank labels. `now` is read once at render (`Date.now()`); all comparisons use the pure statics, so the wall-clock read is the only impurity and it's isolated.

## Dashboard redesign (`TripDashboard`)

A card dashboard. Reads sibling section notes by folder scan (already done for packing — extend to flights + stays via the same `spice/trips/<slug>` scan filtering `section_kind`).

Layout (each block omitted when its data is empty):
- **Hero:** big countdown value (`16` + `DAYS TO GO`, or `In progress` / `Complete`), then dates (`Jul 16 – Jul 20, 2026`, human via `_fmtDate`) and location, as labeled stats. Accent-tinted card.
- **Itinerary** (flights present): one line per direction — `Outbound · DEN → ATL → VPS · departs Jul 16, 9:39 AM` (route = ordered `from`…`to` chain; departs = first leg effective depart). Plus the next upcoming leg's live status pill.
- **Stay** (stays present): name · `check_in → check_out` (human).
- **Packing** (packing present): `X / Y packed` with a horizontal progress bar; per-category counts as a sub-line.
- **Tasks:** `N open` (existing `_countOpenTasks` by `trip_slug`).

Pure selectors (unit-tested): `_itinerary(flights)` → `[{direction, route, departsMs}]`; `_staySummary(stays)` → `[{name, check_in, check_out}]`; packing rollup reuses `packingCounts`. Flight time formatting reuses `TripEntryList` statics at runtime via `customJS.TripEntryList` (guarded); the dashboard's own pure selectors don't depend on TripEntryList so they stay independently testable. Cold-load-safe (`RenderSafe.page`), never-throw, `type==='trip'` gate.

## Live updates

Compute-at-render only (user choice): countdowns/statuses reflect `Date.now()` at each render (note open / Dataview refresh / Cmd+R). No timers, no interval cleanup. All comparisons run through pure statics that take `nowMs`, so behavior is fully testable with fixed clocks.

## Testing

- `_fieldsFor(spec)` — kind→fields (flights/stay/packing), explicit `spec.fields` passthrough.
- Flight math: `_boardingMin` (depart−40, incl. delay), `_durationMin`/`_fmtDur`, `_layoverMin` (connecting only, delay cascade), `_flightStatus` at fixed `nowMs` across all branches (in N min / boarding / departed / in air / landed), `_delayMin` parsing.
- Backward-compat: a leg with `boarding_time` + no arrival renders (duration/layover null, boarding auto).
- Dashboard: `_itinerary`, `_staySummary`, packing rollup; empty-omits; `_fmtDate`.
- Render-guard cold-load (TripEntryList + TripDashboard), `run-customjs-loadable`, `lint-note-chrome`/`lint-cold-load`, `release:preflight`.

## Non-goals
- No live setInterval timer (compute-at-render chosen).
- No migration heal (new trips only; old flight renders gracefully).
- No hand-versioning — release pipeline owns semver/tags/tap.

## Files
- `platform/blueprints/trips/helpers/trip-entry-list.js` — `_fieldsFor`, flight fields (−boarding +arrival +delay), pure flight-math statics, rich flight card, edit fix.
- `platform/blueprints/trips/helpers/trip-dashboard.js` — redesigned render + pure selectors (`_itinerary`, `_staySummary`), read flights/stays siblings.
- Tests: `platform/test/run-trip-entry-list.js`, `run-trip-dashboard.js`.
- `Docs/agent-guides/trips-blueprint.md` — flights v3 + dashboard note.
