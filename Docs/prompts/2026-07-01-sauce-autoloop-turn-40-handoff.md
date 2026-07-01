# Sauce Autoloop Turn 40 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** block-with-questions (grounded design) — complex Obsidian-runtime feature (move a doc between sections/sub-sections); investigated the docs/sections model and posted a grounded design + 5 decisions (with recommended defaults) + a testability caveat to the card; moved to Blocked
**Card:** Project Doc Updating
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Project Links]]
- [[Project Doc Updating]]

## Recommended next
- **Card:** [[Next turn: leave Project Links + Project Doc Updating Blocked (awaiting your replies) and pick the next fresh Planning card ([[Figure out Why Opening up a New Tab always opens up in Edit Mode]]).]]

## Notes
- deploy (Phase A step 3): action=none — installable brew bottle STILL 0.152.1. **FLAG:** v0.153.0 has been tagged for ~4-5 turns but its brew bottle has NOT published, so the projects-hub feature (v0.153.0) still isn't on the vaults. The release->brew-tap build for 0.153.0 may be stuck/slow and is worth a look (pipeline's domain — not touched here). Features shipped in 0.152.0/0.152.1 remain live.

reconcile: idle. Blocked reconcile: [[Project Links]] still hasResponse:false (awaiting your reply) -> left Blocked. Selector then picked 'Project Doc Updating'.

BLOCKED-WITH-QUESTIONS (grounded design) — card 'Project Doc Updating': the ask is to move a doc between sections/sub-sections within a project. The card said 'think long and hard on what it would look like'. I investigated the current model first (project sections[] -> section-hub notes under docs/<slug>/ at depth 1/2; each doc-note carries section/sub_section frontmatter AND lives in the matching folder), then posted a concrete design + 5 decisions (each with a recommended default) + 1 testability heads-up to the card: (1) move semantics = relocate the file via renameFile + re-tag frontmatter (vs re-tag only); (2) affordance placement (Section Hub / Docs index / both); (3) sub-section targeting; (4) same-project-only for v1; (5) migration = a safety-net section-frontmatter backfill heal; plus the caveat that the file move is Obsidian-runtime (only pure helpers get harness tests). Card moved to Blocked; parseBlockedResponse confirms hasSection:true, hasResponse:false.

No workshop code changed this turn (block-with-questions is card+board only). TWO design cards are now Blocked awaiting your input: [[Project Links]] (Helpful Links feature) and [[Project Doc Updating]] (move-doc-between-sections) — both have concrete designs with recommended defaults; a quick 'yes to all' on either unblocks the loop to build it.

Next turn: leave both Blocked; Phase B picks the next fresh Planning card ([[Figure out Why Opening up a New Tab always opens up in Edit Mode]]). Standing: [[Workstreams in Projects need updating]] epic still parked; its plan slices want Planning cards.
