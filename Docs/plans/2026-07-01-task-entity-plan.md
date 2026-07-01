# Task-entity Phase 1 (daily to-do) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-markdown daily tasks with note-per-task (`spice/tasks/*.md`) rendered by a live-query widget and edited/deleted through one dialog, killing the mobile whole-note-rewrite wipe — daily surface only, non-destructive migration.

**Architecture:** A new cross-cutting `task-entity` mechanism owns a Node-testable pure core (`TaskEntity`), the create/edit/delete overlay (`TaskDialog`), and the daily live-query widget (`TaskTodayList`). Every dialog gesture writes exactly ONE task file; no surface stores a task list. The to-do blueprint subscribes and swaps the daily template + `+New Task` button onto the mechanism; a version-gated, backup-first, idempotent install migration reshapes existing open daily/carryover lines into task-notes.

**Tech Stack:** CustomJS (bare classes, no trailing statements), Dataview live queries, Sauce installer heals (`install.js` + `install-migrations` gate), `render-safe`, seed-vault regression harness, Node test scripts.

**Reference files to copy patterns from (executors: READ these first):**
- Mechanism manifest + class: `platform/mechanisms/render-safe/` and `platform/mechanisms/task-interactions/`
- Existing dialog to evolve: `platform/blueprints/to-do/helpers/todo-create-task.js`
- Existing daily widget to replace: `platform/blueprints/to-do/helpers/today-capture-editable-list.js`
- Task parsing (reuse in migration): `platform/blueprints/to-do/helpers/task-parser.js`
- Daily template: `platform/blueprints/to-do/templates/Today To-Do.md`
- to-do manifest (subscriptions/helpers/claude_surface): `platform/blueprints/to-do/manifest.json`
- Migration gate: `grep -n "_migrationGated\|priorVersion\|introduced" platform/install.js`
- Seed harness: `platform/test/run-seed-migrations.js` + `platform/test/seed-vault/`
- Schema registry: `platform/schemas-index.json` + `npm run lint-schemas`
- customJS load gate: `platform/test/run-customjs-loadable.js`

---

## Task 1: `task-entity` mechanism scaffold

**Files:**
- Create: `platform/mechanisms/task-entity/manifest.json`
- Create: `platform/mechanisms/task-entity/README.md`
- Create: `platform/mechanisms/task-entity/task-entity.js` (stub — real logic Task 2)

- [ ] **Step 1:** Read `platform/mechanisms/render-safe/manifest.json` + `platform/mechanisms/task-interactions/manifest.json` to learn the mechanism-manifest shape (name, version `0.1.0`, `claude_surface`, `files[]`/`helpers[]` mapping class→dest, deps).
- [ ] **Step 2:** Write `manifest.json`: `name: "task-entity"`, `version: "0.1.0"`, deps on `render-safe`, files mapping `task-entity.js`, `task-dialog.js`, `task-today-list.js` into the consumer's `ranch/` customjs helper dir (match how render-safe/task-interactions map their `.js`). README states purpose + the four safety guarantees.
- [ ] **Step 3:** Stub `task-entity.js` as a bare class `class TaskEntity { }` (no trailing statements) so the CJS-LOAD gate is green from the start.
- [ ] **Step 4:** Run `node --check platform/mechanisms/task-entity/task-entity.js` → expect no output (valid).
- [ ] **Step 5:** Commit: `git add platform/mechanisms/task-entity && git commit -m "feat(task-entity): mechanism scaffold + manifest"`

---

## Task 2: `TaskEntity` pure core (TDD)

**Files:**
- Modify: `platform/mechanisms/task-entity/task-entity.js`
- Create: `platform/test/run-task-entity.js`
- Wire: add `run-task-entity.js` to the preflight test list (find it: `grep -rn "run-customjs-loadable\|run-helper-cases" package.json platform/test/*.js`)

- [ ] **Step 1 — Write failing tests** in `run-task-entity.js` (plain Node asserts, mirror `platform/test/run-helper-cases.js` harness style — load the class via `new Function(src + "\nreturn TaskEntity;")()` per `lesson_customjs_no_trailing_statements`). Cases:
  - `taskFilename({title:"Buy milk"}, fixedMoment)` → matches `/^task-\d{8}-\d{6}-[0-9a-f]{4}\.md$/`, and two calls same second **differ** (hex derived from title+seq, not random).
  - `composeNote({title:"Call X", scheduled:"2026-07-01", project:{name:"Sauce",slug:"sauce"}, source:"daily"})` → frontmatter has `type: task`, `status: open`, `scheduled: 2026-07-01`, `project: "[[Sauce]]"`, `project_slug: sauce`, `source: daily`, a `created_at`, empty `due`/`completed_at`.
  - `composeNote({title:"x"})` with no scheduled → `scheduled` blank (unscheduled), still valid.
  - `parseNote(page)` coerces a page with missing `status` → `open`; blank `scheduled` → `null`.
  - `queryToday([{scheduled:"2026-07-01",status:"open"},{scheduled:"2026-06-30",status:"open"},{scheduled:"2026-07-02",status:"open"},{scheduled:"2026-07-01",status:"done"}], "2026-07-01")` → `today` has the open 07-01 only, `overdue` has the 06-30 only (future + done excluded).
  - `validatePayload({title:""})` → `{valid:false}`; `validatePayload({title:"ok"})` → `{valid:true}`.
- [ ] **Step 2:** Run `node platform/test/run-task-entity.js` → expect FAIL (methods undefined).
- [ ] **Step 3 — Implement** the statics on `TaskEntity` (bare class; instance delegators for any cross-class call, mirroring `ToDoCreateTask`):
  - `taskFilename(payload, moment)`: `task-<YYYYMMDD>-<HHmmss>-<hex4>`; `hex4 = _hash(title + '|' + HHmmss)` (a tiny deterministic non-crypto hash → 4 hex chars). Node-safe (no `Math.random`).
  - `composeNote(payload)`: returns `{ path: "spice/tasks/"+filename, frontmatter, body:"" }`; frontmatter keys exactly as the design schema; blanks emitted as empty (not omitted) for `due`/`completed_at`/`scheduled` when absent, so edits are simple.
  - `parseNote(page)`: normalize a Dataview page → `{title,status,scheduled,due,priority,project,project_slug,source,source_note,created_at,completed_at,path}`; coerce missing `status`→`open`, blank dates→`null`.
  - `queryToday(tasks, todayStr)`: `open` only; `today = scheduled===todayStr`; `overdue = scheduled && scheduled<todayStr`; ignore future + unscheduled.
  - `validatePayload(payload)`: `title` non-empty required; `scheduled`/`due` if present must match `YYYY-MM-DD`.
- [ ] **Step 4:** Run `node platform/test/run-task-entity.js` → expect PASS. Then `node --check` the file.
- [ ] **Step 5:** Add `run-task-entity.js` to preflight; run the customjs-load gate `node platform/test/run-customjs-loadable.js` → expect the new class counted, 0 fail.
- [ ] **Step 6:** Commit: `git commit -am "feat(task-entity): TaskEntity pure core + Node tests"`

---

## Task 3: register the `task` schema

**Files:**
- Modify: `platform/schemas-index.json`

- [ ] **Step 1:** Read the `project-todo` + `to-do-recurring` entries in `platform/schemas-index.json` to copy the contract shape.
- [ ] **Step 2:** Add a `task` contract: owner `task-entity` (mechanism), `type: contract`, frontmatter branch on `type: task`, `path_glob: "spice/tasks/**"`, required keys `type,title,status`, documented optional `scheduled,due,priority,project,project_slug,source,source_note,created_at,completed_at`.
- [ ] **Step 3:** Run `npm run lint-schemas` → expect PASS.
- [ ] **Step 4:** Commit: `git commit -am "feat(task-entity): register task frontmatter schema"`

---

## Task 4: `TaskDialog` — the only create/edit/delete UI

**Files:**
- Create: `platform/mechanisms/task-entity/task-dialog.js`
- Test: extend `platform/test/run-task-entity.js` for the pure helpers; the DOM overlay is dogfood-verified.

- [ ] **Step 1:** Read `todo-create-task.js` `open(opts)` (lines ~166–470) to reuse the `document.body.createDiv` overlay scaffold, chip rows, and footer. Read its `editExisting` hydrate path.
- [ ] **Step 2 — Write failing tests** (pure helpers on `TaskDialog`, Node-loadable): 
  - `TaskDialog.defaultsForSurface({surface:"daily", today:"2026-07-01"})` → `{scheduled:"2026-07-01"}`.
  - `TaskDialog.defaultsForSurface({surface:"project", project:{name:"Sauce",slug:"sauce"}})` → `{project:{name:"Sauce",slug:"sauce"}}` (no scheduled).
  - `TaskDialog.trashPath("spice/tasks/task-….md")` → `"spice/tasks/_trash/task-….md"`.
- [ ] **Step 3:** Run tests → FAIL.
- [ ] **Step 4 — Implement** `class TaskDialog` (bare class, no trailing statements; instance delegators). Statics (Node-testable): `defaultsForSurface`, `trashPath`, `donePath` (→ `_done/`). Instance/browser methods:
  - `open({ edit?, surface?, today?, project?, sourceNote? })` — builds the overlay; **create** mode uses `defaultsForSurface`; **edit** mode hydrates from `app.vault.read(editFile)` + frontmatter.
  - **Writes — each touches exactly ONE file:**
    - create → `const {path,frontmatter,body}=TaskEntity.composeNote(payload); await app.vault.create(path, TaskDialog._render(frontmatter,body));`
    - save(edit) → `await app.vault.process(taskFile, ()=> updated)` on the task's own file.
    - done → flip `status:done` + `completed_at`, then move file to `_done/` via `app.fileManager.renameFile` (single-file rename).
    - delete → `app.fileManager.renameFile(taskFile, TaskDialog.trashPath(path))` + set `status:deleted` (single-file rename).
  - After any write: `new Notice(...)`, close overlay, let Dataview re-render the daily (no surface-note write anywhere).
- [ ] **Step 5:** Run tests → PASS. `node --check` + `node platform/test/run-customjs-loadable.js` (0 fail, TaskDialog counted).
- [ ] **Step 6:** Commit: `git commit -am "feat(task-entity): TaskDialog (create/edit/done/delete, one-file writes)"`

---

## Task 5: `TaskTodayList` — daily live-query widget

**Files:**
- Create: `platform/mechanisms/task-entity/task-today-list.js`

- [ ] **Step 1:** Read `today-capture-editable-list.js` render structure + `render-safe.js` for the cold-load guard (`window.customJS?.RenderSafe.page(dv)`).
- [ ] **Step 2 — Write failing test:** `TaskTodayList.buildBands(pages, today)` (delegates to `TaskEntity.queryToday`) returns `{today:[…], overdue:[…]}` given Dataview-shaped pages. Add to `run-task-entity.js`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4 — Implement** `class TaskTodayList` (bare class). `render(dv)`:
  - Guard cold-load via `render-safe`.
  - `const pages = dv.pages('"spice/tasks"').where(p => p.type==="task" && p.status==="open").map(TaskEntity.parseNote)`.
  - `const {today, overdue} = TaskEntity.queryToday(pages, window.moment().format("YYYY-MM-DD"))`.
  - Render an **Overdue/Carryover** band (if any) then a **Today** band. Each row: functional done-checkbox (`change` → `TaskDialog` done-write on that one file), title, project/priority/due chips, click row → `TaskDialog.open({edit:p.path})`. A `+ New Task` button → `TaskDialog.open({surface:"daily", today})`.
- [ ] **Step 5:** Run tests → PASS. `node --check` + customjs-load gate 0 fail.
- [ ] **Step 6:** Commit: `git commit -am "feat(task-entity): TaskTodayList daily live-query widget"`

---

## Task 6: wire the to-do blueprint onto `task-entity`

**Files:**
- Modify: `platform/blueprints/to-do/manifest.json` (subscribe to `task-entity`; ship the 3 helpers to `ranch/`)
- Modify: `platform/blueprints/to-do/templates/Today To-Do.md` (render `TaskTodayList`; drop `TodayCaptureEditableList` + `ToDoDailyCarryover` blocks)
- Modify: `platform/blueprints/to-do/helpers/todo-leaf-actions.js` (`+New Task` → `TaskDialog.open`)
- Check: `platform/bootstrap-lib/wizard.js` DEFAULT_MECHANISMS_CHECKED (add `task-entity` if to-do is default — per `lesson_wizard_default_mechs_lags_catalogue`)

- [ ] **Step 1:** Read the to-do manifest deps + how it lists customjs helpers; add a `task-entity` subscription and ensure the 3 mechanism classes materialize into the consumer.
- [ ] **Step 2:** Edit `Today To-Do.md`: replace the `TodayCaptureEditableList` + `ToDoDailyCarryover` + their `SectionLabel`s with a single `TaskTodayList` block. Keep `SpaceNavButtons`/`Breadcrumb`/`ToDoLeafActions`/recurring/project-groups/unassigned blocks. (These stay until phases 2–4.)
- [ ] **Step 3:** Point `ToDoLeafActions` `+New Task` at `TaskDialog.open({surface:"daily", today})` instead of `ToDoCreateTask.open`.
- [ ] **Step 4:** Add `task-entity` to `DEFAULT_MECHANISMS_CHECKED` if to-do is a default blueprint (verify via wizard.js).
- [ ] **Step 5:** Run `node platform/test/run-customjs-loadable.js` + any manifest/contract gate (`grep -rn "run-manifest\|run-catalogue" package.json`) → expect green.
- [ ] **Step 6:** Commit: `git commit -am "feat(to-do): render TaskTodayList + route +New Task to TaskDialog (daily)"`

---

## Task 7: migration `applyDailyTasksToEntityMigration` (gated, backup-first, idempotent) + seed proof

**Files:**
- Modify: `platform/install.js` (new heal + call-site; version-gate it)
- Modify/Create: seed fixtures under `platform/test/seed-vault/` + assertions in `platform/test/run-seed-migrations.js`

- [ ] **Step 1:** Read the migration gate: `grep -n "_migrationGated\|priorVersion\|introduced_in" platform/install.js`; find where daily-related heals are called and how `.sauce-backup` is written elsewhere (`grep -n "sauce-backup" platform/install.js`).
- [ ] **Step 2 — Write failing seed assertions** in `run-seed-migrations.js`: add a seed daily fixture with open lines under `TODAY_CAPTURE_MARKER` (one with `[due:: 2026-06-30] [project:: [[Sauce]]] [priority:: high]`) and a Carryover open line, plus a `- [x]` done line. Assert after install: (a) a `spice/tasks/task-*.md` exists per OPEN line with correct `scheduled`/`project`/`priority`; (b) `<daily>.sauce-backup` exists; (c) the `- [x]` line is untouched; (d) re-running install creates **no duplicate** task-notes (idempotent).
- [ ] **Step 3:** Run `node platform/test/run-seed-migrations.js` → expect FAIL.
- [ ] **Step 4 — Implement** `applyDailyTasksToEntityMigration(ctx)` in `install.js`:
  - Gate it as a one-time reshaper (`migration_kind: "once"`, `introduced_in` = this cycle's about-to-ship workshop version — set LOW-but-correct; follow how the gate reads `introduced_in`).
  - For each daily note: read; find open (`- [ ]`) lines under `TODAY_CAPTURE_MARKER` + Carryover (reuse `TaskParser.parseTaskLine`); **write `.sauce-backup` first**; for each open line without a `migrated_to::` marker, create a `spice/tasks/…​.md` via the same compose logic as `TaskEntity.composeNote` (share the helper — do NOT duplicate), `scheduled = line.due || daily's date`; then remove the migrated lines (or annotate `migrated_to::`), leaving `- [x]` + everything else intact. Per-note sentinel `<!-- tasks-migrated -->` → skip on re-run.
  - Idempotent + fail-safe (any parse uncertainty → skip that line, leave it as markdown; never drop silently).
- [ ] **Step 5:** Run `node platform/test/run-seed-migrations.js` → expect PASS (all four assertions).
- [ ] **Step 6:** Commit: `git commit -am "feat(task-entity): gated backup-first daily→task-note migration + seed proof"`

---

## Task 8: whole-suite green + dogfood self-install

- [ ] **Step 1:** Run the full preflight: `npm run release:preflight` (or the repo's preflight entry — `grep -n "preflight" package.json`) → expect PASS.
- [ ] **Step 2:** Run `release:preflight-bumped` if present → PASS (keeps version assertions snapshot-clean; do NOT hand-edit version literals — pipeline owns them).
- [ ] **Step 3:** Dogfood self-install against the workshop vault and confirm exit 0 + `sauce status` drift sane; confirm a fresh `spice/tasks/` renders and a `+New Task` in a scratch daily writes one file. (`grep -n "self-install\|dogfood" package.json Docs/agent-guides/build-test-verify.md`.)
- [ ] **Step 4:** `lint-schemas` + `run-customjs-loadable` + `run-task-entity` + `run-seed-migrations` all green (final gate sweep).
- [ ] **Step 5:** Commit any dogfood runtime-artifact refresh as its OWN commit (per `vault-paths.md` — never mix into feature commits).
- [ ] **Step 6:** Push branch, open PR (`feat/task-entity-daily` → `main`), wait for CI green. **Do NOT hand-merge the release PR or tag** — merge the FEATURE PR to `main` once CI is green; the auto-pipeline bumps/tags/ships to brew.

---

## Post-merge (outside the plan's TDD loop — orchestrator does this)

1. Merge feature PR → main once CI green. Nurse the auto-release PR only if it wedges BEHIND (`gh pr update-branch <release-pr>`; never admin-merge the release PR).
2. Once brew ships (workshop version bumped + tag live), deploy consumers: per vault `sauce update --bump-pins` → `sauce status` (drift:none, git head == workshop HEAD). ERO must stay brew-only.
3. **Self-verify migrations** on each of ero/accuris/headspace: task-notes materialized == open daily lines (count reconciliation), `.sauce-backup` present, no open task lost. Only then hand back to the user for Cmd+R + human verify.

## Spec coverage self-review

- D1 note-per-task → Tasks 2,4,5,7. D2 scheduled+carryover → `TaskEntity.queryToday` (Task 2) + `TaskTodayList` bands (Task 5). D3 recoverable delete → `TaskDialog` trash (Task 4). D4 daily-first mechanism → Tasks 1,6; phases 2–4 explicitly deferred.
- Dialog-everywhere/no-markdown → Tasks 4,6 (daily surface); one-file-write safety → Tasks 4,5,7.
- Migration non-destructive/gated/idempotent/seed-proven → Task 7. Whole-suite + dogfood + deploy + self-verify → Task 8 + Post-merge.
- customJS load safety → bare classes enforced in Tasks 1,2,4,5 + gate in each. Schema → Task 3.
