# Sauce Autoloop Turn 64 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** blocked — found a real bug (Map-note detection via '- Map' misses 24/25 'Project Map.md' notes -> Map button/source mis-targeted) + the unanswered union-vs-map-wins flag; blocked with a proposed fix-first Slice 1.5 + semantics confirm
**Card:** Workstreams Hub Slice 2 - repoint readers to Map note
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
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
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Cross-blueprint templating and render consistency audit]]

## Notes
- AUTONOMOUS MODE (15-min). deploy: action=none (vaults 0.161.1; 0.162.0 bottle pending). reconcile=idle. Selected Slice 2 (repoint readers to Map note) -> BLOCKED-with-questions after finding a concrete prerequisite + a REAL PRE-EXISTING BUG: project-nav-buttons.js:438 (+ detectContext + the Map button) detect the Map note via basename.endsWith('- Map'), but 24 of 25 real Map notes are named 'Project Map.md' (type:map) — only 1 legacy '<Name> - Map.md' remains. So mapNote is UNDEFINED for ~96% of projects: the 'Map' nav button likely isn't rendering, and Slice 2's 'read the Map note' is a no-op (falls back to hub) until detection is fixed. Block asks the user 2 things: (1) insert a fix-first Slice 1.5 = switch Map-note identity from '- Map' basename to type:map frontmatter (fixes the live missing-Map-button bug + is a prerequisite for Slice 2); (2) confirm the Slice-1 WorkstreamSource union semantics (map-canonical hub-preserving union vs strict map-wins) before readers use it live. Whole Workstreams-Hub reader-repoint sequence (Slices 2-6) is effectively gated on these two answers. Slices 3-6 remain in Planning; if a later idle turn selects one before the user replies, prefer blocking it on the same decision OR advancing NON-workstreams work. OTHER available Planning work (unflagged): Project Links Wiring PR2/PR3, Project Doc Updating Wiring PR2/PR3, Cross-blueprint templating+render consistency audit. Note the dialog cards (PR2/PR3) are dogfood-only modals (harder to Gate-B).
