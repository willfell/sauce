---
name: new-scratch
description: Create a new quick-capture scratch leaf at spice/scratch/YYYY/MM-MMMM/YYYY-MM-DD/Scratch-YYYY-MM-DD-HH-mm.md (with optional title in frontmatter); programmatic alternative to clicking + New Scratch in the day-hub.
---

<!-- @claude-surface:version 0.2.6 -->

# new-scratch

Programmatic scratch leaf-note creation. The user-facing path is the **+ New Scratch** button rendered by `ScratchDayActions` on each day-hub (which opens an overlay dialog for the title). This skill is for orchestrators (cowork weekly-review, capture-from-script flows) that need to create scratches without invoking the Obsidian UI.

## Inputs

- `title` (required, string) — short description of what the scratch is for; lands in `title:` frontmatter and is what `ScratchDayList` displays as the card title
- `body` (optional, string) — initial content (no frontmatter; just the capture text); inserted between the two `---` rules below the action buttons
- `date` (optional, string) — `YYYY-MM-DD`; defaults to today in vault local timezone
- `time` (optional, string) — `HH:mm` (24h); defaults to now

## Steps

1. Compute `monthFolder` from `date` (e.g., `2026-05-13` → `2026/05-May`).
2. Compose target folder: `spice/scratch/<monthFolder>/<date>/`. Create if missing.
3. Compose target path: `spice/scratch/<monthFolder>/<date>/Scratch-<date>-<HH-mm>.md` (where `HH-mm` substitutes `:` → `-`, e.g. `09:15` → `09-15`).
4. **Do NOT need to pre-create the day-hub** — the user's nav-button click handles that. If the day-hub at `spice/scratch/<monthFolder>/<date>/Scratch-Day-<date>.md` is absent, leave it absent; clicking the Scratch nav-button later will create it.
5. Build the leaf body directly (do NOT call Templater — the v0.2.x leaf creation path bypasses Templater so that the title can be baked into frontmatter atomically):

```md
---
created: "<ISO timestamp at <date>T<time>:00>"
type: scratch
day: "<date>"
time: "<time>"
title: "<title, with embedded " escaped as \\">"
day_link: "[[Scratch-Day-<date>]]"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ScratchLeafActions" });
```

---

<body if supplied; otherwise leave blank>
```

   `day` and `time` MUST be quoted strings — Obsidian's YAML parser auto-coerces unquoted `YYYY-MM-DD` to Date objects which breaks `dv.current().day === "<string>"` filters in helpers.

6. Write the file via direct vault write. Abort with audit-receipt if the path already exists (do NOT overwrite).
7. Return the absolute path + `created: true`.

## Outputs

- `path` (absolute string) — the leaf scratch location
- `created` (boolean) — `true` if the skill wrote the file this run

## Audit-receipt

Emit a one-line summary on success:

```
new-scratch: created spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Scratch-<YYYY-MM-DD>-<HH-mm>.md (title="<title>")
```

## Failure modes

- **Collision** — abort with `new-scratch: <path> already exists; aborting`. Do NOT overwrite.
- **Parent dir creation denied** — abort with the underlying error; do not retry silently.
- **Missing title** — abort with `new-scratch: title is required`; do not write a leaf without a title.

## See also

- Workshop sources under `platform/blueprints/scratch/manifest.json` — `nav_buttons[]` + `templater_folder_templates[]` + `rule_fragments[]` are source of truth
- `.claude/commands/scratch.md` — user-facing slash command
- `Docs/scratch-architecture.md` — full architecture reference
- Landmine #11 (module-directory invariant) — scratch owns ONLY `spice/scratch/`
