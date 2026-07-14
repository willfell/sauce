# Meetings Blueprint Overhaul — Design

**Date:** 2026-07-13
**Status:** Approved (design)
**Scope:** meetings blueprint (template, helpers, hub architecture), EntityCreate button body, migrators, install heal. One integrated cycle — every change touches the same meeting-note shape, so a single heal pass covers them all.

## Problem

The meetings blueprint has drifted from the vault-wide conventions the other blueprints now follow, and several requested features are missing or broken:

1. **Agenda / Action Items dead weight.** The template still renders "Agenda" and "Action Items" `SectionLabel` sections. Task creation (task-entity) fully supersedes Action Items — the `<!-- ACTION_ITEMS_MARKER -->` marker is dead (no live renderer), and `TaskMeetingList` is the sole live task surface. When a note carries a legacy `- [ ]` line under the marker *and* has migrated tasks, tasks appear twice.
2. **Live template/consumer drift.** The workshop `Meeting.md` already dropped "Agenda", but live consumer notes (e.g. accuris `Sync with Yauhen-2026-07-08.md`) still render it — proving template edits don't propagate without a heal. The EntityCreate `+ New Meeting` button body (`manifest.json` `inline_body`) is *even more* stale: it still emits both Agenda and Action Items.
3. **No way to browse previous meetings.** Each day gets its own hub note (`spice/meetings/hubs/<year>/<month>/Meetings-<date>.md`) — accuris has **98** of them, ero has **3**. `MeetingsHubCards` filters to that hub's own date (`endsWith(`-${date}`)`) and extracts attendees/task-counts by regex-parsing a `## Attendees` markdown heading **that no longer exists** in the current template. There is no aggregating index across meetings.
4. **No date/time prompt.** Creating a meeting silently stamps "now" — no way to backdate or set a specific time.
5. **No Add-Link affordance.** Other note surfaces (sticky notes, wiki, project) expose a pinned-links strip + "＋ Add link" via `SectionExplorer.renderNoteLinks`. Meetings have none.
6. **Chrome nits.** `Meeting Hub.md` ends with a literal `---` (note-chrome.md divider-grammar violation — dividers are helper-owned, never literal).

## Decisions (from clarifying questions)

- **Hub:** one persistent evergreen `Meetings.md` hub with a browsable list of ALL meetings (newest first, grouped by month). Old per-day hubs **archived** to `spice/meetings/hubs/_archive/`.
- **Date/time prompt:** one optional combined field; blank → creation time (today's behavior).
- **Agenda content on existing notes:** fold non-empty Agenda text into the note's Notes section during the heal; drop empty/placeholder Agenda.
- **Creation paths:** unify — EntityCreate button body matches the Templater template's section shape.
- **Browse-list data:** read `attendees`/`people` from frontmatter; task counts from a live `spice/tasks` query by `source_note` (the `TaskMeetingList` mechanism) — never body regex.
- **Links:** zero-body-migration — `MeetingChromeBar.render` calls `SectionExplorer.renderNoteLinks(dv)` for the leaf context (the sticky/wiki/project hook pattern), plus an "Add link…" overflow action. Meetings gain a `links: []` frontmatter field going forward; existing notes get it on first write.

## Section 1 — Leaf template (`Meeting.md`)

Final body shape (Templater header unchanged — the `SUGGESTER_LOOP_V0880` attendee picker stays):

1. `MeetingChromeBar` (now also renders the pinned-links strip + "＋ Add link" for leaf context).
2. `SectionLabel "Attendees" {top:true}` + `PeopleRendering` chips (unchanged).
3. `SectionLabel "Notes"` + `-` seed.
4. `SectionLabel "Tasks"` + `TaskMeetingList`.

Removed: the entire "Agenda" `SectionLabel` + seed, the "Action Items" `SectionLabel`, the `<!-- ACTION_ITEMS_MARKER -->` marker. Frontmatter gains `links: []`.

## Section 2 — Creation paths

- **Templater `Meeting.md`:** as Section 1. Add optional date/time — a `tp.system.prompt` for a datetime; if non-empty and parseable, it drives `date` frontmatter + the filename date; blank → `tp.file.creation_date` (today's behavior). Filename date derives from the chosen datetime.
- **EntityCreate `manifest.json` `inline_body`:** rewrite to byte-match the Section-1 body (drop Agenda + Action Items, no dead marker). Add an optional `datetime` prompt to `new_entity_buttons[0].prompts`; wire `frontmatter_template.date` + the destination `filename_date_pattern`/`folder_date_pattern` to prefer it, falling back to `now`. Add `links: []` to `frontmatter_template`. Retarget `render_in` from the per-day hub to the persistent `Meetings.md`.

## Section 3 — Persistent hub

- **New note `spice/meetings/Meetings.md`** (tag `meetings-hub`, no `type:`), body:
  1. `MeetingChromeBar` (hub context — primary `+ New Meeting`).
  2. `SectionLabel "Meetings"`.
  3. New helper `MeetingsBrowseList` (replaces the date-filtered `MeetingsHubCards`): live-queries all `spice/meetings/notes/**`, sorts by `date` desc, groups by month, renders each as a `BeaconCards` row card — attendees from frontmatter `attendees`/`people`, open-task count from a live `spice/tasks` query by `source_note` basename, notes-flag optional. Doc-search / filter box for scanning history (mirror the wiki/section-explorer search affordance).
- **`nav_buttons` / EntityCreate `render_in`:** point at the single `Meetings.md`; stop minting a new dated hub per click.
- **`MeetingsHubCards`:** retire (superseded by `MeetingsBrowseList`); keep the old per-day archived hubs readable but out of the live flow.
- **Fix** `Meeting Hub.md`'s trailing literal `---` (whether the template survives as the archived-hub shape or is dropped — the persistent hub is a distinct new file).

## Section 4 — Person-note meetings (verified, no change)

`spice/people/<name>.md` already renders `## Meetings` via `PeopleRendering.renderMentionList({mode:"mentioning_person", scopePath:"spice/meetings"}, {style:"cards"})` — **confirmed live** in accuris (`Rupal Chawla.md`). User request #4 is already satisfied; no work.

## Section 5 — Install heal / migration (all vaults)

A backup-first, idempotent, never-throw heal (mirrors `applyMeetingTasksToEntityMigration`'s posture), sentinel `<!-- meeting-chrome-modernized -->`:

**Leaf notes (`spice/meetings/notes/**`):**
- Runs *after* `applyMeetingTasksToEntityMigration` (which already converts `- [ ]` action lines → task notes and stamps `<!-- meeting-tasks-migrated -->`).
- Fold any non-empty "Agenda" section content into the "Notes" section, then remove the Agenda `SectionLabel` fence + its seed.
- Remove the "Action Items" `SectionLabel` fence + dead `<!-- ACTION_ITEMS_MARKER -->` marker.
- Ensure `links:` exists in frontmatter (default `[]`).
- `.sauce-backup` snapshot before write; per-note try/catch; stamp sentinel to skip re-runs.

**Hubs:**
- Create/refresh the persistent `spice/meetings/Meetings.md`.
- Move existing per-day hub notes under `spice/meetings/hubs/**` → `spice/meetings/hubs/_archive/**` (preserve relative path; backup-first; idempotent — skip already-archived).

**Migrators (fresh `sauce migrate --from <legacy>`):**
- `meetings-note.js` `_renderBody`: stop emitting `## Agenda` / `## Action Items`; fold legacy Agenda content into Notes; drop Action Items (task-entity owns it).
- `meetings-hub.js`: retarget to the persistent-hub model (or emit nothing per-day and let the heal create `Meetings.md`) — reconcile its drifted `_buildBody`.

## Section 6 — Alignment & testing

- Wire `SectionExplorer.renderNoteLinks` + the `add-link` overflow dispatch into `MeetingChromeBar` (mirror `StickyChromeBar`).
- Node harnesses: extend `run-meeting-chrome-bar.js`, add `run-meetings-browse-list.js`, add a heal harness (`run-meetings-chrome-modernize-heal.js`) asserting: Agenda-folds-into-Notes, Action-Items-removed, tasks-rendered-once, idempotent 2nd pass byte-identical, links-frontmatter-added, hub-archival moves files.
- Seed-vault fixtures for the new heal (portable-sentinel pattern).
- Schema registry: add `links` to the meeting frontmatter schema; `npm run lint-schemas`.

## Out of scope

- Reworking the People/BacklinkPanel mechanisms.
- Cross-blueprint changes to project-meetings-panel / todo-daily-unassigned-meetings beyond what the frontmatter `date`/`links` additions require (verify they still resolve).

## Version / release

Component bumps (meetings blueprint minor; task-entity/chrome-bar untouched unless the browse-list touches them). Release pipeline is automatic — conventional commits, auto semver, auto-merged release PR, brew tap. No manual version edits.
