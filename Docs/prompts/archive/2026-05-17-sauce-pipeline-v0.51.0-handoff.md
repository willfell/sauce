# Sauce Pipeline Round 5 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.51.0
**Card completed:** [[Project status updates]] (Projects Blueprint sub-board) — closes out the Projects Blueprint workstream
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-17-v0.51.0-result.md`

## What shipped

NEW `ProjectStatusWidget` customjs class on every project hub. Colored status chip + "Updated YYYY-MM-DD" label; click → 7-option overlay (matches entity-create style) → writes `status` + `status_changed_at` via `app.fileManager.processFrontMatter`. New `## Status` H2 section in `Template, Project.md` between nav-buttons and `## Workstreams`. Closes the v0.39.0 `ProjectActionButtons` Tier-1 backlog (Bump Status only this round; Set Teams / Set Products deferred).

`project@1.10.4` → `1.11.0` MINOR; `workshop_version 0.50.5` → `0.51.0`. Test harness +6 (PSW-1..6 in `run-helper-cases.js`, total 712 pass). Preflight green.

## Board snapshot (after this round)

### In Planning (top-level `sauce-board.md`)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]
- [[Frontmatter Alignment]]

### Projects Blueprint sub-board (Planning column)
(empty — workstream closed)

### In Progress (top-level)
(empty)

### Blocked
(empty)

### Completed (top-level, most recent at top)
- [[Projects Blueprint]] (workstream) — 2026-05-17

### Completed (Projects Blueprint sub-board, most recent at top)
- [[Project status updates]] — v0.51.0 — 2026-05-17
- [[Project Buttons in tasks can be cluttered on phone]] — v0.50.5 — 2026-05-16
- [[Create will note is broken]] — v0.50.4 — 2026-05-16
- [[Wiki Area]] — v0.50.0 — 2026-05-16

## Deployment chain

| Tag | Tap PR | Brew | Headspace install | Hands-on smoke |
|---|---|---|---|---|
| v0.50.4 | (still pending merge from earlier rounds) | (pending) | (pending) | (pending) |
| v0.50.5 | (still pending merge) | (pending) | (pending) | (pending) |
| v0.51.0 | (auto-fires on tag push) | (pending merge) | (pending) | (pending) |

**Note:** three tags have stacked up since the last brew upgrade. If you merge all three tap PRs at once and run `brew upgrade sauce`, you get all three landing together — v0.51.0 supersedes v0.50.4 + v0.50.5 in the same `sauce reinstall --vault <headspace>` run. The wiki-fix (v0.50.4) and mobile-wrap (v0.50.5) ride alongside the status widget.

## Recommended next

- **Card:** [[Frontmatter Alignment]] (top-level)
- **Reason:** Mentioned in v0.50.4 + v0.50.5 handoffs as an alternate; earlier cycle notes reference an FA-1..FA-9 design inventory that may already exist (worth a quick scan first). Clears a long-standing top-level item. With the Projects Blueprint workstream closed, picking another top-level workstream wrapper opens a fresh sub-card cadence.

Alternates:
- **[[Convenience Functionality]]** — top-level card; user-mentioned in v0.50.5 bug card body, suggesting interest.
- **[[Bugs]]** — top-level catch-all container; would want sub-card pick first.

## Open questions / dependencies

- Three undeployed tags (v0.50.4 / v0.50.5 / v0.51.0). User can let the loop keep adding cycles (next picks pile on the same tag-train) or pause + deploy first. Either is fine; the deploy chain is idempotent.
- Whether the next pick should remain on the `sauce` project (top-level Planning) or expand to other projects entirely is purely a user-prerogative decision.

## FIX-LATER notes (carried over + new)

**New this cycle:**
- **FLN-5.** Set Teams + Set Products widgets (v0.39.0 Tier-1 bundle remainder) — follow-up cycle when needed.
- **FLN-6.** Shared `status-palette` helper for DRY across `projects-hub-cards.js` + `project-status-widget.js` — refactor when a third consumer needs the palette.
- **FLN-7.** Keyboard navigation in the picker overlay (arrow-keys + Enter). Defer until reported.
- **FLN-8.** Status-change history log (append-only timeline). Out of scope; existing `status_changed_at` stamps the latest only.

**Carried forward from earlier cycles:**
- **FLN-1.** `applyWikiBackfill` should be unconditional + repair 0-byte Wiki.md files (v0.50.3).
- **FLN-2.** Tap-merged + brew-upgraded + consumer-reinstalled + smoke validation gate in `/sauce-pipeline` Phase C (v0.50.3).
- **FLN-3.** EC-39's vault stub doesn't enforce parent-dir-exists like real Obsidian does (v0.50.4).
- **FLN-4.** AccentButton rows + other blueprints' nav-button renderers likely need wrap treatment (v0.50.5).
