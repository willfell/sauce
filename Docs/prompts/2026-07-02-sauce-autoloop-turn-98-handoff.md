# Sauce Autoloop Turn 98 — handoff

**Date:** 2026-07-02
**Mode:** live
**Outcome:** pr-open (wait) + release-PR unstuck. Reconcile = pr-open #210 (cowork render-guard harness) — macOS CI still pending, so nothing to admin-merge yet; next turn reconciles it. Separately unstuck the **release PR #209 (v0.176.1)**: it was fully green but `mergeable:UNKNOWN` (GitHub hadn't recomputed after turn-96/97 handoffs advanced main), which is why #208's rubric fix hadn't shipped and all vaults were still 0.176.0. `gh pr update-branch 209` (the allowed release-PR unstick — NEVER admin-merge) → now MERGEABLE + auto-merge armed, BLOCKED only on its re-triggered CI. Once that passes, v0.176.1 tags + ships.
**Card:** cov-blueprint-cowork-widget-render — PR #210 open, auto-merge pending
**Version shipped:** (none yet — #209/v0.176.1 mid-flight, #210 pending)

## Board snapshot (after this turn)

### In Planning
- (empty)

### In Progress
- [[Cross-blueprint templating and render consistency audit]] (parked)
- [[Workstreams in Projects need updating]] (parked)

### Blocked
- [[List of templates not using separators]] — **user-owned**
- [[Workstreams Hub Slice 2..6]] (epic parked)
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### Discovered (autoloop)
- cov-blueprint-cowork-widget-render → done (PR #210, auto-merge pending)
- Proposed: to-do widget_render (0/7), to-do customjs_behavioral (25/31), scratch widget_render (0/5), trips customjs_behavioral (0/4)

## Recommended next
- **Next turn:** reconcile #210 — if merged → record in ledger (no board card). If still pr-open + green + BEHIND → admin-merge (non-release; verify zero file-overlap with base delta first, as with #208/#210's siblings). Also re-check #209/v0.176.1: if it merged, deploy will upgrade vaults; if it re-staled to BEHIND/UNKNOWN, `update-branch 209` again.
- **Then continue draining queue coverage items** (investigate-first, per turn 97): `cov-blueprint-to-do-widget-render` / `cov-blueprint-scratch-widget-render` likely the same real-gap shape → reuse the `run-cowork-render-guards.js` stub pattern (empty dv.pages + tolerant DOM proxy + moment stub) if the widgets stub cleanly; if they balloon, dismiss with a note. The `customjs_behavioral` items are grep-artifact false gaps → dismiss unless a pure helper is genuinely uncovered.
- **Durable (deliberate/human):** `scoreWidgetRender` crediting the new render-guard harnesses + the ~4600-line `coverage-matrix.json` regen.
- **User-owned:** "List of templates not using separators" Blocked card.

## Notes
- **deploy:** action=none, all 3 vaults at 0.176.0 (v0.176.1 ships once #209's re-CI passes).
- **reconcile:** pr-open #210 (macOS CI pending — ubuntu preflight already green). One wait + one release-PR unstick this turn.
- Release-PR discipline reminder: #209 is the pipeline's own PR — only `update-branch` it, never `--admin` merge. Non-release autoloop PRs (#210) may be admin-merged when green + BEHIND + zero base-delta overlap.
- Cadence 30 min (cron `48ce0fcc` at `13,43`). Autonomous ~8h, no check-ins.
