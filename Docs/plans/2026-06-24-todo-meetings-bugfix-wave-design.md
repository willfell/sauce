# Design — to-do + meetings bug-fix wave (post-v0.131.0)

- **Date:** 2026-06-24
- **Version:** assigned by the release pipeline at cycle close (do NOT hand-pick). Fix-only commits across `to-do`, `task-interactions`, `daily`, `meetings` → per-component patch bumps + umbrella bump.
- **Reported via:** `/remote-control fix-shit-1` — six issues observed on the `accuris-sauce` consumer vault.
- **Decisions (user, 2026-06-24):** ship to **all three** consumers (accuris + ero + headspace); **new-notes-only** for the misplaced-task (#3) and divider (#5) fixes (no heal migration); run the **full cycle** (spec → plan → implement → test → ship) with check-ins at the spec gate and before the irreversible release.

## Context

Recent waves (v0.124.x note-chrome, v0.127.0 task-interactions / click-to-edit) reshaped the
to-do daily note and meeting note from `## H2` headings to `SectionLabel` dataviewjs blocks +
stable HTML-comment markers (`<!-- TODAY_CAPTURE_MARKER -->`, `<!-- ACTION_ITEMS_MARKER -->`).
Several consumers of those notes still read the OLD shape, and the `+New Task` dialog's
file-creation + insert paths predate the marker contract. The six issues below are all
fallout from that transition. None require a stored-state migration; all are code/template
fixes that compose.

## Issues, root causes, fixes

### #1 — Meeting shows a false "Notes" badge on the daily note

**Root cause.** `daily/helpers/space-daily-dashboard.js :: _enrichMeeting` (≈L1127) first tries a
`## Notes` heading regex (the template no longer ships one — it uses a `SectionLabel("Notes")`
dataviewjs block), then falls back (≈L1137) to: strip frontmatter + fenced code blocks + task
lines + headings, and treat any remaining non-whitespace > 20 chars as "has notes." On a blank
meeting the leftover `<!-- ACTION_ITEMS_MARKER -->` comment + two `---` rules + the lone agenda
`-` total ~33 chars → **always true**. `meetings/helpers/meetings-hub-cards.js` (L63-64) has the
mirror bug: it *only* checks `## Notes`, so it **never** shows the badge.

**Fix.** Replace the body-content heuristic with a scaffold-aware one that works on existing AND
new meetings (no new marker, no migration). Strip, in order: frontmatter; fenced code blocks;
HTML comments (`<!--...-->`); horizontal rules (`^\s*---+\s*$`); heading lines; task lines
(`^\s*[-*+] \[[ xX]\]` — generalized per #4); and lone/empty list bullets (`^\s*[-*+]\s*$`).
If > 5 non-whitespace chars remain → `hasNotes = true`. Retain a legacy `## Notes`-heading
fast-path (older migrated notes). Apply the SAME helper to both `_enrichMeeting` and
`meetings-hub-cards.js` so the two surfaces agree. Heuristic deliberately keys on stable scaffold
shape, NOT on the `"Notes"` SectionLabel text label (code-conventions § "Stable anchors vs
display markers"; `lint-display-markers.js`).

> Note: this counts ANY real user content (agenda bullets, notes prose) as "content present",
> matching the existing fallback's intent. Scoping strictly to the Notes region would require a
> new `<!-- NOTES_MARKER -->` anchor, which would not exist on already-created meetings — out of
> scope given the new-notes-only decision and the all-meetings read-time requirement.

### #2 — Auto-created daily to-do note is a blank stub

**Root cause.** `to-do/helpers/todo-create-task.js :: _initialBodyFor` (L651-694) returns a minimal
body (`## Today's Capture` + frontmatter) when the destination daily note does not yet exist. This
is the only create path for `+New Task` when today's note is absent (Templater folder-templates do
NOT fire on programmatic `vault.create`). The stub has no Breadcrumb, no `ToDoLeafActions`, no
`TodayCaptureEditableList`, and **no `ToDoDailyCarryover` block** — so the note is inert.

**Fix.** For the `today` destination, `_initialBodyFor` emits the FULL daily scaffold:
1. **Primary:** read the materialized template `ranch/templates/Today To-Do.md` via `app.vault`,
   substitute the Templater token `<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>` with the
   current timestamp (`window.moment().format("YYYY-MM-DDTHH:mm:ssZ")`). This inherits the correct
   `{{vault_identity_tag}}` (already substituted at install) and the live block list — zero drift.
2. **Fallback:** if the read fails or the content doesn't look like a to-do template, emit a
   hardcoded full block list (Breadcrumb / SpaceNavButtons / `---` / ToDoLeafActions / `---` /
   SectionLabel("Today", top) / `<!-- TODAY_CAPTURE_MARKER -->` / TodayCaptureEditableList /
   Carryover / Recurring / ProjectGroups / UnassignedMeetings), with `created_at` filled and the
   vault tag resolved from a sibling daily note's frontmatter when available (else omitted).

Project-todo + recurring destinations keep their current minimal bodies (their own templates own
the chrome; not in scope).

### #3 — Dialog-created tasks are not editable (even on a correct note)

**Root cause.** `TodayCaptureEditableList` scopes its rows to tasks BELOW `<!-- TODAY_CAPTURE_MARKER -->`
via `TaskInteractions.findTaskLines(content, 'todayCapture')`. But the `+New Task` dialog's own
inserter, `todo-create-task.js :: _insertLineUnderSection` (L593-640), anchors on the
`SectionLabel("Today")` dataviewjs block — which sits ABOVE the marker — so the task lands in the
gap before the marker, outside the editable scan window (confirmed: live `ToDo-2026-06-24.md` has
`- [ ] test task` on the line above the marker). Meeting→task creation uses
`TaskInteractions.appendTask` (L360-378), which correctly inserts AFTER the marker — hence the
divergence.

**Fix.** For the `today` destination, `_insertLineUnderSection` anchors on the stable
`<!-- TODAY_CAPTURE_MARKER -->` and inserts immediately after it (mirroring
`TaskInteractions.appendTask`'s to-do branch). Order of precedence for the today path:
marker → (inject marker if a SectionLabel("Today") block exists but the marker is missing) →
existing SectionLabel/`## H2` fallback. Project + recurring paths unchanged. New-notes-only:
no migration relocates already-misplaced tasks in existing notes (the live 06-24 `test task`
stays put per the user's decision).

### #4 — Carryover loses hand-authored / nested tasks

**Root cause A (marker).** `to-do/helpers/task-parser.js :: parseTasks` and the inline
`ToDoDailyCarryover._fallbackParse` match top-level tasks with `^- \[ \] ` — **hyphen only.**
Tasks authored with `* [ ] ` or `+ [ ] ` (valid CommonMark) are invisible → never carried, never
stripped. The same hyphen-only assumption lives in `task-interactions.js` (`parseTaskLine` L49,
`findTaskLines` L240, `replaceTaskAt` guard L412) and `today-capture-editable-list.js` (L71).

**Root cause B (data-loss ordering).** `todo-daily-carryover.js :: materialize` strips the prior
file (L76 `vault.modify(priorFile, newPrior)`) and THEN writes today (L77). If the second write
throws, the carried tasks are deleted from the prior note with nowhere to land → silent loss.

**Fix A.** Generalize the unordered-list-marker class to `[-*+]` everywhere a task line is
recognized: `parseTasks` (top-level match, checked-skip match, child-stop boundary),
`_fallbackParse`, `TaskInteractions.parseTaskLine` / `findTaskLines` / `replaceTaskAt` guard, and
`TodayCaptureEditableList`'s checkbox-state regex. Children (indented continuation lines) already
carry verbatim once the parent is recognized — confirmed by reading the child-collection loop.

**Fix B.** Reorder `materialize` to **write today FIRST, strip prior SECOND** (duplicate-over-delete):
compute both new contents in memory, `vault.modify(todayFile, todayWithSentinel)`, and only on its
success `vault.modify(priorFile, newPrior)`. Worst case becomes a recoverable duplicate (task on
both days), never a silent loss. This directly satisfies "never lose a to-do item."

> Recovery note: the originally-lost tasks are NOT recoverable — searched all current
> `spice/to-do/**` notes, `.sauce-backup/`, `backups/`, and `.trash`; no surviving `*`/`+`-bullet
> or unchecked tasks. The fix is forward-looking.

### #5 — Missing `---` around the New Task / Recurring / All button row

**Root cause.** `to-do/templates/Today To-Do.md` places the `ToDoLeafActions` dataviewjs block
(L18-20) with no horizontal rules around it. The Meeting template DOES bracket its button row
(`MeetingLeafActions`) with `---` (Meeting.md L75/L81).

**Fix.** Add a `---` rule line before and after the `ToDoLeafActions` block in `Today To-Do.md`,
matching the Meeting template. Template-only (new-notes-only decision; no heal of existing notes —
avoids the non-idempotent double-divider heal that bit v0.124.1).

### #6 — Transient "Cannot read properties of undefined (reading 'file')" on a new meeting

**Root cause.** `meetings/templates/Meeting.md` (L91) computes `dv.current().file.path` inline to
build the `PeopleRendering` args. On a freshly-created note Dataview has not indexed it yet, so
`dv.current()` is briefly `undefined` → the dereference throws. `customjs-guard`'s loader cannot
help: the crash is in ARG construction, before `dv.view` is ever called.

**Fix.** Make the `PeopleRendering` block in `Meeting.md` a guarded multi-line dataviewjs block:
resolve `notePath` from `dv.current()?.file?.path` with a fallback to
`app.workspace.getActiveFile()?.path`; if neither resolves, render nothing and return (the block
auto-re-renders once Dataview indexes the file). Eliminates the error flash. Template-only.

## Files touched

| File | Issue(s) |
|------|----------|
| `platform/blueprints/daily/helpers/space-daily-dashboard.js` | #1 |
| `platform/blueprints/meetings/helpers/meetings-hub-cards.js` | #1 |
| `platform/blueprints/to-do/helpers/todo-create-task.js` | #2, #3 |
| `platform/blueprints/to-do/helpers/task-parser.js` | #4A |
| `platform/blueprints/to-do/helpers/todo-daily-carryover.js` | #4A, #4B |
| `platform/blueprints/to-do/helpers/today-capture-editable-list.js` | #4A |
| `platform/mechanisms/task-interactions/task-interactions.js` | #4A |
| `platform/blueprints/to-do/templates/Today To-Do.md` | #5 |
| `platform/blueprints/meetings/templates/Meeting.md` | #6 |

Each component's `manifest.json` version is bumped by the **release pipeline** from the conventional
commits — NOT by hand (build-test-verify § Release workflow; landmine #16 sweep retired).

## Testing (TDD; extend existing Node harnesses)

- **task-parser** (`run-helper-cases.js` / dedicated): `* [ ]` and `+ [ ]` top-level tasks parse;
  nested children under a `*` parent carry; `* [x]` checked tasks (and their children) are skipped.
- **task-interactions** (`run-task-interactions.js`): `parseTaskLine` / `findTaskLines` /
  `replaceTaskAt` accept `-`, `*`, `+`; existing hyphen cases stay green.
- **carryover** (`run-helper-cases.js` + behavioral): `eligibleBlocks` finds `*`/`+` tasks;
  behavioral harness with a vault stub asserts today is written before prior is stripped, and that
  a today-write failure leaves the prior file intact (no loss).
- **has-notes** (behavioral, e.g. extend `run-v0109-projects-overhaul.js` or new harness): blank
  SectionLabel-shaped meeting → `hasNotes === false`; meeting with real notes prose → `true`;
  assert both `_enrichMeeting` and the hub helper agree.
- **todo-create-task**: `_initialBodyFor('today')` output contains the marker + the editable-list +
  carryover blocks; `_insertLineUnderSection('today', ...)` places the task AFTER
  `<!-- TODAY_CAPTURE_MARKER -->` (i.e. inside `findTaskLines(_, 'todayCapture')` scope).
- Whole-suite `npm run release:preflight` GREEN; workshop self-install GREEN before any push.

## Rollout

1. Feature branch `cycle/<topic>`; TDD each fix; `npm run release:preflight` + workshop dogfood green.
2. Conventional commits per component (`fix(to-do):`, `fix(task-interactions):`, `fix(daily):`,
   `fix(meetings):`). Preview the computed bump with `npm run release:plan`.
3. PR → CI gate → merge. Release pipeline computes versions, tags, ships to brew.
4. **CHECK-IN before the irreversible release** (annotated tag is a user-approval gate).
5. Deploy to all three consumers: `sauce update --bump-pins` + `Cmd+R` on accuris + ero + headspace.
6. Manual smoke per `Docs/agent-guides/smoke-checklists/` (to-do + meetings) on a deployed vault:
   create a blank meeting (no error flash, no false Notes badge); create a to-do via `+New Task`
   when today's note is absent (full scaffold, task editable, dividers present); author a `* [ ]`
   task on day N, open day N+1 (carries over).
7. Cycle-close artifacts (result / cycle-history / cycle-status / handoff) per build-test-verify.

## Risks / landmines

- **Do not hand-version / tag / sweep pins** — pipeline owns it (CLAUDE.md; landmine #16 retired).
- `_initialBodyFor` template-read path depends on `ranch/templates/Today To-Do.md` existing; the
  hardcoded fallback covers read failure. Keep the fallback block list in lock-step with the template.
- `hasNotes` heuristic must not key on the `"Notes"` display label (`lint-display-markers.js`);
  add `// lint-display-markers:allow` only if a legacy `## Notes` fast-path trips the linter.
- customjs cold-load: all new `customJS.X` access stays optional-chained (landmines #1–#5).
- Marker generalization is additive — verify NO existing hyphen-only assertion regresses.
