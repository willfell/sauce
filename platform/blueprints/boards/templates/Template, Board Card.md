---
type: board-card
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
source_board: {{module_directory}}/To-Do-Board.md
tags:
  - "{{vault_identity_tag}}"
  - kanban-card
---
<%* await tp.file.move("{{module_directory}}/cards/" + tp.date.now("YYYY") + "/" + tp.date.now("MM-MMMM") + "/" + tp.file.title) %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---
