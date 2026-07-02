# Sauce Autoloop Turn 122 — handoff

**Date:** 2026-07-02
**Mode:** live
**Outcome:** implemented (project-dropdown sort+width fix — PR open) — sorted the all_projects dropdown alphabetically + added min-width:0 to stop dialog overflow; EC-PROJDROP-1/2 + full Gate B pass; PR #244 open
**Card:** Create Meeting Dialog Visual Fix
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Move Cross-Project]]
- [[Templating for project docs]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]

### In Progress
- [[Cross-blueprint templating and render consistency audit]]
- [[Workstreams in Projects need updating]]
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[Create Meeting Dialog Visual Fix]]

### Blocked
- [[List of templates not using separators]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Templating for project docs]]

## Notes
- DEPLOY (Phase A step 3): action=none — all 3 vaults current at shipped 0.179.2; allOk=true. (#240 meeting-Agenda release still building; ships next; not yet in the bottle.)
- RECONCILE: idle. Blocked: no responses. Discovered-lane: no changes.
- SELECTED (Phase B): "Create Meeting Dialog Visual Fix" (workstream meetings) — recommended-next.
- IMPLEMENTED: fix(entity-create) — TWO bugs in the Create-Meeting dialog project <select> (all_projects options_source). (1) SORT: _resolveOptionsSource returned dv.pages() vault/index order with no .sort() (Accuris showed some out-of-order); now case-insensitive localeCompare sort, (none) first. (2) WIDTH: the native <select> lacked min-width:0 so a long project name overflowed the dialog ~10px; added min-width:0 + max-width:100% so it shrinks to fit. One file (entity-create.js); confined to the project select.
- TEST: EC-PROJDROP-1 (alphabetical — mutation-verified vs no-sort AND case-sensitive-sort mutants) + EC-PROJDROP-2 (<select> style has min-width:0) in run-entity-create.js. 56/0.
- GATES: Gate A preflight 51/51 + install exit 0. Gate B L1 = behavioral:true, adequate (red-without/green-with). Gate B L2 3-lens panel = 0/3 refuted (the verifiers self-mutation-tested a case-sensitive-sort mutant and confirmed the test catches it).
- PR #244 opened on branch autoloop/meeting-project-dropdown-fix; auto-merge --squash armed (BEHIND — CI pending). Handoff committed LOCALLY only (PR open → no push).
