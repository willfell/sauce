# Sauce Autoloop Turn 124 — handoff

**Date:** 2026-07-02
**Mode:** live
**Outcome:** implemented (doc-note Move-button separator tighten — PR open) — removed the blank line above the doc-note Move button + DNT-1 regression; PR #247 open, auto-merge armed
**Card:** Templating for project docs
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Move Cross-Project]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]

### In Progress
- [[Cross-blueprint templating and render consistency audit]]
- [[Workstreams in Projects need updating]]
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[Templating for project docs]]

### Blocked
- [[List of templates not using separators]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Workstreams Hub Slice 3 - relocate manager to Map note]]

## Notes
- DEPLOY (Phase A step 3): action=none — all 3 vaults now current at shipped 0.180.0 (bottle published; FOUR cards live: Map-identity #232, daily #234, separators #236, meeting-Agenda #240). #244 project-dropdown ships in the next release. Cmd+R in Obsidian to load 0.180.0.
- RECONCILE: idle. Blocked: no responses. Discovered-lane: no changes.
- SELECTED (Phase B): "Templating for project docs" (workstream projects) — recommended-next.
- IMPLEMENTED: fix(project) — removed the blank line between the --- chrome divider and the DocLeafActions (Move button) block in the Doc Note template, so the Move button sits tight against its separator (---\n<block>). Template-only per the card; existing doc-notes untouched, and the DocLeafActions backfill heal (_injectDocLeafActionsBody, fires only on notes lacking the block) is out of scope.
- TEST: DNT-1 (run-helper-cases.js) asserts the tight ---\n<DocLeafActions block> shape + no blank under the divider; mutation-verified red-on-reintroduced-blank. Helpers 3902/0.
- GATES: Gate A preflight 55/55 + install exit 0. Gate B L1 = behavioral:false vs origin/main (template + test = doc-class) → panel not required; DNT-1 guards it in preflight.
- PR #247 opened on branch autoloop/docnote-tight-separator; auto-merge --squash armed (BLOCKED — CI pending). Handoff committed LOCALLY only (PR open → no push).
- PLANNING now holds only the Workstreams Hub slices 3-6 (user moved them out of Blocked earlier); they likely gate on Slice 2 (In Progress). Next idle turn: selectCard will skip dependency-blocked slices → Scout/bug-hunt fallback if nothing eligible.
