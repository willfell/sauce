# Sauce Autoloop Turn 51 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** collaborative research (per user reply) -> re-blocked with findings — User's Blocked reply asked me to research web+context7 for Obsidian task solutions rather than answer the design questions. Did the research (web ok; context7 tool erroring), wrote findings + a Sauce-tailored recommendation + a refined 3-part decision INTO the card, and re-blocked (fresh **Your response:** marker -> parseBlockedResponse hasResponse:false, no self-trigger). Card stays Blocked awaiting the user's option pick. No code/PR this turn.
**Card:** To do tasks daily and other
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Links Wiring]]
- [[Project Doc Updating Wiring]]
- [[Project Doc Move Cross-Project]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Project Links Wiring]]

## Notes
- Deploy (Phase A step 3): action=none, bottle 0.155.0, all 3 vaults current. (main 0.156.0 + release PR #142 v0.157.0 still churning through the pipeline; cosmetic — no consumer waiting.) RESEARCH DELIVERED into card 'To do tasks daily and other' (user requested web+context7 search for streamlining Obsidian tasks). Findings: Obsidian Tasks plugin + Dataview keep tasks as raw markdown (do NOT fix the mobile wipe; Tasks even warns vs Live-Preview checkbox toggling); TaskNotes uses one-note-per-task + YAML frontmatter which STRUCTURALLY prevents 'edit one task wipes others'; Operon similar. The wipe is a known Obsidian mobile/sync class of bug; our today-capture-editable-list.js whole-note rewrite is the prime suspect. RECOMMENDATION written into the card: (1) fix the wipe first as a bounded, testable bug (write-guard: re-read+merge, never clobber unseen lines); (2) for the redesign, DON'T add a 3rd-party plugin — build a NATIVE TaskNotes-style task-entity mechanism on Sauce's existing entity-create + live-render (note-per-task + frontmatter), one reusable mechanism rolled out surface-by-surface (to-do first). Re-blocked with a 3-part decision (fix-wipe-now? / redesign direction A|B|C / shared-scope?). context7 MCP tool erroring on every call this turn (resolve-library-id input-validation: alternately rejects `query` then `libraryName`) — used WebSearch + WebFetch instead; note for future turns. NEXT TURN: if the user picks options in the card -> unblock + implement (likely the bounded wipe-bug fix first). Else Phase B selects 'Project Links Wiring' from Planning (recommended next; large phase-2 feature, expect scope-split). Other Blocked card 'New Tab Edit Mode' still has no reply.
