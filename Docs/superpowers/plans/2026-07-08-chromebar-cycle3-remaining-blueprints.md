# ChromeBar Cycle 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard the `trips`, `reader`, `people`, `products`, `teams`, and `journal` blueprints onto the shared `ChromeBar` mechanism, so every blueprint in the vault renders the same breadcrumb + Go▾ + primary + ⋯ bar, per the finalized design in `Docs/prompts/chromebar-cycle3-remaining-blueprints.md`.

**Architecture:** Each blueprint gets one thin adapter class (`<Bp>ChromeBar`) in `helpers/` (or `scripts/` for people/products/teams, matching each blueprint's existing directory convention) that returns a config object (`detect/surfaceSpec/dispatch/destinations/rootClass/btnClass`) to `customJS.ChromeBar.makeAdapter()`. Existing per-blueprint action helpers (`TripNavButtons`, `ReaderArticleActions`, `ProductActionButtons`, `TeamActionButtons`) get their nav/action logic absorbed into the new adapter and are guarded to no-op when ChromeBar is present. `PersonNavButtons` is the one exception — it keeps rendering its identity row unconditionally and only guards its now-redundant back-link button.

**Tech Stack:** Obsidian customJS (vanilla JS classes, no imports/exports, instance methods), Dataview (`dv.pages()` queries), Node.js test harnesses (zero-dep, `new Function()` class loading).

---

## Working environment

A git worktree already exists at `.worktrees/chromebar-cycle3` (repo root: `/Users/willfellhoelter/projects/repos/sauce`), on branch `feat/chromebar-cycle3`, cut from `origin/main` (local `main` was 4 commits behind `origin/main` — cycle 2's to-do/meetings/scratch ChromeBar rollout — so cutting from `origin/main` was required). `npm install` has already been run there. All paths below are relative to `.worktrees/chromebar-cycle3/`.

If this worktree does not exist when you start (e.g. resuming after a `git worktree remove`), recreate it with:
```bash
cd /Users/willfellhoelter/projects/repos/sauce
git worktree add -b feat/chromebar-cycle3 .worktrees/chromebar-cycle3 origin/main
cd .worktrees/chromebar-cycle3 && npm install
```

Run all commands below from `.worktrees/chromebar-cycle3/` unless stated otherwise.

---

## Reference: the ChromeBar mechanism contract

`platform/mechanisms/chrome-bar/chrome-bar.js`'s `makeAdapter(config)` expects:
```js
{
  detect(dv, page) -> ctx | null,             // classify by frontmatter type; null = not this blueprint
  surfaceSpec(ctx) -> { primary, overflow, leaf }, // button spec per surface
  dispatch(dv, ctx, id),                       // handle button/menu clicks
  destinations(dv, ctx) -> entry[],            // Go ▾ launcher entries
  rootClass: string,                           // CSS class on bar root (presence-guard)
  btnClass(variant) -> string,                 // CSS class on buttons
}
```
- `primary`: `{ id, label, icon }` or `null`.
- `overflow`: `[{ id, label, icon, danger? }]`.
- `destinations`: array starting with `{ section: "This <blueprint>" }`, then `{ label, icon, _navTarget, onSelect }` entries (self-links omitted). `ChromeBar.makeAdapter` auto-appends a shared "Vault" grid — adapters never build that part themselves.
- Every adapter class follows the exact shape of `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` (canonical template, already in this repo — read it for the literal pattern, it's 98 lines):
```js
class <Bp>ChromeBar {
  get ICON() { return { /* SVG strings */ }; }
  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }
  _config() {
    const ICON = this.ICON;
    return { detect, surfaceSpec, dispatch, destinations, rootClass, btnClass };
  }
}
```
Rules (non-negotiable, apply to every task below): instance methods only (customJS stores classes as instances); every `render()` wrapped in try/catch, never throws; cold-load-safe (`page` can be null/partial — bail early); bare class only, no trailing statements after the closing `}` (customJS evals the whole file as one expression).

---

## Task 1: `install.js` — wire cycle-3 types into the chrome-bar heal

**Files:**
- Modify: `platform/install.js:6030-6034` (`CHROME_BAR_MAP`)
- Modify: `platform/install.js:6220-6222` (early-return guard in `_healChromeBarMigration`)
- Modify: `platform/install.js:6227-6232` (`LEGACY_CLASSES`)
- Modify: `platform/install.js:6449` (`applyNoteChromeHeal`'s `roots`)
- Modify: `platform/install.js:6468-6469` (`applyNoteChromeHeal`'s type allowlist)
- Test: `platform/test/run-chrome-bar-cycle3-heal.js` (new)
- Modify: `package.json` (add the new test to `release:preflight` + a `test:chrome-bar-cycle3-heal` script)

This task lands first because every other task's "existing notes get healed" behavior depends on it, and it's fully testable in isolation (the heal functions are pure string transforms with no DOM).

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-chrome-bar-cycle3-heal.js`:
```js
#!/usr/bin/env node
'use strict';

// run-chrome-bar-cycle3-heal.js — unit harness for cycle-3's CHROME_BAR_MAP /
// LEGACY_CLASSES / applyNoteChromeHeal wiring (trips, reader, people, products,
// teams, journal). _healNoteChromeBody and _healChromeBarMigration are pure
// string transforms (no DOM, no fs) — call install.js's exported functions
// directly with synthetic note bodies. Mirrors the assertion style of
// run-project-chrome-bar-heal.js. "N passed, M failed" — exit 0 iff M === 0.

const install = require('../install.js');
const _healNoteChromeBody = install._healNoteChromeBody;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---- trips: trip-section body carries Breadcrumb + SpaceNavButtons + TripNavButtons ----
{
  const before = `---
type: trip-section
section_kind: flights
section: "Flights"
trip: "[[Dave's Wedding]]"
trip_slug: daves-wedding
created_at: "2026-01-09T09:00:00-07:00"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'trip-section');
  ok('CBC3-TRIPS-1: trip-section heal inserts TripsChromeBar', after.includes('class: "TripsChromeBar"'));
  ok('CBC3-TRIPS-2: trip-section heal strips legacy Breadcrumb block', !after.includes('class: "Breadcrumb"'));
  ok('CBC3-TRIPS-3: trip-section heal strips legacy SpaceNavButtons block', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC3-TRIPS-4: trip-section heal strips legacy TripNavButtons block', !after.includes('class: "TripNavButtons"'));
  ok('CBC3-TRIPS-5: idempotent — second pass is a no-op', _healNoteChromeBody(after, 'trip-section') === after);
}

// ---- reader: reader-article body carries Breadcrumb + SpaceNavButtons + ReaderArticleActions ----
{
  const before = `---
type: reader-article
status: unread
url: "https://example.com/article"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ReaderArticleActions" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'reader-article');
  ok('CBC3-READER-1: reader-article heal inserts ReaderChromeBar', after.includes('class: "ReaderChromeBar"'));
  ok('CBC3-READER-2: reader-article heal strips legacy ReaderArticleActions block', !after.includes('class: "ReaderArticleActions"'));
}

// ---- people: person body carries ONLY PersonNavButtons (no Breadcrumb/SpaceNavButtons) ----
// This is the special case: PersonNavButtons is NOT in LEGACY_CLASSES (its identity
// row is kept), so the early-return guard must special-case type==='person' to still
// proceed past the "no legacy chrome to strip" short-circuit.
{
  const before = `---
type: person
company: ""
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "PersonNavButtons" });
\`\`\`

# [[Jane Doe]]

## Notes
-
`;
  const after = _healNoteChromeBody(before, 'person');
  ok('CBC3-PEOPLE-1: person heal inserts PeopleChromeBar even with no legacy nav/action block', after.includes('class: "PeopleChromeBar"'));
  ok('CBC3-PEOPLE-2: person heal KEEPS the PersonNavButtons block (identity row)', after.includes('class: "PersonNavButtons"'));
  ok('CBC3-PEOPLE-3: PeopleChromeBar is inserted BEFORE PersonNavButtons', after.indexOf('PeopleChromeBar') < after.indexOf('PersonNavButtons'));
  ok('CBC3-PEOPLE-4: idempotent — second pass is a no-op', _healNoteChromeBody(after, 'person') === after);
}

// ---- people-hub: SpaceNavButtons present, gets stripped + PeopleChromeBar inserted ----
{
  const before = `---
type: people-hub
tags:
  - people-hub
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "person" }] });
\`\`\`

## All People
`;
  const after = _healNoteChromeBody(before, 'people-hub');
  ok('CBC3-PEOPLEHUB-1: people-hub heal inserts PeopleChromeBar', after.includes('class: "PeopleChromeBar"'));
  ok('CBC3-PEOPLEHUB-2: people-hub heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC3-PEOPLEHUB-3: people-hub heal KEEPS the EntityCreate button', after.includes('class: "EntityCreate"'));
}

// ---- products: product body carries SpaceNavButtons only ----
{
  const before = `---
type: product
name: "Acme"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

# Acme

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProductPageCards" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'product');
  ok('CBC3-PRODUCTS-1: product heal inserts ProductsChromeBar', after.includes('class: "ProductsChromeBar"'));
  ok('CBC3-PRODUCTS-2: product heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC3-PRODUCTS-3: product heal KEEPS ProductPageCards', after.includes('class: "ProductPageCards"'));
}

// ---- teams: team body carries SpaceNavButtons only ----
{
  const before = `---
type: team
name: "Platform"
products:
  - "[[Acme]]"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

# Platform
`;
  const after = _healNoteChromeBody(before, 'team');
  ok('CBC3-TEAMS-1: team heal inserts TeamsChromeBar', after.includes('class: "TeamsChromeBar"'));
  ok('CBC3-TEAMS-2: team heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
}

// ---- journal: SpaceNavButtons + a trailing bare "---" divider ----
{
  const before = `---
type: journal
daily_note: "[[Wednesday-2026-01-14]]"
tags:
  - life
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---
`;
  const after = _healNoteChromeBody(before, 'journal');
  ok('CBC3-JOURNAL-1: journal heal inserts JournalChromeBar', after.includes('class: "JournalChromeBar"'));
  ok('CBC3-JOURNAL-2: journal heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-chrome-bar-cycle3-heal.js`
Expected: FAIL on every `CBC3-*` assertion (the classes don't exist in `CHROME_BAR_MAP` yet, so `_healNoteChromeBody` returns the body unchanged for these types, and for `person` the early-return guard bails before even reaching the map lookup).

- [ ] **Step 3: Extend `CHROME_BAR_MAP`**

In `platform/install.js`, find (around line 6030):
```js
  const CHROME_BAR_MAP = {
    "to-do": "ToDoChromeBar", "to-do-hub": "ToDoChromeBar", "project-todo": "ToDoChromeBar", "to-do-recurring": "ToDoChromeBar",
    "meeting": "MeetingChromeBar",
    "scratch-hub": "ScratchChromeBar", "scratch-day": "ScratchChromeBar", "scratch": "ScratchChromeBar",
  };
```
Replace with:
```js
  const CHROME_BAR_MAP = {
    "to-do": "ToDoChromeBar", "to-do-hub": "ToDoChromeBar", "project-todo": "ToDoChromeBar", "to-do-recurring": "ToDoChromeBar",
    "meeting": "MeetingChromeBar",
    "scratch-hub": "ScratchChromeBar", "scratch-day": "ScratchChromeBar", "scratch": "ScratchChromeBar",
    // Cycle 3 (trips / reader / people / products / teams / journal).
    "trips-hub": "TripsChromeBar", "trip": "TripsChromeBar", "trip-section": "TripsChromeBar", "trip-board-card": "TripsChromeBar",
    "reader-hub": "ReaderChromeBar", "reader-article": "ReaderChromeBar",
    "people-hub": "PeopleChromeBar", "person": "PeopleChromeBar",
    "products-hub": "ProductsChromeBar", "product": "ProductsChromeBar",
    "teams-hub": "TeamsChromeBar", "team": "TeamsChromeBar",
    "journal": "JournalChromeBar",
  };
```
(Note: `person` already appeared in `applyNoteChromeHeal`'s type allowlist and `roots` before this cycle, but had NO entry in this map — a pre-existing gap this closes.)

- [ ] **Step 4: Extend `LEGACY_CLASSES`, add the `person` early-return allowance**

In `platform/install.js`, find (around line 6215-6232):
```js
function _healChromeBarMigration(body, type, barClass) {
  if (!body || typeof body !== 'string') return body;
  // Already migrated — idempotent guard.
  if (body.includes(barClass)) return body;
  // No legacy chrome to strip — nothing to do (e.g. notes that never had nav).
  const hasLegacyNav = /SpaceNavButtons|Breadcrumb/.test(body);
  const hasLegacyAction = /ToDoHubActions|ToDoLeafActions|MeetingLeafActions|ScratchHubActions|ScratchDayActions|ScratchLeafActions/.test(body);
  if (!hasLegacyNav && !hasLegacyAction) return body;

  let out = body;

  // Strip known legacy dataviewjs blocks (class name inside the block).
  const LEGACY_CLASSES = [
    'Breadcrumb', 'SpaceNavButtons', 'ProjectNavButtons',
    'ToDoHubActions', 'ToDoLeafActions',
    'MeetingLeafActions',
    'ScratchHubActions', 'ScratchDayActions', 'ScratchLeafActions',
  ];
```
Replace with:
```js
function _healChromeBarMigration(body, type, barClass) {
  if (!body || typeof body !== 'string') return body;
  // Already migrated — idempotent guard.
  if (body.includes(barClass)) return body;
  // No legacy chrome to strip — nothing to do (e.g. notes that never had nav).
  const hasLegacyNav = /SpaceNavButtons|Breadcrumb/.test(body);
  const hasLegacyAction = /ToDoHubActions|ToDoLeafActions|MeetingLeafActions|ScratchHubActions|ScratchDayActions|ScratchLeafActions|TripNavButtons|ReaderArticleActions|ProductActionButtons|TeamActionButtons/.test(body);
  // person notes carry ONLY PersonNavButtons (kept, not stripped — see LEGACY_CLASSES
  // below) with no Breadcrumb/SpaceNavButtons/action block at all, so the generic
  // hasLegacyNav/hasLegacyAction checks never fire for them. Without this allowance
  // the function would bail here and existing person notes would never gain
  // PeopleChromeBar. This is the ONLY type where ChromeBar is inserted alongside
  // (not in place of) existing chrome.
  const hasPersonNav = type === 'person' && /PersonNavButtons/.test(body);
  if (!hasLegacyNav && !hasLegacyAction && !hasPersonNav) return body;

  let out = body;

  // Strip known legacy dataviewjs blocks (class name inside the block).
  // PersonNavButtons is intentionally NOT here — its identity row is kept.
  const LEGACY_CLASSES = [
    'Breadcrumb', 'SpaceNavButtons', 'ProjectNavButtons',
    'ToDoHubActions', 'ToDoLeafActions',
    'MeetingLeafActions',
    'ScratchHubActions', 'ScratchDayActions', 'ScratchLeafActions',
    'TripNavButtons', 'ReaderArticleActions', 'ProductActionButtons', 'TeamActionButtons',
  ];
```

- [ ] **Step 5: Extend `applyNoteChromeHeal`'s `roots` and type allowlist**

In `platform/install.js`, find (around line 6449):
```js
  const roots = ["spice/meetings", "spice/scratch", "spice/to-do", "spice/people", "spice/wiki", "spice/projects"];
```
Replace with:
```js
  const roots = ["spice/meetings", "spice/scratch", "spice/to-do", "spice/people", "spice/wiki", "spice/projects", "spice/trips", "spice/reader", "spice/products", "spice/teams", "spice/journal"];
```

Find (around line 6468-6469):
```js
        const WIKI_TYPES = ["wiki-hub", "wiki-section", "wiki-page"];
        if (!["meeting", "scratch", "scratch-day", "scratch-hub", "to-do", "to-do-hub", "project-todo", "to-do-recurring", "person", ...WIKI_TYPES].includes(type)) continue;
```
Replace with:
```js
        const WIKI_TYPES = ["wiki-hub", "wiki-section", "wiki-page"];
        const CYCLE3_TYPES = ["trips-hub", "trip", "trip-section", "trip-board-card", "reader-hub", "reader-article", "people-hub", "products-hub", "product", "teams-hub", "team", "journal"];
        if (!["meeting", "scratch", "scratch-day", "scratch-hub", "to-do", "to-do-hub", "project-todo", "to-do-recurring", "person", ...WIKI_TYPES, ...CYCLE3_TYPES].includes(type)) continue;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node platform/test/run-chrome-bar-cycle3-heal.js`
Expected: `18 passed, 0 failed` (exact count may shift slightly if you add/remove an assertion — all `CBC3-*` lines must read `ok`), exit 0.

- [ ] **Step 7: Wire the new test into `package.json`**

In `package.json`, find the `test:wiki-chrome-bar` line under `"scripts"`:
```json
    "test:wiki-chrome-bar": "node platform/test/run-wiki-chrome-bar.js",
```
Add immediately after it:
```json
    "test:chrome-bar-cycle3-heal": "node platform/test/run-chrome-bar-cycle3-heal.js",
```
In the same file, find the end of the `"release:preflight"` script string — it currently ends with `... && node platform/test/run-chrome-bar.js && node platform/test/run-wiki-chrome-bar.js && node platform/test/run-prune-orphan-breadcrumb.js"`. Append ` && node platform/test/run-chrome-bar-cycle3-heal.js` right before the final closing quote, so the tail reads:
```
... && node platform/test/run-chrome-bar.js && node platform/test/run-wiki-chrome-bar.js && node platform/test/run-prune-orphan-breadcrumb.js && node platform/test/run-chrome-bar-cycle3-heal.js"
```
(You'll append each new blueprint's `run-<bp>-chrome-bar.js` test to this same chain in later tasks — always right before the final closing quote, in the order the tasks below create them.)

- [ ] **Step 8: Commit**

```bash
git add platform/install.js platform/test/run-chrome-bar-cycle3-heal.js package.json
git commit -m "feat(chrome-bar): wire cycle-3 types into the note-chrome heal"
```

---

## Task 2: `trips` — `TripsChromeBar` adapter + test

**Files:**
- Create: `platform/blueprints/trips/helpers/trips-chrome-bar.js`
- Test: `platform/test/run-trips-chrome-bar.js`

Detect classifies by `page.type` only (not path, unlike the old `TripNavButtons.detectContext`) — `trips-hub`, `trip`, `trip-section`, `trip-board-card`. `trip-board` (the Kanban board note itself, `type: kanban`) and `trip-card`-inside-`board/` are NOT matched — they stay untouched (kanban-plugin-owned, per the design doc).

The "New Section" action (previously always present in `TripNavButtons`' launcher, on every non-hub trip surface) becomes an `overflow` action reachable from `trip`, `trip-section`, and `trip-board-card`. Section navigation links (previously mixed into the same launcher) move to `destinations` (Go▾), since `destinations` is nav and `overflow` is actions.

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-trips-chrome-bar.js`:
```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const TripsChromeBar = loadClass('platform/blueprints/trips/helpers/trips-chrome-bar.js', 'TripsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new TripsChromeBar();
const cfg = inst._config();

async function main() {

// TCB-DETECT — classify by frontmatter type; kanban board notes are NOT matched.
{
  const hub = cfg.detect({}, { file: { path: 'spice/trips/Trips.md' }, type: 'trips-hub' });
  const atlas = cfg.detect({}, { file: { path: "spice/trips/daves-wedding/Dave's Wedding.md" }, type: 'trip', name: "Dave's Wedding", trip_slug: 'daves-wedding' });
  const section = cfg.detect({}, { file: { path: "spice/trips/daves-wedding/Dave's Wedding — Flights.md" }, type: 'trip-section', trip_slug: 'daves-wedding', section_kind: 'flights' });
  const card = cfg.detect({}, { file: { path: 'spice/trips/daves-wedding/board/Book flights.md' }, type: 'trip-board-card' });
  const board = cfg.detect({}, { file: { path: 'spice/trips/daves-wedding/board/daves-wedding-board.md' }, type: 'kanban' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('TCB-DETECT-1 trips-hub/trip/trip-section/trip-board-card classify',
    hub && hub.context === 'trips-hub' && atlas && atlas.context === 'trip' && section && section.context === 'trip-section' && card && card.context === 'trip-board-card');
  ok('TCB-DETECT-2 kanban board + non-trip → null', board === null && off === null);
}
// TCB-SPEC — hub: primary New Trip, not leaf. trip/trip-section/trip-board-card: overflow New Section.
{
  const h = cfg.surfaceSpec({ context: 'trips-hub' });
  const a = cfg.surfaceSpec({ context: 'trip' });
  const s = cfg.surfaceSpec({ context: 'trip-section' });
  const c = cfg.surfaceSpec({ context: 'trip-board-card' });
  ok('TCB-SPEC-1 hub: primary new-trip + not leaf', h.primary.id === 'new-trip' && h.leaf === false);
  ok('TCB-SPEC-2 trip atlas: primary null + overflow new-section + not leaf', a.primary === null && a.overflow.some(o => o.id === 'new-section') && a.leaf === false);
  ok('TCB-SPEC-3 trip-section: leaf + overflow new-section', s.leaf === true && s.overflow.some(o => o.id === 'new-section'));
  ok('TCB-SPEC-4 trip-board-card: leaf + overflow new-section', c.leaf === true && c.overflow.some(o => o.id === 'new-section'));
}
// TCB-DISPATCH — new-trip → prompt+_createTrip; new-section → prompt+_createTripSection.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    TripNavButtons: {
      _promptForTripDetails: async () => ({ name: 'Test Trip', slug: 'test-trip', start_date: '', end_date: '', location: '' }),
      _createTrip: async (details) => { calls.push({ createTrip: details.slug }); return 'spice/trips/test-trip/Test Trip.md'; },
      _promptForSectionTitle: async () => 'Extra',
      _createTripSection: async (tripDir, title) => { calls.push({ createSection: tripDir + '/' + title }); return tripDir + '/Test Trip — Extra.md'; },
    },
  };
  const dv = { current: () => ({ file: { path: 'spice/trips/test-trip/Test Trip.md' } }) };
  await cfg.dispatch(dv, { context: 'trips-hub' }, 'new-trip');
  await cfg.dispatch(dv, { context: 'trip', tripSlug: 'test-trip', tripName: 'Test Trip' }, 'new-section');
  global.customJS = prevCJS;
  ok('TCB-DISPATCH-1 new-trip → TripNavButtons._createTrip', calls.some(c => c.createTrip === 'test-trip'));
  ok('TCB-DISPATCH-2 new-section → TripNavButtons._createTripSection', calls.some(c => c.createSection && c.createSection.includes('Extra')));
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-trips-chrome-bar.js`
Expected: FAIL — `Cannot find module '.../trips-chrome-bar.js'` (file doesn't exist yet).

- [ ] **Step 3: Write `TripsChromeBar`**

Create `platform/blueprints/trips/helpers/trips-chrome-bar.js`:
```js
/**
 * TripsChromeBar (CustomJS) — the trips blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / primary / ⋯ bar on trip surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Reuses the EXISTING
 * TripNavButtons instance methods for trip/section creation (_createTrip,
 * _createTripSection, and their prompt dialogs) — no new creation code.
 * Section navigation moves to `destinations` (Go ▾); the "New Section" action
 * (available on every non-hub trip surface, mirroring the old launcher) moves
 * to `overflow`. Instance methods; never-throw; cold-load-safe.
 */
class TripsChromeBar {
  get ICON() {
    return {
      plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
      trip: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
      board: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/trips";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (!["trips-hub", "trip", "trip-section", "trip-board-card"].includes(t)) return null;
        return {
          context: t,
          path: (page.file && page.file.path) || "",
          tripSlug: page.trip_slug || null,
          tripName: page.name || null,
        };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "trips-hub") {
          return { primary: { id: "new-trip", label: "New Trip", icon: ICON.plus }, overflow: [], leaf: false };
        }
        const newSection = { id: "new-section", label: "New Section", icon: ICON.plus };
        if (ctx.context === "trip") {
          return { primary: null, overflow: [newSection], leaf: false };
        }
        // trip-section / trip-board-card
        return { primary: null, overflow: [newSection], leaf: true };
      },
      // Returns the underlying promise chain (harmless for production onClick
      // callers, which don't await it) so tests can `await cfg.dispatch(...)`
      // and deterministically observe the async outcome.
      dispatch: (dv, ctx, id) => {
        const TNB = customJS && customJS.TripNavButtons;
        if (id === "new-trip") {
          if (!TNB || typeof TNB._promptForTripDetails !== "function" || typeof TNB._createTrip !== "function") {
            if (typeof Notice === "function") new Notice("TripsChromeBar: TripNavButtons unavailable — reinstall trips blueprint.", 6000);
            return;
          }
          return TNB._promptForTripDetails().then((details) => {
            if (!details) return;
            return TNB._createTrip(details).then((atlasPath) => {
              if (atlasPath) {
                if (typeof Notice === "function") new Notice(`Created trip: ${details.name}`);
                app.workspace.openLinkText(atlasPath, "");
              }
            });
          });
        }
        if (id === "new-section") {
          if (!TNB || typeof TNB._promptForSectionTitle !== "function" || typeof TNB._createTripSection !== "function") {
            if (typeof Notice === "function") new Notice("TripsChromeBar: TripNavButtons unavailable — reinstall trips blueprint.", 6000);
            return;
          }
          const tripDir = ROOT + "/" + ctx.tripSlug;
          return TNB._promptForSectionTitle(tripDir).then((title) => {
            if (!title) return;
            return TNB._createTripSection(tripDir, title, ctx.tripName, ctx.tripSlug).then((p) => {
              if (p) {
                if (typeof Notice === "function") new Notice(`Created section: ${title}`);
                app.workspace.openLinkText(p, "");
              }
            });
          });
        }
      },
      // The Go ▾ "This trip" section: Trips Hub, the trip's own atlas (unless we ARE
      // the atlas), and sibling sections (queried by trip_slug, not path parsing).
      destinations: (dv, ctx) => {
        const out = [{ section: "This trip" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Trips.md";
        if (ctx.path !== hubPath) out.push({ label: "Trips Hub", icon: ICON.board, _navTarget: hubPath, onSelect: () => open(hubPath) });
        if (ctx.context === "trips-hub" || !ctx.tripSlug) return out;
        let atlasPage = null;
        try {
          const atlases = dv.pages('"' + ROOT + '"').where((p) => p.type === "trip" && p.trip_slug === ctx.tripSlug).array();
          atlasPage = atlases.length ? atlases[0] : null;
        } catch (_e) { atlasPage = null; }
        const atlasPath = atlasPage && atlasPage.file && atlasPage.file.path;
        if (atlasPath && atlasPath !== ctx.path) {
          out.push({ label: (atlasPage.name || atlasPage.file.name), icon: ICON.trip, _navTarget: atlasPath, onSelect: () => open(atlasPath) });
        }
        if (ctx.context === "trip-section" || ctx.context === "trip-board-card") {
          let siblings = [];
          try { siblings = dv.pages('"' + ROOT + '"').where((p) => p.type === "trip-section" && p.trip_slug === ctx.tripSlug).array(); } catch (_e) { siblings = []; }
          for (const s of siblings) {
            const sPath = s.file && s.file.path;
            if (sPath && sPath !== ctx.path) {
              out.push({ label: s.section || s.file.name, icon: ICON.trip, _navTarget: sPath, onSelect: () => open(sPath) });
            }
          }
        }
        return out;
      },
      rootClass: "trips-chrome-root",
      btnClass: (v) => `trips-chrome-btn trips-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-trips-chrome-bar.js`
Expected: `6/6 passed`, exit 0.

- [ ] **Step 5: Wire into `package.json`**

Same pattern as Task 1 Step 7: add `"test:trips-chrome-bar": "node platform/test/run-trips-chrome-bar.js",` under scripts, and append ` && node platform/test/run-trips-chrome-bar.js` to `release:preflight` (before the closing quote).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/trips/helpers/trips-chrome-bar.js platform/test/run-trips-chrome-bar.js package.json
git commit -m "feat(chrome-bar): add TripsChromeBar adapter"
```

---

## Task 3: `trips` — manifest + templates + content + guard

**Files:**
- Modify: `platform/blueprints/trips/manifest.json`
- Modify: `platform/blueprints/trips/templates/Trip Atlas.md`
- Modify: `platform/blueprints/trips/templates/Trip Flights.md`, `Trip Stay.md`, `Trip Packing List.md`, `Trip To Do.md`, `Trip Notes.md`
- Modify: `platform/blueprints/trips/templates/Trip Board Card.md`
- Modify: `platform/blueprints/trips/content/Trips.md`
- Modify: `platform/blueprints/trips/helpers/trip-nav-buttons.js` (guard)
- Modify: `platform/test/run-trips.js`, `platform/test/run-trips-render-guards.js`, `platform/test/run-helper-cases.js` (verify/update — see Step 8)

- [ ] **Step 1: Update `manifest.json`**

In `platform/blueprints/trips/manifest.json`, add to `depends_on` (after the existing `render-safe` entry):
```json
    {
      "name": "chrome-bar",
      "range": ">=0.3.0"
    }
```
Add `"TripsChromeBar"` to `customjs_classes` (alongside the existing 4 entries).
Add to `files`:
```json
    {
      "source": "helpers/trips-chrome-bar.js",
      "dest": "{{scripts_path}}/trips/trips-chrome-bar.js"
    }
```

- [ ] **Step 2: Replace chrome in `Trip Atlas.md`**

In `platform/blueprints/trips/templates/Trip Atlas.md`, replace:
```
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
with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```
```
(leave `TripSectionsCards`, the `SectionLabel`, and `BacklinkPanel` blocks below it untouched.)

- [ ] **Step 3: Replace chrome in the 5 section templates**

In each of `Trip Flights.md`, `Trip Stay.md`, `Trip Packing List.md`, `Trip To Do.md`, `Trip Notes.md`, replace the identical 3-block chrome body:
```
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
with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```
```

- [ ] **Step 4: Replace chrome in `Trip Board Card.md`**

In `platform/blueprints/trips/templates/Trip Board Card.md`, replace:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```
```
(the Templater `<%* ... %>` folder-promotion block above it is untouched.)

- [ ] **Step 5: Replace chrome in `content/Trips.md`**

In `platform/blueprints/trips/content/Trips.md`, replace:
```
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
with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```
```
(leave the `SectionLabel` + `TripsHubCards` blocks below it untouched.)

- [ ] **Step 6: Guard `TripNavButtons`**

In `platform/blueprints/trips/helpers/trip-nav-buttons.js`, at the top of `async render(dv)` (currently starting `const page = customJS.RenderSafe.page(dv); if (!page || !page.file) return;`), add a presence guard immediately after the existing null-check:
```js
    async render(dv) {
        const page = customJS.RenderSafe.page(dv);
        if (!page || !page.file) return;
        try {
            if (dv.container.closest && dv.container.closest(".markdown-preview-view")?.querySelector(".trips-chrome-root")) return;
        } catch (_e) { /* best-effort guard */ }
        const filePath = page.file.path;
        const ctx = this.detectContext(filePath, dv);
        ...
```
(the rest of `render()` is unchanged — this file's other methods, including `_createTrip`/`_createTripSection`/the prompt dialogs, are still called directly by `TripsChromeBar.dispatch()`, so nothing else in this file changes.)

- [ ] **Step 7: Run the trips test suite**

Run: `node platform/test/run-trips.js && node platform/test/run-trips-heal.js && node platform/test/run-trips-render-guards.js`
Expected: all still pass — `run-trips-heal.js` tests the pre-existing `applyTripsConformanceHeal` heal, unrelated to chrome; `run-trips-render-guards.js` tests `TripNavButtons.render()`'s cold-load safety, which the guard addition doesn't change (the guard runs after the existing null-check, so a null/missing page still returns before reaching it). If either fails, read the failure and fix the guard placement — do not weaken the guard to make a test pass.

- [ ] **Step 8: Check `run-helper-cases.js` for trips assertions**

Run: `grep -n "TripNavButtons" platform/test/run-helper-cases.js`. If any case asserts on the old rendered nav output (button labels, launcher entries) rather than just "doesn't throw", update it to reflect that `TripNavButtons.render()` now no-ops when `.trips-chrome-root` is present — add a case constructing a container whose `closest(".markdown-preview-view")` returns an element with `.querySelector(".trips-chrome-root")` returning a truthy stub, and assert `render()` returns without creating a `.tnb-root` element.

- [ ] **Step 9: Run full preflight for this task's scope**

Run: `npm run test:helpers && node platform/test/run-trips.js && node platform/test/run-trips-heal.js && node platform/test/run-trips-render-guards.js && node platform/test/run-trips-chrome-bar.js`
Expected: all pass, 0 failures.

- [ ] **Step 10: Commit**

```bash
git add platform/blueprints/trips/manifest.json platform/blueprints/trips/templates platform/blueprints/trips/content/Trips.md platform/blueprints/trips/helpers/trip-nav-buttons.js platform/test/run-helper-cases.js
git commit -m "feat(chrome-bar): roll TripsChromeBar onto trips templates + guard TripNavButtons"
```

---

## Task 4: `reader` — `ReaderChromeBar` adapter + test

**Files:**
- Create: `platform/blueprints/reader/helpers/reader-chrome-bar.js`
- Test: `platform/test/run-reader-chrome-bar.js`

Status transitions and the "Open article ↗" link move from `ReaderArticleActions`'s own rendered row into ChromeBar's `overflow` menu (per the design decision to fully absorb, not keep a separate row). `ReaderArticleActions.statusTransitions(status)` and `._setStatus(path, next)` are reused directly — both are already instance-callable (the class defines instance delegators to its own statics). `renderCreateRow` (the hub's "+ New article" row, called from `ReaderQueue`) is untouched — reader-hub's own creation now also goes through ChromeBar's `primary` button, so both paths exist momentarily; that's fine, they dispatch to the same `EntityCreate.create({instance:"reader-article"})` call.

Status literals (from `reader-article-actions.js`): `unread` (default) → `reading`/`archived`; `reading` → `archived`/`unread`; `archived` → `reading`/`unread`.

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-reader-chrome-bar.js`:
```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const ReaderChromeBar = loadClass('platform/blueprints/reader/helpers/reader-chrome-bar.js', 'ReaderChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ReaderChromeBar();
const cfg = inst._config();

// RCB-DETECT
{
  const hub = cfg.detect({}, { file: { path: 'spice/reader/Reader.md' }, type: 'reader-hub' });
  const article = cfg.detect({}, { file: { path: 'spice/reader/Some Article.md' }, type: 'reader-article', status: 'reading', url: 'https://x.com/a' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('RCB-DETECT-1 reader-hub/reader-article classify; non-reader → null',
    hub && hub.context === 'reader-hub' && article && article.context === 'reader-article' && article.status === 'reading' && article.url === 'https://x.com/a' && off === null);
}
// RCB-SPEC
{
  const h = cfg.surfaceSpec({ context: 'reader-hub' });
  const unread = cfg.surfaceSpec({ context: 'reader-article', status: 'unread', url: '' });
  const reading = cfg.surfaceSpec({ context: 'reader-article', status: 'reading', url: 'https://x.com/a' });
  ok('RCB-SPEC-1 hub: primary new-article + not leaf', h.primary.id === 'new-article' && h.leaf === false);
  ok('RCB-SPEC-2 unread article, no url: leaf + no open-article + 2 status actions',
    unread.leaf === true && !unread.overflow.some(o => o.id === 'open-article') && unread.overflow.some(o => o.id === 'status-reading') && unread.overflow.some(o => o.id === 'status-archived'));
  ok('RCB-SPEC-3 reading article with url: open-article + 2 status actions (archived, unread)',
    reading.overflow.some(o => o.id === 'open-article') && reading.overflow.some(o => o.id === 'status-archived') && reading.overflow.some(o => o.id === 'status-unread'));
}
// RCB-DISPATCH
{
  const calls = [];
  const prevCJS = global.customJS;
  const prevWindow = global.window;
  global.window = { open: (url) => calls.push({ openUrl: url }) };
  global.customJS = {
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
    ReaderArticleActions: { _setStatus: (p, next) => calls.push({ setStatus: p + ':' + next }) },
  };
  const dv = {};
  cfg.dispatch(dv, { context: 'reader-hub' }, 'new-article');
  cfg.dispatch(dv, { context: 'reader-article', url: 'https://x.com/a' }, 'open-article');
  cfg.dispatch(dv, { context: 'reader-article', path: 'spice/reader/Some Article.md' }, 'status-archived');
  global.customJS = prevCJS;
  global.window = prevWindow;
  ok('RCB-DISPATCH-1 new-article → EntityCreate.create(instance:"reader-article")', calls.some(c => c.create === 'reader-article'));
  ok('RCB-DISPATCH-2 open-article → window.open(url)', calls.some(c => c.openUrl === 'https://x.com/a'));
  ok('RCB-DISPATCH-3 status-archived → ReaderArticleActions._setStatus(path, "archived")', calls.some(c => c.setStatus === 'spice/reader/Some Article.md:archived'));
}
// RCB-DEST
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} } };
  const article = cfg.destinations({}, { context: 'reader-article', path: 'spice/reader/Some Article.md' });
  const hub = cfg.destinations({}, { context: 'reader-hub', path: 'spice/reader/Reader.md' });
  global.customJS = prevCJS;
  ok('RCB-DEST-1 article destinations: This reader marker + Reader Hub link', article[0] && article[0].section === 'This reader' && article.some(e => e && e.label === 'Reader Hub'));
  ok('RCB-DEST-2 hub omits its own self-link', !hub.some(e => e && e._navTarget === 'spice/reader/Reader.md'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader-chrome-bar.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReaderChromeBar`**

Create `platform/blueprints/reader/helpers/reader-chrome-bar.js`:
```js
/**
 * ReaderChromeBar (CustomJS) — the reader blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / primary / ⋯ bar on reader surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Absorbs ReaderArticleActions'
 * status-transition row (Open article ↗ / Mark reading / Mark read / etc.) into
 * the ⋯ overflow menu — reuses ReaderArticleActions.statusTransitions(status)
 * and ._setStatus(path, next) directly, no new transition logic. The hub's
 * "+ New article" button dispatches to the same EntityCreate call
 * ReaderArticleActions.renderCreateRow already uses (which stays active,
 * unchanged, for ReaderQueue). Instance methods; never-throw; cold-load-safe.
 */
class ReaderChromeBar {
  get ICON() {
    return {
      filePlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/></svg>`,
      external: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
      book: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
      check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
      home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/reader";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "reader-hub" && t !== "reader-article") return null;
        return {
          context: t,
          path: (page.file && page.file.path) || "",
          url: page.url != null ? String(page.url).trim() : "",
          status: page.status != null ? String(page.status).trim().toLowerCase() : "unread",
        };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "reader-hub") {
          return { primary: { id: "new-article", label: "+ New article", icon: ICON.filePlus }, overflow: [], leaf: false };
        }
        // reader-article
        const overflow = [];
        if (ctx.url) overflow.push({ id: "open-article", label: "Open article ↗", icon: ICON.external });
        let transitions = [];
        try {
          if (customJS && customJS.ReaderArticleActions && typeof customJS.ReaderArticleActions.statusTransitions === "function") {
            transitions = customJS.ReaderArticleActions.statusTransitions(ctx.status) || [];
          }
        } catch (_e) { transitions = []; }
        for (const t of transitions) {
          overflow.push({ id: "status-" + t.next, label: t.label, icon: t.next === "archived" ? ICON.check : ICON.book });
        }
        return { primary: null, overflow, leaf: true };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "new-article") {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "reader-article", dv });
          } else if (typeof Notice === "function") { new Notice("ReaderChromeBar: EntityCreate unavailable — reinstall reader blueprint.", 6000); }
          return;
        }
        if (id === "open-article") {
          if (ctx.url) { try { window.open(ctx.url, "_blank", "noopener"); } catch (_e) {} }
          return;
        }
        if (id && id.indexOf("status-") === 0) {
          const next = id.slice("status-".length);
          if (customJS && customJS.ReaderArticleActions && typeof customJS.ReaderArticleActions._setStatus === "function") {
            customJS.ReaderArticleActions._setStatus(ctx.path, next);
          } else if (typeof Notice === "function") { new Notice("ReaderChromeBar: ReaderArticleActions unavailable — reinstall reader blueprint.", 6000); }
          return;
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This reader" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Reader.md";
        if (ctx.path !== hubPath) out.push({ label: "Reader Hub", icon: ICON.home, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "reader-chrome-root",
      btnClass: (v) => `reader-chrome-btn reader-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader-chrome-bar.js`
Expected: `9/9 passed`, exit 0.

- [ ] **Step 5: Wire into `package.json`** (same pattern as prior tasks — `test:reader-chrome-bar` script + append to `release:preflight`).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/reader/helpers/reader-chrome-bar.js platform/test/run-reader-chrome-bar.js package.json
git commit -m "feat(chrome-bar): add ReaderChromeBar adapter"
```

---

## Task 5: `reader` — manifest + templates + content + guard

**Files:**
- Modify: `platform/blueprints/reader/manifest.json`
- Modify: `platform/blueprints/reader/templates/Reader Article.md`
- Modify: `platform/blueprints/reader/templates/Reader.md`
- Modify: `platform/blueprints/reader/content/Reader Hub.md`
- Modify: `platform/blueprints/reader/helpers/reader-article-actions.js` (guard the instance `render`, NOT the static `renderCreateRow`)
- Verify: `platform/test/run-reader.js`

- [ ] **Step 1: Update `manifest.json`**

Add to `depends_on`: `{"name": "chrome-bar", "range": ">=0.3.0"}`. Add `"ReaderChromeBar"` to `customjs_classes`. Add to `files`:
```json
    {
      "source": "helpers/reader-chrome-bar.js",
      "dest": "{{scripts_path}}/reader/reader-chrome-bar.js"
    }
```

- [ ] **Step 2: Replace chrome in `Reader Article.md`**

In `platform/blueprints/reader/templates/Reader Article.md`, replace the leading `Breadcrumb` → `SpaceNavButtons` → `ReaderArticleActions` block sequence with a single:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ReaderChromeBar" });
```
```
(leave the `ReaderArticleView` block and `READER_HIGHLIGHTS`/`READER_CONTENT` markers below it untouched — read the file first to confirm the exact current block sequence before editing, since this is the `body_template` referenced by `manifest.json`'s `new_entity_buttons`, not a full standalone file with its own frontmatter.)

- [ ] **Step 3: Replace chrome in `Reader.md` and `content/Reader Hub.md`**

Both currently render `Breadcrumb` → `SpaceNavButtons` → `ReaderQueue` (per the manifest, `Reader.md` is the template installed to `{{templates_path}}/Reader.md`; `content/Reader Hub.md` is the live hub content installed to `spice/reader/Reader.md`). In both files, replace the `Breadcrumb` + `SpaceNavButtons` blocks with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ReaderChromeBar" });
```
```
Leave `ReaderQueue` untouched (it still hosts `ReaderArticleActions.renderCreateRow` + `DocSearch` + the results list).

- [ ] **Step 4: Guard `ReaderArticleActions.render()`**

In `platform/blueprints/reader/helpers/reader-article-actions.js`, at the top of the instance `render(dv)` method (currently starting `if (!dv || !dv.container) return; if (dv.container.closest && dv.container.closest('.markdown-embed')) return;`), add a presence guard right after the embed check:
```js
    render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;
        try {
            if (dv.container.closest('.markdown-preview-view')?.querySelector('.reader-chrome-root')) return;
        } catch (_e) { /* best-effort guard */ }
        const cur = dv.current && dv.current();
        ...
```
Do NOT add this guard to `static renderCreateRow(dv)` — it stays fully active, called by `ReaderQueue` on the hub.

- [ ] **Step 5: Run the reader test suite**

Run: `node platform/test/run-reader.js`
Expected: passes unchanged, OR if it asserts on `ReaderArticleActions.render()`'s DOM output directly (not through the guard), review the failure and add a guard-aware case following the same pattern as Task 3 Step 8 — assert `render()` no-ops when `.reader-chrome-root` is present in the container's `.markdown-preview-view` ancestor.

- [ ] **Step 6: Run full preflight for this task's scope**

Run: `node platform/test/run-reader.js && node platform/test/run-reader-chrome-bar.js`
Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/reader/manifest.json platform/blueprints/reader/templates platform/blueprints/reader/content platform/blueprints/reader/helpers/reader-article-actions.js
git commit -m "feat(chrome-bar): roll ReaderChromeBar onto reader templates + guard ReaderArticleActions"
```

---

## Task 6: `people` — `PeopleChromeBar` adapter + test

**Files:**
- Create: `platform/blueprints/people/scripts/people-chrome-bar.js` (note: `scripts/`, not `helpers/` — matches people's existing directory convention, unlike trips/reader/wiki which use `helpers/`)
- Test: `platform/test/run-people-chrome-bar.js`

This is the ONE blueprint where ChromeBar is added ALONGSIDE existing chrome, not in place of it — `PersonNavButtons`' identity row (icon + name + tag chip) stays; only its "Back to People" button becomes redundant and gets guarded off (Task 7).

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-people-chrome-bar.js`:
```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const PeopleChromeBar = loadClass('platform/blueprints/people/scripts/people-chrome-bar.js', 'PeopleChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new PeopleChromeBar();
const cfg = inst._config();

// PCB-DETECT
{
  const hub = cfg.detect({}, { file: { path: 'spice/people/People.md' }, type: 'people-hub' });
  const person = cfg.detect({}, { file: { path: 'spice/people/Jane Doe.md' }, type: 'person' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('PCB-DETECT-1 people-hub/person classify; non-people → null',
    hub && hub.context === 'people-hub' && person && person.context === 'person' && off === null);
}
// PCB-SPEC — no primary/overflow anywhere (creation is a separate EntityCreate block on the hub).
{
  const h = cfg.surfaceSpec({ context: 'people-hub' });
  const p = cfg.surfaceSpec({ context: 'person' });
  ok('PCB-SPEC-1 hub: primary null + overflow empty + not leaf', h.primary === null && h.overflow.length === 0 && h.leaf === false);
  ok('PCB-SPEC-2 person: primary null + overflow empty + leaf', p.primary === null && p.overflow.length === 0 && p.leaf === true);
}
// PCB-DISPATCH — no ids to dispatch; must never throw on an unknown id.
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'person' }, 'anything'); } catch (_e) { threw = true; }
  ok('PCB-DISPATCH-1 dispatch never throws (no-op surface)', threw === false);
}
// PCB-DEST
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} } };
  const person = cfg.destinations({}, { context: 'person', path: 'spice/people/Jane Doe.md' });
  const hub = cfg.destinations({}, { context: 'people-hub', path: 'spice/people/People.md' });
  global.customJS = prevCJS;
  ok('PCB-DEST-1 person destinations: This people marker + People Hub link', person[0] && person[0].section === 'This people' && person.some(e => e && e.label === 'People'));
  ok('PCB-DEST-2 hub omits its own self-link', !hub.some(e => e && e._navTarget === 'spice/people/People.md'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-people-chrome-bar.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `PeopleChromeBar`**

Create `platform/blueprints/people/scripts/people-chrome-bar.js`:
```js
/**
 * PeopleChromeBar (CustomJS) — the people blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ bar on people surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Unlike every other cycle-3
 * adapter, this one has NO primary/overflow actions: person creation is already
 * a separate EntityCreate dataviewjs block on the People hub (content/People.md)
 * and stays there unchanged — ChromeBar only supplies nav (breadcrumb + Go ▾).
 * PersonNavButtons keeps rendering the per-person identity row (icon + name +
 * tag chip) below this bar; only its now-redundant "Back to People" button is
 * guarded off (see person-nav-buttons.js). Instance methods; never-throw;
 * cold-load-safe.
 */
class PeopleChromeBar {
  get ICON() {
    return {
      people: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/people";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "people-hub" && t !== "person") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        return { primary: null, overflow: [], leaf: ctx.context === "person" };
      },
      dispatch: (dv, ctx, id) => { /* no actions on this surface */ },
      destinations: (dv, ctx) => {
        const out = [{ section: "This people" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/People.md";
        if (ctx.path !== hubPath) out.push({ label: "People", icon: ICON.people, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "people-chrome-root",
      btnClass: (v) => `people-chrome-btn people-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-people-chrome-bar.js`
Expected: `6/6 passed`, exit 0.

- [ ] **Step 5: Wire into `package.json`** (same pattern — `test:people-chrome-bar` + append to `release:preflight`).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/people/scripts/people-chrome-bar.js platform/test/run-people-chrome-bar.js package.json
git commit -m "feat(chrome-bar): add PeopleChromeBar adapter"
```

---

## Task 7: `people` — manifest + templates (2 creation paths) + content + guard

**Files:**
- Modify: `platform/blueprints/people/manifest.json` (BOTH `depends_on`/`customjs_classes`/`files` AND `new_entity_buttons[0].inline_body`)
- Modify: `platform/blueprints/people/templates/Template, People.md`
- Modify: `platform/blueprints/people/content/People.md`
- Modify: `platform/blueprints/people/scripts/person-nav-buttons.js` (guard the back-link only, keep identity row)
- Verify: `platform/test/run-people-render-guards.js`

Person notes are created via TWO paths that must both get the ChromeBar block: the canonical `new_entity_buttons[0].inline_body` (entity-create button) AND the legacy `templates/Template, People.md` (manual "Insert template" — no longer auto-fired, but still shipped in `files[]`).

- [ ] **Step 1: Update `manifest.json`'s dependency/class/file fields**

Add to `depends_on`: `{"name": "chrome-bar", "range": ">=0.3.0"}`. Add `"PeopleChromeBar"` to `customjs_classes` (alongside `PeopleHubCards`, `PersonNavButtons`). Add to `files`:
```json
    {
      "source": "scripts/people-chrome-bar.js",
      "dest": "{{scripts_path}}/people/people-chrome-bar.js"
    }
```

- [ ] **Step 2: Update `new_entity_buttons[0].inline_body`**

In `platform/blueprints/people/manifest.json`, the `inline_body` string currently starts with:
```
```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"PersonNavButtons\" });\n```\n\n# [[{{prompts.name}}]]\n...
```
Prepend a `PeopleChromeBar` block before the `PersonNavButtons` block, so the new value is:
```
```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"PeopleChromeBar\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"PersonNavButtons\" });\n```\n\n# [[{{prompts.name}}]]\n...
```
(keep everything from `# [[{{prompts.name}}]]` onward byte-identical — only the two leading dataviewjs blocks change).

- [ ] **Step 3: Update `templates/Template, People.md`**

In `platform/blueprints/people/templates/Template, People.md`, prepend a `PeopleChromeBar` block (using `{{views_path}}`, matching this file's existing token style, NOT the manifest's hardcoded `ranch/views/customjs-guard`) before the existing `PersonNavButtons` block:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "PeopleChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "PersonNavButtons" });
```
```
(leave everything from `# [[<% tp.file.title %>]]` onward unchanged.)

- [ ] **Step 4: Update `content/People.md`**

In `platform/blueprints/people/content/People.md`, replace:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "PeopleChromeBar" });
```
```
(leave the `EntityCreate` block, the `## All People` heading, and `PeopleHubCards` block untouched.)

- [ ] **Step 5: Guard `PersonNavButtons`' back-link only**

In `platform/blueprints/people/scripts/person-nav-buttons.js`, the `render()` method currently unconditionally renders the identity row, then the back-link button row. Change it to keep the identity row unconditional but wrap the back-link row in a presence check:
```js
class PersonNavButtons {
    async render(dv, opts) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .pnb-root");
        if (previous) previous.remove();

        const current = dv.current();
        const name = current?.file?.name || "Person";

        let tagMode = null;
        const rawTags = current?.tags || current?.file?.tags || [];
        const tagList = Array.isArray(rawTags) ? rawTags : [];
        for (const t of tagList) {
            const stripped = String(t).replace(/^#/, "").trim();
            if (!stripped || stripped.toLowerCase() === "person") continue;
            tagMode = stripped;
            break;
        }

        const userIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        const backIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;

        const root = dv.container.createEl("div", { cls: "pnb-root" });

        const idRow = root.createEl("div");
        idRow.style.cssText = "display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; margin: 8px 0 6px 0; min-width: 0;";

        const iconWrap = idRow.createEl("span");
        iconWrap.innerHTML = userIcon;
        iconWrap.style.cssText = "display: inline-flex; align-items: center; color: var(--text-muted); flex-shrink: 0;";

        const nameEl = idRow.createEl("span");
        nameEl.textContent = name;
        nameEl.style.cssText = "font-weight: 600; font-size: 1.05em; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;";

        if (tagMode) {
            const chip = idRow.createEl("span");
            chip.textContent = tagMode;
            chip.style.cssText = "display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; background: var(--background-modifier-border); color: var(--text-muted); font-size: 0.72em; font-weight: 500; letter-spacing: 0.04em; text-transform: lowercase; flex-shrink: 0;";
        }

        // Back-link button row — guarded: once a note carries PeopleChromeBar, its
        // Go ▾ launcher already supplies nav back to the People hub, so this
        // now-redundant button is skipped. Falls back to rendering it when
        // ChromeBar isn't present (unhealed/unmigrated note).
        let chromePresent = false;
        try {
            chromePresent = !!(dv.container.closest && dv.container.closest(".markdown-preview-view")?.querySelector(".people-chrome-root"));
        } catch (_e) { chromePresent = false; }
        if (!chromePresent) {
            const btnRow = root.createEl("div");
            btnRow.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 4px;";
            customJS.AccentButton.render(btnRow, {
                label: "Back to People",
                icon: backIcon,
                onClick: () => dv.app.workspace.openLinkText("People", "spice/people/", false)
            });
        }
    }
}
```

- [ ] **Step 6: Run the people test suite**

Run: `node platform/test/run-people-render-guards.js`
Expected: check whether it asserts the back-button always renders — if so, add a case with a `.markdown-preview-view` ancestor containing `.people-chrome-root` and assert the back-button is absent, plus keep the existing case (no ChromeBar present) asserting the identity row AND back-button both render. Read the test file's existing assertions before editing so the new case follows its established stub-DOM style exactly.

- [ ] **Step 7: Check `run-helper-cases.js`'s `caseHCV0881PersonNavButtons`**

Run: `grep -n -A5 "caseHCV0881PersonNavButtons" platform/test/run-helper-cases.js`. This case asserts PersonNavButtons "no longer passes icon: null" and "defines backIcon SVG" — both string-presence checks against the source file, unaffected by the guard addition (the guard wraps rendering logic, doesn't remove `backIcon`'s definition). Run `node platform/test/run-helper-cases.js` to confirm it still passes; if it fails, the guard was inserted in a way that altered the `backIcon` declaration — fix by keeping `backIcon`'s `const` declaration exactly where it was (before the guard check).

- [ ] **Step 8: Run full preflight for this task's scope**

Run: `node platform/test/run-helper-cases.js && node platform/test/run-people-render-guards.js && node platform/test/run-people-chrome-bar.js`
Expected: 0 failures.

- [ ] **Step 9: Commit**

```bash
git add platform/blueprints/people/manifest.json platform/blueprints/people/templates platform/blueprints/people/content/People.md platform/blueprints/people/scripts/person-nav-buttons.js platform/test/run-people-render-guards.js
git commit -m "feat(chrome-bar): roll PeopleChromeBar onto people templates + guard PersonNavButtons back-link"
```

---

## Task 8: `products` — `ProductsChromeBar` adapter + test

**Files:**
- Create: `platform/blueprints/products/scripts/products-chrome-bar.js`
- Test: `platform/test/run-products-chrome-bar.js`

Note: `ProductActionButtons` is currently dead code (registered in the manifest but never invoked from any template or content file — verified by grep). `ProductsChromeBar`'s primary button becomes the FIRST working "+ New Product" creation trigger, inlining the same Templater invocation `ProductActionButtons.render()`'s `onClick` uses.

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-products-chrome-bar.js`:
```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const ProductsChromeBar = loadClass('platform/blueprints/products/scripts/products-chrome-bar.js', 'ProductsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ProductsChromeBar();
const cfg = inst._config();

async function main() {

// PDCB-DETECT
{
  const hub = cfg.detect({}, { file: { path: 'spice/products/Products.md' }, type: 'products-hub' });
  const product = cfg.detect({}, { file: { path: 'spice/products/Acme.md' }, type: 'product' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('PDCB-DETECT-1 products-hub/product classify; non-products → null',
    hub && hub.context === 'products-hub' && product && product.context === 'product' && off === null);
}
// PDCB-SPEC
{
  const h = cfg.surfaceSpec({ context: 'products-hub' });
  const p = cfg.surfaceSpec({ context: 'product' });
  ok('PDCB-SPEC-1 hub: primary new-product + not leaf', h.primary.id === 'new-product' && h.leaf === false);
  ok('PDCB-SPEC-2 product: leaf + primary null + overflow empty', p.leaf === true && p.primary === null && p.overflow.length === 0);
}
// PDCB-DISPATCH
{
  const calls = [];
  const prevApp = global.app;
  global.app = {
    plugins: { plugins: { "templater-obsidian": { templater: { create_new_note_from_template: (tpl, folder) => { calls.push({ create: folder }); return Promise.resolve(); } } } } },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  global.Notice = function () {};
  await cfg.dispatch({}, { context: 'products-hub' }, 'new-product');
  global.app = prevApp;
  ok('PDCB-DISPATCH-1 new-product → templater.create_new_note_from_template("spice/products")', calls.some(c => c.create === 'spice/products'));
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-products-chrome-bar.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ProductsChromeBar`**

Create `platform/blueprints/products/scripts/products-chrome-bar.js`:
```js
/**
 * ProductsChromeBar (CustomJS) — the products blueprint's ChromeBar adapter
 * config. Renders the shared Go ▾ / primary bar on product surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). ProductActionButtons is
 * currently unreferenced by any template/content file (dead code) — this
 * adapter's primary button inlines the same Templater
 * create_new_note_from_template call so "+ New Product" actually works for
 * the first time. Instance methods; never-throw; cold-load-safe.
 */
class ProductsChromeBar {
  get ICON() {
    return {
      package: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/products";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "products-hub" && t !== "product") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "products-hub") {
          return { primary: { id: "new-product", label: "New Product", icon: ICON.package }, overflow: [], leaf: false };
        }
        return { primary: null, overflow: [], leaf: true };
      },
      dispatch: async (dv, ctx, id) => {
        if (id !== "new-product") return;
        const templaterPlugin = app.plugins.plugins["templater-obsidian"];
        const template = app.vault.getAbstractFileByPath("ranch/templates/Template, Product.md");
        if (!templaterPlugin || !template) {
          if (typeof Notice === "function") new Notice("Templater + Template, Product.md required for + New Product.");
          return;
        }
        try {
          await templaterPlugin.templater.create_new_note_from_template(template, "spice/products", undefined, true);
        } catch (e) {
          const msg = (e && e.message) || String(e);
          if (typeof Notice === "function") new Notice("Failed to create product: " + msg);
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This products" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Products.md";
        if (ctx.path !== hubPath) out.push({ label: "Products", icon: ICON.package, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "products-chrome-root",
      btnClass: (v) => `products-chrome-btn products-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-products-chrome-bar.js`
Expected: `5/5 passed`, exit 0.

- [ ] **Step 5: Wire into `package.json`** (same pattern — `test:products-chrome-bar` + append to `release:preflight`).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/products/scripts/products-chrome-bar.js platform/test/run-products-chrome-bar.js package.json
git commit -m "feat(chrome-bar): add ProductsChromeBar adapter"
```

---

## Task 9: `products` — manifest + template + content + guard

**Files:**
- Modify: `platform/blueprints/products/manifest.json`
- Modify: `platform/blueprints/products/templates/Template, Product.md`
- Modify: `platform/blueprints/products/content/Products.md`
- Modify: `platform/blueprints/products/scripts/product-action-buttons.js` (defensive guard, even though currently unreferenced)
- Verify: `platform/test/run-products-render-guards.js`

- [ ] **Step 1: Update `manifest.json`**

Add to `depends_on`: `{"name": "chrome-bar", "range": ">=0.3.0"}`. Add `"ProductsChromeBar"` to `customjs_classes`. Add to `files`:
```json
    {
      "source": "scripts/products-chrome-bar.js",
      "dest": "{{scripts_path}}/products/products-chrome-bar.js"
    }
```

- [ ] **Step 2: Replace chrome in `Template, Product.md`**

In `platform/blueprints/products/templates/Template, Product.md`, replace:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProductsChromeBar" });
```
```
(leave the Templater `<%* ... %>` prompt block above it, and the `ProductPageCards`/`BacklinkPanel` blocks below it, untouched.)

- [ ] **Step 3: Replace chrome in `content/Products.md`**

In `platform/blueprints/products/content/Products.md`, replace:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProductsChromeBar" });
```
```
(leave the `# Products` heading and `ProductsHubCards` block untouched.)

- [ ] **Step 4: Add a defensive guard to `ProductActionButtons`**

In `platform/blueprints/products/scripts/product-action-buttons.js`, at the top of `render(dv, opts)` (currently `if (dv.container.closest(".markdown-embed")) return;`), add:
```js
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    try {
      if (dv.container.closest(".markdown-preview-view")?.querySelector(".products-chrome-root")) return;
    } catch (_e) { /* best-effort guard */ }
    if (!customJS.AccentButton) {
      ...
```
This class is currently unreferenced by any template (verified), so this guard has no observable effect today — it's defensive parity with every other blueprint's retired helper, in case something else starts invoking it later.

- [ ] **Step 5: Run the products test suite**

Run: `node platform/test/run-products-render-guards.js`
Expected: passes unchanged (the guard is a no-op given the class is never actually invoked from a template today; the test drives `render()` directly, so confirm it still asserts "doesn't throw" and doesn't newly fail).

- [ ] **Step 6: Run full preflight for this task's scope**

Run: `node platform/test/run-products-render-guards.js && node platform/test/run-products-chrome-bar.js`
Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/products/manifest.json platform/blueprints/products/templates platform/blueprints/products/content/Products.md platform/blueprints/products/scripts/product-action-buttons.js
git commit -m "feat(chrome-bar): roll ProductsChromeBar onto products templates + guard ProductActionButtons"
```

---

## Task 10: `teams` — `TeamsChromeBar` adapter + test

**Files:**
- Create: `platform/blueprints/teams/scripts/teams-chrome-bar.js`
- Test: `platform/test/run-teams-chrome-bar.js`

Mirrors Task 8 exactly (same dead-code situation with `TeamActionButtons`, same Templater dispatch shape).

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-teams-chrome-bar.js`:
```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const TeamsChromeBar = loadClass('platform/blueprints/teams/scripts/teams-chrome-bar.js', 'TeamsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new TeamsChromeBar();
const cfg = inst._config();

async function main() {

// TMCB-DETECT
{
  const hub = cfg.detect({}, { file: { path: 'spice/teams/Teams.md' }, type: 'teams-hub' });
  const team = cfg.detect({}, { file: { path: 'spice/teams/Platform.md' }, type: 'team' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('TMCB-DETECT-1 teams-hub/team classify; non-teams → null',
    hub && hub.context === 'teams-hub' && team && team.context === 'team' && off === null);
}
// TMCB-SPEC
{
  const h = cfg.surfaceSpec({ context: 'teams-hub' });
  const t = cfg.surfaceSpec({ context: 'team' });
  ok('TMCB-SPEC-1 hub: primary new-team + not leaf', h.primary.id === 'new-team' && h.leaf === false);
  ok('TMCB-SPEC-2 team: leaf + primary null + overflow empty', t.leaf === true && t.primary === null && t.overflow.length === 0);
}
// TMCB-DISPATCH
{
  const calls = [];
  const prevApp = global.app;
  global.app = {
    plugins: { plugins: { "templater-obsidian": { templater: { create_new_note_from_template: (tpl, folder) => { calls.push({ create: folder }); return Promise.resolve(); } } } } },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  global.Notice = function () {};
  await cfg.dispatch({}, { context: 'teams-hub' }, 'new-team');
  global.app = prevApp;
  ok('TMCB-DISPATCH-1 new-team → templater.create_new_note_from_template("spice/teams")', calls.some(c => c.create === 'spice/teams'));
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-teams-chrome-bar.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `TeamsChromeBar`**

Create `platform/blueprints/teams/scripts/teams-chrome-bar.js`:
```js
/**
 * TeamsChromeBar (CustomJS) — the teams blueprint's ChromeBar adapter config.
 * Mirrors ProductsChromeBar exactly: TeamActionButtons is currently
 * unreferenced by any template/content file (dead code); this adapter's
 * primary button inlines the same Templater create_new_note_from_template
 * call so "+ New Team" actually works for the first time. Instance methods;
 * never-throw; cold-load-safe.
 */
class TeamsChromeBar {
  get ICON() {
    return {
      users: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/teams";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "teams-hub" && t !== "team") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "teams-hub") {
          return { primary: { id: "new-team", label: "New Team", icon: ICON.users }, overflow: [], leaf: false };
        }
        return { primary: null, overflow: [], leaf: true };
      },
      dispatch: async (dv, ctx, id) => {
        if (id !== "new-team") return;
        const templaterPlugin = app.plugins.plugins["templater-obsidian"];
        const template = app.vault.getAbstractFileByPath("ranch/templates/Template, Team.md");
        if (!templaterPlugin || !template) {
          if (typeof Notice === "function") new Notice("Templater + Template, Team.md required for + New Team.");
          return;
        }
        try {
          await templaterPlugin.templater.create_new_note_from_template(template, "spice/teams", undefined, true);
        } catch (e) {
          const msg = (e && e.message) || String(e);
          if (typeof Notice === "function") new Notice("Failed to create team: " + msg);
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This teams" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Teams.md";
        if (ctx.path !== hubPath) out.push({ label: "Teams", icon: ICON.users, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "teams-chrome-root",
      btnClass: (v) => `teams-chrome-btn teams-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-teams-chrome-bar.js`
Expected: `5/5 passed`, exit 0.

- [ ] **Step 5: Wire into `package.json`** (same pattern — `test:teams-chrome-bar` + append to `release:preflight`).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/teams/scripts/teams-chrome-bar.js platform/test/run-teams-chrome-bar.js package.json
git commit -m "feat(chrome-bar): add TeamsChromeBar adapter"
```

---

## Task 11: `teams` — manifest + template + content + guard

**Files:**
- Modify: `platform/blueprints/teams/manifest.json`
- Modify: `platform/blueprints/teams/templates/Template, Team.md`
- Modify: `platform/blueprints/teams/content/Teams.md`
- Modify: `platform/blueprints/teams/scripts/team-action-buttons.js` (defensive guard)
- Verify: `platform/test/run-teams-render-guards.js`

- [ ] **Step 1: Update `manifest.json`**

Add to `depends_on`: `{"name": "chrome-bar", "range": ">=0.3.0"}`. Add `"TeamsChromeBar"` to `customjs_classes`. Add to `files`:
```json
    {
      "source": "scripts/teams-chrome-bar.js",
      "dest": "{{scripts_path}}/teams/teams-chrome-bar.js"
    }
```

- [ ] **Step 2: Replace chrome in `Template, Team.md`**

Replace:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TeamsChromeBar" });
```
```
(leave the Templater prompt block above it and `TeamPageCards`/`BacklinkPanel` blocks below it untouched.)

- [ ] **Step 3: Replace chrome in `content/Teams.md`**

Replace:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TeamsChromeBar" });
```
```
(leave `# Teams` and `TeamsHubCards` untouched.)

- [ ] **Step 4: Add a defensive guard to `TeamActionButtons`**

In `platform/blueprints/teams/scripts/team-action-buttons.js`, mirror Task 9 Step 4 exactly:
```js
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    try {
      if (dv.container.closest(".markdown-preview-view")?.querySelector(".teams-chrome-root")) return;
    } catch (_e) { /* best-effort guard */ }
    if (!customJS.AccentButton) {
      ...
```

- [ ] **Step 5: Run the teams test suite**

Run: `node platform/test/run-teams-render-guards.js`
Expected: passes unchanged.

- [ ] **Step 6: Run full preflight for this task's scope**

Run: `node platform/test/run-teams-render-guards.js && node platform/test/run-teams-chrome-bar.js`
Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/teams/manifest.json platform/blueprints/teams/templates platform/blueprints/teams/content/Teams.md platform/blueprints/teams/scripts/team-action-buttons.js
git commit -m "feat(chrome-bar): roll TeamsChromeBar onto teams templates + guard TeamActionButtons"
```

---

## Task 12: `journal` — `JournalChromeBar` adapter + test + wiring

**Files:**
- Create: `platform/blueprints/journal/helpers/journal-chrome-bar.js` (new `helpers/` dir — journal has neither `scripts/` nor `helpers/` today)
- Test: `platform/test/run-journal-chrome-bar.js`
- Modify: `platform/blueprints/journal/manifest.json` (add `customjs_classes` key — currently absent entirely — plus `depends_on`/`files`)
- Modify: `platform/blueprints/journal/templates/Today Journal.md`

Journal has no existing action/nav helper to guard or retire — its only current chrome is a bare `SpaceNavButtons` block plus a trailing literal `---` divider (which the repo's no-literal-divider convention says should go, since nothing follows it).

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-journal-chrome-bar.js`:
```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const JournalChromeBar = loadClass('platform/blueprints/journal/helpers/journal-chrome-bar.js', 'JournalChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new JournalChromeBar();
const cfg = inst._config();

// JCB-DETECT
{
  const journal = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/Journal-2026-01-14.md' }, type: 'journal' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('JCB-DETECT-1 journal classifies; non-journal → null', journal && journal.context === 'journal' && off === null);
}
// JCB-SPEC — no primary/overflow, always leaf (single-surface blueprint).
{
  const j = cfg.surfaceSpec({ context: 'journal' });
  ok('JCB-SPEC-1 journal: primary null + overflow empty + leaf', j.primary === null && j.overflow.length === 0 && j.leaf === true);
}
// JCB-DISPATCH — no ids to dispatch; must never throw.
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'journal' }, 'anything'); } catch (_e) { threw = true; }
  ok('JCB-DISPATCH-1 dispatch never throws (no-op surface)', threw === false);
}
// JCB-DEST — just the section marker, no further entries (single-surface, no hub).
{
  const dest = cfg.destinations({}, { context: 'journal', path: 'spice/journal/2026/01-January/Journal-2026-01-14.md' });
  ok('JCB-DEST-1 destinations lead with This journal marker', dest[0] && dest[0].section === 'This journal');
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-journal-chrome-bar.js`
Expected: FAIL — module not found (and `platform/blueprints/journal/helpers/` doesn't exist yet).

- [ ] **Step 3: Write `JournalChromeBar`**

Create directory `platform/blueprints/journal/helpers/` and the file `platform/blueprints/journal/helpers/journal-chrome-bar.js`:
```js
/**
 * JournalChromeBar (CustomJS) — the journal blueprint's ChromeBar adapter
 * config. Journal has a single surface (one entry per day, no hub, no nav
 * beyond the global vault launcher) — no primary action, no overflow, always
 * leaf. This is the simplest adapter in the cycle-3 batch: it replaces the
 * bare SpaceNavButtons block that was the journal template's only chrome.
 * Instance methods; never-throw; cold-load-safe.
 */
class JournalChromeBar {
  get ICON() {
    return {
      notebook: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "journal") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: () => ({ primary: null, overflow: [], leaf: true }),
      dispatch: () => { /* no actions on this surface */ },
      destinations: () => [{ section: "This journal" }],
      rootClass: "journal-chrome-root",
      btnClass: (v) => `journal-chrome-btn journal-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-journal-chrome-bar.js`
Expected: `4/4 passed`, exit 0.

- [ ] **Step 5: Update `manifest.json`**

In `platform/blueprints/journal/manifest.json`, add `{"name": "chrome-bar", "range": ">=0.3.0"}` to `depends_on` (alongside `nav-buttons`, `customjs-guard`, `convenience`). Add a NEW `customjs_classes` key (none exists today):
```json
  "customjs_classes": [
    "JournalChromeBar"
  ],
```
(insert it after `depends_on`, before `files`.) Add to `files`:
```json
    {
      "source": "helpers/journal-chrome-bar.js",
      "dest": "{{scripts_path}}/journal/journal-chrome-bar.js"
    }
```
(this is a SECOND entry in `files` — keep the existing `templates/Today Journal.md` entry too.)

- [ ] **Step 6: Update `templates/Today Journal.md`**

Replace the entire body (everything after the frontmatter's closing `---`):
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---
```
with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```
```
(drop the trailing bare `---` — nothing follows it, and the repo's chrome convention is to never use a literal `---` as a section divider.)

- [ ] **Step 7: Wire into `package.json`** (same pattern — `test:journal-chrome-bar` + append to `release:preflight`).

- [ ] **Step 8: Check for a pre-existing journal migration heal**

Run: `grep -rn "journal" platform/install.js | grep -iv "chrome_bar_map\|roots\|allowlist"`. If existing journal notes predate the `type: journal` frontmatter field being added to the template (check by searching any seed-vault fixture or asking whether real vaults have journal notes without `type:` — the manifest's own description says creation is nav-button/Templater-folder-template driven, so ALL journal notes should already carry `type: journal` from the template). If you find evidence of untyped legacy journal notes, add a small idempotent backfill inside `_healNoteChromeBody`'s journal branch (guarded by `type === 'journal'`) before this task is considered complete — otherwise, no backfill is needed and you can skip this step's remainder.

- [ ] **Step 9: Run full preflight for this task's scope**

Run: `node platform/test/run-journal-chrome-bar.js`
Expected: 0 failures.

- [ ] **Step 10: Commit**

```bash
git add platform/blueprints/journal/helpers platform/blueprints/journal/manifest.json platform/blueprints/journal/templates package.json platform/test/run-journal-chrome-bar.js
git commit -m "feat(chrome-bar): add JournalChromeBar adapter + roll onto journal template"
```

---

## Task 13: Full preflight + fix stragglers

**Files:** none pre-determined — whatever `npm run release:preflight` flags.

- [ ] **Step 1: Run the full preflight**

Run: `npm run release:preflight`
Expected: eventually `0 failures`. This will likely surface at least these categories of issue, in order:
1. `lint-note-chrome.js` may flag the journal template's now-single-block body, or any blueprint's template if a chrome block was left malformed (unbalanced fences, wrong class name) — fix by re-reading the exact template diff from Tasks 3/5/7/9/11/12 and correcting typos.
2. `lint-cold-load.js` may flag any adapter or guarded helper that reads `page.X` without a null-check — every `detect()` above already guards via `page && page.type`, but re-check if this lints against a different pattern (e.g. `dv.current()` unguarded) and add the missing optional chaining.
3. Existing test suites that assert exact template/manifest byte-content (search failures for `run-seed.js`, `run-seed-migrations.js`, `run-migration-gate.js`, `run-audit.js`) — these may hold golden-file snapshots of manifests/templates that now need regenerating; read each failure message to see whether it's a golden-file mismatch (regenerate per that test's own instructions — check for an `UPDATE_GOLDEN=1` env var or similar convention used elsewhere in `platform/test/`) or an actual bug.
4. `run-coverage-rubric.js` / `platform/test/coverage-matrix.json` may need new entries for the 6 new `<Bp>ChromeBar` classes — if this test fails on "unscored customjs class", check how `run-wiki-chrome-bar.js`'s equivalent entry looks in `coverage-matrix.json` (from the cycle-1 wiki rollout) and add matching entries for the 6 new classes following that exact shape. Do not hand-edit `coverage-matrix.json` if there's a regen script (`grep -rn "coverage-matrix" package.json scripts/`) — prefer running the regen script.

- [ ] **Step 2: Grep for orphaned references**

Run: `grep -rn "ProductActionButtons\|TeamActionButtons" platform/blueprints/*/templates platform/blueprints/*/content 2>/dev/null`
Expected: no output (confirms these were never referenced, consistent with Task 8/10's dead-code finding — this is a sanity check, not a fix).

Run: `grep -rln "TripNavButtons\|ReaderArticleActions" platform/blueprints/trips/templates platform/blueprints/trips/content platform/blueprints/reader/templates platform/blueprints/reader/content 2>/dev/null`
Expected: no output (confirms every template/content file was migrated in Tasks 3/5 — if any file still appears, go back and re-check that task's Step for a missed replacement).

- [ ] **Step 3: Class-name collision check (non-negotiable landmine)**

Run: `grep -rn "^class TripsChromeBar\|^class ReaderChromeBar\|^class PeopleChromeBar\|^class ProductsChromeBar\|^class TeamsChromeBar\|^class JournalChromeBar" platform/`
Expected: exactly ONE match per class name (the file you created in Tasks 2/4/6/8/10/12). If any name appears twice, rename — check `Docs/landmines.md` for why this matters (duplicate customJS class names silently break the loader).

- [ ] **Step 4: Re-run every new test explicitly, together**

Run:
```bash
node platform/test/run-chrome-bar-cycle3-heal.js && \
node platform/test/run-trips-chrome-bar.js && \
node platform/test/run-reader-chrome-bar.js && \
node platform/test/run-people-chrome-bar.js && \
node platform/test/run-products-chrome-bar.js && \
node platform/test/run-teams-chrome-bar.js && \
node platform/test/run-journal-chrome-bar.js
```
Expected: all pass, 0 failures.

- [ ] **Step 5: Final full preflight**

Run: `npm run release:preflight`
Expected: `0 failures`, clean exit 0. Do not proceed to Task 14 until this is true.

---

## Task 14: Ship

**Files:** none — git/CI/deploy operations only.

- [ ] **Step 1: Verify branch state**

Run: `git -C /Users/willfellhoelter/projects/repos/sauce/.worktrees/chromebar-cycle3 status` and `git -C /Users/willfellhoelter/projects/repos/sauce/.worktrees/chromebar-cycle3 log --oneline origin/main..HEAD`
Expected: working tree clean (all prior task commits already made), and the log shows every commit from Tasks 1-12 (7-13 commits depending on how Task 13's fixes were split) ahead of `origin/main`.

- [ ] **Step 2: Push and open the PR**

```bash
cd /Users/willfellhoelter/projects/repos/sauce/.worktrees/chromebar-cycle3
git push -u origin feat/chromebar-cycle3
gh pr create --title "feat(chrome-bar): roll ChromeBar onto trips, reader, people, products, teams, journal (cycle 3)" --body "$(cat <<'EOF'
## Summary
- Onboards trips/reader/people/products/teams/journal onto the shared ChromeBar mechanism, per Docs/prompts/chromebar-cycle3-remaining-blueprints.md.
- Absorbs TripNavButtons' nav+action logic, ReaderArticleActions' status-transition row, and ProductActionButtons/TeamActionButtons' (previously dead-code) creation buttons into their respective adapters. PersonNavButtons keeps its identity row, guards only its now-redundant back-link.
- Extends install.js's CHROME_BAR_MAP / LEGACY_CLASSES / applyNoteChromeHeal so existing notes migrate on next install (headspace: 64 trips, people: 261 across 3 vaults).
- Closes a latent gap: `person` was already in the heal's type allowlist with no CHROME_BAR_MAP entry.

## Test plan
- [ ] `npm run release:preflight` — 0 failures
- [ ] Each new run-<bp>-chrome-bar.js test passes standalone
- [ ] No duplicate customJS class names (grep check in CI)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI, merge only when green**

Poll `gh pr checks <PR_NUMBER>` (or `gh pr view <PR_NUMBER> --json statusCheckRollup`) until every check reports success. Do NOT merge on a red or pending check. If a check fails, fix the underlying issue in the worktree, commit, push, and re-poll — do not force-merge or skip checks.

Once green: `gh pr merge <PR_NUMBER> --squash`

- [ ] **Step 4: Wait for the automatic release PR, merge only when green**

The release pipeline auto-opens a release PR after the feature PR merges to `main` (per this repo's fully-automatic release workflow — do NOT hand-edit versions/tags). Poll `gh pr list --search "is:pr is:open in:title release"` (or watch for a PR titled like `chore(release): vX.Y.Z`) until it appears, then poll its checks the same way as Step 3. This PR is documented to auto-merge once CI passes — if it does NOT auto-merge within a reasonable window after going green, merge it manually: `gh pr merge <RELEASE_PR_NUMBER> --squash`. Do not merge it while red or pending.

- [ ] **Step 5: Update the Homebrew tap**

```bash
cd $(brew --repository willfell/sauce) && git pull origin main
brew upgrade sauce
```
Verify: `sauce --version` (or `brew list --versions sauce`) shows the new version matching the tag the release pipeline just cut.

- [ ] **Step 6: Deploy to each consumer vault**

```bash
bash -c 'cd /Users/willfellhoelter/notes/sauce/accuris-sauce && sauce update --bump-pins'
bash -c 'cd /Users/willfellhoelter/notes/sauce/headspace-sauce && sauce update --bump-pins'
bash -c 'cd /Users/willfellhoelter/notes/sauce/ero-sauce && sauce update --bump-pins'
```
Run each sequentially (not backgrounded) so failures are visible before moving to the next vault. `sauce update` uses cwd-ancestor detection, not an env var — always `cd` into the vault first in the same shell invocation.

- [ ] **Step 7: Verify the deploy landed**

For each vault, confirm the new adapter files exist and existing notes were healed:
```bash
for v in accuris-sauce headspace-sauce ero-sauce; do
  echo "=== $v ==="
  find /Users/willfellhoelter/notes/sauce/$v -iname "*chrome-bar*" -path "*trips*" -o -iname "*chrome-bar*" -path "*reader*" -o -iname "*chrome-bar*" -path "*people*" 2>/dev/null
done
```
Spot-check one existing trip note (headspace) and one existing person note (any subscribed vault) to confirm the migrated body contains the new `<Bp>ChromeBar` block and no longer contains the old `Breadcrumb`/`SpaceNavButtons`/`TripNavButtons` (or, for person notes, still contains `PersonNavButtons` alongside the new `PeopleChromeBar`).

- [ ] **Step 8: Report completion**

Only after Steps 1-7 all succeed: summarize what shipped (PR numbers, version tag, which vaults were deployed, any preflight fixes made in Task 13) back to the user. Do not report completion before every step above is verified — CI green, release PR merged, brew upgraded, and all 3 vaults deployed and spot-checked.
