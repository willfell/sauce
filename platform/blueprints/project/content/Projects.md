---
type: projects-hub
tags:
  - projects-hub
---

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "ProjectNavButtons" });
```

---

## All Projects

```dataview
TABLE file.ctime AS "Created", file.mtime AS "Modified"
FROM "beacon/projects" AND #project
WHERE file.name != this.file.name
SORT file.ctime DESC
```
