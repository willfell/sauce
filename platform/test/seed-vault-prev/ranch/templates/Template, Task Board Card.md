<%*
const targetPath = tp.config.target_file?.path || "";
const sourceBoard = app.workspace.getActiveFile()?.path || targetPath;

// Derive project slug + task folder from the path:
// spice/projects/<project>/tasks/<Task>/board/<Card>.md
// v0.55.0 FA-3 drive-by: regex was '^beacon/projects/' (stale from pre-v0.23.0
// rebrand) which never matched post-v0.23.0 paths — task_parent was empty on
// every new card. Now matches the live spice/projects/ convention.
const m = (targetPath || "").match(/^spice\/projects\/([^/]+)\/tasks\/([^/]+)\/board\/([^/]+)$/);
const projectSlug = m?.[1] || "";
const taskFolder = m?.[2] || "";
const cardName = tp.file.title;

const taskParent = projectSlug && taskFolder
    ? `spice/projects/${projectSlug}/tasks/${taskFolder}/${taskFolder}.md`
    : "";

const alias = projectSlug && taskFolder
    ? `${projectSlug}-${taskFolder}: ${cardName}`
    : cardName;
-%>
---
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
task_parent: <% taskParent %>
source_board: <% sourceBoard %>
status: planning
aliases:
  - "<% alias %>"
tags:
  - task-board-card
---
<%*
// Auto-promote into per-task folder convention.
// Kanban creates the file flat at spice/projects/<slug>/tasks/<TaskName>.md.
// Move it into spice/projects/<slug>/tasks/<TaskName>/<TaskName>.md so the task
// note and any sub-notes live together. Idempotent: skips if already inside a
// folder of the same name, or if the target file already exists.
const newFilePath = tp.config.target_file?.path || "";
if (/\/tasks\/[^/]+\/board\//.test(newFilePath)) {
    const fileName = tp.file.title;
    const folder = newFilePath.substring(0, newFilePath.lastIndexOf("/"));
    const folderBasename = folder.substring(folder.lastIndexOf("/") + 1);
    if (folderBasename !== fileName) {
        const targetPath = folder + "/" + fileName + "/" + fileName;
        const existing = app.vault.getAbstractFileByPath(targetPath + ".md");
        if (!existing) {
            await tp.file.move(targetPath);
        }
    }
}
-%>

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```
