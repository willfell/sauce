# Sauce Pipeline Round 22 — PAUSED FOR SCOPE

## Status: PAUSED FOR SCOPE

**Date:** 2026-05-19
**Workshop version:** v0.62.0 (unchanged — no cycle ran)
**Round outcome:** No card moved; no workshop release; loop exits without scheduling next wake-up.

## What this round did

At Phase B, the user picked the **"Pause for FA-9b card via Obsidian"** option (presented as Slot 1 / Recommended; promoted from the standard "pause for user to add smaller cards" sanity-check branch into a top-level Phase B option for this round because FA-9 closed at v0.62.0 with `execution_scope: FA-9a only`, leaving FA-9b unbuilt without an explicit kanban card to pick).

Per skill-spec Phase B step 6's pause-for-Obsidian-add semantics:
- Pipeline does NOT create cards programmatically.
- Card-creation path is obsidian-kanban "+ Add a card" which delegates to Templater + the v0.48.0 `ProjectTaskCreateListener` + v0.49.2 vault-scan source-board detection — all interactive Obsidian flows.

## Next action

Open Obsidian on `~/notes/sauce/headspace-sauce/`, navigate to the **Frontmatter Alignment sub-board** at:

```
spice/projects/sauce/tasks/Frontmatter Alignment/board/Frontmatter Alignment-board.md
```

Click **"+ Add a card"** in the **Planning** column. Use card title:

```
FA-9b · Project-rollup dashboard
```

The kanban-plugin will fire Templater + the v0.49.2 vault-scan logic, materializing the card at:

```
spice/projects/sauce/tasks/Frontmatter Alignment/board/FA-9b · Project-rollup dashboard/FA-9b · Project-rollup dashboard.md
```

The card frontmatter will inherit the v0.49.2 + v0.59.11 conventions (`source_board:`, `task_parent:`, `aliases:`, `tags: [task-board-card]`). Edit the card body with the FA-9b sub-scope copied from the closed FA-9 card body. Suggested body (paste into the new card after the dataviewjs blocks):

```markdown
# FA-9b · Project-rollup dashboard

Symmetric payoff to FA-9a (Activity feeds, shipped v0.62.0). Every project atlas grows a multi-section rollup dashboard showing meetings/scratches/daily linking the project + workstream-task counts.

**Design doc:** `Docs/plans/2026-05-16-frontmatter-alignment-design.md` (§D — FA-9 paragraph 2) + `Docs/plans/2026-05-18-v0.62.0-fa-9a-design.md` (Out-of-scope #1).
**Depends on:** FA-9a closed (ActivityFeed proves the time-window pattern; FA-9b adds entity-scoped variants).
**Closes:** Frontmatter Alignment workstream — after FA-9b, the workstream-level `[[Frontmatter Alignment]]` card can move from In Progress → Completed.

## Scope

### Project-rollup dashboard

Project atlas grows a multi-section dashboard (separate concern from FA-8's BacklinkPanel):

- **Section: Recent meetings touching this project** — query `dv.pages('"spice/meetings"').where(p => p.projects?.some(l => l.path === current.file.path)).sort(p => p.created_at, 'desc').limit(10)`
- **Section: Recent scratches** — same shape over scratch
- **Section: Recent daily notes** — same shape over daily
- **Section: Project workstream status** — count of task notes per workstream, with color-coded status pills (reads `workstream:` + `status:` on `type: project-task` notes)

### Implementation

- NEW CustomJS class `ProjectRollup` (decision: new class vs extending `backlink-panel@0.1.0 → 0.2.0`).
- Project atlas template (`Template, Project.md`) grows a "## Dashboard" or "## Project Activity" H2 + 4 sub-sections.
- Materialized only on project atlas pages (not at task/board/docs surfaces).

## Test deltas

- `run-backlink-panel.js` `+10` sub-asserts (if extending backlink-panel) OR NEW `run-project-rollup.js` ~15 sub-asserts.
- `run-renderer.js` `+5` cases — project atlas with dashboard.
- `run-helper-cases.js` `+3` lint asserts.
- Whole-suite preflight green.

## Acceptance

- Project atlas renders a rollup dashboard with 4 sections, sorted by `created_at` desc, limited to 10 per section.
- Empty-state per section ("No recent activity").
- Workshop self-install clean.
- Manual smoke at headspace: pick 3 active projects, verify each shows DIFFERENT rollup contents.

## Out of scope

- Workstream-as-entity blueprint (separate brainstorm).
- `updated_at` Templater on-save hook.
- Cross-blueprint dashboard generalization (only project atlas in this cycle).
```

Once the card exists in the Planning column, restart the loop:

```
/loop /sauce-pipeline
```

Round 23 will read the new card at Phase A, surface it as the recommendation at Phase B (since the Frontmatter Alignment sub-board's Planning column will then contain exactly one card), and proceed.

## Board snapshot (unchanged from round 21)

### In Planning (top-level — sauce-board.md)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]
- [[Cleanup]]

### In Progress (top-level)
- [[Frontmatter Alignment]] (FA-1..FA-9 closed in sub-board; FA-9b being added per this handoff)
- [[Projects Blueprint]] (1 card left in sub-board Planning: Potentially broken docs)

### Blocked
(empty)

### Frontmatter Alignment sub-board Planning
(empty — after this round + card creation in Obsidian, FA-9b will land here)

## Recommended next (after card creation)

- **Card:** [[FA-9b · Project-rollup dashboard]] (once created in Obsidian)
- **Reason:** Closes the Frontmatter Alignment workstream. Last named FA cycle. Project atlas multi-section rollup dashboard.

**Alternative path:** if user wants to defer FA-9b further, pick "Potentially broken docs" from Projects Blueprint sub-board, or pause for deploy first.

## Open questions / dependencies

- **Deploy-pause increasingly compelling.** Tag stack now: v0.60.0 + v0.61.0 + v0.62.0 atop pre-round-19 tags. End-to-end validation of FA-8 (BacklinkPanel) + FA-9a (ActivityFeed) hasn't run at headspace yet.
- **Workstream-level closing.** After FA-9b ships, top-level `[[Frontmatter Alignment]]` workstream card should move In Progress → Completed on sauce-board.md (manual edit at that round's Phase D).

## ScheduleWakeup

**Not scheduled.** Per Phase B step 6 spec — paused-for-Obsidian-add path exits without scheduling. Restart with `/loop /sauce-pipeline` after creating the FA-9b card in Obsidian.
