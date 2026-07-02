# Sauce Autoloop Turn 113 — handoff

**Date:** 2026-07-02
**Mode:** live
**Outcome:** implemented (Slice 1.5, via Blocked-column unblock) — user response resolved the blocker; shipped the prerequisite Slice 1.5 (Map-note type:map identity) as PR #232, auto-merge armed
**Card:** Workstreams Hub Slice 2 - repoint readers to Map note
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Move Cross-Project]]
- [[Update Daily Hub Template date]]
- [[To Do Daily Note Template enhancements]]
- [[Meeting Template Update]]
- [[Create Meeting Dialog Visual Fix]]
- [[Templating for project docs]]

### In Progress
- [[Cross-blueprint templating and render consistency audit]]
- [[Workstreams in Projects need updating]]
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]

### Blocked
- [[List of templates not using separators]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Workstreams Hub Slice 2 - repoint readers to Map note]]

## Notes
- DEPLOY (Phase A step 3): action=none — all 3 vaults (ero, accuris, headspace) current at 0.178.5; allOk=true.
- RECONCILE: idle (no in-flight PR/branch) → proceeded to Blocked-column unblock.
- UNBLOCK: "Workstreams Hub Slice 2" had a genuine user response (Will: do Slice 1.5 FIRST as its own slice, keep MAP-CANONICAL HUB-PRESERVING UNION for Slice 2, ship both as separate gated PRs). Moved Blocked → In Progress; appended **User resolved** + an autoloop note.
- SHIPPED (this turn = Slice 1.5, the prerequisite): fix(project) detect Map note by type:map not the stale "- Map" suffix — extracted a shared _isMapNote(type, basename) predicate (type===map || legacy suffix fallback, non-lossy) and routed all 3 identity sites (detectContext isMap, Map-button mapNote finder, render is-map guard) through it. Fixes the live missing-Map-button bug on ~96% of projects (canonical Map note is Project Map.md/type:map). Regression test PNB-MAP-1 in run-helper-cases.js.
- GATES: Gate A preflight 46/46 + install exit 0 + helpers 3888/0; Gate B L1 mutation = red-without/green-with; Gate B L2 3-lens panel = 0/3 refuted (pass).
- PR #232 opened on branch autoloop/workstreams-slice-1p5-map-identity (DISTINCT slug on purpose — so next-turn merged-reconcile does NOT false-close the Slice 2 card); auto-merge --squash armed (BLOCKED = CI in progress).
- FOLLOW-UP: Slice 2 card stays In Progress. Once PR #232 merges+ships, do Slice 2 proper (repoint ProjectNavButtons workstream widget + Kanban Card template to read workstreams from the Map note via the Slice-1 union resolver) — move Slice 2 back to Planning to let the loop pick it, or drive it directly. NOTE the handoff is committed LOCALLY only (not pushed) because PR #232 is open — pushing would re-stale it to BEHIND.
