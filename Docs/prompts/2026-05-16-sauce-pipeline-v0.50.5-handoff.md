# Sauce Pipeline Round 4 — handoff for next round

**Date:** 2026-05-16
**Workshop version shipped:** v0.50.5
**Card completed:** [[Project Buttons in tasks can be cluttered on phone]] (Projects Blueprint sub-board)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-16-v0.50.5-result.md`

## What shipped

A 3-line CSS fix to `ProjectNavButtons.render()`:
- Container: `flex-wrap: nowrap` → `wrap`
- Button: `flex: 1; min-width: 0` → `flex: 0 1 auto`
- Label span: added `white-space: nowrap` so buttons wrap to new flex rows instead of labels wrapping inside

Wide desktop look unchanged; narrow desktop windows + mobile now wrap gracefully. No buttons or labels removed. `project@1.10.3` → `1.10.4` PATCH; workshop `0.50.4` → `0.50.5`. Test coverage +3 sub-asserts (PNB-WRAP-1..3 in `run-helper-cases.js`). Preflight green.

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
- [[Project status updates]]

### In Progress (workstream container — top-level board)
- [[Projects Blueprint]] (1 sub-card remaining)

### Blocked
(empty)

### Completed (sub-board, most recent at top)
- [[Project Buttons in tasks can be cluttered on phone]] — v0.50.5 — 2026-05-16
- [[Create will note is broken]] — v0.50.4 — 2026-05-16
- [[Wiki Area]] — v0.50.0 — 2026-05-16

## Deployment chain

| Tag | Tap PR | Brew | Headspace install | Mobile smoke |
|---|---|---|---|---|
| v0.50.5 | (auto-fires on tag push) | (pending merge) | (pending) | (pending — see "User smoke step") |

## User smoke step

After `brew upgrade sauce` and tap PR merge, then `sauce reinstall --vault <headspace>` + Obsidian Cmd-R, on mobile:

1. Open any project's hub note (`spice/projects/<slug>/<Project Name>.md`).
2. The Project nav-button row should fit on screen — either single-row (if button labels are short) or wrapped to a second row (if any label is long).
3. Navigate into a task-board-card (e.g., `spice/projects/sauce/tasks/Convenience Functionality/board/Frontmatter Default Doesn't Show/Frontmatter Default Doesn't Show.md`). The 3-button row (Card Board · Task · Project Hub) should wrap if needed, with no truncated/squished labels.

## Recommended next

- **Card:** [[Project status updates]] (sub-card of Projects Blueprint workstream — the last remaining sub-card)
- **Reason:** Closes out the Projects Blueprint workstream, freeing the top-level In Progress slot for a new workstream pick. Adjacent to v0.50.x work — touches project frontmatter / status enum / hub display.

Alternates:
- [[Frontmatter Alignment]] — top-level card; design inventory (FA-1..FA-9) mentioned in earlier cycle notes.
- [[Convenience Functionality]] — top-level card; the user's bug card body specifically references this workstream's sub-cards as the visual reproducer for v0.50.5, suggesting interest in addressing related polish.

## Open questions / dependencies

- Mobile smoke deferred to user. v0.50.4 and v0.50.5 both depend on tap-merged + brew-upgraded deploys; if the user picks up another round before merging tap PR #35 (v0.50.5 auto-bump), the next cycle's changes ride alongside on the same tag.
- The `task-hub` and `task-note` AccentButton rows (Create Board / Bump Status / Set Teams / Set Products) may have the same crowding issue — separate inspection cycle (captured as FLN-4 in the v0.50.5 result doc).

## FIX-LATER notes (carried over from prior cycles)

- **FLN-1.** `applyWikiBackfill` should be unconditional + repair 0-byte Wiki.md files (v0.50.3 hotfix handoff).
- **FLN-2.** Tap-merged + brew-upgraded + consumer-reinstalled + smoke validation gate codified in `/sauce-pipeline` Phase C (v0.50.3).
- **FLN-3.** EC-39's vault stub doesn't enforce parent-dir-exists like real Obsidian does (v0.50.4).
- **FLN-4 (new).** AccentButton rows + other blueprints' nav-button renderers likely need the same wrap treatment (v0.50.5).
