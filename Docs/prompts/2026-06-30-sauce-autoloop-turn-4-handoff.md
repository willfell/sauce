# Sauce Autoloop Turn 4 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** implemented + PR opened — fixed the Kanban Card template chrome — removed the literal `---` between SpaceNavButtons and ProjectNavButtons (ProjectNavButtons emits its OWN topDivider <hr>, so the literal rule produced the DOUBLED divider the user reported) and added a trailing `---` after ProjectNavButtons (chrome was running into user content). Convention-ALIGNED (matches canonical Project Map.md + note-chrome.md §1) — no override. Shipped with regression test TPL-B-6 (mutation-verified red-without/green-with). PR #77 open, auto-merge enabled (squash), waiting on CI.
**Card:** Board Note Template Fix from Projects Board
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

### In Progress
- [[Board Note Template Fix from Projects Board]]

### Blocked
- [[Workstreams in Projects need updating]]
- [[Project Hub Style Fixing]]

## Recommended next
- **Card:** [[Editing To Do Items in a Project]]

## Notes
- Card was the most-bounded Planning item (recommended by turn 3). Root-caused complaint #1 (doubled divider) to project-nav-buttons.js:559 topDivider + the templates literal --- = two <hr>s; SpaceNavButtons emits no divider of its own. Complaint #2 (no trailing rule) = template ended after ProjectNavButtons. Fix = 4-line template edit matching Project Map.md. Gate A: release:preflight exit 0 (all suites green incl. new TPL-B-6) + dogfood install exit 0. Gate B Layer 1: behavioral:false (template .md + test .js are both non-source per the gates classifier) -> Layer 2 (3-lens panel) correctly SKIPPED per skill; the layout change is fully pinned by TPL-B-6 which I mutation-verified by hand (stash template -> 6.4+6.5 FAIL -> restore -> pass). PR #77 --auto --squash, mergeStateStatus BLOCKED = waiting on required CI checks (normal). Next turn Phase A reconcile: merged -> close card to Completed; CI-fail/closed -> Blocked. TWO observations for the user: (1) PRE-EXISTING dogfood drift — running `node platform/install.js --vault .` re-materializes ~13 tracked ranch/ files + 2 new ranch/scripts/project/ helpers that are NOT committed on main; the workshops own ranch/ is out of sync with blueprint sources (orthogonal to this card; discarded from the PR). (2) Sibling Task Note.md template has the SAME inter-tier --- + ProjectNavButtons topDivider doubling and no trailing rule — a likely follow-up card. Two cards remain Blocked awaiting Wills in-card replies (Project Hub Style Fixing, Workstreams in Projects need updating).
