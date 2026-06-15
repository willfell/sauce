---
description: Manage the project blueprint in this vault — create new projects, navigate the All-Projects hub, locate per-project Kanban + Map + Task notes
allowed-tools: Read, Glob, Bash
---

<!-- @claude-surface:version 1.5.0 -->

# /project — project blueprint navigator

Drives the v1.5.0 project blueprint installed at `spice/projects/`. Use this when you want to:

- Create a new project (one entity = one folder under `spice/projects/<slug>/` with hub note + Map + Board sub-notes)
- Find an existing project's hub note, Kanban board, or per-task folders
- Audit project entity health (frontmatter, type tags, hub-cards inclusion)

## Vault layout

```
spice/projects/
├── Projects.md                          All-projects hub (BeaconCards grid; type:project filter)
└── <slug>/
    ├── <Project Name>.md                Project hub note (type:project, #project/<slug>)
    ├── Project Map.md                   Map (type:map)
    ├── Project Board.md                 Kanban (type:kanban)
    ├── tasks/<task-slug>/<Task>.md      Per-task notes (folder-style; auto-promoted by Templater)
    └── board/<card-slug>/<Card>.md      Per-card notes (same shape, distinct from tasks)
```

## Create a new project

Two equivalent entry points:

1. **From Projects hub:** open `spice/projects/Projects.md` (Cmd+O → "Projects") and click the **New Project** button (rendered by `ProjectsHubCards` CustomJS class). Templater wizard prompts for name + workstream tags.
2. **Templater slash-command:** in any note, run the Obsidian `/new-project` slash command (slash-commander plugin invokes `Templates/Template, Project.md`).

The Templater wizard:

- Slugifies the project name → `<slug>`
- Creates `spice/projects/<slug>/` folder
- Materializes hub note (`<Project Name>.md`) + Map + Board sub-notes from the three Templates files
- Stamps `type: project` + `tags: [project/<slug>]` frontmatter on the hub note

## Refresh or audit project state

```bash
sauce audit                   # full vault rule audit incl. project rule fragments
sauce update --vault $(pwd)   # re-install project blueprint if templates drifted
```

## Workstream tagging

Per-card workstream chips render via the `ProjectWorkstreams` widget on each Kanban card. The widget reads `spice/projects/<slug>/Project Map.md` for the workstream list. Edit Map note to add/rename workstreams; card chips re-render on next dataview refresh (Cmd+R if stale).

## See also

- `pantry/platform/blueprints/project/manifest.json` — full file + helper inventory + rule_fragments
- `.claude/skills/project/new-project/SKILL.md` — programmatic project creation skill (consumed by cowork orchestrators)
- `pantry/Docs/landmines.md` #11 — module-directory invariant (this blueprint owns ONLY `spice/projects/`)
