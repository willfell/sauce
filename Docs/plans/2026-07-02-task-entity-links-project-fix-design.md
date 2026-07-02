# Task-entity links + project-inheritance fix — design

**Date:** 2026-07-02 · from accuris phone usage on v0.178.x

## BUGS (functionality issues)

- **B1 — Meeting task connected to a project gets a MANGLED project slug.** A meeting with `project: "[[Connectors]]"` creates a task-note with `project: "[[spice/projects/connectors/Connectors.md|Connectors]]"` and `project_slug: spice-projects-connectors-connectors-md-connectors`. Root: `MeetingLeafActions.stripWikilink(cur.project)` returns the full RESOLVED Dataview Link path (not the basename `Connectors`), then `_slugify` on that path yields the mangled slug. The real project's slug is `connectors`, so nothing matches. **Fix:** extract the clean basename (`Connectors`) from the Link → look up the project list → slug `connectors`. Apply the same clean-name logic on the project-surface create path if affected. **+ Heal** existing task-notes whose `project_slug` is a path-mangled value (re-derive clean `project` + `project_slug`).
- **B2 — Existing project To-Do + meeting notes don't render their task-notes.** `TaskProjectList` / `TaskMeetingList` blocks only ship in NEW notes via the template; pre-existing `<Name> To-Do.md` + meeting notes lack them. **Fix:** install heals that inject the `TaskProjectList` block into existing project-todo notes and the `TaskMeetingList` block into existing meeting notes (idempotent, .sauce-backup).
- **B3 — Meeting/project tasks don't appear in the daily.** Caused by B1 (mangled slug → the daily's project grouping never matches). Fixing B1 (+ the mangled-slug heal) restores it; the daily's `ProjectGroups`/`UnassignedMeetings` already read task-notes.
- **B4 — Task links not rendered in daily/list rows.** `renderTaskRow` renders the title via `createEl(..,{text})` (plain text), so `- [Chat](url) - [[Note]]` shows as literal text, not clickable. **Fix:** render the row title as MARKDOWN (MarkdownRenderer) so `[label](url)` + `[[wikilink]]` become clickable. Applies to all list widgets (shared `renderTaskRow`).

## VISUAL EDITS (+ functionality to obtain them)

- **V1 — Task-note chrome layout.** REMOVE the `TaskNoteToDoNav` block. New body, NO blank lines between sections/separators:
  ```
  <SpaceNavButtons dataviewjs>
  ---
  <TaskNoteView dataviewjs>
  ---
  <!-- TASK_NOTES -->
  <freeform notes render here, natively>
  ```
  **Functionality:** update `TaskEntity._chromeBody()` + the install heal's byte-identical `_taskNoteChromeBody()`; the heal detects the v0.178 chrome (contains `TaskNoteToDoNav`) and upgrades it to the new shape, preserving notes below the marker. Remove the `TaskNoteToDoNav` class + manifest registration.
- **V2 / V3 — TaskNoteView links the project AND the meeting/source.** In the info card: show the **project** as a clickable link when the task has a project; show the **source note** (meeting) as a clickable link when `source: meeting`; show **BOTH** when a meeting task is connected to a project. **Functionality:** depends on B1 (correct project inheritance) so a meeting-made project task carries both `project` (clean) + `source_note`. TaskNoteView already renders project + source rows — ensure both appear together and are clickable internal links. The freeform notes (with any `[label](url)` / `[[note]]` links added via the dialog inserters) render natively below the second `---` (clickable) — the link info thus lives inside the note's layout.

## Rollout
One worktree. Two passes: (A) B1/B3/B4 wiring + mangled-slug heal + project/meeting render-block heals + renderTaskRow markdown; (B) V1 chrome + V2/V3 TaskNoteView + remove TaskNoteToDoNav. Seed-test the heals; Playwright the chrome + card; ship → deploy accuris-first → verify → headspace/ero.
