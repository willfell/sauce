# Sauce Pipeline Round 2 — hotfix interlude handoff

**Date:** 2026-05-16
**Workshop versions shipped this round:** v0.50.1 + v0.50.2 + v0.50.3
**Cards completed:** (none on the project board — hotfix chain, no card)
**Result doc:** (see commit trail `af286ca`, `a81abc1`, `385747a`)

## What happened

Round 2 opened with v0.50.0 sitting tagged on GitHub but NOT deployed to the user's brew install or headspace consumer vault. User flagged this; we paused the pick flow to deploy + validate.

Deploy chain ran:
1. Merge brew tap PR #30 (v0.50.0) → brew upgrade → headspace reinstall.
2. Validation surfaced 2 regressions; investigation surfaced a 3rd.
3. Three sequential hotfix tags: v0.50.1, v0.50.2, v0.50.3.

### BUG-A — `ProjectWikiCards.render is not a function` (v0.50.1)

ProjectWikiCards declared `async view()` but customjs-guard dispatches via `.render()` by default; all sibling helpers (ScratchHubCards, ProjectNotesCards, ProjectsHubCards) use `render`. Wiki hub on existing projects threw the error in the DOM. Fix: rename `view` → `render`. project blueprint 1.10.0 → 1.10.1.

### BUG-B — Empty Wiki.md sidecar on new projects (v0.50.1)

`entity-create._readBody` gated on `app.vault.getAbstractFileByPath`, which returns null for files materialized in the SAME install run before Obsidian's vault index has scanned them. Project Map + Project Board templates were already indexed from prior installs; the NEW `Template, Wiki Hub.md` (first shipped in v0.50.0) hit the null-check path → empty Wiki.md sidecar for newly-created projects. Fix: read via `app.vault.adapter.read` directly. entity-create 0.3.0 → 0.3.1.

### BUG-C — `applyWikiBackfill` regex rejected quoted YAML (v0.50.2)

Backfill regex `/^type:\s*project\s*$/m` matched unquoted form only. Entity-create's `_renderFrontmatter` quotes string scalars (`type: "project"`), so entity-create-emitted project roots were silently skipped with reason "no project root found". Pre-existing hand-authored projects had unquoted form so they backfilled fine — masking BUG-C until the first entity-create-emitted project landed. Fix: regex `/^type:\s*["']?project["']?\s*$/m`.

### v0.50.3 — Force project blueprint re-install

v0.50.2 shipped the BUG-C regex fix, but the install gate in `installItem` only re-runs a blueprint's pipeline when its catalogue version > installed version. With project pinned at 1.10.1 on both ends, the v0.50.2 install ran without invoking `applyWikiBackfill` — leaving the test-wiki project still empty.

Bumping project to 1.10.2 (no real code change; version-only) forced its pipeline to re-run on the next reinstall, finally executing `applyWikiBackfill` with the v0.50.2 regex in scope.

## Deployment chain (this round)

| Tag | Tap PR | Brew | Headspace install | test-wiki Wiki.md |
|---|---|---|---|---|
| v0.50.0 | #30 merged | 0.49.2 → 0.50.0 | clean, 6/6 backfilled | EMPTY (BUG-B) |
| v0.50.1 | #31 merged | 0.50.0 → 0.50.1 | clean | (test-wiki: skipped, BUG-C) |
| v0.50.2 | #32 merged | 0.50.1 → 0.50.2 | clean, but no installItem ran | still EMPTY (gate) |
| v0.50.3 | #33 merged | 0.50.2 → 0.50.3 | clean, 65 history entries | 30 lines, correct |

## Board snapshot (after this round)

### In Planning (top-level `sauce-board.md`)
- [[Projects Blueprint]] (workstream container; 2 sub-cards remaining)
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

### In Progress
(empty)

### Blocked
(empty)

### Completed (most recent at top)
- [[Wiki Area]] — v0.50.0 — 2026-05-16

## User action needed

**Cmd-R reload in Obsidian** to re-register CustomJS classes (specifically the patched `ProjectWikiCards`). After that:
- Visit any project's `wiki/Wiki.md` — should render with no error (BUG-A fix).
- Click "+ New Wiki Note" — should prompt for title and create a populated note (BUG-B fix).
- The previously-empty `test-wiki/wiki/Wiki.md` is now populated (BUG-C fix via v0.50.3 re-install).

## Recommended next

- **Card:** [[Project Buttons in tasks can be cluttered on phone]] (sub-card of Projects Blueprint workstream)
- **Reason:** Carried forward from Round 1 handoff. Concrete, bounded UI scope; touches the same `project-nav-buttons.js` surface modified in v0.50.0 + v0.50.3.

Alternate: [[Frontmatter Alignment]] — newly-added since Round 1; untracked design doc may be quick.

## FIX-LATER notes from this hotfix chain

1. **applyWikiBackfill should be unconditional.** Today it lives in `installItem` (gated by version-newer-than-installed). When BUG-C's regex was patched in v0.50.2, no consumer with project already pinned at the latest version would get the fix applied. Required a synthetic version bump (v0.50.3) to force re-execution. Future cycle: move applyWikiBackfill to the post-install loop (parallel to materializeSkills) so it runs every install.
2. **Two-tier release validation.** Tag-and-push isn't "shipped"; tap PR needs merge + brew upgrade + consumer reinstall + smoke. Worth codifying in `/sauce-pipeline` as a mandatory Phase C step before declaring the cycle complete.
3. **Sauce-Pipeline Round 1 result.md's "manual Obsidian-side smoke deferred to day-of-use" guidance was wrong.** Should be done same-day for the user's primary vault when the cycle ships new dataviewjs surfaces. Today's three regressions would have been caught immediately by clicking the wiki nav-button in headspace right after v0.50.0 deploy.

## Open questions

- Round 3: deferred. User should Cmd-R + verify the wiki UX works end-to-end before the next round picks a fresh card.
