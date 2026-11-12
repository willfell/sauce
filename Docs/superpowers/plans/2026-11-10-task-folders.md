# Task Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every task becomes a folder that nests as its subtasks do, task note names are unique across the vault, and an install heal plus an in-Obsidian Apply step migrate the existing tasks.

**Architecture:**
- **Layout and names:** pure helpers in `TaskEntity` own the folder layout, unique names and task state. Every app surface reads them.
- **Lifecycle:** `TaskDialog` carries out create, finish, reopen, delete, re-parent and rename on that layout.
- **Migration:** the installer plans it in Node, using its own copy of the naming rule, kept equal by a parity test. It writes a dry-run report note. A new `TaskFolders` customJS class applies the plan inside Obsidian through `app.fileManager.renameFile`.

**Tech Stack:** CustomJS classes (bare-class files, `new Function(src + "\nreturn X;")()` in tests), Obsidian API (`app.vault`, `app.fileManager`, `app.metadataCache`), the installer (`platform/install.js`, Node and the vault adapter), zero-dependency Node test harnesses under `platform/test/` registered in `platform/test/preflight-manifest.json`.

**Spec:** `Docs/superpowers/specs/2026-11-10-task-folders-design.md` (approved by Will, 2026-11-10).

## Global Constraints

- **Layout:** a task note lives at `<folder>/<Name>/<Name>.md`, and its folder and note share `<Name>`. A subtask's folder sits inside its parent's folder.
- **Parent:** a task's parent is the task note in the folder directly above it. `parent_task` stays as `"[[<Parent Name>]]"`, kept in step whenever a task moves. The folder wins.
- **Done:** a finished subtask stays in place with `status: done` and `completed_at` set. A finished top-level task moves with its whole folder to `spice/tasks/_done/YYYY/MM/<Name>/`, by completion month.
- **Delete:** a deleted task's whole folder moves to `spice/tasks/_trash/<Name>/`. A deleted subtask leaves its tree and keeps `parent_task` as a record.
- **Names:**
  1. `_sanitizeTitle(title)`;
  2. if that's unique vault-wide (case-insensitive basename, ignoring the task's own note), use it;
  3. else a subtask tries `<Title> (<Parent Title>)` and a top-level task tries `<Title> (<Mon D>)` from `created_at`;
  4. else add ` 2`, ` 3`, ….
- **Renames:** names are fixed once given. Renaming a task renames only that task, and nothing cascades. A task whose name is already unique is never renamed.
- **Status is truth:** `status: done`, `deleted` or `open` decides state everywhere. The path only decides where a note lives.
- **Both layouts:** both are read until the migration is applied. A flat note (`spice/tasks/<x>.md`, or one directly under `_done/` or `_trash/`) falls back to `parent_task` for its parent. Writes of new tasks use the folder layout from the first release.
- **Mixed states:**
  - reopening a subtask whose top-level task is done reopens its ancestors and moves the tree back out of `_done/`;
  - finishing a task with open subtasks asks "Also complete its N open subtasks?"; No leaves it open.
- **Migration:**
  - **Ambiguous parent:** pick, in order, (1) the candidate in the same place as the child, (2) the one created before it, (3) the newest. Report the pick.
  - **No parent found:** the task becomes top-level, and that is reported.
  - **Open subtasks of a finished parent** become open top-level tasks, keeping `parent_task`.
  - **Everything follows its root,** except a deleted task, which leaves.
- **Link scope:**
  - **Rewritten:** wikilinks, embeds, markdown links to task paths, and wikilinks in any frontmatter value.
  - **Reported only:** paths inside Dataview or Bases queries.
  - **At apply,** ambiguous links are first rewritten to `[[full/path|alias]]`, then Obsidian's `renameFile` rewrites the rest.
- **Apply runs inside Obsidian** from the report note, never from the Node installer.
- **Ruling (planner, against spec §"Settled" 9):**
  - The spec says the installer loads the same naming file. It can't: `install.js` notes "the heal can't require the customJS" class files (≈12729), and replicates `_sanitizeTitle` for that reason.
  - So the installer gets its own copy of the naming rule (Task 7). A parity test runs both over a shared case table, which meets the spec's aim that names agree, tested.
  - Cost if wrong: one copy to delete later.
- **Repo rules:**
  - `ranch/scripts/**` mirrors stay byte-identical to their `platform/**` sources (`git add -f ranch/...`);
  - no Claude co-author trailer in sauce commits;
  - conventional commits;
  - never hand-edit versions.

## Review Focus

1. **A subtask with the same title as its parent** (or any ancestor) must get `<Title> (<Parent Title>)`, never a folder holding two notes of one name. *Pinned in Task 1, `TF-NAME-SAME-AS-PARENT`.*
2. **Long titles under deep parents** must keep every path segment within 120 characters, the `<Title> (<Parent Title>)` suffix included. *Pinned in Task 1, `TF-NAME-LENGTH-CAP`.*
3. **A case-only clash** ("pay bills" vs "Pay Bills") is a clash on macOS and iOS. *Pinned in Task 1, `TF-NAME-CASE`.*
4. **A subtask created under a parent that is still flat** (vault not migrated yet) must still be created, flat at the top level with `parent_task`, and show under that parent. *Pinned in Task 3, `TF-CREATE-UNDER-FLAT-PARENT`.*
5. **A recurring task's Mark done** rolls its due date forward and never moves its folder. *Pinned in Task 4, `TF-DONE-RECURRING-STAYS`.*

---

### Task 1: Layout, naming and state core in TaskEntity

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js` (pure statics plus instance delegators, after `_uniqueName`)
- Create: `platform/test/run-task-folders-core.js`
- Modify: `platform/test/preflight-manifest.json` (add `task-folders-core`)
- Mirror: `ranch/scripts/task-entity/task-entity.js`

**Interfaces:**
- Produces, all static and pure:
  - `TaskEntity.TASK_ROOT` = `'spice/tasks'`.
  - `TaskEntity.taskName(title, ctx) -> string`, where ctx is `{ parentTitle?: string, createdAt?: string, taken: (lowerBasename) => boolean }`. It returns a name with no `.md`.
  - `TaskEntity.folderNotePath(parentFolder, name) -> string`, giving `parentFolder + '/' + name + '/' + name + '.md'`.
  - `TaskEntity.isFolderNote(path) -> boolean`: true when the basename equals the parent folder's name.
  - `TaskEntity.taskFolderOf(path) -> string`, giving the folder of a folder note (for a flat note, its directory).
  - `TaskEntity.parentNotePathOf(path) -> string | ''`: the folder note one level up, when that folder is itself a task folder under `spice/tasks` (not `_done`, `_trash`, or a `YYYY` or `MM` bucket).
  - `TaskEntity.rootFolderOf(path) -> string`: the top-level task folder that contains `path` (inside `spice/tasks`, `spice/tasks/_done/YYYY/MM` or `spice/tasks/_trash`).
  - `TaskEntity.doneFolderFor(completedAt) -> string`, giving `spice/tasks/_done/YYYY/MM` (current month when blank).
  - `TaskEntity.taskState(task) -> 'open' | 'done' | 'deleted'`: from `status`, with `deleted` also for any path under `spice/tasks/_trash/`.
  - `TaskEntity.isOpenTask(pageOrTask) -> boolean`: `type` task (when present) and `taskState === 'open'`.

- [ ] **Step 1: Write the failing tests** in `run-task-folders-core.js`, loading the class via `new Function`:
  - `TF-NAME-PLAIN`: `taskName('Pay Bills', { taken: () => false }) === 'Pay Bills'`.
  - `TF-NAME-SUBTASK-CLASH`: taken `'review pr'` with `parentTitle: 'Help Henry'` gives `'Review PR (Help Henry)'`.
  - `TF-NAME-DATE-CLASH`: taken `'pay bills'` with `createdAt: '2026-11-10T14:06:43-07:00'` gives `'Pay Bills (Nov 10)'`.
  - `TF-NAME-NUMBER`: when both `'pay bills'` and `'pay bills (nov 10)'` are taken, the result is `'Pay Bills (Nov 10) 2'`.
  - `TF-NAME-CASE`: taken `'pay bills'` and title `'PAY BILLS'` (no createdAt, no parent) give `'PAY BILLS 2'`.
  - `TF-NAME-SAME-AS-PARENT`: title `'Review'`, `parentTitle: 'Review'`, taken `'review'` gives `'Review (Review)'`.
  - `TF-NAME-LENGTH-CAP`: an 80-character title with an 80-character parent title gives a result of `.length <= 120` that still starts with the title.
  - `TF-PATHS`:
    - `folderNotePath('spice/tasks/A', 'B') === 'spice/tasks/A/B/B.md'`;
    - `isFolderNote('spice/tasks/A/B/B.md')` and `!isFolderNote('spice/tasks/B.md')`;
    - `parentNotePathOf('spice/tasks/A/B/B.md') === 'spice/tasks/A/A.md'`;
    - `parentNotePathOf('spice/tasks/A/A.md') === ''`;
    - `parentNotePathOf('spice/tasks/_done/2026/11/A/B/B.md') === 'spice/tasks/_done/2026/11/A/A.md'`;
    - `rootFolderOf('spice/tasks/_done/2026/11/A/B/B.md') === 'spice/tasks/_done/2026/11/A'`;
    - `rootFolderOf('spice/tasks/_trash/X/X.md') === 'spice/tasks/_trash/X'`.
  - `TF-DONE-FOLDER`: `doneFolderFor('2026-11-10T09:00:00-07:00') === 'spice/tasks/_done/2026/11'`.
  - `TF-STATE`: `taskState({ status: 'done', path: 'spice/tasks/A/A.md' }) === 'done'`, `taskState({ status: 'open', path: 'spice/tasks/_trash/X/X.md' }) === 'deleted'`, and `isOpenTask({ type: 'task', status: 'open', file: { path: 'spice/tasks/A/B/B.md' } })`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `node platform/test/run-task-folders-core.js`
  Expected: FAIL, `TaskEntity.taskName is not a function`.
- [ ] **Step 3: Implement the statics** in `task-entity.js`, with instance delegators beside the others.
  - The `Mon D` date uses the first `YYYY-MM-DD` in `createdAt` and an English month table, with no `Date`.
  - The length cap trims the title part first, then the suffix part, to fit 120.
- [ ] **Step 4: Run them to see them pass.** Run the same command. Expected: `N/N passed`. Also run `node platform/test/run-task-entity.js` (expected `0 failed`) and `node platform/test/run-customjs-loadable.js` (expected `ok CJS-LOAD`).
- [ ] **Step 5: Mirror and commit.**
  ```bash
  cp platform/mechanisms/task-entity/task-entity.js ranch/scripts/task-entity/task-entity.js
  git add platform/mechanisms/task-entity/task-entity.js platform/test/run-task-folders-core.js platform/test/preflight-manifest.json
  git add -f ranch/scripts/task-entity/task-entity.js
  git commit -m "feat(task-entity): task folder layout, unique names and status helpers"
  ```

### Task 2: Read both layouts; decide done by status

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js`:
  - `parseNote`: when `isFolderNote(path)` and `parentNotePathOf(path)` is non-empty, `parent_task` is that folder's name; otherwise keep the `_linkText(p.parent_task)` fallback;
  - add `parent_path` (the parent note path, or `''`).
- Modify: every app filter that uses `includes('/_done/')` or `includes('/_trash/')` to mean "open" or "not deleted". Replace it with `TaskEntity.isOpenTask(p)` or `TaskEntity.taskState(p) !== 'deleted'`:
  - `task-trip-list.js:146-147`, `task-meeting-list.js:136-137`, `task-project-list.js:152-153`, `task-today-list.js:826-827`, `task-done-today-list.js:38`, `task-entity.js:725`, `task-note-view.js:747,880,945`;
  - `daily/helpers/space-daily-dashboard.js:245,274`;
  - `project/helpers/project-dashboard.js:333-334`, `project/helpers/project-meetings-list.js:170-171`;
  - `meetings/helpers/meetings-hub-cards.js:81`, `meetings/helpers/meetings-browse-list.js:100-101,625`;
  - `to-do/helpers/todo-daily-project-groups.js:126-127`, `todo-daily-filter-view.js:651`, `task-done-archive.js:50`, `todo-daily-trip-groups.js:29-30`, `todo-daily-unassigned-meetings.js:35-36`.
  - Each file resolves TaskEntity with the cold-load-safe pattern it already uses; a missing TaskEntity falls back to `status === 'open'`.
- Modify: `TaskTodayList.renderDoneRow` (`task-today-list.js:367`): `canUndo` becomes "`status === 'done'` and `TD.reopen` exists and `opts.onUndo`" (no path prefix).
- Modify: `TaskNoteView._actionsFor` (`task-note-view.js:418`): done means `['reopen','edit']` for any done task.
- Modify: `platform/mechanisms/task-entity/manifest.json` breadcrumb ancestor: `"link": "{fm:parent_task}"`.
- Create: `platform/test/run-task-folders-read.js`.
- Modify: `platform/test/preflight-manifest.json` (add `task-folders-read`).
- Mirror: every changed file under `ranch/scripts/`.

**Interfaces:**
- Consumes: Task 1's `isFolderNote`, `parentNotePathOf`, `taskState`, `isOpenTask`.
- Produces: `parseNote(page).parent_path: string`. The `parseNote(page).parent_task` basename is folder-derived for folder notes.

- [ ] **Step 1: Write the failing tests** in `run-task-folders-read.js`:
  - `TF-READ-PARENT-FOLDER`: `parseNote({ file: { path: 'spice/tasks/A/B/B.md' }, parent_task: '[[Stale]]' }).parent_task === 'A'` and `.parent_path === 'spice/tasks/A/A.md'`.
  - `TF-READ-PARENT-FLAT`: `parseNote({ file: { path: 'spice/tasks/B.md' }, parent_task: '[[A]]' }).parent_task === 'A'`.
  - `TF-READ-NO-PATH-CHECKS`: a source scan of the files listed above finds no `includes('/_done/')` and no `includes("/_done/")`.
  - `TF-READ-DONE-ROW-REOPEN`: `renderDoneRow` on `{ status: 'done', path: 'spice/tasks/A/B/B.md' }` with `TD.reopen` and `onUndo` draws the Reopen button.
  - `TF-READ-ACTIONS`: `TaskNoteView._actionsFor('done', 'spice/tasks/A/B/B.md').join() === 'reopen,edit'`.
  - `TF-READ-BREADCRUMB`: the manifest ancestor `link === '{fm:parent_task}'`.
- [ ] **Step 2: Run them to see them fail.** `node platform/test/run-task-folders-read.js`. Expected: FAIL.
- [ ] **Step 3: Implement the edits above.** Existing tests that assert the old path gates must be updated in the same commit:
  - `run-task-note-card.js` `TNC-ACTIONS` (a done non-archived task now gets `reopen,edit`; deleted still gets `edit`);
  - `run-todo-redesign-writes.js` / `run-task-entity.js` Reopen-gate cases.
- [ ] **Step 4: Run the tests.** Run `node platform/test/run-task-folders-read.js`, then `bash` over every `run-task*.js`, `run-todo*.js`, `run-meetings*.js`, `run-daily-dashboard.js` and `run-project-*.js`. Expected: `0 failed` and `N/N passed` everywhere.
- [ ] **Step 5: Mirror and commit.** `git commit -m "feat(task-entity): read nested task folders; status decides done and deleted"`

### Task 3: Create tasks and subtasks in folders

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js`:
  - `_prepareCreate` (1982): the path comes from `TaskEntity.taskName` plus `folderNotePath`;
  - `_commitCreate` (2006): ensure each folder level;
  - `prepareQuick` and `createQuick` (2102, 2139): same, plus a new static `TaskDialog._takenNames(app, reserved)`.
- Modify: `platform/mechanisms/task-entity/task-entity.js` `composeNote`: it no longer decides the path (returns `frontmatter`, `body`; `path` stays as the legacy flat path, used only by the installer callers in Task 7).
- Create: `platform/test/run-task-folders-create.js`.
- Mirror: `ranch/scripts/task-entity/task-dialog.js`, `task-entity.js`.

**Interfaces:**
- Consumes: Task 1's `taskName`, `folderNotePath`, `TASK_ROOT`.
- Produces:
  - `TaskDialog._takenNames(app, reservedLower?: Set<string>) -> (lowerBasename) => boolean`, built from `app.vault.getMarkdownFiles()` basenames lowercased, plus the reserved set;
  - `TaskDialog._parentFolderFor(app, parentLink) -> { folder: string, title: string } | null`: the parent note resolved by `app.metadataCache.getFirstLinkpathDest(name, '')`, when it is a folder note under `spice/tasks`.

- [ ] **Step 1: Write the failing tests** with a fake `app` (vault files map, `getMarkdownFiles`, `getAbstractFileByPath`, `create`, `createFolder`, `metadataCache.getFirstLinkpathDest`). Run them through `prepareQuick` and `createQuick`:
  - `TF-CREATE-TOP`: title `'Pay Bills'` with nothing taken creates `spice/tasks/Pay Bills/Pay Bills.md`.
  - `TF-CREATE-SUB`: `parent_task: '[[Help Henry]]'` resolving to `spice/tasks/Help Henry/Help Henry.md` creates `spice/tasks/Help Henry/Review PR/Review PR.md` with frontmatter `parent_task: "[[Help Henry]]"`.
  - `TF-CREATE-CLASH-VAULTWIDE`: `spice/wiki/Pay Bills.md` exists, so the result is `spice/tasks/Pay Bills (Nov 10)/Pay Bills (Nov 10).md`, with `moment` pinned to `2026-11-10`.
  - `TF-CREATE-UNDER-FLAT-PARENT`: the parent resolves to flat `spice/tasks/Help Henry.md`, so the result is `spice/tasks/Review PR/Review PR.md` with `parent_task: "[[Help Henry]]"`. Also, `parseNote` of the created page gives `parent_task === 'Help Henry'`.
  - `TF-CREATE-RESERVED`: two quick creates prepared back to back with the same title get distinct names.
- [ ] **Step 2: Run them to see them fail.** `node platform/test/run-task-folders-create.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** `_ensureFolder` is called for each missing level, from the outermost down.
- [ ] **Step 4: Run them to see them pass.** Run the new harness plus `run-task-entity.js`, `run-todo-redesign-writes.js`, `run-task-note-card.js` and `run-todo-dialog.js`. Expected: all pass.
- [ ] **Step 5: Mirror and commit.** `git commit -m "feat(task-entity): create tasks and subtasks as nested folders with vault-unique names"`

### Task 4: Finish, reopen and delete on the folder layout

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js`:
  - `_markDone` (2214);
  - `markDone` (618);
  - `reopen` (2277);
  - `_markDeleted` (2373);
  - `markDeleted` (636);
  - `confirmDelete` (665): the count line;
  - new `confirmComplete(path) -> Promise<boolean>`, on the shared SauceModal, as `confirmDelete` uses.
- Create: `platform/test/run-task-folders-lifecycle.js`.
- Mirror: `ranch/scripts/task-entity/task-dialog.js`.

**Interfaces:**
- Consumes: Task 1's `isFolderNote`, `parentNotePathOf`, `rootFolderOf`, `doneFolderFor`, `taskName`, `taskState`; Task 3's `_takenNames`.
- Produces:
  - `TaskDialog._openDescendants(app, folder) -> TFile[]`: open task notes inside a folder at any depth.
  - `TaskDialog.markDone(path, { completeOpenSubtasks?: boolean }) -> { ok, reason?, path? }`.
    - When open descendants exist and the flag is absent, it calls `confirmComplete` and returns `{ ok: false, reason: 'cancelled' }` on No.
    - The row checkbox and the card's Mark done both reach this.
  - `TaskDialog.reopen(path) -> { ok, path, reason? }`, for flat `_done/` notes, done subtasks in place, and notes inside a `_done/` tree.

- [ ] **Step 1: Write the failing tests** (fake app with `fileManager.renameFile` moving map entries and `processFrontMatter`):
  - `TF-DONE-SUBTASK-STAYS`: finishing `spice/tasks/A/B/B.md` sets `status: done` and leaves the path.
  - `TF-DONE-ROOT-MOVES-TREE`: finishing `spice/tasks/A/A.md` (child `B` done) at `2026-11-10` moves the folder to `spice/tasks/_done/2026/11/A/`, and `B` moves with it.
  - `TF-DONE-OPEN-CHILDREN-ASK`: with an open child, `markDone(path)` with the confirm stub answering No gives `{ ok: false, reason: 'cancelled' }`, and nothing changes. Answering Yes completes the child, then moves the tree.
  - `TF-DONE-RECURRING-STAYS`: a recurring root rolls its due date forward, with no move.
  - `TF-DONE-FLAT-LEGACY`: a flat `spice/tasks/X.md` still moves to `spice/tasks/_done/X.md`, as today.
  - `TF-REOPEN-SUBTASK`: a done `spice/tasks/A/B/B.md` gets status only.
  - `TF-REOPEN-IN-DONE-TREE`: reopening `spice/tasks/_done/2026/11/A/B/B.md` reopens `B` and `A`, and moves `A`'s folder to `spice/tasks/A/`, renamed if `A` is now taken.
  - `TF-DELETE-TREE`: deleting `spice/tasks/A/A.md` moves the whole folder to `spice/tasks/_trash/A/`. The confirm text includes `"and 2 subtasks"`.
  - `TF-DELETE-SUBTASK-LEAVES`: deleting `spice/tasks/A/B/B.md` moves `B`'s folder to `spice/tasks/_trash/B/`, and `parent_task` stays `"[[A]]"`.
- [ ] **Step 2: Run them to see them fail.** `node platform/test/run-task-folders-lifecycle.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** A folder moves with one `app.fileManager.renameFile(folderTFile, newFolderPath)`, so links follow. Ensure `_done/YYYY/MM` exists first. Keep the RenderSafe `mutate` wrapper and the in-flight guard `reopen` already has.
- [ ] **Step 4: Run the tests.** Run the new harness plus every `run-task*.js` and `run-todo*.js`. Expected: all pass.
- [ ] **Step 5: Mirror and commit.** `git commit -m "feat(task-entity): finish, reopen and delete whole task folders"`

### Task 5: Re-parent and rename on edit

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js` `_saveEdit` (2154):
  - when `parent_task` changes on a folder note, move its folder under the new parent's folder (`_parentFolderFor`), or to `spice/tasks/` when cleared;
  - when the title changes, rename the folder and the note to `taskName(newTitle, …)` unless the current name equals the sanitized new title.
- Modify: `TaskDialog._parentCandidates` (1780): include nested open tasks (any depth under `spice/tasks`, not `_done` or `_trash`, `status` open). Exclude the edited task and everything inside its folder, using `rootFolder`/`startsWith`, not the `parentOf` walk.
- Create: `platform/test/run-task-folders-edit.js`.
- Mirror: `ranch/scripts/task-entity/task-dialog.js`.

**Interfaces:**
- Consumes: Tasks 1, 3 and 4.
- Produces: `TaskDialog._moveTaskFolder(app, notePath, targetParentFolder) -> newNotePath` and `TaskDialog._renameTask(app, notePath, newName) -> newNotePath`, both through `fileManager.renameFile` (folder first, then the note inside).

- [ ] **Step 1: Write the failing tests:**
  - `TF-EDIT-REPARENT`: setting parent `[[C]]` on `spice/tasks/A/B/B.md` moves it to `spice/tasks/C/B/B.md`.
  - `TF-EDIT-UNPARENT`: clearing the parent moves it to `spice/tasks/B/B.md`.
  - `TF-EDIT-RENAME`: retitling `B` to `Bee` gives `spice/tasks/A/Bee/Bee.md` and `title: Bee`.
  - `TF-EDIT-RENAME-CLASH`: retitling to a title taken elsewhere gives `Bee (A)`.
  - `TF-EDIT-NO-RENAME`: saving with an unchanged title leaves the path.
  - `TF-PARENT-CANDIDATES`: nested open tasks are listed, while the task itself, its own subtasks, and done and trashed tasks are not.
- [ ] **Step 2: Run them to see them fail.** `node platform/test/run-task-folders-edit.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run the new harness plus `run-todo-dialog.js` and `run-task-entity.js`. Expected: all pass.
- [ ] **Step 5: Mirror and commit.** `git commit -m "feat(task-entity): moving a task under a new parent or renaming it moves its folder"`

### Task 6: The card reads the folder tree

**Files:**
- Modify: `platform/mechanisms/task-entity/task-note-view.js`:
  - `_taskIndex` keys children by `parent_task` from `parseNote`, which is folder-derived after Task 2. No algorithm change; add `parent_path` matching so two tasks with one basename never merge.
  - quick-add passes `parent_task: '[[' + thisBasename + ']]'` (unchanged). Task 3 places it in this folder.
- Modify: `platform/test/run-task-note-card.js`:
  - add `TNC-FOLDER-TREE` (children given as folder-note paths without `parent_task` still nest);
  - add `TNC-FOLDER-SAME-NAME` (two different parents each with a child named `Notes` do not share children).
- Mirror: `ranch/scripts/task-entity/task-note-view.js`.

**Interfaces:**
- Consumes: Task 2's `parseNote(...).parent_path`.

- [ ] **Step 1: Write the failing tests** above.
- [ ] **Step 2: Run them.** `node platform/test/run-task-note-card.js`. Expected: FAIL on `TNC-FOLDER-SAME-NAME`.
- [ ] **Step 3: Implement.** The index keys children by the parent's path when `parent_path` is set, and by basename otherwise.
- [ ] **Step 4: Run them.** Expected: `N/N passed`.
- [ ] **Step 5: Mirror and commit.** `git commit -m "feat(task-entity): the task card builds its subtask tree from folders"`

### Task 7: Installer heals recurse and write folder notes

**Files:**
- Modify: `platform/install.js`:
  - a new installer copy `_taskFolderName(title, ctx)` beside the existing `_sanitizeTitle` copy (≈12746). It is the same rule as `TaskEntity.taskName`.
  - `applyTaskNoteHeal` (≈12786) and the heal at ≈13051 walk `spice/tasks` recursively, skipping `_done` and `_trash` exactly where they skip them today. They treat folder notes as task notes. The old-name rename job only applies to flat notes.
  - the capture and migration writers that create `spice/tasks/<name>.md` (≈11940, 12085, 12320, 12491, 12632) and the recurring-tasks heal (≈11108) write `spice/tasks/<Name>/<Name>.md` via `_taskFolderName`. Their existence checks look at both layouts.
- Create: `platform/test/run-task-folders-installer.js`:
  - `TF-INST-PARITY`: a table of 12 `(title, ctx, taken)` cases, including all of Task 1's, run through both `TaskEntity.taskName` and the installer's `_taskFolderName`, gives identical results;
  - `TF-INST-RECURSE`: the task-note heal on a fixture with `spice/tasks/A/B/B.md` missing its chrome injects the chrome;
  - `TF-INST-CAPTURE-FOLDER`: a daily capture migration writes `spice/tasks/<Name>/<Name>.md`.
- Modify: `platform/test/preflight-manifest.json`.

**Interfaces:**
- Consumes: Task 1's rule (copied, held equal by the parity test).
- Produces: `_taskFolderName(title, ctx)` in install.js, for Task 8.

- [ ] **Step 1: Write the failing tests** (the installer exports are reached the way existing installer harnesses reach them; see `run-task-entity-heal*.js` or `grep -l "applyTaskNoteHeal" platform/test`).
- [ ] **Step 2: Run them to see them fail.** `node platform/test/run-task-folders-installer.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run the new harness plus every existing harness that names one of the touched heals (`grep -l` their names under `platform/test`). Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(install): task heals walk nested task folders and write new tasks as folders"`

### Task 8: Migration planner and dry-run report

**Files:**
- Modify: `platform/install.js`:
  - `planTaskFolders(notes, allMdPaths) -> plan`, pure. `notes` is `[{ path, fm, body }]`, every `type: task` note under `spice/tasks` at any depth.
  - `renderTaskFoldersReport(plan, dateStr) -> string`, pure markdown.
  - `applyTaskFoldersHeal(tp, history, git)`, ungated, wired into the install sequence after the task heals. It reads notes and writes the report to `ranch/reports/task-folders-YYYY-MM-DD.md` only when the plan has moves. It never moves a note.
- Modify: `platform/test/seed-vault/` with a fixture vault holding:
  - a name clash with a wiki note;
  - a live and a done "Pay Bills";
  - a missing parent;
  - an ambiguous parent;
  - a parent loop;
  - a done parent with an open child;
  - a done parent with a trashed child;
  - a trashed parent with a done child;
  - a nested done subtask;
  - a note linking to tasks in body and frontmatter;
  - a Dataview query naming `spice/tasks/_done`.

  Follow `Docs/agent-guides/migration-regression-net.md`.
- Create: `platform/test/run-task-folders-plan.js`.

**Interfaces:**
- Consumes: Task 7's `_taskFolderName`.
- Produces a plan object, which is also embedded in the report as a fenced ```json block that Task 9 reads:
  - `moves: [{ from, to, name, reason }]`;
  - `renames: [{ from, to, why }]`;
  - `parentPicks: [{ child, picked, candidates }]`;
  - `promoted: [{ path, formerParent }]`;
  - `ambiguousLinks: [{ in, link, resolvesTo }]`;
  - `queryRefs: [{ in, text }]`;
  - `unresolved: [{ path, why }]`.

- [ ] **Step 1: Write the failing tests** against the fixture:
  - `TF-PLAN-TREE`: each open subtask lands in its parent's folder.
  - `TF-PLAN-DONE-ROOT`: a done root lands under `_done/<completed YYYY/MM>/` with its done children inside.
  - `TF-PLAN-NAMES`: the oldest "Pay Bills" keeps the plain name and the other gets `(Mon D)`. A task clashing with the wiki note gets `(Mon D)`, with the reason naming the wiki path.
  - `TF-PLAN-AMBIGUOUS-PARENT`: the pick follows same place, then created before, then newest, and is listed in `parentPicks`.
  - `TF-PLAN-MISSING-PARENT`: the task is top-level and listed in `unresolved`.
  - `TF-PLAN-LOOP`: the loop breaks at the oldest task, which becomes top-level, and is listed.
  - `TF-PLAN-PROMOTE`: the open child of a done parent is top-level in `spice/tasks/` and listed in `promoted`.
  - `TF-PLAN-TRASH`: a trashed child of a done parent goes to `_trash/<Name>/` alone; a trashed parent takes its done child.
  - `TF-PLAN-QUERY-REF`: the Dataview path is in `queryRefs`.
  - `TF-PLAN-IDEMPOTENT`: planning an already-migrated fixture gives zero moves.
  - `TF-REPORT`: the report contains every move as `from → to`, the json block, and an `Apply` dataviewjs block calling `TaskFolders`.
  - `TF-HEAL-NO-MOVE`: running `applyTaskFoldersHeal` on the fixture leaves every task path unchanged and writes one report.
- [ ] **Step 2: Run them to see them fail.** `node platform/test/run-task-folders-plan.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run the new harness plus `node platform/test/run-seed-migrations.js` (or the seed harness the guide names). Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(install): plan the task folder migration and write a dry-run report"`

### Task 9: TaskFolders, applying the plan inside Obsidian

**Files:**
- Create: `platform/mechanisms/task-entity/task-folders.js`, a bare class `TaskFolders`.
- Modify: `platform/mechanisms/task-entity/manifest.json`: ship `task-folders.js` to `{{scripts_path}}/task-entity/task-folders.js`.
- Create: `platform/test/run-task-folders-apply.js`.
- Mirror: `ranch/scripts/task-entity/task-folders.js`.

**Interfaces:**
- Consumes: Task 8's report json.
- Produces:
  - `TaskFolders.render(dv)`, which draws on the report note:
    - a summary: N moves, N renames, N picks, N promoted, N unresolved;
    - an **Apply** button (disabled while running);
    - after a run, the result.
  - `TaskFolders.apply(app, plan) -> { moved, skipped, failed: [{ from, why }] }`, which:
    1. rewrites each `ambiguousLinks` entry in its note to `[[<resolvesTo without .md>|<alias or old text>]]` through `app.vault.process`;
    2. creates target folders outermost first;
    3. moves each note with `app.fileManager.renameFile`, parents before children, skipping any `from` that no longer exists or whose `to` already exists;
    4. sets `parent_task` to the new parent's name through `processFrontMatter`;
    5. removes emptied source folders;
    6. appends a `## Applied <ISO>` section with the result to the report.
  - Re-running applies nothing and says "Already applied."

- [ ] **Step 1: Write the failing tests** with a fake app that records `renameFile`, `process` and `createFolder` calls:
  - `TF-APPLY-ORDER`: folders are created before moves, and a parent moves before its child.
  - `TF-APPLY-AMBIGUOUS-FIRST`: the ambiguous link is rewritten before any `renameFile`.
  - `TF-APPLY-RENAMEFILE`: every move goes through `fileManager.renameFile` (none through the adapter).
  - `TF-APPLY-SKIP`: a vanished `from` is skipped and reported, not failed.
  - `TF-APPLY-IDEMPOTENT`: a second run returns zero moved and the report says "Already applied."
  - `TF-APPLY-RENDER`: the summary counts match the plan.
- [ ] **Step 2: Run them to see them fail.** `node platform/test/run-task-folders-apply.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run the new harness plus `run-customjs-loadable.js` (expected: CJS-LOAD and CJS-REF both ok, now counting `TaskFolders`).
- [ ] **Step 5: Mirror and commit.** `git commit -m "feat(task-entity): apply the task folder migration from its report inside Obsidian"`

### Task 11 (added by Will, 2026-11-11): subtasks list only on their day, marked as subtasks

Will: "editing a task, and making it a subtask of another task … still keeps that task … a root to-do item that gets listed on the daily to do note. that shouldn't be the case, it should be forever a subtask. a subtask should be able to have a due date on it … and it should be listed on the daily to do note when the filter is on for the day it is due, with an indicator to show that it's a sub task."

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-daily-filter-view.js`. A subtask is any task whose `parseNote` gives a non-empty `parent_task`.
  - Subtasks never appear in the undated tabs: All open, Backlog, No date, and the recurring and done lists.
  - In the date tabs (Today, This week, Overdue, and a day picked in the week strip), a subtask appears only when it has its own `due` that falls in that view.
  - Week-strip counts follow the same rule.
  - Tab counts follow the same rule.
  - This applies to every surface the view draws (daily, all, recurring, project, trip, meeting). Subtasks live on their parent's card.
- Modify: `platform/mechanisms/task-entity/task-today-list.js`, `renderTaskRow`. When the task has a parent and `options.showParent !== false`, draw a muted `↳ <Parent>` chip before the title. It ellipsizes at about 22 characters, and clicking it opens the parent note. The task card's own subtask rows pass `showParent: false`, since they sit under their parent already.
- Modify: `platform/mechanisms/task-entity/task-note-view.js`: pass `showParent: false` to its subtask rows.
- Create: `platform/test/run-todo-subtask-rows.js`.
- Mirror: `ranch/scripts/...` for every changed file.

- [ ] **Step 1: Write the failing tests:**
  - `ST-HIDDEN-UNDATED`: an undated subtask is in no tab.
  - `ST-HIDDEN-ALL`: a dated subtask is not in All open, Backlog or No date.
  - `ST-TODAY`: a subtask due today is in Today.
  - `ST-DAY`: a subtask due Thursday is in the Thursday strip day and counted in that cell, but not in Today.
  - `ST-OVERDUE`: a subtask past its due is in Overdue.
  - `ST-REPARENTED`: a task given a parent drops out of All open.
  - `ST-INDICATOR`: its row shows `↳ Help Henry` and the click opens the parent.
  - `ST-CARD-NO-INDICATOR`: the card's subtask rows have no `↳` chip.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new harness plus every `run-todo*.js`, `run-task-*.js` and `run-daily-dashboard.js`.**
- [ ] **Step 5: Commit** as `feat(to-do): subtasks list only on the day they're due, marked as subtasks`.

### Task 10: Docs, full preflight, release, dry run in the vaults

**Files:**
- Modify: `platform/mechanisms/task-entity/README.md`, giving the folder layout, the naming rule, status-is-truth and the migration.
- Modify: `Docs/agent-guides/` entry that describes tasks, if there is one (`grep -l "spice/tasks" Docs/agent-guides`). Add a short "Task folders" section pointing at the spec.

- [ ] **Step 1: Update docs.**
- [ ] **Step 2: Run** `npm run release:preflight`. Expected: `PASS — preflight (N/N)`. A lone `finance-modal-adoption` failure is the known flake; re-run it alone to confirm.
- [ ] **Step 3: Commit, open the PR, wait for CI, merge.** Merge with `gh pr merge N --squash --delete-branch` once green and no release PR is in flight. Wait for the tap.
- [ ] **Step 4: Deploy to the three vaults** (`sauce update --bump-pins`). Confirm each vault now has `ranch/reports/task-folders-<date>.md`, and that no task moved (task count by path unchanged).
- [ ] **Step 5: Bring Will the three reports.** Give the move counts, the renames with reasons, the parent picks, the promoted tasks and the unresolved items. Apply only when Will says go, then check on the phone that the moved notes arrive.
