# Sauce Autoloop Turn 41 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** research + block-with-questions — research card: inspected shipped+headspace config (correct on paper) + web-searched; posted a diagnosis (plugin swaps a real file into the leaf so 'default view for new tabs' doesn't apply; reading-mode enforcement undercut by created-daily-notes + the plugin being in maintenance mode) + 3 fix options + 4 questions; moved to Blocked
**Card:** Figure out Why Opening up a New Tab always opens up in Edit Mode
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[To do tasks daily and other]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Project Links]]
- [[Project Doc Updating]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

## Recommended next
- **Card:** [[Next turn: leave the 3 Blocked cards (awaiting your replies) and pick the last fresh Planning card ([[To do tasks daily and other]]). Answering any blocked card unblocks the loop to act on it.]]

## Notes
- deploy (Phase A step 3): action=none — installable brew bottle STILL 0.152.1. v0.153.0 tagged ~5-6 turns ago but its brew bottle has NOT published; the projects-hub feature isn't on the vaults yet. The release->brew-tap build for 0.153.0 looks stuck and is worth a look (pipeline's domain).

reconcile: idle. Blocked reconcile: all three prior blocked cards still hasResponse:false ([[Project Links]], [[Project Doc Updating]]) -> left Blocked. Selector picked 'Figure out Why Opening up a New Tab always opens up in Edit Mode' — a RESEARCH card (the user asked to research + web-search + outline thoughts + move to Blocked with questions).

RESEARCH + BLOCK (card: new-tab-opens-in-edit-mode): Inspected shipped + headspace config (both correct on paper: app.json defaultViewMode:preview + livePreview:true; plugin new-tab-default-page v0.11.9 mode:reading-mode, whatToOpen:daily-notes, compatibilityMode:false) and web-searched. DIAGNOSIS posted to the card: 'Default view for new tabs' only governs an EMPTY leaf; the plugin swaps in a real FILE (the daily note) whose mode is then governed by the default EDITING mode / remembered state, and the plugin's reading-mode enforcement is undercut by (a) freshly-created daily notes always opening in edit mode and (b) the plugin being in maintenance mode + racing Obsidian's default. Gave 3 fix options (A: compatibilityMode:true; B: fixed home note; C: Sauce-owned startup script that force-sets reading mode) + 4 questions. Card moved to Blocked; parseBlockedResponse hasSection:true, hasResponse:false.

No workshop code changed this turn (research + block-with-questions is card+board only). THREE design/research cards are now Blocked awaiting your input: [[Project Links]] (Helpful Links), [[Project Doc Updating]] (move-doc-between-sections), [[Figure out Why Opening up a New Tab always opens up in Edit Mode]] (diagnosis + fix-path). Each has concrete options + recommendations — quick replies unblock the loop.

Only ONE fresh Planning card remains: [[To do tasks daily and other]]. Next turn: leave the 3 Blocked; pick that card. After it, the loop will have exhausted fresh Planning work — it'll consult the Scout queue / bug-hunt (or idle) until you answer a blocked card or add new cards. Standing: [[Workstreams in Projects need updating]] epic still parked; its plan slices want Planning cards.
