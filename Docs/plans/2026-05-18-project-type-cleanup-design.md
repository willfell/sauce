---
type: design
date: 2026-05-18
status: approved
cycle: v0.59.4
workstream: deploy-cleanup
---

# v0.59.4 — Project type-backfill cleanup + entity-create subscription fix

Two bugs surfaced post-v0.59.3 deploy. One round to fix both.

## Bug 1 — `customJS.EntityCreate` undefined at accuris + ero

**Symptom:** DataviewJS evaluation error `Cannot read properties of undefined (reading 'render')` at:
- `spice/projects/Projects.md` (accuris)
- `spice/meetings/hubs/<date>-Meetings.md` (accuris)
- `spice/scratch/<day>/Scratch-Day-<day>.md` (accuris)
- Likely same at ero (not yet manually surfaced; same subscription state)

**Root cause:** v0.46.0 shipped `entity-create` mechanism. Consumer subscriptions were never reconciled — barebones + headspace have it; accuris + ero don't. Without it, the installer skips `ranch/scripts/entity-create/` materialization, and `customJS.EntityCreate` is undefined at runtime.

**Fix:** Edit `ranch/platform-subscription.json` at accuris + ero to add `{"name": "entity-create", "version": "0.3.2"}`. Run `sauce reinstall --vault <v>` at both. Installer materializes the missing scripts.

**Reversibility:** Subscription edits are file-level; reinstall is additive (writes new files; doesn't delete). Trivial to revert by removing the line.

## Bug 2 — `type: project` over-applied across `spice/projects/`

**Symptom:** `Projects.md` hub's "All Projects" list includes task-board-cards, task-notes, kanban-cards, doc-notes, sub-blueprint files, and other non-atlas content. The "(no status)" group at the bottom is full of files that aren't projects.

**Root cause:** v0.55.0 (FA-3) migration verb's `inferTypeFromPath` returned `"project"` for ANY file under `spice/projects/`. Known issue per FLN-FA3-2 (v0.55.0 result doc): "Path-based `type` backfill is too aggressive for project." Verified by inspection of post-migration content at headspace.

**Fix part A (workshop):** Patch `platform/cli/cmd-migrate-frontmatter.js` `inferTypeFromPath` to be shape-aware for `projects`:
- `spice/projects/<slug>/<slug>.md` (atlas pattern, folder == filename) → return `"project"`
- Any other path under `spice/projects/` → return `null` (no backfill)

Other modules in `PATH_TO_TYPE` retain blanket mapping (their sub-paths don't get user-content carried over from external sources the way projects do).

**Fix part B (vault cleanup):** NEW script `platform/cli/cmd-cleanup-project-type.js` (or inline node logic) — walks `spice/projects/**/*.md` at a target vault:
- For each file with `type: project`:
  - If path matches atlas pattern → leave alone
  - Otherwise → remove the `type:` line; backup the original to `.sauce-backup/<rel>/<ts>/<file>`
- Dry-run by default; `--apply` to write
- Idempotent (re-run is a no-op)

**Reversibility:** Per-file `.sauce-backup/` sidecars. The cleanup ONLY removes the wrong `type:` line — no other content touched. Idempotent: second run finds nothing to clean.

## Out of scope (deferred)

- **Setting correct sub-types** (`task-note`, `task-board-card`, `doc-note`, `kanban-card`, etc.) on the formerly-mistyped files. Removing the wrong `type:` is sufficient to fix the visible bug. Canonical sub-type backfill is a future cycle if `ProjectsHubCards` or other queries ever rely on those specific types.
- **Other blueprints' `inferTypeFromPath` over-aggressiveness.** Projects is the obvious offender. To-do is intentional (backfilling `type: "to-do"` is by design — every file under `spice/to-do/` IS a to-do). People / products / teams / trips are entity-shaped with one file per slug (no sub-paths to mis-type). Cowork has sub-paths but its `type:` is set per-template. Finance is explicitly `null` in `PATH_TO_TYPE`.

## Stages

| S | Action | Files / commits |
|---|---|---|
| S1 | Workshop patch + version bumps | `platform/cli/cmd-migrate-frontmatter.js` (patch `inferTypeFromPath`) + version bumps in `platform/manifest.json` + `ranch/platform-subscription.json` + `package.json` |
| S2 | Cleanup script + harness delta | NEW `platform/cli/cmd-cleanup-project-type.js` dispatched as `sauce cleanup-project-type --vault <v> [--apply]`; +`run-migrate-frontmatter.js` sub-asserts for the new `inferTypeFromPath` behavior |
| S3 | Preflight + commit + tag v0.59.4 + push | annotated tag |
| S4 | Tap PR merge + brew upgrade to 0.59.4 | external |
| S5 | accuris + ero subscription: add `entity-create` mechanism | file edit |
| S6 | Reinstall × 4 vaults (deploys workshop patch + entity-create at accuris+ero) | brew sauce 0.59.4 |
| S7 | Run cleanup at all 4 vaults (`sauce cleanup-project-type --vault <v> --apply`) | per-vault backups |
| S8 | Verify: open Projects.md at headspace — list should be atlases only; accuris Projects.md / Meetings hub / Scratch-Day no longer error | manual smoke |

## Test deltas

- `run-migrate-frontmatter.js` +3 sub-asserts: PROJ-1 atlas pattern returns "project", PROJ-2 sub-path returns null, PROJ-3 idempotent on already-correct content.
- `run-cli.js` +3 sub-asserts for new `cleanup-project-type` verb dispatch: CP-1 dry-run produces report, CP-2 --apply writes backups, CP-3 re-run is no-op.

## Acceptance

- Headspace `Projects.md` "All Projects" list shows only project atlases (no task-board-cards, no task-notes, no random sub-files).
- Accuris `Projects.md`, `Meeting Hub`, `Scratch-Day-*.md` render without DataviewJS errors.
- `sauce audit --frontmatter-alignment` at all 4 vaults: zero new findings introduced.
- Workshop self-install clean.
- Whole-suite preflight green (~+6 sub-asserts).
