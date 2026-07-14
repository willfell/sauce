# Sauce Pipeline Round 18 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.59.11 (PATCH — Kanban Card name-collision fix)
**Card completed:** [[If a task or sub-task item - is the same name as another task item - the templater note that gets made for it gets put to the root directory of the vault]]
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-17-v0.59.11-kanban-card-name-collision-design.md` (no separate `-result.md` — design + plan + commit trail tell the story)

## What this round shipped

Two surgical edits to `platform/blueprints/project/templates/Kanban Card.md`:

**(A) Strategy 0 — directory-of-target sibling-board detection.** Runs FIRST inside `_findSourceKanbanBoard`. If the new file's parent directory contains exactly one kanban-plugin board file, that board IS the source — path-based, bypasses title-substring pitfalls entirely. Falls through cleanly to Strategy 1 (cache-first, v0.51.1) and Strategy 2 (vault-scan, v0.56.2) when the new file is at vault root (Templater default placement), when multiple boards share the directory, or when zero boards live next to the new file.

**(B) Auto-promote suffix-disambiguation loop.** Replaced the silent `if (!existing)` skip with a `while` loop that appends `-2`, `-3`, ... to the per-task folder + filename until a free slot is found (bounded `<= 999`). Shows a Notice on rename: `Task name "<title>" already exists in this project. Saved as "<title>-2".` New files NEVER orphan at vault root.

Project blueprint `1.13.5 → 1.13.6` PATCH. Workshop `0.59.10 → 0.59.11` PATCH. Whole-suite preflight green (18 harnesses, including +7 sub-asserts under KC-7 + KC-8).

## Round-18 commit chain (on `origin/main`)

- `8f0f317` — design doc
- `03c1a95` — implementation plan
- `d039875` — S1: failing KC-7/8 tests
- `434cbad` — S2: Strategy 0 sibling-board detection
- `dd59f3b` — S3: auto-promote suffix disambiguation
- `c883efd` — S4: version lockstep + workshop dogfood
- `v0.59.11` annotated tag (auto-bumps the homebrew tap via `release.yml`)

## Deploy debt (accumulating; user-driven)

Since the round-17 deploy-pause handoff (v0.59.1), the workshop has shipped:

- v0.59.2, v0.59.3, v0.59.4, v0.59.5, v0.59.6, v0.59.7, v0.59.8, v0.59.9, v0.59.10 (manual workshop work between rounds)
- v0.59.11 (this round)

Brew sauce was at v0.56.2 per the round-17 handoff. The deploy procedure outlined in `2026-05-17-sauce-pipeline-v0.59.1-deploy-pause-handoff.md` Section 1-6 still applies for clearing the accumulated tag chain to the 4 consumer vaults (`headspace-sauce`, `accuris-sauce`, `ero-sauce`, `barebones`). Sauce-pipeline does not deploy autonomously — that step lives with the user.

## Board snapshot (after this round)

### In Planning (top-level sauce-board.md)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress (top-level — workstream-level)
- [[Frontmatter Alignment]] (FA-1..FA-7 done; FA-8..FA-9 ahead)
- [[Projects Blueprint]] (ongoing — 2 cards left in sub-board Planning)

### Blocked
(empty)

### Projects Blueprint sub-board (after this round)

**Planning:**
- [[Potentially broken docs]]

**Completed (most recent at top):**
- [[If a task or sub-task item - is the same name as another task item - the templater note that gets made for it gets put to the root directory of the vault]] — v0.59.11 — 2026-05-17
- [[Projects listed get cluttered within Main projects hub]]
- [[Project status updates]]
- [[Project Buttons in tasks can be cluttered on phone]]
- [[Create will note is broken]]
- [[Wiki Area]]

### Frontmatter Alignment sub-board (unchanged)

**Planning:**
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

## Recommended next

- **Card:** [[FA-8 · Backlink panels]]
- **Reason:** Carries the round-17 recommendation forward. Wave-5 payoff cycle — materializes BacklinkPanel views off the canonical-vocab keys (`people:`, `projects:`, etc.) shipped in v0.53-v0.59.1. Highest end-user-visible payoff of the remaining FA work. After FA-8 + FA-9 close, Frontmatter Alignment workstream is done and can move to top-level Completed.

Alternates:
- **[[FA-9 · Activity feeds + rollups]]** — sibling Wave-5 payoff. Cross-blueprint feed + project rollup dashboards. Pair with FA-8 in the same round only if scoped tightly.
- **[[Potentially broken docs]]** — narrow Projects Blueprint card. Likely an audit-and-fix on the v0.52.0 wiki → docs rename fallout.

## Open questions / dependencies

- The deploy debt continues to grow with each new tag. The user has been comfortable letting it accumulate (round-13 squashed multiple tap PRs into one main bump). If the next round adds another tag, the squash gets heavier. Worth surfacing again at Phase B on round 19.
- Smoke-testing the v0.59.11 fix at headspace requires manual Obsidian interaction: open a project board, add two tasks with the same name, observe `<title>-2` disambiguation + Notice. CLI-level verification only confirms source-string presence; behavioral confirmation needs an Obsidian session post-brew-upgrade + reinstall.

## ScheduleWakeup

Scheduling 270s wake to fire the next round (`/sauce-pipeline`). User will be re-prompted at Phase B and can pause-for-deploy, pick FA-8, pick something else, or skip. Loop continues until user picks `skip (end the loop)`.
