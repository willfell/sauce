---
arc: test-coverage-arc
phase: audit
generated_against_workshop_version: 0.118.1
rubric_version: 1.0.0
---

# Test coverage audit

Coverage matrix for all blueprints + mechanisms scored against the 6-axis rubric in `Docs/plans/2026-06-16-test-coverage-arc-design.md`. Ranked queue at the bottom drives impl-1/2/3 selection.

## Composite scorecard

| Kind | Name | v | CustomJS | Migration | Manifest+Schema | Template | Widget | Smoke | Composite | Blast | Incidents 30d | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
 | blueprint | cowork | 0.40.2 | 0.00 (0/9) | n/a | 0.83 | 1.00 (26/26) | 0.00 (0/9) | 1.00 | 0.57 | high | 103 | 2.00 | 
 | blueprint | project | 1.22.1 | 0.21 (4/19) | 0.00 (0/5) | 1.00 | 1.00 (15/15) | 0.21 (3/14) | 1.00 | 0.57 | high | 32 | 2.00 | 
 | blueprint | finance | 0.9.2 | 0.42 (19/45) | 0.00 (0/23) | 1.00 | 1.00 (15/15) | 0.38 (10/26) | 1.00 | 0.63 | high | 10 | 2.00 | 
 | blueprint | daily | 0.13.6 | 0.00 (0/1) | n/a | 0.92 | 1.00 (2/2) | 1.00 (1/1) | 1.00 | 0.78 | high | 34 | 2.00 | 
 | mechanism | entity-create | 0.7.2 | 1.00 (2/2) | 0.00 (0/1) | 0.92 | n/a | 1.00 (1/1) | 1.00 | 0.78 | high | 6 | 2.00 | 
 | blueprint | meetings | 0.8.0 | 0.00 (0/1) | n/a | 0.92 | 1.00 (4/4) | 0.00 (0/1) | 1.00 | 0.58 | high | 4 | 1.80 | 
 | blueprint | scratch | 0.5.2 | 0.13 (1/8) | n/a | 0.92 | 1.00 (4/4) | 0.00 (0/5) | 1.00 | 0.61 | high | 6 | 1.75 | 
 | blueprint | to-do | 0.6.1 | 0.80 (28/35) | 0.20 (1/5) | 1.00 | 1.00 (5/5) | 0.00 (0/7) | 1.00 | 0.67 | high | 15 | 1.60 | 
 | blueprint | products | 0.3.0 | 0.00 (0/3) | n/a | 0.92 | 1.00 (2/2) | 0.00 (0/3) | 1.00 | 0.58 | med | 5 | 1.20 | 
 | blueprint | people | 0.6.0 | 0.00 (0/2) | n/a | 1.00 | 1.00 (2/2) | 0.00 (0/2) | 1.00 | 0.60 | med | 4 | 1.08 | 
 | mechanism | platform-claude | 0.1.3 | n/a | n/a | 0.75 | n/a | n/a | 0.00 | 0.38 | high | 2 | 1.05 | 
 | mechanism | smart-connections-bridge | 0.2.0 | n/a | n/a | 0.50 | n/a | n/a | 0.00 | 0.25 | med | 2 | 0.63 | 
 | mechanism | backlink-panel | 0.1.0 | 0.00 (0/1) | n/a | 0.58 | n/a | 0.00 (0/1) | 0.00 | 0.15 | med | 0 | 0.60 | 
 | mechanism | nav-buttons | 2.7.0 | 0.00 (0/1) | 0.00 (0/1) | 0.83 | n/a | 1.00 (1/1) | 1.00 | 0.57 | med | 0 | 0.60 | 
 | blueprint | journal | 0.2.0 | n/a | n/a | 0.70 | 1.00 (2/2) | n/a | 0.00 | 0.57 | med | 0 | 0.45 | 
 | blueprint | trips | 0.3.0 | 0.00 (0/4) | n/a | 0.83 | 1.00 (10/10) | 0.00 (0/3) | 1.00 | 0.57 | low | 1 | 0.36 | 
 | mechanism | convenience | 0.4.1 | n/a | n/a | 0.50 | n/a | n/a | 0.00 | 0.25 | low | 2 | 0.32 | 
 | mechanism | icons | 0.1.1 | 1.00 (1/1) | n/a | 0.75 | n/a | 1.00 (1/1) | 0.00 | 0.69 | low | 2 | 0.32 | 
 | mechanism | people-identity | 0.1.0 | 0.00 (0/4) | n/a | 1.00 | n/a | n/a | 0.00 | 0.33 | low | 0 | 0.30 | 
 | blueprint | teams | 0.3.0 | 0.00 (0/3) | n/a | 0.92 | 1.00 (2/2) | 0.00 (0/3) | 1.00 | 0.58 | low | 0 | 0.30 | 
 | mechanism | customjs-guard | 1.0.0 | n/a | 0.00 (0/1) | 0.75 | 1.00 (1/1) | n/a | 1.00 | 0.69 | low | 0 | 0.30 | 
 | mechanism | kanban-status-sync | 0.2.0 | 0.67 (4/6) | n/a | 0.58 | n/a | n/a | 0.00 | 0.42 | low | 1 | 0.27 | 
 | mechanism | people-rendering | 0.1.0 | 1.00 (4/4) | n/a | 0.50 | n/a | 1.00 (1/1) | 0.00 | 0.63 | low | 0 | 0.22 | 
 | mechanism | audit | 0.3.0 | n/a | n/a | 0.83 | 1.00 (1/1) | n/a | 1.00 | 0.94 | high | 7 | 0.17 | 
 | mechanism | activity-feed | 0.7.1 | 1.00 (1/1) | n/a | 0.75 | n/a | 1.00 (1/1) | 1.00 | 0.94 | med | 14 | 0.15 | 
 | mechanism | validator | 0.3.0 | n/a | n/a | 0.83 | 1.00 (1/1) | n/a | 1.00 | 0.94 | high | 1 | 0.10 | 
 | blueprint | boards | 0.2.1 | n/a | n/a | 0.70 | 1.00 (2/2) | n/a | 1.00 | 0.90 | low | 1 | 0.05 | 
 | mechanism | accent-button | 0.1.1 | 1.00 (1/1) | n/a | 0.75 | n/a | 1.00 (1/1) | 1.00 | 0.94 | low | 1 | 0.04 | 
 | mechanism | styling | 0.2.1 | n/a | n/a | 0.80 | n/a | n/a | 1.00 | 0.90 | low | 0 | 0.03 | 
 | mechanism | cards | 0.2.6 | 1.00 (1/1) | n/a | 1.00 | n/a | 1.00 (1/1) | 1.00 | 1.00 | low | 9 | 0.00 | 

## Per-surface deep dive

### blueprint/cowork (v0.40.2)
- Blast radius: **high** — Active arc with cross-machine state; recent migrations every cycle.
- Composite: **0.57** · Priority: **2.00** · Incidents 30d: 103
- Primary flow (Axis 6 grounding): Engagement-aware daily/weekly/monthly orchestrators gather cross-MCP signals and synthesize atomic notes rendered via cowork helper classes.
- Qualitative recommendation: True coverage is much higher than 0.0 scores suggest; cowork-smoke is comprehensive at structural level. Closing rubric gap could come from either migrating widget asserts to run-renderer.js OR adding explicit method-call patterns to cowork-smoke to match the grep heuristic.
- False negatives: customjs_behavioral: run-cowork-smoke.js (954 asserts) validates class declarations + manifest contracts + hub-file usage but does not pattern-match grep heuristic; actual render() invocation only at runtime; widget_render: 9 customjs widgets exercised in cowork-smoke via structural asserts; run-renderer.js has no cowork fixtures
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-cowork-coworkdailyhubcards.js`

### blueprint/project (v1.22.1)
- Blast radius: **high** — Docs hub + sections + section hubs + search arc; load-bearing.
- Composite: **0.57** · Priority: **2.00** · Incidents 30d: 32
- Primary flow (Axis 6 grounding): Create a new project via entity-create button -> scaffold project folder + docs/knowledge + docs/notes section hubs -> add doc-notes to sections with Breadcrumb navigation + DocSearch filter.
- Qualitative recommendation: Frontloaded on manifest + template lockstep (both 1.0) but severely under-covered on behavioral execution and migrations. The 5 project-specific installer migrations receive only static source checks, not functional validation against vault adapters. Impl-1 candidate: target installer_migration (0/5) with HC-V0XYZ-PROJ-SEED-MIGRATE families for the three most-recent migrations (applyProjectSectionsMigration, applyProjectSectionsHubMigration, applyProjectTodoBackfill).
- False positives: installer_migration: Source-checks (HC-V01020-PSM-1, HC-V01030-PSHM-1) verify function declaration but not execution; all 5 project migrations are structurally untested
- False negatives: customjs_behavioral: 12 classes lack behavioral asserts: ProjectNavButtons, ProjectWorkstreams, ProjectsHubCards, ProjectNotesCards, ProjectReferencedByCards, ProjectTaskCreateListener, ProjectStatusWidget, ProjectDocsSections, ProjectDocsCards, DocSearch, SectionHub, ProjectWorkstreamManager; widget_render: 10 widget classes with render() methods lack run-renderer.js fixtures: ProjectNavButtons, ProjectWorkstreams, ProjectsHubCards, ProjectDocsCards, ProjectDocsSections, ProjectDocsIndex, SectionHub, DocSearch, ProjectStatusWidget, ProjectWorkstreamManager
- Top gap: axis=`installer_migration` archetype=`seed-migrate` target=`platform/test/run-seed-migrations.js`

### blueprint/finance (v0.9.2)
- Blast radius: **high** — v0.108-v0.115 rapid evolution; load-bearing schemas + measured-debt math.
- Composite: **0.63** · Priority: **2.00** · Incidents 30d: 10
- Primary flow (Axis 6 grounding): Create a budget note, view monthly overview dashboard of income/spending/debt paydown metrics, edit debt defaults, and track paycheck expenses with debt-account linking.
- Qualitative recommendation: Solid behavioral coverage on high-cycle helpers (MonthlyOverview, FinanceMath, _injectMonthlyBand). Installer migrations lack isolation asserts. Priority: (1) Add HC-V0XYZ-SEED-MIGRATE-* families for 5-10 critical apply* functions (applyFinanceDefaultsScaffolding, applyFinanceDebtScaffolding, applyFinanceBudgetGroupSeed, applyFinancePaycheckDefaultsDebtLinking, applyFinanceMigrations); (2) extend behavioral coverage to remaining widget renderers.
- False negatives: installer_migration: Score 0.0 is technically correct (no HC-V0XYZ-SEED-MIGRATE families) but SHAPE-*/FM-*/BODY-* families in run-seed-migrations.js verify post-state of the 20 apply* functions via integration. This is weak signal coverage (proves execution, not per-function correctness).; customjs_behavioral: Score 19/45 = 42% is accurate but 12+ finance widget classes (DebtsHubSummary, DebtDefaultsEditor, BudgetDefaultsEditor, PaycheckDefaultsEditor, BudgetsCards, PaychecksCards, InvoicesCards) ship with zero behavioral coverage despite being DOM-heavy with state logic.
- Top gap: axis=`installer_migration` archetype=`seed-migrate` target=`platform/test/run-seed-migrations.js`

### blueprint/daily (v0.13.6)
- Blast radius: **high** — Every consumer hits daily notes; touched by carryover + recurring.
- Composite: **0.78** · Priority: **2.00** · Incidents 30d: 34
- Primary flow (Axis 6 grounding): Open daily note -> dataviewjs evaluates SpaceDailyDashboard.render(dv) -> panels for tasks, meetings, activity display without throwing.
- Qualitative recommendation: Current test architecture mismatch: blueprint requires behavioral-runner with full dataviewjs surface stub, not renderer-extend pattern. Either upgrade scorer to invoke render() with mocked dv, or create dedicated behavioral runner.
- False positives: widget_render: Substring 'SpaceDailyDashboard' matches in comments/test names but render() method is never actually invoked under DOM stub.
- False negatives: customjs_behavioral: Render() is unreachable via current test harness pattern; would require fuller integration test with seeded vault + dataviewjs shim invoking dv.view(customjs-guard).
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-daily-spacedailydashboard.js`

### mechanism/entity-create (v0.7.2)
- Blast radius: **high** — Every + New button uses it; v0.94 + v0.102 + v0.108 evolution.
- Composite: **0.78** · Priority: **2.00** · Incidents 30d: 6
- Primary flow (Axis 6 grounding): Click EntityCreate-rendered button in hub note -> prompts loop -> frontmatter template hydration + seed_from_defaults injection -> create new note at routed destination -> open in editor
- Qualitative recommendation: Strong on pure logic (customjs_behavioral 1.0, schema 0.917, widget 1.0) but critical gap in installer_migration (0.0). The two apply* fns run on every install and materialize the registry or rewrite vault notes; their behavior must be directly asserted in the seed harness. Single gap carries high blast radius (installs touch every vault).
- False negatives: installer_migration: applyNewEntityButtons + applyEntityCreateGuardMigration untested in seed harness; no HC-V0XYZ-SEED-MIGRATE family covers registry materialization or guard-form rewrite logic; manifest_schema: render_in.kind='nav_buttons' deferred case not explicitly asserted; minor schema coverage gap
- Top gap: axis=`installer_migration` archetype=`seed-migrate` target=`platform/test/run-seed-migrations.js`

### blueprint/meetings (v0.8.0)
- Blast radius: **high** — Linked from project + cowork; recent project-link migration.
- Composite: **0.58** · Priority: **1.80** · Incidents 30d: 4
- Primary flow (Axis 6 grounding): User creates a meeting note via new-meeting button (entity-create v0.5.0 integration) with optional project link; Meeting Hub renders today's meetings as cards with project pills, attendee chips, task badges via MeetingsHubCards.render().
- Qualitative recommendation: Well-covered on template lockstep + manifest schema, but widget_render axis is critical gap. MeetingsHubCards.render() is the primary user-facing component (displays cards, filters by date, enriches async file reads, renders project pills, delegates to BeaconCards). Zero behavioral tests means layout/enrichment/pill bugs would ship. Single MEET-3 case in run-helper-cases.js (or run-renderer.js fixture) would unlock both axes to 1.0.
- False positives: widget_render: MeetingsHubCards listed in customjs_classes[] but render() never instantiated or called with stub DOM
- False negatives: customjs_behavioral: MeetingsHubCards.render(dv) is never invoked in any test harness; method signature verified statically but no behavioral assertions on rendered DOM, async data enrichment, or BeaconCards delegation with project-pill meta
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-meetings-meetingshubcards.js`

### blueprint/scratch (v0.5.2)
- Blast radius: **high** — Daily hits; carries todo capture surface.
- Composite: **0.61** · Priority: **1.75** · Incidents 30d: 6
- Primary flow (Axis 6 grounding): User opens Scratch nav-button -> day-hub created or opened -> ScratchDayActions renders '+ New Scratch' and 'Hub' buttons -> entity-create collects title -> new Scratch leaf with ScratchLeafActions buttons.
- Qualitative recommendation: Test debt is material despite high template/integration scores. Recommend: (1) add template-assert HC family for 3 template files; (2) extend run-renderer.js with ScratchDayList + ScratchHubCards fixtures; (3) add behavioral-runner for ScratchDayActions + ScratchLeafActions render() to cover vault read/Notice/workspace orchestration.
- False positives: customjs_behavioral: run-scratch.js tests private _coerceDay and _migrateFrontmatter via HC-V0841-* families; deterministic scorer counts only public methods. Public render() on 5 of 7 classes never harnessed.; widget_render: run-renderer.js covers R-SCRATCH-DAYHUB (nav-button dispatch) but does NOT render ScratchDayList or ScratchHubCards widgets.
- False negatives: customjs_behavioral: ScratchDayActions.render(), ScratchLeafActions.render(), ScratchHubActions.render() have zero behavioral harness; ScratchDayList.render() + _extractPreviewFromBody + _pollForDayArg untested under stub Obsidian app
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-scratch-scratchhubcards.js`

### blueprint/to-do (v0.6.1)
- Blast radius: **high** — Multi-cycle storm v0.116-v0.118; highest recent-incident rate.
- Composite: **0.67** · Priority: **1.60** · Incidents 30d: 15
- Primary flow (Axis 6 grounding): Create daily to-do via nav button -> carryover yesterday's tasks -> view recurring registry materialization -> add/complete tasks via new dialog -> browse all-to-dos aggregator.
- Qualitative recommendation: Two implementation cycles candidate: (1) HC-V0XYZ-SEED-MIGRATE-PROJECT-TODO family in run-seed-migrations.js extending seed-vault with pre-v0.4.0 project structure; (2) extend run-renderer.js with 7 to-do widget fixtures.
- False positives: customjs_behavioral: Score 0.800 (28/35) overstates coverage. Five dedicated runners exist but test only 10 of 11 classes (ToDoHubActions, ToDoLeafActions, ToDoAllList, ToDoCreateTaskInit untested).
- False negatives: installer_migration: applyProjectTodoBackfill (v0.4.0 project-todo backfill) has zero seed-migrate coverage; only applyToDoBlueprintMigration is tested via HC-V01174-MIGRATE-*; widget_render: All 7 render-capable classes (ToDoHubActions, ToDoLeafActions, ToDoAllList, ToDoDailyCarryover, ToDoDailyRecurring, ToDoDailyProjectGroups, ToDoDailyUnassignedMeetings) absent from run-renderer.js. Most critical widget gap for a high-blast-radius blueprint.
- Top gap: axis=`installer_migration` archetype=`seed-migrate` target=`platform/test/run-seed-migrations.js`

### blueprint/products (v0.3.0)
- Blast radius: **med** — Consumer-vault hub; relatively static.
- Composite: **0.58** · Priority: **1.20** · Incidents 30d: 5
- Primary flow (Axis 6 grounding): Create a product via /products or + New Product -> product note materializes with ProductPageCards + SpaceNavButtons + BacklinkPanel -> hub aggregates member teams and active projects.
- Qualitative recommendation: Weak behavioral coverage despite high composite score. All three classes have non-trivial render() methods integrating Dataview queries + Obsidian plugin APIs + cross-blueprint rollups. Recommend extending run-renderer.js with ProductsHubCards + ProductActionButtons fixtures.
- False positives: template_lockstep: Asserts only file existence and frontmatter naming; does not verify ProductPageCards/SpaceNavButtons/BacklinkPanel class invocations or template syntax validity; manifest_schema: 0.917 is high but missing assertions for depends_on[], claude_surface[], templater_folder_templates[], post_install[]
- False negatives: customjs_behavioral: ProductActionButtons.render() Templater dispatch + onClick handler codepath untested; ProductsHubCards dataview filtering + sorting logic untested
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-products-productshubcards.js`

### blueprint/people (v0.6.0)
- Blast radius: **med** — Cross-cutting via people-identity; stable shape.
- Composite: **0.60** · Priority: **1.08** · Incidents 30d: 4
- Primary flow (Axis 6 grounding): Open People.md hub (PeopleHubCards renders person cards), click a person, view person note (PersonNavButtons renders identity + back-button, PeopleRendering shows mentions), click back to People Hub.
- Qualitative recommendation: Gaps partially mitigated by delegation to tested mechanisms. A renderer-extend harness adding PeopleHubCards + PersonNavButtons to run-renderer.js would close widget_render and surface any orchestration bugs.
- False positives: integration_smoke: Claims 1.0 (both happy + failure modes) but neither PeopleHubCards nor PersonNavButtons render methods directly tested; only indirectly via integration smoke.
- False negatives: widget_render: Both customjs classes have render() methods but zero coverage in run-renderer.js. Delegate to tested mechanisms (BeaconCards, AccentButton) so isolated tests potentially redundant unless testing orchestration/configuration.
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-people-peoplehubcards.js`

### mechanism/platform-claude (v0.1.3)
- Blast radius: **high** — Owns CLAUDE.md + claude_surface[]; touched every cycle close.
- Composite: **0.38** · Priority: **1.05** · Incidents 30d: 2
- Primary flow (Axis 6 grounding): Install/upgrade/bootstrap lifecycle slash commands trigger aggregateClaudeSurface + materializeClaudeSurface + regenerateClaudeMd to sync CLAUDE.md tables and materialize .claude/commands+skills from all subscribed surfaces.
- Qualitative recommendation: Strong unit-layer coverage; gap is end-to-end install -> materialize -> CLAUDE.md flow. Recommend HC-V0XYZ-PLATFORM-CLAUDE-INSTALL-SMOKE family in run-integration-smoke.js or lightweight behavioral runner.
- False positives: manifest_schema: 0.75 is correct but name + depends_on fields not asserted; only version+files asserted in HC-V01020-CLAUDE-MD-RES-1
- False negatives: integration_smoke: run-claude-surface.js covers aggregation, materialization, rendering (36 cases); 0.0 score is correct because no end-to-end harness exercises slash-command -> apply* -> file-generation chain
- Top gap: axis=`integration_smoke` archetype=`behavioral-runner` target=`platform/test/run-integration-smoke.js`

### mechanism/smart-connections-bridge (v0.2.0)
- Blast radius: **med** — Cowork-adjacent embedding bridge; opt-in.
- Composite: **0.25** · Priority: **0.63** · Incidents 30d: 2
- Primary flow (Axis 6 grounding): Cowork orchestrators invoke sc-bridge CLI to find semantically related vault notes and display them in daily/weekly reviews.
- Qualitative recommendation: Run-smart-connections-bridge.js is thorough at the unit level: all three CLI ops, error paths, flag handling, vault fixture edge cases. The 0.0 smoke score is correct - never exercises cowork's gather-semantic-related/-memory skills invoking bridge against real vault index. Close via behavioral harness case in run-cowork-smoke.js.
- Top gap: axis=`integration_smoke` archetype=`behavioral-runner` target=`platform/test/run-integration-smoke.js`

### mechanism/backlink-panel (v0.1.0)
- Blast radius: **med** — Visible on every project + meeting.
- Composite: **0.15** · Priority: **0.60** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): Person/project/team/product/trip/meeting atlas page renders a backlinks panel showing cross-referenced notes, grouped or sorted per options.
- Qualitative recommendation: Robust lint harness catches v0.117.x-style silent bugs but the public render() API is untested. One renderer fixture + one HC family for _ENTITY_TYPE_TO_KEY would lift customjs_behavioral to 0.5 and widget_render to 1.0.
- False negatives: customjs_behavioral: run-backlink-panel.js covers lint (BP-4..16) but zero behavioral asserts on render(dv,opts); no DOM stub, no Dataview query, no reverse-link matching; widget_render: BacklinkPanel.render() is a widget method but never called in run-renderer.js or run-integration-smoke.js; integration_smoke: No primary flow test - person/project/team/product/trip/meeting page rendering backlinks panel never exercised end-to-end
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-backlink-panel-backlinkpanel.js`

### mechanism/nav-buttons (v2.7.0)
- Blast radius: **med** — Visible on every hub + entity.
- Composite: **0.57** · Priority: **0.60** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): User navigates to a note with SpaceNavButtons dataviewjs block; mechanism reads registry JSON, sorts by (order, source, id), renders multi-row button grid, dispatches clicks to action handlers (openLink, createFromTemplate, runTemplaterTemplate, invoke_command).
- Qualitative recommendation: Excellent actual coverage in run-renderer.js (8 dedicated tests, all action types, error paths, real-world scenarios) but scorer's false-negatives obscure it. Recommendations are scorer-level fixes, not new tests.
- False positives: installer_migration: Mechanism has zero migrations (post_install: []); should be null per rubric, not 0/1; manifest_schema: Zero HC families assert nav-buttons manifest fields; should be lower than 0.833
- False negatives: customjs_behavioral: SpaceNavButtons.render() thoroughly exercised in run-renderer.js by 8 separate tests (T2.5, T2.6, T2.7, R-INVOKE-ARGS, R-SCRATCH-DAYHUB, R-COWORK-HUB, T4.0, T4.4); should be 1.0. Root cause: scorer didn't pattern-match across run-renderer.js test names.
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-nav-buttons-spacenavbuttons.js`

### blueprint/journal (v0.2.0)
- Blast radius: **med** — Used by both consumers; relatively static lately.
- Composite: **0.57** · Priority: **0.45** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): Click 'Journal' nav button to create a new dated journal entry at spice/journal/YYYY/MM-MMMM/Journal-YYYY-MM-DD.md with Templater auto-apply.
- Qualitative recommendation: Minimal, stable blueprint with only template + rule_fragment; template lockstep coverage complete. integration_smoke gap is only meaningful gap. Low priority (0.6 med blast-radius, stable). Consider deferring or addressing via small extension to run-integration-smoke.js.
- False negatives: integration_smoke: Primary flow (nav-button-triggered template creation) not exercised in any harness. run-integration-smoke bootstraps + seeds vault but omits journal creation step.
- Top gap: axis=`integration_smoke` archetype=`behavioral-runner` target=`platform/test/run-integration-smoke.js`

### blueprint/trips (v0.3.0)
- Blast radius: **low** — Niche use; rare touches.
- Composite: **0.57** · Priority: **0.36** · Incidents 30d: 1
- Primary flow (Axis 6 grounding): Create a new trip with dates and location, then view its sections (atlas, flights, stay, packing list, to-do, notes) via BeaconCards and TripSectionsCards widget.
- Qualitative recommendation: Thin test coverage: zero widget render tests, zero behavioral tests for three customJS classes. Template_lockstep score is artificially high from infrastructure tests. Substring-collision false-positive on integration_smoke.
- False positives: integration_smoke: Scorer matches 'trip' substring in 'midday-tripwire' (cowork cadence) in run-cowork-smoke.js; actual trips user flow has zero end-to-end test coverage. Should be 0.0.
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-trips-tripshubcards.js`

### mechanism/convenience (v0.4.1)
- Blast radius: **low** — Misc plugin install; rare edits.
- Composite: **0.25** · Priority: **0.32** · Incidents 30d: 2
- Primary flow (Axis 6 grounding): Install convenience mechanism to auto-enable workspace hotkeys (Cmd+T for daily, Cmd+- for full path copy, Cmd+= for path copy) + Dataview JS support + Tasks emoji-to-icon CSS snippet.
- Qualitative recommendation: Low blast radius (0.315 priority). Real debt is missing happy-path smoke; close by extending run-integration-smoke.js with a hotkey-registration verify case.
- False positives: manifest_schema: Rubric only checks for name/version/files/depends_on fields; convenience manifest also has external_plugins, hotkeys, community_plugin_settings, snippets, appearance — load-bearing fields not in HC family population
- False negatives: integration_smoke: No happy-path smoke test exists exercising install convenience -> verify hotkeys bound -> trigger hotkey -> verify action; bootstrap tests dependency add but not hotkey/plugin functionality
- Top gap: axis=`integration_smoke` archetype=`behavioral-runner` target=`platform/test/run-integration-smoke.js`

### mechanism/icons (v0.1.1)
- Blast radius: **low** — Static glyph map; rare touches.
- Composite: **0.69** · Priority: **0.32** · Incidents 30d: 2
- Primary flow (Axis 6 grounding): Caller invokes customJS.Icons.resolve(kebab_name) to fetch vendored SVG from Tier 1 map or Tier 2 Obsidian fallback, returning HTML or null.
- Qualitative recommendation: Pure stateless utility with no end-to-end user flow of its own; integration_smoke=0 is correct per rubric. Existing coverage across run-helper-cases (ICN-1) and run-renderer (R-EC-ICON Tier 1 + AccentButton chaining) is sufficient. No dedicated harness warranted. Defer.
- Top gap: axis=`integration_smoke` archetype=`behavioral-runner` target=`platform/test/run-integration-smoke.js`

### mechanism/people-identity (v0.1.0)
- Blast radius: **low** — Stable resolver; rare edits.
- Composite: **0.33** · Priority: **0.30** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): Resolve person names and typed aliases (phone, email, handle) to wikilinks via customJS.PeopleIdentity for renderers, validators, and hub views.
- Qualitative recommendation: Foundation-building infrastructure, not a test-debt priority this cycle. Defer both gaps to v0.119.x. Focus arc capacity on mechanisms with live consumers and no forward-planning deferral.
- False positives: customjs_behavioral: Two uncovered methods (findByAlias, listAliasesOfType) explicitly deferred to future cycles per README (brain-map, hub views, validator audit). Covering now tracks infrastructure prep, not current debt.; integration_smoke: Primary flow is agent-side (cowork:resolve-person sub-skill); no in-Obsidian consumers this cycle per README. Smoke deferral is intentional.
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-people-identity-peopleidentity.js`

### blueprint/teams (v0.3.0)
- Blast radius: **low** — Not in active use by either consumer vault.
- Composite: **0.58** · Priority: **0.30** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): Create a team, assign it one or more products, and verify it appears in Teams hub grouped by product with member projects rolled up.
- Qualitative recommendation: Low priority (0.583 composite, blast_radius=low, 0 recent_incidents). Recommend behavioral-runner for customjs_behavioral + widget_render gaps (candidate: run-teams-customjs.js). manifest_schema gap lower priority.
- False positives: integration_smoke: Score 1.0 from substring matching on 'teams' in run-cowork-smoke.js (MCP tool variant) and run-migrate-frontmatter.js; teams blueprint primary flow (create -> assign products -> appear in hub) has zero coverage. Should be 0.0.; manifest_schema: customjs_classes field not asserted; 3 widget classes never mentioned in assertions (TEAM-1/2/3 cover files/nav/rule_fragments/depends_on only)
- False negatives: widget_render: All 3 customjs classes (TeamsHubCards, TeamPageCards, TeamActionButtons) have render() methods, scored 0.0; legitimately uncovered in run-renderer.js
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-teams-teamshubcards.js`

### mechanism/customjs-guard (v1.0.0)
- Blast radius: **low** — Pure-fn guard utility; stable.
- Composite: **0.69** · Priority: **0.30** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): Caller invokes dv.view('customjs-guard', {class, method?, args?}) -> guard polls window.customJS for ~2s -> dispatches to target class method -> renders or shows error fallback.
- Qualitative recommendation: Critical infrastructure for cold-load reliability across every blueprint using CustomJS. The two v0.110.x+ migrations are load-bearing but tested only at manifest level. Recommend behavioral runner stubbing Obsidian app + window.customJS, valid/invalid input paths, ~15-20 asserts.
- False negatives: installer_migration: applyEntityCreateGuardMigration + applyCustomJsGuardMigration tested only at manifest level (V01102-CJSG regex-scans); no end-to-end run + vault post-state asserts; customjs_behavioral: view.js input validation logic (missing class, invalid args, method-not-found fallback) has no dedicated harness
- Top gap: axis=`installer_migration` archetype=`seed-migrate` target=`platform/test/run-seed-migrations.js`

### mechanism/kanban-status-sync (v0.2.0)
- Blast radius: **low** — Boards-coupled; low traffic.
- Composite: **0.42** · Priority: **0.27** · Incidents 30d: 1
- Primary flow (Axis 6 grounding): User moves a card in obsidian-kanban board, triggering vault startup or manual re-sync command, which discovers boards via Dataview and writes each card's frontmatter (status/status_prev/status_changed_at) reflecting its current column; orphaned cards marked archived.
- Qualitative recommendation: Pure utility functions well-covered; behavioral core (syncBoard with vault I/O + metadataCache + dataview + frontmatter writes) has zero coverage. Behavioral-runner candidate: stub Obsidian app + metadataCache + dataview; seeded board with moving cards; forward + reverse pass; KanbanStatusSyncInit retry-with-backoff + command registration.
- False negatives: customjs_behavioral: syncBoard method (forward/reverse vault I/O passes) not exercised; requires Obsidian app/metadataCache stubs and cannot be tested via pure static helpers alone; integration_smoke: Score 0.0 is correct; missing vault setup with kanban board, dataview availability, Obsidian app stubs, frontmatter write verification
- Top gap: axis=`integration_smoke` archetype=`behavioral-runner` target=`platform/test/run-integration-smoke.js`

### mechanism/people-rendering (v0.1.0)
- Blast radius: **low** — Pure widget; stable.
- Composite: **0.63** · Priority: **0.22** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): Render person references as interactive chips, cards, or mention-lists within host blueprint pages, filtering to spice/people/ namespace and delegating card rendering to BeaconCards.
- Qualitative recommendation: Composite 0.625 masks integration gap. Unit tests pass under DOM stub but no test validates the primary user flow in a consuming blueprint's output. Recommendation: extend run-integration-smoke.js with 'meeting note with [[Person]] attendee -> renders as chip via people-rendering' happy path.
- False positives: customjs_behavioral: 4/4 public methods tested under DOM stub unit tests, not integration scenarios; doesn't validate behavior in real rendering contexts (chips in meeting attendees, lists in daily context); widget_render: renderChip scores 1.0 because it renders without throw under DOM stub; doesn't validate visual contract (layout, tooltips, fallback) or integration into live page render
- False negatives: manifest_schema: 0/6 manifest fields asserted in HC families; depends_on (customjs-guard, cards) never validated; integration_smoke: Primary flow 'render [[Person]] references in other blueprints (meetings, daily, journal, projects)' not exercised. integration-smoke exercises people blueprint but never calls renderChip/renderCard/renderMentionList/extractMentions from a consuming blueprint
- Top gap: axis=`integration_smoke` archetype=`behavioral-runner` target=`platform/test/run-integration-smoke.js`

### mechanism/audit (v0.3.0)
- Blast radius: **high** — Self-grading harness; touched by every install.
- Composite: **0.94** · Priority: **0.17** · Incidents 30d: 7
- Primary flow (Axis 6 grounding): Run /audit slash command to walk vault, detect violations and platform drift, write audit report.
- Qualitative recommendation: Score 0.944 composite; manifest_schema gap minor. Real gap: claude-surface walker self-validation missing. Address by adding meta-test invoking walkClaudeSurface on fixture with audit's own registry entries.
- False positives: manifest_schema: Claims 0.833 (2/3 manifest fields asserted) but 'name' field marked as NOT asserted, yet integration_smoke validates the full /audit command end-to-end which exercises name lookup
- False negatives: manifest_schema: Mechanism contributes three claude-surface entries (command, skill, claude_md_row) but run-audit.js does NOT validate registrations round-trip through claude-surface-walker; blind spot where the audit mechanism could break its own deployed surface
- Top gap: axis=`manifest_schema` archetype=`hc-family` target=`platform/test/run-helper-cases.js`

### mechanism/activity-feed (v0.7.1)
- Blast radius: **med** — Hub embed; visible on hubs widely.
- Composite: **0.94** · Priority: **0.15** · Incidents 30d: 14
- Primary flow (Axis 6 grounding): Query pages by time-window scope (today/week/month) and render them grouped by blueprint with optional rollup, bucketing, preview, and persistent group state.
- Qualitative recommendation: Exceptionally well-covered. run-activity-feed.js has 8 distinct test passes covering manifest validation, source linting, runtime behavior under synthetic dataview/DOM stubs, and edge cases (strict created_at, ISO timezones, empty groups, group state). 120 asserts deterministic. No new harness needed.
- Top gap: axis=`manifest_schema` archetype=`hc-family` target=`platform/test/run-helper-cases.js`

### mechanism/validator (v0.3.0)
- Blast radius: **high** — Front-line schema gate; touched by every blueprint change.
- Composite: **0.94** · Priority: **0.10** · Incidents 30d: 1
- Primary flow (Axis 6 grounding): Author writes a file -> Templater post-execution hook validates frontmatter/tags/blocks/naming against rule_fragments -> violations surface as notices and append to _lint-queue.yml for bulk review.
- Qualitative recommendation: Phase 2-3 candidate if room permits. Two additions (manifest HC family + integration_smoke for full flow) lift manifest_schema to ~1.0 and integration_smoke to 0.5-1.0. Risk is low - schema enforcement tool, gaps are visibility, not functional bugs.
- False negatives: manifest_schema: Validator manifest top-level fields (name, version, files, external_plugins, templater_hotkeys, slash_commander_bindings, post_install) lack HC-family asserts. Only extends resolution runtime behavior (VAL-EX-1..8 in run-validator.js) is covered.; integration_smoke: Primary user flow ('write file -> /validate -> feedback via hook notice or _lint-queue appends') lacks end-to-end behavioral assert. Mechanism exercised only in isolation, not full vault lifecycle.
- Top gap: axis=`manifest_schema` archetype=`hc-family` target=`platform/test/run-helper-cases.js`

### blueprint/boards (v0.2.1)
- Blast radius: **low** — Single consumer uses kanban occasionally; one external plugin coupling.
- Composite: **0.90** · Priority: **0.05** · Incidents 30d: 1
- Primary flow (Axis 6 grounding): Create kanban board from nav button; kanban-plugin renders To-Do-Board.md; create card auto-routes to spice/boards/cards/YYYY/MM-MMMM/title.md via Templater rule_fragment.
- Qualitative recommendation: Validates cleanly. 0.9 composite reflects minor manifest_schema gap (3 fields lack HC asserts). Low priority given blast_radius=low and strong external-plugin coupling. Closing the gap via 3-field HC-family extension is low-lift.
- Top gap: axis=`manifest_schema` archetype=`hc-family` target=`platform/test/run-helper-cases.js`

### mechanism/accent-button (v0.1.1)
- Blast radius: **low** — Trivial wrapper; v0.88 bug already netted.
- Composite: **0.94** · Priority: **0.04** · Incidents 30d: 1
- Primary flow (Axis 6 grounding): Render an outline-accent action button with configurable label, icon SVG, click handler, flex fill, disabled state, and hover color transitions.
- Qualitative recommendation: Fully covered across all applicable axes. The manifest_schema 0.75 reflects trivial unasserted fields statically validated in CI. No harness extensions required. Single HC family in run-helper-cases.js could upgrade to 1.0 but not risk-justified.
- False negatives: manifest_schema: name, rule_fragments, depends_on fields unasserted; low-risk for trivial wrapper mechanism (name/dependencies statically validated by CI, behavior exercised in integration tests)
- Top gap: axis=`manifest_schema` archetype=`hc-family` target=`platform/test/run-helper-cases.js`

### mechanism/styling (v0.2.1)
- Blast radius: **low** — CSS surface; visual only.
- Composite: **0.90** · Priority: **0.03** · Incidents 30d: 0
- Primary flow (Axis 6 grounding): Install and apply Baseline theme, enable sauce-callouts CSS snippet, merge canonical style-settings defaults into consumer config.
- Qualitative recommendation: CSS-only manifest-driven surface with no behavioral code. Current 15 VT/AP/SS cases + integration smoke verify installer helpers well. Adding one HC-V0####-STYLING-MANIFEST family (3-4 asserts on manifest structure + file paths) would close the gap without needing a dedicated harness.
- False positives: manifest_schema: 0.800 score reflects behavioral testing of installer helpers (VT/AP/SS) but lacks explicit HC family asserting manifest field contract (name, version, external_plugins, snippets, appearance structure, style_settings_defaults_src path)
- Top gap: axis=`manifest_schema` archetype=`hc-family` target=`platform/test/run-helper-cases.js`

### mechanism/cards (v0.2.6)
- Blast radius: **low** — Pure renderer primitive.
- Composite: **1.00** · Priority: **0.00** · Incidents 30d: 9
- Primary flow (Axis 6 grounding): Render a list of pages into a mobile-aware card grid with title, optional subtitle/badges/meta, grouping, and custom click handlers.
- Qualitative recommendation: Icon option (actively used in production) should be added to BC test coverage; integration_smoke should be demoted to 0.5 (happy-path only) unless dedicated multi-blueprint flow added. The render() method itself is thoroughly exercised (63 hits across 9 test cases).
- False positives: widget_render: icon option used in production (project-docs-index.js) but untested in BC1-BC9 suite; integration_smoke: Score 1.0 claims happy+failure modes but only negative regression assertion exists (legacy ProjectDocsCards removal); no positive flow exercised end-to-end
- Top gap: axis=`customjs_behavioral` archetype=`behavioral-runner` target=`platform/test/run-cards-beaconcards.js`

## Ranked queue (top 10)

| Rank | Surface | Axis | Archetype | Target file | Priority |
|---|---|---|---|---|---|
| 1 | blueprint/cowork | customjs_behavioral | behavioral-runner | platform/test/run-cowork-coworkdailyhubcards.js | 2.00 |
| 2 | blueprint/project | installer_migration | seed-migrate | platform/test/run-seed-migrations.js | 2.00 |
| 3 | blueprint/finance | installer_migration | seed-migrate | platform/test/run-seed-migrations.js | 2.00 |
| 4 | blueprint/daily | customjs_behavioral | behavioral-runner | platform/test/run-daily-spacedailydashboard.js | 2.00 |
| 5 | mechanism/entity-create | installer_migration | seed-migrate | platform/test/run-seed-migrations.js | 2.00 |
| 6 | blueprint/meetings | customjs_behavioral | behavioral-runner | platform/test/run-meetings-meetingshubcards.js | 1.80 |
| 7 | blueprint/scratch | customjs_behavioral | behavioral-runner | platform/test/run-scratch-scratchhubcards.js | 1.75 |
| 8 | blueprint/to-do | installer_migration | seed-migrate | platform/test/run-seed-migrations.js | 1.60 |
| 9 | blueprint/products | customjs_behavioral | behavioral-runner | platform/test/run-products-productshubcards.js | 1.20 |
| 10 | blueprint/people | customjs_behavioral | behavioral-runner | platform/test/run-people-peoplehubcards.js | 1.08 |

## Picks for this arc (manual override after qualitative validation)

The deterministic scorer's rank-1 (blueprint/cowork customjs_behavioral 0.0) and rank-4 (blueprint/daily customjs_behavioral 0.0) are qualitative-validated rubric noise:

- **cowork** has 954 asserts in `run-cowork-smoke.js` validating all 9 customjs classes via structural patterns; the deterministic grep heuristic doesn't recognize the pattern. True coverage is much higher than 0.0 suggests. Picking cowork would waste cycle on a fake gap. Rubric heuristic fix queued for v1.1.0 rubric revision (carry-forward).
- **daily** has an architectural mismatch: `SpaceDailyDashboard.render()` is unreachable via the current test harness pattern; would require a behavioral runner with full dataviewjs surface stub. Real gap, but expensive to close and not the highest-ROI work for this arc.

Final picks (all priority 2.00, qualitative-validated as REAL gaps, identical archetype + target file — coherent triple extending the seed migration regression net):

- **impl-1**: `blueprint/project` / `installer_migration` / `seed-migrate` (deterministic rank-2). Five untested `apply*` migrations: `applyProjectSectionsMigration`, `applyProjectSectionsHubMigration`, `applyProjectSectionsCloseRepair`, `applyEmptyProjectWikilinkRepair`, `applyProjectTodoBackfill`. Static source-checks exist but no functional validation against vault adapters.
- **impl-2**: `blueprint/finance` / `installer_migration` / `seed-migrate` (deterministic rank-3). Twenty-three `apply*` migrations covering finance defaults / debts / paychecks / months / budgets scaffolding + healing — zero `HC-V0XYZ-SEED-MIGRATE-*` families.
- **impl-3**: `mechanism/entity-create` / `installer_migration` / `seed-migrate` (deterministic rank-5). Two `apply*` migrations: `applyNewEntityButtons` (registry materialization) + `applyEntityCreateGuardMigration` (vault-wide rewrite). Run on every install; high blast radius; zero seed coverage today.

All three impls target the same file (`platform/test/run-seed-migrations.js`) and the same axis (installer_migration). The arc's three cycles each extend the seed-vault with pre-migration fixtures for one surface and add a new `HC-V0XYZ-SEED-MIGRATE-<topic>` family.

### Carry-forwards (not addressed in this arc)

- **Rubric heuristic v1.1.0**: teach the scorer to recognize cowork-smoke's structural-assert pattern (would lift cowork composite from 0.4 to ~0.85).
- **Substring-collision false positives**: `daily` substring collides with multiple unrelated test files; `trips` substring collides with cowork's `midday-tripwire`; `teams` collides with cowork MCP variant. Patch rubric to use word-boundary or class-name matching.
- **Behavioral runner for daily**: `SpaceDailyDashboard.render()` requires a full dataviewjs stub; out-of-scope here. Queue for v0.120.x.
- **Widget render gap on to-do**: seven widgets uncovered in run-renderer.js (ToDoHubActions, ToDoLeafActions, ToDoAllList, ToDoDailyCarryover, ToDoDailyRecurring, ToDoDailyProjectGroups, ToDoDailyUnassignedMeetings). Real gap. Queue for v0.120.x.
- **customjs-guard installer migrations**: two load-bearing v0.110.x+ migrations (applyEntityCreateGuardMigration, applyCustomJsGuardMigration) only tested at manifest level. Real gap, high blast radius. Queue for v0.120.x.
- **Meetings + scratch + products + people widget gaps**: each has at least one untested customjs widget render path. Queue for v0.120.x via run-renderer.js fixtures.
