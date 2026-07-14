# Sauce Pipeline Round 1 — handoff for next round

**Date:** 2026-05-16
**Workshop version shipped:** v0.50.0
**Card completed:** [[Wiki Area]] (Projects Blueprint workstream sub-card)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-16-v0.50.0-result.md`

## Board snapshot (after this round)

### In Planning (top-level `sauce-board.md`)
- [[Projects Blueprint]] (workstream container; 2 sub-cards remaining in its sub-board)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### Projects Blueprint sub-board (Planning column)
- [[Project status updates]]
- [[Project Buttons in tasks can be cluttered on phone]]

### In Progress
(empty)

### Blocked
(empty)

### Completed (most recent at top)
- [[Wiki Area]] — v0.50.0 — 2026-05-16

## Recommended next

- **Card:** [[Project Buttons in tasks can be cluttered on phone]] (sub-card of Projects Blueprint workstream)
- **Reason:** Concrete, bounded UI scope; touches the same `project-nav-buttons.js` surface I just modified in v0.50.0 so context is fresh. Mobile cleanup of the buttons row (likely a flex-wrap / overflow / icon-only-on-narrow viewports adjustment). Smaller cycle than [[Project status updates]], which sounds broader.

Alternate pick: [[Project status updates]] (Projects Blueprint) — broader, may bundle several status/workflow UI bumps; still bounded but larger surface.

## Open questions / dependencies

- Pre-v1.4.0 projects (no `type: project` frontmatter field) are skipped by `applyWikiBackfill` with a clear warning. If any consumer vault hits this, the workaround is to manually add `type: project` to the project root note's frontmatter, then re-run `sauce reinstall`. Not blocking; documented in v0.50.0 result doc FLN-3.
- `ProjectNotesCards` includes wiki-notes in the project root's notes grid (acceptable for v1; future polish cycle could filter `type !== "wiki-note"`).
- Brew tap auto-bump for v0.50.0 fires on tag push; merge PR in `willfell/homebrew-sauce` should land in normal cycle.
- Manual Obsidian-side smoke (open a project, click Wiki nav-button, create a wiki note) deferred to day-of-use. CLI-level verification was comprehensive (backfill works, markers inject, idempotent on re-run).
