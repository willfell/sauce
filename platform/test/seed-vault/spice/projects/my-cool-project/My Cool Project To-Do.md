---
type: project-todo
project: "[[My Cool Project]]"
project_slug: my-cool-project
created_at: "2026-06-24T01:22:50.967Z"
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

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups", args: [{ scope: "project-todo" }] });
```
