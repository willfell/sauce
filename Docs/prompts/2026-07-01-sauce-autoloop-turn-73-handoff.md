# Sauce Autoloop Turn 73 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** merged — recorded #167 merged in 0.163.4; reconcile idle. Bottle-lag root cause = tap bottle artifact for 0.163.1-4 not published (release infra, out of scope); ~6 fixes queued on main, deploy when tap catches up.
**Card:** consistency-audit C3 cowork header (PR #167)
**Version shipped:** 0.163.4

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Updating Wiring PR2 - move dialog]]
- [[Project Doc Updating Wiring PR3 - bulk move dialog]]
- [[Project Links Wiring PR2 - link dialogs]]
- [[Project Links Wiring PR3 - existing-project backfill]]
- [[Project Doc Move Cross-Project]]
- [[Cross-blueprint templating and render consistency audit]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Cross-blueprint templating and render consistency audit]]

## Notes
- AUTONOMOUS MODE (15-min). reconcile=merged: PR #167 (consistency-audit C3 cowork dv.header x4 -> SectionLabel) merged in 0.163.4; recorded (substrate). reconcile now idle. deploy: action=none — all 3 vaults at 0.163.0. *** BOTTLE-LAG ROOT CAUSE (needs USER; NOT autoloop-fixable) ***: main + git tags are current at v0.163.4 and release.yml SUCCEEDS (tags + opens auto-merged tap PR); the tap Formula (willfell/homebrew-sauce) references v0.163.4 and has NO open PRs. BUT the installable BOTTLE ARTIFACT for 0.163.1-0.163.4 is not published, so `brew upgrade sauce` can't advance the installed bottle past 0.163.0. deploy.js is CORRECT (reads the installed bottle version, tries upgrade, waits per its design comment 'a later turn retries until the tap catches up') — this is a tap bottle-BUILD/publish issue in the willfell/homebrew-sauce repo (release infra, outside autoloop scope; must not hand-touch). Consequence: ~6 gated fixes (v0.160.x-0.163.4: project-links PR1, task-entity deploy fix already live, finance-nav #160, token-leaks #163, to-do-h2 #165, cowork-header #167 + the parallel job's #162 classref guard) are safely tagged on main but NOT yet in the vaults; they deploy in ONE pass the moment the tap publishes the 0.163.4 bottle. Suggest the user check the tap's bottle-build workflow. ROADMAP unaffected: consistency-audit card in Planning; remaining findings — orphaned project-docs-sections.js removal, note-chrome non-adoption (finance/trips/people/products/teams), {{views_path}} vs ranch/views sweep; delicate finance paycheck birth-schema fork. Workstreams Slices 2-6 Blocked on the user's map-detection + union-vs-map-wins decision. The loop keeps shipping gated fixes to main regardless of the bottle lag.
