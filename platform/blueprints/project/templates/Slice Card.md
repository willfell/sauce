---
<%*
const targetPath = tp.config.target_file?.path || tp.file.path(true) || "";
function canonicalEpicBoardPath(notePath) {
    const normalized = String(notePath || "").replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length < 4 || parts[parts.length - 2] !== "board") return "";
    const epicName = parts[parts.length - 3];
    return `${parts.slice(0, -1).join("/")}/${epicName}-board.md`;
}
async function findSourceEpicBoard() {
    const expected = canonicalEpicBoardPath(targetPath);
    if (!expected || !app.vault.getAbstractFileByPath(expected)) {
        const message = expected
            ? `Canonical epic board missing: ${expected}`
            : `Cannot resolve canonical epic board from slice path: ${targetPath}`;
        try { if (typeof Notice !== "undefined") new Notice(message, 8000); } catch (_) {}
        throw new Error(message);
    }
    return expected;
}
const sourceBoard = await findSourceEpicBoard();
const match = sourceBoard.match(/^(spice\/projects\/[^/]+\/tasks\/([^/]+)\/board\/[^/]+-board\.md)$/);
const epicName = match?.[2] || "";
const epicAtlas = match ? sourceBoard.replace(/\/board\/[^/]+-board\.md$/, `/${epicName}.md`) : "";
const alias = epicName ? `${epicName}: ${tp.file.title}` : tp.file.title;
-%>
type: slice
schema_version: 1.1.0
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
epic: "[[<% epicName %>]]"
task_parent: <% epicAtlas %>
source_board: <% sourceBoard %>
kanban_board: <% sourceBoard %>
status: planning
depends_on: []
aliases:
  - "<% alias %>"
tags:
  - slice
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
```
