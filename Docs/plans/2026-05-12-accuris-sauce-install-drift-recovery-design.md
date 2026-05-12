# 2026-05-12 — accuris-sauce install drift recovery (design)

## Status

Design locked 2026-05-12. Awaiting plan write-up via de:writing-plans.

## Context

User-reported bugs in the consumer vault at
`/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce`:

1. Project file named `Project.md`, not `test-project.md`.
2. No workstream prompt during project creation.
3. Workstream Add/Remove buttons render twice on first load (clear once in view mode).
4. Task creation does not prompt for a workstream.
5. Task cards lack the task-board / board-task nav-buttons.
6. Cannot create notes within a project.
7. After Cmd+R, Project Map / Project Board buttons appear (this one is normal).

## Diagnosis

Vault is **already at the current workshop versions** (`workshop_version 0.29.0`,
`project@1.3.8`), per `ranch/platform-installed.json` and `ranch/platform-subscription.json`.
The problem is NOT version drift — it is **install drift**: platform-managed
template files were corrupted at runtime, replaced with their rendered output.

### Smoking gun

In `accuris-sauce/ranch/templates/`:

- `Template, Kanban Card.md` is stale. It contains only the rendered output of a
  prior task creation (frontmatter `created: 2026-05-10 20:45`, hardcoded
  `source_board: spice/daily/2026/05-May/Sunday-2026-05-10.md`). The entire
  `<%* ... %>` Templater header (workstream picker + `tp.file.move` folder
  auto-promote) is missing.
- `Template, Task Board Card.md` shows the same shape — also stale.
- `.bak` files exist for: `Daily Note.md`, `Meeting Hub.md`, `Meeting.md`,
  `Trip Atlas.md`, `Trip Board Card.md`, `Project.md`, `Kanban Card.md`,
  `Task Board Card.md`, `projects-hub-cards.js`, `project-nav-buttons.js` —
  consistent with prior runs of the installer's Option-B content-overwrite
  mechanic kicking in.

### Bug → cause map

| # | Reported | Cause | Disposition |
|---|---|---|---|
| 1 | File named `Project.md` not `test-project.md` | By design — rule_fragment `path_glob: spice/projects/*/Project.md` is canonical post-v0.29.0 | Out of scope (expectation gap) |
| 2 | No workstream prompt during project creation | By design — Project.md ships `workstreams: []` empty; user adds via ProjectWorkstreamManager widget | Out of scope (expectation gap) |
| 3 | Add/Remove buttons render 2× until view mode | Obsidian live-preview render quirk in widget | Out of scope (real platform bug, separate triage) |
| 4 | No workstream prompt during task creation | Stale `Template, Kanban Card.md` — Templater header missing | **In scope** — fixed by re-install |
| 5 | Task cards lack task-board / board-task buttons | Same stale template — `tp.file.move` auto-promote missing → tasks land flat at `tasks/<x>.md` instead of `tasks/<x>/<x>.md`; nav-buttons key on folder shape | **In scope** — fixed by re-install + migrate |
| 6 | Cannot create notes within project | Likely missing "New Note" action on project nav-buttons (unverified) | Out of scope (possibly missing feature, separate triage) |
| 7 | After restart, Map/Board buttons appear | Normal Cmd+R CustomJS reload | Not a bug |

## Scope

In scope: bugs #4 and #5 via installer re-run + test-data migration.

Out of scope (deferred to follow-up): bugs #3 and #6, expectation gaps #1 and #2.

## Steps

1. **Pre-check.** Confirm vault identity (`spice/`, `pantry/`, `ranch/` present).
   Snapshot `ranch/templates/Template, Kanban Card.md` md5 and verify it matches
   the stale rendered shape. Copy existing `.bak` files aside to
   `.bak.preinstall-2026-05-12` to preserve historical evidence in case the
   installer rotates them.

2. **Run installer in re-install / overwrite mode.** From the workshop repo,
   invoke:
   ```
   bash install.sh --vault /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce --non-interactive --overwrite
   ```
   Confirm exact flag set during execution by reading `install.sh` / `install.js`.
   The installer's Option-B content-overwrite mechanic will diff each
   platform-managed file, write prior contents to `<dest>.bak`, then write the
   workshop source.

3. **Validate post-install state.** Diff against workshop source — expect zero
   diff on: `Template, Kanban Card.md`, `Template, Task Board Card.md`,
   `Template, Project.md`, `Project Map.md`, `Project Board.md`, `Task Note.md`,
   `Task Board.md`, and all `ranch/scripts/project/*.js` helpers.

4. **Migrate the two flat test tasks** into folder shape (no content edits):
   - `spice/projects/test-project/tasks/test-task.md`
     → `spice/projects/test-project/tasks/test-task/test-task.md`
   - `spice/projects/test-project/tasks/another-task-post-stream.md`
     → `spice/projects/test-project/tasks/another-task-post-stream/another-task-post-stream.md`

   Use `mv` (filesystem) or `git mv` if the vault is git-tracked. Do NOT modify
   file content.

5. **Hand off to user for in-Obsidian validation.** User opens the vault, Cmd+R
   to reload CustomJS, then walks:
   - Open `spice/projects/test-project/Project.md`.
   - Verify Project Map / Project Board nav-buttons render.
   - Click "New Task" — verify workstream picker fires (one workstream exists:
     `test-stream`).
   - Verify the created card lands at `tasks/<name>/<name>.md`.
   - Verify task-board / board-task nav-buttons render on the new task.

## Risk / unknowns

- **Root cause of the original drift is NOT addressed.** Something corrupted
  `Template, Kanban Card.md` and `Template, Task Board Card.md` with their
  rendered output. Candidates: Templater plugin "trigger on new file" setting
  misfiring on the template file itself; an iCloud / Obsidian Sync conflict;
  another tool writing into `ranch/templates/`. If the drift recurs within a
  day or two of this fix, escalate to a real investigation rather than
  re-running this remediation.

- **`.bak` rotation.** Installer logic is "one-deep, no rotation" per
  `install.js:526-529`. The pre-step copies existing `.bak` files aside to
  `.bak.preinstall-2026-05-12` to keep the original stale-render evidence.

- **Vault backup.** User confirmed a vault backup is in place before this work
  starts.

## Unresolved questions

None.

## Next step

Invoke de:writing-plans to produce an executable plan from this design.
