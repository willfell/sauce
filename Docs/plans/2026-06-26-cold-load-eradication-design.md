# Cycle B — cold-load eradication (design, 2026-06-26)

> Sub-project 1 of the hardening arc (`2026-06-26-hardening-arc-design.md`). Converts the
> recurring cold-load error class (customJS-TDZ entry + `dv.current()`-undefined deref) from a
> runtime bug that ships as PATCHes into a **build-failing preflight gate**. Posture (user
> decision): hard gate now — convert every callsite this cycle; no baseline grandfathering.

## Problem (one paragraph)

On cold vault load, Dataview renders a dataviewjs block before the CustomJS plugin populates
`window.customJS`, and before Dataview has indexed the embedding file. Two throws result:
(1) a bare `customJS.X.Y(...)` callsite hits the TDZ `ReferenceError` (landmines #1–#2); and
(2) `dv.current()` returns `undefined`, so `dv.current().file.path` throws a `TypeError`
("Cannot read properties of undefined") that flashes red on the note. The `customjs-guard`
view already solves (1) at the **render-entry** boundary (87 callsites adopt it). The live,
recurring failure is (2): ~17 bare `dv.current().` derefs inside helper bodies + a handful of
`dv.current()`-in-args inside templates. v0.119.0, v0.132.x, and v0.133.0 each shipped a
point-fix for one instance; nothing stops the next one. This cycle eradicates the class and
gates it.

## Architecture

### 1. New mechanism `render-safe@0.1.0`

One customJS class, the single home for the `dv.current()` fallback. Mirrors the
`section-label` mechanism shape (manifest fields, `depends_on: customjs-guard`, `files[]`).

```
platform/mechanisms/render-safe/
  manifest.json        # name, version 0.1.0, depends_on customjs-guard >=1.0.0,
                       # customjs_classes: ["RenderSafe"], files -> {{scripts_path}}/render-safe/render-safe.js
  render-safe.js       # class RenderSafe { static page/filePath/fileName }
```

**API** (all static; called from helper bodies, where `window.customJS` is already loaded):

- `RenderSafe.page(dv)` → returns `dv.current()` when Dataview has indexed the embedding file;
  otherwise builds a **shim** from `app.workspace.getActiveFile()`:
  `{ file: { path, name /* basename, no ext — matches dv.current().file.name */ },
     ...(app.metadataCache.getFileCache(file)?.frontmatter || {}) }`.
  Returns `null` only when there is no active file at all. The shim carries the frontmatter
  fields helpers actually read (`day`, `workstream`, `source_board`, `project`, `attendees`),
  so a cold first-render resolves to a usable page instead of throwing.
- `RenderSafe.filePath(dv)` → `page(dv)?.file?.path ?? null`.
- `RenderSafe.fileName(dv)` → `page(dv)?.file?.name ?? null`.

Defensive throughout: every property access optional-chained; never throws; returns `null`
sentinels. `dv` itself may lack `.current` (unit-test shims) — guarded with `dv?.current?.()`.

### 2. The gate — `scripts/lint-cold-load.js`

Standalone Node script modeled on `scripts/lint-note-chrome.js` (fence-aware scan, per-line
opt-out, `--self-test` with pass/fail fixtures, exits 1 on violation). Scans
`platform/blueprints/**/{helpers/*.js, templates/*.md, manifest.json}` and
`platform/mechanisms/**/*.js` (excluding `render-safe.js` itself and the `customjs-guard`
view, which legitimately touch these primitives). **No baseline file** — hard gate.

**Rules:**

- **R1 — no bare `dv.current().<deref>` anywhere.** A `dv.current()` immediately followed by
  `.` (dot member access) is a violation. The two sanctioned forms:
  - helper bodies → `customJS.RenderSafe.page(dv)` (preferred — adds the fallback), or
  - any context → `dv.current()?.` optional-chaining (the only option in template blocks,
    where `customJS` is unreachable pre-guard; pairs with an explicit
    `|| app.workspace.getActiveFile()?.x` fallback, the v0.133 meetings pattern).
  Rationale for allowing `?.`: optional chaining cannot throw, which is the entire failure
  mode. A forgotten fallback yields `undefined` (a quiet logic gap), not a red flash (the loud
  bug we are killing). RenderSafe is *preferred* in helpers because it returns a usable value.
- **R2 — no bare `customJS.X.Y(` callsite inside a dataviewjs/template block.** Must route
  through `dv.view("…/customjs-guard", { class: "X", method: "Y" })`. Catches the 3 finance
  stragglers and any future one. (Helper-internal `customJS.X` calls — already inside a guarded
  render — are fine; the rule targets dataviewjs-block/template source only.)
- **Opt-out:** `// lint-cold-load:allow <reason>` (JS) / `<!-- lint-cold-load:allow <reason> -->`
  (markdown) on the offending line or the line directly above. Requires a reason token.

Wired into `release:preflight` (after `lint-note-chrome`) and exposed as
`npm run lint-cold-load`.

### 3. Conversion (all this cycle — the hard-gate blast radius)

**Helper bodies (capture-once pattern).** For each helper, capture the page once near the top
of the render path and deref the local thereafter:

```js
const page = customJS.RenderSafe.page(dv);
if (!page?.file) { /* existing early-return / placeholder */ return; }
// …replace every dv.current().X with page.X…
```

- `project/helpers/project-nav-buttons.js` — 9 derefs (lines 29, 91, 125, 383, 415, 416, 432,
  586, 596). Has a top early-return today; convert to capture-once.
- `scratch/helpers/scratch-leaf-actions.js` — 2 (`dv.current().day`).
- `scratch/helpers/scratch-day-actions.js` — 2 (`dv.current().day`).
- `scratch/helpers/scratch-day-list.js` — 1 (`dv.current().day`).
- `trips/helpers/trip-nav-buttons.js` — 2 (`.file`, `.file.path`).
- `trips/helpers/trip-sections-cards.js` — 1 (`.file.path`).

The scratch helpers already run `_coerceDay` + `_pollForDay`; the capture feeds `page.day` into
the existing poll/coerce path (the poll still covers the Templater race; RenderSafe covers the
cold-load null).

**Template / manifest inline args (optional-chain + fallback).** RenderSafe is unreachable in a
pre-guard dataviewjs block, so use the v0.133 idiom:

- `people/manifest.json` inline_body — 2× `dv.current().file.link` →
  `dv.current()?.file?.link` (PersonNavButtons / PeopleRendering args).
- `people/templates/Template, People.md` lines 28, 37 — same 2× conversion (keep template +
  manifest byte-aligned).
- `scratch/templates/Scratch Day Hub.md:26` — `{ day: dv.current().day }` →
  `{ day: dv.current()?.day }` (ScratchDayList already polls/coerces a missing day).

**Bare `customJS.` stragglers (route through guard view).**

- `finance/templates/Budget Template.md:20`, `Invoice Template.md:27`, `Paycheck Template.md:21`
  — `await customJS.FinanceStatus.renderBadge(dv, "<kind>")` →
  `await dv.view("{{views_path}}/customjs-guard", { class: "FinanceStatus", method: "renderBadge", args: ["<kind>"] })`.
  (Verify `FinanceStatus.renderBadge(dv, kind)` arg order maps to guard's `target.call(klass, dv, ...args)`.)

### 4. Existing-note heal (retireable style — forward handoff to cycle A)

v0.133 already healed meetings' button-written `inline_body` cold-load deref via an install
step. This cycle generalizes it: a single heal that scans materialized notes whose body carries
a bare `dv.current().` in an `inline_body`-origin dataviewjs block and rewrites it to the
optional-chained form. Authored **retireable**: gated behind a top-of-function
`const HEAL_RETIRE_AT = "0.13x.0"` constant + a `// CYCLE-A: register with migration retirement
registry` marker, so cycle A can lift it into the registry and stop running it once consumers
pass the gate. Most render surfaces are template-materialized (refreshed every install) or live
views, so the heal targets only the narrow set of button-created `inline_body` notes (people +
meetings). Idempotent; `.sauce-backup` before write; failure-loud history.

### 5. Tests

- **`platform/test/run-render-safe.js`** (new behavioral harness): loads `RenderSafe`, exercises
  `page/filePath/fileName` against dv stubs — current present, current `undefined`/`null` with an
  active file (fallback shim resolves path + frontmatter), and no active file (returns `null`).
  Asserts no throw in any branch.
- **`run-project-render-guards.js`** (existing) — re-run after the project capture-once refactor;
  extend its widget list / dv variants if the refactor moves a guard. Generalize its stub set as
  the template for a broader render-guard pass if cheap.
- **`scripts/lint-cold-load.js --self-test`** — pass fixture (RenderSafe + `?.` forms + guard
  view) clean; fail fixture (bare `dv.current().file.path`, bare `customJS.X.Y(`) flagged.
  Fixtures under `platform/test/fixtures/lint-cold-load/{pass,fail}/`.
- **`run-helper-cases.js`** — add `HC-V01340-RS-*` source-contract cases: render-safe manifest
  present + catalogued + subscribed; no bare `dv.current().` remains in the converted files.
- Whole-suite `release:preflight` GREEN + workshop dogfood self-install GREEN are the bars.

### 6. Wiring (the coupling that breaks fresh-vault CI if missed)

- `platform/manifest.json` mechanisms[] — add `{ name: "render-safe", version: "0.1.0",
  path: "mechanisms/render-safe" }` (count 21 → 22; no harness asserts a literal 21 — verified).
- `ranch/platform-subscription.json` (workshop dogfood) — subscribe `render-safe@0.1.0`.
- `platform/test/seed-vault/ranch/platform-subscription.json` — subscribe `render-safe@0.1.0`
  (CI's synthetic consumer; `run-seed-migrations` installs it).
- `platform/bootstrap-lib/wizard.js` `DEFAULT_MECHANISMS_CHECKED` — add `render-safe` (the
  v0.122.0 lesson: a default-subscribed blueprint taking a new dep breaks fresh-vault bootstrap
  CI unless the dep is a default-checked mechanism). Verify against `run-bootstrap.js`.
- Blueprints that now call `RenderSafe` (project, scratch, trips) — add
  `{ name: "render-safe", range: ">=0.1.0" }` to each `depends_on`. (people + finance use the
  optional-chain / guard-view forms, not RenderSafe — no dep needed.)
- **Do NOT** hand-bump any version beyond the new mechanism's own 0.1.0 + the catalogue entry it
  requires for `check-version-sync`. The release bumper computes everything else post-merge.
  Conventional commits only.

## Staging (for the implementation plan)

1. **Foundation + wiring** — create render-safe mechanism; wire manifest/catalogue/subscriptions/
   wizard-default/depends_on; run dogfood + `run-bootstrap` + `run-seed-migrations` to prove the
   wiring **before any conversion**. (De-risks the coupling first.)
2. **The failing gate** — write `lint-cold-load.js` + fixtures + self-test + wire into preflight.
   Expect RED against the unconverted tree (proves the gate bites).
3. **Helper conversions** — capture-once across the 6 helper files (parallelizable per blueprint;
   subagents edit files only, no git ops). Re-run render-guard harnesses after each.
4. **Template/manifest + straggler conversions** — people, scratch, finance.
5. **RenderSafe harness + HC cases + existing-note heal.**
6. **Green-up** — `release:preflight` whole-suite GREEN + dogfood GREEN; fix any count/version
   drift the bumper would otherwise catch.
7. **PR** — push `cycle/cold-load-eradication`, open PR, CI green, rebased on main. **Stop. No
   merge, no deploy.**

## Out of scope

- The DataArray-vs-Array landmine (FLN-v67-2) and other render-time classes — the lint is
  structured so they drop in as future rules; not this cycle.
- Migration retirement registry — that is cycle A; this cycle only authors B's heal in the
  retireable style as a handoff.
- Any consumer-vault deploy. Workshop dogfood + CI only.
