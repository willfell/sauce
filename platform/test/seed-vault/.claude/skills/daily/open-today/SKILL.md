---
name: open-today
description: Ensure today's daily note exists at spice/daily/<route>/dddd-YYYY-MM-DD.md; create from template if missing; return absolute path. Programmatic alternative to the daily-notes core plugin's hotkey for cowork orchestrators.
---

<!-- @claude-surface:version 0.3.0 -->

# open-today

Programmatic daily-note-open skill. The Cmd+[ hotkey + Daily nav button + Calendar plugin are the user-facing paths; this skill is for orchestrators (e.g., cowork weekly-review, daily-summary scripts) that need to ensure today's daily note exists without invoking the Obsidian UI.

## Inputs

None — uses today's date in the vault's local timezone.

## Steps

1. Compute today's components: `YYYY`, `MM-MMMM` (e.g., `05-May`), `dddd-YYYY-MM-DD` (e.g., `Tuesday-2026-05-12`).
2. Compose target path: `spice/daily/<YYYY>/<MM-MMMM>/<dddd-YYYY-MM-DD>.md`.
3. Check existence. If the file exists, skip to step 6.
4. Read the template at `pantry/platform/blueprints/daily/content/daily-template.md` (workshop canonical source).
5. Substitute the date placeholders:
   - `<% tp.file.creation_date("YYYY-MM-DD HH:mm") %>` → `<YYYY-MM-DD HH:mm>` (current time)
   - `<% tp.date.now('YYYY/MM/DD') %>` → `<YYYY/MM/DD>` (today's date tag)
   - Leave `{{vault_identity_tag}}` / `{{views_path}}` placeholders alone — those are installer-substituted at install time and should already be materialized in the live `ranch/templates/Daily Note.md`. Prefer reading the materialized template over the raw blueprint source when running inside a real consumer vault.
6. Write the file (only if step 3 found it missing); ensure parent directories exist.
7. Return the absolute path + a `created` boolean.

## Outputs

- `path` (absolute string) — the file location
- `created` (boolean) — `true` if the skill wrote the file this run, `false` if it already existed

## Audit-receipt

Emit a one-line summary:

```
open-today: created spice/daily/<YYYY>/<MM-MMMM>/<dddd-YYYY-MM-DD>.md
```

Or, when the note already existed:

```
open-today: spice/daily/<YYYY>/<MM-MMMM>/<dddd-YYYY-MM-DD>.md existed; opened
```

## Failure modes

- **Template missing** — abort with `open-today: template not found at ranch/templates/Daily Note.md; run \`sauce update --vault $(pwd)\``. Do NOT fall back to writing an empty file.
- **Parent dir creation denied** — abort with the underlying error; do not retry silently.

## See also

- `pantry/platform/blueprints/daily/manifest.json` — `core_plugin_settings[].daily-notes` (folder + format + template) is the source of truth for the route + filename pattern
- `.claude/commands/daily.md` — user-facing slash command
- cowork's `ensure-daily-note` sub-skill — overlapping coverage; wave 3 (v0.34.0) may consolidate the two skills under one canonical owner
