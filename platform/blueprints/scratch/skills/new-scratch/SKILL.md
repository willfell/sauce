---
name: new-scratch
description: Create a new quick-capture scratch note at spice/scratch/YYYY/MM-MMMM/YYYY-MM-DD/Scratch-YYYY-MM-DD-HH-mm.md; programmatic alternative to clicking the Scratch nav-button.
---

<!-- @claude-surface:version 0.1.0 -->

# new-scratch

Programmatic scratch-note-creation skill. The **Scratch** nav-button (rendered by `SpaceNavButtons` in every note) is the user-facing path; this skill is for orchestrators (e.g., cowork weekly-review, capture-from-script flows) that need to create scratches without invoking the Obsidian UI.

## Inputs

- `body` (optional, string) — initial body content (no frontmatter; just the capture text); if omitted, the file is created empty between the two `---` rules
- `date` (optional, string) — `YYYY-MM-DD`; defaults to today in the vault's local timezone
- `time` (optional, string) — `HH:mm` (24h); defaults to now

## Steps

1. Compute `dayName` from `date` (e.g., `2026-05-12` → `Tuesday`).
2. Compute `monthFolder` from `date` (e.g., `2026-05-12` → `2026/05-May`).
3. Compose target path: `spice/scratch/<monthFolder>/<date>/Scratch-<date>-<time-with-colon-as-dash>.md` (where `<time-with-colon-as-dash>` substitutes `:` → `-`, e.g. `09:15` → `09-15`).
4. If the day-index `spice/scratch/<monthFolder>/<date>/<dayName>-<date>.md` does NOT exist, create it from the materialized `ranch/templates/Scratch Day.md` template. Substitute the Templater placeholders programmatically (`<% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>` → `<date>T<time>:00`, `<% tp.date.now("YYYY-MM-DD") %>` → `<date>`, `<% tp.date.now("dddd, MMMM Do YYYY") %>` → e.g. `Tuesday, May 12th 2026`). Leave `{{views_path}}` alone — installer-substituted at install time.
5. Read the materialized scratch template at `ranch/templates/Scratch.md`. Substitute Templater placeholders:
   - `<% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>` → ISO timestamp at `<date>T<time>:00`
   - `<% tp.date.now("YYYY-MM-DD") %>` → `<date>`
   - `<% tp.date.now("HH:mm") %>` → `<time>`
   - `<% tp.date.now("dddd") %>` → `<dayName>`
   - The `<%* %>` script block — SKIP it (the day-index ensure-create is handled by step 4 above; that block only runs in Templater UI context).
6. If `body` was supplied, insert it on its own line between the two `---` horizontal rules in the substituted template body.
7. Ensure parent directories exist; write the file. Abort with the collision audit-receipt if the target path already exists — do NOT overwrite.
8. Return the absolute path + `created: true` + `dayIndexCreated: <bool>`.

## Outputs

- `path` (absolute string) — the scratch file location
- `created` (boolean) — `true` if the skill wrote the file this run
- `dayIndexCreated` (boolean) — `true` if step 4 created the day-index this run

## Audit-receipt

Emit a one-line summary on success:

```
new-scratch: created spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Scratch-<YYYY-MM-DD>-<HH-mm>.md (dayIndexCreated=<bool>)
```

## Failure modes

- **Template missing** — abort with `new-scratch: template not found at ranch/templates/Scratch.md; run \`sauce update --vault $(pwd)\``. Do NOT fall back to writing an empty file.
- **Collision** — abort with `new-scratch: <path> already exists; aborting`. Do NOT overwrite an existing scratch.
- **Parent dir creation denied** — abort with the underlying error; do not retry silently.

## See also

- Workshop sources under `platform/blueprints/scratch/manifest.json` — `nav_buttons[]` + `templater_folder_templates[]` + `rule_fragments[]` are the source of truth for routing + validation
- `.claude/commands/scratch.md` — user-facing slash command
- Landmine #11 (module-directory invariant) — scratch owns ONLY `spice/scratch/`
