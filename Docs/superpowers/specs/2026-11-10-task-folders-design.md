# Task folders and collision-free task names

Status: approved by Will, 2026-11-10 (including the calls below). Date: 2026-11-10.

## Intent

Tasks can now nest: a subtask can have subtasks of its own (shipped in v0.308.0). On disk, though, every task is still one flat file, `spice/tasks/<Title>.md`, with finished and deleted tasks moved one by one into `spice/tasks/_done/` and `spice/tasks/_trash/`. A task is found, linked and attached to its parent by its bare file name.

That breaks down in two ways:

- **The file tree doesn't show the task tree.** A task with subtasks is a scatter of sibling files, and finishing a subtask moves it away from its parent into `_done/`.
- **Names collide.** File names are only checked for clashes inside `spice/tasks/`, and only against open tasks. `[[Title]]` links (and `parent_task`) resolve by name across the whole vault. Measured on 2026-11-10:

  | Vault | Task files (open / done) | Subtasks | Same name twice in spice/tasks | Same name as a note elsewhere | " N" suffixed |
  | --- | --- | --- | --- | --- | --- |
  | accuris | 320 (49 / 245) | 23 | 3 | 3 | 6 |
  | ero | 85 (14 / 61) | 21 | 1 | 1 | 2 |
  | headspace | 164 (11 / 122) | 42 | 8 | 2 | 6 |

  For example, headspace has a live `Pay Bills.md` and a `_done/Pay Bills.md`; a task "Github Runners" shares its name with a project doc; and accuris has `_done/yup.md` beside a wiki page `Yup.md`. A `[[Pay Bills]]` link or `parent_task: "[[Pay Bills]]"` can land on either note.

The goal: **each task is a folder, the folders nest as the tasks do, and every task note's name is unique across the vault**, so links and parents always land on the right note.

## Decisions (Will, 2026-11-10)

1. **Folder per task, nested.** Every task gets its own folder holding its note; a subtask's folder sits inside its parent's folder. The folder is room for that task's attachments too.
2. **Done tasks: the root tree moves.** A finished subtask stays inside its parent's folder, marked done. When a top-level task is done, its whole folder (subtasks included) moves to `spice/tasks/_done/YYYY/MM/` by the month it was completed.
3. **Names: the title, disambiguated only on a clash.** A task's note name is its title while that is unique across the vault. On a clash, a subtask adds its parent's title and a top-level task adds its creation date: `Review the routes PR (Help Henry out with Routes).md`, `Pay Bills (Nov 10).md`.
4. **Migration: all tasks, dry run first.** An install heal moves every task note (open, done and trashed) into the new layout. It first writes a dry-run report per vault; nothing moves until Will says go.

## The model

### Folder is truth

The folder IS the task, as in the trips blueprint (`Docs/agent-guides/trips-blueprint.md`, "Folder-is-truth").

```
spice/tasks/
  Help Henry out with Routes/
    Help Henry out with Routes.md          ← the task note (type: task)
    Review the routes PR/
      Review the routes PR.md              ← subtask (done subtasks stay here too)
      Leave review comments/
        Leave review comments.md           ← sub-subtask
  Pay Bills (Nov 10)/
    Pay Bills (Nov 10).md
  _done/
    2026/
      11/
        Pay Bills/
          Pay Bills.md                     ← a finished top-level task, whole tree
  _trash/
    Old idea/
      Old idea.md
```

- A task folder and its note share one name: `<Name>/<Name>.md`. Other files in the folder are that task's attachments.
- **A task's parent is the task note in the folder directly above it.** That makes the tree loop-free by construction. `parent_task` stays in frontmatter as `"[[<Parent Name>]]"` so Dataview queries, breadcrumbs and older readers keep working. It is kept in step with the folder whenever a task moves, and the folder wins if they ever disagree.
- `type: task` frontmatter, not the path, still decides what is a task (unchanged).

### Names

`TaskEntity.taskName(title, ctx)` returns the note and folder name:

1. `_sanitizeTitle(title)`, as today.
2. If no other markdown file anywhere in the vault has that basename (case-insensitive, ignoring the task's own note), use it.
3. Otherwise a subtask tries `<Title> (<Parent Title>)` and a top-level task tries `<Title> (<Mon D>)` from its `created_at` (`Pay Bills (Nov 10)`).
4. If that still clashes, add ` 2`, ` 3`, … to it, as `_uniqueName` does today.

The check is vault-wide (`app.vault.getMarkdownFiles()` in the app, a directory walk in the installer), not just `spice/tasks/`. Names are worked out when a task is created, renamed, given a new parent, or reopened out of `_done/`, and in the migration. A task whose name is already unique is never renamed.

### Lifecycle

| Gesture | Today | New |
| --- | --- | --- |
| Create a task | `spice/tasks/<Title>.md` | `spice/tasks/<Name>/<Name>.md` |
| Create a subtask | `spice/tasks/<Title>.md` + `parent_task` | `<parent folder>/<Name>/<Name>.md` + `parent_task` |
| Finish a subtask (parent still open) | moves to `_done/` | stays in place; `status: done`, `completed_at` set |
| Finish a top-level task | moves to `_done/` | whole folder moves to `_done/YYYY/MM/` (completion month) |
| Reopen a finished subtask | moves back from `_done/` | status only |
| Reopen a finished top-level task | moves back to `spice/tasks/` | folder moves back to `spice/tasks/<Name>/` (name re-checked) |
| Delete a task | moves to `_trash/` | its whole folder moves to `spice/tasks/_trash/<Name>/` |
| Change "Subtask of…" | edits `parent_task` | folder moves under the new parent's folder (or to the top level); name re-checked |
| Rename (edit title) | (as today) | folder and note renamed together; name re-checked |

Every move and rename in the app goes through `app.fileManager.renameFile`, so Obsidian rewrites links to the moved notes.

## What changes in code

Everything that assumes a flat `spice/tasks/` or matches tasks by bare name. Measured by `grep` on main at v0.308.0:

- **`TaskEntity`** (`task-entity.js`): `composeNote` path, `_uniqueName` → `taskName`, `subtaskCountsByParent`, `parseNote` (derive the parent from the folder), plus a new `parentFolderOf` / `taskFolderOf` pair.
- **`TaskDialog`** (`task-dialog.js`, 32 path references):
  - create / `prepareQuick` / `createQuick`;
  - `_markDone` / `markDone`, `_markDeleted`, `reopen`;
  - the "Subtask of…" change;
  - `_parentCandidates`, which today skips anything in a subfolder, so it must look at nested tasks;
  - title rename.
- **`TaskNoteView`**: the subtask tree and the "Part of" chain can read the folder tree directly; quick-add creates inside this note's folder.
- **`TaskTodayList`**: `renderDoneRow`'s Reopen gate (`spice/tasks/_done/` prefix) and the open/done path checks.
- **Lists and archives** that read `spice/tasks` or check `/_done/` and `/_trash/`:
  - `task-project-list`, `task-trip-list`, `task-meeting-list`, `task-done-today-list`;
  - `todo-daily-filter-view`, `task-done-archive`, `todo-daily-project-groups`, `todo-daily-trip-groups`, `todo-daily-unassigned-meetings`, `todo-leaf-actions`;
  - `space-daily-dashboard`;
  - `project-dashboard`, `project-meetings-list`;
  - `meetings-browse-list`, `meetings-hub-cards`, `meeting-leaf-actions`;
  - `trip-dashboard`.

  Most query `dv.pages('"spice/tasks"')`, which already recurses. The work there is the done and trash path tests.
- **`task-entity/manifest.json` breadcrumb:** `"link": "spice/tasks/{fm:parent_task}.md"` builds a flat path. It must link by note name or by the folder.
- **Installer heals that walk `spice/tasks` top level only** (`install.js` around the task chrome heal at ~12760 and ~13051, the recurring-tasks heal at ~11063, and the capture and migration heals that write `spice/tasks/<name>.md`). They must recurse, and must write new tasks in the folder layout.

## Migration heal

One ungated install heal, `applyTaskFoldersHeal`, idempotent and backup-first like the other task heals.

1. **Plan.** It reads every `type: task` note under `spice/tasks/` at any depth. It resolves each note's parent from `parent_task`, to a task note only; a parent that is missing or ambiguous makes the task top-level and is reported. Then it computes each task's target path:
   - the open tree under `spice/tasks/`;
   - finished top-level trees under `_done/YYYY/MM/` from `completed_at` (or the file's mtime if that's empty);
   - trashed trees under `_trash/`.

   Names are given out in `created_at` order, oldest first, so the oldest task keeps the plain name.
2. **Links.** For each moved note, it finds every link in the vault that resolves to it today:
   - `[[Old]]`, `[[Old|alias]]`, `[[path/Old]]` and `![[…]]`;
   - frontmatter links such as `parent_task`, `source_note` and `links`.

   It rewrites each to the new name. A link that is ambiguous today (two notes share the basename) is rewritten only where `parent_task` or the folder settles which note it meant; otherwise it is left alone and reported.
3. **Dry run (default).** It writes `ranch/reports/task-folders-YYYY-MM-DD.md` in the vault: every move (old path → new path), every rename with its reason ("clash with spice/wiki/ems/other-stuff/Yup.md"), every link it would rewrite, and every unresolved item. Nothing is moved.
4. **Apply** runs only when explicitly asked: `sauce migrate task-folders --apply` (or the install flag the builder picks), after Will has read the report.
5. **Sync safety.** Moves written to disk behind a running Obsidian can be missed by its index, and then Obsidian Sync never uploads them (memory: *mobile customJS missing-class delivery*). So the apply step must run either through Obsidian itself (`app.fileManager.renameFile`, e.g. via `obsidian eval` or a command the heal registers) or with Obsidian closed and re-indexed before Sync runs. The builder picks one, says which in the PR, and checks on the phone that the moved notes arrive.
6. **Re-run safe:** a second run finds nothing to do and says so.

## Goals, non-goals, anti-goals

- **Goals:** the folder tree mirrors the task tree; task note names are unique vault-wide; no link or parent lands on the wrong note; every gesture in the lifecycle table works on desktop and phone.
- **Non-goals:**
  - changing how lists look or filter;
  - moving attachments that live elsewhere today;
  - renaming notes outside `spice/tasks/`;
  - changing the To-Do daily note names (`ToDo-YYYY-MM-DD`).
- **Anti-goals** (failure even if it technically works):
  - renaming a task whose name was already unique;
  - losing or breaking any link;
  - moving any note outside `spice/tasks/`;
  - applying the migration without the dry-run report having been read;
  - a moved note that never reaches the phone.

## Calls I made (Claude), for Will to check

- **Deleting a task trashes its whole folder,** subtasks included, and the confirm dialog says how many subtasks go with it.
- **Finishing a task that still has open subtasks** asks "Also complete its N open subtasks?" Yes completes them and moves the tree to `_done/`. No leaves the task open, since a done root can't keep open children in `_done/`.
- **The parent comes from the folder;** `parent_task` is a kept-in-step mirror.
- **`_done/` is bucketed by completion month** (`_done/YYYY/MM/`), so it stays browsable. Today it is one flat folder of 428 files across the three vaults.

## Settled after the builder check (Claude's calls, for Will to check)

A builder read this design cold and asked nine questions. Their answers:

1. **Both layouts work until the migration is applied.**
   - The code that ships with the heal reads a task's parent from its folder when the note sits in a task folder (`<Name>/<Name>.md` whose folder sits inside another task's folder). For a flat note it falls back to `parent_task`.
   - New tasks are written in the folder layout from the first release, so a vault can be half-migrated safely.
   - Each place that does the "flat fallback" is marked for removal in a later cleanup, once all three vaults are applied.
2. **Done is decided by status, not path.**
   - `status: done` is the truth everywhere: lists, the done archive, `renderDoneRow`'s Reopen gate, counts. The path only decides where a note lives.
   - Reopening a subtask whose top-level task is done reopens its ancestors too, and moves the tree back out of `_done/`, because a done root never holds open tasks.
3. **Mixed trees in today's data.** Measured: 7 deleted subtasks of finished parents, and 2 finished subtasks of a deleted parent.
   - **A deleted task leaves its tree.** It moves to `_trash/<Name>/` on its own and keeps `parent_task` as a record.
   - **Everything else follows its top-level task:** a deleted root takes its whole tree, done subtasks included, into `_trash/`.
   - **Open subtasks of a finished parent** (4 today: 1 in accuris, 3 in ero) become open top-level tasks in `spice/tasks/`, and `parent_task` keeps naming the finished parent as a record. Nothing's status changes, and nothing leaves the open lists. (Will, 2026-11-10.)
4. **Restoring from the trash** has no gesture in the app today and stays out of scope. A trashed subtask's `parent_task` keeps the record of where it came from.
5. **Ambiguous parents** (4 subtasks today): the heal picks, in order:
   1. the candidate in the same place as the child (open with open, done with done);
   2. the one created before the child;
   3. the newest.

   It reports the pick. It makes a task top-level only when no candidate is a task, which today is 1 missing parent.
6. **Names are fixed once given.** Renaming a task renames only that task, so a child's `(Parent Title)` suffix can go stale. A ` (Nov 10)` suffix stays after the clashing note is gone. No rename cascades.
7. **Link scope.** The heal rewrites:
   - wikilinks and embeds (`[[…]]`, `![[…]]`, any alias or path form);
   - markdown links whose target is a task note's path;
   - wikilinks inside any frontmatter value, not just `parent_task`, `source_note` and `links`.

   Path strings inside queries (Dataview, Bases) are reported, not rewritten.
8. **Obsidian owns link rewrites at apply.**
   - The apply step runs inside Obsidian and moves notes with `app.fileManager.renameFile`, which rewrites every link that resolves to the moved note.
   - Before moving anything, apply first rewrites the links that are ambiguous today, using the plan's resolution, to their unambiguous `[[full/path|alias]]` form. That way Obsidian's rewrite lands each one on the right note.
   - The heal never rewrites a link Obsidian will rewrite.
9. **Where it runs.**
   - The plan and the dry-run report are computed by the installer (Node, the vault adapter), like the other task heals.
   - Apply runs in Obsidian from an **Apply** button on the report note, through a new `TaskFolders` customJS class.
   - `TaskFolders` and `TaskEntity.taskName` share one naming implementation. The installer loads the same file, as `run-customjs-loadable` already does for the classes, so names agree. A test asserts it.
   - Running inside Obsidian also settles the Sync risk.

## Left to the builder

- The report's exact layout.
- Whether `taskName`'s vault-wide check reads `getMarkdownFiles()` each time or keeps a cached set.
- The test layout. The heal needs a seed-vault fixture with clashes, a missing parent, a loop, nested done subtasks and trashed trees (`Docs/agent-guides/migration-regression-net.md`).
- How the apply step runs inside Obsidian (point 5 above).
