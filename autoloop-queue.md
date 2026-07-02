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
  status: proposed

- id: cov-blueprint-cowork-customjs-behavioral
  title: Add coverage for cowork customjs_behavioral (0/9)
  category: test
  source: coverage-matrix
  rationale: blueprint cowork axis customjs_behavioral: 9 uncovered
  status: proposed
