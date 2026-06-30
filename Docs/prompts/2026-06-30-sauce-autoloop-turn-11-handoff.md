# Sauce Autoloop Turn 11 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** merged -> card closed — PR #88 MERGED, shipped in v0.145.1. Closed the card: board In Progress -> Completed ([x]); frontmatter status:done + completed_in_version:v0.145.1. This was the #4 split of Project Hub Style Fixing — all three actionable splits of that card (button removal, this open-tasks link fix) are now shipped; only #3 (the legacy-H2 heal) remains as its own Planning card.
**Card:** Open Tasks links should open the task note
**Version shipped:** v0.145.1

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Heal legacy Status and Workstreams headings in project hubs]]
- [[To Do number on daily note to show to items for all]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[Heal legacy Status and Workstreams headings in project hubs]]

## Notes
- Clean merged-close under the hardened skill (lock acquired+released; no worktree needed). Three consecutive autoloop PRs have now shipped end-to-end: #77 (Kanban Card divider, v0.142.0/.1), #80 (remove New Meeting button, v0.142.2), #88 (Open Tasks -> task note, v0.145.1). Substrate is solid: turn-lock + worktree isolation have prevented any collision since turn 7. ONE remaining hardening gap: the reconcile merged-deadlock ledger (reconcile-inflight.js still has no reconciled-PR tracking) — next turn reconcile will re-fire merged #88 but the card is now Completed, so treat merged-but-already-closed as IDLE and proceed to select. Recommended next = [[Heal legacy Status and Workstreams headings in project hubs]] (the users emphatic ask: strip the literal ## Status/## Workstreams H2s from pre-v0.109.0 project hubs like their Sauce.md via a heal mirroring applyDocNoteBreadcrumbMarkerCleanup — idempotent, fence-aware, .sauce-backup, type:project scope). Workstreams in Projects need updating remains Blocked awaiting a reply.
