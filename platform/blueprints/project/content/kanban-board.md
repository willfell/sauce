---
type: project-board
tags:
  - board
---

# To-Do Board

```dataviewjs
const grouped = dv.pages('"boards/planning"')
  .where(p => p.type === "project")
  .groupBy(p => p.status || "active");

if (grouped.length === 0) {
  dv.paragraph("_No projects yet. Run `/new-project` to create one._");
} else {
  for (const grp of grouped) {
    dv.header(2, grp.key);
    for (const p of grp.rows) {
      dv.paragraph(`- [[${p.file.path}|${p.file.name}]]`);
    }
  }
}
```
