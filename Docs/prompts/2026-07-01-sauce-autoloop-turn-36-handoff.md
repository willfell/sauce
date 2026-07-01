# Sauce Autoloop Turn 36 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** work -> PR #130 (auto-merge pending) — all-projects hub tweaks (group-by none, remove tag chips, no search persistence, SectionLabel headers, ## All Projects removal + heal); Gate A green, Gate B L1 adequate, L2 0/3 refuted
**Card:** Project hub Display tweaks
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Links]]
- [[Project Doc Updating]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### In Progress
- [[Workstreams in Projects need updating]]
- [[Project hub Display tweaks]]

### Blocked
- (empty)

## Recommended next
- **Card:** [[Next turn: reconcile #130 (admin-unstick if BEHIND) + deploy. After it ships (Cmd+R in Obsidian), pick the next fresh Planning card ([[Project Links]]).]]

## Notes
- deploy (Phase A step 3): action=none — all vaults current at 0.152.1 (single invocation this turn, per the deploy-executes lesson).

reconcile: idle. Blocked empty; Discovered-lane mirror no-op. Selector picked 'Project hub Display tweaks' (broadHint 'all blueprints/vaults' was a false alarm — it referred to migration reach, not scope).

IMPLEMENTED (card: Project hub Display tweaks — the All-Projects hub): (1) group-by defaults to NONE + projects ordered by last-updated (latestMtime DESC, already in place from v0.127.0); (2) tag/hashtag chip section REMOVED via new opt-in DocSearch `hideTags` (default off -> other hubs unaffected); (3) search box no longer persists via new DocSearch `persist` opt (persist:false skips BOTH localStorage save and restore -> always loads empty); (4) group headers use SectionLabel instead of raw <h3>; (5) `## All Projects` H2 removed from the template + a NEW idempotent install heal applyProjectsHubAllProjectsHeadingCleanup that strips it from the existing type:projects-hub note across vaults (.sauce-backup, fence-aware, hub-only). DocSearch opts are additive (default = legacy behavior).

Tests: PHUB-* in run-v0127-project-hub-heal.js (58/58): heal U1-U3 (strip/idempotent/fence-safe), I1-I2 (integration heal+backup+history+idempotent, non-hub untouched), source-lints L1-L6 (group-by none, SectionLabel-not-h3, hideTags+persist:false passed, doc-search honors hideTags, doc-search honors persist save+restore, template no ## All Projects).

GATES: Gate A green (release:preflight exit 0, 142/142 + install dogfood clean exit 0 — the heal stripped `## All Projects` from the workshop's own hub). Gate B L1: behavioral+adequate. Gate B L2 3-lens panel: 0/3 refuted — correctness+regression+test-adequacy all passed (confirmed hideTags/persist opts are non-breaking for the shared DocSearch callers ProjectDocsIndex + SectionHub, and the heal is correctly scoped + idempotent).

PR #130 opened, auto-merge armed. Card left In Progress with a status note. Note (non-blocking, from the panel): DocSearch's hideTags/persist have no DOM-level behavioral test (source-lint only) — matches the codebase's established DocSearch test posture.

Watch next turn: #130 will likely be BEHIND (fast pipeline); admin-unstick per the pr-open-deadlock lesson (verify zero base-file-overlap first). Standing: [[Workstreams in Projects need updating]] epic still parked; its plan slices want Planning cards.
