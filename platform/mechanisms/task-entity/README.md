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
source: daily           # daily | project | meeting | manual | comms
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
  and opens it, blank under its header (no starter text).
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
  session writes its prompts, handoffs and findings here, and sets
  `session:` on a handoff.

Comms follow-ups and the Claude loop (spec:
`Docs/superpowers/specs/2026-11-13-task-flow-design.md` §1-2):

- **Mark sent.** An unsent comms note's header card has Mark sent: a small
  panel (a sheet on a phone) with To (from `to:`), Via (Slack, Email, Teams,
  Other) and Follow up (None, Tomorrow, In 2 work days, Next Monday, or a
  date). Saving writes `to`, `via`, `sent_at` and a blank `replied_at`, and
  for a follow-up creates a subtask of the note's task through
  `TaskDialog.createQuick`: `Hear back from <first names>: <note title>`, due
  that day, `source: comms`, `source_note: "[[<note>]]"`.
- **Waiting.** A comms note is waiting while `sent_at` is set, `replied_at`
  is blank and no follow-up task naming it is done (`TaskDocs.waiting`), so
  finishing the follow-up counts as a reply. Its card shows
  `Sent Nov 13 · Slack · waiting 2d` and Got reply (sets `replied_at` and
  marks the open follow-up done); its Notes row shows `Waiting 2d` or
  `Sent Nov 13`. To-Do's Waiting tab lists waiting notes oldest first, with
  Got reply on each row. The card, the Notes rows and the tab all match a
  follow-up anywhere in the vault by `source_note`, so they agree. Notes
  under `_done/` or `_trash/` never wait and have no Mark sent or Got
  reply. A follow-up Got reply cannot close leaves the reply saved and
  says how many are still open.
- **Copy for Claude.** A prompt note's card copies the prompt, a `---` line,
  and a short block: the task and its path, the notes folder, and how to
  write results there as `type: task-doc` notes.
- **New.** A note changed since this device last opened it (its header card
  last rendered; `localStorage` key `sauce-taskdoc-seen`) shows New on the
  task card, and its task's To-Do row shows `New note` / `2 new notes`,
  which opens the newest and counts down at once. Edits made here (typing in the open note, rename,
  Mark sent, Got reply, + Note) count as seen; notes changed more than 14
  days ago are never new.
- **Resume.** A handoff with `session:` has Resume: an `http(s)://` or
  `claude.ai/` link opens; an id of letters, digits, `_` and `-` is copied
  as `claude --resume <id>`; anything else copies nothing and says so.

## Jump to task or note

`TaskJump` (`task-jump.js`; spec: `Docs/superpowers/specs/2026-11-13-task-flow-design.md` §8)
is a fuzzy picker over every task and task note.

- **Opening it.** The command `Sauce: Jump to task or note` (`sauce:jump-to-task`,
  registered by the `TaskJumpInit` startup script), and the search button on
  every To-Do chrome bar and on Home (`iconActions` in the bar's spec).
- **Rows.** Open tasks, then done, then trashed, then task notes, read from the
  metadata cache (`type: task` / `type: task-doc` under `spice/tasks/`, never
  `spice/tasks/_sets/`). A task's group is `TaskEntity.taskState`: status
  decides, and a task under `_trash/` is trashed. Notes of a task under
  `_done/` read "Done note" and those under `_trash/` "Trashed note" (struck
  through); both list after live notes. Each row shows a checkbox glyph
  (task) or the kind icon (note), the title, the parent trail (from the task
  folders, else `parent_task` / `task:`), and the due date, Open, Done,
  Trashed or the note's kind.
- **No query.** With no query the picker shows open tasks first (up to 100
  rows); done, trashed and note rows appear once you type.
- **Ranking.** `TaskJump.rank`: exact title, then title starts with the query,
  a title word starts with it, the title contains it, every word is in the
  title, every word is in the title or trail, and last the letters in order.
  Equal matches keep the open, done, trashed, notes order.
- **Keys.** Enter opens the note; Mod+Enter (or Cmd/Ctrl-click) opens it in a
  new tab. On the phone a tap opens it.

## Task sets

Reusable starter bundles (`TaskSets`, `task-sets.js`; spec:
`Docs/superpowers/specs/2026-11-13-task-flow-design.md`, section 7).

- **Where.** `spice/tasks/_sets/<Name>.md` with `type: task-set`. Each `- [ ]`
  (or `- [x]`) line is a subtask, always created open (indent to nest; a
  trailing `(due +2)` makes it due two work days after the day the set is
  used); a plain bullet and everything under it is ignored. `## Prompt` holds
  a prompt note's text and `## Comms` a comms note's. `{{task}}` is replaced
  with the title after the set is read, so a title cannot change its shape.
- **New from set.** In the + menus (Home and every chrome bar) and the
  `Sauce: New task from set` command: pick a set, type a title and an optional
  due date; the task, its subtasks (each folder inside its parent's) and its
  notes are created in one step and the task opens.
- **Not tasks.** Task lists, the task-folder heals, the stray scans and the
  note-header heal all skip `_sets/`, like `_done/` and `_trash/`.
- **Seeds.** The installer's `applyTaskSetsSeedHeal` writes `PR rollout` and
  `Incident` only when `_sets/` does not exist, and never overwrites.
  Delete the sets you don't want; an empty `_sets/` folder is never refilled.
- **All or nothing.** If any write fails, everything that create made is
  moved to the trash, a notice says "Couldn't create from set; nothing was
  kept", and the dialog reopens with the title filled in.

## Meeting action items

In a meeting note, a line starting with `->` or `→` is an action item
(`TaskMeetingList`, `task-meeting-list.js`; spec:
`Docs/superpowers/specs/2026-11-13-task-flow-design.md` § 5).

- **Line format.** `-> thing` is mine; `-> Name: thing` is someone else's
  only when Name is a `[[link]]` or matches (any case, full or first name)
  an attendee or a note under `spice/people/`. Anything else before a colon
  stays part of my item. An optional trailing ` (due Fri)`,
  ` (due tomorrow)` or ` (due 2026-11-20)` sets the due date, counted from
  the meeting's `date:` (else today). A weekday is the next such day after
  that date, rolled forward a week at a time so it is never before today;
  `tomorrow` from an old meeting is today + 1. An explicit date stays as
  written. Lines in code fences or indented code are ignored.
- **Make tasks.** A button on the meeting's task section opens a review
  modal: one row per unconverted line, with a checkbox, an editable title and
  an editable due date. Mine becomes a task with `source: meeting` and
  `source_note: "[[<Meeting>]]"` (and the meeting's project). A title reading
  `Hear back from <Name>: <thing>` also gets a comms note under the task,
  `Message to <Name>`, with `to: <Name>` and the thing as its first line.
- **Converted lines.** Each converted line is rewritten to end with
  ` ✓ [[<task name>]]`, so it is never offered again. A line edited since the
  modal opened is skipped. It is all one `RenderSafe.mutate` write; every
  task that was made has its line marked even if the batch fails part-way,
  and a second Make tasks on the same meeting is refused while one runs.
  The summary notice counts comms notes that could not be made.

## Now, Plan the day and Shut down

The day rhythm (`TaskDayPlan`, `task-day-plan.js`; spec:
`Docs/superpowers/specs/2026-11-13-task-flow-design.md`, sections 3 and 4).

- **Now.** A task may carry `pinned_at:` (ISO). The open task with the newest
  `pinned_at` is Now; a done or trashed one drops out with no write. Pin from
  the pin button on the task card header or Pin as Now in a To-Do row's ⋯
  menu. The button and the menu read Unpin only on the task that IS Now
  (worked out by path), else Pin as Now. Pinning sets `pinned_at` on that
  task (that write is the pin), then removes it from every other task that
  has it, one at a time; any it can't clear are named in one notice
  ("Pinned; couldn't clear N other pins"). A task that is not open is
  refused. Unpin removes it. Both go through `RenderSafe.mutate`.
- **Now card.** At the top of Home and of today's daily note: the title, the
  due chip, subtask progress, Copy prompt (newest prompt note), Copy message
  (newest comms note with no `sent_at`), Open and Unpin. A copy button shows
  only when there is a note to copy from.
- **Plan the day.** Under the Now card: open on Home, collapsed on today's
  daily note (never on other days). Now, Overdue (oldest due first), Due
  today, today's meetings (`SpaceDailyDashboard.selectMeetings`) and Waiting
  (`TaskDocs.waiting`; left out until that loads), with the counts in the
  head. Every row opens its note. The panel stays open or closed as you left
  it for the session. Home draws it as its own block and tells the dashboard
  not to (`dayPlan: false`).
- **Shut down.** The button on the panel head and the command
  `Sauce: Shut down the day` (`sauce:shut-down-day`, `TaskDayPlanInit`).
  The modal lists Done today (read only) and Still open (overdue and due
  today), each with Tomorrow, Next work day (Mon–Fri), Pick date, Done or
  Leave (the default). Finish stays disabled, with a hint, while a Pick date
  has no date. Finish closes the modal, applies the moves and then the Done
  choices one task at a time through `TaskTodayList.reschedule` and
  `TaskDialog.markDone`, each at the task's current path (found again by
  name if a parent's Done moved it), and writes a `## Shutdown` section to
  today's daily note (`Done: N` with links, `Moved: N` as `title → date`,
  `Still waiting: N`) with `app.vault.process` inside `RenderSafe.mutate`.
  The generated part sits between hidden `%% shutdown:start %%` and
  `%% shutdown:end %%` markers; a second run the same day replaces only
  that part, keeps the earlier Moved items (one per task, this run's date
  winning) and leaves anything written below the markers. Lines keep their
  own endings (CRLF stays CRLF). While a Finish is still writing, Shut down
  only says "Shut down is still finishing". With no daily note for today the
  choices still apply and a notice says the summary was not saved. Home and
  the daily note skip `_done/` notes unless they are open or were finished
  today.

## Moving tasks and notes

Drag and drop on the desktop, with the same moves in the row's ⋯ menu on every
device (`TaskMove`, `task-move.js`; drag wiring in `TaskTodayList`; spec:
`Docs/superpowers/specs/2026-11-13-task-flow-design.md`, section 6). HTML5 drag
never fires on touch, so the phone has the menu only (no long-press drag).

- **One re-parent.** `TaskDialog.reparent(app, task, parent)` is the move both
  the edit dialog's Subtask of… field and every gesture run: a loop (the task
  itself, its own subtask by folder, or a `parent_task` chain that reaches it)
  is refused before anything is written; `parent_task` is written and `rank`
  cleared; the folder moves under the new parent (or to `spice/tasks/` for the
  top level) by the Task folders rules; an undated subtask made top-level takes
  its old parent's due. `parent = null` is Make top-level.
- **Drop on a task.** The ⋮⋮ handle drags a row. On the To-Do lists, the
  task card's subtasks and the daily dashboard panel, a row's middle third
  nests the dragged task under it (an outline); its top and bottom thirds
  reorder (a line) where manual order applies. A drop on itself, into its own
  subtask or onto the parent it already has shows red dashes and a label and
  does nothing.
- **Make top-level.** While a subtask is dragged, a Make top-level strip shows
  above the list.
- **Subtask order.** Open subtasks on the task card sort by `rank` among their
  siblings, unranked last in their current order; done ones stay newest first.
  Drag to reorder, or Move up / Move down in the ⋯ menu.
- **Group headers.** A task dropped on a project header (To-Do grouped by
  project, the project groups) gets `project` / `project_slug`; on a trip
  header, `trip` / `trip_slug` (`TaskDialog.projectFields` / `tripFields`, the
  dialog's writers). "No project" clears it.
- **Notes.** A Notes row's handle drags it onto a subtask row of the card;
  `TaskDocs.moveTo` moves it into that task's `notes/` with `renameFile`, sets
  `task:` and renames it by the Names rule.
- **⋯ menu.** Make subtask of… (a fuzzy picker of open tasks, never the task or
  its subtasks), Make top-level (subtasks), Move to project…, Move up / down
  (where manual order applies) and, on Notes rows, Move note to task….
- **Writes.** Every move is one `RenderSafe.mutate` gesture write.

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
