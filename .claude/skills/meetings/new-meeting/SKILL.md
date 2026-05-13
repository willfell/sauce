---
name: new-meeting
description: Create a new meeting note at spice/meetings/notes/<route>/<title>-YYYY-MM-DD.md from the Meeting.md template; programmatic alternative to NewMeetingButton CustomJS class for cowork orchestrators.
---

<!-- @claude-surface:version 0.4.0 -->

# new-meeting

Programmatic meeting-note-creation skill. The inline `NewMeetingButton` (CustomJS class rendered inside the day's Meetings Hub) is the user-facing path; this skill is for orchestrators (e.g., cowork weekly-review, calendar-sync scripts) that need to create meeting notes without invoking the Obsidian UI.

## Inputs

- `title` (required, string) — human meeting title (e.g., "Backlog grooming"); slugified for the filename
- `attendees` (optional, list of strings) — attendee display names; each is resolved against `spice/people/<name>.md` to drive chip rendering and the `person/<name>` tag stamping in the template
- `date` (optional, string) — `YYYY-MM-DD`; defaults to today in the vault's local timezone

## Steps

1. Sanitize `title`: strip leading/trailing whitespace; preserve case but replace `/` and other path-unsafe characters with `-` (the filename retains the human-readable title; do NOT lowercase-slugify aggressively — `Meeting.md` filenames are titleish).
2. Compute the route from `date`: `YYYY` + `MM-MMMM` (e.g., `2026` + `05-May`).
3. Compose target path: `spice/meetings/notes/<YYYY>/<MM-MMMM>/<title>-<YYYY-MM-DD>.md`.
4. Check existence. If the file exists, abort with the collision audit-receipt — do NOT overwrite.
5. Read the materialized template at `ranch/templates/Meeting.md` (workshop canonical source: `pantry/platform/blueprints/meetings/templates/Meeting.md`). Prefer the materialized template when running inside a real consumer vault.
6. Substitute the Templater placeholders programmatically:
   - `<% tp.file.creation_date("YYYY-MM-DD HH:mm") %>` → `<YYYY-MM-DD HH:mm>` (current time)
   - `<% tp.date.now("YYYY/MM/DD") %>` → `<YYYY/MM/DD>` (date tag)
   - Resolve the attendee prompt block: inject one `- person/<Name-with-hyphens>` tag per attendee + one `- "[[<Name>]]"` line under `attendees:` + one `- [[<Name>]]` bullet under `## Attendees`.
   - Leave `{{vault_identity_tag}}` / `{{views_path}}` placeholders alone — those are installer-substituted at install time and must already be materialized in the live `ranch/templates/Meeting.md`.
7. Ensure parent directories exist; write the file.
8. For each attendee that resolves to a `spice/people/<Name>.md` note, count as `registered`; the remainder count as `string-only`.
9. Return the absolute path + a `created` boolean + the attendee tally.

## Outputs

- `path` (absolute string) — the file location
- `created` (boolean) — `true` if the skill wrote the file this run
- `attendeesTotal` (integer) — count of attendees supplied
- `attendeesRegistered` (integer) — count of attendees that resolved to `spice/people/<Name>.md`

## Audit-receipt

Emit a one-line summary on success:

```
new-meeting: created spice/meetings/notes/<YYYY>/<MM-MMMM>/<title>-<YYYY-MM-DD>.md (attendees=N, registered=M)
```

## Failure modes

- **Template missing** — abort with `new-meeting: template not found at ranch/templates/Meeting.md; run \`sauce update --vault $(pwd)\``. Do NOT fall back to writing an empty file.
- **Collision** — abort with `new-meeting: <path> already exists; aborting`. Do NOT overwrite an existing meeting note.
- **Parent dir creation denied** — abort with the underlying error; do not retry silently.

## See also

- `pantry/platform/blueprints/meetings/manifest.json` — `templater_folder_templates[]` + `rule_fragments[]` are the source of truth for routing + validation
- `.claude/commands/meetings.md` — user-facing slash command
- cowork orchestrators that consume this skill (calendar-sync, weekly-review) — wave 3 (v0.34.0) may introduce a thin `cowork.ensure-meeting-note` wrapper
