---
type: project-todo
project: "{{prompts.project_link}}"
project_slug: "{{prompts.slug}}"
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
  - "seed-test-vault"
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoLeafActions" });
```

## Owned Tasks

## From Meetings

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups", args: [{ scope: "project-todo" }] });
```
