---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
source_board: {{module_directory}}/To-Do-Board.md
tags:
  - "{{vault_identity_tag}}"
  - board
  - <% tp.date.now("YYYY/MM/DD") %>
---
<%* await tp.file.move("{{module_directory}}/cards/" + tp.date.now("YYYY") + "/" + tp.date.now("MM-MMMM") + "/" + tp.file.title) %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---
