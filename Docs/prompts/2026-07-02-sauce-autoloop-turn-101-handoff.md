# Sauce Autoloop Turn 101 — handoff

**Date:** 2026-07-02
**Mode:** live
**Outcome:** queue-item shipped-to-PR. Idle reconcile + no Blocked response → pulled Scout queue item `cov-blueprint-to-do-widget-render` (test). **Investigated first** (per the established pattern): most to-do render widgets ARE functionally render-tested (run-todo-all-list / run-todo-markdown-render / run-v0127-today-capture-editable-list / run-todo-materialize), so 0/7 is largely a rubric-scan artifact — BUT `ToDoHubActions` + `ToDoLeafActions` had NO render()-execution test (structural-only), a genuine gap. Built `run-todo-render-guards.js` — cold-load no-throw for all 8 to-do render widgets (adds the cold-load/embed dimension + closes the 2-widget gap). PR #211, Gate A green, teeth-verified, auto-merge armed.
**Card:** cov-blueprint-to-do-widget-render (queue item — no board card)
**Version shipped:** (none yet — #211 auto-merge pending CI)

## Board snapshot (after this turn)

### In Planning
- (empty)

### In Progress
- [[Cross-blueprint templating and render consistency audit]] (parked)
- [[Workstreams in Projects need updating]] (parked)

### Blocked (none had a response this turn)
- [[List of templates not using separators]] — **user-owned**
- [[Workstreams Hub Slice 2..6]] (epic parked)
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### Discovered (autoloop)
- cov-blueprint-cowork-widget-render → done + merged (#210)
- cov-blueprint-to-do-widget-render → **done this turn** (#211)
- Remaining proposed: cov-blueprint-to-do-customjs-behavioral (25/31), cov-blueprint-scratch-widget-render (0/5), cov-blueprint-trips-customjs-behavioral (0/4)

## Recommended next
- **Next turn:** reconcile #211 (merged → record in ledger, no board card). Deploy any shipped release.
- **Then the queue's next item.** Order after #211: likely `cov-blueprint-to-do-customjs-behavioral` (25/31) OR `cov-blueprint-scratch-widget-render` (0/5) depending on queue order.
  - `cov-blueprint-scratch-widget-render` (0/5) — **investigate first**: enumerate scratch render widgets + host-API surface; if they lack render-execution tests and stub cleanly, build `run-scratch-render-guards.js` (reuse the cowork/to-do stub pattern). If already covered elsewhere or the stub balloons, dismiss with a note.
  - `cov-*-customjs-behavioral` (to-do 25/31, trips 0/4) — grep-`ClassName.method` false gaps for dogfood `render()` instance widgets → **dismiss** unless a genuinely-uncovered pure helper exists (verify like turn 94's cowork dismissal).
- **Durable (deliberate/human, worth a make-work card like #208):** extend `scoreWidgetRender`'s `RENDER_TEST_HARNESSES` to credit `run-cowork-render-guards.js` + `run-todo-render-guards.js` (+ future scratch), then regen `coverage-matrix.json`. This stops the rubric scoring these 0/N. Watch for over-crediting (don't add run-helper-cases.js — it references classes without rendering them).
- **User-owned:** "List of templates not using separators" Blocked card.

## Notes
- **deploy:** action=none, all 3 vaults at 0.176.1.
- **reconcile:** idle at start; no Blocked response. Selected + shipped one queue item.
- **Gate A:** preflight exit 0 (24 TODOGUARD) + install clean. **Gate B:** skipped (test-only — new harness + preflight wiring + queue status; no blueprint/mechanism source). Teeth-verified (inject throw → 3 FAILs → 24/0).
- **Investigate-first is paying off:** cowork was a genuine gap (build), to-do was mostly a rubric artifact w/ a 2-widget genuine gap (build the cold-load net). This avoids both busywork and false dismissals.
- Reusable harness pattern now proven for project/cowork/to-do: empty dv.pages chainable + tolerant DOM proxy (firstChild→null) + chainable moment stub + dv.current variants + no-op customJS.
- Cadence 30 min (cron `48ce0fcc` at `13,43`). Autonomous ~8h, no check-ins. Never admin-merge the release PR.
