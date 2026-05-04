---
created: {{DATE}}
description: ""
tags:
  - project
  - project/{{SLUG}}
  - {{DATE_TAG}}
workstreams: []
---

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "ProjectNavButtons" });
```

---

## Workstreams

```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "ProjectWorkstreamManager" });
```

---

## Project Notes

```dataview
TABLE file.mtime AS "Modified"
FROM "beacon/projects/{{SLUG}}"
WHERE file.name != this.file.name AND !contains(file.name, "-board")
SORT file.mtime DESC
```

---

## Referenced By

```dataview
TABLE file.mtime AS "Modified", file.ctime AS "Created"
WHERE contains(file.outlinks, this.file.link) AND !contains(file.path, "Planning-Board") AND !contains(file.path, "beacon/projects/{{SLUG}}")
SORT file.mtime DESC
```
