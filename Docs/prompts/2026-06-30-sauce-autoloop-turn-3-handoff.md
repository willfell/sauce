# Sauce Autoloop Turn 3 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** blocked — re-blocked WITH visible in-card questions (turn 1 left only frontmatter, so the user moved it back to Planning). The card mixes one clean separable bug (Open Tasks links open the board, not the task note) with two asks that overturn documented conventions (literal `---` between content sections; New Meeting button below the Meetings list). Cannot implement the convention overrides unilaterally, and shipping a partial PR would mis-close the card on merge — so blocked with 4 concrete in-card questions under **Your response:**.
**Card:** Project Hub Style Fixing
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Board Note Template Fix from Projects Board]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]
- [[Project Hub Style Fixing]]

## Recommended next
- **Card:** [[Board Note Template Fix from Projects Board]]

## Notes
- VERIFIED conventions before blocking (note-chrome.md:22 = no literal --- between content sections; project-blueprint-ui.md:18 = EntityCreate + New button ALWAYS above the cards it seeds). Findings: (1) Status/Workstreams are live-rendered widgets with NO H2 headings — nothing to remove in the blueprint; user is likely seeing the live "Workstreams" SectionLabel or legacy materialized content in their Sauce.md, so I asked them to paste the exact lines. (2) Open Tasks → board is a REAL bug at platform/blueprints/project/helpers/project-open-tasks.js:45 (target = boardPath); convention-compatible + Node-testable; I offered to split it into its own card so the loop can ship it next turn. (3) The two convention conflicts (--- divider + button-below) each got an explicit a/b/c option set including "update the guide if you want the override." Once Will answers under **Your response:** in the card, Phase A reconcile unblocks it next turn. LOOP STATE: top Planning cards remain large/runtime-ish; collaborative-block is correctly converting them into answerable questions. Recommended next = "Board Note Template Fix from Projects Board" (likely the most bounded/testable of the remaining Planning cards) — but the selector will re-evaluate.
