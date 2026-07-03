# Performance / seamlessness arc — result (v0.187.1 → v0.191.0)

**Closed:** 2026-07-03
**Design/plan docs:** `2026-07-03-seamless-task-actions-{design,plan}.md`, `2026-07-03-sauce-plugin-load-flash-{design,plan}.md`, `2026-07-03-plugin-render-reconciler-{design,plan}.md`.

A six-release arc making the Obsidian experience feel seamless — driven by two adversarially-verified research fleets (a root-cause fleet on the 3 stated pains, then an exhaustive static perf-audit fleet). Every release shipped end-to-end (TDD → PR → CI-green squash-merge → auto-release → tap → `deploy.js` to ero/accuris/headspace) and was code-verified on the live vaults.

## Root causes (confirmed against the installed Dataview `main.js`)
- **Load flash:** `customjs-guard` polls `window.customJS` up to ~2s because Dataview renders before the CustomJS plugin registers.
- **Write "second pause":** writes only reconcile on Dataview's `refreshInterval:2500` debounce; the re-render gate is `lastReload != index.revision && container.isShown()`.
- **Scroll reset:** Dataview's re-render tears down the block (`innerHTML=""`) → Reading-view re-layout resets scroll; plus a self-reopen on create/edit.
- **Home "Friday":** NOT a date-math bug (`_humanDate` proven correct) — the refresh gate means a quiet vault never re-runs the clock-only Home block on a new day → frozen snapshot.

## Releases
| Version | PR | What |
|---|---|---|
| **v0.187.1** | #291 | Seamless task actions: L2 optimistic row removal on complete; L4 metadataCache-gated force-refresh after add; L3 `RenderSafe.captureScroll` (snapshot+restore, fixed a real premature-nudge disconnect bug caught by an async cert); L10 no self-reopen of the active note; L-HOME `active-leaf-change` day-refresh watcher. |
| **v0.189.1** | #303 | `SpaceDailyDashboard._getActivityCount` fused its two vault sweeps into one + memoized rollup scoped-query by slug; `SpaceNavButtons` gates the day-arrow `getMarkdownFiles()` sweep to daily notes (folder-path predicate) + caches the registry read. |
| **v0.190.0** | #305 | **Native plugin (`sauce-plugin` mechanism)** — registers customJS classes on `window.customJS` at `onload()` (kills the cold-load flash for all ~75 widgets, zero renderer edits); vendored into `.obsidian/plugins/sauce/` + enabled by new installer step `applyBundledPlugin`. CustomJS stays enabled as the fallback → cannot regress. |
| **v0.190.1** | #307 | Tech-debt cleanup: `applyBundledPlugin` stamps the mechanism version into the vendored plugin manifest; the plugin resolves its scripts folder from CustomJS's `jsFolder`; deleted orphan `planning-board-projects.js`; documented `bundled_plugin`/`applyBundledPlugin` + the RESTART requirement in `architecture.md` + `build-test-verify.md`. |
| **v0.190.2** | #310 | Dashboard single sweep (2→1): new `ActivityFeed.query()` + `precomputed` render lets the dashboard obtain the activity pages once (gate + accent + cards from one sweep); cowork's 4 activity blocks unchanged. |
| **v0.191.0** | #312 | Plugin render reconciler: debounced (~500ms) `metadataCache`/`vault` listener fires Dataview's own scoped force-refresh for changes to files OTHER than the actively-edited one → background changes reconcile ~5× faster; Dataview stays renderer + 2.5s backstop → cannot regress. |

## New/changed platform surface
- **NEW mechanism `sauce-plugin`** (bundled first-party Obsidian plugin) — mechanism count 25 → 26.
- **NEW installer step `applyBundledPlugin`** + the `bundled_plugin: {id, source_dir, files}` manifest field.
- **`RenderSafe.captureScroll`** (scroll preservation primitive).
- **`ActivityFeed.query()`** + `precomputed` render short-circuit.
- New harnesses: `run-daily-dashboard.js`, `run-sauce-plugin.js` (PL/BP/RC/PL-RESOLVE families); extended `run-render-safe`, `run-task-entity`, `run-nav-launcher`, `run-todo-dialog`, `run-home`, `run-activity-feed`.

## Lessons
- **The Dataview refresh gate (`lastReload != index.revision && isShown()`) is the master key** — it explains the load flash, the write pause, and the Home freeze; the force-refresh COMMAND (`dataview:dataview-force-refresh-views`) bumps revision unconditionally (the bare `dataview:refresh-views` trigger no-ops before re-index — don't use it).
- **Verify timing-sensitive DOM logic against real async, not just synchronous stubs** — the L3 async cert caught a premature-nudge disconnect that the synchronous unit test missed.
- **A bundled plugin needs a full Obsidian RESTART (not Cmd+R) to load; a new mechanism needs per-vault subscription + `sauce update --force`** (deploy.js only bumps existing pins) — see `lesson_new_blueprint_needs_consumer_subscription`.
- **Safe-by-construction is how a risky live-vault change ships first-go:** the plugin keeps CustomJS as the fallback; the reconciler keeps Dataview's 2.5s refresh as the backstop + skips the active-edit file. Worst case = today's behavior.

## Deferred (deliberately)
- **Retire `project-referenced-by-cards.js`** — still manifest-declared + 4 tests + coverage-matrix + seed install-record; removal needs a **reviewed seed rebaseline** (its own PR). Pre-existing debt the project manifest scheduled "a later cycle".
- **Targeted single-block re-render** (re-render only the changed block vs the shown view) — no fallback, not headlessly verifiable, double-render coexistence with Dataview; the safe debounced reconciler (v0.191.0) delivers the felt win instead.

## Verification
All releases: full `release:preflight` green + `release:preflight-bumped` PASS before merge; `deploy.js run` `allOk:true`; deployed code grep-verified on all 3 vaults (optimistic-remove, captureScroll, reconciler, version-stamp, single-sweep dashboard). Absolute per-render ms savings are estimated (small vaults); would need live `performance.now()` to quantify.
