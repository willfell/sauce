# Sauce Autoloop Turn 30 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** work -> PR #124 (auto-merge pending) — daily-hub scratch section opens by default + renders oldest-first via opt-in ActivityFeed ascendingGroups; Gate A green, Gate B L1 adequate, L2 0/3 refuted
**Card:** Daily Hub Scratch Notes
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Card Separator Fix]]
- [[Project hub Display tweaks]]
- [[Project Links]]
- [[Project Doc Updating]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### In Progress
- [[Workstreams in Projects need updating]]
- [[Daily Hub Scratch Notes]]

### Blocked
- (empty)

## Recommended next
- **Card:** [[After #124 merges + deploys (Cmd+R in Obsidian), pick the next fresh Planning card ([[Project Card Separator Fix]]). Optional follow-up: flip the scratch hub (scratch-day-list.js) to oldest-first to fully match the daily hub.]]

## Notes
- deploy (Phase A step 3): action=none — all vaults current at 0.151.1.

reconcile: idle (the turn-29 pr-open deadlock on #117 is cleared). Blocked column empty. Discovered-lane mirror: no queue items. Selector picked the first Planning card: Daily Hub Scratch Notes.

IMPLEMENTED (card: Daily Hub Scratch Notes): (1) the daily-hub scratch section now OPENS by default (daily dashboard defaultClosed: [] — scratch removed); (2) scratch notes render OLDEST-first (order made through the day) via a NEW opt-in ActivityFeed opt `ascendingGroups` (Pass B.5 sorts listed groups ascending by created_at; forwarded through render()). Default empty => zero blast radius for all other ActivityFeed consumers. Ranch dogfood copies synced byte-equal.

Tests: AF-ASC-1 (shuffled 09,10,08 -> asserts 08<09<10; mutation-verified red if sort disabled OR reversed), AF-ASC-2 (opt-off default unchanged), AF-ASC-3 + HC-V070-1e/1i (daily wiring source-lint). Also updated the pre-existing HC-V070-1e which had codified the OLD 'defaultClosed contains scratch' behavior.

GATES: Gate A green (release:preflight exit 0, 3751 passed; install dogfood clean exit 0). Gate B L1 mutation: behavioral=true, adequate=true. Gate B L2 3-lens adversarial panel: 0/3 refuted — correctness refuted:false, regression refuted:false, test-adequacy refuted:false (test-adequacy lens independently mutation-tested that disabling/reversing the sort fails AF-ASC-1b).

PR #124 opened, auto-merge armed (CI-gated). Card left In Progress with a 'PR open, auto-merge pending' note. Next turn's reconcile closes it on merge+ship.

FLAGGED (non-blocking, surfaced not assumed): the card said 'align with the scratch hub', but the scratch hub (scratch-day-list.js) currently sorts mtime-DESCENDING (newest-edited first) — opposite of oldest-first. This PR implements the primary/repeated intent (daily hub oldest-first). If the user wants the scratch hub to match, it's a one-line comparator follow-up (noted in the PR).

Watch: per the turn-29 lesson, if the busy release pipeline re-stales #124 to mergeable:UNKNOWN, next turn should admin-merge it (non-release, green-CI) rather than wait.
