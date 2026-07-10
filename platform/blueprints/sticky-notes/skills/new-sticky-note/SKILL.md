---
name: new-sticky-note
description: Create a new quick-capture sticky-note leaf at spice/sticky-notes/YYYY/MM-MMMM/YYYY-MM-DD/Sticky-YYYY-MM-DD-HH-mm-ss.md (with optional title in frontmatter); programmatic alternative to clicking + New Sticky Note in the day-hub.
---

<!-- @claude-surface:version 0.9.0 -->

# new-sticky-note

Programmatic sticky-note leaf creation. The user-facing path is the **+ New Sticky Note** button rendered by `StickyChromeBar` on each day-hub (which opens an overlay dialog for the title via entity-create). This skill is for orchestrators (cowork weekly-review, capture-from-script flows) that need to create sticky notes without invoking the Obsidian UI.

## Inputs

- `title` (required, string) — short description of what the sticky note is for; lands in `title:` frontmatter and is what `StickyDayList` displays as the card title
- `body` (optional, string) — initial content (no frontmatter; just the capture text); appended below the chrome block
- `date` (optional, string) — `YYYY-MM-DD`; defaults to today in vault local timezone
- `time` (optional, string) — `HH:mm:ss` (24h); defaults to now

## Steps

1. Compute `monthFolder` from `date` (e.g., `2026-05-13` → `2026/05-May`).
2. Compose target folder: `spice/sticky-notes/<monthFolder>/<date>/`. Create if missing.
3. Compose target path: `spice/sticky-notes/<monthFolder>/<date>/Sticky-<date>-<HH-mm-ss>.md` (where `HH-mm-ss` substitutes `:` → `-`, e.g. `09:15:42` → `09-15-42` — the seconds token means multiple creates within the same minute never collide).
4. **Do NOT need to pre-create the day-hub** — the user's nav-button click handles that. If the day-hub at `spice/sticky-notes/<monthFolder>/<date>/Sticky-Day-<date>.md` is absent, leave it absent; clicking the Sticky Notes nav-button later will create it.
5. Build the leaf body directly (do NOT call Templater — the leaf creation path bypasses Templater so that the title can be baked into frontmatter atomically). Mirror the current leaf template shape: frontmatter + one StickyChromeBar block:

```md
---
type: sticky-note
created_at: "<ISO timestamp at <date>T<time>>"
day: "<date>"
time: "<HH:mm of time>"
title: "<title, with embedded " escaped as \\">"
day_link: "[[Sticky-Day-<date>]]"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "StickyChromeBar" });
```

<body if supplied; otherwise leave blank>
```

   `day` and `time` MUST be quoted strings — Obsidian's YAML parser auto-coerces unquoted `YYYY-MM-DD` to Date objects which breaks `dv.current().day === "<string>"` filters in helpers.

6. Write the file via direct vault write. Abort with audit-receipt if the path already exists (do NOT overwrite).
7. Return the absolute path + `created: true`.

## Outputs

- `path` (absolute string) — the leaf sticky-note location
- `created` (boolean) — `true` if the skill wrote the file this run

## Audit-receipt

Emit a one-line summary on success:

```
new-sticky-note: created spice/sticky-notes/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Sticky-<YYYY-MM-DD>-<HH-mm-ss>.md (title="<title>")
```

## Failure modes

- **Collision** — abort with `new-sticky-note: <path> already exists; aborting`. Do NOT overwrite.
- **Parent dir creation denied** — abort with the underlying error; do not retry silently.
- **Missing title** — abort with `new-sticky-note: title is required`; do not write a leaf without a title.

## See also

- Workshop sources under `platform/blueprints/sticky-notes/manifest.json` — `nav_buttons[]` + `templater_folder_templates[]` + `rule_fragments[]` are source of truth
- `.claude/commands/sticky-notes.md` — user-facing slash command
- `Docs/sticky-notes-architecture.md` — full architecture reference
- Landmine #11 (module-directory invariant) — sticky-notes owns ONLY `spice/sticky-notes/`
