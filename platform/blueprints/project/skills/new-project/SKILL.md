---
name: new-project
description: Create a new project entity under spice/projects/<slug>/ — wizard-style sub-skill consumed by cowork orchestrators + standalone use. Slugifies name, creates folder + three sub-notes from workshop templates, stamps frontmatter.
---

<!-- @claude-surface:version 1.5.0 -->

# new-project

Programmatic project-creation skill. The Templater UI wizard is the user-facing path; this skill is for orchestrators (e.g., cowork weekly-review) that need to create projects without UI interaction.

## Inputs

- `name` (required, string) — human project name (e.g., "Q3 Migration")
- `workstreams` (optional, list of strings) — initial workstream tags for the Map note
- `description` (optional, string) — one-line summary stamped into hub frontmatter

## Steps

1. Slugify name → `<slug>` (lowercase, hyphenated, alphanumeric).
2. Read `pantry/platform/blueprints/project/templates/Project.md` + `Project Map.md` + `Project Board.md`.
3. Substitute `{{name}}` / `{{slug}}` / `{{date}}` / `{{workstreams}}` placeholders.
4. Write to `spice/projects/<slug>/<Project Name>.md` + `Project Map.md` + `Project Board.md`.
5. Refresh dataview so `Projects.md` hub picks up the new entity.

## Outputs

- `spice/projects/<slug>/` folder with three notes
- Frontmatter on hub: `type: project`, `tags: [project/<slug>]`, optional `description`, `created`

## Audit-receipt

Emit a one-line summary:

```
new-project: created spice/projects/<slug>/ (hub + map + board; workstreams=N)
```

## Failure modes

- **Folder already exists** — abort with audit-receipt `new-project: <slug> already exists; aborting`. Do NOT overwrite.
- **Templates missing** — abort with `new-project: template not found at <path>; run \`sauce update --vault $(pwd)\``.

## See also

- `pantry/platform/blueprints/project/manifest.json` — files[] template paths
- `.claude/commands/project.md` — user-facing slash command
