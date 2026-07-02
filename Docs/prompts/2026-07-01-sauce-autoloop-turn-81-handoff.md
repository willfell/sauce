# Sauce Autoloop Turn 81 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** pr-opened — Built ProjectLinksManager (Add/Manage link modals on the Link Hub, pure CRUD) + a project-hub read-only mirror in ProjectLinksPanel (type:project resolves sibling Links Hub). Gate A green; Gate B L1 adequate:true; Gate B L2 FIRST pass 2/3 refuted (blocked) — the manager was only in the Templater template, not the entity-create inline_body / backfill _linksHubBody that actually create Link Hub notes, so it reached no real note; fixed (added to both, byte-equal so HC-PLHB-G parity holds) + added PLB-P6/P7 + folder-scoped-query coverage -> re-review 0/3 refuted. PR #179 auto-merge armed.
**Card:** Project Links Wiring PR2 - link dialogs
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- (empty)

### In Progress
- (empty)

### Blocked
- (empty)

## Recommended next
- **Card:** [[Planning is now EMPTY — the whole Project Links Wiring epic (PR1 foundation, PR2 dialogs, PR3 backfill) and the whole Project Doc Updating Wiring epic are shipped. Next idle turn: the loop consults the Scout queue, then runs the deterministic Scout / one bounded bug-hunt pass to generate fresh work. Two flagged follow-ups worth cards: (a) heals to inject DocLeafActions / DocBulkMoveActions into EXISTING doc notes + Docs hubs (both reach new notes via templates only); (b) the Blocked Workstreams Slices 2-6 remain pending the user's map-detection + union-vs-map-wins decision.]]

## Notes
- deploy: all 3 vaults current (0.167.x). #173 bulk-move shipped v0.166.0; user PRs #174/#177/#178 advanced the tap in parallel.,reconcile: idle at turn start; implemented PR2 link dialogs.,Gate B L2 adversarial panel earned its keep AGAIN: first pass found the manager was wired only into the Templater template, not the two real create paths (entity-create inline_body + backfill _linksHubBody) — buttons would reach no real note. Fixed both (byte-equal) + strengthened tests; re-review clean.,Option B preserved throughout (no project->links dependency; reuses ProjectLinksPanel._parse).,Blocked column unchanged: Workstreams Slices 2-6, New-Tab-edit-mode, To-do-daily — all await user response.
