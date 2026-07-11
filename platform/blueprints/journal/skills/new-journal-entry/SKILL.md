---
name: new-journal-entry
description: Create a new journal entry leaf at spice/journal/YYYY/MM-MMMM/YYYY-MM-DD/Journal-YYYY-MM-DD-HH-mm-ss.md (with optional title in frontmatter); programmatic alternative to clicking + New Journal Entry in the day-hub.
---

<!-- @claude-surface:version 0.4.0 -->

# new-journal-entry

Programmatic journal-entry leaf creation. The user-facing path is the **+ New Journal Entry**
button rendered by `JournalChromeBar` on each day-hub (which opens an overlay dialog for the
title via entity-create). This skill is for orchestrators that need to create journal entries
without invoking the Obsidian UI.

## Inputs

- `title` (optional, string) — short description of the entry; lands in `title:` frontmatter and is what `JournalDayList` displays as the card title (falls back to the entry body's first line, then the filename, if omitted)
- `body` (optional, string) — initial content (no frontmatter; just the entry text); appended below the chrome block
- `date` (optional, string) — `YYYY-MM-DD`; defaults to today in vault local timezone
- `time` (optional, string) — `HH:mm:ss` (24h); defaults to now

## Steps

1. Compute `monthFolder` from `date` (e.g., `2026-05-13` → `2026/05-May`).
2. Compose target folder: `spice/journal/<monthFolder>/<date>/`. Create if missing.
3. Compose target path: `spice/journal/<monthFolder>/<date>/Journal-<date>-<HH-mm-ss>.md` (where `HH-mm-ss` substitutes `:` → `-`).
4. **Do NOT need to pre-create the day-hub** — the user's nav-button click handles that. If the day-hub at `spice/journal/<monthFolder>/<date>/Journal-Day-<date>.md` is absent, leave it absent; clicking the Journal nav-button later will create it.
5. Build the leaf body directly (do NOT call Templater — the leaf creation path bypasses Templater so the title can be baked into frontmatter atomically):

```md
---
type: journal-entry
created_at: "<ISO timestamp at <date>T<time>>"
day: "<date>"
time: "<HH:mm of time>"
title: "<title, with embedded " escaped as \\">"
day_link: "[[Journal-Day-<date>]]"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "JournalChromeBar" });
```

<body if supplied; otherwise leave blank>
```

   `day` and `time` MUST be quoted strings — Obsidian's YAML parser auto-coerces unquoted
   `YYYY-MM-DD` to Date objects which breaks `dv.current().day === "<string>"` filters in helpers.

6. Write the file via direct vault write. Abort with audit-receipt if the path already exists (do NOT overwrite).
7. Return the absolute path + `created: true`.

## Outputs

- `path` (absolute string) — the leaf journal-entry location
- `created` (boolean) — `true` if the skill wrote the file this run

## Audit-receipt

Emit a one-line summary on success:

```
new-journal-entry: created spice/journal/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Journal-<YYYY-MM-DD>-<HH-mm-ss>.md (title="<title>")
```

## Failure modes

- **Collision** — abort with `new-journal-entry: <path> already exists; aborting`. Do NOT overwrite.
- **Parent dir creation denied** — abort with the underlying error; do not retry silently.

## See also

- Workshop sources under `platform/blueprints/journal/manifest.json` — `nav_buttons[]` + `templater_folder_templates[]` + `rule_fragments[]` are source of truth
- `.claude/commands/journal.md` — user-facing slash command
- Landmine #11 (module-directory invariant) — journal owns ONLY `spice/journal/`
