---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
tags:
  - kanban-card
  - invoice-card
  - <% tp.date.now("YYYY/MM/DD") %>
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
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "InvoiceNavButtons" });
```
