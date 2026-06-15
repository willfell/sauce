---
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
type: trip-board-card
tags:
  - kanban-card
  - trip-card
---
<%*
const newFilePath = tp.config.target_file?.path || "";
if (newFilePath.includes("/board/")) {
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

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
```
