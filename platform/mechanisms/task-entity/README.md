# task-entity

The **note-per-task core** for the Sauce to-do model. Every to-do task becomes
its own tiny note under `spice/tasks/` carrying `type: task` frontmatter, and
surfaces (the daily note, project hubs, meeting notes) **live-query** those
notes rather than parsing checkbox lines out of a shared markdown file.

Ships `customJS.TaskEntity` — a pure, deterministic, side-effect-free class that
owns the shared task grammar so every consumer produces byte-identical output.

## Frontmatter schema

```yaml
type: task
title: Call Shirley Septic
status: open            # open | done | deleted
scheduled: 2026-07-01   # "do-on" date (drives the daily). blank = unscheduled
due: 2026-06-30         # optional
priority: high          # optional: low | medium | high | highest
project: "[[Sauce]]"    # optional wikilink
project_slug: sauce     # optional denormalized slug
source: daily           # daily | project | meeting | manual
source_note: "[[...]]"  # optional backlink
created_at: 2026-07-01T14:22:33-06:00
completed_at:           # set when done
```

Absent `scheduled` / `due` / `completed_at` are written as **empty strings**
(not omitted) so setting a date later is a simple in-place field write.

## Task folders

Each task is a folder holding its note, and a subtask's folder sits inside its
parent's. Design and rulings:
[`Docs/superpowers/specs/2026-11-10-task-folders-design.md`](../../../Docs/superpowers/specs/2026-11-10-task-folders-design.md).

```
spice/tasks/
  Help Henry out with Routes/
    Help Henry out with Routes.md      ← the task note (type: task)
    Review the routes PR/
      Review the routes PR.md          ← subtask (stays here when done)
  _done/2026/11/Pay Bills/Pay Bills.md ← a finished top-level task, whole tree
  _trash/Old idea/Old idea.md
```

- **Layout.** A folder and its note share one name: `<Name>/<Name>.md`. Other
  files in the folder are that task's attachments. A task's parent is the task
  note in the folder directly above it; `parent_task: "[[<Parent Name>]]"` is
  kept in step as a mirror, and the folder wins if they disagree.
- **Naming.** `TaskEntity.taskName(title, ctx)` gives the note and folder name:
  the sanitized title while no other markdown file anywhere in the vault has
  that basename (case-insensitive). On a clash a subtask adds its parent's
  title (`Review PR (Help Henry)`) and a top-level task its creation date
  (`Pay Bills - 11-10-26`), then ` 2`, ` 3`, … Names are fixed once given: a task
  whose name is unique is never renamed, and renames never cascade.
- **Status is truth.** `status: done` / `deleted` decides what is open, done or
  trashed on every list, count and Reopen gate; the path only decides where the
  note lives. A finished subtask stays in place; a finished top-level task
  moves its whole folder to `_done/YYYY/MM/` (completion month); a deleted task
  moves its folder to `_trash/`. An open task whose parent is done, deleted or
  missing (a promoted task) lists as a root, so it never drops out of the open
  lists.
- **Both layouts until Apply.** A note in a task folder takes its parent from
  the folder; a flat `spice/tasks/<Title>.md` note falls back to `parent_task`.
  New tasks are always written in the folder layout, so a half-migrated vault
  works. A task card lists its folder children and its flat children together.
- **Migration: dry run, then Apply on the desktop.** The installer heal
  `applyTaskFoldersHeal` only plans. It writes
  `ranch/reports/task-folders-YYYY-MM-DD.md` (every move, rename, parent pick,
  promoted task, ambiguous link and unresolved item, plus the plan as a
  ```` ```json ```` block) and moves nothing. The report's Apply button
  (`TaskFolders`, `task-folders.js`) runs the moves inside Obsidian through
  `app.fileManager.renameFile`, so Obsidian rewrites the links and Sync sees
  every move. It refuses on a phone (`app.isMobile`) and says to run it on the
  desktop, and refuses while "Automatically update internal links" is off. A
  run that moved at least one note appends `<!-- task-folders:applied -->` and
  an `## Applied <ISO>` section; a run that moved nothing appends an
  `## Apply attempt <ISO>` section without the anchor, so Apply stays
  available. Re-running the installer never overwrites an applied report.
- **Undo.** There is no undo button: Obsidian Sync's version history is the
  undo for a move.

## Task notes

Prompts, handoffs, plans, context, findings and questions belong to a task
without being steps of it, so they are notes, not subtasks (`TaskDocs`,
`task-docs.js`; spec: `Docs/superpowers/specs/2026-11-12-task-notes-design.md`).

- **Where.** `spice/tasks/<Task>/notes/<Name>.md`, only under a task in the
  folder layout. They move with the task's folder to `_done/` or `_trash/`.
- **Frontmatter.** `type: task-doc`, `kind:` one of prompt, handoff, comms, plan,
  context, findings, questions, note (anything else reads as note),
  `title`, `task: "[[<Task>]]"`, `created_at`. No `status`: a note never
  counts toward the task's progress and never lists as a to-do.
- **Names.** `TaskEntity.taskName(title, { parentTitle })`: the plain title
  while unique in the vault, else `Title (Task)`.
- **Card.** The task card's Notes section lists them in kind order, newest
  first; Copy prompt on prompt and handoff notes copies the prompt
  (`TaskDocs.extractPrompt`: a fenced block under a heading or callout titled
  "prompt", else the first text fence, else the body); + Note creates one
  from its kind's template and opens it.
- **Header.** Every note starts with `TaskDocs.HEADER`: the breadcrumb bar
  (`TaskChromeBar`, To-Do › task › note) and the header card
  (`TaskDocs.renderHeader`). The card is tinted in the kind's colour
  (`TaskDocs.TONES`, which also colours the note icons on the task card) and
  shows the trail up to the task, the kind badge (click to change the kind),
  the previous and next notes of the task, the title, the task's status, due
  date, priority and project, and Copy prompt (prompt and handoff) or Copy
  message (comms: the message to send others about the task) and Open task.
  The installer's `applyTaskDocHeaderHeal` adds the header to notes made
  before it, replacing their one-line `> [!info] <Kind> for [[Task]]` header.
- **Rename.** The pencil next to the header card's title (or a double-click
  on it) and the pencil on each Notes row turn the name into a field; Enter
  or leaving the field saves, Escape cancels. `TaskDocs.rename` sets the
  `title` and renames the file by the Names rule above with
  `fileManager.renameFile`, so links follow; the note stays in `notes/`.
- **Agents.** The vault's CLAUDE.md directory map names this folder, so a
  session writes its prompts, handoffs and findings here.

## API (`customJS.TaskEntity`)

All methods are static (with instance delegators, so cross-class calls via
`window.customJS.TaskEntity.x()` work) and pure:

| Method | Purpose |
| --- | --- |
| `taskFilename(payload, moment)` | Deterministic `task-<YYYYMMDD>-<HHmmss>-<hex4>.md`. `hex4` hashes `title + '|' + HHmmss`, so two tasks in the same second with different titles get different files. |
| `composeNote(payload)` | `{ path, frontmatter, body }` — schema-exact frontmatter in canonical key order, empty body. |
| `parseNote(page)` | Normalize a Dataview page: missing `status` → `"open"`, blank dates → `null`. |
| `queryToday(tasks, todayStr)` | `{ today, overdue }` over **open** tasks only; future + unscheduled excluded. |
| `validatePayload(payload)` | `{ valid, reason }` — `title` required; `scheduled`/`due` must be `YYYY-MM-DD`. |

## Safety guarantees

The note-per-task design exists to make a whole class of data-loss bugs
**structurally impossible**:

- **Wipe impossible.** A task lives in its own file. A bad edit or crash mid-write
  can corrupt at most one task's note — never a whole day's task list. There is
  no single shared markdown file whose accidental truncation destroys everything.
- **One-file writes.** Creating, editing, completing, or deleting a task touches
  exactly one file. No multi-line splice into a shared list, no re-serializing a
  day of checkboxes on every keystroke.
- **Recoverable delete.** Delete is `status: deleted`, not an `unlink`. A deleted
  task's note (and its content) survives; it simply drops out of the live queries.
  Recovery is flipping the status back.
- **Backup-first migration.** Any migration that ingests legacy checkbox lines
  into task notes writes a backup of the source first, so the original day's
  content is always recoverable if the migration misfires.

## Determinism

No `Date.now`, `Math.random`, or `new Date` anywhere — the filename hash is a
tiny non-crypto string hash (`_hash4`) over `title + '|' + HHmmss`. The same
payload + moment always yields the same filename, which keeps the tests
deterministic and satisfies the customJS-load gate's no-wall-clock invariant.

## customJS-load safety

`task-entity.js` is a **bare class with no trailing statements**. The CustomJS
plugin loads each file via `eval("(" + file + ")")` then `new()`, parsing the
whole file as ONE expression — any trailer (`module.exports`, `if`, ...) makes
it a `SyntaxError` and the class never registers. Node-test the statics by
loading the class via `new Function(src + "; return TaskEntity;")()` (see
`platform/test/run-task-entity.js`). The `run-customjs-loadable.js` preflight
gate enforces this.
