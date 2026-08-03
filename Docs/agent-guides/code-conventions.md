---
purpose: Platform-level coding rules for the Sauce workshop. The five non-negotiables, customjs-guard, JSON-not-YAML, template-variables, module-directory invariant.
load_when: Writing or editing any mechanism / blueprint / installer code.
---

# Code conventions

> Authoritative source: `Docs/landmines.md` (22 entries; canonical traps and their rationale). This guide summarizes the rules; `Docs/landmines.md` carries the precedents.

## The five platform non-negotiables

1. **No personal content in the workshop.** Daily notes / personal data live in consumer vaults only.
2. **All mechanisms and blueprints are versioned in `platform/manifest.json`.** Bump on any change to source files. The `check-version-sync.js` gate enforces lockstep between `manifest.json`, `package.json`, and consumer `platform-subscription.json` pins.
3. **All file paths in mechanism / blueprint code use `{{template_variables}}`** — never hardcoded paths. The installer substitutes per-vault from each consumer's `platform-config.json`. Common variables: `{{module_directory}}`, `{{templates_path}}`, `{{scripts_path}}`, `{{views_path}}`.
4. **All platform metadata is JSON, not YAML.** Templater user scripts cannot reach Obsidian's `parseYaml`. Files affected: `platform/manifest.json`, every `mechanisms/*/manifest.json`, every `blueprints/*/manifest.json`, every consumer's `platform-config.json` / `platform-subscription.json` / `platform-installed.json`, every `rules/*.json`. Frontmatter on rendered notes can still be YAML — only platform metadata is locked to JSON.
5. **The five customjs-guard landmines apply to every Dataview view written in this workshop.** See `Docs/landmines.md` #1–#5. Cold-load TDZ ordering is the most common failure mode.
6. **Workshop dogfoods every release.** Workshop self-install must succeed before any consumer push. See [build-test-verify.md](build-test-verify.md).

## Module-directory invariant (BLUEPRINTS ONLY)

Every blueprint owns ONE directory at `spice/<module_directory>/` in the consumer vault. **All files** the blueprint materializes — at install time OR runtime via templates / commands / nav-button actions — live under that one directory. Cross-module data flows via wikilinks only; no module writes into another module's directory.

Each blueprint's manifest declares `module_directory: "<name>"` (required since v0.2.0). Enforced by the installer.

Examples: `spice/boards/`, `spice/to-do/`, `spice/trips/`, `spice/finance/`, `spice/projects/`, `spice/daily/`, `spice/journal/`, `spice/meetings/`.

Mechanisms are exempt — they install under `ranch/...`. See landmine #11 + `Docs/plans/2026-05-03-boards-blueprint-design.md`. The single source-of-truth prefix lives at `install.js:250`.

## CustomJS gotchas

- **`customJS.X` is a singleton instance, not a class constructor.** The customjs plugin auto-instantiates each registered class. Calling `new customJS.X()` fails with `customJS.X is not a constructor`. Use `customJS.X.method()` directly. (Caused FLN-todo-13 in v0.63.0.)
- **Startup-script registration vector matters.** Templater `startup_templates[]` may not fire reliably at consumer boot; customjs `startupScriptNames[]` (`customjs_startup_scripts[]` in manifest) is the L2 fix. v0.48.0 → v0.49.0 cycle history documents the swap.
- **Dataview returns `DataArray`, not `Array`.** Use `.where()` / `.array()` rather than assuming Array methods like `.filter()`. Codebase precedent: `getTasks()` + `cowork-readiness.js`. Bit us in v0.67.x (FLN-v67-2).

## Gesture write lifecycle

User gestures must route frontmatter and vault writes through the instance
method `customJS.RenderSafe.mutate(...)`; a gesture handler must not end in a
bare `processFrontMatter`, `vault.modify`, or `vault.create` write. The shared
lifecycle owns pre-write scroll capture, optimistic UI, failure reversion, and
active/create Dataview reconciliation while leaving background writes to the
platform reconciler. Active forced refresh is opt-in and requires an explicit,
mutation-specific `isCurrent(currentPage, beforePage)` predicate. This predicate
is synchronous and boolean-only: literal `true` authorizes refresh; promises,
thenables, exceptions, and all other values fail closed (rejections are safely
observed). Without that authority, `mutate` completes after the write without
polling or refreshing:
no generic page shape, whole-page semantic delta, volatile file metadata,
unreadable value, hostile key, or raw-frontmatter collision can prove that this
particular mutation was indexed. With `isCurrent`, the lifecycle pre-arms the
metadata signal, polls after the write, refreshes exactly once only when the
predicate returns true, and cleans its bounded wait. Create mode remains
existence-based and never consults active-only `isCurrent`.

Structural inserts and removals use `customJS.RenderSafe.mutateStructure(...)`.
Its `apply()` callback must return an opaque receipt containing the exact nodes,
parents, sibling positions, and focus target needed to undo the visible change;
its `rollback(receipt, error)` callback restores that receipt when persistence
rejects. The adapter delegates to `mutate`, so scroll capture remains the first
effect and the existing write/failure rules still apply. It pins the mutation
to background mode and leaves authoritative cleanup to Dataview's natural
reconciler; caller-provided `mode` or `isCurrent` cannot make
`dataview-force-refresh-views` a structural happy path. See
`platform/mechanisms/render-safe/render-safe.js:125`.

### Dataview correctness findings ledger

PERF-0 baseline, audited at repository revision
`5ca4fcda70ed75c129c0bdb92301381782de01f6`. A “surface” is a production
`customjs-guard` Dataview entry class; repeated template/inline-body invocations
are consolidated under that class. Classes are grouped only when they share the
same query and gesture implementation. Indirect gesture owners are named in the
verdict where a render surface delegates to one. `OK` means the dimension is
already conformant, `GAP` names work owned by a later PERF slice, and `N/A`
means the surface has no operation in that dimension.

| Blueprint | Live Dataview surface(s), with implementation locator | Structural instant update | Scroll / focus | Cold-load | Query efficiency |
| --- | --- | --- | --- | --- | --- |
| Task entity | `TaskNoteView` (`platform/mechanisms/task-entity/task-note-view.js:45`) | **GAP PERF-1** — add and complete issue global refreshes (`:683`, `:746`) instead of optimistic row insertion/removal. | **GAP PERF-1** — capture exists, but the add input and exact row position are not restored. | **OK** — RenderSafe page fallback and malformed-child guards. | **OK** — one bulk child query per render. |
| Task entity | `TaskTodayList` (`task-today-list.js:42`), `TaskDoneTodayList` (`task-done-today-list.js:1`), `TaskProjectList` (`task-project-list.js:40`), `TaskMeetingList` (`task-meeting-list.js:33`), `TaskTripList` (`task-trip-list.js:34`) | **OK** — shared row gestures already remove/revert optimistically; PERF-1 consumes the structural receipt seam for subtask parity. | **OK** — shared row lifecycle captures scroll and keeps row-local state. | **OK** — missing RenderSafe/TaskEntity dependencies bail quietly. | **OK** — one vault-wide task query and one grouped subtask-count query, never per row. |
| Task entity | `TaskChromeBar` (`task-chrome-bar.js:28`) | **N/A** — navigation only. | **N/A** | **OK** — path/context detection is guarded. | **N/A** |
| To-do | `TaskDoneArchive` (`platform/blueprints/to-do/helpers/task-done-archive.js:1`), `TaskRecurringList` (`task-recurring-list.js:27`), `ToDoAllList` (`todo-all-list.js:23`), plus the task-list surfaces above | **OK** — gestures delegate to the shared task row. | **OK** — inherited from the shared row. | **OK** — guarded dependency resolution. | **OK** — one bulk task query per list. |
| To-do | `ToDoDailyProjectGroups` (`todo-daily-project-groups.js:23`), `ToDoDailyTripGroups` (`todo-daily-trip-groups.js:10`), `ToDoDailyUnassignedMeetings` (`todo-daily-unassigned-meetings.js:11`) | **OK** — shared task rows own mutations. | **OK** — inherited from the shared row. | **OK** — missing current page/dependencies render nothing. | **GAP PERF-10** — project grouping performs three broad `dv.pages` passes rather than a shared snapshot; measurement decides whether a follow-on rewrite is warranted. |
| To-do | `TodayCaptureEditableList` (`today-capture-editable-list.js:24`) | **OK** — checkbox uses `RenderSafe.mutate` with exact optimistic/revert callbacks. | **OK** — mutation lifecycle captures before the write. | **OK** — guarded page/container resolution. | **N/A** — body-marker surface, not a Dataview collection query. |
| To-do | `ToDoDailyCarryover` (`todo-daily-carryover.js:22`), `ToDoDailyRecurring` (`todo-daily-recurring.js:39`) | **N/A** — automatic note-body materializers, not interactive collection gestures. | **N/A** — no triggering control or row-local focus. | **OK** — absent current page and parser dependencies fail closed. | **OK** — source-note/body parsing is bounded to the active cadence. |
| To-do | `ToDoChromeBar` (`todo-chrome-bar.js:1`), `ToDoHubActions` (`todo-hub-actions.js:11`), `ToDoLeafActions` (`todo-leaf-actions.js:19`), `Breadcrumb` (`platform/mechanisms/breadcrumb/breadcrumb.js:37`), `SectionLabel` (`platform/mechanisms/section-label/section-label.js:10`), `SpaceNavButtons` (`platform/mechanisms/nav-buttons/space-nav-buttons.js:39`) | **N/A** — chrome/action dispatchers do not themselves render a persisted collection. | **N/A** | **OK** — context and dependency access is guarded. | **N/A** |
| Boards | `BoardsChromeBar` (`platform/blueprints/boards/helpers/boards-chrome-bar.js:8`) | **N/A** — navigation/chrome only. | **N/A** | **OK** — adapter resolution and rendering fail closed. | **N/A** |
| Cowork | `CoworkDailyActions` (`platform/blueprints/cowork/helpers/cowork-daily-actions.js:13`), `CoworkTimeframeButtons` (`cowork-timeframe-buttons.js:16`) | **N/A** — launchers open or create a note and navigate to it; they do not insert into a visible collection. | **N/A** — the launcher surface is replaced by navigation. | **OK** — render-time dependency fallbacks are explicit; gesture failures are noticed. | **N/A** — no collection query. |
| Cowork | `CoworkHubNav` (`cowork-hub-nav.js:13`), `BoardsChromeBar`, `SectionLabel` | **N/A** — navigation/chrome only. | **N/A** | **OK** — current-page and helper access are guarded. | **N/A** |
| Cowork | `CoworkDailyHubCards` (`cowork-daily-hub-cards.js:9`), `CoworkWeeklyHubCards` (`cowork-weekly-hub-cards.js:6`), `CoworkMonthlyHubCards` (`cowork-monthly-hub-cards.js:6`), `CoworkLensShiftCards` (`cowork-lens-shift-cards.js:30`) | **N/A** — read-only cards. | **N/A** | **OK** — embed/container and empty-result paths are guarded. | **OK** — one cadence-scoped bulk query per surface. |
| Cowork | `ActivityFeed` (`platform/mechanisms/activity-feed/activity-feed.js:137`), `CoworkLatestRuns` (`cowork-latest-runs.js:14`), `CoworkReadiness` (`cowork-readiness.js:9`) | **N/A** — read-only activity/status panels. | **N/A** | **OK** — query failures and partial records degrade to empty/fallback output. | **GAP PERF-10** — `ActivityFeed` starts from a vault-wide snapshot (`:446`), while Latest Runs and Readiness repeat the same Cowork scan per orchestrator. |
| Project | `ProjectChromeBar` (`platform/blueprints/project/helpers/project-chrome-bar.js:35`) | **OK** — archive state and project entity creates use `RenderSafe.mutateStructure`; the only force refresh is the explicitly tested localStorage-only sort repaint for a separately owned Dataview container, never a vault-write success path. | **OK** — archive rollback restores exact owned frontmatter fields and triggering focus; creation uses a receipt-bound preview. | **OK** — `RenderSafe.page` and guarded helper resolution own partial/cold state. | **N/A** — chrome does not query a collection. |
| Project | `ProjectStatusWidget` (`project-status-widget.js:9`), `ProjectWorkstreamManager` (`project-workstream-manager.js:10`), `ProjectLinksPanel` (`project-links-panel.js:28`, delegated writes in `project-links-manager.js:103`) | **OK** — status, workstream rows, and link cards apply optimistically through `RenderSafe.mutateStructure` with exact model/node receipts; workstream and Links Hub owners are note-view scoped across separate chrome/content Dataview blocks. | **OK** — rejected writes restore prior values and exact node identities/positions; mutation modals stay mounted with their retry control focused, while non-modal gestures restore triggering focus and RenderSafe preserves scroll. | **OK** — all use guarded RenderSafe page/dependency resolution. | **OK** — bounded frontmatter/link reads. |
| Project | `ProjectDocsIndex` (`project-docs-index.js:33`), `SectionHub` (`section-hub.js:31`), `EpicCreateAction` (`epic-create-action.js:7`) | **OK** — document, section, and epic creates use EntityCreate's optional structural lifecycle; link/rename/delete adapters use `RenderSafe.mutateStructure`, and SectionExplorer awaits them before closing. | **OK** — create rejection removes the exact preview node and restores focus; failed section dialogs remain mounted, focused, and retryable while adapter receipts restore exact models. | **OK** — guarded partial-page reads plus the executable 76-case project render matrix cover undefined, null, file-less, and missing `dv.current`. | **OK** — one scoped project query per docs surface. |
| Project | `ProjectDashboard` (`project-dashboard.js:27`), `ProjectWorkstreams` (`project-workstreams.js:10`), `ProjectsHubCards` (`projects-hub-cards.js:10`), `EpicDashboard` (`epic-dashboard.js:8`) | **OK/N/A** — dashboard status and embedded workstream gestures use `RenderSafe.mutateStructure`; ProjectsHubCards and EpicDashboard are read-only. | **OK/N/A** — mutable rows restore exact values and focus; read-only cards have no gesture lifecycle. | **OK** — RenderSafe or explicit current-page/frontmatter guards. | **GAP PERF-10** — dashboard composition repeats broad page scans (six in `ProjectDashboard`); measurement decides whether a follow-on rewrite is warranted. |
| Project | `ProjectNavButtons` (`project-nav-buttons.js:28`), `ProjectNotesCards` (`project-notes-cards.js:11`), `ProjectReferencedByCards` (`project-referenced-by-cards.js:11`), `SectionLabel`, `TaskProjectList`, `ToDoDailyProjectGroups`, `TodayCaptureEditableList` | **OK/N/A** — wrappers inherit the audited owner named above. | **OK/N/A** — inherited. | **OK** — guarded wrappers. | **OK** except the already-flagged daily project grouping. |
| Finance | `BudgetAllocationsEditor` (`platform/blueprints/finance/helpers/budget-allocations-editor.js:23`), `BudgetCategoriesEditor` (`budget-categories-editor.js:20`), `BudgetDefaultsEditor` (`budget-defaults-editor.js:17`), `DebtDefaultsEditor` (`debt-defaults-editor.js:25`), `PaycheckDefaultsEditor` (`paycheck-defaults-editor.js:16`), `PaycheckExpensesEditor` (`paycheck-expenses-editor.js:18`), `InvoiceControls` (`invoice-controls.js:12`), `InvoiceTimeLogEditor` (`invoice-time-log-editor.js:10`), `FinancePlanDashboard` (`finance-plan-dashboard.js:16`) | **OK** — mutable editors optimistically repaint through `FinanceFrontmatter.mutateRendered`; Plan Apply uses `RenderSafe.mutate`, and rejected dependent writes compensate earlier persistence before the exact prior root is restored. | **OK** — every authoritative self-render routes through a capture-first `_rerender`; rejected writes restore the prior root's focus and input selection receipt. | **OK** — shared guarded page reads and the executable `FF-COLD` matrix cover missing or throwing current-page state across all nine surfaces. | **N/A** — active-note frontmatter surfaces and a bounded Plan view. |
| Finance | `BudgetSummary` (`budget-summary.js:21`), `BudgetsCards` (`budgets-cards.js:10`), `DebtSummary` (`debt-summary.js:20`), `DebtsCards` (`debts-cards.js:11`), `DebtsHubSummary` (`debts-hub-summary.js:16`), `FinanceHubSummary` (`finance-hub-summary.js:22`), `InvoicesCards` (`invoices-cards.js:8`), `MonthDashboard` (`month-dashboard.js:9`), `MonthSetupChecklist` (`month-setup-checklist.js:18`), `MonthlyOverview` (`monthly-overview.js:22`), `MonthsCards` (`months-cards.js:10`), `PaycheckDebtBand` (`paycheck-debt-band.js:26`), `PaycheckSummary` (`paycheck-summary.js:16`), `PaychecksCards` (`paychecks-cards.js:8`), `SavingsCards` (`savings-cards.js:10`), `SavingsSummary` (`savings-summary.js:17`) | **N/A** — read-only summaries/cards. | **N/A** | **OK** — optional/guarded current-page reads. | **OK** — collection surfaces use bounded bulk queries; distinct summary queries are not per-row. |
| Finance | `FinanceChromeBar` (`finance-chrome-bar.js:1`), `FinanceEditScopeBanner` (`finance-edit-scope-banner.js:14`), `FinanceNav` (`finance-nav.js:65`), `FinanceStatus` (`finance-status.js:18`), `InvoiceWorkspaceNav` (`invoice-workspace-nav.js:24`) | **N/A** — chrome/navigation/status display. | **N/A** | **OK** — guarded current-page access. | **N/A** |
| Trips | `TripEntryList` (`platform/blueprints/trips/helpers/trip-entry-list.js:31`) | **OK** — checkbox edits use `RenderSafe.mutate`; add, edit, and delete use `RenderSafe.mutateStructure` with an exact path/key-owned optimistic preview and serialized owner model, so rapid gestures never rebuild from stale Dataview snapshots. | **OK** — rejected structural writes restore the prior model, exact node identities, and triggering focus; queued descendants fail closed after an earlier rejection, and successful writes require no global refresh. | **OK** — guarded page reads and owner-authoritative preview data survive missing-mtime snapshots; only matching Dataview content, a newer Dataview mtime, or an observed same-file metadata-cache generation can rebase authority. An observed cache generation is evaluated first, so neither an intermediate stale mtime nor a matching pre-event snapshot can consume it; temporarily unreadable cache state holds authority and retries the same generation. Shared generations are retained only for weakly owned active authority paths, ignore unrelated changes, retire on convergence, and remain monotonic across cache replacement; replacement ownership is published before best-effort prior-listener cleanup. Iterable DataArray normalization covers partial/cold state. | **N/A** — active trip-frontmatter list. |
| Trips | `TripLinks` (`trip-links.js:23`) | **OK** — insertion and removal use `RenderSafe.mutateStructure` to repaint only the exact path-owned links panel; a serialized owner model preserves rapid follow-up gestures across stale fresh snapshots, and modal rows resolve their unique URL identity against that model at gesture time instead of reusing a frozen index. | **OK** — rejection restores the prior link model, exact grid/card nodes, and a live delete control focus; queued descendants fail closed, Manage links stays mounted until rapid actions settle, and one overlay-owned cancellation token prevents deferred edits from reopening after Done, Escape, backdrop close, or replacement. | **OK** — guarded page reads, empty-owner rendering, and owner-authoritative preview data survive missing-mtime snapshots; the shared active-path metadata tracker evaluates event-proven cache state before intermediate or matching pre-event Dataview snapshots and retries an advanced generation while cache state is temporarily unreadable. It retains cache authority until Dataview converges, bounds retained generations, preserves monotonicity across cache replacement, and makes obsolete callbacks inert even when prior cleanup throws. Iterable DataArray normalization covers partial/cold state. | **N/A** — active trip-frontmatter links. |
| Trips | `TripDashboard` (`trip-dashboard.js:1`), `TripSectionsCards` (`trip-sections-cards.js:1`), `TripsHubCards` (`trips-hub-cards.js:1`), `TaskTripList` (`platform/mechanisms/task-entity/task-trip-list.js:34`) | **OK/N/A** — read-only dashboards; task gestures inherit the shared row. | **OK/N/A** | **OK** — missing page/dependencies bail quietly. | **OK** — one scoped bulk query per collection. |
| Trips | `TripsChromeBar` (`trips-chrome-bar.js:12`), `BacklinkPanel` (`platform/mechanisms/backlink-panel/backlink-panel.js:24`), `SectionLabel` | **N/A** — chrome/read-only display. | **N/A** | **OK** — guarded context resolution. | **OK/N/A** — backlinks use one reverse query. |
| Meetings | `TaskMeetingList` (`platform/mechanisms/task-entity/task-meeting-list.js:33`) | **OK** — shared task-row gestures. | **OK** — inherited. | **OK** — guarded dependencies. | **OK** — one scoped task query. |
| Meetings | `MeetingChromeBar` (`platform/blueprints/meetings/helpers/meeting-chrome-bar.js:1`), `MeetingsBrowseList` (`meetings-browse-list.js:27`), `MeetingsHubCards` (`meetings-hub-cards.js:14`), `PeopleRendering` (`platform/mechanisms/people-rendering/people-rendering.js:17`), `SectionLabel` | **N/A** — read-only chrome/lists. | **N/A** | **OK** — RenderSafe/explicit partial-page guards. | **OK** — bounded bulk meeting/people queries. |
| People | `PeopleChromeBar` (`platform/blueprints/people/scripts/people-chrome-bar.js:1`), `PersonNavButtons` (`person-nav-buttons.js:9`) | **N/A** — chrome and identity navigation only. | **N/A** | **OK** — partial current-page fields and optional chrome presence are guarded. | **N/A** |
| People | `PeopleHubCards` (`people-hub-cards.js:10`) | **N/A** — read-only cards. | **N/A** | **OK** — empty and embed paths render safely. | **OK** — one folder-scoped bulk query. |
| Products | `ProductsChromeBar` (`platform/blueprints/products/scripts/products-chrome-bar.js:10`), `ProductActionButtons` (`product-action-buttons.js:13`) | **N/A** — chrome plus a create-and-navigate launcher, not an in-place collection mutation. | **N/A** | **OK** — chrome resolution fails closed and gesture dependencies are checked. | **N/A** |
| Products | `ProductsHubCards` (`products-hub-cards.js:10`), `ProductPageCards` (`product-page-cards.js:10`) | **N/A** — read-only hub cards and a placeholder leaf panel. | **N/A** | **OK** — embed/empty paths and the placeholder render safely. | **OK** — three bulk snapshots are correlated in memory, never queried per row. |
| Teams | `TeamsChromeBar` (`platform/blueprints/teams/scripts/teams-chrome-bar.js:9`), `TeamActionButtons` (`team-action-buttons.js:13`) | **N/A** — chrome plus a create-and-navigate launcher, not an in-place collection mutation. | **N/A** | **OK** — chrome resolution fails closed and gesture dependencies are checked. | **N/A** |
| Teams | `TeamsHubCards` (`teams-hub-cards.js:12`), `TeamPageCards` (`team-page-cards.js:10`) | **N/A** — read-only hub cards and a placeholder leaf panel. | **N/A** | **OK** — embed/empty paths and the placeholder render safely. | **OK** — two bulk snapshots are correlated in memory, never queried per row. |
| Reader | `ReaderQueue` (`platform/blueprints/reader/helpers/reader-queue.js:42`) | **GAP PERF-6** — queue status uses bare `processFrontMatter` (`:359`) and waits for repaint. | **GAP PERF-6** — row identity and focus are not restored on rejection. | **OK** — current page and dependencies are guarded. | **OK** — one queue query, sorted in memory. |
| Reader | `ReaderArticleView` (`reader-article-view.js:36`), `ReaderChromeBar` (`reader-chrome-bar.js:14`; status writes delegate to `reader-article-actions.js:189`) | **OK/N/A** — article status has optimistic label rollback; view/chrome are otherwise read-only. | **OK/N/A** — lifecycle captures for status. | **OK** — RenderSafe page fallback. | **N/A** — active-note frontmatter. |
| Sticky notes | `StickyChromeBar` (`platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js:1`) | **OK** — title rename uses `RenderSafe.mutate` and exact banner rollback; move/delete remain deliberately navigation/destructive operations, not collection optimism. | **OK** for title; **N/A** for move/delete. | **OK** — RenderSafe page guard. | **N/A** |
| Sticky notes | `StickyDayList` (`sticky-day-list.js:17`), `StickyHubCards` (`sticky-hub-cards.js:15`) | **N/A** — read-only lists. | **N/A** | **OK** — guarded day/current-page access. | **OK** — one or two intentional bulk scans, never per-row. |
| Journal | `JournalChromeBar` (`platform/blueprints/journal/helpers/journal-chrome-bar.js:7`) | **OK** — title rename uses `RenderSafe.mutate` and exact banner rollback; move/delete are deliberately unchanged. | **OK/N/A** | **OK** — RenderSafe page guard. | **N/A** |
| Journal | `JournalDayList` (`journal-day-list.js:17`), `JournalHubCards` (`journal-hub-cards.js:15`) | **N/A** — read-only lists. | **N/A** | **OK** — guarded day/current-page access. | **OK** — bounded bulk scans. |
| Wiki | `WikiTree` (`platform/blueprints/wiki/helpers/wiki-tree.js:1`), `WikiHubActions` (`wiki-hub-actions.js:18`), `WikiLeafActions` (`wiki-leaf-actions.js:14`) | **GAP PERF-8** — create/move operations wait for filesystem persistence and a natural repaint. | **GAP PERF-8** — tree position and triggering focus have no rollback receipt. | **OK** — folder truth and click-time dependency access are guarded. | **OK** — one scoped wiki tree query; move options compute on click. |
| Wiki | `WikiChromeBar` (`wiki-chrome-bar.js:10`) | **N/A** — navigation/chrome. | **N/A** | **OK** — RenderSafe page guard. | **OK/N/A** — one scoped lookup where context requires it. |
| Home | `SpaceHome` (`platform/blueprints/home/helpers/space-home.js:44`) | **GAP PERF-8** — quick task capture self-renders after persistence and retains a global Dataview refresh for day rollover (`:338`). | **GAP PERF-8** — the menu/input is destroyed rather than receipt-restored. | **OK** — cold-start/layout guards and never-throw render path. | **OK** — delegates dashboard data rather than issuing per-card queries. |
| Home | `HomeChromeBar` (`home-chrome-bar.js:13`), `SpaceNavButtons`, `SpaceDailyDashboard` (delegated surface below) | **N/A/inherited** — chrome is read-only; dashboard score is below. | **N/A/inherited** | **OK** — guarded. | **N/A/inherited** |
| Daily | `SpaceDailyDashboard` (`platform/blueprints/daily/helpers/space-daily-dashboard.js:113`) | **GAP PERF-8** — structural create actions do not use an optimistic receipt. | **GAP PERF-8** — no exact focus/position rollback across creates. | **OK** — current-page reads are guarded and the render path is never-throw. | **GAP PERF-8/PERF-10** — ten `dv.pages` call sites repeat broad scans in one composite render. |
| Daily | `DailyChromeBar` (`daily-chrome-bar.js:12`) | **N/A** — navigation/chrome. | **N/A** | **OK** — partial current page is guarded. | **N/A** |

The ledger intentionally distinguishes global refresh used as a structural
shortcut from the Home day-rollover watcher: both remain findings, but only the
former can ever be replaced by `mutateStructure`. Later slices update their
owned rows in place; PERF-9 turns the remaining structural-refresh rule into a
CI check, and PERF-10 supplies measured budgets for the query gaps.

## Skill / command override seam

Direct edits to canonical `.claude/commands/<x>.md` or `.claude/skills/<bp>/**/SKILL.md` in any consumer vault are **REVERTED on next install** per landmine #22. Use `.claude/commands.local/` or `.claude/skills.local/` as the override seam instead. `/audit` surfaces direct-canonical edits as `consumer_edit_at_risk` before work is lost.

## CLAUDE.md marker-bounded regions

The `claude_surface` renderer (in `mechanisms/platform-claude`) rewrites ONLY content between `<!-- @claude-surface:<table> BEGIN/END -->` marker pairs in `CLAUDE.md` (currently three pairs: `resolvers`, `directory-map`, `skills-index`). Outside-marker prose is hand-authored and preserved bit-for-bit.

Touching content inside a marker block without going through the mechanism = your edit gets clobbered on next install. See landmine #12.

## File-path safety

- Never hand-edit consumer `platform-installed.json` (auto-managed; landmine guidance).
- Never hand-edit `pantry/` content in any vault (git-managed snapshot of workshop; landmine #18).
- `.obsidian/` writes are scoped to 18 allowlisted paths (full list in `Docs/landmines.md` #12) — Templater / Slash-Commander / Daily-Notes / Customjs / Dataview / Hotkeys data.json + sauce-namespaced snippets + claude_surface markers. Edits MUST follow landmine #12's safety mechanics: additive-merge-only, backup-on-edit, malformed-JSON guard, failure-loud history.
- Anything outside the allowlist requires user approval before edit. See [asking-before-acting.md](asking-before-acting.md).

## Naming + style

- Conventional-commits format for commit messages (`feat(scope): summary`, `fix(scope):`, `chore(scope):`, etc.).
- Single underscore (`_privateField`), not double, on private class members. The platform uses `_cache` not `__cache` (FLN-b from v0.47.0; renamed in v0.48.0).
- Manifest field ordering: align with existing manifests (project, scratch, to-do) for readability. Drift surfaces as FLN-todo-2 + similar.

## When to read deeper

- All 22 landmines with rationale + history blocks → `Docs/landmines.md`.
- Architecture and installer mechanics → [architecture.md](architecture.md) + `Docs/how.md`.
- Past cycle decisions and platform values → `Docs/cycle-history.md`.

## Dispatcher contracts

| Dispatcher | Loading behavior | What it means for consumers |
| --- | --- | --- |
| customJS (CustomJS plugin) | `customJS.X = new X()` — stores instances | Members called via `customJS.X.method` must be non-static. Static-only utility classes are tolerated (detect-by-shape via `platform/test/run-customjs-contract.js`). |
| Templater (`tp`) | Copies executing in source file context | `tp.file.creation_date(...)` resolves against the SOURCE file, not the destination. Always render template-injected values before scaffolding. |
| installer (`runInstall`) | Subprocess-spawning | Cannot share in-process state with caller. Errors propagate via exit codes + stdout; the calling process must catch + surface them. |

Adding a new dispatcher consumer: grep the dispatcher's loader code (e.g., search for `customJS`
assignment patterns or Templater's `evaluate` invocation), then read one working consumer to
confirm the contract before authoring the new one. v0.93.3 / v0.94.0 / v0.118.0 each paid this
tax by not.

See also: landmine #28.

## Stable anchors vs display markers

Parsers MUST NOT key on display-mutable markers (headings, SectionLabel text labels) that future
cosmetic migrations may rewrite. Instead, key on stable anchors:

- HTML comments — `<!-- recurring-entries -->`, `<!-- recurring-materialized-... -->`
- Frontmatter fields — `recurring_section_start: true`
- Block-ids — `^todo-recur-abc123`
- Native dataviewjs invocations (whose code never changes shape)

Display markers (FLAGGED by `scripts/lint-display-markers.js`):

- `^# `, `^## `, `^### ` heading regex
- SectionLabel text labels (e.g., `text: "Recurring Tasks"`)
- Markdown formatting characters used as section delimiters

Migrations legitimately match old display forms (in `platform/migrate/`); those files are
excluded from the lint by default. Opt-out marker for individual lines:
`// lint-display-markers:allow <reason>`.

Source: v0.118.1 cycle postmortem item #4 (parseRegistry kept matching `## Recurring Tasks`
after v0.117.0 rewrote that H2 to a SectionLabel block).
