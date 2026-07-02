# Sauce Autoloop Turn 117 — handoff

**Date:** 2026-07-02
**Mode:** live
**Outcome:** implemented (3-template chrome tighten — PR open) — tightened LeafActions/ScratchDayActions rows against --- separators in to-do/meetings/scratch templates + LAT-1 regression; PR #236 open, auto-merge armed
**Card:** To Do Daily Note Template enhancements
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Move Cross-Project]]
- [[Meeting Template Update]]
- [[Create Meeting Dialog Visual Fix]]
- [[Templating for project docs]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]

### In Progress
- [[Cross-blueprint templating and render consistency audit]]
- [[Workstreams in Projects need updating]]
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[To Do Daily Note Template enhancements]]

### Blocked
- [[List of templates not using separators]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Meeting Template Update]]

## Notes
- DEPLOY (Phase A step 3): action=none — all 3 vaults current at 0.178.5; allOk=true. (Release pipeline still has v0.178.6 release PR #233 in flight for #232; #234 daily-template also merged, awaiting a bottle.)
- RECONCILE: idle. Blocked column: no card had a user response. Discovered-lane mirror: no changes. (NOTE: user moved Workstreams Hub Slice 3/4/5/6 from Blocked → In Planning out-of-band — they are now selectable but depend on Slice 2; left as-is.)
- SELECTED (Phase B): "To Do Daily Note Template enhancements" (workstream to-do-blueprint) — the recommended-next card.
- IMPLEMENTED: fix(chrome) — tightened the leaf-action button rows against their --- separators in THREE templates (Today To-Do.md/ToDoLeafActions, Meeting.md/MeetingLeafActions, Scratch Day Hub.md/ScratchDayActions). Each went from `---\n\n<block>\n\n---` to `---\n<block>\n---` (blank-line gaps removed, separators kept — per the card text + the scratch example). Template-only, matching the card; the install migrations that rebuild legacy-shape notes (_reshapeToV040, gated to old v0.3.3/v0.4.0 shapes) + the idempotent meeting-inject heal are untouched, so nothing fights the change; existing per-day/per-meeting notes tighten on next creation.
- TEST: LAT-1 (run-helper-cases.js) asserts the tight `---\n<block>\n---` shape + no blank under the divider for all 3 templates; mutation-verified red-on-reintroduced-blank. Helpers 3899/0.
- GATES: Gate A preflight 46/46 + install exit 0 (materialized ranch/templates/* verified). Gate B L1 = behavioral:false (templates + test = doc-class per splitDiff) → Gate B panel not required; LAT-1 guards it in preflight.
- PR #236 opened on branch autoloop/leafactions-tight-separators; auto-merge --squash armed. Handoff committed LOCALLY only (PR open → no push, avoids re-staling #236).
