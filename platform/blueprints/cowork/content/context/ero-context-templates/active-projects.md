---
type: cowork-active-projects
updated: {{bootstrap_date}}
updated_by: cowork:bootstrap-vault
---

# Active Projects

Refreshed each morning by `cowork:ero-morning` from kanban board scans. Manual edits are fine -- the morning job overwrites the project table section only (the `## Current Projects` heading + table below it).

Projects live in `spice/projects/<slug>/`. Each project has an atlas note (tagged `#project`), a Project Map note, and a kanban board (`<slug>-board.md`). Card notes live in the project directory or under `<slug>/tasks/`. The Projects Hub is at `spice/projects/Projects.md`.

## Current Projects

| Project | Slug | Status | In Progress | Blocked | Last Activity |
|:--------|:-----|:-------|------------:|--------:|:--------------|
| {{example_project_name}} | {{example_project_slug}} | {{example_project_status}} | 0 | 0 | {{example_project_last_activity}} |

The morning orchestrator refreshes the row count + lane totals + last activity column from the live boards.

---

## Reading Project Status

To check live status for a project, read its kanban board at `spice/projects/<slug>/<slug>-board.md`. Look for cards in each lane: In Planning, In Progress, Blocked, Completed. The atlas note (`Project.md`) holds the workstream definitions in frontmatter.

Per-project notes section (optional H3 per project, added by the morning orchestrator when there's meaningful state to capture):

### {{example_project_name}}

- **Phase:** {{example_project_phase}}
- **In Progress:** {{example_project_in_progress}}
- **Blocked:** {{example_project_blocked}}
- **Next Step:** {{example_project_next_step}}
