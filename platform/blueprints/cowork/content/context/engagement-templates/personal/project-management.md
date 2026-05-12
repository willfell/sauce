# Project Management System

> [!info] How the owner tracks projects in this vault
> Cron-fired Claude reads this before `gather-projects` runs. Edit to reflect the owner's actual project workflow.

**Canonical sources:**
- Project blueprint shape: `spice/projects/<slug>/Project.md` (atlas), `Project Map.md` (workstreams), `<slug>-board.md` (kanban), `tasks/<Task Name>.md` (cards).
- Nav scripts: `ranch/scripts/space-nav-buttons.js` + `ranch/scripts/project-nav-buttons.js`.
- Template registry: `ranch/templates/`.
- Tag rules: see the `project` blueprint manifest rule_fragments.

---

## System architecture

```
spice/projects/
  Projects.md                    <- hub note (tagged `#projects-hub`)
  <slug>/
    Project.md                   <- atlas (hub, workstream defs, tagged `#project`)
    Project Map.md               <- workstream hierarchy view
    <slug>-board.md              <- kanban board (4 lanes: In Planning, In Progress, Blocked, Completed)
    tasks/
      <Task Name>.md             <- card notes (one per task, tagged `#project-card`)
    <other docs>.md              <- reference docs (NOT tasks)
```

Only files in `tasks/` with `#project-card` tag appear in the workstream hierarchy. Other files in the project dir are reference docs.

---

## Discovery (how gather-projects walks the tree)

| What             | How |
|:-----------------|:----|
| List all projects | Read `spice/projects/` -- each subdirectory with a `#project`-tagged atlas is a project. |
| Find atlas note  | The `.md` file with `#project` tag in the project dir (not board, not map). |
| Find workstreams | Read atlas frontmatter `workstreams` array. |
| Find tasks       | Read board file -- tasks are `- [ ] [[Name]]` or `- [x] [[Name]]` under lane headers. |
| Task status      | Which `## lane` header the task appears under on the board. |
| Task workstream  | Read the task's card-note frontmatter `workstream` field. |

---

## Third-party tools

The owner may also track work in tools outside this vault. Cron-fired Claude treats the vault as the source of truth; external tools are referenced by link only.

- {{external_tool_1_name}}: {{external_tool_1_purpose}}
- {{external_tool_2_name}}: {{external_tool_2_purpose}}

---

## Rules

- Card note filenames are Title Case with spaces (not kebab-case).
- Workstream IDs are kebab-case.
- Only files with `#project-card` tag appear in the workstream hierarchy.
- Tasks live in `tasks/` subdirectory, not project root.
- Cron-fired Claude NEVER creates new project notes without explicit owner permission.
