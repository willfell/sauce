# Autoloop queue

Scout-discovered, **safe-category** work items (the loop drains this when the board has no eligible work). Each item:

- id: <kebab-slug, maps to branch autoloop/<id>>
  title: <one line>
  category: doc | test
  source: <detector>
  rationale: <why>
  status: proposed | done

<!-- items below -->

- id: cov-blueprint-finance-customjs-behavioral
  title: Add coverage for finance customjs_behavioral (20/45)
  category: test
  source: coverage-matrix
  rationale: blueprint finance axis customjs_behavioral: 25 uncovered
  status: done
  note: covered the 2 unit-testable methods (FinanceFrontmatter.read/isTruthy) via run-finance-frontmatter.js PR #185; the other 23 uncovered are dogfood-only render() widgets (render-guard axis, not customjs_behavioral)

- id: cov-blueprint-finance-widget-render
  title: Add coverage for finance widget_render (10/26)
  category: test
  source: coverage-matrix
  rationale: blueprint finance axis widget_render: 16 uncovered
  status: done
  note: added 14 finance widgets to run-renderer.js cold-load render-guard (FF-COLD) via PR #189 -> widget_render 10->24/26; DebtsCards + DebtsHubSummary need full-render coverage (dv.pages data) - follow-up

- id: cov-blueprint-project-customjs-behavioral
  title: Add coverage for project customjs_behavioral (6/19)
  category: test
  source: coverage-matrix
  rationale: blueprint project axis customjs_behavioral: 13 uncovered
  status: dismissed
  note: not honestly actionable — grep-based rubric (ClassName.method literal) cannot credit the 10 instance-method render() widgets; ProjectNavButtons.detectContext is already behaviorally tested via instance in run-project-links.js (PLB-D*). Durable fix = rubric improvement (credit instance-method + render-guard tests), not metric-gaming.

- id: cov-blueprint-project-widget-render
  title: Add coverage for project widget_render (3/14)
  category: test
  source: coverage-matrix
  rationale: blueprint project axis widget_render: 11 uncovered
  status: dismissed
  note: project render widgets are ALREADY cold-load render-guard-covered in run-project-render-guards.js; the widget_render rubric only scans run-renderer.js, so adding them there is low-value duplication. Durable fix = teach scoreWidgetRender to also credit run-project-render-guards.js.

- id: cov-blueprint-cowork-customjs-behavioral
  title: Add coverage for cowork customjs_behavioral (0/9)
  category: test
  source: coverage-matrix
  rationale: blueprint cowork axis customjs_behavioral: 9 uncovered
  status: dismissed
  note: all 9 uncovered methods are dogfood-only render() instance widgets; grep-based scoreCustomJSBehavioral (ClassName.method literal) cannot credit them. No pure helpers to test. Durable fix = rubric improvement, not metric-gaming.

- id: cov-blueprint-cowork-widget-render
  title: Add coverage for cowork widget_render (0/9)
  category: test
  source: coverage-matrix
  rationale: blueprint cowork axis widget_render: 9 uncovered
  status: done
  note: run-cowork-render-guards.js exercises all 9 cowork widgets' render() through the cold-load path (empty dv.pages) in normal + .markdown-embed contexts, asserting no-throw. Teeth-verified. Rubric still scores 0/9 until coverage-rubric.js credits this harness + matrix regen (tracked separately).

- id: cov-blueprint-to-do-widget-render
  title: Add coverage for to-do widget_render (0/7)
  category: test
  source: coverage-matrix
  rationale: blueprint to-do axis widget_render: 7 uncovered
  status: done
  note: run-todo-render-guards.js drives all 8 to-do render widgets through the cold-load path (dv.current() undefined/null + empty dv.pages) in normal + .markdown-embed contexts, asserting no-throw. Adds the cold-load/embed dimension; ToDoHubActions + ToDoLeafActions had NO render()-execution test before (others had functional tests in run-todo-*.js). Teeth-verified. Rubric still scores 0/7 until coverage-rubric.js credits this harness + matrix regen (tracked separately).

- id: cov-blueprint-to-do-customjs-behavioral
  title: Add coverage for to-do customjs_behavioral (25/31)
  category: test
  source: coverage-matrix
  rationale: blueprint to-do axis customjs_behavioral: 6 uncovered
  status: dismissed
  note: All 7 flagged-uncovered methods are grep-artifact false gaps. 6 are instance render() methods (genuinely tested by run-todo-render-guards.js #211 + functional run-todo-*.js tests) and 1 is ToDoCreateTaskInit.invoke (tested in run-todo-dialog.js via init.invoke() lines 147/155/162). scoreCustomJSBehavioral greps for the static "ClassName.method" form and can't match instance-method invocations. No genuinely-uncovered pure helper. Durable fix = rubric improvement (credit instance-method/render-guard-tested methods), tracked separately.

- id: cov-blueprint-scratch-widget-render
  title: Add coverage for scratch widget_render (0/5)
  category: test
  source: coverage-matrix
  rationale: blueprint scratch axis widget_render: 5 uncovered
  status: done
  note: run-scratch-render-guards.js drives all 5 scratch render widgets through the cold-load path (dv.current() undefined/null + empty dv.pages) in normal + .markdown-embed contexts, asserting no-throw. ScratchLeafActions + ScratchHubActions had NO render()-execution test before. Teeth-verified. Rubric still scores 0/5 until coverage-rubric.js credits this harness + matrix regen (tracked separately).

- id: cov-blueprint-trips-customjs-behavioral
  title: Add coverage for trips customjs_behavioral (0/4)
  category: test
  source: coverage-matrix
  rationale: blueprint trips axis customjs_behavioral: 4 uncovered
  status: done
  note: NEW run-trips.js (trips had NO test harness). Unit-tests TripNavButtons.detectContext across every path branch (non-trip/trips-hub/trip-atlas vs trip-section by frontmatter/trip-board/trip-card/folder-style) — the genuine behavioral method — plus cold-load render guards for all 3 trips widgets. Both teeth-verified (detectContext mutation → TC fails; render throw → TRIPGUARD fails). This is REAL coverage (detectContext), not a grep-artifact dismissal.

- id: cov-mechanism-people-identity-customjs-behavioral
  title: Add coverage for people-identity customjs_behavioral (0/4)
  category: test
  source: coverage-matrix
  rationale: mechanism people-identity axis customjs_behavioral: 4 uncovered
  status: done
  note: NEW run-people-identity.js (mechanism had NO harness) — 32 assertions covering all 4 public resolver methods (resolvePerson 4-tier + collision + null/non-string; findByAlias type+value + collision; getAliases wikilink/path/pipe forms + string-vs-object normalization + malformed-drop; listAliasesOfType) via a synthetic app vault stub. Genuine pure-logic coverage (NOT a grep-artifact — these are real data methods). Teeth-verified (mutating normalization broke 6 assertions).

- id: cov-blueprint-scratch-customjs-behavioral
  title: Add coverage for scratch customjs_behavioral (5/8)
  category: test
  source: coverage-matrix
  rationale: blueprint scratch axis customjs_behavioral: 3 uncovered
  status: done
  note: NEW run-scratch-migrate.js covers the 2 genuinely-behavioral of the 3 uncovered methods — ScratchDayMigrate.migrate (frontmatter day-value repair from path segment/filename, incl. Date/numeric/missing cases + guards) and ScratchDayMigrateInit.invoke (happy-path + guard branches, no-throw; stubbed the 30s _waitForDataview poll via app.plugins.plugins.dataview.api). The 3rd (render) is already covered by run-scratch-render-guards.js #212. Teeth-verified (repair mutation broke SM-2/3/4).

- id: cov-blueprint-to-do-installer-migration
  title: Add coverage for to-do installer_migration (3/6)
  category: test
  source: coverage-matrix
  rationale: blueprint to-do axis installer_migration: 3 uncovered
  status: dismissed
  note: DOUBLE artifact. (1) Mis-attribution — scoreInstallerMigration assigns install.js apply* fns to a surface by crude name-substring/module-dir match, so it wrongly attributes wiki/project/generic fns to to-do: applyWikiToDocsMigration (wiki), applyProjectLinksHubBackfill + applyProjectTodoOwnedTasksHeal (project, spice/projects), applyOrphanedHelperCleanup + applyPreInstall (generic). (2) Scan gap — the rubric only credits fns named in run-seed-migrations.js, but every "uncovered" fn IS tested in a dedicated harness (run-wiki-to-docs-migration.js, run-project-links-hub-backfill.js, run-project-todo-owned-tasks.js via _healProjectTodoOwnedTasksBody, run-helper-cases.js, run-install.js). No genuine to-do install migration lacks coverage. Durable fix = rubric attribution + multi-harness scan.

- id: cov-blueprint-finance-installer-migration
  title: Add coverage for finance installer_migration (20/23)
  category: test
  source: coverage-matrix
  rationale: blueprint finance axis installer_migration: 3 uncovered
  status: dismissed
  note: DOUBLE artifact (same class as the dismissed to-do item above). Live rubric now reports 29/33 with 4 "uncovered" fns, all false signals. (1) Mis-attribution — scoreInstallerMigration assigns install.js apply* fns to a surface by crude name-substring/module-dir match, wrongly attributing generic install-infra fns to finance: applyExternalPlugins, applyOrphanedHelperCleanup, applyPreInstall (none is a finance migration). (2) Dead code — applyFinanceDefaultsNavRowInjection is RETIRED: its call in applyFinanceMigrations was replaced by applyFinanceDefaultsNavRowRetirement (install.js:6760 "Replaces applyFinanceDefaultsNavRowInjection"), and run-helper-cases.js HC-FIN-COCKPIT-4 ALREADY asserts the injection call is removed while HC-FIN-COCKPIT-3 tests the retirement (_stripDefaultsNavRow); a seed test exercising the injection would contradict HC-FIN-COCKPIT-4 and pin dead code against future deletion. (3) Scan gap — the rubric only credits fns named in run-seed-migrations.js, but all 4 ARE tested elsewhere: applyFinanceDefaultsNavRowInjection + applyExternalPlugins + applyOrphanedHelperCleanup in run-helper-cases.js, applyExternalPlugins also in run-bootstrap.js, applyPreInstall in run-install.js. No genuine finance install migration lacks coverage. Durable fix = rubric attribution + multi-harness scan + dead-code (retired call-site) exclusion in scoreInstallerMigration.

- id: cov-blueprint-products-widget-render
  title: Add coverage for products widget_render (0/3)
  category: test
  source: coverage-matrix
  rationale: blueprint products axis widget_render: 3 uncovered
  status: proposed
