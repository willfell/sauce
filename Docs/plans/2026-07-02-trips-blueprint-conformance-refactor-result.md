---
date: 2026-07-02
phase: result
status: shipped-pending-release
blueprint: trips
scope: headspace-only
related:
  - 2026-07-02-trips-blueprint-conformance-refactor-design.md
  - 2026-07-02-trips-blueprint-conformance-refactor-plan.md
---

# Result — Trips blueprint conformance refactor

Brought the `trips` blueprint into vault-wide conformance in one cycle: breadcrumb chrome, `SectionLabel`-owned dividers, a primary + "Go to…" launcher nav, **collision-free note naming**, canonical section frontmatter, a schema-registry entry, an install heal for all existing trips, and canonical docs. Version bump is pipeline-computed (trips 0.4.0 → MINOR).

## What shipped

- **Collision-free naming.** Atlas `Trip Atlas.md` → `<Trip Name>.md`; sections `Trip Flights.md` → `<Trip Name> — Flights.md`. Fixes the ambiguous-basename problem (every trip previously shipped identical `Trip Atlas.md` / `Trip Flights.md` names → broken `[[wikilinks]]`, muddy graph, duplicate quick-switcher entries). Behavior is now frontmatter-driven, not filename-driven.
- **`TripSectionKinds` registry** (`helpers/trip-section-kinds.js`, `customJS.TripSectionKinds`) — single source of truth for the 5 default kinds' label/icon/order + legacy-basename mapping. Consumed by both `TripNavButtons` and `TripSectionsCards`, which fixes the pre-existing drift bug (the two helpers disagreed on basenames: `"Trip Flights"` vs `"Flights"`).
- **Canonical section frontmatter** — `type: trip-section`, `section_kind` (enum), `section` (display), `trip` (`[[atlas]]`), `trip_slug`, `created_at` (replaces legacy `created:`).
- **`TripNavButtons` rewrite** — a "Trip" band + a full-width primary button back to the atlas + a single "Go to…" dropdown launcher (ported from `SpaceNavButtons`: document.body overlay, mobile bottom-sheet / desktop dropdown, single teardown), listing other sections (ordered by `section_kind`) → Trip Board → "+ New Section".
- **`TripSectionsCards`** now groups by `section_kind` frontmatter (fixes the basename mismatch).
- **Breadcrumb adoption** — manifest `breadcrumb` block (ancestors-mode): Trips › ‹Trip› › ‹Section›. Chrome order Breadcrumb → SpaceNavButtons → TripNavButtons → content; managed `## All Trips` / `## Mentions` → `SectionLabel`. Board (`type: kanban`) is out of breadcrumb scope (would collide with the project board type) and keeps its `## Column` kanban headings.
- **Install heal `applyTripsConformanceHeal`** — renames existing trips' notes collision-free, canonicalizes section frontmatter, injects the Breadcrumb block, converts managed H2 → SectionLabel, repairs `[[Trip Atlas]]` links. Per-trip `.sauce-backup/trips/<slug>/<ts>/`, idempotent (2nd run writes 0 files, verified), never throws (per-trip try/catch → history warnings).
- **Rules + schema** — manifest `rule_fragments` converted to `frontmatter_branch` (filename-independent, projects precedent); `platform/schemas-index.json` gains a trips entry (lint-schemas green).
- **Docs** — `Docs/agent-guides/trips-blueprint.md` (canonical reference) + `Docs/agent-guides/smoke-checklists/trips.md`; wired into the CLAUDE.md router.

## Verification

- `release:preflight` — **whole suite green (exit 0)**.
- `release:preflight-bumped` — **PASS** (no hardcoded version literal wedges `prepare-release`).
- New/updated harnesses: `run-trips.js` 27/0 (added TSK/NAV/CREATE/SECTIONS cases), `run-trips-heal.js` **37/0** (dedicated heal harness incl. idempotency + `$`-name + collision regressions), `run-seed-migrations.js` **371/371** (added 14 end-to-end `HC-TRIPS-SEED-*` sentinels + a pre-refactor fixture), `run-helper-cases.js` 3905/0, `run-customjs-loadable.js` clean, `lint-schemas` 0 issues.
- Workshop self-install dogfood: exit 0, zero trips-related error/skip entries.

## Surfaces hit / lessons

- **`trips-hub` breadcrumb type needs `ancestors: []`.** The install-time breadcrumb aggregator (`applyBreadcrumb`) rejects a non-`path_walk` type with a missing/non-array `ancestors` (logs `event:"error"` → non-zero install → red CI). Current-only types still need `ancestors: []`. Caught by running the seed install directly (NOT by trusting a subagent's "it's pre-existing" claim — it wasn't).
- **`String.replace`/`replaceAll` interpret `$&`/`$$` in the replacement string.** A trip named `Cash $$ Run` corrupted frontmatter/links (both the heal helpers and the create-flow `makeSubs`). Fix: function replacers (`() => value`), which emit verbatim. Applies to any heal that injects user free-form text via `.replace()`.
- **Heal rename targets can collide.** Two sources computing the same `<atlas> — <Section>.md` would clobber (only the backup survives). Added an in-plan de-collision guard (` (N)` suffix + history warning).
- **Idempotency for a rename heal must key on frontmatter, not the (already-renamed) basename.** Re-deriving `section_kind` from `<atlas> — Flights` would misclassify as `custom`; the heal prefers the note's own `section_kind`/`section` when present.

## Carry-forward

- Deploy to headspace (only subscriber) after the release ships; user Cmd+R. accuris/ero receive the new workshop version but no trips content (not subscribed).
- `cycle-history.md` / `cycle-status.md` regen deferred to the pipeline/autoloop (avoids rebase churn against the active loop); versions are pipeline-computed.
- Old trips whose Atlas body packs content as `## H2` (e.g. `daves-wedding`) are intentionally left as-is (content-org out of scope) — only chrome + names + frontmatter were healed.

## Commits

14 commits on `cycle/trips-conformance` (design → plan → 10 implementation tasks → breadcrumb-aggregator fix → FA6 test re-route → `$`/collision review fixes).
