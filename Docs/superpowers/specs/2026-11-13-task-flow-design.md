# Task flow: follow-ups, Claude loop, day rhythm, Now, meeting actions, drag and drop, task sets, jump

Requested by Will on 2026-11-13 ("plan out ... and implement every aspect of this and deploy to all vaults"). These features build on the task folders, task notes and header card work (specs `2026-11-10-task-folders-design.md` and `2026-11-12-task-notes-design.md`).

## Why

Will runs the work of a task through its notes:
- **Prompt notes** go to Claude sessions.
- **Comms notes** hold messages to colleagues, written by those sessions and sent by Will.
- **Findings and handoffs** come back from the sessions.

Today three things are missing:
- nothing tracks a sent message until someone answers;
- nothing shows that a session has written something new;
- the day has no start or end ritual.

Moving tasks around also means opening the edit dialog. Each feature below closes one of these gaps. Inference, not quoted: the goal is fewer things held in his head.

## Global rulings (apply to every feature)

- **Phones.** Everything works on the phone, and nothing is hover-only. HTML5 drag never fires on touch, so on mobile every drag gesture has a ⋯ menu equivalent. There is no long-press drag. (Ruling; cost if wrong: a later long-press layer, which the menu entries do not block.)
- **Writes.**
  - Every gesture write goes through `RenderSafe.mutate` (the `lint-gesture-writes` lint).
  - Moves use `app.fileManager.renameFile`, so links follow.
  - Frontmatter changes use `processFrontMatter`.
- **Derived over stored.** State that can be derived from notes is derived, not written twice.
- **Per-device state.** Only "seen" markers live in `localStorage`, wrapped in try/catch. Everything else is frontmatter, so it syncs.
- **New Dataview surfaces.** Each one gets a row in the `Docs/agent-guides/code-conventions.md` ledger and bumps the `run-render-safe.js` count.
- **Ranch mirrors.** Mirrors in `ranch/scripts/` equal their `platform/` source.

## 1. Comms: Mark sent, follow-up, Waiting on

- **Frontmatter on a comms note:**
  - `to:` (free text, for example `Jason Batai, Matt Hemingway`);
  - `via:` (Slack, Email, Teams or Other);
  - `sent_at:` (ISO);
  - `replied_at:` (ISO, blank until answered).
- **Header card, unsent comms note:** a **Mark sent** button opens a small popover with:
  - To (prefilled from `to:`);
  - Via (four choices);
  - Follow up: None, Tomorrow, In 2 work days (default), Next Monday, or a date.
- **Saving the popover:**
  - writes `to`, `via` and `sent_at`;
  - if a follow-up was chosen, creates a subtask of the note's task. It is titled `Hear back from <first name(s)>: <note title>`, with `due` set to that date, `source: comms` and `source_note: "[[<comms note>]]"`. The usual `TaskEntity` naming and folder rules apply.
- **Header card, sent comms note:**
  - a chip reading `Sent Nov 13 · Slack · waiting 2d`;
  - a **Got reply** button, which sets `replied_at` and marks the linked open follow-up task done.
- **Waiting.** A comms note is *waiting* while `sent_at` is set, `replied_at` is blank, and no follow-up task linked to it is done. Completing the follow-up task in To-Do therefore counts as a reply, with no cross-write.
- **To-Do: a new Waiting tab.** It lists waiting comms notes, oldest sent first, as rows. Each row shows:
  - the kind icon and the note title;
  - to whom and via what;
  - how long ago it was sent;
  - the parent task;
  - Got reply.
- **Task card Notes rows:** comms rows show `Sent Nov 13` or `Waiting 2d`.
- **Phone:** the same popover, laid out as a sheet.

## 2. Claude loop: Copy for Claude, New notes, Resume

- **Copy for Claude.** Prompt notes get a button next to Copy prompt. It copies the prompt followed by a short context block:
  - the task title and the task note's vault path;
  - the notes folder path;
  - one line saying to write results there as `type: task-doc` notes with `kind:` findings, comms or handoff, `title:`, `task: "[[<Task>]]"`, `created_at:`, and the TaskDocs header, and to set `session:` on a handoff.
- **New.** A note counts as new when its file `mtime` is later than this device's last view of it.
  - A view is recorded when that note's header card renders.
  - The record lives in `localStorage` key `sauce-taskdoc-seen`, holding `{ path: epochMs }`.
  - Notes changed more than 14 days ago never count as new.
  - Effect on the task card: Notes rows show a `New` pill.
  - Effect on To-Do rows: a task with new notes shows a small `New note` / `2 new notes` chip that opens the newest.
  - A note created on this device through + Note is recorded as seen when it opens.
- **Resume.**
  - A handoff note may carry `session:`, holding a Claude session URL or a session id.
  - The header card then shows **Resume**. A URL opens with `window.open`; an id is copied as `claude --resume <id>` with a notice.
- **Agents.** The vault CLAUDE.md task-notes row (the `claude_surface` text in `platform/mechanisms/task-entity/manifest.json`) says to set `session:` on handoffs and to write results into the task's `notes/` folder.

## 3. Day rhythm: Plan the day, Shut down

- **Plan the day** (a Home panel, and a collapsed callout-style panel at the top of today's daily note). It shows:
  - the Now task (feature 4), if pinned;
  - Overdue;
  - Due today;
  - today's meetings (from the meetings blueprint's own query, if there is one; otherwise left out);
  - Waiting (feature 1), with how long each has waited.

  Each entry is clickable, and the counts sit in the panel head.
- **Shut down** (a button on that panel, and a command `Sauce: Shut down the day`). It opens a modal with:
  - **Done today:** a read-only list.
  - **Still open:** overdue tasks and tasks due today, each with Tomorrow, Next work day, Pick date, Done and Leave.
  - **Finish:** applies the choices one task at a time through the existing reschedule and markDone paths. It then appends a `## Shutdown` section to today's daily note:
    - `Done: N`, with the titles as links;
    - `Moved: N`, as `title → date`;
    - `Still waiting: N`.

    Re-running it the same day replaces that day's section rather than adding a second one.

## 4. Now

- **Field.** A task may carry `pinned_at:` (ISO). The open task with the newest `pinned_at` is **Now**.
- **Pinning.**
  - Pin from the task card header (a pin button) or a To-Do row's ⋯ menu.
  - Pinning a task clears `pinned_at` on any other task that has it, and sets it on this one.
  - Unpinning clears it.
  - A Now task that is completed simply drops out.
- **Now card,** at the top of Home and of today's daily note. It shows:
  - the title;
  - the due chip;
  - subtask progress;
  - Copy prompt (from the newest prompt note);
  - Copy message (from the newest unsent comms note);
  - Open;
  - Unpin.

## 5. Meeting action items

- **Line format.** In a meeting note, a line starting with `->` or `→` is an action item. The forms are:
  - `-> thing`: mine;
  - `-> Name: thing`: someone else's;
  - an optional trailing ` (due Fri)` or ` (due 2026-11-20)`.
- **Make tasks.** A **Make tasks** button sits on the meeting's task section, the surface `task-meeting-list.js` draws. It opens a review modal: one row per unconverted action line, each with a checkbox, an editable title and an editable due date.
- **Creating them.**
  - **Mine:** a task with `source: meeting` and `source_note` set to the meeting.
  - **Someone else's:** a task `Hear back from <Name>: <thing>` with the same source fields, plus a comms note under it with `to: <Name>` and the action as its first line.
  - A converted line is rewritten in the note to end with ` ✓ [[<task name>]]`, so it is never offered again.

## 6. Drag and drop (desktop) with menu equivalents (all devices)

- **Task onto task makes a subtask.**
  - Dropping on a row's middle third nests it. The edges keep their current reorder meaning where reorder exists.
  - It uses the same re-parent path as the edit dialog's parent field (`TaskDialog`), moved into a shared static that both call.
  - Loops are refused (a task into its own descendant).
  - It works on: the To-Do lists; the task card's subtask list (dropping onto a sibling); and the daily dashboard task panel.
- **Make top-level.** While a subtask is dragged, a `Make top-level` drop strip appears at the top of the list.
- **Reorder subtasks on the task card.**
  - Subtasks get `rank` among their siblings.
  - `_orderedChildren` orders open subtasks by rank, unranked last in their current order; done subtasks keep newest-first.
  - Drag on desktop; ⋯ Move up / down on all devices.
- **Group headers.** Dropping on a project group header sets `project` and `project_slug`. Dropping on a trip group header sets `trip` and `trip_slug`. Both use the same writers the edit dialog uses.
- **Notes.** Dropping a Notes row on a subtask row of the card moves the note into that subtask's `notes/` folder, sets `task:`, and renames it by the usual rule.
- **Menu equivalents** (⋯ on rows, all devices):
  - Make subtask of… (a fuzzy picker of open tasks);
  - Make top-level;
  - Move to project…;
  - Move up / down (subtasks);
  - Move note to task… (Notes rows).

## 7. Task sets

- **Where they live.** A set is a note at `spice/tasks/_sets/<Name>.md` with `type: task-set`.
- **Its body:**
  - a `- [ ]` list: one subtask per line, where indentation makes nested subtasks and `(due +2)` sets a relative due in work days;
  - an optional `## Prompt` section: the text of a prompt note;
  - an optional `## Comms` section: the text of a comms note.
- **New from set.** An entry in the + task flow (To-Do and Home capture, wherever "New task" is offered). It picks a set, asks for the title and an optional due date, then creates:
  - the task;
  - its subtasks;
  - its prompt and comms notes.

  `{{task}}` in the set text is replaced with the task title.
- **Lists ignore `_sets/`.** It is excluded from the task lists, the task folders heal and the stray scans, like `_done/` and `_trash/`.
- **Seed sets.** The installer adds two seed sets only when `_sets/` does not exist: `PR rollout` and `Incident`. It never overwrites.

## 8. Jump

- **Command.** `Sauce: Jump to task or note` (registered the way the existing `*-init.js` commands are), plus a search button on the To-Do chrome bar and on Home.
- **What it searches.** A fuzzy picker over every task (open, done and trashed, in that order) and every task note.
- **Each row shows:**
  - the kind icon, or a checkbox glyph for a task;
  - the title;
  - the parent trail (dim);
  - the status or due date.
- **Behaviour.** Enter opens; Mod+Enter opens in a new tab.

## Order of work

- **Wave A** (in parallel, separate worktrees): 1 + 2 (one PR, both in `task-docs.js`); 5; 7; 8.
- **Wave B**, after wave A merges: 3 + 4 (one PR).
- **Wave C:** 6.

PRs merge one at a time, each after the previous release reaches the tap. All three vaults get the final deploy, plus a deploy after each wave.
