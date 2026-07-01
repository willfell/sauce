# Sauce Autoloop Turn 63 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** merged — PR #155 merged + shipped in 0.162.0; card closed + ledgered. Slice 2 carries an unanswered union-vs-map-wins design flag.
**Card:** Workstreams Hub Slice 1 - source-of-truth read helper
**Version shipped:** 0.162.0

## Board snapshot (after this turn)

### In Planning
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]
- [[Project Doc Updating Wiring PR2 - move dialog]]
- [[Project Doc Updating Wiring PR3 - bulk move dialog]]
- [[Project Links Wiring PR2 - link dialogs]]
- [[Project Links Wiring PR3 - existing-project backfill]]
- [[Project Doc Move Cross-Project]]
- [[Cross-blueprint templating and render consistency audit]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Project Links Wiring PR2 - link dialogs]]

## Notes
- AUTONOMOUS MODE (15-min). deploy: action=none (vaults at 0.161.1; 0.162.0 bottle not yet published). reconcile=merged: PR #155 (Workstreams Hub Slice 1 — WorkstreamSource resolver) merged + shipped in 0.162.0. Closed the card -> Completed (0.162.0), recorded #155 (reconcile now idle). DECISION PENDING (user, async): Slice 1 shipped the resolver with MAP-CANONICAL HUB-PRESERVING UNION (not the plan's literal map-wins) — flagged in the Slice-1 card + PR #155. Rationale: Slice-0 found headspace `sauce` has finance-blueprint on the hub only; union preserves it, map-wins drops it; Slice-4 is 'data-preserving'. NEXT-TURN GUIDANCE: Slice 2 (repoint readers to Map note via WorkstreamSource) is the top Planning card, but it makes the union semantics LIVE IN VAULTS (behavioral). Because the union-vs-map-wins flag is unanswered, the safer autonomous move next idle turn is to pick a DIFFERENT Planning card (e.g. Project Links Wiring PR2, Project Doc Updating PR2/PR3, or the cross-blueprint consistency audit) and leave Slice 2 until the user signs off — OR proceed Slice 2 on the union default (non-lossy, reversible) if you judge it safe. Do NOT wedge; there is ample other work.
