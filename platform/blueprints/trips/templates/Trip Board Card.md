<%*
// Derive trip context from the card's path so the breadcrumb ancestors resolve.
// The board lives at spice/trips/<slug>/board/<Card>.md, so trip_slug = the path
// segment after trips/, and trip = the sibling atlas note's `name` (fallback:
// titleized slug). Mirrors how project Task Card derives task_parent/aliases.
const cardPath = tp.config.target_file?.path || "";
const sm = cardPath.match(/^spice\/trips\/([^/]+)\//);
const tripSlug = sm?.[1] || "";
let tripName = tripSlug
    ? tripSlug.split(/[-_]+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ")
    : "";
if (tripSlug) {
    const atlas = app.vault.getAbstractFileByPath(`spice/trips/${tripSlug}/${tripName}.md`)
        || app.vault.getAbstractFileByPath(`spice/trips/${tripSlug}/${tripSlug}.md`);
    const fm = atlas ? app.metadataCache.getFileCache(atlas)?.frontmatter : null;
    if (fm?.name) tripName = fm.name;
}
-%>
---
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
type: trip-board-card
trip: "<% tripName %>"
trip_slug: <% tripSlug %>
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
await dv.view("{{views_path}}/customjs-guard", { class: "TripsChromeBar" });
```
