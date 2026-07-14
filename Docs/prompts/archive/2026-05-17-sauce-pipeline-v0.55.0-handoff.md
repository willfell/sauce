# Sauce Pipeline Round 11 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.55.0
**Card completed:** [[FA-3 · Project migration]] (sub-card; workstream [[Frontmatter Alignment]] remains in In Progress on top-level board)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-17-v0.55.0-result.md`

## Board snapshot (after this round)

### In Planning (top-level `sauce-board.md`)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress
- [[Frontmatter Alignment]] (workstream — FA-1/FA-2/FA-3 shipped; FA-4..FA-9 ahead)

### Blocked
(empty)

### Completed (most recent at top)
- [[Frontmatter Alignment]] / [[FA-3 · Project migration]] — v0.55.0 — 2026-05-17
- [[Frontmatter Alignment]] / [[FA-2 · Entity wave]] — v0.54.0 — 2026-05-17
- [[Frontmatter Alignment]] / [[FA-1 · Foundation cycle]] — v0.53.0 — 2026-05-17
- [[Projects Blueprint]] (workstream) — 2026-05-17 (round 8 close)

### Frontmatter Alignment sub-board

**Planning:**
- [[FA-4 · Timeline wave]]
- [[FA-5 · Cowork migration]]
- [[FA-6 · Domain wave]]
- [[FA-7 · Finance migration]]
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

**Completed:**
- [x] [[Planning Frontmatter Alignment]]
- [ ] [[FA-1 · Foundation cycle]] (v0.53.0)
- [ ] [[FA-2 · Entity wave]] (v0.54.0)
- [ ] [[FA-3 · Project migration]] (v0.55.0)

## What shipped in v0.55.0

- `project@1.12.1 → 1.13.0` MINOR. 7 templates updated (Project Map, Project Board, Kanban Card, Task Note, Task Board, Task Board Card, Docs Hub) — canonical `created_at:` (ISO+TZ); discriminator + temporal tags dropped; preserve allowlist (kanban-card, project-card, task-board-card, task-board) honored.
- **Drive-by regex fix** in `Task Board Card.md`: stale `^beacon/projects/` (from pre-v0.23.0 rebrand) → `^spice/projects/`. Task-board-card `task_parent:` will now populate correctly on new cards.
- 3 rule_fragments declare `extends: "_canonical-vocab"`; legacy `created` + discriminator `required_tags` dropped.
- entity-create entries (project + doc-note) adopt canonical `created_at`.
- `Task Note.md` template ADDED `type: task-note` (was missing).
- `cmd-migrate-frontmatter --apply` SOFTENED — skips parse-error files instead of halting (real-world `workstreams: [{id, name}]` object-lists are outside the minimal YAML parser scope). +2 sub-asserts.

**Consumer-vault migrations:**
- headspace-sauce: 96 + 6 skipped
- barebones: 55 + 6 skipped
- ero-sauce: 72 + 2 skipped
- **Total: 223 files rewritten, 14 hand-edit later** (object-list workstreams). Backups under `<vault>/.sauce-backup/<rel>/<ts>/`.

**Whole-suite delta:** +20 sub-asserts (run-helper-cases 737→755; run-migrate-frontmatter 50→52).

## Recommended next

- **Card:** [[FA-4 · Timeline wave]]
- **Reason:** 3 timeline-shaped blueprints (daily + journal + scratch). Lighter than FA-3. Per design §C wave 3: `daily@0.3.0 → 0.4.0`, `journal@0.1.2 → 0.2.0`, `scratch@0.3.1 → 0.4.0`. Whole-suite delta target ~+10 sub-asserts. Timeline blueprints emit canonical cross-ref keys but never receive canonical pointers (discovered via reverse Dataview queries).

Alternates:
- **FA-5 · Cowork migration** — heaviest timeline blueprint (14 rule_fragments + 8 templates + `month` → `month_label` rename).
- **Cleanup `.sauce-backup/` at 3 consumer vaults** once user validates the 223 migrated files.
- **Cleanup over-applied `type: project`** on ~20-30 sub-files in spice/projects/ (FLN-FA3-2). Benign but inconsistent.
- **Pause for user smoke** at headspace: verify project hub renders + new project creation + new kanban-card on a project board (drive-by regex fix verification).

## Open questions / dependencies

- **`extends` doesn't propagate into `frontmatter_branch[]`.** For rules using branched logic (project, docs-hub, doc-note in FA-3), the branch's `required_frontmatter` is used INSTEAD of the merged-with-extends fragment's. Canonical type+created_at enforcement is via templates + migration + audit walker for these rules. To fully wire validator-enforcement on branched rules, FA-1's `_resolveExtends` could be extended to also merge into branches. Deferred (see FLN-FA3-1).
- **Object-list `workstreams:`** in 14 consumer files outside minimal YAML parser scope. Migrate via hand-edit OR extend parser OR write a targeted secondary migration script. Cleanup cycle candidate.
- **accuris-sauce skipped** per round 10 user direction. Needs separate migration before accuris ships canonical-extended blueprints.

## FIX-LATER notes (new this cycle)

- **FLN-FA3-1** — `extends` doesn't propagate into `frontmatter_branch[]`. Affects project rule_fragment branched enforcement.
- **FLN-FA3-2** — Path-based `type` backfill over-applies `type: project` to sub-files under spice/projects/. Benign (created_at also backfilled, no missing_canonical_key violations). Affects ~20-30 sub-files across 3 vaults.
- **FLN-FA3-3** — `--apply` skip-on-parse-error softening leaves 14 files with legacy `created:` because of object-list `workstreams:`. Cleanup cycle candidate.
- **FLN-FA3-4** — accuris-sauce migration deferred (carry-over from FA-2).
- **FLN-FA3-5** — `Task Note.md` `type: task-note` added; existing task-notes pre-FA-3 lack this field. Path-based backfill is unsafe (see FLN-FA3-2). Future targeted migration cycle.
- **FLN-FA3-6** — Drive-by regex fix verified at template-source level; not exercised against a live new-card creation. User should smoke-test creating a kanban card on a project board after `brew upgrade sauce` + reinstall.

## ScheduleWakeup pacing

Next round picks at Phase B (interactive). 270s fallback heartbeat keeps prompt cache warm.
