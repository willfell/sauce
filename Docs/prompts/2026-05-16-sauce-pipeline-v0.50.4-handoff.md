# Sauce Pipeline Round 3 — handoff for next round

**Date:** 2026-05-16
**Workshop version shipped:** v0.50.4
**Card completed:** [[Create will note is broken]] (Projects Blueprint sub-board)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-16-v0.50.4-result.md`

## What shipped

A small PATCH cycle resolving the user-reported "empty `wiki/Wiki.md` on newly-created project" symptom:

- `entity-create@0.3.2`: `_createExtra` now ensures the parent dir whenever `filename_pattern` itself contains a slash. Pure additive forward-defense; existing happy paths untouched.
- `project@1.10.3`: wiki extra_file rewritten to `{ "subfolder": "wiki", "filename_pattern": "Wiki.md", … }` (schema-canonical form using the existing `subfolder` field).
- Test coverage: `run-entity-create.js` 46 → 48 pass (EC-39 + EC-40 new; EC-2 + WIKI-5 updated for the version bump and schema change). Preflight green across 15 harnesses + version-sync gate.

Root cause (brief): `app.vault.create(path, content)` against a missing parent dir doesn't throw cleanly in Obsidian — it auto-creates the dir but silently drops the body content, leaving a 0-byte file. Full diagnosis in the design doc.

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
- [[Project Buttons in tasks can be cluttered on phone]]

### In Progress (workstream container — top-level board)
- [[Projects Blueprint]] (2 sub-cards remaining)

### Blocked
(empty)

### Completed (most recent at top, sub-board)
- [[Create will note is broken]] — v0.50.4 — 2026-05-16
- [[Wiki Area]] — v0.50.0 — 2026-05-16

## Deployment chain

| Tag | Tap PR | Brew | Headspace install | test/wiki/Wiki.md |
|---|---|---|---|---|
| v0.50.4 | (auto-fires on tag push) | (pending merge) | (pending) | (still 0 bytes — see user repair step below) |

## User repair step

After `brew upgrade sauce` and tap PR merge:

1. `rm "/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/test/wiki/Wiki.md"` to clear the empty file.
2. `sauce reinstall --vault /Users/willfellhoelter/notes/sauce/headspace-sauce` — `applyWikiBackfill` will then materialize a populated Wiki.md (it skips when the file already exists, even at 0 bytes, so the delete must come first).
3. Alternatively: delete the `test` project entirely and create a fresh one to confirm v0.50.4's entity-create flow produces a populated Wiki sidecar on first try.

## Recommended next

- **Card:** [[Project Buttons in tasks can be cluttered on phone]] (sub-card of Projects Blueprint workstream — carried forward from the v0.50.3 hotfix handoff)
- **Reason:** Concrete bounded UI scope; touches the same `project-nav-buttons.js` surface modified in v0.50.0, v0.50.3, and v0.50.4. After this card the Projects Blueprint workstream has one sub-card remaining ([[Project status updates]]), at which point the workstream can move from In Progress back to Planning (or stay if status-updates is picked next).

Alternates:
- [[Frontmatter Alignment]] — top-level card; design doc may already exist (`Docs/plans/` mentions FA-1..FA-9 inventory in v0.50.0 S+ deliverables). Worth a quick scan first.
- [[Bugs]] — broad container; would want a sub-card pick before starting a cycle.

## Open questions / dependencies

- The user has been on remote-control for this round. Tap PR + brew upgrade + headspace reinstall haven't been verified yet (autonomous-run skipped the deploy chain). If the user picks up another round before merging tap PR #34 (the v0.50.4 auto-bump), the next cycle's changes ride alongside on the same tag — fine for additive work but worth flagging if the deploy gate matters.

## FIX-LATER notes (carried over from prior cycles)

- **FLN-1.** `applyWikiBackfill` should be unconditional + repair 0-byte Wiki.md files. Today it's gated by version-newer-than-installed in `installItem` AND skips existing files (even empty ones). Future cycle: move it parallel to `materializeSkills` and treat 0-byte files as missing.
- **FLN-2.** Codify a "tap merged + brew upgraded + consumer reinstalled + smoke green" mandatory step in `/sauce-pipeline` Phase C before declaring a cycle shipped.
- **FLN-3.** EC-39's vault stub doesn't enforce parent-dir-exists like real Obsidian does. A stricter mock would make the regression louder. Considered for a future test-harness cycle.
