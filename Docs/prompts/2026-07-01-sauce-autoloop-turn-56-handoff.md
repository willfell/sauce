# Sauce Autoloop Turn 56 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** blocked — unblocked on user reply then re-blocked on a newly-discovered cross-vault deploy landmine (project->links dep would silently freeze project updates on all 3 consumer vaults); needs Option A/B decision
**Card:** Project Links Wiring
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Workstreams Hub Slice 0 - vault analysis]]
- [[Workstreams Hub Slice 1 - source-of-truth read helper]]
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]
- [[Project Doc Updating Wiring PR2 - move dialog]]
- [[Project Doc Updating Wiring PR3 - bulk move dialog]]
- [[Project Doc Move Cross-Project]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Project Links Wiring]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Workstreams Hub Slice 0 - vault analysis]]

## Notes
- deploy: action=none, target=0.157.0 (shipped); all 3 vaults (ero/accuris/headspace) verified current — allOk. reconcile=idle. Blocked-column pass: 'Project Links Wiring' had a user reply ('yes to all') that resolved the DESIGN questions, so it briefly unblocked to In Progress as the turn's work (PR1: Link Hub foundation). STOP / re-block (implementation-discovery landmine): a hard project->links dependency (the approved strategy) would SILENTLY FREEZE all project-blueprint updates on all three consumer vaults after release, because 'links' is unsubscribed on ero/accuris/headspace and `sauce update --bump-pins` only re-pins ALREADY-subscribed items (install.js checkDeps marks the blueprint unfit + skips it). Verified reading install.js:1349-1394 (checkDeps) + cmd-update.js:126-238 (handleBumpPins). Re-blocked-with-questions on the ONE new decision (design stays settled): Option B (RECOMMENDED) = inline the read-only links render inside ProjectLinksPanel (no new dependency, zero cross-vault edits, works on all vaults at release); Option A = real dependency + user authorizes adding {name:links,version:0.2.0} to all 3 consumer subscriptions. One-word reply unblocks; next turn ships PR1 end-to-end. No workshop files changed this turn (no worktree, no commits). Card + board moved back to Blocked.
