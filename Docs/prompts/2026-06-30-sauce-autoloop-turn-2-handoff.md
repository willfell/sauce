# Sauce Autoloop Turn 2 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** blocked — multi-surface project-blueprint re-architecture (new per-project workstream hub note + relocate the create/remove/update manager + new "Workstreams" nav button + heal over existing project notes) — too big + interdependent for one bounded turn, Obsidian-runtime so not Node-testable, and needs design decisions only the user can make. Blocked-with-questions in the card.
**Card:** Workstreams in Projects need updating
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Hub Style Fixing]]
- [[Editing To Do Items in a Project]]
- [[Board Note Template Fix from Projects Board]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[Project Hub Style Fixing]]

## Notes
- Selector honored turn 1's recommendedNext and picked "Workstreams in Projects need updating". Read against the project-blueprint code, the card is a multi-surface re-architecture, not a bounded bug: (1) workstreams are a `workstreams` frontmatter array ON the project hub note — both ProjectWorkstreamManager and the Map view read `current.workstreams` from there, so "move them to their own hub" forces a source-of-truth data decision with cross-cutting reader changes; (2) each project already has a Map note rendering ProjectWorkstreams, so "new hub note" is ambiguous vs. that; (3) removing the section from existing project hubs (Sauce.md) needs a one-time version-gated heal over user content; (4) the manager UI is Obsidian-runtime (dogfood-only modals) so it cannot be end-to-end regression-tested in the Node harness. Used block-with-questions: appended an in-card "needs your input" section with 6 concrete design questions; card moved In Planning -> Blocked (board + frontmatter status:blocked). Next turn, Phase A reconciles Will's in-card reply.  LOOP STATE — design-decision backlog: the top Planning cards are all large features / runtime investigations, not bounded testable bugs (Project Hub Style Fixing = convention conflicts + heal; Figure out ...Edit Mode = third-party plugin investigation). The loop is correctly using collaborative-block to turn these into answerable questions; once Will answers any blocked card in-card, the loop splits it into bounded, shippable slices. NOTE: turn 1 blocked "Project Hub Style Fixing" but only set frontmatter + a workshop-repo handoff (no in-card questions Will could see), and Will moved it back to In Planning. Recommended next is to give that card the same in-card block-with-questions treatment.
