---
type: board-card
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
source_board: spice/boards/To-Do-Board.md
tags:
  - "sauce-seed-gen2.kvykhe"
  - kanban-card
---
<%* await tp.file.move("spice/boards/cards/" + tp.date.now("YYYY") + "/" + tp.date.now("MM-MMMM") + "/" + tp.file.title) %>

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---
