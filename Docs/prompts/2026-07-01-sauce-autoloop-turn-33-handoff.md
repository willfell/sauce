# Sauce Autoloop Turn 33 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** work -> PR #127 (auto-merge pending) — removed the blank line between the ProjectNavButtons row and the `---` separator across 4 templates + a recursive idempotent install heal for existing notes; Gate A green, Gate B L1 adequate, L2 1/3 (pass) with the dissent's gaps closed
**Card:** Project Card Separator Fix
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project hub Display tweaks]]
- [[Project Links]]
- [[Project Doc Updating]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### In Progress
- [[Workstreams in Projects need updating]]
- [[Project Card Separator Fix]]

### Blocked
- (empty)

## Recommended next
- **Card:** [[Next turn: reconcile #127 (admin-unstick if BEHIND) + deploy canaries v0.152.0 once shipped. Then pick the next fresh Planning card ([[Project hub Display tweaks]]).]]

## Notes
- deploy (Phase A step 3): action=none — installable shipped still 0.151.1 (main is 0.152.0 but the tag/brew build is still in flight). Nothing new to canary yet.

reconcile: idle. Blocked empty; Discovered-lane mirror no-op. Selector picked 'Project Card Separator Fix'.

IMPLEMENTED (card: Project Card Separator Fix): removed the stray blank line between the ProjectNavButtons button row and the `---` separator below it. (1) 4 templates (Kanban Card / Doc Note / Project Map / Section Hub) + their materialized ranch/templates copies now hug the separator; the ranch Kanban Card copy also had a pre-existing stale `---` position corrected by re-materialization. (2) NEW idempotent install heal applyProjectNavButtonsSeparatorGap (pure _collapseNavButtonsSeparatorGap) recursively walks spice/projects and collapses the same gap in existing project/card/doc/map/section notes — .sauce-backup, per-note try/catch, never throws, skips its own backup tree; mirrors applyProjectHubLegacyHeadingCleanup. Cleanup-type (ungated, safe every install).

Tests: NAV-SEP-* in run-v0127-project-hub-heal.js (43/43): pure-transform U1-U5 (blank removed / idempotent / multi-blank / leaves non-separator blank before a widget OR prose alone), integration I1-I3 (heal+backup+history+idempotent, non-navbuttons untouched, empty-vault no-throw), source-lints T1-T4 (blueprint templates) + Tranch (4 ranch copies).

GATES: Gate A green (release:preflight exit 0, 142/142 + install dogfood clean exit 0, heal exercised on the workshop vault). Gate B L1: behavioral+adequate. Gate B L2 3-lens panel: 1/3 refuted -> PASS (correctness+regression cleared; the panel confirmed `---` after a closed code fence is a CommonMark thematic break so no blank is needed to render the HR). The lone test-adequacy dissent flagged missing ranch-template + blank-before-prose coverage; BOTH were added before opening the PR (Tranch x4 + U5).

PR #127 opened, auto-merge armed. Card left In Progress with a status note. NOTE (non-blocking): between card selection and Phase D this turn, the card's user-written instruction prose disappeared from the note body — NOT caused by this turn (install ran only against the worktree/workshop, never the consumer vault); likely a user/Obsidian edit. Flagging for visibility.

Watch next turn: #127 will likely be BEHIND (fast pipeline) once 0.152.0 tags; if so, admin-unstick it (non-release, green-CI) per the turn-29 lesson. Then reconcile closes the card in the version it ships. Standing: [[Workstreams in Projects need updating]] epic still parked; its plan slices want Planning cards.
