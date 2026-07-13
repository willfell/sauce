# Trips Flights + Dashboard Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the flight edit dialog, replace manual boarding-time with auto-calc, add arrival + delay, compute duration/layover/live-status, and redesign the trip dashboard to a real data-rich card view.

**Architecture:** All time math is pure statics on `TripEntryList` (tested with an injected `nowMs`); the flight card and dashboard read those statics. `Date.now()` is read once per render and isolated. No timers (compute-at-render).

**Tech Stack:** customJS helpers (single bare `class X {}`, NO trailing statements), Dataview render blocks, native date/time inputs, Node harness `platform/test/run-*.js`.

**Reference:** `platform/blueprints/trips/helpers/trip-entry-list.js` (`_flightFields` ~L90, `_onEdit` ~L368, `_openForm` ~L433, `_flightRow` ~L229, `_groupByDirection`, `_fmtDate`/`_fmtTime`/`_fmtDateTime` ~L164), `trip-dashboard.js` (`render`, `countdown`, `packingCounts`, `_fmtDate`, `_countOpenTasks`).

**customJS invariant:** each file stays a single bare `class X {}`; no trailing statements. Commit after each green task. Do NOT bump version/pins/tags.

---

### Task 1: Fix the edit dialog (fields from kind)

**Files:** Modify `platform/blueprints/trips/helpers/trip-entry-list.js`; Test `platform/test/run-trip-entry-list.js`.

- [ ] **Step 1: Failing test**
```js
// _fieldsFor derives fields from kind when spec.fields absent
assert(TripEntryList._fieldsFor({kind:"flights"}).some(f=>f.name==="airline"));
assert(TripEntryList._fieldsFor({kind:"stay"}).some(f=>f.name==="check_in"));
assert(TripEntryList._fieldsFor({kind:"packing", __cats:["A"]}).some(f=>f.name==="item"));
// explicit fields win
assert(TripEntryList._fieldsFor({fields:[{name:"z"}]})[0].name==="z");
```
- [ ] **Step 2: Run** `node platform/test/run-trip-entry-list.js` — FAIL.
- [ ] **Step 3: Implement** `static _fieldsFor(spec)`: `if (spec && Array.isArray(spec.fields) && spec.fields.length) return spec.fields;` then switch `spec && spec.kind`: `"flights"`→`TripEntryList._flightFields()`, `"stay"`→`TripEntryList._stayFields()`, `"packing"`→`TripEntryList._packingItemFields(spec.__cats||[])`, default `[]`. In `_onEdit`, replace `spec.fields || []` with `TripEntryList._fieldsFor(spec)` (keep the grouped `catField` concat for packing). In `_onAdd`, replace `spec.fields || []` with `TripEntryList._fieldsFor(spec)`.
- [ ] **Step 4: Run** `node platform/test/run-trip-entry-list.js && node platform/test/run-customjs-loadable.js` — PASS.
- [ ] **Step 5: Commit** `git commit -am "fix(trips): flight/stay/packing edit dialog derives fields from kind"`

---

### Task 2: Flight schema — drop boarding, add arrival + delay

**Files:** Modify `trip-entry-list.js`; Test `run-trip-entry-list.js`.

- [ ] **Step 1: Failing test**
```js
const ff = TripEntryList._flightFields();
const names = ff.map(f=>f.name);
assert(!names.includes("boarding_time"));           // removed
assert(names.includes("arrival_date") && ff.find(f=>f.name==="arrival_date").type==="date");
assert(names.includes("arrival_time") && ff.find(f=>f.name==="arrival_time").type==="time");
assert(names.includes("delay_minutes") && ff.find(f=>f.name==="delay_minutes").type==="number");
assert(names.includes("depart_date") && names.includes("depart_time") && names.includes("direction"));
```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — edit `_flightFields()` to the ordered list: `direction`(select Outbound/Return), `airline`, `flight_no`, `from`, `to`, `depart_date`(date), `depart_time`(time), `arrival_date`(date), `arrival_time`(time), `gate`, `seat`, `confirmation`, `delay_minutes`(number, placeholder "0"), `link`(link). Remove the `boarding_time` entry. Ensure `_inputTypeFor` maps `number`→`"number"` (add if missing; in `_openForm`, `number` renders `<input type="number">`).
- [ ] **Step 4: Run** `node platform/test/run-trip-entry-list.js` — PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(trips): flight fields drop boarding, add arrival_date/time + delay_minutes"`

---

### Task 3: Pure flight-time math

**Files:** Modify `trip-entry-list.js`; Test `run-trip-entry-list.js`.

- [ ] **Step 1: Failing tests** (fixed inputs, no wall clock)
```js
const leg = {depart_date:"2026-07-16", depart_time:"09:39", arrival_date:"2026-07-16", arrival_time:"11:15", delay_minutes:""};
assert(TripEntryList._toMin("09:39") === 579);
assert(TripEntryList._boardingMin(leg) === "08:59");           // 09:39 - 40m
assert(TripEntryList._durationMin(leg) === 96);                // 1h36m
assert(TripEntryList._fmtDur(96) === "1h 36m");
// delay cascades
const del = Object.assign({}, leg, {delay_minutes:"30"});
assert(TripEntryList._boardingMin(del) === "09:29");           // (09:39+30) - 40
// layover: connecting leg at ATL
const a={direction:"Outbound",to:"ATL",arrival_date:"2026-07-16",arrival_time:"13:00"};
const b={direction:"Outbound",from:"ATL",depart_date:"2026-07-16",depart_time:"13:45"};
assert(TripEntryList._layoverMin(a,b) === 45);
assert(TripEntryList._layoverMin({direction:"Outbound",to:"ATL",arrival_time:"13:00",arrival_date:"2026-07-16"},{direction:"Return",from:"ATL",depart_time:"13:45",depart_date:"2026-07-16"}) === null); // diff direction
// status at fixed now
const nowBoard = TripEntryList._legDepartMs(leg) - 20*60000; // 20 min before depart, within boarding window
assert(TripEntryList._flightStatus(leg, nowBoard).label === "Boarding");
const nowFar = TripEntryList._legDepartMs(leg) - 4*60000;
// 4 min before boarding-adjusted? choose value clearly pre-boarding:
const nowPre = TripEntryList._legDepartMs(leg) - 90*60000;
assert(/^in /.test(TripEntryList._flightStatus(leg, nowPre).label));
const nowLanded = TripEntryList._legArriveMs(leg) + 60000;
assert(TripEntryList._flightStatus(leg, nowLanded).label === "Landed");
```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the statics per the design:
  - `_dayMs(v)` — UTC midnight ms from ISO/`YYYY-MM-DD`/Date/epoch (slice first 10 of a string; `Date.UTC`), null on blank/invalid.
  - `_toMin(t)` — `"HH:MM"`→minutes, null on blank.
  - `_delayMin(leg)` — `parseInt(leg.delay_minutes)||0`.
  - `_legDepartMs(leg)` = `_dayMs(depart_date) + _toMin(depart_time)*60000` (null if either missing); same for `_legArriveMs`.
  - `_effDepartMs`/`_effArriveMs` = leg ms + `_delayMin*60000`.
  - `_boardingMin(leg)` — from `_effDepartMs`: take minutes-of-day of `(effDepart - 40m)`, format `"HH:MM"` (UTC getters); null if depart missing.
  - `_durationMin(leg)` = `(_effArriveMs - _effDepartMs)/60000` when both present else null; `_fmtDur(m)` → `"Xh Ym"`/`"Ym"` (guard null→"").
  - `_layoverMin(prev,next)` = `(_effDepartMs(next) - _effArriveMs(prev))/60000` only when `prev.direction===next.direction && prev.to===next.from` and both ms resolve; else null.
  - `_flightStatus(leg, nowMs)` — compute effDepart/effArrive/boardingMs(=effDepart−40m); branch: arrive known & now≥effArrive→`{"Landed","muted"}`; now≥effDepart→`{arrive? "In air":"Departed","accent"}`; now≥boardingMs→`{"Boarding","warn"}`; else `{"in "+_humanDelta(effDepart-nowMs),"accent"}`; null if depart missing. `_humanDelta(ms)` → `"N min"`/`"N hr"`/`"N days"`.
- [ ] **Step 4: Run** `node platform/test/run-trip-entry-list.js && node platform/test/run-customjs-loadable.js` — PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(trips): pure flight math (boarding auto, duration, layover, delay cascade, live status)"`

---

### Task 4: Rich flight card render

**Files:** Modify `trip-entry-list.js` (`_flightRow` + the flights branch of `render`); Test via render-guard.

- [ ] **Step 1** — rewrite `_flightRow(c, dv, spec, items, entry, absIndex)` to draw the design's card: Row1 `✈ airline flight_no` + direction badge + `_flightStatus(entry, Date.now())` pill (guard null); Row2 `FROM → TO`; Row3 `Depart <effective date+time human>` · `Arrive <effective>` · `Board <_boardingMin>` · `_fmtDur(_durationMin)`; Row4 gate/seat/confirmation/`Delayed N min` badge (when `_delayMin>0`)/link. Effective date+time display: format `_dayMs`+time back to `"MMM D, h:mm A"` via `_fmtDateTime` (extend `_fmtDateTime` to accept a delay-shifted value, or compute the effective `depart_date`/`depart_time` strings). In the flights branch of `render`, after grouping via `_groupByDirection`, iterate legs in order and between consecutive legs emit a layover/connection chip: if `_layoverMin(prev,next)!=null` → `⏱ Layover at <prev.to> — <_fmtDur>`, else if both have airports and `prev.to!==next.from` → neutral `Connection` chip. Keep per-row Edit/Delete. Never throw; guard all pure calls.
- [ ] **Step 2: Run** `node platform/test/run-trip-entry-list.js && node platform/test/run-trips-render-guards.js && node platform/test/run-customjs-loadable.js` — PASS. Add a small assertion that a leg with legacy `boarding_time` and no arrival still renders (call `_flightRow` with a DOM stub, assert no throw) if the harness supports it; otherwise rely on render-guard.
- [ ] **Step 3: Commit** `git commit -am "feat(trips): rich flight card — status, boarding, arrival, duration, layover, delay"`

---

### Task 5: Dashboard pure selectors

**Files:** Modify `trip-dashboard.js`; Test `run-trip-dashboard.js`.

- [ ] **Step 1: Failing tests**
```js
const flights=[{direction:"Outbound",from:"DEN",to:"ATL",depart_date:"2026-07-16",depart_time:"09:39"},
               {direction:"Outbound",from:"ATL",to:"VPS",depart_date:"2026-07-16",depart_time:"13:39"},
               {direction:"Return",from:"VPS",to:"DEN",depart_date:"2026-07-20",depart_time:"07:00"}];
const it = TripDashboard._itinerary(flights);
assert(it.length===2);
assert(it[0].direction==="Outbound" && it[0].route==="DEN → ATL → VPS");
assert(it[1].direction==="Return" && it[1].route==="VPS → DEN");
const stays=[{name:"Beach House",check_in:"2026-07-16",check_out:"2026-07-20"}];
const ss=TripDashboard._staySummary(stays);
assert(ss[0].name==="Beach House" && ss[0].check_in==="2026-07-16");
assert(TripDashboard._itinerary([]).length===0 && TripDashboard._staySummary(null).length===0);
```
- [ ] **Step 2: Run** `node platform/test/run-trip-dashboard.js` — FAIL.
- [ ] **Step 3: Implement** `static _itinerary(flights)`: group by `direction` (Outbound, Return, Other — preserve order), for each build `route` = the ordered chain of airports (`from` of each leg then final `to`; dedupe consecutive dups) joined by ` → `, and `departsMs` = min `_dayMs+time` of the group (use a local date parse or reuse a `_dayMs`). Return `[{direction, route, departsMs}]`, empty groups dropped. `static _staySummary(stays)` → `(Array.isArray(stays)?stays:[]).filter(s=>s&&s.name).map(s=>({name:s.name, check_in:s.check_in||"", check_out:s.check_out||""}))`.
- [ ] **Step 4: Run** `node platform/test/run-trip-dashboard.js` — PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(trips): dashboard itinerary + stay pure selectors"`

---

### Task 6: Dashboard redesigned render

**Files:** Modify `trip-dashboard.js`; verify via render-guard.

- [ ] **Step 1** — rewrite `render(dv)` to the card layout: read the atlas page (`RenderSafe.page`, gate `type==="trip"`), scan sibling section notes (existing packing scan — extend to also capture the `flights`/`stays` arrays from the `flights`/`stay` section notes by `section_kind`). Draw:
  - Hero card: countdown big number + label (`countdown` state), then stats `Dates` (`_fmtDate(start) – _fmtDate(end)`), `Where` (location), `Open tasks` (`_countOpenTasks`).
  - Itinerary block (if `_itinerary(flights).length`): one row per direction with route + human departs (`_fmtDate(departsMs)`), and the next upcoming leg's status pill via `customJS.TripEntryList` statics (guarded — if TripEntryList absent, skip the pill).
  - Stay block (if `_staySummary(stays).length`): name + `_fmtDate(check_in) → _fmtDate(check_out)`.
  - Packing block (if packing present): `packed/total` + a progress bar (percent width), per-category sub-line from `packingCounts`.
  Style with cards/pills/accent (`var(--interactive-accent)`, `--background-secondary`, borders, radius), responsive `flex-wrap`, mobile-friendly. Each block omitted when empty. Never throw.
- [ ] **Step 2: Run** `node platform/test/run-trip-dashboard.js && node platform/test/run-trips-render-guards.js && node platform/test/run-customjs-loadable.js` — PASS (the dashboard render must stay cold-load-safe: `page.type!=="trip"` and empty sections → renders nothing/hero-only without throwing).
- [ ] **Step 3: Commit** `git commit -am "feat(trips): redesigned trip dashboard (hero + itinerary + stay + packing)"`

---

### Task 7: Docs + full suite

**Files:** `Docs/agent-guides/trips-blueprint.md`; run the suite.

- [ ] **Step 1** — update the trips guide: flights v3 (auto boarding = depart−40, arrival + delay fields, duration/layover/live status, no boarding field), dashboard redesign, compute-at-render.
- [ ] **Step 2: Run**
```bash
node platform/test/run-trip-entry-list.js && node platform/test/run-trip-dashboard.js \
 && node platform/test/run-trips-chrome-bar.js && node platform/test/run-trips.js \
 && node platform/test/run-trips-render-guards.js && node platform/test/run-customjs-loadable.js \
 && npm run lint-note-chrome && npm run lint-cold-load && npm run lint-display-markers \
 && npm run test:seed && npm run test:seed-migrations && npm run release:preflight
```
   All PASS / EXIT 0. Regenerate a lint baseline only if it drifts purely on line numbers (verify snippets unchanged). Note any pre-existing unrelated failure rather than chasing it.
- [ ] **Step 3: Sync dogfood copies** — if `ranch/scripts/trips/trip-entry-list.js` and/or `ranch/scripts/trips/trip-dashboard.js` are git-tracked, `cp` the platform source over them so the workshop vault matches (check with `git ls-files`).
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat(trips): flights+dashboard docs, dogfood sync, full suite green"`

---

## Notes for the executor
- Tasks are sequential (all touch `trip-entry-list.js` / `trip-dashboard.js`).
- After all tasks: `release:preflight` EXIT 0 before the PR.
- Do NOT bump versions/pins/tags — merge to `main`; pipeline computes semver, auto-merges the release PR, tags, ships to brew.
- Post-deploy: open the live Destin Florida flights + atlas and confirm edit works, boarding auto-shows, layover computes, dashboard is rich.
